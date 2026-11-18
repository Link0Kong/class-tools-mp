/* cloudspace_unit_tests.js —— 文件传输 · 临时云空间专项单测（2026-11-12，随 unit.js 运行）
 *
 * 覆盖：
 *   A. utils/cloudspace.js 纯逻辑：分片规划（8MiB）/ 大小格式 / 72h 剩余时间 / 事件合并（file/filedel/过期/去重/排序）/
 *      文件视图（图标/大小/时间/剩余）/ 空间统计 / 文件名清洗；
 *   B. 请求契约：X-Device-Id = 班级 token、JSON 与原始分片头、/mine /open /state /upload/* /file DELETE /close 的
 *      URL/method/body（wx.request 内存 mock，绝不访问真实云端）；
 *   C. 环境基址：开发/体验版直连 ECS http、正式版 https://tool.furina.fun/drop、cloud-config.dropBase 可覆盖；
 *   D. 工程接线：app.json 注册 / tools.js 入口（key='file'，与网页对齐）/ 4 个页面文件 / share 三件套 /
 *      WXML handler / 无房间码/链接/配对 UI / 只读取测试身份。
 *
 * 说明：纯 Node + 内存 wx mock；不启动模拟器、不发真实请求。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const HERE = __dirname;
const MP = path.resolve(HERE, '..'); // tests/ 已并入小程序仓库，上一级即小程序根目录
const PAGE = 'pages/cloudspace/cloudspace';
const REAL_SIDS = /3260707024|3260707001|3260707002|3260707003|3260707026|陈子麒/;

function src(rel) { return fs.readFileSync(path.join(MP, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(MP, rel)); }

function run(outerTest) {
  const T = (typeof outerTest === 'function') ? outerTest : function (name, fn) {
    try { fn(); console.log('PASS  ' + name); } catch (e) { console.log('FAIL  ' + name + ' :: ' + e.message); throw e; }
  };

  // 加载模块（unit.js 已提供 global.wx 内存 mock；本套件临时补充所需 API）
  if (!global.wx) global.wx = {};
  const localMem = {};
  if (!global.wx.setStorageSync) global.wx.setStorageSync = function (k, v) { localMem[k] = v; };
  if (!global.wx.getStorageSync) global.wx.getStorageSync = function (k) { return localMem[k] === undefined ? '' : localMem[k]; };
  if (!global.wx.removeStorageSync) global.wx.removeStorageSync = function (k) { delete localMem[k]; };
  const saved = {
    getAccountInfoSync: global.wx && global.wx.getAccountInfoSync,
    request: global.wx && global.wx.request,
    chooseMessageFile: global.wx && global.wx.chooseMessageFile,
    getFileSystemManager: global.wx && global.wx.getFileSystemManager
  };
  const mockRequest = { log: [], impl: null };
  global.wx.request = function (o) { mockRequest.log.push(o); if (mockRequest.impl) mockRequest.impl(o); };
  try { global.wx.setStorageSync('zq_class_identity', { token: 'tok-cloudspace', sid: '3260799999', name: '测试账号', role: '', badge: '', is_admin: false, ts: 1 }); } catch (e) {}
  const cs = require(path.join(MP, 'utils', 'cloudspace.js'));
  const cfg = require(path.join(MP, 'utils', 'cloud-config.js'));
  const savedDropBase = cfg.dropBase;
  // 2026-11-17：生产 dropBase 为空 + DNS 暂停期正式版不再请求 tool.furina.fun；
  // 请求契约用例显式配置测试基址，环境默认值用例用 withDefaultBase 验证「不可用」。
  cfg.dropBase = 'https://drop.test';
  // C1–C3 验证「未配置 dropBase 时」的环境默认值；临时环境当前显式配置了 ko-link.cn，测前清空、测后恢复
  function withDefaultBase(fn) {
    const old = cfg.dropBase;
    cfg.dropBase = '';
    try { fn(); } finally { cfg.dropBase = old; }
  }

  // A. 纯逻辑 ---------------------------------------------------------------
  T('A1 分片规划：20MiB = 3 片（8+8+4MiB）', function () {
    const p = cs.chunkPlan(20 * 1024 * 1024);
    assert.strictEqual(p.totalChunks, 3);
    assert.deepStrictEqual(p.chunks.map(function (c) { return c.size; }), [8388608, 8388608, 4194304]);
    assert.strictEqual(p.chunks[2].start, 16 * 1024 * 1024);
    assert.strictEqual(p.chunks[2].end, 20 * 1024 * 1024);
  });
  T('A2 分片规划：0 字节 = 1 片（服务端会拒绝但前端不崩）', function () {
    const p = cs.chunkPlan(0);
    assert.strictEqual(p.totalChunks, 1);
    assert.strictEqual(p.chunks[0].size, 0);
  });
  T('A3 fmtSize：B/KB/MB', function () {
    assert.strictEqual(cs.fmtSize(512), '512 B');
    assert.strictEqual(cs.fmtSize(2048), '2.0 KB');
    assert.strictEqual(cs.fmtSize(5 * 1024 * 1024), '5.0 MB');
    assert.strictEqual(cs.fmtSize(20 * 1024 * 1024), '20 MB');
  });
  T('A4 ttlText：72h 内显示剩余、过期显示已过期', function () {
    const now = 1700000000000;
    assert.strictEqual(cs.ttlText(now - 1000, now), '剩 3 天');
    assert.strictEqual(cs.ttlText(now - 48 * 3600 * 1000 - 1000, now), '剩 1 天');
    assert.strictEqual(cs.ttlText(now - cs.TTL_MS - 1000, now), '已过期');
  });
  T('A5 applyEvents：file 追加 / filedel 移除 / 过期保留标记 / 去重 / 按时间倒序', function () {
    const t = 1700000000000;
    const evs = [
      { kind: 'file', at: t + 1000, payload: { id: 'f1', name: 'a.txt', size: 10, downloadUrl: 'http://x/1' } },
      { kind: 'file', at: t + 2000, payload: { id: 'f2', name: 'b.bin', size: 20, downloadUrl: 'http://x/2' } },
      { kind: 'file', at: t + 3000, payload: { id: 'f3', name: 'old.bin', size: 30, expired: true } },
      { kind: 'file', at: t + 1500, payload: { id: 'f1', name: 'a2.txt', size: 11, downloadUrl: 'http://x/1b' } },
      { kind: 'filedel', at: t + 4000, payload: { fileId: 'f2' } }
    ];
    const out = cs.applyEvents([], evs);
    assert.deepStrictEqual(out.map(function (f) { return f.id; }), ['f3', 'f1']);
    assert.strictEqual(out.find(function (f) { return f.id === 'f1'; }).name, 'a2.txt');
    assert.strictEqual(out.find(function (f) { return f.id === 'f3'; }).expired, true);
  });
  T('A5b /state file 事件仅 fileId 也能进列表（真实后端字段；网页 P0 同口径）', function () {
    const t = 1700000000000;
    const out = cs.applyEvents([], [
      { kind: 'file', at: t, payload: { fileId: 'real-f1', name: '真实.txt', size: 9, downloadUrl: 'http://x/f1' } }
    ]);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].id, 'real-f1');
    assert.strictEqual(out[0].name, '真实.txt');
    assert.strictEqual(out[0].expired, false);
  });

  T('A6 spaceView：只统计未过期文件 / 过期计数 / 统计字节', function () {
    const t = 1700000000000;
    const view = cs.spaceView([
      { kind: 'file', at: t, payload: { id: 'a', name: 'a.pdf', size: 1024, mime: 'application/pdf', downloadUrl: 'http://x/a' } },
      { kind: 'file', at: t + 1, payload: { id: 'b', name: 'b.jpg', size: 2048, mime: 'image/jpeg', downloadUrl: 'http://x/b' } },
      { kind: 'file', at: t, payload: { id: 'c', name: 'c.bin', size: 4096, expired: true } }
    ], t + 1000);
    assert.strictEqual(view.count, 2);
    assert.strictEqual(view.expired, 1);
    assert.strictEqual(view.bytes, 3072);
    assert.strictEqual(view.bytesText, '3.0 KB');
    assert.deepStrictEqual(view.files.map(function (f) { return f.ico; }), ['🖼', '📕']);
  });
  T('A7 safeName：去掉路径/控制字符并限长', function () {
    assert.strictEqual(cs.safeName('a/b\\c:d*.txt'), 'a_b_c_d_.txt');
    assert.strictEqual(cs.safeName(''), 'file');
    assert.ok(cs.safeName('x'.repeat(300)).length <= 120);
  });

  // B. 请求契约 -------------------------------------------------------------
  function lastReq() { return mockRequest.log[mockRequest.log.length - 1]; }
  T('B1 /mine：GET + X-Device-Id=班级 token', function () {
    mockRequest.log = []; mockRequest.impl = function (o) { o.success({ statusCode: 200, data: { ok: true, session: null } }); };
    cs.mine();
    const r = lastReq();
    assert.ok(/\/mine$/.test(r.url), r.url);
    assert.strictEqual(r.method, 'GET');
    assert.strictEqual(r.header['X-Device-Id'], 'tok-cloudspace');
  });
  T('B2 /open：POST JSON body', function () {
    mockRequest.log = [];
    cs.open();
    const r = lastReq();
    assert.ok(/\/open$/.test(r.url));
    assert.strictEqual(r.method, 'POST');
    assert.strictEqual(r.header['Content-Type'], 'application/json');
    assert.deepStrictEqual(r.data, {});
  });
  T('B3 /state：GET 带 sessionId 与 since=0', function () {
    mockRequest.log = [];
    cs.state('sess 1');
    const r = lastReq();
    assert.ok(r.url.indexOf('/state?sessionId=sess%201&since=0') > 0, r.url);
    assert.strictEqual(r.method, 'GET');
  });
  T('B4 /upload/chunk：原始字节 + octet-stream + uploadId/index', function () {
    mockRequest.log = [];
    const buf = new ArrayBuffer(8);
    cs.chunkUpload('u1', 2, buf);
    const r = lastReq();
    assert.ok(r.url.indexOf('/upload/chunk?uploadId=u1&index=2') > 0, r.url);
    assert.strictEqual(r.method, 'POST');
    assert.strictEqual(r.header['Content-Type'], 'application/octet-stream');
    assert.strictEqual(r.data, buf);
  });
  T('B5 DELETE /file/<id>?sessionId=…', function () {
    mockRequest.log = [];
    cs.deleteFile('f1', 's1');
    const r = lastReq();
    assert.ok(r.url.indexOf('/file/f1?sessionId=s1') > 0, r.url);
    assert.strictEqual(r.method, 'DELETE');
  });
  T('B6 网络失败 resolve {ok:false}（页面统一 toast，不抛异常）', function () {
    mockRequest.log = []; mockRequest.impl = function (o) { o.fail({ errMsg: 'network' }); };
    return new Promise(function (resolve, reject) {
      cs.mine().then(function (r) {
        try { assert.strictEqual(r.ok, false); assert.ok(r.reason); resolve(); } catch (e) { reject(e); }
      }).catch(reject);
    });
  });

  // C. 基址环境 -------------------------------------------------------------
  T('C1 正式版未配置 dropBase → 空基址（不发请求，等待域名备案）', function () {
    withDefaultBase(function () {
      global.wx.getAccountInfoSync = function () { return { miniProgram: { envVersion: 'release' } }; };
      assert.strictEqual(cs.base(), '');
      mockRequest.log = [];
      cs.mine();
      assert.strictEqual(mockRequest.log.length, 0, '不得向已暂停域名发请求');
    });
  });
  T('C2 仅开发版可用 http IP；体验版/正式版强制 HTTPS', function () {
    withDefaultBase(function () {
      global.wx.getAccountInfoSync = function () { return { miniProgram: { envVersion: 'develop' } }; };
      assert.strictEqual(cs.base(), 'http://121.196.47.2/drop');
      global.wx.getAccountInfoSync = function () { return { miniProgram: { envVersion: 'trial' } }; };
      assert.strictEqual(cs.base(), '');
      global.wx.getAccountInfoSync = function () { return { miniProgram: { envVersion: 'release' } }; };
      assert.strictEqual(cs.base(), '');
    });
  });
  T('C3 无 getAccountInfoSync 时保守回退正式版（空基址不可用）', function () {
    withDefaultBase(function () {
      delete global.wx.getAccountInfoSync;
      assert.strictEqual(cs.base(), '');
    });
  });

  // D. 工程接线 -------------------------------------------------------------
  T('D1 app.json 注册 pages/cloudspace/cloudspace', function () {
    const app = JSON.parse(src('app.json'));
    assert.ok(app.pages.indexOf('pages/cloudspace/cloudspace') >= 0);
  });
  T('D2 utils/tools.js 含 key=file 入口（与网页 TOOLS 对齐）', function () {
    const t = src('utils/tools.js');
    assert.ok(/\{ key: 'file', name: '文件传输'/.test(t));
    assert.ok(t.indexOf('/pages/cloudspace/cloudspace') > 0);
    assert.ok(t.indexOf('/images/tool-file.png') > 0);
    assert.ok(exists('images/tool-file.png'));
  });
  T('D3 页面 4 文件 + 图标存在', function () {
    ['.js', '.wxml', '.json', '.wxss'].forEach(function (ext) {
      assert.ok(exists(PAGE + ext), PAGE + ext + ' missing');
    });
  });
  T('D4 分享三件套（onShareAppMessage/onShareTimeline/share.enable）', function () {
    const js = src(PAGE + '.js');
    assert.ok(js.indexOf('onShareAppMessage') >= 0);
    assert.ok(js.indexOf('onShareTimeline') >= 0);
    assert.ok(js.indexOf('share.enable()') >= 0);
    assert.ok(js.indexOf("require('../../utils/share.js')") >= 0);
  });
  T('D5 WXML 事件 handler 都在页面 JS 中', function () {
    const wxml = src(PAGE + '.wxml');
    const js = src(PAGE + '.js');
    const re = /(?:bind|catch)[:]?[a-zA-Z]+="([A-Za-z_$][\w$]*)"/g;
    let m;
    const missing = [];
    while ((m = re.exec(wxml))) {
      const h = m[1];
      if (!new RegExp('\\b' + h + '\\s*[:(]').test(js)) missing.push(h);
    }
    assert.deepStrictEqual(missing, []);
  });
  T('D6 无房间码/链接/配对 UI（同账号自动共享）', function () {
    const ui = src(PAGE + '.wxml');
    assert.ok(ui.indexOf('房间码') < 0, 'WXML 出现房间码');
    assert.ok(ui.indexOf('配对') < 0, 'WXML 出现配对');
    assert.ok(ui.indexOf('复制链接') < 0, 'WXML 出现复制链接');
    assert.ok(ui.indexOf('同账号') >= 0, '缺少同账号说明');
    assert.ok(ui.indexOf('3 天') >= 0, '缺少 3 天保留说明');
  });
  T('D7 删除接口/清空接口/72h TTL 接线', function () {
    const js = src('utils/cloudspace.js');
    assert.ok(js.indexOf('DELETE') >= 0);
    assert.ok(js.indexOf('TTL_MS = 3 * 24 * 3600 * 1000') >= 0);
    assert.ok(js.indexOf('/close') >= 0);
  });
  T('D8 测试身份政策：新增文件不含真实学号/姓名', function () {
    const all = src(PAGE + '.js') + src(PAGE + '.wxml') + src('utils/cloudspace.js') + src(PAGE + '.wxss');
    assert.ok(!REAL_SIDS.test(all), '发现真实账号/姓名');
  });

  // 恢复配置 / wx mock
  cfg.dropBase = savedDropBase;
  try {
    global.wx.getAccountInfoSync = saved.getAccountInfoSync;
    global.wx.request = saved.request;
    global.wx.chooseMessageFile = saved.chooseMessageFile;
    global.wx.getFileSystemManager = saved.getFileSystemManager;
    if (saved.getAccountInfoSync === undefined) delete global.wx.getAccountInfoSync;
    if (saved.chooseMessageFile === undefined) delete global.wx.chooseMessageFile;
    if (saved.getFileSystemManager === undefined) delete global.wx.getFileSystemManager;
  } catch (e) {}
}

module.exports = { run: run };
