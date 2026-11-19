/* staging_smoke_mp.js —— P3 小程序「devtools 真实登录 + 读接口」staging 冒烟（仅 staging）
 *
 * 前置（脚本会校验）：
 *   1) 微信开发者工具已用 **staging 配置** 重新打开并开启自动化端口：
 *        a. cli.bat close --project "C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools"
 *        b. 把 utils/cloud-config.js 的 ACTIVE_REST_PROFILE 临时改为 'staging'
 *        c. cli.bat auto --project "C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools" --auto-port 9420 --trust-project
 *      （见 deploy/migration/CLIENTS.md §4.1；冒烟结束把配置改回 'cloudbase' 并关闭/重开 devtools）
 *   2) P1 staging 已就绪：POST http://121.196.47.2/v1/rdb/rest-next/rpc/class_verify 返回 200。
 * 运行：node staging_smoke_mp.js
 *
 * 实现说明：本环境 devtools 的 Page.callMethod / mp.evaluate 里的 require 不可用，
 * 统一改为 `mp.evaluate(getCurrentPages()[last] / wx.*)` 直接调用页面方法与读取本机 storage。
 *
 * 红线：只用测试账号 3260799999/测试账号；只连 staging（先校验配置与 staging RPC，否则拒绝运行）；
 *      只读（登录 + 读接口）；不打印 token/publishableKey；结束清空 devtools 本机 storage。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const automator = require('miniprogram-automator');

const MP_ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');
const CFG = path.join(MP_ROOT, 'utils/cloud-config.js');
const STAGING = 'http://121.196.47.2/v1/rdb/rest-next/';
const SID = '3260799999';
const NAME = '测试账号';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, data ? { 'Content-Length': data.length } : {}),
      timeout: 10000,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(150);
  }
  throw new Error('TIMEOUT ' + (label || '') + ' (' + timeoutMs + 'ms)');
}

(async () => {
  const report = { at: new Date().toISOString(), endpoint: STAGING, steps: [], checks: [], errors: [], exceptions: [], ok: false };
  let mp = null;
  try {
    // 0) 安全前置：配置档位 + staging RPC 就绪（避免任何请求打到生产 CloudBase）
    const cfgSrc = fs.readFileSync(CFG, 'utf8');
    const m = cfgSrc.match(/const ACTIVE_REST_PROFILE = '([a-z]+)';/);
    const profile = m ? m[1] : '(未找到)';
    if (profile !== 'staging') throw new Error('拒绝运行：utils/cloud-config.js 的 ACTIVE_REST_PROFILE=' + profile + '（需临时改为 staging）');
    report.configProfile = profile;
    const pre = await httpJson('POST', STAGING + 'rpc/class_verify', { p_sid: SID, p_name: NAME });
    report.stagingPreflight = { status: pre.status };
    if (pre.status !== 200) throw new Error('staging 未就绪：class_verify HTTP ' + pre.status + '（等 P1 导入后再跑）');

    mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
    mp.on('exception', (e) => report.exceptions.push(String(e)));

    // 1) 清空 devtools 本机 storage，确保走真实登录流程
    await mp.evaluate(function () { wx.clearStorageSync(); return true; });

    // 2) 身份页真实登录（UI 同款入口：setData + submit；真实网络 class_verify + class_members）
    await mp.reLaunch('/pages/identity/identity');
    await waitFor(async () => {
      const r = await mp.evaluate(function () {
        const p = getCurrentPages(); const c = p[p.length - 1];
        return c && c.route;
      });
      return String(r || '').indexOf('identity') >= 0;
    }, 10000, 'identity page');
    const tLogin = Date.now();
    const submitted = await mp.evaluate(function (sid, name) {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      if (!p || typeof p.submit !== 'function') return { ok: false, err: 'no submit on ' + (p && p.route) };
      p.setData({ sid: sid, name: name });
      p.submit();
      return { ok: true };
    }, SID, NAME);
    if (!submitted || !submitted.ok) throw new Error('提交登录失败：' + JSON.stringify(submitted));
    await waitFor(async () => {
      const r = await mp.evaluate(function () {
        const p = getCurrentPages(); const c = p[p.length - 1];
        return c && c.route;
      });
      return String(r || '').indexOf('pages/index/index') >= 0;
    }, 25000, 'login -> index');
    report.loginMs = Date.now() - tLogin;
    report.steps.push({ step: 'login', ok: true, to: 'pages/index/index', ms: report.loginMs });

    // 3) 等首屏 warm sync（marks / homework / notices / userdata / members 真实读）
    await sleep(4000);
    const storage = await mp.evaluate(function () {
      const keys = (wx.getStorageInfoSync() || {}).keys || [];
      const parse = function (v) { if (v == null || v === '') return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return v; } } return v; };
      const identity = parse(wx.getStorageSync('zq_class_identity')) || {};
      const store = parse(wx.getStorageSync('zq_tools_v2')) || {};
      const syncKey = keys.filter(function (k) { return k.indexOf('lastSync') >= 0; })[0];
      const sync = (syncKey ? parse(wx.getStorageSync(syncKey)) : null) || {};
      return {
        identity: { sid: identity.sid, name: identity.name, hasToken: !!identity.token },
        members: (store.classMembers || []).length,
        syncKeys: Object.keys(sync),
        storageKeys: keys.length,
        storageKeyNames: keys
      };
    });
    report.steps.push(Object.assign({ step: 'storage' }, storage));

    // 4) 通知页真实读（RLS 下发；弱网会显示上次快照）
    await mp.navigateTo('/pages/nt/nt');
    await sleep(3500);
    const ntData = await mp.evaluate(function () {
      const p = getCurrentPages(); const c = p[p.length - 1];
      return { route: c && c.route, data: (c && c.data) || {} };
    });
    report.steps.push({
      step: 'notices', route: ntData.route, state: ntData.data.state,
      cards: (ntData.data.cards || []).length,
      longterm: ntData.data.longtermCount,
      syncText: ntData.data.syncText,
    });

    // 5) 课表快照（site_assets）真实读
    await mp.navigateTo('/pages/tt/tt');
    await sleep(3000);
    const ttData = await mp.evaluate(function () {
      const p = getCurrentPages(); const c = p[p.length - 1];
      const d = (c && c.data) || {};
      return { route: c && c.route, state: d.state, total: d.total, srcText: d.srcText };
    });
    report.steps.push({ step: 'timetable', route: ttData.route, state: ttData.state, total: ttData.total, srcText: ttData.srcText });

    // 6) 作业页真实读（页面 onShow → cloud.cloudPull(force)：homework / userdata / marks 一起刷新）
    await mp.navigateTo('/pages/hw/hw');
    await sleep(3500);
    const hwData = await mp.evaluate(function () {
      const p = getCurrentPages(); const c = p[p.length - 1];
      const d = (c && c.data) || {};
      return { route: c && c.route, state: d.state, rows: (d.rows || d.list || d.homework || []).length };
    });
    const storage2 = await mp.evaluate(function () {
      const keys = (wx.getStorageInfoSync() || {}).keys || [];
      const parse = function (v) { if (v == null || v === '') return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return v; } } return v; };
      const syncKey = keys.filter(function (k) { return k.indexOf('lastSync') >= 0; })[0];
      const sync = (syncKey ? parse(wx.getStorageSync(syncKey)) : null) || {};
      return { syncKeys: Object.keys(sync) };
    });
    report.steps.push({ step: 'homework', route: hwData.route, state: hwData.state, rows: hwData.rows, syncKeys: storage2.syncKeys });

    // 7) 判定
    const syncKeys = (storage2.syncKeys && storage2.syncKeys.length ? storage2.syncKeys : storage.syncKeys);

    // 6) 判定
    const checks = [
      ['identity-saved(staging)', !!(storage.identity && storage.identity.hasToken && storage.identity.sid === SID && storage.identity.name === NAME)],
      ['members>0', storage.members > 0],
      ['marks-read', syncKeys.indexOf('marks') >= 0],
      ['homework-read', syncKeys.indexOf('hw') >= 0],
      ['notices-read', syncKeys.indexOf('nt') >= 0],
      ['userdata-read', syncKeys.indexOf('ud') >= 0],
      ['notices-page', !!(ntData && ntData.data && (ntData.data.state === 'ready' || ntData.data.state === 'empty'))],
      ['timetable-page', !!(ttData && (ttData.state === 'data' || ttData.state === 'empty'))],
      ['homework-page', !!(hwData && hwData.state !== 'error')],
    ];
    report.checks = checks.map(function (c) { return { name: c[0], ok: !!c[1] }; });
    report.ok = checks.every(function (c) { return !!c[1]; });
    report.syncKeys = syncKeys;
    try { require('fs').writeFileSync(require('path').join(__dirname, 'staging_smoke_result.json'), JSON.stringify(report, null, 2), 'utf8'); } catch (e) { /* ignore */ }
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 2;
  } catch (e) {
    report.errors.push(String((e && e.message) || e));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    try { if (mp) await mp.evaluate(function () { wx.clearStorageSync(); return true; }); } catch (e) { /* ignore */ }
    try { if (mp) await mp.disconnect(); } catch (e) { /* ignore */ }
  }
})().catch((e) => { console.error('SMOKE FATAL', e); process.exit(1); });
