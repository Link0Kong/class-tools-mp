// pages/stats/stats.js —— 访问统计（可视化 + 账号明细，仅管理员）
// 数据来源：云端 public.visits（slot,sid,name,ts,client,ver,dev,did）。
// 契约：web/统计多端_详细统计_契约_20261120.md（过滤 / 聚合 / 趋势 / 账号明细 / 120 条上限）。
// 页面只做数据渲染：所有聚合在 render() 一次算好，WXML 不参与计算。
const identity = require('../../utils/identity.js');
const cloud = require('../../utils/cloud.js');
const share = require('../../utils/share.js');
const agent = require('../../utils/agent.js');
const scrollmem = require('../../utils/scrollmem.js');

const CLIENT_META = {
  web: { label: '网页', color: '#4E9082' },
  mp: { label: '小程序', color: '#6E8CA8' },
  android: { label: '安卓', color: '#5F8F5B' },
  win: { label: 'Windows', color: '#B98F63' },
  harmony: { label: '鸿蒙', color: '#8A6A92' }
};
const UNKNOWN_CLIENT = { label: '未记录', color: '#9AA5A1' };
const MAX_ACCOUNTS = 120;       // setData 体积控制：账号明细最多 120 条
const MAX_GROUPS = 6;           // 版本 / 设备分布最多 6 行 + 「其他」
const WEEK_DAYS = 7;
const TREND_BAR_H = 220;        // 趋势柱最大高度（rpx），WXML 直接渲染 height

function pad(n) { return ('0' + n).slice(-2); }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function slotTs(slot) {
  const s = String(slot || '');
  if (s.length < 13) return 0;
  const d = new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)), Number(s.slice(11, 13)), 0, 0, 0);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
// effectiveTs = ts > 0 ? ts : slot 的整点（契约 §3.1-3）
function tsOf(r) { return (Number(r && r.ts) || 0) || slotTs(r && r.slot); }
function fmtTs(ts) {
  const d = new Date(Number(ts) || 0);
  if (isNaN(d.getTime()) || !Number(ts)) return '—';
  return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function cmpText(a, b) {
  const x = String(a == null ? '' : a), y = String(b == null ? '' : b);
  return x < y ? -1 : (x > y ? 1 : 0);
}
// 版本号自然排序（2.0.0 > 1.0.8 > 1.0.0-beta14 > 未记录）
function verCmp(a, b) {
  const ax = String(a == null ? '' : a).match(/\d+|[^\d]+/g) || [];
  const bx = String(b == null ? '' : b).match(/\d+|[^\d]+/g) || [];
  const n = Math.min(ax.length, bx.length);
  for (let i = 0; i < n; i++) {
    const an = /^\d+$/.test(ax[i]), bn = /^\d+$/.test(bx[i]);
    if (an && bn) {
      const d = Number(ax[i]) - Number(bx[i]);
      if (d) return d < 0 ? -1 : 1;
    } else if (ax[i] !== bx[i]) {
      return ax[i] < bx[i] ? -1 : 1;
    }
  }
  return ax.length - bx.length;
}
function cleanVer(v) { return String(v == null ? '' : v).trim(); }
function cleanDev(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
// 只认契约里的五个登录端；空值/未知值统一归「未记录」（契约 §4）
function normClient(c) {
  const k = String(c == null ? '' : c).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(CLIENT_META, k) ? k : '';
}
function clientMeta(c) {
  const k = normClient(c);
  return k ? CLIENT_META[k] : UNKNOWN_CLIENT;
}
function clientLabel(c) { return clientMeta(c).label; }
function clientColor(c) { return clientMeta(c).color; }
// 测试账号：官方测试身份 3260799999 + 临时 QA 身份 9999 段（10 位）；统计一律忽略。
function isTestSid(sid) {
  const s = String(sid || '').trim();
  return s === '3260799999' || /^9999\d{6}$/.test(s);
}
// 去重设备键：优先 did；无 did 的行按 client|dev 兜底（契约 §3.2 deviceCount）
function deviceKeyOf(r) {
  const did = String(r && r.did == null ? '' : (r && r.did)).trim();
  if (did) return 'd:' + did;
  return 'x:' + normClient(r && r.client) + '|' + cleanDev(r && r.dev);
}
// 占比条：四舍五入，最后一段补齐到 100%（契约 §3.4）
function fillPct(list, total) {
  let used = 0;
  for (let i = 0; i < list.length; i++) {
    if (i === list.length - 1) {
      list[i].pct = Math.max(0, 100 - used);
    } else {
      list[i].pct = total > 0 ? Math.round(list[i].count / total * 100) : 0;
      used += list[i].pct;
    }
  }
  return list;
}
// 最多展示 max 组，其余合并为「其他」
function topGroups(list, max) {
  if (list.length <= max) return list;
  const head = list.slice(0, max);
  const rest = list.slice(max);
  let count = 0;
  rest.forEach(function (x) { count += x.count; });
  head.push({ key: '__other__', label: '其他', count: count, isOther: true, otherCount: rest.length });
  return head;
}
function versionGroups(rows) {
  const map = Object.create(null);
  rows.forEach(function (r) {
    const raw = cleanVer(r.ver);
    if (!map[raw]) map[raw] = { key: raw, raw: raw, label: raw || '未记录', count: 0 };
    map[raw].count += 1;
  });
  return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
    return (b.count - a.count) || verCmp(b.raw, a.raw);
  });
}
function clientGroups(rows) {
  const map = Object.create(null);
  rows.forEach(function (r) {
    const k = normClient(r.client);
    if (!map[k]) map[k] = { key: k, client: k, label: clientLabel(k), color: clientColor(k), count: 0 };
    map[k].count += 1;
  });
  return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
    return (b.count - a.count) || cmpText(a.label, b.label);
  });
}
// 设备分布按 client|dev 分组（不展示 did；空 dev 记「未记录」）
function deviceGroups(rows) {
  const map = Object.create(null);
  rows.forEach(function (r) {
    const key = normClient(r.client) + '|' + cleanDev(r.dev);
    if (!map[key]) map[key] = { key: key, client: normClient(r.client), dev: cleanDev(r.dev), count: 0, lastTs: 0 };
    const g = map[key];
    g.count += 1;
    if (r.ts >= g.lastTs) g.lastTs = r.ts;
  });
  return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
    return (b.count - a.count) || (b.lastTs - a.lastTs) || cmpText(a.key, b.key);
  });
}
function decorateDevice(g) {
  if (g.isOther) {
    return { key: '__other__', client: '', label: '其他', dev: '', devLabel: '其余 ' + g.otherCount + ' 类', count: g.count, pct: 0, isOther: true, lastText: '' };
  }
  const devLabel = g.dev || '未记录';
  return {
    key: g.key, client: g.client, label: clientLabel(g.client), dev: devLabel, devLabel: devLabel,
    count: g.count, lastTs: g.lastTs, lastText: fmtTs(g.lastTs), pct: 0
  };
}
function accountShare(rows) {
  return fillPct(clientGroups(rows), rows.length);
}
function buildAccount(a, range, todayKey) {
  const name = a.name || (function () {
    try { return cloud.memberName(a.key) || ''; } catch (e) { return ''; }
  })() || '班级成员';
  const clients = accountShare(a.rows);
  const versions = fillPct(topGroups(versionGroups(a.rows), MAX_GROUPS), a.count);
  const devices = fillPct(topGroups(deviceGroups(a.rows), MAX_GROUPS).map(decorateDevice), a.count);
  const activeDays = Object.keys(a.days).length;
  const activeToday = !!a.days[todayKey];
  const firstText = fmtTs(a.firstTs);
  const lastText = fmtTs(a.lastTs);
  return {
    key: a.key,
    name: name,
    count: a.count,
    firstTs: a.firstTs,
    lastTs: a.lastTs,
    firstText: firstText,
    lastText: lastText,
    clientText: clientLabel(a.lastClient),
    verText: cleanVer(a.lastVer) || '未记录',
    devText: cleanDev(a.lastDev) || '未记录',
    activeDays: activeDays,
    activeToday: activeToday,
    // 今天范围省略「活跃 N/7 天」段（契约 §3.2 detailText）
    detailText: (range === 'week' ? '活跃 ' + activeDays + '/' + WEEK_DAYS + ' 天 · ' : '') +
      '首次 ' + firstText + ' · 最近 ' + lastText,
    clients: clients,
    versions: versions,
    devices: devices,
    deviceCount: Object.keys(a.deviceKeys).length,
    clientDetail: clients.map(function (c) { return c.label + ' ' + c.count; }).join(' · '),
    versionDetail: versions.map(function (v) { return v.label + ' ×' + v.count; }).join(' · '),
    pct: 0
  };
}
function trendOf(rows, range, now, todayKey) {
  const counts = [], labels = [], todayFlags = [], showFlags = [];
  if (range === 'today') {
    const thisHour = now.getHours();
    for (let h = 0; h < 24; h++) {
      counts.push(0);
      labels.push(pad(h));
      todayFlags.push(h === thisHour);
      showFlags.push(h % 3 === 0 || h === 23);   // 标签 00/03/…/21/23
    }
    rows.forEach(function (r) { if (r.hour >= 0 && r.hour < 24) counts[r.hour] += 1; });
  } else {
    for (let i = WEEK_DAYS - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = ymd(d);
      let n = 0;
      for (let j = 0; j < rows.length; j++) if (rows[j].day === key) n += 1;
      counts.push(n);
      labels.push(pad(d.getMonth() + 1) + '/' + pad(d.getDate()));
      todayFlags.push(key === todayKey);
      showFlags.push(true);
    }
  }
  let max = 1;
  counts.forEach(function (n) { if (n > max) max = n; });
  return counts.map(function (count, i) {
    return {
      label: labels[i],
      count: count,
      isToday: todayFlags[i],
      showLabel: showFlags[i],
      pct: Math.round(count / max * 100),
      height: Math.round(count / max * TREND_BAR_H)
    };
  });
}

Page({
  data: {
    state: 'loading',
    denied: false,
    range: 'today',       // today | week
    summary: { accounts: 0, visits: 0, activeToday: 0, devices: 0 },
    trend: [],
    trendTitle: '今日 24 小时',
    clients: [],
    versions: [],
    devicesList: [],
    accounts: [],
    truncated: false,
    expandedKey: ''
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

  // —— AI 页面接力：按 days 切换统计范围（mode 字段保留兼容但忽略，统一趋势图）——
  applyAgentHandoff() {
    if (this._agentApplied) return false;
    this._agentApplied = true;
    const h = this._agent;
    const p = (h && h.payload) || {};
    const q = Object.assign({}, this._agentQ || {}, (h && h.query) || {});
    if (!h && !this._agentQ) return false;
    const days = parseInt(q.days || p.days, 10);
    if (days > 0) this.setData({ range: days <= 1 ? 'today' : 'week' });
    return true;
  },

  load() {
    if (!identity.isAdmin()) { this.setData({ state: 'error', denied: true }); return; }
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (WEEK_DAYS - 1), 0, 0, 0, 0);
    const fromSlot = ymd(from) + '-00';
    this.setData({ state: 'loading' });
    cloud.statsPull(fromSlot).then((rows) => {
      this._rows = Array.isArray(rows) ? rows : [];
      this.render();
    }).catch(() => { this._rows = []; this.render(); });
  },

  setRange(e) {
    const v = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v === 'week' ? 'week' : 'today';
    if (v === this.data.range) return;
    this.setData({ range: v }, () => this.render());
  },
  // 一次只展开一个账号：只更新 expandedKey，WXML 用 expandedKey === item.key 判断
  toggleRow(e) {
    const key = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || '');
    if (!key) return;
    this.setData({ expandedKey: this.data.expandedKey === key ? '' : key });
  },

  render() {
    const all = this._rows || [];
    const range = this.data.range === 'week' ? 'week' : 'today';
    const now = new Date();
    const todayKey = ymd(now);
    const startTs = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (WEEK_DAYS - 1), 0, 0, 0, 0).getTime();
    const endTs = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).getTime();

    // —— 契约 §3.1 过滤：匿名行 / 测试账号 / 7 天窗口 / 未来时间 ——
    const normalized = [];
    all.forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      const sid = String(r.sid == null ? '' : r.sid).trim();
      if (!sid || isTestSid(sid)) return;
      const ts = tsOf(r);
      if (!ts || ts < startTs || ts >= endTs) return;
      const d = new Date(ts);
      normalized.push({
        sid: sid,
        name: String(r.name == null ? '' : r.name).trim(),
        client: normClient(r.client),
        ver: cleanVer(r.ver),
        dev: cleanDev(r.dev),
        did: String(r.did == null ? '' : r.did).trim(),
        ts: ts,
        day: ymd(d),
        hour: d.getHours()
      });
    });
    const rows = range === 'today' ? normalized.filter(function (r) { return r.day === todayKey; }) : normalized;

    // —— 契约 §3.2 账号聚合 ——
    const map = Object.create(null);
    rows.forEach(function (r) {
      let a = map[r.sid];
      if (!a) {
        a = map[r.sid] = {
          key: r.sid, count: 0, firstTs: 0, lastTs: 0, lastClient: '', lastDev: '', lastVer: '',
          name: '', nameTs: -1, nameIndex: -1, days: Object.create(null), deviceKeys: Object.create(null), rows: []
        };
      }
      a.count += 1;
      a.rows.push(r);
      if (!a.firstTs || r.ts < a.firstTs) a.firstTs = r.ts;
      // 同时间取输入顺序靠后者（契约 §3.2 lastClient/lastDev/lastVer）
      if (r.ts >= a.lastTs) {
        a.lastTs = r.ts;
        a.lastClient = r.client;
        a.lastDev = r.dev;
        a.lastVer = r.ver;
      }
      if (r.name && (r.ts > a.nameTs || (r.ts === a.nameTs && a.rows.length - 1 > a.nameIndex))) {
        a.name = r.name;
        a.nameTs = r.ts;
        a.nameIndex = a.rows.length - 1;
      }
      a.days[r.day] = 1;
      a.deviceKeys[deviceKeyOf(r)] = 1;
    });
    const accountsAll = Object.keys(map).map(function (k) {
      return buildAccount(map[k], range, todayKey);
    }).sort(function (a, b) {
      return (b.count - a.count) || (b.lastTs - a.lastTs) || cmpText(a.name, b.name);
    });
    let maxCount = 1;
    accountsAll.forEach(function (a) { if (a.count > maxCount) maxCount = a.count; });
    accountsAll.forEach(function (a) { a.pct = Math.round(a.count / maxCount * 100); });
    const truncated = accountsAll.length > MAX_ACCOUNTS;
    const accounts = truncated ? accountsAll.slice(0, MAX_ACCOUNTS) : accountsAll;

    // —— 契约 §3.3 全局聚合 ——
    const summary = {
      accounts: accountsAll.length,
      visits: rows.length,
      activeToday: accountsAll.filter(function (a) { return a.activeToday; }).length,
      devices: (function () {
        const set = Object.create(null);
        rows.forEach(function (r) { set[deviceKeyOf(r)] = 1; });
        return Object.keys(set).length;
      })()
    };
    const clients = fillPct(clientGroups(rows), rows.length);
    const versions = fillPct(topGroups(versionGroups(rows), MAX_GROUPS), rows.length);
    const devicesList = fillPct(topGroups(deviceGroups(rows), MAX_GROUPS).map(decorateDevice), rows.length);

    const payload = {
      state: rows.length ? 'data' : 'empty',
      summary: summary,
      trend: trendOf(rows, range, now, todayKey),
      trendTitle: range === 'today' ? '今日 24 小时' : '近 7 天',
      clients: clients,
      versions: versions,
      devicesList: devicesList,
      accounts: accounts,
      truncated: truncated
    };
    // 展开的账号已不在当前范围/被截断 → 收起
    const expanded = String(this.data.expandedKey || '');
    if (expanded) {
      let found = false;
      for (let i = 0; i < accounts.length; i++) if (accounts[i].key === expanded) { found = true; break; }
      if (!found) payload.expandedKey = '';
    }
    this.setData(payload);
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
