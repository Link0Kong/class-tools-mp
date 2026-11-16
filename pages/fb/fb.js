// pages/fb/fb.js —— 反馈建议（提交表单 + 我的反馈 + 管理员列表）
// 云端契约：feedback 表 {id,content,contact,acc,done,ts}；acc 存学号，展示时映射班级姓名。
// 1.5.2 起不再收集 QQ / 微信联系方式：contact 列保留（兼容表结构与旧数据），新提交固定空串，页面不展示。
const util = require('../../utils/util.js');
const identity = require('../../utils/identity.js');
const cloud = require('../../utils/cloud.js');
const share = require('../../utils/share.js');
const agent = require('../../utils/agent.js');
const scrollmem = require('../../utils/scrollmem.js');

function fmt(ts) {
  const d = new Date(Number(ts) || 0);
  if (isNaN(d.getTime()) || !Number(ts)) return '';
  return d.getFullYear() + '-' + util.pad(d.getMonth() + 1) + '-' + util.pad(d.getDate()) +
    ' ' + util.pad(d.getHours()) + ':' + util.pad(d.getMinutes());
}

Page({
  data: {
    text: '',
    scrolled: false,
    subtitle: '把建议或问题发给管理员',
    isAdmin: false,
    showList: true,
    state: 'data', errorText: '',
    raw: [], list: [],
    filter: 'mine', segs: [],
    emptyTitle: '还没有反馈', emptyText: ''
  },

  onLoad(options) {
    scrollmem.attach(this);
    options = options || {};
    this._agent = agent.pick(this);            // AI 页面接力（wx.onAgentHandoff），只消费一次
    this._agentQ = agent.pickQuery(options);   // 备用：handoff query 随页面参数传入
    this._first = true;
  },
  onShow() {
    share.enable();
    scrollmem.restore(this);
    if (!identity.ensure()) return;
    this.applyAgentHandoff();
    this.setData({ isAdmin: identity.isAdmin() });
    if (this._first) {
      this._first = false;
      setTimeout(() => { this.refresh(); this.pull(); }, 140);
    } else {
      this.refresh();
      this.pull();
    }
  },
  // —— AI 页面接力：tab=mine（我的反馈）与页面既有筛选一致；普通用户本就只看自己的反馈 ——
  applyAgentHandoff() {
    if (this._agentApplied) return false;
    this._agentApplied = true;
    const h = this._agent;
    const p = (h && h.payload) || {};
    const q = Object.assign({}, this._agentQ || {}, (h && h.query) || {});
    if (!h && !this._agentQ) return false;
    const tab = String(q.tab || p.tab || '');
    if (tab === 'mine' && identity.isAdmin()) this.setData({ filter: 'all' });
    return true;
  },
  onPageScroll(e) {
    scrollmem.onScroll(this, e);
    const y = e.scrollTop;
    const next = y > 64 ? true : (y < 20 ? false : this.data.scrolled);
    if (next !== this.data.scrolled && !this._scBusy) {
      this._scBusy = true;
      this.setData({ scrolled: next }, () => { this._scBusy = false; });
    }
  },
  onPullDownRefresh() { this.pull(); wx.stopPullDownRefresh(); },
  onHide() { scrollmem.save(this); },
  onUnload() { scrollmem.save(this); },

  // 本地筛选 + 渲染（不改动云端数据）
  refresh() {
    const mySid = identity.sid();
    const myName = identity.name();
    const cm = identity.isAdmin();
    const raw = this.data.raw || [];
    let segs, filter = this.data.filter;
    if (cm) {
      segs = [{ id: 'all', label: '全部' }, { id: 'todo', label: '未处理' }, { id: 'done', label: '已处理' }];
      if (filter !== 'all' && filter !== 'todo' && filter !== 'done') filter = 'all';
    } else {
      segs = [{ id: 'mine', label: '我的反馈' }];
      filter = 'mine';
    }
    const mine = raw.filter(function (f) { return (f.acc || '') === mySid; });
    let list = raw;
    if (!cm) list = mine;
    else if (filter === 'todo') list = raw.filter(function (f) { return !f.done; });
    else if (filter === 'done') list = raw.filter(function (f) { return !!f.done; });
    list = list.map(function (f) {
      const acc = String(f.acc || '');
      const nm = acc && acc === mySid ? myName : cloud.memberName(acc);
      const who = nm || '（未知成员）';
      return {
        id: f.id, who: who, content: f.content || '', done: !!f.done,
        metaText: fmt(f.ts)
      };
    });
    this.setData({
      isAdmin: cm, showList: true, segs: segs, filter: filter,
      list: list,
      subtitle: cm ? '共 ' + raw.length + ' 条 · 可标记已处理' : '把建议或问题发给管理员',
      state: list.length ? 'data' : 'empty',
      emptyTitle: cm ? '暂无反馈' : '你还没有提交过反馈',
      emptyText: ''
    });
  },

  // 拉云端
  pull() {
    if (!cloud.isEnabled()) {
      this.setData({ raw: [] });
      this.refresh();
      return;
    }
    cloud.fbPull().then((list) => {
      this.setData({ raw: Array.isArray(list) ? list : [] });
      this.refresh();
    }).catch(() => { this.refresh(); });
  },

  onText(e) { this.setData({ text: e.detail.value }); },
  onSeg(e) { this.setData({ filter: e.detail.value }, () => this.refresh()); },

  submit() {
    const t = (this.data.text || '').trim();
    if (!t) { util.toast('写点反馈内容'); return; }
    cloud.fbSend(t).then((r) => {
      if (r && r.ok) {
        util.toast('已提交，谢谢');
        this.setData({ text: '' });
        this.pull();
      } else {
        util.toast((r && r.reason) || '网络不可用，请稍后再试');
      }
    });
  },

  markDone(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const row = (this.data.raw || []).filter(function (f) { return f.id === id; })[0] || null;
    cloud.fbDone(id, row).then((ok) => {
      util.toast(ok ? '已标记' : '标记失败，请重试');
      if (ok) this.pull();
    });
  },
  onShareAppMessage() {
    return share.message({
      title: '班级工具｜反馈建议',
      path: '/pages/fb/fb',
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '班级工具｜反馈建议',
      imageUrl: '/images/share/default.png'
    });
  }
});
