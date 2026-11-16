// ai/common/auth.js —— 身份层（原子接口环境）
//
// 与主包完全共用 storage 键 'zq_class_identity'（微信 AI 模式下与小程序同一登录身份）：
//   { token, sid, name, role, badge, is_admin, ts }（JSON 字符串或对象两种写法都兼容）
//
// 原子接口不能 getApp()/reLaunch，所以这里只提供：
//   getIdentity / hasIdentity / token / sid / name / role / badge / label / isAdmin
//   saveIdentity / pullMembers（RPC class_members，成功则写本机名单缓存）
// 需要引导用户去验证时返回 result.missingAuth()（带 handoff 到身份页）。
const KEY = 'zq_class_identity';

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

function getIdentity() {
  try {
    let v = wx.getStorageSync(KEY);
    if (v === '' || v === null || v === undefined) return null;
    if (typeof v === 'string') {
      try { v = JSON.parse(v); } catch (e) { return null; }
    }
    return normalize(v);
  } catch (e) { return null; }
}

function saveIdentity(id) {
  const v = normalize(id);
  if (!v) return false;
  try {
    wx.setStorageSync(KEY, JSON.stringify(v));
    return true;
  } catch (e) { return false; }
}

function hasIdentity() { return !!getIdentity(); }
function token() { const v = getIdentity(); return v ? v.token : ''; }
function sid() { const v = getIdentity(); return v ? v.sid : ''; }
function name() { const v = getIdentity(); return v ? v.name : ''; }
function role() { const v = getIdentity(); return v ? v.role : ''; }
function badge() { const v = getIdentity(); return v ? v.badge : ''; }
function isAdmin() { const v = getIdentity(); return !!(v && v.is_admin); }
function label() { const v = getIdentity(); return v ? (v.role || v.badge || '') : ''; }

// 规范化云端名单条目（与主包 cloud.normalizeMember 一致）
function normalizeMember(m) {
  if (!m || typeof m !== 'object') return null;
  const nm = String(m.name == null ? '' : m.name).trim();
  if (!nm) return null;
  return {
    seat: +m.seat || 0,
    sid: String(m.sid == null ? '' : m.sid).trim(),
    name: nm,
    role: String(m.role == null ? '' : m.role).trim(),
    badge: String(m.badge == null ? '' : m.badge).trim(),
    is_admin: !!m.is_admin
  };
}

// 拉取班级名单（需要身份 token）；成功写本机缓存（classMembers/classRoster/classMembersAt）
function pullMembers() {
  const rest = require('./rest.js');   // 延迟 require，避免 auth ↔ rest 加载期循环依赖
  const local = require('./local.js');
  if (!hasIdentity()) return Promise.reject(makeErr('identity-required', '请先完成身份验证'));
  return rest.rpc('rpc/class_members', {}).then(function (raw) {
    const list = Array.isArray(raw) ? raw : (Array.isArray(raw && raw.data) ? raw.data : []);
    const members = list.map(normalizeMember).filter(Boolean).sort(function (a, b) { return a.seat - b.seat; });
    if (members.length) local.saveClassMembers(members);
    return members;
  });
}

function makeErr(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

module.exports = {
  KEY: KEY,
  getIdentity: getIdentity, hasIdentity: hasIdentity, saveIdentity: saveIdentity,
  token: token, sid: sid, name: name, role: role, badge: badge, label: label, isAdmin: isAdmin,
  normalizeMember: normalizeMember, pullMembers: pullMembers
};
