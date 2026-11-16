// ai/skills/notice/apis/getNoticeBriefing.js —— 班级通知简报（待处理/24h/7天/已过期 + 最紧迫一条）
const auth = require('../../../common/auth.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const nt = require('../lib/nt.js');

module.exports = function getNoticeBriefing(args) {
  args = args || {};
  if (!auth.hasIdentity()) return result.identityFail();
  return nt.load().then(function (res) {
    if (nt.offlineEmpty(res)) {
      return result.fail(result.T.NETWORK, 'network', { handoff: handoff.handoffTo('nt', { filter: 'pending' }) });
    }
    const b = nt.briefingOf(res.groups);
    const structured = {
      pagePath: handoff.PAGES.nt + '?filter=pending',
      title: '班级通知',
      pending: b.pending,
      urgent24h: b.urgent24h,
      week: b.week,
      expired: b.expired,
      next: b.next,
      total: b.total,
      done: b.done,
      offline: !!res.offline
    };
    const text = (res.offline ? '网络不可用，以下来自本机缓存。' : '')
      + '班级通知简报：待处理 ' + b.pending + ' 条（其中 24 小时内截止 ' + b.urgent24h + ' 条、7 天内截止 ' + b.week + ' 条），已过期 ' + b.expired + ' 条'
      + (b.next ? '；最紧迫的是「' + b.next.title + '」（' + b.next.statusText + '）' : '；目前没有待处理通知')
      + '。请展示通知简报卡片，并询问是否需要查看某条详情。';
    return result.ok(text, structured, {
      handoff: handoff.handoffTo('nt', { filter: 'pending' }, { pending: b.pending, next: b.next }),
      _meta: { cardData: { title: '通知简报', pending: b.pending, urgent24h: b.urgent24h, week: b.week, expired: b.expired, next: b.next, offline: !!res.offline } }
    });
  });
};
