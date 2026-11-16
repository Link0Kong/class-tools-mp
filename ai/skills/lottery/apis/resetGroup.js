// ai/skills/lottery/apis/resetGroup.js —— 重置分组（保留抽签结果）
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const algo = require('../lib/algo.js');
const guard = require('../lib/guard.js');

module.exports = guard.run(async function resetGroup(args) {
  if (args.confirmed !== true) {
    return result.needConfirm('重置会清空当前分组结果（抽签结果保留）。请先向用户确认是否重置；用户确认后再调用 resetGroup 并传 confirmed=true。');
  }
  algo.patchGroup(null);
  const pg = guard.page('group');
  const data = {
    ok: true,
    steps: algo.steps(),
    pagePath: pg.pagePath,
    pageTitle: pg.pageTitle
  };
  return result.ok('已重置分组结果，抽签结果保留。下一步可重新调用 runGroup 分组。', data,
    { handoff: handoff.handoffTo('group', 'step=2') });
}, '分组结果');
