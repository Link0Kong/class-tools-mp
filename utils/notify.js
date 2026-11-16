// utils/notify.js —— 微信订阅消息（一次性模板）
// 模板：温馨提示 thing2 / 时间 time1 / 摘要 thing3 / 日期 time26
// 授权只在小程序端完成；真正发送由 cloudfunctions/notify 云函数执行。
// v20 / 1.4.7：新增「通知提醒」per-notice（kind='ntremind'）：subscribe/list/cancel。
//   契约见 _notify_task/CONTRACT.md §1/§2/§3：
//   * 本文件只做「参数拼装 + 授权 + 调云函数」，不读写 store；
//   * ask() 必须在用户点击的同步调用链里先执行（微信要求 requestSubscribeMessage 由 tap 触发）；
//   * 云函数返回 {ok:true} / {ok:false,reason}，reason 原样抛给页面做短文案映射。
//
// 2026-11-11 需求 11（「开启新通知提醒后收不到」根治）：
//   * 第二模板 ID（可选，配置数组）：TEMPLATE_IDS = [默认模板, SECOND_TEMPLATE_ID]；
//     未配置第二个时只用默认（完全向后兼容）。授权时一次 requestSubscribeMessage 请求数组内全部模板；
//     「新通知提醒」优先用已授权的第二模板发送（云函数按 row.tmplId 选择），否则回落默认模板。
//   * bootstrap(token)：把当前班级 token 上报云函数存进 __notify_cfg 文档，供定时器通过 PostgREST
//     轮询 notices 新通知（token 过期由任一小程序客户端再次 bootstrap 刷新）。
//   * status()：云端 kind='nt' active 订阅数 + 本人是否已开启（按钮反馈展示）。
//   * diag()：提醒通道诊断（定时器心跳 / active 数 / 新通知扫描 lastScanAt / lastError），诊断页展示。
//   * classify(err)：把失败归因为可读原因（denied / unsupported / disabled-setting / cloud-missing / network），
//     页面据此 toast「已拒绝 / 未开启微信订阅消息 / 云函数未部署 / 网络不可用」。
const TEMPLATE_ID = 'eYDRJDSTJdRL-gvE0rM8EbuSZX6mA9L2U-UTA8MwSmo';
// 第二模板 ID（可选）：在微信公众平台「订阅消息」里新增一个模板后，把模板 ID 填到这里（字符串）；
// 留空 = 只用默认模板（默认行为，与旧版完全一致）。详见 README「订阅消息」章节部署步骤。
const SECOND_TEMPLATE_ID = '';
// 云函数名（微信云开发「云函数」里必须是 notify；未部署时 status/bootstrap 失败会归因 cloud-missing）
const CLOUD_FN = 'notify';

function templateIds() {
  const out = [TEMPLATE_ID];
  const s = String(SECOND_TEMPLATE_ID || '').trim();
  if (s && out.indexOf(s) < 0) out.push(s);
  return out;
}
function fmt(d) {
  d = new Date(d || Date.now());
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
    ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}
// 失败归因（页面 toast 用；不打印 token / openid）
function classify(err) {
  const m = String((err && (err.message || err.errMsg)) || err || '');
  if (!m) return 'unknown';
  if (m === 'denied') return 'denied';
  if (m === 'unsupported') return 'unsupported';
  if (m === 'no-cloud' || /no-cloud|function not found|FunctionName|cloud function|not deployed|-501000|env.*not.*found|has no cloud/i.test(m)) return 'cloud-missing';
  if (/main switch|setting|TAP gesture|only be invoked|user.*close|隐私/i.test(m) && /switch|setting|禁止|关闭|隐私/i.test(m)) return 'disabled-setting';
  if (/cancel|deny|reject/i.test(m)) return 'denied';
  if (/not support|invalid/i.test(m)) return 'unsupported';
  if (/timeout|network|request:fail|http5|http4/i.test(m)) return 'network';
  return 'unknown';
}
function call(data) {
  if (!wx.cloud || !wx.cloud.callFunction) return Promise.reject(new Error('no-cloud'));
  return wx.cloud.callFunction({ name: CLOUD_FN, data: data }).then(function (r) {
    var v = r && r.result;
    if (v && v.ok === false) { var e = new Error(v.reason || 'notify-failed'); e.reason = v.reason; throw e; }
    return v;
  }).catch(function (e) {
    // 云端未部署 / 未联网 / 超时：统一成可读原因（页面 toast 用；classify 再归类）
    if (e instanceof Error && e.reason) throw e;
    var msg = String((e && (e.message || e.errMsg)) || e || '');
    throw new Error(msg || 'cloud-error');
  });
}
// 授权：必须在用户点击的同步调用链里先执行。
// 成功 resolve { tmplId }（用于「新通知提醒」发送的模板选择）：第二模板被接受则优先第二模板，否则默认模板。
function ask() {
  return new Promise(function (resolve, reject) {
    if (!wx.requestSubscribeMessage) { reject(new Error('unsupported')); return; }
    const ids = templateIds();
    wx.requestSubscribeMessage({
      tmplIds: ids,
      success: function (r) {
        const okIds = ids.filter(function (id) { return r && r[id] === 'accept'; });
        if (!okIds.length) { reject(new Error('denied')); return; }
        const prefer = (ids.length > 1 && okIds.indexOf(ids[1]) >= 0) ? ids[1] : ids[0];
        resolve({ tmplId: prefer, accepted: okIds });
      },
      fail: function (e) {
        var msg = String((e && (e.errMsg || e.message)) || '');
        // 微信系统设置里「订阅消息」总开关关闭 / 基础库不支持 / 用户拒绝 → 明确分类
        if (/main switch|setting|privacy/i.test(msg)) reject(new Error('system-switch'));
        else if (/cancel|deny|reject|TAP gesture|only be invoked/i.test(msg)) reject(new Error('denied'));
        else if (/not support|invalid|system/i.test(msg)) reject(new Error('unsupported'));
        else reject(new Error(msg || 'denied'));
      }
    });
  });
}

// 作业：用户选择提醒时间后授权；云函数定时发送。
function subscribeHomework(h, fireAt, label) {
  return ask().then(function () {
    return call({
      action: 'subscribe', kind: 'hw',
      ref: (h && (h.id || ('ts' + h.ts))) || ('hw' + Date.now()),
      fireAt: fireAt,
      label: label || '',
      tip: '作业截止提醒',
      timeText: fmt(fireAt),
      summary: ((h && h.subject) ? h.subject + '：' : '') + ((h && h.content) || '作业'),
      dateText: h && h.date ? fmt(new Date(String(h.date).replace(/-/g, '/') + ' ' + (h.time || '00:00') + ':00')) : fmt(fireAt)
    });
  });
}

// 通知：订阅“下一条通知”（云端定时器发现新通知时发送并消耗本次授权）。
function subscribeNotice() {
  return ask().then(function (a) {
    return call({
      action: 'subscribe', kind: 'nt', ref: 'next', fireAt: 0,
      tmplId: a && a.tmplId ? a.tmplId : '',
      tip: '新通知', timeText: fmt(Date.now()), summary: '下一条班级通知', dateText: fmt(Date.now())
    });
  });
}
function publishNotice(n) {
  return call({
    action: 'publishNotice',
    title: (n && n.title) || '新通知',
    timeText: fmt((n && n.ts) || Date.now()),
    summary: ((n && n.title) || '') + ((n && n.body) ? '：' + n.body : ''),
    dateText: fmt((n && n.ts) || Date.now())
  });
}

// 通知组截止时间 → ms（group.deadline 可能是 ISO 字符串 / 日期字符串 / 数字；extensions 由 notice.js 处理）
function deadlineTsOf(group) {
  if (!group) return null;
  var v = group.deadline;
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) && v > 0 ? v : null;
  var s = String(v);
  // 纯日期串（YYYY-MM-DD）按本机时区当天 00:00（与 util.toDate 的 iOS 兼容写法一致）
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    var d = new Date(s.replace(/-/g, '/') + ' 00:00:00');
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  var t = Date.parse(s);
  if (!isNaN(t)) return t;
  t = new Date(s.replace(/-/g, '/')).getTime();
  return isNaN(t) ? null : t;
}

// 单条通知提醒：授权 → 云函数 subscribe（kind='ntremind'）。
// 注意：ask() 必须在本函数被点击 handler 直接调用的同步段里执行，中间不要 await 网络。
function subscribeNoticeReminder(group, fireAt, label) {
  var gid = String((group && (group.id || group.ref)) || '');
  if (!gid) return Promise.reject(new Error('missing-ref'));
  var title = String((group && group.title) || '班级通知');
  var dl = deadlineTsOf(group);
  return ask().then(function () {
    return call({
      action: 'subscribe', kind: 'ntremind',
      ref: gid,
      fireAt: Number(fireAt) || 0,
      label: label || '',
      tip: '通知提醒',
      timeText: fmt(fireAt),
      summary: title,
      dateText: dl ? fmt(dl) : fmt(fireAt)
    });
  });
}
// 云端 active 提醒列表（默认只查 ntremind）；返回数组，失败 reject（页面静默）。
function listReminders(kind) {
  return call({ action: 'list', kind: kind || 'ntremind' }).then(function (v) {
    if (Array.isArray(v)) return v;
    var arr = v && (v.list || v.items || v.reminders);
    return Array.isArray(arr) ? arr : [];
  });
}
// 取消提醒（kind 默认 ntremind）；ref = 通知组 id。
function cancelReminder(ref, kind) {
  return call({ action: 'cancel', kind: kind || 'ntremind', ref: String(ref || '') });
}
// 前端 catch-up（2026-11-10）：补发【本人】已到点的提醒（hw + ntremind）。
// 定时触发器之外的送达保障：定时触发器没跑/延迟时，用户打开小程序即可补收；云函数只处理调用者 openid。
// 失败静默（页面/启动流程不要弹错）。
function flushReminders() {
  return call({ action: 'flush' });
}

// ---------------------------------------------------------------- 2026-11-11 需求 11 新增
// 云端 kind='nt' 订阅状态（按钮反馈用）：{ ok, active: 云端全部 active 数, mine: 本人是否 active, ts }
//   * 60s 内存 TTL，避免每次进通知页都打云函数；
//   * 云函数未部署 → reject（classify → cloud-missing），页面显示「云函数未部署」。
let _statusCache = null;
function status(force) {
  const now = Date.now();
  if (!force && _statusCache && now - _statusCache.at < 60000) return Promise.resolve(_statusCache.v);
  return call({ action: 'ntStatus' }).then(function (v) {
    const out = {
      ok: true,
      active: Number(v && (v.active != null ? v.active : (v.diag && v.diag.ntActive))) || 0,
      mine: !!(v && v.mine),
      hb: (v && v.diag && v.diag.hb) || null,
      scan: (v && v.diag && v.diag.scan) || null,
      lastError: String((v && v.diag && v.diag.lastError) || '')
    };
    _statusCache = { at: now, v: out };
    return out;
  });
}
function clearStatusCache() { _statusCache = null; }
// 提醒通道诊断（诊断页/我的页用）：定时器心跳时间、active 数、新通知扫描 lastScanAt / lastError。
function diag() {
  return call({ action: 'diag' }).then(function (v) { return (v && v.diag) || null; });
}
// 客户端 bootstrap（需求 11 根因修复的关键一步）：把当前班级 token 上报云函数，存 __notify_cfg 文档，
//   供 notify 定时器用 PostgREST 轮询 notices 新通知。token 过期时任一小程序客户端再次 bootstrap 即刷新。
//   * 本机 30 分钟内只上报一次（token 30 天有效，无需频繁刷新）；
//   * token 只随 wx.cloud.callFunction 发给本环境云函数（云开发内网），不打印、不落本机明文以外的地方；
//   * 失败静默（未部署云函数/离线不影响使用），下次启动继续尝试。
const BOOT_KEY = 'zq_notify_boot_v1';
function bootstrap(token) {
  const tk = String(token == null ? '' : token).trim();
  if (!tk) return Promise.resolve(false);
  const now = Date.now();
  try {
    const prev = wx.getStorageSync(BOOT_KEY);
    if (prev && typeof prev === 'object' && Number(prev.at) && now - Number(prev.at) < 30 * 60 * 1000) return Promise.resolve(true);
  } catch (e) { /* 读缓存失败 → 照常上报 */ }
  return call({ action: 'bootstrap', token: tk }).then(function (v) {
    if (v && v.ok) {
      try { wx.setStorageSync(BOOT_KEY, { at: now }); } catch (e) { /* ignore */ }
      clearStatusCache();
      return true;
    }
    return false;
  }).catch(function () { return false; });
}

module.exports = {
  TEMPLATE_ID: TEMPLATE_ID,
  CLOUD_FN: CLOUD_FN,
  templateIds: templateIds,
  classify: classify,
  fmt: fmt,
  deadlineTsOf: deadlineTsOf,
  subscribeHomework: subscribeHomework,
  subscribeNotice: subscribeNotice,
  publishNotice: publishNotice,
  subscribeNoticeReminder: subscribeNoticeReminder,
  listReminders: listReminders,
  cancelReminder: cancelReminder,
  flushReminders: flushReminders,
  status: status,
  clearStatusCache: clearStatusCache,
  diag: diag,
  bootstrap: bootstrap
};
