// utils/drawproof.js —— 抽签存证 + 自定义序号名称映射（契约 web/draw/CONTRACT.md §2/§3.1/§4）
//
// 本文件是「抽签升级 v1」小程序端的纯逻辑层（可在 Node 单测里直接 require，不发请求）：
//   §2     draw-v1 算法：seed 16 位 hex → mulberry32(uint32 显式版) → 洗牌不放回 / 允许重复；
//          网页 / 小程序 / 核验页必须逐字节一致，4 组固定向量见契约（drawproof_unit_tests.js 锁定）。
//   §3.1   名称映射：每行「序号 名称」（无序号按非空行序号自增），trim 后 1–40 字，同序号后值覆盖，
//          最多 300 项，归一排序输出 "num name" 行；nameOf 优先级 = 映射 > 班级名单派生名 > ''。
//   §1/§4  云端存证 4 个 RPC（draw_record_create / draw_event_append / draw_record_get / draw_record_list）
//          统一复用 utils/cloud.js 的请求通道（Authorization: Bearer <publishableKey> + X-Class-Token），
//          **不新增请求来源、不打印 token**；响应失败一律返回 { ok:false, reason }，由页面静默降级（不阻塞抽签）。
//   §3.3   导出图参数/二维码文案、记录列表/详情的视图模型（页面只做渲染，便于单测固定 payload）。
//
// 隐私：记录只存「序号 + 自定义名称（组名等）」；班级名单姓名只在登录后由本机名单本地解析，不进云端。
const util = require('./util.js');

const NAME_MAX = 300;      // 映射最多 300 项（契约 §3.1 / 服务端 labels ≤300）
const NAME_LEN = 40;       // 单条名称 trim 后 1..40 字
const ALGO = 'draw-v1';
const SORT_LABEL = { draw: '按抽取顺序', num: '按序号升序', desc: '从大到小', rand: '随机打乱' };

/* ================================================================
 * §2 draw-v1 算法（契约逐字；改动必须同时改网页/核验页与固定向量）
 * ================================================================ */
// mulberry32 的 uint32 显式版：seedHex 取前 8 位 hex → 32 位种子，返回 int(m) ∈ [0, m)
function seededInts(seedHex) {
  let s = parseInt(String(seedHex == null ? '' : seedHex).slice(0, 8), 16) >>> 0;
  if (!isFinite(s)) s = 0;
  function next() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), (t | 1)) >>> 0;
    t = (t ^ ((t + Math.imul(t ^ (t >>> 7), (t | 61))) >>> 0)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return function (m) {
    const n = Math.floor(Number(m) || 0);
    if (n <= 0) return 0;
    return Math.floor(next() * n);
  };
}

// 抽签：pool 号码数组（升序）；count 抽取个数；dup=false 洗牌不放回，dup=true 可重复。
// 返回「抽取顺序」数组（结果集合与排序无关：排序只改显示顺序，不改本函数输出）。
function drawV1(seed, pool, count, dup) {
  const p = (Array.isArray(pool) ? pool : []).map(Number).filter(function (n) { return isFinite(n); });
  let n = Math.floor(Number(count));
  if (!isFinite(n) || n < 0) n = 0;
  if (n > 1000) n = 1000;
  const res = [];
  if (!p.length || !n) return res;
  const rand = seededInts(seed);
  if (dup) {
    for (let k = 0; k < n; k++) res.push(p[rand(p.length)]);
    return res;
  }
  const a = p.slice();
  for (let j = a.length - 1; j > 0; j--) {
    const r = rand(j + 1);
    const t = a[j]; a[j] = a[r]; a[r] = t;
  }
  for (let i = 0; i < n && i < a.length; i++) res.push(a[i]);
  return res;
}

/* ================================================================
 * seed / 记录编号 / 核验链接
 * ================================================================ */
const HEX = '0123456789abcdef';
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
// seed = 8 字节随机数 → 16 位小写 hex（契约 §2）。
// 小程序基础库没有同步 crypto：按契约允许的 Math.random 兜底（记录随 result/seed 一起存证，
// 核验页用它复算；不用于任何安全密钥，因此不要求密码学强度）。
function newSeed() {
  let s = '';
  for (let i = 0; i < 16; i++) s += HEX.charAt(Math.floor(Math.random() * 16));
  return s;
}

// 记录编号 = 'd' + base36(now) + 4 位随机 [0-9a-z]（服务端 CHECK ^d[0-9a-z]{8,31}$；客户端生成，幂等键）
function newRecordId(now) {
  const t = Math.floor(Number(now) || Date.now()).toString(36).toLowerCase();
  let r = '';
  for (let i = 0; i < 4; i++) r += B36.charAt(Math.floor(Math.random() * 36));
  return ('d' + t + r).slice(0, 32);
}

// 核验链接基址：优先 utils/cloud-config.js 的 webBase（https://tool.furina.fun），单测可显式传 base。
function webBaseOf() {
  try {
    const c = require('./cloud-config.js');
    return String((c && c.webBase) || '').replace(/\/+$/, '');
  } catch (e) { return ''; }
}
// verifyUrl(id) = webBase + '/#verify=' + id（与网页 #verify= 深链同一规则）
function verifyUrl(id, base) {
  const b = String(base || webBaseOf() || 'https://tool.furina.fun').replace(/\/+$/, '');
  return b + '/#verify=' + String(id == null ? '' : id);
}

/* ================================================================
 * §3.1 自定义序号名称映射
 * ================================================================ */
function normName(v) {
  let s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (s.length > NAME_LEN) s = s.slice(0, NAME_LEN);
  return s;
}
// 解析映射文本 → [{n,nm}]（升序、去重后值覆盖、≤300 项）
function parseNames(text) {
  const map = {};
  let auto = 0;
  String(text == null ? '' : text).split(/\r?\n/).forEach(function (line) {
    const s = String(line).trim();
    if (!s) return;
    auto += 1;                                    // 「非空行序号」：第 k 个非空行 = k
    const m = s.match(/^(\d{1,4})\s*[.,、:：=\-]?\s*(.+)$/);
    const n = m ? parseInt(m[1], 10) : auto;
    const nm = normName(m ? m[2] : s);
    if (!isFinite(n) || n < 1 || !nm) return;
    map[n] = nm;                                  // 同序号后值覆盖
  });
  return Object.keys(map).map(Number).sort(function (a, b) { return a - b; })
    .slice(0, NAME_MAX)
    .map(function (n) { return { n: n, nm: map[n] }; });
}
// 解析映射文本（或 [{n,nm}]）→ { <序号>: <名称> }
function nameMap(v) {
  const out = {};
  (Array.isArray(v) ? v : parseNames(v)).forEach(function (x) {
    if (!x) return;
    const n = Number(x.n), nm = normName(x.nm);
    if (isFinite(n) && n >= 1 && nm) out[n] = nm;
  });
  return out;
}
// [{n,nm}] / 映射文本 → 归一文本（升序 "num name" 行），保存时用
function namesText(v) {
  const list = Array.isArray(v) ? v : parseNames(v);
  return list.map(function (x) { return x.n + ' ' + x.nm; }).join('\n');
}
function normNamesText(text) { return namesText(parseNames(text)); }
// 映射摘要：'N 项' / '未设置'
function namesSummary(v) {
  const n = (Array.isArray(v) ? parseNames(namesText(v)) : parseNames(v)).length;
  return n ? (n + ' 项') : '未设置';
}
// labels = 命中结果的 {n,nm}（n ∈ result，按 n 升序，≤300；服务端会再归一）
function labelsOf(names, result) {
  const list = Array.isArray(names) ? names : parseNames(names);
  const map = {};
  list.forEach(function (x) { map[x.n] = x.nm; });
  const seen = {}, out = [];
  (Array.isArray(result) ? result : []).forEach(function (v) {
    const n = Number(v);
    if (!isFinite(n) || seen[n] || !map[n]) return;
    seen[n] = 1;
    out.push({ n: n, nm: map[n] });
  });
  out.sort(function (a, b) { return a.n - b.n; });
  return out.slice(0, NAME_MAX);
}
// nameOf 优先级：映射 > 班级名单派生名 > ''（网页 §3.1 同口径；rosterText = store.roster "座号 姓名" 行）
function nameOf(namesTextOrList, rosterText) {
  const map = Object.assign({}, util.rosterMap(rosterText || '').m, nameMap(namesTextOrList));
  return function (n) { return map[n] || ''; };
}
// 结果 → 展示行（显示排序只影响顺序，不改 st.result 的分辨率：抽取顺序仍由 drawV1 决定）
// names：映射文本或 [{n,nm}]；rosterText：班级名单派生文本（无名单映射时兜底）
function rowsOf(result, names, rosterText, sort) {
  const map = Object.assign({}, util.rosterMap(rosterText || '').m, nameMap(names));
  let rows = (Array.isArray(result) ? result : []).map(function (v) {
    const n = Number(v);
    return { n: n, nm: map[n] || '' };
  });
  if (sort === 'num') rows = rows.slice().sort(function (a, b) { return a.n - b.n; });
  else if (sort === 'desc') rows = rows.slice().sort(function (a, b) { return b.n - a.n; });
  else if (sort === 'rand') {
    // 随机打乱只影响显示顺序（契约 §2：排序不改变结果集合、不改 st.result、不记事件）
    rows = rows.slice();
    for (let j = rows.length - 1; j > 0; j--) {
      const r = Math.floor(Math.random() * (j + 1));
      const t = rows[j]; rows[j] = rows[r]; rows[r] = t;
    }
  }
  return rows.map(function (r, i) { return { n: r.n, nm: r.nm, key: i }; });
}

/* ================================================================
 * 参数归一 / 视图模型（导出图 & 记录页共用；服务端会按 §1.4 再白名单归一）
 * ================================================================ */
function normExcl(list) {
  const out = [], seen = {};
  (Array.isArray(list) ? list : []).forEach(function (v) {
    const n = Number(v);
    if (!isFinite(n) || n < 0 || n > 99999 || seen[n]) return;
    seen[n] = 1; out.push(n);
  });
  out.sort(function (a, b) { return a - b; });
  return out.slice(0, 200);
}
// 与服务端 §1.4 同构的 params（未知字段不传；range 升序两个整数）
function buildParams(p) {
  const o = p || {};
  let lo = Math.round(Number(o.lo)), hi = Math.round(Number(o.hi));
  if (!isFinite(lo)) lo = 0;
  if (!isFinite(hi)) hi = lo;
  if (lo > hi) { const t = lo; lo = hi; hi = t; }
  let count = Math.round(Number(o.count));
  if (!isFinite(count) || count < 1) count = 1;
  if (count > 1000) count = 1000;
  const sort = SORT_LABEL[o.sort] ? o.sort : 'draw';
  let rosterN = Math.round(Number(o.rosterN));
  if (!isFinite(rosterN) || rosterN < 0) rosterN = 0;
  if (rosterN > 70) rosterN = 70;
  let namesN = Math.round(Number(o.namesN));
  if (!isFinite(namesN) || namesN < 0) namesN = 0;
  if (namesN > NAME_MAX) namesN = NAME_MAX;
  return {
    range: [lo, hi],
    count: count,
    dup: !!o.dup,
    excl: normExcl(o.excl),
    sort: sort,
    rosterN: rosterN,
    namesN: namesN
  };
}
// 参数 → 展示行 [ [标签, 值], ... ]（记录详情 / 导出图）
function paramLines(params) {
  const p = params || {};
  const range = Array.isArray(p.range) ? p.range : [0, 0];
  const rosterN = Number(p.rosterN) || 0;
  const namesN = Number(p.namesN) || 0;
  return [
    ['范围', range[0] + ' – ' + range[1]],
    ['个数', String(Number(p.count) || 0)],
    ['允许重复', p.dup ? '是' : '否'],
    ['排除', (Array.isArray(p.excl) && p.excl.length) ? p.excl.join(',') : '无'],
    ['排序', SORT_LABEL[p.sort] || SORT_LABEL.draw],
    ['参与名单', rosterN ? ('已选 ' + rosterN + ' 人') : '未选择 · 只抽序号'],
    ['名称映射', namesN ? (namesN + ' 项') : '未设置']
  ];
}
// 列表行参数摘要：'范围 1 – 70 · 抽 10 个 · 不重复'
function paramSummary(params) {
  const p = params || {};
  const range = Array.isArray(p.range) ? p.range : [0, 0];
  let s = '范围 ' + range[0] + ' – ' + range[1] + ' · 抽 ' + (Number(p.count) || 0) + ' 个 · ' + (p.dup ? '可重复' : '不重复');
  if (Number(p.rosterN) > 0) s += ' · 名单 ' + Number(p.rosterN) + ' 人';
  if (Number(p.namesN) > 0) s += ' · 映射 ' + Number(p.namesN) + ' 项';
  return s;
}
// 结果摘要：'5、9、2'（超 max 个省略）
function resultSummary(result, max) {
  const list = (Array.isArray(result) ? result : []).map(String);
  const n = Math.max(1, Number(max) || 10);
  if (list.length <= n) return list.join('、');
  return list.slice(0, n).join('、') + ' …';
}
function pad2(n) { return ('0' + n).slice(-2); }
// 毫秒时间戳（或 ISO 串）→ 'YYYY-MM-DD HH:MM:SS'（本机时区；服务端 at 已是 ms）
function atMs(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v) { const t = Date.parse(v); if (isFinite(t)) return t; }
  return 0;
}
function fmtAt(v) {
  const ms = atMs(v);
  if (!ms) return '';
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}
function fmtTime(v) {
  const ms = atMs(v);
  if (!ms) return '';
  const d = new Date(ms);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/* ================================================================
 * 存证状态（页面展示 / 导出图）
 * ================================================================ */
// proof = { status:'pending'|'ok'|'failed', id, at, hash, seq_day, today_count, today_mine, slow }
function proofLine(proof) {
  if (!proof || !proof.status) return '';
  if (proof.timeline === 'unknown') return '本地变更未确认 · 已确认 ' + (Number(proof.event_count) || 0) + ' 条事件';
  if (proof.timeline === 'pending') return '本地变更待存证 · 已确认 ' + (Number(proof.event_count) || 0) + ' 条事件';
  if (proof.status === 'pending') return proof.slow ? '未存证（网络不可用）' : '存证中…';
  if (proof.status === 'ok') {
    return '已存证 · 今日第 ' + (Number(proof.seq_day) || 0) + ' 次（全班今日共 ' + (Number(proof.today_count) || 0) + ' 次）';
  }
  return '未存证（网络不可用）';
}
function proofReady(proof) { return !!(proof && proof.status === 'ok' && proof.id && (!proof.timeline || proof.timeline === 'ok')); }
// 导出图「参数区」追加的存证行（契约 §3.3）；未存证 → [['存证','未存证（网络不可用）']]
function proofConfigLines(proof) {
  if (!proofReady(proof)) return [['存证', proofLine(proof) || '未存证（网络不可用）']];
  return [
    ['存证编号', String(proof.id)],
    ['存证时间', fmtAt(proof.at)],
    ['今日抽签', '第 ' + (Number(proof.seq_day) || 0) + ' 次（今日共 ' + (Number(proof.today_count) || 0) + ' 次）'],
    ['记录哈希', String(proof.hash || '').slice(0, 16)]
  ];
}
// 导出图二维码 note 3 行（契约 §3.3）
function proofQrNote(proof) {
  if (!proofReady(proof)) return [];
  return [
    '存证编号 ' + String(proof.id),
    '记录哈希 ' + String(proof.hash || '').slice(0, 12),
    '今日第 ' + (Number(proof.seq_day) || 0) + ' 次 · 共 ' + (Number(proof.today_count) || 0) + ' 次'
  ];
}
// 剔除重抽明细 → 纯文本行（导出图 blocks 末尾；最多 max 行，超出省略）
// log 项：{ t, n, act:'剔除'|'补抽'|'打乱' }（pages/draw 运行时结构）
function removeLogLines(log, max) {
  const list = Array.isArray(log) ? log : [];
  const lim = Math.max(1, Number(max) || 8);
  const pairs = [];
  list.forEach(function (x) {
    if (!x || !x.act) return;
    if (x.act === '剔除') pairs.push({ i: pairs.length + 1, n: Number(x.n), add: [] });
    else if (x.act === '补抽') {
      const last = pairs[pairs.length - 1];
      if (last && !last.closed) last.add.push(Number(x.n));
      else pairs.push({ i: pairs.length + 1, n: null, add: [Number(x.n)] });
    }
  });
  const lines = pairs.map(function (p) {
    let s = '#' + p.i + ' ';
    if (p.n != null && isFinite(p.n)) s += '剔除 ' + p.n;
    if (p.add.length) s += (s.length > 3 ? ' → ' : '') + '补抽 ' + p.add.join('、');
    return s.trim();
  }).filter(function (s) { return s && s !== '#'; });
  if (lines.length > lim) return lines.slice(0, lim).concat(['… 等 ' + lines.length + ' 项']);
  return lines;
}

/* ================================================================
 * 记录列表 / 详情视图（页面只渲染；测试固定 payload）
 * ================================================================ */
// 列表行（契约 §1.3-4 摘要字段：id/at/day/seq_day/params/result/labels/hash/event_count/is_mine/op_name/op_seat）
function recordRow(r, opts) {
  r = r || {};
  const o = opts || {};
  const at = atMs(r.at);
  const op = String(r.op_name || '');
  const seat = Number(r.op_seat);
  const who = op ? (op + (isFinite(seat) && seat > 0 ? (' · ' + seat + ' 号') : '')) : '—';
  const list = (Array.isArray(r.labels) ? r.labels : []).map(function (x) {
    return x && isFinite(Number(x.n)) ? { n: Number(x.n), nm: String(x.nm || '') } : null;
  }).filter(Boolean);
  let result = Array.isArray(r.result) ? r.result.slice() : [];
  if (o.sort === 'num' || o.sort === 'desc') result.sort(function (a, b) { return o.sort === 'num' ? a - b : b - a; });
  return {
    id: String(r.id || ''),
    at: at,
    timeText: fmtTime(at),
    dateText: fmtAt(at),
    dayText: String(r.day || ''),
    seqText: '第 ' + (Number(r.seq_day) || 0) + ' 次',
    paramText: paramSummary(r.params),
    resultText: resultSummary(result, 8),
    opText: who,
    mine: !!r.is_mine,
    eventCount: Number(r.event_count) || 0,
    hashShort: String(r.hash || '').slice(0, 8)
  };
}
// 列表整体视图：{ rows, countText, todayText }
function listView(resp) {
  const r = resp || {};
  const records = Array.isArray(r.records) ? r.records : [];
  const tc = Number(r.today_count) || 0;
  const tm = Number(r.today_mine) || 0;
  return {
    rows: records.map(function (x) { return recordRow(x); }),
    countText: records.length ? (records.length + ' 条记录') : '暂无记录',
    todayText: '今日共 ' + tc + ' 次 · 我 ' + tm + ' 次',
    todayCount: tc,
    todayMine: tm,
    dayText: String(r.day || '')
  };
}
// 时间线（events）→ 展示行
const EVENT_LABEL = { remove: '剔除', refill: '补抽', sort: '排序', reset: '重置本轮' };
function timelineRows(events) {
  return (Array.isArray(events) ? events : []).map(function (e, i) {
    const kind = String((e && e.kind) || '');
    let text = EVENT_LABEL[kind] || kind || '操作';
    if (kind === 'remove') {
      text = '剔除 ' + (e.n == null ? '?' : e.n);
      if (e.added != null) text += ' → 补抽 ' + e.added;
    } else if (kind === 'refill') {
      text = e.added == null ? '补抽' : ('补抽 ' + e.added);
    }
    return {
      seq: Number(e && e.seq) || (i + 1),
      seqText: '#' + (Number(e && e.seq) || (i + 1)),
      kind: kind,
      text: text,
      note: String((e && e.note) || ''),
      timeText: fmtTime(e && e.at),
      hashShort: String((e && e.hash) || '').slice(0, 8)
    };
  });
}
// 复算：draw-v1(seed, pool, count, dup) 与存证 result 逐元素比对（核验页 §2 同口径）
function replayResult(record) {
  if (!record || !record.seed || !record.params || !Array.isArray(record.pool)) return null;
  return drawV1(record.seed, record.pool, record.params.count, record.params.dup);
}
function replayOk(record) {
  const got = replayResult(record);
  if (!got) return false;
  const want = (Array.isArray(record.result) ? record.result : []).map(Number);
  if (got.length !== want.length) return false;
  for (let i = 0; i < got.length; i++) if (got[i] !== want[i]) return false;
  return true;
}
// 详情视图（契约 §3.4：编号/时间/抽签人/今日次数 → 参数 → 初始结果 → 时间线 → 算法自检 → 哈希 → 二维码链接）
// opts: { rosterText }（本机班级名单派生文本，用于结果名称本地解析；不进云端）
function detailView(record, opts) {
  const r = record || {};
  const o = opts || {};
  const at = atMs(r.at);
  const labels = Array.isArray(r.labels) ? r.labels : [];
  const op = String(r.op_name || '');
  const seat = Number(r.op_seat);
  const evs = Array.isArray(r.events) ? r.events : [];
  const seqDay = Number(r.seq_day) || 0;
  const todayCount = Number(r.today_count) || 0;
  const got = replayResult(r);
  return {
    id: String(r.id || ''),
    at: at,
    atText: fmtAt(at),
    dayText: String(r.day || ''),
    seqText: '第 ' + seqDay + ' 次',
    todayText: '今日第 ' + seqDay + ' 次（全班今日共 ' + todayCount + ' 次）',
    todayMineText: '我今日 ' + (Number(r.today_mine) || 0) + ' 次',
    mine: !!r.is_mine,
    opText: op || '—',
    opSeat: isFinite(seat) && seat > 0 ? seat : 0,
    opFullText: op + (isFinite(seat) && seat > 0 ? (' · ' + seat + ' 号') : ''),
    params: paramLines(r.params).map(function (kv) { return { k: kv[0], v: kv[1] }; }),
    paramText: paramSummary(r.params),
    rows: rowsOf(r.result || [], labels, o.rosterText || '', 'draw'),
    labels: labels,
    timeline: timelineRows(evs),
    eventCount: Number(r.event_count) || evs.length,
    seed: String(r.seed || ''),
    algo: String(r.algo || ALGO),
    replayOk: replayOk(r),
    replayText: got ? (replayOk(r) ? '复算一致' : '复算不一致') : '无法复算',
    hash: String(r.hash || ''),
    hashShort: String(r.hash || '').slice(0, 16),
    prevHash: String(r.prev_hash || ''),
    prevHashShort: String(r.prev_hash || '').slice(0, 16),
    canon: String(r.canon || ''),
    verifyUrl: verifyUrl(r.id),
    isTest: false
  };
}

/* ================================================================
 * 二维码（记录详情页 canvas 绘制；与导出图同一 qr.js 生成器）
 * ================================================================ */
function qrMatrix(text) {
  try {
    const qm = require('./qr.js').qrGen(String(text == null ? '' : text));
    return (qm && qm.n && Array.isArray(qm.m)) ? qm : null;
  } catch (e) { return null; }
}
// 把二维码矩阵画到 canvas 2d context（x,y 左上角；size 目标边长；返回实际绘制边长）
function paintQr(g, qm, x, y, size, color) {
  if (!g || !qm || !qm.n || !Array.isArray(qm.m)) return 0;
  const box = Math.max(1, Math.floor(Number(size) || 0));
  const mod = Math.max(1, Math.floor(box / qm.n));
  const off = Math.floor((box - mod * qm.n) / 2);
  g.fillStyle = color || '#303A35';
  for (let r = 0; r < qm.n; r++) {
    for (let c = 0; c < qm.n; c++) {
      if (qm.m[r] && qm.m[r][c]) g.fillRect(x + off + c * mod, y + off + r * mod, mod, mod);
    }
  }
  return mod * qm.n;
}

/* ================================================================
 * §1.3 RPC 封装（复用 utils/cloud.js 统一 header/token；失败不 throw、不打印 token）
 * ================================================================ */
const NET_ERR = '网络不可用，稍后重试';
function rpcOf(r) {
  // 传输层失败 → 中文 reason；成功返回 null（由调用方取 data）
  if (r && r.ok === true) return null;
  const err = String((r && r.error) || '');
  if (err === 'forbidden') return '身份已失效，请重新进入班级';
  if (err === 'cloud-disabled') return '云端未连接';
  return NET_ERR;
}
function call(pathName, body) {
  const cloud = require('./cloud.js');            // 延迟 require：避免与 cloud.js 加载期循环依赖
  if (!cloud.isEnabled() || !cloud.currentSid()) {
    return Promise.resolve({ ok: false, error: cloud.isEnabled() ? 'forbidden' : 'cloud-disabled' });
  }
  if (typeof cloud.rpcCall !== 'function') return Promise.resolve({ ok: false, error: 'cloud-disabled' });
  return cloud.rpcCall(pathName, body || {});
}
// 统一取出 jsonb 结果；失败返回 { ok:false, reason }
function reply(r) {
  const bad = rpcOf(r);
  if (bad) return { ok: false, reason: bad, data: null };
  const d = r.data;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, reason: NET_ERR, data: null };
  if (d.ok === false) return { ok: false, reason: String(d.reason || '操作失败'), data: null };
  return { ok: true, reason: '', data: d };
}

// 创建存证（契约 §1.3-1）：幂等 id；params/pool/result/labels/seed/algo 由服务端白名单归一。
// 返回 { ok, reason, today_count, today_mine, record }
function recordCreate(payload) {
  const p = payload || {};
  const body = {
    p_id: String(p.id == null ? '' : p.id),
    p_params: (p.params && typeof p.params === 'object') ? p.params : null,
    p_pool: Array.isArray(p.pool) ? p.pool : [],
    p_result: Array.isArray(p.result) ? p.result : [],
    p_labels: Array.isArray(p.labels) ? p.labels : [],
    p_seed: String(p.seed == null ? '' : p.seed),
    p_algo: ALGO
  };
  if (!body.p_id) return Promise.resolve({ ok: false, reason: '缺少存证编号' });
  return call('rpc/draw_record_create', body).then(function (r) {
    const x = reply(r);
    if (!x.ok) return { ok: false, reason: x.reason };
    const d = x.data;
    return {
      ok: true, reason: '',
      today_count: Number(d.today_count) || 0,
      today_mine: Number(d.today_mine) || 0,
      record: (d.record && typeof d.record === 'object' && !Array.isArray(d.record)) ? d.record : null
    };
  });
}
// 追加事件（契约 §1.3-2）：仅记录本人可追加；剔除/补抽/重置。
// payload：{ id, kind:'remove'|'refill'|'sort'|'reset', n?, added?, note? }
function eventAppend(payload) {
  const p = payload || {};
  const id = String(p.id == null ? '' : p.id);
  const kind = String(p.kind == null ? '' : p.kind);
  if (!id) return Promise.resolve({ ok: false, reason: '缺少存证编号' });
  if (['remove', 'refill', 'sort', 'reset'].indexOf(kind) < 0) return Promise.resolve({ ok: false, reason: '事件类型不合法' });
  const body = { p_id: id, p_kind: kind };
  body.p_n = (p.n === null || p.n === undefined || !isFinite(Number(p.n))) ? null : Math.round(Number(p.n));
  body.p_added = (p.added === null || p.added === undefined || !isFinite(Number(p.added))) ? null : Math.round(Number(p.added));
  body.p_note = String(p.note == null ? '' : p.note).slice(0, 120);
  return call('rpc/draw_event_append', body).then(function (r) {
    const x = reply(r);
    if (!x.ok) return { ok: false, reason: x.reason };
    return {
      ok: true, reason: '',
      event: (x.data.event && typeof x.data.event === 'object') ? x.data.event : null,
      event_count: Number(x.data.event_count) || 0
    };
  });
}
// 记录详情（契约 §1.3-3）：登录 + is_test 同口径才可见；响应不含 sid。
// 返回 { ok, reason, record }
function recordGet(id) {
  const rid = String(id == null ? '' : id);
  if (!rid) return Promise.resolve({ ok: false, reason: '缺少存证编号' });
  return call('rpc/draw_record_get', { p_id: rid }).then(function (r) {
    const x = reply(r);
    if (!x.ok) return { ok: false, reason: x.reason };
    return { ok: true, reason: '', record: (x.data.record && typeof x.data.record === 'object') ? x.data.record : null };
  });
}
// 记录列表（契约 §1.3-4）：scope = 'today' | 'all' | 'YYYY-MM-DD'；limit 1..100。
// 返回 { ok, reason, scope, day, today_count, today_mine, records }
function recordList(scope, limit) {
  const sc = String(scope == null ? 'today' : scope);
  let lim = Math.round(Number(limit));
  if (!isFinite(lim) || lim < 1) lim = 30;
  if (lim > 100) lim = 100;
  return call('rpc/draw_record_list', { p_scope: sc || 'today', p_limit: lim }).then(function (r) {
    const x = reply(r);
    if (!x.ok) return { ok: false, reason: x.reason, scope: sc, day: '', today_count: 0, today_mine: 0, records: [] };
    const d = x.data;
    return {
      ok: true, reason: '',
      scope: String(d.scope || sc),
      day: String(d.day || ''),
      today_count: Number(d.today_count) || 0,
      today_mine: Number(d.today_mine) || 0,
      records: Array.isArray(d.records) ? d.records : []
    };
  });
}

module.exports = {
  NAME_MAX, NAME_LEN, ALGO, SORT_LABEL,
  // §2 算法
  seededInts: seededInts, drawV1: drawV1,
  // seed / 编号 / 链接
  newSeed: newSeed, newRecordId: newRecordId, verifyUrl: verifyUrl, webBaseOf: webBaseOf,
  // §3.1 名称映射
  parseNames: parseNames, nameMap: nameMap, namesText: namesText, normNamesText: normNamesText,
  namesSummary: namesSummary, labelsOf: labelsOf, nameOf: nameOf, rowsOf: rowsOf,
  // 参数 / 视图
  normExcl: normExcl, buildParams: buildParams, paramLines: paramLines, paramSummary: paramSummary,
  resultSummary: resultSummary, atMs: atMs, fmtAt: fmtAt, fmtTime: fmtTime,
  // 存证状态
  proofLine: proofLine, proofReady: proofReady, proofConfigLines: proofConfigLines,
  proofQrNote: proofQrNote, removeLogLines: removeLogLines,
  // 记录视图
  recordRow: recordRow, listView: listView, timelineRows: timelineRows,
  replayResult: replayResult, replayOk: replayOk, detailView: detailView,
  // 二维码
  qrMatrix: qrMatrix, paintQr: paintQr,
  // RPC
  recordCreate: recordCreate, eventAppend: eventAppend, recordGet: recordGet, recordList: recordList
};
