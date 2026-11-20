// pages/vote/vote.js —— 「投票」列表 + 发起/编辑（v2.0.0 增量，2026-11-11）
//
// 契约唯一真源：web/vote/CONTRACT.md
//   §1 数据模型（标题 1–80 / 说明 ≤500 / 选项 2–20 / 配图长边 ≤640 JPEG data URL ≤150000 字符）
//   §1.6 可见人范围（2026-11-11 18:08 增量）：全班 all / 班委 committee / 团员 league / 指定成员 custom；
//        指定成员用座号（1–70，只显示姓名、不显示/不存学号），范围内的人才能看到并投票
//   §2 RPC（poll_create / poll_list / poll_detail / poll_submit / poll_manage，一律走 utils/cloud.js）
//   §4.2 小程序交互：列表（进行中/已结束、下拉刷新、卡片倒计时或截止、规则标签、可见范围标签、已投人数）、
//        发起（页面内弹层：标题/说明/时限 5·10·30·60·120 分钟 / 指定日期时间 / 不限时、
//        2–20 选项含可选补充说明与可选配图、单选/多选+最多选几项、匿名、允许改票、结果可见口径、
//        可见范围 4 段 + 指定成员名单多选），失败兜底 toast「网络不可用，稍后重试」且不清空已渲染列表。
//
// 说明：
//   * 纯逻辑（校验/归一/倒计时/排序/范围/视图模型）全在 utils/vote.js，本页只做交互与渲染；
//   * 编辑复用同一弹层：从详情页 wx.navigateTo('/pages/vote/vote?edit=<id>') 进入（仅无票时详情页给入口）；
//     保存走 poll_manage action='edit'（契约 §2.4；可见范围按 poll.audience_seats 回填）；
//   * 配图：wx.chooseMedia 选图 → 隐藏 canvas 2d 压缩成长边 ≤640 的 JPEG → base64 data URL（≤150000 字符），
//     压缩结果超限时自动降尺寸/降质量重试；
//   * 轮询：列表页可见时 10s（onHide 停、onShow 恢复）；倒计时每 1s 只在文案变化时 setData；
//   * 隐私：不展示学号；页面只渲染 RPC 返回的姓名（owner_name / voters.name），匿名票不渲染投票人；
//     指定成员只把 {seat,name} 放进 data（不展示/不保存 classMembers 里的 sid）。
const identity = require('../../utils/identity.js');
const cloud = require('../../utils/cloud.js');
const vote = require('../../utils/vote.js');
const roster = require('../../utils/roster.js');
const util = require('../../utils/util.js');
const share = require('../../utils/share.js');
const sharecard = require('../../utils/sharecard.js');
const shareflow = require('../../utils/shareflow.js');

const LIST_POLL_MS = 10000;          // 列表轮询（页面可见时）
const IMG_MAX_SIDE = 640;            // 配图长边上限（契约 §1.3）
const IMG_TRIES = [[640, 0.82], [520, 0.7], [420, 0.58], [340, 0.5]];  // 尺寸/质量递降重试
const ROUTE = 'pages/vote/vote';

function emptyForm() {
  return {
    title: '',
    desc: '',
    type: 'quick',             // quick 限时 / long 指定截止 / none 不限时
    quickMin: 30,
    dDate: '',
    dTime: '',
    options: [vote.newOption(''), vote.newOption('')],
    multi: false,
    maxChoices: 2,
    anonymous: true,
    allowChange: true,
    vis: 'afterVote',
    aud: 'all',                // 可见范围（§1.6）：all / committee / league / custom
    audSeats: [],              // custom 时的座号数组（1–70，去重升序；不存学号）
    submitting: false
  };
}
function readBase64(path) {
  return new Promise(function (resolve, reject) {
    wx.getFileSystemManager().readFile({
      filePath: path, encoding: 'base64',
      success: function (r) { resolve(r.data); },
      fail: reject
    });
  });
}
function dataUrlOf(base64) { return 'data:image/jpeg;base64,' + base64; }

// 用隐藏 canvas 2d 把一张图缩放/转码为长边 ≤640 的 JPEG temp 文件（失败 reject）
function drawToTempFile(scope, path, maxSide, quality) {
  return new Promise(function (resolve, reject) {
    try {
      const q = (scope && typeof scope.createSelectorQuery === 'function') ? scope.createSelectorQuery() : wx.createSelectorQuery();
      q.select('#voteCanvas').fields({ node: true, size: true }).exec(function (res) {
        const canvas = res && res[0] && res[0].node;
        if (!canvas || !canvas.getContext) { reject(new Error('canvas-missing')); return; }
        wx.getImageInfo({
          src: path,
          success: function (info) {
            const fit = vote.fitRect(info && info.width, info && info.height, maxSide);
            if (!fit.w || !fit.h) { reject(new Error('bad-image')); return; }
            try {
              canvas.width = fit.w;
              canvas.height = fit.h;
              const ctx = canvas.getContext('2d');
              // 透明 PNG 转 JPEG 时铺白底，避免出现黑底
              ctx.fillStyle = '#FFFFFF';
              ctx.fillRect(0, 0, fit.w, fit.h);
              const img = canvas.createImage();
              img.onload = function () {
                try {
                  ctx.drawImage(img, 0, 0, fit.w, fit.h);
                  wx.canvasToTempFilePath({
                    canvas: canvas,
                    x: 0, y: 0, width: fit.w, height: fit.h,
                    destWidth: fit.w, destHeight: fit.h,
                    fileType: 'jpg', quality: quality,
                    success: function (r) { resolve(r.tempFilePath); },
                    fail: reject
                  });
                } catch (e) { reject(e); }
              };
              img.onerror = function () { reject(new Error('img-load')); };
              img.src = path;
            } catch (e) { reject(e); }
          },
          fail: reject
        });
      });
    } catch (e) { reject(e); }
  });
}

Page(shareflow.install({
  data: {
    state: 'loading',          // loading | ready | denied
    tab: 'open',               // open | closed
    rows: [],
    openCount: 0,
    closedCount: 0,
    listError: '',
    busy: false,               // 下拉刷新中
    formOpen: false,
    editing: false,
    quickMins: vote.QUICK_MINS,
    maxOpts: [],               // 多选「最多选几项」可选值 2..min(20,选项数)
    members: [],               // 指定成员可选项 [{seat,name,sel}]（只含姓名+座号，不含学号）
    memberCount: 0,
    selectedCount: 0,           // 已选可见成员数（= form.audSeats.length，供 WXML 直接显示）
    leagueBusy: false,          // 团员名单拉取中（快捷预设）
    th: { primary: '#5E8F87', track: '#E6E9E8' },   // 原生 switch 配色（跟随系统主题，与其它页一致）
    form: emptyForm()
  },

  onLoad(options) {
    this._dead = false;
    this._denied = !identity.has();
    this._polls = [];
    this._serverNow = Date.now();
    this._loading = false;
    this._failN = 0;
    this._poll = null;
    this._tick = null;
    this._editing = false;
    this._editId = '';
    this._newId = '';
    this.setData({ th: util.nativeTheme() });
    if (wx.onThemeChange) {
      this._onTheme = () => this.setData({ th: util.nativeTheme() });
      wx.onThemeChange(this._onTheme);
    }
    if (this._denied) { this.setData({ state: 'denied' }); return; }
    this._syncMembers();
    const editId = String((options && options.edit) || '');
    if (editId) this._openEditById(editId);
  },

  onShow() {
    share.enable();
    if (!identity.ensure()) return;
    this._dead = false;
    this.load(false);
    this._startPoll();
    this._startTick();
  },
  onHide() { this._stopPoll(); this._stopTick(); },
  onUnload() {
    this._dead = true;
    this._stopPoll();
    this._stopTick();
    if (this._onTheme && wx.offThemeChange) { wx.offThemeChange(this._onTheme); this._onTheme = null; }
  },
  onPullDownRefresh() {
    this.load(true).then(function () {
      try { wx.stopPullDownRefresh(); } catch (e) { /* ignore */ }
    });
  },

  /* ---------------- 轮询 / 倒计时（onHide 停、onShow 恢复，不泄漏 timer） ---------------- */
  _visible() {
    try {
      const pages = getCurrentPages();
      const cur = pages[pages.length - 1];
      return !cur || cur.route === ROUTE;
    } catch (e) { return true; }
  },
  _startPoll() {
    this._stopPoll();
    const self = this;
    this._poll = setInterval(function () {
      if (!self._dead && self._visible()) self.load(false);
    }, LIST_POLL_MS);
  },
  _stopPoll() { if (this._poll) { clearInterval(this._poll); this._poll = null; } },
  // 卡片倒计时每秒刷新；只在文案真的变化时 setData（长时投票多数秒 0 变更）
  _startTick() {
    this._stopTick();
    const self = this;
    this._tick = setInterval(function () {
      if (self._dead || !self._visible()) return;
      self._tickRows();
    }, 1000);
  },
  _stopTick() { if (this._tick) { clearInterval(this._tick); this._tick = null; } },
  _tickRows() {
    const rows = this.data.rows;
    if (!rows.length || !this._polls.length) return;
    const byId = {};
    this._polls.forEach(function (p) { if (p && p.id) byId[String(p.id)] = p; });
    const now = Date.now();
    let changed = false;
    const next = rows.map(function (r) {
      const p = byId[r.id];
      if (!p || !r.openTimed) return r;
      const text = vote.countdownText(p, now);
      if (text === r.countdownText) return r;
      changed = true;
      return Object.assign({}, r, { countdownText: text });
    });
    if (changed) this.setData({ rows: next });
  },

  /* ---------------- 列表加载（失败保留旧列表 + toast；不白屏） ---------------- */
  load(force) {
    if (!identity.has()) { this.setData({ state: 'denied' }); return Promise.resolve(false); }
    if (this._loading) return Promise.resolve(false);
    this._loading = true;
    if (force) this.setData({ busy: true });
    const self = this;
    return cloud.pollList().then(function (r) {
      self._loading = false;
      if (self._dead) return false;
      self.setData({ busy: false });
      if (r && r.ok) {
        self._failN = 0;
        self._polls = r.polls || [];
        self._serverNow = r.now || Date.now();
        self._render('');
        return true;
      }
      const reason = (r && r.reason) || '网络不可用，稍后重试';
      self._failN += 1;
      if (!self._polls.length) {
        self.setData({ state: 'ready', rows: [], empty: true, listError: reason });
      } else {
        self._render(reason);
      }
      // 自动轮询失败不反复弹 toast（首次/下拉刷新才提示），列表保留
      if (force || self._failN === 1) util.toast('网络不可用，稍后重试');
      return false;
    }).catch(function () {
      self._loading = false;
      self.setData({ busy: false });
      self._failN += 1;
      if (!self._polls.length) self.setData({ state: 'ready', rows: [], empty: true, listError: '网络不可用，稍后重试' });
      if (force || self._failN === 1) util.toast('网络不可用，稍后重试');
      return false;
    });
  },
  _render(listError) {
    const now = Date.now();
    const rows = vote.sortPolls(this._polls, this.data.tab, now).map(function (p) { return vote.cardView(p, now); });
    let openCount = 0, closedCount = 0;
    this._polls.forEach(function (p) {
      if (vote.isClosed(p, now)) closedCount += 1;
      else openCount += 1;
    });
    this.setData({
      state: 'ready',
      rows: rows,
      empty: !rows.length,
      openCount: openCount,
      closedCount: closedCount,
      listError: listError || ''
    });
  },
  switchTab(e) {
    const tab = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.tab) || 'open');
    if (tab !== 'open' && tab !== 'closed') return;
    if (tab === this.data.tab) return;
    this.setData({ tab: tab });
    this._render('');
  },
  openDetail(e) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    if (!id) return;
    wx.navigateTo({ url: '/pages/votedetail/votedetail?id=' + encodeURIComponent(id) });
  },
  goAll() { wx.switchTab({ url: '/pages/all/all' }); },
  noop() { /* 弹层内点击阻止冒泡 */ },

  /* ---------------- 发起 / 编辑弹层 ---------------- */
  openCreate() {
    this._editing = false;
    this._editId = '';
    // 先定 id：网络失败后用户重试复用同一 id（契约 §2.1：同 p_id 幂等，不产生重复投票）
    this._newId = vote.pollId();
    this.setData({ formOpen: true, editing: false, form: emptyForm() }, () => {
      this._syncMaxOpts();
      this._syncMembers();
    });
  },
  closeCreate() {
    if (this.data.form.submitting) return;
    this._newId = '';
    this.setData({ formOpen: false, editing: false, form: emptyForm() });
    this._editing = false;
    this._editId = '';
  },
  _openEditById(id) {
    const self = this;
    cloud.pollDetail(id).then(function (r) {
      if (self._dead) return;
      if (!r.ok || !r.poll) { util.toast((r && r.reason) || '投票加载失败'); return; }
      const e = vote.editorFromPoll(r);
      const form = Object.assign(emptyForm(), {
        title: e.title,
        desc: e.description,
        type: e.type,
        dDate: e.dDate,
        dTime: e.dTime,
        options: e.options.length >= vote.LIMITS.optMin ? e.options : [vote.newOption(''), vote.newOption('')],
        multi: e.settings.multi,
        maxChoices: e.settings.maxChoices,
        anonymous: e.settings.anonymous,
        allowChange: e.settings.allowChange,
        vis: e.settings.resultVisibility,
        // 可见范围回填（§1.6）：custom 的座号仅管理者详情返回（服务端 privacy 限制）
        aud: e.audience || 'all',
        audSeats: Array.isArray(e.audienceSeats) ? e.audienceSeats : []
      });
      self._editing = true;
      self._editId = e.id || String(id);
      self._newId = '';
      self.setData({ formOpen: true, editing: true, form: form }, function () {
        self._syncMaxOpts();
        self._syncMembers();
      });
    });
  },
  // 指定成员名单：只把 {seat,name,sel} 放进 data（roster.members() 里含 sid，必须剥离，隐私红线）
  _syncMembers() {
    const seats = (this.data.form && Array.isArray(this.data.form.audSeats)) ? this.data.form.audSeats : [];
    const sel = {};
    seats.forEach(function (s) { sel[s] = 1; });
    const list = roster.members().map(function (m) {
      return { seat: m.seat, name: m.name, sel: !!sel[m.seat] };
    });
    this.setData({
      members: list,
      memberCount: list.length,
      selectedCount: seats.length
    });
  },
  _syncMaxOpts() {
    const f = this.data.form;
    const cap = Math.min(vote.LIMITS.optMax, Math.max(vote.LIMITS.optMin, f.options.length));
    const arr = [];
    for (let i = 2; i <= cap; i += 1) arr.push(i);
    let max = f.maxChoices;
    if (arr.indexOf(max) < 0) max = arr[arr.length - 1] || 2;
    this.setData({ maxOpts: arr, 'form.maxChoices': max });
  },
  _deadlineOfForm() {
    const f = this.data.form;
    if (f.type === 'none') return { ok: true, deadline: 0 };
    if (f.type === 'quick') return { ok: true, deadline: vote.quickDeadline(f.quickMin, Date.now()) };
    const ts = vote.parseDeadline(f.dDate, f.dTime);
    if (!ts) return { ok: false, deadline: 0, reason: '请选择截止日期和时间' };
    return { ok: true, deadline: ts };
  },

  onTitleInput(e) { this.setData({ 'form.title': String((e && e.detail && e.detail.value) || '') }); },
  onDescInput(e) { this.setData({ 'form.desc': String((e && e.detail && e.detail.value) || '') }); },
  pickDeadlineType(e) {
    const v = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) || '');
    if (['quick', 'long', 'none'].indexOf(v) < 0) return;
    if (v === 'long') {
      const f = this.data.form;
      // 指定截止默认预填「明天此刻」，用户再改日期/时间
      const dl = vote.quickDeadline(24 * 60, Date.now());
      this.setData({
        'form.type': v,
        'form.dDate': f.type === 'long' && f.dDate ? f.dDate : vote.dateStrOf(dl),
        'form.dTime': f.type === 'long' && f.dTime ? f.dTime : vote.timeStrOf(dl)
      });
      return;
    }
    this.setData({ 'form.type': v });
  },
  pickQuick(e) {
    const m = parseInt(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.min, 10);
    if (!isFinite(m) || vote.QUICK_MINS.indexOf(m) < 0) return;
    this.setData({ 'form.quickMin': m });
  },
  onDateChange(e) {
    const v = String((e && e.detail && e.detail.value) || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    this.setData({ 'form.dDate': v });
  },
  onTimeChange(e) {
    const v = String((e && e.detail && e.detail.value) || '');
    if (!/^\d{1,2}:\d{2}$/.test(v)) return;
    this.setData({ 'form.dTime': v });
  },
  onOptText(e) {
    const i = parseInt(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.i, 10);
    const opts = this.data.form.options.slice();
    if (!opts[i]) return;
    opts[i] = Object.assign({}, opts[i], { text: String((e && e.detail && e.detail.value) || '') });
    this.setData({ 'form.options': opts });
  },
  onOptDesc(e) {
    const i = parseInt(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.i, 10);
    const opts = this.data.form.options.slice();
    if (!opts[i]) return;
    opts[i] = Object.assign({}, opts[i], { desc: String((e && e.detail && e.detail.value) || '') });
    this.setData({ 'form.options': opts });
  },
  addOption() {
    const r = vote.addOption(this.data.form.options);
    if (!r.ok) { util.toast(r.reason); return; }
    this.setData({ 'form.options': r.options }, () => this._syncMaxOpts());
  },
  removeOption(e) {
    const i = parseInt(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.i, 10);
    const r = vote.removeOption(this.data.form.options, i);
    if (!r.ok) { util.toast(r.reason); return; }
    this.setData({ 'form.options': r.options }, () => this._syncMaxOpts());
  },
  moveOptionUp(e) {
    const i = parseInt(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.i, 10);
    const r = vote.moveOption(this.data.form.options, i, -1);
    if (r.moved) this.setData({ 'form.options': r.options });
  },
  moveOptionDown(e) {
    const i = parseInt(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.i, 10);
    const r = vote.moveOption(this.data.form.options, i, 1);
    if (r.moved) this.setData({ 'form.options': r.options });
  },

  /* ---------------- 选项配图（chooseMedia → canvas 压缩 → JPEG data URL） ---------------- */
  pickImg(e) {
    const i = parseInt(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.i, 10);
    if (!wx.chooseMedia) { util.toast('当前微信版本不支持选择图片'); return; }
    if (!this.data.form.options[i]) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = ((res && res.tempFiles) || [])[0] || {};
        const path = file.tempFilePath || file.path || '';
        if (!path) return;
        wx.showLoading({ title: '压缩中', mask: true });
        this._compressToDataUrl(path).then((dataUrl) => {
          try { wx.hideLoading(); } catch (e2) { /* ignore */ }
          if (this._dead) return;
          const opts = this.data.form.options.slice();
          if (!opts[i]) return;
          opts[i] = Object.assign({}, opts[i], { img: dataUrl });
          if (vote.imgTotalChars(opts) > vote.LIMITS.imgTotalChars) {
            util.toast('配图总大小超过限制，请减少或换小图');
            return;
          }
          this.setData({ 'form.options': opts });
        }).catch(() => {
          try { wx.hideLoading(); } catch (e2) { /* ignore */ }
          if (!this._dead) util.toast('图片处理失败，请换一张');
        });
      }
    });
  },
  _compressToDataUrl(path) {
    const self = this;
    let k = 0;
    const next = function () {
      if (k >= IMG_TRIES.length) return Promise.reject(new Error('too-big'));
      const c = IMG_TRIES[k];
      k += 1;
      return drawToTempFile(self, path, Math.min(IMG_MAX_SIDE, c[0]), c[1])
        .then(readBase64)
        .then(function (b64) {
          const d = dataUrlOf(b64);
          if (d.length > vote.LIMITS.imgChars) return next();
          return d;
        });
    };
    return next();
  },
  removeImg(e) {
    const i = parseInt(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.i, 10);
    const opts = this.data.form.options.slice();
    if (!opts[i]) return;
    opts[i] = Object.assign({}, opts[i], { img: '' });
    this.setData({ 'form.options': opts });
  },

  /* ---------------- 规则 ---------------- */
  onMultiChange(e) {
    const multi = !!(e && e.detail && e.detail.value);
    this.setData({ 'form.multi': multi }, () => this._syncMaxOpts());
  },
  pickMax(e) {
    const n = parseInt(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.n, 10);
    if (!isFinite(n)) return;
    this.setData({ 'form.maxChoices': n });
  },
  onAnonChange(e) { this.setData({ 'form.anonymous': !!(e && e.detail && e.detail.value) }); },
  onChangeChange(e) { this.setData({ 'form.allowChange': !!(e && e.detail && e.detail.value) }); },
  pickVis(e) {
    const v = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.vis) || '');
    if (vote.VIS.indexOf(v) < 0) return;
    this.setData({ 'form.vis': v });
  },

  /* ---------------- 可见人范围（§1.6，2026-11-11 18:08 增量） ---------------- */
  pickAudience(e) {
    const a = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.a) || '');
    if (vote.AUD.indexOf(a) < 0) return;
    if (a === this.data.form.aud) return;
    // 切到非 custom 时清空座号（服务端对非 custom 恒 []）；切到 custom 保留已选，方便来回切换
    const patch = { 'form.aud': a };
    if (a !== 'custom') {
      patch['form.audSeats'] = [];
      this.setData(patch, () => this._syncMembers());
      return;
    }
    this.setData(patch, () => this._syncMembers());
  },
  toggleMember(e) {
    const seat = parseInt(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.seat, 10);
    if (!isFinite(seat)) return;
    const cur = (this.data.form.audSeats || []).slice();
    const i = cur.indexOf(seat);
    if (i >= 0) cur.splice(i, 1);
    else cur.push(seat);
    this.setData({ 'form.audSeats': vote.normAudienceSeats(cur) }, () => this._syncMembers());
  },
  // 快捷预设（需求 8）：指定成员一键套「全班 / 班委 / 团员」基础集合，之后仍可逐个点成员增删；
  // 数据仍是座号数组（不存学号），团员名单走 utils/cloud.js leaguePull（6h TTL + 本机缓存）。
  quickAudience(e) {
    const kind = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.k) || '');
    if (['all', 'committee', 'league', 'none'].indexOf(kind) < 0) return;
    if (kind === 'none') {
      this.setData({ 'form.audSeats': [] }, () => this._syncMembers());
      return;
    }
    if (kind !== 'league') {
      const seats = roster.quickSeats(kind);
      if (!seats.length) { util.toast(kind === 'committee' ? '班委名单为空' : '班级名单未同步'); return; }
      this.setData({ 'form.audSeats': vote.normAudienceSeats(seats) }, () => this._syncMembers());
      return;
    }
    if (this.data.leagueBusy) return;
    const cached = roster.quickSeats('league');
    if (cached.length) {
      this.setData({ 'form.audSeats': vote.normAudienceSeats(cached) }, () => this._syncMembers());
      return;
    }
    this.setData({ leagueBusy: true });
    cloud.leaguePull().then((list) => {
      this.setData({ leagueBusy: false });
      const seats = roster.quickSeats('league');
      if (!seats.length) { util.toast(list && list.length ? '团员名单为空' : '团员名单暂不可用'); return; }
      this.setData({ 'form.audSeats': vote.normAudienceSeats(seats) }, () => this._syncMembers());
    }).catch(() => {
      this.setData({ leagueBusy: false });
      util.toast('团员名单暂不可用');
    });
  },

  /* ---------------- 提交（发起 = poll_create；编辑 = poll_manage edit） ---------------- */
  submitCreate() {
    if (this.data.form.submitting) return;
    if (!identity.has()) { util.toast('身份已过期，请重新进入'); return; }
    const f = this.data.form;
    const dl = this._deadlineOfForm();
    if (!dl.ok) { util.toast(dl.reason); return; }
    const built = vote.buildPayload({
      id: this._editing ? this._editId : (this._newId || vote.pollId()),
      title: f.title,
      description: f.desc,
      mode: f.type === 'quick' ? 'quick' : 'long',
      deadline: dl.deadline,
      options: f.options,
      // 可见范围（§1.6）：custom 至少 1 人由 buildPayload 校验（toast「请选择可见成员」）
      audience: f.aud,
      audienceSeats: f.audSeats,
      settings: {
        multi: f.multi,
        maxChoices: f.multi ? f.maxChoices : 1,
        anonymous: f.anonymous,
        allowChange: f.allowChange,
        resultVisibility: f.vis
      }
    }, Date.now());
    if (!built.ok) { util.toast(built.reason); return; }
    const p = built.payload;
    this.setData({ 'form.submitting': true });
    const self = this;
    const req = this._editing
      ? cloud.pollManage({
        id: this._editId, action: 'edit',
        title: p.title, description: p.description,
        options: p.options, settings: p.settings, deadline: p.deadline,
        // 编辑必须同时传范围（不传 = 服务端保持原范围，达不到「改范围」目的）
        audience: p.audience, audienceSeats: p.audienceSeats
      })
      : cloud.pollCreate(p);
    req.then(function (r) {
      if (self._dead) return;
      self.setData({ 'form.submitting': false });
      if (!r.ok) { util.toast(r.reason || (self._editing ? '保存失败' : '发起失败')); return; }
      if (self._editing) {
        util.toast('已保存');
        self._editing = false;
        self._editId = '';
        self._newId = '';
        self.setData({ formOpen: false, form: emptyForm() });
        self._backFromEdit();
        return;
      }
      self._newId = '';
      self.setData({ formOpen: false, form: emptyForm() });
      util.toast('已发起');
      self.load(true);
    }).catch(function () {
      if (self._dead) return;
      self.setData({ 'form.submitting': false });
      util.toast('网络不可用，稍后重试');
    });
  },
  // 编辑保存后：优先返回上一页（详情页）；没有上一页时留在列表并刷新
  _backFromEdit() {
    let pages = [];
    try { pages = getCurrentPages() || []; } catch (e) { pages = []; }
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    this.load(true);
  },

  _listRowOf(id) {
    const list = this.data.rows || [];
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  },
  _fallbackVoteView(row) {
    const tags = (row && row.tags || []).map(function (t) { return t.text; }).filter(Boolean).slice(0, 2);
    return sharecard.infoView({
      title: (row && row.title) || '班级投票', badge: '投票',
      subtitle: [row && row.statusText, row && row.modeText, row && row.deadlineText].filter(Boolean).join(' · '),
      stats: [
        { k: '发起人', v: row && row.owner ? row.owner : '' },
        { k: '时限', v: row && row.modeText },
        { k: '可见', v: row && row.audienceTag ? row.audienceTag : '全班' }
      ],
      lines: tags.map(function (t) { return { label: '规则', text: t }; }).concat([{ label: '结果', text: '打开投票页查看' }]),
      footer: '班级投票 · 结果请打开投票页查看',
      time: util.timeStr()
    });
  },
  _renderListShare(id, view) {
    const self = this;
    shareflow.renderCard(this, 'shareCanvas', view).then(function (p) {
      if (self._dead || self.data.shareGid !== id || !self.data.shareSheet) return;
      self.setData({ shareImg: p || '', shareBusy: false, shareHint: p ? '' : '卡片封面生成失败，将使用默认封面' });
    }).catch(function () {
      if (self._dead || self.data.shareGid !== id) return;
      self.setData({ shareImg: '', shareBusy: false, shareHint: '卡片封面生成失败，将使用默认封面' });
    });
  },
  // 列表卡片分享：先拉一次详情（标题/说明/规则/选项），保证卡片信息足够；失败时用列表信息生成。
  openShare(e) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    const row = this._listRowOf(id);
    if (!id || !row) { util.toast('投票已更新，请刷新'); return; }
    this.setData({
      shareSheet: true, shareGid: id, shareTitle: row.title || '班级投票',
      shareImg: '', sharePoster: '', shareBusy: true, shareHint: ''
    });
    const self = this;
    cloud.pollDetail(id).then(function (r) {
      if (self._dead || self.data.shareGid !== id || !self.data.shareSheet) return;
      const d = (r && r.ok && r.poll) ? vote.detailView(r, { now: Date.now() }) : null;
      if (d && d.title) self.setData({ shareTitle: d.title });
      self._renderListShare(id, d ? sharecard.buildVoteView({ detail: d, time: util.timeStr() }) : self._fallbackVoteView(row));
    }).catch(function () {
      if (self._dead || self.data.shareGid !== id || !self.data.shareSheet) return;
      self._renderListShare(id, self._fallbackVoteView(row));
    });
  },
  closeShare() {
    this.setData({ shareSheet: false, shareGid: '', shareImg: '', sharePoster: '', shareBusy: false, shareHint: '' });
  },
  shareImage() {
    if (this.data.shareBusy) { util.toast('预览图生成中，请稍候'); return; }
    shareflow.showImage(this.data.shareImg);
  },

  onShareAppMessage(e) {
    // 列表卡片上的「分享」入口：分享弹层打开时优先按当前投票生成卡片
    const gid = (this.data.shareSheet && this.data.shareGid) ? String(this.data.shareGid) : '';
    if (gid) {
      const row = this._listRowOf(gid);
      return share.message({
        title: row && row.title ? row.title : (this.data.shareTitle || '班级投票'),
        path: '/pages/votedetail/votedetail',
        query: 'id=' + encodeURIComponent(gid),
        imageUrl: this.data.shareImg || '/images/share/default.png'
      });
    }
    const id = e && e.target && e.target.dataset ? String(e.target.dataset.id || '') : '';
    const row = id ? this._listRowOf(id) : null;
    if (id) {
      return share.message({
        title: (row && row.title) ? row.title : '班级投票',
        path: '/pages/votedetail/votedetail',
        query: 'id=' + encodeURIComponent(id),
        imageUrl: this.data.shareImg || '/images/share/default.png'
      });
    }
    return share.message({
      title: '班级工具｜投票 · 限时/长时，自定义标题与选项',
      path: '/pages/vote/vote',
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline() {
    const gid = String(this.data.shareGid || '');
    if (gid) {
      const row = this._listRowOf(gid);
      return share.timeline({
        title: row && row.title ? row.title : '班级投票',
        query: 'id=' + encodeURIComponent(gid),
        imageUrl: this.data.shareImg || '/images/share/default.png'
      });
    }
    return share.timeline({
      title: '班级投票 · 限时/长时，实时结果',
      imageUrl: '/images/share/default.png'
    });
  }
}));
