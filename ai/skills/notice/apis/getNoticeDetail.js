// ai/skills/notice/apis/getNoticeDetail.js —— 单条通知详情（摘要/要点/字段拆分/详情项/原始消息/发送者/OCR）
const auth = require('../../../common/auth.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const nt = require('../lib/nt.js');

module.exports = function getNoticeDetail(args) {
  args = args || {};
  if (!auth.hasIdentity()) return result.identityFail();
  const id = String(args.noticeId == null ? '' : args.noticeId).trim();
  if (!id) {
    return result.invalid('缺少 noticeId。请先调用 listNotices 获取通知 id（items[].id），再重试。');
  }
  return nt.load().then(function (res) {
    if (nt.offlineEmpty(res)) {
      return result.fail(result.T.NETWORK, 'network', { handoff: handoff.handoffTo('nt', { gid: id }) });
    }
    const g = nt.findGroup(res.groups, id);
    if (!g) {
      return result.invalid('没有找到 noticeId=' + id + ' 的通知（可能已被新通知替代/归档）。请重新调用 listNotices 获取当前有效 id，不要编造。');
    }
    const detail = nt.detailOf(g);
    const structured = {
      pagePath: handoff.PAGES.nt + '?gid=' + encodeURIComponent(id),
      title: '班级通知',
      detail: detail,
      offline: !!res.offline
    };
    const text = (res.offline ? '网络不可用，以下详情来自本机缓存。' : '')
      + '「' + detail.title + '」当前状态：' + detail.statusText
      + (detail.deadlineText ? '，截止 ' + detail.deadlineText : '')
      + (detail.expired ? '（已过期，仅存档查看）' : '')
      + (detail.done ? '，已标记已处理' : '')
      + '。请展示通知详情卡片，并询问是否需要标记已处理。';
    return result.ok(text, structured, {
      handoff: handoff.handoffTo('nt', { gid: id }, { noticeId: id }),
      _meta: { cardData: { title: detail.title, detail: detail, offline: !!res.offline } }
    });
  });
};
