/* committee_swipe_preview.js —— 名单页：左右滑动切分类 + 团员计数显示（automator 真实渲染/触摸）
 *
 * 用户 2026-11-19 要求：
 *   ①「增加名单的滑动切换功能和对应动效」；
 *   ②「修复团员名单在未打开时不显示数字的问题」。
 *
 * 只使用测试身份 + mock wx.request（不接触真实云端/网络，符合 AGENTS.md §0.7 只用测试账号）。
 *   · 进入 pages/committee/committee；
 *   · 断言三个分类的计数都是数字（团员未加载也显示 0 + 脉动占位，不空白）；
 *   · 真实触摸（el.touchstart/touchmove/touchend）：左滑切团员、再切全班、边界橡皮筋、右滑回退；
 *   · 点击 tab 仍可切换；liquid 指示条跟随；
 *   · 截图落 _shots_committee/。
 *
 * 前置：cli.bat auto --project <mp-class-tools> --port 9434 --auto-port 9424 --trust-project
 * 用法：node committee_swipe_preview.js
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
async function shot(mp, name) {
  const p = path.join(OUT, name + '.png');
  try { await mp.screenshot({ path: p }); console.log('SHOT  ' + p); return p; } catch (e) { console.log('SHOT-FAIL ' + name + ' :: ' + e.message); return ''; }
}
// 当前页数据（身份页切换瞬间可返回 null，由调用方重试）
async function pageData(mp) {
  return mp.evaluate(() => {
    const ps = getCurrentPages(); const pg = ps[ps.length - 1];
    if (!pg || !pg.data) return null;
    return {
      path: pg.route || pg.path,
      tab: pg.data.tab,
      swipeStyle: pg.data.swipeStyle || '',
      indicator: pg.data.indicator || null,
      counts: pg.data.counts || null,
      state: pg.data.state,
      list: (pg.data.list || []).map((x) => x.name)
    };
  }).catch(() => null);
}
// 等页面稳定在名单页 data/empty 态
async function waitCommittee(mp, tries) {
  for (let i = 0; i < (tries || 15); i++) {
    const d = await pageData(mp);
    if (d && d.path === 'pages/committee/committee' && (d.state === 'data' || d.state === 'empty')) return d;
    await sleep(400);
  }
  return null;
}
async function getEl(mp, sel, tries) {
  for (let i = 0; i < (tries || 10); i++) {
    try {
      const p = await mp.currentPage();
      if (p) { const el = await p.$(sel); if (el) return el; }
    } catch (e) { /* retry */ }
    await sleep(300);
  }
  return null;
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
    // 身份存储与 utils/identity.js::save 一致：JSON 字符串
    wx.setStorageSync('zq_class_identity', JSON.stringify({
      token: 'tok-qa-committee', sid: '3260799999', name: '测试账号',
      role: '', badge: '', is_admin: false, ts: 1
    }));
    // 精确匹配 RPC：只拦截名单/团员两个数据源，其余（含 visits / userdata / whoami）
    // 一律返回空成功，避免云端 401 → identity.onAuthExpired 清身份弹回身份页。
    wx.request = function (o) {
      const url = String(o.url || '');
      let data = {};
      if (url.indexOf('/rpc/class_members') >= 0) data = payload.members;
      else if (url.indexOf('/rpc/class_league') >= 0) data = [{ seats: payload.league }];
      else if (url.indexOf('/rpc/class_verify') >= 0) data = { ok: true };
      setTimeout(() => { o.success && o.success({ statusCode: 200, data: data }); }, 40);
    };
  }, { members: MEMBERS, league: LEAGUE });
}

async function openCommittee(mp) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await applyMock(mp);
    await sleep(250);
    // 走身份页正常链路（身份页检测到本机测试身份后自动进首页），再用 navigateTo 打开名单页
    await mp.reLaunch('/pages/identity/identity');
    await sleep(2200);
    try { await mp.navigateTo('/pages/committee/committee'); } catch (e) { /* 已在名单页 */ }
    const d = await waitCommittee(mp, 15);
    if (d) return d;
  }
  throw new Error('无法进入名单页（可能被身份页重定向 / 连接中断）');
}

// 元素几何（automator 无 boundingClientRect；用 offset + size）
async function geom(el) {
  const [off, size] = await Promise.all([el.offset(), el.size()]);
  return {
    left: Number(off.left) || 0,
    top: Number(off.top) || 0,
    width: parseFloat(size.width) || 300,
    height: parseFloat(size.height) || 300
  };
}

// 在 .rd-swipe 上用真实触摸事件做一次完整滑动，返回松手瞬间与之后的数据
async function doSwipe(mp, dx, opts) {
  opts = opts || {};
  const el = await getEl(mp, '.rd-swipe');
  if (!el) throw new Error('.rd-swipe 不存在');
  const box = await geom(el);
  const X = Math.round(box.left + box.width / 2);
  const Y = Math.round(box.top + Math.min(box.height / 3, 120));
  const steps = opts.steps || 8;
  await el.touchstart({ touches: [{ identifier: 0, clientX: X, clientY: Y, pageX: X, pageY: Y }] });
  await sleep(30);
  for (let i = 1; i <= steps; i++) {
    const cx = X + Math.round(dx * i / steps);
    await el.touchmove({ touches: [{ identifier: 0, clientX: cx, clientY: Y + 2, pageX: cx, pageY: Y + 2 }] });
    await sleep(16);
  }
  const mid = await pageData(mp);
  await el.touchend({ touches: [], changedTouches: [{ identifier: 0, clientX: X + dx, clientY: Y + 2, pageX: X + dx, pageY: Y + 2 }] });
  await sleep(opts.settle || 750);
  const after = await pageData(mp);
  return { X, Y, box, mid, after };
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  mp.on('console', (msg) => {
    if (msg && msg.type === 'error') consoleIssues.push(String(msg.args ? msg.args.join(' ') : msg));
  });

  let d = await openCommittee(mp);
  check('进入名单页并渲染', !!d && d.state === 'data' && d.tab === 'committee',
    JSON.stringify(d && { tab: d.tab, state: d.state, n: d.list.length }));

  /* ---------- ① 计数：三个分类都显示数字 ---------- */
  // 与夹具无关的断言：只看「有没有数字」，不依赖云端实际人数（读的是本机缓存/云端真实名单）
  check('团员计数显示为数字（不再是空字符串）',
    d && d.counts && /^\d+$/.test(String(d.counts.leagueText)) && String(d.counts.leagueText) === String(d.counts.league),
    JSON.stringify(d && d.counts));
  check('三个分类计数都是数字', d && d.counts &&
    typeof d.counts.committee === 'number' && typeof d.counts.all === 'number' && /^\d+$/.test(String(d.counts.leagueText)),
    JSON.stringify(d && d.counts));

  // 计数文字节点的真实渲染宽度（>0 说明没被留白吞掉）
  const cnt = await mp.evaluate(() => {
    return new Promise((resolve) => {
      const q = wx.createSelectorQuery();
      q.selectAll('.rd-tab__cnt').boundingClientRect();
      q.exec((res) => resolve((res && res[0] ? res[0] : []).map((x) => ({ w: Math.round(x.width), t: x.top || 0 }))));
    });
  });
  check('三个计数节点均已渲染且有宽度', Array.isArray(cnt) && cnt.length === 3 && cnt.every((x) => x.w > 0),
    JSON.stringify(cnt));
  await shot(mp, '01-committee-tab');

  /* ---------- ② 纵向手势不抢滚动 ---------- */
  {
    const el = await getEl(mp, '.rd-swipe');
    const box = await geom(el);
    const X = Math.round(box.left + box.width / 2), Y = Math.round(box.top + 40);
    await el.touchstart({ touches: [{ identifier: 0, clientX: X, clientY: Y, pageX: X, pageY: Y }] });
    await el.touchmove({ touches: [{ identifier: 0, clientX: X + 4, clientY: Y + 90, pageX: X + 4, pageY: Y + 90 }] });
    await sleep(60);
    const mid = await pageData(mp);
    check('纵向手势不产生横向位移（交给页面滚动）', mid && mid.swipeStyle === '', 'style=' + (mid && mid.swipeStyle));
    await el.touchend({ touches: [], changedTouches: [{ identifier: 0, clientX: X + 4, clientY: Y + 90, pageX: X + 4, pageY: Y + 90 }] });
    await sleep(400);
  }

  /* ---------- ③ 未过阈值：回弹，不切 ---------- */
  {
    const r = await doSwipe(mp, -40, { steps: 5 });
    check('左滑 40px 跟手位移', r.mid && /translateX\(-4\d?px\)/.test(r.mid.swipeStyle), 'style=' + (r.mid && r.mid.swipeStyle));
    check('未过阈值（40<56）回弹且不切分类', r.after && r.after.tab === 'committee' && r.after.swipeStyle === '',
      'tab=' + (r.after && r.after.tab) + ' style=' + (r.after && r.after.swipeStyle));
  }

  /* ---------- ④ 过阈值：旧内容飞出 → 切团员 → 新内容进场 ---------- */
  {
    const el = await getEl(mp, '.rd-swipe');
    const box = await geom(el);
    const X = Math.round(box.left + box.width / 2), Y = Math.round(box.top + Math.min(box.height / 3, 120));
    await el.touchstart({ touches: [{ identifier: 0, clientX: X, clientY: Y, pageX: X, pageY: Y }] });
    await sleep(30);
    for (let i = 1; i <= 10; i++) {
      await el.touchmove({ touches: [{ identifier: 0, clientX: X - i * 10, clientY: Y + 2, pageX: X - i * 10, pageY: Y + 2 }] });
      await sleep(16);
    }
    const mid = await pageData(mp);
    check('左滑 100px 跟手 1:1', mid && /translateX\(-100px\)/.test(mid.swipeStyle), 'style=' + (mid && mid.swipeStyle));
    await el.touchend({ touches: [], changedTouches: [{ identifier: 0, clientX: X - 100, clientY: Y + 2, pageX: X - 100, pageY: Y + 2 }] });
    await sleep(60);
    const fly = await pageData(mp);
    check('松手后旧内容先飞出（opacity .25）', fly && /opacity:\.25/.test(fly.swipeStyle), 'style=' + (fly && fly.swipeStyle));
    await sleep(130);
    const midTab = await pageData(mp);
    check('~150ms 后切到「团员」分类', midTab && midTab.tab === 'league', 'tab=' + (midTab && midTab.tab));
    await shot(mp, '02-flight-into-league');
    await sleep(600);
    d = await pageData(mp);
    check('动画结束清空内联样式', d && d.swipeStyle === '', 'style=' + (d && d.swipeStyle));
    check('团员分类列出 3 人', d && d.list.length === 3, JSON.stringify(d && d.list));
    check('liquid 指示条滑到中段', d && d.indicator && Math.abs(parseFloat(d.indicator.left) - 34.667) < 0.5,
      JSON.stringify(d && d.indicator));
  }
  await shot(mp, '03-league-after-swipe');

  /* ---------- ⑤ 再左滑 → 全班；⑥ 边界橡皮筋 ---------- */
  {
    const r = await doSwipe(mp, -100);
    check('再左滑切到「全班」', r.after && r.after.tab === 'all', 'tab=' + (r.after && r.after.tab));
    check('全班 5 人', r.after && r.after.list.length === 5, JSON.stringify(r.after && r.after.list));
    check('指示条滑到末段', r.after && r.after.indicator && Math.abs(parseFloat(r.after.indicator.left) - 69.333) < 0.5,
      JSON.stringify(r.after && r.after.indicator));
  }
  await shot(mp, '04-all-tab');
  {
    const r = await doSwipe(mp, -80);
    check('最后一个分类左滑 = 0.28 阻尼（80×0.28≈22px）', r.mid && /translateX\(-2\d?px\)/.test(r.mid.swipeStyle),
      'style=' + (r.mid && r.mid.swipeStyle));
    check('边界不切分类', r.after && r.after.tab === 'all', 'tab=' + (r.after && r.after.tab));
  }

  /* ---------- ⑦ 右滑回退 ---------- */
  {
    const r = await doSwipe(mp, 100);
    check('右滑回到「团员」', r.after && r.after.tab === 'league', 'tab=' + (r.after && r.after.tab));
  }

  /* ---------- ⑧ 点击 tab 仍可用 ---------- */
  {
    const p = await mp.currentPage();
    const tabs = await p.$$('.rd-tab');
    check('找到 3 个分类 tab', tabs.length === 3, 'count=' + tabs.length);
    await sleep(400);                              // 越过 320ms 点击抑制窗口
    await tabs[0].tap();
    await sleep(600);
    d = await pageData(mp);
    check('点击「班委」tab 可切回', d && d.tab === 'committee', 'tab=' + (d && d.tab));
    check('指示条回到首段', d && d.indicator && parseFloat(d.indicator.left) === 0, JSON.stringify(d && d.indicator));
  }
  await shot(mp, '05-back-to-committee');

  check('0 console error', consoleIssues.length === 0, consoleIssues.slice(0, 3).join(' | '));

  console.log('\n============ committee swipe preview: ' + passN + ' PASS / ' + failN + ' FAIL ============');
  await mp.disconnect();
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
