/* committee_unit_tests.js —— 名单页三分类（班委 / 团员 / 全班）+ 管理 RPC 单测
 *
 * 运行方式：
 *   node committee_unit_tests.js   # 独立运行（自带 wx mock），结果写 committee_result.json
 *   node unit.js                   # unit.js 末尾 require 本文件 run(test)，并入总表
 *
 * 覆盖（与网页版「名单」工具同口径，web/AGENTS.md §33）：
 *   1) utils/roster.js listView：班委只取 role/badge、按职务权重排序；管理员管理态显示全班；
 *   2) 团员分类：league 缓存 ∩ 班级名单、显示团员标记、计数与空态/加载态文案；
 *   3) 全班分类：按座号升序、仅姓名与座号提示；
 *   4) utils/cloud.js classSetRole：管理员 + p_sid/p_role/p_badge 契约、非管理员/失败原因拒绝。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');
const ROOT_N = ROOT.replace(/\\/g, '/');

const MEMBERS = [
  { seat: 3, sid: 'sid-3', name: '张三', role: '班长', badge: '班委', is_admin: false },
  { seat: 5, sid: 'sid-5', name: '李四', role: '', badge: '', is_admin: false },
  { seat: 7, sid: 'sid-7', name: '王五', role: '学习委员', badge: '班委', is_admin: false },
  { seat: 2, sid: 'sid-2', name: '赵六', role: '', badge: '班委', is_admin: false }
];

function createCtx() {
  const mem = Object.create(null);
  let reqLog = [];
  let toastLog = [];
  let reqImpl = function (o) { o.success({ statusCode: 200, data: [] }); };
  const wxMock = {
    getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
    setStorageSync(k, v) { mem[k] = v; },
    removeStorageSync(k) { delete mem[k]; },
    getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 0, limitSize: 10240 }; },
    request(o) { reqLog.push(o); reqImpl(o); },
    showToast(o) { toastLog.push(o && o.title); },
    showModal(o) { if (o && o.success) o.success({ confirm: true, cancel: false, content: '' }); },
    showShareMenu() {}, stopPullDownRefresh() {}, switchTab() {}, reLaunch() {}, navigateTo() {},
    getWindowInfo() { return { windowWidth: 375 }; },
    getSystemInfoSync() { return { windowWidth: 375, SDKVersion: '3.0.0' }; },
    getAppBaseInfo() { return { SDKVersion: '3.0.0' }; },
    nextTick(fn) { if (fn) fn(); }
  };
  return {
    mem: mem,
    wxMock: wxMock,
    clearMem() { Object.keys(mem).forEach(function (k) { delete mem[k]; }); reqLog = []; toastLog = []; reqImpl = function (o) { o.success({ statusCode: 200, data: [] }); }; },
    setReq(fn) { reqImpl = fn; },
    reqLog() { return reqLog; },
    toastLog() { return toastLog; },
    urlsOf(frag) { return reqLog.filter(function (o) { return String((o && o.url) || '').indexOf(frag) >= 0; }); }
  };
}

function purge() {
  Object.keys(require.cache).forEach(function (k) {
    if (k.replace(/\\/g, '/').indexOf(ROOT_N) !== 0) return;
    try {
      const m = require.cache[k];
      if (m && m.exports && typeof m.exports.udStop === 'function') m.exports.udStop();
    } catch (e) { /* ignore */ }
    delete require.cache[k];
  });
}
function R(rel) { return require(path.join(ROOT, rel)); }

// 加载页面定义（Page 被调用即捕获配置对象，不执行生命周期）
function loadPage(rel) {
  let def = null;
  global.Page = function (d) { def = d; };
  try { require(path.join(ROOT, rel)); } finally { delete global.Page; }
  assert.ok(def, rel + ' 未注册 Page');
  return def;
}
// 最小页面实例：data 深拷贝 + setData 浅合并（回调同步触发）
function makePage(def) {
  const inst = { data: JSON.parse(JSON.stringify(def.data || {})) };
  Object.keys(def).forEach(function (k) {
    if (typeof def[k] === 'function') inst[k] = def[k];
  });
  inst.setData = function (patch, cb) {
    Object.keys(patch || {}).forEach(function (k) { inst.data[k] = patch[k]; });
    if (typeof cb === 'function') cb();
  };
  return inst;
}

module.exports.run = async function (test) {
  test('名单：班委分类只显示 role/badge 且按职务权重排序', function () {
    purge();
    global.wx = createCtx().wxMock;
    const roster = R('utils/roster.js');
    const v = roster.listView('committee', { members: MEMBERS });
    assert.deepStrictEqual(v.rows.map(function (r) { return r.name; }), ['张三', '王五', '赵六'],
      '班长 → 学习委员 → 仅 badge，座号升序兜底');
    assert.strictEqual(v.counts.committee, 3, '班委计数=role/badge 非空');
    assert.strictEqual(v.counts.all, 4, '全班计数');
    assert.ok(v.note.indexOf('管理') >= 0, '班委分类提示管理入口');
    assert.strictEqual(v.emptyText, '暂无班委身份信息');
  });

  test('名单：管理员管理态显示全班（可设置/清除职务）', function () {
    const roster = R('utils/roster.js');
    const v = roster.listView('committee', { members: MEMBERS, edit: true });
    assert.strictEqual(v.rows.length, 4, '管理态列出全班');
    assert.deepStrictEqual(v.rows.map(function (r) { return r.seat; }), [3, 7, 2, 5], '仍按职务权重 + 座号排序');
  });

  test('名单：团员分类合并班级名单角色并显示团员标记', function () {
    const roster = R('utils/roster.js');
    const league = [{ seat: 5, name: '李四' }, { seat: 7, name: '王五' }, { seat: 9, name: '外部队员' }];
    const v = roster.listView('league', { members: MEMBERS, league: league, leagueLoaded: true });
    assert.strictEqual(v.rows.length, 3, '团员行数');
    assert.deepStrictEqual(v.rows.map(function (r) { return r.seat; }), [5, 7, 9], '座号升序');
    assert.ok(v.rows.every(function (r) { return r.showLeague === true; }), '每行显示团员标记');
    assert.strictEqual(v.rows[1].role, '学习委员', '按座号合并班级名单里的职务');
    assert.strictEqual(v.counts.league, 3);
    assert.strictEqual(v.counts.leagueText, '3', 'tab 上显示团员计数');
    assert.ok(v.note.indexOf('团员') >= 0 && v.note.indexOf('班级团员库') >= 0, '来源说明');
  });

  test('名单：团员未加载时显示加载态（计数占位）', function () {
    const roster = R('utils/roster.js');
    const v = roster.listView('league', { members: MEMBERS, leagueLoaded: false });
    assert.strictEqual(v.rows.length, 0);
    assert.strictEqual(v.emptyText, '团员名单加载中…');
    // 2026-11-19 用户反馈「团员名单在未打开时不显示数字」：未加载时也必须是数字（0），
    // 页面用 countsLoading.league 画脉冲占位，加载完成后变真实人数。
    assert.strictEqual(v.counts.leagueText, '0', '未加载时 tab 上仍显示数字 0（不再留空）');
    assert.strictEqual(v.counts.league, 0);
    assert.strictEqual(v.counts.loading.league, true, '未加载时标记 loading（画脉冲占位）');
    assert.strictEqual(v.counts.loading.committee, false, '班委/全班本就来自班级名单，不占位');
    assert.strictEqual(v.counts.loading.all, false);
    assert.strictEqual(roster.listView('all', { members: MEMBERS, leagueLoaded: true }).counts.loading.league, false,
      '加载完成后取消占位');
  });

  test('名单：全班分类按座号升序且仅姓名与座号', function () {
    const roster = R('utils/roster.js');
    const v = roster.listView('all', { members: MEMBERS });
    assert.deepStrictEqual(v.rows.map(function (r) { return r.seat; }), [2, 3, 5, 7]);
    assert.ok(v.note.indexOf('全班 4 人') >= 0 && v.note.indexOf('姓名与座号') >= 0);
    assert.strictEqual(v.emptyText, '暂无名单');
  });

  await test('名单搜索只在提交后请求座号，旧查询不能覆盖新输入', async function () {
    purge();
    const C = createCtx(); global.wx = C.wxMock;
    const cloud = R('utils/cloud.js'), identity = R('utils/identity.js');
    identity.save({ sid: '3260799999', name: '测试账号', token: 'roster-test' });
    cloud.configure({ enabled: true, restBase: 'https://rest.test/v1/rdb/rest/', publishableKey: 'pk-test' });
    let respond, component;
    C.setReq(function (o) { respond = () => o.success({ statusCode: 200, data: [2, 2, 0, '3'] }); });
    global.Component = def => { component = def; };
    try { R('components/roster-search/index.js'); } finally { delete global.Component; }
    const events = [], ctx = Object.assign({}, component.methods, { data: { query: '' },
      triggerEvent(_, data) { this.data.query = data.value; events.push(data); } });
    ctx.input({ detail: { value: 'Night' } });
    assert.strictEqual(C.reqLog().length, 0);
    const stale = ctx.search({ detail: {} });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepStrictEqual(C.reqLog()[0].data, { p_query: 'Night' });
    ctx.input({ detail: { value: 'Night Owl' } });
    respond(); await stale;
    assert.deepStrictEqual(events[events.length - 1], { value: 'Night Owl', seats: [] });
    const exact = ctx.search({ detail: {} });
    await new Promise(resolve => setTimeout(resolve, 0));
    respond(); await exact;
    assert.deepStrictEqual(events[events.length - 1], { value: 'Night Owl', seats: [2] });
    ctx.clear();
    assert.deepStrictEqual(events[events.length - 1], { value: '', seats: [] });
  });

  test('名单：classSetRole 管理员契约（p_sid/p_role/p_badge + 身份 token）', async function () {
    purge();
    const C = createCtx();
    global.wx = C.wxMock;
    C.setReq(function (o) {
      if (String(o.url || '').indexOf('/rpc/class_set_role') >= 0) {
        return o.success({ statusCode: 200, data: { ok: true } });
      }
      return o.success({ statusCode: 200, data: [] });
    });
    const cloud = R('utils/cloud.js');
    const identity = R('utils/identity.js');
    identity.save({ sid: 'sid-admin', name: '管理员', token: 'tok-admin', is_admin: true });
    cloud.configure({ enabled: true, restBase: 'https://rest.test/v1/rdb/rest/', publishableKey: 'pk-test' });
    const ok = await cloud.classSetRole('sid-3', ' 班长 ');
    assert.strictEqual(ok, true);
    const calls = C.urlsOf('/rpc/class_set_role');
    assert.strictEqual(calls.length, 1, '只发一次 RPC');
    const body = calls[0].data || {};
    assert.strictEqual(body.p_sid, 'sid-3');
    assert.strictEqual(body.p_role, '班长', '职务去首尾空格');
    assert.strictEqual(body.p_badge, '班委', '有职务时 badge=班委');
    assert.strictEqual((calls[0].header || {})['X-Class-Token'], 'tok-admin', '携带身份 token');
  });

  test('名单：classSetRole 清空职务时 badge 为空', async function () {
    purge();
    const C = createCtx();
    global.wx = C.wxMock;
    C.setReq(function (o) { o.success({ statusCode: 200, data: { ok: true } }); });
    const cloud = R('utils/cloud.js');
    const identity = R('utils/identity.js');
    identity.save({ sid: 'sid-admin', name: '管理员', token: 'tok-admin', is_admin: true });
    cloud.configure({ enabled: true, restBase: 'https://rest.test/v1/rdb/rest/', publishableKey: 'pk-test' });
    await cloud.classSetRole('sid-3', '');
    const body = C.urlsOf('/rpc/class_set_role')[0].data;
    assert.strictEqual(body.p_role, '');
    assert.strictEqual(body.p_badge, '', '清空职务时 badge 一并清空');
  });

  await test('名单：classSetRole 非管理员 / 缺 sid / 云端拒绝均报错', async function () {
    purge();
    const C = createCtx();
    global.wx = C.wxMock;
    const cloud = R('utils/cloud.js');
    const identity = R('utils/identity.js');
    cloud.configure({ enabled: true, restBase: 'https://rest.test/v1/rdb/rest/', publishableKey: 'pk-test' });

    identity.save({ sid: 'sid-user', name: '普通成员', token: 'tok-user', is_admin: false });
    await assert.rejects(cloud.classSetRole('sid-3', '班长'), /admin-only/, '非管理员拒绝');

    identity.save({ sid: 'sid-admin', name: '管理员', token: 'tok-admin', is_admin: true });
    await assert.rejects(cloud.classSetRole('', '班长'), /missing-sid/, '缺 sid 拒绝');

    C.setReq(function (o) { o.success({ statusCode: 200, data: { ok: false, reason: 'not-admin' } }); });
    global.wx = C.wxMock;
    let err2 = null;
    try { await cloud.classSetRole('sid-3', '班长'); } catch (e) { err2 = e; }
    assert.ok(err2 && /not-admin/.test(String((err2 && err2.message) || err2)),
      '云端拒绝原因透传（实际：' + ((err2 && err2.message) || err2) + '）');
  });

  test('名单：左右滑动切分类的纯逻辑（邻接 / 边界 / 指示条几何）', function () {
    const roster = R('utils/roster.js');
    assert.deepStrictEqual(roster.TAB_KEYS, ['committee', 'league', 'all'], '分类顺序 = 班委 → 团员 → 全班');
    assert.strictEqual(roster.tabIndex('league'), 1);
    assert.strictEqual(roster.tabIndex('nope'), 0, '未知分类回落首个');
    assert.strictEqual(roster.tabKeyOf(2), 'all');
    assert.strictEqual(roster.tabKeyOf(-5), 'committee', '越界钳制');
    // dir>0 = 左滑看下一个
    assert.strictEqual(roster.tabNeighbor('committee', 1).key, 'league');
    assert.strictEqual(roster.tabNeighbor('league', 1).key, 'all');
    assert.strictEqual(roster.tabNeighbor('league', -1).key, 'committee');
    assert.strictEqual(roster.tabNeighbor('committee', -1), null, '首个分类左滑无目标（橡皮筋）');
    assert.strictEqual(roster.tabNeighbor('all', 1), null, '最后一个分类右滑无目标（橡皮筋）');
    // 指示条：3 段等宽 + 间距，位置单调递增且首段贴左
    const a = roster.tabIndicator('committee'), b = roster.tabIndicator('league'), c = roster.tabIndicator('all');
    assert.strictEqual(a.left, '0.000%');
    assert.strictEqual(a.width, b.width);
    assert.ok(parseFloat(b.left) > parseFloat(a.left) && parseFloat(c.left) > parseFloat(b.left), '位置单调递增');
    assert.ok(parseFloat(c.left) + parseFloat(c.width) <= 100.001, '最后一段不溢出容器');
  });

  await test('名单页：滑动手势接线（横向锁定 / 提交切换 / 边界回弹 / 滑动后吞点击）', async function () {
    purge();
    const C = createCtx();
    global.wx = C.wxMock;
    const identity = R('utils/identity.js');
    identity.save({ sid: 'sid-x', name: '测试账号', token: 'tok-x', is_admin: false });
    const def = loadPage('pages/committee/committee.js');
    const ctx = makePage(def);
    def.onLoad.call(ctx, {});
    ctx.data.state = 'data';
    ctx.data.list = [{ key: 'a' }];
    ctx.data.tab = 'committee';

    const T = (x, y) => ({ touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] });
    // 纵向手势：不应产生跟手位移
    def.onSwipeStart.call(ctx, T(200, 300));
    def.onSwipeMove.call(ctx, T(206, 360));
    assert.strictEqual(ctx.data.swipeStyle, '', '纵向手势交给页面滚动');
    def.onSwipeEnd.call(ctx, T(206, 360));

    // 横向跟手 1:1
    def.onSwipeStart.call(ctx, T(200, 300));
    def.onSwipeMove.call(ctx, T(140, 305));
    assert.ok(/translateX\(-60px\)/.test(ctx.data.swipeStyle), '左滑 1:1 跟手：' + ctx.data.swipeStyle);
    // 未过阈值 56px：回弹
    def.onSwipeEnd.call(ctx, T(160, 305));   // dx=-40
    assert.ok(/translateX\(0\);opacity:1;transition:transform \.2s/.test(ctx.data.swipeStyle), '未过阈值应回弹');

    // 过阈值：提交切到团员 → 旧内容先飞出
    ctx.data.swipeStyle = '';
    def.onSwipeStart.call(ctx, T(200, 300));
    def.onSwipeMove.call(ctx, T(120, 302));
    def.onSwipeEnd.call(ctx, T(120, 302));   // dx=-80
    assert.strictEqual(def._tapBlocked.call(ctx), true, '真正滑动后 320ms 内吞掉点击（防误触管理/行点按）');
    assert.ok(/translateX\(-187\.5px\);opacity:\.25;transition:transform \.16s ease/.test(ctx.data.swipeStyle),
      '旧内容先飞出：' + ctx.data.swipeStyle);
    await new Promise((r) => setTimeout(r, 260));
    assert.strictEqual(ctx.data.tab, 'league', '150ms 后切到团员分类');
    assert.ok(/translateX\(187\.5px\);opacity:0;transition:none/.test(ctx.data.swipeStyle) ||
      /translateX\(0\);opacity:1;transition:transform \.23s/.test(ctx.data.swipeStyle),
      '新内容从右侧进场：' + ctx.data.swipeStyle);
    await new Promise((r) => setTimeout(r, 320));
    assert.strictEqual(ctx.data.swipeStyle, '', '动画结束清空内联样式');

    // 边界：班委第一个分类左→右滑 = 阻尼 0.28 且不切
    ctx.data.tab = 'committee';
    def.onSwipeStart.call(ctx, T(120, 300));
    def.onSwipeMove.call(ctx, T(200, 300));
    assert.ok(/translateX\(22px\)/.test(ctx.data.swipeStyle), '边界 0.28 阻尼（80×0.28≈22）：' + ctx.data.swipeStyle);
    def.onSwipeEnd.call(ctx, T(200, 300));
    assert.strictEqual(ctx.data.tab, 'committee', '边界不切分类');
    def._swClear.call(ctx);
  });
};

/* 独立运行：node committee_unit_tests.js */
if (require.main === module) {
  let passN = 0, failN = 0;
  const results = [];
  const test = async function (name, fn) {
    try { await fn(); passN++; results.push({ name: name, ok: true }); console.log('PASS  ' + name); }
    catch (e) { failN++; results.push({ name: name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
  };
  module.exports.run(test).then(function () {
    const summary = { total: passN + failN, pass: passN, fail: failN, results: results, at: new Date().toISOString() };
    fs.writeFileSync(path.join(__dirname, 'committee_result.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log('\n================ committee unit: ' + passN + ' passed, ' + failN + ' failed ================');
    process.exitCode = failN ? 2 : 0;
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}



