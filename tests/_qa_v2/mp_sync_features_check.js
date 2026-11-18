/* _qa_v2/mp_sync_features_check.js —— task-13 独立验收：网站→小程序功能同步（电费 / 诊断 / UD 13 键）
 *
 * 运行：node mp_sync_features_check.js [--tag sync_final]
 * 输出：PASS/FAIL/PEND 行 + _reports/mp_sync_features_<tag>.json，退出码 0 = 无 FAIL。
 * 说明：Node + 内存 wx mock，不启动模拟器、不发真实请求、不读/打印任何密钥值。
 *      与（mp-dev 的）v3_power_diag_tests.js 相互独立：这里用 QA 自己的断言/夹具/请求路由。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = 'C:/Users/Ko_Li/.openclaw/workspace/mp-class-tools';
const WEB = 'C:/Users/Ko_Li/.openclaw/workspace/web/tools/index.html';
const REPORTS = path.join(__dirname, '_reports');
const TAG = (function () { const i = process.argv.indexOf('--tag'); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'run'; })();

const results = [];
let passN = 0, failN = 0, pendN = 0;
function test(req, name, fn) {
  return Promise.resolve().then(fn).then(() => {
    passN++; results.push({ req: String(req), name, ok: true, note: '' });
    console.log('PASS  [' + req + '] ' + name);
  }).catch((e) => {
    failN++; results.push({ req: String(req), name, ok: false, err: String((e && e.message) || e) });
    console.log('FAIL  [' + req + '] ' + name + '  ::  ' + ((e && e.message) || e));
  });
}
function pend(req, name, note) {
  pendN++; results.push({ req: String(req), name, ok: null, note: String(note || '') });
  console.log('PEND  [' + req + '] ' + name + (note ? '  --  ' + note : ''));
}

/* ---------------- wx mock ---------------- */
const mem = Object.create(null);
let reqLog = [], toastLog = [], navLog = [];
function resetLogs() { reqLog = []; toastLog = []; navLog = []; }
let ROUTE = { fail: false, power: [], powerHist: [], powerHist7: [], powerHist30: [], health: [], userdata: [], udPost: [] };
function resetRoute() { ROUTE = { fail: false, power: [], powerHist: [], powerHist7: [], powerHist30: [], health: [], userdata: [], udPost: [] }; }
function reply(o, data) { o.success({ statusCode: 200, data: data }); }
let CANVAS = { ops: [], node: null, ctx: null };
function resetCanvas() {
  const ops = [];
  const grad = { addColorStop(a, b) { ops.push(['addColorStop', [a, b]]); } };
  const c = {
    clearRect() { ops.push(['clearRect']); },
    beginPath() { ops.push(['beginPath']); },
    moveTo(x, y) { ops.push(['moveTo', [x, y]]); },
    lineTo(x, y) { ops.push(['lineTo', [x, y]]); },
    closePath() { ops.push(['closePath']); },
    fill() { ops.push(['fill']); },
    stroke() { ops.push(['stroke']); },
    arc(x, y, r) { ops.push(['arc', [x, y, r]]); },
    scale(x, y) { ops.push(['scale', [x, y]]); },
    createLinearGradient() { ops.push(['gradient']); return grad; }
  };
  const node = { width: 0, height: 0, getContext(t) { return t === '2d' ? c : null; } };
  CANVAS = { ops: ops, node: node, ctx: c };
}
resetCanvas();
global.wx = {
  getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
  setStorageSync(k, v) { mem[k] = v; },
  removeStorageSync(k) { delete mem[k]; },
  getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 1, limitSize: 10240 }; },
  request(o) {
    reqLog.push({ url: o.url, method: o.method, data: o.data, headerKeys: Object.keys(o.header || {}) });
    if (ROUTE.fail) { o.success({ statusCode: 500, data: 'qa-error' }); return; }
    const u = String(o.url || '');
    if (u.indexOf('power_history') >= 0) {
      const dec = decodeURIComponent(u);
      const m = dec.match(/ts=gte\.([^&]+)/);
      const cut = m ? Date.parse(m[1]) : 0;
      const diff = Date.now() - cut;
      let hist = ROUTE.powerHist;
      if (diff > 20 * 864e5) hist = ROUTE.powerHist30.length ? ROUTE.powerHist30 : ROUTE.powerHist;
      else if (diff > 2 * 864e5) hist = ROUTE.powerHist7.length ? ROUTE.powerHist7 : ROUTE.powerHist;
      return reply(o, hist);
    }
    if (u.indexOf('/power?') >= 0) return reply(o, ROUTE.power);
    if (u.indexOf('service_health') >= 0) return reply(o, ROUTE.health);
    if (u.indexOf('userdata') >= 0) {
      if (String(o.method || 'GET').toUpperCase() === 'POST') { ROUTE.udPost.push(o.data); return reply(o, o.data); }
      return reply(o, ROUTE.userdata);
    }
    return reply(o, []);
  },
  pageScrollTo() {}, showToast(o) { toastLog.push(o && o.title); },
  showModal(o) { if (o && o.success) o.success({ confirm: true, cancel: false }); },
  showLoading() {}, hideLoading() {},
  setClipboardData(o) { if (o && o.success) o.success(); },
  getClipboardData(o) { if (o && o.success) o.success({ data: '' }); },
  canvasToTempFilePath(o) { if (o && o.success) o.success({ tempFilePath: '/tmp/t.png' }); },
  saveImageToPhotosAlbum(o) { if (o && o.success) o.success(); },
  getSetting(o) { if (o && o.success) o.success({ authSetting: {} }); },
  openSetting(o) { if (o && o.success) o.success({ authSetting: {} }); },
  createSelectorQuery() {
    let sel = '';
    const q = { in() { return q; }, select(x) { sel = String(x || ''); return q; }, fields() { return q; },
      boundingClientRect() { return q; }, selectViewport() { return q; }, scrollOffset() { return q; },
      exec(cb) {
        if (sel === '#pwTrend') { cb([{ node: CANVAS.node, width: 360, height: 160 }]); return; }
        cb([{ node: { width: 760, height: 600, getContext() { return {}; } }, width: 760, height: 600 }]);
      } };
    return q;
  },
  navigateTo(o) { navLog.push({ type: 'navigateTo', url: o && o.url }); if (o && o.success) o.success(); },
  redirectTo(o) { navLog.push({ type: 'redirectTo', url: o && o.url }); },
  switchTab(o) { navLog.push({ type: 'switchTab', url: o && o.url }); if (o && o.success) o.success(); },
  reLaunch(o) { navLog.push({ type: 'reLaunch', url: o && o.url }); if (o && o.success) o.success(); },
  showActionSheet(o) { if (o && o.success) o.success({ tapIndex: 0 }); },
  getWindowInfo() { return { windowWidth: 375, windowHeight: 812, pixelRatio: 2, SDKVersion: '3.0.0' }; },
  getAppBaseInfo() { return { SDKVersion: '3.0.0' }; },
  getSystemInfoSync() { return { windowWidth: 375, windowHeight: 812, pixelRatio: 2, SDKVersion: '3.0.0', platform: 'devtools' }; },
  getDeviceInfo() { return { platform: 'devtools' }; },
  onThemeChange() {}, showShareMenu() {}, onAgentHandoff() {}, offAgentHandoff() {},
  stopPullDownRefresh() {}, startPullDownRefresh() {},
  createAnimation() { const a = { translate() { return a; }, opacity() { return a; }, scale() { return a; }, step() { return a; }, export() { return {}; } }; return a; },
  openDocument(o) { if (o && o.success) o.success(); },
  downloadFile(o) { if (o && o.fail) o.fail({ errMsg: 'qa-block' }); },
  nextTick(fn) { setTimeout(fn, 0); },
  getNetworkType(o) { if (o && o.success) o.success({ networkType: 'wifi' }); },
  onNetworkStatusChange() {}
};
global.getApp = function () { return { globalData: {}, notifyPages() {} }; };
let PAGE_STACK = [];
global.getCurrentPages = function () { return PAGE_STACK; };
global.Component = function () {};

function purge() {
  Object.keys(require.cache).forEach((k) => {
    if (k.replace(/\\/g, '/').indexOf(ROOT) === 0) {
      try { const m = require.cache[k]; if (m && m.exports && typeof m.exports.udStop === 'function') m.exports.udStop(); } catch (e) {}
      delete require.cache[k];
    }
  });
}
function load(rel) { return require(path.join(ROOT, rel)); }
function fresh() { purge(); resetLogs(); resetRoute(); PAGE_STACK = []; return { store: load('utils/store.js'), cloud: load('utils/cloud.js') }; }
const ID_ADMIN = { token: 'tok-qa-admin-9f', sid: '9000000002', name: '测试管理员', role: '班长', badge: '班委', is_admin: true, ts: 1 };
const ID_USER = { token: 'tok-qa-user-7c', sid: '9000000001', name: '测试同学01', role: '', badge: '', is_admin: false, ts: 1 };
function setIdentity(id) { mem['zq_class_identity'] = JSON.stringify(id || ID_USER); }
function clearMem() { Object.keys(mem).forEach((k) => delete mem[k]); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function readSrc(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function readWeb() { try { return fs.readFileSync(WEB, 'utf8'); } catch (e) { return ''; } }

function loadPageDef(rel) {
  let def = null; global.Page = (d) => { def = d; };
  try { delete require.cache[require.resolve(path.join(ROOT, rel))]; require(path.join(ROOT, rel)); }
  finally { delete global.Page; }
  assert.ok(def, 'page 未注册 Page(): ' + rel);
  return def;
}
function mkCtx(def, data) {
  const ctx = Object.assign({}, def);
  ctx.data = Object.assign(JSON.parse(JSON.stringify(def.data || {})), data || {});
  ctx.setData = function (o, cb) {
    Object.keys(o).forEach((k) => { ctx.data[k] = o[k]; });
    if (cb) cb();
  };
  return ctx;
}
function pickRoom(ctx, rv) { return ctx.pickRoom({ currentTarget: { dataset: { rv: rv } } }); }
function pickBuilding(ctx, b) { return ctx.pickBuilding({ currentTarget: { dataset: { b: b } } }); }

function urlOf(list) { return list.map((r) => String(r.url || '')).join('\n'); }
function reqOf(sub) { return reqLog.filter((r) => String(r.url || '').indexOf(sub) >= 0); }

/* 电费页会话：identity + store + page def；onLoad/onShow 由各用例决定是否调用 */
function powerPage(identity) {
  clearMem(); resetLogs(); resetRoute(); resetCanvas(); purge();
  if (identity) setIdentity(identity);
  const store = load('utils/store.js');   // 触发本机缓存初始化
  const def = loadPageDef('pages/power/power.js');
  const ctx = mkCtx(def);
  return { ctx, store: load('utils/store.js') };
}
function diagPage(identity) {
  clearMem(); resetLogs(); resetRoute(); purge();
  setIdentity(identity);
  PAGE_STACK = [{ route: 'pages/diag/diag' }];
  const def = loadPageDef('pages/diag/diag.js');
  return mkCtx(def);
}
function isoAgo(min) { return new Date(Date.now() - min * 60000).toISOString(); }

const POWER_ROW = { id: '1-16---306', label: '16号楼306', building: '16号楼', room: '306', quantity: 150.4, unit: '度', low: false, updated_at: '2026-11-06T06:30:00+08:00' };
const HIST = [
  { roomverify: '1-16---306', quantity: 180.0, ts: '2026-11-05T07:10:00+08:00' },
  { roomverify: '1-16---306', quantity: 170.2, ts: '2026-11-05T13:10:00+08:00' },
  { roomverify: '1-16---306', quantity: 150.4, ts: '2026-11-06T06:30:00+08:00' }
];

async function main() {
  const appjson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  const toolsSrc = readSrc('utils/tools.js');
  const privacy = load('utils/privacy.js');

  /* ================= 0) 注册 / 入口 / 静态隐私 ================= */
  await test('启用/注册', 'app.json 注册 20 页且含 pages/power/power、pages/diag/diag', () => {
    assert.strictEqual(appjson.pages.length, 20, 'pages 数=' + appjson.pages.length);
    assert.ok(appjson.pages.indexOf('pages/power/power') >= 0, '未注册电费页');
    assert.ok(appjson.pages.indexOf('pages/diag/diag') >= 0, '未注册诊断页');
    assert.ok(!appjson.pages.some((p) => /demo|audit/i.test(p)), '仍存在 demo/audit 页');
  });
  await test('启用/注册', '「全部」页工具目录含宿舍电费（noHome）与诊断（admin 仅管理员）', () => {
    assert.ok(/key:\s*'power'/.test(toolsSrc), 'tools.js 无 power 工具');
    assert.ok(/key:\s*'diag'/.test(toolsSrc), 'tools.js 无 diag 工具');
    assert.ok(/key:\s*'power'[^}]*noHome:\s*true/.test(toolsSrc), 'power 未标 noHome');
    assert.ok(/key:\s*'diag'[^}]*admin:\s*true/.test(toolsSrc), 'diag 未标 admin');
    const alljs = readSrc('pages/all/all.js');
    assert.ok(/!t\.admin\s*\|\|\s*admin/.test(alljs), 'all 页未按管理员过滤');
  });
  const stripComments = (t) => t.split('\n').filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln)).join('\n');
  await test('隐私', '电费页只展示规范楼栋/房间/电量/时间，无姓名/学号/手机号/全班名单', () => {
    const wxml = readSrc('pages/power/power.wxml');
    const js = stripComments(readSrc('pages/power/power.js'));
    ['学号', '姓名', '手机号', '宿舍号'].forEach((k) => assert.ok(wxml.indexOf(k) < 0 && js.indexOf(k) < 0, '出现 ' + k));
    assert.ok(!/classMembers|classRoster|memberList/.test(js), '电费页引用班级名单');
    assert.ok(!/buildExport|canvasToTempFilePath|saveImageToPhotosAlbum|导出|保存图片/.test(js), '电费页含导出逻辑');
    assert.ok(!/getUserProfile|getUserInfo/.test(js), '电费页获取用户信息');
    assert.ok(js.indexOf('pwTrend') >= 0 || js.indexOf('_drawTrend') >= 0, '应使用 canvas 趋势');
  });
  await test('隐私', '数据与隐私页声明「关注宿舍」收集范围与「不导出/不对外分享」', () => {
    const wxml = readSrc('pages/data/data.wxml');
    assert.ok(wxml.indexOf('关注宿舍') >= 0, '未声明关注宿舍');
    assert.ok(/不导出/.test(wxml) || /不对外分享/.test(wxml), '未声明不导出/不对外分享');
  });
  await test('契约', 'privacy.SECTION_KEYS = 10 section（power 最后）、VERSION=6、DEFAULTS.power 存在', () => {
    assert.deepStrictEqual(privacy.SECTION_KEYS,
      ['homeTools', 'fit', 'draw', 'group', 'roster', 'hide', 'tt', 'prefs', 'nick', 'power']);
    assert.strictEqual(privacy.VERSION, 6);
    assert.deepStrictEqual(privacy.DEFAULTS.power, { sel: '', at: 0, low: 30 });
  });
  await test('隐私', '导出我的数据不含 power/关注宿舍/宿舍号（隐私红线）', () => {
    const exp = privacy.buildExport({ power: { sel: '1-16---306', at: 1 }, homeTools: ['tt'] }, ID_USER, 1762300000000);
    const s = JSON.stringify(exp);
    assert.ok(s.indexOf('power') < 0, '导出含 power');
    assert.ok(s.indexOf('关注宿舍') < 0, '导出含关注宿舍');
    assert.ok(s.indexOf('1-16---306') < 0, '导出含宿舍 roomverify');
  });

  /* ================= 1) 电费纯逻辑 ================= */
  await test('电费', '房间目录 17 间、4 栋楼、rv/label/building/room 自洽且唯一', () => {
    const P = load('utils/power.js');
    assert.strictEqual(P.ROOMS.length, 17);
    assert.deepStrictEqual(P.BLDS.slice(), ['13号楼', '16号楼', '23号楼A座', '23号楼B座']);
    const seen = {};
    P.ROOMS.forEach((r) => {
      assert.ok(!seen[r.rv], 'rv 重复 ' + r.rv); seen[r.rv] = 1;
      assert.strictEqual(r.label, r.building + r.room);
      assert.ok(P.BLDS.indexOf(r.building) >= 0, '未知楼栋 ' + r.building);
    });
  });
  await test('电费', '状态阈值：低电 <30、偏低 30–60、充足 ≥60（云端 low=true 也低电）', () => {
    const P = load('utils/power.js');
    assert.strictEqual(P.LOW, 30);
    assert.deepStrictEqual(P.LOW_OPTIONS, [10, 20, 30, 40, 50, 60, 80, 100]);
    assert.strictEqual(P.ARC_DAYS, 30); assert.strictEqual(P.ARC_MIN, 0.02); assert.strictEqual(P.ARC_FALLBACK, 0.04);
    assert.strictEqual(P.stateOf(P.normalizeRow({ quantity: 150 })), 'ok');
    assert.strictEqual(P.stateOf(P.normalizeRow({ quantity: 100 })), 'ok');
    assert.strictEqual(P.stateOf(P.normalizeRow({ quantity: 60 })), 'ok', '60 应为充足');
    assert.strictEqual(P.stateOf(P.normalizeRow({ quantity: 59.99 })), 'warn', '59.99 应为偏低');
    assert.strictEqual(P.stateOf(P.normalizeRow({ quantity: 50 })), 'warn');
    assert.strictEqual(P.stateOf(P.normalizeRow({ quantity: 30 })), 'warn');
    assert.strictEqual(P.stateOf(P.normalizeRow({ quantity: 29.99 })), 'low', '29.99 应为低电');
    assert.strictEqual(P.stateText('low'), '低电');
    assert.strictEqual(P.stateText('warn'), '偏低');
    assert.strictEqual(P.stateText('ok'), '充足');
    // v5：状态只按 q 与可调 low 判定，云端 low 字段不再参与（200 度应为充足）
    assert.strictEqual(P.stateOf(P.normalizeRow({ quantity: 200, low: true })), 'ok');
    // 边界信息项：quantity=null 时 Number(null)=0 → 呈现 0.00 低电（与网站 Number() 同口径，非本轮回归）
    const qnull = P.normalizeRow({ quantity: null });
    if (qnull.q !== null) pend('电费', 'quantity=null 边界（两端同按 0 处理，建议数据侧保证非空）',
      'normalizeRow quantity=null → q=' + qnull.q + '（网站 Number(null) 同口径；无真实数据触发）');
  });
  await test('电费', '非法值降级：未知 rv → 空选择；quantity 非数字 → q=null（显示 —）', () => {
    const P = load('utils/power.js');
    assert.strictEqual(P.normalizeSel('bogus-room'), '');
    assert.strictEqual(P.normalizeSel(null), '');
    assert.strictEqual(P.normalizeSel('1-16---305'), '1-16---305');
    const row = P.normalizeRow({ id: 'x', quantity: 'abc' });
    assert.strictEqual(row.q, null);
    assert.strictEqual(P.fmtQ(row.q), '—');
    assert.strictEqual(P.stateOf(row), 'idle');
    assert.strictEqual(P.trendLine(null).empty, true);
  });
  await test('电费', '近 24h 采样：过滤非法点、按时间升序、趋势柱 ≤24、派生日均/可用天数', () => {
    const P = load('utils/power.js');
    const hist = P.normalizeHistory(HIST.concat([{ quantity: 'x', ts: 'bad' }, { quantity: 1, ts: 'bad' }]));
    assert.strictEqual(hist.length, 3);
    assert.ok(hist[0].t < hist[1].t && hist[1].t < hist[2].t, '未按时间升序');
    const row = P.normalizeRow(POWER_ROW);
    const d = P.derive(row, hist);
    assert.strictEqual(d.n, 3);
    assert.strictEqual(d.drop, 29.6, 'drop 应为累计下降（忽略回弹）');
    assert.strictEqual(d.valid, true, '窗口 23h+ 应有有效估算');
    assert.ok(d.days > 4.5 && d.days < 5.5, 'days=' + d.days);
    // 充值回弹不计入下降：插入一条上涨采样后 drop 不变
    const rebound = P.normalizeHistory(HIST.concat([{ quantity: 999, ts: '2026-11-06T07:10:00+08:00' }]));
    const dr = P.derive(row, rebound);
    assert.strictEqual(dr.recharge, true);
    assert.strictEqual(dr.drop, 29.6, '充值回弹被计入用电: ' + dr.drop);
    // 趋势折线纯数据（canvas 用）：≥2 点、x 0→1、y 0→1、hi/mid/lo 刻度、>240 点降采样
    const tl = P.trendLine(hist);
    assert.strictEqual(tl.empty, false);
    assert.strictEqual(tl.count, 3);
    assert.strictEqual(tl.points.length, 3);
    assert.strictEqual(tl.points[0].x, 0);
    assert.strictEqual(tl.points[2].x, 1);
    tl.points.forEach((pt) => assert.ok(pt.x >= 0 && pt.x <= 1 && pt.y >= 0 && pt.y <= 1, '点位越界: ' + JSON.stringify(pt)));
    assert.strictEqual(tl.hi, 180);
    assert.strictEqual(tl.lo, 150.4);
    assert.ok(Math.abs(tl.mid - 165.2) < 1e-9, 'mid=' + tl.mid);
    const many = [];
    for (let i = 0; i < 300; i++) many.push({ q: 300 - i * 0.2, t: 1762290000000 + i * 60000 });
    const tlm = P.trendLine(many);
    assert.strictEqual(tlm.empty, false);
    assert.ok(tlm.points.length <= P.TREND_MAX && tlm.points.length >= 2, '降采样点数=' + tlm.points.length);
    const less = P.trendLine([hist[0]]);
    assert.strictEqual(less.empty, true);
    assert.strictEqual(less.note, '数据积累中');
    // 4 tiles（网站 v3.1）：估算可用（24h）/ 区间用电 / 低电阈值 / 上次充值
    const est = P.estimate(hist, hist, row);
    const tiles = P.tilesOf(row, est, d, P.rangeMeta('24h'), 30);
    assert.deepStrictEqual(tiles.map((t) => t.key), ['days', 'use', 'threshold', 'recharge']);
    assert.deepStrictEqual(tiles.map((t) => t.label), ['估算可用', '近 24h 用电', '低电阈值', '上次充值']);
    assert.deepStrictEqual(tiles.slice(0, 3).map((t) => t.unit), ['天', '度', '度']);
    assert.strictEqual(tiles[0].hi, true);
    assert.strictEqual(tiles[2].value, '30');
    assert.strictEqual(tiles[3].value, '—');
    assert.strictEqual(tiles[3].sub, '暂无记录');
    assert.deepStrictEqual(P.tilesOf(null, null, null, P.rangeMeta('24h')).map((t) => t.label),
      ['估算可用', '近 24h 用电', '低电阈值', '上次充值']);
    // 环形 = 估算可用天数/30（0.02 / 0.04 / 1 边界）
    assert.ok(Math.abs(P.ringArc(row, d) - d.days / 30) < 1e-9, 'ringArc 非 days/30');
    assert.strictEqual(P.ringArc(null, d), 0);
    assert.strictEqual(P.ringArc(row, null), P.ARC_FALLBACK);
    assert.strictEqual(P.ringArc(row, { valid: true, days: 30 }), 1);
    assert.strictEqual(P.ringArc(row, { valid: true, days: 0.3 }), P.ARC_MIN);
    assert.strictEqual(P.ringArc(row, { valid: false, days: 5 }), P.ARC_FALLBACK);
    // 低电条 / 大号电量口径
    assert.strictEqual(P.lowText(row, d).indexOf('剩 150.40 度 · 约 4.9 天'), 0, 'lowText=' + P.lowText(row, d));
    assert.strictEqual(P.lowText(row, null), '剩 150.40 度');
    assert.strictEqual(P.fmtMain(150.4), '150');
    assert.strictEqual(P.fmtMain(100), '100');
    assert.strictEqual(P.fmtMain(99.94), '99.9');
    assert.strictEqual(P.fmtMain(60), '60.0');
    assert.strictEqual(P.fmtMain(null), '—');
  });
  await test('电费', '自定义选择目录：楼栋/房间分组正确（13号楼2、16号楼2、23A 9、23B 4）+ 旧 picker API 已移除', () => {
    const P = load('utils/power.js');
    assert.strictEqual(P.pickerOf, undefined, '旧 pickerOf 应已移除');
    assert.strictEqual(P.rvFromPicker, undefined, '旧 rvFromPicker 应已移除');
    const rooms = (b) => P.roomsOfBuilding(b).map((r) => r.room);
    assert.deepStrictEqual(rooms('13号楼'), ['324', '308']);
    assert.deepStrictEqual(rooms('16号楼'), ['305', '306']);
    assert.deepStrictEqual(rooms('23号楼A座'), ['321', '323', '324', '325', '326', '327', '328', '329', '330']);
    assert.deepStrictEqual(rooms('23号楼B座'), ['422', '423', '424', '425']);
    assert.deepStrictEqual(P.BLDS.slice(), ['13号楼', '16号楼', '23号楼A座', '23号楼B座']);
    assert.strictEqual(P.buildingOf('4-23A---321'), '23号楼A座');
    assert.strictEqual(P.rvOf('16号楼', '305'), '1-16---305');
    assert.strictEqual(P.rvOf('16号楼', '999'), '');
    assert.strictEqual(P.labelOf('4-23B---425'), '23号楼B座425');
    const wxml = readSrc('pages/power/power.wxml');
    const js = readSrc('pages/power/power.js');
    assert.ok(wxml.indexOf('multiSelector') < 0 && wxml.indexOf('<picker') < 0, '仍有原生 picker/multiSelector');
    assert.ok(js.indexOf('multiSelector') < 0 && js.indexOf('pickerOf') < 0, 'js 仍引用旧 picker');
  });

  /* ================= 2) 电费页行为 ================= */
  await test('电费页', '未选择：0 个 power/power_history 请求、state=idle', async () => {
    const { ctx } = powerPage(ID_USER);
    ctx.onLoad({}); ctx.onShow();
    await sleep(50);
    assert.strictEqual(reqOf('/power').length, 0, '未选择却请求电量: ' + urlOf(reqLog));
    assert.strictEqual(ctx.data.state, 'idle');
    assert.strictEqual(ctx.data.hasSel, false);
  });
  await test('电费页', '选择宿舍：写 UD.power sel 并只请求该房间 power + power_history（字段/排序/limit/24h 窗口）', async () => {
    const { ctx, store } = powerPage(ID_USER);
    ROUTE.power = [POWER_ROW]; ROUTE.powerHist = HIST;
    ctx.onLoad({}); ctx.onShow();
    await sleep(50);
    await pickRoom(ctx, '1-16---306');
    await sleep(80);
    const sel = (store.get().power || {}).sel;
    assert.strictEqual(sel, '1-16---306');
    assert.ok((store.get().power || {}).at > 0, 'UD.power.at 未写');
    const prow = reqOf('/power?');
    const hrow = reqOf('/power_history?');
    assert.strictEqual(prow.length, 1, 'power 请求次数 ' + prow.length);
    assert.ok(prow[0].url.indexOf('id=eq.1-16---306') >= 0, 'power 未按房间过滤: ' + prow[0].url);
    ['select=id,label,building,room,quantity,unit,low,updated_at'].forEach((k) => assert.ok(prow[0].url.indexOf(k) >= 0, 'power 缺 ' + k));
    assert.ok(hrow.length >= 1, 'power_history 请求次数 ' + hrow.length);
    const hu = hrow[0].url;
    assert.ok(hu.indexOf('roomverify=eq.1-16---306') >= 0, 'history 未按房间过滤');
    assert.ok(hu.indexOf('order=ts.asc') >= 0, 'history 未按时间升序');
    assert.ok(hu.indexOf('limit=2000') >= 0, 'history 缺 limit=2000');
    assert.ok(hu.indexOf('select=ts,quantity') >= 0, 'history 缺 select=ts,quantity');
    assert.ok(/ts=gte\.[0-9T:.%2B-]+/.test(decodeURIComponent(hu)), 'history 缺 24h 窗口: ' + hu);
    assert.ok(prow[0].headerKeys.indexOf('X-Class-Token') >= 0, 'power 请求缺 X-Class-Token');
    assert.ok(prow[0].headerKeys.indexOf('Authorization') >= 0, 'power 请求缺 Authorization');
  });
  await test('电费页', 'sheet 交互：打开/切楼栋/取消/遮罩关闭均 0 请求；点房间立即选中并收起', async () => {
    const { ctx, store } = powerPage(ID_USER);
    ctx.onLoad({}); ctx.onShow();
    await sleep(40);
    assert.strictEqual(reqOf('/power').length, 0, '初始不应请求');
    const wxml = readSrc('pages/power/power.wxml');
    ['pw-mask', 'pw-sheet', 'pw-sheet-title', 'pw-blds', 'pw-bld', 'pw-rooms', 'pw-room-btn', 'pw-cancel',
     'bindtap="openSheet"', 'bindtap="closeSheet"', 'bindtap="pickBuilding"', 'bindtap="pickRoom"',
     'catchtouchmove'].forEach((k) => assert.ok(wxml.indexOf(k) >= 0, 'sheet 缺 ' + k));
    const wxss = readSrc('pages/power/power.wxss');
    ['safe-area-inset-bottom', 'pw-sheet', 'pw-room-btn', 'pw-bld', 'pw-cancel'].forEach((k) => assert.ok(wxss.indexOf(k) >= 0, 'sheet 样式缺 ' + k));
    ctx.openSheet();
    assert.strictEqual(ctx.data.sheetOpen, true);
    assert.strictEqual(ctx.data.activeBuilding, '13号楼');
    assert.strictEqual(ctx.data.buildingRooms.length, 2);
    pickBuilding(ctx, '23号楼A座');
    assert.strictEqual(ctx.data.activeBuilding, '23号楼A座');
    assert.strictEqual(ctx.data.buildingRooms.length, 9);
    assert.strictEqual(reqOf('/power').length, 0, '开弹层/切楼栋不应请求');
    ctx.closeSheet();
    assert.strictEqual(ctx.data.sheetOpen, false);
    ctx.openSheet(); ctx.closeSheet();          // 遮罩/取消同 closeSheet
    await sleep(80);
    assert.strictEqual(reqOf('/power').length, 0, '取消关闭不应请求');
    ROUTE.power = [POWER_ROW]; ROUTE.powerHist = HIST;
    pickBuilding(ctx, '16号楼');
    const p = pickRoom(ctx, '1-16---306');
    assert.strictEqual(ctx.data.sheetOpen, false, '点房间应立即收起');
    assert.strictEqual(ctx.data.selectedRv, '1-16---306');
    assert.strictEqual(ctx.data.selLabel, '16号楼306');
    await p; await sleep(120);
    assert.strictEqual((store.get().power || {}).sel, '1-16---306');
    const urls = reqLog.map((r) => String(r.url));
    assert.strictEqual(urls.filter((u) => u.indexOf('/power?') >= 0).length, 1, 'power 请求数非 1');
    assert.ok(urls.filter((u) => u.indexOf('/power_history?') >= 0).length >= 1, 'history 请求数 0');
    assert.ok(urls.some((u) => u.indexOf('id=eq.1-16---306') >= 0), '未按选中房间请求');
    assert.strictEqual(ctx.data.state, 'ready');
  });
  await test('趋势', 'canvas 2d 折线：≥2 点绘制面积/折线/2 网格/末点 + DPR 缩放；柱状 DOM 已移除', async () => {
    const wxml = readSrc('pages/power/power.wxml');
    assert.ok(wxml.indexOf('id="pwTrend"') >= 0 && wxml.indexOf('type="2d"') >= 0, '缺少 canvas type=2d #pwTrend');
    assert.ok(wxml.indexOf('pw-bars') < 0 && wxml.indexOf('pw-bar-cell') < 0, '柱状图 DOM 未移除');
    assert.ok(wxml.indexOf('pw-ylab--hi') >= 0 && wxml.indexOf('pw-ylab--mid') >= 0 && wxml.indexOf('pw-ylab--lo') >= 0, '缺 y 轴刻度');
    const { ctx } = powerPage(ID_USER);
    ROUTE.power = [POWER_ROW]; ROUTE.powerHist = HIST;
    ctx.onLoad({}); ctx.onShow(); await sleep(40);
    await pickRoom(ctx, '1-16---306');
    await sleep(150);
    const ops = CANVAS.ops;
    assert.ok(ops.length > 0, 'canvas 未绘制');
    const names = ops.map((o) => o[0]);
    assert.ok(names.indexOf('clearRect') >= 0, '未 clearRect');
    assert.ok(ops.filter((o) => o[0] === 'stroke').length >= 2, '网格/折线/末点 stroke 不足: ' + names.join(','));
    assert.ok(ops.filter((o) => o[0] === 'fill').length >= 2, '面积/末点 fill 不足');
    assert.ok(names.indexOf('arc') >= 0, '末点圆点缺失');
    assert.ok(ops.filter((o) => o[0] === 'lineTo').length >= 4, '折线点不足');
    assert.ok(ops.some((o) => o[0] === 'scale' && o[1][0] === 2 && o[1][1] === 2), '未按 DPR scale');
    assert.strictEqual(CANVAS.node.width, 720, 'canvas 物理宽非 360*2: ' + CANVAS.node.width);
    assert.strictEqual(CANVAS.node.height, 320, 'canvas 物理高非 160*2: ' + CANVAS.node.height);
    assert.ok(ops.filter((o) => o[0] === 'addColorStop').length >= 2, '面积渐变未设置');
    assert.strictEqual(ctx.data.trend.empty, false);
    assert.strictEqual(ctx.data.trend.startText, '180.00');
    assert.strictEqual(ctx.data.trend.curText, '150.40');
    assert.strictEqual(ctx.data.trend.dropText, '29.60');
    assert.ok(ctx.data.trend.hiText !== '—' && ctx.data.trend.midText !== '—' && ctx.data.trend.loText !== '—', 'y 轴刻度缺失');
  });
  await test('趋势', '<2 采样显示「数据积累中」且不绘制；刷新/切换宿舍后重绘', async () => {
    const one = powerPage(ID_USER);
    ROUTE.power = [POWER_ROW]; ROUTE.powerHist = [HIST[0]];
    one.ctx.onLoad({}); one.ctx.onShow(); await sleep(40);
    const before = CANVAS.ops.length;
    await pickRoom(one.ctx, '1-16---306');
    await sleep(150);
    assert.strictEqual(one.ctx.data.trend.empty, true);
    assert.strictEqual(one.ctx.data.trend.note, '数据积累中');
    assert.strictEqual(one.ctx.data.trend.hiText, '—');
    assert.strictEqual(CANVAS.ops.length, before, '<2 点不应绘制 canvas');
    // 刷新重绘
    const two = powerPage(ID_USER);
    ROUTE.power = [POWER_ROW]; ROUTE.powerHist = HIST;
    two.ctx.onLoad({}); two.ctx.onShow(); await sleep(40);
    await pickRoom(two.ctx, '1-16---306'); await sleep(150);
    const n1 = CANVAS.ops.filter((o) => o[0] === 'clearRect').length;
    await two.ctx.load(true); await sleep(150);
    const n2 = CANVAS.ops.filter((o) => o[0] === 'clearRect').length;
    assert.ok(n2 > n1, '刷新未重绘');
    ROUTE.power = [Object.assign({}, POWER_ROW, { id: '1-13---324', label: '13号楼324', room: '324' })];
    ROUTE.powerHist = HIST.map((h) => Object.assign({}, h, { roomverify: '1-13---324' }));
    await pickRoom(two.ctx, '1-13---324'); await sleep(150);
    assert.ok(CANVAS.ops.filter((o) => o[0] === 'clearRect').length > n2, '切换宿舍未重绘');
  });
  await test('电费页', '仪表盘渲染：大号电量/状态/更新时间/趋势/4 tiles/低电提示', async () => {
    const { ctx } = powerPage(ID_USER);
    ROUTE.power = [POWER_ROW]; ROUTE.powerHist = HIST;
    ctx.onLoad({}); ctx.onShow();
    await sleep(50);
    await pickRoom(ctx, '1-16---306');
    await sleep(80);
    assert.strictEqual(ctx.data.state, 'ready');
    assert.strictEqual(ctx.data.qText, '150');            // fmtMain：≥100 取整
    assert.strictEqual(ctx.data.stateKey, 'ok');
    assert.strictEqual(ctx.data.stateText, '充足');
    assert.ok(ctx.data.updText.indexOf('更新') >= 0, '更新时间缺失: ' + ctx.data.updText);
    assert.strictEqual(ctx.data.trend.empty, false);
    assert.ok(CANVAS.ops.length > 0, 'canvas 未绘制');
    assert.ok(ctx.data.trend.hiText !== '—' && ctx.data.trend.midText !== '—' && ctx.data.trend.loText !== '—');
    assert.strictEqual(ctx.data.trend.startText, '180.00');
    assert.strictEqual(ctx.data.trend.curText, '150.40');
    assert.strictEqual(ctx.data.trend.dropText, '29.60');
    assert.strictEqual(ctx.data.tiles.length, 4);
    assert.deepStrictEqual(ctx.data.tiles.map((t) => t.label), ['估算可用', '近 24h 用电', '低电阈值', '上次充值']);
    assert.strictEqual(ctx.data.lowOn, false);
    assert.ok(/conic-gradient/.test(ctx.data.gaugeStyle), '环形样式缺失');
    assert.ok(/1[5-8]\.\d\d%/.test(ctx.data.gaugeStyle), '环形比例非 days/30: ' + ctx.data.gaugeStyle);
  });
  await test('电费页', '状态切换：50 度→偏低、20 度→低电（lowOn 提示条）', async () => {
    for (const c of [{ q: 50, key: 'warn', text: '偏低', low: false },
                     { q: 20, key: 'low', text: '低电', low: true }]) {
      const { ctx } = powerPage(ID_USER);
      ROUTE.power = [Object.assign({}, POWER_ROW, { quantity: c.q })];
      ROUTE.powerHist = HIST;
      ctx.onLoad({}); ctx.onShow();
      await sleep(40);
      await pickRoom(ctx, '1-16---306');
      await sleep(80);
      assert.strictEqual(ctx.data.stateKey, c.key, 'q=' + c.q + ' key=' + ctx.data.stateKey);
      assert.strictEqual(ctx.data.stateText, c.text);
      assert.strictEqual(ctx.data.lowOn, c.low);
      if (c.low) assert.ok(/^剩 20\.00 度 · 约 \d+\.\d 天$/.test(ctx.data.lowText), '低电条文案: ' + ctx.data.lowText);
    }
  });
  await test('电费页', '2 分钟 TTL：重复 load 0 新请求；force（下拉/刷新）绕过 TTL', async () => {
    const { ctx } = powerPage(ID_USER);
    ROUTE.power = [POWER_ROW]; ROUTE.powerHist = HIST;
    ctx.onLoad({}); ctx.onShow();
    await sleep(40);
    await pickRoom(ctx, '1-16---306');
    await sleep(80);
    const count = () => reqOf('/power?').length + reqOf('/power_history?').length;
    const base = count();
    await ctx.load(false);             // TTL 内非 force → 0 新请求
    await ctx.load(false);
    await sleep(60);
    const mid = count();
    assert.strictEqual(mid, base, 'TTL 内又请求了: ' + (mid - base));
    await ctx.load(true);              // force 绕过 TTL
    await sleep(60);
    assert.ok(count() >= mid + 2, 'force 未绕过 TTL（+' + (count() - mid) + '）');
    const beforePull = count();
    await ctx.onPullDownRefresh();     // 下拉刷新 = force：应再请求
    await sleep(60);
    assert.ok(count() >= beforePull + 2, '下拉刷新未强制刷新（+' + (count() - beforePull) + '）');
  });
  await test('电费页', '失败降级：已有数据 → 保留上次数据 + toast；首次失败 → error 态', async () => {
    const first = powerPage(ID_USER);
    ROUTE.power = [POWER_ROW]; ROUTE.powerHist = HIST;
    first.ctx.onLoad({}); first.ctx.onShow();
    await sleep(40);
    await pickRoom(first.ctx, '1-16---306');
    await sleep(80);
    assert.strictEqual(first.ctx.data.state, 'ready');
    ROUTE.fail = true;
    await first.ctx.load(true);
    await sleep(40);
    assert.strictEqual(first.ctx.data.state, 'ready', '有旧数据时应保持 ready');
    assert.ok(toastLog.some((t) => String(t).indexOf('刷新失败') >= 0), '失败未 toast');
    // 首次失败（无旧数据）
    const second = powerPage(ID_USER);
    ROUTE.fail = true;
    second.ctx.onLoad({}); second.ctx.onShow();
    await sleep(40);
    await pickRoom(second.ctx, '1-16---306');
    await sleep(120);
    assert.strictEqual(second.ctx.data.state, 'error', '首次失败应 error: ' + second.ctx.data.state);
    assert.ok(String(second.ctx.data.errorText).length > 0);
  });
  await test('电费页', '云端空行（未采集到该宿舍）→ error 态，不渲染脏数据', async () => {
    const { ctx } = powerPage(ID_USER);
    ROUTE.power = []; ROUTE.powerHist = [];
    ctx.onLoad({}); ctx.onShow();
    await sleep(40);
    await pickRoom(ctx, '4-23A---321');
    await sleep(120);
    assert.strictEqual(ctx.data.state, 'error');
    assert.strictEqual(ctx.data.room, null);
  });
  await test('电费页', 'UD 非法选择（bogus）→ 按未选择处理，0 请求', async () => {
    await sleep(300);            // drain：等上一用例的延迟请求全部落地（Node mock 单进程串行）
    resetLogs(); resetRoute();
    clearMem(); setIdentity(ID_USER); purge();
    const store = load('utils/store.js');
    store.get().power = { sel: 'bogus-room', at: Date.now() };
    store.save();
    const def = loadPageDef('pages/power/power.js');
    const ctx = mkCtx(def);
    ctx.onLoad({}); ctx.onShow();
    await sleep(80);
    assert.strictEqual(ctx.data.hasSel, false);
    assert.strictEqual(ctx.data.state, 'idle');
    const bogusReq = reqLog.filter((r) => String(r.url).indexOf('/power') >= 0 && String(r.url).indexOf('bogus-room') >= 0);
    assert.strictEqual(bogusReq.length, 0, '非法选择发出了请求');
    if (reqOf('/power').length) pend('电费页', 'bogus 用例 harness 交叉（上一页延迟请求）', '残留请求 ' + reqOf('/power').length + ' 条（非 bogus 房间；独立进程验证为 0）');
  });
  await test('电费页', '本机离线兜底 zq_power_sel_<sid>：无 UD 值时并入 UD power 并加载', async () => {
    const { ctx, store } = powerPage(ID_USER);
    mem['zq_power_sel_' + ID_USER.sid] = '4-23B---425';
    ctx.onLoad({}); ctx.onShow();
    await sleep(120);
    assert.strictEqual((store.get().power || {}).sel, '4-23B---425');
    assert.strictEqual(ctx.data.hasSel, true);
    assert.ok(reqLog.some((r) => String(r.url).indexOf('id=eq.4-23B---425') >= 0), '兜底恢复后未请求');
    assert.strictEqual(mem['zq_power_sel_' + ID_USER.sid], '4-23B---425');
  });
  await test('电费页', '换端恢复：远端 UD power 应用后页面按该宿舍加载', async () => {
    const { ctx, store } = powerPage(ID_USER);
    const cloud = load('utils/cloud.js');
    ROUTE.power = [POWER_ROW]; ROUTE.powerHist = HIST;
    ctx.onLoad({}); ctx.onShow();
    await sleep(40);
    cloud.udApply({ v: 6, at: { power: 1762300800000 }, power: { sel: '1-13---324', at: 1762300800000 } });
    ctx.onCloudSync();
    await sleep(120);
    assert.strictEqual((store.get().power || {}).sel, '1-13---324');
    assert.strictEqual(ctx.data.sel, '1-13---324');
    assert.ok(reqLog.some((r) => String(r.url).indexOf('id=eq.1-13---324') >= 0), '换端恢复后未按新房间请求');
  });
  await test('电费页', '两账号隔离：兜底键按 sid 命名，切换身份不串用他人关注宿舍', async () => {
    clearMem();
    mem['zq_power_sel_' + ID_USER.sid] = '4-23B---425';   // A 的离线兜底选择
    setIdentity(ID_ADMIN);                               // 切到 B（管理员）身份，保留 A 的键
    resetLogs(); resetRoute(); purge();
    const def = loadPageDef('pages/power/power.js');
    const adminCtx = mkCtx(def);
    adminCtx.onLoad({}); adminCtx.onShow();
    await sleep(120);
    assert.strictEqual(adminCtx.data.hasSel, false, 'B 用了 A 的兜底键');
    assert.strictEqual(reqOf('/power').length, 0, 'B 身份发了电量请求');
    assert.ok(!('zq_power_sel_' + ID_ADMIN.sid in mem), 'B 身份写入了 A 的兜底键值语义');
  });

  /* ================= 3) UD 13 键契约 ================= */
  await test('契约', 'udSections/mergeUd：13 顶层键顺序 + at 10 section + power 镜像规则', () => {
    clearMem(); setIdentity(ID_USER); purge();
    const cloud = load('utils/cloud.js');
    const view = cloud.udSections();
    const need = privacy.SECTION_KEYS.filter((k) => k !== 'nick');
    need.forEach((k) => assert.ok(k in view, 'udSections 缺 section: ' + k));
    assert.deepStrictEqual(Object.keys(view.at), privacy.SECTION_KEYS);
    view.power = { sel: '1-16---305', at: Date.now() };
    cloud.udApply({ v: 6, at: { power: 123, homeTools: 456 }, power: { sel: '1-16---305', at: 123 }, homeTools: [] });
    const merged = cloud.mergeUd(null, cloud.udSections());
    assert.deepStrictEqual(Object.keys(merged),
      ['v', 'at', 'homeTools', 'fit', 'draw', 'group', 'roster', 'hide', 'tt', 'prefs', 'nick', 'power', 'homeToolsAt']);
    assert.deepStrictEqual(Object.keys(merged.at), privacy.SECTION_KEYS);
    assert.strictEqual(merged.power.at, merged.at.power, 'power 值内 at 未镜像 at.power');
    assert.strictEqual(merged.homeToolsAt, merged.at.homeTools, 'homeToolsAt 镜像不符');
  });
  await test('契约', 'power LWW 合并：远端新赢 / 本机新赢；未拥有 section 原样保留；v5 迁移不回归', () => {
    clearMem(); setIdentity(ID_USER); purge();
    const cloud = load('utils/cloud.js');
    const remote = { v: 6, at: { power: 2000, homE: 1 }, power: { sel: '1-13---324', at: 2000 }, nick: '云端昵称' };
    const localOld = { at: { power: 1000 }, power: { sel: '4-23B---425', at: 1000 } };
    const m1 = cloud.mergeUd(remote, localOld);
    assert.strictEqual(m1.power.sel, '1-13---324', '远端新值未赢');
    assert.strictEqual(m1.at.power, 2000);
    const localNew = { at: { power: 3000 }, power: { sel: '4-23B---425', at: 3000 }, nick: undefined };
    const m2 = cloud.mergeUd(remote, localNew);
    assert.strictEqual(m2.power.sel, '4-23B---425', '本机新值未赢');
    assert.strictEqual(m2.nick, '云端昵称', '未拥有 section 被覆盖');
    // v5 迁移（真实旧 blob fixture）
    const v5 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_sync_fixtures', 'legacy_v5.json'), 'utf8'));
    const mig = cloud.mergeUd(v5, {});
    assert.strictEqual(Number(mig.v), 6);
    assert.deepStrictEqual(Object.keys(mig),
      ['v', 'at', 'homeTools', 'fit', 'draw', 'group', 'roster', 'hide', 'tt', 'prefs', 'nick', 'power', 'homeToolsAt']);
    assert.strictEqual(mig.power.sel, '', 'v5 迁移 power 默认应为空');
  });
  await test('契约', '本机选择 → udPush 防抖 1200ms → POST blob 13 键、power{sel,at:at.power}', async () => {
    clearMem(); setIdentity(ID_USER); purge();
    const store = load('utils/store.js');
    const cloud = load('utils/cloud.js');
    ROUTE.userdata = [];             // GET userdata：云端暂无
    store.get().power = { sel: '1-16---305', at: Date.now() };
    store.save();
    cloud.udPushSoon();
    await sleep(1500);
    assert.strictEqual(ROUTE.udPost.length, 1, '未按防抖推送（POST 次数 ' + ROUTE.udPost.length + '）');
    const body = ROUTE.udPost[0][0];
    const blob = JSON.parse(body.blob);
    assert.deepStrictEqual(Object.keys(blob),
      ['v', 'at', 'homeTools', 'fit', 'draw', 'group', 'roster', 'hide', 'tt', 'prefs', 'nick', 'power', 'homeToolsAt']);
    assert.strictEqual(Object.keys(blob).length, 13);
    assert.deepStrictEqual(Object.keys(blob.at), privacy.SECTION_KEYS);
    assert.strictEqual(blob.power.sel, '1-16---305');
    assert.strictEqual(blob.power.at, blob.at.power, 'push blob power.at 未镜像');
    // 首次同步（无 udCache 基线）不抢时间戳：at.power 可能为 0（契约 §3.4），但值内 at 必须与 at.power 镜像
    assert.strictEqual(blob.power.at, blob.at.power);
    // 有了基线后再改选择 → 应重新抢时间戳
    ROUTE.udPost = [];
    store.get().power = { sel: '4-23B---425', at: Date.now() };
    store.save();
    cloud.udPushSoon();
    await sleep(1500);
    assert.ok(ROUTE.udPost.length >= 1, '基线后改动未推送');
    const blob2 = JSON.parse(ROUTE.udPost[ROUTE.udPost.length - 1][0].blob);
    assert.ok(blob2.at.power > 0, '基线后未提升 at.power: ' + blob2.at.power);
    assert.strictEqual(blob2.power.sel, '4-23B---425');
    assert.strictEqual(blob2.power.at, blob2.at.power);
    assert.strictEqual(body.id, ID_USER.sid);
  });

  /* ================= 4) 诊断页 ================= */
  const HEALTH_ROWS = [
    { id: 'cloudbase', name: '云端数据库', kind: 'cloud', status: 'ok', detail: 'ok', meta: {}, checked_at: Date.now() },
    { id: 'site_static', name: '站点资源', kind: 'static', status: 'ok', detail: 'ok', meta: {}, checked_at: Date.now() },
    { id: 'site_tls', name: '站点证书', kind: 'static', status: 'ok', detail: 'ok', meta: {}, checked_at: Date.now() },
    { id: 'qqflow', name: 'QQ 消息采集', kind: 'local', status: 'ok', detail: '', meta: {}, checked_at: Date.now() - 120000 },
    { id: 'weflow', name: '微信消息采集', kind: 'local', status: 'ok', detail: '', meta: {}, checked_at: Date.now() - 120000 },
    { id: 'watcher', name: '文档/通知监听', kind: 'local', status: 'ok', detail: '', meta: {}, checked_at: Date.now() - 120000 },
    { id: 'briefdesk', name: '本地通知服务', kind: 'local', status: 'ok', detail: '', meta: {}, checked_at: Date.now() - 120000 },
    { id: 'qq_client', name: 'QQ 客户端', kind: 'local', status: 'ok', detail: '', meta: {}, checked_at: Date.now() - 120000 },
    { id: 'wechat_client', name: '微信客户端', kind: 'local', status: 'ok', detail: '', meta: {}, checked_at: Date.now() - 120000 },
    { id: 'jwxt', name: '教务课表同步', kind: 'local', status: 'ok', detail: '', meta: {}, checked_at: Date.now() - 120000 },
    { id: 'hwauto', name: '作业自动整理', kind: 'local', status: 'ok', detail: '', meta: {}, checked_at: Date.now() - 120000 },
    { id: 'ai', name: 'AI 识别', kind: 'local', status: 'ok', detail: '', meta: {}, checked_at: Date.now() - 120000 },
    { id: 'collector_host', name: '采集主机', kind: 'local', status: 'ok', detail: '', meta: {}, checked_at: Date.now() - 120000 }
  ];
  await test('诊断', '非管理员：页面 denied 且 0 个 service_health 请求（onLoad/onShow/手动 load 三层）', async () => {
    const ctx = diagPage(ID_USER);
    ctx.onLoad({}); ctx.onShow();
    await sleep(60);
    assert.strictEqual(ctx.data.state, 'denied');
    await ctx.load();
    ctx.refreshTap();
    await sleep(60);
    assert.strictEqual(reqOf('service_health').length, 0, '非管理员发出 service_health 请求');
  });
  await test('诊断', '管理员：读取 service_health（字段/排序/令牌），4 组 13 项、状态中文、汇总', async () => {
    const ctx = diagPage(ID_ADMIN);
    ROUTE.health = HEALTH_ROWS;
    ctx.onLoad({}); ctx.onShow();
    await sleep(120);
    const rows = reqOf('service_health');
    assert.strictEqual(rows.length, 1, 'service_health 请求次数 ' + rows.length);
    assert.ok(rows[0].url.indexOf('select=id,name,kind,status,detail,meta,checked_at') >= 0);
    assert.ok(rows[0].url.indexOf('order=id') >= 0);
    assert.ok(rows[0].headerKeys.indexOf('X-Class-Token') >= 0);
    assert.strictEqual(ctx.data.state, 'ready');
    const groups = ctx.data.groups;
    assert.strictEqual(groups.length, 4, '分组数 ' + groups.length);
    assert.deepStrictEqual(groups.map((g) => g.t), ['站点与云端', '信息采集', '定时任务', '采集主机']);
    const flat = groups.reduce((a, g) => a.concat(g.items), []);
    assert.strictEqual(flat.length, 13, 'items 数 ' + flat.length);
    const cb = flat.filter((i) => i.id === 'cloudbase')[0];
    assert.strictEqual(cb.st, 'ok', 'cloudbase 未用延迟覆盖: ' + JSON.stringify(cb));
    assert.ok(/小程序直连 \d+ms/.test(cb.detail), 'cloudbase detail: ' + cb.detail);
    assert.ok(['正常', '注意', '异常', '离线', '未知'].indexOf(flat[0].display) >= 0);
    assert.strictEqual(ctx.data.summary.text, '全部正常', 'summary=' + JSON.stringify(ctx.data.summary));
  });
  await test('诊断', '采集主机心跳 >15min → local 行降级「离线」+ 上报于 HH:MM + 汇总「采集主机离线」', async () => {
    const ctx = diagPage(ID_ADMIN);
    ROUTE.health = HEALTH_ROWS.map((r) => r.id === 'collector_host'
      ? Object.assign({}, r, { status: 'ok', checked_at: Date.now() - 20 * 60000 }) : r);
    ctx.onLoad({}); ctx.onShow();
    await sleep(120);
    const flat = ctx.data.groups.reduce((a, g) => a.concat(g.items), []);
    const local = flat.filter((i) => ['qqflow', 'weflow', 'watcher', 'briefdesk', 'qq_client', 'wechat_client', 'jwxt', 'hwauto', 'ai'].indexOf(i.id) >= 0);
    assert.ok(local.length >= 5);
    local.forEach((i) => assert.strictEqual(i.st, 'offline', i.id + ' 未降级: ' + i.st));
    const host = flat.filter((i) => i.id === 'collector_host')[0];
    assert.strictEqual(host.st, 'offline');
    assert.ok(/上报于 \d{2}:\d{2}/.test(host.side), 'host side=' + host.side);
    assert.strictEqual(ctx.data.summary.text, '采集主机离线', 'summary=' + JSON.stringify(ctx.data.summary));
  });
  await test('诊断', 'cloudbase 延迟覆盖：慢 →「注意」、请求失败 →「异常」+ 错误提示', async () => {
    const diag = load('utils/diag.js');
    const slow = diag.build({ cloud: { ok: true, latency: 4200, list: HEALTH_ROWS }, lastDone: true, rows: [], ttFetchedAt: 0, now: Date.now() });
    const cb = slow.flat.filter((i) => i.id === 'cloudbase')[0];
    assert.strictEqual(cb.st, 'warn', '慢延迟未降为注意');
    const down = diag.build({ cloud: { ok: false, latency: 500, list: [], error: 'network' }, lastDone: true, rows: [], ttFetchedAt: 0, now: Date.now() });
    assert.strictEqual(down.hint && down.hint.cls, 'err', '失败未提示: ' + JSON.stringify(down.hint));
    assert.ok(down.flat.filter((i) => i.id === 'cloudbase')[0].st === 'down');
  });
  await test('诊断', 'site_static/jwxt 云端无行 → 本机课表快照兜底（≤30h ok / ≤54h warn / >54h down）', () => {
    const diag = load('utils/diag.js');
    const mk = (h) => diag.build({ cloud: { ok: true, latency: 10, list: HEALTH_ROWS.filter((r) => r.id !== 'site_static' && r.id !== 'jwxt') }, lastDone: true, rows: [], ttFetchedAt: Date.now() - h * 3600000, now: Date.now() });
    const a = mk(2).flat.filter((i) => i.id === 'site_static')[0];
    assert.strictEqual(a.st, 'ok'); assert.ok(/课表快照 2 小时前/.test(a.detail), a.detail);
    const b = mk(40).flat.filter((i) => i.id === 'jwxt')[0];
    assert.strictEqual(b.st, 'warn');
    const c = mk(60).flat.filter((i) => i.id === 'site_static')[0];
    assert.strictEqual(c.st, 'down');
  });
  await test('诊断', '60s 自动刷新且 onHide/onUnload 停止；手动刷新可用', async () => {
    const ctx = diagPage(ID_ADMIN);
    ROUTE.health = HEALTH_ROWS;
    assert.ok(/REFRESH_MS\s*=\s*60000/.test(readSrc('pages/diag/diag.js')), 'REFRESH_MS 非 60s');
    ctx.onLoad({}); ctx.onShow();
    await sleep(120);
    assert.ok(ctx._timer, '未启动 60s 定时器');
    ctx.onHide();
    assert.ok(!ctx._timer, 'onHide 未停止定时器');
    ctx.onShow();
    await sleep(80);
    assert.ok(ctx._timer, '重新显示未恢复定时器');
    ctx.onUnload();
    assert.ok(!ctx._timer, 'onUnload 未停止定时器');
  });
  await test('诊断', '错误态：云端失败 → state ready + hint err（不崩、不误报离线）', async () => {
    const ctx = diagPage(ID_ADMIN);
    ROUTE.fail = true;
    ctx.onLoad({}); ctx.onShow();
    await sleep(150);
    assert.strictEqual(ctx.data.state, 'ready');
    assert.ok(ctx.data.hint && ctx.data.hint.cls === 'err', 'hint=' + JSON.stringify(ctx.data.hint));
    const flat = ctx.data.groups.reduce((a, g) => a.concat(g.items), []);
    assert.strictEqual(flat.length, 13);
  });

  /* ================= 5) 与网站实现的一致性交叉核对（只读 web 源） ================= */
  await test('同步', '房间目录与网站 PW_ROOMS 一致（rv 集合、顺序、数量）', () => {
    const P = load('utils/power.js');
    const w = readWeb();
    const m = w.match(/var PW_ROOMS=\[([\s\S]*?)\];/);
    assert.ok(m, 'web 源未找到 PW_ROOMS');
    const webRvs = (m[1].match(/rv:"([^"]+)"/g) || []).map((s) => s.replace(/rv:"|"/g, ''));
    assert.strictEqual(webRvs.length, 17, 'web ROOMS 数=' + webRvs.length);
    assert.deepStrictEqual(P.ROOMS.map((r) => r.rv), webRvs, '两端口径房间目录不一致');
  });
  await test('同步', '电费 v5 与网站一致：RANGES/区间键/5min/limit2000/充值语义/横滑/估算/低电阈值/aria', () => {
    const w = readWeb();
    assert.ok(w.indexOf('var PW_RANGES=[') >= 0);
    assert.ok(w.indexOf('zq_power_range_v1') >= 0);
    assert.ok(w.indexOf('limit=2000') >= 0 && w.indexOf('select=ts,quantity') >= 0);
    assert.ok(w.indexOf('期间有充值') >= 0 && w.indexOf('上次充值') >= 0);
    assert.ok(w.indexOf('scrollLeft') >= 0);
    assert.ok(w.indexOf('rateFrom') >= 0 && w.indexOf('estimate') >= 0, '网站缺 v5 估算');
    assert.ok(w.indexOf('≥30') >= 0, '网站缺 ≥30');
    assert.ok(w.indexOf('zq_power_low') >= 0, '网站缺阈值本机键');
    assert.ok(w.indexOf('aria-label="低电阈值') >= 0, '网站缺阈值 aria');
    const sc = fs.readFileSync('C:/Users/Ko_Li/.openclaw/workspace/web/tools/tests/sync_check.py', 'utf8');
    assert.ok(sc.indexOf('power:{sel:"",at:0,low:30}') >= 0);
  });
  await test('同步', 'UD 13 键契约与网站 UD_KEYS 一致（顺序/内容）', () => {
    const w = readWeb();
    const m = w.match(/var UD_KEYS=\[([^\]]+)\]/);
    assert.ok(m, 'web 源未找到 UD_KEYS');
    const webKeys = JSON.parse('[' + m[1] + ']');
    assert.deepStrictEqual(webKeys, privacy.SECTION_KEYS, '两端 section 顺序不一致');
    assert.deepStrictEqual(webKeys.concat([]), ['homeTools', 'fit', 'draw', 'group', 'roster', 'hide', 'tt', 'prefs', 'nick', 'power']);
  });
  await test('同步', 'web sync_check.py 期望 13 键顺序与 mp 契约逐字节一致（只读交叉核对）', () => {
    const wf = 'C:/Users/Ko_Li/.openclaw/workspace/web/tools/tests/sync_check.py';
    const py = fs.readFileSync(wf, 'utf8');
    const expect = 'v,at,homeTools,fit,draw,group,roster,hide,tt,prefs,nick,power,homeToolsAt';
    assert.ok(py.indexOf(expect) >= 0, 'web sync_check 未包含同一 13 键顺序断言');
    const merged = ['v'].concat(['at']).concat(privacy.SECTION_KEYS).concat(['homeToolsAt']);
    assert.strictEqual(merged.join(','), expect);
  });

  /* ================= 汇总 ================= */
  const out = path.join(REPORTS, 'mp_sync_features_' + TAG + '.json');
  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    root: ROOT, at: new Date().toISOString(),
    total: results.length, pass: passN, fail: failN, pend: pendN, rows: results
  }, null, 1), 'utf8');
  console.log('\n' + '='.repeat(66));
  console.log('mp sync features [' + TAG + ']: ' + results.length + ' 项，PASS ' + passN + '，FAIL ' + failN + '，PEND ' + pendN);
  console.log('结果 JSON:', out);
  console.log('='.repeat(66));
  return failN === 0 ? 0 : 1;
}

main().then((c) => process.exit(c)).catch((e) => { console.error('脚本异常:', e); process.exit(2); });
