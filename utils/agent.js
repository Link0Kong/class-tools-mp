// utils/agent.js —— AI 页面接力（handoff）读取工具（主包）
//
// 平台机制（微信「小程序 AI 开发模式」接入方式 §3.4）：
//   原子接口返回 handoff() → 用户点卡片进入小程序页面
//   → app.js onLaunch 里 wx.onAgentHandoff 收到 { pageId, path, query, payload }
//   → 按 pageId 暂存到 getApp().globalData.agentHandoffs
//   → 页面 onLoad 里 agent.pick(this) 取出**本页**那一份并删除（只消费一次）。
//
// 约定：
//   * query 是平台拼好的 query 字符串（与 onLoad(options) 相同），这里统一解析成对象并 decode；
//   * payload 是原子接口给的业务数据，可能为空对象；
//   * 页面用 payload/query 先渲染出状态，再在后台 force 刷新真实数据，不做阻塞弹窗/蒙层；
//   * 取不到（普通分享/直接打开）返回 null，页面保持原逻辑。
//
// 页面用法（不要依赖返回值一定存在）：
//   const handoff = agent.pick(this);              // onLoad 里调用一次
//   const q = (handoff && handoff.query) || {};    // 例如 { wk: '3', day: '2' }
//   const p = (handoff && handoff.payload) || {};  // 例如 { week: 3, day: 2 }

// 取 App 实例（App 尚未创建时返回 null）
function appOf() {
  try { return getApp(); } catch (e) { return null; }
}

// 页面实例 ID：官方支持 page.getPageId()；取不到时返回 ''
function pageIdOf(page) {
  try {
    if (page && typeof page.getPageId === 'function') {
      const id = page.getPageId();
      if (id !== undefined && id !== null && id !== '') return String(id);
    }
  } catch (e) { /* ignore */ }
  return '';
}

// 页面 route（无前导斜杠），用于 pageId 取不到时按 path 兜底匹配
function routeOf(page) {
  try {
    const r = page && (page.route || page.__route__);
    return String(r || '').replace(/^\//, '');
  } catch (e) { return ''; }
}

// 暂存袋：getApp().globalData.agentHandoffs（app.js 初始化）
function bagOf() {
  const app = appOf();
  if (!app) return null;
  try {
    app.globalData = app.globalData || {};
    app.globalData.agentHandoffs = app.globalData.agentHandoffs || {};
    return app.globalData.agentHandoffs;
  } catch (e) { return null; }
}

// query 解析：'tab=pending&id=x%201' → { tab:'pending', id:'x 1' }；也接受已是对象
function parseQuery(raw) {
  const out = {};
  if (raw === undefined || raw === null || raw === '') return out;
  if (typeof raw === 'object') {
    Object.keys(raw).forEach(function (k) {
      const v = raw[k];
      if (v === undefined || v === null) return;
      out[k] = typeof v === 'object' ? v : String(v);
    });
    return out;
  }
  String(raw).replace(/^\?/, '').split('&').forEach(function (seg) {
    if (!seg) return;
    const i = seg.indexOf('=');
    let k = i < 0 ? seg : seg.slice(0, i);
    let v = i < 0 ? '' : seg.slice(i + 1);
    try { k = decodeURIComponent(k.replace(/\+/g, ' ')); } catch (e) { /* 保留原样 */ }
    try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* 保留原样 */ }
    if (k) out[k] = v;
  });
  return out;
}

// 从暂存袋里按 pageId 取；取不到时按 path 兜底匹配最早一条同路径的（兼容 pageId 不可用）
function takeRaw(page) {
  const bag = bagOf();
  if (!bag) return null;
  const id = pageIdOf(page);
  if (id && bag[id]) {
    const v = bag[id];
    try { delete bag[id]; } catch (e) { /* ignore */ }
    return v;
  }
  const route = routeOf(page);
  if (!route) return null;
  const keys = Object.keys(bag);
  for (let i = 0; i < keys.length; i++) {
    const v = bag[keys[i]];
    const p = v && typeof v === 'object' ? String(v.path || '') : '';
    if (p && (p === route || p === '/' + route)) {
      const hit = bag[keys[i]];
      try { delete bag[keys[i]]; } catch (e) { /* ignore */ }
      return hit;
    }
  }
  return null;
}

// 取出本页 handoff：
//   返回 { pageId, path, query:{...}, payload:{} }；没有则 null（并已从暂存袋删除，只消费一次）
function pick(page) {
  try {
    const raw = takeRaw(page);
    if (!raw || typeof raw !== 'object') return null;
    return {
      pageId: raw.pageId,
      path: String(raw.path || ''),
      query: parseQuery(raw.query),
      payload: (raw.payload && typeof raw.payload === 'object' && !Array.isArray(raw.payload)) ? raw.payload : {}
    };
  } catch (e) { return null; }
}

// 备用通道：页面 query 里带 agentQuery=<handoff query>；平台也可能直接把 handoff.query
// 拼进打开页面的 query（Page.onLoad(options) 中直接可见）。两种都兼容。
// options 为 Page.onLoad(options)；解析不到返回 null
const HANDOFF_KEYS = ['tab', 'id', 'gid', 'filter', 'wk', 'day', 'step', 'recordId', 'sex',
  'grade', 'item', 'roleOnly', 'days', 'mine', 'section', 'key'];

function pickQuery(options) {
  try {
    if (!options || typeof options !== 'object') return null;
    let raw = options.agentQuery;
    if (raw === undefined || raw === null || raw === '') raw = options.handoffQuery;
    let q = {};
    if (raw !== undefined && raw !== null && raw !== '') {
      q = parseQuery(raw);
    } else {
      // 兼容：平台把 handoff.query 作为普通页面参数传入
      HANDOFF_KEYS.forEach(function (k) {
        const v = options[k];
        if (v === undefined || v === null || v === '') return;
        q[k] = String(v);
      });
    }
    return Object.keys(q).length ? q : null;
  } catch (e) { return null; }
}

// pick 后回调：handler(payload, query, handoff)；无 handoff 返回 null
function apply(page, handler) {
  const h = pick(page);
  if (!h) return null;
  try {
    if (typeof handler === 'function') handler(h.payload || {}, h.query || {}, h);
  } catch (e) { /* 页面渲染失败不影响打开 */ }
  return h;
}

module.exports = {
  pick: pick,
  pickQuery: pickQuery,
  apply: apply,
  parseQuery: parseQuery
};
