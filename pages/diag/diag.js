// pages/diag/diag.js —— 诊断 v2.1（2026-11-09；所有有效班级身份可见）
//
// 契约：诊断接口字段与错误码以云端 RPC 契约为准（v2.1）
//   * 服务健康 public.service_health（RLS auth_ok）：18 行 / 5 组；保留原分组、状态中文、
//     cloudbase 实时延迟覆盖、采集主机心跳离线降级、site_static/jwxt 快照兜底与 60s 刷新；
//   * AI 结论（diag_analysis）**下挂到对应异常项**：related.health_ids → 服务健康行；
//     related.checks → 设备检查行（id 与 utils/diag.js deviceChecks 的 check id 一致）；
//     无关联的进「其它诊断」折叠区（默认收起只显示条数）；折叠一行 = severity 点 + 标题(≤22字) + 状态胶囊 + ›，
//     点击展开 cause / suggestion / flow 时间线 / 关联修复（related.repair_id 或 repair_tasks.analysis_id）；
//   * 异常行没有 AI：本机在线 →「AI 分析排队中…」；离线 →「本机离线，已留存待开机修复」；
//   * 顶部摘要追加「可自动修复 N · 已修复 M」；不再有独立「AI 分析」/「修复记录」大卡；
//   * 设备诊断（本机）：10 项；设备信息按 §B 最小化（去品牌/型号/语言），detail 只出现白名单量；
//     异常自动上报 public.client_diag（detail 必带 check；同 fingerprint 10 分钟 1 条、每次≤3 条）；
//   * 进展：AI/修复数据 10s 轮询（页面可见时；onShow 立即拉），service_health 60s 刷新；
//   * 无管理员门禁：仅要求有效班级身份（未完成身份才拒绝且不发请求）。
const store = require('../../utils/store.js');
const identity = require('../../utils/identity.js');
const cloud = require('../../utils/cloud.js');
const notify = require('../../utils/notify.js');
const diag = require('../../utils/diag.js');
const util = require('../../utils/util.js');
const share = require('../../utils/share.js');
const scrollmem = require('../../utils/scrollmem.js');
const version = require('../../utils/version.js');

const REFRESH_MS = 60000;          // 服务健康自动刷新（保持 60s）
const DIAG_REFRESH_MS = 10000;     // 诊断 v2.1：AI 分析 / 修复进展 10s 轮询（仅页面可见时）
const REPORT_KEY = 'zq_diag_report_v1';   // 上报限频记录 { '<fingerprint>': <ts> }
const REPORT_WINDOW = 10 * 60 * 1000;     // 同 fingerprint 10 分钟最多 1 条

function nowHM() {
  return diag.fmtHMS(Date.now());
}

Page({
  data: {
    state: 'loading',        // loading | ready | denied（denied = 未完成班级身份）
    errorText: '',
    denied: false,
    busy: false,
    groups: [],              // 服务健康分组（items 带 ai[] / queueHint）
    summary: { level: 'unknown', text: '检测中' },
    hint: null,
    lastTryText: '--:--:--',
    // —— 设备诊断卡（设备信息最小化：无品牌/型号/语言） ——
    dev: { checks: [], summary: { level: 'unknown', text: '检测中' }, tsText: '' },
    record: null,            // { anomalyN }：本轮设备检查的异常项数（手动上报按钮用）
    reportText: '',
    // —— 本机 agent + 其它诊断 + 摘要统计 ——
    agent: { online: false, text: '未知', seenText: '', host: '', version: '' },
    others: { count: 0, open: false, items: [], repairs: [] },
    diagStats: { show: false, text: '', autoFixN: 0, fixedN: 0 },
    diagBusy: false,
    diagAtText: '--:--:--',
    // 2026-11-18：提醒通道诊断（手动提醒：作业 / 单条通知；新通知提醒已移除）
    notifyDiag: { show: false, ok: false, hbText: '—', activeText: '', errText: '' }
  },

  onLoad(options) {
    scrollmem.attach(this);
    options = options || {};
    this._timer = null;
    this._diagTimer = null;
    this._busy = false;
    this._diagBusy = false;
    this._rows = [];         // 上次成功拉到的 service_health 行（云端失败时仍可展示，不误报离线）
    this._lastTry = 0;
    this._lastDone = false;
    this._cloud = null;
    this._agentInfo = null;
    this._analyses = [];     // AI 分析原始行（diag_analysis）
    this._repairs = [];      // 修复任务原始行（repair_tasks）
    this._groups = [];       // 服务健康原始分组（下挂前）
    this._devRaw = [];       // 设备检查原始项（下挂前）
    this._devSummary = null;
    this._devTs = '';
    this._openMap = {};      // 展开的 AI 行 { <analysis id>: true }
    this._othersOpen = false;
    this._diagAt = 0;
    this._devReported = false;   // 本次页面生命周期是否已做过自动上报（每页最多一轮）
    // 取消管理员门禁：只要求有效班级身份（没有身份才拒绝，不发任何请求）
    if (!identity.has()) { this.setData({ state: 'denied', denied: true }); return; }
    this.setData({ state: 'loading' });
  },

  onShow() {
    share.enable();
    if (!identity.ensure()) return;
    scrollmem.restore(this);
    this.setData({ denied: false });
    // 进入/重新可见立即拉一次（AI/修复进展 10s 轮询之外，保证开屏就是最新状态）
    this.runDevice();          // 设备诊断（本机，含一次轻量网关请求）
    this.load();               // 服务健康（60s 刷新）
    this.loadDiag();           // agent / AI 分析 / 修复任务（10s 轮询）
    this.loadNotifyDiag();     // 2026-11-11 需求 11：提醒通道诊断（云函数心跳/active/扫描错误）
    this._startTimer();
    this._startDiagTimer();
  },
  onHide() { scrollmem.save(this); this._stopTimer(); this._stopDiagTimer(); },
  onUnload() { scrollmem.save(this); this._stopTimer(); this._stopDiagTimer(); },
  onPageScroll(e) { scrollmem.onScroll(this, e); },
  onPullDownRefresh() {
    const done = () => { try { wx.stopPullDownRefresh(); } catch (e) { /* ignore */ } };
    Promise.all([this.runDevice(), this.load(), this.loadDiag(), this.loadNotifyDiag()]).then(done, done);
  },
  onCloudSync() { if (identity.has()) this.load(); },

  _startTimer() {
    this._stopTimer();
    this._timer = setInterval(() => { if (this._visible()) this.load(); }, REFRESH_MS);
  },
  _stopTimer() { if (this._timer) { clearInterval(this._timer); this._timer = null; } },
  _startDiagTimer() {
    this._stopDiagTimer();
    this._diagTimer = setInterval(() => { if (this._visible()) this.loadDiag(); }, DIAG_REFRESH_MS);
  },
  _stopDiagTimer() { if (this._diagTimer) { clearInterval(this._diagTimer); this._diagTimer = null; } },
  _visible() {
    try {
      const pages = getCurrentPages();
      const cur = pages[pages.length - 1];
      return !cur || cur.route === 'pages/diag/diag';
    } catch (e) { return true; }
  },

  /* ================= 服务健康（18 行 / 5 组；保留原渲染） ================= */
  load() {
    if (!identity.has()) { this.setData({ state: 'denied', denied: true }); return Promise.resolve(false); }
    if (this._busy) return Promise.resolve(false);
    this._busy = true;
    this.setData({ busy: true });
    const t0 = Date.now();
    return cloud.serviceHealth().then((r) => {
      this._busy = false;
      this._lastTry = Date.now();
      this._lastDone = true;
      this._cloud = r && r.ok
        ? { ok: true, latency: Number(r.latency) || Math.max(0, Date.now() - t0), list: r.list || [] }
        : { ok: false, latency: Number((r && r.latency) || Date.now() - t0), list: [], error: (r && r.error) || 'network' };
      if (this._cloud.ok && this._cloud.list.length) this._rows = this._cloud.list;
      this.render();
      return true;
    }).catch((e) => {
      this._busy = false;
      this._lastTry = Date.now();
      this._lastDone = true;
      this._cloud = { ok: false, latency: Date.now() - t0, list: [], error: String((e && e.message) || e) };
      this.render();
      return false;
    });
  },

  render() {
    const cache = store.get().ttCache;
    const ttFetchedAt = (cache && cache.meta && Number(cache.meta.fetchedAt)) || 0;
    const view = diag.build({
      cloud: this._cloud,
      rows: this._rows,
      ttFetchedAt: ttFetchedAt,
      lastDone: this._lastDone,
      now: Date.now()
    });
    this._groups = view.groups;              // 原始分组（AI 下挂由 _relink 完成）
    this.setData({
      state: 'ready',
      busy: false,
      errorText: '',
      summary: view.summary,
      hint: view.hint,
      lastTryText: this._lastTry ? diag.fmtHMS(this._lastTry) : '--:--:--'
    });
    this._relink();
  },

  // 把 AI 分析下挂到服务健康行 / 设备检查行，并刷新「其它诊断」与摘要统计（纯函数 diag.groupAnalyses）
  _relink() {
    const known = !!this._agentInfo;
    const linked = diag.groupAnalyses(this._analyses, this._groups, this._devRaw, this._repairs, {
      agentOnline: !!(this._agentInfo && this._agentInfo.online),
      agentKnown: known,
      openMap: this._openMap,
      now: Date.now()
    });
    // 展开状态只保留仍存在的 analysis（避免历史 id 常驻内存）
    const keep = {};
    linked.analyses.forEach((a) => { if (this._openMap[a.id]) keep[a.id] = true; });
    this._openMap = keep;
    this.setData({
      groups: linked.groups,
      dev: {
        checks: linked.devChecks,
        summary: this._devSummary || { level: 'unknown', text: '检测中' },
        tsText: this._devTs || ''
      },
      others: {
        count: linked.others.count,
        open: !!this._othersOpen,
        items: linked.others.items,
        repairs: linked.others.repairs
      },
      diagStats: linked.stats
    });
  },

  /* ================= 折叠 / 展开 ================= */
  // 点整行展开或收起（AI 行数据带 id；展开态由 _openMap 控制，重绘后保持）
  toggleAnalysis(e) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.aid) || '');
    if (!id) return;
    this._openMap[id] = !this._openMap[id];
    this._relink();
  },
  toggleOthers() {
    this._othersOpen = !this._othersOpen;
    this._relink();
  },

  /* ================= 设备诊断（本机采集 → 纯函数判定 → 异常自动上报） ================= */
  // 2026-11-09 §B：设备信息最小化——只采集「可能导致功能不可用」的白名单量（无品牌/型号/语言/UA）
  _deviceBase() {
    const out = {
      appVer: version.VERSION,
      device: {
        platform: 'mp',
        osVersion: '', baseLib: '',
        screen: { w: 0, h: 0, dpr: 0 },
        memoryMB: 0, storagePct: 0, network: 'unknown', clockSkewMs: null
      },
      storage: { ok: false },
      memoryWarn: 0, jsErrors: 0,
      network: 'unknown', gateway: null, siteAssets: null
    };
    try {
      const app = (typeof getApp === 'function') ? getApp() : null;
      const gd = (app && app.globalData) || {};
      out.memoryWarn = Number(gd.memoryWarnCount) || 0;
      out.jsErrors = Number(gd.jsErrorCount) || 0;
    } catch (e) { /* ignore */ }
    try {
      const d = wx.getDeviceInfo ? wx.getDeviceInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {});
      if (d) out.device.osVersion = String(d.system || '');
    } catch (e) { /* ignore */ }
    try {
      const w = wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {});
      if (w) {
        out.device.screen.w = Number(w.windowWidth) || 0;
        out.device.screen.h = Number(w.windowHeight) || 0;
        out.device.screen.dpr = Number(w.pixelRatio) || 0;
      }
    } catch (e) { /* ignore */ }
    try {
      const b = wx.getAppBaseInfo ? wx.getAppBaseInfo() : null;
      if (b && b.SDKVersion) out.device.baseLib = String(b.SDKVersion);
    } catch (e) { /* ignore */ }
    if (!out.device.baseLib) {
      try { out.device.baseLib = String((wx.getSystemInfoSync ? wx.getSystemInfoSync() : {}).SDKVersion || ''); } catch (e) { /* ignore */ }
    }
    try {
      const perf = (typeof wx.getPerformance === 'function') ? wx.getPerformance() : null;
      const mem = perf && perf.memory;
      if (mem && Number(mem.jsHeapSizeLimit) > 0) out.device.memoryMB = Math.round(Number(mem.jsHeapSizeLimit) / 1024 / 1024);
    } catch (e) { /* 部分基础库没有 getPerformance.memory */ }
    try {
      const st = wx.getStorageInfoSync();
      if (st && Number(st.limitSize) > 0) {
        out.storage = { ok: true, currentSize: Number(st.currentSize) || 0, limitSize: Number(st.limitSize) || 0 };
        out.device.storagePct = Math.round(out.storage.currentSize / out.storage.limitSize * 100);
      } else {
        out.storage = { ok: true, currentSize: 0, limitSize: 0 };
        out.device.storagePct = 0;
      }
    } catch (e) { out.storage = { ok: false }; }
    return out;
  },
  runDevice() {
    const base = this._deviceBase();
    const netP = new Promise((resolve) => {
      try {
        if (typeof wx.getNetworkType !== 'function') return resolve('unknown');
        wx.getNetworkType({
          success: (r) => resolve(String((r && r.networkType) || 'unknown')),
          fail: () => resolve('unknown')
        });
      } catch (e) { resolve('unknown'); }
    });
    // 一次轻量 GET：网关延迟 + site_assets 可用性 + 服务端时间（→ 时钟偏差）
    const pingP = (identity.has() && cloud.isEnabled())
      ? cloud.diagPing()
      : Promise.resolve({ ok: false, latency: 0, siteAssets: false, serverTime: 0, error: '' });
    return Promise.all([netP, pingP]).then((r) => {
      const net = r[0] || 'unknown';
      const ping = r[1] || {};
      base.network = net;
      base.device.network = net;
      if (identity.has() && cloud.isEnabled()) {
        base.gateway = { ok: !!ping.ok, latency: Number(ping.latency) || 0, error: ping.error || '' };
        base.siteAssets = { ok: !!ping.siteAssets, checked: true };
        const st = Number(ping.serverTime) || 0;
        base.device.clockSkewMs = st ? Math.round(Date.now() - st) : null;
      }
      this._applyDevice(base);
      return true;
    }).catch(() => {
      this._applyDevice(base);
      return false;
    });
  },
  _applyDevice(input) {
    const view = diag.deviceChecks(input);
    this._devRaw = view.checks;              // 原始检查项（AI 下挂由 _relink 完成）
    this._devSummary = view.summary;
    this._devTs = nowHM();
    this.setData({ record: { anomalyN: view.anomalies.length } });
    this._relink();
    // 异常自动上报（每页面实例最多一轮；同 fingerprint 10 分钟 1 条；每次≤3 条）
    if (view.anomalies.length && !this._devReported) {
      this._devReported = true;
      this._report(view, input, false);
    } else if (!view.anomalies.length) {
      this.setData({ reportText: '无异常，不上报' });
    }
    return view;
  },
  // 手动上报按钮：对当前检测项再做一次上报（仍受 10 分钟同 fingerprint 限频）
  reportTap() {
    if (!identity.has()) { util.toast('请先完成身份验证'); return; }
    const base = this._deviceBase();
    this._devReported = true;              // 手动上报：跳过 _applyDevice 的自动上报，避免同批异常重复提交
    const view = this._applyDevice(base);
    if (!view.anomalies.length) { util.toast('没有需要上报的异常'); return; }
    this._report(view, base, true);
  },
  recheckDev() { this.runDevice(); },
  // rows 由 utils/diag.buildReportRows 生成（§B 白名单：detail 必带 check）；限频记录只存 fingerprint + 时间
  _report(view, input, manual) {
    const checks = (view && view.checks) || this._devRaw || [];
    const anomalies = [];
    checks.forEach((c) => { if (c.st === 'down' || c.st === 'warn') anomalies.push({ id: c.id, st: c.st }); });
    if (!anomalies.length) return Promise.resolve(false);
    const snapshot = input || this._deviceBase();
    let rows = diag.buildReportRows(anomalies, snapshot, { appVer: version.VERSION });
    const now = Date.now();
    let rate = {};
    try { rate = JSON.parse(wx.getStorageSync(REPORT_KEY) || '{}') || {}; } catch (e) { rate = {}; }
    Object.keys(rate).forEach((k) => { if (!(now - Number(rate[k]) < REPORT_WINDOW)) delete rate[k]; });
    rows = rows.filter((r) => !rate[r.fingerprint]).slice(0, 3);
    if (!rows.length) {
      this.setData({ reportText: '10 分钟内已上报过同类问题' });
      if (manual) util.toast('10 分钟内已上报过同类问题');
      return Promise.resolve(false);
    }
    return cloud.diagReport(rows).then((r) => {
      if (r && r.ok) {
        rows.forEach((row) => { rate[row.fingerprint] = now; });
        try { wx.setStorageSync(REPORT_KEY, JSON.stringify(rate)); } catch (e) { /* ignore */ }
        this.setData({ reportText: '已上报 ' + r.count + ' 条 · ' + nowHM() });
        if (manual) util.toast('已上报 ' + r.count + ' 条');
        return true;
      }
      this.setData({ reportText: '上报失败，稍后自动重试' });
      if (manual) util.toast('上报失败，请稍后再试');
      return false;
    }).catch(() => {
      this.setData({ reportText: '上报失败，稍后自动重试' });
      return false;
    });
  },

  /* ================= 本机 agent / AI 分析 / 修复任务（10s 轮询） ================= */
  loadDiag() {
    if (!identity.has()) return Promise.resolve(false);
    if (this._diagBusy) return Promise.resolve(false);
    this._diagBusy = true;
    this.setData({ diagBusy: true });
    return Promise.all([
      cloud.diagAgentInfo ? cloud.diagAgentInfo() : Promise.resolve(null),
      cloud.diagAnalyses ? cloud.diagAnalyses() : Promise.resolve([]),
      cloud.diagRepairs ? cloud.diagRepairs() : Promise.resolve([])
    ]).then((r) => {
      this._diagBusy = false;
      // 瞬时失败（null / ok=false）保留上次数据：10s 轮询不会把已渲染的 AI 行闪没
      const agent = r[0];
      if (agent && agent.ok !== false) this._agentInfo = agent;
      if (Array.isArray(r[1])) this._analyses = r[1];
      if (Array.isArray(r[2])) this._repairs = r[2];
      this.renderDiag();
      return true;
    }).catch(() => {
      this._diagBusy = false;
      this.setData({ diagBusy: false });
      return false;
    });
  },
  renderDiag() {
    const now = Date.now();
    this._diagAt = now;
    this.setData({
      agent: diag.agentView(this._agentInfo, now),
      diagAtText: diag.fmtHMS(now),
      diagBusy: false
    });
    this._relink();
  },

  /* ================= 提醒通道诊断（手动提醒：作业 / 单条通知；2026-11-18 移除新通知提醒） =================
     数据来自云函数 notify action='diag'（只读，不含 openid/ref/token）：
       hb        定时器心跳 {ts, agoMs, source}（判断触发器有没有在跑）
       active    云端 active 提醒数（hw + ntremind）
       lastError 最近错误
     失败静默显示「诊断不可用」（未部署云函数 / 未开通云开发），不影响其它诊断行。 */
  loadNotifyDiag() {
    if (!identity.has() || !cloud.isEnabled() || !wx.cloud || !wx.cloud.callFunction) {
      this.setData({ notifyDiag: { show: true, ok: false, hbText: '—', activeText: '', errText: '' } });
      return Promise.resolve(false);
    }
    return notify.diag().then((d) => {
      if (!d) {
        this.setData({ notifyDiag: { show: true, ok: false, hbText: '—', activeText: '', errText: '' } });
        return false;
      }
      const hb = d.hb || null;
      const hbAgo = hb ? Math.max(0, Number(hb.agoMs) || 0) : 0;
      const hbText = hb
        ? ((hbAgo < 60000 ? '刚刚' : (hbAgo < 3600000 ? Math.round(hbAgo / 60000) + ' 分钟前' : Math.round(hbAgo / 3600000) + ' 小时前')) +
          '（' + String(hb.source || 'timer') + '）')
        : '从未运行（触发器未生效或云函数未部署）';
      const errText = String(d.lastError || '');
      this.setData({
        notifyDiag: {
          show: true,
          ok: !errText,
          hbText: hbText,
          activeText: 'active ' + (Number(d.active) || 0) + ' 条提醒',
          errText: errText ? ('lastError：' + errText.slice(0, 120)) : ''
        }
      });
      return true;
    }).catch(() => {
      this.setData({ notifyDiag: { show: true, ok: false, hbText: '—', activeText: '', errText: '' } });
      return false;
    });
  },

  refreshTap() { this.load(); this.loadDiag(); this.runDevice(); this.loadNotifyDiag(); },
  goAll() { wx.switchTab({ url: '/pages/all/all' }); },

  onShareAppMessage() {
    return share.message({
      title: '班级工具｜服务诊断',
      path: '/pages/diag/diag',
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '班级工具｜服务诊断',
      imageUrl: '/images/share/default.png'
    });
  }
});
