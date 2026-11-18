/* power_preview.js —— 电费页「自定义宿舍弹层 + 区间折线（24h/7天/30天）」开发者工具 390 宽截图/断言
 *
 * 前置：cli.bat auto --project <项目> --port 9433 --auto-port 9420 --trust-project
 * 用法：node power_preview.js
 * 产出：_shots_power_sync/
 *   01_sheet_open.png / 01b_sheet_23A.png（弹层）
 *   02_dashboard_trend_24h.png（默认 24h 仪表盘 + 折线）
 *   04_trend_7d.png / 05_trend_30d.png（区间切换；含「期间有充值」徽标 + 上次充值 tile）
 *   03_low.png（低电态）
 *   result.json
 *
 * 说明：在 app 上下文用 mock wx.request 提供电费数据（不接触真实云端），身份仅为本地 mock token。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const OUT = path.join(__dirname, '_shots_power_sync');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const consoleIssues = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 400) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}
async function pageData(mp) {
  return mp.evaluate(() => {
    const ps = getCurrentPages(); const pg = ps[ps.length - 1];
    if (!pg) return null;
    const tr = pg.data.trend || {};
    const tiles = pg.data.tiles || [];
    return JSON.parse(JSON.stringify({
      path: pg.route || '',
      state: pg.data.state, hasSel: pg.data.hasSel, sel: pg.data.sel,
      sheetOpen: pg.data.sheetOpen, activeBuilding: pg.data.activeBuilding,
      buildingRooms: (pg.data.buildingRooms || []).length,
      range: pg.data.range, rangeTitle: pg.data.rangeTitle, rangeTile: pg.data.rangeTile,
      low: pg.data.low, lowOpen: pg.data.lowOpen,
      stateKey: pg.data.stateKey, lowOn: pg.data.lowOn, lowText: pg.data.lowText, updText: pg.data.updText || '',
      trend: {
        empty: tr.empty, note: tr.note, title: tr.title, dropLabel: tr.dropLabel, startLabel: tr.startLabel,
        hiText: tr.hiText, midText: tr.midText, loText: tr.loText, recharge: tr.recharge, slow: tr.slow, slowText: tr.slowText,
        daily: !!tr.daily, dailyText: tr.dailyText || '', noUpd: tr.noUpd || '',
        xN: (tr.xTicks || []).length,
        xLabels: (tr.xTicks || []).map(function (x) { return x.label; })
      },
      cursor: { on: !!(pg.data.cursor && pg.data.cursor.on), left: (pg.data.cursor && pg.data.cursor.left) || 0, text: (pg.data.cursor && pg.data.cursor.text) || '' },
      plotLeft: pg._plotLeft || 0,
      chartW: pg.data.chartW || 0, cw: pg._cw || 0, cwMeasured: !!pg._cwMeasured,
      tiles: tiles.map(function (t) { return { label: t.label, value: t.value, sub: t.sub || '', ref: !!t.ref }; }),
      linePoints: (pg._linePoints || []).length, canvasDrawn: !!pg._canvasDrawn
    }));
  });
}
async function layoutRects(mp) {
  return mp.evaluate(() => new Promise((resolve) => {
    const sel = ['.page', '.pw-card', '.pw-trend-body', '.pw-plot', '.pw-yaxis', '.pw-xaxis', '.pw-legend', '#pwTrend'];
    const q = wx.createSelectorQuery();
    sel.forEach((s) => q.select(s).boundingClientRect());
    q.exec((res) => {
      let win = 390;
      try { win = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).windowWidth; } catch (e) { /* ignore */ }
      resolve({ win: win, rects: (res || []).map(function (r, i) { return { sel: sel[i], left: r && r.left, right: r && r.right, width: r && r.width, height: r && r.height }; }) });
    });
  }));
}
async function tileRects(mp) {
  return mp.evaluate(() => new Promise((resolve) => {
    const q = wx.createSelectorQuery();
    q.selectAll('.pw-tile').boundingClientRect();
    q.exec((res) => resolve((res && res[0]) || []));
  }));
}
async function cursorTap(mp, frac) {
  return mp.evaluate((f) => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    const x = (pg._plotLeft || 0) + (pg._cw || 0) * f;
    pg.onTrendTouch({ touches: [{ clientX: x, clientY: 200 }] });
    pg.onTrendTouchEnd();
    return { on: !!(pg.data.cursor && pg.data.cursor.on), left: (pg.data.cursor && pg.data.cursor.left) || 0, text: (pg.data.cursor && pg.data.cursor.text) || '' };
  }, frac);
}
async function cursorDrag(mp, fromFrac, toFrac) {
  return mp.evaluate((a) => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    const x0 = (pg._plotLeft || 0) + (pg._cw || 0) * a[0];
    const x1 = (pg._plotLeft || 0) + (pg._cw || 0) * a[1];
    pg.onTrendTouch({ touches: [{ clientX: x0, clientY: 200 }] });
    pg.onTrendTouchMove({ touches: [{ clientX: (x0 + x1) / 2, clientY: 200 }] });
    pg.onTrendTouchMove({ touches: [{ clientX: x1, clientY: 200 }] });
    pg.onTrendTouchEnd({});
    return { on: !!(pg.data.cursor && pg.data.cursor.on), left: (pg.data.cursor && pg.data.cursor.left) || 0, text: (pg.data.cursor && pg.data.cursor.text) || '' };
  }, [fromFrac, toFrac]);
}
async function scrollTopOf(mp) {
  return mp.evaluate(() => new Promise((resolve) => {
    const q = wx.createSelectorQuery(); q.selectViewport().scrollOffset();
    q.exec((r) => resolve((r && r[0] && r[0].scrollTop) || 0));
  }));
}
async function shot(mp, name) {
  const p = path.join(OUT, name + '.png');
  // 模拟器 saveFile 有配额：每张截图前清理小程序用户文件，避免累计超限
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
    // 自动化偶发 timeout：最多重试 2 次（间隔 800ms）
    for (let i = 0; i < 2; i++) {
      try {
        await sleep(800);
        await mp.screenshot({ path: p });
        console.log('SHOT  ' + p + ' (retry)');
        return p;
      } catch (e2) { /* next */ }
    }
    console.log('SHOT-FAIL ' + name + ' :: ' + e.message);
    return '';
  }
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  mp.on('console', (msg) => {
    if (msg && msg.type === 'error') consoleIssues.push(String(msg.args || msg.text || '').slice(0, 300));
  });
  try {
    // 1) 本地 mock 身份 + mock 网络（power 行 + 按区间返回 history；7d/30d 带充值事件）
    await mp.evaluate(() => {
      try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
      // 清理小程序用户文件（模拟器截图累计会触发 saveFile 配额）
      try {
        const fsm = wx.getFileSystemManager();
        const root = wx.env.USER_DATA_PATH;
        const clean = function (p) {
          try {
            fsm.readdirSync(p).forEach(function (n) {
              const q = p + '/' + n;
              try { if (fsm.statSync(q).isDirectory()) clean(q); else fsm.unlinkSync(q); } catch (e2) { /* ignore */ }
            });
          } catch (e3) { /* ignore */ }
        };
        clean(root);
      } catch (e4) { /* ignore */ }
      wx.setStorageSync('zq_class_identity', JSON.stringify({
        token: 'tok-power-preview', sid: '3260799999', name: '测试账号',
        role: '副团支书', badge: '班委', is_admin: true, ts: Date.now()
      }));
      const PWQ = { '1-16---305': 22.25, '1-16---306': 40, '4-23B---425': 70, '4-23B---424': 40, '4-23A---321': 382.02, '1-13---324': 88, '1-13---308': 83 };
      const ROW = function (rv) {
        if (rv === '1-16---305') return { id: rv, label: '16号楼305', building: '16号楼', room: '305', quantity: 22.25, unit: '度', low: true, updated_at: '2026-11-06T07:30:00+08:00' };
        if (rv === '1-16---306') return { id: rv, label: '16号楼306', building: '16号楼', room: '306', quantity: 40, unit: '度', low: false, updated_at: '2026-11-06T07:30:00+08:00' };
        if (rv === '4-23B---425') return { id: rv, label: '23号楼B座425', building: '23号楼B座', room: '425', quantity: 70, unit: '度', low: false, updated_at: '2026-11-06T07:30:00+08:00' };
        if (rv === '4-23B---424') return { id: rv, label: '23号楼B座424', building: '23号楼B座', room: '424', quantity: 40, unit: '度', low: false, updated_at: '2026-11-06T07:30:00+08:00' };
        if (rv === '1-13---324') return { id: rv, label: '13号楼324', building: '13号楼', room: '324', quantity: 88, unit: '度', low: false, updated_at: '2026-11-06T07:30:00+08:00' };
        if (rv === '1-13---308') return { id: rv, label: '13号楼308', building: '13号楼', room: '308', quantity: 83, unit: '度', low: false, updated_at: '2026-11-06T07:30:00+08:00' };
        return { id: rv, label: '23号楼A座321', building: '23号楼A座', room: '321', quantity: 382.02, unit: '度', low: false, updated_at: '2026-11-06T07:30:00+08:00' };
      };
      function hist(rv, days) {
        const n = days === 1 ? 24 : (days === 7 ? 28 : 120);
        const step = days * 24 * 3600e3 / (n - 1);
        const endQ = PWQ[rv] || 382.02;
        const startQ = days === 1 ? endQ + 48 : (days === 7 ? 720 : 980);
        if (rv === '1-13---324' && days === 1) {
          // 慢频样例：24h 仅 2 次变化（100 → 99 → 98），用于「日更」徽标截图
          const slowOut = [], now0 = Date.now();
          for (let i = 0; i < n; i++) {
            const q = i < 12 ? 100 : (i < 20 ? 99 : 98);
            slowOut.push({ quantity: q, ts: new Date(now0 - (n - 1 - i) * step).toISOString() });
          }
          return slowOut;
        }
        if (rv === '1-16---306' && days === 1) {
          // 慢频样例：24h 数值完全不变（平线 → 垂直居中 + 「近 24h 无更新」提示）
          const flatOut = [], now1 = Date.now();
          for (let i = 0; i < n; i++) flatOut.push({ quantity: endQ, ts: new Date(now1 - (n - 1 - i) * step).toISOString() });
          return flatOut;
        }
        const out = [];
        const now = Date.now();
        for (let i = 0; i < n; i++) {
          let q;
          if (days === 1) {
            q = startQ - (startQ - endQ) * i / (n - 1);
          } else if (days === 7) {
            // 0–60% 降到 520；60% 充值 +200 → 720；之后降到 endQ
            const f = i / (n - 1);
            if (f < 0.6) q = startQ - (startQ - 520) * (f / 0.6);
            else if (i === Math.round(0.6 * (n - 1))) q = 720;
            else q = 720 - (720 - endQ) * ((f - 0.6) / 0.4);
          } else {
            const f = i / (n - 1);
            if (f < 0.65) q = startQ - (startQ - 640) * (f / 0.65);
            else if (i === Math.round(0.65 * (n - 1))) q = 940;
            else q = 940 - (940 - endQ) * ((f - 0.65) / 0.35);
          }
          out.push({ quantity: Math.round(q * 100) / 100, ts: new Date(now - (n - 1 - i) * step).toISOString() });
        }
        return out;
      }
      wx.request = function (o) {
        const u = String((o && o.url) || '');
        let data = [];
        const idMatch = u.match(/id=eq\.([^&]+)/);
        const rvMatch = u.match(/roomverify=eq\.([^&]+)/);
        const rv = rvMatch ? decodeURIComponent(rvMatch[1]) : (idMatch ? decodeURIComponent(idMatch[1]) : '4-23A---321');
        if (u.indexOf('/power_history?') >= 0) {
          let days = 1;
          const gm = u.match(/ts=gte\.([^&]+)/);
          if (gm) {
            const d = Math.round((Date.now() - Date.parse(decodeURIComponent(gm[1]))) / 86400e3);
            days = d >= 25 ? 30 : (d >= 5 ? 7 : 1);
          }
          data = hist(rv, days);
        } else if (u.indexOf('/power?') >= 0) {
          data = [ROW(rv)];
        }
        const ok = function () { try { o.success && o.success({ statusCode: 200, data: data }); } catch (e) { /* ignore */ } };
        setTimeout(ok, 15);
      };
    });

    // 2) 打开电费页（此前 devtools 进程内可能残留 store 内存：先清空选择 + 重置区间）
    //    automator 刚连接时 DevTools 可能仍在启动，reLaunch 偶发被吞 → 校验路由并重试
    let opened = false;
    for (let i = 0; i < 5 && !opened; i++) {
      await mp.reLaunch('/pages/power/power');
      await sleep(900);
      opened = await mp.evaluate(() => {
        const p = getCurrentPages()[getCurrentPages().length - 1];
        return !!(p && p.route === 'pages/power/power');
      });
    }
    if (!opened) throw new Error('无法打开电费页（reLaunch 后仍在其他页）');
    await mp.evaluate(() => {
      const pg = getCurrentPages()[getCurrentPages().length - 1];
      if (pg && pg.pick) pg.pick('');
      if (pg && pg.pickRange) pg.pickRange({ currentTarget: { dataset: { k: '24h' } } });
      // 进程内 store 内存可能残留上一轮 low：显式归位 30（并关闭面板）
      if (pg && pg.data.low !== 30 && pg.chooseLow) {
        pg.setData({ lowOpen: false });
        pg.chooseLow({ currentTarget: { dataset: { v: 30 } } });
      }
    });
    await sleep(700);
    let d = await pageData(mp);
    check('电费页已打开且未选择 → idle / 弹层收起', d && d.path === 'pages/power/power' && d.hasSel === false && d.sheetOpen === false, JSON.stringify(d));
    const shot0 = await shot(mp, '00_power_empty');
    // 3) 自定义弹层：打开 + 切 23A
    await mp.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.openSheet(); });
    await sleep(500);
    d = await pageData(mp);
    check('弹层打开：4 楼栋 pill + 房间网格', d && d.sheetOpen === true && d.buildingRooms >= 2, JSON.stringify(d));
    const shot1 = await shot(mp, '01_sheet_open');
    await mp.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.pickBuilding({ currentTarget: { dataset: { b: '23号楼A座' } } }); });
    await sleep(300);
    d = await pageData(mp);
    check('楼栋切换 → 23 号楼A座 9 间房间网格', d && d.activeBuilding === '23号楼A座' && d.buildingRooms === 9, JSON.stringify(d));
    const shot1b = await shot(mp, '01b_sheet_23A');
    // 4) 点房间 = 选中并收起 → 默认 24h 仪表盘 + 折线
    await mp.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.pickRoom({ currentTarget: { dataset: { rv: '4-23A---321' } } }); });
    await sleep(1200);
    d = await pageData(mp);
    check('点房间 → 立即选中并收起弹层', d && d.sheetOpen === false && d.hasSel === true && d.sel === '4-23A---321', JSON.stringify(d));
    check('24h：折线已绘制 + 标题/图例/3 x 刻度', d && d.linePoints >= 2 && d.canvasDrawn === true &&
      d.range === '24h' && d.trend.title === '近 24h 趋势' && d.trend.dropLabel === '近 24h 下降' && d.trend.xN === 3, JSON.stringify(d));
    check('24h 宽度约束：实测容器宽 >0 且 chartW = 容器宽（铺满，无横滑）', d && d.cwMeasured === true && d.cw > 0 && d.chartW === d.cw,
      JSON.stringify({ cw: d.cw, chartW: d.chartW }));
    check('24h 无横滑提示/scroll 组件', d && d.trend.hint === undefined, JSON.stringify(d.trend));
    const scrollCount24 = await mp.evaluate(() => new Promise((resolve) => {
      const q = wx.createSelectorQuery(); q.selectAll('.pw-plot-scroll').boundingClientRect(); q.selectAll('scroll-view').boundingClientRect();
      q.exec((r) => resolve({ proxy: (r && r[0] ? r[0].length : 0), scrollviews: (r && r[1] ? r[1].length : 0) }));
    }));
    check('24h 页面无横滑 scroll 组件（scroll-view=0 / 代理=0）', scrollCount24.scrollviews === 0 && scrollCount24.proxy === 0, JSON.stringify(scrollCount24));
    check('24h：tiles（区间用电/上次充值）', d && d.tiles[1].label === '近 24h 用电' && d.tiles[3].label === '上次充值' && !d.trend.recharge, JSON.stringify(d.tiles));
    check('v5：默认低电阈值 30 + tile1 估算副标 ≈rate 度/天', d && d.low === 30 && d.tiles[2].label === '低电阈值' &&
      d.tiles[2].value === '30' && /^≈ \d+\.\d 度\/天$/.test(d.tiles[0].sub), JSON.stringify(d.tiles));
    const tr = await tileRects(mp);
    const t0 = tr[0] || {}, t1 = tr[1] || {}, t2 = tr[2] || {}, t3 = tr[3] || {};
    check('tiles 实测 2×2（同排同 top、两行、等宽且不越卡片）', tr.length === 4 &&
      Math.abs(t0.top - t1.top) < 1 && Math.abs(t2.top - t3.top) < 1 && t2.top > t0.top + 10 &&
      Math.abs(t0.width - t1.width) < 1 && Math.abs(t0.width - t2.width) < 1 &&
      Math.abs(t0.left - t2.left) < 1 && Math.abs(t1.left - t3.left) < 1 && t0.right < t1.left,
      JSON.stringify(tr.map(function (r) { return { left: r.left, top: r.top, width: r.width, right: r.right }; })));
    const shot2 = await shot(mp, '02_dashboard_trend_24h');
    // 页面级横向溢出探测：卡片/绘图容器/轴/图例 right ≤ windowWidth，24h canvas 不超绘图容器
    let lr = await layoutRects(mp);
    const inPage = lr.rects.filter(function (r) { return r.width > 0; });
    const overflow = inPage.filter(function (r) { return r.right > lr.win + 0.5 || r.left < -0.5; });
    const plotR = lr.rects.filter(function (r) { return r.sel === '.pw-plot'; })[0] || {};
    const cardR = lr.rects.filter(function (r) { return r.sel === '.pw-card'; })[0] || {};
    const yR = lr.rects.filter(function (r) { return r.sel === '.pw-yaxis'; })[0] || {};
    const cvR = lr.rects.filter(function (r) { return r.sel === '#pwTrend'; })[0] || {};
    check('24h 页面无横向溢出（卡片/绘图/轴/图例/canvas right ≤ windowWidth）', overflow.length === 0 &&
      plotR.right <= cardR.right + 0.5 && cvR.right <= plotR.right + 1 && cvR.right <= cardR.right + 0.5,
      JSON.stringify({ win: lr.win, card: cardR, plot: plotR, canvas: cvR, overflow: overflow }));
    check('24h 固定 y 轴不重叠：绘图区右缘 ≤ y 轴左缘', !!yR.left && plotR.right <= yR.left + 0.5,
      JSON.stringify({ plotRight: plotR.right, yLeft: yR.left }));
    const shotLayout24 = await shot(mp, '10_layout_24h');
    // v5：滚到 tile 区，打开低电阈值面板 → 截图
    await mp.evaluate(() => { wx.pageScrollTo({ scrollTop: 900, duration: 0 }); });
    await sleep(500);
    const shot2b = await shot(mp, '02b_tiles_24h_estimate');
    await mp.evaluate(() => {
      const pg = getCurrentPages()[getCurrentPages().length - 1];
      pg.onTileTap({ currentTarget: { dataset: { key: 'threshold' } } });
    });
    await sleep(400);
    await mp.evaluate(() => { wx.pageScrollTo({ scrollTop: 2000, duration: 0 }); });
    await sleep(500);
    d = await pageData(mp);
    check('v5 低电阈值面板：打开 + 8 档', d && d.lowOpen === true && (d.tiles || []).length === 4, JSON.stringify(d));
    const shot6 = await shot(mp, '06_low_panel');
    // 选 50 → 70 度房间偏低；40 度房间低电
    await mp.evaluate(() => {
      const pg = getCurrentPages()[getCurrentPages().length - 1];
      pg.chooseLow({ currentTarget: { dataset: { v: 50 } } });
    });
    await sleep(400);
    await mp.evaluate(() => { wx.pageScrollTo({ scrollTop: 0, duration: 0 }); });
    await sleep(400);
    await mp.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.pick('4-23B---425'); });
    await sleep(1200);
    d = await pageData(mp);
    check('v5 阈值 50：70 度 → 偏低（不显示低电条）', d && d.low === 50 && d.tiles[2].value === '50' && d.stateKey === 'warn' && d.lowOn === false, JSON.stringify(d));
    const shot7 = await shot(mp, '07_low50_warn');
    await mp.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.pick('4-23B---424'); });
    await sleep(1200);
    d = await pageData(mp);
    check('v5 阈值 50：40 度 → 低电 + 低电条', d && d.low === 50 && d.stateKey === 'low' && d.lowOn === true && /^剩 40\.00 度/.test(d.lowText), JSON.stringify({ low: d.low, stateKey: d.stateKey, lowOn: d.lowOn, lowText: d.lowText }));
    const shot8 = await shot(mp, '08_low50_low');
    // v13（规格 power_cadence_spec.md）：13/16 号楼慢频（网关日更）→ 固定「日更」徽标 + 按真实变化点统计
    await mp.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.pick('1-13---324'); });
    await sleep(1200);
    d = await pageData(mp);
    check('v13 慢频房（13号楼324）：日更徽标 + hero 更新时间=真实变化点 + 慢统计 tile', d && d.sel === '1-13---324' &&
      d.trend.daily === true && d.trend.dailyText === '日更' && d.trend.slow === false &&
      /^更新 \d\d-\d\d \d\d:\d\d$/.test(d.updText) && /^\d/.test(d.tiles[0].value) && d.tiles[0].ref === false &&
      d.tiles[1].label === '近 24h 用电' && d.tiles[1].sub === '',
      JSON.stringify({ daily: d && d.trend.daily, updText: d && d.updText, tiles: d && d.tiles }));
    const shot9 = await shot(mp, '09_daily_badge');
    // v13：慢频但近 24h 数值不变（16号楼306 平线）→ 绘图区「近 24h 无更新」提示 + tile2「该区间无更新」
    await mp.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.pick('1-16---306'); });
    await sleep(1200);
    d = await pageData(mp);
    check('v13 慢频房无更新（16号楼306）：近 24h 无更新提示 + tile2「该区间无更新」', d && d.sel === '1-16---306' &&
      d.trend.daily === true && d.trend.noUpd === '近 24h 无更新' &&
      d.tiles[1].value === '—' && d.tiles[1].sub === '该区间无更新', JSON.stringify({ daily: d && d.trend.daily, noUpd: d && d.trend.noUpd, tile2: d && d.tiles[1] }));
    const shot9b = await shot(mp, '09b_no_update');
    // 回到 321（充足）继续 v4 区间/横滑流程
    await mp.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.pick('4-23A---321'); });
    await sleep(1000);
    // 5) 切 7 天（含充值徽标/上次充值）
    await mp.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.pickRange({ currentTarget: { dataset: { k: '7d' } } }); });
    await sleep(1000);
    d = await pageData(mp);
    check('7 天：标题/图例/4 x 刻度/充值徽标/上次充值 tile', d && d.range === '7d' && d.trend.title === '近 7 天趋势' &&
      d.trend.dropLabel === '区间下降' && d.trend.startLabel === '起' && d.trend.xN === 4 && d.trend.recharge === true &&
      d.tiles[1].label === '近 7 天用电' && d.tiles[3].label === '上次充值' && d.tiles[3].value !== '—', JSON.stringify(d));
    check('7 天：折线已重绘', d && d.canvasDrawn === true && d.linePoints >= 2, JSON.stringify(d));
    check('7 天：铺满绘图区（chartW=容器宽，无横滑）', d && d.cwMeasured === true && d.cw > 0 && d.chartW === d.cw && d.trend.hint === undefined,
      JSON.stringify({ cw: d.cw, chartW: d.chartW }));
    lr = await layoutRects(mp);
    const inPage7 = lr.rects.filter(function (r) { return r.width > 0; });
    const overflow7 = inPage7.filter(function (r) { return r.right > lr.win + 0.5 || r.left < -0.5; });
    const plot7 = lr.rects.filter(function (r) { return r.sel === '.pw-plot'; })[0] || {};
    const card7 = lr.rects.filter(function (r) { return r.sel === '.pw-card'; })[0] || {};
    const cv7 = lr.rects.filter(function (r) { return r.sel === '#pwTrend'; })[0] || {};
    check('7 天页面无横向溢出（canvas 在绘图区内，全量铺满）', overflow7.length === 0 &&
      plot7.right <= card7.right + 0.5 && cv7.right <= plot7.right + 1 && cv7.right <= card7.right + 0.5,
      JSON.stringify({ win: lr.win, card: card7, plot: plot7, canvas: cv7, overflow: overflow7 }));
    const shotLayout7 = await shot(mp, '11_layout_7d');
    const shot4 = await shot(mp, '04_trend_7d');
    // 7d 点击 3 个位置：最近真实采样点游标（MM-DD HH:MM）
    const scrollTop7 = await scrollTopOf(mp);
    const c71 = await cursorTap(mp, 0.12);
    check('7 天点击 12% → 游标显示最近采样点（MM-DD HH:MM · 电量）', c71.on && /^\d\d-\d\d \d\d:\d\d · 电量 \d+(\.\d+)? 度$/.test(c71.text), JSON.stringify(c71));
    const shot4c1 = await shot(mp, '04c_cursor_7d_1');
    const c72 = await cursorTap(mp, 0.5);
    check('7 天点击 50% → 游标更新且位置右移', c72.on && c72.left > c71.left + 4 && /^\d\d-\d\d \d\d:\d\d · 电量 /.test(c72.text), JSON.stringify({ a: c71, b: c72 }));
    const shot4c2 = await shot(mp, '04c_cursor_7d_2');
    const c73 = await cursorTap(mp, 0.88);
    check('7 天点击 88% → 游标更新且位置继续右移', c73.on && c73.left > c72.left + 4 && /^\d\d-\d\d \d\d:\d\d · 电量 /.test(c73.text), JSON.stringify({ b: c72, c: c73 }));
    const shot4c3 = await shot(mp, '04c_cursor_7d_3');
    // 7d 左右拖动：同步更新游标、松手保留、页面不滚动
    const drag7 = await cursorDrag(mp, 0.2, 0.8);
    const scrollTop7b = await scrollTopOf(mp);
    check('7 天拖动：游标实时更新 + 松手保留 + 不触发页面滚动', drag7.on && drag7.left > c71.left && scrollTop7 === scrollTop7b, JSON.stringify({ drag: drag7, scrollTop: [scrollTop7, scrollTop7b] }));
    const shot4d = await shot(mp, '04d_cursor_7d_drag');
    // 4b) 滚到 tile 区，截「上次充值」tile
    await mp.evaluate(() => { wx.pageScrollTo({ scrollTop: 900, duration: 0 }); });
    await sleep(500);
    const shot4b = await shot(mp, '04b_tiles_7d');
    await mp.evaluate(() => { wx.pageScrollTo({ scrollTop: 0, duration: 0 }); });
    await sleep(400);
    // 6) 切 30 天
    await mp.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.pickRange({ currentTarget: { dataset: { k: '30d' } } }); });
    await sleep(1000);
    d = await pageData(mp);
    check('30 天：标题/图例/5 x 刻度/充值徽标/上次充值 tile', d && d.range === '30d' && d.trend.title === '近 30 天趋势' &&
      d.trend.dropLabel === '区间下降' && d.trend.xN === 5 && d.trend.recharge === true &&
      d.tiles[1].label === '近 30 天用电' && d.tiles[3].label === '上次充值', JSON.stringify(d));
    const shot5 = await shot(mp, '05_trend_30d');
    check('30 天：铺满绘图区（chartW=容器宽，无横滑）', d && d.cwMeasured === true && d.cw > 0 && d.chartW === d.cw && d.trend.hint === undefined,
      JSON.stringify({ cw: d.cw, chartW: d.chartW }));
    // 6b) 30d 点击/拖动游标（MM-DD HH:MM）
    const c30a = await cursorTap(mp, 0.25);
    check('30 天点击 → 游标显示最近采样点', c30a.on && /^\d\d-\d\d \d\d:\d\d · 电量 /.test(c30a.text), JSON.stringify(c30a));
    const c30b = await cursorDrag(mp, 0.3, 0.85);
    check('30 天拖动 → 游标同步更新、松手保留', c30b.on && c30b.left > c30a.left && /^\d\d-\d\d \d\d:\d\d · 电量 /.test(c30b.text), JSON.stringify({ a: c30a, b: c30b }));
    const shot5c = await shot(mp, '05c_cursor_30d_drag');
    // 6c) tile 区截图（30 天）
    await mp.evaluate(() => { wx.pageScrollTo({ scrollTop: 900, duration: 0 }); });
    await sleep(500);
    const shot5b = await shot(mp, '05b_tiles_30d');
    await mp.evaluate(() => { wx.pageScrollTo({ scrollTop: 0, duration: 0 }); });
    await sleep(400);
    // 7) 低电状态（16号楼305，22.25 度）
    await mp.evaluate(() => { const pg = getCurrentPages()[getCurrentPages().length - 1]; pg.pickRoom({ currentTarget: { dataset: { rv: '1-16---305' } } }); });
    await sleep(1200);
    d = await pageData(mp);
    check('低电房间 → 仪表盘+折线（低电条）', d && d.sel === '1-16---305' && d.state === 'ready', JSON.stringify(d));
    const shot3 = await shot(mp, '03_low');
    // 8) 宽度/结果
    const info = await mp.evaluate(() => { try { return wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) { return {}; } });
    const report = {
      at: new Date().toISOString(), windowWidth: info.windowWidth || 0, pixelRatio: info.pixelRatio || 0,
      checks: results, consoleErrors: consoleIssues,
      screenshots: [shot0, shot1, shot1b, shot2, shotLayout24, shot2b, shot6, shot7, shot8, shot9, shot9b, shotLayout7, shot4, shot4c1, shot4c2, shot4c3, shot4d, shot4b, shot5, shot5c, shot5b, shot3].filter(Boolean)
    };
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2), 'utf8');
    const failed = results.filter((r) => !r.ok).length;
    console.log('\n==== power preview: ' + (results.length - failed) + ' PASS / ' + failed + ' FAIL / ' +
      consoleIssues.length + ' console error；windowWidth=' + report.windowWidth + ' ====');
    console.log('screenshots: ' + report.screenshots.join(', '));
    process.exitCode = failed ? 2 : 0;
  } finally {
    try { await mp.disconnect(); } catch (e) { /* ignore */ }
  }
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
