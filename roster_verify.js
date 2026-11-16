/* roster_verify.js —— 独立验收：小程序「班级名单选择器 + M3 简约气泡」(v1.4.2)
 *
 * 前置：微信开发者工具 automator 端口 9420
 *   & "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto --project "C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools" --auto-port 9420 --trust-project
 * 用法：node roster_verify.js    （可用 ROSTER_WS=ws://127.0.0.1:<port> 指定）
 *
 * 独立于实现者的 roster_preview.js：
 *   - 真实班级身份登录（class_verify 只读 RPC）→ class_members 70 人；
 *   - 旧数据迁移端到端：写入真实成员前 3 人的旧格式文本（roster/group.names/rollNames/rollSt + 1 个不存在姓名）
 *     → 重进页面 → 断言只保留真实座号、到/假按姓名保留、旧文本收敛；
 *   - 功能：70 气泡 / 全选 / 清空 / 取消不写回 / 确定、抽签语义（选名单才限池 / 超池报错 / 未选只抽序号）、
 *     分组班级名单 5 人、点名沿用抽签名单 + 改选按姓名保留；
 *   - 截图到 _shots/roster_verify/（含真实姓名，仅留在测试目录，不外发）；
 *   - 结果写 roster_verify_result.json；console error/exception 必须为 0。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const ROOT = __dirname;
const MP = path.join(ROOT, '..', 'mp-class-tools');
const OUT = path.join(ROOT, '_shots', 'roster_verify');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const consoleIssues = [];

function check(name, ok, detail) {
  checks.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 400) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail != null && detail !== '' ? ' :: ' + String(detail).slice(0, 240) : ''));
}

async function connect() {
  const ep = process.env.ROSTER_WS || 'ws://127.0.0.1:9420';
  let last = null;
  for (let i = 0; i < 4; i++) {
    try { return await automator.connect({ wsEndpoint: ep }); } catch (e) { last = e; await sleep(1500); }
  }
  throw last;
}

async function curPath(mp) {
  try { const p = await mp.currentPage(); return p ? p.path : ''; } catch (e) { return ''; }
}
async function waitPath(mp, want, timeoutMs) {
  const limit = Date.now() + (timeoutMs || 8000);
  while (Date.now() < limit) {
    if ((await curPath(mp)) === want) return true;
    await sleep(180);
  }
  return false;
}
async function shot(mp, name) {
  const file = path.join(OUT, name + '.png');
  for (let i = 0; i < 4; i++) {
    try { await mp.screenshot({ path: file }); } catch (e) { /* ignore */ }
    try { if (fs.statSync(file).size > 2000) return true; } catch (e) { /* ignore */ }
    await sleep(600);
  }
  return false;
}
async function appNavigate(mp, url, method) {
  try {
    await mp.evaluate((u, m) => { try { wx[m]({ url: u }); } catch (e) { /* ignore */ } }, url, method || 'reLaunch');
  } catch (e) { /* ignore */ }
}
async function pageData(mp) {
  return mp.evaluate(() => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    if (!pg) return null;
    return { route: pg.route, data: JSON.parse(JSON.stringify(pg.data || {})) };
  });
}
async function storeState(mp) {
  return mp.evaluate(() => {
    try {
      const d = require('utils/store.js').get();
      return {
        classMembers: (d.classMembers || []).length,
        rosterSel: (d.rosterSel || []).length,
        groupSel: (d.group && d.group.sel || []).length,
        rollSel: (d.rollSel || []).length,
        rosterLines: String(d.roster || '').split('\n').filter(Boolean).length,
        rollLines: String(d.rollNames || '').split('\n').filter(Boolean).length,
        rollSt: Object.keys(d.rollSt || {}).length,
        selVer: d.selVer
      };
    } catch (e) { return { err: String(e && e.message || e) }; }
  });
}
async function storeSnapshot(mp) {
  return mp.evaluate(() => {
    const d = require('utils/store.js').get();
    return {
      rosterSel: (d.rosterSel || []).slice(),
      roster: String(d.roster || ''),
      groupSel: (d.group && d.group.sel || []).slice(),
      groupNames: String(d.group && d.group.names || ''),
      groupSource: String(d.group && d.group.source || ''),
      rollSel: (d.rollSel || []).slice(),
      rollNames: String(d.rollNames || ''),
      rollSt: JSON.parse(JSON.stringify(d.rollSt || {})),
      selVer: d.selVer,
      classRoster: String(d.classRoster || '')
    };
  });
}
async function pickerState(mp) {
  return mp.evaluate(() => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    const c = pg && pg.selectComponent ? pg.selectComponent('#rosterPicker') : null;
    if (!c) return { err: 'no-picker' };
    const d = c.data || {};
    const map = d.selMap || {};
    return {
      show: !!d.show, items: (d.items || []).length, total: d.total || 0, count: d.count || 0,
      loading: !!d.loading, failed: !!d.failed,
      selKeys: Object.keys(map).filter(function (k) { return map[k]; }).length,
      first: (d.items || []).slice(0, 2).map(function (it) { return { seat: it.seat, name: it.name }; })
    };
  });
}
async function callPage(mp, method, arg) {
  return mp.evaluate((m, a) => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    if (!pg || typeof pg[m] !== 'function') return 'no-method:' + m;
    pg[m](a == null ? undefined : a);
    return 'ok';
  }, method, arg == null ? null : arg);
}
async function callPicker(mp, method) {
  return mp.evaluate((m) => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    const c = pg && pg.selectComponent ? pg.selectComponent('#rosterPicker') : null;
    if (!c) return 'no-picker';
    if (typeof c[m] !== 'function') return 'no-method:' + m;
    c[m]();
    return 'ok';
  }, method);
}
async function pickerSeats(mp) {
  return mp.evaluate(() => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    const c = pg && pg.selectComponent ? pg.selectComponent('#rosterPicker') : null;
    if (!c) return [];
    return (c.data.items || []).map(function (it) { return it.seat; });
  });
}
async function toggleSeat(mp, seat) {
  return mp.evaluate((s) => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    const c = pg && pg.selectComponent ? pg.selectComponent('#rosterPicker') : null;
    if (!c) return 'no-picker';
    c.toggleSeat({ currentTarget: { dataset: { seat: s } } });
    return 'ok';
  }, seat);
}
async function connectToastSpy(mp) {
  await mp.evaluate(() => {
    if (wx.__verifyToastWrapped) return;
    const orig = wx.showToast.bind(wx);
    wx.__toastLog = [];
    wx.showToast = function (opts) {
      try { wx.__toastLog.push(String((opts && opts.title) || '')); } catch (e) { /* ignore */ }
      return orig(opts);
    };
    wx.__verifyToastWrapped = 1;
  });
}
async function clearToast(mp) { await mp.evaluate(() => { wx.__toastLog = []; }); }
async function readToast(mp) {
  return mp.evaluate(() => (wx.__toastLog || []).join(' | '));
}
async function confirmPicker(mp) { await callPicker(mp, 'confirm'); await sleep(500); }

// 真实身份登录（class_verify 只读）；本机无身份时填表提交
async function login(mp) {
  if ((await curPath(mp)) !== 'pages/identity/identity') {
    await appNavigate(mp, '/pages/identity/identity', 'reLaunch');
    await waitPath(mp, 'pages/identity/identity', 7000);
  }
  await sleep(700);
  const p = await mp.currentPage();
  const inputs = p ? await p.$$('input') : [];
  if (inputs.length >= 2) {
    await inputs[0].input('测试账号'); await sleep(150);
    await inputs[1].input('3260799999'); await sleep(250);
  }
  await mp.evaluate(() => { const ps = getCurrentPages(); const pg = ps[ps.length - 1]; if (pg && pg.submit) pg.submit(); });
  return waitPath(mp, 'pages/index/index', 18000);
}
async function goto(mp, url, want) {
  const target = want || url.replace(/^\//, '');
  for (let i = 0; i < 3; i++) {
    if ((await curPath(mp)) === target) return true;
    if ((await curPath(mp)) === 'pages/identity/identity') { await login(mp); }
    await appNavigate(mp, url, 'reLaunch');
    if (await waitPath(mp, target, 9000)) return true;
    await appNavigate(mp, url, 'navigateTo');
    if (await waitPath(mp, target, 6000)) return true;
  }
  return false;
}
async function ensureMembers(mp) {
  await mp.evaluate(() => { try { require('utils/cloud.js').ensureMembers(true); } catch (e) { /* ignore */ } });
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    const st = await storeState(mp);
    if (st.classMembers === 70) return st;
    await sleep(400);
  }
  return storeState(mp);
}
// 强制重进某页：先离开目标页再 reLaunch（否则 waitPath 会立刻匹配到旧页面，读到 stale page data）
async function reloadPage(mp, url, want) {
  const target = want || url.replace(/^\//, '');
  for (let i = 0; i < 3; i++) {
    if ((await curPath(mp)) === 'pages/identity/identity') { await login(mp); }
    if ((await curPath(mp)) === target) {
      await appNavigate(mp, '/pages/index/index', 'reLaunch');
      await waitPath(mp, 'pages/index/index', 7000);
    }
    await appNavigate(mp, url, 'reLaunch');
    if (await waitPath(mp, target, 8000)) return true;
    await sleep(400);
  }
  return false;
}
// 页面方法调用（失败返回字符串而不是抛异常，避免一次环境干扰直接中断整个验收）
async function drawWithCount(mp, count) {
  return mp.evaluate((c) => {
    try {
      const ps = getCurrentPages();
      const pg = ps[ps.length - 1];
      if (!pg || pg.route !== 'pages/draw/draw') return 'bad-page:' + (pg && pg.route);
      if (typeof pg.doDraw !== 'function') return 'no-method';
      pg.setData({ count: c });
      pg.doDraw();
      return 'ok';
    } catch (e) { return 'ERR:' + (e && e.message); }
  }, count);
}
function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ---------------------------------------------------------------- 静态检查（读源码）
function staticChecks() {
  const read = (p) => { try { return fs.readFileSync(path.join(MP, p), 'utf8'); } catch (e) { return ''; } };
  const pages = ['pages/draw/draw', 'pages/group/group', 'pages/roll/roll'];
  let noTextarea = true, noPaste = true, regOk = true, detail = '';
  pages.forEach((p) => {
    const wxml = read(p + '.wxml');
    const js = read(p + '.js');
    const json = read(p + '.json');
    if (/<textarea/i.test(wxml)) { noTextarea = false; detail += p + ':textarea '; }
    if (/粘贴|pasteRoster|importRoster|id="aRoster"|id="rNames"/i.test(wxml)) { noPaste = false; detail += p + ':paste '; }
    if (/onRosterInput|rosterPaste|importClassRoster|updateCloudRoster/.test(js)) { noPaste = false; detail += p + ':js-paste '; }
    try {
      const j = JSON.parse(json);
      if (!j.usingComponents || !j.usingComponents['roster-picker']) { regOk = false; detail += p + ':no-comp '; }
    } catch (e) { regOk = false; detail += p + ':json '; }
  });
  check('静态：三页 wxml 无名单 textarea / 粘贴 / 导入', noTextarea && noPaste, detail);
  check('静态：三页 json 注册 roster-picker 组件', regOk, detail);
  const compJs = read('components/roster-picker/index.js');
  const compWxml = read('components/roster-picker/index.wxml');
  const compWxss = read('components/roster-picker/index.wxss');
  check('静态：选择器含 全选/清空/取消/确定 与 计数 N/70',
    /selectAll/.test(compJs) && /clearAll/.test(compJs) && /cancel/.test(compJs) && /confirm/.test(compJs)
    && /count/.test(compWxml) && /total/.test(compWxml) && /rst-b|lp-b/.test(compWxml));
  const appWxss = read('app.wxss');
  // 1.4.2 视觉简化：名单气泡改 M3 简约 selected chip（未选 lowest 底 + outline 边；
  // 已选 primary-container 底 + primary 边 + on-primary-container 字），无渐变 / 高光 / 浮动 / 弹跳 / 重阴影。
  const lpIdx = appWxss.indexOf('.lp-bubble');
  const lpCss = lpIdx >= 0 ? appWxss.slice(lpIdx) : '';
  check('静态：名单气泡 M3 简约 chip（未选 lowest 底 + outline 边；已选 primary-container 底 + primary 边）',
    /background:\s*var\(--md-surface-container-lowest\)/.test(lpCss)
    && /border:\s*1rpx solid var\(--md-outline-variant\)/.test(lpCss)
    && /\.lp-bubble--sel\s*\{[^}]*background:\s*var\(--md-primary-container\)/.test(lpCss)
    && /\.lp-bubble--sel\s*\{[^}]*border-color:\s*var\(--md-primary\)/.test(lpCss)
    && /\.lp-bubble--sel\s*\{[^}]*color:\s*var\(--md-on-primary-container\)/.test(lpCss)
    && /\.lp-chip\s*\{[^}]*background:\s*var\(--md-primary-container\)/.test(lpCss),
    'lpCss=' + lpCss.slice(0, 160));
  check('静态：气泡无渐变 / 高光 / 浮动 / 弹跳（动画冗余已清除）',
    !/linear-gradient/.test(lpCss) && !/radial-gradient/.test(lpCss) && !/::after/.test(lpCss)
    && !/@keyframes lpFloat/.test(appWxss) && !/lp-float/.test(appWxss) && !/lpPop|lp-bubble--pop/.test(appWxss),
    [ /linear-gradient/.test(lpCss), /radial-gradient/.test(lpCss), /::after/.test(lpCss),
      /@keyframes lpFloat/.test(appWxss), /lp-float/.test(appWxss), /lpPop/.test(appWxss) ].join(','));
  check('静态：按压仅 scale(.97) + 120ms transition',
    /\.lp-bubble--press\s*\{\s*transform:\s*scale\(\.97\)/.test(lpCss) && /transition:[^;]*120ms/.test(lpCss),
    JSON.stringify({ press: /scale\(\.97\)/.test(lpCss), trans: /120ms/.test(lpCss) }));
  check('静态：选择器 wxml 无 lp-float 外壳 / 内联动画参数',
    !/lp-float/.test(compWxml) && !/animation-duration|animation-delay/.test(compWxml), '');
  check('静态：暗色模式适配（prefers-color-scheme: dark）',
    /prefers-color-scheme:\s*dark/.test(appWxss) || /prefers-color-scheme:\s*dark/.test(compWxss));
  const allFiles = [];
  const walk = (rel) => {
    const abs = path.join(MP, rel);
    fs.readdirSync(abs, { withFileTypes: true }).forEach((d) => {
      const r = rel + '/' + d.name;
      if (d.isDirectory()) { if (!/node_modules|miniprogram_npm|\.git/.test(r)) walk(r); }
      else allFiles.push(r);
    });
  };
  try { walk('.'); } catch (e) { /* ignore */ }
  check('静态：无 npm/CDN/web-view 依赖（cloudfunctions 的 package.json 除外）',
    allFiles.every((f) => !f.startsWith('miniprogram_npm/') && f.indexOf('/miniprogram_npm/') < 0)
    && allFiles.every((f) => !/^node_modules\//.test(f) && !/\/node_modules\//.test(f))
    && !/miniprogram_npm\/|require\(['"]@/.test(read('app.js') + read('app.json'))
    && !allFiles.some((f) => /\.wxml$/.test(f) && /<web-view/i.test(read(f)))
    && !allFiles.some((f) => /^pages\/|^components\/|^utils\/|^miniapp\//.test(f)
      && /https?:\/\/(fonts\.googleapis|cdn\.|unpkg|jsdelivr|cdnjs)/i.test(read(f))));
  return { files: allFiles.length };
}

// ---------------------------------------------------------------- 主流程
(async () => {
  const t0 = Date.now();
  const staticInfo = staticChecks();
  const mp = await connect();
  mp.on('exception', (e) => consoleIssues.push('exception: ' + JSON.stringify(e).slice(0, 500)));
  mp.on('console', (e) => {
    if (e && e.type === 'error') consoleIssues.push('console.error: ' + (e.args || []).map(String).join(' ').slice(0, 500));
  });
  await connectToastSpy(mp);

  /* ---------- 0. 清本机数据 + 真实身份 class_verify（只读） ---------- */
  await mp.evaluate(() => {
    try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
    try { require('utils/store.js').reset(); } catch (e) { /* ignore */ }
    try { require('utils/flow.js').clearFlow(); } catch (e) { /* ignore */ }
  });
  const logged = await login(mp);
  check('真实身份 class_verify 后进入工作台', logged, await curPath(mp));
  await sleep(900);
  let st = await ensureMembers(mp);
  check('class_members 同步 70 人', st.classMembers === 70, JSON.stringify(st));
  if (st.classMembers !== 70) {
    // 环境不允许继续动态断言时也要给 result JSON 说明
    console.log('WARN 真实名单未就绪，退出动态流程');
  }

  /* ---------- 1. 旧数据迁移端到端（真实成员前 3 人） ---------- */
  const mem3 = await mp.evaluate(() => {
    const r = require('utils/roster.js').members().slice(0, 3);
    return r.map(function (m) { return { seat: m.seat, name: m.name }; });
  });
  const seats = mem3.map((m) => m.seat);
  const names = mem3.map((m) => m.name);
  const sortedSeats = seats.slice().sort((a, b) => a - b);
  const sortedNames = sortedSeats.map((s) => names[seats.indexOf(s)]);
  const pairOf = (i, j) => { // 两个座号按升序
    const arr = [{ s: seats[i], n: names[i] }, { s: seats[j], n: names[j] }].sort((a, b) => a.s - b.s);
    return { seats: arr.map((x) => x.s), names: arr.map((x) => x.n) };
  };
  const groupPair = pairOf(2, 0);
  const oldWrite = await mp.evaluate((ms) => {
    try {
      const store = require('utils/store.js');
      const d = JSON.parse(JSON.stringify(store.get()));
      d.rosterSel = []; d.rollSel = [];
      d.roster = ms[0].seat + ' ' + ms[0].name + '\n' + ms[1].seat + ' ' + ms[1].name + '\n查无此人';
      d.rollNames = ms[1].name + '\n' + ms[0].name + '\n查无此人';
      d.rollSt = { 0: 'in', 1: 'ab' };
      d.group = Object.assign({}, d.group, {
        sel: [], names: ms[2].name + '\n' + ms[0].name + '\n查无此人',
        source: 'paste', mode: 'groups', n: 4, shuffle: false
      });
      d.classRoster = '旧云端名单文本';
      d.selVer = 0;
      wx.setStorageSync('zq_tools_v2', JSON.stringify(d));
      store.reload();
      return 'ok';
    } catch (e) { return 'ERR:' + (e && e.message); }
  }, mem3);
  check('迁移前置：写入旧格式 zq_tools_v2（2 合法姓名 + 1 不存在）', oldWrite === 'ok', oldWrite);
  check('迁移前置：进入抽签页触发 onShow 迁移', await goto(mp, '/pages/draw/draw', 'pages/draw/draw'), await curPath(mp));
  await sleep(900);
  const rosterPair = pairOf(0, 1);
  const rollPair = pairOf(1, 0);
  let snap = await storeSnapshot(mp);
  check('迁移：旧 roster → rosterSel 只保留真实座号（升序）', sameJson(snap.rosterSel, rosterPair.seats), JSON.stringify(snap.rosterSel) + ' want ' + JSON.stringify(rosterPair.seats));
  check('迁移：派生 roster 文本收敛为「座号 姓名」，不存在姓名被丢弃',
    snap.roster === rosterPair.seats.map((s, i) => s + ' ' + rosterPair.names[i]).join('\n'), JSON.stringify(snap.roster));
  check('迁移：旧 group.names → group.sel 只保留真实座号、source=paste→pick',
    sameJson(snap.groupSel, groupPair.seats) && snap.groupSource === 'pick',
    JSON.stringify(snap.groupSel) + ' / ' + snap.groupSource);
  check('迁移：旧 group.names 收敛（2 姓名，无不存在姓名）',
    snap.groupNames === groupPair.names.join('\n'), JSON.stringify(snap.groupNames));
  check('迁移：旧 rollNames → rollSel 真实座号；派生带座号', sameJson(snap.rollSel, rollPair.seats), JSON.stringify(snap.rollSel));
  const rollExpectedSt = {}; // 旧下标 0=names[1]→in, 1=names[0]→ab；新下标按座号升序
  rollPair.seats.forEach((s, i) => {
    if (s === seats[1]) rollExpectedSt[i] = 'in';
    if (s === seats[0]) rollExpectedSt[i] = 'ab';
  });
  check('迁移：点名到/假按姓名保留并重排下标', sameJson(snap.rollSt, rollExpectedSt),
    JSON.stringify(snap.rollSt) + ' want ' + JSON.stringify(rollExpectedSt));
  check('迁移：selVer=1（幂等标记）', snap.selVer === 1, snap.selVer);
  check('迁移：旧 classRoster 不再参与名单（旧文本不出现于派生字段）',
    !snap.roster.includes('旧云端') && !snap.classRoster.includes('查无此人'));

  /* ---------- 2. 重置为干净状态，恢复 70 人名单 ---------- */
  await mp.evaluate(() => {
    try { require('utils/store.js').reset(); } catch (e) { /* ignore */ }
    try { require('utils/flow.js').clearFlow(); } catch (e) { /* ignore */ }
  });
  st = await ensureMembers(mp);
  check('重置后重新同步 class_members 70 人', st.classMembers === 70, JSON.stringify(st));
  check('回到抽签页（强制重进，页面 data 重新加载）', await reloadPage(mp, '/pages/draw/draw', 'pages/draw/draw'), await curPath(mp));
  await sleep(900);

  /* ---------- 3. 抽签页：弹层 70 气泡 / 全选 / 确定 / 抽签 ---------- */
  let pd = await pageData(mp);
  check('抽签页默认未选名单（selCount=0）', pd && pd.data.selCount === 0, JSON.stringify(pd && pd.data && { selCount: pd.data.selCount }));
  await callPage(mp, 'openPicker'); await sleep(700);
  let ps = await pickerState(mp);
  check('选择名单弹层打开：70 气泡 / 总数 70 / 初始 0', ps.items === 70 && ps.total === 70 && ps.count === 0, JSON.stringify(ps));
  check('气泡含姓名与小号座号（首项）', ps.first.length === 2 && !!ps.first[0].name && ps.first[0].seat > 0, JSON.stringify(ps.first));
  await shot(mp, '01-picker-empty');
  await callPicker(mp, 'selectAll'); await sleep(350);
  ps = await pickerState(mp);
  check('一键全选 → 计数 70/70', ps.count === 70 && ps.selKeys === 70, JSON.stringify(ps));
  await shot(mp, '02-picker-all');
  await confirmPicker(mp);
  pd = await pageData(mp);
  check('确定后弹层关闭、页面已选 70 人', !!(pd && pd.data.selCount === 70 && pd.data.picker === false),
    JSON.stringify(pd && pd.data && { selCount: pd.data.selCount, picker: pd.data.picker }));
  check('页面摘要气泡 8 个 + 「+62」', !!(pd && (pd.data.selChips || []).length === 8 && pd.data.selMore === 62),
    JSON.stringify(pd && pd.data && { chips: (pd.data.selChips || []).length, more: pd.data.selMore }));
  st = await storeState(mp);
  check('store：rosterSel=70 / roster 派生 70 行', st.rosterSel === 70 && st.rosterLines === 70, JSON.stringify(st));
  await shot(mp, '03-draw-selected');
  await callPage(mp, 'doDraw'); await sleep(1100);
  pd = await pageData(mp);
  const rows = (pd && pd.data.rows) || [];
  check('抽签 10 个结果全部带姓名', rows.length === 10 && rows.filter((r) => !!r.nm).length === 10,
    JSON.stringify({ n: rows.length, named: rows.filter((r) => !!r.nm).length }));
  check('抽签配置记录参与名单 70 人', !!(pd && pd.data.cfg && String(pd.data.cfg.sel) === '70'), pd && pd.data && JSON.stringify(pd.data.cfg));
  await shot(mp, '04-draw-result');

  /* 只选 3 人 + 抽 5 → 明确报错不放行 */
  const seats3 = await pickerSeats(mp);
  await callPage(mp, 'openPicker'); await sleep(600);
  await callPicker(mp, 'clearAll'); await sleep(200);
  for (const s of seats3.slice(0, 3)) { await toggleSeat(mp, s); }
  await sleep(250);
  ps = await pickerState(mp);
  check('逐个气泡点选 3 人', ps.count === 3, JSON.stringify(ps));
  await confirmPicker(mp);
  pd = await pageData(mp);
  check('确定后页面已选 3 人', !!(pd && pd.data.selCount === 3), JSON.stringify(pd && pd.data && { selCount: pd.data.selCount }));
  await clearToast(mp);
  const drew3 = await drawWithCount(mp, 5);
  await sleep(500);
  const toast3 = await readToast(mp);
  pd = await pageData(mp);
  check('只选 3 人 + 抽 5 → 明确报错（名单内可用人数 3 个）', /不能取 5 个/.test(toast3), toast3 + ' / ' + drew3);
  check('超池不放行（结果仍为上次 10 个）', ((pd && pd.data.rows) || []).length === 10, JSON.stringify({ route: pd && pd.route, rows: ((pd && pd.data.rows) || []).length, drew: drew3 }));

  /* 未选名单 → 只抽序号（结果无姓名） */
  await callPage(mp, 'openPicker'); await sleep(600);
  await callPicker(mp, 'clearAll'); await sleep(200);
  await confirmPicker(mp);
  await clearToast(mp);
  const drewNoSel = await drawWithCount(mp, 10);
  await sleep(900);
  pd = await pageData(mp);
  const rowsNoSel = (pd && pd.data.rows) || [];
  check('未选名单：只抽序号 10 个且结果无姓名',
    rowsNoSel.length === 10 && rowsNoSel.every((r) => !r.nm),
    JSON.stringify({ route: pd && pd.route, drew: drewNoSel, n: rowsNoSel.length, named: rowsNoSel.filter((r) => !!r.nm).length }));
  check('未选名单：抽签池 = 范围 70 个序号', !!(pd && pd.data.poolLen === 70), JSON.stringify({ poolLen: pd && pd.data.poolLen }));

  /* ---------- 4. 分组页：成员来源「班级名单」 ---------- */
  check('分组页打开（强制重进）', await reloadPage(mp, '/pages/group/group', 'pages/group/group'), await curPath(mp));
  await sleep(800);
  await callPage(mp, 'setSource', { currentTarget: { dataset: { v: 'pick' } } }); await sleep(300);
  pd = await pageData(mp);
  check('分组来源切到「班级名单」', !!(pd && pd.data.source === 'pick'), pd && pd.data.source);
  await clearToast(mp);
  await callPage(mp, 'doGroup'); await sleep(500);
  const gToast0 = await readToast(mp);
  check('未选名单点开始分组 → 提示「请先选择名单」', /请先选择名单/.test(gToast0), gToast0);
  await callPage(mp, 'openPicker'); await sleep(650);
  ps = await pickerState(mp);
  check('分组页选择器 70 气泡', ps.items === 70, JSON.stringify(ps));
  await callPicker(mp, 'clearAll'); await sleep(150);
  const gSeats = (ps.first || []).length ? await pickerSeats(mp) : [];
  for (const s of gSeats.slice(0, 5)) { await toggleSeat(mp, s); }
  await sleep(250);
  ps = await pickerState(mp);
  check('分组选 5 人（气泡逐个点选）', ps.count === 5, JSON.stringify(ps));
  await confirmPicker(mp);
  await mp.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.setData({ n: 2 }); });
  await callPage(mp, 'doGroup'); await sleep(1100);
  pd = await pageData(mp);
  const groups = (pd && pd.data.groups) || [];
  let gmem = 0, gnamed = 0;
  groups.forEach((g) => (g.members || []).forEach((m) => { gmem++; if (m.nm) gnamed++; }));
  check('分组结果 2 组共 5 人', groups.length === 2 && gmem === 5, JSON.stringify({ groups: groups.length, mem: gmem }));
  check('分组结果 5 人全部带姓名', gmem === 5 && gnamed === 5, JSON.stringify({ named: gnamed }));
  await shot(mp, '05-group');

  /* ---------- 5. 点名页：沿用抽签名单（70 人）→ 改选 5 人状态按姓名保留 ---------- */
  await goto(mp, '/pages/draw/draw', 'pages/draw/draw'); await sleep(600);
  await callPage(mp, 'openPicker'); await sleep(650);
  await callPicker(mp, 'selectAll'); await sleep(250);
  await confirmPicker(mp);
  check('抽签名单恢复 70 人（供点名沿用）', (await storeState(mp)).rosterSel === 70);
  check('点名页打开', await goto(mp, '/pages/roll/roll', 'pages/roll/roll'), await curPath(mp));
  await sleep(800);
  await clearToast(mp);
  await callPage(mp, 'useDraw'); await sleep(900);
  pd = await pageData(mp);
  const useToast = await readToast(mp);
  check('沿用抽签名单 → 点名 70 人', !!(pd && pd.data.selCount === 70 && (pd.data.list || []).length === 70),
    JSON.stringify({ selCount: pd && pd.data.selCount, list: (pd && pd.data.list || []).length }));
  check('沿用 toast 提示 70 人', /已沿用抽签名单/.test(useToast), useToast);
  await shot(mp, '06-roll-full');
  await callPage(mp, 'toggle', { currentTarget: { dataset: { i: 0, v: 'in' } } }); await sleep(450);
  pd = await pageData(mp);
  check('点「到」记录 1 人已到', !!(pd && pd.data.sum && pd.data.sum.inN === 1), pd && pd.data && JSON.stringify(pd.data.sum));
  const beforeRoll = await storeSnapshot(mp);
  const rollListBefore = (pd && pd.data.list) || [];
  const firstNameIn = rollListBefore.filter((x) => x.s === 'in').map((x) => x.nm)[0] || '';
  await callPage(mp, 'openPicker'); await sleep(650);
  await callPicker(mp, 'clearAll'); await sleep(150);
  const rollSeats = await pickerSeats(mp);
  for (const s of rollSeats.slice(0, 5)) { await toggleSeat(mp, s); }
  await sleep(250);
  await confirmPicker(mp);
  pd = await pageData(mp);
  st = await storeState(mp);
  snap = await storeSnapshot(mp);
  check('点名改选 5 人', !!(pd && pd.data.selCount === 5 && st.rollSel === 5), JSON.stringify({ selCount: pd && pd.data.selCount, rollSel: st.rollSel }));
  check('改选后同姓名 到/假 保留（inN 仍 1）', !!(pd && pd.data.sum && pd.data.sum.inN === 1), pd && pd.data && JSON.stringify(pd.data.sum));
  const inNameAfter = (pd && pd.data.list || []).filter((x) => x.s === 'in').map((x) => x.nm)[0] || '';
  check('保留的是同一个人（姓名一致）', !!firstNameIn && firstNameIn === inNameAfter, firstNameIn + ' / ' + inNameAfter);
  const stIdx = Object.keys(snap.rollSt)[0];
  check('rollSt 下标与 rollNames 对齐（同一个人）',
    !!(stIdx != null && String(snap.rollNames).split('\n')[+stIdx] || '').includes(firstNameIn),
    JSON.stringify({ st: snap.rollSt, names: String(snap.rollNames).split('\n').slice(0, 3) }));
  check('改选前 store 的 rollSt 数量=1', Object.keys(beforeRoll.rollSt || {}).length === 1, JSON.stringify({ before: beforeRoll.rollSt }));
  await shot(mp, '07-roll-subset');

  /* 取消不写回 */
  const beforeCancel = await storeSnapshot(mp);
  await callPage(mp, 'openPicker'); await sleep(650);
  await toggleSeat(mp, rollSeats[rollSeats.length - 1]); await sleep(200);
  await callPicker(mp, 'cancel'); await sleep(600);
  pd = await pageData(mp);
  snap = await storeSnapshot(mp);
  check('选择器取消不写回（弹层关闭 / rollSel 不变）',
    pd && pd.data.picker === false && sameJson(snap.rollSel, beforeCancel.rollSel),
    JSON.stringify({ picker: pd && pd.data.picker, before: beforeCancel.rollSel, after: snap.rollSel }));

  /* ---------- 6. console / 截图 / 收尾 ---------- */
  check('0 console error / exception', consoleIssues.length === 0, consoleIssues.slice(0, 5).join(' ; '));
  const shotFiles = fs.readdirSync(OUT).filter((f) => /\.png$/.test(f));
  check('截图已生成（≥4 张）', shotFiles.length >= 4, shotFiles.join(','));

  await mp.evaluate(() => {
    try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
    try { require('utils/store.js').reset(); } catch (e) { /* ignore */ }
    try { require('utils/flow.js').clearFlow(); } catch (e) { /* ignore */ }
  });

  const pass = checks.filter((c) => c.ok).length;
  const fail = checks.length - pass;
  const result = {
    at: new Date().toISOString(),
    durationMs: Date.now() - t0,
    ws: process.env.ROSTER_WS || 'ws://127.0.0.1:9420',
    pass: pass, fail: fail,
    total: checks.length,
    checks: checks,
    consoleIssues: consoleIssues,
    shots: shotFiles.map((f) => path.join(OUT, f)),
    staticInfo: staticInfo,
    note: fail ? '存在 FAIL，见 checks' : '全部 PASS'
  };
  fs.writeFileSync(path.join(ROOT, 'roster_verify_result.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log('\n============ ' + pass + ' passed, ' + fail + ' failed ============');
  console.log('console errors/exceptions =', consoleIssues.length);
  console.log('result JSON:', path.join(ROOT, 'roster_verify_result.json'));
  await mp.disconnect();
  process.exit(fail || consoleIssues.length ? 2 : 0);
})().catch((e) => {
  console.error('ROSTER VERIFY FATAL', e && (e.stack || e.message || e));
  const result = {
    at: new Date().toISOString(), pass: checks.filter((c) => c.ok).length,
    fail: checks.filter((c) => !c.ok).length, total: checks.length, checks: checks,
    consoleIssues: consoleIssues, error: String(e && (e.stack || e.message || e)).slice(0, 2000),
    note: 'automator/环境异常中断；静态检查与已执行断言见 checks'
  };
  try { fs.writeFileSync(path.join(ROOT, 'roster_verify_result.json'), JSON.stringify(result, null, 2), 'utf8'); } catch (e2) { /* ignore */ }
  process.exit(1);
});
