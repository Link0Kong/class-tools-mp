// ai/skills/identity/apis/getMyOverview.js —— 我的数据概览（原子接口，纯本机计算）
//
// 与主包 pages/me/me.js 的「我的数据」四项口径一致：
//   待交 = 未完成且未被自己隐藏的作业（无 id 的旧行看 h.done）；已完成 = hwDone 命中；
//   抽签 = zq_flow.draw.result.length；体测 = 本机 fitRecs 条数（最多 2）。
const auth = require('../../../common/auth.js');
const local = require('../../../common/local.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');

module.exports = function getMyOverview() {
  const id = auth.getIdentity();
  if (!id) return result.identityFail();

  const d = local.readStore();
  const homework = d.homework || [];
  const hwDone = d.hwDone || {};
  const hwHide = d.hwHide || {};
  let done = 0;
  let todo = 0;
  homework.forEach(function (h) {
    const isDone = h && h.id ? !!hwDone[h.id] : !!(h && h.done);
    const isHidden = h && h.id ? !!hwHide[h.id] : false;
    if (isDone) done += 1;
    else if (!isHidden) todo += 1;
  });
  const flow = local.getFlow();
  const drawRecords = (flow && flow.draw && Array.isArray(flow.draw.result)) ? flow.draw.result.length : 0;
  const fitnessRecords = (d.fitRecs || []).length;

  const s = {
    pendingHomework: todo,
    doneHomework: done,
    drawRecords: drawRecords,
    fitnessRecords: fitnessRecords,
    pagePath: handoff.PAGES.me,
    pageTitle: '我的'
  };
  const text = '当前你有 ' + todo + ' 条作业待交、已勾选完成 ' + done + ' 条；最近一次抽签 ' + drawRecords +
    ' 个结果，本机体测记录 ' + fitnessRecords + ' 条。要看明细可以分别问我作业、抽签或体测。';
  return result.ok(text, s, {
    _meta: { cardData: { pendingHomework: todo, doneHomework: done, drawRecords: drawRecords, fitnessRecords: fitnessRecords } },
    handoff: handoff.handoffTo('me', '', { tab: 'overview' })
  });
};
