/* power_natural_cmp_preview.js —— 电费「13/16 隐藏 24h + 自然周期同期比较」小程序端预览（miniprogram-automator + mock 网络）
 *
 * 前置：微信开发者工具已开自动化端口（本项目 9424）：
 *   cli.bat auto --project C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools --port 9433 --auto-port 9424 --trust-project
 * 用法：node power_natural_cmp_preview.js [--ws ws://127.0.0.1:9424]
 * 约束：只用 automator（eval + screenshot），不做屏幕/鼠标操作、不 preview/推手机、不接触真实云端（mock wx.request）。
 * 产出：_shots_power_natural_cmp/01_slow_7d.png、02_live_24h.png、03_live_7d.png、04_live_30d.png + result.json
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

function wsArg() {
  const i = process.argv.indexOf('--ws');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env.POWER_NATURAL_CMP_WS || 'ws://127.0.0.1:9424';
}
const WS = wsArg();
const OUT = path.join(__dirname, '_shots_power_natural_cmp');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const logs = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 500) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}
async function ev(mp, fn, ...args) { return mp.evaluate(fn, ...args); }
async function waitFor(fn, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 8000)) {
    const v = await fn();
    if (v) return v;
    await sleep(120);
  }
  return null;
}
async function pageState(mp) {
  return ev(mp, () => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    if (!pg) return null;
    return JSON.parse(JSON.stringify({
      path: pg.route || '', state: pg.data.state, sel: pg.data.sel,
      ranges: (pg.data.ranges || []).map(function (r) { return r.label; }),
      range: pg.data.range, rangeTitle: pg.data.rangeTitle,
      tiles: (pg.data.tiles || []).slice(1, 2),
      trendX: ((pg.data.trend || {}).xTicks || []).length,
      daily: (pg.data.trend || {}).daily,
      histCmp: (pg._histCmp || []).length
    }));
  });
}
// 自然周期 mock：70 天逐小时，按「今天/昨天/本周/上周/本月/上月」不同速率（与网页测试同口径）
async function installMock(mp) {
  await ev(mp, () => {
    const app = getApp();
    const gd = app.globalData;
    if (gd.__pncMock) { wx.request = gd.__pncRequest; return; }
    const ROWS = {
      '4-23A---321': { id: '4-23A---321', label: '23号楼A座321', building: '23号楼A座', room: '321', quantity: 382.02, unit: '度', low: false, updated_at: '2026-11-11T19:00:00+08:00' },
      '1-16---305': { id: '1-16---305', label: '16号楼305', building: '16号楼', room: '305', quantity: 38.00, unit: '度', low: false, updated_at: '2026-11-11T19:00:00+08:00' },
      '1-13---324': { id: '1-13---324', label: '13号楼324', building: '13号楼', room: '324', quantity: 88.75, unit: '度', low: false, updated_at: '2026-11-11T19:00:00+08:00' }
    };
    const day = 86400e3;
    const now = Date.now();
    const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
    const today0 = d0.getTime();
    const week0 = today0 - ((new Date(today0).getDay() + 6) % 7) * day;
    const month0 = new Date(d0.getFullYear(), d0.getMonth(), 1).getTime();
    const pm0 = new Date(d0.getFullYear(), d0.getMonth() - 1, 1).getTime();
    function rateAt(t) {
      if (t >= today0) return 0.20;
      if (t >= today0 - day) return 0.10;
      if (t >= week0) return 0.15;
      if (t >= week0 - 7 * day) return 0.10;
      if (t >= month0) return 0.12;
      if (t >= pm0) return 0.08;
      return 0.10;
    }
    const base = [];
    let q = 1000;
    for (let t = now - 70 * day; t <= now; t += 3600e3) {
      base.push({ t: t, q: q });
      q -= rateAt(t);
    }
    const histFor = function () {
      return base.map(function (p) { return { ts: new Date(p.t).toISOString(), quantity: Math.round(p.q * 100) / 100 }; });
    };
    gd.__pncMock = true;
    gd.__pncRequest = function (o) {
      const u = String((o && o.url) || '');
      const done = function (data) { try { o.success && o.success({ statusCode: 200, data: data }); } catch (e) { /* ignore */ } };
      setTimeout(function () {
        if (u.indexOf('/power_history?') >= 0) {
          const m = u.match(/ts=gte\.([^&]+)/);
          const cut = m ? Date.parse(decodeURIComponent(m[1])) : 0;
          return done(histFor().filter(function (p) { return Date.parse(p.ts) >= cut; }));
        }
        if (u.indexOf('/power?') >= 0) {
          let rv = '4-23A---321';
          const m = u.match(/id=eq\.([^&]+)/);
          if (m) rv = decodeURIComponent(m[1]);
          return done(ROWS[rv] ? [ROWS[rv]] : []);
        }
        return done([]);
      }, 15);
    };
    wx.request = gd.__pncRequest;
  });
}
async function prepare(mp) {
  await ev(mp, () => {
    try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
    wx.setStorageSync('zq_class_identity', JSON.stringify({
      token: 'tok-power-natural-cmp', sid: '3260799999', name: '测试账号',
      role: '副团支书', badge: '班委', is_admin: true, ts: Date.now()
    }));
  });
}
async function shot(mp, name) {
  const file = path.join(OUT, name + '.png');
  await mp.screenshot({ path: file });
  return file;
}
async function main() {
  let mp = null;
  try {
    mp = await automator.connect({ wsEndpoint: WS });
    mp.on('console', async (msg) => {
      const t = String((msg && msg.args && msg.args[0] && msg.args[0].value != null) ? msg.args[0].value : '');
      if ((msg.type === 'error' || msg.type === 'warn') && t) logs.push({ type: msg.type, text: t.slice(0, 300) });
    });
    await installMock(mp);
    await prepare(mp);
    await mp.reLaunch('/pages/power/power');
    await sleep(1200);
    const page = await mp.currentPage();
    check('P0 进入电费页（mock 身份/网络）', !!page && page.path === 'pages/power/power', page && page.path);

    // 16 号楼：隐藏 24h、自动 7 天、比较=较上周同期
    await ev(mp, (rv) => { const pg = getCurrentPages().pop(); return pg ? pg.pick(rv) : null; }, '1-16---305');
    await waitFor(async () => { const s = await pageState(mp); return s && s.state === 'ready' && s.sel === '1-16---305'; }, 12000);
    await sleep(800);
    let s = await pageState(mp);
    check('P1 16号楼 24h 档隐藏（仅 7天/30天）', s && s.ranges.join('/') === '7天/30天', s && s.ranges.join('/'));
    check('P2 16号楼 自动落 7 天', s && s.range === '7d' && /7 天/.test(s.rangeTitle || ''), s && (s.range + '|' + s.rangeTitle));
    check('P3 16号楼 比较=较上周同期', s && s.tiles && s.tiles[0] && /较上周同期\s+[+-]?\d+%/.test(s.tiles[0].cmp || ''), s && s.tiles && s.tiles[0] && s.tiles[0].cmp);
    await shot(mp, '01_slow_7d');

    // 实时房：恢复 24h、24h 与 7 天/30 天比较
    await ev(mp, (rv) => { const pg = getCurrentPages().pop(); return pg ? pg.pick(rv) : null; }, '4-23A---321');
    await waitFor(async () => { const x = await pageState(mp); return x && x.state === 'ready' && x.sel === '4-23A---321'; }, 12000);
    await sleep(800);
    s = await pageState(mp);
    check('P4 实时房 24h 档恢复', s && s.ranges.join('/') === '24h/7天/30天' && s.range === '24h', s && s.ranges.join('/'));
    check('P5 24h 比较=较昨日同期 +100%', s && s.tiles && s.tiles[0] && /较昨日同期\s+\+100%/.test(s.tiles[0].cmp || ''), s && s.tiles && s.tiles[0] && s.tiles[0].cmp);
    await shot(mp, '02_live_24h');

    await ev(mp, () => { const pg = getCurrentPages().pop(); return pg ? pg.pickRange({ currentTarget: { dataset: { k: '7d' } } }) : null; });
    await sleep(1500);
    s = await pageState(mp);
    check('P6 实时房 7 天比较=较上周同期', s && s.range === '7d' && s.tiles && s.tiles[0] && /较上周同期\s+[+-]?\d+%/.test(s.tiles[0].cmp || ''), s && s.tiles && s.tiles[0] && s.tiles[0].cmp);
    await shot(mp, '03_live_7d');

    await ev(mp, () => { const pg = getCurrentPages().pop(); return pg ? pg.pickRange({ currentTarget: { dataset: { k: '30d' } } }) : null; });
    await sleep(1500);
    s = await pageState(mp);
    check('P7 实时房 30 天比较=较上月同期', s && s.range === '30d' && s.tiles && s.tiles[0] && /较上月同期\s+[+-]?\d+%/.test(s.tiles[0].cmp || ''), s && s.tiles && s.tiles[0] && s.tiles[0].cmp);
    await shot(mp, '04_live_30d');

    const errCount = logs.filter(function (l) { return l.type === 'error'; }).length;
    check('P8 0 console error', errCount === 0, JSON.stringify(logs.slice(0, 4)));
  } catch (e) {
    check('PREVIEW 运行', false, String((e && e.message) || e));
  } finally {
    const summary = { total: results.length, pass: results.filter(function (r) { return r.ok; }).length, fail: results.filter(function (r) { return !r.ok; }).length, results: results, logs: logs, at: new Date().toISOString() };
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log('\n=== power_natural_cmp_preview: ' + summary.pass + '/' + summary.total + ' PASS ===');
    if (mp) { try { await mp.disconnect(); } catch (e) { /* ignore */ } }
    process.exit(summary.fail ? 2 : 0);
  }
}
main();
