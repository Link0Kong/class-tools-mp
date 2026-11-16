// utils/util.js —— 通用工具（语义对齐原站 index.html）
const appearance = require('./appearance.js');
function pad(n) { return String(n).padStart(2, '0'); }
function stamp() {
  const d = new Date();
  return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}
function timeStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function safeName(s) {
  return String(s == null ? '' : s).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
function recId(prefix) {
  return (prefix || 'REC') + '-' + stamp() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}
function toast(m) { wx.showToast({ title: String(m == null ? '' : m), icon: 'none', duration: 1900 }); }
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
function todayStr() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function copyText(t) { wx.setClipboardData({ data: String(t == null ? '' : t) }); }
function toDate(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(/-/g, '/') + (String(s).length <= 10 ? ' 00:00:00' : ''));
  return isNaN(d.getTime()) ? null : d;
}
// 解析排除序号："1,3,5-8" -> [1,3,5,6,7,8]
function parseExcl(s) {
  const set = [];
  String(s || '').split(/[,，\s]+/).forEach(function (p) {
    if (!p) return;
    const m = p.match(/^(\d+)\s*[-~—]\s*(\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2]; i++) set.push(i); }
    else if (/^\d+$/.test(p)) set.push(+p);
  });
  return set;
}
// 解析周次："1-8,10" -> [1..8,10]
function parseWeeks(str) {
  const set = [];
  String(str || '').split(/[,，]/).forEach(function (p) {
    p = p.trim();
    if (!p) return;
    const m = p.match(/^(\d+)\s*[-~—]\s*(\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2]; i++) set.push(i); }
    else if (/^\d+$/.test(p)) set.push(+p);
  });
  return set;
}
// 开学日期 -> 当前周次（第 1 周 = 开学当周）
function weekNum(termStart) {
  const a = toDate(termStart);
  if (!a) return null;
  const n = new Date();
  const x = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const y = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  const w = Math.floor((y - x) / 604800000) + 1;
  return w > 0 ? w : null;
}
// 作业截止时间：日期 + 可选时间；未设置时间按当天 00:00
function hwDue(h) {
  if (!h || !h.date) return null;
  const d = toDate(h.date);
  if (!d) return null;
  const m = String(h.time || '').match(/^(\d{1,2}):(\d{2})$/);
  d.setHours(m ? +m[1] : 0, m ? +m[2] : 0, 0, 0);
  return d.getTime();
}
// 截止日期提示（与原站文案一致）
function dueInfo(h) {
  if (!h.date) return { cls: 'grey', txt: h.due || '无截止日期', left: null };
  const end = hwDue(h);
  if (end == null) return { cls: 'grey', txt: h.due || '无截止日期', left: null };
  const ms = end - Date.now();
  const hrs = ms / 3600000;
  if (ms < 0) {
    const ah = Math.abs(hrs);
    return { cls: 'red', txt: ah < 24 ? ('已过期 ' + Math.max(1, Math.round(ah)) + ' 小时') : ('已过期 ' + Math.round(ah / 24) + ' 天'), left: ms };
  }
  if (hrs < 24) return { cls: 'red', txt: '还剩 ' + Math.max(1, Math.round(hrs)) + ' 小时', left: ms };
  const dd = Math.ceil(hrs / 24);
  return { cls: dd <= 3 ? 'warn' : 'ok', txt: '还剩 ' + dd + ' 天', left: ms };
}
// 有截止日期的作业：截止时间后再过 3 个完整天，下一次打开时自动清除
function hwExpired(h, now) {
  if (!h || !h.date) return false;
  const end = hwDue(h);
  if (end == null) return false;
  return (now || Date.now()) > end + 3 * 86400000;
}
// 名单文本 -> { m: {num: name}, n: 人数 }
// 支持 "1 张三" / "1.张三" / "1、张三" / "张三"（无编号时按行号）
function rosterMap(str) {
  const m = {};
  let n = 0, idx = 0;
  String(str || '').split(/\r?\n/).forEach(function (line) {
    idx += 1;
    const s = String(line).trim();
    if (!s || /^\d+$/.test(s)) return;
    const mm = s.match(/^(\d+)\s*[.,、:：\-]?\s*(\S.*)$/);
    const num = mm ? +mm[1] : idx;
    const name = mm ? mm[2].trim() : s;
    if (name) { m[num] = name; n += 1; }
  });
  return { m: m, n: n };
}

// 只把真正变化的顶层字段打进 setData（需求 9：diff 后仅 setData 变化字段，避免整页重渲染）。
//   prev = 页面当前 data（或它的子集），next = 重新计算后的完整状态（扁平对象）
//   浅比较：Object.is 相等 / JSON 相同 → 跳过；返回可直接交给 setData 的补丁（无变化返回 null）
function diffPatch(prev, next) {
  const p = prev || {};
  const n = next || {};
  const patch = {};
  let changed = 0;
  Object.keys(n).forEach(function (k) {
    const a = p[k], b = n[k];
    if (a === b) return;
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      try { if (JSON.stringify(a) === JSON.stringify(b)) return; } catch (e) { /* 循环引用 → 视为变化 */ }
    }
    patch[k] = b;
    changed += 1;
  });
  return changed ? patch : null;
}
// 徽章去重（需求 2）：role（职务文字）已展示时，不再重复展示同义的「班委」badge 气泡。
//   规则：badge 为空 → ''；badge===role → ''（重复）；role 非空且 badge==='班委' → ''（重复的班委气泡）；
//   其余（如 role 为空 / badge 是「管理员」等）按原值展示。
function showBadge(badge, role) {
  const b = String(badge == null ? '' : badge).trim();
  const r = String(role == null ? '' : role).trim();
  if (!b) return '';
  if (r && b === r) return '';
  if (r && b === '班委') return '';
  return b;
}

// 回到页面栈中的某个页面（三步流程页共用）；栈里没有则 navigateTo 过去
function backTo(route, url) {
  try {
    const ps = getCurrentPages() || [];
    for (let i = ps.length - 1; i >= 0; i--) {
      if (ps[i].route === route) { wx.navigateBack({ delta: ps.length - 1 - i }); return; }
    }
  } catch (e) { /* ignore */ }
  wx.navigateTo({ url: url || ('/' + route) });
}

// 当前生效主题：'light' | 'dark'（2026-11-15 起读「我的 → 外观」偏好：显式浅/深优先，跟随系统时看系统）
// 原生控件（switch/slider）与页面 token 都走这里，保证手动切外观后颜色一致。
function theme() {
  try { return appearance.resolved(); } catch (e) { /* 降级：系统主题 */ }
  try {
    const bi = wx.getAppBaseInfo ? wx.getAppBaseInfo() : null;
    if (bi && bi.theme) return bi.theme;
  } catch (e) { /* ignore */ }
  try { return (wx.getSystemInfoSync() || {}).theme || 'light'; } catch (e) { return 'light'; }
}
// 原生控件（slider / switch）配色：与 M3 token 的 primary、surface-container-highest 对齐
function nativeTheme() {
  const dark = theme() === 'dark';
  return {
    dark: dark,
    primary: dark ? '#9BC9BB' : '#5E8F87',
    track: dark ? '#3E443B' : '#E6E9E8'
  };
}

module.exports = {
  pad, stamp, timeStr, safeName, recId, toast, clamp, todayStr, copyText,
  toDate, parseExcl, parseWeeks, weekNum, hwDue, dueInfo, hwExpired, rosterMap, backTo,
  diffPatch, showBadge, theme, nativeTheme
};
