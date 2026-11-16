/* 身份系统预览/回归：微信开发者工具（miniprogram-automator）
 *
 * 流程：清空本机身份 → 身份页截图 → 输入 测试账号 / 3260799999 → 验证 → 工作台
 *       → 身份已保存页 → 班委页 → 统计页（管理员）→ 清除身份后的页面守卫 → 谢梓萱（普通成员）统计页被拒
 * 产物：_shots/mp_identity_*.png + _shots/identity-preview-result.json
 *
 * 说明：只调用云端只读 RPC（class_verify / class_members）与页面读取，不写任何云表、不改 CloudBase。
 * 前置：开发者工具已执行 `cli.bat auto --project ... --auto-port 9420 --trust-project`
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const OUT = path.join(__dirname, '_shots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const consoleIssues = [];
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 300) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}
async function shot(mp, name, waitMs) {
  await sleep(waitMs == null ? 350 : waitMs);
  await mp.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('SHOT  ' + name);
}
async function currentPath(mp) {
  try { const p = await mp.currentPage(); return p ? p.path : ''; } catch (e) { return ''; }
}
async function pageData(mp) {
  try { const p = await mp.currentPage(); return p ? await p.data() : null; } catch (e) { return null; }
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  mp.on('exception', (e) => consoleIssues.push({ type: 'exception', text: JSON.stringify(e).slice(0, 500) }));
  mp.on('console', (e) => {
    if (e && e.type === 'error') consoleIssues.push({ type: 'error', text: (e.args || []).map(String).join(' ').slice(0, 500) });
  });

  /* ---------- 0. 清空本机状态，回到身份页 ---------- */
  await mp.evaluate(() => {
    try { wx.clearStorageSync(); } catch (e) {}
    try { require('utils/store.js').reset(); } catch (e) {}
    try { require('utils/flow.js').clearFlow(); } catch (e) {}
  });
  let p = await mp.reLaunch('/pages/identity/identity');
  await p.waitFor(900);
  check('启动进入身份页', (await currentPath(mp)) === 'pages/identity/identity', await currentPath(mp));
  const d0 = await pageData(mp);
  check('无身份时身份页显示输入表单', !!(d0 && !d0.identity), d0 && JSON.stringify({ identity: d0.identity, name: d0.name, sid: d0.sid }));
  await shot(mp, 'mp_identity_form');

  /* ---------- 1. 输入姓名 + 学号（真实 RPC 验证） ---------- */
  const inputs = await p.$$('input');
  check('身份页有姓名/学号两个输入框', inputs.length >= 2, 'inputs=' + inputs.length);
  if (inputs.length >= 2) {
    await inputs[0].input('测试账号');
    await sleep(200);
    await inputs[1].input('3260799999');
    await sleep(300);
  }
  const dFill = await pageData(mp);
  check('输入框绑定姓名', dFill && dFill.name === '测试账号', dFill && dFill.name);
  check('输入框绑定 10 位学号', dFill && dFill.sid === '3260799999', dFill && dFill.sid);
  await shot(mp, 'mp_identity_filled');

  // 触发页面 submit（等价点击「验证并进入」；输入已经通过真实 input 组件写入）
  const t0 = Date.now();
  await mp.evaluate(() => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    pg.submit();
  });
  // 等待云端 class_verify + class_members
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    const st = await mp.evaluate(() => {
      try {
        const raw = wx.getStorageSync('zq_class_identity');
        let v = raw;
        if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch (e) { v = null; } }
        const d = require('utils/store.js').get();
        return { id: v, members: (d.classMembers || []).length };
      } catch (e) { return { err: String(e && e.message) }; }
    });
    if (st && st.id && st.id.token) { global.__id = st; break; }
  }
  const elapsed = Date.now() - t0;
  const idState = await mp.evaluate(() => {
    try {
      const raw = wx.getStorageSync('zq_class_identity');
      let v = raw;
      if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch (e) { v = null; } }
      const d = require('utils/store.js').get();
      return {
        token: v && v.token ? v.token.length : 0,
        sid: v && v.sid, name: v && v.name, role: v && v.role, badge: v && v.badge, isAdmin: v && v.is_admin,
        members: (d.classMembers || []).length, rosterLines: String(d.classRoster || '').split('\n').filter(Boolean).length
      };
    } catch (e) { return { err: String(e && e.message) }; }
  });
  check('class_verify 成功并保存身份（token 已存，不打印明文）', !!(idState && idState.token), JSON.stringify(idState));
  check('身份字段：测试账号 / 副团支部书记 / 班委 / 管理员', idState && idState.name === '测试账号' && idState.role === '副团支部书记' && idState.badge === '班委' && idState.isAdmin === true, JSON.stringify(idState));
  check('class_members 名单同步到本机（70 人）', idState && idState.members === 70, 'members=' + (idState && idState.members) + ' rosterLines=' + (idState && idState.rosterLines));
  check('验证+名单耗时 < 10s', elapsed < 10000, elapsed + 'ms');
  console.log('身份 token 长度 =', idState && idState.token, '（仅长度，不打印明文）');
  // 验证成功后身份页会展示「已保存身份」卡（约 0.9s 后自动进入工作台），趁切换前截图
  const dVerified = await p.data();
  check('身份页显示已保存身份卡（只显示姓名/角色，不显示学号/头像）', !!(dVerified && dVerified.identity && dVerified.identity.name === '测试账号' && dVerified.identity.role === '副团支部书记' && !dVerified.identity.sidMask && !dVerified.identity.avatar), dVerified && JSON.stringify(dVerified.identity));
  await shot(mp, 'mp_identity_verified', 0);

  /* ---------- 2. 工作台 ---------- */
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    if ((await currentPath(mp)) === 'pages/index/index') break;
  }
  await sleep(900); // 等工作台 140ms 首屏 timeout + refresh
  check('验证后进入工作台', (await currentPath(mp)) === 'pages/index/index', await currentPath(mp));
  const wbPage = await mp.currentPage();
  const dIndex = wbPage ? await wbPage.data() : null;
  check('工作台显示身份姓名', !!(dIndex && dIndex.identity && dIndex.identity.name === '测试账号'), dIndex && JSON.stringify(dIndex.identity));
  check('工作台首页快捷 = 4 个工具', !!(dIndex && Array.isArray(dIndex.quick) && dIndex.quick.length === 4), dIndex && (dIndex.quick || []).map((t) => t.key).join(','));
  check('工作台待办数据已就绪（作业/通知字段）', !!(dIndex && dIndex.hw && typeof dIndex.hw.open === 'number' && dIndex.nt && typeof dIndex.nt.state === 'string'), dIndex && JSON.stringify({ hw: dIndex.hw, nt: dIndex.nt }));
  await shot(mp, 'mp_identity_workbench');

  /* ---------- 3. 班委名单页 ---------- */
  p = await mp.reLaunch('/pages/index/index');
  await p.waitFor(700);
  p = await mp.navigateTo('/pages/committee/committee');
  await p.waitFor(1200);
  check('班委页可进入', (await currentPath(mp)) === 'pages/committee/committee', await currentPath(mp));
  const dBz = await pageData(mp);
  check('班委页列出 role 非空成员（官方 18 人，测试账号）', !!(dBz && (dBz.list || []).length >= 18 && (dBz.list || []).some((m) => m.name === '测试账号' && m.role === '副团支部书记')), dBz && JSON.stringify((dBz.list || []).length));
  check('班委页显示 role/badge 文字气泡', !!(dBz && (dBz.list || []).some((m) => m.badge === '班委')), '');
  check('班委页不显示学号（只显示姓名 / 职务 / 徽章）', !!(dBz && (dBz.list || []).every((m) => m.sidMask === undefined && m.sid === undefined)), dBz && JSON.stringify((dBz.list || []).slice(0, 2)));
  check('班委页全班人数 = 70', !!(dBz && dBz.total === 70), dBz && dBz.total);
  await shot(mp, 'mp_committee');

  /* ---------- 5. 统计页（管理员） ---------- */
  p = await mp.navigateTo('/pages/stats/stats');
  await p.waitFor(2000);
  check('管理员可进入统计页', (await currentPath(mp)) === 'pages/stats/stats', await currentPath(mp));
  const dStats = await pageData(mp);
  check('统计页未被拒绝（非 denied 状态）', !!(dStats && dStats.denied === false), dStats && JSON.stringify({ state: dStats.state, denied: dStats.denied }));
  check('统计页按账号聚合字段存在', !!(dStats && Array.isArray(dStats.accounts) && dStats.summary && typeof dStats.summary.visits === 'number'), dStats && JSON.stringify({ accounts: (dStats.accounts || []).length, summary: dStats.summary }));
  check('统计页按姓名聚合且不显示学号', !!(dStats && (dStats.accounts || []).every((a) => a.name !== '未知账号' && a.sidMask === undefined && a.sid === undefined)), dStats && JSON.stringify(dStats.accounts));
  await shot(mp, 'mp_stats_admin');

  /* ---------- 6. 无身份页面守卫 ---------- */
  await mp.evaluate(() => {
    try { require('utils/identity.js').clear(); } catch (e) {}
    try { require('utils/cloud.js').clearClassData(); } catch (e) {}
  });
  await mp.reLaunch('/pages/index/index');
  await sleep(1200);
  check('清除身份后打开工作台被 reLaunch 回身份页', (await currentPath(mp)) === 'pages/identity/identity', await currentPath(mp));
  await shot(mp, 'mp_guard_redirect');

  /* ---------- 7. 普通成员（谢梓萱）统计页被拒 ---------- */
  p = await mp.currentPage();
  await p.waitFor(500);
  const inputs2 = await p.$$('input');
  if (inputs2.length >= 2) {
    await inputs2[0].input('谢梓萱');
    await sleep(150);
    await inputs2[1].input('9999000004');
    await sleep(250);
  }
  const btn2 = null;
  if (btn2) await btn2.tap();
  await mp.evaluate(() => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    if (pg && typeof pg.submit === 'function') pg.submit();
  });
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    if ((await currentPath(mp)) === 'pages/index/index') break;
  }
  check('普通成员 谢梓萱 验证成功进入工作台', (await currentPath(mp)) === 'pages/index/index', await currentPath(mp));
  await sleep(1200);
  const dIndex2 = await pageData(mp);
  check('普通成员身份 role=团支部书记、isAdmin=false', !!(dIndex2 && dIndex2.identity && dIndex2.identity.isAdmin === false && dIndex2.identity.role === '团支部书记'), dIndex2 && JSON.stringify(dIndex2.identity));
  p = await mp.navigateTo('/pages/stats/stats');
  await p.waitFor(1200);
  const dDenied = await pageData(mp);
  check('统计页对普通成员显示「仅管理员可见」', !!(dDenied && dDenied.denied === true), dDenied && JSON.stringify({ state: dDenied.state, denied: dDenied.denied }));
  await shot(mp, 'mp_stats_denied');

  /* ---------- 8. 收尾：清空身份，恢复中性状态 ---------- */
  await mp.evaluate(() => {
    try { wx.clearStorageSync(); } catch (e) {}
    try { require('utils/store.js').reset(); } catch (e) {}
  });

  const pass = checks.filter((c) => c.ok).length;
  const fail = checks.length - pass;
  const result = {
    at: new Date().toISOString(),
    pass, fail, checks,
    consoleIssues,
    shots: fs.readdirSync(OUT).filter((f) => /^mp_identity_|^mp_committee|^mp_stats|^mp_guard/.test(f))
  };
  fs.writeFileSync(path.join(OUT, 'identity-preview-result.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log('\n============ ' + pass + ' passed, ' + fail + ' failed ============');
  console.log('console errors/exceptions =', consoleIssues.length);
  if (consoleIssues.length) console.log(JSON.stringify(consoleIssues.slice(0, 10), null, 2));
  process.exit(fail || consoleIssues.length ? 2 : 0);
})().catch((e) => { console.error('PREVIEW FATAL', e); process.exit(1); });
