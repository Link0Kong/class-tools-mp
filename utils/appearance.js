// utils/appearance.js —— 外观：跟随系统 / 浅色 / 深色（本机偏好）
//
// 背景（2026-11-15 三端对齐：安卓 v4.55「我的 → 外观」三选一）：
//   * 微信原生只支持「跟随系统」：app.json darkmode:true + theme.json（导航栏/tabBar）+ WXSS
//     @media (prefers-color-scheme: dark) 换 CSS 变量；
//   * 小程序没有 :root / 没有 JS 改 CSS 变量的 API，官方推荐手动主题方案 = 页面根节点
//     <page-meta page-style="…">（内联样式作用在 page 根节点，覆盖 app.wxss 里 page 上的变量），
//     本文件生成整组 --md-* token 的内联值；原生外壳（导航栏 / 窗口底色 / tabBar / 下拉背景）
//     用 wx.setXxx 同步；
//   * 偏好只存本机（zq_appearance_v1），**不进 userdata v6 账号同步**——与安卓 DataStore 同语义
//     （外观是设备偏好，换设备不应被云覆盖）。
//
// 失败降级：任何 wx API 不可用/调用失败都静默忽略 → 页面回到 app.wxss 的系统主题（= 现状），不影响功能。
//
// 用法：
//   * app.js 顶部 require 并调用 decoratePages()：全局包装 Page，给每个页面注入 themeStyle / themeClass
//     并在 onShow 同步原生外壳（页面 WXML 只需页面根节点有 <page-meta page-style="{{themeStyle}}">）；
//   * 页面（如 pages/me）用 getMode()/setMode() 读写偏好，setMode 后调用 applyChrome()+notifyPages()；
//   * utils/util.js 的 theme()/nativeTheme() 也读 resolved()，原生 switch/slider 配色与页面一致。

const STORAGE_KEY = 'zq_appearance_v1';

// 三选一（顺序 = 「我的 → 外观」展示顺序；icon 用于「我的」页行首字母圆）
const MODES = [
  { k: 'system', label: '跟随系统', icon: '◐' },
  { k: 'light', label: '浅色', icon: '☀' },
  { k: 'dark', label: '深色', icon: '☾' }
];
const MODE_KEYS = MODES.map(function (m) { return m.k; });

// 与 app.wxss「M3 TOKENS · LIGHT / DARK」逐项一致（单测 appearance_unit_tests.js 会解析 app.wxss 校验，
// 改色必须两边同改；形状/间距/动效不随主题变，不在此列）。
const LIGHT = {
  'md-primary': '#5E8F87',
  'md-on-primary': '#FFFFFF',
  'md-primary-container': '#D9EAE3',
  'md-on-primary-container': '#173B34',
  'md-secondary': '#7D9EBB',
  'md-on-secondary': '#FFFFFF',
  'md-secondary-container': '#DCE8F2',
  'md-on-secondary-container': '#1C3142',
  'md-tertiary': '#C6A475',
  'md-on-tertiary': '#FFFFFF',
  'md-tertiary-container': '#F3E7D3',
  'md-on-tertiary-container': '#3D2B12',
  'md-surface': '#F4F0E6',
  'md-surface-container-lowest': '#FFFFFF',
  'md-surface-container-low': '#F7F3EA',
  'md-surface-container': '#EFE9DC',
  'md-surface-container-high': '#E8E1D2',
  'md-surface-container-highest': '#E0D9C9',
  'md-on-surface': '#303A35',
  'md-on-surface-variant': '#5C6860',
  'md-outline': '#8B948B',
  'md-outline-variant': '#E7DED0',
  'md-error': '#B87870',
  'md-error-container': '#F7E3DF',
  'md-on-error-container': '#3E1713',
  'md-on-error': '#FFFFFF',
  'md-press-overlay': 'rgba(0, 0, 0, .05)',
  'md-elev-1': '0 2rpx 6rpx rgba(0, 0, 0, .06)',
  'md-elev-2': '0 4rpx 14rpx rgba(0, 0, 0, .09)',
  'md-elev-3': '0 10rpx 28rpx rgba(0, 0, 0, .12)'
};
const DARK = {
  'md-primary': '#9BC9BB',
  'md-on-primary': '#12332C',
  'md-primary-container': '#2E5147',
  'md-on-primary-container': '#D9EAE3',
  'md-secondary': '#AAC6D8',
  'md-on-secondary': '#1C3445',
  'md-secondary-container': '#3A4E5C',
  'md-on-secondary-container': '#DCE8F2',
  'md-tertiary': '#E5C79B',
  'md-on-tertiary': '#3D2B12',
  'md-tertiary-container': '#5A4226',
  'md-on-tertiary-container': '#F3E7D3',
  'md-surface': '#1B1E1A',
  'md-surface-container-lowest': '#161914',
  'md-surface-container-low': '#22261F',
  'md-surface-container': '#282C25',
  'md-surface-container-high': '#333830',
  'md-surface-container-highest': '#3E443B',
  'md-on-surface': '#EDE8DC',
  'md-on-surface-variant': '#C8C2B5',
  'md-outline': '#8F958A',
  'md-outline-variant': '#4A5046',
  'md-error': '#F0B4AA',
  'md-error-container': '#8A2E28',
  'md-on-error-container': '#F7DAD4',
  'md-on-error': '#42120E',
  'md-press-overlay': 'rgba(255, 255, 255, .10)',
  'md-elev-1': '0 2rpx 6rpx rgba(0, 0, 0, .40)',
  'md-elev-2': '0 4rpx 14rpx rgba(0, 0, 0, .50)',
  'md-elev-3': '0 10rpx 28rpx rgba(0, 0, 0, .60)'
};
const TOKENS = Object.keys(LIGHT);

// 原生外壳配色 = theme.json 的 light / dark 两套（运行时手动切换时必须用 API 覆盖，theme.json 只跟系统）
const CHROME = {
  light: {
    navBg: '#5E8F87', navFront: '#ffffff',
    windowBg: '#F4F0E6', bgText: 'dark',
    tabColor: '#8B948B', tabSelected: '#5E8F87', tabBg: '#FFFCF6', tabBorder: 'black'
  },
  dark: {
    navBg: '#1B1E1A', navFront: '#ffffff',
    windowBg: '#1B1E1A', bgText: 'light',
    tabColor: '#C8C2B5', tabSelected: '#9BC9BB', tabBg: '#22261F', tabBorder: 'white'
  }
};

// 归一模式：非法/空 → system（读旧值/被篡改时不炸）
function normMode(v) {
  const s = String(v == null ? '' : v);
  return MODE_KEYS.indexOf(s) >= 0 ? s : 'system';
}

// 读取本机偏好（未设置 = 跟随系统）
function getMode() {
  try {
    const v = wx.getStorageSync(STORAGE_KEY);
    return normMode(v);
  } catch (e) { return 'system'; }
}

// 写本机偏好；返回归一后的模式（非法入参不写、返回当前值）
function setMode(m) {
  const v = normMode(m);
  if (MODE_KEYS.indexOf(String(m == null ? '' : m)) < 0) return getMode();
  try { wx.setStorageSync(STORAGE_KEY, v); } catch (e) { /* 存储失败：本次运行仍按新值生效 */ }
  return v;
}

// 当前系统主题：'light' | 'dark'（取不到按浅色；app.json 已开 darkmode）
function systemTheme() {
  try {
    const bi = wx.getAppBaseInfo ? wx.getAppBaseInfo() : null;
    if (bi && bi.theme) return bi.theme === 'dark' ? 'dark' : 'light';
  } catch (e) { /* ignore */ }
  try {
    const si = wx.getSystemInfoSync ? wx.getSystemInfoSync() : null;
    if (si && si.theme) return si.theme === 'dark' ? 'dark' : 'light';
  } catch (e) { /* ignore */ }
  return 'light';
}

// 实际生效主题：显式浅/深按偏好，跟随系统按系统
function resolved() {
  const m = getMode();
  return m === 'system' ? systemTheme() : m;
}

// 页面根节点内联样式（page-meta page-style 的值）：
//   * 跟随系统 → ''（交给 app.wxss 的 prefers-color-scheme，首帧不闪、原生媒体查询继续生效）；
//   * 浅/深 → 整组 --md-* token + color-scheme（覆盖 app.wxss 在 page 上的声明；子元素继承）。
function styleOf(dark) {
  const t = dark ? DARK : LIGHT;
  const parts = TOKENS.map(function (k) { return '--' + k + ':' + t[k]; });
  parts.push('color-scheme:' + (dark ? 'dark' : 'light'));
  return parts.join(';') + ';';
}

// 一次性算出「模式 / 实际主题 / 内联样式 / 暗色类」：
// 以前 pageStyle() + themeClass() + applyChrome() 各自重复 getStorageSync/getAppBaseInfo，
// 每个页面每次 onShow 要 6–7 次同步桥调用；现在每次 onShow 只读一次 storage。
function stateOf() {
  const mode = getMode();
  const theme = mode === 'system' ? systemTheme() : mode;
  return {
    mode: mode,
    theme: theme,
    style: mode === 'system' ? '' : styleOf(theme === 'dark'),
    cls: theme === 'dark' ? 'theme-dark' : ''
  };
}

function pageStyle() {
  return stateOf().style;
}

// 页面级暗色标记：页面 WXSS 里「页面自有 token / 深色 hero」用 .theme-dark 覆盖（跟随 resolved()，
// 不再依赖 @media，否则「显式浅色 + 系统深色」时局部仍是暗色）。
function themeClass() {
  return stateOf().cls;
}

// tabBar 页（只有这三个页面能成功调用 wx.setTabBarStyle；非 tab 页调用会 fail 并多一次桥调用）
const TAB_ROUTES = { 'pages/index/index': 1, 'pages/all/all': 1, 'pages/me/me': 1 };

// 同步原生外壳：导航栏 / 窗口底色 / 下拉背景 / tabBar
// 同一页面实例 + 同一主题只应用一次（切 tab 回来不再重复 4 次桥调用）；新页面实例仍会应用，
// 因为导航栏颜色是页面级的，不应用会退回 theme.json 的系统色。
function applyChrome(page, st) {
  st = st || stateOf();
  const route = page && page.route ? String(page.route) : '';
  const isTab = route ? !!TAB_ROUTES[route] : true;   // 无 page（主题切换）时按 tab 页全量应用
  const sig = st.theme + '|' + (isTab ? 'tab' : 'page');
  if (page && page.__zqChromeSig === sig) return;
  if (page) page.__zqChromeSig = sig;
  const c = CHROME[st.theme === 'dark' ? 'dark' : 'light'];
  try {
    if (wx.setNavigationBarColor) {
      wx.setNavigationBarColor({
        frontColor: c.navFront, backgroundColor: c.navBg,
        animation: { duration: 0, timingFunc: 'linear' },
        fail: function () { /* 自定义导航页/旧基础库：忽略 */ }
      });
    }
  } catch (e) { /* ignore */ }
  try {
    if (wx.setBackgroundColor) {
      wx.setBackgroundColor({
        backgroundColor: c.windowBg, backgroundColorTop: c.windowBg, backgroundColorBottom: c.windowBg,
        fail: function () { /* 旧基础库：忽略 */ }
      });
    }
  } catch (e) { /* ignore */ }
  try {
    if (wx.setBackgroundTextStyle) {
      wx.setBackgroundTextStyle({ textStyle: c.bgText, fail: function () { /* 旧基础库：忽略 */ } });
    }
  } catch (e) { /* ignore */ }
  try {
    if (isTab && wx.setTabBarStyle) {
      wx.setTabBarStyle({
        color: c.tabColor, selectedColor: c.tabSelected,
        backgroundColor: c.tabBg, borderStyle: c.tabBorder,
        fail: function () { /* 非 tabBar 页面：忽略 */ }
      });
    }
  } catch (e) { /* ignore */ }
}

// 刷新所有现存页面的 themeStyle / themeClass（当前页立即生效，后台页切回时也用最新值）
function notifyPages() {
  let pages = [];
  try { pages = getCurrentPages() || []; } catch (e) { pages = []; }
  const st = stateOf();
  pages.forEach(function (p) {
    try {
      if (!p || typeof p.setData !== 'function') return;
      const d = p.data || {};
      const patch = {};
      if (d.themeStyle !== st.style) patch.themeStyle = st.style;
      if (d.themeClass !== st.cls) patch.themeClass = st.cls;
      if (Object.keys(patch).length) p.setData(patch);
    } catch (e) { /* 单页失败不影响其它页 */ }
  });
}

// 页面级同步（页面 onShow 可再调一次，确保后台切换/系统主题变化后立即一致）
// 只在值真的变了才 setData：绝大多数 onShow 主题没变，避免一次无意义的渲染周期。
function syncPage(page) {
  try {
    if (!page || typeof page.setData !== 'function') return;
    const st = stateOf();
    const d = page.data || {};
    const patch = {};
    if (d.themeStyle !== st.style) patch.themeStyle = st.style;
    if (d.themeClass !== st.cls) patch.themeClass = st.cls;
    if (Object.keys(patch).length) page.setData(patch);
    applyChrome(page, st);
  } catch (e) { /* ignore */ }
}

let _watching = false;
// 监听系统主题变化：只有「跟随系统」需要刷新（显式浅/深不受系统影响）
function watchSystemTheme() {
  if (_watching) return;
  try {
    if (!wx.onThemeChange) return;
    wx.onThemeChange(function () {
      try { if (getMode() !== 'system') return; } catch (e) { return; }
      applyChrome();
      notifyPages();
    });
    _watching = true;
  } catch (e) { /* ignore */ }
}

// 全局包装 Page（app.js 顶部调用一次）：
//   * 注入 data.themeStyle / data.themeClass → 页面首帧就是用户选择的外观（无闪白/闪黑）；
//   * 包装 onShow → 每次回到页面同步原生外壳 + 页面样式；
//   * 失败（构造器不可写/运行时差异）静默降级：页面按系统主题显示，不影响任何功能。
function decoratePages() {
  try {
    if (typeof Page !== 'function') return false;
    if (Page.__zqAppearanceWrapped) return true;
    const rawPage = Page;
    const wrapped = function (def) {
      def = def || {};
      def.data = Object.assign({}, def.data || {});
      const st = stateOf();
      def.data.themeStyle = st.style;
      def.data.themeClass = st.cls;
      const origOnShow = def.onShow;
      def.onShow = function () {
        syncPage(this);   // 已包含「值不变不 setData」+ 首次/主题变化时应用原生外壳
        return origOnShow ? origOnShow.apply(this, arguments) : undefined;
      };
      return rawPage(def);
    };
    wrapped.__zqAppearanceWrapped = true;
    try { Page = wrapped; } catch (e) {
      try { if (typeof global !== 'undefined') global.Page = wrapped; } catch (e2) { return false; }
    }
    watchSystemTheme();
    return Page === wrapped || (typeof global !== 'undefined' && global.Page === wrapped);
  } catch (e) { return false; }
}

// 重置（仅测试用）：清掉偏好并恢复未监听状态
function resetForTest() {
  try { wx.removeStorageSync(STORAGE_KEY); } catch (e) { /* ignore */ }
  _watching = false;
}

module.exports = {
  STORAGE_KEY, MODES, MODE_KEYS, LIGHT, DARK, TOKENS, CHROME, normMode,
  getMode, setMode, systemTheme, resolved, pageStyle, themeClass,
  applyChrome, notifyPages, syncPage, watchSystemTheme, decoratePages, resetForTest
};
