// pages/ppt/ppt.js —— 「演示」列表页（PPT 上传 + 状态轮询 + 删除/重试 + 空态）
//
// 契约：web/ppt/CONTRACT.md
//   §4.1–§4.7 建行 / 分片上传 / 提交 / 列表 / 软删与重试 / 10s 轮询（可见时；隐藏停止；onShow 强拉）
//   §3.4 转换机心跳（与列表同一轮拉取；离线显示「转换机离线 · 排队中」不报错）
//   §8.1 卡片流（封面/标题/上传者/页数/状态胶囊）、顶部上传主按钮、空态、取消即软删、仅本人可删
//
// 上传链路：wx.chooseMessageFile → （可改标题）→ 建 deck → 512KiB 分片并发 ≤4 → 提交 queued；
//           取消/失败都会清理已写入分片（DELETE ppt_upload_chunks，本人 RLS 可删），避免数据库残留。
// 不白屏：云端失败保留上次列表 + 顶部轻提示；身份失效提示「身份已过期」。
const identity = require('../../utils/identity.js');
const cloud = require('../../utils/cloud.js');
const ppt = require('./utils/ppt.js');
const util = require('../../utils/util.js');
const share = require('../../utils/share.js');

const POLL_MS = 10000;            // 列表页可见时 10s 轮询（§4.7）；页面隐藏停止

Page({
  data: {
    state: 'loading',             // loading | ready | denied
    rows: [],
    empty: false,
    busy: false,                  // 下拉刷新/手动刷新中
    listError: '',
    cloudOff: false,              // 云服务未配置（离线只读，不能上传）
    hb: { known: false, online: false, offline: false, text: '', queued: 0 },
    // 上传进度（本地状态，不写云端；契约 §3.1）
    up: null,
    // 标题编辑弹层
    titleOpen: false,
    titleDraft: '',
    pendingName: '',
    pendingSizeText: ''
  },

  onLoad() {
    this._dead = false;
    this._poll = null;
    this._loading = false;
    this._rows = [];              // 原始 deck 行（删除/重试要找 owner_sid/error）
    this._upDeckId = '';          // 本次上传的 deckId
    this._upCancelled = false;    // 用户取消上传
    this._upIsNew = false;        // true=本次新建（取消即软删）；false=失败重传已有 deck
    this._pending = null;         // 待上传文件（wx tempFile，非序列化，不进 data）
    this._coverErr = {};
    this._uploading = false;
    // v2.0 下载中心列表标签（§12.4.1）：文件信息缓存 + 轻查询防抖
    this._filesMap = null;
    this._tagLoading = false;
    this._tagSig = '';
    this._denied = !identity.has();
    if (this._denied) { this.setData({ state: 'denied' }); return; }
    this.setData({ state: 'loading' });
  },

  onShow() {
    share.enable();
    if (!identity.ensure()) return;
    if (!this.data.titleOpen) this.setData({ denied: false });
    // 回到前台立即拉一次（§4.7），再启动 10s 轮询
    this.load(true);
    this._startPoll();
    // 上传中切过后台 → 进度条文案提示勿退出（不打断上传）
    if (this._uploading && this._wasHidden && this.data.up) {
      this._wasHidden = false;
      const up = Object.assign({}, this.data.up);
      up.text = up.pct + '% · 上传中 · 勿退出';
      this.setData({ up: up });
    }
  },
  onHide() {
    this._stopPoll();
    // 上传中切后台：回来时提示「上传中 · 勿退出」（DESIGN §4.8 弱网/锁屏风险）
    if (this._uploading) this._wasHidden = true;
  },
  onUnload() {
    this._dead = true;
    this._stopPoll();
    // 页面销毁时上传已无法展示：静默取消 + 清理分片（取消即软删；重传只落 failed）
    this._cancelUploadSilently();
  },
  onPullDownRefresh() {
    this.load(true).then(function () {
      try { wx.stopPullDownRefresh(); } catch (e) { /* ignore */ }
    });
  },

  /* ---------------- 轮询（可见时 10s；隐藏停止；回到前台强拉） ---------------- */
  _startPoll() {
    this._stopPoll();
    this._poll = setInterval(() => {
      if (this._visible()) this.load(false);
    }, POLL_MS);
  },
  _stopPoll() { if (this._poll) { clearInterval(this._poll); this._poll = null; } },
  _visible() {
    try {
      const pages = getCurrentPages();
      const cur = pages[pages.length - 1];
      return !cur || cur.route === 'pages/ppt/ppt';
    } catch (e) { return true; }
  },

  /* ---------------- 列表加载（列表 + 心跳同一轮 §4.7） ---------------- */
  load(force) {
    if (!identity.has()) { this.setData({ state: 'denied' }); return Promise.resolve(false); }
    if (this._loading) return Promise.resolve(false);
    this._loading = true;
    this._stopPoll();                                   // 请求期间避免叠加
    if (force) this.setData({ busy: true });
    const cloudOff = !cloud.isEnabled();
    return ppt.pollRound().then((r) => {
      this._finishLoad();
      if (r.ok) {
        this._rows = r.list;
        this._render(r.hb, '');
      } else if (!this._rows.length) {
        this.setData({ state: 'ready', rows: [], empty: true, listError: r.reason || '列表加载失败', cloudOff: cloudOff });
      } else {
        // 云端瞬时失败：保留上次列表，只显示轻提示（不白屏、不清状态）
        this._render(r.hb, r.reason || '刷新失败，稍后自动重试');
      }
      return true;
    }).catch((e) => {
      this._finishLoad();
      if (this._rows.length) this._render(this.data.hb, ppt.reasonOf(e));
      else this.setData({ state: 'ready', rows: [], empty: true, listError: ppt.reasonOf(e), cloudOff: cloudOff });
      return false;
    }).then((v) => {
      this._loadTags();       // v2.0 §12.4.1：批量轻查 files 标签（不阻塞列表）
      return v;
    });
  },
  _finishLoad() {
    this._loading = false;
    this.setData({ busy: false, cloudOff: !cloud.isEnabled() });
    this._startPoll();
  },
  // v2.0 §12.4.1 列表标签：有 files.compat →「兼容版」/ files.pdf →「PDF」。
  // 只查 manifest->files 派生字段（轻查询），失败静默用本机缓存（打开过详情的 deck 一定有缓存）。
  _loadTags() {
    if (this._dead || this._tagLoading) return;
    const ids = (this.data.rows || []).filter(function (r) { return r.playable; }).map(function (r) { return r.id; });
    if (!ids.length) return;
    const sig = ids.join(',');
    if (this._tagSig === sig) return;
    const self = this;
    this._tagLoading = true;
    ppt.filesOfDecks(ids).then(function (r) {
      self._tagLoading = false;
      if (self._dead) return;
      self._filesMap = (r && r.map) || {};
      if (r && r.ok) self._tagSig = sig;
      self._render(self.data.hb, self.data.listError);
    });
  },
  _render(hb, listError) {
    const opts = {
      sid: identity.sid(),
      admin: identity.isAdmin(),
      hb: hb || this.data.hb,
      up: this._upMeta(),
      filesMap: (this._filesMap && Object.keys(this._filesMap).length) ? this._filesMap : ppt.filesMap(), // §12.4.1
      now: Date.now()
    };
    const rows = ppt.listView(this._rows, opts).map((v) => {
      if (this._coverErr[v.id]) v.hasCover = false;
      return v;
    });
    const d = {
      state: 'ready',
      rows: rows,
      empty: !rows.length,
      hb: opts.hb,
      listError: listError || ''
    };
    this.setData(d);
  },
  _upMeta() {
    if (!this._uploading || !this._upDeckId) return null;
    const up = this.data.up;
    return { deckId: this._upDeckId, done: (up && up.done) || 0, total: (up && up.total) || 0 };
  },

  /* ---------------- 选文件 → 改标题 → 上传 ---------------- */
  uploadTap() {
    if (this._uploading) { util.toast('正在上传，请稍候'); return; }
    if (!identity.has()) { util.toast('请先完成身份验证'); return; }
    if (!cloud.isEnabled()) { util.toast('云服务未开启，暂时无法上传'); return; }
    if (!wx.chooseMessageFile) { util.toast('当前微信版本不支持选择文件'); return; }
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['ppt', 'pptx'],
      success: (res) => {
        const f = ppt.fileOf(((res && res.tempFiles) || [])[0]);
        if (!f.ok) { util.toast(f.reason); return; }
        this._pending = f;
        this.setData({
          titleOpen: true,
          titleDraft: ppt.trimTitle('', f.name),
          pendingName: f.name,
          pendingSizeText: ppt.fmtSize(f.size)
        });
      }
    });
  },
  onTitleInput(e) {
    this.setData({ titleDraft: String((e && e.detail && e.detail.value) || '') });
  },
  cancelTitle() {
    this._pending = null;
    this.setData({ titleOpen: false, titleDraft: '', pendingName: '', pendingSizeText: '' });
  },
  confirmTitle() {
    const f = this._pending;
    if (!f) { this.setData({ titleOpen: false }); return; }
    const title = ppt.trimTitle(this.data.titleDraft, f.name);
    this.setData({ titleOpen: false });
    this._pending = null;
    this._startUpload(f, title, '');
  },
  noop() { /* 弹层内点击阻止冒泡 */ },

  /* ---------------- 上传主流程（建行 → 分片 → 提交） ---------------- */
  _startUpload(file, title, existingDeckId) {
    if (this._uploading) { util.toast('正在上传，请稍候'); return; }
    const sid = identity.sid();
    if (!sid) { util.toast('身份已过期，请重新进入'); return; }
    this._uploading = true;
    this._upCancelled = false;
    this._upDeckId = existingDeckId || '';
    this._upIsNew = !existingDeckId;
    this._setUp({ on: true, title: title, pct: 0, done: 0, total: ppt.chunkCount(file.size), phase: 'create', text: '准备上传…' });
    const self = this;
    const beginUpload = function (deckId) {
      self._upDeckId = deckId;
      self._setUp({ on: true, title: title, pct: 0, done: 0, total: ppt.chunkCount(file.size), phase: 'upload', text: '上传中 0%' });
      return ppt.uploadChunks({
        deckId: deckId,
        ownerSid: sid,
        size: file.size,
        path: file.path,
        isCancelled: function () { return self._upCancelled; },
        onProgress: function (done, total) { self._onUpProgress(done, total); }
      }).then(function (r) {
        if (self._upCancelled || r.cancelled) {
          self._endUpload();
          return false;
        }
        if (!r.ok) {
          const reason = (r.error && /file-/.test(String(r.error.message))) ? '文件读取失败，请重新选择' : ppt.UPLOAD_ERR;
          self._failUpload(deckId, reason);
          return false;
        }
        self._setUp({ on: true, title: title, pct: 100, done: r.done, total: r.total, phase: 'submit', text: '提交转换…' });
        return ppt.submitDeck(deckId, file.size, r.done).then(function (sr) {
          self._uploading = false;
          if (!sr.ok) { self._failUpload(deckId, sr.reason || '提交失败，请重试'); return false; }
          self._endUpload();
          util.toast('排队转换');
          self.load(true);
          return true;
        });
      });
    };
    if (existingDeckId) {
      beginUpload(existingDeckId);
      return;
    }
    const newId = ppt.deckId();
    ppt.createDeck({ deckId: newId, title: title, sourceName: file.name, sourceSize: file.size }).then(function (cr) {
      if (self._upCancelled) {
        // 取消发生在「建行中」：deck 已建出 → 软删 + 清分片，避免残留
        self._endUpload();
        ppt.cancelUpload(cr.deckId || newId);
        return;
      }
      if (!cr.ok) {
        self._uploading = false;
        self._endUpload();
        util.toast(cr.reason || '创建演示失败');
        return;
      }
      // A1 占位先行（DESIGN §4.2）：建行成功后立刻刷新列表，占位卡片就地显示上传进度
      self.load(true);
      beginUpload(cr.deckId || newId);
    });
  },
  _onUpProgress(done, total) {
    const pct = ppt.uploadPct(done, total);
    this._setUp({ on: true, title: this.data.up ? this.data.up.title : '', pct: pct, done: done, total: total, phase: 'upload', text: '上传中 ' + pct + '%' });
    // 列表里本人在传卡片同步显示进度（本地状态，不写云端 §3.1）
    this._render(this.data.hb, this.data.listError);
  },
  _setUp(up) { this.setData({ up: up }); },
  _endUpload() {
    this._uploading = false;
    this._upDeckId = '';
    this._upCancelled = false;
    this.setData({ up: null });
  },
  _failUpload(deckId, reason) {
    const self = this;
    this._uploading = false;
    this._upDeckId = '';
    this.setData({ up: null });
    // DESIGN §4.2：失败不弹窗——卡片胶囊变红「上传中断」+ 行内「重试」，这里只落状态并刷新列表
    ppt.markUploadFailed(deckId, reason || ppt.UPLOAD_ERR).then(function () { self.load(true); });
  },
  cancelTap() {
    if (!this._uploading) return;
    const self = this;
    const deckId = this._upDeckId;
    const isNew = this._upIsNew;
    wx.showModal({
      title: '取消上传',
      content: isNew ? '取消后本次上传的文件会被删除，需要重新选择文件。' : '取消后需重新上传源文件才能转换。',
      confirmText: '取消上传',
      cancelText: '继续上传',
      success: function (res) {
        if (!res || !res.confirm) return;
        self._upCancelled = true;
        self._uploading = false;
        self._upDeckId = '';
        self.setData({ up: null });
        // 建行中（deckId 尚未返回）→ 由建行回调负责清理；否则立即清分片/落状态
        if (!deckId) { util.toast('已取消'); return; }
        const done = function () { self.load(true); };
        if (isNew) ppt.cancelUpload(deckId).then(done, done);   // 清分片 + 软删（§8.1）
        else ppt.markUploadFailed(deckId, '已取消上传，请重试').then(done, done);
        util.toast('已取消');
      }
    });
  },
  _cancelUploadSilently() {
    const deckId = this._upDeckId;
    if (!this._uploading || !deckId) return;
    this._upCancelled = true;
    this._uploading = false;
    if (this._upIsNew) ppt.cancelUpload(deckId);
    else ppt.markUploadFailed(deckId, '上传中断，请重试');
    this._upDeckId = '';
  },

  /* ---------------- 卡片操作：下载详情 / 删除 / 失败重试 ---------------- */
  // v2.0 §12.4.1：点击卡片 = 打开「下载」详情（不再直接进播放器；旧播放器改由详情页「在线预览」进入）
  openDeck(e) {
    const id = this._deckIdOf(e);
    if (!id) return;
    const row = this._rowOf(id);
    if (!row) return;
    wx.navigateTo({ url: '/pages/ppt/pptdl/pptdl?id=' + encodeURIComponent(id) });
  },
  delTap(e) {
    const id = this._deckIdOf(e);
    const row = this._rowOf(id);
    if (!row) return;
    const st = ppt.statusView(row, { sid: identity.sid(), admin: identity.isAdmin() });
    if (!st.deletable) { util.toast('只有上传者可以删除'); return; }
    const self = this;
    wx.showModal({
      title: '删除演示',
      content: '从班级演示库中删除「' + (row.title || '未命名演示') + '」？删除后其他同学将看不到。',
      confirmText: '删除',
      confirmColor: '#B87870',
      success: function (res) {
        if (!res || !res.confirm) return;
        ppt.softDelete(id).then(function (r) {
          if (!r.ok) { util.toast(r.reason || '删除失败'); return; }
          util.toast('已删除');
          self.load(true);
        });
      }
    });
  },
  retryTap(e) {
    const id = this._deckIdOf(e);
    const row = this._rowOf(id);
    if (!row) return;
    const st = ppt.statusView(row, { sid: identity.sid(), admin: identity.isAdmin() });
    if (!st.retryable) { util.toast('只有上传者可以重试'); return; }
    const self = this;
    // 上传中断 → 重新选文件走全部分片（§4.2「重新走 §4.2 全部片再 §4.3」，同 deckId upsert）
    if (ppt.retryMode(row) === 'reupload') {
      wx.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: ['ppt', 'pptx'],
        success: function (res) {
          const f = ppt.fileOf(((res && res.tempFiles) || [])[0]);
          if (!f.ok) { util.toast(f.reason); return; }
          self._startUpload(f, row.title || ppt.baseNameOf(f.name), id);
        }
      });
      return;
    }
    // 转换失败 → 重新排队（§4.6）
    ppt.retryDeck(id).then(function (r) {
      if (!r.ok) { util.toast(r.reason || '重试失败'); return; }
      util.toast('已重新排队');
      self.load(true);
    });
  },
  /* ---------------- 卡片「⋯」/长按更多：重命名 / 下载原件 / 删除（仅本人，DESIGN §4.1） ---------------- */
  moreTap(e) {
    const id = this._deckIdOf(e);
    const row = this._rowOf(id);
    if (!row) return;
    if (!ppt.isMine(row, identity.sid())) return;
    const self = this;
    wx.showActionSheet({
      itemList: ['重命名', '下载原件', '删除'],
      success(res) {
        const i = (res && res.tapIndex) || 0;
        if (i === 0) self.renameDeck(id);
        else if (i === 1) self.downloadSource(id);
        else if (i === 2) self.delTap({ currentTarget: { dataset: { id: id } } });
      }
    });
  },
  renameDeck(id) {
    const row = this._rowOf(id);
    if (!row) return;
    const self = this;
    wx.showModal({
      title: '重命名',
      editable: true,
      placeholderText: '演示标题',
      content: row.title || '',
      success(res) {
        if (!res || !res.confirm) return;
        const title = ppt.trimTitle(res.content, row.source_name);
        ppt.patchDeck(id, { title: title }).then(function (r) {
          if (!r.ok) { util.toast(r.reason || '重命名失败'); return; }
          util.toast('已重命名');
          self.load(true);
        });
      }
    });
  },
  downloadSource(id) {
    if (!id) return;
    ppt.openSource(id).then(function (r) {
      if (!r.ok) util.toast(r.reason || '原件下载失败');
    });
  },
  openPrivateFiles() {
    const pages = getCurrentPages();
    const previous = pages[pages.length - 2];
    if (previous && previous.route === 'pages/cloudspace/cloudspace') wx.navigateBack();
    else wx.redirectTo({ url: '/pages/cloudspace/cloudspace' });
  },
  goAll() {
    wx.switchTab({ url: '/pages/all/all' });
  },
  _deckIdOf(e) {
    return String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
  },
  _rowOf(id) {
    for (let i = 0; i < this._rows.length; i++) if (this._rows[i].id === id) return this._rows[i];
    return null;
  },
  onCoverError(e) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    if (!id) return;
    this._coverErr[id] = true;
    const rows = this.data.rows.map(function (r) { if (r.id === id) r.hasCover = false; return r; });
    this.setData({ rows: rows });
  },

  onShareAppMessage() {
    return share.message({
      title: '班级工具｜文件传输 · 班级课件',
      path: '/pages/ppt/ppt',
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '班级工具｜文件传输 · 班级课件',
      imageUrl: '/images/share/default.png'
    });
  }
});
