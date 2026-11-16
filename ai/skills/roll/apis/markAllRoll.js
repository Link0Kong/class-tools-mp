// ai/skills/roll/apis/markAllRoll.js —— 给名单里所有人标记到/假（破坏性：需 confirmed）
const result = require('../../../common/result.js');
const auth = require('../../../common/auth.js');
const handoff = require('../../../common/handoff.js');
const local = require('../../../common/local.js');
const roll = require('../lib/roll.js');

const INPUT_STATUS = { present: 'in', absent: 'ab' };

module.exports = async function markAllRoll(args) {
  if (!auth.hasIdentity()) return result.identityFail();
  args = args || {};
  const code = INPUT_STATUS[args.status];
  if (!code) {
    return result.invalid('status 只能是 present（全部到）或 absent（全部假）。');
  }
  const store = local.readStore();
  const seats = roll.effectiveSeats(store);
  if (!seats.length) {
    return result.invalid('当前还没有点名名单，无法批量点到。请先调用 setRollRoster 设置名单。');
  }
  const label = code === 'in' ? '已到' : '请假';
  if (args.confirmed !== true) {
    return result.needConfirm('将把点名名单里全部 ' + seats.length + ' 人标记为「' + label + '」，是否执行？' +
      '请先向用户确认，用户确认后再次调用本接口并传 confirmed=true。');
  }
  const r = roll.setAll(code);
  const text = '已把全部 ' + seats.length + ' 人标记为' + label + '。当前 ' + roll.countsText(r.counts) + '。' +
    (local.getCloudOff() ? '云同步已关闭，仅保存在本机。' : '下次打开小程序会自动同步到云端。');

  return result.ok(text, {
    ok: true,
    status: code === 'in' ? 'present' : 'absent',
    statusText: label,
    count: seats.length,
    counts: r.counts,
    pagePath: handoff.PAGES.roll,
    linkText: '打开点名页'
  }, {
    handoff: handoff.handoffTo('roll', '', { status: code, items: roll.stateItems() })
  });
};
