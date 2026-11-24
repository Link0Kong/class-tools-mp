// utils/task.js —— 个人任务数据层（与网页 taskdata 同格式）
//
// 设计口径（2026-11-22，移植网页任务模块）：
//   * 本机数据存 store.get().task（不进 userdata v6；store.saveQuiet 不触发 UD 脏检测）
//   * 云端仍是 public.taskdata 一张表（id = sid，blob = 任务快照 JSON，ts = updatedAt）
//   * 任务/分组/步骤字段与网页 taskNormData 对齐；附件只在本机（云端 taskCloudView 清空）
//   * 左侧视图顺序 = prefs.sidebarOrder/sidebarOrderAt；分组顺序 = lists[].order
//   * 附件在 MP 用本地文件 path（{id,n,t,s,path,img}），网页侧读云端时本来就清空附件
const store = require('./store.js');
const util = require('./util.js');
const identity = require('./identity.js');
const cloud = require('./cloud.js');

const UI_KEY = 'zq_task_ui_mp_v1';
const OWNER_KEY = 'zq_task_owner_v1';
const SMART = [
  { k: 'myday', n: '我的一天', icon: '☀' },
  { k: 'important', n: '重要', icon: '★' },
  { k: 'planned', n: '计划中', icon: '▤' },
  { k: 'all', n: '全部', icon: '≡' },
  { k: 'done', n: '已完成', icon: '✓' }
];
const COLORS = ['cy', 'bl', 'sd', 'violet', 'rose', 'teal'];
const COLOR_HEX = { cy: '#5E8F87', bl: '#7D9EBB', sd: '#C6A475', violet: '#9B8FB5', rose: '#C08F89', teal: '#6FA6A0' };
const TTL = 60000;
const MAX_ITEMS = 2000, MAX_LISTS = 30, MAX_STEPS = 50, MAX_NOTE = 500, MAX_TITLE = 200, MAX_NOTES = 5000;

let cache = null;
let syncState = { sid: '', booted: false, pulling: false, pushing: false, lastPull: 0, dirty: false, status: '仅本机', base: null };
let syncTimer = 0, pullP = null, pushP = null;
let statusListener = null;

function now() { return Date.now(); }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function today() { return ymd(new Date()); }
function idOk(s) { return /^[A-Za-z0-9_-]{1,48}$/.test(String(s == null ? '' : s)); }
function newId(p) { return String(p || 't') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function oneLine(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function dateOk(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = util.toDate(s);
  return !!d && ymd(d) === s;
}
function timeOk(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s == null ? '' : s)); }
function colorOk(c) { return COLORS.indexOf(String(c)) >= 0 ? String(c) : 'cy'; }

function emptyTaskData() {
  return {
    v: 1, lists: [], items: [],
    prefs: { sound: true, defaultRemind: 'none', sidebarOrder: [], sidebarOrderAt: 0 },
    updatedAt: 0
  };
}

function parseAttachments(v) {
  let a = v;
  if (typeof v === 'string') { try { a = JSON.parse(v); } catch (e) { a = []; } }
  if (!Array.isArray(a)) return [];
  return a.filter(function (x) { return x && x.n && (x.path || x.d); }).slice(0, 2).map(function (x) {
    return {
      id: String(x.id || ''),
      n: String(x.n).slice(0, 120),
      t: String(x.t || ''),
      s: Number(x.s) || 0,
      path: String(x.path || ''),
      d: String(x.d || ''),
      img: !!x.img || /^image\//.test(String(x.t || ''))
    };
  });
}
function attJson(list) {
  if (!list || !list.length) return '';
  const out = list.map(function (a) {
    return { id: a.id || '', n: a.n, t: a.t, s: a.s, path: a.path || '', d: a.d || '', img: !!a.img };
  });
  return JSON.stringify(out);
}

function normStep(s) {
  let text = '', done = false, note = '';
  if (s && typeof s === 'object') {
    text = String(s.text == null ? (s.t == null ? '' : s.t) : s.text);
    done = !!(s.done == null ? s.d : s.done);
    note = String(s.note == null ? '' : s.note).replace(/\r\n?/g, '\n').trim();
  } else {
    text = String(s == null ? '' : s);
  }
  text = text.trim();
  if (!text) return null;
  return { text: text.slice(0, 120), done: done, note: note.slice(0, MAX_NOTE) };
}

function normItem(x, listIds, idx) {
  if (!x || typeof x !== 'object') return null;
  let title = oneLine(x.title);
  if (!title) return null;
  title = title.slice(0, MAX_TITLE);
  let list = String(x.list == null ? '' : x.list);
  if (list === 'inbox') list = '';
  if (list && listIds.indexOf(list) < 0) list = '';
  let due = dateOk(x.due) ? String(x.due) : '';
  let dueTime = (due && timeOk(x.dueTime)) ? String(x.dueTime) : '';
  let mode = String(x.remindMode == null ? 'none' : x.remindMode);
  if (['none', 'due', '5', '15', '30', '60', '1440', 'custom'].indexOf(mode) < 0) mode = 'none';
  let custom = Number(x.remindCustom);
  if (!isFinite(custom) || custom <= 0) custom = 0;
  if (mode === 'custom' && !custom) {
    const ra = Number(x.remindAt);
    if (isFinite(ra) && ra > 0) custom = ra;
  }
  if (mode === 'none' && Number(x.remindAt) > 0) { mode = 'custom'; custom = Number(x.remindAt); }
  if (mode === 'custom' && !custom) mode = 'none';
  if (mode !== 'none' && mode !== 'custom' && !due) mode = 'none';
  let repeat = String(x.repeat == null ? '' : x.repeat);
  if (['', 'daily', 'weekday', 'weekly', 'monthly', 'yearly'].indexOf(repeat) < 0) repeat = '';
  const steps = [];
  (Array.isArray(x.steps) ? x.steps : []).slice(0, MAX_STEPS).forEach(function (s) {
    const n = normStep(s); if (n) steps.push(n);
  });
  const tags = [];
  (Array.isArray(x.tags) ? x.tags : []).forEach(function (t) {
    t = String(t == null ? '' : t).replace(/^#+/, '').trim();
    if (t && tags.indexOf(t) < 0 && tags.length < 6) tags.push(t.slice(0, 16));
  });
  const id = idOk(x.id) ? String(x.id) : newId('t');
  let created = Number(x.createdAt);
  if (!isFinite(created) || created <= 0) created = now();
  let updated = Number(x.updatedAt);
  if (!isFinite(updated) || updated <= 0) updated = created;
  const done = !!x.done;
  let srcHw = String(x.sourceHwId == null ? '' : x.sourceHwId);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(srcHw)) srcHw = '';
  let srcNt = String(x.sourceNoticeId == null ? '' : x.sourceNoticeId);
  if (!srcNt || srcNt.length > 140 || /\s/.test(srcNt)) srcNt = '';
  return {
    id: id, title: title,
    notes: String(x.notes == null ? '' : x.notes).slice(0, MAX_NOTES),
    list: list, done: done,
    doneAt: done ? (Number(x.doneAt) > 0 ? Number(x.doneAt) : updated) : 0,
    due: due, dueTime: dueTime, remindMode: mode,
    remindAt: calcRemindAt(due, dueTime, mode, custom),
    remindCustom: custom, repeat: repeat, starred: !!x.starred,
    myDay: dateOk(x.myDay) ? String(x.myDay) : '',
    tags: tags, steps: steps, attachments: attJson(parseAttachments(x.attachments)),
    sourceHwId: srcHw,
    sourceTitle: oneLine(x.sourceTitle).slice(0, 80),
    sourceNoticeId: srcNt,
    createdAt: created, updatedAt: updated,
    order: isFinite(Number(x.order)) ? Number(x.order) : (Number(idx) || 0),
    fromId: idOk(x.fromId) ? String(x.fromId) : '',
    lastNotifyAt: Number(x.lastNotifyAt) || 0,
    snoozeUntil: Number(x.snoozeUntil) || 0
  };
}

function normData(raw) {
  const out = emptyTaskData();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const seen = {};
  (Array.isArray(raw.lists) ? raw.lists : []).slice(0, MAX_LISTS).forEach(function (l) {
    if (!l || typeof l !== 'object') return;
    let id = idOk(l.id) ? String(l.id) : newId('l');
    if (id === 'inbox' || seen[id]) return;
    const name = oneLine(l.name).slice(0, 20);
    if (!name) return;
    seen[id] = 1;
    out.lists.push({
      id: id, name: name, color: colorOk(l.color),
      order: isFinite(Number(l.order)) ? Number(l.order) : out.lists.length
    });
  });
  out.lists.sort(function (a, b) { return (a.order - b.order) || a.name.localeCompare(b.name, 'zh'); });
  const listIds = out.lists.map(function (l) { return l.id; });
  const used = {};
  (Array.isArray(raw.items) ? raw.items : []).slice(-MAX_ITEMS).forEach(function (x, i) {
    const it = normItem(x, listIds, i);
    if (!it) return;
    while (used[it.id]) it.id = newId('t');
    used[it.id] = 1;
    out.items.push(it);
  });
  const p = (raw.prefs && typeof raw.prefs === 'object') ? raw.prefs : {};
  let dr = String(p.defaultRemind == null ? 'none' : p.defaultRemind);
  if (['none', 'due', '5', '15', '30', '60', '1440'].indexOf(dr) < 0) dr = 'none';
  const so = [];
  (Array.isArray(p.sidebarOrder) ? p.sidebarOrder : []).slice(0, 20).forEach(function (k) {
    k = String(k == null ? '' : k);
    if (k && so.indexOf(k) < 0) so.push(k);
  });
  let soAt = Number(p.sidebarOrderAt);
  if (!isFinite(soAt) || soAt < 0) soAt = 0;
  out.prefs = { sound: p.sound !== false, defaultRemind: dr, sidebarOrder: so, sidebarOrderAt: soAt };
  const ua = Number(raw.updatedAt);
  out.updatedAt = (isFinite(ua) && ua > 0) ? ua : 0;
  return out;
}

function load() {
  if (cache) {
    const sid0 = identity.sid();
    let owner0 = '';
    try { owner0 = String(wx.getStorageSync(OWNER_KEY) || ''); } catch (e) { owner0 = ''; }
    if (!sid0) return cache;
    if (owner0 && owner0 === sid0) return cache;
    cache = null;
  }
  try {
    const sid = identity.sid();
    let owner = '';
    try { owner = String(wx.getStorageSync(OWNER_KEY) || ''); } catch (e) { owner = ''; }
    // 同一台手机换人验证：任务是个人的，旧账号数据不能显示给新账号。
    if (sid && owner && owner !== sid) {
      cache = emptyTaskData();
      store.get().task = cache;
      try { store.saveQuiet(); } catch (e) {}
      try { wx.setStorageSync(OWNER_KEY, sid); } catch (e) {}
      return cache;
    }
    if (sid && !owner) { try { wx.setStorageSync(OWNER_KEY, sid); } catch (e) {} }
    cache = normData(store.get().task);
  } catch (e) { cache = emptyTaskData(); }
  return cache;
}
function saveQuiet() {
  const d = load();
  store.get().task = d;
  try { store.saveQuiet(); } catch (e) {
    try { store.save(); } catch (e2) { /* ignore */ }
  }
}
function save() {
  const d = load();
  d.updatedAt = Math.max(now(), (Number(d.updatedAt) || 0) + 1);
  store.get().task = d;
  try { store.saveQuiet(); } catch (e) { try { store.save(); } catch (e2) {} }
  touch();
  return d;
}
function resetCache() { cache = null; }
function data() { return load(); }
function items() { return load().items || []; }
function lists() { return load().lists || []; }
function prefs() { return load().prefs || {}; }
function findTask(id) {
  const a = items();
  for (let i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
  return null;
}
function findList(id) {
  if (!id) return { id: '', name: '未分组', color: 'cy' };
  const a = lists();
  for (let i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
  return { id: '', name: '未分组', color: 'cy' };
}
function listExact(id) {
  if (!id) return null;
  const a = lists();
  for (let i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
  return null;
}
function nextOrder() {
  const a = items(); let m = 0;
  a.forEach(function (t) { const n = Number(t.order); if (isFinite(n) && n < m) m = n; });
  return m - 1;
}
function nextListOrder() {
  const a = lists(); let m = 0;
  a.forEach(function (l) { const n = Number(l.order); if (isFinite(n) && n > m) m = n; });
  return m + 1;
}
function cleanSidebar(keys) {
  const valid = SMART.map(function (s) { return s.k; }), out = [];
  (keys || []).forEach(function (k) {
    k = String(k == null ? '' : k);
    if (valid.indexOf(k) >= 0 && out.indexOf(k) < 0) out.push(k);
  });
  return out;
}
function sidebar() {
  const p = prefs();
  return { order: cleanSidebar(p.sidebarOrder), at: Number(p.sidebarOrderAt) || 0 };
}
function smartList() {
  const sb = sidebar().order, out = [];
  sb.forEach(function (k) { SMART.forEach(function (s) { if (s.k === k) out.push(s); }); });
  SMART.forEach(function (s) { if (out.indexOf(s) < 0 && sb.indexOf(s.k) < 0) out.push(s); });
  return out;
}
function reorderSidebar(keys) {
  const p = prefs();
  p.sidebarOrder = cleanSidebar(keys);
  if (!p.sidebarOrder.length) p.sidebarOrder = SMART.map(function (s) { return s.k; });
  p.sidebarOrderAt = now();
  save();
  return p.sidebarOrder;
}

// 本机 UI（非账号同步）
function readUi() {
  let o = {};
  try { o = JSON.parse(wx.getStorageSync(UI_KEY) || '{}') || {}; } catch (e) { o = {}; }
  return {
    view: ['myday', 'important', 'planned', 'all', 'done', 'list'].indexOf(o.view) >= 0 ? o.view : 'all',
    list: String(o.list || ''),
    sort: ['default', 'due', 'created', 'important'].indexOf(o.sort) >= 0 ? o.sort : 'default',
    quickStar: !!o.quickStar,
    quickList: String(o.quickList || ''),
    doneOpen: !!o.doneOpen,
    search: String(o.search || '')
  };
}
function writeUi(ui) {
  try { wx.setStorageSync(UI_KEY, JSON.stringify(ui || {})); } catch (e) { /* ignore */ }
}

function emptyItem(extra) {
  return Object.assign({
    id: newId('t'), title: '', notes: '', list: '', done: false, doneAt: 0,
    due: '', dueTime: '', remindMode: 'none', remindAt: 0, remindCustom: 0,
    repeat: '', starred: false, myDay: '', tags: [], steps: [], attachments: '',
    sourceHwId: '', sourceTitle: '', sourceNoticeId: '', createdAt: now(), updatedAt: now(),
    order: nextOrder(), fromId: '', lastNotifyAt: 0, snoozeUntil: 0
  }, extra || {});
}
function upsert(item) {
  if (!item) return null;
  const norm = normItem(item, lists().map(function (l) { return l.id; }), 0);
  if (!norm) return null;
  const a = items(); let hit = -1;
  for (let i = 0; i < a.length; i++) if (a[i].id === norm.id) { hit = i; break; }
  norm.updatedAt = now();
  if (hit >= 0) a[hit] = norm; else a.push(norm);
  save();
  return norm;
}
function removeTask(id) {
  const a = items();
  for (let i = a.length - 1; i >= 0; i--) {
    if (a[i].id === id) {
      try { cleanupTaskFiles(a[i]); } catch (e) {}
      a.splice(i, 1);
    }
  }
  save();
}
function cleanupTaskFiles(t) {
  if (!t || !wx.getFileSystemManager) return;
  const fs = wx.getFileSystemManager();
  parseAttachments(t.attachments).forEach(function (a) {
    if (!a.path) return;
    try { fs.unlink({ filePath: a.path, fail: function () {} }); } catch (e) {}
  });
}
function clearFiles() {
  items().forEach(function (t) { try { cleanupTaskFiles(t); } catch (e) {} });
}
function advanceDate(v, repeat) {
  const p = String(v || today()).split('-');
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  if (repeat === 'daily') d.setDate(d.getDate() + 1);
  else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
  else if (repeat === 'weekday') {
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
  } else if (repeat === 'monthly') {
    const day = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + 1);
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, dim));
  } else if (repeat === 'yearly') {
    const mo = d.getMonth(), dd = d.getDate();
    d.setDate(1); d.setFullYear(d.getFullYear() + 1); d.setMonth(mo);
    const dimY = new Date(d.getFullYear(), mo + 1, 0).getDate();
    d.setDate(Math.min(dd, dimY));
  }
  return ymd(d);
}
function makeNext(t) {
  if (!t || !t.repeat) return null;
  if (items().some(function (x) { return x.fromId === t.id && !x.done; })) return null;
  const stamp = now();
  const base = util.toDate(t.due) || new Date(stamp);
  if (['daily', 'weekly', 'weekday'].indexOf(t.repeat) >= 0) {
    const weeks = Math.max(0, Math.floor((stamp - base.getTime()) / 604800000) - 1);
    base.setDate(base.getDate() + weeks * 7);
  }
  let nextDue = advanceDate(ymd(base), t.repeat);
  while (dateOk(nextDue) && dueMs({ due: nextDue, dueTime: t.dueTime }) <= stamp) {
    nextDue = advanceDate(nextDue, t.repeat);
  }
  const n = JSON.parse(JSON.stringify(t));
  n.id = newId('t'); n.fromId = t.id; n.done = false; n.doneAt = 0;
  n.createdAt = stamp; n.updatedAt = stamp; n.order = (Number(t.order) || 0) + 0.5;
  n.myDay = ''; n.lastNotifyAt = 0; n.snoozeUntil = 0;
  n.steps = (t.steps || []).map(function (s) { return { text: s.text, done: false, note: s.note || '' }; });
  n.due = nextDue;
  if (t.remindMode === 'custom' && t.remindCustom) {
    const oldDue = dueMs({ due: t.due || today(), dueTime: t.dueTime });
    const newDue = dueMs({ due: nextDue, dueTime: t.dueTime });
    n.remindCustom = Math.max(0, Number(t.remindCustom) + ((newDue || 0) - (oldDue || 0)));
  }
  n.remindAt = calcRemindAt(nextDue, t.dueTime || '', t.remindMode, n.remindCustom);
  n.attachments = '';
  items().push(n);
  return n;
}
function setDone(id, val) {
  const t = findTask(id); if (!t) return null;
  if (!!t.done === !!val) return { task: t, next: null };
  let next = null;
  t.done = !!val; t.doneAt = val ? now() : 0; t.updatedAt = now();
  if (val && t.repeat) next = makeNext(t);
  if (!val) {
    const arr = items();
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].fromId === t.id && !arr[i].done && arr[i].updatedAt === arr[i].createdAt) arr.splice(i, 1);
    }
  }
  save();
  return { task: t, next: next };
}
function toggleStar(id) {
  const t = findTask(id); if (!t) return null;
  t.starred = !t.starred; t.updatedAt = now(); save(); return t;
}
function setStepDone(taskId, idx, val) {
  const t = findTask(taskId); if (!t || !t.steps[idx]) return null;
  t.steps[idx].done = !!val; t.updatedAt = now(); save(); return t;
}

function addGroup(name, color) {
  const n = oneLine(name).slice(0, 20);
  if (!n) return null;
  if (lists().length >= MAX_LISTS) { util.toast('分组最多 ' + MAX_LISTS + ' 个'); return null; }
  const l = { id: newId('l'), name: n, color: colorOk(color), order: nextListOrder() };
  lists().push(l); save(); return l;
}
function updateGroup(id, fields) {
  const l = listExact(id); if (!l) return null;
  if (fields && fields.name != null) {
    const n = oneLine(fields.name).slice(0, 20);
    if (!n) return null;
    l.name = n;
  }
  if (fields && fields.color != null) l.color = colorOk(fields.color);
  save(); return l;
}
function deleteGroup(id) {
  if (!id) return false;
  items().forEach(function (t) { if (t.list === id) t.list = ''; });
  const a = lists();
  for (let i = a.length - 1; i >= 0; i--) if (a[i].id === id) a.splice(i, 1);
  save(); return true;
}
function reorderGroups(ids) {
  const a = lists(), by = {}, next = [];
  a.forEach(function (l) { by[l.id] = l; });
  (ids || []).forEach(function (id) { if (by[id] && next.indexOf(by[id]) < 0) next.push(by[id]); });
  a.forEach(function (l) { if (next.indexOf(l) < 0) next.push(l); });
  a.length = 0;
  next.forEach(function (l, i) { l.order = i; a.push(l); });
  save();
  return a.map(function (l) { return l.id; });
}

function dueMs(t) {
  if (!t || !t.due) return null;
  const d = util.toDate(t.due); if (!d) return null;
  const m = String(t.dueTime || '').match(/^(\d{1,2}):(\d{2})$/);
  if (m) d.setHours(+m[1], +m[2], 0, 0); else d.setHours(23, 59, 59, 999);
  return d.getTime();
}
function dueText(t) {
  if (!t || !t.due) return '';
  const d = util.toDate(t.due); if (!d) return t.due;
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const td = today(), tm = ymd(tomorrow);
  let day = '';
  if (t.due === td) day = '今天';
  else if (t.due === tm) day = '明天';
  else day = (d.getMonth() + 1) + '月' + d.getDate() + '日';
  return day + (t.dueTime ? ' ' + t.dueTime : '');
}
function calcRemindAt(due, dueTime, mode, custom) {
  if (mode === 'custom') return Number(custom) || 0;
  if (!due || mode === 'none') return 0;
  const d = util.toDate(due);
  if (!d) return 0;
  const m = String(dueTime || '').match(/^(\d{1,2}):(\d{2})$/);
  if (m) d.setHours(+m[1], +m[2], 0, 0); else d.setHours(23, 59, 59, 999);
  let ms = d.getTime();
  if (mode === 'due') return ms;
  const n = Number(mode);
  return isFinite(n) && n >= 0 ? Math.max(0, ms - n * 60000) : 0;
}
function reminderText(t) {
  if (!t || t.remindMode === 'none') return '';
  if (t.remindMode === 'custom') return t.remindCustom ? '指定提醒' : '';
  if (t.remindMode === 'due') return '到期提醒';
  return '提前 ' + (t.remindMode === '1440' ? '1 天' : (t.remindMode + ' 分钟'));
}
function repeatText(r) {
  return ({ daily: '每天', weekday: '工作日', weekly: '每周', monthly: '每月', yearly: '每年' })[r] || '';
}
function icsEscape(s) {
  return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
function icsText(onlyOpen) {
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ClassTools//Task//ZH-CN', 'CALSCALE:GREGORIAN'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  load().items.forEach(function (t) {
    if (!t.due) return;
    if (onlyOpen !== false && t.done) return;
    const day = String(t.due).replace(/-/g, '');
    const tm = String(t.dueTime || '');
    let start, end;
    if (/^\d{2}:\d{2}$/.test(tm)) {
      start = 'DTSTART:' + day + 'T' + tm.replace(':', '') + '00';
      const d = new Date(String(t.due).replace(/-/g, '/') + ' ' + tm + ':00');
      d.setHours(d.getHours() + 1);
      end = 'DTEND:' + ymd(d) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00';
    } else {
      start = 'DTSTART;VALUE=DATE:' + day;
      const d = new Date(String(t.due).replace(/-/g, '/') + ' 12:00:00');
      d.setDate(d.getDate() + 1);
      end = 'DTEND;VALUE=DATE:' + ymd(d);
    }
    out.push('BEGIN:VEVENT');
    out.push('UID:' + t.id + '@class-tools');
    out.push('DTSTAMP:' + stamp);
    out.push(start);
    out.push(end);
    out.push('SUMMARY:' + icsEscape(t.title));
    const desc = [];
    if (t.notes) desc.push(t.notes);
    if (t.steps && t.steps.length) desc.push('步骤：' + t.steps.map(function (s) { return (s.done ? '✓ ' : '') + s.text; }).join('；'));
    if (desc.length) out.push('DESCRIPTION:' + icsEscape(desc.join('\n')));
    if (t.list) out.push('CATEGORIES:' + icsEscape(findList(t.list).name));
    if (t.tags && t.tags.length) out.push('CATEGORIES:' + icsEscape(t.tags.join(',')));
    out.push('END:VEVENT');
  });
  out.push('END:VCALENDAR');
  return out.join('\r\n') + '\r\n';
}
function viewItems(view, list, search, sort) {
  const d = load();
  let arr = d.items.slice();
  const q = String(search || '').trim().toLowerCase();
  if (q) {
    arr = arr.filter(function (t) {
      return (t.title + ' ' + t.notes + ' ' + (t.tags || []).join(' ') + ' ' + t.sourceTitle).toLowerCase().indexOf(q) >= 0;
    });
  }
  const td = today();
  if (view === 'myday') arr = arr.filter(function (t) { return !t.done && t.myDay === td; });
  else if (view === 'important') arr = arr.filter(function (t) { return !t.done && t.starred; });
  else if (view === 'planned') arr = arr.filter(function (t) { return !t.done && !!t.due; });
  else if (view === 'done') arr = arr.filter(function (t) { return t.done; });
  else if (view === 'list') arr = arr.filter(function (t) { return !t.done && t.list === list; });
  else arr = arr.filter(function (t) { return !t.done; });
  if (view !== 'done') {
    arr.sort(function (a, b) {
      if (sort === 'due') {
        const x = dueMs(a), y = dueMs(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return x - y;
      }
      if (sort === 'created') return (b.createdAt || 0) - (a.createdAt || 0);
      if (sort === 'important') return (b.starred ? 1 : 0) - (a.starred ? 1 : 0);
      return (Number(a.order) || 0) - (Number(b.order) || 0);
    });
  } else {
    arr.sort(function (a, b) { return (b.doneAt || 0) - (a.doneAt || 0); });
  }
  return arr;
}
function counts() {
  const d = load(), td = today();
  const open = d.items.filter(function (t) { return !t.done; });
  return {
    all: open.length,
    myday: open.filter(function (t) { return t.myDay === td; }).length,
    important: open.filter(function (t) { return t.starred; }).length,
    planned: open.filter(function (t) { return !!t.due; }).length,
    done: d.items.filter(function (t) { return t.done; }).length
  };
}

// 班级作业 / 通知 → 任务
function addFromHW(h, bulk) {
  if (!h) return null;
  const sid = idOk(h.id) ? String(h.id) : '';
  if (sid && items().some(function (t) { return t.sourceHwId === sid; })) {
    if (!bulk) util.toast('这项作业已在任务中');
    return null;
  }
  const content = String(h.content || '').trim();
  const subject = String(h.subject || '').trim();
  const first = content.split(/\r?\n/)[0] || '';
  let title = subject ? (subject + (first ? ' · ' + first : '')) : (first || '班级作业');
  title = oneLine(title).slice(0, 100);
  const due = dateOk(h.date) ? String(h.date) : '';
  const time = (due && timeOk(h.time)) ? String(h.time) : '';
  const tags = ['班级作业'];
  if (subject && subject.length <= 16) tags.push(subject);
  let notes = content;
  if (h.due) notes += (notes ? '\n\n' : '') + '截止说明：' + h.due;
  const t = emptyItem({
    title: title, notes: notes.slice(0, MAX_NOTES), list: '', due: due, dueTime: time,
    tags: tags, sourceHwId: sid, sourceTitle: (subject || title).slice(0, 80)
  });
  items().push(t); save();
  if (!bulk) util.toast('已加入任务');
  return t;
}
function noticeDue(g) {
  const vals = [g && g.deadline, g && g.eventAt, g && g.signupEnd, g && g.expireAt];
  for (let i = 0; i < vals.length; i++) {
    if (!vals[i]) continue;
    const d = new Date(vals[i]);
    if (isNaN(d.getTime())) continue;
    let time = '';
    if (d.getHours() || d.getMinutes()) time = pad(d.getHours()) + ':' + pad(d.getMinutes());
    return { due: ymd(d), time: time };
  }
  return { due: '', time: '' };
}
function addFromNotice(g) {
  if (!g) return null;
  const gid = String(g.id || '');
  if (gid && items().some(function (t) { return t.sourceNoticeId === gid; })) {
    util.toast('这条通知已在任务中'); return null;
  }
  let title = oneLine(g.title || '班级通知').slice(0, 100);
  const parts = [];
  if (g.summary) parts.push(String(g.summary));
  if (g.aiSummary) parts.push('摘要：' + String(g.aiSummary));
  (g.items || []).forEach(function (it) {
    if (!it) return;
    if (it.text) parts.push(String(it.text));
    else if (it.kind === 'follow' && it.body) parts.push(String(it.body));
    else if (it.name) parts.push(String(it.name));
  });
  const dm = noticeDue(g);
  const tags = ['通知'];
  const cat = oneLine(g.cat);
  if (cat && cat.length <= 16) tags.push(cat);
  const t = emptyItem({
    title: title, notes: parts.join('\n').slice(0, MAX_NOTES), list: '',
    due: dm.due, dueTime: dm.time, tags: tags,
    sourceTitle: title.slice(0, 80), sourceNoticeId: gid
  });
  items().push(t); save();
  util.toast('通知已加入任务');
  return t;
}

// ---------------------------------------------------------------- 云同步
function taskView(d) {
  const c = JSON.parse(JSON.stringify(d || load()));
  c.items = (c.items || []).map(function (x) { x.attachments = ''; return x; });
  return c;
}
function attMap(d) {
  const m = {};
  (d && d.items || []).forEach(function (x) { if (x.attachments) m[x.id] = x.attachments; });
  return m;
}
function hasData(d) {
  return !!(d && ((d.items && d.items.length) || (d.lists && d.lists.length) ||
    (d.prefs && (d.prefs.sidebarOrder && d.prefs.sidebarOrder.length))));
}
function baseKey() { return 'zq_task_cloud_' + (syncState.sid || identity.sid()); }
function readBase() {
  try { return JSON.parse(wx.getStorageSync(baseKey()) || 'null'); } catch (e) { return null; }
}
function writeBase(ts) {
  try { wx.setStorageSync(baseKey(), JSON.stringify({ ts: Number(ts) || 0 })); } catch (e) {}
}
function setStatus(s) {
  syncState.status = s || '仅本机';
  if (typeof statusListener === 'function') { try { statusListener(syncState.status); } catch (e) {} }
}
function onStatus(fn) { statusListener = fn; }
function syncText() {
  if (!identity.has()) return '登录后同步';
  if (!cloud.isEnabled()) return '仅本机';
  return syncState.status || '已同步';
}
function parseRow(row) {
  try {
    if (!row || row.blob == null || row.blob === '') return null;
    return normData(JSON.parse(row.blob));
  } catch (e) { return null; }
}
function applySnapshot(t, ts) {
  const local = load();
  const att = attMap(local);
  const next = normData(t);
  next.items.forEach(function (x) { x.attachments = att[x.id] || ''; });
  next.updatedAt = Number(ts) || Number(next.updatedAt) || now();
  cache = next;
  store.get().task = next;
  try { store.saveQuiet(); } catch (e) {}
  writeBase(next.updatedAt);
  syncState.dirty = false;
  setStatus('已同步');
  return true;
}
function union(local, remote, rts) {
  const out = normData(remote), lts = Number(local.updatedAt) || 0;
  const seen = {};
  out.items.forEach(function (x) { seen[x.id] = x; });
  local.items.forEach(function (li) {
    const ri = seen[li.id];
    if (!ri) { out.items.push(li); return; }
    if ((li.updatedAt || 0) > (ri.updatedAt || 0)) {
      const i = out.items.indexOf(ri); if (i >= 0) out.items[i] = li;
    }
  });
  const lmap = {};
  local.lists.forEach(function (l) { lmap[l.id] = l; });
  out.lists = out.lists.map(function (rl) { return (lmap[rl.id] && lts > rts) ? lmap[rl.id] : rl; });
  const rseen = {};
  out.lists.forEach(function (l) { rseen[l.id] = 1; });
  local.lists.forEach(function (ll) { if (!rseen[ll.id]) out.lists.push(ll); });
  const lp = local.prefs || {}, rp = out.prefs || {};
  out.prefs.sound = lts > rts ? lp.sound !== false : rp.sound !== false;
  if (lts > rts) out.prefs.defaultRemind = lp.defaultRemind;
  const lsoAt = Number(lp.sidebarOrderAt) || 0, rsoAt = Number(rp.sidebarOrderAt) || 0;
  if (lsoAt > rsoAt) {
    out.prefs.sidebarOrder = cleanSidebar(lp.sidebarOrder);
    out.prefs.sidebarOrderAt = lsoAt;
  } else if (rsoAt > lsoAt) {
    out.prefs.sidebarOrder = cleanSidebar(rp.sidebarOrder);
    out.prefs.sidebarOrderAt = rsoAt;
  }
  out.updatedAt = Math.max(lts, rts, now());
  return out;
}
function fetchRow() {
  const sid = identity.sid();
  if (!sid) return Promise.reject(new Error('no-identity'));
  return cloud.cbGet('taskdata', 'select=*&id=eq.' + encodeURIComponent(sid))
    .then(function (rows) { return (rows && rows[0]) || null; });
}
function push(force) {
  if (pushP) return pushP;
  const sid = identity.sid();
  if (!sid) return Promise.resolve(false);
  setStatus('同步中…');
  pushP = fetchRow().then(function (row) {
    if (identity.sid() !== sid) return false;
    const local = load(), lts = Number(local.updatedAt) || 0;
    if (!hasData(local) && !row) { setStatus('已同步'); return true; }
    const rts = row ? (Number(row.ts) || 0) : 0;
    if (row && rts > lts && !force) {
      const remote = parseRow(row);
      if (remote) { applySnapshot(remote, rts); return true; }
    }
    const body = [{ id: sid, blob: JSON.stringify(taskView(local)), ts: lts }];
    return cloud.cbUpsert('taskdata', body[0]).then(function () {
      if (identity.sid() !== sid) return false;
      writeBase(lts);
      if (load().updatedAt > lts) { touch(); return true; }
      syncState.dirty = false; setStatus('已同步'); return true;
    });
  }).catch(function () { if (identity.sid() === sid) setStatus('仅本机'); return false; }).then(function (x) { if (pushP === request) pushP = null; return x; });
  const request = pushP;
  return pushP;
}
function pull(force) {
  const sid = identity.sid();
  if (pullP) return pullP;
  if (!identity.sid() || !cloud.isEnabled()) { setStatus(identity.sid() ? '仅本机' : '登录后同步'); return Promise.resolve(false); }
  if (!force && syncState.lastPull && Date.now() - syncState.lastPull < TTL) return Promise.resolve(false);
  setStatus('同步中…');
  pullP = fetchRow().then(function (row) {
    if (identity.sid() !== sid) return false;
    syncState.lastPull = now();
    const local = load(), lts = Number(local.updatedAt) || 0;
    if (!row) {
      writeBase(0);
      if (!hasData(local)) { setStatus('已同步'); return true; }
      return push(true);
    }
    const remote = parseRow(row);
    if (!remote) { if (hasData(local)) return push(true); setStatus('已同步'); return true; }
    const rts = Number(row.ts) || Number(remote.updatedAt) || 0;
    const base = readBase();
    if (!base) {
      if (hasData(local)) {
        const merged = union(local, remote, rts);
        applySnapshot(merged, merged.updatedAt);
        return push(true);
      }
      applySnapshot(remote, rts);
      return true;
    }
    if (rts > lts) { applySnapshot(remote, rts); return true; }
    if (lts > rts) return push(true);
    writeBase(rts); setStatus('已同步'); return true;
  }).catch(function () { if (identity.sid() === sid) setStatus('仅本机'); return false; }).then(function (x) { if (pullP === request) pullP = null; return x; });
  const request = pullP;
  return pullP;
}
function touch() {
  if (!identity.sid() || !cloud.isEnabled()) { setStatus(identity.sid() ? '仅本机' : '登录后同步'); return; }
  syncState.dirty = true;
  setStatus('同步中…');
  clearTimeout(syncTimer);
  syncTimer = setTimeout(function () {
    if (readBase()) push(); else pull(true);
  }, 1200);
}
function boot() {
  const sid = identity.sid();
  if (!sid) { setStatus('登录后同步'); return; }
  if (syncState.booted && syncState.sid === sid) return;
  clearTimeout(syncTimer); pullP = null; pushP = null; syncState.dirty = false;
  syncState.sid = sid; syncState.booted = true; syncState.lastPull = 0;
  pull(true);
}
function flush() {
  if (!syncState.dirty) return;
  if (readBase()) push(); else pull(true);
}
function status() { return syncText(); }
function state() {
  return { sid: identity.sid(), dirty: !!syncState.dirty, status: syncText(), lastPull: syncState.lastPull };
}

module.exports = {
  SMART: SMART, COLORS: COLORS, COLOR_HEX: COLOR_HEX,
  emptyTaskData: emptyTaskData, normData: normData, normItem: normItem, parseAttachments: parseAttachments,
  data: data, load: load, save: save, saveQuiet: saveQuiet, resetCache: resetCache,
  items: items, lists: lists, prefs: prefs, findTask: findTask, findList: findList, listExact: listExact,
  emptyItem: emptyItem, upsert: upsert, removeTask: removeTask, setDone: setDone, toggleStar: toggleStar,
  clearFiles: clearFiles,
  setStepDone: setStepDone,
  addGroup: addGroup, updateGroup: updateGroup, deleteGroup: deleteGroup, reorderGroups: reorderGroups,
  sidebar: sidebar, smartList: smartList, reorderSidebar: reorderSidebar,
  readUi: readUi, writeUi: writeUi, viewItems: viewItems, counts: counts,
  dueMs: dueMs, dueText: dueText, reminderText: reminderText, repeatText: repeatText, calcRemindAt: calcRemindAt, icsText: icsText,
  addFromHW: addFromHW, addFromNotice: addFromNotice,
  taskView: taskView, boot: boot, pull: pull, push: push, touch: touch, flush: flush,
  status: status, syncText: syncText, state: state, onStatus: onStatus,
  newId: newId, today: today, dateOk: dateOk, timeOk: timeOk
};
