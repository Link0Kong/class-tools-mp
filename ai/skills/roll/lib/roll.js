// ai/skills/roll/lib/roll.js —— 点名名单/状态（SKILL 内自包含）
//
// 口径来源（逐字对齐）：
//   utils/roster.js：members / pickedOf / pickedSeats / textOf / selOf / rollSet(writeRoll) / parseNames / rollStatusByName
//   pages/roll/roll.js：rollSt 下标 → 'in'(到) / 'ab'(假)；名单只来自 classMembers 座号；rollNames = "座号 姓名" 派生文本
// 本机字段（与主包 store 同结构）：
//   store.rollSel    点名名单座号数组（升序、去重、整数）
//   store.rollNames  派生文本 "座号 姓名" 多行（与 rollSel 下标一一对应）
//   store.rollSt     点到/假记录 { <下标>: 'in' | 'ab' }（下标对应 rollSel/rollNames 顺序）
const local = require('../../../common/local.js');

const STATUS = { present: 'in', absent: 'ab' };
const STATUS_TEXT = { in: '已到', ab: '请假', '': '未点', '到': '已到', '假': '请假' };
const STATUS_CODE = { 'in': 'present', '到': 'present', 'present': 'present', 'ab': 'absent', '假': 'absent', 'absent': 'absent', '': 'unmarked' };

// 读到历史/不同写入方的状态值：'in'|'到' 视为到，'ab'|'假' 视为假（写入统一用 'in'/'ab'，对齐 pages/roll 的 data-v）
function normStatus(v) {
  const s = String(v == null ? '' : v);
  if (s === 'in' || s === '到' || s === 'present') return 'in';
  if (s === 'ab' || s === '假' || s === 'absent') return 'ab';
  return '';
}

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

// classMembers 清洗：seat 正整数 + name 非空 + 按座号升序 + 座号去重（← utils/roster.members）
function members() {
  const raw = local.getClassMembers();
  const out = [], seen = {};
  arr(raw).forEach(function (m) {
    if (!m || typeof m !== 'object') return;
    const seat = Number(m.seat);
    const name = String(m.name == null ? '' : m.name).trim();
    if (!isFinite(seat) || !Number.isInteger(seat) || seat < 1 || !name || seen[seat]) return;
    seen[seat] = 1;
    out.push({ seat: seat, name: name, role: String(m.role || ''), badge: String(m.badge || '') });
  });
  out.sort(function (a, b) { return a.seat - b.seat; });
  return out;
}
function memberMap(list) {
  const map = {};
  (list || []).forEach(function (m) { map[m.seat] = m; });
  return map;
}
function pickedOf(seats) {
  const map = memberMap(members());
  const out = [];
  normSeats(seats).forEach(function (s) { if (map[s]) out.push(map[s]); });
  return out;
}
function classSeats() { return members().map(function (m) { return m.seat; }); }

// "座号 姓名" 多行文本（← utils/roster.textOf）
function textOf(seats) {
  return pickedOf(seats).map(function (m) { return m.seat + ' ' + m.name; }).join('\n');
}

// 名单文本 → 姓名数组（← pages/roll parseNames / utils/roster.parseNames）
function parseNames(text) {
  const out = [];
  String(text == null ? '' : text).split(/\r?\n/).forEach(function (line) {
    let s = String(line).trim();
    if (!s) return;
    const m = s.match(/^\d+\s*[.,、:：\-]?\s*(.+)$/);
    const n = (m ? m[1] : s).trim();
    if (n) out.push(n);
  });
  return out;
}
// 姓名 → 座号（精确匹配 classMembers；匹配不到丢弃）
function seatsFromNames(names) {
  const byName = {};
  members().forEach(function (m) { if (!byName[m.name]) byName[m.name] = m.seat; });
  const out = [];
  arr(names).forEach(function (nm) {
    const s = byName[String(nm).trim()];
    if (s && out.indexOf(s) < 0) out.push(s);
  });
  return normSeats(out);
}
// 旧 rollSt（下标 → 到/假）按姓名转成 { 姓名: 状态 }（← utils/roster.rollStatusByName）
function rollStatusByName(oldNames, oldSt) {
  const byName = {};
  (oldNames || []).forEach(function (nm, i) {
    const s = normStatus((oldSt || {})[i]);
    if (s && !byName[nm]) byName[nm] = s;
  });
  return byName;
}

// 抽签页参与名单（store.rosterSel；兼容旧 roster 文本）
function drawSeats(store) {
  store = store || local.readStore();
  const sel = normSeats(store.rosterSel);
  if (sel.length) return sel;
  if (store.roster) return seatsFromNames(parseNames(store.roster));
  return [];
}

// 点名名单有效座号：优先 rollSel；旧数据只有 rollNames 时按姓名反查（与页面渲染口径一致）
function effectiveSeats(store) {
  store = store || local.readStore();
  const sel = normSeats(store.rollSel);
  if (sel.length) return sel;
  const names = parseNames(store.rollNames);
  if (names.length) return seatsFromNames(names);
  return [];
}

function countsOf(seats, st) {
  let present = 0, absent = 0;
  const n = arr(seats).length;
  for (let i = 0; i < n; i++) {
    const v = normStatus((st || {})[i]);
    if (v === 'in') present += 1;
    else if (v === 'ab') absent += 1;
  }
  return { present: present, absent: absent, unmarked: n - present - absent, total: n };
}

// 名单来源：与抽签页参与名单完全一致 → 'draw'；否则视为从班级名单挑选 → 'class'
function inferSource(store, seats) {
  const list = arr(seats);
  if (!list.length) return '';
  const draw = drawSeats(store);
  if (draw.length === list.length && draw.every(function (s, i) { return s === list[i]; })) return 'draw';
  return 'class';
}
function rowsOf(seats) {
  const picked = pickedOf(seats);
  return picked.map(function (m) { return { seat: m.seat, name: m.name }; });
}

// 写名单（← utils/roster.writeRoll）：按姓名保留 到/假 状态并重排下标；同时写派生 rollNames
function writeRoll(seats) {
  const store = local.readStore();
  const status = rollStatusByName(parseNames(store.rollNames), store.rollSt || {});
  const picked = pickedOf(seats);
  const nextSeats = picked.map(function (m) { return m.seat; });
  const st = {};
  picked.forEach(function (m, i) { if (status[m.name]) st[i] = status[m.name]; });
  local.patchStore(function (d) {
    d.rollSel = nextSeats;
    d.rollNames = picked.map(function (m) { return m.seat + ' ' + m.name; }).join('\n');
    d.rollSt = st;
    return d;
  });
  return {
    seats: picked.map(function (m) { return { seat: m.seat, name: m.name }; }),
    seatsNum: nextSeats,
    rollNames: picked.map(function (m) { return m.seat + ' ' + m.name; }).join('\n'),
    counts: countsOf(nextSeats, st),
    preserved: Object.keys(st).length
  };
}

// 设置某人状态：seat 必须在当前名单里；code ∈ 'in'/'ab'
function setStatus(seat, code) {
  const store = local.readStore();
  const seats = effectiveSeats(store);
  const idx = seats.indexOf(Number(seat));
  if (idx < 0) return null;
  local.patchStore(function (d) {
    const st = Object.assign({}, d.rollSt || {});
    st[idx] = code;
    d.rollSt = st;
    return d;
  });
  const after = local.readStore();
  return { seat: Number(seat), index: idx, counts: countsOf(seats, after.rollSt) };
}

// 给名单里所有人设置同一状态（in/ab）
function setAll(code) {
  const store = local.readStore();
  const seats = effectiveSeats(store);
  const st = {};
  seats.forEach(function (s, i) { st[i] = code; });
  local.patchStore(function (d) { d.rollSt = st; return d; });
  return { counts: countsOf(seats, st) };
}

// 重置本轮：清空到/假记录，名单保留
function resetStatuses() {
  const store = local.readStore();
  const seats = effectiveSeats(store);
  local.patchStore(function (d) { d.rollSt = {}; return d; });
  return { counts: countsOf(seats, {}) };
}

// 汇总条目：按座号升序，带状态码与中文状态
function summaryOf(store) {
  store = store || local.readStore();
  const seats = effectiveSeats(store);
  const st = store.rollSt || {};
  const bySeat = {};
  members().forEach(function (m) { bySeat[m.seat] = m.name; });
  const items = seats.map(function (seat, i) {
    const v = normStatus(st[i]);
    return {
      seat: seat,
      name: bySeat[seat] || '',
      status: STATUS_CODE[v] || 'unmarked',
      statusText: STATUS_TEXT[v] || '未点'
    };
  });
  items.sort(function (a, b) { return a.seat - b.seat; });
  return { items: items, counts: countsOf(seats, st) };
}

// 写本机后的同步说明（点名名单/到·假属于 userdata 同步范围，主包下次打开自动推送）
function syncNote() {
  return local.getCloudOff()
    ? '已保存在本机（云同步已关闭，不会上传云端）。'
    : '已保存在本机，下次打开小程序时会自动同步到云端。';
}
function countsText(c) {
  return '已到 ' + c.present + ' / 请假 ' + c.absent + ' / 未点 ' + c.unmarked + '（共 ' + c.total + ' 人）';
}

// 页面接力 payload 用：当前名单 + 到/假状态（pages/roll 的 applyAgentHandoff 读 payload.items）
function stateItems() { return summaryOf().items; }

module.exports = {
  STATUS: STATUS, STATUS_TEXT: STATUS_TEXT, STATUS_CODE: STATUS_CODE, normStatus: normStatus,
  normSeats: normSeats, members: members, classSeats: classSeats, pickedOf: pickedOf,
  textOf: textOf, parseNames: parseNames, seatsFromNames: seatsFromNames,
  rollStatusByName: rollStatusByName, drawSeats: drawSeats, effectiveSeats: effectiveSeats,
  countsOf: countsOf, inferSource: inferSource, rowsOf: rowsOf,
  syncNote: syncNote, countsText: countsText,
  writeRoll: writeRoll, setStatus: setStatus, setAll: setAll, resetStatuses: resetStatuses, summaryOf: summaryOf,
  stateItems: stateItems
};
