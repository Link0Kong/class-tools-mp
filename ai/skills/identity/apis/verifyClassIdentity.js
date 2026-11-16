// ai/skills/identity/apis/verifyClassIdentity.js —— 身份验证（唯一免身份入口，原子接口）
//
// 与主包 utils/identity.login + cloud.classVerify 同一云端契约：
//   POST rpc/class_verify { p_sid, p_name }（public，不带 X-Class-Token）
//   成功 → 保存 zq_class_identity → pullMembers（失败不影响验证成功，membersSynced=false）
const CONFIG = require('../../../common/config.js');
const auth = require('../../../common/auth.js');
const rest = require('../../../common/rest.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');

function okResult(identity, memberCount, synced) {
  const label = identity.role || identity.badge || '班级成员';
  const s = {
    verified: true,
    name: identity.name,
    role: identity.role || '',
    badge: identity.badge || '',
    isAdmin: !!identity.is_admin,
    memberCount: memberCount,
    membersSynced: !!synced,
    pagePath: handoff.PAGES.index,
    pageTitle: '工作台'
  };
  const text = '身份验证通过：' + identity.name + '（' + label + (identity.is_admin ? ' · 管理员' : '') + '）。' +
    (synced ? '班级名单已同步（' + memberCount + ' 人）。' : '班级名单稍后同步，不影响使用。') +
    '已为你接力到工作台，可以继续查作业、通知或课表。';
  return result.ok(text, s, {
    _meta: { cardData: { name: identity.name, role: identity.role || '', badge: identity.badge || '', isAdmin: !!identity.is_admin, memberCount: memberCount, membersSynced: !!synced } },
    handoff: handoff.handoffTo('index', '', { verified: true, name: identity.name, role: identity.role || '' })
  });
}

module.exports = function verifyClassIdentity(args) {
  const a = args || {};
  const sid = String(a.sid == null ? '' : a.sid).trim();
  const name = String(a.name == null ? '' : a.name).trim();
  if (!/^\d{10}$/.test(sid)) {
    return result.invalid('学号应为 10 位数字。请向用户确认学号后重试，不要编造或使用示例值。');
  }
  if (!name) return result.invalid('缺少姓名。请向用户确认真实姓名后重试。');
  if (name.length > 20) return result.invalid('姓名过长，请确认真实姓名后重试。');

  return rest.rpc(CONFIG.rpc.verify, { p_sid: sid, p_name: name }, { public: true }).then(function (raw) {
    const body = Array.isArray(raw) ? raw[0] : raw;
    if (!body || body.ok !== true) {
      const why = (body && body.reason) || '学号与姓名不在班级名单中';
      return result.fail('验证未通过：' + why + '。请核对学号与姓名后重试，或联系班委确认班级名单。', 'verify-failed');
    }
    if (!body.token) return result.fail('云端未返回身份凭证，请稍后重试。', 'verify-failed');
    const identity = {
      token: String(body.token),
      sid: String(body.sid || sid),
      name: String(body.name || name),
      role: body.role == null ? '' : String(body.role),
      badge: body.badge == null ? '' : String(body.badge),
      is_admin: !!body.is_admin,
      ts: Date.now()
    };
    if (!auth.saveIdentity(identity)) {
      return result.fail('身份保存失败，请清理小程序缓存后重试。', 'storage-error');
    }
    return auth.pullMembers().then(function (list) {
      return okResult(identity, (list || []).length, true);
    }).catch(function () {
      return okResult(identity, 0, false);
    });
  }).catch(function (e) {
    if (e && e.code === 'http4xx') {
      return result.fail('验证未通过：学号或姓名与班级名单不匹配。请核对后重试。', 'verify-failed');
    }
    return result.fromError(e, '身份验证');
  });
};
