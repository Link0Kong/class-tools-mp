// ai/skills/lottery/apis/getDrawResult.js —— 读取当前抽签结果
const local = require('../../../common/local.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const algo = require('../lib/algo.js');
const guard = require('../lib/guard.js');

module.exports = guard.run(async function getDrawResult() {
  const fl = local.getFlow();
  const st = fl.draw;
  const pg = guard.page('draw');
  const base = { pagePath: pg.pagePath, pageTitle: pg.pageTitle };

  if (!st || !st.result || !st.result.length) {
    const data = Object.assign({
      exists: false, items: [], removed: [], cfg: null, steps: algo.steps()
    }, base);
    return result.ok('还没有抽签结果。可以调用 runDraw 立即抽签，或打开抽签页设置参数后再抽。', data,
      { handoff: handoff.handoffTo('draw', 'step=1') });
  }

  const sort = algo.loadDraw().sort;
  const rows = algo.drawRows(st, sort);
  const removed = (st.removed || []).slice();
  const data = Object.assign({
    exists: true,
    items: algo.itemsOf(rows),
    removed: removed,
    cfg: st.cfg || null,
    steps: algo.steps()
  }, base);
  const content = '当前抽签结果共 ' + rows.length + ' 个' + (removed.length ? ('，已剔除 ' + removed.length + ' 个') : '') +
    '。下一步：需要分组时调用 runGroup，或打开抽签页查看 / 补抽 / 剔除。';
  return result.ok(content, data, { handoff: handoff.handoffTo('draw', 'step=1') });
}, '抽签结果');
