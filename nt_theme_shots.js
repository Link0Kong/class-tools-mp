/* nt_theme_shots.js —— 小程序「班级通知」页双主题定点截图（改色前基线 / 改色后回归共用）
 *
 * 用法：
 *   node nt_theme_shots.js light after      # 浅色主题 · 改色后
 *   node nt_theme_shots.js dark  after      # 深色主题 · 改色后
 *   node nt_theme_shots.js light before     # 浅色主题 · 改色前（本机 before 复用 _shots/nt 旧图，可不跑）
 *
 * 前置：
 *   1) 微信开发者工具已启动并打开 mp-class-tools 项目
 *   2) cli.bat auto --project C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools --auto-port 9420 --trust-project
 *      （9420 被占用时 CLI 会顺延端口，本脚本自动探测 9420–9440；也可 NT_WS=ws://127.0.0.1:9433 指定）
 *   3) 模拟器主题已切到目标主题（切换步骤见 _shots_color/HOWTO.md §4）
 *      深色切换：模拟器工具条「📱 device 图标 → 主题 → 深色」，切完 mp.systemInfo().theme 必须为 dark。
 *      若 IDE 被并行任务占用（身份 RPC 报「名单不匹配」/ 连接被打断），深色改用
 *      _shots_color/after/_dark_capture.js（真实数据注入方案，见 HOWTO §5）。
 *
 * 脚本会先校验 mp.systemInfo().theme 与参数一致，不一致直接退出（exit 3），不会拍出错误主题的图。
 *
 * 输出：
 *   _shots_color/<phase>/<theme>/01-top.png
 *                               /02-list.png
 *                               /03-expanded.png
 *                               /04-expired.png
 *                               /05-raw-sheet.png
 *                               /06-filters.png（有分类筛选时）
 *                               /_result.json
 *   _shots_color/<phase>/_result.json（两种主题的汇总，自动合并）
 *
 * 说明：清空 storage + store reset → 真实班级身份（测试账号 / 3260799999）登录 → 通知页读取云端真实通知（只读）。
 *      若身份/云端不可用，脚本会用 utils/store.js 注入本地 fixture 通知后继续截图，并在 _result.json 标记 fixture=true。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const themeArg = (process.argv[2] || 'light').toLowerCase();
const phase = (process.argv[3] || 'after').toLowerCase();
if (themeArg !== 'light' && themeArg !== 'dark') {
  console.error('用法: node nt_theme_shots.js <light|dark> <before|after>');
  process.exit(2);
}
if (phase !== 'before' && phase !== 'after') {
  console.error('用法: node nt_theme_shots.js <light|dark> <before|after>');
  process.exit(2);
}

const ROOT = path.join(__dirname, '_shots_color', phase);
const OUT = path.join(ROOT, themeArg);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const consoleIssues = [];
const shots = [];
let fixtureUsed = false;
let dataSummary = {};

function log(msg) { console.log(msg); }
function fail(msg) { console.error('FAIL  ' + msg); }

async function curPage(mp) { try { return await mp.currentPage(); } catch (e) { return null; } }
async function curPath(mp) { const p = await curPage(mp); return p ? p.path : ''; }
async function waitPath(mp, expect, timeout) {
  const end = Date.now() + (timeout || 9000);
  while (Date.now() < end) {
    if ((await curPath(mp)) === expect) return true;
    await sleep(250);
  }
  return false;
}
async function ev(mp, fn, arg, tries) {
  let last = null;
  const n = tries || 3;
  for (let i = 0; i < n; i++) {
    try { return await mp.evaluate(fn, arg); } catch (e) { last = e; await sleep(1200); }
  }
  throw last;
}
async function shot(mp, name, note, waitMs) {
  await sleep(waitMs == null ? 600 : waitMs);
  const file = path.join(OUT, name + '.png');
  await mp.screenshot({ path: file });
  const st = fs.statSync(file);
  const pageState = await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    if (!pg || !pg.data) return {};
    return {
      path: pg.route || '',
      state: pg.data.state,
      filter: pg.data.filter,
      cat: pg.data.cat,
      listCount: pg.data.listCount,
      cards: (pg.data.cards || []).length,
      expiredCards: (pg.data.expiredCards || []).length,
      showExpired: pg.data.showExpired,
      rawSheet: pg.data.rawSheet
    };
  }).catch(() => ({}));
  shots.push({ name: name, file: path.relative(__dirname, file).replace(/\\/g, '/'), bytes: st.size, note: note || '', page: pageState });
  log('SHOT  ' + name + '.png  (' + Math.round(st.size / 1024) + ' KB)  ' + (note || ''));
}

function writeResult(extra) {
  const result = {
    at: new Date().toISOString(),
    phase: phase,
    theme: themeArg,
    device: dataSummary.systemInfo ? (dataSummary.systemInfo.screenWidth + 'x' + dataSummary.systemInfo.screenHeight + ' @' + dataSummary.systemInfo.pixelRatio + 'x') : null,
    systemInfo: dataSummary.systemInfo || null,
    shots: shots,
    dataSummary: dataSummary,
    fixture: fixtureUsed,
    consoleIssues: consoleIssues,
    ok: shots.length >= 5 && !(extra && extra.fatal),
    error: (extra && extra.error) || null
  };
  fs.writeFileSync(path.join(OUT, '_result.json'), JSON.stringify(result, null, 2), 'utf8');
  // 合并到 phase 级汇总
  const aggPath = path.join(ROOT, '_result.json');
  let agg = {};
  try { agg = JSON.parse(fs.readFileSync(aggPath, 'utf8')); } catch (e) {}
  agg.at = new Date().toISOString();
  agg[themeArg] = {
    ok: result.ok,
    theme: themeArg,
    shotCount: shots.length,
    fixture: fixtureUsed,
    error: result.error,
    consoleIssues: consoleIssues.length
  };
  fs.writeFileSync(aggPath, JSON.stringify(agg, null, 2), 'utf8');
}

/* 本地 fixture：仅当真实身份/云端不可用时降级，保证页面有真实密度内容可看 */
const FIXTURE = [
  {
    id: 'fx_1', title: '关于本周班会时间调整的通知', cat: '班级事务', source: '班级群',
    senderName: '测试账号', senderRole: '副团支书', timeLabel: '11-06',
    aiSummary: '原定周三晚的班会调整到周四 19:00，地点教学楼 A301，请全体同学准时参加。',
    aiPoints: ['时间：周四 19:00', '地点：教学楼 A301', '对象：全班同学'],
    aiSegments: [{ type: '时间', text: '周四 19:00' }, { type: '地点', text: '教学楼 A301' }],
    items: [
      { kind: 'text', text: '原定周三晚的班会调整到周四 19:00，地点教学楼 A301，请全体同学准时参加。' },
      { kind: 'file', name: '班会流程安排.pdf', size: 102400 },
      { kind: 'link', title: '校园地图', url: 'https://example.com/map' }
    ],
    ts: Date.now() - 3600e3 * 8
  },
  {
    id: 'fx_2', title: '青年大学习第 12 期学习通知', cat: '团学工作', source: '班级群',
    senderName: '测试账号', senderRole: '团支书', timeLabel: '11-05',
    aiSummary: '请在 11-08 前完成青年大学习第 12 期，截图提交到班级共享文档。',
    aiPoints: ['截止 11-08', '完成后提交截图'],
    aiSegments: [{ type: '截止', text: '11-08' }],
    items: [{ kind: 'text', text: '请在 11-08 前完成青年大学习第 12 期，截图提交到班级共享文档。' }],
    ts: Date.now() - 3600e3 * 30
  },
  {
    id: 'fx_3', title: '体测补测安排（已截止）', cat: '体测', source: '班级群',
    senderName: '体育委员', senderRole: '', timeLabel: '10-28',
    aiSummary: '体测补测已于 10-30 结束，未参加的同学请联系体育委员。',
    aiPoints: ['补测已结束'],
    aiSegments: [], items: [{ kind: 'text', text: '体测补测已于 10-30 结束。' }],
    ts: Date.now() - 86400e3 * 9
  }
];

/* 连接 automator：cli auto 指定的端口可能不是 9420（端口被占时会顺延），这里自动探测 9420–9440；
 * 也可用环境变量 NT_WS=ws://127.0.0.1:9432 显式指定。 */
async function connectAny() {
  if (process.env.NT_WS) {
    const mp = await automator.connect({ wsEndpoint: process.env.NT_WS });
    log('已连接 ' + process.env.NT_WS);
    return mp;
  }
  for (let port = 9420; port <= 9440; port++) {
    try {
      const mp = await Promise.race([
        automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + port }),
        new Promise((resolve, reject) => setTimeout(() => reject(new Error('connect-timeout')), 3500))
      ]);
      log('已连接 ws://127.0.0.1:' + port);
      return mp;
    } catch (e) { /* 换下一个端口 */ }
  }
  throw new Error('无法连接 automator（9420–9440 均失败）。请先运行 cli.bat auto --project <项目> --auto-port 9420 --trust-project');
}

/* 真实身份登录（含 2 次重试：并发任务可能临时 patch wx.request / 清 storage） */
async function loginFlow(mp) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await ev(mp, () => {
      try { wx.clearStorageSync(); } catch (e) {}
      try { require('utils/store.js').reset(); } catch (e) {}
      try { require('utils/flow.js').clearFlow(); } catch (e) {}
    });
    await mp.reLaunch('/pages/identity/identity');
    await waitPath(mp, 'pages/identity/identity', 9000);
    await sleep(900);
    const p = await curPage(mp);
    const inputs = p ? await p.$$('input') : [];
    if (inputs.length >= 2) {
      await inputs[0].input('测试账号'); await sleep(160);
      await inputs[1].input('3260799999'); await sleep(260);
    } else {
      fail('身份页 input 不足 2 个（' + inputs.length + '）');
    }
    await ev(mp, () => { const ps = getCurrentPages(); const pg = ps[ps.length - 1]; if (pg && pg.submit) pg.submit(); });
    for (let i = 0; i < 40; i++) { await sleep(300); if ((await curPath(mp)) === 'pages/index/index') return true; }
    const err = await ev(mp, () => { const ps = getCurrentPages(); const pg = ps[ps.length - 1]; return (pg && pg.data && pg.data.err) || ''; }).catch(() => '');
    fail('身份验证未进入工作台（第 ' + attempt + ' 次）：' + err);
    await sleep(1500);
  }
  return false;
}

(async () => {
  const mp = await connectAny();
  mp.on('exception', (e) => consoleIssues.push('exception: ' + JSON.stringify(e).slice(0, 400)));
  mp.on('console', (e) => { if (e && e.type === 'error') consoleIssues.push('error: ' + (e.args || []).map(String).join(' ').slice(0, 400)); });
  await sleep(1200);

  /* ---------- 0. 主题校验（最重要：截图必须真的是目标主题） ---------- */
  const sys = await mp.systemInfo();
  dataSummary.systemInfo = { theme: sys.theme, screenWidth: sys.screenWidth, screenHeight: sys.screenHeight, windowWidth: sys.windowWidth, windowHeight: sys.windowHeight, pixelRatio: sys.pixelRatio, SDKVersion: sys.SDKVersion, platform: sys.platform };
  log('systemInfo.theme = ' + sys.theme + ' | 设备 ' + sys.screenWidth + 'x' + sys.screenHeight + ' @' + sys.pixelRatio + 'x');
  if (sys.theme !== themeArg) {
    const msg = '主题不匹配：要求 ' + themeArg + '，实际 mp.systemInfo().theme = ' + sys.theme + '。请先按 _shots_color/HOWTO.md 切换模拟器主题。';
    fail(msg);
    writeResult({ fatal: true, error: msg });
    await mp.disconnect();
    process.exit(3);
  }

  /* ---------- 1+2. 清 storage + store reset + 真实班级身份登录（含重试） ---------- */
  const toIndex = await loginFlow(mp);
  log('身份登录: ' + (toIndex ? 'OK（测试账号）' : 'FAILED'));
  let p;

  /* ---------- 3. 打开通知页，等加载完成 ---------- */
  p = await mp.navigateTo('/pages/nt/nt');
  await waitPath(mp, 'pages/nt/nt', 9000);
  let ready = false;
  for (let i = 0; i < 50; i++) {
    await sleep(400);
    const st = await ev(mp, () => { const pg = getCurrentPages()[getCurrentPages().length - 1]; return pg ? pg.data.state : ''; }).catch(() => '');
    if (st === 'ready') { ready = true; break; }
    if (st === 'error') break;
  }
  await sleep(1400);
  let d = await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    return {
      state: pg.data.state, errorText: pg.data.errorText,
      cards: (pg.data.cards || []).length,
      expiredCards: (pg.data.expiredCards || []).length,
      expiredCount: pg.data.expiredCount,
      listCount: pg.data.listCount,
      filter: pg.data.filter, cat: pg.data.cat, cats: pg.data.cats,
      stats: pg.data.stats, briefNext: (pg.data.briefNext || []).length,
      showExpired: pg.data.showExpired
    };
  });
  dataSummary.notice = d;
  log('通知页: state=' + d.state + ' cards=' + d.cards + ' expired=' + d.expiredCards + ' listCount=' + d.listCount + ' cats=' + JSON.stringify(d.cats));

  /* ---------- 3b. fixture 降级（仅真实数据拿不到时） ---------- */
  if (!ready || d.cards + d.expiredCards === 0) {
    fixtureUsed = true;
    log('真实通知不可用（state=' + d.state + '），注入本地 fixture 降级');
    await ev(mp, (FIXTURE) => {
      const store = require('utils/store.js');
      const s = store.get();
      s.notices = FIXTURE.map((x) => Object.assign({}, x, { pin: false, imp: false }));
      try { store.save(); } catch (e) {}
    }, FIXTURE);
    await mp.reLaunch('/pages/nt/nt');
    for (let i = 0; i < 30; i++) { await sleep(400); const st = await ev(mp, () => { const pg = getCurrentPages()[getCurrentPages().length - 1]; return pg ? pg.data.state : ''; }).catch(() => ''); if (st === 'ready') break; }
    await sleep(1200);
    d = await ev(mp, () => {
      const pg = getCurrentPages()[getCurrentPages().length - 1];
      return { state: pg.data.state, cards: (pg.data.cards || []).length, expiredCards: (pg.data.expiredCards || []).length, expiredCount: pg.data.expiredCount, listCount: pg.data.listCount, filter: pg.data.filter, cat: pg.data.cat, cats: pg.data.cats, stats: pg.data.stats, briefNext: (pg.data.briefNext || []).length, showExpired: pg.data.showExpired };
    });
    dataSummary.notice = d;
  }

  /* 页面视口高度（滚动用） */
  const vh = await ev(mp, () => { try { return wx.getSystemInfoSync().windowHeight; } catch (e) { return 600; } });
  dataSummary.viewportHeight = vh;

  /* ---------- 4a. 01-top：简报 + 筛选 + 第一张卡 ---------- */
  await ev(mp, () => { try { wx.pageScrollTo({ scrollTop: 0, duration: 0 }); } catch (e) {} });
  await sleep(700);
  await shot(mp, '01-top', '简报统计 + 筛选条 + 第一张通知卡', 600);

  /* ---------- 4b. 02-list：向下滚约一屏，卡片列表 / AI 摘要 ---------- */
  await ev(mp, (top) => { try { wx.pageScrollTo({ scrollTop: top, duration: 260 }); } catch (e) {} }, Math.round(vh * 0.92));
  await sleep(1100);
  await shot(mp, '02-list', '下滚约一屏：卡片列表 / AI 摘要', 600);

  /* ---------- 4c. 03-expanded：展开有详情的卡（分段 / 附件 / 原文摘录） ---------- */
  const target = await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    const list = (pg.data.cards || []).filter((c) => !c.expired);
    const score = (c) => (c.segs && c.segs.length ? 4 : 0) + (c.items && c.items.length ? 3 : 0) + (c.filesCount ? 2 : 0) + (c.imgCount ? 1 : 0) + (c.summary ? 1 : 0);
    let best = null;
    list.forEach((c) => { if (c.hasDetail && (!best || score(c) > score(best))) best = c; });
    if (!best) best = list[0] || (pg.data.cards || [])[0] || null;
    if (!best) return null;
    // 保证展开（活跃卡默认展开；若被用户收起过则重新展开）
    if (!best.expanded) {
      try { pg._expanded[best.id] = true; pg.patchCard(best.id, { expanded: true, closing: false }); } catch (e) {}
    }
    return { id: best.id, title: best.title, segs: (best.segs || []).length, items: (best.items || []).length, filesCount: best.filesCount, imgCount: best.imgCount };
  });
  if (target) {
    log('03-expanded 目标卡: ' + target.title + ' (segs=' + target.segs + ' items=' + target.items + ')');
    await ev(mp, (gid) => {
      const pg = getCurrentPages()[getCurrentPages().length - 1];
      try { if (pg._scrollToCard) return pg._scrollToCard(gid); } catch (e) {}
      return new Promise((resolve) => {
        setTimeout(() => {
          const q = wx.createSelectorQuery();
          q.select('#card-' + ('c_' + String(gid == null ? '' : gid).replace(/[^A-Za-z0-9_-]/g, '_'))).boundingClientRect();
          q.selectViewport().scrollOffset();
          q.exec(function (res) {
            const rect = res && res[0];
            const st = (res && res[1] && res[1].scrollTop) || 0;
            const top = rect ? rect.top + st - 120 : 400;
            try { wx.pageScrollTo({ scrollTop: Math.max(0, top), duration: 0 }); } catch (e) {}
            setTimeout(resolve, 250);
          });
        }, 500);
      });
    }, target.id);
    await sleep(1200);
    await shot(mp, '03-expanded', '展开卡详情：分段 / 附件 / 原文摘录', 700);
  } else {
    log('SKIP  03-expanded（当前无可用卡片）');
  }

  /* ---------- 4d. 04-expired：筛选「已截止」 ---------- */
  const expInfo = await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    pg.pickFilter({ currentTarget: { dataset: { f: 'expired' } } });
    return true;
  });
  if (expInfo) {
    await sleep(1100);
    await ev(mp, () => { try { wx.pageScrollTo({ scrollTop: 0, duration: 0 }); } catch (e) {} });
    await sleep(500);
    await shot(mp, '04-expired', '筛选「已截止」：过期通知列表', 600);
    await ev(mp, () => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.pickFilter({ currentTarget: { dataset: { f: 'active' } } }); });
    await sleep(900);
  }

  /* ---------- 4e. 05-raw-sheet：「原始消息」bottom-sheet ---------- */
  const rawGid = await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    const all = (pg.data.cards || []).concat(pg.data.expiredCards || []);
    const c = all.filter((x) => x.hasRaw)[0];
    if (!c) return '';
    pg.openRaw({ currentTarget: { dataset: { gid: c.id } } });
    return c.id;
  });
  let rawOk = false;
  if (rawGid) {
    for (let i = 0; i < 15; i++) {
      await sleep(300);
      rawOk = !!(await ev(mp, () => { const pg = getCurrentPages()[getCurrentPages().length - 1]; return pg.data.rawSheet; }).catch(() => false));
      if (rawOk) break;
    }
    if (rawOk) {
      await sleep(900);
      await shot(mp, '05-raw-sheet', '原始消息 bottom-sheet', 700);
      await ev(mp, () => { const pg = getCurrentPages()[getCurrentPages().length - 1]; if (pg.closeRaw) pg.closeRaw(); });
      await sleep(600);
    } else {
      log('SKIP  05-raw-sheet（弹层未打开）');
    }
  } else {
    log('SKIP  05-raw-sheet（无 hasRaw 卡片）');
  }

  /* ---------- 4f. 06-filters（可选）：切分类筛选 ---------- */
  try {
    const catName = await ev(mp, () => {
      const pg = getCurrentPages()[getCurrentPages().length - 1];
      const cats = (pg.data.cats || []).filter((x) => x !== '全部');
      if (!cats.length) return '';
      pg.pickCat({ currentTarget: { dataset: { c: cats[0] } } });
      return cats[0];
    });
    if (catName) {
      await sleep(1100);
      await ev(mp, () => { try { wx.pageScrollTo({ scrollTop: 0, duration: 0 }); } catch (e) {} });
      await sleep(500);
      await shot(mp, '06-filters', '分类筛选：' + catName, 600);
      await ev(mp, () => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.pickCat({ currentTarget: { dataset: { c: '全部' } } }); });
      await sleep(500);
    } else {
      log('SKIP  06-filters（无分类筛选）');
    }
  } catch (e) {
    log('SKIP  06-filters（' + e.message + '）');
  }

  /* ---------- 5. 收尾 ---------- */
  await ev(mp, () => {
    try { wx.clearStorageSync(); } catch (e) {}
    try { require('utils/store.js').reset(); } catch (e) {}
  }).catch(() => {});

  const finalTheme = await mp.systemInfo();
  dataSummary.finalTheme = finalTheme.theme;

  writeResult();
  log('\nDONE  phase=' + phase + ' theme=' + themeArg + ' (systemInfo=' + finalTheme.theme + ') shots=' + shots.length + ' fixture=' + fixtureUsed + ' consoleIssues=' + consoleIssues.length);
  if (consoleIssues.length) log(JSON.stringify(consoleIssues.slice(0, 8), null, 2));
  await mp.disconnect();
  process.exit(shots.length >= 5 && finalTheme.theme === themeArg ? 0 : 4);
})().catch((e) => {
  console.error('NT THEME SHOTS FATAL', e && e.stack || e);
  try { writeResult({ fatal: true, error: String(e && e.message || e) }); } catch (e2) {}
  process.exit(1);
});
