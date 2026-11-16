// pages/committee/committee.js —— 名单（班委 / 团员 / 全班）
// 与网页版「名单」工具同口径（web/AGENTS.md §33）：
//   * 班委：class_members 中 role/badge 非空的成员；管理员可进入「管理」设置职务；
//   * 团员：class_league RPC（utils/cloud.js leaguePull，6h TTL + 本机缓存）∩ 班级名单；
//   * 全班：全部成员，仅姓名与座号。
// 数据来源：CloudBase RPC class_members / class_league / class_set_role（仅管理员）。
// 隐私：页面只显示姓名与座号；不显示/不导出学号。
const identity = require('../../utils/identity.js');
const cloud = require('../../utils/cloud.js');
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');
const share = require('../../utils/share.js');
const agent = require('../../utils/agent.js');
const scrollmem = require('../../utils/scrollmem.js');
const roster = require('../../utils/roster.js');

const TABS = ['committee', 'league', 'all'];
const TAB_LABEL = { committee: '班委', league: '团员', all: '全班' };

function fmtSync(ts) {
  if (!ts) return '尚未同步';
  const d = new Date(Number(ts));
  if (isNaN(d)) return '尚未同步';
  return util.pad(d.getMonth() + 1) + '-' + util.pad(d.getDate()) + ' ' + util.pad(d.getHours()) + ':' + util.pad(d.getMinutes());
}

Page({
  data: {
    tab: 'committee',
    edit: false,
    canManage: false,
    syncing: false,
    state: 'loading',
    list: [],
    counts: { committee: 0, league: 0, leagueText: '', all: 0 },
    note: '',
    emptyText: '暂无班委身份信息',
    atText: '',
    err: ''
  },

  onLoad(options) {
    scrollmem.attach(this);
    options = options || {};
    this._agent = agent.pick(this);            // AI 页面接力（wx.onAgentHandoff），只消费一次
    this._agentQ = agent.pickQuery(options);   // 备用：handoff query 随页面参数传入
    this._leagueLoaded = false;
    this._leagueErr = '';
    this._leagueLoading = false;
  },

  onShow() {
    share.enable();
    scrollmem.restore(this);
    if (!identity.ensure()) return;
    this._leagueLoaded = !!(store.get().classLeagueAt);
    this.setData({ canManage: !!(cloud.isAdmin && cloud.isAdmin()) });
    this.render();
    const ho = this.applyAgentHandoff();
    if (!cloud.memberCount()) this.pull();
    else if (ho) this.silentPull();            // 接力进入时后台强制刷新一次名单（不阻塞）
    if (this.data.tab === 'league' && !this._leagueLoaded) this.fetchLeague();
  },

  onPullDownRefresh() {
    if (!identity.ensure()) { wx.stopPullDownRefresh(); return; }
    this.pull(() => wx.stopPullDownRefresh());
  },

  // —— AI 页面接力：payload 里的名单先渲染，随后 silentPull 用云端最新名单覆盖 ——
  applyAgentHandoff() {
    if (this._agentApplied) return false;
    this._agentApplied = true;
    const h = this._agent;
    const p = (h && h.payload) || {};
    const q = Object.assign({}, this._agentQ || {}, (h && h.query) || {});
    if (!h && !this._agentQ) return false;
    const roleOnly = !!(q.roleOnly || p.roleOnly);
    const items = Array.isArray(p.items) ? p.items : (Array.isArray(p.members) ? p.members : null);
    if (items && items.length) {
      const list = items.filter(function (m) { return m && (!roleOnly || m.role); }).map(function (m) {
        return {
          key: String(m.sid || m.seat || m.name || ''),
          seat: m.seat,
          name: m.name || '',
          role: m.role || '',
          badge: util.showBadge(m.badge, m.role),
          isAdmin: !!m.isAdmin || !!m.is_admin,
          sid: m.sid || '',
          showLeague: false
        };
      }).sort(function (a, b) {
        return ((roster.ROLE_RANK[a.role] || 99) - (roster.ROLE_RANK[b.role] || 99)) || ((+a.seat || 0) - (+b.seat || 0));
      });
      this.setData({ tab: 'committee', state: 'data', list: list });
    }
    return true;
  },

  silentPull() {
    cloud.classMembersPull(true).then(() => { this.render(); }).catch(function () { /* 离线保留本机缓存 */ });
  },

  pull(cb) {
    const force = typeof cb === 'function' || cb === true;
    const done = typeof cb === 'function' ? cb : null;
    this.setData({ state: this.data.list.length ? 'data' : 'loading', err: '' });
    // 下拉刷新（带回调）才强制打网络；onShow 进页走 TTL 缓存
    cloud.classMembersPull(force).then((list) => {
      if (done) done();
      if (!list || !list.length) {
        this.setData({ state: 'empty', err: '名单同步失败，请下拉重试' });
        this.render();
        return;
      }
      this.render();
      if (this.data.tab === 'league' || force) this.fetchLeague();
    }).catch(() => {
      if (done) done();
      this.setData({ state: 'empty', err: '名单同步失败，请下拉重试' });
      this.render();
    });
  },

  // 团员名单按需加载（首次进入团员 tab / 下拉刷新 / 切到团员 tab）
  fetchLeague(force) {
    if (this._leagueLoading) return;
    this._leagueLoading = true;
    if (!this._leagueLoaded) this.setData({ state: 'loading' });
    cloud.leaguePull(!!force).then((arr) => {
      this._leagueLoading = false;
      this._leagueLoaded = true;
      this._leagueErr = '';
      if (!arr || !arr.length) { /* 空名单：按「暂无团员名单」展示，可在下拉刷新重试 */ }
      this.render();
    }).catch(() => {
      this._leagueLoading = false;
      this._leagueLoaded = true;
      this._leagueErr = '团员名单不可用';
      this.render();
    });
  },

  render() {
    const all = roster.members();
    const league = cloud.league();
    const view = roster.listView(this.data.tab, {
      members: all,
      league: league,
      leagueLoaded: this._leagueLoaded,
      leagueErr: this._leagueErr,
      edit: this.data.edit
    });
    const list = view.rows.map(function (m) {
      const badge = util.showBadge(m.badge, m.role);   // 需求 2：职务已展示时不重复「班委」徽章
      return {
        key: m.key,
        seat: m.seat,
        name: m.name,
        role: m.role || '',
        badge: badge,
        showBadge: !!badge,
        isAdmin: !!m.isAdmin,
        sid: m.sid || '',
        showLeague: !!m.showLeague,
        canEditRole: !!(this.data.edit && this.data.tab === 'committee' && m.sid)
      };
    }, this);
    const state = list.length ? 'data' : (all.length || this._leagueLoaded ? 'empty' : 'loading');
    this.setData({
      state: state,
      list: list,
      counts: view.counts,
      note: view.note,
      emptyText: view.emptyText,
      atText: fmtSync(store.get().classMembersAt)
    });
  },

  switchTab(e) {
    const tab = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.tab) || '').trim();
    if (TABS.indexOf(tab) < 0 || tab === this.data.tab) return;
    this.setData({ tab: tab, edit: false });
    if (tab === 'league' && !this._leagueLoaded) {
      this.setData({ state: 'loading' });
      this.fetchLeague();
    } else {
      this.render();
    }
  },

  toggleEdit() {
    if (!this.data.canManage || this.data.tab !== 'committee') return;
    this.setData({ edit: !this.data.edit });
    this.render();
  },

  // 管理员「管理」态：点成员设置/清除职务（editable showModal，留空=清除）
  onRowTap(e) {
    if (!this.data.edit || this.data.tab !== 'committee') return;
    if (!this.data.canManage) return;
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const sid = String(ds.sid || '');
    const name = String(ds.name || '');
    const role = String(ds.role || '');
    if (!sid) return;
    const self = this;
    wx.showModal({
      title: '设置「' + name + '」的职务',
      content: role,
      editable: true,
      placeholderText: '如：班长（留空清除）',
      success: function (res) {
        if (!res || !res.confirm) return;
        if (res.content === undefined) { util.toast('当前微信版本不支持编辑，请升级后再试'); return; }
        const next = String(res.content == null ? '' : res.content).trim();
        self.setData({ syncing: true });
        cloud.classSetRole(sid, next).then(function () {
          return cloud.classMembersPull(true);
        }).then(function () {
          self._leagueLoaded = !!(store.get().classLeagueAt);
          self.setData({ syncing: false });
          self.render();
          util.toast('已更新班委名单');
        }).catch(function () {
          self.setData({ syncing: false });
          self.render();
          util.toast('更新失败');
        });
      }
    });
  },

  refresh() {
    this.setData({ err: '' });
    this.pull(true);
  },

  onPageScroll(e) { scrollmem.onScroll(this, e); },
  onHide() { scrollmem.save(this); },
  onUnload() { scrollmem.save(this); },

  onShareAppMessage() {
    const tab = this.data.tab;
    const label = TAB_LABEL[tab] || '名单';
    const n = tab === 'league' ? this.data.counts.league : (tab === 'all' ? this.data.counts.all : this.data.counts.committee);
    return share.message({
      title: n ? ('名单｜' + label + ' ' + n + ' 人') : ('名单｜' + label),
      path: '/pages/committee/committee',
      imageUrl: '/images/share/bz.png'
    });
  },
  onShareTimeline() {
    const tab = this.data.tab;
    const label = TAB_LABEL[tab] || '名单';
    return share.timeline({
      title: '名单｜班委 · 团员 · 全班（' + label + '）',
      imageUrl: '/images/share/bz.png'
    });
  }
});
