/* interval_unit.js —— 鸿蒙间隔参数落地检查（2026-11-19）
 *
 * 规范：屏幕边缘 16vp（手机）/24vp（折叠）/32vp（平板）；卡片间 12vp；
 * 元素间大 16vp / 普通 8vp；主次文本纵 2vp / 横 8vp。
 * 微信 rpx 与 vp 按 750 设计宽换算：1vp = 2rpx。
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const MP = path.resolve(HERE, '..');
const results = [];

function src(rel) { return fs.readFileSync(path.join(MP, rel), 'utf8'); }

function has(rs, re, msg) { assert.ok(re.test(rs), msg); }

async function run(outerTest) {
  const T = (typeof outerTest === 'function') ? outerTest : async function (n, fn) {
    try { await fn(); results.push({ name: n, ok: true }); console.log('PASS  ' + n); }
    catch (e) { results.push({ name: n, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + n + '  ::  ' + ((e && e.message) || e)); }
  };
  const app = src('app.wxss');
  const power = src('pages/power/power.wxss');
  const powerjs = src('pages/power/power.js');

  await T('间隔 A1：手机/折叠/平板屏幕边距 = 16/24/32vp（32/48/64rpx）', async function () {
    has(app, /--md-page-pad:\s*32rpx/, '手机 page-pad 32rpx');
    has(app, /@media\s*\(min-width:\s*600px\)[\s\S]*?--md-page-pad:\s*48rpx/, '折叠 48rpx');
    has(app, /@media\s*\(min-width:\s*900px\)[\s\S]*?--md-page-pad:\s*64rpx/, '平板 64rpx');
  });

  await T('间隔 A2：卡片间 12vp=24rpx（全局卡片/列表卡）', async function () {
    has(app, /--md-gap-card:\s*24rpx/, 'token 24rpx');
    has(app, /\.m3-card\s*\{[\s\S]*?margin-bottom:\s*var\(--md-gap-card\)/, '.m3-card 使用 gap-card');
    has(app, /\.m3-li--card\s*\{[^}]*margin-bottom:\s*var\(--md-gap-card\)/, '.m3-li--card 使用 gap-card');
  });

  await T('间隔 A3：元素间 16/8vp、文本纵 2vp/横 8vp token', async function () {
    has(app, /--md-gap-elem-lg:\s*32rpx/, '大间隔 32rpx');
    has(app, /--md-gap-elem:\s*16rpx/, '普通 16rpx');
    has(app, /--md-gap-text:\s*4rpx/, '文本纵 4rpx');
    has(app, /--md-gap-text-h:\s*16rpx/, '文本横 16rpx');
    has(app, /\.m3-card__head\s*\{[^}]*margin-bottom:\s*var\(--md-gap-elem\)/, '卡头 16rpx');
    has(app, /\.m3-li__sub\s*\{[^}]*margin-top:\s*var\(--md-gap-text\)/, '主次文本 4rpx');
  });

  await T('间隔 A4：电费页卡片/图表/文本按 12/16/2/8 收敛', async function () {
    has(power, /\.pw-pick\s*\{[^}]*margin-bottom:\s*var\(--md-gap-card\)/, '选房卡 24rpx');
    has(power, /\.pw-dash\s*\{[^}]*padding:\s*32rpx;[\s\S]*?margin-bottom:\s*var\(--md-gap-card\)/, '仪表卡 32rpx 内边距 + 24rpx 卡距');
    has(power, /\.pw-card\s*\{[^}]*margin-bottom:\s*var\(--md-gap-card\);[\s\S]*?padding:\s*32rpx/, '趋势卡 32rpx 内边距 + 24rpx 卡距');
    has(power, /\.pw-guide-s\s*\{[^}]*margin-top:\s*4rpx/, '引导副文本 4rpx');
    has(power, /\.pw-trend\s*\{[^}]*margin-top:\s*16rpx/, '图表 16rpx');
  });

  await T('间隔 A5：电费下拉刷新回弹后再量宽/重绘（避免曲线漂移）', async function () {
    has(powerjs, /_finishPullDown\(\)[\s\S]*?setTimeout\([\s\S]*?this\._cwMeasured = false;[\s\S]*?this\._renderWhenReady\(\)/, '下拉结束后重新量宽重绘');
    has(powerjs, /this\.load\(true\)\.then\(\(\) => this\._finishPullDown\(\)\)/, '下拉 load 完成后走统一收尾');
  });

  return results;
}

module.exports = { run: run };
if (require.main === module) {
  run().then(function (rs) {
    const bad = rs.filter(function (r) { return !r.ok; }).length;
    console.log('\n' + (rs.length - bad) + ' passed, ' + bad + ' failed');
    process.exit(bad ? 1 : 0);
  });
}
