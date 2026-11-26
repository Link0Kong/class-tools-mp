// utils/cloudspace.js —— 「文件传输 · 临时云空间」小程序端 API + 纯逻辑
//
// 与网页版「文件传输 = 临时云空间」同一后端：ECS drop 服务（契约 web/drop/CONTRACT.md v2.2）。
//   * 同账号（同班级 token）自动复用同一云空间，不需要房间码/链接/配对；
//   * 上传：POST /drop/upload/init → /upload/chunk（8MiB 原始字节分片）→ /upload/finish；
//   * 列表：GET /drop/state（events: file / filedel；file 事件带签名 downloadUrl，过期/删除后无 URL）；
//   * 删除：DELETE /drop/file/<fileId>?sessionId=…（v2.2 新增，只允许本账号会话 owner）；
//   * 清空：POST /drop/close（删除整个会话与全部文件，页面随后自动重开一个新空间）；
//   * 文件自上传完成起保留 72 小时；会话空闲 72 小时且无未过期文件时回收。
//
// 认证：请求头 X-Device-Id = 班级身份 token（与网页同口径）。
// 域名：只从 cloud-config.js 的 dropBase 读取（HTTPS，需加入微信后台 request + downloadFile 合法域名）；
//       留空 = 未配置服务地址，页面提示「未配置服务地址」，不猜测地址、不发必失败请求。
//
// 纯逻辑（分片规划/大小/剩余时间/事件合并）放本文件，页面只做交互与渲染。
'use strict';

const CHUNK = 8388608;                 // 与 drop 服务/IOS 网页一致的 8MiB 分片
const TTL_MS = 3 * 24 * 3600 * 1000;   // 文件自上传完成起 72h
const ppt = require('../pages/ppt/utils/ppt.js');

function config() {
  try { return require('./cloud-config.js') || {}; } catch (e) { return {}; }
}

function envVersion() {
  try {
    const ai = wx.getAccountInfoSync && wx.getAccountInfoSync();
    return (ai && ai.miniProgram && ai.miniProgram.envVersion) || 'release';
  } catch (e) { return 'release'; }
}

// 云空间基址（结尾无 /）：只认 cloud-config.js 的 dropBase；未配置服务地址时返回空串
// （页面据此提示「云空间暂不可用（未配置服务地址）」，不猜测地址、不向未配置域名发请求）。
function base() {
  const cfg = config();
  const raw = cfg && cfg.dropBase ? String(cfg.dropBase).trim() : '';
  return raw.replace(/\/+$/, '');
}
function unavailable() {
  return Promise.resolve({ ok: false, reason: '云空间暂不可用（未配置服务地址）' });
}

function token() {
  try { return String(require('./identity.js').token() || ''); } catch (e) { return ''; }
}

// 统一请求：返回 {ok, ...}；网络失败也 resolve（页面统一 toast），不抛异常
// v2.5（2026-11-19）：服务端在失败响应头 X-Drop-Reason 给出类别（token / unavailable），
// 这里透传为 j.dropReason —— 「身份失效」与「身份服务故障」要给出完全不同的提示。
function request(method, path, data, opt) {
  opt = opt || {};
  const b = base();
  if (!b) return unavailable();
  return new Promise(function (resolve) {
    const header = { 'X-Device-Id': token() };
    if (opt.raw) header['Content-Type'] = 'application/octet-stream';
    else if (data !== undefined && method !== 'GET' && method !== 'HEAD') header['Content-Type'] = 'application/json';
    const o = {
      url: b + path,
      method: method,
      header: header,
      timeout: opt.timeout || 120000,
      success: function (res) {
        let j = res && res.data;
        if (typeof j === 'string') { try { j = JSON.parse(j); } catch (e) { j = null; } }
        if (!j || typeof j !== 'object') j = { ok: false, reason: '服务响应异常' };
        if (res && res.statusCode >= 400) {
          j.ok = false;
          j.status = res.statusCode;
          if (!j.reason) j.reason = res.statusCode === 507 ? '服务器空间不足' : ('服务错误 ' + res.statusCode);
          const rh = (res && res.header) || {};
          const kind = rh['X-Drop-Reason'] || rh['x-drop-reason'] || '';
          if (kind) j.dropReason = String(kind);
        }
        resolve(j);
      },
      fail: function () {
        resolve({ ok: false, reason: '云空间服务不可达' });
      }
    };
    if (data !== undefined) o.data = data;
    try { wx.request(o); } catch (e) { resolve({ ok: false, reason: '云空间服务不可达' }); }
  });
}

// 失败提示文案（身份失效 / 身份服务故障 / 其它）
function failText(r, fallback) {
  if (r && r.dropReason === 'token') return '身份已失效，请重新登录';
  if (r && r.dropReason === 'unavailable') return '身份服务暂不可用，稍后自动重试';
  return (r && r.reason) || fallback || '云空间服务不可达';
}

// ---------------------------------------------------------------- API
function mine() { return request('GET', '/mine'); }
function open() { return request('POST', '/open', {}); }
// v2.5：all=1 → 服务端随事件返回**当前有效文件清单**（files / expiredNotice）。
// 事件表只保留最近 500 条，只按事件渲染会在「重新打开 / 换端 / 事件被截断」时看不到文件。
function state(sessionId, since, withPpt) {
  return request('GET', '/state?sessionId=' + encodeURIComponent(String(sessionId)) +
    '&all=1&since=' + Number(since || 0) + (withPpt ? '&ppt=1' : ''));
}
function submitConversion(sessionId, fileId, retryAttempt) {
  const body = { sessionId: sessionId };
  if (retryAttempt) body.retryAttempt = retryAttempt;
  return request('POST', '/ppt/' + encodeURIComponent(String(fileId)), body, { timeout: 12000 });
}
function conversionResult(sessionId, fileId) {
  return request('GET', '/ppt/' + encodeURIComponent(String(fileId)) +
    '?sessionId=' + encodeURIComponent(String(sessionId)));
}
function initUpload(sessionId, name, size, mime, totalChunks) {
  return request('POST', '/upload/init', {
    sessionId: sessionId, name: name, size: size, mime: mime || 'application/octet-stream',
    totalChunks: totalChunks
  });
}
function chunkUpload(uploadId, index, buffer) {
  return request('POST', '/upload/chunk?uploadId=' + encodeURIComponent(String(uploadId)) + '&index=' + Number(index),
    buffer, { raw: true, timeout: 180000 });
}
function finishUpload(sessionId, uploadId) {
  return request('POST', '/upload/finish', { sessionId: sessionId, uploadId: uploadId });
}
function deleteFile(fileId, sessionId) {
  return request('DELETE', '/file/' + encodeURIComponent(String(fileId)) +
    '?sessionId=' + encodeURIComponent(String(sessionId)));
}
function closeSpace(sessionId) {
  return request('POST', '/close', { sessionId: sessionId });
}

// ---------------------------------------------------------------- 纯逻辑
// 分片规划：{ totalChunks, chunkSize, chunks:[{index,start,end,size}] }
function chunkPlan(size, chunkSize) {
  const total = Math.max(0, Number(size) || 0);
  const cs = Math.max(1, Number(chunkSize) || CHUNK);
  const n = Math.max(1, Math.ceil(total / cs));
  const chunks = [];
  for (let i = 0; i < n; i++) {
    const start = i * cs;
    const end = Math.min(total, start + cs);
    chunks.push({ index: i, start: start, end: end, size: Math.max(0, end - start) });
  }
  return { totalChunks: n, chunkSize: cs, chunks: chunks };
}

function fmtSize(n) {
  n = Number(n) || 0;
  if (n >= 1048576) return (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return Math.max(1, Math.round(n)) + ' B';
}

function fullTime(ms) {
  const d = new Date(Number(ms) || Date.now());
  const p2 = function (x) { return (x < 10 ? '0' : '') + x; };
  return p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}

// 文件剩余保留时间（自上传完成起 72h）
function ttlText(at, now) {
  const left = (Number(at) || 0) + TTL_MS - (Number(now) || Date.now());
  if (left <= 0) return '已过期';
  const h = Math.ceil(left / 3600000);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const r = h % 24;
    return '剩 ' + d + ' 天' + (r ? ' ' + r + ' 小时' : '');
  }
  return '剩 ' + h + ' 小时';
}

// 事件合并：file / filedel → 当前文件列表（filedel 移除；过期文件保留 expired 标记、不给下载）
function applyEvents(files, events) {
  const map = {};
  (files || []).forEach(function (f) { if (f && f.id) map[String(f.id)] = f; });
  (events || []).forEach(function (ev) {
    if (!ev) return;
    const p = ev.payload || {};
    const id = String(p.fileId || p.id || '');
    if (!id) return;
    if (String(ev.kind) === 'file') {
      map[id] = {
        id: id,
        name: String(p.name || '文件'),
        size: Number(p.size) || 0,
        mime: String(p.mime || ''),
        url: String(p.downloadUrl || ''),
        expired: !!p.expired || !p.downloadUrl,
        at: Number(p.at || ev.at) || 0
      };
    } else if (String(ev.kind) === 'filedel') {
      delete map[id];
    }
  });
  const out = Object.keys(map).map(function (k) { return map[k]; });
  out.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
  return out;
}

function fileView(f, now) {
  const name = String((f && f.name) || '文件');
  const ext = (name.indexOf('.') >= 0 ? name.split('.').pop() : '').toLowerCase();
  let ico = '📄';
  if (f && f.mime && f.mime.indexOf('image/') === 0) ico = '🖼';
  else if (ext === 'mp4' || ext === 'mov' || ext === 'm4v') ico = '🎬';
  else if (ext === 'mp3' || ext === 'm4a' || ext === 'wav') ico = '🎵';
  else if (ext === 'zip' || ext === 'rar' || ext === '7z') ico = '🗂';
  else if (ext === 'pdf') ico = '📕';
  else if (ext === 'ppt' || ext === 'pptx' || ext === 'doc' || ext === 'docx' || ext === 'xls' || ext === 'xlsx') ico = '📊';
  return {
    id: f.id,
    name: name,
    ico: ico,
    size: Number(f.size) || 0,
    at: Number(f.at) || 0,
    sizeText: fmtSize(f.size),
    timeText: fullTime(f.at),
    ttlText: ttlText(f.at, now),
    expired: !!f.expired,
    url: f.expired ? '' : String(f.url || '')
  };
}

// 状态视图：{ files, count, bytes, bytesText, expired }
function spaceView(events, now) {
  const merged = applyEvents([], events);
  const live = merged.filter(function (f) { return f && !f.expired; });
  let bytes = 0;
  live.forEach(function (f) { bytes += Number(f.size) || 0; });
  return {
    files: live.map(function (f) { return fileView(f, now); }),
    count: live.length,
    bytes: bytes,
    bytesText: fmtSize(bytes),
    expired: merged.length - live.length
  };
}

// v2.5：服务端权威清单（/state?all=1 的 files）→ 与 spaceView 同形状。
// 事件表会被截断（最近 500 条）且「since 之后没有新事件」不等于「没有文件」，
// 因此文件列表必须以这里为准；事件只用于「本次增量」提示（如 toast「收到新文件」）。
function conversionView(row, job, enabled) {
  if (job) row.conversion = job;
  if (!job) {
    if (enabled && ppt.validateFile(row).ok) row.conversionAction = '转换';
  } else if (job.status === 'queued') row.conversionText = '等待处理';
  else if (job.status === 'processing') {
    row.conversionText = '转换中' + (job.progress > 0 ? ' ' + job.progress + '%' : '');
  } else if (job.status === 'ready') row.conversionAction = '下载转换结果';
  else if (job.status === 'failed') {
    row.conversionText = '转换失败';
    if (enabled) row.conversionAction = '重试转换';
  }
  return row;
}

function listView(files, now, expiredNotice, pptEnabled) {
  const live = (files || []).filter(function (f) { return f && f.id && !f.expired; });
  live.sort(function (a, b) { return (Number(b.at) || 0) - (Number(a.at) || 0); });
  let bytes = 0;
  live.forEach(function (f) { bytes += Number(f.size) || 0; });
  const out = live.map(function (f) {
    const row = fileView({ id: f.id, name: f.name, size: f.size, mime: f.mime,
      url: f.downloadUrl, expired: false, at: Number(f.at) || 0 }, now);
    return conversionView(row, f.conversion, pptEnabled);
  });
  return {
    files: out,
    count: live.length,
    bytes: bytes,
    bytesText: fmtSize(bytes),
    expired: Math.max(0, Number(expiredNotice) || 0)
  };
}

// 响应 → 视图（优先用服务端 files；旧服务端没有 files 时回退事件合并）
function respView(resp, now) {
  if (resp && resp.files instanceof Array) return listView(resp.files, now, resp.expiredNotice, resp.pptConversion === true);
  return spaceView((resp && resp.events) || [], now);
}

// 纯函数：某文件的 fileId 是否出现在本批增量事件里（用于「收到新文件」提示）
function fileIdsOf(events) {
  const ids = [];
  (events || []).forEach(function (ev) {
    if (!ev || String(ev.kind) !== 'file') return;
    const p = ev.payload || {};
    const id = String(p.fileId || p.id || '');
    if (id) ids.push(id);
  });
  return ids;
}

function safeName(name) {
  const s = String(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return s.slice(0, 120) || 'file';
}

module.exports = {
  CHUNK: CHUNK, TTL_MS: TTL_MS,
  base: base, envVersion: envVersion, request: request, failText: failText,
  mine: mine, open: open, state: state,
  submitConversion: submitConversion, conversionResult: conversionResult,
  initUpload: initUpload, chunkUpload: chunkUpload, finishUpload: finishUpload,
  deleteFile: deleteFile, closeSpace: closeSpace,
  chunkPlan: chunkPlan, fmtSize: fmtSize, fullTime: fullTime, ttlText: ttlText,
  applyEvents: applyEvents, fileView: fileView, spaceView: spaceView, safeName: safeName,
  listView: listView, respView: respView, fileIdsOf: fileIdsOf
};
