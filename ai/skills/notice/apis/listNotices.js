// ai/skills/notice/apis/listNotices.js —— 班级通知列表（待处理/已过期/已处理/全部 + 分类 + 关键词）
const auth = require('../../../common/auth.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const nt = require('../lib/nt.js');

const STATUS = ['pending', 'expired', 'done', 'all'];
const STATUS_TEXT = { pending: '待处理', expired: '已过期', done: '已处理', all: '全部' };
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

module.exports = function listNotices(args) {
  args = args || {};
  if (!auth.hasIdentity()) return result.identityFail();
  const status = (args.status == null || args.status === '') ? 'pending' : String(args.status);
  if (STATUS.indexOf(status) < 0) {
    return result.invalid('status 只能是 pending / expired / done / all，收到「' + status + '」。不传时默认 pending（待处理）。');
  }
  let limit = DEFAULT_LIMIT;
  if (args.limit != null && args.limit !== '') {
    if (typeof args.limit !== 'number' || !isFinite(args.limit) || Math.floor(args.limit) !== args.limit || args.limit < 1 || args.limit > MAX_LIMIT) {
      return result.invalid('limit 必须是 1–' + MAX_LIMIT + ' 的整数（number 类型），不传默认 20。');
    }
    limit = args.limit;
  }
  const category = args.category == null ? '' : String(args.category);
  const keyword = args.keyword == null ? '' : String(args.keyword);

  return nt.load().then(function (res) {
    if (nt.offlineEmpty(res)) {
      return result.fail(result.T.NETWORK, 'network', { handoff: handoff.handoffTo('nt', { filter: 'pending' }) });
    }
    const matched = nt.filterGroups(res.groups, { status: status, category: category, keyword: keyword });
    const total = matched.length;
    const items = matched.slice(0, limit).map(function (x) { return nt.cardOf(x.g); });
    const filter = status === 'all' ? '' : status;
    const structured = {
      pagePath: filter ? (handoff.PAGES.nt + '?filter=' + filter) : handoff.PAGES.nt,
      title: '班级通知',
      items: items,
      total: total,
      status: status,
      offline: !!res.offline
    };
    const hand = handoff.handoffTo('nt', { filter: filter }, { status: status, ids: items.map(function (x) { return x.id; }) });
    const meta = { cardData: { title: '班级通知 · ' + STATUS_TEXT[status], items: items, total: total, status: status, offline: !!res.offline } };
    if (!total) {
      return result.ok(
        '没有查到' + STATUS_TEXT[status] + '通知'
        + (category ? '（分类「' + category + '」）' : '')
        + (keyword ? '（关键词「' + keyword + '」）' : '')
        + '。可以换分类/关键词，或查看「全部通知」；不要用同一条件重复调用。',
        structured, { handoff: hand, _meta: meta });
    }
    const urgent = nt.briefingOf(res.groups).urgent24h;
    const text = (res.offline ? '当前网络不可用，以下来自本机缓存。' : '')
      + '共查到 ' + total + ' 条' + STATUS_TEXT[status] + '通知'
      + (total > items.length ? '（按 limit 仅展示前 ' + items.length + ' 条）' : '')
      + (status === 'pending' && urgent ? '，其中 ' + urgent + ' 条 24 小时内截止' : '')
      + '。请展示通知卡片，并询问用户是否查看某条详情或标记已处理。';
    return result.ok(text, structured, { handoff: hand, _meta: meta });
  });
};
