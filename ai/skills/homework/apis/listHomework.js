// ai/skills/homework/apis/listHomework.js —— 作业列表（待交/全部/已完成/已过期）
const auth = require('../../../common/auth.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const hw = require('../lib/hw.js');

const STATUS = ['pending', 'all', 'done', 'overdue'];
const STATUS_TEXT = { pending: '待交', all: '全部', done: '已完成', overdue: '已过截止' };

module.exports = function listHomework(args) {
  args = args || {};
  if (!auth.hasIdentity()) return result.identityFail();

  const status = (args.status == null || args.status === '') ? 'pending' : String(args.status);
  if (STATUS.indexOf(status) < 0) {
    return result.invalid('status 只能是 pending / all / done / overdue，收到「' + status + '」。不传时默认 pending（待交）。');
  }
  let limit = hw.DEFAULT_LIMIT;
  if (args.limit != null && args.limit !== '') {
    if (typeof args.limit !== 'number' || !isFinite(args.limit) || Math.floor(args.limit) !== args.limit || args.limit < 1 || args.limit > hw.MAX_LIMIT) {
      return result.invalid('limit 必须是 1–' + hw.MAX_LIMIT + ' 的整数（number 类型），不传默认 20。');
    }
    limit = args.limit;
  }
  const subject = args.subject == null ? '' : String(args.subject);
  const keyword = args.keyword == null ? '' : String(args.keyword);

  return hw.load().then(function (res) {
    if (hw.offlineEmpty(res)) {
      return result.fail(result.T.NETWORK, 'network', { handoff: handoff.handoffTo('hw', { tab: 'pending' }) });
    }
    const items = hw.listItems(res.rows, { status: status, subject: subject, keyword: keyword });
    const total = items.length;
    const page = items.slice(0, limit).map(hw.cardOf);
    const tab = status === 'done' ? 'done' : (status === 'pending' ? 'pending' : 'all');
    const structured = {
      pagePath: handoff.PAGES.hw + '?tab=' + tab,
      title: '作业板',
      items: page,
      total: total,
      offline: !!res.offline
    };
    const hand = handoff.handoffTo('hw', { tab: tab }, { tab: tab, ids: page.map(function (x) { return x.id; }) });
    const meta = { cardData: { title: '作业 · ' + STATUS_TEXT[status], items: page, total: total, tab: tab, offline: !!res.offline } };

    if (!total) {
      const why = (keyword ? '关键词「' + keyword + '」' : '') + (subject ? '科目「' + subject + '」' : '') || ('status=' + status);
      return result.ok(
        '作业板里没有查到符合条件的作业（' + why + '）。可以换关键词，或改看「全部作业」确认；不要重复用同一条件调用本接口。',
        structured, { handoff: hand, _meta: meta });
    }
    const text = (res.offline ? '当前网络不可用，以下来自本机缓存的作业。' : '')
      + '共查到 ' + total + ' 条' + STATUS_TEXT[status] + '作业'
      + (total > page.length ? '（按 limit 仅展示前 ' + page.length + ' 条）' : '')
      + '。请展示作业卡片，并询问用户是否需要查看某条详情或标记完成。';
    return result.ok(text, structured, { handoff: hand, _meta: meta });
  });
};
