// ai/skills/homework/apis/setHomeworkDone.js —— 标记作业已完成/未完成（marks kind='hw'）
const auth = require('../../../common/auth.js');
const result = require('../../../common/result.js');
const hw = require('../lib/hw.js');

module.exports = function setHomeworkDone(args) {
  args = args || {};
  if (!auth.hasIdentity()) return result.identityFail();
  const id = String(args.homeworkId == null ? '' : args.homeworkId).trim();
  if (!id) {
    return result.invalid('缺少 homeworkId。请先调用 listHomework 获取作业 id（items[].id），再重试。');
  }
  if (typeof args.done !== 'boolean') {
    return result.invalid('done 必须是布尔值：true=标记已完成，false=取消完成。');
  }
  return hw.setDone(id, args.done);
};
