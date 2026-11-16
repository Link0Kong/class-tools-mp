// pages/cloudspace/cloudspace.js —— 文件传输 · 临时云空间（2026-11-12 与网页端同步）
//
// 语义：同账号跨设备自动共享同一云空间（无需房间码/链接/配对）；上传/下载/删除/清空；
//       文件自上传完成起保留 72 小时；任意大小，8MiB 分片上传。
// 后端：ECS drop 服务 v2.2（契约 web/drop/CONTRACT.md），API/纯逻辑见 utils/cloudspace.js。
//
// 说明：
//   * 上传来源用 wx.chooseMessageFile（从微信聊天选择文件）；大文件逐片读取（FileSystemManager.readFile
//     的 position/length）→ ArrayBuffer 原始 POST，避免整文件读入内存；
//   * 下载：wx.downloadFile → openDocument（文档）→ 失败则 shareFileMessage（发回聊天）→ 再失败提示；
//   * 正式版需在微信后台配置 request + downloadFile 合法域名（默认 https://tool.furina.fun/drop），
//     开发/体验版默认直连 ECS http://121.196.47.2/drop（需开发者工具「不校验合法域名」）。
const identity = require('../../utils/identity.js');
const cloudspace = require('../../utils/cloudspace.js');
const share = require('../../utils/share.js');
const util = require('../../utils/util.js');

const POLL_MS = 5000;

Page({
  data: {
    loading: true,
    err: '',
    files: [],
    ups: [],
    count: 0,
    bytesText: '0 B',
    expired: 0,
    uploading: 0
  },

  onLoad: function () {
    this._sessionId = '';
    this._pollTimer = 0;
    this._dead = false;
    this._refreshIng = false;
    this._opened = {};
    try { this._opened = JSON.parse(wx.getStorageSync('zq_mp_file_opened_v1') || '{}') || {}; } catch (e) { this._opened = {}; }
  },

  _saveOpened: function () {
    try {
      var keys = Object.keys(this._opened);
      if (keys.length > 500) {
        var trimmed = {};
        keys.slice(-500).forEach(function (k) { trimmed[k] = this._opened[k]; }, this);
        this._opened = trimmed;
      }
      wx.setStorageSync('zq_mp_file_opened_v1', JSON.stringify(this._opened));
    } catch (e) {}
  },

  onShow: function () {
    share.enable();
    if (!identity.ensure()) return;
    this._dead = false;
    if (!this._sessionId) this.boot();
    else this.refresh(true);
    this.startPoll();
  },

  onHide: function () { this.stopPoll(); },
  onUnload: function () { this._dead = true; this.stopPoll(); },
  onPullDownRefresh: function () {
    var that = this;
    this.refresh(true).then(function () { try { wx.stopPullDownRefresh(); } catch (e) {} });
  },

  onShareAppMessage: function () {
    return share.message({
      title: '班级工具｜文件传输 · 临时云空间，同账号跨设备',
      path: '/pages/cloudspace/cloudspace',
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline: function () {
    return share.timeline({
      title: '班级工具｜文件传输 · 临时云空间，文件保留 3 天',
      imageUrl: '/images/share/default.png'
    });
  },

  // ---------------------------------------------------------------- 云空间连接
  boot: function () {
    var that = this;
    this.setData({ loading: true, err: '' });
    cloudspace.mine().then(function (r) {
      if (that._dead) return null;
      if (r && r.ok && r.session) return r.session;
      return cloudspace.open().then(function (r2) {
        if (!r2 || !r2.ok || !r2.session) {
          that.setData({ loading: false, err: (r2 && r2.reason) || '云空间连接失败' });
          return null;
        }
        return r2.session;
      });
    }).catch(function () {
      that.setData({ loading: false, err: '云空间服务不可达' });
      return null;
    }).then(function (sess) {
      if (!sess || that._dead) return;
      that._sessionId = String(sess.id || '');
      that.startPoll();
      that.refresh(true);
    });
  },

  refresh: function (force) {
    var that = this;
    if (!this._sessionId || this._refreshIng) return Promise.resolve(false);
    this._refreshIng = true;
    return cloudspace.state(this._sessionId).then(function (r) {
      that._refreshIng = false;
      if (that._dead) return false;
      if (!r || !r.ok) {
        that.setData({ loading: false, err: (r && r.reason) || '连接中断' });
        return false;
      }
      if (r.session) that._sessionId = String(r.session.id || that._sessionId);
      var view = cloudspace.spaceView(r.events || [], Date.now());
      var opened = that._opened || {};
      view.files = view.files.map(function (f) {
        var n = {};
        Object.keys(f).forEach(function (k) { n[k] = f[k]; });
        n.opened = !!opened[String(f.id)];
        return n;
      });
      that.setData({
        loading: false, err: '',
        files: view.files, count: view.count, bytesText: view.bytesText, expired: view.expired
      });
      that.startPoll();
      return true;
    }).catch(function () {
      that._refreshIng = false;
      that.setData({ loading: false, err: '网络不可用，稍后重试' });
      return false;
    });
  },

  startPoll: function () {
    var that = this;
    this.stopPoll();
    this._pollTimer = setInterval(function () {
      if (that._dead) return;
      that.refresh(false);
    }, POLL_MS);
  },
  stopPoll: function () {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = 0; }
  },

  onRefreshTap: function () {
    if (this._sessionId) this.refresh(true);
    else this.boot();
  },

  retry: function () { this.boot(); },

  // ---------------------------------------------------------------- 上传
  chooseFiles: function () {
    var that = this;
    if (!this._sessionId) {
      util.toast('云空间连接中，请稍后再选');
      return;
    }
    if (!wx.chooseMessageFile) {
      util.toast('当前微信版本不支持选择文件');
      return;
    }
    wx.chooseMessageFile({
      count: 9,
      type: 'all',
      success: function (res) {
        var list = (res && res.tempFiles) || [];
        list.forEach(function (f) { that.uploadOne(f); });
      },
      fail: function () { /* 用户取消 */ }
    });
  },

  uploadOne: function (file) {
    var that = this;
    var name = cloudspace.safeName(file && file.name);
    var size = Number(file && file.size) || 0;
    var path = String((file && file.path) || '');
    if (!size || !path) { util.toast('文件读取失败'); return; }
    var plan = cloudspace.chunkPlan(size);
    var item = {
      id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: name, size: size, sizeText: cloudspace.fmtSize(size),
      pct: 0, sent: 0, state: 'init', stateText: '准备上传…'
    };
    this.pushUp(item);
    cloudspace.initUpload(this._sessionId, name, size, file.type || 'application/octet-stream', plan.totalChunks).then(function (r) {
      if (!r || !r.ok) { that.updateUp(item.id, { state: 'err', stateText: (r && r.reason) || '初始化失败' }); return; }
      var uploadId = String(r.uploadId || '');
      var cs = Number(r.chunkSize) || cloudspace.CHUNK;
      var seq = Promise.resolve(true);
      plan.chunks.forEach(function (c) {
        seq = seq.then(function () {
          if (!uploadId) return false;
          that.updateUp(item.id, { state: 'up', stateText: '上传中…', pct: Math.min(99, Math.round((c.start / size) * 100)) });
          return that.readChunk(path, c.start, c.size, cs).then(function (buf) {
            return cloudspace.chunkUpload(uploadId, c.index, buf);
          }).then(function (rr) {
            if (!rr || !rr.ok) throw new Error((rr && rr.reason) || '分片上传失败');
            var pct = Math.min(99, Math.round((c.end / size) * 100));
            that.updateUp(item.id, { sent: c.end, pct: pct, stateText: '上传中…' });
            return true;
          });
        });
      });
      seq.then(function () {
        return cloudspace.finishUpload(that._sessionId, uploadId);
      }).then(function (rr) {
        if (!rr || !rr.ok) throw new Error((rr && rr.reason) || '完成上传失败');
        that.updateUp(item.id, { state: 'done', stateText: '已上传', pct: 100, sent: size });
        util.toast('已上传：' + name);
        that.refresh(true);
      }).catch(function (e) {
        that.updateUp(item.id, { state: 'err', stateText: (e && e.message) || '上传失败' });
      });
    }).catch(function () {
      that.updateUp(item.id, { state: 'err', stateText: '网络不可用' });
    });
  },

  // 逐片读取：position/length（不把整个大文件读进内存）
  readChunk: function (path, start, len, cs) {
    return new Promise(function (resolve, reject) {
      try {
        wx.getFileSystemManager().readFile({
          filePath: path,
          position: start,
          length: len,
          success: function (r) { resolve(r.data); },
          fail: function () { reject(new Error('读取文件失败')); }
        });
      } catch (e) { reject(new Error('读取文件失败')); }
    });
  },

  pushUp: function (item) {
    var ups = this.data.ups.concat([item]);
    this.setData({ ups: ups, uploading: ups.length });
  },
  updateUp: function (id, patch) {
    var ups = this.data.ups.map(function (u) {
      if (u.id !== id) return u;
      var n = {};
      Object.keys(u).forEach(function (k) { n[k] = u[k]; });
      Object.keys(patch || {}).forEach(function (k) { n[k] = patch[k]; });
      return n;
    });
    var uploading = ups.filter(function (u) { return u.state === 'up' || u.state === 'init'; }).length;
    this.setData({ ups: ups, uploading: uploading });
  },

  // ---------------------------------------------------------------- 下载 / 删除 / 清空
  download: function (e) {
    var id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    var f = null;
    this.data.files.forEach(function (x) { if (String(x.id) === id) f = x; });
    if (!f || !f.url) { util.toast('文件不存在或已过期'); return; }
    var that = this;
    wx.showLoading({ title: '下载中…', mask: true });
    wx.downloadFile({
      url: f.url,
      success: function (res) {
        try { wx.hideLoading(); } catch (e2) {}
        if (!res || res.statusCode !== 200) { util.toast('下载失败'); return; }
        that._opened[String(f.id)] = Date.now();
        that._saveOpened();
        that.setData({ files: that.data.files.map(function (x) {
          if (String(x.id) !== String(f.id)) return x;
          var n = {}; Object.keys(x).forEach(function (k) { n[k] = x[k]; }); n.opened = true; return n;
        }) });
        that.openDownloaded(res.tempFilePath, f);
      },
      fail: function () {
        try { wx.hideLoading(); } catch (e2) {}
        util.toast('下载失败，请检查网络或域名配置');
      }
    });
  },

  openDownloaded: function (filePath, f) {
    var that = this;
    var isImage = f && f.mime && f.mime.indexOf('image/') === 0;
    if (isImage) {
      wx.previewImage({
        urls: [f.url],
        fail: function () { that.shareDownloaded(filePath, f); }
      });
      return;
    }
    if (wx.openDocument) {
      wx.openDocument({
        filePath: filePath,
        showMenu: true,
        fail: function () { that.shareDownloaded(filePath, f); }
      });
      return;
    }
    this.shareDownloaded(filePath, f);
  },

  shareDownloaded: function (filePath, f) {
    var that = this;
    if (wx.shareFileMessage) {
      wx.shareFileMessage({
        filePath: filePath,
        fileName: (f && f.name) || '文件',
        success: function () {},
        fail: function () {
          util.toast('已下载：' + ((f && f.name) || '文件'));
        }
      });
      return;
    }
    util.toast('已下载：' + ((f && f.name) || '文件'));
  },

  del: function (e) {
    var that = this;
    var id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    if (!id || !this._sessionId) return;
    wx.showModal({
      title: '删除文件',
      content: '删除后不可恢复，确定删除这个文件？',
      success: function (r) {
        if (!r || !r.confirm) return;
        cloudspace.deleteFile(id, that._sessionId).then(function (rr) {
          if (!rr || !rr.ok) { util.toast((rr && rr.reason) || '删除失败'); return; }
          util.toast('已删除');
          that.refresh(true);
        }).catch(function () { util.toast('网络不可用'); });
      }
    });
  },

  clearSpace: function () {
    var that = this;
    if (!this._sessionId) return;
    wx.showModal({
      title: '清空云空间',
      content: '将立即删除全部文件，且不可恢复。确定清空？',
      success: function (r) {
        if (!r || !r.confirm) return;
        cloudspace.closeSpace(that._sessionId).then(function (rr) {
          if (rr && rr.ok === false) { util.toast((rr && rr.reason) || '清空失败'); return; }
          that._sessionId = '';
          that.setData({ files: [], ups: [], count: 0, bytesText: '0 B', expired: 0 });
          util.toast('云空间已清空');
          that.boot();
        }).catch(function () { util.toast('网络不可用'); });
      }
    });
  }
});
