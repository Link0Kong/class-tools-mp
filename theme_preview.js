// theme_preview.js —— 小程序浅色/深色双主题逐页截图（回归用）
//
// 用途：暗色模式改动后的定点回归。先在微信开发者工具里切换模拟器主题
//      （模拟器底部工具栏「手机图标」→「浅色 / 深色」），再跑本脚本；脚本本身不切主题。
//
// 用法：
//   node theme_preview.js dark      # 截图存 _shots/theme-dark/
//   node theme_preview.js light     # 截图存 _shots/theme-light/
//
// 说明：会清空模拟器 storage，并用真实 class_verify（测试账号/3260799999）验证身份，
//      只调用云端只读 RPC；顺带写入一份本机示例数据（作业/通知/体测/课表缓存）以便截图有内容。
// 前置：开发者工具已执行 `cli.bat auto --project <项目> --auto-port 9420 --trust-project`
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const suffix = process.argv[2] || 'dark';
const OUT = path.join(__dirname, '_shots', 'theme-' + suffix);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = [];
const consoleIssues = [];

async function shot(mp, name, wait) {
  await sleep(wait == null ? 800 : wait);
  await mp.screenshot({ path: path.join(OUT, name + '.png') });
  shots.push(name);
  console.log('SHOT', name);
}
async function curPath(mp) {
  try { const p = await mp.currentPage(); return p ? p.path : ''; } catch (e) { return ''; }
}

const COURSES = [
  { name: '高等数学', teacher: '林老师', room: '教学楼A201', day: 0, start: 1, end: 2, weeks: '1-16', parity: 'all' },
  { name: '大学英语', teacher: 'Sarah', room: '外语楼B305', day: 0, start: 3, end: 4, weeks: '1-16', parity: 'all' },
  { name: '程序设计基础', teacher: '陈老师', room: '实验楼C401', day: 1, start: 1, end: 2, weeks: '1-16', parity: 'all' },
  { name: '体育', teacher: '王老师', room: '东区操场', day: 2, start: 5, end: 5, weeks: '1-16', parity: 'all' },
  { name: '管理学原理', teacher: '张老师', room: '经管楼D102', day: 3, start: 3, end: 4, weeks: '1-16', parity: 'all' },
  { name: '思想道德与法治', teacher: '李老师', room: '教学楼A508', day: 4, start: 6, end: 7, weeks: '1-16', parity: 'all' },
  { name: '信息技术导论', teacher: '赵老师', room: '实验楼C203', day: 5, start: 2, end: 3, weeks: '2-14', parity: 'even' }
];

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  mp.on('exception', (e) => consoleIssues.push('exception: ' + JSON.stringify(e).slice(0, 300)));
  mp.on('console', (e) => { if (e && e.type === 'error') consoleIssues.push('error: ' + (e.args || []).map(String).join(' ').slice(0, 300)); });
  const sys = await mp.systemInfo();
  console.log('SDKVersion', sys.SDKVersion, 'theme', sys.theme, '（应与截图主题一致）');

  await mp.evaluate(() => {
    try { wx.clearStorageSync(); } catch (e) {}
    try { require('utils/store.js').reset(); } catch (e) {}
    try { require('utils/flow.js').clearFlow(); } catch (e) {}
  });
  let p = await mp.reLaunch('/pages/identity/identity');
  await sleep(1000);
  await shot(mp, '01-identity');

  // 真实 RPC 验证（只读）
  p = await mp.currentPage();
  const inputs = await p.$$('input');
  if (inputs.length >= 2) {
    await inputs[0].input('测试账号'); await sleep(180);
    await inputs[1].input('3260799999'); await sleep(250);
  }
  await shot(mp, '02-identity-filled');
  await mp.evaluate(() => { const ps = getCurrentPages(); const pg = ps[ps.length - 1]; if (pg && pg.submit) pg.submit(); });
  for (let i = 0; i < 40; i++) { await sleep(300); if ((await curPath(mp)) === 'pages/index/index') break; }
  for (let i = 0; i < 10; i++) { await sleep(300); const n = await mp.evaluate(() => { try { return (require('utils/store.js').get().classMembers || []).length; } catch (e) { return -1; } }); if (n > 0) break; }

  // 本机示例数据
  await mp.evaluate((COURSES) => {
    const store = require('utils/store.js');
    const d = store.get();
    d.termStart = '2026-09-07';
    d.ttCache = { c: COURSES, t: '2026-09-07', at: Date.now(), meta: { at: Date.now() } };
    d.homework = [
      { subject: '高等数学', content: '习题 3.1 第 1-12 题，写清步骤', due: '明天 22:00', date: '', time: '', ts: Date.now() - 3600e3, id: 't1' },
      { subject: '大学英语', content: '背 Unit 4 单词，准备课堂听写', due: '周五', date: '', time: '', ts: Date.now() - 7200e3, id: 't2' },
      { subject: '程序设计基础', content: '完成实验报告二（循环与数组）', due: '11-08 18:00', date: '2026-11-08', time: '18:00', ts: Date.now() - 5000e3, id: 't3' }
    ];
    d.notices = [
      { title: '关于本周班会时间调整的通知', body: '原定周三晚的班会调整到周四 19:00，地点教学楼 A301，请同学们准时参加。', pin: true, imp: true, ts: Date.now() - 86400e3 * 2 },
      { title: '图书馆闭馆通知', body: '本周日全馆检修，暂停开放一天。', pin: false, imp: false, ts: Date.now() - 86400e3 * 5 }
    ];
    d.fit = { sex: 'm', grade: '12', h: '175', w: '65', vc: '3800', r50: '7.2', sit: '12', jump: '230', pull: '12', durM: '3', durS: '30' };
    d.fitRecs = [
      { at: Date.now() - 86400e3 * 10, name: '男 / 大一', score: 82.4, great: 60, good: 70, pass: 50, detail: '肺活量 3800 · 50米 7.2 · 坐位体前屈 12' },
      { at: Date.now() - 86400e3 * 40, name: '男 / 大一', score: 78.1, great: 55, good: 66, pass: 46, detail: '肺活量 3600 · 50米 7.4' }
    ];
    d.draw = { start: 1, end: 70, count: 10, dup: false, excl: '', sort: 'draw' };
    d.group = { source: 'prev', names: '', mode: 'groups', n: 4, shuffle: false };
    d.rollNames = (d.classMembers || []).slice(0, 8).map((m) => m.name).join('\n');
    store.save();
  }, COURSES);

  p = await mp.switchTab('/pages/index/index');
  await shot(mp, '03-index', 1600);
  p = await mp.switchTab('/pages/all/all');
  await shot(mp, '04-all');
  p = await mp.switchTab('/pages/me/me');
  await shot(mp, '05-me');

  const pages = [
    ['06-tt', '/pages/tt/tt'], ['07-draw', '/pages/draw/draw'], ['08-group', '/pages/group/group'],
    ['09-sum', '/pages/sum/sum'], ['10-hw', '/pages/hw/hw'], ['11-nt', '/pages/nt/nt'],
    ['12-ft', '/pages/ft/ft'], ['13-fttable', '/pages/fttable/fttable'], ['14-roll', '/pages/roll/roll'],
    ['15-committee', '/pages/committee/committee'], ['16-stats', '/pages/stats/stats'],
    ['17-fb', '/pages/fb/fb'], ['18-ug', '/pages/ug/ug']
  ];
  for (const [name, url] of pages) {
    await mp.reLaunch('/pages/index/index');
    await sleep(500);
    try { p = await mp.navigateTo(url); } catch (e) { console.log('NAV FAIL', name, e.message); continue; }
    await sleep(1400);
    await shot(mp, name, 400);
  }

  // 弹层 / 交互态
  await mp.reLaunch('/pages/index/index'); await sleep(400);
  p = await mp.navigateTo('/pages/tt/tt'); await sleep(1600);
  await mp.evaluate(() => {
    const ps = getCurrentPages(); const pg = ps[ps.length - 1];
    const c = (pg._courses || [])[0];
    if (c && pg.detailOf) pg.setData({ detail: pg.detailOf(c, pg.data.wk), showDetail: true });
  }).catch(() => {});
  await shot(mp, '19-tt-detail', 1200);

  await mp.reLaunch('/pages/index/index'); await sleep(400);
  p = await mp.navigateTo('/pages/hw/hw'); await sleep(1500);
  await mp.evaluate(() => { const ps = getCurrentPages(); const pg = ps[ps.length - 1]; if (pg.setData) pg.setData({ sheet: true }); }).catch(() => {});
  await shot(mp, '20-hw-sheet', 900);

  await mp.reLaunch('/pages/index/index'); await sleep(400);
  p = await mp.navigateTo('/pages/nt/nt'); await sleep(1500);
  await mp.evaluate(() => {
    const ps = getCurrentPages(); const pg = ps[ps.length - 1];
    if (pg.setData) pg.setData({ rawSheet: true, rawTitle: '原始消息', rawBlocks: [{ t: 'text', v: '【示例】原始群消息内容：周五下午班会，地点 A301，请准时参加。' }] });
  }).catch(() => {});
  await shot(mp, '21-nt-raw', 900);

  await mp.reLaunch('/pages/index/index'); await sleep(400);
  p = await mp.navigateTo('/pages/draw/draw'); await sleep(1500);
  await mp.evaluate(() => { const ps = getCurrentPages(); const pg = ps[ps.length - 1]; if (pg.openSheet) pg.openSheet(); }).catch(() => {});
  await shot(mp, '22-draw-sheet', 900);

  // 收尾：清空身份
  await mp.evaluate(() => {
    try { wx.clearStorageSync(); } catch (e) {}
    try { require('utils/store.js').reset(); } catch (e) {}
  });

  fs.writeFileSync(path.join(OUT, '_result.json'), JSON.stringify({ at: new Date().toISOString(), theme: sys.theme, shots, consoleIssues }, null, 2), 'utf8');
  console.log('\nDONE theme=' + sys.theme + ' shots=' + shots.length + ' consoleIssues=' + consoleIssues.length);
  if (consoleIssues.length) console.log(JSON.stringify(consoleIssues.slice(0, 8), null, 2));
  await mp.disconnect();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
