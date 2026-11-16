/* tt_entry_preview.js —— 小程序「课表进入速度」回归（automator 真实渲染/截图，不接触真实云端/网络）
 *
 * 2026-11-06 用户反馈：「优化课表加载速度，例如先加载当前周保障进入速度」。
 * 旧行为（已修复，本脚本防回退）：pages/tt/tt.js onShow 先 loadCached() 同步渲染本机缓存，
 * 随后**无条件** setData({state:'loading'}) 把已渲染的当前周课表盖成「课表加载中…」骨架，
 * 且 120ms 后才发 tt.json 请求；ttFetch 有 6h TTL，TTL 过期时走网络 0.5–2s → 有缓存也要等。
 * 新行为：本机有课表（ttCache / 旧 course）→ 进入即显示当前周（不出现骨架），后台静默刷新
 * （成功才更新、失败保留缓存）；本机无课表 → 才显示骨架；请求在 onShow 同步发出（无 120ms 人为延迟）。
 *
 * 本脚本用 mock 身份 + mock wx.request（tt.json 人为延迟 800ms）+ 预置 store.ttCache：
 *   A. 有缓存场景：reLaunch('/pages/tt/tt') 后不等待网络采样页面 data 并截图，
 *      断言首帧即为「当前周课表」（state=data / rows>0 / 星期列 / 第 N 周 / 来源=本机），
 *      且该时刻 tt.json 尚未返回（resp=0）→ 证明渲染来自本机缓存而非网络；
 *      网络 800ms 返回后静默更新（课程数/来源文案变化），过程无骨架闪烁。
 *   B. 无缓存对照：同样的 800ms 网络延迟，先看到「课表加载中…」骨架，再转 data。
 *
 * 只使用微信开发者工具自动化接口（miniprogram-automator）：mp.screenshot、mp.evaluate、
 * page.data / DOM 断言；不使用 pyautogui / 屏幕 / 鼠标自动化，不跑 cli preview / auto-preview，
 * 不推送真机。另一会话占用 devtools 时**不要运行**本脚本，由 Lead 统一在 automator 会话里跑。
 *
 * 前置（Lead 跑）：
 *   cli.bat auto --project C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools --auto-port 9420 --trust-project
 * 用法：
 *   node tt_entry_preview.js                 # 默认 ws://127.0.0.1:9420
 *   set TT_ENTRY_WS=ws://127.0.0.1:9421 && node tt_entry_preview.js
 * 产出：
 *   _shots_tt_entry/00-cache-entry-current-week.png     有缓存：reLaunch 后首帧即当前周课表
 *   _shots_tt_entry/01-no-cache-skeleton.png            无缓存：对照骨架「课表加载中…」
 *   _shots_tt_entry/02-no-cache-after-network.png       无缓存：网络返回后转 data
 *   _shots_tt_entry/03-cache-after-network.png          有缓存：网络返回后静默更新
 *   _shots_tt_entry/result.json                         checks / 时间戳 / 截图 / console 错误
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const WS = process.env.TT_ENTRY_WS || 'ws://127.0.0.1:9420';
const OUT = path.join(__dirname, '_shots_tt_entry');
fs.mkdirSync(OUT, { recursive: true });
const NET_DELAY = 800;                       // mock tt.json 延迟：足以区分「缓存首帧」与「网络返回」
// 场景 B（无缓存对照组）需在 devtools 的 reLaunch 异步完成「之后」仍能观察到骨架，
// 而 devtools 页面创建/reLaunch 返回实测可达 1–2s+；因此 B 单独用更长的 mock 延迟（仍为纯本地 mock，
// 不影响 A 场景的 800ms 首帧早于网络的断言）。Lead 2026-11-06 实跑后修正：B_DELAY=4000。
const B_DELAY = 4000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
const consoleIssues = [];
let passN = 0, failN = 0;
function check(name, ok, detail) {
  checks.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 600) });
  if (ok) passN++; else failN++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}
function skip(name, detail) {
  checks.push({ name: name, ok: true, skipped: true, detail: detail == null ? '' : String(detail).slice(0, 600) });
  console.log('SKIP  ' + name + (detail ? ' :: ' + detail : ''));
}
async function shot(mp, name) {
  const p = path.join(OUT, name + '.png');
  try { await mp.screenshot({ path: p }); console.log('SHOT  ' + p); return p; }
  catch (e) { console.log('SHOT-FAIL ' + name + ' :: ' + e.message); return ''; }
}
async function curPage(mp) { try { return await mp.currentPage(); } catch (e) { return null; } }
async function curPath(mp) { const p = await curPage(mp); return p ? p.path : ''; }

/* ---------- 页面采样：data 关键字段 + mock/计时状态（一次 evaluate） ---------- */
async function sample(mp) {
  return mp.evaluate(() => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    if (!pg || !pg.data) return null;
    const d = pg.data || {};
    const E = globalThis.__ttEntry || {};
    return {
      at: Date.now(),
      path: pg.route || pg.__route__ || '',
      state: d.state,
      wk: d.wk,
      weekLabel: d.weekLabel,
      total: d.total,
      rows: (d.rows || []).length,
      days: (d.dayCols || []).length,
      heads: (d.head || []).map((h) => h.n),
      srcText: d.srcText,
      view: d.view,
      E: {
        onShowAt: E.onShowAt || 0,
        loadingSetAt: E.loadingSetAt || 0,
        firstDataAt: E.firstDataAt || 0,
        shownRows: E.shownRows == null ? -1 : E.shownRows,
        shownWk: E.shownWk == null ? null : E.shownWk,
        shownTotal: E.shownTotal == null ? -1 : E.shownTotal,
        shownDays: E.shownDays == null ? -1 : E.shownDays,
        shownSrc: E.shownSrcText || '',
        states: (E.setDataStates || []).slice(-12),
        req: E.reqCount || 0,
        resp: E.respCount || 0,
        reqAt: E.reqAt || 0,
        respAt: E.respAt || 0,
        delayMs: E.delayMs || 0
      }
    };
  });
}

/* ---------- 安装 mock：身份 / 预置 ttCache（或无缓存）/ wx.request（tt.json 延迟）/ Page 计时钩子 ---------- */
async function installMock(mp, opts) {
  return mp.evaluate((cfg) => {
    const pad = (n) => (n < 10 ? '0' : '') + n;
    const fmt = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const term = new Date();
    term.setDate(term.getDate() - 28);                 // 28 天前开学 → 当前 = 第 5 周
    const termStart = fmt(term);
    const now = Date.now();
    try { wx.setStorageSync('zq_class_identity', JSON.stringify(cfg.id)); } catch (e) { /* ignore */ }
    if (cfg.ttCache) {
      // 预置本机课表缓存（termStart 用页面侧的「28 天前」→ 进入即第 5 周）
      const tc = Object.assign({}, cfg.ttCache, { t: termStart });
      try { wx.setStorageSync('zq_tools_v2', JSON.stringify({ ttCache: tc })); } catch (e) { /* ignore */ }
    } else {
      try { wx.setStorageSync('zq_tools_v2', JSON.stringify({})); } catch (e) { /* ignore */ }
    }
    // 清掉分块缓存里的 lastSync 清单 → ttFetch 不会命中 6h TTL 而直接走网络（受控 800ms 延迟）
    try {
      const info = wx.getStorageInfoSync();
      (info.keys || []).forEach((k) => { if (String(k).indexOf('zqc1_') === 0) wx.removeStorageSync(k); });
    } catch (e) { /* ignore */ }

    globalThis.__ttEntry = {
      installedAt: now, termStart: termStart, delayMs: cfg.delayMs || 800,
      onShowAt: 0, loadingSetAt: 0, firstDataAt: 0,
      shownRows: -1, shownWk: null, shownTotal: -1, shownDays: -1, shownSrcText: '',
      setDataStates: [], reqCount: 0, respCount: 0, reqAt: 0, respAt: 0,
      remote: { c: cfg.remote.c, t: termStart, meta: { fetchedAt: now, source: 'mock' } }
    };

    // 只包一次 wx.request：tt.json 延迟 cfg.delayMs 返回 remote；其它接口 60ms 返回空数组（本场景不需要）
    if (!globalThis.__ttEntryReqHooked) {
      globalThis.__ttEntryReqHooked = true;
      wx.request = function (o) {
        const E = globalThis.__ttEntry;
        const u = String((o && o.url) || '');
        const isTt = u.indexOf('tt.json') >= 0;
        if (E) { E.reqCount++; if (isTt) E.reqAt = Date.now(); }
        const done = function () {
          if (isTt && E) { E.respCount++; E.respAt = Date.now(); }
          try {
            if (isTt) o.success && o.success({ statusCode: 200, data: E ? E.remote : { c: [], t: '' } });
            else o.success && o.success({ statusCode: 200, data: [] });
          } catch (err) { /* ignore */ }
        };
        setTimeout(done, isTt ? ((E && E.delayMs) || 800) : 60);
      };
    }

    // 只包一次 Page()：记录 tt 页 onShow 时刻 + 每次 setData 的 state（有缓存时不应出现 loading）
    if (!globalThis.__ttEntryPageHooked) {
      globalThis.__ttEntryPageHooked = true;
      const origPage = globalThis.Page;
      if (typeof origPage === 'function') {
        globalThis.Page = function (def) {
          try {
            if (def && typeof def.onShow === 'function') {
              const origShow = def.onShow;
              def.onShow = function () {
                const E = globalThis.__ttEntry;
                const route = String(this.route || this.__route__ || '');
                if (E && route === 'pages/tt/tt') {
                  E.onShowAt = E.onShowAt || Date.now();
                  const inst = this;
                  const origSet = inst.setData;
                  if (typeof origSet === 'function' && !inst.__ttEntrySetWrapped) {
                    inst.__ttEntrySetWrapped = true;
                    inst.setData = function (o, cb) {
                      const E2 = globalThis.__ttEntry;
                      if (E2 && o && typeof o === 'object') {
                        if (o.state) {
                          E2.setDataStates.push(o.state);
                          if (o.state === 'loading') E2.loadingSetAt = E2.loadingSetAt || Date.now();
                        }
                        if (o.state === 'data' && Array.isArray(o.rows) && o.rows.length > 0 && !E2.firstDataAt) {
                          E2.firstDataAt = Date.now();
                          E2.shownRows = o.rows.length;
                          E2.shownWk = o.wk;
                          E2.shownTotal = o.total;
                          E2.shownDays = (o.dayCols || []).length;
                          E2.shownSrcText = o.srcText || '';
                        }
                      }
                      return origSet.apply(inst, arguments);
                    };
                  }
                }
                return origShow.apply(this, arguments);
              };
            }
          } catch (e) { /* ignore */ }
          return origPage.apply(this, arguments);
        };
      }
    }
    return { termStart: termStart, expectWk: 5, delayMs: cfg.delayMs || 800 };
  }, opts);
}

/* ---------- reLaunch 进课表页：从发起计时，返回「tt 页首帧」采样（不等待网络） ----------
 * 注意：automator 的 reLaunch 可能在页面 onLoad/onShow 完成前就返回（旧脚本都要再 sleep/waitPath），
 * 所以这里 reLaunch 后尽快轮询采样，直到 currentPage 变成 pages/tt/tt；t0 = 发起 reLaunch 的时刻、
 * retAt = reLaunch Promise resolve 的时刻（两者都记录，便于判断「首帧是否已在返回时渲染好」）。 */
async function enterTt(mp) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const t0 = Date.now();
    await mp.reLaunch('/pages/tt/tt');
    const retAt = Date.now();
    const samples = [];
    const end = Date.now() + 2000;
    while (Date.now() < end) {
      const s = await sample(mp).catch(() => null);
      if (s) samples.push(s);
      if (s && s.path === 'pages/tt/tt') return { t0: t0, retAt: retAt, pre: s, samples: samples };
      if (samples.length >= 25) break;
      await sleep(40);
    }
    await sleep(300);
  }
  return null;
}

/* ---------- 轮询采样直到 pred（每 intervalMs 一次；把每次采样都留在 samples 里） ---------- */
async function pollUntil(mp, entry, pred, timeoutMs, intervalMs) {
  const end = Date.now() + (timeoutMs || 3000);
  while (Date.now() < end) {
    const last = entry.samples[entry.samples.length - 1];
    if (last && pred(last)) return last;
    await sleep(intervalMs || 40);
    const s = await sample(mp).catch(() => null);
    if (s) entry.samples.push(s);
  }
  return entry.samples[entry.samples.length - 1] || null;
}

/* ---------- DOM 检查（.tgrid / 星期列 / 课程块 / 骨架文案） ---------- */
async function domInfo(mp) {
  const p = await curPage(mp);
  if (!p) return null;
  const grid = await p.$('.tgrid');
  const cols = await p.$$('.daycol');
  const crs = await p.$$('.crs');
  const tabs = await p.$$('.ttseg .seg');
  const stateEl = await p.$('.ttstate');
  return {
    hasGrid: !!grid,
    cols: cols.length,
    crs: crs.length,
    tabs: tabs.length,
    stateText: stateEl ? String(await stateEl.text()) : ''
  };
}

/* ---------- 读本机 ttCache（断言网络返回后已落盘） ---------- */
async function storedCache(mp) {
  return mp.evaluate(() => {
    try {
      const d = JSON.parse(wx.getStorageSync('zq_tools_v2') || '{}');
      const c = d && d.ttCache && d.ttCache.c;
      return { n: Array.isArray(c) ? c.length : -1, t: (d && d.ttCache && d.ttCache.t) || '' };
    } catch (e) { return { n: -2, t: '' }; }
  });
}

/* 场景配置（课程数据全部为测试构造，不接触真实教务数据/网络） */
const ID = {
  token: 'mock-token-tt-entry', sid: '3260799999', name: '测试账号',
  role: '副团支书', badge: '班委', is_admin: false, ts: Date.now()
};
// 本机缓存（旧快照）：3 门课，第 5 周全部有课；来源应显示「本机」
const CACHE_C = [
  { name: '高等数学', day: 0, start: 1, end: 2, weeks: '1-18', room: '自强楼(教室01104)', teacher: '龚志伟', parity: 'all' },
  { name: '大学英语', day: 2, start: 3, end: 4, weeks: '1-18', room: '厚德楼(教室02405)', teacher: '李华', parity: 'all' },
  { name: '体育', day: 4, start: 6, end: 7, weeks: '1-18', room: '田径场', teacher: '王强', parity: 'all' }
];
// 教务返回（mock 的 tt.json）：4 门课（与缓存不同 → 可断言静默更新）
const REMOTE_C = [
  { name: '高等数学', day: 0, start: 1, end: 2, weeks: '1-18', room: '自强楼(教室01104)', teacher: '龚志伟', parity: 'all' },
  { name: '大学英语', day: 1, start: 3, end: 4, weeks: '1-18', room: '厚德楼(教室02405)', teacher: '李华', parity: 'all' },
  { name: '大学物理', day: 3, start: 5, end: 6, weeks: '1-18', room: '格物楼(教室03201)', teacher: '陈明', parity: 'all' },
  { name: '体育', day: 4, start: 6, end: 7, weeks: '1-18', room: '田径场', teacher: '王强', parity: 'all' }
];

(async () => {
  let mp = null;
  for (let i = 0; i < 3 && !mp; i++) {
    try { mp = await automator.connect({ wsEndpoint: WS }); } catch (e) { await sleep(1500); }
  }
  if (!mp) throw new Error('无法连接 automator（' + WS + '）：请先运行 cli.bat auto（本脚本不负责启动开发者工具）');
  mp.on('console', (e) => {
    if (e && e.type === 'error') {
      const args = (e.args || []).map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      consoleIssues.push(String(args || e.text || '').slice(0, 400));
    }
  });
  mp.on('exception', (e) => consoleIssues.push('exception: ' + JSON.stringify(e).slice(0, 400)));
  await sleep(1200);
  // 模拟器可能残留原生浮层（会挡截图）→ automator native 接口关闭（不是屏幕操作）
  try { await mp.native().cancelModal(); } catch (e) { /* ignore */ }
  try { await mp.native().shareCancel(); } catch (e) { /* ignore */ }
  await sleep(400);
  const sys = await mp.systemInfo().catch(() => ({}));
  const winW = sys.windowWidth || 390;

  const report = {
    at: new Date().toISOString(), ws: WS, netDelayMs: NET_DELAY,
    windowWidth: winW, windowHeight: sys.windowHeight || 0, SDKVersion: sys.SDKVersion || '',
    checks: checks, consoleIssues: consoleIssues, screenshots: [], timings: {}
  };

  try {
    /* ============================================================
       场景 A：有本机缓存 → reLaunch 首帧即当前周课表（不等待 800ms 网络）
       ============================================================ */
    const mockA = await installMock(mp, {
      id: ID, ttCache: { c: CACHE_C, at: Date.now() - 7 * 3600e3, meta: null },
      remote: { c: REMOTE_C }, delayMs: NET_DELAY
    });

    const A = await enterTt(mp);
    check('A0 进入课表页（mock 身份，reLaunch 成功）', !!A, A ? 'path=' + A.pre.path : '重试失败');
    if (A) {
      // reLaunch 返回即采样一次（不 sleep）：有缓存时这一帧应已经是当前周课表
      const pre = A.pre;
      const afterRetMs = pre.at - A.retAt;
      const firstData = await pollUntil(mp, A, (s) => s.path === 'pages/tt/tt' && s.state === 'data' && s.total > 0, 2500, 40);
      const firstDataMs = firstData ? firstData.at - A.retAt : -1;
      const fromCallMs = firstData ? firstData.at - A.t0 : -1;
      report.timings.A = {
        reLaunchCallAt: A.t0, reLaunchReturnAt: A.retAt,
        firstDataAt: firstData ? firstData.at : 0,
        reLaunchToDataMs: fromCallMs, afterReturnToDataMs: firstDataMs,
        onShowToDataMs: firstData && firstData.E.onShowAt ? (firstData.E.firstDataAt || firstData.at) - firstData.E.onShowAt : -1,
        netDelayMs: NET_DELAY,
        states: A.samples.filter((s) => s.path === 'pages/tt/tt').map((s) => s.state)
      };
      const states = A.samples.filter((s) => s.path === 'pages/tt/tt').map((s) => s.state);
      const firstDataEarly = !!firstData;
      // 「首帧来自本机缓存」的双重取证：
      //   · 采样取证：首帧采样时网络还没返回（resp=0）且来源文案=本机；
      //   · 运行时取证（Page 钩子可用时）：首帧 setData 时刻早于网络响应，且首帧 setData 的来源=本机。
      const hookCached = !!(firstData && firstData.E.firstDataAt && firstData.E.respAt &&
        firstData.E.firstDataAt <= firstData.E.respAt && firstData.E.shownSrc === '本机');
      const sampleCached = !!(firstData && firstData.E.resp === 0 && firstData.srcText === '本机');

      check('A1 有缓存进入即显示课表：reLaunch 后采样到 state=data 且 rows>0',
        firstDataEarly && firstData.rows > 0, firstData ? 'state=' + firstData.state + ' rows=' + firstData.rows + ' days=' + firstData.days : '未采样到 data');
      check('A2 首帧显示的是「当前周」：第 ' + mockA.expectWk + ' 周、5 个星期列、表头齐全',
        firstDataEarly && firstData.wk === mockA.expectWk && firstData.weekLabel === '第 ' + mockA.expectWk + ' 周' &&
        firstData.days === 5 && firstData.heads.length === 5 && firstData.heads[0] === '周一' && firstData.heads[4] === '周五',
        firstData ? 'wk=' + firstData.wk + ' ' + firstData.weekLabel + ' days=' + firstData.days + ' heads=' + firstData.heads.join('/') : '');
      check('A3 首帧数据来自本机缓存而非网络：首帧 setData/采样早于 tt.json 响应（mock 延迟 ' + NET_DELAY + 'ms），来源文案=本机',
        firstDataEarly && (hookCached || sampleCached),
        firstData ? 'hookCached=' + hookCached + ' sampleCached=' + sampleCached + ' resp=' + firstData.E.resp +
          ' srcText=' + JSON.stringify(firstData.srcText) + ' shownSrc=' + JSON.stringify(firstData.E.shownSrc) +
          ' firstDataAt=' + firstData.E.firstDataAt + ' respAt=' + firstData.E.respAt + ' total=' + firstData.total : '');
      check('A4 已渲染的缓存课表未被「课表加载中…」骨架覆盖（首帧前无 loading 采样）',
        firstDataEarly && states.indexOf('loading') < 0 && (!firstData.E.loadingSetAt || firstData.E.firstDataAt <= firstData.E.loadingSetAt),
        'states=' + JSON.stringify(states) + ' loadingSetAt=' + (firstData && firstData.E.loadingSetAt) + ' firstDataAt=' + (firstData && firstData.E.firstDataAt));
      check('A5 首帧出现时间：reLaunch 返回后 ≤400ms 内已见当前周表格（实测 ' + firstDataMs + 'ms）',
        firstDataEarly && firstDataMs >= 0 && firstDataMs <= 400, 'afterReturnToDataMs=' + firstDataMs + ' reLaunchToDataMs=' + fromCallMs + ' firstSampleAfterReturnMs=' + afterRetMs);
      check('A6 首帧早于网络返回：reLaunch 发起→首帧 ' + fromCallMs + 'ms < 网络延迟 ' + NET_DELAY + 'ms（或钩子证明 firstDataAt≤respAt）',
        firstDataEarly && ((fromCallMs >= 0 && fromCallMs < NET_DELAY) || hookCached),
        'fromCallMs=' + fromCallMs + ' hookCached=' + hookCached + ' resp=' + (firstData && firstData.E.resp) + ' respAt=' + (firstData && firstData.E.respAt));
      // 运行时钩子可用时的精确断言：onShow → 首帧 data ≤150ms（setData 同步完成，不再等 120ms）
      if (firstDataEarly && firstData.E.onShowAt) {
        const onShowToData = (firstData.E.firstDataAt || firstData.at) - firstData.E.onShowAt;
        check('A7 运行时精确计时：onShow → 首帧 data = ' + onShowToData + 'ms（≤150ms，同步渲染不含 120ms 延迟）',
          onShowToData >= 0 && onShowToData <= 150, 'onShowAt=' + firstData.E.onShowAt + ' firstDataAt=' + firstData.E.firstDataAt);
        check('A8 运行时 setData 记录：有缓存时从未 setData({state:\'loading\'})',
          firstData.E.loadingSetAt === 0, 'states=' + JSON.stringify(firstData.E.states));
      } else {
        skip('A7/A8 运行时精确计时（onShow→data / 无 loading setData）',
          '未捕获 onShowAt：tt 页在本脚本安装钩子前已加载（可重启 automator 会话后重跑以启用；行为主断言 A1–A6、A9–A12 有效）');
      }
      // 首帧截图（仍在 800ms 网络返回前；DOM 断言与截图取同一时刻的缓存当前周页面）
      const shotA = await shot(mp, '00-cache-entry-current-week');
      report.screenshots.push(shotA);
      const domA = await domInfo(mp);
      check('A9 首帧 DOM：周表 .tgrid 存在、5 个 .daycol、至少 3 个课程块、无「课表加载中」骨架',
        !!domA && domA.hasGrid && domA.cols === 5 && domA.crs >= 3 && domA.stateText.indexOf('课表加载中') < 0,
        domA ? 'grid=' + domA.hasGrid + ' cols=' + domA.cols + ' crs=' + domA.crs + ' stateText=' + JSON.stringify(domA.stateText) : 'DOM 读取失败');

      // 等待 800ms 网络返回 → 静默更新为教务数据（4 门），页面不回到骨架
      const remote = await pollUntil(mp, A, (s) => s.path === 'pages/tt/tt' && s.E.resp > 0 && s.state === 'data' && s.total === REMOTE_C.length, 4000, 80);
      const afterUpdateMs = remote ? remote.at - A.retAt : -1;
      report.timings.A.remoteUpdateAt = remote ? remote.at : 0;
      report.timings.A.remoteRespMs = remote ? remote.E.respAt - A.t0 : -1;
      const cacheA = await storedCache(mp);
      check('A10 后台静默刷新：网络返回后课程数 3→' + REMOTE_C.length + '，来源文案变「教务 M/D HH:MM」',
        !!remote && remote.total === REMOTE_C.length && /^教务 \d+\/\d+ \d{2}:\d{2}$/.test(String(remote.srcText || '')),
        remote ? 'total=' + remote.total + ' srcText=' + JSON.stringify(remote.srcText) + ' afterUpdateMs=' + afterUpdateMs : '未等到网络更新');
      check('A11 更新落盘：store.ttCache 已写入教务返回（' + REMOTE_C.length + ' 门）',
        cacheA.n === REMOTE_C.length, 'ttCache.n=' + cacheA.n);
      check('A12 更新过程无骨架闪烁（网络返回前后所有采样均无 loading 态）',
        A.samples.filter((s) => s.path === 'pages/tt/tt').map((s) => s.state).indexOf('loading') < 0,
        'states=' + JSON.stringify(A.samples.filter((s) => s.path === 'pages/tt/tt').map((s) => s.state)));
      const shotA2 = await shot(mp, '03-cache-after-network');
      report.screenshots.push(shotA2);
    }

    /* ============================================================
       场景 B：无本机缓存 → 先骨架「课表加载中…」，网络返回后转 data（对照组）
       ============================================================ */
    await installMock(mp, { id: ID, ttCache: null, remote: { c: REMOTE_C }, delayMs: B_DELAY });
    let B = await enterTt(mp);
    // 若首次进入时页面创建耗时 > 800ms，网络可能已返回、骨架已消失 → 清缓存重进一次（重新计时）
    for (let attempt = 0; attempt < 2 && B && !(B.pre && B.pre.state === 'loading'); attempt++) {
      await sleep(250);
      await installMock(mp, { id: ID, ttCache: null, remote: { c: REMOTE_C }, delayMs: B_DELAY });
      B = await enterTt(mp);
    }
    check('B0 无缓存场景：重新进入课表页成功', !!B, B ? 'path=' + B.pre.path : '重试失败');
    if (B) {
      const loading = await pollUntil(mp, B, (s) => s.path === 'pages/tt/tt' && s.state === 'loading', 3000, 30);
      const loadingMs = loading ? loading.at - B.retAt : -1;
      report.timings.B = {
        reLaunchCallAt: B.t0, reLaunchReturnAt: B.retAt,
        loadingSeenAt: loading ? loading.at : 0, loadingAfterReturnMs: loadingMs,
        onShowToLoadingMs: loading && loading.E.onShowAt ? (loading.E.loadingSetAt || loading.at) - loading.E.onShowAt : -1,
        netDelayMs: NET_DELAY
      };
      check('B1 无缓存 → 显示「课表加载中…」骨架（state=loading）', !!loading && loading.state === 'loading',
        loading ? 'state=' + loading.state + ' loadingMs=' + loadingMs : '未采样到 loading');
      check('B2 骨架出现时间：reLaunch 返回后 ≤400ms（实测 ' + loadingMs + 'ms）', !!loading && loadingMs >= 0 && loadingMs <= 400,
        'loadingAfterReturnMs=' + loadingMs);
      if (loading && loading.E.onShowAt) {
        check('B3 无缓存时 loading 由 onShow 设置（_hasLocalTt=false 分支生效）', loading.E.loadingSetAt > 0,
          'onShowAt=' + loading.E.onShowAt + ' loadingSetAt=' + loading.E.loadingSetAt);
      } else {
        skip('B3 运行时 loading setData 计时', '未捕获 onShowAt（tt 页已提前加载）；B1/B2/B4/B5 有效');
      }
      const shotB1 = await shot(mp, '01-no-cache-skeleton');
      report.screenshots.push(shotB1);
      const domB = await domInfo(mp);
      check('B4 骨架 DOM：.ttstate 文案 =「课表加载中…」、无周表 .tgrid',
        !!domB && domB.stateText.indexOf('课表加载中') >= 0 && !domB.hasGrid,
        domB ? 'stateText=' + JSON.stringify(domB.stateText) + ' hasGrid=' + domB.hasGrid : 'DOM 读取失败');

      const dataB = await pollUntil(mp, B, (s) => s.path === 'pages/tt/tt' && s.state === 'data' && s.total === REMOTE_C.length, 9000, 80);
      report.timings.B.dataAt = dataB ? dataB.at : 0;
      report.timings.B.dataAfterReturnMs = dataB ? dataB.at - B.retAt : -1;
      check('B5 网络返回后骨架 → 数据（' + REMOTE_C.length + ' 门课程、state=data）',
        !!dataB && dataB.state === 'data' && dataB.total === REMOTE_C.length,
        dataB ? 'state=' + dataB.state + ' total=' + dataB.total + ' afterRetMs=' + (dataB.at - B.retAt) : '未等到 data');
      const shotB2 = await shot(mp, '02-no-cache-after-network');
      report.screenshots.push(shotB2);
    }

    /* ---------- 结论 ---------- */
    check('全程 0 console error / exception', consoleIssues.length === 0, JSON.stringify(consoleIssues.slice(0, 3)));
  } finally {
    try { await mp.disconnect(); } catch (e) { /* ignore */ }
    report.pass = passN;
    report.fail = failN;
    report.checks = checks;
    report.consoleIssues = consoleIssues;
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log('\n============ tt entry preview: ' + passN + ' PASS / ' + failN + ' FAIL / ' + consoleIssues.length + ' console error；windowWidth=' + winW + ' ============');
    console.log('result: ' + path.join(OUT, 'result.json'));
    console.log('screenshots: ' + report.screenshots.filter(Boolean).join(', '));
    process.exitCode = failN || consoleIssues.length ? 2 : 0;
  }
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
