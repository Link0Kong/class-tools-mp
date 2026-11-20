'use strict';
// utils/shareflow.js —— 统一「分享弹层」流程（预览图 + 图片分享 / 微信卡片分享）
//
// 页面用法：
//   Page(shareflow.install({
//     data: {...},
//     _shareOpenOpts() {
//       return {
//         title: '分享标题',
//         view: sharecard.buildXxxView(...),   // 5:4 微信卡片封面
//         posterOpt: { ...canvas.drawCard 参数 } // 可选：图片分享用的完整长图
//       };
//     },
//     onShareAppMessage() { ... imageUrl: this.data.shareImg || FALLBACK ... }
//   }));
//
// install 注入：data.shareSheet/shareBusy/shareImg/sharePoster/shareTitle/shareHint，
// 以及 openShare / closeShare / shareImage 三个方法。页面 WXML 需要：
//   <share-sheet show="{{shareSheet}}" preview="{{shareImg}}" preview-alt="{{sharePoster}}" ... />
//   <canvas type="2d" id="shareCanvas" class="share-canvas"></canvas>
// 有 posterOpt 时还需要页面已有的 <canvas type="2d" id="card" class="exp-canvas"></canvas>。
const canvas = require('./canvas.js');
const sharecard = require('./sharecard.js');
const util = require('./util.js');

// 图片分享：优先调起微信原生「发送给朋友 / 保存到相册」；旧基础库/低版本降级保存相册。
function showImage(path) {
  path = String(path || '');
  if (!path) { util.toast('预览图还没生成，请稍候'); return; }
  if (path.indexOf('/images/') === 0) { util.toast('预览图生成失败，请稍后重试'); return; }
  if (typeof wx.showShareImageMenu === 'function') {
    wx.showShareImageMenu({
      path: path,
      fail: function (err) {
        const msg = String((err && err.errMsg) || '');
        if (/cancel/i.test(msg)) return;
        saveImage(path);
      }
    });
    return;
  }
  saveImage(path);
}

function saveImage(path) {
  wx.saveImageToPhotosAlbum({
    filePath: path,
    success: function () { util.toast('已保存到相册'); },
    fail: function (err) {
      const msg = String((err && err.errMsg) || '');
      if (/cancel/i.test(msg)) return;
      if (/auth|denied|deny/i.test(msg)) {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置中允许「保存到相册」后再分享图片。',
          confirmText: '去设置',
          success: function (r) { if (r && r.confirm && wx.openSetting) wx.openSetting(); }
        });
        return;
      }
      util.toast('图片保存失败');
    }
  });
}

function finishLater(page, fn, ms) {
  return new Promise(function (resolve) {
    let done = false;
    const timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, ms);
    try {
      fn(function (p) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(p || null);
      });
    } catch (e) { if (!done) { done = true; clearTimeout(timer); resolve(null); } }
  });
}

// 小程序同一页面并行导出多张 canvas 时，部分基础库/开发者工具会只成功一张；
// 所有 canvas 导出在这里串行排队，避免卡片封面与长图互相干扰。
let canvasChain = Promise.resolve();
function enqueue(fn) {
  const run = function () { return fn(); };
  const p = canvasChain.then(run, run);
  canvasChain = p.then(function () {}, function () {});
  return p;
}

function renderCard(page, canvasId, view) {
  return enqueue(function () {
    return finishLater(page, function (done) {
      sharecard.render(page, canvasId || 'shareCanvas', view).then(done).catch(function () { done(null); });
    }, 3000);
  });
}

// 长图（完整导出卡）：失败/超时返回 null，页面继续用 5:4 卡片分享。
function renderPoster(page, selector, opt) {
  return enqueue(function () {
    return finishLater(page, function (done) {
      let sel = String(selector || '#card');
      if (sel.charAt(0) !== '#' && sel.charAt(0) !== '.') sel = '#' + sel;
      canvas.exportCard(page, sel, opt).then(done).catch(function () { done(null); });
    }, 8000);
  });
}

// 打开弹层：并行生成 5:4 卡片封面 + 可选完整长图；先出哪个都不阻塞弹层。
function open(page, opts) {
  opts = opts || {};
  if (!page || page._dead) return;
  if (!opts.view && !opts.posterOpt) return;
  if (page.data.shareBusy) return;
  const title = String(opts.title || '班级动态');
  page.setData({
    shareSheet: true,
    shareBusy: true,
    shareImg: '',
    sharePoster: '',
    shareTitle: title,
    shareHint: ''
  }, function () {
    let card = null;
    let poster = null;
    const jobs = [];
    if (opts.view) {
      jobs.push(renderCard(page, opts.cardCanvas, opts.view).then(function (p) { card = p; }));
    }
    if (opts.posterOpt) {
      jobs.push(renderPoster(page, opts.posterCanvas || 'card', opts.posterOpt).then(function (p) { poster = p; }));
    }
    const settle = function () {
      if (page._dead || !page.data.shareSheet) return;
      let hint = '';
      if (!card && !poster) hint = '预览图生成失败，请关闭后重试';
      else if (!card) hint = '卡片封面生成失败，微信卡片将使用默认封面';
      else if (opts.posterOpt && !poster) hint = '长图生成失败，图片分享将发送 5:4 分享图';
      page.setData({
        shareImg: card || '',
        sharePoster: poster || '',
        shareBusy: false,
        shareHint: hint
      });
    };
    Promise.all(jobs).then(settle, settle);
  });
}

function close(page) {
  if (!page) return;
  page.setData({ shareSheet: false, shareImg: '', sharePoster: '', shareBusy: false, shareHint: '' });
}

// 图片分享：优先完整长图；长图失败时退回 5:4 卡片。
function shareImage(page) {
  if (!page) return;
  const path = page.data.sharePoster || page.data.shareImg;
  if (page.data.shareBusy) { util.toast('预览图生成中，请稍候'); return; }
  showImage(path);
}

// 给 Page 注入分享弹层需要的 data 与三个方法；页面只需实现 _shareOpenOpts()。
function install(def) {
  def = def || {};
  def.data = Object.assign({
    shareSheet: false,
    shareBusy: false,
    shareImg: '',
    sharePoster: '',
    shareTitle: '',
    shareHint: ''
  }, def.data || {});
  if (typeof def._shareOpenOpts !== 'function') def._shareOpenOpts = function () { return {}; };
  if (typeof def.openShare !== 'function') def.openShare = function () { open(this, this._shareOpenOpts()); };
  if (typeof def.closeShare !== 'function') def.closeShare = function () { close(this); };
  if (typeof def.shareImage !== 'function') def.shareImage = function () { shareImage(this); };
  return def;
}

module.exports = {
  open: open,
  close: close,
  showImage: showImage,
  saveImage: saveImage,
  renderCard: renderCard,
  renderPoster: renderPoster,
  shareImage: shareImage,
  install: install
};
