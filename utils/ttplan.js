// utils/ttplan.js —— 课表「今天 / 下一次课」计算（工作台用；与 pages/tt 的周表口径一致）
// 课表数据来自教务快照 tt.json，本机缓存在 store.ttCache = { c:[课程...], t:'开学日期', at, meta }
// 课程字段：{ name, teacher, room, day(0=周一), start(1 起), end, weeks:'1-16', parity:'all|odd|even' }
// 说明：这里只做只读计算，不改课表页代码；时间常量与 pages/tt/tt.js 的 PERIODS 保持一致。
const util = require('./util.js');

const PERIODS = [
  ['08:10', '08:55'], ['08:55', '09:40'], ['09:50', '10:30'], ['10:40', '11:25'],
  ['11:25', '12:10'], ['14:30', '15:15'], ['15:15', '16:00'], ['16:10', '16:55'],
  ['16:55', '17:40'], ['19:00', '19:45'], ['19:45', '20:30'], ['20:30', '21:20']
];
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function dayDiff(a, b) { return Math.round((startOfDay(a) - startOfDay(b)) / 86400000); }
function weekdayIndex(d) { const g = d.getDay(); return g === 0 ? 6 : g - 1; }
function pad2(n) { return n < 10 ? '0' + n : '' + n; }

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
  (courses || []).forEach(function (c) {
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
    const state = now >= e ? 'done' : (now >= s ? 'ongoing' : 'next');
    list.push({
      name: c.name || '课程',
      room: roomShort(c.room),
      start: c.start,
      end: c.end,
      startText: p1[0],
      endText: p2[1],
      span: c.end > c.start ? ('第' + c.start + '-' + c.end + '节') : ('第' + c.start + '节'),
      startAt: s.getTime(),
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
    const list = sessionsOn(courses, term, date, now).filter(function (s) { return s.startAt > now.getTime(); });
    if (list.length) {
      const item = list[0];
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
  const out = { hasData: !!(list.length && term), week: weekOf(term, now), today: [], todayState: 'nodata', next: null };
  if (!out.hasData) return out;
  out.today = sessionsOn(list, term, now, now);
  if (!out.today.length) out.todayState = 'none';
  else if (out.today.some(function (s) { return s.state !== 'done'; })) out.todayState = 'has';
  else out.todayState = 'done';
  out.next = nextSession(list, term, now);
  return out;
}

module.exports = {
  PERIODS: PERIODS, DAYS: DAYS,
  active: active, weekOf: weekOf, roomShort: roomShort,
  sessionsOn: sessionsOn, nextSession: nextSession, plan: plan
};
