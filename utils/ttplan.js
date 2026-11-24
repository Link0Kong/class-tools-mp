// utils/ttplan.js —— 课表「今天 / 下一次课」计算（工作台用；与 pages/tt 的周表口径一致）
// 课表数据来自教务快照 tt.json，本机缓存在 store.ttCache = { c:[课程...], t:'开学日期', at, meta }
// 课程字段：{ name, teacher, room, day(0=周一), start(1 起), end, weeks:'1-16', parity:'all|odd|even' }
// 说明：这里只做只读计算，不改课表页代码；时间常量与 pages/tt/tt.js 的 PERIODS 保持一致。
const util = require('./util.js');

const PERIODS = [
  ['08:10', '08:50'], ['09:00', '09:40'], ['09:50', '10:30'], ['10:40', '11:20'],
  ['11:30', '12:10'], ['14:30', '15:10'], ['15:20', '16:00'], ['16:10', '16:50'],
  ['17:00', '17:40'], ['19:00', '19:40'], ['19:50', '20:30'], ['20:40', '21:20']
];
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// 连堂课保留一个课程块，课间倒计时指向下一小节。
function focusPeriod(c, clock) {
  for (let p = c.start; p <= c.end && p <= PERIODS.length; p++) {
    if (PERIODS[p - 1] && clock < PERIODS[p - 1][1]) return p;
  }
  return null;
}
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function dayDiff(a, b) { return Math.round((startOfDay(a) - startOfDay(b)) / 86400000); }
function weekdayIndex(d) { const g = d.getDay(); return g === 0 ? 6 : g - 1; }
function pad2(n) { return n < 10 ? '0' + n : '' + n; }

// 个人课表、教务缓存和旧版本机数据按完整课表页的顺序选取。
function localSource(d) {
  if (d.ttLocal && Array.isArray(d.ttLocal.c) && d.ttLocal.c.length) {
    return { kind: 'mine', courses: d.ttLocal.c, term: d.ttLocal.t || d.termStart || '',
      meta: { mine: true, fetchedAt: Number(d.ttLocalAt) || 0 } };
  }
  if (d.ttCache && Array.isArray(d.ttCache.c)) {
    return { kind: 'cache', courses: d.ttCache.c, term: d.ttCache.t || '', meta: d.ttCache.meta || null };
  }
  return { kind: 'local', courses: Array.isArray(d.course) ? d.course : [], term: d.termStart || '', meta: null };
}

// 某门课在某周是否上课（weeks 为空视为全学期；parity 兜底 all）
function active(c, wk) {
  if (!wk) return true;
  const ws = util.parseWeeks(c.weeks);
  if (ws.length && ws.indexOf(wk) < 0) return false;
  if (c.parity === 'odd' && wk % 2 === 0) return false;
  if (c.parity === 'even' && wk % 2 === 1) return false;
  return true;
}

// 开学日期 -> 指定日期属于第几周（第一周 = 开学当周）
function weekOf(term, date) {
  const t = util.toDate(term || '');
  if (!t || isNaN(t)) return null;
  const w = Math.floor(dayDiff(date, t) / 7) + 1;
  return w > 0 ? w : null;
}

// 教室短标识（手机窄卡片）：优先取房间号，例如「自强楼(教室01105)」-> 01105
function roomShort(r) {
  const s = String(r || '').trim();
  if (!s) return '';
  if (s.length <= 7) return s;
  const m = s.match(/(\d{3,6})/);
  if (m) return m[1];
  const d = s.match(/(\d+-\d+)/);
  if (d) return d[1];
  return s.slice(0, 7) + '…';
}

// 某一天在指定周的课程（按开始节次排序），附带进行中 / 已结束状态
function sessionsOn(courses, term, date, now) {
  const wk = weekOf(term, date);
  const di = weekdayIndex(date);
  const list = [];
  (courses || []).forEach(function (c, index) {
    if (!c || c.day !== di) return;
    if (!active(c, wk)) return;
    const p1 = PERIODS[c.start - 1], p2 = PERIODS[c.end - 1];
    if (!p1 || !p2) return;
    const s = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const parts = String(p1[0]).split(':');
    s.setHours(+parts[0] || 0, +parts[1] || 0, 0, 0);
    const e = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const pe = String(p2[1]).split(':');
    e.setHours(+pe[0] || 0, +pe[1] || 0, 0, 0);
    const period = now >= s && now < e ? focusPeriod(c, pad2(now.getHours()) + ':' + pad2(now.getMinutes())) : null;
    const focus = period ? PERIODS[period - 1] : null;
    const bell = new Date(s);
    if (focus) bell.setHours(...focus[0].split(':').map(Number), 0, 0);
    const state = now >= e ? 'done' : (now >= bell ? 'ongoing' : 'next');
    list.push({
      key: di + '-' + index,
      name: c.name || '课程',
      room: roomShort(c.room),
      start: c.start,
      end: c.end,
      startText: p1[0],
      endText: p2[1],
      span: c.end > c.start ? ('第' + c.start + '-' + c.end + '节') : ('第' + c.start + '节'),
      startAt: s.getTime(),
      bellAt: bell.getTime(),
      bellText: focus ? focus[0] : p1[0],
      endAt: e.getTime(),
      state: state
    });
  });
  list.sort(function (a, b) { return a.startAt - b.startAt; });
  return list;
}

// 下一次课：从今天起 14 天内最近的一节（今天已开始的跳过已结束的节次）
function nextSession(courses, term, now) {
  for (let off = 0; off < 14; off++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off);
    const wk = weekOf(term, date);
    if (!wk) continue;
    const list = sessionsOn(courses, term, date, now).filter(function (s) { return s.bellAt > now.getTime(); });
    if (list.length) {
      const item = list.sort((a, b) => a.bellAt - b.bellAt)[0];
      item.startAt = item.bellAt;
      item.startText = item.bellText;
      item.dayOffset = off;
      item.dayText = off === 0 ? '今天' : (off === 1 ? '明天' : DAYS[weekdayIndex(date)]);
      item.dateText = (date.getMonth() + 1) + '/' + date.getDate();
      item.label = item.dayText + ' ' + item.span;
      return item;
    }
  }
  return null;
}

// 工作台主入口：返回 { hasData, week, today:[], todayState, next }
//   todayState: 'has' 有课 / 'done' 今天的课都结束了 / 'none' 今天没课 / 'nodata' 还没有课表
function plan(courses, term, now) {
  now = now || new Date();
  const list = Array.isArray(courses) ? courses : [];
  const out = { hasData: !!(list.length && util.toDate(term)), week: weekOf(term, now), today: [], todayState: 'nodata', next: null };
  if (!out.hasData) return out;
  out.today = out.week ? sessionsOn(list, term, now, now) : [];
  if (!out.today.length) out.todayState = 'none';
  else if (out.today.some(function (s) { return s.state !== 'done'; })) out.todayState = 'has';
  else out.todayState = 'done';
  out.next = nextSession(list, term, now);
  return out;
}

module.exports = {
  focusPeriod: focusPeriod, PERIODS: PERIODS, DAYS: DAYS,
  localSource: localSource, active: active, weekOf: weekOf, roomShort: roomShort,
  sessionsOn: sessionsOn, nextSession: nextSession, plan: plan
};
