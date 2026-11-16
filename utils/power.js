// utils/power.js —— 宿舍电费「数据仪表盘」纯逻辑（与网站 POWER 模块对齐，v2.0.0 网站功能同步）
//
// 数据来源（小程序直接读 CloudBase，无需云函数；RLS auth_ok）：
//   public.power        按 id=eq.<roomverify> 单行 { id,label,building,room,quantity,unit,low,updated_at }
//   public.power_history 该房间近 24h 采样 { roomverify,quantity,ts }（order=ts.asc，limit=500）
//
// 与网站保持一致的口径（网站 2026-11-06 07:01 定稿 v3）：
//   * 房间目录 PW_ROOMS 17 间、顺序/命名与网站 PW_ROOMS 一致（增删宿舍两端同改）；
//   * 状态（v5 可调低电阈值 low，默认 30）：q<low 低电(low) / low≤q<low*2 偏低(warn) / 其余充足(ok)；
//     低电阈值档位 LOW_OPTIONS=[10,20,30,40,50,60,80,100]（无 70/90），随 UD.power.low 同步；
//   * 估算可用（v5）：24h/7d 分段统计（跳过充值跳变段）→ rate 0.65*r24+0.35*r7（仅一档有效用该档），
//     rate 下限 0.05，days=q/rate；tile1/环/低电条全用 estimate（非旧 derive days）；
//   * 4 个指标 tile：估算可用（≈rate 度/天）/ 区间用电 / 低电阈值（可点改）/ 上次充值；
//   * 电量环 = 估算可用天数 / 30（有效估算时至少 0.02、最大 1；无有效估算 0.04 小段），不是当前电量比例；
//   * 趋势图例：起点 X 度 · 当前 Y 度 · 近 24h 下降 Z 度；低电条：剩 X 度 · 约 Y 天；
//   * 未选择宿舍 → 页面 0 请求；选择存 userdata v6 的 power section（真源），本机兜底键只用于离线恢复。
// 纯函数（无 wx 依赖）便于 Node 单测。
const waterUtil = require('./water.js');   // 计费常量唯一来源（RULES: 电 0.58 / 水 3.03 / 免费 5 度+2 吨）
const LOW = 30;          // 默认低电阈值（用户可在 [10,20,30,40,50,60,80,100] 调整）
const LOW_OPTIONS = [10, 20, 30, 40, 50, 60, 80, 100];
const ARC_DAYS = 30;     // 电量环参考：估算可用 30 天 = 满环（与网站 arcs = days/30 一致）
const ARC_MIN = 0.02;    // 有有效估算时的最小可见弧
const ARC_FALLBACK = 0.04; // 无有效估算时的小段兜底弧（网站同口径）
function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }
// 中位数（空 → 0）；用于「正常单段用电」基线
function medianOf(list) {
  const a = (list || []).filter(function (v) { return isFinite(v); }).slice().sort(function (x, y) { return x - y; });
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
// 异常扣减识别（与网站同口径，契约 §4.2 核心）：
//   U = 窗口内正常单段用电（dq>0.05）中位数；候选 = dq > max(5, 4×U)（含充值后短时大跌/水费扣除）。
//   返回 {n,deg,yuan,waterN,thr,U}；mp 无水量匹配时 waterN=0（界面标「异常扣减」）。
function deductOf(pts) {
  const list = (pts || []).filter(function (p) { return p && p.q != null && isFinite(p.q); });
  const ups = [];
  for (let i = 1; i < list.length; i++) {
    const dq = list[i - 1].q - list[i].q;
    if (dq > 0.05) ups.push(dq);
  }
  const U = medianOf(ups);
  const thr = Math.max(5, 4 * U);
  let n = 0, deg = 0;
  for (let i = 1; i < list.length; i++) {
    const dq = list[i - 1].q - list[i].q;
    if (dq > 0.05 && dq > thr) { n += 1; deg += dq; }
  }
  return { n: n, deg: round2(deg), yuan: round2(deg * waterUtil.RULES.elec), waterN: 0, thr: round2(thr), U: round2(U) };
}
// 电量统计「计费规则」条数据（与网站 #pwBill 同文案/同口径）：
//   电价 / 区间电费≈¥ / 免费 5 度电·人·月（按人数）/ 水费 3.03 元/吨从电费账户扣（1 吨≈5.2 度）/ 已忽略扣减摘要
function billOf(dRange, persons) {
  const p = Number(persons) === 6 ? 6 : waterUtil.RULES.personsDef;
  const R = waterUtil.RULES;
  const drop = (dRange && dRange.drop != null && isFinite(dRange.drop) && dRange.drop > 0) ? dRange.drop : null;
  const fee = drop == null ? null : round2(drop * R.elec);
  const ddn = Number((dRange && dRange.deductN) || 0);
  const dedYuan = round2((dRange && dRange.deductYuan) || 0);
  const dedDeg = round2((dRange && dRange.deductDeg) || 0);
  return {
    persons: p,
    elecText: R.elec.toFixed(2) + ' 元/度',
    feeText: fee == null ? '—' : ('≈ ¥' + fee.toFixed(2)),
    freeText: R.elecFreePP + ' 度电/人/月（' + p + ' 人间 = ' + (R.elecFreePP * p) + ' 度）',
    waterText: R.water.toFixed(2) + ' 元/吨从电费账户扣 · 1 吨≈' + (R.water / R.elec).toFixed(1) + ' 度',
    hasDed: ddn > 0,
    dedText: ddn > 0
      ? ('已忽略 ' + ddn + ' 次' + (Number(dRange.deductWaterN) === ddn ? '水费扣除' : '异常扣减') +
        ' · ' + dedYuan.toFixed(2) + ' 元 ≈ ' + dedDeg.toFixed(1) + ' 度')
      : ''
  };
}
function normLow(v) {
  const n = Number(v);
  if (!isFinite(n) || n < 10 || n > 100) return LOW;
  const r = Math.round(n / 10) * 10;
  let best = LOW_OPTIONS[0];
  let bd = 1e9;
  LOW_OPTIONS.forEach(function (x) { const dd = Math.abs(x - r); if (dd < bd) { bd = dd; best = x; } });
  return best;
}

const BLDS = ['13号楼', '16号楼', '23号楼A座', '23号楼B座'];

// 与网站 PW_ROOMS / briefdesk sync_power_cloud.py 的 ROOMS 一致（17 间，规范化命名）
const ROOMS = [
  { rv: '1-13---324', label: '13号楼324', building: '13号楼', room: '324' },
  { rv: '1-13---308', label: '13号楼308', building: '13号楼', room: '308' },
  { rv: '1-16---305', label: '16号楼305', building: '16号楼', room: '305' },
  { rv: '1-16---306', label: '16号楼306', building: '16号楼', room: '306' },
  { rv: '4-23A---321', label: '23号楼A座321', building: '23号楼A座', room: '321' },
  { rv: '4-23A---323', label: '23号楼A座323', building: '23号楼A座', room: '323' },
  { rv: '4-23A---324', label: '23号楼A座324', building: '23号楼A座', room: '324' },
  { rv: '4-23A---325', label: '23号楼A座325', building: '23号楼A座', room: '325' },
  { rv: '4-23A---326', label: '23号楼A座326', building: '23号楼A座', room: '326' },
  { rv: '4-23A---327', label: '23号楼A座327', building: '23号楼A座', room: '327' },
  { rv: '4-23A---328', label: '23号楼A座328', building: '23号楼A座', room: '328' },
  { rv: '4-23A---329', label: '23号楼A座329', building: '23号楼A座', room: '329' },
  { rv: '4-23A---330', label: '23号楼A座330', building: '23号楼A座', room: '330' },
  { rv: '4-23B---422', label: '23号楼B座422', building: '23号楼B座', room: '422' },
  { rv: '4-23B---423', label: '23号楼B座423', building: '23号楼B座', room: '423' },
  { rv: '4-23B---424', label: '23号楼B座424', building: '23号楼B座', room: '424' },
  { rv: '4-23B---425', label: '23号楼B座425', building: '23号楼B座', room: '425' }
];

const _byRv = {};
ROOMS.forEach(function (r) { _byRv[r.rv] = r; });

function catOf(rv) { return _byRv[String(rv || '')] || null; }
// 非法/未知 roomverify → ''（页面按未选择处理，避免展示脏数据）
function normalizeSel(v) {
  const rv = String(v == null ? '' : v);
  return _byRv[rv] ? rv : '';
}
function labelOf(rv) { const c = catOf(rv); return c ? c.label : ''; }

// 自定义底部弹层（宿舍选择）用纯数据：某栋楼的房间列表（保持目录顺序）/ 楼栋 + 房间 → roomverify
function roomsOfBuilding(b) {
  const building = String(b || '');
  return ROOMS.filter(function (r) { return r.building === building; }).map(function (r) {
    return { rv: r.rv, room: r.room, label: r.label };
  });
}
function buildingOf(rv) { const c = catOf(rv); return c ? c.building : ''; }
function rvOf(b, room) {
  const c = roomsOfBuilding(b).filter(function (r) { return r.room === String(room || ''); })[0];
  return c ? c.rv : '';
}

// 归一云端 power 行；quantity 非法 → q=null（页面显示 —）
function normalizeRow(row) {
  if (!row) return null;
  const q = Number(row.quantity);
  const ok = isFinite(q);
  return {
    id: String(row.id || ''),
    label: String(row.label || ''),
    building: String(row.building || ''),
    room: String(row.room || ''),
    q: ok ? q : null,
    unit: String(row.unit || '度'),
    low: !!row.low || (ok && q < LOW),
    upd: String(row.updated_at || '')
  };
}

// 归一近 24h 采样：只保留 quantity/ts 合法的点，按时间升序
function normalizeHistory(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach(function (r) {
    const q = Number(r && r.quantity);
    const t = Date.parse((r && r.ts) || '');
    if (isFinite(q) && isFinite(t)) out.push({ q: q, t: t });
  });
  out.sort(function (a, b) { return a.t - b.t; });
  return out;
}

// v5 状态判定：q<low 低电 / low≤q<low*2 偏低 / 其余充足（不再使用云端 low 字段）
function stateOf(row, low) {
  if (!row || row.q == null) return 'idle';
  const l = normLow(low);
  if (row.q < l) return 'low';
  if (row.q < l * 2) return 'warn';
  return 'ok';
}
function stateText(st) { return st === 'low' ? '低电' : st === 'warn' ? '偏低' : st === 'ok' ? '充足' : '未选择'; }
function fmtQ(q) {
  if (q == null || !isFinite(q)) return '—';
  return (Math.round(q * 100) / 100).toFixed(2);
}
// 大号电量（网站 fmtMain 同口径：≥100 取整，否则 1 位小数）
function fmtMain(q) {
  if (q == null || !isFinite(q)) return '—';
  return q >= 100 ? String(Math.round(q)) : q.toFixed(1);
}
// 趋势图例/下降量（网站 fmtDrop 同口径：2 位小数）
function fmtDrop(v) { return (v == null || !isFinite(v)) ? '—' : v.toFixed(2); }
function updText(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = function (n) { return (n < 10 ? '0' : '') + n; };
  return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
// 电量环比例 = 网站 arcs：estimate 可用天数/30（valid 时至少 0.02、最大 1；无有效估算 0.04 小段；未选择/无行 0）
function ringArc(row, est) {
  if (!row) return 0;
  if (est && est.valid && est.days != null && isFinite(est.days)) {
    return Math.max(ARC_MIN, Math.min(1, est.days / ARC_DAYS));
  }
  return ARC_FALLBACK;
}

// 趋势区间（与网站 v3.1 PW_RANGES 逐项一致）：24h / 7天 / 30天
const RANGES = [
  { k: '24h', label: '24h', ms: 24 * 3600e3, title: '近 24h 趋势', tile: '近 24h 用电', dropLabel: '近 24h 下降', gap: 0, xN: 3 },
  { k: '7d', label: '7天', ms: 7 * 24 * 3600e3, title: '近 7 天趋势', tile: '近 7 天用电', dropLabel: '区间下降', gap: 16, xN: 4 },
  { k: '30d', label: '30天', ms: 30 * 24 * 3600e3, title: '近 30 天趋势', tile: '近 30 天用电', dropLabel: '区间下降', gap: 9, xN: 5 }
];
const _rangeMap = {};
RANGES.forEach(function (r) { _rangeMap[r.k] = r; });
function rangeMeta(k) { return _rangeMap[k] || RANGES[0]; }
function rangeKeys() { return RANGES.map(function (r) { return r.k; }); }

/* ---------------- 2026-11-11 增量 43（与网页增量 42 同口径） ----------------
 * ① 13/16 号楼隐藏 24h 档（showRange/rangesOfBuilding/normRangeForBuilding；内部 24h 数据仍拉取，仅用于日更检测/估算）；
 * ② 电费比较改「自然周期同期」：24h→较昨日同期、7d→较上周同期、30d→较上月同期；
 *    比较所需更长窗口（隐藏取数窗口，不进 RANGES）：24h→7d、7d(实时)→14d、7d(慢频)→30d、30d→70d；
 *    两周期采样覆盖均≥窗口 35% 才显示（历史不足不硬凑）；当前周期用电用窗口内真实采样下降累计（不插值）。
 */
const CMP_LABEL = { '24h': '较昨日同期', '7d': '较上周同期', '30d': '较上月同期' };
const CMP_TITLE = {
  '24h': '今日 00:00 至现在 对比 昨日同一时段',
  '7d': '本周一至现在 对比 上周同一时段',
  '30d': '本月 1 日至现在 对比 上月同期'
};
// 楼栋是否提供该档位：13/16 号楼不提供 24h
function showRange(building, k) { return !(isSlowBuilding(building) && String(k) === '24h'); }
function rangesOfBuilding(building) {
  return RANGES.filter(function (r) { return showRange(building, r.k); }).map(function (r) { return { k: r.k, label: r.label }; });
}
function normRangeForBuilding(building, k) {
  k = rangeMeta(k).k;
  return showRange(building, k) ? k : '7d';
}
// 当前档位对应的比较取数窗口（slowRoom=数据判定的慢频口径；7d 慢频用已预取的 30d，实时用 14d）
function cmpSourceKey(range, slowRoom) {
  range = rangeMeta(range).k;
  if (range === '24h') return '7d';
  if (range === '7d') return slowRoom ? '30d' : '14d';
  if (range === '30d') return '70d';
  return null;
}
function dayStartMs(ts) { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
function weekStartMs(ts) {
  const d = new Date(dayStartMs(ts));
  const wd = (d.getDay() + 6) % 7;                 // 周一为一周起点
  return dayStartMs(ts) - wd * 86400000;
}
function monthStartMs(ts) { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
function shiftMonthMs(ts, delta) {
  const d = new Date(ts);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, dim));
  return d.getTime();
}
// 自然周期窗口：{ cur:[start,end], prev:[start,end] }
function naturalWindows(range, nowMs) {
  const now = Number(nowMs) || Date.now();
  range = rangeMeta(range).k;
  if (range === '24h') {
    const cs = dayStartMs(now);
    return { cur: [cs, now], prev: [dayStartMs(now - 86400000), now - 86400000] };
  }
  if (range === '7d') {
    return { cur: [weekStartMs(now), now], prev: [weekStartMs(now - 7 * 86400000), now - 7 * 86400000] };
  }
  const ms = monthStartMs(now);
  return { cur: [ms, now], prev: [shiftMonthMs(ms, -1), shiftMonthMs(now, -1)] };
}
function ptsBetween(hist, start, end) {
  const out = [];
  (Array.isArray(hist) ? hist : []).forEach(function (p) {
    if (p && isFinite(p.t) && p.t >= start && p.t <= end) out.push(p);
  });
  return out;
}
function cmpCoverage(sub, start, end) {
  if (!sub || sub.length < 2) return false;
  const dur = Math.max(1, end - start);
  return (sub[sub.length - 1].t - sub[0].t) >= dur * 0.35;   // 历史残缺（如只积累几天）时不硬凑上一周期
}
// 自然周期同期比较：hist 为比较取数窗口（7d/14d/30d/70d）的采样；返回 {pct,label,title,cur,prev} 或 null
function naturalCompare(range, hist, nowMs) {
  try {
    range = rangeMeta(range).k;
    const src = (Array.isArray(hist) ? hist : []).filter(function (p) { return p && isFinite(p.t) && isFinite(p.q); });
    if (src.length < 2) return null;
    const w = naturalWindows(range, nowMs);
    const curPts = ptsBetween(src, w.cur[0], w.cur[1]);
    const prevPts = ptsBetween(src, w.prev[0], w.prev[1]);
    if (!cmpCoverage(curPts, w.cur[0], w.cur[1])) return null;
    if (!cmpCoverage(prevPts, w.prev[0], w.prev[1])) return null;
    const cur = deriveRange(curPts, null);
    const prev = deriveRange(prevPts, null);
    if (!(cur.drop > 0.01) || !(prev.drop > 0.01)) return null;
    const pct = (cur.drop - prev.drop) / prev.drop * 100;
    if (!isFinite(pct)) return null;
    return { pct: pct, cur: cur.drop, prev: prev.drop, label: CMP_LABEL[range] || '较同期', title: CMP_TITLE[range] || '' };
  } catch (e) { return null; }
}

// 由所选区间采样估算（与网站 deriveRange 同公式）：累计下降（忽略充值上升）、窗口小时、日均、可用天数、
// 充值事件（recharge / lastUp={t,reset,delta}）；days 用当前 row.q（低电条/环始终用 24h 的 deriveRange）。
// 数据不足 = <2 采样点 或 窗口 <6h（valid=false）；days>999 截 999。
function deriveRange(pts, row) {
  const list = (pts || []).filter(function (p) { return p && p.q != null && isFinite(p.q); });
  const cur = row ? row.q : null;
  const ded = deductOf(list);
  const d = {
    n: list.length, start: null, end: null, drop: null, hours: 0, perDay: null, days: null,
    interval: null, recharge: false, lastUp: null, valid: false,
    // 异常扣减（水费扣除/充值后短时大跌，网站同口径）：不计入区间用电/电费
    deductN: ded.n, deductDeg: ded.deg, deductYuan: ded.yuan, deductWaterN: ded.waterN
  };
  if (!list.length) return d;
  d.start = list[0].q;
  d.end = list[list.length - 1].q;
  if (list.length >= 2) {
    d.hours = (list[list.length - 1].t - list[0].t) / 3600000;
    let drop = 0;
    for (let i = 1; i < list.length; i++) {
      const diff = list[i].q - list[i - 1].q;
      if (diff < -0.005) {
        const dq = -diff;
        if (dq > ded.thr) continue;       // 异常扣减段：不计入用电（仍保留 recharge/lastUp 语义）
        drop += dq;
      }
      if (diff > 0.05) {                  // 充值/重置：标记并记录最后一次
        d.recharge = true;
        d.lastUp = { t: list[i].t, reset: list[i].q, delta: Math.round(diff * 100) / 100 };
      }
    }
    d.drop = Math.round(drop * 100) / 100;
    d.interval = d.hours > 0 ? (d.hours / (list.length - 1)) : null;
    if (d.hours > 0.15 && d.drop > 0.005) {
      d.perDay = d.drop / d.hours * 24;
      if (cur != null && d.perDay > 0.01) d.days = cur / d.perDay;
    }
  }
  d.valid = !!(list.length >= 2 && d.hours >= 6 && d.days != null && isFinite(d.days) && d.days > 0);
  if (d.valid && d.days > 999) d.days = 999;
  return d;
}
// 曲线查看：按 x 比例（0–1，真实时间比例）找最近的真实采样点
function nearestPoint(points, frac) {
  const pts = Array.isArray(points) ? points : [];
  if (pts.length < 2) return null;
  const f = Math.max(0, Math.min(1, Number(frac) || 0));
  let best = 0, bd = 1e18;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.abs(pts[i].x - f);
    if (d < bd) { bd = d; best = i; }
  }
  return { index: best, point: pts[best] };
}
// 游标时间：24h HH:MM；7d/30d MM-DD HH:MM（与网页查看口径一致）
function cursorLabel(t, range) {
  const d = new Date(Number(t) || 0);
  const p = function (n) { return (n < 10 ? '0' : '') + n; };
  if (range === '24h') return p(d.getHours()) + ':' + p(d.getMinutes());
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
// 曲线查看气泡定位（纯函数，与网页 POWER.placeTip 同口径 + 边界 clamp）：
//   x/y = 命中采样点在绘图区内的实际像素（y 为曲线点，不是 50% 高度）；
//   cw/plotH = 绘图区宽/高（px）；tipW/tipH = 气泡实测宽/高；pad = 边距（默认 6）。
//   水平：气泡盒（宽 tipW）整体 clamp 在 [pad, cw-pad]，left 返回气泡中心（WXML translate(-50%,...)）；
//         窄容器时气泡宽按可用宽截断，left = 容器中心。
//   垂直：默认在点上方（below=false，锚点 top=y-8，WXML translate(-50%,-100%) → 气泡占 [top-tipH, top]）；
//         上方放不下（y-8-tipH < pad）→ 翻到下方（below=true，锚点 top=y+10，气泡占 [top, top+tipH]），
//         下方再按 [pad, plotH-pad-tipH] clamp；入参非法/容器过小时返回有限安全值，绝不返回 NaN/抛错。
// 游标气泡首帧估宽（未实测前用；避免拖动/点按瞬间气泡越界被裁切）：
// 22rpx 字号下 1 个字符约 11px，左右 padding 14rpx + 圆角留白；返回有限正整数，永不 NaN。
function estimateCursorTipSize(text) {
  const s = String(text == null ? '' : text);
  const units = Math.max(1, s.length);
  const w = Math.min(280, Math.max(56, Math.round(units * 10.8 + 20)));
  return { w: w, h: 24 };
}

function cursorTipLayout(x, y, cw, plotH, tipW, tipH, pad) {
  const n = function (v, d) { const q = Number(v); return isFinite(q) ? q : d; };
  const W = Math.max(1, n(cw, 1));
  const H = Math.max(1, n(plotH, 1));
  const tw = Math.max(0, n(tipW, 0));
  const th = Math.max(0, n(tipH, 0));
  let pd = n(pad, 6);
  if (!(pd >= 0)) pd = 6;
  if (pd * 2 > W) pd = Math.max(0, W / 2 - 1);
  if (pd * 2 > H) pd = Math.max(0, H / 2 - 1);
  const cx = n(x, W / 2);
  const cy = n(y, H / 2);
  // 水平：气泡盒完整落在 [pd, W-pd]
  const availW = Math.max(0, W - pd * 2);
  const boxW = Math.min(tw, availW);
  let left;
  if (availW <= 0) left = W / 2;
  else left = Math.max(pd + boxW / 2, Math.min(W - pd - boxW / 2, cx));
  if (!isFinite(left)) left = W / 2;
  // 垂直：默认点上方；上方放不下 → 翻到下方并 clamp
  const availH = Math.max(0, H - pd * 2);
  let below = false;
  let top;
  if (th > availH || cy - (th + pd) < 0) {
    below = true;
    top = cy + 10;
    if (th > availH) top = pd;                       // 容器比气泡还矮：贴顶（安全值，不越界崩布局）
    else top = Math.max(pd, Math.min(H - pd - th, top));
  } else {
    top = Math.max(pd + th, Math.min(H - pd, cy - 8));
  }
  if (!isFinite(top)) top = pd;
  return { left: left, top: top, below: below };
}

// 兼容旧调用：derive(row, hist) = deriveRange(hist, row)
function derive(row, hist) { return deriveRange(hist, row); }

// ---- v5 估算可用天数：24h/7d 分段统计（跳过充值跳变段，0.65/0.35 混合，rate 下限 0.05） ----
// rateFrom(pts)：逐点差分 dq=q[i-1]-q[i]、dt=(t[i]-t[i-1])/h（dt>0 才计）：
//   dq>0.05 正常用电 used+=dq/hours+=dt；dq<-0.05 充值跳变整段跳过（仅 recharge=true）；|dq|≤0.05 持平只计时长。
//   返回 { rate: used/hours*24（hours>0 否则 null）, used, hours, span, n, recharge }
function rateFrom(pts) {
  const r = { rate: null, used: 0, hours: 0, span: 0, n: pts ? pts.length : 0, recharge: false, deductN: 0 };
  if (!pts || pts.length < 2) return r;
  const ded = deductOf(pts);
  r.deductN = ded.n;
  let used = 0, hours = 0;
  for (let i = 1; i < pts.length; i++) {
    const dt = (pts[i].t - pts[i - 1].t) / 3600000;
    if (!(dt > 0)) continue;
    const dq = pts[i - 1].q - pts[i].q;
    if (dq > 0.05 && dq <= ded.thr) { used += dq; hours += dt; }   // 正常用电（异常扣减段跳过）
    else if (dq < -0.05) { r.recharge = true; }                   // 充值跳变：不计用电也不计时长
    else { hours += dt; }                                         // 持平/异常扣减：计时长、0 用电
  }
  r.used = used;
  r.hours = hours;
  r.span = (pts[pts.length - 1].t - pts[0].t) / 3600000;
  if (hours > 0) r.rate = used / hours * 24;
  return r;
}
// estimate(pts24, pts7, row)：v24/v7 需 n≥2 & span≥6 & rate 有限 & 窗口真实用电 >0.05（§1.4 守卫）；
// 两者有效 rate=0.65*r24+0.35*r7，仅一档有效用该档；两档都无效 → valid=false（「数据积累中」，不再用 0.05 下限伪造天数）；
// 有效时才应用 rate=max(rate,0.05) 下限；days=row.q/rate；valid=rate 有效且 days≥0。
function estimate(pts24, pts7, row) {
  const r24 = rateFrom(pts24);
  const r7 = rateFrom(pts7);
  const v24 = !!(r24.n >= 2 && r24.span >= 6 && r24.rate != null && isFinite(r24.rate) && r24.used > 0.05);
  const v7 = !!(r7.n >= 2 && r7.span >= 6 && r7.rate != null && isFinite(r7.rate) && r7.used > 0.05);
  let rate = null;
  if (v24 && v7) rate = 0.65 * r24.rate + 0.35 * r7.rate;
  else if (v24) rate = r24.rate;
  else if (v7) rate = r7.rate;
  if (rate != null) {
    if (!isFinite(rate) || rate < 0) rate = 0;
    rate = Math.max(rate, 0.05);      // 下限只作用于「有效」结果（v24/v7 已保证真实用电 >0.05）
  }
  const q = (row && row.q != null) ? row.q : null;
  const days = (rate != null && q != null) ? q / rate : null;
  const valid = !!(rate != null && days != null && isFinite(days) && days >= 0);
  // 与网页 POWER.estimate 同键（slow/ref 在实时口径恒 false，页面统一读取）
  return { valid: valid, rate: rate, days: days, q: q, v24: v24, v7: v7, r24: r24, r7: r7, slow: false, ref: false };
}
function daysMain(est) { return (est && est.valid) ? (est.days >= 30 ? '≥30' : est.days.toFixed(1)) : '—'; }
function daysText(est) {
  if (!est || !est.valid) return '数据积累中';
  return est.days >= 30 ? '≥30 天' : ('≈ ' + est.days.toFixed(1) + ' 天');
}
// v9（用户第 9 条）：网关日更 → 24h history 数值变化次数 ≤2 视为「更新较慢」（实时房徽标沿用此规则）。
// 相邻点 |dq|>0.005 计一次；lastAt = 最后一次变化的后一个采样时间；无变化文案「数据未更新」。
// v13（规格 §1.1/§4）：补 lastChange（=最后一处真实变化采样时间，供 hero 更新时间）与
//   lastRecharge（最后一个电量上升事件 {t,reset}，供「上次充值」tile）；原有字段/文案不变。
const SLOW_DIFF = 0.005;
function slowUpdate(hist24) {
  const list = (hist24 || []).filter(function (p) { return p && p.q != null && isFinite(p.q) && isFinite(p.t); });
  const out = { changes: 0, slow: false, lastAt: null, text: '', lastChange: null, lastRecharge: null };
  if (list.length < 2) return out;
  for (let i = 1; i < list.length; i++) {
    if (Math.abs(list[i].q - list[i - 1].q) > SLOW_DIFF) {
      out.changes++;
      out.lastAt = list[i].t;
      out.lastChange = list[i].t;
    }
    if (list[i - 1].q - list[i].q < -0.05) out.lastRecharge = { t: list[i].t, reset: list[i].q };
  }
  out.slow = out.changes <= 2;
  if (out.slow) {
    out.text = out.lastAt != null
      ? ('数据更新较慢 · 上次变化 ' + updText(new Date(out.lastAt).toISOString()))
      : '数据未更新';
  }
  return out;
}

// ---- v13（2026-11-07，规格 web/tools/tests/power_cadence_spec.md §1）：13/16 号楼「网关日更」慢频统计 ----
// 真实数据依据（2026-11-07 探测）：13/16 号楼 47h 内仅 1 次变化（批量日更），23A/23B 每小时变化（准实时）。
// 慢频房按「真实变化点」计算可用天数/日用量（不再被 24h 无变化摊平/伪造 ≥30 天）；23A/23B 保持现口径。
// 常量/函数名/字段与网页 POWER 模块同名（端点一致性，web 测试与 mp 单测按同一规格断言）。
const CH = 0.005;                       // 数值变化阈值（与 slowUpdate 的 SLOW_DIFF 一致）
const MIN_SEG_H = 6;                    // 有效用电段最短 6 小时（过滤同批抖动/短时修正）
const EXPECT_H = 24;                    // 13/16 号楼预期更新周期（小时）；仅「只有 1 段观测」时折算
const SLOW_BUILDINGS = ['13号楼', '16号楼'];  // 楼栋级慢频配置（产品知识；23A/23B 不在内）
const SLOW_COVER_CHANGES = 6;           // §1.3 数据覆盖：24h 变化 ≥6 次 → 网关已提速，按实时口径
function isSlowBuilding(b) { return SLOW_BUILDINGS.indexOf(String(b == null ? '' : b)) >= 0; }
// 采样清洗：只留 {q,t} 合法点并按 t 升序（不插值、不改采样）
function cleanPts(pts) {
  const out = [];
  (Array.isArray(pts) ? pts : []).forEach(function (p) {
    if (!p || p.q == null || !isFinite(p.q) || !isFinite(p.t)) return;
    out.push({ q: Number(p.q), t: Number(p.t) });
  });
  out.sort(function (a, b) { return a.t - b.t; });
  return out;
}
// §1.1 changesIn(pts)：窗口内 |相邻 Δq| > CH 的次数（24h 覆盖判定 / 无更新提示用）
function changesIn(pts) {
  const list = cleanPts(pts);
  let n = 0;
  for (let i = 1; i < list.length; i++) if (Math.abs(list[i].q - list[i - 1].q) > CH) n += 1;
  return n;
}
// §1.1 真实变化点序列：从首点开始，保留与「上一个保留点」|Δq|>CH 的点（首点为起点，不要求变化）
function eventsOf(pts) {
  const list = cleanPts(pts);
  const ev = [];
  if (!list.length) return ev;
  ev.push(list[0]);
  for (let i = 1; i < list.length; i++) {
    if (Math.abs(list[i].q - ev[ev.length - 1].q) > CH) ev.push(list[i]);
  }
  return ev;
}
// §1.2 slowStats(hist30, row)：按相邻变化点分段统计 → {valid,rate,days,ref,nSeg,events,changes,lastChange,lastRecharge}
//   dq>0.05 且 dtH>=MIN_SEG_H → 候选用电段；dq<-0.05 → 充值/修正跳过；
//   异常扣减剔除：base=候选段 drop 中位数，thr=max(5,4*base)，drop>thr 剔除（与 deductOf 同思路；mp 无水量匹配，允许差异）；
//   1 段：dtH<EXPECT_H*1.5 → drop/EXPECT_H*24（单个预期更新周期，ref=true）；否则按观测间隔（ref=true）；
//   ≥2 段：Σdrop/ΣdtH*24（ref=false）；0 段 → valid=false（「数据积累中」）。
function slowStats(hist30, row) {
  const q = (row && row.q != null && isFinite(row.q)) ? Number(row.q) : null;
  const ev = eventsOf(hist30);
  // 字段与网页 POWER.slowStats 完全同名同义（events = 变化点个数，与 web 一致）
  const out = {
    valid: false, rate: null, days: null, ref: false, nSeg: 0,
    events: ev.length, changes: changesIn(hist30), lastChange: null, lastRecharge: null
  };
  if (ev.length >= 2) out.lastChange = ev[ev.length - 1].t;
  const cand = [];
  for (let i = 1; i < ev.length; i++) {
    const dq = ev[i - 1].q - ev[i].q;
    const dtH = (ev[i].t - ev[i - 1].t) / 3600000;
    if (ev[i - 1].q - ev[i].q < -0.05) {                     // 电量上升：充值/修正
      out.lastRecharge = { t: ev[i].t, reset: ev[i].q };
      continue;
    }
    if (dq > 0.05 && dtH >= MIN_SEG_H) cand.push({ drop: dq, hours: dtH });
  }
  const base = medianOf(cand.map(function (s) { return s.drop; }));
  const thr = Math.max(5, 4 * base);
  const segs = cand.filter(function (s) { return s.drop <= thr; });
  out.nSeg = segs.length;
  let rate = null, ref = false;
  if (segs.length === 1) {
    const s = segs[0];
    rate = (s.hours < EXPECT_H * 1.5) ? (s.drop / EXPECT_H * 24) : (s.drop / s.hours * 24);
    ref = true;
  } else if (segs.length >= 2) {
    let drop = 0, hours = 0;
    segs.forEach(function (s) { drop += s.drop; hours += s.hours; });
    if (hours > 0) rate = drop / hours * 24;
  }
  if (rate != null && isFinite(rate) && rate > 0) {
    out.rate = rate;
    if (q != null) out.days = q / rate;
    out.valid = out.days != null && isFinite(out.days);
    out.ref = out.valid && ref;
  }
  return out;
}
// §1.5 慢频估算（与 estimate 返回同口径 + slow 标记）：面板按 isSlowRoom 选择 estimateSlow / estimate
function estimateSlow(hist30, row) {
  const s = slowStats(hist30, row);
  return {
    valid: s.valid, rate: s.rate, days: s.days, q: (row && row.q != null && isFinite(row.q)) ? Number(row.q) : null,
    slow: true, ref: !!s.ref, nSeg: s.nSeg, changes: s.changes,
    lastChange: s.lastChange, lastRecharge: s.lastRecharge,
    v24: false, v7: false, r24: null, r7: null
  };
}
// §1.3 慢频判定：楼栋在 SLOW_BUILDINGS 且 24h 变化 <6 次（数据覆盖：未来网关提速自动降级为实时口径）
function isSlowRoom(rv, pts24) {
  if (!isSlowBuilding(buildingOf(rv))) return false;
  if (changesIn(pts24) >= SLOW_COVER_CHANGES) return false;
  return true;
}
// §3 慢频图：所选区间内变化次数为 0 → 无更新提示文案（24h/7d/30d）；否则 ''（不显示）
function noUpdateText(range, pts) {
  if (changesIn(pts) > 0) return '';
  const k = rangeMeta(range).k;
  return k === '24h' ? '近 24h 无更新' : (k === '7d' ? '近 7 天无更新' : '近 30 天无更新');
}
// §3 慢频阶梯线路径（先水平后垂直，H/V）：输入 trendLine points（x/y∈[0,1]），输出折线路径（含起点）
function stepSegments(points) {
  const pts = (Array.isArray(points) ? points : []).filter(function (p) { return p && isFinite(p.x) && isFinite(p.y); });
  const out = [];
  if (!pts.length) return out;
  out.push({ x: pts[0].x, y: pts[0].y });
  for (let i = 1; i < pts.length; i++) {
    out.push({ x: pts[i].x, y: pts[i - 1].y });      // 水平：保持旧值到新点时间
    out.push({ x: pts[i].x, y: pts[i].y });          // 垂直：跳变到新值
  }
  return out;
}
// §3 慢频真实变化点（相邻 |Δq|>CH 的后一个采样；最多 60 个，超出取最近 60 个）
function changeDots(points) {
  const pts = (Array.isArray(points) ? points : []).filter(function (p) { return p && isFinite(p.x) && isFinite(p.y); });
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    if (Math.abs(pts[i].q - pts[i - 1].q) > CH) out.push({ x: pts[i].x, y: pts[i].y, q: pts[i].q, t: pts[i].t });
  }
  return out.length > 60 ? out.slice(out.length - 60) : out;
}

// 4 个指标 tile（网站 v5）：①估算可用（daysMain + ≈rate 度/天） ②区间用电 ③低电阈值（可点改） ④上次充值
// v13（规格 §3）：慢频房（est.slow）①「参考」只按 est.ref（且 valid）显示；②该区间无下降 → sub「该区间无更新」；
//   ④用 30d lastRecharge（与切档无关）；实时房保持原有规则（①参考=24h 慢更新标记；④区间 lastUp）。
function tilesOf(row, est, dRange, meta, low, slow, cmp) {
  const m = meta || RANGES[0];
  const dR = dRange || null;
  const has = !!row;
  const l = normLow(low);
  const isSlow = !!(est && est.slow);
  const days = (has && est) ? daysMain(est) : '—';
  const sub = (has && est && est.valid) ? ('≈ ' + est.rate.toFixed(1) + ' 度/天') : '';
  const hasDrop = !!(has && dR && dR.drop != null && dR.drop > 0);
  const use = hasDrop ? dR.drop.toFixed(1) : '—';
  const useSub = (isSlow && !hasDrop && dR) ? '该区间无更新' : '';
  // 增量 43 / 2026-11-15（对齐网页 OPTIM V2 #5 与安卓 v4.55）：自然周期同期比较改为**独立一行**，
  // 不再拼进 tile 副标（单行 nowrap + ellipsis 会截断「较昨日/上周/上月同期」）。
  // 仅当前区间有真实下降且同期可算（覆盖不足时 naturalCompare 返回 null）才显示；pct>=0 视为用电变多。
  let cmpText = '';
  let cmpUp = false;
  if (hasDrop && cmp && cmp.pct != null && isFinite(cmp.pct)) {
    cmpText = (cmp.label || '较同期') + ' ' + (cmp.pct >= 0 ? '+' : '') + Math.round(cmp.pct) + '%';
    cmpUp = cmp.pct >= 0;
  }
  // 上次充值：慢频房优先 30d 真实充值点（切档不变，web 同规则）；缺失时回退区间 lastUp
  const rec = (isSlow && est && est.lastRecharge) ? est.lastRecharge : (has && dR ? dR.lastUp : null);
  return [
    // 「参考」：慢频房只按 est.ref（且有效）；实时房沿用原规则（24h 慢更新标记且估算有效，web 同规则）
    { key: 'days', label: '估算可用', value: days, unit: '天', sub: sub, hi: true, ref: isSlow ? !!(est && est.valid && est.ref) : !!(slow && days !== '—') },
    { key: 'use', label: m.tile, value: use, unit: '度', sub: useSub, cmp: cmpText, cmpUp: cmpUp, hi: false },
    { key: 'threshold', label: '低电阈值', value: String(l), unit: '度', hi: false, btn: true },
    {
      key: 'recharge', label: '上次充值',
      value: rec ? fmtQ(rec.reset) : '—', unit: rec ? '度' : '',
      sub: rec ? updText(new Date(rec.t).toISOString()) : '暂无记录', hi: false
    }
  ];
}

// 低电提示条文案（网站 v5 同口径）：剩 X 度 [· 约 ≥30/X 天]（用 estimate）
function lowText(row, est) {
  if (!row || row.q == null) return '—';
  let s = '剩 ' + fmtQ(row.q) + ' 度';
  if (est && est.valid) {
    s += ' · 约 ' + (est.days >= 30 ? '≥30' : est.days.toFixed(1)) + ' 天';
  }
  return s;
}

// x 轴刻度文案（与网站一致）：24h = HH:MM，7d/30d = MM-DD
function xLabel(t, range) {
  const d = new Date(t);
  const p = function (n) { return (n < 10 ? '0' : '') + n; };
  return range === '24h' ? (p(d.getHours()) + ':' + p(d.getMinutes())) : (p(d.getMonth() + 1) + '-' + p(d.getDate()));
}

// 折线数据（canvas 绘制用纯数据，按所选区间）：
//   · 全部采样按 ts 升序；> max 点时等距降采样（保留首末，默认 ≤120 点保证可读）；
//   · x ∈ [0,1] 按时间比例（非等距索引）；y ∈ [0,1]（0=hi 顶部 / 1=lo 底部，y=(hi-q)/(hi-lo)）；
//   · hi/lo = min/max（hi-lo<0.05 时 hi=lo+0.05 扩展）；mid=(hi+lo)/2；
//   · v13（规格 §3）：hi-lo<CH(0.005) 视为「全平」→ flat=true，y 固定 0.5（线段垂直居中，避免贴底；全房通用）；
//   · <2 点 → empty=true + note「数据积累中」，页面不绘制（保留空态文案）。
const TREND_MAX = 240;
// 各区间降采样上限（v4：保证宽 canvas 物理宽度 ≤~5376；7d/30d 目标 ≤170/240 点）
const TREND_LIMIT = { '24h': 240, '7d': 170, '30d': 240 };
function trendLimit(range) { return TREND_LIMIT[rangeMeta(range).k] || TREND_MAX; }
function trendLine(hist, maxPoints) {
  const cap = Math.max(2, +maxPoints || TREND_MAX);
  const out = { empty: true, note: '', count: 0, points: [], hi: null, mid: null, lo: null, min: null, max: null, flat: false };
  const pts = (Array.isArray(hist) ? hist : []).filter(function (p) { return p && isFinite(p.q) && isFinite(p.t); });
  if (!pts.length) { out.note = '未选择宿舍'; return out; }
  if (pts.length < 2) { out.note = '数据积累中'; return out; }
  let list = pts;
  if (pts.length > cap) {
    list = [];
    for (let i = 0; i < cap; i++) {
      const idx = Math.round(i * (pts.length - 1) / (cap - 1));
      if (!list.length || list[list.length - 1].t !== pts[idx].t) list.push(pts[idx]);
    }
  }
  /* 2026-11-12（与网页同步）：区间内大额充值会让剩余电量整体抬高、把日常下降压成平线。
     绘图值改为「扣除累计充值后的折算剩余」（连续下降）；q 仍保留真实剩余供游标/详情；
     充值位置用 rechargeMarks 标记。 */
  const vals = [], rechargeMarks = [];
  let cumRech = 0;
  list.forEach(function (p, i) {
    if (i > 0) {
      const dq = Number(p.q) - Number(list[i - 1].q);
      if (dq > 0.5) { cumRech += dq; rechargeMarks.push(i); }   // 充值/修正：加回累计，折算值连续
    }
    vals.push(Number(p.q) - cumRech);
  });
  let lo = vals[0], hi = vals[0];
  vals.forEach(function (v) { if (v < lo) lo = v; if (v > hi) hi = v; });
  const flat = (hi - lo) < CH;                 // 规格 §3：全平 → 垂直居中（不再贴底）
  if (hi - lo < 0.05) hi = lo + 0.05;
  const span = hi - lo;
  const t0 = list[0].t, t1 = list[list.length - 1].t, tSpan = Math.max(1, t1 - t0);
  out.empty = false;
  out.count = list.length;
  out.hi = hi;
  out.mid = (hi + lo) / 2;
  out.lo = lo;
  out.min = lo;
  out.max = hi;
  out.flat = flat;
  out.recharge = rechargeMarks.length > 0;
  out.rechargeTotal = Math.round(cumRech * 100) / 100;
  out.rechargeMarks = rechargeMarks;
  list.forEach(function (p, i) {
    out.points.push({
      x: Math.max(0, Math.min(1, (p.t - t0) / tSpan)),
      y: flat ? 0.5 : Math.max(0, Math.min(1, (hi - vals[i]) / span)),
      q: p.q,
      t: p.t
    });
  });
  return out;
}

// 绘图内容宽度（v4 横滑）：24h 铺满容器；7d/30d = max(容器, n*gap+16)（gap 7d=16/30d=9）
function chartWidth(range, containerW, count) {
  const meta = rangeMeta(range);
  const cw = Math.max(1, +containerW || 0);
  if (meta.k === '24h' || !meta.gap || !count) return cw;
  return Math.max(cw, Math.round(count * meta.gap + 16));
}

// 绘图容器宽保守兜底（实测失败时）：按窗宽 70% 估绘图区（320/360/390/430/667 均 ≤ 真实容器），
// 宁可窄一点，绝不超过卡片导致页面级横向溢出。
function fallbackContainerW(windowWidth) {
  const w = Number(windowWidth);
  return Math.max(160, Math.round((isFinite(w) && w > 0 ? w : 390) * 0.70));
}

// 可见窗口 x 轴刻度（v4 固定覆盖层）：按可见窗口 7%–93% 取 3/4/5 个刻度，映射到真实点 x（时间比例），
// 同屏去重；left 为相对可见窗口左边缘的 px（供 WXML 覆盖层定位），shift 为边缘对齐方式。
//   points: trendLine points（x∈[0,1] 时间比例）；cw=容器宽，W=内容宽，sl=scrollLeft
function xticksWindow(points, range, cw, W, sl) {
  const pts = Array.isArray(points) ? points : [];
  const meta = rangeMeta(range);
  const vw = Math.max(40, +cw || 0);
  const full = Math.max(vw, +W || 0);
  const left0 = Math.max(0, Math.min(full - vw, +sl || 0));
  if (pts.length < 2 || !vw) return [];
  const cnt = Math.min(meta.xN, pts.length);
  const out = [], seen = {};
  for (let i = 0; i < cnt; i++) {
    const frac = cnt === 1 ? 0.5 : (0.07 + 0.86 * i / (cnt - 1));
    const pos = left0 + vw * frac;
    let best = 0, bd = 1e18;
    for (let j = 0; j < pts.length; j++) {
      const dd = Math.abs(pts[j].x * full - pos);
      if (dd < bd) { bd = dd; best = j; }
    }
    let label = xLabel(pts[best].t, range);
    if (seen[label] && out.length) {
      for (let k = 1; k <= 8; k++) {
        const nk = Math.min(pts.length - 1, best + k);
        if (xLabel(pts[nk].t, range) !== label) { best = nk; label = xLabel(pts[best].t, range); break; }
      }
    }
    seen[label] = 1;
    let left = Math.max(4, Math.min(vw - 4, pts[best].x * full - left0));
    let shift = '-50%';
    if (left <= 24) shift = '0';
    else if (left >= vw - 24) shift = '-100%';
    out.push({ left: left, label: label, shift: shift });
  }
  return out;
}
// 旧版纯函数：按整图比例取 3/4/5 个刻度（保留给单测/兼容；页面 v4 用 xticksWindow 可见窗口版）
function xTicks(points, range) {
  const pts = Array.isArray(points) ? points : [];
  if (pts.length < 2) return [];
  const meta = rangeMeta(range);
  const cnt = Math.min(meta.xN, pts.length);
  const out = [], seen = {};
  for (let i = 0; i < cnt; i++) {
    const frac = cnt === 1 ? 0.5 : (0.07 + 0.86 * i / (cnt - 1));
    let best = 0, bd = 1e18;
    for (let j = 0; j < pts.length; j++) {
      const dd = Math.abs(pts[j].x - frac);
      if (dd < bd) { bd = dd; best = j; }
    }
    let label = xLabel(pts[best].t, range);
    if (seen[label] && out.length) {
      // 同屏重复日期（7d/30d 同一天多个采样）：向后找不同日期，找不到保留
      for (let k = 1; k <= 8; k++) {
        const nk = Math.min(pts.length - 1, best + k);
        if (xLabel(pts[nk].t, range) !== label) { best = nk; label = xLabel(pts[best].t, range); break; }
      }
    }
    seen[label] = 1;
    out.push({ frac: pts[best].x, label: label });
  }
  return out;
}

// 是否低电提示条（云端 low 或 <30 度）
// 是否低电提示条（v5：仅 q<low；默认 30，用户可调）
function lowOn(row, low) { return !!(row && row.q != null && row.q < normLow(low)); }

module.exports = {
  LOW: LOW, LOW_OPTIONS: LOW_OPTIONS, normLow: normLow,
  ARC_DAYS: ARC_DAYS, ARC_MIN: ARC_MIN, ARC_FALLBACK: ARC_FALLBACK,
  TREND_MAX: TREND_MAX, TREND_LIMIT: TREND_LIMIT, BLDS: BLDS, ROOMS: ROOMS, RANGES: RANGES,
  rangeMeta: rangeMeta, rangeKeys: rangeKeys, xLabel: xLabel, trendLimit: trendLimit,
  // 增量 43：13/16 隐藏 24h + 自然周期同期比较（与网页增量 42 同口径）
  CMP_LABEL: CMP_LABEL, CMP_TITLE: CMP_TITLE,
  showRange: showRange, rangesOfBuilding: rangesOfBuilding, normRangeForBuilding: normRangeForBuilding,
  cmpSourceKey: cmpSourceKey, naturalWindows: naturalWindows, ptsBetween: ptsBetween, cmpCoverage: cmpCoverage, naturalCompare: naturalCompare,
  chartWidth: chartWidth, xticksWindow: xticksWindow, fallbackContainerW: fallbackContainerW,
  catOf: catOf, normalizeSel: normalizeSel, labelOf: labelOf, buildingOf: buildingOf,
  roomsOfBuilding: roomsOfBuilding, rvOf: rvOf,
  normalizeRow: normalizeRow, normalizeHistory: normalizeHistory,
  stateOf: stateOf, stateText: stateText, fmtQ: fmtQ, fmtMain: fmtMain, fmtDrop: fmtDrop,
  updText: updText, ringArc: ringArc, derive: derive, deriveRange: deriveRange,
  medianOf: medianOf, deductOf: deductOf, billOf: billOf,
  rateFrom: rateFrom, estimate: estimate, daysMain: daysMain, daysText: daysText, slowUpdate: slowUpdate,
  // v13（规格 power_cadence_spec.md）：13/16 号楼慢频（日更）口径纯函数/常量
  CH: CH, MIN_SEG_H: MIN_SEG_H, EXPECT_H: EXPECT_H, SLOW_BUILDINGS: SLOW_BUILDINGS, SLOW_COVER_CHANGES: SLOW_COVER_CHANGES,
  isSlowBuilding: isSlowBuilding, isSlowRoom: isSlowRoom, changesIn: changesIn, slowStats: slowStats, estimateSlow: estimateSlow,
  noUpdateText: noUpdateText, stepSegments: stepSegments, changeDots: changeDots,
  nearestPoint: nearestPoint, cursorLabel: cursorLabel, cursorTipLayout: cursorTipLayout,
  estimateCursorTipSize: estimateCursorTipSize,
  tilesOf: tilesOf, lowText: lowText, trendLine: trendLine, xTicks: xTicks, lowOn: lowOn
};
