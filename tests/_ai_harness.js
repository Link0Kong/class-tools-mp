/* _ai_harness.js —— 微信 AI 开发模式（独立分包 ai/）Node 测试基座
 *
 * 目标：让 `ai_unit_<skill>.js` 只写业务断言，不重复造 mock。纯 Node 内置模块，零第三方依赖。
 *
 * 快速上手：
 *   const H = require('./_ai_harness.js');
 *   const fx = H.mkFixture();                              // 常用夹具（成员/作业/通知/体测/课表/本机 store/flow）
 *   const wx = H.createWx({ storage: fx.storage });        // 内存 storage + wx.request 路由 + wx.modelContext
 *   const { apis, mcp } = H.loadSkill(wx, 'ai/skills/identity');   // 路径相对 mp-class-tools，或绝对路径
 *   const res = await H.call(wx, apis, 'getMyProfile', {});
 *   H.eq(res.isError, false, 'getMyProfile 成功');
 *   H.eq(res.structuredContent.name, '测试账号');
 *   H.report('identity');                                  // 打印汇总（不退出进程）
 *
 * 未认证场景：
 *   const wx = H.createWx({ storage: { zq_tools_v2: ... } });   // 不放 zq_class_identity
 *   const res = await H.call(wx, apis, 'listHomework', {});
 *   H.isErr(res, 'identity-required');                     // isError + error.code
 *
 * 路由（wx.request）：
 *   const wx = H.createWx({ routes: [
 *     { url: 'rpc/class_verify', method: 'POST', data: { ok: true, token: 'T', sid: '3260799999', name: '测试账号' } },
 *     { url: 'rpc/class_members', method: 'POST', data: [ {seat:1,sid:'...',name:'李学盈'} ] },
 *     { url: 'homework', method: 'GET', data: [] },
 *     { url: 'marks', method: 'POST', handler: (req) => ({ statusCode: 201, data: req.data }) },
 *     { url: /notices\?/, data: [] },
 *   ] });
 *   // 断言请求：wx.calls.requests -> [{url, method, data, header, statusCode, ok}]
 *   H.lastRequest(wx, 'marks').data[0].id === '3260799999|hw|h1'
 *
 * 约定：
 *   * storage 键与主包一致：zq_class_identity / zq_tools_v2 / zq_flow（值以 JSON 字符串存）
 *   * 原子接口禁止的 API（wx.showToast / wx.navigateTo / getApp / getCurrentPages / wx.getSystemInfoSync ...）
 *     会被记录到 wx.__illegal；H.call() 默认发现违规即抛错（可用 { checkApi: false } 关闭）
 *   * H.call() 会校验 CONTRACT §4 返回结构（isError/content/error.code/成功 pagePath/handoff 函数）
 *
 * 不要在这里写任何真实网络请求：wx.request 只走内存路由，未匹配即 fail。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const nodeUtil = require('util');

/* ================================================================ 断言工具 */

function fmtVal(v) {
  try {
    if (typeof v === 'string') return JSON.stringify(v.length > 200 ? v.slice(0, 200) + '…' : v);
    if (v === undefined) return 'undefined';
    if (typeof v === 'function') return '[function ' + (v.name || '') + ']';
    const s = JSON.stringify(v);
    return s && s.length > 400 ? s.slice(0, 400) + '…' : s;
  } catch (e) { return String(v); }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败（期望真值）');
  return cond;
}
function ok(v, msg) {
  if (!v) throw new Error(msg || ('断言失败（期望真值），实际=' + fmtVal(v)));
  return v;
}
function notOk(v, msg) {
  if (v) throw new Error(msg || ('断言失败（期望假值），实际=' + fmtVal(v)));
  return v;
}
function eq(actual, expected, msg) {
  if (!Object.is(actual, expected)) {
    throw new Error((msg ? msg + '：' : '') + '期望 ' + fmtVal(expected) + '，实际 ' + fmtVal(actual));
  }
  return actual;
}
function ne(actual, unexpected, msg) {
  if (Object.is(actual, unexpected)) {
    throw new Error((msg ? msg + '：' : '') + '期望不等于 ' + fmtVal(unexpected));
  }
  return actual;
}
function deepEq(actual, expected, msg) {
  if (!nodeUtil.isDeepStrictEqual(actual, expected)) {
    throw new Error((msg ? msg + '：' : '') + '对象不相等\n  期望: ' + fmtVal(expected) + '\n  实际: ' + fmtVal(actual));
  }
  return actual;
}
function isArray(v, msg) {
  if (!Array.isArray(v)) throw new Error((msg ? msg + '：' : '') + '期望数组，实际 ' + fmtVal(v));
  return v;
}
function isStr(v, msg) {
  if (typeof v !== 'string') throw new Error((msg ? msg + '：' : '') + '期望字符串，实际 ' + fmtVal(v));
  return v;
}
function isNum(v, msg) {
  if (typeof v !== 'number' || !isFinite(v)) throw new Error((msg ? msg + '：' : '') + '期望有限数字，实际 ' + fmtVal(v));
  return v;
}
function between(v, lo, hi, msg) {
  if (!(typeof v === 'number' && v >= lo && v <= hi)) {
    throw new Error((msg ? msg + '：' : '') + '期望在 [' + lo + ', ' + hi + '] 内，实际 ' + fmtVal(v));
  }
  return v;
}
function includes(haystack, needle, msg) {
  const hit = typeof haystack === 'string' ? haystack.indexOf(needle) >= 0
    : (Array.isArray(haystack) ? haystack.indexOf(needle) >= 0 : false);
  if (!hit) throw new Error((msg ? msg + '：' : '') + fmtVal(haystack) + ' 不包含 ' + fmtVal(needle));
  return haystack;
}
function notIncludes(haystack, needle, msg) {
  const hit = typeof haystack === 'string' ? haystack.indexOf(needle) >= 0
    : (Array.isArray(haystack) ? haystack.indexOf(needle) >= 0 : false);
  if (hit) throw new Error((msg ? msg + '：' : '') + fmtVal(haystack) + ' 不应包含 ' + fmtVal(needle));
  return haystack;
}
function match(str, re, msg) {
  const r = re instanceof RegExp ? re : new RegExp(re);
  if (!r.test(String(str))) throw new Error((msg ? msg + '：' : '') + fmtVal(str) + ' 不匹配 ' + r);
  return str;
}
async function throws(fn, msg) {
  try { await fn(); } catch (e) { return e; }
  throw new Error((msg ? msg + '：' : '') + '期望抛错，但没有抛错');
}
async function rejects(fn, msg) {
  try { await fn(); } catch (e) { return e; }
  throw new Error((msg ? msg + '：' : '') + '期望 Promise reject，但 resolve 了');
}
function hasKeys(obj, keys, msg) {
  (keys || []).forEach(function (k) { ok(obj && (k in obj), (msg ? msg + '：' : '') + '缺少字段 ' + k); });
  return obj;
}
// 契约 §4 失败返回断言：isError:true + structuredContent.error.code
function isErr(res, code, msg) {
  isArray(res && res.content, (msg || '') + ' content');
  eq(!!res.isError, true, (msg || '') + ' isError');
  const got = res.structuredContent && res.structuredContent.error && res.structuredContent.error.code;
  if (code) eq(got, code, (msg || '') + ' error.code');
  else ok(got, (msg || '') + ' 缺少 structuredContent.error.code');
  return res;
}
// 契约 §4 成功返回断言
function isOk(res, msg) {
  eq(!!res.isError, false, (msg || '') + ' isError');
  isArray(res.content, (msg || '') + ' content');
  ok(res.content.length > 0, (msg || '') + ' content 不能为空');
  return res;
}

/* ================================================================ 测试汇总 */

const _suite = { name: 'suite', pass: 0, fail: 0, skip: 0, results: [] };

async function test(name, fn) {
  const t0 = Date.now();
  let r;
  try {
    r = await fn();
    if (r === false) throw new Error('测试函数返回 false');
  } catch (e) {
    _suite.fail += 1;
    const msg = String((e && e.message) || e);
    _suite.results.push({ name: name, ok: false, ms: Date.now() - t0, err: msg });
    console.log('FAIL  ' + name + '  ::  ' + msg);
    return false;
  }
  _suite.pass += 1;
  _suite.results.push({ name: name, ok: true, ms: Date.now() - t0 });
  console.log('PASS  ' + name);
  return true;
}
function skip(name, why) {
  _suite.skip += 1;
  _suite.results.push({ name: name, ok: null, skip: true, err: why || '' });
  console.log('SKIP  ' + name + (why ? '  ::  ' + why : ''));
}
function resetReport() { _suite.pass = 0; _suite.fail = 0; _suite.skip = 0; _suite.results = []; }
function report(name, opts) {
  opts = opts || {};
  const total = _suite.pass + _suite.fail + _suite.skip;
  const head = '== ' + (name || _suite.name) + ' ==  ' + _suite.pass + ' PASS / ' + _suite.fail + ' FAIL'
    + (_suite.skip ? ' / ' + _suite.skip + ' SKIP' : '') + '  (' + total + ')';
  console.log('\n' + head + '  => ' + (_suite.fail ? 'FAIL' : 'PASS'));
  const out = {
    suite: name || _suite.name,
    pass: _suite.pass, fail: _suite.fail, skip: _suite.skip, total: total,
    ok: _suite.fail === 0,
    results: _suite.results.slice()
  };
  if (opts.file) {
    try {
      fs.writeFileSync(opts.file, JSON.stringify(out, null, 2));
      console.log('报告已写入 ' + opts.file);
    } catch (e) { console.log('（报告写入失败：' + e.message + '）'); }
  }
  lastReport = out;
  return out;
}
let lastReport = null;

/* ================================================================ mock wx */

const PROJECT = (function () {
  const cands = [
    path.resolve(__dirname, '..', 'mp-class-tools'),
    path.resolve(process.cwd(), 'mp-class-tools'),
    'C:/Users/Ko_Li/.openclaw/workspace/mp-class-tools'
  ];
  for (let i = 0; i < cands.length; i++) {
    try { if (fs.statSync(cands[i]).isDirectory()) return cands[i]; } catch (e) { /* next */ }
  }
  return path.resolve(__dirname, '..', 'mp-class-tools');
})();

// 原子接口环境（CONTRACT §0）不可用的 API：被调用时记录违规
const FORBIDDEN_APIS = [
  'showToast', 'showLoading', 'hideLoading', 'showModal', 'showActionSheet',
  'navigateTo', 'redirectTo', 'reLaunch', 'switchTab', 'navigateBack',
  'setNavigationBarTitle', 'setNavigationBarColor', 'startPullDownRefresh', 'stopPullDownRefresh',
  'getSystemInfoSync', 'getSystemInfo', 'getLaunchOptionsSync', 'getEnterOptionsSync',
  'getFileSystemManager', 'createSelectorQuery', 'createCanvasContext',
  'setClipboardData', 'getClipboardData', 'saveImageToPhotosAlbum', 'canvasToTempFilePath',
  'onAgentHandoff', 'onShareAppMessage'
];

function storageVal(v) {
  // 真实 wx.getStorageSync 对不存在的键返回 ''；这里保持原样存储（对象/字符串都可以，主包两种都兼容）
  return v;
}
function toStorageValue(v) {
  if (typeof v === 'string') return v;
  if (v === undefined || v === null) return '';
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

function createWx(opts) {
  opts = opts || {};
  const fx = opts.fixture || null;
  const storage = Object.create(null);
  const calls = {
    requests: [], toasts: [], showModals: [], navigations: [], logins: [],
    subscribes: [], privacy: [], cloud: [], storageOps: [], illegal: [], unmatched: []
  };
  const state = {
    routes: [],
    checkApi: opts.checkApi !== false,
    subscribeResult: opts.subscribeResult || { errMsg: 'requestSubscribeMessage:ok', TAP: 'accept' },
    loginCode: opts.loginCode || 'mock-login-code',
    privacyResult: opts.privacyResult || { errMsg: 'requestAgentPrivacyAuthorization:ok', buttonId: 'mock-button' }
  };

  function seed(key, value) {
    storage[key] = toStorageValue(value);
  }
  const seedMap = Object.assign({}, (fx && fx.storage) || {}, opts.storage || {});
  Object.keys(seedMap).forEach(function (k) { seed(k, seedMap[k]); });

  function illegal(api, args) {
    const rec = { api: api, args: args, at: Date.now() };
    calls.illegal.push(rec);
    return rec;
  }

  /* ---------------- wx.request 路由 ---------------- */
  function isRouteObject(o) {
    if (!o || typeof o !== 'object') return false;
    const keys = ['url', 'handler', '_fn', 'matchData', 'when', 'statusCode', 'response', 'fail', 'method', 'once', 'times', 'exact', 'delay'];
    return keys.some(function (k) { return k in o; });
  }
  function pushRoutes(list) {
    if (!list) return;
    if (typeof list === 'function') { state.routes.push({ _fn: list, _once: false }); return; }
    if (Array.isArray(list)) { list.forEach(pushRoutes); return; }
    if (typeof list === 'object') {
      if (isRouteObject(list)) { state.routes.push(normalizeRoute(list)); return; }
      // 对象映射形式：{ 'POST rpc/class_verify': {...}, 'GET homework': [] }
      Object.keys(list).forEach(function (key) {
        const parts = key.trim().split(/\s+/);
        const route = (parts.length > 1)
          ? Object.assign({ method: parts[0], url: parts.slice(1).join(' ') }, normalizeRoute(list[key]))
          : Object.assign({ url: key }, normalizeRoute(list[key]));
        state.routes.push(route);
      });
    }
  }
  function normalizeRoute(v) {
    if (typeof v === 'function') return { handler: v };
    if (v && typeof v === 'object' && (v.statusCode !== undefined || v.data !== undefined || v.handler || v.fail !== undefined || v.response !== undefined)) return Object.assign({}, v);
    return { data: v };
  }
  pushRoutes(opts.routes);
  if (typeof opts.routeFn === 'function') state.routes.push({ _fn: opts.routeFn });

  function urlMatches(route, url) {
    if (!route.url) return true;
    if (route.url instanceof RegExp) return route.url.test(url);
    const u = String(route.url);
    if (u === url) return true;
    if (u.indexOf('*') >= 0) {
      const re = new RegExp('^' + u.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      if (re.test(url)) return true;
      const re2 = new RegExp(u.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'));
      return re2.test(url);
    }
    if (route.exact) return false;
    return url.indexOf(u) >= 0;
  }
  function routeMatches(route, method, url, body) {
    if (route._fn) return false;
    if (route.method) {
      const ms = Array.isArray(route.method) ? route.method : [route.method];
      if (ms.map(function (m) { return String(m).toUpperCase(); }).indexOf(method) < 0) return false;
    }
    if (!urlMatches(route, url)) return false;
    if (route.matchData !== undefined && !nodeUtil.isDeepStrictEqual(route.matchData, body)) return false;
    if (typeof route.when === 'function' && !route.when({ url: url, method: method, data: body })) return false;
    return true;
  }
  function materialize(route, o) {
    if (typeof route._fn === 'function') {
      const r = route._fn(o);
      if (r === undefined || r === null) return null;
      return shape(r);
    }
    if (route.fail !== undefined && route.fail !== false) {
      return { fail: (typeof route.fail === 'string' ? route.fail : 'request:fail mock') };
    }
    if (typeof route.handler === 'function') return shape(route.handler(o));
    if (typeof route.data === 'function') return shape(route.data(o));
    return shape(route);
  }
  function shape(r) {
    if (r === undefined || r === null) return null;
    if (typeof r !== 'object') return { statusCode: 200, data: r };
    if (r.fail !== undefined || r.errMsg !== undefined) return { fail: r.fail || r.errMsg || 'request:fail mock' };
    if (r.statusCode !== undefined || r.data !== undefined || r.response !== undefined) {
      return { statusCode: r.statusCode || 200, data: (r.data !== undefined ? r.data : r.response), header: r.header || {} };
    }
    return { statusCode: 200, data: r };
  }
  function resolveRoute(o, rec) {
    const method = rec.method;
    const url = String(o.url || '');
    for (let i = 0; i < state.routes.length; i++) {
      const route = state.routes[i];
      if (!routeMatches(route, method, url, o.data)) continue;
      if (route.once || route.times !== undefined) {
        if (route.times !== undefined) {
          route.times -= 1;
          if (route.times <= 0) state.routes.splice(i, 1);
        } else {
          state.routes.splice(i, 1);
        }
      }
      return materialize(route, o);
    }
    if (typeof opts.onUnmatched === 'function') { const r = shape(opts.onUnmatched(o)); if (r) return r; }
    if (opts.defaultRoute !== undefined) return shape(opts.defaultRoute);
    calls.unmatched.push(rec);
    return { fail: 'request:fail 未匹配路由 ' + method + ' ' + url, unmatched: true };
  }

  const wx = {
    /* ---------------- storage ---------------- */
    getStorageSync(k) { return storage[k] === undefined ? '' : storage[k]; },
    setStorageSync(k, v) { storage[k] = toStorageValue(v); calls.storageOps.push({ op: 'set', key: k }); },
    removeStorageSync(k) { delete storage[k]; calls.storageOps.push({ op: 'remove', key: k }); },
    clearStorageSync() { Object.keys(storage).forEach(function (k) { delete storage[k]; }); calls.storageOps.push({ op: 'clear' }); },
    getStorageInfoSync() {
      const keys = Object.keys(storage);
      let bytes = 0;
      keys.forEach(function (k) { bytes += String(storage[k] == null ? '' : storage[k]).length + k.length; });
      return { keys: keys, currentSize: Math.ceil(bytes / 1024), limitSize: 10240 };
    },
    batchSetStorageSync(list) {
      (list || []).forEach(function (x) { if (!x || x.key === undefined) return; storage[x.key] = toStorageValue(x.value); });
      calls.storageOps.push({ op: 'batchSet', n: (list || []).length });
    },
    batchGetStorageSync(keys) {
      return (keys || []).map(function (k) { return storage[k] === undefined ? '' : storage[k]; });
    },
    getStorage(o) {
      o = o || {};
      setTimeout(function () { (o.success || function () {})({ data: storage[o.key] === undefined ? '' : storage[o.key] }); }, 0);
    },
    setStorage(o) {
      o = o || {};
      storage[o.key] = toStorageValue(o.data);
      setTimeout(function () { (o.success || function () {})(); }, 0);
    },
    removeStorage(o) {
      o = o || {};
      delete storage[o.key];
      setTimeout(function () { (o.success || function () {})(); }, 0);
    },
    batchSetStorage(o) {
      o = o || {};
      (o.data || []).forEach(function (x) { if (x && x.key !== undefined) storage[x.key] = toStorageValue(x.value); });
      setTimeout(function () { (o.success || function () {})(); }, 0);
    },
    batchGetStorage(o) {
      o = o || {};
      const arr = (o.keys || []).map(function (k) { return storage[k] === undefined ? '' : storage[k]; });
      setTimeout(function () { (o.success || function () {})({ data: arr }); }, 0);
    },

    /* ---------------- request ---------------- */
    request(o) {
      o = o || {};
      const rec = {
        url: String(o.url || ''),
        method: String(o.method || 'GET').toUpperCase(),
        data: o.data,
        header: o.header || {},
        timeout: o.timeout,
        at: Date.now(),
        seq: calls.requests.length
      };
      calls.requests.push(rec);
      let resp;
      try { resp = resolveRoute(o, rec); }
      catch (e) { resp = { fail: 'request:fail harness: ' + (e && e.message) }; }
      const deliver = function () {
        if (!resp) resp = { statusCode: 200, data: null };
        if (resp.fail) {
          rec.ok = false; rec.errMsg = resp.fail;
          if (typeof o.fail === 'function') o.fail({ errMsg: resp.fail });
          return;
        }
        const statusCode = resp.statusCode || 200;
        rec.statusCode = statusCode;
        rec.responseData = resp.data;
        rec.ok = statusCode >= 200 && statusCode < 300;
        if (typeof o.success === 'function') o.success({ statusCode: statusCode, data: resp.data, header: resp.header || {}, errMsg: 'request:ok' });
      };
      if (resp && typeof resp.then === 'function') resp.then(deliver, function (e) { resp = { fail: 'request:fail ' + (e && e.message) }; deliver(); });
      else setTimeout(deliver, 0);
      return { abort: function () {}, onHeadersReceived: function () {}, offHeadersReceived: function () {} };
    },

    /* ---------------- 设备/环境 ---------------- */
    env: { USER_DATA_PATH: 'wxfile://usr' },
    getAppBaseInfo() {
      return { SDKVersion: '3.9.0', version: '8.0.55', language: 'zh_CN', theme: opts.theme || 'light', fontSizeScale: 1 };
    },
    getDeviceInfo() {
      return { brand: 'devtools', model: 'iPhone 15', system: 'iOS 17.0', platform: 'ios', abi: 'arm64-v8a', benchmarkLevel: 1 };
    },
    getWindowInfo() {
      return {
        pixelRatio: 3, screenWidth: 390, screenHeight: 844, windowWidth: 390, windowHeight: 753,
        statusBarHeight: 47, safeArea: { top: 47, bottom: 810, left: 0, right: 390, width: 390, height: 763 }, screenTop: 44
      };
    },
    getSystemSetting() { return { bluetoothEnabled: false, locationEnabled: false, wifiEnabled: true, deviceOrientation: 'portrait' }; },
    getNetworkType(o) { if (o && o.success) setTimeout(function () { o.success({ networkType: opts.networkType || 'wifi', errMsg: 'getNetworkType:ok' }); }, 0); },
    onNetworkStatusChange() {}, offNetworkStatusChange() {},

    /* ---------------- 身份/隐私/订阅 ---------------- */
    login(o) {
      o = o || {};
      calls.logins.push({ at: Date.now() });
      if (o.success) setTimeout(function () { o.success({ code: state.loginCode, errMsg: 'login:ok' }); }, 0);
    },
    requestSubscribeMessage(o) {
      o = o || {};
      calls.subscribes.push({ tmplIds: o.tmplIds, at: Date.now() });
      if (o.success) setTimeout(function () { o.success(state.subscribeResult); }, 0);
      if (o.complete) setTimeout(function () { o.complete(); }, 0);
    },
    requestAgentPrivacyAuthorization(o) {
      o = o || {};
      calls.privacy.push({ at: Date.now() });
      if (o.success) setTimeout(function () { o.success(state.privacyResult); }, 0);
    },
    getPrivacySetting(o) {
      if (o && o.success) setTimeout(function () { o.success({ needAuthorization: !!(opts.needPrivacy), privacyContractName: '用户隐私保护指引' }); }, 0);
    },

    /* ---------------- 云开发（stub，只记录） ---------------- */
    cloud: {
      init(cfg) { calls.cloud.push({ op: 'init', cfg: cfg }); return {}; },
      callFunction(o) {
        calls.cloud.push({ op: 'callFunction', name: o && o.name, data: o && o.data });
        if (o && o.success) setTimeout(function () { o.success({ result: null }); }, 0);
        return Promise.resolve({ result: null });
      },
      uploadFile(o) {
        calls.cloud.push({ op: 'uploadFile', filePath: o && o.filePath });
        if (o && o.fail) setTimeout(function () { o.fail({ errMsg: 'harness: cloud.uploadFile 未实现' }); }, 0);
        return Promise.reject(new Error('harness: cloud.uploadFile 未实现'));
      },
      downloadFile(o) {
        calls.cloud.push({ op: 'downloadFile', fileID: o && o.fileID });
        return Promise.reject(new Error('harness: cloud.downloadFile 未实现'));
      },
      getTempFileURL(o) {
        calls.cloud.push({ op: 'getTempFileURL', fileList: o && o.fileList });
        return Promise.resolve({ fileList: [] });
      },
      database() { calls.cloud.push({ op: 'database' }); return { collection: function () { return {}; } }; }
    },

    /* ---------------- 主包 API（原子接口禁止：记录违规，返回安全占位） ---------------- */
    getFileSystemManager() {
      illegal('getFileSystemManager', arguments);
      return {
        readFile(o) { if (o && o.fail) o.fail({ errMsg: 'harness: fs 未实现' }); },
        writeFile(o) { if (o && o.fail) o.fail({ errMsg: 'harness: fs 未实现' }); },
        access(o) { if (o && o.fail) o.fail({ errMsg: 'harness: fs 未实现' }); },
        unlink(o) { if (o && o.fail) o.fail({ errMsg: 'harness: fs 未实现' }); },
        mkdir(o) { if (o && o.fail) o.fail({ errMsg: 'harness: fs 未实现' }); }
      };
    },
    createSelectorQuery() { illegal('createSelectorQuery', arguments); return { in: function () { return this; }, select: function () { return this; }, selectAll: function () { return this; }, fields: function () { return this; }, boundingClientRect: function () { return this; }, exec: function (cb) { if (cb) cb([]); } }; },
    getSystemInfoSync() { illegal('getSystemInfoSync', arguments); return wx.getWindowInfo(); },
    getSystemInfo(o) { illegal('getSystemInfo', arguments); if (o && o.success) o.success(wx.getWindowInfo()); },
    getLaunchOptionsSync() { illegal('getLaunchOptionsSync', arguments); return { path: 'pages/index/index', query: {}, scene: 1001 }; },
    getEnterOptionsSync() { illegal('getEnterOptionsSync', arguments); return { path: 'pages/index/index', query: {}, scene: 1001 }; }
  };
  FORBIDDEN_APIS.forEach(function (api) {
    if (wx[api]) return;
    wx[api] = function () {
      illegal(api, Array.prototype.slice.call(arguments));
      if (api === 'showModal' || api === 'showActionSheet' || api === 'showToast' || api === 'showLoading') return { errMsg: 'harness: ' + api + ' 未实现' };
      return undefined;
    };
  });
  // showToast 额外记录到 calls.toasts（便于断言「没有弹 toast」）
  const _toast = wx.showToast;
  wx.showToast = function (o) {
    calls.toasts.push({ title: o && o.title, icon: o && o.icon, at: Date.now() });
    return _toast.apply(this, arguments);
  };
  const _modal = wx.showModal;
  wx.showModal = function (o) {
    calls.showModals.push({ title: o && o.title, content: o && o.content });
    return _modal.apply(this, arguments);
  };
  const _nav = function (kind) { return function (o) { calls.navigations.push({ type: kind, url: o && o.url }); illegal(kind, arguments); }; };
  ['navigateTo', 'redirectTo', 'reLaunch', 'switchTab', 'navigateBack'].forEach(function (k) {
    if (!wx[k] || FORBIDDEN_APIS.indexOf(k) >= 0) wx[k] = _nav(k);
  });

  wx.__storage = storage;
  wx.__state = state;
  wx.__calls = calls;
  wx.calls = calls;                 // 语义化别名
  wx.__illegal = calls.illegal;
  wx.__requests = calls.requests;
  wx.__seed = function (map) { Object.keys(map || {}).forEach(function (k) { storage[k] = toStorageValue(map[k]); }); return wx; };
  wx.__dumpStorage = function () { const o = {}; Object.keys(storage).forEach(function (k) { o[k] = storage[k]; }); return o; };
  wx.__resetRequests = function () { calls.requests.length = 0; calls.unmatched.length = 0; return wx; };
  wx.__illegalSince = function (n) { return calls.illegal.slice(n || 0); };
  wx.addRoute = function (route) {
    if (route && (route.url || route.handler || route._fn)) state.routes.push(normalizeRoute(route));
    return wx;
  };
  if (opts.modelContext) wx.modelContext = opts.modelContext;
  return wx;
}

/* ================================================================ wx.modelContext mock */

function makeRecorder(kind) {
  const calls = [];
  const handlers = [];
  const target = {
    __kind: kind,
    __calls: calls,
    __handlers: handlers,
    on(type, fn) {
      calls.push({ method: 'on', args: [type, typeof fn] });
      if (typeof fn === 'function') handlers.push({ type: type, fn: fn, at: Date.now() });
      return function () {};
    },
    off(type, fn) { calls.push({ method: 'off', args: [type, typeof fn] }); return undefined; },
    sendFollowUpMessage(msg) { calls.push({ method: 'sendFollowUpMessage', args: [msg] }); return Promise.resolve(); },
    setRelatedPage(o) { calls.push({ method: 'setRelatedPage', args: [o] }); return undefined; },
    getRelatedPage() { return null; },
    setState(o) { calls.push({ method: 'setState', args: [o] }); return undefined; },
    __last(method) { for (let i = calls.length - 1; i >= 0; i--) if (!method || calls[i].method === method) return calls[i]; return null; },
    __find(method) { return calls.filter(function (c) { return c.method === method; }); }
  };
  // 未知方法：记录调用并返回 undefined，避免实现者用新平台 API 时崩溃
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop !== 'string') return undefined;
      return function () {
        const args = Array.prototype.slice.call(arguments);
        calls.push({ method: prop, args: args });
        return undefined;
      };
    }
  });
}

function toCallable(fn, name) {
  if (typeof fn === 'function') return fn;
  if (fn && typeof fn === 'object') {
    const cands = [fn.handler, fn.run, fn.execute, fn.fn, fn.call, fn.handle];
    for (let i = 0; i < cands.length; i++) if (typeof cands[i] === 'function') return cands[i];
  }
  return function () {
    return Promise.reject(new Error('registerAPI("' + name + '") 注册的不是函数（实际 ' + fmtVal(fn) + '）；用例应传 handler 函数'));
  };
}

function createModelContext() {
  const skills = [];
  const uses = [];
  const contexts = [];
  const views = [];
  const registrations = [];
  const apis = {};
  const modelContext = {
    NotificationType: Object.freeze({ Input: 'input', Result: 'result', Error: 'error', Refresh: 'refresh' }),
    createSkill() {
      const args = Array.prototype.slice.call(arguments);
      const first = args[0] || {};
      const pathArg = typeof first === 'string' ? first : (first && typeof first === 'object' ? String(first.path || first.root || '') : '');
      const skillObj = {
        path: pathArg,
        name: (first && typeof first === 'object' && first.name) ? String(first.name) : '',
        description: (first && typeof first === 'object' && first.description) ? String(first.description) : '',
        apis: {},
        _raw: {},
        registerAPI(name, fn) {
          if (name && typeof name === 'object') {
            const o = name;
            const cand = o.handler || o.run || o.execute || o.fn || o.handle;
            fn = cand || fn;
            name = o.name || o.api || o.id || o.path;
          }
          if (typeof name !== 'string' || !name) throw new Error('registerAPI 需要接口名（字符串）');
          const callable = toCallable(fn, name);
          this.apis[name] = callable;
          this._raw[name] = fn;
          apis[name] = callable;
          registrations.push({ name: name, fn: callable, raw: fn, skill: this, at: Date.now() });
          return this;
        },
        api(name, fn) { return this.registerAPI(name, fn); },
        use(fn) { uses.push({ skill: this, fn: fn }); return this; },
        getAPIs() { return Object.assign({}, this.apis); }
      };
      skills.push(skillObj);
      return skillObj;
    },
    getContext(inst) { const r = makeRecorder('context'); r.__instance = inst; contexts.push(r); return r; },
    getViewContext(inst) { const r = makeRecorder('view'); r.__instance = inst; views.push(r); return r; },
    // 平台其他可能的模型上下文方法：记录（不存在时返回 undefined 不崩）
    registerComponent() {},
    _state: { skills: skills, uses: uses, contexts: contexts, views: views, registrations: registrations, apis: apis }
  };
  return modelContext;
}

/* ================================================================ 加载技能 */

function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }
function isFile(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }

function resolveSkillDir(skillPath) {
  const cands = [];
  const raw = String(skillPath || '').replace(/[\\/]+$/, '');
  if (path.isAbsolute(raw)) cands.push(raw);
  else {
    cands.push(path.resolve(process.cwd(), raw));
    cands.push(path.resolve(__dirname, raw));
    cands.push(path.resolve(__dirname, '..', raw));
    cands.push(path.resolve(PROJECT, raw));
    cands.push(path.resolve(PROJECT, 'ai/skills', raw));
  }
  for (let i = 0; i < cands.length; i++) if (isDir(cands[i])) return cands[i];
  throw new Error('找不到技能目录: ' + skillPath + '\n  已尝试:\n    ' + cands.join('\n    '));
}

function clearRequireCache(root) {
  const norm = path.resolve(root).replace(/\\/g, '/').toLowerCase();
  Object.keys(require.cache).forEach(function (k) {
    const kk = k.replace(/\\/g, '/').toLowerCase();
    if (kk === norm || kk.indexOf(norm + '/') === 0) delete require.cache[k];
  });
}

function installIllegalGlobals(wx) {
  const record = function (api) { return function () { (wx.__illegal || []).push({ api: api, args: [], at: Date.now() }); }; };
  try { global.getApp = function () { record('getApp')(); return { globalData: {} }; }; } catch (e) {}
  try { global.getCurrentPages = function () { record('getCurrentPages')(); return []; }; } catch (e) {}
}

/**
 * 加载一个 SKILL（require 其 index.js，收集 registerAPI 注册表 + mcp.json）。
 * @param {object|string} wxOrPath  wx mock（createWx 返回）或技能路径字符串
 * @param {string|object} skillPathOrOpts 技能路径；第一参为路径时第二参是 opts
 * @param {object} opts { fresh=true 清 require 缓存, wxOpts={}, requireMcp=true }
 * @returns {{mcp, mcpError, path, indexPath, apis, apiNames, skill, skills, uses, modelContext, wx, module, warnings}}
 */
function loadSkill(wxOrPath, skillPathOrOpts, opts) {
  let wx, skillPath;
  if (typeof wxOrPath === 'string') {
    skillPath = wxOrPath;
    opts = skillPathOrOpts || {};
    wx = opts.wx || createWx(opts.wxOpts || {});
  } else {
    wx = wxOrPath || createWx({});
    skillPath = skillPathOrOpts;
    opts = opts || {};
  }
  if (!wx || typeof wx.getStorageSync !== 'function' || typeof wx.request !== 'function') {
    throw new Error('loadSkill(wx, path): 第一个参数不是 createWx() 返回的 mock wx');
  }
  // 允许 wx 以 fixture 创建（未显式注入 storage 时，fixture 自己带）
  if (opts.fixture && !wx.__seededFixture) wx.__seed(opts.fixture.storage || {});

  const skillDir = resolveSkillDir(skillPath);
  const indexPath = path.join(skillDir, 'index.js');
  const mcpPath = path.join(skillDir, 'mcp.json');
  if (!isFile(indexPath)) throw new Error('技能缺少 index.js: ' + indexPath);

  const warnings = [];
  const modelContext = createModelContext();
  wx.modelContext = modelContext;
  global.wx = wx;
  installIllegalGlobals(wx);

  const mcp = readMcp(mcpPath, warnings, opts);

  if (opts.fresh !== false) {
    clearRequireCache(path.resolve(__dirname, '..', 'mp-class-tools'));
    clearRequireCache(skillDir);   // 同一进程反复 loadSkill 时技能 index.js 必须重新执行，才能重新注册
  }
  let mod;
  try {
    mod = require(indexPath);
  } catch (e) {
    const err = new Error('require(' + indexPath + ') 失败: ' + ((e && e.stack) || e));
    err.cause = e;
    throw err;
  }

  // 注册表：本次 require 期间创建的所有 skill 对象
  const skills = modelContext._state.skills;
  const apis = {};
  modelContext._state.registrations.forEach(function (r) { apis[r.name] = r.fn; });

  // 兼容 module.exports.apis（直接导出接口函数表）与 module.exports.register(skill) 两种写法
  const exp = mod && mod.__esModule && mod.default ? mod.default : mod;
  if (exp && typeof exp === 'object' && exp.apis && typeof exp.apis === 'object' && !Array.isArray(exp.apis)) {
    Object.keys(exp.apis).forEach(function (k) { if (typeof exp.apis[k] === 'function' && !apis[k]) apis[k] = exp.apis[k]; });
  }
  if (!Object.keys(apis).length && exp && typeof exp.register === 'function') {
    try {
      exp.register(modelContext.createSkill(skillPath));
      modelContext._state.registrations.forEach(function (r) { apis[r.name] = r.fn; });
    } catch (e) { warnings.push('module.exports.register() 调用失败: ' + (e && e.message)); }
  }
  // 兼容 module.exports 直接是函数表（{ getMyProfile: fn }）：只收 apis/ 目录同名文件对应的键
  if (!Object.keys(apis).length && exp && typeof exp === 'object') {
    const dir = path.join(skillDir, 'apis');
    if (isDir(dir)) {
      fs.readdirSync(dir).forEach(function (f) {
        if (!/\.js$/.test(f) || /^_/.test(f)) return;
        const base = f.replace(/\.js$/, '');
        const camel = base.charAt(0).toLowerCase() + base.slice(1);
        if (typeof exp[camel] === 'function') { apis[camel] = exp[camel]; warnings.push('从 module.exports.' + camel + ' 兜底收集接口（index.js 未 registerAPI）'); }
        if (typeof exp[base] === 'function') { apis[base] = exp[base]; warnings.push('从 module.exports.' + base + ' 兜底收集接口（index.js 未 registerAPI）'); }
      });
    }
  }
  if (!Object.keys(apis).length) warnings.push('index.js 没有通过 registerAPI 注册任何接口（检查是否使用 wx.modelContext.createSkill(...).registerAPI(name, fn)）');

  const apiNames = Object.keys(apis);
  return {
    mcp: mcp,
    mcpError: mcp && mcp.__error ? mcp.__error : null,
    path: skillDir,
    indexPath: indexPath,
    mcpPath: mcpPath,
    apis: apis,
    apiNames: apiNames,
    skill: skills[0] || null,
    skills: skills,
    uses: modelContext._state.uses,
    modelContext: modelContext,
    wx: wx,
    module: mod,
    warnings: warnings
  };
}

function readMcp(mcpPath, warnings, opts) {
  if (!isFile(mcpPath)) {
    if (warnings) warnings.push('缺少 mcp.json: ' + mcpPath);
    return null;
  }
  try {
    const raw = fs.readFileSync(mcpPath, 'utf8');
    const j = JSON.parse(raw);
    return j;
  } catch (e) {
    if (warnings) warnings.push('mcp.json 解析失败: ' + (e && e.message));
    return { __error: String(e && e.message) };
  }
}

// 加载共享层（ai/common/*）；用当前 global.wx
function loadCommon(wx) {
  if (wx) global.wx = wx;
  const root = path.join(PROJECT, 'ai', 'common');
  return {
    config: require(path.join(root, 'config.js')),
    auth: require(path.join(root, 'auth.js')),
    rest: require(path.join(root, 'rest.js')),
    local: require(path.join(root, 'local.js')),
    marks: require(path.join(root, 'marks.js')),
    result: require(path.join(root, 'result.js')),
    fmt: require(path.join(root, 'fmt.js')),
    handoff: require(path.join(root, 'handoff.js'))
  };
}

/* ================================================================ 调用 + 返回结构校验 */

function apiMapOf(apis) {
  if (!apis) return {};
  if (apis.apis && typeof apis.apis === 'object' && !Array.isArray(apis.apis)) return apis.apis;
  return apis;
}
function apiNamesOf(apis) {
  const m = apiMapOf(apis);
  return Object.keys(m).filter(function (k) { return typeof m[k] === 'function'; });
}

/**
 * 调用原子接口并校验 CONTRACT §4 返回结构。
 * @param {object} wx
 * @param {object} apis loadSkill 返回的 apis 或整个 loadSkill 结果
 * @param {string} name 接口名
 * @param {object|Function} args 入参（函数则惰性求值）
 * @param {object} opts { ctx, expect:'ok'|'error', requirePagePath=true, checkApi=true, query }
 */
async function call(wx, apis, name, args, opts) {
  opts = opts || {};
  const map = apiMapOf(apis);
  const fn = map[name];
  if (typeof fn !== 'function') {
    throw new Error('接口未注册: ' + name + '；已注册: [' + apiNamesOf(apis).join(', ') + ']');
  }
  const argv = typeof args === 'function' ? args() : (args === undefined ? {} : args);
  const ctx = opts.ctx || { wx: wx, modelContext: wx && wx.modelContext, mode: 'atomic', query: opts.query || '' };
  const illegalBefore = (wx && wx.__illegal ? wx.__illegal.length : 0);
  let res;
  try {
    res = await fn(argv, ctx);
  } catch (e) {
    throw new Error('接口 ' + name + ' 抛出异常（¥ 原子接口应返回 isError 而不是 throw）: ' + ((e && e.stack) || e));
  }
  if (wx && wx.__illegal) {
    const illegal = wx.__illegal.slice(illegalBefore);
    if (illegal.length && (opts.checkApi !== false && wx.__state && wx.__state.checkApi !== false)) {
      throw new Error('接口 ' + name + ' 调用了原子接口环境不允许的 API: '
        + illegal.map(function (x) { return 'wx.' + x.api; }).join(', ') + '（CONTRACT §0）');
    }
  }
  validateResult(name, res, opts);
  if (opts.expect === 'ok' && res.isError !== false) throw new Error('接口 ' + name + ' 期望成功，实际失败: ' + contentText(res));
  if (opts.expect === 'error' && res.isError !== true) throw new Error('接口 ' + name + ' 期望失败，实际成功: ' + contentText(res));
  return res;
}

function contentText(res) {
  if (!res || !Array.isArray(res.content)) return '';
  return res.content.map(function (c) { return (c && c.text) || ''; }).join(' ');
}

function validateResult(name, res, opts) {
  opts = opts || {};
  const problems = [];
  if (!res || typeof res !== 'object' || Array.isArray(res)) {
    throw new Error('接口 ' + name + ' 返回值必须是对象，实际 ' + fmtVal(res));
  }
  if (typeof res.isError !== 'boolean') problems.push('isError 必须是 boolean');
  if (!Array.isArray(res.content)) problems.push('content 必须是数组');
  else {
    if (!res.content.length) problems.push('content 不能为空');
    res.content.forEach(function (c, i) {
      if (!c || typeof c !== 'object') { problems.push('content[' + i + '] 必须是 {type:\'text\',text}'); return; }
      if (c.type !== 'text') problems.push('content[' + i + '].type 必须是 "text"');
      if (typeof c.text !== 'string' || !c.text.trim()) problems.push('content[' + i + '].text 必须是非空字符串');
    });
  }
  if (res.isError === true) {
    const code = res.structuredContent && res.structuredContent.error && res.structuredContent.error.code;
    if (!code || typeof code !== 'string') problems.push('失败返回缺少 structuredContent.error.code（字符串）');
    if (res._meta && res._meta.cardData) problems.push('失败返回不应带卡片数据 _meta.cardData（CONTRACT §4）');
  } else if (res.isError === false) {
    const sc = res.structuredContent;
    if (!sc || typeof sc !== 'object' || Array.isArray(sc)) problems.push('成功返回缺少 structuredContent 对象');
    else if (opts.requirePagePath !== false && (typeof sc.pagePath !== 'string' || !sc.pagePath)) {
      problems.push('structuredContent 缺少 pagePath（CONTRACT §4：format=page-link 蓝链，取自 handoff.PAGES）');
    }
  }
  if (res._meta !== undefined && (!res._meta || typeof res._meta !== 'object' || Array.isArray(res._meta))) problems.push('_meta 必须是对象');
  if (res.handoff !== undefined) {
    if (typeof res.handoff !== 'function') problems.push('handoff 必须是函数（平台会调用）');
    else {
      let hv;
      try { hv = res.handoff(); } catch (e) { problems.push('handoff() 抛异常: ' + (e && e.message)); }
      if (hv !== undefined) {
        if (!hv || typeof hv !== 'object') problems.push('handoff() 必须返回 {query, payload}');
        else {
          if (typeof hv.query !== 'string') problems.push('handoff().query 必须是字符串');
          if (hv.payload !== undefined && (typeof hv.payload !== 'object' || hv.payload === null || Array.isArray(hv.payload))) {
            problems.push('handoff().payload 必须是对象');
          }
        }
      }
    }
  }
  if (res.apiCalls !== undefined && !Array.isArray(res.apiCalls)) problems.push('apiCalls 必须是数组');
  if (problems.length) {
    throw new Error('接口 ' + name + ' 返回结构不符合 CONTRACT §4：\n    - ' + problems.join('\n    - '));
  }
}

// 取 handoff 求值结果（call 已校验过结构）
function handoffOf(res) {
  if (!res || typeof res.handoff !== 'function') throw new Error('返回没有 handoff 函数');
  return res.handoff();
}

/* ================================================================ 请求断言辅助 */

function lastRequest(wx, needle) {
  const list = (wx && wx.calls && wx.calls.requests) || [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (!needle || matchesNeedle(list[i], needle)) return list[i];
  }
  return null;
}
function requestsMatching(wx, needle) {
  const list = (wx && wx.calls && wx.calls.requests) || [];
  return list.filter(function (r) { return matchesNeedle(r, needle); });
}
function matchesNeedle(r, needle) {
  if (!needle) return true;
  if (typeof needle === 'function') return !!needle(r);
  if (needle instanceof RegExp) return needle.test(r.url);
  return String(r.url).indexOf(String(needle)) >= 0;
}
function lastBody(wx, needle) {
  const r = lastRequest(wx, needle);
  return r ? r.data : undefined;
}
function lastRoute(wx, needle) { return lastRequest(wx, needle); }
function resetRequests(wx) { if (wx && wx.__resetRequests) wx.__resetRequests(); return wx; }

/* ================================================================ 夹具 */

const FIXTURE_MEMBERS = [
  { seat: 1, sid: '9999000001', name: '李学盈', role: '', badge: '', is_admin: false },
  { seat: 2, sid: '9999000002', name: '王梓萱', role: '学习委员', badge: '班委', is_admin: false },
  { seat: 7, sid: '3260707007', name: '赵思远', role: '', badge: '', is_admin: false },
  { seat: 12, sid: '3260707012', name: '周雨桐', role: '团支书', badge: '班委', is_admin: false },
  { seat: 24, sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: true },
  { seat: 26, sid: '9999000004', name: '谢梓萱', role: '', badge: '', is_admin: false },
  { seat: 31, sid: '3260707031', name: '孙浩然', role: '', badge: '', is_admin: false },
  { seat: 45, sid: '3260707045', name: '吴佳怡', role: '生活委员', badge: '班委', is_admin: false }
];

function pad2(n) { return (n < 10 ? '0' : '') + n; }
function fmtDate(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function fmtDateTime(ts) {
  const d = new Date(ts);
  return fmtDate(ts) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
function fmtHm(ts) { const d = new Date(ts); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function isoOf(ts) { return new Date(ts).toISOString(); }
function todayStr() { return fmtDate(Date.now()); }

/**
 * 常用夹具（时间都相对 now 生成，避免测试随时间腐化）。
 * over: { now, identity:false, members, homework, notices, fitRecords, ttData, patch(fx) }
 */
function mkFixture(over) {
  over = over || {};
  const now = over.now || Date.now();
  const DAY = 86400000;
  const HOUR = 3600000;
  const inDays = function (n) { return now + n * DAY; };
  const inHours = function (n) { return now + n * HOUR; };

  const IDENTITY = Object.assign({
    token: 'tok-fixture-ai-20261105',
    sid: '3260799999',
    name: '测试账号',
    role: '副团支书',
    badge: '班委',
    is_admin: true,
    ts: now - DAY
  }, over.identity || {});
  const MEMBERS = over.members || FIXTURE_MEMBERS.slice();
  const rosterText = MEMBERS.map(function (m) { return m.seat + ' ' + m.name; }).join('\n');

  // ---- 作业（字段口径 = utils/cloud.js hwRow / pages/hw）：date(YYYY-MM-DD) + time(HH:mm) + due(展示文案)
  const HOMEWORK = over.homework || [
    { id: 'hw_001', subject: '高等数学', content: '习题 3.1 第 1-10 题，写清推导过程；下节课前交。', due: '明天 08:00', date: fmtDate(inDays(1)), time: '08:00', author: '学习委员', owner: '9999000002', attachments: '', done: false, archived: false, ts: now - 2 * HOUR },
    { id: 'hw_002', subject: '大学英语', content: '背 Unit 4 单词（1-60），完成听力练习并拍照上传。', due: '还剩 3 天', date: fmtDate(inDays(3)), time: '23:59', author: '测试账号', owner: '3260799999', attachments: '', done: false, archived: false, ts: now - 26 * HOUR },
    { id: 'hw_003', subject: '程序设计基础', content: '实现单链表实验，提交源码 + 实验报告 PDF。', due: '已过期 2 天', date: fmtDate(now - 2 * DAY), time: '18:00', author: '测试账号', owner: '3260799999', attachments: '', done: false, archived: false, ts: now - 5 * DAY },
    { id: 'hw_004', subject: '线性代数', content: '整理第三章笔记，拍照上传。', due: '无截止日期', date: '', time: '', author: '学习委员', owner: '9999000002', attachments: '', done: false, archived: false, ts: now - 3 * DAY },
    { id: 'hw_005', subject: '大学物理', content: '完成实验一预习报告（含电路图）。', due: '已过期 1 天', date: fmtDate(now - DAY), time: '08:00', author: '测试账号', owner: '3260799999', attachments: JSON.stringify([{ name: '预习要求.pdf', size: '120 KB', type: 'pdf' }]), done: true, archived: false, ts: now - 4 * DAY }
  ];

  // ---- 通知（自动组 g*：字段口径 = [[CLASS_NOTICE_V1]] JSON / utils/notice.js / pages/nt）
  const NOTICE_GROUPS = over.notices || [
    {
      id: 'ntg_001', title: '关于2026年秋季学期期中考试安排的通知', cat: '考试', source: '教务通知',
      senderName: '张老师', senderRole: '辅导员', senderBadge: '老师',
      deadline: isoOf(inDays(2)), expireAt: isoOf(inDays(3)), eventAt: null,
      alert: false, actionable: true, ocr: false,
      aiSummary: '教务处发布期中考试安排：11 月 12 日-14 日进行，考试科目与考场见附件，考生须携带学生证。',
      aiPoints: ['考试时间：11 月 12 日-14 日', '须携带学生证参加考试', '考场安排见附件'],
      aiSegments: [
        { type: '时间', text: '11 月 12 日-14 日' },
        { type: '地点', text: '第一教学楼 A 座' },
        { type: '要求', text: '携带学生证' }
      ],
      items: [
        { kind: 'text', text: '各位同学：期中考试安排已发布，请查看附件并合理安排复习。', fromName: '张老师', fromRole: '辅导员', time: '11-04 09:12' },
        { kind: 'file', name: '期中考试安排.pdf', size: '240 KB', url: 'data:application/pdf;base64,JVBERi0xLjQK' },
        { kind: 'img', src: 'data:image/png;base64,iVBORw0KGgo=', caption: '考场分布图', ocr: true }
      ]
    },
    {
      id: 'ntg_002', title: '团日活动报名截止提醒', cat: '团务', source: '微信班级群',
      senderName: '周雨桐', senderRole: '团支书', senderBadge: '班委',
      deadline: isoOf(inHours(2)), expireAt: isoOf(inDays(1)), eventAt: null,
      alert: false, actionable: true, ocr: false,
      aiSummary: '本周五团日活动报名今晚 24 点截止，请未报名的同学尽快在收集表填写。',
      aiPoints: ['今晚 24 点截止', '收集表在群公告'],
      aiSegments: [{ type: '截止', text: '今晚 24 点' }, { type: '报名', text: '群内收集表' }],
      items: [
        { kind: 'text', text: '团日活动报名今晚截止，请抓紧时间。', fromName: '周雨桐', fromRole: '团支书', time: '11-05 10:30' },
        { kind: 'form', name: '团日活动报名表', close: '11-05 23:59', realTitle: '团日活动报名', url: 'data:application/octet-stream;base64,AAAA' }
      ]
    },
    {
      id: 'ntg_003', title: '奖学金材料提交（已截止）', cat: '班级事务', source: 'QQ群',
      senderName: '王梓萱', senderRole: '学习委员', senderBadge: '班委',
      deadline: isoOf(now - 2 * DAY), expireAt: isoOf(now - DAY), eventAt: null,
      alert: false, actionable: true, ocr: false,
      aiSummary: '奖学金申请材料提交已截止，逾期不再受理。',
      aiPoints: ['已截止'],
      aiSegments: [{ type: '截止', text: '11 月 3 日' }],
      items: [{ kind: 'text', text: '奖学金材料提交已截止。', fromName: '王梓萱', fromRole: '学习委员', time: '11-03 18:00' }]
    },
    {
      id: 'ntg_004', title: '班级通讯录更新说明', cat: '班级事务', source: '微信班级群',
      senderName: '测试账号', senderRole: '副团支书', senderBadge: '班委',
      deadline: null, expireAt: null, eventAt: null,
      alert: false, actionable: true, ocr: false,
      aiSummary: '通讯录已更新，请大家核对本人信息，有误私聊班委。',
      aiPoints: [],
      aiSegments: [{ type: '内容', text: '核对本人信息' }],
      items: [{ kind: 'text', text: '通讯录已更新，请核对。', fromName: '测试账号', fromRole: '副团支书', time: '11-02 20:00' }]
    }
  ];
  const NOTICE_ROWS = NOTICE_GROUPS.map(function (g, i) {
    return { id: 'nt_row_' + (i + 1), title: 'CLASS_NOTICE ' + g.id, body: '[[CLASS_NOTICE_V1]]' + JSON.stringify(g), author: 'auto', owner: '', attachments: '', archived: false, ts: now - (i + 1) * HOUR };
  });
  NOTICE_ROWS.push({
    id: 'nt_manual_1', title: '教室调整通知', body: '本周三第 5-6 节高等数学调到 B201。',
    author: '张老师', owner: '9999000002', attachments: '', imp: true, archived: false, ts: now - 30 * 60000
  });

  // ---- 体测（fitrecs 字段口径 = pages/ft + utils/cloud.js fitPush：fields 含 sex/grade 与输入框键）
  const FIT_FIELDS = { sex: 'm', grade: '12', h: '175', w: '68', vc: '4200', r50: '7.2', sit: '12.5', jump: '240', pull: '12', durM: '3', durS: '50' };
  const FIT_RECORDS = over.fitRecords || [
    {
      id: 'fit_001', ts: now - DAY, name: '体测 2026-11-04', sex: 'm', gr: '12',
      fields: Object.assign({}, FIT_FIELDS), total: 82.5, grade: '良好', _sync: false
    },
    {
      id: 'fit_002', ts: now - 30 * DAY, name: '体测 2026-10-06', sex: 'f', gr: '34',
      fields: { sex: 'f', grade: '34', h: '162', w: '52', vc: '3100', r50: '8.0', sit: '21', jump: '195', pull: '45', durM: '3', durS: '55' },
      total: 76.8, grade: '及格', _sync: false
    }
  ];

  // ---- 课表（ttCache 口径 = pages/tt/store.trc：{c:[...],t:'开学日期',at,meta}）
  const dow = (new Date(now).getDay() + 6) % 7;                 // 0=周一
  const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - dow);
  const termStartMs = monday.getTime() - 8 * 7 * DAY;           // 今天 = 第 9 周
  const TT = over.ttData || {
    c: [
      { name: '高等数学', teacher: '李国强', room: '自强楼(教室01105)', day: dow, start: 1, end: 2, weeks: '1-16', parity: 'all' },
      { name: '大学英语', teacher: 'Emily', room: '博学楼(教室B203)', day: dow, start: 3, end: 4, weeks: '1-16', parity: 'all' },
      { name: '程序设计基础', teacher: '王磊', room: '实验楼(机房A302)', day: (dow + 1) % 7, start: 5, end: 6, weeks: '1-16', parity: 'all' },
      { name: '线性代数', teacher: '赵敏', room: '自强楼(教室02208)', day: 4, start: 7, end: 8, weeks: '1-16', parity: 'odd' },
      { name: '大学物理', teacher: '孙浩', room: '博学楼(教室C101)', day: 2, start: 9, end: 10, weeks: '1-16', parity: 'all' },
      { name: '体育', teacher: '刘强', room: '田径场', day: 3, start: 11, end: 12, weeks: '2-14', parity: 'all' }
    ],
    t: fmtDate(termStartMs),
    at: now - 12 * HOUR,
    meta: { fetchedAt: now - 12 * HOUR }
  };

  const STORE = {
    classMembers: MEMBERS,
    classRoster: rosterText,
    classMembersAt: now - HOUR,
    homework: HOMEWORK,
    notices: NOTICE_ROWS.filter(function (r) { return String(r.body || '').indexOf('[[CLASS_NOTICE_V1]]') !== 0; }),
    termStart: TT.t,
    homeTools: ['hw', 'nt', 'ft', 'draw'],
    homeToolsAt: now - 3 * DAY,
    roster: rosterText,
    rosterSel: [1, 2, 7, 12, 24, 26, 31, 45],
    hwDone: { hw_005: true },
    ntDone: { ntg_001: true },
    ntPin: { ntg_002: true },
    hwHide: {}, ntHide: {}, markPend: [],
    ntRemind: {},
    ntSub: false, ntSubAt: 0,
    rollNames: rosterText,
    rollSel: [1, 2, 7, 12, 24, 26, 31, 45],
    rollSt: { 0: '到', 1: '假', 2: '到' },
    fitRecs: FIT_RECORDS,
    fit: { sex: 'm', grade: '12', h: '175', w: '68', vc: '4200', r50: '7.2', sit: '12.5', jump: '240', pull: '12', durM: '3', durS: '50' },
    ttCache: TT,
    draw: { start: 1, end: 50, count: 4, dup: false, excl: '', sort: 'draw' },
    group: { source: 'prev', names: '', sel: [], mode: 'groups', n: 2, shuffle: false },
    udCache: null, udPend: false, cloudOff: false, udHoldUntil: 0,
    did: '', settings: { kind: 'webhook', url: '' }
  };

  const FLOW = {
    draw: {
      result: [3, 17, 24, 42],
      pool: Array.from({ length: 50 }, function (_, i) { return i + 1; }),
      removed: [], log: [],
      cfg: { range: '1 – 50', rangeF: '1-50', count: '4', dup: '否', excl: '无', sort: '按抽取顺序', pool: '50', sel: '0', selF: '' },
      drawnAt: now - 2 * HOUR
    },
    group: {
      result: [
        [{ n: 3, nm: '李学盈' }, { n: 17, nm: '' }],
        [{ n: 24, nm: '测试账号' }, { n: 42, nm: '' }]
      ],
      cfg: { source: '上一步抽签序号', mode: '按组数(2 组)', total: '4', groups: '2', inner: '按原顺序轮流分配' }
    },
    updatedAt: now - 2 * HOUR
  };

  const storage = {};
  storage.zq_class_identity = IDENTITY;
  storage.zq_tools_v2 = STORE;
  storage.zq_flow = FLOW;
  if (over.identity === false) delete storage.zq_class_identity;

  const fx = {
    now: now,
    inDays: inDays, inHours: inHours,
    IDENTITY: IDENTITY,
    MEMBERS: MEMBERS,
    rosterText: rosterText,
    HOMEWORK: HOMEWORK,
    NOTICE_GROUPS: NOTICE_GROUPS,
    NOTICE_ROWS: NOTICE_ROWS,
    FIT_FIELDS: FIT_FIELDS,
    FIT_RECORDS: FIT_RECORDS,
    TT: TT,
    STORE: STORE,
    FLOW: FLOW,
    storage: storage,
    // 便捷：把工期/截止时间格式化成契约常用文案
    fmtDate: fmtDate, fmtDateTime: fmtDateTime, fmtHm: fmtHm, iso: isoOf,
    homeworkById: function (id) { return HOMEWORK.filter(function (x) { return x.id === id; })[0] || null; },
    noticeById: function (id) { return NOTICE_GROUPS.filter(function (x) { return x.id === id; })[0] || null; },
    fitById: function (id) { return FIT_RECORDS.filter(function (x) { return x.id === id; })[0] || null; }
  };
  if (typeof over.patch === 'function') over.patch(fx);
  return fx;
}

// 已认证 wx + 夹具一步到位
function createWxWithFixture(over, wxOpts) {
  const fx = mkFixture(over);
  const wx = createWx(Object.assign({ storage: fx.storage }, wxOpts || {}));
  wx.__fixture = fx;
  return wx;
}

/* ================================================================ 导出 */

module.exports = {
  // 断言
  assert: assert, ok: ok, notOk: notOk, eq: eq, ne: ne, deepEq: deepEq,
  isArray: isArray, isStr: isStr, isNum: isNum, between: between,
  includes: includes, notIncludes: notIncludes, match: match,
  throws: throws, rejects: rejects, hasKeys: hasKeys,
  isErr: isErr, isOk: isOk,
  // 汇总
  test: test, skip: skip, report: report, resetReport: resetReport,
  get lastReport() { return lastReport; },
  // mock wx / modelContext
  createWx: createWx, createWxWithFixture: createWxWithFixture, createModelContext: createModelContext,
  makeRecorder: makeRecorder,
  // 技能加载 / 调用
  loadSkill: loadSkill, loadCommon: loadCommon, call: call,
  validateResult: validateResult, handoffOf: handoffOf, apiNamesOf: apiNamesOf, apiMapOf: apiMapOf,
  // 请求断言
  lastRequest: lastRequest, requestsMatching: requestsMatching, lastBody: lastBody, lastRoute: lastRoute, resetRequests: resetRequests,
  // 夹具 / 工具
  mkFixture: mkFixture, PROJECT: PROJECT,
  fmtDate: fmtDate, fmtDateTime: fmtDateTime, fmtHm: fmtHm, iso: isoOf, todayStr: todayStr,
  clearRequireCache: clearRequireCache,
  FORBIDDEN_APIS: FORBIDDEN_APIS
};
