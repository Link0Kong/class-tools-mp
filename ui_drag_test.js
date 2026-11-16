'use strict';
const automator = require('miniprogram-automator');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  const p = await mp.reLaunch('/pages/all/all');
  await p.waitFor(800);
  const before = await mp.evaluate(() => require('utils/tools.js').homeTools());
  console.log('before', before);
  await mp.evaluate(() => {
    const ps = getCurrentPages(); const pg = ps[ps.length - 1];
    pg.onDragStart({ currentTarget: { dataset: { key: 'ft' } }, touches: [{ clientY: 600 }] });
  });
  await sleep(300);
  await mp.evaluate(() => {
    const ps = getCurrentPages(); const pg = ps[ps.length - 1];
    pg.onDragMove({ touches: [{ clientY: 800 }] });
  });
  await sleep(200);
  await mp.evaluate(() => {
    const ps = getCurrentPages(); const pg = ps[ps.length - 1];
    pg.onDragEnd();
  });
  await sleep(500);
  const after = await mp.evaluate(() => require('utils/tools.js').homeTools());
  console.log('after ', after);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
