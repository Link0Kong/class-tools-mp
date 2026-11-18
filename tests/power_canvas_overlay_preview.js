/* power_canvas_overlay_preview.js —— 电费趋势 canvas 覆盖层遮挡修复（miniprogram-automator + mock 网络）
 *
 * 用户反馈（2026-11-08）：趋势图的线会覆盖在「宿舍选择」弹层之上。
 * 根因：单层渲染不支持的机型/基础库上 canvas type=2d 属原生组件，层级永远高于页面 view。
 * 修复：覆盖层（sheetOpen bottom-sheet / lowOpen 低电阈值面板）打开时 wx:if 移除 #pwTrend，
 *       关闭后 setData 回调 + wx.nextTick 重绘（复用已有数据，不重复请求）。
 *
 * 前置（本脚本不在会话内自行启动 devtools；由 Lead 统一运行）：
 *   cli.bat auto --project C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools --port 9433 --auto-port 9420 --trust-project
 * 用法：
 *   node power_canvas_overlay_preview.js [--ws ws://127.0.0.1:9420]
 *   （默认连 ws://127.0.0.1:9420；也可用环境变量 POWER_OVERLAY_WS 覆盖）
 *
 * 断言：
 *   1) 初始趋势已绘制（canvas 节点存在、_canvasDrawn=true、≥2 点）；
 *   2) 打开宿舍弹层 → #pwTrend 节点从 WXML 移除（canvasPresent=false），截图确认弹层无趋势线覆盖；
 *   3) 关闭弹层 → canvas 恢复且重绘，期间 power/power_history 请求数不变（不重复请求）；
 *   4) 低电阈值面板打开/关闭同样成立；
 *   5) 页面滚动后再打开弹层：canvas 仍被移除（无原生层残留）；关闭后恢复。
 * 产出：_shots_power_overlay/01..05*.png + result.json；失败 exit 2。
 * 说明：全程 mock wx.request（不接触真实云端）；身份/关注宿舍仅为本地 mock 写入 storage；不点刷新。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

function wsArg() {
  const i = process.argv.indexOf('--ws');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env.POWER_OVERLAY_WS || 'ws://127.0.0.1:9420';
}
const WS = wsArg();
const OUT = path.join(__dirname, '_shots_power_overlay');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const consoleIssues = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 500) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}

/* ---------------- mock：身份 + 电费网络（挂 globalData，不污染 wx） ---------------- */
async function installMock(mp) {
  await mp.evaluate(() => {
    const gd = getApp().globalData;
    if (gd.__pwOverlayMock) { try { wx.request = gd.__pwRequest; } catch (e) { /* ignore */ } return; }
    gd.__pwOrigRequest = wx.request;
    const ROW = {
      id: '4-23A---321', label: '23号楼A座321', building: '23号楼A座', room: '321',
      quantity: 382.02, unit: '度', low: false, updated_at: '2026-11-08T07:30:00+08:00'
    };
    const hist = [];
    for (let i = 0; i < 10; i++) hist.push({ ts: new Date(Date.now() - (9 - i) * 3600e3).toISOString(), quantity: 400 - i * 2.5 });
    gd.__pw = { row: 0, hist: 0 };
    gd.__pwRequest = function (o) {
      const u = String((o && o.url) || '');
      setTimeout(function () {
        const g = getApp().globalData;
        if (u.indexOf('/power_history?') >= 0) { g.__pw.hist += 1; return o.success && o.success({ statusCode: 200, data: hist }); }
        if (u.indexOf('/power?') >= 0) { g.__pw.row += 1; return o.success && o.success({ statusCode: 200, data: [ROW] }); }
        return o.success && o.success({ statusCode: 200, data: [] });
      }, 15);
    };
    wx.request = gd.__pwRequest;
    gd.__pwOverlayMock = true;
  });
}
async function prepare(mp) {
  await mp.evaluate(() => {
    try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
    wx.setStorageSync('zq_class_identity', JSON.stringify({
      token: 'tok-pw-overlay', sid: '3260799999', name: '测试账号',
      role: '副团支书', badge: '班委', is_admin: true, ts: Date.now()
    }));
    // 已关注宿舍 → 进入页面即自动 load(false) 并绘制趋势
    wx.setStorageSync('zq_tools_v2', JSON.stringify({ power: { sel: '4-23A---321', at: Date.now(), low: 30 } }));
    getApp().globalData.__pw = { row: 0, hist: 0 };
  });
}

async function pageState(mp) {
  return mp.evaluate(() => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    if (!pg) return null;
    const tr = pg.data.trend || {};
    return JSON.parse(JSON.stringify({
      path: pg.route || '',
      state: pg.data.state, sheetOpen: !!pg.data.sheetOpen, lowOpen: !!pg.data.lowOpen,
      trendEmpty: tr.empty === true, drawn: !!pg._canvasDrawn, points: (pg._linePoints || []).length,
      req: (getApp().globalData || {}).__pw || null
    }));
  });
}
// canvas 节点是否存在于当前 WXML（wx:if false 时应为 false）
async function canvasPresent(mp) {
  return mp.evaluate(() => new Promise(function (resolve) {
    let done = false;
    const fin = function (v) { if (!done) { done = true; resolve(v); } };
    try {
      wx.createSelectorQuery().select('#pwTrend').fields({ node: true, size: true }, function (r) {
        fin(!!(r && r.node));
      }).exec(function () { setTimeout(function () { fin(false); }, 40); });
    } catch (e) { fin(false); }
  }));
}
async function currentPage(mp) {
  const p = await mp.currentPage();
  if (!p) throw new Error('no current page');
  return p;
}
async function shot(mp, name) {
  const p = path.join(OUT, name + '.png');
  try { await mp.screenshot({ path: p }); console.log('SHOT  ' + p); return p; } catch (e) {
    for (let i = 0; i < 2; i++) {
      try { await sleep(800); await mp.screenshot({ path: p }); console.log('SHOT  ' + p + ' (retry)'); return p; } catch (e2) { /* next */ }
    }
    console.log('SHOT-FAIL ' + name + ' :: ' + (e && e.message));
    return '';
  }
}
async function waitFor(fn, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 8000)) {
    const v = await fn();
    if (v) return v;
    await sleep(120);
  }
  return null;
}
async function tapOrCall(page, selector, method, args) {
  try {
    const el = await page.$(selector);
    if (el) { await el.tap(); return 'tap'; }
  } catch (e) { /* fallthrough */ }
  await page.callMethod(method, args);
  return 'call';
}

(async () => {
  console.log('连接 automator：' + WS + '（前置：cli.bat auto --auto-port 9420 --trust-project）');
  const mp = await automator.connect({ wsEndpoint: WS });
  mp.on('console', (msg) => {
    if (msg && msg.type === 'error') consoleIssues.push(String(msg.args || msg.text || '').slice(0, 300));
  });
  const shots = [];
  try {
    await installMock(mp);
    await prepare(mp);
    await mp.reLaunch('/pages/power/power');
    await waitFor(async () => {
      const s = await pageState(mp);
      return s && s.path === 'pages/power/power' && s.state === 'ready' && s.drawn && s.points >= 2;
    }, 10000);
    let page = await currentPage(mp);
    let st = await pageState(mp);
    let present = await canvasPresent(mp);
    check('1 初始：趋势已绘制且 #pwTrend canvas 存在', !!(st && st.state === 'ready' && st.drawn && st.points >= 2 && present), JSON.stringify(st && { state: st.state, points: st.points, drawn: st.drawn, canvas: present }));
    shots.push(await shot(mp, '01_trend_before'));

    // —— 宿舍选择 bottom-sheet ——
    const openBy = await tapOrCall(page, '.pw-pick', 'openSheet');
    await sleep(350);
    st = await pageState(mp);
    present = await canvasPresent(mp);
    check('2 打开宿舍弹层（' + openBy + '）：sheetOpen=true', !!(st && st.sheetOpen === true), JSON.stringify(st && { sheetOpen: st.sheetOpen }));
    check('3 弹层打开时 #pwTrend 已从 WXML 移除（原生 canvas 不再压住弹层）', present === false, 'canvasPresent=' + present);
    shots.push(await shot(mp, '02_sheet_open_no_canvas'));
    const reqOpen = st && st.req ? { row: st.req.row, hist: st.req.hist } : {};

    // close via 取消按钮
    const closeBy = await tapOrCall(page, '.pw-cancel', 'closeSheet');
    await sleep(450);
    st = await pageState(mp);
    present = await canvasPresent(mp);
    check('4 关闭弹层（' + closeBy + '）：canvas 恢复并重绘', !!(st && st.sheetOpen === false && present === true && st.drawn === true), JSON.stringify(st && { sheetOpen: st.sheetOpen, canvas: present, drawn: st.drawn }));
    check('5 关闭重绘不重复请求（power/history 计数不变）', !!(st && st.req && st.req.row === reqOpen.row && st.req.hist === reqOpen.hist), JSON.stringify({ open: reqOpen, after: st && st.req }));
    shots.push(await shot(mp, '03_trend_after_close'));

    // —— 低电阈值面板 ——
    page = await currentPage(mp);
    await page.callMethod('onTileTap', { currentTarget: { dataset: { key: 'threshold' } } });
    await sleep(350);
    st = await pageState(mp);
    present = await canvasPresent(mp);
    check('6 低电阈值面板打开：lowOpen=true 且 #pwTrend 已移除', !!(st && st.lowOpen === true && present === false), JSON.stringify(st && { lowOpen: st.lowOpen, canvas: present }));
    shots.push(await shot(mp, '04_low_panel_no_canvas'));
    await page.callMethod('closeLow');
    await sleep(450);
    st = await pageState(mp);
    present = await canvasPresent(mp);
    check('7 关闭低电面板：canvas 恢复并重绘', !!(st && st.lowOpen === false && present === true && st.drawn === true), JSON.stringify(st && { lowOpen: st.lowOpen, canvas: present, drawn: st.drawn }));

    // —— 页面滚动后再开弹层（无原生层残留） ——
    await mp.evaluate(() => { try { wx.pageScrollTo({ scrollTop: 320, duration: 0 }); } catch (e) { /* ignore */ } });
    await sleep(350);
    page = await currentPage(mp);
    await page.callMethod('openSheet');
    await sleep(350);
    st = await pageState(mp);
    present = await canvasPresent(mp);
    check('8 滚动后打开弹层：canvas 仍被移除（无层残留）', !!(st && st.sheetOpen === true && present === false), JSON.stringify(st && { sheetOpen: st.sheetOpen, canvas: present }));
    shots.push(await shot(mp, '05_scrolled_sheet_no_canvas'));
    await page.callMethod('closeSheet');
    await sleep(450);
    st = await pageState(mp);
    present = await canvasPresent(mp);
    check('9 滚动后关闭弹层：趋势恢复', !!(st && st.sheetOpen === false && present === true && st.drawn === true), JSON.stringify(st && { sheetOpen: st.sheetOpen, canvas: present, drawn: st.drawn }));

    const info = await mp.evaluate(() => { try { return wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) { return {}; } });
    const report = {
      at: new Date().toISOString(), wsEndpoint: WS,
      windowWidth: info.windowWidth || 0, pixelRatio: info.pixelRatio || 0,
      note: '全程 mock wx.request；覆盖层打开时 #pwTrend 由 wx:if 移除（canvasPresent=false），关闭后恢复重绘且 0 额外请求。',
      checks: results, screenshots: shots.filter(Boolean), consoleErrors: consoleIssues
    };
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2), 'utf8');
    const failed = results.filter((r) => !r.ok).length;
    console.log('\n==== power_canvas_overlay_preview: ' + (results.length - failed) + ' PASS / ' + failed + ' FAIL / ' + consoleIssues.length + ' console error；windowWidth=' + report.windowWidth + ' ====');
    console.log('screenshots: ' + report.screenshots.join(', '));
    process.exitCode = failed ? 2 : 0;
  } finally {
    try {
      await mp.evaluate(() => {
        try {
          const gd = getApp().globalData;
          if (gd.__pwOrigRequest) wx.request = gd.__pwOrigRequest;
        } catch (e) { /* ignore */ }
      });
    } catch (e) { /* ignore */ }
    try { await mp.disconnect(); } catch (e) { /* ignore */ }
  }
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
