const automator = require('miniprogram-automator');
(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  const sys = await mp.systemInfo();
  console.log('THEME', sys.theme, 'size', sys.screenWidth + 'x' + sys.screenHeight);
  await mp.screenshot({ path: '_theme_check.png' });
  await mp.disconnect();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
