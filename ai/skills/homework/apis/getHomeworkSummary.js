// ai/skills/homework/apis/getHomeworkSummary.js —— 作业概览（待交/已完成/已过截止/最近到期）
const auth = require('../../../common/auth.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const hw = require('../lib/hw.js');

module.exports = function getHomeworkSummary(args) {
  args = args || {};
  if (!auth.hasIdentity()) return result.identityFail();
  return hw.load().then(function (res) {
    if (hw.offlineEmpty(res)) {
      return result.fail(result.T.NETWORK, 'network', { handoff: handoff.handoffTo('hw', { tab: 'pending' }) });
    }
    const s = hw.summary(res.rows);
    const structured = {
      pagePath: handoff.PAGES.hw + '?tab=pending',
      title: '作业板',
      pending: s.pending,
      done: s.done,
      overdue: s.overdue,
      next: s.next,
      offline: !!res.offline
    };
    const text = (res.offline ? '网络不可用，以下来自本机缓存。' : '')
      + '作业概览：待交 ' + s.pending + ' 条（其中已过截止 ' + s.overdue + ' 条），已完成 ' + s.done + ' 条'
      + (s.next ? '；最近到期的是「' + s.next.subject + '」（' + s.next.leftText + '）' : '；目前没有带截止日期的待交作业')
      + '。请展示作业概览卡片，并询问是否查看待交作业或详情。';
    return result.ok(text, structured, {
      handoff: handoff.handoffTo('hw', { tab: 'pending' }, { pending: s.pending, next: s.next }),
      _meta: { cardData: { title: '作业概览', pending: s.pending, done: s.done, overdue: s.overdue, next: s.next, offline: !!res.offline } }
    });
  });
};
