// ai/skills/roll/apis/resetRoll.js —— 重置本轮到/假记录（名单保留；破坏性：需 confirmed）
const result = require('../../../common/result.js');
const auth = require('../../../common/auth.js');
const handoff = require('../../../common/handoff.js');
const local = require('../../../common/local.js');
const roll = require('../lib/roll.js');

module.exports = async function resetRoll(args) {
  if (!auth.hasIdentity()) return result.identityFail();
  args = args || {};
  const store = local.readStore();
  const seats = roll.effectiveSeats(store);
  const before = roll.countsOf(seats, store.rollSt || {});
  if (args.confirmed !== true) {
    return result.needConfirm('将清空本轮全部到/假记录（' + seats.length + ' 人的点名名单保留），是否重置？' +
      '请先向用户确认，用户确认后再次调用本接口并传 confirmed=true。');
  }
  const r = roll.resetStatuses();
  const text = '已重置本轮点名：清空了 ' + (before.present + before.absent) + ' 条到/假记录，名单保留 ' +
    seats.length + ' 人。当前 ' + roll.countsText(r.counts) + '。' +
    (local.getCloudOff() ? '云同步已关闭，仅保存在本机。' : '下次打开小程序会自动同步到云端。');

  return result.ok(text, {
    ok: true,
    cleared: before.present + before.absent,
    count: seats.length,
    counts: r.counts,
    pagePath: handoff.PAGES.roll,
    linkText: '打开点名页'
  }, {
    handoff: handoff.handoffTo('roll', '', { reset: true, items: roll.stateItems() })
  });
};
