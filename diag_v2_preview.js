/* diag_v2_preview.js —— 诊断 v2（全班可见 + 设备诊断 + 自动上报 + AI 分析/修复流程）automator 场景
 *
 * ⚠️ 已被 2026-11-09 诊断 v2.1（`diag_v21_preview.js`）取代：v2.1 删除了独立「AI 分析 / 修复记录」大卡，
 *    改为 AI 结论下挂异常项 + 折叠/展开 + 10s 轮询。本脚本针对旧 v2 布局，**在 v2.1 页面上不再适用**，
 *    仅作历史留档；请运行 `diag_v21_preview.js`。
 *
 * 前置（本脚本不在会话内自行启动 devtools；由 Lead 统一运行）：
 *   cli.bat auto --project C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools --port 9433 --auto-port 9420 --trust-project
 * 用法：
 *   node diag_v2_preview.js [--ws ws://127.0.0.1:9420]（或 DIAG_V2_WS 覆盖）
 *
 * 断言：
 *   1) **非管理员**班级身份可见诊断页：denied=false、state=ready、服务健康 18 行 / 5 组；
 *   2) 设备诊断卡 10 项（应用/设备/屏幕/基础库/内存/存储/网络/网关/课表快照/JS 错误）；
 *   3) 设备异常自动上报 client_diag：POST 路径、行字段（platform/app_ver/kind/level/message/detail/device/
 *      fingerprint/ts/sid）、脱敏（无姓名/IP/宿舍号/token）、≤3 条；
 *   4) 本机 agent 在线状态 + AI 分析（原因/建议/flow 时间线）+ 修复任务渲染；
 *   5) 15s 轮询：rpc/diag_agent_info 请求数在 ~16s 后增加；服务健康 60s 定时器存在；
 *   6) 无 JS 错误 / 无横向溢出。
 * 产出：_shots_diag_v2/01..04*.png + result.json；失败 exit 2。
 * 说明：全程 mock wx.request（不接触真实云端）；身份仅为本地 mock 写入 storage（非管理员）。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

function wsArg() {
  const i = process.argv.indexOf('--ws');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env.DIAG_V2_WS || 'ws://127.0.0.1:9420';
}
const WS = wsArg();
const OUT = path.join(__dirname, '_shots_diag_v2');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const consoleIssues = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 500) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}

/* ---------------- mock：非管理员身份 + 云端诊断数据 ---------------- */
async function installMock(mp) {
  await mp.evaluate(() => {
    const gd = getApp().globalData;
    if (gd.__diagMock) { try { wx.request = gd.__diagRequest; } catch (e) { /* ignore */ } return; }
    gd.__diagOrigRequest = wx.request;
    gd.__diag = { agent: 0, health: 0, analyses: 0, repairs: 0, reports: [] };
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
    const ANALYSES = [
      {
        id: 'an-preview-1', ts: now - 90000, platform: 'all', scope: 'cloud', severity: 'error',
        title: '云端巡检延迟升高', cause: '采集主机 10.0.0.8 队列积压；日志 C:\\briefdesk\\logs\\agent.log 可见',
        suggestion: ['重测依赖服务', '若仍异常则重启采集主机'], fixable: true, action: 'recheck_health',
        status: 'fixed', confidence: 0.86,
        flow: [
          { t: now - 80000, text: '检测到 cloud_health_probe 延迟 3500ms', st: 'done' },
          { t: now - 70000, text: '已执行 recheck_health，恢复正常', st: 'done' }
        ]
      },
      {
        id: 'an-preview-2', ts: now - 3600000, platform: 'all', scope: 'device', severity: 'warn',
        title: '部分机型基础库偏旧', cause: '基础库 2.25.0 < 2.30.0，canvas 2d 能力可能缺失',
        suggestion: ['引导用户升级微信'], fixable: false, action: '', status: 'manual', confidence: 0.42, flow: []
      }
    ];
    const REPAIRS = [
      { id: 'rep-preview-1', created_at: now - 70000, action: 'recheck_health', params: {}, reason: '巡检延迟', status: 'done', claimed_at: now - 69000, finished_at: now - 68000, result: '18 行 · 320ms', analysis_id: 'an-preview-1', node: 'local' }
    ];
    gd.__diagRequest = function (o) {
      const u = String((o && o.url) || '');
      const method = String((o && o.method) || 'GET').toUpperCase();
      setTimeout(function () {
        const g = getApp().globalData;
        if (method === 'POST' && u.indexOf('/client_diag') >= 0) {
          g.__diag.reports = g.__diag.reports.concat(Array.isArray(o.data) ? o.data : []);
          return o.success && o.success({ statusCode: 201, data: [] });
        }
        if (u.indexOf('rpc/diag_agent_info') >= 0) {
          g.__diag.agent += 1;
          return o.success && o.success({ statusCode: 200, data: { ok: true, online: true, seen_at: Date.now() - 30000, host: 'local-windows', version: '1.2.0' } });
        }
        if (u.indexOf('/service_health') >= 0) { g.__diag.health += 1; return o.success && o.success({ statusCode: 200, data: HEALTH }); }
        if (u.indexOf('/diag_analysis') >= 0) { g.__diag.analyses += 1; return o.success && o.success({ statusCode: 200, data: ANALYSES }); }
        if (u.indexOf('/repair_tasks') >= 0) { g.__diag.repairs += 1; return o.success && o.success({ statusCode: 200, data: REPAIRS }); }
        // site_assets：设备诊断的网关/快照探测 → 故意返回空（模拟快照不可用，触发一条「注意」自动上报）
        if (u.indexOf('/site_assets') >= 0) return o.success && o.success({ statusCode: 200, data: [] });
        return o.success && o.success({ statusCode: 200, data: [] });
      }, 20);
    };
    wx.request = gd.__diagRequest;
    gd.__diagMock = true;
  });
}
async function prepare(mp) {
  await mp.evaluate(() => {
    try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
    // 普通成员（非管理员）
    wx.setStorageSync('zq_class_identity', JSON.stringify({
      token: 'tok-diag-preview', sid: '9999000004', name: '谢梓萱',
      role: '', badge: '', is_admin: false, ts: Date.now()
    }));
    getApp().globalData.__diag = { agent: 0, health: 0, analyses: 0, repairs: 0, reports: [] };
  });
}

async function pageState(mp) {
  return mp.evaluate(() => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    if (!pg) return null;
    return JSON.parse(JSON.stringify({
      path: pg.route || '',
      state: pg.data.state, denied: !!pg.data.denied, busy: !!pg.data.busy,
      groups: (pg.data.groups || []).length,
      rows: (pg.data.groups || []).reduce(function (a, g) { return a + (g.items || []).length; }, 0),
      summary: pg.data.summary, lastTryText: pg.data.lastTryText,
      dev: { n: (pg.data.dev && pg.data.dev.checks || []).length, text: (pg.data.dev && pg.data.dev.summary && pg.data.dev.summary.text) || '', ts: (pg.data.dev && pg.data.dev.tsText) || '' },
      agent: pg.data.agent, analyses: (pg.data.analyses || []).length, repairs: (pg.data.repairs || []).length,
      flowN: (pg.data.analyses && pg.data.analyses[0] && pg.data.analyses[0].flow || []).length,
      reportText: pg.data.reportText || '',
      timers: { health: !!pg._timer, diag: !!pg._diagTimer },
      req: (getApp().globalData || {}).__diag || null
    }));
  });
}
async function waitFor(fn, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 8000)) {
    const v = await fn();
    if (v) return v;
    await sleep(120);
  }
  return null;
}
async function shot(mp, name) {
  const p = path.join(OUT, name + '.png');
  try { await mp.screenshot({ path: p }); console.log('SHOT  ' + p); return p; } catch (e) {
    for (let i = 0; i < 2; i++) {
      try { await sleep(800); await mp.screenshot({ path: p }); console.log('SHOT  ' + p + ' (retry)'); return p; } catch (e2) { /* next */ }
    }
    console.log('SHOT-FAIL ' + name + ' :: ' + (e && e.message));
    return '';
  }
}
async function scrollTo(mp, top) {
  try { await mp.pageScrollTo(top); } catch (e) {
    try { await mp.evaluate((y) => { wx.pageScrollTo({ scrollTop: y, duration: 0 }); }, top); } catch (e2) { /* ignore */ }
  }
  await sleep(280);
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
      const s = await pageState(mp);
      return s && s.path === 'pages/diag/diag' && s.state === 'ready' && s.dev.n === 10 && s.analyses >= 2;
    }, 10000);
    check('1 诊断页加载完成（非管理员身份）', !!ready, 'state/dev/analyses 未就绪');
    let st = await pageState(mp);
    // 1) 非管理员可见 + 服务健康 18 行保留
    check('2 非管理员可见（denied=false，不再管理员门禁）', !!(st && st.denied === false && st.state === 'ready'), JSON.stringify(st && { denied: st.denied, state: st.state }));
    check('3 服务健康 5 组 / 18 行渲染', !!(st && st.groups === 5 && st.rows === 18), JSON.stringify(st && { groups: st.groups, rows: st.rows }));
    check('4 汇总/刷新时间正常', !!(st && st.summary && /^\d\d:\d\d:\d\d$/.test(st.lastTryText)), JSON.stringify(st && { summary: st.summary, lastTryText: st.lastTryText }));
    // 2) 设备诊断卡 10 项
    check('5 设备诊断卡 10 项 + 检测时间', !!(st && st.dev.n === 10 && st.dev.ts), JSON.stringify(st && st.dev));
    check('6 设备诊断摘要存在（本次 mock 课表快照不可用 → 注意）', !!(st && /项/.test(st.dev.text)), st && st.dev.text);
    // 3) 异常自动上报 client_diag（等异步 POST）
    const posted = await waitFor(async () => {
      const s = await pageState(mp);
      return s && s.req && s.req.reports && s.req.reports.length ? s : null;
    }, 6000);
    check('7 设备异常自动上报 client_diag（POST）', !!posted, '未捕获到 client_diag POST');
    st = await pageState(mp);
    const rep = (st && st.req && st.req.reports) || [];
    check('8 上报条数 1–3 条（每次最多 3 条）', rep.length >= 1 && rep.length <= 3, 'reports=' + rep.length);
    const r0 = rep[0] || {};
    const repJson = JSON.stringify(rep);
    check('9 上报字段契约（id/platform/app_ver/kind/level/message/detail/device/fingerprint/ts/sid）',
      !!(/^mp_/.test(String(r0.id || '')) && r0.platform === 'mp' && r0.app_ver === '2.0.0' &&
        /^(error|network|storage|crash|perf|manual)$/.test(String(r0.kind || '')) &&
        /^(error|warn|info)$/.test(String(r0.level || '')) && r0.message && String(r0.message).length <= 300 &&
        r0.detail && typeof r0.detail === 'object' && r0.device && typeof r0.device === 'object' &&
        /^mp_[0-9a-f]+$/.test(String(r0.fingerprint || '')) && typeof r0.ts === 'number' && r0.sid === '9999000004'),
      JSON.stringify({ id: r0.id, platform: r0.platform, app_ver: r0.app_ver, kind: r0.kind, level: r0.level, fingerprint: r0.fingerprint, sid: r0.sid }));
    check('10 上报内容脱敏（无姓名 / IP / 宿舍号 / token / 密码）',
      repJson.indexOf('谢梓萱') < 0 && repJson.indexOf('10.0.0.8') < 0 && !/\d{1,3}(\.\d{1,3}){3}/.test(repJson) &&
      repJson.indexOf('token') < 0 && repJson.indexOf('pwd') < 0 && repJson.indexOf('宿舍') < 0,
      repJson.slice(0, 240));
    // 4) 本机 agent + AI 分析 + 修复流程
    check('11 本机 agent 在线状态渲染', !!(st && st.agent && st.agent.online === true && st.agent.text === '在线'), JSON.stringify(st && st.agent));
    check('12 AI 分析 2 条（原因/建议/flow 时间线）', !!(st && st.analyses === 2 && st.flowN === 2), JSON.stringify(st && { analyses: st.analyses, flowN: st.flowN }));
    check('13 修复任务 1 条', !!(st && st.repairs === 1), JSON.stringify(st && { repairs: st.repairs }));
    // 5) 定时器 + 15s 轮询
    check('14 服务健康 60s + 诊断 15s 定时器均在跑', !!(st && st.timers.health && st.timers.diag), JSON.stringify(st && st.timers));
    shots.push(await shot(mp, '01_diag_top'));
    await scrollTo(mp, 520);
    shots.push(await shot(mp, '02_device_card'));
    await scrollTo(mp, 1180);
    shots.push(await shot(mp, '03_ai_analysis_flow'));
    await scrollTo(mp, 2100);
    shots.push(await shot(mp, '04_health_groups'));

    const before = st.req.agent;
    const polled = await waitFor(async () => {
      const s = await pageState(mp);
      return s && s.req && s.req.agent > before ? s : null;
    }, 20000);
    check('15 15s 轮询生效（agent 请求数 +' + (polled ? (polled.req.agent - before) : 0) + '）', !!polled, 'before=' + before);

    // 6) 无横向溢出（页面宽度不超过窗口）
    const overflow = await mp.evaluate(() => {
      try {
        return new Promise(function (resolve) {
          wx.createSelectorQuery().select('.page').boundingClientRect(function (r) {
            const w = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).windowWidth || 375;
            resolve(JSON.parse(JSON.stringify({ pageW: r && r.width || 0, winW: w })));
          }).exec();
        });
      } catch (e) { return { pageW: 0, winW: 0 }; }
    });
    check('16 无横向溢出（页面宽 ≤ 窗宽 + 2px）', overflow.pageW <= overflow.winW + 2, JSON.stringify(overflow));

    const info = await mp.evaluate(() => { try { return wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) { return {}; } });
    const report = {
      at: new Date().toISOString(), wsEndpoint: WS,
      windowWidth: info.windowWidth || 0, pixelRatio: info.pixelRatio || 0,
      note: '全程 mock wx.request；非管理员身份可见诊断页；设备异常自动上报 client_diag（脱敏/≤3 条）；AI 分析/修复流程 15s 轮询。',
      checks: results, screenshots: shots.filter(Boolean), consoleErrors: consoleIssues,
      sampleReport: rep[0] || null
    };
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2), 'utf8');
    const failed = results.filter((r) => !r.ok).length;
    console.log('\n==== diag_v2_preview: ' + (results.length - failed) + ' PASS / ' + failed + ' FAIL / ' + consoleIssues.length + ' console error；windowWidth=' + report.windowWidth + ' ====');
    console.log('screenshots: ' + report.screenshots.join(', '));
    process.exitCode = failed ? 2 : 0;
  } finally {
    try {
      await mp.evaluate(() => {
        try {
          const gd = getApp().globalData;
          if (gd.__diagOrigRequest) wx.request = gd.__diagOrigRequest;
        } catch (e) { /* ignore */ }
      });
    } catch (e) { /* ignore */ }
    try { await mp.disconnect(); } catch (e) { /* ignore */ }
  }
})().catch((e) => { console.error('FATAL', (e && e.stack) || e); process.exit(1); });
