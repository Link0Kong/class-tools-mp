// ai/skills/identity/apis/getToolsDirectory.js —— 工具目录（原子接口）
const auth = require('../../../common/auth.js');
const local = require('../../../common/local.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const tools = require('../lib/tools.js');

module.exports = function getToolsDirectory() {
  const id = auth.getIdentity();
  const admin = !!(id && id.is_admin);
  const d = local.readStore();

  const homeTools = tools.quickList(d.homeTools, 4);
  const all = tools.catalog(admin);
  const s = {
    homeTools: homeTools,
    all: all,
    pagePath: handoff.PAGES.all,
    pageTitle: '工具'
  };
  const homeText = homeTools.map(function (t) { return t.name; }).join('、');
  const adminText = admin ? '；管理员入口「统计」也在目录里' : '';
  const text = '工作台首页快捷是：' + (homeText || '（暂无）') + '。全部工具共 ' + all.length +
    ' 个，已按分类整理在工具页，可在那里调整首页顺序' + adminText + '。要打开某个工具可以去工具页。';
  return result.ok(text, s, {
    _meta: { cardData: { homeTools: homeTools, all: all.slice(0, 8) } },
    handoff: handoff.handoffTo('all', '', {})
  });
};
