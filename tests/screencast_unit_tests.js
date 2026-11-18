/* screencast_unit_tests.js —— 微信小程序「大屏互联」专项单测（2026-11-12，随 unit.js 运行）
 *
 * 背景：用户要求 ⑦「无设备开启大屏时不显示大屏互联」、⑧「小程序在使用大屏时可使用大屏互联工具」。
 * 服务端 drop v2.3 新增 /presence（30s 心跳）；网页大屏每 10s 上报；小程序「全部工具」按 presence 动态显示。
 *
 * 覆盖：
 *   A. utils/screencast.js：11 个遥控指令定义 / presence 解析 / 文字 / 指令 / 上传分片规划（复用 cloudspace）；
 *   B. 请求契约：GET /presence、POST /text、POST /cmd（同 drop 服务、X-Device-Id 鉴权）；
 *   C. 页面：app.json 注册 / 4 文件 / 分享三件套 / WXML handler / 未在线空态文案 / 无真实账号；
 *   D. pages/all 动态显示：presence 在线才 push「大屏互联」卡片，点击路由到 screencast；
 *   E. 文件云空间「下载后变打开」：cloudspace 页 opened 标记 + WXML 文案。
 *
 * 说明：纯 Node + 内存 wx mock；不发真实请求、不启动模拟器。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const HERE = __dirname;
const MP = path.resolve(HERE, '..'); // tests/ 已并入小程序仓库，上一级即小程序根目录
const REAL_SIDS = /3260707024|3260707001|3260707002|3260707003|3260707026|陈子麒/;

function src(rel) { return fs.readFileSync(path.join(MP, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(MP, rel)); }

async function run(outerTest) {
  const T = (typeof outerTest === 'function') ? function (name, fn) { return outerTest(name, fn); }
    : async function (name, fn) {
      try { await fn(); console.log('PASS  ' + name); } catch (e) { console.log('FAIL  ' + name + ' :: ' + e.message); throw e; }
    };

  if (!global.wx) global.wx = {};
  const localMem = {};
  if (!global.wx.setStorageSync) global.wx.setStorageSync = function (k, v) { localMem[k] = v; };
  if (!global.wx.getStorageSync) global.wx.getStorageSync = function (k) { return localMem[k] === undefined ? '' : localMem[k]; };
  const savedRequest = global.wx.request;
  const reqLog = [];
  global.wx.request = function (o) {
    reqLog.push(o);
    if (o && o.success) o.success({ statusCode: 200, data: { ok: true, stage: false, session: null, at: 0 } });
  };
  try {
    global.wx.setStorageSync('zq_class_identity', { token: 'tok-sc', sid: '3260799999', name: '测试账号', role: '', badge: '', is_admin: false, ts: 1 });
  } catch (e) {}
  const sc = require(path.join(MP, 'utils', 'screencast.js'));
  // 2026-11-17：正式版未配置 dropBase 时不再请求已暂停域名；请求契约用例显式配置测试基址。
  const cfg = require(path.join(MP, 'utils', 'cloud-config.js'));
  const savedDropBase = cfg.dropBase;
  cfg.dropBase = 'https://drop.test';

  // A. 指令定义 -----------------------------------------------------------
  await T('A1 遥控指令 11 项（聚焦×4/退出聚焦/计时×3/抽签/恢复全屏/关闭大屏）', function () {
    assert.strictEqual(sc.CMD_DEFS.length, 11);
    const keys = sc.CMD_DEFS.map(function (d) { return d.k; });
    ['focus_ppt', 'focus_vote', 'focus_timer', 'focus_draw', 'focus_clear',
      'timer_start', 'timer_pause', 'timer_reset', 'draw', 'restore_fs', 'stage_close'].forEach(function (k) {
      assert.ok(keys.indexOf(k) >= 0, k + ' missing');
    });
  });
  await T('A2 指令映射到 drop 白名单 op/args', function () {
    assert.strictEqual(sc.cmdDef('focus_ppt').op, 'focus');
    assert.strictEqual(sc.cmdDef('focus_ppt').args.panel, 'ppt');
    assert.strictEqual(sc.cmdDef('timer_start').op, 'timer');
    assert.strictEqual(sc.cmdDef('timer_start').args.action, 'start');
    assert.strictEqual(sc.cmdDef('stage_close').op, 'stage_close');
    assert.strictEqual(sc.cmdDef('bogus'), null);
  });
  await T('A3 空文字不发送（前端先拦）', function () {
    return sc.sendText('s1', '   ').then(function (r) {
      assert.strictEqual(r.ok, false);
      assert.ok(r.reason);
    });
  });

  // B. 请求契约 -----------------------------------------------------------
  await T('B1 presence：GET /presence（带 X-Device-Id）', function () {
    reqLog.length = 0;
    return sc.presence().then(function (r) {
      assert.strictEqual(r.stage, false);
      const q = reqLog[reqLog.length - 1];
      assert.ok(/\/presence$/.test(q.url), q.url);
      assert.strictEqual(q.method, 'GET');
      assert.strictEqual(q.header['X-Device-Id'], 'tok-sc');
    });
  });
  await T('B2 presence：stage=true 解析', function () {
    global.wx.request = function (o) { o.success({ statusCode: 200, data: { ok: true, stage: true, at: 123 } }); };
    return sc.presence().then(function (r) {
      assert.strictEqual(r.stage, true);
      assert.strictEqual(r.at, 123);
    });
  });
  await T('B3 sendText：POST /text {sessionId,text}', function () {
    reqLog.length = 0;
    global.wx.request = function (o) { reqLog.push(o); o.success({ statusCode: 200, data: { ok: true } }); };
    return sc.sendText('sess-1', '大屏你好').then(function () {
      const q = reqLog[reqLog.length - 1];
      assert.ok(/\/text$/.test(q.url), q.url);
      assert.strictEqual(q.method, 'POST');
      assert.deepStrictEqual(q.data, { sessionId: 'sess-1', text: '大屏你好' });
    });
  });
  await T('B4 sendCmd：POST /cmd {sessionId,op,args}', function () {
    reqLog.length = 0;
    return sc.sendCmd('sess-1', 'focus_vote').then(function () {
      const q = reqLog[reqLog.length - 1];
      assert.ok(/\/cmd$/.test(q.url), q.url);
      assert.deepStrictEqual(q.data, { sessionId: 'sess-1', op: 'focus', args: { panel: 'vote' } });
    });
  });
  await T('B5 未知指令不请求', function () {
    const n = reqLog.length;
    return sc.sendCmd('sess-1', 'rm_rf').then(function (r) {
      assert.strictEqual(reqLog.length, n);
      assert.strictEqual(r.ok, false);
    });
  });

  // C. 工程接线 -----------------------------------------------------------
  await T('C1 app.json 注册 pages/screencast/screencast', function () {
    const app = JSON.parse(src('app.json'));
    assert.ok(app.pages.indexOf('pages/screencast/screencast') >= 0);
  });
  await T('C2 页面 4 文件存在', function () {
    ['.js', '.wxml', '.json', '.wxss'].forEach(function (ext) {
      assert.ok(exists('pages/screencast/screencast' + ext), ext + ' missing');
    });
  });
  await T('C3 分享三件套 + 未在线空态文案', function () {
    const js = src('pages/screencast/screencast.js');
    const wxml = src('pages/screencast/screencast.wxml');
    assert.ok(js.indexOf('onShareAppMessage') >= 0);
    assert.ok(js.indexOf('onShareTimeline') >= 0);
    assert.ok(js.indexOf('share.enable()') >= 0);
    assert.ok(wxml.indexOf('当前没有设备开启大屏') >= 0);
    assert.ok(js.indexOf('screencast.presence()') >= 0);
  });
  await T('C4 WXML handler 都在页面 JS 中', function () {
    const wxml = src('pages/screencast/screencast.wxml');
    const js = src('pages/screencast/screencast.js');
    const re = /(?:bind|catch)[:]?[a-zA-Z]+="([A-Za-z_$][\w$]*)"/g;
    let m; const missing = [];
    while ((m = re.exec(wxml))) {
      if (!new RegExp('\\b' + m[1] + '\\s*[:(]').test(js)) missing.push(m[1]);
    }
    assert.deepStrictEqual(missing, []);
  });
  await T('C5 新增文件不含真实账号/姓名', function () {
    const all = src('pages/screencast/screencast.js') + src('pages/screencast/screencast.wxml') +
      src('utils/screencast.js');
    assert.ok(!REAL_SIDS.test(all), '发现真实账号/姓名');
  });

  // D. pages/all 动态显示 -------------------------------------------------
  await T('D1 全部工具按 presence 动态显示「大屏互联」', function () {
    const all = src('pages/all/all.js');
    assert.ok(all.indexOf('_checkScreencast') >= 0);
    assert.ok(all.indexOf("key: 'screencast'") >= 0);
    assert.ok(all.indexOf('if (this._stageOn)') >= 0);
    assert.ok(all.indexOf("key === 'screencast'") >= 0 || all.indexOf("=== 'screencast'") >= 0);
  });
  await T('D2 未开启大屏时不 push 该卡片（由 _stageOn 控制）', function () {
    const all = src('pages/all/all.js');
    assert.ok(/if \(this\._stageOn\) \{\s*all\.push/.test(all));
  });

  // E. 文件云空间：下载后变「打开」 ---------------------------------------
  await T('E1 cloudspace 页记录已打开并持久化', function () {
    const js = src('pages/cloudspace/cloudspace.js');
    assert.ok(js.indexOf('zq_mp_file_opened_v1') >= 0);
    assert.ok(js.indexOf('opened = true') >= 0);
    assert.ok(js.indexOf('_saveOpened') >= 0);
  });
  await T('E2 WXML 按 opened 显示「打开/下载」', function () {
    const wxml = src('pages/cloudspace/cloudspace.wxml');
    assert.ok(/item\.opened \? '打开' : '下载'/.test(wxml));
  });

  cfg.dropBase = savedDropBase;
  try {
    global.wx.request = savedRequest;
  } catch (e) {}
}

module.exports = { run: run };
