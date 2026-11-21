/* cloudfunctions/notify 云函数单测（纯 mock，绝不发真实订阅消息/不访问网络）
 * 运行：node mp-class-tools-tests/cloudfunctions/notify.test.js
 * 说明：通过 Module._resolveFilename 把 require('wx-server-sdk') 注入本目录 _mock 的假模块；
 *       数据库、openapi、getWXContext 全部内存 mock；Date.now 固定，保证可重复。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..', '..');
const FN_DIR = path.join(ROOT, 'cloudfunctions', 'notify');
const INDEX = path.join(FN_DIR, 'index.js');
const MOCK = path.join(__dirname, '_mock', 'wx-server-sdk.js');

/* ---------- 固定时间：2026-11-05 13:15 上海时间 ---------- */
const REAL_NOW = Date.now;
const FIXED_NOW = Date.parse('2026-11-05T05:15:00.000Z');
Date.now = function () { return FIXED_NOW; };

/* ---------- 注入 mock wx-server-sdk ---------- */
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'wx-server-sdk') return MOCK;
  return origResolve.call(this, request, parent, isMain, options);
};

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function short(s, n) {
  s = String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '\u2026' : s;
}
function purgeCache() {
  Object.keys(require.cache).forEach(function (k) {
    const n = k.replace(/\\/g, '/');
    if (n === INDEX.replace(/\\/g, '/') || n === MOCK.replace(/\\/g, '/')) delete require.cache[k];
  });
}

/* ---------- 内存 mock：cloud / database / openapi ---------- */
function makeCloud(state) {
  function matchCond(doc, cond) {
    const keys = Object.keys(cond || {});
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const c = cond[k];
      if (c && typeof c === 'object' && c.__mockOp) {
        if (c.__mockOp === 'lte') { if (!(doc[k] <= c.value)) return false; }
        else if (c.__mockOp === 'in') { if (!c.value || c.value.indexOf(doc[k]) < 0) return false; }
        else return false;
      } else if (doc[k] !== c) return false;
    }
    return true;
  }
  function makeQuery(colName, cond) {
    const q = {
      _limit: 0,
      _order: null,
      limit(n) { q._limit = Number(n) || 0; return q; },
      orderBy(field, dir) { q._order = { field: field, dir: dir || 'asc' }; return q; },
      get() {
        state.getCalls++;
        let rows = (state.collections[colName] || []).filter(function (r) { return matchCond(r, cond); }).map(clone);
        if (q._order) {
          const f = q._order.field;
          const sign = q._order.dir === 'desc' ? -1 : 1;
          rows.sort(function (a, b) {
            if (a[f] === b[f]) return 0;
            return a[f] < b[f] ? -sign : sign;
          });
        }
        if (q._limit > 0) rows = rows.slice(0, q._limit);
        return Promise.resolve({ data: rows });
      }
    };
    return q;
  }
  function makeCollection(name) {
    if (!state.collections[name]) state.collections[name] = [];
    return {
      where(cond) { return makeQuery(name, cond); },
      get() { return makeQuery(name, {}).get(); },
      add(o) {
        state.seq++;
        const row = Object.assign({ _id: 'doc_' + state.seq }, clone(o && o.data));
        state.collections[name].push(row);
        state.addCalls++;
        return Promise.resolve({ _id: row._id });
      },
      doc(id) {
        return {
          update(o) {
            state.updateCalls++;
            const rows = state.collections[name] || [];
            for (let i = 0; i < rows.length; i++) {
              if (rows[i]._id === id) {
                Object.assign(rows[i], clone(o && o.data));
                return Promise.resolve({ stats: { updated: 1 } });
              }
            }
            return Promise.resolve({ stats: { updated: 0 } });
          }
        };
      }
    };
  }
  const db = {
    command: {
      lte(v) { return { __mockOp: 'lte', value: v }; },
      in(arr) { return { __mockOp: 'in', value: arr }; }
    },
    createCollection(name) {
      state.createCollectionCalls++;
      if (state.collections[name]) return Promise.reject(new Error('collection already exists'));
      state.collections[name] = [];
      return Promise.resolve({ requestId: 'mock' });
    },
    collection(name) { return makeCollection(name); }
  };
  return {
    DYNAMIC_CURRENT_ENV: 'mock-current-env',
    init(opts) { state.initOpts = opts; },
    database() { if (state.forceError) throw new Error('mock-db-down'); return db; },
    getWXContext() { return { OPENID: state.openid, APPID: 'wxtest', UNIONID: '' }; },
    openapi: {
      subscribeMessage: {
        send(payload) {
          state.sent.push(clone(payload));
          state.sendCalls++;
          if (state.onSend) {
            const err = state.onSend(payload, state.sendCalls);
            if (err) return Promise.reject(err instanceof Error ? err : new Error(String(err)));
          }
          return Promise.resolve({ errCode: 0, errMsg: 'ok' });
        }
      }
    }
  };
}

/* opts: { docs, openid, forceError, onSend } */
function newRun(opts) {
  opts = opts || {};
  const state = {
    collections: {},
    seq: 0,
    openid: opts.openid === undefined ? 'openid-A' : opts.openid,
    sent: [],
    sendCalls: 0,
    getCalls: 0,
    addCalls: 0,
    updateCalls: 0,
    createCollectionCalls: 0,
    forceError: !!opts.forceError,
    onSend: opts.onSend || null
  };
  const docs = opts.docs || [];
  if (docs.length) {
    state.collections.subscriptions = docs.map(function (d, i) {
      const row = clone(d);
      if (!row._id) row._id = 'seed_' + (i + 1);
      return row;
    });
  }
  global.__WX_SERVER_SDK_FACTORY__ = function () { return makeCloud(state); };
  purgeCache();
  const mod = require(INDEX);
  return { main: mod.main, state: state };
}

function rowsOf(state) { return state.collections.subscriptions || []; }
function rowsWhere(state, pred) { return rowsOf(state).filter(pred); }

/* ---------- 小型测试框架 ---------- */
let passN = 0, failN = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passN++; console.log('PASS  ' + name); }
  catch (e) {
    failN++; failures.push({ name: name, err: String((e && e.message) || e) });
    console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e));
  }
}

/* =================== 1. subscribe：kind / ref / fireAt 校验 =================== */
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
// 2026-11-19：新模板（日程提醒）+ 旧模板（兼容旧客户端）
const NEW_TMPL = 'ZqIur9lMTUTrbKeTXzirEEtHosvLFm-7sULeBjmyMjk';
const LEGACY_TMPL = 'eYDRJDSTJdRL-gvE0rM8EbuSZX6mA9L2U-UTA8MwSmo';

async function run() {
  await test('subscribe: kind 非法 -> bad-kind，不写库', async () => {
    const r = newRun();
    const res = await r.main({ action: 'subscribe', kind: 'bad', ref: 'x', fireAt: FIXED_NOW + HOUR });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'bad-kind');
    assert.strictEqual(rowsOf(r.state).length, 0);
  });

  await test('subscribe: ntremind 缺 ref / 空白 ref -> missing-ref（trim 后判空）', async () => {
    const cases = [undefined, '', '   ', ' \t\n '];
    for (let i = 0; i < cases.length; i++) {
      const r = newRun();
      const data = { action: 'subscribe', kind: 'ntremind', fireAt: FIXED_NOW + HOUR };
      if (cases[i] !== undefined) data.ref = cases[i];
      const res = await r.main(data);
      assert.strictEqual(res.ok, false, 'case#' + i + ' 应拒绝');
      assert.strictEqual(res.reason, 'missing-ref', 'case#' + i);
      assert.strictEqual(rowsOf(r.state).length, 0);
    }
  });

  await test('subscribe: ntremind fireAt 开区间边界（(now+60s, now+366d)）', async () => {
    const cases = [
      { fireAt: 0, ok: false },
      { fireAt: FIXED_NOW, ok: false },
      { fireAt: FIXED_NOW + 59 * 1000, ok: false },
      { fireAt: FIXED_NOW + 60 * 1000, ok: false },          // 必须严格 > now+60s
      { fireAt: FIXED_NOW + 60 * 1000 + 1, ok: true },
      { fireAt: FIXED_NOW + 2 * HOUR, ok: true },
      { fireAt: FIXED_NOW + 366 * DAY - 1, ok: true },
      { fireAt: FIXED_NOW + 366 * DAY, ok: false },          // 上界开区间：等于上界拒绝
      { fireAt: FIXED_NOW + 366 * DAY + 1, ok: false }
    ];
    for (let i = 0; i < cases.length; i++) {
      const r = newRun();
      const res = await r.main({ action: 'subscribe', kind: 'ntremind', ref: 'g1', fireAt: cases[i].fireAt, label: 'L', summary: 'S' });
      assert.strictEqual(res.ok, cases[i].ok, 'case#' + i + ' fireAt=' + cases[i].fireAt + ' -> ' + JSON.stringify(res));
      if (!cases[i].ok) assert.strictEqual(res.reason, 'bad-fire-at');
    }
  });

  await test('subscribe: ntremind 成功写入行（active/attempts/label 原样）', async () => {
    const r = newRun();
    const fireAt = FIXED_NOW + 2 * HOUR;
    const res = await r.main({
      action: 'subscribe', kind: 'ntremind', ref: 'auto_g_1', fireAt: fireAt,
      label: '截止前 2 小时', tip: '通知提醒', timeText: '2026-11-05 15:15',
      summary: '数学作业截止提醒', dateText: '2026-11-06 23:59'
    });
    assert.deepStrictEqual(res, { ok: true });
    const rows = rowsOf(r.state);
    assert.strictEqual(rows.length, 1);
    const row = rows[0];
    assert.strictEqual(row.openid, 'openid-A');
    assert.strictEqual(row.kind, 'ntremind');
    assert.strictEqual(row.ref, 'auto_g_1');
    assert.strictEqual(row.fireAt, fireAt);
    assert.strictEqual(row.label, '截止前 2 小时');
    assert.strictEqual(row.active, true);
    assert.strictEqual(row.attempts, 0);
    assert.strictEqual(row.createdAt, FIXED_NOW);
  });

  await test('subscribe: ref 前后空白 trim 后存储，trim 后同 ref 去重更新', async () => {
    const r = newRun();
    let res = await r.main({ action: 'subscribe', kind: 'ntremind', ref: '  auto_g_9  ', fireAt: FIXED_NOW + HOUR });
    assert.deepStrictEqual(res, { ok: true });
    assert.strictEqual(rowsOf(r.state)[0].ref, 'auto_g_9');
    res = await r.main({ action: 'subscribe', kind: 'ntremind', ref: 'auto_g_9', fireAt: FIXED_NOW + 2 * HOUR });
    assert.deepStrictEqual(res, { ok: true });
    assert.strictEqual(rowsOf(r.state).length, 1); // trim 后同 ref = 更新而非新增
  });

  await test('subscribe: 同 openid+kind+ref 去重更新（不新增行，字段覆盖，attempts 归零）', async () => {
    const r = newRun({
      docs: [{
        openid: 'openid-A', kind: 'ntremind', ref: 'auto_g_1', fireAt: FIXED_NOW + HOUR,
        label: '旧', summary: '旧标题', active: false, attempts: 2, createdAt: 1
      }]
    });
    const fireAt2 = FIXED_NOW + 3 * HOUR;
    const res = await r.main({
      action: 'subscribe', kind: 'ntremind', ref: 'auto_g_1', fireAt: fireAt2,
      label: '截止前 1 天', summary: '新标题', timeText: 'x', dateText: 'y'
    });
    assert.deepStrictEqual(res, { ok: true });
    assert.strictEqual(rowsOf(r.state).length, 1);
    const row = rowsOf(r.state)[0];
    assert.strictEqual(row._id, 'seed_1');
    assert.strictEqual(row.fireAt, fireAt2);
    assert.strictEqual(row.label, '截止前 1 天');
    assert.strictEqual(row.summary, '新标题');
    assert.strictEqual(row.active, true);
    assert.strictEqual(row.attempts, 0);
  });

  await test('subscribe: 同 openid 活跃 ntremind <=50（50 条时新增 -> too-many）', async () => {
    const docs = [];
    for (let i = 1; i <= 50; i++) docs.push({ openid: 'openid-A', kind: 'ntremind', ref: 'g' + i, fireAt: FIXED_NOW + HOUR, active: true });
    const r = newRun({ docs: docs });
    const res = await r.main({ action: 'subscribe', kind: 'ntremind', ref: 'g51', fireAt: FIXED_NOW + 2 * HOUR });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'too-many');
    assert.strictEqual(rowsOf(r.state).length, 50);
  });

  await test('subscribe: 49 条时新增 -> 成功（达到 50）', async () => {
    const docs = [];
    for (let i = 1; i <= 49; i++) docs.push({ openid: 'openid-A', kind: 'ntremind', ref: 'g' + i, fireAt: FIXED_NOW + HOUR, active: true });
    const r = newRun({ docs: docs });
    const res = await r.main({ action: 'subscribe', kind: 'ntremind', ref: 'g50', fireAt: FIXED_NOW + 2 * HOUR });
    assert.deepStrictEqual(res, { ok: true });
    assert.strictEqual(rowsOf(r.state).length, 50);
  });

  await test('subscribe: 命中已有行更新不占新名额（50 条满且 ref 已存在 -> 仍成功）', async () => {
    const docs = [];
    for (let i = 1; i <= 50; i++) docs.push({ openid: 'openid-A', kind: 'ntremind', ref: 'g' + i, fireAt: FIXED_NOW + HOUR, active: true });
    const r = newRun({ docs: docs });
    const res = await r.main({ action: 'subscribe', kind: 'ntremind', ref: 'g50', fireAt: FIXED_NOW + 5 * HOUR });
    assert.deepStrictEqual(res, { ok: true });
    assert.strictEqual(rowsOf(r.state).length, 50);
    const row = rowsWhere(r.state, function (x) { return x.ref === 'g50'; })[0];
    assert.strictEqual(row.fireAt, FIXED_NOW + 5 * HOUR);
  });

  await test('subscribe: 50 上限只统计本人 active（他人/已失效不占名额）', async () => {
    const docs = [];
    for (let i = 1; i <= 50; i++) docs.push({ openid: 'openid-B', kind: 'ntremind', ref: 'b' + i, fireAt: FIXED_NOW + HOUR, active: true });
    for (let i = 1; i <= 10; i++) docs.push({ openid: 'openid-A', kind: 'ntremind', ref: 'i' + i, fireAt: FIXED_NOW + HOUR, active: false });
    const r = newRun({ docs: docs });
    const res = await r.main({ action: 'subscribe', kind: 'ntremind', ref: 'a1', fireAt: FIXED_NOW + 2 * HOUR });
    assert.deepStrictEqual(res, { ok: true });
  });

  await test('subscribe: hw 保持原逻辑（fireAt 必须未来）', async () => {
    const past = newRun();
    let res = await past.main({ action: 'subscribe', kind: 'hw', ref: 'h1', fireAt: FIXED_NOW - 1, tip: '作业截止提醒' });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'time-passed');

    const future = newRun();
    res = await future.main({ action: 'subscribe', kind: 'hw', ref: 'h1', fireAt: FIXED_NOW + HOUR, tip: '作业截止提醒', timeText: '11月5日 14:00', summary: '数学' });
    assert.deepStrictEqual(res, { ok: true });
    const row = rowsOf(future.state)[0];
    assert.strictEqual(row.kind, 'hw');
    assert.strictEqual(row.active, true);
  });

  await test('subscribe: nt（下一条通知）fireAt=0 兼容', async () => {
    const r = newRun();
    const res = await r.main({ action: 'subscribe', kind: 'nt', ref: 'next', fireAt: 0, tip: '新通知', timeText: '2026年11月5日 13:15', summary: '下一条班级通知' });
    assert.deepStrictEqual(res, { ok: true });
    const row = rowsOf(r.state)[0];
    assert.strictEqual(row.kind, 'nt');
    assert.strictEqual(row.ref, 'next');
  });

  await test('subscribe: 省略 kind 按旧版默认 hw', async () => {
    const r = newRun();
    const res = await r.main({ action: 'subscribe', ref: 'h1', fireAt: FIXED_NOW + HOUR });
    assert.deepStrictEqual(res, { ok: true });
    assert.strictEqual(rowsOf(r.state)[0].kind, 'hw');
  });

  /* =================== 2. list =================== */
  const LIST_DOCS = [
    { _id: 'a2', openid: 'openid-A', kind: 'ntremind', ref: 'g2', fireAt: FIXED_NOW + 2 * HOUR, label: 'L2', timeText: 't2', summary: 's2', dateText: 'd2', tip: 'tip2', active: true, attempts: 0, createdAt: 200 },
    { _id: 'a1', openid: 'openid-A', kind: 'hw', ref: 'h1', fireAt: FIXED_NOW + HOUR, timeText: 't1', summary: 's1', dateText: 'd1', active: true, createdAt: 100 },
    { _id: 'a3', openid: 'openid-A', kind: 'nt', ref: 'next', fireAt: 0, timeText: 't3', active: true, createdAt: 300 },
    { _id: 'a9', openid: 'openid-A', kind: 'ntremind', ref: 'g9', fireAt: FIXED_NOW + 3 * HOUR, active: false, createdAt: 900 },
    { _id: 'b1', openid: 'openid-B', kind: 'ntremind', ref: 'g3', fireAt: FIXED_NOW + 4 * HOUR, active: true, createdAt: 400 }
  ];

  await test('list: kind=ntremind 只返回本人 active', async () => {
    const r = newRun({ docs: LIST_DOCS });
    const res = await r.main({ action: 'list', kind: 'ntremind' });
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.list.map(function (x) { return x._id; }), ['a2']);
    assert.strictEqual(res.total, 1);
  });

  await test('list: 省略 kind = 全部提醒（hw+ntremind），不含 nt，按 fireAt 升序', async () => {
    const r = newRun({ docs: LIST_DOCS });
    const res = await r.main({ action: 'list' });
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.list.map(function (x) { return x._id; }), ['a1', 'a2']);
  });

  await test('list: 字段裁剪（无 openid/tip/attempts/dateText），字段齐全', async () => {
    const r = newRun({ docs: LIST_DOCS });
    const res = await r.main({ action: 'list', kind: 'ntremind' });
    const row = res.list[0];
    assert.deepStrictEqual(Object.keys(row).sort(), ['_id', 'createdAt', 'fireAt', 'kind', 'label', 'ref', 'summary', 'timeText']);
    const dump = JSON.stringify(res);
    assert.strictEqual(dump.indexOf('openid'), -1);
    assert.strictEqual(dump.indexOf('attempts'), -1);
  });

  await test('list: 非法 kind -> bad-kind', async () => {
    const r = newRun({ docs: LIST_DOCS });
    const res = await r.main({ action: 'list', kind: 'xx' });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'bad-kind');
  });

  await test('list: 最多 100 条', async () => {
    const docs = [];
    for (let i = 1; i <= 105; i++) docs.push({ _id: 'h' + i, openid: 'openid-A', kind: 'hw', ref: 'h' + i, fireAt: FIXED_NOW + i * 1000, active: true });
    const r = newRun({ docs: docs });
    const res = await r.main({ action: 'list', kind: 'hw' });
    assert.strictEqual(res.list.length, 100);
    assert.strictEqual(res.list[0].fireAt, FIXED_NOW + 1000); // 升序后取前 100
  });

  /* =================== 3. cancel =================== */
  const CANCEL_DOCS = [
    { _id: 'c1', openid: 'openid-A', kind: 'ntremind', ref: 'g1', fireAt: FIXED_NOW + HOUR, active: true },
    { _id: 'c2', openid: 'openid-B', kind: 'ntremind', ref: 'g1', fireAt: FIXED_NOW + HOUR, active: true },
    { _id: 'c3', openid: 'openid-A', kind: 'ntremind', ref: 'g2', fireAt: FIXED_NOW + HOUR, active: true },
    { _id: 'c4', openid: 'openid-A', kind: 'hw', ref: 'h1', fireAt: FIXED_NOW + HOUR, active: true }
  ];

  await test('cancel: 只影响本人行', async () => {
    const r = newRun({ docs: CANCEL_DOCS });
    const res = await r.main({ action: 'cancel', kind: 'ntremind', ref: 'g1' });
    assert.deepStrictEqual(res, { ok: true });
    const byId = {};
    rowsOf(r.state).forEach(function (x) { byId[x._id] = x; });
    assert.strictEqual(byId.c1.active, false);
    assert.strictEqual(byId.c2.active, true);   // 他人的同 ref 行不动
    assert.strictEqual(byId.c3.active, true);   // 本人的其它 ref 不动
    assert.strictEqual(byId.c4.active, true);
    assert.ok(byId.c1.cancelledAt);
  });

  await test('cancel: 不存在也 ok:true 且不写库', async () => {
    const r = newRun({ docs: CANCEL_DOCS });
    const res = await r.main({ action: 'cancel', kind: 'ntremind', ref: 'zzz' });
    assert.deepStrictEqual(res, { ok: true });
    assert.strictEqual(r.state.updateCalls, 0);
  });

  await test('cancel: 缺 ref -> missing-ref', async () => {
    const r = newRun({ docs: CANCEL_DOCS });
    const res = await r.main({ action: 'cancel', kind: 'ntremind' });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'missing-ref');
  });

  /* =================== 4. publishNotice =================== */
  await test('publishNotice: 只发 kind=nt 行，不碰 ntremind/hw', async () => {
    const r = newRun({
      docs: [
        { _id: 'n1', openid: 'openid-A', kind: 'nt', ref: 'next', fireAt: 0, timeText: 'old', summary: 'old', dateText: 'old', active: true },
        { _id: 'n2', openid: 'openid-B', kind: 'nt', ref: 'next', fireAt: 0, active: true },
        { _id: 'r1', openid: 'openid-A', kind: 'ntremind', ref: 'g1', fireAt: FIXED_NOW + HOUR, active: true },
        { _id: 'h1', openid: 'openid-A', kind: 'hw', ref: 'h1', fireAt: FIXED_NOW + HOUR, active: true }
      ]
    });
    const res = await r.main({ action: 'publishNotice', timeText: '2026-11-05 13:30', summary: '新通知：明天考试', dateText: '2026-11-05' });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.sent, 2);
    assert.strictEqual(res.total, 2);
    assert.strictEqual(r.state.sent.length, 2);
    r.state.sent.forEach(function (p) {
      assert.strictEqual(p.page, 'pages/nt/nt');
      assert.strictEqual(p.templateId, LEGACY_TMPL);
      assert.strictEqual(p.data.thing2.value, '新通知');
      assert.strictEqual(p.data.time1.value, '2026-11-05 13:30');
      assert.strictEqual(p.data.thing3.value, short('新通知：明天考试', 20));
      assert.strictEqual(p.data.time26.value, '2026-11-05');
    });
    const byId = {};
    rowsOf(r.state).forEach(function (x) { byId[x._id] = x; });
    assert.strictEqual(byId.n1.active, false);
    assert.strictEqual(byId.n1.sentAt, FIXED_NOW);
    assert.strictEqual(byId.n2.active, false);
    assert.strictEqual(byId.r1.active, true);   // ntremind 不能被 publishNotice 发送
    assert.strictEqual(byId.h1.active, true);
  });

  await test('publishNotice: 单条发送失败不影响其它，失败行保持 active 并记 lastError', async () => {
    const r = newRun({
      docs: [
        { _id: 'n1', openid: 'openid-A', kind: 'nt', ref: 'next', active: true },
        { _id: 'n2', openid: 'openid-B', kind: 'nt', ref: 'next', active: true }
      ],
      onSend: function (p) { return p.touser === 'openid-B' ? new Error('mock-send-fail') : null; }
    });
    const res = await r.main({ action: 'publishNotice', timeText: 't', summary: 's', dateText: 'd' });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.sent, 1);
    assert.strictEqual(res.total, 2);
    assert.deepStrictEqual(res.errors, ['mock-send-fail']);
    const byId = {};
    rowsOf(r.state).forEach(function (x) { byId[x._id] = x; });
    assert.strictEqual(byId.n1.active, false);
    assert.strictEqual(byId.n2.active, true);
    assert.strictEqual(byId.n2.lastError, 'mock-send-fail');
  });

  /* =================== 5. timer =================== */
  const DUE = Date.parse('2026-11-05T00:00:00.000Z'); // 2026-11-05 08:00 上海（已过点）
  const LONG_TITLE = '关于周五下午班会课调整与期中考试安排的通知';

  function timerDocs() {
    return [
      { _id: 't_hw', openid: 'openid-A', kind: 'hw', ref: 'h1', fireAt: FIXED_NOW - 1000, tip: '作业截止提醒', timeText: '11月5日 13:00', summary: '数学：练习册', dateText: '2026-11-05 13:00', active: true },
      { _id: 't_ntr_a', openid: 'openid-A', kind: 'ntremind', ref: 'auto_g_1', fireAt: DUE, label: '截止前 1 天', tip: '通知提醒', summary: LONG_TITLE, dateText: '2026-11-06 23:59', active: true, attempts: 0 },
      { _id: 't_ntr_b', openid: 'openid-B', kind: 'ntremind', ref: 'auto_g_2', fireAt: DUE, summary: '另一条通知', active: true, attempts: 0 },
      { _id: 't_future', openid: 'openid-A', kind: 'ntremind', ref: 'auto_g_3', fireAt: FIXED_NOW + HOUR, summary: '未到点', active: true },
      { _id: 't_dead', openid: 'openid-A', kind: 'ntremind', ref: 'auto_g_4', fireAt: FIXED_NOW - HOUR, active: false },
      { _id: 't_nt', openid: 'openid-A', kind: 'nt', ref: 'next', fireAt: 0, active: true }
    ];
  }

  await test('timer: 只处理 due 的 hw+ntremind，成功置 inactive+sentAt', async () => {
    const r = newRun({ docs: timerDocs() });
    const res = await r.main({ Type: 'Timer' });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.sent, 3);
    assert.strictEqual(res.total, 3);
    assert.strictEqual(r.state.sent.length, 3);

    const byId = {};
    rowsOf(r.state).forEach(function (x) { byId[x._id] = x; });
    assert.strictEqual(byId.t_hw.active, false);
    assert.strictEqual(byId.t_hw.sentAt, FIXED_NOW);
    assert.strictEqual(byId.t_ntr_a.active, false);
    assert.strictEqual(byId.t_ntr_a.sentAt, FIXED_NOW);
    assert.strictEqual(byId.t_ntr_b.active, false);
    assert.strictEqual(byId.t_future.active, true);   // 未到点不处理
    assert.strictEqual(byId.t_future.sentAt, undefined);
    assert.strictEqual(byId.t_dead.active, false);
    assert.strictEqual(byId.t_nt.active, true);       // timer 不处理 nt
  });

  await test('timer: hw 文案保持兼容；ntremind 文案/时间/日期符合契约', async () => {
    const r = newRun({ docs: timerDocs() });
    await r.main({ action: 'timer' });
    const hw = r.state.sent.filter(function (p) { return p.page === 'pages/hw/hw'; })[0];
    assert.ok(hw);
    assert.strictEqual(hw.data.thing2.value, '作业截止提醒');
    assert.strictEqual(hw.data.time1.value, '11月5日 13:00');
    assert.strictEqual(hw.data.thing3.value, short('数学：练习册', 20));
    assert.strictEqual(hw.data.time26.value, '2026-11-05 13:00');

    const ntr = r.state.sent.filter(function (p) { return p.page.indexOf('pages/nt/nt?gid=') === 0; })[0];
    assert.ok(ntr);
    assert.strictEqual(ntr.templateId, LEGACY_TMPL);
    assert.strictEqual(ntr.data.thing2.value, '通知提醒');
    assert.strictEqual(ntr.data.time1.value, '2026年11月5日 08:00'); // fmt(fireAt)，上海时区
    assert.strictEqual(ntr.data.thing3.value, short(LONG_TITLE, 20));
    assert.strictEqual(ntr.data.time26.value, '2026-11-06 23:59');
    assert.strictEqual(ntr.touser, 'openid-A');
    assert.strictEqual(ntr.miniprogramState, 'formal');
  });

  await test('timer: ntremind page 带 gid 且 encodeURIComponent；无 dateText 时 time26=fmt(fireAt)', async () => {
    const r = newRun({
      docs: [
        { _id: 'e1', openid: 'openid-A', kind: 'ntremind', ref: 'auto g/1', fireAt: DUE, summary: 'S', active: true }
      ]
    });
    await r.main({ action: 'timer' });
    assert.strictEqual(r.state.sent.length, 1);
    const p = r.state.sent[0];
    assert.strictEqual(p.page, 'pages/nt/nt?gid=auto%20g%2F1');
    assert.strictEqual(p.data.time26.value, '2026年11月5日 08:00');
  });

  await test('timer: 发送失败 attempts+1 且保持 active；连续 3 次后 inactive 不再发送', async () => {
    const r = newRun({
      docs: [
        { _id: 'f1', openid: 'openid-A', kind: 'ntremind', ref: 'fail1', fireAt: FIXED_NOW - HOUR, summary: 'S', active: true, attempts: 0 }
      ],
      onSend: function () { return new Error('mock-send-fail'); }
    });
    let res = await r.main({ action: 'timer' });
    assert.strictEqual(res.sent, 0);
    assert.deepStrictEqual(res.errors, ['mock-send-fail']);
    let row = rowsOf(r.state)[0];
    assert.strictEqual(row.active, true);
    assert.strictEqual(row.attempts, 1);
    assert.strictEqual(row.lastError, 'mock-send-fail');

    await r.main({ action: 'timer' });
    row = rowsOf(r.state)[0];
    assert.strictEqual(row.active, true);
    assert.strictEqual(row.attempts, 2);

    await r.main({ action: 'timer' });
    row = rowsOf(r.state)[0];
    assert.strictEqual(row.active, false);   // >=3 次置 inactive 防止死循环
    assert.strictEqual(row.attempts, 3);

    const callsBefore = r.state.sendCalls;
    res = await r.main({ action: 'timer' });
    assert.strictEqual(res.total, 0);
    assert.strictEqual(r.state.sendCalls, callsBefore);  // 不再重复发送
  });

  await test('timer: 已有 attempts=2 的行再次失败立即 inactive', async () => {
    const r = newRun({
      docs: [
        { _id: 'f2', openid: 'openid-A', kind: 'hw', ref: 'h1', fireAt: FIXED_NOW - HOUR, summary: 'S', active: true, attempts: 2 }
      ],
      onSend: function () { return new Error('boom'); }
    });
    await r.main({ action: 'timer' });
    const row = rowsOf(r.state)[0];
    assert.strictEqual(row.attempts, 3);
    assert.strictEqual(row.active, false);
  });

  await test('timer: 每批最多 20 条（3s 超时保护），下一轮继续处理剩余', async () => {
    const docs = [];
    for (let i = 1; i <= 25; i++) docs.push({ _id: 'b' + i, openid: 'openid-A', kind: 'hw', ref: 'h' + i, fireAt: FIXED_NOW - 1000 - i, timeText: 't', active: true });
    const r = newRun({ docs: docs });
    const res1 = await r.main({ action: 'timer' });
    assert.strictEqual(res1.total, 20);
    assert.strictEqual(res1.sent, 20);
    assert.strictEqual(r.state.sendCalls, 20);
    assert.strictEqual(rowsWhere(r.state, function (x) { return x.active === true; }).length, 5);

    const res2 = await r.main({ action: 'timer' });
    assert.strictEqual(res2.total, 5);
    assert.strictEqual(res2.sent, 5);
    assert.strictEqual(rowsWhere(r.state, function (x) { return x.active === true; }).length, 0);
  });

  /* =================== 5b. 2026-11-19 新模板（日程提醒） =================== */
  await test('新模板：hw 字段映射 日程/时间/地点/日程描述（tmplId 决定模板）', async () => {
    const r = newRun({
      docs: [{
        _id: 'n_hw', openid: 'openid-A', kind: 'hw', ref: 'h1',
        fireAt: FIXED_NOW - 1000, tip: '作业截止提醒',
        timeText: '2026年11月5日 13:00', summary: '数学：练习册第3章',
        dateText: '2026-11-06 23:59', place: '自强楼 01105',
        tmplId: NEW_TMPL, active: true, attempts: 0
      }]
    });
    await r.main({ action: 'timer' });
    assert.strictEqual(r.state.sent.length, 1);
    const p = r.state.sent[0];
    assert.strictEqual(p.templateId, NEW_TMPL);
    assert.deepStrictEqual(Object.keys(p.data).sort(), ['thing1', 'thing3', 'thing5', 'time2']);
    assert.strictEqual(p.data.thing1.value, short('数学：练习册第3章', 20));
    assert.strictEqual(p.data.time2.value, '2026年11月6日 23:59');
    assert.strictEqual(p.data.thing3.value, '自强楼 01105');
    assert.strictEqual(p.data.thing5.value, '作业截止提醒');
  });

  await test('新模板：缺 dateText/place 时回退 timeText/班级工具；非法时间回退 fmt(fireAt)', async () => {
    const r = newRun({
      docs: [
        {
          _id: 'n_nt', openid: 'openid-A', kind: 'ntremind', ref: 'g1', fireAt: DUE,
          tip: '通知提醒', timeText: '2026年11月5日 08:00', summary: LONG_TITLE,
          tmplId: NEW_TMPL, active: true, attempts: 0
        },
        {
          _id: 'n_bad', openid: 'openid-A', kind: 'ntremind', ref: 'g2', fireAt: DUE,
          tip: '   ', timeText: 'bad-time', summary: '   ', dateText: 'not-a-date', place: '   ',
          tmplId: NEW_TMPL, active: true, attempts: 0
        }
      ]
    });
    await r.main({ action: 'timer' });
    const byGid = {};
    r.state.sent.forEach(function (p) { byGid[p.page] = p; });
    const a = byGid['pages/nt/nt?gid=g1'];
    assert.ok(a);
    assert.strictEqual(a.data.thing1.value, short(LONG_TITLE, 20));
    assert.strictEqual(a.data.time2.value, '2026年11月5日 08:00');
    assert.strictEqual(a.data.thing3.value, '班级工具');
    assert.strictEqual(a.data.thing5.value, '通知提醒');
    const b = byGid['pages/nt/nt?gid=g2'];
    assert.ok(b);
    assert.strictEqual(b.data.thing1.value, '通知提醒');
    assert.strictEqual(b.data.time2.value, '2026年11月5日 08:00');
    assert.strictEqual(b.data.thing5.value, '通知提醒');
  });

  await test('新模板：time2 支持中文/ISO/纯日期/无年份中文格式，值 ≤20 的 thing 字段', async () => {
    const r = newRun({
      docs: [
        { _id: 't_cn', openid: 'openid-A', kind: 'hw', ref: 'c1', fireAt: FIXED_NOW, dateText: '2026年11月6日 23:59', summary: 'A', tmplId: NEW_TMPL, active: true },
        { _id: 't_iso', openid: 'openid-A', kind: 'hw', ref: 'c2', fireAt: FIXED_NOW, dateText: '2026-11-07T01:02:00+08:00', summary: 'B', tmplId: NEW_TMPL, active: true },
        { _id: 't_date', openid: 'openid-A', kind: 'hw', ref: 'c3', fireAt: FIXED_NOW, dateText: '2026-11-08', summary: 'C', tmplId: NEW_TMPL, active: true },
        { _id: 't_md', openid: 'openid-A', kind: 'hw', ref: 'c4', fireAt: FIXED_NOW, dateText: '', timeText: '11月9日 07:30', summary: 'D', tmplId: NEW_TMPL, active: true }
      ]
    });
    await r.main({ action: 'timer' });
    const times = r.state.sent.map(function (p) { return p.data.time2.value; });
    assert.deepStrictEqual(times, [
      '2026年11月6日 23:59',
      '2026年11月7日 01:02',
      '2026年11月8日 00:00',
      '2026年11月9日 07:30'
    ]);
    r.state.sent.forEach(function (p) {
      ['thing1', 'thing3', 'thing5'].forEach(function (k) {
        assert.ok(p.data[k].value.length <= 20, k + ' 超长：' + p.data[k].value);
      });
    });
  });

  await test('兼容：无 tmplId 的旧订阅行仍用旧模板旧字段（thing2/time1/time3/time26）', async () => {
    const r = newRun({
      docs: [{
        _id: 'old1', openid: 'openid-A', kind: 'ntremind', ref: 'g_old', fireAt: DUE,
        tip: '通知提醒', timeText: '2026年11月5日 08:00', summary: '旧摘要', dateText: '2026-11-06 23:59',
        active: true, attempts: 0
      }]
    });
    await r.main({ action: 'timer' });
    const p = r.state.sent[0];
    assert.strictEqual(p.templateId, LEGACY_TMPL);
    assert.deepStrictEqual(Object.keys(p.data).sort(), ['thing2', 'thing3', 'time1', 'time26']);
    assert.strictEqual(p.data.thing2.value, '通知提醒');
    assert.strictEqual(p.data.thing3.value, '旧摘要');
  });

  await test('subscribe：记录 tmplId/place（非法 tmplId 清空；旧客户端不传 = 空）', async () => {
    const r1 = newRun();
    await r1.main({ action: 'subscribe', kind: 'ntremind', ref: 'g1', fireAt: FIXED_NOW + 2 * HOUR, tmplId: NEW_TMPL, place: '教学楼 A301', summary: 'S' });
    let row = rowsOf(r1.state)[0];
    assert.strictEqual(row.tmplId, NEW_TMPL);
    assert.strictEqual(row.place, '教学楼 A301');

    const r2 = newRun();
    await r2.main({ action: 'subscribe', kind: 'ntremind', ref: 'g1', fireAt: FIXED_NOW + 2 * HOUR, tmplId: 'bogus', place: '' });
    row = rowsOf(r2.state)[0];
    assert.strictEqual(row.tmplId, '');
    assert.strictEqual(row.place, '');

    const r3 = newRun();
    await r3.main({ action: 'subscribe', kind: 'hw', ref: 'h1', fireAt: FIXED_NOW + 2 * HOUR, tmplId: NEW_TMPL, tip: '作业截止提醒' });
    row = rowsOf(r3.state)[0];
    assert.strictEqual(row.tmplId, NEW_TMPL);
    assert.strictEqual(row.place, '');
  });

  /* =================== 6. 异常与鉴权兜底 =================== */
  await test('main: 数据库异常 -> {ok:false,reason:"cloud-error"}', async () => {
    const r = newRun({ forceError: true });
    const res = await r.main({ action: 'subscribe', kind: 'ntremind', ref: 'g1', fireAt: FIXED_NOW + HOUR });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'cloud-error');
  });

  await test('main: 无 openid -> no-openid（subscribe/list/cancel）', async () => {
    const r = newRun({ openid: '' });
    assert.strictEqual((await r.main({ action: 'subscribe', kind: 'nt', ref: 'next', fireAt: 0 })).reason, 'no-openid');
    assert.strictEqual((await r.main({ action: 'list' })).reason, 'no-openid');
    assert.strictEqual((await r.main({ action: 'cancel', kind: 'ntremind', ref: 'g1' })).reason, 'no-openid');
  });

  await test('main: 未知 action -> unknown-action', async () => {
    const r = newRun();
    const res = await r.main({ action: 'nope' });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'unknown-action');
  });

  await test('main: 首次调用自动建集合 subscriptions（已存在时忽略错误）', async () => {
    const r = newRun();
    await r.main({ action: 'list' });
    assert.ok(r.state.createCollectionCalls >= 1);
    const r2 = newRun({ docs: LIST_DOCS });
    const res = await r2.main({ action: 'list' });
    assert.strictEqual(res.ok, true);  // createCollection 抛“已存在”被吞掉
  });

  /* =================== 7. 部署配置与静态约束 =================== */
  await test('config.json: 定时触发器每分钟 + openapi 权限', async () => {
    const cfg = JSON.parse(fs.readFileSync(FN_DIR + '/config.json', 'utf8'));
    assert.deepStrictEqual(cfg.permissions.openapi, ['subscribeMessage.send']);
    assert.strictEqual(cfg.triggers.length, 1);
    assert.strictEqual(cfg.triggers[0].type, 'timer');
    assert.strictEqual(cfg.triggers[0].config, '0 */1 * * * * *');
  });

  await test('index.js: 不含可选链/空值合并（Nodejs16.13 保守写法），新/旧模板 ID 与 page 常量存在', async () => {
    const src = fs.readFileSync(INDEX, 'utf8');
    assert.ok(!/\?\./.test(src), '发现可选链 ?.');
    assert.ok(!/\?\?/.test(src), '发现空值合并 ??');
    assert.ok(src.indexOf('pages/nt/nt?gid=') >= 0);
    assert.ok(src.indexOf(NEW_TMPL) >= 0, '缺少新模板 ID');
    assert.ok(src.indexOf(LEGACY_TMPL) >= 0, '缺少旧模板兼容 ID');
  });

  Date.now = REAL_NOW;
  console.log('\n' + (failN === 0 ? 'ALL PASS' : 'FAILED') + '  pass=' + passN + ' fail=' + failN);
  if (failN) {
    failures.forEach(function (f) { console.log('  - ' + f.name + ' :: ' + f.err); });
    process.exitCode = 1;
  }
}

run().catch(function (e) {
  console.error('TEST RUNNER CRASH', e);
  process.exitCode = 1;
});

