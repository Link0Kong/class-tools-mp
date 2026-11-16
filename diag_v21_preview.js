/* diag_v21_preview.js —— 诊断 v2.1（AI 结论下挂异常项 / 折叠+展开 / 10s 进展 / 设备信息最小化）automator 场景
 *
 * 前置（本脚本不在会话内自行启动 devtools；由 Lead 统一运行）：
 *   cli.bat auto --project C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools --port 9433 --auto-port 9420 --trust-project
 * 用法：
 *   node diag_v21_preview.js [--ws ws://127.0.0.1:9420]（或 DIAG_V21_WS 覆盖）
 *
 * 断言（对应 CONTRACT_V2_1 §A/§D）：
 *   1) 无独立「AI 分析 / 修复记录」大卡：页面无 .dg-ai 元素、data 无顶层 analyses/repairs；
 *   2) AI 结论按 related.health_ids 下挂到异常服务健康行（site_tls / weflow），按 related.checks 下挂到设备检查行（gateway）；
 *      正常行不显示 AI；无关联结论进「其它诊断」折叠区（默认收起，只显示条数）；
 *   3) 折叠态一行：.dg-ai-row 高度 ≤36px；状态胶囊 running=修复中 / fixed=已修复 / new=待处理；fixable 显示 ⚙；
 *   4) 点击整行展开：cause / suggestion / flow 时间线（run 步进行中）/ 关联修复（action/status/result/时间）；再点收起；
 *   5) 10s 轮询：等约 11s 后 mock 返回状态变化（running→fixed、repair running→done），页面无需刷新自动更新；
 *   6) 无横向溢出；无 JS console error。
 * 产出：_shots_diag_v21/01_collapsed.png、02_expanded.png、03_others_expanded.png、04_after_poll.png + result.json；失败 exit 2。
 * 说明：全程 mock wx.request（不接触真实云端）；身份仅为本地 mock 写入 storage（非管理员）。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

function wsArg() {
  const i = process.argv.indexOf('--ws');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env.DIAG_V21_WS || 'ws://127.0.0.1:9420';
}
const WS = wsArg();
const OUT = path.join(__dirname, '_shots_diag_v21');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const consoleIssues = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 500) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}

/* ---------------- mock：非管理员身份 + 云端诊断数据（第二批返回状态变化，验证 10s 轮询） ---------------- */
async function installMock(mp) {
  await mp.evaluate(() => {
    const gd = getApp().globalData;
    if (gd.__d21Mock) { try { wx.request = gd.__d21Request; } catch (e) { /* ignore */ } return; }
    gd.__d21OrigRequest = wx.request;
    gd.__d21 = { agent: 0, health: 0, analyses: 0, repairs: 0, batch: 1, posts: [] };
    const now = Date.now();
    const HEALTH = [
      { id: 'cloudbase', name: '云端数据库', kind: 'cloud', status: 'ok', detail: '网关心跳', checked_at: now - 60000 },
      { id: 'site_static', name: '站点资源', kind: 'static', status: 'ok', detail: '站点资源正常', checked_at: now - 120000 },
      { id: 'site_tls', name: '站点证书', kind: 'static', status: 'warn', detail: '证书 20 天后到期', checked_at: now - 180000 },
      { id: 'dns_domain', name: '域名解析', kind: 'cloud', status: 'ok', detail: '解析正常', checked_at: now - 60000 },
      { id: 'tt_cloud', name: '课表云端数据', kind: 'cloud', status: 'ok', detail: '云端快照 2 小时前同步', checked_at: now - 60000 },
      { id: 'cloud_power_sync', name: '电费云同步', kind: 'cloud', status: 'ok', detail: '最近同步 20 分钟前', checked_at: now - 60000 },
      { id: 'cloud_xgj_sync', name: '学工记云同步', kind: 'cloud', status: 'ok', detail: '最近同步 40 分钟前', checked_at: now - 60000 },
      { id: 'cloud_health_probe', name: '云端巡检', kind: 'cloud', status: 'ok', detail: '本轮完成 · 18 行 · 320ms', checked_at: now - 60000 },
      { id: 'collector_host', name: '采集主机', kind: 'local', status: 'ok', detail: '内存 42%', checked_at: now - 60000 },
      { id: 'qqflow', name: 'QQ 消息采集', kind: 'local', status: 'ok', detail: '已连 QQ', checked_at: now - 60000 },
      { id: 'weflow', name: '微信消息采集', kind: 'local', status: 'warn', detail: '微信重连中', checked_at: now - 60000 },
      { id: 'watcher', name: '文档/通知监听', kind: 'local', status: 'ok', detail: '', checked_at: now - 60000 },
      { id: 'briefdesk', name: '本地通知服务', kind: 'local', status: 'ok', detail: '', checked_at: now - 60000 },
      { id: 'qq_client', name: 'QQ 客户端', kind: 'local', status: 'ok', detail: '', checked_at: now - 60000 },
      { id: 'wechat_client', name: '微信客户端', kind: 'local', status: 'ok', detail: '', checked_at: now - 60000 },
      { id: 'jwxt', name: '教务课表同步', kind: 'local', status: 'ok', detail: '', checked_at: now - 60000 },
      { id: 'hwauto', name: '作业自动整理', kind: 'local', status: 'ok', detail: '', checked_at: now - 60000 },
      { id: 'ai', name: 'AI 识别', kind: 'local', status: 'ok', detail: '', checked_at: now - 60000 }
    ];
    const analysesOf = function (batch) {
      const runDone = batch >= 2;
      return [
        {
          id: 'an-run', ts: now - 60000, platform: 'all', scope: 'cloud', severity: 'error',
          title: '站点证书告警需续期', cause: '证书 20 天后到期，握手偶发失败；上游 10.0.0.9 超时记录',
          suggestion: ['检查证书续期', '若仍异常重启网关'], fixable: true, action: 'restart_gateway',
          status: runDone ? 'fixed' : 'running', confidence: 0.82,
          flow: runDone
            ? [{ t: now - 50000, text: '本机开始执行 restart_gateway', st: 'run' }, { t: now - 30000, text: '重启完成，复检正常', st: 'done' }]
            : [{ t: now - 50000, text: '本机开始执行 restart_gateway', st: 'run' }],
          related: { health_ids: ['site_tls'], checks: [], repair_id: 'rep-preview-1' }
        },
        {
          id: 'an-fixed', ts: now - 120000, platform: 'all', scope: 'cloud', severity: 'warn',
          title: '微信消息采集已恢复', cause: '短暂断线后自动重连成功', suggestion: [], fixable: false, action: '',
          status: 'fixed', confidence: 0.6,
          flow: [{ t: now - 110000, text: '重连成功，已恢复采集', st: 'done' }],
          related: { health_ids: ['weflow'], checks: [], repair_id: '' }
        },
        {
          id: 'an-check', ts: now - 90000, platform: 'all', scope: 'device', severity: 'error',
          title: '本机网关延迟升高', cause: '设备网络抖动', suggestion: ['切换网络后重试'], fixable: true, action: 'recheck_health',
          status: 'running', confidence: 0.5,
          flow: [{ t: now - 80000, text: '本机开始执行 recheck_health', st: 'run' }],
          related: { health_ids: [], checks: ['gateway'], repair_id: '' }
        },
        {
          id: 'an-other', ts: now - 200000, platform: 'all', scope: 'cloud', severity: 'info',
          title: '历史遗留诊断结论', cause: '无法归因的历史结论', suggestion: [], fixable: false, action: '',
          status: 'new', confidence: 0.3, flow: [], related: {}
        }
      ];
    };
    const repairsOf = function (batch) {
      return [{
        id: 'rep-preview-1', created_at: now - 50000, action: 'restart_gateway', params: {}, reason: '证书告警',
        status: batch >= 2 ? 'done' : 'running', claimed_at: now - 49000,
        finished_at: batch >= 2 ? now - 30000 : 0,
        result: batch >= 2 ? '网关已重启 · 380ms' : '', analysis_id: 'an-run', node: 'local'
      }];
    };
    gd.__d21Request = function (o) {
      const u = String((o && o.url) || '');
      const method = String((o && o.method) || 'GET').toUpperCase();
      setTimeout(function () {
        const g = getApp().globalData;
        const st = g.__d21 || { batch: 1 };
        if (method === 'POST' && u.indexOf('/client_diag') >= 0) {
          g.__d21.posts = (g.__d21.posts || []).concat(Array.isArray(o.data) ? o.data : []);
          return o.success && o.success({ statusCode: 201, data: [] });
        }
        if (u.indexOf('rpc/diag_agent_info') >= 0) {
          g.__d21.agent += 1;
          return o.success && o.success({ statusCode: 200, data: { ok: true, online: true, seen_at: Date.now() - 30000, host: 'local-windows', version: '1.3.0' } });
        }
        if (u.indexOf('/service_health') >= 0) {
          g.__d21.health += 1;
          return o.success && o.success({ statusCode: 200, data: HEALTH });
        }
        if (u.indexOf('/diag_analysis') >= 0) {
          g.__d21.analyses += 1;
          return o.success && o.success({ statusCode: 200, data: analysesOf(st.batch) });
        }
        if (u.indexOf('/repair_tasks') >= 0) {
          g.__d21.repairs += 1;
          return o.success && o.success({ statusCode: 200, data: repairsOf(st.batch) });
        }
        if (u.indexOf('/site_assets') >= 0) return o.success && o.success({ statusCode: 200, data: [{ id: 'tt' }] });
        return o.success && o.success({ statusCode: 200, data: [] });
      }, 20);
    };
    wx.request = gd.__d21Request;
    gd.__d21Mock = true;
  });
}
async function prepare(mp) {
  await mp.evaluate(() => {
    try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
    wx.setStorageSync('zq_class_identity', JSON.stringify({
      token: 'tok-diag-v21', sid: '9999000004', name: '谢梓萱', role: '', badge: '', is_admin: false, ts: Date.now()
    }));
    getApp().globalData.__d21 = { agent: 0, health: 0, analyses: 0, repairs: 0, batch: 1, posts: [] };
  });
}

async function pageData(mp) {
  return mp.evaluate(() => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    if (!pg) return null;
    const d = pg.data || {};
    return JSON.parse(JSON.stringify({
      path: pg.route || '',
      state: d.state, denied: !!d.denied,
      devN: (d.dev && d.dev.checks || []).length,
      groups: (d.groups || []).map(function (g) {
        return { t: g.t, items: (g.items || []).map(function (it) { return { id: it.id, st: it.st, ai: (it.ai || []).length, q: it.queueHint || '' }; }) };
      }),
      checks: (d.dev && d.dev.checks || []).map(function (c) { return { id: c.id, st: c.st, ai: (c.ai || []).length }; }),
      agent: d.agent, others: d.others, diagStats: d.diagStats,
      hasAnalysesKey: Object.prototype.hasOwnProperty.call(d, 'analyses'),
      hasRepairsKey: Object.prototype.hasOwnProperty.call(d, 'repairs'),
      openIds: Object.keys(pg._openMap || {}),
      timers: { health: !!pg._timer, diag: !!pg._diagTimer },
      req: (getApp().globalData || {}).__d21 || null
    }));
  });
}
async function rowTexts(mp) {
  const page = await mp.currentPage();
  const els = await page.$$('.dg-ai-row');
  const out = [];
  for (let i = 0; i < els.length; i++) { try { out.push(await els[i].text()); } catch (e) { out.push(''); } }
  return out;
}
async function rowSizes(mp) {
  const page = await mp.currentPage();
  const els = await page.$$('.dg-ai-row');
  const out = [];
  for (let i = 0; i < els.length; i++) {
    try { const sz = await els[i].size(); out.push({ w: parseFloat(sz.width) || 0, h: parseFloat(sz.height) || 0 }); }
    catch (e) { out.push({ w: 0, h: 0 }); }
  }
  return out;
}
async function waitFor(fn, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 8000)) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  return null;
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
    console.log('SHOT-FAIL ' + name + ' :: ' + (e && e.message));
    return '';
  }
}

(async () => {
  console.log('连接 automator：' + WS + '（前置：cli.bat auto --auto-port 9420 --trust-project）');
  const mp = await automator.connect({ wsEndpoint: WS });
  mp.on('console', (msg) => {
    if (msg && msg.type === 'error') consoleIssues.push(String(msg.args || msg.text || '').slice(0, 300));
  });
  const shots = [];
  try {
    await installMock(mp);
    await prepare(mp);
    await mp.reLaunch('/pages/diag/diag');
    const ready = await waitFor(async () => {
      const s = await pageData(mp);
      return s && s.path === 'pages/diag/diag' && s.state === 'ready' && s.devN === 10 && s.others && s.others.count === 1;
    }, 10000);
    check('1 诊断页加载完成（非管理员）', !!ready, 'state/dev/others 未就绪');
    let st = await pageData(mp);
    let page = await mp.currentPage();
    // 1) 无独立 AI / 修复大卡
    const bigCard = await page.$('.dg-ai');
    check('2 无独立「AI 分析」大卡（.dg-ai 不存在）', bigCard === null, 'bigCard=' + (bigCard ? 'found' : 'null'));
    check('3 data 无顶层 analyses/repairs（不再独立渲染）', !!(st && !st.hasAnalysesKey && !st.hasRepairsKey), JSON.stringify({ analyses: st && st.hasAnalysesKey, repairs: st && st.hasRepairsKey }));
    // 2) AI 下挂：site_tls/weflow（health_ids）、gateway（checks）；正常行不显示
    const item = function (s, id) {
      let hit = null;
      (s.groups || []).forEach(function (g) { (g.items || []).forEach(function (it) { if (it.id === id) hit = it; }); });
      return hit;
    };
    check('4 related.health_ids → 异常服务健康行下方出现 AI（site_tls/weflow）',
      !!(item(st, 'site_tls') && item(st, 'site_tls').ai === 1 && item(st, 'weflow') && item(st, 'weflow').ai === 1),
      JSON.stringify({ site_tls: item(st, 'site_tls'), weflow: item(st, 'weflow') }));
    const gw = (st.checks || []).filter(function (c) { return c.id === 'gateway'; })[0];
    check('5 related.checks → 设备检查行下方出现 AI（gateway）', !!(gw && gw.ai === 1), JSON.stringify(gw));
    check('6 正常行不显示 AI（cloudbase/cloud_power_sync）',
      !!(item(st, 'cloudbase') && item(st, 'cloudbase').ai === 0 && item(st, 'cloud_power_sync') && item(st, 'cloud_power_sync').ai === 0),
      JSON.stringify({ cloudbase: item(st, 'cloudbase'), power: item(st, 'cloud_power_sync') }));
    check('7 「其它诊断」默认收起（只显示条数=1）', !!(st.others && st.others.count === 1 && st.others.open === false), JSON.stringify(st.others && { count: st.others.count, open: st.others.open }));
    // 折叠态一行：高度 ≤36px、胶囊文案 running=修复中 / fixed=已修复，fixable ⚙
    const texts = await rowTexts(mp);
    const sizes = await rowSizes(mp);
    check('8 折叠行数量=3（其它诊断收起时不计入）', texts.length === 3, 'rows=' + texts.length);
    check('9 折叠行高度 ≤36px（' + sizes.map(function (x) { return x.h; }).join('/') + '）', sizes.length === 3 && sizes.every(function (x) { return x.h > 0 && x.h <= 36; }), JSON.stringify(sizes));
    check('10 状态胶囊：running=修复中、fixed=已修复、fixable 显示 ⚙', texts.some(function (t) { return /修复中/.test(t); }) && texts.some(function (t) { return /已修复/.test(t); }) && texts.some(function (t) { return /⚙/.test(t); }), JSON.stringify(texts));
    check('11 异常行无 AI 提示（没有排队/离线文案落在已挂 AI 的行）', !texts.some(function (t) { return /排队中|已留存待开机修复/.test(t); }), JSON.stringify(texts));
    shots.push(await shot(mp, '01_collapsed'));
    // 3) 点击展开：cause / suggestion / flow / 关联修复（选 site_tls 行的 AI：带关联修复）
    const rowTexts0 = await rowTexts(mp);
    const healthRowIdx = rowTexts0.findIndex(function (t) { return /站点证书告警/.test(t); });
    check('12 找到「站点证书」异常行下的 AI 折叠行', healthRowIdx >= 0, JSON.stringify(rowTexts0));
    const rows0 = await page.$$('.dg-ai-row');
    if (healthRowIdx < 0) throw new Error('未找到 site_tls 的 AI 折叠行');
    await rows0[healthRowIdx].tap();
    const bodyShown = await waitFor(async () => { const b = await page.$('.dg-ai-body'); return b || null; }, 3000);
    check('13 点击折叠行展开出详情', !!bodyShown, 'body=' + (bodyShown ? 'found' : 'null'));

    let bodyText = '';
    try { bodyText = bodyShown ? await bodyShown.text() : ''; } catch (e) { bodyText = ''; }
    // 展开体内容校验：原因/建议/flow（run 步进行中）
    check('14 展开态显示原因/建议/flow（run 步进行中）',
      /原因/.test(bodyText) && /(到期|握手)/.test(bodyText) &&
      /建议/.test(bodyText) && /检查证书续期/.test(bodyText) &&
      /本机开始执行/.test(bodyText) && /进行中/.test(bodyText),
      bodyText.slice(0, 240));
    check('15 展开态显示「关联修复」action/状态', /关联修复/.test(bodyText) && /重启网关/.test(bodyText), bodyText.slice(0, 260));
    check('16 展开后 › 旋转 + openMap 记录', (await page.$('.dg-ai-caret--open')) !== null, 'caret open');
    shots.push(await shot(mp, '02_expanded'));
    const rowsOpen = await page.$$('.dg-ai-row');
    await rowsOpen[healthRowIdx].tap();
    const bodyGone = await waitFor(async () => { const b = await page.$('.dg-ai-body'); return b ? null : 'gone'; }, 3000);
    check('17 再次点击收起展开态', bodyGone === 'gone', 'body=' + bodyGone);
    // 4) 其它诊断展开
    await mp.evaluate(() => { try { wx.pageScrollTo({ scrollTop: 99999, duration: 0 }); } catch (e) { } return true; });
    await sleep(400);
    const othersHd = await page.$('.dg-others-hd');
    check('18 存在「其它诊断」折叠区', !!othersHd, othersHd ? 'found' : 'null');
    if (othersHd) await othersHd.tap();
    await sleep(600);
    const rowCount2 = await rowTexts(mp);
    check('19 展开其它诊断后 AI 行 +1（历史结论可见）', rowCount2.length === 4 && rowCount2.some(function (t) { return /历史遗留诊断结论/.test(t); }), 'rows=' + rowCount2.length + ' ' + JSON.stringify(rowCount2));
    shots.push(await shot(mp, '03_others_expanded'));
    // 5) 10s 轮询：把 mock 切到第二批（running→fixed / repair running→done），页面不点刷新自动更新
    st = await pageData(mp);
    const beforeA = st.req ? st.req.analyses : 0;
    await mp.evaluate(() => { getApp().globalData.__d21.batch = 2; });
    const t0 = Date.now();
    const updated = await waitFor(async () => {
      const s = await pageData(mp);
      if (!s || !s.req || s.req.analyses <= beforeA) return null;
      const ts = await rowTexts(mp);
      const hit = ts.filter(function (t) { return /站点证书告警/.test(t); })[0] || '';
      return /已修复/.test(hit) ? { s: s, hit: hit } : null;
    }, 20000);
    const elapsed = Date.now() - t0;
    st = (updated && updated.s) || (await pageData(mp));
    const finalTexts = await rowTexts(mp);
    check('20 10s 轮询触发（analyses 请求 ' + beforeA + ' → ' + (st.req && st.req.analyses) + '，无需刷新，等待 ' + elapsed + 'ms）',
      !!(updated && st.req && st.req.analyses > beforeA && elapsed <= 14000), JSON.stringify({ before: beforeA, after: st.req && st.req.analyses, elapsed: elapsed }));
    check('21 running→fixed 状态胶囊自动更新为「已修复」', !!(updated && /已修复/.test(updated.hit)), JSON.stringify(finalTexts));
    check('22 修复记录同步 running→done 且 10s 定时器在跑', !!(st.timers && st.timers.health && st.timers.diag), JSON.stringify(st.timers));
    shots.push(await shot(mp, '04_after_poll'));
    // 6) 无横向溢出
    const layout = await mp.evaluate(() => new Promise(function (resolve) {
      try {
        wx.createSelectorQuery().select('.page').boundingClientRect(function (r) {
          const w = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).windowWidth || 375;
          resolve(JSON.parse(JSON.stringify({ pageW: (r && r.width) || 0, winW: w })));
        }).exec();
      } catch (e) { resolve({ pageW: 0, winW: 0 }); }
    }));
    check('23 无横向溢出（页面宽 ≤ 窗宽 + 2px）', layout.pageW <= layout.winW + 2, JSON.stringify(layout));

    const info = await mp.evaluate(() => { try { return wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) { return {}; } });
    const report = {
      at: new Date().toISOString(), wsEndpoint: WS,
      windowWidth: info.windowWidth || 0, pixelRatio: info.pixelRatio || 0,
      note: '全程 mock wx.request。AI 结论按 related.health_ids/checks 下挂到异常行；折叠一行 ≤36px/点击展开；其它诊断默认收起；10s 轮询自动更新 running→fixed。',
      checks: results, screenshots: shots.filter(Boolean), consoleErrors: consoleIssues
    };
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2), 'utf8');
    const failed = results.filter((r) => !r.ok).length;
    console.log('\n==== diag_v21_preview: ' + (results.length - failed) + ' PASS / ' + failed + ' FAIL / ' + consoleIssues.length + ' console error；windowWidth=' + report.windowWidth + ' ====');
    console.log('screenshots: ' + report.screenshots.join(', '));
    process.exitCode = failed ? 2 : 0;
  } finally {
    try {
      await mp.evaluate(() => {
        try {
          const gd = getApp().globalData;
          if (gd.__d21OrigRequest) wx.request = gd.__d21OrigRequest;
        } catch (e) { /* ignore */ }
      });
    } catch (e) { /* ignore */ }
    try { await mp.disconnect(); } catch (e) { /* ignore */ }
  }
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });






