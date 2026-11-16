// utils/vote.js —— 投票功能纯逻辑（2026-11-11，契约 web/vote/CONTRACT.md §1/§2/§4）
//
// 定位：只放**无平台 API、无网络、无存储**的纯函数，供两个页面复用并由 Node 单测覆盖：
//   * 数据归一：选项 / 规则（§1.3 / §1.4）/ 可见人范围（§1.6）/ 时间与截止语义（§1.5）；
//   * 展示口径：倒计时文案、截止文案、时间格式化、规则标签、可见范围标签、卡片/详情视图模型；
//   * 交互判定：单选/多选勾选与上限、提交校验、结果可见性（含匿名投票人不显示）；
//   * 表单：校验并发起参数（poll_create / poll_manage edit 的 payload）、编辑回填。
//
// 约束：
//   * 不 require 任何其他模块（Node 单测直接 require 本文件即可）；
//   * 不出现 wx.* / 网络 / 定时器；页面只调用这里的纯函数；
//   * 隐私：任何返回值都不含学号（服务端 RPC 本来也不返回 sid）；匿名投票不产生投票人列表；
//     可见范围「指定成员」只使用座号（1–70），不出现/不返回学号。

// ---------------------------------------------------------------- 常量（与契约 §1 对齐）
const LIMITS = {
  title: 80,          // 标题 1–80 字
  desc: 500,          // 说明 0–500 字
  optMin: 2,          // 选项 2–20 项
  optMax: 20,
  optText: 80,        // 选项文字 1–80 字
  optDesc: 200,       // 选项补充说明 0–200 字
  imgChars: 150000,   // 单张配图 data URL ≤150000 字符
  imgTotalChars: 1600000, // 全部选项配图合计 ≤1,600,000 字符（契约 §1.3 与网页端/服务端同口径）
  quickMax: 120       // 快捷时限上限（5/10/30/60/120 分钟）
};
const QUICK_MINS = [5, 10, 30, 60, 120];
const VIS = ['always', 'afterVote', 'afterClose'];
const VIS_TEXT = { always: '始终可见', afterVote: '投票后可见', afterClose: '截止后可见' };
// 可见人范围（契约 §1.6，2026-11-11 18:08 增量）：全班 / 班委 / 团员 / 指定成员（座号数组）
const AUD = ['all', 'committee', 'league', 'custom'];
const AUD_TEXT = { all: '全班', committee: '班委', league: '团员', custom: '指定成员' };
const AUD_TAG = { committee: '班委可见', league: '团员可见' };   // all 不显示标签
const SEAT_MIN = 1;
const SEAT_MAX = 70;            // 契约 §1.1/§1.6：座号 1–70（真实班级名单）
const ID_RE = /^p[a-z0-9]{4,32}$/;             // 投票 id：p + cbId()（总长 5–33）
const OPT_ID_RE = /^[A-Za-z0-9_-]{1,24}$/;      // 选项 id
const LONG_POLL_MS = 6 * 3600 * 1000;           // 轮询口径：截止 <6h 按「限时」5s 轮询
const POLL_MS_FAST = 5000;
const POLL_MS_SLOW = 10000;

// ---------------------------------------------------------------- 基础工具
function pad2(n) {
  const s = String(n);
  return s.length >= 2 ? s : '0' + s;
}
function textOf(v) { return String(v == null ? '' : v).trim(); }
function clip(s, n) { const t = String(s == null ? '' : s); return t.length > n ? t.slice(0, n) : t; }
function num(v, dft) {
  const n = Number(v);
  return isFinite(n) ? n : (dft === undefined ? 0 : dft);
}
function err(reason) { return { ok: false, reason: String(reason == null ? '' : reason) }; }
function ok(extra) { return Object.assign({ ok: true, reason: '' }, extra || {}); }

// 投票 id：p + Date.now().toString(36) + 随机（[a-z0-9]，总长 5–33；与网页 cbId() 同规则）
function pollId() {
  const id = ('p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toLowerCase();
  return ID_RE.test(id) ? id : 'p' + Math.random().toString(36).slice(2, 10);
}
// 选项 id：[A-Za-z0-9_-]{1,24}（同一投票内唯一；页面生成后随选项一起提交）
function optionId() {
  const id = 'o' + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 5);
  return OPT_ID_RE.test(id) ? id : 'o' + Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------- 选项（§1.3）
function newOption(text) {
  return { id: optionId(), text: textOf(text), desc: '', img: '' };
}
function validImg(img) {
  return typeof img === 'string' && img.indexOf('data:image/') === 0 && img.length <= LIMITS.imgChars;
}
function isImgDataUrl(img) { return typeof img === 'string' && img.indexOf('data:image/') === 0; }
function imgTotalChars(options) {
  return (Array.isArray(options) ? options : []).reduce(function (n, o) {
    const s = (o && typeof o.img === 'string') ? o.img.length : 0;
    return n + s;
  }, 0);
}
// 归一一个选项：保留合法 id（服务端编辑回填），否则生成新 id；文字/说明裁到上限；图片不合法则丢弃
function normOption(raw) {
  const o = (raw && typeof raw === 'object') ? raw : {};
  const id = (typeof o.id === 'string' && OPT_ID_RE.test(o.id)) ? o.id : optionId();
  const img = validImg(o.img) ? String(o.img) : '';
  return { id: id, text: clip(textOf(o.text), LIMITS.optText), desc: clip(textOf(o.desc), LIMITS.optDesc), img: img };
}
function normOptions(list) {
  return (Array.isArray(list) ? list : []).slice(0, LIMITS.optMax).map(normOption);
}
// 追加选项（最多 20）
function addOption(options) {
  const list = (Array.isArray(options) ? options : []).slice();
  if (list.length >= LIMITS.optMax) return err('最多 ' + LIMITS.optMax + ' 个选项');
  list.push(newOption(''));
  return ok({ options: list });
}
// 删除选项（至少保留 2 个）
function removeOption(options, index) {
  const list = (Array.isArray(options) ? options : []).slice();
  const i = parseInt(index, 10);
  if (!isFinite(i) || i < 0 || i >= list.length) return err('选项不存在');
  if (list.length <= LIMITS.optMin) return err('至少保留 ' + LIMITS.optMin + ' 个选项');
  list.splice(i, 1);
  return ok({ options: list });
}
// 上移/下移（dir=-1 上移 / +1 下移；到边界原样返回）
function moveOption(options, index, dir) {
  const list = (Array.isArray(options) ? options : []).slice();
  const i = parseInt(index, 10);
  const d = dir < 0 ? -1 : 1;
  const j = i + d;
  if (!isFinite(i) || i < 0 || i >= list.length || j < 0 || j >= list.length) return ok({ options: list, moved: false });
  const tmp = list[i];
  list[i] = list[j];
  list[j] = tmp;
  return ok({ options: list, moved: true });
}

// 选项校验（与云端 CHECK 对齐；返回第一个错误的中文原因）
function validateOptions(options) {
  const list = (Array.isArray(options) ? options : []);
  if (list.length < LIMITS.optMin) return err('至少 ' + LIMITS.optMin + ' 个选项');
  if (list.length > LIMITS.optMax) return err('最多 ' + LIMITS.optMax + ' 个选项');
  let imgChars = 0;
  for (let i = 0; i < list.length; i++) {
    const o = list[i] || {};
    const text = textOf(o.text);
    if (!text) return err('第 ' + (i + 1) + ' 个选项还没有文字');
    if (text.length > LIMITS.optText) return err('选项文字最多 ' + LIMITS.optText + ' 字');
    if (textOf(o.desc).length > LIMITS.optDesc) return err('选项说明最多 ' + LIMITS.optDesc + ' 字');
    if (o.img) {
      if (!isImgDataUrl(o.img)) return err('第 ' + (i + 1) + ' 个选项图片格式不正确');
      if (!validImg(o.img)) return err('第 ' + (i + 1) + ' 个选项图片过大（压缩后仍超过限制）');
      imgChars += String(o.img).length;
    }
  }
  if (imgChars > LIMITS.imgTotalChars) return err('选项配图总大小超过限制，请减少或换小图');
  return ok();
}

// ---------------------------------------------------------------- 规则（§1.4）
// 归一：单选强制 maxChoices=1；多选 2–20 且不超过选项数；匿名/改票默认开；可见性缺省 afterVote。
function normSettings(raw, optCount) {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const multi = !!r.multi;
  let maxChoices = 1;
  if (multi) {
    let m = parseInt(r.maxChoices, 10);
    if (!isFinite(m) || m < 1) m = 2;
    const total = Math.max(0, parseInt(optCount, 10) || 0);
    const cap = total > 0 ? Math.min(LIMITS.optMax, total) : LIMITS.optMax;
    maxChoices = Math.max(2, Math.min(cap, m));
  }
  const vis = VIS.indexOf(r.resultVisibility) >= 0 ? r.resultVisibility : 'afterVote';
  return {
    multi: multi,
    maxChoices: maxChoices,
    anonymous: r.anonymous !== false,
    allowChange: r.allowChange !== false,
    resultVisibility: vis
  };
}
// 规则标签（卡片用前 3 个：单选/多选、匿名/实名、结果可见口径；详情可全部展示）
function tagsOf(settings) {
  const s = normSettings(settings);
  return [
    { key: 'multi', text: s.multi ? ('多选 ' + s.maxChoices + ' 项') : '单选' },
    { key: 'anon', text: s.anonymous ? '匿名' : '实名' },
    { key: 'vis', text: VIS_TEXT[s.resultVisibility] || VIS_TEXT.afterVote },
    { key: 'change', text: s.allowChange ? '可改票' : '不可改票' }
  ];
}

// ---------------------------------------------------------------- 可见人范围（§1.6）
// 范围归一：非法/缺省一律兜底 all（旧数据/旧服务端无 audit 字段时 = 全班）
function normAudience(raw) {
  const s = textOf(raw);
  return AUD.indexOf(s) >= 0 ? s : 'all';
}
// 指定成员座号归一：只保留 1–70 的整数、去重、升序（不存/不返回学号）
function normAudienceSeats(list) {
  const out = [], seen = {};
  (Array.isArray(list) ? list : []).forEach(function (v) {
    const n = Number(v);
    if (!isFinite(n) || !Number.isInteger(n) || n < SEAT_MIN || n > SEAT_MAX || seen[n]) return;
    seen[n] = true;
    out.push(n);
  });
  out.sort(function (a, b) { return a - b; });
  return out;
}
// 范围归一 + 校验：custom 至少 1 个有效座号（reason 与服务端 poll_norm_audience 同文案）；非 custom 座号恒 []
function normAudienceChoice(raw, seats) {
  const audience = normAudience(raw);
  const list = audience === 'custom' ? normAudienceSeats(seats) : [];
  if (audience === 'custom' && list.length < 1) {
    return { ok: false, reason: '请选择可见成员', audience: audience, seats: list };
  }
  return { ok: true, reason: '', audience: audience, seats: list };
}
// 范围标签（卡片/详情共用）：all → ''（不显示）；班委「班委可见」/团员「团员可见」；指定「指定 N 人」
function audienceTag(audience, count) {
  const aud = normAudience(audience);
  if (aud === 'all') return '';
  if (AUD_TAG[aud]) return AUD_TAG[aud];
  const n = Math.max(0, parseInt(count, 10) || 0);
  return n > 0 ? ('指定 ' + n + ' 人') : '指定成员可见';
}
function audienceText(audience) { return AUD_TEXT[normAudience(audience)]; }
// 当前投票的可见范围标签（服务端 poll_list / poll_detail 返回 audience + audience_count）；
// 服务端未给 audience_count 时退回 audience_seats 长度（仅管理者详情会带座号）
function audienceTagOf(poll) {
  const p = poll || {};
  const cnt = Math.max(0, num(p.audience_count, 0)) || (Array.isArray(p.audience_seats) ? p.audience_seats.length : 0);
  return audienceTag(p.audience, cnt);
}

// ---------------------------------------------------------------- 时间 / 截止（§1.5）
function deadlineOf(poll) { return Math.max(0, num(poll && poll.deadline, 0)); }
// 截止判定：status='closed'（提前结束）或 deadline>0 且 now>=deadline；服务端已判 closed 时以服务端为准
function isClosed(poll, now) {
  const p = poll || {};
  if (p.closed === true) return true;
  if (p.status === 'closed') return true;
  const dl = deadlineOf(p);
  if (!dl) return false;
  return (num(now, Date.now())) >= dl;
}
function remainingMs(poll, now) {
  const dl = deadlineOf(poll);
  if (!dl) return 0;
  return Math.max(0, dl - num(now, Date.now()));
}
// 倒计时文案：剩 hh:mm:ss / 剩 mm:ss / 已截止（契约 §3.4；小时按总小时数，跨天也连续）
function formatRemain(ms) {
  let s = Math.max(0, Math.ceil(num(ms, 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return '剩 ' + pad2(h) + ':' + pad2(m) + ':' + pad2(sec);
  return '剩 ' + pad2(m) + ':' + pad2(sec);
}
function countdownText(poll, now) {
  if (isClosed(poll, now)) return '已截止';
  const dl = deadlineOf(poll);
  if (!dl) return '不限时';
  return formatRemain(dl - num(now, Date.now()));
}
// 时间格式化（本机时区）：11-11 18:30（跨年补年份）
function fmtDateTime(ms) {
  const t = num(ms, 0);
  if (!t) return '';
  const d = new Date(t);
  if (!isFinite(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return (sameYear ? '' : d.getFullYear() + '-') + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
function fmtTime(ms) {
  const t = num(ms, 0);
  if (!t) return '';
  const d = new Date(t);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
function dateStrOf(ms) {
  const t = num(ms, 0);
  if (!t) return '';
  const d = new Date(t);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function timeStrOf(ms) {
  const t = num(ms, 0);
  if (!t) return '';
  return fmtTime(t);
}
// picker（date + time，本机时区）→ epoch ms；非法/不存在的日期返回 0
function parseDeadline(dateStr, timeStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr == null ? '' : dateStr));
  if (!m) return 0;
  const tm = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr == null ? '' : timeStr));
  if (!tm) return 0;
  const y = +m[1], mo = +m[2], day = +m[3], hh = +tm[1], mi = +tm[2];
  if (mo < 1 || mo > 12 || day < 1 || day > 31 || hh < 0 || hh > 23 || mi < 0 || mi > 59) return 0;
  const dt = new Date(y, mo - 1, day, hh, mi, 0, 0);
  const t = dt.getTime();
  if (!isFinite(t)) return 0;
  // 回读校验，避免 2-30 这类日期被 Date 溢出成 3-2
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== day) return 0;
  return t;
}
function quickDeadline(mins, now) { return num(now, Date.now()) + Math.max(1, num(mins, 30)) * 60000; }
// 截止文案：截止 11-11 18:30 / 不限时 / 已结束 11-11 18:30
function deadlineText(poll, now) {
  const dl = deadlineOf(poll);
  if (!dl) return '不限时';
  if (isClosed(poll, now)) {
    const endAt = Math.max(dl, num(poll && poll.closed_at, 0));
    return '已结束 ' + fmtDateTime(endAt);
  }
  return '截止 ' + fmtDateTime(dl);
}
function modeTextOf(poll) {
  if (!deadlineOf(poll)) return '不限时';
  return (poll && poll.mode === 'long') ? '长时' : '限时';
}
function statusTextOf(poll, now) { return isClosed(poll, now) ? '已结束' : '进行中'; }

// ---------------------------------------------------------------- 结果可见性 / 百分比
// 规则可见性：always 始终可见 / afterVote 投票后可见 / afterClose 截止后可见
function resultsVisible(settings, states) {
  const s = normSettings(settings);
  const st = states || {};
  if (s.resultVisibility === 'always') return true;
  if (s.resultVisibility === 'afterClose') return !!st.closed;
  return !!st.hasVoted;
}
function pctOf(count, total) {
  const c = Math.max(0, num(count, 0));
  const t = Math.max(0, num(total, 0));
  if (!t) return 0;
  return Math.round(c * 100 / t);
}
// 百分比行（结果条）：[{id, count, pct}]
function pctRows(counts, options, total) {
  const map = (counts && typeof counts === 'object') ? counts : {};
  return (Array.isArray(options) ? options : []).map(function (o) {
    const id = String(o && o.id != null ? o.id : '');
    const c = Math.max(0, num(map[id], 0));
    return { id: id, count: c, pct: pctOf(c, total) };
  });
}

// ---------------------------------------------------------------- 勾选 / 提交校验
// 勾选切换：单选=替换；多选=切换（超过上限返回 {ok:false}，调用方 toast；不改动原数组）
function toggleChoice(choices, id, settings) {
  const cur = (Array.isArray(choices) ? choices : []).map(String);
  const key = String(id == null ? '' : id);
  if (!key) return { ok: false, reason: '选项不合法', choices: cur };
  const s = normSettings(settings);
  if (!s.multi) return { ok: true, reason: '', choices: [key] };
  const i = cur.indexOf(key);
  if (i >= 0) { cur.splice(i, 1); return { ok: true, reason: '', choices: cur }; }
  if (cur.length >= s.maxChoices) return { ok: false, reason: '最多选 ' + s.maxChoices + ' 项', choices: cur };
  cur.push(key);
  return { ok: true, reason: '', choices: cur };
}
// 提交前校验（顺序与云端 poll_submit 的 reason 对齐）：选项不合法/重复 → 数量
function validateChoices(choices, options, settings) {
  const s = normSettings(settings);
  const list = (Array.isArray(choices) ? choices : []).map(String);
  const ids = {};
  (Array.isArray(options) ? options : []).forEach(function (o) {
    if (o && o.id != null) ids[String(o.id)] = 1;
  });
  const seen = {};
  for (let i = 0; i < list.length; i++) {
    const id = list[i];
    if (!ids[id]) return err('选项不合法');
    if (seen[id]) return err('重复的选项');
    seen[id] = 1;
  }
  if (!list.length) return err(s.multi ? '至少选 1 项' : '请选择 1 项');
  if (!s.multi) return list.length > 1 ? err('只能选 1 项') : ok();
  if (list.length > s.maxChoices) return err('最多选 ' + s.maxChoices + ' 项');
  return ok();
}

// ---------------------------------------------------------------- 排序 / 筛选（列表页）
// 进行中：按截止时间升序（不限时排最后），同截止按创建时间倒序；
// 已结束：按创建时间倒序。
function sortPolls(list, filter, now) {
  const arr = (Array.isArray(list) ? list : []).slice();
  const closed = filter === 'closed';
  const ts = num(now, Date.now());
  const out = arr.filter(function (p) { return isClosed(p, ts) === closed; });
  out.sort(function (a, b) {
    if (closed) return num(b.created_at, 0) - num(a.created_at, 0);
    const da = deadlineOf(a), db = deadlineOf(b);
    const va = da > 0 ? da : Number.MAX_SAFE_INTEGER;
    const vb = db > 0 ? db : Number.MAX_SAFE_INTEGER;
    if (va !== vb) return va - vb;
    return num(b.created_at, 0) - num(a.created_at, 0);
  });
  return out;
}

// ---------------------------------------------------------------- 视图模型（页面直接 setData）
// 列表卡片：标题 / 发起人 / 倒计时或截止 / 规则标签（含可见范围标签）/ 已投人数
function cardView(poll, now) {
  const p = poll || {};
  const ts = num(now, Date.now());
  const settings = normSettings(p.settings, (Array.isArray(p.options) ? p.options.length : 0));
  const closed = isClosed(p, ts);
  const total = Math.max(0, num(p.total, 0));
  const dl = deadlineOf(p);
  const owner = String(p.owner_name || '');
  const audTag = audienceTagOf(p);
  // 卡片展示：前 3 个规则标签 + 可见范围标签（all 不显示；最多 4 个）
  const tags = tagsOf(settings).slice(0, 3);
  if (audTag) tags.push({ key: 'aud', text: audTag });
  return {
    id: String(p.id || ''),
    title: String(p.title || ''),
    owner: owner,
    ownerText: owner ? '发起人 ' + owner : '',
    modeText: modeTextOf(p),
    statusText: closed ? '已结束' : '进行中',
    closed: closed,
    openTimed: !closed && dl > 0,
    deadline: dl,
    deadlineText: deadlineText(p, ts),
    countdownText: closed ? '已结束' : (dl > 0 ? formatRemain(dl - ts) : '不限时'),
    audience: normAudience(p.audience),
    audienceTag: audTag,
    tags: tags,
    total: total,
    totalText: total + ' 人已投',
    hasVoted: !!p.has_voted,
    mine: !!p.mine,
    canManage: !!p.can_manage,
    resultsHidden: !!p.results_hidden
  };
}

// 详情视图：poll_detail / poll_submit 返回结构（契约 §2.3）→ 页面渲染模型
// opts = { now, choices }：choices 为页面当前勾选（不传则回显 my_choices；单选/多选共用）
function detailView(detail, opts) {
  opts = opts || {};
  if (!detail || detail.ok === false || !detail.poll) return null;
  const p = detail.poll || {};
  const ts = num(opts.now, 0) || num(detail.now, Date.now()) || Date.now();
  const settings = normSettings(p.settings, (Array.isArray(p.options) ? p.options.length : 0));
  const closed = detail.closed === true || isClosed(p, ts);
  const total = Math.max(0, num(detail.total, 0));
  const hasVoted = !!detail.has_voted;
  // 服务端 results_hidden 是权威口径（它知道当前身份是否已投/是否截止）；缺失时按规则本地判定
  const visible = (typeof detail.results_hidden === 'boolean') ? !detail.results_hidden
    : resultsVisible(settings, { hasVoted: hasVoted, closed: closed });
  const resultsHidden = !visible;
  const myChoices = (Array.isArray(detail.my_choices) ? detail.my_choices : []).map(String);
  const selected = Array.isArray(opts.choices) ? opts.choices.map(String) : (hasVoted ? myChoices : []);
  const canVote = !closed && (!hasVoted || settings.allowChange);
  const counts = (detail.counts && typeof detail.counts === 'object') ? detail.counts : {};
  const options = (Array.isArray(p.options) ? p.options : []).map(function (o) {
    const id = String(o && o.id != null ? o.id : '');
    const c = resultsHidden ? 0 : Math.max(0, num(counts[id], 0));
    const pct = resultsHidden ? 0 : pctOf(c, total);
    return {
      id: id,
      text: String((o && o.text) || ''),
      desc: String((o && o.desc) || ''),
      img: validImg(o && o.img) ? String(o.img) : '',
      count: c,
      pct: pct,
      selected: selected.indexOf(id) >= 0,
      showBar: !resultsHidden
    };
  });
  const optText = {};
  options.forEach(function (o) { optText[o.id] = o.text; });
  const voters = (!resultsHidden && !settings.anonymous && Array.isArray(detail.voters))
    ? detail.voters.map(function (v) {
      const names = (Array.isArray(v && v.choices) ? v.choices : []).map(function (id) { return optText[String(id)] || ''; }).filter(Boolean);
      return { name: String((v && v.name) || ''), text: names.join('、') };
    }).filter(function (v) { return !!v.name; })
    : [];
  const dl = deadlineOf(p);
  const visText = VIS_TEXT[settings.resultVisibility] || VIS_TEXT.afterVote;
  const audTag = audienceTagOf(p);
  const tags = tagsOf(settings);
  if (audTag) tags.push({ key: 'aud', text: audTag });
  return {
    id: String(p.id || opts.id || ''),
    title: String(p.title || ''),
    desc: String(p.description || ''),
    owner: String(p.owner_name || ''),
    ownerText: p.owner_name ? ('发起人 ' + p.owner_name) : '',
    modeText: modeTextOf(p),
    statusText: closed ? '已结束' : '进行中',
    closed: closed,
    deadline: dl,
    deadlineText: deadlineText(p, ts),
    countdownText: closed ? '已截止' : (dl > 0 ? formatRemain(dl - ts) : '不限时'),
    // 可见范围（契约 §1.6）：all 不显示范围标签；custom 显示「指定 N 人」
    audience: normAudience(p.audience),
    audienceTag: audTag,
    audienceCount: Math.max(0, num(p.audience_count, 0)) || (Array.isArray(p.audience_seats) ? p.audience_seats.length : 0),
    tags: tags,
    settings: settings,
    total: total,
    totalText: total + ' 人已投',
    hasVoted: hasVoted,
    myChoices: myChoices,
    selected: selected,
    resultsHidden: resultsHidden,
    resultsVisible: !resultsHidden,
    // 结果隐藏时的提示：afterClose 提交也不会提前看到，不能写「提交后可查看」
    hiddenTip: resultsHidden
      ? (settings.resultVisibility === 'afterClose' ? visText : (visText + '，提交后可查看'))
      : '',
    canVote: canVote,
    canSubmit: canVote,
    isChange: hasVoted,
    submitText: hasVoted ? '改票' : '提交投票',
    options: options,
    voters: voters,
    votersTitle: '投票人',
    mine: !!detail.mine,
    canManage: !!detail.can_manage,
    // 管理入口（契约 §2.4 / §4.2）：编辑仅当无票；提前结束仅进行中；延长/重开/删除所有管理者
    canEdit: !!detail.can_manage && total === 0,
    canClose: !!detail.can_manage && !closed,
    canExtend: !!detail.can_manage,
    canDelete: !!detail.can_manage,
    extendLabel: closed ? '重开' : '延长',
    now: ts
  };
}

// ---------------------------------------------------------------- 表单：发起 / 编辑
// deadline 由页面根据时限类型算好（quick=now+分钟 / long=picker / none=0）
// draft = { id?, title, description, mode, deadline, options, settings, audience?, audienceSeats? }
function buildPayload(draft, now) {
  const d = draft || {};
  const ts = num(now, Date.now());
  const title = textOf(d.title);
  if (!title) return err('请填写投票标题');
  if (title.length > LIMITS.title) return err('标题最多 ' + LIMITS.title + ' 字');
  const desc = String(d.description == null ? '' : d.description).trim();
  if (desc.length > LIMITS.desc) return err('说明最多 ' + LIMITS.desc + ' 字');
  const options = normOptions(d.options);
  const ov = validateOptions(options);
  if (!ov.ok) return ov;
  const settings = normSettings(d.settings, options.length);
  // 可见范围（契约 §1.6）：非法值兜底 all；custom 至少 1 个有效座号（服务端同文案）
  const aud = normAudienceChoice(d.audience, d.audienceSeats);
  if (!aud.ok) return err(aud.reason);
  const deadline = Math.round(num(d.deadline, 0));
  if (!isFinite(deadline) || deadline < 0) return err('截止时间不正确');
  if (deadline > 0 && deadline <= ts) return err('截止时间需要晚于当前时间');
  const mode = (d.mode === 'long' || d.mode === 'quick') ? d.mode : (deadline > 24 * 3600 * 1000 ? 'long' : 'quick');
  const id = (typeof d.id === 'string' && ID_RE.test(d.id)) ? d.id : pollId();
  return ok({
    payload: {
      id: id,
      title: title,
      description: desc,
      mode: mode,
      deadline: deadline,
      audience: aud.audience,
      audienceSeats: aud.seats,
      options: options.map(function (o) {
        const out = { id: o.id, text: o.text };
        if (o.desc) out.desc = o.desc;
        if (o.img) out.img = o.img;
        return out;
      }),
      settings: settings
    }
  });
}

// 编辑回填（poll_detail 结构 → 页面表单初值）：时限类型 quick 无法还原分钟数，统一按「指定截止」回填
// 可见范围：audience 直接回填；custom 的座号仅管理者详情返回（audience_seats），其它人恒 []（服务端限制）
function editorFromPoll(detail) {
  const p = (detail && detail.poll) ? detail.poll : (detail || {});
  const deadline = Math.max(0, num(p.deadline, 0));
  const audience = normAudience(p.audience);
  const seats = audience === 'custom' ? normAudienceSeats(p.audience_seats) : [];
  return {
    id: String(p.id || ''),
    title: String(p.title || ''),
    description: String(p.description || ''),
    type: deadline > 0 ? 'long' : 'none',
    mode: (p.mode === 'long') ? 'long' : 'quick',
    deadline: deadline,
    dDate: deadline > 0 ? dateStrOf(deadline) : '',
    dTime: deadline > 0 ? timeStrOf(deadline) : '',
    options: normOptions(p.options),
    settings: normSettings(p.settings, (Array.isArray(p.options) ? p.options.length : 0)),
    audience: audience,
    audienceSeats: seats,
    audienceCount: Math.max(0, num(p.audience_count, 0)) || seats.length
  };
}

// ---------------------------------------------------------------- 轮询节奏（§4.2）
// 页面可见时：限时 quick 或截止 <6h → 5s；其它（长时/不限时/已结束）→ 10s
function pollIntervalOf(detailOrPoll, now) {
  const p = (detailOrPoll && detailOrPoll.poll) ? detailOrPoll.poll : (detailOrPoll || {});
  const ts = num(now, Date.now());
  // 已结束（提前结束或已到截止）：进入 10s 慢轮询（结果已定，只需感知重开/延长）
  const closed = (detailOrPoll && detailOrPoll.closed === true) || isClosed(p, ts);
  if (closed) return POLL_MS_SLOW;
  if (p.mode === 'quick') return POLL_MS_FAST;
  const dl = deadlineOf(p);
  if (dl > ts && dl - ts < LONG_POLL_MS) return POLL_MS_FAST;
  return POLL_MS_SLOW;
}

// ---------------------------------------------------------------- 配图缩放（canvas 压缩用；纯计算，便于单测）
// 长边缩到 max（≤640），返回整数宽高；非法输入返回 {w:0,h:0}
function fitRect(w, h, max) {
  const W = num(w, 0), H = num(h, 0), M = Math.max(1, num(max, 640));
  if (!(W > 0) || !(H > 0)) return { w: 0, h: 0 };
  const long = Math.max(W, H);
  if (long <= M) return { w: Math.round(W), h: Math.round(H) };
  const k = M / long;
  return { w: Math.max(1, Math.round(W * k)), h: Math.max(1, Math.round(H * k)) };
}

module.exports = {
  LIMITS: LIMITS, QUICK_MINS: QUICK_MINS, VIS: VIS, VIS_TEXT: VIS_TEXT,
  AUD: AUD, AUD_TEXT: AUD_TEXT, AUD_TAG: AUD_TAG, SEAT_MIN: SEAT_MIN, SEAT_MAX: SEAT_MAX,
  ID_RE: ID_RE, OPT_ID_RE: OPT_ID_RE, LONG_POLL_MS: LONG_POLL_MS,
  POLL_MS_FAST: POLL_MS_FAST, POLL_MS_SLOW: POLL_MS_SLOW,
  pollId: pollId, optionId: optionId,
  newOption: newOption, normOption: normOption, normOptions: normOptions,
  validImg: validImg, isImgDataUrl: isImgDataUrl, imgTotalChars: imgTotalChars,
  addOption: addOption, removeOption: removeOption, moveOption: moveOption,
  validateOptions: validateOptions,
  normSettings: normSettings, tagsOf: tagsOf,
  // 可见人范围（契约 §1.6）
  normAudience: normAudience, normAudienceSeats: normAudienceSeats, normAudienceChoice: normAudienceChoice,
  audienceTag: audienceTag, audienceText: audienceText, audienceTagOf: audienceTagOf,
  deadlineOf: deadlineOf, isClosed: isClosed, remainingMs: remainingMs,
  formatRemain: formatRemain, countdownText: countdownText,
  fmtDateTime: fmtDateTime, fmtTime: fmtTime, dateStrOf: dateStrOf, timeStrOf: timeStrOf,
  parseDeadline: parseDeadline, quickDeadline: quickDeadline,
  deadlineText: deadlineText, modeTextOf: modeTextOf, statusTextOf: statusTextOf,
  resultsVisible: resultsVisible, pctOf: pctOf, pctRows: pctRows,
  toggleChoice: toggleChoice, validateChoices: validateChoices,
  sortPolls: sortPolls, cardView: cardView, detailView: detailView,
  buildPayload: buildPayload, editorFromPoll: editorFromPoll,
  pollIntervalOf: pollIntervalOf, fitRect: fitRect
};
