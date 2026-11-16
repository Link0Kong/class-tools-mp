/* _qa_v2/mp_v2_check.js —— 小程序 v2.0.0 独立验收（Node + wx mock，不启动模拟器、不发真实请求）
 *
 * 运行：node mp_v2_check.js [--tag baseline|final]
 * 输出：PASS/FAIL 行 + _reports/mp_v2_<tag>.json，退出码 0 = 全绿。
 *
 * 覆盖需求：1 版本 / 2 滚动保位 / 3 第9周课表滑动 / 9 长期安排 / 10 演示模式 /
 *          11 工作台轮换 / 12 管理员编辑删除 / 13 动画降级 / 14 体测同步 / 16 marks 同步。
 * 说明：断言以「行为/契约」为主；纯样式在 static_scan.py 与 wxss 静态断言里覆盖。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = 'C:/Users/Ko_Li/.openclaw/workspace/mp-class-tools';
const HERE = __dirname;
const REPORTS = path.join(HERE, '_reports');
const TAG = (function () {
  const i = process.argv.indexOf('--tag');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'run';
})();

const results = [];
let passN = 0, failN = 0, pendN = 0;
async function test(req, name, fn) {
  try {
    await fn();
    passN++; results.push({ req: String(req), name, ok: true, note: '' });
    console.log('PASS  [' + req + '] ' + name);
  } catch (e) {
    failN++; results.push({ req: String(req), name, ok: false, err: String((e && e.message) || e) });
    console.log('FAIL  [' + req + '] ' + name + '  ::  ' + ((e && e.message) || e));
  }
}
function pend(req, name, note) {
  pendN++; results.push({ req: String(req), name, ok: null, note: String(note || '') });
  console.log('PEND  [' + req + '] ' + name + (note ? '  --  ' + note : ''));
}

/* ---------------- wx mock ---------------- */
const mem = Object.create(null);
let reqLog = [], pageScrollToLog = [], toastLog = [], navLog = [];
function resetLogs() { reqLog = []; pageScrollToLog = []; toastLog = []; navLog = []; }
function okResp(data) { return (o) => o.success({ statusCode: 200, data: data === undefined ? [] : data }); }
let reqImpl = okResp([]);
global.wx = {
  getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
  setStorageSync(k, v) { mem[k] = v; },
  removeStorageSync(k) { delete mem[k]; },
  getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 1, limitSize: 10240 }; },
  request(o) { reqLog.push(o); reqImpl(o); },
  pageScrollTo(o) { pageScrollToLog.push(o); if (o && o.success) o.success(); },
  showToast(o) { toastLog.push(o && o.title); },
  showModal(o) { if (o && o.success) o.success({ confirm: true, cancel: false }); },
  showLoading() {}, hideLoading() {},
  setClipboardData(o) { if (o && o.success) o.success(); },
  getClipboardData(o) { if (o && o.success) o.success({ data: '' }); },
  canvasToTempFilePath(o) { if (o && o.success) o.success({ tempFilePath: '/tmp/t.png' }); },
  saveImageToPhotosAlbum(o) { if (o && o.success) o.success(); },
  getSetting(o) { if (o && o.success) o.success({ authSetting: {} }); },
  openSetting(o) { if (o && o.success) o.success({ authSetting: {} }); },
  createSelectorQuery() {
    return { in() { return this; }, select() { return this; }, fields() { return this; },
      exec(cb) { cb([{ node: { width: 760, height: 600, getContext() { return {}; } }, width: 760, height: 600 }]); } };
  },
  navigateTo(o) { navLog.push({ type: 'navigateTo', url: o && o.url }); if (o && o.success) o.success(); },
  redirectTo(o) { navLog.push({ type: 'redirectTo', url: o && o.url }); },
  switchTab(o) { navLog.push({ type: 'switchTab', url: o && o.url }); if (o && o.success) o.success(); },
  reLaunch(o) { navLog.push({ type: 'reLaunch', url: o && o.url }); if (o && o.success) o.success(); },
  showActionSheet(o) { if (o && o.success) o.success({ tapIndex: 0 }); },
  getWindowInfo() { return { windowWidth: 375, windowHeight: 812, pixelRatio: 2, SDKVersion: '3.0.0' }; },
  getAppBaseInfo() { return { SDKVersion: '3.0.0' }; },
  getSystemInfoSync() { return { windowWidth: 375, windowHeight: 812, pixelRatio: 2, SDKVersion: '3.0.0', platform: 'devtools' }; },
  getDeviceInfo() { return { platform: 'devtools' }; },
  onThemeChange() {}, showShareMenu() {},
  onAgentHandoff() {}, offAgentHandoff() {},
  stopPullDownRefresh() {}, startPullDownRefresh() {},
  createAnimation() { const a = { translate() { return a; }, opacity() { return a; }, scale() { return a; },
    step() { return a; }, export() { return {}; } }; return a; },
  openDocument(o) { if (o && o.success) o.success(); },
  downloadFile(o) { if (o && o.fail) o.fail({ errMsg: 'qa-block' }); },
  nextTick(fn) { setTimeout(fn, 0); },
  getNetworkType(o) { if (o && o.success) o.success({ networkType: 'wifi' }); },
  onNetworkStatusChange() {}
};
global.getApp = function () { return { globalData: {} }; };
global.getCurrentPages = function () { return []; };
global.Component = function () {};

function purge() {
  Object.keys(require.cache).forEach((k) => {
    if (k.replace(/\\/g, '/').indexOf(ROOT) === 0) {
      try {
        const m = require.cache[k];
        if (m && m.exports && typeof m.exports.udStop === 'function') m.exports.udStop();
      } catch (e) { /* ignore */ }
      delete require.cache[k];
    }
  });
}
function load(rel) { return require(path.join(ROOT, rel)); }
function fresh() {
  purge(); resetLogs();
  return {
    store: load('utils/store.js'),
    cloud: load('utils/cloud.js'),
    util: load('utils/util.js'),
    notice: load('utils/notice.js'),
    identity: load('utils/identity.js'),
    scrollmem: load('utils/scrollmem.js')
  };
}
const ID_ADMIN = { token: 'tok-qa-admin', sid: '9000000002', name: '测试管理员', role: '班长', badge: '班委', is_admin: true, ts: 1 };
const ID_USER = { token: 'tok-qa-user', sid: '9000000001', name: '测试同学01', role: '', badge: '', is_admin: false, ts: 1 };
function setIdentity(id) { mem['zq_class_identity'] = JSON.stringify(id || ID_ADMIN); }
function clearMem() { Object.keys(mem).forEach((k) => delete mem[k]); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function readSrc(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/* ---------------- Page 定义加载 ---------------- */
function loadPageDef(rel) {
  let def = null;
  global.Page = (d) => { def = d; };
  try { delete require.cache[require.resolve(path.join(ROOT, rel))]; require(path.join(ROOT, rel)); }
  finally { delete global.Page; }
  assert.ok(def, 'page 未注册 Page(): ' + rel);
  return def;
}
function mkCtx(def, data) {
  const ctx = Object.assign({}, def);
  ctx.data = Object.assign(JSON.parse(JSON.stringify(def.data || {})), data || {});
  ctx.log = [];
  ctx.setData = function (o, cb) {
    ctx.log.push(JSON.parse(JSON.stringify(o)));
    Object.keys(o).forEach((k) => {
      if (k.indexOf('.') >= 0) {
        const parts = k.split('.');
        let cur = ctx.data;
        for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = cur[parts[i]] || {}; cur = cur[parts[i]]; }
        cur[parts[parts.length - 1]] = o[k];
      } else {
        ctx.data[k] = o[k];
      }
    });
    if (cb) cb();
  };
  return ctx;
}

/* ---------------- 课表 ctx（复用 unit.js 7b 段思路） ---------------- */
function ttCtx(week, extraCourses) {
  const def = loadPageDef('pages/tt/tt.js');
  const ctx = mkCtx(def);
  ctx._courses = [
    { name: '高数', day: 0, start: 1, end: 2, weeks: '1-18', room: 'A101', teacher: '张' },
    { name: '英语', day: 2, start: 3, end: 4, weeks: '1-18', room: 'B202', teacher: '李' }
  ].concat(extraCourses || []);
  ctx._term = '2026-08-31';
  ctx._meta = null;
  ctx._shared = null;
  ctx._remoteOk = false;
  ctx._wk = week;
  ctx._day = null;
  ctx._dayUser = false;
  ctx._gridOverflow = false;
  ctx._gridX = 0;
  ctx._gridMaxX = 0;
  ctx._gridSeenMax = 0;
  ctx._sw = null;
  ctx._swAnim = false;
  ctx._swTimers = [];
  ctx._swSeq = 0;
  ctx._supTap = 0;
  ctx.data.view = 'week';
  ctx.refresh();
  return ctx;
}
function swipe(ctx, dx, dy) {
  const y = 300;
  ctx.onSwipeStart({ touches: [{ clientX: 200, clientY: y }] });
  ctx.onSwipeMove({ touches: [{ clientX: 200 + dx, clientY: y + (dy || 0) }] });
  ctx.onSwipeEnd({ changedTouches: [{ clientX: 200 + dx, clientY: y + (dy || 0) }] });
}

/* ============================================================ 主流程 */
(async function main() {
  /* ---------- 需求 1：版本 2.0.0 ---------- */
  await test(1, 'utils/version.js VERSION = 2.0.0', () => {
    const v = load('utils/version.js');
    assert.strictEqual(v.VERSION, '2.0.0');
    assert.ok(/2\.0\.0/.test(v.text()), v.text());
  });
  await test(1, 'app.js globalData.version 引用 version.VERSION', () => {
    const s = readSrc('app.js');
    assert.ok(/globalData\s*:\s*\{[\s\S]*?version\s*:\s*version\.VERSION/.test(s), 'globalData.version 未引用 version.VERSION');
  });
  await test(1, '「我的」页展示版本号', () => {
    const wxml = readSrc('pages/me/me.wxml');
    const js = readSrc('pages/me/me.js');
    assert.ok((wxml.indexOf('version') >= 0) || (js.indexOf('version.text') >= 0), 'me 页未引用版本号');
  });
  await test(1, 'README / CHANGELOG 顶部标注 2.0.0', () => {
    assert.ok(readSrc('README.md').slice(0, 1500).indexOf('2.0.0') >= 0, 'README 顶部无 2.0.0');
    assert.ok(readSrc('CHANGELOG.md').slice(0, 4000).indexOf('2.0.0') >= 0, 'CHANGELOG 顶部无 2.0.0');
  });

  /* ---------- 需求 2：滚动保位 scrollmem ---------- */
  await test(2, 'scrollmem 导出完整 API', () => {
    const sm = load('utils/scrollmem.js');
    ['attach', 'onScroll', 'save', 'restore', 'cancel', 'svSave', 'svGet', 'resetAll'].forEach((k) => {
      assert.strictEqual(typeof sm[k], 'function', '缺少 scrollmem.' + k);
    });
  });
  await test(2, '页面实例重建后恢复滚动位置（wx.pageScrollTo 被调用）', async () => {
    const sm = load('utils/scrollmem.js');
    sm.resetAll();
    const p1 = { route: 'pages/nt/nt', data: {} };
    sm.attach(p1);
    sm.onScroll(p1, { scrollTop: 480 });
    sm.save(p1);
    const p2 = { route: 'pages/nt/nt', data: {} };
    sm.attach(p2);
    pageScrollToLog = [];
    assert.strictEqual(sm.restore(p2), true, 'restore 未触发（保存值丢失？）');
    await sleep(80);
    assert.ok(pageScrollToLog.length >= 1, '未调用 wx.pageScrollTo');
    assert.strictEqual(pageScrollToLog[0].scrollTop, 480);
    assert.strictEqual(pageScrollToLog[0].duration, 0, '恢复应为 duration:0（不播放滚动动画）');
  });
  await test(2, '恢复等待期间用户自己滚动 → 取消恢复（不与用户打架）', async () => {
    const sm = load('utils/scrollmem.js');
    sm.resetAll();
    const p1 = { route: 'pages/hw/hw', data: {} };
    sm.attach(p1); sm.onScroll(p1, { scrollTop: 300 }); sm.save(p1);
    const p2 = { route: 'pages/hw/hw', data: { state: 'loading' } };   // loading 态 → 恢复会等待
    sm.attach(p2);
    pageScrollToLog = [];
    sm.restore(p2, { gap: 30, timeout: 400 });
    sm.onScroll(p2, { scrollTop: 50 });        // 用户自己滚动
    await sleep(160);
    assert.strictEqual(pageScrollToLog.length, 0, '用户滚动后仍强制恢复');
  });
  await test(2, '同一页面实例后续 onShow 不重复恢复', async () => {
    const sm = load('utils/scrollmem.js');
    sm.resetAll();
    const p1 = { route: 'pages/all/all', data: {} };
    sm.attach(p1); sm.onScroll(p1, { scrollTop: 200 }); sm.save(p1);
    const p2 = { route: 'pages/all/all', data: {} };
    sm.attach(p2);
    pageScrollToLog = [];
    sm.restore(p2);
    await sleep(60);
    const n1 = pageScrollToLog.length;
    sm.restore(p2);                             // 第二次 onShow
    await sleep(60);
    assert.strictEqual(pageScrollToLog.length, n1, '重复 onShow 重复恢复');
  });

  /* ---------- 需求 3：第 9 周（6 天溢出）课表滑动 ---------- */
  await test(3, '第 9 周周六有课 → days=6 → _gridOverflow=true 且 _gridMaxX>0', () => {
    const ctx = ttCtx(9, [{ name: '体育', day: 5, start: 1, end: 2, weeks: '9', room: '操场' }]);
    assert.strictEqual(ctx.data.wk, 9);
    assert.strictEqual(ctx._gridOverflow, true, '溢出判定未生效');
    assert.ok(ctx._gridMaxX > 0, '_gridMaxX=' + ctx._gridMaxX);
    assert.strictEqual(ctx.data.colW, 106, '6 天应固定 106rpx 列宽');
  });
  await test(3, '溢出周：表格在左边缘时右滑 → 切上一周（不再整周禁用）', async () => {
    const ctx = ttCtx(9, [{ name: '体育', day: 5, start: 1, end: 2, weeks: '9' }]);
    ctx._gridX = 0;                               // 表格在最左
    assert.strictEqual(ctx._gridAtEdge(0, -1), true, '左边缘应允许右滑切上一周');
    swipe(ctx, 120);                              // 右滑
    await sleep(220);
    assert.strictEqual(ctx._swAnim, true, '未进入飞出动画（手势被丢弃）');
    await sleep(500);
    assert.strictEqual(ctx.data.wk, 8, '右滑未切到第 8 周（wk=' + ctx.data.wk + '）');
  });
  await test(3, '溢出周：表格在左边缘时左滑 → 让表格横向滚动（不切周、不抑制点击）', () => {
    const ctx = ttCtx(9, [{ name: '体育', day: 5, start: 1, end: 2, weeks: '9' }]);
    ctx._gridX = 0;
    assert.strictEqual(ctx._gridAtEdge(0, 1), false, '左边缘左滑不应判定为边缘');
    const wk0 = ctx.data.wk;
    swipe(ctx, -120);
    assert.strictEqual(ctx.data.wk, wk0, '左边缘左滑不应切周');
    assert.strictEqual(ctx._supTap, 0, '让表格滚动的手势不应抑制点击');
    assert.ok(!ctx.log.some((o) => o.swipeStyle), '让表格滚动的手势不应产生跟手位移');
  });
  await test(3, '溢出周：表格已到右边缘时左滑 → 切下一周', async () => {
    const ctx = ttCtx(9, [{ name: '体育', day: 5, start: 1, end: 2, weeks: '9' }]);
    ctx._gridX = ctx._gridMaxX;                   // 表格滑到最右
    assert.strictEqual(ctx._gridAtEdge(ctx._gridMaxX, 1), true);
    swipe(ctx, -120);
    await sleep(220);
    assert.strictEqual(ctx._swAnim, true, '未进入飞出动画（手势被丢弃）');
    await sleep(500);
    assert.strictEqual(ctx.data.wk, 10, '左滑未切到第 10 周（wk=' + ctx.data.wk + '）');
  });
  await test(3, '回归：5 天不溢出的周左滑照常切下一周', async () => {
    const ctx = ttCtx(5);
    assert.strictEqual(ctx._gridOverflow, false, '5 天不应溢出');
    swipe(ctx, -120);
    await sleep(700);
    assert.strictEqual(ctx.data.wk, 6, '5 天周左滑未切周');
  });
  await test(3, '回归：日视图滑动切周（非溢出）', async () => {
    const ctx = ttCtx(5);
    ctx.data.view = 'day';
    swipe(ctx, -120);
    await sleep(700);
    assert.strictEqual(ctx.data.wk, 6, '日视图左滑未切周');
  });
  await test(3, '回归：第 1 周右滑只回弹不切周', async () => {
    const ctx = ttCtx(1);
    swipe(ctx, 120);
    await sleep(300);
    assert.strictEqual(ctx.data.wk, 1, '第 1 周右滑不应切周');
    assert.strictEqual(ctx._swAnim, false, '不应进入飞出动画');
  });

  /* ---------- 需求 9：长期安排 recurrence ---------- */
  await test(9, 'recurrence 长期安排：nextTextOf 输出下次时间（含周X/时间）', () => {
    const n = load('utils/notice.js');
    const g = { title: '宿舍卫生检查安排', actionable: false,
      recurrence: { freq: 'monthly_weeks', weekday: 3, weeks: [1, 2, 3], time: '17:30',
        startAt: '2026-11-04T17:30:00+08:00', label: '每月前三周 周三 17:30' } };
    const lbl = n.recurLabelOf(g);
    assert.ok(/每月前三周/.test(lbl), 'label 异常: ' + lbl);
    const nx = n.nextOf(g, Date.now());
    assert.ok(nx && nx > Date.now(), 'nextOf 未给出未来时间: ' + nx);
    const txt = n.nextTextOf(g, Date.now());
    assert.ok(txt && txt.length > 0, 'nextTextOf 为空');
    assert.ok(/17:30/.test(txt) || /周三/.test(txt), 'nextTextOf 内容异常: ' + txt);
  });
  await test(9, '长期安排不按 deadline 判过期、不计入待处理', () => {
    const n = load('utils/notice.js');
    const g = { id: 'g_dorm', title: '宿舍卫生检查安排', actionable: false,
      deadline: '2020-01-01T00:00:00+08:00',
      recurrence: { freq: 'monthly_weeks', weekday: 3, weeks: [1, 2, 3], time: '17:30' } };
    assert.strictEqual(n.isExpired(g), false, '长期安排被判过期');
    assert.strictEqual(n.isActionable({ actionable: false }), false);
    assert.strictEqual(n.isActionable({}), true);
  });
  await test(9, '通知页渲染长期安排徽标 + 下次时间（nt.wxml / nt.js）', () => {
    const wxml = readSrc('pages/nt/nt.wxml');
    const js = readSrc('pages/nt/nt.js');
    assert.ok(/长期安排/.test(wxml) || /长期安排/.test(js), '缺少长期安排徽标');
    assert.ok(/nextText/.test(wxml) || /nextText/.test(js), '缺少下次时间展示');
  });

  /* ---------- 需求 10（用户 2026-11-05 20:07 新指示）：移除全部「演示/审核模式」→ 断言不存在 ---------- */
  await test(10, '审核/演示模式源码已移除（utils/demo.js、utils/demo-data.js 不存在）', () => {
    const fsx = fs;
    assert.ok(!fsx.existsSync(path.join(ROOT, 'utils/demo.js')), 'utils/demo.js 仍存在');
    assert.ok(!fsx.existsSync(path.join(ROOT, 'utils/demo-data.js')), 'utils/demo-data.js 仍存在');
  });
  await test(10, '身份页无「演示模式（审核用）」入口/文案/处理函数', () => {
    const ident = readSrc('pages/identity/identity.wxml') + '\n' + readSrc('pages/identity/identity.js');
    ['演示模式', '审核用', 'enterDemo', '演示入口'].forEach((k) => {
      assert.ok(ident.indexOf(k) < 0, '身份页仍含: ' + k);
    });
  });
  await test(10, '网络层无 demo 拦截/演示桶：cloud.js / store.js / notify.js', () => {
    const cloud = readSrc('utils/cloud.js');
    const store = readSrc('utils/store.js');
    const notify = readSrc('utils/notify.js');
    ['demo.isActive', 'demo.request', 'demoFetch', "require('./demo.js')", 'demo-data'].forEach((k) => {
      assert.ok(cloud.indexOf(k) < 0, 'cloud.js 仍含: ' + k);
    });
    assert.ok(store.indexOf('DEMO_KEY') < 0, 'store.js 仍含 DEMO_KEY 演示桶');
    assert.ok(notify.indexOf('demo') < 0, 'notify.js 仍含 demo');
  });
  await test(10, '「我的」页无演示模式文案/退出入口；README/CHANGELOG 已清理并声明不实现审核模式', () => {
    const me = readSrc('pages/me/me.wxml') + '\n' + readSrc('pages/me/me.js');
    assert.ok(me.indexOf('演示') < 0, '「我的」页仍含「演示」');
    assert.ok(me.indexOf('审核') < 0, '「我的」页仍含「审核」');
    const readme = readSrc('README.md');
    const change = readSrc('CHANGELOG.md');
    assert.ok(readme.indexOf('不实现') >= 0 && readme.indexOf('审核模式') >= 0, 'README 未声明不实现审核模式');
    assert.ok(change.indexOf('移除') >= 0 && change.indexOf('审核') >= 0, 'CHANGELOG 未写明移除审核模式');
  });
  await test(10, '源码与文档无演示数据残留（演示同学 / demo sid / demo-data）', () => {
    const hits = [];
    const walk = (dir) => {
      fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (['node_modules', '.git', 'images', 'cloudfunctions', '_backup'].indexOf(e.name) >= 0) return;
          walk(p);
        } else if (/\.(js|wxml|wxss|json)$/.test(e.name)) {
          const t = fs.readFileSync(p, 'utf8');
          ['演示同学', '演示模式', '审核用', 'demo-data'].forEach((k) => {
            if (t.indexOf(k) >= 0 && !/^\s*(\/\/|\*)/.test(k)) hits.push(path.relative(ROOT, p) + ':' + k);
          });
        }
      });
    };
    walk(ROOT);
    assert.deepStrictEqual(hits, [], '仍含演示/审核文案: ' + hits.slice(0, 8).join(','));
  });

  /* ---------- 需求 11：工作台轮换 ---------- */
  await test(11, '轮换参数：每 5s、动画 .26s/.32s、>1 条才轮换、页面隐藏/卸载停止', () => {
    const js = readSrc('pages/index/index.js');
    assert.ok(/ROT_MS\s*=\s*5000/.test(js), 'ROT_MS 非 5000');
    assert.ok(/ROT_OUT\s*=\s*260/.test(js) && /ROT_IN\s*=\s*320/.test(js), '动画时长非 260/320');
    assert.ok(/_restartRotate/.test(js) && /_rotStop/.test(js), '缺少轮换启动/停止');
    assert.ok(/Math\.max\(hwN, ntN\) <= 1/.test(js), '缺少 ≤1 条不轮换判断');
    assert.ok(/onHide\(\)[\s\S]{0,300}_rotStop/.test(js), 'onHide 未停止轮换');
  });
  await test(11, '轮换实际执行：5s 后卡片 idx 前进且 anim=out→in', async () => {
    clearMem(); purge();
    const def = loadPageDef('pages/index/index.js');
    const ctx = mkCtx(def);
    ctx._hidden = false;
    ctx.data.state = 'data';
    ctx.data.hw = { items: [{ title: 'A', sub: 'a' }, { title: 'B', sub: 'b' }], idx: 0, title: 'A', sub: 'a', anim: '' };
    ctx.data.nt = { items: [{ title: 'C', sub: 'c' }, { title: 'D', sub: 'd' }], idx: 0, title: 'C', sub: 'c', anim: '' };
    ctx._restartRotate();
    assert.ok(ctx._rot, '未启动轮换定时器');
    await sleep(6000);                          // 第一个 5s tick + .26s 换成 + .32s 淡入
    ctx._rotStop();
    assert.strictEqual(ctx.data.hw.idx, 1, '5s 后 hw 卡未轮换 idx=' + ctx.data.hw.idx);
    assert.strictEqual(ctx.data.nt.idx, 1, '5s 后 nt 卡未轮换 idx=' + ctx.data.nt.idx);
    const hasOut = ctx.log.some((o) => o['hw.anim'] === 'out');
    const hasIn = ctx.log.some((o) => o['hw.anim'] === 'in');
    assert.ok(hasOut && hasIn, '轮换缺少 out/in 动画帧');
  });
  await test(11, '≤1 条不轮换', () => {
    clearMem(); purge();
    const def = loadPageDef('pages/index/index.js');
    const ctx = mkCtx(def);
    ctx._hidden = false;
    ctx.data.state = 'data';
    ctx.data.hw = { items: [{ title: 'A' }], idx: 0, anim: '' };
    ctx.data.nt = { items: [], idx: 0, anim: '' };
    ctx._restartRotate();
    assert.ok(!ctx._rot, '≤1 条仍启动了轮换');
  });

  /* ---------- 需求 12：管理员编辑 / 删除 / 恢复 ---------- */
  await test(12, 'ntAdminRowId = auto_<gid>（与网页/云端契约一致）', () => {
    const cloud = load('utils/cloud.js');
    assert.strictEqual(cloud.ntAdminRowId('g_abc'), 'auto_g_abc');
  });
  await test(12, '管理员编辑：PATCH notices?id=eq.auto_<gid> + override_json/edited_at/edited_by', async () => {
    clearMem(); purge(); resetLogs();
    setIdentity(ID_ADMIN);
    const cloud = load('utils/cloud.js');
    cloud.configure({ enabled: true, restBase: 'https://mock.invalid/v1/rdb/rest/', publishableKey: 'pk' });
    reqImpl = okResp([]);
    const ok = await cloud.ntAdminEdit('g_qa010', { title: 'QA改标题', timeLabel: 'QA时间' });
    assert.strictEqual(ok, true, 'ntAdminEdit 未返回成功');
    assert.strictEqual(reqLog.length, 1, '请求数量异常: ' + reqLog.length);
    const r = reqLog[0];
    assert.strictEqual(String(r.method || 'GET').toUpperCase(), 'PATCH', 'method 非 PATCH: ' + r.method);
    assert.ok(/notices\?id=eq\.auto_g_qa010$/.test(String(r.url)), 'URL 异常: ' + r.url);
    const body = r.data || {};
    assert.ok(body.override_json, '缺少 override_json');
    const ov = JSON.parse(body.override_json);
    assert.strictEqual(ov.title, 'QA改标题');
    assert.ok(body.edited_at > 0, '缺少 edited_at');
    assert.strictEqual(body.edited_by, ID_ADMIN.sid, 'edited_by 非管理员学号');
    assert.ok(r.header && (r.header['X-Class-Token'] || r.header['x-class-token']), '缺少 X-Class-Token 头');
  });
  await test(12, '管理员删除/恢复：PATCH hidden=true/false', async () => {
    clearMem(); purge(); resetLogs();
    setIdentity(ID_ADMIN);
    const cloud = load('utils/cloud.js');
    cloud.configure({ enabled: true, restBase: 'https://mock.invalid/v1/rdb/rest/', publishableKey: 'pk' });
    reqImpl = okResp([]);
    assert.strictEqual(await cloud.ntAdminHide('g_qa011', true), true);
    assert.strictEqual(reqLog[0].data.hidden, true);
    assert.strictEqual(await cloud.ntAdminHide('g_qa011', false), true);
    assert.strictEqual(reqLog[1].data.hidden, false);
  });
  await test(12, '非管理员不能调用管理员写接口（本地拒绝，不请求云端）', async () => {
    clearMem(); purge(); resetLogs();
    setIdentity(ID_USER);
    const cloud = load('utils/cloud.js');
    cloud.configure({ enabled: true, restBase: 'https://mock.invalid/v1/rdb/rest/', publishableKey: 'pk' });
    reqImpl = okResp([]);
    const ok = await cloud.ntAdminHide('g_qa011', true);
    assert.strictEqual(ok, false, '非管理员调用未被拒绝');
    assert.strictEqual(reqLog.length, 0, '非管理员仍发出 PATCH 请求');
  });
  await test(12, 'override_json 白名单字段套用 / null 清空该字段', () => {
    const n = load('utils/notice.js');
    const g = { id: 'g1', title: '原题', cat: '教务', summary: '原摘要', deadline: '2026-11-09T18:00:00+08:00',
      _override: { title: '新题', summary: null, deadline: '2026-11-10T18:00:00+08:00', evil: 'x' } };
    const o = n.applyOverride(g);
    assert.strictEqual(o.title, '新题');
    assert.ok(!Object.prototype.hasOwnProperty.call(o, 'summary'), 'null 应清空该字段（plan §3 契约）');
    assert.strictEqual(o.deadline, '2026-11-10T18:00:00+08:00');
    assert.ok(!('evil' in o), '白名单外字段被写入');
  });
  await test(12, '通知页：解析 hidden/override + 编辑弹层 + 已隐藏筛选（仅管理员）', () => {
    const js = readSrc('pages/nt/nt.js');
    const wxml = readSrc('pages/nt/nt.wxml');
    assert.ok(/_hidden/.test(js), 'nt.js 未解析 hidden');
    assert.ok(/_override|applyOverride/.test(js), 'nt.js 未解析 override');
    assert.ok(/编辑/.test(wxml) && /删除/.test(wxml), 'nt.wxml 缺少编辑/删除入口');
    assert.ok(/恢复/.test(wxml), 'nt.wxml 缺少恢复入口');
    assert.ok(/hidden/.test(js) && /isAdmin/.test(js), '缺少已隐藏筛选的管理员限制');
    assert.ok(/编辑弹层|editSheet|editOpen|editSave/.test(js), '缺少编辑弹层逻辑');
  });

  /* ---------- 需求 14：体测 sex/grade 双向同步 ---------- */
  await test(14, 'udSections.fit 显式包含 sex/grade 与全部体测字段', () => {
    clearMem(); purge();
    setIdentity(ID_USER);
    const store = load('utils/store.js');
    const cloud = load('utils/cloud.js');
    const d = store.get();
    d.fit = Object.assign({}, d.fit, { sex: 'f', grade: '34', h: '170', w: '60' });
    store.save();
    const v = cloud.udSections();
    assert.ok(v.fit && typeof v.fit === 'object', 'fit section 缺失');
    assert.strictEqual(v.fit.sex, 'f');
    assert.strictEqual(v.fit.grade, '34');
    ['sex', 'grade', 'h', 'w', 'vc', 'r50', 'sit', 'jump', 'pull', 'durM', 'durS'].forEach((k) => {
      assert.ok(k in v.fit, 'fit.' + k + ' 缺失');
    });
  });
  await test(14, 'udPush 推送 blob 含 fit.sex/grade 且 at.fit 更新', async () => {
    clearMem(); purge(); resetLogs();
    setIdentity(ID_USER);
    const store = load('utils/store.js');
    const cloud = load('utils/cloud.js');
    cloud.configure({ enabled: true, restBase: 'https://mock.invalid/v1/rdb/rest/', publishableKey: 'pk' });
    let udRow = null;
    reqImpl = (o) => {
      const u = String(o.url || '');
      if (u.indexOf('/userdata') >= 0) {
        if (String(o.method || 'GET').toUpperCase() === 'GET') {
          o.success({ statusCode: 200, data: udRow ? [udRow] : [] });
          return;
        }
        const rows = Array.isArray(o.data) ? o.data : [o.data];
        udRow = rows[0] || null;
        o.success({ statusCode: 200, data: rows });
        return;
      }
      o.success({ statusCode: 200, data: [] });
    };
    await cloud.udPull(true);                   // 先建立本机基线（udCache）
    const d = store.get();
    d.fit = Object.assign({}, d.fit, { sex: 'm', grade: '34' });   // 与默认 m/12 不同 → 必脏
    store.save();
    cloud.udTouch();                            // store.save() 后正常由 cloud 的脏检测钩子调用
    await sleep(1600);                          // 防抖 1200ms + 请求
    const posts = reqLog.filter((r) => String(r.method || 'GET').toUpperCase() === 'POST' &&
      String(r.url || '').indexOf('/userdata') >= 0);
    assert.ok(posts.length >= 1, '未发出 userdata PUSH: ' + reqLog.map((r) => r.method + ' ' + r.url).join(' | '));
    const body = Array.isArray(posts[posts.length - 1].data) ? posts[posts.length - 1].data[0] : posts[posts.length - 1].data;
    const blob = JSON.parse(body.blob);
    assert.strictEqual(blob.fit.sex, 'm');
    assert.strictEqual(blob.fit.grade, '34');
    assert.ok(blob.at && blob.at.fit > 0, 'blob.at.fit 未更新（' + JSON.stringify(blob.at) + '）');
  });
  await test(14, '远端正则合并：remote fit 覆盖本机（时间戳大者赢）', () => {
    const cloud = load('utils/cloud.js');
    const local = { v: 6, at: { fit: 100 }, fit: { sex: 'f', grade: '34' } };
    const remote = { v: 6, at: { fit: 200 }, fit: { sex: 'm', grade: '12' } };
    const m = cloud.mergeUd(remote, local);
    assert.strictEqual(m.fit.sex, 'm');
    assert.strictEqual(m.fit.grade, '12');
  });
  await test(14, '体测页 onShow 拉取并应用 userdata（需求 14 UI 刷新路径）', () => {
    const js = readSrc('pages/ft/ft.js');
    assert.ok(/onShow\(\)/.test(js), 'ft 页缺 onShow');
    assert.ok(/udPull|udSections|udCache/.test(js), 'ft 页未接入 userdata 同步');
    assert.ok(/onCloudSync|applyUd|syncFit|refreshFromUd/.test(js) || /udPull/.test(js), '缺远端应用后刷新路径');
  });
  await test(14, '国标评分表页（fttable）切换男女/年级 → store.fit 更新 + userdata PUSH + 重进保持（Lead 最终口径）', async () => {
    clearMem(); purge(); resetLogs();
    setIdentity(ID_USER);
    const store = load('utils/store.js');
    const cloud = load('utils/cloud.js');
    cloud.configure({ enabled: true, restBase: 'https://mock.invalid/v1/rdb/rest/', publishableKey: 'pk' });
    let udRow = null;
    reqImpl = (o) => {
      const u = String(o.url || '');
      if (u.indexOf('/userdata') >= 0) {
        if (String(o.method || 'GET').toUpperCase() === 'GET') {
          o.success({ statusCode: 200, data: udRow ? [udRow] : [] });
          return;
        }
        const rows = Array.isArray(o.data) ? o.data : [o.data];
        udRow = rows[0] || null;
        o.success({ statusCode: 200, data: rows });
        return;
      }
      o.success({ statusCode: 200, data: [] });
    };
    await cloud.udPull(true);                         // 建立同步基线
    const d0 = store.get();
    d0.fit = Object.assign({}, d0.fit, { sex: 'm', grade: '12' });
    store.save();
    // 进入国标表页（初始值来自 store.fit）
    const def = loadPageDef('pages/fttable/fttable.js');
    const ctx = mkCtx(def);
    ctx.onLoad({});
    assert.strictEqual(ctx.data.sex, 'm', 'fttable 初值未取 store.fit.sex');
    assert.strictEqual(ctx.data.grade, '12', 'fttable 初值未取 store.fit.grade');
    // 切「女」+「大三/大四」
    ctx.setSex({ currentTarget: { dataset: { v: 'f' } } });
    ctx.setGr({ currentTarget: { dataset: { v: '34' } } });
    assert.strictEqual(ctx.data.sex, 'f');
    assert.strictEqual(ctx.data.grade, '34');
    const st = store.get();
    assert.strictEqual(st.fit.sex, 'f', '国标表切女后 store.fit.sex 未更新');
    assert.strictEqual(st.fit.grade, '34', '国标表切大三/大四后 store.fit.grade 未更新');
    await sleep(1700);                                // store.save → udTouch → 防抖 1200ms → push
    const posts = reqLog.filter((r) => String(r.method || 'GET').toUpperCase() === 'POST' &&
      String(r.url || '').indexOf('/userdata') >= 0);
    assert.ok(posts.length >= 1, '国标表切换后未触发 userdata PUSH: ' +
      reqLog.map((r) => r.method + ' ' + String(r.url).slice(-40)).join(' | '));
    const body = Array.isArray(posts[posts.length - 1].data) ? posts[posts.length - 1].data[0] : posts[posts.length - 1].data;
    const blob = JSON.parse(body.blob);
    assert.strictEqual(blob.fit.sex, 'f', 'PUSH blob.fit.sex 非 f');
    assert.strictEqual(blob.fit.grade, '34', 'PUSH blob.fit.grade 非 34');
    assert.ok(blob.at && blob.at.fit > 0, 'PUSH blob.at.fit 未更新');
    // 重进页面（新实例）：应保持上次选择
    cloud.udStop && cloud.udStop();
    const def2 = loadPageDef('pages/fttable/fttable.js');
    const ctx2 = mkCtx(def2);
    ctx2.onLoad({});
    assert.strictEqual(ctx2.data.sex, 'f', '重进国标表页 sex 未保持');
    assert.strictEqual(ctx2.data.grade, '34', '重进国标表页 grade 未保持');
    // 体测主页读同一份 store.fit（跨页一致）
    const ftdef = loadPageDef('pages/ft/ft.js');
    const ftctx = mkCtx(ftdef);
    ftctx.onShow();
    assert.strictEqual(ftctx.data.sex, 'f', '体测主页未读回国标表设置的 sex');
    assert.strictEqual(ftctx.data.grade, '34', '体测主页未读回国标表设置的 grade');
  });

  /* ---------- 需求 16：通知已处理 / 作业完成 marks 同步 ---------- */
  await test(16, 'marksPull(force) 强制读 marks（kind=ntdone/hw）并写入本机状态', async () => {
    clearMem(); purge(); resetLogs();
    setIdentity(ID_USER);
    const store = load('utils/store.js');
    const cloud = load('utils/cloud.js');
    cloud.configure({ enabled: true, restBase: 'https://mock.invalid/v1/rdb/rest/', publishableKey: 'pk' });
    reqImpl = okResp([
      { id: ID_USER.sid + '|ntdone|g_qa003', seat: ID_USER.sid, kind: 'ntdone', ref: 'g_qa003', val: true, ts: 1 },
      { id: ID_USER.sid + '|hw|hw_qa001', seat: ID_USER.sid, kind: 'hw', ref: 'hw_qa001', val: true, ts: 1 }
    ]);
    const out = await cloud.marksPull(true);
    assert.ok(out !== null, 'marksPull 返回 null');
    assert.strictEqual(reqLog.length, 1, '未发出 marks GET');
    assert.ok(/marks\?select=\*&seat=eq\./.test(String(reqLog[0].url)), 'URL 异常: ' + reqLog[0].url);
    const d = store.get();
    assert.strictEqual(!!d.ntDone['g_qa003'], true, 'ntdone 未写入 store.ntDone');
    assert.strictEqual(!!d.hwDone['hw_qa001'], true, 'hw 未写入 store.hwDone');
  });
  await test(16, 'marks TTL：非 force 二次拉取不发请求；force 绕过 TTL', async () => {
    clearMem(); purge(); resetLogs();
    setIdentity(ID_USER);
    const cloud = load('utils/cloud.js');
    cloud.configure({ enabled: true, restBase: 'https://mock.invalid/v1/rdb/rest/', publishableKey: 'pk' });
    reqImpl = okResp([]);
    await cloud.marksPull(true);
    const n1 = reqLog.length;
    await cloud.marksPull(false);               // TTL 内
    assert.strictEqual(reqLog.length, n1, 'TTL 内仍发请求');
    await cloud.marksPull(true);                // force
    assert.ok(reqLog.length > n1, 'force 未绕过 TTL');
  });
  await test(16, '通知页 / 作业页 onShow / 下拉刷新强制拉 marks', () => {
    const nt = readSrc('pages/nt/nt.js');
    const hw = readSrc('pages/hw/hw.js');
    assert.ok(/marksPull\(true\)/.test(nt), '通知页未强制拉 marks');
    assert.ok(/marksPull\(true\)/.test(hw), '作业页未强制拉 marks');
  });
  await test(16, '离线写 marks 进待补发队列，恢复后 flushPending 补发', async () => {
    clearMem(); purge(); resetLogs();
    setIdentity(ID_USER);
    const store = load('utils/store.js');
    const cloud = load('utils/cloud.js');
    cloud.configure({ enabled: true, restBase: 'https://mock.invalid/v1/rdb/rest/', publishableKey: 'pk' });
    reqImpl = (o) => (o.fail ? o.fail({ errMsg: 'request:fail mock' }) : o.success({ statusCode: 500, data: {} }));
    await cloud.setMark('ntdone', 'g_offline', true);
    const d = store.get();
    assert.ok((d.markPend || []).some((p) => p.ref === 'g_offline'), '失败未进 markPend');
    reqImpl = okResp([]);
    resetLogs();
    await cloud.flushPending();
    assert.ok(reqLog.length >= 1, '恢复后未补发请求');
    assert.ok((store.get().markPend || []).every((p) => p.ref !== 'g_offline'), '补发后 markPend 未清理');
  });
  await test(16, 'setMark 契约：id=<sid>|kind|ref、seat=sid、val 布尔、upsert', async () => {
    clearMem(); purge(); resetLogs();
    setIdentity(ID_USER);
    const cloud = load('utils/cloud.js');
    cloud.configure({ enabled: true, restBase: 'https://mock.invalid/v1/rdb/rest/', publishableKey: 'pk' });
    reqImpl = okResp([]);
    await cloud.setMark('ntdone', 'g_qa004', true);
    assert.strictEqual(reqLog.length, 1, '未发出写请求');
    const r = reqLog[0];
    const row = Array.isArray(r.data) ? r.data[0] : r.data;
    assert.strictEqual(row.id, ID_USER.sid + '|ntdone|g_qa004');
    assert.strictEqual(row.seat, ID_USER.sid);
    assert.strictEqual(row.kind, 'ntdone');
    assert.strictEqual(row.ref, 'g_qa004');
    assert.strictEqual(row.val, true);
    const pref = String((r.header && (r.header.Prefer || r.header.prefer)) || '');
    assert.ok(/merge-duplicates/.test(pref), '缺少 upsert Prefer 头: ' + pref);
  });

  /* ---------- 需求 7：QQ 文件缺失（Lead 2026-11-05 补充：两端一致） ---------- */
  await test(7, '通知页文件缺失：file 无 url → 「待获取」徽标 + 点击提示含群名（需求 7 小程序侧）', () => {
    const wxml = readSrc('pages/nt/nt.wxml');
    const js = readSrc('pages/nt/nt.js');
    const all = wxml + '\n' + js;
    assert.ok(/待获取/.test(all), '没有「待获取」文案');
    assert.ok(wxml.indexOf('待获取') >= 0 || /待获取/.test(js), '「待获取」未进入渲染模板');
    // 提示必须带群名（item.group / g.group）：前端模板或点击处理里引用 group 字段
    assert.ok(/(group|群名|groupName)/.test(all), '缺少群名（group）引用');
    assert.ok(/(toast|showModal|提示|前往|查看)/.test(all), '缺少点击提示逻辑');
    // file 项的缺失判定：url 为空/不存在才算待获取
    assert.ok(/(!it\.url|!item\.url|url\s*===\s*['"]{2}|!\s*[A-Za-z_$][\w$]*\.url)/.test(all),
      '缺少「url 为空 → 待获取」判定');
  });

  /* ---------- 需求 5：小程序滑动卡死审计（静态） ---------- */
  await test(5, '页面无全局 catchtouchmove / preventDefault 阻断纵向滚动', () => {
    const app = fs.readdirSync(path.join(ROOT, 'pages'));
    let bad = [];
    app.forEach((pg) => {
      const wxml = path.join(ROOT, 'pages', pg, pg + '.wxml');
      if (!fs.existsSync(wxml)) return;
      const t = fs.readFileSync(wxml, 'utf8');
      // 允许弹层/遮罩内的 catchtouchmove（锁定背景滚动是正常模态写法，如 power 选择 bottom-sheet）
      const badLines = t.split(/\r?\n/).filter(function (ln) {
        return /catchtouchmove/.test(ln) && !/(pw-mask|pw-sheet|modal|mask|sheet|popup|dialog|overlay)/i.test(ln);
      });
      if (badLines.length) bad.push(pg + '.wxml');
    });
    assert.deepStrictEqual(bad, [], '存在 catchtouchmove: ' + bad.join(','));
  });
  await test(5, 'scroll-view 横向滚动页的触摸手势有方向锁（tt）', () => {
    const js = readSrc('pages/tt/tt.js');
    assert.ok(/SW_LOCK\s*=\s*12/.test(js), '缺少 12px 横向锁定');
    assert.ok(/Math\.abs\(dx\) > Math\.abs\(dy\) \* SW_LOCK_RATIO/.test(js), '缺少横纵向比例判定');
  });

  /* ---------- 需求 13：动画 / 减弱动效（行为+样式存在性） ---------- */
  await test(13, '通知展开/收起：max-height 过渡 + .26/.28s + reduced-motion 关闭', () => {
    const wxss = readSrc('pages/nt/nt.wxss');
    assert.ok(/nt-detail--open/.test(wxss) && /ntDetailOpen\s*\.28s/.test(wxss), '缺少展开动画');
    assert.ok(/nt-detail--close/.test(wxss) && /ntDetailClose\s*\.26s/.test(wxss), '缺少收起动画');
    assert.ok(/prefers-reduced-motion/.test(wxss) && /nt-detail--open,\s*\.nt-detail--close\s*\{\s*animation:\s*none/.test(wxss.replace(/\n/g, ' ')), 'reduced-motion 未关闭展开动画');
  });
  await test(13, '工作台轮换/常驻浮动动画 + reduced-motion 降级', () => {
    const wxss = readSrc('pages/index/index.wxss');
    assert.ok(/wb-rot--out\s*\{\s*animation:\s*wbRotOut\s*\.26s/.test(wxss.replace(/\n/g, ' ')), '缺少轮换淡出动画');
    assert.ok(/wb-rot--in\s*\{\s*animation:\s*wbRotIn\s*\.32s/.test(wxss.replace(/\n/g, ' ')), '缺少轮换淡入动画');
    assert.ok(/wb-task--float/.test(wxss) && /@keyframes wbFloat/.test(wxss), '缺少常驻浮动');
    const rm = wxss.indexOf('@media (prefers-reduced-motion: reduce)');
    assert.ok(rm >= 0, '缺少 reduced-motion 分支');
    const block = wxss.slice(rm, rm + 400);
    assert.ok(/animation:\s*none/.test(block), 'reduced-motion 下未关闭动画');
  });

  /* ---------- 信息项：setData 体积/频率（需求 15） ---------- */
  pend(15, 'setData 轮换只更新 4 个小字段（代码走查）',
    'index.js _rotateCard 只 setData {key.anim} / {key.idx,title,sub,anim}，未整卡 setData');

  /* ============================================================ 汇总 */
  const summary = { tag: TAG, total: passN + failN, pass: passN, fail: failN, pending: pendN,
    results, at: new Date().toISOString(), root: ROOT };
  if (!fs.existsSync(REPORTS)) fs.mkdirSync(REPORTS, { recursive: true });
  const out = path.join(REPORTS, 'mp_v2_' + TAG + '.json');
  fs.writeFileSync(out, JSON.stringify(summary, null, 2), 'utf8');
  console.log('\n' + '='.repeat(66));
  console.log('mp_v2_check [' + TAG + ']: ' + (passN + failN) + ' 项，PASS ' + passN +
    '，FAIL ' + failN + '，PEND ' + pendN);
  console.log('结果 JSON:', out);
  console.log('='.repeat(66));
  process.exitCode = failN ? 2 : 0;
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
