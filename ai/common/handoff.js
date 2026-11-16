// ai/common/handoff.js —— 页面路径 / 接力（handoff）工具
//
// 平台接力机制（官方「接入方式 §3.4」）：
//   mcp.json 里 _meta.ui.pagePath 声明目标页 → 原子接口返回 handoff 函数 → 用户点卡片进入该页
//   → 小程序 app.js 的 wx.onAgentHandoff 拿到 {query, payload} → 页面 onLoad/onShow 消费。
// 本文件只维护路径常量与 query 拼装；页面侧消费逻辑在主包 utils/agent.js。
const PAGES = {
  identity: '/pages/identity/identity',
  index: '/pages/index/index',
  all: '/pages/all/all',
  me: '/pages/me/me',
  tt: '/pages/tt/tt',
  hw: '/pages/hw/hw',
  nt: '/pages/nt/nt',
  draw: '/pages/draw/draw',
  group: '/pages/group/group',
  sum: '/pages/sum/sum',
  ft: '/pages/ft/ft',
  fttable: '/pages/fttable/fttable',
  roll: '/pages/roll/roll',
  committee: '/pages/committee/committee',
  stats: '/pages/stats/stats',
  fb: '/pages/fb/fb',
  ug: '/pages/ug/ug',
  data: '/pages/data/data'
};

function pagePathOf(key) {
  return PAGES[key] || '';
}

// query 拼装：对象 → 'a=1&b=%E4%B8%AD'
function buildQuery(obj) {
  if (!obj) return '';
  if (typeof obj === 'string') return obj.replace(/^\?/, '');
  const parts = [];
  Object.keys(obj).forEach(function (k) {
    const v = obj[k];
    if (v === undefined || v === null || v === '') return;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  });
  return parts.join('&');
}

// handoff 解析器（返回给平台的 handoff 字段必须是函数）
// 同时返回 path：官方支持在 handoff 里动态指定页面（覆盖 mcp.json 的 _meta.ui.pagePath），
// 用于「未认证 → 打开身份页」这类与接口默认接力页不同的场景；与默认页相同时也不会有副作用。
function handoffTo(pageKey, query, payload) {
  const q = buildQuery(query);
  const path = PAGES[pageKey] || '';
  return function () {
    const out = { query: q, payload: (payload && typeof payload === 'object') ? payload : {} };
    if (path) out.path = path;
    return out;
  };
}

module.exports = {
  PAGES: PAGES,
  pagePathOf: pagePathOf,
  buildQuery: buildQuery,
  handoffTo: handoffTo
};
