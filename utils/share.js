// utils/share.js —— 微信原生分享统一入口（转发给朋友 / 分享到朋友圈）
//
// 用法：每个页面 onShow 里调 share.enable()（打开原生「···」菜单的 转发 / 分享到朋友圈），
// 页面自带：
//   onShareAppMessage() { return share.message({ title: '...', path: '/pages/xx/xx', query: 'k=v', imageUrl: '/images/share/xx.png' }); }
//   onShareTimeline()   { return share.timeline({ title: '...', query: 'k=v', imageUrl: '/images/share/xx.png' }); }
//
// 说明：
// - 不在页面里放自定义「分享」按钮，直接用微信自带菜单（右上角 ··· → 转发 / 分享到朋友圈），原生分享卡片会拿到
//   title / path / imageUrl；分享到朋友圈只带 title / query / imageUrl（打开的是当前页）。
// - imageUrl 用代码包内 5:4 封面（images/share/*.png，见 mp-class-tools-tests/make_share_images.py）；
//   不传 imageUrl 时微信会截当前页面首屏，滚动状态不好看，所以这里默认给品牌封面。
const DEFAULT_TITLE = '班级工具｜课表 · 作业 · 通知 · 抽签';
const DEFAULT_IMG = '/images/share/default.png';

// query：对象或 'k=v&k2=v2' 字符串 → 带前导 '?' 的串（空返回 ''）
function qs(query) {
  if (!query) return '';
  if (typeof query === 'string') {
    const s = query.trim().replace(/^\?/, '');
    return s ? '?' + s : '';
  }
  const parts = Object.keys(query)
    .filter(function (k) { return query[k] !== null && query[k] !== undefined && query[k] !== ''; })
    .map(function (k) { return k + '=' + encodeURIComponent(query[k]); });
  return parts.length ? '?' + parts.join('&') : '';
}

// 打开原生分享菜单（转发 + 朋友圈）；不支持 menus 的旧基础库自动降级为默认转发
function enable() {
  try {
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] });
  } catch (e) {
    try { wx.showShareMenu({ withShareTicket: true }); } catch (e2) { /* 忽略 */ }
  }
}

// onShareAppMessage 返回值：{ title, path, imageUrl }
function message(cfg) {
  cfg = cfg || {};
  return {
    title: cfg.title || DEFAULT_TITLE,
    path: (cfg.path || '/pages/index/index') + qs(cfg.query),
    imageUrl: cfg.imageUrl || DEFAULT_IMG
  };
}

// onShareTimeline 返回值：{ title, query, imageUrl }（朋友圈打开当前页，不需要 path）
function timeline(cfg) {
  cfg = cfg || {};
  const query = typeof cfg.query === 'string'
    ? cfg.query.trim().replace(/^\?/, '')
    : qs(cfg.query).replace(/^\?/, '');
  return {
    title: cfg.timelineTitle || cfg.title || DEFAULT_TITLE,
    query: query,
    imageUrl: cfg.imageUrl || DEFAULT_IMG
  };
}

module.exports = { DEFAULT_TITLE: DEFAULT_TITLE, DEFAULT_IMG: DEFAULT_IMG, qs: qs, enable: enable, message: message, timeline: timeline };
