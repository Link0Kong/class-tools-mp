// ai/skills/timetable/apis/getTodayCourses.js —— 今天的课程 + 进行中/已结束状态
const result = require('../../../common/result.js');
const auth = require('../../../common/auth.js');
const handoff = require('../../../common/handoff.js');
const fmt = require('../../../common/fmt.js');
const tt = require('../lib/tt.js');

const STATE_TEXT = { done: '已结束', ongoing: '进行中', next: '未开始' };

module.exports = async function getTodayCourses(args) {
  if (!auth.hasIdentity()) return result.identityFail();
  const now = tt.nowOf(args || {});
  let info;
  try {
    info = await tt.loadTimetable({ now: now });
  } catch (e) {
    return result.fromError(e, '课表');
  }
  const dateText = fmt.fmtDate(now);
  const di = tt.dayIndex(now);
  const dayText = tt.DAYS[di];
  const base = {
    date: dateText,
    dayText: dayText,
    week: null,
    courses: [],
    stateText: '',
    hasTimetable: !!(info.courses && info.courses.length),
    pagePath: handoff.PAGES.tt,
    linkText: '打开课表'
  };

  if (!info.termStart) {
    base.stateText = '还没有开学日期，无法判断今天是否有课';
    return result.ok(
      '今天是 ' + dateText + '（' + dayText + '）。还没有开学日期，无法判断今天上不上课。可以让我用 setTermStart 设置开学日期（如 2026-09-01），或打开课表页设置。',
      Object.assign({}, base, { pagePath: handoff.PAGES.tt, linkText: '打开课表页设置开学日期' }),
      { handoff: handoff.handoffTo('tt', '', { reason: 'need-term-start' }) }
    );
  }
  const week = fmt.weekNum(info.termStart, now);
  base.week = week;
  if (!info.courses.length) {
    base.stateText = '课表数据还没同步';
    return result.ok(
      '今天是 ' + dateText + '（' + dayText + '）。课表数据还没同步，取不到今天的课程' +
      (info.fetchError ? '（网络不可用）' : '') + '，请打开课表页加载后再问。',
      base, { handoff: handoff.handoffTo('tt') }
    );
  }
  if (!week) {
    base.stateText = '不在学期内，今天没有排课';
    return result.ok('今天是 ' + dateText + '（' + dayText + '），按开学日期 ' + info.termStart + ' 计算还没进入第 1 周，今天没有排课。',
      base, { handoff: handoff.handoffTo('tt') });
  }

  const list = tt.sessionsOn(info.courses, info.termStart, now, now);
  const courses = list.map(function (s) {
    return tt.courseItem(s._c, { state: s.state, stateText: STATE_TEXT[s.state] || '' });
  });
  base.courses = courses;
  const pagePath = handoff.PAGES.tt + '?wk=' + week + '&day=' + (di + 1);
  base.pagePath = pagePath;

  let stateText = '';
  const ongoing = courses.filter(function (c) { return c.state === 'ongoing'; })[0];
  const upNext = courses.filter(function (c) { return c.state === 'next'; })[0];
  const doneN = courses.filter(function (c) { return c.state === 'done'; }).length;
  if (!courses.length) {
    stateText = '今天没有课';
  } else if (ongoing) {
    stateText = '正在上《' + ongoing.name + '》（' + ongoing.span + '，' + ongoing.endText + ' 下课）';
  } else if (upNext) {
    stateText = '今天还有 ' + (courses.length - doneN) + ' 节课，下一节《' + upNext.name + '》' + upNext.span + ' ' + upNext.startText + ' 开始';
  } else {
    stateText = '今天的课已结束';
  }
  base.stateText = stateText;
  if (upNext) base.next = upNext;

  let text = '今天是 ' + dateText + '（第 ' + week + ' 周 ' + dayText + '），' +
    (courses.length ? ('共 ' + courses.length + ' 节课：' + courses.map(function (c) {
      return c.name + '（' + c.span + ' ' + c.startText + '-' + c.endText + (c.room ? ' ' + c.room : '') + '，' + c.stateText + '）';
    }).join('、')) + '。' : '没有课。') + stateText;
  if (!courses.length) text += '需要看本周课表可以继续问我。';

  return result.ok(fmt.truncate(text, 200), base, {
    handoff: handoff.handoffTo('tt', { wk: week, day: di + 1 }, { week: week, day: di + 1 })
  });
};
