/* 端到端测试：班级工具站微信小程序（微信开发者工具 + miniprogram-automator）
 *
 * ⚠️ v13 待重写（2026-11-04）：v12 / 1.3.0 身份系统重构后，本脚本中以下旧用例已不适用，请勿作为回归依据：
 *    - 旧账号密码注册 / 登录 / 会话（users 表、sha256、zq_session）——已下线；
 *    - pages/verify 姓名 + 学号二次认证、identity_verify / roster 表断言——已下线；
 *    - 旧 admin 账号名权限、未登录游客可查看 / 勾选作业通知等断言——身份系统下所有页面都需先验证身份；
 *    - 旧课表管理（添加/删除课程、开学日期、入口隐藏）——v11 起课表为只读 tt.json。
 *    本次回归以 `node unit.js` + `python staticcheck.py` + `identity_preview.js`（截图到 _shots/）为准。
 *
 * 前置：开发者工具已打开本项目，且已执行
 *   cli.bat auto --project <项目> --auto-port 9420 --trust-project
 * 运行：node e2e.js
 * 说明：所有 wx.request / showModal / showToast / 相册 API 都在小程序运行时内被替换为假实现，
 *       不会写入真实云表、不会真的保存图片。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const automator = require('miniprogram-automator');

const OUT = __dirname;
const SHOT_DIR = path.join(OUT, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
let passN = 0, failN = 0;
const findings = [];
const exceptions = [];
const consoleIssues = [];

function h(acc, pw) { return crypto.createHash('sha256').update(String(acc) + '\u0001' + String(pw), 'utf8').digest('hex'); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(name, fn) {
  try {
    await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT 45s')), 45000))
    ]);
    passN++; results.push({ name, ok: true }); console.log('PASS  ' + name);
  }
  catch (e) { failN++; results.push({ name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
}
function finding(id, title, detail, sev) {
  findings.push({ id, title, detail, severity: sev || '中' });
  console.log('FIND  [' + (sev || '中') + '] ' + title + ' :: ' + detail);
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed'); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function includes(s, sub, msg) { if (String(s).indexOf(sub) < 0) throw new Error((msg || 'missing') + ': ' + sub + ' in ' + String(s).slice(0, 200)); }

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  mp.on('exception', (e) => exceptions.push(e));
  mp.on('console', (e) => {
    if (e.type === 'error' || e.type === 'warning') consoleIssues.push({ type: e.type, text: (e.args || []).join(' ') });
  });

  /* ---------------- 运行时替换 wx API（保留回调） ---------------- */
  await mp.evaluate(() => {
    wx.__toasts = []; wx.__modals = []; wx.__reqs = []; wx.__clip = ''; wx.__canvas = 0; wx.__saved = 0; wx.__fx = {};
    wx.showToast = function (o) { if (o && o.title) wx.__toasts.push(String(o.title)); };
    wx.showLoading = function () {}; wx.hideLoading = function () {};
    wx.showModal = function (o) {
      wx.__modals.push({ title: (o && o.title) || '', content: (o && o.content) || '' });
      if (o && o.success) o.success({ confirm: wx.__modalConfirm !== false, cancel: wx.__modalConfirm === false });
    };
    wx.showActionSheet = function (o) { if (o && o.success) o.success({ tapIndex: wx.__sheetIndex || 0 }); };
    wx.setClipboardData = function (o) { wx.__clip = String((o && o.data) || ''); if (o && o.success) o.success(); };
    wx.getClipboardData = function (o) { if (o && o.success) o.success({ data: wx.__clip }); };
    wx.canvasToTempFilePath = function (o) { wx.__canvas += 1; if (o && o.success) o.success({ tempFilePath: '/tmp/mp-test.png' }); };
    wx.saveImageToPhotosAlbum = function (o) { wx.__saved += 1; if (o && o.success) o.success(); };
    wx.getSetting = function (o) { if (o && o.success) o.success({ authSetting: { 'scope.writePhotosAlbum': true } }); };
    wx.openSetting = function (o) { if (o && o.success) o.success({ authSetting: { 'scope.writePhotosAlbum': true } }); };
    wx.request = function (o) {
      const u = String(o.url || '');
      wx.__reqs.push({ url: u, method: o.method || 'GET', data: o.data });
      const fx = wx.__fx || {};
      if (fx.fail) { if (o.fail) o.fail({ errMsg: 'request:fail mock' }); return; }
      let data = [];
      if (u.indexOf('/users?') >= 0) data = fx.users || [];
      else if (u.indexOf('/homework') >= 0 && (o.method || 'GET') === 'GET') data = fx.homework || [];
      else if (u.indexOf('/notices') >= 0 && (o.method || 'GET') === 'GET') data = fx.notices || [];
      else if (u.indexOf('/marks') >= 0 && (o.method || 'GET') === 'GET') data = fx.marks || [];
      else if (u.indexOf('/roster') >= 0 && (o.method || 'GET') === 'GET') data = fx.roster || [];
      else if (u.indexOf('/identity_verify') >= 0 && (o.method || 'GET') === 'GET') data = fx.identity || [];
      else if (u.indexOf('/fitrecs') >= 0 && (o.method || 'GET') === 'GET') data = fx.fitrecs || [];
      else if (u.indexOf('/visits') >= 0 && (o.method || 'GET') === 'GET') data = fx.visits || [];
      else if (u.indexOf('/userdata') >= 0 && (o.method || 'GET') === 'GET') data = fx.userdata === undefined ? [] : fx.userdata;
      else if (u.indexOf('/feedback') >= 0 && (o.method || 'GET') === 'GET') data = fx.feedback || [];
      else if ((o.method || 'GET') === 'POST' || (o.method || 'GET') === 'PATCH') data = fx.write || [];
      if (o.success) o.success({ statusCode: 200, data });
    };
  });

  async function evalIn(fn, ...args) { return await mp.evaluate(fn, ...args); }
  async function resetAll() {
    await evalIn(() => {
      try { require('utils/cloud.js').logout(); } catch (e) {}
      try { wx.clearStorageSync(); } catch (e) {}
      const s = require('utils/store.js'); s.reset();
      require('utils/flow.js').clearFlow();
      wx.__toasts = []; wx.__modals = []; wx.__reqs = []; wx.__clip = ''; wx.__canvas = 0; wx.__saved = 0; wx.__fx = {};
      wx.__modalConfirm = true; wx.__sheetIndex = 0;
    });
  }
  async function seed(patch) {
    await evalIn((p) => { const s = require('utils/store.js'); Object.assign(s.get(), p); s.save(); }, patch);
  }
  async function seedFlow(draw, group) {
    await evalIn((d, g) => { const f = require('utils/flow.js'); f.setFlow({ draw: d || null, group: g || null, updatedAt: 0 }); }, draw, group);
  }
  async function fx(obj) { await evalIn((o) => { wx.__fx = o || {}; }, obj); }
  async function clearLogs() { await evalIn(() => { wx.__toasts = []; wx.__modals = []; wx.__reqs = []; wx.__canvas = 0; wx.__saved = 0; }); }
  async function toasts() { return await evalIn(() => wx.__toasts || []); }
  async function modals() { return await evalIn(() => wx.__modals || []); }
  async function reqs() { return await evalIn(() => wx.__reqs || []); }
  async function canvasState() { return await evalIn(() => ({ canvas: wx.__canvas, saved: wx.__saved })); }
  async function nav(url) {
    const p = await Promise.race([
      mp.reLaunch(url),
      new Promise((_, rej) => setTimeout(() => rej(new Error('nav timeout: ' + url)), 20000))
    ]);
    await sleep(350); return p;
  }
  async function call(method, ...args) {
    return await evalIn((m, a) => {
      const ps = getCurrentPages(); const p = ps[ps.length - 1];
      if (!p || typeof p[m] !== 'function') throw new Error('page method not found: ' + m);
      return p[m].apply(p, a);
    }, method, args);
  }
  async function data() { return await (await mp.currentPage()).data(); }
  async function shot(name) {
    try { await mp.screenshot({ path: path.join(SHOT_DIR, name + '.png') }); } catch (e) { console.log('SHOT FAIL', name, e.message); }
  }
  async function loginAs(acc, pw) {
    pw = pw || 'pw123';
    const cur = await evalIn(() => wx.__fx || {});
    await fx(Object.assign({}, cur, { users: [{ id: acc, h: h(acc, pw) }] }));
    await nav('/pages/me/me');
    await (await mp.currentPage()).setData({ accIn: acc, pwIn: pw });
    await call('doAuth');
    await sleep(900);
    const d = await data();
    assert(d.logged === true, 'loginAs failed: ' + acc + ' / ' + JSON.stringify(await modals()));
    return d;
  }

  /* ============================================================
     0. 工作台
     ============================================================ */
  await resetAll();
  await seed({
    course: [{ name: '高数', day: 0, start: 1, end: 2, weeks: '1-16', parity: 'all' }],
    homework: [{ id: 'h1', content: '已完成但 done=false', done: false, ts: 1 }],
    hwDone: { h1: true },
    notices: [{ id: 'n1', title: 'n1', body: '', ts: 1 }, { id: 'n2', title: 'n2', body: '', ts: 2 }, { id: 'n3', title: 'n3', body: '', ts: 3 }],
    roster: '1 甲\n2 乙\n3 丙\n4 丁'
  });
  await fx({
    homework: [{ id: 'h1', content: '已完成但 done=false', done: false, ts: 1 }],
    notices: [{ id: 'n1', title: 'n1', body: '', ts: 1 }, { id: 'n2', title: 'n2', body: '', ts: 2 }, { id: 'n3', title: 'n3', body: '', ts: 3 }]
  });
  let page = await nav('/pages/index/index');
  await page.waitFor(1200);
  await shot('01-index');
  await check('工作台：默认 4 个工具入口，顺序为 作业/通知/体测/抽签', async () => {
    const d = await data();
    assert(d.state === 'data');
    eq(d.tools.map((t) => t.key), ['hw', 'nt', 'ft', 'draw', 'roll']);
    assert(d.remoteEnabled === true);
  });
  await check('工作台：数据概览统计课程/作业/通知/名单人数', async () => {
    const d = await data();
    assert(d.stat.course === 1, 'course=' + d.stat.course);
    assert(d.stat.nt === 3, 'nt=' + d.stat.nt);
    assert(d.stat.roster === 4, '游客自定义名单也应计数，实际 ' + d.stat.roster);
  });
  await check('工作台：待完成作业数应排除已勾选完成（使用 hwDone）', async () => {
    const d = await data();
    if (d.stat.hw !== 0) {
      finding('home-stat-done', '工作台「待完成作业」把已勾选完成的作业算进去', 'homework 行 done=false、hwDone[h1]=true 时 stat.hw=' + d.stat.hw + '，正确应为 0；index.js 用 !h.done 而不是 hwDone', '中');
      throw new Error('stat.hw=' + d.stat.hw + '，应为 0');
    }
  });
  await check('工作台：清空记录只清抽签/分组（弹窗确认）', async () => {
    await seedFlow({ result: [1, 2] }, { result: [[1], [2]] });
    await call('resetFlow');
    await sleep(300);
    const f = await evalIn(() => require('utils/flow.js').getFlow());
    assert(!f.draw && !f.group);
    assert((await toasts()).some((t) => t.indexOf('已清空记录') >= 0));
  });

  await check('工作台：标题栏用双阈值收缩，不在 40px 边缘来回抽搐', async () => {
    await call('onPageScroll', { scrollTop: 90 }); await sleep(300);
    assert((await data()).scrolled === true, '90px 应收缩');
    await call('onPageScroll', { scrollTop: 30 }); await sleep(300);
    assert((await data()).scrolled === true, '30px 应保持（不应在 40 附近来回）');
    await call('onPageScroll', { scrollTop: 5 }); await sleep(300);
    assert((await data()).scrolled === false, '5px 应展开');
    await call('onPageScroll', { scrollTop: 0 }); await sleep(150);
  });

  /* ============================================================
     1. 抽签
     ============================================================ */
  await resetAll();
  page = await nav('/pages/draw/draw');
  await shot('02-draw-empty');
  await check('抽签：初始参数来自 store（1/70/10，不重复，抽取顺序）', async () => {
    const d = await data();
    eq([d.start, d.end, d.count, d.dup], [1, 70, 10, false]);
    assert(d.state === 'empty');
  });
  await check('抽签：1-10 抽 5 个，不重复且都在范围内', async () => {
    await page.setData({ start: 1, end: 10, count: 5 });
    await call('doDraw');
    await sleep(250);
    const d = await data();
    assert(d.state === 'data');
    assert(d.rows.length === 5, 'rows=' + d.rows.length);
    assert(new Set(d.rows.map((r) => r.n)).size === 5, '出现重复');
    d.rows.forEach((r) => assert(r.n >= 1 && r.n <= 10));
    assert(d.poolLen === 10);
    assert(d.cfg && d.cfg.range === '1 – 10');
  });
  await check('抽签：序号升序/从大到小排序生效', async () => {
    await call('setSort', { currentTarget: { dataset: { v: 'num' } } });
    await sleep(150);
    let ns = (await data()).rows.map((r) => r.n);
    assert(ns.every((v, i) => i === 0 || ns[i - 1] <= v), '升序失败 ' + ns);
    await call('setSort', { currentTarget: { dataset: { v: 'desc' } } });
    await sleep(150);
    ns = (await data()).rows.map((r) => r.n);
    assert(ns.every((v, i) => i === 0 || ns[i - 1] >= v), '降序失败 ' + ns);
  });
  await check('抽签：排序后 cfg.sort 标签同步更新', async () => {
    const d = await data();
    if (!/升序|降序|随机|从大到小/.test((d.cfg && d.cfg.sort) || '')) {
      finding('draw-sort-label', '抽签排序后「参数配置-结果排序」仍显示按抽取顺序', '点“序号升序/从大到小”只重排 rows，不更新 cfg.sort；导出图片的参数配置会写错。当前 cfg.sort=' + (d.cfg && d.cfg.sort), '低');
      throw new Error('cfg.sort=' + (d.cfg && d.cfg.sort));
    }
  });
  await check('抽签：剔除后自动重抽会保持不重复', async () => {
    await page.setData({ start: 1, end: 10, count: 10, dup: false, autoRe: true, sort: 'draw' });
    await call('doDraw');
    await sleep(200);
    // 固定随机数，逼出“补抽到已在结果里的序号”
    await evalIn(() => { wx.__oldRandom = Math.random; Math.random = function () { return 0; }; });
    await call('remove', { detail: { index: 0 } });
    await sleep(200);
    const d = await data();
    await evalIn(() => { Math.random = wx.__oldRandom; });
    const ns = d.rows.map((r) => r.n);
    if (new Set(ns).size !== ns.length) {
      finding('draw-refill-dup', '「剔除后自动重抽」会补进重复序号', 'draw.js removeAt 用 cfg.dup（“是/否”字符串恒为真）作判断，未排除当前结果；不重复模式下也会补到已有序号。本次结果 ' + JSON.stringify(ns), '高');
      throw new Error('补抽后出现重复：' + JSON.stringify(ns));
    }
  });
  await check('抽签：关闭自动重抽后剔除只减不补', async () => {
    await page.setData({ start: 1, end: 10, count: 10, dup: false, autoRe: false });
    await call('doDraw');
    await sleep(200);
    const before = (await data()).rows.length;
    await call('remove', { detail: { index: 0 } });
    await sleep(200);
    const d = await data();
    assert(d.rows.length === before - 1, 'rows=' + d.rows.length);
    assert(d.removed.length === 1);
  });
  await check('抽签：补抽恢复到目标个数且不重复', async () => {
    await call('refill');
    await sleep(250);
    const d = await data();
    assert(d.rows.length === 10, 'rows=' + d.rows.length);
    assert(new Set(d.rows.map((r) => r.n)).size === 10, '补抽出现重复');
  });
  await check('抽签：排除后池不足时给出提示且不改结果', async () => {
    await page.setData({ start: 1, end: 10, count: 10, dup: false, excl: '3,7,9-10' });
    const before = (await data()).rows.map((r) => r.n);
    await clearLogs();
    await call('doDraw');
    await sleep(250);
    const t = await toasts();
    assert(t.some((x) => x.indexOf('可用序号只有 6 个') >= 0), 'toast=' + JSON.stringify(t));
    eq((await data()).rows.map((r) => r.n), before);
  });
  await check('抽签：允许重复时 1-3 抽 8 个可重复且都在范围内', async () => {
    await page.setData({ start: 1, end: 3, count: 8, dup: true, excl: '' });
    await call('doDraw');
    await sleep(250);
    const d = await data();
    assert(d.rows.length === 8);
    d.rows.forEach((r) => assert(r.n >= 1 && r.n <= 3));
    assert(new Set(d.rows.map((r) => r.n)).size < 8, '未出现重复');
  });
  await check('抽签：名单对应（1 张三…）显示序号+姓名', async () => {
    await resetAll();
    await seed({ roster: '1 张三\n2 李四\n3 王五' });
    page = await nav('/pages/draw/draw');
    await page.setData({ start: 1, end: 3, count: 3, dup: false, excl: '' });
    await call('doDraw');
    await sleep(300);
    const d = await data();
    eq(d.rows.map((r) => r.nm).sort(), ['张三', '李四', '王五'].sort());
  });
  await check('抽签：导出图片走通（画布→临时文件→相册）', async () => {
    await clearLogs();
    await call('exportImg');
    await sleep(1200);
    const c = await canvasState();
    const t = await toasts();
    assert(c.canvas === 1, 'canvas 未调用');
    assert(c.saved === 1, '相册未保存');
    assert(t.some((x) => x.indexOf('已保存到相册') >= 0), 'toast=' + JSON.stringify(t));
  });
  await check('抽签：重置清空结果与 flow', async () => {
    await call('reset');
    await sleep(300);
    const d = await data();
    assert(d.rows.length === 0);
    const f = await evalIn(() => require('utils/flow.js').getFlow());
    assert(!f.draw);
  });
  await shot('03-draw-result');

  await check('抽签：从云端加载班级名单 / 管理员更新云端名单', async () => {
    await resetAll();
    await fx({
      users: [{ id: 'admin', h: h('admin', 'pw123') }],
      roster: [{ id: 'main', data: JSON.stringify({ roster: '1 甲\n2 乙' }) }]
    });
    await loginAs('admin', 'pw123');
    page = await nav('/pages/draw/draw');
    await page.waitFor(400);
    await clearLogs();
    await call('pullRoster');
    await sleep(500);
    let d = await data();
    assert(d.rosterN === 2 && d.rosterDraft.indexOf('甲') >= 0, JSON.stringify({ n: d.rosterN, draft: d.rosterDraft }));
    await clearLogs();
    await call('pushRoster');
    await sleep(500);
    assert((await reqs()).some((r) => r.method === 'POST' && r.url.indexOf('/roster') >= 0), '未写 roster 表');
    assert((await toasts()).some((t) => t.indexOf('已更新云端名单') >= 0), JSON.stringify(await toasts()));
  });

  /* ============================================================
     2. 分组
     ============================================================ */
  await resetAll();
  await seed({ roster: '1 甲\n2 乙\n3 丙\n4 丁\n5 戊\n6 己\n7 庚\n8 辛\n9 壬\n10 癸' });
  await seedFlow({ result: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], pool: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], removed: [], log: [], cfg: { range: '1 – 10', rangeF: '1-10', count: '10', dup: '否', excl: '无', sort: '按抽取顺序', pool: '10' } }, null);
  page = await nav('/pages/group/group');
  await shot('04-group');
  await check('分组：默认用上一步 10 人、4 组，轮转分配 3/3/2/2', async () => {
    const d = await data();
    assert(d.prevN === 10);
    await page.setData({ mode: 'groups', n: 4, shuffle: false });
    await call('doGroup');
    await sleep(300);
    const g = await data();
    eq(g.groups.map((x) => x.size), [3, 3, 2, 2]);
    const flat = g.groups.reduce((a, x) => a.concat(x.members.map((m) => m.n)), []);
    eq(flat.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
  await check('分组：不打乱时重复执行结果稳定', async () => {
    const a = JSON.stringify((await data()).groups);
    await call('doGroup');
    await sleep(200);
    eq(JSON.stringify((await data()).groups), a);
  });
  await check('分组：打乱后成员分布变化（3 次内至少 1 次不同）', async () => {
    await page.setData({ shuffle: true });
    const sigs = new Set([JSON.stringify((await data()).groups)]);
    for (let i = 0; i < 3; i++) { await call('doGroup'); await sleep(200); sigs.add(JSON.stringify((await data()).groups)); }
    assert(sigs.size > 1, '打乱后结果始终相同');
  });
  await check('分组：粘贴名单，按组数 2 组分 5 人 → 3/2', async () => {
    await page.setData({ source: 'paste', names: '甲,乙,丙,丁,戊', mode: 'groups', n: 2, shuffle: false });
    await call('doGroup');
    await sleep(300);
    const d = await data();
    eq(d.groups.map((x) => x.size), [3, 2]);
  });
  await check('分组：按每组 2 人分 5 人 → 3 组 2/2/1', async () => {
    await page.setData({ mode: 'per', n: 2 });
    await call('doGroup');
    await sleep(300);
    eq((await data()).groups.map((x) => x.size), [2, 2, 1]);
  });
  await check('分组：导出图片走通', async () => {
    await clearLogs();
    await call('exportImg');
    await sleep(1200);
    const c = await canvasState();
    assert(c.canvas === 1 && c.saved === 1, JSON.stringify(c));
  });
  await check('分组：提供复制文本（与网页版对齐）', async () => {
    const has = await evalIn(() => { const p = getCurrentPages().slice(-1)[0]; return typeof p.copy === 'function' || typeof p.copyText === 'function'; });
    if (!has) {
      finding('group-no-copy', '分组页缺少“复制”能力', '网页版分组有「复制」按钮，小程序 group 页只有导出图片；README 标为“完全对齐”。', '低');
      throw new Error('无复制方法/按钮');
    }
  });

  /* ============================================================
     3. 结果单
     ============================================================ */
  await check('结果单：抽签 + 分组汇总、参数、复制文本、导出', async () => {
    await seedFlow({ result: [3, 1, 2], removed: [9], pool: [1, 2, 3, 9], log: [], cfg: { range: '1 – 3', rangeF: '1-3', count: '3', dup: '否', excl: '无', sort: '按抽取顺序', pool: '3' } },
      { result: [[{ n: 1, nm: '甲' }, { n: 2, nm: '乙' }], [{ n: 3, nm: '丙' }]], cfg: { source: '上一步抽签序号', mode: '按组数(2 组)', total: '3', groups: '2', inner: '按原顺序轮流分配' } });
    page = await nav('/pages/sum/sum');
    await shot('05-sum');
    const d = await data();
    assert(d.state === 'data');
    assert(d.cfg.length >= 8, 'cfg=' + d.cfg.length);
    assert(d.viewBlocks.length === 3, 'blocks=' + d.viewBlocks.length);
    includes(d.text, '抽签 · 范围');
    includes(d.text, '第 1 组');
    await clearLogs();
    await call('copyText');
    await sleep(200);
    const clip = await evalIn(() => wx.__clip);
    includes(clip, '抽签 · 范围');
    includes(clip, '第 1 组');
    await clearLogs();
    await call('exportImg');
    await sleep(1200);
    const c = await canvasState();
    assert(c.canvas === 1 && c.saved === 1, JSON.stringify(c));
  });
  await check('结果单：空状态与“先完成抽签/分组”提示', async () => {
    await evalIn(() => require('utils/flow.js').clearFlow());
    page = await nav('/pages/sum/sum');
    assert((await data()).state === 'empty');
    await clearLogs();
    await call('copyText');
    assert((await toasts()).some((t) => t.indexOf('暂无内容') >= 0));
  });

  /* ============================================================
     4. 作业板
     ============================================================ */
  await resetAll();
  await fx({ users: [] });
  page = await nav('/pages/hw/hw');
  await shot('06-hw-empty');
  await check('作业：空内容守卫', async () => {
    await call('openSheet');
    await call('add');
    await sleep(150);
    assert((await toasts()).some((t) => t.indexOf('填写作业内容') >= 0));
    assert((await data()).open.length === 0);
  });
  await check('作业：截止日期可选，发布无截止作业', async () => {
    await evalIn(() => { const s = require('utils/store.js'); s.get().homework = []; s.save(); });
    await page.setData({ form: { subject: '无截止', content: '没有截止日期也能发布', due: '', date: '', author: '小明' } });
    await call('add');
    await sleep(300);
    const d = await data();
    assert(d.open.length === 1, 'open=' + d.open.length);
    assert(d.open[0].date === '', 'date=' + d.open[0].date);
    assert(d.open[0].dueInfo.txt.indexOf('无截止日期') >= 0, d.open[0].dueInfo.txt);
    await evalIn(() => { const s = require('utils/store.js'); s.get().homework = []; s.save(); });
  });

  await check('作业：有截止日期的记录在截止三天后自动清除', async () => {
    await evalIn(() => {
      const s = require('utils/store.js');
      s.get().homework = [
        { content: '已过期', date: '2020-01-01', ts: 1, id: 'expired-hw' },
        { content: '未来作业', date: '2099-01-01', ts: 2, id: 'future-hw' },
        { content: '无截止', date: '', ts: 3, id: 'nodue-hw' }
      ];
      s.save();
    });
    await call('refresh');
    await sleep(300);
    const d = await data();
    assert(!d.open.some((h) => h.content === '已过期'), '过期作业没有清除');
    assert(d.open.some((h) => h.content === '未来作业') && d.open.some((h) => h.content === '无截止'), '误删未到期作业');
    await evalIn(() => { const s = require('utils/store.js'); s.get().homework = []; s.save(); });
  });

  await check('作业：添加（科目/多行内容/截止/昵称）并显示', async () => {
    await clearLogs();
    await page.setData({ form: { subject: '高数', content: '习题 1\n习题 2', due: '下节课前', date: '2026-10-20', author: '小明' } });
    await call('add');
    await sleep(500);
    const d = await data();
    assert(d.open.length === 1, 'open=' + d.open.length);
    assert(d.open[0].content === '习题 1\n习题 2', '内容=' + JSON.stringify(d.open[0].content));
    assert(d.open[0].subject === '高数');
    includes(d.open[0].dueInfo.txt, '还剩');
  });
  await check('作业：内容支持多行输入且列表不截断', async () => {
    const n = (await page.$$('textarea')).length;
    if (n === 0) {
      finding('hw-single-line', '作业内容只能单行输入，列表用 ellipsis 截断', 'hw.wxml 的「内容」是 <input>（单行），列表标题带 ellipsis；网页版 10-15 已改多行 textarea + 换行显示，小程序未同步。', '中');
      throw new Error('表单没有 textarea');
    }
  });
  await check('作业：勾选完成后进入已完成并可撤销', async () => {
    await call('toggle', { currentTarget: { dataset: { index: 0 } } });
    await sleep(300);
    let d = await data();
    assert(d.open.length === 0 && d.done.length === 1, JSON.stringify({ open: d.open.length, done: d.done.length }));
    const doneMap = await evalIn(() => require('utils/store.js').get().hwDone || {});
    assert(Object.values(doneMap).some(Boolean), '未写本机 hwDone');
    await call('untoggle', { currentTarget: { dataset: { index: 0 } } });
    await sleep(300);
    d = await data();
    assert(d.open.length === 1 && d.done.length === 0);
  });
  await check('作业：删除后本机隐藏（云行不物理删除）', async () => {
    await clearLogs();
    await call('removeAt', 'open', 0);
    await sleep(400);
    const d = await data();
    assert(d.open.length === 0);
    assert(d.hiddenN === 1, 'hiddenN=' + d.hiddenN);
  });
  await check('作业：手动同步后已删除的云端作业不再出现', async () => {
    const row = (await evalIn(() => require('utils/store.js').get().homework[0]));
    await fx({ homework: [row] });
    await clearLogs();
    await call('pullCloud');
    await sleep(600);
    const d = await data();
    assert(d.open.length === 0 && d.hiddenN === 1, JSON.stringify({ open: d.open.length, hiddenN: d.hiddenN }));
  });
  await check('作业：断网添加进入待补发，恢复后补发', async () => {
    await fx({ fail: true });
    await page.setData({ form: { subject: '英语', content: 'Unit 3', due: '', date: '', author: '' } });
    await clearLogs();
    await call('add');
    await sleep(400);
    const it = await evalIn(() => { const hs = require('utils/store.js').get().homework; return hs[hs.length - 1]; });
    assert(it._pending === true, '未标记待补发');
    assert((await toasts()).some((t) => t.indexOf('自动补发') >= 0));
    await fx({});
    await evalIn(() => require('utils/cloud.js').flushPending());
    await sleep(300);
    const it2 = await evalIn(() => { const hs = require('utils/store.js').get().homework; return hs[hs.length - 1]; });
    assert(it2._pending !== true, '补发未清标记');
  });
  await check('作业：导出图片走通', async () => {
    await clearLogs();
    await call('exportImg');
    await sleep(1200);
    const c = await canvasState();
    assert(c.canvas === 1 && c.saved === 1, JSON.stringify(c));
  });

  /* ============================================================
     5. 通知板
     ============================================================ */
  await resetAll();
  page = await nav('/pages/nt/nt');
  await shot('07-nt-empty');
  await check('通知：空标题守卫', async () => {
    await call('openSheet');
    await call('add');
    await sleep(150);
    assert((await toasts()).some((t) => t.indexOf('填写标题') >= 0));
  });
  await check('通知：发布（置顶/重要/正文/昵称）并置顶排序', async () => {
    await page.setData({ form: { title: '班会', body: '周五 19:00\nA301', pin: true, imp: true, author: '班长' } });
    await call('add');
    await sleep(600);
    await call('refresh');
    await sleep(200);
    const d = await data();
    assert(d.list.length === 1, 'list=' + JSON.stringify(d.list));
    assert(d.list[0].imp === true, 'imp=' + d.list[0].imp + ' form=' + JSON.stringify(d.list[0]));
    assert(d.list[0].body.indexOf('\n') >= 0, 'body=' + JSON.stringify(d.list[0].body));
  });
  await check('通知：发布后置顶状态在拿到云端 id 后仍保持', async () => {
    await call('refresh');
    await sleep(200);
    const d = await data();
    if (d.list[0].pinned !== true) {
      finding('nt-pin-lost', '发布时勾选“置顶”，拿到云端 id 后置顶丢失', 'nt.js add() 发布成功后只保存 id，没有把 pin 写入 ntPin；isPin() 对带 id 的行只认 ntPin，不认 n.pin，所以刷新后变回未置顶。', '高');
      throw new Error('pinned=' + d.list[0].pinned);
    }
  });
  await check('通知：置顶开关与筛选（全部/置顶/重要）', async () => {
    await resetAll();
    await seed({ notices: [{ id: 'n1', title: '置顶通知', body: 'x', imp: true, ts: 2 }], ntPin: { n1: true } });
    await fx({ notices: [{ id: 'n1', title: '置顶通知', body: 'x', imp: true, ts: 2 }] });
    page = await nav('/pages/nt/nt');
    await sleep(300);
    let d = await data();
    assert(d.list.length === 1 && d.list[0].pinned === true);
    await call('onSeg', { detail: { value: 'pin' } });
    await sleep(200);
    assert((await data()).list.length === 1);
    await call('onSeg', { detail: { value: 'imp' } });
    await sleep(200);
    assert((await data()).list.length === 1);
    await call('togglePin', { currentTarget: { dataset: { index: 0 } } });
    await sleep(250);
    d = await data();
    assert(d.list[0].pinned === false, '取消置顶失败');
  });
  await check('通知：删除后云端同步不应重新出现', async () => {
    await resetAll();
    await seed({ notices: [] });
    await fx({ notices: [{ id: 'n-cloud', title: '云端通知', body: 'x', imp: false, ts: 123 }] });
    page = await nav('/pages/nt/nt');
    await sleep(600);
    await call('pullCloud');
    await sleep(600);
    assert((await data()).list.length === 1, '未拉到云端通知');
    await call('del', { detail: { index: 0 } });
    await sleep(400);
    assert((await data()).list.length === 0, '删除后仍在本机');
    await call('pullCloud');
    await sleep(700);
    const d = await data();
    if (d.list.length === 1) {
      finding('nt-delete-returns', '通知删除只删本机，云端下次拉取会“复活”', 'nt.js del() 仅 splice 本机数组，没有像网页版那样 PATCH archived=true；页面 onShow/30s 同步会重新拉回。', '高');
      throw new Error('删除后又被拉回：' + d.list[0].title);
    }
  });
  await check('通知：导出图片走通', async () => {
    await resetAll();
    const notice = { id: 'n-export', title: '通知 A', body: '正文 A', imp: true, ts: 1 };
    await seed({ notices: [notice] });
    await fx({ notices: [notice] });
    page = await nav('/pages/nt/nt');
    await page.waitFor(500);
    await clearLogs();
    await call('exportImg');
    await sleep(1200);
    const c = await canvasState();
    assert(c.canvas === 1 && c.saved === 1, JSON.stringify(c));
  });

  /* ============================================================
     6. 体测
     ============================================================ */
  await resetAll();
  page = await nav('/pages/ft/ft');
  await shot('08-ft-empty');
  const maleForm = { h: '175', w: '65', vc: '4300', r50: '7.1', sit: '17.7', jump: '248', pull: '15', durM: '3', durS: '42' };
  await check('体测：男大一大二全 80 档 → 83 分 / 良好 / 7 行', async () => {
    await page.setData({ sex: 'm', grade: '12', form: maleForm });
    await call('calc');
    await sleep(400);
    const d = await data();
    assert(d.res && d.res.total === 83, 'total=' + (d.res && d.res.total));
    assert(d.res.grade === '良好');
    assert(d.res.rows.length === 7);
    assert(d.barWidth === 83);
  });
  await check('体测：女大三大四切换项目名/800 米并出分', async () => {
    await call('setSex', { currentTarget: { dataset: { v: 'f' } } });
    await call('setGr', { currentTarget: { dataset: { v: '34' } } });
    await page.setData({ form: { h: '165', w: '55', vc: '3050', r50: '8.2', sit: '19.5', jump: '182', pull: '47', durM: '3', durS: '42' } });
    await call('calc');
    await sleep(400);
    const d = await data();
    assert(d.res.total === 83, 'total=' + d.res.total);
    assert(d.res.rows.some((r) => r.n === '800 米跑' && r.sub === '分·秒'));
    assert(d.res.rows.some((r) => r.n === '1 分钟仰卧起坐'));
  });
  await check('体测：缺项按 0 计并提示', async () => {
    const f = Object.assign({}, maleForm, { vc: '' });
    await page.setData({ sex: 'm', grade: '12', form: f });
    await clearLogs();
    await call('calc');
    await sleep(400);
    const d = await data();
    assert(d.res.miss === 1 && d.res.wtDone === 85, JSON.stringify({ miss: d.res.miss, wtDone: d.res.wtDone }));
    assert((await toasts()).some((t) => t.indexOf('还有 1 项没填') >= 0));
  });
  await check('体测：0 秒/0 次等异常输入不应拿满分', async () => {
    const f = Object.assign({}, maleForm, { r50: '0', durM: '0', durS: '0' });
    await page.setData({ form: f });
    await call('calc');
    await sleep(400);
    const res = (await data()).res;
    const r50 = res.rows.find((r) => r.n === '50 米跑');
    const dur = res.rows.find((r) => r.n === '1000 米跑');
    if (r50.s === 100 || dur.s === 100) {
      finding('ft-zero-full', '体测对 0 秒等异常输入给满分', '50 米跑=0 秒、1000 米=0:00 时单项得 100 分；只做了数值比较，没有合理区间校验。', '中');
      throw new Error('0 值得到满分 r50=' + r50.s + ' dur=' + dur.s);
    }
  });
  await check('体测：清空输入与结果', async () => {
    await call('reset');
    await sleep(300);
    const d = await data();
    assert(d.state === 'empty' && !d.res);
    assert(Object.values(d.form).every((v) => v === ''));
  });
  await check('体测：导出图片走通', async () => {
    await page.setData({ sex: 'm', grade: '12', form: maleForm });
    await call('calc');
    await sleep(300);
    await clearLogs();
    await call('exportImg');
    await sleep(1200);
    const c = await canvasState();
    assert(c.canvas === 1 && c.saved === 1, JSON.stringify(c));
  });

  await check('体测：第一次打开历史记录就显示完整（不能是裸记录）', async () => {
    await resetAll();
    await mp.evaluate(() => {
      const s = require('utils/store.js');
      s.get().fitRecs = [{
        id: 'first-open', ts: Date.now(), sex: 'm', gr: '12',
        fields: { h: '175', w: '65', vc: '4300' }, total: 83, grade: '良好'
      }];
      s.save();
    });
    page = await nav('/pages/ft/ft');
    const d = await data();
    assert(d.hist.length === 1, 'hist=' + d.hist.length);
    assert(!!d.hist[0].when && !!d.hist[0].name, JSON.stringify(d.hist[0]));
    assert(d.hist[0].detail.indexOf('身高 175cm') >= 0, 'detail=' + d.hist[0].detail);
  });

  await check('体测：同数据补填项目合并为一条 / 最多两条 / 可改名', async () => {
    await resetAll();
    page = await nav('/pages/ft/ft');
    await page.setData({ sex: 'm', grade: '12', form: { h: '175', w: '65' } });
    await call('calc'); await call('saveRec'); await sleep(350);
    await page.setData({ form: { h: '175', w: '65', vc: '4300' } });
    await call('calc'); await call('saveRec'); await sleep(350);
    let d = await data();
    assert(d.hist.length === 1, '补填后 hist=' + d.hist.length);
    assert(d.hist[0].detail.indexOf('肺活量 4300mL') >= 0, '合并后 detail=' + d.hist[0].detail);

    await call('setHistoryName', 0, '期中体测');
    await sleep(250);
    d = await data();
    assert(d.hist[0].name === '期中体测', 'name=' + d.hist[0].name);

    await page.setData({ form: { h: '180', w: '70', vc: '4000' } });
    await call('calc'); await call('saveRec'); await sleep(300);
    await page.setData({ form: { h: '170', w: '60', vc: '3900' } });
    await call('calc'); await call('saveRec'); await sleep(300);
    d = await data();
    assert(d.hist.length === 2, '三条应只保留两条, hist=' + d.hist.length);
  });

  await check('体测：保存记录 / 历史 / 回填 / 删除', async () => {
    await resetAll();
    page = await nav('/pages/ft/ft');
    await page.setData({ sex: 'm', grade: '12', form: maleForm });
    await call('calc');
    await sleep(300);
    await call('saveRec');
    await sleep(400);
    let d = await data();
    assert(d.hist.length === 1, 'hist=' + d.hist.length);
    assert(d.hist[0].total === 83 && d.hist[0].totalText === '83.0');
    assert(d.hist[0].detail.indexOf('身高 175cm') >= 0, 'history detail=' + d.hist[0].detail);
    assert(d.hist[0].detail.indexOf('肺活量 4300mL') >= 0, 'history detail=' + d.hist[0].detail);
    await call('reset');
    await sleep(300);
    await call('restoreRec', { currentTarget: { dataset: { i: 0 } } });
    await sleep(400);
    d = await data();
    assert(d.res && d.res.total === 83, '回填后 total=' + (d.res && d.res.total));
    await call('delRec', { currentTarget: { dataset: { i: 0 } } });
    await sleep(300);
    assert((await data()).hist.length === 0);
  });
  await check('体测：登录后保存记录写入 public.fitrecs，删除走软删', async () => {
    await resetAll();
    await fx({ users: [{ id: 'tester', h: h('tester', 'pw123') }] });
    await loginAs('tester', 'pw123');
    page = await nav('/pages/ft/ft');
    await page.setData({ sex: 'm', grade: '12', form: maleForm });
    await call('calc');
    await sleep(250);
    await clearLogs();
    await call('saveRec');
    await sleep(600);
    assert((await reqs()).some((r) => r.method === 'POST' && r.url.indexOf('/fitrecs') >= 0), '未写 fitrecs');
    await clearLogs();
    await call('delRec', { currentTarget: { dataset: { i: 0 } } });
    await sleep(500);
    assert((await reqs()).some((r) => r.method === 'POST' && r.url.indexOf('/fitrecs') >= 0), '未软删 fitrecs');
  });

  await check('体测：国标评分表页面（男女/年级切换）', async () => {
    page = await mp.navigateTo('/pages/fttable/fttable');
    await page.waitFor(500);
    let d = await data();
    assert(d.rows.length === 6 && d.scores.length === 20, JSON.stringify({ rows: d.rows.length, scores: d.scores.length }));
    assert(d.rows.some((r) => r.n.indexOf('肺活量') >= 0));
    await call('setSex', { currentTarget: { dataset: { v: 'f' } } });
    await call('setGr', { currentTarget: { dataset: { v: '34' } } });
    await page.waitFor(300);
    d = await data();
    assert(d.rows.some((r) => r.n.indexOf('800 米跑') >= 0));
    assert(d.rows.some((r) => r.n.indexOf('仰卧起坐') >= 0));
  });

  /* ============================================================
     7. 我的 / 登录 / 同步
     ============================================================ */
  await resetAll();
  await fx({ users: [] });
  page = await nav('/pages/me/me');
  await shot('09-me-guest');
  await check('我的：未登录态与空账号守卫', async () => {
    const d = await data();
    assert(d.logged === false);
    await clearLogs();
    await call('doAuth');
    await sleep(200);
    assert((await toasts()).some((t) => t.indexOf('填写账号') >= 0));
  });
  await check('我的：账号不存在时提示登录失败', async () => {
    await page.setData({ accIn: 'nobody', pwIn: 'x' });
    await clearLogs();
    await call('doAuth');
    await sleep(900);
    const m = await modals();
    assert(m.some((x) => x.content.indexOf('账号或密码错误') >= 0), JSON.stringify(m));
  });
  await check('我的：密码错误时提示登录失败', async () => {
    await fx({ users: [{ id: 'tester', h: h('tester', 'right') }] });
    await page.setData({ accIn: 'tester', pwIn: 'wrong' });
    await clearLogs();
    await call('doAuth');
    await sleep(900);
    assert((await modals()).some((x) => x.content.indexOf('账号或密码错误') >= 0));
  });
  await check('我的：注册两遍密码不一致被拦截', async () => {
    await page.setData({ mode: 'reg', accIn: 'newbie', pwIn: 'a', pw2In: 'b' });
    await clearLogs();
    await call('doAuth');
    await sleep(500);
    assert((await modals()).some((x) => x.content.indexOf('两次密码不一致') >= 0), JSON.stringify(await modals()));
  });
  await check('我的：注册成功 → 登录态/会话/分账号桶', async () => {
    await fx({ users: [] });
    await page.setData({ mode: 'reg', accIn: 'tester', pwIn: 'pw123', pw2In: 'pw123' });
    await clearLogs();
    await call('doAuth');
    await sleep(1200);
    const d = await data();
    assert(d.logged === true, JSON.stringify(await modals()));
    assert(d.acc === 'tester');
    const sess = await evalIn(() => require('utils/cloud.js').sessionGet());
    assert(sess && sess.acc === 'tester');
    const hasBucket = await evalIn(() => !!wx.getStorageSync('zq_tools_v2_tester'));
    assert(hasBucket === true, '没有分账号桶');
  });
  await check('班级身份：未认证时读不到名单，姓名+学号认证后解锁', async () => {
    await fx({
      users: [],
      identity: [],
      roster: [{ id: 'main', data: JSON.stringify({ roster: '1 甲\n2 乙' }) }]
    });
    let d = await data();
    assert(d.logged === true && d.verified === false, JSON.stringify({ logged: d.logged, verified: d.verified }));
    let ok = await evalIn(() => require('utils/cloud.js').rosterPull());
    assert(ok === false, '未认证却读到了名单');

    await call('onVName', { detail: { value: '李学盈' } });
    await call('onVSid', { detail: { value: '9999000001' } });
    await clearLogs();
    await call('doVerify');
    await sleep(700);
    d = await data();
    assert(d.verified === true, JSON.stringify({ verified: d.verified, err: d.verifyErr, toasts: await toasts() }));
    ok = await evalIn(() => require('utils/cloud.js').rosterPull());
    assert(ok === true, '认证后仍读不到名单');
    assert((await evalIn(() => require('utils/store.js').get().classRoster)).indexOf('甲') >= 0);
  });

  await check('我的：立即同步走通（无冲突）', async () => {
    // 用本机当前 blob，避免制造冲突
    const blob = await evalIn(() => require('utils/cloud.js').udBlob());
    await fx({ userdata: [{ id: 'tester', blob }] });
    await clearLogs();
    await call('sync', true);
    await sleep(900);
    assert((await toasts()).some((t) => t.indexOf('已同步') >= 0), JSON.stringify(await toasts()));
  });
  await check('我的：云端/本机不一致时弹二选一并按选择生效', async () => {
    await fx({ userdata: [{ id: 'tester', blob: JSON.stringify({ v: 2, roster: '9 云端同学', fit: { sex: 'f' } }) }] });
    await clearLogs();
    await call('sync', true);
    await sleep(900);
    assert((await modals()).some((x) => x.title.indexOf('数据不一致') >= 0), JSON.stringify(await modals()));
    await sleep(300);
    const st = await evalIn(() => require('utils/store.js').get());
    assert(st.fit && st.fit.sex === 'f', 'fit=' + JSON.stringify(st.fit));
    assert(st.roster === '', 'roster 应由 public.roster 管理，不被 userdata 覆盖');
  });
  await check('我的：昵称自动使用账号名', async () => {
    const nick = await evalIn(() => require('utils/store.js').get().nick);
    assert(nick === 'tester', 'nick=' + nick);
    const d = await data();
    assert(d.nickText === 'tester', 'nickText=' + d.nickText);
  });
  await check('我的：退出登录回到游客桶', async () => {
    await call('doLogout');
    await sleep(600);
    const d = await data();
    assert(d.logged === false, JSON.stringify(d));
    const sess = await evalIn(() => require('utils/cloud.js').sessionGet());
    assert(!sess);
  });
  await check('我的：清空本机数据', async () => {
    await call('clearData');
    await sleep(500);
    const st = await evalIn(() => require('utils/store.js').get());
    eq(st.course, []);
    eq(st.homework, []);
    const f = await evalIn(() => require('utils/flow.js').getFlow());
    assert(!f.draw && !f.group);
  });

  /* ============================================================
     8. 工具页 / 使用说明 / 反馈
     ============================================================ */
  await resetAll();
  page = await nav('/pages/all/all');
  await shot('10-all');
  await check('工具页：4 个工具 + 反馈 + 使用说明，课表入口隐藏', async () => {
    const d = await data();
    eq(d.cards.map((c) => c.key), ['hw', 'nt', 'ft', 'draw', 'roll', 'fb', 'ug']);
  });
  await check('工具页：上移/下移改变首页顺序并持久化', async () => {
    await call('up', { currentTarget: { dataset: { key: 'ft' } } });
    await sleep(200);
    let home = await evalIn(() => require('utils/tools.js').homeTools());
    eq(home, ['hw', 'ft', 'nt', 'draw', 'roll']);
    await call('down', { currentTarget: { dataset: { key: 'ft' } } });
    await sleep(200);
    home = await evalIn(() => require('utils/tools.js').homeTools());
    eq(home, ['hw', 'nt', 'ft', 'draw', 'roll']);
  });
  await check('使用说明：19 张卡片正常渲染（swiper + 分类 + 总览，不含开发者说明）', async () => {
    // 使用说明页有身份守卫（identity.ensure），先写官方测试身份再进页（不使用任何真实账号）
    await evalIn(() => {
      wx.setStorageSync('zq_class_identity', JSON.stringify({
        token: 'e2e-ug-token', sid: '3260799999', name: '测试账号',
        role: '', badge: '', is_admin: false, ts: Date.now()
      }));
    });
    page = await nav('/pages/ug/ug');
    const d = await data();
    eq(d.cards.length, 19);
    eq(d.cats.map((x) => x.key), ['start', 'study', 'life', 'team', 'more']);
    eq(d.ovGroups.length, 5);
    eq(d.cur, 0);
    eq(d.ov, false);
    includes(d.cards.map((x) => x.title).join(''), '抽签');
    includes(d.cards.map((x) => x.title).join(''), '点名');
    assert(!/统计|utils\/|cloud-config/.test(d.cards.map((x) => x.title + x.sub + x.steps.join('') + x.tip).join('')), '使用说明不应出现开发者/统计说明');
    await shot('11-ug');
  });
  await check('使用说明：下一张 / 分类跳转 / 总览跳卡（首尾不循环）', async () => {
    await call('next');
    await sleep(320);
    let d = await data();
    assert(d.cur === 1, 'next 后 cur=' + d.cur);
    await call('jumpCat', { currentTarget: { dataset: { cat: 'life' } } });
    await sleep(320);
    d = await data();
    assert(d.cur === 10 && d.cards[10].id === 'power', '「生活」首卡 cur=' + d.cur + ' id=' + (d.cards[d.cur] && d.cards[d.cur].id));
    await call('jumpTo', { currentTarget: { dataset: { idx: 15 } } });
    await sleep(320);
    d = await data();
    assert(d.cur === 15 && d.ov === false, '总览跳卡 cur=' + d.cur + ' ov=' + d.ov);
    await call('openOv');
    await sleep(150);
    assert((await data()).ov === true, '总览未打开');
    await shot('11b-ug-overview');
    await call('closeOv');
    await sleep(120);
    assert((await data()).ov === false, '总览未关闭');
    await call('jumpTo', { currentTarget: { dataset: { idx: 18 } } });
    await sleep(200);
    await call('next');
    await sleep(200);
    d = await data();
    assert(d.cur === 18, '末张 next 应 clamp 在 18，实际 ' + d.cur);
  });
  await check('点名：名单/到假/沉底/重置（本机）', async () => {
    await resetAll();
    page = await nav('/pages/roll/roll');
    await call('onNames', { detail: { value: '1 甲\n2 乙\n3 丙' } });
    await sleep(300);
    let d = await data();
    assert(d.list.length === 3 && d.sum.un === 3, JSON.stringify(d.sum));
    await call('toggle', { currentTarget: { dataset: { i: 0, v: 'in' } } });
    await sleep(250);
    d = await data();
    assert(d.sum.inN === 1 && d.sum.un === 2);
    assert(d.list[d.list.length - 1].s === 'in', '已处理应沉底');
    await call('reset');
    await sleep(300);
    d = await data();
    assert(d.sum.inN === 0 && d.sum.un === 3);
  });
  await check('统计：仅管理员可见，能渲染 24 小时/7 天', async () => {
    await resetAll();
    const now = new Date(); const pad = (n) => String(n).padStart(2, '0');
    const slot = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + '-' + pad(now.getHours());
    await fx({ users: [{ id: 'admin', h: h('admin', 'pw123') }], visits: [{ slot: slot, did: 'd1' }, { slot: slot, did: 'd2' }] });
    await loginAs('admin', 'pw123');
    page = await nav('/pages/stats/stats');
    await sleep(600);
    let d = await data();
    assert(d.state === 'data' && d.bars.length === 24, JSON.stringify({ state: d.state, bars: d.bars.length }));
    assert(d.sum === 2, 'sum=' + d.sum);
    await call('setRange', { currentTarget: { dataset: { v: 'week' } } });
    await sleep(300);
    d = await data();
    assert(d.bars.length === 7, 'week bars=' + d.bars.length);
  });
  await check('反馈：游客空内容守卫 + 提交成功清空', async () => {
    await resetAll();
    await fx({});
    page = await nav('/pages/fb/fb');
    let d = await data();
    assert(d.showList === false);
    await clearLogs();
    await call('submit');
    assert((await toasts()).some((t) => t.indexOf('写点反馈内容') >= 0));
    await page.setData({ text: '有个建议' });
    await clearLogs();
    await call('submit');
    await sleep(700);
    assert((await toasts()).some((t) => t.indexOf('已提交') >= 0), JSON.stringify(await toasts()));
    d = await data();
    assert(d.text === '');
    assert((await reqs()).some((r) => r.method === 'POST' && r.url.indexOf('/feedback') >= 0));
  });
  await check('反馈：登录用户可看“我的反馈”，管理员可看全部并标记', async () => {
    await resetAll();
    await fx({ feedback: [
      { id: 'f1', content: 'A', acc: 'tester', done: false, ts: 1 },
      { id: 'f2', content: 'B', acc: 'other', done: false, ts: 2 }
    ] });
    await loginAs('tester', 'pw123');
    page = await nav('/pages/fb/fb');
    await sleep(600);
    let d = await data();
    assert(d.logged === true && d.canManage === false);
    assert(d.list.length === 1 && d.list[0].id === 'f1', JSON.stringify(d.list));
    await resetAll();
    await fx({ feedback: [
      { id: 'f1', content: 'A', acc: 'tester', done: false, ts: 1 },
      { id: 'f2', content: 'B', acc: 'other', done: false, ts: 2 }
    ] });
    await loginAs('admin', 'pw123');
    page = await nav('/pages/fb/fb');
    await sleep(600);
    d = await data();
    assert(d.canManage === true);
    assert(d.list.length === 2);
    await clearLogs();
    await call('markDone', { currentTarget: { dataset: { id: 'f1' } } });
    await sleep(600);
    assert((await toasts()).some((t) => t.indexOf('已标记') >= 0), JSON.stringify(await toasts()));
    await shot('12-fb-admin');
  });

  /* ============================================================
     9. 课表（入口隐藏，页面仍可用）
     ============================================================ */
  await resetAll();
  page = await nav('/pages/tt/tt');
  await check('课表：游客只读，添加课程被权限拦截', async () => {
    const d = await data();
    assert(d.canManage === false);
    await clearLogs();
    await page.setData({ form: { name: '测试课', teacher: '', room: '', day: '周一', start: 1, end: 1, weeks: '1-16', parity: 'all' } });
    await call('addCourse');
    await sleep(200);
    assert((await toasts()).some((t) => t.indexOf('仅管理员') >= 0));
    assert((await evalIn(() => require('utils/store.js').get().course.length)) === 0);
    const hasBar = await page.$('.actionbar');
    if (hasBar) finding('tt-guest-buttons', '游客进入课表页仍看到「添加课程/清空课表」操作条', '入口虽隐藏，但直接打开页面时 actionbar 只按 readOnly 隐藏，未按 canManage 隐藏；点击才提示“仅管理员”。', '低');
  });
  await check('课表：管理员添加课程、列表/网格渲染、删除', async () => {
    await resetAll();
    await fx({ users: [{ id: 'admin', h: h('admin', 'pw123') }] });
    page = await nav('/pages/me/me');
    await page.setData({ accIn: 'admin', pwIn: 'pw123' });
    await call('doAuth');
    await sleep(900);
    page = await nav('/pages/tt/tt');
    let d = await data();
    assert(d.canManage === true, 'canManage=false, acc=' + d.acc + ' toasts=' + JSON.stringify(await toasts()));
    await page.setData({ form: { name: '高数', teacher: '龚老师', room: 'A301', day: '周一', start: 1, end: 2, weeks: '1-16', parity: 'all' } });
    await call('addCourse');
    await sleep(500);
    d = await data();
    assert(d.list.length === 1 && d.list[0].name === '高数', 'list=' + JSON.stringify(d.list) + ' toasts=' + JSON.stringify(await toasts()));
    assert(d.rows[0].cells[0].items.length === 1);
    await call('removeAt', 0);
    await sleep(500);
    assert((await data()).list.length === 0);
  });
  await check('课表：跨节次课程应在网格中跨行显示（当前只出现在起始节）', async () => {
    await seed({ course: [{ name: '跨节课', teacher: '', room: '', day: 0, start: 1, end: 3, weeks: '1-16', parity: 'all' }] });
    page = await nav('/pages/tt/tt');
    const d = await data();
    assert(d.rows[0].cells[0].items.length === 1);
    const p2 = d.rows[1].cells[0].items.length;
    const p3 = d.rows[2].cells[0].items.length;
    if (p2 === 0 || p3 === 0) {
      finding('tt-span', '课表跨节次课程不跨行，只显示在起始节', 'tt.wxml 用固定高度行 + 仅 c.start===p 时输出课程块，没有 rowspan/绝对定位；第 2-3 节格子为空，视觉上像只上 1 节。', '中');
      throw new Error('第 2/3 节格子为空：' + JSON.stringify([p2, p3]));
    }
  });
  await check('课表：周次/单双周过滤与“全部周”切换', async () => {
    await seed({ termStart: '2026-09-07', course: [
      { name: '只在第 1 周', teacher: '', room: '', day: 0, start: 1, end: 1, weeks: '1', parity: 'all' },
      { name: '每周都有', teacher: '', room: '', day: 0, start: 2, end: 2, weeks: '1-18', parity: 'all' }
    ] });
    page = await nav('/pages/tt/tt');
    let d = await data();
    assert(d.list.length === 1 && d.list[0].name === '每周都有', '本周列表=' + JSON.stringify(d.list.map((x) => x.name)));
    await call('setScope', { currentTarget: { dataset: { v: 'all' } } });
    await sleep(300);
    d = await data();
    assert(d.list.length === 2, '全部周列表=' + d.list.length);
  });
  await check('课表：只读分享链接可打开且无编辑入口', async () => {
    await resetAll();
    const json = JSON.stringify({ c: [{ name: '分享课', teacher: 'T', room: 'R', day: 1, start: 1, end: 2, weeks: '1-16', parity: 'all' }], t: '2026-09-07' });
    const url = '/pages/tt/tt?tt=' + encodeURIComponent(json);
    page = await mp.navigateTo(url);
    await sleep(600);
    const d = await data();
    assert(d.readOnly === true && d.canManage === false);
    assert(d.list.length === 1 && d.list[0].name === '分享课');
    const bars = await page.$('.actionbar');
    if (bars) {
      finding('tt-share-editbar', '只读分享页仍渲染底部操作条', 'actionbar wx:if 只判断 !readOnly，分享页 readOnly=true 时应该隐藏；实际仍渲染（需结合截图确认）。', '低');
      throw new Error('actionbar 仍存在');
    }
  });
  await check('课表：导出图片走通', async () => {
    await resetAll();
    await seed({ termStart: '2026-09-07', course: [{ name: '高数', teacher: '', room: 'A301', day: 0, start: 1, end: 2, weeks: '1-16', parity: 'all' }] });
    page = await nav('/pages/tt/tt');
    await clearLogs();
    await call('exportImg');
    await sleep(1200);
    const c = await canvasState();
    assert(c.canvas === 1 && c.saved === 1, JSON.stringify(c));
  });

  await check('布局：带固定操作条的页面底部留白足够，不遮挡按钮', async () => {
    for (const p of ['/pages/draw/draw', '/pages/group/group', '/pages/hw/hw', '/pages/nt/nt', '/pages/ft/ft', '/pages/sum/sum']) {
      page = await nav(p);
      await page.waitFor(300);
      const root = await page.$('.page');
      const bar = await page.$('.actionbar');
      assert(root && bar, p + ' 缺少 .page/.actionbar');
      const pad = parseFloat(await root.style('padding-bottom')) || 0;
      const h = (await bar.size()).height || 0;
      assert(pad >= h + 2, p + ' padding=' + pad + ' bar=' + h);
    }
  });

  /* ============================================================
     10. 云端/异常收尾
     ============================================================ */
  await check('异常：全流程无未捕获异常', async () => {
    if (exceptions.length) {
      finding('runtime-exceptions', '运行期出现未捕获异常', JSON.stringify(exceptions.slice(0, 3)).slice(0, 500), '高');
      throw new Error('exceptions=' + exceptions.length);
    }
  });
  await check('异常：无控制台 error/warning（wx:key 重复等）', async () => {
    const bad = consoleIssues.filter((x) => x.type === 'error');
    if (bad.length) throw new Error(JSON.stringify(bad.slice(0, 3)));
    const warns = consoleIssues.filter((x) => /duplicate|wx:key|key/i.test(x.text));
    if (warns.length) {
      finding('wx-key-dup', '列表 wx:key 重复导致控制台告警', JSON.stringify(warns.slice(0, 3)).slice(0, 400), '低');
      throw new Error('wx:key warnings=' + warns.length);
    }
  });

  const summary = { total: passN + failN, pass: passN, fail: failN, results, findings, exceptions: exceptions.length, consoleIssues: consoleIssues.slice(0, 30), at: new Date().toISOString() };
  fs.writeFileSync(path.join(OUT, 'e2e-result.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log('\n================ ' + passN + ' passed, ' + failN + ' failed, ' + findings.length + ' findings ================');
  findings.forEach((f) => console.log(' - [' + f.severity + '] ' + f.title));
  await mp.disconnect();
  process.exitCode = failN ? 2 : 0;
})().catch(async (e) => {
  console.error('FATAL', e && e.stack || e);
  try { fs.writeFileSync(path.join(OUT, 'e2e-result.json'), JSON.stringify({ fatal: String(e && e.stack || e), results, findings }, null, 2), 'utf8'); } catch (_) {}
  process.exit(1);
});
