// ai/skills/homework/apis/deleteHomework.js —— 删除作业（本人或管理员；写操作，必须 confirmed=true）
const auth = require('../../../common/auth.js');
const result = require('../../../common/result.js');
const hw = require('../lib/hw.js');

module.exports = function deleteHomework(args) {
  args = args || {};
  if (!auth.hasIdentity()) return result.identityFail();
  const id = String(args.homeworkId == null ? '' : args.homeworkId).trim();
  if (!id) {
    return result.invalid('缺少 homeworkId。请先调用 listHomework 获取作业 id（items[].id），再重试。');
  }
  if (args.confirmed !== true) {
    return result.needConfirm(
      '尚未执行删除。删除作业后全班同学都不再看到它（只有发布者本人或管理员可以删除）。'
      + '请先向用户确认是否删除 homeworkId=' + id + ' 这条作业；用户确认后再调用本接口并传 confirmed=true。',
      { handoff: require('../../../common/handoff.js').handoffTo('hw', { tab: 'all', id: id }) }
    );
  }
  return hw.remove(id);
};
