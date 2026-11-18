/* tt_login_preview.js —— 课表「登录教务」个人课表（ttLocal）automator 场景（mock 身份 + mock RPC）
 *
 * 前置（本脚本不在会话内自行启动 devtools；由 Lead 统一运行）：
 *   cli.bat auto --project C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools --port 9433 --auto-port 9420 --trust-project
 * 用法：
 *   node tt_login_preview.js [--ws ws://127.0.0.1:9420]（或 TT_LOGIN_WS 覆盖）
 *
 * 场景（全部 mock，不接触真实云端）：
 *   A 成功：登录入口 → 弹层（学号默认班级身份 sid）→ 输入密码 → rpc/tt_login_enqueue → 轮询
 *     rpc/tt_login_status（pending→done）→ store.ttLocal 写入 + UD v6 tt.ttLocal → 课表切「我的课表」
 *     （个人课表优先于公共快照）；密码提交后立即从页面 data 清空且不落 storage；截图 01/02。
 *   B agent_offline：提示「本机代理解密服务不在线」，不轮询、不写 ttLocal、公共课表保留；截图 03。
 *   C 登录失败：status=failed → 提示「教务登录失败」，保留公共课表；截图 04。
 *   D 清除我的课表：wx.showModal 确认（mock）→ ttLocal=null + ttLocalAt 抬高 → 回退公共课表；截图 05。
 * 产出：_shots_tt_login/01..05*.png + result.json；失败 exit 2。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

function wsArg() {
  const i = process.argv.indexOf('--ws');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env.TT_LOGIN_WS || 'ws://127.0.0.1:9420';
}
const WS = wsArg();
const OUT = path.join(__dirname, '_shots_tt_login');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const consoleIssues = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 500) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}

async function installMock(mp) {
  await mp.evaluate(() => {
    const gd = getApp().globalData;
    if (gd.__ttMock) { try { wx.request = gd.__ttRequest; } catch (e) { /* ignore */ } return; }
    gd.__ttOrigRequest = wx.request;
    const MINE_C = [
      { name: '我的体育', day: 2, start: 3, end: 4, weeks: '1-16', parity: 'all', teacher: '王', room: '体育馆' },
      { name: '我的英语', day: 3, start: 5, end: 6, weeks: '1-16', parity: 'all', teacher: '李', room: 'B202' }
    ];
    const PUBLIC_C = [{ name: '公共课', day: 0, start: 1, end: 2, weeks: '1-18' }];
    const TERM_S = '2026-09-01';
    gd.__tt = { scenario: 'success', statusCalls: 0, enqueue: 0, status: 0 };
    gd.__ttRequest = function (o) {
      const u = String((o && o.url) || '');
      setTimeout(function () {
        const g = getApp().globalData;
        if (u.indexOf('rpc/tt_login_enqueue') >= 0) {
          g.__tt.enqueue += 1;
          if (g.__tt.scenario === 'offline') return o.success && o.success({ statusCode: 200, data: { ok: false, reason: 'agent_offline' } });
          return o.success && o.success({ statusCode: 200, data: { ok: true, job_id: 'job-' + g.__tt.scenario } });
        }
        if (u.indexOf('rpc/tt_login_status') >= 0) {
          g.__tt.status += 1;
          if (g.__tt.scenario === 'failed') return o.success && o.success({ statusCode: 200, data: { ok: true, status: 'failed', finished: Date.now(), error: 'bad pwd', result: null } });
          if (g.__tt.statusCalls < 1) { g.__tt.statusCalls += 1; return o.success && o.success({ statusCode: 200, data: { ok: true, status: 'pending', finished: 0, error: '', result: null } }); }
          return o.success && o.success({ statusCode: 200, data: { ok: true, status: 'done', finished: Date.now(), error: '', result: { c: MINE_C, t: TERM_S } } });
        }
        if (u.indexOf('/site_assets') >= 0) return o.success && o.success({ statusCode: 200, data: [{ body: { c: PUBLIC_C, t: TERM_S }, meta: null }] });
        return o.success && o.success({ statusCode: 200, data: [] });
      }, 20);
    };
    wx.request = gd.__ttRequest;
    gd.__ttMock = true;
  });
}
async function seedIdentityOnly(mp) {
  await mp.evaluate(() => {
    try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
    wx.setStorageSync('zq_class_identity', JSON.stringify({
      token: 'tok-tt-login-preview', sid: '9999000004', name: '谢梓萱',
      role: '', badge: '', is_admin: false, ts: Date.now()
    }));
    getApp().globalData.__tt = { scenario: 'success', statusCalls: 0, enqueue: 0, status: 0 };
  });
}
async function setScenario(mp, scenario) {
  await mp.evaluate((s) => {
    const gd = getApp().globalData;
    gd.__tt = { scenario: s, statusCalls: 0, enqueue: 0, status: 0 };
  }, scenario);
}
async function pageData(mp) {
  return mp.evaluate(() => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    if (!pg) return null;
    return JSON.parse(JSON.stringify({
      path: pg.route || '',
      state: pg.data.state, mine: !!pg.data.mine, srcText: pg.data.srcText || '',
      total: pg.data.total, loginOpen: !!pg.data.loginOpen, loginSid: pg.data.loginSid || '',
      loginBusy: !!pg.data.loginBusy, loginMsg: pg.data.loginMsg || '', loginErr: pg.data.loginErr || '',
      loginCanClear: !!pg.data.loginCanClear,
      req: (getApp().globalData || {}).__tt || null
    }));
  });
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
async function currentPage(mp) {
  const p = await mp.currentPage();
  if (!p) throw new Error('no current page');
  return p;
}
async function openLogin(page) {
  try {
    const el = await page.$('.tbtn--login');
    if (el) { await el.tap(); return; }
  } catch (e) { /* fallthrough */ }
  await page.callMethod('openLogin');
}
async function inputPwd(page, pwd) {
  try {
    const inp = await page.$('.ttl-in');
    if (inp) { await inp.input(pwd); return true; }
  } catch (e) { /* fallthrough */ }
  await page.setData({ loginPwd: pwd });
  return false;
}
async function submitLogin(page) {
  try {
    const btn = await page.$('.tbtn--login-main');
    if (btn) { await btn.tap(); return; }
  } catch (e) { /* fallthrough */ }
  await page.callMethod('loginTap');
}
async function tapClear(page) {
  try {
    const btn = await page.$('.tbtn--clear');
    if (btn) { await btn.tap(); return; }
  } catch (e) { /* fallthrough */ }
  await page.callMethod('clearMine');
}
async function storageProbe(mp) {
  return mp.evaluate(() => {
    const out = { ttLocal: null, ttLocalAt: 0, leakedPwd: false };
    try {
      const raw = wx.getStorageSync('zq_tools_v2');
      const d = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
      out.ttLocal = d.ttLocal || null;
      out.ttLocalAt = Number(d.ttLocalAt) || 0;
    } catch (e) { /* ignore */ }
    try {
      const keys = wx.getStorageInfoSync().keys || [];
      const dump = keys.map(function (k) { try { return String(wx.getStorageSync(k)); } catch (e) { return ''; } }).join('\n');
      out.leakedPwd = dump.indexOf('preview-pwd') >= 0;
      out.storageDumpLen = dump.length;
    } catch (e) { /* ignore */ }
    return out;
  });
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

    /* ================= A 成功：登录 → 我的课表 ================= */
    await seedIdentityOnly(mp);
    await setScenario(mp, 'success');
    await mp.reLaunch('/pages/tt/tt');
    await waitFor(async () => { const d = await pageData(mp); return d && d.path === 'pages/tt/tt' && d.state === 'data'; }, 10000);
    let page = await currentPage(mp);
    let d = await pageData(mp);
    check('A1 课表页加载（公共课表）', !!(d && d.state === 'data' && d.mine === false && d.total >= 1), JSON.stringify(d && { state: d.state, mine: d.mine, total: d.total, srcText: d.srcText }));
    await openLogin(page);
    await sleep(300);
    d = await pageData(mp);
    check('A2 登录弹层打开 + 学号默认班级身份 sid', !!(d && d.loginOpen === true && d.loginSid === '9999000004'), JSON.stringify(d && { loginOpen: d.loginOpen, loginSid: d.loginSid }));
    shots.push(await shot(mp, '01_tt_login_sheet'));
    await inputPwd(page, 'preview-pwd');
    await submitLogin(page);
    const okA = await waitFor(async () => {
      const s = await pageData(mp);
      return s && s.mine === true && s.loginOpen === false ? s : null;
    }, 10000);
    check('A3 轮询 done → 切「我的课表」（个人课表优先于公共）', !!okA, JSON.stringify(await pageData(mp)));
    d = await pageData(mp);
    check('A4 srcText=我的课表 + 课程数=个人课表', !!(d && d.srcText === '我的课表' && d.total === 2), JSON.stringify(d && { srcText: d.srcText, total: d.total }));
    const storeA = await storageProbe(mp);
    check('A5 store.ttLocal 写入（{c,t} 与网页 UD v6 tt.ttLocal 同字段）', !!(storeA.ttLocal && Array.isArray(storeA.ttLocal.c) && storeA.ttLocal.c.length === 2 && storeA.ttLocal.t === '2026-09-01' && storeA.ttLocalAt > 0), JSON.stringify({ c: storeA.ttLocal && storeA.ttLocal.c && storeA.ttLocal.c.length, t: storeA.ttLocal && storeA.ttLocal.t, at: storeA.ttLocalAt }));
    check('A6 密码不落 storage（提交后即清空）', storeA.leakedPwd === false, 'leakedPwd=' + storeA.leakedPwd);
    check('A7 RPC 契约：enqueue 1 次 + status ≥2 次（pending→done）', !!(d.req && d.req.enqueue >= 1 && d.req.status >= 2), JSON.stringify(d.req));
    shots.push(await shot(mp, '02_tt_my_timetable'));

    /* ================= B agent_offline ================= */
    await seedIdentityOnly(mp);
    await setScenario(mp, 'offline');
    await mp.reLaunch('/pages/tt/tt');
    await waitFor(async () => { const s = await pageData(mp); return s && s.state === 'data'; }, 10000);
    page = await currentPage(mp);
    await openLogin(page);
    await sleep(250);
    await inputPwd(page, 'preview-pwd');
    await submitLogin(page);
    const offB = await waitFor(async () => {
      const s = await pageData(mp);
      return s && s.loginErr ? s : null;
    }, 5000);
    d = await pageData(mp);
    check('B1 agent_offline 提示「本机代理解密服务不在线」', !!(offB && /本机代理解密服务不在线/.test(d.loginErr)), JSON.stringify(d && { loginErr: d.loginErr }));
    check('B2 agent_offline 不轮询 / 不写 ttLocal / 公共课表保留', !!(d && d.req && d.req.status === 0 && d.mine === false), JSON.stringify(d && { status: d.req && d.req.status, mine: d.mine }));
    shots.push(await shot(mp, '03_tt_agent_offline'));

    /* ================= C 登录失败 ================= */
    await seedIdentityOnly(mp);
    await setScenario(mp, 'failed');
    await mp.reLaunch('/pages/tt/tt');
    await waitFor(async () => { const s = await pageData(mp); return s && s.state === 'data'; }, 10000);
    page = await currentPage(mp);
    await openLogin(page);
    await sleep(250);
    await inputPwd(page, 'preview-pwd');
    await submitLogin(page);
    const failC = await waitFor(async () => {
      const s = await pageData(mp);
      return s && s.loginErr ? s : null;
    }, 8000);
    d = await pageData(mp);
    check('C1 status=failed → 提示「教务登录失败」', !!(failC && /教务登录失败/.test(d.loginErr)), JSON.stringify(d && { loginErr: d.loginErr }));
    check('C2 失败不写 ttLocal、保留公共课表', !!(d && d.mine === false), JSON.stringify(d && { mine: d.mine, total: d.total }));
    shots.push(await shot(mp, '04_tt_login_failed'));

    /* ================= D 清除我的课表 ================= */
    await mp.evaluate(() => {
      const d = {
        ttLocal: { c: [{ name: '我的体育', day: 2, start: 3, end: 4, weeks: '1-16', parity: 'all', teacher: '王', room: '体育馆' }], t: '2026-09-01' },
        ttLocalAt: Date.now()
      };
      wx.setStorageSync('zq_tools_v2', JSON.stringify(d));
    });
    await mp.mockWxMethod('showModal', { errMsg: 'showModal:ok', confirm: true, cancel: false });
    await mp.reLaunch('/pages/tt/tt');
    await waitFor(async () => { const s = await pageData(mp); return s && s.mine === true; }, 10000);
    page = await currentPage(mp);
    d = await pageData(mp);
    check('D1 预置个人课表 → 课表页显示「我的课表」', !!(d && d.mine === true && d.srcText === '我的课表'), JSON.stringify(d && { mine: d.mine, srcText: d.srcText }));
    await openLogin(page);
    await sleep(250);
    d = await pageData(mp);
    check('D2 弹层出现「清除我的课表」入口', !!(d && d.loginCanClear === true), JSON.stringify(d && { loginCanClear: d.loginCanClear }));
    await tapClear(page);
    const cleared = await waitFor(async () => { const s = await pageData(mp); return s && s.mine === false ? s : null; }, 6000);
    d = await pageData(mp);
    check('D3 清除后回退公共课表（mine=false）', !!(cleared && d && d.mine === false), JSON.stringify(d && { mine: d.mine, total: d.total }));
    const storeD = await storageProbe(mp);
    check('D4 ttLocal=null + ttLocalAt 抬高（跨端清除）', !!(storeD.ttLocal === null && storeD.ttLocalAt > 0), JSON.stringify({ ttLocal: storeD.ttLocal, at: storeD.ttLocalAt }));
    shots.push(await shot(mp, '05_tt_public_after_clear'));
    try { await mp.restoreWxMethod('showModal'); } catch (e) { /* ignore */ }

    const info = await mp.evaluate(() => { try { return wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) { return {}; } });
    const report = {
      at: new Date().toISOString(), wsEndpoint: WS,
      windowWidth: info.windowWidth || 0, pixelRatio: info.pixelRatio || 0,
      note: '全程 mock wx.request（不接触真实云端）。A 成功登录 → store.ttLocal + UD v6 tt.ttLocal + 个人课表优先；B agent_offline；C failed；D 清除回退公共。密码提交后立即从页面 data 清空、不落 storage。',
      checks: results, screenshots: shots.filter(Boolean), consoleErrors: consoleIssues
    };
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2), 'utf8');
    const failed = results.filter((r) => !r.ok).length;
    console.log('\n==== tt_login_preview: ' + (results.length - failed) + ' PASS / ' + failed + ' FAIL / ' + consoleIssues.length + ' console error；windowWidth=' + report.windowWidth + ' ====');
    console.log('screenshots: ' + report.screenshots.join(', '));
    process.exitCode = failed ? 2 : 0;
  } finally {
    try { await mp.restoreWxMethod('showModal'); } catch (e) { /* ignore */ }
    try {
      await mp.evaluate(() => {
        try {
          const gd = getApp().globalData;
          if (gd.__ttOrigRequest) wx.request = gd.__ttOrigRequest;
        } catch (e) { /* ignore */ }
      });
    } catch (e) { /* ignore */ }
    try { await mp.disconnect(); } catch (e) { /* ignore */ }
  }
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
