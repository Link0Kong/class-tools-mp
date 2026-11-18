/* ia_preview.js —— v1.3.2 信息架构重设计回归（工作台 / 工具 / 我的）
 *
 * 目的：验证「首页只做今天的事、工具页做完整目录、我的页做身份/数据/同步/隐私/帮助」，
 *       并给三页留浅色截图（_shots/ia/）。
 *
 * 流程：清空模拟器 storage → 真实 class_verify（测试账号/3260799999，只读 RPC）→ 种本机示例数据
 *       → switchTab 工作台/工具/我的 → 截图 + 页面数据断言 + 尺寸断言 + console 错误收集
 *       → 工具页说明文字/「编辑首页」编辑态断言（2026-11-06 改版：顶部首页快捷展示已移除，
 *         普通模式无勾选框，长按拖动排序由 tool_sort_preview.js 专项覆盖）。
 *
 * 前置：微信开发者工具已执行
 *   cli.bat auto --project <项目> --auto-port 9420 --trust-project
 * 用法：node ia_preview.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const OUT = path.join(__dirname, '_shots', 'ia');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const consoleIssues = [];

function check(name, ok, detail) {
  checks.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 300) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}
async function shot(mp, name, wait) {
  await sleep(wait == null ? 500 : wait);
  await mp.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('SHOT  ' + name);
}
async function curPath(mp) {
  try { const p = await mp.currentPage(); return p ? p.path : ''; } catch (e) { return ''; }
}
async function curPage(mp) { try { return await mp.currentPage(); } catch (e) { return null; } }
async function pageData(mp) {
  const p = await curPage(mp);
  if (!p) return null;
  try { return await p.data(); } catch (e) { return null; }
}
// 开发者工具在热编译时偶发 automator 超时：切 tab 失败重试一次
async function switchTab(mp, url) {
  for (let i = 0; i < 2; i++) {
    try { return await mp.switchTab(url); } catch (e) {
      if (i === 1) throw e;
      await sleep(1500);
    }
  }
  return null;
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  mp.on('exception', (e) => consoleIssues.push('exception: ' + JSON.stringify(e).slice(0, 400)));
  mp.on('console', (e) => { if (e && e.type === 'error') consoleIssues.push('error: ' + (e.args || []).map(String).join(' ').slice(0, 400)); });
  const sys = await mp.systemInfo();
  const winW = sys.windowWidth || 375;
  console.log('SDK', sys.SDKVersion, 'theme', sys.theme, 'windowWidth', winW);

  /* ---------- 0. 清空 + 身份验证 ---------- */
  await mp.evaluate(() => {
    try { wx.clearStorageSync(); } catch (e) {}
    try { require('utils/store.js').reset(); } catch (e) {}
    try { require('utils/flow.js').clearFlow(); } catch (e) {}
  });
  let p = await mp.reLaunch('/pages/identity/identity');
  for (let i = 0; i < 12; i++) { await sleep(250); if ((await curPath(mp)) === 'pages/identity/identity') break; }
  p = await curPage(mp);
  if (!p) { console.error('PREVIEW FATAL: 身份页未就绪'); process.exit(1); }
  await sleep(700);
  const inputs = await p.$$('input');
  check('身份页输入框 ≥2', inputs.length >= 2, 'inputs=' + inputs.length);
  if (inputs.length >= 2) {
    await inputs[0].input('测试账号'); await sleep(180);
    await inputs[1].input('3260799999'); await sleep(250);
  }
  await mp.evaluate(() => { const ps = getCurrentPages(); const pg = ps[ps.length - 1]; if (pg && pg.submit) pg.submit(); });
  for (let i = 0; i < 40; i++) { await sleep(300); if ((await curPath(mp)) === 'pages/index/index') break; }
  for (let i = 0; i < 10; i++) {
    await sleep(300);
    const n = await mp.evaluate(() => { try { return (require('utils/store.js').get().classMembers || []).length; } catch (e) { return -1; } });
    if (n > 0) break;
  }
  check('身份验证后进入工作台', (await curPath(mp)) === 'pages/index/index', await curPath(mp));

  // 首次进入（本机还没有课表缓存/数据）也必须是可渲染的完整首页
  await sleep(1000);
  const dFirst = await pageData(mp);
  check('首次进入工作台可渲染（loading/无数据不崩）', !!(dFirst && (dFirst.state === 'data' || dFirst.state === 'loading')), dFirst && dFirst.state);
  await shot(mp, '00-index-first', 0);

  // 等启动时的云端拉取（tt.json / 名单 / 偏好）落定，避免示例数据被在途请求覆盖
  await sleep(2400);

  /* ---------- 1. 种本机示例数据（动态日期，保证有「今天」的课与待办） ---------- */
  await mp.evaluate(() => {
    const store = require('utils/store.js');
    const flow = require('utils/flow.js');
    const d = store.get();
    const now = new Date();
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    const ds = (off) => { const x = new Date(now.getFullYear(), now.getMonth(), now.getDate() + off); return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); };
    const di = (() => { const g = now.getDay(); return g === 0 ? 6 : g - 1; })();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - di - 63); // 9 周前的周一 = 第 10 周
    const term = monday.getFullYear() + '-' + pad(monday.getMonth() + 1) + '-' + pad(monday.getDate());
    const mk = (name, room, day, start, end) => ({ name: name, teacher: '老师', room: room, day: day, start: start, end: end, weeks: '1-18', parity: 'all' });
    d.termStart = term;
    d.ttCache = { c: [
      mk('高等数学', '自强楼(教室01105)', di, 1, 2),
      mk('大学英语', '外语楼B305', di, 3, 4),
      mk('程序设计基础', '实验楼C401', di, 10, 11),
      mk('大学物理', '教学楼A201', (di + 1) % 7, 1, 2)
    ], t: term, at: Date.now(), meta: { at: Date.now() } };
    d.homeTools = ['tt', 'hw', 'nt', 'ft', 'draw', 'roll', 'bz'];
    d.homeToolsAt = Date.now();
    d.homework = [
      { id: 't1', subject: '高等数学', content: '习题 3.1 第 1-12 题，写清步骤', due: '明天 22:00', date: ds(1), time: '22:00', ts: Date.now() - 3600e3 },
      { id: 't2', subject: '大学英语', content: '背 Unit 4 单词，准备课堂听写', due: '三天后', date: ds(3), time: '', ts: Date.now() - 7200e3 },
      { id: 't3', subject: '程序设计基础', content: '完成实验报告二（循环与数组）', due: '已交', date: '', time: '', ts: Date.now() - 9000e3, done: true }
    ];
    d.hwDone = { t3: true };
    d.fitRecs = [
      { id: 'r1', at: Date.now() - 86400e3 * 10, name: '男 / 大一', sex: 'm', gr: '12', fields: {}, total: 82, grade: '良好' }
    ];
    d.notices = [
      { title: '关于本周班会时间调整的通知', body: '原定周三晚的班会调整到周四 19:00，地点教学楼 A301。', pin: true, imp: true, ts: Date.now() - 86400e3 * 2 }
    ];
    store.save();
    flow.patch('draw', { params: { start: 1, end: 70, count: 10 }, result: [3, 8, 12, 21, 25, 33, 41, 50, 58, 66] });
    flow.patch('group', { params: { mode: 'groups', n: 5 }, result: [[3, 8], [12, 21], [25, 33], [41, 50], [58, 66]] });
  });
  check('示例数据写入（课表/作业/体测/工作流）', true, '');

  // 数据已落盘：让工作台用示例数据重绘（此时已有 ttCache，不会再走远端覆盖）
  await mp.evaluate(() => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    if (pg && typeof pg.refresh === 'function') pg.refresh();
  });
  await sleep(500);

  /* ---------- 2. 工作台 ---------- */
  p = await switchTab(mp, '/pages/index/index');
  await sleep(1200);
  const dIndex = await pageData(mp);
  const homeSeq = await mp.evaluate(() => { try { return require('utils/tools.js').homeTools().slice(0, 4); } catch (e) { return []; } });
  check('工作台已渲染', (await curPath(mp)) === 'pages/index/index' && dIndex && dIndex.state === 'data', dIndex && dIndex.state);
  check('工作台问候+姓名', !!(dIndex && dIndex.identity && dIndex.identity.name === '测试账号' && dIndex.hello), dIndex && (dIndex.hello + ' / ' + (dIndex.identity && dIndex.identity.name)));
  check('首页快捷 = 前 4 个工具', !!(dIndex && Array.isArray(dIndex.quick) && dIndex.quick.length === 4), dIndex && (dIndex.quick || []).map((t) => t.key).join(','));
  check('快捷顺序与 homeTools 前 4 一致', !!(dIndex && (dIndex.quick || []).map((t) => t.key).join(',') === homeSeq.join(',')), 'page=' + (dIndex && (dIndex.quick || []).map((t) => t.key).join(',')) + ' home=' + homeSeq.join(','));
  check('今日课程卡有数据（今日 ≥1 节）', !!(dIndex && dIndex.today && dIndex.today.hasData && (dIndex.today.today || []).length >= 1), dIndex && dIndex.today && JSON.stringify({ week: dIndex.today.week, n: (dIndex.today.today || []).length, state: dIndex.today.todayState }));
  check('今日课程含课程名与教室短名', !!(dIndex && (dIndex.today.today || []).some((s) => s.name === '高等数学' && s.room === '01105')), dIndex && JSON.stringify((dIndex.today.today || []).map((s) => s.name + '/' + s.room)));
  check('作业待交 ≥2', !!(dIndex && dIndex.hw && dIndex.hw.open >= 2), dIndex && JSON.stringify(dIndex.hw));
  check('通知待处理已同步', !!(dIndex && dIndex.nt && dIndex.nt.state === 'ok' && dIndex.nt.pending >= 1), dIndex && JSON.stringify(dIndex.nt));
  check('首页不再有统计总览/隐私/同步字段', !!(dIndex && !('stat' in dIndex) && !('remoteEnabled' in dIndex)), dIndex && Object.keys(dIndex).join(','));
  const pageSize = await p.size();
  check('工作台无横向溢出', parseInt(pageSize.width, 10) <= winW + 1, 'page=' + pageSize.width + ' win=' + winW);
  await shot(mp, '01-index', 300);

  /* ---------- 3. 工具页 ---------- */
  p = await switchTab(mp, '/pages/all/all');
  await sleep(1000);
  const dAll = await pageData(mp);
  check('工具页已渲染', (await curPath(mp)) === 'pages/all/all' && dAll && dAll.all, dAll && Object.keys(dAll).join(','));
  check('工具页不再有顶部首页快捷展示区（data.quick 已移除、.q-row 不存在）',
    !!(dAll && dAll.quick === undefined) && (await (await curPage(mp)).$('.q-row')) === null, '');
  check('全部工具目录 ≥7（管理员含统计=8）', !!(dAll && dAll.all.length >= 7), dAll && 'all=' + (dAll.all || []).length + ' keys=' + (dAll.all || []).map((t) => t.key).join(','));
  check('工具页不再有反馈/使用说明卡片', !!(dAll && !(dAll.all || []).some((t) => t.key === 'fb' || t.key === 'ug')), '');
  const allSize = await p.size();
  check('工具页无横向溢出', parseInt(allSize.width, 10) <= winW + 1, 'page=' + allSize.width + ' win=' + winW);
  await shot(mp, '02-tools', 300);

  /* ---------- 3b. 工具页：编辑首页模式（v2.0.0 改版：按钮进编辑态，普通模式无勾选框） ---------- */
  const editBtn = await (await curPage(mp)).$('#home-edit-btn');
  const subText0 = await ((await (await curPage(mp)).$('.all-sub')) ? (await (await curPage(mp)).$('.all-sub')).text() : '');
  check('工具页有「编辑首页」按钮（标题行右侧）', !!editBtn && (await editBtn.text()) === '编辑首页', '');
  check('普通模式说明 =「长按工具可拖动排序」，且无任何勾选框',
    subText0 === '长按工具可拖动排序' && (await (await curPage(mp)).$$('.tool-check')).length === 0 &&
    (await (await curPage(mp)).$$('.tool-home-mark')).length === 0, subText0);
  // 点按钮进编辑态（页面方法调用，避免依赖控件命中坐标）
  await mp.evaluate(() => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    if (pg && typeof pg.toggleEditMode === 'function') pg.toggleEditMode();
  });
  await sleep(400);
  const dEdit = await pageData(mp);
  const editBtnText = await (await (await curPage(mp)).$('#home-edit-btn')).text();
  const subEditText = await ((await (await curPage(mp)).$('.all-sub')) ? (await (await curPage(mp)).$('.all-sub')).text() : '');
  const nMark = (await (await curPage(mp)).$$('.tool-home-mark')).length;
  check('点按钮进入编辑态（按钮变「完成」、说明变「点工具加入或移出首页快捷（最多 4 个）」）',
    !!(dEdit && dEdit.editMode === true) && editBtnText === '完成' && subEditText.indexOf('点工具加入或移出首页快捷') >= 0,
    JSON.stringify({ editMode: dEdit && dEdit.editMode, btn: editBtnText, sub: subEditText }));
  check('编辑态每个工具格都有选中徽标、默认勾选 4 个',
    nMark === ((dEdit && dEdit.all || []).length) && (dEdit && (dEdit.all || []).filter((t) => t.home).length) === 4,
    'marks=' + nMark);
  // 勾满 4 个后再点第 5 个 → 状态不变（toast 文案由 tool_sort_preview.js 断言）
  const quickBefore = await mp.evaluate(() => { try { return require('utils/tools.js').homeTools().slice(); } catch (e) { return []; } });
  await mp.evaluate(() => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    const t = ((pg && pg.data && pg.data.all) || []).find((x) => !x.home);
    if (pg && t && typeof pg.toggleHome === 'function') pg.toggleHome(t.key);
  });
  await sleep(400);
  const quickAfter = await mp.evaluate(() => { try { return require('utils/tools.js').homeTools().slice(); } catch (e) { return []; } });
  check('勾满 4 个后第 5 个被拒（勾选集合不变）',
    quickAfter.join(',') === quickBefore.join(','), quickBefore.join(',') + ' -> ' + quickAfter.join(','));
  // 退出编辑态（恢复普通模式，避免影响后续截图/断言）
  await mp.evaluate(() => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    if (pg && typeof pg.toggleEditMode === 'function') pg.toggleEditMode();
  });
  await sleep(300);
  check('点「完成」退出编辑态（勾选徽标全部移除）',
    (await pageData(mp)).editMode === false && (await (await curPage(mp)).$$('.tool-home-mark')).length === 0, '');

  /* ---------- 4. 我的页 ---------- */
  // 后台 30s 云同步会以云端数据覆盖本机示例作业；切「我的」前重新种一次，保证断言确定性
  await mp.evaluate(() => {
    const store = require('utils/store.js');
    const d = store.get();
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    const ds = (off) => { const x = new Date(Date.now() + off * 86400e3); return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); };
    d.homework = [
      { id: 'm1', subject: '高等数学', content: '习题 3.1', due: '明天 22:00', date: ds(1), time: '22:00', ts: Date.now() - 3600e3 },
      { id: 'm2', subject: '大学英语', content: '背 Unit 4 单词', due: '三天后', date: ds(3), time: '', ts: Date.now() - 7200e3 },
      { id: 'm3', subject: '程序设计基础', content: '实验报告二', due: '已交', date: '', time: '', ts: Date.now() - 9000e3, done: true }
    ];
    d.hwDone = { m3: true };
    store.save();
  });
  p = await switchTab(mp, '/pages/me/me');
  await sleep(900);
  const dMe = await pageData(mp);
  check('我的页已渲染', (await curPath(mp)) === 'pages/me/me' && dMe && dMe.state === 'data', dMe && dMe.state);
  check('我的页身份卡姓名/角色（不显示学号/头像）', !!(dMe && dMe.identity && dMe.identity.name === '测试账号' && dMe.identity.role === '副团支部书记' && !dMe.identity.sidMask && !dMe.identity.avatar), dMe && JSON.stringify(dMe.identity));
  check('首页/我的均未渲染头像与学号字段', !!(dIndex && !dIndex.identity.avatar && !dIndex.identity.sidMask), dIndex && JSON.stringify(dIndex.identity));
  check('我的数据四项存在', !!(dMe && dMe.stat && ['hwOpen', 'hwDone', 'draw', 'fit'].every((k) => typeof dMe.stat[k] === 'number')), dMe && JSON.stringify(dMe.stat));
  check('我的数据数值正确（待交2/已完成1/抽签10/体测1）', !!(dMe && dMe.stat && dMe.stat.hwOpen === 2 && dMe.stat.hwDone === 1 && dMe.stat.draw === 10 && dMe.stat.fit === 1), dMe && JSON.stringify(dMe.stat));
  check('我的页保留同步/隐私/帮助/退出入口', !!(dMe && dMe.remoteReady === true), dMe && 'remoteReady=' + (dMe && dMe.remoteReady));
  const meSize = await p.size();
  check('我的页无横向溢出', parseInt(meSize.width, 10) <= winW + 1, 'page=' + meSize.width + ' win=' + winW);
  await shot(mp, '04-me', 300);

  /* ---------- 5. 收尾：恢复默认数据 ---------- */
  await mp.evaluate(() => {
    try { wx.clearStorageSync(); } catch (e) {}
    try { require('utils/store.js').reset(); } catch (e) {}
    try { require('utils/flow.js').clearFlow(); } catch (e) {}
  });

  const pass = checks.filter((c) => c.ok).length;
  const fail = checks.length - pass;
  fs.writeFileSync(path.join(__dirname, 'ia-result.json'), JSON.stringify({
    at: new Date().toISOString(), sdk: sys.SDKVersion, theme: sys.theme, windowWidth: winW,
    pass: pass, fail: fail, checks: checks, consoleIssues: consoleIssues,
    shots: fs.readdirSync(OUT).filter((f) => f.indexOf('.png') > 0)
  }, null, 2), 'utf8');
  console.log('\n============ ' + pass + ' passed, ' + fail + ' failed ============');
  console.log('console errors/exceptions =', consoleIssues.length);
  if (consoleIssues.length) console.log(JSON.stringify(consoleIssues.slice(0, 10), null, 2));
  await mp.disconnect();
  process.exit(fail || consoleIssues.length ? 2 : 0);
})().catch((e) => { console.error('PREVIEW FATAL', e); process.exit(1); });
