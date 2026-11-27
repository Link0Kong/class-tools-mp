// utils/ttprefs.js —— 课表视图偏好（周 / 日，本机按账号记住）
//
// 2026-11-27 用户需求：「应用应该记住用户的课表用周视图还是日视图」。
//   * 只认 'week' / 'day' 两个值：缺省、脏值、读取异常一律按未设置返回 null（课表页回落周视图）；
//   * 写入失败静默（storage 满 / 基础库异常都不影响课表渲染），传非法值直接忽略；
//   * 键经 store.keyFor 包装成 `zq_tt_view_v1_<sid>`，与账号隔离；不写 storage 主键，
//     也不碰 userdata v6（ttView 字段归网页 / 安卓，小程序不写云端）。
const store = require('./store.js');

const KEY = 'zq_tt_view_v1';

function storageKey() { return store.keyFor(KEY); }

// 返回 'week' | 'day' | null（只认这两个值；缺省 / 脏值 / 读取异常 → null）
function load() {
  try {
    const v = wx.getStorageSync(storageKey());
    return (v === 'week' || v === 'day') ? v : null;
  } catch (e) { return null; }
}

// 只接受 'week' | 'day'；其余值忽略，写失败静默。返回是否写入成功（便于测试/调用方判断）。
function save(view) {
  if (view !== 'week' && view !== 'day') return false;
  try { wx.setStorageSync(storageKey(), view); return true; } catch (e) { return false; }
}

module.exports = { KEY: KEY, load: load, save: save };
