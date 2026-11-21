/* v3_power_diag_tests.js —— v2.0.0「与网站功能同步」专项单测：宿舍电费 + 管理员诊断 + UD v6 power section
 *
 * 运行方式：
 *   node v3_power_diag_tests.js   # 独立运行（自带 wx mock），结果写 v3_power_diag_result.json
 *   node unit.js                  # unit.js 末尾 require 本文件 run(test)，并入总表
 *
 * 约束：全部 Node 内存 mock，不启动模拟器、不发真实请求、不读写真实云端。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { allPages } = require('./_app_pages.js');
const assert = require('assert');

const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');
const ROOT_N = ROOT.replace(/\\/g, '/');

const ID = { token: 'tok-v3-admin', sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: true, ts: 1 };
const ID2 = { token: 'tok-v3-user', sid: '9999000004', name: '测试辛', role: '', badge: '', is_admin: false, ts: 2 };

function createCtx() {
  const mem = Object.create(null);
  let reqLog = [];
  let reqImpl = function (o) { o.success({ statusCode: 200, data: [] }); };
  let toastLog = [];
  let navLog = [];
  const wxMock = {
    getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
    setStorageSync(k, v) { mem[k] = v; },
    removeStorageSync(k) { delete mem[k]; },
    getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 0, limitSize: 10240 }; },
    request(o) { reqLog.push(o); reqImpl(o); },
    showToast(o) { toastLog.push(o && o.title); },
    showModal(o) { if (o && o.success) o.success({ confirm: true, cancel: false }); },
    showShareMenu() {}, stopPullDownRefresh() {}, switchTab() {}, reLaunch() {}, navigateTo(o) { navLog.push(String((o && o.url) || '')); },
    getWindowInfo() { return { windowWidth: 375 }; },
    getSystemInfoSync() { return { windowWidth: 375, SDKVersion: '3.0.0' }; },
    getAppBaseInfo() { return { SDKVersion: '3.0.0' }; },
    createSelectorQuery() {
      return { in() { return this; }, select() { return this; }, selectViewport() { return this; }, boundingClientRect() { return this; }, scrollOffset() { return this; }, fields() { return this; }, exec(cb) { if (cb) cb([{ top: 0 }, { scrollTop: 0 }]); } };
    },
    pageScrollTo() {},
    nextTick(fn) { if (fn) fn(); },
    env: { USER_DATA_PATH: '/tmp' },
    cloud: undefined
  };
  return {
    mem: mem, wxMock: wxMock,
    clearMem() { Object.keys(mem).forEach(function (k) { delete mem[k]; }); reqLog = []; toastLog = []; navLog = []; reqImpl = function (o) { o.success({ statusCode: 200, data: [] }); }; },
    setReq(fn) { reqImpl = fn; },
    reqLog() { return reqLog; },
    navLog() { return navLog; },
    urlsOf(frag) { return reqLog.filter(function (o) { return String((o && o.url) || '').indexOf(frag) >= 0; }); },
    toastLog() { return toastLog; },
    setIdentity(id) { mem['zq_class_identity'] = JSON.stringify(id || ID); }
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
function enableCloud(cloud) {
  cloud.configure({ enabled: true, restBase: 'https://rest.test/v1/rdb/rest/', publishableKey: 'pk-test', ttUrl: 'https://static.test/tt.json' });
}
function loadPage(rel) {
  let def = null;
  const file = path.join(ROOT, 'pages', rel + '.js');
  try { delete require.cache[require.resolve(file)]; } catch (e) { /* ignore */ }
  global.Page = function (d) { def = d; };
  try { require(file); } finally { delete global.Page; }
  assert.ok(def && typeof def === 'object', '页面未注册 Page：' + rel);
  return def;
}
// 支持 'a.b' / 'a[0].b' 路径的极简 setData
function makeSetData(ctx) {
  ctx.__log = [];
  return function (o, cb) {
    ctx.__log.push(Object.keys(o || {}));
    Object.keys(o || {}).forEach(function (k) {
      const parts = k.replace(/\[(\d+)\]/g, '.$1').split('.');
      let t = ctx.data;
      for (let i = 0; i < parts.length - 1; i++) {
        if (t[parts[i]] == null) t[parts[i]] = {};
        t = t[parts[i]];
      }
      t[parts[parts.length - 1]] = o[k];
    });
    ctx.last = o;
    if (cb) cb();
  };
}
function ctxOf(def, extra) {
  const ctx = Object.assign({}, def);
  ctx.data = JSON.parse(JSON.stringify(def.data || {}));
  ctx.setData = makeSetData(ctx);
  if (extra) Object.assign(ctx, extra);
  return ctx;
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
// 轮询等待条件成立（用于验证「自动静默重试」这类异步恢复；最多 timeout ms，50ms 一查）
const waitFor = async function (fn, timeout) {
  const t0 = Date.now();
  const lim = timeout || 3000;
  while (Date.now() - t0 < lim) {
    if (fn()) return true;
    await sleep(50);
  }
  return !!fn();
};

function src(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

// 电费 mock 数据（与网站 power_check.py 样例一致）
const PW_ROWS = {
  '4-23A---321': { id: '4-23A---321', label: '23号楼A座321', building: '23号楼A座', room: '321', quantity: 382.02, unit: '度', low: false, updated_at: '2026-11-05T22:04:00+08:00' },
  '1-16---305': { id: '1-16---305', label: '16号楼305', building: '16号楼', room: '305', quantity: 22.25, unit: '度', low: true, updated_at: '2026-11-05T22:04:00+08:00' },
  '4-23B---424': { id: '4-23B---424', label: '23号楼B座424', building: '23号楼B座', room: '424', quantity: 18.5, unit: '度', low: false, updated_at: '2026-11-05T22:04:00+08:00' },
  '4-23B---425': { id: '4-23B---425', label: '23号楼B座425', building: '23号楼B座', room: '425', quantity: 70, unit: '度', low: false, updated_at: '2026-11-05T22:04:00+08:00' }
};
function pwHist(rv) {
  const base = Date.now() - 10 * 3600 * 1000;
  const startQ = rv === '1-16---305' ? 60 : 100;
  const out = [];
  for (let i = 0; i <= 10; i++) out.push({ roomverify: rv, quantity: startQ - i * 4, ts: new Date(base + i * 3600 * 1000).toISOString() });
  return out;
}
// task-28 全量压缩趋势：按查询区间返回真实密度的采样（24h/24、7d/56、30d/120），
// 与「全部点铺满绘图区」的新实现一致；仅用于需要检查 30d 全量点的用例。
function pwHistRanged(rv, days) {
  const n = days >= 25 ? 120 : (days >= 5 ? 56 : 24);
  const startQ = rv === '1-16---305' ? 60 : 100;
  const end = Date.now();
  const span = days * 24 * 3600e3;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ roomverify: rv, quantity: startQ - (i / (n - 1)) * 40, ts: new Date(end - span + (i / (n - 1)) * span).toISOString() });
  }
  return out;
}
function cleanupPage(ctx) {
  try { if (ctx && typeof ctx._cancelTimers === 'function') ctx._cancelTimers(); } catch (e) { /* ignore */ }
}
function installPowerMock(C, ranged) {
  C.setReq(function (o) {
    const u = String(o.url || '');
    if (u.indexOf('/power_history?') >= 0) {
      let rv = '4-23A---321';
      try { const m = u.match(/roomverify=eq\.([^&]+)/); if (m) rv = decodeURIComponent(m[1]); } catch (e) { /* ignore */ }
      if (ranged) {
        let days = 1;
        const m2 = u.match(/ts=gte\.([^&]+)/);
        if (m2) {
          const d = (Date.now() - Date.parse(decodeURIComponent(m2[1]))) / 86400e3;
          days = d >= 25 ? 30 : (d >= 5 ? 7 : 1);
        }
        return o.success({ statusCode: 200, data: pwHistRanged(rv, days) });
      }
      return o.success({ statusCode: 200, data: pwHist(rv) });
    }
    if (u.indexOf('/power?') >= 0) {
      let rv = '4-23A---321';
      try { const m = u.match(/id=eq\.([^&]+)/); if (m) rv = decodeURIComponent(m[1]); } catch (e) { /* ignore */ }
      return o.success({ statusCode: 200, data: PW_ROWS[rv] ? [PW_ROWS[rv]] : [] });
    }
    if (u.indexOf('/userdata?') >= 0) return o.success({ statusCode: 200, data: [] });
    return o.success({ statusCode: 200, data: [] });
  });
}

// canvas 2d mock：记录调用；返回 fake node（DPR=3，size 300x160）
function installCanvasMock(C) {
  const calls = [];
  const gradStops = [];
  const grad = { addColorStop: function () { gradStops.push(1); } };
  const ctx = {
    clearRect: function () { calls.push('clearRect'); },
    beginPath: function () { calls.push('beginPath'); },
    moveTo: function () { calls.push('moveTo'); },
    lineTo: function () { calls.push('lineTo'); },
    closePath: function () { calls.push('closePath'); },
    fill: function () { calls.push('fill'); },
    stroke: function () { calls.push('stroke'); },
    arc: function () { calls.push('arc'); },
    scale: function () { calls.push('scale'); },
    createLinearGradient: function () { calls.push('createLinearGradient'); return grad; }
  };
  const node = { width: 0, height: 0, getContext: function () { return ctx; } };
  C.wxMock.getWindowInfo = function () { return { windowWidth: 390, pixelRatio: 3 }; };
  C.wxMock.createSelectorQuery = function () {
    return {
      select: function () { return this; },
      fields: function () { return this; },
      exec: function (cb) { cb([{ node: node, width: 300, height: 160 }]); }
    };
  };
  return { calls: calls, node: node, gradStops: gradStops, ctx: ctx };
}

function run(test) {
  const prevWx = global.wx;
  const C = createCtx();
  global.wx = C.wxMock;
  const prevGetCurrentPages = global.getCurrentPages;
  // task-28 测试隔离：页面的 setTimeout（auto-retry 650ms / draw-retry 180ms / measure 400ms）
  // 可能在下一个用例才触发，把旧页数据画进新 canvas mock 或额外发 history 请求。
  // 每个用例结束统一清掉本用例注册、尚未触发的定时器（不改变产品代码）。
  const rawSetTimeout = global.setTimeout;
  const rawClearTimeout = global.clearTimeout;
  const rawTest = test;
  test = async function (name, fn) {
    const ids = new Set();
    global.setTimeout = function (cb, ms) {
      const args = Array.prototype.slice.call(arguments, 2);
      const id = rawSetTimeout(function () { ids.delete(id); if (typeof cb === 'function') cb.apply(null, args); }, ms);
      ids.add(id);
      return id;
    };
    global.clearTimeout = function (id) { ids.delete(id); rawClearTimeout(id); };
    try {
      return await rawTest(name, fn);
    } finally {
      ids.forEach(function (id) { rawClearTimeout(id); });
      ids.clear();
      global.setTimeout = rawSetTimeout;
      global.clearTimeout = rawClearTimeout;
    }
  };

  return (async function () {
    /* ============================================================
       A. utils/power.js 纯逻辑（房间目录 / 状态 / 估算 / 趋势 / 选择器）
       ============================================================ */
    await test('power：17 间宿舍目录与网站 PW_ROOMS 一致（13号楼2 / 16号楼2 / 23A 9 / 23B 4）', function () {
      purge();
      const pw = R('utils/power.js');
      assert.strictEqual(pw.ROOMS.length, 17);
      const byB = { '13号楼': 0, '16号楼': 0, '23号楼A座': 0, '23号楼B座': 0 };
      pw.ROOMS.forEach(function (r) { byB[r.building] += 1; });
      assert.deepStrictEqual(byB, { '13号楼': 2, '16号楼': 2, '23号楼A座': 9, '23号楼B座': 4 });
      assert.deepStrictEqual(pw.BLDS, ['13号楼', '16号楼', '23号楼A座', '23号楼B座']);
      assert.deepStrictEqual(pw.ROOMS.map(function (r) { return r.rv; }), [
        '1-13---324', '1-13---308', '1-16---305', '1-16---306',
        '4-23A---321', '4-23A---323', '4-23A---324', '4-23A---325', '4-23A---326', '4-23A---327', '4-23A---328', '4-23A---329', '4-23A---330',
        '4-23B---422', '4-23B---423', '4-23B---424', '4-23B---425'
      ]);
      assert.strictEqual(pw.catOf('4-23A---321').label, '23号楼A座321');
      assert.strictEqual(pw.normalizeSel('4-23A---321'), '4-23A---321');
      assert.strictEqual(pw.normalizeSel('bogus'), '', '非法 roomverify 应降级为空（不请求/不展示）');
      assert.strictEqual(pw.normalizeSel(''), '');
      // 自定义 bottom-sheet 纯数据：楼栋→房间列表（2/2/9/4）、rvOf、labelOf、buildingOf
      assert.strictEqual(pw.roomsOfBuilding('13号楼').length, 2);
      assert.deepStrictEqual(pw.roomsOfBuilding('13号楼').map(function (r) { return r.room; }), ['324', '308']);
      assert.strictEqual(pw.roomsOfBuilding('16号楼').length, 2);
      assert.strictEqual(pw.roomsOfBuilding('23号楼A座').length, 9);
      assert.deepStrictEqual(pw.roomsOfBuilding('23号楼B座').map(function (r) { return r.room; }), ['422', '423', '424', '425']);
      const totalRooms = pw.BLDS.reduce(function (n, b) { return n + pw.roomsOfBuilding(b).length; }, 0);
      assert.strictEqual(totalRooms, 17, '弹层四栋楼房间总数 = 17');
      assert.strictEqual(pw.rvOf('13号楼', '324'), '1-13---324');
      assert.strictEqual(pw.rvOf('23号楼B座', '425'), '4-23B---425');
      assert.strictEqual(pw.rvOf('23号楼B座', '999'), '', '不存在的房间 → 空');
      assert.strictEqual(pw.labelOf('4-23A---329'), '23号楼A座329');
      assert.strictEqual(pw.labelOf('bogus'), '');
      assert.strictEqual(pw.buildingOf('4-23A---329'), '23号楼A座');
      // 旧 multiSelector 逻辑必须已删除（用户真机异常的根因）
      assert.strictEqual(pw.pickerOf, undefined, 'pickerOf 已移除（不再使用原生 multiSelector）');
      assert.strictEqual(pw.rvFromPicker, undefined);
      assert.strictEqual(pw.pickerText, undefined);
    });

    await test('power v5：低电阈值档位/归一（无 70/90）与状态判定（q<low 低电 / low≤q<2low 偏低 / 其余充足）', function () {
      purge();
      const pw = R('utils/power.js');
      assert.deepStrictEqual(pw.LOW_OPTIONS, [10, 20, 30, 40, 50, 60, 80, 100], '档位与网站一致（无 70/90）');
      assert.strictEqual(pw.normLow(30), 30);
      assert.strictEqual(pw.normLow(50), 50);
      assert.strictEqual(pw.normLow(45), 50);
      assert.strictEqual(pw.normLow(70), 60, '70 不在档位 → 就近合法档位');
      assert.strictEqual(pw.normLow(90), 80, '90 不在档位 → 就近合法档位');
      assert.strictEqual(pw.normLow(999), 30);
      assert.strictEqual(pw.normLow(0), 30);
      assert.strictEqual(pw.normLow('abc'), 30);
      const mk = function (q) { return pw.normalizeRow({ id: 'x', quantity: q, unit: '度', updated_at: '2026-11-05T22:04:00+08:00' }); };
      // low=30 边界
      assert.strictEqual(pw.stateOf(mk(29.99), 30), 'low');
      assert.strictEqual(pw.stateOf(mk(30), 30), 'warn', 'q=low → 偏低');
      assert.strictEqual(pw.stateOf(mk(59.99), 30), 'warn');
      assert.strictEqual(pw.stateOf(mk(60), 30), 'ok', 'q=2*low → 充足');
      assert.strictEqual(pw.stateOf(mk(382.02), 30), 'ok');
      // low=50 边界
      assert.strictEqual(pw.stateOf(mk(49.99), 50), 'low');
      assert.strictEqual(pw.stateOf(mk(50), 50), 'warn');
      assert.strictEqual(pw.stateOf(mk(99.99), 50), 'warn');
      assert.strictEqual(pw.stateOf(mk(100), 50), 'ok');
      // low=10
      assert.strictEqual(pw.stateOf(mk(9.99), 10), 'low');
      assert.strictEqual(pw.stateOf(mk(10), 10), 'warn');
      assert.strictEqual(pw.stateOf(mk(20), 10), 'ok');
      assert.strictEqual(pw.stateOf(null, 30), 'idle');
      assert.strictEqual(pw.stateText('ok'), '充足');
      // 低电条仅 q<low
      assert.strictEqual(pw.lowOn(mk(28), 30), true);
      assert.strictEqual(pw.lowOn(mk(30), 30), false);
      assert.strictEqual(pw.lowOn(mk(40), 30), false);
      assert.strictEqual(pw.lowOn(mk(45), 50), true);
      // 其他格式函数回归
      assert.strictEqual(pw.fmtQ(382.02), '382.02');
      assert.strictEqual(pw.fmtMain(382.02), '382');
      assert.strictEqual(pw.fmtMain(99.99), '100.0');
      assert.strictEqual(pw.fmtMain(100), '100');
      assert.strictEqual(pw.fmtDrop(40), '40.00');
      assert.strictEqual(pw.updText('2026-11-05T22:04:00+08:00'), '11-05 22:04');
    });

    await test('power v5：rateFrom 4 组 fixture（混合/充值跳变跳过/持平/两点）+ estimate 混合与下限', function () {
      purge();
      const pw = R('utils/power.js');
      const mkPts = function (qs, stepH) {
        const t0 = Date.parse('2026-11-01T00:00:00+08:00');
        return qs.map(function (q, i) { return { q: q, t: t0 + i * stepH * 3600e3 }; });
      };
      // a) 正常用电：100→90→80→70（每小时）→ used30 hours3 rate240 span3 n4
      const rA = pw.rateFrom(mkPts([100, 90, 80, 70], 1));
      assert.strictEqual(rA.used, 30);
      assert.strictEqual(rA.hours, 3);
      assert.strictEqual(rA.rate, 240);
      assert.strictEqual(rA.span, 3);
      assert.strictEqual(rA.n, 4);
      assert.strictEqual(rA.recharge, false);
      // b) 充值跳变跳过：100→90→150→140→130；+60 段不计用电也不计时长
      const rB = pw.rateFrom(mkPts([100, 90, 150, 140, 130], 1));
      assert.strictEqual(rB.used, 30, '充值跳变段不计入 used');
      assert.strictEqual(rB.hours, 3, '充值跳变段不计入 hours');
      assert.strictEqual(rB.rate, 240);
      assert.strictEqual(rB.recharge, true);
      // c) 持平：只计时长、0 用电 → rate 0
      const rC = pw.rateFrom(mkPts([100, 100, 100, 100], 1));
      assert.strictEqual(rC.used, 0);
      assert.strictEqual(rC.hours, 3);
      assert.strictEqual(rC.rate, 0);
      assert.strictEqual(rC.recharge, false);
      // d) 两点
      const rD = pw.rateFrom(mkPts([100, 90], 1));
      assert.strictEqual(rD.used, 10);
      assert.strictEqual(rD.hours, 1);
      assert.strictEqual(rD.rate, 240);
      assert.strictEqual(rD.span, 1);
      assert.strictEqual(rD.n, 2);
      // 空/单点 → rate null
      assert.strictEqual(pw.rateFrom([]).rate, null);
      assert.strictEqual(pw.rateFrom(mkPts([100], 1)).rate, null);
      // estimate：两档有效 → 0.65*r24 + 0.35*r7
      const p24 = mkPts([124, 100], 24);      // used24 / 24h → rate 24
      const p7 = mkPts([107, 100], 168);      // used7 / 168h → rate 1
      const row = pw.normalizeRow({ id: 'x', quantity: 100, unit: '度', updated_at: '2026-11-05T22:04:00+08:00' });
      const eBoth = pw.estimate(p24, p7, row);
      assert.strictEqual(eBoth.v24, true);
      assert.strictEqual(eBoth.v7, true);
      assert.ok(Math.abs(eBoth.rate - (0.65 * 24 + 0.35 * 1)) < 1e-9, 'rate = 0.65*r24 + 0.35*r7');
      assert.ok(Math.abs(eBoth.days - 100 / (0.65 * 24 + 0.35)) < 1e-9);
      // 只有 24h 有效（7d <2 点）
      const e24 = pw.estimate(p24, mkPts([100], 168), row);
      assert.strictEqual(e24.v24, true);
      assert.strictEqual(e24.v7, false);
      assert.strictEqual(e24.rate, 24);
      assert.strictEqual(e24.days, 100 / 24);
      // 只有 7d 有效（24h span<6）
      const e7 = pw.estimate(mkPts([100, 90], 1), p7, row);
      assert.strictEqual(e7.v24, false);
      assert.strictEqual(e7.v7, true);
      assert.strictEqual(e7.rate, 1);
      assert.strictEqual(e7.days, 100);
      // 规格 §1.4（v13）：两档窗口真实用电均为 0 → 不再用 0.05 度/天下限伪造「≥30 天」，改「数据积累中」
      const eFlat = pw.estimate(mkPts([100, 100], 24), mkPts([100, 100], 168), row);
      assert.strictEqual(eFlat.v24, false, '24h 窗口 used=0 → 该档无效');
      assert.strictEqual(eFlat.v7, false, '7d 窗口 used=0 → 该档无效');
      assert.strictEqual(eFlat.rate, null, '两档都无效 → 不再用 0.05 下限');
      assert.strictEqual(eFlat.valid, false);
      assert.strictEqual(eFlat.days, null);
      assert.strictEqual(pw.daysMain(eFlat), '—');
      assert.strictEqual(pw.daysText(eFlat), '数据积累中');
      assert.strictEqual(pw.ringArc(row, eFlat), 0.04, '无效估算 → 小段兜底弧');
      // 0.05 下限只作用于「有效」结果（真实用电 >0.05 度但摊到超长窗口 → rate 极小）
      const eFloor = pw.estimate(mkPts([100.06, 100], 720), mkPts([100.06, 100], 720), row);
      assert.strictEqual(eFloor.v24, true, 'used>0.05 → 档有效');
      assert.strictEqual(eFloor.rate, 0.05, '有效结果才应用 0.05 下限');
      assert.strictEqual(eFloor.days, 2000);
      // 无有效档（单点）→ null / invalid / 数据积累中
      const eNone = pw.estimate([], [], row);
      assert.strictEqual(eNone.valid, false);
      assert.strictEqual(eNone.rate, null);
      assert.strictEqual(eNone.days, null);
      assert.strictEqual(pw.daysMain(eNone), '—');
      assert.strictEqual(pw.daysText(eNone), '数据积累中');
      // daysMain 普通 1 位
      const e12 = pw.estimate(p24, mkPts([100], 168), pw.normalizeRow({ id: 'x', quantity: 300, unit: '度' }));
      assert.strictEqual(pw.daysMain(e12), '12.5');
      assert.strictEqual(pw.daysText(e12), '≈ 12.5 天');
    });

    await test('power v9：慢更新检测（24h 变化次数 ≤2）+ 正常/无变化/边界', function () {
      purge();
      const pw = R('utils/power.js');
      const t0 = Date.parse('2026-11-06T00:00:00+08:00');
      const mk = function (qs, stepH) {
        return qs.map(function (q, i) { return { q: q, t: t0 + i * stepH * 3600e3 }; });
      };
      // 正常阶梯（每次 -4）：10 次变化 → 不慢
      const normal = mk([100, 96, 92, 88, 84, 80, 76, 72, 68, 64, 60], 1);
      const n = pw.slowUpdate(normal);
      assert.strictEqual(n.changes, 10);
      assert.strictEqual(n.slow, false);
      assert.strictEqual(n.text, '');
      // 慢更新：24h 内仅 2 次变化；上次变化 = 最后变化的后一点
      const slowPts = mk([100, 100, 100, 99, 99, 99, 98, 98], 3);
      const s = pw.slowUpdate(slowPts);
      assert.strictEqual(s.changes, 2);
      assert.strictEqual(s.slow, true);
      assert.strictEqual(s.lastAt, slowPts[6].t);
      assert.strictEqual(s.text, '数据更新较慢 · 上次变化 ' + pw.updText(new Date(slowPts[6].t).toISOString()));
      // 无变化 → 数据未更新
      const flat = pw.slowUpdate(mk([50, 50, 50, 50], 1));
      assert.strictEqual(flat.changes, 0);
      assert.strictEqual(flat.slow, true);
      assert.strictEqual(flat.text, '数据未更新');
      // 3 次变化 → 不慢（阈值 ≤2）
      const three = pw.slowUpdate(mk([100, 99, 98, 97], 1));
      assert.strictEqual(three.changes, 3);
      assert.strictEqual(three.slow, false);
      // 边界：差 0.005 不算变化；0.0051 算
      const edge = pw.slowUpdate(mk([100, 99.995, 99.9899], 1));
      assert.strictEqual(edge.changes, 1, '|dq|>0.005 才计一次');
      // 数据不足：不标记慢
      assert.strictEqual(pw.slowUpdate([]).slow, false);
      assert.strictEqual(pw.slowUpdate(mk([100], 1)).slow, false);
      assert.strictEqual(pw.slowUpdate(mk([100], 1)).text, '');
      // v13（规格 §4）：慢更新检测补 lastChange（=最后一处真实变化采样时间）/ lastRecharge（最后上升事件）
      assert.strictEqual(s.lastChange, slowPts[6].t, 'lastChange 与 lastAt 同口径');
      assert.strictEqual(s.lastRecharge, null);
      const up = pw.slowUpdate(mk([100, 100, 100, 99.4], 1).map(function (p, i) { return i === 3 ? { q: 120, t: p.t } : p; }));
      assert.strictEqual(up.lastRecharge.reset, 120, '上升事件记 reset');
      assert.strictEqual(up.lastRecharge.t, up.lastChange);
    });

    /* ============================================================
       A2. v13（规格 power_cadence_spec.md）：13/16 号楼慢频（日更）口径
       ============================================================ */

    await test('power v13：slowStats S1–S5（13/16 号楼慢频）rate/days/ref/nSeg/lastChange/lastRecharge 与规格 §5 一致', function () {
      purge();
      const pw = R('utils/power.js');
      const now = Date.now();
      const mk = function (arr) {
        return pw.normalizeHistory(arr.map(function (p) { return { quantity: p[1], ts: new Date(now - p[0] * 3600e3).toISOString() }; }));
      };
      const row = function (q, id) {
        return pw.normalizeRow({ id: id || 'x', quantity: q, unit: '度', updated_at: new Date(now).toISOString() });
      };
      const within24 = function (pts) { const cut = now - 24 * 3600e3; return pts.filter(function (p) { return p.t >= cut; }); };
      // S1 13-324：(11.2h,100)(0.2h,88.75) → 1 段 11.25/11h → 单段按 EXPEXT_H=24 折算 11.25 度/天；ref=true
      const h1 = mk([[11.2, 100.00], [0.2, 88.75]]);
      const r1 = row(88.75, '1-13---324');
      const s1 = pw.estimateSlow(h1, r1);
      const st1 = pw.slowStats(h1, r1);
      assert.strictEqual(s1.slow, true);
      assert.strictEqual(st1.events, 2, 'events = 变化点个数（与 web 同字段语义）');
      assert.strictEqual(s1.nSeg, 1);
      assert.strictEqual(s1.rate, 11.25, 'S1 rate=11.25 度/天');
      assert.ok(Math.abs(s1.days - 88.75 / 11.25) < 1e-9);
      assert.strictEqual(pw.daysMain(s1), '7.9', 'S1 days=7.9');
      assert.strictEqual(pw.daysText(s1), '≈ 7.9 天');
      assert.strictEqual(s1.ref, true, 'S1 单段 → 参考');
      assert.strictEqual((pw.ringArc(r1, s1) * 100).toFixed(2), '26.30', 'S1 ring=26.3');
      assert.strictEqual(s1.changes, 1);
      assert.strictEqual(s1.lastChange, h1[1].t, 'lastChange = 最后一个真实变化点');
      assert.strictEqual(s1.lastRecharge, null);
      assert.strictEqual(pw.changesIn(within24(h1)), 1, 'S1 24h 变化 1 次');
      assert.strictEqual(pw.deriveRange(within24(h1), r1).drop, 11.25);
      assert.strictEqual(pw.noUpdateText('24h', within24(h1)), '', 'S1 24h 有变化 → 不显示无更新提示');
      // S2 16-305：(30.1h,50)(6.1h,38)(0.2h,38) → 1 段 12/24h → 12 度/天；24h 内无变化
      const h2 = mk([[30.1, 50.00], [6.1, 38.00], [0.2, 38.00]]);
      const r2 = row(38.00, '1-16---305');
      const s2 = pw.estimateSlow(h2, r2);
      const st2 = pw.slowStats(h2, r2);
      assert.strictEqual(s2.rate, 12);
      assert.ok(Math.abs(s2.days - 38 / 12) < 1e-9);
      assert.strictEqual(pw.daysMain(s2), '3.2', 'S2 days=3.2');
      assert.strictEqual(s2.ref, true);
      assert.strictEqual((pw.ringArc(r2, s2) * 100).toFixed(2), '10.56', 'S2 ring=10.6');
      assert.strictEqual(st2.events, 2, 'S2 最后一个 38→38 不构成变化点');
      assert.strictEqual(pw.changesIn(within24(h2)), 0, 'S2 24h 变化 0 次');
      assert.strictEqual(pw.noUpdateText('24h', within24(h2)), '近 24h 无更新');
      assert.strictEqual(pw.deriveRange(within24(h2), r2).drop, 0, 'S2 24h 无下降 → tile2「—」');
      // S3 13-308：(168,120)(96,101)(72,101)(48,89)(24,89)(6,83)(0.2,83) → 3 段 37/162h → 5.5 度/天；ref=false
      const h3 = mk([[168, 120], [96, 101], [72, 101], [48, 89], [24, 89], [6, 83], [0.2, 83]]);
      const r3 = row(83.00, '1-13---308');
      const s3 = pw.estimateSlow(h3, r3);
      const st3 = pw.slowStats(h3, r3);
      assert.strictEqual(s3.nSeg, 3);
      assert.ok(Math.abs(s3.rate - 37 / 162 * 24) < 1e-9);
      assert.strictEqual(pw.daysMain(s3), '15.1', 'S3 days=15.1');
      assert.strictEqual(s3.ref, false, 'S3 多段 → 不标参考');
      assert.strictEqual(st3.events, 4);
      assert.strictEqual(pw.deriveRange(within24(h3), r3).drop, 6, 'S3 24h drop=6.0');
      assert.strictEqual(pw.changesIn(within24(h3)), 1, 'S3 24h 变化 1 次');
      // S4 16-306：(48,90)(24,90)(6,120)(0.2,120) → 只有 1 次上升 → 0 有效段：数据积累中；lastRecharge=120（6h 前）
      const h4 = mk([[48, 90], [24, 90], [6, 120], [0.2, 120]]);
      const r4 = row(120.00, '1-16---306');
      const s4 = pw.estimateSlow(h4, r4);
      assert.strictEqual(s4.valid, false, 'S4 0 有效段 → 数据积累中');
      assert.strictEqual(s4.rate, null);
      assert.strictEqual(s4.days, null);
      assert.strictEqual(pw.daysMain(s4), '—');
      assert.strictEqual(pw.daysText(s4), '数据积累中');
      assert.strictEqual(pw.ringArc(r4, s4), 0.04);
      assert.ok(s4.lastRecharge && Math.abs(s4.lastRecharge.reset - 120) < 1e-9, 'S4 lastRecharge.reset=120');
      assert.ok(Math.abs(s4.lastRecharge.t - (now - 6 * 3600e3)) < 1e-6, 'S4 lastRecharge 在 6h 前');
      assert.strictEqual(s4.lastChange, h4[2].t, 'S4 上升也算变化点');
      assert.strictEqual(s4.changes, 1);
      // S5 16-306：(168,200)(120,194)(96,194)(72,188)(48,188)(24,182)(12,122)(0.2,122)
      //   段 6/48h×3 保留，60°/12h 判异常剔除 → 3.0 度/天、days=40.7（≥30）；30d 区间下降 18（异常段不计）
      const h5 = mk([[168, 200], [120, 194], [96, 194], [72, 188], [48, 188], [24, 182], [12, 122], [0.2, 122]]);
      const r5 = row(122.00, '1-16---306');
      const s5 = pw.estimateSlow(h5, r5);
      assert.strictEqual(s5.nSeg, 3, 'S5 异常大跌段（60°/12h）被剔除');
      assert.strictEqual(s5.rate, 3);
      assert.ok(Math.abs(s5.days - 122 / 3) < 1e-9);
      assert.strictEqual(pw.daysMain(s5), '≥30', 'S5 days=40.7 → 显示 ≥30');
      assert.strictEqual(s5.ref, false);
      const d30 = pw.deriveRange(h5, r5);
      assert.strictEqual(d30.drop, 18, 'S5 30d 区间下降 = 6+6+6=18（异常段被 deductOf 剔除）');
      assert.strictEqual(d30.deductN, 1);
    });

    await test('power v13：estimate §1.4 守卫（L2 无真实用电 → 数据积累中；L1 23A 保持现状）+ isSlowRoom 数据覆盖', function () {
      purge();
      const pw = R('utils/power.js');
      const now = Date.now();
      const mk = function (qs, stepH) {
        return qs.map(function (q, i) { return { q: q, t: now - (qs.length - 1 - i) * stepH * 3600e3 }; });
      };
      const norm = function (arr) { return pw.normalizeHistory(arr.map(function (p) { return { quantity: p.q, ts: new Date(p.t).toISOString() }; })); };
      // L2 4-23B---422（实时房）：(8h,100.02)(0.2h,100.00) 两档窗口均无 >0.05 下降 → 数据积累中（替代原「≥30 天」）
      const l2 = norm(mk([100.02, 100.00], 8));
      const row422 = pw.normalizeRow({ id: '4-23B---422', quantity: 100.00, unit: '度' });
      const eL2 = pw.estimate(l2, l2, row422);
      assert.strictEqual(eL2.v24, false, 'L2 24h used=0 → 无效');
      assert.strictEqual(eL2.v7, false);
      assert.strictEqual(eL2.valid, false, 'L2 新守卫 → 数据积累中');
      assert.strictEqual(eL2.rate, null);
      assert.strictEqual(eL2.days, null);
      assert.strictEqual(pw.daysMain(eL2), '—');
      assert.strictEqual(pw.daysText(eL2), '数据积累中');
      assert.strictEqual(pw.ringArc(row422, eL2), 0.04);
      // L1 4-23A---321（实时房，正常 24h/7d 阶梯）：口径/结果完全保持现状
      const h321 = pw.normalizeHistory(pwHist('4-23A---321'));
      const row321 = pw.normalizeRow(PW_ROWS['4-23A---321']);
      const eL1 = pw.estimate(h321, h321, row321);
      assert.strictEqual(eL1.valid, true, 'L1 保持现状（有效估算）');
      assert.ok(Math.abs(eL1.rate - 96) < 1e-9, 'L1 rate=used40/10h*24=96');
      assert.strictEqual(pw.daysMain(eL1), '4.0', 'L1 仍显示 ≈4.0 天（不是 ≥30）');
      assert.strictEqual(pw.deriveRange(h321, row321).drop, 40);
      // §1.1 changesIn / §1.3 isSlowRoom（楼栋 + 数据覆盖）
      assert.deepStrictEqual(pw.SLOW_BUILDINGS, ['13号楼', '16号楼']);
      assert.strictEqual(pw.CH, 0.005);
      assert.strictEqual(pw.MIN_SEG_H, 6);
      assert.strictEqual(pw.EXPECT_H, 24);
      assert.strictEqual(pw.isSlowBuilding('13号楼'), true);
      assert.strictEqual(pw.isSlowBuilding('16号楼'), true);
      assert.strictEqual(pw.isSlowBuilding('23号楼A座'), false);
      assert.strictEqual(pw.isSlowBuilding('23号楼B座'), false);
      assert.strictEqual(pw.isSlowBuilding(null), false);
      const slow24 = norm(mk([100, 100, 99.5, 99.5], 8));             // 1 次变化
      const fast24 = norm(mk([100, 96, 92, 88, 84, 80, 76], 4));       // 6 次变化（每小时 -4）
      assert.strictEqual(pw.changesIn(slow24), 1);
      assert.strictEqual(pw.changesIn(fast24), 6);
      assert.strictEqual(pw.isSlowRoom('1-13---324', slow24), true, '13 号楼 + 24h 低变化 → 慢频');
      assert.strictEqual(pw.isSlowRoom('1-16---306', slow24), true, '16 号楼同口径');
      assert.strictEqual(pw.isSlowRoom('4-23A---321', slow24), false, '23A 实时房不受慢频配置影响');
      assert.strictEqual(pw.isSlowRoom('4-23B---422', slow24), false);
      assert.strictEqual(pw.isSlowRoom('1-13---324', fast24), false, '数据覆盖：24h 变化 ≥6 → 自动降级实时口径');
      const five = norm(mk([100, 96, 92, 88, 84, 80], 4));             // 5 次变化 → 仍慢
      assert.strictEqual(pw.changesIn(five), 5);
      assert.strictEqual(pw.isSlowRoom('1-13---324', five), true, '边界：5 次仍慢频（阈值 6）');
      assert.strictEqual(pw.isSlowRoom('1-13---324', []), true, '无 24h 数据（首屏）仍按楼栋慢频');
      // §3 noUpdateText：所选区间无变化才提示
      assert.strictEqual(pw.noUpdateText('24h', slow24), '');
      assert.strictEqual(pw.noUpdateText('7d', []), '近 7 天无更新');
      assert.strictEqual(pw.noUpdateText('30d', []), '近 30 天无更新');
      assert.strictEqual(pw.noUpdateText('24h', []), '近 24h 无更新');
    });

    await test('power v13：tilesOf 慢频（tile1 参考按 est.ref / tile2 该区间无更新 / tile4 用 30d lastRecharge）+ 实时房规则不变', function () {
      purge();
      const pw = R('utils/power.js');
      const now = Date.now();
      const mk = function (arr) {
        return pw.normalizeHistory(arr.map(function (p) { return { quantity: p[1], ts: new Date(now - p[0] * 3600e3).toISOString() }; }));
      };
      const row = function (q, id) { return pw.normalizeRow({ id: id || 'x', quantity: q, unit: '度', updated_at: new Date(now).toISOString() }); };
      const m24 = pw.rangeMeta('24h'), m7 = pw.rangeMeta('7d'), m30 = pw.rangeMeta('30d');
      // S1 慢频单段 → tile1 参考（ref=true）；副标 rate；tile2 24h 有下降 → 值+无 sub
      const h1 = mk([[11.2, 100.00], [0.2, 88.75]]);
      const r1 = row(88.75);
      const e1 = pw.estimateSlow(h1, r1);
      const t1 = pw.tilesOf(r1, e1, pw.deriveRange(h1, r1), m24, 30, false);
      assert.strictEqual(t1.length, 4);
      assert.strictEqual(t1[0].label, '估算可用');
      assert.strictEqual(t1[0].value, '7.9');
      assert.strictEqual(t1[0].sub, '≈ 11.3 度/天');
      assert.strictEqual(t1[0].ref, true, '慢频单段 → 「参考」');
      assert.strictEqual(t1[1].value, '11.3');
      assert.strictEqual(t1[1].sub, '');
      assert.strictEqual(t1[3].value, '—');
      assert.strictEqual(t1[3].sub, '暂无记录');
      // S2 慢频：24h 无下降 → tile2「— / 该区间无更新」；7d 有下降 → 无 sub
      const h2 = mk([[30.1, 50.00], [6.1, 38.00], [0.2, 38.00]]);
      const r2 = row(38.00);
      const e2 = pw.estimateSlow(h2, r2);
      const cut24 = now - 24 * 3600e3;
      const h2_24 = h2.filter(function (p) { return p.t >= cut24; });
      const t2 = pw.tilesOf(r2, e2, pw.deriveRange(h2_24, r2), m24, 30, false);
      assert.strictEqual(t2[1].value, '—');
      assert.strictEqual(t2[1].sub, '该区间无更新', '慢频该区间无下降 → sub');
      assert.strictEqual(t2[0].ref, true);
      const t2b = pw.tilesOf(r2, e2, pw.deriveRange(h2, r2), m7, 30, false);
      assert.strictEqual(t2b[1].value, '12.0');
      assert.strictEqual(t2b[1].sub, '');
      // S3 慢频多段 → tile1 不标参考（ref=false）
      const h3 = mk([[168, 120], [96, 101], [72, 101], [48, 89], [24, 89], [6, 83], [0.2, 83]]);
      const r3 = row(83.00);
      const e3 = pw.estimateSlow(h3, r3);
      assert.strictEqual(pw.tilesOf(r3, e3, pw.deriveRange(h3, r3), m30, 30, false)[0].ref, false);
      // S4 无效但 lastRecharge → tile4 用 30d lastRecharge.delta（值 = +充值量，不是充值后余额），与区间无关
      const h4 = mk([[48, 90], [24, 90], [6, 120], [0.2, 120]]);
      const r4 = row(120.00);
      const e4 = pw.estimateSlow(h4, r4);
      const t4 = pw.tilesOf(r4, e4, pw.deriveRange(h4, r4), m24, 30, false);
      assert.strictEqual(t4[0].value, '—');
      assert.strictEqual(t4[0].ref, false, '无效估算 → 不标参考');
      assert.strictEqual(t4[3].value, '+30.00', 'tile4 = 30d lastRecharge.delta（充值量）');
      assert.strictEqual(t4[3].unit, '度');
      assert.strictEqual(t4[3].sub, pw.updText(new Date(e4.lastRecharge.t).toISOString()));
      const t4b = pw.tilesOf(r4, e4, pw.deriveRange(h4, r4), m30, 30, false);
      assert.strictEqual(t4b[3].value, '+30.00', '切 30d 档 tile4 不变');
      // 实时房：保持原有规则 —— tile1 参考=24h 慢更新标记 slowOn；tile2 不加 sub；tile4 用区间 lastUp
      const hLive = pw.normalizeHistory(pwHist('4-23A---321'));
      const rLive = pw.normalizeRow(PW_ROWS['4-23A---321']);
      const eLive = pw.estimate(hLive, hLive, rLive);
      const tLive = pw.tilesOf(rLive, eLive, pw.deriveRange(hLive, rLive), m24, 30, true);
      assert.strictEqual(tLive[0].ref, true, '实时房原规则：slowOn → 参考');
      assert.strictEqual(tLive[1].sub, '', '实时房 tile2 不加「无更新」sub');
      assert.strictEqual(tLive[3].value, '—');
      const tLive2 = pw.tilesOf(rLive, pw.estimate(hLive, hLive, rLive), pw.deriveRange(hLive, rLive), m24, 30, false);
      assert.strictEqual(tLive2[0].ref, false, '实时房无 slowOn → 不标参考');
      // 实时房有充值：tile4 用区间 lastUp.delta（不是 30d；est 非 slow）
      const t0 = now;
      const recHist = pw.normalizeHistory([
        { quantity: 100, ts: new Date(t0 - 9 * 3600e3).toISOString() },
        { quantity: 90, ts: new Date(t0 - 6 * 3600e3).toISOString() },
        { quantity: 95, ts: new Date(t0 - 3 * 3600e3).toISOString() },
        { quantity: 85, ts: new Date(t0).toISOString() }
      ]);
      const dRec = pw.deriveRange(recHist, rLive);
      const tRec = pw.tilesOf(rLive, eLive, dRec, m24, 30, false);
      assert.strictEqual(tRec[3].value, '+5.00', '值 = +充值量（不是充值后余额 95）');
      assert.strictEqual(tRec[3].sub, pw.updText(new Date(dRec.lastUp.t).toISOString()));
    });

    await test('power v13：阶梯线 stepSegments（先水平后垂直）/ 真实变化点 changeDots（≤60）/ 平线垂直居中（trendLine.flat）', function () {
      purge();
      const pw = R('utils/power.js');
      const now = Date.now();
      const mk = function (arr) {
        return pw.normalizeHistory(arr.map(function (p) { return { quantity: p[1], ts: new Date(now - p[0] * 3600e3).toISOString() }; }));
      };
      // 阶梯路径：两点 100→88.75 = 水平到末点时间 + 垂直跳变
      const tl1 = pw.trendLine(mk([[11.2, 100.00], [0.2, 88.75]]), 2);
      assert.strictEqual(tl1.flat, false);
      const path = pw.stepSegments(tl1.points);
      assert.deepStrictEqual(path.map(function (p) { return [p.x, p.y]; }), [[0, 0], [1, 0], [1, 1]], '阶梯线 = 先水平后垂直');
      const dots = pw.changeDots(tl1.points);
      assert.strictEqual(dots.length, 1, 'S1 24h 图 1 个真实变化点');
      assert.strictEqual(dots[0].x, 1);
      assert.strictEqual(dots[0].q, 88.75);
      // 平线（24h 内数值不变）→ flat=true，y 统一 0.5（垂直居中，不再贴底）
      const tlFlat = pw.trendLine(mk([[6.1, 38.00], [0.2, 38.00]]), 2);
      assert.strictEqual(tlFlat.flat, true);
      assert.deepStrictEqual(tlFlat.points.map(function (p) { return p.y; }), [0.5, 0.5]);
      assert.ok(Math.abs(tlFlat.hi - 38.05) < 1e-9, 'hi/lo 仍按 hi-lo<0.05 扩展（兼容旧契约）');
      assert.strictEqual(pw.changeDots(tlFlat.points).length, 0, '平线无变化点');
      assert.strictEqual(pw.stepSegments(tlFlat.points).length, 3);
      // 变化点上限 60（超出取最近 60）
      const many = [];
      for (let i = 0; i < 100; i++) many.push({ q: 300 - i, t: now - (100 - i) * 60e3 });
      const tlMany = pw.trendLine(many, 1000);
      const dm = pw.changeDots(tlMany.points);
      assert.strictEqual(dm.length, 60, '变化点 ≤60（取最近 60）');
      assert.strictEqual(dm[dm.length - 1].q, many[99].q);
      // 无降采样趋势（慢频用全采样）：点数 = 原始点数
      const raw = mk([[168, 120], [96, 101], [72, 101], [48, 89], [24, 89], [6, 83], [0.2, 83]]);
      const tlRaw = pw.trendLine(raw, Math.max(2, raw.length));
      assert.strictEqual(tlRaw.count, raw.length, '慢频不降采样（全部真实采样铺满）');
      // 非法入参安全
      assert.deepStrictEqual(pw.stepSegments([]), []);
      assert.deepStrictEqual(pw.changeDots(null), []);
      assert.deepStrictEqual(pw.stepSegments([{ x: 0, y: 0 }]).length, 1);
    });

    await test('power 布局契约：tiles 2×2 用 CSS Grid（真机 DPR 安全）+ 其它百分比布局无零余量', function () {
      purge();
      const css = src('pages/power/power.wxss');
      // tiles：必须 grid repeat(2, minmax(0,1fr))，tile width:auto/min-width:0；禁止零余量 50%-6rpx
      assert.ok(/\.pw-tiles \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*gap: 24rpx;/.test(css), 'tiles 必须 CSS Grid 两列（12vp=24rpx，不依赖百分比取整）');
      assert.ok(/\.pw-tile \{[^}]*width: auto;[^}]*min-width: 0;/.test(css), 'tile 宽 auto + min-width:0（grid 列内不被内容撑破）');
      assert.ok(!/calc\(50% - 6rpx\)/.test(css), '禁止零余量 50%-6rpx（真机会掉成一列）');
      assert.ok(!/\.pw-tile[^}]*width: calc\(50%/.test(css), 'tile 不再使用百分比宽度');
      // 其它 flex-wrap + 百分比布局审计：rooms/low 面板改 grid；无 33.333%-12rpx 这类临界值
      assert.ok(/\.pw-rooms \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/.test(css), '房间网格 3 列 grid');
      assert.ok(/@media \(max-width: 360px\) \{\s*\.pw-rooms \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/.test(css), '窄屏房间 2 列 grid');
      assert.ok(/\.pw-lowsel-g \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/.test(css), '阈值面板 4 列 grid');
      assert.ok(!/max-width: calc\(33\.333% - 12rpx\)/.test(css), '禁止 33.333%-12rpx 临界布局');
      // 数学余量：对 360/375/390/414 计算卡片内容宽，2 列 grid 每格 + gap 必须 ≤ 内容宽
      const widths = [360, 375, 390, 414];
      widths.forEach(function (w) {
        const rpx = w / 750;
        const inner = w - (32 * 2 + 32 * 2 + 2 * 2) * rpx;  // page pad + card pad + border
        const gap = 12 * rpx;
        const cell = (inner - gap) / 2;
        assert.ok(cell > 100, w + 'px tile 单格宽度应 >100px：' + cell);
        assert.ok(2 * cell + gap <= inner + 1e-6, w + 'px 2×2 不超内容宽');
      });
    });

    await test('stats 布局：范围 2 chip 等分、摘要 4 格（窄屏 2×2/宽屏 1×4）、趋势/堆叠/分布/账号明细不溢出', function () {
      purge();
      const wxml = src('pages/stats/stats.wxml');
      const wxss = src('pages/stats/stats.wxss');
      // 筛选：只剩范围 group（今天/近 7 天），不再有按账号/天/小时模式切换
      assert.ok(/class="st-filters[^"]*"/.test(wxml) && /st-fgroup--range/.test(wxml), '范围筛选 group');
      assert.ok(!/st-fgroup--mode/.test(wxml) && !/setMode/.test(wxml), '不再有模式切换');
      const rangeBlock = (wxml.match(/<view class="st-fgroup st-fgroup--range">([\s\S]*?)<\/view>/) || [])[1] || '';
      assert.strictEqual((rangeBlock.match(/cls="m3-chip st-chip/g) || []).length, 2, '范围组 2 个 chip');
      assert.ok(/\.st-fgroup \{[^}]*display: flex;[^}]*flex-wrap: nowrap;/.test(wxss), 'group 内不拆行');
      assert.ok(/\.st-fgroup--range \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(wxss), '范围组 2 等分 grid');
      assert.ok(/\.st-chip \{[^}]*flex: 1 1 0;[^}]*min-width: 0;[^}]*min-height: 80rpx;/.test(wxss), 'chip 等分 + ≥40px 触控');
      // 摘要 4 格：窄屏 2×2，宽屏 1×4
      assert.strictEqual((wxml.match(/class="st-sum__item"/g) || []).length, 4, '摘要 4 格');
      assert.ok(/\.st-sum \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(wxss), '摘要窄屏 2×2');
      assert.ok(/@media \(min-width: 700px\) \{\s*\.st-sum \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/.test(wxss), '摘要宽屏 1×4');
      // 趋势柱 / 登录端堆叠 + 图例 / 版本设备 / 账号明细可展开（WXML 只渲染）
      assert.ok(/wx:for="\{\{trend\}\}"/.test(wxml) && /st-tb__fill/.test(wxml), '趋势柱状图');
      assert.ok(/wx:for="\{\{clients\}\}"/.test(wxml) && /st-stack__seg/.test(wxml) && /st-leg__row/.test(wxml), '登录端堆叠 + 图例');
      assert.ok(/st-duo/.test(wxml) && /wx:for="\{\{versions\}\}"/.test(wxml) && /wx:for="\{\{devicesList\}\}"/.test(wxml), '版本/设备分布');
      assert.ok(/wx:for="\{\{accounts\}\}"/.test(wxml) && /expandedKey === item\.key/.test(wxml), '账号明细可展开');
      // 数学：360/390/414 下摘要两列、24 根小时柱都不溢出内容宽
      [360, 390, 414].forEach(function (w) {
        const rpx = w / 750;
        const content = w - 64 * rpx;                       // page 左右 32rpx
        const cell = (content - 16 * rpx) / 2;              // 2 列 + 16rpx gap
        assert.ok(cell > 120, w + 'px 摘要单格宽 >120px：' + cell);
        const bar = (content - 23 * 4 * rpx) / 24;          // 24 柱 + 23 个 4rpx gap
        assert.ok(bar > 6, w + 'px 24 小时柱宽 >6px：' + bar);
      });
    });

    await test('nt 附件 archive：真实 group JSON → 5 行清单/3 可预览/2 仅清单，内部预览走 writeDataUri+openDocument；普通 file 仍待获取', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const store = R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      const fixture = JSON.parse(JSON.stringify(require('./_nt_fixtures/nt_archive_group.json')));
      const plain = {
        id: 'g_plain_file', cat: '班级事务', title: '普通附件通知', summary: '', items: [
          { kind: 'file', name: '普通附件.zip', note: '' }
        ], group: '测试群', source: 'qq', ts: Date.now()
      };
      cloud.ntAutoPull = function () { return Promise.resolve([fixture, plain]); };
      cloud.marksPull = function () { return Promise.resolve(null); };
      let loading = '';
      let opened = null;
      const toast = [];
      C.wxMock.showLoading = function (o) { loading = o && o.title; };
      C.wxMock.hideLoading = function () { loading = ''; };
      C.wxMock.openDocument = function (o) { opened = o; if (o.success) o.success(); };
      C.wxMock.getFileSystemManager = function () {
        return { writeFile: function (o) { if (o.success) o.success({}); } };
      };
      const def = loadPage('nt/nt');
      const ctx = ctxOf(def, { _first: true });
      def.onLoad.call(ctx, {});
      def.onShow.call(ctx);
      await sleep(40);
      assert.ok(ctx._all && ctx._all.length >= 2, '应加载两组通知');
      const card = ctx.data.cards.concat(ctx.data.expiredCards || [], ctx.data.infoCards || [], ctx.data.longtermCards || []).filter(function (c) { return c.id === fixture.id; })[0];
      assert.ok(card, '通知卡应可见：' + JSON.stringify((ctx.data.cards || []).map(function (c) { return c.id; })));
      const it = card.items.filter(function (x) { return x.kind === 'file'; })[0];
      assert.ok(it, '应有附件 item');
      assert.strictEqual(it.archiveOk, true);
      assert.strictEqual(it.archiveCount, 5);
      assert.strictEqual(it.archiveFiles.length, 5, '压缩包内 5 个文件');
      assert.strictEqual(it.archiveFiles.filter(function (f) { return f.hasUrl; }).length, 3, '3 个可预览');
      assert.strictEqual(it.archiveFiles.filter(function (f) { return !f.hasUrl; }).length, 2, '2 个仅清单');
      assert.strictEqual(it.pending, false, 'zip 无 url 但 archiveOk → 不待获取');
      assert.ok(/压缩包 · 已识别 5 个文件/.test(it.meta), 'meta 保留压缩包文案：' + it.meta);
      assert.ok(it.archiveSummary && it.archiveSummary.length <= 120, 'summary 有长度上限');
      // 内部可预览文件：writeDataUri → openDocument(showMenu:true)
      def.previewArchiveFile.call(ctx, { currentTarget: { dataset: { gid: fixture.id, i: 0, ai: 0 } } });
      await sleep(30);
      assert.ok(opened && /nt_\d+_.*\.xlsx$/.test(opened.filePath), '应以 xlsx 临时文件打开：' + JSON.stringify(opened));
      assert.strictEqual(opened.showMenu, true, 'showMenu=true 以支持保存/转发');
      // 无 url 的第 4 个文件：仅提示，不打开
      opened = null;
      def.previewArchiveFile.call(ctx, { currentTarget: { dataset: { gid: fixture.id, i: 0, ai: 3 } } });
      await sleep(20);
      assert.strictEqual(opened, null, '仅清单文件不应打开');
      assert.ok(C.toastLog().indexOf('仅清单，无法预览') >= 0, '仅清单提示：' + JSON.stringify(C.toastLog()));
      // 普通 file（无 url 无 archive）仍 pending；fileTap 不静默
      const pcard = ctx.data.cards.concat(ctx.data.expiredCards || [], ctx.data.infoCards || [], ctx.data.longtermCards || []).filter(function (c) { return c.id === plain.id; })[0];
      const pit = pcard && pcard.items.filter(function (x) { return x.kind === 'file'; })[0];
      assert.ok(pit && pit.pending === true && pit.archiveOk === false, '普通 file 仍待获取');
      // 数据链：full fetch 查 select=*（含 body/archive），lite 仅签名；展开依赖 ntAutoPull 全量缓存
      const cloudSrc = src('utils/cloud.js');
      assert.ok(/var NT_FULL_Q = 'select=\*/.test(cloudSrc), 'NT_FULL_Q 含 select=*（body）');
      assert.ok(/'select=id,ts,hidden,edited_at/.test(cloudSrc), 'NT_LITE_Q 仅签名字段');
      assert.ok(/function ntFullFetch/.test(cloudSrc) && /function ntAutoPull/.test(cloudSrc), 'full fetch 链路存在');
    });

    await test('nt 附件 archive 自愈：缓存旧 body（无 archive）展开时按需 ntGroupFull 刷新并渲染 5 行', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      const fresh = JSON.parse(JSON.stringify(require('./_nt_fixtures/nt_archive_group.json')));
      const stale = JSON.parse(JSON.stringify(fresh));
      delete stale.items[0].archive;
      delete stale.items[0].archiveOk;
      stale.items[0].note = '压缩包';
      cloud.ntAutoPull = function () { return Promise.resolve([stale]); };
      cloud.marksPull = function () { return Promise.resolve(null); };
      let gidAsked = '';
      cloud.ntGroupFull = function (gid) { gidAsked = gid; return Promise.resolve(fresh); };
      const def = loadPage('nt/nt');
      const ctx = ctxOf(def, { _first: true });
      def.onLoad.call(ctx, {});
      def.onShow.call(ctx);
      await sleep(60);
      // 契约 2026-11-18 §2/§3：该通知无真实时间锚点但有 items 时间（旧缓存回退推算）→ 发布卡进主列表；
      // 默认「待处理」视图即展开 → 按需补完整 body（archive 自愈链不变）；「资料 / 无时间」栏 0 条。
      assert.strictEqual(gidAsked, 'g_qqfile_8b01d25799', '发布卡在主列表（默认待处理）展开即按需拉完整 body');
      assert.strictEqual(ctx.data.infoCount, 0, '发布卡不再进「资料 / 无时间」栏');
      ctx.data.filter = 'all';
      def.applyFilter.call(ctx);
      await sleep(60);
      assert.strictEqual(gidAsked, 'g_qqfile_8b01d25799', '全部视图仍按 gid 拉一次完整 body（不重复 dead loop）');
      const card = (ctx.data.cards || []).filter(function (c) { return c.id === fresh.id; })[0];
      assert.ok(card, '发布卡在主列表');
      assert.ok(/发布$/.test(card.statusLabel), '发布卡状态胶囊以「发布」结尾：' + card.statusLabel);
      const it = card && card.items.filter(function (x) { return x.kind === 'file'; })[0];
      assert.ok(it && it.archiveOk === true && it.archiveFiles.length === 5, '刷新后卡片应出现 archive 清单');
      assert.strictEqual(it.pending, false);
    });

    await test('安全审计：无 rich-text/innerHTML 注入面；data URI 10MB 上限 + 扩展名白名单；archive 文件名不参与临时文件路径；token 不落日志', function () {
      purge();
      const nt = src('pages/nt/nt.js');
      const allWxml = [];
      const pagesDir = path.join(ROOT, 'pages');
      fs.readdirSync(pagesDir).forEach(function (d) {
        const f = path.join(pagesDir, d, d + '.wxml');
        if (fs.existsSync(f)) allWxml.push(fs.readFileSync(f, 'utf8'));
      });
      assert.ok(allWxml.every(function (w) { return w.indexOf('<rich-text') < 0; }), '页面不使用 rich-text（云端文本全部走 text 自动转义）');
      const jsFiles = [];
      fs.readdirSync(pagesDir).forEach(function (d) {
        const f = path.join(pagesDir, d, d + '.js');
        if (fs.existsSync(f)) jsFiles.push(fs.readFileSync(f, 'utf8'));
      });
      const js = jsFiles.join('\n');
      assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(js), '页面无 innerHTML/document.write 注入点');
      assert.ok(!/eval\(|new Function\(/.test(js), '页面无 eval/new Function');
      assert.ok(/10 \* 1024 \* 1024/.test(nt) && /file-too-large/.test(nt), 'data URI 体积上限 10MB');
      assert.ok(/\\\.\(\[a-z0-9\]\{1,8\}\)\$/.test(nt), '临时文件扩展名限 1–8 位字母数字（不含路径分隔符）');
      assert.ok(/USER_DATA_PATH \+ '\/nt_'/.test(nt), '临时文件名固定前缀 + 随机，不拼接 archive 原始文件名');
      assert.ok(!/USER_DATA_PATH[\s\S]{0,120}(f\.name|it\.name|af\.name)/.test(nt), 'archive 文件名不参与临时文件路径');
      assert.ok(!/console\.(log|info|debug)\([^)]*(token|identity)/i.test(js), 'token/identity 不落 console 日志');
      assert.ok(/showMenu: true/.test(nt), '内部文件预览开放保存/转发菜单');
    });

    await test('power 页 v9：正常 history 不显示慢更新徽标/参考；慢 history 显示徽标 + tile「参考」', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      installPowerMock(C);
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      await def.pick.call(ctx, '4-23A---321');
      await sleep(30);
      assert.strictEqual(ctx.data.trend.slow, false, '正常阶梯 → 不显示慢更新徽标');
      assert.strictEqual(ctx.data.trend.slowText, '');
      assert.strictEqual(ctx.data.tiles[0].ref, false, '正常 → tile1 无「参考」');
      // 慢更新房间：24h 仅 2 次变化
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud2 = R('utils/cloud.js'); enableCloud(cloud2);
      const t0 = Date.now();
      const slowHist = [];
      for (let i = 0; i < 24; i++) {
        const q = i < 10 ? 400 : (i < 18 ? 390 : 380);
        slowHist.push({ quantity: q, ts: new Date(t0 - (23 - i) * 3600e3).toISOString() });
      }
      C.setReq(function (o) {
        const u = String(o.url || '');
        if (u.indexOf('/power_history?') >= 0) {
          const gm = u.match(/ts=gte\.([^&]+)/);
          const days = gm ? (Date.now() - Date.parse(decodeURIComponent(gm[1]))) / 86400e3 : 1;
          return o.success({ statusCode: 200, data: days >= 5 ? [] : slowHist });
        }
        if (u.indexOf('/power?') >= 0) return o.success({ statusCode: 200, data: [PW_ROWS['4-23A---321']] });
        return o.success({ statusCode: 200, data: [] });
      });
      const def2 = loadPage('power/power');
      const ctx2 = ctxOf(def2, { _first: true, _loading: false });
      def2.onLoad.call(ctx2, {});
      await def2.pick.call(ctx2, '4-23A---321');
      await sleep(30);
      assert.strictEqual(ctx2.data.trend.slow, true, '慢更新 → 显示徽标');
      assert.ok(/^数据更新较慢 · 上次变化 \d\d-\d\d \d\d:\d\d$/.test(ctx2.data.trend.slowText), ctx2.data.trend.slowText);
      assert.strictEqual(ctx2.data.tiles[0].ref, true, '慢更新 → 估算可用 tile 标「参考」');
      assert.strictEqual(ctx2.data.tiles[0].label, '估算可用');
      cloud2.udStop();
    });

    await test('power：趋势区间 RANGES 元数据（24h / 7天 / 30天）与网站 PW_RANGES 一致', function () {
      purge();
      const pw = R('utils/power.js');
      assert.deepStrictEqual(pw.RANGES.map(function (r) { return r.k; }), ['24h', '7d', '30d']);
      const m24 = pw.rangeMeta('24h');
      assert.strictEqual(m24.ms, 24 * 3600e3);
      assert.strictEqual(m24.title, '近 24h 趋势');
      assert.strictEqual(m24.tile, '近 24h 用电');
      assert.strictEqual(m24.dropLabel, '近 24h 下降');
      assert.strictEqual(m24.xN, 3);
      const m7 = pw.rangeMeta('7d');
      assert.strictEqual(m7.ms, 7 * 24 * 3600e3);
      assert.strictEqual(m7.title, '近 7 天趋势');
      assert.strictEqual(m7.tile, '近 7 天用电');
      assert.strictEqual(m7.dropLabel, '区间下降');
      assert.strictEqual(m7.xN, 4);
      const m30 = pw.rangeMeta('30d');
      assert.strictEqual(m30.ms, 30 * 24 * 3600e3);
      assert.strictEqual(m30.title, '近 30 天趋势');
      assert.strictEqual(m30.tile, '近 30 天用电');
      assert.strictEqual(m30.dropLabel, '区间下降');
      assert.strictEqual(m30.xN, 5);
      assert.strictEqual(pw.rangeMeta('bogus').k, '24h', '非法区间回退 24h');
      assert.strictEqual(pw.xLabel(Date.parse('2026-11-06T09:05:00+08:00'), '24h'), '09:05');
      assert.strictEqual(pw.xLabel(Date.parse('2026-11-06T09:05:00+08:00'), '7d'), '11-06');
      assert.strictEqual(pw.xLabel(Date.parse('2026-11-06T09:05:00+08:00'), '30d'), '11-06');
    });

    await test('power 增量 43：13/16 隐藏 24h 档 + 自然周期同期比较（窗口边界/取数窗口/覆盖不足降级）', function () {
      purge();
      const pw = R('utils/power.js');
      // 档位可见性：13/16 号楼隐藏 24h，23A/23B 保持三档
      assert.strictEqual(pw.showRange('13号楼', '24h'), false);
      assert.strictEqual(pw.showRange('16号楼', '24h'), false);
      assert.strictEqual(pw.showRange('23号楼A座', '24h'), true);
      assert.strictEqual(pw.showRange('23号楼B座', '24h'), true);
      assert.strictEqual(pw.showRange('13号楼', '7d'), true);
      assert.strictEqual(pw.showRange('16号楼', '30d'), true);
      assert.deepStrictEqual(pw.rangesOfBuilding('13号楼').map(function (r) { return r.k; }), ['7d', '30d']);
      assert.deepStrictEqual(pw.rangesOfBuilding('23号楼A座').map(function (r) { return r.k; }), ['24h', '7d', '30d']);
      assert.strictEqual(pw.normRangeForBuilding('16号楼', '24h'), '7d', '慢楼栋默认落 7 天');
      assert.strictEqual(pw.normRangeForBuilding('23号楼B座', '24h'), '24h');
      // 比较取数窗口：24h→7d、7d(实时)→14d、7d(慢频)→30d、30d→70d
      assert.strictEqual(pw.cmpSourceKey('24h'), '7d');
      assert.strictEqual(pw.cmpSourceKey('7d', false), '14d');
      assert.strictEqual(pw.cmpSourceKey('7d', true), '30d');
      assert.strictEqual(pw.cmpSourceKey('30d'), '70d');
      // 自然周期窗口（周三 2026-11-11 20:00 +08:00）
      const now = Date.parse('2026-11-11T20:00:00+08:00');
      const w24 = pw.naturalWindows('24h', now);
      assert.strictEqual(w24.cur[0], Date.parse('2026-11-11T00:00:00+08:00'));
      assert.strictEqual(w24.cur[1], now);
      assert.strictEqual(w24.prev[0], Date.parse('2026-11-10T00:00:00+08:00'));
      assert.strictEqual(w24.prev[1], Date.parse('2026-11-10T20:00:00+08:00'));
      const w7 = pw.naturalWindows('7d', now);
      assert.strictEqual(w7.cur[0], Date.parse('2026-11-09T00:00:00+08:00'), '本周一 00:00');
      assert.strictEqual(w7.prev[0], Date.parse('2026-11-02T00:00:00+08:00'), '上周一 00:00');
      assert.strictEqual(w7.prev[1], now - 7 * 86400e3, '上周同一时刻（上周三 20:00）');
      const w30 = pw.naturalWindows('30d', now);
      assert.strictEqual(w30.cur[0], Date.parse('2026-11-01T00:00:00+08:00'), '本月 1 日 00:00');
      assert.strictEqual(w30.prev[0], Date.parse('2026-10-01T00:00:00+08:00'), '上月 1 日');
      assert.strictEqual(w30.prev[1], Date.parse('2026-10-11T20:00:00+08:00'), '上月同日同时刻');
      // 构造按自然周期不同速率的 70 天历史（与网页 v2_power_trend_compare_check mock 同口径）
      const day = 86400e3;
      const today0 = Date.parse('2026-11-11T00:00:00+08:00');
      const week0 = Date.parse('2026-11-09T00:00:00+08:00');
      const month0 = Date.parse('2026-11-01T00:00:00+08:00');
      const pm0 = Date.parse('2026-10-01T00:00:00+08:00');
      function rateAt(t) {
        if (t >= today0) return 0.20;
        if (t >= today0 - day) return 0.10;
        if (t >= week0) return 0.15;
        if (t >= week0 - 7 * day) return 0.10;
        if (t >= month0) return 0.12;
        if (t >= pm0) return 0.08;
        return 0.10;
      }
      const hist = [];
      let q = 1000;
      for (let t = now - 70 * day; t <= now; t += 3600e3) {
        hist.push({ quantity: q, ts: new Date(t).toISOString() });
        q -= rateAt(t);
      }
      const pts = pw.normalizeHistory(hist);
      const cmp24 = pw.naturalCompare('24h', pts, now);
      assert.ok(cmp24 && Math.abs(cmp24.pct - 100) < 1, '24h 今日 0.20 vs 昨日 0.10 → +100%：' + JSON.stringify(cmp24));
      assert.strictEqual(cmp24.label, '较昨日同期');
      const cmp7 = pw.naturalCompare('7d', pts, now);
      assert.ok(cmp7 && cmp7.label === '较上周同期' && cmp7.pct > 0 && isFinite(cmp7.pct), '7d 有同期比较：' + JSON.stringify(cmp7));
      const cmp30 = pw.naturalCompare('30d', pts, now);
      assert.ok(cmp30 && cmp30.label === '较上月同期' && cmp30.pct > 0, '30d 有同期比较：' + JSON.stringify(cmp30));
      // 覆盖不足（只有 5 小时数据）→ 不硬凑上一周期
      const shortPts = pts.slice(-5);
      assert.strictEqual(pw.naturalCompare('24h', shortPts, now), null, '历史不足 → 不显示比较');
      assert.strictEqual(pw.naturalCompare('7d', shortPts, now), null);
      assert.strictEqual(pw.naturalCompare('30d', shortPts, now), null);
      // 区间用电 tile：同期比较作为**独立一行**（cmp 字段，2026-11-15 对齐网页 OPTIM V2 #5 / 安卓 v4.55）；
      // 副标 sub 只保留「该区间无更新」等原有语义（无比较/无下降时不显示）
      const row = pw.normalizeRow({ id: 'x', quantity: 90, unit: '度', updated_at: '2026-11-05T22:04:00+08:00' });
      const est = { valid: true, rate: 10, days: 9, ref: false, slow: false };
      const dR = { drop: 10, recharge: false, lastUp: null };
      const t7 = pw.tilesOf(row, est, dR, pw.rangeMeta('7d'), 30, false, { pct: 50, label: '较上周同期' });
      assert.strictEqual(t7[1].cmp, '较上周同期 +50%', '比较=独立 cmp 行');
      assert.strictEqual(t7[1].cmpUp, true, '用电变多 → up（暖沙）');
      assert.strictEqual(t7[1].sub, '', '比较不再拼进副标');
      const t24 = pw.tilesOf(row, est, dR, pw.rangeMeta('24h'), 30, false, { pct: -12.4, label: '较昨日同期' });
      assert.strictEqual(t24[1].cmp, '较昨日同期 -12%', '负数带符号 + 取整');
      assert.strictEqual(t24[1].cmpUp, false, '用电变少 → down（灰蓝）');
      assert.strictEqual(pw.tilesOf(row, est, dR, pw.rangeMeta('7d'), 30, false, null)[1].cmp, '', '无比较数据 → 不显示比较行');
      assert.strictEqual(pw.tilesOf(row, est, { drop: null, recharge: false, lastUp: null }, pw.rangeMeta('7d'), 30, false, { pct: 50, label: '较上周同期' })[1].cmp, '', '本区间无下降 → 不显示比较行');
    });

    await test('power：deriveRange（区间 drop/充值 lastUp）+ v5 estimate/tile1 副标/环/低电条/tile4', function () {
      purge();
      const pw = R('utils/power.js');
      const hist = pw.normalizeHistory(pwHist('4-23A---321'));
      assert.strictEqual(hist.length, 11);
      const row = pw.normalizeRow(PW_ROWS['4-23A---321']);
      const d = pw.deriveRange(hist, row);
      assert.strictEqual(d.n, 11);
      assert.strictEqual(d.start, 100);
      assert.strictEqual(d.end, 60);
      assert.strictEqual(d.drop, 40, '下降量 = 逐点下降累计（忽略充值上升）');
      assert.strictEqual(d.recharge, false);
      assert.strictEqual(d.lastUp, null);
      assert.ok(Math.abs(d.hours - 10) < 1e-6);
      assert.deepStrictEqual(pw.derive(row, hist), d, 'derive = deriveRange(hist,row) 兼容');
      // v5 estimate fixture：24h rate24 / 7d rate1 → 0.65*24+0.35*1=15.95；days=382.02/15.95
      const mkPts = function (qs, stepH) {
        const t0 = Date.parse('2026-11-01T00:00:00+08:00');
        return qs.map(function (q, i) { return { q: q, t: t0 + i * stepH * 3600e3 }; });
      };
      const est = pw.estimate(mkPts([124, 100], 24), mkPts([107, 100], 168), row);
      assert.strictEqual(est.valid, true);
      assert.ok(Math.abs(est.rate - 15.95) < 1e-9);
      const expDay = 382.02 / 15.95;
      // 4 tiles（v5）：估算可用（daysMain + ≈rate 度/天）/ 区间用电 / 低电阈值 / 下次充值
      const tiles = pw.tilesOf(row, est, d, pw.rangeMeta('24h'), 30);
      assert.strictEqual(tiles.length, 4);
      assert.deepStrictEqual(tiles.map(function (t) { return t.label; }), ['估算可用', '近 24h 用电', '低电阈值', '上次充值']);
      assert.strictEqual(tiles[0].value, pw.daysMain(est));
      assert.strictEqual(tiles[0].value, expDay.toFixed(1));
      assert.strictEqual(tiles[0].sub, '≈ 16.0 度/天', 'rate 1 位小数副标');
      assert.strictEqual(tiles[1].value, '40.0');
      assert.strictEqual(tiles[2].value, '30', '默认低电阈值 30');
      assert.strictEqual(pw.tilesOf(row, est, d, pw.rangeMeta('24h'), 50)[2].value, '50', 'tile 低电阈值随 low');
      assert.strictEqual(tiles[3].value, '—', '无充值记录 → —');
      assert.strictEqual(tiles[3].sub, '暂无记录');
      // 区间变化 → tile2 标题随 meta 变
      assert.strictEqual(pw.tilesOf(row, est, d, pw.rangeMeta('7d'), 30)[1].label, '近 7 天用电');
      assert.strictEqual(pw.tilesOf(row, est, d, pw.rangeMeta('30d'), 30)[1].label, '近 30 天用电');
      // 低电条文案用 estimate：剩 X 度 · 约 Y 天
      assert.strictEqual(pw.lowText(row, est), '剩 382.02 度 · 约 ' + expDay.toFixed(1) + ' 天');
      assert.strictEqual(pw.lowText(row, pw.estimate([], [], row)), '剩 382.02 度', '无估算 → 省略约 Y 天');
      // 电量环 = estimate.days / 30
      assert.ok(Math.abs(pw.ringArc(row, est) - expDay / 30) < 1e-9, 'arcs = est.days/30');
      assert.strictEqual(pw.ringArc(row, { valid: false }), 0.04);
      assert.strictEqual(pw.ringArc(null, est), 0);
      assert.strictEqual(pw.ringArc(row, { valid: true, days: 0.1 }), 0.02);
      assert.strictEqual(pw.ringArc(row, { valid: true, days: 999 }), 1);
      // recharge 语义：100→90→95→85（0/3/6/9h）→ drop=20、recharge=true、lastUp={t,reset:95,delta:5}
      const t0 = Date.now();
      const rechargeHist = pw.normalizeHistory([
        { quantity: 100, ts: new Date(t0 - 9 * 3600e3).toISOString() },
        { quantity: 90, ts: new Date(t0 - 6 * 3600e3).toISOString() },
        { quantity: 95, ts: new Date(t0 - 3 * 3600e3).toISOString() },
        { quantity: 85, ts: new Date(t0).toISOString() }
      ]);
      const dr = pw.deriveRange(rechargeHist, row);
      assert.strictEqual(dr.drop, 20);
      assert.strictEqual(dr.recharge, true);
      assert.strictEqual(dr.lastUp.reset, 95, 'lastUp.reset = 充值后电量');
      assert.strictEqual(dr.lastUp.delta, 5);
      assert.strictEqual(dr.lastUp.t, rechargeHist[2].t);
      const tilesR = pw.tilesOf(row, est, dr, pw.rangeMeta('24h'), 30);
      assert.strictEqual(tilesR[3].value, '+5.00', '上次充值显示充值量 delta（+2 位小数）');
      assert.strictEqual(tilesR[3].sub, pw.updText(new Date(dr.lastUp.t).toISOString()));
      // 默认 tiles（未选择）
      const emptyTiles = pw.tilesOf(null, null, null, pw.rangeMeta('24h'), 30);
      assert.strictEqual(emptyTiles.length, 4);
      assert.strictEqual(emptyTiles[0].value, '—');
      assert.strictEqual(emptyTiles[2].value, '30');
      assert.strictEqual(emptyTiles[3].sub, '暂无记录');
    });

    await test('power v14：lastRecharge 取最后一次上调（delta=充值量）+ tilesOf 跨区间值（切档不变 / 30d 缺失回退区间）', function () {
      purge();
      const pw = R('utils/power.js');
      const now = Date.now();
      const H = 3600e3, D = 24 * H;
      // 乱序输入 → normalizeHistory 按 t 升序；扫描相邻上升 Δq>0.05，取最后一次（+0.03 噪声不算）
      const hist = pw.normalizeHistory([
        { quantity: 60, ts: new Date(now - 20 * D).toISOString() },
        { quantity: 100, ts: new Date(now - 10 * D).toISOString() },   // +40（较早的充值）
        { quantity: 95, ts: new Date(now - 9 * D).toISOString() },
        { quantity: 95.03, ts: new Date(now - 8 * D).toISOString() },  // +0.03 ≤ 0.05 → 不算
        { quantity: 140, ts: new Date(now - 2 * D).toISOString() },    // +44.97 → 最后一次上调
        { quantity: 138, ts: new Date(now - 1 * D).toISOString() },
        { quantity: 137.5, ts: new Date(now - 0.5 * D).toISOString() }
      ]);
      const lr = pw.lastRecharge(hist);
      assert.ok(lr, 'lastRecharge 应返回最后一次上升');
      assert.strictEqual(lr.t, hist[4].t, 't = 最后一次上升的后一个采样');
      assert.strictEqual(lr.reset, 140, 'reset = 充值后余额（仅用于内部，不在 tile 值展示）');
      assert.strictEqual(lr.delta, 44.97, 'delta = round2(本次充值量)');
      // 空/无上升/仅 1 点 → null
      assert.strictEqual(pw.lastRecharge([]), null);
      assert.strictEqual(pw.lastRecharge(null), null);
      assert.strictEqual(pw.lastRecharge([{ q: 100, t: now }]), null);
      assert.strictEqual(pw.lastRecharge([{ q: 100, t: now - H }, { q: 99, t: now }]), null, '只降不升 → null');
      assert.strictEqual(pw.lastRecharge([{ q: 100, t: now - H }, { q: 100.04, t: now }]), null, 'Δq≤0.05（噪声）不算充值');
      assert.strictEqual(pw.lastRecharge([{ q: 101, t: now }, { q: 100, t: now - H }]).delta, 1, '乱序也按 t 排序');
      // tilesOf：优先用传入的跨区间 lastRecharge（值 = +delta，sub = 时间），切档不变
      const row = pw.normalizeRow({ id: '4-23A---321', quantity: 137.5, unit: '度', updated_at: new Date(now).toISOString() });
      const est = { valid: true, rate: 10, days: 13.75, ref: false, slow: false };
      const dR = { drop: 10, recharge: true, lastUp: { t: now - H, reset: 139, delta: 1.5 } };
      const t24 = pw.tilesOf(row, est, dR, pw.rangeMeta('24h'), 30, false, null, lr);
      assert.strictEqual(t24[3].value, '+44.97', '值 = +充值量（不是充值后余额 140）');
      assert.strictEqual(t24[3].unit, '度');
      assert.strictEqual(t24[3].sub, pw.updText(new Date(lr.t).toISOString()));
      assert.strictEqual(pw.tilesOf(row, est, dR, pw.rangeMeta('7d'), 30, false, null, lr)[3].value, '+44.97', '切 7d 不变');
      assert.strictEqual(pw.tilesOf(row, est, dR, pw.rangeMeta('30d'), 30, false, null, lr)[3].value, '+44.97', '切 30d 不变');
      // 缺失 30d（lastRecharge=null）→ 回退所选区间 lastUp.delta（向后兼容旧预览/测试）
      const fb = pw.tilesOf(row, est, dR, pw.rangeMeta('24h'), 30, false, null, null);
      assert.strictEqual(fb[3].value, '+1.50', '30d 缺失 → 回退区间 lastUp.delta');
      assert.strictEqual(fb[3].sub, pw.updText(new Date(dR.lastUp.t).toISOString()));
      // 传入项非法 delta（旧 slowUpdate 形状 {t,reset}）→ 无记录，绝不回显 reset/NaN
      const bad = pw.tilesOf(row, est, dR, pw.rangeMeta('24h'), 30, false, null, { t: now, reset: 200 });
      assert.strictEqual(bad[3].value, '—');
      assert.strictEqual(bad[3].sub, '暂无记录');
      assert.strictEqual(bad[3].unit, '');
      // 慢频房未传跨区间参数 → 回退 est.lastRecharge（delta 同样生效）
      const estSlow = { valid: false, rate: null, days: null, ref: false, slow: true, lastRecharge: { t: now - 2 * H, reset: 120, delta: 30 } };
      const tSlow = pw.tilesOf(row, estSlow, pw.deriveRange([], row), pw.rangeMeta('24h'), 30, false, null, null);
      assert.strictEqual(tSlow[3].value, '+30.00', '慢频房回退 est.lastRecharge.delta');
    });

    await test('power：trendLine 时间比例点位/≤240 降采样 + 区间点数上限 + xTicks 3/4/5 刻度（24h HH:MM、7d/30d MM-DD）', function () {
      purge();
      const pw = R('utils/power.js');
      const hist = pw.normalizeHistory(pwHist('4-23A---321'));
      const tl = pw.trendLine(hist);
      assert.strictEqual(tl.empty, false);
      assert.strictEqual(tl.count, 11);
      assert.strictEqual(tl.hi, 100);
      assert.strictEqual(tl.lo, 60);
      assert.strictEqual(tl.mid, 80);
      assert.strictEqual(tl.points[0].x, 0);
      assert.strictEqual(tl.points[0].y, 0, '最高点 → y=0（顶部）');
      assert.strictEqual(tl.points[10].x, 1);
      assert.strictEqual(tl.points[10].y, 1, '最低点 → y=1（底部）');
      tl.points.forEach(function (p) { assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1, '点位越界'); });
      // x 按时间比例（非等距索引）：第 2 点 t 间隔 1h/10h → x≈0.1
      assert.ok(Math.abs(tl.points[1].x - 0.1) < 1e-6, 'x 应按时间比例');
      // hi-lo<0.05 时扩展 0.05
      const tFlat = Date.now();
      const flatHist = pw.normalizeHistory([
        { quantity: 50, ts: new Date(tFlat - 3600e3).toISOString() },
        { quantity: 50, ts: new Date(tFlat).toISOString() }
      ]);
      assert.ok(Math.abs(pw.trendLine(flatHist).hi - 50.05) < 1e-9);
      // >240 点等距降采样（保留首末）；各区间上限 24h 240 / 7d 170 / 30d 240
      const many = [];
      for (let i = 0; i < 500; i++) many.push({ q: 200 - i * 0.1, t: tFlat - (500 - i) * 60000 });
      const tlMany = pw.trendLine(many);
      assert.strictEqual(tlMany.count, pw.TREND_MAX, '最多 ' + pw.TREND_MAX + ' 点');
      assert.strictEqual(pw.TREND_MAX, 240);
      assert.strictEqual(tlMany.points[0].q, 200);
      assert.strictEqual(tlMany.points[pw.TREND_MAX - 1].q, many[499].q);
      assert.strictEqual(tlMany.points[pw.TREND_MAX - 1].x, 1);
      assert.deepStrictEqual({ a: pw.trendLimit('24h'), b: pw.trendLimit('7d'), c: pw.trendLimit('30d') }, { a: 240, b: 170, c: 240 });
      assert.strictEqual(pw.trendLine(many, pw.trendLimit('7d')).count, 170, '7d 上限 170 点');
      // v4 内容宽：24h 铺满容器；7d/30d = max(容器, n*gap+16)
      assert.strictEqual(pw.chartWidth('24h', 300, 100), 300);
      assert.strictEqual(pw.chartWidth('7d', 300, 28), 464, '7d 28 点 * gap16 + 16 = 464');
      assert.strictEqual(pw.chartWidth('30d', 300, 120), 1096, '30d 120 点 * gap9 + 16 = 1096');
      assert.strictEqual(pw.chartWidth('7d', 500, 10), 500, '内容宽不足容器时铺满容器');
      // 数据不足 / 空 → 不画
      assert.strictEqual(pw.trendLine(hist.slice(0, 1)).empty, true);
      assert.strictEqual(pw.trendLine(hist.slice(0, 1)).note, '数据积累中');
      assert.strictEqual(pw.trendLine([]).empty, true);
      assert.strictEqual(pw.trendLine([]).note, '未选择宿舍');
      // xTicks：3/4/5 个，24h HH:MM、7d/30d MM-DD
      const t24 = pw.xTicks(tl.points, '24h');
      assert.strictEqual(t24.length, 3);
      t24.forEach(function (t) { assert.ok(/^\d\d:\d\d$/.test(t.label), '24h x 标签应为 HH:MM：' + t.label); });
      const hist7 = pw.normalizeHistory(Array.from({ length: 40 }, function (_, i) {
        return { quantity: 100 - i, ts: new Date(tFlat - (39 - i) * 6 * 3600e3).toISOString() };
      }));
      const tl7 = pw.trendLine(hist7);
      const x7 = pw.xTicks(tl7.points, '7d');
      assert.strictEqual(x7.length, 4);
      x7.forEach(function (t) { assert.ok(/^\d\d-\d\d$/.test(t.label), '7d x 标签应为 MM-DD：' + t.label); });
      const x30 = pw.xTicks(tl7.points, '30d');
      assert.strictEqual(x30.length, 5);
      x30.forEach(function (t) { assert.ok(/^\d\d-\d\d$/.test(t.label), '30d x 标签应为 MM-DD：' + t.label); });
      assert.deepStrictEqual(pw.xTicks([], '24h'), []);
      // v4 固定 x 轴覆盖层（可见窗口版）：横滑后刻度变化、数量不变、标签格式正确
      const vw = 300, fullW = 464;
      const t7init = pw.xticksWindow(tl7.points, '7d', vw, fullW, 0);
      assert.strictEqual(t7init.length, 4);
      t7init.forEach(function (t) {
        assert.ok(/^\d\d-\d\d$/.test(t.label), '7d 可见窗口刻度 MM-DD：' + t.label);
        assert.ok(t.left >= 4 && t.left <= vw - 4, 'left 应限制在可见窗口：' + t.left);
        assert.ok(t.shift === '0' || t.shift === '-50%' || t.shift === '-100%');
      });
      const t7scr = pw.xticksWindow(tl7.points, '7d', vw, fullW, 164);
      assert.strictEqual(t7scr.length, 4, '横滑后仍 4 个刻度');
      assert.notDeepStrictEqual(t7scr.map(function (t) { return t.label; }), t7init.map(function (t) { return t.label; }), '横滑后 x 标签应变化');
      const t24w = pw.xticksWindow(tl.points, '24h', vw, vw, 0);
      assert.strictEqual(t24w.length, 3);
      t24w.forEach(function (t) { assert.ok(/^\d\d:\d\d$/.test(t.label)); });
    });

    await test('power：trendLine 充值跳变折算（与网页同步：不再被 +30 度撑成平线）', function () {
      purge();
      const pw = R('utils/power.js');
      const t0 = Date.now() - 6 * 3600e3;
      // 6 个点：正常下降 → 充值 +29.2 度 → 继续下降
      const hist = pw.normalizeHistory([
        { quantity: 100.0, ts: new Date(t0).toISOString() },
        { quantity: 99.5, ts: new Date(t0 + 3600e3).toISOString() },
        { quantity: 98.8, ts: new Date(t0 + 2 * 3600e3).toISOString() },
        { quantity: 128.0, ts: new Date(t0 + 3 * 3600e3).toISOString() },   // 充值 +29.2
        { quantity: 127.2, ts: new Date(t0 + 4 * 3600e3).toISOString() },
        { quantity: 126.0, ts: new Date(t0 + 5 * 3600e3).toISOString() }
      ]);
      const tl = pw.trendLine(hist, 10);
      assert.strictEqual(tl.empty, false);
      assert.strictEqual(tl.recharge, true, '应识别充值跳变');
      assert.strictEqual(tl.rechargeMarks.length, 1, '1 个充值位置');
      assert.strictEqual(tl.rechargeMarks[0], 3);
      assert.ok(Math.abs(tl.rechargeTotal - 29.2) < 0.01, '充值累计约 29.2：' + tl.rechargeTotal);
      // 折算后范围 = 实际用电 3.2 度（原始 100→126 范围 26 度）
      assert.ok(tl.hi - tl.lo <= 3.5, '折算后 y 范围应按用电：' + (tl.hi - tl.lo));
      assert.ok(tl.hi - tl.lo >= 3.0);
      // points.q 保留真实剩余（游标/详情不被折算）
      assert.strictEqual(tl.points[3].q, 128);
      assert.strictEqual(tl.points[5].q, 126);
      // 折算值连续：充值后第一点 y 与充值前最后一点接近（不会出现大跳变）
      assert.ok(Math.abs(tl.points[3].y - tl.points[2].y) < 0.2, '充值处折算曲线应连续');
      // 无充值区间不标记（旧行为不变）
      const noRech = pw.trendLine(pw.normalizeHistory([
        { quantity: 100, ts: new Date(t0).toISOString() },
        { quantity: 90, ts: new Date(t0 + 3600e3).toISOString() }
      ]));
      assert.strictEqual(noRech.recharge, false);
      assert.deepStrictEqual(noRech.rechargeMarks, []);
    });

    /* ============================================================
       B. pages/power：未选择 0 请求；选择后单行 + history；低电；切换；TTL；失败；离线兜底
       ============================================================ */
    await test('power 页：未选择宿舍 → 0 个 power/power_history 请求（引导态）', function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const { cloud } = (function () { const store = R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud); return { store: store, cloud: cloud }; })();
      void cloud;
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      C.reqLog().length = 0;
      def.onLoad.call(ctx, {});
      def.onShow.call(ctx);
      assert.strictEqual(ctx.data.state, 'idle');
      assert.strictEqual(ctx.data.hasSel, false);
      assert.strictEqual(C.reqLog().length, 0, '未选择时不应有任何请求');
      assert.strictEqual(C.urlsOf('/power').length, 0);
    });

    await test('power 页：选择宿舍 → power(id=eq.rv) + power_history(24h/asc/limit500) 请求；仪表盘数值/状态/tiles/趋势', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      installPowerMock(C);
      global.wx = C.wxMock;   // 确保本用例的 mock 生效（避免 global.wx 被其他用例切换）
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      await def.pick.call(ctx, '4-23A---321');
      await sleep(20);
      const rowReq = C.urlsOf('/power?')[0];
      const histReq = C.urlsOf('/power_history?')[0];
      assert.ok(rowReq, '应请求 power 当前行');
      assert.ok(String(rowReq.url).indexOf('id=eq.4-23A---321') >= 0, 'power 按 id=eq.<roomverify>：' + rowReq.url);
      assert.ok(/select=id,label,building,room,quantity,unit,low,updated_at/.test(rowReq.url));
      assert.ok(histReq, '应请求 power_history');
      assert.ok(/select=ts,quantity/.test(histReq.url), 'history select=ts,quantity：' + histReq.url);
      assert.ok(/roomverify=eq\.4-23A---321/.test(histReq.url));
      assert.ok(/order=ts\.asc/.test(histReq.url));
      assert.ok(/ts=gte\./.test(histReq.url) && /limit=2000/.test(histReq.url), 'history 时间窗 + limit=2000');
      assert.strictEqual(ctx.data.state, 'ready');
      assert.strictEqual(ctx.data.qText, '382', '网站 fmtMain：≥100 取整');
      assert.strictEqual(ctx.data.stateKey, 'ok');
      assert.strictEqual(ctx.data.stateText, '充足');
      assert.strictEqual(ctx.data.room.label, '23号楼A座321');
      assert.strictEqual(ctx.data.lowOn, false);
      assert.strictEqual(ctx.data.tiles.length, 4);
      assert.deepStrictEqual(ctx.data.tiles.map(function (t) { return t.label; }), ['估算可用', '近 24h 用电', '低电阈值', '上次充值']);
      assert.strictEqual(ctx.data.tiles[2].value, '30');
      assert.strictEqual(ctx.data.tiles[3].value, '—', '无充值记录');
      assert.strictEqual(ctx.data.tiles[3].sub, '暂无记录');
      // 电量环 = 可用天数/30（网站 arcs），不是当前电量/400
      const expArc = Math.max(0.02, Math.min(1, (382.02 / 96) / 30));
      assert.ok(ctx.data.gaugeStyle.indexOf('conic-gradient(#4E9082 0% ' + (expArc * 100).toFixed(2) + '%') >= 0,
        '环比例应为 days/30：' + ctx.data.gaugeStyle);
      assert.strictEqual(ctx.data.trend.startText, '100.00');
      assert.strictEqual(ctx.data.trend.curText, '382.02');
      assert.strictEqual(ctx.data.trend.dropText, '40.00');
      assert.strictEqual(ctx.data.trend.title, '近 24h 趋势');
      assert.strictEqual(ctx.data.trend.dropLabel, '近 24h 下降');
      assert.strictEqual(ctx.data.trend.startLabel, '起点');
      assert.strictEqual(ctx.data.trend.recharge, false);
      // 折线：11 个点交给 canvas；y 轴 hi/中/lo 刻度（1 位小数）+ x 轴 3 个 HH:MM
      assert.ok(Array.isArray(ctx._linePoints) && ctx._linePoints.length === 11, '折线点应 11 个');
      assert.strictEqual(ctx.data.trend.hiText, '100.0');
      assert.strictEqual(ctx.data.trend.midText, '80.0');
      assert.strictEqual(ctx.data.trend.loText, '60.0');
      assert.strictEqual(ctx.data.trend.xTicks.length, 3);
      ctx.data.trend.xTicks.forEach(function (t) { assert.ok(/^\d\d:\d\d$/.test(t.label), 'x 标签 HH:MM：' + t.label); });
      // 低电条文案（未低电时也预置）：剩 X 度 [· 约 Y 天]
      assert.strictEqual(ctx.data.lowText, '剩 382.02 度 · 约 4.0 天');
      assert.ok(/更新 11-05/.test(ctx.data.updText), ctx.data.updText);
      // 选择进同步（UD power section）：本机 store 写入；at 有效
      const d = R('utils/store.js').get();
      assert.strictEqual(d.power.sel, '4-23A---321');
      assert.ok(d.power.at > 0);
      // 离线兜底键同步写入
      assert.strictEqual(C.mem['zq_power_sel_' + ID.sid], '4-23A---321');
    });

    await test('power 页：自定义 bottom-sheet（无 multiSelector）→ 选楼栋/房间立即选中并收起、取消 0 请求、切换', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      installPowerMock(C);
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      C.reqLog().length = 0;
      // 1) 打开弹层：默认楼栋/房间；此时 0 请求
      def.openSheet.call(ctx);
      assert.strictEqual(ctx.data.sheetOpen, true);
      assert.strictEqual(ctx.data.activeBuilding, '13号楼');
      assert.deepStrictEqual(ctx.data.buildingRooms.map(function (r) { return r.room; }), ['324', '308']);
      // 2) 换楼栋：房间网格切换（23A 9 间）
      def.pickBuilding.call(ctx, { currentTarget: { dataset: { b: '23号楼A座' } } });
      assert.strictEqual(ctx.data.activeBuilding, '23号楼A座');
      assert.strictEqual(ctx.data.buildingRooms.length, 9);
      assert.ok(ctx.data.buildingRooms.some(function (r) { return r.rv === '4-23A---321'; }));
      // 3) 取消（关闭/遮罩）→ 不选中、0 请求
      def.closeSheet.call(ctx);
      assert.strictEqual(ctx.data.sheetOpen, false);
      assert.strictEqual(ctx.data.hasSel, false);
      assert.strictEqual(C.reqLog().length, 0, '打开/切楼栋/取消阶段 0 请求');
      // 4) 点房间 = 立即选中并收起 + 只请求该房间
      def.openSheet.call(ctx);
      await def.pickRoom.call(ctx, { currentTarget: { dataset: { rv: '4-23A---321' } } });
      assert.strictEqual(ctx.data.sheetOpen, false, '点房间后立即收起');
      assert.strictEqual(ctx.data.sel, '4-23A---321');
      assert.strictEqual(ctx.data.hasSel, true);
      assert.strictEqual(ctx.data.selLabel, '23号楼A座321');
      assert.strictEqual(C.urlsOf('/power?').length, 1);
      assert.ok(String(C.urlsOf('/power?')[0].url).indexOf('id=eq.4-23A---321') >= 0);
      assert.strictEqual(C.urlsOf('/power_history?').length, 3, 'v14：选择后拉 24h+7d+30d history（30d 供上次充值跨区间）');
      // 5) 选中态高亮：再次打开时当前楼栋/房间选中
      def.openSheet.call(ctx);
      assert.strictEqual(ctx.data.sheetOpen, true);
      assert.strictEqual(ctx.data.activeBuilding, '23号楼A座');
      assert.strictEqual(ctx.data.selectedRv, '4-23A---321');
      // 6) 切换房间 → 只请求新房间，旧响应不覆盖
      C.reqLog().length = 0;
      await def.pickRoom.call(ctx, { currentTarget: { dataset: { rv: '4-23B---425' } } });
      assert.strictEqual(ctx.data.sel, '4-23B---425');
      assert.strictEqual(ctx.data.sheetOpen, false);
      assert.strictEqual(C.urlsOf('/power?').length, 1);
      assert.ok(String(C.urlsOf('/power?')[0].url).indexOf('id=eq.4-23B---425') >= 0, '只请求新房间');
      assert.strictEqual(C.urlsOf('/power_history?').length, 3, '新房间 24h+7d+30d 历史');
    });

    await test('power 页：趋势 canvas 2d 绘制（DPR 缩放/面积渐变/折线/2 网格/末点）与 <2 点不画', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      installPowerMock(C);
      const canvas = installCanvasMock(C);
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      await def.pick.call(ctx, '4-23A---321');
      await sleep(20);
      assert.strictEqual(ctx._canvasDrawn, true, '折线应已绘制');
      const calls = canvas.calls;
      ['clearRect', 'createLinearGradient', 'moveTo', 'lineTo', 'stroke', 'fill', 'arc'].forEach(function (k) {
        assert.ok(calls.indexOf(k) >= 0, 'canvas 应调用 ' + k);
      });
      assert.ok(calls.filter(function (c) { return c === 'stroke'; }).length >= 3, '折线+2 网格+末点至少 3 次 stroke');
      assert.strictEqual(canvas.node.width, 300 * 3, 'canvas.width = size.width * dpr');
      assert.strictEqual(canvas.node.height, 160 * 3);
      assert.ok(canvas.gradStops.length >= 2, '面积渐变至少 2 个色标');
      // <2 采样：显示「数据积累中」且不绘制
      cleanupPage(ctx);   // 先清首场景的 draw/auto-retry 定时器，避免旧页定时器把旧点画进新 canvas mock
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud2 = R('utils/cloud.js'); enableCloud(cloud2);
      C.setReq(function (o) {
        const u = String(o.url || '');
        if (u.indexOf('/power_history?') >= 0) return o.success({ statusCode: 200, data: [{ roomverify: '4-23A---321', quantity: 100, ts: new Date().toISOString() }] });
        if (u.indexOf('/power?') >= 0) return o.success({ statusCode: 200, data: [PW_ROWS['4-23A---321']] });
        return o.success({ statusCode: 200, data: [] });
      });
      const canvas2 = installCanvasMock(C);
      const def2 = loadPage('power/power');
      const ctx2 = ctxOf(def2, { _first: true, _loading: false });
      def2.onLoad.call(ctx2, {});
      await def2.pick.call(ctx2, '4-23A---321');
      await sleep(20);
      assert.strictEqual(ctx2.data.trend.empty, true);
      assert.strictEqual(ctx2.data.trend.note, '数据积累中');
      assert.strictEqual(ctx2._canvasDrawn, false, '<2 点不应绘制');
      assert.strictEqual(canvas2.calls.length, 0);
      // 2026-11-06 新增「24h 历史 <2 点自动静默重试一次」：本用例真实只有 1 点，页面会排队 1 次 650ms 重试；
      // 用例结束前清掉，避免该定时器在后续用例窗口内发请求、污染请求计数断言。
      if (ctx2._autoRetryT) { clearTimeout(ctx2._autoRetryT); ctx2._autoRetryT = null; }
      cleanupPage(ctx2);
    });

    await test('power 页：低电（<30 度）标红 + 提示条；切换宿舍只显示新宿舍；TTL 内不重复请求', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      installPowerMock(C);
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      await def.pick.call(ctx, '1-16---305');

      assert.strictEqual(ctx.data.stateKey, 'low');
      assert.strictEqual(ctx.data.stateText, '低电');
      assert.strictEqual(ctx.data.lowOn, true);
      assert.strictEqual(ctx.data.qText, '22.3', '网站 fmtMain：<100 保留 1 位小数');
      assert.strictEqual(ctx.data.lowText, '剩 22.25 度 · 约 0.2 天', '低电条：剩 X 度 · 约 Y 天');
      assert.strictEqual(ctx.data.trend.startText, '60.00');
      assert.strictEqual(ctx.data.trend.dropText, '40.00');
      // 切换宿舍（有 history 的房间）→ 显示新宿舍
      await def.pick.call(ctx, '4-23B---424');

      assert.strictEqual(ctx.data.room.label, '23号楼B座424');
      assert.strictEqual(ctx.data.qText, '18.5');
      assert.strictEqual(ctx.data.stateKey, 'low', '18.5 < 30 即使云端 low=false 也判低电');
      assert.strictEqual(ctx.data.lowText, '剩 18.50 度 · 约 0.2 天');
      assert.strictEqual(ctx.data.tiles[2].label, '低电阈值');
      assert.strictEqual(ctx.data.tiles[2].value, '30');
      assert.strictEqual(ctx.data.tiles[3].label, '上次充值');
      // TTL 2 分钟内再 load(false) 不重复请求（cloud 模块按 rv 缓存）
      C.reqLog().length = 0;
      await ctx.load.call(ctx, false);
      await sleep(20);
      assert.strictEqual(C.reqLog().length, 0, '2 分钟 TTL 内非 force 应 0 请求');
      // force 刷新必须重新请求（v14：行 + 24h + 7d + 30d 历史一起刷新）
      await ctx.load.call(ctx, true);
      await sleep(20);
      assert.strictEqual(C.urlsOf('/power?').length, 1);
      assert.strictEqual(C.urlsOf('/power_history?').length, 3);
    });

    await test('power 页：请求失败 → 无旧数据时错误态可重试；有旧数据时保留展示 + toast', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      installPowerMock(C);
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      def.pick.call(ctx, '4-23A---321');
      await sleep(30);
      assert.strictEqual(ctx.data.state, 'ready');
      // 后续刷新失败：应保留上次数据（ready）并 toast
      C.setReq(function (o) {
        if (String(o.url).indexOf('/power') >= 0) return o.fail({ errMsg: 'request:fail mock' });
        return o.success({ statusCode: 200, data: [] });
      });
      C.toastLog().length = 0;
      await ctx.load.call(ctx, true);
      await sleep(30);
      assert.strictEqual(ctx.data.state, 'ready', '有旧数据时刷新失败应保留展示');
      assert.ok(C.toastLog().some(function (t) { return /刷新失败/.test(t); }), '应提示刷新失败');
      // 无旧数据：新页面 + 失败 → error 态
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud2 = R('utils/cloud.js'); enableCloud(cloud2);
      C.setReq(function (o) { if (String(o.url).indexOf('/power') >= 0) return o.fail({ errMsg: 'request:fail mock' }); return o.success({ statusCode: 200, data: [] }); });
      const def2 = loadPage('power/power');
      const ctx2 = ctxOf(def2, { _first: true, _loading: false });
      def2.onLoad.call(ctx2, {});
      await def2.pick.call(ctx2, '1-13---324');
      await sleep(20);
      assert.strictEqual(ctx2.data.state, 'error');
      assert.ok(/重试/.test(ctx2.data.errorText));
    });

    await test('power 页：离线兜底 zq_power_sel_<sid> 恢复选择并入 UD；非法值降级为空且 0 请求', function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      const store = R('utils/store.js');
      C.mem['zq_power_sel_' + ID.sid] = '4-23B---425';
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      C.reqLog().length = 0;
      def.onLoad.call(ctx, {});
      assert.strictEqual(ctx.data.hasSel, true, '离线兜底选择应恢复');
      assert.strictEqual(ctx.data.sel, '4-23B---425');
      assert.strictEqual(store.get().power.sel, '4-23B---425', '兜底选择并入 store.power（随后走 UD 同步）');
      assert.strictEqual(C.reqLog().length, 0, '恢复选择本身不请求（由 onShow load 触发）');
      // 非法值：store 里塞脏值 + 兜底脏值 → 应降级未选择、0 请求
      store.get().power = { sel: 'not-a-room', at: 1 };
      C.mem['zq_power_sel_' + ID.sid] = 'also-bad';
      const ctx2 = ctxOf(def, { _first: true, _loading: false });
      C.reqLog().length = 0;
      def.onLoad.call(ctx2, {});
      assert.strictEqual(ctx2.data.hasSel, false);
      assert.strictEqual(ctx2.data.state, 'idle');
      assert.strictEqual(C.reqLog().length, 0);
    });

    await test('power 页：趋势区间 chips 24h→7天→30天（fetch 契约/5min 缓存/标题 tile 图例 x 刻度/本机记忆）', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      installPowerMock(C, true);   // task-28：按区间返回 24/56/120 个真实密度采样，覆盖 30d 全量压缩绘制
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      await def.pick.call(ctx, '4-23A---321');
      await sleep(20);
      assert.deepStrictEqual(ctx.data.ranges.map(function (r) { return r.label; }), ['24h', '7天', '30天']);
      assert.strictEqual(ctx.data.range, '24h');
      assert.strictEqual(ctx.data.rangeTitle, '近 24h 趋势');
      assert.strictEqual(ctx.data.rangeTile, '近 24h 用电');
      assert.strictEqual(ctx.data.trend.dropLabel, '近 24h 下降');
      assert.strictEqual(ctx.data.trend.startLabel, '起点');
      assert.strictEqual(ctx.data.trend.xTicks.length, 3);
      // v14：首次拉取必须同时有 24h + 7d（estimate 两档）+ 30d（上次充值跨区间）→ 3 个 history 请求
      const initHist = C.urlsOf('/power_history?');
      assert.strictEqual(initHist.length, 3, '首次拉取应同时请求 24h+7d+30d history');
      const initRows = C.urlsOf('/power?');
      assert.strictEqual(initRows.length, 1, '当前电量行 1 次');
      const parsed = initHist.map(function (r) {
        const u = String(r.url);
        const m = u.match(/ts=gte\.([^&]+)/);
        return { days: m ? (Date.now() - Date.parse(decodeURIComponent(m[1]))) / 86400e3 : 0, url: u };
      });
      parsed.forEach(function (p) {
        assert.ok(/select=ts,quantity/.test(p.url) && /limit=2000/.test(p.url), 'history fetch 契约：' + p.url);
      });
      assert.ok(parsed.some(function (p) { return Math.abs(p.days - 1) < 0.1; }), '应含 24h 时间窗');
      assert.ok(parsed.some(function (p) { return Math.abs(p.days - 7) < 0.1; }), '应含 7d 时间窗');
      assert.ok(parsed.some(function (p) { return Math.abs(p.days - 30) < 0.1; }), '应含 30d 时间窗');
      // 切 7 天：7d 已随首次拉取预取；增量 43 补拉 14 天比较窗口（自然周期同期）→ 1 请求
      C.reqLog().length = 0;
      def.pickRange.call(ctx, { currentTarget: { dataset: { k: '7d' } } });
      await sleep(60);
      assert.strictEqual(C.urlsOf('/power_history?').length, 1, '切 7d 仅补拉 14d 比较窗口');
      assert.ok(Math.abs(histWindows(C.urlsOf('/power_history?'))[0] - 14) < 0.2, '14d 比较窗口');
      assert.strictEqual(ctx.data.range, '7d');
      assert.strictEqual(ctx.data.rangeTitle, '近 7 天趋势');
      assert.strictEqual(ctx.data.rangeTile, '近 7 天用电');
      assert.strictEqual(ctx.data.trend.title, '近 7 天趋势');
      assert.strictEqual(ctx.data.trend.dropLabel, '区间下降');
      assert.strictEqual(ctx.data.trend.startLabel, '起');
      assert.strictEqual(ctx.data.trend.xTicks.length, 4);
      ctx.data.trend.xTicks.forEach(function (t) { assert.ok(/^\d\d-\d\d$/.test(t.label), '7d x 标签 MM-DD：' + t.label); });
      // 切 30 天：30d 已随初始拉取缓存 → 仅补 70d 比较窗口（1 请求）
      C.reqLog().length = 0;
      def.pickRange.call(ctx, { currentTarget: { dataset: { k: '30d' } } });
      await sleep(80);
      assert.strictEqual(C.urlsOf('/power_history?').length, 1, '切 30d 仅补拉 70d 比较窗口（30d 已缓存）');
      const wins30 = histWindows(C.urlsOf('/power_history?')).sort(function (a, b) { return a - b; });
      assert.ok(!wins30.some(function (w) { return Math.abs(w - 30) < 0.2; }), '30d 已缓存 → 不重复请求：' + JSON.stringify(wins30));
      assert.ok(wins30.some(function (w) { return Math.abs(w - 70) < 0.2; }), '70d 比较窗口：' + JSON.stringify(wins30));
      assert.strictEqual(ctx.data.rangeTitle, '近 30 天趋势');
      assert.strictEqual(ctx.data.rangeTile, '近 30 天用电');
      assert.strictEqual(ctx.data.trend.xTicks.length, 5);
      ctx.data.trend.xTicks.forEach(function (t) { assert.ok(/^\d\d-\d\d$/.test(t.label), '30d x 标签 MM-DD：' + t.label); });
      // 切回 24h：本区间与 24h 缓存都在 5min 内 → 0 请求
      C.reqLog().length = 0;
      def.pickRange.call(ctx, { currentTarget: { dataset: { k: '24h' } } });
      await sleep(40);
      assert.strictEqual(C.reqLog().length, 0, '切回 24h 缓存新鲜 → 0 请求');
      assert.strictEqual(ctx.data.rangeTitle, '近 24h 趋势');
      assert.strictEqual(ctx.data.trend.xTicks.length, 3);
      // 区间只记本机，不进 UD power section
      assert.strictEqual(C.mem['zq_power_range_v1'], '24h', '区间记本机 zq_power_range_v1');
      const privacy = R('utils/privacy.js');
      assert.strictEqual(privacy.SECTION_KEYS.indexOf('range'), -1, '区间不进 UD 同步');
      assert.deepStrictEqual(Object.keys(R('utils/store.js').get().power).sort(), ['at', 'low', 'sel']);
      cleanupPage(ctx);   // 清 30d 全量采样后的 draw/auto-retry 定时器，避免污染后续用例
    });

    /* ============================================================
       B2. v13（规格 power_cadence_spec.md §2/§3）：13/16 号楼慢频页口径 + 23A/B 保持现状
       ============================================================ */
    // 慢频页 mock：history 按 ts=gte 窗口过滤返回（30d/7d/24h 同源，模拟真实采样点稀疏的日更数据）
    function installSlowMock(C, row, pts, opts) {
      const o = opts || {};
      const now0 = Date.now();
      C.setReq(function (o1) {
        const u = String(o1.url || '');
        if (u.indexOf('/power_history?') >= 0) {
          const m = u.match(/ts=gte\.([^&]+)/);
          const days = m ? (now0 - Date.parse(decodeURIComponent(m[1]))) / 86400e3 : 1;
          if (o.fail30 && days >= 25) return o1.fail({ errMsg: 'request:fail mock 30d' });
          const cut = now0 - days * 86400e3;
          const list = (o.histByDays ? o.histByDays(days) : pts).filter(function (p) { return p.t >= cut; });
          return o1.success({ statusCode: 200, data: list.map(function (p) { return { quantity: p.q, ts: new Date(p.t).toISOString() }; }) });
        }
        if (u.indexOf('/power?') >= 0) return o1.success({ statusCode: 200, data: [row] });
        return o1.success({ statusCode: 200, data: [] });
      });
    }
    function histWindows(reqs) {
      return reqs.map(function (r) {
        const u = String(r.url);
        const m = u.match(/ts=gte\.([^&]+)/);
        return m ? Math.round((Date.now() - Date.parse(decodeURIComponent(m[1]))) / 86400e3) : 0;
      });
    }
    function canvasTexts(C) {
      const texts = [];
      const canvas = installCanvasMock(C);
      canvas.ctx.fillText = function (t) { texts.push(String(t)); canvas.calls.push('fillText'); };
      return { texts: texts, calls: canvas.calls, ctx: canvas.ctx, node: canvas.node };
    }

    await test('power 页 v13：慢频房（13号楼324）→ 恰好 3 个 history 请求（24h/7d/30d）+「日更」徽标 + hero 用 lastChange + 慢统计 tile + 阶梯变化点', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      const power = R('utils/power.js');
      const now = Date.now();
      const pts = [
        { q: 100.00, t: now - 11.2 * 3600e3 },
        { q: 88.75, t: now - 0.2 * 3600e3 }
      ];
      const ROW = { id: '1-13---324', label: '13号楼324', building: '13号楼', room: '324', quantity: 88.75, unit: '度', low: false, updated_at: '2026-11-06T09:46:00+08:00' };
      installSlowMock(C, ROW, pts);
      const cv = canvasTexts(C);
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      C.reqLog().length = 0;
      await def.pick.call(ctx, '1-13---324');
      await sleep(30);
      // 增量 43：13 号楼默认隐藏 24h；本用例验证内部 24h 数据口径 → 显式切到 24h（程序化，UI 无此按钮）
      def.pickRange.call(ctx, { currentTarget: { dataset: { k: '24h' } } });
      await sleep(30);
      // 请求契约（规格 §2）：慢频房 = 24h + 7d + 30d 三个 history 请求（去重后） + 1 个当前行
      const histReqs = C.urlsOf('/power_history?');
      assert.strictEqual(histReqs.length, 3, '慢频房选择后恰好 3 个 history 请求：' + JSON.stringify(histReqs.map(function (r) { return String(r.url).replace(/^.*power_history\?/, '').slice(0, 120); })));
      assert.deepStrictEqual(histWindows(histReqs).sort(function (a, b) { return a - b; }), [1, 7, 30], '三个窗口 24h/7d/30d');
      histReqs.forEach(function (r) {
        assert.ok(/select=ts,quantity/.test(r.url) && /order=ts\.asc/.test(r.url) && /limit=2000/.test(r.url), 'history fetch 契约：' + r.url);
      });
      assert.strictEqual(C.urlsOf('/power?').length, 1, '当前电量行 1 次');
      // UI：日更徽标（固定显示）+ 不再显示旧「数据更新较慢」长徽标
      assert.strictEqual(ctx.data.state, 'ready');
      assert.strictEqual(ctx.data.trend.daily, true, '13 号楼 → 「日更」徽标');
      assert.strictEqual(ctx.data.trend.dailyText, '日更');
      assert.ok(/13\/16 号楼网关日更/.test(ctx.data.trend.dailyTitle), '徽标说明=网关日更口径');
      assert.strictEqual(ctx.data.trend.slow, false, '慢频房不显示旧慢更新长徽标');
      assert.strictEqual(ctx.data.trend.slowText, '');
      // hero 更新时间 = 30d 最后一个真实变化点（不是云端同步时间）
      assert.strictEqual(ctx.data.updText, '更新 ' + power.updText(new Date(pts[1].t).toISOString()));
      assert.ok(ctx.data.updText.indexOf('09:46') < 0, 'hero 更新时间不再用 updated_at（同步时间）');
      // 慢统计：rate=11.25 → days=7.9（参考）；tile2 24h 下降 11.3；tile4 30d 无充值
      assert.strictEqual(ctx.data.qText, '88.8');
      assert.strictEqual(ctx.data.tiles[0].value, '7.9', '慢频估算按真实变化点');
      assert.strictEqual(ctx.data.tiles[0].sub, '≈ 11.3 度/天');
      assert.strictEqual(ctx.data.tiles[0].ref, true, '单段 → 「参考」');
      assert.strictEqual(ctx.data.tiles[1].value, '11.3', '24h 真实下降 11.25 → 11.3');
      assert.strictEqual(ctx.data.tiles[1].sub, '');
      assert.strictEqual(ctx.data.tiles[3].value, '—');
      assert.strictEqual(ctx.data.tiles[3].sub, '暂无记录');
      // 慢频图：24h 2 点 + 阶梯路径 + 1 个真实变化点；24h 有变化 → 无「无更新」提示
      assert.strictEqual(ctx._linePoints.length, 2);
      assert.strictEqual(ctx._slowCadence, true, '慢频口径（阶梯线/变化点）');
      assert.strictEqual(ctx.data.trend.noUpd, '');
      assert.strictEqual(ctx._hist30.length, 2, '30d 缓存已加载');
      assert.strictEqual(ctx.data.trend.xTicks.length, 2, '24h 仅 2 个采样点 → 刻度数 = min(3, 点数)');
      assert.strictEqual(ctx.data.trend.empty, false);
      assert.strictEqual(ctx._canvasDrawn, true);
      assert.ok(cv.calls.filter(function (c) { return c === 'arc'; }).length >= 2, '末点 + 变化点圆点');
      assert.deepStrictEqual(cv.texts, [], '有变化 → 绘图区不画无更新提示');
      // 切 7d / 30d：已随 pull 预取 → 0 请求；标题/tile2 label 随区间；tile4 保持 30d 口径
      C.reqLog().length = 0;
      def.pickRange.call(ctx, { currentTarget: { dataset: { k: '7d' } } });
      await sleep(300);
      assert.strictEqual(C.reqLog().length, 0, '切 7d 缓存新鲜 → 0 请求');
      assert.strictEqual(ctx.data.tiles[1].label, '近 7 天用电');
      assert.strictEqual(ctx.data.tiles[1].value, '11.3');
      assert.strictEqual(ctx.data.tiles[3].value, '—', 'tile4 用 30d lastRecharge（切档不变）');
      assert.strictEqual(ctx.data.trend.xTicks.length, 2, '7d 也只有 2 个采样点 → 刻度数 min(4, 点数)');
      C.reqLog().length = 0;
      def.pickRange.call(ctx, { currentTarget: { dataset: { k: '30d' } } });
      await sleep(80);
      assert.strictEqual(C.urlsOf('/power_history?').length, 1, '切 30d 仅补拉 70d 比较窗口（30d 已随 pull 缓存）');
      assert.ok(Math.abs(histWindows(C.urlsOf('/power_history?'))[0] - 70) < 0.2, '70d 比较窗口');
      assert.strictEqual(ctx.data.tiles[1].label, '近 30 天用电');
      assert.strictEqual(ctx.data.tiles[1].value, '11.3');
      assert.strictEqual(ctx.data.trend.xTicks.length, 2, '30d 同样只有 2 个采样点');
      assert.strictEqual(ctx.data.updText, '更新 ' + power.updText(new Date(pts[1].t).toISOString()), '切档 hero 更新时间不变');
      // 回到 24h 档再切实时房（区间 30d 时实时房会拉 3 个窗口，属现状 §2）
      def.pickRange.call(ctx, { currentTarget: { dataset: { k: '24h' } } });
      await sleep(30);
      // 慢频/实时选择：切到 23B 实时房 → 也拉 24h+7d+30d（3 个；30d 供上次充值跨区间），不显示日更、无阶梯口径
      C.reqLog().length = 0;
      await def.pick.call(ctx, '4-23B---424');
      await sleep(30);
      assert.strictEqual(C.urlsOf('/power_history?').length, 3, '实时房选择后 3 个 history 请求（24h+7d+30d）');
      assert.strictEqual(ctx.data.trend.daily, false, '实时房无日更徽标');
      assert.strictEqual(ctx._slowCadence, false, '实时房折线口径');
      assert.strictEqual(ctx._hist30.length, 2, '实时房也保留 30d（上次充值跨区间依据）');
      cleanupPage(ctx);
    });

    await test('power 页 v13：慢频房无更新（16号楼305）→ 平线垂直居中 + 「近 24h 无更新」画在绘图区 + tile2「该区间无更新」', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      const power = R('utils/power.js');
      const now = Date.now();
      const pts = [
        { q: 50.00, t: now - 30.1 * 3600e3 },
        { q: 38.00, t: now - 6.1 * 3600e3 },
        { q: 38.00, t: now - 0.2 * 3600e3 }
      ];
      const ROW = { id: '1-16---305', label: '16号楼305', building: '16号楼', room: '305', quantity: 38.00, unit: '度', low: false, updated_at: '2026-11-06T09:46:00+08:00' };
      installSlowMock(C, ROW, pts);
      const cv = canvasTexts(C);
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      await def.pick.call(ctx, '1-16---305');
      await sleep(30);
      // 增量 43：16 号楼默认 7 天；本用例验证内部 24h 口径 → 显式切 24h
      def.pickRange.call(ctx, { currentTarget: { dataset: { k: '24h' } } });
      await sleep(30);
      assert.strictEqual(ctx.data.state, 'ready');
      assert.strictEqual(ctx.data.trend.daily, true, '16 号楼 → 日更');
      assert.strictEqual(ctx.data.tiles[0].value, '3.2', '慢统计 12 度/天 → 3.2 天');
      assert.strictEqual(ctx.data.tiles[0].ref, true);
      // tile2：24h 区间无下降 → 「— / 该区间无更新」
      assert.strictEqual(ctx.data.tiles[1].value, '—');
      assert.strictEqual(ctx.data.tiles[1].sub, '该区间无更新');
      // 24h 图：2 点同值 → 平线垂直居中（flat=true → y=0.5）；24h changes=0 → 无更新提示画在绘图区
      assert.strictEqual(ctx._linePoints.length, 2);
      assert.deepStrictEqual(ctx._linePoints.map(function (p) { return p.y; }), [0.5, 0.5], '平线垂直居中（不贴底）');
      assert.strictEqual(ctx.data.trend.noUpd, '近 24h 无更新');
      assert.ok(cv.texts.indexOf('近 24h 无更新') >= 0, '无更新提示画在 canvas 绘图区内：' + JSON.stringify(cv.texts));
      assert.strictEqual(ctx._slowCadence, true);
      // 切 7d：有 1 次真实变化 → 无提示、tile2 有下降；变化点圆点重绘
      C.reqLog().length = 0;
      cv.texts.length = 0;
      def.pickRange.call(ctx, { currentTarget: { dataset: { k: '7d' } } });
      await sleep(40);
      assert.strictEqual(C.reqLog().length, 0, '切 7d 缓存新鲜 → 0 请求');
      assert.strictEqual(ctx.data.trend.noUpd, '');
      assert.deepStrictEqual(cv.texts, [], '7d 有更新 → 不画无更新提示');
      assert.strictEqual(ctx.data.tiles[1].label, '近 7 天用电');
      assert.strictEqual(ctx.data.tiles[1].value, '12.0');
      assert.strictEqual(ctx.data.tiles[1].sub, '');
      assert.strictEqual(ctx._linePoints.length, 3, '7d 全部 3 个真实采样（不降采样）');
      assert.strictEqual(power.changeDots(ctx._linePoints).length, 1, '7d 图 1 个真实变化点');
      // 切 30d：仍 1 次变化 → 无提示；tile2 30d 下降 12（增量 43：切 30d 会补拉 70d 比较窗口）
      def.pickRange.call(ctx, { currentTarget: { dataset: { k: '30d' } } });
      await sleep(80);
      assert.strictEqual(ctx.data.trend.noUpd, '');
      assert.strictEqual(ctx.data.tiles[1].value, '12.0');
      assert.strictEqual(ctx.data.tiles[1].label, '近 30 天用电');
      cleanupPage(ctx);
    });

    await test('power 页 v13：慢频房 30d 请求失败不阻塞其它窗口；24h 数据覆盖 ≥6 次变化 → 自动降级实时口径（不显示日更）', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      const now = Date.now();
      // (a) 30d 请求失败：24h/7d 正常 → 页面 ready、趋势可画、估算「数据积累中」、hero 无变化点信息
      installSlowMock(C, { id: '1-16---305', label: '16号楼305', building: '16号楼', room: '305', quantity: 38.00, unit: '度', low: false, updated_at: '2026-11-06T09:46:00+08:00' },
        [{ q: 38.00, t: now - 6.1 * 3600e3 }, { q: 38.00, t: now - 0.2 * 3600e3 }], { fail30: true });
      C.toastLog().length = 0;
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      await def.pick.call(ctx, '1-16---305');
      await sleep(30);
      assert.strictEqual(ctx.data.state, 'ready', '30d 失败不阻塞（其它窗口照常）');
      assert.strictEqual(ctx.data.trend.empty, false, '24h 趋势仍渲染');
      assert.strictEqual(ctx.data.trend.daily, true, '仍按慢频展示日更徽标');
      assert.strictEqual(ctx.data.tiles[0].value, '—', '30d 缺失 → 估算数据积累中');
      assert.strictEqual(ctx.data.tiles[0].sub, '');
      assert.strictEqual(ctx.data.updText, '—', '无 30d 变化点 → hero 更新时间未知');
      assert.strictEqual(ctx.data.tiles[1].sub, '该区间无更新');
      assert.ok(!C.toastLog().some(function (t) { return /刷新失败/.test(t); }), '30d 失败静默（其它窗口正常，不弹错）');
      cleanupPage(ctx);
      // (b) 数据覆盖：慢频楼栋 24h 变化 ≥6 次（网关提速）→ 自动按实时口径，不显示日更
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud2 = R('utils/cloud.js'); enableCloud(cloud2);
      const fast24 = [];
      for (let i = 0; i < 7; i++) fast24.push({ q: 100 - i * 4, t: now - (6 - i) * 3600e3 });
      installSlowMock(C, { id: '1-13---324', label: '13号楼324', building: '13号楼', room: '324', quantity: 88.75, unit: '度', low: false, updated_at: '2026-11-06T09:46:00+08:00' }, fast24);
      const def2 = loadPage('power/power');
      const ctx2 = ctxOf(def2, { _first: true, _loading: false });
      def2.onLoad.call(ctx2, {});
      C.reqLog().length = 0;
      await def2.pick.call(ctx2, '1-13---324');
      await sleep(30);
      assert.strictEqual(C.urlsOf('/power_history?').length, 3, '楼栋级慢频仍预取 30d（数据覆盖只影响口径选择）');
      assert.strictEqual(ctx2.data.trend.daily, false, '24h 变化 ≥6 → 不显示日更（自动降级实时）');
      assert.strictEqual(ctx2._slowCadence, false, '降级实时 → 折线口径（无阶梯/变化点）');
      assert.strictEqual(ctx2.data.tiles[0].sub, '≈ 96.0 度/天', '实时双窗口口径（used 24/6h）');
      assert.strictEqual(ctx2.data.tiles[0].value, '0.9');
      assert.strictEqual(ctx2.data.trend.slow, false, '高频变化不是「慢更新」');
      cleanupPage(ctx2);
    });

    await test('power 页 v13：慢频房选中 30d 档 → 仍恰好 3 个 history 请求（30d 随 pull 拉取，不重复）', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      const now = Date.now();
      C.mem['zq_power_range_v1'] = '30d';
      installSlowMock(C, { id: '1-13---324', label: '13号楼324', building: '13号楼', room: '324', quantity: 88.75, unit: '度', low: false, updated_at: '2026-11-06T09:46:00+08:00' },
        [{ q: 100.00, t: now - 11.2 * 3600e3 }, { q: 88.75, t: now - 0.2 * 3600e3 }]);
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      C.reqLog().length = 0;
      await def.pick.call(ctx, '1-13---324');
      await sleep(30);
      assert.strictEqual(ctx.data.range, '30d');
      const histReqs = C.urlsOf('/power_history?');
      // 增量 43：30d 档 = 24h/7d/30d + 70d 比较窗口（自然周期同期）
      assert.strictEqual(histReqs.length, 4, '30d 档 4 个请求（24h/7d/30d+70d 各一次）');
      const wins = histWindows(histReqs);
      assert.strictEqual(wins.filter(function (w) { return w >= 25 && w < 60; }).length, 1, '30d 只请求一次（与选中区间去重）');
      assert.strictEqual(wins.filter(function (w) { return w >= 60; }).length, 1, '70d 比较窗口一次');
      assert.strictEqual(ctx._hist30.length, 2, '30d 档直接用 pull 的 hist 作为 30d 缓存');
      assert.strictEqual(ctx.data.tiles[0].value, '7.9');
      assert.strictEqual(ctx.data.trend.title, '近 30 天趋势');
      cleanupPage(ctx);
    });

    await test('power 页增量 43：13/16 隐藏 24h（自动 7 天）+ 自然周期同期比较 + 切回实时房恢复 24h', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      const power = R('utils/power.js');
      const now = Date.now();
      const day = 86400e3;
      const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
      const today0 = d0.getTime();
      const week0 = today0 - ((new Date(today0).getDay() + 6) % 7) * day;
      const month0 = new Date(d0.getFullYear(), d0.getMonth(), 1).getTime();
      const pm0 = new Date(d0.getFullYear(), d0.getMonth() - 1, 1).getTime();
      function rateAt(t) {
        if (t >= today0) return 0.20;
        if (t >= today0 - day) return 0.10;
        if (t >= week0) return 0.15;
        if (t >= week0 - 7 * day) return 0.10;
        if (t >= month0) return 0.12;
        if (t >= pm0) return 0.08;
        return 0.10;
      }
      const hist = [];
      let q = 1000;
      for (let t = now - 70 * day; t <= now; t += 3600e3) {
        hist.push({ quantity: Math.round(q * 100) / 100, ts: new Date(t).toISOString() });
        q -= rateAt(t);
      }
      function histFor(rv) {
        return hist.map(function (p) { return { roomverify: rv, quantity: p.quantity, ts: p.ts }; });
      }
      const ROWS = Object.assign({}, PW_ROWS);
      C.setReq(function (o) {
        const u = String(o.url || '');
        if (u.indexOf('/power_history?') >= 0) {
          let rv = '4-23A---321';
          try { const m = u.match(/roomverify=eq\.([^&]+)/); if (m) rv = decodeURIComponent(m[1]); } catch (e) { /* ignore */ }
          const gm = u.match(/ts=gte\.([^&]+)/);
          const cut = gm ? Date.parse(decodeURIComponent(gm[1])) : 0;
          const list = histFor(rv).filter(function (p) { return Date.parse(p.ts) >= cut; });
          return o.success({ statusCode: 200, data: list });
        }
        if (u.indexOf('/power?') >= 0) {
          let rv = '4-23A---321';
          try { const m = u.match(/id=eq\.([^&]+)/); if (m) rv = decodeURIComponent(m[1]); } catch (e) { /* ignore */ }
          return o.success({ statusCode: 200, data: ROWS[rv] ? [ROWS[rv]] : [] });
        }
        return o.success({ statusCode: 200, data: [] });
      });
      function fmtCmp(cmp) {
        return (cmp.label || '较同期') + ' ' + (cmp.pct >= 0 ? '+' : '') + Math.round(cmp.pct) + '%';
      }
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      // 16 号楼（13/16 规则）：24h 按钮隐藏、自动落 7 天，tile 副标 = 较上周同期
      await def.pick.call(ctx, '1-16---305');
      await sleep(120);
      assert.strictEqual(ctx.data.state, 'ready');
      assert.deepStrictEqual(ctx.data.ranges.map(function (r) { return r.label; }), ['7天', '30天'], '13/16 号楼隐藏 24h 档');
      assert.strictEqual(ctx.data.range, '7d', '选中慢楼栋自动落 7 天');
      assert.strictEqual(ctx.data.rangeTitle, '近 7 天趋势');
      const norm30 = power.normalizeHistory(hist.filter(function (p) { return Date.parse(p.ts) >= now - 30 * day; }));
      const exp7 = power.naturalCompare('7d', norm30, Date.now());
      assert.ok(exp7, '测试数据应能算出 7d 同期比较');
      assert.strictEqual(ctx.data.tiles[1].cmp, fmtCmp(exp7), 'tile 独立比较行=较上周同期 ±x%');
      // 切实时房：24h 档恢复并自动回到 24h（进入慢楼栋前档位），比较=较昨日同期
      await def.pick.call(ctx, '4-23A---321');
      await sleep(120);
      assert.deepStrictEqual(ctx.data.ranges.map(function (r) { return r.label; }), ['24h', '7天', '30天'], '实时房恢复三档');
      assert.strictEqual(ctx.data.range, '24h', '切回实时房恢复进入前档位');
      const exp24 = power.naturalCompare('24h', power.normalizeHistory(hist), Date.now());
      assert.ok(exp24 && Math.abs(exp24.pct - 100) < 1, '24h 今日 0.20 vs 昨日 0.10 → +100%');
      assert.strictEqual(ctx.data.tiles[1].cmp, fmtCmp(exp24), '24h tile 独立比较行=较昨日同期 +100%');
      // 实时房切 7 天：补拉 14d 比较窗口 + 较上周同期
      C.reqLog().length = 0;
      def.pickRange.call(ctx, { currentTarget: { dataset: { k: '7d' } } });
      await sleep(150);
      const wins7 = histWindows(C.urlsOf('/power_history?'));
      assert.ok(wins7.some(function (w) { return Math.abs(w - 14) < 0.2; }), '切 7d 补拉 14d 比较窗口：' + JSON.stringify(wins7));
      const exp7live = power.naturalCompare('7d', power.normalizeHistory(hist), Date.now());
      assert.strictEqual(ctx.data.tiles[1].cmp, fmtCmp(exp7live), '7d 实时房=较上周同期');
      // 30 天：补拉 70d + 较上月同期
      C.reqLog().length = 0;
      def.pickRange.call(ctx, { currentTarget: { dataset: { k: '30d' } } });
      await sleep(150);
      const wins30 = histWindows(C.urlsOf('/power_history?'));
      assert.ok(wins30.some(function (w) { return Math.abs(w - 70) < 0.2; }), '切 30d 补拉 70d 比较窗口：' + JSON.stringify(wins30));
      const exp30 = power.naturalCompare('30d', power.normalizeHistory(hist), Date.now());
      assert.strictEqual(ctx.data.tiles[1].cmp, fmtCmp(exp30), '30d=较上月同期');
      cleanupPage(ctx);
    });

    await test('power 页 v6：趋势铺满绘图区（无横滑/无 scroll 组件）+ 点击/拖动最近真实采样点游标（24h HH:MM、7d/30d MM-DD HH:MM）', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      function richHist(rv, days) {
        const n = days === 1 ? 24 : (days === 7 ? 28 : 120);
        const step = days * 24 * 3600e3 / (n - 1);
        const now = Date.now();
        const out = [];
        for (let i = 0; i < n; i++) out.push({ quantity: 400 - i * (n > 50 ? 0.5 : 2), ts: new Date(now - (n - 1 - i) * step).toISOString() });
        return out;
      }
      C.setReq(function (o) {
        const u = String(o.url || '');
        if (u.indexOf('/power_history?') >= 0) {
          let days = 1;
          const m = u.match(/ts=gte\.([^&]+)/);
          if (m) {
            const d = (Date.now() - Date.parse(decodeURIComponent(m[1]))) / 86400e3;
            days = d >= 25 ? 30 : (d >= 5 ? 7 : 1);
          }
          return o.success({ statusCode: 200, data: richHist('4-23A---321', days) });
        }
        if (u.indexOf('/power?') >= 0) return o.success({ statusCode: 200, data: [PW_ROWS['4-23A---321']] });
        return o.success({ statusCode: 200, data: [] });
      });
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      await def.pick.call(ctx, '4-23A---321');
      await sleep(30);

      // 24h：canvas / 内容宽 = 容器宽，3 个 HH:MM，无 hint/scroll 状态
      assert.strictEqual(ctx.data.range, '24h');
      assert.strictEqual(ctx._chartW, ctx._cw, '24h 内容宽 = 容器宽');
      assert.strictEqual(ctx.data.chartW, ctx._cw);
      assert.strictEqual(ctx.data.canvasW, ctx._cw);
      assert.strictEqual(ctx.data.trend.hint, undefined, '不再有横滑提示字段');
      assert.strictEqual(ctx.data.scrollLeft, undefined, '不再有 scrollLeft 状态');
      assert.strictEqual(ctx.data.trend.xTicks.length, 3);
      assert.strictEqual(ctx.data.cursor.on, false, '初始不显示游标');

      // 点击绘图区中部：最近真实点 + 竖线/圆点按 canvas 同坐标系（含左右 padding）+ HH:MM
      ctx._plotLeft = 20;
      ctx._plotH = 130;                        // 固定绘图高，便于断言圆点真实 y
      def.onTrendTouch.call(ctx, { touches: [{ clientX: 20 + ctx._cw * 0.5 }] });
      assert.strictEqual(ctx.data.cursor.on, true, '点击后显示游标');
      const mid = ctx._linePoints.reduce(function (a, p) { return Math.abs(p.x - 0.5) < Math.abs(a.x - 0.5) ? p : a; }, ctx._linePoints[0]);
      assert.strictEqual(ctx.data.cursor.left, 6 + mid.x * (ctx._cw - 12), '游标 x = padX + 最近真实点 x 比例*(绘图区宽-2*padX)');
      assert.strictEqual(ctx.data.cursor.top, 12 + mid.y * (130 - 12 - 10), '圆点 y = 真实采样点 y 位置（不是固定 50% 高度）');
      assert.ok(/^\d\d:\d\d · 电量 \d+(\.\d+)? 度$/.test(ctx.data.cursor.text), '24h 信息行 HH:MM：' + ctx.data.cursor.text);
      assert.strictEqual(ctx.data.cursor.below, undefined, '气泡固定显示（不再有图内翻转/锚点状态）');
      assert.strictEqual(ctx.data.cursor.tipLeft, undefined, '气泡固定显示（不再有图内定位字段）');
      // 拖动：同步 setData 更新（不 rAF），松手保留
      const before = ctx.data.cursor.left;
      def.onTrendTouchMove.call(ctx, { touches: [{ clientX: 20 + ctx._cw * 0.95 }] });
      assert.notStrictEqual(ctx.data.cursor.left, before, '拖动实时更新游标');
      const afterDrag = ctx.data.cursor.left;
      def.onTrendTouchEnd.call(ctx);
      assert.strictEqual(ctx.data.cursor.left, afterDrag, '松手保留最后点');
      assert.strictEqual(ctx.data.cursor.on, true);
      // 再点同一采样点 → 取消
      def.onTrendTouch.call(ctx, { touches: [{ clientX: 20 + afterDrag }] });
      def.onTrendTouchEnd.call(ctx);
      assert.strictEqual(ctx.data.cursor.on, false, '再点同一采样点取消查看');
      assert.strictEqual(ctx.data.cursor.left, 0, '取消后游标位置归零');
      assert.strictEqual(ctx.data.cursor.text, '', '取消后气泡文案清空');

      // 7d：铺满、4 个 MM-DD、游标 MM-DD HH:MM
      def.pickRange.call(ctx, { currentTarget: { dataset: { k: '7d' } } });
      await sleep(60);
      assert.strictEqual(ctx._chartW, ctx._cw, '7d 内容宽 = 容器宽（无横滑）');
      assert.strictEqual(ctx.data.chartW, ctx._cw);
      assert.strictEqual(ctx.data.cursor.on, false, '切档清游标');
      assert.strictEqual(ctx.data.trend.hint, undefined);
      assert.strictEqual(ctx.data.trend.xTicks.length, 4);
      ctx.data.trend.xTicks.forEach(function (t) { assert.ok(/^\d\d-\d\d$/.test(t.label)); });
      ctx._plotLeft = 20;
      def.onTrendTouch.call(ctx, { touches: [{ clientX: 20 + ctx._cw * 0.2 }] });
      assert.strictEqual(ctx.data.cursor.on, true);
      assert.ok(/^\d\d-\d\d \d\d:\d\d · 电量 \d+(\.\d+)? 度$/.test(ctx.data.cursor.text), '7d 信息行 MM-DD HH:MM：' + ctx.data.cursor.text);

      // 30d：铺满、5 个 MM-DD、游标格式
      def.pickRange.call(ctx, { currentTarget: { dataset: { k: '30d' } } });
      await sleep(60);
      assert.strictEqual(ctx._chartW, ctx._cw, '30d 内容宽 = 容器宽（无横滑）');
      assert.strictEqual(ctx.data.chartW, ctx._cw);
      assert.strictEqual(ctx.data.trend.xTicks.length, 5);
      def.onTrendTouch.call(ctx, { touches: [{ clientX: 20 + ctx._cw * 0.8 }] });
      assert.strictEqual(ctx.data.cursor.on, true);
      assert.ok(/^\d\d-\d\d \d\d:\d\d · 电量 \d+(\.\d+)? 度$/.test(ctx.data.cursor.text), '30d 信息行 MM-DD HH:MM');
      // 空态/少于 2 点：不显示游标
      def.pickRange.call(ctx, { currentTarget: { dataset: { k: '24h' } } });
      await sleep(40);
      ctx._linePoints = [];
      const offBefore = ctx.data.cursor.on;
      def.onTrendTouch.call(ctx, { touches: [{ clientX: 20 + ctx._cw * 0.5 }] });
      assert.strictEqual(ctx.data.cursor.on, offBefore, '无采样点不显示游标');
      cleanupPage(ctx);
    });

    await test('power 页 v7：气泡固定显示在趋势图右上角（不浮在图内/不做图内定位测量）；游标线/圆点仍对准最近采样点', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      installPowerMock(C);
      let def = null, ctx = null;
      try {
        def = loadPage('power/power');
        ctx = ctxOf(def, { _first: true, _loading: false });
        def.onLoad.call(ctx, {});
        await def.pick.call(ctx, '4-23A---321');
        await sleep(30);
        ctx._cw = 263;
        ctx._plotLeft = 20;
        ctx._plotH = 130;
        ctx._linePoints = [
          { x: 0, y: 0.02, q: 400, t: 1000 },
          { x: 0.5, y: 0.3, q: 380, t: 2000 },
          { x: 1, y: 0.9, q: 360, t: 3000 }
        ];
        // 中部：只写游标线/圆点位置 + 气泡文字；气泡位置由 WXML/CSS 固定，不在页面计算
        def._showCursor.call(ctx, 0.5);
        const mx = 6 + 0.5 * (263 - 12), my = 12 + 0.3 * (130 - 12 - 10);
        assert.strictEqual(ctx.data.cursor.on, true);
        assert.strictEqual(ctx.data.cursor.left, mx, '竖线/圆点 x = 真实采样点像素');
        assert.strictEqual(ctx.data.cursor.top, my, '圆点 y = 真实采样点像素（不是 50%）');
        assert.ok(/^\d\d:\d\d · 电量 \d+(\.\d+)? 度$/.test(ctx.data.cursor.text), '气泡文案：' + ctx.data.cursor.text);
        assert.strictEqual(ctx.data.cursor.tipLeft, undefined, '气泡固定显示：不再有图内水平锚点');
        assert.strictEqual(ctx.data.cursor.tipTop, undefined, '气泡固定显示：不再有图内垂直锚点');
        assert.strictEqual(ctx.data.cursor.below, undefined, '气泡固定显示：不再有「翻到下方」状态');
        // 左右边界：游标线/圆点仍在绘图区内（气泡位置不受影响）
        [0, 1].forEach(function (f) {
          def._showCursor.call(ctx, f);
          assert.strictEqual(ctx.data.cursor.on, true);
          assert.ok(ctx.data.cursor.left >= 6 && ctx.data.cursor.left <= 263 - 6, 'x 在绘图区内 f=' + f + ' x=' + ctx.data.cursor.left);
          assert.ok(ctx.data.cursor.top >= 12 && ctx.data.cursor.top <= 130 - 10, 'y 在绘图区内 f=' + f + ' y=' + ctx.data.cursor.top);
          assert.ok(/^\d\d:\d\d · 电量 \d+(\.\d+)? 度$/.test(ctx.data.cursor.text), '文案格式不变 f=' + f);
        });
        // 页面不再做图内气泡测量/防抖（无 _placeCursorTip / _cursorSeq）
        assert.strictEqual(typeof def._placeCursorTip, 'undefined', '页面不再实测图内气泡');
        assert.strictEqual(ctx._cursorSeq, undefined, '页面不再有气泡测量防抖序号');
      } finally {
        if (def && ctx) cleanupPage(ctx);
      }
    });

    await test('power 页 v5：低电阈值面板（8 档/选中态/点选生效关闭）+ UD 推送 {sel,at,low} + 本机兜底/换端/旧数据', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      installPowerMock(C);
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      await def.pick.call(ctx, '4-23B---425');       // q=70
      await sleep(30);
      assert.strictEqual(ctx.data.low, 30, '默认低电阈值 30');
      assert.strictEqual(ctx.data.tiles[2].label, '低电阈值');
      assert.strictEqual(ctx.data.tiles[2].value, '30');
      assert.strictEqual(ctx.data.tiles[2].btn, true, '阈值 tile 可点');
      assert.strictEqual(ctx.data.stateKey, 'ok', 'q70 ≥ 2*30 → 充足');
      assert.strictEqual(ctx.data.lowOpen, false);
      // 打开面板 → 8 档
      def.onTileTap.call(ctx, { currentTarget: { dataset: { key: 'threshold' } } });
      assert.strictEqual(ctx.data.lowOpen, true);
      assert.deepStrictEqual(ctx.data.lowOptions, [10, 20, 30, 40, 50, 60, 80, 100]);
      // 选 50：立即生效并关闭；70 处于 [50,100) → 偏低
      const t0 = Number(R('utils/store.js').get().power.at) || 0;
      def.chooseLow.call(ctx, { currentTarget: { dataset: { v: 50 } } });
      assert.strictEqual(ctx.data.lowOpen, false, '点选后关闭面板');
      assert.strictEqual(ctx.data.low, 50);
      assert.strictEqual(ctx.data.stateKey, 'warn', 'low≤q<2low → 偏低');
      assert.strictEqual(ctx.data.stateText, '偏低');
      assert.strictEqual(ctx.data.lowOn, false, '50 时 q70 不显示低电条');
      assert.strictEqual(ctx.data.tiles[2].value, '50');
      const sp = R('utils/store.js').get().power;
      assert.strictEqual(sp.low, 50);
      assert.ok(sp.at >= t0, '阈值变化更新 at（LWW 推送）');
      assert.strictEqual(C.mem['zq_power_low_' + ID.sid], '50', '本机兜底 zq_power_low_<sid>');
      // UD 推送 body.power = {sel,at,low}
      let postBody = null;
      C.setReq(function (o) {
        const u = String(o.url || '');
        if (o.method === 'GET' && u.indexOf('/userdata?') >= 0) return o.success({ statusCode: 200, data: [] });
        if (o.method === 'POST' && u.indexOf('/userdata') >= 0) {
          try { postBody = JSON.parse(o.data[0].blob); } catch (e) { postBody = null; }
          return o.success({ statusCode: 201, data: [] });
        }
        return o.success({ statusCode: 200, data: [] });
      });
      await cloud.udPush();
      assert.ok(postBody, '应推送 userdata');
      assert.deepStrictEqual(Object.keys(postBody).length, 14);
      assert.strictEqual(postBody.power.sel, '4-23B---425');
      assert.strictEqual(postBody.power.low, 50);
      assert.strictEqual(postBody.power.at, postBody.at.power, '值内 at 与 at.power 镜像');
      // 选 80：q70 <80 → 低电条出现；非法值归一
      def.onTileTap.call(ctx, { currentTarget: { dataset: { key: 'threshold' } } });
      def.chooseLow.call(ctx, { currentTarget: { dataset: { v: 80 } } });
      assert.strictEqual(ctx.data.low, 80);
      assert.strictEqual(ctx.data.stateKey, 'low');
      assert.strictEqual(ctx.data.lowOn, true);
      assert.ok(/^剩 70\.00 度/.test(ctx.data.lowText), ctx.data.lowText);
      def.onTileTap.call(ctx, { currentTarget: { dataset: { key: 'threshold' } } });
      def.chooseLow.call(ctx, { currentTarget: { dataset: { v: 70 } } });
      assert.strictEqual(ctx.data.low, 60, '70 不在档位 → 就近 60');
      def.onTileTap.call(ctx, { currentTarget: { dataset: { key: 'threshold' } } });
      def.chooseLow.call(ctx, { currentTarget: { dataset: { v: 999 } } });
      assert.strictEqual(ctx.data.low, 30, '越界 → 默认 30');
      // 换端：远端 low 60 → 本机恢复并重算；旧数据无 low → 默认 30
      cloud.udApply({ v: 6, at: { power: 1777777777000 }, power: { sel: '4-23B---425', at: 1777777777000, low: 60 } });
      assert.strictEqual(R('utils/store.js').get().power.low, 60, '换端恢复 low 60');
      cloud.udApply({ v: 6, at: { power: 1777777778000 }, power: { sel: '4-23B---425', at: 1777777778000 } });
      assert.strictEqual(R('utils/store.js').get().power.low, 30, '旧数据无 low → 30');
      // 本机兜底：store 无选择 + 兜底 low=80 → 页面恢复 80
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud2 = R('utils/cloud.js'); enableCloud(cloud2);
      C.mem['zq_power_low_' + ID.sid] = '80';
      C.mem['zq_power_sel_' + ID.sid] = '4-23B---425';
      const def2 = loadPage('power/power');
      const ctx2 = ctxOf(def2, { _first: true, _loading: false });
      def2.onLoad.call(ctx2, {});
      assert.strictEqual(ctx2.data.low, 80, '本机兜底 low 恢复');
    });

    await test('power 持久化/同步修复：新装无 UD 基线选完 → pull 不被云端空 power 覆盖 + 推送 {sel,at,low}', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      installPowerMock(C);
      let posted = null;
      C.setReq(function (o) {
        const u = String(o.url || '');
        if (o.method === 'GET' && u.indexOf('/userdata?') >= 0) return o.success({ statusCode: 200, data: [] });   // 云端无行（新装）
        if (o.method === 'POST' && u.indexOf('/userdata') >= 0) {
          try { posted = JSON.parse(o.data[0].blob); } catch (e) { posted = null; }
          return o.success({ statusCode: 201, data: [] });
        }
        if (u.indexOf('/power_history?') >= 0) return o.success({ statusCode: 200, data: pwHist('4-23A---321') });
        if (u.indexOf('/power?') >= 0) return o.success({ statusCode: 200, data: [PW_ROWS['4-23A---321']] });
        return o.success({ statusCode: 200, data: [] });
      });
      const store = R('utils/store.js');
      assert.strictEqual(store.get().udCache, null, '前置：新装无 UD 基线');
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      def.onShow.call(ctx);
      await def.pick.call(ctx, '4-23A---321');
      await sleep(20);
      assert.strictEqual(store.get().power.sel, '4-23A---321', '选择已立即写入本机');
      assert.strictEqual(C.mem['zq_power_sel_' + ID.sid], '4-23A---321', '本机兜底键同步写入');
      assert.strictEqual(store.get().udCache, null, '尚未有 UD 基线');
      // 模拟启动时 userdata pull：云端空 power(at=0) 不得覆盖刚选的宿舍
      const r = await cloud.udPull(true);
      assert.strictEqual(r.ok, true);
      assert.strictEqual(store.get().power.sel, '4-23A---321', 'pull 后本机选择仍在（不被云端空值覆盖）');
      assert.ok(store.get().power.at > 0, 'power.at 非 0');
      assert.ok(store.get().udCache && store.get().udCache.power.sel === '4-23A---321', '合并结果保留本机选择');
      // 推送必须带 power {sel,at,low}
      await cloud.udPush();
      assert.ok(posted, '应推送 userdata');
      assert.strictEqual(posted.power.sel, '4-23A---321');
      assert.strictEqual(posted.power.low, 30);
      assert.strictEqual(posted.power.at, posted.at.power, '值内 at 与 at.power 镜像');
      assert.strictEqual(posted.v, 6);
      cloud.udStop();
    });

    await test('power 持久化：页面重启恢复 + 选完立即退出（未等 1200ms）flush 推送 + 云端权威清空不复活兜底', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      installPowerMock(C);
      let posted = [], remote = [];
      C.setReq(function (o) {
        const u = String(o.url || '');
        if (o.method === 'GET' && u.indexOf('/userdata?') >= 0) return o.success({ statusCode: 200, data: remote });
        if (o.method === 'POST' && u.indexOf('/userdata') >= 0) {
          try { posted.push(JSON.parse(o.data[0].blob)); } catch (e) { /* ignore */ }
          return o.success({ statusCode: 201, data: [] });
        }
        if (u.indexOf('/power_history?') >= 0) return o.success({ statusCode: 200, data: pwHist('4-23B---424') });
        if (u.indexOf('/power?') >= 0) return o.success({ statusCode: 200, data: [PW_ROWS['4-23B---424']] });
        return o.success({ statusCode: 200, data: [] });
      });
      const store = R('utils/store.js');
      const def = loadPage('power/power');
      // 第一段：进入 → 选择 → 不等防抖直接「重启」（store.reload + 新页面）
      const ctx1 = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx1, {});
      def.onShow.call(ctx1);
      await def.pick.call(ctx1, '4-23B---424');
      await sleep(10);
      cloud.udStop();                                   // 模拟退出前防抖定时器被取消
      store.reload();                                   // 冷启动重新读本机
      const def2 = loadPage('power/power');
      const ctx2 = ctxOf(def2, { _first: true, _loading: false });
      def2.onLoad.call(ctx2, {});
      def2.onShow.call(ctx2);
      assert.strictEqual(ctx2.data.sel, '4-23B---424', '页面重启后自动恢复关注宿舍');
      assert.strictEqual(ctx2.data.hasSel, true);
      // 立即退出场景：app.onHide 调 udFlush → 马上推送（不等 1200ms）
      const f = await cloud.udFlush.call(ctx2);
      assert.strictEqual(f.ok, true);
      assert.ok(posted.length >= 1, 'flush 应触发推送');
      assert.strictEqual(posted[posted.length - 1].power.sel, '4-23B---424');
      assert.ok(store.get().udCache && store.get().udCache.power.sel === '4-23B---424', 'flush 后基线保留选择');
      // 换端：远端把选择改成 305（at 更新）→ pull 覆盖本机 + 本机兜底更新
      remote = [{ id: ID.sid, blob: JSON.stringify({ v: 6, at: { power: 1800000000000 }, power: { sel: '1-16---305', at: 1800000000000, low: 50 } }) }];
      await cloud.udPull(true);
      assert.strictEqual(store.get().power.sel, '1-16---305', '换端从云端恢复选择');
      assert.strictEqual(store.get().power.low, 50, '换端恢复 low');
      const def3 = loadPage('power/power');
      const ctx3 = ctxOf(def3, { _first: true, _loading: false });
      def3.onLoad.call(ctx3, {});
      def3.onShow.call(ctx3);
      assert.strictEqual(ctx3.data.sel, '1-16---305', '页面 onShow 后显示云端选择');
      // 远端明确清空选择（权威空）→ 本机跟空，旧兜底键不得复活
      remote = [{ id: ID.sid, blob: JSON.stringify({ v: 6, at: { power: 1900000000000 }, power: { sel: '', at: 1900000000000, low: 50 } }) }];
      await cloud.udPull(true);
      assert.strictEqual(store.get().power.sel, '', '云端权威清空 → 本机清空');
      const def4 = loadPage('power/power');
      const ctx4 = ctxOf(def4, { _first: true, _loading: false });
      def4.onLoad.call(ctx4, {});
      def4.onShow.call(ctx4);
      assert.strictEqual(ctx4.data.sel, '', '页面重启后仍为空（旧兜底不复活）');
      assert.ok(!C.mem['zq_power_sel_' + ID.sid], '陈旧本机兜底键已清理：' + JSON.stringify(C.mem));
      cloud.udStop();
    });

    await test('power 持久化：云同步关闭/离线时选择只落本机，重开仍能恢复且不请求', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const store = R('utils/store.js');
      const cloud = R('utils/cloud.js');
      // 云端不可用（离线/未配置）：本机选择仍必须可用，且不产生网络请求
      cloud.configure({ enabled: false, restBase: '', publishableKey: '', ttUrl: '' });
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      def.onShow.call(ctx);
      C.reqLog().length = 0;
      await def.pick.call(ctx, '1-16---305');
      await sleep(20);
      assert.strictEqual(store.get().power.sel, '1-16---305');
      assert.strictEqual(C.reqLog().length, 0, '云端关闭时选择不产生任何请求');
      assert.strictEqual(store.save(), true, '本机保存成功');
      store.reload();
      const def2 = loadPage('power/power');
      const ctx2 = ctxOf(def2, { _first: true, _loading: false });
      def2.onLoad.call(ctx2, {});
      def2.onShow.call(ctx2);
      assert.strictEqual(ctx2.data.sel, '1-16---305', '离线重开仍恢复选择');
      assert.strictEqual(ctx2.data.hasSel, true);
      cloud.udStop();
    });

    await test('工作台电费卡：未选择 0 请求 + 已选择展示剩余电量/状态 + 2min 缓存不重复请求 + 点击进电费页', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const store = R('utils/store.js');
      const cloud = R('utils/cloud.js'); enableCloud(cloud);
      C.setReq(function (o) {
        const u = String(o.url || '');
        if (u.indexOf('/power_history?') >= 0) return o.success({ statusCode: 200, data: [] });
        if (u.indexOf('/power?') >= 0) {
          const m = u.match(/id=eq\.([^&]+)/);
          const rv = m ? decodeURIComponent(m[1]) : '';
          return o.success({ statusCode: 200, data: PW_ROWS[rv] ? [PW_ROWS[rv]] : [] });
        }
        return o.success({ statusCode: 200, data: [] });
      });
      // 1) 未选择：卡片引导，0 个 power 请求
      const def = loadPage('index/index');
      const ctx = ctxOf(def, { _first: true });
      def.onLoad.call(ctx, {});
      def.onShow.call(ctx);
      await sleep(60);
      assert.strictEqual(ctx.data.powerCard.has, false, '未选择 → 引导态');
      assert.strictEqual(C.urlsOf('/power?').length, 0, '未选择不应请求 power');
      assert.strictEqual(C.urlsOf('/power_history?').length, 0, '未选择不应请求 history');
      // 2) 已选择：进入工作台展示 remaining/状态（1 次 power 请求）
      store.get().power = { sel: '4-23A---321', at: Date.now(), low: 30 };
      store.save();
      C.reqLog().length = 0;
      const def2 = loadPage('index/index');
      const ctx2 = ctxOf(def2, { _first: true });
      def2.onLoad.call(ctx2, {});
      def2.onShow.call(ctx2);
      await sleep(80);
      const card = ctx2.data.powerCard;
      assert.strictEqual(card.has, true);
      assert.strictEqual(card.sel, '4-23A---321');
      assert.strictEqual(card.label, '23号楼A座321');
      assert.strictEqual(card.qText, '382', '网站 fmtMain：≥100 取整：' + JSON.stringify(card));
      assert.strictEqual(card.stateKey, 'ok');
      assert.strictEqual(card.stateText, '充足');
      assert.strictEqual(C.urlsOf('/power?').length, 1, '已选择首屏读 1 次电量');
      // 3) 2min 缓存内再次进页/手动刷新不重复请求
      C.reqLog().length = 0;
      await ctx2.loadPowerCard();
      assert.strictEqual(C.urlsOf('/power?').length, 0, '2min 缓存命中 → 0 请求');
      // 4) 点击进入电费页
      ctx2.goPower();
      assert.ok(C.navLog().some(function (u) { return u === '/pages/power/power'; }), '应 navigateTo /pages/power/power：' + JSON.stringify(C.navLog()));
      // 5) 切换到低电房间 → 卡片状态随选择/电量更新（force 刷新）
      store.get().power = { sel: '1-16---305', at: Date.now(), low: 30 };
      store.save();
      await ctx2.loadPowerCard(true);
      assert.strictEqual(ctx2.data.powerCard.sel, '1-16---305');
      assert.strictEqual(ctx2.data.powerCard.stateKey, 'low');
      cloud.udStop();
    });

    await test('power 布局：320/360/390/430/667 兜底容器宽不超卡片预算；趋势全量铺满（无横滑）；最近采样点/时间格式契约', function () {
      purge();
      const pw = R('utils/power.js');
      const widths = [320, 360, 390, 430, 667];
      widths.forEach(function (w) {
        const fb = pw.fallbackContainerW(w);
        // 页面预算：page pad 32rpx*2 + card pad 32rpx*2 + border 2rpx*2 + yaxis 82rpx+margin10rpx = 224rpx
        const budget = w - 224 * w / 750;
        assert.ok(fb > 0 && fb <= Math.floor(budget), w + 'px 兜底容器宽应 ≤ 卡片预算：' + fb + ' vs ' + budget);
        // 24h/7d/30d 全部按真实时间比例铺满同一绘图区宽（不横滑）
        assert.strictEqual(pw.chartWidth('24h', fb, 24), fb, w + 'px 24h 必须铺满容器不超出');
      });
      assert.strictEqual(pw.fallbackContainerW(390), 273);
      assert.strictEqual(pw.fallbackContainerW(0), pw.fallbackContainerW(390), '非法宽回退 390 估算');
      // 最近真实采样点：按真实 x 比例，不插值
      const pts = [{ x: 0, t: 0, q: 1 }, { x: 0.5, t: 1000, q: 2 }, { x: 1, t: 2000, q: 3 }];
      assert.strictEqual(pw.nearestPoint(pts, 0.49).index, 1);
      assert.strictEqual(pw.nearestPoint(pts, 0.76).index, 2);
      assert.strictEqual(pw.nearestPoint(pts, -1).index, 0, '越界夹到首点');
      assert.strictEqual(pw.nearestPoint(pts, 9).index, 2, '越界夹到末点');
      assert.strictEqual(pw.nearestPoint([{ x: 0, t: 0, q: 1 }], 0.5), null, '<2 点不可查看');
      // 信息行时间格式：24h HH:MM；7d/30d MM-DD HH:MM
      const t = new Date(2026, 10, 6, 9, 5, 0).getTime();
      assert.strictEqual(pw.cursorLabel(t, '24h'), '09:05');
      assert.strictEqual(pw.cursorLabel(t, '7d'), '11-06 09:05');
      assert.strictEqual(pw.cursorLabel(t, '30d'), '11-06 09:05');
    });

    await test('power 游标气泡定位 cursorTipLayout（网页版样式）：正常/左/右/顶部翻转/底部/窄宽/非法入参（7 组边界）', function () {
      purge();
      const pw = R('utils/power.js');
      assert.strictEqual(typeof pw.cursorTipLayout, 'function', '应导出 cursorTipLayout 纯函数');
      const pad = 6, W = 200, H = 150, tw = 60, th = 20;
      // 1) 正常（中部）：气泡在点上方，左=点 x，锚点 top=y-8（WXML translate(-50%,-100%)）
      let l = pw.cursorTipLayout(100, 100, W, H, tw, th, pad);
      assert.deepStrictEqual(l, { left: 100, top: 92, below: false });
      // 2) 左边缘：气泡盒整体不越界（left = pad + tw/2），仍在点上方
      l = pw.cursorTipLayout(0, 100, W, H, tw, th, pad);
      assert.strictEqual(l.left, pad + tw / 2);
      assert.strictEqual(l.top, 92);
      assert.strictEqual(l.below, false);
      // 3) 右边缘：left = cw - pad - tw/2
      l = pw.cursorTipLayout(W, 100, W, H, tw, th, pad);
      assert.strictEqual(l.left, W - pad - tw / 2);
      // 4) 顶部：上方放不下（y-8-tipH < pad）→ 翻到点下方（锚点 y+10）
      l = pw.cursorTipLayout(100, 10, W, H, tw, th, pad);
      assert.strictEqual(l.below, true);
      assert.strictEqual(l.top, 20);
      // 5) 底部：仍在上方（锚点 y-8，气泡底边紧贴点上方）
      l = pw.cursorTipLayout(100, 145, W, H, tw, th, pad);
      assert.strictEqual(l.below, false);
      assert.strictEqual(l.top, 137);
      // 6) 窄宽：气泡比容器可用宽还宽 → 宽按容器截断、水平居中，left 有限
      l = pw.cursorTipLayout(10, 100, 100, H, 200, th, pad);
      assert.strictEqual(l.left, 50);
      assert.strictEqual(l.below, false);
      // 极矮容器 + 下方翻转：top 按 [pad, plotH-pad-tipH] clamp
      l = pw.cursorTipLayout(100, 10, W, 40, tw, th, pad);
      assert.strictEqual(l.below, true);
      assert.strictEqual(l.top, 14);
      // 7) 非法入参：不抛错、left/top 有限、below 恒为布尔、pad 非法回退 6
      l = pw.cursorTipLayout(NaN, undefined, 0, 0, undefined, 'x', 'y');
      assert.ok(isFinite(l.left) && isFinite(l.top), '非法入参应返回有限安全值：' + JSON.stringify(l));
      assert.strictEqual(typeof l.below, 'boolean');
      const l2 = pw.cursorTipLayout('a', 'b', 'c', 'd', 'e', 'f', 'g');
      assert.ok(isFinite(l2.left) && isFinite(l2.top) && typeof l2.below === 'boolean', '全非法入参也不崩');
      // 8) 首帧估宽 estimateCursorTipSize：有限、随文字变宽、min/max 截断、非法入参安全
      assert.strictEqual(typeof pw.estimateCursorTipSize, 'function', '应导出 estimateCursorTipSize');
      const eShort = pw.estimateCursorTipSize('00:00 · 电量 1 度');
      const eLong = pw.estimateCursorTipSize('11-07 23:59 · 电量 1234.56 度');
      assert.ok(isFinite(eShort.w) && isFinite(eShort.h) && eShort.w > 0 && eShort.h > 0, '短文案估宽有限：' + JSON.stringify(eShort));
      assert.ok(eLong.w > eShort.w, '文字更长 → 估宽更大：' + eShort.w + ' < ' + eLong.w);
      assert.ok(eLong.w <= 280, '估宽有上限：' + eLong.w);
      assert.ok(pw.estimateCursorTipSize('').w >= 56, '空文案有最小宽');
      assert.ok(isFinite(pw.estimateCursorTipSize(null).w) && isFinite(pw.estimateCursorTipSize(undefined).h), '非法入参估宽安全');
    });

    await test('power 页：期间有充值徽标 + 上次充值 tile（值/时间）+ 区间 drop 与 recharge 语义', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      const nowR = Date.now();
      const recHist = [];
      for (let i = 0; i <= 23; i++) {
        // 0–10h: 100→80（降 20）；11h 充值 +100 → 180；12–23h: 180→170（降 10）
        let q = i <= 10 ? 100 - i * 2 : (i === 11 ? 180 : 180 - (i - 11));
        recHist.push({ quantity: q, ts: new Date(nowR - (23 - i) * 3600e3).toISOString() });
      }
      C.setReq(function (o) {
        const u = String(o.url || '');
        if (u.indexOf('/power_history?') >= 0) return o.success({ statusCode: 200, data: recHist });
        if (u.indexOf('/power?') >= 0) return o.success({ statusCode: 200, data: [PW_ROWS['4-23A---321']] });
        return o.success({ statusCode: 200, data: [] });
      });
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      await def.pick.call(ctx, '4-23A---321');
      await sleep(20);
      assert.strictEqual(ctx.data.trend.recharge, true, '有充值事件 → 徽标数据');
      // drop = 前 20 + 后 12 = 32（充值上升不计入）
      assert.strictEqual(ctx.data.trend.dropText, '32.00');
      assert.strictEqual(ctx.data.tiles[3].label, '上次充值');
      assert.strictEqual(ctx.data.tiles[3].value, '+100.00', '值 = +充值量 delta（不是充值后余额 180）');
      assert.ok(/^\d\d-\d\d \d\d:\d\d$/.test(ctx.data.tiles[3].sub), '上次充值时间 MM-DD HH:MM：' + ctx.data.tiles[3].sub);
      assert.strictEqual(ctx.data.tiles[3].unit, '度');
      // 切 7 天（mock 仍返回同一组点）→ 标题/图例变化，recharge 仍显示，上次充值仍在
      // 测试环境 selectorQuery 无真实 canvas 节点：直接标记已测量，走同步渲染分支（页面兜底逻辑见 _renderWhenReady）
      ctx._cwMeasured = true; ctx._measuring = false; ctx._pendingRender = false;
      def.pickRange.call(ctx, { currentTarget: { dataset: { k: '7d' } } });
      await sleep(80);
      assert.strictEqual(ctx.data.trend.title, '近 7 天趋势');
      assert.strictEqual(ctx.data.trend.dropLabel, '区间下降');
      assert.strictEqual(ctx.data.trend.recharge, true);
      assert.strictEqual(ctx.data.tiles[3].label, '上次充值');
      assert.strictEqual(ctx.data.tiles[3].value, '+100.00');
      assert.ok(!/暂无记录/.test(ctx.data.tiles[3].sub));
    });

    await test('power 页 v14：实时房也拉 30d；上次充值 = 30d 最后一次上调的充值量，切 24h/7d/30d 不变；30d 缺失回退区间 lastUp', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      const nowR = Date.now();
      const D = 86400e3;
      // 30d 全量：2 天前充值 +50（40→90）；近 24h 只有正常下降（无充值）
      const full = [
        { q: 100, t: nowR - 20 * D },
        { q: 95, t: nowR - 10 * D },
        { q: 40, t: nowR - 3 * D },
        { q: 90, t: nowR - 2 * D },     // +50 最后一次充值（在 24h 之外）
        { q: 88, t: nowR - 1 * D },
        { q: 86, t: nowR - 0.5 * D }
      ];
      function rowsFor(days) {
        const cut = nowR - days * D;
        return full.filter(function (p) { return p.t >= cut; }).map(function (p) {
          return { roomverify: '4-23A---321', quantity: p.q, ts: new Date(p.t).toISOString() };
        });
      }
      let empty30 = false;
      const mock = function (o) {
        const u = String(o.url || '');
        if (u.indexOf('/power_history?') >= 0) {
          const m = u.match(/ts=gte\.([^&]+)/);
          const days = m ? (nowR - Date.parse(decodeURIComponent(m[1]))) / D : 1;
          if (empty30 && days >= 25) return o.success({ statusCode: 200, data: [] });   // 模拟云端无 30d 行
          return o.success({ statusCode: 200, data: rowsFor(days) });
        }
        if (u.indexOf('/power?') >= 0) return o.success({ statusCode: 200, data: [PW_ROWS['4-23A---321']] });
        return o.success({ statusCode: 200, data: [] });
      };
      C.setReq(mock);
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      C.reqLog().length = 0;
      await def.pick.call(ctx, '4-23A---321');
      await sleep(30);
      // 实时房也固定 3 个 history 窗口（24h/7d/30d）
      assert.strictEqual(C.urlsOf('/power_history?').length, 3, '实时房也拉 30d：' + C.urlsOf('/power_history?').length);
      assert.strictEqual(ctx._hist30.length, 6, '30d 全量缓存（所有房间）');
      assert.strictEqual(ctx.data.range, '24h');
      assert.strictEqual(ctx.data.tiles[3].value, '+50.00', '24h 档显示 30d 最后一次充值量（不是 24h 区间 lastUp）');
      assert.strictEqual(ctx.data.tiles[3].unit, '度');
      const sub24 = ctx.data.tiles[3].sub;
      assert.ok(/^\d\d-\d\d \d\d:\d\d$/.test(sub24), '时间 MM-DD HH:MM：' + sub24);
      // 切 7d / 30d：值/时间不变（跨区间语义）
      ctx._cwMeasured = true; ctx._measuring = false; ctx._pendingRender = false;
      def.pickRange.call(ctx, { currentTarget: { dataset: { k: '7d' } } });
      await sleep(80);
      assert.strictEqual(ctx.data.tiles[3].value, '+50.00', '切 7d 不变');
      assert.strictEqual(ctx.data.tiles[3].sub, sub24);
      def.pickRange.call(ctx, { currentTarget: { dataset: { k: '30d' } } });
      await sleep(80);
      assert.strictEqual(ctx.data.tiles[3].value, '+50.00', '切 30d 不变');
      assert.strictEqual(ctx.data.tiles[3].sub, sub24);
      cleanupPage(ctx);
      // 30d 缺失（空结果）→ 回退所选区间 lastUp（向后兼容；7d 内有 2 天前的充值）
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud2 = R('utils/cloud.js'); enableCloud(cloud2);
      empty30 = true;
      C.setReq(mock);                                   // clearMem 会重置 mock，重新挂载
      const def2 = loadPage('power/power');
      const ctx2 = ctxOf(def2, { _first: true, _loading: false });
      def2.onLoad.call(ctx2, {});
      C.reqLog().length = 0;
      await def2.pick.call(ctx2, '4-23A---321');
      await sleep(30);
      assert.strictEqual(ctx2._hist30.length, 0, '30d 空 → 空缓存（不阻塞其它窗口）');
      assert.strictEqual(ctx2.data.state, 'ready');
      assert.strictEqual(ctx2.data.tiles[3].value, '—', '24h 无充值 → 暂无记录');
      assert.strictEqual(ctx2.data.tiles[3].sub, '暂无记录');
      ctx2._cwMeasured = true; ctx2._measuring = false; ctx2._pendingRender = false;
      def2.pickRange.call(ctx2, { currentTarget: { dataset: { k: '7d' } } });
      await sleep(80);
      assert.strictEqual(ctx2.data.tiles[3].value, '+50.00', '30d 缺失 → 回退所选区间 lastUp.delta');
      assert.ok(!/暂无记录/.test(ctx2.data.tiles[3].sub));
      cleanupPage(ctx2);
    });

    /* ============================================================
       B2. 用户反馈修复（2026-11-06）：进入电费页趋势卡偶发「数据积累中」/空态，手动刷新才出图
       —— 修复 = pages/power 自动静默重试一次（force 绕 5 分钟缓存、每「宿舍+区间」至多 1 次）
          + utils/cloud.js 空 history 不再写 5 分钟缓存 + _drawTrend canvas 节点未就绪兜底重绘
       ============================================================ */
    await test('power 修复 v9：进入页（已有选择）hist 首轮网络失败 → 自动静默重试一次恢复出图（无需手动刷新、请求有界）', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      C.mem['zq_power_sel_' + ID.sid] = '4-23A---321';      // 模拟已有关注宿舍：进入页自动 load(false)
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      const canvas = installCanvasMock(C);
      let histRaw = 0;                                     // 原始 history 请求计数（含 cloud 自带 1 次重试）
      C.setReq(function (o) {
        const u = String(o.url || '');
        if (u.indexOf('/power_history?') >= 0) {
          histRaw += 1;
          // 首轮 24h+7d+30d 各「原始请求 + 自带重试」= 6 次全失败（确定性模拟弱网抖动），之后恢复
          if (histRaw <= 6) return o.fail({ errMsg: 'request:fail mock' });
          return o.success({ statusCode: 200, data: pwHist('4-23A---321') });
        }
        if (u.indexOf('/power?') >= 0) return o.success({ statusCode: 200, data: [PW_ROWS['4-23A---321']] });
        return o.success({ statusCode: 200, data: [] });
      });
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      def.onShow.call(ctx);                                 // 首次进入 → load(false)，无手动刷新
      await sleep(500);
      assert.strictEqual(ctx.data.state, 'ready');
      assert.strictEqual(ctx.data.trend.empty, true, '首轮失败后先显示空态（与线上现象一致）');
      const ok = await waitFor(function () { return !ctx.data.trend.empty; }, 2500);
      assert.ok(ok, '无需手动刷新：自动重试后趋势应自动出现，实际 ' +
        JSON.stringify({ empty: ctx.data.trend.empty, note: ctx.data.trend.note }));
      assert.strictEqual(ctx.data.trend.note, '');
      assert.strictEqual(ctx._linePoints.length, 11);
      assert.strictEqual(ctx._canvasDrawn, true, '自动恢复后 canvas 应自动重绘');
      assert.ok(canvas.calls.indexOf('stroke') >= 0, 'canvas 应实际绘制折线');
      // 请求有界：初始（24h+7d+30d 各 2 次原始请求，cloud 自带 1 次重试）+ 1 次自动重试（各 1 次）
      assert.strictEqual(C.urlsOf('/power_history?').length, 9, 'history 请求数有界：' + C.urlsOf('/power_history?').length);
      assert.strictEqual(C.urlsOf('/power?').length, 2, '当前行 2 次（初始 + 1 次自动重试）');
      const histN = C.urlsOf('/power_history?').length;
      await sleep(1200);
      assert.strictEqual(C.urlsOf('/power_history?').length, histN, '自动重试不得循环');
      assert.strictEqual(C.urlsOf('/power?').length, 2);
    });

    await test('power 修复 v9：hist 首轮 HTTP 200 [] → 自动重试（force 绕缓存）恢复；空结果不写 5 分钟缓存', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      C.mem['zq_power_sel_' + ID.sid] = '4-23A---321';
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      installCanvasMock(C);
      let histHits = 0;
      C.setReq(function (o) {
        const u = String(o.url || '');
        if (u.indexOf('/power_history?') >= 0) {
          histHits += 1;
          return o.success({ statusCode: 200, data: histHits <= 3 ? [] : pwHist('4-23A---321') });   // 首轮 24h+7d+30d 空
        }
        if (u.indexOf('/power?') >= 0) return o.success({ statusCode: 200, data: [PW_ROWS['4-23A---321']] });
        return o.success({ statusCode: 200, data: [] });
      });
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      def.onShow.call(ctx);
      await sleep(400);
      assert.strictEqual(ctx.data.trend.empty, true, '首轮 200 [] → 先空态');
      const ok = await waitFor(function () { return !ctx.data.trend.empty; }, 2500);
      assert.ok(ok, '自动重试应绕过缓存拿到真实数据并出图');
      assert.strictEqual(ctx._linePoints.length, 11);
      assert.strictEqual(C.urlsOf('/power_history?').length, 6, '首轮 3 + 自动重试 3（无额外请求）：' + C.urlsOf('/power_history?').length);
      assert.strictEqual(C.urlsOf('/power?').length, 2);
      // 契约（空结果不缓存）：新模块里 force=false 拿到 [] 后，下一次 force=false 必须重新请求
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud2 = R('utils/cloud.js'); enableCloud(cloud2);
      let n = 0;
      C.setReq(function (o) {
        if (String(o.url).indexOf('/power_history?') >= 0) {
          n += 1;
          return o.success({ statusCode: 200, data: n === 1 ? [] : pwHist('4-23A---321') });
        }
        return o.success({ statusCode: 200, data: [] });
      });
      const empty1 = await cloud2.powerHistory('4-23A---321', '24h', false);
      assert.deepStrictEqual(empty1, [], '首轮 HTTP 200 [] 返回空');
      assert.strictEqual(C.urlsOf('/power_history?').length, 1);
      assert.strictEqual(cloud2.powerHistCached('4-23A---321', '24h'), null, '空结果不得写入 5 分钟缓存');
      const real2 = await cloud2.powerHistory('4-23A---321', '24h', false);
      assert.strictEqual(real2.length, 11, '空结果不缓存 → 第二次 force=false 重新请求拿到真实数据');
      assert.strictEqual(C.urlsOf('/power_history?').length, 2);
      const third = await cloud2.powerHistory('4-23A---321', '24h', false);
      assert.strictEqual(C.urlsOf('/power_history?').length, 2, '非空结果照常写 5 分钟缓存 → 第三次 0 请求');
      assert.strictEqual(third.length, 11);
      assert.strictEqual(cloud2.powerHistFresh('4-23A---321', '24h'), true);
    });

    await test('power 修复 v9：真实只有 1 个采样点 → 自动重试恰 1 次后停止，最终仍「数据积累中」（不循环）', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      C.mem['zq_power_sel_' + ID.sid] = '4-23A---321';
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      installCanvasMock(C);
      const ONE = [{ roomverify: '4-23A---321', quantity: 100, ts: new Date().toISOString() }];
      C.setReq(function (o) {
        const u = String(o.url || '');
        if (u.indexOf('/power_history?') >= 0) return o.success({ statusCode: 200, data: ONE });
        if (u.indexOf('/power?') >= 0) return o.success({ statusCode: 200, data: [PW_ROWS['4-23A---321']] });
        return o.success({ statusCode: 200, data: [] });
      });
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      def.onShow.call(ctx);
      await sleep(1100);                                    // 初始 load + 自动重试（650ms）都已发生
      assert.strictEqual(ctx.data.trend.empty, true);
      assert.strictEqual(ctx.data.trend.note, '数据积累中', '真实数据不足保留「数据积累中」');
      assert.strictEqual(C.urlsOf('/power_history?').length, 6, '初始 3 + 自动重试 3（恰好 1 次）：' + C.urlsOf('/power_history?').length);
      assert.strictEqual(C.urlsOf('/power?').length, 2);
      await sleep(1500);                                    // 观察窗：不得再自动重试
      assert.strictEqual(C.urlsOf('/power_history?').length, 6, '自动重试有界：不得循环');
      assert.strictEqual(C.urlsOf('/power?').length, 2);
      assert.strictEqual(ctx._canvasDrawn, false, '<2 点不绘制');
      assert.strictEqual(ctx.data.trend.empty, true);
      if (ctx._cancelTimers) ctx._cancelTimers();
    });

    await test('power 修复 v9：正常 24h 数据（≥2 点）→ 0 额外请求、0 回归（仅初始 24h+7d）', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      C.mem['zq_power_sel_' + ID.sid] = '4-23A---321';
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      installPowerMock(C);
      installCanvasMock(C);
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      def.onShow.call(ctx);
      await sleep(1000);                                    // 覆盖可能的自动重试窗口（650ms）
      assert.strictEqual(ctx.data.trend.empty, false);
      assert.strictEqual(ctx.data.state, 'ready');
      assert.strictEqual(C.urlsOf('/power_history?').length, 3, '正常数据：初始 24h+7d+30d，3 个请求');
      assert.strictEqual(C.urlsOf('/power?').length, 1, '正常数据：仅 1 次当前行');
      assert.deepStrictEqual(Object.keys(ctx._autoRetryKeys), [], '未触发自动重试');
      assert.strictEqual(ctx.data.trend.title, '近 24h 趋势');
      assert.strictEqual(ctx.data.trend.startLabel, '起点');
      assert.strictEqual(ctx.data.trend.dropText, '40.00');
      assert.strictEqual(ctx.data.trend.xTicks.length, 3);
      await sleep(900);
      assert.strictEqual(C.urlsOf('/power_history?').length, 3, '0 额外请求');
      assert.strictEqual(C.urlsOf('/power?').length, 1, '0 额外当前行请求');
    });

    await test('power 修复 v9：_drawTrend canvas 节点首查未就绪 → 一次短延迟重绘兜底（不静默空白）', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      const calls = [];
      const fakeCtx = {
        clearRect() { calls.push('clearRect'); }, beginPath() { calls.push('beginPath'); }, moveTo() { calls.push('moveTo'); },
        lineTo() { calls.push('lineTo'); }, closePath() { calls.push('closePath'); }, fill() { calls.push('fill'); },
        stroke() { calls.push('stroke'); }, arc() { calls.push('arc'); }, scale() { calls.push('scale'); },
        createLinearGradient() { return { addColorStop() {} }; }
      };
      const node = { width: 0, height: 0, getContext: function () { return fakeCtx; } };
      let execN = 0;
      C.wxMock.getWindowInfo = function () { return { windowWidth: 390, pixelRatio: 2 }; };
      C.wxMock.createSelectorQuery = function () {
        return {
          select() { return this; }, fields() { return this; },
          exec(cb) {
            execN += 1;
            cb(execN === 1 ? [{}] : [{ node: node, width: 300, height: 160 }]);   // 首查节点未就绪
          }
        };
      };
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      ctx._linePoints = [{ x: 0, y: 0.5, q: 100, t: 1 }, { x: 1, y: 0.8, q: 90, t: 2 }];
      ctx._chartW = 300; ctx._cw = 300; ctx._sl = 0;
      ctx._canvasDrawn = false; ctx._drawRetryN = 0; ctx._drawRetryT = null;   // 等价 onLoad 初始化
      def._drawTrend.call(ctx);
      assert.strictEqual(execN, 1);
      assert.strictEqual(ctx._canvasDrawn, false, '节点未就绪 → 首次不绘制（旧实现就此静默空白）');
      await sleep(260);
      assert.strictEqual(execN, 2, '应补一次重绘');
      assert.strictEqual(ctx._canvasDrawn, true, '节点就绪后补绘成功');
      assert.ok(calls.indexOf('stroke') >= 0, '补绘应实际画线');
      assert.strictEqual(node.width, 600, 'DPR=2 → canvas 物理宽 600');
      await sleep(250);
      assert.strictEqual(execN, 2, '兜底重绘最多 1 次，不循环');
    });


    /* ============================================================
       C. utils/diag.js 纯逻辑（分组 / 状态 / 延迟覆盖 / 心跳离线 / 快照兜底 / 汇总）
       ============================================================ */
    const now0 = Date.now();
    function rowsOf(over) {
      const base = [
        { id: 'cloudbase', kind: 'cloud', status: 'ok', detail: '网关心跳', checked_at: now0 - 60000 },
        { id: 'site_static', kind: 'static', status: 'ok', detail: '站点资源正常', checked_at: now0 - 120000 },
        { id: 'site_tls', kind: 'static', status: 'warn', detail: '证书 20 天后到期', checked_at: now0 - 180000 },
        // 2026-11-07 v2（18 行 / 5 组）：新增 5 个 kind=cloud 行（云端巡检 4 个业务心跳 + 巡检自身）
        { id: 'dns_domain', kind: 'cloud', status: 'ok', detail: '解析正常', checked_at: now0 - 60000 },
        { id: 'tt_cloud', kind: 'cloud', status: 'ok', detail: '云端快照 2 小时前同步', checked_at: now0 - 60000 },
        { id: 'cloud_power_sync', kind: 'cloud', status: 'ok', detail: '最近同步 20 分钟前', checked_at: now0 - 60000 },
        { id: 'cloud_xgj_sync', kind: 'cloud', status: 'ok', detail: '最近同步 40 分钟前', checked_at: now0 - 60000 },
        { id: 'cloud_health_probe', kind: 'cloud', status: 'ok', detail: '本轮完成 · 18 行 · 320ms', checked_at: now0 - 60000 },
        { id: 'collector_host', kind: 'local', status: 'ok', detail: '内存 42%', checked_at: now0 - 60000 },
        { id: 'qqflow', kind: 'local', status: 'ok', detail: '已连 QQ', checked_at: now0 - 60000 },
        { id: 'weflow', kind: 'local', status: 'warn', detail: '微信重连中', checked_at: now0 - 60000 },
        { id: 'watcher', kind: 'local', status: 'ok', detail: '', checked_at: now0 - 60000 },
        { id: 'briefdesk', kind: 'local', status: 'ok', detail: '', checked_at: now0 - 60000 },
        { id: 'qq_client', kind: 'local', status: 'ok', detail: '', checked_at: now0 - 60000 },
        { id: 'wechat_client', kind: 'local', status: 'ok', detail: '', checked_at: now0 - 60000 },
        { id: 'jwxt', kind: 'local', status: 'ok', detail: '', checked_at: now0 - 60000 },
        { id: 'hwauto', kind: 'local', status: 'ok', detail: '', checked_at: now0 - 60000 },
        { id: 'ai', kind: 'local', status: 'ok', detail: '', checked_at: now0 - 60000 }
      ];
      (over || []).forEach(function (r) {
        const i = base.findIndex(function (x) { return x.id === r.id; });
        if (i >= 0) base[i] = Object.assign({}, base[i], r); else base.push(r);
      });
      return base;
    }

    await test('diag：分组 5 组 18 行；状态中文；cloudbase 用本次延迟覆盖（<3s ok / ≥3s warn）', function () {
      purge();
      const diag = R('utils/diag.js');
      const v = diag.build({ cloud: { ok: true, latency: 120, list: rowsOf() }, lastDone: true, now: now0 });
      assert.deepStrictEqual(v.groups.map(function (g) { return g.t; }), ['站点与网页', '云端后台', '信息采集', '定时任务', '采集主机']);
      assert.strictEqual(v.groups.map(function (g) { return g.items.length; }).reduce(function (a, b) { return a + b; }, 0), 18);
      assert.deepStrictEqual(v.groups.map(function (g) { return g.items.length; }), [3, 5, 6, 3, 1], '各组行数 站点3 / 云端5 / 信息采集6 / 定时任务3 / 采集主机1');
      const cb = v.flat.filter(function (x) { return x.id === 'cloudbase'; })[0];
      assert.strictEqual(cb.st, 'ok');
      assert.strictEqual(cb.detail, '小程序直连 120ms');
      assert.strictEqual(cb.side, '120ms');
      const slow = diag.build({ cloud: { ok: true, latency: 3500, list: rowsOf() }, lastDone: true, now: now0 });
      assert.strictEqual(slow.flat.filter(function (x) { return x.id === 'cloudbase'; })[0].st, 'warn', '≥3s 应「注意」');
      assert.strictEqual(v.summary.text, '2 项注意', 'site_tls warn + weflow warn（主机/巡检心跳均新鲜，不降级）');
      // 名称/中文映射（新增 5 行与旧行）
      assert.strictEqual(v.flat.filter(function (x) { return x.id === 'site_tls'; })[0].display, '注意');
      assert.strictEqual(v.flat.filter(function (x) { return x.id === 'qqflow'; })[0].name, 'QQ 消息采集');
      const names = { dns_domain: '域名解析', tt_cloud: '课表云端数据', cloud_power_sync: '电费云同步', cloud_xgj_sync: '学工记云同步', cloud_health_probe: '云端巡检' };
      Object.keys(names).forEach(function (id) {
        assert.strictEqual(v.flat.filter(function (x) { return x.id === id; })[0].name, names[id], id + ' 名称');
      });
      assert.strictEqual(diag.KINDS.dns_domain, 'cloud');
      assert.strictEqual(diag.KINDS.tt_cloud, 'cloud');
      assert.strictEqual(diag.KINDS.cloud_power_sync, 'cloud');
      assert.strictEqual(diag.KINDS.cloud_xgj_sync, 'cloud');
      assert.strictEqual(diag.KINDS.cloud_health_probe, 'cloud');
      assert.strictEqual(diag.KINDS.site_static, 'static', '站点行仍为 static（不参与巡检降级）');
    });

    await test('diag：云端巡检心跳缺失/超 15 分钟 → 其它 cloud 行 ok→warn 并追加「巡检未更新」', function () {
      purge();
      const diag = R('utils/diag.js');
      // A) 巡检行 20 分钟前（stale）→ cloud 行全部降级；cloudbase 由实时延迟覆盖、static/local 不参与
      const oldProbe = now0 - 20 * 60 * 1000;
      const v = diag.build({
        cloud: { ok: true, latency: 100, list: rowsOf([{ id: 'cloud_health_probe', checked_at: oldProbe }]) },
        lastDone: true, now: now0
      });
      const item = function (x) { return v.flat.filter(function (r) { return r.id === x; })[0]; };
      assert.strictEqual(item('tt_cloud').st, 'warn', '巡检过期 → tt_cloud 注意');
      assert.strictEqual(item('tt_cloud').detail, '云端快照 2 小时前同步 · 巡检未更新');
      assert.strictEqual(item('cloud_power_sync').st, 'warn');
      assert.ok(/· 巡检未更新$/.test(item('cloud_power_sync').detail), item('cloud_power_sync').detail);
      assert.strictEqual(item('cloud_health_probe').st, 'warn', '巡检行自身也提示过期（与网站同规则）');
      assert.ok(/· 巡检未更新$/.test(item('cloud_health_probe').detail), item('cloud_health_probe').detail);
      assert.strictEqual(item('dns_domain').st, 'warn', 'dns_domain 也是 cloud 行');
      assert.strictEqual(item('cloudbase').st, 'ok', 'cloudbase 使用本次请求延迟覆盖，不参与巡检降级');
      assert.strictEqual(item('cloudbase').detail, '小程序直连 100ms');
      assert.strictEqual(item('site_static').st, 'ok', 'static 行不参与巡检降级');
      assert.strictEqual(item('site_tls').st, 'warn', 'static 行保留自身云端状态');
      assert.strictEqual(item('qqflow').st, 'ok', 'local 行不受巡检心跳影响');
      assert.strictEqual(v.summary.text, '7 项注意', 'site_tls + weflow + 5 个 cloud 行（dns/tt/power/xgj/probe）');
      // B) 巡检行完全缺失 → 同样按过期处理
      const miss = diag.build({ cloud: { ok: true, latency: 100, list: rowsOf().filter(function (r) { return r.id !== 'cloud_health_probe'; }) }, lastDone: true, now: now0 });
      assert.strictEqual(miss.flat.filter(function (x) { return x.id === 'tt_cloud'; })[0].st, 'warn');
      assert.ok(/巡检未更新/.test(miss.flat.filter(function (x) { return x.id === 'tt_cloud'; })[0].detail));
      // C) 巡检新鲜（≤15 分钟）→ 不降级
      const fresh = diag.build({ cloud: { ok: true, latency: 100, list: rowsOf([{ id: 'cloud_health_probe', checked_at: now0 - 5 * 60 * 1000 }]) }, lastDone: true, now: now0 });
      assert.strictEqual(fresh.flat.filter(function (x) { return x.id === 'tt_cloud'; })[0].st, 'ok');
      assert.strictEqual(fresh.flat.filter(function (x) { return x.id === 'tt_cloud'; })[0].detail, '云端快照 2 小时前同步');
    });

    await test('diag：站点暂停语义 —— 云端 status=warn 的站点行直接展示「注意」且不被巡检过期改动', function () {
      purge();
      const diag = R('utils/diag.js');
      const pausedRows = rowsOf([
        { id: 'site_static', status: 'warn', detail: '网页已按备案安排暂停（备案暂停）', meta: { paused: true, note: '备案暂停' } },
        { id: 'site_tls', status: 'warn', detail: '网页已按备案安排暂停（备案暂停）', meta: { paused: true, note: '备案暂停' } },
        { id: 'dns_domain', status: 'ok', detail: '已暂停（符合预期）', meta: { host: 'tool.furina.fun', addrs: [], paused: true } },
        { id: 'cloud_health_probe', status: 'ok', checked_at: now0 - 20 * 60 * 1000 }      // 巡检本身也过期
      ]);
      const v = diag.build({ cloud: { ok: true, latency: 100, list: pausedRows }, lastDone: true, now: now0 });
      const item = function (x) { return v.flat.filter(function (r) { return r.id === x; })[0]; };
      assert.strictEqual(item('site_static').st, 'warn', '暂停行 = 注意（不是异常）');
      assert.strictEqual(item('site_static').display, '注意');
      assert.ok(/网页已按备案安排暂停/.test(item('site_static').detail), item('site_static').detail);
      assert.strictEqual(item('site_tls').st, 'warn');
      assert.strictEqual(item('dns_domain').st, 'warn', 'dns_domain 是 cloud 行：巡检过期 → 注意');
      assert.ok(/已暂停（符合预期） · 巡检未更新/.test(item('dns_domain').detail), item('dns_domain').detail);
      assert.strictEqual(v.summary.level, 'warn', '暂停期间显示注意而非异常');
      assert.deepStrictEqual(v.groups.map(function (g) { return g.t; }), ['站点与网页', '云端后台', '信息采集', '定时任务', '采集主机']);
    });

    await test('diag：采集主机心跳缺失/超 15 分钟 → 所有 local 行降级「离线」并显示上报时间', function () {
      purge();
      const diag = R('utils/diag.js');
      // 心跳 20 分钟前（stale）→ 离线；side 显示「上报于 HH:MM」
      const old = now0 - 20 * 60 * 1000;
      const v = diag.build({
        cloud: { ok: true, latency: 100, list: rowsOf([{ id: 'collector_host', checked_at: old }, { id: 'qqflow', status: 'ok', detail: '已连 QQ', checked_at: old }]) },
        lastDone: true, now: now0
      });
      const q = v.flat.filter(function (x) { return x.id === 'qqflow'; })[0];
      assert.strictEqual(q.st, 'offline');
      assert.strictEqual(q.display, '离线');
      assert.ok(/^上报于 \d\d:\d\d$/.test(q.side), 'side=' + q.side);
      assert.strictEqual(v.flat.filter(function (x) { return x.id === 'collector_host'; })[0].st, 'offline');
      assert.strictEqual(v.flat.filter(function (x) { return x.id === 'cloudbase'; })[0].st, 'ok', '云端行不受主机心跳影响');
      assert.strictEqual(v.summary.text, '采集主机离线');
      // 完全缺失 collector_host 行（但云端 ok）→ 同样降级离线
      const v2 = diag.build({ cloud: { ok: true, latency: 100, list: rowsOf().filter(function (r) { return r.id !== 'collector_host'; }) }, lastDone: true, now: now0 });
      assert.strictEqual(v2.summary.text, '采集主机离线');
    });

    await test('diag：云端失败 → cloudbase down + 云端数据不可用/离线降级；云端无行时 site_static/jwxt 退回课表快照新鲜度', function () {
      purge();
      const diag = R('utils/diag.js');
      // 云端失败且无缓存行：cloudbase down；local 行未知（不误报离线）
      const v = diag.build({ cloud: { ok: false, latency: 500, list: [], error: 'http500' }, rows: [], lastDone: true, now: now0 });
      const cb = v.flat.filter(function (x) { return x.id === 'cloudbase'; })[0];
      assert.strictEqual(cb.st, 'down');
      assert.strictEqual(cb.detail, '小程序直连失败');
      assert.strictEqual(v.flat.filter(function (x) { return x.id === 'qqflow'; })[0].st, 'unknown');
      assert.ok(/云端数据不可用/.test(v.flat.filter(function (x) { return x.id === 'qqflow'; })[0].detail));
      assert.strictEqual(v.summary.text, '1 项异常');
      assert.deepStrictEqual(v.hint, { cls: 'err', text: '云端连接失败' });
      // 云端 ok 但无行（未上报）
      const v2 = diag.build({ cloud: { ok: true, latency: 90, list: [] }, lastDone: true, now: now0 });
      assert.deepStrictEqual(v2.hint, { cls: '', text: '暂无上报数据' });
      // site_static / jwxt 无行 → 用本机课表快照 fetchedAt 兜底（≤30h ok / ≤54h warn / 其他 down）
      const j1 = diag.build({ cloud: { ok: true, latency: 90, list: [] }, lastDone: true, now: now0, ttFetchedAt: now0 - 20 * 3600 * 1000 });
      assert.strictEqual(j1.flat.filter(function (x) { return x.id === 'site_static'; })[0].st, 'ok');
      assert.ok(/课表快照 20 小时前/.test(j1.flat.filter(function (x) { return x.id === 'site_static'; })[0].detail));
      const j2 = diag.build({ cloud: { ok: true, latency: 90, list: [] }, lastDone: true, now: now0, ttFetchedAt: now0 - 40 * 3600 * 1000 });
      assert.strictEqual(j2.flat.filter(function (x) { return x.id === 'site_static'; })[0].st, 'warn');
      assert.strictEqual(j2.flat.filter(function (x) { return x.id === 'jwxt'; })[0].st, 'offline', '云端无 collector_host 行 → local 行降级离线（网站同规则）');
      const j3 = diag.build({ cloud: { ok: true, latency: 90, list: [] }, lastDone: true, now: now0, ttFetchedAt: now0 - 60 * 3600 * 1000 });
      assert.strictEqual(j3.flat.filter(function (x) { return x.id === 'site_static'; })[0].st, 'down');
      // 未检测完成
      const j4 = diag.build({ cloud: null, rows: [], lastDone: false, now: now0 });
      assert.strictEqual(j4.summary.text, '检测中');
    });

    /* ============================================================
       D. pages/diag：非管理员 0 请求/无入口；管理员读取 + 分组渲染 + 60s 刷新；失败降级
       ============================================================ */
    const HEALTH_ROWS = function () {
      return rowsOf().map(function (r) {
        return { id: r.id, name: diagName(r.id), kind: r.kind, status: r.status, detail: r.detail, meta: '', checked_at: r.checked_at };
      });
    };
    function diagName(id) {
      const map = { cloudbase: '云端数据库', site_static: '站点资源', site_tls: '站点证书', dns_domain: '域名解析', tt_cloud: '课表云端数据', cloud_power_sync: '电费云同步', cloud_xgj_sync: '学工记云同步', cloud_health_probe: '云端巡检', collector_host: '采集主机', qqflow: 'QQ 消息采集', weflow: '微信消息采集', watcher: '文档/通知监听', briefdesk: '本地通知服务', ai: 'AI 识别', jwxt: '教务课表同步', hwauto: '作业自动整理', qq_client: 'QQ 客户端', wechat_client: '微信客户端' };
      return map[id] || id;
    }
    // 诊断 v2.1 夹具（2026-11-09）：AI 分析结论 + 修复任务（契约 CONTRACT_V2_1 §A）。
    // related.health_ids / related.checks 决定下挂位置；cause 故意带 IP / Windows 路径 → 断言显示脱敏。
    function ANALYSIS_ROW(over) {
      const t = Date.now();
      return Object.assign({
        id: 'an-test-1', ts: t - 60000, platform: 'all', scope: 'cloud', severity: 'error',
        title: '云端巡检延迟升高', cause: '采集主机 10.0.0.8 排队；日志 C:\\briefdesk\\logs\\agent.log 可见',
        suggestion: ['重测依赖服务', '若仍异常则重启采集主机'], fixable: true, action: 'recheck_health',
        status: 'fixed', confidence: 0.86,
        flow: [
          { t: t - 50000, text: '检测到 cloud_health_probe 延迟 3500ms', st: 'done' },
          { t: t - 40000, text: '已执行 recheck_health，恢复正常', st: 'done' }
        ],
        related: {}
      }, over || {});
    }
    function REPAIR_ROW(over) {
      return Object.assign({
        id: 'rep-test-1', created_at: Date.now() - 30000, action: 'recheck_health', params: {},
        reason: '巡检延迟', status: 'done', claimed_at: Date.now() - 29000, finished_at: Date.now() - 20000,
        result: '18 行 · 320ms', analysis_id: 'an-test-1', node: 'local'
      }, over || {});
    }
    // 诊断页测试 ctx（补齐 onLoad 初始化 + v2.1 私有状态；setInterval 由用例 finally 里 onHide 清掉）
    function diagCtx(def, extra) {
      return ctxOf(def, Object.assign({
        _timer: null, _diagTimer: null, _busy: false, _diagBusy: false, _rows: [], _lastTry: 0,
        _lastDone: false, _cloud: null, _agentInfo: null, _analyses: [], _repairs: [],
        _groups: [], _devRaw: [], _devSummary: null, _devTs: '',
        _openMap: {}, _othersOpen: false, _diagAt: 0, _devReported: false
      }, extra || {}));
    }
    function diagStop(def, ctx) { try { def.onHide.call(ctx); } catch (e) { /* ignore */ } }
    // 在服务健康分组里找一行 / 在设备检查里找一项
    function rowOf(groups, id) {
      let hit = null;
      (groups || []).forEach(function (g) { (g.items || []).forEach(function (it) { if (it.id === id) hit = it; }); });
      return hit;
    }
    function checkOf(checks, id) {
      return (checks || []).filter(function (c) { return c.id === id; })[0] || null;
    }
    // 课表页测试 ctx（补齐 onLoad 初始化、但由测试显式控制的页面私有状态；不依赖 wx 真机）
    function ttPageCtx(def) {
      return ctxOf(def, {
        _agent: null, _agentQ: null, _agentApplied: false, _shared: null, _first: true, _fetching: false,
        _courses: [], _term: '', _meta: null, _wk: null, _day: null, _dayUser: false, _remoteOk: false,
        _gridOverflow: false, _gridX: 0, _gridMaxX: 0, _sw: null, _swAnim: false, _swTimers: [], _swSeq: 0,
        _supTap: 0, _mine: false, _loginJob: '', _loginTimer: null, _loginDeadline: 0, _hoForce: false
      });
    }

    /* ============================================================
       D. pages/diag 诊断 v2.1（2026-11-09）：全班可见 + AI 下挂异常项 + 折叠展开 + 10s 进展 + 设备信息最小化
       ============================================================ */
    await test('diag v2.1 页：非管理员可见；AI 按 related.health_ids/checks 下挂；折叠态/展开态；10s 定时器 + onHide 停止', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID2);                     // 非管理员
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      const now = Date.now();
      C.setReq(function (o) {
        const u = String(o.url || '');
        if (u.indexOf('/service_health') >= 0) return o.success({ statusCode: 200, data: HEALTH_ROWS() });
        if (u.indexOf('rpc/diag_agent_info') >= 0) return o.success({ statusCode: 200, data: { ok: true, online: true, seen_at: now - 30000, host: 'local-windows', version: '1.2.0' } });
        if (u.indexOf('/diag_analysis') >= 0) {
          return o.success({
            statusCode: 200, data: [
              ANALYSIS_ROW({ id: 'an-health', related: { health_ids: ['site_tls'], repair_id: 'rep-test-1' } }),
              ANALYSIS_ROW({ id: 'an-check', ts: now - 20000, title: '网关延迟升高', scope: 'device', status: 'running', severity: 'warn', fixable: true, related: { checks: ['gateway'] } }),
              ANALYSIS_ROW({ id: 'an-fix', ts: now - 25000, title: '前端错误可自动修复', scope: 'cloud', status: 'new', severity: 'error', fixable: true, related: { checks: ['js'] } }),
              ANALYSIS_ROW({ id: 'an-other', ts: now - 30000, title: '历史遗留结论', status: 'new', severity: 'info', fixable: false, related: {} })
            ]
          });
        }
        if (u.indexOf('/repair_tasks') >= 0) return o.success({ statusCode: 200, data: [REPAIR_ROW()] });
        if (u.indexOf('/site_assets') >= 0) return o.success({ statusCode: 200, data: [{ id: 'tt' }] });
        return o.success({ statusCode: 200, data: [] });
      });
      const def = loadPage('diag/diag');
      const ctx = diagCtx(def);
      C.reqLog().length = 0;
      try {
        def.onLoad.call(ctx, {});
        assert.strictEqual(ctx.data.state, 'loading');
        def.onShow.call(ctx);
        const ok1 = await waitFor(function () {
          const tls = rowOf(ctx.data.groups, 'site_tls');
          const gw = checkOf(ctx.data.dev.checks, 'gateway');
          return ctx.data.state === 'ready' && ctx.data.dev.checks.length === 10 && tls && tls.ai.length === 1 && gw && gw.ai.length === 1;
        }, 5000);
        assert.ok(ok1, '非管理员应完成健康 + 设备 + AI 下挂（state=' + ctx.data.state + '）');
        assert.strictEqual(ctx.data.denied, false, '非管理员不应 denied');
        // 服务健康 18 行保留；异常行下挂 AI（折叠态一行）
        assert.strictEqual(ctx.data.groups.reduce(function (a, g) { return a + g.items.length; }, 0), 18);
        const tls = rowOf(ctx.data.groups, 'site_tls');
        assert.strictEqual(tls.ai.length, 1);
        assert.strictEqual(tls.ai[0].id, 'an-health');
        assert.strictEqual(tls.ai[0].open, false, '默认折叠');
        assert.strictEqual(tls.ai[0].statusPill, '已修复', 'fixed → 已修复');
        assert.strictEqual(tls.ai[0].fixableMark, '⚙', 'fixable → ⚙');
        assert.ok(tls.ai[0].titleShort.length <= 23, '标题 ≤22 字 + 省略号');
        assert.strictEqual(tls.queueHint, '', '有 AI 时不显示排队提示');
        // 设备检查行下挂 related.checks；设备端问题显示「建议」且不显示 ⚙
        const gw = checkOf(ctx.data.dev.checks, 'gateway');
        assert.strictEqual(gw.ai.length, 1);
        assert.strictEqual(gw.ai[0].id, 'an-check');
        assert.strictEqual(gw.ai[0].statusPill, '修复中', 'running → 修复中');
        assert.strictEqual(gw.ai[0].deviceHint, '建议', '设备端问题显示 建议');
        assert.strictEqual(gw.ai[0].fixableMark, '', '设备端不显示 ⚙');
        assert.strictEqual(checkOf(ctx.data.dev.checks, 'js').ai.length, 1, 'related.checks=js 下挂到前端错误行');
        // 异常行无 AI → 本机在线提示「AI 分析排队中…」
        const wf = rowOf(ctx.data.groups, 'weflow');
        assert.strictEqual(wf.ai.length, 0);
        assert.strictEqual(wf.queueHint, 'AI 分析排队中…');
        // 展开：显示原因/建议/flow/关联修复；再点收起
        def.toggleAnalysis.call(ctx, { currentTarget: { dataset: { aid: 'an-health' } } });
        const tls2 = rowOf(ctx.data.groups, 'site_tls');
        assert.strictEqual(tls2.ai[0].open, true);
        assert.ok(tls2.ai[0].cause.indexOf('10.0.0.8') < 0, '显示脱敏：IP 不应出现');
        assert.ok(tls2.ai[0].cause.indexOf('briefdesk') < 0, '显示脱敏：Windows 路径不应出现');
        assert.strictEqual(tls2.ai[0].suggestions.length, 2, '展开显示建议');
        assert.strictEqual(tls2.ai[0].flow.length, 2, '展开显示流程时间线');
        assert.strictEqual(tls2.ai[0].flow[0].stText, '完成');
        assert.ok(tls2.ai[0].repair && tls2.ai[0].repair.id === 'rep-test-1', '展开显示关联修复');
        assert.strictEqual(tls2.ai[0].repair.statusText, '已完成');
        def.toggleAnalysis.call(ctx, { currentTarget: { dataset: { aid: 'an-health' } } });
        assert.strictEqual(rowOf(ctx.data.groups, 'site_tls').ai[0].open, false, '再次点击收起');
        // 「其它诊断」：无关联结论默认收起，只显示条数
        assert.strictEqual(ctx.data.others.count, 1, '无关联 AI 进其它诊断');
        assert.strictEqual(ctx.data.others.open, false, '其它诊断默认收起');
        assert.strictEqual(ctx.data.others.items[0].id, 'an-other');
        def.toggleOthers.call(ctx);
        assert.strictEqual(ctx.data.others.open, true);
        def.toggleOthers.call(ctx);
        assert.strictEqual(ctx.data.others.open, false);
        // 顶部摘要：可自动修复 N · 已修复 M
        assert.strictEqual(ctx.data.diagStats.show, true);
        assert.strictEqual(ctx.data.diagStats.autoFixN, 1, 'an-fix（new/fixable/非设备）= 可自动修复 1');
        assert.strictEqual(ctx.data.diagStats.fixedN, 1, 'an-health = 已修复 1');
        assert.strictEqual(ctx.data.diagStats.text, '可自动修复 1 · 已修复 1');
        // v2.1 删除独立 AI / 修复卡数据；保留 10s 诊断轮询 + 60s 健康刷新
        assert.strictEqual(typeof ctx.data.analyses, 'undefined', '不再有独立 AI 卡数据');
        assert.strictEqual(typeof ctx.data.repairs, 'undefined', '不再有独立修复卡数据');
        assert.ok(/^\d\d:\d\d:\d\d$/.test(ctx.data.diagAtText), 'last update HH:MM:SS');
        assert.ok(ctx._timer, '应启动 60s 服务健康定时器');
        assert.ok(ctx._diagTimer, '应启动 10s 诊断轮询定时器');
        assert.ok(C.urlsOf('/service_health').length >= 1, '非管理员也应请求 service_health');
        assert.ok(C.urlsOf('rpc/diag_agent_info').length >= 1);
        assert.ok(/diag_analysis\?select=\*&order=ts\.desc&limit=20/.test(C.urlsOf('/diag_analysis')[0].url));
      } finally { diagStop(def, ctx); }
      assert.strictEqual(ctx._timer, null, 'onHide 应停止 60s 定时器');
      assert.strictEqual(ctx._diagTimer, null, 'onHide 应停止 10s 轮询定时器');
    });

    await test('diag v2.1 页：本机离线 → 异常行提示「本机离线，已留存待开机修复」', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID2);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      C.setReq(function (o) {
        const u = String(o.url || '');
        if (u.indexOf('/service_health') >= 0) return o.success({ statusCode: 200, data: HEALTH_ROWS() });
        if (u.indexOf('rpc/diag_agent_info') >= 0) return o.success({ statusCode: 200, data: { ok: true, online: false, seen_at: 0, host: '', version: '' } });
        if (u.indexOf('/diag_analysis') >= 0) return o.success({ statusCode: 200, data: [] });
        if (u.indexOf('/site_assets') >= 0) return o.success({ statusCode: 200, data: [{ id: 'tt' }] });
        return o.success({ statusCode: 200, data: [] });
      });
      const def = loadPage('diag/diag');
      const ctx = diagCtx(def);
      try {
        def.onLoad.call(ctx, {});
        def.onShow.call(ctx);
        const ok1 = await waitFor(function () { return ctx.data.state === 'ready' && ctx.data.agent.online === false && rowOf(ctx.data.groups, 'weflow'); }, 4000);
        assert.ok(ok1);
        assert.strictEqual(rowOf(ctx.data.groups, 'weflow').queueHint, '本机离线，已留存待开机修复');
        assert.strictEqual(rowOf(ctx.data.groups, 'site_tls').queueHint, '本机离线，已留存待开机修复');
        assert.strictEqual(rowOf(ctx.data.groups, 'cloudbase').queueHint, '', '正常行不显示排队提示');
        assert.strictEqual(ctx.data.others.count, 0, '无 AI → 其它诊断不显示');
        assert.strictEqual(ctx.data.diagStats.show, false);
      } finally { diagStop(def, ctx); }
    });

    await test('diag v2.1 页：设备异常自动上报（detail 必带 check + §B 白名单 + sid/脱敏 + 10 分钟 fingerprint 限频）', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID2);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      C.wxMock.getDeviceInfo = function () { return { brand: 'X', model: '10.0.0.1', system: 'Android 14', platform: 'android', language: 'zh_CN' }; };
      C.wxMock.getNetworkType = function (o) { if (o && o.success) o.success({ networkType: '3g' }); };
      C.setReq(function (o) {
        const u = String(o.url || '');
        if (u.indexOf('/service_health') >= 0) return o.success({ statusCode: 200, data: HEALTH_ROWS() });
        if (u.indexOf('rpc/diag_agent_info') >= 0) return o.success({ statusCode: 200, data: { ok: true, online: false, seen_at: 0, host: '', version: '' } });
        if (u.indexOf('/diag_analysis') >= 0) return o.success({ statusCode: 200, data: [] });
        if (u.indexOf('/site_assets') >= 0) return o.success({ statusCode: 200, data: [] });   // 快照不可用 → 注意
        return o.success({ statusCode: 200, data: [] });
      });
      const def = loadPage('diag/diag');
      const ctx = diagCtx(def);
      try {
        def.onLoad.call(ctx, {});
        def.onShow.call(ctx);
        const posted = await waitFor(function () { return C.urlsOf('client_diag').length >= 1; }, 4000);
        assert.ok(posted, '设备异常应自动上报 client_diag');
        const post = C.urlsOf('client_diag')[0];
        assert.strictEqual(post.method, 'POST');
        assert.ok(/\/client_diag$/.test(post.url));
        assert.strictEqual(post.data.length, 2, '3G(warn) + 课表快照不可用(warn) → 2 行（同次≤3）');
        const ids = post.data.map(function (r) { return r.detail.check; });
        assert.deepStrictEqual(ids.sort(), ['network', 'timetable'], 'detail.check 与 deviceChecks 的检查 id 一致：' + ids);
        const DEVICE_KEYS = ['platform', 'osVersion', 'baseLib', 'screen', 'memoryMB', 'storagePct', 'network', 'clockSkewMs'];
        const DETAIL_KEYS = ['check', 'latency_ms', 'storage_pct', 'clock_skew_ms', 'err_count', 'code'];
        post.data.forEach(function (row) {
          assert.ok(/^mp_/.test(row.id));
          assert.strictEqual(row.platform, 'mp');
          assert.strictEqual(row.app_ver, '2.0.4');
          assert.strictEqual(row.sid, ID2.sid, 'client_diag RLS 要求 sid = auth_sid()（由 cloud.diagReport 补）');
          assert.ok(/^mp_[0-9a-f]+$/.test(row.fingerprint));
          assert.deepStrictEqual(Object.keys(row.device).sort(), DEVICE_KEYS.slice().sort(), '§B：device 只允许 8 个白名单字段');
          Object.keys(row.detail).forEach(function (k) { assert.ok(DETAIL_KEYS.indexOf(k) >= 0, '非法 detail 字段 ' + k); });
          assert.ok(row.detail.check, 'detail.check 必带（agent 生成 related.checks）');
        });
        const json = JSON.stringify(post.data);
        assert.ok(json.indexOf('10.0.0.1') < 0 && json.indexOf('brand') < 0 && json.indexOf('language') < 0, '上报不得含品牌/型号/语言');
        assert.ok(json.indexOf('测试辛') < 0 && json.indexOf('token') < 0, '上报不得含姓名/token');
        assert.ok(/已上报/.test(ctx.data.reportText), 'reportText=' + ctx.data.reportText);
        // 限频：同 fingerprint 10 分钟内再上报 → 不再 POST
        const before = C.urlsOf('client_diag').length;
        ctx._devRaw = [{ id: 'memory', name: '内存', st: 'warn', display: '注意', detail: 'x' }];
        const base = {
          appVer: '2.0.0',
          device: { platform: 'mp', osVersion: 'Android 14', baseLib: '3.0.0', screen: { w: 390, h: 844, dpr: 3 }, memoryMB: 1024, storagePct: 10, network: '4g', clockSkewMs: 0 },
          memoryWarn: 1, storage: { ok: true, currentSize: 1, limitSize: 100 },
          network: '4g', gateway: { ok: true, latency: 100 }, siteAssets: { ok: true, checked: true }, jsErrors: 0
        };
        const r1 = await ctx._report(null, base, true);
        assert.strictEqual(r1, true, '首次手动上报应成功');
        assert.strictEqual(C.urlsOf('client_diag').length, before + 1);
        const manual = C.urlsOf('client_diag')[before];
        assert.strictEqual(manual.data[0].detail.check, 'memory');
        assert.ok(manual.data[0].detail.err_count >= 1, '内存项 detail 带 err_count');
        const r2 = await ctx._report(null, base, true);
        assert.strictEqual(r2, false, '同 fingerprint 10 分钟内应被限频');
        assert.strictEqual(C.urlsOf('client_diag').length, before + 1, '限频时不得再请求');
        const rate = JSON.parse(C.mem['zq_diag_report_v1'] || '{}');
        Object.keys(rate).forEach(function (k) { assert.ok(/^mp_[0-9a-f]+$/.test(k)); });
      } finally { diagStop(def, ctx); }
    });

    await test('diag v2.1：deviceChecks 10 项（新检查 id / 去品牌型号语言 / detail 只出现白名单量）+ 摘要', function () {
      purge();
      const diag = R('utils/diag.js');
      const input = {
        appVer: '2.0.0',
        device: {
          platform: 'mp', osVersion: 'Android 14', baseLib: '2.25.0',
          screen: { w: 390, h: 844, dpr: 3 }, memoryMB: 2048,
          storagePct: 88, network: '3g', clockSkewMs: 120000
        },
        memoryWarn: 2, storage: { ok: true, currentSize: 9000, limitSize: 10240 },
        network: '3g', gateway: { ok: true, latency: 500 }, siteAssets: { ok: true, checked: true }, jsErrors: 3
      };
      const v = diag.deviceChecks(input);
      assert.strictEqual(v.checks.length, 10, '设备诊断 10 项');
      const by = {};
      v.checks.forEach(function (c) { by[c.id] = c; });
      assert.deepStrictEqual(Object.keys(by), ['app', 'sdk', 'screen', 'memory', 'storage', 'network', 'gateway', 'clock', 'timetable', 'js'],
        '检查 id 与 agent related.checks 对齐（app/sdk/screen/memory/storage/network/gateway/clock/timetable/js）');
      // detail 只出现 §B 白名单量（无品牌/型号/语言）
      assert.strictEqual(by.screen.detail, 'Android 14 · 390×844 @3x');
      assert.strictEqual(by.memory.detail, '2048MB · 告警 2 次');
      assert.strictEqual(by.storage.detail, '88%');
      assert.strictEqual(by.gateway.detail, '500ms');
      assert.strictEqual(by.clock.detail, '+2min');
      assert.ok(!/Xiaomi|M2012|zh_CN|Android.*Android/.test(JSON.stringify(v.checks)));
      assert.strictEqual(by.sdk.st, 'warn', '2.25.0 → 注意');
      assert.strictEqual(by.memory.st, 'warn');
      assert.strictEqual(by.storage.st, 'warn', '88% → 注意');
      assert.strictEqual(by.network.st, 'warn', '3G → 注意');
      assert.strictEqual(by.gateway.st, 'ok');
      assert.strictEqual(by.clock.st, 'warn', '时钟偏差 2min → 注意');
      assert.strictEqual(by.js.st, 'warn');
      assert.strictEqual(v.summary.text, '6 项注意');
      // 严重项：旧基础库 / 存储不可用 / 无网络 / 网关失败 / 时钟偏差过大 → down
      const bad = diag.deviceChecks({
        appVer: '2.0.0',
        device: { platform: 'mp', osVersion: 'iOS 17', baseLib: '2.9.0', screen: { w: 390, h: 844, dpr: 3 }, memoryMB: 0, storagePct: 0, network: 'none', clockSkewMs: 11 * 60 * 1000 },
        memoryWarn: 0, storage: { ok: false }, network: 'none', gateway: { ok: false, error: 'http500' },
        siteAssets: { ok: false, checked: true }, jsErrors: 0
      });
      const badBy = {};
      bad.checks.forEach(function (c) { badBy[c.id] = c; });
      assert.strictEqual(badBy.sdk.st, 'down');
      assert.strictEqual(badBy.storage.st, 'down');
      assert.strictEqual(badBy.network.st, 'down');
      assert.strictEqual(badBy.gateway.st, 'down');
      assert.strictEqual(badBy.clock.st, 'down', '11min → 异常');
      assert.strictEqual(badBy.timetable.st, 'warn');
      assert.strictEqual(bad.summary.level, 'down');
      // 时钟未知 → info（不误报）
      const noClock = diag.deviceChecks({ appVer: '2.0.0', device: { platform: 'mp', osVersion: '', baseLib: '3.0.0', screen: { w: 0, h: 0, dpr: 0 }, memoryMB: 0, storagePct: 0, network: 'wifi', clockSkewMs: null }, storage: { ok: true, currentSize: 0, limitSize: 100 }, network: 'wifi', gateway: { ok: true, latency: 10 }, siteAssets: { ok: true, checked: true }, jsErrors: 0 });
      assert.strictEqual(barCheck(noClock, 'clock').st, 'info');
      function barCheck(vv, id) { return vv.checks.filter(function (c) { return c.id === id; })[0]; }
      // 显示脱敏（IP / Windows 路径 / URL / token=）
      const red = diag.redact('IP 10.1.2.3 路径 C:\\Users\\a\\b 链接 https://x.test/y?q=1 token=abc');
      ['10.1.2.3', 'C:\\', 'https://', 'token='].forEach(function (k) {
        assert.ok(red.indexOf(k) < 0, '脱敏后不应出现 ' + k + '：' + red);
      });
    });

    await test('diag v2.1：deviceSafe / buildReportRows 仅 §B 白名单（device 8 字段、detail 必带 check 且字段受限）', function () {
      purge();
      const diag = R('utils/diag.js');
      assert.deepStrictEqual(diag.DEVICE_WHITELIST, ['platform', 'osVersion', 'baseLib', 'screen', 'memoryMB', 'storagePct', 'network', 'clockSkewMs']);
      assert.deepStrictEqual(diag.DETAIL_WHITELIST, ['check', 'latency_ms', 'storage_pct', 'clock_skew_ms', 'err_count', 'code']);
      const input = {
        appVer: '2.0.0',
        device: {
          platform: 'mp', osVersion: 'Android 14', baseLib: '3.0.0',
          screen: { w: 390, h: 844, dpr: 3 }, memoryMB: 2048,
          storagePct: 42, network: '4g', clockSkewMs: 1500,
          // 旧字段即使传了也不得出现在白名单输出里
          brand: 'Xiaomi', model: 'M2012', language: 'zh_CN'
        },
        storage: { ok: true, currentSize: 4200, limitSize: 10000 },
        gateway: { ok: true, latency: 321 }, siteAssets: { ok: true, checked: true }, jsErrors: 2,
        network: '4g'
      };
      const safe = diag.deviceSafe(input);
      assert.deepStrictEqual(Object.keys(safe).sort(), diag.DEVICE_WHITELIST.slice().sort(), 'deviceSafe 只输出白名单 8 字段');
      assert.deepStrictEqual(safe.screen, { w: 390, h: 844, dpr: 3 });
      assert.strictEqual(safe.osVersion, 'Android 14');
      assert.strictEqual(safe.baseLib, '3.0.0');
      assert.strictEqual(safe.memoryMB, 2048);
      assert.strictEqual(safe.storagePct, 42);
      assert.strictEqual(safe.clockSkewMs, 1500);
      assert.strictEqual(safe.model, undefined);
      assert.strictEqual(safe.language, undefined);
      // 上报行：detail 必带 check，其余字段全部在白名单内；device 同白名单
      const rows = diag.buildReportRows([
        { id: 'network', st: 'warn' }, { id: 'gateway', st: 'down' },
        { id: 'storage', st: 'down' }, { id: 'js', st: 'warn' },
        { id: 'clock', st: 'warn' }
      ], input, { appVer: '2.0.0', now: 1700000000000 });
      assert.strictEqual(rows.length, 3, '每次最多 3 条');
      rows.forEach(function (row) {
        assert.ok(row.detail.check, 'detail.check 必带');
        assert.ok(diag.DETAIL_WHITELIST.indexOf(row.detail.check) >= 0 || typeof row.detail.check === 'string');
        Object.keys(row.detail).forEach(function (k) {
          assert.ok(diag.DETAIL_WHITELIST.indexOf(k) >= 0, '非法 detail 字段：' + k);
        });
        assert.deepStrictEqual(Object.keys(row.device).sort(), diag.DEVICE_WHITELIST.slice().sort());
      });
      assert.strictEqual(rows[0].kind, 'network', 'network → kind=network');
      assert.strictEqual(rows[1].detail.check, 'gateway');
      assert.strictEqual(rows[1].detail.latency_ms, 321, '网关行带 latency_ms');
      assert.strictEqual(rows[1].detail.clock_skew_ms, 1500, '网关行带 clock_skew_ms');
      assert.strictEqual(rows[2].detail.check, 'storage');
      assert.strictEqual(rows[2].detail.storage_pct, 42);
      // fingerprint 稳定且只依赖白名单量
      const fpA = diag.fingerprintOf('network', 'gateway', '云端网关连接失败', safe);
      const fpB = diag.fingerprintOf('network', 'gateway', '云端网关连接失败', diag.deviceSafe(input));
      const fpC = diag.fingerprintOf('network', 'gateway', '云端网关连接失败', { platform: 'mp', osVersion: 'iOS 17', baseLib: '3.0.0', screen: { w: 390, h: 844, dpr: 3 } });
      assert.strictEqual(fpA, fpB);
      assert.notStrictEqual(fpA, fpC, '系统版本不同 → fingerprint 不同');
      // 旧形状（v2 device.brand/model/system/sdk）仍兼容归一，但输出仍最小化
      const legacy = diag.deviceSafe({ appVer: '2.0.0', device: { brand: 'X', model: 'Y', system: 'Android 13', sdk: '3.1.0', pixelRatio: 2, windowW: 360, windowH: 800 }, storage: { ok: true, currentSize: 1, limitSize: 100 }, network: 'wifi' });
      assert.deepStrictEqual(Object.keys(legacy).sort(), diag.DEVICE_WHITELIST.slice().sort());
      assert.strictEqual(legacy.osVersion, 'Android 13');
      assert.strictEqual(legacy.baseLib, '3.1.0');
      assert.strictEqual(legacy.model, undefined);
    });

    await test('diag v2.1：groupAnalyses 下挂映射 / 折叠文案 / 状态胶囊 / 排队提示 / 其它诊断 / 摘要统计', function () {
      purge();
      const diag = R('utils/diag.js');
      const now = Date.now();
      const groups = [{
        t: '云端后台', items: [
          { id: 'a', name: 'A', st: 'down', display: '异常', detail: '', side: '' },
          { id: 'b', name: 'B', st: 'ok', display: '正常', detail: '', side: '' },
          { id: 'c', name: 'C', st: 'warn', display: '注意', detail: '', side: '' }
        ]
      }];
      const checks = [
        { id: 'memory', name: '内存', st: 'warn', display: '注意', detail: 'x' },
        { id: 'gateway', name: '网关', st: 'ok', display: '通过', detail: '1ms' }
      ];
      const longTitle = '这是一个超过二十二个字的超长标题用来验证折叠行截断逻辑是否正确';
      const analyses = [
        { id: 'an1', ts: now - 1000, severity: 'error', title: 'A 问题', scope: 'cloud', status: 'new', fixable: true, cause: '原因', suggestion: ['建议1', '建议2'], flow: [{ t: now - 900, text: '步骤开始', st: 'run' }], related: { health_ids: ['a', 'b'], repair_id: '' } },
        { id: 'an2', ts: now - 2000, severity: 'warn', title: longTitle, scope: 'device', status: 'running', fixable: true, related: { checks: ['memory'] } },
        { id: 'an3', ts: now - 3000, severity: 'info', title: '历史遗留', scope: 'cloud', status: 'fixed', fixable: false, related: { health_ids: ['missing-row'] } },
        { id: 'an4', ts: now - 4000, severity: 'error', title: '失败项', scope: 'mixed', status: 'failed', fixable: false, related: {} }
      ];
      const repairs = [
        { id: 'rp1', analysis_id: 'an1', action: 'recheck_health', status: 'running', created_at: now - 500, reason: 'r', result: '' }
      ];
      const r = diag.groupAnalyses(analyses, groups, checks, repairs, { agentOnline: true, openMap: { an1: true }, now: now });
      // 一条 AI 同时挂两个 health_ids：只有异常行（a=down）挂，正常行（b=ok）不显示 AI（契约 §A.4）
      assert.strictEqual(r.groups[0].items[0].ai.length, 1, 'an1 → a（异常行）');
      assert.strictEqual(r.groups[0].items[1].ai.length, 0, '正常行不显示 AI 行');
      assert.strictEqual(r.groups[0].items[2].ai.length, 0);
      assert.strictEqual(r.groups[0].items[2].queueHint, 'AI 分析排队中…', '异常行无 AI → 在线提示');
      const a1 = r.groups[0].items[0].ai[0];
      assert.strictEqual(a1.statusPill, '待处理', 'new → 待处理');
      assert.strictEqual(a1.fixableMark, '⚙');
      assert.strictEqual(a1.open, true, 'openMap 展开态');
      assert.ok(a1.repair && a1.repair.id === 'rp1', 'repair_tasks.analysis_id 关联到展开态');
      // related.checks → 设备检查行
      assert.strictEqual(r.devChecks[0].ai.length, 1, 'an2 → memory');
      assert.strictEqual(r.devChecks[0].ai[0].isDevice, true);
      assert.strictEqual(r.devChecks[0].ai[0].deviceHint, '建议');
      assert.strictEqual(r.devChecks[0].ai[0].fixableMark, '');
      assert.strictEqual(r.devChecks[0].ai[0].statusPill, '修复中', 'running → 修复中');
      assert.strictEqual(r.devChecks[0].ai[0].titleShort.length, diag.AI_TITLE_MAX + 1, '长标题 22 字 + …');
      assert.ok(/…$/.test(r.devChecks[0].ai[0].titleShort));
      assert.strictEqual(r.devChecks[1].ai.length, 0);
      assert.strictEqual(r.devChecks[1].queueHint, '', '正常检查行不提示');
      // 无法归因 → 其它诊断（an3 关联行不存在、an4 无 related）
      assert.deepStrictEqual(r.others.items.map(function (x) { return x.id; }), ['an3', 'an4']);
      assert.strictEqual(r.others.count, 2);
      // 状态胶囊映射
      const pillOf = {};
      r.analyses.forEach(function (a) { pillOf[a.id] = a.statusPill; });
      assert.deepStrictEqual(pillOf, { an1: '待处理', an2: '修复中', an3: '已修复', an4: '修复失败' });
      // flow run 文案可见
      assert.strictEqual(r.analyses.filter(function (a) { return a.id === 'an1'; })[0].flow[0].stText, '进行中');
      // 摘要统计：an1 new+fixable（非设备）→ 可自动修复 1；an3 fixed → 已修复 1
      assert.strictEqual(r.stats.autoFixN, 1);
      assert.strictEqual(r.stats.fixedN, 1);
      assert.strictEqual(r.stats.text, '可自动修复 1 · 已修复 1');
      // 离线：异常无 AI → 已留存待开机修复
      const off = diag.groupAnalyses([], groups, checks, [], { agentOnline: false, now: now });
      assert.strictEqual(off.groups[0].items[2].queueHint, '本机离线，已留存待开机修复');
      assert.strictEqual(off.groups[0].items[0].queueHint, '本机离线，已留存待开机修复');
      assert.strictEqual(off.stats.show, false);
      // agent 状态未知 → 不显示提示（避免误导）
      const unknown = diag.groupAnalyses([], groups, checks, [], { agentKnown: false, now: now });
      assert.strictEqual(unknown.groups[0].items[2].queueHint, '');
      // 无 analysis 关联的历史修复 → 其它诊断
      const orphan = diag.groupAnalyses([], groups, checks, [{ id: 'rp2', action: 'sync_power', status: 'done', created_at: now }], { agentOnline: true, now: now });
      assert.strictEqual(orphan.others.repairs.length, 1);
      assert.strictEqual(orphan.others.count, 1);
    });

    await test('diag v2.1：analysisView 折叠字段（related/标题截断/状态胶囊/flow≤8）+ repairView 时间 + agentView', function () {
      purge();
      const diag = R('utils/diag.js');
      const now = Date.now();
      const longTitle = '一二三四五六七八九十一二三四五六七八九十一二三';
      const rows = [
        ANALYSIS_ROW({ id: 'an-a', ts: now - 1000, title: longTitle, related: { health_ids: 'site_tls, cloudbase', checks: ['js'], repair_id: 'rep-1' } }),
        ANALYSIS_ROW({ id: 'an-b', ts: now - 90000, title: '站点资源注意 192.168.1.9', suggestion: ['检查 https://tool.furina.fun/x?y=1'], status: 'running', severity: 'warn', scope: 'device', related: { checks: ['memory'] } }),
        ANALYSIS_ROW({ id: 'an-c', ts: now - 900000, status: 'failed', flow: [{ t: 1, text: 'a', st: 'done' }, { t: 2, text: 'b', st: 'run' }, { t: 3, text: 'c', st: 'fail' }, { t: 4, text: 'd', st: 'done' }, { t: 5, text: 'e', st: 'done' }, { t: 6, text: 'f', st: 'done' }, { t: 7, text: 'g', st: 'done' }, { t: 8, text: 'h', st: 'done' }, { t: 9, text: 'i', st: 'done' }, { t: 10, text: 'j', st: 'done' }] })
      ];
      const av = diag.analysisView(rows, now);
      assert.deepStrictEqual(av.map(function (a) { return a.id; }), ['an-a', 'an-b', 'an-c'], '按 ts 倒序');
      assert.strictEqual(av[0].titleShort.length, diag.AI_TITLE_MAX + 1, '≤22 字 + …');
      assert.deepStrictEqual(av[0].related.healthIds, ['site_tls', 'cloudbase'], 'related.health_ids 字符串也兼容拆分');
      assert.deepStrictEqual(av[0].related.checks, ['js']);
      assert.strictEqual(av[0].related.repairId, 'rep-1');
      assert.strictEqual(av[0].statusPill, '已修复');
      assert.strictEqual(av[0].statusKey, 'fixed');
      assert.strictEqual(av[0].fixableMark, '⚙');
      assert.strictEqual(av[1].statusPill, '修复中');
      assert.strictEqual(av[1].deviceHint, '建议');
      assert.strictEqual(av[1].statusText, '修复中');
      assert.strictEqual(av[2].statusPill, '修复失败');
      assert.ok(av[1].title.indexOf('192.168.1.9') < 0, '标题显示脱敏');
      assert.ok(av[1].suggestions[0].indexOf('https://') < 0, '建议显示脱敏');
      assert.strictEqual(av[2].flow.length, 8, 'flow 最多 8 步');
      assert.strictEqual(av[2].flow[1].stText, '进行中');
      // repairView：时间 / 状态 / 结果
      const rv = diag.repairView([REPAIR_ROW({ id: 'rep-a', finished_at: now - 1000 })]);
      assert.strictEqual(rv[0].actionText, '重测依赖服务');
      assert.strictEqual(rv[0].statusText, '已完成');
      assert.strictEqual(rv[0].statusKey, 'fixed');
      assert.ok(rv[0].createdText.length > 0 && rv[0].finishedText.length > 0, '关联修复显示开始-结束时间');
      // agentView
      assert.strictEqual(diag.agentView({ ok: true, online: true, seen_at: now - 30000, host: 'local-windows', version: '1.0.0' }, now).text, '在线');
      assert.strictEqual(diag.agentView([{ online: false, seen_at: 0, host: '', version: '' }], now).text, '离线');
      assert.strictEqual(diag.agentView(null, now).online, false);
      // 辅助：vcmp / flowSt / fmtSkew / shortTitle
      assert.strictEqual(diag.vcmp('2.20.0', '2.30.0'), -1);
      assert.strictEqual(diag.flowSt('running'), 'run');
      assert.strictEqual(diag.fmtSkew(1200), '+1.2s');
      assert.strictEqual(diag.fmtSkew(-120000), '−2min');
      assert.strictEqual(diag.shortTitle('abcdefghijklmnopqrstuvwxyz'), 'abcdefghijklmnopqrstuv…');
    });

    await test('cloud 诊断 v2.1：diagPing 带 serverTime（时钟偏差） / diagAnalyses/diagRepairs 失败保留旧值（null） / 既有 RPC 契约 / 无身份 0 请求', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID2);                        // 普通身份（非管理员）
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      C.setReq(function (o) { return o.success({ statusCode: 200, data: [] }); });
      C.reqLog().length = 0;
      // serviceHealth：非管理员也发请求（RLS 已放宽 auth_ok）
      const h = await cloud.serviceHealth();
      assert.strictEqual(h.ok, true);
      assert.ok(C.urlsOf('/service_health')[0], '非管理员也应请求 service_health');
      assert.ok(/select=id,name,kind,status,detail,meta,checked_at&order=id/.test(C.urlsOf('/service_health')[0].url));
      // diagAnalyses / diagRepairs：查询契约 + 失败返回 null（页面保留上次数据）
      await cloud.diagAnalyses();
      assert.ok(/diag_analysis\?select=\*&order=ts\.desc&limit=20/.test(C.urlsOf('/diag_analysis')[0].url));
      await cloud.diagRepairs();
      assert.ok(/repair_tasks\?select=\*&order=created_at\.desc&limit=20/.test(C.urlsOf('/repair_tasks')[0].url));
      C.setReq(function (o) {
        if (String(o.url).indexOf('/diag_analysis') >= 0 || String(o.url).indexOf('/repair_tasks') >= 0) return o.fail({ errMsg: 'request:fail mock' });
        return o.success({ statusCode: 200, data: [] });
      });
      assert.strictEqual(await cloud.diagAnalyses(), null, '瞬时失败 → null（不把已渲染 AI 行闪没）');
      assert.strictEqual(await cloud.diagRepairs(), null);
      // diagReport：POST client_diag 数组、补 sid、最多 3 行
      C.reqLog().length = 0;
      C.setReq(function (o) { return o.success({ statusCode: 201, data: [] }); });
      const rows = [1, 2, 3, 4, 5].map(function (i) {
        return { id: 'r' + i, platform: 'mp', app_ver: '2.0.0', kind: 'error', level: 'error', message: 'm', detail: {}, device: {}, fingerprint: 'mp_' + i, ts: 1 };
      });
      const rep = await cloud.diagReport(rows);
      assert.deepStrictEqual({ ok: rep.ok, count: rep.count }, { ok: true, count: 3 }, '每次最多 3 条');
      const post = C.urlsOf('/client_diag')[0];
      assert.strictEqual(post.method, 'POST');
      assert.strictEqual(post.data.length, 3);
      post.data.forEach(function (r) { assert.strictEqual(r.sid, ID2.sid, 'diagReport 补 sid（RLS 要求）'); });
      // diagPing：一次轻量 GET site_assets + 响应头 Date → serverTime（页面算 clockSkewMs）
      C.reqLog().length = 0;
      const serverNow = Date.now() - 5000;
      C.setReq(function (o) {
        if (String(o.url).indexOf('/site_assets') >= 0) {
          return o.success({ statusCode: 200, data: [{ id: 'tt' }], header: { Date: new Date(serverNow).toUTCString() } });
        }
        return o.success({ statusCode: 200, data: [] });
      });
      const ping = await cloud.diagPing();
      assert.strictEqual(ping.ok, true);
      assert.strictEqual(ping.siteAssets, true);
      assert.ok(ping.latency >= 0);
      assert.ok(Math.abs(ping.serverTime - serverNow) < 2000, 'serverTime=' + ping.serverTime);
      assert.ok(/site_assets\?select=id&id=eq\.tt/.test(C.urlsOf('/site_assets')[0].url));
      // tt_login_enqueue / tt_login_status 契约保持
      C.reqLog().length = 0;
      C.setReq(function (o) {
        const u = String(o.url || '');
        if (u.indexOf('rpc/tt_login_enqueue') >= 0) return o.success({ statusCode: 200, data: { ok: true, job_id: 'job-1' } });
        if (u.indexOf('rpc/tt_login_status') >= 0) return o.success({ statusCode: 200, data: { ok: true, status: 'done', finished: 123, error: '', result: { c: [{ name: '体育', day: 1, start: 1, end: 2, weeks: '1-16', parity: 'all', teacher: '王', room: '体育馆' }], t: '2026-09-01' } } });
        return o.success({ statusCode: 200, data: [] });
      });
      const eq = await cloud.ttLoginEnqueue('pwd-123');
      assert.deepStrictEqual({ ok: eq.ok, job_id: eq.job_id }, { ok: true, job_id: 'job-1' });
      assert.deepStrictEqual(C.urlsOf('rpc/tt_login_enqueue')[0].data, { p_pwd: 'pwd-123', p_platform: 'mp' });
      const st = await cloud.ttLoginStatus('job-1');
      assert.strictEqual(st.status, 'done');
      assert.deepStrictEqual(C.urlsOf('rpc/tt_login_status')[0].data, { p_id: 'job-1' });
      // agent info（对象/单元素数组两种返回都兼容）
      C.setReq(function (o) { if (String(o.url).indexOf('rpc/diag_agent_info') >= 0) return o.success({ statusCode: 200, data: { ok: true, online: true, seen_at: Date.now() - 1000, host: 'local-windows', version: '1.0.0' } }); return o.success({ statusCode: 200, data: [] }); });
      const ai = await cloud.diagAgentInfo();
      assert.strictEqual(ai.online, true);
      assert.strictEqual(ai.host, 'local-windows');
      // 无身份：全部 0 请求
      C.clearMem();
      C.reqLog().length = 0;
      const off = await cloud.serviceHealth();
      assert.strictEqual(off.ok, false);
      assert.strictEqual(off.error, 'forbidden');
      await cloud.diagAnalyses(); await cloud.diagRepairs(); await cloud.diagReport([{ id: 'x' }]); await cloud.ttLoginEnqueue('p'); await cloud.ttLoginStatus('j');
      assert.strictEqual(C.reqLog().length, 0, '未登录不得发任何诊断/登录请求');
    });

    await test('power 页：打开宿舍弹层/低电面板 → 跳过绘制（canvas 被 wx:if 移除）；关闭后 nextTick 重绘且 0 请求', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      R('utils/store.js'); const cloud = R('utils/cloud.js'); enableCloud(cloud);
      installPowerMock(C);
      const cv = installCanvasMock(C);
      const def = loadPage('power/power');
      const ctx = ctxOf(def, { _first: true, _loading: false });
      def.onLoad.call(ctx, {});
      await def.pick.call(ctx, '4-23A---321');
      await sleep(20);
      assert.strictEqual(ctx.data.state, 'ready');
      assert.ok(cv.calls.indexOf('stroke') >= 0, '初始趋势应已绘制');
      assert.strictEqual(ctx._trendOverlayOpen(), false);
      // 1) 打开宿舍 bottom-sheet：canvas 由 WXML wx:if 移除，页面不再查询/绘制（原生层不会盖住弹层）
      cv.calls.length = 0;
      ctx._canvasDrawn = false;
      def.openSheet.call(ctx);
      assert.strictEqual(ctx.data.sheetOpen, true);
      assert.strictEqual(ctx._trendOverlayOpen(), true);
      def._drawTrend.call(ctx);
      assert.strictEqual(cv.calls.length, 0, '覆盖层打开时不得绘制 canvas（节点已被 wx:if 移除）');
      assert.strictEqual(ctx._canvasDrawn, false);
      // 2) 关闭弹层：setData 回调 + wx.nextTick 重绘（复用已有数据，不重复请求）
      const reqBefore = C.reqLog().length;
      def.closeSheet.call(ctx);
      assert.strictEqual(ctx.data.sheetOpen, false);
      assert.ok(cv.calls.indexOf('stroke') >= 0, '关闭后应重绘趋势');
      assert.strictEqual(C.reqLog().length, reqBefore, '关闭重绘不得重复请求');
      // 3) 低电阈值面板同理
      cv.calls.length = 0;
      ctx._canvasDrawn = false;
      def.onTileTap.call(ctx, { currentTarget: { dataset: { key: 'threshold' } } });
      assert.strictEqual(ctx.data.lowOpen, true);
      assert.strictEqual(ctx._trendOverlayOpen(), true);
      def._drawTrend.call(ctx);
      assert.strictEqual(cv.calls.length, 0, '低电面板打开时不得绘制');
      def.closeLow.call(ctx);
      assert.strictEqual(ctx.data.lowOpen, false);
      assert.ok(cv.calls.indexOf('stroke') >= 0, '关闭低电面板后应重绘');
      assert.strictEqual(C.reqLog().length, reqBefore, '低电面板开关不产生请求');
      // 4) 触摸查看在覆盖层打开时被忽略：重新打开弹层后模拟 touchstart，不应进入触摸态
      def.openSheet.call(ctx);
      assert.strictEqual(ctx._trendOverlayOpen(), true);
      ctx._touchActive = false;
      def.onTrendTouch.call(ctx, { touches: [{ clientX: 100 }] });
      assert.strictEqual(ctx._touchActive, false, '覆盖层打开时触摸查看应忽略');
      def.closeSheet.call(ctx);
      cleanupPage(ctx);
    });

    await test('课表登录：tt 页入口/弹层（学号默认身份 sid）+ enqueue/轮询成功 → store.ttLocal + UD v6 tt.ttLocal + 个人课表优先', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID2);
      R('utils/store.js');
      const store = R('utils/store.js');
      const cloud = R('utils/cloud.js'); enableCloud(cloud);
      const pub = [{ name: '公共体育', day: 0, start: 1, end: 2, weeks: '1-18' }];
      const mine = [
        { name: '我的体育', day: 2, start: 3, end: 4, weeks: '1-16', parity: 'all', teacher: '王', room: '体育馆' },
        { name: '我的英语', day: 3, start: 5, end: 6, weeks: '1-16', parity: 'all', teacher: '李', room: 'B202' }
      ];
      C.setReq(function (o) {
        const u = String(o.url || '');
        if (u.indexOf('rpc/tt_login_enqueue') >= 0) return o.success({ statusCode: 200, data: { ok: true, job_id: 'job-1' } });
        if (u.indexOf('rpc/tt_login_status') >= 0) return o.success({ statusCode: 200, data: { ok: true, status: 'done', finished: Date.now(), error: '', result: { c: mine, t: '2026-09-01' } } });
        if (u.indexOf('/site_assets') >= 0) return o.success({ statusCode: 200, data: [{ body: { c: pub, t: '2026-09-01' }, meta: null }] });
        return o.success({ statusCode: 200, data: [] });
      });
      const def = loadPage('tt/tt');
      const ctx = ttPageCtx(def);
      def.onLoad.call(ctx, {});
      def.onShow.call(ctx);
      await sleep(40);
      assert.strictEqual(ctx.data.mine, false, '登录前显示公共课表');
      assert.strictEqual(ctx.data.total, 1);
      // 打开登录弹层：学号默认班级身份 sid（只读展示），密码初始为空
      def.openLogin.call(ctx);
      assert.strictEqual(ctx.data.loginOpen, true);
      assert.strictEqual(ctx.data.loginSid, ID2.sid, '学号默认班级身份 sid');
      assert.strictEqual(ctx.data.loginPwd, '');
      assert.strictEqual(ctx.data.loginCanClear, false, '登录前没有个人课表');
      // 输入密码提交 → enqueue + 轮询 done → 写 store.ttLocal
      ctx.data.loginPwd = 'secret-pwd-123';
      const r = await def.loginTap.call(ctx);
      assert.strictEqual(r, true);
      assert.strictEqual(ctx.data.loginPwd, '', '提交后立即从页面 data 清除密码');
      await sleep(60);
      const tl = store.get().ttLocal;
      assert.ok(tl && Array.isArray(tl.c) && tl.c.length === 2, '登录成功应写 store.ttLocal');
      assert.strictEqual(tl.c[0].name, '我的体育');
      assert.strictEqual(tl.t, '2026-09-01');
      assert.ok(store.get().ttLocalAt > 0, 'ttLocalAt 记录本机写入时间（UD LWW）');
      // UD v6 tt section：tt.ttLocal 与网页同字段，at.tt 被抬高
      const view = cloud.udSections();
      assert.deepStrictEqual(view.tt.ttLocal.c.length, 2);
      assert.ok(view.at.tt >= store.get().ttLocalAt, 'udSections 应抬高 at.tt（本机改动参与 LWW）');
      // 页面切「我的课表」：个人课表优先于公共快照
      assert.strictEqual(ctx.data.mine, true);
      assert.strictEqual(ctx.data.srcText, '我的课表');
      assert.strictEqual(ctx.data.total, 2);
      assert.strictEqual(ctx.data.loginOpen, false, '成功后关闭弹层');
      // 密码不落任何 storage 键
      assert.ok(JSON.stringify(C.mem).indexOf('secret-pwd-123') < 0, '密码不得写入 storage');
      // RPC 契约
      const eqReq = C.urlsOf('rpc/tt_login_enqueue')[0];
      assert.deepStrictEqual(eqReq.data, { p_pwd: 'secret-pwd-123', p_platform: 'mp' });
      assert.strictEqual(C.urlsOf('rpc/tt_login_status')[0].data.p_id, 'job-1');
      // 清除我的课表 → ttLocal=null + ttLocalAt 抬高 → 回退公共
      assert.strictEqual(ctx.data.loginCanClear, true);
      def.clearMine.call(ctx);
      await sleep(20);
      assert.strictEqual(store.get().ttLocal, null);
      assert.ok(store.get().ttLocalAt > 0, '清除也要抬时间戳（云端覆盖）');
      assert.strictEqual(ctx.data.mine, false);
      assert.strictEqual(ctx.data.total, 1, '清除后回退公共课表');
      assert.strictEqual(ctx.data.loginCanClear, false);
      const view2 = cloud.udSections();
      assert.strictEqual(view2.tt.ttLocal, null, '清除后 UD ttLocal = null');
      def.onHide.call(ctx);
    });

    await test('课表登录：agent_offline / 登录失败 / 超时提示 + 失败不阻塞公共课表', async function () {
      // A) agent_offline：立即提示，不轮询、不写 ttLocal
      purge(); C.clearMem(); C.setIdentity(ID2);
      R('utils/store.js'); const store = R('utils/store.js');
      const cloud = R('utils/cloud.js'); enableCloud(cloud);
      C.setReq(function (o) {
        const u = String(o.url || '');
        if (u.indexOf('rpc/tt_login_enqueue') >= 0) return o.success({ statusCode: 200, data: { ok: false, reason: 'agent_offline' } });
        if (u.indexOf('/site_assets') >= 0) return o.success({ statusCode: 200, data: [{ body: { c: [{ name: '公共课', day: 0, start: 1, end: 2, weeks: '1-18' }], t: '2026-09-01' }, meta: null }] });
        return o.success({ statusCode: 200, data: [] });
      });
      let def = loadPage('tt/tt');
      let ctx = ttPageCtx(def);
      def.onLoad.call(ctx, {});
      def.onShow.call(ctx);
      await sleep(30);
      def.openLogin.call(ctx);
      ctx.data.loginPwd = 'p';
      const r1 = await def.loginTap.call(ctx);
      assert.strictEqual(r1, false);
      assert.ok(/本机代理解密服务不在线/.test(ctx.data.loginErr), ctx.data.loginErr);
      assert.strictEqual(ctx.data.loginBusy, false);
      assert.strictEqual(C.urlsOf('rpc/tt_login_status').length, 0, 'agent_offline 不应开始轮询');
      assert.strictEqual(store.get().ttLocal, null);
      assert.strictEqual(ctx.data.mine, false, '失败保留公共课表');
      def.onHide.call(ctx);
      // B) rate：提示次数过多
      purge(); C.clearMem(); C.setIdentity(ID2);
      R('utils/store.js');
      const cloud2 = R('utils/cloud.js'); enableCloud(cloud2);
      C.setReq(function (o) {
        if (String(o.url).indexOf('rpc/tt_login_enqueue') >= 0) return o.success({ statusCode: 200, data: { ok: false, reason: 'rate' } });
        return o.success({ statusCode: 200, data: [] });
      });
      def = loadPage('tt/tt');
      ctx = ttPageCtx(def);
      def.onLoad.call(ctx, {});
      def.openLogin.call(ctx);
      ctx.data.loginPwd = 'p';
      await def.loginTap.call(ctx);
      assert.ok(/登录次数过多/.test(ctx.data.loginErr), ctx.data.loginErr);
      def.onHide.call(ctx);
      // C) 任务 failed：提示失败、保留公共课表
      purge(); C.clearMem(); C.setIdentity(ID2);
      R('utils/store.js');
      const cloud3 = R('utils/cloud.js'); enableCloud(cloud3);
      C.setReq(function (o) {
        const u = String(o.url || '');
        if (u.indexOf('rpc/tt_login_enqueue') >= 0) return o.success({ statusCode: 200, data: { ok: true, job_id: 'job-f' } });
        if (u.indexOf('rpc/tt_login_status') >= 0) return o.success({ statusCode: 200, data: { ok: true, status: 'failed', finished: Date.now(), error: 'bad pwd', result: null } });
        if (u.indexOf('/site_assets') >= 0) return o.success({ statusCode: 200, data: [{ body: { c: [{ name: '公共课', day: 0, start: 1, end: 2, weeks: '1-18' }], t: '2026-09-01' }, meta: null }] });
        return o.success({ statusCode: 200, data: [] });
      });
      def = loadPage('tt/tt');
      ctx = ttPageCtx(def);
      def.onLoad.call(ctx, {});
      def.onShow.call(ctx);
      await sleep(30);
      def.openLogin.call(ctx);
      ctx.data.loginPwd = 'p';
      await def.loginTap.call(ctx);
      await sleep(40);
      assert.ok(/教务登录失败/.test(ctx.data.loginErr), ctx.data.loginErr);
      assert.strictEqual(R('utils/store.js').get().ttLocal, null, '失败不写 ttLocal');
      assert.strictEqual(ctx.data.mine, false);
      assert.strictEqual(ctx.data.total, 1, '公共课表保留');
      def.onHide.call(ctx);
    });

    /* ============================================================
       E. 工程/契约静态断言：工具入口 / app.json / 图标 / 分享 / 页面注册 / 60s 常量
       ============================================================ */
    await test('工程：tools 增 power（noHome 普通）与 diag（diag v2 全班可见、不进首页）、app.json 注册、图标存在且媒体预算内、页面有分享 handler', function () {
      purge();
      const tools = R('utils/tools.js');
      const pwTool = tools.toolOf('power');
      const dgTool = tools.toolOf('diag');
      assert.ok(pwTool && !pwTool.admin && pwTool.noHome === true, 'power 应为普通工具且不进首页常用 (noHome)');
      assert.strictEqual(pwTool.url, '/pages/power/power');
      // 2026-11-08 诊断 v2：去掉管理员门禁（所有人可见），与电费一样不进首页勾选
      assert.ok(dgTool && !dgTool.admin, 'diag 不再是仅管理员工具（所有有效班级身份可见）');
      assert.strictEqual(dgTool.noHome, true, 'diag 不进首页常用（仅「全部」页可见）');
      assert.ok(!/仅管理员/.test(String(dgTool.meta || '') + String(dgTool.desc || '')), 'diag 文案不应再写「仅管理员」');
      assert.strictEqual(dgTool.url, '/pages/diag/diag');
      assert.strictEqual(tools.quickList(4).filter(function (t) { return t.key === 'power' || t.key === 'diag'; }).length, 0, '首页常用不应出现 power/diag');
      assert.ok(tools.catalog().some(function (t) { return t.key === 'diag'; }), '「全部工具」目录应含 diag（非管理员也可看到）');
      const app = JSON.parse(src('app.json'));
      assert.ok(allPages(app).indexOf('pages/power/power') >= 0, 'app.json 应注册 power 页');
      assert.ok(allPages(app).indexOf('pages/diag/diag') >= 0, 'app.json 应注册 diag 页（分包）');
      // 图标（40x40 小体积）
      ['images/tool-power.png', 'images/tool-diag.png'].forEach(function (f) {
        assert.ok(fs.existsSync(path.join(ROOT, f)), '缺少图标 ' + f);
        assert.ok(fs.statSync(path.join(ROOT, f)).size <= 2048, f + ' 应 ≤2KB');
      });
      const media = (function walk(d) {
        let n = 0;
        fs.readdirSync(d).forEach(function (x) {
          const p = path.join(d, x);
          if (fs.statSync(p).isDirectory()) n += walk(p); else n += fs.statSync(p).size;
        });
        return n;
      })(path.join(ROOT, 'images'));
      assert.ok(media <= 200 * 1024, '媒体预算硬线 200KB，实际 ' + media + 'B');
      // 分享 handler + 60s 刷新常量
      const pwJs = src('pages/power/power.js');
      const dgJs = src('pages/diag/diag.js');
      ['onShareAppMessage', 'onShareTimeline', 'share.enable()', "utils/share.js"].forEach(function (k) {
        assert.ok(pwJs.indexOf(k) >= 0, 'power 页缺少 ' + k);
        assert.ok(dgJs.indexOf(k) >= 0, 'diag 页缺少 ' + k);
      });
      assert.ok(/REFRESH_MS = 60000/.test(dgJs), '诊断页 60s 自动刷新（服务健康）');
      assert.ok(/DIAG_REFRESH_MS = 10000/.test(dgJs), '诊断 v2.1：AI/修复进展 10s 轮询');
      // v5：估算算法（rateFrom/estimate）+ 可调低电阈值（LOW_OPTIONS / UD power.low）
      const pwJsSrc = src('utils/power.js');
      assert.ok(!/const WARN = 60/.test(pwJsSrc), 'v5 不再用固定 WARN=60');
      assert.ok(/LOW_OPTIONS = \[10, 20, 30, 40, 50, 60, 80, 100\]/.test(pwJsSrc), '低电档位无 70/90');
      assert.ok(/function normLow/.test(pwJsSrc) && /function rateFrom/.test(pwJsSrc) && /function estimate/.test(pwJsSrc), 'v5 normLow/rateFrom/estimate');
      assert.ok(/function daysMain/.test(pwJsSrc) && /function daysText/.test(pwJsSrc), 'v5 daysMain/daysText');
      assert.ok(/function stateOf\(row, low\)/.test(pwJsSrc) && /q < l \* 2/.test(pwJsSrc), '状态按可调 low 判定（<low 低电 / <2*low 偏低）');
      assert.ok(!/REF = 400/.test(pwJsSrc) && !/ringFrac/.test(pwJsSrc), '不应再保留「当前电量/400」环形语义');
      assert.ok(/ringArc/.test(pwJsSrc) && /ARC_DAYS = 30/.test(pwJsSrc), '环 = estimate 天数/30');
      assert.ok(/上次充值/.test(pwJsSrc) && /lastUp/.test(pwJsSrc), 'tile4 上次充值（值+时间）');
      // v14：跨区间上次充值 —— 值为充值量 delta（+X.XX 度），不再显示充值后余额
      assert.ok(/function lastRecharge\(points, minDelta\)/.test(pwJsSrc) && /lastRecharge: lastRecharge/.test(pwJsSrc),
        '纯函数 lastRecharge 存在并导出');
      assert.ok(/\+' \+ fmtQ\(recAmount\)/.test(pwJsSrc) && !/fmtQ\(rec\.reset\)/.test(pwJsSrc),
        'tile4 值 = +充值量（不显示 reset 余额）');
      const pwWxml = src('pages/power/power.wxml');
      const pwWxssSrc0 = src('pages/power/power.wxss');
      const pwPageSrc = src('pages/power/power.js');
      assert.ok(/trend\.dropLabel/.test(pwWxml) && /trend\.dropText/.test(pwWxml), '趋势图例 dropLabel 随区间');
      assert.ok(/{{lowText}}/.test(pwWxml) && /去完美校园充值/.test(pwWxml), '低电条 = 剩 X 度 ... + 充值提示');
      ['pw-lowsel', 'pw-lowsel-opt', 'lowOptions', 'chooseLow', '低电阈值'].forEach(function (k) {
        assert.ok(pwWxml.indexOf(k) >= 0 || pwWxssSrc0.indexOf(k) >= 0 || src('pages/power/power.js').indexOf(k) >= 0, 'v5 低电阈值面板缺少 ' + k);
      });
      assert.ok(/zq_power_low_/.test(pwPageSrc) && /writeLowFallback/.test(pwPageSrc) && /chooseLow/.test(pwPageSrc), 'v5 本机 low 兜底 + 面板事件');
      assert.ok(/d\.power = \{ sel: .*?at: Date\.now\(\), low: v \}/.test(pwPageSrc), 'setLow 更新 at+low 触发 UD 推送');
      assert.ok(/power\.estimate/.test(pwPageSrc) && /power\.lowText\(row, est\)/.test(pwPageSrc), '页面用 estimate 渲染估算/低电条');
      const cloudSrc = src('utils/cloud.js');
      assert.ok(/udNormLow/.test(cloudSrc) && /UD_POWER_LOWS/.test(cloudSrc), 'cloud 低电阈值归一/档位');
      assert.ok(/low: udNormLow\(d\.power && d\.power\.low\)/.test(cloudSrc) && /low: udNormLow\(j\.power\.low\)/.test(cloudSrc), 'UD sections/apply 带 power.low');
      const privacySrc = src('utils/privacy.js');
      assert.ok(/power: \{ sel: '', at: 0, low: 30 \}/.test(privacySrc), 'DEFAULTS.power 含 low=30');
      assert.ok(/power: \{ sel: '', at: 0, low: 30 \}/.test(src('utils/store.js')), 'store DEF.power 含 low=30');
      // 宿舍选择 UI 改版：自定义 bottom-sheet，彻底移除原生 multiSelector（用户真机异常根因）
      const pwWxmlSrc = src('pages/power/power.wxml');
      const pwWxssSrc = src('pages/power/power.wxss');
      assert.ok(!/multiSelector/.test(pwWxmlSrc + pwJsSrc + pwPageSrc), '不应再出现 multiSelector');
      assert.ok(!/<picker/.test(pwWxmlSrc), '不应再使用原生 picker');
      assert.ok(!/pickerOf|rvFromPicker|pickerText/.test(pwJsSrc), '旧 picker 纯函数应已删除');
      ['pw-mask', 'pw-sheet', 'pw-blds', 'pw-rooms', 'pw-room-btn', 'data-rv', 'env(safe-area-inset-bottom)'].forEach(function (k) {
        assert.ok(pwWxmlSrc.indexOf(k) >= 0 || pwWxssSrc.indexOf(k) >= 0, '弹层缺少 ' + k);
      });
      ['openSheet', 'closeSheet', 'pickBuilding', 'pickRoom'].forEach(function (k) {
        assert.ok(pwPageSrc.indexOf(k) >= 0, '页面缺少事件 ' + k);
        assert.ok(pwWxmlSrc.indexOf(k) >= 0, 'WXML 未绑定 ' + k);
      });
      assert.ok(/roomsOfBuilding/.test(pwJsSrc) && /rvOf/.test(pwJsSrc) && /labelOf/.test(pwJsSrc), '弹层纯数据函数应存在');
      // 趋势：canvas 2d 折线（无柱状图）
      assert.ok(/<canvas[^>]*type="2d"[^>]*id="pwTrend"/.test(pwWxmlSrc), '应有 canvas 2d #pwTrend');
      assert.ok(!/pw-bars|pw-bar-cell/.test(pwWxmlSrc), '柱状图应已移除');
      assert.ok(/createSelectorQuery/.test(pwPageSrc) && /_drawTrend/.test(pwPageSrc), '页面应通过 selectorQuery 绘制 canvas');
      assert.ok(/trendLine/.test(pwJsSrc) && !/trendOf/.test(pwJsSrc), '纯数据 trendLine 应存在、旧 trendOf 应删除');
      assert.ok(/4E9082/.test(pwPageSrc) || /4E9082/.test(pwWxssSrc), '折线主色应为雾青 #4E9082');
      assert.ok(/hiText/.test(pwWxmlSrc) && /midText/.test(pwWxmlSrc) && /loText/.test(pwWxmlSrc), 'y 轴 hi/中/lo 刻度');
      // v3.1 区间：chips / 期间有充值 / x 轴刻度 / 本机记忆 / 5min history 缓存
      assert.ok(/pw-ranges/.test(pwWxmlSrc) && /pickRange/.test(pwWxmlSrc) && /pw-range--on/.test(pwWxmlSrc), '趋势区间 chips');
      assert.ok(/期间有充值/.test(pwWxmlSrc) && /trend\.recharge/.test(pwWxmlSrc), '「期间有充值」徽标');
      assert.ok(/pw-xaxis/.test(pwWxmlSrc) && /pw-xlab/.test(pwWxmlSrc) && /trend\.xTicks/.test(pwWxmlSrc), 'x 轴刻度');
      assert.ok(/RANGES = \[/.test(pwJsSrc) && /rangeMeta/.test(pwJsSrc) && /deriveRange/.test(pwJsSrc) && /xTicks/.test(pwJsSrc), 'RANGES/deriveRange/xTicks 纯函数');
      assert.ok(/zq_power_range_v1/.test(pwPageSrc) && /powerHistCached/.test(pwPageSrc) && /pickRange/.test(pwPageSrc), '区间本机记忆 + 缓存命中不请求');
      assert.ok(/POWER_HIST_TTL = 5 \* 60 \* 1000/.test(src('utils/cloud.js')), 'history 每区间 5 分钟缓存');
      assert.ok(!/zq_power_range|range.*SECTION_KEYS/.test(src('utils/privacy.js')), '区间不进 UD 同步');
      // v6（task-28）：删除横滑，绘图区铺满；固定 y 轴 + 点击/拖动游标
      assert.ok(!/scroll-view|scroll-x|bindscroll|scroll-left|pw-plot-scroll/.test(pwWxmlSrc), '趋势不再有 scroll-view/scroll 绑定');
      assert.ok(/pw-yaxis/.test(pwWxmlSrc) && /pw-yline/.test(pwWxmlSrc), '固定 y 轴 + 竖线');
      assert.ok(/class="pw-cursor"/.test(pwWxmlSrc) && /pw-cursor-line/.test(pwWxmlSrc) && /pw-cursor-dot/.test(pwWxmlSrc), '游标竖线/圆点');
      assert.ok(/left:\{\{item\.left\}\}px/.test(pwWxmlSrc) && /translateX\(\{\{item\.shift\}\}\)/.test(pwWxmlSrc), 'x 覆盖层按可视窗口 px 定位');
      assert.ok(!/item\.pct/.test(pwWxmlSrc), '不应再用整图百分比 x 刻度');
      assert.ok(/style="width:\{\{canvasW\}\}px"/.test(pwWxmlSrc), 'canvas 宽绑定 canvasW（=绘图区宽）');
      assert.ok(/xticksWindow/.test(pwJsSrc) && /TREND_LIMIT/.test(pwJsSrc) && /trendLimit/.test(pwJsSrc), '纯函数 xticksWindow/trendLimit');
      assert.ok(/nearestPoint/.test(pwJsSrc) && /cursorLabel/.test(pwJsSrc), '纯函数 nearestPoint/cursorLabel');
      assert.ok(/onTrendTouch/.test(pwPageSrc) && /onTrendTouchMove/.test(pwPageSrc) && /_measurePlot/.test(pwPageSrc), '页面触摸查看/量宽');
      assert.ok(!/onTrendScroll|_sl\b|scrollLeft/.test(pwPageSrc), '页面无横滑逻辑');
      assert.ok(/MAX_PHYS = 5376/.test(pwPageSrc), '超宽画布物理宽上限 5376');
      assert.ok(/hiText/.test(pwWxmlSrc) && /wx:if="\{\{!trend\.empty\}\}"/.test(pwWxmlSrc), '空态 y 轴只留竖线（刻度条件渲染）');
      // task-23：工作台电费卡 + 持久化/同步修复的静态约束
      const idxWxml = src('pages/index/index.wxml');
      const idxJs = src('pages/index/index.js');
      assert.ok(/wb-power/.test(idxWxml) && /powerCard\.has/.test(idxWxml) && /bindtap="goPower"/.test(idxWxml), '工作台电费卡 WXML（未选择引导 / 已选择电量 / 点击进电费页）');
      assert.ok(/loadPowerCard/.test(idxJs) && /cloud\.powerCached/.test(idxJs) && /goPower\(\) \{ wx\.navigateTo\(\{ url: '\/pages\/power\/power' \}\)/.test(idxJs), '工作台卡片加载/缓存/跳转');
      assert.ok(/wb-power/.test(src('pages/index/index.wxss')), '工作台电费卡样式');
      assert.ok(/udFlush: udFlush/.test(src('utils/cloud.js')) && /function udFlush/.test(src('utils/cloud.js')), 'UD 立即冲刷 API');
      assert.ok(/(?:cloud|cloudMod\(\))\.udFlush\(\)/.test(src('app.js')), '小程序 onHide 冲刷待推送（选完马上退出）');
      assert.ok(/if \(!c \&\& view\.power\.at\) view\.at\.power/.test(src('utils/cloud.js')), '无基线时 power 用本机时间戳参与合并');
      assert.ok(/return String\(\(d\.power && d\.power\.sel\) \|\| ''\) \? \['power'\] : \[\]/.test(src('utils/cloud.js')), '无基线且已有本机选择 → power 脏检测可触发推送');
      assert.ok(/allowFallback = !base \|\| !base\.power \|\| base\.power\.sel === undefined/.test(pwPageSrc), '兜底键只在无 UD 基线时补位（云端权威清空不复活）');
      assert.ok(/writeLowFallback/.test(pwPageSrc) && /readLowFallback/.test(pwPageSrc), 'low 兜底键读写');
      assert.ok(/powerCached: powerCached/.test(src('utils/cloud.js')), 'power 2min 行缓存供工作台复用');
      // 用户第 9 条：24h 变化 ≤2 → 慢更新徽标 + 估算 tile「参考」
      assert.ok(/function slowUpdate/.test(pwJsSrc) && /SLOW_DIFF = 0\.005/.test(pwJsSrc), 'slowUpdate 纯函数（|dq|>0.005）');
      assert.ok(/pw-slow/.test(pwWxmlSrc) && /trend\.slowText/.test(pwWxmlSrc) && /pw-tile-ref/.test(pwWxmlSrc), '慢更新徽标 + tile 参考标记 WXML');
      assert.ok(/pw-slow/.test(pwWxssSrc) && /flex-wrap: wrap/.test(pwWxssSrc) && /overflow-wrap: anywhere/.test(pwWxssSrc), '慢更新徽标换行不溢出');
      assert.ok(/slowUpdate\(hist24\)/.test(pwPageSrc) && /tilesOf\(row, est, dRange, meta, low, slowOn(?:, cmp)?(?:, crossRecharge)?\)/.test(pwPageSrc), '页面用 24h history 判慢 + tile 参考标记');
      // v6（task-28）：取消横滑，绘图区铺满；无 scroll-view/scroll-x/横滑提示/scroll 代理
      assert.ok(!/scroll-view/.test(pwWxmlSrc), 'power 趋势不再有 scroll-view（取消横滑）');
      assert.ok(!/scroll-x|bindscroll|scroll-left/.test(pwWxmlSrc), 'power WXML 无 scroll-x/scroll 绑定');
      assert.ok(!/横滑查看|pw-scrollhint|trend\.hint/.test(pwWxmlSrc), '不再有「横滑查看」提示');
      assert.ok(!/pw-plot-scroll|pw-plot-space/.test(pwWxmlSrc + pwWxssSrc), '删除透明 scroll 代理/内容占位');
      assert.ok(!/onTrendScroll|_sl\b|scrollLeft/.test(pwPageSrc), '页面无横滑/scrollLeft 逻辑');
      assert.ok(/<view class="pw-plot"[^>]*catchtouchstart="onTrendTouch"[^>]*catchtouchmove="onTrendTouchMove"[^>]*catchtouchend="onTrendTouchEnd"/.test(pwWxmlSrc), '绘图区绑定点击/拖动/松手查看');
      // v7（2026-11-07）：竖线 + 真实采样点圆点 + 深色信息气泡（固定在趋势图右上角上部、绘图区外）
      assert.ok(/class="pw-cursor"/.test(pwWxmlSrc) && /pw-cursor-line/.test(pwWxmlSrc) && /pw-cursor-dot/.test(pwWxmlSrc), '游标竖线/圆点');
      assert.ok(/class="pw-cursor-dot" style="top:\{\{cursor\.top\}\}px"/.test(pwWxmlSrc), '圆点按 cursor.top 定位（真实采样点 y，非固定 50%）');
      assert.ok(/<view class="pw-trend-top">/.test(pwWxmlSrc) && /class="pw-cursor-tip"/.test(pwWxmlSrc) && /\{\{cursor\.text\}\}/.test(pwWxmlSrc), '气泡固定在 .pw-trend-top（趋势图上方、区间行右侧）');
      assert.ok(!/cursor\.tipLeft|cursor\.tipTop|cursor\.below/.test(pwWxmlSrc), '气泡不再按 tipLeft/tipTop/below 在图内定位');
      assert.ok(/aria-label="\{\{cursor\.on \? cursor\.text : ''\}\}"/.test(pwWxmlSrc), '绘图区 aria-label 暴露游标文案');
      const tipIdx = pwWxmlSrc.indexOf('pw-cursor-tip');
      const bodyIdx = pwWxmlSrc.indexOf('class="pw-trend-body"');
      assert.ok(tipIdx > 0 && bodyIdx > 0 && tipIdx < bodyIdx, '气泡在绘图区（.pw-trend-body）之前，不浮在图内');
      assert.ok(!/estimateCursorTipSize/.test(pwPageSrc) && !/_placeCursorTip/.test(pwPageSrc) && !/_cursorSeq/.test(pwPageSrc), '页面不再做图内气泡实测/clamp/防抖');
      assert.ok(!/pw-cursor-info/.test(pwWxmlSrc) && !/pw-cursor-info/.test(pwWxssSrc), '去掉可见的 .pw-cursor-info 胶囊行');
      assert.ok(/\.pw-cursor-tip \{[^}]*background: #25332F;/.test(pwWxssSrc) && /\.pw-cursor-tip \{[^}]*color: #FFFFFF;/.test(pwWxssSrc), '气泡深色 #25332F + 白字');
      assert.ok(/\.pw-cursor-tip \{[^}]*position: static;/.test(pwWxssSrc) && /\.pw-cursor-tip \{[^}]*margin-left: auto;/.test(pwWxssSrc), '气泡静态布局（不 absolute、不位移）');
      assert.ok(!/\.pw-cursor-tip--below/.test(pwWxssSrc) && !/\.pw-cursor-tip \{[^}]*transform:/.test(pwWxssSrc), '气泡无下方变体/无位移 transform');
      assert.ok(/\.pw-trend-top \{[^}]*display: flex;/.test(pwWxssSrc), '区间行 flex：按钮左 + 气泡右');
      assert.ok(/\.pw-cursor-dot \{[^}]*transform: translate\(-50%, -50%\);/.test(pwWxssSrc), '圆点 translate(-50%,-50%) 居中');
      assert.ok(/\.pw-plot \{[^}]*overflow: hidden;/.test(pwWxssSrc) && /\.pw-canvas \{[^}]*position: absolute;/.test(pwWxssSrc), '绘图区裁剪 + canvas 绝对定位');
      assert.ok(/class="pw-canvas" style="width:\{\{canvasW\}\}px"/.test(pwWxmlSrc) && /canvasW: this\._cw/.test(pwPageSrc), 'canvas 宽=绘图区宽，不越界');
      assert.ok(!/chartWidth\(/.test(pwPageSrc), '页面不再按内容宽绘制（全量压缩铺满）');
      assert.ok(/const px = function \(p\) \{ return padX \+ p\.x \* \(W - padX \* 2\); \};/.test(pwPageSrc), 'x = padX + 真实时间比例*可视宽（不插值）');
      assert.ok(/nearestPoint\((this\._linePoints|pts), frac\)/.test(pwPageSrc) && /setData\(\{\s*cursor:/.test(pwPageSrc), '最近采样点 + 同步 setData 游标（不 rAF）');
      assert.ok(/cursorLabel\(p\.t, this\.data\.range\)/.test(pwPageSrc) && /电量 ' \+ power\.fmtQ\(p\.q\)/.test(pwPageSrc), '信息行时间+电量');
      assert.ok(/this\._plotH = H/.test(pwPageSrc) && /PLOT_PAD_T = 12/.test(pwPageSrc) && /PLOT_PAD_B = 10/.test(pwPageSrc), '_drawTrend 记录实际绘图高 + padT=12/padB=10 常量');
      assert.ok(!/cursorTipLayout\(|cursorFollowLayout\(/.test(pwPageSrc), '页面不再使用图内气泡定位纯函数（气泡固定显示）');
      assert.ok(/catchtouchmove="onTrendTouchMove"/.test(pwWxmlSrc), '拖动 catchtouchmove 不触发页面滚动');
      assert.ok(/\.pw-yaxis \{[^}]*background: var\(--md-surface\);[^}]*z-index: 3;/.test(pwWxssSrc), 'y 轴列独立背景/层叠，线不会压住刻度');
      assert.ok(/\.pw-xaxis \{[^}]*overflow: hidden;/.test(pwWxssSrc) && /\.pw-legend \{[^}]*overflow: hidden;/.test(pwWxssSrc), 'x 轴/图例限宽不撑破');
      assert.ok(/function fallbackContainerW/.test(pwJsSrc) && /_renderWhenReady/.test(pwPageSrc) && /power\.fallbackContainerW/.test(pwPageSrc), '测宽失败保守兜底 + 先保守渲染再实测');
      assert.ok(/chartW: this\._cw/.test(pwPageSrc) && /canvasW: this\._cw/.test(pwPageSrc) && /this\._chartW = this\._cw/.test(pwPageSrc), '内容宽/画布宽均=绘图区宽（全量压缩）');
      // 排版重构（task-26）：单行选择 + 紧凑 Hero + tiles 紧凑；保留充值/慢更新
      assert.ok(/class="pw-pick"/.test(pwWxmlSrc) && !/pw-pick-main/.test(pwWxmlSrc), '顶部关注宿舍改为单行入口');
      assert.ok(/pw-dash-main/.test(pwWxmlSrc) && /pw-refresh-btn/.test(pwWxmlSrc) && !/m3-btn--block pw-refresh/.test(pwWxmlSrc), 'Hero 紧凑布局 + 右上角小刷新按钮');
      assert.ok(/\.pw-ring \{[^}]*width: 220rpx; height: 220rpx;/.test(pwWxssSrc) && /\.pw-q \{ font-size: 56rpx/.test(pwWxssSrc), 'Hero 小环 220rpx + 合适字号');
      assert.ok(/\.pw-tile \{[^}]*padding: 24rpx;/.test(pwWxssSrc) && /\.pw-tile-v \{ margin-top: 4rpx; font-size: 38rpx;/.test(pwWxssSrc), 'tiles 紧凑 padding/字号（12vp/2vp）');
      ['utils/power.js', 'README.md', 'CHANGELOG.md'].forEach(function (f) {
        const t = src(f);
        assert.ok(!/30–100|30-100|>100 充足|>100 充足|≥100 充足|100 度偏低/.test(t), f + ' 不应残留旧「30–100 偏低 / >100 充足」阈值');
      });
      // v13（2026-11-07，规格 power_cadence_spec.md）：13/16 号楼「网关日更」慢频特异性统计（web/mp 同口径）
      assert.ok(/const SLOW_BUILDINGS = \['13号楼', '16号楼'\]/.test(pwJsSrc), '慢频楼栋配置 13/16 号楼');
      assert.ok(/const MIN_SEG_H = 6/.test(pwJsSrc) && /const EXPECT_H = 24/.test(pwJsSrc) && /const CH = 0\.005/.test(pwJsSrc), '慢频常量 CH/MIN_SEG_H/EXPECT_H');
      ['function isSlowBuilding', 'function isSlowRoom', 'function changesIn', 'function slowStats',
        'function estimateSlow', 'function noUpdateText', 'function stepSegments', 'function changeDots'].forEach(function (fn) {
          assert.ok(pwJsSrc.indexOf(fn) >= 0, '慢频纯函数缺少 ' + fn);
        });
      assert.ok(/MIN_SEG_H\)|dtH >= MIN_SEG_H/.test(pwJsSrc) && /EXPECT_H \* 1\.5/.test(pwJsSrc), '慢频单段按 EXPECT_H 折算（6h 过滤）');
      assert.ok(/r24\.used > 0\.05/.test(pwJsSrc) && /r7\.used > 0\.05/.test(pwJsSrc), '§1.4 实时房守卫：窗口真实用电 >0.05 才有效');
      assert.ok(/const isSlow = !!\(est && est\.slow\)/.test(pwJsSrc) && /该区间无更新/.test(pwJsSrc), 'tilesOf 慢频：tile1 参考按 est.ref + tile2 无下降 sub');
      assert.ok(/est\.lastRecharge/.test(pwJsSrc) && /lastRecharge: null/.test(pwJsSrc), 'slowUpdate/slowStats 补 lastRecharge');
      assert.ok(/flat \? 0\.5/.test(pwJsSrc) && /const flat = \(hi - lo\) < CH/.test(pwJsSrc), '平线垂直居中（全房通用）');
      assert.ok(/pw-daily/.test(pwWxmlSrc) && /trend\.daily/.test(pwWxmlSrc) && /trend\.dailyTitle/.test(pwWxmlSrc), '「日更」徽标 WXML');
      assert.ok(/\.pw-daily \{[^}]*var\(--md-primary-container\)/.test(pwWxssSrc), '「日更」徽标样式');
      assert.ok(/power\.isSlowRoom\(this\.data\.sel, hist24\)/.test(pwPageSrc) && /power\.estimateSlow\(hist30, row\)/.test(pwPageSrc), '页面按慢/实时选择估算（isSlowRoom → estimateSlow）');
      // v14：30d history 不再只给慢频房 —— 所有房间都拉（实时房「上次充值」跨区间；30d 档复用 pull 的 hist）
      assert.ok(/cloud\.powerHistory\(rv, '30d'/.test(pwPageSrc), '所有房间拉 30d history（慢频估算 + 跨区间上次充值）');
      assert.ok(/const p30 = \(rng !== '30d'\) \? cloud\.powerHistory\(rv, '30d'/.test(pwPageSrc), '30d 请求不按楼栋门控（仅 30d 档去重）');
      assert.ok(/slowRoom \? \(est\.lastRecharge \|\| null\) : power\.lastRecharge\(hist30\)/.test(pwPageSrc), '跨区间充值：慢频 est.lastRecharge / 实时 lastRecharge(hist30)');
      assert.ok(/power\.tilesOf\(row, est, dRange, meta, low, slowOn, cmp, crossRecharge\)/.test(pwPageSrc), '跨区间结果传入 tilesOf');
      assert.ok(/power\.estimateSlow\(hist30, row\)/.test(pwPageSrc) && /slowRoom/.test(pwPageSrc), '30d 未加载时估算降级为数据积累中');
      assert.ok(/stepSegments\(points\)/.test(pwPageSrc) && /changeDots\(points\)/.test(pwPageSrc) && /fillText\(this\._noUpd/.test(pwPageSrc), 'canvas 阶梯线 + 真实变化点 + 无更新提示文字');
      assert.ok(/近 30 天无变化/.test(pwPageSrc) && /_hist30/.test(pwPageSrc), 'hero 更新时间用 30d 真实变化点/无变化文案');
      assert.ok(!/zq_power_slow|slow.*SECTION_KEYS/.test(src('utils/privacy.js')), '慢频/30d 不新增 UD 同步字段');
      assert.ok(/VERSION = '2\.0\.4'/.test(src('utils/version.js')), '版本号为 2.0.4');
    });

    await test('契约：privacy SECTION_KEYS 11 键（power → water 最后）/ DEFAULTS / 空 v6 与 merge 默认一致 / 14 顶层键', function () {
      purge();
      const privacy = R('utils/privacy.js');
      const cloud = R('utils/cloud.js');
      assert.deepStrictEqual(privacy.SECTION_KEYS, ['homeTools', 'fit', 'draw', 'group', 'roster', 'hide', 'tt', 'prefs', 'nick', 'power', 'water']);
      assert.deepStrictEqual(privacy.DEFAULTS.power, { sel: '', at: 0, low: 30 });
      assert.deepStrictEqual(privacy.DEFAULTS.water, { rooms: {} });
      const empty = privacy.emptyV6();
      assert.deepStrictEqual(Object.keys(empty), ['v', 'at'].concat(privacy.SECTION_KEYS).concat(['homeToolsAt']));
      assert.strictEqual(Object.keys(empty).length, 14);
      assert.strictEqual(Object.keys(empty.at).length, 11);
      assert.deepStrictEqual(JSON.parse(privacy.emptyBlob()), cloud.mergeUd(null, {}));
      // power / water 不在导出 JSON（宿舍号隐私红线）
      const exp = JSON.parse(privacy.exportJson({ power: { sel: '4-23A---321', at: 1 }, water: { rooms: { '4-23A---321': { p: 4, recs: [{ m: '2026-10', r: 100, ts: 1 }] } } } }, ID));
      assert.strictEqual(exp.sync.power, undefined, '关注宿舍不应进导出 JSON');
      assert.strictEqual(exp.sync.water, undefined, '水量抄表记录不应进导出 JSON');
      assert.ok(privacy.SCOPE.indexOf('关注宿舍（电费）') >= 0, '同步范围应含关注宿舍');
      assert.ok(privacy.SCOPE.indexOf('抄表记录（水量）') >= 0, '同步范围应含水量抄表记录');
      // udSections 带 power 且值内 at 合法；带 water 默认 {rooms:{}}
      const view = cloud.udSections();
      assert.ok(view.power && typeof view.power.sel === 'string');
      assert.deepStrictEqual(view.water, { rooms: {} });
    });

    /* ============================================================ */
  })().finally(function () {
    global.wx = prevWx;
    global.getCurrentPages = prevGetCurrentPages;
  });
}

module.exports = { run: run };

if (require.main === module) {
  const results = [];
  let passN = 0, failN = 0;
  const test = async function (name, fn) {
    try { await fn(); passN += 1; results.push({ name: name, ok: true }); console.log('PASS  ' + name); }
    catch (e) { failN += 1; results.push({ name: name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
  };
  run(test).then(function () {
    const summary = { total: passN + failN, pass: passN, fail: failN, results: results, at: new Date().toISOString() };
    fs.writeFileSync(path.join(__dirname, 'v3_power_diag_result.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log('\n================ v3 power/diag: ' + passN + ' passed, ' + failN + ' failed ================');
    process.exit(failN ? 2 : 0);
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}
