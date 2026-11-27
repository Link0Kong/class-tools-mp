/* task7_unit_tests.js —— task-7 专项单测（反馈第 2/6/8/9/11 条；2026-11-11）
 *
 * 覆盖：
 *   A. 第 9 条 加载与缓存提速：util.diffPatch 只 setData 变化字段、cloud.marksFresh 首屏去重、
 *      marksPull 单飞（并发 1 请求 / 顺序 force 仍强制拉）、store/cache 同步首屏、水表 GET 60s TTL。
 *   B. 第 11 条 提醒（新通知提醒收不到根治）：cloudfunctions/notify/scan.js 纯逻辑（签名/基线/新增检测/
 *      文案/诊断/门控）、第二模板 templateIds、失败归因 classify、云函数接线（bootstrap/ntStatus/scan/timer）、
 *      nt 页按钮反馈与状态、诊断页 notify diag。
 *   C. 第 6 条 水量共享：23A/23B 固定 4 人间、云端合并（同月云端覆盖/本地独有补传）、离线 pending 队列、
 *      cloud.water* 的 PostgREST 请求口径、页面文案去「免费」。
 *   D. 第 8 条 名单快捷预设：roster 预设集合（全班/班委/团员）、class_league 6h 缓存、roster-picker 组件行为。
 *   E. 第 2 条 徽章去重：util.showBadge、班委页渲染、工具描述同步。
 *
 * 运行方式：
 *   node task7_unit_tests.js     # 独立运行（写 task7_unit_result.json）
 *   node unit.js                 # unit.js 末尾 require 本文件 run(test)，并入总表
 *
 * 约束：全部 Node 内存 mock；不发真实请求、不读写真实云端、不启动模拟器。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');
const ROOT_N = ROOT.replace(/\\/g, '/');

const ID = { token: 'tok-task7', sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: true, ts: 1 };

/* ---------------------------------------------------------------- wx mock 上下文 */
function createCtx() {
  const mem = Object.create(null);
  let reqLog = [];
  let reqImpl = function (o) { o.success({ statusCode: 200, data: [] }); };
  let toastLog = [];
  let modalLog = [];
  let subLog = [];
  let cloudCalls = [];
  let cloudReply = null;
  const wxMock = {
    getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
    setStorageSync(k, v) { mem[k] = v; },
    removeStorageSync(k) { delete mem[k]; },
    getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 0, limitSize: 10240 }; },
    request(o) { reqLog.push(o); reqImpl(o); },
    showToast(o) { toastLog.push(o && o.title); },
    showModal(o) { modalLog.push(o && o.title); if (o && o.success) o.success({ confirm: true, cancel: false }); },
    setClipboardData(o) { if (o && o.success) o.success(); },
    getWindowInfo() { return { windowWidth: 375, windowHeight: 667 }; },
    getSystemInfoSync() { return { windowWidth: 375, windowHeight: 667, SDKVersion: '3.0.0' }; },
    getAppBaseInfo() { return { SDKVersion: '3.0.0' }; },
    nextTick(fn) { if (fn) fn(); },
    navigateTo() {}, switchTab() {}, reLaunch() {},
    requestSubscribeMessage(o) {
      subLog.push(o);
      const ids = (o && o.tmplIds) || [];
      const res = {};
      ids.forEach(function (id) { res[id] = 'accept'; });
      if (o && o.success) o.success(res);
    },
    createSelectorQuery() {
      return {
        in() { return this; }, select() { return this; }, selectViewport() { return this; },
        boundingClientRect() { return this; }, scrollOffset() { return this; },
        fields() { return this; }, exec(cb) { if (cb) cb([{ top: 100 }, { scrollTop: 0 }]); }
      };
    },
    getFileSystemManager() { return { readFile(o) { if (o && o.fail) o.fail(new Error('no-file')); } }; },
    cloud: {
      init() {},
      callFunction(o) {
        cloudCalls.push({ name: o && o.name, data: o && o.data });
        const reply = (typeof cloudReply === 'function') ? cloudReply(o && o.data) : { ok: true };
        return Promise.resolve({ result: reply });
      }
    }
  };
  return {
    mem: mem,
    wxMock: wxMock,
    clearMem() {
      Object.keys(mem).forEach(function (k) { delete mem[k]; });
      reqLog = []; toastLog = []; modalLog = []; subLog = []; cloudCalls = []; cloudReply = null;
      reqImpl = function (o) { o.success({ statusCode: 200, data: [] }); };
    },
    setReq(fn) { reqImpl = fn; },
    reqLog() { return reqLog; },
    reqUrls(frag) { return reqLog.filter(function (o) { return String((o && o.url) || '').indexOf(frag) >= 0; }); },
    toastLog() { return toastLog; },
    modalLog() { return modalLog; },
    subLog() { return subLog; },
    cloudCalls() { return cloudCalls; },
    setCloudReply(fn) { cloudReply = fn; },
    setIdentity(id) { mem['zq_class_identity'] = JSON.stringify(id || ID); }
  };
}

function purge() {
  Object.keys(require.cache).forEach(function (k) {
    if (k.replace(/\\/g, '/').indexOf(ROOT_N) !== 0) return;
    try {
      const m = require.cache[k];
      if (m && m.exports && typeof m.exports.udStop === 'function') m.exports.udStop();
    } catch (e) { /* ignore */ }
    delete require.cache[k];
  });
}
function R(rel) { return require(path.join(ROOT, rel)); }
function src(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function enableCloud(cloud) {
  cloud.configure({ enabled: true, restBase: 'https://rest.test/v1/rdb/rest/', publishableKey: 'pk-test', ttUrl: 'https://static.test/tt.json' });
}
function loadPage(rel) {
  let def = null;
  const file = path.join(ROOT, 'pages', rel + '.js');
  try { delete require.cache[require.resolve(file)]; } catch (e) { /* ignore */ }
  global.Page = function (d) { def = d; };
  try { require(file); } finally { delete global.Page; }
  assert.ok(def && typeof def === 'object', '页面未注册 Page：' + rel);
  return def;
}
function loadComponent(rel) {
  let def = null;
  const file = path.join(ROOT, 'components', rel + '.js');
  try { delete require.cache[require.resolve(file)]; } catch (e) { /* ignore */ }
  global.Component = function (d) { def = d; };
  try { require(file); } finally { delete global.Component; }
  assert.ok(def && typeof def === 'object', '组件未注册 Component：' + rel);
  return def;
}
function makeSetData(ctx) {
  ctx.__log = [];
  return function (o, cb) {
    ctx.__log.push(Object.keys(o || {}));
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
function ctxOf(def, extra) {
  const ctx = Object.assign({}, def);
  ctx.data = JSON.parse(JSON.stringify(def.data || {}));
  ctx.setData = makeSetData(ctx);
  if (extra) Object.assign(ctx, extra);
  return ctx;
}
function compCtx(comp) {
  const ctx = Object.assign({}, comp.methods);
  ctx.data = JSON.parse(JSON.stringify(comp.data || {}));
  ctx.data = Object.assign(ctx.data, { items: [], selMap: {}, count: 0, total: 0, quick: '' });
  ctx.setData = makeSetData(ctx);
  ctx.triggerEvent = function () {};
  ctx.methods = comp.methods;
  return ctx;
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

/* ================================================================ RUN */
function run(test) {
  const prevWx = global.wx;
  const C = createCtx();
  global.wx = C.wxMock;
  const prevGetCurrentPages = global.getCurrentPages;
  const prevGetApp = global.getApp;
  global.getCurrentPages = function () { return [{ route: 'pages/index/index' }]; };
  global.getApp = function () { return { notifyPages() {} }; };

  return (async function () {
    await test('班级作业在任务页加入后才出现在工作台，最后一项加入后回到个人任务', async function () {
      purge(); C.clearMem(); C.setIdentity();
      const d = R('utils/store.js').get(), task = R('utils/task.js');
      d.homework = [{ id: 'h1', content: '同名' }, { id: 'h2', content: '同名' },
        { content: '旧作业', ts: 12345 }, { id: 'marked', content: '已交' }, { id: 'hidden', content: '已隐藏' }];
      d.hwDone = { marked: true };
      d.hwHide = { hidden: true };
      const page = ctxOf(loadPage('task/task'), { _expanded: {} });
      const home = ctxOf(loadPage('index/index'), { _hidden: true });
      page.refresh();
      assert.strictEqual(page.data.classCount, 3);
      page.onSeg({ detail: { value: 'class' } });
      const tap = { currentTarget: { dataset: { id: 'h1' } } };
      page.classToTask(tap);
      page.classToTask(tap);
      assert.strictEqual(page.data.classCount, 2);
      assert.strictEqual(page.data.seg, 'class');
      assert.strictEqual(task.items().length, 1);
      home.refresh();
      assert.strictEqual(home.data.hw.open, 1);
      page.classAllToTask();
      assert.strictEqual(page.data.classCount, 0);
      assert.strictEqual(page.data.seg, 'my');
      assert.strictEqual(task.items().length, 3);
      const oldId = d.homework[2].id;
      assert.ok(oldId && task.items().some(t => t.sourceHwId === oldId));
      const first = task.items().find(t => t.sourceHwId === 'h1');
      task.setDone(first.id, true);
      task.resetCache();
      page.refresh(); home.refresh();
      assert.strictEqual(page.data.classCount, 0);
      assert.strictEqual(home.data.hw.open, 2);
      task.removeTask(first.id);
      page.onCloudSync();
      assert.deepStrictEqual(page.data.classOpen.map(h => h.id), ['h1']);
      d.homework = [];
      page.onCloudSync();
      assert.strictEqual(page.data.classCount, 0);
    });
    /* ============================================================
       A. 第 9 条 加载与缓存提速
       ============================================================ */
    await test('A1 util.diffPatch：只返回变化字段（无变化 null / 浅比较 / 对象深比较跳过）', function () {
      purge();
      const util = R('utils/util.js');
      assert.strictEqual(util.diffPatch({ a: 1, b: 'x' }, { a: 1, b: 'x' }), null, '完全相等 → null（不 setData）');
      assert.deepStrictEqual(util.diffPatch({ a: 1, b: 'x' }, { a: 1, b: 'y' }), { b: 'y' }, '只含变化字段');
      assert.deepStrictEqual(util.diffPatch({}, { a: 1 }), { a: 1 }, '新增字段');
      assert.strictEqual(util.diffPatch({ o: { x: [1, 2] } }, { o: { x: [1, 2] } }), null, '对象内容相等 → 跳过');
      const p = util.diffPatch({ o: { x: [1, 2] } }, { o: { x: [1, 3] } });
      assert.ok(p && p.o && p.o.x[1] === 3, '对象内容变化 → 下发该字段');
    });

    await test('A2 cloud.marksFresh：marks 拉取成功后 5s 内为真（避免 app 预热与页面 onShow 重复强拉）', async function () {
      purge();
      C.clearMem(); C.setIdentity();
      const cloud = R('utils/cloud.js'); enableCloud(cloud);
      C.setReq(function (o) { o.success({ statusCode: 200, data: [] }); });
      assert.strictEqual(cloud.marksFresh(5000), false, '初始未拉取 → false');
      await cloud.marksPull(true);
      assert.strictEqual(cloud.marksFresh(5000), true, '刚拉取成功 → true');
      await sleep(30);
      assert.strictEqual(cloud.marksFresh(10), false, '超过窗口 → false');
      const appSrc = src('app.js');
      assert.ok(/cloud\.marksFresh\(5000\)/.test(appSrc), 'app.warmSync 应用 marksFresh(5000) 去重（需求 9）');
      assert.ok(/cloud\.marksPull\(true\)/.test(appSrc), 'app.js 仍保留契约要求的强制拉取（regex 兼容 sync_contract）');
      assert.ok(appSrc.indexOf('marksFresh') < appSrc.indexOf('cloud.marksPull(true)'), '先判断新鲜度再决定是否强拉');
    });

    await test('A3 marksPull 单飞：3 个并发强拉只发 1 个 GET；顺序 force 仍强制拉一次（契约不回归）', async function () {
      purge();
      C.clearMem(); C.setIdentity();
      const cloud = R('utils/cloud.js'); enableCloud(cloud);
      C.setReq(function (o) {
        setTimeout(function () { o.success({ statusCode: 200, data: [] }); }, 20);
      });
      await Promise.all([cloud.marksPull(true), cloud.marksPull(true), cloud.marksPull(true)]);
      assert.strictEqual(C.reqUrls('/marks?').length, 1, '单飞：并发只发 1 次');
      await cloud.marksPull(true);
      assert.strictEqual(C.reqUrls('/marks?').length, 2, '顺序 force 仍强制拉（需求 16 契约不变）');
    });

    await test('A4 首屏：store/cache 同步读取 0 请求；index.refresh 二次无变化不 setData，变化只 setData 变化字段', async function () {
      purge();
      C.clearMem();
      // 预置本机缓存（zq_tools_v2）→ 冷启动直接可用
      const store = R('utils/store.js');
      C.setIdentity();
      store.get().termStart = '2026-09-01';
      store.save();
      const task = R('utils/task.js');
      const item = task.upsert(task.emptyItem({ title: '高数习题', due: '2099-01-01' }));
      const cloud = R('utils/cloud.js'); enableCloud(cloud);
      C.setReq(function (o) { o.success({ statusCode: 200, data: [] }); });
      const def = loadPage('index/index');
      const ctx = ctxOf(def);
      ctx._hidden = false;
      ctx.refresh();
      assert.strictEqual(ctx.data.state, 'data', '有本机缓存 → 首屏同步 data（不等网络）');
      assert.strictEqual(ctx.data.hw.open, 1, '本机个人任务直接渲染');
      assert.ok(ctx.__log.length >= 1, 'refresh() 同步 setData（本机缓存立即渲染，不等网络）');
      assert.strictEqual(ctx.data.state, 'data');
      const calls = ctx.__log.length;
      assert.ok(calls >= 1, '首次 refresh 会 setData');
      ctx.refresh();
      assert.strictEqual(ctx.__log.length, calls, '状态未变化 → 不再 setData（diffPatch 返回 null）');
      task.setDone(item.id, true);
      ctx.refresh();
      assert.strictEqual(ctx.__log.length, calls + 1, '只有变化时才 setData');
      const keys = ctx.__log[ctx.__log.length - 1].join(',');
      assert.ok(keys.indexOf('hw') >= 0, '变化的是 hw 字段：' + keys);
      assert.ok(keys.indexOf('today') < 0 && keys.indexOf('quick') < 0, '未变化的 today/quick 不下发：' + keys);
      // 首屏骨架只在「本机无缓存」时出现（有缓存时 onShow 同步 data，无 120ms 延迟）
      const idxJs = src('pages/index/index.js');
      assert.ok(/if \(this\._hasLocalData\(\)\) \{\s*\n\s*this\.refresh\(\);/.test(idxJs), 'index.onShow：有本机缓存 → 同步 refresh（不先出骨架）');
      const hwJs = src('pages/hw/hw.js');
      assert.ok(/_hasLocalHw\(\)/.test(hwJs) && /if \(this\._hasLocalHw\(\)\) \{/.test(hwJs), 'hw.onShow：有作业缓存 → 同步 refresh（去掉首屏 140ms 骨架延迟）');
      const ctx2 = ctxOf(def);
      ctx2.onLoad({});
      ctx2._first = true;
      try {
        ctx2.onShow();
        assert.strictEqual(ctx2.data.state, 'data', '工作台 onShow 首帧即有缓存 → 立即 data');
        assert.ok(!ctx2.__log.some(function (k) { return k.length === 1 && k[0] === 'state'; }), '有缓存首帧不应 setData({state:"loading"})');
      } finally {
        ctx2.onUnload();
      }
    });

    await test('A5 高频页 TTL：waterList 60s 内重复进入 0 重复 GET（force 才重新拉）；notices 签名/分块缓存仍在', async function () {
      purge();
      C.clearMem(); C.setIdentity();
      const cloud = R('utils/cloud.js'); enableCloud(cloud);
      C.setReq(function (o) {
        if (String(o.url).indexOf('/water?') >= 0) return o.success({ statusCode: 200, data: [] });
        o.success({ statusCode: 200, data: [] });
      });
      const r1 = await cloud.waterList('1-13---324');
      assert.strictEqual(r1.ok, true);
      const r2 = await cloud.waterList('1-13---324');
      assert.strictEqual(r2.cached, true, '60s TTL 内第二次命中缓存（0 请求）');
      assert.strictEqual(C.reqUrls('/water?').length, 1, '只发 1 次 GET');
      await cloud.waterList('1-13---324', true);
      assert.strictEqual(C.reqUrls('/water?').length, 2, 'force 强制核对一次');
      assert.ok(cloud.cache && typeof cloud.cache.get === 'function', '通知分块持久缓存保留');
      assert.ok(cloud.TTL.notices >= 600000, 'notices TTL 仍为 10 分钟');
    });

    /* ============================================================
       B. 第 11 条 提醒（新通知提醒）
       ============================================================ */
    await test('B1 scan.sigOf / detectNew：首跑只记基线不补发；新增 id 才算新通知；删除/编辑不发送', function () {
      const scan = R('cloudfunctions/notify/scan.js');
      const rows = [
        { id: 'auto_a', ts: 100, hidden: false, edited_at: 0, title: 'A' },
        { id: 'auto_b', ts: 200, hidden: false, edited_at: 0, title: 'B' }
      ];
      const sig = scan.sigOf(rows);
      assert.strictEqual(sig, 'auto_a:100:0:0|auto_b:200:0:0', '签名与小程序 ntSigOf 同口径');
      const first = scan.detectNew({}, rows);
      assert.strictEqual(first.baseline, true, '首次运行只记基线');
      assert.strictEqual(first.changed, false);
      assert.strictEqual(first.newRows.length, 0, '首跑不补发历史通知');
      const same = scan.detectNew({ lastSig: sig, lastIds: scan.idKeys(rows) }, rows);
      assert.strictEqual(same.changed, false, '签名相同 → 无变化');
      const rows2 = rows.concat([{ id: 'auto_c', ts: 300, hidden: false, edited_at: 0, title: 'C' }]);
      const det = scan.detectNew({ lastSig: sig, lastIds: scan.idKeys(rows) }, rows2);
      assert.strictEqual(det.changed, true);
      assert.strictEqual(det.newRows.length, 1);
      assert.strictEqual(det.newRows[0].id, 'auto_c', '新增 id 才是新通知');
      // 编辑/删除（签名变化但没有新 id）→ 只更新基线
      const edited = scan.detectNew({ lastSig: sig, lastIds: scan.idKeys(rows) },
        [{ id: 'auto_a', ts: 100, hidden: false, edited_at: 999, title: 'A' }, { id: 'auto_b', ts: 200, hidden: false, edited_at: 0 }]);
      assert.strictEqual(edited.changed, true);
      assert.strictEqual(edited.newRows.length, 0, '管理员编辑不算新通知（不补发）');
      // hidden 的新行不发送
      const hidden = scan.detectNew({ lastSig: sig, lastIds: scan.idKeys(rows) },
        rows.concat([{ id: 'auto_h', ts: 400, hidden: true, edited_at: 0 }]));
      assert.strictEqual(hidden.newRows.length, 0, 'hidden 行不发送');
    });

    await test('B2 scan.pickLatest / messageOf / cfgView：最新一条文案 + 诊断脱敏（不返回 token）', function () {
      const scan = R('cloudfunctions/notify/scan.js');
      const rows = [
        { id: 'auto_a', ts: 100, title: '旧通知' },
        { id: 'auto_b', ts: 300, title: '这是一条非常非常非常长的班级新通知标题用于截断验证' }
      ];
      const latest = scan.pickLatest(rows);
      assert.strictEqual(latest.id, 'auto_b', '取 ts 最新一条');
      const fmt = function (ms) { return 'T' + ms; };
      const msg = scan.messageOf(latest, fmt);
      assert.strictEqual(msg.tip, '新通知');
      assert.strictEqual(msg.timeText, 'T300');
      assert.ok(msg.summary.length <= 18, '摘要 ≤18 字：' + msg.summary);
      assert.strictEqual(scan.pickLatest([{ id: 'x', ts: 1, hidden: true }]), null, 'hidden 全部 → null');
      const cfg = scan.normCfg({ token: 'SECRET-TOKEN-XYZ', tokenAt: 1000, lastSig: 's', lastScanAt: 2000, sentCount: 3, lastError: 'e1' });
      assert.strictEqual(cfg.token, 'SECRET-TOKEN-XYZ', '云端内部归一保留 token');
      const view = scan.cfgView(cfg, 5000);
      assert.ok(!('token' in view), '诊断视图不得含 token 字段');
      assert.ok(JSON.stringify(view).indexOf('SECRET-TOKEN') < 0, '诊断视图 JSON 不得出现 token 明文');
      assert.strictEqual(view.hasToken, true);
      assert.strictEqual(view.sentCount, 3);
      assert.strictEqual(view.lastError, 'e1');
    });

    await test('B2b scan.mergeCfg：配置增量必须保留 token/lastSig（2026-11-15 整文档覆盖回归）', function () {
      const scan = R('cloudfunctions/notify/scan.js');
      // 模拟 bootstrap 已写入 token / 基线，随后 scan 只 patch lastSig/lastScanAt
      const before = {
        token: 'SECRET-TOKEN-XYZ', tokenAt: 1000, bootAt: 1000,
        lastSig: 'a:1:0:0', lastIds: ['a:1'], lastScanAt: 2000,
        sentCount: 2, lastSentAt: 1500, baselineAt: 1200
      };
      const merged = scan.mergeCfg(before, { lastSig: 'a:1:0:0|b:2:0:0', lastIds: ['a:1', 'b:2'], lastScanAt: 5000, sentCount: 3 });
      assert.strictEqual(merged.token, 'SECRET-TOKEN-XYZ', 'patch lastSig 不得清掉班级 token');
      assert.strictEqual(merged.tokenAt, 1000);
      assert.strictEqual(merged.lastSig, 'a:1:0:0|b:2:0:0', 'patch 生效');
      assert.deepStrictEqual(merged.lastIds, ['a:1', 'b:2']);
      assert.strictEqual(merged.lastScanAt, 5000);
      assert.strictEqual(merged.sentCount, 3);
      // bootstrap 只 patch token 时，也必须保留扫描基线（否则每次启动都重新当首跑漏新通知）
      const boot = scan.mergeCfg(merged, { token: 'SECRET-TOKEN-2', tokenAt: 6000, bootAt: 6000, lastError: '', lastErrAt: 0 });
      assert.strictEqual(boot.token, 'SECRET-TOKEN-2');
      assert.strictEqual(boot.lastSig, 'a:1:0:0|b:2:0:0', 'bootstrap 不得清掉 lastSig 基线');
      assert.deepStrictEqual(boot.lastIds, ['a:1', 'b:2']);
      assert.strictEqual(boot.lastScanAt, 5000);
      // 归一化坏数据：patch 非对象 / undefined 不炸；缺字段走默认
      const safe = scan.mergeCfg(null, null);
      assert.strictEqual(safe.token, '');
      assert.deepStrictEqual(safe.lastIds, []);
      // 诊断视图仍然不泄 token
      const view = scan.cfgView(boot, 7000);
      assert.ok(JSON.stringify(view).indexOf('SECRET-TOKEN') < 0, 'merge 后诊断视图仍不得出现 token 明文');
      assert.strictEqual(view.hasToken, true);
    });

    await test('B3 scan.shouldScan 门控：无 token / 无订阅 / 5 分钟内已扫 → 不产生外部请求', function () {
      const scan = R('cloudfunctions/notify/scan.js');
      const NOW = 1700000000000;
      assert.strictEqual(scan.shouldScan({}, NOW, 5 * 60 * 1000, true).reason, 'no-token');
      assert.strictEqual(scan.shouldScan({ token: 't' }, NOW, 5 * 60 * 1000, false).reason, 'no-subscribers');
      assert.strictEqual(scan.shouldScan({ token: 't', lastScanAt: NOW - 60 * 1000 }, NOW, 5 * 60 * 1000, true).reason, 'too-soon');
      assert.strictEqual(scan.shouldScan({ token: 't', lastScanAt: NOW - 6 * 60 * 1000 }, NOW, 5 * 60 * 1000, true).ok, true);
      assert.strictEqual(scan.shouldScan({ token: 't' }, NOW, 5 * 60 * 1000, true).ok, true, '首次扫描放行');
      assert.strictEqual(scan.tokenHealthy({ token: 't', tokenAt: NOW - 29 * 86400000 }, NOW), true);
      assert.strictEqual(scan.tokenHealthy({ token: 't', tokenAt: NOW - 31 * 86400000 }, NOW), false, '超 30 天 token 诊断提示需刷新');
    });

    await test('B4 notify.templateIds / classify：默认只用 1 个模板；第二模板未配置不请求；失败原因可读', function () {
      purge();
      const notify = R('utils/notify.js');
      assert.strictEqual(notify.TEMPLATE_ID, 'ZqIur9lMTUTrbKeTXzirEEtHosvLFm-7sULeBjmyMjk', '新模板（日程提醒）');
      assert.deepStrictEqual(notify.templateIds(), [notify.TEMPLATE_ID], '默认只请求默认模板（向后兼容）');
      assert.strictEqual(notify.templateIds().length, 1);
      assert.strictEqual(notify.classify(new Error('denied')), 'denied');
      assert.strictEqual(notify.classify(new Error('requestSubscribeMessage:fail not support')), 'unsupported');
      assert.strictEqual(notify.classify(new Error('cloud.callFunction:fail FunctionName parameter could not be found')), 'cloud-missing');
      assert.strictEqual(notify.classify(new Error('requestSubscribeMessage:fail main switch is off')), 'disabled-setting');
      assert.strictEqual(notify.classify(new Error('request:fail timeout')), 'network');
      assert.strictEqual(notify.classify(new Error('some-weird')), 'unknown');
    });

    await test('B5 授权链：新通知提醒已移除；手动通知提醒仍走 ask + 云函数（dateText=报名开始）', async function () {
      purge();
      C.clearMem(); C.setIdentity();
      C.setCloudReply(function (data) {
        if (data.action === 'subscribe') return { ok: true };
        if (data.action === 'diag') return { ok: true, diag: { hb: null, active: 2, lastError: '' } };
        return { ok: true };
      });
      const notify = R('utils/notify.js');
      ['subscribeNotice', 'publishNotice', 'status', 'bootstrap', 'clearStatusCache'].forEach(function (k) {
        assert.strictEqual(notify[k], undefined, '新通知提醒接口应移除：' + k);
      });
      const fireAt = Date.now() + 3600000;
      const baseTs = Date.now() + 86400000;
      await notify.subscribeNoticeReminder({ id: 'auto_g1', title: '测试通知', baseTs: baseTs }, fireAt, '报名开始时');
      assert.strictEqual(C.subLog().length, 1, '一次授权');
      assert.deepStrictEqual(C.subLog()[0].tmplIds, notify.templateIds(), 'tmplIds = templateIds()');
      const sub = C.cloudCalls().find(function (x) { return x.data && x.data.action === 'subscribe'; });
      assert.ok(sub && sub.data.kind === 'ntremind' && sub.data.ref === 'auto_g1', '手动通知提醒 → kind=ntremind');
      assert.strictEqual(sub.data.dateText, notify.fmt(baseTs), '模板日期显示报名开始，而不是截止');
      const dg = await notify.diag();
      assert.ok(dg && dg.active === 2, 'diag 保留提醒通道诊断');
      assert.ok(C.reqLog().length === 0, '提醒授权/云函数不走 wx.request');
    });

    await test('B6 云函数接线（静态，旧版客户端兼容）：timer 扫新通知 + bootstrap/ntStatus/scan action + 第二模板 + 无 token 打印', function () {
      const js = src('cloudfunctions/notify/index.js');
      assert.ok(/require\('\.\/scan\.js'\)/.test(js), 'index.js 引入 scan.js');
      assert.ok(/scanNewNotices\(\{\}\)/.test(js), 'timer 里调用新通知扫描');
      assert.ok(/if \(event\.action === 'bootstrap'\)/.test(js), '有 bootstrap action（客户端上报班级 token）');
      assert.ok(/if \(event\.action === 'ntStatus'\)/.test(js), '有 ntStatus action（按钮反馈 active 数）');
      assert.ok(/if \(event\.action === 'scan'\)/.test(js), '有 scan action（排查/自测）');
      assert.ok(/NOTIFY_TMPL2/.test(js), '支持第二模板（环境变量 NOTIFY_TMPL2）');
      assert.ok(/ZqIur9lMTUTrbKeTXzirEEtHosvLFm-7sULeBjmyMjk/.test(js), '新模板 ID（日程提醒）');
      assert.ok(/eYDRJDSTJdRL-gvE0rM8EbuSZX6mA9L2U-UTA8MwSmo/.test(js), '旧模板 ID 兼容保留（旧客户端）');
      assert.ok(/thing1/.test(js) && /time2/.test(js) && /thing3/.test(js) && /thing5/.test(js), '新模板字段映射');
      assert.ok(/NOTICE_SCAN_Q/.test(js) && /select=id,ts,title,hidden,edited_at/.test(js), '轮询 notices 轻量表（同签名口径）');
      assert.ok(/X-Class-Token/.test(js), '轮询带班级 token（X-Class-Token）');
      assert.ok(!/console\.(log|info|warn|error)\([^)]*token/i.test(js), '不得打印 token');
      assert.ok(!/service_role|appsecret/i.test(js), '不得出现 service_role / appsecret');
      const rest = src('cloudfunctions/notify/rest-config.js');
      assert.ok(/NOTIFY_REST_BASE/.test(rest) && /NOTIFY_PUBLIC_KEY/.test(rest), 'REST 配置支持环境变量覆盖');
      assert.ok(/publishableKey/.test(rest) && !/^\s*(appsecret|service_role)\s*[:=]/m.test(rest), 'rest-config 只含公开 publishableKey（注释里说明禁用不算）');
      assert.ok(/scanMinMs/.test(rest), '扫描最小间隔可配（默认 5 分钟）');
    });

    await test('B7 新通知提醒 UI/接口已移除，手动提醒与诊断保留', function () {
      const js = src('pages/nt/nt.js');
      assert.ok(!/subscribeNextNotice|refreshNotifyStatus|ntSubOn|ntStatusText|notify\.status\(/.test(js), 'nt 页仍残留新通知提醒');
      assert.ok(/subscribeNoticeReminder/.test(js) && /flushReminders/.test(src('app.js')), '手动提醒链路保留');
      const wxml = src('pages/nt/nt.wxml');
      assert.ok(!/subscribeNextNotice|ntStatusText|ntSubOn|subBusy/.test(wxml), 'nt.wxml 仍残留新通知提醒 UI');
      assert.ok(/bindtap="refresh">刷新</.test(wxml), '简报区保留刷新');
      const idx = src('pages/index/index.wxml');
      assert.ok(!/ntNew|wb-task-new/.test(idx), '工作台仍残留新通知角标');
      const diagJs = src('pages/diag/diag.js');
      const diagWxml = src('pages/diag/diag.wxml');
      assert.ok(/loadNotifyDiag/.test(diagJs) && /notifyDiag/.test(diagJs), '诊断页保留提醒通道诊断');
      assert.ok(/提醒通道诊断/.test(diagWxml) && /hbText/.test(diagWxml), '诊断页 UI 显示心跳/active/lastError');
      assert.ok(!/scanText|ntActive|新通知扫描/.test(diagJs + diagWxml), '诊断页仍残留新通知扫描');
      const appJs = src('app.js');
      assert.ok(!/notify\.bootstrap|d\.ntSub/.test(appJs), 'app.warmSync 不应再上报新通知 token');
      assert.ok(/notify\.flushReminders\(\)/.test(appJs), '保留前端手动提醒 catch-up');
    });

    /* ============================================================
       C. 第 6 条 水量共享
       ============================================================ */
    await test('C1 water.isFixed4 / fixedPersons：固定四人间已取消，所有宿舍 1–6 自选', function () {
      purge();
      const water = R('utils/water.js');
      assert.strictEqual(water.isFixed4('4-23A---324'), false);
      assert.strictEqual(water.isFixed4('4-23B---423'), false);
      assert.strictEqual(water.isFixed4('1-13---324'), false);
      assert.strictEqual(water.isFixed4('1-16---305'), false);
      assert.strictEqual(water.fixedPersons('4-23A---321', 6), 6, '23A 也可 6 人');
      assert.strictEqual(water.fixedPersons('1-13---324', 5), 5, '5 人间合法');
      assert.strictEqual(water.fixedPersons('1-13---324', 99), 4, '非法 → 默认 4');
    });

    await test('C2 water.mergeCloud：全量结果移除失效月份，读取不补传', function () {
      purge();
      const water = R('utils/water.js');
      const local = [{ m: '2026-09', r: 100, ts: 1 }, { m: '2026-10', r: 110, ts: 2 }, { m: '2026-11', r: 120, ts: 3 }];
      const cloud = [
        { month: '2026-10', reading: 111, persons: 4, updated_at: '2026-10-31T00:00:00+08:00' },
        { month: '2026-11', reading: 121, persons: 4, updated_at: '2026-11-30T00:00:00+08:00' }
      ];
      const m = water.mergeCloud(local, cloud);
      assert.strictEqual(m.changed, true);
      assert.deepStrictEqual(m.recs.map(function (r) { return r.m + '=' + r.r; }), ['2026-10=111', '2026-11=121']);
      assert.deepStrictEqual(m.missing, [], '旧缓存不构成写入意图');
      assert.strictEqual(m.cloudCount, 2);
      const same = water.mergeCloud(m.recs, cloud);
      assert.strictEqual(same.changed, false, '完全一致 → 不重写本机');
      const empty = water.mergeCloud([], []);
      assert.strictEqual(empty.changed, false);
      assert.deepStrictEqual(water.cloudRecsOf([{ month: '2026-10', reading: '111.5', updated_at: '2026-10-31T00:00:00+08:00' }]),
        [{ m: '2026-10', r: 111.5, ts: Date.parse('2026-10-31T00:00:00+08:00') }], '云端行归一（2 位小数 + updated_at→ts）');
      assert.strictEqual(water.roomPersonsOf([{ persons: 6 }]), 6);
      assert.strictEqual(water.roomPersonsOf(null), null);
    });

    await test('C3 离线 pending 队列：normOp 校验 / pushOp 同 key 后写覆盖 / 重试后 dropOp', function () {
      purge();
      const water = R('utils/water.js');
      assert.strictEqual(water.normOp({ op: 'put', rv: '', m: '2026-11', r: 1 }), null, '缺 rv 丢弃');
      assert.strictEqual(water.normOp({ op: 'put', rv: '1-13---324', m: 'bad', r: 1 }), null, '坏月份丢弃');
      assert.strictEqual(water.normOp({ op: 'put', rv: '1-13---324', m: '2026-11', r: -1 }), null, '负读数丢弃');
      let list = water.pushOp([], { op: 'put', rv: '1-13---324', m: '2026-11', r: 123.4, p: 6 });
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].r, 123.4);
      list = water.pushOp(list, { op: 'put', rv: '1-13---324', m: '2026-11', r: 125.5, p: 6 });
      assert.strictEqual(list.length, 1, '同 key 覆盖不堆积');
      assert.strictEqual(list[0].r, 125.5);
      list = water.pushOp(list, { op: 'del', rv: '4-23B---423', m: '2026-09' });
      assert.strictEqual(list.length, 2);
      const after = water.dropOp(list, list[0]);
      assert.strictEqual(after.length, 1);
      assert.strictEqual(after[0].op, 'del');
      assert.strictEqual(water.normOps([null, 1, 'x', { op: 'persons', rv: '4-23A---321', p: 6 }]).length, 1, '坏项过滤');
      assert.strictEqual(water.normOps([{ op: 'persons', rv: '4-23A---321', p: 6 }])[0].p, 6, '23A 人数 op 保留 6');
    });

    await test('C4 cloud.water*：PostgREST 口径（GET/POST/DELETE + Prefer + on_conflict，唯一 CloudBase 通道）', async function () {
      purge();
      C.clearMem(); C.setIdentity();
      const cloud = R('utils/cloud.js'); enableCloud(cloud);
      C.setReq(function (o) {
        if (String(o.url).indexOf('/water_room?') >= 0) return o.success({ statusCode: 200, data: [{ roomverify: '1-13---324', persons: 6 }] });
        if (String(o.url).indexOf('/water?') >= 0) return o.success({ statusCode: 200, header: { 'Content-Range': '0-0/1' }, data: [{ roomverify: '1-13---324', month: '2026-11', reading: 123.4, persons: 6 }] });
        o.success({ statusCode: 200, data: [] });
      });
      const list = await cloud.waterList('1-13---324', true);
      assert.strictEqual(list.ok, true);
      const get = C.reqUrls('/water?')[0];
      assert.ok(/select=roomverify,month,reading,persons/.test(get.url), 'GET 列字段口径');
      assert.ok(/roomverify=eq\.1-13---324/.test(get.url), 'GET 按房间过滤');
      assert.ok(/order=month\.asc/.test(get.url), 'GET 按月份升序');
      assert.ok(/X-Class-Token/.test(JSON.stringify(get.header || {})), '带班级 token');
      const up = await cloud.waterUpsert('1-13---324', '2026-11', 123.4, 6);
      assert.strictEqual(up.ok, true);
      const post = C.reqUrls('/water?')[1];
      assert.strictEqual(post.method, 'POST');
      assert.ok(/on_conflict=roomverify,month/.test(post.url), 'POST on_conflict 幂等 upsert');
      assert.ok(/resolution=merge-duplicates/.test(String((post.header || {}).Prefer || '')), 'Prefer merge-duplicates');
      assert.deepStrictEqual(post.data, { roomverify: '1-13---324', month: '2026-11', reading: 123.4, persons: 6 }, 'body 字段与契约一致');
      const del = await cloud.waterDelete('1-13---324', '2026-11');
      assert.strictEqual(del.ok, true);
      const dreq = C.reqLog().filter(function (o) { return o.method === 'DELETE'; })[0];
      assert.ok(/water\?roomverify=eq\.1-13---324&month=eq\.2026-11/.test(dreq.url), 'DELETE 按房间+月份');
      const room = await cloud.waterRoomGet('1-13---324');
      assert.strictEqual(room.persons, 6, 'water_room 人数读取');
      const roomUp = await cloud.waterRoomUpsert('4-23A---321', 6);
      assert.strictEqual(roomUp.ok, true);
      const rpost = C.reqLog().filter(function (o) { return o.method === 'POST' && String(o.url).indexOf('/water_room?') >= 0; })[0];
      assert.ok(/on_conflict=roomverify/.test(rpost.url), 'water_room on_conflict=roomverify');
      assert.deepStrictEqual(rpost.data, { roomverify: '4-23A---321', persons: 6 }, '23A 可写 6 人');
      // 失败返回 ok:false（页面进离线队列），不 throw
      C.setReq(function (o) { o.success({ statusCode: 500, data: {} }); });
      const fail = await cloud.waterUpsert('1-13---324', '2026-12', 130, 4);
      assert.strictEqual(fail.ok, false, 'HTTP 失败 → ok:false（不抛异常）');
    });

    await test('C5 水量页：云端共享接线 / 23A 1–6 自选 / 离线 pending 重试 / 文案无「免费」', async function () {
      purge();
      C.clearMem(); C.setIdentity();
      const store = R('utils/store.js');
      store.get().power = { sel: '4-23A---321', at: Date.now(), low: 30 };
      store.get().water = { rooms: { '4-23A---321': { p: 4, recs: [{ m: '2026-10', r: 100, ts: 1 }, { m: '2026-11', r: 110, ts: 2 }] } } };
      store.save();
      const cloud = R('utils/cloud.js'); enableCloud(cloud);
      const rv = '4-23A---321', sid = R('utils/identity.js').sid();
      const monthly = [{ roomverify: rv, month: '2026-10', reading: 101, persons: 4 },
        { roomverify: rv, month: '2026-11', reading: 111, persons: 4 }];
      let people = 4;
      function online(o) {
        const url = String(o.url);
        if (url.includes('/water_room?')) {
          if (o.method === 'POST') people = o.data.persons;
          return o.success({ statusCode: 200, data: [{ roomverify: rv, persons: people }] });
        }
        if (url.includes('/water?')) {
          if (o.method === 'POST') monthly.push(o.data);
          return o.success({ statusCode: 200, header: { 'Content-Range': '0-' + (monthly.length - 1) + '/' + monthly.length }, data: monthly.slice() });
        }
        return o.success({ statusCode: 200, data: [] });
      }
      C.setReq(online);
      const ctx = ctxOf(loadPage('water/water'));
      ctx.onLoad();
      await ctx._cloudSync(true);
      assert.strictEqual(ctx.data.persons, 4);
      assert.strictEqual(ctx.data.personsLocked, false);
      await ctx.pickPersons({ currentTarget: { dataset: { p: 6 } } });
      assert.strictEqual(ctx.data.persons, 6);
      assert.strictEqual(ctx._room().recs[1].r, 111);
      assert.strictEqual(store.get().water.rooms[rv].recs[1].r, 110, '私人历史保持原值');
      C.setReq(o => o.success({ statusCode: 403, data: {} }));
      // Turn off networking for a proven local create. Restore a fresh read before replay.
      cloud.configure({ enabled: false });
      ctx.setData({ month: '2026-12' });
      ctx.onReadingInput({ detail: { value: '130' } });
      await ctx.saveRecord();
      const shared = R('utils/water-shared.js');
      assert.strictEqual(shared.read(sid, rv).ops[0].field, '2026-12');
      C.setReq(online);enableCloud(cloud);
      assert.strictEqual(await ctx._flushPending(), true);
      assert.strictEqual(shared.read(sid, rv).ops.length, 0);
      const wxml = src('pages/water/water.wxml');
      const pageJs = src('pages/water/water.js');
      const waterJs = src('utils/water.js');
      const stripJs = function (t) { return t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''); };
      assert.ok(!/每月免费/.test(wxml + stripJs(pageJs)), '页面不得再出现「每月免费 N 吨水」');
      assert.ok(!/免费/.test(wxml), 'wxml 不再出现「免费」字样（契约 §5）');
      assert.ok(/每月定额/.test(wxml), '改为「每月定额」文案');
      assert.ok(/personsLocked/.test(wxml) && /固定/.test(wxml), '固定 4 人间 UI');
      assert.ok(/syncText/.test(wxml), '云端共享状态 UI');
      assert.ok(!/cloud\.waterList/.test(wxml), 'WXML 不直接调用云函数');
      assert.ok(/shared\.queue/.test(pageJs), '页面保存有归属的写入意图');
      assert.ok(!/wx\.request/.test(pageJs), '页面不直接 wx.request（统一 utils/cloud.js）');
      assert.ok(!/免费/.test(waterJs) || /不再出现「免费」/.test(waterJs), 'utils/water.js 文案不再用「免费」');
    });

    /* ============================================================
       D. 第 8 条 名单快捷预设
       ============================================================ */
    await test('D1 roster 预设集合：全班 / 班委（role|badge）/ 团员（class_league ∩ 班级名单）', function () {
      purge();
      C.clearMem();
      const store = R('utils/store.js');
      store.get().classMembers = [
        { seat: 1, sid: 's1', name: '张三', role: '班长', badge: '班委', is_admin: false },
        { seat: 2, sid: 's2', name: '李四', role: '', badge: '', is_admin: false },
        { seat: 3, sid: 's3', name: '王五', role: '学习委员', badge: '班委', is_admin: false }
      ];
      store.get().classLeague = [{ seat: 2, name: '李四' }, { seat: 3, name: '王五' }, { seat: 99, name: '不在名单' }];
      const roster = R('utils/roster.js');
      assert.deepStrictEqual(roster.quickSeats('all'), [1, 2, 3], '全班 = 全部座号');
      assert.deepStrictEqual(roster.committeeSeats(), [1, 3], '班委 = role/badge 非空');
      assert.deepStrictEqual(roster.leagueSeats(), [2, 3], '团员 = class_league 缓存 ∩ 班级名单');
      assert.deepStrictEqual(roster.quickSeats('league'), [2, 3]);
      assert.deepStrictEqual(roster.quickSeats('unknown'), []);
      assert.deepStrictEqual(roster.QUICK_KINDS, ['all', 'committee', 'league']);
      assert.strictEqual(roster.QUICK_LABELS.all, '全班');
    });

    await test('D2 cloud.leaguePull：POST rpc/class_league，归一 {seat,name}，6h 缓存命中 0 请求，失败保留缓存', async function () {
      purge();
      C.clearMem(); C.setIdentity();
      const cloud = R('utils/cloud.js'); enableCloud(cloud);
      C.setReq(function (o) {
        if (String(o.url).indexOf('/rpc/class_league') >= 0) {
          return o.success({ statusCode: 200, data: { ok: true, seats: [{ seat: 3, name: '王五', sid: 'should-drop' }, { seat: 1, name: '张三' }] } });
        }
        o.success({ statusCode: 200, data: [] });
      });
      const list = await cloud.leaguePull(true);
      assert.deepStrictEqual(list, [{ seat: 1, name: '张三' }, { seat: 3, name: '王五' }], '归一（按座号升序、剥离 sid）');
      assert.strictEqual(C.reqUrls('/rpc/class_league').length, 1);
      assert.strictEqual(C.reqUrls('/rpc/class_league')[0].method, 'POST', '唯一通道是既有 PostgREST RPC');
      const store = R('utils/store.js');
      assert.strictEqual(store.get().classLeague.length, 2, '写入本机缓存 store.classLeague');
      assert.ok(store.get().classLeagueAt > 0);
      const again = await cloud.leaguePull(false);
      assert.strictEqual(again.length, 2);
      assert.strictEqual(C.reqUrls('/rpc/class_league').length, 1, '6h TTL 内 0 请求');
      C.setReq(function (o) { o.success({ statusCode: 500, data: {} }); });
      const fail = await cloud.leaguePull(true);
      assert.strictEqual(fail.length, 2, '失败返回本机缓存（离线可用）');
      assert.ok(!/console\.log/.test(src('utils/cloud.js')), 'cloud.js 不打印任何内容（含 token）');
    });

    await test('D3 roster-picker 组件：全班/班委/团员/清空快捷预设，之后仍可逐个增删（座号数组不变）', function () {
      purge();
      C.clearMem();
      const store = R('utils/store.js');
      store.get().classMembers = [
        { seat: 1, sid: 's1', name: '张三', role: '班长', badge: '班委' },
        { seat: 2, sid: 's2', name: '李四', role: '', badge: '' },
        { seat: 3, sid: 's3', name: '王五', role: '学习委员', badge: '班委' }
      ];
      store.get().classLeague = [{ seat: 2, name: '李四' }];
      store.save();
      const comp = loadComponent('roster-picker/index');
      ['quickAll', 'quickCommittee', 'quickLeague', 'quickNone', 'toggleSeat', 'applySeats'].forEach(function (k) {
        assert.strictEqual(typeof comp.methods[k], 'function', '组件缺 ' + k);
      });
      const wxml = src('components/roster-picker/index.wxml');
      ['quickAll', 'quickCommittee', 'quickLeague', 'quickNone'].forEach(function (k) {
        assert.ok(wxml.indexOf(k) >= 0, 'WXML 缺快捷预设 ' + k);
      });
      ['全班', '班委', '团员', '清空'].forEach(function (t) {
        assert.ok(wxml.indexOf(t) >= 0, 'WXML 缺预设文案 ' + t);
      });
      const ctx = compCtx(comp);
      ctx.build(store.get().classMembers);
      ctx.methods.quickAll.call(ctx);
      assert.strictEqual(ctx.data.count, 3, '全班 = 3 人');
      assert.strictEqual(ctx.data.quick, 'all');
      ctx.methods.quickCommittee.call(ctx);
      assert.strictEqual(ctx.data.count, 2, '班委 = 2 人');
      assert.strictEqual(ctx.data.quick, 'committee');
      ctx.setScope({ detail: { value: 'committee' } });
      ctx.setQuery({ detail: { value: '学习' } });
      assert.deepStrictEqual(ctx.data.items.map(m => m.seat), [3]);
      assert.strictEqual(ctx.data.count, 2, '搜索只改变可见候选');
      ctx.setQuery({ detail: { value: 'Night Owl', seats: [2, 3] } });
      assert.deepStrictEqual(ctx.data.items.map(m => m.seat), [3], '服务端匹配仍须满足班委筛选');
      ctx.setQuery({ detail: { value: 'Night Ow' } });
      assert.strictEqual(ctx.data.items.length, 0);
      ctx.setQuery({ detail: { value: '' } });
      ctx.setScope({ detail: { value: 'all' } });
      ctx.methods.quickLeague.call(ctx);
      assert.strictEqual(ctx.data.count, 1, '团员 = 1 人（缓存 class_league）');
      assert.strictEqual(ctx.data.quick, 'league');
      // 之后仍可逐个增删：手动 toggle 会清掉预设高亮
      ctx.methods.toggleSeat.call(ctx, { currentTarget: { dataset: { seat: 1 } } });
      assert.strictEqual(ctx.data.count, 2, '预设基础集合后可再点选增加');
      assert.strictEqual(ctx.data.quick, '', '手动增删后不再高亮预设');
      ctx.methods.quickNone.call(ctx);
      assert.strictEqual(ctx.data.count, 0);
      // confirm 返回座号数组（数据格式不变）
      let detail = null;
      ctx.triggerEvent = function (name, d) { if (name === 'confirm') detail = d; };
      ctx.data.selMap = { 1: true, 3: true };
      ctx.methods.confirm.call(ctx);
      assert.deepStrictEqual(detail, { seats: [1, 3] }, 'confirm detail = { seats:[座号升序] }');
    });

    /* ============================================================
       E. 第 2 条 徽章去重
       ============================================================ */
    await test('E1 util.showBadge：职务文字已展示时不重复「班委」徽章', function () {
      purge();
      const util = R('utils/util.js');
      assert.strictEqual(util.showBadge('班委', '班长'), '', 'role=班长 + badge=班委 → 不显示 badge');
      assert.strictEqual(util.showBadge('班委', '学习委员'), '', '任何职务都不重复班委气泡');
      assert.strictEqual(util.showBadge('班委', ''), '班委', '无职务时保留徽章');
      assert.strictEqual(util.showBadge('', '班长'), '', '无徽章 → 空');
      assert.strictEqual(util.showBadge('管理员', '班长'), '管理员', '非同义徽章（管理员）保留');
      assert.strictEqual(util.showBadge('班长', '班长'), '', 'badge===role 去重');
    });

    await test('E2 班委页渲染：role 保留职务 pill，重复「班委」badge 不再输出；工具描述同步', function () {
      purge();
      C.clearMem(); C.setIdentity();
      const store = R('utils/store.js');
      store.get().classMembers = [
        { seat: 1, sid: 's1', name: '张三', role: '班长', badge: '班委', is_admin: false },
        { seat: 2, sid: 's2', name: '李四', role: '团支部书记', badge: '班委', is_admin: false },
        { seat: 3, sid: 's3', name: '王五', role: '学习委员', badge: '班委', is_admin: false }
      ];
      const cloud = R('utils/cloud.js'); enableCloud(cloud);
      const def = loadPage('committee/committee');
      const ctx = ctxOf(def);
      ctx.render();
      const list = ctx.data.list;
      assert.strictEqual(list.length, 3);
      assert.strictEqual(list.find(function (x) { return x.seat === 1; }).role, '班长', '保留职务文字');
      assert.strictEqual(list.find(function (x) { return x.seat === 1; }).badge, '', '班委 badge 与职务重复 → 不输出');
      assert.strictEqual(list.find(function (x) { return x.seat === 2; }).role, '团支部书记', '所有职务文字都保留');
      assert.strictEqual(list.find(function (x) { return x.seat === 2; }).badge, '', '有职务时班委 badge 全部去重');
      const utilB = R('utils/util.js');
      assert.strictEqual(utilB.showBadge('班委', ''), '班委', '无职务成员（如仅班委身份）单独场景保留徽章');
      const wxml = src('pages/committee/committee.wxml');
      assert.ok(/item\.role/.test(wxml), 'WXML 渲染职务 pill');
      assert.ok(/item\.badge !== item\.role/.test(wxml), 'WXML 保留去重条件（badge 已在 JS 层过滤）');
      assert.ok(!/身份徽章/.test(wxml), '班委页副标题不再重复「身份徽章」表述');
      const tools = src('utils/tools.js');
      const bz = tools.split('\n').find(function (l) { return l.indexOf("key: 'bz'") >= 0; }) || '';
      assert.ok(/职务/.test(bz) && !/徽章/.test(bz), '班委工具描述改为职务/名单（不再强调徽章）：' + bz.slice(0, 160));
      const me = src('pages/me/me.js');
      const data = src('pages/data/data.js');
      assert.ok(/showBadge\(id\.badge, id\.role\)/.test(me), '我的页身份徽章同样去重');
      assert.ok(/showBadge\(id\.badge, id\.role\)/.test(data), '数据与隐私页身份徽章同样去重');
    });

    /* ---------------- 收尾 ---------------- */
  })().finally(function () {
    global.wx = prevWx;
    global.getCurrentPages = prevGetCurrentPages;
    global.getApp = prevGetApp;
    purge();
  });
}

module.exports = { run: run };

/* 独立运行：node task7_unit_tests.js */
if (require.main === module) {
  let passN = 0, failN = 0;
  const results = [];
  const test = async function (name, fn) {
    try { await fn(); passN++; results.push({ name: name, ok: true }); console.log('PASS  ' + name); }
    catch (e) {
      failN++; results.push({ name: name, ok: false, err: String((e && e.message) || e) });
      console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e));
    }
  };
  run(test).then(function () {
    const summary = { total: passN + failN, pass: passN, fail: failN, results: results, at: new Date().toISOString() };
    fs.writeFileSync(path.join(__dirname, 'task7_unit_result.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log('\n================ task7 unit: ' + passN + ' passed, ' + failN + ' failed ================');
    process.exitCode = failN ? 2 : 0;
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}
