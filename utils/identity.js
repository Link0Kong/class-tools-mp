// utils/identity.js —— 身份层（唯一身份来源：CloudBase RPC class_verify）
//
// 背景（v12 / 1.3.0）：
//   * 旧的「账号 + 密码注册登录」「X-Device-Id 鉴权」「pages/verify 二次认证」全部下线；
//   * 现在进入小程序先到「身份界面」，输入 学号 + 姓名 → POST rpc/class_verify；
//   * 校验通过后云端返回一次性班级 token，本地把它和身份信息一起保存；
//   * 之后所有班级数据请求都由 utils/cloud.js 自动带 X-Class-Token 头；
//   * 没有有效身份时，任何页面都不能使用/请求班级数据（页面守卫都会 reLaunch 回身份页）。
//
// 本地存储（wx storage）：
//   zq_class_identity = { token, sid, name, role, badge, is_admin, ts }
//   —— 这是身份的唯一真源，不做账号桶切换，也不保存任何密码/哈希。
const KEY = 'zq_class_identity';
const IDENTITY_PAGE = '/pages/identity/identity';

let _redirecting = false;

function cleanString(v) {
  const s = String(v == null ? '' : v).trim();
  return s === 'undefined' || s === 'null' ? '' : s;
}

function normalize(o) {
  if (!o || typeof o !== 'object') return null;
  const token = cleanString(o.token);
  const sid = cleanString(o.sid);
  const name = cleanString(o.name);
  if (!token || !sid || !name) return null;
  return {
    token: token,
    sid: sid,
    name: name,
    role: cleanString(o.role),
    badge: cleanString(o.badge),
    is_admin: !!o.is_admin,
    ts: Number(o.ts) || 0
  };
}

// 读取本机身份；存储兼容「JSON 字符串」与「已解析对象」两种写法
function get() {
  try {
    let v = wx.getStorageSync(KEY);
    if (v === '' || v === null || v === undefined) return null;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { return null; } }
    return normalize(v);
  } catch (e) { return null; }
}

function has() { return !!get(); }

function save(id) {
  const v = normalize(id);
  if (!v) { clear(); return null; }
  // 同一台手机换人验证（学号变化）：旧身份的持久缓存必须全清，防止串数据
  const old = get();
  if (old && old.sid && old.sid !== v.sid) {
    try { require('./cache.js').clearAll(); } catch (e) { /* ignore */ }
  }
  try { wx.setStorageSync(KEY, JSON.stringify(v)); return v; } catch (e) { return null; }
}

function clear() {
  try { wx.removeStorageSync(KEY); } catch (e) { /* ignore */ }
  // 隐私：退出身份即清掉持久缓存（通知按 audience 过滤，不能让下一名同学在同一台手机看到）
  try { require('./cache.js').clearAll(); } catch (e) { /* ignore */ }
}

function token() { const v = get(); return v ? v.token : ''; }
function sid() { const v = get(); return v ? v.sid : ''; }
function name() { const v = get(); return v ? v.name : ''; }
function isAdmin() { const v = get(); return !!(v && v.is_admin); }
function role() { const v = get(); return v ? v.role : ''; }
function badge() { const v = get(); return v ? v.badge : ''; }

// v1.3.3：页面不再展示学号（此前 maskSid 打码展示已移除；sid 仅用于云端身份/数据归属，不进页面）

// 身份标签：优先 role，其次 badge
function label() {
  const v = get();
  if (!v) return '';
  return v.role || v.badge || '';
}

// 页面守卫：没有身份 → 立即回身份页，返回 false；页面 onShow 第一行调用即可
function ensure() {
  if (has()) return true;
  if (_redirecting) return false;
  _redirecting = true;
  try {
    wx.reLaunch({ url: IDENTITY_PAGE });
  } catch (e) { /* ignore */ }
  setTimeout(function () { _redirecting = false; }, 800);
  return false;
}

function goIdentity() {
  try { wx.reLaunch({ url: IDENTITY_PAGE }); } catch (e) { /* ignore */ }
}

// 云端 401（token 过期/被清）统一入口：清本机身份 + 通知缓存，回身份页，避免继续用失效 token
// 每 5 秒最多触发一次（多个并发请求同时 401 时只跳一次，不弹多次 toast/不产生跳转循环）。
let _expiredAt = 0;
function onAuthExpired() {
  const now = Date.now();
  if (_expiredAt && now - _expiredAt < 5000) return;
  _expiredAt = now;
  if (!has()) return;
  clear();
  try {
    wx.showToast({ title: '身份已过期，请重新验证', icon: 'none', duration: 1800 });
  } catch (e) { /* ignore */ }
  goIdentity();
}

// 验证身份：class_verify → 保存身份 → 拉取 class_members 名单
// 返回 Promise<{ok, reason?, identity?, members?}>
function login(sidIn, nameIn) {
  const cloud = require('./cloud.js');   // 延迟 require，避免与 cloud.js 形成加载期循环依赖
  return cloud.classVerify(sidIn, nameIn).then(function (r) {
    if (!r || !r.ok || !r.identity) return r || { ok: false, reason: '验证失败，请重试' };
    const saved = save(r.identity);
    if (!saved) return { ok: false, reason: '身份保存失败，请清理小程序缓存后重试' };
    return cloud.classMembersPull().then(function (list) {
      return { ok: true, identity: saved, members: (list || []).length, membersFailed: !(list && list.length) };
    }).catch(function () {
      return { ok: true, identity: saved, members: 0, membersFailed: true };
    });
  }).catch(function () {
    return { ok: false, reason: '网络不可用，请检查网络后重试' };
  });
}

// 退出身份：清空本机身份 + 班级名单缓存，回身份页
function logout() {
  clear();
  try {
    const cloud = require('./cloud.js');
    cloud.clearClassData();
  } catch (e) { /* ignore */ }
  goIdentity();
}

module.exports = {
  KEY, IDENTITY_PAGE,
  get, has, save, clear,
  token, sid, name, role, badge, isAdmin, label,
  ensure, goIdentity, login, logout, onAuthExpired
};
