/* notice_longterm_unit.js —— 长期通知优化显示（2026-11-12）单测
 *
 * 规格：web/tools/tests/notice_longterm_display_spec.md（网页 / 小程序同一口径）
 * 被测：
 *   utils/notice.js    isLongterm / longtermSubtypeOf / hasTimeAnchor（三分支 + 边界）
 *                      statOf / mostUrgent 排除长期通知（两类）
 *                      listRankOf / mainListCompare（主列表排序）+ cardAnchorTs / longtermCompare / orderLongterm（长期区排序）
 *   pages/nt/nt.js     applyFilter 拆分 cards / longtermCards / longtermCount / showLongterm / stats
 *                      toggleLongterm、_cardById/patchCard 覆盖长期区、info 卡可标记已处理、长期安排不可
 *   pages/nt/nt.wxml   主列表之后、已过期之前的长期通知折叠区（「长期通知 · N 条」+ 展开/收起）
 *   pages/nt/nt.wxss   折叠区样式（M3 / ≥40px 点按区 / 无外部资源）
 *   pages/index/index.js 工作台待办排除长期通知（isLongterm，与 statOf 同口径）
 *
 * 运行：
 *   node notice_longterm_unit.js     # 独立运行
 *   node unit.js                     # unit.js 末尾把本文件并入总表
 *
 * 依赖：仅 Node 内置模块；小程序模块用最小 wx mock 加载，不发任何网络请求，不访问真实云端。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');
const H = 3600 * 1000;
const D = 24 * H;

function noticeMod() { return require(path.join(ROOT, 'utils/notice.js')); }
function src(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function iso(ts) { return new Date(ts).toISOString(); }
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function at(y, mo, d, hh, mi) { return new Date(y, mo - 1, d, hh || 0, mi || 0, 0, 0).getTime(); }

/* ---------- nt 页加载（最小 wx mock；只做纯内存断言） ---------- */
function purgeNtPage() {
  Object.keys(require.cache).forEach(function (k) {
    if (k.replace(/\\/g, '/').indexOf(ROOT + '/pages/nt/') === 0) delete require.cache[k];
  });
}
function loadNtPage() {
  const hadWx = Object.prototype.hasOwnProperty.call(global, 'wx');
  const prevWx = global.wx;
  if (!hadWx || !global.wx) {
    const mem = Object.create(null);
    global.wx = {
      getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
      setStorageSync(k, v) { mem[k] = v; },
      removeStorageSync(k) { delete mem[k]; },
      getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 0, limitSize: 10240 }; },
      request(o) { if (o && o.success) o.success({ statusCode: 200, data: [] }); },
      showToast() {}, showModal() {}, showLoading() {}, hideLoading() {},
      setClipboardData(o) { if (o && o.success) o.success(); },
      getSystemInfoSync() { return { windowWidth: 375, windowHeight: 667, platform: 'devtools' }; },
      nextTick(fn) { fn(); },
      createSelectorQuery() {
        return {
          select() { return this; }, boundingClientRect() { return this; },
          selectViewport() { return this; }, scrollOffset() { return this; },
          exec(cb) { if (cb) cb([]); }
        };
      },
      pageScrollTo() {}, stopPullDownRefresh() {}
    };
  }
  const hadPage = Object.prototype.hasOwnProperty.call(global, 'Page');
  const prevPage = global.Page;
  let def = null;
  global.Page = function (d) { def = d; };
  purgeNtPage();
  try {
    require(path.join(ROOT, 'pages/nt/nt.js'));
  } finally {
    if (hadPage) global.Page = prevPage; else delete global.Page;
    purgeNtPage();
    if (!hadWx) delete global.wx;
    else global.wx = prevWx;
  }
  return def;
}
// 交互类测试会走到 util.toast 等 wx API：独立运行时补一个最小 wx mock（unit.js 里已有全局 mock，不动它）
function installWxIfNeeded() {
  const had = Object.prototype.hasOwnProperty.call(global, 'wx');
  const prev = global.wx;
  if (!had || !global.wx) {
    global.wx = {
      showToast() {}, showModal() {}, showLoading() {}, hideLoading() {},
      getStorageSync() { return ''; }, setStorageSync() {}, removeStorageSync() {}
    };
  }
  return function () { if (had) global.wx = prev; else delete global.wx; };
}

/* ---------- 页面 mock：轻量卡片（mapGroup 的等价子集，只保留 applyFilter/viewOf 依赖的字段） ---------- */function cardOf(g) {
  const n = noticeMod();
  const st = n.statusOf(g);
  const rec = !!n.recurOf(g);
  return {
    id: g.id, title: g.title || g.id, cat: g.cat || '通知', catCls: 'qt',
    source: '', sourceKind: 'doc', senderName: '', senderRole: '', senderBadge: '', pubBadge: '',
    isOcr: false, statusLabel: st.label, statusCls: st.cls, expired: !!st.expired, timeLabel: '',
    summary: '', points: [], segs: [], items: [], quotes: [], hasRaw: false, hasDetail: false,
    compose: [], filesCount: 0, imgCount: 0, moreText: '', expanded: !st.expired, done: false,
    recurring: rec, recurLabel: rec ? n.recurLabelOf(g) : '', nextText: rec ? n.nextTextOf(g) : '',
    nextCnText: rec ? n.nextCnTextOf(g) : '', isOcc: false, isInfo: false,
    recurEnded: !!(rec && n.isRecurEnded(g)), pubTs: n.pubTsOf(g),
    hidden: !!g._hidden, updated: false, admin: false,
    deadlineTs: n.deadlineOf(g), canRemind: !st.expired && !rec, reminded: false,
    remindText: '', remindLabel: '提醒', imgs: []
  };
}
// setData：支持 'a.b' / 'a[0].b' 路径（与页面逻辑一致；长期区交互靠这些路径局部更新）
function makeSetData(ctx) {
  return function (o, cb) {
    Object.keys(o || {}).forEach(function (k) {
      const parts = k.replace(/\[(\d+)\]/g, '.$1').split('.');
      let t = ctx.data;
      for (let i = 0; i < parts.length - 1; i++) {
        if (t[parts[i]] == null) t[parts[i]] = {};
        t = t[parts[i]];
      }
      t[parts[parts.length - 1]] = o[k];
    });
    if (cb) cb();
  };
}
function makeCtx(def, raws) {
  const ctx = {
    data: JSON.parse(JSON.stringify(def.data)),
    _raw: raws,
    _all: raws.map(cardOf),
    _expanded: {}, _done: {}, _remind: {}, _imgs: {}, _loadingImgs: {}, _foldTimers: {},
    ensureImgs() { return Promise.resolve([]); },      // 单测不落图片临时文件
    _needsGroupBody() { return false; },               // 单测不拉完整 body
    _rawById: def._rawById,
    _cardById: def._cardById,
    patchCard: def.patchCard
  };
  ctx.setData = makeSetData(ctx);
  // 其余页面方法挂到 ctx（applyFilter / toggleLongterm / toggleDetail / toggleDone / _briefNextOf 等）
  Object.keys(def).forEach(function (k) {
    if (typeof def[k] === 'function' && typeof ctx[k] !== 'function') ctx[k] = def[k];
  });
  return ctx;
}
function idsOf(list) { return (list || []).map(function (c) { return c.id; }); }

/* ================================================================ run */
async function run(test) {

  /* ============================================================
     1. isLongterm 三分支：recur / info / 有时间的普通通知
     ============================================================ */
  await test('长期通知§1：isLongterm 三分支（recurrence→recur；无时间锚点→info；有时间→普通）', function () {
    const n = noticeMod();
    const now = Date.now();
    // 分支 1：recurrence 为对象且 freq 非空 → 长期安排（即使有已过 deadline 也不判过期）
    const rec = { id: 'r1', recurrence: { freq: 'monthly_weeks', weekday: 3, weeks: [1, 2, 3], time: '17:30', label: '每月前三周 周三 17:30' }, deadline: iso(now - 30 * D) };
    assert.strictEqual(n.isLongterm(rec), true, '长期安排必须判为长期通知');
    assert.strictEqual(n.longtermSubtypeOf(rec), 'recur');
    assert.strictEqual(n.hasTimeAnchor(rec), true, 'recurrence 卡即使有 deadline 也走 recur 分支');
    assert.strictEqual(n.statusOf(rec, now).expired, false, '长期安排永不按 deadline 判过期');
    assert.deepStrictEqual(n.recurOf(rec) && n.recurOf(rec).freq, 'monthly_weeks');

    // 分支 2：无真实截止 / 无 eventAt / 无报名窗口且未过期 → 无时间/长期有效
    const info = { id: 'i1', title: '随时可看的长期通知', items: [{ kind: 'text', text: '长期有效' }] };
    assert.strictEqual(n.isLongterm(info), true, '无时间锚点 → info 长期通知');
    assert.strictEqual(n.longtermSubtypeOf(info), 'info');
    assert.strictEqual(n.statusOf(info, now).key, 'none');

    // 分支 3：有真实时间锚点 → 普通通知（不是长期）
    assert.strictEqual(n.isLongterm({ deadline: iso(now + D) }), false, '有截止时间 → 普通通知');
    assert.strictEqual(n.isLongterm({ eventAt: iso(now + D) }), false, '有活动时间 → 普通通知');
    assert.strictEqual(n.isLongterm({ signupStart: iso(now + D) }), false, '有报名开始 → 普通通知');
    assert.strictEqual(n.isLongterm({ signupEnd: iso(now + D) }), false, '有报名结束 → 普通通知');
    assert.strictEqual(n.isLongterm({ signupWindows: [{ start: iso(now), end: iso(now + D) }] }), false, '非空 signupWindows → 普通通知');
    assert.strictEqual(n.hasTimeAnchor({ signupWindows: [] }), false, '空 signupWindows 不算时间锚点');
    // extensions 最后一条截止也算真实截止
    assert.strictEqual(n.isLongterm({ deadline: iso(now + D), extensions: [{ deadline: iso(now + 2 * D) }] }), false, 'extensions 最后一条截止 = 有真实截止');
    assert.strictEqual(n.isLongterm({ extensions: [{ deadline: iso(now + D) }] }), false, '只有 extensions 截止也算有真实截止');
  });

  await test('长期通知§1：已过期 / alert 不判长期；recurrence 坏数据回落到「无时间」判断', function () {
    const n = noticeMod();
    const now = Date.now();
    // 已过期不是长期（主列表按原规则进已过期区块）
    assert.strictEqual(n.isLongterm({ deadline: iso(now - D) }), false, '已过期 → 不是长期通知');
    assert.strictEqual(n.isLongterm({ deadline: iso(now - D), extensions: [{ deadline: iso(now - 2 * D) }] }), false, '延期已截止 → 不是长期通知');
    // alert（已截止有新名单）有真实截止，本来就有时间锚点
    assert.strictEqual(n.isLongterm({ deadline: iso(now - D), alert: true }), false);
    // recurrence 不是对象 / freq 为空 → 不满足分支 1，回落到「无时间锚点」判断
    assert.strictEqual(n.longtermSubtypeOf({ recurrence: null }), 'info');
    assert.strictEqual(n.longtermSubtypeOf({ recurrence: {} }), 'info');
    assert.strictEqual(n.longtermSubtypeOf({ recurrence: [] }), 'info');
    assert.strictEqual(n.longtermSubtypeOf({ recurrence: { freq: '' } }), 'info');
    assert.strictEqual(n.isLongterm(null), false, '空值安全');
    assert.strictEqual(n.isLongterm({}), true, '空对象 = 无任何时间锚点 → info');
    // actionable=false 但没有时间锚点仍是长期（长期判定只看时间锚点）
    assert.strictEqual(n.longtermSubtypeOf({ actionable: false }), 'info');
  });

  /* ============================================================
     2. statOf / mostUrgent 排除长期通知（两类都排除）
     ============================================================ */
  await test('长期通知§3：statOf 待处理/24h/7 天排除长期通知（recur + info），已过期统计不变', function () {
    const n = noticeMod();
    const now = Date.now();
    const rec = { id: 'rec', recurrence: { freq: 'daily', time: '08:00' }, actionable: false };
    const info = { id: 'info', title: '长期有效' };
    const urgent = { id: 'urgent', deadline: iso(now + H) };
    const week = { id: 'week', deadline: iso(now + 3 * D) };
    const expired = { id: 'exp', deadline: iso(now - D) };
    const doneUrgent = { id: 'done', deadline: iso(now + 2 * H) };
    const stats = n.statOf([rec, info, urgent, week, expired, doneUrgent], { done: true });
    assert.strictEqual(stats.pending, 2, '待处理只算 urgent/week（长期通知与已处理不算）');
    assert.strictEqual(stats.urgent, 1, '24h 内只算 urgent（长期通知不计入）');
    assert.strictEqual(stats.week, 2, '7 天内 = urgent + week（长期通知不计入）');
    assert.strictEqual(stats.expired, 1, '已过期统计不变');
    // mostUrgent 排除长期通知与已处理
    assert.strictEqual(n.mostUrgent([rec, info, urgent, doneUrgent], { done: true }).id, 'urgent');
    assert.strictEqual(n.mostUrgent([rec, info], {}), null, '只有长期通知时没有「最紧急一条」');
    assert.strictEqual(n.mostUrgent([info, doneUrgent], { done: true }), null, '长期 + 已处理都不参与');
    // 只有长期通知时待处理 0
    assert.strictEqual(n.statOf([rec, info], {}).pending, 0);
  });

  /* ============================================================
     3. 主列表排序（§4：alert→urgent/today→extended→soon/active→none→done，档内 whenOf 升序）
     ============================================================ */
  await test('长期通知§4：listRankOf 档位（alert/urgent·today/extended/soon·active/none/done）', function () {
    const n = noticeMod();
    const now = Date.now();
    assert.strictEqual(n.listRankOf({ id: 'a', deadline: iso(now - H), alert: true }), 0);
    assert.strictEqual(n.listRankOf({ id: 'u', deadline: iso(now + 30 * 60000) }), 1);
    assert.strictEqual(n.listRankOf({ id: 't', deadline: iso(now + 3 * H) }), 1);
    assert.strictEqual(n.listRankOf({ id: 'e', deadline: iso(now + 2 * D), extensions: [{ deadline: iso(now + 2 * D) }] }), 2);
    assert.strictEqual(n.listRankOf({ id: 's', deadline: iso(now + 2 * D) }), 3);
    assert.strictEqual(n.listRankOf({ id: 'c', deadline: iso(now + 5 * D) }), 3);
    // 无时间：只有 signupStart（已开始，缺 signupEnd）的数据不齐卡 → key=none，且不属于长期通知
    const noneG = { id: 'n', signupStart: iso(now - D) };
    assert.strictEqual(n.statusOf(noneG, now).key, 'none');
    assert.strictEqual(n.isLongterm(noneG), false, '有 signupStart → 不是长期通知');
    assert.strictEqual(n.listRankOf(noneG), 4);
    assert.strictEqual(n.listRankOf({ id: 'd', deadline: iso(now + 2 * H) }, { d: true }), 9, '已处理最后');
    assert.strictEqual(n.listRankOf({ id: 'x', deadline: iso(now - D) }), 8, '已过期兜底档位');
  });

  await test('长期通知§4：主列表排序 = 档位 → whenOf 升序（报名优先）→ 数据源顺序（稳定）', function () {
    const n = noticeMod();
    const now = Date.now();
    const alertG = { id: 'alert', deadline: iso(now - H), alert: true };
    const urgentG = { id: 'urgent', deadline: iso(now + 30 * 60000) };
    const todayG = { id: 'today', deadline: iso(now + 3 * H) };
    const extG = { id: 'ext', deadline: iso(now + 2 * D), extensions: [{ deadline: iso(now + 2 * D) }] };
    const soonG = { id: 'soon', deadline: iso(now + 2 * D) };
    // 报名优先：signupEnd(1h) 比 deadline(2h) 更早 → 排在 deadline 2h 的普通卡前面
    const signupG = { id: 'signup', deadline: iso(now + 3 * H), signupEnd: iso(now + H) };
    const deadlineG = { id: 'deadline', deadline: iso(now + 2 * H) };
    const doneG = { id: 'done', deadline: iso(now + 4 * H) };
    const done = { done: true };
    const source = [deadlineG, doneG, soonG, todayG, extG, urgentG, alertG, signupG];
    const sorted = source.slice().sort(function (a, b) {
      return n.mainListCompare(a, b, done, now) || (source.indexOf(a) - source.indexOf(b));
    });
    assert.deepStrictEqual(idsOf(sorted), ['alert', 'urgent', 'signup', 'deadline', 'today', 'ext', 'soon', 'done'],
      '档位/时间排序错误：' + idsOf(sorted).join(','));
    assert.strictEqual(n.whenOf(signupG, now), now + H, '报名优先：whenOf = signupEnd');
    // 稳定：同档同时间的两条保持数据源顺序（不因排序交换）
    const z = { id: 'z', deadline: iso(now + 2 * H) };
    const a = { id: 'a', deadline: iso(now + 2 * H) };
    const same = [z, a].sort(function (x, y) {
      return n.mainListCompare(x, y, {}, now) || ([z, a].indexOf(x) - [z, a].indexOf(y));
    });
    assert.deepStrictEqual(idsOf(same), ['z', 'a']);
    // 无时间者同档最后：none 卡（数据不齐）排在 active 之后
    const noneG = { id: 'none', signupStart: iso(now - D) };
    const activeG = { id: 'active', deadline: iso(now + 5 * D) };
    const tail = [noneG, activeG].sort(function (x, y) { return n.mainListCompare(x, y, {}, now); });
    assert.deepStrictEqual(idsOf(tail), ['active', 'none']);
  });

  /* ============================================================
     4. 长期区排序（长期安排按下次时间升序；info 按锚点消息时间倒序）
     ============================================================ */
  await test('长期通知§2：cardAnchorTs = 第一条带 time 的 item（任意 kind，与网页同口径；无则 0）', function () {
    const n = noticeMod();
    const NOW = at(2026, 11, 12, 10, 0);        // 固定基准，避免真实时钟影响
    const g = {
      items: [
        { kind: 'file', time: '11-12 09:00', name: 'a.pdf' },
        { kind: 'img', time: '11-12 09:10' },
        { kind: 'text', time: '11-12 08:00', text: '正文' },
        { kind: 'follow', time: '11-12 07:00', text: '补充' }
      ]
    };
    assert.strictEqual(n.cardAnchorTs(g, NOW), at(2026, 11, 12, 9, 0), '锚点 = 第一条任意 kind item 的时间（网页 cardAnchorTs 同口径）');
    assert.strictEqual(n.cardAnchorTs({ items: [{ kind: 'file', time: '11-12 09:00' }] }, NOW),
      at(2026, 11, 12, 9, 0), '只有 file 也取该时间（对齐网页：任意 item）');
    assert.strictEqual(n.cardAnchorTs({}, NOW), 0);
    assert.strictEqual(n.cardAnchorTs(null, NOW), 0);
    assert.strictEqual(n.cardAnchorTs({ items: [{ kind: 'text', time: 'bad-time' }] }, NOW), 0, '坏时间 → 0');
  });

  await test('长期通知§1：statusOf 读 AI 质检 expired:true（与网页模板同口径）', function () {
    const n = noticeMod();
    assert.strictEqual(n.statusOf({ expired: true }).key, 'expired');
    assert.strictEqual(n.statusOf({ expired: true }).label, '已过期');
    assert.strictEqual(n.statusOf({ expired: true }).expired, true);
    assert.strictEqual(n.statusOf({ expired: true, alert: true }).key, 'alert', 'alert 优先');
    assert.strictEqual(n.statusOf({ expired: true, extensions: [{ deadline: '2026-11-01T10:00:00+08:00' }] }).key,
      'extended_past', '延期过的保持 extended_past');
    const rec = { expired: true, recurrence: { freq: 'weekly', weekday: 5, time: '17:30' } };
    assert.strictEqual(n.statusOf(rec).key, 'recurring', '长期安排永不按 expired 处理');
    assert.strictEqual(n.isLongterm({ expired: true }), false, 'expired:true 的无时间通知不算长期有效（进已过期）');
  });

  await test('长期通知§2：orderLongterm = 长期安排（下次升序）→ info（锚点倒序）→ 数据源顺序', function () {
    const n = noticeMod();
    const NOW = at(2026, 11, 12, 10, 0);        // 2026-11-12 周四 10:00
    const recDaily = { id: 'rd', recurrence: { freq: 'daily', time: '08:00' } };              // 下次 11-13 08:00
    const recWeekly = { id: 'rw', recurrence: { freq: 'weekly', weekday: 5, time: '17:30' } }; // 下次 11-13 17:30
    const recNoNext = { id: 'rn', recurrence: { freq: 'bad' } };                              // freq 非空算长期安排，但算不出下次 → 最后
    const infoB = { id: 'ib', items: [{ kind: 'text', time: '11-12 09:30' }] };
    const infoA = { id: 'ia', items: [{ kind: 'text', time: '11-12 08:00' }] };
    const infoC = { id: 'ic', items: [] };
    const infoD1 = { id: 'id1', items: [{ kind: 'text', time: '11-11 12:00' }] };
    const infoD2 = { id: 'id2', items: [{ kind: 'text', time: '11-11 12:00' }] };
    const list = [infoA, recWeekly, infoC, recNoNext, infoB, recDaily, infoD2, infoD1];
    // 契约 2026-11-14 §1.1：坏 freq 的 recurrence 已丢弃 → 该组按「资料 / 无时间」排序（锚点 0 → 最后）
    assert.strictEqual(n.isRecurGroup(recNoNext), false, '坏 freq 不再算长期安排');
    const out = n.orderLongterm(list, NOW);
    assert.deepStrictEqual(idsOf(out), ['rd', 'rw', 'ib', 'ia', 'id2', 'id1', 'ic', 'rn'],
      '长期区排序错误：' + idsOf(out).join(','));
    assert.deepStrictEqual(idsOf(list), ['ia', 'rw', 'ic', 'rn', 'ib', 'rd', 'id2', 'id1'], '不应修改入参数组');
    // 同序稳定：两条锚点相同 → 数据源顺序（id2 在 id1 前面）
    assert.ok(out.indexOf(infoD2) < out.indexOf(infoD1), '同锚点按数据源顺序');
    // longtermCompare 单点断言
    assert.strictEqual(n.longtermCompare(recDaily, recWeekly, NOW) < 0, true, '长期安排按下次时间升序');
    assert.strictEqual(n.longtermCompare(infoB, infoA, NOW) < 0, true, 'info 按锚点倒序');
    assert.strictEqual(n.longtermCompare(recDaily, infoB, NOW) < 0, true, '长期安排在前');
  });

  /* ============================================================
     5. nt 页 applyFilter（契约 2026-11-14 §2 新分区）：
        主列表（含期次卡）→「资料 / 无时间」栏（默认展开）→ 已过期区；长期清单只在「长期通知」筛选。
     ============================================================ */
  await test('长期通知（新契约）§2：nt.applyFilter 分区 / 长期清单 / 资料栏 / 已过期 / 统计 / 折叠交互', async function () {
    const def = loadNtPage();
    const n = noticeMod();
    assert.ok(def && typeof def.applyFilter === 'function' && typeof def.toggleInfo === 'function', 'nt 页缺少 applyFilter/toggleInfo');
    const now = Date.now();
    const pad = function (x) { return x < 10 ? '0' + x : '' + x; };
    const hhmm = function (ts) { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
    const ymd = function (ts) { const d = new Date(ts); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); };
    const occTs = now + 3600 * 1000;
    const occKey = 'rec1@occ:' + ymd(occTs);
    const raws = [
      { id: 'urgent', title: '紧急', cat: '团务', deadline: iso(now + 3600 * 1000) },
      { id: 'doneG', title: '已处理普通', cat: '团务', deadline: iso(now + 2 * 3600 * 1000) },
      { id: 'info', title: '资料无时间', cat: '教务' },
      {
        id: 'rec1', title: '长期安排 A', cat: '团务', recurrence: { freq: 'daily', time: hhmm(occTs), startAt: iso(now - 30 * D) },
        items: [{ kind: 'text', text: '每天' }]
      },
      {
        id: 'rec2', title: '长期安排 B', cat: '团务',
        recurrence: { freq: 'weekly', weekday: (new Date(now).getDay() + 2) % 7, time: hhmm(now), startAt: iso(now - 30 * D) }
      },
      { id: 'recEnded', title: '已结束长期', cat: '团务', recurrence: { freq: 'daily', time: '07:30', until: '2026-11-13' } },
      { id: 'expiredG', title: '已过期', cat: '团务', deadline: iso(now - 2 * D) },
      { id: 'hiddenG', title: '已隐藏', cat: '团务', deadline: iso(now + 3 * 3600 * 1000), _hidden: true }
    ];
    const ctx = makeCtx(def, raws);
    ctx._done = { doneG: true };
    ctx.data.filter = 'all';
    ctx.data.cat = '全部';
    ctx.data.isAdmin = false;
    ctx.data.showInfo = true;
    def.applyFilter.call(ctx);

    // 主列表：普通未过期（含已处理置后）+ 期次卡；排除资料/长期定义/过期/已隐藏
    const mainIds = idsOf(ctx.data.cards);
    assert.ok(mainIds.indexOf('urgent') >= 0, '主列表含普通通知：' + mainIds.join(','));
    assert.ok(mainIds.indexOf(occKey) >= 0, '期次卡进入主列表（id=期次 key）：' + mainIds.join(','));
    assert.strictEqual(mainIds.filter(function (x) { return x === 'rec1' || x === 'rec2' || x === 'info'; }).length, 0,
      '长期定义卡 / 资料卡不进主列表');
    assert.ok(mainIds.indexOf('recEnded') < 0 && mainIds.indexOf('expiredG') < 0, '已过期（含长期安排已结束）不进主列表');
    assert.ok(mainIds.indexOf('hiddenG') < 0, '已隐藏不进主列表');
    assert.strictEqual(mainIds[mainIds.length - 1], 'doneG', '已处理普通通知排主列表最后');
    // 资料 / 无时间栏（默认展开）
    assert.deepStrictEqual(idsOf(ctx.data.infoCards), ['info'], '资料/无时间栏');
    assert.strictEqual(ctx.data.infoCount, 1);
    assert.strictEqual(ctx.data.showInfo, true, '资料栏默认展开');
    // 长期清单数据（进行中的 recurrence；已结束的不算）
    assert.deepStrictEqual(idsOf(ctx.data.longtermCards).sort(), ['rec1', 'rec2'].sort(), '长期清单 = 进行中的长期安排');
    assert.strictEqual(ctx.data.longtermCount, 2);
    assert.strictEqual(ctx.data.longtermCards.filter(function (c) { return c.id === 'rec1'; })[0].nextCnText.indexOf('下次 ') === 0, true);
    // 已过期区：普通过期 + 长期安排已结束
    assert.deepStrictEqual(idsOf(ctx.data.expiredCards).sort(), ['expiredG', 'recEnded'].sort(), '已过期区含长期安排已结束');
    assert.strictEqual(ctx.data.expiredCards.filter(function (c) { return c.id === 'recEnded'; })[0].statusLabel, '长期安排已结束');
    // 统计：pending = urgent + 期次；长期 = 2；过期 = 2；已处理/资料/定义不计
    assert.strictEqual(ctx.data.stats.pending, 2, '待处理 = urgent + 期次：' + JSON.stringify(ctx.data.stats));
    assert.strictEqual(ctx.data.stats.urgent, 2, '期次窗口 ≤24h → 计入 24h');
    assert.strictEqual(ctx.data.stats.longterm, 2);
    assert.strictEqual(ctx.data.stats.expired, 2);
    // 顶部/分区只在「全部」展示：长期清单只由 longtermCards 渲染
    assert.strictEqual(ctx.data.cards.length > 0, true);
    assert.strictEqual(ctx.data.listCount, ctx.data.cards.length, '「N 组」= 主列表条目数（期次计 1 条）');
    // 资料栏折叠 / 展开（会话内状态）
    def.toggleInfo.call(ctx);
    assert.strictEqual(ctx.data.showInfo, false);
    def.toggleInfo.call(ctx);
    assert.strictEqual(ctx.data.showInfo, true);
    // 长期通知筛选：主区替换为长期安排清单（无期次卡 / 无已处理按钮）
    ctx.data.filter = 'longterm';
    def.applyFilter.call(ctx);
    assert.strictEqual(ctx.data.cards.length, 0, '长期通知筛选不显示普通卡/期次卡');
    assert.strictEqual(ctx.data.listCount, 2, '长期清单视图「N 组」= 长期条数');
    assert.strictEqual(ctx.data.longtermCards.filter(function (c) { return c.id === 'rec1'; })[0].canDone, false, '长期定义卡无已处理');
    // 分类筛选对长期清单生效
    ctx.data.cat = '教务';
    def.applyFilter.call(ctx);
    assert.deepStrictEqual(idsOf(ctx.data.longtermCards), [], '分类筛选后无该分类长期安排');
    ctx.data.cat = '全部';
    // 已截止筛选：只显示已过期区内容
    ctx.data.filter = 'expired';
    def.applyFilter.call(ctx);
    assert.deepStrictEqual(idsOf(ctx.data.cards).sort(), ['expiredG', 'recEnded'].sort());
    // 「待处理」筛选：主列表只剩未处理普通 + 期次
    ctx.data.filter = 'active';
    def.applyFilter.call(ctx);
    assert.deepStrictEqual(idsOf(ctx.data.cards).sort(), ['urgent', occKey].sort());
    assert.strictEqual(ctx.data.showExpiredWrap, true, '待处理筛选保留已过期区（折叠）');
    // 已隐藏筛选（管理员）：只列 hidden
    ctx.data.isAdmin = true;
    ctx.data.filter = 'hidden';
    def.applyFilter.call(ctx);
    assert.deepStrictEqual(idsOf(ctx.data.cards), ['hiddenG']);
  });

  await test('长期通知（新契约）§2：长期定义卡不可标记已处理 / 资料卡可（信息态），_cardById/patchCard 覆盖资料栏与长期清单', async function () {
    const restoreWx = installWxIfNeeded();
    const def = loadNtPage();
    const n = noticeMod();
    const now = Date.now();
    const pad = function (x) { return x < 10 ? '0' + x : '' + x; };
    const hhmm = function (ts) { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
    const raws = [
      { id: 'rec1', title: '长期安排', cat: '团务', recurrence: { freq: 'daily', time: hhmm(now + 3600 * 1000) }, actionable: false },
      { id: 'info1', title: '资料', cat: '团务', items: [{ kind: 'text', text: '长期有效' }] },
      { id: 'urgent', title: '紧急', cat: '团务', deadline: iso(now + 3600 * 1000) }
    ];
    const ctx = makeCtx(def, raws);
    ctx.data.filter = 'all';
    ctx.data.cat = '全部';
    def.applyFilter.call(ctx);
    // _cardById 覆盖资料栏 + 长期清单；patchCard 同步更新 infoCards / longtermCards
    const info = def._cardById.call(ctx, 'info1');
    assert.ok(info, '_cardById 应能找到资料栏卡片');
    ctx._expanded.info1 = false;
    def.patchCard.call(ctx, 'info1', { expanded: false });
    assert.strictEqual(ctx.data.infoCards.filter(function (c) { return c.id === 'info1'; })[0].expanded, false, 'patchCard 覆盖 infoCards');
    assert.strictEqual(ctx.data.longtermCards.filter(function (c) { return c.id === 'rec1'; })[0].canDone, false, '长期定义卡不显示已处理');
    // 长期定义卡：toggleDone 兜底直接返回（不写 marks）
    const cloudPath = require.resolve(path.join(ROOT, 'utils/cloud.js'));
    const cloud = require(cloudPath);
    const prevSetMark = cloud.setMark;
    const marks = [];
    cloud.setMark = function (kind, ref, val) { marks.push({ kind: kind, ref: ref, val: val }); return Promise.resolve(true); };
    try {
      def.toggleDone.call(ctx, { currentTarget: { dataset: { gid: 'rec1' } } });
      await sleep(5);
      assert.strictEqual(marks.length, 0, '长期定义卡不得写已处理');
      assert.strictEqual(!!ctx._done.rec1, false);
      // 资料卡可标记已处理（信息态；本来就不计入待处理）
      const beforePending = ctx.data.stats.pending;
      def.toggleDone.call(ctx, { currentTarget: { dataset: { gid: 'info1' } } });
      await sleep(5);
      assert.strictEqual(ctx._done.info1, true, '资料卡标记已处理（本机 ntdone）');
      assert.strictEqual(ctx.data.stats.pending, beforePending, '资料卡本就不计入待处理');
      assert.strictEqual(marks[marks.length - 1].ref, 'info1');
      // 主列表紧急条不受影响
      assert.deepStrictEqual(idsOf(ctx.data.cards).filter(function (x) { return x === 'urgent'; }), ['urgent']);
      // 资料栏默认展开 → 图片/body 懒加载在展开状态执行；折叠后不预载
      const ensured = [];
      ctx.ensureImgs = function (gid) { ensured.push(gid); return Promise.resolve([]); };
      ctx._all.forEach(function (c) { if (c.id === 'info1') c.imgCount = 1; });
      delete ctx._expanded.info1;             // 回到默认展开
      ctx.data.showInfo = true;
      def.applyFilter.call(ctx);
      assert.ok(ensured.indexOf('info1') >= 0, '资料栏默认展开 → 按需加载图片');
      ensured.length = 0;
      ctx.data.showInfo = false;
      def.applyFilter.call(ctx);
      assert.deepStrictEqual(ensured, [], '资料栏折叠后不加载图片');
    } finally {
      cloud.setMark = prevSetMark;
    }
    restoreWx();
  });

  /* ============================================================
     6. 静态接线（契约 2026-11-14 §2/§3/§5.2）+ 红线
     ============================================================ */
  await test('长期通知静态：nt.js 接线（longtermSubtypeOf / 期次 / 排序 / 资料栏 / 长期清单 / 无新增网络请求）', function () {
    const ntJs = src('pages/nt/nt.js');
    assert.ok(/notice\.statOf\(rawAll, doneMap, now\)/.test(ntJs), '统计走 utils/notice.statOf');
    assert.ok(/notice\.longtermSubtypeOf\(go, now\)/.test(ntJs), 'applyFilter 用 longtermSubtypeOf 区分 recur/info');
    assert.ok(/notice\.occOf\(go, now\)/.test(ntJs), '期次窗口算法接线');
    assert.ok(/notice\.mainEntryCompare\(/.test(ntJs), '主列表应用期次参与排序');
    assert.ok(/notice\.longtermCompare\(a\.raw, b\.raw, now\)/.test(ntJs), '长期清单按下次时间排序');
    assert.ok(/toggleInfo\s*\(\)/.test(ntJs), '缺少 toggleInfo');
    assert.ok(/infoCards/.test(ntJs) && /infoCount/.test(ntJs) && /showInfo/.test(ntJs), '缺少「资料 / 无时间」数据字段');
    assert.ok(/longtermCards/.test(ntJs) && /longtermCount/.test(ntJs), '缺少长期清单数据字段');
    assert.ok(/_cardById\(id\)\s*\{[\s\S]{0,900}infoCards/.test(ntJs), '_cardById 应覆盖资料栏');
    assert.ok(/patchCard\(gid, patch\)\s*\{[\s\S]{0,500}'infoCards'/.test(ntJs), 'patchCard 应覆盖资料栏');
    assert.ok(/needInfo/.test(ntJs) && /inInfo/.test(ntJs), 'jumpPendingGid 应识别资料栏卡片并自动展开');
    // 零新增网络请求
    assert.ok(!/wx\.request\(/.test(ntJs), 'nt.js 不应新增 wx.request');
    assert.ok(!/wx\.uploadFile/.test(ntJs), 'nt.js 不应新增 wx.uploadFile');
    assert.strictEqual((ntJs.match(/wx\.downloadFile\(/g) || []).length, 1, 'downloadFile 仍只用于附件（无新增网络请求）');
  });

  await test('长期通知静态：nt.wxml 资料栏/长期清单/期次模板；nt.wxss 样式 + 触控 ≥40px', function () {
    const wxml = src('pages/nt/nt.wxml');
    assert.ok(/bindtap="toggleInfo"/.test(wxml), '缺少资料栏折叠头点击入口');
    assert.ok(/资料 \/ 无时间/.test(wxml), '缺少「资料 / 无时间」栏');
    assert.ok(/<template is="ntCard" data="\{\{card: item\}\}" \/>/.test(wxml), '复用现有卡片模板');
    assert.ok(/wx:for="\{\{infoCards\}\}"/.test(wxml), '资料栏遍历 infoCards');
    assert.ok(/wx:for="\{\{longtermCards\}\}"/.test(wxml), '长期通知筛选遍历 longtermCards');
    assert.ok(/showInfo \? '▴ 收起' : '▾ 展开'/.test(wxml), '资料栏展开/收起文案');
    assert.ok(/本次已处理/.test(wxml) && /card\.isOcc/.test(wxml), '期次卡「本次已处理」');
    assert.ok(/nt-recur-badge">长期安排/.test(wxml), '期次卡「长期安排」徽标');
    // 位置：主列表 → 资料栏 → 已过期区
    const cardsIdx = wxml.indexOf('wx:for="{{cards}}"');
    const infoIdx = wxml.indexOf('nt-info');
    const expIdx = wxml.indexOf('nt-expired');
    assert.ok(cardsIdx >= 0 && infoIdx > cardsIdx && expIdx > infoIdx, '分区顺序应为 主列表 → 资料栏 → 已过期区');
    const wxss = src('pages/nt/nt.wxss');
    assert.ok(/\.nt-info \{/.test(wxss), '缺少 .nt-info');
    assert.ok(/\.nt-info-hd \{[^}]*min-height: 84rpx/.test(wxss), '资料栏折叠头点按区应 ≥40px（84rpx）');
    assert.ok(/\.nt-lt-row \{/.test(wxss) && /\.nt-lt-next \{/.test(wxss), '长期清单样式');
    assert.ok(!/url\(\s*['"]?https?:/i.test(wxss) && !/@import/.test(wxss), '不得引入外部资源');
    assert.ok(!/https?:\/\//.test(wxml), 'wxml 不得引入外链');
  });

  await test('长期通知静态：工作台待办新口径（期次计入 / 资料与长期定义不计）+ VERSION 2.0.4 + statOf/mostUrgent 同口径', function () {
    const indexJs = src('pages/index/index.js');
    assert.ok(/notice\.isLongterm\(g, now\)/.test(indexJs), '工作台应排除资料/无时间（longtermSubtypeOf 口径）');
    assert.ok(/notice\.occOf\(g, now\)/.test(indexJs) && /done\[occ\.key\]/.test(indexJs), '工作台期次计入待办轮换');
    assert.ok(/notice\.hasTimeAnchor\(g\)/.test(indexJs), '工作台无时间不计');
    const n = noticeMod();
    const noticeJs = src('utils/notice.js');
    assert.ok(/if \(isLongterm\(g\)\) return;/.test(noticeJs), 'statOf 应排除资料/无时间');
    assert.ok(/if \(isLongterm\(g\)\) return false;/.test(noticeJs), 'mostUrgent 应排除资料/无时间');
    assert.ok(Object.prototype.hasOwnProperty.call(n, 'occOf') && typeof n.occOf === 'function');
    assert.ok(typeof n.mainEntryCompare === 'function' && typeof n.longtermCompare === 'function' && typeof n.orderLongterm === 'function');
    assert.ok(typeof n.fmtDatesCn === 'function' && typeof n.statOf === 'function');
    // 红线：版本号为当前 2.0.4
    assert.ok(/VERSION\s*=\s*'2\.0\.4'/.test(src('utils/version.js')), 'VERSION 必须为 2.0.4');
  });
}

module.exports = { run: run };

/* 独立运行：node notice_longterm_unit.js */
if (require.main === module) {
  const results = [];
  let passN = 0, failN = 0;
  const test = async function (name, fn) {
    try { await fn(); passN += 1; results.push({ name: name, ok: true }); console.log('PASS  ' + name); }
    catch (e) { failN += 1; results.push({ name: name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
  };
  run(test).then(function () {
    const summary = { total: passN + failN, pass: passN, fail: failN, results: results, at: new Date().toISOString() };
    fs.writeFileSync(path.join(__dirname, 'notice_longterm_result.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log('\n================ notice longterm: ' + passN + ' passed, ' + failN + ' failed ================');
    process.exitCode = failN ? 2 : 0;
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}
