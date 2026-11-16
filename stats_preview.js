/* stats_preview.js —— 访问统计页（管理员）390 宽布局截图/断言
 *
 * 前置：cli.bat auto --project <项目> --port 9433 --auto-port 9420 --trust-project
 * 用法：node stats_preview.js
 * 产出：_shots_stats/
 *   01_stats_account.png（按账号 + 筛选两组）
 *   02_stats_day.png（按天列表对齐）
 *   03_stats_hour.png（按小时列表对齐）
 *   result.json
 *
 * 说明：mock 管理员身份 + mock wx.request（visits），不接触真实云端。
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
    return JSON.parse(JSON.stringify({
      path: pg.route || '', state: pg.data.state, mode: pg.data.mode, range: pg.data.range,
      accounts: (pg.data.accounts || []).length, bars: (pg.data.bars || []).length,
      summary: pg.data.summary, atText: pg.data.atText
    }));
  });
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  mp.on('console', (msg) => {
    if (msg && msg.type === 'error') consoleIssues.push(String(msg.args || msg.text || '').slice(0, 300));
  });
  try {
    // 1) mock 管理员 + visits 数据（近 7 天，多账号）
    await mp.evaluate(() => {
      try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
      wx.setStorageSync('zq_class_identity', JSON.stringify({
        token: 'tok-stats-preview', sid: '3260799999', name: '测试账号',
        role: '副团支书', badge: '班委', is_admin: true, ts: Date.now()
      }));
      const names = ['测试账号', '谢梓萱', '林可', '张小二', '王五'];
      const rows = [];
      const now = Date.now();
      for (let d = 0; d < 7; d++) {
        for (let u = 0; u < names.length; u++) {
          if ((d + u) % 3 === 0) continue;
          const dt = new Date(now - d * 86400e3);
          const hh = 9 + ((u * 3 + d) % 12);
          const date = dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2);
          rows.push({
            id: 'sid' + u + '-' + date + '-' + hh,
            slot: date + '-' + ('0' + hh).slice(-2),
            sid: '3260707' + ('00' + (u + 20)).slice(-3),
            name: names[u],
            did: 'dev' + u,
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
    check('统计页打开（管理员）→ 数据态', d && d.path === 'pages/stats/stats' && d.state === 'data' && d.accounts > 0, JSON.stringify(d));
    const s1 = await shot(mp, '01_stats_account');

    // 2) 筛选两组：模式组/范围组各自保持单行；允许整组换行，但组内不拆行
    const groups = await rects(mp, '.st-fgroup');
    const gMode = groups[0] || {}, gRange = groups[1] || {};
    const oneLineEach = groups.length === 2 && gMode.width > 0 && gRange.width > 0 &&
      gMode.height > 30 && gMode.height < 60 && gRange.height > 30 && gRange.height < 60;
    const layoutOk = oneLineEach && (Math.abs(gMode.top - gRange.top) < 1
      ? gMode.right < gRange.left + 1
      : gRange.top >= gMode.top + gMode.height - 1);
    check('筛选模式组/范围组各自单行（整组换行，组内无单 chip 掉行）', layoutOk,
      JSON.stringify({ mode: gMode, range: gRange }));
    check('两组 chips 不横向溢出（right ≤ 390）', groups.length === 2 &&
      groups.every((r) => r.right <= 390.5 && r.left >= 0), JSON.stringify(groups.map((r) => ({ l: r.left, r: r.right, t: r.top, h: r.height }))));

    // 3) 汇总卡：2 个统计项 + 更新时间不重叠/不溢出
    const items = await rects(mp, '.st-sum__item');
    const upd = await rects(mp, '.st-sum__upd');
    const u0 = upd[0] || {};
    check('汇总卡 2 个统计项 + 更新时间不重叠且不溢出', items.length === 2 && u0.right <= 390.5 && u0.left >= 0 &&
      (u0.top >= Math.max(items[0].top, items[1].top) + 1 || u0.left >= items[1].right + 1),
      JSON.stringify({ items: items.map((r) => ({ l: r.left, t: r.top, r: r.right })), upd: { l: u0.left, t: u0.top, r: u0.right } }));

    // 4) 按天列表：label / bar / value 同一行、不挤压
    await mp.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.setMode({ currentTarget: { dataset: { v: 'day' } } }); });
    await sleep(700);
    d = await pageData(mp);
    check('按天模式渲染 bars', d && d.mode === 'day' && d.bars > 0, JSON.stringify(d));
    const s2 = await shot(mp, '02_stats_day');
    const rowRects = await rects(mp, '.strow');
    const lbR = await rects(mp, '.lb');
    const barR = await rects(mp, '.stbar');
    const vvR = await rects(mp, '.vv');
    const n = Math.min(rowRects.length, lbR.length, barR.length, vvR.length);
    let alignOk = n > 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(lbR[i].top - barR[i].top) > 8 || Math.abs(barR[i].top - vvR[i].top) > 8) alignOk = false;
      if (barR[i].width <= 0 || vvR[i].width <= 0 || rowRects[i].right > 390.5) alignOk = false;
    }
    check('按天列表行（label/bar/value）对齐且不溢出', alignOk, JSON.stringify({ rows: rowRects.length, sample: { lb: lbR[0], bar: barR[0], vv: vvR[0] } }));

    // 5) 按小时列表同理
    await mp.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.setMode({ currentTarget: { dataset: { v: 'hour' } } }); });
    await sleep(700);
    d = await pageData(mp);
    check('按小时模式渲染 bars', d && d.mode === 'hour' && d.bars > 0, JSON.stringify(d));
    const s3 = await shot(mp, '03_stats_hour');
    const lbH = await rects(mp, '.lb');
    const barH = await rects(mp, '.stbar');
    const vvH = await rects(mp, '.vv');
    const m = Math.min(lbH.length, barH.length, vvH.length);
    let alignH = m > 0;
    for (let i = 0; i < m; i++) {
      if (Math.abs(lbH[i].top - barH[i].top) > 8 || Math.abs(barH[i].top - vvH[i].top) > 8) alignH = false;
      if (barH[i].width <= 0 || vvH[i].width <= 0) alignH = false;
    }
    check('按小时列表行（label/bar/value）对齐且不溢出', alignH, JSON.stringify({ rows: lbH.length, sample: { lb: lbH[0], bar: barH[0], vv: vvH[0] } }));

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
