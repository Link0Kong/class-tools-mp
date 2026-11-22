// utils/notify.js —— 微信订阅消息（一次性模板）
// 模板（2026-11-19 起）：日程提醒 —— 日程 thing1 / 时间 time2 / 地点 thing3 / 日程描述 thing5
// 旧模板（温馨提示 thing2 / 时间 time1 / 摘要 thing3 / 日期 time26）由云函数为旧客户端兼容保留。
// 授权只在小程序端完成；真正发送由 cloudfunctions/notify 云函数执行。
// v20 / 1.4.7：新增「通知提醒」per-notice（kind='ntremind'）：subscribe/list/cancel。
//   契约见 _notify_task/CONTRACT.md §1/§2/§3：
//   * 本文件只做「参数拼装 + 授权 + 调云函数」，不读写 store；
//   * ask() 必须在用户点击的同步调用链里先执行（微信要求 requestSubscribeMessage 由 tap 触发）；
//   * 云函数返回 {ok:true} / {ok:false,reason}，reason 原样抛给页面做短文案映射。
//
// 2026-11-18：移除「新通知提醒」（订阅下一条通知 + 应用内新通知角标 + 云端 token 上报/状态）。
//   保留作业/通知单条提醒（kind='hw' / 'ntremind'），云函数 notify 继续为旧版客户端兼容。
//   * ask() 必须在用户点击的同步调用链里先执行（微信要求 requestSubscribeMessage 由 tap 触发）；
//   * 云函数返回 {ok:true} / {ok:false,reason}，reason 原样抛给页面做短文案映射。
//   * diag()：提醒通道诊断（定时器心跳 / active 数 / lastError），诊断页展示。
//   * classify(err)：把失败归因为可读原因（denied / unsupported / disabled-setting / cloud-missing / network），
//     页面据此 toast「已拒绝 / 未开启微信订阅消息 / 云函数未部署 / 网络不可用」。
const TEMPLATE_ID = 'ZqIur9lMTUTrbKeTXzirEEtHosvLFm-7sULeBjmyMjk';
// 云函数名（微信云开发「云函数」里必须是 notify；未部署时调用失败会归因 cloud-missing）
const CLOUD_FN = 'notify';
// 云开发环境：只在真正要发订阅消息/提醒时初始化（2026-11-17 从 app.onLaunch 移出，避免启动首帧加载 SDK）。
const CLOUD_ENV = 'fengdan-d6g7hnk4gf35685b3';
let _cloudReady = false;
function ensureInit() {
  // 每次调用都确认 callFunction 仍在（测试/极少数运行时会删除 wx.cloud；不能只信缓存布尔）
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') return false;
  if (_cloudReady) return true;
  if (typeof wx.cloud.init === 'function') {
    try { wx.cloud.init({ env: CLOUD_ENV, traceUser: true }); } catch (e) { return false; }
  }
  _cloudReady = true;
  return true;
}

function templateIds() {
  return [TEMPLATE_ID];
}
function fmt(d) {
  d = new Date(d || Date.now());
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
    ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}
// 新模板 thing 字段（日程/地点/日程描述）≤20 字
function short(s, n) {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
// 通知「地点」段落 → 新模板 thing3；没有则空（云函数回落「班级工具」）
function placeOf(group) {
  const g = group && typeof group === 'object' ? group : {};
  const direct = short(g.place || '', 20);
  if (direct) return direct;
  const segs = Array.isArray(g.aiSegments) ? g.aiSegments : [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i] || {};
    if (s.text && String(s.type || '').indexOf('地点') >= 0) return short(s.text, 20);
  }
  return '';
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
  if (!ensureInit()) return Promise.reject(new Error('no-cloud'));
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
function ask() {
  return new Promise(function (resolve, reject) {
    if (!wx.requestSubscribeMessage) { reject(new Error('unsupported')); return; }
    const ids = templateIds();
    wx.requestSubscribeMessage({
      tmplIds: ids,
      success: function (r) {
        const okIds = ids.filter(function (id) { return r && r[id] === 'accept'; });
        if (!okIds.length) { reject(new Error('denied')); return; }
        resolve({ tmplId: ids[0], accepted: okIds });
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
      dateText: h && h.date ? fmt(new Date(String(h.date).replace(/-/g, '/') + ' ' + (h.time || '00:00') + ':00')) : fmt(fireAt),
      tmplId: TEMPLATE_ID
    });
  });
}

// 通知组时间 → ms（group.deadline 可能是 ISO 字符串 / 日期字符串 / 数字；extensions 由 notice.js 处理）
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
  // 2026-11-18：优先用 group.baseTs（活动报名开始时间），否则回退截止；
  // 模板里的「日期」应显示提醒所依据的那个时间，而不是永远显示截止。
  var base = Number(group && group.baseTs) || deadlineTsOf(group);
  return ask().then(function () {
    var payload = {
      action: 'subscribe', kind: 'ntremind',
      ref: gid,
      fireAt: Number(fireAt) || 0,
      label: label || '',
      tip: '通知提醒',
      timeText: fmt(fireAt),
      summary: title,
      dateText: base ? fmt(base) : fmt(fireAt),
      tmplId: TEMPLATE_ID
    };
    var place = placeOf(group);
    if (place) payload.place = place;
    return call(payload);
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
// 个人任务提醒：复用 hw 订阅行（ref = task_<任务 id>），云函数按日期模板发送；
// 点击卡片由 cloudfunctions/notify 的 pageFor 转到 pages/task/task?task=<id>。
function subscribeTask(t, fireAt, label) {
  const id = String((t && t.id) || '');
  if (!id) return Promise.reject(new Error('missing-ref'));
  const title = String((t && t.title) || '个人任务');
  return ask().then(function () {
    return call({
      action: 'subscribe', kind: 'hw',
      ref: 'task_' + id,
      fireAt: Number(fireAt) || 0,
      label: label || '任务提醒',
      tip: '任务提醒',
      timeText: fmt(fireAt),
      summary: title,
      dateText: t && t.due ? fmt(new Date(String(t.due).replace(/-/g, '/') + ' ' + (t.dueTime || '09:00') + ':00')) : fmt(fireAt),
      tmplId: TEMPLATE_ID
    });
  });
}
function cancelTask(id) {
  return cancelReminder('task_' + String(id || ''), 'hw');
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

// 提醒通道诊断（诊断页用）：定时器心跳时间、active 提醒数、lastError。
function diag() {
  return call({ action: 'diag' }).then(function (v) { return (v && v.diag) || null; });
}

module.exports = {
  TEMPLATE_ID: TEMPLATE_ID,
  CLOUD_FN: CLOUD_FN,
  ensureInit: ensureInit,
  templateIds: templateIds,
  classify: classify,
  fmt: fmt,
  placeOf: placeOf,
  deadlineTsOf: deadlineTsOf,
  subscribeHomework: subscribeHomework,
  subscribeTask: subscribeTask,
  cancelTask: cancelTask,
  subscribeNoticeReminder: subscribeNoticeReminder,
  listReminders: listReminders,
  cancelReminder: cancelReminder,
  flushReminders: flushReminders,
  diag: diag
};
