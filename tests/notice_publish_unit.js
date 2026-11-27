/* notice_publish_unit.js —— 契约 2026-11-18：通知「发布时间」统一（小程序端）
 *
 * 契约：web/通知三端_发布时间统一_契约_20261118.md（§1 数据 / §2 状态 / §3 分类 / §4 排序 / §5 统计 / §6 兼容）
 * 被测：
 *   utils/notice.js  publishedTsOf（publishedAt 优先，旧缓存回退 pubTsOf）
 *                    statusOf 最终 none 之前的 published 分支（label/cls/expired/动作优先）
 *                    hasTimeAnchor 保持只看真实锚点 / longtermSubtypeOf 把发布卡移出资料栏
 *                    listRankOf 档 4 / mainListCompare · mainEntryCompare 档 4 发布时间倒序
 *                    statOf（发布卡计入待处理、24h/7 天窗口不进、latest 用 publishedAt）
 *   pages/nt/nt.js   applyFilter 发布卡进主列表、资料栏 0 条隐藏、最新发布倒序、_briefNextOf 计入
 *   pages/index/index.js 工作台待办数/轮换计入发布卡
 *   pages/nt/nt.wxml 资料栏只在 infoCount>0 渲染（0 条隐藏）
 *
 * 运行：node notice_publish_unit.js        # 独立运行
 *       node unit.js                      # unit.js 末尾并入总表
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
function at(y, mo, d, hh, mi) { return new Date(y, mo - 1, d, hh || 0, mi || 0, 0, 0).getTime(); }
function md(ts) { const d = new Date(ts); return pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function hhmm(ts) { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function ymd(ts) { const d = new Date(ts); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); }
function idsOf(list) { return (list || []).map(function (c) { return c.id; }); }
function occRefOf(gid, ts) { return gid + '@occ:' + ymd(ts); }

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
function loadIndexPage() {
  // unit.js 里 pages/index 可能已被其它专项 require 过（require.cache 命中后不会再调 Page()）→ 先清缓存
  Object.keys(require.cache).forEach(function (k) {
    if (k.replace(/\\/g, '/').indexOf(ROOT + '/pages/index/') === 0) delete require.cache[k];
  });
  const hadPage = Object.prototype.hasOwnProperty.call(global, 'Page');
  const prevPage = global.Page;
  let def = null;
  global.Page = function (d) { def = d; };
  try { require(path.join(ROOT, 'pages/index/index.js')); } finally {
    if (hadPage) global.Page = prevPage; else delete global.Page;
  }
  return def;
}

/* ---------- 页面 mock（与 pages/nt mapGroup 同口径的轻量卡片） ---------- */
function cardOf(g, now) {
  const n = noticeMod();
  const st = n.statusOf(g, now);
  const rec = n.recurOf(g);
  const ended = !!rec && n.isRecurEnded(g, now);
  return {
    id: g.id, title: g.title || g.id, cat: g.cat || '通知', catCls: 'qt',
    source: '', sourceKind: 'doc', senderName: '', senderRole: '', senderBadge: '', pubBadge: '',
    isOcr: false, statusLabel: n.fmtDatesCn(st.label, now), statusCls: st.cls, expired: !!st.expired,
    timeLabel: '', summary: '', points: [], segs: [], items: [], quotes: [], hasRaw: false, hasDetail: false,
    compose: [], filesCount: 0, imgCount: 0, moreText: '', expanded: !st.expired, done: false,
    recurring: !!rec && !ended, recurLabel: rec ? n.recurLabelOf(g) : '',
    nextText: (rec && !ended) ? n.nextTextOf(g, now) : '',
    nextCnText: (rec && !ended) ? n.nextCnTextOf(g, now) : '',
    isOcc: false, isInfo: false, recurEnded: ended,
    pubTs: n.publishedTsOf(g, now),
    hidden: !!g._hidden, updated: false, admin: false,
    deadlineTs: n.deadlineOf(g), canRemind: !st.expired && !rec, reminded: false,
    remindText: '', remindLabel: '提醒', imgs: []
  };
}
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
function makeCtx(def, raws, now) {
  const ctx = {
    data: JSON.parse(JSON.stringify(def.data)),
    _raw: raws,
    _all: raws.map(function (g) { return cardOf(g, now); }),
    _expanded: {}, _done: {}, _remind: {}, _imgs: {}, _loadingImgs: {}, _foldTimers: {},
    ensureImgs() { return Promise.resolve([]); },
    _needsGroupBody() { return false; },
    _rawById: def._rawById,
    _cardById: def._cardById,
    patchCard: def.patchCard
  };
  ctx.setData = makeSetData(ctx);
  Object.keys(def).forEach(function (k) {
    if (typeof def[k] === 'function' && typeof ctx[k] !== 'function') ctx[k] = def[k];
  });
  return ctx;
}

/* ================================================================ run */
async function run(test) {

  /* ============================================================
     1. §1/§6：publishedTsOf —— publishedAt 优先、旧数据回退 pubTsOf
     ============================================================ */
  await test('发布§1：publishedTsOf 优先 publishedAt（ISO +08:00），缺字段/坏字段回退 pubTsOf', function () {
    const n = noticeMod();
    const NOW = at(2026, 11, 18, 12, 50);
    // 1) publishedAt 优先：items 时间更早也以 publishedAt 为准
    const g1 = { id: 'g1', publishedAt: '2026-11-16T22:15:00+08:00', items: [{ kind: 'text', time: '11-10 08:00' }] };
    assert.strictEqual(n.publishedTsOf(g1, NOW), at(2026, 11, 16, 22, 15), 'publishedAt 优先于 items 时间');
    assert.strictEqual(n.pubTsOf(g1, NOW), at(2026, 11, 10, 8, 0), 'pubTsOf 仍只看 items/updatedAt（旧口径保留）');
    // 2) 缺 publishedAt → 回退 items 最新时间（旧缓存）
    const g2 = { id: 'g2', items: [{ kind: 'text', time: '11-15 09:00' }, { kind: 'file', time: '11-16 21:00' }] };
    assert.strictEqual(n.publishedTsOf(g2, NOW), n.pubTsOf(g2, NOW), '缺字段回退 pubTsOf');
    assert.strictEqual(n.publishedTsOf(g2, NOW), at(2026, 11, 16, 21, 0));
    // 3) 坏 publishedAt → 回退
    const g3 = { id: 'g3', publishedAt: 'not-a-date', items: [{ kind: 'text', time: '11-14 07:30' }] };
    assert.strictEqual(n.publishedTsOf(g3, NOW), at(2026, 11, 14, 7, 30), '坏 publishedAt 回退推算');
    // 4) updatedAt 与 items 取较晚者（补充/更正）
    const g4 = { id: 'g4', items: [{ kind: 'text', time: '11-14 07:30' }], updatedAt: '2026-11-17T18:20:00+08:00' };
    assert.strictEqual(n.publishedTsOf(g4, NOW), at(2026, 11, 17, 18, 20), 'updatedAt 较晚取 updatedAt');
    // 5) 完全没有可解析时间 → null（维持旧「无时间」行为）
    assert.strictEqual(n.publishedTsOf({ id: 'g5' }, NOW), null);
    assert.strictEqual(n.publishedTsOf({ id: 'g6', items: [{ kind: 'text', text: '没有时间' }] }, NOW), null);
    assert.strictEqual(n.publishedTsOf(null, NOW), null, '空值安全');
  });

  /* ============================================================
     2. §2：statusOf 最终 none 之前的 published 分支
     ============================================================ */
  await test('发布§2：statusOf 无锚点未过期 → {key:published, label:"<时间> 发布", cls:active, expired:false}', function () {
    const n = noticeMod();
    const NOW = at(2026, 11, 18, 12, 50);
    // 1) publishedAt + publishAction
    const p = { id: 'p', publishedAt: '2026-11-16T22:15:00+08:00', publishAction: '发布' };
    assert.deepStrictEqual(n.statusOf(p, NOW), { key: 'published', label: '11-16 22:15 发布', cls: 'active', expired: false });
    // 2) 缺 publishAction → 动作仍为「发布」
    assert.strictEqual(n.statusOf({ id: 'p2', publishedAt: '2026-11-16T22:15:00+08:00' }, NOW).label, '11-16 22:15 发布');
    // 3) 动作文案优先取 publishAction
    assert.strictEqual(n.statusOf({ publishedAt: '2026-11-16T22:15:00+08:00', publishAction: '公告' }, NOW).label, '11-16 22:15 公告');
    // 4) 旧缓存无 publishedAt → 用 items 时间推算，仍为发布卡（不退回「无时间」）
    const old = { id: 'old', items: [{ kind: 'text', time: '11-16 22:15', text: '正文' }] };
    assert.deepStrictEqual(n.statusOf(old, NOW), { key: 'published', label: '11-16 22:15 发布', cls: 'active', expired: false });
    // 5) 连发布时间都没有 → 旧「无时间」
    assert.deepStrictEqual(n.statusOf({ id: 'none' }, NOW), { key: 'none', label: '无时间', cls: 'none', expired: false });
    // 6) fmtWhen 口径：未来发布（异常数据）走相对时间
    assert.strictEqual(n.statusOf({ publishedAt: iso(NOW + 2 * H) }, NOW).label, '2 小时后 发布');
    // 7) 已过期优先：AI 质检 expired:true / 真实截止已过 / alert 都不因 publishedAt 变发布
    assert.strictEqual(n.statusOf({ expired: true, publishedAt: '2026-11-16T22:15:00+08:00' }, NOW).key, 'expired');
    assert.strictEqual(n.statusOf({ deadline: iso(NOW - D), publishedAt: '2026-11-16T22:15:00+08:00' }, NOW).key, 'expired');
    assert.strictEqual(n.statusOf({ deadline: iso(NOW - D), alert: true, publishedAt: '2026-11-16T22:15:00+08:00' }, NOW).key, 'alert');
    // 8) 长期安排优先：publishedAt 不影响 recurrence 分支
    const rec = { recurrence: { freq: 'daily', time: '08:00' }, publishedAt: '2026-11-16T22:15:00+08:00' };
    assert.strictEqual(n.statusOf(rec, NOW).key, 'recurring');
    // 9) 有真实时间锚点优先：不会被发布卡覆盖
    const real = { deadline: iso(NOW + 3 * H), publishedAt: '2026-11-16T22:15:00+08:00' };
    assert.strictEqual(n.statusOf(real, NOW).key, 'today');
  });

  /* ============================================================
     3. §3：分类 —— hasTimeAnchor 只看真实锚点；发布卡移出资料栏
     ============================================================ */
  await test('发布§3：hasTimeAnchor 不含发布时间；longtermSubtypeOf 发布卡 → ""（资料栏只留兜底卡）', function () {
    const n = noticeMod();
    const NOW = at(2026, 11, 18, 12, 50);
    const p = { id: 'p', publishedAt: '2026-11-16T22:15:00+08:00', publishAction: '发布' };
    assert.strictEqual(n.hasTimeAnchor(p), false, '发布时间不算真实时间锚点（hasTimeAnchor 口径不变）');
    assert.strictEqual(n.hasTimeAnchor({ items: [{ time: '11-16 22:15' }] }), false);
    assert.strictEqual(n.longtermSubtypeOf(p, NOW), '', '发布卡不进资料栏');
    assert.strictEqual(n.isLongterm(p, NOW), false);
    assert.strictEqual(n.longtermSubtypeOf({ items: [{ time: '11-16 22:15' }] }, NOW), '', '旧缓存可推算发布 → 不进资料栏');
    // 兜底：既无锚点又无发布时间 → info（正常数据 0 条）
    assert.strictEqual(n.longtermSubtypeOf({ id: 'fallback' }, NOW), 'info');
    assert.strictEqual(n.isLongterm({ id: 'fallback' }, NOW), true);
    // 长期安排 / 已过期分类优先
    assert.strictEqual(n.longtermSubtypeOf({ recurrence: { freq: 'daily', time: '08:00' }, publishedAt: iso(NOW - H) }, NOW), 'recur');
    assert.strictEqual(n.longtermSubtypeOf({ expired: true, publishedAt: iso(NOW - H) }, NOW), '', '过期卡走已过期区，不是资料栏');
    assert.strictEqual(n.hasTimeAnchor({ deadline: iso(NOW + D) }), true, '真实截止仍是时间锚点');
  });

  /* ============================================================
     4. §4：排序 —— 档 4；档内发布时间倒序，无发布时间最后
     ============================================================ */
  await test('发布§4：listRankOf 档 4 / mainListCompare · mainEntryCompare 档内发布时间倒序', function () {
    const n = noticeMod();
    const NOW = at(2026, 11, 18, 12, 50);
    const active = { id: 'active', deadline: iso(NOW + 5 * D) };                      // 档 3
    const pubNew = { id: 'pubNew', publishedAt: iso(NOW - 1 * H) };                   // 档 4，新
    const pubOld = { id: 'pubOld', publishedAt: iso(NOW - 3 * D) };                   // 档 4，旧
    const pubFallback = { id: 'pubFallback', items: [{ kind: 'text', time: md(NOW - 30 * H) + ' ' + hhmm(NOW - 30 * H) }] };
    const noneG = { id: 'none' };                                                     // 档 4，无发布时间
    const donePub = { id: 'donePub', publishedAt: iso(NOW - 2 * H) };                 // 档 9
    assert.strictEqual(n.listRankOf(pubNew, {}, NOW), 4, '发布卡档位 4');
    assert.strictEqual(n.listRankOf(noneG, {}, NOW), 4, '无时间兜底同为 4');
    assert.strictEqual(n.listRankOf(active, {}, NOW), 3);
    assert.strictEqual(n.listRankOf(donePub, { donePub: true }, NOW), 9, '已处理仍最后');
    // 主列表：档 3 在前；档 4 内 publishedAt/回退推算倒序；无发布时间最后
    const source = [donePub, noneG, pubOld, pubFallback, active, pubNew];
    const sorted = source.slice().sort(function (a, b) {
      return n.mainListCompare(a, b, { donePub: true }, NOW) || (source.indexOf(a) - source.indexOf(b));
    });
    assert.deepStrictEqual(idsOf(sorted), ['active', 'pubNew', 'pubFallback', 'pubOld', 'none', 'donePub'],
      '档 4 发布时间倒序 + none 最后：' + idsOf(sorted).join(','));
    // 同发布时间保持数据源顺序（稳定排序由调用方兜底）
    const tieA = { id: 'tieA', publishedAt: iso(NOW - 2 * D) };
    const tieB = { id: 'tieB', publishedAt: iso(NOW - 2 * D) };
    assert.strictEqual(n.mainListCompare(tieA, tieB, {}, NOW), 0);
    // 期次参与的主列表比较：期次档 1 在发布卡之前；发布卡之间同样倒序
    const occEntry = { g: { id: 'rec', recurrence: { freq: 'daily', time: hhmm(NOW + H) }, actionable: true }, occ: { key: 'rec@occ:20261118', next: NOW + H } };
    assert.ok(n.mainEntryCompare(occEntry, { g: pubNew }, {}, NOW) < 0, '期次（档 1）排在发布卡前');
    assert.ok(n.mainEntryCompare({ g: pubNew }, { g: pubOld }, {}, NOW) < 0, 'mainEntryCompare 档 4 新在上');
    assert.ok(n.mainEntryCompare({ g: pubOld }, { g: noneG }, {}, NOW) < 0, '有发布时间排无发布时间之前');
    assert.ok(n.mainEntryCompare({ g: active }, { g: pubNew }, {}, NOW) < 0, '档 3 在档 4 之前');
  });

  /* ============================================================
     5. §5：统计 —— 发布卡计入待处理；24h/7 天不进；latest 用 publishedAt
     ============================================================ */
  await test('发布§5：statOf 发布卡按 actionable 计入待处理；24h/7 天窗口不进；latest 优先 publishedAt', function () {
    const n = noticeMod();
    const NOW = at(2026, 11, 18, 12, 50);
    const pub = { id: 'pub', publishedAt: iso(NOW - 2 * D) };
    const pubFallback = { id: 'pubf', items: [{ kind: 'text', time: md(NOW - 30 * H) + ' ' + hhmm(NOW - 30 * H) }] };
    const pubNoAction = { id: 'pna', publishedAt: iso(NOW - D), actionable: false };
    const pubDone = { id: 'pdn', publishedAt: iso(NOW - D) };
    const pubExpired = { id: 'pexp', publishedAt: iso(NOW - D), expired: true };
    const fallbackInfo = { id: 'info' };                                              // 既无锚点又无发布时间
    const urgent = { id: 'u', deadline: iso(NOW + 2 * H) };
    const longRec = { id: 'rec', recurrence: { freq: 'daily', time: '08:00' }, actionable: false, publishedAt: iso(NOW - 3 * D) };
    const done = { pdn: true };
    const st = n.statOf([pub, pubFallback, pubNoAction, pubDone, pubExpired, fallbackInfo, urgent, longRec], done, NOW);
    assert.strictEqual(st.pending, 3, '待处理 = pub + pubFallback + urgent（actionable=false/已处理/过期/资料不计）：' + JSON.stringify(st));
    assert.strictEqual(st.urgent, 1, '24h 窗口只算真实主显示时间（发布卡不进）');
    assert.strictEqual(st.week, 1, '7 天窗口只算真实主显示时间（发布卡不进）');
    assert.strictEqual(st.expired, 1, '已过期统计不变');
    assert.strictEqual(st.longterm, 1, '长期安排条数不受发布时间影响');
    // latest：publishedAt 优先于 items 时间；hidden 不参与
    const g = { id: 'g', publishedAt: '2026-11-17T20:00:00+08:00', items: [{ kind: 'text', time: '11-14 08:00' }] };
    const gHidden = { id: 'h', _hidden: true, publishedAt: '2026-11-18T11:00:00+08:00' };
    const latest = n.latestOf([g, gHidden], NOW);
    assert.strictEqual(latest.ts, at(2026, 11, 17, 20, 0), 'latest 优先 publishedAt');
    assert.ok(latest.text.indexOf('20:00') >= 0, 'latest 相对文案沿用既有格式：' + latest.text);
    assert.strictEqual(n.statOf([g], {}, NOW).latest, at(2026, 11, 17, 20, 0));
    // mostUrgent 仍排除资料兜底；发布卡可参与（无主显示时间 → 排后）
    assert.strictEqual(n.mostUrgent([fallbackInfo], {}, NOW), null, '资料兜底不参与最紧急');
    assert.strictEqual(n.mostUrgent([pub, fallbackInfo, urgent], {}, NOW).id, 'u', '发布卡不抢占真实截止的紧急位');
  });

  /* ============================================================
     6. pages/nt：发布卡进主列表、资料栏按兜底卡显隐、最新发布倒序、简报计入
     ============================================================ */
  await test('发布§6：pages/nt applyFilter —— 发布卡进主列表/资料栏 0 条隐藏/最新发布倒序/简报计入', function () {
    const def = loadNtPage();
    const n = noticeMod();
    assert.ok(def && typeof def.applyFilter === 'function', 'nt 页缺少 applyFilter');
    const now = Date.now();
    const pubNew = { id: 'pubNew', title: '新发布', cat: '教务', publishedAt: iso(now - H), publishAction: '发布' };
    const pubOld = { id: 'pubOld', title: '旧发布', cat: '教务', publishedAt: iso(now - 3 * D), publishAction: '发布' };
    const pubFallback = { id: 'pubFallback', title: '旧缓存发布', cat: '团务', items: [{ kind: 'text', time: md(now - 30 * H) + ' ' + hhmm(now - 30 * H) }] };
    const active = { id: 'active', title: '较远截止', cat: '团务', deadline: iso(now + 5 * D) };
    const fallbackInfo = { id: 'fallbackInfo', title: '资料兜底', cat: '教务' };
    const expired = { id: 'expired', title: '已过期', cat: '教务', deadline: iso(now - D) };
    const raws = [pubOld, active, pubNew, pubFallback, fallbackInfo, expired];
    const ctx = makeCtx(def, raws, now);
    ctx.data.filter = 'all'; ctx.data.cat = '全部'; ctx.data.isAdmin = false;
    def.applyFilter.call(ctx);
    const mainIds = idsOf(ctx.data.cards);
    assert.ok(mainIds.indexOf('pubNew') >= 0 && mainIds.indexOf('pubOld') >= 0 && mainIds.indexOf('pubFallback') >= 0,
      '发布卡全部进主列表：' + mainIds.join(','));
    assert.deepStrictEqual(mainIds.slice(0, 4), ['active', 'pubNew', 'pubFallback', 'pubOld'],
      '主列表档 3 → 档 4 发布时间倒序：' + mainIds.join(','));
    // 资料栏：只剩「既无锚点又无发布时间」的兜底卡
    assert.deepStrictEqual(idsOf(ctx.data.infoCards), ['fallbackInfo'], '资料栏只剩兜底卡');
    assert.strictEqual(ctx.data.infoCount, 1);
    // 状态胶囊：发布卡 chip = M月D日（周X） HH:MM 发布（显示层统一格式）
    const card = ctx.data.cards.filter(function (c) { return c.id === 'pubNew'; })[0];
    assert.strictEqual(card.statusCls, 'active');
    assert.ok(/^\d{1,2}月\d{1,2}日（[^）]+） \d\d:\d\d 发布$/.test(card.statusLabel), '发布 chip 格式：' + card.statusLabel);
    assert.strictEqual(card.canDone, true, '发布卡可标记已处理（交互不变）');
    // 统计：active + 3 张发布卡计入待处理；24h 不进、7 天窗口只算 active（发布卡主显示时间为空）
    assert.strictEqual(ctx.data.stats.pending, 4, '待处理含发布卡：' + JSON.stringify(ctx.data.stats));
    assert.strictEqual(ctx.data.stats.urgent, 0);
    assert.strictEqual(ctx.data.stats.week, 1, '7 天窗口只算真实主显示时间（active 5 天）');
    // 简报：发布卡计入，主显示时间为空 → 排真实截止之后
    const brief = def._briefNextOf.call(ctx, now);
    assert.ok(brief.some(function (x) { return /发布$/.test(x.meta); }), '简报计入发布卡：' + JSON.stringify(brief));
    assert.strictEqual(brief[0].id, 'active', '简报真实主显示时间优先');
    // 「最新发布」筛选：publishedAt 倒序（pubNew 最新、pubOld/回退随后）
    ctx.data.filter = 'latest';
    def.applyFilter.call(ctx);
    const latestIds = idsOf(ctx.data.cards);
    assert.strictEqual(latestIds[0], 'pubNew', '最新发布按 publishedAt 倒序：' + latestIds.join(','));
    assert.ok(latestIds.indexOf('pubFallback') < latestIds.indexOf('pubOld'), '旧发布时间倒序（30h 前 > 3d 前）');
    // 无兜底卡时资料栏 0 条（UI 由 wxml infoCount 条件隐藏）
    const ctx2 = makeCtx(def, [pubNew, active], now);
    ctx2.data.filter = 'all'; ctx2.data.cat = '全部'; ctx2.data.isAdmin = false;
    def.applyFilter.call(ctx2);
    assert.strictEqual(ctx2.data.infoCount, 0, '无兜底卡 → 资料栏 0 条');
    assert.deepStrictEqual(idsOf(ctx2.data.infoCards), []);
  });

  /* ============================================================
     7. pages/index：工作台待办数 + 轮换计入发布卡
     ============================================================ */
  await test('发布§7：工作台 ntView 待办数含发布卡、轮换列出发布卡（资料兜底仍不计）', function () {
    const def = loadIndexPage();
    assert.ok(def && typeof def.ntView === 'function', 'index 页缺少 ntView');
    const now = Date.now();
    const groups = [
      { id: 'urgent', title: '紧急', deadline: iso(now + H) },
      { id: 'pub', title: '发布通知', publishedAt: iso(now - H), publishAction: '发布' },
      { id: 'fallback', title: '资料兜底' },
      { id: 'recdef', title: '长期安排定义', recurrence: { freq: 'daily', time: hhmm(now + H) }, actionable: false },
      { id: 'expired', title: '已过期', deadline: iso(now - D) }
    ];
    const view = def.ntView.call({}, groups);
    assert.strictEqual(view.pending, 2, '工作台待办 = 紧急 + 发布卡（资料兜底/长期定义/已过期不计）：' + view.pending);
    const titles = view.items.map(function (it) { return it.title; });
    assert.ok(titles.indexOf('发布通知') >= 0, '发布卡进入工作台轮换：' + JSON.stringify(titles));
    assert.ok(titles.indexOf('资料兜底') < 0, '资料兜底不进轮换');
    assert.strictEqual(view.items[0].title, '紧急', '真实截止排在发布卡之前');
    const pubItem = view.items.filter(function (it) { return it.title === '发布通知'; })[0];
    assert.ok(/发布$/.test(pubItem.sub), '发布卡轮换副标以「发布」结尾：' + pubItem.sub);
  });

  /* ============================================================
     8. 静态接线 + 兼容红线
     ============================================================ */
  await test('发布§8：静态接线（publishedTsOf 导出/页面使用/资料栏 infoCount 条件/版本与网络红线）', function () {
    const n = noticeMod();
    assert.strictEqual(typeof n.publishedTsOf, 'function', 'utils/notice 必须导出 publishedTsOf');
    const noticeJs = src('utils/notice.js');
    assert.ok(/function publishedTsOf\(g, nowTs\)/.test(noticeJs), '缺 publishedTsOf');
    assert.ok(/parseTs\(g\.publishedAt\)/.test(noticeJs), 'publishedTsOf 必须先读 publishedAt');
    assert.ok(/st\.key === 'published'\) return 4/.test(noticeJs), 'listRankOf 发布卡 = 4');
    assert.ok(/if \(ra === 4\) return rank4Compare\(/.test(noticeJs), '主列表档 4 倒序接线');
    assert.ok(/publishedTsOf\(g, now\) == null\) return;/.test(noticeJs), 'statOf 发布卡视为有时间锚点');
    const ntJs = src('pages/nt/nt.js');
    assert.ok(/pubTs: notice\.publishedTsOf\(g, now\)/.test(ntJs), 'nt mapGroup 发布时间走 publishedTsOf');
    assert.ok(/notice\.publishedTsOf\(go, now\) == null\) return;/.test(ntJs), '简报计入发布卡');
    assert.ok(/statusLabel: notice\.fmtDatesCn\(st\.label, now\)/.test(ntJs), '发布 chip 走显示层统一格式');
    const indexJs = src('pages/index/index.js');
    assert.ok(/notice\.publishedTsOf\(g, now\) == null\) return;/.test(indexJs), '工作台轮换计入发布卡');
    // 「资料 / 无时间」栏只在有兜底卡时渲染（0 条隐藏/空态由 infoCount 条件保证）
    const wxml = src('pages/nt/nt.wxml');
    assert.ok(/wx:if="\{\{filter === 'all' && infoCount\}\}" class="nt-info"/.test(wxml), '资料栏应有 infoCount 条件');
    assert.ok(/资料 \/ 无时间/.test(wxml), '资料栏兜底交互保留');
    // 兼容红线：版本号为当前 2.1.3、无新增网络请求/依赖
    assert.ok(/VERSION\s*=\s*'2\.1\.3'/.test(src('utils/version.js')), 'VERSION 必须为 2.1.3');
    assert.ok(ntJs.indexOf('wx.request(') < 0, 'nt.js 不应新增 wx.request');
    assert.ok(indexJs.indexOf('wx.request(') < 0, 'index.js 不应新增 wx.request');
    const pkg = JSON.parse(src('project.config.json'));
    assert.ok(!pkg.dependencies || !Object.keys(pkg.dependencies).length, '不得新增依赖');
  });
}

module.exports = { run: run };

/* 独立运行：node notice_publish_unit.js */
if (require.main === module) {
  const results = [];
  let passN = 0, failN = 0;
  const test = async function (name, fn) {
    try { await fn(); passN += 1; results.push({ name: name, ok: true }); console.log('PASS  ' + name); }
    catch (e) { failN += 1; results.push({ name: name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
  };
  run(test).then(function () {
    const summary = { total: passN + failN, pass: passN, fail: failN, results: results, at: new Date().toISOString() };
    fs.writeFileSync(path.join(__dirname, 'notice_publish_result.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log('\n================ notice publish: ' + passN + ' passed, ' + failN + ' failed ================');
    process.exitCode = failN ? 2 : 0;
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}
