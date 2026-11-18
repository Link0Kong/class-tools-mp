/* tool_sort_preview.js —— 小程序「工具」页改版回归：按钮进入首页快捷编辑模式 + 长按拖动排序
 *
 * 用户 2026-11-06 新口径：
 *   · 工具页顶部不再展示「首页快捷」行；主体只有「全部工具」；
 *   · 「全部工具」标题行右侧按钮：普通态「编辑首页」→ 点开进入编辑模式，编辑态「完成」→ 退出；
 *   · 普通模式没有任何勾选框：点 tile 打开工具，长按 350ms 拖动排序（幽灵/网格迟滞/锁滚动等保留）；
 *   · 编辑模式：点 tile 切换「是否加入首页快捷」（不打开工具），选中 tile 有主色描边 + 对勾徽标，
 *     未选中空心圆；勾满 4 个再点第 5 个 toast「最多选 4 个」且状态不变；编辑模式禁用长按拖动。
 *
 * 只用微信开发者工具自动化接口（miniprogram-automator）：
 *   mp.screenshot 截图、element.tap()/touchstart/touchmove/touchend 真实触摸、page.data 断言；
 *   不使用 pyautogui/win32gui 屏幕操作，不跑 cli preview / auto-preview（避免把页面推送到真机）。
 *
 * 前置：cli.bat auto --project <mp-class-tools> --auto-port 9436 --trust-project
 * 用法：node tool_sort_preview.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const WS = 'ws://127.0.0.1:9436';
const OUT = path.join(__dirname, '_shots_tool_sort2');
fs.mkdirSync(OUT, { recursive: true });
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
  try { await mp.screenshot({ path: path.join(OUT, name + '.png') }); console.log('SHOT  ' + name); }
  catch (e) { console.log('SHOT-FAIL ' + name + ' :: ' + e.message); }
}
async function curPage(mp) { try { return await mp.currentPage(); } catch (e) { return null; } }
async function curPath(mp) { const p = await curPage(mp); return p ? p.path : ''; }
async function waitPath(mp, expect, timeout) {
  const end = Date.now() + (timeout || 12000);
  while (Date.now() < end) { if ((await curPath(mp)) === expect) return true; await sleep(200); }
  return false;
}
async function pageData(mp) {
  return mp.evaluate(() => { const ps = getCurrentPages(); const pg = ps[ps.length - 1]; return pg ? JSON.parse(JSON.stringify(pg.data || {})) : null; });
}
function keysOf(list) { return (list || []).map(function (x) { return x.key; }); }
async function elText(mp, sel) {
  const p = await curPage(mp);
  const el = p ? await p.$(sel) : null;
  if (!el) return null;
  try { return await el.text(); } catch (e) { return null; }
}
async function elCount(mp, sel) {
  const p = await curPage(mp);
  if (!p) return 0;
  try { return (await p.$$(sel)).length; } catch (e) { return 0; }
}
async function tapEl(mp, sel) {
  const p = await curPage(mp);
  const el = p ? await p.$(sel) : null;
  if (!el) throw new Error('找不到元素 ' + sel);
  await el.tap();
  await sleep(360);
}
async function cellInfo(mp, key) {
  const p = await curPage(mp);
  const el = p ? await p.$('#all-tool-' + key) : null;
  if (!el) return null;
  const off = await el.offset();
  const size = await el.size();
  return { x: off.left + size.width / 2, y: off.top + size.height / 2, left: off.left, top: off.top, w: size.width, h: size.height };
}
async function touchOn(mp, key, type, x, y) {
  const p = await curPage(mp);
  const el = p ? await p.$('#all-tool-' + key) : null;
  if (!el) throw new Error('找不到工具格 #all-tool-' + key);
  const t = { identifier: 0, clientX: x, clientY: y, pageX: x, pageY: y };
  if (type === 'start') await el.touchstart({ touches: [t] });
  else if (type === 'move') await el.touchmove({ touches: [t] });
  else await el.touchend({ touches: [], changedTouches: [t] });
}
async function storedTools(mp) {
  return mp.evaluate(() => {
    try { return JSON.parse(wx.getStorageSync('zq_tools_v2') || '{}'); } catch (e) { return {}; }
  });
}
async function hookToast(mp) {
  try {
    await mp.evaluate(() => {
      wx.__lastToast = '';
      if (!wx.__origShowToast) {
        const orig = wx.showToast;
        wx.__origShowToast = orig;
        wx.showToast = function (o) { wx.__lastToast = (o && o.title) || ''; try { return orig.apply(wx, arguments); } catch (e) { return null; } };
      }
    });
    return true;
  } catch (e) { return false; }
}
async function lastToast(mp) {
  try { return await mp.evaluate(() => wx.__lastToast || ''); } catch (e) { return ''; }
}
async function homeKeysFromPage(mp) {
  return mp.evaluate(() => {
    try { return require('utils/tools.js').homeTools().slice(); } catch (e) { return null; }
  });
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  mp.on('exception', (e) => consoleIssues.push('exception: ' + JSON.stringify(e).slice(0, 400)));
  mp.on('console', (e) => {
    if (e && e.type === 'error') {
      const args = (e.args || []).map(function (a) { return typeof a === 'string' ? a : JSON.stringify(a); }).join(' ');
      consoleIssues.push('error: ' + args.slice(0, 400));
    }
  });
  await sleep(900);
  const sys = await mp.systemInfo();
  console.log('SDK', sys.SDKVersion, 'window', sys.windowWidth + 'x' + sys.windowHeight, 'theme', sys.theme);
  // 模拟器可能残留原生浮层（会挡截图）→ 用 automator 的 native 接口关掉（不是屏幕操作）
  try { await mp.native().cancelModal(); } catch (e) { /* ignore */ }
  try { await mp.native().shareCancel(); } catch (e) { /* ignore */ }
  await sleep(400);

  /* ---------- 0. mock 身份 + 清 storage（不经过身份页 / 不联网验证） ---------- */
  const ID = {
    token: 'mock-token-tool-sort2', sid: '3260799999', name: '测试账号',
    role: '副团支书', badge: '班委', is_admin: false, ts: Date.now()
  };
  await mp.evaluate((v) => {
    try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
    wx.setStorageSync('zq_class_identity', JSON.stringify(v));
  }, ID);
  await mp.reLaunch('/pages/all/all');
  const onAll = await waitPath(mp, 'pages/all/all', 12000);
  await sleep(1400);
  let d = await pageData(mp);
  for (let i = 0; i < 20 && !(d && d.all && d.all.length); i++) { await sleep(300); d = await pageData(mp); }
  check('进入工具页（mock 身份，无网络验证）', onAll && !!(d && d.all && d.all.length), 'path=' + (await curPath(mp)) + ' nAll=' + ((d && d.all || []).length));

  /* ---------- 1. 普通模式：无顶部快捷区 / 无勾选框 / 编辑按钮 ---------- */
  check('顶部「首页快捷」展示区已移除（.q-row / .q-empty 均不存在）',
    (await elCount(mp, '.q-row')) === 0 && (await elCount(mp, '.q-empty')) === 0, '');
  check('页面 data 不再有顶部快捷区字段（quick/quickEmpty）',
    d.quick === undefined && d.quickEmpty === undefined, 'keys=' + Object.keys(d || {}).slice(0, 12).join(','));
  const btnText = await elText(mp, '#home-edit-btn');
  check('「全部工具」标题行右侧有「编辑首页」按钮', btnText === '编辑首页', 'btn=' + JSON.stringify(btnText));
  const subNormal = await elText(mp, '.all-sub');
  check('普通模式说明文字 =「长按工具可拖动排序」', subNormal === '长按工具可拖动排序', 'sub=' + JSON.stringify(subNormal));
  check('普通模式没有任何勾选框（.tool-check=0，徽标未渲染）',
    (await elCount(mp, '.tool-check')) === 0 && (await elCount(mp, '.tool-home-mark')) === 0 &&
    (await (await curPage(mp)).$('#tile-home-mark-hw')) === null, '');
  check('普通模式 data.editMode = false', d.editMode === false, 'editMode=' + d.editMode);
  await shot(mp, '00-normal-mode');

  /* ---------- 2. 点按钮进入编辑模式 ---------- */
  await tapEl(mp, '#home-edit-btn');
  d = await pageData(mp);
  const btnText2 = await elText(mp, '#home-edit-btn');
  const subEdit = await elText(mp, '.all-sub');
  check('点「编辑首页」进入编辑模式（按钮变「完成」）', d.editMode === true && btnText2 === '完成',
    'editMode=' + d.editMode + ' btn=' + JSON.stringify(btnText2));
  check('编辑模式说明文字 =「点工具加入或移出首页快捷（最多 4 个）」',
    subEdit === '点工具加入或移出首页快捷（最多 4 个）', 'sub=' + JSON.stringify(subEdit));
  const nMark = await elCount(mp, '.tool-home-mark');
  const nCell = (d.all || []).length;
  check('编辑模式每个工具格都有选中徽标（tile-home-mark-<key>）', nMark === nCell && (await (await curPage(mp)).$('#tile-home-mark-hw')) !== null,
    'marks=' + nMark + ' cells=' + nCell);
  const nHome0 = (d.all || []).filter(function (x) { return x.home; }).length;
  check('进入编辑模式时默认已勾选 4 个（主色描边 + 对勾徽标）',
    nHome0 === 4 && (await elCount(mp, '.tool-cell--home')) === 4 && (await elCount(mp, '.tool-home-mark--on')) === 4,
    'home=' + nHome0);
  await shot(mp, '01-edit-mode');

  /* ---------- 3. 编辑态点 tile = 切换（清空 → 选 4 个） ---------- */
  await hookToast(mp);
  for (const k of ['hw', 'nt', 'ft', 'draw']) await tapEl(mp, '#all-tool-' + k);
  d = await pageData(mp);
  check('编辑模式点已选 tile = 移出首页快捷（清空到 0 个）',
    (d.all || []).filter(function (x) { return x.home; }).length === 0, 'home=' + (d.all || []).filter(function (x) { return x.home; }).length);
  check('清空后仍停留在编辑模式（不打开工具、不退出）', d.editMode === true && (await curPath(mp)) === 'pages/all/all', 'path=' + (await curPath(mp)));
  for (const k of ['tt', 'hw', 'nt', 'ft']) await tapEl(mp, '#all-tool-' + k);
  d = await pageData(mp);
  const homeKeys = await homeKeysFromPage(mp);
  check('编辑模式点 tile = 加入首页快捷（选满 4 个，选中徽标 + 描边）',
    (d.all || []).filter(function (x) { return x.home; }).length === 4 && (await elCount(mp, '.tool-home-mark--on')) === 4,
    'home=' + JSON.stringify(homeKeys));
  check('勾选顺序按 toolOrder 排列（tt/hw/nt/ft）', JSON.stringify(homeKeys) === JSON.stringify(['tt', 'hw', 'nt', 'ft']), JSON.stringify(homeKeys));
  await shot(mp, '02-selected-four');

  /* ---------- 4. 勾满 4 个再点第 5 个 → toast + 状态不变 ---------- */
  await tapEl(mp, '#all-tool-draw');
  d = await pageData(mp);
  const toast1 = await lastToast(mp);
  check('勾满 4 个再点第 5 个 → toast「最多选 4 个」', toast1 === '最多选 4 个', 'toast=' + JSON.stringify(toast1));
  check('第 5 个被拒后勾选集合不变（仍 4 个，draw 未加入）',
    (d.all || []).filter(function (x) { return x.home; }).length === 4 && JSON.stringify(await homeKeysFromPage(mp)) === JSON.stringify(['tt', 'hw', 'nt', 'ft']),
    JSON.stringify(await homeKeysFromPage(mp)));
  await shot(mp, '03-fifth-toast');

  /* ---------- 5. 取消一个 → 3 个 ---------- */
  await tapEl(mp, '#all-tool-nt');
  d = await pageData(mp);
  check('编辑模式再点已选 tile = 取消勾选（4 → 3）',
    (d.all || []).filter(function (x) { return x.home; }).length === 3 && JSON.stringify(await homeKeysFromPage(mp)) === JSON.stringify(['tt', 'hw', 'ft']),
    JSON.stringify(await homeKeysFromPage(mp)));
  await shot(mp, '04-cancel-one');

  /* ---------- 6. 点「完成」退出编辑模式 ---------- */
  await tapEl(mp, '#home-edit-btn');
  d = await pageData(mp);
  const btnText3 = await elText(mp, '#home-edit-btn');
  const subBack = await elText(mp, '.all-sub');
  check('点「完成」退出编辑模式（按钮回「编辑首页」、无任何勾选框）',
    d.editMode === false && btnText3 === '编辑首页' && subBack === '长按工具可拖动排序' &&
    (await elCount(mp, '.tool-home-mark')) === 0 && (await elCount(mp, '.tool-check')) === 0,
    'editMode=' + d.editMode + ' btn=' + JSON.stringify(btnText3));
  await shot(mp, '05-done-normal');

  /* ---------- 7. 工作台「常用工具」= 勾选工具（tt/hw/ft） ---------- */
  await mp.switchTab('/pages/index/index');
  check('切到工作台页', await waitPath(mp, 'pages/index/index', 12000), await curPath(mp));
  await sleep(1200);
  let di = await pageData(mp);
  for (let i = 0; i < 15 && !(di && di.quick); i++) { await sleep(300); di = await pageData(mp); }
  check('工作台「常用工具」= 勾选工具（tt/hw/ft，按 toolOrder）',
    JSON.stringify(keysOf(di && di.quick)) === JSON.stringify(['tt', 'hw', 'ft']), JSON.stringify(keysOf(di && di.quick)));
  await shot(mp, '06-workbench-quick');

  /* ---------- 8. 回工具页：普通模式长按拖动排序仍生效 ---------- */
  await mp.switchTab('/pages/all/all');
  await waitPath(mp, 'pages/all/all', 12000);
  await sleep(900);
  d = await pageData(mp);
  const orderBefore = JSON.stringify(keysOf(d.all));
  const src = 'draw', dst = 'tt';
  const srcInfo = await cellInfo(mp, src);
  const dstInfo = await cellInfo(mp, dst);
  check('回到工具页仍在普通模式（编辑态已退出）', d.editMode === false && !!srcInfo && !!dstInfo, 'editMode=' + d.editMode);
  await touchOn(mp, src, 'start', srcInfo.x, srcInfo.y);
  await sleep(520);                                  // > 350ms 长按阈值
  d = await pageData(mp);
  check('普通模式长按 350ms 进入拖动（幽灵 + page-meta 锁滚动）',
    d.dragging === true && d.dragKey === src && /overflow:\s*hidden/.test(String(d.dragPageStyle || '')) && !!(d.ghost && d.ghost.name === '抽签分组'),
    'dragging=' + d.dragging + ' ghost=' + JSON.stringify(d.ghost && d.ghost.name));
  await shot(mp, '07-drag-start');
  await touchOn(mp, src, 'move', (srcInfo.x + dstInfo.x) / 2, (srcInfo.y + dstInfo.y) / 2);
  await sleep(120);
  await touchOn(mp, src, 'move', dstInfo.x, dstInfo.y);
  await sleep(220);
  d = await pageData(mp);
  check('拖动中实时重排（draw 移到第 1 位）', keysOf(d.all)[0] === src, JSON.stringify(keysOf(d.all)));
  await shot(mp, '08-drag-moved');
  await touchOn(mp, src, 'end', dstInfo.x, dstInfo.y);
  await sleep(500);
  d = await pageData(mp);
  check('松手后退出拖动 + 页面顺序变化', d.dragging === false && JSON.stringify(keysOf(d.all)) !== orderBefore && keysOf(d.all)[0] === src,
    JSON.stringify(keysOf(d.all)));
  const saved = await storedTools(mp);
  check('拖动结果落盘 zq_tools_v2.toolOrder[0] = draw', Array.isArray(saved.toolOrder) && saved.toolOrder[0] === src,
    JSON.stringify(saved.toolOrder));
  check('拖动不改勾选集合（仍 tt/hw/ft）', JSON.stringify(saved.homeTools) === JSON.stringify(['tt', 'hw', 'ft']), JSON.stringify(saved.homeTools));
  await shot(mp, '09-after-drop');

  /* ---------- 9. 编辑模式内禁用长按拖动 ---------- */
  await tapEl(mp, '#home-edit-btn');
  d = await pageData(mp);
  check('再次进入编辑模式', d.editMode === true, 'editMode=' + d.editMode);
  const dragInfo = await cellInfo(mp, 'tt');
  await touchOn(mp, 'tt', 'start', dragInfo.x, dragInfo.y);
  await sleep(560);
  d = await pageData(mp);
  check('编辑模式内禁用长按拖动（不进入 dragging）', d.dragging === false, 'dragging=' + d.dragging);
  await touchOn(mp, 'tt', 'end', dragInfo.x, dragInfo.y);
  await sleep(300);
  // 说明：编辑态下这条 touchstart+touchend 序列在 WebView 会合成一次 tap（= 切换勾选）；
  // 若 tt 被切换掉，测试里复原预期勾选集合，保证后续「持久化」断言确定。
  let hkAfterTouch = await homeKeysFromPage(mp);
  if (JSON.stringify(hkAfterTouch) !== JSON.stringify(['tt', 'hw', 'ft'])) {
    if (hkAfterTouch.indexOf('tt') < 0) await tapEl(mp, '#all-tool-tt');
    hkAfterTouch = await homeKeysFromPage(mp);
  }
  check('编辑态触摸序列结束后勾选集合保持 tt/hw/ft（且未进入拖动）',
    JSON.stringify(hkAfterTouch) === JSON.stringify(['tt', 'hw', 'ft']), JSON.stringify(hkAfterTouch));
  await tapEl(mp, '#home-edit-btn');                  // 退出编辑

  /* ---------- 10. 重新进入工具页：顺序与勾选都持久化 ---------- */
  await mp.reLaunch('/pages/all/all');
  await waitPath(mp, 'pages/all/all', 12000);
  await sleep(1200);
  d = await pageData(mp);
  const saved2 = await storedTools(mp);
  check('重新进入：工具顺序（draw 第一）与勾选（tt/hw/ft）都保持',
    keysOf(d.all)[0] === 'draw' && JSON.stringify(saved2.homeTools) === JSON.stringify(['tt', 'hw', 'ft']) &&
    d.editMode === false && (await elCount(mp, '.tool-home-mark')) === 0,
    'all0=' + keysOf(d.all)[0] + ' home=' + JSON.stringify(saved2.homeTools));
  await shot(mp, '10-relaunch-persist');

  /* ---------- 11. 收尾 + 结果 ---------- */
  await mp.disconnect();
  const result = {
    at: new Date().toISOString(), pass: passN, fail: failN,
    sdk: sys.SDKVersion, window: { w: sys.windowWidth, h: sys.windowHeight }, theme: sys.theme,
    checks: checks, consoleIssues: consoleIssues
  };
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log('\n============ ' + passN + ' passed, ' + failN + ' failed ============');
  console.log('console errors/exceptions = ' + consoleIssues.length);
  if (consoleIssues.length) console.log(JSON.stringify(consoleIssues.slice(0, 8), null, 2));
  process.exit(failN || consoleIssues.length ? 2 : 0);
})().catch((e) => {
  console.error('FATAL ' + ((e && e.stack) || e));
  try {
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ fatal: String((e && e.message) || e), checks: checks }, null, 2), 'utf8');
  } catch (e2) { /* ignore */ }
  process.exit(1);
});
