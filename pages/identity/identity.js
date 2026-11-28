// pages/identity/identity.js —— 身份界面（启动首屏 / 唯一身份入口）
//
// 流程：输入 姓名 + 学号 → 云端 RPC class_verify → 保存 token/身份 → class_members 同步名单 → 工作台。
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
    agreed: false,
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
      // 自动进入：onReady 立即切；onShow 再放一个 600ms 兜底（冷启动 onReady 迟到时也能进）。
      if (!this._auto) {
        if (this._fallbackT) clearTimeout(this._fallbackT);
        this._fallbackT = setTimeout(() => {
          this._fallbackT = null;
          if (!this._auto && identity.has()) { this._auto = true; this._scheduleEnter(0); }
        }, 600);
      }
    } else {
      this._auto = false;
      this._entering = false;
      if (this._fallbackT) { clearTimeout(this._fallbackT); this._fallbackT = null; }
      if (this._t) { clearTimeout(this._t); this._t = null; }
      this.setData({ identity: null });
    }
  },
  onReady() {
    if (this._auto || !identity.has()) return;
    if (this._fallbackT) { clearTimeout(this._fallbackT); this._fallbackT = null; }
    this._auto = true;
    // 2026-11-17：本机已有有效身份时不再固定等 520ms；onReady 后立即切工作台。
    this._scheduleEnter(0);
  },
  _scheduleEnter(delay) {
    if (this._entering) return;
    this._entering = true;
    const tryEnter = (n) => {
      this._t = null;
      if (!identity.has()) { this._entering = false; this._auto = false; return; }
      let settled = false;
      const done = function () { settled = true; };
      try {
        wx.switchTab({ url: '/pages/index/index', success: done, fail: done });
      } catch (e) { done(); }
      // 冷启动早期 switchTab 可能挂起：500ms 后仍未回调且仍在身份页就重试（最多 5 次）。
      this._t = setTimeout(() => {
        if (settled) return;
        const pages = getCurrentPages();
        const cur = pages[pages.length - 1];
        if (cur && cur.route !== 'pages/identity/identity') { this._entering = false; return; }
        // devtools/极慢冷启动下 switchTab 可能挂起：先 reLaunch 兜底一次（tab 页同样可开），
        // 再回到 switchTab 重试；两条路都带 success/fail，不会无限等。
        if (n === 0) {
          try {
            wx.reLaunch({ url: '/pages/index/index', success: done, fail: done });
          } catch (e) { done(); }
          this._t = setTimeout(() => {
            if (!settled) { this._entering = false; this._auto = false; }
          }, 800);
          return;
        }
        if (n < 5) tryEnter(n + 1);
        else { this._entering = false; this._auto = false; }
      }, 500);
    };
    this._t = setTimeout(() => tryEnter(0), delay || 0);
  },
  onHide() {
    if (this._t) { clearTimeout(this._t); this._t = null; }
    if (this._fallbackT) { clearTimeout(this._fallbackT); this._fallbackT = null; }
    this._entering = false;
    // 若在自动进入前退到后台，允许回到前台后重新调度（已在工作台时本页会 unload，不受影响）
    this._auto = false;
  },
  onUnload() {
    if (this._t) { clearTimeout(this._t); this._t = null; }
    if (this._fallbackT) { clearTimeout(this._fallbackT); this._fallbackT = null; }
    this._entering = false;
  },

  onName(e) { this.setData({ name: e.detail.value, err: '' }); },
  onSid(e) {
    const v = String(e.detail.value || '').replace(/[^\d]/g, '').slice(0, 10);
    this.setData({ sid: v, err: '' });
  },

  // 协议勾选 / 打开原生正文（2026-11-19）
  toggleAgree() { this.setData({ agreed: !this.data.agreed }); },
  openLegal(e) {
    const type = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.type) || 'privacy');
    wx.navigateTo({ url: '/pages/legal/legal?type=' + (type === 'terms' ? 'terms' : 'privacy') });
  },
  // 真实用户点按钮：必须先勾选；submit() 核心逻辑保持不变（自动化/深链仍可直接调用）
  submitTap() {
    if (!this.data.agreed) {
      wx.showToast({ title: '请先勾选同意《用户协议》《隐私政策》', icon: 'none' });
      return;
    }
    this.submit();
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
