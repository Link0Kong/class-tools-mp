/* ui_scroll_test.js —— 使用说明页 UI 交互回归（2026-11-12 卡片化重构后重写）
 *
 * 旧版验证「使用说明长列表滚动 → 顶栏 scrolled 收缩」；卡片化后使用说明变为
 * swiper 一屏一张卡（19 张）+ 上下张 + 分类 chips + 一键总览，页面基本不再纵向滚动，
 * 旧断言不再适用。本脚本改为验证新交互（devtools automator）：
 *   1) 初始第 1 张 / 19 张卡 / 总览关闭；首张「上一张」clamp 不循环；
 *   2) 「下一张」→ 第 2 张，再「上一张」回第 1 张；
 *   3) 分类 chip「生活」跳到该分类首卡（第 11 张：宿舍电费）；
 *   4) 一键总览打开 / 关闭（关闭后回到原卡）；
 *   5) 总览条目跳卡；末张「下一张」仍 clamp；
 *   6) 使用说明页无横向溢出；0 console error。
 *
 * 前置：cli.bat auto --project C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools --auto-port 9420 --trust-project
 * 用法：node ui_scroll_test.js
 * automator 不可用时自动退化为「无模拟器可跑」的静态结构检查（复用 ug_cards_check.js），
 * 不产出截图、不谎报 UI 通过，退出码按静态检查结果。
 */
'use strict';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const consoleIssues = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 500) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}

function staticFallback(note) {
  console.log('SKIP  未连接 ws://127.0.0.1:9420（开发者工具 automator 未启动）：' + note);
  let r = null;
  try { r = require('./ug_cards_check.js').runChecks({ quiet: false }); }
  catch (e) { console.error('[ui_scroll_test] 静态检查异常: ' + ((e && e.stack) || e)); process.exit(2); }
  console.log('\n==== ui_scroll_test（static-fallback）: ' + r.pass + ' PASS / ' + r.fail + ' FAIL；未跑 UI 交互 ====');
  process.exit(r.fail ? 1 : 0);
}

(async () => {
  let mp = null;
  try {
    mp = await Promise.race([
      require('miniprogram-automator').connect({ wsEndpoint: 'ws://127.0.0.1:9420' }),
      new Promise((r) => setTimeout(() => r(null), 8000))
    ]);
  } catch (e) { mp = null; }
  if (!mp) return staticFallback('退化为静态结构检查（ug_cards_check.js）');

  mp.on('console', (msg) => { if (msg && msg.type === 'error') consoleIssues.push(String(msg.args || msg.text || '').slice(0, 300)); });
  try {
    // 使用说明页有身份守卫：清空本机存储后只写官方测试身份（3260799999 / 测试账号），不使用任何真实账号
    await mp.evaluate(() => {
      try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
      wx.setStorageSync('zq_class_identity', JSON.stringify({ token: 'ui-ug-token', sid: '3260799999', name: '测试账号', role: '', badge: '', is_admin: false, ts: Date.now() }));
    });
    await mp.reLaunch('/pages/ug/ug');
    await sleep(1500);

    // 用 mp.evaluate 直接调真实 Page 方法（比 page 句柄更稳，避免 devtools 重编译后 objectId 失效）
    const call = async (method, arg) => await mp.evaluate((m, a) => {
      const ps = getCurrentPages();
      const p = ps[ps.length - 1];
      if (!p || typeof p[m] !== 'function') return { err: 'no-method:' + m };
      p[m](a);
      return { cur: p.data.cur, ov: p.data.ov };
    }, method, arg);
    const read = async () => await mp.evaluate(() => {
      const ps = getCurrentPages();
      const p = ps[ps.length - 1];
      if (!p || !p.data) return null;
      return {
        route: p.route,
        cur: p.data.cur,
        ov: p.data.ov,
        ids: (p.data.cards || []).map((x) => x.id),
        ovGroups: (p.data.ovGroups || []).map((g) => ({ name: g.name, n: (g.cards || []).length }))
      };
    });

    let d = await read();
    check('初始第 1 张 / 19 张卡 / 总览关闭', !!(d && d.route === 'pages/ug/ug' && d.cur === 0 && d.ids.length === 19 && d.ov === false),
      JSON.stringify(d && { route: d.route, cur: d.cur, cards: d.ids.length, ov: d.ov }));

    await call('prev');
    await sleep(350);
    d = await read();
    check('首张「上一张」clamp 不循环（cur 仍 0）', d.cur === 0, 'cur=' + d.cur);

    await call('next');
    await sleep(500);
    d = await read();
    check('「下一张」→ 第 2 张（工作台）', d.cur === 1 && d.ids[1] === 'home', JSON.stringify({ cur: d.cur, id: d.ids[d.cur] }));
    await call('prev');
    await sleep(350);
    d = await read();
    check('「上一张」→ 回第 1 张', d.cur === 0, 'cur=' + d.cur);

    await call('jumpCat', { currentTarget: { dataset: { cat: 'life' } } });
    await sleep(500);
    d = await read();
    check('分类 chip「生活」跳到该分类首卡（第 11 张：宿舍电费）', d.cur === 10 && d.ids[10] === 'power',
      JSON.stringify({ cur: d.cur, id: d.ids[d.cur] }));

    await call('openOv');
    await sleep(350);
    d = await read();
    const ovItems = (d.ovGroups || []).reduce((n, g) => n + g.n, 0);
    check('一键总览打开（5 分组 / 19 条）', d.ov === true && (d.ovGroups || []).length === 5 && ovItems === 19,
      JSON.stringify({ ov: d.ov, groups: (d.ovGroups || []).length, items: ovItems }));
    await call('closeOv');
    await sleep(220);
    d = await read();
    check('关闭总览回到原卡（cur 仍 10）', d.ov === false && d.cur === 10, JSON.stringify({ ov: d.ov, cur: d.cur }));

    await call('jumpTo', { currentTarget: { dataset: { idx: 18 } } });
    await sleep(400);
    await call('next');
    await sleep(250);
    d = await read();
    check('末张「下一张」clamp 不循环（cur 18）', d.cur === 18, 'cur=' + d.cur);

    const lr = await mp.evaluate(() => new Promise((resolve) => {
      const q = wx.createSelectorQuery();
      q.selectAll('.ug-card').boundingClientRect();
      q.selectAll('.ug-nav').boundingClientRect();
      q.exec((res) => {
        const win = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).windowWidth;
        const cards = ((res && res[0]) || []).filter((r) => r && r.left > -6 && r.left < 6);   // 只量当前可见卡
        resolve({ rects: cards.concat((res && res[1]) || []), win: win });
      });
    }));
    const overflow = lr.rects.filter((r) => r && (r.right > lr.win + 0.5 || r.left < -0.5));
    check('使用说明页无横向溢出（当前卡片 / 底部按钮）', overflow.length === 0,
      JSON.stringify({ win: lr.win, overflow: overflow.map((r) => ({ l: r.left, r: r.right })) }));
    check('0 console error', consoleIssues.length === 0, JSON.stringify(consoleIssues.slice(0, 3)));

    const failed = results.filter((r) => !r.ok).length;
    console.log('\n==== ui_scroll_test: ' + (results.length - failed) + ' PASS / ' + failed + ' FAIL / ' + consoleIssues.length + ' console error ====');
    process.exitCode = failed ? 1 : 0;
  } catch (e) {
    console.error('[ui_scroll_test] ' + ((e && e.stack) || e));
    process.exitCode = 1;
  } finally {
    try { await mp.disconnect(); } catch (e) { /* ignore */ }
  }
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
