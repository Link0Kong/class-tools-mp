// ai/skills/notice/apis/setNoticePinned.js —— 置顶/取消置顶通知（marks kind='nt'）
const auth = require('../../../common/auth.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const marks = require('../../../common/marks.js');
const nt = require('../lib/nt.js');

module.exports = function setNoticePinned(args) {
  args = args || {};
  if (!auth.hasIdentity()) return result.identityFail();
  const id = String(args.noticeId == null ? '' : args.noticeId).trim();
  if (!id) {
    return result.invalid('缺少 noticeId。请先调用 listNotices 获取通知 id（items[].id），再重试。');
  }
  if (typeof args.pinned !== 'boolean') {
    return result.invalid('pinned 必须是布尔值：true=置顶，false=取消置顶。');
  }
  return nt.load().then(function (res) {
    if (nt.offlineEmpty(res)) {
      return result.fail(result.T.NETWORK, 'network', { handoff: handoff.handoffTo('nt', { gid: id }) });
    }
    const g = nt.findGroup(res.groups, id);
    if (!g) {
      return result.invalid('没有找到 noticeId=' + id + ' 的通知。请先调用 listNotices 获取有效 id，不要编造。');
    }
    return marks.setMark('nt', id, args.pinned).then(function (r) {
      const synced = !!(r && r.ok);
      const title = nt.truncate(g.title, 30);
      const text = args.pinned
        ? ('已置顶「' + title + '」' + (synced ? '，通知列表里它会排在前面。' : '；云端暂时没同步成功，联网后会自动补发。'))
        : ('已取消置顶「' + title + '」' + (synced ? '。' : '；云端暂时没同步成功，联网后会自动补发。'));
      return result.ok(text, {
        pagePath: handoff.PAGES.nt + '?gid=' + encodeURIComponent(id),
        title: '班级通知',
        ok: true,
        noticeId: id,
        pinned: !!args.pinned,
        pending: !synced
      }, {
        handoff: handoff.handoffTo('nt', { gid: id }, { noticeId: id, pinned: !!args.pinned }),
        _meta: { cardData: { title: title, pinned: !!args.pinned, pending: !synced } }
      });
    });
  });
};
