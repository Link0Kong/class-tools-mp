/* notice_occ_unit.js —— 契约 2026-11-14：长期通知「期次」+ 5 卡可点筛选 + 资料栏 + 时间格式（小程序端）
 *
 * 契约：web/通知三端_长期通知与时间显示_契约_20261114.md（§1/§2/§3/§5.2）
 * 被测：
 *   utils/notice.js  until 解析 / isRecurEnded / nextOf（until 上限）/ occKeyOf / occOf / occLabelOf
 *                    relLabelOf / dateCnOf / dateTimeCnOf / fmtDatesCn / fmtDisplayDates（§3.4 固定向量）
 *                    statOf（§2.4 pending/urgent/week/longterm/latest）/ pubTsOf / latestOf / mainEntryCompare
 *   pages/nt/nt.js   applyFilter 分区（主列表+期次 / 资料栏 / 已过期 / 长期清单 / 最新发布）
 *                    pickCard 5 卡筛选与再点取消、chips 互斥、分类筛选、listCount
 *                    期次 done（marks ntdone，ref=期次 key）→ 该期消失、下一期不受影响、长期定义卡无 done
 *   pages/index/index.js 工作台待办新口径（期次计入、资料/长期定义不计）
 *   pages/nt/nt.wxml|wxss 静态接线（5 卡 / 资料栏 / 期次模板 / 事件 handler / ≥40px / 无外链）
 *
 * 运行：node notice_occ_unit.js          # 独立运行
 *       node unit.js                    # unit.js 末尾并入总表
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
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function idsOf(list) { return (list || []).map(function (c) { return c.id; }); }
// 今日/明日 key 用：实时 now 的本地日期（applyFilter 内部用 Date.now()，夹具必须相对真实时钟构造）
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

/* ---------- 页面 mock ---------- */
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
    ensureImgs() { return Promise.resolve([]); },      // 单测不落图片临时文件
    _needsGroupBody() { return false; },               // 单测不拉完整 body
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
function catOf(list) { return (list || []).map(function (c) { return c.cat; }); }

/* ================================================================ run */
async function run(test) {

  /* ============================================================
     1. 契约 §1.3：until 结束判定 + 期次窗口/key（固定向量）
     ============================================================ */
  test('期次§1.3：nextOf until 上限 / isRecurEnded / recurOf 需合法 time（固定向量）', function () {
    const n = noticeMod();
    const NOW = at(2026, 11, 14, 13, 31);            // 2026-11-14 13:31 周六
    // 向量 1：monthly_weeks → 11-18 17:30；窗口 11-17 17:30 ~ 11-18 17:30；key gid@occ:20261118
    const r1 = { id: 'gid', recurrence: { freq: 'monthly_weeks', weekday: 3, weeks: [1, 2, 3], time: '17:30', startAt: '2026-11-04T17:30:00+08:00' } };
    assert.strictEqual(n.nextOf(r1, NOW), at(2026, 11, 18, 17, 30), 'monthly_weeks 下次 11-18 17:30');
    assert.strictEqual(n.occOf(r1, NOW), null, '窗口未开始（11-17 17:30 才进入）不产生期次');
    const o1 = n.occOf(r1, at(2026, 11, 17, 17, 30));
    assert.ok(o1, '窗口开始时刻应产生期次');
    assert.strictEqual(o1.key, 'gid@occ:20261118', '期次 key = <gid>@occ:<YYYYMMDD>');
    assert.strictEqual(o1.start, at(2026, 11, 17, 17, 30), '窗口起点 = next - 24h');
    assert.strictEqual(o1.next, at(2026, 11, 18, 17, 30));
    assert.strictEqual(n.occOf(r1, at(2026, 11, 18, 17, 30)), null, 'next 时刻起窗口结束（严格 < next）');
    // 向量 2：daily 07:30 until 11-15 → next 11-15 07:30；now 13:31 窗口已开（11-14 07:30 起）
    const r2 = { id: 'g2', recurrence: { freq: 'daily', time: '07:30', startAt: '2026-11-10T07:30:00+08:00', until: '2026-11-15' } };
    assert.strictEqual(n.nextOf(r2, NOW), at(2026, 11, 15, 7, 30), 'until 含当天有效 → next 11-15 07:30');
    const o2 = n.occOf(r2, NOW);
    assert.ok(o2, '窗口 [11-14 07:30, 11-15 07:30) 已开始 → 显示期次');
    assert.strictEqual(o2.key, 'g2@occ:20261115');
    assert.strictEqual(o2.label, '本次 11月15日（明天）07:30', '期次胶囊 = 本次 M月D日（周X）HH:MM');
    assert.strictEqual(n.isRecurEnded(r2, NOW), false);
    // 向量 3：until 11-14 → 下一次（11-15 07:30）已越过 until → 已结束，不再产生期次
    const r3 = { id: 'g3', recurrence: { freq: 'daily', time: '07:30', startAt: '2026-11-10T07:30:00+08:00', until: '2026-11-14' } };
    assert.strictEqual(n.nextOf(r3, NOW), null, 'until 已过 → 无下次');
    assert.strictEqual(n.isRecurEnded(r3, NOW), true, 'until 结束判定');
    assert.strictEqual(n.occOf(r3, NOW), null, '已结束不产生期次');
    assert.strictEqual(n.statusOf(r3, NOW).expired, true, '已结束的长期安排归已过期区');
    assert.strictEqual(n.statusOf(r3, NOW).label, '长期安排已结束');
    // recurrence 缺 time / freq 非法 → 不是长期安排（契约 §1.1）
    assert.strictEqual(n.recurOf({ recurrence: { freq: 'daily' } }), null, '缺 HH:MM time 丢弃 recurrence');
    assert.strictEqual(n.recurOf({ recurrence: { freq: 'bad', time: '08:00' } }), null);
    const r8 = n.recurOf({ recurrence: { freq: 'weekly', time: '8:00' } });
    assert.ok(r8 && r8.hh === 8 && r8.mm === 0, 'time 允许 1-2 位小时并归一化（8:00 → 08:00）');
    assert.strictEqual(n.isLongterm({ recurrence: { freq: 'daily' } }), true, '缺 time 退化为无时间资料（info）');
    assert.strictEqual(n.longtermSubtypeOf({ recurrence: { freq: 'daily' } }), 'info');
    // until 支持 ISO datetime（+08:00）
    const r4 = { recurrence: { freq: 'daily', time: '07:30', until: '2026-11-14T12:00:00+08:00' } };
    assert.strictEqual(n.untilOf(r4), Date.parse('2026-11-14T12:00:00+08:00'), 'ISO until 保留时区语义');
    assert.strictEqual(n.isRecurEnded(r4, NOW), true, 'now 13:31 > ISO until 12:00 → 已结束');
  });

  test('期次§1.3：期次 done 隔离（ref=期次 key；今天已处理不影响下一期）', function () {
    const n = noticeMod();
    const NOW = at(2026, 11, 14, 13, 31);
    const g = { id: 'g_iso', recurrence: { freq: 'daily', time: '07:30', startAt: '2026-11-10T07:30:00+08:00' } };
    const oToday = n.occOf(g, NOW);
    assert.ok(oToday);
    const tomorrow = at(2026, 11, 15, 13, 0);
    const oTomorrow = n.occOf(g, tomorrow);
    assert.ok(oTomorrow);
    assert.notStrictEqual(oToday.key, oTomorrow.key, '不同期次 key 不同');
    assert.strictEqual(n.isOccRef(oToday.key), true);
    assert.strictEqual(n.baseGidOfRef(oToday.key), 'g_iso');
    // done 只按 key 命中：今天的 done 不影响明天的期次
    const done = {}; done[oToday.key] = true;
    assert.strictEqual(!!done[oTomorrow.key], false, '已处理只作用于本期 key（期次 done 隔离）');
    // 主列表排序：期次按 next 参与（相当于今天/24h 内档）
    const occEntry = { g: g, occ: oToday };
    const normalSoon = { g: { id: 'n1', deadline: iso(NOW + 3 * H) }, occ: null };
    const normalLater = { g: { id: 'n2', deadline: iso(NOW + 3 * D) }, occ: null };
    assert.ok(n.entryRankOf(g, {}, oToday) === 1, '期次档位 = 1（今天/24h 内）');
    assert.ok(n.mainEntryCompare(occEntry, normalLater, {}, NOW) < 0, '期次排在未来普通通知之前');
    assert.ok(n.mainEntryCompare(occEntry, normalSoon, {}, NOW) > 0, '期次与 urgent/today 同档 → 按 next 升序（约 18h 后 > 3h 后）');
  });

  /* ============================================================
     2. 契约 §3：时间显示统一（§3.4 固定向量，now 固定注入）
     ============================================================ */
  test('时间格式§3.4：MM-DD / M月D日 / ISO → M月D日（相对周）固定向量', function () {
    const n = noticeMod();
    const NOW = at(2026, 11, 14, 13, 31);            // 2026-11-14 13:31 周六
    const F = function (s) { return n.fmtDatesCn(s, NOW); };
    assert.strictEqual(F('11-13'), '11月13日（本周五）');
    assert.strictEqual(F('11-14'), '11月14日（今天）');
    assert.strictEqual(F('11-15'), '11月15日（明天）');
    assert.strictEqual(F('11-12'), '11月12日（本周四）');
    assert.strictEqual(F('11-08'), '11月8日（上周日）');
    assert.strictEqual(F('11-16'), '11月16日（下周一）');
    assert.strictEqual(F('11-20'), '11月20日（下周五）');
    assert.strictEqual(F('12-01'), '12月1日（周二）', '跨 2 周只带周几');
    assert.strictEqual(F('11-13 11-14 不上晚自习'), '11月13日（本周五） 11月14日（今天） 不上晚自习', '一句多个裸日期逐个格式化');
    assert.strictEqual(F('2027-01-03'), '2027年1月3日（周日）', '跨年前缀 YYYY年');
    assert.strictEqual(F('2026-11-13'), '11月13日（本周五）', '当年 ISO 日期不加年份前缀');
    assert.strictEqual(F('11月13日（本周五）'), '11月13日（本周五）', '已是 M月D日（…）不重复加括号');
    assert.strictEqual(F('2026-11-13 12:00 报名截止'), '11月13日（本周五） 12:00 报名截止', '状态文案里的绝对日期');
    assert.strictEqual(F('招募1-2人'), '招募1-2人', '短横线区间不是日期');
    assert.strictEqual(F('14:05-15:00'), '14:05-15:00', '时间区间不是日期');
    assert.strictEqual(F('11-13至11-14'), '11月13日（本周五）至11月14日（今天）', '日期区间两端各自格式化');
    // 空值 / 非字符串安全
    assert.strictEqual(F(''), '');
    assert.strictEqual(n.fmtDatesCn(null, NOW), '');
    // 纯函数：不写回、不修改入参
    const s = '11-13 提交';
    F(s);
    assert.strictEqual(s, '11-13 提交');
    // 显示层统一入口：先 absRelDates（相对→MM-DD）再格式化
    assert.strictEqual(n.fmtDisplayDates('明天 12:00 截止', '11-13 12:00', NOW), '11月14日（今天） 12:00 截止');
    // 期次胶囊 / 长期清单「下次」
    assert.strictEqual(n.dateTimeCnOf(at(2026, 11, 15, 7, 30), NOW), '11月15日（明天）07:30');
    assert.strictEqual(n.nextCnTextOf({ recurrence: { freq: 'monthly_weeks', weekday: 3, weeks: [1, 2, 3], time: '17:30', startAt: '2026-11-04T17:30:00+08:00' } }, NOW),
      '下次 11月18日（下周三）17:30');
  });

  /* ============================================================
     3. 契约 §2.4：统计口径（pending/urgent/week/longterm/latest）
     ============================================================ */
  test('统计§2.4：待处理（期次计入/资料与长期定义不计/actionable=false 不计/已处理不计）+ 24h/7天 + 长期条数 + 最新发布', function () {
    const n = noticeMod();
    const NOW = at(2026, 11, 14, 13, 31);
    const urgent = { id: 'u', deadline: iso(NOW + 2 * H) };
    const week = { id: 'w', deadline: iso(NOW + 3 * D) };
    const active = { id: 'a', deadline: iso(NOW + 10 * D) };
    const info = { id: 'i', title: '资料' };
    // 期次：窗口已开（daily 07:30，now 13:31 处于 [11-14 07:30, 11-15 07:30)）
    const occG = { id: 'occ', recurrence: { freq: 'daily', time: '07:30', startAt: '2026-11-10T07:30:00+08:00' } };
    const occKey = n.occOf(occG, NOW).key;
    const recDef = { id: 'rd', recurrence: { freq: 'weekly', weekday: 3, time: '17:30' }, actionable: false };
    const ended = { id: 're', recurrence: { freq: 'daily', time: '07:30', until: '2026-11-13' } };
    const expired = { id: 'e', deadline: iso(NOW - D) };
    const noAction = { id: 'na', deadline: iso(NOW + 5 * H), actionable: false };
    const doneOne = { id: 'dn', deadline: iso(NOW + 6 * H) };
    const all = [urgent, week, active, info, occG, recDef, ended, expired, noAction, doneOne];
    const done = {}; done[occKey] = true; done.dn = true;
    const st = n.statOf(all, done, NOW);
    assert.strictEqual(st.pending, 3, '待处理 = urgent/week/active（期次已处理、info、长期定义、ended、actionable=false 不计）');
    assert.strictEqual(st.urgent, 1, '24h = urgent（期次已处理）');
    assert.strictEqual(st.week, 2, '7 天 = urgent + week');
    assert.strictEqual(st.expired, 2, '已过期 = expired + until 已结束的长期安排');
    assert.strictEqual(st.longterm, 2, '长期通知 = 进行中的 recurrence 条数（rd + occ；ended 不计）');
    // 期次未处理时计入待处理 / 24h / 7 天
    const st2 = n.statOf(all, { dn: true }, NOW);
    assert.strictEqual(st2.pending, 4, '期次未处理 → 待处理 +1');
    assert.strictEqual(st2.urgent, 2, '期次窗口 ≤24h → 24h +1');
    assert.strictEqual(st2.week, 3);
    // 最新发布 = 全部未隐藏通知里的最大值（含已过期/资料/长期定义；hidden 排除）
    const pubA = { id: 'pa', items: [{ kind: 'text', time: md(NOW - 2 * D) + ' 09:00' }] };
    const pubB = { id: 'pb', items: [{ kind: 'text', time: md(NOW) + ' 08:00' }] };
    const dep = { id: 'pc', updatedAt: iso(NOW - 3 * D), items: [{ kind: 'text', time: md(NOW - 4 * D) + ' 09:00' }] };
    const hid = { id: 'ph', _hidden: true, items: [{ kind: 'text', time: md(NOW - H) + ' 09:00' }] };
    const latest = n.latestOf([pubA, pubB, dep, hid], NOW);
    assert.strictEqual(latest.ts, at(2026, 11, 14, 8, 0), '最新发布时间取 items 最新消息（hidden 不算）');
    assert.strictEqual(latest.text, '今天 08:00', '最新发布相对文案 = 今天 HH:MM');
    const la2 = n.latestOf([{ id: 'x', items: [{ kind: 'text', time: md(NOW - 6 * D) + ' 12:49' }] }], NOW);
    assert.ok(/^\d{1,2}月\d{1,2}日（[^）]+） 12:49$/.test(la2.text), '较早的显示 M月D日（相对周） HH:MM：' + la2.text);
    assert.strictEqual(n.latestTextOf(null, NOW), '—', '无发布时间显示 —');
  });

  /* ============================================================
     4. pages/nt：5 卡筛选 + 分区 + 期次卡 + 期次 done
     ============================================================ */
  test('页面§2.1：5 卡统计与点击筛选（再点取消 / chips 互斥 / 分类筛选 / listCount）', function () {
    const def = loadNtPage();
    assert.ok(def && typeof def.applyFilter === 'function' && typeof def.pickCard === 'function', 'nt 页缺少 applyFilter/pickCard');
    const n = noticeMod();
    const now = Date.now();
    const occTs = now + H;
    const occTime = hhmm(occTs);
    const raw = [
      { id: 'urgent', title: '紧急', cat: '教务', deadline: iso(now + H) },
      { id: 'week', title: '一周内', cat: '团务', deadline: iso(now + 3 * D) },
      { id: 'active', title: '较远', cat: '团务', deadline: iso(now + 10 * D) },
      { id: 'info', title: '资料无时间', cat: '教务' },
      { id: 'occ', title: '每日安排', cat: '团务', recurrence: { freq: 'daily', time: occTime, startAt: iso(now - 30 * D) } },
      // 2 天后才进窗口的长期安排（当前不产生期次，只计入长期条数）
      { id: 'rec2', title: '每周安排', cat: '团务', recurrence: { freq: 'weekly', weekday: (new Date(now).getDay() + 2) % 7, time: hhmm(now), startAt: iso(now - 30 * D) } },
      { id: 'expired', title: '已过期', cat: '教务', deadline: iso(now - D) },
      { id: 'ended', title: '军训每日请假', cat: '团务', recurrence: { freq: 'daily', time: '07:30', until: '2026-11-13' } }
    ];
    raw.forEach(function (g, i) {
      const t = now - (i + 1) * H;
      g.items = [{ kind: 'text', time: md(t) + ' ' + hhmm(t) }];
    });
    const ctx = makeCtx(def, raw, now);
    const occKey = occRefOf('occ', occTs);
    ctx.data.filter = 'all'; ctx.data.cat = '全部'; ctx.data.isAdmin = false;
    def.applyFilter.call(ctx);
    // 统计：pending = urgent/week/active/occ/info（契约 2026-11-18：info 无锚点但有 items 时间 → 发布卡计入）；
    // urgent=2（urgent+occ）；week=3（发布卡主显示时间为空不进未来窗口）；longterm=2（occ/rec2）；expired=2
    assert.strictEqual(ctx.data.stats.pending, 5, '待处理 = 5：' + JSON.stringify(ctx.data.stats));
    assert.strictEqual(ctx.data.stats.urgent, 2);
    assert.strictEqual(ctx.data.stats.week, 3);
    assert.strictEqual(ctx.data.stats.longterm, 2, '长期通知 = 进行中的长期安排条数');
    assert.strictEqual(ctx.data.stats.expired, 2, '已过期 = expired + until 已结束');
    assert.strictEqual(ctx.data.stats.latestText, n.latestTextOf(now - H, now), '最新发布文案 = 最新发布时间相对文案：' + ctx.data.stats.latestText);
    // 全部视图分区：主列表 = 普通（含已处理置后）+ 期次卡 + 发布卡；资料栏为空；过期 → 已过期区
    assert.ok(idsOf(ctx.data.cards).indexOf(occKey) >= 0, '期次卡进入主列表：' + idsOf(ctx.data.cards).join(','));
    assert.strictEqual(ctx.data.cards.filter(function (c) { return c.isOcc; }).length, 1);
    assert.ok(idsOf(ctx.data.cards).indexOf('info') >= 0, '发布卡（无锚点有发布时间）进主列表：' + idsOf(ctx.data.cards).join(','));
    const infoCard = ctx.data.cards.filter(function (c) { return c.id === 'info'; })[0];
    assert.strictEqual(infoCard.statusCls, 'active', '发布卡状态胶囊样式 = active');
    assert.ok(/发布$/.test(infoCard.statusLabel), '发布卡状态胶囊以「发布」结尾：' + infoCard.statusLabel);
    assert.deepStrictEqual(idsOf(ctx.data.infoCards), [], '资料/无时间栏 = 0（发布卡不再进资料栏）');
    assert.strictEqual(ctx.data.infoCount, 0);
    assert.deepStrictEqual(idsOf(ctx.data.expiredCards), ['expired', 'ended'], '已过期区（含长期安排已结束）');
    assert.strictEqual(ctx.data.showInfo, true, '资料栏折叠态默认展开（0 条时 wxml 不渲染）');
    assert.strictEqual(ctx.data.showExpiredWrap, true);
    assert.strictEqual(ctx.data.showExpired, false, '已过期区默认折叠');
    assert.strictEqual(ctx.data.listCount, ctx.data.cards.length, '「N 组」= 当前主列表条目数（期次计 1 条）');
    const occCard = ctx.data.cards.filter(function (c) { return c.isOcc; })[0];
    assert.strictEqual(occCard.id, occKey);
    // 期次 key 含 @/:（CSS 选择器非法）→ DOM id 必须是安全 token（jumpTo/_scrollToCard 依赖）
    assert.ok(/^c_[A-Za-z0-9_-]+$/.test(occCard.domId), '期次卡 DOM id 必须是安全 token：' + occCard.domId);
    assert.ok(occCard.domId.indexOf('@') < 0 && occCard.domId.indexOf(':') < 0);
    assert.ok(occCard.statusLabel.indexOf('本次 ') === 0, '期次状态胶囊 = 本次 …：' + occCard.statusLabel);
    assert.ok(/^本次 \d{1,2}月\d{1,2}日（[^）]+）\d\d:\d\d$/.test(occCard.statusLabel), '胶囊格式：' + occCard.statusLabel);
    assert.strictEqual(occCard.recurring, false, '期次卡不重复显示定义卡的「下次」行');
    assert.strictEqual(occCard.canDone, false, '期次卡用专属「本次已处理」按钮（模板 isOcc 分支）');
    // 顶部 5 卡点击 → 对应筛选；再点已激活卡 → 恢复全部
    def.pickCard.call(ctx, { currentTarget: { dataset: { k: 'pending' } } });
    assert.strictEqual(ctx.data.filter, 'active');
    assert.strictEqual(ctx.data.cardKey, 'pending');
    assert.deepStrictEqual(idsOf(ctx.data.cards).sort(), ['active', 'info', occKey, 'urgent', 'week'].sort(), '待处理筛选=主列表（含期次/发布卡）');
    assert.ok(idsOf(ctx.data.cards).indexOf('rec2') < 0);
    def.pickCard.call(ctx, { currentTarget: { dataset: { k: 'urgent' } } });
    assert.strictEqual(ctx.data.filter, 'urgent');
    assert.deepStrictEqual(idsOf(ctx.data.cards).sort(), [occKey, 'urgent'].sort(), '24h 卡 = 待处理中 ≤24h（发布卡不进未来窗口）');
    def.pickCard.call(ctx, { currentTarget: { dataset: { k: 'week' } } });
    assert.strictEqual(ctx.data.filter, 'week');
    assert.deepStrictEqual(idsOf(ctx.data.cards).sort(), [occKey, 'urgent', 'week'].sort(), '7 天卡 = ≤7 天（发布卡不计入）');
    def.pickCard.call(ctx, { currentTarget: { dataset: { k: 'longterm' } } });
    assert.strictEqual(ctx.data.filter, 'longterm');
    assert.strictEqual(ctx.data.cards.length, 0, '长期通知筛选不显示期次卡/普通卡');
    assert.deepStrictEqual(idsOf(ctx.data.longtermCards).sort(), ['occ', 'rec2'].sort(), '长期清单=进行中的长期安排');
    assert.strictEqual(ctx.data.listCount, 2, '长期清单视图「N 组」= 长期条数');
    const lt = ctx.data.longtermCards.filter(function (c) { return c.id === 'occ'; })[0];
    assert.ok(lt.recurLabel && lt.nextCnText.indexOf('下次 ') === 0, '长期清单显示周期 label + 下次 M月D日（周X）HH:MM');
    assert.strictEqual(lt.canDone, false, '长期定义卡无已处理');
    def.pickCard.call(ctx, { currentTarget: { dataset: { k: 'latest' } } });
    assert.strictEqual(ctx.data.filter, 'latest');
    const latestIds = idsOf(ctx.data.cards);
    assert.strictEqual(latestIds.length, 8, '最新发布 = 全部未隐藏通知（含过期/资料/长期定义）');
    assert.strictEqual(latestIds[0], 'urgent', '最新发布按发布时间倒序（urgent 的 items 时间最新）');
    assert.ok(latestIds.indexOf('ended') >= 0 && latestIds.indexOf('info') >= 0, '最新发布不分资料/长期区');
    // 同一天内发布时间取 items/updatedAt；这里无 items → 顺序按数据源（稳定），只断言集合与过期样式
    assert.ok(ctx.data.cards.some(function (c) { return c.id === 'expired' && c.expired === true; }), '过期卡仍按过期样式');
    // 再点长期卡 → 取消，恢复「全部」
    def.pickCard.call(ctx, { currentTarget: { dataset: { k: 'latest' } } });
    assert.strictEqual(ctx.data.filter, 'all');
    assert.strictEqual(ctx.data.cardKey, '');
    // chips 与顶部卡互斥
    def.pickCard.call(ctx, { currentTarget: { dataset: { k: 'week' } } });
    def.pickFilter.call(ctx, { currentTarget: { dataset: { f: 'active' } } });
    assert.strictEqual(ctx.data.filter, 'active');
    assert.strictEqual(ctx.data.cardKey, '', '选 chip 时取消顶部卡激活态');
    // 分类筛选对所有视图生效
    ctx.data.filter = 'all'; ctx.data.cat = '教务';
    def.applyFilter.call(ctx);
    assert.deepStrictEqual(idsOf(ctx.data.cards), ['urgent', 'info'], '分类筛选主列表（含发布卡）');
    assert.deepStrictEqual(idsOf(ctx.data.infoCards), [], '分类筛选后资料栏仍为空');
    assert.deepStrictEqual(idsOf(ctx.data.expiredCards), ['expired'], '分类筛选已过期区');
    ctx.data.cat = '团务';
    ctx.data.filter = 'longterm';
    def.applyFilter.call(ctx);
    assert.deepStrictEqual(idsOf(ctx.data.longtermCards).sort(), ['occ', 'rec2'].sort(), '分类筛选长期清单');
    // 「资料 / 无时间」栏：0 条时 wxml 不渲染（wx:if="{{filter === 'all' && infoCount}}"），折叠态仅会话内
    ctx.data.cat = '全部'; ctx.data.filter = 'all';
    def.applyFilter.call(ctx);
    assert.strictEqual(ctx.data.infoCount, 0, '发布卡不再进资料栏 → 资料栏 0 条');
    def.toggleInfo.call(ctx);
    assert.strictEqual(ctx.data.showInfo, false);
    def.toggleInfo.call(ctx);
    assert.strictEqual(ctx.data.showInfo, true);
  });

  test('页面§2.3/§2.5：期次卡「本次已处理」写 marks ntdone(ref=期次 key) → 该期消失、长期条数不变、下一期不受影响', async function () {
    const restoreWx = installWxIfNeeded();
    const def = loadNtPage();
    const n = noticeMod();
    const now = Date.now();
    const occTs = now + H;
    const raws = [
      { id: 'g_occ', title: '每日请假', cat: '团务', recurrence: { freq: 'daily', time: hhmm(occTs), startAt: iso(now - 30 * D) } },
      { id: 'g_plain', title: '普通通知', cat: '教务', deadline: iso(now + 2 * H) }
    ];
    const ctx = makeCtx(def, raws, now);
    const occKey = occRefOf('g_occ', occTs);
    const tomorrowKey = occRefOf('g_occ', occTs + D);
    assert.notStrictEqual(occKey, tomorrowKey);
    ctx.data.filter = 'all'; ctx.data.cat = '全部';
    ctx._done = {};
    def.applyFilter.call(ctx);
    assert.ok(idsOf(ctx.data.cards).indexOf(occKey) >= 0);
    const pendingBefore = ctx.data.stats.pending;
    // mock 云端 marks（纯 mock：不写云端）
    const cloudPath = require.resolve(path.join(ROOT, 'utils/cloud.js'));
    const cloud = require(cloudPath);
    const prevSetMark = cloud.setMark;
    const marks = [];
    cloud.setMark = function (kind, ref, val) { marks.push({ kind: kind, ref: ref, val: val }); return Promise.resolve(true); };
    try {
      def.toggleDone.call(ctx, { currentTarget: { dataset: { gid: occKey } } });
      await sleep(5);
      assert.strictEqual(ctx._done[occKey], true, '本机 ntdone 用期次 key');
      assert.deepStrictEqual(marks, [{ kind: 'ntdone', ref: occKey, val: true }], '写云端 marks kind=ntdone ref=期次 key');
      assert.ok(idsOf(ctx.data.cards).indexOf(occKey) < 0, '已处理期次立即从主列表消失');
      assert.strictEqual(ctx.data.stats.pending, pendingBefore - 1, '已处理期次不计待处理');
      assert.strictEqual(ctx.data.stats.longterm, 1, '长期通知条数不受期次已处理影响');
      assert.strictEqual(ctx.data.longtermCount, 1);
      assert.strictEqual(!!ctx._done[tomorrowKey], false, '下一期（明天）不受本期已处理影响');
      // 撤销：期次卡恢复
      def.toggleDone.call(ctx, { currentTarget: { dataset: { gid: occKey } } });
      await sleep(5);
      assert.strictEqual(ctx._done[occKey], false);
      assert.ok(idsOf(ctx.data.cards).indexOf(occKey) >= 0, '撤销后本期卡片恢复');
      assert.strictEqual(marks[marks.length - 1].ref, occKey, '撤销同样写期次 key');
      assert.strictEqual(marks[marks.length - 1].val, false);
      // 长期安排定义卡不允许标记已处理（toggleDone 兜底直接返回，不写 marks）
      const markN = marks.length;
      def.toggleDone.call(ctx, { currentTarget: { dataset: { gid: 'g_occ' } } });
      await sleep(5);
      assert.strictEqual(marks.length, markN, '长期定义卡不得写已处理');
      assert.strictEqual(!!ctx._done.g_occ, false);
      // 普通通知仍走组 id ref
      def.toggleDone.call(ctx, { currentTarget: { dataset: { gid: 'g_plain' } } });
      await sleep(5);
      assert.strictEqual(marks[marks.length - 1].ref, 'g_plain', '普通通知 ref=组 id');
    } finally {
      cloud.setMark = prevSetMark;
    }
    restoreWx();
  });

  /* ============================================================
     5. pages/index：工作台待办新口径（期次计入、资料/长期定义不计）
     ============================================================ */
  test('工作台：ntView/轮换条目新口径（期次计入、资料无时间与长期定义不计、无时间资料不计数）', function () {
    const notice = noticeMod();
    const now = Date.now();
    let def = null;
    const hadPage = Object.prototype.hasOwnProperty.call(global, 'Page');
    const prevPage = global.Page;
    global.Page = function (d) { def = d; };
    try { require(path.join(ROOT, 'pages/index/index.js')); } finally { global.Page = prevPage; if (!hadPage) delete global.Page; }
    assert.ok(def && typeof def.ntView === 'function', 'index 页缺少 ntView');
    const occTs = now + H;
    const groups = [
      { id: 'urgent', title: '紧急', deadline: iso(now + H) },
      { id: 'info', title: '资料无时间' },
      { id: 'recdef', title: '长期安排定义', recurrence: { freq: 'daily', time: hhmm(occTs) }, actionable: false },
      { id: 'occ', title: '每日请假', recurrence: { freq: 'daily', time: hhmm(occTs), startAt: iso(now - 30 * D) } },
      { id: 'expired', title: '已过期', deadline: iso(now - D) }
    ];
    const view = def.ntView.call({}, groups);
    assert.strictEqual(view.state, 'ok');
    assert.strictEqual(view.pending, 2, '工作台计数 = 普通待处理 + 期次（资料/长期定义/已过期不计）：' + view.pending);
    assert.ok(view.items.length >= 2, '轮换条目 ≥2');
    assert.ok(view.items.some(function (it) { return it.sub.indexOf('本次 ') === 0; }), '期次条目计入轮换：' + JSON.stringify(view.items));
    assert.ok(!view.items.some(function (it) { return it.title === '资料无时间' || it.title === '长期安排定义' || it.title === '已过期'; }),
      '资料/长期定义/已过期不进轮换');
  });

  /* ============================================================
     6. 静态接线：wxml / wxss / nt.js / index.js + 红线
     ============================================================ */
  test('静态：nt.wxml 5 张可点数据卡 + 资料栏 + 期次模板（长期安排徽标/本次已处理）+ 事件 handler', function () {
    const wxml = src('pages/nt/nt.wxml');
    ['pending', 'urgent', 'week', 'longterm', 'latest'].forEach(function (k) {
      assert.ok(new RegExp('data-k="' + k + '"').test(wxml), '缺少顶部数据卡 data-k=' + k);
    });
    assert.strictEqual((wxml.match(/data-k="(?:pending|urgent|week|longterm|latest)"/g) || []).length, 5, '顶部数据卡必须是 5 张');
    assert.ok(/bindtap="pickCard"/.test(wxml), '顶部卡点击 → pickCard');
    assert.ok(/stats\.pending/.test(wxml) && /stats\.urgent/.test(wxml) && /stats\.week/.test(wxml)
      && /stats\.longterm/.test(wxml) && /stats\.latestText/.test(wxml), '5 卡数字/文案接线');
    assert.ok(/资料 \/ 无时间/.test(wxml), '缺少「资料 / 无时间」栏');
    assert.ok(/bindtap="toggleInfo"/.test(wxml) && /showInfo \? '▴ 收起' : '▾ 展开'/.test(wxml), '资料栏可折叠（默认展开）');
    assert.ok(/wx:for="\{\{infoCards\}\}"/.test(wxml), '资料栏遍历 infoCards');
    assert.ok(/本次已处理/.test(wxml), '期次卡缺少「本次已处理」按钮');
    assert.ok(/card\.isOcc/.test(wxml) && /nt-recur-badge[\s\S]{0,40}长期安排/.test(wxml), '期次卡缺少「长期安排」徽标/isOcc 分支');
    assert.ok(/wx:for="\{\{longtermCards\}\}"/.test(wxml), '长期通知筛选遍历 longtermCards');
    assert.ok(/进行中/.test(wxml), '长期清单显示「进行中」');
    assert.ok(/nt-expired/.test(wxml) && /toggleExpired/.test(wxml), '已过期区保持');
    // 分区顺序：主列表 → 资料栏 → 已过期
    const iCards = wxml.indexOf('wx:for="{{cards}}"');
    const iInfo = wxml.indexOf('nt-info');
    const iExp = wxml.indexOf('nt-expired');
    assert.ok(iCards >= 0 && iInfo > iCards && iExp > iInfo, '分区顺序应为 主列表 → 资料栏 → 已过期区');
    assert.ok(/id="card-\{\{card\.domId\}\}"/.test(wxml), '卡片 DOM id 用安全 token（domId）');
    assert.ok(!/https?:\/\//.test(wxml), 'wxml 不得引入外链');
  });

  test('静态：nt.wxss 5 卡栅格/激活态/点按区 ≥40px/资料栏/长期清单 + 无外部资源', function () {
    const wxss = src('pages/nt/nt.wxss');
    assert.ok(/\.nt-dcards \{[^}]*grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/.test(wxss), '5 卡 = 6 列栅格 3+2 两行（360px 无横向溢出）');
    assert.ok(/\.nt-dcard--half \{[^}]*grid-column: span 3/.test(wxss), '第二行 2 张等宽');
    assert.ok(/\.nt-dcard \{[^}]*min-height: 96rpx/.test(wxss), '数据卡点按区 96rpx≈48px ≥ 40px');
    assert.ok(/\.nt-dcard\.on \{/.test(wxss), '缺少数据卡激活态');
    assert.ok(/\.nt-dcard-n--t \{[^}]*font-size: 23rpx/.test(wxss), '最新发布文案字号小一档');
    assert.ok(/\.nt-info-hd \{[^}]*min-height: 84rpx/.test(wxss), '资料栏折叠头点按区 ≥40px');
    assert.ok(/\.nt-lt-row \{/.test(wxss) && /\.nt-lt-next \{/.test(wxss), '长期清单样式');
    assert.ok(!/url\(\s*['"]?https?:/i.test(wxss) && !/@import/.test(wxss), '不得引入外部资源');
  });

  test('静态：nt.js 期次/统计接线（occOf/statOf/isOccRef/until）+ 无新增网络请求 + VERSION 2.1.0', function () {
    const js = src('pages/nt/nt.js');
    assert.ok(/notice\.statOf\(rawAll, doneMap, now\)/.test(js), '统计走 utils/notice.statOf（§2.4 单一真源）');
    assert.ok(/notice\.occOf\(go, now\)/.test(js), 'applyFilter 应用期次窗口算法');
    assert.ok(/notice\.isOccRef\(gid\)/.test(js), 'toggleDone 识别期次 key');
    assert.ok(/notice\.occLabelOf|occCardOf\(/.test(js), '期次卡派生');
    assert.ok(/notice\.nextCnTextOf\(g, now\)/.test(js), '长期清单「下次」用 M月D日（周X）HH:MM');
    assert.ok(/notice\.latestOf|pubTs/.test(js), '最新发布按发布时间');
    assert.ok(/notice\.fmtDatesCn|fmtDisplayDates/.test(js), '显示层统一时间格式');
    assert.ok(/isRecurEnded/.test(js), 'until 结束判定接线');
    assert.ok(/cloud\.setMark\('ntdone', gid, val\)/.test(js), '期次/普通已处理共用 marks ntdone');
    assert.ok(/function domIdOf\(ref\)/.test(js) && /'#card-' \+ domIdOf\(gid\)/.test(js), '卡片 DOM id 需转安全 token（期次 key 含 @/:）');
    assert.ok(!/wx\.request\(/.test(js), 'nt.js 不应新增 wx.request');
    assert.ok(!/wx\.uploadFile/.test(js), 'nt.js 不应新增 wx.uploadFile');
    assert.strictEqual((js.match(/wx\.downloadFile\(/g) || []).length, 1, 'downloadFile 仍只用于附件（无新增网络请求）');
    const indexJs = src('pages/index/index.js');
    assert.ok(/notice\.occOf\(g, now\)/.test(indexJs) && /done\[occ\.key\]/.test(indexJs), '工作台期次计入轮换');
    assert.ok(/notice\.isLongterm\(g, now\)/.test(indexJs), '工作台资料/长期定义不计');
    assert.ok(/notice\.hasTimeAnchor\(g\)/.test(indexJs), '工作台无时间资料不计');
    assert.ok(/VERSION\s*=\s*'2\.1\.0'/.test(src('utils/version.js')), 'VERSION 必须为 2.1.0');
    // 红线：不发真实请求的静态保证（云端只经 utils/cloud；页面不直连 URL）
    assert.ok(js.indexOf('https://') < 0 || js.indexOf('https://') === js.lastIndexOf('https://'), 'nt.js 不应新增外链');
  });
}

module.exports = { run: run };

/* 独立运行：node notice_occ_unit.js */
if (require.main === module) {
  const results = [];
  let passN = 0, failN = 0;
  const test = async function (name, fn) {
    try { await fn(); passN += 1; results.push({ name: name, ok: true }); console.log('PASS  ' + name); }
    catch (e) { failN += 1; results.push({ name: name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
  };
  run(test).then(function () {
    const summary = { total: passN + failN, pass: passN, fail: failN, results: results, at: new Date().toISOString() };
    fs.writeFileSync(path.join(__dirname, 'notice_occ_result.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log('\n================ notice occ: ' + passN + ' passed, ' + failN + ' failed ================');
    process.exitCode = failN ? 2 : 0;
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}
