// utils/flow.js —— 抽签 / 分组两个独立工具的本机跨页状态（zq_flow，独立于 zq_tools_v2）
//
// 2026-11-22 分组拆分（契约 web/group/CONTRACT.md §3）：
//   · draw     = 当前抽签结果（抽签页「重置」只清空它，不清分组）；
//   · drawLast = **最近一次成功抽签**快照 {at, result, pool, cfg}；重置后仍保留，供分组页
//                「最近抽签」成员来源读取（冷启动/杀进程后同样可读，因为它就在 storage 里）；
//   · group    = 分组结果（与抽签互不影响）；
//   · 旧数据只有 draw 没有 drawLast：lastDraw() 自动回退到 draw，升级不报错、不丢结果。
// 不占用主数据键 zq_tools_v2，单独使用 zq_flow。
const FLOWKEY = 'zq_flow';

function empty() { return { draw: null, drawLast: null, group: null, updatedAt: 0 }; }

function getFlow() {
  try {
    const v = wx.getStorageSync(FLOWKEY);
    if (!v) return empty();
    if (typeof v === 'string') { try { return JSON.parse(v) || empty(); } catch (e) { return empty(); } }
    return v;
  } catch (e) { return empty(); }
}
function setFlow(f) {
  f = f || empty();
  f.updatedAt = Date.now();
  try { wx.setStorageSync(FLOWKEY, JSON.stringify(f)); } catch (e) { /* ignore */ }
  return f;
}
function patch(k, v) { const f = getFlow(); f[k] = v; return setFlow(f); }
function clearFlow() { return setFlow(empty()); }

// 最近一次成功抽签：优先 drawLast；旧数据没有快照时回退当前 draw（只读，不改 storage）
function lastDraw() {
  const f = getFlow();
  if (f.drawLast && Array.isArray(f.drawLast.result) && f.drawLast.result.length) return f.drawLast;
  if (f.draw && Array.isArray(f.draw.result) && f.draw.result.length) return f.draw;
  return null;
}
// 抽签成功 / 结果变化时调用：把序号数组 + 参数快照 + 时间写入 drawLast（不随重置清空）
function saveLastDraw(st) {
  if (!st || !Array.isArray(st.result) || !st.result.length) return null;
  const f = getFlow();
  f.drawLast = {
    at: Date.now(),
    result: st.result.slice(),
    pool: Array.isArray(st.pool) ? st.pool.slice() : [],
    cfg: st.cfg ? Object.assign({}, st.cfg) : null
  };
  return setFlow(f);
}

module.exports = {
  FLOWKEY: FLOWKEY, empty: empty, getFlow: getFlow, setFlow: setFlow, patch: patch, clearFlow: clearFlow,
  lastDraw: lastDraw, saveLastDraw: saveLastDraw
};
