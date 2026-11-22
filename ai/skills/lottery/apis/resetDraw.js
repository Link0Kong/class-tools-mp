// ai/skills/lottery/apis/resetDraw.js —— 重置抽签（只清本轮抽签；分组结果与最近抽签快照保留）
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const algo = require('../lib/algo.js');
const guard = require('../lib/guard.js');

module.exports = guard.run(async function resetDraw(args) {
  if (args.confirmed !== true) {
    return result.needConfirm('重置会清空本次抽签结果与剔除记录（不影响分组结果；最近一次抽签仍可供分组沿用）。请先向用户确认是否重置；用户确认后再调用 resetDraw 并传 confirmed=true。');
  }
  algo.resetDraw();
  const pg = guard.page('draw');
  const data = {
    ok: true,
    cleared: { draw: true, group: false },
    pagePath: pg.pagePath,
    pageTitle: pg.pageTitle
  };
  return result.ok('已重置本轮抽签：抽签结果与剔除记录已清空，分组结果不受影响。可以重新调用 runDraw 抽签。',
    data, { handoff: handoff.handoffTo('draw') });
}, '抽签结果');
