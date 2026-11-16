// ai/common/fmt.js —— 日期/时间/状态文案（与主包 utils/util.js、utils/notice.js 逐字节一致）
//
// 只放纯函数（不碰 wx / storage），便于 Node 单测直接 require。
// 作业：hwDue / hwDueInfo / hwExpired（← utils/util.js）
// 通知：noticeStatusOf / noticeDeadlineOf / noticeStatOf / noticeMostUrgent（← utils/notice.js）
function pad(n) { return n < 10 ? '0' + n : '' + n; }

function toDate(s) {
  if (!s) return null;
  const str = String(s);
  const d = new Date(str.replace(/-/g, '/') + (str.length <= 10 ? ' 00:00:00' : ''));
  return isNaN(d.getTime()) ? null : d;
}
function parseDate(s) { return toDate(s); }

function asDate(ts) { return (ts instanceof Date) ? ts : new Date(ts); }
function fmtDate(ts) {
  if (ts == null) return '';
  const d = asDate(ts);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function fmtDateTime(ts) {
  if (ts == null) return '';
  const d = asDate(ts);
  if (isNaN(d.getTime())) return '';
  return fmtDate(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function fmtTime(ts) {
  if (ts == null) return '';
  const d = asDate(ts);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function fmtDay(ts) {
  if (ts == null) return '';
  const d = asDate(ts);
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function todayStr() {
  const d = new Date();
  return fmtDate(d);
}
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function dayDiff(a, b) { return Math.round((startOfDay(a) - startOfDay(b)) / 86400000); }

function relativeDay(ts, now) {
  const d = asDate(ts);
  if (isNaN(d.getTime())) return '';
  const n = now == null ? new Date() : asDate(now);
  const diff = dayDiff(d, n);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  if (diff === -1) return '昨天';
  if (diff > 0) return diff + ' 天后';
  return Math.abs(diff) + ' 天前';
}

function leftText(ms) {
  if (ms == null || !isFinite(ms)) return '';
  if (ms <= 0) {
    const h = Math.abs(ms) / 3600000;
    return h < 24 ? ('已过期 ' + Math.max(1, Math.round(h)) + ' 小时') : ('已过期 ' + Math.round(h / 24) + ' 天');
  }
  const h = ms / 3600000;
  if (h < 1) return '剩 ' + Math.max(1, Math.round(ms / 60000)) + ' 分钟';
  if (h < 24) return '剩 ' + Math.max(1, Math.round(h)) + ' 小时';
  return '剩 ' + Math.ceil(h / 24) + ' 天';
}

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
function weekdayName(day) {
  const n = Number(day);
  if (!isFinite(n)) return '';
  const i = ((Math.floor(n) % 7) + 7) % 7;
  return WEEKDAYS[i];
}
// JS getDay()（0=周日）→ 课表口径（0=周一）
function weekdayIndex(d) { const g = d.getDay(); return g === 0 ? 6 : g - 1; }

function truncate(s, n) {
  const str = String(s == null ? '' : s);
  if (!n || str.length <= n) return str;
  return str.slice(0, n) + '…';
}

// "1,3,5-8" -> [1,3,5,6,7,8]（← utils/util.parseExcl）
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
// "1-8,10" -> [1..8,10]（← utils/util.parseWeeks）
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

// 开学日期 → 当前周次（第 1 周 = 开学当周；← utils/util.weekNum）
function weekNum(termStart, now) {
  const a = toDate(termStart);
  if (!a) return null;
  const n = now == null ? new Date() : asDate(now);
  const w = Math.floor(dayDiff(n, a) / 7) + 1;
  return w > 0 ? w : null;
}

// 作业截止时间（← utils/util.hwDue）
function hwDue(h) {
  if (!h || !h.date) return null;
  const d = toDate(h.date);
  if (!d) return null;
  const m = String(h.time || '').match(/^(\d{1,2}):(\d{2})$/);
  d.setHours(m ? +m[1] : 0, m ? +m[2] : 0, 0, 0);
  return d.getTime();
}
// 作业截止提示（← utils/util.dueInfo，文案一致）
function hwDueInfo(h, nowTs) {
  if (!h || !h.date) return { cls: 'grey', txt: h && h.due ? h.due : '无截止日期', left: null };
  const end = hwDue(h);
  if (end == null) return { cls: 'grey', txt: h.due || '无截止日期', left: null };
  const now = nowTs || Date.now();
  const ms = end - now;
  const hrs = ms / 3600000;
  if (ms < 0) {
    const ah = Math.abs(hrs);
    return { cls: 'red', txt: ah < 24 ? ('已过期 ' + Math.max(1, Math.round(ah)) + ' 小时') : ('已过期 ' + Math.round(ah / 24) + ' 天'), left: ms };
  }
  if (hrs < 24) return { cls: 'red', txt: '还剩 ' + Math.max(1, Math.round(hrs)) + ' 小时', left: ms };
  const dd = Math.ceil(hrs / 24);
  return { cls: dd <= 3 ? 'warn' : 'ok', txt: '还剩 ' + dd + ' 天', left: ms };
}
// 有截止日期的作业：截止后 3 个完整天自动清除（← utils/util.hwExpired）
function hwExpired(h, now) {
  if (!h || !h.date) return false;
  const end = hwDue(h);
  if (end == null) return false;
  return (now || Date.now()) > end + 3 * 86400000;
}

// ---------------------------------------------------------------- 通知（← utils/notice.js）
function nParseTs(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return isNaN(t) ? null : t;
}
function nFmt(ts) {
  const d = new Date(ts);
  return (d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function noticeDeadlineOf(g) {
  if (!g) return null;
  if (g.extensions && g.extensions.length) return nParseTs(g.extensions[g.extensions.length - 1].deadline);
  return nParseTs(g.deadline);
}
function noticeExtOf(g) {
  return (g && g.extensions && g.extensions.length) ? g.extensions[g.extensions.length - 1] : null;
}
function noticeArchiveAtOf(g) { return nParseTs(g && g.expireAt); }
function noticeEventAtOf(g) { return nParseTs(g && g.eventAt); }
function noticeTimeLabelOf(g) {
  if (!g) return '';
  if (g.timeLabel) return g.timeLabel;
  const e = noticeEventAtOf(g);
  return e ? nFmt(e) : '';
}
function noticeStatusOf(g, nowTs) {
  const now = nowTs || Date.now();
  const real = noticeDeadlineOf(g);
  const archiveAt = noticeArchiveAtOf(g);
  const eventAt = noticeEventAtOf(g);
  const ext = noticeExtOf(g);
  if (real) {
    if (now > real) {
      if (g.alert) return { key: 'alert', label: '已截止 · 有新名单', cls: 'alert', expired: false };
      if (ext) return { key: 'extended_past', label: '已延长 · 已截止', cls: 'expired', expired: true };
      return { key: 'expired', label: '已截止 · 自动完成', cls: 'expired', expired: true };
    }
    if (ext) return { key: 'extended', label: '已延长 · ' + nFmt(real) + ' 截止', cls: 'extended', expired: false };
    const left = real - now;
    if (left < 3600 * 1000) return { key: 'urgent', label: '剩 ' + Math.max(1, Math.round(left / 60000)) + ' 分钟', cls: 'urgent', expired: false };
    if (left < 24 * 3600 * 1000) {
      const d = new Date(real), hh = d.getHours(), mm = d.getMinutes();
      const lab = (hh === 0 && mm === 0) ? '今天 24:00' : ('今天 ' + pad(hh) + ':' + pad(mm));
      return { key: 'today', label: lab + ' 截止', cls: 'urgent', expired: false };
    }
    if (left < 72 * 3600 * 1000) return { key: 'soon', label: Math.ceil(left / 86400000) + ' 天后截止', cls: 'active', expired: false };
    return { key: 'active', label: nFmt(real) + ' 截止', cls: 'active', expired: false };
  }
  if (eventAt) {
    const end = archiveAt || eventAt;
    if (now > end) return { key: 'expired', label: '已结束 · 自动归档', cls: 'expired', expired: true };
    return { key: 'active', label: noticeTimeLabelOf(g) || nFmt(eventAt), cls: 'active', expired: false };
  }
  return { key: 'none', label: '无时间', cls: 'none', expired: false };
}
function noticeIsExpired(g) { return noticeStatusOf(g).expired; }
function noticeIsActionable(g) { return !g || g.actionable !== false; }
function noticeDoneOf(done, id) { return !!(done && id && done[id]); }
function noticeStatOf(all, done, nowTs) {
  const now = nowTs || Date.now();
  const day = 86400000;
  let pending = 0, urgent = 0, week = 0, expired = 0;
  (all || []).forEach(function (g) {
    const st = noticeStatusOf(g, now);
    if (st.expired) { expired += 1; return; }
    if (!noticeIsActionable(g)) return;
    if (noticeDoneOf(done, g && g.id)) return;
    pending += 1;
    const real = noticeDeadlineOf(g);
    if (real && real >= now) {
      const left = real - now;
      if (left <= day) urgent += 1;
      if (left <= 7 * day) week += 1;
    }
  });
  return { pending: pending, urgent: urgent, week: week, expired: expired };
}
function noticeMostUrgent(all, done) {
  const list = (all || []).filter(function (g) {
    const st = noticeStatusOf(g);
    return !st.expired && noticeIsActionable(g) && !noticeDoneOf(done, g && g.id);
  });
  list.sort(function (a, b) {
    const aa = a.alert ? 1 : 0, ba = b.alert ? 1 : 0;
    if (aa !== ba) return ba - aa;
    const ta = noticeDeadlineOf(a), tb = noticeDeadlineOf(b);
    if (ta == null && tb == null) return 0;
    if (ta == null) return 1;
    if (tb == null) return -1;
    return ta - tb;
  });
  return list[0] || null;
}

module.exports = {
  pad: pad, toDate: toDate, parseDate: parseDate,
  fmtDate: fmtDate, fmtDateTime: fmtDateTime, fmtTime: fmtTime, fmtDay: fmtDay, todayStr: todayStr,
  startOfDay: startOfDay, dayDiff: dayDiff, relativeDay: relativeDay, leftText: leftText,
  WEEKDAYS: WEEKDAYS, weekdayName: weekdayName, weekdayIndex: weekdayIndex, truncate: truncate,
  parseExcl: parseExcl, parseWeeks: parseWeeks, weekNum: weekNum,
  hwDue: hwDue, hwDueInfo: hwDueInfo, hwExpired: hwExpired,
  noticeDeadlineOf: noticeDeadlineOf, noticeExtOf: noticeExtOf,
  noticeArchiveAtOf: noticeArchiveAtOf, noticeEventAtOf: noticeEventAtOf, noticeTimeLabelOf: noticeTimeLabelOf,
  noticeStatusOf: noticeStatusOf, noticeIsExpired: noticeIsExpired, noticeIsActionable: noticeIsActionable,
  noticeDoneOf: noticeDoneOf, noticeStatOf: noticeStatOf, noticeMostUrgent: noticeMostUrgent, noticeFmt: nFmt
};
