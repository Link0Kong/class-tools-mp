// ai/skills/account/lib/v6.js —— userdata v6 结构（与主包 utils/privacy.js 逐字节一致）
//
// 用于「清除云端我的数据」：把 userdata 覆盖为空 v6、marks 置否；并生成本机同步基线，
// 使清除后本机脏检测保持干净（主包 cloud.udClearCloud 的语义）。
const VERSION = 6;
const SECTION_KEYS = ['homeTools', 'fit', 'draw', 'group', 'roster', 'hide', 'tt', 'prefs', 'nick'];
const DEFAULTS = {
  homeTools: [],
  fit: {},
  draw: {},
  group: {},
  roster: { rosterSel: [], rollSel: [], rollSt: {}, rollNames: '' },
  hide: { hwHide: {}, ntHide: {} },
  tt: { ttView: '', ttUseMine: false, ttLocal: null, termStart: '' },
  prefs: { hwRemind: {}, ntSub: false, ntSubAt: 0 },
  nick: ''
};

// 同步范围清单（与主包 utils/privacy.js SCOPE 一致；隐私页展示与数据概览使用）
const SCOPE = [
  '作业完成', '通知已处理', '通知置顶', '工具栏顺序', '体测录入', '抽签参数',
  '分组与名单', '点名名单与到·假', '隐藏项', '课表偏好', '通知提醒偏好', '昵称'
];

function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
function num(v) { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; }
function obj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }
function arr(v) { return Array.isArray(v) ? v : []; }

// 空 v6 blob：键顺序与主包 emptyV6 一致（v + at 全 0 + 空 section + homeToolsAt）
function emptyV6() {
  const out = { v: VERSION, at: {} };
  SECTION_KEYS.forEach(function (k) { out.at[k] = 0; });
  SECTION_KEYS.forEach(function (k) { out[k] = clone(DEFAULTS[k]); });
  out.homeToolsAt = 0;
  return out;
}
function emptyBlob() { return JSON.stringify(emptyV6()); }

// 本机基线（清除云端后的 udCache）：本机 section 现值 + at 全部抬到 now，
// 与主包 cloud.udClearCloud 的 d.udCache = mergeUd(empty, base) 等价。
function baselineBlob(store, now) {
  const s = store || {};
  const base = localSections(s);
  const ts = num(now) || Date.now();
  const out = { v: VERSION, at: {} };
  SECTION_KEYS.forEach(function (k) { out.at[k] = ts; });
  SECTION_KEYS.forEach(function (k) { out[k] = clone(base[k]); });
  out.homeToolsAt = ts;
  return out;
}

// 本机拥有 section 的现值（不读云、不做合并）
function localSections(s) {
  s = s || {};
  const cache = obj(s.udCache);
  const out = {};
  out.homeTools = arr(s.homeTools).slice(0, 4);
  out.fit = clone(obj(s.fit));
  const dr = obj(s.draw);
  out.draw = {
    start: dr.start == null ? 1 : dr.start,
    end: dr.end == null ? 70 : dr.end,
    count: dr.count == null ? 10 : dr.count,
    dup: !!dr.dup,
    excl: String(dr.excl == null ? '' : dr.excl),
    sort: /^(num|desc|rand)$/.test(dr.sort) ? dr.sort : 'draw'
  };
  const g = obj(s.group);
  out.group = {
    source: (g.source === 'pick' || g.source === 'paste') ? 'names' : 'prev',
    mode: g.mode === 'per' ? 'pergroup' : 'groups',
    n: isFinite(Number(g.n)) ? Number(g.n) : 4,
    shuffle: !!g.shuffle,
    sel: arr(g.sel)
  };
  out.roster = {
    rosterSel: arr(s.rosterSel).slice(),
    rollSel: arr(s.rollSel).slice(),
    rollSt: clone(obj(s.rollSt)),
    rollNames: String(s.rollNames == null ? '' : s.rollNames)
  };
  out.hide = { hwHide: clone(obj(s.hwHide)), ntHide: clone(obj(s.ntHide)) };
  const tt = (cache.tt && typeof cache.tt === 'object') ? Object.assign({}, DEFAULTS.tt, cache.tt) : clone(DEFAULTS.tt);
  tt.termStart = String(s.termStart || '');
  out.tt = tt;
  const hwRemind = clone(obj(s.hwRemind));
  out.prefs = { hwRemind: hwRemind, ntSub: !!s.ntSub, ntSubAt: num(s.ntSubAt) };
  if (cache.nick !== undefined) out.nick = clone(cache.nick);
  return out;
}

// 本人 marks 行 → 全部 val=false 的 upsert 行（清除云端用；与主包 privacy.marksOffRows 一致）
function marksOffRows(rows, sid, now) {
  const s = String(sid == null ? '' : sid).trim();
  const ts = now || Date.now();
  const out = [];
  const seen = {};
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (!r || typeof r !== 'object') return;
    const kind = String(r.kind || '');
    const ref = String(r.ref == null ? '' : r.ref);
    if (!ref || ['hw', 'nt', 'ntdone'].indexOf(kind) < 0) return;
    const id = String(r.id || ((s || String(r.seat || '')) + '|' + kind + '|' + ref));
    if (seen[id]) return;
    seen[id] = 1;
    out.push({ id: id, seat: String(r.seat || s), kind: kind, ref: ref, val: false, ts: ts });
  });
  return out;
}

module.exports = {
  VERSION: VERSION, SECTION_KEYS: SECTION_KEYS, DEFAULTS: DEFAULTS, SCOPE: SCOPE,
  emptyV6: emptyV6, emptyBlob: emptyBlob, localSections: localSections, baselineBlob: baselineBlob,
  marksOffRows: marksOffRows
};
