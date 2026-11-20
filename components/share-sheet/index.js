'use strict';
// components/share-sheet —— 统一分享弹层（2026-11-20）
// 预览区：5:4 微信卡片封面；有完整长图时提供「微信卡片封面 / 分享长图」切换。
// 操作区：图片分享（页面触发 shareflow.showImage）、微信卡片分享（原生 open-type=share）。
// 微信卡片按钮在页面里触发 onShareAppMessage；页面通过 data.shareImg 提供封面。
const DEFAULT_TIP = '分享图不含学号、手机号与附件原文；姓名/内容仅来自页面已展示字段。';

Component({
  properties: {
    show: { type: Boolean, value: false },
    sheetTitle: { type: String, value: '分享' },
    preview: { type: String, value: '' },
    previewAlt: { type: String, value: '' },
    titleText: { type: String, value: '' },
    busy: { type: Boolean, value: false },
    hint: { type: String, value: '' },
    imageLabel: { type: String, value: '图片分享' },
    imageSub: { type: String, value: '' },
    cardLabel: { type: String, value: '微信卡片分享' },
    cardSub: { type: String, value: '好友点卡片可直接打开' },
    tip: { type: String, value: DEFAULT_TIP },
    shareKey: { type: String, value: '' }
  },
  data: {
    previewMode: 'card'
  },
  observers: {
    'show, preview, previewAlt': function (show, preview, previewAlt) {
      if (!show) return;
      this.setData({ previewMode: (!preview && previewAlt) ? 'image' : 'card' });
    }
  },
  methods: {
    noop() {},
    onClose() { this.triggerEvent('close'); },
    pickMode(e) {
      const m = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.m) || 'card');
      this.setData({ previewMode: m === 'image' ? 'image' : 'card' });
    },
    onImage() {
      if (this.data.busy) return;
      this.triggerEvent('image');
    }
  }
});
