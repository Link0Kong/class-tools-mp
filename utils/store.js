// utils/store.js —— 本地存储层（v12 / 1.3.0）
// v12 起不再有「账号桶」：身份来自班级 token（utils/identity.js），本机数据固定在 zq_tools_v2。
// 键名与数据结构保持与旧版兼容，保证老用户升级后本机数据可继续读取：
//   KEY    = 'zq_tools_v2'       主数据（JSON 字符串）
//   OLDKEY = 'ziqi.tools.v1'     旧版数据（只读兼容）
const KEY = 'zq_tools_v2';
const OLDKEY = 'ziqi.tools.v1';
const waterUtil = require('./water.js');

// 默认数据模型（逐字段对齐原站 DEF）
// 1.3.4 名单改造：名单只能来自 class_members（70 人班级名单），三处名单输入改为「座号选择」。
//   rosterSel / group.sel / rollSel = 座号数组（去重、升序、整数，只存 classMembers 里存在的座号）；
//   roster / group.names / rollNames 保留为「派生文本」（由 utils/roster.js 统一写，页面不再手工编辑）；
//   selVer = 旧自定义名单文本 → 座号的迁移标记（0 = 待迁移，1 = 已迁移）。
// v19 / 1.4.6 用户数据同步（_sync_task/CONTRACT.md §3）新增 5 个字段：
//   ntDone   通知已处理映射 { <通知组 id>: true }（与 marks kind='ntdone' 同一份状态，本机缓存）
//   udCache  最近一次 userdata v6 合并结果（脏检测基线 / 未拥有 section 的保留来源）
//   udPend   本机有改动待推送（UI「待补发」用；失败保留，成功清掉）
//   cloudOff 云同步开关（true = 仅本机：不拉不推，marks 写入入队）
//   udHoldUntil 「清除云端我的数据」后的抑制期截止时间（ms）：在此之前不自动回推云端，
//             用户下一次显式修改同步内容时解除（cloud.udTouch），30 天安全上限（cloud.UD_HOLD_MS）。
const DEF = {
  course: [], homework: [], notices: [], termStart: '',
  // 2026-11-22 个人任务（网页任务模块移植）：与 public.taskdata 的 blob 同格式。
  // 只存本机 + 独立任务云表，不进 userdata v6；由 utils/task.js 归一/同步。
  task: null,
  roster: '', rosterSel: [], classRoster: '', hwDone: {}, ntPin: {}, hwHide: {}, ntHide: {}, markPend: [],
  ntDone: {}, udCache: null, udPend: false, cloudOff: false, udHoldUntil: 0,
  rollNames: '', rollSel: [], rollSt: {}, did: '', hwRemind: {}, ntSub: false, ntSubAt: 0,
  ntRemind: {},   // v20 / 1.4.7 通知提醒本机缓存 { <通知组 id>: { ref, fireAt, label, ts } }（不同步到 userdata/web）
  fitRecs: [],
  classMembers: [], classMembersAt: 0,
  // 2026-11-11 名单快捷预设（需求 8）：团员名单（class_league RPC）本机缓存；只存 {seat,name}，不含学号。
  classLeague: [], classLeagueAt: 0,
  // 2026-11-06 v2.0.0：homeTools 语义改为「用户主动勾选的首页工具 key 数组（≤4、按工具顺序）」，
  // 与网页 userdata v6 共用（≤4 契约不变）；旧版「全量顺序」数据在 utils/tools.js 里迁移。
  homeTools: ['hw', 'nt', 'ft', 'draw'], homeToolsAt: 0,
  // 2026-11-06：全部工具自定义顺序（TOOLS.key 数组）——随账号云同步（走 userdata v6 的 prefs.toolOrder，
  // 不新增顶层键）；toolOrderSetAt>0 表示用户拖过排序（默认自然顺序不写云端，避免污染契约/夹具）。
  // 旧版 homeTools 全量顺序 → 首次读取时由 utils/tools.js 迁移到这里并标记 toolOrderSetAt。
  toolOrder: [], toolOrderSetAt: 0,
  ttCache: null,
  // 2026-11-08 课表登录：个人教务课表 {c:[课程], t:'YYYY-MM-DD'}（与网页 userdata v6 的 tt.ttLocal 同字段，
  // 跨端同步）。ttLocalAt = 本机最后一次写入/清除该值的时间（ms）：>0 时本机在 UD 合并中按 LWW 参与，
  // 并据此判断「本机拥有 ttLocal」；0 = 只读展示云端值（不覆盖别人写入的个人课表）。
  ttLocal: null, ttLocalAt: 0,
  // 2026-11-12 抽签升级 v1：names = 自定义序号名称映射文本（每行「序号 名称」，空 = 未设置；
  // 解析/归一见 utils/drawproof.js §3.1；随 userdata v6 的 draw section 同步，不新增顶层键）。
  draw: { start: 1, end: 70, count: 10, dup: false, excl: '', sort: 'draw', names: '' },
  group: { source: 'prev', names: '', sel: [], mode: 'groups', n: 4, shuffle: false },
  fit: { sex: 'm', grade: '12', h: '', w: '', vc: '', r50: '', sit: '', jump: '', pull: '', durM: '', durS: '' },
  // v2.0.0 / 网站功能同步：关注宿舍（电费）本机镜像 { sel:<roomverify>, at:<ms>, low:<10–100 档位> }；
  // 真源是云端 userdata v6 的 power section（utils/cloud.js），本机键仅离线兜底展示。
  power: { sel: '', at: 0, low: 30 },
  // 2026-11-06 水量统计（网站功能同步）：本机抄表记录 {rooms:{<roomverify>:{p:4|6, recs:[{m,r,ts}]}}}；
  // 真源是云端 userdata v6 的 water section（utils/cloud.js），本机结构与之逐字段一致，换设备可恢复。
  // 2026-11-11 起按 web/tools/tests/_water_shared_contract.md 接入云端共享（public.water / water_room）：
  //   * UD water 降级为「本机离线缓存」（契约不变）；
  //   * waterPend = 离线待补发操作队列 [{op:'put'|'del'|'persons', rv, m?, r?, p?, at}]（不进 UD 同步，仅本机）；
  //   * waterSyncAt = 上次云端同步时间（ms，页脚状态展示用）。
  water: { rooms: {} },
  waterPend: [], waterSyncAt: 0,
  settings: { kind: 'webhook', url: '' }
};

let cache = null;

// 读取：兼容「JSON 字符串」与「已解析对象」两种历史写法
function readKey(k) {
  try {
    const v = wx.getStorageSync(k);
    if (v === '' || v === null || v === undefined) return null;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return null; } }
    return v;
  } catch (e) { return null; }
}
function writeKey(k, v) {
  try { wx.setStorageSync(k, JSON.stringify(v)); return true; } catch (e) { return false; }
}

// 座号数组归一：去掉非整数 / <1 / 重复，升序排列（名单选择只认班级名单座号）
function normSeats(list) {
  const out = [], seen = {};
  (Array.isArray(list) ? list : []).forEach(function (v) {
    const n = Number(v);
    if (!isFinite(n) || !Number.isInteger(n) || n < 1 || seen[n]) return;
    seen[n] = true; out.push(n);
  });
  out.sort(function (a, b) { return a - b; });
  return out;
}

// 通知提醒归一：只保留有效条目（ref/fireAt 必须有；label/ts 补默认），丢弃脏数据
// ntRemind 结构见 _notify_task/CONTRACT.md §1.1：
//   { "<通知组 id>": { ref, fireAt(ms), label, ts } }
function normRemind(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  Object.keys(raw).forEach(function (k) {
    const v = raw[k];
    if (!v || typeof v !== 'object' || Array.isArray(v)) return;
    const fireAt = Number(v.fireAt);
    if (!isFinite(fireAt) || fireAt <= 0) return;
    out[k] = {
      ref: String(v.ref || k),
      fireAt: fireAt,
      label: String(v.label || ''),
      ts: Number(v.ts) || 0
    };
  });
  return out;
}

// v5：power.low 合法档位 [10,20,30,40,50,60,80,100]（旧数据/非法值 → 30）
const LOW_OPTIONS = [10, 20, 30, 40, 50, 60, 80, 100];
function normLow(v) {
  const n = Number(v);
  if (!isFinite(n) || n < 10 || n > 100) return 30;
  const r = Math.round(n / 10) * 10;
  let best = 30, bd = 1e9;
  LOW_OPTIONS.forEach(function (x) { const dd = Math.abs(x - r); if (dd < bd) { bd = dd; best = x; } });
  return best;
}

// 个人教务课表（ttLocal）归一：与网页端同字段 {c:[{name,teacher,room,day,start,end,weeks,parity}], t}
// 只保留课程必需字段（丢弃未知字段/脏数据，避免把无关内容带进 userdata v6）。
function normTtLocal(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.c)) return null;
  const out = [];
  v.c.forEach(function (x) {
    if (!x || typeof x !== 'object' || !x.name) return;
    const day = Number(x.day), start = Number(x.start), end = Number(x.end);
    if (!isFinite(day) || day < 0 || day > 6) return;
    if (!isFinite(start) || start < 1 || start > 14) return;
    if (!isFinite(end) || end < start || end > 14) return;
    out.push({
      name: String(x.name || ''),
      teacher: String(x.teacher || ''),
      room: String(x.room || ''),
      day: day, start: start, end: end,
      weeks: String(x.weeks || '1-16'),
      parity: (x.parity === 'odd' || x.parity === 'even') ? x.parity : 'all'
    });
  });
  if (!out.length) return null;
  return { c: out, t: String(v.t || '') };
}

function mkD(raw) {
  raw = raw || {};
  const d = Object.assign({}, DEF, raw);
  d.draw = Object.assign({}, DEF.draw, raw.draw || {});
  d.group = Object.assign({}, DEF.group, raw.group || {});
  d.group.sel = normSeats(d.group.sel);
  // 契约 web/group/CONTRACT.md §4：group.source 只保留 prev | pick；旧 'paste'/未知值归一 prev（paste 归一 pick）
  d.group.source = (d.group.source === 'pick' || d.group.source === 'paste') ? 'pick' : 'prev';
  d.rosterSel = normSeats(raw.rosterSel);
  d.rollSel = normSeats(raw.rollSel);
  d.selVer = Number(raw.selVer) || 0;
  d.settings = Object.assign({}, DEF.settings, raw.settings || {});
  d.hwDone = Object.assign({}, raw.hwDone || {});
  d.ntPin = Object.assign({}, raw.ntPin || {});
  d.hwHide = Object.assign({}, raw.hwHide || {});
  d.ntHide = Object.assign({}, raw.ntHide || {});
  d.rollSt = Object.assign({}, raw.rollSt || {});
  d.markPend = raw.markPend || [];
  d.ntDone = (raw.ntDone && typeof raw.ntDone === 'object' && !Array.isArray(raw.ntDone)) ? Object.assign({}, raw.ntDone) : {};
  d.ntRemind = normRemind(raw.ntRemind);
  d.udCache = (raw.udCache && typeof raw.udCache === 'object' && !Array.isArray(raw.udCache)) ? raw.udCache : null;
  d.udPend = !!raw.udPend;
  d.cloudOff = !!raw.cloudOff;
  d.udHoldUntil = Number(raw.udHoldUntil) || 0;
  d.fitRecs = Array.isArray(raw.fitRecs) ? raw.fitRecs.slice(0, 2) : [];
  d.classMembers = Array.isArray(raw.classMembers) ? raw.classMembers.slice() : [];
  d.classMembersAt = Number(raw.classMembersAt) || 0;
  d.classRoster = typeof raw.classRoster === 'string' ? raw.classRoster : '';
  // 2026-11-06 v2.0.0：homeTools 改为「用户勾选的首页工具」（≤4），**空数组是合法状态**（一个都没勾选），
  // 因此只有字段缺失/非数组时才回默认；旧版「全量顺序」数据由 utils/tools.js 迁移。
  d.homeTools = Array.isArray(raw.homeTools) ? raw.homeTools.slice() : DEF.homeTools.slice();
  // 全部工具自定义顺序：只在 utils/tools.js 里归一（去重/过滤/补未知）；这里只保证是数组
  d.toolOrder = Array.isArray(raw.toolOrder) ? raw.toolOrder.slice() : [];
  d.toolOrderSetAt = Number(raw.toolOrderSetAt) || 0;
  d.fit = Object.assign({}, DEF.fit, raw.fit || {});
  d.power = (raw.power && typeof raw.power === 'object' && !Array.isArray(raw.power))
    ? { sel: String(raw.power.sel || ''), at: Number(raw.power.at) || 0, low: normLow(raw.power.low) }
    : { sel: '', at: 0, low: 30 };
  // 2026-11-08 课表登录：个人教务课表（坏数据 → null；ttLocalAt 仅本机写入时 >0）
  d.ttLocal = normTtLocal(raw.ttLocal);
  d.ttLocalAt = Number(raw.ttLocalAt) || 0;
  if (!d.ttLocal) d.ttLocalAt = 0;
  // 水量统计：坏数据/旧数据（无 water）→ {rooms:{}}；每房间 p 归一 4|6、recs 按月唯一升序 ≤120
  d.water = waterUtil.normWater(raw.water);
  // 2026-11-11 水量云端共享离线队列（宽容：坏数组 → []；单条 op 由 utils/water.js 再归一）
  d.waterPend = Array.isArray(raw.waterPend) ? raw.waterPend.slice(0, 200) : [];
  d.waterSyncAt = Number(raw.waterSyncAt) || 0;
  // 2026-11-11 名单快捷预设：团员缓存（class_league；只留 {seat,name}，坏行丢弃）
  d.classLeague = Array.isArray(raw.classLeague)
    ? raw.classLeague.map(function (x) {
      if (!x || typeof x !== 'object') return null;
      const seat = Number(x.seat), name = String(x.name == null ? '' : x.name).trim();
      if (!isFinite(seat) || !Number.isInteger(seat) || seat < 1 || !name) return null;
      return { seat: seat, name: name };
    }).filter(Boolean).slice(0, 200)
    : [];
  d.classLeagueAt = Number(raw.classLeagueAt) || 0;
  return d;
}

function loadRaw() {
  let raw = readKey(KEY);
  if (!raw) {
    const o = readKey(OLDKEY);
    if (o) {
      raw = {
        course: o.courses || [], homework: o.homework || [], notices: o.notices || [],
        termStart: o.termStart || '', settings: o.settings || {}
      };
    }
  }
  return raw;
}

function get() { if (!cache) cache = mkD(loadRaw()); return cache; }
// 保存本机数据后触发「用户数据 sync 脏检测」（CONTRACT §5.2）：
//   * 延迟 require cloud.js：避免 store ↔ cloud 循环依赖，也避免 app 启动早期就把云端模块拉起来；
//   * try/catch + cloud 内部再判（未登录 / 未配置 / cloudOff / 无基线时直接返回），本机保存永不受影响。
function save() {
  const ok = writeKey(KEY, get());
  try { require('./cloud.js').udTouch(); } catch (e) { /* 同步脏检测失败不影响本机保存 */ }
  return ok;
}
// 只落本机、不触发 userdata v6 脏检测（任务只走独立 taskdata 表；避免无意义 UD 推送）
function saveQuiet() {
  return writeKey(KEY, get());
}
function reload() { cache = mkD(readKey(KEY)); return cache; }
function reset() { cache = mkD(null); save(); return cache; }

module.exports = {
  KEY, OLDKEY, DEF, mkD, readKey, writeKey, normSeats, normRemind, normLow, normTtLocal,
  get, save, saveQuiet, reload, reset
};
