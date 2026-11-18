/* ug_cards_shot.js —— 使用说明 19 张卡逐张截图 + 版面自检（微信开发者工具 automator，390 宽）
 *
 * 契约：C:\Users\Ko_Li\.openclaw\workspace\web\使用说明_卡片化重构契约_20261112.md §4（QA 截图供肉眼核查）
 * 前置：cli.bat auto --project C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools --auto-port 9420 --trust-project
 * 用法：node ug_cards_shot.js
 * 产出：_shots_ug_cards/card-<NN>-<id>.png（19 张卡各一张）+ result.json + 控制台汇总
 * 检查：每张卡都能通过 jumpTo 切到、截图成功、卡片宽度不溢出、swiper 高度为实测值；
 *       记录内容高度 > swiper 高度（需要卡内滚动）的卡片，便于 QA 判断是否截断。
 * automator 不可用时退化为 ug_cards_check.js 静态结构检查（不出截图、不谎报）。
 */
'use strict';
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '_shots_ug_cards');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const consoleIssues = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 600) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}

function staticFallback() {
  console.log('SKIP  未连接 ws://127.0.0.1:9420（开发者工具 automator 未启动）：退化为静态结构检查（ug_cards_check.js），不产出截图');
  let r = null;
  try { r = require('./ug_cards_check.js').runChecks({ quiet: false }); }
  catch (e) { console.error('[ug_cards_shot] 静态检查异常: ' + ((e && e.stack) || e)); process.exit(2); }
  console.log('\n==== ug_cards_shot（static-fallback）: ' + r.pass + ' PASS / ' + r.fail + ' FAIL；未产出截图 ====');
  process.exit(r.fail ? 1 : 0);
}

// automator 单步超时/抖动兜底：失败重试一次，仍失败返回 null（不中断整轮截图）
async function safe(fn) {
  for (let i = 0; i < 2; i++) {
    try { return await fn(); } catch (e) { await sleep(700); }
  }
  return null;
}

(async () => {
  let mp = null;
  try {
    mp = await Promise.race([
      require('miniprogram-automator').connect({ wsEndpoint: 'ws://127.0.0.1:9420' }),
      new Promise((r) => setTimeout(() => r(null), 8000))
    ]);
  } catch (e) { mp = null; }
  if (!mp) return staticFallback();

  fs.mkdirSync(OUT, { recursive: true });
  mp.on('console', (msg) => { if (msg && msg.type === 'error') consoleIssues.push(String(msg.args || msg.text || '').slice(0, 300)); });
  const shots = [];
  try {
    await safe(() => mp.evaluate(() => {
      try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
      wx.setStorageSync('zq_class_identity', JSON.stringify({
        token: 'shot-ug-token', sid: '3260799999', name: '测试账号',
        role: '', badge: '', is_admin: false, ts: Date.now()
      }));
    }));
    await safe(() => mp.reLaunch('/pages/ug/ug'));
    await sleep(1600);

    const base = await safe(() => mp.evaluate(() => {
      const ps = getCurrentPages();
      const p = ps[ps.length - 1];
      if (!p || p.route !== 'pages/ug/ug') return null;
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      return {
        ids: (p.data.cards || []).map((x) => x.id),
        titles: (p.data.cards || []).map((x) => x.title),
        scenes: (p.data.cards || []).map((x) => x.scene),
        swiperH: p.data.swiperH,
        winH: info.windowHeight,
        winW: info.windowWidth
      };
    }));
    check('进入使用说明页：19 张卡 / swiper 实测高度', !!(base && base.ids.length === 19 && base.swiperH > 200),
      JSON.stringify(base && { cards: base.ids.length, swiperH: base.swiperH, win: base.winW + 'x' + base.winH }));
    if (!base) throw new Error('无法读取使用说明页数据');

    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    for (let i = 0; i < base.ids.length; i++) {
      const jumped = await safe(() => mp.evaluate((idx) => {
        const ps = getCurrentPages();
        const p = ps[ps.length - 1];
        if (!p || !p.jumpTo) return false;
        p.jumpTo({ currentTarget: { dataset: { idx: idx } } });
        return true;
      }, i));
      await sleep(520);
      // 一次查询拿当前页所有卡片与滚动视口（DOM 顺序与 cards 数组一致 → 直接用 cur 索引取当前卡，避免横向偏移误判）
      const info = await safe(() => mp.evaluate(() => new Promise((resolve) => {
        const q = wx.createSelectorQuery();
        q.selectAll('.ug-card').boundingClientRect();
        q.selectAll('.ug-slide-scroll').boundingClientRect();
        q.select('.ug-swiper').boundingClientRect();
        q.exec((res) => {
          const win = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync());
          const ps = getCurrentPages();
          const p = ps[ps.length - 1];
          const cur = p && p.data ? Number(p.data.cur) : -1;
          resolve({
            cur: cur,
            cards: (res && res[0]) || [],
            scrolls: (res && res[1]) || [],
            swiper: (res && res[2] && res[2][0]) || null,
            winW: win.windowWidth
          });
        });
      })));
      const cur = info ? info.cur : -1;
      const okJump = cur === i;
      const card = info && info.cards && info.cards[i] ? info.cards[i] : null;
      const scroll = info && info.scrolls && info.scrolls[i] ? info.scrolls[i] : null;
      const cardH = card ? card.height : 0;
      const scrollH = scroll ? scroll.height : 0;
      const noClamp = cardH > 0 && (scrollH === 0 || cardH <= scrollH + 1);
      const noOverflow = !!(card && card.left >= -1 && card.right <= (info.winW || 390) + 0.5);
      const file = path.join(OUT, 'card-' + pad(i + 1) + '-' + base.ids[i] + '.png');
      let shotOk = false;
      for (let t = 0; t < 3 && !shotOk; t++) {
        try { await mp.screenshot({ path: file }); shotOk = fs.existsSync(file) && fs.statSync(file).size > 1000; } catch (e) { await sleep(800); }
      }
      shots.push({ i: i, id: base.ids[i], title: base.titles[i], scene: base.scenes[i], file: file, jumped: okJump, shot: shotOk, cardH: Math.round(cardH), scrollH: Math.round(scrollH), noClamp: noClamp, noOverflow: noOverflow });
      if (!okJump || !shotOk || !noClamp || !noOverflow) {
        console.log('WARN  第 ' + (i + 1) + ' 张 ' + base.ids[i] + ' :: ' + JSON.stringify({ jumped: okJump, shot: shotOk, cardH: Math.round(cardH), scrollH: Math.round(scrollH), noClamp: noClamp, noOverflow: noOverflow }));
      }
    }
    const shotOkN = shots.filter((s) => s.shot).length;
    check('19 张卡逐张截图成功（390 宽）', shotOkN === 19, shotOkN + '/19 → ' + OUT);
    check('19 张卡都能通过 jumpTo 正确定位（cur 与卡片一致）', shots.every((s) => s.jumped), shots.filter((s) => !s.jumped).map((s) => s.id).join(',') || 'ok');
    check('每张卡内容高度不超过卡内滚动视口（无截断；如超会在上方 WARN 列出）', shots.every((s) => s.noClamp),
      shots.filter((s) => !s.noClamp).map((s) => s.id + '(card ' + s.cardH + ' > scroll ' + s.scrollH + ')').join(',') || 'ok');
    check('每张卡宽度不横向溢出', shots.every((s) => s.noOverflow), shots.filter((s) => !s.noOverflow).map((s) => s.id).join(',') || 'ok');
    check('19 张卡覆盖 ≥8 种 scene', new Set(shots.map((s) => s.scene)).size >= 8, JSON.stringify(Array.from(new Set(shots.map((s) => s.scene)))));
    check('0 console error', consoleIssues.length === 0, JSON.stringify(consoleIssues.slice(0, 3)));

    const report = {
      at: new Date().toISOString(),
      window: { w: base.winW, h: base.winH },
      swiperH: base.swiperH,
      cards: shots,
      checks: results,
      consoleErrors: consoleIssues
    };
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2), 'utf8');
    const failed = results.filter((r) => !r.ok).length;
    console.log('\n==== ug_cards_shot: ' + (results.length - failed) + ' PASS / ' + failed + ' FAIL / ' + consoleIssues.length + ' console error；截图 ' + shots.length + ' 张 → ' + OUT + ' ====');
    process.exitCode = failed ? 1 : 0;
  } catch (e) {
    console.error('[ug_cards_shot] ' + ((e && e.stack) || e));
    process.exitCode = 1;
  } finally {
    try { await mp.disconnect(); } catch (e) { /* ignore */ }
  }
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
