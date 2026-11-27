// utils/screencast.js —— 微信小程序「大屏互联」（控制器）API + 纯逻辑
//
// 仅在**电脑大屏已开启**时可用：先 GET /drop/presence（30s 心跳视为在线），
// 在线才显示入口/允许操作；不在线时页面提示「当前没有设备开启大屏」。
//
// 与网页大屏控制器同协议（drop 服务 v2.3，契约 web/drop/CONTRACT.md）：
//   GET  /presence            → {ok,stage,at}（同账号）
//   GET  /mine / POST /open   → 同账号自动复用大屏会话
//   POST /text                → 发文字到大屏
//   POST /cmd {op,args}       → 遥控指令（focus/focus_clear/timer/draw/ppt/toast/restore_fs/stage_close）
//   POST /upload/init·chunk·finish → 传文件到大屏（8MiB 分片）
//
// 复用 utils/cloudspace.js 的请求/基址/分片规划（同一 drop 服务、同一 X-Device-Id 鉴权）。
'use strict';

const cloudspace = require('./cloudspace.js');

const CMD_DEFS = [
  { k: 'focus_ppt', n: '聚焦演示', op: 'focus', args: { panel: 'ppt' } },
  { k: 'focus_timer', n: '聚焦计时', op: 'focus', args: { panel: 'timer' } },
  { k: 'focus_draw', n: '聚焦抽签', op: 'focus', args: { panel: 'draw' } },
  { k: 'focus_clear', n: '退出聚焦', op: 'focus_clear', args: {} },
  { k: 'timer_start', n: '计时开始', op: 'timer', args: { action: 'start' } },
  { k: 'timer_pause', n: '计时暂停', op: 'timer', args: { action: 'pause' } },
  { k: 'timer_reset', n: '计时重置', op: 'timer', args: { action: 'reset' } },
  { k: 'draw', n: '抽签 1 人', op: 'draw', args: {} },
  { k: 'restore_fs', n: '恢复全屏', op: 'restore_fs', args: {} },
  { k: 'stage_close', n: '关闭大屏', op: 'stage_close', args: {} }
];

function presence() {
  return cloudspace.request('GET', '/presence').then(function (r) {
    return { ok: !!(r && r.ok), stage: !!(r && r.ok && r.stage), at: Number(r && r.at) || 0, reason: (r && r.reason) || '' };
  });
}

// 取当前同账号会话；没有则开一个（大屏在线时基本已有会话）
function ensureSession() {
  return cloudspace.mine().then(function (r) {
    if (r && r.ok && r.session) return r.session;
    return cloudspace.open().then(function (r2) {
      return (r2 && r2.ok && r2.session) ? r2.session : null;
    });
  });
}

function sendText(sessionId, text) {
  const t = String(text == null ? '' : text);
  if (!t.trim()) return Promise.resolve({ ok: false, reason: '先输入文字' });
  return cloudspace.request('POST', '/text', { sessionId: String(sessionId), text: t });
}

function cmdDef(key) {
  for (let i = 0; i < CMD_DEFS.length; i++) if (CMD_DEFS[i].k === key) return CMD_DEFS[i];
  return null;
}

function sendCmd(sessionId, key, extraArgs) {
  const d = cmdDef(key);
  if (!d) return Promise.resolve({ ok: false, reason: '未知指令' });
  const args = Object.assign({}, d.args || {}, extraArgs || {});
  return cloudspace.request('POST', '/cmd', { sessionId: String(sessionId), op: d.op, args: args });
}

// 分片上传（与文件云空间同一套；返回 {ok,reason}）
function uploadFile(file, onProgress) {
  const path = String((file && file.path) || '');
  const name = cloudspace.safeName(file && file.name);
  const size = Number(file && file.size) || 0;
  const mime = String((file && file.type) || 'application/octet-stream');
  if (!path || !size) return Promise.resolve({ ok: false, reason: '文件读取失败' });
  const plan = cloudspace.chunkPlan(size);
  let sessionId = '';
  let uploadId = '';
  const report = typeof onProgress === 'function' ? onProgress : function () {};
  return ensureSession().then(function (sess) {
    if (!sess || !sess.id) throw new Error('大屏会话不可用');
    sessionId = String(sess.id);
    return cloudspace.initUpload(sessionId, name, size, mime, plan.totalChunks);
  }).then(function (r) {
    if (!r || !r.ok) throw new Error((r && r.reason) || '初始化失败');
    uploadId = String(r.uploadId || '');
    let seq = Promise.resolve();
    plan.chunks.forEach(function (c) {
      seq = seq.then(function () {
        report(Math.min(99, Math.round((c.start / size) * 100)));
        return readChunk(path, c.start, c.size).then(function (buf) {
          return cloudspace.chunkUpload(uploadId, c.index, buf);
        }).then(function (rr) {
          if (!rr || !rr.ok) throw new Error((rr && rr.reason) || '分片上传失败');
        });
      });
    });
    return seq;
  }).then(function () {
    report(99);
    return cloudspace.finishUpload(sessionId, uploadId);
  }).then(function (rr) {
    if (!rr || !rr.ok) throw new Error((rr && rr.reason) || '完成上传失败');
    report(100);
    return { ok: true, file: rr.file || null };
  }).catch(function (e) {
    return { ok: false, reason: (e && e.message) || '上传失败' };
  });
}

function readChunk(path, start, len) {
  return new Promise(function (resolve, reject) {
    try {
      wx.getFileSystemManager().readFile({
        filePath: path, position: start, length: len,
        success: function (r) { resolve(r.data); },
        fail: function () { reject(new Error('读取文件失败')); }
      });
    } catch (e) { reject(new Error('读取文件失败')); }
  });
}

module.exports = {
  CMD_DEFS: CMD_DEFS,
  presence: presence,
  ensureSession: ensureSession,
  sendText: sendText,
  cmdDef: cmdDef,
  sendCmd: sendCmd,
  uploadFile: uploadFile
};
