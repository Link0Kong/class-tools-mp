// utils/diag.js —— 诊断页纯逻辑（与网站 DIAG 模块对齐，v2.0.0 网站功能同步；2026-11-08 诊断 v2 对所有已认证同学可见）
//
// 数据来源：CloudBase public.service_health（RLS auth_admin()，仅管理员可读）
//   { id,name,kind,status,detail,meta,checked_at }（云端巡检 + 采集主机心跳上报）
// 与网站同口径（2026-11-07 v2：18 行 / 5 组）：
//   * 分组：站点与网页 / 云端后台 / 信息采集 / 定时任务 / 采集主机；
//   * 状态 ok/warn/down/offline/unknown（中文：正常/注意/异常/离线/未知）；
//   * cloudbase 行用本次请求延迟覆盖（<3s ok，否则 warn；请求失败 down）；小程序不能读证书，site_tls 只展示云端行；
//   * 采集主机心跳超过 15 分钟未更新或缺失时，所有 kind=local 行降级「离线」并在行尾显示「上报于 HH:MM」；
//   * 云端巡检 cloud_health_probe 的 checked_at 是巡检心跳：缺失或超过 15 分钟未更新时，
//     其它 kind=cloud 行状态为 ok 的改为「注意」并在 detail 追加「· 巡检未更新」
//     （cloudbase 的浏览器实时延迟覆盖除外；kind=static 的站点行由云端暂停语义控制，不参与该降级）；
//   * site_static / jwxt 云端无行时可退回本机 ttCache.meta.fetchedAt（课表快照新鲜度：≤30h ok / ≤54h warn / 其他 down）。
// 纯函数，便于 Node 单测。
const STALE = 15 * 60 * 1000;   // 采集主机心跳超过 15 分钟 = 离线
const SLOW = 3000;              // 云端直连 <3s 正常，否则「注意」

const GROUPS = [
  { t: '站点与网页', ids: ['site_static', 'site_tls', 'dns_domain'] },
  { t: '云端后台', ids: ['cloudbase', 'tt_cloud', 'cloud_power_sync', 'cloud_xgj_sync', 'cloud_health_probe'] },
  { t: '信息采集', ids: ['qqflow', 'weflow', 'watcher', 'briefdesk', 'qq_client', 'wechat_client'] },
  { t: '定时任务', ids: ['jwxt', 'hwauto', 'ai'] },
  { t: '采集主机', ids: ['collector_host'] }
];
const NAMES = {
  cloudbase: '云端数据库', site_static: '站点资源', site_tls: '站点证书', dns_domain: '域名解析',
  tt_cloud: '课表云端数据', cloud_power_sync: '电费云同步', cloud_xgj_sync: '学工记云同步', cloud_health_probe: '云端巡检',
  collector_host: '采集主机', qqflow: 'QQ 消息采集', weflow: '微信消息采集', briefdesk: '本地通知服务',
  watcher: '文档/通知监听', ai: 'AI 识别', jwxt: '教务课表同步', hwauto: '作业自动整理',
  qq_client: 'QQ 客户端', wechat_client: '微信客户端'
};
const KINDS = {
  cloudbase: 'cloud', site_static: 'static', site_tls: 'static', dns_domain: 'cloud',
  tt_cloud: 'cloud', cloud_power_sync: 'cloud', cloud_xgj_sync: 'cloud', cloud_health_probe: 'cloud',
  collector_host: 'local',
  qqflow: 'local', weflow: 'local', briefdesk: 'local', watcher: 'local', ai: 'local', jwxt: 'local',
  hwauto: 'local', qq_client: 'local', wechat_client: 'local'
};
const LABEL = { ok: '正常', warn: '注意', down: '异常', offline: '离线', unknown: '未知' };

function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function fmtHM(ms) {
  const n = num(ms);
  if (!n) return '';
  const d = new Date(n);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function fmtHMS(ms) {
  const n = num(ms);
  if (!n) return '--:--:--';
  const d = new Date(n);
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}
function ago(ms) {
  const s = Math.max(0, Math.round(num(ms) / 1000));
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.round(s / 60) + ' 分钟前';
  const h = Math.round(s / 3600);
  if (h < 24) return h + ' 小时前';
  return Math.round(h / 24) + ' 天前';
}
function norm(st) {
  st = String(st || 'unknown');
  return (st === 'ok' || st === 'warn' || st === 'down') ? st : 'unknown';
}
function snapText(h) {
  if (h < 1) return '课表快照 1 小时内';
  if (h < 24) return '课表快照 ' + Math.floor(h) + ' 小时前';
  return '课表快照 ' + Math.floor(h / 24) + ' 天前';
}

// 单行合并：云端行 → 实时覆盖（cloudbase 延迟）→ 采集主机心跳新鲜度决定 local 行是否离线
// ctx: { cloud:{ok,latency,list,error}, rows:[上次云端缓存], ttFetchedAt:ms, lastDone:bool, now:ms }
function buildItem(id, row, ctx) {
  const kind = KINDS[id] || 'local';
  const now = ctx.now || Date.now();
  let st = 'unknown';
  let detail = '';
  let side = '';
  if (row) {
    st = norm(row.status);
    detail = String(row.detail || '');
    const chk = num(row.checked_at);
    if (chk) side = ago(now - chk);
  }
  if (id === 'cloudbase') {
    const c = ctx.cloud;
    if (!c) detail = '检测中';
    else if (c.ok) { st = c.latency < SLOW ? 'ok' : 'warn'; detail = '小程序直连 ' + c.latency + 'ms'; side = c.latency + 'ms'; }
    else { st = 'down'; detail = '小程序直连失败'; side = ''; }
    if (!ctx.lastDone) detail = '检测中';
  } else if (id === 'site_static' && !row && num(ctx.ttFetchedAt)) {
    // 小程序没有同源站点资源可探测：云端无行时用本机课表快照新鲜度兜底
    const h = (now - num(ctx.ttFetchedAt)) / 3600000;
    st = h <= 30 ? 'ok' : (h <= 54 ? 'warn' : 'down');
    detail = snapText(h);
    side = fmtHM(num(ctx.ttFetchedAt)) + ' 更新';
  } else if (id === 'jwxt' && !row && num(ctx.ttFetchedAt)) {
    const h = (now - num(ctx.ttFetchedAt)) / 3600000;
    st = h <= 30 ? 'ok' : (h <= 54 ? 'warn' : 'down');
    detail = snapText(h);
    side = fmtHM(num(ctx.ttFetchedAt)) + ' 更新';
  }
  if (kind === 'local' && ctx.hostOffline) {
    st = 'offline';
    if (!detail) detail = '暂无上报';
    const ck2 = row ? num(row.checked_at) : 0;
    side = ck2 ? ('上报于 ' + fmtHM(ck2)) : '';
  } else if (kind === 'local' && ctx.hostUnknown && st === 'unknown') {
    detail = detail || '云端数据不可用';
  }
  // 云端巡检心跳过期：其它 cloud 行「正常」降级为「注意 · 巡检未更新」（cloudbase 实时延迟覆盖除外；
  // site_static/site_tls 是 static，由云端暂停语义控制，不参与）。与网站 DIAG 逐行一致。
  if (kind === 'cloud' && ctx.cloudStale && st === 'ok' && id !== 'cloudbase') {
    st = 'warn';
    detail = detail ? (detail + ' · 巡检未更新') : '巡检未更新';
  }
  if (!ctx.lastDone && !detail) detail = '检测中';
  return { id: id, name: NAMES[id] || id, st: st, display: LABEL[st] || '未知', detail: detail, side: side };
}

// 生成整页视图：{ groups:[{t,items}], summary:{level,text}, hint:{cls,text}|null, flat:[items] }
function build(ctxIn) {
  const ctx = Object.assign({}, ctxIn || {});
  const now = ctx.now || Date.now();
  const cloud = ctx.cloud || null;
  const lastDone = !!ctx.lastDone;
  const cloudOk = !!(cloud && cloud.ok);
  const cloudDown = !!(cloud && !cloud.ok);
  const rows = cloudOk ? (cloud.list || []) : (ctx.rows || []);
  const map = {};
  rows.forEach(function (r) { if (r && r.id) map[String(r.id)] = r; });
  const collector = map.collector_host;
  const probe = map.cloud_health_probe;
  const hostUnknown = cloudDown && !rows.length;
  const hostOffline = !!cloud && !hostUnknown && (!collector || (now - num(collector.checked_at) > STALE));
  // 云端巡检心跳（cloud_health_probe.checked_at）：缺失 / 0 / 超 15 分钟 → 所有 cloud 行按过期降级
  const cloudStale = !(probe && num(probe.checked_at) && (now - num(probe.checked_at) <= STALE));
  const base = Object.assign({}, ctx, {
    now: now, lastDone: lastDone, cloud: cloud,
    hostOffline: hostOffline, hostUnknown: hostUnknown, cloudStale: cloudStale
  });
  const groups = [];
  const flat = [];
  GROUPS.forEach(function (g) {
    const items = g.ids.map(function (id) { const it = buildItem(id, map[id], base); flat.push(it); return it; });
    groups.push({ t: g.t, items: items });
  });
  let nd = 0, nw = 0, no = 0, nu = 0;
  flat.forEach(function (it) {
    if (it.st === 'down') nd++;
    else if (it.st === 'warn') nw++;
    else if (it.st === 'offline') no++;
    else if (it.st === 'unknown') nu++;
  });
  let summary;
  if (!lastDone) summary = { level: 'unknown', text: '检测中' };
  else if (nd) summary = { level: 'down', text: nd + ' 项异常' };
  else if (hostOffline) summary = { level: 'off', text: '采集主机离线' };
  else if (nw) summary = { level: 'warn', text: nw + ' 项注意' };
  else if (nu) summary = { level: 'unknown', text: nu + ' 项未知' };
  else summary = { level: 'ok', text: '全部正常' };
  let hint = null;
  if (lastDone) {
    if (cloud && !cloud.ok) hint = { cls: 'err', text: '云端连接失败' };
    else if (cloud && cloud.ok && !(cloud.list && cloud.list.length)) hint = { cls: '', text: '暂无上报数据' };
  }
  return { groups: groups, summary: summary, hint: hint, flat: flat, hostOffline: hostOffline, hostUnknown: hostUnknown };
}

/* ================================================================
   诊断 v2.1（2026-11-09）—— AI 结论下挂异常项 / 简化折叠+展开 / 设备信息最小化
   契约：C:\Users\Ko_Li\.openclaw\workspace\_diag_task\CONTRACT_V2_1.md §A/§B
   * 本段全部纯函数（不读 wx / 不发请求），页面只负责采集原始值与渲染；
   * §B 设备信息最小化：上报/展示只保留 mp 白名单
     platform / osVersion / baseLib / screen{w,h,dpr} / memoryMB / storagePct / network / clockSkewMs；
     上报行 detail 只允许 check / latency_ms / storage_pct / clock_skew_ms / err_count / code；
   * 展示前脱敏：不得出现姓名/学号/宿舍号/token/密码/cookie/完整 URL 查询串/绝对路径。
   ================================================================ */

// 显示脱敏（契约 §2：展示前客户端再做一层）：IP / Windows 绝对路径 / http(s) URL / token= 等键值
const REDACT_RULES = [
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '·'],
  [/[A-Za-z]:\\[^\s"'<>|]+/g, '·'],
  [/https?:\/\/\S+/g, '·'],
  [/\b(?:token|pwd|password|passwd|cookie|secret|api[_-]?key)=[^\s&"'<>]*/gi, '·']
];
function redact(s) {
  let out = String(s == null ? '' : s);
  REDACT_RULES.forEach(function (r) { out = out.replace(r[0], r[1]); });
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > 300 ? out.slice(0, 300) : out;
}

// §B：mp 设备白名单（唯一允许出现在上报 device / 展示 detail 的字段）
const DEVICE_WHITELIST = ['platform', 'osVersion', 'baseLib', 'screen', 'memoryMB', 'storagePct', 'network', 'clockSkewMs'];
// §B：client_diag.detail 白名单
const DETAIL_WHITELIST = ['check', 'latency_ms', 'storage_pct', 'clock_skew_ms', 'err_count', 'code'];

// 语义化状态文案（设备卡 / AI 分析 / 修复流程）
const DEV_LABEL = { ok: '通过', warn: '注意', down: '异常', info: '信息' };
// v2.1：状态胶囊（new待处理 / running修复中 / fixed已修复 / failed修复失败）
const AI_PILL = { new: '待处理', queued: '待处理', running: '修复中', fixed: '已修复', failed: '修复失败', manual: '需人工', ignored: '已忽略' };
const ANALYSIS_STATUS = AI_PILL;                 // 兼容旧调用名
const AI_STATUS_KEY = { new: 'new', queued: 'new', running: 'running', fixed: 'fixed', failed: 'failed', manual: 'manual', ignored: 'ignored' };
const SEVERITY = { error: '异常', warn: '注意', info: '提示' };
const SCOPE = { cloud: '云端', device: '本机', mixed: '混合' };
const REPAIR_STATUS = { pending: '等待执行', running: '正在执行', done: '已完成', failed: '失败', skipped: '已跳过', expired: '已过期' };
// 白名单动作（契约 §3）；未知动作只展示 id，绝不执行
const ACTIONS = {
  recheck_health: '重测依赖服务', restart_gateway: '重启网关', web_pause_on: '暂停网页',
  web_pause_off: '恢复网页', sync_power: '同步电量', sync_xgj: '同步作业',
  refresh_timetable: '刷新课表', redeploy_web: '重传网页'
};
function actionText(a) { return ACTIONS[String(a || '')] || redact(a || ''); }
function statusTextOf(map, v) { return map[String(v || '')] || redact(v || ''); }

const AI_TITLE_MAX = 22;                          // 折叠行标题截断（≤22 字）
const QUEUE_TEXT = {
  online: 'AI 分析排队中…',
  offline: '本机离线，已留存待开机修复'
};

function fmtDT(ms) {
  const n = num(ms);
  if (!n) return '';
  const d = new Date(n);
  return ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function flowSt(st) {
  st = String(st || '');
  if (st === 'done' || st === 'ok' || st === 'fixed') return 'done';
  // 契约 C：本机 agent 追加步骤用 st=run / done / fail；旧数据也有 running/claimed 写法
  if (st === 'run' || st === 'running' || st === 'claimed') return 'run';
  if (st === 'failed' || st === 'fail') return 'fail';
  if (st === 'skipped' || st === 'skip') return 'skip';
  return 'wait';
}
const FLOW_LABEL = { done: '完成', run: '进行中', fail: '失败', skip: '跳过', wait: '等待' };

// 版本比较：a<b → -1；相等 0；a>b → 1（只比较数字段，非法返回 null）
function vcmp(a, b) {
  const pa = String(a || '').split('.').map(function (x) { return parseInt(x, 10); });
  const pb = String(b || '').split('.').map(function (x) { return parseInt(x, 10); });
  if (!pa.length || !pb.length || !isFinite(pa[0]) || !isFinite(pb[0])) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// 网络类型 → 状态（info = 未知/不可判断，不计入注意/异常）
const NET_ST = { wifi: ['ok', 'Wi-Fi'], '5g': ['ok', '5G'], '4g': ['ok', '4G'], '3g': ['warn', '3G'], '2g': ['warn', '2G'], unknown: ['info', '未知'], none: ['down', '无网络'] };

// ------------------------------------------------------------------
// 设备快照归一（v2.1 §B 白名单）：兼容页面新形状 {device:{osVersion,baseLib,screen{},memoryMB,storagePct,network,clockSkewMs}}
// 与旧形状 {device:{system,sdk,pixelRatio,windowW,windowH}, memory, storage, network, clockSkewMs}。
// ------------------------------------------------------------------
function devNorm(input) {
  input = input || {};
  const d = input.device || {};
  const sc = d.screen || {};
  const legacy = !d.osVersion && !d.baseLib && !sc.w;
  const screenW = num(sc.w) || (legacy ? num(d.windowW) : 0);
  const screenH = num(sc.h) || (legacy ? num(d.windowH) : 0);
  const dpr = num(sc.dpr) || (legacy ? num(d.pixelRatio) : 0);
  const mem = input.memory || {};
  const memoryMB = num(d.memoryMB) > 0
    ? Math.round(num(d.memoryMB))
    : (num(mem.limitKB) > 0 ? Math.round(num(mem.limitKB) / 1024) : 0);
  const stg = input.storage || {};
  let storagePct = null;
  if (d.storagePct !== undefined && d.storagePct !== null) storagePct = num(d.storagePct);
  else if (stg.ok && num(stg.limitSize) > 0) storagePct = Math.round(num(stg.currentSize) / num(stg.limitSize) * 100);
  const storageOk = (d.storageOk === undefined) ? (stg.ok !== false) : !!d.storageOk;
  let clockSkewMs = null;
  if (d.clockSkewMs !== undefined && d.clockSkewMs !== null) clockSkewMs = num(d.clockSkewMs);
  else if (input.clockSkewMs !== undefined && input.clockSkewMs !== null) clockSkewMs = num(input.clockSkewMs);
  return {
    appVer: String(input.appVer || ''),
    platform: 'mp',
    osVersion: String(d.osVersion || (legacy ? d.system : '') || ''),
    baseLib: String(d.baseLib || (legacy ? d.sdk : '') || ''),
    screen: { w: screenW, h: screenH, dpr: dpr },
    memoryMB: memoryMB,
    storagePct: storagePct,
    storageOk: storageOk,
    network: String(d.network || input.network || 'unknown'),
    clockSkewMs: clockSkewMs,
    memoryWarn: num(input.memoryWarn),
    gateway: input.gateway || {},
    siteAssets: input.siteAssets || {},
    jsErrors: num(input.jsErrors)
  };
}

// 时钟偏差可读化：+1.2s / −3min / +1.5h（ms）
function fmtSkew(ms) {
  const n = Number(ms) || 0;
  const abs = Math.abs(n);
  const sign = n >= 0 ? '+' : '−';
  if (abs < 1000) return sign + Math.round(abs) + 'ms';
  if (abs < 60000) return sign + (abs / 1000).toFixed(1) + 's';
  if (abs < 3600000) return sign + Math.round(abs / 60000) + 'min';
  return sign + (abs / 3600000).toFixed(1) + 'h';
}

// 设备诊断：把页面采集到的原始快照 → 检查项列表 + 汇总 + 待上报异常（纯函数，可单测）
// v2.1 检查项（10 项，id 与 agent 的 diag_analysis.related.checks 对齐）：
//   app / sdk / screen / memory / storage / network / gateway / clock / timetable / js
// 展示 detail 只出现 §B 白名单量：版本号 / osVersion / 屏幕 / memoryMB / storagePct / 网络类型 / 延迟ms / 时钟偏差
function deviceChecks(input) {
  const v = devNorm(input);
  const checks = [], anoms = [];
  const add = function (id, name, st, detail, rep) {
    checks.push({ id: id, name: name, st: st, display: DEV_LABEL[st] || '信息', detail: redact(detail) });
    if (rep && (st === 'down' || st === 'warn')) anoms.push({ id: id, st: st });
  };
  add('app', '应用版本', 'info', v.appVer || '未知');
  // 基础库：< 2.20 明显偏旧；< 2.30 建议升级（canvas 2d / 组件能力依赖）
  if (!v.baseLib) add('sdk', '基础库版本', 'info', '未知', false);
  else {
    const lt20 = vcmp(v.baseLib, '2.20.0'), lt30 = vcmp(v.baseLib, '2.30.0');
    add('sdk', '基础库版本', (lt20 != null && lt20 < 0) ? 'down' : ((lt30 != null && lt30 < 0) ? 'warn' : 'ok'), v.baseLib, true);
  }
  // 系统 + 屏幕（去掉品牌/型号/语言）：如「Android 14 · 390×844 @3x」
  const scr = [];
  if (v.osVersion) scr.push(v.osVersion);
  if (v.screen.w) scr.push(v.screen.w + '×' + v.screen.h + (v.screen.dpr ? ' @' + v.screen.dpr + 'x' : ''));
  add('screen', '系统与屏幕', 'info', scr.join(' · ') || '未知');
  // 内存：memoryMB（0=未知）+ 运行期内存警告次数
  let memSt = 'info', memDetail = '未知';
  if (v.memoryMB > 0) { memSt = 'ok'; memDetail = v.memoryMB + 'MB'; }
  if (v.memoryWarn > 0) { memSt = 'warn'; memDetail = (v.memoryMB > 0 ? v.memoryMB + 'MB · ' : '') + '告警 ' + v.memoryWarn + ' 次'; }
  add('memory', '内存', memSt, memDetail, memSt === 'warn');
  // 本地存储：只展示百分比
  if (!v.storageOk) add('storage', '本地存储', 'down', '不可用', true);
  else {
    const pct = v.storagePct == null ? 0 : v.storagePct;
    add('storage', '本地存储', pct >= 95 ? 'down' : (pct >= 80 ? 'warn' : 'ok'), pct + '%', true);
  }
  // 网络
  const net = NET_ST[String(v.network || 'unknown')] || NET_ST.unknown;
  add('network', '网络', net[0], net[1], true);
  // 云端网关（诊断页一次轻量 GET 计时）
  const gw = v.gateway || {};
  if (!gw.ok) add('gateway', '云端网关', 'down', '连接失败', true);
  else {
    const lat = num(gw.latency);
    add('gateway', '云端网关', lat <= 800 ? 'ok' : (lat <= 2000 ? 'warn' : 'down'), lat + 'ms', true);
  }
  // 时钟偏差（HTTP Date 基准；null = 未知）
  if (v.clockSkewMs == null) add('clock', '时钟偏差', 'info', '未知', false);
  else {
    const as = Math.abs(v.clockSkewMs);
    add('clock', '时钟偏差', as > 10 * 60 * 1000 ? 'down' : (as > 60 * 1000 ? 'warn' : 'ok'), fmtSkew(v.clockSkewMs), true);
  }
  // 课表快照（site_assets）
  const sa = v.siteAssets || {};
  if (sa.ok) add('timetable', '课表快照', 'ok', '可用', false);
  else if (sa.checked) add('timetable', '课表快照', 'warn', '查询失败，沿用本机缓存', true);
  else add('timetable', '课表快照', 'info', '未检测', false);
  // JS 错误计数（app.js 全局 onError 累计，本次运行）
  add('js', '前端错误', v.jsErrors > 0 ? 'warn' : 'ok', '本次运行 ' + v.jsErrors + ' 个', v.jsErrors > 0);
  let nd = 0, nw = 0;
  checks.forEach(function (c) { if (c.st === 'down') nd++; else if (c.st === 'warn') nw++; });
  const summary = nd ? { level: 'down', text: nd + ' 项异常' }
    : (nw ? { level: 'warn', text: nw + ' 项注意' } : { level: 'ok', text: '全部正常' });
  return { checks: checks, summary: summary, anomalies: anoms };
}

// 稳定 fingerprint（FNV-1a 32bit）：只由「异常项 + 设备白名单量（os/基础库/屏幕）+ 脱敏消息」生成，
// 不含 sid/姓名/宿舍 → 同一问题在不同轮次得到同一 fingerprint，便于 10 分钟限频/去重。
function fingerprintOf(kind, checkId, message, dv) {
  dv = dv || {};
  let scrSeed = '';
  if (dv.screen) scrSeed = num(dv.screen.w) + 'x' + num(dv.screen.h) + '@' + num(dv.screen.dpr);
  const seed = [kind, checkId, message, dv.osVersion || dv.system || '', dv.baseLib || dv.sdk || '', scrSeed].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return 'mp_' + h.toString(16);
}
// 上报用设备信息（§B mp 白名单，8 键；绝不含姓名/学号/宿舍/token/品牌/型号/语言）
function deviceSafe(input) {
  const v = devNorm(input);
  return {
    platform: 'mp',
    osVersion: v.osVersion || '',
    baseLib: v.baseLib || '',
    screen: { w: v.screen.w, h: v.screen.h, dpr: v.screen.dpr },
    memoryMB: v.memoryMB || 0,
    storagePct: v.storagePct == null ? 0 : Math.round(v.storagePct),
    network: v.network || 'unknown',
    clockSkewMs: v.clockSkewMs == null ? 0 : Math.round(v.clockSkewMs)
  };
}
// 上报行 detail（§B 白名单）：check 必带（= deviceChecks 的检查 id，agent 据此生成 related.checks）
function reportDetailOf(id, st, input) {
  const v = devNorm(input);
  const d = { check: String(id) };
  if (id === 'gateway') {
    if (v.gateway && v.gateway.ok) d.latency_ms = num(v.gateway.latency);
    if (v.clockSkewMs != null) d.clock_skew_ms = Math.round(v.clockSkewMs);
  } else if (id === 'clock') {
    if (v.clockSkewMs != null) d.clock_skew_ms = Math.round(v.clockSkewMs);
  } else if (id === 'storage') {
    if (v.storagePct != null) d.storage_pct = Math.round(v.storagePct);
    d.code = 'storage_' + st;
  } else if (id === 'js') {
    d.err_count = v.jsErrors;
    d.code = 'js_' + st;
  } else if (id === 'memory') {
    d.err_count = v.memoryWarn;
    d.code = 'memory_' + st;
  } else if (id === 'network') {
    d.code = 'network_' + String(v.network || 'unknown');
  } else {
    d.code = String(id) + '_' + st;
  }
  return d;
}
// 异常 → client_diag 上报行（§B；页面拿到后调 cloud.diagReport），rows ≤ 3
function buildReportRows(anoms, input, opts) {
  opts = opts || {};
  const now = num(opts.now) || Date.now();
  const appVer = String(opts.appVer || '');
  const dev = deviceSafe(input);
  const rows = [];
  (anoms || []).slice(0, 3).forEach(function (a, i) {
    const kind = (a.id === 'network' || a.id === 'gateway' || a.id === 'timetable') ? 'network'
      : (a.id === 'storage' ? 'storage' : 'error');
    const level = a.st === 'down' ? 'error' : 'warn';
    const msg = checkMessageOf(a.id, a.st, input);
    rows.push({
      id: 'mp_' + now.toString(36) + '_' + i + Math.random().toString(36).slice(2, 6),
      platform: 'mp',
      app_ver: appVer,
      kind: kind,
      level: level,
      message: redact(msg).slice(0, 300),
      detail: reportDetailOf(a.id, a.st, input),
      device: dev,
      fingerprint: fingerprintOf(kind, a.id, msg, dev),
      ts: now
    });
  });
  return rows;
}
function checkMessageOf(id, st, input) {
  const map = {
    app: '应用版本信息异常', sdk: '基础库版本过旧', screen: '系统/屏幕信息异常',
    memory: '内存压力/警告', storage: '本地存储异常', network: '网络异常',
    gateway: '云端网关连接失败', clock: '设备时钟偏差过大', timetable: '课表快照不可用', js: '前端脚本错误'
  };
  let s = map[id] || ('诊断异常: ' + id);
  if (id === 'js') {
    const det = (input && input.jsDetail) || '';
    if (det) s += ' · ' + det;
  }
  if (id === 'gateway' && input && input.gateway && input.gateway.ok) s += ' · ' + num(input.gateway.latency) + 'ms';
  if (id === 'network') s += ' · ' + String(devNorm(input).network || 'unknown');
  return s + (st === 'down' ? '' : '（注意）');
}

// AI 分析视图（diag_analysis）：按 ts 倒序；展示字段过显示脱敏；v2.1 补折叠/展开与 related
function normRelated(r) {
  r = r || {};
  const arr = function (v) {
    if (Array.isArray(v)) return v.map(function (x) { return String(x == null ? '' : x).trim(); }).filter(Boolean).slice(0, 20);
    const s = String(v == null ? '' : v).trim();
    return s ? s.split(/[\s,;，；]+/).filter(Boolean).slice(0, 20) : [];
  };
  return {
    healthIds: arr(r.health_ids || r.healthIds),
    checks: arr(r.checks),
    repairId: String(r.repair_id || r.repairId || '')
  };
}
function shortTitle(t) {
  const s = redact(t || '');
  const chars = Array.from(s);
  return chars.length > AI_TITLE_MAX ? (chars.slice(0, AI_TITLE_MAX).join('') + '…') : s;
}
function analysisView(list, now) {
  const nowN = num(now) || Date.now();
  return (Array.isArray(list) ? list : []).filter(function (a) { return a && a.id; })
    .sort(function (x, y) { return num(y.ts) - num(x.ts); })
    .map(function (a) {
      const flow = (Array.isArray(a.flow) ? a.flow : []).slice(0, 8).map(function (f, i) {
        const st = flowSt(f && f.st);
        const t = num(f && f.t);
        return { i: i, st: st, stText: FLOW_LABEL[st], text: redact((f && f.text) || ''), timeText: t ? fmtDT(t) : '' };
      });
      const scope = String(a.scope || 'cloud');
      const status = String(a.status || '');
      const statusPill = AI_PILL[status] || statusTextOf(ANALYSIS_STATUS, status);
      const fixable = !!a.fixable;
      const isDevice = (scope === 'device');
      return {
        id: String(a.id),
        tsText: fmtDT(a.ts),
        agoText: ago(nowN - num(a.ts)),
        severity: String(a.severity || 'warn'),
        severityText: statusTextOf(SEVERITY, a.severity),
        scope: scope,
        scopeText: statusTextOf(SCOPE, scope),
        isDevice: isDevice,
        title: redact(a.title || ''),
        titleShort: shortTitle(a.title || '分析'),
        cause: redact(a.cause || ''),
        suggestions: (Array.isArray(a.suggestion) ? a.suggestion : []).slice(0, 4).map(redact),
        fixable: fixable,
        fixableMark: (fixable && !isDevice) ? '⚙' : '',
        deviceHint: isDevice ? '建议' : '',
        action: String(a.action || ''),
        actionText: actionText(a.action),
        status: status,
        statusKey: AI_STATUS_KEY[status] || 'manual',
        statusText: statusTextOf(ANALYSIS_STATUS, status),
        statusPill: statusPill,
        confidence: Math.round(num(a.confidence) * 100) / 100,
        related: normRelated(a.related),
        repair: null,           // groupAnalyses 按 related.repair_id / repair_tasks.analysis_id 关联
        open: false,            // 页面折叠态（groupAnalyses 由 openMap 注入）
        flow: flow,
        // WXML 限制：嵌套数组的 .length / wx:for 在部分基础库不可靠，预渲染为字符串（2026-11-09 实测）
        suggestionsText: ((Array.isArray(a.suggestion) ? a.suggestion : []).slice(0, 4).map(redact)).map(function (x) { return '· ' + x; }).join('\n'),
        flowText: flow.slice(0, 8).map(function (f) {
          return (f.timeText ? f.timeText + ' ' : '') + f.text + (f.stText ? ' · ' + f.stText : '');
        }).join('\n'),
        flowRun: flow.some(function (f) { return f.st === 'run'; })
      };
    });
}

// 修复任务视图（repair_tasks）：按 created_at 倒序；v2.1 供 AI 展开态「关联修复」使用
function repairView(list) {
  return (Array.isArray(list) ? list : []).filter(function (r) { return r && r.id; })
    .sort(function (x, y) { return num(y.created_at) - num(x.created_at); })
    .map(function (r) {
      return {
        id: String(r.id),
        timeText: fmtDT(r.created_at),
        createdText: fmtDT(r.created_at),
        finishedText: fmtDT(r.finished_at),
        action: String(r.action || ''),
        actionText: actionText(r.action),
        status: String(r.status || ''),
        statusText: statusTextOf(REPAIR_STATUS, r.status),
        statusKey: /^(done)$/.test(String(r.status)) ? 'fixed' : (/^(failed|skipped|expired)$/.test(String(r.status)) ? 'failed' : 'running'),
        reason: redact(r.reason || ''),
        result: redact(r.result || ''),
        analysisId: String(r.analysis_id || '')
      };
    });
}

// 本机 agent 在线状态（rpc/diag_agent_info 归一：PostgREST 对 jsonb 函数可能返回对象或单元素数组）
function agentView(info, now) {
  let r = info;
  if (Array.isArray(r)) r = r[0] || null;
  r = r || {};
  const seen = num(r.seen_at);
  const nowN = num(now) || Date.now();
  const online = !!r.online;
  return {
    online: online,
    text: online ? '在线' : '离线',
    seenText: seen ? ('心跳 ' + ago(nowN - seen) + '（' + fmtDT(seen) + '）') : '暂无心跳',
    host: redact(r.host || ''),
    version: String(r.version || '')
  };
}

// ----------------------------------------------------------------
// v2.1 核心：AI 结论下挂对应异常项（纯函数）
//   * diag_analysis.related.health_ids 含服务健康行 id → 挂到该行；
//   * diag_analysis.related.checks 含设备检查 id → 挂到该设备检查行；
//   * 无关联（或关联目标不存在）→ others（页面「其它诊断」折叠区，默认收起）；
//   * 异常行（down/warn）没有 AI → queueHint（本机在线：AI 分析排队中…；离线：已留存待开机修复）；
//   * 展开态「关联修复」：related.repair_id 优先，其次 repair_tasks.analysis_id；
//   * stats = 顶部「可自动修复 N · 已修复 M」。
// opts = { agentOnline, openMap:{<analysis id>:bool}, now }
// ----------------------------------------------------------------
function groupAnalyses(rawAnalyses, groups, devChecks, rawRepairs, opts) {
  opts = opts || {};
  const now = num(opts.now) || Date.now();
  const openMap = opts.openMap || {};
  const agentOnline = !!opts.agentOnline;
  // agent 状态未知（首次加载还没拿到 diag_agent_info）时不显示排队/离线文案，避免误导
  const agentKnown = opts.agentKnown !== false;
  const queueText = agentKnown ? (agentOnline ? QUEUE_TEXT.online : QUEUE_TEXT.offline) : '';
  const analyses = analysisView(rawAnalyses, now);
  const repairs = repairView(rawRepairs);
  const repairById = {}, repairByAnalysis = {};
  repairs.forEach(function (r) {
    repairById[r.id] = r;
    if (r.analysisId && !repairByAnalysis[r.analysisId]) repairByAnalysis[r.analysisId] = r;
  });
  const usedRepair = {};
  const byHealth = {}, byCheck = {};
  analyses.forEach(function (a) {
    a.open = !!openMap[a.id];
    a.repair = (a.related.repairId && repairById[a.related.repairId]) || repairByAnalysis[a.id] || null;
    if (a.repair && a.repair.id) usedRepair[a.repair.id] = true;
    a.related.healthIds.forEach(function (hid) { (byHealth[hid] = byHealth[hid] || []).push(a); });
    a.related.checks.forEach(function (cid) { (byCheck[cid] = byCheck[cid] || []).push(a); });
  });
  const attached = {};
  // 服务健康：只有异常行（异常/注意/离线）才显示 AI 行；正常行不显示（契约 §A.4），
  // 关联到已恢复正常行的历史结论归入「其它诊断」，不静默丢弃。
  const abnormal = function (st) { return st === 'down' || st === 'warn' || st === 'offline'; };
  const linkedGroups = (Array.isArray(groups) ? groups : []).map(function (g) {
    return {
      t: g.t,
      items: (g.items || []).map(function (it) {
        const row = Object.assign({}, it, { ai: [], queueHint: '' });
        const list = byHealth[it.id] || [];
        if (list.length && abnormal(it.st)) {
          row.ai = list;
          list.forEach(function (a) { attached[a.id] = true; });
        } else if (abnormal(it.st)) {
          row.queueHint = queueText;
        }
        return row;
      })
    };
  });
  const linkedChecks = (Array.isArray(devChecks) ? devChecks : []).map(function (ck) {
    const row = Object.assign({}, ck, { ai: [], queueHint: '' });
    const list = byCheck[ck.id] || [];
    if (list.length) { row.ai = list; list.forEach(function (a) { attached[a.id] = true; }); }
    else if (ck.st === 'down' || ck.st === 'warn') row.queueHint = queueText;
    return row;
  });
  const othersItems = analyses.filter(function (a) { return !attached[a.id]; });
  const analysisIds = {};
  analyses.forEach(function (a) { analysisIds[a.id] = true; });
  // 没有 analysis 关联的修复记录（历史/手工）也放「其它诊断」
  const othersRepairs = repairs.filter(function (r) {
    if (usedRepair[r.id]) return false;
    if (r.analysisId && analysisIds[r.analysisId]) return false;
    return true;
  });
  const autoFixN = analyses.filter(function (a) {
    return a.fixable && !a.isDevice && ['new', 'queued', 'running'].indexOf(a.status) >= 0;
  }).length;
  const fixedN = analyses.filter(function (a) { return a.status === 'fixed'; }).length;
  const parts = [];
  if (autoFixN) parts.push('可自动修复 ' + autoFixN);
  if (fixedN) parts.push('已修复 ' + fixedN);
  const stats = {
    autoFixN: autoFixN, fixedN: fixedN,
    text: parts.join(' · '), show: parts.length > 0
  };
  return {
    groups: linkedGroups,
    devChecks: linkedChecks,
    others: { items: othersItems, repairs: othersRepairs, count: othersItems.length + othersRepairs.length },
    stats: stats,
    analyses: analyses,
    repairs: repairs
  };
}

module.exports = {
  STALE: STALE, SLOW: SLOW, GROUPS: GROUPS, NAMES: NAMES, KINDS: KINDS, LABEL: LABEL,
  num: num, fmtHM: fmtHM, fmtHMS: fmtHMS, ago: ago, norm: norm, snapText: snapText,
  buildItem: buildItem, build: build,
  // 诊断 v2.1 纯函数（2026-11-09）
  REDACT_RULES: REDACT_RULES, redact: redact,
  DEVICE_WHITELIST: DEVICE_WHITELIST, DETAIL_WHITELIST: DETAIL_WHITELIST, AI_TITLE_MAX: AI_TITLE_MAX,
  QUEUE_TEXT: QUEUE_TEXT, AI_PILL: AI_PILL,
  DEV_LABEL: DEV_LABEL, ANALYSIS_STATUS: ANALYSIS_STATUS, AI_STATUS_KEY: AI_STATUS_KEY,
  SEVERITY: SEVERITY, SCOPE: SCOPE, REPAIR_STATUS: REPAIR_STATUS, ACTIONS: ACTIONS, actionText: actionText,
  fmtDT: fmtDT, vcmp: vcmp, flowSt: flowSt, fmtSkew: fmtSkew,
  devNorm: devNorm, deviceChecks: deviceChecks, fingerprintOf: fingerprintOf, deviceSafe: deviceSafe,
  reportDetailOf: reportDetailOf, buildReportRows: buildReportRows, checkMessageOf: checkMessageOf,
  shortTitle: shortTitle, normRelated: normRelated,
  analysisView: analysisView, repairView: repairView, agentView: agentView, groupAnalyses: groupAnalyses
};

