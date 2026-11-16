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

const ROOT = 'C:/Users/Ko_Li/.openclaw/workspace/mp-class-tools';
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

module.exports.run = async function (test) {  test('名单：班委分类只显示 role/badge 且按职务权重排序', function () {
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

  test('名单：团员未加载时显示加载态、无计数', function () {
    const roster = R('utils/roster.js');
    const v = roster.listView('league', { members: MEMBERS, leagueLoaded: false });
    assert.strictEqual(v.rows.length, 0);
    assert.strictEqual(v.counts.leagueText, '');
    assert.strictEqual(v.emptyText, '团员名单加载中…');
  });

  test('名单：全班分类按座号升序且仅姓名与座号', function () {
    const roster = R('utils/roster.js');
    const v = roster.listView('all', { members: MEMBERS });
    assert.deepStrictEqual(v.rows.map(function (r) { return r.seat; }), [2, 3, 5, 7]);
    assert.ok(v.note.indexOf('全班 4 人') >= 0 && v.note.indexOf('姓名与座号') >= 0);
    assert.strictEqual(v.emptyText, '暂无名单');
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



