'use strict';
// 测试辅助：app.json 的页面全集（主包 + 分包）。
// 2026-11-19 分包改造后，PPT/地图/诊断等页面仍在 app.json 注册（subPackages）；
// 2026-11-19 晚 PPT 三页合并为一个分包（root=pages/ppt），pptdl/pptplay 路径带上了 pages/ppt 前缀。
// 测试断言「已注册」时应使用本函数，而不是只看 app.pages（主包）。
function subPages(app) {
  const out = [];
  const subs = (app && (app.subPackages || app.subpackages)) || [];
  subs.forEach(function (sp) {
    const root = String((sp && sp.root) || '').replace(/\/+$/, '');
    ((sp && sp.pages) || []).forEach(function (p) {
      out.push((root ? root + '/' : '') + String(p));
    });
  });
  return out;
}

function allPages(app) {
  return ((app && app.pages) || []).concat(subPages(app));
}

module.exports = { subPages: subPages, allPages: allPages };
