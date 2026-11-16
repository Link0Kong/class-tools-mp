// ai/skills/homework/apis/publishHomework.js —— 发布作业（写操作，必须 confirmed=true）
const auth = require('../../../common/auth.js');
const result = require('../../../common/result.js');
const hw = require('../lib/hw.js');

module.exports = function publishHomework(args) {
  args = args || {};
  if (!auth.hasIdentity()) return result.identityFail();
  if (args.confirmed !== true) {
    const subject = String(args.subject == null ? '' : args.subject).trim();
    const content = String(args.content == null ? '' : args.content).trim();
    const due = args.dueDate ? ('，截止 ' + String(args.dueDate) + (args.dueTime ? ' ' + String(args.dueTime) : '')) : '（无截止时间）';
    return result.needConfirm(
      '尚未执行发布。即将发布' + (subject ? '【' + subject + '】' : '') + '作业：'
      + (content ? '「' + hw.truncate(content, 40) + '」' : '（未填内容）') + due
      + '。请先向用户确认是否发布给全班；用户确认后再调用本接口并传 confirmed=true。',
      { handoff: require('../../../common/handoff.js').handoffTo('hw', { tab: 'pending' }) }
    );
  }
  return hw.publish(args);
};
