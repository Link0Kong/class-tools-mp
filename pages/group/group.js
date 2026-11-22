// pages/group/group.js —— 分组（独立工具；不再依赖抽签页「下一步」，也没有「结果单」）
// 2026-11-22 分组拆分（契约 web/group/CONTRACT.md §1.2/§2.2/§3）：
//   · 成员来源三选一：全班 / 最近抽签 / 自选名单；
//   · 数据口径不变：group.source 仍只有 'prev' | 'pick'，全班 = pick + group.sel = 全班座号；
//   · 最近抽签读 flow.lastDraw()（zq_flow.drawLast，旧数据回退 zq_flow.draw），冷启动/重置后仍可读；
//   · 名称优先级：名称映射 > 班级名单派生名 > 空（与抽签页 nameOf 同口径）。
// 分组算法与原站一致：按组数 / 按每组人数，轮流分配，可选打乱。
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');
const flow = require('../../utils/flow.js');
const canvas = require('../../utils/canvas.js');
const identity = require('../../utils/identity.js');
const share = require('../../utils/share.js');
const roster = require('../../utils/roster.js');
const agent = require('../../utils/agent.js');
const scrollmem = require('../../utils/scrollmem.js');
const drawproof = require('../../utils/drawproof.js');
const sharecard = require('../../utils/sharecard.js');
const shareflow = require('../../utils/shareflow.js');

function pad(n) { return String(n).padStart(2, '0'); }
// 最近抽签时间：11-22 21:05（只在本机展示，不参与同步）
function shortTime(ms) {
  const n = Number(ms);
  if (!isFinite(n) || n <= 0) return '';
  const d = new Date(n);
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function sameSeats(a, b) {
  const x = roster.normSeats(a), y = roster.normSeats(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

Page(shareflow.install({
  data: {
    state: 'loading',
    errorText: '',
    source: 'prev', mode: 'groups', n: 4, shuffle: false,
    // src = 视图高亮来源：all（全班）| prev（最近抽签）| pick（自选名单）。
    // 持久化仍只有 group.source = prev | pick（contract §4）；全班由「已选集合 = 全班集合」判定。
    src: 'pick',
    groups: [], cfg: null, groupN: 0, total: 0, summary: '',
    allN: 0, prevN: 0, prevAt: 0, prevTime: '',
    groupSel: [], selChips: [], selMore: 0, selCount: 0, picker: false,
    th: { primary: '#5E8F87', track: '#E6E9E8' }   // 原生 switch 配色（跟随系统主题）
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

  // 视图来源：prev 优先；pick 下已选集合 = 全班集合 → all，否则 pick。
  // 不做「新增 source 取值」：group.source 永远只有 prev | pick。
  _srcOf(source, sel) {
    if (source === 'prev') return 'prev';
    const all = roster.members().map(function (m) { return m.seat; });
    return (all.length && sameSeats(sel, all)) ? 'all' : 'pick';
  },

  // —— AI 页面接力：分组结果本就在 zq_flow；payload 只做兜底落盘与参数预填，随后 load() 刷新 ——
  applyAgentHandoff() {
    if (this._agentApplied) return false;
    this._agentApplied = true;
    const h = this._agent;
    const p = (h && h.payload) || {};
    const q = Object.assign({}, this._agentQ || {}, (h && h.query) || {});
    if (!h && !this._agentQ) return false;
    // 参数预填（不阻塞、不自动分组）
    const src = String(p.source || q.source || '');
    if (src === 'prev') this.setData({ source: 'prev', src: 'prev' });
    else if (src === 'pick' || src === 'roster' || src === 'all') this.setData({ source: 'pick', src: 'pick' });
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
              source: String(p.source === 'roster' ? '自选名单' : (p.source === 'prev' ? '最近抽签' : (p.source || '自选名单'))) + '（' + total + ' 人）',
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
      const sel = roster.selOf('group');
      this.setData({
        source: src,
        src: this._srcOf(src, sel),
        mode: g.mode === 'per' ? 'per' : 'groups',
        n: g.n == null ? 4 : g.n,
        shuffle: !!g.shuffle,
        groupSel: sel,
        selChips: info.chips,
        selMore: info.more,
        selCount: info.count,
        allN: roster.members().length
      });
    } catch (e) { /* 重绘失败不影响当前结果 */ }
  },

  load() {
    try {
      try { roster.migrate(); } catch (e) { /* ignore */ }
      const d = store.get();
      const g = d.group || {};
      const fl = flow.getFlow();
      // 未知 source（历史数据/别的端写入）归一为 prev（契约 §4）
      const src = (g.source === 'pick' || g.source === 'paste') ? 'pick' : 'prev';
      const info = roster.summary('group', 8);
      const sel = roster.selOf('group');
      // 旧数据迁移：只有 zq_flow.draw、没有 drawLast 时，把当前结果补成「最近抽签」快照，
      // 这样之后抽签页重置也不会让分组丢掉可沿用的最近结果。
      const fl0 = flow.getFlow();
      if (fl0.draw && !fl0.drawLast && fl0.draw.result && fl0.draw.result.length) flow.saveLastDraw(fl0.draw);
      const last = flow.lastDraw();
      const prevN = (last && Array.isArray(last.result)) ? last.result.length : 0;
      const prevAt = (last && Number(last.at)) || 0;
      this.setData({
        source: src,
        src: this._srcOf(src, sel),
        mode: g.mode === 'per' ? 'per' : 'groups',
        n: g.n == null ? 4 : g.n,
        shuffle: !!g.shuffle,
        allN: roster.members().length,
        prevN: prevN,
        prevAt: prevAt,
        prevTime: shortTime(prevAt),
        groupSel: sel,
        selChips: info.chips,
        selMore: info.more,
        selCount: info.count,
        errorText: ''
      });
      if (fl.group && fl.group.result) this.apply(fl.group);
      else { this.setData({ groups: [], cfg: null, state: 'empty', groupN: 0, total: 0, summary: '' }); }
    } catch (e) {
      this.setData({ state: 'error', errorText: '读取失败：' + ((e && e.message) || e) });
    }
  },

  /* ---------------- 成员来源（三段） ---------------- */
  useAll() {
    const seats = roster.quickSeats('all');
    if (!seats.length) { util.toast('班级名单未同步，请下拉刷新或到「名单」页同步'); return; }
    roster.setSel('group', seats);
    this.setData({ source: 'pick', src: 'all' });
    this.saveCfg();
    this.syncSel();
    util.toast('已选全班 ' + seats.length + ' 人');
  },
  useRecent() {
    if (!this.data.prevN) { util.toast('还没有抽签结果，先去抽一次签'); return; }
    this.setData({ source: 'prev', src: 'prev' });
    this.saveCfg();
  },
  useManual() {
    // 明确点「自选名单」时高亮自选，即使当前碰巧全选（刷新后仍按集合是否等于全班回推）
    this.setData({ source: 'pick', src: 'pick' });
    this.saveCfg();
  },
  selectAll() {
    const seats = roster.quickSeats('all');
    if (!seats.length) { util.toast('班级名单未同步'); return; }
    roster.setSel('group', seats);
    this.setData({ source: 'pick' });
    this.saveCfg();
    this.syncSel();
  },
  clearAll() {
    roster.setSel('group', []);
    this.setData({ source: 'pick', src: 'pick' });
    this.saveCfg();
    this.syncSel();
    util.toast('已清空自选名单');
  },

  onNum(e) {
    const v = String(e.detail.value || '').replace(/[^\d]/g, '').slice(0, 3);
    this.setData({ n: v === '' ? '' : +v });
  },
  nMinus() { this.stepN(-1); },
  nPlus() { this.stepN(1); },
  stepN(d) {
    const min = this.data.mode === 'per' ? 1 : 2;
    const cur = +this.data.n || min;
    this.setData({ n: Math.max(min, Math.min(999, cur + d)) });
  },
  onSwitch(e) { this.setData({ shuffle: e.detail.value }); },
  setMode(e) {
    const mode = e.currentTarget.dataset.v === 'per' ? 'per' : 'groups';
    const n = Math.max(mode === 'per' ? 1 : 2, +this.data.n || 2);
    this.setData({ mode: mode, n: n });
  },

  // —— 班级名单选择（唯一来源 class_members，按座号选择）——
  openPicker() { this.setData({ picker: true }); },
  closePicker() { this.setData({ picker: false }); },
  syncSel() {
    const info = roster.summary('group', 8);
    const sel = roster.selOf('group');
    this.setData({
      groupSel: sel, selChips: info.chips, selMore: info.more, selCount: info.count,
      src: this.data.source === 'prev' ? 'prev' : this._srcOf('pick', sel)
    });
  },
  onRosterConfirm(e) {
    const seats = (e.detail && e.detail.seats) || [];
    roster.setSel('group', seats);
    this.setData({ picker: false, source: 'pick' });
    this.saveCfg();
    this.syncSel();
    util.toast(seats.length ? ('已选 ' + seats.length + ' 人') : '已清空班级名单');
  },

  saveCfg() {
    const d = store.get();
    d.group = d.group || {};
    // 契约 §4：只写 prev | pick；未知值一律 prev
    d.group.source = this.data.source === 'pick' ? 'pick' : 'prev';
    d.group.mode = this.data.mode === 'per' ? 'per' : 'groups';
    d.group.n = +this.data.n || 2;
    d.group.shuffle = !!this.data.shuffle;
    store.save();
  },

  // 成员：最近抽签（名称映射 > 班级名单派生名）或班级名单已选座号
  members() {
    if (this.data.source === 'prev') {
      const last = flow.lastDraw();
      if (!last || !last.result || !last.result.length) { util.toast('还没有抽签结果，可选「全班」或「自选名单」'); return null; }
      const names = String((store.get().draw || {}).names || '');
      const rows = drawproof.rowsOf(last.result, names, store.get().roster || '', 'draw');
      return rows.map(function (r) { return { n: r.n, nm: r.nm || '' }; });
    }
    const seats = roster.selOf('group');
    if (!seats.length) { util.toast('请先选择名单'); return null; }
    const picked = roster.pickedOf(seats);
    if (picked.length < 2) { util.toast('名单至少要有 2 人'); return null; }
    return picked.map(function (m) { return { n: m.seat, nm: m.name }; });
  },

  _sourceLabel(n) {
    if (this.data.source === 'prev') return '最近抽签（' + n + ' 人）';
    return (this.data.src === 'all' ? '全班（' : '自选名单（') + n + ' 人）';
  },

  doGroup() {
    this.saveCfg();
    const g = this.data;
    const mem = this.members();
    if (!mem) return;
    const n = Math.max(1, +g.n || 2);
    const groups = g.mode === 'groups'
      ? Math.min(Math.max(2, n), mem.length)
      : Math.max(1, Math.ceil(mem.length / n));
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
        source: this._sourceLabel(mem.length),
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
    const total = groups.reduce(function (a, g) { return a + g.size; }, 0);
    const sizes = groups.map(function (g) { return g.size; });
    const lo = sizes.length ? Math.min.apply(null, sizes) : 0;
    const hi = sizes.length ? Math.max.apply(null, sizes) : 0;
    const summary = groups.length
      ? ('共 ' + total + ' 人 · ' + groups.length + ' 组 · 每组 ' + (lo === hi ? lo : (lo + '–' + hi)) + ' 人')
      : '';
    this.setData({
      groups: groups, cfg: st.cfg || null, state: groups.length ? 'data' : 'empty',
      groupN: groups.length, total: total, summary: summary
    });
  },

  copyText() {
    if (!this.data.groups.length) { util.toast('先分组再复制'); return; }
    const t = this.data.groups.map(function (g) {
      return '第 ' + g.i + ' 组（' + g.size + ' 人）：' + g.members.map(function (m) {
        if (m.nm && m.n != null) return m.n + ' ' + m.nm;
        return m.nm || String(m.n);
      }).join('、');
    }).join('\n');
    util.copyText(t);
  },

  _sharePosterOpt() {
    if (!this.data.groups.length) return null;
    const cfg = this.data.cfg || {};
    // v2 导图：分组结果用 groups（两列组卡，组头/人数自动生成）
    const blocks = [{
      label: '分组结果',
      groups: this.data.groups.map(function (g) {
        return g.members.map(function (m) { return { n: m.n, nm: m.nm || '' }; });
      })
    }];
    return {
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
    };
  },
  exportImg() {
    if (!this.data.groups.length) { util.toast('先分组再分享'); return; }
    canvas.exportAndSave(this, '#card', this._sharePosterOpt());
  },
  _shareOpenOpts() {
    if (!this.data.groups.length) { util.toast('先分组再分享'); return null; }
    return {
      title: this._shareTitle(),
      view: sharecard.buildGroupView({ groups: this.data.groups, cfg: this.data.cfg || {}, time: util.timeStr() }),
      posterOpt: this._sharePosterOpt()
    };
  },
  openShare() { shareflow.open(this, this._shareOpenOpts()); },
  closeShare() { shareflow.close(this); },
  shareImage() { shareflow.shareImage(this); },
  onPageScroll(e) { scrollmem.onScroll(this, e); },
  _shareTitle() {
    const n = (this.data.groups || []).length;
    const cfg = this.data.cfg || {};
    if (!n) return '班级分组｜全班 / 最近抽签 / 自选名单一键分组';
    return '分组结果 · ' + n + ' 组' + (cfg.total ? (' / ' + cfg.total + ' 人') : '');
  },
  onShareAppMessage() {
    return share.message({
      title: this._shareTitle(),
      path: '/pages/group/group',
      imageUrl: this.data.shareImg || sharecard.FALLBACK.group
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: this._shareTitle(),
      imageUrl: this.data.shareImg || sharecard.FALLBACK.group
    });
  }
}));
