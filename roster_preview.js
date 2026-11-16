/* roster_preview.js —— 班级名单选择器 + M3 简约气泡（v15 / 1.4.2）开发者工具 automator 回归
 *
 * 流程：真实班级身份 class_verify（测试账号 / 3260799999，只读 RPC）
 *   → 抽签页「选择名单」→ 气泡数 = 70 → 全选 → 确定 → 摘要 / 计数 = 70
 *   → 开始抽签 → 结果全部带姓名（参与名单 70 人）
 *   → 分组页「班级名单」→ 选择名单 → 分组结果成员带姓名
 *   → 点名页「沿用抽签名单」→ 70 人 → 点「到」→ 改选 5 人后状态按姓名保留
 * 截图：_shots/roster/*.png；结果：roster-preview-result.json；console error 必须 = 0。
 *
 * 前置：开发者工具 automator 端口 9420（`cli.bat auto --project ... --auto-port 9420 --trust-project`）。
 * 用法：node roster_preview.js
 * 端口被占时可用 ROSTER_WS=ws://127.0.0.1:<port> 指定。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const OUT = path.join(__dirname, '_shots', 'roster');
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
async function waitPath(mp, want, timeoutMs) {
  const limit = Date.now() + (timeoutMs || 8000);
  while (Date.now() < limit) {
    if ((await curPath(mp)) === want) return true;
    await sleep(200);
  }
  return false;
}
// 截图（automator 偶发写出 0 字节空图：重试 + 校验文件大小，避免交付空截图）
async function shot(mp, name) {
  const file = path.join(OUT, name + '.png');
  for (let i = 0; i < 4; i++) {
    try { await mp.screenshot({ path: file }); } catch (e) { /* ignore */ }
    try { if (fs.statSync(file).size > 2000) return; } catch (e) { /* ignore */ }
    await sleep(700);
  }
}
// 导航统一走 app 内 wx.reLaunch + 轮询路由（automator 的 route 等待在这种二手 IDE 会话里偶发超时）
async function appNavigate(mp, url, method) {
  try {
    await mp.evaluate((u, m) => {
      try { wx[m]({ url: u }); } catch (e) { /* ignore */ }
    }, url, method || 'reLaunch');
  } catch (e) { /* ignore */ }
}
async function connect() {
  const ep = process.env.ROSTER_WS || 'ws://127.0.0.1:9420';
  let last = null;
  for (let i = 0; i < 3; i++) {
    try { return await automator.connect({ wsEndpoint: ep }); } catch (e) { last = e; await sleep(1500); }
  }
  throw last;
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
async function pickerState(mp) {
  return mp.evaluate(() => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    const c = pg && pg.selectComponent ? pg.selectComponent('#rosterPicker') : null;
    if (!c) return { err: 'no-picker' };
    const d = c.data || {};
    const map = d.selMap || {};
    return {
      items: (d.items || []).length,
      total: d.total || 0,
      count: d.count || 0,
      loading: !!d.loading,
      failed: !!d.failed,
      selKeys: Object.keys(map).filter(function (k) { return map[k]; }).length
    };
  });
}
async function callPage(mp, method, arg) {
  return mp.evaluate((m, a) => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    if (!pg || typeof pg[m] !== 'function') return 'no-method:' + m;
    pg[m](a);
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

// 真实身份登录（class_verify 只读）：本机无身份时填表提交，成功后停在 workbench
async function login(mp) {
  if ((await curPath(mp)) !== 'pages/identity/identity') {
    await appNavigate(mp, '/pages/identity/identity', 'reLaunch');
    await waitPath(mp, 'pages/identity/identity', 6000);
  }
  await sleep(700);
  const p = await curPage(mp);
  const inputs = p ? await p.$$('input') : [];
  if (inputs.length >= 2) {
    await inputs[0].input('测试账号'); await sleep(120);
    await inputs[1].input('3260799999'); await sleep(200);
  }
  await mp.evaluate(() => { const ps = getCurrentPages(); const pg = ps[ps.length - 1]; if (pg && pg.submit) pg.submit(); });
  return waitPath(mp, 'pages/index/index', 15000);
}

// 打开任意页：reLaunch 优先 + 轮询；被身份守卫踢回时自动重新登录再试
async function goto(mp, url, want) {
  const target = want || url.replace(/^\//, '');
  for (let i = 0; i < 3; i++) {
    if ((await curPath(mp)) === target) return true;
    if ((await curPath(mp)) === 'pages/identity/identity') { await login(mp); }
    await appNavigate(mp, url, 'reLaunch');
    if (await waitPath(mp, target, 8000)) return true;
    await appNavigate(mp, url, 'navigateTo');
    if (await waitPath(mp, target, 5000)) return true;
  }
  return false;
}

(async () => {
  const mp = await connect();
  mp.on('exception', (e) => consoleIssues.push('exception: ' + JSON.stringify(e).slice(0, 400)));
  mp.on('console', (e) => { if (e && e.type === 'error') consoleIssues.push('error: ' + (e.args || []).map(String).join(' ').slice(0, 400)); });

  /* ---------- 0. 清本机测试数据 + 真实身份验证（只读 class_verify）---------- */
  await mp.evaluate(() => {
    try { wx.clearStorageSync(); } catch (e) {}
    try { require('utils/store.js').reset(); } catch (e) {}
    try { require('utils/flow.js').clearFlow(); } catch (e) {}
  });
  check('真实身份 class_verify 后进入工作台', await login(mp), await curPath(mp));
  await sleep(700);
  const st0 = await storeState(mp);
  check('class_members 已同步（70 人）', st0.classMembers === 70, JSON.stringify(st0));

  /* ---------- 1. 抽签页：选择名单 → 70 气泡 → 全选 → 确定 ---------- */
  check('抽签页打开', await goto(mp, '/pages/draw/draw', 'pages/draw/draw'), await curPath(mp));
  await sleep(800);
  let pd = await pageData(mp);
  check('抽签页默认未选名单', pd && pd.data && pd.data.selCount === 0, JSON.stringify(pd && pd.data && { selCount: pd.data.selCount }));
  await shot(mp, '01-draw-before');

  await callPage(mp, 'openPicker'); await sleep(700);
  let ps = await pickerState(mp);
  check('选择名单弹层打开且有 70 个气泡', ps.items === 70 && ps.total === 70, JSON.stringify(ps));
  check('打开时初始选择 = 传入 selected（0）', ps.count === 0 && ps.selKeys === 0, JSON.stringify(ps));
  await shot(mp, '02-picker-empty');

  await callPicker(mp, 'selectAll'); await sleep(400);
  ps = await pickerState(mp);
  check('一键全选 → 计数 70 / 70', ps.count === 70 && ps.selKeys === 70, JSON.stringify(ps));
  await shot(mp, '03-picker-all');

  await callPicker(mp, 'confirm'); await sleep(2400);
  pd = await pageData(mp); ps = await pickerState(mp);
  check('确定后弹层关闭、页面已选 70 人', !!(pd && pd.data && pd.data.selCount === 70 && pd.data.picker === false), JSON.stringify(pd && pd.data && { selCount: pd.data.selCount, picker: pd.data.picker }));
  check('页面气泡摘要 8 个 + 更多', !!(pd && pd.data && (pd.data.selChips || []).length === 8 && pd.data.selMore === 62), JSON.stringify(pd && pd.data && { chips: (pd.data.selChips || []).length, more: pd.data.selMore }));
  const st1 = await storeState(mp);
  check('store.roster 派生 70 行、rosterSel=70', st1.rosterSel === 70 && st1.rosterLines === 70, JSON.stringify(st1));
  await shot(mp, '04-draw-selected');

  await callPage(mp, 'doDraw'); await sleep(1000);
  pd = await pageData(mp);
  const rows = (pd && pd.data && pd.data.rows) || [];
  const named = rows.filter((r) => !!r.nm).length;
  check('开始抽签 → 10 个结果且全部带姓名', rows.length === 10 && named === 10, JSON.stringify({ n: rows.length, named: named, cfg: pd && pd.data && pd.data.cfg && { pool: pd.data.cfg.pool, sel: pd.data.cfg.sel } }));
  check('抽签参数记录参与名单 70 人', !!(pd && pd.data && pd.data.cfg && pd.data.cfg.sel === '70'), pd && pd.data && JSON.stringify(pd.data.cfg));
  await shot(mp, '05-draw-result');

  /* ---------- 2. 分组页：成员来源「班级名单」→ 选择名单 → 分组结果带姓名 ---------- */
  check('分组页打开', await goto(mp, '/pages/group/group', 'pages/group/group'), await curPath(mp));
  await sleep(800);
  await callPage(mp, 'setSource', { currentTarget: { dataset: { v: 'pick' } } });
  await sleep(300);
  await callPage(mp, 'openPicker'); await sleep(700);
  ps = await pickerState(mp);
  check('分组页选择器打开（70 气泡）', ps.items === 70, JSON.stringify(ps));
  await callPicker(mp, 'selectAll'); await sleep(300);
  await callPicker(mp, 'confirm'); await sleep(700);
  const stg = await storeState(mp);
  check('分组已选名单 70 人', stg.groupSel === 70, JSON.stringify(stg));
  await callPage(mp, 'doGroup'); await sleep(1500);
  pd = await pageData(mp);
  const gs = (pd && pd.data && pd.data.groups) || [];
  let memN = 0, memNamed = 0;
  gs.forEach((g) => (g.members || []).forEach((m) => { memN++; if (m.nm) memNamed++; }));
  check('分组「班级名单」模式：4 组 / 70 人 / 全部带姓名', gs.length === 4 && memN === 70 && memNamed === 70, JSON.stringify({ groups: gs.length, memN: memN, named: memNamed, cfg: pd && pd.data && pd.data.cfg }));
  await shot(mp, '06-group');

  /* ---------- 3. 点名页：沿用抽签名单 → 70 人，改选后 到/假 按姓名保留 ---------- */
  check('点名页打开', await goto(mp, '/pages/roll/roll', 'pages/roll/roll'), await curPath(mp));
  await sleep(800);
  await callPage(mp, 'useDraw'); await sleep(2300);
  pd = await pageData(mp); let st = await storeState(mp);
  check('沿用抽签名单 → 点名 70 人', !!(pd && pd.data && pd.data.selCount === 70 && (pd.data.list || []).length === 70), JSON.stringify({ selCount: pd && pd.data && pd.data.selCount, list: pd && pd.data && (pd.data.list || []).length, rollSel: st.rollSel }));
  await callPage(mp, 'toggle', { currentTarget: { dataset: { i: 0, v: 'in' } } }); await sleep(400);
  pd = await pageData(mp);
  check('点「到」记录 1 人已到', !!(pd && pd.data && pd.data.sum && pd.data.sum.inN === 1), pd && pd.data && JSON.stringify(pd.data.sum));
  await shot(mp, '07-roll-full');

  // 改选前 5 人：到/假 状态按姓名保留
  await callPage(mp, 'openPicker'); await sleep(700);
  await callPicker(mp, 'clearAll'); await sleep(250);
  const seats = await pickerSeats(mp);
  for (const seat of seats.slice(0, 5)) {
    await mp.evaluate((s) => {
      const pg = getCurrentPages()[getCurrentPages().length - 1];
      const c = pg.selectComponent('#rosterPicker');
      c.toggleSeat({ currentTarget: { dataset: { seat: s } } });
    }, seat);
  }
  await sleep(300);
  ps = await pickerState(mp);
  check('改选 5 人（气泡逐个点选）', ps.count === 5, JSON.stringify(ps));
  await callPicker(mp, 'confirm'); await sleep(2400);
  pd = await pageData(mp); st = await storeState(mp);
  check('点名名单改选为 5 人', !!(pd && pd.data && pd.data.selCount === 5 && st.rollSel === 5), JSON.stringify({ selCount: pd && pd.data && pd.data.selCount, rollSel: st.rollSel }));
  check('到/假 记录按姓名保留（原本已到的仍在）', !!(pd && pd.data && pd.data.sum && pd.data.sum.inN === 1 && st.rollSt === 1), JSON.stringify({ sum: pd && pd.data && pd.data.sum, rollSt: st.rollSt }));
  await shot(mp, '08-roll-subset');

  /* ---------- 4. 收尾 ---------- */
  await mp.evaluate(() => {
    try { wx.clearStorageSync(); } catch (e) {}
    try { require('utils/store.js').reset(); } catch (e) {}
    try { require('utils/flow.js').clearFlow(); } catch (e) {}
  });

  const pass = checks.filter((c) => c.ok).length;
  const fail = checks.length - pass;
  fs.writeFileSync(path.join(__dirname, 'roster-preview-result.json'), JSON.stringify({
    at: new Date().toISOString(), pass: pass, fail: fail, checks: checks, consoleIssues: consoleIssues,
    shots: fs.readdirSync(OUT).filter((f) => /\.png$/.test(f))
  }, null, 2), 'utf8');
  console.log('\n============ ' + pass + ' passed, ' + fail + ' failed ============');
  console.log('console errors/exceptions =', consoleIssues.length);
  if (consoleIssues.length) console.log(JSON.stringify(consoleIssues.slice(0, 8), null, 2));
  await mp.disconnect();
  process.exit(fail || consoleIssues.length ? 2 : 0);
})().catch((e) => { console.error('ROSTER PREVIEW FATAL', e); process.exit(1); });
