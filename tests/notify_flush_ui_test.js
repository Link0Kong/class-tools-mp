/* 2026-11-10 提醒链路修复 · 前端/云函数静态+参数契约单测（纯 mock，不发消息）
 * 运行：node mp-class-tools-tests/notify_flush_ui_test.js
 * 覆盖：
 *   A. utils/notify.js 新增 flushReminders：action='flush'、无 tmplIds/无 requestSubscribeMessage（不需要用户点击）
 *   B. app.js 启动预热（warmSync）调用 notify.flushReminders() 且失败静默
 *   C. 云函数：action='flush' 只处理调用者 openid、action='diag' 存在、timer 写心跳、陈旧提醒守卫
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');
const notifySrc = fs.readFileSync(path.join(ROOT, 'utils/notify.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const fnSrc = fs.readFileSync(path.join(ROOT, 'cloudfunctions/notify/index.js'), 'utf8');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'cloudfunctions/notify/config.json'), 'utf8'));

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); pass++; console.log('PASS  ' + name); }
  catch (e) { fail++; console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
}

/* ---------- utils/notify.js：flushReminders 契约 ---------- */
T('A1 notify.js 导出 flushReminders 且 action=flush', function () {
  assert.ok(/function flushReminders\(\)/.test(notifySrc), '缺 flushReminders 实现');
  assert.ok(/flushReminders: flushReminders/.test(notifySrc), '缺 flushReminders 导出');
  assert.ok(/action: 'flush'/.test(notifySrc), 'action 不是 flush');
});
T('A2 flushReminders 不触发订阅授权（无 requestSubscribeMessage / 无 tmplIds）', function () {
  const i = notifySrc.indexOf('function flushReminders');
  const seg = notifySrc.slice(i, i + 400);
  assert.ok(seg.indexOf('requestSubscribeMessage') < 0, 'flush 不应请求授权');
  assert.ok(seg.indexOf('tmplIds') < 0, 'flush 不应带 tmplIds');
  assert.ok(/call\(\{\s*action: 'flush'\s*\}\)/.test(seg), 'flush 应直接 call({action:"flush"})');
});

/* ---------- app.js：回前台/启动补发 ---------- */
T('B1 app.js require utils/notify.js', function () {
  assert.ok(/require\('\.\/utils\/notify\.js'\)/.test(appSrc), 'app.js 未 require notify');
});
T('B2 app.js warmSync 调用 flushReminders 且失败静默', function () {
  const i = appSrc.indexOf('warmSync()');
  assert.ok(i >= 0, '缺 warmSync');
  const seg = appSrc.slice(i, i + 1600);
  assert.ok(/notify\.flushReminders\(\)/.test(seg), 'warmSync 未调用 flushReminders');
  assert.ok(/catch\(function \(\) \{ \/\* 静默 \*\/ \}\)/.test(seg), 'flush 失败未静默');
});

/* ---------- 云函数：dispatch / 心跳 / 陈旧守卫 / 隐私 ---------- */
T('C1 notify 云函数 action=flush 只处理调用者 openid', function () {
  assert.ok(/event\.action === 'flush'/.test(fnSrc), '缺 flush 分支');
  assert.ok(/timer\(\{ openid: wx\.OPENID \}\)/.test(fnSrc), 'flush 未限定 openid');
  assert.ok(/if \(!wx\.OPENID\) return \{ ok: false, reason: 'no-openid' \}/.test(fnSrc), 'flush 缺 openid 守卫');
});
T('C2 notify 云函数 action=diag 存在且不返回 openid', function () {
  assert.ok(/event\.action === 'diag'/.test(fnSrc), '缺 diag 分支');
  const i = fnSrc.indexOf('async function diag');
  assert.ok(i >= 0, '缺 diag 实现');
  const end = fnSrc.indexOf('return { ok: true, diag: out };', i);
  // 只检查可执行代码：注释里出现「openid」（如脱敏说明）不是泄漏
  const seg = fnSrc.slice(i, end > 0 ? end : i + 2600)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.ok(seg.indexOf('openid') < 0, 'diag 不应出现 openid');
});
T('C3 timer 写心跳（__notify_hb）', function () {
  assert.ok(/HB_ID/.test(fnSrc), '缺 HB_ID');
  assert.ok(/writeHeartbeat\(options\.openid \? 'flush' : 'timer'\)/.test(fnSrc), 'timer 未写心跳');
});
T('C4 陈旧提醒守卫 STALE_MS=6h：跳过并标 skippedAt', function () {
  assert.ok(/const STALE_MS = 6 \* 3600 \* 1000;/.test(fnSrc), 'STALE_MS 不是 6h');
  assert.ok(/skippedAt: now/.test(fnSrc), '缺 skippedAt 标记');
  assert.ok(/lastError: 'stale:'/.test(fnSrc), '缺 stale lastError');
});
T('C5 config.json 触发器每分钟 + subscribeMessage.send 权限', function () {
  assert.strictEqual(cfg.triggers.length, 1);
  assert.strictEqual(cfg.triggers[0].config, '0 */1 * * * * *');
  assert.ok(cfg.permissions.openapi.indexOf('subscribeMessage.send') >= 0);
});
T('C6 Nodejs16 兼容：云函数不用可选链/空值合并', function () {
  assert.ok(!/\?\./.test(fnSrc), '含可选链');
  assert.ok(!/\?\?/.test(fnSrc), '含空值合并');
});
T('C7 patchCfg 不得整文档覆盖（token/lastSig 必须保留）', function () {
  const i = fnSrc.indexOf('async function patchCfg');
  assert.ok(i >= 0, '缺 patchCfg 实现');
  const end = fnSrc.indexOf('// 轻量 HTTP', i);
  const seg = fnSrc.slice(i, end > 0 ? end : i + 1800);
  assert.ok(seg.indexOf('mergeCfg') >= 0, 'patchCfg 未用 mergeCfg 合并现有配置');
  assert.ok(seg.indexOf('doc.update') >= 0, 'patchCfg 应先 update 合并字段');
  assert.ok(!/doc\.set\(\{\s*data:\s*patch\s*\}\)/.test(seg), 'patchCfg 不得 set({data:patch}) 整文档覆盖');
  assert.ok(/doc\.set\(\{\s*data:\s*merged\s*\}\)/.test(seg), '文档不存在时应 set 合并后的完整配置');
});

console.log('\n== notify flush/diag 前端+云函数契约: ' + (pass + fail) + ' 项，PASS ' + pass + '，FAIL ' + fail + ' ==');
process.exit(fail === 0 ? 0 : 1);
