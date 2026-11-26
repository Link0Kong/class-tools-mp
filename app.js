// app.js —— 班级工具站（v12 原生小程序入口 · 班级身份 token 版）
//
// 身份（2026-11-04 起）：
//   * 启动页固定为 pages/identity/identity；输入 学号 + 姓名 → CloudBase RPC class_verify；
//   * 校验通过后 token/身份保存在 wx storage 'zq_class_identity'，此后所有数据请求自动带
//     X-Class-Token（统一由 utils/cloud.js 发出）；
//   * 没有有效身份时，任何页面都不能使用/请求班级数据（页面守卫 reLaunch 回身份页）。
//
// 数据契约（本机保存，未改字段名）：
//   zq_tools_v2            主数据（作业 / 通知 / 名单 / 体测 / 工具顺序等）
//   zq_class_identity      班级身份 {token,sid,name,role,badge,is_admin,ts}
//   zq_flow                抽签 / 分组 的本机跨页状态（含最近一次抽签 drawLast，供分组沿用）
//   ziqi.tools.v1          旧版数据（只读兼容）
//
// 云端：只用 wx.request，配置在 utils/cloud-config.js；未配置 / 断网 → 本机功能照常。
// 硬约束：不引 CDN / npm / 第三方 UI 库。
const identity = require('./utils/identity.js');
const version = require('./utils/version.js');
const appearance = require('./utils/appearance.js');

// 2026-11-17 启动性能：cloud.js（111KB）/ store / diag / notify 不再在 app.js 顶部 require。
// 身份页首帧只需要 identity/version/appearance；重模块等到首屏后用 cloudMod() 等懒加载，
// 避免冷启动 evaluateScript 阶段解析全部业务代码（小程序「按需注入」下这属于公有代码）。
function cloudMod() { return require('./utils/cloud.js'); }
function diagMod() { return require('./utils/diag.js'); }
function notifyMod() { return require('./utils/notify.js'); }

// 2026-11-15 外观（跟随系统/浅色/深色）：在 App() 之前包装全局 Page，给每个页面注入
// themeStyle/themeClass（页面 WXML 根节点 <page-meta page-style="{{themeStyle}}"> 使用），
// 并在 onShow 同步导航栏/窗口底色/tabBar。包装失败会静默降级为系统主题（不影响功能）。
try { appearance.decoratePages(); } catch (e) { /* 降级：跟随系统 */ }

const SYNC_MS = 30000;                    // 30s 轮询保留，但各表内部有 TTL 门控（大多数轮次 0 请求）
const WARM_MS = 300;                      // 首屏后延迟再打网络：先把本机/缓存数据渲染出来
const UD_MS = 5 * 60 * 1000;              // 个人偏好上云最少间隔（原来每 30s 一次没有意义）
const IDENTITY_ROUTE = 'pages/identity/identity';
const HANDOFF_MAX = 8;                    // AI 接力暂存上限（页面没打开时防止无限增长）

// ===== AI 页面接力（微信「小程序 AI 开发模式」）=====
// wx.onAgentHandoff 回调 { pageId, path, query, payload }：按 pageId 暂存到
// globalData.agentHandoffs，页面 onLoad 里用 utils/agent.pick(this) 消费（只消费一次）。
// 模块级先注册一次兜底；onLaunch 里再注册一次（wx 未就绪/抛错时可重试）。
let _agentHandoffHooked = false;

function receiveAgentHandoff(payload) {
  try {
    if (!payload || typeof payload !== 'object') return;
    const app = getApp && getApp();
    if (!app) return;
    app.globalData = app.globalData || {};
    app.globalData.agentHandoffs = app.globalData.agentHandoffs || {};
    const bag = app.globalData.agentHandoffs;
    const id = payload.pageId == null ? '' : String(payload.pageId);
    if (!id) return;
    bag[id] = payload;
    const keys = Object.keys(bag);
    if (keys.length > HANDOFF_MAX) { try { delete bag[keys[0]]; } catch (e) { /* ignore */ } }
  } catch (e) { /* 接力失败不影响小程序正常使用 */ }
}

function hookAgentHandoff() {
  if (_agentHandoffHooked) return true;
  try {
    if (!wx || typeof wx.onAgentHandoff !== 'function') return false;
    wx.onAgentHandoff(receiveAgentHandoff);
    _agentHandoffHooked = true;
    return true;
  } catch (e) { return false; }
}

// 模块级兜底：App 实例创建之前也尝试挂上；失败则由 onLaunch 重试
hookAgentHandoff();

// ===== 全局 JS 错误自动上报（2026-11-08 诊断 v2，契约 CONTRACT §2）=====
// 规则：仅已登录；按 fingerprint 去重（同 fingerprint 10 分钟最多 1 条）；每次运行最多 3 条自动上报；
//       上报失败静默（不弹窗、不阻塞、不重试风暴）；上报内容脱敏（无姓名/学号/宿舍/token/密码/完整 URL/绝对路径）。
// 计数（globalData.jsErrorCount）供诊断页「前端错误」检查项展示。
const ERR_WINDOW = 10 * 60 * 1000;      // 同 fingerprint 去重窗口
const ERR_MAX = 3;                      // 每 10 分钟最多自动上报 3 条
const _errSeen = {};                    // fingerprint -> 最近上报时间
let _errSent = [];                      // 最近 10 分钟上报时间戳

// 2026-11-09 诊断 v2.1（CONTRACT_V2_1 §B）：设备信息最小化，只保留可能影响功能的白名单字段
// platform / osVersion / baseLib / screen{w,h,dpr} / memoryMB / storagePct / network / clockSkewMs。
// 不采集品牌/型号/语言/UA；拿不到的字段给 0/空，不上报无关标识。
function errDeviceSafe() {
  const screen = { w: 0, h: 0, dpr: 0 };
  const out = {
    platform: 'mp', osVersion: '', baseLib: '', screen: screen,
    memoryMB: 0, storagePct: 0, network: 'unknown', clockSkewMs: 0
  };
  try {
    const info = wx.getDeviceInfo ? wx.getDeviceInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {});
    if (info) out.osVersion = String(info.system || '');
  } catch (e) { /* ignore */ }
  try {
    const base = wx.getAppBaseInfo ? wx.getAppBaseInfo() : null;
    if (base && base.SDKVersion) out.baseLib = String(base.SDKVersion);
  } catch (e) { /* ignore */ }
  try {
    const win = wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : null);
    if (win) {
      screen.w = Number(win.windowWidth) || 0;
      screen.h = Number(win.windowHeight) || 0;
      screen.dpr = Number(win.pixelRatio) || 0;
    }
  } catch (e) { /* ignore */ }
  try {
    const st = wx.getStorageInfoSync();
    if (st && Number(st.limitSize) > 0) out.storagePct = Math.round(Number(st.currentSize) / Number(st.limitSize) * 100);
  } catch (e) { /* ignore */ }
  return out;
}

function reportJsError(err) {
  try {
    const app = getApp && getApp();
    if (app && app.globalData) app.globalData.jsErrorCount = (app.globalData.jsErrorCount || 0) + 1;
    if (!identity.has()) return;                       // 仅已登录身份才上报
    const cloud = cloudMod();
    const diagUtil = diagMod();
    if (typeof cloud.diagReport !== 'function') return;
    const now = Date.now();
    _errSent = _errSent.filter(function (t) { return now - t < ERR_WINDOW; });
    if (_errSent.length >= ERR_MAX) return;            // 限频：不放大错误风暴
    const raw = String((err && (err.message || err.errMsg)) || err || 'unknown error');
    const msg = diagUtil.redact(raw).slice(0, 300);
    const dv = errDeviceSafe();
    const fp = diagUtil.fingerprintOf('error', 'js', msg, dv);
    if (_errSeen[fp] && now - _errSeen[fp] < ERR_WINDOW) return;   // 去重：同一错误 10 分钟只报一次
    _errSeen[fp] = now;
    _errSent.push(now);
    const row = {
      id: 'mp_' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      platform: 'mp', app_ver: version.VERSION, kind: 'error', level: 'error',
      message: msg,
      // §B：detail 只允许 check / latency_ms / storage_pct / clock_skew_ms / err_count / code；
      // check 必须带（deviceChecks 检查 id），agent 据此生成 diag_analysis.related.checks 才能下挂到「前端错误」行。
      detail: { check: 'js', err_count: 1, code: diagUtil.redact(String((err && err.name) || 'js_error')).slice(0, 40) || 'js_error' },
      device: dv, fingerprint: fp, ts: now
    };
    cloud.diagReport([row]).catch(function () { /* 失败静默：诊断上报不影响小程序使用 */ });
  } catch (e) { /* 上报自身异常静默 */ }
}

function currentRoute() {
  try {
    const pages = getCurrentPages();
    const cur = pages[pages.length - 1];
    return (cur && cur.route) ? String(cur.route) : '';
  } catch (e) { return ''; }
}

App({
  globalData: {
    version: version.VERSION,  // 版本号唯一来源 utils/version.js
    launchedAt: Date.now(),
    remoteReady: false,   // 云端是否已配置（纯本地判断，无副作用）
    identity: null,
    agentHandoffs: {},    // AI 接力暂存：{ [pageId]: { pageId, path, query, payload } }
    jsErrorCount: 0,      // 2026-11-08 诊断 v2：本次运行捕获的 JS 错误数（onError/onUnhandledRejection）
    memoryWarnCount: 0    // 2026-11-08 诊断 v2：本次运行收到的内存警告次数（wx.onMemoryWarning）
  },

  onLaunch() {
    // AI 页面接力监听（模块级已尝试挂载；这里重试，保证 onLaunch 后一定能接住）
    try { hookAgentHandoff(); } catch (e) {}
    // 诊断 v2：内存警告计数（只计数，不弹窗；诊断页「内存」检查项展示）
    try {
      if (wx.onMemoryWarning) {
        wx.onMemoryWarning(function () {
          const app = getApp && getApp();
          if (app && app.globalData) app.globalData.memoryWarnCount = (app.globalData.memoryWarnCount || 0) + 1;
        });
      }
    } catch (e) { /* 基础库不支持时忽略 */ }
    // 2026-11-17：wx.cloud.init / store.get() 移出 onLaunch 首帧关键路径。
    // 云开发 SDK 只在真正要发订阅消息时初始化（utils/notify.ensureInit）；
    // 主数据由工作台 onShow 的 store.reload() 读取，身份页不需要。
  },

  // 全局 JS 错误（诊断 v2）：同步计数 + 异步脱敏上报（仅已登录、去重、限频、失败静默）
  onError(err) { reportJsError(err); },
  onUnhandledRejection(res) {
    try { reportJsError((res && (res.reason || res)) || 'unhandledrejection'); } catch (e) { /* 静默 */ }
  },

  // App 方法兜底：部分调试链路会直接调用 app.onAgentHandoff(payload)
  onAgentHandoff(payload) { receiveAgentHandoff(payload); },

  onShow() {
    this.globalData.identity = identity.get();
    if (!identity.has()) {
      this.stopSync();
      this.clearWarm();
      // 启动页本来就是身份页，不要重复 reLaunch 造成循环
      if (currentRoute() && currentRoute().indexOf(IDENTITY_ROUTE) < 0) identity.goIdentity();
      return;
    }
    this.startSync();
    // 首屏优先：名单/marks/访问记录等次要请求延后到 WARM_MS，先让当前 tab 用本机缓存渲染；
    // 页面 onShow 自身仍会按需强拉 marks（sync_contract 需求16 的页面级保障不变）。
    this.scheduleWarm();
  },

  onHide() {
    this.clearWarm();
    this.stopSync();
    // 「选完马上退出」：页面已把选择同步落盘；这里取消防抖并立即尝试推送一次 userdata。
    try { cloudMod().udFlush(); } catch (e) { /* 离线/未登录时失败不影响本机保存 */ }
  },

  // 首屏后预热 / 回到前台后的后台同步（不阻塞 UI）
  scheduleWarm() {
    this.clearWarm();
    this._warmT = setTimeout(() => { this._warmT = null; this.warmSync(); }, WARM_MS);
  },
  // 首屏后的次要云请求：名单缓存、访问记录、marks 强拉，再整表后台同步
  warmSync() {
    if (!identity.has()) return;
    const cloud = cloudMod();
    this.globalData.remoteReady = cloud.isEnabled();
    cloud.ensureMembers(false).catch(function () { /* 名单拉取失败保留本机缓存 */ });
    cloud.visitLog();  // 每小时最多一次按账号的访问记录
    // 需求 16：回前台/冷启动后强制拉一次 marks（页面 onShow 已能立即触发；这里再兜底一次），失败静默。
    // 需求 9（2026-11-11）：页面 onShow 刚强拉过（5s 内）就不再重复发同一请求（首屏请求数 -1）。
    if (!cloud.marksFresh(5000)) {
      cloud.marksPull(true).catch(function () { /* 离线保留本机状态 */ });
    }
    // 2026-11-17：订阅消息云函数只在用户真正开过提醒时才调用（以前每次前台固定 2 次，
    // 云函数未部署/未联网时只会制造失败请求）。init 也延后到这里，不占启动首帧。
    let d = null;
    try { d = require('./utils/store.js').get(); } catch (e) { /* ignore */ }
    const remindCount = d ? Object.keys(d.ntRemind || {}).length : 0;
    const hwRemindCount = d ? Object.keys(d.hwRemind || {}).length : 0;
    if (d && (remindCount || hwRemindCount)) {
      const notify = notifyMod();
      // 通知提醒 catch-up（2026-11-10 修复）：定时触发器之外的送达保障——回前台时补发本人已到点的提醒；
      // 云函数只处理调用者 openid，失败静默（离线/未授权不影响启动）。
      try { notify.flushReminders().catch(function () { /* 静默 */ }); } catch (e) { /* 静默 */ }
    }
    this.bgSync();
  },
  clearWarm() {
    if (this._warmT) { clearTimeout(this._warmT); this._warmT = null; }
  },

  // 定时同步（等价网页版 setInterval 30s 的 cloudPull + udSync）
  // 2026-11-17：等首屏后再加载 cloud.js / 启动 30s 定时器，避免身份页首帧解析 111KB 业务模块。
  startSync() {
    if (!identity.has()) return;
    if (this._timer || this._startT) return;
    this._startT = setTimeout(() => {
      this._startT = null;
      const cloud = cloudMod();
      if (!cloud.isEnabled() || !identity.has() || this._timer) return;
      this._timer = setInterval(() => { this.bgSync(); }, SYNC_MS);
    }, WARM_MS);
  },
  stopSync() {
    if (this._startT) { clearTimeout(this._startT); this._startT = null; }
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  bgSync() {
    if (!identity.has()) return Promise.resolve(null);
    const cloud = cloudMod();
    return cloud.cloudPull().then(() => {
      if (!identity.has()) return null;
      const now = Date.now();
      if (now - (this._udAt || 0) > UD_MS) { this._udAt = now; cloud.udSync(false); }
      this.notifyPages();
      return null;
    }).catch(() => null);
  },

  // 让当前页面有机会重绘（页面实现 onCloudSync 即可）
  notifyPages() {
    try {
      const pages = getCurrentPages();
      const cur = pages[pages.length - 1];
      if (cur && typeof cur.onCloudSync === 'function') cur.onCloudSync();
    } catch (e) { /* 忽略 */ }
  }
});
