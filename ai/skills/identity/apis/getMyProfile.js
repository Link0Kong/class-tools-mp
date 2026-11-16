// ai/skills/identity/apis/getMyProfile.js —— 我的班级身份卡（原子接口）
const auth = require('../../../common/auth.js');
const local = require('../../../common/local.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');

module.exports = function getMyProfile() {
  const id = auth.getIdentity();
  if (!id) return result.identityFail();

  const members = local.getClassMembers();
  const label = id.role || id.badge || '班级成员';
  const s = {
    verified: true,
    name: id.name,
    role: id.role || '',
    badge: id.badge || '',
    isAdmin: !!id.is_admin,
    memberCount: members.length,
    pagePath: handoff.PAGES.me,
    pageTitle: '我的'
  };
  const text = '已确认你的班级身份：' + id.name + '（' + label + (id.is_admin ? ' · 管理员' : '') + '）' +
    '；本机班级名单 ' + members.length + ' 人。' +
    (members.length ? '需要看名单或本班概况可以继续问。' : '名单还没同步，可在「我的」页下拉刷新或稍后再试。');
  return result.ok(text, s, {
    _meta: { cardData: { name: id.name, role: id.role || '', badge: id.badge || '', isAdmin: !!id.is_admin, memberCount: members.length } },
    handoff: handoff.handoffTo('me', '', { tab: 'profile' })
  });
};
