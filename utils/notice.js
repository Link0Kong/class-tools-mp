// utils/notice.js —— 通知时间/状态口径（与网页端通知页保持同一套规则）
//
// 网页端（briefdesk build_notice_board.py / notice-board）的规则：
//   1) 有真实截止时间（deadline，含 extensions 最后一次延期）→ 只按真实截止判断与展示；
//      expireAt 只是「多久后不再显示为进行中」的自动归档兜底，绝不拿来当截止时间展示；
//   2) 没有截止但有活动/事件时间（eventAt）→ 活动结束（archiveAt || eventAt）才算结束；
//   3) 两者都没有 → 契约 2026-11-18：时间 = 发布时间、动作 =「发布」，参与排序/待处理统一计算；
//      连发布时间都没有（极旧缓存/空 items）才显示「无时间」，归「资料 / 无时间」兜底栏。
// 自动通知结构来自 public.notices.body 里的 [[CLASS_NOTICE_V1]] JSON。
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function fmt(ts) {
  const d = new Date(ts);
  return (d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function parseTs(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return isNaN(t) ? null : t;
}

// ---------------------------------------------------------------- 契约 §2.1：时间部分「fmtWhen」
// 已过 → MM-DD HH:MM；0 ≤ 剩余 < 1h → N 分钟后；< 24h → N 小时后；< 7d → N 天后；≥ 7d → MM-DD HH:MM
// 禁止「今天/明天 + 钟点」混排（旧 bug：把明天 12:00 显示成「今天 12:00 截止」）
function fmtWhen(ts, nowTs) {
  const t = (typeof ts === 'number') ? ts : parseTs(ts);
  if (t == null || isNaN(t)) return '';
  const now = (nowTs == null || isNaN(nowTs)) ? Date.now() : Number(nowTs);
  const left = t - now;
  if (left < 0) return fmt(t);
  if (left < 3600 * 1000) return Math.max(1, Math.ceil(left / 60000)) + ' 分钟后';
  if (left < 24 * 3600 * 1000) return Math.max(1, Math.ceil(left / (3600 * 1000))) + ' 小时后';
  if (left < 7 * 24 * 3600 * 1000) return Math.max(1, Math.ceil(left / (24 * 3600 * 1000))) + ' 天后';
  return fmt(t);
}

// 活动报名窗口（契约 §1/§4）：旧数据没有 signupStart / signupEnd → null
function signupOf(g) {
  return { start: parseTs(g && g.signupStart), end: parseTs(g && g.signupEnd) };
}

// ---------------------------------------------------------------- 契约 §0.2（第三轮）：动作精简
// chip 动作 ≤6 字、优先 2–4 字；长→短映射（数据侧 pipeline 已产出短词，这里显示侧兜底）；
// 「报名已截止」→「报名截止」（已过由 key/cls 样式表达，不加「已」）。
const ACTION_MAP = {
  '报送姓名截止': '报送截止',
  '集合点名': '点名',
  '活动开始': '开始',
  '签到开始': '签到',
  '签到签退': '签到',
  '比赛开始': '比赛',
  '考试开始': '考试',
  '报名已截止': '报名截止'
};
function conciseAction(a) {
  const s = String(a == null ? '' : a).trim();
  if (!s) return '';
  if (Object.prototype.hasOwnProperty.call(ACTION_MAP, s)) return ACTION_MAP[s];
  if (s.length <= 6) return s;
  // 超长兜底：含「截止」保留「XX截止」语义，其余直接截断到 6 字
  if (s.indexOf('截止') >= 0) {
    const head = s.replace(/截止[\s\S]*$/, '');
    const keep = head.slice(-2);
    return (keep ? keep : '') + '截止';
  }
  return s.slice(0, 6);
}

// 主显示时间（契约 §2.2 优先级：报名 > 截止 > 活动/事件；动作过 §0.2 精简）→ { ts, action } | null
function whenInfo(g, nowTs) {
  const now = (nowTs == null || isNaN(nowTs)) ? Date.now() : Number(nowTs);
  const su = signupOf(g);
  if (su.start != null || su.end != null) {
    if (su.start != null && now < su.start) return { ts: su.start, action: '报名开始' };
    if (su.end != null) return { ts: su.end, action: '报名截止' };
    // 只有 signupStart 且已开始：报名窗口不完整 → 退回截止/活动时间
  }
  const real = deadlineOf(g);
  if (real != null) return { ts: real, action: conciseAction((g && g.deadlineAction) || '截止') };
  const eventAt = eventAtOf(g);
  if (eventAt != null) return { ts: eventAt, action: conciseAction((g && g.eventAction) || '开始') };
  return null;
}
// 主显示时间戳（排序/简报刊数用）；无时间 → null
function whenOf(g, nowTs) { const w = whenInfo(g, nowTs); return w ? w.ts : null; }

// 真实截止：优先最后一次延期，其次 deadline
function deadlineOf(g) {
  if (!g) return null;
  if (g.extensions && g.extensions.length) {
    return parseTs(g.extensions[g.extensions.length - 1].deadline);
  }
  return parseTs(g.deadline);
}
function extOf(g) {
  return (g && g.extensions && g.extensions.length) ? g.extensions[g.extensions.length - 1] : null;
}
function archiveAtOf(g) { return parseTs(g && g.expireAt); }
function eventAtOf(g) { return parseTs(g && g.eventAt); }
function timeLabelOf(g) {
  if (!g) return '';
  if (g.timeLabel) return g.timeLabel;
  const e = eventAtOf(g);
  return e ? fmt(e) : '';
}

// 契约 §2.2：统一「<时间> <动作>」（时间在前、动作在后，中间一个空格）；key / cls / expired 字段保持不变
// （待处理计数、筛选、最紧急排序、工作台都依赖 key，只有 label 口径变化）
// 距目标时间的紧迫度分桶：沿用既有 key（urgent <1h / today <24h / soon <3d / active ≥3d）
function bucketOf(ts, action, now) {
  const label = fmtWhen(ts, now) + ' ' + action;
  const left = ts - now;
  if (left < 3600 * 1000) return { key: 'urgent', label: label, cls: 'urgent', expired: false };
  if (left < 24 * 3600 * 1000) return { key: 'today', label: label, cls: 'urgent', expired: false };
  if (left < 72 * 3600 * 1000) return { key: 'soon', label: label, cls: 'active', expired: false };
  return { key: 'active', label: label, cls: 'active', expired: false };
}

function statusOf(g, nowTs) {
  const now = (nowTs == null || isNaN(nowTs)) ? Date.now() : Number(nowTs);
  // 需求 9：长期安排（recurrence）永不按 deadline 判过期；契约 §2.2 唯一例外「长期安排 · label」
  const rec = recurOf(g);
  if (rec) {
    // 契约 2026-11-14 §1.1：until 已过 / 下一次已越过 until → 「长期安排已结束」，归入已过期区，不再产生期次
    if (isRecurEnded(g, now)) return { key: 'expired', label: '长期安排已结束', cls: 'expired', expired: true };
    return { key: 'recurring', label: rec.label ? ('长期安排 · ' + rec.label) : '长期安排', cls: 'recurring', expired: false };
  }
  const real = deadlineOf(g);
  const archiveAt = archiveAtOf(g);
  const eventAt = eventAtOf(g);
  const ext = extOf(g);
  // 2026-11-12：AI 质检明确判定已过期（历史活动/名单/赛程/课程安排等）——与网页模板 statusOf 同口径；
  // 放在长期安排之后、其它时间判断之前（长期安排永不按过期处理）。当前数据 0 条，按契约对齐。
  if (g && g.expired === true) {
    if (g.alert) return { key: 'alert', label: '已截止 · 有新名单', cls: 'alert', expired: false };
    if (ext) return { key: 'extended_past', label: '已过期', cls: 'expired', expired: true };
    return { key: 'expired', label: '已过期', cls: 'expired', expired: true };
  }
  // alert（已截止有新名单）：唯一保留的「非时间在前」文案，维持用户熟悉的显示，不算过期
  if (real != null && now > real && g.alert) return { key: 'alert', label: '已截止 · 有新名单', cls: 'alert', expired: false };
  // 报名优先（契约 §2.2 3）：开始前 → 报名开始；窗口内 → 报名截止；已过 → 报名截止（§0.2 不加「已」）
  const su = signupOf(g);
  const signupOnly = (su.start != null || su.end != null);
  const signupStarted = su.start != null && now >= su.start;
  if (signupOnly && !(su.start != null && su.end == null && signupStarted)) {
    if (su.start != null && now < su.start) return bucketOf(su.start, '报名开始', now);
    if (su.end != null && now < su.end) return bucketOf(su.end, '报名截止', now);
    const endTs = su.end != null ? su.end : su.start;
    return { key: 'expired', label: fmtWhen(endTs, now) + ' 报名截止', cls: 'expired', expired: true };
  }
  if (real != null) {
    // 有真实截止：只按真实截止判断与展示（extensions 取最后一次延期，后缀动作同一条规则；动作过 §0.2 精简）
    const action = conciseAction((g && g.deadlineAction) || '截止');
    if (now > real) {
      const lab = fmtWhen(real, now) + ' ' + action;
      // 延期过的已截止保持 extended_past（cls=expired），未延期的保持 expired
      if (ext) return { key: 'extended_past', label: lab, cls: 'expired', expired: true };
      return { key: 'expired', label: lab, cls: 'expired', expired: true };
    }
    const b = bucketOf(real, action, now);
    // 延期过的未截止保持 extended（cls=extended）
    if (ext) return { key: 'extended', label: b.label, cls: 'extended', expired: false };
    return b;
  }
  if (eventAt != null) {
    const action = conciseAction((g && g.eventAction) || '开始');
    const end = archiveAt || eventAt;
    const lab = fmtWhen(eventAt, now) + ' ' + action;
    if (now > end) return { key: 'expired', label: lab, cls: 'expired', expired: true };
    return { key: 'active', label: lab, cls: 'active', expired: false };
  }
  // 契约 2026-11-18 §2：既无截止/活动/报名等真实时间锚点（长期安排与已过期在上面已优先返回）→
  // 时间 = 发布时间、动作 =「发布」，参与主列表排序与待处理统计；旧缓存没有 publishedAt 时按组内最新消息时间回退。
  const pubTs = publishedTsOf(g, now);
  if (pubTs != null) {
    return { key: 'published', label: fmtWhen(pubTs, now) + ' ' + ((g && g.publishAction) || '发布'), cls: 'active', expired: false };
  }
  return { key: 'none', label: '无时间', cls: 'none', expired: false };
}

function isExpired(g) { return statusOf(g).expired; }

// ---------------------------------------------------------------- 需求 9：长期安排（recurrence）
// 数据契约见 web/_v2_plan.md §2：
//   recurrence = { freq:'weekly'|'monthly_weeks'|'monthly_day'|'daily', weekday(0=周日…6=周六),
//                  weeks:[1,2,3](monthly_weeks 用：每月第 1..3 次出现的 weekday),
//                  day(monthly_day 用), time:'HH:MM', startAt(ISO), label:'每月前三周 周三 17:30' }
// 规则（与网页端一致）：
//   * 有 recurrence 的通知**永不按 deadline 判过期**；卡片显示「长期安排 · label · 下次 MM-DD 周X HH:MM」；
//   * actionable=false 不计入待处理（工作台/通知页统计都不算），只有知悉意义；
//   * 下次时间由前端本地按 now 计算（不依赖云端下发）。
const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const RECUR_FREQS = ['weekly', 'monthly_weeks', 'monthly_day', 'daily'];

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
// 契约 2026-11-14 §1.1：长期安排 = recurrence 且 freq 合法 且 time 为 HH:MM；
// 缺 time / 坏 freq 一律丢弃 recurrence（数据侧兜底，显示侧同样不把坏数据当长期安排）。
// 契约 §1.3：可选 until = 'YYYY-MM-DD'（含当天有效）或 ISO datetime → 该周期安排的有效期末（ms）。
function untilOf(g) {
  const r = g && g.recurrence;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const v = r.until;
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  // 纯日期：含当天有效 → 当天 23:59:59.999（本地）
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999).getTime();
  // 带时间的 ISO：显式时区交给 Date.parse（保留 +08:00 语义），无时区按本地
  m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
      const t = Date.parse(s);
      if (!isNaN(t)) return t;
    }
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), 0).getTime();
  }
  return null;
}
// 解析并归一 recurrence（无/坏数据 / 缺 time → null）；until 一并带出
function recurOf(g) {
  const r = g && g.recurrence;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const freq = String(r.freq || '');
  if (RECUR_FREQS.indexOf(freq) < 0) return null;
  const tm = String(r.time || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!tm) return null;                       // 契约 §1.1：无 HH:MM 时间不是长期安排
  const hh = Math.min(23, +tm[1]);
  const mm = Math.min(59, +tm[2]);
  const weekday = Number(r.weekday);
  const weeks = (Array.isArray(r.weeks) ? r.weeks : []).map(Number)
    .filter(function (n) { return n >= 1 && n <= 5; })
    .sort(function (a, b) { return a - b; });
  return {
    freq: freq,
    weekday: (weekday >= 0 && weekday <= 6) ? weekday : 0,
    weeks: weeks,
    day: Number(r.day) || 0,
    hh: hh, mm: mm,
    start: parseTs(r.startAt),
    until: untilOf(g),
    label: String(r.label || '')
  };
}
// 某月第 n 次出现的某 weekday（1..5）；不存在返回 null
function nthWeekdayOfMonth(year, month, weekday, n) {
  const last = new Date(year, month + 1, 0).getDate();
  let count = 0;
  for (let d = 1; d <= last; d++) {
    const dt = new Date(year, month, d);
    if (dt.getDay() === weekday) {
      count += 1;
      if (count === n) return dt;
    }
  }
  return null;
}
function atTime(d, hh, mm) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0).getTime(); }
// 原始「下次发生时间」计算（不含 until 上限；严格 > now 且不早于 startAt）
function nextRawOf(g, nowTs) {
  const rec = recurOf(g);
  if (!rec) return null;
  const now = Number(nowTs) || Date.now();
  const start = rec.start;                       // startAt 之前不算「已开始」
  const ok = function (ts) { return ts > now && (!start || ts >= start); };
  const today = new Date(now);
  if (rec.freq === 'daily') {
    for (let i = 0; i < 60; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const ts = atTime(d, rec.hh, rec.mm);
      if (ok(ts)) return ts;
    }
    return null;
  }
  if (rec.freq === 'weekly') {
    for (let i = 0; i < 60; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      if (d.getDay() !== rec.weekday) continue;
      const ts = atTime(d, rec.hh, rec.mm);
      if (ok(ts)) return ts;
    }
    return null;
  }
  if (rec.freq === 'monthly_day') {
    if (!(rec.day >= 1 && rec.day <= 28)) return null;   // 只支持 1–28（每月都存在），避免 31 号闰月歧义
    for (let i = 0; i < 24; i++) {
      const y = today.getFullYear(), m = today.getMonth() + i;
      const ts = new Date(y, m, rec.day, rec.hh, rec.mm, 0, 0).getTime();
      if (ok(ts)) return ts;
    }
    return null;
  }
  // monthly_weeks：每月第 weeks 次出现的 weekday
  const weeks = rec.weeks.length ? rec.weeks : [1, 2, 3];
  let best = null;
  for (let i = 0; i < 24 && best == null; i++) {
    const y = today.getFullYear(), m = today.getMonth() + i;
    for (let wi = 0; wi < weeks.length; wi++) {
      const d = nthWeekdayOfMonth(y, m, rec.weekday, weeks[wi]);
      if (!d) continue;
      const ts = atTime(d, rec.hh, rec.mm);
      if (!ok(ts)) continue;
      if (best == null || ts < best) best = ts;
    }
  }
  return best;
}
// 契约 §1.3：周期安排是否已结束（归入已过期区、不再产生期次）——
//   now > until 当天 23:59，或下一次发生时间已越过 until，都算结束。
function isRecurEnded(g, nowTs) {
  const rec = recurOf(g);
  if (!rec || rec.until == null) return false;
  const now = (nowTs == null || isNaN(Number(nowTs))) ? Date.now() : Number(nowTs);
  if (now > rec.until) return true;
  const n = nextRawOf(g, now);
  return n != null && n > rec.until;
}
// 下次发生时间（ms）；无 recurrence / 无法计算 / 已越过 until → null
function nextOf(g, nowTs) {
  const rec = recurOf(g);
  if (!rec) return null;
  const now = (nowTs == null || isNaN(Number(nowTs))) ? Date.now() : Number(nowTs);
  if (rec.until != null && now > rec.until) return null;
  const ts = nextRawOf(g, now);
  if (ts == null) return null;
  if (rec.until != null && ts > rec.until) return null;
  return ts;
}
// 「下次 MM-DD 周X HH:MM」；无下次返回 ''
function nextTextOf(g, nowTs) {
  const ts = nextOf(g, nowTs);
  if (ts == null) return '';
  const d = new Date(ts);
  return '下次 ' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
    WEEK_CN[d.getDay()] + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
// 长期安排的展示文案：label（无则按 freq 兜底）
function recurLabelOf(g) {
  const rec = recurOf(g);
  if (!rec) return '';
  if (rec.label) return rec.label;
  if (rec.freq === 'daily') return '每天 ' + pad2(rec.hh) + ':' + pad2(rec.mm);
  if (rec.freq === 'weekly') return '每周' + WEEK_CN[rec.weekday].slice(1) + ' ' + pad2(rec.hh) + ':' + pad2(rec.mm);
  if (rec.freq === 'monthly_day') return '每月 ' + rec.day + ' 日 ' + pad2(rec.hh) + ':' + pad2(rec.mm);
  return '每月前 ' + (rec.weeks.length ? rec.weeks[rec.weeks.length - 1] : 3) + ' 周' +
    WEEK_CN[rec.weekday].slice(1) + ' ' + pad2(rec.hh) + ':' + pad2(rec.mm);
}
// 管理员编辑覆盖：override_json 白名单字段合并到 group（值为 null = 清空该字段）
const OVERRIDE_KEYS = ['title', 'cat', 'summary', 'aiSummary', 'deadline', 'eventAt', 'expireAt', 'timeLabel'];
function applyOverride(g) {
  if (!g || !g._override || typeof g._override !== 'object') return g;
  const out = Object.assign({}, g);
  OVERRIDE_KEYS.forEach(function (k) {
    if (!Object.prototype.hasOwnProperty.call(g._override, k)) return;
    const v = g._override[k];
    if (v === null || v === '') delete out[k];
    else out[k] = v;
  });
  return out;
}

// 兼容旧调用：工作台/通知页都用它拿「是否过期 + 文案」
function deadlineInfo(g) {
  const st = statusOf(g);
  return { expired: st.expired, label: st.label, key: st.key, cls: st.cls };
}

function isActionable(g) { return !g || g.actionable !== false; }

// ---------------------------------------------------------------- 2026-11-12：长期通知（长期安排 + 无时间/长期有效）
// 规格：web/tools/tests/notice_longterm_display_spec.md §1/§2/§4（网页/小程序同一口径）
//   · 长期安排：recurrence 为对象且 freq 非空 → subtype='recur'（永不按 deadline 判过期）；
//   · 无时间/长期有效：无真实截止（含 extensions 最后一条）、无 eventAt、无报名窗口，
//     且 statusOf().key 不是 expired / extended_past / alert → subtype='info'。
// 主列表只保留「时间明确、可处理」的通知；长期通知移入列表下方独立折叠区，且不计入待处理统计。
function isRecurGroup(g) { return !!recurOf(g); }
function hasTimeAnchor(g) {
  if (!g) return false;
  if (deadlineOf(g) != null) return true;
  if (parseTs(g.eventAt) != null) return true;
  if (parseTs(g.signupStart) != null || parseTs(g.signupEnd) != null) return true;
  if (Array.isArray(g.signupWindows) && g.signupWindows.length) return true;
  return false;
}
// '' = 普通通知；'recur' = 进行中的长期安排；'info' = 资料 / 无时间（仅兜底，正常为 0 条）
// 契约 2026-11-14 §1.2/§1.3：无时间 → 资料栏；until 已过 → 归已过期区（不再是长期通知）。
// 契约 2026-11-18 §3：有发布时间（publishedAt / 可回退推算）→ 发布卡进主列表，不再进资料栏；
// 只有「既无真实时间锚点、又无发布时间」的兜底卡才留在资料栏。
function longtermSubtypeOf(g, nowTs) {
  if (!g) return '';
  if (isRecurGroup(g)) return isRecurEnded(g, nowTs) ? '' : 'recur';
  if (hasTimeAnchor(g)) return '';
  if (publishedTsOf(g, nowTs) != null) return '';
  const k = statusOf(g, nowTs).key;
  if (k === 'expired' || k === 'extended_past' || k === 'alert') return '';
  return 'info';
}
function isLongterm(g, nowTs) { return !!longtermSubtypeOf(g, nowTs); }

// 主列表档位（网页 orderRank 同口径）：0 alert / 1 urgent·today / 2 extended / 3 soon·active /
// 4 发布时间卡·无时间兜底 / 7 延期已截止 / 8 已截止 / 9 已处理（主列表最后；长期通知本就不在主列表）
function listRankOf(g, done, nowTs) {
  if (doneOf(done, g && g.id)) return 9;
  const st = statusOf(g, nowTs);
  if (st.key === 'alert') return 0;
  if (st.key === 'urgent' || st.key === 'today') return 1;
  if (st.key === 'extended') return 2;
  if (st.key === 'soon' || st.key === 'active') return 3;
  if (st.key === 'none') return 4;
  if (st.key === 'published') return 4;        // 契约 2026-11-18 §4：发布卡排 active 之后
  if (st.key === 'extended_past') return 7;
  if (st.key === 'expired') return 8;
  return 5;
}
// 档 4 内排序（契约 2026-11-18 §4）：有发布时间的按发布时间倒序（新的在上），无发布时间排最后
function rank4Compare(a, b, nowTs) {
  const pa = publishedTsOf(a, nowTs), pb = publishedTsOf(b, nowTs);
  if (pa != null && pb != null) return pb - pa;
  if (pa != null) return -1;
  if (pb != null) return 1;
  return 0;
}
// 主列表比较：先档位，档 4 按发布时间倒序；其余档内按主显示时间（报名优先）升序、无时间最后；
// 相等返回 0（调用方按数据源顺序稳定排序）
function mainListCompare(a, b, done, nowTs) {
  const ra = listRankOf(a, done, nowTs), rb = listRankOf(b, done, nowTs);
  if (ra !== rb) return ra - rb;
  if (ra === 4) return rank4Compare(a, b, nowTs);
  const ta = whenOf(a, nowTs), tb = whenOf(b, nowTs);
  if (ta == null && tb == null) return 0;
  if (ta == null) return 1;
  if (tb == null) return -1;
  return ta - tb;
}

// 长期区 info 卡排序锚点：卡片第一条带可解析 time 的 item 的消息时间（任意 kind，与网页 cardAnchorTs 同口径；失败/无 → 0）
function cardAnchorTs(g, nowTs) {
  const items = (g && g.items) || [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it) continue;
    const t = parseMsgTime(it.time, nowTs);
    if (t != null) return t;
  }
  return 0;
}
// 长期区排序（网页 orderLongterm 同口径）：长期安排在前（下次发生时间升序，算不出最后），
// info 在后（锚点消息时间倒序）；仍相同返回 0（调用方按数据源顺序稳定排序）
function longtermCompare(a, b, nowTs) {
  const ra = isRecurGroup(a) ? 0 : 1, rb = isRecurGroup(b) ? 0 : 1;
  if (ra !== rb) return ra - rb;
  if (ra === 0) {
    const na = nextOf(a, nowTs), nb = nextOf(b, nowTs);
    const va = na == null ? Infinity : na, vb = nb == null ? Infinity : nb;
    if (va !== vb) return va - vb;
    return 0;
  }
  const ta = cardAnchorTs(a, nowTs), tb = cardAnchorTs(b, nowTs);
  if (ta !== tb) return tb - ta;
  return 0;
}
// 长期区排序（纯函数版：返回新数组；同序按数据源顺序，保证稳定）
function orderLongterm(list, nowTs) {
  const src = list || [];
  const out = src.slice();
  out.sort(function (a, b) {
    return longtermCompare(a, b, nowTs) || (src.indexOf(a) - src.indexOf(b));
  });
  return out;
}

// ---------------------------------------------------------------- 契约 2026-11-14 §1.3：长期安排「期次」
// 每一期在发生前 24 小时作为普通卡片进入主列表；期次 key = <gid>@occ:<YYYYMMDD>（next 的本地日期）。
// 期次「已处理」写既有 marks(kind='ntdone', ref=期次 key) —— 不新增同步 section。
const OCC_WINDOW_MS = 24 * 3600 * 1000;

function numNow(nowTs) {
  const n = Number(nowTs);
  return (nowTs == null || isNaN(n)) ? Date.now() : n;
}
function pad4(n) { return n < 10 ? '000' + n : (n < 100 ? '00' + n : (n < 1000 ? '0' + n : '' + n)); }
// 期次 key：gid@occ:YYYYMMDD（next 的本地日期）
function occKeyOf(g, nextTs) {
  const gid = String((g && g.id) || '');
  if (!gid || nextTs == null || isNaN(Number(nextTs))) return '';
  const d = new Date(Number(nextTs));
  return gid + '@occ:' + pad4(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate());
}
// ref 是否期次 key；期次 key 的基础 gid（'g1@occ:20261118' → 'g1'）
function isOccRef(ref) { return /@occ:\d{8}$/.test(String(ref == null ? '' : ref)); }
function baseGidOfRef(ref) {
  const s = String(ref == null ? '' : ref);
  const i = s.indexOf('@occ:');
  return i > 0 ? s.slice(0, i) : s;
}
// 当前处于窗口内的期次：{ next, start, key, ymd, label }；窗口不满足 / 已结束 → null
// （是否已处理由调用方用 done[key] 判断：单纯算法保持纯函数）
function occOf(g, nowTs) {
  const rec = recurOf(g);
  if (!rec) return null;
  const now = numNow(nowTs);
  if (isRecurEnded(g, now)) return null;
  const next = nextOf(g, now);
  if (next == null) return null;
  const start = next - OCC_WINDOW_MS;
  if (!(start <= now && now < next)) return null;
  const d = new Date(next);
  const ymd = pad4(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate());
  return {
    next: next,
    start: start,
    key: occKeyOf(g, next),
    ymd: ymd,
    label: '本次 ' + dateTimeCnOf(next, now)
  };
}
// 期次状态胶囊文案：本次 M月D日（周X）HH:MM（now 可注入，按显示时计算相对周）
function occLabelOf(g, nowTs) {
  const occ = occOf(g, nowTs);
  return occ ? occ.label : '';
}
// 长期清单「下次」时间：下次 M月D日（周X）HH:MM（无下次 = ''）
function nextCnTextOf(g, nowTs) {
  const ts = nextOf(g, nowTs);
  if (ts == null) return '';
  return '下次 ' + dateTimeCnOf(ts, nowTs);
}

// ---------------------------------------------------------------- 契约 2026-11-14 §3：时间显示统一
// 数据/云端仍存 MM-DD 标准形式；只在显示层把日期 token 统一为 `M月D日（相对周）`。
function dayStartOf(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function weekStartOf(ts) {                    // 本周一 00:00（ISO 周：周一起算）
  const d = new Date(ts);
  const ds = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = ds.getDay();                    // 0=周日
  const off = dow === 0 ? -6 : 1 - dow;
  return new Date(ds.getFullYear(), ds.getMonth(), ds.getDate() + off).getTime();
}
// 相对标签（契约 §3.4 固定向量口径）：今天/明天 → 同一 ISO 周（周一起算）→ 本周X；
// 下一周 → 下周X；上一周 → 上周X；其他 → 周X（「昨天」按契约规则保留，但同一周内优先 本周X，
// 与向量 `11-13 → 本周五` 一致；跨周时上一周优先 上周X）。
function relLabelOf(ts, nowTs) {
  const t = Number(ts), now = numNow(nowTs);
  if (t == null || isNaN(t)) return '';
  const dayDiff = Math.round((dayStartOf(t) - dayStartOf(now)) / 86400000);
  if (dayDiff === 0) return '今天';
  if (dayDiff === 1) return '明天';
  const wDiff = Math.round((weekStartOf(t) - weekStartOf(now)) / (7 * 86400000));
  const w = WEEK_CN[new Date(t).getDay()];
  if (wDiff === 0) return '本' + w;
  if (wDiff === 1) return '下' + w;
  if (wDiff === -1) return '上' + w;
  if (dayDiff === -1) return '昨天';
  return w;
}
// 时间戳 → `M月D日（相对）`；年份非当年 → 前缀 YYYY年
function dateCnOf(ts, nowTs) {
  const t = Number(ts), now = numNow(nowTs);
  if (isNaN(t)) return '';
  const d = new Date(t), n = new Date(now);
  const yPrefix = d.getFullYear() !== n.getFullYear() ? (d.getFullYear() + '年') : '';
  return yPrefix + (d.getMonth() + 1) + '月' + d.getDate() + '日（' + relLabelOf(t, now) + '）';
}
// 时间戳 → `M月D日（相对）HH:MM`（契约 §1.3 期次胶囊 / §2.2 长期清单「下次」：括号后直接接 HH:MM）
function dateTimeCnOf(ts, nowTs) {
  const t = Number(ts);
  if (isNaN(t)) return '';
  const d = new Date(t);
  return dateCnOf(t, nowTs) + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
// 无年份 MM-DD 的年份推断：取离 now 最近的一次（跨年不错一年）
function yearOfMd(mo, da, nowTs) {
  const now = numNow(nowTs);
  const y = new Date(now).getFullYear();
  let best = y, bestDiff = Infinity;
  for (let i = 0; i < 3; i++) {
    const yy = y - 1 + i;
    const t = new Date(yy, mo - 1, da).getTime();
    if (isNaN(t)) continue;
    const diff = Math.abs(t + 12 * 3600 * 1000 - now);
    if (diff < bestDiff) { bestDiff = diff; best = yy; }
  }
  return best;
}
// 已是 `M月D日（…）` 形态 → 不重复加括号
const PRE_BRACKET = '(?![\\s]*[（(])';
// 不当时段的短横线（1-2 人 / 3-5 个）：后面紧跟量词视为区间而非日期
// 注：不包含「室/场/层」——「11-15室内集合」这类日期后接中文更常见；区间语义主要靠 人/个/次/名/天 等量词。
const NOT_DATE_UNIT = '人个次名位天周月年小时分钟元度分条项张份间号栋楼届组队户';
// 日期 token（按最长优先处理）：YYYY年M月D日 / YYYY-MM-DD / M月D日 / MM-DD
// MM-DD 前缀排除：数字、ASCII ':'（避开 14:05-15:00 这类时间区间）、'-'；
// 中文全角「：」是标签分隔（如「补充：11-05」），不排除。
const RE_DATE_CN_FULL = /(\d{4})年(\d{1,2})月(\d{1,2})日/g;
const RE_DATE_ISO = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/g;
const RE_DATE_MD_CN = new RegExp('(\\d{1,2})月(\\d{1,2})日' + PRE_BRACKET, 'g');
const RE_DATE_MMDD = new RegExp('(^|[^0-9:\\-])(\\d{1,2})-(\\d{1,2})(?![0-9\\-])' + PRE_BRACKET, 'g');
function validMd(mo, da) {
  if (!(mo >= 1 && mo <= 12) || !(da >= 1 && da <= 31)) return false;
  const d = new Date(2000, mo - 1, da);
  return d.getMonth() === mo - 1 && d.getDate() === da;
}
// 文本里的日期 token → `M月D日（相对周）`（now 可注入；纯函数；已带括号不重复）
function fmtDatesCn(text, nowTs) {
  let src = String(text == null ? '' : text);
  if (!src) return src;
  const now = numNow(nowTs);
  const rep = function (y, mo, da) {
    return dateCnOf(new Date(y, mo - 1, da).getTime(), now);
  };
  src = src.replace(RE_DATE_CN_FULL, function (m, y, mo, da) {
    if (!validMd(+mo, +da)) return m;
    return rep(+y, +mo, +da);
  });
  src = src.replace(RE_DATE_ISO, function (m, y, mo, da) {
    if (!validMd(+mo, +da)) return m;
    return rep(+y, +mo, +da);
  });
  src = src.replace(RE_DATE_MD_CN, function (m, mo, da) {
    if (!validMd(+mo, +da)) return m;
    return rep(yearOfMd(+mo, +da, now), +mo, +da);
  });
  src = src.replace(RE_DATE_MMDD, function (m, pre, mo, da, offset) {
    const nxt = src.charAt(offset + m.length);
    if (nxt && NOT_DATE_UNIT.indexOf(nxt) >= 0) return m;  // 1-2 人 / 3-5 个 → 不是日期
    if (!validMd(+mo, +da)) return m;
    return pre + rep(yearOfMd(+mo, +da, now), +mo, +da);
  });
  return src;
}
// 显示层统一入口：先沿用 absRelDates 把相对词换成 MM-DD，再统一格式化为 M月D日（相对周）
function fmtDisplayDates(text, anchor, nowTs) {
  return fmtDatesCn(absRelDates(text, anchor, nowTs), nowTs);
}

// ---------------------------------------------------------------- 契约 2026-11-14 §2.4：最新发布
// 发布时间 = 通知组内最新一条消息时间（items[].time），有 updatedAt（补充/更正）时取较晚者。
// 契约 2026-11-18 起：优先读数据字段 publishedAt（见 publishedTsOf），本函数仅作旧缓存/旧数据的兜底推算。
function pubTsOf(g, nowTs) {
  if (!g) return null;
  let best = null;
  const upd = parseMsgTime(g.updatedAt, nowTs);
  if (upd != null) best = upd;
  const items = Array.isArray(g.items) ? g.items : [];
  for (let i = 0; i < items.length; i++) {
    const t = parseMsgTime(items[i] && items[i].time, nowTs);
    if (t != null && (best == null || t > best)) best = t;
  }
  return best;
}
// 契约 2026-11-18 §1/§6：发布时间。优先数据字段 publishedAt（ISO +08:00，管线对所有组写入）；
// 旧缓存/旧数据缺字段 → 回退 pubTsOf（组内最新 items[].time 与 updatedAt 的较晚者）。
function publishedTsOf(g, nowTs) {
  if (!g) return null;
  const t = parseTs(g.publishedAt);
  if (t != null && t > 0) return t;
  return pubTsOf(g, nowTs);
}
function hmOf(ts) { const d = new Date(ts); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
// 最新发布相对文案：今天/昨天 HH:MM；更早 → `M月D日（相对周） HH:MM`
function latestTextOf(ts, nowTs) {
  if (ts == null || isNaN(Number(ts))) return '—';
  const t = Number(ts), now = numNow(nowTs);
  const dayDiff = Math.round((dayStartOf(t) - dayStartOf(now)) / 86400000);
  if (dayDiff === 0) return '今天 ' + hmOf(t);
  if (dayDiff === 1) return '昨天 ' + hmOf(t);
  return dateCnOf(t, now) + ' ' + hmOf(t);
}
// 全部未隐藏通知里发布时间最新者；{ ts, text }
function latestOf(all, nowTs) {
  let best = null;
  (all || []).forEach(function (g) {
    if (!g || g._hidden) return;
    const t = publishedTsOf(g, nowTs);
    if (t != null && (best == null || t > best)) best = t;
  });
  return { ts: best, text: latestTextOf(best, nowTs) };
}

// ---------------------------------------------------------------- 契约 2026-11-14 §1.3/§2.2：主列表排序（期次按 next 参与）
// 期次卡按 next 时间参与主列表排序（相当于「今天/24h 内」档），不把整条长期安排作为普通卡重复展示。
function entryRankOf(g, done, occ, nowTs) {
  if (occ) return doneOf(done, occ.key) ? 9 : 1;
  return listRankOf(g, done, nowTs);
}
function entryWhenOf(g, nowTs, occ) {
  return occ ? occ.next : whenOf(g, nowTs);
}
// a/b = { g, occ }（occ 可空）；档位 → 档 4 发布时间倒序 / 其余主显示时间升序 → 稳定（调用方按数据源顺序兜底）
function mainEntryCompare(a, b, done, nowTs) {
  const ra = entryRankOf(a && a.g, done, a && a.occ, nowTs);
  const rb = entryRankOf(b && b.g, done, b && b.occ, nowTs);
  if (ra !== rb) return ra - rb;
  if (ra === 4) return rank4Compare(a && a.g, b && b.g, nowTs);
  const ta = entryWhenOf(a && a.g, nowTs, a && a.occ);
  const tb = entryWhenOf(b && b.g, nowTs, b && b.occ);
  if (ta == null && tb == null) return 0;
  if (ta == null) return 1;
  if (tb == null) return -1;
  return ta - tb;
}

// 「已处理」映射（marks kind='ntdone' 的本机镜像）：传给 statOf / mostUrgent 时排除已处理的通知
function doneOf(done, id) { return !!(done && id && done[id]); }

// 简报统计（契约 2026-11-14 §2.4 + 2026-11-18 §5；done 可选，已处理不计入待处理；now 可注入便于单测）：
//   待处理 = 未过期、非长期定义、非资料兜底、未已处理、actionable!==false、且有时间锚点
//            （发布卡视为有时间锚点；期次计入）
//   24h/7 天内 = 上述待处理中主显示时间剩余 ≤24h / ≤7 天（发布卡主显示时间为空 → 不进未来窗口；期次窗口必然 ≤24h）
//   长期通知 = 进行中的 recurrence 条数（until 已过/下一次越过 until → 不计）
//   最新发布 = 全部未隐藏通知（含过期/资料/长期定义）中 publishedAt（缺字段回退 pubTsOf）最新者
function statOf(all, done, nowTs) {
  const now = numNow(nowTs);
  const day = 86400000;
  let pending = 0, urgent = 0, week = 0, expired = 0, longterm = 0;
  (all || []).forEach(function (g) {
    if (!g) return;
    if (g._hidden) return;                      // 需求 12：管理员软删除的通知不参与任何统计
    const st = statusOf(g, now);
    if (st.expired) { expired += 1; return; }
    const rec = recurOf(g);
    if (rec) {
      longterm += 1;                            // 进行中的长期安排（until 已过时上面已判过期）
      const occ = occOf(g, now);
      if (!occ) return;                         // 不在期次窗口：只算长期条数，不计待处理
      if (!isActionable(g)) return;
      if (doneOf(done, occ.key)) return;
      pending += 1;
      urgent += 1;                              // 窗口 = next 前 24h → 必然 ≤24h
      week += 1;
      return;
    }
    if (isLongterm(g)) return;                  // 资料兜底卡（无锚点且无发布时间，正常 0 条）：不参与待处理统计
    if (!isActionable(g)) return;
    if (doneOf(done, g && g.id)) return;
    // 契约 2026-11-18 §5：发布卡视为有时间锚点；既无锚点又无发布时间才不计（双保险）
    if (!hasTimeAnchor(g) && publishedTsOf(g, now) == null) return;
    pending += 1;
    // 「24h 内截止 / 7 天内截止」按卡片主显示时间（报名优先）统计，与 chip 同口径；
    // 发布卡 whenOf 为 null（发布已过去）→ 不进入未来窗口统计
    const whenTs = whenOf(g, now);
    if (whenTs != null && whenTs >= now) {
      const left = whenTs - now;
      if (left <= day) urgent += 1;
      if (left <= 7 * day) week += 1;
    }
  });
  const latest = latestOf(all, now);
  return { pending: pending, urgent: urgent, week: week, expired: expired, longterm: longterm, latest: latest.ts, latestText: latest.text };
}

// 待处理里最紧的一条：alert 优先，其次真实截止升序，无实时排后（done 可选，已处理不参与）
function mostUrgent(all, done, nowTs) {
  const list = (all || []).filter(function (g) {
    if (isLongterm(g, nowTs)) return false;        // 2026-11-12：长期通知不参与「最紧急一条」
    const st = statusOf(g, nowTs);
    return !st.expired && isActionable(g) && !doneOf(done, g && g.id);
  });
  list.sort(function (a, b) {
    const aa = a.alert ? 1 : 0, ba = b.alert ? 1 : 0;
    if (aa !== ba) return ba - aa;
    // 按主显示时间（报名优先）升序，与卡片 chip 同口径
    const ta = whenOf(a, nowTs), tb = whenOf(b, nowTs);
    if (ta == null && tb == null) return 0;
    if (ta == null) return 1;
    if (tb == null) return -1;
    return ta - tb;
  });
  return list[0] || null;
}

// ---------------------------------------------------------------- 契约 §3 + §0.1（第三轮）：相对日期替换（显示层）
// 作用对象：title / aiSummary / aiPoints[] / aiSegments[].text / item.text（含补充通知 follow）/
//          合并转发 messages[].text / 「原始消息」弹层；锚点 = 同一卡片第一条 item 的 time（发送时刻）。
// 规则：今天/明日/今早…→ MM-DD（保留 早/晚）；本周X/下周X/裸周X；裸日号 N号/N日（有语境才替换）；
//      裸时段（上午/中午/下午/晚上/凌晨）→ 前缀锚点日期；「今日校园」等专有名词不替换；
//      绝对日期 + 括号内同日相对星期去重；解析失败/无锚点 → 原样返回，不报错。
const WD_CN = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
// 裸「周X」前若是这些字，说明不是「最近一个未来」语义（上周五 / 每周三 / 隔周五 / 下下周一…）→ 原样保留
const REL_BARE_SKIP = '上前后每个隔第几数下';
const REL_DAY_RE = new RegExp('(大后天|后天|今早|明早|明晚|今晚|明天|明日|今天|今日|' +
  '(?:本|这)周([日一二三四五六天])|下(?:个)?周([日一二三四五六天])|' +
  '下(?:个)?星期([日一二三四五六天])|下(?:个)?礼拜([日一二三四五六天])|' +
  '星期([日一二三四五六天])|礼拜([日一二三四五六天])|周([日一二三四五六天]))', 'g');
// 非分组的「相对日期词」总表（供括号去重使用）
const REL_ANY = '(?:大后天|后天|今早|明早|明晚|今晚|明天|明日|今天|今日|(?:本|这)周[日一二三四五六天]|' +
  '下(?:个)?(?:周|星期|礼拜)[日一二三四五六天]|星期[日一二三四五六天]|礼拜[日一二三四五六天]|周[日一二三四五六天])';
// 契约 §0.1：绝对日期 + 括号内相对星期/相对词 → 去重只留绝对日期（绝对日期为准，避免 11-03（10-30）矛盾括号）
const PAREN_REL_ANY = '(?:今天|今日|明天|明日|后天|大后天|今早|明早|明晚|今晚|昨天|昨日|前天|' +
  '(?:本|这|上|下|下下)?(?:个)?(?:周|星期|礼拜)[日一二三四五六天])';
const ABS_PAREN_RE = new RegExp('((?:\\d{1,2}月\\d{1,2}日)|(?:\\d{1,2}-\\d{1,2}))\\s*[（(]\\s*' + PAREN_REL_ANY + '\\s*[)）]', 'g');
// 契约 §0.1：相对词 + 括号内相对词（指向同一天）→ 合并（本周四（明天）→ 本周四）
const REL_PAREN_RE = new RegExp('(' + REL_ANY + ')\\s*[（(]\\s*(' + REL_ANY + ')\\s*[)）]', 'g');
// 契约 §0.1：裸日号 N号/N日 → MM-DD（仅上午/下午/…语境；「42号同学」「5号楼」不替换）
const BARE_DAY_RE = /(\d{1,2})([号日])\s*(上午|下午|中午|晚上|早上|凌晨|比赛|活动|当天|点名|集合|开会|会议|考试|上课|签到|报到)/g;
// 契约 §0.1：裸时段 → 前缀锚点日期（11-05 下午）
const PERIOD_RE = /(上午|中午|下午|晚上|凌晨)/g;
const PERIOD_KEEP_RE = /每天|每周|每月|每日|长期/;
// 后置去重：MM-DD（MM-DD / M月D日）→ MM-DD（绝对日期为准）
const DUP_PAREN_RE = /(\d{1,2}-\d{1,2})\s*[（(]\s*(?:\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}日)\s*[)）]/g;
// 裸日号前若是这些字则不是日期（学号42号 / 5号楼 / 11月6日…）
const BARE_DAY_PREV_SKIP = '0123456789０１２３４５６７８９月第学号门栋楼室床路线';

// 解析消息发送时间锚点：支持 "MM-DD HH:MM"(/带秒) / "YYYY-MM-DD HH:MM" / ISO / 时间戳 / Date
// 无年份时按「离 now 最近的一次」推断年份（跨年消息不会错一年）
function parseMsgTime(v, nowTs) {
  if (v == null || v === '') return null;
  if (v instanceof Date) { const x = v.getTime(); return isNaN(x) ? null : x; }
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  const now = (nowTs == null || isNaN(nowTs)) ? Date.now() : Number(nowTs);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {        // 带 T / 时区的 ISO：交给 Date.parse 保留时区
    const iso = Date.parse(s);
    if (!isNaN(iso)) return iso;
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), 0).getTime();
  m = s.match(/^(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const y = new Date(now).getFullYear();
    const build = function (yy) {
      return new Date(yy, +m[1] - 1, +m[2], +m[3], +m[4], +(m[5] || 0), 0).getTime();
    };
    let t = build(y);
    const half = 183 * 86400000;
    if (t - now > half) t = build(y - 1);
    else if (now - t > half) t = build(y + 1);
    return isNaN(t) ? null : t;
  }
  const t2 = Date.parse(s);
  return isNaN(t2) ? null : t2;
}

// 整卡锚点：第一条带 time 的 item（契约：同一卡片锚点一致）
function anchorOf(g, nowTs) {
  const items = (g && g.items) || [];
  for (let i = 0; i < items.length; i++) {
    const t = parseMsgTime(items[i] && items[i].time, nowTs);
    if (t != null) return t;
  }
  return null;
}

// 把文本里的相对/模糊时间词替换成带日期的写法（anchor 可为时间戳 / "MM-DD HH:MM" / Date；解析失败原样返回）
function absRelDates(text, anchor, nowTs) {
  let src = String(text == null ? '' : text);
  if (!src) return src;
  const at = parseMsgTime(anchor, nowTs);
  if (at == null) return src;
  const d = new Date(at);
  const y = d.getFullYear(), mo = d.getMonth(), da = d.getDate();
  const dow = d.getDay();
  const padMd = function (x) { return pad(x.getMonth() + 1) + '-' + pad(x.getDate()); };
  const mdOf = function (offset) {                    // 锚点日 + offset 天
    return padMd(new Date(y, mo, da + offset));
  };
  // 中文习惯以周一为一周起点：本周一相对锚点日的偏移
  const monOff = dow === 0 ? -6 : 1 - dow;
  const weekMd = function (weekOffset, target) {      // 第 weekOffset 周（0=本周 1=下周）的星期 target
    return padMd(new Date(y, mo, da + monOff + weekOffset * 7 + (target + 6) % 7));
  };
  const nextMd = function (target) {                  // 最近一个未来该星期几（今天同星期 = 今天）
    return mdOf((target - dow + 7) % 7);
  };
  // 相对日期词 → MM-DD（供括号去重比较；与主替换同规则）
  const resolveRel = function (w) {
    if (w === '今天' || w === '今日') return mdOf(0);
    if (w === '明天' || w === '明日') return mdOf(1);
    if (w === '后天') return mdOf(2);
    if (w === '大后天') return mdOf(3);
    if (w === '今早' || w === '今晚') return mdOf(0);
    if (w === '明早' || w === '明晚') return mdOf(1);
    const target = WD_CN[w.charAt(w.length - 1)];
    if (target == null) return null;
    if (/^(?:本|这)周/.test(w)) return weekMd(0, target);
    if (/^下/.test(w)) return weekMd(1, target);
    return nextMd(target);
  };
  const todayMd = mdOf(0);

  // 1) 绝对日期 + 括号内相对星期（同日/矛盾括号）→ 去重，绝对日期为准
  src = src.replace(ABS_PAREN_RE, '$1');
  // 2) 相对词 + 括号内相对词（同一天）→ 合并（本周四（明天）→ 本周四）
  src = src.replace(REL_PAREN_RE, function (m, a, b) {
    const ma = resolveRel(a), mb = resolveRel(b);
    return (ma && mb && ma === mb) ? a : m;
  });
  // 3) 相对日期词 → MM-DD（保留 早/晚 后缀；「今日校园」专有名词不替换）
  src = src.replace(REL_DAY_RE, function (m, g1, g2, g3, g4, g5, g6, g7, g8, offset) {
    if (m === '今日' && src.substr(offset + m.length, 2) === '校园') return m;
    let out;
    let suffix = false;              // 今早/明早/今/明晚自带「早/晚」后缀
    if (m === '大后天') out = mdOf(3);
    else if (m === '后天') out = mdOf(2);
    else if (m === '今早') { out = mdOf(0) + ' 早'; suffix = true; }
    else if (m === '明早') { out = mdOf(1) + ' 早'; suffix = true; }
    else if (m === '明晚') { out = mdOf(1) + ' 晚'; suffix = true; }
    else if (m === '今晚') { out = mdOf(0) + ' 晚'; suffix = true; }
    else if (m === '明天' || m === '明日') out = mdOf(1);
    else if (m === '今天' || m === '今日') out = mdOf(0);
    else {
      const target = WD_CN[m.charAt(m.length - 1)];
      if (target == null) return m;
      const prev = offset > 0 ? src.charAt(offset - 1) : '';
      if (prev === '下' && /^下/.test(m)) return m;   // 「下下周一 / 下下个周一」不在规则内 → 原样
      if (/^(?:本|这)周/.test(m)) out = weekMd(0, target);
      else if (/^下/.test(m)) out = weekMd(1, target);
      else {
        if (prev && REL_BARE_SKIP.indexOf(prev) >= 0) return m;
        out = nextMd(target);
      }
    }
    // 替换后紧跟中文/数字时补一个空格：「明天12:00」→「11-06 12:00」、「明天中午前」→「11-06 中午前」；
    // 但「明晚点名」这类自带后缀的保持「11-06 晚点名」（只在跟数字时补空格）
    const nxt = src.charAt(offset + m.length);
    if (nxt && !/\s/.test(nxt) && '，,。；;、：:！!？?）)」』】]'.indexOf(nxt) < 0) {
      if (!(suffix && !/[0-9０-９]/.test(nxt))) out += ' ';
    }
    return out;
  });
  // 4) 裸日号 N号/N日（仅上午/下午/晚上/比赛/活动/当天/点名…语境）→ MM-DD
  src = src.replace(BARE_DAY_RE, function (m, num, unit, ctx, offset) {
    const prev = offset > 0 ? src.charAt(offset - 1) : '';
    if (prev && BARE_DAY_PREV_SKIP.indexOf(prev) >= 0) return m;   // 11月6日 / 学号42号 / 5号楼…
    const day = +num;
    const dt = new Date(y, mo, day);
    if (day < 1 || day > 31 || dt.getMonth() !== mo || dt.getDate() !== day) return m;
    return padMd(dt) + ' ' + ctx;
  });
  // 5) 裸时段（上午/中午/下午/晚上/凌晨）→ 前缀锚点日期（同一分句前 12 字内有日期 / 句中带周期词 → 保留）
  const CLAUSE_SEPS = ['。', '！', '？', '；', '\n', ';', '，', ','];
  const clauseStartOf = function (s, idx) {
    let start = 0;
    CLAUSE_SEPS.forEach(function (c) {
      const i = s.lastIndexOf(c, idx);
      if (i >= 0 && i + 1 > start) start = i + 1;
    });
    return start;
  };
  src = src.replace(PERIOD_RE, function (m, p, offset) {
    const startIdx = clauseStartOf(src, offset);
    const before = src.slice(Math.max(startIdx, offset - 12), offset);
    if (/\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}/.test(before)) return m;
    // 整句内出现周期词（每天/每周/每月/每日/长期）→ 保留，不硬加日期
    let endIdx = src.length;
    CLAUSE_SEPS.forEach(function (c) {
      const j = src.indexOf(c, offset);
      if (j >= 0 && j < endIdx) endIdx = j;
    });
    const sentStart = (function () {
      let s = 0;
      ['。', '！', '？', '；', '\n', ';'].forEach(function (c) {
        const i = src.lastIndexOf(c, offset);
        if (i >= 0 && i + 1 > s) s = i + 1;
      });
      return s;
    })();
    if (PERIOD_KEEP_RE.test(src.slice(sentStart, endIdx))) return m;
    return todayMd + ' ' + m;
  });
  // 6) 后置去重：MM-DD（MM-DD / M月D日）→ MM-DD；后面紧跟中文时补空格（11-05（11-06）上午 → 11-05 上午）
  src = src.replace(DUP_PAREN_RE, function (m, md, offset) {
    const rest = src.charAt(offset + m.length);
    if (!rest || /\s/.test(rest) || '，,。；;、：:！!？?）)」』】]'.indexOf(rest) >= 0) return md;
    return md + ' ';
  });
  return src;
}

// 通知附件压缩包：把 item.archive（数据管线识别结果）归一为轻量展示信息。
// 只返回元数据（hasUrl 布尔，不含 data URI 本体，避免把 87KB+ body 灌进 setData）；
//   files 最多 6 个（与界面行数一致）；summary 截断 120 字并压成一行小字。
function archiveInfo(item) {
  const a = (item && item.archive) || null;
  const src = a && Array.isArray(a.files) ? a.files : [];
  const ok = !!(item && (item.archiveOk === true || (a && a.status === 'ok'))) && src.length > 0;
  const files = ok ? src.slice(0, 6).map(function (f) {
    f = f || {};
    return {
      name: String(f.name || f.path || '文件'),
      kind: String(f.kind || ''),
      size: String(f.size || ''),
      textLen: Number(f.textLen) || 0,
      // 2026-11-17：列表接口把 data URI 替换为空串 + lazy=true；仍视为「可预览」，
      // 点开时由 pages/nt 按 id 拉完整 body（不缩减功能）。
      hasUrl: !!(f.url || f.src || f.lazy),
      lazy: !!f.lazy
    };
  }) : [];
  return {
    ok: ok,
    count: Number(a && a.count) || src.length,
    summary: a && a.summary ? String(a.summary).replace(/\s+/g, ' ').slice(0, 120) : '',
    files: files
  };
}

module.exports = {
  deadlineOf: deadlineOf, archiveAtOf: archiveAtOf, eventAtOf: eventAtOf, timeLabelOf: timeLabelOf,
  statusOf: statusOf, isExpired: isExpired, isActionable: isActionable,
  deadlineInfo: deadlineInfo, statOf: statOf, mostUrgent: mostUrgent, fmt: fmt,
  // 契约 2026-11-05 §2 + 2026-11-06 §0.2：时间显示「<时间> <动作>」+ 报名优先 + 动作精简
  fmtWhen: fmtWhen, signupOf: signupOf, whenInfo: whenInfo, whenOf: whenOf,
  conciseAction: conciseAction, ACTION_MAP: ACTION_MAP,
  // 契约 2026-11-05 §3 + 2026-11-06 §0.1：相对日期替换（显示层）
  parseMsgTime: parseMsgTime, anchorOf: anchorOf, absRelDates: absRelDates,
  // 需求 9：长期安排（recurrence）
  recurOf: recurOf, nextOf: nextOf, nextTextOf: nextTextOf, recurLabelOf: recurLabelOf,
  // 2026-11-12：长期通知（长期安排 + 无时间/长期有效）判定 + 主列表 / 长期区排序
  isRecurGroup: isRecurGroup, hasTimeAnchor: hasTimeAnchor, longtermSubtypeOf: longtermSubtypeOf,
  isLongterm: isLongterm, listRankOf: listRankOf, mainListCompare: mainListCompare,
  cardAnchorTs: cardAnchorTs, longtermCompare: longtermCompare, orderLongterm: orderLongterm,
  // 契约 2026-11-14 §1.3：长期安排期次（until 结束判定 / 24h 窗口 / 期次 key / 期次胶囊）
  untilOf: untilOf, isRecurEnded: isRecurEnded, nextRawOf: nextRawOf,
  OCC_WINDOW_MS: OCC_WINDOW_MS, occKeyOf: occKeyOf, occOf: occOf, occLabelOf: occLabelOf,
  isOccRef: isOccRef, baseGidOfRef: baseGidOfRef, nextCnTextOf: nextCnTextOf,
  // 契约 2026-11-14 §3：时间显示统一（M月D日（相对周）；now 可注入；纯函数）
  relLabelOf: relLabelOf, dateCnOf: dateCnOf, dateTimeCnOf: dateTimeCnOf,
  fmtDatesCn: fmtDatesCn, fmtDisplayDates: fmtDisplayDates,
  // 契约 2026-11-14 §2.4：最新发布（发布时间戳 / 相对文案）+ 主列表「期次」排序
  pubTsOf: pubTsOf, publishedTsOf: publishedTsOf, latestTextOf: latestTextOf, latestOf: latestOf,
  entryRankOf: entryRankOf, entryWhenOf: entryWhenOf, mainEntryCompare: mainEntryCompare,
  // 需求 12：管理员编辑 override
  applyOverride: applyOverride, OVERRIDE_KEYS: OVERRIDE_KEYS,
  archiveInfo: archiveInfo,
  WEEK_CN: WEEK_CN
};
