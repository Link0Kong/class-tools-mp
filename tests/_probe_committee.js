const automator = require('miniprogram-automator');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (p, tag) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT ' + tag)), 6000))]);
(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9424' });
  const p = await T(mp.currentPage(), 'currentPage');
  console.log('page:', p && p.route);
  const el = await T(p.$('.rd-swipe'), 'select');
  console.log('el:', !!el);
  const t0 = Date.now();
  for (const ev of ['touchstart', 'touchmove', 'touchend']) {
    try {
      await T(el.dispatchEvent({
        eventName: ev,
        touches: ev === 'touchend' ? [] : [{ identifier: 0, clientX: 200, clientY: 300, pageX: 200, pageY: 300 }],
        changedTouches: [{ identifier: 0, clientX: 160, clientY: 300, pageX: 160, pageY: 300 }]
      }), ev);
      console.log(ev, 'ok', Date.now() - t0, 'ms');
    } catch (e) { console.log(ev, 'ERR', e.message); break; }
  }
  const sty = await T(mp.evaluate(() => { const g = getCurrentPages(); const pg = g[g.length - 1]; return pg && pg.data ? pg.data.swipeStyle : 'no-page'; }), 'eval');
  console.log('swipeStyle:', sty);
  await mp.disconnect().catch(() => {});
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
