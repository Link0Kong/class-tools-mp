// pages/stats/stats.js —— 访问统计（按访问次数排序，仅管理员）
// 数据来源：CloudBase public.visits（{id, slot, sid, name, did, client, ts}；client=web/mp/android/win/harmony）。
// 只按「学号 + 姓名」聚合，不按匿名设备；仅 is_admin 身份可看（服务端 RLS 会再校验 token）。
const identity = require('../../utils/identity.js');
const cloud = require('../../utils/cloud.js');
const share = require('../../utils/share.js');
const agent = require('../../utils/agent.js');
const scrollmem = require('../../utils/scrollmem.js');

const CLIENT_LABEL = { web: '网页', mp: '小程序', android: '安卓', win: 'Windows', harmony: '鸿蒙' };

function pad(n) { return ('0' + n).slice(-2); }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function slotTs(slot) {
  const s = String(slot || '');
  if (s.length < 13) return 0;
  const d = new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)), Number(s.slice(11, 13)), 0, 0, 0);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
function tsOf(r) { return (Number(r && r.ts) || 0) || slotTs(r && r.slot); }
function fmtTs(ts) {
  const d = new Date(Number(ts) || 0);
  if (isNaN(d.getTime()) || !Number(ts)) return '—';
  return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function clientLabel(c) { return CLIENT_LABEL[String(c || '').trim().toLowerCase()] || '未记录'; }
// 测试账号：官方测试身份 3260799999 + 临时 QA 身份 9999 段（10 位）；统计一律忽略。
function isTestSid(sid) {
  const s = String(sid || '').trim();
  return s === '3260799999' || /^9999\d{6}$/.test(s);
}

Page({
  data: {
    state: 'loading',
    denied: false,
    mode: 'account',      // account | day | hour
    range: 'today',       // today | week
    accounts: [],
    bars: [],
    summary: { accounts: 0, visits: 0 },
    atText: ''
  },

  onLoad(options) {
    scrollmem.attach(this);
    options = options || {};
    this._agent = agent.pick(this);            // AI 页面接力（wx.onAgentHandoff），只消费一次
    this._agentQ = agent.pickQuery(options);   // 备用：handoff query 随页面参数传入
  },
  onShow() {
    share.enable();
    scrollmem.restore(this);
    if (!identity.ensure()) return;
    // 默认打开今天：每次进入统计页都归位（离开再进不沿用上次的 7 天）；AI 接力可随后覆盖。
    this.setData({ range: 'today' });
    this.applyAgentHandoff();
    if (!identity.isAdmin()) {
      this.setData({ state: 'error', denied: true });
      return;
    }
    this.setData({ denied: false });
    this.load();
  },
  onPullDownRefresh() {
    if (identity.has() && identity.isAdmin()) this.load();
    wx.stopPullDownRefresh();
  },

  // —— AI 页面接力：按 days 切换统计范围（数据仍由 load() 后台拉取，不阻塞）——
  applyAgentHandoff() {
    if (this._agentApplied) return false;
    this._agentApplied = true;
    const h = this._agent;
    const p = (h && h.payload) || {};
    const q = Object.assign({}, this._agentQ || {}, (h && h.query) || {});
    if (!h && !this._agentQ) return false;
    const days = parseInt(q.days || p.days, 10);
    if (days > 0) this.setData({ range: days <= 1 ? 'today' : 'week' });
    const mode = String(q.mode || p.mode || '');
    if (mode === 'account' || mode === 'day' || mode === 'hour') this.setData({ mode: mode });
    return true;
  },

  load() {
    if (!identity.isAdmin()) { this.setData({ state: 'error', denied: true }); return; }
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
    const fromSlot = ymd(from) + '-00';
    this.setData({ state: 'loading' });
    cloud.statsPull(fromSlot).then((rows) => {
      this._rows = Array.isArray(rows) ? rows : [];
      this.render();
    }).catch(() => { this._rows = []; this.render(); });
  },

  setMode(e) {
    const v = e.currentTarget.dataset.v;
    if (v === this.data.mode) return;
    this.setData({ mode: v }, () => this.render());
  },
  setRange(e) {
    const v = e.currentTarget.dataset.v;
    if (v === this.data.range) return;
    this.setData({ range: v }, () => this.render());
  },

  render() {
    const all = this._rows || [];
    const now = new Date();
    const today = ymd(now);
    // 只统计「有学号」的 visits 行：旧匿名访问（sid/name 为空）不参与聚合；测试账号一律忽略。
    const bound = all.filter(function (r) {
      const sid = String(r.sid == null ? '' : r.sid).trim();
      return sid !== '' && !isTestSid(sid);
    });
    const rows = this.data.range === 'today'
      ? bound.filter(function (r) { return String(r.slot || '').slice(0, 10) === today; })
      : bound;

    // —— 按账号聚合（sid/name、访问次数、最近登录时间与登录端）——
    const map = {};
    rows.forEach(function (r) {
      const sid = String(r.sid || '').trim();
      if (!sid) return;
      const name = String(r.name || '').trim();
      if (!map[sid]) map[sid] = { key: sid, sid: sid, name: name, count: 0, lastTs: 0, lastClient: '' };
      const a = map[sid];
      a.count += 1;
      const t = tsOf(r);
      if (t >= a.lastTs) { a.lastTs = t; a.lastClient = String(r.client || '').trim(); }
      if (name) a.name = name;
    });
    const accounts = Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
      return (b.count - a.count) || (b.lastTs - a.lastTs);
    }).map(function (a) {
      const nm = a.name || cloud.memberName(a.sid) || '（无姓名）';
      return {
        key: a.key,
        name: nm,
        count: a.count,
        lastText: fmtTs(a.lastTs),
        clientText: clientLabel(a.lastClient)
      };
    });

    // —— 按天 / 按小时（去重账号数）——
    let bars = [];
    if (this.data.mode === 'day') {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const key = ymd(d);
        const set = {};
        rows.forEach(function (r) {
          if (String(r.slot || '').slice(0, 10) !== key) return;
          const k = String(r.sid || '').trim();
          if (k) set[k] = 1;
        });
        bars.push({ label: key.slice(5), n: Object.keys(set).length });
      }
    } else if (this.data.mode === 'hour') {
      const byH = [];
      for (let h = 0; h < 24; h++) byH.push({});
      rows.forEach(function (r) {
        const s = String(r.slot || '');
        const h = parseInt(s.slice(11, 13), 10);
        if (!(h >= 0 && h < 24)) return;
        const k = String(r.sid || '').trim();
        if (k) byH[h][k] = 1;
      });
      bars = byH.map(function (m, h) { return { label: (h < 10 ? '0' : '') + h, n: Object.keys(m).length }; })
        .filter(function (b, h) { return b.n > 0 || h % 3 === 0 || h === 23; });
    }
    if (bars.length) {
      const mx = Math.max.apply(null, bars.map(function (b) { return b.n; }).concat([1]));
      bars.forEach(function (b) { b.pct = Math.round(b.n / mx * 100); });
    }

    const totalVisits = rows.length;
    this.setData({
      state: accounts.length || bars.some(function (b) { return b.n; }) ? 'data' : 'empty',
      accounts: accounts,
      bars: bars,
      summary: { accounts: accounts.length, visits: totalVisits },
      atText: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes())
    });
  },
  onPageScroll(e) { scrollmem.onScroll(this, e); },
  onHide() { scrollmem.save(this); },
  onUnload() { scrollmem.save(this); },
  onShareAppMessage() {
    return share.message({
      title: '班级工具｜访问统计（仅管理员）',
      path: '/pages/stats/stats',
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '班级工具｜访问统计（仅管理员）',
      imageUrl: '/images/share/default.png'
    });
  }
});
