// ai/skills/homework/apis/getHomeworkDetail.js —— 单条作业详情（完整内容 + 附件名称/大小/类型）
const auth = require('../../../common/auth.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const hw = require('../lib/hw.js');

module.exports = function getHomeworkDetail(args) {
  args = args || {};
  if (!auth.hasIdentity()) return result.identityFail();
  const id = String(args.homeworkId == null ? '' : args.homeworkId).trim();
  if (!id) {
    return result.invalid('缺少 homeworkId。请先调用 listHomework 获取作业 id（items[].id），再重试。');
  }
  return hw.load().then(function (res) {
    if (hw.offlineEmpty(res)) {
      return result.fail(result.T.NETWORK, 'network', { handoff: handoff.handoffTo('hw', { tab: 'all', id: id }) });
    }
    const target = (res.rows || []).filter(function (h) { return hw.rowKey(h) === id; })[0] || null;
    if (!target) {
      return result.invalid('没有找到 homeworkId=' + id + ' 的作业（可能已被删除，或已过截止三天被自动清除）。请重新调用 listHomework 获取当前有效 id，不要编造。');
    }
    if (hw.decorate(target).purged) {
      return result.invalid('homeworkId=' + id + ' 的作业已过截止三天，作业板已自动清除，AI 侧不再展示。如需历史记录请到作业板确认。');
    }
    const item = hw.detailOf(hw.decorate(target));
    const title = (item.subject ? '【' + item.subject + '】' : '') + '作业详情';
    const contentBrief = hw.truncate(item.content, 60);
    const structured = {
      pagePath: handoff.PAGES.hw + '?tab=all&id=' + encodeURIComponent(id),
      title: '作业板',
      item: item,
      offline: !!res.offline
    };
    const hand = handoff.handoffTo('hw', { tab: 'all', id: id }, { homeworkId: id });
    const meta = { cardData: { title: title, item: item, offline: !!res.offline } };
    const text = (res.offline ? '网络不可用，以下详情来自本机缓存。' : '')
      + title + '：截止 ' + (item.dueDateText || '无截止日期') + '（' + item.dueText + '），内容「' + contentBrief + '」'
      + (item.attachments.length ? '，附件 ' + item.attachments.length + ' 个' : '')
      + (item.done ? '，已标记完成' : '，尚未完成')
      + '。请展示作业详情卡片，并询问是否需要标记完成或到作业板查看。';
    return result.ok(text, structured, { handoff: hand, _meta: meta });
  });
};
