// ai/skills/timetable/apis/setTermStart.js —— 设置开学日期（写本机 store.termStart，下次打开小程序自动同步）
const result = require('../../../common/result.js');
const auth = require('../../../common/auth.js');
const handoff = require('../../../common/handoff.js');
const local = require('../../../common/local.js');
const fmt = require('../../../common/fmt.js');
const tt = require('../lib/tt.js');

module.exports = async function setTermStart(args) {
  if (!auth.hasIdentity()) return result.identityFail();
  args = args || {};
  const raw = typeof args.termStart === 'string' ? args.termStart.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return result.invalid('termStart 需为 YYYY-MM-DD 格式的开学日期，例如 2026-09-01。');
  }
  const d = fmt.parseDate(raw);
  if (!d || fmt.fmtDate(d) !== raw) {
    return result.invalid('termStart 不是有效日期（如 2026-02-30 不存在）。请确认后重试。');
  }
  const y = d.getFullYear();
  if (y < 2015 || y > 2035) {
    return result.invalid('termStart 年份需在 2015-2035 之间，请确认开学日期是否正确。');
  }
  try {
    local.setTermStart(raw);
  } catch (e) {
    return result.fail('开学日期写入本机失败，请稍后重试。', 'storage-error');
  }
  const now = tt.nowOf(args);
  const currentWeek = fmt.weekNum(raw, now);
  const pagePath = handoff.PAGES.tt + (currentWeek ? '?wk=' + currentWeek : '');
  const cloudOff = local.getCloudOff();
  let text = '已把开学日期设为 ' + raw + '。';
  if (currentWeek) text += '今天（' + fmt.fmtDate(now) + '）是第 ' + currentWeek + ' 周。';
  else text += '今天（' + fmt.fmtDate(now) + '）还没有到第 1 周，开学后会自动进入第 1 周。';
  text += cloudOff
    ? '已保存在本机（云同步已关闭，不会上传云端）。'
    : '已保存在本机，下次打开小程序时会自动同步到云端。';
  text += '需要看这一周的课表可以继续问我。';

  return result.ok(fmt.truncate(text, 200), {
    ok: true,
    termStart: raw,
    currentWeek: currentWeek,
    weekText: currentWeek ? ('第 ' + currentWeek + ' 周') : '尚未开学',
    todayText: fmt.fmtDate(now),
    cloudOff: !!cloudOff,
    pagePath: pagePath,
    linkText: '查看课表'
  }, {
    handoff: handoff.handoffTo('tt', currentWeek ? { wk: currentWeek } : '', { termStart: raw, currentWeek: currentWeek })
  });
};
