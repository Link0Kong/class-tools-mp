// pages/identity/identity.js —— 身份界面（启动首屏 / 唯一身份入口）
//
// 流程：输入 姓名 + 学号 → CloudBase RPC class_verify → 保存 token/身份 → class_members 同步名单 → 工作台。
// 说明：本机已有有效身份时（如从工作台返回/热启动），短暂展示身份卡后自动进入工作台。
const identity = require('../../utils/identity.js');
const share = require('../../utils/share.js');
const agent = require('../../utils/agent.js');

function viewOf(id) {
  if (!id) return null;
  return {
    name: id.name,
    role: id.role || '',
    badge: id.badge || '',
    isAdmin: !!id.is_admin
  };
}

Page({
  data: {
    name: '',
    sid: '',
    err: '',
    verifying: false,
    identity: null
  },

  onLoad(options) {
    options = options || {};
    // AI 接力到身份页（未认证 / 身份失效）：消费掉 handoff 即可，页面守卫与自动进入工作台逻辑不变
    this._agent = agent.pick(this);
    this._agentQ = agent.pickQuery(options);
    this._auto = false;
  },
  onShow() {
    share.enable();
    const id = identity.get();
    if (id) {
      this.setData({ identity: viewOf(id), name: id.name, sid: id.sid, err: '' });
      if (!this._auto) {
        this._auto = true;
        this._t = setTimeout(() => {
          this._t = null;
          if (identity.has()) wx.switchTab({ url: '/pages/index/index' });
        }, 520);
      }
    } else {
      this._auto = false;
      if (this._t) { clearTimeout(this._t); this._t = null; }
      this.setData({ identity: null });
    }
  },
  onHide() { if (this._t) { clearTimeout(this._t); this._t = null; } },
  onUnload() { if (this._t) { clearTimeout(this._t); this._t = null; } },

  onName(e) { this.setData({ name: e.detail.value, err: '' }); },
  onSid(e) {
    const v = String(e.detail.value || '').replace(/[^\d]/g, '').slice(0, 10);
    this.setData({ sid: v, err: '' });
  },

  submit() {
    if (this.data.verifying) return;
    const name = String(this.data.name || '').trim();
    const sid = String(this.data.sid || '').trim();
    if (!name) { this.setData({ err: '请填写真实姓名' }); return; }
    if (!/^\d{10}$/.test(sid)) { this.setData({ err: '学号应为 10 位数字' }); return; }
    this.setData({ verifying: true, err: '' });
    identity.login(sid, name).then((r) => {
      this.setData({ verifying: false });
      if (!r || !r.ok) {
        this.setData({ err: (r && r.reason) || '验证失败，请重试' });
        return;
      }
      this.setData({ identity: viewOf(r.identity) });
      if (r.membersFailed) {
        wx.showToast({ title: '身份已验证，班级名单稍后同步', icon: 'none', duration: 1200 });
      } else {
        wx.showToast({ title: '欢迎，' + (r.identity && r.identity.name ? r.identity.name : name), icon: 'success', duration: 900 });
      }
      setTimeout(() => {
        this._auto = true;
        wx.switchTab({ url: '/pages/index/index' });
      }, 900);
    }).catch(() => {
      this.setData({ verifying: false, err: '网络不可用，请检查网络后重试' });
    });
  },

  enter() {
    if (!identity.has()) { identity.goIdentity(); return; }
    wx.switchTab({ url: '/pages/index/index' });
  },

  switchIdentity() {
    wx.showModal({
      title: '切换身份',
      content: '将清空本机保存的身份与班级名单缓存，重新输入姓名 + 学号验证。',
      confirmText: '切换',
      confirmColor: '#5E8F87',
      success: (r) => { if (r.confirm) identity.logout(); }
    });
  },
  onShareAppMessage() {
    return share.message({
      title: '班级工具｜身份验证',
      path: '/pages/identity/identity',
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '班级工具｜身份验证',
      imageUrl: '/images/share/default.png'
    });
  }
});
