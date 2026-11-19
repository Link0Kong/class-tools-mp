/* perf_notice_probe.js —— 小程序启动/通知请求基线（devtools automator + 官方测试身份）
 *
 * 目的：量化 2026-11-17 通知轻量化（class_notices_meta）与启动懒加载的效果。
 * 用法：
 *   1) "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto --project <mp-class-tools> --auto-port 9431 --trust-project
 *   2) node perf_notice_probe.js [ws://127.0.0.1:9431]
 * 输出：perf_notice_result.json
 *   - launch.requests：冷启动后 4s 内 wx.request 的 url/method/status/ms/bytes
 *   - launch.entries：wx.getPerformance() 的 script/render 条目（evaluateScript / firstRender）
 *   - launch.storage：storage keys/currentSize（不含值）
 * 安全：只使用官方测试身份 3260799999/测试账号；清空的是 devtools 本机 storage；
 *       不读取/不打印任何真实账号 token（storage 值只统计，不输出）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const automator = require('miniprogram-automator');
const cfg = require(require('path').resolve(__dirname, '..', 'utils', 'cloud-config.js'));
const OUT = path.join(__dirname, 'perf_notice_result.json');
const WS = process.argv[2] || 'ws://127.0.0.1:9431';
const SID = '3260799999';
const NAME = '测试账号';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function post(p, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(cfg.restBase.replace(/\/$/, '') + p);
    const data = JSON.stringify(body || {});
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.publishableKey }, headers || {}),
      timeout: 20000
    }, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => { let d = null; try { d = JSON.parse(buf); } catch (e) { d = buf; } resolve({ status: res.statusCode, data: d }); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(data); req.end();
  });
}

(async () => {
  const v = await post('/rpc/class_verify', { p_sid: SID, p_name: NAME });
  if (v.status !== 200 || !v.data || !v.data.token) throw new Error('测试身份验证失败（网络/网关不可用）');
  const identity = { token: v.data.token, sid: v.data.sid, name: '', role: v.data.role || '', badge: v.data.badge || '', is_admin: false, ts: Date.now() };


  const mp = await automator.connect({ wsEndpoint: WS });
  try {
    await mp.evaluate(() => { try { wx.clearStorageSync(); } catch (e) {} });
    await mp.evaluate((id) => {
      // 中文名不能经 automator 参数直接传（桥接层会按非 UTF-8 传成乱码）；用码点在小程序内构造。
      id.name = String.fromCharCode(27979, 35797, 36134, 21495); // 测试账号
      wx.setStorageSync('zq_class_identity', id);
    }, identity);
    await mp.evaluate(() => {
      wx.__perfProbe = { req: [], t0: Date.now() };
      const orig = wx.request;
      wx.request = function (o) {
        const t = Date.now();
        const ok = o && o.success, bad = o && o.fail;
        if (o) {
          o.success = function (res) {
            try { wx.__perfProbe.req.push({ url: String(o.url || ''), method: String(o.method || 'GET'), status: Number(res && res.statusCode) || 0, ms: Date.now() - t, bytes: (function () { try { return JSON.stringify(res && res.data).length; } catch (e) { return -1; } })() }); } catch (e) {}
            if (ok) return ok(res);
          };
          o.fail = function (err) {
            try { wx.__perfProbe.req.push({ url: String(o.url || ''), method: String(o.method || 'GET'), status: 0, ms: Date.now() - t, err: String((err && (err.errMsg || err.message)) || err).slice(0, 120) }); } catch (e) {}
            if (bad) return bad(err);
          };
        }
        return orig.call(wx, o);
      };
    });
    await mp.evaluate(() => { wx.reLaunch({ url: '/pages/identity/identity' }); });
    await sleep(4000);
    const launch = await mp.evaluate(() => {
      const perf = wx.getPerformance();
      const st = (function () { try { const s = wx.getStorageInfoSync(); return { keys: s.keys, kb: s.currentSize }; } catch (e) { return null; } })();
      return {
        route: (function () { const p = getCurrentPages(); return p.length ? p[p.length - 1].route : ''; })(),
        requests: wx.__perfProbe.req.slice(),
        entries: perf.getEntries().map((e) => ({ name: e.name, entryType: e.entryType, startTime: e.startTime, duration: e.duration })).filter((e) => e.entryType === 'script' || e.entryType === 'render' || e.entryType === 'navigation'),
        storage: st
      };
    });
    const result = { at: new Date().toISOString(), ws: WS, launch };
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
    const reqs = launch.requests || [];
    const fails = reqs.filter((r) => r.status === 0 || r.status >= 400);
    console.log('WROTE ' + OUT);
    console.log('route=' + launch.route + ' requests=' + reqs.length + ' failed=' + fails.length + ' bytes=' + reqs.reduce((n, r) => n + (r.bytes || 0), 0));
    reqs.forEach((r) => console.log('  ' + (r.status || 'ERR') + ' ' + r.ms + 'ms ' + r.url.replace(cfg.restBase, '').slice(0, 110)));
    console.log('entries=' + JSON.stringify((launch.entries || []).filter((e) => e.name === 'evaluateScript' || e.name === 'firstRender')));
    await mp.disconnect();
  } catch (e) {
    try { await mp.disconnect(); } catch (e2) {}
    throw e;
  }
})().catch((e) => { console.error('FAIL', e && (e.stack || e.message)); process.exit(1); });
