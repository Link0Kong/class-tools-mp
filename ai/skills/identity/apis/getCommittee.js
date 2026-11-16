// ai/skills/identity/apis/getCommittee.js —— 班委名单（原子接口）
const auth = require('../../../common/auth.js');
const local = require('../../../common/local.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');

module.exports = function getCommittee() {
  const id = auth.getIdentity();
  if (!id) return result.identityFail();

  const members = local.getClassMembers();
  const prepare = members.length ? Promise.resolve(members) : auth.pullMembers().catch(function () { return []; });

  return prepare.then(function (list) {
    const items = (list || []).filter(function (m) { return !!(m && m.name && m.role); })
      .sort(function (a, b) {
        if (!!a.is_admin !== !!b.is_admin) return a.is_admin ? -1 : 1;
        return (a.seat || 0) - (b.seat || 0);
      })
      .map(function (m) {
        return { seat: m.seat || 0, name: m.name, role: m.role || '', badge: m.badge || '' };
      });
    const s = {
      total: items.length,
      items: items,
      pagePath: handoff.PAGES.committee,
      pageTitle: '名单'
    };
    let text;
    if (!(list || []).length) {
      text = '本机还没有班级名单缓存，且这次未能从云端同步到。可能是网络不可用；请检查网络后重试，或打开班委页查看。';
    } else if (!items.length) {
      text = '本班名单里还没有填写职务的成员，暂时没有班委信息。可以查看完整班级名单。';
    } else {
      text = '本班共 ' + items.length + ' 位班委：' + items.slice(0, 8).map(function (m) { return m.name + '（' + m.role + '）'; }).join('、') +
        (items.length > 8 ? ' 等' : '') + '。需要完整名单可查看全部名单。';
    }
    return result.ok(text, s, { _meta: { cardData: { total: items.length, items: items } }, handoff: handoff.handoffTo('committee', 'roleOnly=1', {}) });
  });
};
