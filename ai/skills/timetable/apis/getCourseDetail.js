// ai/skills/timetable/apis/getCourseDetail.js —— 按课程名查教师/教室/周次/节次/后续上课日期
const result = require('../../../common/result.js');
const auth = require('../../../common/auth.js');
const handoff = require('../../../common/handoff.js');
const fmt = require('../../../common/fmt.js');
const tt = require('../lib/tt.js');

function uniq(list) {
  const out = [];
  list.forEach(function (v) { if (v && out.indexOf(v) < 0) out.push(v); });
  return out;
}

module.exports = async function getCourseDetail(args) {
  if (!auth.hasIdentity()) return result.identityFail();
  args = args || {};
  const now = tt.nowOf(args);
  const rawName = typeof args.courseName === 'string' ? args.courseName.trim() : '';
  if (!rawName) {
    return result.invalid('缺少 courseName（课程名称）。请先调用 getTimetable 获取课程名，再按名称查询。');
  }
  let info;
  try {
    info = await tt.loadTimetable({ now: now });
  } catch (e) {
    return result.fromError(e, '课表');
  }
  const courses = info.courses || [];
  let name = rawName;
  let entries = courses.filter(function (c) { return String(c.name || '').trim() === rawName; });
  if (!entries.length) {
    // 模糊兜底：唯一包含匹配时按该课程处理
    const fuzzy = courses.filter(function (c) { return String(c.name || '').indexOf(rawName) >= 0; });
    const names = uniq(fuzzy.map(function (c) { return String(c.name || ''); }));
    if (names.length === 1) {
      name = names[0];
      entries = courses.filter(function (c) { return String(c.name || '').trim() === name; });
    }
  }
  if (!entries.length) {
    const avail = uniq(courses.map(function (c) { return String(c.name || ''); })).slice(0, 12);
    const text = '没有找到课程「' + rawName + '」。' +
      (avail.length ? '当前课表里的课程有：' + avail.join('、') + '。请确认课程名后再查。' : '本机还没有课表数据，请打开课表页加载后再查。');
    return result.ok(fmt.truncate(text, 200), {
      name: rawName,
      totalSchedules: 0,
      schedules: [],
      nextDates: [],
      availableNames: avail,
      pagePath: handoff.PAGES.tt,
      linkText: '打开课表'
    }, { handoff: handoff.handoffTo('tt') });
  }

  entries.sort(function (a, b) { return (a.day - b.day) || (a.start - b.start); });
  const teachers = uniq(entries.map(function (c) { return String(c.teacher || '').trim(); }));
  const rooms = uniq(entries.map(function (c) { return String(c.room || '').trim(); }));
  const weeksList = uniq(entries.map(function (c) { return String(c.weeks || '').trim(); })).filter(Boolean);
  const parityList = uniq(entries.map(function (c) { return tt.parityText(c.parity); }));
  const parityRaw = entries.some(function (c) { return c.parity === 'odd'; }) ? (entries.every(function (c) { return c.parity === 'odd'; }) ? 'odd' : 'mixed') : (entries.every(function (c) { return c.parity === 'even'; }) ? 'even' : 'all');
  const schedules = entries.map(function (c) {
    return {
      day: (c.day || 0) + 1,
      dayText: tt.DAYS[c.day] || '',
      span: tt.spanOf(c),
      startText: (tt.PERIODS[c.start - 1] || ['', ''])[0],
      endText: (tt.PERIODS[c.end - 1] || ['', ''])[1],
      room: tt.roomShort(c.room),
      roomFull: c.room || '',
      weeks: c.weeks || '',
      parity: c.parity || 'all',
      parityText: tt.parityText(c.parity)
    };
  });
  const nextList = info.termStart ? tt.nextDatesOf(courses, info.termStart, name, now, 5) : [];
  const nextDates = nextList.map(function (x) {
    return (x.date.getMonth() + 1) + '/' + x.date.getDate() + ' ' + tt.DAYS[x.c.day] + ' ' + tt.spanOf(x.c);
  });
  const nextWeek = nextList.length ? nextList[0].week : null;
  const pagePath = handoff.PAGES.tt + (nextWeek ? '?wk=' + nextWeek : '');

  const daySpanText = schedules.map(function (s) { return s.dayText + ' ' + s.span; }).join('、');
  let text = '《' + name + '》' +
    (teachers.length ? '，' + teachers.join('、') + ' 老师' : '') +
    (rooms.length ? '，地点 ' + rooms.join(' / ') : '') +
    '；上课时间：' + daySpanText +
    (weeksList.length ? '（' + weeksList.join('、') + ' 周，' + parityList.join('/') + '）' : '') + '。';
  if (nextDates.length) text += '接下来：' + nextDates.slice(0, 3).join('；') + '。';
  else if (!info.termStart) text += '还没有开学日期，算不出后续上课日期，可以让我设置开学日期后再查。';
  else text += '接下来 14 天内没有该课程。';

  return result.ok(fmt.truncate(text, 200), {
    name: name,
    teacher: teachers.join('、'),
    room: rooms.map(function (r) { return tt.roomShort(r); }).join(' / '),
    roomsFull: rooms.join(' / '),
    weeks: weeksList.join('、'),
    parity: parityRaw,
    parityText: parityList.join('/'),
    dayText: uniq(schedules.map(function (s) { return s.dayText; })).join('、'),
    span: uniq(schedules.map(function (s) { return s.span; })).join('、'),
    totalSchedules: schedules.length,
    schedules: schedules,
    nextDates: nextDates,
    pagePath: pagePath,
    linkText: '查看《' + name + '》在课表中的位置'
  }, {
    handoff: handoff.handoffTo('tt', nextWeek ? { wk: nextWeek } : '', { courseName: name })
  });
};
