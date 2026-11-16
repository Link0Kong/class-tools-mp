// ai/skills/lottery/lib/guard.js —— 原子接口统一前置：身份校验 + 错误兜底
const auth = require('../../../common/auth.js');
const result = require('../../../common/result.js');

function check() {
  return auth.hasIdentity() ? null : result.identityFail();
}

// 用法：module.exports = guard.run(async function (args) { ... }, '抽签配置');
function run(handler, what) {
  return async function (args) {
    try {
      const denied = check();
      if (denied) return denied;
      return await handler(args || {});
    } catch (e) {
      return result.fromError(e, what || '抽签数据');
    }
  };
}

function page(which) {
  const algo = require('./algo.js');
  const p = algo.PAGE[which] || algo.PAGE.draw;
  return { pagePath: p.pagePath, pageTitle: p.pageTitle };
}

module.exports = { check: check, run: run, page: page };
