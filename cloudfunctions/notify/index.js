// cloudfunctions/notify —— 微信订阅消息发送
// 模板（2026-11-19 起）：日程提醒（基础信息）—— 日程 thing1 / 时间 time2 / 地点 thing3 / 日程描述 thing5
// 旧模板（温馨提示 thing2 / 时间 time1 / 摘要 thing3 / 日期 time26）仅为「未更新客户端」保留兼容发送。
// 前端只负责 requestSubscribeMessage 授权；本函数负责保存 openid 与发送。
// 支持 kind：hw（作业截止提醒）、nt（下一条通知）、ntremind（单条通知提醒）。
//
// 模板选择（2026-11-19）：
//   * 新客户端订阅时把本次授权的模板 ID 写入 tmplId（= 新模板）；发送按该模板形状组装字段；
//   * 旧订阅行没有 tmplId = 旧客户端（授权的是旧模板）→ 继续用旧模板 + 旧字段发送；
//   * 因此云函数可以先上线、小程序后发布：旧客户端的提醒不中断，新客户端发布后自动切换到新模板。
//
// 2026-11-11 需求 11（「开启新通知提醒后收不到」根治）：
//   * kind='nt' 订阅此前只由 action='publishNotice' 消费，但全仓库没有任何调用方 → 永不发送；
//   * 现在 timer 里用 PostgREST 轮询 notices 轻量签名（与小程序端同一 CloudBase 网关，不新增外部请求来源），
//     发现新通知后向 active 的 kind='nt' 订阅发送；首次运行只记录基线不补发历史；
//   * 轮询需要班级 token：客户端 action='bootstrap' 上报当前班级 token（云函数先调 class_members 校验再存
//     notify_cfg 集合 __notify_cfg 文档）；token 过期由任一小程序客户端再次 bootstrap 刷新；
//   * 支持第二模板 ID：环境变量 NOTIFY_TMPL2 或 rest-config.js；授权时请求模板数组，发送按 row.tmplId 选择，
//     第二模板发送失败自动回落默认模板（未配置第二模板时行为与旧版完全一致）；
//   * action='ntStatus'（客户端按钮反馈：云端 active 数 / 本人状态）、action='diag' 增加 notify 扫描诊断；
//   * 红线：不返回/不打印 token、openid、通知全文；扫描失败只记录脱敏 lastError。
const https = require('https');
const cloud = require('wx-server-sdk');
const scan = require('./scan.js');
const REST = require('./rest-config.js');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 新模板「日程提醒」（模板编号 9109）：日程 thing1 / 时间 time2 / 地点 thing3 / 日程描述 thing5
const TEMPLATE_ID = 'ZqIur9lMTUTrbKeTXzirEEtHosvLFm-7sULeBjmyMjk';
// 旧模板「温馨提示」：温馨提示 thing2 / 时间 time1 / 摘要 thing3 / 日期 time26（旧客户端专用，勿删）
const LEGACY_TEMPLATE_ID = 'eYDRJDSTJdRL-gvE0rM8EbuSZX6mA9L2U-UTA8MwSmo';
// 第二模板（可选，历史能力）：环境变量 NOTIFY_TMPL2（推荐，部署时在云函数配置里加）或 rest-config.js 默认值。
// 配置后按新模板字段发送；未配置 = 只用 TEMPLATE_ID（新客户端）。
const TEMPLATE2 = String(process.env.NOTIFY_TMPL2 || REST.secondTmplId || '').trim();
const TEMPLATES = (function () {
  const arr = [TEMPLATE_ID, LEGACY_TEMPLATE_ID];
  if (TEMPLATE2 && arr.indexOf(TEMPLATE2) < 0) arr.push(TEMPLATE2);
  return arr;
})();
const PAGE = { hw: 'pages/hw/hw', nt: 'pages/nt/nt' };
const MINI_STATE = process.env.MINI_STATE || REST.state || 'formal';
const REST_BASE = String(REST.restBase || '');
const REST_KEY = String(REST.publishableKey || '');
const SCAN_MIN_MS = Number(REST.scanMinMs) || 5 * 60 * 1000;
const SCAN_BATCH = 100;                      // 一次扫描最多发送 100 人（函数 3s 超时保护）
const CFG_COLLECTION = 'notify_cfg';         // 云开发数据库集合（仅本云函数读写；存班级 token 供轮询）
const CFG_ID = '__notify_cfg';               // 单文档
// notices 轻量表（与小程序端 ntSigOf 同口径：id/ts/hidden/edited_at 决定签名；title 仅用于通知文案）
const NOTICE_SCAN_Q = 'select=id,ts,title,hidden,edited_at&order=ts.asc,id.asc&archived=eq.false';

const KINDS = ['hw', 'nt', 'ntremind'];
const REMIND_MAX_ACTIVE = 50;              // 同 openid 活跃 ntremind 上限
const REMIND_MIN_LEAD_MS = 60 * 1000;      // 提醒至少提前 60s
const REMIND_MAX_LEAD_MS = 366 * 24 * 3600 * 1000;
const MAX_ATTEMPTS = 3;                    // 发送失败 3 次后置 inactive，避免死循环
const TIMER_BATCH = 20;                    // 函数超时 3s，定时器每批最多处理 20 条
const LIST_LIMIT = 100;
// 2026-11-10 修复：到点超过 6h 的提醒不再发送（定时器曾长时间未运行，避免一上线补发几天前的陈旧消息）
const STALE_MS = 6 * 3600 * 1000;
const HB_ID = '__notify_hb';               // 定时器心跳（诊断用；不含任何个人信息）

let db = null;
function database() {
  if (!db) db = cloud.database();
  return db;
}
async function ensureCollection() {
  try { await database().createCollection('subscriptions'); } catch (e) { /* 已存在 */ }
}
// 定时器心跳：每次 timer() 执行都刷新，用于远程诊断「触发器到底有没有跑」（action='diag' 可读）
async function writeHeartbeat(source) {
  try {
    await database().collection('subscriptions').doc(HB_ID).set({
      data: { ts: Date.now(), source: String(source || 'timer') }
    });
  } catch (e) { /* 心跳失败不影响主流程 */ }
}
function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}
// 与前端 fmt() 一致的上海时区文案：2026年11月6日 08:00（不依赖运行环境时区）
function fmt(ms) {
  const d = new Date((Number(ms) || Date.now()) + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '年' + (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日 ' +
    pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
}
function short(s, n) {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
// 订阅消息点击后的跳转页面（ntremind 带通知组 id）
function pageFor(row) {
  if (row.kind === 'ntremind') {
    return 'pages/nt/nt?gid=' + encodeURIComponent(String(row.ref || ''));
  }
  return PAGE[row.kind] || 'pages/index/index';
}
// 时间字段：微信 time 类型只接受时间/日期文案，不能把任意字符串直接塞进去。
// 依次尝试 dateText（活动/截止时间）→ timeText（提醒时间）→ fmt(fireAt)。
function normalizeTimeText(v, refMs) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})$/);
  if (m) return m[1] + '年' + (+m[2]) + '月' + (+m[3]) + '日 ' + pad2(+m[4]) + ':' + m[5];
  m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?$/);
  if (m) return m[1] + '年' + (+m[2]) + '月' + (+m[3]) + '日 ' + pad2(+(m[4] || 0)) + ':' + (m[5] || '00');
  m = s.match(/^(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})$/);
  if (m) {
    const d = new Date((Number(refMs) || Date.now()) + 8 * 3600 * 1000);
    return d.getUTCFullYear() + '年' + (+m[1]) + '月' + (+m[2]) + '日 ' + pad2(+m[3]) + ':' + m[4];
  }
  // 带时区的 ISO（如 2026-11-06T23:59:00+08:00）走 Date.parse；纯日期已在上面处理，避免被当成 UTC
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const t = Date.parse(s);
    if (!isNaN(t)) return fmt(t);
  }
  return '';
}
function eventTimeOf(row) {
  const fireAt = Number(row.fireAt) || 0;
  const ref = fireAt || Date.now();
  return normalizeTimeText(row.dateText, ref) || normalizeTimeText(row.timeText, ref) || fmt(ref);
}
// 地点：通知页传入的 place 优先（来自通知「地点」段落），没有则用「班级工具」
function placeOf(row) {
  return short((row && row.place) || '班级工具', 20);
}
// 新模板（日程提醒）：日程 / 时间 / 地点 / 日程描述
function scheduleTemplateData(row) {
  const tip = short(row.tip || (row.kind === 'hw' ? '作业截止提醒' : '通知提醒'), 20);
  return {
    thing1: { value: short(row.summary || tip, 20) },
    time2: { value: eventTimeOf(row) },
    thing3: { value: placeOf(row) },
    thing5: { value: short(row.tip || tip, 20) }
  };
}
// 旧模板（2026-11-19 前）：字段与文案逐字节保持原样，旧客户端/旧订阅行继续用
function legacyTemplateData(row) {
  const fireAt = Number(row.fireAt) || 0;
  const timeText = row.timeText || (fireAt ? fmt(fireAt) : '');
  if (row.kind === 'ntremind') {
    return {
      thing2: { value: short('通知提醒', 20) },
      time1: { value: fireAt ? fmt(fireAt) : timeText },
      thing3: { value: short(row.summary || '', 20) },
      time26: { value: row.dateText || (fireAt ? fmt(fireAt) : timeText) }
    };
  }
  return {
    thing2: { value: short(row.tip || (row.kind === 'hw' ? '作业截止提醒' : '新通知'), 20) },
    time1: { value: timeText },
    thing3: { value: short(row.summary || '', 20) },
    time26: { value: row.dateText || timeText }
  };
}
function templateData(row, tplId) {
  return tplId === LEGACY_TEMPLATE_ID ? legacyTemplateData(row) : scheduleTemplateData(row);
}
async function send(row) {
  const wx = cloud.getWXContext();
  const openid = row.openid || wx.OPENID;
  if (!openid) throw new Error('no-openid');
  // 模板选择：row.tmplId 合法 → 用它；没有 tmplId = 旧客户端授权的是旧模板（兼容旧版）。
  const want = String(row.tmplId || '');
  const tplId = (want && TEMPLATES.indexOf(want) >= 0) ? want : LEGACY_TEMPLATE_ID;
  const payload = {
    touser: openid,
    templateId: tplId,
    page: pageFor(row),
    data: templateData(row, tplId),
    miniprogramState: MINI_STATE,
    lang: 'zh_CN'
  };
  try {
    await cloud.openapi.subscribeMessage.send(payload);
    return true;
  } catch (e) {
    // 历史第二模板失败 → 回落新模板（第二模板必须使用新模板字段）；旧模板不回落（旧客户端没有新模板授权）
    if (tplId !== TEMPLATE_ID && tplId !== LEGACY_TEMPLATE_ID) {
      await cloud.openapi.subscribeMessage.send(Object.assign({}, payload, {
        templateId: TEMPLATE_ID,
        data: scheduleTemplateData(row)
      }));
      return true;
    }
    throw e;
  }
}
async function markDone(id) {
  try { await database().collection('subscriptions').doc(id).update({ data: { active: false, sentAt: Date.now() } }); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- 2026-11-11 需求 11：新通知轮询（PostgREST）
// 配置文档 notify_cfg/__notify_cfg（只有云函数可读写）字段见 scan.normCfg；班级 token 由客户端 bootstrap 上报。
async function ensureCfgCollection() {
  try { await database().createCollection(CFG_COLLECTION); } catch (e) { /* 已存在 */ }
}
async function getCfg() {
  try {
    const col = database().collection(CFG_COLLECTION);
    if (!col || !col.doc) return scan.normCfg(null);
    const doc = col.doc(CFG_ID);
    if (!doc || !doc.get) return scan.normCfg(null);
    const r = await doc.get();
    return scan.normCfg(r && r.data ? r.data : null);
  } catch (e) { return scan.normCfg(null); }
}
// 2026-11-15 修复：`doc.set()` 是「整文档替换」，不是「合并更新」。
//   原实现每次 patch 都 set({data:patch})，会清掉未出现在本次 patch 里的字段：
//   ① 客户端 bootstrap 写入 token 后，第一次 scan 写 lastSig 时把 token 清掉 → 之后所有扫描
//      都在 shouldScan 处 no-token 短路，新通知提醒永远发不出去（线上表现就是「开启后收不到」）；
//   ② 每次 bootstrap 又把 lastSig/lastIds 清掉 → 下一次扫描重新当首跑基线，新通知被跳过。
//   现在：文档已存在时用 update 做字段合并（不清其它字段）；只有文档不存在时才 set 完整合并后的文档。
async function patchCfg(fields) {
  try {
    const col = database().collection(CFG_COLLECTION);
    const doc = col.doc(CFG_ID);
    const patch = Object.assign({}, fields || {});
    if (doc && doc.update) {
      let r = null;
      try { r = await doc.update({ data: patch }); } catch (e) { r = null; }
      const updated = r && r.stats ? Number(r.stats.updated) : NaN;
      // 真实云开发 update 返回 stats.updated；>0 = 已合并到现有文档，绝不整文档覆盖
      if (r && (!r.stats || updated > 0)) return true;
    }
    // 文档不存在（或没有 update）：读取现有配置 → 合并增量 → 整体创建，保证 token/lastSig 不丢
    const cfg = await getCfg();
    const merged = scan.mergeCfg(cfg, patch);
    if (doc && doc.set) await doc.set({ data: merged });
    else if (doc && doc.update) await doc.update({ data: merged });
    return true;
  } catch (e) { return false; }
}
// 轻量 HTTP（Node https；只允许本云函数内部调用 REST_BASE，不引入第三方库/新请求来源）
function httpJson(method, url, headers, body) {
  return new Promise(function (resolve) {
    let u;
    try { u = new URL(url); } catch (e) { resolve({ status: 0, json: null }); return; }
    const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = Object.assign({ Accept: 'application/json' }, headers || {});
    if (payload) h['Content-Type'] = 'application/json';
    if (payload) h['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + (u.search || ''),
      method: method,
      headers: h,
      timeout: 8000
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); if (chunks.length && chunks.reduce(function (n, b) { return n + b.length; }, 0) > 2 * 1024 * 1024) { try { res.destroy(); } catch (e) { /* ignore */ } } });
      res.on('end', function () {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
        resolve({ status: res.statusCode || 0, json: json });
      });
    });
    req.on('timeout', function () { try { req.destroy(new Error('timeout')); } catch (e) { /* ignore */ } });
    req.on('error', function () { resolve({ status: 0, json: null }); });
    if (payload) req.write(payload);
    req.end();
  });
}
function restHeaders(cfg, extra) {
  const h = { Authorization: 'Bearer ' + REST_KEY };
  if (cfg && cfg.token) h['X-Class-Token'] = cfg.token;
  if (extra) Object.assign(h, extra);
  return h;
}
// 校验客户端上报的班级 token 是否有效（复用 class_members RPC，不落任何 token 到日志）
async function verifyClassToken(token) {
  if (!token || !REST_BASE) return false;
  const r = await httpJson('POST', REST_BASE + 'rpc/class_members', restHeaders({ token: token }, {
    Authorization: 'Bearer ' + REST_KEY
  }), {});
  if (!r || r.status !== 200 || !Array.isArray(r.json)) return false;
  return r.json.length > 0;
}
// 拉取 notices 轻量表（id/ts/title/hidden/edited_at；与小程序签名同口径）
async function fetchNoticeRows(cfg) {
  if (!REST_BASE || !cfg || !cfg.token) return { status: 0, json: null };
  return httpJson('GET', REST_BASE + 'notices?' + NOTICE_SCAN_Q, restHeaders(cfg), null);
}
async function countNtActive() {
  try {
    const col = database().collection('subscriptions');
    if (!col || !col.where) return 0;
    const q = col.where({ kind: 'nt', active: true });
    if (q && q.count) return (await q.count()).total || 0;
    const r = await q.get();
    return (r && r.data ? r.data.length : 0);
  } catch (e) { return 0; }
}
// 向 active 的 kind='nt' 订阅发送「新通知」（发送成功即置 inactive：一次性订阅）
async function sendToNt(msg) {
  const col = database().collection('subscriptions');
  const q = await col.where({ kind: 'nt', active: true }).limit(SCAN_BATCH).get();
  const list = q.data || [];
  let sent = 0;
  const errors = [];
  for (const row of list) {
    try {
      await send({
        openid: row.openid, kind: 'nt', tmplId: row.tmplId, place: row.place,
        tip: '新通知', timeText: msg.timeText, summary: msg.summary, dateText: msg.dateText
      });
      await markDone(row._id);
      sent++;
    } catch (e) {
      const em = String((e && e.message) || e);
      errors.push(em);
      try { await col.doc(row._id).update({ data: { lastError: em, lastTry: Date.now() } }); } catch (e2) { /* ignore */ }
    }
  }
  return { sent: sent, total: list.length, errors: errors.slice(0, 3) };
}
// 一次新通知扫描：shouldScan 门控（无 token / 无订阅 / 5 分钟内已扫 → 不发任何外部请求）
// 返回 { ok, skipped? baseline? changed? newCount? sent? ntActive? }
async function scanNewNotices(opts) {
  opts = opts || {};
  const now = Date.now();
  await ensureCfgCollection();
  const cfg = await getCfg();
  const ntActive = await countNtActive();
  const gate = scan.shouldScan(cfg, now, SCAN_MIN_MS, ntActive > 0 || !!opts.force);
  if (!gate.ok) return { ok: true, skipped: gate.reason, ntActive: ntActive };
  const resp = await fetchNoticeRows(cfg);
  if (resp.status === 401 || resp.status === 403) {
    await patchCfg({ lastScanAt: now, lastError: 'token-invalid', lastErrAt: now });
    return { ok: false, reason: 'token-invalid', ntActive: ntActive };
  }
  if (resp.status < 200 || resp.status >= 300 || !Array.isArray(resp.json)) {
    await patchCfg({ lastScanAt: now, lastError: 'rest-' + (resp.status || 0), lastErrAt: now });
    return { ok: false, reason: 'rest-failed', ntActive: ntActive };
  }
  const rows = resp.json;
  const det = scan.detectNew({ lastSig: cfg.lastSig, lastIds: cfg.lastIds }, rows);
  let sent = 0;
  let sendErrors = [];
  if (det.changed && det.newRows.length) {
    const latest = scan.pickLatest(det.newRows);
    if (latest) {
      const r = await sendToNt(scan.messageOf(latest, fmt));
      sent = r.sent;
      sendErrors = r.errors;
    }
  }
  // 首跑只记基线；删除/隐藏/编辑（签名变但无新增 id）只更新基线不发送
  await patchCfg({
    lastSig: det.sig,
    lastIds: det.ids,
    lastScanAt: now,
    baselineAt: cfg.baselineAt || (det.baseline ? now : 0),
    lastSentAt: sent ? now : cfg.lastSentAt,
    sentCount: (Number(cfg.sentCount) || 0) + sent,
    lastError: sendErrors.length ? String(sendErrors[0]).slice(0, 160) : '',
    lastErrAt: sendErrors.length ? now : 0
  });
  return {
    ok: true, baseline: det.baseline, changed: det.changed,
    newCount: det.newRows.length, sent: sent, ntActive: ntActive
  };
}
// 客户端 bootstrap：上报当前班级 token（先校验再存 notify_cfg）；返回脱敏结果
async function bootstrap(event) {
  const token = String(event && event.token != null ? event.token : '').trim();
  if (!token) return { ok: false, reason: 'missing-token' };
  if (!REST_BASE) return { ok: false, reason: 'rest-not-configured' };
  const okToken = await verifyClassToken(token);
  if (!okToken) return { ok: false, reason: 'token-invalid' };
  await ensureCfgCollection();
  const now = Date.now();
  const cfg = await getCfg();
  const saved = await patchCfg({ token: token, tokenAt: now, bootAt: now, lastError: '', lastErrAt: 0 });
  return {
    ok: true, tokenOk: true, saved: saved,
    hadBaseline: !!cfg.lastSig,
    ntActive: await countNtActive()
  };
}
// 客户端按钮反馈：云端 kind='nt' active 数 + 本人是否已开启 + 心跳/扫描诊断（不返回 openid/token）
async function ntStatus(openid) {
  await ensureCollection();
  const col = database().collection('subscriptions');
  const active = await countNtActive();
  let mine = false;
  try {
    const q = await col.where({ openid: openid, kind: 'nt', active: true }).limit(1).get();
    mine = !!(q.data && q.data.length);
  } catch (e) { mine = false; }
  let hb = null;
  try { hb = (await col.doc(HB_ID).get()).data || null; } catch (e) { hb = null; }
  const cfg = await getCfg();
  const now = Date.now();
  return {
    ok: true,
    active: active,
    mine: mine,
    diag: {
      hb: hb ? { ts: Number(hb.ts) || 0, agoMs: now - (Number(hb.ts) || 0), source: String(hb.source || '') } : null,
      ntActive: active,
      scan: scan.cfgView(cfg, now)
    }
  };
}
// action=subscribe：hw | nt | ntremind；同 openid+kind+ref 去重更新
async function subscribe(event, openid) {
  await ensureCollection();
  const col = database().collection('subscriptions');
  const kind = event.kind ? String(event.kind) : 'hw';
  if (KINDS.indexOf(kind) < 0) return { ok: false, reason: 'bad-kind' };
  const now = Date.now();
  const fireAt = Number(event.fireAt) || 0;
  // ref 统一 trim：空白串视为空；ntremind 必须 ref 非空（契约 §2.1）
  const ref = String(event.ref == null ? '' : event.ref).trim();
  // 2026-11-19：记录本次授权用的模板 ID（新客户端 = 新模板；旧客户端不传 → 空 = 旧模板兼容）
  const wantTmpl = String(event.tmplId || '');
  const tmplId = (wantTmpl && TEMPLATES.indexOf(wantTmpl) >= 0) ? wantTmpl : '';

  if (kind === 'ntremind') {
    if (!ref) return { ok: false, reason: 'missing-ref' };
    // 契约写的是开区间 (now+60s, now+366d)：恰好等于上界也拒绝
    if (!(fireAt > now + REMIND_MIN_LEAD_MS && fireAt < now + REMIND_MAX_LEAD_MS)) {
      return { ok: false, reason: 'bad-fire-at' };
    }
    const dup = await col.where({ openid: openid, kind: 'ntremind', ref: ref }).get();
    const dupRows = dup.data || [];
    const active = await col.where({ openid: openid, kind: 'ntremind', active: true })
      .limit(REMIND_MAX_ACTIVE + 1).get();
    let activeCount = (active.data || []).length;
    if (dupRows.length) activeCount--; // 命中已有行 = 更新，不新增活跃数
    if (activeCount >= REMIND_MAX_ACTIVE) return { ok: false, reason: 'too-many' };
    const row = {
      openid: openid,
      kind: 'ntremind',
      ref: ref,
      fireAt: fireAt,
      label: String(event.label || ''),
      tip: short(event.tip || '通知提醒', 20),
      timeText: String(event.timeText || fmt(fireAt)),
      summary: short(event.summary || '', 20),
      dateText: String(event.dateText || ''),
      // 新模板「地点」：通知页传入通知原文的地点段落（没有时发送侧回落「班级工具」）
      place: short(event.place || '', 20),
      tmplId: tmplId,
      active: true,
      attempts: 0,
      createdAt: now,
      updatedAt: now
    };
    if (dupRows.length) await col.doc(dupRows[0]._id).update({ data: row });
    else await col.add({ data: row });
    return { ok: true };
  }

  // hw / nt：保持既有逻辑（hw 的 fireAt 必须在未来；nt 的 fireAt 可为 0）
  if (kind === 'hw' && fireAt <= now) return { ok: false, reason: 'time-passed' };
  const row = {
    openid: openid,
    kind: kind,
    ref: ref,
    fireAt: fireAt,
    tip: short(event.tip || '', 20),
    timeText: String(event.timeText || ''),
    summary: short(event.summary || '', 20),
    dateText: String(event.dateText || ''),
    label: String(event.label || ''),
    place: short(event.place || '', 20),
    tmplId: tmplId,
    active: true,
    attempts: 0,
    createdAt: now
  };
  const q = await col.where({ openid: openid, kind: kind, ref: ref }).get();
  if (q.data && q.data.length) await col.doc(q.data[0]._id).update({ data: row });
  else await col.add({ data: row });
  return { ok: true };
}
// action=list：本人 active 行，字段裁剪，按 fireAt 升序
async function list(event, openid) {
  await ensureCollection();
  const col = database().collection('subscriptions');
  const _ = database().command;
  const cond = { openid: openid, active: true };
  const kind = event.kind ? String(event.kind) : '';
  if (kind) {
    if (KINDS.indexOf(kind) < 0) return { ok: false, reason: 'bad-kind' };
    cond.kind = kind;
  } else {
    // 省略 kind = 全部「提醒」（hw + ntremind），不含「下一条通知」
    cond.kind = _.in(['hw', 'ntremind']);
  }
  const q = await col.where(cond).orderBy('fireAt', 'asc').limit(LIST_LIMIT).get();
  const rows = (q.data || []).map(function (r) {
    return {
      _id: r._id,
      kind: r.kind,
      ref: r.ref,
      fireAt: r.fireAt,
      label: r.label || '',
      timeText: r.timeText || '',
      summary: r.summary || '',
      createdAt: r.createdAt || 0
    };
  });
  return { ok: true, list: rows, total: rows.length };
}
// action=cancel：只置本人行 inactive；不存在也返回 ok
async function cancel(event, openid) {
  await ensureCollection();
  const col = database().collection('subscriptions');
  const kind = event.kind ? String(event.kind) : '';
  const ref = String(event.ref || '');
  if (kind && KINDS.indexOf(kind) < 0) return { ok: false, reason: 'bad-kind' };
  if (!ref) return { ok: false, reason: 'missing-ref' };
  const cond = { openid: openid, active: true, ref: ref };
  if (kind) cond.kind = kind;
  const q = await col.where(cond).limit(LIST_LIMIT).get();
  const rows = q.data || [];
  for (let i = 0; i < rows.length; i++) {
    try {
      await col.doc(rows[i]._id).update({ data: { active: false, cancelledAt: Date.now() } });
    } catch (e) { /* 单条失败不影响其它 */ }
  }
  return { ok: true };
}
// action=publishNotice：只发给 kind='nt' 且 active 的「下一条通知」，不碰 ntremind
async function publishNotice(event) {
  await ensureCollection();
  const col = database().collection('subscriptions');
  const q = await col.where({ kind: 'nt', active: true }).limit(100).get();
  const list = q.data || [];
  let sent = 0;
  const errors = [];
  for (const row of list) {
    try {
      await send({
        openid: row.openid, kind: 'nt', tmplId: row.tmplId, place: row.place,
        tip: '新通知',
        timeText: event.timeText || row.timeText,
        summary: event.summary || row.summary,
        dateText: event.dateText || row.dateText
      });
      await markDone(row._id);
      sent++;
    } catch (e) {
      const msg = String((e && e.message) || e);
      errors.push(msg);
      try { await col.doc(row._id).update({ data: { lastError: msg, lastTry: Date.now() } }); } catch (e2) { /* ignore */ }
    }
  }
  return { ok: true, sent: sent, total: list.length, errors: errors.slice(0, 3) };
}
// action=timer：处理到点的 hw + ntremind；失败 attempts+1，>=3 置 inactive
// options.openid：只处理某个 openid 的提醒（前端 catch-up 用，避免任何人触发全量补发）
// 2026-11-10 修复：① 写定时器心跳（诊断触发器是否在跑）；② 到点超过 STALE_MS 的提醒不再补发，直接标 inactive。
// 2026-11-11 需求 11：定时器再顺带扫描新通知（kind='nt' 订阅的真实发送方；只读 notices 轻量签名）。
//   * 失败不影响提醒主流程；扫描自身有 5 分钟节流/无 token/无订阅门控（0 外部请求）；
//   * 只允许定时器触发（flush 是用户触发的单 openid catch-up，不扫全站，避免被滥用）。
async function timer(options) {
  options = options || {};
  await ensureCollection();
  await writeHeartbeat(options.openid ? 'flush' : 'timer');
  const col = database().collection('subscriptions');
  const _ = database().command;
  const now = Date.now();
  const cond = { kind: _.in(['hw', 'ntremind']), active: true, fireAt: _.lte(now) };
  if (options.openid) cond.openid = String(options.openid);
  const q = await col.where(cond).limit(TIMER_BATCH).get();
  const list = q.data || [];
  let sent = 0;
  let stale = 0;
  const errors = [];
  for (const row of list) {
    const fireAt = Number(row.fireAt) || 0;
    if (fireAt && now - fireAt > STALE_MS) {
      // 已经过期的陈旧提醒：不发送（一次性订阅消息也不该在几天后打扰），标记跳过
      stale++;
      try {
        await col.doc(row._id).update({
          data: { active: false, skippedAt: now, lastError: 'stale:' + Math.round((now - fireAt) / 3600000) + 'h', lastTry: now }
        });
      } catch (e2) { /* ignore */ }
      continue;
    }
    try {
      await send(row);
      await markDone(row._id);
      sent++;
    } catch (e) {
      const msg = String((e && e.message) || e);
      errors.push(msg);
      const attempts = (Number(row.attempts) || 0) + 1;
      const data = { lastError: msg, lastTry: Date.now(), attempts: attempts };
      if (attempts >= MAX_ATTEMPTS) data.active = false;
      try { await col.doc(row._id).update({ data: data }); } catch (e2) { /* ignore */ }
    }
  }
  // 定时器才扫新通知（前端 flush 不扫；scanNewNotices 内部再门控，失败静默）
  let scanRes = null;
  if (!options.openid) {
    try { scanRes = await scanNewNotices({}); } catch (e) { scanRes = { ok: false, reason: 'scan-error' }; }
  }
  return {
    ok: true, sent: sent, stale: stale, total: list.length,
    errors: errors.slice(0, 3),
    scan: scanRes ? { skipped: scanRes.skipped || '', sent: scanRes.sent || 0, baseline: !!scanRes.baseline } : null
  };
}
// action=diag：远程只读诊断（不含 openid/ref，可安全返回给前端）
// 用来判定：定时器心跳是否在刷新（触发器是否生效）、积压到点条数、历史发送失败原因（模板/权限问题会出现在 lastError）。
async function diag() {
  await ensureCollection();
  const col = database().collection('subscriptions');
  const _ = database().command;
  const now = Date.now();
  const count = async function (cond) {
    try { return (await col.where(cond).count()).total; } catch (e) { return -1; }
  };
  let hb = null;
  try { hb = (await col.doc(HB_ID).get()).data || null; } catch (e) { hb = null; }
  const out = {
    now: now,
    hb: hb ? { ts: Number(hb.ts) || 0, agoMs: now - (Number(hb.ts) || 0), source: String(hb.source || '') } : null,
    total: await count({}),
    active: await count({ active: true }),
    activeDue: await count({ kind: _.in(['hw', 'ntremind']), active: true, fireAt: _.lte(now) }),
    hwActive: await count({ kind: 'hw', active: true }),
    ntRemindActive: await count({ kind: 'ntremind', active: true }),
    ntActive: await count({ kind: 'nt', active: true }),
    sentEver: await count({ sentAt: _.exists(true) }),
    skippedStale: await count({ skippedAt: _.exists(true) }),
    skippedStaleLast24h: await count({ skippedAt: _.gte(now - 24 * 3600 * 1000) }),
    errRows: await count({ lastError: _.exists(true) })
  };
  try {
    const q = await col.where({ lastError: _.exists(true) }).orderBy('lastTry', 'desc').limit(10).get();
    out.lastErrors = (q.data || []).map(function (r) {
      return {
        kind: String(r.kind || ''),
        attempts: Number(r.attempts) || 0,
        active: !!r.active,
        lastTry: Number(r.lastTry) || 0,
        fireAt: Number(r.fireAt) || 0,
        lastError: String(r.lastError || '').slice(0, 160)
      };
    });
  } catch (e) { out.lastErrors = ['query-failed:' + String((e && e.message) || e)]; }
  // 2026-11-11 需求 11：新通知扫描诊断（脱敏：绝不含 token/openid/通知全文）
  try {
    const cfg = await getCfg();
    out.notify = scan.cfgView(cfg, now);
    out.notify.scanMinMs = SCAN_MIN_MS;
    out.notify.tokenHealthy = scan.tokenHealthy(cfg, now);
  } catch (e) { out.notify = null; }
  return { ok: true, diag: out };
}

exports.main = async (event) => {
  const wx = cloud.getWXContext();
  event = event || {};
  try {
    if (event.Type === 'Timer' || event.action === 'timer') return await timer();
    if (event.action === 'diag') return await diag();
    // 2026-11-11 需求 11：客户端上报班级 token（供定时器轮询新通知）与订阅状态查询
    if (event.action === 'bootstrap') {
      if (!wx.OPENID) return { ok: false, reason: 'no-openid' };   // 仅小程序端可上报
      return await bootstrap(event);
    }
    if (event.action === 'ntStatus') {
      if (!wx.OPENID) return { ok: false, reason: 'no-openid' };
      return await ntStatus(wx.OPENID);
    }
    // 手动触发一次扫描（排查/自测用；不接受客户端 force，仍走 5 分钟节流门控）
    if (event.action === 'scan') {
      if (!wx.OPENID) return { ok: false, reason: 'no-openid' };
      return await scanNewNotices({ force: false });
    }
    if (event.action === 'flush') {
      // 前端 catch-up：只补发调用者自己的到点提醒（定时触发器之外的第二条送达保障）
      if (!wx.OPENID) return { ok: false, reason: 'no-openid' };
      return await timer({ openid: wx.OPENID });
    }
    if (event.action === 'publishNotice') return await publishNotice(event);
    if (event.action === 'subscribe' || event.action === 'list' || event.action === 'cancel') {
      if (!wx.OPENID) return { ok: false, reason: 'no-openid' };
      if (event.action === 'subscribe') return await subscribe(event, wx.OPENID);
      if (event.action === 'list') return await list(event, wx.OPENID);
      return await cancel(event, wx.OPENID);
    }
    return { ok: false, reason: 'unknown-action' };
  } catch (e) {
    return { ok: false, reason: 'cloud-error' };
  }
};
