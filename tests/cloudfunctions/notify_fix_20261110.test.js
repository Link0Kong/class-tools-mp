/* cloudfunctions/notify 2026-11-10 修复单测（纯 mock，不发真实订阅消息/不访问网络）
 * 覆盖本轮修复：
 *   A. 定时器心跳（document('__notify_hb').set，action='diag' 可读）
 *   B. 陈旧提醒守卫：到点超过 6h 不再发送，直接 active:false + skippedAt + lastError='stale:<h>h'
 *   C. action='flush'（前端 catch-up）：只处理调用者 openid 的到点提醒，不碰别人
 *   D. action='diag'：聚合诊断（心跳/积压/历史 lastError），不返回 openid/ref
 * 运行：node mp-class-tools-tests/cloudfunctions/notify_fix_20261110.test.js
 */
'use strict';
const fs = require('fs');
const assert = require('assert');
const Module = require('module');

const ROOT = 'C:/Users/Ko_Li/.openclaw/workspace';
const FN_DIR = ROOT + '/mp-class-tools/cloudfunctions/notify';
const INDEX = FN_DIR + '/index.js';
const MOCK = ROOT + '/mp-class-tools/tests/cloudfunctions/_mock/wx-server-sdk.js';

const REAL_NOW = Date.now;
const FIXED_NOW = Date.parse('2026-11-10T11:30:00.000Z'); // 2026-11-10 19:30 上海
Date.now = function () { return FIXED_NOW; };

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'wx-server-sdk') return MOCK;
  return origResolve.call(this, request, parent, isMain, options);
};

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function purgeCache() {
  Object.keys(require.cache).forEach(function (k) {
    const n = k.replace(/\\/g, '/');
    if (n === INDEX.replace(/\\/g, '/') || n === MOCK.replace(/\\/g, '/')) delete require.cache[k];
  });
}

let passed = 0;
let failed = 0;
function T(name, fn) {
  try {
    fn();
    passed++;
    console.log('PASS  ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL  ' + name + '  -> ' + ((e && e.message) || e));
  }
}
async function TA(name, fn) {
  try {
    await fn();
    passed++;
    console.log('PASS  ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL  ' + name + '  -> ' + ((e && e.message) || e));
  }
}
function eq(actual, expected, msg) {
  assert.deepStrictEqual(actual, expected, msg || (JSON.stringify(actual) + ' !== ' + JSON.stringify(expected)));
}

/* ---------------- 内存 mock：cloud / database / openapi ---------------- */
function makeState() {
  return {
    collections: { subscriptions: [] },
    seq: 0,
    getCalls: 0,
    addCalls: 0,
    updateCalls: 0,
    setCalls: 0,
    createCollectionCalls: 0,
    sends: [],
    sendFail: null,
    openid: 'openid_A'
  };
}
function matchCond(doc, cond) {
  const keys = Object.keys(cond || {});
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const c = cond[k];
    if (c && typeof c === 'object' && c.__mockOp) {
      if (c.__mockOp === 'lte') { if (!(doc[k] <= c.value)) return false; }
      else if (c.__mockOp === 'gte') { if (!(doc[k] >= c.value)) return false; }
      else if (c.__mockOp === 'in') { if (!c.value || c.value.indexOf(doc[k]) < 0) return false; }
      else if (c.__mockOp === 'exists') { if (c.value ? doc[k] === undefined : doc[k] !== undefined) return false; }
      else return false;
    } else if (doc[k] !== c) return false;
  }
  return true;
}
function makeCloud(state) {
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
      },
      count() {
        const rows = (state.collections[colName] || []).filter(function (r) { return matchCond(r, cond); });
        return Promise.resolve({ total: rows.length });
      }
    };
    return q;
  }
  function makeCollection(name) {
    if (!state.collections[name]) state.collections[name] = [];
    return {
      where(cond) { return makeQuery(name, cond); },
      get() { return makeQuery(name, {}).get(); },
      count() { return makeQuery(name, {}).count(); },
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
          },
          set(o) {
            state.setCalls++;
            const rows = state.collections[name] || [];
            for (let i = 0; i < rows.length; i++) {
              if (rows[i]._id === id) {
                Object.assign(rows[i], clone(o && o.data));
                return Promise.resolve({ stats: { updated: 1, created: 0 } });
              }
            }
            rows.push(Object.assign({ _id: id }, clone(o && o.data)));
            return Promise.resolve({ stats: { updated: 0, created: 1 } });
          },
          get() {
            const rows = state.collections[name] || [];
            for (let i = 0; i < rows.length; i++) {
              if (rows[i]._id === id) return Promise.resolve({ data: clone(rows[i]) });
            }
            return Promise.reject(new Error('document does not exist'));
          }
        };
      }
    };
  }
  const cmd = {
    lte(v) { return { __mockOp: 'lte', value: v }; },
    gte(v) { return { __mockOp: 'gte', value: v }; },
    in(arr) { return { __mockOp: 'in', value: arr }; },
    exists(v) { return { __mockOp: 'exists', value: v }; }
  };
  const db = {
    command: cmd,
    createCollection(name) {
      state.createCollectionCalls++;
      if (state.collections[name]) return Promise.reject(new Error('collection already exists'));
      state.collections[name] = [];
      return Promise.resolve({ requestId: 'mock' });
    },
    collection(name) { return makeCollection(name); }
  };
  return {
    init() {},
    DYNAMIC_CURRENT_ENV: 'env',
    database() { return db; },
    getWXContext() { return state.openid ? { OPENID: state.openid } : {}; },
    openapi: {
      subscribeMessage: {
        send(payload) {
          if (state.sendFail) return Promise.reject(new Error(state.sendFail));
          state.sends.push(clone(payload));
          return Promise.resolve({ errCode: 0 });
        }
      }
    }
  };
}

function setup(state) {
  purgeCache();
  global.__WX_SERVER_SDK_FACTORY__ = function () { return makeCloud(state); };
  delete require.cache[require.resolve(MOCK)];
  delete require.cache[require.resolve(INDEX)];
  return require(INDEX);
}
function seed(state, rows) {
  rows.forEach(function (r, i) {
    state.collections.subscriptions.push(Object.assign({ _id: 'r' + (i + 1), kind: 'hw', active: true, attempts: 0 }, r));
  });
}
const H = 3600 * 1000;
const MIN = 60 * 1000;

(async () => {
  /* ===== A. timer 心跳 + 陈旧守卫 ===== */
  {
    const state = makeState();
    seed(state, [
      { kind: 'hw', ref: 'hw1', fireAt: FIXED_NOW - 2 * MIN, summary: 'fresh-hw' },
      { kind: 'ntremind', ref: 'g1', fireAt: FIXED_NOW - 1 * MIN, summary: 'fresh-nt' },
      { kind: 'hw', ref: 'hw-old', fireAt: FIXED_NOW - 7 * H, summary: 'stale-hw' },
      { kind: 'ntremind', ref: 'g-old', fireAt: FIXED_NOW - 6 * H - 5 * MIN, summary: 'stale-nt' },
      { kind: 'hw', ref: 'hw-future', fireAt: FIXED_NOW + 1 * H },
      { kind: 'nt', ref: 'next', fireAt: 0 },
      { kind: 'hw', ref: 'hw-edge', fireAt: FIXED_NOW - 6 * H } // 恰好 6h：仍发送
    ]);
    const fn = setup(state);
    const r = await fn.main({ Type: 'Timer' });
    T('A1 timer：heartbeat 写入（__notify_hb, source=timer）', function () {
      const hb = (state.collections.subscriptions || []).filter(function (x) { return x._id === '__notify_hb'; })[0];
      eq(!!hb, true, 'heartbeat missing');
      eq(hb.source, 'timer');
      eq(hb.ts, FIXED_NOW);
    });
    T('A2 timer：新鲜到点 hw + ntremind 发送并置 inactive/sentAt', function () {
      eq(r.ok, true);
      eq(r.sent, 3); // fresh-hw + fresh-nt + hw-edge
      eq(r.stale, 2); // 7h hw + 6h+5min nt
      const sent = state.sends.map(function (s) { return s.data.thing3.value; });
      eq(sent.indexOf('fresh-hw') >= 0, true);
      eq(sent.indexOf('fresh-nt') >= 0, true);
      const rows = state.collections.subscriptions;
      const fresh = rows.filter(function (x) { return x.ref === 'hw1'; })[0];
      eq(fresh.active, false);
      eq(typeof fresh.sentAt, 'number');
    });
    T('A3 timer：陈旧提醒不发、active=false、skippedAt + lastError=stale:<h>h', function () {
      const rows = state.collections.subscriptions;
      const staleHw = rows.filter(function (x) { return x.ref === 'hw-old'; })[0];
      eq(staleHw.active, false);
      eq(typeof staleHw.skippedAt, 'number');
      eq(staleHw.lastError, 'stale:7h');
      eq(state.sends.some(function (s) { return s.data.thing3.value === 'stale-hw'; }), false);
      const staleNt = rows.filter(function (x) { return x.ref === 'g-old'; })[0];
      eq(staleNt.active, false);
    });
    T('A4 timer：6h 边界内仍发送（恰好 6h）', function () {
      const edge = state.collections.subscriptions.filter(function (x) { return x.ref === 'hw-edge'; })[0];
      eq(edge.active, false);
      eq(typeof edge.sentAt, 'number');
    });
    T('A5 timer：未到点/kind=nt 不处理', function () {
      const rows = state.collections.subscriptions;
      eq(rows.filter(function (x) { return x.ref === 'hw-future'; })[0].active, true);
      eq(rows.filter(function (x) { return x.ref === 'next'; })[0].active, true);
    });
    T('A6 timer：返回结构 {ok,sent,stale,total,scan}', function () {
      // 2026-11-11 需求 11：timer 增加 scan（新通知扫描结果；{skipped/sent/baseline}）——既有字段保持不变
      eq(Object.keys(r).sort(), ['errors', 'ok', 'scan', 'sent', 'stale', 'total']);
    });
  }

  /* ===== B. action=flush：只处理调用者 openid ===== */
  {
    const state = makeState();
    seed(state, [
      { kind: 'ntremind', ref: 'mine', fireAt: FIXED_NOW - 2 * MIN, openid: 'openid_A', summary: 'mine' },
      { kind: 'ntremind', ref: 'other', fireAt: FIXED_NOW - 2 * MIN, openid: 'openid_B', summary: 'other' },
      { kind: 'ntremind', ref: 'others-stale', fireAt: FIXED_NOW - 10 * H, openid: 'openid_B', summary: 'other2' }
    ]);
    const fn = setup(state);
    const r = await fn.main({ action: 'flush' });
    T('B1 flush：只发送本人 openid 的到点提醒', function () {
      eq(r.ok, true);
      eq(r.sent, 1);
      eq(state.sends.length, 1);
      eq(state.sends[0].touser, 'openid_A');
      eq(state.sends[0].data.thing3.value, 'mine');
    });
    T('B2 flush：他人提醒完全不动（active 保持）', function () {
      const rows = state.collections.subscriptions;
      eq(rows.filter(function (x) { return x.ref === 'other'; })[0].active, true);
      eq(rows.filter(function (x) { return x.ref === 'others-stale'; })[0].active, true);
    });
    T('B3 flush：heartbeat source=flush', function () {
      const hb = state.collections.subscriptions.filter(function (x) { return x._id === '__notify_hb'; })[0];
      eq(hb.source, 'flush');
    });
  }
  {
    const state = makeState();
    state.openid = '';
    const fn = setup(state);
    const r = await fn.main({ action: 'flush' });
    T('B4 flush：无 openid -> no-openid', function () {
      eq(r, { ok: false, reason: 'no-openid' });
      eq(state.sends.length, 0);
    });
  }

  /* ===== C. 发送失败：attempts+1、>=3 inactive ===== */
  {
    const state = makeState();
    state.sendFail = 'errCode: 43101 user refuse to accept the msg';
    seed(state, [{ kind: 'ntremind', ref: 'g1', fireAt: FIXED_NOW - 2 * MIN, attempts: 1 }]);
    const fn = setup(state);
    const r1 = await fn.main({ Type: 'Timer' });
    T('C1 timer 发送失败：attempts+1、保持 active、记 lastError', function () {
      eq(r1.sent, 0);
      const row = state.collections.subscriptions.filter(function (x) { return x.ref === 'g1'; })[0];
      eq(row.attempts, 2);
      eq(row.active, true);
      eq(String(row.lastError).indexOf('43101') >= 0, true);
    });
    const r2 = await fn.main({ Type: 'Timer' });
    T('C2 第 3 次失败：active=false（不再死循环）', function () {
      eq(r2.sent, 0);
      const row = state.collections.subscriptions.filter(function (x) { return x.ref === 'g1'; })[0];
      eq(row.attempts, 3);
      eq(row.active, false);
    });
  }

  /* ===== D. action=diag ===== */
  {
    const state = makeState();
    seed(state, [
      { kind: 'hw', ref: 'a', fireAt: FIXED_NOW - 2 * H, active: true },
      { kind: 'hw', ref: 'b', fireAt: FIXED_NOW - 2 * H, active: false, sentAt: FIXED_NOW - H, lastError: 'x', lastTry: FIXED_NOW - H, attempts: 1 },
      { kind: 'nt', ref: 'next', fireAt: 0, active: true },
      { kind: 'ntremind', ref: 'g', fireAt: FIXED_NOW + H, active: true, lastError: 'errCode: 47003 argument invalid', lastTry: FIXED_NOW - MIN, attempts: 2 }
    ]);
    state.collections.subscriptions.push({ _id: '__notify_hb', ts: FIXED_NOW - 60 * MIN, source: 'timer' });
    const fn = setup(state);
    const r = await fn.main({ action: 'diag' });
    T('D1 diag：ok + 心跳 agoMs/source', function () {
      eq(r.ok, true);
      eq(r.diag.hb.agoMs, 60 * MIN);
      eq(r.diag.hb.source, 'timer');
    });
    T('D2 diag：积压/活跃/已发送/错误行计数正确', function () {
      eq(r.diag.total, 5); // 4 行 + 心跳
      eq(r.diag.active, 3);
      eq(r.diag.activeDue, 1);
      eq(r.diag.hwActive, 1);
      eq(r.diag.ntRemindActive, 1);
      eq(r.diag.ntActive, 1);
      eq(r.diag.sentEver, 1);
      eq(r.diag.errRows, 2);
    });
    T('D3 diag：lastErrors 不含 openid/ref，按 lastTry 倒序、字段裁剪', function () {
      eq(Array.isArray(r.diag.lastErrors), true);
      eq(r.diag.lastErrors.length, 2);
      const keys = Object.keys(r.diag.lastErrors[0]).sort();
      eq(keys, ['active', 'attempts', 'fireAt', 'kind', 'lastError', 'lastTry']);
      eq(r.diag.lastErrors.some(function (x) { return 'openid' in x || 'ref' in x; }), false);
      eq(r.diag.lastErrors[0].lastTry >= r.diag.lastErrors[1].lastTry, true);
    });
    T('D4 diag：字段不含 openid/ref（隐私）', function () {
      const s = JSON.stringify(r.diag);
      eq(s.indexOf('openid') >= 0 || s.indexOf('"ref"') >= 0, false);
    });
    const state2 = makeState();
    seed(state2, [{ kind: 'hw', ref: 'a', fireAt: FIXED_NOW, active: true }]);
    const fn2 = setup(state2);
    const r2 = await fn2.main({ action: 'diag' });
    await TA('D5 diag：无心跳时 hb=null（未跑过定时器的环境）', function () {
      eq(r2.diag.hb, null);
    });
  }

  /* ===== E. config.json 契约（触发器每分钟 + openapi 权限） ===== */
  {
    const cfg = JSON.parse(fs.readFileSync(FN_DIR + '/config.json', 'utf8'));
    T('E1 config.json：定时触发器每分钟 + subscribeMessage.send 权限', function () {
      eq(cfg.triggers.length, 1);
      eq(cfg.triggers[0].type, 'timer');
      eq(cfg.triggers[0].config, '0 */1 * * * * *');
      eq(cfg.permissions.openapi.indexOf('subscribeMessage.send') >= 0, true);
    });
  }

  Date.now = REAL_NOW;
  Module._resolveFilename = origResolve;
  console.log('\n== notify 2026-11-10 修复单测：' + (passed + failed) + ' 项，PASS ' + passed + '，FAIL ' + failed + ' ==');
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH:', (e && e.stack) || e); process.exit(2); });
