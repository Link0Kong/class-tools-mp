// pages/votedetail/votedetail.js —— 投票详情 / 投票 / 结果 / 管理（v2.0.0 增量，2026-11-11）
//
// 契约唯一真源：web/vote/CONTRACT.md
//   §2.3 poll_detail / poll_submit 返回结构（closed/total/counts/has_voted/my_choices/results_hidden/mine/can_manage/voters）
//   §2.4 poll_manage（edit 仅无票 / close 提前结束 / extend 延长·重开 / delete 软删；全部带确认）
//   §4.2 详情页：倒计时、选项勾选、提交/改票、结果百分比条、实名投票人、可见范围标签、管理入口；
//        轮询：页面可见且详情打开时 5s（限时 quick 或截止 <6h）/10s（其它）；onHide 停、onShow 恢复；
//        失败兜底 toast「网络不可用，稍后重试」，保留已渲染内容，不白屏。
//   §1.6 可见范围（2026-11-11 18:08 增量）：服务端 poll_detail 返回 poll.audience/audience_count，
//        这里通过 utils/vote.js detailView 的 tags 渲染「班委可见 / 团员可见 / 指定 N 人」（all 不显示）；
//        编辑入口跳 pages/vote?edit=<id>，由 vote 页按 poll.audience_seats 回填范围（座号，不出现学号）。
//
// 隐私：页面只渲染 RPC 返回的姓名（owner_name / voters.name），绝不展示学号；
//       匿名投票（settings.anonymous）不渲染投票人列表（服务端也不会返回 voters）。
const identity = require('../../utils/identity.js');
const cloud = require('../../utils/cloud.js');
const vote = require('../../utils/vote.js');
const util = require('../../utils/util.js');
const share = require('../../utils/share.js');

const ROUTE = 'pages/votedetail/votedetail';
const QUICK_EXTEND = [5, 10, 30, 60, 120];

Page({
  data: {
    state: 'loading',        // loading | ready | denied | error
    errorText: '',
    id: '',
    d: null,                 // utils/vote.js detailView 视图模型
    choices: [],             // 当前勾选（选项 id）
    submitting: false,
    extendOpen: false,       // 延长 / 重开弹层
    extQuick: 30,
    extQuickOpts: QUICK_EXTEND,
    extDate: '',
    extTime: ''
  },

  onLoad(options) {
    this._dead = false;
    this._hidden = false;
    this._loaded = false;
    this._loading = false;
    this._detail = null;      // 最近一次 poll_detail / poll_submit 原始返回
    this._choices = [];
    this._dirty = false;      // 用户已改勾选：轮询回包不覆盖当前选择
    this._failN = 0;
    this._pollT = null;
    this._tick = null;
    this._endedReloaded = false;
    this._denied = !identity.has();
    let id = String((options && options.id) || '');
    try { id = decodeURIComponent(id); } catch (e) { /* 保持原串 */ }
    this._id = id;
    this.setData({ id: id });
    if (this._denied) { this.setData({ state: 'denied' }); return; }
    if (!id) { this.setData({ state: 'error', errorText: '缺少投票参数' }); return; }
    this.setData({ state: 'loading' });
  },

  onShow() {
    share.enable();
    if (!identity.ensure()) return;
    this._dead = false;
    this._hidden = false;
    if (!this._id) return;
    this.load(!this._loaded);
    this._startTick();
    this._schedulePoll();
  },
  onHide() { this._hidden = true; this._stopPoll(); this._stopTick(); },
  onUnload() { this._dead = true; this._hidden = true; this._stopPoll(); this._stopTick(); },
  onPullDownRefresh() {
    this.load(true).then(function () {
      try { wx.stopPullDownRefresh(); } catch (e) { /* ignore */ }
    });
  },

  /* ---------------- 轮询（5s 限时 / 10s 长时、不限时；onHide 停、onShow 恢复） ---------------- */
  _visible() {
    try {
      const pages = getCurrentPages();
      const cur = pages[pages.length - 1];
      return !cur || cur.route === ROUTE;
    } catch (e) { return true; }
  },
  _schedulePoll() {
    this._stopPoll();
    // _hidden：onHide 之后到达的请求回调不得再排定时器（onShow 会重新排）
    if (this._dead || this._hidden || !this._detail) return;
    const self = this;
    const ms = vote.pollIntervalOf(this._detail, Date.now());
    this._pollT = setTimeout(function () {
      self._pollT = null;
      if (self._dead || self._hidden || !self._visible()) return;
      self.load(false);
    }, ms);
  },
  _stopPoll() { if (this._pollT) { clearTimeout(this._pollT); this._pollT = null; } },
  _startTick() {
    this._stopTick();
    const self = this;
    this._tick = setInterval(function () {
      self._tickCountdown();
    }, 1000);
  },
  _stopTick() { if (this._tick) { clearInterval(this._tick); this._tick = null; } },
  _tickCountdown() {
    if (this._dead) { this._stopTick(); return; }
    const d = this.data.d;
    if (!d || !this._detail) return;
    const p = this._detail.poll || {};
    const closedNow = d.closed || vote.isClosed(p, Date.now());
    const dl = vote.deadlineOf(p);
    const text = closedNow ? '已截止' : (dl > 0 ? vote.countdownText(p, Date.now()) : '不限时');
    if (text !== d.countdownText) {
      this.setData({ 'd.countdownText': text });
      // 到点：刷新一次拿到服务端口径（closed/canVote/结果可见性都可能变化），只触发一次
      if (closedNow && !d.closed && !this._endedReloaded) {
        this._endedReloaded = true;
        this.load(true);
      }
    }
  },

  /* ---------------- 详情加载（失败保留已渲染内容） ---------------- */
  load(force) {
    if (!this._id) return Promise.resolve(false);
    if (!identity.has()) { this.setData({ state: 'denied' }); return Promise.resolve(false); }
    if (this._loading) return Promise.resolve(false);
    this._loading = true;
    if (force && !this.data.d) this.setData({ state: 'loading' });
    const self = this;
    const onFail = function (reason) {
      if (self._dead) return;
      self._failN += 1;
      if (!self.data.d) {
        self.setData({ state: 'error', errorText: reason || '网络不可用，稍后重试' });
      } else {
        if (force || self._failN === 1) util.toast('网络不可用，稍后重试');
        self.setData({ errorText: reason || '' });
      }
      self._schedulePoll();
    };
    return cloud.pollDetail(this._id).then(function (r) {
      self._loading = false;
      if (self._dead) return false;
      if (r && r.ok && r.poll) {
        self._failN = 0;
        self._loaded = true;
        self._detail = r;
        if (!self._dirty) self._choices = (Array.isArray(r.my_choices) ? r.my_choices : []).map(String);
        self._endedReloaded = false;
        self._render();
        self._schedulePoll();
        return true;
      }
      onFail((r && r.reason) || '网络不可用，稍后重试');
      return false;
    }).catch(function () {
      self._loading = false;
      onFail('网络不可用，稍后重试');
      return false;
    });
  },
  _render() {
    if (!this._detail) return;
    const v = vote.detailView(this._detail, { now: Date.now(), choices: this._choices });
    if (!v) { this.setData({ state: 'error', errorText: '投票数据不完整' }); return; }
    this.setData({ state: 'ready', d: v, choices: v.selected, errorText: '' });
  },
  retryLoad() {
    this.setData({ state: 'loading', errorText: '' });
    this._loaded = false;
    this.load(true);
  },

  /* ---------------- 勾选 / 提交·改票 ---------------- */
  pickOption(e) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    const d = this.data.d;
    if (!d || !id) return;
    if (!d.canVote) {
      util.toast(d.closed ? '投票已结束' : (d.hasVoted ? '已投过票，不可改票' : '当前不可投票'));
      return;
    }
    const r = vote.toggleChoice(this._choices, id, d.settings);
    if (!r.ok) { util.toast(r.reason); return; }
    this._choices = r.choices;
    this._dirty = true;
    this._render();
  },
  submitVote() {
    const d = this.data.d;
    if (!d || this.data.submitting) return;
    if (!d.canVote) {
      util.toast(d.closed ? '投票已结束' : (d.hasVoted ? '已投过票，不可改票' : '当前不可投票'));
      return;
    }
    const chk = vote.validateChoices(this._choices, d.options, d.settings);
    if (!chk.ok) { util.toast(chk.reason); return; }
    const wasVoted = !!d.hasVoted;
    this.setData({ submitting: true });
    const self = this;
    cloud.pollSubmit(this._id, this._choices).then(function (r) {
      if (self._dead) return;
      self.setData({ submitting: false });
      if (!r.ok) {
        util.toast(r.reason || '提交失败');
        // 已结束 / 不可改票 / 服务端拒绝：拉一次最新详情，把按钮与结果状态同步为服务端口径
        if (/(结束|不可改票|已投过)/.test(String(r.reason || ''))) self.load(true);
        return;
      }
      self._detail = r;
      self._dirty = false;
      self._choices = (Array.isArray(r.my_choices) ? r.my_choices : []).map(String);
      self._render();
      util.toast(wasVoted ? '已改票' : '已投票');
      self._schedulePoll();
    }).catch(function () {
      if (self._dead) return;
      self.setData({ submitting: false });
      util.toast('网络不可用，稍后重试');
    });
  },

  /* ---------------- 管理（全部带 wx.showModal 确认） ---------------- */
  manageEdit() {
    const d = this.data.d;
    if (!d) return;
    if (!d.canEdit) { util.toast(d.total > 0 ? '已有投票，不能编辑' : '无权编辑'); return; }
    const self = this;
    wx.showModal({
      title: '编辑投票',
      content: '编辑「' + (d.title || '投票') + '」的标题、选项、规则与截止时间？保存后立即生效。',
      confirmText: '编辑',
      success: function (res) {
        if (!res || !res.confirm) return;
        wx.navigateTo({ url: '/pages/vote/vote?edit=' + encodeURIComponent(self._id) });
      }
    });
  },
  manageClose() {
    const d = this.data.d;
    if (!d || !d.canClose) return;
    const self = this;
    wx.showModal({
      title: '提前结束',
      content: '提前结束「' + (d.title || '投票') + '」？结束后不能再投票，结果会保留。',
      confirmText: '结束',
      confirmColor: '#B87870',
      success: function (res) {
        if (!res || !res.confirm) return;
        self._manage({ action: 'close' }, '已结束');
      }
    });
  },
  manageDelete() {
    const d = this.data.d;
    if (!d || !d.canDelete) return;
    const self = this;
    wx.showModal({
      title: '删除投票',
      content: '删除「' + (d.title || '投票') + '」？删除后全班不再看到该投票。',
      confirmText: '删除',
      confirmColor: '#B87870',
      success: function (res) {
        if (!res || !res.confirm) return;
        self._manage({ action: 'delete' }, '已删除', true);
      }
    });
  },
  _manage(payload, okText, back) {
    const self = this;
    const body = Object.assign({ id: this._id }, payload || {});
    cloud.pollManage(body).then(function (r) {
      if (self._dead) return;
      if (!r.ok) { util.toast(r.reason || '操作失败'); return; }
      util.toast(okText || '已操作');
      if (back) self._back();
      else self.load(true);
    }).catch(function () {
      if (self._dead) return;
      util.toast('网络不可用，稍后重试');
    });
  },
  _back() {
    let pages = [];
    try { pages = getCurrentPages() || []; } catch (e) { pages = []; }
    if (pages.length > 1) { wx.navigateBack({ delta: 1 }); return; }
    wx.switchTab({ url: '/pages/all/all' });
  },

  /* ---------------- 延长 / 重开弹层 ---------------- */
  openExtend() {
    const d = this.data.d;
    if (!d || !d.canExtend) return;
    const dl = vote.quickDeadline(30, Date.now());
    this.setData({ extendOpen: true, extQuick: 30, extDate: vote.dateStrOf(dl), extTime: vote.timeStrOf(dl) });
  },
  closeExtend() { this.setData({ extendOpen: false }); },
  noop() { /* 弹层内点击阻止冒泡 */ },
  pickExtQuick(e) {
    const m = parseInt(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.min, 10);
    if (!isFinite(m) || QUICK_EXTEND.indexOf(m) < 0) return;
    this.setData({ extQuick: m });
  },
  onExtDate(e) {
    const v = String((e && e.detail && e.detail.value) || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    this.setData({ extDate: v, extQuick: 0 });
  },
  onExtTime(e) {
    const v = String((e && e.detail && e.detail.value) || '');
    if (!/^\d{1,2}:\d{2}$/.test(v)) return;
    this.setData({ extTime: v, extQuick: 0 });
  },
  confirmExtend() {
    const now = Date.now();
    const deadline = this.data.extQuick > 0
      ? vote.quickDeadline(this.data.extQuick, now)
      : vote.parseDeadline(this.data.extDate, this.data.extTime);
    if (!deadline) { util.toast('请选择截止时间'); return; }
    if (deadline <= now) { util.toast('截止时间需要晚于当前时间'); return; }
    const closed = !!(this.data.d && this.data.d.closed);
    const self = this;
    wx.showModal({
      title: closed ? '重开投票' : '延长截止',
      content: (closed ? '重开到 ' : '延长到 ') + vote.fmtDateTime(deadline) + '？',
      confirmText: '确定',
      success: function (res) {
        if (!res || !res.confirm) return;
        self.setData({ extendOpen: false });
        self._manage({ action: 'extend', deadline: deadline }, closed ? '已重开' : '已延长');
      }
    });
  },

  goAll() { wx.switchTab({ url: '/pages/all/all' }); },

  onShareAppMessage() {
    return share.message({
      title: '班级工具｜投票',
      path: '/pages/votedetail/votedetail?id=' + encodeURIComponent(this._id || ''),
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '班级工具｜投票 · 实时结果',
      query: this._id ? ('id=' + encodeURIComponent(this._id)) : '',
      imageUrl: '/images/share/default.png'
    });
  }
});
