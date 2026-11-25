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
const sharecard = require('../../utils/sharecard.js');
const shareflow = require('../../utils/shareflow.js');

const TABS = ['committee', 'league', 'all'];
const TAB_LABEL = { committee: '班委', league: '团员', all: '全班' };

/* 左右滑动切换分类（与课表页 pages/tt 同一套手感，用户 2026-11-19 要求「增加名单的滑动切换功能和对应动效」）：
   横向锁定 12px → 1:1 跟手 → 松手：过 56px 提交（旧内容飞出 + 新内容从另一侧飞入），
   否则回弹；到首/尾分类时按 0.28 阻尼橡皮筋；真正滑动后的 320ms 内吞掉点击（防误触「管理」/行点按）。 */
const SW_LOCK = 12;           // 横向锁定阈值（px）
const SW_LOCK_RATIO = 1.35;   // |dx| > |dy| * 1.35 才判定为横向滑动
const SW_COMMIT = 56;         // 松手提交阈值（px）
const SW_DAMP_EDGE = 0.28;    // 首个/最后一个分类（无目标）时的跟手阻尼
const SW_TAP_GUARD = 320;     // 滑动后抑制点击的时长（ms）

function fmtSync(ts) {
  if (!ts) return '尚未同步';
  const d = new Date(Number(ts));
  if (isNaN(d)) return '尚未同步';
  return util.pad(d.getMonth() + 1) + '-' + util.pad(d.getDate()) + ' ' + util.pad(d.getHours()) + ':' + util.pad(d.getMinutes());
}

Page(shareflow.install({
  data: {
    tab: 'committee',
    query: '',
    edit: false,
    canManage: false,
    syncing: false,
    state: 'loading',
    list: [],
    counts: { committee: 0, league: 0, leagueText: '0', all: 0, loading: { committee: false, league: true, all: false } },
    indicator: { left: '0.000%', width: '30.667%' },
    swipeStyle: '',
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
    this._sw = null;                           // 当前手势
    this._swAnim = false;                      // 飞出/飞入动画进行中
    this._swSeq = 0;                           // 回弹回调失效序号
    this._swTimers = [];                       // 动画定时器（卸载时统一清理）
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
      query: this.data.query,
      matchedSeats: this._matchedSeats,
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
      indicator: roster.tabIndicator(this.data.tab),
      note: view.note,
      emptyText: view.emptyText,
      atText: fmtSync(store.get().classMembersAt)
    });
  },

  setQuery(e) {
    this._matchedSeats = e.detail.seats || [];
    this.setData({ query: e.detail.value });
    this.render();
  },
  clearQuery() { this.setQuery({ detail: { value: '' } }); },

  // 点击和滑动共用分类切换。
  _applyTab(tab) {
    if (TABS.indexOf(tab) < 0) return;
    if (tab === 'league' && !this._leagueLoaded) {
      this.setData({ tab: tab, edit: false, state: 'loading' });
      this.fetchLeague();
    } else {
      this.setData({ tab: tab, edit: false });
      this.render();
    }
  },

  switchTab(e) {
    if (this._tapBlocked()) return;   // 滑动刚结束：不误切
    const tab = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.tab) || '').trim();
    if (TABS.indexOf(tab) < 0 || tab === this.data.tab) return;
    this._applyTab(tab);
  },

  /* ------------------------------ 左右滑动切分类 ------------------------------ */
  _tapBlocked() { return Date.now() < (this._supTap || 0); },
  // 视觉宽度：当前窗口宽度（跟手 1:1，松手飞出距离按屏宽的一半，最多 340px）
  _winW() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      return (info && info.windowWidth) || 375;
    } catch (e) { return 375; }
  },
  _swLater(fn, ms) {
    const id = setTimeout(fn, ms);
    this._swTimers.push(id);
    return id;
  },
  // 统一的滑动手势/动画收尾（onHide / onUnload）
  _swClear() {
    (this._swTimers || []).forEach(clearTimeout);
    this._swTimers = [];
    this._sw = null;
    this._swAnim = false;
    this._swSeq = (this._swSeq || 0) + 1;
    if (this.data && this.data.swipeStyle) this.setData({ swipeStyle: '' });
  },

  onSwipeStart(e) {
    if (this._swAnim) return;
    if (!e.touches || e.touches.length !== 1) {
      // 拖动中变成多指：先回弹，避免把已经拖出的位移留在页面上
      if (this._sw) { this._sw = null; this._swipeSnap(); }
      return;
    }
    this._swSeq++;
    const t = e.touches[0];
    this._sw = { sx: t.clientX, sy: t.clientY, lock: false, live: true, last: 0 };
  },

  onSwipeMove(e) {
    const s = this._sw;
    if (!s || !s.live) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const dx = t.clientX - s.sx;
    const dy = t.clientY - s.sy;
    if (!s.lock) {
      if (Math.abs(dx) < SW_LOCK) return;
      if (Math.abs(dx) > Math.abs(dy) * SW_LOCK_RATIO) s.lock = true;   // 横向锁定 = 切分类手势
      else { s.live = false; return; }                                  // 纵向/斜向：交给页面滚动
    }
    const tgt = roster.tabNeighbor(this.data.tab, dx < 0 ? 1 : -1);
    const x = Math.round(dx * (tgt ? 1 : SW_DAMP_EDGE));
    if (x === s.last) return;
    s.last = x;
    this.setData({ swipeStyle: 'transform:translateX(' + x + 'px);transition:none;' });
  },

  onSwipeEnd(e) {
    const s = this._sw;
    this._sw = null;
    if (!s || !s.live || !s.lock) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - s.sx;
    const dy = t.clientY - s.sy;
    if (!(Math.abs(dx) > Math.abs(dy) * 1.1)) { this._swipeSnap(); return; }
    this._supTap = Date.now() + SW_TAP_GUARD;
    const dir = dx < 0 ? 1 : -1;
    if (roster.tabNeighbor(this.data.tab, dir) && Math.abs(dx) >= SW_COMMIT) this._swipeCommit(dir);
    else this._swipeSnap();
  },

  onSwipeCancel() {
    if (this._swAnim) return;   // 飞行动画中收到 touchcancel 不打断
    this._sw = null;
    this._swipeSnap();
  },

  // 未过阈值 / 到边界：弹回原位
  _swipeSnap() {
    if (!this.data.swipeStyle) return;
    const seq = ++this._swSeq;
    this.setData({ swipeStyle: 'transform:translateX(0);opacity:1;transition:transform .2s cubic-bezier(.22,.8,.3,1);' });
    this._swLater(() => {
      if (this._swSeq === seq && !this._swAnim) this.setData({ swipeStyle: '' });
    }, 220);
  },

  // 提交切换：旧内容飞出 → 换分类（新内容从另一侧进场）→ 弹回原位
  _swipeCommit(dir) {
    const nb = roster.tabNeighbor(this.data.tab, dir);
    if (!nb) { this._swipeSnap(); return; }
    const W = Math.min(340, Math.max(120, this._winW() * 0.5));
    const sign = dir > 0 ? -1 : 1;
    this._swAnim = true;
    // 1) 旧内容飞出（transform .16s ease + 透明度 .25；150ms 后换分类）
    this.setData({ swipeStyle: 'transform:translateX(' + (sign * W) + 'px);opacity:.25;transition:transform .16s ease,opacity .16s ease;' });
    this._swLater(() => {
      // 2) 换分类 + 新内容从另一侧进场（同一次 setData，避免闪一格）
      this._applyTab(nb.key);
      this.setData({ swipeStyle: 'transform:translateX(' + (-sign * W) + 'px);opacity:0;transition:none;' }, () => {
        this._swLater(() => {
          // 3) 弹回原位（.23s cubic-bezier(.22,.8,.3,1)）
          this.setData({ swipeStyle: 'transform:translateX(0);opacity:1;transition:transform .23s cubic-bezier(.22,.8,.3,1),opacity .23s ease;' });
          this._swLater(() => { this._swAnim = false; this.setData({ swipeStyle: '' }); }, 250);
        }, 20);
      });
    }, 150);
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

  _shareTitle() {
    const tab = this.data.tab;
    const label = TAB_LABEL[tab] || '名单';
    if (this.data.query.trim()) return '名单｜' + label + ' · 搜索结果 ' + this.data.list.length + ' 人';
    const n = this.data.counts[tab];
    return n ? ('名单｜' + label + ' ' + n + ' 人') : ('名单｜' + label);
  },
  _shareOpenOpts() {
    if (!this.data.list.length) { util.toast('名单还没加载出来'); return null; }
    return {
      title: this._shareTitle(),
      view: sharecard.buildRosterView({
        tab: this.data.tab, list: this.data.list, counts: this.data.counts, time: util.timeStr()
      })
    };
  },
  openShare() { shareflow.open(this, this._shareOpenOpts()); },
  closeShare() { shareflow.close(this); },
  shareImage() { shareflow.shareImage(this); },

  onPageScroll(e) { scrollmem.onScroll(this, e); },
  onHide() { scrollmem.save(this); this._swClear(); },
  onUnload() { scrollmem.save(this); this._swClear(); },

  onShareAppMessage() {
    return share.message({
      title: this._shareTitle(),
      path: '/pages/committee/committee',
      imageUrl: this.data.shareImg || sharecard.FALLBACK.roster
    });
  },
  onShareTimeline() {
    const tab = this.data.tab;
    const label = TAB_LABEL[tab] || '名单';
    return share.timeline({
      title: '名单｜班委 · 团员 · 全班（' + label + '）',
      imageUrl: this.data.shareImg || sharecard.FALLBACK.roster
    });
  }
}));
