/* appearance_unit_tests.js —— 外观（跟随系统 / 浅色 / 深色）专项单测
 *
 * 运行方式：
 *   node appearance_unit_tests.js   # 独立运行（自带 wx mock），结果写 appearance_result.json
 *   node unit.js                    # unit.js 末尾 require 本文件 run(test)，并入总表
 *
 * 覆盖（2026-11-15，对齐安卓 v4.55「我的 → 外观」；小程序用 page-meta page-style 覆写 CSS 变量）：
 *   A 模式读写/归一/持久化/非法值；B pageStyle（system 空 / light / dark / color-scheme）；
 *   C 与 app.wxss LIGHT/DARK token 逐项一致（防两套色值漂移）；D applyChrome 原生外壳参数；
 *   E themeClass 与实际生效主题；F Page 全局包装（首帧注入 + onShow 同步 + 系统主题变化）；
 *   G notifyPages；H util.theme()/nativeTheme() 外观感知；I 全页面静态接线（page-meta/themeClass）；
 *   J 页面级暗色块改 .theme-dark（不再 @media）；K 「我的」外观卡接线；L 2 行工具描述/卡高；
 *   M 电费比较独立行 + 充值图例接线。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { allPages } = require('./_app_pages.js');
const assert = require('assert');

const ROOT = 'C:/Users/Ko_Li/.openclaw/workspace/mp-class-tools';
const ROOT_N = ROOT.replace(/\\/g, '/');

function purge() {
  Object.keys(require.cache).forEach(function (k) {
    if (k.replace(/\\/g, '/').indexOf(ROOT_N) === 0) delete require.cache[k];
  });
}
function src(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function R(rel) { return require(path.join(ROOT, rel)); }

function createCtx() {
  const mem = Object.create(null);
  const log = { nav: [], bg: [], bgText: [], tab: [], themeHandlers: [] };
  let sysTheme = 'light';
  const wxMock = {
    getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
    setStorageSync(k, v) { mem[k] = v; },
    removeStorageSync(k) { delete mem[k]; },
    getAppBaseInfo() { return { theme: sysTheme, SDKVersion: '3.0.0' }; },
    getSystemInfoSync() { return { theme: sysTheme, windowWidth: 390, SDKVersion: '3.0.0' }; },
    setNavigationBarColor(o) { log.nav.push(o); },
    setBackgroundColor(o) { log.bg.push(o); },
    setBackgroundTextStyle(o) { log.bgText.push(o); },
    setTabBarStyle(o) { log.tab.push(o); },
    onThemeChange(fn) { log.themeHandlers.push(fn); },
    showToast() {}
  };
  return {
    mem: mem, log: log, wxMock: wxMock,
    setSystem(t) { sysTheme = t === 'dark' ? 'dark' : 'light'; },
    fireTheme(t) { sysTheme = t === 'dark' ? 'dark' : 'light'; log.themeHandlers.forEach(function (fn) { fn({ theme: sysTheme }); }); },
    reset() {
      Object.keys(mem).forEach(function (k) { delete mem[k]; });
      log.nav.length = 0; log.bg.length = 0; log.bgText.length = 0; log.tab.length = 0;
      log.themeHandlers.length = 0;
      sysTheme = 'light';
    }
  };
}

// 解析 app.wxss 的 LIGHT / DARK token 块（--md-* 名值），用于与 appearance.js 对拍
function parseWxssTokens(css, begin, end) {
  const a = css.indexOf(begin), b = css.indexOf(end);
  assert.ok(a >= 0 && b > a, '找不到 app.wxss token 块：' + begin);
  const block = css.slice(a, b);
  const out = {};
  const re = /--(md-[a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(block))) out[m[1]] = m[2].trim();
  return out;
}
const NON_THEME = /^md-(shape-|space-|page-pad$|gap-|list-min-h$|ease-|dur-)/;

module.exports.run = async function (test) {
  const C = createCtx();

  await test('外观 A1：模式默认 system / setMode 持久化 / 非法入参不改 / resetForTest 清空', function () {
    purge();
    global.wx = C.wxMock;
    const ap = R('utils/appearance.js');
    assert.strictEqual(ap.getMode(), 'system', '默认跟随系统');
    assert.deepStrictEqual(ap.MODE_KEYS, ['system', 'light', 'dark']);
    assert.deepStrictEqual(ap.MODES.map(function (m) { return m.label; }), ['跟随系统', '浅色', '深色']);
    assert.strictEqual(ap.setMode('dark'), 'dark');
    assert.strictEqual(C.mem[ap.STORAGE_KEY], 'dark', '落本机 storage');
    assert.strictEqual(ap.getMode(), 'dark');
    assert.strictEqual(ap.setMode('bogus'), 'dark', '非法入参不覆盖');
    assert.strictEqual(ap.getMode(), 'dark');
    // 重新 require（模拟冷启动）
    purge();
    global.wx = C.wxMock;
    const ap2 = R('utils/appearance.js');
    assert.strictEqual(ap2.getMode(), 'dark', '冷启动保持');
    ap2.resetForTest();
    assert.strictEqual(ap2.getMode(), 'system');
  });

  await test('外观 A2：resolved() 跟随系统 / 显式浅深覆盖系统', function () {
    purge();
    global.wx = C.wxMock;
    C.reset();
    const ap = R('utils/appearance.js');
    C.setSystem('dark');
    assert.strictEqual(ap.resolved(), 'dark', '跟随系统=系统深色');
    C.setSystem('light');
    assert.strictEqual(ap.resolved(), 'light', '跟随系统=系统浅色');
    ap.setMode('light');
    C.setSystem('dark');
    assert.strictEqual(ap.resolved(), 'light', '显式浅色压过系统深色');
    ap.setMode('dark');
    C.setSystem('light');
    assert.strictEqual(ap.resolved(), 'dark', '显式深色压过系统浅色');
    ap.setMode('system');
    assert.strictEqual(ap.resolved(), 'light', '回到跟随系统');
  });

  await test('外观 B：pageStyle 系统模式为空 / 浅深输出整组 token + color-scheme', function () {
    purge();
    global.wx = C.wxMock;
    C.reset();
    const ap = R('utils/appearance.js');
    assert.strictEqual(ap.pageStyle(), '', '跟随系统交给 @media（首帧不闪）');
    assert.strictEqual(ap.themeClass(), '', '系统浅色无暗色标记');
    C.setSystem('dark');
    assert.strictEqual(ap.themeClass(), 'theme-dark', '系统深色 → theme-dark');
    C.setSystem('light');
    ap.setMode('light');
    const s = ap.pageStyle();
    assert.ok(s.length > 300, '浅色内联样式含整组 token');
    assert.ok(s.indexOf('--md-surface:#F4F0E6') >= 0 && s.indexOf('--md-on-surface:#303A35') >= 0);
    assert.ok(s.indexOf('color-scheme:light') >= 0);
    assert.ok(/;$/.test(s), '以分号结尾（page-style 拼接安全）');
    ap.setMode('dark');
    C.setSystem('light');
    const d = ap.pageStyle();
    assert.ok(d.indexOf('--md-surface:#1B1E1A') >= 0 && d.indexOf('--md-primary-container:#2E5147') >= 0);
    assert.ok(d.indexOf('color-scheme:dark') >= 0);
    assert.strictEqual((d.match(/--md-/g) || []).length, ap.TOKENS.length, 'token 数量与 TOKENS 一致');
  });

  await test('外观 C：appearance token 与 app.wxss LIGHT/DARK 逐项一致（防色值漂移）', function () {
    purge();
    global.wx = C.wxMock;
    C.reset();
    const ap = R('utils/appearance.js');
    const css = src('app.wxss');
    const light = parseWxssTokens(css, 'M3 TOKENS · LIGHT (BEGIN)', 'M3 TOKENS · LIGHT (END)');
    const dark = parseWxssTokens(css, 'M3 TOKENS · DARK (BEGIN)', 'M3 TOKENS · DARK (END)');
    const themed = Object.keys(light).filter(function (k) { return !NON_THEME.test(k); });
    assert.deepStrictEqual(themed.slice().sort(), ap.TOKENS.slice().sort(), 'app.wxss 主题 token 集合 = appearance.TOKENS');
    ap.TOKENS.forEach(function (k) {
      assert.strictEqual(ap.LIGHT[k], light[k], 'LIGHT ' + k);
      assert.strictEqual(ap.DARK[k], dark[k], 'DARK ' + k);
    });
  });

  await test('外观 D：applyChrome 同步导航栏/窗口/tabBar（含 API 缺失容错）', function () {
    purge();
    const mem = Object.create(null);
    const wxLite = {
      getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
      setStorageSync(k, v) { mem[k] = v; },
      removeStorageSync(k) { delete mem[k]; },
      getAppBaseInfo() { return { theme: 'light' }; },
      setNavigationBarColor(o) { C.log.nav.push(o); },
      setBackgroundColor(o) { C.log.bg.push(o); },
      setBackgroundTextStyle(o) { C.log.bgText.push(o); },
      setTabBarStyle(o) { C.log.tab.push(o); }
    };
    global.wx = wxLite;
    let ap = R('utils/appearance.js');
    ap.applyChrome();
    assert.strictEqual(C.log.nav.length, 1);
    assert.deepStrictEqual(
      { front: C.log.nav[0].frontColor, bg: C.log.nav[0].backgroundColor },
      { front: '#ffffff', bg: '#5E8F87' }, '浅色导航栏 = theme.json light');
    assert.strictEqual(C.log.bg[0].backgroundColor, '#F4F0E6');
    assert.strictEqual(C.log.bgText[0].textStyle, 'dark');
    assert.strictEqual(C.log.tab[0].backgroundColor, '#FFFCF6');
    assert.strictEqual(C.log.tab[0].color, '#8B948B');
    ap.setMode('dark');
    ap.applyChrome();
    assert.strictEqual(C.log.nav[1].backgroundColor, '#1B1E1A');
    assert.strictEqual(C.log.bg[1].backgroundColor, '#1B1E1A');
    assert.strictEqual(C.log.bgText[1].textStyle, 'light');
    assert.strictEqual(C.log.tab[1].backgroundColor, '#22261F');
    assert.strictEqual(C.log.tab[1].selectedColor, '#9BC9BB');
    // API 全缺：不抛错（旧基础库/测试环境）
    purge();
    global.wx = { getStorageSync() { return ''; }, setStorageSync() {}, removeStorageSync() {} };
    ap = R('utils/appearance.js');
    assert.doesNotThrow(function () { ap.applyChrome(); });
  });

  await test('外观 E：themeClass 跟随实际生效主题（显式与系统交叉）', function () {
    purge();
    global.wx = C.wxMock;
    C.reset();
    const ap = R('utils/appearance.js');
    C.setSystem('dark');
    ap.setMode('light');
    assert.strictEqual(ap.themeClass(), '', '显式浅色 + 系统深色 → 不暗');
    ap.setMode('dark');
    C.setSystem('light');
    assert.strictEqual(ap.themeClass(), 'theme-dark', '显式深色 + 系统浅色 → 暗');
    ap.setMode('system');
    assert.strictEqual(ap.themeClass(), '', '跟随系统浅色');
    C.setSystem('dark');
    assert.strictEqual(ap.themeClass(), 'theme-dark', '跟随系统深色');
  });

  await test('外观 F：decoratePages 包装全局 Page（首帧注入 + onShow 同步 + 系统主题变化通知）', function () {
    purge();
    global.wx = C.wxMock;
    C.reset();
    C.setSystem('light');
    let captured = null;
    const rawPage = function (def) { captured = def; return def; };
    global.Page = rawPage;
    global.getCurrentPages = function () { return pages; };
    const pages = [];
    const ap = R('utils/appearance.js');
    ap.setMode('dark');
    assert.strictEqual(ap.decoratePages(), true, '包装成功');
    assert.strictEqual(typeof global.Page, 'function');
    assert.strictEqual(global.Page.__zqAppearanceWrapped, true, '标记防重复包装');
    // 1) 新页面 data 首帧即带外观
    let origShowCalls = 0, origThis = null;
    global.Page({
      data: { a: 1 },
      onShow() { origShowCalls++; origThis = this; }
    });
    assert.ok(captured && captured.data, 'Page(def) 收到定义');
    assert.ok(String(captured.data.themeStyle || '').indexOf('--md-surface:#1B1E1A') >= 0, '首帧 data.themeStyle=深色');
    assert.strictEqual(captured.data.themeClass, 'theme-dark');
    assert.strictEqual(captured.data.a, 1, '页面原 data 保留');
    // 2) onShow：同步 themeStyle/themeClass + 应用原生外壳 + 继续调用原 onShow(this)
    const setDataLog = [];
    const fakePage = {
      data: { themeStyle: '', themeClass: '' },
      setData(d) { setDataLog.push(d); Object.assign(this.data, d); },
      route: 'pages/all/all'
    };
    pages.push(fakePage);
    C.log.nav.length = 0; C.log.tab.length = 0;
    captured.onShow.call(fakePage);
    assert.ok(setDataLog.length >= 1 && setDataLog[0].themeClass === 'theme-dark', 'onShow 同步外观数据');
    assert.ok(String(setDataLog[0].themeStyle || '').indexOf('color-scheme:dark') >= 0);
    assert.strictEqual(C.log.nav.length, 1, 'onShow 同步导航栏');
    assert.strictEqual(C.log.tab.length, 1, 'onShow 同步 tabBar');
    assert.strictEqual(origShowCalls, 1, '原 onShow 被调用一次');
    assert.strictEqual(origThis, fakePage, '原 onShow 的 this 正确');
    // 2b) 同一页面实例再次 onShow：主题未变 → 不 setData、不重复 4 次原生桥调用
    setDataLog.length = 0;
    C.log.nav.length = 0; C.log.tab.length = 0;
    captured.onShow.call(fakePage);
    assert.strictEqual(setDataLog.length, 0, '主题未变不重复 setData');
    assert.strictEqual(C.log.nav.length, 0, '主题未变不重复导航栏');
    assert.strictEqual(C.log.tab.length, 0, '主题未变不重复 tabBar');
    assert.strictEqual(origShowCalls, 2, '原 onShow 仍被调用');
    // 3) 幂等：再次 decoratePages 不重复包装
    const wrappedRef = global.Page;
    assert.strictEqual(ap.decoratePages(), true);
    assert.strictEqual(global.Page, wrappedRef, '重复调用不变');
    // 4) 系统主题变化：显式深色时不受影响；切回跟随系统后刷新页面
    setDataLog.length = 0;
    assert.ok(C.log.themeHandlers.length >= 1, '注册 wx.onThemeChange');
    ap.setMode('dark');
    C.fireTheme('light');
    assert.strictEqual(setDataLog.length, 0, '显式深色不受系统变化影响');
    ap.setMode('system');
    C.fireTheme('light');
    assert.ok(setDataLog.length >= 1, '跟随系统时系统变化刷新页面');
    assert.strictEqual(setDataLog[0].themeStyle, '', '跟随系统 pageStyle 为空');
    // 清理全局
    delete global.Page;
    delete global.getCurrentPages;
    pages.length = 0;
    captured = null;
  });

  await test('外观 G：notifyPages 刷新所有现存页面 / 单页失败不影响其它页', function () {
    purge();
    global.wx = C.wxMock;
    C.reset();
    const ap = R('utils/appearance.js');
    ap.setMode('light');
    const got = [];
    const pages = [
      { setData(d) { got.push(d); } },
      { setData() { throw new Error('坏页面'); } },
      { setData(d) { got.push(d); } }
    ];
    global.getCurrentPages = function () { return pages; };
    ap.notifyPages();
    assert.strictEqual(got.length, 2, '两个正常页面被更新');
    got.forEach(function (d) {
      assert.ok(String(d.themeStyle || '').indexOf('--md-surface:#F4F0E6') >= 0);
      assert.strictEqual(d.themeClass, '');
    });
    delete global.getCurrentPages;
  });

  await test('外观 H：util.theme()/nativeTheme() 外观感知（原生 switch/slider 配色一致）', function () {
    purge();
    global.wx = C.wxMock;
    C.reset();
    const ap = R('utils/appearance.js');
    ap.setMode('dark');
    C.setSystem('light');
    const util = R('utils/util.js');
    assert.strictEqual(util.theme(), 'dark', '显式深色 → theme()=dark');
    assert.strictEqual(util.nativeTheme().primary, '#9BC9BB');
    assert.strictEqual(util.nativeTheme().track, '#3E443B');
    ap.setMode('light');
    C.setSystem('dark');
    assert.strictEqual(util.theme(), 'light', '显式浅色 → theme()=light');
    assert.strictEqual(util.nativeTheme().primary, '#5E8F87');
    assert.strictEqual(util.nativeTheme().track, '#E6E9E8');
    ap.setMode('system');
    assert.strictEqual(util.theme(), 'dark', '跟随系统=dark');
  });

  await test('外观 I：全部页面 WXML 接 page-meta themeStyle + 根节点 themeClass（静态）', function () {
    purge();
    const app = JSON.parse(src('app.json'));
    const pages = allPages(app);
    assert.ok(pages.length >= 31, '页面数 ' + pages.length);
    const missingMeta = [], missingClass = [], badMeta = [];
    pages.forEach(function (p) {
      const wxml = src(p + '.wxml');
      if (wxml.indexOf('<page-meta') < 0) { missingMeta.push(p); return; }
      if (!/<page-meta[^>]*page-style="\{\{themeStyle\}\}/.test(wxml)) {
        // pages/all 为合并写法：{{themeStyle}}{{dragPageStyle}}
        if (!/page-style="\{\{themeStyle\}\}\{\{dragPageStyle\}\}"/.test(wxml)) badMeta.push(p);
      }
      if (wxml.indexOf('{{themeClass}}') < 0) missingClass.push(p);
    });
    assert.deepStrictEqual(missingMeta, [], '缺 page-meta：' + missingMeta.join(','));
    assert.deepStrictEqual(badMeta, [], 'page-meta 未绑定 themeStyle：' + badMeta.join(','));
    assert.deepStrictEqual(missingClass, [], '根节点缺 themeClass：' + missingClass.join(','));
    const allWxml = src('pages/all/all.wxml');
    assert.ok(/page-style="\{\{themeStyle\}\}\{\{dragPageStyle\}\}"/.test(allWxml), '全部页合并拖动锁滚动 style');
    // 入口接线：app.js 在 App() 前包装 Page（失败静默降级为系统主题）
    const appJs = src('app.js');
    assert.ok(/require\('\.\/utils\/appearance\.js'\)/.test(appJs), 'app.js 引入 appearance');
    assert.ok(/appearance\.decoratePages\(\)/.test(appJs), 'app.js 调用 decoratePages');
    assert.ok(/try \{ appearance\.decoratePages\(\); \} catch/.test(appJs), '包装失败降级不崩');
  });

  await test('外观 J：页面级暗色块改 .theme-dark（不再依赖 @media）+ 深色 hero 中性化（静态）', function () {
    purge();
    const pages = {
      'pages/nt/nt.wxss': ['.nt-page.theme-dark', '.theme-dark .nt-card--expired'],
      'pages/tt/tt.wxss': ['.ttp.theme-dark', '.theme-dark .tt-c0'],
      'pages/ft/ft.wxss': ['.theme-dark .ft-cell', '.theme-dark .m3-card--hero'],
      'pages/roll/roll.wxss': ['.theme-dark .rs-in', '.theme-dark .rpill'],
      'pages/stats/stats.wxss': ['.theme-dark .stbar']
    };
    Object.keys(pages).forEach(function (f) {
      const css = src(f);
      assert.ok(css.indexOf('@media (prefers-color-scheme') < 0, f + ' 不应再依赖 @media 暗色');
      pages[f].forEach(function (needle) { assert.ok(css.indexOf(needle) >= 0, f + ' 缺 ' + needle); });
    });
    // 全局映射/骨架/placeholder 改类驱动
    const app = src('app.wxss');
    assert.ok(app.indexOf('.theme-dark .m3-li__lead') >= 0 && app.indexOf('.theme-dark .sk-shimmer') >= 0);
    assert.ok(/M3 TOKENS · DARK \(BEGIN\)[\s\S]*@media \(prefers-color-scheme: dark\)/.test(app),
      'app.wxss 仍保留系统 token @media（跟随系统首帧）');
    // 深色 hero：投票详情 / 抽签记录（页面级）+ 使用说明 mint（全局，避免 ug.wxss 引入非 .ug-* 选择器）
    ['pages/votedetail/votedetail.wxss|.theme-dark .vd-hero',
      'pages/drawrec/drawrec.wxss|.theme-dark .dr-hero',
      'app.wxss|.theme-dark .ug-tone-mint'].forEach(function (spec) {
      const s = spec.split('|');
      assert.ok(src(s[0]).indexOf(s[1]) >= 0, s[0] + ' 缺深色 hero 中性化 ' + s[1]);
    });
    // 三个仍用 token 的页面暗色映射也已类驱动
    assert.ok(src('pages/all/all.wxss').indexOf('.theme-dark .ico-chip--primary') >= 0);
    assert.ok(src('pages/index/index.wxss').indexOf('.theme-dark .wb-task-ico--primary') >= 0);
    assert.ok(src('pages/power/power.wxss').indexOf('.theme-dark .pw-ring-in') >= 0);
  });

  await test('外观 K：「我的 → 外观」卡片接线（三选一 / 本机 / 即时生效）', function () {
    purge();
    global.wx = C.wxMock;
    C.reset();
    const meJs = src('pages/me/me.js');
    const meWxml = src('pages/me/me.wxml');
    assert.ok(/require\('\.\.\/\.\.\/utils\/appearance\.js'\)/.test(meJs), 'me.js 引入 appearance');
    assert.ok(/appearanceMode:\s*appearance\.getMode\(\)/.test(meJs), 'me data 带当前外观模式');
    assert.ok(/appearanceOptions:\s*appearance\.MODES/.test(meJs), 'me data 带三选项');
    assert.ok(/pickAppearance\s*\(/.test(meJs), 'me 有 pickAppearance 处理');
    assert.ok(/appearance\.setMode\(k\)/.test(meJs) && /appearance\.applyChrome\(\)/.test(meJs) && /appearance\.notifyPages\(\)/.test(meJs),
      '选择后落偏好 + 同步外壳 + 刷新页面');
    assert.ok(/外观/.test(meWxml) && /wx:for="\{\{appearanceOptions\}\}"/.test(meWxml) && /bindtap="pickAppearance"/.test(meWxml),
      'me.wxml 外观卡三选项绑定');
    assert.ok(/me-appearance-mark/.test(meWxml) && /me-appearance-mark/.test(src('pages/me/me.wxss')), '选中态样式');
    // 模式数据驱动（label/icon 都在 appearance.MODES，页面不重复维护文案）
    const ap = R('utils/appearance.js');
    assert.deepStrictEqual(ap.MODES.map(function (m) { return m.icon; }), ['◐', '☀', '☾']);
    // 不进入 UD v6 同步：appearance 只读写本机 storage，不 import cloud/store
    const apSrc = src('utils/appearance.js');
    assert.ok(apSrc.indexOf("require('./cloud.js')") < 0 && apSrc.indexOf("require('./store.js')") < 0, '外观不进账号同步');
  });

  await test('外观 N：app.js 真实接线（App() 前包装全局 Page → 页面首帧即带外观 + onShow 落原生外壳）', function () {
    purge();
    const saved = {
      Page: global.Page, App: global.App, getApp: global.getApp,
      getCurrentPages: global.getCurrentPages, wx: global.wx
    };
    const mem = Object.create(null);
    const calls = { nav: [], tab: [] };
    const wxFull = {
      getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
      setStorageSync(k, v) { mem[k] = v; },
      removeStorageSync(k) { delete mem[k]; },
      getAppBaseInfo() { return { theme: 'light', SDKVersion: '3.0.0' }; },
      getSystemInfoSync() { return { theme: 'light', windowWidth: 390, SDKVersion: '3.0.0' }; },
      getDeviceInfo() { return {}; },
      getWindowInfo() { return { windowWidth: 390 }; },
      getStorageInfoSync() { return { keys: [], currentSize: 0, limitSize: 10240 }; },
      setNavigationBarColor(o) { calls.nav.push(o); },
      setBackgroundColor() {}, setBackgroundTextStyle() {},
      setTabBarStyle(o) { calls.tab.push(o); },
      onThemeChange() {}, showToast() {}, nextTick(fn) { if (fn) fn(); },
      createSelectorQuery() { return { in() { return this; }, select() { return this; }, fields() { return this; }, exec() {} }; }
    };
    global.wx = wxFull;
    mem['zq_appearance_v1'] = 'dark';   // 用户显式选了深色
    let pageDef = null;
    global.Page = function (d) { pageDef = d; };
    global.App = function () { /* 只捕获，不执行生命周期 */ };
    global.getApp = function () { return null; };
    global.getCurrentPages = function () { return []; };
    try {
      require(path.join(ROOT, 'app.js'));
      assert.ok(global.Page && global.Page.__zqAppearanceWrapped, 'app.js 在 App() 前包装了全局 Page');
      require(path.join(ROOT, 'pages/me/me.js'));
      assert.ok(pageDef && pageDef.data, 'me 页面定义被包装后的 Page 捕获');
      assert.ok(String(pageDef.data.themeStyle || '').indexOf('--md-surface:#1B1E1A') >= 0, '首帧 themeStyle=深色');
      assert.strictEqual(pageDef.data.themeClass, 'theme-dark', '首帧 themeClass=暗色');
      assert.strictEqual(pageDef.data.appearanceMode, 'dark', '外观卡选中态=深色');
      const setDataLog = [];
      const fake = { setData(d) { setDataLog.push(d); }, route: 'pages/me/me' };
      pageDef.onShow.call(fake);
      assert.ok(setDataLog.length >= 1 && setDataLog[0].themeClass === 'theme-dark', 'onShow 同步页面外观');
      assert.ok(calls.nav.length >= 1 && calls.nav[0].backgroundColor === '#1B1E1A', 'onShow 同步深色导航栏');
    } finally {
      purge();
      ['Page', 'App', 'getApp', 'getCurrentPages', 'wx'].forEach(function (k) {
        if (saved[k] === undefined) { try { delete global[k]; } catch (e) {} }
        else global[k] = saved[k];
      });
      if (!saved.Page) { try { delete global.Page; } catch (e) {} }
    }
  });

  await test('外观 L / 电费 M：工具描述 2 行 + 电费比较独立行 / 充值图例接线（静态）', function () {
    purge();
    // L：每个工具描述最多 2 行完整显示，卡片高度适配
    const allCss = src('pages/all/all.wxss');
    assert.ok(/-webkit-line-clamp:\s*2/.test(allCss) && /white-space:\s*normal/.test(allCss), '工具描述 2 行 clamp');
    assert.ok(/min-height:\s*148rpx/.test(allCss), '工具卡高度适配 2 行描述');
    // M：电费同期比较独立行 + 趋势图例充值度数
    const pwWxml = src('pages/power/power.wxml');
    assert.ok(/pw-tile-cmp/.test(pwWxml), '区间用电 tile 独立比较行');
    assert.ok(/item\.cmp\b/.test(pwWxml) && /trend\.rechargeTotalText/.test(pwWxml), '比较行与充值图例绑定');
    assert.ok(/\.pw-tile-cmp--up/.test(src('pages/power/power.wxss')) && /\.pw-tile-cmp--down/.test(src('pages/power/power.wxss')),
      '比较行正负配色');
    const pwJs = src('utils/power.js');
    assert.ok(/cmp:\s*cmpText,\s*cmpUp:\s*cmpUp/.test(pwJs), 'tilesOf 输出 cmp/cmpUp');
    assert.ok(/rechargeTotalText:\s*tl\.recharge/.test(src('pages/power/power.js')), '页面 trend 提供充值累计文案');
  });
};

/* 独立运行：node appearance_unit_tests.js */
if (require.main === module) {
  let passN = 0, failN = 0;
  const results = [];
  const test = async function (name, fn) {
    try { await fn(); passN++; results.push({ name: name, ok: true }); console.log('PASS  ' + name); }
    catch (e) { failN++; results.push({ name: name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
  };
  module.exports.run(test).then(function () {
    const summary = { total: passN + failN, pass: passN, fail: failN, results: results, at: new Date().toISOString() };
    fs.writeFileSync(path.join(__dirname, 'appearance_result.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log('\n================ appearance unit: ' + passN + ' passed, ' + failN + ' failed ================');
    process.exitCode = failN ? 2 : 0;
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}
