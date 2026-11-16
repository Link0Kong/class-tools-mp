// utils/flow.js —— 三步工作流（抽签 → 分组 → 结果单）的跨页状态
// 原站用内存全局 A / G 保存，小程序页面间切换会销毁页面实例，因此落到本地存储。
// 不占用主数据键 zq_tools_v2，单独使用 zq_flow。
const FLOWKEY = 'zq_flow';

function empty() { return { draw: null, group: null, updatedAt: 0 }; }

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

module.exports = { FLOWKEY: FLOWKEY, empty: empty, getFlow: getFlow, setFlow: setFlow, patch: patch, clearFlow: clearFlow };
