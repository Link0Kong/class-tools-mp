// ai/common/rest.js —— 原子接口环境唯一的 PostgREST / RPC 请求出口
//
// 与主包 utils/cloud.js 的请求口径一致：
//   * Authorization: Bearer <publishableKey>
//   * X-Class-Token: <token>（除 class_verify 等 public 请求；没有身份时绝不发空 token）
//   * 写统一 POST + Prefer: return=representation[,resolution=merge-duplicates]
// 错误统一 reject Error，err.code ∈ identity-required | cloud-disabled | network | timeout | http4xx | http5xx
// 原子接口环境支持 wx.request（见官方 API 支持列表），但不支持 wx.showToast / 页面路由。
const CONFIG = require('./config.js');
const auth = require('./auth.js');

function isConfigured() {
  return !!(CONFIG.enabled && CONFIG.restBase);
}

function makeErr(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function headersFor(write, opts) {
  opts = opts || {};
  const h = { 'Content-Type': 'application/json' };
  if (CONFIG.publishableKey) h.Authorization = 'Bearer ' + CONFIG.publishableKey;
  if (!opts.public) {
    const t = auth.token();
    if (t) h['X-Class-Token'] = t;
  }
  if (write) h.Prefer = 'return=representation';
  if (opts.prefer) h.Prefer = opts.prefer;
  return h;
}

function rawRequest(method, url, data, header) {
  if (!isConfigured()) return Promise.reject(makeErr('cloud-disabled', '云端未配置'));
  return new Promise(function (resolve, reject) {
    wx.request({
      url: url,
      method: method,
      data: data,
      header: header,
      timeout: CONFIG.timeout,
      success: function (res) {
        const sc = (res && res.statusCode) || 0;
        if (sc >= 200 && sc < 300) { resolve(res.data); return; }
        reject(makeErr('http' + (sc >= 500 ? '5xx' : '4xx'), 'HTTP ' + sc));
      },
      fail: function (err) {
        const msg = String((err && err.errMsg) || (err && err.message) || '');
        reject(makeErr(msg.indexOf('timeout') >= 0 ? 'timeout' : 'network', '网络不可用'));
      }
    });
  });
}

// GET 失败自动重试一次（弱网/冷启动抖动）；写请求不重试，避免重复写入。
function request(method, url, data, header, retried) {
  return rawRequest(method, url, data, header).catch(function (e) {
    const code = e && e.code;
    if (method === 'GET' && !retried && (code === 'network' || code === 'timeout')) {
      return new Promise(function (r) { setTimeout(r, 300); }).then(function () {
        return rawRequest(method, url, data, header);
      });
    }
    throw e;
  });
}

// 数据请求前置校验：必须已配置 + 已认证（public 请求除外）
function guard(opts) {
  if (!isConfigured()) throw makeErr('cloud-disabled', '网络服务未配置');
  if (!(opts && opts.public) && !auth.hasIdentity()) {
    throw makeErr('identity-required', '请先完成身份验证（学号+姓名）');
  }
}

function get(table, query) {
  return Promise.resolve().then(function () {
    guard();
    return request('GET', CONFIG.restBase + table + (query ? '?' + query : ''), undefined, headersFor(false));
  });
}

function byId(table, id) {
  return get(table, 'select=*&id=eq.' + encodeURIComponent(String(id || ''))).then(function (a) {
    return (a && a[0]) || null;
  });
}

function post(table, rows, prefer) {
  return Promise.resolve().then(function () {
    guard();
    return request('POST', CONFIG.restBase + table, Array.isArray(rows) ? rows : [rows],
      headersFor(true, { prefer: prefer || 'return=representation' }));
  });
}

function upsert(table, rows) {
  return Promise.resolve().then(function () {
    guard();
    return request('POST', CONFIG.restBase + table, Array.isArray(rows) ? rows : [rows],
      headersFor(true, { prefer: 'return=representation,resolution=merge-duplicates' }));
  });
}

// rpc(name, body, opts)：opts.public=true 时不带 X-Class-Token（class_verify 用）
function rpc(name, body, opts) {
  opts = opts || {};
  return Promise.resolve().then(function () {
    guard(opts);
    return request('POST', CONFIG.restBase + name, body || {}, headersFor(false, opts));
  });
}

// 静态 JSON（课表 tt.json 等；不带身份 token，避免跨域泄露身份）
function fetchJson(url) {
  if (!url) return Promise.reject(makeErr('invalid-url', 'URL 为空'));
  return new Promise(function (resolve, reject) {
    wx.request({
      url: url,
      method: 'GET',
      timeout: CONFIG.timeout,
      success: function (res) {
        const sc = (res && res.statusCode) || 0;
        if (sc >= 200 && sc < 300) { resolve(res.data); return; }
        reject(makeErr('http' + (sc >= 500 ? '5xx' : '4xx'), 'HTTP ' + sc));
      },
      fail: function (err) {
        const msg = String((err && err.errMsg) || '');
        reject(makeErr(msg.indexOf('timeout') >= 0 ? 'timeout' : 'network', '网络不可用'));
      }
    });
  });
}

module.exports = {
  CONFIG: CONFIG,
  isConfigured: isConfigured,
  headersFor: headersFor,
  request: request,
  get: get, byId: byId, post: post, upsert: upsert, rpc: rpc, fetchJson: fetchJson,
  makeErr: makeErr
};
