// utils/water.js —— 宿舍「水量统计」纯逻辑（与网站 WATER 模块同口径，v2.0.0 网站功能同步）
//
// 计费规则（唯一来源 web/tools/tests/_water_contract.md §0，web/mp 同值；2026-11-11 起共享契约
//   web/tools/tests/_water_shared_contract.md §5：文案统一称「定额」，公式数值不变）：
//   电 0.58 元/度、水 3.03 元/吨；定额 2 吨水 + 5 度电 / 人 / 月（每月拨给、当月有效、每学年 10 个月、
//   寒暑假留宿无补贴）；无阶梯、无额外加价（学校后勤基建处 2025-09-05《关于学生公寓水电费计取的情况说明》
//   + 《学生公寓（宿舍）管理规定》闽中医后〔2021〕10 号）；以学校最新通知为准。
//   本期水费(元) = max(0, 用量吨 − 2×人数) × 3.03（保留 2 位）
//   折合扣电(度) = 水费 ÷ 0.58（保留 1 位）
//   用量吨 = 本次读数 − 上次读数（同一宿舍按月份升序的前一条）
//
// 数据（本机 store.water 与 UD v6 water section 同结构，与网页端互通）：
//   water = { rooms: { "<roomverify>": { p: 4|6, recs: [ { m:"YYYY-MM", r:<吨>, ts:<ms> } ] } } }
//   recs 按月唯一、按 m 升序、最多 120 条；r 保留 2 位小数；ts = 写入时间。
//
// 2026-11-11 云端共享（契约 §1–§4；唯一新增数据源仍是既有 PostgREST 云端，不新增外部请求来源）：
//   * public.water      {roomverify, month, reading, persons, updated_at}  主键 (roomverify,month)
//   * public.water_room {roomverify, persons}                              主键 roomverify
//   * 进入/切宿舍：先渲染本机缓存 → GET 云端；同 month 云端覆盖本地，本地独有月份补传；
//   * 保存/删除/改人数：先本机 → 再尽力写云端；失败进 store.waterPend，onShow/联网重试；
//   * 23 号楼 A/B 座固定 4 人间（不可改；云端 water_room.persons 首次进入 upsert 4）；
//   * UD v6 water 仍照旧读写（兼容旧版页面），但统计/展示以云端为准（§3.4）。
//
// 纯函数（无 wx 依赖）便于 Node 单测。
const RULES = {
  elec: 0.58,               // 元/度
  water: 3.03,              // 元/吨
  waterFreePP: 2,           // 吨/人/月（定额）
  elecFreePP: 5,            // 度/人/月（定额）
  personsDef: 4,
  personsOpts: [1, 2, 3, 4, 5, 6],
  cycleMonths: 10,          // 每学年按 10 个月划拨（寒暑假无）
  waterDate: '2025-09-05',
  elecDate: '2025-09-05',
  quotaDate: '2021-07'
};
// 1 吨水 ≈ 3.03 / 0.58 度（规则卡展示用）
const TON_TO_DEG = RULES.water / RULES.elec;
const REC_CAP = 120;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
// 23 号楼 A/B 座固定 4 人间（契约 §4：roomverify 以 4-23A--- / 4-23B--- 开头）
const FIXED4_RE = /^4-23[AB]---/;

function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function round1(v) { return Math.round((Number(v) || 0) * 10) / 10; }
function pad(n) { return (n < 10 ? '0' : '') + n; }
// 当前月 / 指定日期 → 'YYYY-MM'
function monthOf(d) {
  const n = d ? (d instanceof Date ? d : new Date(d)) : new Date();
  if (isNaN(n.getTime())) return '';
  return n.getFullYear() + '-' + pad(n.getMonth() + 1);
}
function normMonth(v) { const s = String(v == null ? '' : v); return MONTH_RE.test(s) ? s : ''; }
// 月份位移（-1 = 上个月）；非法输入返回 ''
function shiftMonth(m, delta) {
  const s = normMonth(m);
  if (!s) return '';
  const y = Number(s.slice(0, 4));
  const mo = Number(s.slice(5, 7)) - 1 + (Number(delta) || 0);
  const t = new Date(y, mo, 1);
  return monthOf(t);
}
// 人数：1–6 人间自选（2026-11-19 用户要求），非法值回落默认 4
function normPersons(v) { const n = Math.round(Number(v)); return (isFinite(n) && n >= 1 && n <= 6) ? n : RULES.personsDef; }
// 单条读数归一（2 位小数、非负）
function normReading(v) { const n = Number(v); return (isFinite(n) && n >= 0) ? round2(n) : null; }

// recs 归一：丢弃坏行、按月唯一（同月取 ts 较新者）、r 2 位、m 升序、上限 120（丢最旧）
function normRecs(list, cap) {
  const map = {};
  (Array.isArray(list) ? list : []).forEach(function (r) {
    if (!r || typeof r !== 'object') return;
    const m = normMonth(r.m);
    const rv = normReading(r.r);
    if (!m || rv == null) return;
    const ts = Number(r.ts) || 0;
    const prev = map[m];
    if (!prev || ts >= prev.ts) map[m] = { m: m, r: rv, ts: ts };
  });
  const out = Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) { return a.m < b.m ? -1 : (a.m > b.m ? 1 : 0); });
  const limit = Math.max(1, Number(cap) || REC_CAP);
  return out.length > limit ? out.slice(out.length - limit) : out;
}
// rooms 归一：坏数据 → 空对象；每个房间 {p, recs}
function normRooms(rooms) {
  const out = {};
  if (!rooms || typeof rooms !== 'object' || Array.isArray(rooms)) return out;
  Object.keys(rooms).forEach(function (rv) {
    const r = rooms[rv];
    if (!r || typeof r !== 'object' || Array.isArray(r)) return;
    out[rv] = { p: normPersons(r.p), recs: normRecs(r.recs) };
  });
  return out;
}
// 整个 water section 归一（DEF / UD_DEFAULTS 均为 {rooms:{}}）
function normWater(w) {
  return { rooms: normRooms(w && w.rooms) };
}
// 取某宿舍数据（未拥有 → 默认 {p:4, recs:[]}）
function roomOf(water, rv) {
  const rooms = (water && water.rooms) || {};
  const r = rooms[String(rv || '')];
  return { p: normPersons(r && r.p), recs: normRecs(r && r.recs) };
}
// 每人每月 2 吨 → 宿舍免费额度
function quotaOf(persons) { return RULES.waterFreePP * normPersons(persons); }
function quotaElecOf(persons) { return RULES.elecFreePP * normPersons(persons); }
// 用量 → 水费（保留 2 位，未超定额为 0）
function feeOf(usage, persons) {
  const u = Number(usage);
  if (!isFinite(u)) return 0;
  return round2(Math.max(0, u - quotaOf(persons)) * RULES.water);
}
// 水费 → 折合扣电（保留 1 位）
function degOf(fee) { return round1((Number(fee) || 0) / RULES.elec); }
// 第 i 条相对上一条的用量（首条 / 读数回退 → null）
function usageAt(recs, i) {
  const list = Array.isArray(recs) ? recs : [];
  if (i <= 0 || i >= list.length) return null;
  const d = list[i].r - list[i - 1].r;
  return (isFinite(d) && d >= 0) ? round2(d) : null;
}
// 历史视图（页面直接渲染）：按月倒序；每行 {m,r,usage,fee,deg,over,first}
// 删除任意一条后重新调用即自动重算（用量/水费/折合扣电都随「上一条」变化）。
function buildHistory(recs, persons) {
  const list = normRecs(recs);
  const p = normPersons(persons);
  const quota = quotaOf(p);
  const out = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const usage = usageAt(list, i);
    const fee = usage == null ? 0 : feeOf(usage, p);
    out.push({
      m: list[i].m,
      r: list[i].r,
      ts: list[i].ts,
      usage: usage,
      fee: fee,
      deg: usage == null ? 0 : degOf(fee),
      over: (usage != null && usage > quota) ? round2(usage - quota) : 0,
      first: i === 0
    });
  }
  return out;
}
// 自动对比（最新一条 vs 上一条）：无记录 → {first:true, empty:true}；只有首条 → {first:true, empty:false}
function compareOf(recs, persons) {
  const list = normRecs(recs);
  if (!list.length) return { empty: true, first: true, rec: null };
  const last = list[list.length - 1];
  const prev = list.length >= 2 ? list[list.length - 2] : null;
  if (!prev) {
    return { empty: false, first: true, rec: { m: last.m, r: last.r }, prev: null, usage: null, fee: 0, deg: 0, over: 0 };
  }
  const usage = usageAt(list, list.length - 1);
  if (usage == null) {
    return { empty: false, first: true, rec: { m: last.m, r: last.r }, prev: { m: prev.m, r: prev.r }, usage: null, fee: 0, deg: 0, over: 0 };
  }
  const p = normPersons(persons);
  const fee = feeOf(usage, p);
  return {
    empty: false, first: false,
    rec: { m: last.m, r: last.r }, prev: { m: prev.m, r: prev.r },
    usage: usage, fee: fee, deg: degOf(fee),
    over: usage > quotaOf(p) ? round2(usage - quotaOf(p)) : 0
  };
}
// 保存校验（契约 §3.3）：月份合法、读数有限且 ≥0、不得小于「上一条（更早月份）」读数。
// 同月已存在视为覆盖（允许改高改低，但仍不能低于更早月份）。
// 返回 { ok, reason, recs }：ok=true 时 recs 为写入后的新数组（不改入参）。
function saveRecord(recs, month, reading, persons, ts) {
  const m = normMonth(month);
  if (!m) return { ok: false, reason: '请选择月份' };
  const r = normReading(reading);
  if (r == null) return { ok: false, reason: '请输入有效读数' };
  const list = normRecs(recs);
  const idx = list.findIndex(function (x) { return x.m === m; });
  const before = list.filter(function (x) { return x.m < m; });   // 上一条 = 更早月份里最新的
  const prev = before.length ? before[before.length - 1] : null;
  if (prev && r < prev.r - 1e-9) return { ok: false, reason: '读数不能小于上次记录' };
  const row = { m: m, r: r, ts: Number(ts) || Date.now() };
  const next = list.slice();
  if (idx >= 0) next[idx] = row;
  else next.push(row);
  return { ok: true, reason: '', recs: normRecs(next), rec: row, replaced: idx >= 0 };
}
// 删除某月记录 → 新数组（删除后由页面重新 buildHistory 重算）
function delRecord(recs, month) {
  const m = normMonth(month);
  if (!m) return normRecs(recs);
  return normRecs((Array.isArray(recs) ? recs : []).filter(function (x) { return !x || x.m !== m; }));
}
// 输入即时预览：假设把 (month, reading) 写入后，该条的用量/水费/折合扣电。
// 校验失败返回 { valid:false, reason }；成功 { valid:true, usage, fee, deg, over, prevMonth, replaced }
function previewOf(recs, month, reading, persons, ts) {
  const m = normMonth(month);
  if (!m) return { valid: false, reason: '请选择月份' };
  const r = normReading(reading);
  if (r == null) return { valid: false, reason: '请输入有效读数' };
  const list = normRecs(recs);
  const idx = list.findIndex(function (x) { return x.m === m; });
  const before = list.filter(function (x) { return x.m < m; });   // 上一条 = 更早月份里最新的
  const prev = before.length ? before[before.length - 1] : null;
  const p = normPersons(persons);
  if (prev && r < prev.r - 1e-9) {
    return { valid: false, reason: '读数不能小于上次记录（' + prev.r.toFixed(2) + ' 吨）', prevMonth: prev.m };
  }
  // 只在内存里插入/覆盖后重算（不落盘）
  const sim = list.slice();
  const row = { m: m, r: r, ts: Number(ts) || Date.now() };
  if (idx >= 0) sim[idx] = row; else sim.push(row);
  const sorted = normRecs(sim);
  const i = sorted.findIndex(function (x) { return x.m === m; });
  const usage = usageAt(sorted, i);
  const fee = usage == null ? 0 : feeOf(usage, p);
  return {
    valid: true, reason: '', month: m, r: r, replaced: idx >= 0,
    prevMonth: prev ? prev.m : '', usage: usage, fee: fee,
    deg: usage == null ? 0 : degOf(fee),
    over: (usage != null && usage > quotaOf(p)) ? round2(usage - quotaOf(p)) : 0
  };
}
// 人数切换后再写回 water.rooms[rv]
function withPersons(water, rv, persons) {
  const w = normWater(water);
  const key = String(rv || '');
  if (!key) return w;
  const prev = w.rooms[key] || { p: RULES.personsDef, recs: [] };
  w.rooms[key] = { p: normPersons(persons), recs: prev.recs };
  return w;
}
function withRecs(water, rv, recs) {
  const w = normWater(water);
  const key = String(rv || '');
  if (!key) return w;
  const prev = w.rooms[key] || { p: RULES.personsDef, recs: [] };
  w.rooms[key] = { p: prev.p, recs: normRecs(recs) };
  return w;
}
// ---------------------------------------------------------------- 2026-11-11 云端共享（契约 §1–§4）
// 2026-11-19：取消 23A/23B 固定四人间；所有宿舍均可自选 1–6 人间
function isFixed4(rv) { return false; }
function fixedPersons(rv, persons) { return normPersons(persons); }
// 云端 water 行 [{month,reading,persons,updated_at}] → 本机 recs [{m,r,ts}]（坏行丢弃、按月唯一取 updated_at 较新者）
function cloudRecsOf(rows) {
  return normRecs((Array.isArray(rows) ? rows : []).map(function (x) {
    if (!x || typeof x !== 'object') return null;
    const ts = Date.parse(String(x.updated_at || '')) || 0;
    return { m: normMonth(x.month), r: normReading(x.reading), ts: ts };
  }).filter(Boolean));
}
// 全量读取覆盖共享基线。旧调用方读 missing 时取得空列表。
function mergeCloud(localRecs, cloudRows) {
  const recs = cloudRecsOf(cloudRows);
  const local = normRecs(localRecs);
  const changed = local.length !== recs.length || local.some((r, i) => r.m !== recs[i].m || r.r !== recs[i].r);
  return { recs, missing: [], changed, cloudCount: cloudRows.length };
}
function roomPersonsOf(row) {
  const r = Array.isArray(row) ? row[0] : row;
  const raw = r && r.persons;
  if (typeof raw !== 'number' && !(typeof raw === 'string' && /^[1-6]$/.test(raw))) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 6 ? value : null;
}
function validSharedRow(row, rv) {
  return !!row && row.roomverify === rv && !!normMonth(row.month) && roomPersonsOf(row) !== null &&
    (typeof row.reading === 'number' || (typeof row.reading === 'string' && !!row.reading.trim())) &&
    Number.isFinite(Number(row.reading)) && Number(row.reading) >= 0;
}
// 离线待补发操作归一（store.waterPend）：{op:'put'|'del'|'persons', rv, m?, r?, p?, at}
function normOp(op) {
  if (!op || typeof op !== 'object') return null;
  const rv = String(op.rv == null ? '' : op.rv).trim();
  if (!rv) return null;
  const kind = String(op.op || '');
  if (kind === 'put') {
    const m = normMonth(op.m), r = normReading(op.r);
    if (!m || r == null) return null;
    return { op: 'put', rv: rv, m: m, r: r, p: normPersons(op.p), at: Number(op.at) || Date.now() };
  }
  if (kind === 'del') {
    const m = normMonth(op.m);
    if (!m) return null;
    return { op: 'del', rv: rv, m: m, at: Number(op.at) || Date.now() };
  }
  if (kind === 'persons') {
    return { op: 'persons', rv: rv, p: fixedPersons(rv, op.p), at: Number(op.at) || Date.now() };
  }
  return null;
}
function normOps(list) {
  return (Array.isArray(list) ? list : []).map(normOp).filter(Boolean).slice(-200);
}
// 待补发队列合并（同 key 后写覆盖；key = op|rv|m）
function pushOp(list, op) {
  const o = normOp(op);
  if (!o) return normOps(list);
  const key = o.op + '|' + o.rv + '|' + (o.m || '');
  const out = normOps(list).filter(function (x) { return (x.op + '|' + x.rv + '|' + (x.m || '')) !== key; });
  out.push(o);
  return out.slice(-200);
}
function dropOp(list, op) {
  const key = op.op + '|' + op.rv + '|' + (op.m || '');
  return normOps(list).filter(function (x) { return (x.op + '|' + x.rv + '|' + (x.m || '')) !== key; });
}

// 展示格式
function fmtReading(v) { const n = Number(v); return isFinite(n) ? n.toFixed(2) : '—'; }
function fmtMoney(v) { const n = Number(v); return isFinite(n) ? n.toFixed(2) : '0.00'; }
function fmtDeg(v) { const n = Number(v); return isFinite(n) ? n.toFixed(1) : '0.0'; }
// 规则卡数据（页面规则卡渲染，2026-11-06 用户反馈：电费规则移入电量统计，水量页只留水费规则）
// 文案与网站 WATER.renderRule 同口径（2026-11-11 共享契约 §5：不再出现「免费」字样，统一叫「定额」）：
// 水费单价 / 每人 2 吨水·月定额 / 超出定额×3.03 / 折合扣电÷0.58 / 计费说明
function ruleView(persons) {
  const p = normPersons(persons);
  const quota = quotaOf(p);
  return {
    waterPrice: RULES.water.toFixed(2),
    freePP: RULES.waterFreePP,
    quotaWater: quota,
    freeText: '每人 ' + RULES.waterFreePP + ' 吨水/月（' + p + ' 人间 = ' + quota + ' 吨）',
    formula: '超出定额部分 × ' + RULES.water.toFixed(2) + '（定额 ' + quota + ' 吨）',
    degFormula: '水费 ÷ ' + RULES.elec.toFixed(2) + '（按电价折算；1 吨水 ≈ ' + TON_TO_DEG.toFixed(1) + ' 度）',
    cycle: '无阶梯、无额外加价；定额当月有效、每学年 ' + RULES.cycleMonths + ' 个月、寒暑假无',
    source: '福建中医药大学后勤基建处 2025-09-05 说明 / 学生公寓管理规定（2021）',
    note: '以学校最新通知为准',
    // 人数选择文案（2026-11-19：1–6 人间自选，不再出现每月免费 N 吨水）
    personsOptions: RULES.personsOpts.map(function (x) {
      return { p: x, label: x + ' 人间' };
    }),
    // 兼容字段：固定四人间已取消，页面不再使用
    fixedText: ''
  };
}

module.exports = {
  validSharedRow,
  RULES: RULES, TON_TO_DEG: TON_TO_DEG, REC_CAP: REC_CAP,
  round2: round2, round1: round1, monthOf: monthOf, normMonth: normMonth, shiftMonth: shiftMonth,
  normPersons: normPersons, normReading: normReading, normRecs: normRecs, normRooms: normRooms, normWater: normWater,
  roomOf: roomOf, quotaOf: quotaOf, quotaElecOf: quotaElecOf, feeOf: feeOf, degOf: degOf, usageAt: usageAt,
  buildHistory: buildHistory, compareOf: compareOf, saveRecord: saveRecord, delRecord: delRecord,
  previewOf: previewOf, withPersons: withPersons, withRecs: withRecs,
  fmtReading: fmtReading, fmtMoney: fmtMoney, fmtDeg: fmtDeg, ruleView: ruleView,
  // 云端共享（契约 §1–§4）
  isFixed4: isFixed4, fixedPersons: fixedPersons, cloudRecsOf: cloudRecsOf, mergeCloud: mergeCloud,
  roomPersonsOf: roomPersonsOf, normOp: normOp, normOps: normOps, pushOp: pushOp, dropOp: dropOp
};
