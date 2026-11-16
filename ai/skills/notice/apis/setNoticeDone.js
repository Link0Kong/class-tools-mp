// ai/skills/notice/apis/setNoticeDone.js —— 标记通知已处理/恢复待处理（marks kind='ntdone'）
const auth = require('../../../common/auth.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const marks = require('../../../common/marks.js');
const nt = require('../lib/nt.js');

module.exports = function setNoticeDone(args) {
  args = args || {};
  if (!auth.hasIdentity()) return result.identityFail();
  const id = String(args.noticeId == null ? '' : args.noticeId).trim();
  if (!id) {
    return result.invalid('缺少 noticeId。请先调用 listNotices 获取通知 id（items[].id），再重试。');
  }
  if (typeof args.done !== 'boolean') {
    return result.invalid('done 必须是布尔值：true=标记已处理，false=恢复为待处理。');
  }
  return nt.load().then(function (res) {
    if (nt.offlineEmpty(res)) {
      return result.fail(result.T.NETWORK, 'network', { handoff: handoff.handoffTo('nt', { gid: id }) });
    }
    const g = nt.findGroup(res.groups, id);
    if (!g) {
      return result.invalid('没有找到 noticeId=' + id + ' 的通知。请先调用 listNotices 获取有效 id，不要编造。');
    }
    const d = nt.decorate(g);
    if (args.done === true && d.st.expired) {
      return result.invalid('这条通知已过期（' + d.st.label + '），不需要标记已处理；如需查看请改用 listNotices（status=expired）。');
    }
    return marks.setMark('ntdone', id, args.done).then(function (r) {
      const synced = !!(r && r.ok);
      const text = args.done
        ? ('已把「' + nt.truncate(g.title, 30) + '」标记为已处理' + (synced ? '，待处理简报会同步减少这条。' : '；云端暂时没同步成功，联网后会自动补发。'))
        : ('已把「' + nt.truncate(g.title, 30) + '」恢复为待处理' + (synced ? '，会重新计入待处理简报。' : '；云端暂时没同步成功，联网后会自动补发。'));
      return result.ok(text, {
        pagePath: handoff.PAGES.nt + '?gid=' + encodeURIComponent(id),
        title: '班级通知',
        ok: true,
        noticeId: id,
        done: !!args.done,
        pending: !synced
      }, {
        handoff: handoff.handoffTo('nt', { gid: id }, { noticeId: id, done: !!args.done }),
        _meta: { cardData: { title: nt.truncate(g.title, 40), done: !!args.done, pending: !synced } }
      });
    });
  });
};
