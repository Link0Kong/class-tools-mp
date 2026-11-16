// utils/privacy.js —— 「数据与隐私」模块的纯逻辑（无 wx / 无网络依赖，可直接单测）
//
// 只做两件与网络无关的事：
//   1) 导出我的数据：把本机「用户自己改动的内容」组装成可读 JSON（**不含 token / 名单原文 / 学号**）；
//   2) 清除云端副本：生成空 userdata v6 blob、把本人 marks 行全部置 false 的 upsert 行。
// 真正的请求由 utils/cloud.js 发出（cloud.udClearCloud），本文件只保证「发什么内容」可被单测固定。
//
// 字段名 / 默认值与 _sync_task/CONTRACT.md §3.1 完全一致（SECTION_KEYS / DEFAULTS 为唯一真源，
// cloud.js 的 mergeUd 也引用这里的常量，避免两处默认值漂移）。
const VERSION = 6;

// 同步 section 顺序 = 契约 §3.1/§3.3 的固定顺序（合并输出逐字节依赖这个顺序）
// v2.0.0 增补：power（关注宿舍/电费）在 nick 之后 —— 与网页端 UD_KEYS 一致；
// 2026-11-06 水量统计：water（抄表记录）追加在 power 之后 → 14 顶层键 / 11 section（web/mp 同契约）。
const SECTION_KEYS = ['homeTools', 'fit', 'draw', 'group', 'roster', 'hide', 'tt', 'prefs', 'nick', 'power', 'water'];

// 各 section 空值（契约 §3.3 DEFAULTS）
const DEFAULTS = {
  homeTools: [],
  fit: {},
  // 2026-11-12 抽签升级 v1（web/draw/CONTRACT.md §3.1/§4）：draw section 内新增 names 字段
  // （自定义序号名称映射文本，空 = 未设置）；仍是同一个 draw section，不新增顶层键 / section。
  draw: { names: '' },
  group: {},
  roster: { rosterSel: [], rollSel: [], rollSt: {}, rollNames: '' },
  hide: { hwHide: {}, ntHide: {} },
  tt: { ttView: '', ttUseMine: false, ttLocal: null, termStart: '' },
  prefs: { hwRemind: {}, ntSub: false, ntSubAt: 0 },
  nick: '',
  power: { sel: '', at: 0, low: 30 },
  // 水量统计（2026-11-06）：{rooms:{ "<roomverify>": {p, recs:[{m,r,ts}]} }}
  water: { rooms: {} }
};

// 同步范围清单（隐私页展示；与契约 §1 一一对应，固定文案，不由云端下发）
const SCOPE = [
  '作业完成',
  '通知已处理',
  '通知置顶',
  '工具栏顺序与工具页顺序',
  '体测录入',
  '抽签参数',
  '分组与名单',
  '点名名单与到·假',
  '隐藏项',
  '课表偏好',
  '通知提醒偏好',
  '昵称',
  '关注宿舍（电费）',
  '抄表记录（水量）'
];

function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

// 空 userdata v6 blob（清除云端副本用）：键顺序与 mergeUd 输出一致，v6 + at 全 0 + 空 section + 顶层镜像
function emptyV6() {
  const out = { v: VERSION, at: {} };
  SECTION_KEYS.forEach(function (k) { out.at[k] = 0; });
  SECTION_KEYS.forEach(function (k) { out[k] = clone(DEFAULTS[k]); });
  out.homeToolsAt = 0;
  return out;
}
function emptyBlob() { return JSON.stringify(emptyV6()); }

// 本人 marks 行 → 全部 val=false 的 upsert 行（契约：取消 = 写 false，不 DELETE）
// row 形态：{ id: seat|kind|ref, seat, kind, ref, val, ts }
function marksOffRows(rows, seat, now) {
  const s = String(seat == null ? '' : seat).trim();
  const ts = now || Date.now();
  const out = [];
  const seen = {};
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (!r || typeof r !== 'object') return;
    const kind = String(r.kind || '');
    const ref = String(r.ref == null ? '' : r.ref);
    if (!ref || ['hw', 'nt', 'ntdone'].indexOf(kind) < 0) return;
    const id = String(r.id || ((s || String(r.seat || '')) + '|' + kind + '|' + ref));
    if (seen[id]) return;
    seen[id] = 1;
    out.push({ id: id, seat: String(r.seat || s), kind: kind, ref: ref, val: false, ts: ts });
  });
  return out;
}

// 本机数据概览（隐私页「本机数据」区；只数条数，不输出原文）
function countsOf(d) {
  d = d || {};
  const hit = function (o) {
    if (!o || typeof o !== 'object') return 0;
    return Object.keys(o).filter(function (k) { return !!o[k]; }).length;
  };
  return {
    homework: (d.homework || []).length,
    notices: (d.notices || []).length,
    hwDone: hit(d.hwDone),
    ntPin: hit(d.ntPin),
    ntDone: hit(d.ntDone),
    rosterSel: (d.rosterSel || []).length,
    groupSel: (d.group && d.group.sel || []).length,
    rollSel: (d.rollSel || []).length,
    fitRecs: (d.fitRecs || []).length,
    pending: (d.markPend || []).length + (d.udPend ? 1 : 0)
  };
}

// 导出我的数据：只含「用户自己改动 / 同步范围」的内容 + 身份摘要（姓名 / 角色，不含学号）
// 不包含：token、classMembers / classRoster 名单原文、派生名单文本（rollNames / roster / group.names）、
//         设备 id（did）、settings（webhook 等含密钥类配置）、本机缓存快照。
// 隐私红线（AGENTS §4）：宿舍号只在电费页本人可见，**不进导出 JSON**；因此 power / water section 不出现在 buildExport。
function buildExport(d, id, now) {
  d = d || {};
  id = id || {};
  const ntDone = d.ntDone || {};
  const hwDone = d.hwDone || {};
  const ntPin = d.ntPin || {};
  const fitRecs = (d.fitRecs || []).slice(0, 2).map(function (r) {
    return {
      ts: Number(r.ts) || 0,
      name: String(r.name || ''),
      sex: r.sex === 'f' ? 'f' : 'm',
      gr: r.gr === '34' ? '34' : '12',
      total: r.total == null ? null : Number(r.total),
      grade: String(r.grade || '')
    };
  });
  return {
    schema: 'class-tools-userdata',
    v: VERSION,
    exportedAt: new Date(now || Date.now()).toISOString(),
    who: {
      name: String(id.name || ''),
      role: String(id.role || ''),
      badge: String(id.badge || ''),
      admin: !!id.is_admin
    },
    sync: {
      homeTools: (d.homeTools || []).slice(),
      fit: clone(d.fit || {}),
      draw: clone(d.draw || {}),
      // 分组只导出参数与座号选择，不含派生名单文本（group.names 是班内同学姓名）
      group: {
        source: String((d.group && d.group.source) || ''),
        mode: String((d.group && d.group.mode) || ''),
        n: Number(d.group && d.group.n) || 0,
        shuffle: !!(d.group && d.group.shuffle),
        sel: ((d.group && d.group.sel) || []).slice()
      },
      roster: { rosterSel: (d.rosterSel || []).slice(), rollSel: (d.rollSel || []).slice(), rollSt: clone(d.rollSt || {}) },
      hide: { hwHide: clone(d.hwHide || {}), ntHide: clone(d.ntHide || {}) },
      tt: { termStart: String(d.termStart || '') },
      prefs: { hwRemind: clone(d.hwRemind || {}), ntSub: !!d.ntSub, ntSubAt: Number(d.ntSubAt) || 0, toolOrder: Array.isArray(d.toolOrder) ? d.toolOrder.slice() : [] },
      marks: { hwDone: clone(hwDone), ntPin: clone(ntPin), ntDone: clone(ntDone) }
    },
    fitRecs: fitRecs,
    counts: countsOf(d)
  };
}
function exportJson(d, id, now) { return JSON.stringify(buildExport(d, id, now), null, 2); }

module.exports = {
  VERSION: VERSION,
  SECTION_KEYS: SECTION_KEYS,
  DEFAULTS: DEFAULTS,
  SCOPE: SCOPE,
  emptyV6: emptyV6,
  emptyBlob: emptyBlob,
  marksOffRows: marksOffRows,
  countsOf: countsOf,
  buildExport: buildExport,
  exportJson: exportJson
};
