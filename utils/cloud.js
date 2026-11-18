// utils/cloud.js —— 云端数据层（v12 / 1.3.0：班级身份 token 版）
//
// 身份与鉴权（2026-11-04 云端契约，由云端 RPC 提供）：
//   1) POST {restBase}rpc/class_verify   body {p_sid, p_name}      → {ok,token,sid,name,role,badge,is_admin}
//      —— 仅这一个是「无身份也能发」的请求；
//   2) POST {restBase}rpc/class_members  body {}，带 X-Class-Token → 70 人 [{seat,sid,name,role,badge,is_admin}]
//   3) 其余所有班级数据（marks/homework/notices/fitrecs/userdata/feedback/visits）
//      都必须带 X-Class-Token；没有有效身份时本文件不会发任何数据请求。
//
// 身份存在 utils/identity.js（wx storage 'zq_class_identity'），本文件只读取 token。
//
// 硬约束：
//   * 只用原生 wx.request，不接云开发 SDK、不引第三方库；零真实域名/密钥（全部来自 cloud-config.js）；
//   * 未配置 / 断网时退化为「纯本地」：功能照常、不报错、动作进待补发队列，恢复后自动补发；
//   * 所有 wx.request 统一从这里发出（课表读取也在这里，见 ttFetch：CloudBase site_assets 优先、旧 tt.json 兜底）。

const store = require('./store.js');
const identity = require('./identity.js');
const CFG_FILE = require('./cloud-config.js');
const util = require('./util.js');
const cache = require('./cache.js');
const privacy = require('./privacy.js');
const waterUtil = require('./water.js');

const CONFIG = {
  enabled: false,
  restBase: '',
  // 2026-11-18 自建后端切流：当前档位（cloudbase|staging|selfhosted）+ 三档地址表（来自 cloud-config.js）
  restProfile: 'cloudbase',
  restProfiles: null,
  publishableKey: '',
  ttUrl: '',
  // 2026-11-17：DNS 暂停期默认关闭 legacy 回退；cloud-config.js 可显式设 false/true。
  ttLegacy: true,
  timeout: 15000,
  // 2026-11-18 网络体验优化：超时分级 + 网络层参数（cloud-config.js 可覆盖）
  timeouts: { default: 15000, login: 12000, poll: 15000, upload: 60000 },
  net: {
    enableHttp2: true,
    maxConcurrent: 8,
    weakMaxConcurrent: 3,
    retryAttempts: 2,
    retryBaseMs: 350,
    coalesce: true
  },
  // 云端 RPC（class_verify 签发身份 token / class_members 下发班级名单）
  rpc: {
    verify: 'rpc/class_verify', members: 'rpc/class_members',
    // 2026-11-17 通知列表轻量化：服务端返回同构行数组，body 内 data URI 已换成 lazy 标记
    noticesMeta: 'rpc/class_notices_meta',
    // 2026-11-11 名单快捷预设（需求 8）：团员名单（契约 web/AGENTS.md §33；返回 {ok,seats:[{seat,name}]}，无学号）
    league: 'rpc/class_league',
    // 2026-11-12 名单页「管理」：设置/清除班委职务（网页同名 RPC class_set_role，仅管理员）
    setRole: 'rpc/class_set_role',
    // 2026-11-08 诊断 v2 + 课表登录（契约 _diag_task/CONTRACT.md §1/§4）
    diagAgent: 'rpc/diag_agent_info', ttLoginEnqueue: 'rpc/tt_login_enqueue', ttLoginStatus: 'rpc/tt_login_status',
    // 2026-11-11 投票（契约 web/vote/CONTRACT.md §2：poll_create / poll_list / poll_detail / poll_submit / poll_manage）
    pollCreate: 'rpc/poll_create', pollList: 'rpc/poll_list', pollDetail: 'rpc/poll_detail',
    pollSubmit: 'rpc/poll_submit', pollManage: 'rpc/poll_manage'
  },
  tables: {
    homework: 'homework', notices: 'notices', marks: 'marks',
    userdata: 'userdata', feedback: 'feedback', fitrecs: 'fitrecs', visits: 'visits',
    // 与网站功能同步（v2.0.0）：宿舍电费 / 诊断（字段与 RLS 见 task-12 描述）
    power: 'power', powerHistory: 'power_history', serviceHealth: 'service_health',
    // 2026-11-07 课表去域名化：静态资源快照表（id='tt' 行 body={c,t,meta}）
    siteAssets: 'site_assets',
    // 2026-11-08 诊断 v2（public.client_diag / diag_analysis / repair_tasks，RLS 见 2026-11-08_diag_login.sql）
    clientDiag: 'client_diag', diagAnalysis: 'diag_analysis', repairTasks: 'repair_tasks',
    // 2026-11-09 PPT 演示（契约 web/ppt/CONTRACT.md §3；页面逻辑在 utils/ppt.js）
    pptDecks: 'ppt_decks', pptChunks: 'ppt_upload_chunks',
    // 2026-11-11 水量共享（契约 web/tools/tests/_water_shared_contract.md §1）
    water: 'water', waterRoom: 'water_room'
  }
};

// 云端连通状态：hw = 作业表通、nt = 通知表通、ud = 个人数据表通
const NET = { hw: false, nt: false, ud: false, tested: false, lastOk: 0, lastFail: 0, failStreak: 0, retryAt: 0, ntCached: false };
// 网络失败退避（2026-11-17）：离线/弱网时 30s 轮询曾每轮重试所有过期表，放大错误率与耗电。
// 连续失败后指数退避（最长 60s）只影响后台轮询；页面 onShow/下拉刷新等 force 调用不受影响。
function noteNetOk() {
  NET.lastOk = Date.now();
  NET.failStreak = 0;
  NET.retryAt = 0;
}
function noteNetFail() {
  NET.lastFail = Date.now();
  NET.failStreak = Math.min(6, (NET.failStreak || 0) + 1);
  const wait = Math.min(60000, 1500 * Math.pow(2, NET.failStreak - 1));
  NET.retryAt = Date.now() + wait;
}

// ---------------------------------------------------------------- 缓存与 TTL（1.4.4 性能优化）
// 手机端每 30 秒整表重拉的通知表约 2MB（其中 98% 是图片/附件 data URI），是卡顿与耗流的主要来源。
// 策略：
//   * 只有 notices 的 auto groups（~2MB，不落在 zq_tools_v2 里）真正需要分块持久缓存（utils/cache.js）；
//   * 其余表本来就在 zq_tools_v2 持久化，这里只记「上次成功同步时间」做 TTL 门控，不重复占配额；
//   * TTL 未到 → 直接 resolve 本机 store 数据，0 请求；过期 → 通知表先做 ~2KB 签名校验，
//     变了才整表拉；force（下拉刷新 / 手动同步）只跳过 TTL 等待，不跳过签名校验。
const TTL = {
  notices: 10 * 60 * 1000,        // 通知（auto groups + 普通通知）
  homework: 10 * 60 * 1000,
  fit: 5 * 60 * 1000,
  marks: 2 * 60 * 1000,
  members: 6 * 60 * 60 * 1000,
  tt: 6 * 60 * 60 * 1000,
  ud: 60 * 1000,                  // 用户数据 userdata（v6）：60s 内不重复拉（契约 §3.4）
  power: 2 * 60 * 1000,           // 宿舍电费当前电量（网站 TTL.power 同为 2 分钟；ClassPowerSync 约每小时同步）
  powerHist: 2 * 60 * 1000,       // 近 24h 采样（与 power 同 TTL）
  league: 6 * 60 * 60 * 1000,     // 团员名单（class_league，需求 8）：6h TTL，与本机 classLeagueAt 双重门控
  water: 60 * 1000                // 水量共享（需求 6）：进入水量页/切宿舍 60s 内不重复 GET 云端
};
const SYNC_KEY = 'lastSync';
var _notifyT = null;

// 「上次成功同步时间」manifest（随 cache 一起按学号 sid 命名空间隔离，退出身份即清）
function syncMap() {
  const m = cache.get(SYNC_KEY);
  return (m && typeof m === 'object') ? m : {};
}
function syncAt(name) { return Number(syncMap()[name]) || 0; }
function syncFresh(name, ttl) {
  const at = syncAt(name);
  return at > 0 && (Date.now() - at) < ttl;
}
function touchSync(name, at) {
  const m = syncMap();
  m[name] = at || Date.now();
  cache.set(SYNC_KEY, m, 0);      // manifest 不过期；各表新鲜度由上面的 TTL 判断
}
function dropSync(name) {
  const m = syncMap();
  if (!(name in m)) return;
  delete m[name];
  cache.set(SYNC_KEY, m, 0);
}
// 后台刷新完成 → 让当前页面自己重绘（页面实现 onCloudSync 即可）。
// unit 测试里没有 getApp 时静默跳过，不抛错。
function notifyPagesSoon() {
  if (_notifyT) return;
  _notifyT = setTimeout(function () {
    _notifyT = null;
    try {
      const app = (typeof getApp === 'function') ? getApp() : null;
      if (app && typeof app.notifyPages === 'function') app.notifyPages();
    } catch (e) { /* 忽略 */ }
  }, 50);
}

// ---------------------------------------------------------------- 配置
function configure(o) {
  o = o || {};
  Object.keys(o).forEach(function (k) {
    if (k === 'tables') CONFIG.tables = Object.assign({}, CONFIG.tables, o.tables || {});
    else if (k === 'rpc') CONFIG.rpc = Object.assign({}, CONFIG.rpc, o.rpc || {});
    else if (k in CONFIG) CONFIG[k] = o[k];
  });
  if (!CONFIG.restBase) CONFIG.restBase = '';
  if (CONFIG.restBase && CONFIG.restBase.charAt(CONFIG.restBase.length - 1) !== '/') CONFIG.restBase += '/';
  return CONFIG;
}
configure(CFG_FILE);

function isEnabled() {
  return !!(CONFIG.enabled && CONFIG.restBase);
}
// 当前后端档位（诊断/测试用，不含 token）：{ profile, base, staging }
function restInfo() {
  return {
    profile: CONFIG.restProfile || 'custom',
    base: CONFIG.restBase,
    staging: /^http:\/\//i.test(CONFIG.restBase),
    secure: /^https:\/\//i.test(CONFIG.restBase)
  };
}
// 当前是否允许发起同步（云已配置且用户没有关闭「云同步」开关）
function isReadyForSync() { return isEnabled() && !udOff(); }
function currentSid() { return identity.sid(); }
function currentName() { return identity.name(); }
function isAdmin() { return identity.isAdmin(); }

// ---------------------------------------------------------------- HTTP 基座
// 统一请求头：publishableKey + 身份 token（有身份才加，绝不发空 token）。
// opts.noIdentity = true 时用于「获取身份」的 class_verify（此时还没有 token）。
function headerOf(extra, opts) {
  opts = opts || {};
  const h = { 'Content-Type': 'application/json' };
  if (CONFIG.publishableKey) h.Authorization = 'Bearer ' + CONFIG.publishableKey;
  if (!opts.noIdentity) {
    const t = identity.token();
    if (t) h['X-Class-Token'] = t;
  }
  if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
  return h;
}
function headers(write, opts) {
  const h = headerOf(null, opts);
  if (write) h.Prefer = 'return=representation';
  return h;
}

// ---------------------------------------------------------------- 网络体验优化（2026-11-18）
// 目标（数据见 mp-class-tools-tests/net_bench.js 前后对比）：
//   1) 超时分级：登录/身份验证用更宽的超时（弱网冷启动首次 TLS 最慢），普通轮询沿用默认；
//   2) 重试增强：幂等只读请求最多 2 次尝试（指数退避 + 抖动），额外吸收 502/503/504 网关瞬时错误；
//   3) 并发控制：全局并发上限（默认 8；当前网络连续失败时降为 3，避免把拥堵链路打爆）；
//   4) 在途合并：相同 GET 请求同时只发一个（多页面/定时器重复拉同一张表）。
// 旧 CloudBase base 下行为不回退：成功路径请求数/顺序不变，仅在失败/重复场景下变化。

// 超时分级：opts.timeout（显式） > opts.timeoutKey（login/poll/upload）> CONFIG.timeout
function timeoutOf(opts) {
  opts = opts || {};
  if (opts.timeout) return opts.timeout;
  const t = (CONFIG.timeouts && typeof CONFIG.timeouts === 'object') ? CONFIG.timeouts : {};
  const key = opts.timeoutKey && t[opts.timeoutKey];
  if (key) return key;
  return t.default || CONFIG.timeout || 15000;
}
function netOpt() {
  const n = (CONFIG.net && typeof CONFIG.net === 'object') ? CONFIG.net : {};
  return {
    enableHttp2: n.enableHttp2 !== false,
    maxConcurrent: Math.max(1, Number(n.maxConcurrent) || 8),
    weakMaxConcurrent: Math.max(1, Number(n.weakMaxConcurrent) || 3),
    retryAttempts: Math.max(1, Math.min(3, Number(n.retryAttempts) || 2)),
    retryBaseMs: Math.max(0, Number(n.retryBaseMs) || 350),
    coalesce: n.coalesce !== false
  };
}

// 轻量网络统计（只做计数，不含 URL/token；供 tests/net_bench.js 与诊断取指标）
const NET_STATS = { requests: 0, retries: 0, coalesced: 0, queued: 0, peakInflight: 0, lastAt: 0 };
function netStats() {
  return {
    requests: NET_STATS.requests, retries: NET_STATS.retries, coalesced: NET_STATS.coalesced,
    queued: NET_STATS.queued, peakInflight: NET_STATS.peakInflight, lastAt: NET_STATS.lastAt,
    inflight: RUN.active, waiting: RUN.queue.length, failStreak: NET.failStreak
  };
}
function netReset() {
  NET_STATS.requests = NET_STATS.retries = NET_STATS.coalesced = NET_STATS.queued = 0;
  NET_STATS.peakInflight = 0; NET_STATS.lastAt = 0;
}

// 并发闸门：超过上限排队；弱网（连续失败 ≥2 次）自动降档
const RUN = { active: 0, queue: [] };
function maxConcurrent() {
  const n = netOpt();
  return (NET.failStreak >= 2) ? n.weakMaxConcurrent : n.maxConcurrent;
}
function drainRun() {
  while (RUN.queue.length && RUN.active < maxConcurrent()) {
    const fn = RUN.queue.shift();
    fn();
  }
}
function scheduleRun(task) {
  return new Promise(function (resolve, reject) {
    const run = function () {
      RUN.active += 1;
      if (RUN.active > NET_STATS.peakInflight) NET_STATS.peakInflight = RUN.active;
      task().then(function (v) { RUN.active -= 1; drainRun(); resolve(v); },
        function (e) { RUN.active -= 1; drainRun(); reject(e); });
    };
    if (RUN.active < maxConcurrent() && !RUN.queue.length) run();
    else { NET_STATS.queued += 1; RUN.queue.push(run); }
  });
}

function rawRequest(method, url, data, header, opts) {
  opts = opts || {};
  if (!isEnabled()) return Promise.reject(new Error('cloud-disabled'));
  // 无身份时绝不发数据请求；只有 class_verify（public）允许匿名发出
  if (!opts.public && !identity.has()) return Promise.reject(new Error('identity-required'));
  return scheduleRun(function () {
    return new Promise(function (resolve, reject) {
      NET_STATS.requests += 1; NET_STATS.lastAt = Date.now();
      const o = {
        url: url,
        method: method,
        data: data,
        header: header,
        timeout: timeoutOf(opts),
        success: function (res) {
          const sc = (res && res.statusCode) || 0;
          if (sc >= 200 && sc < 300) { noteNetOk(); resolve(res.data); }
          else {
            NET.lastFail = Date.now();
            // 401 = 班级 token 过期/失效：清本机身份并回身份页，停止继续用失效 token 打请求。
            // （403 是 RLS 权限拒绝，可能只是单表权限，不跳身份页。）
            if (sc === 401 && !opts.public) {
              try { require('./identity.js').onAuthExpired(); } catch (e2) { /* ignore */ }
            }
            if (sc >= 500) noteNetFail();
            reject(new Error('http' + sc));
          }
        },
        fail: function (err) { noteNetFail(); reject(err || new Error('network')); }
      };
      // HTTP/2：仅 https（微信基础库 2.10.4+ 支持；旧基础库/自建 http staging 忽略此选项）
      if (netOpt().enableHttp2 && /^https:\/\//i.test(url)) o.enableHttp2 = true;
      wx.request(o);
    });
  });
}

// GET 失败自动重试（默认 2 次尝试）；幂等只读 RPC 用 opts.retry=true 同样享受重试。
// 写请求不重试，避免重复写入。瞬时 5xx（502/503/504）按可重试处理（幂等请求才可能走到这里）。
function request(method, url, data, header, retried, opts) {
  opts = opts || {};
  const canRetry = method === 'GET' || !!opts.retry;
  const maxAttempts = canRetry ? (retried ? 1 : netOpt().retryAttempts) : 1;
  const shareKey = (canRetry && netOpt().coalesce) ? (method + ' ' + (currentSid() || '') + ' ' + url) : '';
  if (shareKey && INFLIGHT[shareKey]) { NET_STATS.coalesced += 1; return INFLIGHT[shareKey]; }
  const run = function (attempt) {
    return rawRequest(method, url, data, header, opts).catch(function (e) {
      const msg = String((e && e.message) || '');
      const isHttp = msg.indexOf('http') === 0;
      const transient = /^http(502|503|504)$/.test(msg);
      if (!canRetry || attempt + 1 >= maxAttempts || (isHttp && !transient)) throw e;
      NET_STATS.retries += 1;
      const base = netOpt().retryBaseMs;
      const wait = base * Math.pow(2, attempt) + Math.floor(Math.random() * 120);
      return new Promise(function (r) { setTimeout(r, wait); }).then(function () { return run(attempt + 1); });
    });
  };
  const p = run(retried ? 1 : 0);
  if (shareKey) {
    INFLIGHT[shareKey] = p;
    const clear = function () { if (INFLIGHT[shareKey] === p) delete INFLIGHT[shareKey]; };
    p.then(clear, clear);
  }
  return p;
}
const INFLIGHT = Object.create(null);

// 微信小程序部分基础库不支持 wx.request 的 PATCH：统一走「读整行 + 幂等 upsert」。
function patchByUpsert(table, id, obj) {
  return cbById(table, id).then(function (row) {
    if (!row) throw new Error('http404');
    const merged = Object.assign({}, row, obj || {});
    return request('POST', CONFIG.restBase + table, [merged],
      headerOf({ Prefer: 'return=representation,resolution=merge-duplicates' }));
  });
}

// ---------------------------------------------------------------- PostgREST 基座
function cbGet(table, query) {
  const q = query || 'select=*&order=ts.asc&archived=eq.false';
  return request('GET', CONFIG.restBase + table + '?' + q, undefined, headers(false));
}
function cbPost(table, row, extra, opts) {
  return request('POST', CONFIG.restBase + table, [row], headerOf(extra, {}), false, opts);
}
function cbPatch(table, id, obj) { return patchByUpsert(table, id, obj); }
function cbById(table, id, extra) {
  return request('GET', CONFIG.restBase + table + '?select=*&id=eq.' + encodeURIComponent(id), undefined, headerOf(extra, {}))
    .then(function (a) { return (a && a[0]) || null; });
}
function cbUpsert(table, row) {
  return request('POST', CONFIG.restBase + table, [row], headerOf({ Prefer: 'return=representation,resolution=merge-duplicates' }));
}
// 批量 upsert（marks 全部置 false 用；PostgREST 支持 POST 数组 + merge-duplicates）
function cbUpsertMany(table, rows) {
  return request('POST', CONFIG.restBase + table, rows || [], headerOf({ Prefer: 'return=representation,resolution=merge-duplicates' }));
}
// 通用 DELETE（PostgREST；2026-11-09 PPT 上传分片清理用：本人 owner_sid 可删自己的分片）
// query 例：'deck_id=eq.<id>'；返回 data（Prefer return=minimal 时为空）。
function cbDelete(table, query) {
  return request('DELETE', CONFIG.restBase + table + '?' + (query || ''), undefined, headerOf({ Prefer: 'return=minimal' }));
}
function cbId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// ---------------------------------------------------------------- 身份验证（class_verify）
// 返回值统一为 { ok:true, identity:{token,sid,name,role,badge,is_admin,ts} } 或 { ok:false, reason }。
// 失败原因直接使用云端 reason（如「姓名或学号不在班级名单中」）。
function classVerify(sidIn, nameIn) {
  const sid = String(sidIn == null ? '' : sidIn).trim();
  const nm = String(nameIn == null ? '' : nameIn).trim();
  if (!nm) return Promise.resolve({ ok: false, reason: '请填写真实姓名' });
  if (!/^\d{10}$/.test(sid)) return Promise.resolve({ ok: false, reason: '学号应为 10 位数字' });
  if (!isEnabled()) return Promise.resolve({ ok: false, reason: '暂时无法连接云端，请稍后重试' });
  return request('POST', CONFIG.restBase + CONFIG.rpc.verify,
    { p_sid: sid, p_name: nm }, headers(false, { noIdentity: true }), false,
    // 2026-11-18：登录超时分级（弱网冷启动更宽）+ 幂等只读 RPC 重试（网络抖动少一次「网络不可用」）
    { public: true, timeoutKey: 'login', retry: true })
    .then(function (raw) {
      const body = Array.isArray(raw) ? raw[0] : raw;
      if (!body || body.ok !== true) {
        return { ok: false, reason: (body && body.reason) || '姓名或学号与班级名单不匹配' };
      }
      if (!body.token) return { ok: false, reason: '云端未返回身份凭证，请稍后重试' };
      return {
        ok: true,
        identity: {
          token: String(body.token),
          sid: String(body.sid || sid),
          name: String(body.name || nm),
          role: body.role == null ? '' : String(body.role),
          badge: body.badge == null ? '' : String(body.badge),
          is_admin: !!body.is_admin,
          ts: Date.now()
        }
      };
    })
    .catch(function (e) {
      const msg = String((e && e.message) || '');
      if (msg === 'cloud-disabled') return { ok: false, reason: '暂时无法连接云端，请稍后重试' };
      if (msg.indexOf('http4') === 0) return { ok: false, reason: '姓名或学号与班级名单不匹配' };
      return { ok: false, reason: '网络不可用，请检查网络后重试' };
    });
}

// ---------------------------------------------------------------- 班级名单（class_members）
// 只有完成 class_verify（本机有 token）才会请求；结果同时写入本机缓存：
//   store.classMembers   = [{seat,sid,name,role,badge,is_admin}]
//   store.classRoster    = "1 张三\n2 李四…"（供抽签/分组/点名复用旧名单逻辑）
function normalizeMember(m) {
  if (!m || typeof m !== 'object') return null;
  const name = String(m.name == null ? '' : m.name).trim();
  if (!name) return null;
  return {
    seat: +m.seat || 0,
    sid: String(m.sid == null ? '' : m.sid).trim(),
    name: name,
    role: String(m.role == null ? '' : m.role).trim(),
    badge: String(m.badge == null ? '' : m.badge).trim(),
    is_admin: !!m.is_admin
  };
}
function rosterTextOf(list) {
  return (list || []).map(function (m) { return (m.seat ? m.seat + ' ' : '') + m.name; }).join('\n');
}
function saveMembers(list) {
  const d = store.get();
  d.classMembers = (list || []).slice();
  d.classRoster = rosterTextOf(d.classMembers);
  d.classMembersAt = Date.now();
  store.save();
  // 1.3.4：名单到位后补做「旧自定义名单文本 → 座号」迁移（幂等；名单为空时迁移内部会跳过）
  try { require('./roster.js').migrate(); } catch (e) { /* 迁移失败不阻塞名单缓存 */ }
}
var _membersPulling = null;
function classMembersPull(force) {
  if (!identity.has() || !isEnabled()) return Promise.resolve([]);
  // 6h TTL：名单极少变化；本机 store 已有名单时直接返回，0 请求
  const local = members();
  if (!force && local.length && syncFresh('members', TTL.members)) return Promise.resolve(local);
  // 2026-11-17 单飞：冷启动 app.warmSync 与 cloudPull 会同时 ensureMembers，
  // 旧实现并发出 2 个 class_members（首屏请求数 +1）；force 也复用进行中的请求。
  if (_membersPulling) return _membersPulling;
  const p = request('POST', CONFIG.restBase + CONFIG.rpc.members, {}, headers(false))
    .then(function (raw) {
      const list = Array.isArray(raw) ? raw : ((raw && Array.isArray(raw.data)) ? raw.data : []);
      const arr = list.map(normalizeMember).filter(Boolean);
      if (arr.length) saveMembers(arr);
      touchSync('members');
      return arr;
    })
    .catch(function () { return []; })
    .then(function (arr) {
      _membersPulling = null;
      return arr;
    }, function () {
      _membersPulling = null;
      return [];
    });
  _membersPulling = p;
  return p;
}
// 本机缓存读取（不发请求）
function members() { return (store.get().classMembers || []).slice(); }
function memberCount() { return members().length; }
// 班委：role 非空的成员（按 管理员 > 座号 排序）；普通成员也可查看
function committee() {
  return members().filter(function (m) { return !!m.role; }).sort(function (a, b) {
    if (a.is_admin !== b.is_admin) return a.is_admin ? -1 : 1;
    return (a.seat || 0) - (b.seat || 0);
  });
}
function memberName(sidIn) {
  const s = String(sidIn == null ? '' : sidIn).trim();
  if (!s) return '';
  const list = members();
  for (let i = 0; i < list.length; i++) if (list[i].sid === s) return list[i].name;
  return '';
}
function clearClassData() {
  const d = store.get();
  d.classMembers = [];
  d.classRoster = '';
  d.classMembersAt = 0;
  store.save();
  dropSync('members');
}
// 名单缓存缺失或超过 6 小时时静默刷新一次（失败保留旧缓存）；云同步关闭时不打网络
function ensureMembers(force) {
  if (!identity.has() || !isEnabled() || udOff()) return Promise.resolve(false);
  const d = store.get();
  const fresh = (d.classMembersAt || 0) > 0 && (Date.now() - (d.classMembersAt || 0) < 6 * 3600 * 1000);
  if (!force && d.classMembers && d.classMembers.length && fresh) return Promise.resolve(true);
  return classMembersPull().then(function (list) { return list.length > 0; });
}

// ---------------------------------------------------------------- 团员名单（class_league，需求 8）
// 名单快捷预设「团员」的数据源（与网页 / 大屏抽签名单同一口径）；返回 [{seat,name}]（无学号）。
// 缓存：store.classLeague + classLeagueAt，6h TTL；离线返回本机缓存（可能为空数组）。
function normalizeLeague(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach(function (x) {
    if (!x || typeof x !== 'object') return;
    const seat = Number(x.seat), name = String(x.name == null ? '' : x.name).trim();
    if (!isFinite(seat) || !Number.isInteger(seat) || seat < 1 || !name) return;
    out.push({ seat: seat, name: name });
  });
  out.sort(function (a, b) { return a.seat - b.seat; });
  return out;
}
function league() { return (store.get().classLeague || []).slice(); }
function leaguePull(force) {
  if (!identity.has() || !isEnabled() || udOff()) return Promise.resolve(league());
  const d = store.get();
  const at = Number(d.classLeagueAt) || 0;
  if (!force && d.classLeague && d.classLeague.length && at && (Date.now() - at) < TTL.league) return Promise.resolve(league());
  return request('POST', CONFIG.restBase + CONFIG.rpc.league, {}, headers(false))
    .then(function (raw) {
      const body = Array.isArray(raw) ? raw[0] : raw;
      const rows = (body && Array.isArray(body.seats)) ? body.seats : (Array.isArray(body) ? body : []);
      const arr = normalizeLeague(rows);
      const dd = store.get();
      dd.classLeague = arr;
      dd.classLeagueAt = Date.now();
      store.save();
      return arr;
    })
    .catch(function () { return league(); });   // 失败保留本机缓存（离线可用）
}

// 设置/清除班委职务（仅管理员；与网页「名单 → 管理」同一 RPC 口径，p_badge=班委/空）。
// 成功后调用方需 classMembersPull(true) 刷新名单再重渲染。
function classSetRole(sidIn, role) {
  const sid = String(sidIn == null ? '' : sidIn).trim();
  const r = String(role == null ? '' : role).trim();
  if (!sid) return Promise.reject(new Error('missing-sid'));
  if (!isAdmin()) return Promise.reject(new Error('admin-only'));
  return request('POST', CONFIG.restBase + CONFIG.rpc.setRole,
    { p_sid: sid, p_role: r, p_badge: r ? '班委' : '' }, headers(false))
    .then(function (raw) {
      const body = Array.isArray(raw) ? raw[0] : raw;
      if (!body || body.ok !== true) throw new Error((body && body.reason) || 'failed');
      return true;
    });
}

// ---------------------------------------------------------------- 勾选状态（marks）
// kind = 'hw'（作业已完成）| 'nt'（通知置顶）| 'ntdone'（通知已处理，v19 新增；ref = 通知组 id）
// seat 使用学号（云端 RLS 按身份 token 校验）；取消 = 写 val:false（不 DELETE）。
// 读取时只认 val===true；marks 是跨端唯一真源（网页与小程序的勾选状态都落在这里）。
function applyMarkLocally(kind, ref, val) {
  if (!ref) return;
  const d = store.get();
  if (kind === 'hw') { d.hwDone = d.hwDone || {}; d.hwDone[ref] = !!val; }
  else if (kind === 'ntdone') { d.ntDone = d.ntDone || {}; d.ntDone[ref] = !!val; }
  else { d.ntPin = d.ntPin || {}; d.ntPin[ref] = !!val; }
  store.save();
}

// 需求 16：marks 是「通知已处理 / 作业已完成」的跨端唯一真源。
//   * force=true（回到前台 / 页面 onShow / 下拉刷新 / onCloudSync）绕过 2 分钟 TTL 强制拉一次；
//   * 拉取结果与本机不同 → notifyPagesSoon()，让工作台计数与 hw/nt 列表立即重渲染；
//   * 待补发（markPend）里的本机改动最后覆盖云端旧值，避免用户刚点的状态被回滚。
var _marksPulling = null;
var _marksAt = 0;                 // 最近一次 marks 拉取结束时间（ms）——首屏提速：避免页面 onShow 与 app 预热重复强拉
function marksFresh(ms) { return _marksAt > 0 && (Date.now() - _marksAt) < (Number(ms) || 5000); }
function marksPull(force) {
  const seat = currentSid();
  if (!seat || !isEnabled() || udOff()) return Promise.resolve(null);
  // 2 分钟 TTL：勾选状态变化不频繁，30s 轮询里大部分轮次 0 请求
  if (!force && syncFresh('marks', TTL.marks)) return Promise.resolve([]);
  if (_marksPulling) return _marksPulling;      // 单飞：多页面同时 onShow 只发一次
  _marksPulling = request('GET', CONFIG.restBase + CONFIG.tables.marks + '?select=*&seat=eq.' + encodeURIComponent(seat), undefined, headers(false))
    .then(function (list) {
      const dd = store.get();
      let changed = false;
      (list || []).forEach(function (x) {
        if (!x || !x.ref) return;
        if (x.kind === 'hw') {
          dd.hwDone = dd.hwDone || {};
          if (!!dd.hwDone[x.ref] !== !!x.val) changed = true;
          dd.hwDone[x.ref] = !!x.val;
        } else if (x.kind === 'nt') {
          dd.ntPin = dd.ntPin || {};
          if (!!dd.ntPin[x.ref] !== !!x.val) changed = true;
          dd.ntPin[x.ref] = !!x.val;
        } else if (x.kind === 'ntdone') {
          dd.ntDone = dd.ntDone || {};
          if (!!dd.ntDone[x.ref] !== !!x.val) changed = true;
          dd.ntDone[x.ref] = !!x.val;
        }
      });
      // 待补发的本机改动优先，别被云端旧值覆盖
      (dd.markPend || []).forEach(function (p) {
        if (!p || !p.ref) return;
        if (p.kind === 'hw') { dd.hwDone = dd.hwDone || {}; dd.hwDone[p.ref] = !!p.val; }
        else if (p.kind === 'nt') { dd.ntPin = dd.ntPin || {}; dd.ntPin[p.ref] = !!p.val; }
        else { dd.ntDone = dd.ntDone || {}; dd.ntDone[p.ref] = !!p.val; }
      });
      store.save();
      touchSync('marks');
      _marksAt = Date.now();
      if (changed) notifyPagesSoon();          // marks 变了 → 页面 onCloudSync 重绘计数/列表
      return list || [];
    })
    .catch(function () { return null; })
    .then(function (r) { _marksPulling = null; return r; });
  return _marksPulling;
}

function markId(seat, kind, ref) { return seat + '|' + kind + '|' + ref; }
function setMark(kind, ref, value) {
  const seat = currentSid();
  applyMarkLocally(kind, ref, value);
  if (!seat || !ref) return Promise.resolve(false);
  // 云同步关闭 / 未配置 / 未登录：只落本机并进待补发队列，恢复后由 flushPending 补发（契约 §3.4）
  if (!isEnabled() || udOff()) { pushPending({ seat: seat, kind: kind, ref: ref, val: value }); return Promise.resolve(false); }
  const row = { id: markId(seat, kind, ref), seat: seat, kind: kind, ref: ref, val: !!value, ts: Date.now() };
  return cbUpsert(CONFIG.tables.marks, row).then(function () {
    dropPending(seat, kind, ref);
    return true;
  }).catch(function () {
    pushPending({ seat: seat, kind: kind, ref: ref, val: value });
    return false;
  });
}

function pushPending(p) {
  const d = store.get();
  d.markPend = d.markPend || [];
  d.markPend = d.markPend.filter(function (x) { return !(x.seat === p.seat && x.kind === p.kind && x.ref === p.ref); });
  d.markPend.push(p);
  store.save();
}
function dropPending(seat, kind, ref) {
  const d = store.get();
  d.markPend = (d.markPend || []).filter(function (p) { return !(p.seat === seat && p.kind === kind && p.ref === ref); });
  store.save();
}
function pendCount() {
  const d = store.get();
  let n = (d.markPend || []).length;
  n += (d.homework || []).filter(function (x) { return x._pending; }).length;
  n += (d.notices || []).filter(function (x) { return x._pending; }).length;
  n += (d.fitRecs || []).filter(function (x) { return x._sync; }).length;
  return n;
}
// 网络恢复后自动补发（有身份时由 cloudPull 顺带调用）；云同步关闭时不补发，留到恢复后
function flushPending() {
  if (udOff() || !isEnabled()) return Promise.resolve([]);
  const d = store.get();
  const jobs = [];
  (d.markPend || []).slice().forEach(function (p) {
    if (!isEnabled() || !p.seat) return;
    jobs.push(cbUpsert(CONFIG.tables.marks, { id: markId(p.seat, p.kind, p.ref), seat: p.seat, kind: p.kind, ref: p.ref, val: !!p.val, ts: Date.now() })
      .then(function () { dropPending(p.seat, p.kind, p.ref); })
      .catch(function () { /* 留队列下次再试 */ }));
  });
  (d.homework || []).filter(function (x) { return x._pending; }).forEach(function (x) {
    if (!isEnabled()) return;
    const row = hwRow(x);
    x.id = row.id; x.ts = row.ts; x.owner = row.owner; x.attachments = row.attachments; x.time = row.time; store.save();
    jobs.push(cbPost(CONFIG.tables.homework, row).then(function () { x._pending = false; store.save(); }).catch(function () { }));
  });
  (d.notices || []).filter(function (x) { return x._pending; }).forEach(function (x) {
    if (!isEnabled()) return;
    const row = ntRow(x);
    x.id = row.id; x.ts = row.ts; x.owner = row.owner; x.attachments = row.attachments; x.time = row.time; store.save();
    jobs.push(cbPost(CONFIG.tables.notices, row).then(function () { x._pending = false; store.save(); }).catch(function () { }));
  });
  return Promise.all(jobs);
}

// 发布者归属：云端列 owner = 学号；管理员或发布者可以「为所有人删除」，其他人删除仅隐藏自己的视图。
function canDelete(it) {
  if (!it) return false;
  const sid = currentSid();
  if (isAdmin()) return true;
  if (!sid) return !it.id;                 // 无身份时只能删除从未上云的本地行
  if (it.owner) return it.owner === sid;
  if (it.author) return it.author === sid; // 兼容旧行（无 owner 字段）
  return !it.id;
}

// ---------------------------------------------------------------- 作业
function hwRow(it) {
  return {
    id: it.id || cbId(),
    subject: it.subject || '',
    content: it.content || '',
    due: it.due || '',
    date: it.date || '',
    time: it.time || '',
    author: it.author || '',
    owner: it.owner || currentSid() || '',
    attachments: it.attachments || '',
    done: false,
    archived: false,
    ts: it.ts || Date.now()
  };
}

function hwPull(force) {
  if (!isEnabled()) return Promise.resolve(null);
  if (udOff()) return Promise.resolve(store.get().homework || []);            // 仅本机：只读本机缓存
  // TTL 内直接用本机 store（zq_tools_v2 已持久化），不再每 30s 重复请求
  if (!force && syncFresh('hw', TTL.homework)) return Promise.resolve(store.get().homework || []);
  return cbGet(CONFIG.tables.homework).then(function (list) {
    const dd = store.get();
    const local = dd.homework || [];
    const byId = {};
    const merged = (list || []).map(function (r) { byId[r.id] = 1; return r; });
    // 保留：待补发、无 id 的老行、以及刚发布但云端列表还没返回的行
    local.forEach(function (p) {
      if (!p.id) { p._pending = true; merged.push(p); return; }
      if (byId[p.id]) return;
      if (p._pending || (p.ts && Date.now() - p.ts < 300000)) merged.push(p);
    });
    dd.homework = merged;
    pruneHomework();
    store.save();
    NET.hw = true; NET.tested = true;
    touchSync('hw');
    return dd.homework;
  }).catch(function () { NET.hw = false; NET.tested = true; return null; });
}

function hwPublish(it) {
  const row = hwRow(it);
  it.id = row.id; it.ts = row.ts; it.author = row.author; it.owner = row.owner; it.attachments = row.attachments; it.time = row.time; it._pending = true;
  store.save();
  if (!isEnabled()) return Promise.resolve(false);
  return cbPost(CONFIG.tables.homework, row).then(function () {
    it._pending = false; store.save(); NET.hw = true; return true;
  }).catch(function () { return false; });
}
function hwArchive(id) {
  if (!id || !isEnabled()) return Promise.resolve(false);
  return cbPatch(CONFIG.tables.homework, id, { archived: true }).then(function () { return true; }).catch(function () { return false; });
}
// 截止日期三天后的作业：从本机移除，并把云端行归档
function pruneHomework() {
  const d = store.get();
  const list = d.homework || [];
  const keep = [];
  let changed = false;
  list.forEach(function (h) {
    if (util.hwExpired(h)) {
      if (h.id && !h._pending) hwArchive(h.id);
      changed = true;
    } else keep.push(h);
  });
  if (changed) { d.homework = keep; store.save(); }
  return changed;
}

// ---------------------------------------------------------------- 通知
var AUTO_NOTICE_PREFIX = '[[CLASS_NOTICE_V1]]';
function isAutoNoticeRow(r) {
  return !!(r && String(r.body || '').indexOf(AUTO_NOTICE_PREFIX) === 0);
}

// 轻量签名：45 行 (id:ts:hidden:edited_at) 按 order 拼串（~1.6KB）。与缓存签名一致 = 通知无新增/改/删，
// 不拉 2MB 整表；不一致才整表重建缓存。
// v2.0.0（需求 12）：管理员编辑/删除只写 override_json / hidden / edited_at，**不改 ts**，
// 所以签名必须纳入 hidden / edited_at，否则永远命中旧缓存、看不到管理员改动（Lead 2026-11-05 补充）。
function ntSigOf(rows) {
  return (rows || []).map(function (r) {
    return String((r && r.id) || '') + ':' +
      String((r && r.ts) == null ? '' : r.ts) + ':' +
      ((r && r.hidden) ? '1' : '0') + ':' +
      String((r && r.edited_at) == null ? 0 : r.edited_at);
  }).join('|');
}
var NT_FULL_Q = 'select=*&order=ts.asc,id.asc&archived=eq.false';
var NT_LITE_Q = 'select=id,ts,hidden,edited_at&order=ts.asc,id.asc&archived=eq.false';

// override_json（云端 text 列，管理员编辑覆盖字段白名单）→ 对象；坏 JSON 视为无覆盖（不炸通知页）。
function ntParseOverride(s) {
  if (s == null || s === '') return null;
  if (typeof s === 'object') return s;
  try {
    const o = JSON.parse(String(s));
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : null;
  } catch (e) { return null; }
}
// 可见通知组：非管理员永远看不到 hidden=true 的行；管理员保留（供「已隐藏」筛选恢复）。
function ntVisible(list, includeHidden) {
  return (list || []).filter(function (g) { return !!includeHidden || !(g && g._hidden); });
}
// 2026-11-18：告诉页面「本次返回的是缓存/旧数据」（不阻塞渲染，页面据此显示缓存文案）。
function ntMarkStale(list) {
  try { if (list && list.length) list._stale = true; } catch (e) { /* ignore */ }
  return list;
}

// 内存热缓存：同一身份下反复进通知页不再重复读 2MB storage + JSON.parse（切身份自动失效）
var _ntMem = { sid: '', at: 0, g: null, sig: '' };
var _ntSync = null;
// 2026-11-18 弱网/无网兜底快照：分块缓存（cache.js）可能因索引损坏、配额、旧版本超限而读不到；
// 这里额外用**单 key**（≤900KB）保存最近一次成功通知列表，冷启动断网时优先用它渲染。
// 按 sid 命名，切号/退出由 cache.clearAll / clearOtherSids 清理；不进 zq_tools_v2。
var NT_SNAP_PREFIX = 'zq_nt_snap_v1_';
function ntSnapshotKey() {
  const sid = currentSid();
  return sid ? (NT_SNAP_PREFIX + sid) : '';
}
// 2026-11-18：storage 快照/分块缓存若被旧链路按非 UTF-8 写入，会解析出大量 U+FFFD（�）。
// 这种缓存必须丢弃后重新拉，否则通知标题/正文会整片乱码。
function ntTextCorrupt(groups) {
  try { return /[\uFFFD]|锟斤拷|ï¿½|Ã.|â€|ðŸ/.test(JSON.stringify(groups)); } catch (e) { return true; }
}
function ntSnapGet() {
  const key = ntSnapshotKey();
  if (!key || typeof wx === 'undefined' || !wx.getStorageSync) return null;
  try {
    const raw = wx.getStorageSync(key);
    if (!raw) return null;
    const o = (typeof raw === 'string') ? JSON.parse(raw) : raw;
    if (!o || o.sid !== currentSid() || !Array.isArray(o.g) || !o.g.length) return null;
    if (ntTextCorrupt(o.g)) { ntSnapClear(); return null; }
    return { g: o.g, sig: String(o.sig || ''), at: Number(o.at) || 0 };
  } catch (e) { return null; }
}
// 单 key 上限按 UTF-8 字节算（中文 3 字节；不能只看字符串长度）。
function ntUtf8Len(str) {
  const s = String(str == null ? '' : str);
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      const n = s.charCodeAt(i + 1);
      if (n >= 0xDC00 && n <= 0xDFFF) { bytes += 4; i++; continue; }
    }
    bytes += (c < 0x80 ? 1 : (c < 0x800 ? 2 : 3));
  }
  return bytes;
}
function ntSnapSet(groups, sig, at) {
  const key = ntSnapshotKey();
  if (!key || typeof wx === 'undefined' || !wx.setStorageSync) return false;
  if (!groups || !groups.length) { ntSnapClear(); return false; }
  try {
    const base = { v: 1, sid: currentSid(), at: Number(at) || Date.now(), sig: String(sig || ''), g: groups };
    let text = JSON.stringify(base);
    // 微信单 key 约 1MB：超限时只保留最近的通知组（宁可少几条，也保证断网有内容）。
    if (ntUtf8Len(text) > 900 * 1024) {
      let keep = groups.slice(-Math.min(groups.length, 80));
      while (keep.length > 1 && ntUtf8Len(JSON.stringify({ v: 1, sid: base.sid, at: base.at, sig: base.sig, g: keep })) > 900 * 1024) {
        keep = keep.slice(1);
      }
      base.g = keep;
      text = JSON.stringify(base);
    }
    wx.setStorageSync(key, text);
    return true;
  } catch (e) { return false; }
}
function ntSnapClear() {
  const key = ntSnapshotKey();
  if (!key || typeof wx === 'undefined' || !wx.removeStorageSync) return;
  try { wx.removeStorageSync(key); } catch (e) { /* ignore */ }
}

function ntMemValid() { return !!(_ntMem.g && _ntMem.sid && _ntMem.sid === currentSid()); }
function ntLoad() {
  if (ntMemValid()) return _ntMem;
  const c = cache.getWithMeta('ntAuto');
  const v = c && c.val;
  if (v && v.g && !ntTextCorrupt(v.g)) {
    _ntMem = { sid: currentSid(), at: Number(v.at) || c.at, g: v.g, sig: String(v.sig || '') };
  } else {
    if (v && v.g) { try { cache.del('ntAuto'); } catch (e) { /* ignore */ } }
    // 分块缓存不可用（旧版本超限 / 索引损坏 / 配额淘汰 / 乱码）时读单 key 快照；
    // 这是弱网/无网仍能看到「上次加载好的通知」的最后一道保障。
    const snap = ntSnapGet();
    _ntMem = snap
      ? { sid: currentSid(), at: snap.at, g: snap.g, sig: snap.sig }
      : { sid: '', at: 0, g: null, sig: '' };
  }
  return _ntMem;
}
// 普通通知（非 auto 行）合并进 store（原 ntPull 的语义：待补发 / 无 id 行保留）
function mergeNotices(list) {
  const dd = store.get();
  const local = dd.notices || [];
  const hidden = dd.ntHide || {};
  const byId = {};
  const merged = (list || []).filter(function (r) { return !(r && r.id && hidden[r.id]) && !isAutoNoticeRow(r); }).map(function (r) { byId[r.id] = 1; return r; });
  local.forEach(function (p) {
    if (!p.id) { p._pending = true; merged.push(p); return; }
    if (byId[p.id] || hidden[p.id]) return;
    if (p._pending || (p.ts && Date.now() - p.ts < 300000)) merged.push(p);
  });
  dd.notices = merged;
  store.save();
  NET.nt = true; NET.tested = true;
  return merged;
}

// 唯一的整表拉取：2026-11-17 起优先调用 class_notices_meta（服务端把 body 内的图片/文件
// data URI 替换为 lazy 标记，响应 ~0.3MB），失败且是「接口不存在」时才回退旧 select=*（~14MB）。
// 解析行时保留 override_json / hidden / edited_at / edited_by，供通知页套用管理员编辑、
// 过滤已隐藏、显示「已更新」标记。
function ntApplyRows(rows) {
  rows = Array.isArray(rows) ? rows : [];
  const autos = [], normal = [];
  rows.forEach(function (r) {
    if (isAutoNoticeRow(r)) {
      try {
        const g = JSON.parse(String(r.body).slice(AUTO_NOTICE_PREFIX.length));
        if (g && g.id) {
          g._hidden = !!r.hidden;
          g._override = ntParseOverride(r.override_json);
          g._editedAt = Number(r.edited_at) || 0;
          g._editedBy = String(r.edited_by || '');
          autos.push(g);
        }
      } catch (e) { /* 单行坏 JSON 跳过，不影响其它通知 */ }
    } else normal.push(r);
  });
  const sig = ntSigOf(rows);
  const at = Date.now();
  cache.set('ntAuto', { at: at, sig: sig, g: autos }, TTL.notices);
  // 单 key 快照：分块缓存失效/冷启动断网时仍能显示上次成功拉到的通知。
  ntSnapSet(autos, sig, at);
  NET.ntCached = false;
  mergeNotices(normal);
  touchSync('ntAuto', at);
  touchSync('nt', at);
  _ntMem = { sid: currentSid(), at: at, g: autos, sig: sig };
  return { autos: autos, normal: normal, sig: sig };
}
function ntMetaFetch() {
  const rpc = CONFIG.rpc && CONFIG.rpc.noticesMeta;
  if (!rpc) return Promise.reject(new Error('nt-meta-disabled'));
  return request('POST', CONFIG.restBase + rpc, {}, headers(false), false, { timeout: 20000, retry: true })
    .then(function (rows) { return Array.isArray(rows) ? rows : ((rows && rows.rows) || []); });
}
function ntFullFetchLegacy() {
  return cbGet(CONFIG.tables.notices, NT_FULL_Q).then(ntApplyRows).catch(function (e) {
    NET.nt = false; NET.tested = true;
    throw e;
  });
}
function ntFullFetch() {
  return ntMetaFetch().then(ntApplyRows).catch(function (e) {
    const msg = String((e && e.message) || '');
    NET.nt = false; NET.tested = true;
    // 旧后端没有该 RPC（404/405）→ 回退旧整表，保证未迁移环境仍可用；
    // 401 已由 rawRequest 触发身份过期跳转，不回退（否则又会打 14MB 公开整表）。
    if (msg === 'http404' || msg === 'http405' || msg === 'nt-meta-disabled') return ntFullFetchLegacy();
    throw e;
  });
}
// 轻量签名查询（~2KB，同样带 X-Class-Token，复用统一 request 通道）
function ntLiteFetch() {
  return request('GET', CONFIG.restBase + CONFIG.tables.notices + '?' + NT_LITE_Q, undefined, headers(false))
    .then(function (rows) { return ntSigOf(Array.isArray(rows) ? rows : []); });
}
// 校验一次通知表（单飞去重）：无缓存 → 整表；有缓存 → 签名比对，变了才整表
function ntSync(notifyOnChange) {
  if (_ntSync) return _ntSync;
  const mem = ntLoad();
  var p;
  if (!mem.g || !mem.sig) {
    p = ntFullFetch();
  } else {
    p = ntLiteFetch().then(function (sig) {
      if (sig === mem.sig) {
        NET.ntCached = false;
        touchSync('ntAuto'); touchSync('nt');
        return { changed: false };
      }
      return ntFullFetch().then(function (r) {
        if (notifyOnChange) notifyPagesSoon();   // 真的变了才通知页面重绘；直接调用方无需
        return { changed: true, autos: r.autos };
      });
    });
  }
  _ntSync = p;
  _ntSync.catch(function () { /* 失败静默：保留旧缓存，下次再校验 */ })
    .then(function () { _ntSync = null; });
  return _ntSync;
}

// includeHidden=true（仅管理员通知页「已隐藏」筛选）时保留 hidden=true 的组；其余调用方（工作台等）不显示已删除通知。
function ntAutoPull(force, includeHidden) {
  if (!isEnabled()) return Promise.resolve([]);
  if (udOff()) {                                                              // 仅本机：只读本机缓存
    const m = ntLoad();
    return Promise.resolve(ntVisible((m && m.g) || [], includeHidden));
  }
  const mem = ntLoad();
  // 首次（本机无缓存）：只能整表拉一次；失败时再看一次快照（可能在拉取期间被写入/读取）
  if (!mem.g) {
    return ntSync(false).then(function () { return ntVisible(ntLoad().g || [], includeHidden); })
      .catch(function () {
        const m = ntLoad();
        NET.ntCached = !!(m && m.g && m.g.length);
        return ntMarkStale(ntVisible((m && m.g) || [], includeHidden));
      });
  }
  if (!force && syncFresh('ntAuto', TTL.notices)) {
    return Promise.resolve(ntVisible(mem.g, includeHidden));
  }
  if (force) {
    // 下拉刷新 / 手动同步：跳过 TTL 等待，但仍先做 ~2KB 签名校验（变了才拉 2MB）
    return ntSync(false).then(function () {
      NET.ntCached = false;
      return ntVisible(ntLoad().g || mem.g, includeHidden);
    }).catch(function () {
      NET.ntCached = true;
      return ntMarkStale(ntVisible(mem.g, includeHidden));
    });
  }
  // 缓存过期：先给页面旧数据（秒开），后台校验/刷新，变了由 notifyPages → onCloudSync 重绘
  NET.ntCached = true;
  ntSync(true).catch(function () { /* 静默回退到缓存 */ });
  return Promise.resolve(ntMarkStale(ntVisible(mem.g, includeHidden)));
}
function ntRow(it) {
  return {
    id: it.id || cbId(),
    title: it.title || '',
    body: it.body || '',
    imp: !!it.imp,
    pin: false,
    author: it.author || '',
    owner: it.owner || currentSid() || '',
    attachments: it.attachments || '',
    archived: false,
    ts: it.ts || Date.now()
  };
}
function ntPull(force) {
  if (!isEnabled()) return Promise.resolve(null);
  if (udOff()) return Promise.resolve(store.get().notices || []);             // 仅本机：只读本机缓存
  if (!force && syncFresh('nt', TTL.notices)) return Promise.resolve(store.get().notices || []);
  return ntSync(false).then(function () { return store.get().notices || []; })
    .catch(function () { NET.nt = false; NET.tested = true; return null; });
}
function ntPublish(it) {
  const row = ntRow(it);
  it.id = row.id; it.ts = row.ts; it.owner = row.owner; it.attachments = row.attachments; it._pending = true;
  store.save();
  if (!isEnabled()) return Promise.resolve(false);
  return cbPost(CONFIG.tables.notices, row).then(function () {
    it._pending = false; store.save(); NET.nt = true; return true;
  }).catch(function () { return false; });
}
function ntArchive(id) {
  if (!id || !isEnabled()) return Promise.resolve(false);
  return cbPatch(CONFIG.tables.notices, id, { archived: true }).then(function () { return true; }).catch(function () { return false; });
}

// ---------------------------------------------------------------- 管理员编辑 / 删除通知（需求 12）
// 云端字段（plan §3，Web 端同一契约）：
//   override_json  text  JSON 字符串，白名单 {title,cat,summary,aiSummary,deadline,eventAt,expireAt,timeLabel}
//   hidden         bool  软删除（采集重建后不复活；管理员可恢复）
//   edited_at      bigint 毫秒时间戳；edited_by = 管理员学号
// auto 行的 rowid = 'auto_' + 通知组 id。写请求不带 return=representation（只判是否成功）。
function ntAdminRowId(gid) { return 'auto_' + String(gid == null ? '' : gid); }
function ntAdminPatch(gid, patch) {
  const gidS = String(gid == null ? '' : gid);
  if (!gidS || !isAdmin() || !isEnabled()) return Promise.resolve(false);
  const body = Object.assign({}, patch || {});
  body.edited_at = Date.now();
  body.edited_by = currentSid();
  return request('PATCH',
    CONFIG.restBase + CONFIG.tables.notices + '?id=eq.' + encodeURIComponent(ntAdminRowId(gidS)),
    body, headers(false))
    .then(function () {
      // 本地内存热缓存同步打补丁：本次会话内其他页面立即看到效果（磁盘缓存由下一次签名校验重建）
      try {
        const mem = ntLoad();
        const arr = (mem && mem.g) || [];
        for (let i = 0; i < arr.length; i++) {
          if (!arr[i] || arr[i].id !== gidS) continue;
          if (body.hidden !== undefined) arr[i]._hidden = !!body.hidden;
          if (body.override_json !== undefined) arr[i]._override = ntParseOverride(body.override_json);
          if (body.edited_at) arr[i]._editedAt = body.edited_at;
          arr[i]._editedBy = body.edited_by || '';
          break;
        }
      } catch (e) { /* 内存补丁失败不影响后台重建 */ }
      dropSync('ntAuto'); dropSync('nt');
      return true;
    })
    .catch(function () { return false; });
}
// 编辑：fields 只传白名单字段（值为 null 表示清空该字段的覆盖）。
function ntAdminEdit(gid, fields) {
  return ntAdminPatch(gid, { override_json: JSON.stringify(fields || {}) });
}
// 删除（hidden=true）/ 恢复（hidden=false）。
function ntAdminHide(gid, hidden) { return ntAdminPatch(gid, { hidden: !!hidden }); }

// ---------------------------------------------------------------- 体测记录（public.fitrecs，按学号）
function fitPush(rec) {
  const sid = currentSid();
  if (!sid || !isEnabled() || !rec) return Promise.resolve(false);
  const row = {
    id: rec.id, acc: sid,
    data: JSON.stringify({ id: rec.id, ts: rec.ts, n: rec.name || '', sex: rec.sex, gr: rec.gr, fields: rec.fields, total: rec.total, grade: rec.grade }),
    arch: false, ts: rec.ts || Date.now()
  };
  const extra = { Prefer: 'return=representation,resolution=merge-duplicates' };
  return request('POST', CONFIG.restBase + CONFIG.tables.fitrecs, [row], headerOf(extra, {}))
    .then(function () { rec._sync = false; store.save(); return true; })
    .catch(function () { rec._sync = true; store.save(); return false; });
}
function fitPull(force) {
  const sid = currentSid();
  if (!sid || !isEnabled()) return Promise.resolve([]);
  if (udOff()) return Promise.resolve((store.get().fitRecs || []).slice());   // 仅本机：只读本机缓存
  if (!force && syncFresh('fit', TTL.fit)) return Promise.resolve((store.get().fitRecs || []).slice());
  return request('GET', CONFIG.restBase + CONFIG.tables.fitrecs + '?select=*&acc=eq.' + encodeURIComponent(sid) + '&arch=eq.false&order=ts.desc', undefined, headers(false))
    .then(function (list) {
      const dd = store.get();
      const unsync = (dd.fitRecs || []).filter(function (x) { return x._sync; });
      const seen = {};
      const cloud = [];
      (list || []).forEach(function (x) {
        let d = null; try { d = JSON.parse(x.data); } catch (e) { d = null; }
        if (!d || !d.id || seen[d.id]) return; seen[d.id] = 1;
        if (!d.ts) d.ts = Number(x.ts) || 0;
        if (d.n) d.name = d.n;
        d._sync = false; cloud.push(d);
      });
      dd.fitRecs = unsync.concat(cloud).slice(0, 2);
      const dropped = unsync.concat(cloud).slice(2);
      store.save();
      dropped.forEach(function (r) { if (r.id && !r._sync) fitDelete(r.id); });
      unsync.forEach(function (r) { fitPush(r); });
      touchSync('fit');
      return dd.fitRecs;
    }).catch(function () { return []; });
}
function fitDelete(id) {
  if (!currentSid() || !isEnabled() || !id) return Promise.resolve(false);
  return cbPatch(CONFIG.tables.fitrecs, id, { arch: true }).then(function () { return true; }).catch(function () { return false; });
}

// ---------------------------------------------------------------- 用户数据 v6（userdata，双向同步）
// 契约：_sync_task/CONTRACT.md §3（跨端唯一标准）。
//   blob = JSON 字符串：{ v:6, at:{ <section>: ms }, homeTools, fit, draw, group, roster, hide, tt, prefs, nick, power, homeToolsAt }
//   行：public.userdata { id = 学号, blob, ts }（不改表结构 / 不加新表 / 不改 RLS）
//
// 本机「拥有」（可写）的 section：homeTools / fit / draw / group / roster / hide / prefs / power；
// tt 只写 termStart（ttView / ttUseMine / ttLocal 原样保留）；nick 归网页端，本机不写。
// 未拥有的内容一律从「最近一次合并结果」store.udCache 原样带上，绝不用空默认值覆盖云端。
// 2026-11-06 v2.0.0：homeTools 语义 = 用户主动勾选的首页工具（≤4，按工具顺序），不再自动补齐；
// 「全部工具自定义顺序」是**本机偏好**（store.toolOrder），不进 UD、不导出（与网页 zq_all_order_v1 一致）。
//
// mergeUd 与 fixtures/merge_ref.js 逐字节等价：section 按固定顺序输出、tie-break = 云端赢（ra >= la）、
// 缺字段当 null/undefined、v5 视为 { homeTools, fit, at:{ homeTools:homeToolsAt||0, fit:0 } }。
const UD_VER = privacy.VERSION;
const UD_KEYS = privacy.SECTION_KEYS;
const UD_DEFAULTS = privacy.DEFAULTS;
// 本机全量拥有的 section（可写）：v2.0.0 起增加 power（关注宿舍/电费，网站功能同步）；
// 2026-11-06 水量统计：water（抄表记录 {rooms:{rv:{p,recs}}}）在同套 LWW 下同步（web/mp 同格式）。
const UD_OWNED = ['homeTools', 'fit', 'draw', 'group', 'roster', 'hide', 'prefs', 'power', 'water'];
// v5：power.low 可调低电阈值（与网站档位一致 [10,20,30,40,50,60,80,100]，旧数据缺省 30）
const UD_POWER_LOWS = [10, 20, 30, 40, 50, 60, 80, 100];
function udNormLow(v) {
  const n = Number(v);
  if (!isFinite(n) || n < 10 || n > 100) return 30;
  const r = Math.round(n / 10) * 10;
  let best = UD_POWER_LOWS[0], bd = 1e9;
  UD_POWER_LOWS.forEach(function (x) { const dd = Math.abs(x - r); if (dd < bd) { bd = dd; best = x; } });
  return best;
}
const UD_DEBOUNCE = 1200;              // 本机改动 → 推送防抖（契约 §3.4）
// 「清除云端我的数据」后的抑制期（QA 2026-11-05 验收观察修复）：
//   清除动作本身会触发 store.save → 脏检测 → udPushSoon，若不加抑制，1.2s 内就把本机设置原样推回云端，
//   用户看到「已清除」但云端副本立刻恢复，语义错误。
//   语义 = 清除后**不自动回推**；直到用户下一次显式修改同步内容（udTouch 检测到本机脏 section）才解除抑制，
//   届时才把本机内容合并后重新上传（页面文案如实说明）。UD_HOLD_MS 只是安全上限（30 天），
//   避免极端情况下抑制永久残留。
const UD_HOLD_MS = 30 * 24 * 60 * 60 * 1000;

var _udPushT = null;                   // 防抖定时器
var _udPushing = null;                 // 推送单飞（避免并发写同一行）
var _udTouching = false;               // 脏检测重入保护（store.save → udTouch 内再 save）
var _udClearing = false;               // 「清除云端我的数据」进行中：暂停推送/脏检测，避免清完又被写回

function udNum(v) { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; }
function udNumOr(v, dft) { const n = Number(v); return isFinite(n) ? n : dft; }
function udClone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
// blob 可能是字符串 / 已解析对象 / 空；坏 JSON → 视为「无云端数据」（不覆盖本机，只推本机合并结果）
function udParse(s) {
  if (s === null || s === undefined || s === '') return null;
  if (typeof s === 'object') return Array.isArray(s) ? null : s;
  try {
    const j = JSON.parse(String(s));
    return (j && typeof j === 'object' && !Array.isArray(j)) ? j : null;
  } catch (e) { return null; }
}
// 稳定序列化（对象键排序）：判断「值是否相同」时不受键顺序影响
function udCanon(v) {
  if (Array.isArray(v)) return '[' + v.map(udCanon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + udCanon(v[k]); }).join(',') + '}';
  }
  return v === undefined ? 'null' : JSON.stringify(v);
}
function udSame(a, b) { return udCanon(a) === udCanon(b); }

// v5 → v6 归一（与 merge_ref.js normalizeV5 等价）
function udNormalizeV5(old) {
  if (!old || typeof old !== 'object') return null;
  return {
    v: 6,
    at: { homeTools: udNum(old.homeToolsAt), fit: 0 },
    homeTools: Array.isArray(old.homeTools) ? udClone(old.homeTools) : undefined,
    fit: (old.fit && typeof old.fit === 'object') ? udClone(old.fit) : undefined
  };
}

// 合并算法（CONTRACT §3.3；逐字节等价 fixtures/merge_ref.js 的 mergeBlob）
function mergeUd(remoteIn, localIn) {
  let remote = remoteIn;
  if (remote && Number(remote.v) === 5) remote = udNormalizeV5(remote);
  const local = localIn || {};
  const out = { v: UD_VER, at: {} };
  UD_KEYS.forEach(function (k) {
    const ra = (remote && remote.at) ? udNum(remote.at[k]) : 0;
    const la = local.at ? udNum(local.at[k]) : 0;
    const hasR = !!(remote && remote[k] !== undefined && remote[k] !== null);
    const hasL = !!(local[k] !== undefined && local[k] !== null);
    if (hasR && (!hasL || ra >= la)) { out[k] = udClone(remote[k]); out.at[k] = ra; }
    else if (hasL) { out[k] = udClone(local[k]); out.at[k] = la; }
    else { out[k] = udClone(UD_DEFAULTS[k]); out.at[k] = 0; }
  });
  out.homeToolsAt = out.at.homeTools;
  return out;
}

// ---------------------------------------------------------------- 本机 section 视图（本地 merge 输入 / 脏检测基线）
function udCache() {
  const c = store.get().udCache;
  return (c && typeof c === 'object' && !Array.isArray(c)) ? c : null;
}
function udCacheAt(k) {
  const c = udCache();
  return (c && c.at) ? udNum(c.at[k]) : 0;
}
// 本机拥有的字段取 store；未拥有的（tt 其余字段 / nick）从 udCache 原样带上（契约 §3.2「保留规则」）
function udSections() {
  const d = store.get();
  const c = udCache();
  const view = { at: {} };
  UD_KEYS.forEach(function (k) { view.at[k] = udCacheAt(k); });
  // 无基线时 homeTools 用本机 homeToolsAt 作为最后修改时间（首次同步更准；其余 section 无本机时间戳）
  if (!c) view.at.homeTools = udNum(d.homeToolsAt);
  // 契约：工具 key 数组（≤4），与网页端一致；v2.0.0 起语义 = 用户勾选的首页工具（不再自动补齐）
  view.homeTools = (d.homeTools || []).slice(0, 4);
  view.fit = Object.assign({}, d.fit || {});
  const dr = d.draw || {};
  view.draw = {
    start: dr.start == null ? 1 : dr.start,
    end: dr.end == null ? 70 : dr.end,
    count: dr.count == null ? 10 : dr.count,
    dup: !!dr.dup,
    excl: dr.excl || '',
    sort: /^(num|desc|rand)$/.test(dr.sort) ? dr.sort : 'draw',
    // 2026-11-12 抽签升级 v1（契约 web/draw/CONTRACT.md §3.1/§4）：自定义序号名称映射文本，
    // 只在既有 draw section 内加字段（不新增顶层键、不新增 section）；旧数据无该字段按空串。
    names: String(dr.names == null ? '' : dr.names)
  };
  const g = d.group || {};
  view.group = {
    source: (g.source === 'pick' || g.source === 'paste') ? 'names' : 'prev',   // 网页端词汇：names / prev
    mode: g.mode === 'per' ? 'pergroup' : 'groups',                            // 网页端词汇：pergroup / groups
    n: udNumOr(g.n, 4),
    shuffle: !!g.shuffle,
    sel: store.normSeats(g.sel)
  };
  view.roster = {
    rosterSel: store.normSeats(d.rosterSel),
    rollSel: store.normSeats(d.rollSel),
    rollSt: Object.assign({}, d.rollSt || {}),
    rollNames: String(d.rollNames || '')
  };
  view.hide = { hwHide: Object.assign({}, d.hwHide || {}), ntHide: Object.assign({}, d.ntHide || {}) };
  // tt：本机只有 termStart 载体；其余字段保留最近合并结果，不落本机也没有默认值覆盖风险
  const tt = (c && c.tt && typeof c.tt === 'object')
    ? Object.assign({}, UD_DEFAULTS.tt, c.tt)
    : JSON.parse(JSON.stringify(UD_DEFAULTS.tt));
  tt.termStart = String(d.termStart || '');
  // 2026-11-08 课表登录：ttLocal = 个人教务课表 {c,t}（与网页同字段，跨端同步）。
  // 只有本机写入过（ttLocalAt>0）才算「本机拥有」并抬高 at.tt 参与 LWW；否则原样保留云端/缓存值，
  // 不用 null 覆盖网页或安卓写入的个人课表。清除个人课表 = ttLocal:null + 抬高 ttLocalAt。
  if (udNum(d.ttLocalAt) > 0) {
    tt.ttLocal = d.ttLocal ? udClone(d.ttLocal) : null;
    view.at.tt = Math.max(udNum(view.at.tt), udNum(d.ttLocalAt));
  }
  view.tt = tt;
  view.prefs = { hwRemind: Object.assign({}, d.hwRemind || {}), ntSub: !!d.ntSub, ntSubAt: udNum(d.ntSubAt) };
  // 全部工具自定义顺序（2026-11-06 起随账号同步）：放进已有 prefs section（不新增顶层键）。
  // 仅在用户拖过排序（toolOrderSetAt>0）时写入，默认自然顺序不污染 blob / 既有夹具。
  if (udNum(d.toolOrderSetAt) > 0) {
    let od = Array.isArray(d.toolOrder) ? d.toolOrder.slice() : [];
    try { od = require('./tools.js').normalizeToolOrder(od); } catch (e) { /* tools 未加载时保底用原数组 */ }
    view.prefs.toolOrder = od;
    // 无基线（首次同步/清缓存）时用本机改动时间抢 prefs 时间戳，避免自定义顺序被旧云端 prefs 覆盖
    if (!c) view.at.prefs = Math.max(udNum(view.at.prefs), udNum(d.toolOrderSetAt));
  }
  // power（关注宿舍/电费）：与网页端同结构 {sel:<roomverify>, at:<ms>}；本机全量拥有，值内 at 为选择时间
  view.power = {
    sel: String((d.power && d.power.sel) || ''),
    at: udNum(d.power && d.power.at),
    low: udNormLow(d.power && d.power.low)
  };
  // 无基线（首次同步/清缓存后）：power 用本机选择的时间戳参与合并，避免云端空 power（at=0）
  // 把用户刚选的宿舍覆盖掉；空选择时 at 仍为 0，云端已有选择照常恢复。
  if (!c && view.power.at) view.at.power = udNum(view.power.at);
  // water（水量统计）：本机已有抄表记录时同样抢时间戳（首次同步不丢本机记录；空记录保持 0 让云端恢复）
  view.water = { rooms: udClone((d.water && d.water.rooms) || {}) };
  if (!c && Object.keys(view.water.rooms).length) view.at.water = Date.now();
  // nick：本机不写；缓存里有就原样带上，避免 push 时用默认值覆盖网页端昵称
  if (c && c.nick !== undefined) view.nick = udClone(c.nick);
  return view;
}

// power section 的值内 at 必须与 at.power 镜像一致（网页端 localView 同规则；跨端只读展示依赖它）
function udMirrorPower(view) {
  if (view && view.power && typeof view.power === 'object') view.power.at = udNum(view.at && view.at.power);
  return view;
}

// 本机拥有 section 的脏检测：与「最近一次合并结果 udCache」的值比较（键顺序无关）
function udOwnedDirty() {
  const c = udCache();
  if (!c) {
    // 无基线（首次同步）：本地已有明确关注宿舍时只把 power 视为脏（抢时间戳 + 推送），
    // 其余 section 保持旧行为（不拿默认值覆盖云端已有设置）；空选择不 dirty，让云端选择恢复。
    const d = store.get();
    return String((d.power && d.power.sel) || '') ? ['power'] : [];
  }
  const view = udSections();
  const dirty = [];
  UD_OWNED.forEach(function (k) { if (!udSame(view[k], c[k])) dirty.push(k); });
  const oldTerm = (c.tt && c.tt.termStart) || '';
  if (String(view.tt.termStart || '') !== String(oldTerm)) dirty.push('tt');
  // 2026-11-08：个人课表（tt.ttLocal）变化 = 本机显式改动（登录成功/清除）→ 抬 at.tt 推送
  if (!udSame(view.tt.ttLocal, c.tt ? c.tt.ttLocal : undefined)) dirty.push('tt');
  return dirty;
}
function udChanged(view, merged) {
  // 只比较「本机会应用到 store 的部分」：未拥有 section（nick / tt 其余字段）变化不影响本页显示
  const APPLIED = ['homeTools', 'fit', 'draw', 'group', 'roster', 'hide', 'prefs', 'power', 'water'];
  for (let i = 0; i < APPLIED.length; i++) {
    if (!udSame(view[APPLIED[i]], merged[APPLIED[i]])) return true;
  }
  if (String((view.tt && view.tt.termStart) || '') !== String((merged.tt && merged.tt.termStart) || '')) return true;
  // 2026-11-08：个人课表 ttLocal 变化也要让页面重绘（换端登录/清除后课表页立即切换来源）
  if (!udSame(view.tt && view.tt.ttLocal, merged.tt && merged.tt.ttLocal)) return true;
  return false;
}

// 派生名单文本（不同步，只用于页面显示）：班级名单已缓存时按最新座号重建 roster / group.names / rollNames
function udDeriveRosterText(d) {
  const members = d.classMembers || [];
  if (!members.length) return;
  const bySeat = {};
  members.forEach(function (m) { if (m && m.seat) bySeat[m.seat] = m.name; });
  const lines = function (seats) {
    return (seats || []).map(function (s) { return bySeat[s] ? (s + ' ' + bySeat[s]) : ''; }).filter(Boolean).join('\n');
  };
  const names = function (seats) {
    return (seats || []).map(function (s) { return bySeat[s] || ''; }).filter(Boolean).join('\n');
  };
  d.roster = lines(d.rosterSel);
  d.group = d.group || {};
  d.group.names = names(d.group.sel);
  const rn = lines(d.rollSel);
  if (rn) d.rollNames = rn;
}

// 应用合并结果到本机状态（只改参数/选择，不碰 flow 里进行中的抽签/分组结果）
function udApply(blob) {
  let j = null;
  if (typeof blob === 'string') j = udParse(blob);
  else if (blob && typeof blob === 'object') j = blob;
  if (!j) return false;
  if (Number(j.v) === 5) j = mergeUd(j, {});
  const d = store.get();
  // v2.0.0：旧版 homeTools（全量顺序，长度 >4）先迁移到本机 toolOrder，再应用云端值；
  // 否则下面「只保留 head ≤4」会把旧的全量顺序直接丢掉（迁移幂等，已完成时是空操作）。
  try { require('./tools.js').migrateLegacy(d); } catch (e) { /* 迁移失败不影响同步应用 */ }
  // 契约 §3.4 防环：先更新基线再写本机，避免把「自己刚应用的值」又标脏
  d.udCache = udClone(j);
  if (Array.isArray(j.homeTools)) {
    const at = udNum(j.homeToolsAt) || (j.at ? udNum(j.at.homeTools) : 0);
    const localEmpty = !(Array.isArray(d.homeTools) && d.homeTools.length);
    // 契约：云端 homeTools 是 ≤4 的勾选集合（按网页端工具顺序），直接应用；旧实现会 concat 本机 tail
    // （第 5+ 位本机序）→ 新语义下必须只保留 head，避免「自动补齐」回潮。
    // 空数组语义：at=0 视为「云端没有数据」（新账号/旧版清除），不覆盖本机默认勾选；
    //             at>0 是用户主动全部取消（v2.0.0 空勾选合法）→ 必须应用，否则取消无法跨端生效。
    if (j.homeTools.length || at > 0 || localEmpty) {
      d.homeTools = j.homeTools.slice(0, 4);
      d.homeToolsAt = at || d.homeToolsAt || 0;
    }
  }
  if (j.fit && typeof j.fit === 'object') d.fit = Object.assign({}, d.fit, j.fit);
  if (j.draw && typeof j.draw === 'object') {
    d.draw = Object.assign({}, d.draw, j.draw);   // 保留本机 autoRe 等非同步字段
    // 2026-11-12 抽签名称映射（draw.names，契约 §3.1）：远端没带该字段时保留本机映射，
    // 带了就按字符串应用（页面 onCloudSync 重绘映射摘要）。脏检测在 udSections 里做，不在这里回写。
    if (j.draw.names !== undefined) d.draw.names = String(j.draw.names == null ? '' : j.draw.names);
  }
  if (j.group && typeof j.group === 'object') {
    const g = j.group;
    d.group = Object.assign({}, d.group, {
      source: (g.source === 'names' || g.source === 'pick' || g.source === 'paste') ? 'pick' : 'prev',
      mode: (g.mode === 'per' || g.mode === 'pergroup') ? 'per' : 'groups',
      n: udNumOr(g.n, 4),
      shuffle: !!g.shuffle,
      sel: store.normSeats(g.sel)
    });
  }
  if (j.roster && typeof j.roster === 'object') {
    d.rosterSel = store.normSeats(j.roster.rosterSel);
    d.rollSel = store.normSeats(j.roster.rollSel);
    d.rollSt = Object.assign({}, j.roster.rollSt || {});
    d.rollNames = String(j.roster.rollNames == null ? '' : j.roster.rollNames);
  }
  if (j.hide && typeof j.hide === 'object') {
    d.hwHide = Object.assign({}, j.hide.hwHide || {});
    d.ntHide = Object.assign({}, j.hide.ntHide || {});
  }
  if (j.prefs && typeof j.prefs === 'object') {
    d.hwRemind = Object.assign({}, j.prefs.hwRemind || {});
    d.ntSub = !!j.prefs.ntSub;
    d.ntSubAt = udNum(j.prefs.ntSubAt);
    // 工具页自定义顺序（跨端）：远端有就应用（顺序归一）；远端没有时**不清空**本机自定义，
    // 交给脏检测（view.prefs 与本机 cache 不一致）自愈回推，避免两端静默丢顺序。
    if (Array.isArray(j.prefs.toolOrder)) {
      try { d.toolOrder = require('./tools.js').normalizeToolOrder(j.prefs.toolOrder); }
      catch (e) { d.toolOrder = j.prefs.toolOrder.slice(0, 40); }
      d.toolOrderSetAt = udNum(j.at && j.at.prefs) || Date.now();
    }
  }
  // tt：本机拥有 termStart；2026-11-08 起也应用个人教务课表 ttLocal（登录成功后跨端同步）。
  // ttView / ttUseMine 仍归网页/安卓，本机无载体不覆盖。nick：网页端字段，本机无载体。
  if (j.tt && typeof j.tt === 'object') {
    d.termStart = String(j.tt.termStart == null ? '' : j.tt.termStart);
    if (j.tt.ttLocal !== undefined) {
      const tl = store.normTtLocal(j.tt.ttLocal);
      d.ttLocal = tl;
      if (!tl) d.ttLocalAt = 0;          // 远端已清空 → 本机也回到「未拥有」，避免再次抬高时间戳
    }
  }
  // power：关注宿舍（网站功能同步）——值内 at 与 section at 同源（网页端 localView 的镜像规则）
  if (j.power && typeof j.power === 'object') {
    d.power = {
      sel: String(j.power.sel == null ? '' : j.power.sel),
      at: udNum(j.power.at) || (j.at ? udNum(j.at.power) : 0),
      low: udNormLow(j.power.low)
    };
  }
  // water（水量统计）：{rooms:{rv:{p,recs:[{m,r,ts}]}}}；坏数据归一为 {rooms:{}}，旧数据无该键保持本机
  if (j.water && typeof j.water === 'object') d.water = waterUtil.normWater(j.water);
  try { udDeriveRosterText(d); } catch (e) { /* 派生失败不影响同步 */ }
  store.save();
  return true;
}

// 待补发标记用 writeKey 静默落盘（不触发 store.save 的脏检测，避免失败重试自激）
function udSetPend(v) {
  const d = store.get();
  const next = !!v;
  if (d.udPend === next) return;
  d.udPend = next;
  try { store.writeKey(store.KEY, d); } catch (e) { /* 落盘失败不影响业务 */ }
}

// 「清除云端」抑制期：截止时间未到 → 不自动回推；用户显式改动同步内容时由 udTouch 解除
function udHoldUntil() { return Number(store.get().udHoldUntil) || 0; }
function udHold() { return udHoldUntil() > Date.now(); }
function udClearHold() {
  const d = store.get();
  if (!d.udHoldUntil) return;
  d.udHoldUntil = 0;
  try { store.writeKey(store.KEY, d); } catch (e) { /* 落盘失败不影响业务 */ }
}

// 云同步开关（契约 §3.4：关闭时不拉、不推、marks 写入入队；恢复后补推 + 拉一次）
function udOff() { return !!store.get().cloudOff; }
function udPendingCount() {
  const d = store.get();
  let n = (d.markPend || []).length;
  if (d.udPend) n += 1;
  return n;
}
function udStatus() {
  const d = store.get();
  const c = udCache();
  const holdUntil = Number(d.udHoldUntil) || 0;
  return {
    off: !!d.cloudOff,
    hold: holdUntil > Date.now(),
    holdUntil: holdUntil,
    pend: udPendingCount(),
    marksPend: (d.markPend || []).length,
    udPend: !!d.udPend,
    at: syncAt('ud'),
    net: !!NET.ud,
    cacheV: c ? (Number(c.v) || 0) : 0
  };
}
function setCloudOff(off) {
  const d = store.get();
  const was = !!d.cloudOff;
  const next = !!off;
  if (was === next) return Promise.resolve({ ok: true, off: next });
  d.cloudOff = next;
  store.save();
  if (next) return Promise.resolve({ ok: true, off: true });
  return flushPending().then(function () { return cloudPull(true); }).then(function () {
    return { ok: true, off: false };
  }).catch(function () { return { ok: false, off: false, reason: '网络不可用，请稍后重试' }; });
}

// 拉：GET userdata → merge(remote, local) → 应用 → 若本机改动赢/云端缺内容则排一次推送（契约 §3.4）
function udPull(force) {
  const sid = currentSid();
  if (!sid) return Promise.resolve({ ok: false, reason: '请先完成身份验证' });
  if (!isEnabled()) return Promise.resolve({ ok: false, reason: '未连接云端' });
  if (udOff()) return Promise.resolve({ ok: false, reason: '云同步已关闭' });
  if (!force && syncFresh('ud', TTL.ud)) {
    return Promise.resolve({ ok: true, changed: false, pushed: false, fresh: true, willPush: false });
  }
  const view = udSections();
  const now = Date.now();
  udOwnedDirty().forEach(function (k) { view.at[k] = now; });   // 本机未推送的改动 → 抢占时间戳，不被旧云端值覆盖
  udMirrorPower(view);
  return cbById(CONFIG.tables.userdata, sid).then(function (row) {
    const remote = udParse(row && row.blob);
    const wasV5 = !!(remote && Number(remote.v) === 5);            // 契约 §3.3：v5 迁移后要写回 v6
    const merged = mergeUd(remote, view);
    const changed = udChanged(view, merged);
    udApply(merged);
    NET.ud = true;
    touchSync('ud');
    if (changed) notifyPagesSoon();                             // 应用后让页面重绘（契约 §5.2）
    // 契约 §3.3「v5 迁移后正常 merge 并写回 v6」：拉到 v5 时立即把合并结果 v6 写回云端（幂等：
    //   写回后 remote 变 v6，下次不再触发；清除抑制期 / cloudOff / 清除进行中不写）。
    if (wasV5 && !udOff() && !udHold() && !_udClearing) {
      return udPush(true).then(function (p) {
        return {
          ok: true, changed: changed, pushed: !!(p && p.pushed),
          willPush: false, held: false, migratedV5: true
        };
      });
    }
    // 合并结果与云端不一致 = 云端需要更新；但「清除云端」抑制期内不自动回推（等用户显式改动）
    const needPush = !udSame(merged, mergeUd(remote, {}));
    const willPush = needPush && !udHold();
    if (willPush) udPushSoon();
    return { ok: true, changed: changed, pushed: false, willPush: willPush, held: needPush && !willPush, migratedV5: false };
  }).catch(function () {
    NET.ud = false;
    return { ok: false, reason: '网络不可用，请稍后重试' };
  });
}

// 推：GET → merge(remote, local+脏 section 抢时间戳) → 需要时 POST（Prefer: merge-duplicates upsert）
// force=true：无条件写回合并结果（v5 → v6 迁移用；否则「内容相同但云端仍是 v5」会被幂等判断跳过）
// 另外只要远端 blob 还是 v5，即使非 force 也会把 v6 写回（兜底：任何一次 push 都完成迁移）。
function udPush(force) {
  const sid = currentSid();
  if (!sid) return Promise.resolve({ ok: false, reason: '请先完成身份验证' });
  if (!isEnabled()) return Promise.resolve({ ok: false, reason: '未连接云端，数据已保存在本机' });
  if (udOff()) return Promise.resolve({ ok: false, reason: '云同步已关闭' });
  if (_udClearing) return Promise.resolve({ ok: false, hold: true, reason: '正在清除云端数据，请稍后再同步' });
  // 抑制期：清除云端后不自动回推；用户显式修改同步内容时 udTouch 会先解除抑制（见 udClearHold）
  if (udHold()) return Promise.resolve({ ok: false, hold: true, reason: '刚刚清除过云端数据，修改设置后会重新同步' });
  if (_udPushing) {
    if (!force) return _udPushing;
    // 已有推送在途：等它落定后再强制写回一次，避免 v5 迁移被幂等跳过
    return _udPushing.catch(function () { /* 前一次失败也继续尝试迁移写回 */ }).then(function () {
      return udPush(true);
    });
  }
  const view = udSections();
  const now = Date.now();
  udOwnedDirty().forEach(function (k) { view.at[k] = now; });
  udMirrorPower(view);
  _udPushing = cbById(CONFIG.tables.userdata, sid).then(function (row) {
    const remote = udParse(row && row.blob);
    const merged = mergeUd(remote, view);
    const remoteNorm = mergeUd(remote, {});
    const mustWrite = !!force || (!!remote && Number(remote.v) === 5) || !udSame(merged, remoteNorm);
    if (!mustWrite) {
      const d0 = store.get();
      d0.udCache = merged;
      // power 值内 at 需同步回 store（否则 udSections 与 udCache 的 power.at 不一致 → 反复判脏）
      if (merged && merged.power && typeof merged.power === 'object') {
        d0.power = { sel: String(merged.power.sel || ''), at: udNum(merged.power.at), low: udNormLow(merged.power.low) };
      }
      d0.udPend = false;
      store.save();
      NET.ud = true;
      touchSync('ud');
      return { ok: true, pushed: false, changed: false };
    }
    return cbUpsert(CONFIG.tables.userdata, { id: sid, blob: JSON.stringify(merged), ts: Date.now() }).then(function () {
      const d = store.get();
      d.udCache = merged;
      if (merged && merged.power && typeof merged.power === 'object') {
        d.power = { sel: String(merged.power.sel || ''), at: udNum(merged.power.at), low: udNormLow(merged.power.low) };
      }
      d.udPend = false;
      store.save();
      NET.ud = true;
      touchSync('ud');
      return { ok: true, pushed: true, changed: true };
    });
  }).catch(function (e) {
    udSetPend(true);
    NET.ud = false;
    return { ok: false, reason: '网络不可用，请稍后重试', error: e };
  });
  _udPushing.then(function () { _udPushing = null; }, function () { _udPushing = null; });
  return _udPushing;
}
function udPushSoon() {
  // 抑制期 / 清除进行中：不自动回推（udTouch 检测到用户显式改动时会先解除抑制）
  if (_udClearing || udHold()) return;
  udSetPend(true);
  if (_udPushT) return;
  _udPushT = setTimeout(function () {
    _udPushT = null;
    udPush().catch(function () { /* 失败保留 udPend，下轮再试 */ });
  }, UD_DEBOUNCE);
}
function udStop() { if (_udPushT) { clearTimeout(_udPushT); _udPushT = null; } }
// 立即冲刷待推送（页面/小程序隐藏时调用）：取消防抖定时器，有脏/pend 才真正发请求。
// 用于「选完马上退出」场景——本机已落盘，能发出去就同步，发不出去下次启动 pull 时按脏检测补推。
function udFlush() {
  if (_udPushT) { clearTimeout(_udPushT); _udPushT = null; }
  const d = store.get();
  if (!d.udPend && !udOwnedDirty().length) return Promise.resolve({ ok: true, pushed: false, flushed: false });
  return udPush().catch(function () { return { ok: false, pushed: false, flushed: true }; });
}

// store.save() 后的脏检测入口（契约 §5.2：lazy require + try/catch + 未登录/cloudOff/无基线直接返回）
function udTouch() {
  if (_udTouching || _udClearing) return;
  if (!isEnabled() || !identity.has() || udOff()) return;
  _udTouching = true;
  try {
    if (!udOwnedDirty().length) return;
    // 抑制期内出现本机脏 section = 用户显式修改了同步内容 → 解除抑制，允许重建云端副本
    if (udHold()) udClearHold();
    udPushSoon();
  } catch (e) { /* 同步脏检测失败不影响本机保存 */ }
  finally { _udTouching = false; }
}

// 拉取→合并→应用→必要时推送（契约 §5.2：返回 { ok, changed, pushed, reason }，不再用 conflict 弹窗语义）
function udSync(manual) {
  const sid = currentSid();
  if (!sid) return Promise.resolve({ ok: false, changed: false, pushed: false, reason: '请先完成身份验证' });
  if (!isEnabled()) return Promise.resolve({ ok: false, changed: false, pushed: false, reason: '未连接云端，数据已保存在本机' });
  if (udOff()) return Promise.resolve({ ok: false, changed: false, pushed: false, reason: '云同步已关闭' });
  return udPull(!!manual).then(function (r) {
    if (!r || !r.ok) return { ok: false, changed: false, pushed: false, reason: (r && r.reason) || '网络不可用，请稍后重试' };
    if (!r.willPush) return { ok: true, changed: !!r.changed, pushed: !!r.pushed, reason: '' };
    return udPush().then(function (p) {
      return { ok: !!(p && p.ok), changed: !!r.changed, pushed: !!(p && p.pushed), reason: (p && p.reason) || '' };
    });
  });
}

// 旧接口保留：老调用方（如工具排序）用 pushPrefs 立即推一次；udBlob 返回当前基线快照（调试/兼容用）
function udBlob() { return JSON.stringify(mergeUd(udCache(), udSections())); }
function pushPrefs() { return udPush(); }
function resolveUseCloud(blob) { const ok = udApply(blob); return udPush().then(function (p) { return !!(ok && p && p.ok); }); }
function resolveUseLocal() { return udPush().then(function (p) { return !!(p && p.ok); }); }

// 清除云端「我的数据」（契约 §5.5）：userdata 覆盖为空 v6、marks 全部置 false、fitrecs 逐条 arch。
// 注意：RLS 没有 DELETE 权限，只能覆盖/置 false/归档；visits / feedback 无法删除（页面如实说明）。
// 本机数据保留（用户可另行「清除本机数据」）。清除成功后进入「抑制期」（udHoldUntil）：
//   不自动回推云端；直到用户下一次显式修改同步内容时才把本机内容合并后重新上传（页面如实说明）。
function udClearCloud() {
  const sid = currentSid();
  if (!sid) return Promise.resolve({ ok: false, reason: '请先完成身份验证' });
  if (!isEnabled()) return Promise.resolve({ ok: false, reason: '未连接云端' });
  if (udOff()) return Promise.resolve({ ok: false, reason: '云同步已关闭，请先开启' });
  if (_udClearing) return Promise.resolve({ ok: false, reason: '正在清除，请稍候' });
  const empty = privacy.emptyV6();
  const t0 = Date.now();
  let markN = 0;
  let fitN = 0;
  _udClearing = true;                          // 清除过程中暂停脏检测 / 推送，避免清完又被写回
  udStop();                                    // 取消尚未触发的防抖推送
  const settle = _udPushing ? _udPushing.catch(function () { /* 等在途推送落定，避免「先清后写」 */ }) : Promise.resolve();
  return settle
    .then(function () {
      return cbUpsert(CONFIG.tables.userdata, { id: sid, blob: JSON.stringify(empty), ts: t0 });
    })
    .then(function () {
      return request('GET', CONFIG.restBase + CONFIG.tables.marks + '?select=*&seat=eq.' + encodeURIComponent(sid), undefined, headers(false));
    })
    .then(function (rows) {
      const offs = privacy.marksOffRows(rows, sid);
      markN = offs.length;
      if (!offs.length) return null;
      return cbUpsertMany(CONFIG.tables.marks, offs);
    })
    .then(function () {
      return request('GET', CONFIG.restBase + CONFIG.tables.fitrecs + '?select=*&acc=eq.' + encodeURIComponent(sid) + '&arch=eq.false', undefined, headers(false));
    })
    .then(function (list) {
      const jobs = (Array.isArray(list) ? list : []).filter(function (r) { return r && r.id; }).map(function (r) {
        fitN += 1;
        return cbPatch(CONFIG.tables.fitrecs, r.id, { arch: true }).catch(function () { return null; });
      });
      return Promise.all(jobs);
    })
    .then(function () {
      const d = store.get();
      // 清除后的基线 = 「本机现值（at 抬到 now）」：脏检测保持干净，合并时本机值也不会被云端空值抢走
      const base = udSections();
      const now = Date.now();
      UD_OWNED.forEach(function (k) { base.at[k] = now; });
      if (base.tt) base.at.tt = now;
      d.udCache = mergeUd(empty, base);
      d.udHoldUntil = now + UD_HOLD_MS;        // 抑制期：直到用户显式改动前不自动回推
      d.udPend = false;
      d.markPend = [];
      d.hwDone = {};
      d.ntPin = {};
      d.ntDone = {};
      store.save();
      NET.ud = true;
      touchSync('ud');
      _udClearing = false;
      return { ok: true, marks: markN, fitrecs: fitN, clearedAt: t0, holdUntil: d.udHoldUntil };
    })
    .catch(function (e) { _udClearing = false; return { ok: false, reason: '网络不可用，请稍后重试', error: e }; });
}

// ---------------------------------------------------------------- 反馈建议
// 1.5.2 起停收 QQ / 微信联系方式：contact 列保留（表结构 + 旧数据兼容），新提交固定空串。
function fbSend(content) {
  const text = String(content == null ? '' : content).trim();
  if (!identity.has()) return Promise.resolve({ ok: false, reason: '请先完成身份验证' });
  if (!text) return Promise.resolve({ ok: false, reason: '写点反馈内容' });
  if (!isEnabled()) return Promise.resolve({ ok: false, reason: '暂时无法连接云端，请稍后重试' });
  const row = {
    id: cbId(),
    content: text,
    contact: '',
    acc: currentSid(),
    done: false,
    ts: Date.now()
  };
  return request('POST', CONFIG.restBase + CONFIG.tables.feedback, [row], headers(false))
    .then(function () { return { ok: true, row: row }; })
    .catch(function (e) { return { ok: false, reason: '网络不可用，请稍后重试', error: e }; });
}
function fbPull() {
  if (!identity.has() || !isEnabled()) return Promise.resolve([]);
  return request('GET', CONFIG.restBase + CONFIG.tables.feedback + '?select=*&order=ts.desc', undefined, headers(false))
    .then(function (list) { return Array.isArray(list) ? list : []; })
    .catch(function () { return []; });
}
function fbDone(id, row) {
  if (!isEnabled()) return Promise.resolve(false);
  return cbPatch(CONFIG.tables.feedback, id, { done: true })
    .then(function () { return true; })
    .catch(function () {
      if (!row) return false;
      const merged = {
        id: row.id, content: row.content || '', contact: row.contact || '',
        acc: row.acc || '', done: true, ts: row.ts || Date.now()
      };
      return cbUpsert(CONFIG.tables.feedback, merged).then(function () { return true; }).catch(function () { return false; });
    });
}

// ---------------------------------------------------------------- 访问统计（visits，按账号）
// 云同步每次访问写：{id: sid+"|"+slot+"|mp", slot, sid, name, did, client:"mp", ts}，带 X-Class-Token。
// 统计页只读汇总，仅管理员可见（服务端 RLS 再校验 token）。
function didOf() {
  const d = store.get();
  if (!d.did) {
    const a = [];
    for (let i = 0; i < 8; i++) a.push(('0' + Math.floor(Math.random() * 256).toString(16)).slice(-2));
    d.did = a.join('');
    store.save();
  }
  return d.did;
}
function hourSlot(date) {
  const n = date || new Date();
  return n.getFullYear() + '-' + ('0' + (n.getMonth() + 1)).slice(-2) + '-' + ('0' + n.getDate()).slice(-2) + '-' + ('0' + n.getHours()).slice(-2);
}
function visitLog() {
  const id = identity.get();
  if (!id || !isEnabled() || udOff()) return Promise.resolve(false);
  try {
    const slot = hourSlot();
    // 2026-11-18：去重键按「账号 + 登录端」分开（旧键不分账号，同机切号会漏记下一个账号）。
    const mark = id.sid + '|' + slot + '|mp';
    const storageKey = 'zq_visit_slot_' + id.sid + '_mp';
    try { if (wx.getStorageSync(storageKey) === mark) return Promise.resolve(false); } catch (e) { /* ignore */ }
    const row = { id: mark, slot: slot, sid: id.sid, name: id.name, did: didOf(), client: 'mp', ts: Date.now() };
    // 2026-11-17：同一账号同一小时重复写（换设备/清缓存/重装）会撞主键 409，是请求错误率的
    // 真实来源之一。visits 无 UPDATE 权限，不能用 merge-duplicates；用 ignore-duplicates
    // （ON CONFLICT DO NOTHING）幂等忽略，成功返回 2xx，不再计一次失败请求。
    return request('POST', CONFIG.restBase + CONFIG.tables.visits, [row],
      headerOf({ Prefer: 'resolution=ignore-duplicates,return=minimal' }))
      .then(function () { try { wx.setStorageSync(storageKey, mark); } catch (e) { /* ignore */ } return true; })
      .catch(function () { return false; });
  } catch (e) { return Promise.resolve(false); }
}
// 单条通知 body 按需刷新：auto 行的 rowid = 'auto_' + gid；select=* 拿完整 body（含图片/附件 data URI）。
// 2026-11-17：列表缓存只存 lite body（data URI 置空 + lazy），完整 body 仅放内存热缓存，
// **不回写持久缓存**，避免 14MB 重新撑爆 storage；下次冷启动需要时再按 id 拉单行。
function ntPatchCachedGroup(g) {
  try {
    const mem = ntLoad();
    if (!mem || !mem.g || !mem.sid || mem.sid !== currentSid()) return;
    for (let i = 0; i < mem.g.length; i++) {
      if (mem.g[i] && mem.g[i].id === g.id) { mem.g[i] = g; break; }
    }
  } catch (e) { /* ignore */ }
}
function ntGroupFull(gid) {
  const gidS = String(gid == null ? '' : gid);
  if (!gidS || !isEnabled()) return Promise.resolve(null);
  return request('GET',
    CONFIG.restBase + CONFIG.tables.notices + '?select=*&id=eq.' + encodeURIComponent(ntAdminRowId(gidS)),
    undefined, headers(false), false, { timeout: 20000 })
    .then(function (list) {
      const r = Array.isArray(list) ? list[0] : null;
      if (!r || !isAutoNoticeRow(r)) return null;
      const g = JSON.parse(String(r.body).slice(AUTO_NOTICE_PREFIX.length));
      if (!g || !g.id) return null;
      g._hidden = !!r.hidden;
      g._override = ntParseOverride(r.override_json);
      g._editedAt = Number(r.edited_at) || 0;
      g._editedBy = String(r.edited_by || '');
      ntPatchCachedGroup(g);
      return g;
    }).catch(function () { return null; });
}

// 统计页查询：从 fromSlot（含）起按时间倒序拉 visits（只有管理员会调用）
function statsPull(fromSlot) {
  if (!isEnabled() || !identity.isAdmin()) return Promise.resolve([]);
  const from = String(fromSlot || '').trim();
  const q = 'select=id,slot,sid,name,ts,client&slot=gte.' + encodeURIComponent(from) + '&order=ts.desc&limit=5000';
  return request('GET', CONFIG.restBase + CONFIG.tables.visits + '?' + q, undefined, headers(false))
    .then(function (list) { return Array.isArray(list) ? list : []; })
    .catch(function () { return []; });
}

// ---------------------------------------------------------------- 宿舍电费（public.power / public.power_history，RLS auth_ok）
// 与网站 POWER v3.1 同契约：
//   power        按 id=eq.<roomverify> 单行 { id,label,building,room,quantity,unit,low,updated_at }
//   power_history 按趋势区间（24h/7d/30d）拉 { ts,quantity }：
//                select=ts,quantity&roomverify=eq.<rv>&ts=gte.<now-range.ms>&order=ts.asc&limit=2000
// 每区间 5 分钟缓存（切换区间时缓存未过期则不请求）；只有「已关注宿舍」才请求，未选择时页面 0 请求。
// 2026-11-11 增量 43：14d/70d 仅用于「电费比较」自然周期同期取数（隐藏窗口，不出现在区间按钮）
var POWER_RANGE_MS = { '24h': 24 * 3600e3, '7d': 7 * 24 * 3600e3, '30d': 30 * 24 * 3600e3, '14d': 14 * 24 * 3600e3, '70d': 70 * 24 * 3600e3 };
const POWER_HIST_TTL = 5 * 60 * 1000;
var _powerCache = null;            // { rv, row, at }（当前电量 2 分钟 TTL，与网站 TTL.power 一致）
var _powerHistCache = {};          // rv -> { range: { list, at } }
function powerHistCached(rv, range) {
  rv = String(rv == null ? '' : rv);
  range = POWER_RANGE_MS[range] ? range : '24h';
  const bucket = _powerHistCache[rv];
  const c = bucket && bucket[range];
  if (!c || Date.now() - c.at >= POWER_HIST_TTL) return null;
  return c.list;
}
function powerHistFresh(rv, range) { return !!powerHistCached(rv, range); }
// 工作台卡片用：读取当前电量 2 分钟缓存（同 rv 且未过期），不发请求
function powerCached(rv) {
  rv = String(rv == null ? '' : rv);
  if (!rv || !_powerCache || _powerCache.rv !== rv) return null;
  if (Date.now() - _powerCache.at >= TTL.power) return null;
  return _powerCache.row;
}
function powerRoom(rv, force) {
  rv = String(rv == null ? '' : rv);
  if (!rv || !identity.has() || !isEnabled()) return Promise.resolve(null);
  if (!force && _powerCache && _powerCache.rv === rv && Date.now() - _powerCache.at < TTL.power) return Promise.resolve(_powerCache.row);  const q = 'select=id,label,building,room,quantity,unit,low,updated_at&id=eq.' + encodeURIComponent(rv);
  return request('GET', CONFIG.restBase + CONFIG.tables.power + '?' + q, undefined, headers(false))
    .then(function (list) {
      const row = Array.isArray(list) ? (list[0] || null) : null;
      _powerCache = { rv: rv, row: row, at: Date.now() };
      touchSync('power');
      return row;
    })
    .catch(function () { return null; });
}
// range = '24h' | '7d' | '30d'；force=true 跳过 5 分钟缓存
// 2026-11-06 修复（用户反馈：进入电费页趋势卡偶发「数据积累中」/空态，手动刷新才出图）：
//   网络失败被 `.catch(() => [])` 静默吞掉、HTTP 200 空数组也被统一当作 []，旧实现把 **空数组** 写进
//   `_powerHistCache` 并保留 5 分钟 → 之后 5 分钟内每次进页 / 切区间都命中空缓存（0 请求、趋势一直空），
//   只有手动刷新（force=true 绕过缓存）才恢复。现在只有**非空**结果写缓存：空结果/失败不缓存，
//   下次进入或页面自动静默重试时能重新请求（不再毒化；force 语义不变，请求契约不变）。
function powerHistory(rv, range, force) {
  rv = String(rv == null ? '' : rv);
  range = POWER_RANGE_MS[range] ? range : '24h';
  if (!rv || !identity.has() || !isEnabled()) return Promise.resolve([]);
  const cached = powerHistCached(rv, range);
  if (!force && cached) return Promise.resolve(cached);
  const cut = new Date(Date.now() - POWER_RANGE_MS[range]).toISOString();
  const q = 'select=ts,quantity&roomverify=eq.' + encodeURIComponent(rv) +
    '&ts=gte.' + encodeURIComponent(cut) + '&order=ts.asc&limit=2000';
  return request('GET', CONFIG.restBase + CONFIG.tables.powerHistory + '?' + q, undefined, headers(false))
    .then(function (list) {
      const arr = Array.isArray(list) ? list : [];
      if (arr.length) {                       // 空数组不写 5 分钟缓存（避免毒化后续进入/自动重试）
        _powerHistCache[rv] = _powerHistCache[rv] || {};
        _powerHistCache[rv][range] = { list: arr, at: Date.now() };
        touchSync('powerHist');
      }
      return arr;
    })
    .catch(function () { return []; });       // 失败静默（页面据此判断是否自动重试一次），同样不写缓存
}
// 并行拉当前行 + 24h + 7d + 当前所选档（30d）：估算需要 24h+7d 两档历史；各档 5 分钟缓存
// 返回 { ok,row,hist,hist24,hist7,rv,range }（hist = 当前档；24h/7d 档时即同一份）
function powerPull(rv, range, force) {
  rv = String(rv == null ? '' : rv);
  range = POWER_RANGE_MS[range] ? range : '24h';
  if (!rv || !identity.has() || !isEnabled()) {
    return Promise.resolve({ ok: false, reason: identity.has() ? '未连接云端' : '请先完成身份验证', row: null, hist: [], hist24: [], hist7: [], rv: rv, range: range });
  }
  const p24 = powerHistory(rv, '24h', !!force);
  const p7 = powerHistory(rv, '7d', !!force);
  const pActive = range === '24h' ? p24 : (range === '7d' ? p7 : powerHistory(rv, range, !!force));
  return Promise.all([powerRoom(rv, !!force), p24, p7, pActive]).then(function (r) {
    return { ok: !!r[0], row: r[0], hist24: r[1], hist7: r[2], hist: r[3], rv: rv, range: range };
  });
}

// ---------------------------------------------------------------- 诊断（public.service_health，RLS 2026-11-08 放宽到 auth_ok）
// 2026-11-08 诊断 v2：**所有有效班级身份可读**（不再要求管理员；无身份仍不请求）。
// 返回 { ok, latency, list, error }：latency = 本次请求耗时（页面用于覆盖 cloudbase 行状态）。
function serviceHealth() {
  if (!identity.has() || !isEnabled()) {
    return Promise.resolve({ ok: false, latency: 0, list: [], error: identity.has() ? 'cloud-disabled' : 'forbidden' });
  }
  const t0 = Date.now();
  const q = 'select=id,name,kind,status,detail,meta,checked_at&order=id';
  return request('GET', CONFIG.restBase + CONFIG.tables.serviceHealth + '?' + q, undefined, headers(false))
    .then(function (list) {
      return { ok: true, latency: Date.now() - t0, list: Array.isArray(list) ? list : [], error: '' };
    })
    .catch(function (e) {
      return { ok: false, latency: Date.now() - t0, list: [], error: String((e && (e.message || e.errMsg)) || e || 'network') };
    });
}

// ---------------------------------------------------------------- 诊断 v2（2026-11-08）
// RPC 调用基座：PostgREST POST {restBase}rpc/<name>（带 publishableKey + X-Class-Token；body 是命名参数对象）。
// 返回 { ok, data, latency, error }；jsonb 函数可能回对象，也可能回单元素数组 → 统一取对象。
function rpcCall(pathName, body) {
  if (!identity.has() || !isEnabled()) {
    return Promise.resolve({ ok: false, latency: 0, data: null, error: identity.has() ? 'cloud-disabled' : 'forbidden' });
  }
  const t0 = Date.now();
  return request('POST', CONFIG.restBase + pathName, body || {}, headers(false))
    .then(function (d) {
      let r = d;
      if (Array.isArray(r)) r = r[0] || null;
      return { ok: true, latency: Date.now() - t0, data: r, error: '' };
    })
    .catch(function (e) {
      return { ok: false, latency: Date.now() - t0, data: null, error: String((e && (e.message || e.errMsg)) || e || 'network') };
    });
}
// 本机 agent 在线状态（契约 §1：{ok,online,seen_at,host,version}；全班可读）
function diagAgentInfo() {
  return rpcCall(CONFIG.rpc.diagAgent, {}).then(function (r) {
    const d = (r && r.data) || {};
    return {
      ok: !!(r && r.ok && d && d.ok !== false), online: !!(d && d.online),
      seen_at: Number(d && d.seen_at) || 0, host: String((d && d.host) || ''), version: String((d && d.version) || ''),
      error: (r && r.error) || ''
    };
  });
}
// AI 分析结论（契约 §2：GET diag_analysis?select=*&order=ts.desc&limit=20）
// 失败返回 null（页面保留上次数据，10s 轮询的瞬时失败不把 AI 行闪没）
function diagAnalyses() {
  if (!identity.has() || !isEnabled()) return Promise.resolve([]);
  const q = 'select=*&order=ts.desc&limit=20';
  return request('GET', CONFIG.restBase + CONFIG.tables.diagAnalysis + '?' + q, undefined, headers(false))
    .then(function (list) { return Array.isArray(list) ? list : []; })
    .catch(function () { return null; });
}
// 本机自动修复任务/记录（契约 §2：GET repair_tasks?select=*&order=created_at.desc&limit=20）
// 失败返回 null（页面保留上次数据）
function diagRepairs() {
  if (!identity.has() || !isEnabled()) return Promise.resolve([]);
  const q = 'select=*&order=created_at.desc&limit=20';
  return request('GET', CONFIG.restBase + CONFIG.tables.repairTasks + '?' + q, undefined, headers(false))
    .then(function (list) { return Array.isArray(list) ? list : []; })
    .catch(function () { return null; });
}
// 设备诊断上报（契约 §2）：POST client_diag 数组（行内字段由 utils/diag.js buildReportRows 生成）。
// 说明：cloud 迁移 cd_insert 策略要求行内 sid = auth_sid()，因此这里补 sid = 当前身份学号
// （不是新增隐私字段：服务端本来就由 token 得到同一 sid，且 RLS 强制相等）。
function diagReport(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter(function (r) { return r && r.id; }).slice(0, 3);
  if (!identity.has()) return Promise.resolve({ ok: false, count: 0, error: 'identity-required' });
  if (!isEnabled()) return Promise.resolve({ ok: false, count: 0, error: 'cloud-disabled' });
  if (!list.length) return Promise.resolve({ ok: true, count: 0, error: '' });
  const sid = currentSid();
  const body = list.map(function (r) { return Object.assign({}, r, { sid: sid }); });
  return request('POST', CONFIG.restBase + CONFIG.tables.clientDiag, body, headers(false))
    .then(function () { return { ok: true, count: body.length, error: '' }; })
    .catch(function (e) { return { ok: false, count: 0, error: String((e && (e.message || e.errMsg)) || e || 'network') }; });
}
// 云端网关延迟 + site_assets 可用性 + 服务端时间（设备诊断卡用）：一次轻量 GET。
// 2026-11-09 诊断 v2.1：额外从响应头 Date 取服务端时间 → 页面算 clockSkewMs（§B 白名单字段）。
// 这里用 wx.request 原始通道（request() 只回 data 拿不到响应头）；失败静默，由页面判为网关异常。
function diagPing() {
  if (!identity.has() || !isEnabled()) {
    return Promise.resolve({ ok: false, latency: 0, siteAssets: false, serverTime: 0, error: 'identity-required' });
  }
  const t0 = Date.now();
  const q = 'select=id&id=eq.tt';
  return new Promise(function (resolve) {
    let done = false;
    const fin = function (v) { if (done) return; done = true; resolve(v); };
    const parseServerTime = function (res) {
      try {
        const h = (res && res.header) || {};
        const dv = h.Date || h.date;
        if (dv) { const t = Date.parse(dv); if (isFinite(t)) return t; }
      } catch (e) { /* 忽略响应头解析失败 */ }
      return 0;
    };
    try {
      wx.request({
        url: CONFIG.restBase + CONFIG.tables.siteAssets + '?' + q,
        method: 'GET',
        header: headers(false),
        timeout: CONFIG.timeout,
        success: function (res) {
          const sc = (res && res.statusCode) || 0;
          const serverTime = parseServerTime(res);
          if (sc >= 200 && sc < 300) {
            fin({ ok: true, latency: Date.now() - t0, siteAssets: Array.isArray(res.data) && res.data.length > 0, serverTime: serverTime, error: '' });
          } else {
            fin({ ok: false, latency: Date.now() - t0, siteAssets: false, serverTime: serverTime, error: 'http' + sc });
          }
        },
        fail: function (err) {
          fin({ ok: false, latency: Date.now() - t0, siteAssets: false, serverTime: 0, error: String((err && (err.errMsg || err.message)) || err || 'network') });
        }
      });
    } catch (e) {
      fin({ ok: false, latency: 0, siteAssets: false, serverTime: 0, error: String((e && e.message) || e) });
    }
  });
}
// 课表登录（契约 §4）：enqueue 密码只在本机内存 → 云端只落 PGP 密文；客户端不保存密码。
function ttLoginEnqueue(pwd) {
  const p = String(pwd == null ? '' : pwd);
  if (!p) return Promise.resolve({ ok: false, reason: 'pwd' });
  return rpcCall(CONFIG.rpc.ttLoginEnqueue, { p_pwd: p, p_platform: 'mp' }).then(function (r) {
    const d = (r && r.data) || {};
    if (!r || !r.ok) return { ok: false, reason: (d && d.reason) || 'network' };
    if (d && d.ok === false) return { ok: false, reason: d.reason || 'failed' };
    return { ok: true, job_id: String((d && d.job_id) || ''), reused: !!(d && d.reused) };
  });
}
function ttLoginStatus(jobId) {
  const id = String(jobId || '');
  if (!id) return Promise.resolve({ ok: false, reason: 'p_id' });
  return rpcCall(CONFIG.rpc.ttLoginStatus, { p_id: id }).then(function (r) {
    const d = (r && r.data) || {};
    if (!r || !r.ok) return { ok: false, reason: 'network' };
    if (d && d.ok === false) return { ok: false, reason: d.reason || 'failed' };
    return {
      ok: true,
      status: String((d && d.status) || ''),
      finished: Number(d && d.finished) || 0,
      error: String((d && d.error) || ''),
      result: (d && d.result) || null
    };
  });
}

// ---------------------------------------------------------------- 水量共享（2026-11-11，需求 6）
// 唯一契约 web/tools/tests/_water_shared_contract.md §2：全部复用统一 request 通道
// （Authorization: Bearer <publishableKey> + X-Class-Token；不新增外部请求来源、不打印 token）。
// 返回统一 { ok, ... }：失败不 throw（页面保留本机缓存 + 离线待补发，恢复后重试）。
//   GET    water?select=roomverify,month,reading,persons&roomverify=eq.<rv>&order=month.asc
//   POST   water?on_conflict=roomverify,month  Prefer: resolution=merge-duplicates,return=minimal
//   DELETE water?roomverify=eq.<rv>&month=eq.<YYYY-MM>
//   GET    water_room?select=roomverify,persons&roomverify=eq.<rv>
//   POST   water_room?on_conflict=roomverify  {roomverify,persons}
const _waterAt = {};               // rv → 上次成功 GET 时间（TTL 60s，避免每次 onShow 重复拉）
function _waterUrl(table, query) { return CONFIG.restBase + table + (query ? '?' + query : ''); }
function waterList(rv, force) {
  const key = String(rv == null ? '' : rv).trim();
  if (!key) return Promise.resolve({ ok: false, reason: 'no-room', rows: [] });
  if (!identity.has() || !isEnabled() || udOff()) return Promise.resolve({ ok: false, reason: 'offline', rows: [] });
  const at = _waterAt[key] || 0;
  if (!force && at && (Date.now() - at) < TTL.water) return Promise.resolve({ ok: true, cached: true, rows: [] });
  return request('GET', _waterUrl(CONFIG.tables.water,
    'select=roomverify,month,reading,persons&roomverify=eq.' + encodeURIComponent(key) + '&order=month.asc'),
  undefined, headers(false)).then(function (rows) {
    _waterAt[key] = Date.now();
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  }).catch(function (e) {
    return { ok: false, reason: String((e && e.message) || e || 'network'), rows: [] };
  });
}
function waterUpsert(rv, month, reading, persons) {
  const key = String(rv == null ? '' : rv).trim();
  const p = String(month == null ? '' : month).trim();
  const r = Number(reading);
  if (!key || !/^\d{4}-(0[1-9]|1[0-2])$/.test(p) || !isFinite(r)) return Promise.resolve({ ok: false, reason: 'bad-args' });
  if (!identity.has() || !isEnabled() || udOff()) return Promise.resolve({ ok: false, reason: 'offline' });
  const row = { roomverify: key, month: p, reading: waterUtil.round2(r), persons: waterUtil.normPersons(persons) };
  return request('POST', _waterUrl(CONFIG.tables.water, 'on_conflict=roomverify,month'), row,
    headerOf({ Prefer: 'resolution=merge-duplicates,return=minimal' }))
    .then(function () { _waterAt[key] = Date.now(); return { ok: true }; })
    .catch(function (e) { return { ok: false, reason: String((e && e.message) || e || 'network') }; });
}
function waterDelete(rv, month) {
  const key = String(rv == null ? '' : rv).trim();
  const p = String(month == null ? '' : month).trim();
  if (!key || !p) return Promise.resolve({ ok: false, reason: 'bad-args' });
  if (!identity.has() || !isEnabled() || udOff()) return Promise.resolve({ ok: false, reason: 'offline' });
  return request('DELETE', _waterUrl(CONFIG.tables.water,
    'roomverify=eq.' + encodeURIComponent(key) + '&month=eq.' + encodeURIComponent(p)),
  undefined, headerOf({ Prefer: 'return=minimal' }))
    .then(function () { _waterAt[key] = Date.now(); return { ok: true }; })
    .catch(function (e) { return { ok: false, reason: String((e && e.message) || e || 'network') }; });
}
function waterRoomGet(rv) {
  const key = String(rv == null ? '' : rv).trim();
  if (!key) return Promise.resolve({ ok: false, reason: 'no-room', persons: null });
  if (!identity.has() || !isEnabled() || udOff()) return Promise.resolve({ ok: false, reason: 'offline', persons: null });
  return request('GET', _waterUrl(CONFIG.tables.waterRoom,
    'select=roomverify,persons&roomverify=eq.' + encodeURIComponent(key)),
  undefined, headers(false)).then(function (rows) {
    const row = Array.isArray(rows) ? rows[0] : rows;
    return { ok: true, persons: waterUtil.roomPersonsOf(row) };
  }).catch(function (e) { return { ok: false, reason: String((e && e.message) || e || 'network'), persons: null }; });
}
function waterRoomUpsert(rv, persons) {
  const key = String(rv == null ? '' : rv).trim();
  if (!key) return Promise.resolve({ ok: false, reason: 'bad-args' });
  if (!identity.has() || !isEnabled() || udOff()) return Promise.resolve({ ok: false, reason: 'offline' });
  const row = { roomverify: key, persons: waterUtil.fixedPersons(key, persons) };
  return request('POST', _waterUrl(CONFIG.tables.waterRoom, 'on_conflict=roomverify'), row,
    headerOf({ Prefer: 'resolution=merge-duplicates,return=minimal' }))
    .then(function () { return { ok: true }; })
    .catch(function (e) { return { ok: false, reason: String((e && e.message) || e || 'network') }; });
}
function waterForceFresh(rv) { const key = String(rv || ''); const at = _waterAt[key] || 0; return at > 0 && (Date.now() - at) < TTL.water; }

// ---------------------------------------------------------------- 投票（2026-11-11，契约 web/vote/CONTRACT.md §2）
// 5 个 poll_* RPC 全部复用上面的 rpcCall 通道（POST {restBase}rpc/<name>，
// header 统一由 headerOf 生成：Authorization: Bearer <publishableKey> + X-Class-Token），
// **不新增请求通道、不打印任何 token/body**。
// 返回统一 { ok, reason, ... }：ok=false 时 reason 一律是可直接 wx.showToast 的中文；
// RPC 成功（HTTP 200）但 jsonb 内 {ok:false,reason} → 原样透传云端中文原因。
const POLL_NET_ERR = '网络不可用，稍后重试';
// 传输层错误 → 中文 reason；成功返回 ''
function pollTransportReason(r) {
  if (r && r.ok === true) return '';
  const err = String((r && r.error) || '');
  if (err === 'forbidden') return '请先完成身份验证';
  if (err === 'cloud-disabled') return '云端未连接';
  return POLL_NET_ERR;
}
// 统一取出 RPC 成功返回的 jsonb；失败返回 {ok:false,reason}，成功返回 null（由调用方拼装）
function pollReply(r) {
  const reason = pollTransportReason(r);
  if (reason) return { ok: false, reason: reason };
  const d = r.data;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, reason: POLL_NET_ERR };
  if (d.ok === false) return { ok: false, reason: String(d.reason || '操作失败') };
  return null;
}
// 可见人范围参数（契约 §1.6，2026-11-11 18:08 增量）：非 custom 恒 []；归一/校验在 utils/vote.js + 服务端。
// 旧页面不传 audience → 'all'（后端默认值等价）；只在显式传入时由 pollManage 发送（旧版兼容：不传 = 不修改）。
const POLL_AUD = ['all', 'committee', 'league', 'custom'];
function pollAudienceParams(payload) {
  const p = payload || {};
  const aud = String(p.audience == null ? '' : p.audience);
  const audience = POLL_AUD.indexOf(aud) >= 0 ? aud : 'all';
  const seats = audience !== 'custom' ? [] : (Array.isArray(p.audienceSeats) ? p.audienceSeats : [])
    .map(Number).filter(function (n) { return isFinite(n); });
  return { audience: audience, seats: seats };
}
// 发起：payload 由 utils/vote.js buildPayload() 生成
// （id/title/description/mode/options/settings/deadline/audience/audienceSeats）
function pollCreate(payload) {
  const p = payload || {};
  const aud = pollAudienceParams(p);
  const body = {
    p_id: String(p.id == null ? '' : p.id),
    p_title: String(p.title == null ? '' : p.title),
    p_description: String(p.description == null ? '' : p.description),
    p_mode: p.mode === 'long' ? 'long' : 'quick',
    p_options: Array.isArray(p.options) ? p.options : [],
    p_settings: (p.settings && typeof p.settings === 'object') ? p.settings : {},
    p_deadline: Math.max(0, Math.round(Number(p.deadline) || 0)),
    // 可见范围（§1.6）：新客户端总是显式传；all/committee/league 时座号恒 []
    p_audience: aud.audience,
    p_audience_seats: aud.seats
  };
  if (!body.p_id || !body.p_title) return Promise.resolve({ ok: false, reason: '投票参数不完整', poll: null });
  return rpcCall(CONFIG.rpc.pollCreate, body).then(function (r) {
    const bad = pollReply(r);
    if (bad) return Object.assign({ poll: null }, bad);
    return Object.assign({ ok: true, reason: '' }, r.data);
  });
}
// 列表：{ ok, now, polls[] }（失败时保留空列表，页面自行保留上次数据）
function pollList() {
  return rpcCall(CONFIG.rpc.pollList, {}).then(function (r) {
    const bad = pollReply(r);
    if (bad) return { ok: false, reason: bad.reason, now: Date.now(), polls: [] };
    const d = r.data;
    return {
      ok: true, reason: '',
      now: Number(d.now) || Date.now(),
      polls: Array.isArray(d.polls) ? d.polls : []
    };
  });
}
// 详情：{ ok, now, poll, closed, total, counts, has_voted, my_choices, results_hidden, mine, can_manage, voters }
function pollDetail(id) {
  const pid = String(id == null ? '' : id);
  if (!pid) return Promise.resolve({ ok: false, reason: '缺少投票参数', poll: null });
  return rpcCall(CONFIG.rpc.pollDetail, { p_id: pid }).then(function (r) {
    const bad = pollReply(r);
    if (bad) return Object.assign({ poll: null }, bad);
    return Object.assign({ ok: true, reason: '' }, r.data);
  });
}
// 投票/改票：choices = 选项 id 数组；成功返回与 poll_detail 相同结构（含最新 counts）
function pollSubmit(id, choices) {
  const pid = String(id == null ? '' : id);
  if (!pid) return Promise.resolve({ ok: false, reason: '缺少投票参数', poll: null });
  const body = { p_id: pid, p_choices: (Array.isArray(choices) ? choices : []).map(String) };
  return rpcCall(CONFIG.rpc.pollSubmit, body).then(function (r) {
    const bad = pollReply(r);
    if (bad) return Object.assign({ poll: null }, bad);
    return Object.assign({ ok: true, reason: '' }, r.data);
  });
}
// 管理（契约 §2.4）：payload = { id, action:'edit'|'close'|'extend'|'delete', title?, description?, options?, settings?, deadline?, audience?, audienceSeats? }
// deadline 传 0 = 改为不限时；不传（undefined）= 不修改。edit 要求同时传 title/options/settings/deadline。
// audience：不传（undefined）= 不修改可见范围（旧版页面兼容）；传 all|committee|league|custom = 修改
//（custom 需同时传 audienceSeats 座号数组）。
function pollManage(payload) {
  const p = payload || {};
  const pid = String(p.id == null ? '' : p.id);
  const action = String(p.action == null ? '' : p.action);
  if (!pid || ['edit', 'close', 'extend', 'delete'].indexOf(action) < 0) {
    return Promise.resolve({ ok: false, reason: '管理参数不完整', poll: null });
  }
  const body = { p_id: pid, p_action: action };
  if (p.title !== undefined) body.p_title = String(p.title == null ? '' : p.title);
  if (p.description !== undefined) body.p_description = String(p.description == null ? '' : p.description);
  if (p.options !== undefined) body.p_options = Array.isArray(p.options) ? p.options : null;
  if (p.settings !== undefined) body.p_settings = (p.settings && typeof p.settings === 'object') ? p.settings : null;
  if (p.deadline !== undefined) body.p_deadline = Math.max(0, Math.round(Number(p.deadline) || 0));
  // 可见范围（§1.6）：只有显式传入才发送，未传时服务端保持原范围（旧版页面 / 旧缓存兼容）
  if (p.audience !== undefined) {
    const aud = pollAudienceParams(p);
    body.p_audience = aud.audience;
    body.p_audience_seats = aud.seats;
  }
  return rpcCall(CONFIG.rpc.pollManage, body).then(function (r) {
    const bad = pollReply(r);
    if (bad) return Object.assign({ poll: null }, bad);
    return Object.assign({ ok: true, reason: '' }, r.data);
  });
}

// ---------------------------------------------------------------- 课表（2026-11-07 起：CloudBase 快照优先 + 旧 tt.json legacy 兜底）
// 数据源顺序（见 web/tools/tests/dns_pause_tt_health_spec.md §4「mp 特有」）：
//   1) CloudBase public.site_assets（id='tt'，2026-11-07 新增）：GET ?select=body,meta&id=eq.tt，
//      走统一 request 通道（Authorization: Bearer <publishableKey> + X-Class-Token）；
//      body 可能是 JSON 字符串，需 parse；必须是 {c:[...]}（与旧 tt.json 同构，可带 t/meta）；
//   2) 上一步失败（网络 / 404 / 空行 / 格式错 / 旧配置没有 tables.siteAssets）→ 回退 legacy CONFIG.ttUrl：
//      wx.request GET，**不带身份头**（避免把班级 token 发到非 CloudBase 域名）；
//   3) 两者都失败 → reject（调用方 catch 后保留本机缓存，不阻塞页面）。
// 身份守卫 / 云开关 / cloudOff / 6h TTL 缓存命中（TTL 内 0 请求）语义保持不变。
// 旧工具页/测试仍只认 {c,t,meta}，云快照 body 直接返回、结构同构。
function ttCloudFetch() {
  const table = CONFIG.tables && CONFIG.tables.siteAssets;
  if (!table) return Promise.reject(new Error('tt-cloud-no-table'));
  const q = 'select=body,meta&id=eq.tt';
  return request('GET', CONFIG.restBase + table + '?' + q, undefined, headers(false))
    .then(function (list) {
      const row = Array.isArray(list) ? (list[0] || null) : null;
      if (!row) throw new Error('tt-cloud-missing');
      let body = row.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
      if (!body || !Array.isArray(body.c)) throw new Error('tt-cloud-bad-body');
      return body;
    });
}
// legacy：站点静态 tt.json，只读公开文件，不携带身份 token；仍然要求本机有身份才允许请求（见 ttFetch 顶部守卫）。
function ttLegacyFetch() {
  const url = CONFIG.ttUrl;
  if (CONFIG.ttLegacy === false) return Promise.reject(new Error('tt-legacy-off'));
  if (!url) return Promise.reject(new Error('tt-disabled'));
  return new Promise(function (resolve, reject) {
    wx.request({
      url: url,
      method: 'GET',
      timeout: CONFIG.timeout,
      success: function (res) {
        if (res && res.statusCode === 200) resolve(res.data);
        else reject(new Error('http' + ((res && res.statusCode) || 0)));
      },
      fail: function (err) { reject(err || new Error('network')); }
    });
  });
}
function ttFetch(force) {
  if (!identity.has()) return Promise.reject(new Error('identity-required'));
  if (!isEnabled()) return Promise.reject(new Error('cloud-disabled'));
  if (udOff()) return Promise.reject(new Error('cloud-off'));
  // 6h TTL：课表每 30s/每次进页都重拉没有意义；命中时用本机 ttCache 快照（与上次返回同构）
  if (!force && syncFresh('tt', TTL.tt)) {
    const c = store.get().ttCache;
    if (c && Array.isArray(c.c)) return Promise.resolve({ c: c.c, t: c.t || '', meta: c.meta || null });
  }
  return ttCloudFetch().then(function (body) {
    touchSync('tt');
    return body;
  }).catch(function () {
    return ttLegacyFetch().then(function (data) {
      touchSync('tt');
      return data;
    });
  });
}

// ---------------------------------------------------------------- 一次性拉取
// force = 下拉刷新 / 手动同步：跳过 TTL 等待（通知表仍先做签名校验，见 ntSync）。
// 30s 轮询走 force=false：TTL 内 0 请求，过期表才刷新。
// v19：加入用户数据 v6 双向同步 udSync（TTL 60s；force 立即；cloudOff 时整体短路，不拉不推）。
function cloudPull(force) {
  if (!isEnabled()) return Promise.resolve({ off: true });
  if (!identity.has()) return Promise.resolve({ off: false, identity: false });
  if (udOff()) return Promise.resolve({ off: true, cloudOff: true });
  // 背景轮询退避：刚连续失败过就不在 30s 定时器里反复打同一批请求；
  // force（下拉刷新/手动同步/页面 onShow）始终放行，保证用户主动操作能立即重试。
  if (!force && NET.retryAt && Date.now() < NET.retryAt) {
    return Promise.resolve({ skipped: true, retryAt: NET.retryAt });
  }
  return Promise.all([
    marksPull(force), fitPull(force), hwPull(force), ntPull(force), ensureMembers(!!force), udSync(!!force)
  ]).then(function (r) {
    flushPending();
    return { marks: r[0], fit: r[1], homework: r[2], notices: r[3], members: r[4], ud: r[5] };
  });
}

// 状态栏文案
function syncText() {
  const id = identity.get();
  const t = new Date();
  const hh = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2);
  if (udOff()) return (id ? id.name + ' · ' : '') + '仅本机 · ' + hh;
  const cloud = (NET.hw && NET.nt) ? '云端已同步' : ((NET.hw || NET.nt || NET.ud) ? '云端部分连通' : '离线 · 本地缓存');
  let s = (id ? id.name + ' · ' : '未验证身份 · ') + (id ? cloud : '本地');
  s += ' · ' + hh;
  const p = pendCount();
  if (p) s += ' · 待补发 ' + p;
  return s;
}
function netState() {
  const id = identity.get();
  return {
    enabled: isEnabled(), verified: !!id, sid: id ? id.sid : '', name: id ? id.name : '',
    admin: !!(id && id.is_admin), members: memberCount(),
    hw: NET.hw, nt: NET.nt, ud: NET.ud, pending: pendCount(),
    // 2026-11-18：页面据此显示「缓存 / 离线」，不再在断网时误报「云端已同步」
    cached: !!NET.ntCached,
    offline: !!(NET.lastFail && NET.lastFail > NET.lastOk),
    lastOk: NET.lastOk, lastFail: NET.lastFail
  };
}

module.exports = {
  CONFIG: CONFIG, configure: configure, isEnabled: isEnabled, isReadyForSync: isReadyForSync,
  // 2026-11-18 自建后端切流 / 网络体验优化（只读探针/统计；页面不依赖，测试与诊断用）
  restInfo: restInfo, netStats: netStats, netReset: netReset, timeoutOf: timeoutOf,
  TTL: TTL, cache: cache,
  currentSid: currentSid, currentName: currentName, isAdmin: isAdmin,
  cbGet: cbGet, cbPost: cbPost, cbPatch: cbPatch, cbById: cbById, cbUpsert: cbUpsert, cbId: cbId,
  cbDelete: cbDelete, cbUpsertMany: cbUpsertMany,
  classVerify: classVerify, classMembersPull: classMembersPull,
  members: members, memberCount: memberCount, committee: committee, memberName: memberName,
  league: league, leaguePull: leaguePull, classSetRole: classSetRole,
  clearClassData: clearClassData, ensureMembers: ensureMembers,
  marksPull: marksPull, marksFresh: marksFresh, setMark: setMark, pendCount: pendCount, flushPending: flushPending,
  fitPush: fitPush, fitPull: fitPull, fitDelete: fitDelete,
  hwPull: hwPull, hwPublish: hwPublish, hwArchive: hwArchive, pruneHomework: pruneHomework,
  ntPull: ntPull, ntAutoPull: ntAutoPull, ntGroupFull: ntGroupFull, ntPublish: ntPublish, ntArchive: ntArchive,
  ntAdminEdit: ntAdminEdit, ntAdminHide: ntAdminHide, ntAdminRowId: ntAdminRowId,
  ntParseOverride: ntParseOverride, ntVisible: ntVisible, ntSigOf: ntSigOf,
  canDelete: canDelete,
  udBlob: udBlob, udApply: udApply, udPush: udPush, pushPrefs: pushPrefs, udSync: udSync,
  // 通用 RPC 通道（2026-11-12 抽签存证起对外复用；utils/drawproof.js 用它发 draw_record_*，
  // header 仍由 headerOf 统一生成：Bearer <publishableKey> + X-Class-Token）。
  rpcCall: rpcCall,
  resolveUseCloud: resolveUseCloud, resolveUseLocal: resolveUseLocal,
  // 用户数据 v6 双向同步（v19，契约 CONTRACT §3/§5.2）
  mergeUd: mergeUd, udSections: udSections, udPull: udPull, udPushSoon: udPushSoon, udTouch: udTouch,
  udOff: udOff, udPendingCount: udPendingCount, udStatus: udStatus, setCloudOff: setCloudOff,  udHold: udHold, udHoldUntil: udHoldUntil,
  udClearCloud: udClearCloud, udStop: udStop, udFlush: udFlush,
  fbSend: fbSend, fbPull: fbPull, fbDone: fbDone,
  visitLog: visitLog, statsPull: statsPull, ttFetch: ttFetch,
  powerRoom: powerRoom, powerCached: powerCached, powerHistory: powerHistory, powerPull: powerPull,
  powerHistCached: powerHistCached, powerHistFresh: powerHistFresh, serviceHealth: serviceHealth,
  // 2026-11-08 诊断 v2 + 课表登录（契约 _diag_task/CONTRACT.md §1/§2/§4）
  diagAgentInfo: diagAgentInfo, diagAnalyses: diagAnalyses, diagRepairs: diagRepairs,
  diagReport: diagReport, diagPing: diagPing,
  ttLoginEnqueue: ttLoginEnqueue, ttLoginStatus: ttLoginStatus,
  // 2026-11-11 投票（契约 web/vote/CONTRACT.md §2；页面见 pages/vote、votedetail）
  pollCreate: pollCreate, pollList: pollList, pollDetail: pollDetail,
  pollSubmit: pollSubmit, pollManage: pollManage,
  // 2026-11-11 水量共享（契约 web/tools/tests/_water_shared_contract.md §1/§2）
  waterList: waterList, waterUpsert: waterUpsert, waterDelete: waterDelete,
  waterRoomGet: waterRoomGet, waterRoomUpsert: waterRoomUpsert, waterForceFresh: waterForceFresh,
  cloudPull: cloudPull, syncText: syncText, netState: netState
};

