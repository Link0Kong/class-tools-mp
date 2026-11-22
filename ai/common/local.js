// ai/common/local.js —— 本机存储读写（与主包共用 wx storage）
//
// 键（与 mp-class-tools 主包完全一致）：
//   zq_tools_v2        主数据（作业/通知/名单/体测/工具顺序/偏好…）
//   zq_flow            抽签 / 分组本机跨页状态（utils/flow.js 同结构，含最近抽签 drawLast）
//   zq_class_identity  身份（见 ai/common/auth.js，这里不碰）
//
// 约定：
//   * 原子接口环境与小程序 runtime 不共享全局变量，但共享 storage；AI 写本机数据后，
//     handoff 打开的小程序页面会重新读取 storage（页面 onShow/onLoad 均读最新值）。
//   * patchStore 只做浅层字段写入 + 保留未识别字段，避免破坏主包数据结构。
//   * 主包的 userdata v6 云同步由小程序 app.onShow 后的 udPull/udPush 自动完成（AI 只写本机）。
const STORE = 'zq_tools_v2';
const FLOW = 'zq_flow';
const OLD = 'ziqi.tools.v1';
const AGENT_PREFIX = 'zqa1_';

function readKey(k) {
  try {
    const v = wx.getStorageSync(k);
    if (v === '' || v === null || v === undefined) return null;
    if (typeof v === 'string') {
      try { return JSON.parse(v); } catch (e) { return null; }
    }
    return v;
  } catch (e) { return null; }
}
function writeKey(k, v) {
  try { wx.setStorageSync(k, JSON.stringify(v)); return true; } catch (e) { return false; }
}
function removeKey(k) {
  try { wx.removeStorageSync(k); return true; } catch (e) { return false; }
}

function num(v, dft) { const n = Number(v); return isFinite(n) ? n : dft; }
function str(v, dft) { return (typeof v === 'string') ? v : (dft || ''); }
function obj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }
function arr(v) { return Array.isArray(v) ? v : []; }
function normSeats(list) {
  const out = [], seen = {};
  arr(list).forEach(function (v) {
    const n = Number(v);
    if (!isFinite(n) || !Number.isInteger(n) || n < 1 || seen[n]) return;
    seen[n] = 1; out.push(n);
  });
  out.sort(function (a, b) { return a - b; });
  return out;
}

// 读取主数据（归一化出本层用到的字段；不改原对象语义）
function readStore() {
  let d = readKey(STORE);
  if (!d) {
    const old = readKey(OLD);
    if (old) d = { homework: old.homework || [], notices: old.notices || [], termStart: old.termStart || '' };
  }
  d = obj(d);
  d.classMembers = arr(d.classMembers);
  d.classMembersAt = num(d.classMembersAt, 0);
  d.classRoster = str(d.classRoster, '');
  d.roster = str(d.roster, '');
  d.rosterSel = normSeats(d.rosterSel);
  d.rollSel = normSeats(d.rollSel);
  d.rollNames = str(d.rollNames, '');
  d.rollSt = obj(d.rollSt);
  d.homework = arr(d.homework);
  d.notices = arr(d.notices);
  d.fitRecs = arr(d.fitRecs);
  d.termStart = str(d.termStart, '');
  d.ttCache = (d.ttCache && typeof d.ttCache === 'object') ? d.ttCache : null;
  d.udCache = (d.udCache && typeof d.udCache === 'object') ? d.udCache : null;
  d.hwDone = obj(d.hwDone);
  d.ntPin = obj(d.ntPin);
  d.ntDone = obj(d.ntDone);
  d.markPend = arr(d.markPend);
  d.cloudOff = !!d.cloudOff;
  d.draw = Object.assign({ start: 1, end: 70, count: 10, dup: false, excl: '', sort: 'draw' }, obj(d.draw));
  d.group = Object.assign({ source: 'prev', names: '', sel: [], mode: 'groups', n: 4, shuffle: false }, obj(d.group));
  d.group.sel = normSeats(d.group.sel);
  return d;
}

function writeStore(d) { return writeKey(STORE, d || {}); }

// 读-改-写：fn(storeObj) 可直接改；返回修改后的对象
function patchStore(fn) {
  const d = readStore();
  let r;
  try { r = fn(d); } catch (e) { r = null; }
  const next = (r && typeof r === 'object' && !Array.isArray(r)) ? r : d;
  writeStore(next);
  return next;
}

function getClassMembers() { return readStore().classMembers; }

function rosterTextOf(list) {
  return arr(list).map(function (m) { return (m.seat ? m.seat + ' ' : '') + m.name; }).join('\n');
}
function saveClassMembers(list) {
  return patchStore(function (d) {
    d.classMembers = arr(list).map(function (m) {
      return {
        seat: num(m.seat, 0), sid: str(m.sid, ''), name: str(m.name, ''),
        role: str(m.role, ''), badge: str(m.badge, ''), is_admin: !!m.is_admin
      };
    }).filter(function (m) { return !!m.name; }).sort(function (a, b) { return a.seat - b.seat; });
    d.classRoster = rosterTextOf(d.classMembers);
    d.classMembersAt = Date.now();
    return d;
  });
}

// ---------------------------------------------------------------- 抽签 / 分组（zq_flow，两个独立工具）
function emptyFlow() { return { draw: null, drawLast: null, group: null, updatedAt: 0 }; }
function getFlow() {
  const f = readKey(FLOW);
  if (!f || typeof f !== 'object') return emptyFlow();
  return { draw: f.draw || null, drawLast: f.drawLast || null, group: f.group || null, updatedAt: num(f.updatedAt, 0) };
}
function setFlow(f) {
  const next = Object.assign(emptyFlow(), f || {});
  next.updatedAt = Date.now();
  writeKey(FLOW, next);
  return next;
}
function patchFlow(k, v) {
  const f = getFlow();
  f[k] = v;
  // 抽签成功 / 结果变化 → 同步「最近抽签」快照，供分组页「最近抽签」跨重启沿用（与主包 flow.saveLastDraw 一致）
  if (k === 'draw' && v && Array.isArray(v.result) && v.result.length) {
    f.drawLast = {
      at: Date.now(),
      result: v.result.slice(),
      pool: Array.isArray(v.pool) ? v.pool.slice() : [],
      cfg: v.cfg ? Object.assign({}, v.cfg) : null
    };
  }
  return setFlow(f);
}
// 最近一次成功抽签：drawLast 优先，旧数据回退 draw
function lastDraw() {
  const f = getFlow();
  if (f.drawLast && Array.isArray(f.drawLast.result) && f.drawLast.result.length) return f.drawLast;
  if (f.draw && Array.isArray(f.draw.result) && f.draw.result.length) return f.draw;
  return null;
}

// ---------------------------------------------------------------- 课表
function getTermStart() { return readStore().termStart; }
function setTermStart(s) {
  const v = String(s == null ? '' : s).trim();
  return patchStore(function (d) { d.termStart = v; return d; }).termStart;
}
function getTtCache() { return readStore().ttCache; }
function setTtCache(c) {
  patchStore(function (d) { d.ttCache = c && typeof c === 'object' ? c : null; return d; });
  return c || null;
}

// ---------------------------------------------------------------- 体测
function getFitRecs() { return readStore().fitRecs; }
function setFitRecs(list) {
  patchStore(function (d) { d.fitRecs = arr(list).slice(0, 2); return d; });
  return d2recs(list);
}
function d2recs(list) { return arr(list).slice(0, 2); }

// ---------------------------------------------------------------- 云同步开关 / 本地标记
function getCloudOff() { return readStore().cloudOff; }
function setCloudOff(off) {
  return patchStore(function (d) { d.cloudOff = !!off; return d; }).cloudOff;
}
function getUdCache() { return readStore().udCache; }

function getMarksLocal() {
  const d = readStore();
  return { hwDone: d.hwDone, ntPin: d.ntPin, ntDone: d.ntDone };
}

// 与主包 cloud.applyMarkLocally 一致：kind=hw→hwDone / ntdone→ntDone / nt→ntPin
function applyMarkLocal(kind, ref, val) {
  if (!ref) return;
  patchStore(function (d) {
    if (kind === 'hw') { d.hwDone = d.hwDone || {}; d.hwDone[ref] = !!val; }
    else if (kind === 'ntdone') { d.ntDone = d.ntDone || {}; d.ntDone[ref] = !!val; }
    else { d.ntPin = d.ntPin || {}; d.ntPin[ref] = !!val; }
    return d;
  });
}

// 本机 markPend 队列（网络失败待补发）；主包下次 cloudPull 会自动 flush
function getPending() { return readStore().markPend; }
function setPending(list) { patchStore(function (d) { d.markPend = arr(list); return d; }); }
function queuePending(p) {
  patchStore(function (d) {
    d.markPend = arr(d.markPend).filter(function (x) {
      return !(x && x.seat === p.seat && x.kind === p.kind && x.ref === p.ref);
    });
    d.markPend.push({ seat: p.seat, kind: p.kind, ref: p.ref, val: !!p.val });
    return d;
  });
}
function dropPending(seat, kind, ref) {
  patchStore(function (d) {
    d.markPend = arr(d.markPend).filter(function (x) {
      return !(x && x.seat === seat && x.kind === kind && x.ref === ref);
    });
    return d;
  });
}

// ---------------------------------------------------------------- AI 专用缓存键（前缀 zqa1_，可安全清理）
function getAgentCache(name, dft) {
  const v = readKey(AGENT_PREFIX + name);
  return v == null ? (dft === undefined ? null : dft) : v;
}
function setAgentCache(name, v) {
  if (v == null) { removeKey(AGENT_PREFIX + name); return null; }
  writeKey(AGENT_PREFIX + name, v);
  return v;
}
function clearAgentKeys() {
  try {
    const info = wx.getStorageInfoSync ? wx.getStorageInfoSync() : null;
    const keys = (info && info.keys) || [];
    keys.forEach(function (k) { if (String(k).indexOf(AGENT_PREFIX) === 0) removeKey(k); });
  } catch (e) { /* ignore */ }
}

module.exports = {
  STORE: STORE, FLOW: FLOW, OLD: OLD, AGENT_PREFIX: AGENT_PREFIX,
  readKey: readKey, writeKey: writeKey, removeKey: removeKey,
  readStore: readStore, writeStore: writeStore, patchStore: patchStore,
  getClassMembers: getClassMembers, saveClassMembers: saveClassMembers, rosterTextOf: rosterTextOf,
  emptyFlow: emptyFlow, getFlow: getFlow, setFlow: setFlow, patchFlow: patchFlow, lastDraw: lastDraw,
  getTermStart: getTermStart, setTermStart: setTermStart, getTtCache: getTtCache, setTtCache: setTtCache,
  getFitRecs: getFitRecs, setFitRecs: setFitRecs,
  getCloudOff: getCloudOff, setCloudOff: setCloudOff, getUdCache: getUdCache,
  getMarksLocal: getMarksLocal, applyMarkLocal: applyMarkLocal,
  getPending: getPending, setPending: setPending, queuePending: queuePending, dropPending: dropPending,
  getAgentCache: getAgentCache, setAgentCache: setAgentCache, clearAgentKeys: clearAgentKeys
};
