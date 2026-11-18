/* 通知提醒（v20 / 1.4.7）前端单测 —— mp-notify
 *
 * 运行（两种方式都行）：
 *   node notify_ui_test.js      # 独立运行，自带 wx mock，结果写 notify_ui_result.json
 *   node unit.js                # unit.js 末尾通过 run(test) 把本文件断言并入总表
 *
 * 依赖：仅 Node 内置模块 + 小程序 utils/pages 源码；全部 mock，绝不发真实订阅消息、
 * 不调用真实云函数、不写云端（wx.request 一律返回空数组，wx.cloud.callFunction 只记录参数）。
 *
 * 覆盖（_notify_task/CONTRACT.md §1/§3 + task-7 §6）：
 *   - store.ntRemind 默认值/归一化/脏数据容错
 *   - notify.js：deadlineTsOf、subscribeNoticeReminder 参数契约（kind/ref/fireAt/tip/timeText/
 *     summary/dateText）、ask 先于云调用、denied/unsupported/未部署错误分支、listReminders 解析、
 *     cancelReminder 参数
 *   - nt 页：快捷提醒项生成（有/无截止、过滤 <=now+60s）、自定义弹层默认值与校验、
 *     confirmRemind 成功/失败、取消提醒、list 核对（补/删/保留）、gid 定位、新通知提醒按钮
 *   - 页面静态断言：wxml 有提醒按钮/胶囊/弹层；js 有 gid/list/cancel；既有通知功能仍在
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = 'C:/Users/Ko_Li/.openclaw/workspace/mp-class-tools';
const ID = { token: 'tok-notify-1', sid: '3260799999', name: '测试账号', role: '', badge: '', is_admin: true, ts: 1 };
const MIN = 60000;

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function iso(ts) { return new Date(ts).toISOString(); }
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

/* ---------------- wx mock（每个用例一套内存） ---------------- */
let envCache = null;      // 最近一次 createEnv() 的 env（用例内直接 const env = createEnv() 使用亦可）
function createEnv() {
  const mem = Object.create(null);
  const state = {
    mem: mem,
    toasts: [],
    sheets: [],
    calls: [],
    subLog: [],
    scrolls: [],
    logs: [],
    subMode: 'accept',        // accept | deny | unsupported
    cloudMode: 'ok',          // ok | reject | notdeployed
    cloudReply: null,         // function(data) -> result 对象（覆盖默认 {ok:true}）
    sheetTap: null,           // null = 不自动回调；数字 = 自动 success({tapIndex})
    callsAtAsk: -1
  };
  state.wx = {
    getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
    setStorageSync(k, v) { mem[k] = v; },
    removeStorageSync(k) { delete mem[k]; },
    getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 0, limitSize: 10240 }; },
    request(o) { if (o && o.success) o.success({ statusCode: 200, data: [] }); },
    showToast(o) { state.toasts.push(String(o && o.title)); },
    showLoading() {}, hideLoading() {},
    showActionSheet(o) {
      state.sheets.push(o);
      if (state.sheetTap != null && o && o.success) o.success({ tapIndex: state.sheetTap });
    },
    requestSubscribeMessage(o) {
      state.subLog.push(o);
      state.callsAtAsk = state.calls.length;     // 断言「ask 时云端还没被调用」
      if (state.subMode === 'unsupported') { if (o && o.fail) o.fail({ errMsg: 'requestSubscribeMessage:fail not support' }); return; }
      if (state.subMode === 'deny') { if (o && o.success) o.success({ [o.tmplIds[0]]: 'reject' }); return; }
      if (o && o.success) o.success({ [o.tmplIds[0]]: 'accept' });
    },
    cloud: {
      callFunction(o) {
        state.calls.push({ name: o && o.name, data: o && o.data });
        if (state.cloudMode === 'reject') return Promise.reject({ errMsg: 'cloud.callFunction:fail mock' });
        if (state.cloudMode === 'notdeployed') return Promise.resolve({ result: { ok: false, reason: 'cloud-error' } });
        const result = (typeof state.cloudReply === 'function') ? state.cloudReply(o && o.data) : { ok: true };
        return Promise.resolve({ result: result });
      }
    },
    nextTick(fn) { fn(); },
    pageScrollTo(o) { state.scrolls.push(o); },
    createSelectorQuery() {
      const q = {
        _sel: '',
        select(sel) { q._sel = sel; return q; },
        boundingClientRect() { return q; },
        selectViewport() { return q; },
        scrollOffset() { return q; },
        exec(cb) { cb([{ top: 500, bottom: 600, height: 100 }, { scrollTop: 200 }]); }
      };
      return q;
    },
    showShareMenu() {}
  };
  global.wx = state.wx;
  envCache = state;
  return state;
}

/* 重载小程序模块（与 unit.js / cache_unit_tests.js 相同的隔离方式） */
function purge() {
  Object.keys(require.cache).forEach(function (k) {
    if (k.replace(/\\/g, '/').indexOf(ROOT) !== 0) return;
    try {
      const m = require.cache[k];
      if (m && m.exports && typeof m.exports.udStop === 'function') m.exports.udStop();
    } catch (e) { /* ignore */ }
    delete require.cache[k];
  });
}
function loadUtils() {
  purge();
  return {
    store: require(ROOT + '/utils/store.js'),
    notify: require(ROOT + '/utils/notify.js'),
    notice: require(ROOT + '/utils/notice.js'),
    util: require(ROOT + '/utils/util.js')
  };
}
function loadPage() {
  let def = null;
  global.Page = function (d) { def = d; };
  try { require(ROOT + '/pages/nt/nt.js'); } finally { delete global.Page; }
  return def;
}
function makeCtx(def, rawList) {
  const ctx = {
    data: JSON.parse(JSON.stringify(def.data)),
    _raw: rawList || [],
    _all: [],
    _expanded: {},
    _done: {},
    _remind: {},
    _imgs: {},
    _loadingImgs: {},
    _pendingGid: '',
    _remindAt: 0,
    _remindPulling: false,
    _filtered: 0,
    _rawById: def._rawById,
    _cardById: def._cardById,
    applyFilter() { ctx._filtered += 1; },
    patchCard() {},
    setData(o, cb) { Object.assign(ctx.data, o); if (cb) cb(); }
  };
  // 页面内部通过 this.xxx 互相调用：把 def 的其余方法挂到 ctx（setData/applyFilter 用上面的测试桩）
  Object.keys(def).forEach(function (k) {
    if (typeof def[k] === 'function' && typeof ctx[k] !== 'function') ctx[k] = def[k];
  });
  return ctx;
}
function groupOf(id, title, deadline, extra) {
  const g = { id: id, title: title, cat: '通知', source: 'QQ 群', items: [{ kind: 'text', text: '通知正文' }] };
  if (deadline) g.deadline = deadline;
  return Object.assign(g, extra || {});
}
// 真实 applyFilter 需要的轻量卡片（id/cat/expired 等）
function cardOf(id, expired) {
  return {
    id: id, title: 'T', cat: '通知', catCls: 'qt', source: '', sourceKind: 'doc',
    senderName: '', senderRole: '', senderBadge: '', pubBadge: '', isOcr: false,
    statusLabel: '无时间', statusCls: 'none', expired: !!expired, timeLabel: '',
    summary: '', points: [], segs: [], items: [], quotes: [], hasRaw: false, hasDetail: false,
    compose: [], filesCount: 0, imgCount: 0, moreText: '', expanded: !expired, done: false,
    deadlineTs: null, canRemind: !expired, reminded: false, remindText: '', remindLabel: '提醒', imgs: []
  };
}

/* ================================================================ run */
function run(test) {
  const prevWx = global.wx;

  return (async function () {

    /* ---------- 1. store.ntRemind ---------- */
    await test('提醒：store.ntRemind 默认 {} / 归一化（丢弃脏项、补 ref/label/ts、兼容数组与缺失）', () => {
      const env = createEnv();
      const M = loadUtils();
      assert.deepStrictEqual(M.store.DEF.ntRemind, {}, 'DEF 必须带 ntRemind:{}');
      assert.deepStrictEqual(M.store.mkD(null).ntRemind, {}, '缺字段 → {}');
      assert.deepStrictEqual(M.store.mkD({ ntRemind: [] }).ntRemind, {}, '数组 → 非法，回 {}');
      assert.deepStrictEqual(M.store.mkD({ ntRemind: 'x' }).ntRemind, {}, '字符串 → 非法，回 {}');
      const d = M.store.mkD({
        ntRemind: {
          auto_a: { fireAt: 1762400000000, label: '截止前 1 天' },
          auto_b: { ref: 'auto_b', fireAt: '1762400000000', label: '', ts: 5 },
          bad1: { fireAt: 0 },
          bad2: { ref: 'bad2' },
          bad3: null,
          bad4: 'oops'
        }
      });
      assert.deepStrictEqual(Object.keys(d.ntRemind).sort(), ['auto_a', 'auto_b'], '只保留有效 fireAt 条目');
      assert.deepStrictEqual(d.ntRemind.auto_a, { ref: 'auto_a', fireAt: 1762400000000, label: '截止前 1 天', ts: 0 });
      assert.deepStrictEqual(d.ntRemind.auto_b, { ref: 'auto_b', fireAt: 1762400000000, label: '', ts: 5 });
      // 不影响其它字段
      assert.deepStrictEqual(d.ntDone, {});
      assert.deepStrictEqual(d.ntRemind === M.store.DEF.ntRemind, false, '不能复用 DEF 对象引用');
      // 落盘 → 重读仍归一
      M.store.get().ntRemind = { auto_c: { fireAt: 123, label: 'x' } };
      M.store.save();
      const reloaded = M.store.reload();
      assert.deepStrictEqual(reloaded.ntRemind.auto_c, { ref: 'auto_c', fireAt: 123, label: 'x', ts: 0 });
      assert.ok(env.mem[M.store.KEY], '本机存储应有 zq_tools_v2');
    });

    await test('提醒：notify.deadlineTsOf 支持 ISO / 数字 / 日期串 / 无效值', () => {
      createEnv();
      const M = loadUtils();
      assert.strictEqual(M.notify.deadlineTsOf({ deadline: '2026-11-06T23:59:00+08:00' }), Date.parse('2026-11-06T23:59:00+08:00'));
      assert.strictEqual(M.notify.deadlineTsOf({ deadline: 1762400000000 }), 1762400000000);
      assert.strictEqual(M.notify.deadlineTsOf({ deadline: '2026-11-06' }), new Date('2026/11/06 00:00:00').getTime());
      assert.strictEqual(M.notify.deadlineTsOf({ deadline: '' }), null);
      assert.strictEqual(M.notify.deadlineTsOf({ deadline: 'not-a-date' }), null);
      assert.strictEqual(M.notify.deadlineTsOf(null), null);
      assert.strictEqual(M.notify.deadlineTsOf({}), null);
    });

    /* ---------- 2. notify.js：subscribe / list / cancel ---------- */
    await test('提醒：subscribeNoticeReminder 参数契约（kind/ref/fireAt/tip/timeText/summary/dateText）', async () => {
      const env = createEnv();
      const M = loadUtils();
      const fireAt = Date.now() + 2 * 3600000;
      const deadline = Date.now() + 3 * 86400000;
      const p = M.notify.subscribeNoticeReminder({ id: 'auto_g1', title: '测试通知', deadline: deadline }, fireAt, '截止前 1 天');
      // ask() 必须在云调用之前（同步段）：此刻云端调用数必须为 0
      assert.strictEqual(env.callsAtAsk, 0, 'requestSubscribeMessage 必须先于云函数调用');
      await p;
      assert.strictEqual(env.subLog.length, 1, '应请求一次订阅授权');
      assert.deepStrictEqual(env.subLog[0].tmplIds, [M.notify.TEMPLATE_ID]);
      assert.strictEqual(env.calls.length, 1);
      assert.strictEqual(env.calls[0].name, 'notify');
      assert.deepStrictEqual(env.calls[0].data, {
        action: 'subscribe', kind: 'ntremind', ref: 'auto_g1', fireAt: fireAt,
        label: '截止前 1 天', tip: '通知提醒',
        timeText: M.notify.fmt(fireAt), summary: '测试通知', dateText: M.notify.fmt(deadline)
      });
    });

    await test('提醒：无截止通知 dateText 回退 fmt(fireAt)；无 id 直接拒绝且不授权', async () => {
      const env = createEnv();
      const M = loadUtils();
      const fireAt = Date.now() + 3600000;
      await M.notify.subscribeNoticeReminder({ id: 'auto_nodl', title: '无截止', deadline: '' }, fireAt, '自定义');
      assert.strictEqual(env.calls[0].data.dateText, M.notify.fmt(fireAt));
      env.subLog.length = 0; env.calls.length = 0;
      let err = null;
      try { await M.notify.subscribeNoticeReminder({ title: '缺 id' }, fireAt, '自定义'); } catch (e) { err = e; }
      assert.ok(err && err.message === 'missing-ref');
      assert.strictEqual(env.subLog.length, 0, '无 ref 不应请求授权');
      assert.strictEqual(env.calls.length, 0);
    });

    await test('提醒：denied 分支（用户拒绝）→ reject denied、零云调用、不写任何本机数据', async () => {
      const env = createEnv();
      env.subMode = 'deny';
      const M = loadUtils();
      let err = null;
      try { await M.notify.subscribeNoticeReminder({ id: 'auto_g1', title: 'T' }, Date.now() + 3600000, '自定义'); } catch (e) { err = e; }
      assert.ok(err, '应 reject');
      assert.strictEqual(err.message, 'denied');
      assert.strictEqual(env.calls.length, 0, '拒绝后不得调用云函数');
      assert.deepStrictEqual(M.store.get().ntRemind, {}, '拒绝后不写本机');
    });

    await test('提醒：unsupported / 云函数未部署 / 云调用异常 → 可读错误原因', async () => {
      const env = createEnv();
      const M = loadUtils();
      // 基础库不支持
      env.subMode = 'unsupported';
      let err = null;
      try { await M.notify.subscribeNoticeReminder({ id: 'g', title: 'T' }, Date.now() + 3600000, ''); } catch (e) { err = e; }
      assert.strictEqual(err.message, 'unsupported');
      // 云函数未部署（返回 {ok:false,reason:'cloud-error'}）
      env.subMode = 'accept'; env.cloudMode = 'notdeployed';
      err = null;
      try { await M.notify.subscribeNoticeReminder({ id: 'g', title: 'T' }, Date.now() + 3600000, ''); } catch (e) { err = e; }
      assert.strictEqual(err.message, 'cloud-error');
      // cloud.callFunction 直接 reject（未联网/未部署）
      env.cloudMode = 'reject';
      err = null;
      try { await M.notify.subscribeNoticeReminder({ id: 'g', title: 'T' }, Date.now() + 3600000, ''); } catch (e) { err = e; }
      assert.ok(err && err.message && err.message !== 'cloud-error', '应保留可读原因：' + (err && err.message));
      // 无 wx.cloud
      delete env.wx.cloud;
      env.cloudMode = 'ok';
      err = null;
      try { await M.notify.listReminders('ntremind'); } catch (e) { err = e; }
      assert.strictEqual(err.message, 'no-cloud');
    });

    await test('提醒：listReminders 解析 {ok:true,list} / items 兼容 / {ok:false} reject', async () => {
      const env = createEnv();
      const M = loadUtils();
      env.cloudReply = function () {
        return { ok: true, list: [{ _id: '1', kind: 'ntremind', ref: 'auto_a', fireAt: 1, label: 'x', timeText: 't', summary: 's', createdAt: 2 }] };
      };
      let rows = await M.notify.listReminders('ntremind');
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(env.calls[0].data.action, 'list');
      assert.strictEqual(env.calls[0].data.kind, 'ntremind');
      // 兼容 items / 裸数组
      env.cloudReply = function () { return { ok: true, items: [{ ref: 'auto_b' }] }; };
      rows = await M.notify.listReminders();
      assert.strictEqual(rows[0].ref, 'auto_b');
      env.cloudReply = function () { return [{ ref: 'auto_c' }]; };
      rows = await M.notify.listReminders('ntremind');
      assert.strictEqual(rows[0].ref, 'auto_c');
      // {ok:false,reason}
      env.cloudReply = function () { return { ok: false, reason: 'too-many' }; };
      let err = null;
      try { await M.notify.listReminders('ntremind'); } catch (e) { err = e; }
      assert.strictEqual(err.message, 'too-many');
    });

    await test('提醒：cancelReminder 参数 {action:cancel,kind:ntremind,ref}', async () => {
      const env = createEnv();
      const M = loadUtils();
      await M.notify.cancelReminder('auto_g9', 'ntremind');
      assert.deepStrictEqual(env.calls[0].data, { action: 'cancel', kind: 'ntremind', ref: 'auto_g9' });
      await M.notify.cancelReminder('auto_g9');   // kind 缺省 = ntremind
      assert.deepStrictEqual(env.calls[1].data, { action: 'cancel', kind: 'ntremind', ref: 'auto_g9' });
    });

    /* ---------- 3. nt 页：快捷提醒项 ---------- */
    await test('提醒：快捷项生成（有截止 1天/2小时/30分钟，过滤 <= now+60s）', () => {
      createEnv();
      const M = loadUtils(); const def = loadPage(); const ctx = makeCtx(def);
      const now = Date.now();
      // 3 天后截止 → 3 项全在
      const due3d = now + 3 * 86400000;
      let opts = def.remindOptionsFor.call(ctx, groupOf('g1', 'T', iso(due3d)));
      assert.deepStrictEqual(opts.map(function (o) { return o.label; }), ['截止前 1 天', '截止前 2 小时', '截止前 30 分钟']);
      assert.strictEqual(opts[0].at, due3d - 86400000);
      assert.strictEqual(opts[1].at, due3d - 7200000);
      assert.strictEqual(opts[2].at, due3d - 1800000);
      assert.ok(opts.every(function (o) { return o.at > now + MIN; }), '不能给出 <= now+60s 的项');
      // 1 小时后截止 → 只剩「截止前 30 分钟」
      opts = def.remindOptionsFor.call(ctx, groupOf('g2', 'T', iso(now + 3600000)));
      assert.deepStrictEqual(opts.map(function (o) { return o.label; }), ['截止前 30 分钟']);
      // 距截止 40 分钟 → 30 分钟项 = now+10min，仍有效
      opts = def.remindOptionsFor.call(ctx, groupOf('g3', 'T', iso(now + 40 * MIN)));
      assert.deepStrictEqual(opts.map(function (o) { return o.label; }), ['截止前 30 分钟']);
      // 距截止 1 分钟 → 全部过滤，只剩自定义
      opts = def.remindOptionsFor.call(ctx, groupOf('g4', 'T', iso(now + 61000)));
      assert.deepStrictEqual(opts, []);
      // 延期（extensions 最后一次）优先
      const extGroup = groupOf('g5', 'T', iso(now + 61000));
      extGroup.extensions = [{ deadline: iso(now + 5 * 86400000) }, { deadline: iso(now + 6 * 86400000) }];
      opts = def.remindOptionsFor.call(ctx, extGroup);
      assert.strictEqual(opts.length, 3, '应按最后一次延期时间生成快捷项');
      assert.strictEqual(opts[0].at, now + 6 * 86400000 - 86400000);
    });

    await test('提醒：快捷项以活动报名开始时间为基准（无报名才开始用截止）', () => {
      createEnv();
      const M = loadUtils(); const def = loadPage(); const ctx = makeCtx(def);
      const now = Date.now();
      const start = now + 3 * 86400000;
      const due = now + 5 * 86400000;
      let opts = def.remindOptionsFor.call(ctx, groupOf('s1', 'T', iso(due), { signupStart: iso(start), signupEnd: iso(due) }));
      assert.deepStrictEqual(opts.map(function (o) { return o.label; }),
        ['报名开始前 1 天', '报名开始前 2 小时', '报名开始前 30 分钟', '报名开始时']);
      assert.strictEqual(opts[0].at, start - 86400000);
      assert.strictEqual(opts[1].at, start - 7200000);
      assert.strictEqual(opts[2].at, start - 1800000);
      assert.strictEqual(opts[3].at, start);
      // 报名开始 1 小时后：只剩「前 30 分钟」「开始时」
      opts = def.remindOptionsFor.call(ctx, groupOf('s2', 'T', iso(now + 5 * 86400000), { signupStart: iso(now + 3600000) }));
      assert.deepStrictEqual(opts.map(function (o) { return o.label; }), ['报名开始前 30 分钟', '报名开始时']);
      // 报名开始已过 → 回退截止
      opts = def.remindOptionsFor.call(ctx, groupOf('s3', 'T', iso(now + 3 * 86400000), { signupStart: iso(now - 86400000) }));
      assert.deepStrictEqual(opts.map(function (o) { return o.label; }), ['截止前 1 天', '截止前 2 小时', '截止前 30 分钟']);
    });

    await test('提醒：快捷项生成（无截止 → 今天/明天 20:00，已过顺延，始终 2 个未来项）', () => {
      createEnv();
      const M = loadUtils(); const def = loadPage(); const ctx = makeCtx(def);
      const opts = def.remindOptionsFor.call(ctx, groupOf('g1', 'T'));
      // 期望：从今天 20:00 起取 2 个 > now+60s 的整点（已过则顺延 → 明天/后天）
      const base = new Date(); base.setHours(20, 0, 0, 0);
      const names = ['今天', '明天', '后天'];
      const expected = [];
      for (let i = 0; i < 3 && expected.length < 2; i++) {
        const at = base.getTime() + i * 86400000;
        if (at > Date.now() + MIN) expected.push({ label: names[i] + ' 20:00', at: at });
      }
      assert.deepStrictEqual(opts, expected);
      assert.strictEqual(opts.length, 2, '始终给 2 个未来 20:00 项');
      assert.ok(opts.every(function (o) { return o.at > Date.now() + MIN; }), '所有快捷项必须 > now+60s');
    });

    /* ---------- 4. nt 页：动作面板入口 ---------- */
    await test('提醒：未设提醒 → 快捷面板（+自定义…）；已设 → 修改/取消面板（面板用卡片自己的 gid）', async () => {
      const env = createEnv();
      const M = loadUtils(); const def = loadPage();
      const due = Date.now() + 3 * 86400000;
      const raw = groupOf('auto_g1', 'T', iso(due));
      const ctx = makeCtx(def, [raw]);
      // 未设提醒 → 快捷面板（含自定义…）
      def.onRemindTap.call(ctx, { currentTarget: { dataset: { gid: 'auto_g1' } } });
      assert.strictEqual(env.sheets.length, 1);
      const list1 = env.sheets[0].itemList;
      assert.ok(['截止前 1 天', '截止前 2 小时', '截止前 30 分钟'].every(function (l) { return list1.indexOf(l) >= 0; }), 'itemList: ' + list1.join(','));
      assert.strictEqual(list1[list1.length - 1], '自定义…');
      // 已设提醒 → 修改/取消面板；点「修改提醒」→ 再出快捷面板
      env.sheets.length = 0;
      ctx._remind = { auto_g1: { ref: 'auto_g1', fireAt: Date.now() + 3600000, label: '截止前 1 天', ts: Date.now() } };
      def.onRemindTap.call(ctx, { currentTarget: { dataset: { gid: 'auto_g1' } } });
      assert.deepStrictEqual(env.sheets[0].itemList, ['修改提醒', '取消提醒']);
      env.sheetTap = 0;
      // mock 在调用即回调：修改 → 快捷面板 → 选中「截止前 1 天」→ 授权 + 云 subscribe（异步收尾）
      def.onRemindTap.call(ctx, { currentTarget: { dataset: { gid: 'auto_g1' } } });
      assert.ok(env.sheets.length >= 3, '修改提醒应打开快捷面板');
      assert.strictEqual(env.sheets[env.sheets.length - 1].itemList.slice(-1)[0], '自定义…');
      await sleep(10);
      // 已过期卡片不响应
      const expiredRaw = groupOf('auto_old', '旧', iso(Date.now() - 3600000));
      ctx._raw = [expiredRaw]; ctx._remind = {}; env.sheets.length = 0; env.toasts.length = 0;
      def.onRemindTap.call(ctx, { currentTarget: { dataset: { gid: 'auto_old' } } });
      assert.strictEqual(env.sheets.length, 0, '已过期不应弹面板');
      assert.ok(env.toasts.indexOf('通知已过期') >= 0);
    });

    /* ---------- 5. 自定义弹层 + 校验 ---------- */
    await test('提醒：自定义弹层默认值（start=今天；有截止 end=截止日；无截止 end=+30天）', () => {
      const env = createEnv();
      const M = loadUtils(); const def = loadPage();
      const now = Date.now();
      const due = now + 3 * 86400000;
      const ctx = makeCtx(def, [groupOf('g1', 'T', iso(due))]);
      def.openCustomRemind.call(ctx, 'g1');
      assert.strictEqual(ctx.data.remindSheet, true);
      assert.strictEqual(ctx.data.remindForGid, 'g1');
      assert.strictEqual(ctx.data.remindStart, ymd(new Date(now)));
      assert.strictEqual(ctx.data.remindEnd, ymd(new Date(due)));
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(ctx.data.remindDate));
      assert.ok(/^\d{2}:\d{2}$/.test(ctx.data.remindClock));
      assert.ok(/截止/.test(ctx.data.remindHint));
      // 无截止 → end = today+30
      const ctx2 = makeCtx(def, [groupOf('g2', 'T')]);
      def.openCustomRemind.call(ctx2, 'g2');
      assert.strictEqual(ctx2.data.remindEnd, ymd(new Date(now + 30 * 86400000)));
      assert.strictEqual(ctx2.data.remindStart, ymd(new Date(now)));
      assert.ok(!/截止/.test(ctx2.data.remindHint));
      // 截止太近 → 拒绝打开
      const ctx3 = makeCtx(def, [groupOf('g3', 'T', iso(now + 90000))]);
      env.toasts.length = 0;
      def.openCustomRemind.call(ctx3, 'g3');
      assert.strictEqual(ctx3.data.remindSheet, false);
      assert.ok(env.toasts.indexOf('距离截止太近，无法设置') >= 0);
    });

    await test('提醒：confirmRemind 校验（缺字段 / <=now+60s / 晚于截止）→ 不授权不写本机', async () => {
      const env = createEnv();
      const M = loadUtils(); const def = loadPage();
      const now = Date.now();
      const due = now + 3 * 86400000;
      const ctx = makeCtx(def, [groupOf('g1', 'T', iso(due))]);
      ctx.data.remindForGid = 'g1';
      ctx.data.remindSheet = true;
      // 缺时间
      ctx.data.remindDate = ymd(new Date(now)); ctx.data.remindClock = '';
      def.confirmRemind.call(ctx);
      assert.ok(env.toasts.indexOf('选择提醒日期和时间') >= 0, env.toasts.join('|'));
      // 过去时间（今天 00:00，除非运行在 00:00:00–00:01:00 之间）
      ctx.data.remindClock = '00:00';
      def.confirmRemind.call(ctx);
      assert.ok(env.toasts.indexOf('提醒需晚于现在 1 分钟') >= 0, env.toasts.join('|'));
      // 晚于截止
      const late = new Date(due + 86400000);
      ctx.data.remindDate = ymd(late); ctx.data.remindClock = '10:00';
      def.confirmRemind.call(ctx);
      assert.ok(env.toasts.indexOf('提醒不能晚于截止') >= 0, env.toasts.join('|'));
      assert.strictEqual(env.subLog.length, 0, '校验失败不应请求订阅授权');
      assert.strictEqual(env.calls.length, 0);
      assert.deepStrictEqual(M.store.get().ntRemind, {});
    });

    await test('提醒：confirmRemind 成功 → 授权→云 subscribe→本机 ntRemind→toast→重绘', async () => {
      const env = createEnv();
      const M = loadUtils(); const def = loadPage();
      const now = Date.now();
      const due = now + 3 * 86400000;
      const raw = groupOf('auto_g1', '测试通知', iso(due));
      const ctx = makeCtx(def, [raw]);
      const fire = new Date(now + 2 * 3600000); fire.setSeconds(0, 0);
      ctx.data.remindForGid = 'auto_g1';
      ctx.data.remindDate = ymd(fire);
      ctx.data.remindClock = hhmm(fire);
      const fireAt = new Date(ymd(fire) + ' ' + hhmm(fire) + ':00').getTime();
      def.confirmRemind.call(ctx);
      assert.strictEqual(ctx.data.remindSheet, false, '确认后弹层应关闭');
      await sleep(10);
      assert.strictEqual(env.subLog.length, 1, '应请求一次订阅授权');
      assert.strictEqual(env.callsAtAsk, 0, 'ask 先于云函数调用');
      assert.deepStrictEqual(env.calls[0].data, {
        action: 'subscribe', kind: 'ntremind', ref: 'auto_g1', fireAt: fireAt,
        label: '自定义', tip: '通知提醒',
        timeText: M.notify.fmt(fireAt), summary: '测试通知', dateText: M.notify.fmt(due)
      });
      const saved = M.store.get().ntRemind.auto_g1;
      assert.ok(saved, '本机应写入 ntRemind');
      assert.strictEqual(saved.fireAt, fireAt);
      assert.strictEqual(saved.label, '自定义');
      assert.strictEqual(saved.ref, 'auto_g1');
      assert.ok(saved.ts > 0);
      assert.ok(env.toasts.indexOf('已设置提醒') >= 0, env.toasts.join('|'));
      assert.ok(ctx._filtered >= 1, '设置成功后应重绘列表');
    });

    await test('提醒：自定义默认时间按报名开始提前 2 小时，提示报名开始而不是截止', () => {
      createEnv();
      const M = loadUtils(); const def = loadPage();
      const now = Date.now();
      const start = now + 3 * 86400000;
      const due = now + 5 * 86400000;
      const raw = groupOf('auto_s1', '活动通知', iso(due), { signupStart: iso(start), signupEnd: iso(due) });
      const ctx = makeCtx(def, [raw]);
      def.openCustomRemind.call(ctx, 'auto_s1');
      assert.strictEqual(ctx.data.remindSheet, true);
      const expect = new Date(start - 7200000);
      assert.strictEqual(ctx.data.remindDate, ymd(expect));
      assert.strictEqual(ctx.data.remindClock, hhmm(expect));
      assert.ok(/报名开始/.test(ctx.data.remindHint), '提示应以报名开始为基准：' + ctx.data.remindHint);
      assert.ok(/不晚于截止/.test(ctx.data.remindHint), '仍保留截止上限提示');
    });

    await test('提醒：denied 时 toast「未授权提醒」且不写本机', async () => {
      const env = createEnv();
      env.subMode = 'deny';
      const M = loadUtils(); const def = loadPage();
      const raw = groupOf('auto_g1', 'T', iso(Date.now() + 86400000));
      const ctx = makeCtx(def, [raw]);
      def.doRemind.call(ctx, 'auto_g1', Date.now() + 3600000, '截止前 1 天');
      await sleep(10);
      assert.strictEqual(env.toasts[env.toasts.length - 1], '未授权提醒');
      assert.strictEqual(env.calls.length, 0);
      assert.deepStrictEqual(M.store.get().ntRemind, {});
      assert.strictEqual(ctx._filtered, 0, '失败不应触发列表重绘');
    });

    /* ---------- 6. 取消 / 核对 / gid 定位 ---------- */
    await test('提醒：取消 → 云 cancel + 本机删除 + toast；云失败保留本机', async () => {
      const env = createEnv();
      const M = loadUtils(); const def = loadPage();
      M.store.get().ntRemind = { auto_g1: { ref: 'auto_g1', fireAt: Date.now() + 3600000, label: 'x', ts: 1 } };
      M.store.save();
      const ctx = makeCtx(def);
      ctx._remind = { auto_g1: { ref: 'auto_g1', fireAt: Date.now() + 3600000, label: 'x', ts: 1 } };
      def.cancelRemind.call(ctx, 'auto_g1');
      await sleep(10);
      assert.deepStrictEqual(env.calls[0].data, { action: 'cancel', kind: 'ntremind', ref: 'auto_g1' });
      assert.strictEqual(M.store.get().ntRemind.auto_g1, undefined, '本机提醒应删除');
      assert.ok(env.toasts.indexOf('已取消提醒') >= 0);
      assert.ok(ctx._filtered >= 1);
      // 云失败：保留本机 + 可读 toast
      M.store.get().ntRemind = { auto_g1: { ref: 'auto_g1', fireAt: Date.now() + 3600000, label: 'x', ts: 1 } };
      M.store.save();
      env.cloudMode = 'reject'; env.toasts.length = 0;
      def.cancelRemind.call(ctx, 'auto_g1');
      await sleep(10);
      assert.ok(M.store.get().ntRemind.auto_g1, '云端取消失败不应删除本机（避免云端仍发送）');
      assert.strictEqual(env.toasts[env.toasts.length - 1], '提醒服务不可用');
    });

    await test('提醒：list 核对（云端有→补本机；时间不一致→更新；本机过期且云端无→清；grace 内保留）', () => {
      const env = createEnv();
      const M = loadUtils(); const def = loadPage();
      const now = Date.now();
      M.store.get().ntRemind = {
        auto_a: { ref: 'auto_a', fireAt: now + 3600000, label: '旧', ts: 1 },
        auto_b: { ref: 'auto_b', fireAt: now - 15 * MIN, label: '过期无云端', ts: 1 },
        auto_c: { ref: 'auto_c', fireAt: now - 5 * MIN, label: '刚过点', ts: 1 }
      };
      M.store.save();
      const ctx = makeCtx(def);
      ctx._remind = M.store.get().ntRemind;
      def.applyReminderRows.call(ctx, [
        { _id: '1', kind: 'ntremind', ref: 'auto_a', fireAt: now + 2 * 3600000, label: '新', createdAt: now },
        { _id: '2', kind: 'ntremind', ref: 'auto_d', fireAt: now + 3 * 3600000, label: '补', createdAt: now },
        { _id: '3', kind: 'hw', ref: 'hw_x', fireAt: now + 3600000, label: '' }   // hw 行不参与
      ]);
      const local = M.store.get().ntRemind;
      assert.strictEqual(local.auto_a.fireAt, now + 2 * 3600000, '云端时间优先');
      assert.strictEqual(local.auto_a.label, '新');
      assert.ok(local.auto_d, '云端有、本机无 → 补到本机');
      assert.strictEqual(local.auto_b, undefined, 'fireAt 已过 10 分钟且云端无 → 清理');
      assert.ok(local.auto_c, 'fireAt 仅过 5 分钟 → 保留（等待定时器/核对）');
      assert.strictEqual(local.hw_x, undefined, 'hw 提醒不写进 ntremind 本机缓存');
      assert.ok(ctx._filtered >= 1, '核对有变化应重绘');
      // 幂等：同样的云端数据再次核对 → 无变化、不重绘
      const before = ctx._filtered;
      def.applyReminderRows.call(ctx, [
        { kind: 'ntremind', ref: 'auto_a', fireAt: now + 2 * 3600000, label: '新', createdAt: now },
        { kind: 'ntremind', ref: 'auto_d', fireAt: now + 3 * 3600000, label: '补', createdAt: now }
      ]);
      assert.strictEqual(ctx._filtered, before, '无变化不应重绘');
      // 落盘校验
      const disk = JSON.parse(env.mem[M.store.KEY]);
      assert.ok(disk.ntRemind, 'ntRemind 应持久化');
      assert.strictEqual(disk.ntRemind.auto_b, undefined);
    });

    await test('提醒：syncReminders 调云 list（kind=ntremind）+ 30s 节流 + 并发保护；失败静默', async () => {
      const env = createEnv();
      env.mem['zq_class_identity'] = JSON.stringify(ID);
      env.cloudReply = function () { return { ok: true, list: [] }; };
      const M = loadUtils(); const def = loadPage();
      const ctx = makeCtx(def);
      ctx.applyReminderRows = def.applyReminderRows;
      def.syncReminders.call(ctx);
      await sleep(10);
      assert.strictEqual(env.calls.length, 1);
      assert.deepStrictEqual(env.calls[0].data, { action: 'list', kind: 'ntremind' });
      assert.ok(ctx._remindAt > 0);
      // 30s 内不重复
      def.syncReminders.call(ctx);
      await sleep(10);
      assert.strictEqual(env.calls.length, 1, '30s 内不重复拉取');
      // 并发保护
      ctx._remindAt = 0; ctx._remindPulling = true;
      def.syncReminders.call(ctx);
      await sleep(5);
      assert.strictEqual(env.calls.length, 1);
      // 无身份 / 无 wx.cloud → 不请求
      ctx._remindPulling = false;
      delete env.mem['zq_class_identity'];
      ctx._remindAt = 0;
      def.syncReminders.call(ctx);
      await sleep(5);
      assert.strictEqual(env.calls.length, 1, '无身份不拉提醒列表');
      // 云失败静默（不抛、不清本机）
      env.mem['zq_class_identity'] = JSON.stringify(ID);
      ctx._remindAt = 0; env.cloudMode = 'reject';
      M.store.get().ntRemind = { auto_keep: { ref: 'auto_keep', fireAt: Date.now() + 3600000, label: '', ts: 1 } };
      M.store.save();
      def.syncReminders.call({ data: ctx.data, _remindPulling: false, _remindAt: 0, applyReminderRows: def.applyReminderRows, applyFilter: function () {}, _remind: {} });
      await sleep(10);
      // 失败不会走到 applyReminderRows；本机缓存保持
      assert.ok(M.store.get().ntRemind.auto_keep, '列表核对失败不应清本机');
    });

    await test('提醒：?gid= 定位（onLoad 解析；切全部→展开→滚动一次；过期卡展开已过期区；找不到静默）', () => {
      const env = createEnv();
      const M = loadUtils(); const def = loadPage();
      const ctx = makeCtx(def);
      // onLoad 解析 options.gid（含 URL 编码；无 % 时不做二次解码）
      def.onLoad.call(ctx, { gid: encodeURIComponent('auto_g测') });
      assert.strictEqual(ctx._pendingGid, 'auto_g测');
      def.onLoad.call(ctx, { gid: 'auto_g1' });
      assert.strictEqual(ctx._pendingGid, 'auto_g1');
      def.onLoad.call(ctx, { gid: 'auto%zz' });
      assert.strictEqual(ctx._pendingGid, 'auto%zz', '非法编码不解码也不抛错');
      def.onLoad.call(ctx, {});
      assert.strictEqual(ctx._pendingGid, '');
      // 未过期卡：filter=active → 切 all + 展开 + 滚动
      ctx.data.cards = [cardOf('auto_g1')];
      ctx.data.filter = 'active';
      ctx._pendingGid = 'auto_g1';
      def.jumpPendingGid.call(ctx);
      assert.strictEqual(ctx.data.filter, 'all');
      assert.strictEqual(ctx._expanded['auto_g1'], true);
      assert.strictEqual(ctx._pendingGid, '', '定位后清除，只定位一次');
      assert.ok(ctx._filtered >= 1);
      assert.strictEqual(env.scrolls.length, 1, '应滚动定位');
      assert.strictEqual(env.scrolls[0].scrollTop, 500 + 200 - 120);
      // 再次调用不重复定位
      def.jumpPendingGid.call(ctx);
      assert.strictEqual(env.scrolls.length, 1);
      // 过期卡：filter=active → 切 all + showExpired + 展开 + 滚动
      ctx.data.cards = []; ctx.data.expiredCards = [cardOf('auto_old', true)];
      ctx.data.filter = 'active'; ctx.data.showExpired = false; ctx._pendingGid = 'auto_old';
      def.jumpPendingGid.call(ctx);
      assert.strictEqual(ctx.data.filter, 'all');
      assert.strictEqual(ctx.data.showExpired, true);
      assert.strictEqual(ctx._expanded['auto_old'], true);
      assert.strictEqual(env.scrolls.length, 2);
      // 找不到 → 静默保留 pending
      ctx.data.cards = []; ctx.data.expiredCards = []; ctx._pendingGid = 'auto_none';
      def.jumpPendingGid.call(ctx);
      assert.strictEqual(ctx._pendingGid, 'auto_none');
      assert.strictEqual(env.scrolls.length, 2);
    });

    await test('提醒：新通知提醒已移除（无按钮/无接口/无角标）', () => {
      const M = loadUtils(); const def = loadPage();
      assert.strictEqual(def.subscribeNextNotice, undefined, 'nt 页不应再有 subscribeNextNotice');
      assert.strictEqual(def.refreshNotifyStatus, undefined, 'nt 页不应再有 refreshNotifyStatus');
      ['subscribeNotice', 'publishNotice', 'status', 'clearStatusCache', 'bootstrap'].forEach(function (k) {
        assert.strictEqual(M.notify[k], undefined, 'notify.js 不应再导出 ' + k);
      });
      const wxml = fs.readFileSync(path.join(ROOT, 'pages/nt/nt.wxml'), 'utf8');
      assert.ok(!/subscribeNextNotice|ntStatusText|ntSubOn|subBusy/.test(wxml), 'nt.wxml 仍残留新通知提醒 UI');
      const idx = fs.readFileSync(path.join(ROOT, 'pages/index/index.wxml'), 'utf8');
      assert.ok(!/ntNew|wb-task-new/.test(idx), '工作台仍残留「新通知」角标');
      const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
      assert.ok(!/notify\.bootstrap|d\.ntSub/.test(app), 'app.js 仍在上报新通知 token');
    });

    /* ---------- 7. 卡片渲染映射 + 既有功能回归 ---------- */
    await test('提醒：applyFilter 给卡片补 canRemind/reminded/remindText/remindLabel/deadlineTs', () => {
      createEnv();
      const M = loadUtils(); const def = loadPage();
      const now = Date.now();
      const due = now + 2 * 86400000;
      const raw = groupOf('auto_g1', 'T', iso(due));
      const ctx = makeCtx(def, [raw]);
      ctx._all = [cardOf('auto_g1')];
      ctx.data.filter = 'active';
      def.applyFilter.call(ctx);
      let c = ctx.data.cards[0];
      assert.strictEqual(c.canRemind, true, '未过期可提醒');
      assert.strictEqual(c.reminded, false);
      assert.strictEqual(c.remindLabel, '提醒');
      assert.strictEqual(c.deadlineTs, Date.parse(iso(due)));
      // 已设提醒
      ctx._remind = { auto_g1: { ref: 'auto_g1', fireAt: now + 3600000, label: 'x', ts: 1 } };
      def.applyFilter.call(ctx);
      c = ctx.data.cards[0];
      assert.strictEqual(c.reminded, true);
      assert.ok(/^\d{2}-\d{2} \d{2}:\d{2}$/.test(c.remindText), 'remindText 形如 11-06 08:00：' + c.remindText);
      assert.strictEqual(c.remindLabel, '提醒 ' + c.remindText);
      // 已过期：不可提醒
      const oldRaw = groupOf('auto_old', '旧', iso(now - 86400000));
      ctx._raw = [oldRaw]; ctx._all = [cardOf('auto_old', true)]; ctx._remind = {};
      ctx.data.filter = 'all'; ctx.data.showExpired = true;
      def.applyFilter.call(ctx);
      const oldCard = ctx.data.expiredCards[0];
      assert.strictEqual(oldCard.canRemind, false, '已过期不显示提醒按钮（模板 wx:if 控制）');
      assert.strictEqual(oldCard.reminded, false);
    });

    await test('回归：nt 页既有能力未破坏（标记已处理 / 原始消息 / 筛选 / 展开 / 附件）', () => {
      createEnv();
      const M = loadUtils(); const def = loadPage();
      ['applyFilter', 'toggleDone', 'openRaw', 'closeRaw', 'pickFilter', 'pickCat', 'toggleDetail',
        'toggleExpired', 'previewFile', 'downloadFile', 'previewImgs', 'openUrlItem', 'jumpTo',
        'onShareAppMessage', 'onShareTimeline', 'onCloudSync', 'onPullDownRefresh', 'onShow', 'onLoad',
        'pull', 'refresh', 'ensureImgs', 'patchCard'].forEach(function (k) {
        assert.strictEqual(typeof def[k], 'function', '缺少既有方法 ' + k);
      });
      const js = fs.readFileSync(path.join(ROOT, 'pages/nt/nt.js'), 'utf8');
      // 既有语义：ntdone / marks / 原始消息弹层 / 图片与附件
      ['store.get().ntDone', "cloud.setMark('ntdone'", 'rawSheet', 'rawBlocks', 'writeDataUri', 'previewImage'].forEach(function (s) {
        assert.ok(js.indexOf(s) >= 0, '既有实现片段丢失：' + s);
      });
    });

    /* ---------- 8. 静态断言 ---------- */
    await test('静态：nt.wxml 有提醒按钮/胶囊/自定义弹层；nt.json 保留 bottom-sheet', () => {
      const wxml = fs.readFileSync(path.join(ROOT, 'pages/nt/nt.wxml'), 'utf8');
      // 卡片底部：提醒按钮（data-gid + catchtap）与已设胶囊文案
      assert.ok(/class="nt-remind \{\{card\.reminded \? 'on' : ''\}\}"/.test(wxml), 'wxml 缺提醒按钮/胶囊');
      assert.ok(/data-gid="\{\{card\.id\}\}" catchtap="onRemindTap"/.test(wxml), '提醒按钮应带卡片 data-gid 并绑定 onRemindTap');
      assert.ok(/\{\{card\.remindLabel\}\}/.test(wxml), '胶囊文案应渲染 card.remindLabel');
      assert.ok(/wx:if="\{\{card\.canRemind\}\}"/.test(wxml), '提醒按钮应受 card.canRemind 控制');
      // 简报区：2026-11-18 已移除「新通知提醒」，只保留刷新
      assert.ok(!/subscribeNextNotice|ntStatusText|ntSubOn|subBusy/.test(wxml), '简报区不应再有新通知提醒按钮/状态');
      assert.ok(/bindtap="refresh">刷新</.test(wxml), '简报区应保留刷新');
      // 自定义弹层：bottom-sheet + date/time picker
      assert.ok(/<bottom-sheet show="\{\{remindSheet\}\}" title="自定义提醒时间"/.test(wxml), '缺自定义提醒 bottom-sheet');
      assert.ok(/<picker mode="date" value="\{\{remindDate\}\}" start="\{\{remindStart\}\}" end="\{\{remindEnd\}\}" bindchange="onRemindDate">/.test(wxml));
      assert.ok(/<picker mode="time" value="\{\{remindClock\}\}" bindchange="onRemindClock">/.test(wxml));
      assert.ok(/bindtap="confirmRemind">设置提醒</.test(wxml));
      const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages/nt/nt.json'), 'utf8'));
      assert.ok(json.usingComponents['bottom-sheet'], 'nt.json 必须保留 bottom-sheet 组件');
    });

    await test('静态：nt.js 有 gid 处理 / list 核对 / cancel / 授权链；data 页隐私文案补充', () => {
      const js = fs.readFileSync(path.join(ROOT, 'pages/nt/nt.js'), 'utf8');
      ['_pendingGid', 'options.gid', 'jumpPendingGid', '_scrollToCard', 'syncReminders', 'applyReminderRows',
        'listReminders', 'cancelReminder', 'subscribeNoticeReminder',
        'remindBaseOf', 'remindOptionsFor', 'onRemindTap', 'chooseRemindTime', 'confirmRemind', 'openCustomRemind'
      ].forEach(function (s) { assert.ok(js.indexOf(s) >= 0, 'nt.js 缺少提醒实现：' + s); });
      // requestSubscribeMessage 不在页面层直接调用（统一走 utils/notify.js 的 ask）
      assert.ok(!/wx\.requestSubscribeMessage\s*\(/.test(js), '授权应统一在 utils/notify.js，页面不要直接调用');
      // 隐私说明：订阅消息需授权 + openid 仅用于发送提醒、仅云函数使用
      const dataWxml = fs.readFileSync(path.join(ROOT, 'pages/data/data.wxml'), 'utf8');
      assert.ok(/订阅/.test(dataWxml) && /订阅消息/.test(dataWxml), '隐私说明应提到订阅消息');
      assert.ok(/openid 仅用于发送提醒、仅云函数使用/.test(dataWxml), '隐私说明应说明 openid 用途');
    });

    await test('静态：utils/notify.js 新增接口 + store DEF；toast 文案保持简短', () => {
      const notifyJs = fs.readFileSync(path.join(ROOT, 'utils/notify.js'), 'utf8');
      ['subscribeNoticeReminder', 'listReminders', 'cancelReminder', 'deadlineTsOf'].forEach(function (s) {
        assert.ok(notifyJs.indexOf(s) >= 0, 'notify.js 缺少 ' + s);
      });
      // 既有接口保留（2026-11-18 移除新通知提醒：subscribeNotice/publishNotice 不再存在）
      ['subscribeHomework', 'subscribeNoticeReminder', 'listReminders', 'cancelReminder'].forEach(function (s) {
        assert.ok(notifyJs.indexOf(s) >= 0, 'notify.js 既有接口丢失：' + s);
      });
      ['subscribeNotice', 'publishNotice', 'bootstrap', 'ntStatus'].forEach(function (s) {
        assert.ok(!new RegExp('\\b' + s + '\\b').test(notifyJs), 'notify.js 仍残留新通知接口：' + s);
      });
      const storeJs = fs.readFileSync(path.join(ROOT, 'utils/store.js'), 'utf8');
      assert.ok(/ntRemind: \{\}/.test(storeJs), 'store DEF 缺 ntRemind');
      assert.ok(/normRemind/.test(storeJs), 'store 缺 ntRemind 归一化');
      // 约定 toast 文案（短）
      const js = fs.readFileSync(path.join(ROOT, 'pages/nt/nt.js'), 'utf8');
      ['已设置提醒', '已取消提醒', '未授权提醒', '提醒服务不可用'].forEach(function (s) {
        assert.ok(js.indexOf(s) >= 0, '缺少约定 toast：' + s);
      });
    });

  })().finally(function () {
    // 恢复 unit.js 的 wx mock，避免影响其它用例
    global.wx = prevWx;
    purge();
  });
}

// envCache：createEnv() 内部维护「最近一次 mock 环境」（用例内直接用 const env = createEnv() 即可）

module.exports = { run: run };

/* 独立运行：node notify_ui_test.js */
if (require.main === module) {
  const results = [];
  let passN = 0, failN = 0;
  const test = async function (name, fn) {
    try { await fn(); passN += 1; results.push({ name: name, ok: true }); console.log('PASS  ' + name); }
    catch (e) { failN += 1; results.push({ name: name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
  };
  run(test).then(function () {
    const summary = { total: passN + failN, pass: passN, fail: failN, results: results, at: new Date().toISOString() };
    fs.writeFileSync(path.join(__dirname, 'notify_ui_result.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log('\n================ notify ui: ' + passN + ' passed, ' + failN + ' failed ================');
    process.exitCode = failN ? 2 : 0;
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}
