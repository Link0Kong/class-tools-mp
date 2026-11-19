/* 缓存 / TTL 单元测试：utils/cache.js（分块持久缓存）+ utils/cloud.js（缓存优先 + 轻量签名校验）
 *
 * 运行（两种方式都行）：
 *   node cache_unit_tests.js          # 独立运行，自带 wx mock，结果写 cache_unit_result.json
 *   node unit.js                      # unit.js 末尾通过 run(test) 把本文件的断言并入 61 项总表
 *
 * 依赖：仅 Node 内置模块；wx 用内存 mock，绝不发真实请求。
 * 说明：本文件不修改 unit.js 的全局 mock，运行时临时替换 global.wx，结束后恢复。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');

const ID = { token: 'tok-cache-1', sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: true, ts: 1 };
const ID2 = { token: 'tok-cache-2', sid: '9999000004', name: '谢梓萱', role: '', badge: '', is_admin: false, ts: 2 };

function purge() {
  Object.keys(require.cache).forEach(function (k) {
    if (k.replace(/\\/g, '/').indexOf(ROOT) !== 0) return;
    try {
      var m = require.cache[k];
      // 清掉上个用例可能遗留的 userdata 推送防抖 timer（避免污染本用例的 request 计数）
      if (m && m.exports && typeof m.exports.udStop === 'function') m.exports.udStop();
    } catch (e) { /* ignore */ }
    delete require.cache[k];
  });
}

function createCtx() {
  const mem = Object.create(null);
  let reqLog = [];
  let reqImpl = function (o) { o.success({ statusCode: 200, data: [] }); };
  const wxMock = {
    getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
    setStorageSync(k, v) { mem[k] = v; },
    removeStorageSync(k) { delete mem[k]; },
    getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 0, limitSize: 10240 }; },
    request(o) { reqLog.push(o); reqImpl(o); },
    showToast() {}, showModal() {}, showLoading() {}, hideLoading() {}
  };
  function fresh() {
    purge();
    return {
      cache: require(ROOT + '/utils/cache.js'),
      cloud: require(ROOT + '/utils/cloud.js'),
      store: require(ROOT + '/utils/store.js'),
      identity: require(ROOT + '/utils/identity.js')
    };
  }
  function clearMem() {
    Object.keys(mem).forEach(function (k) { delete mem[k]; });
    reqLog = [];
    reqImpl = function (o) { o.success({ statusCode: 200, data: [] }); };
  }
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
  function setIdentity(id) { mem['zq_class_identity'] = JSON.stringify(id || ID); }
  function urlOf(o) { return String((o && o.url) || ''); }
  function reqsOf(frag) { return reqLog.filter(function (o) { return urlOf(o).indexOf(frag) >= 0; }); }
  function noticesReqs() { return reqLog.filter(function (o) { return urlOf(o).indexOf('/notices?') >= 0; }); }
  function metaReqs() { return reqLog.filter(function (o) { return urlOf(o).indexOf('/rpc/class_notices_meta') >= 0; }); }
  function liteReqs() { return reqLog.filter(function (o) { return urlOf(o).indexOf('select=id,ts') >= 0; }); }
  function fullReqs() { return reqLog.filter(function (o) { return urlOf(o).indexOf('/notices?') >= 0 && urlOf(o).indexOf('select=*') >= 0; }); }
  // 2026-11-17：整表拉取首选 meta RPC（~0.3MB）；旧 select=* 只在接口缺失时回退。
  function bulkReqs() { return fullReqs().concat(metaReqs()); }
  function cacheKeys() { return Object.keys(mem).filter(function (k) { return k.indexOf('zqc1_') === 0; }); }
  function chunkKeys(name) {
    return Object.keys(mem).filter(function (k) { return k.indexOf('zqc1_') === 0 && k.indexOf('_' + name + '_') > 0; });
  }
  return {
    mem: mem, wxMock: wxMock,
    fresh: fresh, cloudFresh: cloudFresh, clearMem: clearMem, setIdentity: setIdentity,
    urlOf: urlOf, reqsOf: reqsOf, noticesReqs: noticesReqs, metaReqs: metaReqs, liteReqs: liteReqs, fullReqs: fullReqs, bulkReqs: bulkReqs,
    cacheKeys: cacheKeys, chunkKeys: chunkKeys,
    getReqLog: function () { return reqLog; },
    resetReqLog: function () { reqLog = []; },
    setReqImpl: function (fn) { reqImpl = fn; },
    ok: function (data) { return function (o) { o.success({ statusCode: 200, data: data === undefined ? [] : data }); }; }
  };
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// 模拟线上 notices 行：body = [[CLASS_NOTICE_V1]] + 组 JSON（含大段 data URI）
function autoRow(id, ts, payloadChars) {
  return {
    id: id,
    ts: ts,
    body: '[[CLASS_NOTICE_V1]]' + JSON.stringify({
      id: id,
      title: '自动通知 ' + id,
      createdAt: ts,
      items: [{ kind: 'img', src: 'data:image/jpeg;base64,' + 'A'.repeat(payloadChars || 2000) }]
    })
  };
}
function normalRow(id, ts) {
  return { id: id, ts: ts, title: '手动通知 ' + id, body: '普通通知', archived: false };
}
function noticeRows(extra) {
  return [autoRow('auto_1', 1000), autoRow('auto_2', 2000), normalRow('man_1', 1500)].concat(extra || []);
}

function run(test) {
  const prevWx = global.wx;
  const hadGetApp = Object.prototype.hasOwnProperty.call(global, 'getApp');
  const prevGetApp = global.getApp;
  const C = createCtx();
  global.wx = C.wxMock;

  return (async function () {
    /* ============ utils/cache.js ============ */
    await test('缓存：常量上限（单块 600KB / 总预算 5MB）', function () {
      const { cache, identity } = C.fresh();
      void identity;
      assert.strictEqual(cache.CHUNK_MAX_BYTES, 600 * 1024);
      assert.strictEqual(cache.CHUNK_MAX_CHARS, 600 * 1024);
      assert.strictEqual(cache.MAX_BYTES, 5 * 1024 * 1024);
      assert.strictEqual(cache.PREFIX, 'zqc1_');
    });

    await test('缓存：>1MB 数据分块读写往返一致，单块 ≤600KB、块数 ≥2', function () {
      const { cache } = C.fresh();
      C.clearMem();
      C.setIdentity(ID);
      // ~1.25MB（80 万 ASCII + 15 万中文 ×3 字节 ≈ 1.25MB UTF-8）
      const big = 'A'.repeat(800000) + '中'.repeat(150000);
      const t0 = Date.now();
      assert.strictEqual(cache.set('big', { s: big, n: 7, ok: true }, 60000), true);
      const m = cache.getWithMeta('big');
      assert.ok(m, '大对象应能读回');
      assert.strictEqual(m.val.s.length, big.length);
      assert.strictEqual(m.val.s, big, '>1MB 内容往返必须字节一致');
      assert.strictEqual(m.val.n, 7);
      assert.ok(m.bytes > 1024 * 1024, '索引里应记录 >1MB 的实际字节数：' + m.bytes);
      // 分块断言：块数 ≥2、每块字符数 ≤600KB、UTF-8 估算字节 ≤600KB
      const chunks = C.chunkKeys('big');
      assert.ok(chunks.length >= 2, '1.25MB 应至少切成 2 块，实际 ' + chunks.length);
      chunks.forEach(function (k) {
        const v = C.mem[k];
        assert.strictEqual(typeof v, 'string');
        assert.ok(v.length <= 600 * 1024, '单块字符数超限：' + v.length);
        assert.ok(cache._utf8Len(v) <= 600 * 1024, '单块 UTF-8 字节超限：' + cache._utf8Len(v));
      });
      assert.ok(Date.now() - t0 < 3000, '分块读写耗时异常');
      cache.del('big');
      assert.strictEqual(cache.get('big'), null);
      assert.strictEqual(C.chunkKeys('big').length, 0, '删除后分块应清干净');
    });

    await test('缓存：整块边界（文本恰为 600KB）不产生空块，往返一致', function () {
      const { cache } = C.fresh();
      C.clearMem();
      C.setIdentity(ID);
      // 裸字符串 JSON.stringify 后长度 = 2 + (CHUNK_MAX_BYTES-2) = CHUNK_MAX_BYTES（恰好一块）
      const exact = 'x'.repeat(cache.CHUNK_MAX_BYTES - 2);
      assert.strictEqual(cache.set('edge1', exact, 60000), true);
      assert.strictEqual(C.chunkKeys('edge1').length, 1, '恰好 600KB 应只有 1 块（不能多出空块）');
      assert.strictEqual(cache.get('edge1'), exact, '边界值往返必须一致');
      // 多 1 个字符 → 2 块，第 2 块只有 1 个字符（非空）
      const over = exact + 'y';
      assert.strictEqual(cache.set('edge2', over, 60000), true);
      const ck = C.chunkKeys('edge2');
      assert.strictEqual(ck.length, 2, '超出 1 字符应切成 2 块');
      ck.forEach(function (k) { assert.ok(String(C.mem[k]).length > 0, '不允许出现空块'); });
      assert.strictEqual(cache.get('edge2'), over);
    });

    await test('缓存：TTL 过期后 fresh=false 但旧值仍可读（SWR 先渲染缓存）', async function () {
      const { cache } = C.fresh();
      C.clearMem();
      C.setIdentity(ID);
      cache.set('ttl', { v: 1 }, 25);
      assert.strictEqual(cache.fresh('ttl'), true);
      assert.strictEqual(cache.meta('ttl').ttl, 25);
      await sleep(40);
      assert.strictEqual(cache.fresh('ttl'), false);
      assert.deepStrictEqual(cache.get('ttl'), { v: 1 }, '过期只影响刷新判断，不应清掉数据');
      // ttl <= 0 = 不过期（lastSync manifest 用）
      cache.set('forever', { a: 1 }, 0);
      assert.strictEqual(cache.fresh('forever'), true);
    });

    await test('缓存：按学号 sid 隔离，换号读不到别人的缓存', function () {
      const { cache } = C.fresh();
      C.clearMem();
      C.setIdentity(ID);
      cache.set('iso', { who: 'A' }, 60000);
      assert.deepStrictEqual(cache.get('iso'), { who: 'A' });
      C.setIdentity(ID2);                        // 换人（学号变了）
      assert.strictEqual(cache.get('iso'), null, '换号后不能读到上一位同学的缓存');
      cache.set('iso2', { who: 'B' }, 60000);
      C.setIdentity(ID);
      assert.deepStrictEqual(cache.get('iso'), { who: 'A' });
      assert.strictEqual(cache.get('iso2'), null);
      assert.strictEqual(cache.clearOtherSids(), true);
      assert.strictEqual(C.mem['zqc1_idx'].indexOf(ID2.sid), -1, 'clearOtherSids 后索引里不应再有旧 sid');
    });

    await test('缓存：退出身份（identity.clear）清空全部 zqc1_ 键；无身份不写缓存', function () {
      const { cache, identity } = C.fresh();
      C.clearMem();
      C.setIdentity(ID);
      cache.set('a', { s: 'x'.repeat(700000) }, 60000);   // 分两块
      cache.set('b', { s: 'y' }, 60000);
      assert.ok(C.cacheKeys().length > 0);
      assert.strictEqual(identity.clear(), undefined);
      assert.strictEqual(C.cacheKeys().length, 0, '退出身份后 storage 里不能残留分块缓存');
      assert.strictEqual(cache.stats().items, 0);
      // 没有身份时写缓存直接被拒（隐私）
      assert.strictEqual(cache.set('nobody', { v: 1 }, 1000), false);
      assert.strictEqual(cache.get('nobody'), null);
    });

    await test('缓存：缺块 / 损坏 / 版本不符 → 读返回 null 并清理该条', function () {
      const { cache } = C.fresh();
      C.clearMem();
      C.setIdentity(ID);
      // 1) 缺块
      cache.set('broken', { s: 'x'.repeat(1200000) }, 60000);
      const keys = C.chunkKeys('broken');
      assert.ok(keys.length >= 2);
      delete C.mem[keys[0]];
      assert.strictEqual(cache.get('broken'), null, '缺块应视为未命中');
      assert.strictEqual(C.chunkKeys('broken').length, 0, '缺块条目应被清理');
      // 2) 块内容不是合法 JSON
      cache.set('garbled', { s: 'hello' }, 60000);
      const gk = C.chunkKeys('garbled')[0];
      C.mem[gk] = 'not-json{{{';
      assert.strictEqual(cache.get('garbled'), null);
      // 3) 索引版本不符
      cache.set('ver', { v: 1 }, 60000);
      const idx = JSON.parse(C.mem[cache.IDX_KEY]);
      Object.keys(idx.items).forEach(function (k) { idx.items[k].ver = 99; });
      C.mem[cache.IDX_KEY] = JSON.stringify(idx);
      assert.strictEqual(cache.get('ver'), null, '版本不符应静默丢弃');
      // 索引本身坏掉时也不抛错
      C.mem[cache.IDX_KEY] = '{bad index';
      assert.strictEqual(cache.get('ver'), null);
      assert.strictEqual(cache.set('after', { ok: 1 }, 1000), true, '索引重建后仍可写');
    });

    await test('缓存：总预算 5MB 超限按时间淘汰旧条目（LRU）；单条超预算拒绝写入', function () {
      const { cache } = C.fresh();
      C.clearMem();
      C.setIdentity(ID);
      const big = 'x'.repeat(2100000);   // ≈2.1MB（ASCII）
      assert.strictEqual(cache.set('old', { s: big }, 0), true);
      assert.strictEqual(cache.set('mid', { s: big }, 0), true);
      assert.strictEqual(C.cacheKeys().length > 4, true);
      assert.strictEqual(cache.set('new', { s: big }, 0), true);   // 2.1×3 > 5MB → 淘汰最旧
      assert.strictEqual(cache.get('old'), null, '最旧条目应被淘汰');
      assert.ok(cache.get('mid'), '较新的条目应保留');
      assert.ok(cache.get('new'), '刚写入的条目应保留');
      assert.strictEqual(cache.set('huge', { s: 'x'.repeat(6 * 1024 * 1024) }, 0), false, '单条超预算应拒绝写入（不抛错）');
    });

    await test('缓存：stats/meta 反映当前 sid 的条目与估算字节', function () {
      const { cache } = C.fresh();
      C.clearMem();
      C.setIdentity(ID);
      cache.set('one', { s: 'a'.repeat(1000) }, 0);
      const st = cache.stats();
      assert.strictEqual(st.sid, ID.sid);
      assert.deepStrictEqual(st.names, ['one']);
      assert.ok(st.bytes >= 1000);
      assert.strictEqual(st.items, 1);
    });

    /* ============ utils/cloud.js：通知缓存优先 + 签名重校验 ============ */
    await test('云通知：首进整表 1 次并写分块缓存；二次进入 0 请求（缓存秒开）', async function () {
      const { cloud, cache } = C.cloudFresh();
      C.setIdentity(ID);
      const rows = [autoRow('auto_1', 1000, 400000), autoRow('auto_2', 2000, 400000), normalRow('man_1', 1500)];
      C.setReqImpl(function (o) { o.success({ statusCode: 200, data: rows }); });
      const g1 = await cloud.ntAutoPull();
      assert.strictEqual(g1.length, 2);
      assert.strictEqual(C.metaReqs().length, 1, '首进应只发 1 次 meta RPC（~0.3MB）');
      assert.strictEqual(C.noticesReqs().length, 0, '不应再拉旧 14MB 整表');
      assert.strictEqual(C.liteReqs().length, 0, '无缓存时不该先发签名请求');
      const cached = cache.getWithMeta('ntAuto');
      assert.ok(cached && cached.val && cached.val.g.length === 2, 'auto groups 应写入持久缓存');
      assert.ok(String(cached.val.sig).length > 0, '缓存里应带签名');
      assert.ok(cached.bytes > 780000, '2×~400KB 组应 >780KB：' + cached.bytes);
      assert.ok(C.chunkKeys('ntAuto').length >= 2, '大 payload 必须分块');
      C.resetReqLog();
      const g2 = await cloud.ntAutoPull();
      assert.strictEqual(g2.length, 2);
      assert.deepStrictEqual(g2[0].id, 'auto_1');
      assert.strictEqual(C.getReqLog().length, 0, 'TTL 内二次进入必须 0 请求');
      // 配额：2MB 的 auto groups 只能进 cache.js 分块，绝不能写进 zq_tools_v2（单 key 上限风险）
      const storeRaw = JSON.stringify(require(ROOT + '/utils/store.js').get());
      assert.ok(storeRaw.length < 200 * 1024, 'zq_tools_v2 不应被 2MB auto groups 撑大：' + storeRaw.length + ' 字符');
      assert.strictEqual(storeRaw.indexOf('[[CLASS_NOTICE_V1]]'), -1, 'store 里不应有 auto 通知原文');
    });

    await test('云通知：TTL 过期 + 签名一致 → 只发 ~2KB 签名请求，不拉整表', async function () {
      const { cloud, cache } = C.cloudFresh();
      C.setIdentity(ID);
      const rows = noticeRows();
      C.setReqImpl(function (o) {
        if (String(o.url).indexOf('select=id,ts') >= 0) return o.success({ statusCode: 200, data: rows.map(function (r) { return { id: r.id, ts: r.ts }; }) });
        return o.success({ statusCode: 200, data: rows });
      });
      await cloud.ntAutoPull();
      assert.strictEqual(C.bulkReqs().length, 1);
      // 模拟 TTL 过期（不改数据）
      const sync = cache.get('lastSync');
      sync.ntAuto = Date.now() - cloud.TTL.notices - 5000;
      sync.nt = sync.ntAuto;
      cache.set('lastSync', sync, 0);
      C.resetReqLog();
      const list = await cloud.ntPull();
      assert.ok(Array.isArray(list));
      assert.strictEqual(C.liteReqs().length, 1, '过期后应先发 1 次轻量签名请求');
      assert.strictEqual(C.bulkReqs().length, 0, '签名一致时不应拉 2MB 整表');
      // 数据变了（新增一行）→ 签名不一致 → 整表 1 次
      const rows2 = rows.concat([autoRow('auto_9', 9000)]);
      C.setReqImpl(function (o) {
        if (String(o.url).indexOf('select=id,ts') >= 0) return o.success({ statusCode: 200, data: rows2.map(function (r) { return { id: r.id, ts: r.ts }; }) });
        return o.success({ statusCode: 200, data: rows2 });
      });
      const sync2 = cache.get('lastSync');
      sync2.ntAuto = Date.now() - cloud.TTL.notices - 5000;
      sync2.nt = sync2.ntAuto;
      cache.set('lastSync', sync2, 0);
      C.resetReqLog();
      await cloud.ntPull();
      assert.strictEqual(C.liteReqs().length, 1);
      assert.strictEqual(C.bulkReqs().length, 1, '签名变了才整表拉 1 次');
      const g = await cloud.ntAutoPull();
      assert.strictEqual(g.length, 3, '整表后缓存应包含新通知');
    });

    await test('云通知 2026-11-17：meta RPC 优先（~0.3MB），lite body 的 lazy 标记原样进缓存', async function () {
      const { cloud, cache } = C.cloudFresh();
      C.setIdentity(ID);
      const liteBody = '[[CLASS_NOTICE_V1]]' + JSON.stringify({
        id: 'g_lite', title: '轻量通知',
        items: [
          { kind: 'img', src: '', lazy: true, caption: '图1' },
          { kind: 'file', name: 'a.pdf', size: '128 KB', url: '', lazy: true },
          { kind: 'text', text: '正文' }
        ]
      });
      const rows = [
        { id: 'auto_g_lite', ts: 1000, body: liteBody, hidden: false, override_json: '', edited_at: 0, edited_by: '' },
        normalRow('man_1', 1500)
      ];
      C.setReqImpl(function (o) {
        if (String(o.url).indexOf('class_notices_meta') >= 0) return o.success({ statusCode: 200, data: rows });
        return o.success({ statusCode: 200, data: [] });
      });
      const g = await cloud.ntAutoPull();
      assert.strictEqual(C.metaReqs().length, 1, '应优先走 meta RPC');
      assert.strictEqual(C.noticesReqs().length, 0, '不应再拉旧整表');
      assert.strictEqual(g.length, 1);
      assert.strictEqual(g[0].items[0].lazy, true);
      assert.strictEqual(g[0].items[0].src, '', 'data URI 由服务端置空');
      const cached = cache.getWithMeta('ntAuto');
      assert.ok(cached && cached.val && cached.val.g.length === 1, 'lite 结果应写入分块缓存');
      assert.ok(cached.bytes < 100 * 1024, 'lite 缓存应远小于 100KB：' + cached.bytes);
      assert.strictEqual(JSON.stringify(cached.val).indexOf('data:image'), -1, '缓存里不应有 data URI');
    });

    await test('云通知 2026-11-17：meta RPC 404（旧后端）→ 回退 select=* 整表一次', async function () {
      const { cloud } = C.cloudFresh();
      C.setIdentity(ID);
      const rows = noticeRows();
      C.setReqImpl(function (o) {
        const u = String(o.url);
        if (u.indexOf('class_notices_meta') >= 0) return o.success({ statusCode: 404, data: {} });
        if (u.indexOf('/notices?') >= 0) return o.success({ statusCode: 200, data: rows });
        return o.success({ statusCode: 200, data: [] });
      });
      const g = await cloud.ntAutoPull();
      assert.strictEqual(C.metaReqs().length, 1, '先尝试 meta');
      assert.strictEqual(C.fullReqs().length, 1, '接口不存在时回退旧整表 1 次');
      assert.strictEqual(g.length, 2);
    });

    await test('云通知 2026-11-17：meta RPC 401 → 清本机身份、绝不回退公开整表', async function () {
      const { cloud, identity } = C.cloudFresh();
      C.setIdentity(ID);
      C.setReqImpl(function (o) {
        if (String(o.url).indexOf('class_notices_meta') >= 0) return o.success({ statusCode: 401, data: {} });
        return o.success({ statusCode: 200, data: noticeRows() });
      });
      const g = await cloud.ntAutoPull();
      assert.deepStrictEqual(g, [], '401 时不应把旧/公开数据当结果');
      assert.strictEqual(C.fullReqs().length, 0, '401 不得回退旧整表（避免继续用失效 token/公开读）');
      assert.strictEqual(identity.has(), false, '401 应清掉本机身份，回身份页重新验证');
    });


    await test('云通知：force（下拉刷新）只跳过 TTL，不跳过签名校验 → 未变时 0 整表', async function () {
      const { cloud } = C.cloudFresh();
      C.setIdentity(ID);
      const rows = noticeRows();
      C.setReqImpl(function (o) {
        if (String(o.url).indexOf('select=id,ts') >= 0) return o.success({ statusCode: 200, data: rows.map(function (r) { return { id: r.id, ts: r.ts }; }) });
        return o.success({ statusCode: 200, data: rows });
      });
      await cloud.ntAutoPull();
      C.resetReqLog();
      const g = await cloud.ntAutoPull(true);
      assert.strictEqual(g.length, 2, 'force 时仍要返回可用数据');
      assert.strictEqual(C.liteReqs().length, 1, 'force 仍先做签名校验');
      assert.strictEqual(C.bulkReqs().length, 0, 'force 不应无条件整表拉 2MB');
    });

    await test('云通知：后台校验发现变化 → notifyPages 被调用；无 getApp 时不崩', async function () {
      const { cloud, cache } = C.cloudFresh();
      C.setIdentity(ID);
      let rows = noticeRows();
      C.setReqImpl(function (o) {
        if (String(o.url).indexOf('select=id,ts') >= 0) return o.success({ statusCode: 200, data: rows.map(function (r) { return { id: r.id, ts: r.ts }; }) });
        return o.success({ statusCode: 200, data: rows });
      });
      await cloud.ntAutoPull();
      // 有 getApp：后台刷新完成后应通知页面重绘
      let notified = 0;
      global.getApp = function () { return { notifyPages: function () { notified += 1; } }; };
      rows = rows.concat([autoRow('auto_new', 5000)]);
      const sync = cache.get('lastSync');
      sync.ntAuto = Date.now() - cloud.TTL.notices - 5000;
      sync.nt = sync.ntAuto;
      cache.set('lastSync', sync, 0);
      const stale = await cloud.ntAutoPull();          // 过期：先返回旧缓存
      assert.strictEqual(stale.length, 2, '过期时应先秒开旧缓存');
      await sleep(200);
      assert.ok(notified >= 1, '后台刷新后发现变化应调用 app.notifyPages()');
      const fresh = await cloud.ntAutoPull();
      assert.strictEqual(fresh.length, 3, '后台刷新后缓存应更新');
      // 无 getApp（unit 环境 / 页面未注册）：后台刷新不得抛错
      delete global.getApp;
      rows = rows.concat([autoRow('auto_new2', 6000)]);
      const sync2 = cache.get('lastSync');
      sync2.ntAuto = Date.now() - cloud.TTL.notices - 5000;
      cache.set('lastSync', sync2, 0);
      await cloud.ntAutoPull();
      await sleep(200);
      assert.strictEqual((await cloud.ntAutoPull()).length, 4, '无 getApp 时后台刷新仍应完成且不崩');
    });

    /* ============ utils/cloud.js：小表 TTL 门控 ============ */
    await test('课表 2026-11-17：ttLegacy=false（DNS 暂停期）→ site_assets 失败也不再打旧域名', async function () {
      const { cloud } = C.cloudFresh();
      C.setIdentity(ID);
      cloud.configure({ ttLegacy: false });
      C.setReqImpl(function (o) {
        const u = String(o.url || '');
        if (u.indexOf('/site_assets?') >= 0) return o.success({ statusCode: 404, data: {} });
        if (u.indexOf('/tt.json') >= 0) return o.success({ statusCode: 200, data: { c: [{ name: '不应出现' }] } });
        return o.success({ statusCode: 200, data: [] });
      });
      let err = null;
      try { await cloud.ttFetch(true); } catch (e) { err = e; }
      assert.ok(err, 'site_assets 失败且 legacy 关闭时应 reject（页面保留本机缓存）');
      assert.strictEqual(C.reqsOf('/tt.json').length, 0, '不得再请求已暂停解析的 tool.furina.fun');
    });

    await test('云：cloudPull 连续 3 次只有第 1 次打网络（TTL 门控）', async function () {
      const { cloud } = C.cloudFresh();
      C.setIdentity(ID);
      C.setReqImpl(function (o) {
        if (String(o.url).indexOf('/rpc/class_members') >= 0) return o.success({ statusCode: 200, data: [{ seat: 1, sid: '9999000001', name: '李学盈' }] });
        return o.success({ statusCode: 200, data: [] });
      });
      await cloud.cloudPull();
      const n1 = C.getReqLog().length;
      assert.ok(n1 >= 4, '首轮应请求各表：' + n1);
      C.resetReqLog();
      await cloud.cloudPull();
      await cloud.cloudPull();
      assert.strictEqual(C.getReqLog().length, 0, 'TTL 内的后续轮询必须 0 请求（原来每 30s 重拉）');
    });

    await test('云：hwPull / ttFetch 第二次 0 请求（TTL 内直接返回本机 store）', async function () {
      const { cloud, store } = C.cloudFresh();
      C.setIdentity(ID);
      C.setReqImpl(function (o) {
        if (String(o.url).indexOf('/homework') >= 0) return o.success({ statusCode: 200, data: [{ id: 'h1', content: '高数', archived: false }] });
        if (String(o.url).indexOf('/tt.json') >= 0) return o.success({ statusCode: 200, data: { c: [{ name: '高数', day: 0, start: 1, end: 2 }], t: '2026-09-07' } });
        return o.success({ statusCode: 200, data: [] });
      });
      await cloud.hwPull();
      const rows = await cloud.hwPull();
      assert.strictEqual(C.reqsOf('/homework').filter(function (o) { return o.method === 'GET'; }).length, 1, 'hwPull 第二次不该再请求');
      assert.ok(rows.some(function (x) { return x.id === 'h1'; }));
      const tt1 = await cloud.ttFetch();
      assert.strictEqual(tt1.c.length, 1);
      // 页面拿到后会写 store.ttCache（index.js / tt.js 的行为）
      store.get().ttCache = { c: tt1.c, t: tt1.t, at: Date.now(), meta: null };
      store.save();
      C.resetReqLog();
      const tt2 = await cloud.ttFetch();
      assert.strictEqual(tt2.c.length, 1);
      assert.strictEqual(C.getReqLog().length, 0, 'ttFetch 第二次（6h TTL 内）应 0 请求');
    });

    await test('云：force 时小表直接打网络（下拉刷新语义）', async function () {
      const { cloud } = C.cloudFresh();
      C.setIdentity(ID);
      C.setReqImpl(C.ok([{ id: 'h1', content: 'x', archived: false }]));
      await cloud.hwPull();
      C.resetReqLog();
      await cloud.hwPull(true);
      assert.strictEqual(C.reqsOf('/homework').length, 1, 'force 应强制请求一次');
    });

    await test('云：退出身份后缓存 / lastSync 不可见（隐私）', async function () {
      const { cloud, cache, identity } = C.cloudFresh();
      C.setIdentity(ID);
      C.setReqImpl(C.ok(noticeRows()));
      await cloud.ntAutoPull();
      assert.ok(cache.stats().items >= 2, '应已写入 ntAuto + lastSync');
      identity.logout();
      assert.strictEqual(C.cacheKeys().length, 0, '退出身份应清空所有分块缓存');
      assert.strictEqual(cache.get('lastSync'), null);
      C.setIdentity(ID);
      assert.strictEqual(cache.get('lastSync'), null, '重新验证后 lastSync 应为空（会重新同步）');
    });

    await test('app.js：onShow 不立刻拉大表（~300ms 后后台预热），onHide 停表', async function () {
      C.cloudFresh();                       // 清 storage + 重载 cloud
      C.setIdentity(ID);
      C.setReqImpl(function (o) {
        if (String(o.url).indexOf('/rpc/class_members') >= 0) return o.success({ statusCode: 200, data: [] });
        if (String(o.url).indexOf('/notices?') >= 0) return o.success({ statusCode: 200, data: noticeRows() });
        return o.success({ statusCode: 200, data: [] });
      });
      const g = global;
      const prevApp = g.App, prevGCP = g.getCurrentPages;
      let appDef = null;
      g.App = function (d) { appDef = d; };
      g.getCurrentPages = function () { return [{ route: 'pages/index/index' }]; };
      try {
        require(ROOT + '/app.js');
        assert.ok(appDef, 'app.js 未注册 App()');
        appDef.onLaunch();
        appDef.onShow.call(appDef);
        assert.strictEqual(C.metaReqs().length + C.noticesReqs().length, 0, 'onShow 立刻同步会阻塞首屏：应延后 ~300ms 才拉通知大表');
        await sleep(420);
        assert.ok(C.metaReqs().length >= 1, '300ms 后应后台预热/刷新一次通知表');
        appDef.onHide.call(appDef);
        assert.strictEqual(appDef._timer, null, 'onHide 应停掉 30s 轮询');
        assert.strictEqual(appDef._warmT, null, 'onHide 应清掉预热 timer');
      } finally {
        g.App = prevApp;
        g.getCurrentPages = prevGCP;
      }
    });
  })().finally(function () {
    global.wx = prevWx;
    if (hadGetApp) global.getApp = prevGetApp;
    else delete global.getApp;
    purge();
  });
}

module.exports = { run: run };

/* 独立运行：node cache_unit_tests.js */
if (require.main === module) {
  const results = [];
  let passN = 0, failN = 0;
  const test = async function (name, fn) {
    try { await fn(); passN += 1; results.push({ name: name, ok: true }); console.log('PASS  ' + name); }
    catch (e) { failN += 1; results.push({ name: name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
  };
  run(test).then(function () {
    const summary = { total: passN + failN, pass: passN, fail: failN, results: results, at: new Date().toISOString() };
    fs.writeFileSync(path.join(__dirname, 'cache_unit_result.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log('\n================ cache unit: ' + passN + ' passed, ' + failN + ' failed ================');
    process.exitCode = failN ? 2 : 0;
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}

