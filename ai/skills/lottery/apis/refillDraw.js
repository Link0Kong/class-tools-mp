// ai/skills/lottery/apis/refillDraw.js —— 把当前抽签结果补抽到目标个数
const local = require('../../../common/local.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const algo = require('../lib/algo.js');
const guard = require('../lib/guard.js');

module.exports = guard.run(async function refillDraw(args) {
  if (args.confirmed !== true) {
    return result.needConfirm('补抽会修改当前抽签结果。请先向用户确认是否补抽；用户确认后再调用 refillDraw 并传 confirmed=true。');
  }
  const target = algo.intOf(args.count);
  if (target == null || target <= 0) return result.invalid('补抽目标个数 count 需为正整数（补抽后结果的总个数）。');
  if (target > 10000) return result.invalid('补抽目标个数 count 过大，最多 10000 个。');

  const fl = local.getFlow();
  const st = fl.draw;
  if (!st || !st.result || !st.result.length) {
    return result.invalid('还没有抽签结果，无法补抽。请先调用 runDraw 抽签。');
  }
  const before = st.result.length;
  const added = algo.refill(st, target);
  if (added.length) algo.patchDraw(st);

  const sort = algo.loadDraw().sort;
  const rows = algo.drawRows(st, sort);
  const nameOf = {};
  rows.forEach(function (r) { if (!(r.n in nameOf)) nameOf[r.n] = r.nm || ''; });
  const pg = guard.page('draw');
  const data = {
    added: added.map(function (n) { return { number: n, name: nameOf[n] || '' }; }),
    items: algo.itemsOf(rows),
    poolSize: (st.pool || []).length,
    total: st.result.length,
    pagePath: pg.pagePath,
    pageTitle: pg.pageTitle
  };
  const content = added.length
    ? ('补抽完成：新增 ' + added.length + ' 个，当前共 ' + st.result.length + ' 个结果（补抽前 ' + before + ' 个）。下一步：可继续分组 runGroup，或打开抽签页查看。')
    : ('没有可补抽的序号了：当前结果 ' + before + ' 个，目标 ' + target + ' 个，抽签池已没有可用序号。可打开抽签页调整范围或允许重复，或直接按现有结果分组。');
  return result.ok(content, data, { handoff: handoff.handoffTo('draw') });
}, '抽签结果');
