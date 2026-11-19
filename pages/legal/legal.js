// pages/legal/legal.js —— 隐私政策 / 用户协议（原生正文，2026-11-19）
//
// 需求 2：小程序端要有可阅读的隐私政策 / 用户协议入口和正文，不能只放不可用的外链。
// 实现：
//   * 正文来自 utils/legal-data.js（由 web/legal/mp/{privacy,terms}.html 提取，版本 V1.0 / 生效 2026-11-17）；
//   * 原生页面渲染 + 页面滚动，不依赖外部网页 / request 域名 / 外链；
//   * 入口：身份页协议勾选、我的 → 数据与隐私、数据与隐私页；
//   * 支持 /pages/legal/legal?type=privacy|terms，缺省 privacy；分享仍走 utils/share.js。
const legal = require('../../utils/legal-data.js');
const share = require('../../utils/share.js');

const TYPES = { privacy: 1, terms: 1 };

function safeType(v) {
  const t = String(v || '');
  return TYPES[t] ? t : 'privacy';
}

Page({
  data: {
    type: 'privacy',
    head: null,
    blocks: [],
    toc: [],
    ready: false
  },

  onLoad(options) {
    this._dead = false;
    options = options || {};
    const type = safeType(options.type);
    this._apply(type, false);
  },
  onShow() {
    share.enable();
  },
  onUnload() { this._dead = true; },

  _apply(type, scrollTop) {
    const t = safeType(type);
    const doc = legal[t];
    if (!doc) {
      this.setData({ ready: false, type: t });
      return;
    }
    // 只把头部字段放进 data：doc 本身已包含 blocks/toc，若整体 setData 会把 80KB 正文重复传 3 份。
    const head = {
      code: doc.code, title: doc.title, meta: doc.meta || [], lead: doc.lead || '',
      basis: doc.basis || [], version: doc.version || '', effective: doc.effective || '', operator: doc.operator || ''
    };
    this.setData({ type: t, head: head, blocks: doc.blocks || [], toc: doc.toc || [], ready: true });
    try { wx.setNavigationBarTitle({ title: doc.title }); } catch (e) { /* 旧基础库/单测无此 API */ }
    if (scrollTop) {
      try { wx.pageScrollTo({ scrollTop: 0, duration: 0 }); } catch (e) { /* ignore */ }
    }
  },

  switchDoc(e) {
    const t = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.type) || '');
    if (!TYPES[t] || t === this.data.type) return;
    this._apply(t, true);
  },
  jump(e) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    if (!id) return;
    try {
      wx.pageScrollTo({ selector: '#lg-' + id, duration: 250 });
    } catch (err) {
      // 极旧基础库不支持 selector：退化为回到顶部（正文仍可手动滚动）
      try { wx.pageScrollTo({ scrollTop: 0, duration: 0 }); } catch (e) { /* ignore */ }
    }
  },
  back() {
    let pages = [];
    try { pages = getCurrentPages() || []; } catch (e) { pages = []; }
    if (pages.length > 1) { wx.navigateBack({ delta: 1 }); return; }
    wx.switchTab({ url: '/pages/all/all' });
  },

  onShareAppMessage() {
    const t = this.data.type;
    const title = (this.data.head && this.data.head.title) ? (this.data.head.title + '｜班级工具') : '班级工具｜隐私政策与用户协议';
    return share.message({
      title: title,
      path: '/pages/legal/legal',
      query: 'type=' + encodeURIComponent(t),
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline() {
    const t = this.data.type;
    const title = (this.data.head && this.data.head.title) ? (this.data.head.title + '｜班级工具') : '班级工具｜隐私政策与用户协议';
    return share.timeline({
      title: title,
      query: 'type=' + encodeURIComponent(t),
      imageUrl: '/images/share/default.png'
    });
  }
});
