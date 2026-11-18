/* tt_swipe_preview.js —— 小程序课表「6/7 天同页缩放显示」回归（automator 真实渲染/触摸）
 *
 * 2026-11-06 用户反馈：周六/周日有课时，周表要「优化显示比例」在一屏里完整显示，而不是需要横向滑动才能看全。
 * 新行为：
 *   · 列宽始终按卡片内宽自适应：colW = floor((TT_CARD_INNER - TT_PD_COL) / days.length)
 *     → 5/6/7 天 = 106/89/76rpx，内容宽 96+days×colW = 626/630/628rpx ≤ 630rpx，恒不横向溢出；
 *   · 6/7 天挂 dense 样式（课程名/教室/表头字号收紧、课程名单节块最多 2 行、日期头可换行、7 天隐藏「第X-Y节」）；
 *   · 行高 96rpx / 跨节次绝对定位 / 点击课程开详情 全部不变；
 *   · 周表不再横向溢出 → 左右滑动直接切上一周/下一周（不再有 giveScroll 分支）。
 *
 * 本脚本用 mock 身份 + mock wx.request（本地 `_tt_fixture_20261106.json`，不接触真实云端/网络）：
 *   · 第 3 周为真实 tt.json 的「周六有课 → 6 天」周；
 *   · 第 10 周先看真实 5 天，再向页面注入周六/周日课程 → 7 天（仅内存，不落盘）。
 *
 * 前置：cli.bat auto --project <mp-class-tools> --port 9433 --auto-port 9420 --trust-project
 * 用法：node tt_swipe_preview.js
 * 产出：_shots_tt_fit/（00 5 天对照 / 01 6 天完整周表 / 02 7 天完整周表 / 03 日视图 / 04 切周后）+ result.json
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const OUT = path.join(__dirname, '_shots_tt_fit');
fs.mkdirSync(OUT, { recursive: true });
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, '_tt_fixture_20261106.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const consoleIssues = [];
let passN = 0, failN = 0;

function check(name, ok, detail) {
  checks.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 500) });
  if (ok) passN++; else failN++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}
async function shot(mp, name) {
  const p = path.join(OUT, name + '.png');
  try { await mp.screenshot({ path: p }); console.log('SHOT  ' + p); return p; } catch (e) { console.log('SHOT-FAIL ' + name + ' :: ' + e.message); return ''; }
}
function r2(n) { return Math.round(n * 10) / 10; }
async function pageData(mp) {
  const o = await mp.evaluate(() => {
    const ps = getCurrentPages(); const pg = ps[ps.length - 1];
    if (!pg || !pg.data) return null;
    return JSON.parse(JSON.stringify({
      path: pg.route, state: pg.data.state, view: pg.data.view, wk: pg.data.wk,
      colW: pg.data.colW, dense: pg.data.dense, dense7: pg.data.dense7, showSpan: pg.data.showSpan,
      rowH: pg.data.rowH, gridOverflow: pg.data.gridOverflow,
      gridMaxX: Number(pg._gridMaxX) || 0, gridOverflowHold: !!pg._gridOverflow,
      days: (pg.data.dayCols || []).length,
      heads: (pg.data.head || []).map((h) => h.n),
      weekendCourses: [5, 6].map((i) => ((pg.data.dayCols || [])[i] ? (pg.data.dayCols[i].courses || []).length : -1)),
      supTap: Number(pg._supTap) || 0,
      swipeStyle: pg.data.swipeStyle || '',
      showDetail: !!pg.data.showDetail,
      detailName: (pg.data.detail && pg.data.detail.name) || '',
      sw: pg._sw ? { live: !!pg._sw.live, lock: !!pg._sw.lock } : null
    }));
  });
  if (o) o.now = Date.now();   // 采样时刻（点击抑制用，避免断言时已过 320ms）
  return o;
}
async function domInfo(mp) {
  const p = await mp.currentPage();
  const card = await p.$('.ttcard');
  const scroll = await p.$('.tscroll');
  const grid = await p.$('.tgrid');
  const cardBox = { off: await card.offset(), size: await card.size() };
  const scrollBox = { off: await scroll.offset(), size: await scroll.size() };
  const gridBox = { off: await grid.offset(), size: await grid.size() };
  const cols = [];
  for (const c of await p.$$('.daycol')) cols.push({ off: await c.offset(), size: await c.size() });
  const heads = [];
  for (const h of await p.$$('.thead .td')) {
    heads.push({ text: await h.text(), off: await h.offset(), size: await h.size() });
  }
  const crs = [];
  for (const c of await p.$$('.crs')) {
    const nameEl = await c.$('.cname');
    const roomEl = await c.$('.croom');
    const spanEl = await c.$('.cspan');
    crs.push({
      off: await c.offset(), size: await c.size(), text: await c.text(),
      cls: await c.attribute('class'),
      name: { text: await nameEl.text(), size: await nameEl.size(), fs: parseFloat(await nameEl.style('font-size')) || 0 },
      room: roomEl ? { size: await roomEl.size(), fs: parseFloat(await roomEl.style('font-size')) || 0 } : null,
      span: spanEl ? true : false
    });
  }
  const spanCount = (await p.$$('.cspan')).length;
  const scrollWidth = await scroll.scrollWidth();
  return { card: cardBox, scroll: scrollBox, grid: gridBox, cols, heads, crs, spanCount, scrollWidth: Number(scrollWidth) || 0 };
}
async function applyMock(mp) {
  return mp.evaluate((fixture) => {
    try {
      wx.setStorageSync('zq_class_identity', JSON.stringify({
        token: 'tok-tt-preview', sid: '3260799999', name: '测试账号',
        role: '副团支书', badge: '班委', is_admin: true, ts: Date.now()
      }));
    } catch (e) { /* ignore */ }
    globalThis.__ttFixture = fixture;
    globalThis.__ttMockOn = true;
    globalThis.__ttReqs = [];
    wx.request = function (o) {
      const u = String((o && o.url) || '');
      globalThis.__ttReqs.push(String((o && o.method) || 'GET') + ' ' + u);
      let data = [];
      if (u.indexOf('tt.json') >= 0) data = globalThis.__ttFixture;
      const done = function () { try { o.success && o.success({ statusCode: 200, data: data }); } catch (e) { /* ignore */ } };
      setTimeout(done, 20);
    };
    return 'ok';
  }, FIXTURE);
}
async function openTt(mp) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await applyMock(mp);
    await sleep(250);
    await mp.reLaunch('/pages/tt/tt');
    await sleep(2600);
    for (let i = 0; i < 12; i++) {
      const d = await pageData(mp).catch(() => null);
      if (d && d.path === 'pages/tt/tt' && (d.state === 'data' || d.state === 'empty')) return d;
      await sleep(400);
    }
  }
  throw new Error('无法进入课表页（可能被身份页重定向 / 连接中断）');
}
async function setWeek(mp, wk) {
  await mp.evaluate((w) => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    pg._wk = w; pg._day = null; pg._dayUser = true; pg.refresh();
  }, wk);
  await sleep(450);
  return pageData(mp);
}
async function injectWeekend(mp) {
  // 仅内存注入（不落盘/不上传）：第 10 周周六 + 周日课程，构造 7 天周表；可重复调用（幂等）
  await mp.evaluate(() => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    if (!pg.__baseCourses) pg.__baseCourses = (pg._courses || []).slice();
    const add = [
      { name: '体育1', day: 5, start: 6, end: 9, weeks: '10', parity: 'all', teacher: '甘子怡', room: '体育场篮球区(篮球场1-3)' },
      { name: '思想道德与法治', day: 6, start: 6, end: 8, weeks: '10', parity: 'all', teacher: '陈丽晶', room: '厚德楼(教室02405)' },
      { name: '形势与政策01', day: 6, start: 1, end: 1, weeks: '10', parity: 'all', teacher: '林心影', room: '厚德楼(教室02405)' }
    ];
    pg._courses = pg.__baseCourses.concat(add);
    pg._wk = 10; pg._day = null; pg._dayUser = true; pg.refresh();
  });
  await sleep(600);
  return pageData(mp);
}
async function getEl(mp, sel, tries) {
  for (let i = 0; i < (tries || 8); i++) {
    try {
      const p = await mp.currentPage();
      if (p) { const el = await p.$(sel); if (el) return el; }
    } catch (e) { /* retry */ }
    await sleep(300);
  }
  return null;
}
async function swipeOn(mp, dx, dy) {
  let el = await getEl(mp, '.tscroll', 6);
  if (!el) { await ensureTtWeek(mp); el = await getEl(mp, '.tscroll', 8); }   // 页面数据未就绪/被重载：恢复一次
  if (!el) throw new Error('周表滑动区 .tscroll 不存在（当前页可能被重载）');
  const X = 285, Y = 330;
  await el.touchstart({ touches: [{ identifier: 0, clientX: X, clientY: Y, pageX: X, pageY: Y }] });
  await sleep(30);
  await el.touchmove({ touches: [{ identifier: 0, clientX: X + dx, clientY: Y + (dy || 0), pageX: X + dx, pageY: Y + (dy || 0) }] });
  await sleep(60);
  return { before: await pageData(mp), el: el, X: X, Y: Y };
}
async function swipeEnd(mp, dx, dy) {
  const p = await mp.currentPage();
  const el = await p.$('.tscroll');
  const X = 285, Y = 330;
  await el.touchend({ touches: [], changedTouches: [{ identifier: 0, clientX: X + dx, clientY: Y + (dy || 0), pageX: X + dx, pageY: Y + (dy || 0) }] });
  await sleep(80);
  const early = await pageData(mp);      // 320ms 点击抑制期内取一次（供断言）
  await sleep(620);
  return early;
}
async function ensureTtWeek(mp) {
  let d = await pageData(mp).catch(() => null);
  // devtools 热重载/重定向后：等页面回到「课表页 + data 态」，否则重新 mock + 打开
  for (let i = 0; i < 12 && (!d || d.path !== 'pages/tt/tt' || d.state !== 'data'); i++) {
    await sleep(400);
    d = await pageData(mp).catch(() => null);
  }
  if (!d || d.path !== 'pages/tt/tt' || d.state !== 'data') return openTt(mp);
  if (d.view !== 'week') {
    const p = await mp.currentPage();
    const segs = await p.$$('.ttseg .seg');
    if (segs.length === 2) { await segs[0].tap(); await sleep(600); }
    d = await pageData(mp);
  }
  return d;
}

/* 检查 6/7 天周表 DOM：全部列都在卡片内、无横向滚动、周末列有课程 */
function checkFit(name, d, dom, winW) {
  const rpx = winW / 750;
  const cardPad = 28 * rpx;                         // .ttcard padding: 28rpx
  const innerLeft = dom.card.off.left + cardPad;
  const innerRight = dom.card.off.left + dom.card.size.width - cardPad;
  const contentW = (96 + d.days * d.colW) * rpx;    // 96rpx 节次列 + N×colW
  check(name + '：列宽/内容宽（' + d.days + ' 天 colW=' + d.colW + 'rpx）', d.colW === Math.floor((630 - 96) / d.days) && contentW <= 630 * rpx + 0.5,
    'colW=' + d.colW + 'rpx 内容宽≈' + r2(contentW) + 'px ≤ 卡片内宽≈' + r2(630 * rpx) + 'px');
  check(name + '：grid 不横向溢出（gridOverflow=false / gridMaxX=0）', d.gridOverflow === false && d.gridOverflowHold === false && d.gridMaxX === 0,
    'gridOverflow=' + d.gridOverflow + ' hold=' + d.gridOverflowHold + ' gridMaxX=' + d.gridMaxX);
  check(name + '：DOM ' + d.days + ' 个星期列 + 表头，无横向滚动', dom.cols.length === d.days && dom.heads.length === d.days && dom.scrollWidth <= dom.scroll.size.width + 2,
    'cols=' + dom.cols.length + ' heads=' + dom.heads.length + ' scrollWidth=' + dom.scrollWidth + ' scrollW=' + r2(dom.scroll.size.width));
  const lastCol = dom.cols[dom.cols.length - 1];
  const lastRight = lastCol.off.left + lastCol.size.width;
  check(name + '：全部列右缘在卡片内（含' + (d.days >= 7 ? '周六/周日' : '周六') + '，无需横滑）',
    dom.cols[0].off.left >= innerLeft - 2 && lastRight <= innerRight + 2,
    'firstLeft=' + r2(dom.cols[0].off.left) + ' ≥ ' + r2(innerLeft) + '；lastRight=' + r2(lastRight) + ' ≤ ' + r2(innerRight));
  const wantWeekend = d.days >= 7 ? [5, 6] : (d.days === 6 ? [5] : []);
  if (wantWeekend.length) {
    const weekendBad = wantWeekend.filter((i) => d.weekendCourses[i] <= 0);
    check(name + '：周六' + (d.days >= 7 ? '/周日' : '') + '列有课程块且课程块在卡片内',
      weekendBad.length === 0 && dom.cols.length > Math.max.apply(null, wantWeekend),
      'weekendCourses=' + JSON.stringify(d.weekendCourses) + ' cols=' + dom.cols.length);
  }
  // 课程块不越界、文字不重叠/不裁到不可读
  let bad = [];
  dom.crs.forEach((c) => {
    if (c.off.left < innerLeft - 2 || c.off.left + c.size.width > innerRight + 2) bad.push('越界:' + c.text);
    const innerH = c.size.height - 8;                                   // 上下 padding 余量（rpx→px 取整）
    const textH = c.name.size.height + (c.room ? c.room.size.height + 2 : 0);
    if (textH > innerH + 2) bad.push('文字超高:' + c.text + '(' + r2(textH) + '>' + r2(innerH) + ')');
    if (c.name.size.width > c.size.width + 1) bad.push('文字超宽:' + c.text);
  });
  check(name + '：课程块内文字不重叠/不越界（' + dom.crs.length + ' 块）', bad.length === 0, bad.slice(0, 4).join(' | '));
  return { innerLeft: innerLeft, innerRight: innerRight, contentW: contentW };
}

(async () => {
  let mp = null;
  for (let i = 0; i < 3 && !mp; i++) {
    try { mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' }); } catch (e) { await sleep(1500); }
  }
  if (!mp) throw new Error('无法连接 automator（ws://127.0.0.1:9420）：请先运行 cli.bat auto');
  mp.on('console', (e) => {
    if (e && e.type === 'error') {
      const args = (e.args || []).map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      consoleIssues.push(String(args || e.text || '').slice(0, 400));
    }
  });
  mp.on('exception', (e) => consoleIssues.push('exception: ' + JSON.stringify(e).slice(0, 300)));
  await sleep(1500);
  try {
    const info = await mp.evaluate(() => { const i = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); return { w: i.windowWidth, h: i.windowHeight }; });
    const winW = info.w || 390;
    console.log('INFO  windowWidth=' + winW + '（375 左右；rpx 布局与断言与此无关）');

    /* ---------- 1. 5 天真实周（对照，不应变差） ---------- */
    let d = await openTt(mp);
    check('课表页加载（mock 身份 + 本地 tt.json fixture）', d.state === 'data', d.state + ' ' + d.path);
    d = await setWeek(mp, 10);
    check('5 天对照：第 10 周 days=5 / colW=106 / 不缩放（dense=false）', d.days === 5 && d.colW === 106 && d.dense === false && d.dense7 === false && d.showSpan === true,
      'days=' + d.days + ' colW=' + d.colW + ' dense=' + d.dense);
    let dom = await domInfo(mp);
    checkFit('5 天对照', d, dom, winW);
    const shot5 = await shot(mp, '00-week-5day-baseline');

    /* ---------- 2. 6 天真实周（第 3 周：周六有课） ---------- */
    d = await setWeek(mp, 3);
    check('6 天周表：days=6 / colW=89 / dense=true / dense7=false / showSpan=true', d.days === 6 && d.colW === 89 && d.dense === true && d.dense7 === false && d.showSpan === true,
      'days=' + d.days + ' colW=' + d.colW + ' dense=' + d.dense + ' dense7=' + d.dense7);
    check('6 天表头含周六（' + d.heads.join('/') + '）', d.heads.length === 6 && d.heads[5] === '周六', d.heads.join('/'));
    dom = await domInfo(mp);
    checkFit('6 天', d, dom, winW);
    const names6 = dom.crs.filter((c) => c.name.text).map((c) => c.name.text);
    const fs6 = dom.crs.length ? Math.min.apply(null, dom.crs.map((c) => c.name.fs)) : 0;
    check('6 天课程名可读（font-size 实测 ≥9px，课程名 ' + names6.length + ' 个非空）', fs6 >= 9 && names6.length === dom.crs.length,
      'minFontSize=' + fs6 + 'px（21rpx×' + (winW / 750) + '≈' + r2(21 * winW / 750) + 'px）');
    check('6 天保留「第X-Y节」小字（showSpan=true 且 DOM 存在 .cspan）', dom.spanCount > 0, '.cspan=' + dom.spanCount);
    const shot6 = await shot(mp, '01-week-6day-sat-full');

    /* ---------- 3. 7 天周（第 10 周注入周六/周日课） ---------- */
    d = await injectWeekend(mp);
    check('7 天周表：days=7 / colW=76 / dense=true / dense7=true / showSpan=false', d.days === 7 && d.colW === 76 && d.dense === true && d.dense7 === true && d.showSpan === false,
      'days=' + d.days + ' colW=' + d.colW + ' dense7=' + d.dense7);
    check('7 天表头含周六/周日（' + d.heads.join('/') + '）', d.heads.length === 7 && d.heads[5] === '周六' && d.heads[6] === '周日', d.heads.join('/'));
    dom = await domInfo(mp);
    checkFit('7 天', d, dom, winW);
    const fs7 = dom.crs.length ? Math.min.apply(null, dom.crs.map((c) => c.name.fs)) : 0;
    check('7 天课程名可读（font-size 实测 ≥9px / 定义 19rpx≈' + r2(19 * winW / 750) + 'px）', fs7 >= 9, 'minFontSize=' + fs7 + 'px');
    check('7 天隐藏冗余「第X-Y节」.cspan（DOM 0 个）', dom.spanCount === 0, '.cspan=' + dom.spanCount);
    const oneBlocks = dom.crs.filter((c) => /crs-one/.test(c.cls));
    const oneOk = oneBlocks.every((c) => c.name.size.height <= 2 * (c.name.fs * 1.3) + 2);
    check('7 天单节课块（crs-one）课程名 ≤2 行不裁半行（' + oneBlocks.length + ' 块）', oneOk, oneBlocks.map((c) => c.text + ':' + r2(c.name.size.height) + 'px').join(' | '));
    const shot7 = await shot(mp, '02-week-7day-sat-sun-full');

    /* ---------- 4. 手势：6 天周表任意位置左/右滑直接切周 ---------- */
    d = await ensureTtWeek(mp);
    d = await setWeek(mp, 3);
    let wk0 = d.wk;
    let s = await swipeOn(mp, -80, 0);
    check('6 天周表左滑跟手位移（1:1，没有 giveScroll 分支）', /translateX\(-8\d?px\)/.test(s.before.swipeStyle || ''),
      'style=' + (s.before.swipeStyle || '') + ' sw=' + JSON.stringify(s.before.sw));
    const endD1 = await swipeEnd(mp, -80, 0);
    d = await pageData(mp);
    check('6 天周表左滑 → 下一周（' + wk0 + '→' + d.wk + '）', d.wk === wk0 + 1, 'wk=' + d.wk);
    check('切周后 320ms 点击抑制已启动', endD1.supTap > endD1.now, 'supTap=' + endD1.supTap + ' at=' + endD1.now);
    await sleep(120);

    s = await swipeOn(mp, 80, 0);
    check('6 天周表右滑跟手位移（1:1）', /translateX\(8\d?px\)/.test(s.before.swipeStyle || ''), 'style=' + (s.before.swipeStyle || ''));
    await swipeEnd(mp, 80, 0);
    d = await pageData(mp);
    check('6 天周表右滑 → 上一周（回到 ' + wk0 + '）', d.wk === wk0, 'wk=' + d.wk);
    await sleep(360);
    const shotSwipe = await shot(mp, '04-6day-after-swipe');

    /* ---------- 5. 手势：7 天周表左滑直接切周 ---------- */
    d = await ensureTtWeek(mp);
    d = await injectWeekend(mp);
    wk0 = d.wk;
    s = await swipeOn(mp, -80, 0);
    check('7 天周表左滑跟手位移（1:1）', /translateX\(-8\d?px\)/.test(s.before.swipeStyle || ''), 'style=' + (s.before.swipeStyle || ''));
    await swipeEnd(mp, -80, 0);
    d = await pageData(mp);
    check('7 天周表左滑 → 下一周（' + wk0 + '→' + d.wk + '）', d.wk === wk0 + 1, 'wk=' + d.wk);
    await sleep(360);

    /* ---------- 6. 日视图：点击切 + 横滑切周；课程卡点击仍开详情 ---------- */
    d = await ensureTtWeek(mp);
    d = await injectWeekend(mp);   // 回第 10 周 7 天
    let pSeg = await mp.currentPage();
    let segs = await pSeg.$$('.ttseg .seg');
    check('周/日切换按钮存在', segs.length === 2, 'segs=' + segs.length);
    if (segs.length === 2) { await segs[1].tap(); await sleep(650); }
    d = await pageData(mp);
    check('点击「日」进入日视图（只点击切换）', d.view === 'day', 'view=' + d.view);
    const wkDay0 = d.wk;
    const dayEl = await getEl(mp, '.ttdaywrap');
    const X = 285, Y = 330;
    await dayEl.touchstart({ touches: [{ identifier: 0, clientX: X, clientY: Y, pageX: X, pageY: Y }] });
    await dayEl.touchmove({ touches: [{ identifier: 0, clientX: X - 80, clientY: Y, pageX: X - 80, pageY: Y }] });
    const shotDay = await shot(mp, '03-day-view');
    await dayEl.touchend({ touches: [], changedTouches: [{ identifier: 0, clientX: X - 80, clientY: Y, pageX: X - 80, pageY: Y }] });
    await sleep(700);
    d = await pageData(mp);
    check('日视图左滑 → 下一周（' + wkDay0 + '→' + d.wk + '）', d.wk === wkDay0 + 1, 'wk=' + d.wk);
    const pBack = await mp.currentPage();
    const segs2 = await pBack.$$('.ttseg .seg');
    if (segs2.length === 2) { await segs2[0].tap(); await sleep(650); }
    d = await pageData(mp);
    check('点回周视图', d.view === 'week', 'view=' + d.view);

    /* ---------- 7. 短滑后 320ms 抑制点击；过期后课程卡点击仍能打开详情 ---------- */
    d = await ensureTtWeek(mp);
    d = await injectWeekend(mp);
    await sleep(360);
    await swipeOn(mp, -30, 0);                    // 已 touchstart + touchmove（未松手）
    const pT = await mp.currentPage();
    const elT = await pT.$('.tscroll');
    const XT = 285, YT = 330;
    await elT.touchend({ touches: [], changedTouches: [{ identifier: 0, clientX: XT - 30, clientY: YT, pageX: XT - 30, pageY: YT }] });
    const holdT = await pageData(mp);             // 松手后立即采样：仍在 320ms 抑制期内
    check('短滑（-30px）后进入 320ms 点击抑制期', holdT.supTap > holdT.now, 'supTap=' + holdT.supTap + ' at=' + holdT.now);
    let cs = await pT.$$('.crs');
    if (cs.length) await cs[0].tap();             // 抑制期内立刻点课程卡
    d = await pageData(mp);
    check('抑制期内点课程卡不弹详情', d.showDetail !== true, 'showDetail=' + d.showDetail);
    await sleep(420);
    const pT2 = await mp.currentPage();
    cs = await pT2.$$('.crs');
    if (cs.length) { await cs[0].tap(); await sleep(500); }
    d = await pageData(mp);
    check('抑制期结束后点课程卡正常打开详情（点击不失灵）', d.showDetail === true && !!d.detailName, 'detail=' + d.detailName);
    await mp.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.closeDetail && pg.closeDetail(); });
    await sleep(300);

    /* ---------- 8. 结论 ---------- */
    check('全程 0 console error / exception', consoleIssues.length === 0, JSON.stringify(consoleIssues.slice(0, 3)));
    const report = {
      at: new Date().toISOString(), windowWidth: winW, windowHeight: info.h || 0,
      checks: checks, consoleIssues: consoleIssues,
      screenshots: [shot5, shot6, shot7, shotDay, shotSwipe].filter(Boolean)
    };
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log('\n============ tt fit/swipe preview: ' + passN + ' PASS / ' + failN + ' FAIL / ' + consoleIssues.length + ' console error；windowWidth=' + winW + ' ============');
    console.log('screenshots: ' + report.screenshots.join(', '));
    process.exitCode = failN || consoleIssues.length ? 2 : 0;
  } finally {
    try { await mp.disconnect(); } catch (e) { /* ignore */ }
  }
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
