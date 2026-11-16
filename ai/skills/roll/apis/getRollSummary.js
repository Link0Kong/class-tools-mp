// ai/skills/roll/apis/getRollSummary.js —— 点名统计（已到/请假/未点 + 每人状态）
const result = require('../../../common/result.js');
const auth = require('../../../common/auth.js');
const handoff = require('../../../common/handoff.js');
const local = require('../../../common/local.js');
const roll = require('../lib/roll.js');

module.exports = async function getRollSummary() {
  if (!auth.hasIdentity()) return result.identityFail();
  const store = local.readStore();
  const summary = roll.summaryOf(store);
  const counts = summary.counts;
  if (!counts.total) {
    return result.ok('当前还没有点名名单，也没有点到记录。可以先设置名单再开始点名。', {
      total: 0, present: 0, absent: 0, unmarked: 0, items: [],
      pagePath: handoff.PAGES.roll, linkText: '打开点名页'
    }, { handoff: handoff.handoffTo('roll') });
  }
  const un = summary.items.filter(function (x) { return x.status === 'unmarked'; })
    .map(function (x) { return x.seat + ' ' + x.name; }).filter(Boolean);
  let text = '点名统计（共 ' + counts.total + ' 人）：' + roll.countsText(counts) + '。';
  if (un.length) text += '未点：' + un.slice(0, 8).join('、') + (un.length > 8 ? ' 等' : '') + '。';
  else text += '所有人都已标记。';

  return result.ok(text, {
    total: counts.total,
    present: counts.present,
    absent: counts.absent,
    unmarked: counts.unmarked,
    items: summary.items,
    pagePath: handoff.PAGES.roll,
    linkText: '打开点名页'
  }, {
    handoff: handoff.handoffTo('roll', '', { summary: true, items: summary.items })
  });
};
