// ai/skills/lottery/apis/resetDraw.js —— 重置抽签与分组
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const algo = require('../lib/algo.js');
const guard = require('../lib/guard.js');

module.exports = guard.run(async function resetDraw(args) {
  if (args.confirmed !== true) {
    return result.needConfirm('重置会清空本次抽签结果、分组结果与剔除记录，且无法恢复。请先向用户确认是否重置；用户确认后再调用 resetDraw 并传 confirmed=true。');
  }
  algo.resetBoth();
  const pg = guard.page('draw');
  const data = {
    ok: true,
    cleared: { draw: true, group: true },
    steps: algo.steps(),
    pagePath: pg.pagePath,
    pageTitle: pg.pageTitle
  };
  return result.ok('已重置抽签与分组：抽签结果、分组结果、剔除记录都已清空。下一步可重新调用 runDraw 抽签，或打开抽签页调整参数。',
    data, { handoff: handoff.handoffTo('draw', 'step=1') });
}, '抽签结果');
