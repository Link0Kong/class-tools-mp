/* power_trend_entry_preview.js —— 电费页「进入页面趋势卡自动恢复」场景验证（miniprogram-automator + mock 网络）
 *
 * 前置（本脚本不在会话内自行启动 devtools；由 Lead 统一运行）：
 *   cli.bat auto --project C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools --port 9433 --auto-port 9420 --trust-project
 * 用法：
 *   node power_trend_entry_preview.js [--ws ws://127.0.0.1:9420]
 *   （默认连 ws://127.0.0.1:9420；也可用环境变量 POWER_TREND_WS 覆盖）
 *
 * 验证目标（用户反馈：进入电费页趋势卡偶发「数据积累中」，手动刷新才出图）：
 *   变体 A：进入页时 power 行成功、power_history 首轮网络失败（cloud 自带 1 次重试也失败）→
 *           **不点刷新**，页面自动静默重试一次后趋势图自动出现（截图 01）。
 *   变体 B：power_history 首轮返回 HTTP 200 []（旧实现会写 5 分钟缓存）→ **不点刷新**，自动重试后出图（截图 02）。
 *   变体 C：正常 24h 数据 → 趋势立即出现、0 额外请求、不触发自动重试（截图 03）。
 *   变体 D：真实只有 1 个采样点 → 自动重试恰 1 次后停止、最终仍「数据积累中」、不循环（截图 04）。
 *   变体 A/B/D 的请求数同时断言「有界」（每场景 ≤ 初始批次 + 恰 1 次重试批次）。
 *
 * 产出：_shots_power_trend_entry/01..04*.png + result.json
 * 说明：全程 mock wx.request（不接触真实云端）；身份 / 关注宿舍仅为本地 mock 写入 storage；
 *       全程只 reLaunch 进入页面 + 等待 + 截图，从不点「刷新」。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

function wsArg() {
  const i = process.argv.indexOf('--ws');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env.POWER_TREND_WS || 'ws://127.0.0.1:9420';
}
const WS = wsArg();
const OUT = path.join(__dirname, '_shots_power_trend_entry');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const consoleIssues = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 500) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}

/* 变体配置：room 刻意各不相同（避免 cloud 模块内 5 分钟 history 缓存跨变体命中） */
const VARIANTS = [
  { id: 'A', label: '首轮网络失败', room: '4-23A---321', wantEmpty: false, hist: 6, row: 2, shot: '01_variantA_first_fail_entry' },
  { id: 'B', label: '首轮 HTTP 200 空', room: '4-23B---424', wantEmpty: false, hist: 4, row: 2, shot: '02_variantB_first_empty_entry' },
  // v13（规格 power_cadence_spec.md §2）：16 号楼慢频房额外预取 30d history → 首轮 3 个 history 请求
  { id: 'C', label: '正常 24h', room: '1-16---305', wantEmpty: false, hist: 3, row: 1, shot: '03_variantC_normal_24h' },
  { id: 'D', label: '真实仅 1 点', room: '4-23B---425', wantEmpty: true, hist: 4, row: 2, shot: '04_variantD_genuine_one_point' }
];

async function installMock(mp) {
  await mp.evaluate(() => {
    const app = getApp();
    const gd = app.globalData;
    if (gd.__ptMockInstalled) { try { wx.request = gd.__ptRequest; } catch (e) { /* ignore */ } return; }
    gd.__ptOrigRequest = wx.request;
    const ROWS = {
      '4-23A---321': { id: '4-23A---321', label: '23号楼A座321', building: '23号楼A座', room: '321', quantity: 382.02, unit: '度', low: false, updated_at: '2026-11-06T07:30:00+08:00' },
      '4-23B---424': { id: '4-23B---424', label: '23号楼B座424', building: '23号楼B座', room: '424', quantity: 40, unit: '度', low: false, updated_at: '2026-11-06T07:30:00+08:00' },
      '1-16---305': { id: '1-16---305', label: '16号楼305', building: '16号楼', room: '305', quantity: 22.25, unit: '度', low: true, updated_at: '2026-11-06T07:30:00+08:00' },
      '4-23B---425': { id: '4-23B---425', label: '23号楼B座425', building: '23号楼B座', room: '425', quantity: 70, unit: '度', low: false, updated_at: '2026-11-06T07:30:00+08:00' }
    };
    const rowOf = (rv) => ROWS[rv] || ROWS['4-23A---321'];
    // n 个采样点（24h 用 -> 11 个已足够绘制）
    const histOf = (rv, n) => {
      const endQ = (ROWS[rv] || ROWS['4-23A---321']).quantity;
      const cnt = Math.max(1, n);
      const step = 3600e3;
      const out = [];
      for (let i = 0; i < cnt; i++) {
        const q = cnt === 1 ? endQ : (endQ + (cnt - 1 - i) * 3.5);
        out.push({ ts: new Date(Date.now() - (cnt - 1 - i) * step).toISOString(), quantity: Math.round(q * 100) / 100 });
      }
      return out;
    };
    // 可变网络行为（每个变体前由 Node 侧重设 gd.__pt；计数器 hist/row 为原始 wx.request 次数）
    gd.__ptRequest = function (o) {
      const u = String((o && o.url) || '');
      const ctl = getApp().globalData.__pt || { variant: 'C', hist: 0, row: 0, room: '4-23A---321' };
      const done = function (data) { try { o.success && o.success({ statusCode: 200, data: data }); } catch (e) { /* ignore */ } };
      setTimeout(function () {
        if (u.indexOf('/power_history?') >= 0) {
          ctl.hist += 1;
          let rv = ctl.room;
          const m = u.match(/roomverify=eq\.([^&]+)/);
          if (m) rv = decodeURIComponent(m[1]);
          if (ctl.variant === 'A' && ctl.hist <= 4) { try { o.fail && o.fail({ errMsg: 'request:fail mock' }); } catch (e) { /* ignore */ } return; }
          if (ctl.variant === 'B' && ctl.hist <= 2) return done([]);
          if (ctl.variant === 'D') return done(histOf(rv, 1));
          return done(histOf(rv, 11));
        }
        if (u.indexOf('/power?') >= 0) {
          ctl.row += 1;
          let rv = ctl.room;
          const m = u.match(/id=eq\.([^&]+)/);
          if (m) rv = decodeURIComponent(m[1]);
          return done([rowOf(rv)]);
        }
        return done([]);    // userdata / marks / members 等其它请求一律空数据（不接触真实云端）
      }, 15);
    };
    wx.request = gd.__ptRequest;
    gd.__ptMockInstalled = true;
  });
}

async function prepare(mp, v) {
  await mp.evaluate((variant, room) => {
    try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
    wx.setStorageSync('zq_class_identity', JSON.stringify({
      token: 'tok-power-trend', sid: '3260799999', name: '测试账号',
      role: '副团支书', badge: '班委', is_admin: true, ts: Date.now()
    }));
    // 模拟「用户此前已关注过宿舍」：页面进入即按已选择状态自动 load(false)
    wx.setStorageSync('zq_tools_v2', JSON.stringify({ power: { sel: room, at: Date.now(), low: 30 } }));
    getApp().globalData.__pt = { variant: variant, hist: 0, row: 0, room: room };
  }, v.id, v.room);
}

async function pageState(mp) {
  return mp.evaluate(() => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    if (!pg) return null;
    const tr = pg.data.trend || {};
    let req = null;
    try { req = (getApp().globalData || {}).__pt || null; } catch (e) { req = null; }
    return JSON.parse(JSON.stringify({
      path: pg.route || '',
      state: pg.data.state, hasSel: pg.data.hasSel, sel: pg.data.sel, range: pg.data.range,
      trend: {
        empty: tr.empty, note: tr.note, title: tr.title,
        startText: tr.startText, curText: tr.curText, dropText: tr.dropText,
        hiText: tr.hiText, midText: tr.midText, loText: tr.loText,
        xN: (tr.xTicks || []).length
      },
      linePoints: (pg._linePoints || []).length,
      canvasDrawn: !!pg._canvasDrawn,
      autoRetryKeys: Object.keys(pg._autoRetryKeys || {}),
      autoRetryPending: !!pg._autoRetryT,
      req: req ? { variant: req.variant, hist: req.hist, row: req.row } : null
    }));
  });
}

async function waitFor(fn, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 5000)) {
    const v = await fn();
    if (v) return v;
    await sleep(120);
  }
  return null;
}

async function waitPage(mp, room) {
  return waitFor(async () => {
    const s = await pageState(mp);
    return s && s.path === 'pages/power/power' && s.hasSel === true && s.sel === room ? s : null;
  }, 6000);
}

async function shot(mp, name) {
  const p = path.join(OUT, name + '.png');
  // 模拟器 saveFile 配额：每张截图前清理小程序用户文件，避免累计超限
  try {
    await mp.evaluate(() => {
      try {
        const fsm = wx.getFileSystemManager();
        const root = wx.env.USER_DATA_PATH;
        const clean = function (d) {
          try {
            fsm.readdirSync(d).forEach(function (n) {
              const q = d + '/' + n;
              try { if (fsm.statSync(q).isDirectory()) clean(q); else fsm.unlinkSync(q); } catch (e2) { /* ignore */ }
            });
          } catch (e3) { /* ignore */ }
        };
        clean(root);
      } catch (e4) { /* ignore */ }
    });
    await sleep(80);
  } catch (e0) { /* ignore */ }
  try { await mp.screenshot({ path: p }); console.log('SHOT  ' + p); return p; } catch (e) {
    for (let i = 0; i < 2; i++) {
      try { await sleep(800); await mp.screenshot({ path: p }); console.log('SHOT  ' + p + ' (retry)'); return p; } catch (e2) { /* next */ }
    }
    console.log('SHOT-FAIL ' + name + ' :: ' + (e && e.message));
    return '';
  }
}

async function runVariant(mp, v) {
  console.log('\n---- 变体 ' + v.id + '：' + v.label + '（room=' + v.room + '）----');
  await prepare(mp, v);
  const t0 = Date.now();
  await mp.reLaunch('/pages/power/power');
  const first = await waitPage(mp, v.room);
  check(v.id + ' 页面已打开且恢复关注宿舍（' + v.room + '）', !!(first && first.hasSel && first.sel === v.room), JSON.stringify(first && { path: first.path, sel: first.sel, hasSel: first.hasSel }));

  let st = first;
  if (v.wantEmpty) {
    await sleep(2400);                       // 留出自动重试（650ms）+ 一次绘制时间
    st = await pageState(mp);
  } else {
    st = await waitFor(async () => {
      const s = await pageState(mp);
      return s && s.path === 'pages/power/power' && s.trend && s.trend.empty === false ? s : null;
    }, 7000);
    if (!st) st = await pageState(mp);
  }
  const elapsed = Date.now() - t0;

  if (v.wantEmpty) {
    check(v.id + ' 真实只有 1 个采样点 → 仍显示「数据积累中」（不伪造数据）',
      !!(st && st.trend.empty === true && st.trend.note === '数据积累中'), JSON.stringify(st && st.trend));
    check(v.id + ' 不绘制折线（<2 点）', !!(st && st.linePoints === 0 && st.canvasDrawn === false), JSON.stringify(st && { linePoints: st.linePoints, canvasDrawn: st.canvasDrawn }));
  } else {
    check(v.id + ' 进入页面后**未点刷新**趋势自动出现（' + elapsed + 'ms）',
      !!(st && st.trend.empty === false && st.linePoints >= 2), JSON.stringify(st && { elapsed: elapsed, trend: st.trend, linePoints: st.linePoints }));
    check(v.id + ' 趋势 canvas 自动重绘', !!(st && st.canvasDrawn === true), JSON.stringify(st && { canvasDrawn: st.canvasDrawn }));
    check(v.id + ' 24h 图例/刻度渲染（起点/下降/' + (st && st.trend && st.trend.xN) + ' 刻度）',
      !!(st && st.trend.startText && st.trend.startText !== '—' && st.trend.dropText && st.trend.dropText !== '—' && st.trend.xN === 3), JSON.stringify(st && st.trend));
  }
  check(v.id + ' 自动重试标记（每「宿舍+区间」至多 1 次；正常数据 0 次）',
    v.wantEmpty || v.id !== 'C' ? !!(st && st.autoRetryKeys.length === 1 && st.sel + '|24h' === st.autoRetryKeys[0]) : !!(st && st.autoRetryKeys.length === 0),
    JSON.stringify(st && st.autoRetryKeys));

  const reqNow = st && st.req ? { hist: st.req.hist, row: st.req.row } : {};
  await sleep(1300);                         // 观察窗：不得再自动重试 / 不得有额外请求
  const st2 = await pageState(mp);
  const req2 = st2 && st2.req ? { hist: st2.req.hist, row: st2.req.row } : {};
  check(v.id + ' 请求有界：history=' + req2.hist + '（期望 ' + v.hist + '）row=' + req2.row + '（期望 ' + v.row + '）',
    req2.hist === v.hist && req2.row === v.row, JSON.stringify({ before: reqNow, after: req2, expect: { hist: v.hist, row: v.row } }));
  check(v.id + ' 观察窗内无额外请求（不循环重试）',
    !!(req2.hist === reqNow.hist && req2.row === reqNow.row), JSON.stringify({ before: reqNow, after: req2 }));
  check(v.id + ' 未点刷新（页面无待执行的自动重试）', !!(st2 && st2.autoRetryPending === false), JSON.stringify(st2 && { pending: st2.autoRetryPending }));

  const shotPath = await shot(mp, v.shot);
  return { variant: v.id, label: v.label, room: v.room, elapsedMs: elapsed, state: st2, screenshot: shotPath };
}

(async () => {
  console.log('连接 automator：' + WS + '（前置：cli.bat auto --auto-port 9420 --trust-project）');
  const mp = await automator.connect({ wsEndpoint: WS });
  mp.on('console', (msg) => {
    if (msg && msg.type === 'error') consoleIssues.push(String(msg.args || msg.text || '').slice(0, 300));
  });
  const variants = [];
  try {
    await installMock(mp);
    for (const v of VARIANTS) variants.push(await runVariant(mp, v));
    const info = await mp.evaluate(() => { try { return wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) { return {}; } });
    const report = {
      at: new Date().toISOString(),
      wsEndpoint: WS,
      windowWidth: info.windowWidth || 0,
      pixelRatio: info.pixelRatio || 0,
      note: '全程 mock wx.request；仅 reLaunch 进入页面，从不点刷新。变体 A/B 证明「进入页面趋势卡自动恢复」；D 证明真实不足不循环。',
      checks: results,
      variants: variants,
      consoleErrors: consoleIssues,
      screenshots: variants.map((x) => x.screenshot).filter(Boolean)
    };
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2), 'utf8');
    const failed = results.filter((r) => !r.ok).length;
    console.log('\n==== power_trend_entry_preview: ' + (results.length - failed) + ' PASS / ' + failed + ' FAIL / ' +
      consoleIssues.length + ' console error；windowWidth=' + report.windowWidth + ' ====');
    console.log('screenshots: ' + report.screenshots.join(', '));
    process.exitCode = failed ? 2 : 0;
  } finally {
    // 还原 wx.request，避免影响同一 devtools 进程内后续脚本
    try { await mp.evaluate(() => { try { const gd = getApp().globalData; if (gd.__ptOrigRequest) wx.request = gd.__ptOrigRequest; } catch (e) { /* ignore */ } }); } catch (e) { /* ignore */ }
    try { await mp.disconnect(); } catch (e) { /* ignore */ }
  }
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
