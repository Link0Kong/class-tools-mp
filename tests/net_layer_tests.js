/* 2026-11-18 自建后端切流 · 小程序网络层单元/契约测试（断言在 net_layer_tests.js）
 *
 * 覆盖：
 *   N1 REST base 三档（cloudbase 默认 / staging / selfhosted）+ 超时分级/网络参数默认值
 *   N2 cloud.js 只读探针 restInfo/netStats/timeoutOf 与默认值
 *   N3 HTTP/2 选项：https 请求带 enableHttp2，http（staging）不带
 *   N4 超时分级：登录/身份验证用 login 档（12000），普通读写/轮询用 default 档
 *   N5 幂等只读重试：网络抖动吸收（1 次失败后成功）、502/503/504 瞬时错误、404 不重试、
 *      最大尝试次数（默认 2 次）与写请求不重试
 *   N6 在途合并：相同 GET 并发只发 1 个请求；请求结束后不再复用旧结果
 *   N7 并发闸门：全局并发上限生效（峰值 ≤ maxConcurrent），请求全部成功
 *   N8 旧 CloudBase base 下成功路径不回退：1 次请求、0 重试、0 合并
 *
 * 说明：本文件在 unit.js 用例序列末尾运行；临时替换 global.wx.request，结束/失败都恢复。
 * 只用 mock，绝不访问真实网络/云端。publishableKey 只做存在性断言，不打印。
 */
'use strict';

const path = require('path');
const assert = require('assert');

const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');
const UTILS = path.join(ROOT, 'utils');

const ID = { token: 'tok-net', sid: '3260799999', name: '测试账号', role: '班委', badge: '班委', is_admin: false, ts: Date.now() };

function run(test) {
  // ------------------------------------------------------------ mock 基础设施
  // 独立 wx mock（本文件自己持有 storage + request），不依赖前序测试文件留下的 global.wx 形状。
  // 2026-11-18：前序测试文件（notice_occ_unit.js 等）里有未 await 的异步尾巴，可能在任意时刻
  // 回写 global.wx（会打断本文件的重试/并发时序）→ 本文件把 global.wx 固定为下面的 mock
  // （setter 忽略外部改写），结束后再恢复原属性描述符。
  const hadWx = Object.prototype.hasOwnProperty.call(global, 'wx');
  const savedDesc = Object.getOwnPropertyDescriptor(global, 'wx');
  const savedWx = global.wx;
  const mem = Object.create(null);
  const wxMock = {
    getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
    setStorageSync(k, v) { mem[k] = v; },
    removeStorageSync(k) { delete mem[k]; },
    showToast() {},
    hideLoading() {},
    showLoading() {}
  };
  let reqLog = [];
  let impl = (o) => o.success({ statusCode: 200, data: [] });
  wxMock.request = function (o) { reqLog.push(o); return impl(o); };
  Object.defineProperty(global, 'wx', {
    configurable: true,
    get() { return wxMock; },
    set() { /* 忽略前序测试遗留异步回调对 global.wx 的改写 */ }
  });

  function restoreMock() {
    try { delete global.wx; } catch (e) { /* ignore */ }
    if (hadWx && savedDesc) Object.defineProperty(global, 'wx', savedDesc);
    else if (savedWx !== undefined) global.wx = savedWx;
  }
  function resetLog() { reqLog = []; }
  function ok(data) { return (o) => o.success({ statusCode: 200, data: data === undefined ? [] : data }); }
  function failAll() { return (o) => o.fail({ errMsg: 'request:fail mock' }); }
  function delayed(ms, res) {
    return (o) => { setTimeout(() => o.success(res || { statusCode: 200, data: [] }), ms); };
  }

  // 重载小程序 utils（保证 cloud.js 的 CONFIG / 在途表 / 统计计数干净）
  function freshCloud() {
    Object.keys(require.cache).forEach((k) => {
      const p = k.replace(/\\/g, '/');
      if (p.indexOf(ROOT) === 0) delete require.cache[k];
    });
    const cloud = require(path.join(UTILS, 'cloud.js'));
    global.wx.setStorageSync('zq_class_identity', JSON.stringify(ID));
    cloud.configure({
      enabled: true,
      restBase: 'https://mock.test/v1/rdb/rest/',
      restProfile: 'cloudbase',
      publishableKey: 'pub-net',
      timeout: 8000,
      timeouts: { default: 8000, login: 12000, poll: 8000, upload: 60000 },
      net: {
        enableHttp2: true, maxConcurrent: 8, weakMaxConcurrent: 3,
        retryAttempts: 2, retryBaseMs: 1, coalesce: true
      },
      ttUrl: '', ttLegacy: false,
      tables: { homework: 'homework', marks: 'marks', notices: 'notices', siteAssets: 'site_assets' }
    });
    cloud.netReset();
    return cloud;
  }

  return (async () => {
    try {
      // ============================================================ N1 三档配置
      await test('N1 两档 base：cloudbase 默认不变 / selfhosted=备案后域名（切换只改档位）', () => {
        const cfg = require(path.join(UTILS, 'cloud-config.js'));
        assert.strictEqual(cfg.restProfile, 'cloudbase', '发布前默认档位必须仍是 cloudbase（默认行为不变）');
        assert.ok(/^https:\/\/tool-d4gosudok46e0e081\.api\.tcloudbasegateway\.com\/v1\/rdb\/rest\/$/.test(cfg.restBase),
          'cloudbase 档应指向现有 CloudBase 网关：' + cfg.restBase);
        assert.strictEqual(cfg.resolveRestBase('selfhosted'), 'https://tool.furina.fun/v1/rdb/rest/', 'selfhosted 档 = 备案后正式域名');
        // 未知/空档位 → 回退当前档位（配置写错不会把站点打成「无后端」）
        assert.strictEqual(cfg.resolveRestBase(''), cfg.restBase);
        assert.strictEqual(cfg.resolveRestBase('typo'), cfg.restBase);
        assert.strictEqual(cfg.resolveRestBase(null), cfg.restBase);
        // 路径契约：两档都以 /v1/rdb/rest... 结尾 '/'（PostgREST 根，末尾斜杠是拼接口径）
        Object.keys(cfg.restProfiles).forEach((k) => {
          const u = cfg.restProfiles[k];
          assert.ok(/\/$/.test(u), k + ' 档必须以 / 结尾：' + u);
          assert.ok(/\/v1\/rdb\/rest/.test(u), k + ' 档路径应包含 /v1/rdb/rest：' + u);
        });
        // 公开仓库不内置明文调试入口：地址表全部为 https
        assert.ok(/^https:\/\//.test(cfg.restProfiles.cloudbase));
        assert.ok(/^https:\/\//.test(cfg.restProfiles.selfhosted));
        Object.keys(cfg.restProfiles).forEach((k) => {
          assert.ok(!/^http:\/\//.test(cfg.restProfiles[k]), k + ' 档不得使用 http：' + cfg.restProfiles[k]);
        });
        // 超时分级与网络层默认参数
        assert.ok(cfg.timeouts.login > cfg.timeouts.default, '登录超时应比默认宽（弱网冷启动）');
        assert.strictEqual(cfg.timeouts.default, 8000);
        assert.strictEqual(cfg.timeouts.login, 12000);
        assert.strictEqual(cfg.net.enableHttp2, true);
        assert.strictEqual(cfg.net.retryAttempts, 2);
        assert.strictEqual(cfg.net.coalesce, true);
        // publishableKey 仍为公开匿名令牌（只断存在性，不打印）
        assert.ok(String(cfg.publishableKey || '').length > 100, 'publishableKey 应存在（公开 anon 令牌）');
      });

      // ============================================================ N2 探针/默认值
      await test('N2 restInfo/netStats/timeoutOf：只读探针可用且不含 token，默认档 baseline 正常', () => {
        const cloud = freshCloud();
        assert.deepStrictEqual(cloud.restInfo(), {
          profile: 'cloudbase', base: 'https://mock.test/v1/rdb/rest/', staging: false, secure: true
        });
        const st = cloud.netStats();
        assert.strictEqual(st.requests, 0);
        assert.strictEqual(st.retries, 0);
        assert.strictEqual(st.coalesced, 0);
        assert.strictEqual(st.inflight, 0);
        assert.strictEqual(cloud.timeoutOf({}), 8000, '默认档 8000ms');
        assert.strictEqual(cloud.timeoutOf({ timeoutKey: 'login' }), 12000, 'login 档 12000ms');
        assert.strictEqual(cloud.timeoutOf({ timeout: 1234 }), 1234, '显式 timeout 优先');
        assert.strictEqual(cloud.timeoutOf({ timeoutKey: 'unknown' }), 8000, '未知分级回退默认档');
      });

      // ============================================================ N3 HTTP/2
      await test('N3 HTTP/2：https 请求带 enableHttp2=true；http 自定义地址不带（基础库/明文链接自动回退 1.1）', async () => {
        let cloud = freshCloud();
        resetLog();
        impl = ok([]);
        await cloud.cbGet('homework');
        assert.strictEqual(reqLog.length, 1);
        assert.strictEqual(reqLog[0].enableHttp2, true, 'https 请求应启用 HTTP/2');

        cloud = freshCloud();
        cloud.configure({ restProfile: 'custom', restBase: 'http://example.test/v1/rdb/rest/' });
        resetLog();
        await cloud.cbGet('homework');
        assert.strictEqual(reqLog[0].enableHttp2, undefined, 'http 请求不应传 enableHttp2');
        assert.deepStrictEqual(cloud.restInfo(), {
          profile: 'custom', base: 'http://example.test/v1/rdb/rest/', staging: true, secure: false
        });
      });

      // ============================================================ N4 超时分级
      await test('N4 超时分级：class_verify 登录用 12000ms；普通读写/轮询用 8000ms', async () => {
        const cloud = freshCloud();
        resetLog();
        impl = (o) => o.success({ statusCode: 200, data: { ok: true, token: 't1', sid: ID.sid, name: ID.name } });
        const r = await cloud.classVerify(ID.sid, ID.name);
        assert.strictEqual(r.ok, true);
        const v = reqLog.find((o) => String(o.url).indexOf('/rpc/class_verify') >= 0);
        assert.ok(v, '应发出 class_verify');
        assert.strictEqual(v.timeout, 12000, '登录超时用 login 档');

        resetLog();
        impl = ok([]);
        await cloud.cbGet('homework');
        assert.strictEqual(reqLog[0].timeout, 8000, '普通读写用 default 档');
        // 显式 timeout 仍最优先（上传分片等大请求不变）
        resetLog();
        await cloud.cbPost('marks', [{}], null, { timeout: 60000 });
        assert.strictEqual(reqLog[0].timeout, 60000, '显式 timeout 不被分级覆盖');
      });

      // ============================================================ N5 重试
      await test('N5a 重试：GET 弱网瞬时失败 1 次 → 自动重试成功（请求数 2，统计 retries=1）', async () => {
        const cloud = freshCloud();
        resetLog();
        let calls = 0;
        impl = (o) => { calls += 1; if (calls === 1) return o.fail({ errMsg: 'request:fail mock' }); return o.success({ statusCode: 200, data: [] }); };
        const data = await cloud.cbGet('homework');
        assert.deepStrictEqual(data, []);
        assert.strictEqual(reqLog.length, 2, '首次失败 + 重试 = 2 次请求');
        assert.strictEqual(cloud.netStats().retries, 1, '统计应记录 1 次重试');
      });

      await test('N5b 重试：502/503/504 网关瞬时错误按可重试处理（502 → 成功）；404 不重试', async () => {
        let cloud = freshCloud();
        resetLog();
        let calls = 0;
        impl = (o) => { calls += 1; return calls === 1 ? o.success({ statusCode: 502, data: {} }) : o.success({ statusCode: 200, data: [1] }); };
        const d = await cloud.cbGet('homework');
        assert.deepStrictEqual(d, [1]);
        assert.strictEqual(reqLog.length, 2, '502 应重试一次');

        cloud = freshCloud();
        resetLog();
        impl = (o) => o.success({ statusCode: 404, data: {} });
        let failed = false;
        try { await cloud.cbGet('homework'); } catch (e) { failed = true; }
        assert.ok(failed, '404 应失败');
        assert.strictEqual(reqLog.length, 1, '404 属确定性错误，不重试');
      });

      await test('N5c 重试上限：默认最多 2 次尝试（不会无限重试）；写请求（POST）网络失败不重试', async () => {
        let cloud = freshCloud();
        resetLog();
        impl = failAll();
        let failed = false;
        try { await cloud.cbGet('homework'); } catch (e) { failed = true; }
        assert.ok(failed);
        assert.strictEqual(reqLog.length, 2, '默认尝试 2 次（1 次 + 1 次重试）');

        cloud = freshCloud();
        resetLog();
        impl = failAll();
        failed = false;
        try { await cloud.cbUpsert('marks', { id: 'x' }); } catch (e) { failed = true; }
        assert.ok(failed);
        assert.strictEqual(reqLog.length, 1, '写请求绝不重试（避免重复写入）');
        assert.strictEqual(cloud.netStats().retries, 0);
      });

      // ============================================================ N6 在途合并
      await test('N6 在途合并：并发相同 GET 只发 1 个请求（多页面/定时器重复拉同一张表）', async () => {
        const cloud = freshCloud();
        resetLog();
        impl = delayed(15, { statusCode: 200, data: [{ id: 'a' }] });
        const p1 = cloud.cbGet('homework');
        const p2 = cloud.cbGet('homework');
        const [a, b] = await Promise.all([p1, p2]);
        assert.strictEqual(reqLog.length, 1, '两次并发相同 GET 应合并为 1 次请求（实际 ' + reqLog.length + '）');
        assert.strictEqual(cloud.netStats().coalesced, 1, '统计应记录 1 次合并');
        assert.deepStrictEqual(a, b);
        // 请求结束（已结算）后的新调用必须发新请求，不能复用旧结果
        resetLog();
        impl = ok([]);
        await cloud.cbGet('homework');
        assert.strictEqual(reqLog.length, 1, '已结算后相同 GET 应重新请求（不返回旧数据）');
      });

      await test('N6b 在途合并可关闭（net.coalesce=false）→ 并发请求各自发出（配置化回退，兼容旧行为）', async () => {
        const cloud = freshCloud();
        cloud.configure({ net: { enableHttp2: true, maxConcurrent: 8, weakMaxConcurrent: 3, retryAttempts: 2, retryBaseMs: 1, coalesce: false } });
        resetLog();
        impl = delayed(10, { statusCode: 200, data: [] });
        await Promise.all([cloud.cbGet('homework'), cloud.cbGet('homework')]);
        assert.strictEqual(reqLog.length, 2, '关闭合并后应各自请求');
        assert.strictEqual(cloud.netStats().coalesced, 0);
      });

      // ============================================================ N7 并发闸门
      await test('N7 并发闸门：全局并发上限生效（峰值 ≤ maxConcurrent），超限请求排队且全部成功', async () => {
        const cloud = freshCloud();
        cloud.configure({ net: { enableHttp2: true, maxConcurrent: 2, weakMaxConcurrent: 2, retryAttempts: 2, retryBaseMs: 1, coalesce: false } });
        resetLog();
        impl = delayed(12, { statusCode: 200, data: [] });
        const ps = [];
        for (let i = 0; i < 6; i += 1) ps.push(cloud.cbGet('homework?select=*&seq=' + i));   // URL 不同 → 不合并
        await Promise.all(ps);
        const st = cloud.netStats();
        assert.strictEqual(reqLog.length, 6);
        assert.strictEqual(st.requests, 6);
        assert.ok(st.peakInflight <= 2, '峰值并发应 ≤ 2（实际 ' + st.peakInflight + '）');
        assert.ok(st.queued >= 4, '其余请求应排队（实际 queued=' + st.queued + '）');
      });

      // ============================================================ N8 旧 base 成功路径不回退
      await test('N8 旧 CloudBase base 成功路径不回退：普通读写 1 次请求 / 0 重试 / 0 合并 / 超时口径不变', async () => {
        const cloud = freshCloud();
        resetLog();
        impl = ok([{ id: 'hw1' }]);
        const rows = await cloud.cbGet('homework');
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(reqLog.length, 1);
        const st = cloud.netStats();
        assert.strictEqual(st.requests, 1);
        assert.strictEqual(st.retries, 0);
        assert.strictEqual(st.coalesced, 0);
        assert.strictEqual(reqLog[0].timeout, 8000);
        assert.strictEqual(reqLog[0].header.Authorization, 'Bearer pub-net');
        assert.strictEqual(reqLog[0].header['X-Class-Token'], ID.token, '数据请求仍带班级 token');
        assert.strictEqual(reqLog[0].method, 'GET');
      });

      // ============================================================ N9 旧配置兼容
      await test('N9 旧配置兼容：未配置 timeouts/net 时不崩溃（回退配置文件的 timeout），请求照常发出', async () => {
        Object.keys(require.cache).forEach((k) => {
          if (k.replace(/\\/g, '/').indexOf(ROOT) === 0) delete require.cache[k];
        });
        const cloud = require(path.join(UTILS, 'cloud.js'));
        global.wx.setStorageSync('zq_class_identity', JSON.stringify(ID));
        // 模拟旧版 cloud-config（没有 timeouts/net 字段）
        cloud.configure({
          enabled: true, restBase: 'https://mock.test/v1/rdb/rest/', publishableKey: 'pub-net',
          timeouts: null, net: null
        });
        resetLog();
        impl = ok([]);
        await cloud.cbGet('homework');
        assert.strictEqual(reqLog.length, 1, '旧配置下请求应正常发出');
        // cloud-config.js 的 timeout=8000：未配置分级时回退它（不是无限/崩溃）
        assert.strictEqual(cloud.timeoutOf({}), 8000, '未配置分级时回退 CONFIG.timeout');
        assert.strictEqual(reqLog[0].timeout, 8000);
      });
    } finally {
      restoreMock();
    }
  })();
}

module.exports = { run: run };
