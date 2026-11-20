/* stats_preview.js —— 访问统计页（管理员，契约 2026-11-20）390 宽布局截图/断言
 *
 * 前置：cli.bat auto --project <项目> --port 9433 --auto-port 9420 --trust-project
 * 用法：node stats_preview.js
 * 产出：_shots_stats/
 *   01_stats_today.png（摘要 4 格 + 24 小时趋势 + 登录端 + 版本/设备 + 账号明细）
 *   02_stats_expanded.png（账号展开设备/版本/登录端明细）
 *   03_stats_week.png（近 7 天 7 根日柱）
 *   result.json
 *
 * 说明：mock 管理员身份（官方测试账号 3260799999）+ mock wx.request（visits），不接触真实云端；
 *       聚合夹具只使用 9000 段纯虚构学号，不使用任何真实学号。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const OUT = path.join(__dirname, '_shots_stats');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const consoleIssues = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 600) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}
async function shot(mp, name) {
  const p = path.join(OUT, name + '.png');
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
    console.log('SHOT-FAIL ' + name + ' :: ' + e.message); return '';
  }
}
async function rects(mp, selector) {
  return mp.evaluate((sel) => new Promise((resolve) => {
    const q = wx.createSelectorQuery();
    q.selectAll(sel).boundingClientRect();
    q.exec((res) => resolve((res && res[0]) || []));
  }), selector);
}
async function pageData(mp) {
  return mp.evaluate(() => {
    const ps = getCurrentPages(); const pg = ps[ps.length - 1];
    if (!pg) return null;
    const data = pg.data;
    return JSON.parse(JSON.stringify({
      path: pg.route || '', state: data.state, range: data.range,
      summary: data.summary,
      trend: data.trend || [], accounts: data.accounts || [],
      clients: data.clients || [], versions: data.versions || [], devicesList: data.devicesList || [],
      truncated: !!data.truncated, expandedKey: data.expandedKey
    }));
  });
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  mp.on('console', (msg) => {
    if (msg && msg.type === 'error') consoleIssues.push(String(msg.args || msg.text || '').slice(0, 300));
  });
  try {
    // 1) mock 管理员 + visits 数据（近 7 天，多账号 / 多端 / 多版本 / 多设备）
    await mp.evaluate(() => {
      try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
      wx.setStorageSync('zq_class_identity', JSON.stringify({
        token: 'tok-stats-preview', sid: '3260799999', name: '测试账号',
        role: '副团支书', badge: '班委', is_admin: true, ts: Date.now()
      }));
      const names = ['张三', '李四', '王五', '赵六', '钱七'];
      const clients = ['web', 'mp', 'android', 'win', 'harmony'];
      const vers = ['2.0.0', '2.0.0', '1.0.8', '1.0.0-beta14', ''];
      const devs = ['Windows · Edge 131', 'Apple iPhone 15 · iOS 18.1', 'Xiaomi 14 · Android 15', 'Windows 11 · x64', ''];
      const rows = [];
      const now = Date.now();
      for (let d = 0; d < 7; d++) {
        for (let u = 0; u < names.length; u++) {
          if ((d + u) % 3 === 0) continue;
          const dt = new Date(now - d * 86400e3);
          const hh = 8 + ((u * 3 + d) % 13);
          const date = dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2);
          rows.push({
            slot: date + '-' + ('0' + hh).slice(-2),
            sid: '900000000' + (u + 1),
            name: names[u],
            did: 'dev' + (u % 3),
            client: clients[u % 5],
            ver: vers[u % 5],
            dev: devs[u % 5],
            ts: now - d * 86400e3 + hh * 3600e3
          });
        }
      }
      globalThis.__sreqs = [];
      wx.request = function (o) {
        const u = String((o && o.url) || '');
        globalThis.__sreqs.push(String((o && o.method) || 'GET') + ' ' + u);
        const data = u.indexOf('/visits?') >= 0 ? rows : [];
        const ok = function () { try { o.success && o.success({ statusCode: 200, data: data }); } catch (e) { /* ignore */ } };
        setTimeout(ok, 20);
      };
    });

    await mp.reLaunch('/pages/stats/stats');
    await sleep(1500);
    let d = await pageData(mp);
    check('统计页打开（管理员）→ 数据态、默认今天、趋势 24 根', d && d.path === 'pages/stats/stats' &&
      d.state === 'data' && d.range === 'today' && d.accounts.length > 0 && d.trend.length === 24, JSON.stringify(d && {
        state: d.state, range: d.range, accounts: d.accounts.length, trend: d.trend.length
      }));
    check('摘要 4 格字段齐全（账号/次数/今日活跃/设备）', d && d.summary &&
      typeof d.summary.accounts === 'number' && typeof d.summary.visits === 'number' &&
      typeof d.summary.activeToday === 'number' && typeof d.summary.devices === 'number', JSON.stringify(d && d.summary));

    // 2) 范围筛选：只剩一个 group、两个等分 chip（≥40px），不横向溢出
    const groups = await rects(mp, '.st-fgroup');
    const chips = await rects(mp, '.st-chip');
    check('范围筛选一组 2 个 chip、各 ≥40px、不横向溢出', groups.length === 1 && chips.length === 2 &&
      chips.every((r) => r.height >= 39 && r.width > 0 && r.right <= 390.5 && r.left >= 0), JSON.stringify(chips));
    const sumRects = await rects(mp, '.st-sum__item');
    const rowsTop = {};
    sumRects.forEach((r) => { const k = Math.round(r.top); rowsTop[k] = (rowsTop[k] || 0) + 1; });
    check('摘要 4 格 390 宽为 2×2（两行各 2 格）', sumRects.length === 4 &&
      Object.keys(rowsTop).length === 2 && Object.keys(rowsTop).every((k) => rowsTop[k] === 2),
      JSON.stringify({ count: sumRects.length, rows: rowsTop }));
    check('摘要格不横向溢出（right ≤ 390）', sumRects.length === 4 &&
      sumRects.every((r) => r.right <= 390.5 && r.left >= 0), JSON.stringify(sumRects.map((r) => ({ l: r.left, r: r.right }))));

    // 3) 趋势：24 根柱都有宽度、容器不溢出
    const bars = await rects(mp, '.st-tb');
    const trendBox = await rects(mp, '.st-trend');
    check('今天趋势 24 根小时柱，宽度 >0', bars.length === 24 && bars.every((r) => r.width > 0), JSON.stringify({ n: bars.length }));
    check('趋势图不横向溢出（right ≤ 390）', trendBox.length === 1 && trendBox[0].right <= 390.5,
      JSON.stringify(trendBox[0] || null));

    // 4) 登录端堆叠条 + 图例
    const stack = await rects(mp, '.st-stack');
    const segs = await rects(mp, '.st-stack__seg');
    const legend = await rects(mp, '.st-leg__row');
    const segW = segs.reduce((s, r) => s + r.width, 0);
    check('登录端堆叠条分段 = 登录端组数，宽度铺满', stack.length === 1 && segs.length === d.clients.length &&
      segW > 0 && Math.abs(segW - stack[0].width) <= 2, JSON.stringify({ stack: stack[0] && stack[0].width, segs: segs.length, segW }));
    check('登录端图例行数与分段一致、含百分比', legend.length === segs.length &&
      d.clients.reduce((s, c) => s + c.pct, 0) === 100, JSON.stringify(d.clients.map((c) => [c.label, c.count, c.pct])));

    // 5) 版本 / 设备双卡：390 宽上下排列，行数 ≤ 7（6 + 其他）
    const duo = await rects(mp, '.st-duo .m3-card');
    const dists = await rects(mp, '.st-dist');
    check('版本/设备卡 390 宽上下排列', duo.length === 2 && duo[0].top < duo[1].top,
      JSON.stringify(duo.map((r) => ({ t: r.top, h: r.height }))));
    check('版本/设备分布各 ≤ 6 行 + 其他，且无横向溢出', d.versions.length <= 7 && d.devicesList.length <= 7 &&
      dists.length === d.versions.length + d.devicesList.length && dists.every((r) => r.right <= 390.5),
      JSON.stringify({ versions: d.versions.length, devices: d.devicesList.length, rows: dists.length }));

    // 6) 所有卡片在 390 宽内（无横向溢出）
    const cards = await rects(mp, '.m3-card');
    check('全部卡片不横向溢出（0 ≤ left，right ≤ 390）', cards.length > 0 &&
      cards.every((r) => r.left >= 0 && r.right <= 390.5), JSON.stringify(cards.map((r) => ({ l: r.left, r: r.right }))));
    const s1 = await shot(mp, '01_stats_today');

    // 7) 账号明细：排名/姓名/标签/次数条；点击展开、一次只展开一个
    const accMain = await rects(mp, '.st-acc__main');
    const badges = await rects(mp, '.st-acc__badge');
    const topBadges = await rects(mp, '.is-top');
    check('账号明细行 = 账号数，前 3 排名徽标高亮', d.accounts.length > 0 && accMain.length === d.accounts.length &&
      badges.length === d.accounts.length && topBadges.length === Math.min(3, d.accounts.length) &&
      accMain.every((r) => r.height >= 40), JSON.stringify({ n: accMain.length, top: topBadges.length }));
    const first = d.accounts[0];
    check('账号行含最近端/版本/设备标签与次数', !!first && !!first.clientText && !!first.verText &&
      !!first.devText && typeof first.count === 'number' && first.pct > 0, JSON.stringify(first && {
        name: first.name, count: first.count, client: first.clientText, ver: first.verText, dev: first.devText
      }));
    const ex = await mp.evaluate(() => {
      const pg = getCurrentPages().slice(-1)[0];
      const a = pg.data.accounts[0];
      pg.toggleRow({ currentTarget: { dataset: { key: a.key } } });
      return { key: a.key };
    });
    await sleep(350);
    d = await pageData(mp);
    const detail = await rects(mp, '.st-detail');
    check('点击账号行展开详情（一次只展开一个）', d.expandedKey === ex.key && detail.length === 1 &&
      detail[0].right <= 390.5, JSON.stringify({ expanded: d.expandedKey, detail: detail.length }));
    const exAcc = d.accounts.filter((a) => a.key === ex.key)[0] || {};
    check('展开含活跃/登录端/版本/设备明细，设备最多 6 行', /首次/.test(exAcc.detailText || '') &&
      Array.isArray(exAcc.clients) && exAcc.clients.length > 0 && Array.isArray(exAcc.versions) &&
      exAcc.versions.length > 0 && Array.isArray(exAcc.devices) && exAcc.devices.length > 0 && exAcc.devices.length <= 7,
      JSON.stringify({ detailText: exAcc.detailText, clients: exAcc.clients, versions: exAcc.versions, devices: exAcc.devices.length }));
    const s2 = await shot(mp, '02_stats_expanded');
    const k2 = await mp.evaluate(() => {
      const pg = getCurrentPages().slice(-1)[0];
      const a = pg.data.accounts[1];
      pg.toggleRow({ currentTarget: { dataset: { key: a.key } } });
      return a.key;
    });
    await sleep(300);
    d = await pageData(mp);
    const detail2 = await rects(mp, '.st-detail');
    check('切换账号展开时上一个自动收起（详情仅 1 个）', d.expandedKey === k2 && detail2.length === 1,
      JSON.stringify({ expanded: d.expandedKey, detail: detail2.length }));

    // 8) 近 7 天：7 根日柱、今天高亮、账号/汇总重算
    await mp.evaluate(() => {
      const pg = getCurrentPages().slice(-1)[0];
      pg.setRange({ currentTarget: { dataset: { v: 'week' } } });
    });
    await sleep(600);
    d = await pageData(mp);
    const weekBars = await rects(mp, '.st-tb');
    check('近 7 天趋势 7 根日柱、今天高亮', d.range === 'week' && d.trend.length === 7 && weekBars.length === 7 &&
      d.trend.filter((b) => b.isToday).length === 1, JSON.stringify({ range: d.range, n: d.trend.length }));
    check('近 7 天账号明细仍可展开且 ≤120 条', d.accounts.length > 0 && d.accounts.length <= 120 && !d.truncated,
      JSON.stringify({ accounts: d.accounts.length, truncated: d.truncated }));
    const s3 = await shot(mp, '03_stats_week');
    check('统计页无 console error', consoleIssues.length === 0, JSON.stringify(consoleIssues.slice(0, 3)));

    const info = await mp.evaluate(() => { try { return wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) { return {}; } });
    const report = {
      at: new Date().toISOString(), windowWidth: info.windowWidth || 0,
      checks: results, consoleErrors: consoleIssues,
      screenshots: [s1, s2, s3].filter(Boolean)
    };
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2), 'utf8');
    const failed = results.filter((r) => !r.ok).length;
    console.log('\n==== stats preview: ' + (results.length - failed) + ' PASS / ' + failed + ' FAIL / ' + consoleIssues.length + ' console error；windowWidth=' + report.windowWidth + ' ====');
    process.exitCode = failed ? 2 : 0;
  } finally {
    try { await mp.disconnect(); } catch (e) { /* ignore */ }
  }
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
