// ai/skills/timetable/apis/getNextCourse.js —— 下一次课（今天起 14 天内最近一节）
const result = require('../../../common/result.js');
const auth = require('../../../common/auth.js');
const handoff = require('../../../common/handoff.js');
const fmt = require('../../../common/fmt.js');
const tt = require('../lib/tt.js');

module.exports = async function getNextCourse(args) {
  if (!auth.hasIdentity()) return result.identityFail();
  const now = tt.nowOf(args || {});
  let info;
  try {
    info = await tt.loadTimetable({ now: now });
  } catch (e) {
    return result.fromError(e, '课表');
  }
  const base = {
    found: false,
    pagePath: handoff.PAGES.tt,
    linkText: '打开课表'
  };
  if (!info.termStart) {
    return result.ok('还没有开学日期，无法计算下一节课。可以让我用 setTermStart 设置开学日期（如 2026-09-01），或打开课表页设置。',
      Object.assign({}, base, { hint: '需要先设置开学日期' }),
      { handoff: handoff.handoffTo('tt', '', { reason: 'need-term-start' }) });
  }
  if (!info.courses.length) {
    return result.ok('课表数据还没同步，取不到下一节课' + (info.fetchError ? '（网络不可用）' : '') + '。请打开课表页加载后再问。',
      Object.assign({}, base, { hint: '课表数据未同步' }),
      { handoff: handoff.handoffTo('tt') });
  }
  const nx = tt.nextSession(info.courses, info.termStart, now);
  if (!nx) {
    return result.ok('接下来 14 天没有排课，可能是学期已结束、开学日期设置有误，或课表未同步。可以打开课表页核对。',
      Object.assign({}, base, { hint: '14 天内没有课' }),
      { handoff: handoff.handoffTo('tt') });
  }
  const c = nx._c;
  const item = tt.courseItem(c, {
    found: true,
    dayText: nx.dayText,
    dateText: nx.dateText,
    dayOffset: nx.dayOffset,
    week: nx.week,
    startAt: nx.startAt,
    endAt: nx.endAt,
    leftText: fmt.leftText(nx.startAt - now.getTime())
  });
  const pagePath = handoff.PAGES.tt + '?wk=' + nx.week;
  const text = '下一节课是《' + item.name + '》，' + nx.dayText + ' ' + nx.dateText + ' ' + item.span +
    '（' + item.startText + '-' + item.endText + '）' +
    (item.room ? '，地点 ' + item.room : '') +
    (item.teacher ? '，' + item.teacher + ' 老师' : '') +
    '，' + item.leftText + '。';
  return result.ok(fmt.truncate(text, 200), Object.assign(item, {
    pagePath: pagePath,
    linkText: '查看第 ' + nx.week + ' 周课表'
  }), {
    handoff: handoff.handoffTo('tt', { wk: nx.week }, { week: nx.week })
  });
};
