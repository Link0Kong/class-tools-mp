/* home_power_preview.js —— 工作台「宿舍电费」关注卡 + 电费页恢复 390 宽截图/断言
 *
 * 前置：cli.bat auto --project <项目> --port 9433 --auto-port 9420 --trust-project
 * 用法：node home_power_preview.js
 * 产出：_shots_power_home/
 *   01_home_power_empty.png（未选择：引导卡、0 请求）
 *   02_home_power_selected.png（已选择：宿舍 + 剩余电量/状态）
 *   03_power_restored.png（点击进入电费页，选择/数据恢复）
 *   04_home_power_restored.png（重整工作台，卡片仍恢复）
 *   result.json
 *
 * 说明：mock 身份 + mock wx.request（不接触真实云端）；存储先重置为未选择态。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const OUT = path.join(__dirname, '_shots_power_home');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const consoleIssues = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 500) });
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
  try { await mp.screenshot({ path: p }); console.log('SHOT  ' + p); return p; } catch (e) { console.log('SHOT-FAIL ' + name + ' :: ' + e.message); return ''; }
}
async function homeData(mp) {
  return mp.evaluate(() => {
    const ps = getCurrentPages(); const pg = ps[ps.length - 1];
    if (!pg) return null;
    const c = pg.data.powerCard || {};
    return JSON.parse(JSON.stringify({
      path: pg.route || '',
      powerCard: { has: c.has, sel: c.sel, label: c.label, qText: c.qText, unit: c.unit, stateKey: c.stateKey, stateText: c.stateText, loading: c.loading }
    }));
  });
}
async function powerData(mp) {
  return mp.evaluate(() => {
    const ps = getCurrentPages(); const pg = ps[ps.length - 1];
    if (!pg) return null;
    return JSON.parse(JSON.stringify({
      path: pg.route || '', state: pg.data.state, hasSel: pg.data.hasSel, sel: pg.data.sel,
      label: pg.data.room && pg.data.room.label, qText: pg.data.qText, stateText: pg.data.stateText
    }));
  });
}
async function reqStats(mp) {
  return mp.evaluate(() => {
    const all = (globalThis.__hreqs || []);
    return {
      total: all.length,
      power: all.filter(function (u) { return String(u).indexOf('/power?') >= 0; }).length,
      history: all.filter(function (u) { return String(u).indexOf('/power_history?') >= 0; }).length,
      userdata: all.filter(function (u) { return String(u).indexOf('/userdata') >= 0; }).length
    };
  });
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  mp.on('console', (msg) => {
    if (msg && msg.type === 'error') consoleIssues.push(String(msg.args || msg.text || '').slice(0, 300));
  });
  try {
    // 1) mock 身份 + 网络 + 重置本机为「未选择」态
    await mp.evaluate(() => {
      try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
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
      wx.setStorageSync('zq_class_identity', JSON.stringify({
        token: 'tok-home-preview', sid: '3260799999', name: '测试账号',
        role: '副团支书', badge: '班委', is_admin: true, ts: Date.now()
      }));
      const d = { power: { sel: '', at: 0, low: 30 }, udCache: null, udPend: false };
      wx.setStorageSync('zq_tools_v2', JSON.stringify(d));
      globalThis.__hreqs = [];
      const ROW = {
        id: '4-23A---321', label: '23号楼A座321', building: '23号楼A座', room: '321',
        quantity: 382.02, unit: '度', low: false, updated_at: '2026-11-06T07:30:00+08:00'
      };
      function hist() {
        const n = 24, step = 24 * 3600e3 / (n - 1), now = Date.now(), out = [];
        for (let i = 0; i < n; i++) out.push({ quantity: Math.round((430 - (430 - 382.02) * i / (n - 1)) * 100) / 100, ts: new Date(now - (n - 1 - i) * step).toISOString() });
        return out;
      }
      wx.request = function (o) {
        const u = String((o && o.url) || '');
        globalThis.__hreqs.push(String((o && o.method) || 'GET') + ' ' + u);
        let data = [];
        if (u.indexOf('/power_history?') >= 0) data = hist();
        else if (u.indexOf('/power?') >= 0) data = [ROW];
        const done = function () { try { o.success && o.success({ statusCode: 200, data: data }); } catch (e) { /* ignore */ } };
        setTimeout(done, 15);
      };
    });

    // 2) 清空关注宿舍（经电费页 API，确保进程内 store 与本机存储一致）→ 工作台引导卡
    await mp.reLaunch('/pages/power/power');
    await sleep(1200);
    await mp.evaluate(() => {
      const pg = getCurrentPages()[getCurrentPages().length - 1];
      if (pg && pg.data && pg.data.sel) pg.pick('');
    });
    await sleep(900);
    await mp.evaluate(() => { globalThis.__hreqs = []; });
    await mp.reLaunch('/pages/index/index');
    await sleep(1500);
    let d = await homeData(mp);
    check('工作台打开：未选择 → 电费引导卡', d && d.path === 'pages/index/index' && d.powerCard.has === false, JSON.stringify(d));
    let rs = await reqStats(mp);
    check('未选择 → 0 个 power/power_history 请求', rs.power === 0 && rs.history === 0, JSON.stringify(rs));
    const shot1 = await shot(mp, '01_home_power_empty');

    // 3) 通过电费页选择关注宿舍 → 重整工作台，展示电量/状态（1 次 power 请求）
    await mp.reLaunch('/pages/power/power');
    await sleep(1200);
    await mp.evaluate(() => {
      const pg = getCurrentPages()[getCurrentPages().length - 1];
      if (pg && pg.pick) pg.pick('4-23A---321');
    });
    await sleep(1400);
    await mp.evaluate(() => { globalThis.__hreqs = []; });
    await mp.reLaunch('/pages/index/index');
    await sleep(1500);
    d = await homeData(mp);
    check('已选择 → 卡片显示宿舍 + 剩余电量/状态', d && d.powerCard.has === true &&
      d.powerCard.label === '23号楼A座321' && d.powerCard.qText === '382' &&
      d.powerCard.stateKey === 'ok' && d.powerCard.stateText === '充足', JSON.stringify(d && d.powerCard));
    rs = await reqStats(mp);
    check('已选择 → 首屏最多 1 次 power 请求（2min 缓存命中可 0）+ 无 history', rs.power <= 1 && rs.history === 0, JSON.stringify(rs));
    const shot2 = await shot(mp, '02_home_power_selected');

    // 4) 点击卡片进入电费页：关注宿舍恢复
    await mp.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.goPower(); });
    await sleep(1600);
    let p = await powerData(mp);
    check('点卡片 → 电费页且选择恢复', p && p.path === 'pages/power/power' && p.hasSel === true &&
      p.sel === '4-23A---321' && p.label === '23号楼A座321', JSON.stringify(p));
    const shot3 = await shot(mp, '03_power_restored');

    // 5) 重新打开工作台：卡片仍恢复（本机持久化）
    await mp.reLaunch('/pages/index/index');
    await sleep(1500);
    d = await homeData(mp);
    check('重整工作台 → 关注宿舍仍恢复', d && d.powerCard.has === true && d.powerCard.sel === '4-23A---321' &&
      d.powerCard.qText === '382', JSON.stringify(d && d.powerCard));
    const shot4 = await shot(mp, '04_home_power_restored');

    const info = await mp.evaluate(() => { try { return wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) { return {}; } });
    const report = {
      at: new Date().toISOString(), windowWidth: info.windowWidth || 0, pixelRatio: info.pixelRatio || 0,
      checks: results, consoleErrors: consoleIssues,
      screenshots: [shot1, shot2, shot3, shot4].filter(Boolean)
    };
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2), 'utf8');
    const failed = results.filter((r) => !r.ok).length;
    console.log('\n==== home power preview: ' + (results.length - failed) + ' PASS / ' + failed + ' FAIL / ' +
      consoleIssues.length + ' console error；windowWidth=' + report.windowWidth + ' ====');
    console.log('screenshots: ' + report.screenshots.join(', '));
    process.exitCode = failed ? 2 : 0;
  } finally {
    try { await mp.disconnect(); } catch (e) { /* ignore */ }
  }
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
