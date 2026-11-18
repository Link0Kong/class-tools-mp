'use strict';
const path = require('path');
const automator = require('miniprogram-automator');
const OUT = path.join(__dirname, 'shots_new');
require('fs').mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function shot(mp, name) {
  await sleep(500);
  await mp.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('shot', name);
}
(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  await mp.evaluate(() => {
    try { require('utils/cloud.js').logout(); } catch (e) {}
    wx.clearStorageSync();
    require('utils/store.js').reset();
    require('utils/flow.js').clearFlow();
    wx.showToast = function () {};
  });

  // 体测空态
  let p = await mp.reLaunch('/pages/ft/ft');
  await p.waitFor(600);
  await shot(mp, 'ft-empty');
  // 体测实时算分
  await mp.evaluate(() => {
    const s = require('utils/store.js');
    s.get().fit = { sex: 'm', grade: '12', h: '175', w: '65', vc: '4300', r50: '7.1', sit: '17.7', jump: '248', pull: '15', durM: '3', durS: '42' };
    s.save();
  });
  p = await mp.reLaunch('/pages/ft/ft');
  await p.waitFor(900);
  let d = await p.data();
  console.log('ft total', d.res && d.res.total, 'fields', (d.fields || []).length);
  await shot(mp, 'ft-filled');

  // 我的（游客 / 登录页）
  p = await mp.reLaunch('/pages/me/me');
  await p.waitFor(700);
  await shot(mp, 'me-login');

  // 工具页（拖动把手）
  p = await mp.reLaunch('/pages/all/all');
  await p.waitFor(700);
  await shot(mp, 'all-drag');

  // 抽签名单底部弹层（长名单，验证可滚动）
  p = await mp.reLaunch('/pages/draw/draw');
  await p.waitFor(700);
  await mp.evaluate(() => {
    const s = require('utils/store.js');
    s.get().roster = Array.from({ length: 25 }, (_, i) => (i + 1) + ' 同学' + (i + 1)).join('\n');
    s.save();
    const ps = getCurrentPages(); const pg = ps[ps.length - 1];
    pg.setData({ sheet: true, rosterDraft: s.get().roster, rosterN: 25 });
  });
  await shot(mp, 'draw-roster-sheet');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
