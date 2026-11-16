// ai/skills/timetable/apis/getWeekInfo.js —— 当前教学周 / 开学日期 / 总周数
const result = require('../../../common/result.js');
const auth = require('../../../common/auth.js');
const handoff = require('../../../common/handoff.js');
const fmt = require('../../../common/fmt.js');
const tt = require('../lib/tt.js');

module.exports = async function getWeekInfo(args) {
  if (!auth.hasIdentity()) return result.identityFail();
  const now = tt.nowOf(args || {});
  let info;
  try {
    info = await tt.loadTimetable({ now: now });
  } catch (e) {
    return result.fromError(e, '课表');
  }
  const hasTimetable = !!(info.courses && info.courses.length);
  const termStart = info.termStart || '';
  const currentWeek = termStart ? fmt.weekNum(termStart, now) : null;
  const totalWeeks = hasTimetable ? tt.maxWeek(info.courses, currentWeek) : 0;
  let weekText = '';
  if (currentWeek) weekText = '第 ' + currentWeek + ' 周';
  else if (termStart) weekText = '尚未开学';
  else weekText = '未设置开学日期';

  let text;
  if (!termStart) {
    text = '还没有开学日期，无法确定当前是第几周。可以把开学日期告诉我（如 2026-09-01），我用 setTermStart 设置；也可以打开课表页设置。';
  } else if (!currentWeek) {
    text = '开学日期是 ' + termStart + '，今天还没到第 1 周（或日期格式无法识别），暂时算不出当前周。请确认开学日期是否正确。';
  } else {
    text = '现在是第 ' + currentWeek + ' 周（开学日期 ' + termStart + '，' +
      (info.termSource === 'term-start' ? '来自你设置的开学日期' : '来自教务同步的学期开始日期') + '）' +
      (totalWeeks ? '，本学期共 ' + totalWeeks + ' 周。' : '。');
    if (info.termSource === 'tt-sync') text += '如需固定为你自己的开学日期，可以让我设置。';
  }
  if (!hasTimetable) {
    text += info.fetchError ? '课表数据暂时没取到（网络不可用），可以打开课表页重试。' : '课表数据还没同步，可以打开课表页加载。';
  } else if (info.fetchError) {
    text += '（课表为上次同步的缓存，最近一次刷新失败，可稍后再试。）';
  }

  const structured = {
    termStart: termStart,
    currentWeek: currentWeek,
    totalWeeks: totalWeeks,
    weekText: weekText,
    todayText: fmt.fmtDate(now),
    hasTimetable: hasTimetable,
    termSource: info.termSource || '',
    cachedAtText: info.cacheAt ? fmt.fmtDateTime(info.cacheAt) : '',
    pagePath: handoff.PAGES.tt,
    linkText: '打开课表'
  };
  return result.ok(text, structured, {
    handoff: handoff.handoffTo('tt', currentWeek ? { wk: currentWeek } : '', { termStart: termStart, currentWeek: currentWeek })
  });
};
