// pages/group/group.js —— 第 2 步：分组（三步向导）
// 算法与原站 gMembers / doGroup 一致：成员来自上一步抽签序号，或班级名单（按座号选择）。
// 1.3.4 名单改造：不再支持粘贴/自定义名单，成员来源「班级名单」= class_members 里的已选座号。
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');
const flow = require('../../utils/flow.js');
const canvas = require('../../utils/canvas.js');
const identity = require('../../utils/identity.js');
const share = require('../../utils/share.js');
const roster = require('../../utils/roster.js');
const agent = require('../../utils/agent.js');
const scrollmem = require('../../utils/scrollmem.js');

Page({
  data: {
    state: 'loading',
    errorText: '',
    source: 'prev', mode: 'groups', n: 4, shuffle: false,
    groups: [], cfg: null, prevN: 0,
    groupSel: [], selChips: [], selMore: 0, selCount: 0, picker: false,
    th: { primary: '#5E8F87', track: '#E6E9E8' },   // 原生 switch 配色（跟随系统主题）
    steps: [
      { id: 's1', label: '抽签', done: false },
      { id: 's2', label: '分组', done: false },
      { id: 's3', label: '结果单', done: false }
    ]
  },

  onLoad(options) {
    scrollmem.attach(this);
    options = options || {};
    this._agent = agent.pick(this);            // AI 页面接力（wx.onAgentHandoff），只消费一次
    this._agentQ = agent.pickQuery(options);   // 备用：handoff query 随页面参数传入
    this._first = true;
    this.setData({ th: util.nativeTheme() });
    if (wx.onThemeChange) {
      this._onTheme = () => { this.setData({ th: util.nativeTheme() }); };
      wx.onThemeChange(this._onTheme);
    }
  },
  onShow() {
    share.enable();
    scrollmem.restore(this);
    if (!identity.ensure()) return;
    this.setData({ th: util.nativeTheme() });
    try { store.reload(); } catch (e) { /* ignore */ }
    try { roster.migrate(); } catch (e) { /* ignore */ }
    this.applyAgentHandoff();
    if (this._first) {
      this._first = false;
      this.setData({ state: 'loading' });
      this._t = setTimeout(() => { this._t = null; this.load(); }, 140);
    } else {
      this.load();
    }
  },
  onHide() {
    scrollmem.save(this); if (this._t) { clearTimeout(this._t); this._t = null; } },
  onUnload() {
    scrollmem.save(this);
    if (this._t) { clearTimeout(this._t); this._t = null; }
    if (this._onTheme && wx.offThemeChange) { wx.offThemeChange(this._onTheme); this._onTheme = null; }
  },
  onPullDownRefresh() { this.load(); wx.stopPullDownRefresh(); },

  // —— AI 页面接力（step=2）：分组结果本就在 zq_flow；payload 只做兜底落盘与参数预填，随后 load() 刷新 ——
  applyAgentHandoff() {
    if (this._agentApplied) return false;
    this._agentApplied = true;
    const h = this._agent;
    const p = (h && h.payload) || {};
    const q = Object.assign({}, this._agentQ || {}, (h && h.query) || {});
    if (!h && !this._agentQ) return false;
    this._hoStep = parseInt(q.step, 10) || 2;
    // 参数预填（不阻塞、不自动分组）
    const src = String(p.source || q.source || '');
    if (src === 'prev' || src === 'pick' || src === 'roster') this.setData({ source: src === 'prev' ? 'prev' : 'pick' });
    const mode = String(p.mode || q.mode || '');
    if (mode === 'groups' || mode === 'size') this.setData({ mode: mode === 'size' ? 'per' : 'groups' });
    const value = parseInt(p.value || q.value, 10);
    if (value > 0) this.setData({ n: value });
    if (p.shuffle !== undefined && p.shuffle !== null) this.setData({ shuffle: !!p.shuffle });
    try {
      const fl = flow.getFlow();
      const has = !!(fl.group && fl.group.result);
      if (!has) {
        const st = (p.group && typeof p.group === 'object') ? p.group : null;
        if (st && Array.isArray(st.result)) {
          flow.patch('group', st);
        } else if (Array.isArray(p.groups) && p.groups.length) {
          const result = p.groups.map(function (g) {
            const members = (g && Array.isArray(g.members)) ? g.members : [];
            return members.map(function (m) {
              if (m && typeof m === 'object') {
                return { n: Number(m.number != null ? m.number : m.n), nm: String(m.name != null ? m.name : (m.nm || '')) };
              }
              return { n: Number(m), nm: '' };
            });
          });
          const total = result.reduce(function (a, x) { return a + x.length; }, 0);
          const v = Number(p.value);
          flow.patch('group', {
            result: result,
            cfg: {
              source: String(p.source === 'roster' ? '班级名单' : (p.source || '上一步抽签序号')),
              mode: p.mode === 'size' ? ('按每组人数(' + (isFinite(v) ? v : '') + ' 人)') : ('按组数(' + result.length + ' 组)'),
              total: String(total),
              groups: String(result.length),
              inner: p.shuffle ? '打乱后随机分配' : '按原顺序轮流分配'
            }
          });
        }
      }
    } catch (e) { /* payload 渲染失败保留本机已有分组 */ }
    return true;
  },
  // 云端 userdata 应用后重绘：只重读分组参数与名单选择，不重置已分好的结果（契约 §5.4）
  onCloudSync() {
    try {
      store.reload();
      const g = store.get().group || {};
      const src = (g.source === 'pick' || g.source === 'paste') ? 'pick' : 'prev';
      const info = roster.summary('group', 8);
      this.setData({
        source: src,
        mode: g.mode === 'per' ? 'per' : 'groups',
        n: g.n == null ? 4 : g.n,
        shuffle: !!g.shuffle,
        groupSel: roster.selOf('group'),
        selChips: info.chips,
        selMore: info.more,
        selCount: info.count
      });
    } catch (e) { /* 重绘失败不影响当前结果 */ }
  },

  load() {
    try {
      try { roster.migrate(); } catch (e) { /* ignore */ }
      const d = store.get();
      const g = d.group || {};
      const fl = flow.getFlow();
      const src = (g.source === 'pick' || g.source === 'paste') ? 'pick' : 'prev';
      const info = roster.summary('group', 8);
      this.setData({
        source: src,
        mode: g.mode === 'per' ? 'per' : 'groups',
        n: g.n == null ? 4 : g.n,
        shuffle: !!g.shuffle,
        prevN: (fl.draw && fl.draw.result) ? fl.draw.result.length : 0,
        groupSel: roster.selOf('group'),
        selChips: info.chips,
        selMore: info.more,
        selCount: info.count,
        errorText: ''
      });
      if (fl.group && fl.group.result) this.apply(fl.group);
      else { this.setData({ groups: [], cfg: null, state: 'empty' }); this.syncSteps(); }
    } catch (e) {
      this.setData({ state: 'error', errorText: '读取失败：' + ((e && e.message) || e) });
    }
  },

  onNum(e) {
    const v = String(e.detail.value || '').replace(/[^\d]/g, '').slice(0, 3);
    this.setData({ n: v === '' ? '' : +v });
  },
  onSwitch(e) { this.setData({ shuffle: e.detail.value }); },
  setSource(e) { this.setData({ source: e.currentTarget.dataset.v }); },
  setMode(e) { this.setData({ mode: e.currentTarget.dataset.v }); },

  // —— 班级名单（唯一来源 class_members，按座号选择；不支持粘贴/自定义）——
  openPicker() { this.setData({ picker: true }); },
  closePicker() { this.setData({ picker: false }); },
  syncSel() {
    const info = roster.summary('group', 8);
    this.setData({ groupSel: roster.selOf('group'), selChips: info.chips, selMore: info.more, selCount: info.count });
  },
  onRosterConfirm(e) {
    const seats = (e.detail && e.detail.seats) || [];
    roster.setSel('group', seats);
    this.syncSel();
    this.setData({ picker: false });
    util.toast(seats.length ? ('已选 ' + seats.length + ' 人') : '已清空班级名单');
  },

  saveCfg() {
    const d = store.get();
    d.group = d.group || {};
    d.group.source = this.data.source;
    d.group.mode = this.data.mode;
    d.group.n = +this.data.n || 2;
    d.group.shuffle = !!this.data.shuffle;
    store.save();
  },

  // 与原站 gMembers 等价：上一步抽签序号 / 班级名单已选成员
  members() {
    const fl = flow.getFlow();
    if (this.data.source === 'prev') {
      if (!fl.draw || !fl.draw.result || !fl.draw.result.length) { util.toast('请先在第 1 步抽签'); return null; }
      // 姓名只取派生名单文本（与网页端 nameOf 同源）：未选参与名单时序号不带姓名
      const rm = util.rosterMap(store.get().roster).m;
      return fl.draw.result.map(function (x) { return { n: x, nm: rm[x] || '' }; });
    }
    const seats = roster.selOf('group');
    if (!seats.length) { util.toast('请先选择名单'); return null; }
    const picked = roster.pickedOf(seats);
    if (picked.length < 2) { util.toast('名单至少要有 2 人'); return null; }
    return picked.map(function (m) { return { n: m.seat, nm: m.name }; });
  },

  doGroup() {
    this.saveCfg();
    const g = this.data;
    const mem = this.members();
    if (!mem) return;
    const n = +g.n || 2;
    const groups = g.mode === 'groups'
      ? Math.min(Math.max(2, n), mem.length)
      : Math.max(1, Math.ceil(mem.length / Math.max(1, n)));
    const list = mem.slice();
    if (g.shuffle) {
      for (let j = list.length - 1; j > 0; j--) {
        const r = Math.floor(Math.random() * (j + 1));
        const t = list[j]; list[j] = list[r]; list[r] = t;
      }
    }
    const out = [];
    for (let i = 0; i < groups; i++) out.push([]);
    list.forEach(function (p, i) { out[i % groups].push(p); });
    const st = {
      result: out,
      cfg: {
        source: g.source === 'prev' ? '上一步抽签序号' : ('班级名单（' + mem.length + ' 人）'),
        mode: g.mode === 'groups' ? ('按组数(' + groups + ' 组)') : ('按每组人数(' + n + ' 人)'),
        total: String(mem.length), groups: String(groups),
        inner: g.shuffle ? '打乱后随机分配' : '按原顺序轮流分配'
      }
    };
    flow.patch('group', st);
    this.apply(st);
    wx.showToast({ title: '已分 ' + groups + ' 组', icon: 'none', duration: 1000 });
  },

  apply(st) {
    const groups = (st.result || []).map(function (gp, i) {
      return { i: i + 1, size: gp.length, members: gp.map(function (m, j) { return Object.assign({}, m, { key: i + '_' + j }); }) };
    });
    this.setData({ groups: groups, cfg: st.cfg || null, state: groups.length ? 'data' : 'empty' });
    this.syncSteps();
  },

  copyText() {
    if (!this.data.groups.length) { util.toast('先分组再复制'); return; }
    const t = this.data.groups.map(function (g) {
      return '第 ' + g.i + ' 组：' + g.members.map(function (m) { return m.nm || String(m.n); }).join('、');
    }).join('\n');
    util.copyText(t);
  },

  // 步骤条完成态（只读 flow，不改动任何业务数据）
  syncSteps() {
    const fl = flow.getFlow();
    const drawN = (fl.draw && fl.draw.result) ? fl.draw.result.length : 0;
    const grpN = (fl.group && fl.group.result) ? fl.group.result.length : 0;
    this.setData({
      steps: [
        { id: 's1', label: '抽签', done: drawN > 0 },
        { id: 's2', label: '分组', done: grpN > 0 },
        { id: 's3', label: '结果单', done: !!(drawN && grpN) }
      ]
    });
  },


  onStep(e) {
    const i = e.detail.index;
    if (i === 1) this.toDraw();
    else if (i === 3) this.toSum();
  },
  toDraw() { util.backTo('pages/draw/draw'); },
  toSum() {
    if (!this.data.groups.length) { util.toast('先分组再往下走'); return; }
    wx.navigateTo({ url: '/pages/sum/sum' });
  },

  exportImg() {
    if (!this.data.groups.length) { util.toast('先分组再导图'); return; }
    const cfg = this.data.cfg || {};
    // v2 导图：分组结果用 groups（两列组卡，组头/人数自动生成）
    const blocks = [{
      label: '分组结果',
      groups: this.data.groups.map(function (g) {
        return g.members.map(function (m) { return { n: m.n, nm: m.nm || '' }; });
      })
    }];
    canvas.exportAndSave(this, '#card', {
      title: '分组结果',
      sub: cfg.groups ? (cfg.groups + ' 组 / ' + cfg.total + ' 人') : '',
      config: [
        ['分组 · 成员来源', cfg.source || '-'],
        ['分组 · 方式', cfg.mode || '-'],
        ['分组 · 人数', cfg.total || '-'],
        ['分组 · 组数', cfg.groups || '-'],
        ['分组 · 成员分配', cfg.inner || '-']
      ],
      blocks: blocks,
      foot: '生成时间 ' + util.timeStr(),
      rec: util.recId('GROUP')
    });
  },
  onPageScroll(e) { scrollmem.onScroll(this, e); },
  _shareTitle() {
    const n = (this.data.groups || []).length;
    const cfg = this.data.cfg || {};
    if (!n) return '班级分组｜按组数或人数一键分组';
    return '分组结果 · ' + n + ' 组' + (cfg.total ? (' / ' + cfg.total + ' 人') : '');
  },
  onShareAppMessage() {
    return share.message({
      title: this._shareTitle(),
      path: '/pages/group/group',
      imageUrl: '/images/share/draw.png'
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: this._shareTitle(),
      imageUrl: '/images/share/draw.png'
    });
  }
});
