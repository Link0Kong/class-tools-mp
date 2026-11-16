// pages/screencast/screencast.js —— 微信小程序「大屏互联」控制器（2026-11-12）
//
// 仅当电脑大屏已开启（drop /presence 30s 内在线）时可用；入口在「全部工具」里动态出现。
// 能力：发文字到大屏、传文件（8MiB 分片）、遥控（聚焦/计时/抽签/全屏/关闭大屏）。
// 复用 utils/screencast.js（同一 drop 服务；鉴权 X-Device-Id = 班级 token）。
const identity = require('../../utils/identity.js');
const screencast = require('../../utils/screencast.js');
const cloudspace = require('../../utils/cloudspace.js');
const share = require('../../utils/share.js');
const util = require('../../utils/util.js');

Page({
  data: {
    checking: true,
    stageOn: false,
    connected: false,
    err: '',
    text: '',
    sending: false,
    ups: [],
    cmds: screencast.CMD_DEFS
  },

  onLoad: function () {
    this._sessionId = '';
    this._dead = false;
  },

  onShow: function () {
    share.enable();
    if (!identity.ensure()) return;
    this._dead = false;
    this.check();
  },

  onHide: function () {},
  onUnload: function () { this._dead = true; },

  onShareAppMessage: function () {
    return share.message({
      title: '班级工具｜大屏互联（同账号传文件/遥控）',
      path: '/pages/screencast/screencast',
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline: function () {
    return share.timeline({
      title: '班级工具｜大屏互联（同账号传文件/遥控）',
      imageUrl: '/images/share/default.png'
    });
  },

  check: function () {
    var that = this;
    this.setData({ checking: true, err: '' });
    screencast.presence().then(function (r) {
      if (that._dead) return;
      if (!r.stage) {
        that.setData({ checking: false, stageOn: false, connected: false, err: '' });
        return;
      }
      that.setData({ stageOn: true });
      screencast.ensureSession().then(function (sess) {
        if (that._dead) return;
        if (!sess || !sess.id) {
          that.setData({ checking: false, connected: false, err: '大屏会话不可用' });
          return;
        }
        that._sessionId = String(sess.id);
        that.setData({ checking: false, connected: true, err: '' });
      }).catch(function () {
        that.setData({ checking: false, connected: false, err: '网络不可用，稍后重试' });
      });
    }).catch(function () {
      that.setData({ checking: false, err: '网络不可用，稍后重试' });
    });
  },

  onTextInput: function (e) {
    this.setData({ text: String((e && e.detail && e.detail.value) || '') });
  },

  sendText: function () {
    var that = this;
    var txt = String(this.data.text || '');
    if (!this._sessionId) { util.toast('大屏未连接'); return; }
    if (!txt.trim()) { util.toast('先输入文字'); return; }
    if (this.data.sending) return;
    this.setData({ sending: true });
    screencast.sendText(this._sessionId, txt).then(function (r) {
      if (that._dead) return;
      that.setData({ sending: false });
      if (!r || !r.ok) { util.toast((r && r.reason) || '发送失败'); return; }
      that.setData({ text: '' });
      util.toast('已发送到大屏');
    }).catch(function () { that.setData({ sending: false }); util.toast('网络不可用'); });
  },

  chooseFile: function () {
    var that = this;
    if (!this._sessionId) { util.toast('大屏未连接'); return; }
    if (!wx.chooseMessageFile) { util.toast('当前微信版本不支持选择文件'); return; }
    wx.chooseMessageFile({
      count: 9,
      type: 'all',
      success: function (res) {
        var list = (res && res.tempFiles) || [];
        list.forEach(function (f) { that.uploadOne(f); });
      },
      fail: function () {}
    });
  },

  uploadOne: function (file) {
    var that = this;
    var item = {
      id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: cloudspace.safeName(file && file.name),
      pct: 0,
      stateText: '上传中…'
    };
    var ups = this.data.ups.concat([item]);
    this.setData({ ups: ups });
    screencast.uploadFile(file, function (pct) {
      that.updateUp(item.id, { pct: pct });
    }).then(function (r) {
      if (that._dead) return;
      if (!r || !r.ok) {
        that.updateUp(item.id, { stateText: (r && r.reason) || '上传失败' });
        util.toast((r && r.reason) || '上传失败');
        return;
      }
      that.updateUp(item.id, { pct: 100, stateText: '已发送到大屏' });
      util.toast('已发送：' + item.name);
    }).catch(function () {
      that.updateUp(item.id, { stateText: '网络不可用' });
    });
  },

  updateUp: function (id, patch) {
    var ups = this.data.ups.map(function (u) {
      if (u.id !== id) return u;
      var n = {};
      Object.keys(u).forEach(function (k) { n[k] = u[k]; });
      Object.keys(patch || {}).forEach(function (k) { n[k] = patch[k]; });
      return n;
    });
    this.setData({ ups: ups });
  },

  onCmd: function (e) {
    var that = this;
    var key = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.cmd) || '');
    if (!key) return;
    if (!this._sessionId) { util.toast('大屏未连接'); return; }
    if (key === 'stage_close') {
      wx.showModal({
        title: '关闭大屏',
        content: '将让电脑退出大屏（不影响文件云空间）。确定？',
        success: function (r) {
          if (!r || !r.confirm) return;
          screencast.sendCmd(that._sessionId, key).then(function (rr) {
            util.toast(rr && rr.ok ? '已发送关闭指令' : ((rr && rr.reason) || '发送失败'));
            that.check();
          });
        }
      });
      return;
    }
    screencast.sendCmd(this._sessionId, key).then(function (r) {
      if (!r || !r.ok) { util.toast((r && r.reason) || '指令失败'); return; }
      util.toast('已发送');
    }).catch(function () { util.toast('网络不可用'); });
  },

  retry: function () { this.check(); }
});
