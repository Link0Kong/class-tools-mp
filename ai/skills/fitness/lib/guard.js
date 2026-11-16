// ai/skills/fitness/lib/guard.js —— 原子接口统一前置：身份校验 + 错误兜底
const auth = require('../../../common/auth.js');
const result = require('../../../common/result.js');

function check() {
  return auth.hasIdentity() ? null : result.identityFail();
}

function run(handler, what) {
  return async function (args) {
    try {
      const denied = check();
      if (denied) return denied;
      return await handler(args || {});
    } catch (e) {
      return result.fromError(e, what || '体测数据');
    }
  };
}

const PAGE = {
  ft: { pagePath: '/pages/ft/ft', pageTitle: '打开体测页' },
  fttable: { pagePath: '/pages/fttable/fttable', pageTitle: '打开国标评分表' }
};
function page(which) { return PAGE[which] || PAGE.ft; }

module.exports = { check: check, run: run, page: page, PAGE: PAGE };
