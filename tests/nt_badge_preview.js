/* nt_badge_preview.js —— 通知页「职位气泡 + OCR 标记」开发者工具回归（v16 / 1.4.3）
 *
 * 流程：连接已开启的 automator（cli.bat auto --auto-port 9420）
 *   → 保证有班级身份（没有就直接调 identity.login 走真实 class_verify，只读 RPC）
 *   → 打开通知页，强制从 CloudBase 重拉（只读）
 *   → 断言发布者气泡文字 = senderRole（无 role 退回 senderBadge，不再统一显示「班委」）
 *   → 断言 OCR 通知（ocr:true）的 OCR 小标记 / 原始消息发送者气泡（fromRole||fromBadge）
 *   → 截图到 _shots/nt-badge/nt-<主题>.png，结果写 _shots/nt-badge/result-<主题>.json
 *
 * 主题：脚本本身不切主题；先在开发者工具模拟器底部工具栏切「浅色 / 深色」再跑：
 *   node nt_badge_preview.js light
 *   node nt_badge_preview.js dark
 * 端口：NT_WS 可覆盖（默认 ws://127.0.0.1:9420）。
 * 说明：会话建立/页面路由在二手 IDE 会话里偶发超时，导航统一走 app 内 wx.* + 轮询路由，
 *       DOM 查询/截图都加了超时兜底，单个断言失败不会让整个脚本卡死。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const suffix = process.argv[2] === 'dark' ? 'dark' : 'light';
const OUT = path.join(__dirname, '_shots', 'nt-badge');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const consoleIssues = [];

function check(name, ok, detail) {
  checks.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 300) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}
function withTimeout(p, ms, fallback) {
  return Promise.race([p, sleep(ms).then(() => fallback)]);
}
async function curPath(mp) {
  const r = await withTimeout(mp.evaluate(() => {
    try { const ps = getCurrentPages(); return ps.length ? ps[ps.length - 1].route : ''; } catch (e) { return ''; }
  }), 4000, '');
  return String(r || '');
}
async function waitPath(mp, want, timeoutMs) {
  const end = Date.now() + (timeoutMs || 10000);
  while (Date.now() < end) { if ((await curPath(mp)) === want) return true; await sleep(250); }
  return false;
}
// 导航统一走 app 内 wx.reLaunch/switchTab（automator 的 route 等待在二手 IDE 会话里偶发超时）
async function appNav(mp, url, method) {
  await withTimeout(mp.evaluate((u, m) => { try { wx[m]({ url: u }); } catch (e) { /* ignore */ } }, url, method || 'reLaunch'), 6000, null);
  await sleep(500);
}
async function shot(mp, name) {
  const file = path.join(OUT, name + '.png');
  for (let i = 0; i < 4; i++) {
    await withTimeout(mp.screenshot({ path: file }), 15000, null);
    try { if (fs.statSync(file).size > 2000) { console.log('SHOT', file); return file; } } catch (e) { /* ignore */ }
    await sleep(700);
  }
  console.log('SHOT EMPTY', name);
  return file;
}
async function connect() {
  const ep = process.env.NT_WS || 'ws://127.0.0.1:9420';
  let last = null;
  for (let i = 0; i < 3; i++) {
    try { return await automator.connect({ wsEndpoint: ep }); } catch (e) { last = e; await sleep(1500); }
  }
  throw last;
}
async function pageData(mp) {
  return withTimeout(mp.evaluate(() => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    if (!pg) return null;
    return { route: pg.route, state: pg.data.state, syncText: pg.data.syncText, autoList: pg.data.autoList || [] };
  }), 8000, null);
}
// 没有身份时：直接调 utils/identity.js 的 login（真实 class_verify / class_members，只读 RPC），再轮询 storage
async function ensureIdentity(mp) {
  const has = await withTimeout(mp.evaluate(() => { try { return !!require('utils/identity.js').has(); } catch (e) { return false; } }), 8000, false);
  if (has) { console.log('identity: 已存在（复用模拟器 storage）'); return true; }
  await withTimeout(mp.evaluate(() => {
    try { require('utils/identity.js').login('3260799999', '测试账号'); } catch (e) { /* ignore */ }
    return 'started';
  }), 8000, null);
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const ok = await withTimeout(mp.evaluate(() => { try { return !!require('utils/identity.js').has(); } catch (e) { return false; } }), 6000, false);
    if (ok) { console.log('identity: 真实 class_verify 通过（只读 RPC）'); return true; }
  }
  return false;
}

(async () => {
  const mp = await connect();
  mp.on('exception', (e) => consoleIssues.push('exception: ' + JSON.stringify(e).slice(0, 300)));
  mp.on('console', (e) => { if (e && e.type === 'error') consoleIssues.push('error: ' + (e.args || []).map(String).join(' ').slice(0, 300)); });
  const sys = await withTimeout(mp.systemInfo(), 10000, null);
  if (!sys) { console.error('FATAL systemInfo 超时（automator 会话疑似被占用）'); process.exit(1); }
  console.log('SDKVersion', sys.SDKVersion, '| theme', sys.theme, '| 期望主题', suffix);
  check('模拟器主题与参数一致', sys.theme === suffix, 'theme=' + sys.theme + ' arg=' + suffix);

  if (!(await ensureIdentity(mp))) {
    console.error('FATAL 无身份，无法打开通知页');
    process.exit(1);
  }

  // 打开通知页（reLaunch 可直接进非 tab 页），然后强制从 CloudBase 重拉真实数据（只读）
  await appNav(mp, '/pages/nt/nt', 'reLaunch');
  await waitPath(mp, 'pages/nt/nt', 15000);
  await withTimeout(mp.evaluate(() => { const ps = getCurrentPages(); const pg = ps[ps.length - 1]; if (pg && pg.pull) pg.pull(true); }), 8000, null);
  let data = null;
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    data = await pageData(mp);
    if (data && data.state === 'ready' && (data.autoList || []).length) break;
  }
  check('通知页从云端拉取成功', !!data && data.state === 'ready' && (data.autoList || []).length > 0,
    data ? ('route=' + data.route + ' state=' + data.state + ' cards=' + (data.autoList || []).length + ' sync=' + data.syncText) : 'no-page');

  const list = (data && data.autoList) || [];
  const withSender = list.filter((x) => x.senderName);
  const withBadge = list.filter((x) => x.pubBadge);
  const expectedBadges = withBadge.map((x) => x.pubBadge);
  const roleBadges = withBadge.filter((x) => x.senderRole && x.pubBadge === x.senderRole);
  const realOcr = list.filter((x) => x.isOcr);
  check('真实通知卡已映射 senderName', withSender.length > 0, 'senderName 卡片数=' + withSender.length + '/' + list.length);
  check('真实通知卡已映射职位气泡 pubBadge', withBadge.length > 0, '气泡卡片数=' + withBadge.length);
  check('气泡文字 = senderRole（职位）', roleBadges.length > 0, 'role 直出卡片数=' + roleBadges.length);
  check('气泡规则：senderRole 优先、无 role 退回 senderBadge', withBadge.every((x) => x.pubBadge === (x.senderRole || x.senderBadge)),
    '样例=' + JSON.stringify(withBadge.slice(0, 3).map((x) => ({ name: x.senderName, role: x.senderRole, badge: x.senderBadge, pub: x.pubBadge }))));
  check('有职位的卡不再统一显示「班委」', withBadge.filter((x) => x.senderRole && x.pubBadge === '班委').length === 0,
    '「班委」气泡卡片数=' + withBadge.filter((x) => x.pubBadge === '班委').length + '（应为 0，旧数据无 role 才兜底）');
  check('真实云端已有 OCR 通知（ocr:true → isOcr）', realOcr.length > 0, 'isOcr 卡片数=' + realOcr.length);
  if (realOcr.length) {
    const c = realOcr[0];
    check('OCR 卡发布者字段完整（职位气泡）', !!c.senderName && !!c.pubBadge,
      JSON.stringify({ title: String(c.title).slice(0, 24), senderName: c.senderName, pubBadge: c.pubBadge, senderBadge: c.senderBadge }));
  }

  // DOM 断言（超时兜底：拿不到页面句柄时跳过，不影响截图）
  try {
    const page = await withTimeout(mp.currentPage(), 6000, null);
    if (page) {
      const badges = await withTimeout(page.$$('.nt-sub .nt-role'), 6000, []);
      const ocrDoms = await withTimeout(page.$$('.nt-ocr'), 6000, []);
      const pubNames = await withTimeout(page.$$('.nt-sub .nt-who'), 6000, []);
      const badgeTexts = [];
      for (const el of badges) badgeTexts.push(String(await withTimeout(el.text(), 4000, '')).trim());
      check('DOM: 职位气泡 .nt-sub .nt-role 已渲染', badges.length > 0, 'count=' + badges.length);
      check('DOM: 气泡文字 = 卡片 pubBadge（职位）', badgeTexts.length > 0 && badgeTexts.every((t, i) => t === (expectedBadges[i] || '')),
        '实际=' + JSON.stringify(badgeTexts.slice(0, 6)) + ' 期望=' + JSON.stringify(expectedBadges.slice(0, 6)));
      check('DOM: 气泡文字不是「班委」统称', badgeTexts.length > 0 && badgeTexts.filter((t) => t === '班委').length === 0,
        JSON.stringify(badgeTexts.slice(0, 6)));
      check('DOM: OCR 标记 .nt-ocr 已渲染', ocrDoms.length > 0, 'count=' + ocrDoms.length);
      if (ocrDoms.length) {
        const txt = await withTimeout(ocrDoms[0].text(), 4000, '');
        check('DOM: OCR 标记文字 = OCR', String(txt).trim() === 'OCR', txt);
      }
      check('DOM: 发布者姓名行 .nt-sub .nt-who 已渲染', pubNames.length > 0, 'count=' + pubNames.length);
    } else {
      check('DOM: 页面句柄可用', false, 'currentPage 超时（截图仍继续）');
    }
  } catch (e) {
    check('DOM: 页面句柄可用', false, String(e && e.message).slice(0, 100));
  }

  // 截图：滚到第一张 OCR 卡（能同时看到班委气泡 + OCR 标记），再补一张顶部卡
  let ocrOffset = null;
  try {
    const page2 = await withTimeout(mp.currentPage(), 6000, null);
    const ocrEls = page2 ? await withTimeout(page2.$$('.nt-ocr'), 6000, []) : [];
    if (ocrEls.length) ocrOffset = await withTimeout(ocrEls[0].offset(), 5000, null);
  } catch (e) { /* ignore */ }
  const targetTop = ocrOffset && typeof ocrOffset.top === 'number' ? Math.max(0, ocrOffset.top - 240) : 380;
  await withTimeout(mp.evaluate((top) => { try { wx.pageScrollTo({ scrollTop: top, duration: 0 }); } catch (e) {} }, targetTop), 5000, null);
  await sleep(900);
  console.log('截图滚动位置', targetTop, ocrOffset ? ('OCR 卡 offset.top=' + ocrOffset.top) : '(未取到 offset，用默认位置)');
  const file = await shot(mp, 'nt-' + suffix);
  await withTimeout(mp.evaluate(() => { try { wx.pageScrollTo({ scrollTop: 380, duration: 0 }); } catch (e) {} }), 5000, null);
  await sleep(700);
  await shot(mp, 'nt-' + suffix + '-top');

  // 原始消息弹层（OCR 文字通过 items kind:text 呈现；发送者气泡用 fromRole || fromBadge）
  await withTimeout(mp.evaluate(() => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    const card = (pg.data.autoList || []).filter((x) => x.isOcr)[0];
    if (card && pg.openRaw) pg.openRaw({ currentTarget: { dataset: { gid: card.id } } });
  }), 8000, null);
  await sleep(900);
  const raw = await withTimeout(mp.evaluate(() => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    const blocks = pg.data.rawBlocks || [];
    return {
      sheet: !!pg.data.rawSheet,
      blocks: blocks.length,
      badges: blocks.filter((b) => b.fromBadge).map((b) => b.fromBadge),
      names: blocks.filter((b) => b.fromName).map((b) => b.fromName)
    };
  }), 6000, null);
  check('OCR 卡可打开原始消息弹层', !!raw && raw.sheet, raw ? ('rawSheet=' + raw.sheet + ' blocks=' + raw.blocks) : 'evaluate 超时');
  check('原始消息发送者职位气泡已映射（fromRole||fromBadge）', !!raw && raw.badges.length > 0,
    raw ? JSON.stringify(raw.badges.slice(0, 6)) : 'evaluate 超时');
  check('原始消息发送者气泡不是「班委」统称', !!raw && raw.badges.filter((b) => b === '班委').length === 0,
    raw ? JSON.stringify(raw.badges.slice(0, 6)) : 'evaluate 超时');
  check('原始消息发送者姓名已映射', !!raw && raw.names.length > 0, raw ? JSON.stringify(raw.names.slice(0, 6)) : 'evaluate 超时');
  try {
    const page3 = await withTimeout(mp.currentPage(), 6000, null);
    if (page3) {
      const rawHd = await withTimeout(page3.$$('.nt-raw-hd'), 6000, []);
      const rawFrom = await withTimeout(page3.$$('.nt-raw-hd .nt-who'), 6000, []);
      check('DOM: 原始消息发送者行 .nt-raw-hd 已渲染', rawHd.length > 0, 'count=' + rawHd.length);
      check('DOM: 原始消息发送者姓名 .nt-raw-hd .nt-who 已渲染', rawFrom.length > 0, 'count=' + rawFrom.length);
    }
  } catch (e) { /* DOM 兜底：不影响截图 */ }
  await shot(mp, 'nt-' + suffix + '-raw');
  await withTimeout(mp.evaluate(() => { const ps = getCurrentPages(); const pg = ps[ps.length - 1]; if (pg.closeRaw) pg.closeRaw(); }), 5000, null);

  check('console error = 0', consoleIssues.length === 0, consoleIssues.slice(0, 3).join(' | '));

  const passN = checks.filter((c) => c.ok).length;
  const result = {
    at: new Date().toISOString(), theme: sys.theme, arg: suffix, sdk: sys.SDKVersion,
    shots: fs.readdirSync(OUT).filter((f) => f.indexOf('nt-' + suffix) === 0 && /\.png$/.test(f)),
    total: checks.length, pass: passN, fail: checks.length - passN, checks, consoleIssues
  };
  fs.writeFileSync(path.join(OUT, 'result-' + suffix + '.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log('\n================ ' + passN + '/' + checks.length + ' PASS | theme=' + sys.theme + ' ================');
  if (consoleIssues.length) console.log(JSON.stringify(consoleIssues.slice(0, 5), null, 2));
  await mp.disconnect();
  process.exitCode = passN === checks.length && consoleIssues.length === 0 ? 0 : 2;
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
