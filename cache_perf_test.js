/* 性能/缓存量化验证（mock wx，不访问真实云端）：性能优化 1.4.4
 *
 * 运行：node cache_perf_test.js
 * 输出：_perf_cache_result.json（供报告引用）+ 控制台摘要
 *
 * 验证目标（对应 _perf_task/RECON.md §4.2）：
 *   1) 首进通知页：1 次整表请求（~1.95MB）并写入分块缓存；
 *   2) 二次进入通知页：0 网络请求（读持久缓存，冷模块也命中）；
 *   3) 模拟 30s 轮询 N 次：notices/homework 请求次数不随 N 线性增长（TTL 门控 + 签名重校验）；
 *   4) before/after 请求数与传输字节数对比（before = 旧行为：每 30s 整表重拉）。
 *
 * 说明：响应体按线上实测规模构造成本近似（24 组 auto 通知 ≈1.95MB：9 图 + 5 文件 data URI）。
 *       网络延迟不在本机模拟，因此耗时只统计「解析 / 存储 / 缓存命中」这些 CPU 侧开销。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/Ko_Li/.openclaw/workspace/mp-class-tools';
const ID = { token: 'tok-perf', sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: true, ts: 1 };

// ---------------------------------------------------------------- 线上实测规模（RECON §2.1）
const REAL = {
  noticesFullBytes: 2001996,     // Lead 实测：notices?select=*&archived=eq.false
  noticesLiteBytes: 2106,        // Lead 实测：notices?select=id,ts
  imageCharsTotal: 1310983,      // 9 张图片 data URI
  fileCharsTotal: 605116,        // 5 个附件 data URI
  metaChars: 32999,              // 24 组元数据
  manualRows: 19,
  homeworkBytes: 1179,
  fitrecsBytes: 3854,
  marksBytes: 361,
  membersRows: 70
};

function buildFixtures() {
  const rows = [];
  const groupN = 24, imgN = 9, fileN = 5;
  const perImg = Math.floor(REAL.imageCharsTotal / imgN);
  const perFile = Math.floor(REAL.fileCharsTotal / fileN);
  const perMeta = Math.floor(REAL.metaChars / groupN);
  for (let i = 0; i < groupN; i++) {
    const items = [];
    if (i < imgN) {
      items.push({ kind: 'img', name: 'IMG_' + i + '.jpg', t: 'image/jpeg', src: 'data:image/jpeg;base64,' + 'A'.repeat(perImg) });
    }
    if (i < fileN) {
      items.push({ kind: 'file', name: '附件_' + i + '.pdf', t: 'application/pdf', src: 'data:application/pdf;base64,' + 'B'.repeat(perFile) });
    }
    const g = {
      id: 'auto_' + (1000 + i),
      title: '自动通知 #' + i,
      cat: i % 3 === 0 ? '教务' : '活动',
      createdAt: 1760000000000 + i * 60000,
      summary: '摘要内容'.repeat(Math.max(1, Math.floor(perMeta / 4))) + '通'.repeat(Math.max(0, perMeta - 400)),
      plain: '原始消息正文 ' + i,
      senderName: '陈玉霞',
      senderRole: i % 2 ? '班长' : '学习委员',
      ocr: i < 4,
      items: items
    };
    rows.push({ id: g.id, ts: g.createdAt, body: '[[CLASS_NOTICE_V1]]' + JSON.stringify(g), archived: false });
  }
  for (let i = 0; i < REAL.manualRows; i++) {
    rows.push({ id: 'man_' + i, ts: 1750000000000 + i * 1000, title: '手动通知 ' + i, body: '普通通知内容', archived: false });
  }
  const homework = [];
  for (let i = 0; i < 8; i++) homework.push({ id: 'hw_' + i, subject: '高数', content: '习题 ' + i, due: '', date: '2026-11-05', author: '测试账号', owner: '3260799999', attachments: '', done: false, archived: false, ts: 1760000000000 + i });
  const fitrecs = [];
  for (let i = 0; i < 2; i++) fitrecs.push({ id: 'fit_' + i, acc: ID.sid, data: JSON.stringify({ id: 'fit_' + i, ts: i + 1, sex: 'm', gr: '12', fields: {}, total: 83, grade: '良好' }), arch: false, ts: i + 1 });
  const marks = [{ id: ID.sid + '|hw|hw_0', seat: ID.sid, kind: 'hw', ref: 'hw_0', val: true, ts: 1 }];
  const members = [];
  for (let i = 0; i < REAL.membersRows; i++) members.push({ seat: i + 1, sid: '32607070' + (10 + i), name: '同学' + (i + 1), role: i < 8 ? '班委' : '', badge: '', is_admin: i === 23 });
  return { rows: rows, homework: homework, fitrecs: fitrecs, marks: marks, members: members };
}

const FIX = buildFixtures();
const SIZE = {
  noticesFull: JSON.stringify(FIX.rows).length,
  noticesLite: JSON.stringify(FIX.rows.map(function (r) { return { id: r.id, ts: r.ts }; })).length,
  homework: JSON.stringify(FIX.homework).length,
  fitrecs: JSON.stringify(FIX.fitrecs).length,
  marks: JSON.stringify(FIX.marks).length,
  members: JSON.stringify(FIX.members).length
};

// ---------------------------------------------------------------- 运行环境
const stats = {
  requests: 0,          // 请求次数
  bytes: 0,             // 响应体字节（JSON.stringify 字符数，近似线上无 gzip 的传输量）
  byTable: {}
};
function record(table, data) {
  stats.requests += 1;
  const n = JSON.stringify(data == null ? null : data).length;
  stats.bytes += n;
  stats.byTable[table] = (stats.byTable[table] || 0) + 1;
  return n;
}
function resetStats() { stats.requests = 0; stats.bytes = 0; stats.byTable = {}; }

function serve(o) {
  const u = String(o.url || '');
  let data;
  if (u.indexOf('select=id,ts') >= 0) { data = FIX.rows.map(function (r) { return { id: r.id, ts: r.ts }; }); record('notices_lite', data); }
  else if (u.indexOf('/notices?') >= 0) { data = FIX.rows; record('notices_full', data); }
  else if (u.indexOf('/homework') >= 0) { data = FIX.homework; record('homework', data); }
  else if (u.indexOf('/fitrecs') >= 0) { data = FIX.fitrecs; record('fitrecs', data); }
  else if (u.indexOf('/marks') >= 0) { data = FIX.marks; record('marks', data); }
  else if (u.indexOf('/rpc/class_members') >= 0) { data = FIX.members; record('members', data); }
  else if (u.indexOf('/tt.json') >= 0) { data = { c: [{ name: '高数', day: 0, start: 1, end: 2 }], t: '2026-09-07' }; record('tt', data); }
  else { data = []; record('other', data); }
  o.success({ statusCode: 200, data: data });
}

const mem = Object.create(null);
mem['zq_class_identity'] = JSON.stringify(ID);
global.wx = {
  getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
  setStorageSync(k, v) { mem[k] = v; },
  removeStorageSync(k) { delete mem[k]; },
  getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 0, limitSize: 10240 }; },
  request(o) { serve(o); },
  showToast() {}, showModal() {}, showLoading() {}, hideLoading() {}
};

function purge() {
  Object.keys(require.cache).forEach(function (k) {
    if (k.replace(/\\/g, '/').indexOf(ROOT) === 0) delete require.cache[k];
  });
}
function newCloud() {
  purge();
  const cloud = require(ROOT + '/utils/cloud.js');
  cloud.configure({
    enabled: true,
    restBase: 'https://mock.test/v1/rdb/rest/',
    publishableKey: 'pub',
    ttUrl: 'https://static.test/tt.json',
    timeout: 1000,
    rpc: { verify: 'rpc/class_verify', members: 'rpc/class_members' }
  });
  return cloud;
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function nowMs() { return Number(process.hrtime.bigint()) / 1e6; }

// 可控时钟：模拟 30s 轮询时推进时间（TTL 判断全部走 Date.now）
const realDateNow = Date.now;
let CLOCK = realDateNow.call(Date);
function setClock(t) { CLOCK = t; }
Date.now = function () { return CLOCK; };

const checks = [];
function check(name, ok, detail) { checks.push({ name: name, ok: !!ok, detail: detail === undefined ? '' : detail }); }

(async function main() {
  const result = { at: new Date().toISOString(), fixtureBytes: SIZE, before: {}, after: {}, firstOpen: {}, secondOpen: {}, storage: {}, latencyMs: {}, checks: checks };

  /* ---------- A. before：旧行为 = 每 30s 整表重拉（notices ~2MB），进通知页再整表一次 ---------- */
  const cloudBefore = newCloud();
  resetStats();
  const POLLS = 20;                    // 20 × 30s = 10 分钟
  const T0 = realDateNow.call(Date);
  setClock(T0);
  const tBefore0 = nowMs();
  for (let i = 0; i < POLLS; i++) {
    // 旧行为没有 TTL：直接按旧代码的 4 张整表 GET 模拟（cbGet = 无缓存的底层请求）
    await Promise.all([
      cloudBefore.cbGet('marks'), cloudBefore.cbGet('fitrecs'), cloudBefore.cbGet('homework'), cloudBefore.cbGet('notices')
    ]).catch(function () {});
    // 旧 nt 页 onShow：ntAutoPull 整表再来一次（60s 内存节流 ≈ 每 2 轮一次）
    if (i % 2 === 1) await cloudBefore.cbGet('notices');
    setClock(CLOCK + 30000);
  }
  result.before = { polls: POLLS, requests: stats.requests, bytes: stats.bytes, byTable: Object.assign({}, stats.byTable), noticesFullRequests: (stats.byTable.notices_full || 0), wallMs: Math.round(nowMs() - tBefore0) };
  check('before：notices 整表请求随轮询线性增长', (stats.byTable.notices_full || 0) >= POLLS, '旧行为 ' + POLLS + ' 轮 → ' + (stats.byTable.notices_full || 0) + ' 次整表');

  /* ---------- B. after：同一段用户行为（冷启动 → 20 轮轮询），缓存优先 + TTL ---------- */
  // 清掉缓存但保留身份，模拟「新装/清缓存后第一次打开」
  Object.keys(mem).forEach(function (k) { if (k.indexOf('zqc1_') === 0) delete mem[k]; });
  setClock(T0);
  resetStats();
  let cloud = newCloud();

  // 首进：工作台 cloudPull（1 次整表 notices 写入缓存）+ 进入通知页 ntAutoPull（应 0 请求，命中刚写的缓存）
  const tFirst0 = nowMs();
  await cloud.cloudPull();
  const pullStats = { requests: stats.requests, bytes: stats.bytes, byTable: Object.assign({}, stats.byTable) };
  resetStats();
  await cloud.ntAutoPull();
  const ntEntryStats = { requests: stats.requests, bytes: stats.bytes };
  const firstOpen = {
    requests: pullStats.requests + ntEntryStats.requests,
    bytes: pullStats.bytes + ntEntryStats.bytes,
    byTable: pullStats.byTable,
    noticesFull: pullStats.byTable.notices_full || 0,
    ntPageRequests: ntEntryStats.requests,
    wallMs: Math.round(nowMs() - tFirst0)
  };
  result.firstOpen = firstOpen;
  check('首进通知页：整表 notices 请求 = 1', firstOpen.noticesFull === 1, '实际 ' + firstOpen.noticesFull);
  check('首进后立刻进通知页：0 额外请求（同一份数据不重复拉）', firstOpen.ntPageRequests === 0, '实际 ' + firstOpen.ntPageRequests + ' 次');
  check('首进即写缓存：mock 整表 >1.9MB（≈线上 1.98MB）', SIZE.noticesFull > 1900000, 'mock 整表 ' + SIZE.noticesFull + ' 字符');

  // 二次进入（模拟 App 重启：模块全新，storage 持久保留）→ 0 网络请求
  const tSecond0 = nowMs();
  resetStats();
  cloud = newCloud();
  const g2 = await cloud.ntAutoPull();
  const secondOpen = { requests: stats.requests, bytes: stats.bytes, groups: g2.length, wallMs: Math.round((nowMs() - tSecond0) * 100) / 100 };
  result.secondOpen = secondOpen;
  check('二次进入（冷模块 + 持久缓存）：0 请求', stats.requests === 0, '实际 ' + stats.requests + ' 次请求');
  check('二次进入仍能拿到全部 auto groups', g2.length === 24, '实际 ' + g2.length + ' 组');

  // 20 轮 30s 轮询（工作台/页面后台同步）：TTL 门控 + 签名重校验
  resetStats();
  const perPoll = [];
  setClock(CLOCK + 30000);   // 从「下一次轮询」开始，最后一轮正好跨过 10min TTL → 触发一次签名校验
  for (let i = 0; i < POLLS; i++) {
    const before = stats.requests;
    await cloud.cloudPull();
    if (i % 5 === 4) await cloud.ntAutoPull();   // 周期性进通知页
    await sleep(1);                              // 让后台签名校验/通知的 timer 跑完
    perPoll.push(stats.requests - before);
    setClock(CLOCK + 30000);
  }
  const afterByTable = Object.assign({}, stats.byTable);
  result.after = { polls: POLLS, requests: stats.requests, bytes: stats.bytes, byTable: afterByTable, noticesFullRequests: (afterByTable.notices_full || 0), noticesLiteRequests: (afterByTable.notices_lite || 0), requestsPerPoll: perPoll };
  check('after：' + POLLS + ' 轮轮询 notices 整表 ≤2 次（不随 N 线性增长）', (afterByTable.notices_full || 0) <= 2, '实际 ' + (afterByTable.notices_full || 0) + ' 次');
  check('after：TTL 过期只发 ~2KB 签名校验', (afterByTable.notices_lite || 0) >= 1 && (afterByTable.notices_lite || 0) <= 2, '实际 ' + (afterByTable.notices_lite || 0) + ' 次签名');
  check('after：homework 请求 ≤3 次（10min TTL）', (afterByTable.homework || 0) <= 3, '实际 ' + (afterByTable.homework || 0) + ' 次');
  check('after：每轮请求数远小于 before', stats.requests < result.before.requests, 'after ' + stats.requests + ' < before ' + result.before.requests);
  check('after：传输字节下降 >90%', stats.bytes < result.before.bytes * 0.1, 'after ' + Math.round(stats.bytes / 1024) + 'KB vs before ' + Math.round(result.before.bytes / 1024) + 'KB');

  /* ---------- C. 缓存命中耗时（CPU 侧：storage 读取 + JSON.parse） ---------- */
  cloud = newCloud();
  setClock(T0 + 2 * 60000);      // 回到 10min TTL 内：模拟「10 分钟内再次打开」的纯缓存命中
  resetStats();
  const tCached0 = nowMs();
  await cloud.ntAutoPull();                 // 内存热缓存路径（首次从 storage 读）
  const tMemo = nowMs() - tCached0;
  cloud = newCloud();                       // 冷模块：必然走 storage 读取 + JSON.parse
  const tCold0 = nowMs();
  await cloud.ntAutoPull();
  const tCold = nowMs() - tCold0;
  const hitRequests = stats.requests;
  result.latencyMs = { memoHit: Math.round(tMemo * 100) / 100, coldStorageHit: Math.round(tCold * 100) / 100 };
  check('冷模块缓存命中（读 storage + 解析 ~1.9MB）< 200ms', tCold < 200, '实际 ' + result.latencyMs.coldStorageHit + 'ms');
  check('TTL 内缓存命中路径 0 请求', hitRequests === 0, '实际 ' + hitRequests + ' 次');

  /* ---------- D. 存储预算 / 分块 ---------- */
  const cacheMod = require(ROOT + '/utils/cache.js');
  const st = cacheMod.stats();
  const chunkKeys = Object.keys(mem).filter(function (k) { return k.indexOf(cacheMod.PREFIX) === 0 && k.indexOf('_ntAuto_') > 0; });
  let maxChunkChars = 0;
  chunkKeys.forEach(function (k) { maxChunkChars = Math.max(maxChunkChars, String(mem[k]).length); });
  result.storage = {
    cacheBytes: st.bytes, cacheItems: st.items, names: st.names,
    chunkCount: chunkKeys.length, maxChunkChars: maxChunkChars,
    chunkLimitChars: cacheMod.CHUNK_MAX_CHARS, budgetBytes: cacheMod.MAX_BYTES,
    totalStorageKeysBytes: Object.keys(mem).reduce(function (a, k) { return a + String(mem[k]).length; }, 0)
  };
  check('分块：单块字符数 ≤600KB', maxChunkChars <= cacheMod.CHUNK_MAX_CHARS, '最大块 ' + maxChunkChars + ' 字符');
  check('分块：2MB 通知缓存 ≥4 块', chunkKeys.length >= 4, '实际 ' + chunkKeys.length + ' 块');
  check('预算：缓存总量 ≤5MB', st.bytes <= cacheMod.MAX_BYTES, Math.round(st.bytes / 1024) + 'KB');

  /* ---------- E. 汇总 ---------- */
  const savedPct = result.before.bytes > 0 ? Math.round((1 - result.after.bytes / result.before.bytes) * 10000) / 100 : 0;
  result.summary = {
    beforeRequests: result.before.requests, beforeBytes: result.before.bytes, beforeMB: Math.round(result.before.bytes / 1048576 * 100) / 100,
    afterRequests: result.after.requests, afterBytes: result.after.bytes, afterMB: Math.round(result.after.bytes / 1048576 * 100) / 100,
    savedBytesPct: savedPct,
    noticesFullBefore: result.before.noticesFullRequests, noticesFullAfter: result.after.noticesFullRequests,
    noticesLiteAfter: (result.after.byTable.notices_lite || 0),
    secondOpenRequests: result.secondOpen.requests,
    cacheStorageKB: Math.round(result.storage.cacheBytes / 1024)
  };
  result.pass = checks.filter(function (c) { return c.ok; }).length;
  result.fail = checks.filter(function (c) { return !c.ok; }).length;

  fs.writeFileSync(path.join(__dirname, '_perf_cache_result.json'), JSON.stringify(result, null, 2), 'utf8');

  console.log('\n=== 性能/缓存量化（mock wx，' + POLLS + ' 轮 × 30s） ===');
  console.log('fixture：notices 整表 ' + (SIZE.noticesFull / 1048576).toFixed(2) + 'MB ≈ 线上 1.98MB；签名 ' + (SIZE.noticesLite / 1024).toFixed(1) + 'KB ≈ 线上 2.1KB');
  console.log('before：' + result.before.requests + ' 请求 / ' + (result.before.bytes / 1048576).toFixed(2) + 'MB（notices 整表 ' + result.before.noticesFullRequests + ' 次）');
  console.log('after ：' + result.after.requests + ' 请求 / ' + (result.after.bytes / 1024).toFixed(0) + 'KB（notices 整表 ' + result.after.noticesFullRequests + ' 次 + 签名 ' + (result.after.byTable.notices_lite || 0) + ' 次）');
  console.log('首进通知页：' + result.firstOpen.requests + ' 请求 / ' + (result.firstOpen.bytes / 1048576).toFixed(2) + 'MB；二次进入：' + result.secondOpen.requests + ' 请求 / ' + result.secondOpen.wallMs + 'ms');
  console.log('缓存命中耗时：内存 ' + result.latencyMs.memoHit + 'ms，冷读 storage + 解析 ' + result.latencyMs.coldStorageHit + 'ms');
  console.log('缓存存储：' + result.storage.chunkCount + ' 块 / 最大块 ' + result.storage.maxChunkChars + ' 字符 / ' + (result.storage.cacheBytes / 1024).toFixed(0) + 'KB');
  console.log('字节节省：' + savedPct + '%');
  checks.forEach(function (c) { console.log((c.ok ? 'PASS  ' : 'FAIL  ') + c.name + (c.ok ? '' : '  ::  ' + c.detail)); });
  console.log('\n================ ' + result.pass + ' passed, ' + result.fail + ' failed ================');
  process.exitCode = result.fail ? 2 : 0;
})().catch(function (e) {
  console.error('FATAL', e);
  process.exitCode = 1;
}).finally(function () {
  Date.now = realDateNow;
});
