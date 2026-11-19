// pages/drawrec/drawrec.js —— 抽签记录：今日/全部列表 + 存证详情/核验（契约 web/draw/CONTRACT.md §3.2/§3.4/§4）
//
// 入口：pages/draw「抽签记录」/「查看存证」→ 本页；也可深链 `?id=<recordId>` 直接打开详情（分享卡片同路径）。
// 数据：全部来自云端 4 个 RPC（draw_record_get / draw_record_list，封装在 utils/drawproof.js）；
//       列表/详情都**不显示学号**（记录只存序号 + 自定义名称；操作人只显示姓名 + 座号，来自 RPC op_name/op_seat）。
//       初始结果里的班级名单姓名由本机 class_members 派生文本本地解析（不进云端，与网页 §3.4 同口径）。
// 详情：参数 / 初始结果 / 剔除重抽时间线 / 算法自检（draw-v1 复算）/ 哈希 / 二维码（verifyUrl）+ 复制核验链接。
const identity = require('../../utils/identity.js');
const store = require('../../utils/store.js');
const drawproof = require('../../utils/drawproof.js');
const util = require('../../utils/util.js');
const share = require('../../utils/share.js');

const NET_ERR = '网络不可用，稍后重试';

Page({
  data: {
    state: 'loading',        // loading | ready | error | denied
    errorText: '',
    scope: 'today',          // today | all
    scopeText: '今日',
    rows: [],
    countText: '',
    todayText: '',
    dayText: '',
    detail: null,            // utils/drawproof.js detailView 视图模型
    detailId: '',
    fromList: false,         // 从列表点进来 → 详情页显示「返回列表」
    qrFail: false
  },

  onLoad(options) {
    this._dead = false;
    this._loaded = false;
    this._loading = false;
    this._pendingList = false;
    this._id = '';
    options = options || {};
    let id = String(options.id || '');
    try { id = decodeURIComponent(id); } catch (e) { /* 保持原串 */ }
    this._id = id;
    if (!identity.has()) { this.setData({ state: 'denied' }); return; }
    if (id) this.setData({ state: 'loading', detailId: id });
    else this.setData({ state: 'loading' });
  },
  onShow() {
    share.enable();
    if (!identity.ensure()) return;
    this._dead = false;
    // 身份页返回/刚完成验证：清掉 denied 态重新加载
    if (this.data.state === 'denied') { this._loaded = false; this.setData({ state: 'loading' }); }
    if (this._id) this.loadDetail(this._id, !this._loaded);
    else this.loadList(!this._loaded);      // 列表返回时也刷一次（刚抽完签能看到新记录），失败静默保留列表
  },
  onHide() { /* 无轮询：进入即拉，可下拉刷新 */ },
  onUnload() { this._dead = true; },
  onPullDownRefresh() {
    const p = this._id ? this.loadDetail(this._id, true) : this.loadList(true);
    Promise.resolve(p).then(function () {
      try { wx.stopPullDownRefresh(); } catch (e) { /* ignore */ }
    });
  },

  /* ---------------- 列表（契约 §3.2：今日/全部 + 时间/第seq次/参数摘要/结果/操作人） ---------------- */
  loadList(force) {
    if (this._loading) { this._pendingList = true; return Promise.resolve(false); }
    this._loading = true;
    if (force && !this.data.rows.length) this.setData({ state: 'loading' });
    const self = this;
    const done = function () {
      if (self._pendingList && !self._dead) { self._pendingList = false; self.loadList(true); }
    };
    return drawproof.recordList(this.data.scope, 30).then(function (r) {
      self._loading = false;
      if (self._dead) return false;
      if (!r || !r.ok) {
        const reason = (r && r.reason) || NET_ERR;
        if (!self.data.rows.length) self.setData({ state: 'error', errorText: reason });
        else util.toast(reason);
        done();
        return false;
      }
      if (self._id) { done(); return false; }   // 期间已切到详情：不覆盖详情视图
      self._loaded = true;
      const v = drawproof.listView(r);
      self.setData({
        state: 'ready', rows: v.rows, countText: v.countText, todayText: v.todayText,
        dayText: v.dayText, errorText: ''
      });
      done();
      return true;
    }).catch(function () {
      self._loading = false;
      if (self._dead) return false;
      if (!self.data.rows.length) self.setData({ state: 'error', errorText: NET_ERR });
      done();
      return false;
    });
  },
  switchScope(e) {
    const scope = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.scope) || 'today');
    if (scope !== 'all' && scope !== 'today') return;
    if (scope === this.data.scope) return;
    this.setData({ scope: scope, scopeText: scope === 'all' ? '全部' : '今日', rows: [], countText: '', state: 'loading' });
    this.loadList(true);
  },
  retryLoad() {
    if (this._id) { this.setData({ state: 'loading' }); this.loadDetail(this._id, true); return; }
    this.setData({ state: 'loading' }); this.loadList(true);
  },
  openRecord(e) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    if (!id) return;
    this._id = id;
    this.setData({ fromList: true, detailId: id, state: 'loading' });
    this.loadDetail(id, true);
  },
  backToList() {
    this._id = '';
    this.setData({ detail: null, detailId: '', fromList: false, qrFail: false, state: 'loading' });
    this.loadList(true);
  },
  goBack() {
    let pages = [];
    try { pages = getCurrentPages() || []; } catch (e) { pages = []; }
    if (pages.length > 1) { wx.navigateBack({ delta: 1 }); return; }
    wx.switchTab({ url: '/pages/all/all' });
  },

  /* ---------------- 详情 / 核验（契约 §3.4） ---------------- */
  loadDetail(id, showLoading) {
    if (!id) return Promise.resolve(false);
    if (!identity.has()) { this.setData({ state: 'denied' }); return Promise.resolve(false); }
    if (showLoading && !this.data.detail) this.setData({ state: 'loading' });
    const self = this;
    return drawproof.recordGet(id).then(function (r) {
      if (self._dead) return false;
      if (!r || !r.ok || !r.record) {
        self.setData({ state: 'error', errorText: (r && r.reason) || '记录不存在' });
        return false;
      }
      self._loaded = true;
      const v = drawproof.detailView(r.record, { rosterText: String((store.get() || {}).roster || '') });
      self.setData({ state: 'ready', detail: v, detailId: v.id, errorText: '', qrFail: false }, function () {
        self._drawQr(v.verifyUrl);
      });
      return true;
    }).catch(function () {
      if (self._dead) return false;
      self.setData({ state: 'error', errorText: NET_ERR });
      return false;
    });
  },
  copyVerify() {
    const d = this.data.detail;
    if (!d || !d.verifyUrl) return;
    util.copyText(d.verifyUrl);
    util.toast('已复制核验链接');
  },
  copyId() {
    const d = this.data.detail;
    if (!d || !d.id) return;
    util.copyText(d.id);
    util.toast('已复制存证编号');
  },

  /* ---------------- 二维码（记录详情页 canvas 2d，与导出图同一 qr.js 生成器） ---------------- */
  _drawQr(url) {
    const qm = drawproof.qrMatrix(url);
    if (!qm) { this.setData({ qrFail: true }); return; }
    const self = this;
    const run = function () { self._paintQr(qm); };
    try {
      if (typeof wx.nextTick === 'function') wx.nextTick(run);
      else setTimeout(run, 30);
    } catch (e) { setTimeout(run, 30); }
  },
  _paintQr(qm) {
    if (this._dead) return;
    const self = this;
    try {
      const q = wx.createSelectorQuery().in(this);
      q.select('#dqr').fields({ node: true, size: true }).exec(function (res) {
        const node = res && res[0] && res[0].node;
        if (!node) { self.setData({ qrFail: true }); return; }
        try {
          const g = node.getContext('2d');
          let dpr = 2;
          try { dpr = (wx.getSystemInfoSync() || {}).pixelRatio || 2; } catch (e) { /* 默认 2 */ }
          const w = (res[0].width || 160), h = (res[0].height || 160);
          node.width = Math.round(w * dpr);
          node.height = Math.round(h * dpr);
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.scale(dpr, dpr);
          g.fillStyle = '#FFFFFF';
          g.fillRect(0, 0, w, h);
          drawproof.paintQr(g, qm, 0, 0, Math.min(w, h), '#303A35');
        } catch (e) { self.setData({ qrFail: true }); }
      });
    } catch (e) { this.setData({ qrFail: true }); }
  },

  /* ---------------- 分享（详情深链 ?id=） ---------------- */
  onShareAppMessage() {
    const id = this.data.detailId || '';
    const n = this.data.detail && this.data.detail.rows ? this.data.detail.rows.length : 0;
    return share.message({
      title: n ? ('抽签结果 · ' + n + ' 个 · 可核验') : '班级抽签存证 · 可核验',
      path: '/pages/drawrec/drawrec' + (id ? ('?id=' + encodeURIComponent(id)) : ''),
      imageUrl: '/images/share/draw.png'
    });
  },
  onShareTimeline() {
    const id = this.data.detailId || '';
    const n = this.data.detail && this.data.detail.rows ? this.data.detail.rows.length : 0;
    return share.timeline({
      title: n ? ('抽签结果 · ' + n + ' 个 · 可核验') : '班级抽签存证 · 可核验',
      query: id ? ('id=' + encodeURIComponent(id)) : '',
      imageUrl: '/images/share/draw.png'
    });
  }
});
