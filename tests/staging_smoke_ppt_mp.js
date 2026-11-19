/* staging_smoke_ppt_mp.js —— P3 PPT 在线媒体 ECS /pptfiles 映射 staging 冒烟（devtools + 测试账号；仅 staging）
 *
 * 前置（脚本会校验）：
 *   1) 微信开发者工具用「staging + pptEcs.base=http IP」配置重新打开（见 deploy/migration/CLIENTS.md §3b/§4.1）：
 *        cli.bat close --project <mp>
 *        utils/cloud-config.js: ACTIVE_REST_PROFILE='staging'; pptEcs.base='http://121.196.47.2/pptfiles'
 *        cli.bat auto --project <mp> --auto-port 9420 --trust-project
 *   2) staging 就绪（class_verify 200）；staging 有 ready deck（P1 已导入真实 deck dmwalrdlgevz90l）。
 * 运行：node staging_smoke_ppt_mp.js
 *
 * 做法：真实登录（测试账号）→ 直接打开 pages/pptplay?id=<deckId> → 读页面数据：
 *   imgA/thumbs[].url 必须为 http://121.196.47.2/pptfiles/ppt/...（分步图走 ECS 缓存），
 *   内部 _v.url（原样播放视频）同样映射；imgErr=false 说明图片确实加载成功。
 * 红线：仅 staging + ECS IP；仅测试账号；只读；不打印 token/姓名；结束清 storage。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const automator = require('miniprogram-automator');

const MP_ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');
const CFG = path.join(MP_ROOT, 'utils/cloud-config.js');
const STAGING = 'http://121.196.47.2/v1/rdb/rest-next/';
const ECS_PPT = 'http://121.196.47.2/pptfiles';
const DECK = 'dmwalrdlgevz90l';
const SID = '3260799999';
const NAME = '测试账号';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
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
  const report = { at: new Date().toISOString(), endpoint: STAGING, ecs: ECS_PPT, deck: DECK, steps: [], checks: [], errors: [], exceptions: [], ok: false };
  let mp = null;
  try {
    // 0) 安全前置：配置 + staging 就绪
    const cfgSrc = fs.readFileSync(CFG, 'utf8');
    const m = cfgSrc.match(/const ACTIVE_REST_PROFILE = '([a-z]+)';/);
    if (!m || m[1] !== 'staging') throw new Error('拒绝运行：ACTIVE_REST_PROFILE=' + (m && m[1]));
    if (cfgSrc.indexOf("base: 'http://121.196.47.2/pptfiles'") < 0) throw new Error('拒绝运行：pptEcs.base 未设为 ' + ECS_PPT);
    const pre = await httpJson('POST', STAGING + 'rpc/class_verify', { p_sid: SID, p_name: NAME });
    if (pre.status !== 200) throw new Error('staging 未就绪：class_verify HTTP ' + pre.status);
    report.preflight = { staging: pre.status };

    mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
    mp.on('exception', (e) => report.exceptions.push(String(e)));

    // 1) 清 storage + 真实登录（测试账号）
    await mp.evaluate(function () { wx.clearStorageSync(); return true; });
    await mp.reLaunch('/pages/identity/identity');
    await waitFor(async () => {
      const r = await mp.evaluate(function () { const p = getCurrentPages(); const c = p[p.length - 1]; return c && c.route; });
      return String(r || '').indexOf('identity') >= 0;
    }, 10000, 'identity page');
    const tLogin = Date.now();
    await mp.evaluate(function (sid, name) {
      const p = getCurrentPages().slice(-1)[0];
      p.setData({ sid, name });
      p.submit();
      return true;
    }, SID, NAME);
    await waitFor(async () => {
      const r = await mp.evaluate(function () { const p = getCurrentPages(); const c = p[p.length - 1]; return c && c.route; });
      return String(r || '').indexOf('pages/index/index') >= 0;
    }, 25000, 'login -> index');
    report.loginMs = Date.now() - tLogin;
    report.steps.push({ step: 'login', ok: true, ms: report.loginMs });

    // 2) PPT 列表页：封面 cover_url 也应映射到 ECS /pptfiles（2026-11-18 P4）
    await mp.navigateTo('/pages/ppt/ppt');
    await sleep(4000);
    const listView = await mp.evaluate(function () {
      const p = getCurrentPages().slice(-1)[0];
      const d = (p && p.data) || {};
      const rows = d.rows || [];
      const hit = rows.filter(function (r) { return r && r.id === 'dmwalrdlgevz90l'; })[0] || rows[0] || {};
      return { route: p && p.route, count: rows.length, cover: hit.cover || '', hasCover: !!hit.hasCover, state: d.state };
    });
    report.steps.push({ step: 'list', route: listView.route, count: listView.count, cover: listView.cover, hasCover: listView.hasCover, state: listView.state });

    // 3) 打开 PPT 播放器（真实 deck；manifest + 媒体 + 首帧封面均走 staging/ECS）
    await mp.navigateTo('/pages/ppt/pptplay/pptplay?id=' + encodeURIComponent(DECK));
    await sleep(4500); // manifest 拉取 + 首图/缩略图加载
    const view = await mp.evaluate(function () {
      const p = getCurrentPages().slice(-1)[0];
      const d = (p && p.data) || {};
      return {
        route: p && p.route,
        state: d.state,
        mode: d.mode,
        hasVideo: d.hasVideo,
        imgA: d.imgA || '',
        imgB: d.imgB || '',
        imgErr: !!d.imgErr,
        vposter: d.vposter || '',
        thumbs: (d.thumbs || []).slice(0, 3).map(function (t) { return t.url || ''; }),
        videoUrl: (p && p._v && p._v.url) || '',
        cover: (p && p._deck && p._deck.cover_url) || ''
      };
    });
    report.steps.push({ step: 'player', route: view.route, state: view.state, mode: view.mode, hasVideo: view.hasVideo, imgA: view.imgA, videoUrl: view.videoUrl, thumbs: view.thumbs, imgErr: view.imgErr, vposter: view.vposter });

    const ECS_PPT_PREFIX = ECS_PPT + '/ppt/';
    const checks = [
      ['list-opened', String(listView.route || '').indexOf('pages/ppt/ppt') >= 0 && listView.count > 0],
      ['list-cover-via-pptfiles', listView.hasCover && listView.cover.indexOf(ECS_PPT_PREFIX) === 0],
      ['player-opened', String(view.route || '').indexOf('pptplay') >= 0],
      ['manifest-ready', view.state !== 'loading' && view.state !== 'error'],
      ['step-img-via-pptfiles', view.imgA.indexOf(ECS_PPT_PREFIX) === 0],
      ['thumb-via-pptfiles', view.thumbs.length > 0 && view.thumbs[0].indexOf(ECS_PPT_PREFIX) === 0],
      ['video-via-pptfiles', view.videoUrl.indexOf(ECS_PPT_PREFIX) === 0],
      ['player-cover-via-pptfiles', view.vposter.indexOf(ECS_PPT_PREFIX) === 0],
      ['img-loaded(no-err)', view.imgErr === false]
    ];
    report.checks = checks.map(function (c) { return { name: c[0], ok: !!c[1] }; });
    report.ok = checks.every(function (c) { return !!c[1]; });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 2;
    fs.writeFileSync(path.join(__dirname, 'staging_smoke_ppt_result.json'), JSON.stringify(report, null, 2), 'utf8');
  } catch (e) {
    report.errors.push(String((e && e.message) || e));
    try { fs.writeFileSync(path.join(__dirname, 'staging_smoke_ppt_result.json'), JSON.stringify(report, null, 2), 'utf8'); } catch (e2) { /* ignore */ }
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    try { if (mp) await mp.evaluate(function () { wx.clearStorageSync(); return true; }); } catch (e) { /* ignore */ }
    try { if (mp) await mp.disconnect(); } catch (e) { /* ignore */ }
  }
})().catch((e) => { console.error('SMOKE FATAL', e); process.exit(1); });
