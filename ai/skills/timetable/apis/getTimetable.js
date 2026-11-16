// ai/skills/timetable/apis/getTimetable.js —— 指定周（默认本周）课表；day 可选 1-7（1=周一）
const result = require('../../../common/result.js');
const auth = require('../../../common/auth.js');
const handoff = require('../../../common/handoff.js');
const fmt = require('../../../common/fmt.js');
const tt = require('../lib/tt.js');

function linkOf(week, day) {
  let path = handoff.PAGES.tt;
  const q = [];
  if (week) q.push('wk=' + week);
  if (day) q.push('day=' + day);
  if (q.length) path += '?' + q.join('&');
  return path;
}

module.exports = async function getTimetable(args) {
  if (!auth.hasIdentity()) return result.identityFail();
  args = args || {};
  const now = tt.nowOf(args);
  let info;
  try {
    info = await tt.loadTimetable({ now: now });
  } catch (e) {
    return result.fromError(e, '课表');
  }
  const courses = info.courses || [];
  if (!courses.length) {
    const text = info.fetchError
      ? '还没取到课表数据（网络不可用），本机也没有缓存。请打开课表页重试同步后再查。'
      : '本机还没有课表数据。请打开课表页加载一次课表后再查。';
    return result.ok(text, {
      week: null, weekText: '', total: 0, days: [],
      hasTimetable: false,
      pagePath: handoff.PAGES.tt, linkText: '打开课表页同步课表'
    }, { handoff: handoff.handoffTo('tt') });
  }

  const cur = info.termStart ? fmt.weekNum(info.termStart, now) : null;
  const max = tt.maxWeek(courses, cur);
  const raw = args.week;
  let week = null;
  let clamped = false;
  if (raw === undefined || raw === null || raw === '' || raw === 'current') {
    week = cur;
  } else if (raw === 'next' || raw === 'prev') {
    if (!cur) {
      return result.invalid('还没有开学日期，无法按「下一周/上一周」查课表。请传入具体周次（1-60），或先用 setTermStart 设置开学日期。');
    }
    const target = cur + (raw === 'next' ? 1 : -1);
    if (target < 1) return result.invalid('现在是第 1 周，没有上一周。');
    if (target > max) {
      return result.ok('已经到最后一周（第 ' + max + ' 周），没有下一周了。', {
        week: max, weekText: '第 ' + max + ' 周', total: 0, days: [],
        hasTimetable: true, pagePath: linkOf(max), linkText: '查看第 ' + max + ' 周课表'
      }, { handoff: handoff.handoffTo('tt', { wk: max }, { week: max }) });
    }
    week = target;
  } else {
    const n = Number(raw);
    if (!isFinite(n) || !Number.isInteger(n) || n < 1 || n > 60) {
      return result.invalid('week 需为 1-60 的整数，或 current / next / prev；不传默认本周。');
    }
    week = n;
  }
  if (week != null) {
    const fixed = Math.max(1, Math.min(max, week));
    if (fixed !== week) clamped = true;
    week = fixed;
  }

  let day = null;
  if (args.day !== undefined && args.day !== null && args.day !== '') {
    const d = Number(args.day);
    if (!isFinite(d) || !Number.isInteger(d) || d < 1 || d > 7) {
      return result.invalid('day 需为 1-7 的整数（1=周一，7=周日）；不传则返回整周。');
    }
    day = d;
  }

  const act = courses.filter(function (c) { return tt.active(c, week); });
  let dayIdx = [0, 1, 2, 3, 4, 5, 6];
  if (day != null) dayIdx = [day - 1];
  else dayIdx = dayIdx.filter(function (di) { return di < 5 || act.some(function (c) { return c.day === di; }); });

  const days = dayIdx.map(function (di) {
    const date = week != null ? tt.dateOf(info.termStart, week, di) : null;
    const list = act.filter(function (c) { return c.day === di; })
      .sort(function (a, b) { return a.start - b.start; })
      .map(function (c) { return tt.courseItem(c); });
    return { day: di + 1, dayText: tt.DAYS[di], dateText: date ? fmt.fmtDate(date) : '', courses: list };
  });
  const total = days.reduce(function (s, d) { return s + d.courses.length; }, 0);

  let text;
  if (week == null) {
    text = '还没有开学日期，无法按周展示，以下是整学期课程（共 ' + total + ' 节）。设置开学日期后可以按周查询。';
  } else if (!total) {
    text = '第 ' + week + ' 周' + (day ? ' ' + tt.DAYS[day - 1] : '') + '没有课。' +
      (clamped ? '（你指定的周次超出学期范围，已按第 ' + week + ' 周展示）' : '');
  } else {
    const parts = days.filter(function (d) { return d.courses.length; }).map(function (d) {
      return d.dayText + ' ' + d.courses.map(function (c) {
        return c.name + '（' + c.span + (c.room ? ' ' + c.room : '') + '）';
      }).join('、');
    });
    text = (week != null ? '第 ' + week + ' 周' : '整学期') + '共 ' + total + ' 节课：' + parts.join('；') + '。';
    if (clamped) text = '（你指定的周次超出学期范围，已按第 ' + week + ' 周展示）' + text;
    text += '需要某节课的教室/教师等详情，可以问我课程名。';
  }

  return result.ok(fmt.truncate(text, 200), {
    week: week,
    weekText: week != null ? ('第 ' + week + ' 周') : '整学期',
    total: total,
    days: days,
    hasTimetable: true,
    termStart: info.termStart || '',
    pagePath: linkOf(week, day),
    linkText: week != null ? ('查看第 ' + week + ' 周课表') : '查看完整课表'
  }, {
    handoff: handoff.handoffTo('tt', { wk: week, day: day }, { week: week, day: day })
  });
};
