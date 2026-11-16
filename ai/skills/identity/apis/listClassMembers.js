// ai/skills/identity/apis/listClassMembers.js —— 班级名单查询（原子接口，不含学号）
const auth = require('../../../common/auth.js');
const local = require('../../../common/local.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_KEYWORD = 20;

module.exports = function listClassMembers(args) {
  const id = auth.getIdentity();
  if (!id) return result.identityFail();

  const a = args || {};
  const roleOnly = a.roleOnly === true || a.roleOnly === 'true';
  let page = parseInt(a.page, 10);
  if (!isFinite(page) || page < 1) page = 1;
  let pageSize = parseInt(a.pageSize, 10);
  if (!isFinite(pageSize) || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
  if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;
  const keyword = String(a.keyword == null ? '' : a.keyword).trim();
  if (keyword.length > MAX_KEYWORD) return result.invalid('关键字过长（最多 ' + MAX_KEYWORD + ' 个字），请缩短后重试。');
  const kw = keyword.toLowerCase();

  const members = local.getClassMembers();
  const prepare = members.length ? Promise.resolve(members) : auth.pullMembers().catch(function () { return []; });

  return prepare.then(function (list) {
    let filtered = (list || []).filter(function (m) { return !!(m && m.name); });
    if (roleOnly) filtered = filtered.filter(function (m) { return !!m.role; });
    if (kw) {
      filtered = filtered.filter(function (m) {
        return String(m.name || '').toLowerCase().indexOf(kw) >= 0 ||
          String(m.role || '').toLowerCase().indexOf(kw) >= 0;
      });
    }
    filtered.sort(function (a2, b2) { return (a2.seat || 0) - (b2.seat || 0); });
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize).map(function (m) {
      return { seat: m.seat || 0, name: m.name, role: m.role || '', badge: m.badge || '', isAdmin: !!m.is_admin };
    });
    const s = {
      total: total,
      page: page,
      pageSize: pageSize,
      items: items,
      pagePath: handoff.PAGES.committee,
      pageTitle: roleOnly ? '名单（班委）' : '名单（全班）'
    };
    let text;
    if (!(list || []).length) {
      text = '本机还没有班级名单缓存，且这次未能从云端同步到。可能是网络不可用；请检查网络后重试，或打开班委页查看。';
    } else if (!total) {
      text = '没有查到匹配的班级成员' + (keyword ? '（关键字：' + keyword + '）' : '') +
        '。可以换一个关键字，或去掉“只看班委”后再试。';
    } else if (!items.length) {
      text = '没有查到第 ' + page + ' 页的成员（共 ' + total + ' 人、' + Math.max(1, Math.ceil(total / pageSize)) +
        ' 页）。请检查页码后重试。';
    } else {
      text = '本班共 ' + total + ' 名成员' + (roleOnly ? '（仅班委）' : '') +
        '，当前显示第 ' + page + ' 页 ' + items.length + ' 人（每页 ' + pageSize + '）。' +
        (start + items.length < total ? '还有更多，可继续翻页。' : '');
    }
    return result.ok(text, s, { _meta: { cardData: { total: total, items: items.slice(0, 10), page: page } }, handoff: handoff.handoffTo('committee', roleOnly ? 'roleOnly=1' : '', { page: page, pageSize: pageSize }) });
  });
};
