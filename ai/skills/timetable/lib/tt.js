// ai/skills/timetable/lib/tt.js —— 课表只读计算 + 本机缓存/拉取（SKILL 内自包含，不依赖主包 utils）
//
// 口径来源（逐字对齐，见 _ai_task/CONTRACT.md §5 T3a 与 _ai_task/reports/s3.md）：
//   PERIODS / DAYS / active / weekOf / sessionsOn / nextSession ← utils/ttplan.js
//   dateOf / maxWeek / roomShort（含括号兜底） ← pages/tt/tt.js
//   缓存结构与 6h TTL ← utils/cloud.js ttFetch + TTL.tt；store.ttCache = { c, t, at, meta }
//   tt.json 结构：{ c:[课程...], t:'学期开始日期', meta:{} }
// 课程字段：{ name, teacher, room, day(0=周一), start(1 起), end, weeks:'1-16', parity:'all|odd|even' }
const fmt = require('../../../common/fmt.js');
const local = require('../../../common/local.js');
const rest = require('../../../common/rest.js');

const { PERIODS, focusPeriod } = require('../../../common/periods.js');
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const TT_TTL = 6 * 60 * 60 * 1000;   // 与 utils/cloud.js TTL.tt 一致

// ---------------------------------------------------------------- 时间/周次
function dayIndex(date) { return fmt.weekdayIndex(date); }           // JS 0=周日 → 课表 0=周一
function dayName(di) { return DAYS[di] || ''; }
function weekOf(termStart, date) {
  const t = fmt.toDate(termStart);
  if (!t) return null;
  const w = Math.floor(fmt.dayDiff(date, t) / 7) + 1;
  return w > 0 ? w : null;
}
function maxWeek(courses, cur) {
  let mx = 0;
  (courses || []).forEach(function (c) {
    fmt.parseWeeks(c && c.weeks).forEach(function (n) { if (n > mx) mx = n; });
  });
  return Math.min(Math.max(mx, cur || 0, 18), 30);
}
function dateOf(termStart, wk, di) {
  const t = fmt.toDate(termStart);
  if (!t || isNaN(t) || !wk) return null;
  const d = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  d.setDate(d.getDate() + (wk - 1) * 7 + di);
  return d;
}
function sessionStart(termStart, wk, c) {
  const d = dateOf(termStart, wk, c.day);
  const p = PERIODS[c.start - 1];
  if (!d || !p) return null;
  const hm = String(p[0]).split(':');
  d.setHours(+hm[0] || 0, +hm[1] || 0, 0, 0);
  return d;
}
function sessionEnd(termStart, wk, c) {
  const d = dateOf(termStart, wk, c.day);
  const p = PERIODS[c.end - 1];
  if (!d || !p) return null;
  const hm = String(p[1]).split(':');
  d.setHours(+hm[0] || 0, +hm[1] || 0, 0, 0);
  return d;
}

// ---------------------------------------------------------------- 周次匹配
// 某门课在某周是否上课（weeks 为空视为全学期；parity 兜底 all）—— 与 utils/ttplan.active 一致
function active(c, wk) {
  if (!wk) return true;
  const ws = fmt.parseWeeks(c && c.weeks);
  if (ws.length && ws.indexOf(wk) < 0) return false;
  if (c.parity === 'odd' && wk % 2 === 0) return false;
  if (c.parity === 'even' && wk % 2 === 1) return false;
  return true;
}

// 教室短标识（手机窄卡片）：优先取房间号，例如「自强楼(教室01105)」-> 01105 —— 与 pages/tt/tt.js 一致
function roomShort(r) {
  const s = String(r || '').trim();
  if (!s) return '';
  if (s.length <= 7) return s;
  const m = s.match(/(\d{3,6})/);
  if (m) return m[1];
  const d = s.match(/(\d+-\d+)/);
  if (d) return d[1];
  const q = s.match(/^([^(（]+)[(（]([^)）]*)[)）]$/);
  if (q) {
    if (q[1] === q[2]) return q[1];
    if (q[2].length <= 7) return q[2];
  }
  return s.slice(0, 7) + '…';
}

function parityText(p) {
  if (p === 'odd') return '单周';
  if (p === 'even') return '双周';
  return '每周';
}
function spanOf(c) {
  if (!c || !c.start) return '';
  return c.end > c.start ? ('第' + c.start + '-' + c.end + '节') : ('第' + c.start + '节');
}
// 统一的课程输出结构（getTimetable / getTodayCourses / 下一节 / 详情共用）
function courseItem(c, extra) {
  const p1 = PERIODS[c.start - 1] || ['', ''];
  const p2 = PERIODS[c.end - 1] || ['', ''];
  const it = {
    name: c.name || '课程',
    teacher: c.teacher || '',
    room: roomShort(c.room),
    roomFull: c.room || '',
    span: spanOf(c),
    startText: p1[0],
    endText: p2[1],
    parity: c.parity || 'all',
    parityText: parityText(c.parity),
    weeks: c.weeks || '',
    start: c.start,
    end: c.end,
    day: (typeof c.day === 'number' ? c.day : 0) + 1,   // AI 口径：1=周一
    dayText: DAYS[c.day] || ''
  };
  return Object.assign(it, extra || {});
}

// ---------------------------------------------------------------- 当天课程 / 下一次课（← utils/ttplan.js）
function sessionsOn(courses, termStart, date, now) {
  const wk = weekOf(termStart, date);
  const di = dayIndex(date);
  const list = [];
  (courses || []).forEach(function (c) {
    if (!c || c.day !== di) return;
    if (!active(c, wk)) return;
    const start = sessionStart(termStart, wk, c);
    const end = sessionEnd(termStart, wk, c);
    if (!start || !end) return;
    const period = now >= start && now < end ? focusPeriod(c, ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2)) : null;
    const focus = period ? PERIODS[period - 1] : null;
    const bell = new Date(start);
    if (focus) bell.setHours(...focus[0].split(':').map(Number), 0, 0);
    const state = now >= end ? 'done' : (now >= bell ? 'ongoing' : 'next');
    list.push({
      name: c.name || '课程',
      room: roomShort(c.room),
      start: c.start,
      end: c.end,
      startText: (PERIODS[c.start - 1] || ['', ''])[0],
      endText: (PERIODS[c.end - 1] || ['', ''])[1],
      span: spanOf(c),
      startAt: start.getTime(),
      bellAt: bell.getTime(),
      bellText: focus ? focus[0] : PERIODS[c.start - 1][0],
      endAt: end.getTime(),
      state: state,
      _c: c
    });
  });
  list.sort(function (a, b) { return a.startAt - b.startAt; });
  return list;
}

// 下一次课：从今天起 14 天内最近的一节（今天已开始但未结束的不算「下一次」）
function nextSession(courses, termStart, now) {
  for (let off = 0; off < 14; off++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off);
    const wk = weekOf(termStart, date);
    if (!wk) continue;
    const list = sessionsOn(courses, termStart, date, now).filter(function (s) { return s.bellAt > now.getTime(); });
    if (list.length) {
      const item = list.sort((a, b) => a.bellAt - b.bellAt)[0];
      item.startAt = item.bellAt;
      item.startText = item.bellText;
      item.dayOffset = off;
      item.dayText = off === 0 ? '今天' : (off === 1 ? '明天' : DAYS[dayIndex(date)]);
      item.dateText = (date.getMonth() + 1) + '/' + date.getDate();
      item.label = item.dayText + ' ' + item.span;
      item.week = wk;
      item.date = date;
      return item;
    }
  }
  return null;
}

// 某门课的后续上课日期（最多 n 个，从 after 起算；用于课程详情）
function nextDatesOf(courses, termStart, name, after, n) {
  const all = [];
  const cur = fmt.weekNum(termStart, after);
  const mx = maxWeek(courses, cur);
  (courses || []).forEach(function (c) {
    if (!c || String(c.name) !== String(name)) return;
    for (let w = 1; w <= mx; w++) {
      if (!active(c, w)) continue;
      const start = sessionStart(termStart, w, c);
      if (!start) continue;
      if (after && start.getTime() <= after.getTime()) continue;
      all.push({ at: start.getTime(), date: start, week: w, c: c });
    }
  });
  all.sort(function (a, b) { return a.at - b.at; });
  return all.slice(0, n || 5);
}

// ---------------------------------------------------------------- 课表数据（本机缓存优先，过期拉 tt.json 回写）
function cacheOf(store) {
  const c = store && store.ttCache;
  return (c && Array.isArray(c.c)) ? c : null;
}
function isStale(cache, nowTs) {
  if (!cache || !cache.at) return true;
  return (nowTs - Number(cache.at)) > TT_TTL;
}

// 返回 { courses, termStart, termSource, cacheAt, meta, fetched, fetchError, fromCache, stale }
//   termStart：本机设置（store.termStart）优先；缺失时用教务快照里的 t（ttCache.t）
//   termSource：'term-start'（用户设置）| 'tt-sync'（教务同步）| ''
async function loadTimetable(opts) {
  opts = opts || {};
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
  const store = local.readStore();
  const userTerm = String(store.termStart || '').trim();
  let cache = cacheOf(store);
  const out = {
    courses: [], termStart: '', termSource: '', cacheAt: 0, meta: null,
    fetched: false, fetchError: '', fromCache: false, stale: false
  };
  const apply = function (c) {
    out.courses = Array.isArray(c.c) ? c.c : [];
    out.meta = c.meta || null;
    out.cacheAt = Number(c.at) || 0;
    out.termStart = userTerm || (typeof c.t === 'string' ? c.t : '');
    out.termSource = userTerm ? 'term-start' : (c.t ? 'tt-sync' : '');
  };
  if (cache) { apply(cache); out.fromCache = true; out.stale = isStale(cache, now.getTime()); }
  // 旧版兼容：没有 ttCache 时用 store.course（pages/tt loadCached 的兜底）
  if (!cache && Array.isArray(store.course) && store.course.length) {
    out.courses = store.course;
    out.termStart = userTerm;
    out.termSource = userTerm ? 'term-start' : '';
    out.stale = true;
  }
  const need = !!opts.force || !cache || out.stale;
  if (!need || opts.offline) return out;

  const url = (rest.CONFIG && rest.CONFIG.ttUrl) || '';
  if (!url) { out.fetchError = 'tt-disabled'; return out; }
  try {
    let body = await rest.fetchJson(url);
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
    if (body && Array.isArray(body.c)) {
      const next = {
        c: body.c,
        t: (typeof body.t === 'string' ? body.t : ''),
        at: now.getTime(),
        meta: body.meta || null
      };
      local.setTtCache(next);
      cache = next;
      out.fetched = true;
      out.stale = false;
      apply(next);
    } else {
      out.fetchError = 'invalid-body';
    }
  } catch (e) {
    out.fetchError = (e && e.code) || 'network';
  }
  return out;
}

// 测试可注入时间：args.__now = 毫秒时间戳 | Date | 'YYYY-MM-DD HH:mm'；生产环境恒为当前时间。
// （__now 不声明在 mcp.json inputSchema 里，模型不会传，仅单测使用）
function nowOf(args) {
  const v = args && args.__now;
  if (v === undefined || v === null || v === '') return new Date();
  if (v instanceof Date) return new Date(v.getTime());
  const n = Number(v);
  if (isFinite(n) && n > 0) return new Date(n);
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const d = fmt.toDate(v); if (d) return d; }
    const d2 = new Date(v);
    if (!isNaN(d2.getTime())) return d2;
  }
  return new Date();
}

module.exports = {
  PERIODS: PERIODS, DAYS: DAYS, TT_TTL: TT_TTL, nowOf: nowOf,
  dayIndex: dayIndex, dayName: dayName, weekOf: weekOf, maxWeek: maxWeek,
  dateOf: dateOf, sessionStart: sessionStart, sessionEnd: sessionEnd,
  active: active, roomShort: roomShort, parityText: parityText, spanOf: spanOf, courseItem: courseItem,
  sessionsOn: sessionsOn, nextSession: nextSession, nextDatesOf: nextDatesOf,
  cacheOf: cacheOf, isStale: isStale, loadTimetable: loadTimetable
};
