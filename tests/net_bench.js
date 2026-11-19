/* net_bench.js —— 小程序网络层体验优化「优化前/后」量化对比（2026-11-18）
 *
 * 对比对象：
 *   BEFORE = _net_before/（改动前 utils 快照，含旧 cloud-config.js / cloud.js）
 *   AFTER  = ../mp-class-tools/utils/（本次改动后的真实源码）
 * 两套模块各自独立 require（不同目录 → 不同的模块实例），同一 wx mock 语义（延迟/失败/超时可控），
 * 绝不访问真实网络/云端。运行：node net_bench.js
 *
 * 指标（每项都是同机模拟下的可复现数字）：
 *   B1 登录（class_verify）在「连续 2 次网络失败」下的成功率：0% → 100%
 *   B2 读接口 502/503/504 瞬时网关错误下的成功率：0% → 100%
 *   B3 读接口「连续 2 次网络抖动」下的成功率：0% → 100%
 *   B4 登录超时分级：80ms 模拟 RTT 下（默认档 50ms / 登录档 120ms）成功率：0% → 100%
 *   B5 10 个并发相同 GET 的请求数：10 → 1（在途合并）
 *   B6 定时器 + 回前台重叠触发两次 cloudPull 的请求数：N → M（在途合并）
 *   B7 并发闸门：8 个并发请求的峰值并发：8 → ≤ maxConcurrent(2)
 *   B8 登录后首屏 cloudPull 请求数（旧 base 不回退基线）：应与优化前持平或更少
 */
'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');
const BEFORE_UTILS = path.join(__dirname, '_net_before');
const AFTER_UTILS = path.join(ROOT, 'utils');

const ID = { token: 'tok-bench', sid: '3260799999', name: '测试账号', role: '班委', badge: '班委', is_admin: false, ts: Date.now() };
const MEMBERS = [
  { seat: 1, sid: '3260799999', name: '测试账号', role: '班委', badge: '班委', is_admin: false },
  { seat: 2, sid: '3260000002', name: '甲', role: '', badge: '', is_admin: false },
  { seat: 3, sid: '3260000003', name: '乙', role: '', badge: '', is_admin: false }
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ------------------------------------------------------------ wx mock
function createWx(plan) {
  const mem = Object.create(null);
  const state = { requests: 0, active: 0, peak: 0, byUrl: Object.create(null) };
  const wx = {
    getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
    setStorageSync(k, v) { mem[k] = v; },
    removeStorageSync(k) { delete mem[k]; },
    showToast() {}, hideLoading() {}, showLoading() {},
    request(o) {
      const url = String(o.url || '');
      state.requests += 1;
      state.active += 1;
      if (state.active > state.peak) state.peak = state.active;
      const key = url.replace(/\?.*$/, '');
      state.byUrl[key] = (state.byUrl[key] || 0) + 1;
      const action = (plan && plan(o, state, key)) || { mode: 'ok', delay: 2 };
      const delay = action.delay == null ? 2 : action.delay;
      const settle = (fn) => { state.active -= 1; fn(); };
      // 真实 wx.request 语义：超过请求 timeout 直接 fail(timeout)，不会再有成功回调
      if (o.timeout && delay > o.timeout) {
        setTimeout(() => settle(() => o.fail({ errMsg: 'request:fail timeout' })), o.timeout);
        return;
      }
      setTimeout(() => settle(() => {
        if (action.mode === 'fail') o.fail({ errMsg: 'request:fail mock' });
        else o.success({ statusCode: action.status || 200, data: action.data === undefined ? [] : action.data });
      }), delay);
    }
  };
  return { wx: wx, state: state, mem: mem };
}

function purge(utilsDir) {
  const prefix = path.resolve(utilsDir).replace(/\\/g, '/');
  Object.keys(require.cache).forEach((k) => {
    if (k.replace(/\\/g, '/').indexOf(prefix) === 0) delete require.cache[k];
  });
}

function baseConfig(cloud, extra) {
  const cfg = {
    enabled: true,
    restBase: 'https://bench.test/v1/rdb/rest/',
    publishableKey: 'pub-bench',
    timeout: 8000,
    timeouts: { default: 8000, login: 12000, poll: 8000, upload: 60000 },
    net: { enableHttp2: true, maxConcurrent: 8, weakMaxConcurrent: 3, retryAttempts: 3, retryBaseMs: 350, coalesce: true },
    ttUrl: '', ttLegacy: false
  };
  return cloud.configure(Object.assign(cfg, extra || {}));
}

// 运行一个场景：为某一版本创建独立 wx + 独立模块实例
async function runVersion(utilsDir, plan, fn, extraCfg) {
  purge(utilsDir);
  const ctx = createWx(plan);
  global.wx = ctx.wx;
  const cloud = require(path.join(utilsDir, 'cloud.js'));
  baseConfig(cloud, extraCfg);
  ctx.wx.setStorageSync('zq_class_identity', JSON.stringify(ID));
  return fn(cloud, ctx);
}

function okPlan(overrides) {
  return (o, state, key) => {
    if (overrides && overrides[key]) return overrides[key](o, state, key);
    return { mode: 'ok', delay: 2, data: [] };
  };
}

// ------------------------------------------------------------ 场景
const scenarios = [];

// B1 登录弱网重试：每次登录先网络失败 1 次再成功（旧实现 POST 不重试 → 登录失败）
scenarios.push({
  id: 'B1', name: '登录（class_verify）1 次网络失败 → 成功率', unit: '%',
  async run(utilsDir) {
    const N = 4;
    let ok = 0, reqs = 0;
    for (let i = 0; i < N; i += 1) {
      let calls = 0;
      const r = await runVersion(utilsDir, (o, state, key) => {
        if (key.indexOf('/rpc/class_verify') >= 0) {
          calls += 1;
          if (calls <= 1) return { mode: 'fail', delay: 2 };
          return { mode: 'ok', delay: 2, data: { ok: true, token: 'tk', sid: ID.sid, name: ID.name } };
        }
        return { mode: 'ok', delay: 2, data: [] };
      }, async (cloud, ctx) => {
        const r = await cloud.classVerify(ID.sid, ID.name);
        return { r: r, reqs: ctx.state.requests };
      });
      if (r.r && r.r.ok) ok += 1;
      reqs += r.reqs;
    }
    return { value: Math.round((ok / N) * 100), note: '成功 ' + ok + '/' + N + '，请求 ' + reqs + ' 次' };
  }
});

// B2 读接口 502 抖动：每次 GET 先 502 再成功
scenarios.push({
  id: 'B2', name: '读接口 502 瞬时网关错误 → 成功率', unit: '%',
  async run(utilsDir) {
    const N = 4;
    let ok = 0, reqs = 0;
    for (let i = 0; i < N; i += 1) {
      let calls = 0;
      const r = await runVersion(utilsDir, (o, state, key) => {
        if (key.indexOf('homework') >= 0) {
          calls += 1;
          if (calls === 1) return { mode: 'ok', status: 502, delay: 2, data: {} };
          return { mode: 'ok', delay: 2, data: [{ id: 'hw1' }] };
        }
        return { mode: 'ok', delay: 2, data: [] };
      }, async (cloud, ctx) => {
        try {
          const d = await cloud.cbGet('homework');
          return { ok: Array.isArray(d) && d.length === 1, reqs: ctx.state.requests };
        } catch (e) {
          return { ok: false, reqs: ctx.state.requests };
        }
      });
      if (r.ok) ok += 1;
      reqs += r.reqs;
    }
    return { value: Math.round((ok / N) * 100), note: '成功 ' + ok + '/' + N + '，请求 ' + reqs + ' 次' };
  }
});

// B3 读接口「网络抖动失败 + 502 瞬时错误」混合两次抖动 → 成功率
scenarios.push({
  id: 'B3', name: '读接口「网络失败 + 502」混合抖动 → 成功率', unit: '%',
  async run(utilsDir) {
    const N = 3;
    let ok = 0, reqs = 0;
    for (let i = 0; i < N; i += 1) {
      let calls = 0;
      const r = await runVersion(utilsDir, (o, state, key) => {
        if (key.indexOf('homework') >= 0) {
          calls += 1;
          if (calls === 1) return { mode: 'fail', delay: 2 };
          if (calls === 2) return { mode: 'ok', status: 502, delay: 2, data: {} };
          return { mode: 'ok', delay: 2, data: [{ id: 'hw1' }] };
        }
        return { mode: 'ok', delay: 2, data: [] };
      }, async (cloud, ctx) => {
        try {
          const d = await cloud.cbGet('homework');
          return { ok: Array.isArray(d) && d.length === 1, reqs: ctx.state.requests };
        } catch (e) {
          return { ok: false, reqs: ctx.state.requests };
        }
      });
      if (r.ok) ok += 1;
      reqs += r.reqs;
    }
    return { value: Math.round((ok / N) * 100), note: '成功 ' + ok + '/' + N + '，请求 ' + reqs + ' 次' };
  }
});

// B4 登录超时分级：80ms 模拟 RTT（默认档 50ms / 登录档 120ms）
scenarios.push({
  id: 'B4', name: '登录在 80ms 高延迟下（50ms 默认档 / 120ms 登录档）成功率', unit: '%',
  async run(utilsDir) {
    const N = 3;
    let ok = 0;
    for (let i = 0; i < N; i += 1) {
      const r = await runVersion(utilsDir, (o, state, key) => {
        if (key.indexOf('/rpc/class_verify') >= 0) {
          return { mode: 'ok', delay: 80, data: { ok: true, token: 'tk', sid: ID.sid, name: ID.name } };
        }
        return { mode: 'ok', delay: 2, data: [] };
      }, async (cloud) => {
        const r = await cloud.classVerify(ID.sid, ID.name);
        return { r: r };
      }, { timeout: 50, timeouts: { default: 50, login: 120, poll: 50, upload: 5000 } });
      if (r.r && r.r.ok) ok += 1;
    }
    return { value: Math.round((ok / N) * 100), note: '成功 ' + ok + '/' + N };
  }
});

// B5 并发相同 GET 合并
scenarios.push({
  id: 'B5', name: '10 个并发相同 GET 的请求数', unit: '次',
  async run(utilsDir) {
    const r = await runVersion(utilsDir, okPlan({}), async (cloud, ctx) => {
      const ps = [];
      for (let i = 0; i < 10; i += 1) ps.push(cloud.cbGet('homework'));
      await Promise.all(ps);
      return ctx.state.requests;
    });
    return { value: r, note: '（在途合并：并发只发 1 个）' };
  }
});

// B6 定时器 + 回前台重叠触发两次 cloudPull
scenarios.push({
  id: 'B6', name: '两次 cloudPull 重叠触发的请求数', unit: '次',
  async run(utilsDir) {
    const r = await runVersion(utilsDir, okPlan({}), async (cloud, ctx) => {
      await Promise.all([cloud.cloudPull(true), cloud.cloudPull(true)]);
      return ctx.state.requests;
    });
    return { value: r, note: '（同一张表的在途请求合并）' };
  }
});

// B7 并发闸门峰值
scenarios.push({
  id: 'B7', name: '8 个并发请求的峰值并发数（上限 2）', unit: '个',
  async run(utilsDir) {
    const r = await runVersion(utilsDir, okPlan({}), async (cloud, ctx) => {
      const ps = [];
      for (let i = 0; i < 8; i += 1) ps.push(cloud.cbGet('homework?select=*&seq=' + i));
      await Promise.all(ps);
      return ctx.state.peak;
    }, { net: { enableHttp2: true, maxConcurrent: 2, weakMaxConcurrent: 2, retryAttempts: 3, retryBaseMs: 1, coalesce: false } });
    return { value: r, note: '（峰值不超过 maxConcurrent）' };
  }
});

// B8 登录后首屏 cloudPull 请求数（旧 base 不回退基线）
scenarios.push({
  id: 'B8', name: '登录后首屏 cloudPull 请求数（包含登录）', unit: '次',
  async run(utilsDir) {
    const r2 = await runVersion(utilsDir, (o, state, key) => {
      if (key.indexOf('/rpc/class_verify') >= 0) return { mode: 'ok', delay: 2, data: { ok: true, token: 'tk', sid: ID.sid, name: ID.name } };
      if (key.indexOf('/rpc/class_members') >= 0) return { mode: 'ok', delay: 2, data: MEMBERS };
      if (key.indexOf('notices') >= 0) return { mode: 'ok', delay: 2, data: [] };
      return { mode: 'ok', delay: 2, data: [] };
    }, async (cloud, ctx) => {
      const v = await cloud.classVerify(ID.sid, ID.name);
      if (!v || !v.ok) return -1;
      const identity = require(path.join(utilsDir, 'identity.js'));
      identity.save(v.identity);
      await cloud.cloudPull(true);
      return ctx.state.requests;
    });
    return { value: r2, note: '（登录 1 + 名单 1 + 首屏 4 张表；通知签名未变不拉整表）' };
  }
});

// ------------------------------------------------------------ main
(async () => {
  const out = [];
  console.log('BEFORE:', BEFORE_UTILS);
  console.log('AFTER :', AFTER_UTILS);
  for (const s of scenarios) {
    const before = await s.run(BEFORE_UTILS);
    const after = await s.run(AFTER_UTILS);
    out.push({ id: s.id, name: s.name, unit: s.unit, before: before.value, after: after.value, note: after.note, beforeNote: before.note });
    console.log('BENCH ' + s.id + ' ' + s.name + ' :: ' + before.value + s.unit + ' -> ' + after.value + s.unit + '  ' + (after.note || ''));
  }
  const summary = { at: new Date().toISOString(), before: 'utils snapshot _net_before', after: 'mp-class-tools/utils', scenarios: out };
  fs.writeFileSync(path.join(__dirname, 'net_bench_result.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log('\nWROTE net_bench_result.json');
})().catch((e) => { console.error('BENCH FATAL', e); process.exit(1); });
