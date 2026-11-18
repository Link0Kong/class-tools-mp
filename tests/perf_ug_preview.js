/* perf_ug_preview.js —— 首屏请求时序 + 使用说明卡片页（task-28 C/B；2026-11-12 卡片化重构后更新）
 *
 * 前置：cli.bat auto --project C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools --auto-port 9420 --trust-project
 * 用法：node perf_ug_preview.js
 * 产出：_shots_perf/
 *   01_index_first_screen.png（工作台首屏）
 *   02_ug_power.png（使用说明第 11 张：宿舍电费）
 *   03_ug_notice.png（使用说明第 8 张：通知与附件）
 *   04_ug_overview.png（一键总览弹层）
 *   result.json（首屏时间/请求 URL 时序、使用说明卡片结构/溢出、截图清单）
 *
 * 说明：mock 身份 + wx.request（全部返回 []，不接触真实云端）；automator + mp.screenshot。
 *       使用说明页已从「16 条文字堆叠」改为「swiper 一屏一张卡（19 张）」，本脚本按新交互：
 *       data.cards / data.cats / data.swiperH + jumpTo 切卡 + openOv 总览，不再用 #ug-<key> 锚点滚动。
 *       automator 不可用（未连接 ws://127.0.0.1:9420）时自动退化为纯静态结构检查
 *       （复用 ug_cards_check.js，不产出截图），并在 result.json 标注 mode='static-fallback'。
 */
'use strict';
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '_shots_perf');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const consoleIssues = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 800) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}
async function shot(mp, name) {
  const p = path.join(OUT, name + '.png');
  try {
    await mp.evaluate(() => {
      try {
        const fsm = wx.getFileSystemManager();
        const root = wx.env.USER_DATA_PATH;
        const clean = function (d) {
          try {
            fsm.readdirSync(d).forEach(function (n) {
              const q = d + '/' + n;
              try { if (fsm.statSync(q).isDirectory()) clean(q); else fsm.unlinkSync(q); } catch (e2) { /* ignore */ }
            });
          } catch (e3) { /* ignore */ }
        };
        clean(root);
      } catch (e4) { /* ignore */ }
    });
    await sleep(80);
  } catch (e0) { /* ignore */ }
  try { await mp.screenshot({ path: p }); console.log('SHOT  ' + p); return p; } catch (e) {
    for (let i = 0; i < 2; i++) {
      try { await sleep(800); await mp.screenshot({ path: p }); console.log('SHOT  ' + p + ' (retry)'); return p; } catch (e2) { /* next */ }
    }
    console.log('SHOT-FAIL ' + name + ' :: ' + e.message); return '';
  }
}
async function goto(mp, route, tries) {
  for (let i = 0; i < (tries || 5); i++) {
    await mp.reLaunch(route);
    await sleep(900);
    const ok = await mp.evaluate((r) => {
      const p = getCurrentPages()[getCurrentPages().length - 1];
      return !!(p && p.route === r);
    }, route.replace(/^\//, ''));
    if (ok) return true;
  }
  return false;
}
// 使用说明页横向溢出检查：只查页面级元素 + 当前可见的那张卡
// （swiper 的非当前 item 在横向滚动容器里位于视口外，直接量全部 .ug-card 会误报）
async function rects(mp) {
  return mp.evaluate(() => new Promise((resolve) => {
    const q = wx.createSelectorQuery();
    q.select('.page').boundingClientRect();
    q.selectAll('.ug-card').boundingClientRect();
    q.selectAll('.ug-nav').boundingClientRect();
    q.selectAll('.ug-head').boundingClientRect();
    q.selectAll('.ug-foot').boundingClientRect();
    q.exec((res) => {
      const pick = (i) => (res && res[i]) || [];
      const cards = pick(1).filter((r) => r && r.left > -6 && r.left < 6);   // 当前可见卡（静止时 left=0）
      resolve({
        page: pick(0)[0] || null,
        rects: cards.concat(pick(2), pick(3), pick(4)),
        win: (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).windowWidth
      });
    });
  }));
}

(async () => {
  let mp = null;
  try {
    mp = await Promise.race([
      require('miniprogram-automator').connect({ wsEndpoint: 'ws://127.0.0.1:9420' }),
      new Promise((r) => setTimeout(() => r(null), 8000))
    ]);
  } catch (e) { mp = null; }

  if (!mp) {
    // automator 不可用：退化为「无模拟器也能跑」的静态结构检查（不产出截图，不谎报通过）
    console.log('SKIP  未连接 ws://127.0.0.1:9420（开发者工具 automator 未启动），改为静态结构检查');
    let r = null;
    try { r = require('./ug_cards_check.js').runChecks({ quiet: false }); }
    catch (e) { console.error('[perf_ug_preview] 静态检查异常: ' + ((e && e.stack) || e)); process.exitCode = 2; return; }
    const report = {
      mode: 'static-fallback',
      at: new Date().toISOString(),
      note: 'automator 不可用（未连接 9420），未跑首屏时序与截图；已执行 ug_cards_check.js 静态结构检查',
      checks: r.results,
      summary: { pass: r.pass, fail: r.fail }
    };
    try { fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2), 'utf8'); } catch (e) { /* ignore */ }
    console.log('\n==== perf/ug preview（static-fallback）: ' + r.pass + ' PASS / ' + r.fail + ' FAIL；未产出截图 ====');
    process.exitCode = r.fail ? 2 : 0;
    return;
  }

  mp.on('console', (msg) => { if (msg && msg.type === 'error') consoleIssues.push(String(msg.args || msg.text || '').slice(0, 300)); });
  try {
    // 1) mock 身份 + 网络（所有请求立即 []），从 index 冷启动测首屏时序
    await mp.evaluate(() => {
      try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
      wx.setStorageSync('zq_class_identity', JSON.stringify({
        token: 'tok-perf-preview', sid: '3260799999', name: '测试账号',
        role: '副团支书', badge: '班委', is_admin: true, ts: Date.now()
      }));
      globalThis.__perf = { t0: 0, reqs: [] };
      wx.request = function (o) {
        const now = Date.now();
        if (!globalThis.__perf.t0) globalThis.__perf.t0 = now;
        globalThis.__perf.reqs.push({ t: now, dt: now - globalThis.__perf.t0, url: String((o && o.url) || ''), method: String((o && o.method) || 'GET') });
        const ok = function () { try { o.success && o.success({ statusCode: 200, data: [] }); } catch (e) { /* ignore */ } };
        setTimeout(ok, 10);
      };
    });
    await sleep(1500);   // 等 DevTools/App 启动稳定后再测，避免 reLaunch 被启动流程吞掉
    await mp.evaluate(() => { globalThis.__perf = { t0: Date.now(), reqs: [] }; });
    const t0 = Date.now();
    let okIndex = false, readyAt = 0, indexData = null;
    for (let i = 0; i < 4 && !okIndex; i++) {
      await mp.reLaunch('/pages/index/index');
      await sleep(450);
      okIndex = await mp.evaluate(() => {
        const p = getCurrentPages()[getCurrentPages().length - 1];
        return !!(p && p.route === 'pages/index/index');
      });
    }
    for (let i = 0; i < 20 && okIndex; i++) {
      indexData = await mp.evaluate(() => {
        const p = getCurrentPages()[getCurrentPages().length - 1];
        if (!p || p.route !== 'pages/index/index') return null;
        return { route: p.route, state: p.data.state || '', hello: !!p.data.hello, quick: (p.data.quick || []).length };
      });
      if (indexData && (indexData.state === 'data' || indexData.state === 'ready' || indexData.hello)) { readyAt = Date.now(); break; }
      await sleep(80);
    }
    const firstScreenMs = readyAt ? readyAt - t0 : -1;
    const s1 = await shot(mp, '01_index_first_screen');
    await sleep(1400);   // 让 300ms 后的 warm 请求跑完
    const perf = await mp.evaluate(() => JSON.parse(JSON.stringify(globalThis.__perf || { t0: 0, reqs: [] })));
    const early = perf.reqs.filter((r) => r.dt < 250);
    const late = perf.reqs.filter((r) => r.dt >= 250);
    check('首屏路由进入工作台且 UI 有内容', okIndex && !!indexData, JSON.stringify(indexData));
    check('首屏 ready 时间（automator 冷启动，含 reLaunch 重试 overhead）', firstScreenMs > 0, firstScreenMs + 'ms');
    check('首屏 250ms 内云请求数 ≤ 3（次要请求延后 WARM_MS）', early.length <= 3, JSON.stringify({ early: early.map((r) => r.url.split('/rest/')[1] || r.url), late: late.map((r) => r.url.split('/rest/')[1] || r.url) }));
    check('warm 阶段（≥250ms）请求记录（informational）', true, JSON.stringify(late.slice(0, 6).map((r) => ({ dt: r.dt, url: r.url.split('/rest/')[1] || r.url }))));

    // 2) 使用说明：一屏一张卡（19 张）+ 分类 chips + 总览
    const okUg = await goto(mp, '/pages/ug/ug');
    await sleep(500);
    const ud = await mp.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1];
      if (!p || p.route !== 'pages/ug/ug') return null;
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      return {
        route: p.route,
        cards: (p.data.cards || []).map((x) => ({ id: x.id, title: x.title, scene: x.scene })),
        cats: (p.data.cats || []).length,
        cur: p.data.cur,
        swiperH: p.data.swiperH,
        winH: info.windowHeight,
        ovGroups: (p.data.ovGroups || []).length
      };
    });
    check('使用说明页：19 张卡片 / 5 分类 / 初始第 1 张',
      !!(okUg && ud && ud.cards.length === 19 && ud.cats === 5 && ud.cur === 0),
      JSON.stringify(ud && { cards: ud.cards.length, cats: ud.cats, cur: ud.cur }));
    const wantIds = ['home', 'draw', 'power', 'nt', 'water', 'vote', 'ppt', 'file', 'screencast', 'data', 'fb'];
    check('使用说明页：含 工作台/抽签/电费/通知/水量/投票/演示/文件/大屏/隐私/反馈 卡片',
      !!(okUg && ud && wantIds.every((k) => ud.cards.some((x) => x.id === k))),
      JSON.stringify(ud && ud.cards.map((x) => x.id)));
    check('swiper 高度为 selector query 实测值且不超过窗口可用高度',
      !!(ud && ud.swiperH > 200 && ud.swiperH <= ud.winH),
      JSON.stringify(ud && { swiperH: ud.swiperH, winH: ud.winH }));

    async function jumpTo(idx) {
      try {
        return await mp.evaluate((i) => {
          const p = getCurrentPages()[getCurrentPages().length - 1];
          if (!p || !p.jumpTo) return null;
          p.jumpTo({ currentTarget: { dataset: { idx: i } } });
          return p.data.cur;
        }, idx);
      } catch (e) { return null; }
    }
    const c1 = await jumpTo(10);
    await sleep(500);
    const s2 = await shot(mp, '02_ug_power');
    const c2 = await jumpTo(7);
    await sleep(500);
    const s3 = await shot(mp, '03_ug_notice');
    check('使用说明页：点总览条目 / 上下一张可切卡（第 11 张电费、第 8 张通知）',
      c1 === 10 && c2 === 7, JSON.stringify({ c1: c1, c2: c2 }));

    const ovOpen = await mp.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1];
      if (!p || !p.openOv) return false;
      p.openOv();
      return true;
    });
    await sleep(320);
    const ovState = await mp.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1];
      return !!(p && p.data && p.data.ov);
    });
    const s4 = await shot(mp, '04_ug_overview');
    const ovItems = await mp.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1];
      return ((p && p.data && p.data.ovGroups) || []).reduce((n, g) => n + ((g.cards || []).length), 0);
    });
    await mp.evaluate(() => {
      const p = getCurrentPages()[getCurrentPages().length - 1];
      if (p && p.closeOv) p.closeOv();
    });
    await sleep(200);
    check('一键总览：打开遮罩 + 5 分组共 19 条', !!(ovOpen && ovState && ovItems === 19), JSON.stringify({ open: ovOpen, ov: ovState, items: ovItems }));

    const lr = await rects(mp);
    const overflow = lr.rects.filter((r) => r && (r.right > lr.win + 0.5 || r.left < -0.5));
    check('使用说明页无横向溢出（当前卡片 / 卡头行 / 底部栏）', overflow.length === 0,
      JSON.stringify({ win: lr.win, page: lr.page, overflow: overflow.map((r) => ({ l: r.left, r: r.right })) }));

    const report = {
      mode: 'automator',
      at: new Date().toISOString(),
      firstScreen: { ms: firstScreenMs, ready: indexData, totalRequests: perf.reqs.length, early250: early.length, warm: late.length, requests: perf.reqs.map((r) => ({ dt: r.dt, method: r.method, url: r.url.replace(/^https:\/\/[^/]+\/v1\/rdb\/rest\//, '') })) },
      ug: { cards: ud && ud.cards, cats: ud && ud.cats, swiperH: ud && ud.swiperH, winH: ud && ud.winH, overviewItems: ovItems, overflow: overflow.length },
      checks: results, consoleErrors: consoleIssues, screenshots: [s1, s2, s3, s4].filter(Boolean)
    };
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2), 'utf8');
    const failed = results.filter((r) => !r.ok).length;
    console.log('\n==== perf/ug preview: ' + (results.length - failed) + ' PASS / ' + failed + ' FAIL / ' + consoleIssues.length + ' console error；firstScreen=' + firstScreenMs + 'ms ====');
    process.exitCode = failed ? 2 : 0;
  } finally {
    try { await mp.disconnect(); } catch (e) { /* ignore */ }
  }
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
