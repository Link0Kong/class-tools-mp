// ai/skills/lottery/apis/removeDrawResult.js —— 剔除一个已抽中的序号（按页面语义自动补抽）
const local = require('../../../common/local.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const algo = require('../lib/algo.js');
const guard = require('../lib/guard.js');

module.exports = guard.run(async function removeDrawResult(args) {
  if (args.confirmed !== true) {
    return result.needConfirm('剔除序号会修改当前抽签结果（可能自动补抽）。请先向用户确认要剔除哪个序号；用户确认后再调用并传 confirmed=true。');
  }
  const number = algo.intOf(args.number);
  if (number == null || number <= 0) {
    return result.invalid('number 需为当前抽签结果中的序号（正整数），取自 getDrawResult 返回的 items[].number。');
  }
  const fl = local.getFlow();
  const st = fl.draw;
  if (!st || !st.result || !st.result.length) {
    return result.invalid('还没有抽签结果，无法剔除。请先调用 runDraw 抽签。');
  }
  const autoRe = algo.loadDraw().autoRe;
  const r = algo.removeAt(st, number, autoRe);
  if (!r.ok) {
    return result.invalid('当前抽签结果中没有序号 ' + number + '。可先调用 getDrawResult 查看 items[].number，再按真实序号剔除。');
  }
  algo.patchDraw(st);
  const rows = algo.drawRows(st, algo.loadDraw().sort);
  const nameOf = {};
  rows.forEach(function (x) { if (!(x.n in nameOf)) nameOf[x.n] = x.nm || ''; });
  const pg = guard.page('draw');
  const data = {
    items: algo.itemsOf(rows),
    removed: st.removed || [],
    removedNumber: number,
    added: r.added == null ? [] : [{ number: r.added, name: nameOf[r.added] || '' }],
    total: st.result.length,
    pagePath: pg.pagePath,
    pageTitle: pg.pageTitle
  };
  const content = '已剔除序号 ' + number + (r.added != null ? ('，并自动补抽 ' + r.added) : '，未自动补抽') +
    '；当前结果 ' + st.result.length + ' 个、已剔除 ' + (st.removed || []).length + ' 个。下一步：可继续补抽 refillDraw 或打开抽签页查看。';
  return result.ok(content, data, { handoff: handoff.handoffTo('draw', 'step=1') });
}, '抽签结果');
