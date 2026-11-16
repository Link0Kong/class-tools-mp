// ai/skills/lottery/lib/algo.js —— 抽签 / 分组 / 结果单的算法与本机状态
//
// 逐字节对齐主包页面：
//   pages/draw/draw.js   buildPool / doDraw / refill / removeAt / reset / saveCfg / apply / syncSteps
//   pages/group/group.js members / doGroup / saveCfg
//   pages/sum/sum.js     build（结果单文本）
//   utils/flow.js        zq_flow 结构 { draw, group, updatedAt }
//   utils/roster.js      参与名单 = classMembers 座号；派生文本 roster = "座号 姓名\n…"
//   utils/store.js       store.draw / store.group 参数结构
//
// 唯一差异：随机数可由测试注入（setRng）；生产环境默认 Math.random。
const local = require('../../../common/local.js');
const fmt = require('../../../common/fmt.js');

// 与 pages/draw/draw.js 顶部一致
const SORT_LABEL = { draw: '按抽取顺序', num: '按序号升序', desc: '从大到小', rand: '随机打乱' };

// mcp.json _meta.ui.pagePath 必须与这里一致
const PAGE = {
  draw: { pagePath: '/pages/draw/draw', pageTitle: '打开抽签页' },
  group: { pagePath: '/pages/group/group', pageTitle: '打开分组页' },
  sum: { pagePath: '/pages/sum/sum', pageTitle: '打开结果单页' }
};

// ---------------------------------------------------------------- 随机数（可注入）
let _rng = Math.random;
function setRng(fn) { _rng = (typeof fn === 'function') ? fn : Math.random; return true; }
function rnd() {
  let v = Number(_rng());
  if (!isFinite(v) || v < 0 || v >= 1) v = 0;
  return v;
}
function randInt(n) { return Math.floor(rnd() * n); }

// ---------------------------------------------------------------- 基础（utils/store.normSeats / utils/roster）
function normSeats(list) {
  const out = [], seen = {};
  (Array.isArray(list) ? list : []).forEach(function (v) {
    const n = Number(v);
    if (!isFinite(n) || !Number.isInteger(n) || n < 1 || seen[n]) return;
    seen[n] = 1; out.push(n);
  });
  out.sort(function (a, b) { return a - b; });
  return out;
}

// classMembers 清洗：与 utils/roster.js members() 一致
function members() {
  const raw = local.getClassMembers();
  const out = [], seen = {};
  (Array.isArray(raw) ? raw : []).forEach(function (m) {
    if (!m || typeof m !== 'object') return;
    const seat = Number(m.seat);
    const name = String(m.name == null ? '' : m.name).trim();
    if (!isFinite(seat) || !Number.isInteger(seat) || seat < 1 || !name || seen[seat]) return;
    seen[seat] = true;
    out.push({ seat: seat, sid: String(m.sid == null ? '' : m.sid), name: name });
  });
  out.sort(function (a, b) { return a.seat - b.seat; });
  return out;
}

function pickedOf(seats) {
  const map = {};
  members().forEach(function (m) { map[m.seat] = m; });
  const out = [];
  normSeats(seats).forEach(function (s) { if (map[s]) out.push(map[s]); });
  return out;
}
function textOf(seats) {
  return pickedOf(seats).map(function (m) { return m.seat + ' ' + m.name; }).join('\n');
}
function namesTextOf(seats) {
  return pickedOf(seats).map(function (m) { return m.name; }).join('\n');
}

// "座号 姓名" 文本 → { m:{序号:姓名}, n:人数 }（逐字节对齐 utils/util.js rosterMap）
function rosterMap(str) {
  const m = {};
  let n = 0, idx = 0;
  String(str || '').split(/\r?\n/).forEach(function (line) {
    idx += 1;
    const s = String(line).trim();
    if (!s || /^\d+$/.test(s)) return;
    const mm = s.match(/^(\d+)\s*[.,、:：\-]?\s*(\S.*)$/);
    const num = mm ? +mm[1] : idx;
    const name = mm ? mm[2].trim() : s;
    if (name) { m[num] = name; n += 1; }
  });
  return { m: m, n: n };
}

// ---------------------------------------------------------------- 本机名单选择（utils/roster.setSel 同源）
function selSeats() { return normSeats(local.readStore().rosterSel); }
function groupSelSeats() {
  const d = local.readStore();
  return normSeats(d.group && d.group.sel);
}
function setRosterSel(seats) {
  const list = pickedOf(seats).map(function (m) { return m.seat; });
  local.patchStore(function (d) {
    d.rosterSel = list;
    d.roster = textOf(list);
    return d;
  });
  return list;
}
function setGroupSel(seats) {
  const list = pickedOf(seats).map(function (m) { return m.seat; });
  local.patchStore(function (d) {
    d.group = d.group || {};
    d.group.sel = list;
    d.group.names = namesTextOf(list);
    return d;
  });
  return list;
}

// 显式座号 → 只保留班级名单里存在的座号；返回 { seats, unknown, membersEmpty }
function resolveSeats(input) {
  const req = normSeats(input);
  const mem = members();
  const known = {};
  mem.forEach(function (m) { known[m.seat] = 1; });
  const kept = [], unknown = [];
  req.forEach(function (s) { (known[s] ? kept : unknown).push(s); });
  return { req: req, seats: kept, unknown: unknown, membersEmpty: mem.length === 0 };
}

// ---------------------------------------------------------------- 本机参数（store.draw / store.group）
function loadDraw() {
  const dr = local.readStore().draw || {};
  return {
    start: dr.start == null ? 1 : dr.start,
    end: dr.end == null ? 70 : dr.end,
    count: dr.count == null ? 10 : dr.count,
    dup: !!dr.dup,
    excl: dr.excl || '',
    sort: /^(num|desc|rand)$/.test(dr.sort) ? dr.sort : 'draw',
    autoRe: dr.autoRe !== false
  };
}
function saveDraw(o) {
  local.patchStore(function (d) {
    d.draw = {
      start: +o.start, end: +o.end, count: +o.count,
      dup: !!o.dup, excl: String(o.excl == null ? '' : o.excl),
      sort: o.sort, autoRe: o.autoRe !== false,
      // 2026-11-12 抽签升级 v1（web/draw/CONTRACT.md §3.1）：draw.names = 自定义序号名称映射文本，
      // 由小程序抽签页维护、随 userdata v6 同步；AI 只改抽签参数，必须原样保留，避免写回时清空映射。
      names: String((d.draw && d.draw.names) || '')
    };
    return d;
  });
}
function loadGroup() {
  const g = local.readStore().group || {};
  return {
    source: (g.source === 'pick' || g.source === 'paste') ? 'pick' : 'prev',
    mode: g.mode === 'per' ? 'per' : 'groups',
    n: g.n == null ? 4 : g.n,
    shuffle: !!g.shuffle
  };
}
function saveGroup(o) {
  // 与 pages/group/group.js saveCfg 完全一致（页面 source 用 'prev' | 'pick'）
  local.patchStore(function (d) {
    d.group = d.group || {};
    d.group.source = o.source === 'pick' || o.source === 'roster' ? 'pick' : 'prev';
    d.group.mode = o.mode === 'per' || o.mode === 'size' ? 'per' : 'groups';
    d.group.n = +o.n || 2;
    d.group.shuffle = !!o.shuffle;
    return d;
  });
}

// ---------------------------------------------------------------- 抽签池（pages/draw buildPool 逐字节）
function poolFilter(pool, seats) {
  const sel = normSeats(seats);
  const base = (pool || []).slice();
  if (!sel.length) return base;
  const set = {};
  sel.forEach(function (s) { set[s] = true; });
  return base.filter(function (n) { return !!set[n]; });
}
function buildPool(start, end, exclText, seats) {
  const lo = Math.min(+start, +end);
  const hi = Math.max(+start, +end);
  const excl = fmt.parseExcl(exclText);
  const range = [];
  for (let i = lo; i <= hi; i++) { if (excl.indexOf(i) < 0) range.push(i); }
  const sel = normSeats(seats);
  return { lo: lo, hi: hi, excl: excl, pool: poolFilter(range, sel), sel: sel };
}

// 结果 cfg（pages/draw doDraw 里的 st.cfg 逐字节；注意 range 用 " – " 连接）
function resultCfg(b, n, dup, sortKey) {
  return {
    range: b.lo + ' – ' + b.hi,
    rangeF: b.lo + '-' + b.hi,
    count: String(n),
    dup: dup ? '是' : '否',
    excl: b.excl.length ? b.excl.join(',') : '无',
    sort: SORT_LABEL[sortKey] || '按抽取顺序',
    pool: String(b.pool.length),
    sel: String(b.sel.length),
    selF: b.sel.join(',')
  };
}

// ---------------------------------------------------------------- 抽签算法（pages/draw doDraw）
function doDraw(opts) {
  const b = opts.pool;
  const n = opts.n;
  const dup = !!opts.dup;
  const res = [];
  if (dup) {
    for (let k = 0; k < n; k++) res.push(b.pool[randInt(b.pool.length)]);
  } else {
    const p = b.pool.slice();
    for (let j = p.length - 1; j > 0; j--) {
      const r = randInt(j + 1);
      const t = p[j]; p[j] = p[r]; p[r] = t;
    }
    for (let i = 0; i < n && i < p.length; i++) res.push(p[i]);
  }
  return {
    result: res, pool: b.pool.slice(), removed: [], log: [],
    cfg: resultCfg(b, n, dup, opts.sort)
  };
}

// 结果 → 展示行（pages/draw apply 同源：姓名只取派生名单文本 store.roster）
function drawRows(st, sort) {
  const rm = rosterMap(local.readStore().roster).m;
  let rows = (st.result || []).map(function (n) { return { n: n, nm: rm[n] || '' }; });
  if (sort === 'num') rows = rows.slice().sort(function (a, b) { return a.n - b.n; });
  else if (sort === 'desc') rows = rows.slice().sort(function (a, b) { return b.n - a.n; });
  return rows.map(function (r, i) { return { n: r.n, nm: r.nm, key: i }; });
}
function itemsOf(rows) {
  return (rows || []).map(function (r) { return { number: r.n, name: r.nm || '' }; });
}

// 步骤条（pages/* syncSteps）
function steps() {
  const fl = local.getFlow();
  const drawN = (fl.draw && fl.draw.result) ? fl.draw.result.length : 0;
  const grpN = (fl.group && fl.group.result) ? fl.group.result.length : 0;
  return [
    { id: 's1', label: '抽签', done: drawN > 0 },
    { id: 's2', label: '分组', done: grpN > 0 },
    { id: 's3', label: '结果单', done: !!(drawN && grpN) }
  ];
}

function patchDraw(st) { return local.patchFlow('draw', st); }
function patchGroup(st) { return local.patchFlow('group', st); }
function resetBoth() {
  local.patchFlow('draw', null);
  local.patchFlow('group', null);
  return local.getFlow();
}
function nowText() { return fmt.fmtDateTime(Date.now()); }

// ---------------------------------------------------------------- 补抽（pages/draw refill 逐字节）
function refill(st, target) {
  const pool = st.pool || [];
  const picked = {};
  (st.result || []).forEach(function (n) { picked[n] = true; });
  const added = [];
  while (st.result.length < target) {
    const avail = pool.filter(function (n) { return st.cfg && st.cfg.dup === '是' ? true : !picked[n]; });
    if (!avail.length) break;
    const n = avail[randInt(avail.length)];
    st.result.push(n); picked[n] = true; added.push(n);
    st.log = (st.log || []).concat([{ t: nowText(), n: n, act: '补抽' }]);
  }
  return added;
}

// ---------------------------------------------------------------- 剔除（pages/draw removeAt 逐字节；按序号定位）
function removeAt(st, number, autoRe) {
  const result = st.result || [];
  const idx = result.indexOf(number);
  if (idx < 0) return { ok: false };
  result.splice(idx, 1);
  st.removed = (st.removed || []).concat([number]);
  st.log = (st.log || []).concat([{ t: nowText(), n: number, act: '剔除' }]);
  let added = null;
  // 剔除后自动重抽（与网页版 #aAutoRe 同义）
  if (autoRe !== false) {
    const cfg = st.cfg || {};
    const pool = (st.pool || []).filter(function (p) {
      return (st.removed || []).indexOf(p) < 0 && (cfg.dup === '是' || (st.result || []).indexOf(p) < 0);
    });
    if (pool.length) {
      const pick = pool[randInt(pool.length)];
      st.result.push(pick);
      st.log.push({ t: nowText(), n: pick, act: '补抽' });
      added = pick;
    }
  }
  return { ok: true, added: added };
}

// ---------------------------------------------------------------- 分组（pages/group doGroup 逐字节）
function shuffleList(list) {
  for (let j = list.length - 1; j > 0; j--) {
    const r = randInt(j + 1);
    const t = list[j]; list[j] = list[r]; list[r] = t;
  }
  return list;
}
// opts: { source:'prev'|'pick', mem:[{n,nm}], mode:'groups'|'per', value, shuffle }
function doGroup(opts) {
  const mem = opts.mem || [];
  const n = +opts.value || 2;
  const groups = opts.mode === 'groups'
    ? Math.min(Math.max(2, n), mem.length)
    : Math.max(1, Math.ceil(mem.length / Math.max(1, n)));
  const list = mem.slice();
  if (opts.shuffle) shuffleList(list);
  const out = [];
  for (let i = 0; i < groups; i++) out.push([]);
  list.forEach(function (p, i) { out[i % groups].push(p); });
  const st = {
    result: out,
    cfg: {
      source: opts.source === 'prev' ? '上一步抽签序号' : ('班级名单（' + mem.length + ' 人）'),
      mode: opts.mode === 'groups' ? ('按组数(' + groups + ' 组)') : ('按每组人数(' + n + ' 人)'),
      total: String(mem.length),
      groups: String(groups),
      inner: opts.shuffle ? '打乱后随机分配' : '按原顺序轮流分配'
    }
  };
  return { st: st, groups: groups };
}
// 上一步抽签序号成员（pages/group members 的 prev 分支）
function prevMembers() {
  const fl = local.getFlow();
  if (!fl.draw || !fl.draw.result || !fl.draw.result.length) return null;
  const rm = rosterMap(local.readStore().roster).m;
  return fl.draw.result.map(function (x) { return { n: x, nm: rm[x] || '' }; });
}
function groupSelMembers() {
  return pickedOf(groupSelSeats()).map(function (m) { return { n: m.seat, nm: m.name }; });
}
// group 结果解读（cfg 文案 → 结构化字段）
function groupInfo(st) {
  const cfg = st.cfg || {};
  const srcText = String(cfg.source || '');
  const modeText = String(cfg.mode || '');
  const source = /^上一步/.test(srcText) ? 'prev' : 'roster';
  const mode = /^按组数/.test(modeText) ? 'groups' : 'size';
  let value = 0;
  if (mode === 'groups') value = Number(cfg.groups) || 0;
  else {
    const mm = modeText.match(/按每组人数\((\d+)\s*人\)/);
    value = mm ? +mm[1] : (Number(local.readStore().group.n) || 0);
  }
  const result = st.result || [];
  return {
    source: source,
    mode: mode,
    value: value,
    shuffle: /^打乱/.test(String(cfg.inner || '')),
    groups: result.map(function (gp, i) {
      return {
        index: i + 1,
        members: (gp || []).map(function (m) { return { number: m.n, name: m.nm || '' }; })
      };
    }),
    total: Number(cfg.total) || result.reduce(function (a, g) { return a + (g || []).length; }, 0)
  };
}

// ---------------------------------------------------------------- 结果单（pages/sum build 逐字节）
function buildSummary() {
  const fl = local.getFlow();
  const rm = rosterMap(local.readStore().roster).m;
  const rn = Object.keys(rm).length;
  const docs = [];
  let drawBlock = null;
  let groupBlocks = null;

  if (fl.draw && fl.draw.result) {
    const A = fl.draw, c = A.cfg || {};
    docs.push(['抽签 · 范围', c.range], ['抽签 · 个数', c.count], ['抽签 · 允许重复', c.dup],
      ['抽签 · 排除', c.excl], ['抽签 · 排序', c.sort]);
    if (rn) docs.push(['抽签 · 名单对应', '已启用（' + rn + ' 人）']);
    const runs = [];
    const items = [];
    A.result.forEach(function (n) {
      const nm = rm[n];
      if (nm) { runs.push({ t: String(n) + ' ', dim: true }); runs.push({ t: nm + '  ', strong: true, glue: true }); }
      else runs.push({ t: String(n) + '  ' });
      items.push({ n: n, nm: nm || '', k: items.length });
    });
    if (A.removed && A.removed.length) docs.push(['抽签 · 剔除', A.removed.join(',')]);
    drawBlock = { label: '抽签结果（' + A.result.length + ' 个）', mono: false, lines: [runs], items: items };
  }

  if (fl.group && fl.group.result) {
    const G = fl.group, c = G.cfg || {};
    docs.push(['分组 · 成员来源', c.source], ['分组 · 方式', c.mode], ['分组 · 人数', c.total],
      ['分组 · 组数', c.groups], ['分组 · 成员分配', c.inner]);
    groupBlocks = G.result.map(function (gp, i) {
      const runs = [];
      const items = [];
      gp.forEach(function (m) {
        if (m.nm && m.n != null) { runs.push({ t: String(m.n) + ' ', dim: true }); runs.push({ t: m.nm + '   ', strong: true, glue: true }); }
        else if (m.nm) runs.push({ t: m.nm + '   ', strong: true });
        else runs.push({ t: String(m.n) + '   ' });
        items.push({ n: m.n == null ? '' : m.n, nm: m.nm || '', k: items.length });
      });
      return { label: '第 ' + (i + 1) + ' 组（' + gp.length + ' 人）', mono: false, lines: [runs], items: items };
    });
  }

  const textLines = docs.map(function (kv) { return kv[0] + '：' + kv[1]; });
  let text = textLines.join('\n');
  if (drawBlock) text += '\n\n' + drawBlock.lines[0].map(function (r) { return r.t; }).join('');
  if (groupBlocks) {
    groupBlocks.forEach(function (b) {
      text += '\n\n' + b.label + '\n' + b.lines[0].map(function (r) { return r.t; }).join('');
    });
  }

  let sub = '';
  if (fl.draw && fl.draw.cfg) sub = '范围 ' + fl.draw.cfg.range;
  if (fl.group && fl.group.cfg) sub = (sub ? sub + ' · ' : '') + fl.group.cfg.groups + ' 组';

  return {
    docs: docs, drawBlock: drawBlock, groupBlocks: groupBlocks, text: text, sub: sub,
    draw: fl.draw || null, group: fl.group || null
  };
}

// 结果单 text 上限（契约：≤2000 字）
function capText(t, max) {
  const s = String(t == null ? '' : t);
  const m = max || 2000;
  if (s.length <= m) return s;
  return s.slice(0, m - 10) + '…（已截断）';
}

// 数值工具（原子接口入参宽松解析：接受 number 或纯数字字符串）
function intOf(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return +v.trim();
  return null;
}
function numOf(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && isFinite(+v.trim())) return +v.trim();
  return null;
}

module.exports = {
  SORT_LABEL: SORT_LABEL,
  PAGE: PAGE,
  setRng: setRng, rnd: rnd, randInt: randInt,
  normSeats: normSeats, members: members, pickedOf: pickedOf, textOf: textOf, namesTextOf: namesTextOf,
  rosterMap: rosterMap, selSeats: selSeats, groupSelSeats: groupSelSeats,
  setRosterSel: setRosterSel, setGroupSel: setGroupSel, resolveSeats: resolveSeats,
  loadDraw: loadDraw, saveDraw: saveDraw, loadGroup: loadGroup, saveGroup: saveGroup,
  poolFilter: poolFilter, buildPool: buildPool, resultCfg: resultCfg,
  doDraw: doDraw, drawRows: drawRows, itemsOf: itemsOf, steps: steps,
  patchDraw: patchDraw, patchGroup: patchGroup, resetBoth: resetBoth, nowText: nowText,
  refill: refill, removeAt: removeAt,
  shuffleList: shuffleList, doGroup: doGroup, prevMembers: prevMembers,
  groupSelMembers: groupSelMembers, groupInfo: groupInfo,
  buildSummary: buildSummary, capText: capText,
  intOf: intOf, numOf: numOf
};
