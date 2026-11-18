/* 小程序电费趋势「气泡固定显示」专项单测（2026-11-07 23:30）
 * 运行：node tip_fixed_unit.js
 * 覆盖（用户要求：气泡不放在图内，固定显示在趋势图右上角上部）：
 *  1) WXML：气泡在 .pw-trend-top（区间行右侧、绘图区 .pw-trend-body 之前），不再绑定 tipLeft/tipTop/below；
 *  2) WXSS：气泡静态布局（position:static / margin-left:auto，无 absolute/transform/下方变体），区间行 flex；
 *  3) 页面：_showCursor 只写 cursor{on,left,top,text}，不再做图内实测 clamp/防抖（无 _placeCursorTip/_cursorSeq/_cursorPos/_plotTop）；
 *  4) utils：已移除跟手定位 cursorFollowLayout（避免死代码），保留旧 cursorTipLayout/estimateCursorTipSize 纯函数。
 * 说明：不启动微信开发者工具/automator（本机未开），以静态接线断言兜底；页面运行时行为见 v3_power_diag_tests.js。
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..');
const MP = path.join(ROOT, 'mp-class-tools');
const results = [];

function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log('PASS  ' + name); }
  catch (e) { results.push({ name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
}

function src(rel) { return fs.readFileSync(path.join(MP, rel), 'utf8'); }

function run(outerTest) {
  const T = (typeof outerTest === 'function') ? outerTest : test;

  T('WXML：气泡固定在 .pw-trend-top，位于绘图区 .pw-trend-body 之前（不浮在图内）', function () {
    const wxml = src('pages/power/power.wxml');
    assert.ok(/<view class="pw-trend-top">/.test(wxml), '存在 .pw-trend-top 区间行');
    const tipIdx = wxml.indexOf('pw-cursor-tip');
    const bodyIdx = wxml.indexOf('class="pw-trend-body"');
    const trendTopIdx = wxml.indexOf('class="pw-trend-top"');
    assert.ok(tipIdx > trendTopIdx && bodyIdx > 0 && tipIdx < bodyIdx, '气泡在区间行内、绘图区之前');
    assert.ok(/class="pw-cursor-tip"[^>]*>\{\{cursor\.text\}\}</.test(wxml), '气泡只显示文字（无定位 style 绑定）');
    assert.ok(!/cursor\.tipLeft|cursor\.tipTop|cursor\.below/.test(wxml), 'WXML 不再绑定 tipLeft/tipTop/below');
  });

  T('WXSS：气泡静态布局 + 区间行 flex；无 absolute/transform/下方变体', function () {
    const wxss = src('pages/power/power.wxss');
    assert.ok(/\.pw-trend-top \{[^}]*display: flex;/.test(wxss), '.pw-trend-top flex');
    const tip = wxss.match(/\.pw-cursor-tip \{[\s\S]*?\n\}/);
    assert.ok(tip, '存在 .pw-cursor-tip 规则');
    assert.ok(/position: static;/.test(tip[0]), 'position: static（不绝对定位）');
    assert.ok(/margin-left: auto;/.test(tip[0]), '右侧对齐（margin-left:auto）');
    assert.ok(/background: #25332F;/.test(tip[0]) && /color: #FFFFFF;/.test(tip[0]), '深色气泡白字（沿用原样式）');
    assert.ok(!/position: absolute;/.test(tip[0]) && !/transform:/.test(tip[0]), '气泡无 absolute/位移 transform');
    assert.ok(!/\.pw-cursor-tip--below/.test(wxss), '无「翻到下方」变体');
  });

  T('页面：_showCursor 只写 on/left/top/text；无图内测量/防抖/指针坐标逻辑', function () {
    const js = src('pages/power/power.js');
    const m = js.match(/_showCursor\(frac\) \{[\s\S]*?\n  \},/);
    assert.ok(m, '存在 _showCursor(frac)');
    assert.ok(/cursor: \{ on: true, left: x, top: y, text: text \}/.test(m[0]), 'setData 只写 on/left/top/text');
    assert.ok(!/_placeCursorTip/.test(js), '无图内实测 _placeCursorTip');
    assert.ok(!/_cursorSeq/.test(js), '无气泡测量防抖 _cursorSeq');
    assert.ok(!/_cursorPos\(/.test(js), '无指针坐标换算 _cursorPos');
    assert.ok(!/_plotTop/.test(js), '无绘图区 top 换算状态');
    assert.ok(!/estimateCursorTipSize|cursorTipLayout\(/.test(js), '页面不再使用图内气泡定位纯函数');
    const off = js.match(/function cursorOff\(\) \{[\s\S]*?\n\}/);
    assert.ok(off && /on: false, left: 0, top: 0, text: ''/.test(off[0]), 'cursorOff 只含 on/left/top/text');
  });

  T('utils：移除跟手定位 cursorFollowLayout（避免死代码）；旧纯函数保留不影响', function () {
    const js = src('utils/power.js');
    assert.ok(!/cursorFollowLayout/.test(js), '不存在 cursorFollowLayout');
    assert.ok(/function cursorTipLayout/.test(js) && /function estimateCursorTipSize/.test(js), '旧纯函数仍在（历史单测覆盖）');
  });

  T('回归接线：绘图区仍绑定点击/拖动/松手，游标线/圆点保留', function () {
    const wxml = src('pages/power/power.wxml');
    assert.ok(/catchtouchstart="onTrendTouch"[^>]*catchtouchmove="onTrendTouchMove"[^>]*catchtouchend="onTrendTouchEnd"/.test(wxml), '触摸三段事件绑定');
    assert.ok(/class="pw-cursor"/.test(wxml) && /pw-cursor-line/.test(wxml) && /pw-cursor-dot/.test(wxml), '竖线/圆点');
  });
}

module.exports = { run: run };

if (require.main === module) {
  run();
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log('\n================ ' + pass + ' passed, ' + fail + ' failed ================');
  process.exitCode = fail ? 2 : 0;
}
