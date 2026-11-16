/* 真机模拟器性能验证（微信开发者工具 miniprogram-automator + 真实云端，只读）
 *
 * 验证性能优化 1.4.4 的核心指标（对应 RECON §4.2）：
 *   1) 首进通知页（冷缓存）：notices 整表 1 次、耗时、写分块缓存（storage 实测字节/块数）；
 *   2) 二次进入：0 网络请求、页面就绪耗时；
 *   3) TTL 过期后进入：只发 ~2KB 签名请求（select=id,ts），不整表拉；
 *   4) 截图 _shots/perf-nt/（首进 / 二次进入）。
 *
 * 说明：只读真实云端（class_verify / class_members / notices），不写任何云表；不打印 token/通知内容。
 * 前置：cli.bat auto --project ... --auto-port 9420 --trust-project
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const OUT = path.join(__dirname, '_shots', 'perf-nt');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 400) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}
async function shot(mp, name, waitMs) {
  await sleep(waitMs == null ? 300 : waitMs);
  await mp.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('SHOT  ' + name);
}
async function curPath(mp) {
  try { const p = await mp.currentPage(); return p ? p.path : ''; } catch (e) { return ''; }
}
async function pageData(mp) {
  try { const p = await mp.currentPage(); return p ? await p.data() : null; } catch (e) { return null; }
}
async function waitNtReady(mp, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const d = await pageData(mp);
    if (d && d.state === 'ready' && Array.isArray(d.cards) && d.cards.length > 0) return { ms: Date.now() - t0, cards: d.cards.length, stats: d.stats };
    await sleep(60);
  }
  return { ms: Date.now() - t0, cards: 0, timeout: true };
}
async function resetReq(mp) { await mp.evaluate(() => { wx.__perfCnt = { n: 0, urls: [] }; }); }
async function reqStats(mp) {
  return mp.evaluate(() => {
    const c = (wx && wx.__perfCnt) || { n: 0, urls: [] };
    const urls = c.urls || [];
    return {
      n: c.n,
      noticesFull: urls.filter((u) => u.indexOf('/notices?') >= 0 && u.indexOf('select=*') >= 0).length,
      noticesLite: urls.filter((u) => u.indexOf('select=id,ts') >= 0).length,
      members: urls.filter((u) => u.indexOf('/rpc/class_members') >= 0).length,
      other: urls.filter((u) => u.indexOf('/notices?') < 0 && u.indexOf('/rpc/class_members') < 0).length
    };
  });
}
async function installCounter(mp) {
  await mp.evaluate(() => {
    if (wx.__perfWrapped) return true;
    wx.__perfCnt = { n: 0, urls: [] };
    const orig = wx.request;
    wx.request = function (o) {
      try { wx.__perfCnt.n += 1; wx.__perfCnt.urls.push(String((o && o.url) || '')); } catch (e) {}
      return orig.call(wx, o);
    };
    wx.__perfWrapped = true;
    return true;
  });
}
async function cacheStats(mp) {
  return mp.evaluate(() => {
    try {
      const cache = require('utils/cache.js');
      const st = cache.stats();
      const info = wx.getStorageInfoSync ? wx.getStorageInfoSync() : { keys: [] };
      const keys = (info.keys || []).filter((k) => k.indexOf('zqc1_') === 0);
      let maxChunk = 0;
      keys.forEach((k) => { const v = wx.getStorageSync(k); if (typeof v === 'string') maxChunk = Math.max(maxChunk, v.length); });
      return { items: st.items, bytes: st.bytes, names: st.names, chunkKeys: keys.length, maxChunkChars: maxChunk, limit: cache.CHUNK_MAX_CHARS };
    } catch (e) { return { err: String((e && e.message) || e) }; }
  });
}
// 清掉内存 memo + 全部分块缓存（模拟「装好身份后第一次用」），不碰身份本身
async function coldReset(mp) {
  return mp.evaluate(() => new Promise((resolve) => {
    try {
      const s = wx.getStorageSync('zq_class_identity');
      wx.removeStorageSync('zq_class_identity');       // 让 cloud 的内部 memo 因 sid 不匹配而失效
      require('utils/cloud.js').ntAutoPull().catch(function () {}).then(function () {
        try { require('utils/cache.js').clearAll(); } catch (e) {}
        wx.setStorageSync('zq_class_identity', s);
        resolve(true);
      });
    } catch (e) { resolve(false); }
  }));
}
// 只把 lastSync 里的通知时间戳改旧（模拟 10min TTL 过期），保留分块缓存
async function expireTtl(mp) {
  return mp.evaluate(() => {
    try {
      const cache = require('utils/cache.js');
      const m = cache.get('lastSync') || {};
      m.ntAuto = 0; m.nt = 0;
      cache.set('lastSync', m, 0);
      return true;
    } catch (e) { return false; }
  });
}
// 对比「缓存签名」与「实时轻量查询签名」（只输出长度/首个差异的 id:ts 摘要）
async function sigDiff(mp) {
  return mp.evaluate(() => new Promise((resolve) => {
    try {
      const cfg = require('utils/cloud-config.js');
      const id = require('utils/identity.js');
      const cache = require('utils/cache.js');
      const c = cache.getWithMeta('ntAuto');
      const out = { cacheSigLen: c && c.val ? String(c.val.sig || '').length : 0, cacheGroups: c && c.val ? (c.val.g || []).length : 0 };
      wx.request({
        url: cfg.restBase + 'notices?select=id,ts&order=ts.asc,id.asc&archived=eq.false',
        method: 'GET',
        header: { Authorization: 'Bearer ' + cfg.publishableKey, 'X-Class-Token': id.token() },
        success: (res) => {
          const rows = res.data || [];
          const sig = rows.map((x) => String(x.id) + ':' + String(x.ts == null ? '' : x.ts)).join('|');
          out.liteRows = rows.length;
          out.liteSigLen = sig.length;
          if (c && c.val && c.val.sig) {
            const a = String(c.val.sig).split('|'), b = sig.split('|');
            out.firstDiff = -1;
            for (let i = 0; i < Math.max(a.length, b.length); i++) {
              if (a[i] !== b[i]) { out.firstDiff = i; out.cachedItem = (a[i] || '').slice(0, 40); out.liveItem = (b[i] || '').slice(0, 40); break; }
            }
          }
          resolve(out);
        },
        fail: (e) => { out.err = String((e && e.errMsg) || e); resolve(out); }
      });
    } catch (e) { resolve({ err: String((e && e.message) || e) }); }
  }));
}

(async () => {
  const result = { at: new Date().toISOString() };
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  const consoleIssues = [];
  mp.on('exception', (e) => consoleIssues.push({ type: 'exception', text: JSON.stringify(e).slice(0, 300) }));
  mp.on('console', (e) => { if (e && e.type === 'error') consoleIssues.push({ type: 'error', text: (e.args || []).map(String).join(' ').slice(0, 300) }); });

  /* ---------- 0. 清空本机状态 → 身份页 ---------- */
  await mp.evaluate(() => { try { wx.clearStorageSync(); } catch (e) {} try { require('utils/store.js').reset(); } catch (e) {} });
  let p = await mp.reLaunch('/pages/identity/identity');
  await p.waitFor(800);
  check('启动进入身份页', (await curPath(mp)) === 'pages/identity/identity', await curPath(mp));

  /* ---------- 1. 真实身份验证（只读 RPC） ---------- */
  const inputs = await p.$$('input');
  check('身份页有姓名/学号输入框', inputs.length >= 2, 'inputs=' + inputs.length);
  if (inputs.length >= 2) { await inputs[0].input('测试账号'); await sleep(150); await inputs[1].input('3260799999'); await sleep(250); }
  await mp.evaluate(() => { const ps = getCurrentPages(); const pg = ps[ps.length - 1]; pg.submit(); });
  for (let i = 0; i < 30; i++) { await sleep(300); if ((await curPath(mp)) === 'pages/index/index') break; }
  check('身份验证后进入工作台', (await curPath(mp)) === 'pages/index/index', await curPath(mp));
  await mp.evaluate(() => { try { const app = getApp(); app.stopSync(); app.clearWarm(); } catch (e) {} });
  await installCounter(mp);
  await sleep(300);

  /* ---------- 2. 冷缓存首进通知页：1 次整表 + 写分块缓存 ---------- */
  const coldOk = await coldReset(mp);
  check('已清掉内存 memo 与分块缓存（模拟首次使用）', coldOk === true, String(coldOk));
  await sleep(200);
  await resetReq(mp);
  const t1 = Date.now();
  p = await mp.reLaunch('/pages/nt/nt');
  const tRe1 = Date.now();
  const r1 = await waitNtReady(mp, 25000);
  const first = { totalMs: Date.now() - t1, reLaunchMs: tRe1 - t1, readyAfterReLaunchMs: Date.now() - tRe1, readyMs: r1.ms, cards: r1.cards };
  const req1 = await reqStats(mp);
  first.requests = req1;
  result.firstEntry = first;
  check('首进通知页：notices 整表请求 = 1', req1.noticesFull === 1, JSON.stringify(req1));
  check('首进通知页：渲染出通知卡片', r1.cards > 0, 'cards=' + r1.cards);
  const cache1 = await cacheStats(mp);
  result.cacheAfterFirst = cache1;
  check('首进后写入分块持久缓存（ntAuto）', cache1 && cache1.items >= 1 && cache1.bytes > 1500000, JSON.stringify(cache1));
  check('分块：单块 ≤600KB 字符', cache1 && cache1.maxChunkChars <= (cache1.limit || 614400), cache1 && cache1.maxChunkChars);
  const sig = await sigDiff(mp);
  result.sigCheck = sig;
  check('缓存签名与实时轻量查询签名一致（签名方案有效）', sig && sig.firstDiff === -1, JSON.stringify(sig));
  await shot(mp, 'nt-first-entry');

  /* ---------- 3. 二次进入：0 请求 + 页面就绪耗时 ---------- */
  await mp.reLaunch('/pages/index/index');
  await sleep(500);
  await resetReq(mp);
  const t2 = Date.now();
  p = await mp.reLaunch('/pages/nt/nt');
  const tRe2 = Date.now();
  const r2 = await waitNtReady(mp, 8000);
  const second = { totalMs: Date.now() - t2, reLaunchMs: tRe2 - t2, readyAfterReLaunchMs: Date.now() - tRe2, readyMs: r2.ms, cards: r2.cards };
  const req2 = await reqStats(mp);
  second.requests = req2;
  result.secondEntry = second;
  check('二次进入通知页：0 网络请求（读分块缓存）', req2.n === 0, JSON.stringify(req2));
  check('二次进入通知页：卡片数量与首进一致', r2.cards === r1.cards, 'first=' + r1.cards + ' second=' + r2.cards);
  check('二次进入页面就绪更快', second.readyAfterReLaunchMs < first.readyAfterReLaunchMs, 'first=' + first.readyAfterReLaunchMs + 'ms second=' + second.readyAfterReLaunchMs + 'ms');
  await shot(mp, 'nt-second-entry');

  /* ---------- 4. TTL 过期进入：只发 ~2KB 签名请求 ---------- */
  check('已把通知 lastSync 改旧（模拟 TTL 过期）', (await expireTtl(mp)) === true, '');
  await mp.reLaunch('/pages/index/index');
  await sleep(500);
  await resetReq(mp);
  p = await mp.reLaunch('/pages/nt/nt');
  const r3 = await waitNtReady(mp, 8000);
  await sleep(2000);                      // 等后台签名校验（若数据没变不会整表）
  const req3 = await reqStats(mp);
  result.ttlExpiredEntry = { readyMs: r3.ms, cards: r3.cards, requests: req3 };
  check('TTL 过期后：只发签名请求（~2KB），不拉整表', req3.noticesLite >= 1 && req3.noticesFull === 0, JSON.stringify(req3));
  check('TTL 过期后：仍然渲染通知卡片', r3.cards > 0, 'cards=' + r3.cards);

  /* ---------- 5. 收尾：清身份与缓存 ---------- */
  await mp.evaluate(() => { try { wx.clearStorageSync(); } catch (e) {} try { require('utils/store.js').reset(); } catch (e) {} });

  result.consoleIssues = consoleIssues;
  result.pass = checks.filter((c) => c.ok).length;
  result.fail = checks.length - result.pass;
  fs.writeFileSync(path.join(__dirname, '_perf_nt_preview_result.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log('\n============ ' + result.pass + ' passed, ' + result.fail + ' failed ============');
  console.log('console errors/exceptions =', consoleIssues.length);
  console.log('首进 total=' + first.totalMs + 'ms（reLaunch ' + first.reLaunchMs + 'ms + 就绪 ' + first.readyAfterReLaunchMs + 'ms）/ 二次 ' + second.readyAfterReLaunchMs + 'ms / 请求 first=' + JSON.stringify(req1) + ' second=' + JSON.stringify(req2) + ' ttl=' + JSON.stringify(req3));
  process.exit(result.fail || consoleIssues.length ? 2 : 0);
})().catch((e) => { console.error('PERF PREVIEW FATAL', e); process.exit(1); });
