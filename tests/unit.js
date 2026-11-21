/* 单元/契约测试：班级工具站微信小程序（不启动模拟器）
 * 运行：node unit.js
 * 依赖：仅 Node 内置模块；小程序 utils 通过绝对路径 require。
 * 说明：wx 用内存 mock；cloud.js 的 wx.request 可注入假响应，绝不访问真实云表。
 * v12 / 1.3.0：身份系统改为 CloudBase RPC class_verify + X-Class-Token，旧的密码注册/登录断言已移除。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..').replace(/\\/g, '/');
const results = [];
let passN = 0, failN = 0;

async function test(name, fn) {
  try { await fn(); passN++; results.push({ name, ok: true }); console.log('PASS  ' + name); }
  catch (e) { failN++; results.push({ name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
}

/* ---------------- wx mock ---------------- */
const mem = Object.create(null);
let reqImpl = (o) => o.success({ statusCode: 200, data: [] });
let reqLog = [];
let toastLog = [], modalLog = [], clipLog = [], savedFiles = [], navLog = [];
global.wx = {
  getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
  setStorageSync(k, v) { mem[k] = v; },
  removeStorageSync(k) { delete mem[k]; },
  request(o) { reqLog.push(o); reqImpl(o); },
  showToast(o) { toastLog.push(o && o.title); },
  showModal(o) { modalLog.push(o && o.title); if (o && o.success) o.success({ confirm: true, cancel: false }); },
  showLoading() {}, hideLoading() {},
  setClipboardData(o) { clipLog.push(o && o.data); if (o && o.success) o.success(); },
  getClipboardData(o) { if (o && o.success) o.success({ data: clipLog[clipLog.length - 1] || '' }); },
  canvasToTempFilePath(o) { savedFiles.push(o); if (o && o.success) o.success({ tempFilePath: '/tmp/test.png' }); },
  saveImageToPhotosAlbum(o) { if (o && o.success) o.success(); },
  getSetting(o) { if (o && o.success) o.success({ authSetting: { 'scope.writePhotosAlbum': true } }); },
  openSetting(o) { if (o && o.success) o.success({ authSetting: {} }); },
  createSelectorQuery() {
    return { in() { return this; }, select() { return this; }, fields() { return this; }, exec(cb) { cb([{ node: fakeCanvas.node, width: 760, height: 600 }]); } };
  },
  navigateTo(o) { navLog.push({ type: 'navigateTo', url: o && o.url }); },
  switchTab(o) { navLog.push({ type: 'switchTab', url: o && o.url }); },
  reLaunch(o) { navLog.push({ type: 'reLaunch', url: o && o.url }); },
  showActionSheet(o) { if (o && o.success) o.success({ tapIndex: 0 }); }
};

/* 重载小程序模块，保证模块级状态（store.cache / cloud CONFIG）干净 */
function fresh() {
  Object.keys(require.cache).forEach((k) => {
    if (k.replace(/\\/g, '/').indexOf(ROOT) === 0) {
      try {
        const m = require.cache[k];
        // 清掉用户数据同步的防抖 timer，避免上个用例的推送落到下个用例的 request 日志里
        if (m && m.exports && typeof m.exports.udStop === 'function') m.exports.udStop();
      } catch (e) { /* ignore */ }
      delete require.cache[k];
    }
  });
  return {
    store: require(path.join(ROOT, 'utils/store.js')),
    util: require(path.join(ROOT, 'utils/util.js')),
    fit: require(path.join(ROOT, 'utils/fit.js')),
    tools: require(path.join(ROOT, 'utils/tools.js')),
    flow: require(path.join(ROOT, 'utils/flow.js')),
    identity: require(path.join(ROOT, 'utils/identity.js')),
    cloud: require(path.join(ROOT, 'utils/cloud.js')),
    canvas: require(path.join(ROOT, 'utils/canvas.js')),
    qr: require(path.join(ROOT, 'utils/qr.js')),
    roster: require(path.join(ROOT, 'utils/roster.js'))
  };
}

function clearMem() {
  Object.keys(mem).forEach((k) => delete mem[k]);
  toastLog = []; modalLog = []; clipLog = []; savedFiles = []; navLog = []; reqLog = [];
  reqImpl = ok([]);
}
function ok(data) { return (o) => o.success({ statusCode: 200, data: data === undefined ? [] : data }); }
function failReq(o) { o.fail({ errMsg: 'request:fail mock' }); }

const ID = { token: 'tok-test-1', sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: true, ts: 1 };
const ID2 = { token: 'tok-test-2', sid: '9999000004', name: '测试辛', role: '', badge: '', is_admin: false, ts: 2 };
const MEMBERS = [
  { seat: 1, sid: '9999000001', name: '测试甲', role: '', badge: '', is_admin: false },
  { seat: 24, sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: true },
  { seat: 26, sid: '9999000004', name: '测试辛', role: '', badge: '', is_admin: false }
];
function setIdentity(id) { mem['zq_class_identity'] = JSON.stringify(id || ID); }
function urlOf(o) { return String(o && o.url || ''); }
function reqsOf(frag) { return reqLog.filter((o) => urlOf(o).indexOf(frag) >= 0); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ---------------- 课表页（滑动）测试辅助 ---------------- */
let TT_DEF = null;
function loadTtPage() {
  if (TT_DEF) return TT_DEF;
  let def = null;
  global.Page = (d) => { def = d; };
  try { require(path.join(ROOT, 'pages/tt/tt.js')); } finally { delete global.Page; }
  assert.ok(def && typeof def._buildData === 'function' && typeof def.onSwipeStart === 'function', 'tt 页未注册 Page 或缺少滑动 handler');
  TT_DEF = def;
  return def;
}
function ttCtx(def) {
  const ctx = Object.assign({}, def);
  ctx.data = JSON.parse(JSON.stringify(def.data));
  ctx.log = [];
  ctx.setData = function (o, cb) {
    this.log.push({ wk: o.wk, swipeStyle: o.swipeStyle });
    Object.assign(this.data, o);
    if (cb) cb();
  };
  ctx._courses = [
    { name: '高数', day: 0, start: 1, end: 2, weeks: '1-18', room: 'A101', teacher: '张' },
    { name: '英语', day: 2, start: 3, end: 4, weeks: '1-18', room: 'B202', teacher: '李' }
  ];
  ctx._term = '';
  ctx._meta = null;
  ctx._shared = null;
  ctx._remoteOk = false;
  ctx._wk = 5;
  ctx._day = null;
  ctx._dayUser = false;
  ctx._gridOverflow = false;
  ctx._gridX = 0;
  ctx._gridMaxX = 0;
  ctx._sw = null;
  ctx._swAnim = false;
  ctx._swTimers = [];
  ctx._swSeq = 0;
  ctx._supTap = 0;
  ctx.refresh();   // 让 data.wk / maxWeek 生效（滑动目标判断依赖 data.wk）
  return ctx;
}

/* ---------------- 假 canvas ---------------- */
const fakeCanvas = (() => {
  const ops = [];
  const g = {
    font: '', fillStyle: '', globalAlpha: 1, textAlign: 'left', strokeStyle: '', lineWidth: 1,
    shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,
    measureText(t) { return { width: String(t == null ? '' : t).length * 8 }; },
    fillText(t, x, y) { ops.push({ op: 'text', t: String(t), x, y, font: g.font, fill: g.fillStyle, alpha: g.globalAlpha, align: g.textAlign }); },
    fillRect(x, y, w, h) { ops.push({ op: 'fillRect', x, y, w, h, fill: g.fillStyle }); },
    strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, closePath() {},
    arc() {}, clip() { ops.push({ op: 'clip' }); },
    createLinearGradient() { return { addColorStop() {} }; },
    fill() { ops.push({ op: 'fill', fill: g.fillStyle }); }, stroke() {}, save() {}, restore() {},
    translate() {}, rotate() {}, scale() {}, setTransform() {}
  };
  const node = { width: 0, height: 0, getContext() { return g; } };
  return { ops, g, node, reset() { ops.length = 0; } };
})();

(async function main() {
  /* ============================================================
     1. util 纯函数
     ============================================================ */
  await test('safeName / recId / stamp 格式', () => {
    const { util } = fresh();
    assert.strictEqual(util.safeName('抽签结果 2026/10/18 22:00'), '抽签结果-2026-10-18-22-00');
    assert.ok(/^DRAW-\d{8}-\d{6}-[A-Z0-9]{4}$/.test(util.recId('DRAW')), util.recId('DRAW'));
    assert.ok(/^\d{8}-\d{6}$/.test(util.stamp()), util.stamp());
  });

  await test('parseExcl 支持逗号/中文逗号/空格/区间/非法片段', () => {
    const { util } = fresh();
    assert.deepStrictEqual(util.parseExcl('3,7,10-12'), [3, 7, 10, 11, 12]);
    assert.deepStrictEqual(util.parseExcl('1，3，5~6'), [1, 3, 5, 6]);
    assert.deepStrictEqual(util.parseExcl(' 2  4—5 '), [2, 4, 5]);
    assert.deepStrictEqual(util.parseExcl('a,3,b'), [3]);
    assert.deepStrictEqual(util.parseExcl(''), []);
  });

  await test('parseWeeks 支持区间/逗号/非法片段', () => {
    const { util } = fresh();
    assert.deepStrictEqual(util.parseWeeks('1-3,5'), [1, 2, 3, 5]);
    assert.deepStrictEqual(util.parseWeeks('1，2'), [1, 2]);
    assert.deepStrictEqual(util.parseWeeks('a'), []);
    assert.deepStrictEqual(util.parseWeeks(''), []);
  });

  await test('weekNum：开学当周=1，往前为 null', () => {
    const { util } = fresh();
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const d = new Date();
    assert.strictEqual(util.weekNum(fmt(d)), 1);
    const d7 = new Date(); d7.setDate(d7.getDate() - 7);
    assert.strictEqual(util.weekNum(fmt(d7)), 2);
    const dFuture = new Date(); dFuture.setDate(dFuture.getDate() + 1);
    assert.strictEqual(util.weekNum(fmt(dFuture)), null);
    assert.strictEqual(util.weekNum('not-a-date'), null);
  });

  await test('dueInfo：无日期/已过期/24h 内/3 天内/更远', () => {
    const { util } = fresh();
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    assert.strictEqual(util.dueInfo({ due: '下节课前' }).txt, '下节课前');
    const y = new Date(); y.setDate(y.getDate() - 2);
    assert.strictEqual(util.dueInfo({ date: fmt(y) }).cls, 'red');
    const t = new Date();
    assert.strictEqual(util.dueInfo({ date: fmt(t) }).cls, 'red');
    const d2 = new Date(); d2.setDate(d2.getDate() + 2);
    assert.strictEqual(util.dueInfo({ date: fmt(d2) }).cls, 'warn');
    const d9 = new Date(); d9.setDate(d9.getDate() + 9);
    assert.strictEqual(util.dueInfo({ date: fmt(d9) }).cls, 'ok');
  });

  await test('rosterMap：编号/点号/顿号/无编号/空行', () => {
    const { util } = fresh();
    const r = util.rosterMap('1 张三\n2.李四\n王五\n\n5、赵六');
    assert.deepStrictEqual(r.m, { 1: '张三', 2: '李四', 3: '王五', 5: '赵六' });
    assert.strictEqual(r.n, 4);
  });

  /* ============================================================
     2. 体测国标
     ============================================================ */
  await test('体测：男大一大二全 80 分档 → 标准 83.0 / 良好', () => {
    const { fit } = fresh();
    const r = fit.ftCalc({ sex: 'm', grade: '12', h: '175', w: '65', vc: '4300', r50: '7.1', sit: '17.7', jump: '248', pull: '15', durM: '3', durS: '42' });
    assert.strictEqual(r.total, 83);
    assert.strictEqual(r.std, 83);
    assert.strictEqual(r.plus, 0);
    assert.strictEqual(r.grade, '良好');
    assert.strictEqual(r.rows.length, 7);
    assert.strictEqual(r.miss, 0);
  });

  await test('体测：女大一大二对应档位同样 83.0，项目名切换', () => {
    const { fit } = fresh();
    const r = fit.ftCalc({ sex: 'f', grade: '12', h: '165', w: '55', vc: '3000', r50: '8.3', sit: '19.0', jump: '181', pull: '46', durM: '3', durS: '44' });
    assert.strictEqual(r.total, 83);
    assert.ok(r.rows.some((x) => x.n === '1 分钟仰卧起坐'));
    assert.ok(r.rows.some((x) => x.n === '800 米跑'));
  });

  await test('体测：男/女 × 12/34 四张表都能出分且总分=标准分+加分', () => {
    const { fit } = fresh();
    const base = { h: '175', w: '65', vc: '4300', r50: '7.1', sit: '18', jump: '250', pull: '15', durM: '3', durS: '42' };
    for (const sex of ['m', 'f']) for (const grade of ['12', '34']) {
      const r = fit.ftCalc(Object.assign({}, base, { sex, grade }));
      const std = Math.round(r.rows.reduce((a, o) => a + (o.s == null ? 0 : o.s * o.wt / 100), 0) * 10) / 10;
      const plus = r.rows.reduce((a, o) => a + (o.p || 0), 0);
      assert.strictEqual(r.std, std);
      assert.strictEqual(r.total, Math.round((std + plus) * 10) / 10);
      assert.strictEqual(r.rows.reduce((a, o) => a + o.wt, 0), 100);
    }
  });

  await test('体测：BMI 低体重/正常/超重/肥胖边界', () => {
    const { fit } = fresh();
    const calc = (w) => fit.ftCalc({ sex: 'm', grade: '12', h: '175', w: String(w) }).rows[0];
    assert.strictEqual(calc(54.0).s, 80);   // 17.6 低体重
    assert.strictEqual(calc(55.0).s, 100);  // 18.0 正常
    assert.strictEqual(calc(73.0).s, 100);  // 23.8 正常
    assert.strictEqual(calc(74.0).s, 80);   // 24.2 超重
    assert.strictEqual(calc(86.0).s, 60);   // 28.1 肥胖
  });

  await test('体测：单项边界（肺活量/50 米/引体/1000 米/加分）', () => {
    const { fit } = fresh();
    assert.strictEqual(fit.ftScore(fit.FTB.vc, 5040, 'm', '12'), 100);
    assert.strictEqual(fit.ftScore(fit.FTB.vc, 4300, 'm', '12'), 80);
    assert.strictEqual(fit.ftScore(fit.FTB.vc, 2300, 'm', '12'), 10);
    assert.strictEqual(fit.ftScore(fit.FTB.vc, 2299, 'm', '12'), 0);
    assert.strictEqual(fit.ftScore(fit.FTB.r50, 6.7, 'm', '12'), 100);
    assert.strictEqual(fit.ftScore(fit.FTB.r50, 10.2, 'm', '12'), 0);
    assert.strictEqual(fit.ftScore(fit.FTB.pull, 19, 'm', '12'), 100);
    assert.strictEqual(fit.ftScore(fit.FTB.dur, 197, 'm', '12'), 100);
    assert.strictEqual(fit.ftScore(fit.FTB.dur, 372, 'm', '12'), 10);
    assert.strictEqual(fit.ftScore(fit.FTB.dur, 373, 'm', '12'), 0);
    assert.strictEqual(fit.ftPlus(fit.FTP.pull, 6), 6);
    assert.strictEqual(fit.ftPlus(fit.FTP.durM, 47), 10);
    assert.strictEqual(fit.ftPlus(fit.FTP.pull, 0), 0);
  });

  await test('体测：加分上限 20，且缺项按 0 计', () => {
    const { fit } = fresh();
    const r = fit.ftCalc({ sex: 'm', grade: '12', h: '175', w: '65', vc: '4300', r50: '7.1', sit: '17.7', jump: '248', pull: '29', durM: '2', durS: '30' });
    assert.strictEqual(r.rows.find((x) => x.n === '引体向上').p, 10);
    assert.strictEqual(r.rows.find((x) => x.n === '1000 米跑').p, 10);
    assert.strictEqual(r.plus, 20);
    const m = fit.ftCalc({ sex: 'm', grade: '12', h: '175', w: '65' });
    assert.strictEqual(m.miss, 6);
    assert.strictEqual(m.wtDone, 15);
    const e = fit.ftCalc({});
    assert.strictEqual(e.miss, 7);
    assert.strictEqual(e.total, 0);
    assert.strictEqual(e.grade, '不及格');
  });

  await test('体测：空值/非法值不会抛错，ftMS 秒进位正确', () => {
    const { fit } = fresh();
    assert.strictEqual(fit.ftNum(''), null);
    assert.strictEqual(fit.ftNum('abc'), null);
    assert.strictEqual(fit.ftNum('0'), 0);
    assert.strictEqual(fit.ftSec('', ''), null);
    assert.strictEqual(fit.ftSec('3', '42'), 222);
    assert.strictEqual(fit.ftSec('', '30'), 30);
    assert.strictEqual(fit.ftMS(59.6), "1'00\"");
    assert.strictEqual(fit.ftMS(null), '—');
  });

  await test('体测：0 秒/0:00 视为无效，不再拿满分', () => {
    const { fit } = fresh();
    assert.strictEqual(fit.ftValid('r50', 0), null);
    assert.strictEqual(fit.ftValid('dur', 0), null);
    assert.strictEqual(fit.ftValid('pull', 0), 0);
    const r = fit.ftCalc({ sex: 'm', grade: '12', h: '175', w: '65', vc: '4300', r50: '0', sit: '17.7', jump: '248', pull: '15', durM: '0', durS: '0' });
    assert.strictEqual(r.rows.find((x) => x.n === '50 米跑').s, null);
    assert.strictEqual(r.rows.find((x) => x.n === '1000 米跑').s, null);
    assert.ok(r.miss >= 2);
    assert.strictEqual(r.totalText, r.total.toFixed(1));
  });

  await test('体测：长跑 <2 分钟 / 只填秒也参与计算（不再误判缺项）', () => {
    const { fit } = fresh();
    const fast = fit.ftCalc({ sex: 'f', grade: '12', durM: '1', durS: '58' });
    const rf = fast.rows.find((x) => x.n === '800 米跑');
    assert.strictEqual(rf.v, "1'58\"");
    assert.strictEqual(rf.s, 100);
    assert.strictEqual(fast.wtDone, 20);
    const onlyS = fit.ftCalc({ sex: 'm', grade: '12', durS: '42' });
    const rs = onlyS.rows.find((x) => x.n === '1000 米跑');
    assert.strictEqual(rs.v, "0'42\"");
    assert.strictEqual(rs.s, 100);
    assert.strictEqual(onlyS.wtDone, 20);
    const zero = fit.ftCalc({ sex: 'm', grade: '12', durM: '0', durS: '0' });
    assert.strictEqual(zero.rows.find((x) => x.n === '1000 米跑').s, null);
  });

  /* ============================================================
     3. 工具目录 / 首页顺序 / flow / store
     ============================================================ */
  await test('工具目录：课表已上线，名单已注册（默认勾选 4 个）', () => {
    const { tools } = fresh();
    // 2026-11-06：首页工具改为用户主动勾选（≤4），默认勾选 = 现有首页前 4 个（hw/nt/ft/draw）
    assert.deepStrictEqual(tools.defaultHome(), ['hw', 'nt', 'ft', 'draw']);
    assert.deepStrictEqual(tools.toolOrder(), tools.TOOLS.map((t) => t.key), '默认 toolOrder = TOOLS 自然顺序');
    assert.strictEqual(tools.isHidden('tt'), false);
    const bz = tools.toolOf('bz');
    assert.ok(bz, '名单工具未注册');
    assert.strictEqual(bz.name, '名单');
    assert.strictEqual(bz.url, '/pages/committee/committee');
    assert.ok(!bz.admin, '名单应对所有已认证同学可见');
  });

  await test('首页勾选：旧默认 [draw,hw,nt] 自动迁移为默认勾选 4 个', () => {
    const { store, tools } = fresh();
    clearMem();
    store.get().homeTools = ['draw', 'hw', 'nt'];   // 极旧版默认首页（LEGACY_HOMES）
    store.save();
    assert.deepStrictEqual(tools.homeTools(), ['hw', 'nt', 'ft', 'draw']);
  });

  await test('首页勾选：normalize 去重/过滤/上限 4（不补齐），moveTool 越界夹紧', () => {
    const { store, tools } = fresh();
    clearMem();
    store.get().homeTools = ['tt', 'draw', 'draw', 'bogus'];
    assert.deepStrictEqual(tools.normalizeHome(store.get().homeTools), ['tt', 'draw'], '只去重/过滤，不再补齐到多个');
    store.get().homeTools = ['hw', 'nt', 'ft', 'draw']; store.save();
    const order = tools.moveTool('draw', 0);
    assert.strictEqual(order[0], 'draw');
    assert.deepStrictEqual(tools.homeTools(), ['draw', 'hw', 'nt', 'ft'], '拖动后勾选顺序跟随全部工具顺序');
    assert.strictEqual(tools.moveTool('draw', 999).slice(-1)[0], 'draw', '越界夹紧到末尾');
    assert.strictEqual(tools.moveTool('bogus', 2).length, tools.TOOLS.length, '未知 key 不改变顺序');
  });

  await test('v2.0.0：quickList = 勾选工具（最多 4），catalog 按本机 toolOrder 排列', () => {
    const { store, tools } = fresh();
    clearMem();
    store.get().homeTools = ['draw', 'hw', 'tt', 'nt', 'ft', 'roll', 'bz'];  // 旧版全量顺序
    store.save();
    // 迁移：前 4 个 = 勾选；全量顺序 = 本机 toolOrder
    assert.deepStrictEqual(tools.quickList(4).map((t) => t.key), ['draw', 'hw', 'tt', 'nt']);
    assert.strictEqual(tools.quickList(99).length, 4, 'quickList 最多 4 个（勾选集合本身 ≤4）');
    assert.deepStrictEqual(tools.catalog().map((t) => t.key), ['draw', 'hw', 'tt', 'nt', 'ft', 'roll', 'bz', 'power', 'water', 'vote', 'file', 'map', 'stats', 'diag', 'ppt']);
    assert.strictEqual(tools.toolOf('stats').admin, true, '统计仍是管理工具，不进首页勾选');
    // 2026-11-08 诊断 v2：全班可见（不再是 admin 工具），但仍不进首页勾选（noHome）
    assert.strictEqual(tools.toolOf('diag').admin, undefined, '诊断对全班可见，不再是仅管理员工具');
    assert.strictEqual(tools.toolOf('diag').noHome, true, '诊断不进首页勾选（仅「全部」页可见）');
    assert.strictEqual(tools.toolOf('power').noHome, true, '宿舍电费与网站一致：不参与首页勾选');
    assert.strictEqual(!!tools.toolOf('water').noHome, false, '水量可主动勾选进首页（2026-11-06 用户口径）');
    assert.strictEqual(tools.homeEligible(tools.toolOf('water')), true);
    assert.strictEqual(tools.toolOf('water').url, '/pages/water/water');
    assert.deepStrictEqual(tools.quickList().map((t) => t.key), ['draw', 'hw', 'tt', 'nt']);
  });

  await test('分享：message / timeline 生成微信原生分享参数（title/path/query/imageUrl）', () => {
    const share = require(path.join(ROOT, 'utils/share.js'));
    const m = share.message({ title: '班级课表｜第 10 周', path: '/pages/tt/tt', query: 'wk=10', imageUrl: '/images/share/tt.png' });
    assert.deepStrictEqual(m, { title: '班级课表｜第 10 周', path: '/pages/tt/tt?wk=10', imageUrl: '/images/share/tt.png' });
    const objQ = share.message({ title: 'x', path: '/pages/index/index', query: { wk: 10, day: '' } });
    assert.strictEqual(objQ.path, '/pages/index/index?wk=10', '空 query 值应被过滤');
    const t = share.timeline({ title: '班级课表｜第 10 周', query: 'wk=10', imageUrl: '/images/share/tt.png' });
    assert.deepStrictEqual(t, { title: '班级课表｜第 10 周', query: 'wk=10', imageUrl: '/images/share/tt.png' });
    assert.strictEqual(share.timeline({ title: 'x', query: { wk: 10 } }).query, 'wk=10');
    assert.strictEqual(share.qs('?wk=10'), '?wk=10');
    const d = share.message({});
    assert.ok(d.title && d.path.indexOf('/pages/') === 0 && d.imageUrl === '/images/share/default.png', '缺省值应可用');
    assert.doesNotThrow(() => share.enable(), 'enable 在无 wx.showShareMenu 的环境也不应抛错');
    // 2026-11-19 性能：同一页面实例只 showShareMenu 一次；新页面实例仍会调用
    const gcp = global.getCurrentPages;
    const origShow = global.wx.showShareMenu;
    const calls = [];
    try {
      global.wx.showShareMenu = (o) => { calls.push(o); };
      const p1 = {};
      global.getCurrentPages = () => [p1];
      share.enable(); share.enable();
      assert.strictEqual(calls.length, 1, '同一页面实例重复 enable 只调用一次');
      const p2 = {};
      global.getCurrentPages = () => [p2];
      share.enable();
      assert.strictEqual(calls.length, 2, '新页面实例重新调用一次');
    } finally {
      global.wx.showShareMenu = origShow;
      if (gcp === undefined) { try { delete global.getCurrentPages; } catch (e) {} } else global.getCurrentPages = gcp;
    }
  });

  await test('flow：patch/get/clear 持久化', () => {
    const { flow } = fresh();
    clearMem();
    flow.clearFlow();
    flow.patch('draw', { result: [1, 2] });
    assert.deepStrictEqual(flow.getFlow().draw, { result: [1, 2] });
    assert.ok(flow.getFlow().updatedAt > 0);
    flow.clearFlow();
    assert.strictEqual(flow.getFlow().draw, null);
  });

  await test('store：旧键 ziqi.tools.v1 迁移 + 固定单桶 + reset + 名单缓存默认值', () => {
    const { store } = fresh();
    clearMem();
    mem['ziqi.tools.v1'] = JSON.stringify({ courses: [{ name: '高数' }], homework: [{ content: 'x' }], notices: [], termStart: '2026-09-07' });
    assert.strictEqual(store.get().course.length, 1);
    assert.strictEqual(store.get().termStart, '2026-09-07');
    assert.deepStrictEqual(store.get().classMembers, []);
    assert.strictEqual(store.get().classRoster, '');
    store.get().roster = '1 甲';
    store.save();
    assert.ok(mem['zq_tools_v2']);
    store.reload();
    assert.strictEqual(store.get().roster, '1 甲');
    store.reset();
    assert.deepStrictEqual(store.get().course, []);
    assert.deepStrictEqual(store.get().classMembers, []);
  });

  /* ============================================================
     4. 身份层（class_verify / class_members）
     ============================================================ */
  function cloudFresh() {
    const m = fresh();
    clearMem();
    m.cloud.configure({
      enabled: true,
      restBase: 'https://mock.test/v1/rdb/rest/',
      publishableKey: 'pub',
      ttUrl: 'https://static.test/tt.json',
      ttLegacy: true,          // 单测显式开启 legacy（生产 cloud-config.js 在 DNS 暂停期设为 false）
      timeout: 1000,
      rpc: { verify: 'rpc/class_verify', members: 'rpc/class_members' }
    });
    return m;
  }
  function verifyOk(o) {
    o.success({
      statusCode: 200,
      data: { ok: true, token: 'tok-1', sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: true }
    });
  }

  await test('身份：label / 保存读取 / isAdmin（v1.3.3 起不再提供 maskSid）', () => {
    const { identity } = fresh();
    clearMem();
    assert.strictEqual(identity.maskSid, undefined, '页面已不展示学号，maskSid 应已移除');
    assert.strictEqual(identity.sidMask, undefined);
    assert.strictEqual(identity.has(), false);
    identity.save(ID);
    assert.strictEqual(identity.has(), true);
    assert.strictEqual(identity.sid(), ID.sid);
    assert.strictEqual(identity.name(), ID.name);
    assert.strictEqual(identity.label(), '副团支书');
    assert.strictEqual(identity.isAdmin(), true);
    identity.save(null);
    assert.strictEqual(identity.has(), false);
  });

  await test('身份：无身份时 ensure() reLaunch 回身份页；有身份直接放行', () => {
    const { identity } = fresh();
    clearMem();
    assert.strictEqual(identity.ensure(), false);
    assert.ok(navLog.some((n) => n.type === 'reLaunch' && n.url === '/pages/identity/identity'));
    setIdentity(ID2);
    const before = navLog.length;
    assert.strictEqual(identity.ensure(), true);
    assert.strictEqual(navLog.length, before, '有身份时不应再跳转');
    assert.strictEqual(identity.isAdmin(), false);
  });

  await test('身份：classVerify 成功 → 请求头/请求体正确（不带头像 token）', async () => {
    const { cloud } = cloudFresh();
    reqImpl = (o) => { if (urlOf(o).indexOf('/rpc/class_verify') >= 0) return verifyOk(o); return ok([])(o); };
    const r = await cloud.classVerify('3260799999', '测试账号');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.identity.token, 'tok-1');
    assert.strictEqual(r.identity.sid, '3260799999');
    assert.strictEqual(r.identity.name, '测试账号');
    assert.strictEqual(r.identity.role, '副团支书');
    assert.strictEqual(r.identity.badge, '班委');
    assert.strictEqual(r.identity.is_admin, true);
    const req = reqsOf('/rpc/class_verify')[0];
    assert.ok(req);
    assert.strictEqual(req.method, 'POST');
    assert.strictEqual(req.header.Authorization, 'Bearer pub');
    assert.strictEqual(req.header['X-Class-Token'], undefined, '验证请求不应带班级 token');
    assert.deepStrictEqual(req.data, { p_sid: '3260799999', p_name: '测试账号' });
  });

  await test('身份：classVerify 失败（云端 ok:false / 网络错误 / 学号格式）', async () => {
    const { cloud } = cloudFresh();
    reqImpl = (o) => o.success({ statusCode: 200, data: { ok: false, reason: '姓名或学号不在班级名单中' } });
    let r = await cloud.classVerify('9999000099', '张三');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, '姓名或学号不在班级名单中');
    reqImpl = failReq;
    r = await cloud.classVerify('3260799999', '测试账号');
    assert.strictEqual(r.ok, false);
    assert.ok(/网络不可用/.test(r.reason));
    assert.strictEqual((await cloud.classVerify('123', '张三')).reason, '学号应为 10 位数字');
    assert.strictEqual((await cloud.classVerify('3260799999', '')).reason, '请填写真实姓名');
  });

  await test('身份：login → 保存 token + 请求 class_members（带 X-Class-Token、body {}）+ 缓存 70 人名单', async () => {
    const { identity, cloud, store } = cloudFresh();
    reqImpl = (o) => {
      if (urlOf(o).indexOf('/rpc/class_verify') >= 0) return verifyOk(o);
      if (urlOf(o).indexOf('/rpc/class_members') >= 0) return o.success({ statusCode: 200, data: MEMBERS });
      return ok([])(o);
    };
    const r = await identity.login('3260799999', '测试账号');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.members, 3);
    assert.strictEqual(identity.sid(), '3260799999');
    const mReq = reqsOf('/rpc/class_members')[0];
    assert.ok(mReq, '未请求 class_members');
    assert.strictEqual(mReq.header['X-Class-Token'], 'tok-1');
    assert.deepStrictEqual(mReq.data, {});
    assert.strictEqual(store.get().classMembers.length, 3);
    assert.strictEqual(store.get().classRoster, '1 测试甲\n24 测试账号\n26 测试辛');
    assert.ok(store.get().classMembersAt > 0);
    assert.strictEqual(cloud.memberCount(), 3);
    assert.strictEqual(cloud.memberName('9999000004'), '测试辛');
    const bz = cloud.committee();
    assert.strictEqual(bz.length, 1);
    assert.strictEqual(bz[0].name, '测试账号');
    assert.strictEqual(bz[0].role, '副团支书');
  });

  await test('身份：无身份时不发任何班级/数据请求（verify 除外）', async () => {
    const { cloud } = cloudFresh();
    clearMem();
    reqImpl = ok([]);
    let rejected = false;
    try { await cloud.cbGet('homework'); } catch (e) { rejected = (e.message === 'identity-required'); }
    assert.strictEqual(rejected, true);
    const pull = await cloud.cloudPull();
    assert.strictEqual(pull.identity, false);
    assert.strictEqual(await cloud.visitLog(), false);
    assert.strictEqual(await cloud.classMembersPull().then((x) => x.length), 0);
    assert.strictEqual((await cloud.fbPull()).length, 0);
    rejected = false;
    try { await cloud.ttFetch(); } catch (e) { rejected = true; }
    assert.strictEqual(rejected, true);
    assert.strictEqual(reqLog.length, 0, '无身份时不应发出任何请求');
  });

  await test('身份：有身份时数据请求自动带 X-Class-Token', async () => {
    const { cloud } = cloudFresh();
    setIdentity(ID);
    reqImpl = ok([]);
    await cloud.cbGet('homework');
    const req = reqLog[0];
    assert.ok(req);
    assert.strictEqual(req.header.Authorization, 'Bearer pub');
    assert.strictEqual(req.header['X-Class-Token'], 'tok-test-1');
  });

  await test('身份：logout 清空身份与班级名单缓存并回身份页', () => {
    const { identity, store } = cloudFresh();
    setIdentity(ID);
    store.get().classMembers = MEMBERS.slice();
    store.get().classRoster = '1 甲';
    store.save();
    navLog = [];
    identity.logout();
    assert.strictEqual(identity.has(), false);
    assert.deepStrictEqual(store.get().classMembers, []);
    assert.strictEqual(store.get().classRoster, '');
    assert.ok(navLog.some((n) => n.type === 'reLaunch' && n.url === '/pages/identity/identity'));
  });

  /* ============================================================
     5. 云同步状态机（全部用假 wx.request）
     ============================================================ */
  await test('云：未启用时零请求、功能降级', async () => {
    const { cloud } = fresh();
    clearMem();
    cloud.configure({ enabled: false });
    let called = 0;
    reqImpl = () => { called++; };
    assert.strictEqual(cloud.isEnabled(), false);
    assert.deepStrictEqual(await cloud.cloudPull(), { off: true });
    assert.strictEqual(called, 0);
    assert.strictEqual((await cloud.classVerify('3260799999', '测试账号')).reason, '暂时无法连接云端，请稍后重试');
  });

  await test('云：发布作业失败进入待补发，恢复后 flush 清队列；带 owner=学号', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    reqImpl = ok([]);
    const it = { subject: '高数', content: '习题 1', due: '', date: '', author: '测试账号' };
    store.get().homework.push(it); store.save();
    reqImpl = failReq;
    assert.strictEqual(await cloud.hwPublish(it), false);
    assert.strictEqual(it._pending, true);
    assert.ok(cloud.pendCount() >= 1);
    reqImpl = ok([]);
    await cloud.flushPending();
    assert.strictEqual(it._pending, false);
    // 再次发布检查 owner
    reqLog = [];
    const it2 = { subject: '英语', content: 'x', author: '测试账号' };
    store.get().homework.push(it2); store.save();
    await cloud.hwPublish(it2);
    const post = reqsOf('/homework').filter((o) => o.method === 'POST')[0];
    assert.ok(post);
    assert.strictEqual(post.data[0].owner, ID.sid);
  });

  await test('云：hwPull 保留 pending/无 id 行，ntPull 同理', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    store.get().homework = [
      { id: 'a', content: '云端已有', _pending: false },
      { id: 'b', content: '待补发', _pending: true },
      { content: '本机无 id', _pending: false }
    ];
    store.save();
    reqImpl = ok([{ id: 'c', content: '云端新', archived: false }]);
    await cloud.hwPull();
    const ids = store.get().homework.map((x) => x.id || 'NOID');
    assert.ok(ids.indexOf('c') >= 0);
    assert.ok(ids.indexOf('b') >= 0);
    assert.ok(ids.indexOf('NOID') >= 0);
    assert.ok(ids.indexOf('a') < 0, '非 pending 且有 id 的本机行会被云端列表替换');
    store.get().notices = [{ id: 'n1', title: '旧', _pending: false }, { title: '无 id', _pending: false }];
    reqImpl = ok([{ id: 'n2', title: '云端', archived: false }]);
    await cloud.ntPull();
    assert.ok(store.get().notices.some((x) => x.id === 'n2'));
    assert.ok(store.get().notices.some((x) => !x.id));
  });

  await test('云：setMark 写云端（seat=学号）并清待补发；失败进队列', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    reqImpl = ok([]);
    assert.strictEqual(await cloud.setMark('hw', 'ref1', true), true);
    assert.strictEqual(store.get().hwDone.ref1, true);
    assert.strictEqual(cloud.pendCount(), 0);
    const req = reqLog.find((o) => urlOf(o).indexOf('/marks') >= 0 && o.method === 'POST');
    assert.ok(req);
    assert.strictEqual(req.data[0].seat, ID.sid);
    assert.strictEqual(req.data[0].id, ID.sid + '|hw|ref1');
    reqImpl = failReq;
    assert.strictEqual(await cloud.setMark('nt', 'ref2', true), false);
    assert.strictEqual(store.get().ntPin.ref2, true);
    assert.ok(store.get().markPend.some((p) => p.ref === 'ref2'));
  });

  await test('云：marksPull 按学号查询，用云端值覆盖本机、待补发优先', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    store.get().markPend = [{ seat: ID.sid, kind: 'hw', ref: 'x', val: true }];
    store.get().hwDone = { x: true, y: false };
    store.save();
    reqImpl = ok([{ kind: 'hw', ref: 'y', val: true }, { kind: 'nt', ref: 'z', val: true }]);
    await cloud.marksPull();
    const get = reqLog.find((o) => urlOf(o).indexOf('/marks?') >= 0 && o.method === 'GET');
    assert.ok(get);
    assert.ok(urlOf(get).indexOf('seat=eq.' + ID.sid) >= 0);
    assert.strictEqual(store.get().hwDone.y, true);
    assert.strictEqual(store.get().ntPin.z, true);
    assert.strictEqual(store.get().hwDone.x, true); // pending 覆盖
  });

  await test('云：班级名单只走 class_members，不再请求 roster 表', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    reqImpl = (o) => {
      if (urlOf(o).indexOf('/rpc/class_members') >= 0) return o.success({ statusCode: 200, data: MEMBERS });
      return ok([])(o);
    };
    const list = await cloud.classMembersPull();
    assert.strictEqual(list.length, 3);
    assert.strictEqual(store.get().classRoster.split('\n').length, 3);
    assert.strictEqual(reqsOf('/roster').length, 0, '不应再访问 public.roster');
    // ensureMembers 有缓存时不再重复请求
    reqLog = [];
    assert.strictEqual(await cloud.ensureMembers(false), true);
    assert.strictEqual(reqLog.length, 0);
  });

  await test('云：fitPull / fitPush / fitDelete 按学号（acc=sid）', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    reqImpl = (o) => {
      const u = urlOf(o);
      if (u.indexOf('/fitrecs') >= 0 && o.method === 'GET' && u.indexOf('id=eq.') >= 0) return o.success({ statusCode: 200, data: [{ id: 'r2', acc: ID.sid, arch: false }] });
      if (u.indexOf('/fitrecs') >= 0 && o.method === 'GET') return o.success({ statusCode: 200, data: [{ id: 'r1', acc: ID.sid, data: JSON.stringify({ id: 'r1', ts: 1, sex: 'm', gr: '12', fields: {}, total: 83, grade: '良好' }), arch: false, ts: 1 }] });
      return o.success({ statusCode: 201, data: [] });
    };
    const list = await cloud.fitPull();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(store.get().fitRecs[0].total, 83);
    const pullReq = reqLog.find((o) => urlOf(o).indexOf('/fitrecs?') >= 0 && o.method === 'GET');
    assert.ok(urlOf(pullReq).indexOf('acc=eq.' + ID.sid) >= 0);
    const rec = { id: 'r2', ts: 2, sex: 'f', gr: '34', fields: {}, total: 90, grade: '优秀', _sync: false };
    assert.strictEqual(await cloud.fitPush(rec), true);
    const pushReq = reqLog.find((o) => urlOf(o) === 'https://mock.test/v1/rdb/rest/fitrecs' && o.method === 'POST');
    assert.strictEqual(pushReq.data[0].acc, ID.sid);
    assert.strictEqual(await cloud.fitDelete('r2'), true);
  });

  await test('云：udSync 拉取→合并→应用→必要时推送（v6 新语义，返回 ok/changed/pushed）', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    // 1) 云端无行：本机默认配置合并后与云端不一致 → 推送一次 v6 blob（id=学号）
    reqImpl = (o) => {
      if (urlOf(o).indexOf('/userdata?') >= 0 && o.method === 'GET') return o.success({ statusCode: 200, data: [] });
      return o.success({ statusCode: 201, data: [] });
    };
    let r = await cloud.udSync(true);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.pushed, true);
    assert.strictEqual(r.changed, false);
    const pushReq = reqLog.find((o) => urlOf(o) === 'https://mock.test/v1/rdb/rest/userdata');
    assert.ok(pushReq, '云端无行时应推送');
    assert.strictEqual(pushReq.data[0].id, ID.sid);
    assert.ok(/resolution=merge-duplicates/.test(String(pushReq.header.Prefer || '')));
    const blob = pushReq.data[0].blob;
    const body = JSON.parse(blob);
    assert.strictEqual(body.v, 6);
    assert.deepStrictEqual(Object.keys(body.at), ['homeTools', 'fit', 'draw', 'group', 'roster', 'hide', 'tt', 'prefs', 'nick', 'power', 'water']);
    assert.strictEqual(body.homeToolsAt, body.at.homeTools);
    // 2) 云端与合并结果一致 → 不推送、changed=false
    reqLog = [];
    reqImpl = (o) => {
      if (urlOf(o).indexOf('/userdata?') >= 0 && o.method === 'GET') return o.success({ statusCode: 200, data: [{ id: ID.sid, blob: blob }] });
      return o.success({ statusCode: 200, data: [] });
    };
    r = await cloud.udSync(true);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.pushed, false);
    assert.strictEqual(r.changed, false);
    assert.strictEqual(reqLog.filter((o) => o.method === 'POST' && urlOf(o).indexOf('/userdata') >= 0).length, 0, '无差异不应再 POST');
    // 3) 远端 fit 更新（at 更大）→ 应用到本机，changed=true
    const remote = JSON.parse(blob);
    remote.fit = Object.assign({}, remote.fit, { h: '199' });
    remote.at.fit = Date.now() + 1000;
    reqImpl = (o) => {
      if (urlOf(o).indexOf('/userdata?') >= 0 && o.method === 'GET') return o.success({ statusCode: 200, data: [{ id: ID.sid, blob: JSON.stringify(remote) }] });
      return o.success({ statusCode: 201, data: [] });
    };
    r = await cloud.udSync(true);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.changed, true);
    assert.strictEqual(store.get().fit.h, '199');
    assert.strictEqual(cloud.udApply('not json'), false);
    cloud.udStop();
  });

  await test('云：反馈提交 acc=学号（contact 停收恒为空），拉取/标记已处理', async () => {
    const { cloud } = cloudFresh();
    assert.strictEqual((await cloud.fbSend('   ')).reason, '请先完成身份验证');
    setIdentity(ID2);
    assert.strictEqual((await cloud.fbSend('   ')).reason, '写点反馈内容');
    const posted = [];
    reqImpl = (o) => {
      if (o.method === 'POST') { const d = typeof o.data === 'string' ? JSON.parse(o.data) : o.data; posted.push(d[0]); }
      if (urlOf(o).indexOf('/feedback?') >= 0 && o.method === 'GET') return o.success({ statusCode: 200, data: [{ id: 'f1', content: 'x', done: false, acc: ID2.sid }] });
      return o.success({ statusCode: 201, data: [] });
    };
    const r = await cloud.fbSend('有个问题');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(posted[0].acc, ID2.sid);
    assert.strictEqual(posted[0].contact, '', '联系方式已停收：请求体 contact 必须为空串');
    const list = await cloud.fbPull();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(await cloud.fbDone('f1', list[0]), true);
  });

  await test('静态：反馈页已停收 QQ / 微信联系方式（页面 / 云端 / AI 接口）', () => {
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/fb/fb.wxml'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'pages/fb/fb.js'), 'utf8');
    const svc = fs.readFileSync(path.join(ROOT, 'ai/skills/account/apis/submitFeedback.js'), 'utf8');
    const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, 'ai/skills/account/mcp.json'), 'utf8'));
    assert.ok(!/联系方式|QQ \/ 微信/.test(wxml), '反馈页不应再出现联系方式输入框');
    assert.ok(!/onContact|data\.contact/.test(js), 'fb.js 不应再有 contact 输入 / 提交');
    assert.ok(!/MAX_CONTACT|a\.contact/.test(svc), 'AI submitFeedback 不应再处理 contact');
    const fbApi = (mcp.apis || []).filter((a) => a.name === 'submitFeedback')[0];
    assert.ok(fbApi, 'mcp.json 缺少 submitFeedback');
    assert.ok(!('contact' in (fbApi.inputSchema.properties || {})), 'submitFeedback 不应再声明 contact 参数');
  });

  await test('云：syncText 显示身份姓名与待补发计数', async () => {
    const { cloud, store } = cloudFresh();
    clearMem();
    assert.ok(/未验证身份/.test(cloud.syncText()));
    setIdentity(ID);
    store.get().homework = [{ id: 'x', content: 'x', _pending: true }];
    store.save();
    assert.ok(/测试账号/.test(cloud.syncText()));
    assert.ok(/待补发 1/.test(cloud.syncText()));
  });

  /* ============================================================
     5.5 通知页（v16 / 1.4.3）：职位气泡 + OCR 图片通知
     ============================================================ */
  await test('通知页：mapGroup 映射 senderName/senderRole/senderBadge/pubBadge 与 isOcr，筛选透传', async () => {
    const { cloud } = cloudFresh();
    setIdentity(ID);
    const PREFIX = '[[CLASS_NOTICE_V1]]';
    const rosterNotice = {
      id: 'auto_roster', title: '关于运动会期间晚自习的通知', cat: '通知', source: 'QQ 群',
      senderName: ' 测试庚 ', senderRole: '班长', senderBadge: '班委', ocr: true,
      aiSummary: '运动会期间晚自习正常', aiPoints: ['晚自习照常'],
      deadline: '2099-01-01T00:00:00+08:00',
      expireAt: '2099-01-01T00:00:00+08:00',
      items: [
        { kind: 'img', src: 'data:image/png;base64,AAAA', caption: '通知截图' },
        { kind: 'text', text: '运动会期间晚自习正常，请按时到班。' }
      ]
    };
    const plainNotice = {
      id: 'auto_plain', title: '图书馆闭馆通知', cat: '通知', source: 'QQ 群',
      senderName: '测试甲', deadline: '2099-01-02T00:00:00+08:00',
      items: [{ kind: 'text', text: '周日全馆检修。' }]
    };
    const badgeOnly = {
      id: 'auto_badgeonly', title: '只有徽章没有职务的旧数据', cat: '通知',
      senderName: '王小明', senderBadge: '班委', deadline: '2099-01-03T00:00:00+08:00',
      items: [{ kind: 'text', text: '旧数据兜底。' }]
    };
    const noSender = {
      id: 'auto_nosender', title: '无发布者的过期通知', cat: '活动',
      deadline: '2020-01-01T00:00:00+08:00',
      expireAt: '2020-01-01T00:00:00+08:00',
      items: [{ kind: 'follow', text: '补充：时间改到周五。' }]
    };
    reqImpl = ok([rosterNotice, plainNotice, badgeOnly, noSender].map((g) => ({ id: g.id, body: PREFIX + JSON.stringify(g) })));

    const captured = {};
    global.Page = (def) => { captured.def = def; };
    try { require(path.join(ROOT, 'pages/nt/nt.js')); } finally { delete global.Page; }
    const def = captured.def;
    assert.ok(def && typeof def.pull === 'function', 'nt 页未注册 Page');
    const ctx = {
      data: JSON.parse(JSON.stringify(def.data)),
      applyFilter: def.applyFilter,
      _rawById: def._rawById,
      ensureImgs() { /* 单测不落图片文件 */ },
      patchCard() {},
      setData(o, cb) { Object.assign(this.data, o); if (cb) cb(); }
    };
    ctx._raw = []; ctx._all = []; ctx._expanded = {}; ctx._done = {}; ctx._imgs = {}; ctx._loadingImgs = {};
    await def.pull.call(ctx);
    for (let i = 0; i < 50 && ctx.data.state === 'loading'; i++) await new Promise((r) => setTimeout(r, 10));

    assert.strictEqual(ctx.data.state, 'ready', 'pull 失败：' + ctx.data.errorText);
    const list = ctx.data.cards;
    assert.strictEqual(list.length, 3, '默认「待处理」应过滤掉已过期通知');
    const a = list.find((x) => x.id === 'auto_roster');
    assert.ok(a, '缺少班委发布的通知卡');
    assert.strictEqual(a.senderName, '测试庚', 'senderName 应去首尾空白');
    assert.strictEqual(a.senderRole, '班长', 'senderRole 应透传到卡片数据');
    assert.strictEqual(a.senderBadge, '班委', 'senderBadge 原始字段应保留');
    assert.strictEqual(a.pubBadge, '班长', '气泡文字 = senderRole（职位），不是「班委」');
    assert.strictEqual(a.isOcr, true, 'ocr:true → isOcr:true');
    assert.strictEqual(a.imgCount, 1, 'OCR 通知的图片仍计入 imgCount');
    assert.strictEqual(a.hasRaw, true, 'OCR 文字（kind:text）应能打开原始消息');
    assert.strictEqual(a.expanded, true, '未过期通知默认展开');
    const b = list.find((x) => x.id === 'auto_plain');
    assert.ok(b);
    assert.strictEqual(b.senderName, '测试甲');
    assert.strictEqual(b.senderRole, '');
    assert.strictEqual(b.senderBadge, '', '非班委 senderBadge 为空');
    assert.strictEqual(b.pubBadge, '', '非班委不应有气泡');
    assert.strictEqual(b.isOcr, false, '无 ocr 字段 = 普通通知');
    const c = list.find((x) => x.id === 'auto_badgeonly');
    assert.ok(c);
    assert.strictEqual(c.senderRole, '');
    assert.strictEqual(c.pubBadge, '班委', 'senderRole 为空时气泡退回 senderBadge（旧数据兜底）');
    assert.ok(ctx.data.expiredCards.every((x) => !x.expanded), '已过期通知默认收起');

    // 全部：未过期在主列表，已过期进独立区块
    ctx.data.cat = '全部'; ctx.data.filter = 'all';
    def.applyFilter.call(ctx);
    assert.strictEqual(ctx.data.cards.length, 3);
    assert.strictEqual(ctx.data.expiredCards.length, 1);
    const ocrRow = ctx.data.cards.find((x) => x.id === 'auto_roster');
    assert.strictEqual(ocrRow.senderBadge, '班委');
    assert.strictEqual(ocrRow.senderRole, '班长');
    assert.strictEqual(ocrRow.pubBadge, '班长', 'applyFilter 应透传 pubBadge');
    assert.strictEqual(ocrRow.isOcr, true);
    const emptyRow = ctx.data.expiredCards.find((x) => x.id === 'auto_nosender');
    assert.strictEqual(emptyRow.senderName, '', '无 senderName 时发布者行不渲染');
    assert.strictEqual(emptyRow.pubBadge, '');
    assert.strictEqual(emptyRow.isOcr, false);

    // 已截止筛选：只显示过期通知
    ctx.data.filter = 'expired';
    def.applyFilter.call(ctx);
    assert.strictEqual(ctx.data.cards.length, 1);
    assert.strictEqual(ctx.data.cards[0].id, 'auto_nosender');
    assert.strictEqual(ctx.data.showExpiredWrap, false);
  });

  await test('通知页：职位气泡在姓名前、原始消息发送者气泡、OCR 标记条件、展开后懒加载图片', () => {
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/nt/nt.wxml'), 'utf8');
    // .nt-sub 内允许有嵌套 view（如 .nt-src 来源行），不能用非贪婪 `[\s\S]*?</view>` 截到第一个 </view>；
    // 这里按「.nt-sub 起始 → 下一个同级块 .nt-recur 起始」切片，断言范围仍是完整的发布者行。
    const subStart = wxml.indexOf('<view class="nt-sub">');
    const subEnd = subStart < 0 ? -1 : wxml.indexOf('<view wx:if="{{card.recurring', subStart);
    assert.ok(subStart >= 0 && subEnd > subStart, 'wxml 缺少发布者行 .nt-sub（或其后缺少 .nt-recur 锚点）');
    const sub = subStart >= 0 ? wxml.slice(subStart, subEnd) : '';
    assert.ok(/<text wx:if="\{\{card\.pubBadge\}\}" class="nt-role">/.test(sub), '气泡应以 pubBadge（职务）为渲染条件');
    assert.ok(/<text wx:if="\{\{card\.senderName\}\}" class="nt-who">/.test(sub), '发布者行应以 senderName 为渲染条件');
    assert.ok(!/班委/.test(sub), '发布者行不应出现「班委」统称文案');
    assert.ok(sub.indexOf('nt-role') < sub.indexOf('nt-who'), '职位气泡必须在姓名前面');
    assert.ok(/<text wx:if="\{\{card\.isOcr\}\}" class="nt-ocr">OCR<\/text>/.test(wxml), 'OCR 通知标题旁缺 OCR 小标记');
    // 原始消息发送者：类型 + 职位气泡 + 姓名
    const rawHd = wxml.match(/<view class="nt-raw-hd">[\s\S]*?<\/view>/);
    assert.ok(rawHd, '原始消息弹层缺发送者行 .nt-raw-hd');
    assert.ok(/<text wx:if="\{\{item\.fromBadge\}\}" class="nt-role">/.test(rawHd[0]), '原始消息气泡应以 fromBadge（fromRole 优先）为渲染条件');
    assert.ok(/<text wx:if="\{\{item\.fromName\}\}" class="nt-who">/.test(rawHd[0]), '原始消息应显示发送者姓名');

    fresh(); // 清模块缓存，重新注册页面
    let def = null;
    global.Page = (d) => { def = d; };
    try { require(path.join(ROOT, 'pages/nt/nt.js')); } finally { delete global.Page; }
    assert.ok(def, 'nt 页未注册 Page');
    const group = {
      id: 'auto_ocr_raw', title: 'OCR 通知',
      items: [
        { kind: 'img', src: 'data:image/png;base64,AAAA', caption: '截图' },
        { kind: 'text', fromName: '林睿琪', fromRole: '学习委员', fromBadge: '班委', text: '运动会期间晚自习正常。' },
        { kind: 'follow', fromName: '测试庚', fromRole: '', fromBadge: '班委', text: '补充：地点改到 A301。' },
        { kind: 'follow', fromName: '甘子怡', text: '收到。' }
      ]
    };
    // 原始消息弹层：只显示 text/follow（OCR 文字在 text 里）；发送者气泡用 fromRole || fromBadge
    const rawCtx = {
      data: JSON.parse(JSON.stringify(def.data)), _raw: [group],
      _rawById: def._rawById, setData(o) { Object.assign(this.data, o); }
    };
    def.openRaw.call(rawCtx, { currentTarget: { dataset: { gid: 'auto_ocr_raw' } } });
    assert.strictEqual(rawCtx.data.rawSheet, true);
    const blocks = rawCtx.data.rawBlocks;
    assert.strictEqual(blocks.length, 3);
    assert.ok(blocks[0].text.indexOf('晚自习正常') >= 0, 'OCR 文字应进入原始消息弹层');
    assert.strictEqual(blocks[0].type, '原始消息');
    assert.strictEqual(blocks[0].fromName, '林睿琪');
    assert.strictEqual(blocks[0].fromBadge, '学习委员', '发送者气泡 = fromRole（不是「班委」）');
    assert.strictEqual(blocks[1].type, '补充通知');
    assert.strictEqual(blocks[1].fromBadge, '班委', 'fromRole 为空时退回 fromBadge');
    assert.strictEqual(blocks[2].fromName, '甘子怡');
    assert.strictEqual(blocks[2].fromBadge, '', '无职位/徽章时只显示姓名');

    // 展开卡片：切换状态并触发图片懒加载
    const patched = {};
    let ensured = '';
    const detailCtx = {
      data: { cards: [{ id: 'auto_ocr_raw', imgCount: 1, expanded: false }] },
      _expanded: {}, _imgs: {}, _loadingImgs: {}, _raw: [group],
      _rawById: def._rawById, _cardById: def._cardById,
      patchCard(gid, p) { patched[gid] = Object.assign(patched[gid] || {}, p); },
      ensureImgs(gid) { ensured = gid; },
      setData(o) { Object.assign(this.data, o); }
    };
    def.toggleDetail.call(detailCtx, { currentTarget: { dataset: { gid: 'auto_ocr_raw' } } });
    assert.strictEqual(detailCtx._expanded['auto_ocr_raw'], true);
    assert.strictEqual(patched['auto_ocr_raw'].expanded, true);
    assert.strictEqual(ensured, 'auto_ocr_raw', '展开后才加载图片');
  });

  /* ============================================================
     6. 访问统计（visits，按账号；契约 2026-11-20 ver/dev 详细统计）
     ============================================================ */
  function loadStatsPage() {
    let def = null;
    const file = path.join(ROOT, 'pages/stats/stats.js');
    try { delete require.cache[require.resolve(file)]; } catch (e) { /* ignore */ }
    global.Page = (d) => { def = d; };
    try { require(file); } finally { delete global.Page; }
    return def;
  }
  function statsCtx(def, rows, range) {
    const ctx = {
      data: JSON.parse(JSON.stringify(def.data)),
      _rows: rows,
      lastPayload: null,
      setData(o, cb) {
        this.lastPayload = Object.keys(o);
        Object.assign(this.data, o);
        if (cb) cb();
      }
    };
    ctx.data.range = range || 'today';
    return ctx;
  }

  await test('统计：visitLog 写 ver/dev（品牌不重复/回退系统信息/最终微信小程序），仍按账号+端每小时去重', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    reqImpl = ok([]);
    const version = require(path.join(ROOT, 'utils/version.js'));
    const rowsOf = () => reqLog.filter((o) => urlOf(o).indexOf('/visits') >= 0);
    const lastRow = () => rowsOf()[rowsOf().length - 1].data[0];
    const clearDedupe = () => { mem['zq_visit_slot_' + ID.sid + '_mp'] = ''; };
    const hadDevice = Object.prototype.hasOwnProperty.call(wx, 'getDeviceInfo');
    const oldDevice = wx.getDeviceInfo;
    const hadSystem = Object.prototype.hasOwnProperty.call(wx, 'getSystemInfoSync');
    const oldSystem = wx.getSystemInfoSync;
    try {
      wx.getDeviceInfo = () => ({ brand: 'Xiaomi', model: 'Xiaomi 14', system: 'Android 15' });
      assert.strictEqual(await cloud.visitLog(), true);
      const req = rowsOf()[0];
      assert.ok(req);
      const row = req.data[0];
      assert.strictEqual(req.header['X-Class-Token'], ID.token);
      assert.strictEqual(row.sid, ID.sid);
      assert.strictEqual(row.name, ID.name);
      assert.ok(/^\d{4}-\d{2}-\d{2}-\d{2}$/.test(row.slot));
      assert.strictEqual(row.id, ID.sid + '|' + row.slot + '|mp');
      assert.strictEqual(row.client, 'mp', '记录具体登录端');
      assert.strictEqual(row.did, store.get().did);
      assert.strictEqual(row.ver, version.VERSION, 'ver 取 utils/version.js 的 VERSION');
      assert.strictEqual(row.dev, 'Xiaomi 14 · Android 15', '型号已含品牌时不重复品牌');
      assert.ok(row.dev.length > 0 && row.dev.length <= 48, '设备短标签非空且 ≤48：' + row.dev);
      assert.ok(row.ts > 0);
      reqLog = [];
      assert.strictEqual(await cloud.visitLog(), false, '同一小时同一账号不重复上报');
      assert.strictEqual(reqLog.length, 0);

      // wx.getDeviceInfo 不可用 → wx.getSystemInfoSync
      clearDedupe();
      wx.getDeviceInfo = () => { throw new Error('no deviceInfo'); };
      wx.getSystemInfoSync = () => ({ brand: 'Apple', model: 'iPhone 15', system: 'iOS 18.1' });
      assert.strictEqual(await cloud.visitLog(), true);
      assert.strictEqual(lastRow().dev, 'Apple iPhone 15 · iOS 18.1', '回退 getSystemInfoSync');

      // 两个 API 都失败 → 「微信小程序」
      clearDedupe();
      wx.getSystemInfoSync = () => { throw new Error('no systemInfo'); };
      assert.strictEqual(await cloud.visitLog(), true);
      assert.strictEqual(lastRow().dev, '微信小程序', '设备信息全拿不到时写微信小程序');
      assert.ok(lastRow().dev.length <= 48);

      // 超长信息截断到 48，且不阻断上报
      clearDedupe();
      wx.getDeviceInfo = () => ({ brand: 'BrandName', model: 'Model-' + 'X'.repeat(80), system: 'System-' + 'Y'.repeat(20) });
      assert.strictEqual(await cloud.visitLog(), true);
      assert.strictEqual(lastRow().dev.length, 48, '设备标签截断 48');
      assert.strictEqual(lastRow().ver, version.VERSION);
      assert.strictEqual(lastRow().ver.length <= 32, true);
    } finally {
      if (hadDevice) wx.getDeviceInfo = oldDevice; else delete wx.getDeviceInfo;
      if (hadSystem) wx.getSystemInfoSync = oldSystem; else delete wx.getSystemInfoSync;
    }
  });

  await test('统计：statsPull 仅管理员可查，普通账号零请求；查询含 client,ver,dev,did', async () => {
    const { cloud } = cloudFresh();
    setIdentity(ID2);
    reqImpl = ok([{ id: 'x', slot: '2026-11-04-10', sid: ID2.sid, name: ID2.name, ts: 1 }]);
    assert.deepStrictEqual(await cloud.statsPull('2026-10-29-00'), []);
    assert.strictEqual(reqLog.length, 0, '普通账号不应请求统计接口');
    setIdentity(ID);
    const rows = await cloud.statsPull('2026-10-29-00');
    assert.strictEqual(rows.length, 1);
    const req = reqLog[0];
    assert.strictEqual(req.header['X-Class-Token'], ID.token);
    const url = urlOf(req);
    assert.ok(url.indexOf('select=slot,sid,name,ts,client,ver,dev,did') >= 0, '查询字段顺序按契约：' + url);
    assert.ok(url.indexOf('slot=gte.2026-10-29-00') >= 0);
    assert.ok(url.indexOf('order=ts.desc') >= 0);
    assert.ok(url.indexOf('limit=5000') >= 0);
  });

  await test('统计：canDelete 管理员全可删，发布者按 owner=学号，其余不可删', () => {
    const { cloud } = cloudFresh();
    setIdentity(ID);
    assert.strictEqual(cloud.canDelete({ id: 'x', owner: 'someone' }), true);
    setIdentity(ID2);
    assert.strictEqual(cloud.canDelete({ id: 'x', owner: ID2.sid }), true);
    assert.strictEqual(cloud.canDelete({ id: 'x', owner: 'other' }), false);
    assert.strictEqual(cloud.canDelete({ content: '本机未上云' }), true);
  });

  await test('统计页：摘要/趋势/登录端/版本/设备/账号明细聚合（过滤、排序、旧行未记录、展开）', () => {
    const def = loadStatsPage();
    assert.ok(def && typeof def.render === 'function' && typeof def.toggleRow === 'function', 'stats 页未注册 Page');
    assert.strictEqual(def.data.range, 'today', '默认打开今天');
    setIdentity(ID);
    const now = new Date();
    const p2 = (n) => ('0' + n).slice(-2);
    const ymd = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    const day = (off) => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - off));
    const at = (off, h, m) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - off, h, m, 0, 0).getTime();
    const fmt = (ts) => { const d = new Date(ts); return p2(d.getMonth() + 1) + '/' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
    const today = day(0), yest = day(1);
    // 纯虚构 9000 段聚合夹具（9999 段会被当作测试账号过滤），不出现任何真实学号。
    const rows = [
      // 张三：今天网页 2 次（同一设备 d1）+ 安卓 1 次；昨天网页 1 次（1.0.8）→ 4 次
      { slot: today + '-10', sid: '9000000001', name: '张三', did: 'd1', client: 'web', ver: '2.0.0', dev: 'Windows · Edge 131', ts: at(0, 10, 42) },
      { slot: today + '-10', sid: '9000000001', name: '张三', did: 'd1', client: 'web', ver: '2.0.0', dev: 'Windows · Edge 131', ts: at(0, 10, 50) },
      { slot: today + '-11', sid: '9000000001', name: '张三', did: 'd2', client: 'android', ver: '2.0.0', dev: 'Xiaomi 14 · Android 15', ts: at(0, 11, 5) },
      { slot: yest + '-20', sid: '9000000001', name: '张三', did: 'd1', client: 'web', ver: '1.0.8', dev: 'Windows · Edge 131', ts: at(1, 20, 0) },
      // 李四：今天小程序 1 次
      { slot: today + '-09', sid: '9000000002', name: '李四', did: 'd3', client: 'mp', ver: '1.0.0-beta14', dev: 'Apple iPhone 15 · iOS 18.1', ts: at(0, 9, 7) },
      // 王五：旧行（无 ver/dev/did）网页 2 次 + 昨天 win 1 次 → 旧数据「未记录」
      { slot: today + '-07', sid: '9000000003', name: '王五', client: 'web', ts: at(0, 7, 0) },
      { slot: today + '-07', sid: '9000000003', name: '王五', client: 'web', ts: at(0, 7, 30) },
      { slot: yest + '-20', sid: '9000000003', name: '王五', client: 'win', ts: at(1, 20, 15) },
      // 赵六：空 client 旧行（显示未记录）+ 版本/设备有值
      { slot: today + '-09', sid: '9000000004', name: '赵六', did: '', client: '', ver: '1.0.8', dev: 'Xiaomi 14 · Android 15', ts: at(0, 9, 7) },
      // 过滤项：官方测试 / 9999 段 / 匿名 / 未来 / 7 天窗口外
      { slot: today + '-09', sid: '3260799999', name: '测试账号', client: 'mp', ts: at(0, 9, 3) },
      { slot: today + '-08', sid: '9999000001', name: '测试同学', client: 'mp', ts: at(0, 8, 4) },
      { slot: today + '-10', sid: '', name: '未知账号', did: 'd9', client: 'web', ts: at(0, 10, 1) },
      { slot: today + '-10', sid: '   ', name: '', client: 'web', ts: at(0, 10, 2) },
      { slot: today + '-12', sid: '9000000001', name: '张三', client: 'web', ver: '9.9.9', dev: 'Future', ts: at(-1, 12, 0) },
      { slot: day(7) + '-10', sid: '9000000005', name: '旧数据', client: 'web', ts: at(7, 10, 0) }
    ];
    const ctx = statsCtx(def, rows, 'week');
    def.render.call(ctx);

    // —— 汇总 4 格（近 7 天）——
    assert.deepStrictEqual(ctx.data.summary, { accounts: 4, visits: 9, activeToday: 4, devices: 6 }, JSON.stringify(ctx.data.summary));

    // —— 账号排序：count 降序 → lastTs 降序 → name 升序 ——
    assert.deepStrictEqual(ctx.data.accounts.map((a) => a.name), ['张三', '王五', '李四', '赵六']);
    assert.strictEqual(ctx.data.accounts[0].count, 4);
    assert.strictEqual(ctx.data.accounts[0].pct, 100, '账号条分母 = 最大账号次数');
    assert.strictEqual(ctx.data.accounts[1].pct, 75);
    assert.strictEqual(ctx.data.accounts[2].pct, 25);
    assert.strictEqual(ctx.data.accounts[0].sid, undefined, '统计页不展示学号');

    // —— 张三：最近端/版本/设备 + 活跃天数 + 详情文本 + 展开数据 ——
    const zs = ctx.data.accounts[0];
    assert.strictEqual(zs.clientText, '安卓');
    assert.strictEqual(zs.verText, '2.0.0');
    assert.strictEqual(zs.devText, 'Xiaomi 14 · Android 15');
    assert.strictEqual(zs.lastText, fmt(at(0, 11, 5)));
    assert.strictEqual(zs.firstText, fmt(at(1, 20, 0)));
    assert.strictEqual(zs.activeDays, 2);
    assert.strictEqual(zs.activeToday, true);
    assert.strictEqual(zs.deviceCount, 2, 'did 去重：d1/d2');
    assert.strictEqual(zs.detailText, '活跃 2/7 天 · 首次 ' + fmt(at(1, 20, 0)) + ' · 最近 ' + fmt(at(0, 11, 5)));
    assert.deepStrictEqual(zs.clients.map((c) => [c.label, c.count, c.pct]), [['网页', 3, 75], ['安卓', 1, 25]]);
    assert.deepStrictEqual(zs.versions.map((v) => [v.label, v.count, v.pct]), [['2.0.0', 3, 75], ['1.0.8', 1, 25]]);
    assert.strictEqual(zs.devices.length, 2);
    assert.strictEqual(zs.devices[0].label, '网页');
    assert.strictEqual(zs.devices[0].devLabel, 'Windows · Edge 131');
    assert.strictEqual(zs.devices[0].count, 3);
    assert.strictEqual(zs.devices[1].devLabel, 'Xiaomi 14 · Android 15');
    assert.strictEqual(zs.clientDetail, '网页 3 · 安卓 1');
    assert.strictEqual(zs.versionDetail, '2.0.0 ×3 · 1.0.8 ×1');

    // —— 旧行：无 ver/dev 显示未记录；无 did 时 client|dev 兜底设备数 ——
    const ww = ctx.data.accounts[1];
    assert.strictEqual(ww.clientText, '网页');
    assert.strictEqual(ww.verText, '未记录');
    assert.strictEqual(ww.devText, '未记录');
    assert.strictEqual(ww.versions[0].label, '未记录');
    assert.strictEqual(ww.versions[0].count, 3);
    assert.strictEqual(ww.deviceCount, 2, '无 did 按 client|dev 兜底');
    assert.deepStrictEqual(ww.devices.map((d) => d.devLabel), ['未记录', '未记录']);
    assert.ok(ww.devices.every((d) => d.dev === '未记录'), 'devices[].dev 空值写未记录');
    assert.strictEqual(ctx.data.accounts[3].clientText, '未记录', '空 client 显示未记录');

    // —— 趋势：近 7 天 7 根（今天高亮 / 次数口径）——
    assert.strictEqual(ctx.data.trend.length, 7);
    assert.deepStrictEqual(ctx.data.trend.map((b) => b.count), [0, 0, 0, 0, 0, 2, 7]);
    assert.strictEqual(ctx.data.trend[6].isToday, true);
    assert.strictEqual(ctx.data.trend[6].label, p2(now.getMonth() + 1) + '/' + p2(now.getDate()));
    assert.strictEqual(ctx.data.trend.filter((b) => b.isToday).length, 1);

    // —— 登录端堆叠（含空 client「未记录」）——
    assert.strictEqual(ctx.data.clients[0].label, '网页');
    assert.strictEqual(ctx.data.clients[0].count, 5);
    assert.strictEqual(ctx.data.clients[0].color, '#4E9082');
    const unknownClient = ctx.data.clients.filter((c) => c.label === '未记录');
    assert.strictEqual(unknownClient.length, 1, '空 client 合并为未记录');
    assert.strictEqual(unknownClient[0].count, 1);
    assert.strictEqual(unknownClient[0].color, '#9AA5A1');
    assert.strictEqual(ctx.data.clients.reduce((s, c) => s + c.pct, 0), 100, '最后一段补齐到 100%');

    // —— 版本 / 设备分布（全局，最多 6 行 + 其他）——
    assert.deepStrictEqual(ctx.data.versions.map((v) => [v.label, v.count]), [['2.0.0', 3], ['未记录', 3], ['1.0.8', 2], ['1.0.0-beta14', 1]]);
    assert.strictEqual(ctx.data.versions.reduce((s, v) => s + v.pct, 0), 100);
    assert.strictEqual(ctx.data.devicesList.length, 6);
    assert.strictEqual(ctx.data.devicesList[0].label, '网页');
    assert.strictEqual(ctx.data.devicesList[0].devLabel, 'Windows · Edge 131');
    assert.strictEqual(ctx.data.devicesList[0].count, 3);
    assert.strictEqual(ctx.data.devicesList[1].devLabel, '未记录');
    assert.strictEqual(ctx.data.devicesList[1].count, 2);
    assert.strictEqual(ctx.data.devicesList.reduce((s, d) => s + d.pct, 0), 100);

    // —— 展开：一次只展开一个，setData 只更新 expandedKey ——
    assert.strictEqual(def.data.expandedKey, '');
    ctx.lastPayload = null;
    const k1 = ctx.data.accounts[0].key;
    def.toggleRow.call(ctx, { currentTarget: { dataset: { key: k1 } } });
    assert.strictEqual(ctx.data.expandedKey, k1);
    assert.deepStrictEqual(ctx.lastPayload, ['expandedKey'], '展开只 setData expandedKey');
    const k2 = ctx.data.accounts[1].key;
    def.toggleRow.call(ctx, { currentTarget: { dataset: { key: k2 } } });
    assert.strictEqual(ctx.data.expandedKey, k2, '切换账号时上一个自动收起');
    def.toggleRow.call(ctx, { currentTarget: { dataset: { key: k2 } } });
    assert.strictEqual(ctx.data.expandedKey, '', '再点同一行收起');

    // WXML 只渲染：展开条件 / 行点击 / 不再有模式切换
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/stats/stats.wxml'), 'utf8');
    assert.ok(/bindtap="toggleRow"/.test(wxml), '账号行绑定展开');
    assert.ok(/expandedKey === item\.key/.test(wxml), 'WXML 用 expandedKey 判断展开');
    assert.ok(!/st-fgroup--mode/.test(wxml) && !/setMode/.test(wxml), '不再有按账号/天/小时模式切换');

    /* —— 今天口径：只保留今天的行；detailText 省略活跃段 —— */
    ctx.data.range = 'today';
    def.render.call(ctx);
    assert.deepStrictEqual(ctx.data.summary, { accounts: 4, visits: 7, activeToday: 4, devices: 5 }, JSON.stringify(ctx.data.summary));
    assert.deepStrictEqual(ctx.data.accounts.map((a) => [a.name, a.count]), [['张三', 3], ['王五', 2], ['李四', 1], ['赵六', 1]]);
    assert.strictEqual(ctx.data.accounts[0].activeDays, 1);
    assert.strictEqual(ctx.data.accounts[0].detailText, '首次 ' + fmt(at(0, 10, 42)) + ' · 最近 ' + fmt(at(0, 11, 5)));
    assert.strictEqual(ctx.data.trend.length, 24);
    assert.strictEqual(ctx.data.trend[0].label, '00');
    assert.strictEqual(ctx.data.trend[23].label, '23');
    assert.strictEqual(ctx.data.trend[7].count, 2);
    assert.strictEqual(ctx.data.trend[9].count, 2);
    assert.strictEqual(ctx.data.trend[10].count, 2);
    assert.strictEqual(ctx.data.trend[11].count, 1);
    assert.strictEqual(ctx.data.trend[7].showLabel, false);
    assert.strictEqual(ctx.data.trend[9].showLabel, true);
  });

  await test('统计页：版本/设备超过 6 组 → 6 行 + 其他，占比补齐 100%', () => {
    const def = loadStatsPage();
    setIdentity(ID);
    const now = new Date();
    const p2 = (n) => ('0' + n).slice(-2);
    const today = now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate());
    const ts = Math.max(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), now.getTime() - 60000);
    const rows = [];
    for (let i = 1; i <= 8; i++) {
      rows.push({
        slot: today + '-12', sid: '9000000009', name: '测试成员', did: '',
        client: 'web', ver: '1.0.' + i, dev: 'Test Phone ' + i, ts: ts + i
      });
    }
    const ctx = statsCtx(def, rows, 'today');
    def.render.call(ctx);
    assert.strictEqual(ctx.data.accounts.length, 1);
    assert.strictEqual(ctx.data.accounts[0].versions.length, 7, '账号版本 6 + 其他');
    assert.strictEqual(ctx.data.accounts[0].versions[6].isOther, true);
    assert.strictEqual(ctx.data.accounts[0].versions[6].count, 2);
    assert.strictEqual(ctx.data.accounts[0].devices.length, 7, '账号设备 6 + 其他');
    assert.strictEqual(ctx.data.versions.length, 7, '全局版本 6 + 其他');
    assert.strictEqual(ctx.data.versions[6].isOther, true);
    assert.strictEqual(ctx.data.versions[6].count, 2);
    assert.strictEqual(ctx.data.devicesList.length, 7, '全局设备 6 + 其他');
    assert.strictEqual(ctx.data.devicesList[6].isOther, true);
    assert.strictEqual(ctx.data.devicesList[6].devLabel, '其余 2 类');
    assert.strictEqual(ctx.data.summary.devices, 8, '8 个不同 client|dev');
    assert.strictEqual(ctx.data.versions.reduce((s, v) => s + v.pct, 0), 100);
    assert.strictEqual(ctx.data.devicesList.reduce((s, d) => s + d.pct, 0), 100);
  });

  await test('统计页：空态摘要归零、按范围显示今天/近 7 天暂无访问（不渲染空图表）', () => {
    const def = loadStatsPage();
    const ctx = statsCtx(def, [], 'today');
    def.render.call(ctx);
    assert.strictEqual(ctx.data.state, 'empty');
    assert.deepStrictEqual(ctx.data.summary, { accounts: 0, visits: 0, activeToday: 0, devices: 0 });
    assert.strictEqual(ctx.data.accounts.length, 0);
    assert.strictEqual(ctx.data.clients.length, 0);
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/stats/stats.wxml'), 'utf8');
    assert.ok(/wx:if="\{\{state === 'empty'\}\}"/.test(wxml), '空态使用独立分支');
    assert.ok(wxml.indexOf('今天暂无访问') >= 0 && wxml.indexOf('近 7 天暂无访问') >= 0, '空态文案随范围变化');
  });

  await test('统计页：账号明细最多 120 条，超出截断并标记 truncated（汇总是全量）', () => {
    const def = loadStatsPage();
    setIdentity(ID);
    const now = new Date();
    const p2 = (n) => ('0' + n).slice(-2);
    const today = now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate());
    const ts = Math.max(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), now.getTime() - 60000);
    const rows = [];
    for (let i = 0; i < 121; i++) {
      rows.push({
        slot: today + '-12', sid: '8000' + ('00000' + i).slice(-6), name: '测试成员' + ('000' + i).slice(-3),
        did: 'did' + i, client: 'web', ver: '2.0.0', dev: 'Windows · Edge 131', ts: ts
      });
    }
    const ctx = statsCtx(def, rows, 'today');
    def.render.call(ctx);
    assert.strictEqual(ctx.data.summary.accounts, 121, '摘要账号数为全量');
    assert.strictEqual(ctx.data.summary.visits, 121);
    assert.strictEqual(ctx.data.accounts.length, 120, '账号明细截断到 120');
    assert.strictEqual(ctx.data.truncated, true);
    assert.strictEqual(ctx.data.accounts[0].name, '测试成员000', '同次数同时间按姓名升序');
    assert.strictEqual(ctx.data.accounts[119].name, '测试成员119');
    assert.strictEqual(ctx.data.summary.devices, 121);
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/stats/stats.wxml'), 'utf8');
    assert.ok(wxml.indexOf('仅显示前 120 个账号') >= 0, 'WXML 有截断提示');
  });

  /* ============================================================
     7. 课表请求统一出口
     ============================================================ */
  await test('课表：ttFetch 优先 CloudBase site_assets（带班级 token；body 字符串解析），返回与 tt.json 同构', async () => {
    const { cloud } = cloudFresh();
    setIdentity(ID);
    // 新契约（2026-11-07）：POST 改读 CloudBase public.site_assets id='tt' 行；body 可能是 JSON 字符串
    reqImpl = (o) => {
      if (urlOf(o).indexOf('/site_assets?') >= 0) {
        return o.success({
          statusCode: 200,
          data: [{ body: JSON.stringify({ c: [{ name: '高数', day: 0, start: 1, end: 2 }], t: '2026-09-07', meta: { fetchedAt: 1 } }), meta: { source: 'jwxt' } }]
        });
      }
      return o.fail({ errMsg: 'request:fail mock' });     // 不应回退 legacy
    };
    const body = await cloud.ttFetch();
    assert.strictEqual(body.c.length, 1);
    assert.strictEqual(body.t, '2026-09-07');
    assert.deepStrictEqual(body.meta, { fetchedAt: 1 }, 'body 解析后应与旧 tt.json 同构（含 meta）');
    assert.strictEqual(reqLog.length, 1, 'CloudBase 成功时不应再回退 legacy ttUrl');
    const req = reqLog[0];
    assert.strictEqual(urlOf(req), 'https://mock.test/v1/rdb/rest/site_assets?select=body,meta&id=eq.tt');
    assert.strictEqual(req.method, 'GET');
    assert.strictEqual(req.header.Authorization, 'Bearer pub');
    assert.strictEqual(req.header['X-Class-Token'], ID.token, 'site_assets 走统一通道，必须带班级 token');
  });

  await test('课表：site_assets 失败（404/空行/格式错/旧配置无表）→ 回退 legacy ttUrl（不带 token）', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    // A) CloudBase 404 → 回退旧 tt.json（不带身份头）
    reqImpl = (o) => {
      if (urlOf(o).indexOf('/site_assets?') >= 0) return o.success({ statusCode: 404, data: {} });
      if (urlOf(o).indexOf('/tt.json') >= 0) return o.success({ statusCode: 200, data: { c: [{ name: '英语', day: 2, start: 3, end: 4 }], t: '2026-09-07' } });
      return o.fail({ errMsg: 'request:fail mock' });
    };
    const body = await cloud.ttFetch();
    assert.strictEqual(body.c.length, 1);
    assert.strictEqual(body.t, '2026-09-07');
    assert.strictEqual(reqLog.length, 2, '先 site_assets 再 legacy：' + reqLog.length);
    const cbReq = reqLog[0], lgReq = reqLog[1];
    assert.ok(urlOf(cbReq).indexOf('/site_assets?') >= 0, '第一次应请求 site_assets');
    assert.strictEqual(cbReq.header['X-Class-Token'], ID.token);
    assert.strictEqual(urlOf(lgReq), 'https://static.test/tt.json', '失败后应回退 legacy ttUrl');
    assert.ok(!lgReq.header || !lgReq.header['X-Class-Token'], 'legacy tt.json 不应携带班级 token');

    // B) CloudBase 返回空行 → 回退 legacy（TTL 未命中，force=true 绕过）
    reqLog = [];
    reqImpl = (o) => {
      if (urlOf(o).indexOf('/site_assets?') >= 0) return o.success({ statusCode: 200, data: [] });
      if (urlOf(o).indexOf('/tt.json') >= 0) return o.success({ statusCode: 200, data: { c: [{ name: '物理' }], t: '2026-09-07' } });
      return o.fail({ errMsg: 'request:fail mock' });
    };
    const body2 = await cloud.ttFetch(true);
    assert.strictEqual(body2.c[0].name, '物理');
    assert.strictEqual(reqLog.length, 2);

    // C) 旧配置（没有 tables.siteAssets）→ 直接走 legacy，只 1 个请求
    cloud.configure({ tables: { siteAssets: '' } });
    store.get().ttCache = null;
    reqLog = [];
    reqImpl = (o) => {
      if (urlOf(o).indexOf('/site_assets?') >= 0) return o.fail({ errMsg: 'should-not-call' });
      return o.success({ statusCode: 200, data: { c: [{ name: '化学' }], t: '2026-09-07' } });
    };
    const body3 = await cloud.ttFetch(true);
    assert.strictEqual(body3.c[0].name, '化学');
    assert.strictEqual(reqLog.length, 1, '无 siteAssets 表名时不应尝试 CloudBase');
    assert.strictEqual(urlOf(reqLog[0]), 'https://static.test/tt.json');
  });

  /* ============================================================
     7b. 课表内容左右滑动（与网页端同款：跟手 + 吸附 + 飞出飞入）
     ============================================================ */
  await test('课表滑动：跟手位移 1:1（可切周）/ 0.28（第一周边界）', () => {
    const def = loadTtPage();
    let ctx = ttCtx(def);
    def.onSwipeStart.call(ctx, { touches: [{ clientX: 300, clientY: 400 }] });
    def.onSwipeMove.call(ctx, { touches: [{ clientX: 280, clientY: 401 }] });
    assert.ok(/translateX\(-20px\)/.test(ctx.data.swipeStyle), '跟手位移应为 -20px：' + ctx.data.swipeStyle);
    def.onSwipeCancel.call(ctx);

    ctx = ttCtx(def);
    ctx._wk = 1;
    ctx.refresh();
    assert.strictEqual(ctx.data.wk, 1);
    def.onSwipeStart.call(ctx, { touches: [{ clientX: 200, clientY: 400 }] });
    def.onSwipeMove.call(ctx, { touches: [{ clientX: 280, clientY: 401 }] });   // 向右 80px，已是第一周 → 阻尼
    assert.ok(/translateX\(22px\)/.test(ctx.data.swipeStyle), '边界应 0.28 阻尼（80×0.28≈22）：' + ctx.data.swipeStyle);
    def.onSwipeCancel.call(ctx);
  });

  await test('课表滑动：纵向/斜向手势不锁定、不产生位移', () => {
    const def = loadTtPage();
    const ctx = ttCtx(def);
    def.onSwipeStart.call(ctx, { touches: [{ clientX: 200, clientY: 300 }] });
    def.onSwipeMove.call(ctx, { touches: [{ clientX: 220, clientY: 320 }] });   // 20/20，不满足横向 1.35 倍
    assert.strictEqual(ctx.data.swipeStyle, '');
    assert.strictEqual(ctx._sw.live, false);
  });

  await test('课表滑动：左滑 80px → 飞出 → 换下一周 → 飞入（150/230ms 参数与网页一致）', async () => {
    const def = loadTtPage();
    const ctx = ttCtx(def);
    def.onSwipeStart.call(ctx, { touches: [{ clientX: 300, clientY: 400 }] });
    def.onSwipeMove.call(ctx, { touches: [{ clientX: 240, clientY: 400 }] });
    assert.ok(/translateX\(-60px\)/.test(ctx.data.swipeStyle), '跟手位移：' + ctx.data.swipeStyle);
    def.onSwipeEnd.call(ctx, { changedTouches: [{ clientX: 220, clientY: 400 }] });   // dx=-80 ≥ 56
    assert.ok(/translateX\(-187\.5px\);opacity:\.25;transition:transform \.16s ease/.test(ctx.data.swipeStyle), '旧内容先飞出：' + ctx.data.swipeStyle);
    await sleep(190);
    assert.strictEqual(ctx.data.wk, 6, '150ms 后应换到第 6 周');
    assert.ok(ctx.log.some((x) => x.wk === 6 && /translateX\(187\.5px\);opacity:0;transition:none/.test(x.swipeStyle || '')), '新周应从右侧进场');
    await sleep(160);
    assert.ok(/translateX\(0\);opacity:1;transition:transform \.23s cubic-bezier\(\.22,\.8,\.3,1\)/.test(ctx.data.swipeStyle), '飞入动画：' + ctx.data.swipeStyle);
    await sleep(300);
    assert.strictEqual(ctx.data.swipeStyle, '', '动画结束后应清空内联样式');
    assert.strictEqual(ctx._swAnim, false);
  });

  /* 2026-11-06 用户反馈：周六/周日有课时，周表要「优化显示比例」一屏看全（不能靠左右滑动看全）。
     列宽改为始终按卡片内宽自适应：colW = floor((TT_CARD_INNER - TT_PD_COL) / days.length)，
     5/6/7 天 = 106/89/76rpx，内容宽 96+days×colW = 626/630/628rpx ≤ 630rpx → 恒不横溢；
     6/7 天走 dense 缩放（课程名 2 行、字号下限 19rpx、7 天隐藏「第X-Y节」）。
     手势因此不再有「先滚表格、到边缘才切周」的 giveScroll 分支：任何横向手势都直接切周。 */
  function ttDaysCtx(def, dayCount, wk) {
    const ctx = ttCtx(def);
    ctx._courses = Array.from({ length: dayCount }).map((_, d) => ({
      name: '课' + d, day: d, start: 1, end: 2, weeks: '1-18', room: 'A' + d
    }));
    ctx._wk = wk || 9;
    ctx.refresh();                    // 真正 setData，data.colW/dense/dayCols 才是新周表的渲染数据
    ctx.data.view = 'week';
    ctx.data.wk = wk || 9;
    ctx.data.maxWeek = 18;
    return ctx;
  }

  await test('课表列宽：days=5/6/7 按卡片内宽自适应（106/89/76rpx），内容宽 ≤630rpx、不横向溢出、dense 标记正确', () => {
    const def = loadTtPage();
    const want = { 5: 106, 6: 89, 7: 76 };
    for (const n of [5, 6, 7]) {
      const ctx = ttDaysCtx(def, n, 9);
      assert.strictEqual(ctx.data.colW, want[n], n + ' 天 colW 应为 ' + want[n] + 'rpx');
      assert.strictEqual(ctx.data.colW, Math.floor((630 - 96) / n), n + ' 天 colW 应严格按卡片内宽取整');
      const contentW = 96 + n * ctx.data.colW;
      assert.ok(contentW <= 630, n + ' 天内容宽应 ≤630rpx（实际 ' + contentW + 'rpx）');
      assert.strictEqual(ctx._gridOverflow, false, n + ' 天周表不应横向溢出');
      assert.strictEqual(ctx._gridMaxX, 0, n + ' 天周表可横向滚动距离应为 0');
      assert.strictEqual(ctx.data.gridOverflow, false, 'WXML 使用的溢出标记应为 false');
      assert.strictEqual(ctx.data.dense, n >= 6, n + ' 天 dense 标记（6/7 天才缩放）');
      assert.strictEqual(ctx.data.dense7, n >= 7, n + ' 天 dense7 标记（7 天才隐藏「第X-Y节」）');
      assert.strictEqual(ctx.data.showSpan, n < 7, n + ' 天 showSpan');
      assert.strictEqual(ctx.data.dayCols.length, n, n + ' 天应有 ' + n + ' 个星期列');
      assert.strictEqual(ctx.data.head.length, n, n + ' 天应有 ' + n + ' 个星期表头（周六/周日不丢）');
    }
  });

  await test('课表滑动（6 天，周六有课）：任意位置直接切周（右滑上一周 / 左滑下一周），无 giveScroll', async () => {
    const def = loadTtPage();
    // 右滑 80px → 上一周
    let ctx = ttDaysCtx(def, 6, 9);
    def.onSwipeStart.call(ctx, { touches: [{ clientX: 200, clientY: 400 }] });
    def.onSwipeMove.call(ctx, { touches: [{ clientX: 260, clientY: 400 }] });
    assert.ok(/translateX\(60px\)/.test(ctx.data.swipeStyle), '右滑应 1:1 跟手（不再让给表格滚动）：' + ctx.data.swipeStyle);
    assert.ok(!ctx._sw.giveScroll, '新行为不应有 giveScroll 分支');
    def.onSwipeEnd.call(ctx, { changedTouches: [{ clientX: 280, clientY: 400 }] });   // dx=80 ≥ 56
    assert.ok(ctx._supTap > Date.now(), '切周手势后应进入点击抑制');
    await sleep(190);
    assert.strictEqual(ctx.data.wk, 8, '右滑应切到上一周（第 8 周）');
    await sleep(320);
    assert.strictEqual(ctx.data.swipeStyle, '');

    // 左滑 80px → 下一周
    ctx = ttDaysCtx(def, 6, 9);
    def.onSwipeStart.call(ctx, { touches: [{ clientX: 300, clientY: 400 }] });
    def.onSwipeMove.call(ctx, { touches: [{ clientX: 240, clientY: 400 }] });
    assert.ok(/translateX\(-60px\)/.test(ctx.data.swipeStyle), '左滑应 1:1 跟手：' + ctx.data.swipeStyle);
    def.onSwipeEnd.call(ctx, { changedTouches: [{ clientX: 220, clientY: 400 }] });
    await sleep(190);
    assert.strictEqual(ctx.data.wk, 10, '左滑应切到下一周（第 10 周）');
    await sleep(320);
  });

  await test('课表滑动（7 天，周六/周日有课）：同样直接切周；日视图不受宽度影响', async () => {
    const def = loadTtPage();
    // 左滑 → 下一周
    let ctx = ttDaysCtx(def, 7, 10);
    def.onSwipeStart.call(ctx, { touches: [{ clientX: 300, clientY: 400 }] });
    def.onSwipeMove.call(ctx, { touches: [{ clientX: 240, clientY: 400 }] });
    def.onSwipeEnd.call(ctx, { changedTouches: [{ clientX: 220, clientY: 400 }] });
    await sleep(190);
    assert.strictEqual(ctx.data.wk, 11);
    await sleep(320);
    // 右滑 → 上一周
    ctx = ttDaysCtx(def, 7, 10);
    def.onSwipeStart.call(ctx, { touches: [{ clientX: 200, clientY: 400 }] });
    def.onSwipeMove.call(ctx, { touches: [{ clientX: 260, clientY: 400 }] });
    def.onSwipeEnd.call(ctx, { changedTouches: [{ clientX: 280, clientY: 400 }] });
    await sleep(190);
    assert.strictEqual(ctx.data.wk, 9);
    await sleep(320);
    // 日视图：无横向表格，始终可滑
    const day = ttDaysCtx(def, 7, 10);
    day.data.view = 'day';
    def.onSwipeStart.call(day, { touches: [{ clientX: 300, clientY: 400 }] });
    assert.ok(day._sw && day._sw.live, '日视图应可滑');
    def.onSwipeMove.call(day, { touches: [{ clientX: 240, clientY: 400 }] });
    assert.ok(/translateX\(-60px\)/.test(day.data.swipeStyle), '日视图跟手位移：' + day.data.swipeStyle);
    def.onSwipeCancel.call(day);
  });

  await test('课表滑动（5 天对照，行为不变）：任意位置直接切周；onGridScroll 仍为防御性记录', async () => {
    const def = loadTtPage();
    const ctx = ttDaysCtx(def, 5, 9);
    assert.strictEqual(ctx.data.colW, 106, '5 天列宽仍为 106rpx（视觉不变）');
    assert.strictEqual(ctx._gridMaxX, 0);
    def.onGridScroll.call(ctx, { detail: { scrollLeft: 0 } });
    assert.strictEqual(ctx._gridX, 0);
    def.onSwipeStart.call(ctx, { touches: [{ clientX: 300, clientY: 400 }] });
    def.onSwipeMove.call(ctx, { touches: [{ clientX: 240, clientY: 400 }] });
    def.onSwipeEnd.call(ctx, { changedTouches: [{ clientX: 220, clientY: 400 }] });
    await sleep(190);
    assert.strictEqual(ctx.data.wk, 10, '5 天周表应可直接切周（与旧行为一致）');
    await sleep(320);
  });

  await test('课表滑动：首周向右滑 / 末周向左滑只阻尼回弹，不切周（6/7 天窄列同规则）', async () => {
    const def = loadTtPage();
    let ctx = ttDaysCtx(def, 6, 1);
    def.onSwipeStart.call(ctx, { touches: [{ clientX: 200, clientY: 400 }] });
    def.onSwipeMove.call(ctx, { touches: [{ clientX: 280, clientY: 400 }] });
    assert.ok(/translateX\(22px\)/.test(ctx.data.swipeStyle), '第一周应 0.28 阻尼：' + ctx.data.swipeStyle);
    def.onSwipeEnd.call(ctx, { changedTouches: [{ clientX: 280, clientY: 400 }] });
    assert.ok(/translateX\(0\)/.test(ctx.data.swipeStyle), '应只回弹');
    await sleep(260);
    assert.strictEqual(ctx.data.wk, 1);

    ctx = ttDaysCtx(def, 7, 18);
    def.onSwipeStart.call(ctx, { touches: [{ clientX: 300, clientY: 400 }] });
    def.onSwipeMove.call(ctx, { touches: [{ clientX: 220, clientY: 400 }] });
    assert.ok(/translateX\(-22px\)/.test(ctx.data.swipeStyle), '最后一周应 0.28 阻尼：' + ctx.data.swipeStyle);
    def.onSwipeEnd.call(ctx, { changedTouches: [{ clientX: 220, clientY: 400 }] });
    assert.ok(/translateX\(0\)/.test(ctx.data.swipeStyle));
    await sleep(260);
    assert.strictEqual(ctx.data.wk, 18);
  });

  await test('课表滑动：真实滑动后 320ms 内 tap 全被忽略（详情/星期/周按钮/视图/列表/导出），过期后恢复', async () => {
    const def = loadTtPage();
    const ctx = ttDaysCtx(def, 7, 10);   // 7 天窄列周表：新布局下同样抑制点击
    // 短距左滑 <56px：触发回弹，但按网页规则仍应抑制点击
    def.onSwipeStart.call(ctx, { touches: [{ clientX: 300, clientY: 400 }] });
    def.onSwipeMove.call(ctx, { touches: [{ clientX: 280, clientY: 400 }] });
    def.onSwipeEnd.call(ctx, { changedTouches: [{ clientX: 280, clientY: 400 }] });   // dx=-20
    assert.ok(ctx._supTap > Date.now(), '横向滑动后应进入 320ms 抑制期');
    const wk0 = ctx.data.wk;
    def.openDetail.call(ctx, { currentTarget: { dataset: { cid: '0' } } });
    def.pickDay.call(ctx, { currentTarget: { dataset: { td: '2' } } });
    def.prevWeek.call(ctx);
    def.nextWeek.call(ctx);
    def.thisWeek.call(ctx);
    def.setView.call(ctx, { currentTarget: { dataset: { v: 'day' } } });
    def.toggleList.call(ctx);
    def.openGroup.call(ctx, { currentTarget: { dataset: { name: '课0' } } });
    def.exportImg.call(ctx);
    assert.ok(!ctx.data.showDetail, '抑制期内不应打开详情');
    assert.strictEqual(ctx._dayUser, false, '抑制期内不应切换星期');
    assert.strictEqual(ctx.data.wk, wk0, '抑制期内不应切周');
    assert.strictEqual(ctx.data.view, 'week', '抑制期内不应切视图');
    assert.strictEqual(ctx.data.listOpen, false, '抑制期内不应展开全部课程');
    await sleep(360);   // 等待 320ms 抑制期结束
    def.openDetail.call(ctx, { currentTarget: { dataset: { cid: '0' } } });
    assert.strictEqual(ctx.data.showDetail, true);
    assert.strictEqual(ctx.data.detail.name, '课0');
  });

  await test('课表滑动：第一周向右拖 80px 松手 → 不换周、不飞出（只回弹）', async () => {
    const def = loadTtPage();
    const ctx = ttCtx(def);
    ctx._wk = 1;
    ctx.refresh();
    assert.strictEqual(ctx.data.wk, 1);
    def.onSwipeStart.call(ctx, { touches: [{ clientX: 200, clientY: 400 }] });
    def.onSwipeMove.call(ctx, { touches: [{ clientX: 280, clientY: 400 }] });
    assert.ok(/translateX\(22px\)/.test(ctx.data.swipeStyle), '边界应 0.28 阻尼：' + ctx.data.swipeStyle);
    def.onSwipeEnd.call(ctx, { changedTouches: [{ clientX: 280, clientY: 400 }] });   // 向右 80px，但已是第 1 周
    assert.ok(/translateX\(0\);opacity:1;transition:transform \.2s/.test(ctx.data.swipeStyle), '应只回弹：' + ctx.data.swipeStyle);
    assert.ok(!ctx.log.some((x) => /opacity:\.25/.test(x.swipeStyle || '')), '不应有飞出动画');
    await sleep(260);
    assert.strictEqual(ctx.data.wk, 1);
    assert.strictEqual(ctx.data.swipeStyle, '');
  });

  await test('课表滑动：锁定后松手纵向占优 → 不提交、不抑制点击', () => {
    const def = loadTtPage();
    const ctx = ttCtx(def);
    def.onSwipeStart.call(ctx, { touches: [{ clientX: 300, clientY: 400 }] });
    def.onSwipeMove.call(ctx, { touches: [{ clientX: 340, clientY: 400 }] });   // 横向锁定
    const wk0 = ctx.data.wk;
    def.onSwipeEnd.call(ctx, { changedTouches: [{ clientX: 340, clientY: 460 }] });  // dx=40, dy=60
    assert.strictEqual(ctx.data.wk, wk0, '不应换周');
    assert.strictEqual(ctx._supTap, 0, '纵向占优的松手不应进入点击抑制');
  });

  await test('课表滑动：拖动中多指中断回弹；动画中不起新手势、touchcancel 不打断飞行', () => {
    const def = loadTtPage();
    const ctx = ttCtx(def);
    def.onSwipeStart.call(ctx, { touches: [{ clientX: 300, clientY: 400 }] });
    def.onSwipeMove.call(ctx, { touches: [{ clientX: 250, clientY: 400 }] });
    assert.ok(/translateX\(-50px\)/.test(ctx.data.swipeStyle));
    def.onSwipeStart.call(ctx, { touches: [{ clientX: 1, clientY: 1 }, { clientX: 2, clientY: 2 }] });   // 多指
    assert.strictEqual(ctx._sw, null);
    assert.ok(/translateX\(0\);opacity:1;transition:transform \.2s/.test(ctx.data.swipeStyle), '多指中断应回弹：' + ctx.data.swipeStyle);
    const sty = ctx.data.swipeStyle;
    ctx._swAnim = true;
    def.onSwipeStart.call(ctx, { touches: [{ clientX: 300, clientY: 400 }] });
    assert.strictEqual(ctx._sw, null, '动画中不再起新手势');
    def.onSwipeCancel.call(ctx);
    assert.strictEqual(ctx.data.swipeStyle, sty, '动画中 touchcancel 不应打断飞行');
    ctx._swAnim = false;
  });

  await test('课表滑动：页面卸载清理动画定时器与手势状态', () => {
    const def = loadTtPage();
    const ctx = ttCtx(def);
    def.onSwipeStart.call(ctx, { touches: [{ clientX: 300, clientY: 400 }] });
    def.onSwipeMove.call(ctx, { touches: [{ clientX: 240, clientY: 400 }] });
    def.onSwipeEnd.call(ctx, { changedTouches: [{ clientX: 220, clientY: 400 }] });   // dx=-80，进入飞出动画
    assert.strictEqual(ctx._swAnim, true);
    assert.ok(ctx._swTimers.length > 0, '动画应登记定时器');
    def.onUnload.call(ctx);
    assert.strictEqual(ctx._swTimers.length, 0, '卸载应清空定时器');
    assert.strictEqual(ctx._swAnim, false);
    assert.strictEqual(ctx._sw, null);
  });

  await test('静态：tt 页滑动入口/参数/动画/防误触样式对齐网页（内容区滑动、头部不再滑动）', () => {
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/tt/tt.wxml'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'pages/tt/tt.js'), 'utf8');
    const wxss = fs.readFileSync(path.join(ROOT, 'pages/tt/tt.wxss'), 'utf8');
    assert.ok(/class="tthead">/.test(wxml), '周导航头部应为纯点击（不再绑触摸）');
    assert.ok(!/onWkTouch/.test(wxml + js), '旧的头部滑动 handler 应已移除');
    assert.strictEqual((wxml.match(/onSwipeStart/g) || []).length, 2, '周视图 + 日视图两处滑动入口');
    assert.ok(/ttswipe-track/.test(wxml) && /ttswipe-track/.test(wxss), '缺少滑动容器样式');
    for (const k of ['SW_LOCK = 12', 'SW_LOCK_RATIO = 1.35', 'SW_COMMIT = 56', 'SW_DAMP_EDGE = 0.28', 'SW_TAP_GUARD = 320', 'TT_CARD_INNER = 630', 'TT_PD_COL = 96']) {
      assert.ok(js.indexOf(k) >= 0, '缺少网页同款参数：' + k);
    }
    const guardCount = (js.match(/this\._tapBlocked\(\)\) return;/g) || []).length;
    assert.ok(guardCount >= 9, '滑动后点击抑制应覆盖所有可点 handler（实际 ' + guardCount + '）');
    assert.ok(/onUnload[\s\S]{0,800}_swClear|_swClear[\s\S]{0,200}onUnload/.test(js), '卸载应清理动画定时器');
    assert.ok(/\.2s cubic-bezier\(\.22,\.8,\.3,1\)/.test(js), '回弹应使用网页同款缓动曲线');
    assert.ok(/\.23s cubic-bezier\(\.22,\.8,\.3,1\)/.test(js), '飞入应使用网页同款缓动曲线');
    assert.ok(/overflow: hidden;/.test(wxss), '卡片应裁剪飞出动画');
  });

  await test('静态（2026-11-06 新行为）：6/7 天列宽自适应 + dense 缩放，不再依赖横向滑动看全', () => {
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/tt/tt.wxml'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'pages/tt/tt.js'), 'utf8');
    const wxss = fs.readFileSync(path.join(ROOT, 'pages/tt/tt.wxss'), 'utf8');
    // JS：列宽公式 + 无 giveScroll/边缘判定（旧逻辑已删除，不留未覆盖死代码）
    assert.ok(/const colW = Math\.floor\(\(TT_CARD_INNER - TT_PD_COL\) \/ Math\.max\(1, days\.length\)\)/.test(js),
      '列宽应始终按卡片内宽自适应（5/6/7 天 = 106/89/76rpx）');
    assert.ok(!/days\.length <= 5 \?/.test(js), '不得保留「≤5 天自适应 / 6-7 天固定 106rpx」旧分支');
    assert.ok(!/giveScroll/.test(js), 'giveScroll 分支应已移除（周表不再需要「先滚表格」）');
    assert.ok(!/_gridAtEdge/.test(js), '_gridAtEdge 边界判定应已移除（任何横向手势都直接切周）');
    assert.ok(/_gridOverflow = contentRpx > TT_CARD_INNER/.test(js), '保留防御性溢出判定 _gridOverflow');
    assert.ok(/_gridMaxX = this\._gridOverflow/.test(js), '保留防御性 _gridMaxX（当前恒 0）');
    assert.ok(/dense: dense/.test(js) && /dense7: dense7/.test(js) && /showSpan: !dense7/.test(js),
      '应输出 dense/dense7/showSpan 渲染标记');
    // WXML：列宽走 colW 行内 style；dense/dense7 挂到 tgrid；7 天隐藏「第X-Y节」；scroll-view 仅作防御
    assert.ok(/class="td \{\{item\.today \? 'today' : ''\}\}" style="width:\{\{colW\}\}rpx"/.test(wxml), '表头列宽应使用 colW 行内 style');
    assert.ok(/class="daycol" style="width:\{\{colW\}\}rpx"/.test(wxml), '星期列宽应使用 colW 行内 style');
    assert.ok(/class="tgrid\{\{dense \? ' tt-dense' : ''\}\}\{\{dense7 \? ' tt-dense7' : ''\}\}"/.test(wxml), '周表应按 dense/dense7 挂 class');
    assert.ok(/wx:if="\{\{showSpan && c\.span && c\.tall\}\}"/.test(wxml), '7 天应用 showSpan 隐藏「第X-Y节」');
    assert.ok(/crs-tall|crs-one/.test(wxml), '课程块应区分单节/跨节（单节课程名最多 2 行）');
    assert.ok(/scroll-x/.test(wxml) && /bindscroll="onGridScroll"/.test(wxml), 'scroll-view + bindscroll 保留作防御');
    // WXSS：字号下限 / 2 行 clamp / 日期头不截断
    assert.ok(/\.tt-dense7 \.crs\.abs \.cname \{ font-size: 19rpx/.test(wxss), '7 天课程名字号下限应为 19rpx');
    assert.ok(/\.tt-dense \.crs\.abs \.cname \{ font-size: 21rpx/.test(wxss), '6 天课程名应收紧到 21rpx');
    assert.ok(/-webkit-line-clamp: 2/.test(wxss), '单节课块课程名应最多 2 行');
    assert.ok(/\.tt-dense \.tdd \{[^}]*flex-wrap: wrap/.test(wxss), '6/7 天日期头应允许换行（不截断「今天」）');
    assert.ok(!/\.tdn[^{}]*\{[^}]*text-overflow/.test(wxss), '星期表头不应使用省略号截断');
    assert.ok(/\{\{dense \? ' tt-dense' : ''\}\}/.test(wxml), '5 天不挂 tt-dense（既有视觉不变）');
  });

  /* ============================================================
     7c. 课表进入速度（2026-11-06 用户反馈「先加载当前周保障进入速度」）
        旧行为（已修复，回归防回退）：onShow 先 loadCached() 同步渲染本机缓存，随后无条件
        setData({state:'loading'}) 把「当前周课表」盖成「课表加载中…」骨架，且 120ms 后才 loadRemote()
        → TTL 过期（6h）时要等网络 0.5–2s，缓存有数据却看得到骨架。新行为：有缓存进入即显示当前周、
        后台静默刷新（成功才覆盖、失败保留）；无缓存才显示骨架；请求不再等 120ms（onShow 同步发出）。
     ============================================================ */
  function ttTerm4WeeksAgo() {
    const d = new Date(); d.setDate(d.getDate() - 28);          // 28 天前开学 → 当前 = 第 5 周
    const p2 = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  const TT_ENTRY_C = [
    { name: '高数', day: 0, start: 1, end: 2, weeks: '1-18', room: 'A101', teacher: '张' },
    { name: '英语', day: 2, start: 3, end: 4, weeks: '1-18', room: 'B202', teacher: '李' }
  ];
  // 进入课表页前的本机数据（走 wx storage，与真机一致；onShow 内部会 store.reload()）
  function ttSeedStore(ttCache) {
    clearMem();
    setIdentity(ID);
    mem['zq_tools_v2'] = JSON.stringify(ttCache ? { ttCache: ttCache } : {});
  }
  // onShow 用的页面 ctx：不预置 _courses，让 loadCached() 真正从本机渲染；setLog 记录每一次 setData
  function ttShowCtx(def) {
    const ctx = Object.assign({}, def);
    ctx.data = JSON.parse(JSON.stringify(def.data));
    ctx.setLog = [];
    ctx.setData = function (o, cb) {
      this.setLog.push(JSON.parse(JSON.stringify(o)));
      Object.assign(this.data, o);
      if (cb) cb();
    };
    ctx._first = true;
    ctx._fetching = false;
    ctx._t = null;
    ctx._agent = null;
    ctx._agentQ = null;
    ctx._agentApplied = false;
    ctx._shared = null;
    ctx._wk = null;
    ctx._day = null;
    ctx._dayUser = false;
    ctx._remoteOk = false;
    ctx._courses = [];
    ctx._term = '';
    ctx._meta = null;
    ctx._gridOverflow = false;
    ctx._gridX = 0;
    ctx._gridMaxX = 0;
    ctx._sw = null;
    ctx._swAnim = false;
    ctx._swTimers = [];
    ctx._swSeq = 0;
    ctx._supTap = 0;
    return ctx;
  }
  // 收尾：停掉 onShow 里的 30s 计时器 / 页面缓存定时器（不留下 Node 事件循环句柄）
  function ttShowStop(def, ctx) {
    try { def.onHide.call(ctx); } catch (e) { /* ignore */ }
    try {
      const cm = require.cache[path.join(ROOT, 'utils/cloud.js')];
      if (cm && cm.exports && typeof cm.exports.udStop === 'function') cm.exports.udStop();
    } catch (e) { /* ignore */ }
  }
  // 2026-11-07：ttFetch 改为 CloudBase site_assets 优先（旧 tt.json 仅 legacy 兜底，6h TTL 不变）。
  // §7c 原先断言「onShow 返回时已发出 tt.json 请求」；现改为「onShow 返回时已发出课表云端请求（site_assets，
  // 走统一通道）」，远程 body 仍与旧 tt.json 同构。这里显式配好页内同一个 cloud 实例，避免受前序用例 configure 影响。
  function ttEntryCloud() {
    const CLOUD = require(path.join(ROOT, 'utils/cloud.js'));
    CLOUD.configure({
      enabled: true, restBase: 'https://mock.test/v1/rdb/rest/', publishableKey: 'pub',
      ttUrl: 'https://static.test/tt.json', timeout: 1000, tables: { siteAssets: 'site_assets' }
    });
    return CLOUD;
  }
  // 课表远端 mock：site_assets 行（body 为 JSON 字符串，与真实云端一致）与 legacy tt.json 都返回同构数据
  function ttEntryReq(remote) {
    return (o) => {
      if (urlOf(o).indexOf('/site_assets?') >= 0) {
        return o.success({ statusCode: 200, data: [{ body: JSON.stringify(remote), meta: { source: 'jwxt' } }] });
      }
      return o.success({ statusCode: 200, data: remote });
    };
  }

  await test('课表进入速度：有本机缓存 → onShow 同步即显示当前周（不被骨架覆盖），后台请求立即发出', async () => {
    const def = loadTtPage();
    const term = ttTerm4WeeksAgo();
    ttSeedStore({ c: TT_ENTRY_C, t: term, at: Date.now() - 7 * 3600 * 1000, meta: null });
    ttEntryCloud();
    reqImpl = ttEntryReq({ c: TT_ENTRY_C.concat([{ name: '物理', day: 1, start: 5, end: 6, weeks: '1-18' }]), t: term, meta: { fetchedAt: 1700000000000 } });
    const ctx = ttShowCtx(def);
    def.onShow.call(ctx);
    try {
      // 同步断言（onShow 返回即成立）：缓存当前周已在，且没有被 loading 骨架覆盖
      assert.strictEqual(ctx.data.state, 'data', '有缓存时 onShow 同步结束应已是 data（实际 ' + ctx.data.state + '）');
      assert.ok(Array.isArray(ctx.data.rows) && ctx.data.rows.length > 0, '当前周表格应有行数据');
      assert.ok((ctx.data.dayCols || []).length >= 5, '当前周表格应有星期列（实际 ' + (ctx.data.dayCols || []).length + '）');
      assert.strictEqual(ctx.data.wk, 5, '有缓存时应直接显示当前周（28 天前开学 → 第 5 周），实际第 ' + ctx.data.wk + ' 周');
      assert.strictEqual(ctx.data.weekLabel, '第 5 周');
      assert.ok((ctx.data.rows || []).some((r) => (r.cells || []).some((c) => (c.items || []).length > 0)), '周表应有课程块（缓存内容已渲染）');
      assert.ok(!ctx.setLog.some((o) => o.state === 'loading'),
        '有缓存时不应出现 loading 骨架 setData（实际 state 序列 = ' + JSON.stringify(ctx.setLog.map((o) => o.state).filter(Boolean)) + '）');
      assert.strictEqual(reqsOf('/site_assets?').length, 1, 'onShow 返回时应已发出课表云端请求（site_assets 优先，无 120ms 人为延迟）');
    } finally {
      ttShowStop(def, ctx);
    }
    await sleep(30);
    assert.strictEqual(ctx.data.state, 'data', '远程返回后仍为 data');
    assert.strictEqual(ctx.data.total, 3, '远程成功后应静默更新为教务数据（实际 ' + ctx.data.total + ' 门）');
  });

  await test('课表进入速度：旧版本机课表（store.course 兼容，无 ttCache）同样进入即显示、不显示骨架', async () => {
    const def = loadTtPage();
    const term = ttTerm4WeeksAgo();
    clearMem();
    setIdentity(ID);
    mem['zq_tools_v2'] = JSON.stringify({ course: TT_ENTRY_C, termStart: term });   // v12 之前的本机课表字段
    ttEntryCloud();
    reqImpl = ttEntryReq({ c: TT_ENTRY_C, t: term, meta: { fetchedAt: Date.now() } });
    const ctx = ttShowCtx(def);
    def.onShow.call(ctx);
    try {
      assert.strictEqual(ctx.data.state, 'data', '旧 d.course 也应直接显示（实际 ' + ctx.data.state + '）');
      assert.strictEqual(ctx.data.wk, 5);
      assert.ok(!ctx.setLog.some((o) => o.state === 'loading'), '旧 d.course 有数据时不应显示骨架');
      assert.strictEqual(reqsOf('/site_assets?').length, 1, '旧数据路径也应立即后台刷新（CloudBase site_assets 优先）');
    } finally {
      ttShowStop(def, ctx);
    }
    await sleep(30);
    assert.strictEqual(ctx.data.total, 2);
  });

  await test('课表进入速度：远程成功 → 静默更新数据/源文案（不闪骨架）；远程失败 → 保留缓存不退回骨架', async () => {
    const def = loadTtPage();
    const term = ttTerm4WeeksAgo();

    // 1) 成功：数据与 srcText 都更新
    ttSeedStore({ c: TT_ENTRY_C, t: term, at: Date.now() - 7 * 3600 * 1000, meta: null });
    ttEntryCloud();
    reqImpl = ttEntryReq({ c: TT_ENTRY_C.concat([{ name: '物理', day: 1, start: 5, end: 6, weeks: '1-18' }]), t: term, meta: { fetchedAt: Date.now() } });
    let ctx = ttShowCtx(def);
    def.onShow.call(ctx);
    assert.strictEqual(ctx.data.state, 'data');
    await sleep(30);
    try {
      assert.strictEqual(ctx.data.state, 'data', '远程成功后 state 应为 data');
      assert.strictEqual(ctx.data.total, 3, '远程成功后总课程数应更新');
      assert.ok(/^教务 \d+\/\d+ \d{2}:\d{2}$/.test(ctx.data.srcText), '远程成功后来源文案应变为「教务 M/D HH:MM」（实际 ' + ctx.data.srcText + '）');
      assert.ok(ctx.data.head.length >= 5);
    } finally {
      ttShowStop(def, ctx);
    }

    // 2) 失败：仍显示缓存（当前周），不退回骨架/不报错
    ttSeedStore({ c: TT_ENTRY_C, t: term, at: Date.now() - 7 * 3600 * 1000, meta: null });
    // 2026-11-18 网络层加固后：网络错误会自动重试一次（350ms 退避）。这里用「非 2xx」失败（不触发重试）
    // 验证同样的失败语义，避免在途重试请求被后续用例合并（生产行为不变：都会保留缓存）。
    reqImpl = (o) => o.success({ statusCode: 404, data: {} });
    ctx = ttShowCtx(def);
    def.onShow.call(ctx);
    assert.strictEqual(ctx.data.state, 'data', '失败前（同步）应为缓存 data');
    await sleep(30);
    try {
      assert.strictEqual(ctx.data.state, 'data', '远程失败后应保留缓存 data（不退骨架/不进 error）');
      assert.strictEqual(ctx.data.total, 2, '远程失败后课程数应保持缓存值（实际 ' + ctx.data.total + '）');
      assert.strictEqual(ctx.data.wk, 5);
      assert.strictEqual(ctx.data.srcText, '本机', '远程失败后来源仍为本机缓存');
      assert.ok(!ctx.setLog.some((o) => o.state === 'loading'), '失败路径不应出现 loading 骨架');
      assert.ok(!ctx.setLog.some((o) => o.state === 'error'), '失败路径不应进 error 态');
    } finally {
      ttShowStop(def, ctx);
    }
  });

  await test('课表进入速度：无本机课表 → 先显示 loading 骨架，请求同样立即发出，远程成功转 data', async () => {
    const def = loadTtPage();
    const term = ttTerm4WeeksAgo();
    ttSeedStore(null);   // 无 ttCache / 无旧 course
    ttEntryCloud();
    reqImpl = ttEntryReq({ c: TT_ENTRY_C, t: term, meta: { fetchedAt: Date.now() } });
    const ctx = ttShowCtx(def);
    def.onShow.call(ctx);
    try {
      assert.strictEqual(ctx.data.state, 'loading', '无缓存时应显示 loading 骨架（实际 ' + ctx.data.state + '）');
      assert.ok(ctx.setLog.some((o) => o.state === 'empty'), 'loadCached() 应先落 empty 再受条件保护切 loading');
      assert.strictEqual(reqsOf('/site_assets?').length, 1, '无缓存时请求也应立即发出（不再等 120ms；CloudBase site_assets 优先）');
    } finally {
      ttShowStop(def, ctx);
    }
    await sleep(30);
    assert.strictEqual(ctx.data.state, 'data', '远程成功后应从 loading 转为 data');
    assert.strictEqual(ctx.data.total, 2);
  });

  await test('课表进入速度：loadRemote 成功路径保持（数据进 store 再 refresh）；失败 catch 保留缓存', () => {
    const js = fs.readFileSync(path.join(ROOT, 'pages/tt/tt.js'), 'utf8');
    // 成功路径：写入 store.ttCache 后 refresh（现有逻辑保留，不许改成「先清空」）
    assert.ok(/d\.ttCache = \{ c: body\.c, t: body\.t \|\| '', at: Date\.now\(\), meta: body\.meta \|\| null \};/.test(js),
      'loadRemote 成功路径应继续写 store.ttCache');
    assert.ok(/this\._remoteOk = true;\s*\n\s*this\._pickSource\(\);[^\n]*\n\s*this\.refresh\(\);/.test(js),
      'loadRemote 成功后应重新挑选数据源（个人课表优先）再 refresh');
    assert.ok(/\.catch\(\(\) => \{ \/\* 保留缓存/.test(js), 'loadRemote 失败分支必须保留缓存（不退回骨架/不清空）');
    // 页面结构/状态机未被改动：骨架/错误/空态仍然存在
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/tt/tt.wxml'), 'utf8');
    assert.ok(/wx:if="\{\{state === 'loading'\}\}"/.test(wxml) && /课表加载中/.test(wxml), 'loading 骨架结构保持');
    assert.ok(/wx:elif="\{\{state === 'error'\}\}"/.test(wxml), 'error 态保持');
    assert.ok(/课表还是空的/.test(wxml), 'empty 态保持');
  });

  await test('静态（进入速度）：onShow 的 loading setData 受「本机无课表」条件保护、无 120ms 人为延迟', () => {
    const js = fs.readFileSync(path.join(ROOT, 'pages/tt/tt.js'), 'utf8');
    const a = js.indexOf('onShow() {');
    const b = js.indexOf('onHide() {');
    assert.ok(a > 0 && b > a, '未找到 onShow 方法体');
    const onShowBody = js.slice(a, b);
    assert.ok(/this\.loadCached\(\);\s*\n(?:[^\n]*\n)*?\s*if \(this\._first\) \{/.test(onShowBody),
      'onShow 应先 loadCached() 再处理首屏骨架');
    assert.ok(/if \(!this\._hasLocalTt\(\)\) this\.setData\(\{ state: 'loading' \}\);/.test(onShowBody),
      'setData({state:\'loading\'}) 必须受 _hasLocalTt() 条件保护（有缓存不得覆盖已渲染当前周）');
    assert.ok(!/, 120\)/.test(onShowBody), 'onShow 不得再有 120ms 人为延迟');
    assert.ok(!/setTimeout/.test(onShowBody), 'onShow 不应再用 setTimeout 延迟后台刷新');
    assert.ok(/this\.loadRemote\(this\._hoForce\);/.test(onShowBody), 'onShow 应直接/立即发起后台静默刷新');
    assert.ok(onShowBody.indexOf('this.loadRemote(this._hoForce);') > onShowBody.indexOf('_hasLocalTt()'),
      '后台刷新应在首屏判断之后发起（有缓存不阻塞、无缓存骨架先出）');
    // 条件依据 = ttCache / 旧 course（与 loadCached 取值顺序一致）
    const h = js.indexOf('_hasLocalTt() {');
    const helper = js.slice(h, js.indexOf('loadRemote(donePull) {'));
    assert.ok(h > 0 && helper.length > 80, '未找到 _hasLocalTt() 实现');
    assert.ok(/d\.ttCache && Array\.isArray\(d\.ttCache\.c\)/.test(helper), '_hasLocalTt 必须检查 store.ttCache');
    assert.ok(/d\.ttLocal && Array\.isArray\(d\.ttLocal\.c\)/.test(helper), '_hasLocalTt 必须优先检查 store.ttLocal（个人课表）');
    assert.ok(/Array\.isArray\(d\.course\)/.test(helper), '_hasLocalTt 必须兼容旧 store.course');
    assert.ok(/return list\.length > 0;/.test(helper), '_hasLocalTt 应以「有行数据」为有缓存');
  });

  /* ============================================================
     7d. 2026-11-08：电费趋势 canvas 覆盖层遮挡修复（静态断言）
        根因：单层渲染不支持的机型/基础库上 canvas type=2d 属原生组件，层级永远高于页面 view，
        弹层/浮层即使 z-index 更高也会被趋势线盖住。修复：覆盖层打开时 wx:if 移除 #pwTrend，
        关闭后 setData 回调 + wx.nextTick 重绘（复用已有数据，不重复请求）。
     ============================================================ */
  await test('静态（canvas 遮挡）：sheetOpen/lowOpen 打开时 wx:if 移除 #pwTrend；关闭后回调+nextTick 重绘（0 请求）', () => {
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/power/power.wxml'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'pages/power/power.js'), 'utf8');
    assert.ok(/<canvas wx:if="\{\{!trend\.empty && !sheetOpen && !lowOpen\}\}" type="2d" id="pwTrend"/.test(wxml),
      'canvas wx:if 必须同时排除 sheetOpen / lowOpen（覆盖层打开期间移除原生 canvas）');
    assert.ok(/wx:if="\{\{trend\.empty\}\}"/.test(wxml), '空态占位保留');
    assert.ok(/_trendOverlayOpen\(\) \{ return !!\(this\.data\.sheetOpen \|\| this\.data\.lowOpen\); \}/.test(js),
      '覆盖层判定 _trendOverlayOpen（sheetOpen || lowOpen）');
    assert.ok(/closeSheet\(\) \{[\s\S]{0,200}_redrawAfterOverlay\(\)/.test(js), '关闭宿舍弹层 → 重绘');
    assert.ok(/closeLow\(\) \{[\s\S]{0,200}_redrawAfterOverlay\(\)/.test(js), '关闭低电面板 → 重绘');
    assert.ok(/onTileTap\(e\) \{[\s\S]{0,260}this\.setData\(\{ lowOpen: open \}, \(\) => \{ if \(!open\) this\._redrawAfterOverlay\(\); \}\);/.test(js),
      '低电面板 setData 回调里触发重绘');
    assert.ok(/wx\.nextTick\(redraw\)/.test(js), '关闭后经 wx.nextTick 重绘（等 canvas 节点重建）');
    assert.ok(/this\._drawTrend\(\);/.test(js) && /this\._renderData\(\);/.test(js),
      '复用 _drawTrend/_renderData 重绘（不重复请求）');
    // 重绘函数体内不得发起请求（不出现 load( / cloud.* 调用）
    const seg = js.slice(js.indexOf('_redrawAfterOverlay() {'), js.indexOf('openSheet() {'));
    assert.ok(seg.length > 80, '未找到 _redrawAfterOverlay 实现');
    assert.ok(seg.indexOf('load(') < 0 && seg.indexOf('cloud.') < 0, '覆盖层关闭重绘不得重复请求');
    assert.ok(/if \(this\._trendOverlayOpen && this\._trendOverlayOpen\(\)\) \{ this\._canvasDrawn = false; return; \}/.test(js),
      '_drawTrend 在覆盖层打开时直接跳过（节点已被移除，不空转 selectorQuery）');
    assert.ok(/onTrendTouch\(e\) \{\s*\n\s*if \(this\.data\.trend\.empty \|\| this\._trendOverlayOpen\(\)\) return;/.test(js),
      '覆盖层打开时触摸查看被忽略');
    // 页面滚动层级：覆盖层为 fixed z-index 900 + 弹层自身层级；不依赖 canvas 的 view 层级
    const wxss = fs.readFileSync(path.join(ROOT, 'pages/power/power.wxss'), 'utf8');
    assert.ok(/\.pw-mask \{[^}]*position: fixed;/.test(wxss) && /\.pw-mask \{[^}]*z-index: 900;/.test(wxss),
      '宿舍弹层 fixed + z-index 900（不再靠 canvas 让位）');
  });

  /* ============================================================
     7e. 2026-11-08：诊断 v2（去管理员门禁 + 设备诊断 + app.js onError）
     ============================================================ */
  await test('静态（诊断 v2.1）：去 is_admin；AI 结论下挂异常项（无独立 AI/修复卡）；折叠行/状态胶囊；10s 轮询；设备信息最小化', () => {
    const js = fs.readFileSync(path.join(ROOT, 'pages/diag/diag.js'), 'utf8');
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/diag/diag.wxml'), 'utf8');
    const wxss = fs.readFileSync(path.join(ROOT, 'pages/diag/diag.wxss'), 'utf8');
    const cloudJs = fs.readFileSync(path.join(ROOT, 'utils/cloud.js'), 'utf8');
    const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    const diagUtil = fs.readFileSync(path.join(ROOT, 'utils/diag.js'), 'utf8');
    // 1) 去管理员门禁（页面 4 处 + cloud.serviceHealth）
    assert.ok(!/isAdmin\(\)/.test(js), 'diag 页不得再有 is_admin 判断');
    assert.ok(!/仅管理员/.test(wxml) && !/denied: true, admin/.test(js), 'WXML/逻辑不得再出现管理员门禁');
    const sh = cloudJs.slice(cloudJs.indexOf('function serviceHealth()'), cloudJs.indexOf('function rpcCall('));
    assert.ok(sh.length > 100 && !/isAdmin\(\)/.test(sh), 'cloud.serviceHealth 不得再判断 is_admin（RLS 已放宽 auth_ok）');
    assert.ok(/if \(!identity\.has\(\) \|\| !isEnabled\(\)\)/.test(sh), '仍要求有效班级身份 + 云端已配置');
    // 2) 进展 10s（保留健康 60s）
    assert.ok(/DIAG_REFRESH_MS = 10000/.test(js) && /REFRESH_MS = 60000/.test(js), '服务健康 60s + 诊断数据 10s 轮询');
    // 3) AI 结论下挂（纯函数 groupAnalyses；页面不再有独立 AI/修复卡）
    assert.ok(/function groupAnalyses/.test(diagUtil) && /function analysisView/.test(diagUtil), 'utils/diag.js 分组下挂纯函数');
    assert.ok(/diag\.groupAnalyses\(/.test(js), '诊断页用 groupAnalyses 下挂 AI');
    assert.ok(/<template name="dgAi">/.test(wxml), 'AI 折叠行模板 dgAi');
    assert.ok(/wx:for="\{\{it\.ai\}\}"/.test(wxml) && /wx:for="\{\{ck\.ai\}\}"/.test(wxml), 'AI 下挂到服务健康行/设备检查行');
    assert.ok(!/wx:for="\{\{analyses\}\}"/.test(wxml) && !/wx:for="\{\{repairs\}\}"/.test(wxml), '删除独立 AI 分析/修复记录卡');
    assert.ok(!/class="m3-card[^"]*dg-ai"/.test(wxml) && /其它诊断/.test(wxml) && /toggleOthers/.test(wxml), '无关联结论进「其它诊断」折叠区');
    assert.ok(/others\.count/.test(wxml) && /wx:if="\{\{others\.count\}\}"/.test(wxml), '其它诊断默认收起只显示条数');
    // 4) 折叠行（高度 ≤36px = 60rpx）+ 状态胶囊 + ⚙ + 展开态
    assert.ok(/\.dg-ai-row \{[^}]*height: 60rpx;[^}]*max-height: 60rpx/.test(wxss), '折叠行固定 60rpx（≈30px，≤36px）');
    assert.ok(/\.dg-ai-title \{[^}]*text-overflow: ellipsis/.test(wxss), '标题单行省略（≤22 字）');
    assert.ok(/\.dg-ai-pill--running/.test(wxss) && /\.dg-ai-pill--fixed/.test(wxss) && /\.dg-ai-pill--failed/.test(wxss) && /\.dg-ai-pill--new/.test(wxss), '状态胶囊样式 new/running/fixed/failed');
    assert.ok(/toggleAnalysis/.test(js) && /toggleAnalysis/.test(wxml), '点整行展开/收起');
    assert.ok(/dg-ai-caret--open/.test(wxss) && /dg-ai-caret--open/.test(wxml), '› 展开旋转 90°');
    assert.ok(/dg-ai-body/.test(wxml) && /wx:if="\{\{an\.open\}\}"/.test(wxml) && /an\.suggestionsText/.test(wxml) && /an\.flowText/.test(wxml), '展开态内容（cause/suggestion/flow/关联修复）');
    assert.ok(/关联修复/.test(wxml) && /repair\.actionText/.test(wxml) && /repair\.createdText/.test(wxml), '展开态显示关联修复 action/结果/时间');
    // 5) 状态文案 / 排队提示 / 摘要统计（utils/diag.js 唯一文案源）
    assert.ok(/new: '待处理'/.test(diagUtil) && /running: '修复中'/.test(diagUtil) && /fixed: '已修复'/.test(diagUtil) && /failed: '修复失败'/.test(diagUtil), '状态胶囊文案');
    assert.ok(/AI 分析排队中…/.test(diagUtil) && /本机离线，已留存待开机修复/.test(diagUtil), '异常行无 AI 的排队/离线提示');
    assert.ok(/'可自动修复 '/.test(diagUtil) && /'已修复 '/.test(diagUtil) && /diagStats\.text/.test(wxml), '顶部摘要「可自动修复 N · 已修复 M」');
    assert.ok(/flow\[.*\]\.slice\(0, 8\)|slice\(0, 8\)/.test(diagUtil), 'flow 最多 8 步');
    assert.ok(/dg-flow-i--run/.test(wxss) && /dg-flow-dot--run/.test(wxss), 'flow run 步显示进行中（动态点）');
    // 6) 设备信息最小化（§B mp 白名单）：页面不采集品牌/型号/语言；输出只有白名单
    assert.ok(/DEVICE_WHITELIST = \['platform', 'osVersion', 'baseLib', 'screen', 'memoryMB', 'storagePct', 'network', 'clockSkewMs'\]/.test(diagUtil), 'device 白名单 8 字段');
    assert.ok(/DETAIL_WHITELIST = \['check', 'latency_ms', 'storage_pct', 'clock_skew_ms', 'err_count', 'code'\]/.test(diagUtil), 'detail 白名单');
    assert.ok(/add\('clock'/.test(diagUtil) && /add\('timetable'/.test(diagUtil) && /add\('js'/.test(diagUtil), '设备检查 id：clock/timetable/js');
    assert.ok(!/\.brand\b/.test(js) && !/\.model\b/.test(js) && !/\.language\b/.test(js), '页面设备检查不再采集品牌/型号/语言');
    assert.ok(!/brand/.test(JSON.stringify(js.match(/getDeviceInfo[\s\S]{0,200}/g) || '')), 'getDeviceInfo 只取 system/osVersion');
    assert.ok(/clockSkewMs/.test(js) && /serverTime/.test(cloudJs), '时钟偏差用 diagPing 响应头 serverTime 计算');
    ['diagAgentInfo', 'diagAnalyses', 'diagRepairs', 'diagReport', 'diagPing'].forEach((k) => {
      assert.ok(cloudJs.indexOf(k) >= 0, 'cloud 缺少 ' + k);
      assert.ok(js.indexOf(k) >= 0, '诊断页未使用 ' + k);
    });
    assert.ok(/wx:for="\{\{dev\.checks\}\}"/.test(wxml) && /设备诊断/.test(wxml), '设备诊断卡渲染');
    assert.ok(/wx:for="\{\{groups\}\}"/.test(wxml) && /{{it\.display}}/.test(wxml), '保留服务健康 18 行分组渲染');
    assert.ok(/onPullDownRefresh/.test(js), '保留下拉刷新');
    // 7) app.js 全局 onError：设备白名单 + detail 必带 check；仅已登录、去重、限频、失败静默
    assert.ok(/onError\(err\) \{ reportJsError\(err\); \}/.test(appJs), 'app.js 全局 onError 自动上报');
    assert.ok(/onUnhandledRejection\(res\)/.test(appJs), '未处理的 Promise 拒绝也上报');
    assert.ok(/if \(!identity\.has\(\)\) return;/.test(appJs), '仅已登录身份才自动上报');
    assert.ok(/_errSeen\[fp\]/.test(appJs) && /ERR_WINDOW = 10 \* 60 \* 1000/.test(appJs), '同 fingerprint 10 分钟去重');
    assert.ok(/ERR_MAX = 3/.test(appJs), '每次运行最多 3 条自动上报（限频）');
    assert.ok(/cloud\.diagReport\(\[row\]\)\.catch/.test(appJs), '上报失败静默（不阻塞/不弹窗）');
    assert.ok(/jsErrorCount: 0/.test(appJs) && /memoryWarnCount: 0/.test(appJs), '错误/内存警告计数供诊断页展示');
    assert.ok(!/out\.brand|out\.model|out\.language/.test(appJs) && /platform: 'mp', osVersion: '', baseLib: ''/.test(appJs), 'app.js onError 设备信息同样最小化');
    assert.ok(/detail: \{ check: 'js'/.test(appJs), 'onError 上报 detail 必带 check（agent 生成 related.checks）');
    assert.ok(/diagUtil\.redact/.test(appJs), '上报前脱敏');
  });

  /* ============================================================
     7f. 2026-11-08：课表登录（个人 ttLocal）
     ============================================================ */
  await test('静态（课表登录）：入口/弹层（学号默认身份 sid）/轮询 ≤120s/错误码提示/ttLocal 优先级/清除回退/密码不落盘', () => {
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/tt/tt.wxml'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'pages/tt/tt.js'), 'utf8');
    const storeJs = fs.readFileSync(path.join(ROOT, 'utils/store.js'), 'utf8');
    const cloudJs = fs.readFileSync(path.join(ROOT, 'utils/cloud.js'), 'utf8');
    const privacyJs = fs.readFileSync(path.join(ROOT, 'utils/privacy.js'), 'utf8');
    // 入口 + 弹层
    assert.ok(/bindtap="openLogin"/.test(wxml) && /登录教务/.test(wxml), 'tt 页新增「登录教务」入口');
    assert.ok(/show="\{\{loginOpen\}\}" title="登录教务"/.test(wxml), '登录 bottom-sheet');
    assert.ok(/class="ttl-v">\{\{loginSid\}\}/.test(wxml), '学号默认班级身份 sid 展示');
    assert.ok(/password="\{\{true\}\}"/.test(wxml) && /bindinput="onLoginPwdInput"/.test(wxml), '密码输入（password 掩码）');
    assert.ok(/bindtap="clearMine"/.test(wxml) && /清除我的课表/.test(wxml), '「清除我的课表」回退入口');
    // 流程/轮询/错误码
    assert.ok(/LOGIN_POLL_MS = 1500/.test(js), '轮询间隔 1.5s');
    assert.ok(/LOGIN_TIMEOUT_MS = 120000/.test(js), '最长等待 120s');
    ['loginTap', '_pollLogin', '_applyMine', 'clearMine', '_loginStop'].forEach((fn) => {
      assert.ok(js.indexOf(fn) >= 0, '缺少登录方法 ' + fn);
    });
    assert.ok(/agent_offline/.test(js) && /rate/.test(js) && /failed/.test(js) && /expired/.test(js), '错误码 agent_offline/rate/failed/expired 提示');
    assert.ok(/cloud\.ttLoginEnqueue/.test(js) && /cloud\.ttLoginStatus/.test(js), '调用 enqueue + 轮询 status');
    // ttLocal 写入/清除 + 优先级
    assert.ok(/d\.ttLocal = tl;/.test(js) && /d\.ttLocalAt = Date\.now\(\);/.test(js), '登录成功写 store.ttLocal + ttLocalAt');
    assert.ok(/d\.ttLocal = null;\s*\n\s*d\.ttLocalAt = Date\.now\(\);/.test(js), '清除写 null + 抬时间戳（跨端 LWW）');
    assert.ok(/d\.ttLocal && Array\.isArray\(d\.ttLocal\.c\)/.test(js), '_pickSource 个人课表（ttLocal）优先');
    assert.ok(/ttLocal: null, ttLocalAt: 0/.test(storeJs), 'store 新增 ttLocal/ttLocalAt');
    assert.ok(/tt: \{ ttView: '', ttUseMine: false, ttLocal: null, termStart: '' \}/.test(privacyJs), 'privacy DEFAULTS.tt.ttLocal 保持契约字段');
    assert.ok(/if \(udNum\(d\.ttLocalAt\) > 0\) \{/.test(cloudJs) && /tt\.ttLocal = d\.ttLocal \? udClone\(d\.ttLocal\) : null;/.test(cloudJs),
      'UD v6 tt section 写 ttLocal（本机拥有时）');
    assert.ok(/view\.at\.tt = Math\.max\(udNum\(view\.at\.tt\), udNum\(d\.ttLocalAt\)\)/.test(cloudJs), 'udSections 抬高 at.tt');
    assert.ok(/if \(!udSame\(view\.tt\.ttLocal, c\.tt \? c\.tt\.ttLocal : undefined\)\) dirty\.push\('tt'\)/.test(cloudJs), '脏检测覆盖 ttLocal 变化');
    assert.ok(/if \(j\.tt\.ttLocal !== undefined\)/.test(cloudJs) && /store\.normTtLocal\(j\.tt\.ttLocal\)/.test(cloudJs), 'udApply 应用远端 ttLocal');
    // 密码不落盘/不打日志/不写错误上报；提交后立即清空
    assert.ok(/this\.setData\(\{ loginPwd: '' \}\);/.test(js), '提交后立即清空 data.loginPwd');
    assert.ok(!/setStorageSync\([^)]*loginPwd/.test(js) && !/console\.log\([^)]*loginPwd/.test(js), '密码不得写入 storage / 日志');
    assert.ok(/loginSid: identity\.sid\(\)/.test(js), '学号默认当前班级身份 sid');
    // 既有能力不回归
    ['onShareAppMessage', 'onShareTimeline', 'exportImg', 'onSwipeStart', 'prevWeek', 'nextWeek'].forEach((fn) => {
      assert.ok(js.indexOf(fn) >= 0, '登录改动不得移除既有能力 ' + fn);
    });
  });

  /* ============================================================
     8. 统一导图 / 二维码
     ============================================================ */
  await test('导图：标题/参数配置/页脚/编号/品牌都绘制', () => {
    const { canvas } = fresh();
    fakeCanvas.reset();
    const H = canvas.drawCard(fakeCanvas.g, fakeCanvas.node, {
      title: '抽签结果', sub: '范围 1-10', config: [['范围', '1 – 10'], ['个数', '5']],
      blocks: [{ label: '抽签结果', mono: true, lines: ['1 2 3 4 5'] }],
      foot: '生成时间 2026-10-18 22:00', rec: 'DRAW-1'
    });
    assert.ok(H > 300);
    const texts = fakeCanvas.ops.filter((o) => o.op === 'text').map((o) => o.t);
    for (const want of ['抽签结果', '参数配置', '范围', '1 – 10', '生成时间 2026-10-18 22:00', '编号 DRAW-1', '班级工具站']) {
      assert.ok(texts.some((t) => t.indexOf(want) === 0 || t === want), '缺少文本：' + want);
    }
  });

  await test('导图 v2：水印绘制在白卡之上、裁剪在卡内（700 15px / alpha 0.03）', () => {
    const { canvas } = fresh();
    fakeCanvas.reset();
    canvas.drawCard(fakeCanvas.g, fakeCanvas.node, { title: 'T', config: [['a', 'b']], blocks: [{ label: 'L', lines: ['x'] }], foot: 'f', rec: 'r' });
    const wm = fakeCanvas.ops.findIndex((o) => o.op === 'text' && o.t === '班级工具站' && /700 15px/.test(o.font));
    const cardFill = fakeCanvas.ops.findIndex((o) => o.op === 'fill' && o.fill === '#FFFFFF');
    assert.ok(wm >= 0, '未画水印（应为 700 15px 的「班级工具站」）');
    assert.ok(cardFill >= 0, '未画白卡');
    assert.ok(wm > cardFill, '水印先于白卡绘制，会被白卡完全覆盖（导出图看不到水印）');
    const wmOp = fakeCanvas.ops[wm];
    assert.strictEqual(wmOp.alpha, 0.03, 'v2 水印透明度应为 0.03');
    assert.strictEqual(wmOp.align, 'center', '水印应居中平铺');
    const clip = fakeCanvas.ops.findIndex((o) => o.op === 'clip');
    assert.ok(clip >= 0, '水印缺 clip（会画到卡外）');
    assert.ok(clip < wm, '应先裁剪到主卡圆角路径再画水印');
  });

  await test('导图 v2：参数配置按实测宽度自动两列 / 单列', () => {
    const { canvas } = fresh();
    fakeCanvas.reset();
    canvas.drawCard(fakeCanvas.g, fakeCanvas.node, {
      title: 'T', config: [['短标签A', '值A'], ['短标签B', '值B']],
      blocks: [{ label: 'L', lines: ['x'] }], foot: 'f', rec: 'r'
    });
    const two = fakeCanvas.ops.filter((o) => o.op === 'text');
    const a = two.find((o) => o.t === '短标签A：');
    const b = two.find((o) => o.t === '短标签B：');
    assert.ok(a && b, '两列时两个标签都应绘制');
    assert.ok(b.x - a.x > 250, '两列布局：第二列应右移（实际 ' + (b.x - a.x) + '）');
    fakeCanvas.reset();
    canvas.drawCard(fakeCanvas.g, fakeCanvas.node, {
      title: 'T', config: [['A', 'x'.repeat(40)], ['B', 'y']],
      blocks: [{ label: 'L', lines: ['x'] }], foot: 'f', rec: 'r'
    });
    const one = fakeCanvas.ops.filter((o) => o.op === 'text');
    const la = one.find((o) => o.t === 'A：');
    const lb = one.find((o) => o.t === 'B：');
    assert.ok(la && lb, '单列时两个标签都应绘制');
    assert.strictEqual(lb.x, la.x, '含长值时应回退单列（两行标签同一 x）');
  });

  await test('导图 v2：chips 内容块按胶囊绘制序号 + 姓名（抽签结果）', () => {
    const { canvas } = fresh();
    fakeCanvas.reset();
    const H = canvas.drawCard(fakeCanvas.g, fakeCanvas.node, {
      title: '抽签结果', sub: '范围 1 – 70',
      config: [['抽签 · 个数', '3'], ['抽签 · 排序', '按抽取顺序']],
      blocks: [{ label: '抽中结果（3）', chips: [{ n: 2, nm: '张三' }, { n: 42, nm: '李四' }, { n: 7, nm: '' }] }],
      foot: '生成时间 2026-11-05 13:40', rec: 'DRAW-1'
    });
    assert.ok(H > 300);
    const texts = fakeCanvas.ops.filter((o) => o.op === 'text').map((o) => o.t);
    for (const want of ['抽中结果（3）', '参数配置', '2', '42', '7', '张三', '李四']) {
      assert.ok(texts.some((t) => t === want), '缺少文本：' + want);
    }
    const white = fakeCanvas.ops.filter((o) => o.op === 'fill' && o.fill === '#FFFFFF').length;
    assert.ok(white >= 4, '每个 chip 应有白底胶囊（3 chip + 主卡 = 4，实际 ' + white + '）');
  });

  await test('导图 v2：groups 内容块按两列组卡绘制组头 / 人数 / 成员', () => {
    const { canvas } = fresh();
    fakeCanvas.reset();
    const H = canvas.drawCard(fakeCanvas.g, fakeCanvas.node, {
      title: '分组结果', sub: '2 组 / 5 人',
      config: [['分组 · 组数', '2'], ['分组 · 人数', '5']],
      blocks: [{ label: '分组结果', groups: [
        [{ n: 2, nm: '张三' }, { n: 35, nm: '李四' }],
        [{ n: 11, nm: '王五' }]
      ] }],
      foot: '生成时间 2026-11-05 13:40', rec: 'GROUP-1'
    });
    assert.ok(H > 300);
    const t = fakeCanvas.ops.filter((o) => o.op === 'text');
    const texts = t.map((o) => o.t);
    for (const want of ['分组结果', '第 1 组', '第 2 组', '2 人', '1 人', '张三', '李四', '王五']) {
      assert.ok(texts.some((x) => x === want), '缺少文本：' + want);
    }
    const g1 = t.find((o) => o.t === '第 1 组');
    const g2 = t.find((o) => o.t === '第 2 组');
    assert.ok(g2.x - g1.x > 300, '第 2 组应在右列（两列网格，实际偏移 ' + (g2.x - g1.x) + '）');
    const cnt = t.find((o) => o.t === '2 人');
    assert.strictEqual(cnt.align, 'right', '组头右侧人数应右对齐');
    const groupFills = fakeCanvas.ops.filter((o) => o.op === 'fill' && o.fill === '#FBF8F1').length;
    assert.strictEqual(groupFills, 2, '两个组卡应有 groupBg 底');
  });

  await test('导图 v2：高度自适应（内容越多画布越高）+ DPR 放大', () => {
    const { canvas } = fresh();
    const mk = (n) => ({
      title: 'T', config: [['a', 'b']],
      blocks: [{ label: 'L', chips: Array.from({ length: n }, (_, i) => ({ n: i + 1, nm: '' })) }],
      foot: 'f', rec: 'r'
    });
    const h1 = canvas.drawCard(fakeCanvas.g, fakeCanvas.node, mk(2));
    const h2 = canvas.drawCard(fakeCanvas.g, fakeCanvas.node, mk(40));
    assert.ok(h2 > h1, '内容多时画布应更高（' + h1 + ' vs ' + h2 + '）');
    assert.strictEqual(fakeCanvas.node.width, 1520, 'canvas.width = 760 * DPR');
    assert.strictEqual(fakeCanvas.node.height, h2 * 2, 'canvas.height = H * DPR');
  });

  await test('导图：区块文本含换行时应拆成多行', () => {
    const { canvas } = fresh();
    fakeCanvas.reset();
    canvas.drawCard(fakeCanvas.g, fakeCanvas.node, { title: 'T', config: [], blocks: [{ label: '正文', lines: ['第一行\n第二行'] }], foot: 'f', rec: 'r' });
    const texts = fakeCanvas.ops.filter((o) => o.op === 'text').map((o) => o.t);
    assert.ok(!texts.some((t) => t.indexOf('\n') >= 0), '换行被原样画进 fillText，导出图会丢行/串行');
  });

  await test('导图：长文本/超宽 token 会折行且不越界', () => {
    const { canvas } = fresh();
    const g = fakeCanvas.g;
    const lines = canvas.wrap(g, 'A'.repeat(200), 120);
    assert.ok(lines.length > 1);
    lines.forEach((l) => assert.ok(g.measureText(l).width <= 128, '折行后仍超宽：' + l.length));
    const zh = canvas.wrap(g, '这是一段没有空格的中文长文本'.repeat(8), 120);
    zh.forEach((l) => assert.ok(g.measureText(l).width <= 128));
  });

  await test('导图：exportAndSave 走通 画图→临时文件→相册', async () => {
    const { canvas } = fresh();
    savedFiles = [];
    const r = await canvas.exportAndSave({}, '#card', { title: 'T', config: [['a', 'b']], blocks: [{ label: 'L', lines: ['x'] }], foot: 'f', rec: 'r' });
    assert.strictEqual(r.save.ok, true);
    assert.strictEqual(savedFiles.length, 1);
    assert.strictEqual(savedFiles[0].width, 1520);
  });

  await test('二维码：版本 1 尺寸/定位图案/确定性；超长文本截断到 134 字节', () => {
    const { qr } = fresh();
    const a = qr.qrGen('hello');
    const b = qr.qrGen('hello');
    assert.strictEqual(a.n, 21);
    assert.deepStrictEqual(a.m, b.m);
    assert.strictEqual(a.m[0][0], 1);
    assert.strictEqual(a.m[6][6], 1);
    const c = qr.qrGen('x'.repeat(300));
    assert.strictEqual(c.n, 41);
    assert.notDeepStrictEqual(a.m, qr.qrGen('world').m);
  });

  /* ============================================================
     9. 班级名单选择（1.3.4：名单只来自 class_members，座号选择 + 旧数据迁移）
     ============================================================ */
  await test('名单：store 新字段默认值 + mkD 座号归一（去重/升序/整数）', () => {
    const { store } = fresh();
    clearMem();
    const d = store.get();
    assert.deepStrictEqual(d.rosterSel, [], 'rosterSel 默认应为空数组');
    assert.deepStrictEqual(d.group.sel, [], 'group.sel 默认应为空数组');
    assert.deepStrictEqual(d.rollSel, [], 'rollSel 默认应为空数组');
    assert.strictEqual(d.selVer, 0, 'selVer 迁移标记默认 0');
    const mk = store.mkD({
      rosterSel: [3, '3', 0, -1, 2.4, 2],
      group: { sel: [5, 5, 'a', 1] },
      rollSel: 'garbage',
      selVer: '2'
    });
    assert.deepStrictEqual(mk.rosterSel, [2, 3]);
    assert.deepStrictEqual(mk.group.sel, [1, 5]);
    assert.deepStrictEqual(mk.rollSel, []);
    assert.strictEqual(mk.selVer, 2);
  });

  await test('名单：members 清洗排序 + textOf / namesTextOf 格式', () => {
    const { store, roster } = fresh();
    clearMem();
    store.get().classMembers = [
      { seat: 26, sid: 's26', name: MEMBERS[2].name },
      { seat: 1, sid: 's1', name: MEMBERS[0].name },
      { seat: 1, sid: 's1b', name: '重复座号' },
      { seat: 0, sid: 's0', name: '无座号' },
      { seat: 3, name: '   ' },
      { sid: 'sx', name: '无座号2' }
    ];
    store.save();
    const ms = roster.members();
    assert.deepStrictEqual(ms.map((m) => m.seat), [1, 26], '座号去重 / 非法行丢弃 / 升序');
    assert.strictEqual(ms[0].name, MEMBERS[0].name);
    assert.strictEqual(roster.textOf([26, 1]), '1 ' + MEMBERS[0].name + '\n26 ' + MEMBERS[2].name);
    assert.strictEqual(roster.namesTextOf([26, 1]), MEMBERS[0].name + '\n' + MEMBERS[2].name);
    assert.strictEqual(roster.textOf([99]), '');
  });

  await test('名单：setSel 过滤未知座号并写派生文本；抽签池只保留所选座号', () => {
    const { store, roster } = fresh();
    clearMem();
    store.get().classMembers = MEMBERS.slice();
    store.save();
    const ret = roster.setSel('draw', [26, 1, 1, '24', 99]);
    assert.deepStrictEqual(ret, [1, 24, 26], '去重 / 升序 / 未知座号丢弃');
    assert.deepStrictEqual(roster.selOf('draw'), [1, 24, 26]);
    assert.strictEqual(store.get().roster,
      '1 ' + MEMBERS[0].name + '\n24 ' + MEMBERS[1].name + '\n26 ' + MEMBERS[2].name,
      'roster 派生文本应为「座号 姓名」多行');
    roster.setSel('group', [26]);
    assert.deepStrictEqual(roster.selOf('group'), [26]);
    assert.strictEqual(store.get().group.names, MEMBERS[2].name, 'group.names 派生只含姓名');
    assert.deepStrictEqual(roster.poolFilter([1, 2, 3, 4, 5], [2, 4, 9]), [2, 4]);
    assert.deepStrictEqual(roster.poolFilter([1, 2, 3], []), [1, 2, 3], '未选名单 = 不限');
    assert.strictEqual(roster.summary('draw', 2).count, 3);
    assert.strictEqual(roster.summary('draw', 2).chips.length, 2);
    assert.strictEqual(roster.summary('draw', 2).more, 1);
  });

  await test('名单迁移：旧自定义文本按姓名匹配→座号（未知姓名丢弃），点名状态按姓名重排，幂等', () => {
    const { store, roster } = fresh();
    clearMem();
    store.get().classMembers = MEMBERS.slice();
    const d = store.get();
    // 抽签：旧 roster 文本（座号可自定义 / 含未知姓名）
    d.roster = '1 ' + MEMBERS[2].name + '\n2 查无此人\n3 ' + MEMBERS[0].name;
    // 分组：旧粘贴名单（姓名，逗号/换行分隔）
    d.group = { source: 'paste', names: MEMBERS[1].name + '，' + MEMBERS[0].name, sel: [], mode: 'groups', n: 4, shuffle: false };
    // 点名：旧名单顺序与座号顺序不同；状态按旧下标
    d.rollNames = '1 ' + MEMBERS[1].name + '\n2 ' + MEMBERS[0].name;
    d.rollSt = { 0: 'in', 1: 'ab' };
    d.selVer = 0;
    store.save();

    assert.strictEqual(roster.migrate(), true);
    assert.deepStrictEqual(roster.selOf('draw'), [1, 26], '匹配到的座号保留、未知姓名丢弃');
    assert.strictEqual(store.get().roster, '1 ' + MEMBERS[0].name + '\n26 ' + MEMBERS[2].name);
    assert.deepStrictEqual(roster.selOf('group'), [1, 24]);
    assert.strictEqual(store.get().group.names, MEMBERS[0].name + '\n' + MEMBERS[1].name);
    assert.strictEqual(store.get().group.source, 'pick', '旧 paste 来源归一为 pick');
    assert.deepStrictEqual(roster.selOf('roll'), [1, 24]);
    // 旧顺序：测试账号(in) 在前；新顺序按座号：测试甲(1) 在前 → 测试账号排到下标 1，状态仍属于本人
    assert.strictEqual(store.get().rollSt[0], 'ab');
    assert.strictEqual(store.get().rollSt[1], 'in');
    assert.strictEqual(store.get().selVer, 1);

    // 幂等：迁移标记已置位，不再重跑（派生文本保持）
    const before = JSON.stringify({ r: store.get().roster, rn: store.get().rollNames, gn: store.get().group.names });
    assert.strictEqual(roster.migrate(), true);
    assert.strictEqual(JSON.stringify({ r: store.get().roster, rn: store.get().rollNames, gn: store.get().group.names }), before);
    // 迁移后再次迁移不会把状态丢掉
    assert.strictEqual(store.get().rollSt[1], 'in');
  });

  await test('点名：选择名单变化时 到/假 按姓名保留（rollSet 重排下标）', () => {
    const { store, roster } = fresh();
    clearMem();
    store.get().classMembers = MEMBERS.slice();
    // 先有 1 / 24 两人，状态：测试甲=假、测试账号=到
    store.get().rollSel = [1, 24];
    store.get().rollNames = '1 ' + MEMBERS[0].name + '\n24 ' + MEMBERS[1].name;
    store.get().rollSt = { 0: 'ab', 1: 'in' };
    store.save();
    let got = roster.rollSet([24, 26]);
    assert.deepStrictEqual(got, [24, 26]);
    assert.strictEqual(store.get().rollNames, '24 ' + MEMBERS[1].name + '\n26 ' + MEMBERS[2].name);
    assert.deepStrictEqual(store.get().rollSt, { 0: 'in' }, '测试账号(到) 保留；新加入的测试辛未点');
    got = roster.rollSet([1, 24]);
    assert.deepStrictEqual(got, [1, 24]);
    assert.deepStrictEqual(store.get().rollSt, { 1: 'in' }, '测试甲已被移除过，状态不再有；测试账号仍在 → 下标 1');
    got = roster.rollSet([]);
    assert.deepStrictEqual(got, []);
    assert.strictEqual(store.get().rollNames, '');
    assert.deepStrictEqual(store.get().rollSt, {});
  });

  await test('名单迁移：classMembers 为空返回 false（旧文本保留），名单到位后重试成功', () => {
    const { store, roster } = fresh();
    clearMem();
    store.get().roster = '1 ' + MEMBERS[1].name;
    store.get().selVer = 0;
    store.save();
    assert.strictEqual(roster.migrate(), false);
    assert.strictEqual(store.get().selVer, 0, '名单没同步时不应置迁移标记');
    assert.ok(store.get().roster.indexOf(MEMBERS[1].name) >= 0, '旧文本应保留待下次迁移');
    store.get().classMembers = MEMBERS.slice();
    store.save();
    assert.strictEqual(roster.migrate(), true);
    assert.deepStrictEqual(roster.selOf('draw'), [24]);
  });

  await test('云：saveMembers 成功后自动补做名单迁移', async () => {
    const { cloud, store, roster } = cloudFresh();
    setIdentity(ID);
    store.get().roster = '1 ' + MEMBERS[0].name + '\n2 ' + MEMBERS[2].name;
    store.get().selVer = 0;
    store.save();
    reqImpl = (o) => {
      if (urlOf(o).indexOf('/rpc/class_members') >= 0) return o.success({ statusCode: 200, data: MEMBERS });
      return ok([])(o);
    };
    await cloud.classMembersPull();
    assert.strictEqual(store.get().selVer, 1);
    assert.deepStrictEqual(roster.selOf('draw'), [1, 26]);
  });

  await test('抽签：buildPool 在「范围+排除」后按参与名单过滤（只选 3 人 → 池=3）', () => {
    const { store, roster } = fresh();
    clearMem();
    store.get().classMembers = MEMBERS.slice();
    store.save();
    let def = null;
    global.Page = (d) => { def = d; };
    try { require(path.join(ROOT, 'pages/draw/draw.js')); } finally { delete global.Page; }
    assert.ok(def && typeof def.buildPool === 'function', 'draw 页未注册 buildPool');
    roster.setSel('draw', [1, 24, 26]);
    const pool = def.buildPool.call({ data: { start: 1, end: 70, excl: '' } });
    assert.deepStrictEqual(pool.pool, [1, 24, 26], '选了 3 人 → 抽签池只有这 3 个座号');
    assert.deepStrictEqual(pool.sel, [1, 24, 26]);
    const ranged = def.buildPool.call({ data: { start: 10, end: 70, excl: '' } });
    assert.deepStrictEqual(ranged.pool, [24, 26], '名单 ∩ 范围');
    const excluded = def.buildPool.call({ data: { start: 1, end: 70, excl: '24' } });
    assert.deepStrictEqual(excluded.pool, [1, 26], '名单 − 排除');
    roster.setSel('draw', []);
    const all = def.buildPool.call({ data: { start: 1, end: 70, excl: '' } });
    assert.strictEqual(all.pool.length, 70, '未选名单 = 只抽序号（1–70 全部可用）');
  });

  /* ---------------- 缓存 / TTL 单测（1.4.4 性能优化；断言在 cache_unit_tests.js） ---------------- */
  await require('./cache_unit_tests.js').run(test);

  /* ---------------- 通知提醒前端单测（v20 / 1.4.7；断言在 notify_ui_test.js） ---------------- */
  await require('./notify_ui_test.js').run(test);

  /* ---------------- 通知时间显示口径单测（契约 2026-11-05 §2/§3；断言在 notice_time_test.js） ---------------- */
  await require('./notice_time_test.js').run(test);

  /* ---------------- v2.0.0 专项单测（需求 1/2/5/9/10/11/12/13/14/16；断言在 v2_unit_tests.js） ---------------- */
  await require('./v2_unit_tests.js').run(test);

  /* ---------------- v2.0.0 网站功能同步专项（宿舍电费 + 管理员诊断 + UD power section；断言在 v3_power_diag_tests.js） ---------------- */
  await require('./v3_power_diag_tests.js').run(test);

  /* ---------------- 2026-11-07 电费趋势气泡「固定显示」（网页同口径；断言在 tip_fixed_unit.js） ---------------- */
  await require('./tip_fixed_unit.js').run(test);

  /* ---------------- 2026-11-06 水量统计专项（水费公式 / 对比删除重算 / UD water section / water 页） ---------------- */
  await require('./water_unit_tests.js').run(test);

  /* ---------------- 2026-11-09 PPT 演示专项（列表/上传/播放器/清单归一化；断言在 ppt_unit_tests.js） ---------------- */
  await require('./ppt_unit_tests.js').run(test);

  /* ---------------- 2026-11-10 PPT v1.2 原样播放视频 + 续播 + 降级链（断言在 ppt_video_unit_tests.js） ---------------- */
  await require('./ppt_video_unit_tests.js').run(test);

  /* ---------------- 2026-11-10 PPT v2.0 下载中心（详情/三行下载/转发/旧 deck；断言在 ppt_dl_unit_tests.js） ---------------- */
  await require('./ppt_dl_unit_tests.js').run(test);

  /* ---------------- 2026-11-10 通知附件外置（迁移第 2 步）：签名 URL / data URI 双形态（断言在 nt_attach_url_tests.js） ---------------- */
  await require('./nt_attach_url_tests.js').run(test);

  /* ---------------- 2026-11-11 投票专项（列表/发起/详情/投票/管理 + RPC 契约；断言在 vote_unit_tests.js） ---------------- */
  await require('./vote_unit_tests.js').run(test);

  await require('./screencast_unit_tests.js').run(test);

  /* ---------------- 2026-11-12 文件传输·临时云空间专项（utils/cloudspace + pages/cloudspace） ---------------- */
  await require('./cloudspace_unit_tests.js').run(test);

  /* ---------------- 2026-11-12 名单页三分类（班委 / 团员 / 全班）+ 管理 RPC（断言在 committee_unit_tests.js） ---------------- */
  await require('./committee_unit_tests.js').run(test);

  /* ---------------- 2026-11-11 task-7 专项（反馈 2/6/8/9/11：缓存提速 / 新通知提醒 / 水量共享 / 名单预设 / 徽章） ---------------- */
  await require('./task7_unit_tests.js').run(test);

  /* ---------------- 2026-11-12 抽签升级 v1（名称映射 / 云端存证 / 记录页 / 导出二维码；断言在 drawproof_unit_tests.js） ---------------- */
  await require('./drawproof_unit_tests.js').run(test);

  /* ---------------- 2026-11-12 长期通知优化显示（主列表紧急度排序 + 独立折叠区；断言在 notice_longterm_unit.js） ---------------- */
  await require('./notice_longterm_unit.js').run(test);

  /* ---------------- 2026-11-14 契约：期次长期通知 + 5 卡可点筛选 + 资料栏 + 时间格式（断言在 notice_occ_unit.js） ---------------- */
  await require('./notice_occ_unit.js').run(test);

  /* ---------------- 2026-11-18 契约：通知「发布时间」统一（发布卡进主列表/排序/统计；断言在 notice_publish_unit.js） ---------------- */
  await require('./notice_publish_unit.js').run(test);

  /* ---------------- 2026-11-15 外观（跟随系统/浅色/深色）+ 电费比较独立行（断言在 appearance_unit_tests.js） ---------------- */
  await require('./appearance_unit_tests.js').run(test);

  /* ---------------- 2026-11-18 PPT 在线媒体 ECS /pptfiles 映射（断言在 ppt_ecs_unit_tests.js） ---------------- */
  await require('./ppt_ecs_unit_tests.js').run(test);

  /* ---------------- 2026-11-18 自建后端切流（三档 base）+ 网络层体验优化（断言在 net_layer_tests.js） ---------------- */
  await require('./net_layer_tests.js').run(test);

  /* ---------------- 2026-11-19 分享卡（抽签/投票 canvas）+ 法律正文 + 分包（断言在 share_legal_unit.js） ---------------- */
  await require('./share_legal_unit.js').run(test);

  /* ---------------- 2026-11-19 鸿蒙间隔参数（16/24/32vp 边距、12vp 卡片、16/8vp 元素、2/8vp 文本） ---------------- */
  await require('./interval_unit.js').run(test);

  /* ---------------- 汇总 ---------------- */
  const summary = { total: passN + failN, pass: passN, fail: failN, results, at: new Date().toISOString() };
  fs.writeFileSync(path.join(__dirname, 'unit-result.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log('\n================ ' + passN + ' passed, ' + failN + ' failed ================');
  process.exitCode = failN ? 2 : 0;
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

