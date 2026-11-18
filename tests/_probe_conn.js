const automator = require('miniprogram-automator');
(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  const sys = await mp.systemInfo();
  console.log('CONNECTED', JSON.stringify(sys));
  const p = await mp.currentPage();
  console.log('PAGE', p && p.path);
  const st = await mp.evaluate(() => { try { return wx.getStorageSync('zq_class_identity') || null; } catch(e) { return 'ERR'; } });
  console.log('IDENTITY', typeof st === 'string' ? st.slice(0,200) : JSON.stringify(st));
  await mp.disconnect();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
