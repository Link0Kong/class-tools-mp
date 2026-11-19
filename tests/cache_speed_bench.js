/* cache_speed_bench.js —— 需求 9「加载与缓存提速」改造前/后基准（Node 内存 mock，不发真实请求）
 *
 * 目的：用同一套冷启动剧本分别跑「改造前源码（_baseline_cache_20261111 快照）」与「改造后源码」，
 *       给出真实数字：冷启动请求数、首屏可交互时间（ms）、二次进入 setData 次数/字节。
 *
 * 剧本（与实际小程序启动链一致）：
 *   1) 首次启动（无本机缓存）：app.onLaunch → app.onShow（startSync + 300ms warmSync）→
 *      pages/index onLoad/onShow（首屏渲染 + 后台 pullTT/pullNotices）→ 等 500ms 让后台请求落定；
 *   2) 持久化 wx storage（等价于用户正常使用后本机缓存）；
 *   3) 二次冷启动（模块级状态清空、storage 保留 = 杀进程后重开）：同一链路再跑一次，
 *      记录「首帧 state==='data' 时间」与请求数；
 *   4) 页面重入（index onShow 第二次）：记录 setData 调用次数与下发字节（diff 后仅变化字段）。
 *
 * 用法：node cache_speed_bench.js [mpRoot] [--json out.json]
 *   默认跑 before（快照）与 after（当前源码）两次并打印对比表。
 * 约束：全部 Node 内存 mock；wx.request 不触网；wx.cloud 不启用（提醒相关调用静默失败，与真机未部署时一致）。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { performance } = require('perf_hooks');

const BASELINE = require('path').resolve(__dirname, '_baseline_cache_20261111').replace(/\\/g, '/');
const CURRENT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');

const INDEX_FULL_ROWS = [
  { id: 'auto_g1', ts: 1000, hidden: false, edited_at: 0, title: '宿舍卫生检查安排', body: '[[CLASS_NOTICE_V1]]{}' },
  { id: 'auto_g2', ts: 2000, hidden: false, edited_at: 0, title: '报名通知', body: '[[CLASS_NOTICE_V1]]{}' }
];
const HW_ROWS = [{ id: 'h1', subject: '高数', content: '习题 3.1', date: '2099-01-02', time: '23:59', done: false, archived: false, ts: 100 }];

function tableOf(url) {
  const u = String(url || '');
  if (u.indexOf('/site_assets?') >= 0) return 'site_assets';
  if (u.indexOf('/tt.json') >= 0) return 'tt_json';
  if (u.indexOf('/marks?') >= 0) return 'marks';
  if (u.indexOf('/userdata?') >= 0) return 'userdata';
  if (u.indexOf('/notices?') >= 0) return 'notices';
  if (u.indexOf('/homework?') >= 0) return 'homework';
  if (u.indexOf('/fitrecs?') >= 0) return 'fitrecs';
  if (u.indexOf('/visits') >= 0) return 'visits';
  if (u.indexOf('/class_members') >= 0) return 'class_members';
  if (u.indexOf('/power') >= 0) return 'power';
  return 'other';
}
function dataOf(url, method) {
  const t = tableOf(url);
  if (t === 'notices') {
    const u = String(url);
    // 轻量签名查询（客户端 ~2KB）；整表查询返回 2 行（mock，不造 2MB）
    if (u.indexOf('select=id,ts') >= 0 || u.indexOf('select=id%2Cts') >= 0) {
      return INDEX_FULL_ROWS.map(function (r) { return { id: r.id, ts: r.ts, hidden: false, edited_at: 0 }; });
    }
    return INDEX_FULL_ROWS;
  }
  if (t === 'homework') return HW_ROWS;
  if (t === 'class_members') return [{ seat: 1, sid: 's1', name: '张三', role: '班长', badge: '班委', is_admin: false }];
  if (t === 'tt_json') return { c: [], t: '2026-09-01' };
  if (t === 'site_assets') return [];
  if (t === 'userdata') return method === 'GET' ? [] : [];
  return [];
}

function purge(root) {
  const rn = root.replace(/\\/g, '/');
  Object.keys(require.cache).forEach(function (k) {
    if (k.replace(/\\/g, '/').indexOf(rn) !== 0) return;
    const m = require.cache[k];
    try { if (m && m.exports && typeof m.exports.udStop === 'function') m.exports.udStop(); } catch (e) { /* ignore */ }
    delete require.cache[k];
  });
}

async function bench(root) {
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  const mem = Object.create(null);
  mem['zq_class_identity'] = JSON.stringify({
    token: 'bench-token', sid: '3260799999', name: '测试身份', role: '班长', badge: '班委', is_admin: true, ts: Date.now()
  });
  let reqLog = [];
  const savedIntervals = [];
  const prevSetInterval = global.setInterval;
  global.setInterval = function (fn, ms) { const id = prevSetInterval(fn, ms); savedIntervals.push(id); return id; };
  const wxMock = {
    getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
    setStorageSync(k, v) { mem[k] = v; },
    removeStorageSync(k) { delete mem[k]; },
    getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 100, limitSize: 10240 }; },
    request(o) {
      reqLog.push({ url: String(o.url || ''), method: String(o.method || 'GET'), table: tableOf(o.url), at: performance.now() });
      const data = dataOf(o.url, o.method);
      setTimeout(function () { o.success({ statusCode: 200, data: data }); }, 2);
    },
    showToast() {}, showModal() {},
    setClipboardData(o) { if (o && o.success) o.success(); },
    getWindowInfo() { return { windowWidth: 375, windowHeight: 667 }; },
    getSystemInfoSync() { return { windowWidth: 375, windowHeight: 667, SDKVersion: '3.0.0', theme: 'light' }; },
    getAppBaseInfo() { return { SDKVersion: '3.0.0', theme: 'light' }; },
    nextTick(fn) { if (fn) fn(); },
    navigateTo() {}, switchTab() {}, reLaunch() {},
    pageScrollTo() {}, stopPullDownRefresh() {},
    showShareMenu() {}, hideShareMenu() {},
    createSelectorQuery() {
      return {
        in() { return this; }, select() { return this; }, selectViewport() { return this; },
        boundingClientRect() { return this; }, scrollOffset() { return this; },
        fields() { return this; }, exec(cb) { if (cb) cb([{ top: 100 }, { scrollTop: 0 }]); }
      };
    },
    getFileSystemManager() { return { readFile(o) { if (o && o.fail) o.fail(new Error('no-file')); } }; },
    env: { USER_DATA_PATH: '/tmp' }
  };
  global.wx = wxMock;
  global.getCurrentPages = function () { return [{ route: 'pages/index/index' }]; };
  let app = null;
  global.getApp = function () { return app; };
  purge(root);

  // —— 启动一次（冷模块 + 保留 storage）——
  let appDef = null;
  global.App = function (d) { appDef = d; };
  require(path.join(root, 'app.js'));
  delete global.App;
  app = Object.create(appDef);
  app.globalData = JSON.parse(JSON.stringify(appDef.globalData || {}));
  app.onLaunch();

  // 页面：工作台
  let pageDef = null;
  global.Page = function (d) { pageDef = d; };
  require(path.join(root, 'pages/index/index.js'));
  delete global.Page;
  const ctx = Object.create(pageDef);
  ctx.data = JSON.parse(JSON.stringify(pageDef.data || {}));
  ctx.__payload = 0;
  ctx.__calls = 0;
  ctx.setData = function (o, cb) {
    ctx.__calls += 1;
    try { ctx.__payload += Buffer.byteLength(JSON.stringify(o || {})); } catch (e) { /* ignore */ }
    Object.keys(o || {}).forEach(function (k) {
      const parts = k.replace(/\[(\d+)\]/g, '.$1').split('.');
      let t = ctx.data;
      for (let i = 0; i < parts.length - 1; i++) { if (t[parts[i]] == null) t[parts[i]] = {}; t = t[parts[i]]; }
      t[parts[parts.length - 1]] = o[k];
    });
    if (cb) cb();
  };

  const launchT0 = performance.now();
  app.onShow();
  ctx.onLoad({});
  const tShow = performance.now();
  ctx.onShow();
  const syncPaintMs = performance.now() - tShow;
  // 等待首位帧可交互：state==='data'（同步渲染时 ≈ syncPaintMs；出骨架时等 120ms 定时器）
  let paintMs = null;
  const pollStart = performance.now();
  while (performance.now() - pollStart < 2000) {
    if (ctx.data.state === 'data') { paintMs = performance.now() - tShow; break; }
    await sleep(4);
  }
  // 让 300ms warmSync 与后台请求落定
  await sleep(600);
  const requests1 = reqLog.length;
  const byTable1 = {};
  reqLog.forEach(function (r) { byTable1[r.table] = (byTable1[r.table] || 0) + 1; });
  const firstPaint = paintMs == null ? null : Number(paintMs.toFixed(1));

  // 页面重入（模拟从别的 tab 回到工作台）：记录 setData 次数/字节
  ctx.__calls = 0; ctx.__payload = 0;
  reqLog = [];
  ctx.onShow();
  await sleep(80);
  const reentry = { setDataCalls: ctx.__calls, setDataBytes: ctx.__payload, requests: reqLog.length };

  // 清理定时器（app.startSync 30s / refresh 骨架）
  try { app.onHide(); } catch (e) { /* ignore */ }
  savedIntervals.forEach(function (id) { try { clearInterval(id); } catch (e) { /* ignore */ } });
  global.setInterval = prevSetInterval;
  try { require(path.join(root, 'utils/cloud.js')).udStop(); } catch (e) { /* ignore */ }
  // 保存 storage 供下一次「二次冷启动」使用
  const storage = JSON.parse(JSON.stringify(mem));
  JSON.stringify(storage);   // 确认可序列化

  // —— 二次冷启动：清模块、保留 storage ——
  purge(root);
  appDef = null; pageDef = null; app = null;
  global.App = function (d) { appDef = d; };
  require(path.join(root, 'app.js'));
  delete global.App;
  app = Object.create(appDef);
  app.globalData = JSON.parse(JSON.stringify(appDef.globalData || {}));
  app.onLaunch();
  global.Page = function (d) { pageDef = d; };
  require(path.join(root, 'pages/index/index.js'));
  delete global.Page;
  const ctx2 = Object.create(pageDef);
  ctx2.data = JSON.parse(JSON.stringify(pageDef.data || {}));
  ctx2.setData = ctx.setData.bind(null); // 不会用到：新建
  ctx2.setData = function (o, cb) {
    Object.keys(o || {}).forEach(function (k) {
      const parts = k.replace(/\[(\d+)\]/g, '.$1').split('.');
      let t = ctx2.data;
      for (let i = 0; i < parts.length - 1; i++) { if (t[parts[i]] == null) t[parts[i]] = {}; t = t[parts[i]]; }
      t[parts[parts.length - 1]] = o[k];
    });
    if (cb) cb();
  };
  const savedInt2 = [];
  global.setInterval = function (fn, ms) { const id = prevSetInterval(fn, ms); savedInt2.push(id); return id; };
  reqLog = [];
  app.onShow();
  ctx2.onLoad({});
  const tShow2 = performance.now();
  ctx2.onShow();
  let paintMs2 = null;
  if (ctx2.data.state === 'data') paintMs2 = performance.now() - tShow2;
  const poll2 = performance.now();
  while (paintMs2 == null && performance.now() - poll2 < 2000) {
    if (ctx2.data.state === 'data') { paintMs2 = performance.now() - tShow2; break; }
    await sleep(4);
  }
  await sleep(600);
  const requests2 = reqLog.length;
  const byTable2 = {};
  reqLog.forEach(function (r) { byTable2[r.table] = (byTable2[r.table] || 0) + 1; });
  try { app.onHide(); } catch (e) { /* ignore */ }
  savedInt2.forEach(function (id) { try { clearInterval(id); } catch (e) { /* ignore */ } });
  global.setInterval = prevSetInterval;

  const out = {
    root: root,
    firstLaunch: {
      requests: requests1, byTable: byTable1,
      firstPaintMs: firstPaint,
      coldToShowMs: Number((tShow - launchT0).toFixed(1))
    },
    secondLaunch: {
      requests: requests2, byTable: byTable2,
      firstPaintMs: paintMs2 == null ? null : Number(paintMs2.toFixed(1))
    },
    reentry: reentry
  };
  return out;
}

(async function main() {
  const args = process.argv.slice(2);
  const jsonIdx = args.indexOf('--json');
  const baseline = await bench(BASELINE);
  const current = await bench(CURRENT);
  const cmp = {
    at: new Date().toISOString(),
    baseline: baseline,
    current: current,
    diff: {
      firstLaunchRequests: baseline.firstLaunch.requests - current.firstLaunch.requests,
      secondLaunchRequests: baseline.secondLaunch.requests - current.secondLaunch.requests,
      firstLaunchPaintMs: baseline.firstLaunch.firstPaintMs == null || current.firstLaunch.firstPaintMs == null
        ? null : Number((baseline.firstLaunch.firstPaintMs - current.firstLaunch.firstPaintMs).toFixed(1)),
      secondLaunchPaintMs: baseline.secondLaunch.firstPaintMs == null || current.secondLaunch.firstPaintMs == null
        ? null : Number((baseline.secondLaunch.firstPaintMs - current.secondLaunch.firstPaintMs).toFixed(1)),
      reentrySetDataCalls: baseline.reentry.setDataCalls - current.reentry.setDataCalls,
      reentrySetDataBytes: baseline.reentry.setDataBytes - current.reentry.setDataBytes
    },
    pass: null
  };
  // 验收：改造后（1）二次冷启动首屏 ≯ 150ms 且不慢于改造前；（2）二次冷启动请求数 ≤ 改造前；
  //       （3）页面重入不下发整页（改造后 setData 字节 < 改造前）
  const checks = [
    ['二次冷启动首屏有缓存立即渲染（≤150ms）', current.secondLaunch.firstPaintMs != null && current.secondLaunch.firstPaintMs <= 150, JSON.stringify(current.secondLaunch.firstPaintMs)],
    ['二次冷启动请求数 ≤ 改造前', current.secondLaunch.requests <= baseline.secondLaunch.requests, current.secondLaunch.requests + ' vs ' + baseline.secondLaunch.requests],
    ['改造后重入 setData 字节 < 改造前（diff 只下发变化字段）', current.reentry.setDataBytes < baseline.reentry.setDataBytes, current.reentry.setDataBytes + ' vs ' + baseline.reentry.setDataBytes]
  ];
  cmp.checks = checks.map(function (c) { return { name: c[0], ok: !!c[1], detail: c[2] }; });
  cmp.pass = cmp.checks.filter(function (c) { return c.ok; }).length;
  console.log(JSON.stringify(cmp, null, 2));
  const outFile = jsonIdx >= 0 ? args[jsonIdx + 1] : path.join(__dirname, '_perf_cache_v2_result.json');
  fs.writeFileSync(outFile, JSON.stringify(cmp, null, 2), 'utf8');
  console.log('written ' + outFile);
  process.exitCode = cmp.pass === cmp.checks.length ? 0 : 2;
})().catch(function (e) { console.error('FATAL', e); process.exit(1); });
