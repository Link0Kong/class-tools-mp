// pages/pptdl/pptdl.js —— 下载中心 · 单 deck 下载详情（v2.0，契约 §12.4）
//
// 定位（§12）：本工具 = PPT 兼容性处理与多端下载中心；点击列表卡片进入本页（不再默认进播放器）。
//   * 数据：GET /ppt_decks?select=manifest&id=eq.<id>（utils/ppt.js getManifest；v2 兼容包/PDF/原始、旧 deck 兼容）；
//   * 三行「打开文件」（§12.4.1，与网页统一）：兼容版 PPTX / PDF / 原始文件，显示大小；下载后 wx.openDocument 打开；
//   * §12.8 视频/音频单独下载分组：仅 manifest.media_files 非空显示（视频1 · 第 7 页 + 时长/分辨率 + 大小）；
//     视频下载 → wx.saveVideoToPhotosAlbum（授权失败 showModal → wx.openSetting；其它失败降级转发/链接），
//     音频下载 → wx.openDocument（失败降级转发/链接）；也可「转发到聊天/电脑」/「复制链接」；
//   * 小程序下载方式（§12.4.2）：wx.downloadFile（进度/可取消，30–60MB 不读入内存）→
//     wx.openDocument({filePath,fileType:'pptx'|'pdf'|…,showMenu:true}) 用系统/Office/WPS 打开；
//     可用 wx.shareFileMessage 时「转发到聊天/电脑」，不可用降级「复制链接」；另每行「复制链接」；
//   * 兼容提示（§12.2）：compat.warnings 橙色逐条显示（外链媒体/字体未嵌入等，不删除内容）；
//   * 旧 deck（无 files）：兼容版未生成 + 在线预览（旧 pages/pptplay 保留为预览入口）+ 重新处理（retryDeck）；
//   * 状态非 ready：只显示状态/进度，不显示下载；失败显示 error 摘要 + 本人可重新处理；
//   * 文件标签由 utils/ppt.js 缓存（列表页「兼容版」「PDF」标签复用）。
//
// 安全：只读云端 + 本机临时文件；不打印任何 token；下载失败不白屏、可重试。
const identity = require('../../utils/identity.js');
const ppt = require('../../utils/ppt.js');
const util = require('../../utils/util.js');
const share = require('../../utils/share.js');

Page({
  data: {
    state: 'loading',         // loading | ready | error | denied
    errorText: '',
    errorDetail: '',          // 转换失败/状态详情（页面短文案）
    d: null,                  // ppt.downloadDetailView 视图
    dl: null,                 // 下载中 {key,on,pct,text}（同一时刻只下载一个）
    shareSupported: false     // wx.shareFileMessage 可用（基础库/端能力）
  },

  onLoad(options) {
    this._dead = false;
    this._loaded = false;
    this._id = '';
    try { this._id = decodeURIComponent(String((options && options.id) || '')); } catch (e) { this._id = String((options && options.id) || ''); }
    this._m = null;
    this._deck = null;
    this._files = {};       // key → {path,name}（已下载临时文件，转发时直接复用）
    this._dlTask = null;
    this._dlKey = '';
    this._dlAborted = false; // 主动取消标记（abort 触发的 fail 不提示失败）
    this._retryT = null;
    this._denied = !identity.has();
    if (this._denied) { this.setData({ state: 'denied' }); return; }
    if (!this._id) { this.setData({ state: 'error', errorText: '缺少演示参数' }); return; }
    this.setData({ state: 'loading' });
  },

  onShow() {
    share.enable();
    if (!identity.ensure()) return;
    if (!this._loaded && this.data.state !== 'denied') this._load();
  },

  onUnload() {
    this._dead = true;
    if (this._retryT) { clearTimeout(this._retryT); this._retryT = null; }
    this._abortDownload();      // 页面销毁：取消未完成的下载（wx.downloadFile 可 abort）
  },

  /* ---------------- 加载清单（§4.5 / §12.4.1） ---------------- */
  _load() {
    if (this._dead) return;
    const self = this;
    if (!this._loaded) this.setData({ state: 'loading', errorText: '' });
    ppt.getManifest(this._id).then(function (r) {
      if (self._dead) return;
      self._loaded = true;
      if (!r.ok) {
        if (r.deck) {
          // 还没转换完成 / 失败：显示状态，不显示下载（§12.4.1）
          const view = ppt.downloadDetailView(null, r.deck, {
            mine: ppt.isMine(r.deck, identity.sid()),
            admin: identity.isAdmin()
          });
          self._m = null;
          self._deck = r.deck;
          self.setData({
            state: 'ready',
            d: view,
            errorDetail: String(r.deck.error || ''),
            shareSupported: self._shareSupported()
          });
          return;
        }
        self.setData({ state: 'error', errorText: r.reason || '演示加载失败' });
        return;
      }
      self._m = r.manifest;
      self._deck = r.deck || {};
      const view = ppt.downloadDetailView(r.manifest, self._deck, {
        mine: ppt.isMine(self._deck, identity.sid()),
        admin: identity.isAdmin()
      });
      view.errorText = String((self._deck && self._deck.error) || '');
      self.setData({
        state: 'ready',
        d: view,
        errorDetail: view.errorText,
        shareSupported: self._shareSupported()
      });
    });
  },
  retryLoad() {
    if (this._dead) return;
    this._loaded = false;
    this.setData({ errorText: '' });
    this._load();
  },

  _shareSupported() {
    try { return typeof wx.shareFileMessage === 'function'; } catch (e) { return false; }
  },
  _rowOf(key) {
    const d = this.data.d || {};
    const rows = (d.rows || []).concat(d.mediaRows || []);   // §12.8 视频/音频行同样可下载/取消/转发/复制链接
    for (let i = 0; i < rows.length; i++) if (rows[i].key === key) return rows[i];
    return null;
  },
  _keyOf(e) {
    return String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || '');
  },

  /* ---------------- 下载（§12.4.2）：进度 / 可取消 / 失败提示 ---------------- */
  downloadFile(e) {
    if (this._dead) return;
    const key = this._keyOf(e);
    const row = this._rowOf(key);
    if (!row) return;
    if (this.data.dl) { util.toast('正在下载，请稍候'); return; }
    this._startDownload(row, 'open');
  },
  _startDownload(row, after) {
    const self = this;
    this._dlKey = row.key;
    this._dlAborted = false;
    this.setData({ dl: { key: row.key, on: true, pct: -1, text: ppt.downloadText(-1) } });
    try {
      const task = wx.downloadFile({
        url: row.url,
        success: function (res) {
          self._dlTask = null;
          if (self._dead) return;
          if (!res || res.statusCode !== 200 || !res.tempFilePath) { self._downloadFail(row); return; }
          self._files[row.key] = { path: res.tempFilePath, name: row.name };
          self._dlKey = '';
          self.setData({ dl: null });
          self._afterDownload(row, res.tempFilePath, after);
        },
        fail: function () {
          self._dlTask = null;
          if (self._dead) return;
          self._downloadFail(row);
        }
      });
      this._dlTask = task || null;
      if (task && typeof task.onProgressUpdate === 'function') {
        task.onProgressUpdate(function (r) { self._onProgress(r, row); });
      }
    } catch (e) { this._downloadFail(row); }
  },
  _onProgress(r, row) {
    if (this._dead || !r || !this.data.dl || this.data.dl.key !== row.key) return;
    let pct = Number(r.progress);
    if (!isFinite(pct)) pct = ppt.downloadPct(r.totalBytesWritten, r.totalBytesExpectedToWrite);
    pct = Math.round(pct);
    this.setData({ dl: { key: row.key, on: true, pct: pct, text: ppt.downloadText(pct) } });
  },
  cancelDownload(e) {
    if (!this.data.dl) return;
    this._abortDownload();
    this.setData({ dl: null });
    util.toast('已取消下载');
  },
  _abortDownload() {
    const task = this._dlTask;
    this._dlTask = null;
    this._dlKey = '';
    this._dlAborted = true;
    if (task && typeof task.abort === 'function') { try { task.abort(); } catch (e) { /* ignore */ } }
  },
  _downloadFail(row) {
    if (this._dead) return;
    const cur = this.data.dl;
    this.setData({ dl: null });
    // 主动取消 / 已切换的下载：abort 触发的 fail 不提示失败
    if (this._dlAborted) { this._dlAborted = false; return; }
    if (!cur || cur.key !== row.key) return;
    util.toast('下载失败，请检查网络后重试');
  },
  _openLocal(row, path) {
    try {
      wx.openDocument({
        filePath: path,
        fileType: row.openType,
        showMenu: true,
        success: function () { /* 由系统/Office/WPS 打开 */ },
        fail: function () { util.toast('已下载，请用其他应用打开'); }
      });
    } catch (e) { util.toast('已下载，请用其他应用打开'); }
  },

  /* ---------------- §12.8 视频/音频单独下载完成后的动作 ----------------
   * 视频：wx.saveVideoToPhotosAlbum 保存到相册（授权失败 → showModal 引导 wx.openSetting；其它失败 → 转发/链接）
   * 音频：wx.openDocument 用系统播放器打开（失败 → 转发/链接）
   * 「转发到聊天/电脑」按钮复用 _startDownload(row,'share')，文件名用 manifest 的 name。 */
  _afterDownload(row, path, after) {
    if (row && row.media) {
      if (after === 'share') { this._shareLocal(row, path); return; }
      if (row.isVideo) this._saveVideo(row, path);
      else this._openAudio(row, path);
      return;
    }
    if (after === 'share') this._shareLocal(row, path);
    else this._openLocal(row, path);
  },
  _saveVideo(row, path) {
    const self = this;
    const fail = function (err) { self._saveVideoFail(row, path, err); };
    try {
      if (typeof wx.saveVideoToPhotosAlbum !== 'function') { fail({ errMsg: 'unsupported' }); return; }
      wx.saveVideoToPhotosAlbum({
        filePath: path,
        success: function () { util.toast('已保存到相册'); },
        fail: fail
      });
    } catch (e) { fail(e); }
  },
  _saveVideoFail(row, path, err) {
    const msg = String((err && (err.errMsg || err.message)) || '');
    // 授权失败（用户拒绝/未授权）→ 引导去设置打开「保存到相册」权限
    if (/auth|deny|permission|authorize|scope/i.test(msg)) {
      try {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置中允许「保存到相册」',
          confirmText: '去设置',
          cancelText: '取消',
          success: function (res) {
            if (res && res.confirm) { try { if (wx.openSetting) wx.openSetting({}); } catch (e) { /* ignore */ } }
          }
        });
      } catch (e) { util.toast('请在微信设置中允许保存到相册'); }
      return;
    }
    // 其它失败（基础库/模拟器不支持等）→ 有转发能力则降级转发，否则提示复制链接
    if (this._shareSupported()) { util.toast('保存失败，已改为转发'); this._shareLocal(row, path); return; }
    util.toast('保存失败，可复制链接用播放器打开');
  },
  _openAudio(row, path) {
    const self = this;
    const fallback = function () { self._audioFallback(row, path); };
    try {
      if (typeof wx.openDocument !== 'function') { fallback(); return; }
      wx.openDocument({
        filePath: path,
        showMenu: true,
        success: function () { /* 由系统播放器/WPS 打开 */ },
        fail: fallback
      });
    } catch (e) { fallback(); }
  },
  _audioFallback(row, path) {
    if (this._shareSupported()) { this._shareLocal(row, path); return; }
    util.toast('已下载，可复制链接用播放器打开');
  },

  /* ---------------- 转发 / 复制链接（§12.4.2） ---------------- */
  shareFile(e) {
    if (this._dead) return;
    const key = this._keyOf(e);
    const row = this._rowOf(key);
    if (!row) return;
    if (!this._shareSupported()) { this._copyUrl(row); return; }
    const cached = this._files[row.key];
    if (cached && cached.path) { this._shareLocal(row, cached.path); return; }
    if (this.data.dl) { util.toast('正在下载，请稍候'); return; }
    this._startDownload(row, 'share');     // 未下载过：先下载再转发（同一进度 UI）
  },
  _shareLocal(row, path) {
    try {
      wx.shareFileMessage({
        filePath: path,
        fileName: row.name,
        success: function () { /* 已转发到聊天/电脑 */ },
        fail: function () { util.toast('转发失败，可复制链接'); }
      });
    } catch (e) {
      // 端能力不可用 → 降级复制链接
      this._copyUrl(row);
    }
  },
  copyLink(e) {
    const key = this._keyOf(e);
    const row = this._rowOf(key);
    if (!row) return;
    this._copyUrl(row);
  },
  _copyUrl(row) {
    if (!row || !row.url) { util.toast('暂无可下载链接'); return; }
    try {
      wx.setClipboardData({
        data: row.url,
        success: function () { util.toast('下载链接已复制'); },
        fail: function () { util.toast('复制失败'); }
      });
    } catch (e) { util.toast('复制失败'); }
  },

  /* ---------------- 在线预览（旧播放器保留为预览入口，§12.4.3） ---------------- */
  openPreview() {
    if (this._dead || !this._id) return;
    if (this.data.dl) { util.toast('正在下载，请稍候'); return; }
    wx.navigateTo({ url: '/pages/pptplay/pptplay?id=' + encodeURIComponent(this._id) });
  },

  /* ---------------- 重新处理（旧 deck 补 compat / 失败重排；§12.3/§12.4.3） ---------------- */
  retryDeck() {
    if (this._dead) return;
    const self = this;
    ppt.retryDeck(this._id).then(function (r) {
      if (!r.ok) { util.toast(r.reason || '提交失败'); return; }
      util.toast('已提交重新处理');
      if (self.data.d) {
        const d = Object.assign({}, self.data.d, { statusText: '排队转换' });
        self.setData({ d: d });
      }
      if (self._retryT) clearTimeout(self._retryT);
      self._retryT = setTimeout(function () {
        self._retryT = null;
        if (!self._dead) { self._loaded = false; self._load(); }
      }, 2000);
    });
  },

  goAll() {
    wx.switchTab({ url: '/pages/all/all' });
  },

  onShareAppMessage() {
    return share.message({
      title: '班级工具｜演示下载',
      path: '/pages/pptdl/pptdl?id=' + encodeURIComponent(this._id || ''),
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '班级工具｜演示下载',
      imageUrl: '/images/share/default.png'
    });
  }
});
