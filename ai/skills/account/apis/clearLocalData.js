// ai/skills/account/apis/clearLocalData.js —— 清除本机数据（原子接口，破坏性操作，保留身份）
const auth = require('../../../common/auth.js');
const local = require('../../../common/local.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const reset = require('../lib/reset.js');

const CONFIRM_TEXT = '尚未执行：清除本机数据会清空课表缓存、作业、通知、名单、体测、工作流与同步缓存；' +
  '班级身份保留，云端副本不受影响。请先向用户确认是否清空，用户确认后再次调用并传 confirmed=true。';

module.exports = function clearLocalData(args) {
  const id = auth.getIdentity();
  if (!id) return result.identityFail();
  const a = args || {};
  if (a.confirmed !== true) return result.needConfirm(CONFIRM_TEXT);

  try {
    // 1) 主数据重置为默认值（与主包 store.reset 等价；身份不在这个键里）
    local.writeStore(reset.defaultStore());
    // 2) 工作流（zq_flow）清空
    local.setFlow(local.emptyFlow());
    // 3) AI 专用缓存键（zqa1_*）
    local.clearAgentKeys();
    // 4) 主包分块缓存 / 访问 slot 等其余 storage 键（保留身份、主数据、工作流三键）
    const removed = reset.clearExtraKeys(local);
    const s = {
      ok: true,
      identityKept: true,
      removedKeys: removed.length,
      pagePath: handoff.PAGES.data,
      pageTitle: '数据与隐私'
    };
    const text = '已清除本机数据：课表缓存、作业、通知、名单、体测、工作流与同步缓存已清空' +
      (removed.length ? '（清理了 ' + removed.length + ' 个缓存键）' : '') +
      '；班级身份保留，云端数据不受影响。';
    return result.ok(text, s, {
      _meta: { cardData: { ok: true, identityKept: true } },
      handoff: handoff.handoffTo('data', '', { tab: 'privacy' })
    });
  } catch (e) {
    return result.fail('清除本机数据失败：' + ((e && e.message) || e) + '。已清除的部分不可撤销，可以稍后重试。', 'error');
  }
};
