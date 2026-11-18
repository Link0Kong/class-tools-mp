// Screenshot the tools/all page in devtools to verify the new PPT icon rendering.
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9422';
const path = require('path');
(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  await mp.reLaunch('/pages/all/all');
  await new Promise(r => setTimeout(r, 2500));
  const page = await mp.currentPage();
  console.log('page:', page && page.path);
  const out = path.join(__dirname, '_shots_ppt_icon.png');
  try {
    await mp.screenshot({ path: out });
    console.log('screenshot:', out);
  } catch (e) {
    console.log('screenshot api failed:', e && e.message);
  }
  // also dump catalog entries with icoImg to confirm path
  const info = await mp.evaluate(() => {
    try {
      const tools = require('./utils/tools.js');
      const list = tools.catalog().filter(t => t.key === 'ppt');
      return list.map(t => ({ key: t.key, name: t.name, icoImg: t.icoImg }));
    } catch (e) { return 'ERR:' + e.message; }
  });
  console.log('catalog ppt:', JSON.stringify(info));
  await mp.disconnect();
  process.exit(0);
})().catch(e => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
