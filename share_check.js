/* share_check.js —— 微信原生分享接入回归（17 页）
 *
 * 验证目标：每个页面的「右上角 ··· → 转发 / 分享到朋友圈」都能拿到内容：
 *   - onShareAppMessage() 返回 { title, path, imageUrl }，path 指向本页、imageUrl 是代码包内 5:4 封面；
 *   - onShareTimeline() 返回 { title, query, imageUrl }；
 *   - onShow 里调用的 wx.showShareMenu 带 menus（shareAppMessage + shareTimeline）；
 *   - 课表页分享 path 带当前周次（?wk=N），打开即定位到该周。
 *
 * 前置：开发者工具 `cli.bat auto --project ... --auto-port 9420 --trust-project`
 * 用法：node share_check.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const ROOT = 'C:/Users/Ko_Li/.openclaw/workspace/mp-class-tools';
const OUT = path.join(__dirname, '_shots', 'share');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const consoleIssues = [];

function check(name, ok, detail) {
  checks.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 300) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}
async function curPage(mp) { try { return await mp.currentPage(); } catch (e) { return null; } }
async function curPath(mp) { const p = await curPage(mp); return p ? p.path : ''; }
// 等待页面真正切换完成（开发者工具在编译/资源多时 switchTab/navigateTo 会滞后）
async function waitPath(mp, expect, timeout) {
  const end = Date.now() + (timeout || 9000);
  while (Date.now() < end) {
    if ((await curPath(mp)) === expect) return true;
    await sleep(200);
  }
  return false;
}
function routeOf(url) { return String(url || '').replace(/^\//, '').split('?')[0]; }
// 从工作台打开一个非 tab 页，并等它真正成为栈顶（开发者工具偶发路由超时：重试 / 退化为 reLaunch）
async function openPage(mp, url) {
  for (let i = 0; i < 3; i++) {
    try { await mp.reLaunch('/pages/index/index'); break; } catch (e) { await sleep(1200); }
  }
  await waitPath(mp, 'pages/index/index', 9000);
  await sleep(300);
  let ok = false;
  for (let i = 0; i < 3 && !ok; i++) {
    try { await mp.navigateTo(url); ok = true; } catch (e) {
      await sleep(1200);
      try { await mp.reLaunch(url); ok = true; } catch (e2) { /* retry */ }
    }
  }
  await waitPath(mp, routeOf(url), 12000);
  await sleep(400);
}
async function shot(mp, name) {
  try { await mp.screenshot({ path: path.join(OUT, name + '.png') }); } catch (e) { /* ignore */ }
}
function imgExists(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.indexOf('/images/share/') !== 0) return false;
  return fs.existsSync(path.join(ROOT, url.slice(1)));
}
// 开发者工具偶发 context 无响应：evaluate 统一重试
async function ev(mp, fn, arg, tries) {
  let last = null;
  const n = tries || 4;
  for (let i = 0; i < n; i++) {
    try { return await mp.evaluate(fn, arg); } catch (e) { last = e; await sleep(1500); }
  }
  throw last;
}
async function shareOf(mp) {
  try {
    return await ev(mp, () => {
      const pages = getCurrentPages();
      const pg = pages[pages.length - 1];
      if (!pg) return { err: 'no-page' };
      const msg = typeof pg.onShareAppMessage === 'function' ? pg.onShareAppMessage() : null;
      const tl = typeof pg.onShareTimeline === 'function' ? pg.onShareTimeline() : null;
      return { path: pg.route, msg: msg, tl: tl };
    });
  } catch (e) {
    return { err: String(e && e.message || e) };
  }
}
function checkShare(label, data, expectPath) {
  const m = data && data.msg;
  const t = data && data.tl;
  const okMsg = !!(m && m.title && m.path && m.path.indexOf(expectPath) === 0 && imgExists(m.imageUrl));
  check(label + ' · 转发卡片（title/path/imageUrl）', okMsg, m && JSON.stringify(m));
  const okTl = !!(t && t.title && t.imageUrl && imgExists(t.imageUrl) && (typeof t.query === 'string'));
  check(label + ' · 朋友圈卡片（title/query/imageUrl）', okTl, t && JSON.stringify(t));
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  mp.on('exception', (e) => consoleIssues.push('exception: ' + JSON.stringify(e).slice(0, 400)));
  mp.on('console', (e) => { if (e && e.type === 'error') consoleIssues.push('error: ' + (e.args || []).map(String).join(' ').slice(0, 400)); });

  // 等开发者工具 context 就绪（刚重编译/启动时会有一小段无响应）
  await sleep(2500);
  for (let i = 0; i < 8; i++) {
    try { await mp.systemInfo(); break; } catch (e) { await sleep(1500); }
  }

  // hook wx.showShareMenu（在任何页面 onShow 之前，记录原生分享菜单参数）
  await ev(mp, () => {
    wx.__shareCall = null;
    try {
      const orig = wx.__origShowShareMenu || wx.showShareMenu;
      wx.__origShowShareMenu = orig;
      wx.showShareMenu = function (o) { wx.__shareCall = wx.__shareCall || (o || {}); try { if (orig) return orig.call(wx, o); } catch (e) {} };
    } catch (e) { /* ignore */ }
  });

  /* ---------- 0. 身份验证（真实验证，只读 RPC）---------- */
  await ev(mp, () => {
    try { wx.clearStorageSync(); } catch (e) {}
    try { require('utils/store.js').reset(); } catch (e) {}
    try { require('utils/flow.js').clearFlow(); } catch (e) {}
  });
  let p = await mp.reLaunch('/pages/identity/identity');
  await sleep(900);
  p = await curPage(mp);
  const inputs = p ? await p.$$('input') : [];
  if (inputs.length >= 2) {
    await inputs[0].input('测试账号'); await sleep(150);
    await inputs[1].input('3260799999'); await sleep(250);
  }
  await ev(mp, () => { const ps = getCurrentPages(); const pg = ps[ps.length - 1]; if (pg && pg.submit) pg.submit(); });
  for (let i = 0; i < 30; i++) { await sleep(300); if ((await curPath(mp)) === 'pages/index/index') break; }
  await sleep(700);
  check('身份验证后进入工作台', (await curPath(mp)) === 'pages/index/index', await curPath(mp));

  /* ---------- 0b. 原生分享菜单参数 ---------- */
  const menuOpt = await ev(mp, () => wx.__shareCall);
  check('onShow 调用 wx.showShareMenu（menus = 转发 + 朋友圈）',
    !!(menuOpt && Array.isArray(menuOpt.menus) && menuOpt.menus.indexOf('shareAppMessage') >= 0 && menuOpt.menus.indexOf('shareTimeline') >= 0),
    menuOpt && JSON.stringify(menuOpt));

  /* ---------- 1. 三个 tab 页 ---------- */
  const tabs = [
    ['/pages/index/index', '工作台', 'pages/index/index', '/pages/share/index.png'],
    ['/pages/all/all', '工具', 'pages/all/all', '/images/share/default.png'],
    ['/pages/me/me', '我的', 'pages/me/me', '/images/share/default.png']
  ];
  for (const [url, label, route, img] of tabs) {
    try {
      p = await mp.switchTab(url);
      await waitPath(mp, route, 12000);
      await sleep(300);
    } catch (e) {
      check(label + '（tab）可打开', false, 'devtools 路由异常：' + e.message);
      continue;
    }
    const data = await shareOf(mp);
    check(label + '（tab）分享数据来自本页', (data && data.path === route), data && data.path);
    checkShare(label, data, '/' + route);
    await shot(mp, 'tab-' + label);
  }

  /* ---------- 2. 其余页面（navigateTo）---------- */
  const pages = [
    ['/pages/tt/tt?wk=10', '课表'],
    ['/pages/draw/draw', '抽签'],
    ['/pages/group/group', '分组'],
    ['/pages/sum/sum', '结果单'],
    ['/pages/hw/hw', '作业板'],
    ['/pages/nt/nt', '班级通知'],
    ['/pages/ft/ft', '体测'],
    ['/pages/fttable/fttable', '国标表'],
    ['/pages/roll/roll', '点名'],
    ['/pages/committee/committee', '班委'],
    ['/pages/stats/stats', '统计'],
    ['/pages/fb/fb', '反馈建议'],
    ['/pages/ug/ug', '使用说明']
  ];
  for (const [url, label] of pages) {
    try { await openPage(mp, url); } catch (e) {
      check(label + ' 页面可打开', false, e.message); continue;
    }
    const data = await shareOf(mp);
    const route = (data && data.path) || '';
    check(label + ' 分享数据来自本页', route === routeOf(url), route + ' / expect ' + routeOf(url));
    checkShare(label, data, '/' + route);
  }

  /* ---------- 2b. 课表：wk 参数 + 分享带周次 ---------- */
  try {
    await openPage(mp, '/pages/tt/tt?wk=10');
    await sleep(900);
    const ttWk = await ev(mp, () => {
      const pg = getCurrentPages()[getCurrentPages().length - 1];
      return { wk: pg.data.wk, msg: pg.onShareAppMessage(), tl: pg.onShareTimeline() };
    });
    check('课表 ?wk=10 打开即第 10 周', ttWk && ttWk.wk === 10, JSON.stringify({ wk: ttWk && ttWk.wk }));
    check('课表分享 path 带当前周次', !!(ttWk && ttWk.msg && ttWk.msg.path === '/pages/tt/tt?wk=10' && ttWk.msg.title.indexOf('第 10 周') >= 0), ttWk && JSON.stringify(ttWk.msg));
    check('课表分享朋友圈 query 带当前周次', !!(ttWk && ttWk.tl && ttWk.tl.query === 'wk=10'), ttWk && JSON.stringify(ttWk.tl));
  } catch (e) {
    check('课表 ?wk=10 分享回归', false, 'devtools 路由异常：' + e.message);
  }

  /* ---------- 2c. 通知 / 班委：动态标题 ---------- */
  try {
    await openPage(mp, '/pages/nt/nt');
    await sleep(900);
    const ntShare = await shareOf(mp);
    check('通知分享标题带最新通知（或通用兜底）', !!(ntShare && ntShare.msg && ntShare.msg.title.indexOf('班级通知｜') === 0), ntShare && JSON.stringify(ntShare.msg));

    await openPage(mp, '/pages/committee/committee');
    await sleep(700);
    const bzShare = await shareOf(mp);
    check('班委分享标题带班委人数', !!(bzShare && bzShare.msg && /班委名单｜\d+ 名班委/.test(bzShare.msg.title)), bzShare && JSON.stringify(bzShare.msg));
  } catch (e) {
    check('通知 / 班委动态标题回归', false, 'devtools 路由异常：' + e.message);
  }

  /* ---------- 3. 身份页（启动页，清身份后仍是表单，可直接取分享数据）---------- */
  try {
    const savedId = await ev(mp, () => {
      try {
        const raw = wx.getStorageSync('zq_class_identity');
        return raw ? (typeof raw === 'string' ? raw : JSON.stringify(raw)) : '';
      } catch (e) { return ''; }
    });
    await ev(mp, () => { try { require('utils/identity.js').clear(); } catch (e) {} });
    p = await mp.reLaunch('/pages/identity/identity');
    await waitPath(mp, 'pages/identity/identity', 9000);
    await sleep(500);
    const idShare = await shareOf(mp);
    check('身份页分享数据可用', !!(idShare && idShare.msg && idShare.msg.title && idShare.msg.path === '/pages/identity/identity'), idShare && JSON.stringify(idShare.msg));
    checkShare('身份页', idShare, '/pages/identity/identity');
    // 恢复身份（不清除用户在本机模拟器里的登录状态）
    if (savedId) await ev(mp, (raw) => { try { wx.setStorageSync('zq_class_identity', raw); } catch (e) {} }, savedId);
  } catch (e) {
    check('身份页分享回归', false, 'devtools 路由异常：' + e.message);
  }

  /* ---------- 4. 收尾 ---------- */
  await ev(mp, () => {
    wx.__shareCall = null;
    try { if (wx.__origShowShareMenu) wx.showShareMenu = wx.__origShowShareMenu; } catch (e) {}
    try { wx.clearStorageSync(); } catch (e) {}
    try { require('utils/store.js').reset(); } catch (e) {}
    try { require('utils/flow.js').clearFlow(); } catch (e) {}
  });

  const pass = checks.filter((c) => c.ok).length;
  const fail = checks.length - pass;
  fs.writeFileSync(path.join(__dirname, 'share-result.json'), JSON.stringify({
    at: new Date().toISOString(), pass: pass, fail: fail, checks: checks, consoleIssues: consoleIssues
  }, null, 2), 'utf8');
  console.log('\n============ ' + pass + ' passed, ' + fail + ' failed ============');
  console.log('console errors/exceptions =', consoleIssues.length);
  if (consoleIssues.length) console.log(JSON.stringify(consoleIssues.slice(0, 8), null, 2));
  await mp.disconnect();
  process.exit(fail || consoleIssues.length ? 2 : 0);
})().catch((e) => { console.error('SHARE CHECK FATAL', e); process.exit(1); });
