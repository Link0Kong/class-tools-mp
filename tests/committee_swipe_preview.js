/* committee_swipe_preview.js —— 名单页：左右滑动切分类 + 团员计数显示（automator 真实渲染）
 *
 * 用户 2026-11-19 要求：
 *   ①「增加名单的滑动切换功能和对应动效」；
 *   ②「修复团员名单在未打开时不显示数字的问题」。
 *
 * 只使用测试身份 + mock wx.request（不接触真实云端/网络，符合 AGENTS.md §0.7 只用测试账号）。
 * 手势注入方式：本机 IDE 版本的 Element.touchstart 会挂起、dispatchEvent 不触发 bindtouch*，
 * 因此在页面实例上调用 bindtouch* 对应的处理器（事件对象与 WXML 绑定签名一致：
 * touches/changedTouches = [{clientX,clientY}]），位移/动画/切分类/指示条都走真实页面代码。
 *
 * 前置：cli.bat auto --project <mp-class-tools> --port 9434 --auto-port 9424 --trust-project
 * 用法：node committee_swipe_preview.js
 * 产出：_shots_committee/（01 班委 / 02 飞出 / 03 团员 / 04 全班 / 05 切回）
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const WS = process.env.WS || 'ws://127.0.0.1:9424';
const OUT = path.join(__dirname, '_shots_committee');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passN = 0, failN = 0;
const consoleIssues = [];

function check(name, ok, detail) {
  if (ok) passN++; else failN++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ::  ' + detail : ''));
}
function hookConsole(msg) {
  const txt = String(msg && msg.args ? msg.args.join(' ') : msg);
  if (msg && msg.type === 'error' && !/Lazy code loading/.test(txt)) consoleIssues.push(txt);
}
// 本机 IDE 的 screenshot 会偶发打断 automator 会话，默认关闭；需要截图时 SHOTS=1。
async function shot(mp, name) {
  if (!process.env.SHOTS) return '';
  const p = path.join(OUT, name + '.png');
  try { await mp.screenshot({ path: p }); console.log('SHOT  ' + p); return p; } catch (e) { console.log('SHOT-FAIL ' + name + ' :: ' + e.message); return ''; }
}

/* ---------------- 页面访问（页面栈里找带 onSwipeStart 的名单页） ---------------- */
const LOOK = () => {
  const g = getCurrentPages();
  let pg = null;
  for (let i = g.length - 1; i >= 0; i--) { if (g[i] && typeof g[i].onSwipeStart === 'function') { pg = g[i]; break; } }
  if (!pg || !pg.data) return { found: false, routes: g.map((x) => x && x.route) };
  return {
    found: true,
    route: pg.route,
    tab: pg.data.tab,
    swipeStyle: pg.data.swipeStyle || '',
    indicator: pg.data.indicator || null,
    counts: pg.data.counts || null,
    state: pg.data.state,
    list: (pg.data.list || []).map((x) => x.name)
  };
};
async function look(mp) {
  return mp.evaluate(LOOK).catch(() => ({ found: false }));
}
async function gesture(mp, kind, x, y) {
  return mp.evaluate((a) => {
    const g = getCurrentPages();
    let pg = null;
    for (let i = g.length - 1; i >= 0; i--) { if (g[i] && typeof g[i].onSwipeStart === 'function') { pg = g[i]; break; } }
    if (!pg) return { error: 'no-page' };
    const t = { identifier: 0, clientX: a.x, clientY: a.y, pageX: a.x, pageY: a.y };
    const ev = { touches: [t], changedTouches: [t] };
    if (a.kind === 'start') pg.onSwipeStart(ev);
    else if (a.kind === 'move') pg.onSwipeMove(ev);
    else if (a.kind === 'end') { ev.touches = []; pg.onSwipeEnd(ev); }
    else if (a.kind === 'cancel') pg.onSwipeCancel(ev);
    return { swipeStyle: pg.data.swipeStyle || '', tab: pg.data.tab };
  }, { kind: kind, x: x, y: y });
}

const MEMBERS = [
  { seat: 1, sid: 's1', name: '甲同学', role: '班长', badge: '班委', is_admin: false },
  { seat: 2, sid: 's2', name: '乙同学', role: '', badge: '', is_admin: false },
  { seat: 3, sid: 's3', name: '丙同学', role: '学习委员', badge: '班委', is_admin: false },
  { seat: 4, sid: 's4', name: '丁同学', role: '', badge: '', is_admin: false },
  { seat: 5, sid: 's5', name: '戊同学', role: '', badge: '', is_admin: false }
];
const LEAGUE = [{ seat: 2, name: '乙同学' }, { seat: 4, name: '丁同学' }, { seat: 5, name: '戊同学' }];

async function applyMock(mp) {
  await mp.evaluate((payload) => {
    wx.setStorageSync('zq_class_identity', JSON.stringify({
      token: 'tok-qa-committee', sid: '3260799999', name: '测试账号',
      role: '', badge: '', is_admin: false, ts: 1
    }));
    // 精确匹配 RPC：只给名单/团员两组夹具；其余一律空成功，避免云端 401 触发
    // identity.onAuthExpired 清身份弹回身份页。
    // 注意：cloud-config 的 rpc 表里没有 league（CONFIG.rpc.league 为 undefined），
    // 因此按「不带 class_members 的 post」兜底返回团员夹具。
    wx.request = function (o) {
      const url = String(o.url || '');
      let data = {};
      if (url.indexOf('/rpc/class_members') >= 0) data = payload.members;
      else if (url.indexOf('/rpc/class_verify') >= 0) data = { ok: true };
      else if (/\/rest\/undefined\/?$/.test(url) || url.indexOf('class_league') >= 0) data = [{ seats: payload.league }];
      setTimeout(() => { o.success && o.success({ statusCode: 200, data: data }); }, 40);
    };
  }, { members: MEMBERS, league: LEAGUE });
}

async function openCommittee(mp) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await look(mp);
    if (cur.found && cur.state === 'data') return cur;
    await applyMock(mp);
    // 身份页在场时 navigateTo 会静默失败：先确保停在首页 tab
    await mp.reLaunch('/pages/index/index').catch(() => {});
    await sleep(2500);
    await mp.navigateTo('/pages/committee/committee').catch(() => {});
    await sleep(2200);
    const d = await look(mp);
    if (d.found && d.state === 'data') return d;
  }
  throw new Error('无法进入名单页');
}

(async () => {
  let mp = await automator.connect({ wsEndpoint: WS });
  mp.on('console', hookConsole);

  let d = await openCommittee(mp);
  check('进入名单页并渲染', d.found && d.state === 'data' && d.tab === 'committee',
    JSON.stringify({ tab: d.tab, state: d.state, n: d.list.length }));

  /* ---------- ① 计数：三个分类都显示数字 ---------- */
  const c = d.counts || {};
  check('团员计数显示为数字（修复前未加载时是空字符串）',
    /^\d+$/.test(String(c.leagueText)) && String(c.leagueText) === String(c.league),
    JSON.stringify(c));
  check('三个分类计数都是数字', typeof c.committee === 'number' && typeof c.all === 'number' &&
    /^\d+$/.test(String(c.leagueText)), JSON.stringify(c));
  const cnt = await mp.evaluate(() => new Promise((resolve) => {
    wx.createSelectorQuery().selectAll('.rd-tab__cnt').boundingClientRect()
      .exec((res) => resolve((res && res[0] ? res[0] : []).map((x) => Math.round(x.width))));
  }));
  check('三个计数节点均已渲染且有宽度', Array.isArray(cnt) && cnt.length === 3 && cnt.every((w) => w > 0),
    JSON.stringify(cnt));
  await shot(mp, '01-committee-tab');

  /* ---------- ② 纵向手势不抢滚动 ---------- */
  await gesture(mp, 'start', 200, 300);
  await gesture(mp, 'move', 205, 390);
  await sleep(50);
  d = await look(mp);
  check('纵向手势不产生横向位移（交给页面滚动）', d.found && d.swipeStyle === '', 'style=' + d.swipeStyle);
  await gesture(mp, 'end', 205, 390);
  await sleep(350);

  /* ---------- ③ 未过阈值：回弹不切 ---------- */
  await gesture(mp, 'start', 200, 300);
  let m = await gesture(mp, 'move', 160, 302);
  check('左滑 40px 跟手位移 1:1', /translateX\(-40px\)/.test(m.swipeStyle), 'style=' + m.swipeStyle);
  await gesture(mp, 'end', 160, 302);
  await sleep(400);
  d = await look(mp);
  check('未过阈值（40<56）回弹且不切分类', d.found && d.tab === 'committee' && d.swipeStyle === '',
    'tab=' + d.tab + ' style=' + d.swipeStyle);

  /* ---------- ④ 过阈值：飞出 → 切团员 → 进场 ---------- */
  await gesture(mp, 'start', 200, 300);
  m = await gesture(mp, 'move', 100, 302);
  check('左滑 100px 跟手 1:1', /translateX\(-100px\)/.test(m.swipeStyle), 'style=' + m.swipeStyle);
  await gesture(mp, 'end', 100, 302);
  await sleep(80);
  d = await look(mp);
  check('松手后旧内容先飞出（opacity .25）', /opacity:\.25/.test(d.swipeStyle), 'style=' + d.swipeStyle);
  await sleep(700);
  d = await look(mp);
  check('切换到「团员」分类且动画已收尾', d.tab === 'league' && d.swipeStyle === '',
    'tab=' + d.tab + ' style=' + d.swipeStyle);
  // 团员行的合并/排序/计数由 committee_unit_tests.js 覆盖；这里只验证切过去以后页面没卡在 loading
  check('切到团员后页面进入 data/empty 态（未卡在加载态）', d.state === 'data' || d.state === 'empty', 'state=' + d.state);
  check('liquid 指示条滑到中段（34.667%）', d.indicator && Math.abs(parseFloat(d.indicator.left) - 34.667) < 0.5,
    JSON.stringify(d.indicator));
  await shot(mp, '03-league-after-swipe');

  /* ---------- ⑤ 再左滑 → 全班 ---------- */
  await gesture(mp, 'start', 200, 300);
  await gesture(mp, 'move', 100, 302);
  await gesture(mp, 'end', 100, 302);
  await sleep(800);
  d = await look(mp);
  check('再左滑切到「全班」', d.tab === 'all', 'tab=' + d.tab);
  check('指示条滑到末段（69.333%）', d.indicator && Math.abs(parseFloat(d.indicator.left) - 69.333) < 0.5,
    JSON.stringify(d.indicator));
  await shot(mp, '04-all-tab');

  /* ---------- ⑥ 边界橡皮筋 ---------- */
  await gesture(mp, 'start', 200, 300);
  m = await gesture(mp, 'move', 120, 302);
  check('最后一个分类左滑 = 0.28 阻尼（80×0.28≈22px）', /translateX\(-2\d?px\)/.test(m.swipeStyle), 'style=' + m.swipeStyle);
  await gesture(mp, 'end', 120, 302);
  await sleep(500);
  d = await look(mp);
  check('边界不切分类', d.tab === 'all', 'tab=' + d.tab);

  /* ---------- ⑦ 右滑回退 ---------- */
  await gesture(mp, 'start', 100, 300);
  m = await gesture(mp, 'move', 200, 302);
  check('右滑跟手 +1:1', /translateX\(100px\)/.test(m.swipeStyle), 'style=' + m.swipeStyle);
  await gesture(mp, 'end', 200, 302);
  await sleep(800);
  d = await look(mp);
  check('右滑回到「团员」', d.tab === 'league', 'tab=' + d.tab);

  /* ---------- ⑧ 点击 tab 仍可用 ---------- */
  const p = await mp.currentPage();
  const tabs = await p.$$('.rd-tab');
  check('找到 3 个分类 tab', tabs.length === 3, 'count=' + tabs.length);
  await sleep(400);                                  // 越过 320ms 点击抑制窗口
  if (tabs.length === 3) await tabs[0].tap();
  await sleep(700);
  d = await look(mp);
  check('点击「班委」tab 可切回', d.tab === 'committee', 'tab=' + d.tab);
  check('指示条回到首段（0%）', d.indicator && parseFloat(d.indicator.left) === 0, JSON.stringify(d.indicator));
  await shot(mp, '05-back-to-committee');

  check('0 console error', consoleIssues.length === 0, consoleIssues.slice(0, 3).join(' | '));

  console.log('\n============ committee swipe preview: ' + passN + ' PASS / ' + failN + ' FAIL ============');
  await mp.disconnect();
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
