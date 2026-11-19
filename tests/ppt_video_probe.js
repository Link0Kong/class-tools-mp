// 检查小程序端真实 deck 的视频热点/播放（automator 9422）：mp <video> 对 OSS 直链是否可播；
// 以及 wx.downloadFile 对 OSS 视频是否成功（for §11.4 降级链依据）。
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9422';
const DECK = 'dmwalrdlgevz90l';
const OSS = 'https://tool-furina-fun.oss-cn-hongkong.aliyuncs.com/ppt/a/dmwalrdlgevz90l/c0e5834805/m0.mp4';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[mp] connected');
  await mp.reLaunch('/pages/ppt/pptplay/pptplay?id=' + DECK);
  await sleep(2500);
  const page = await mp.currentPage();
  console.log('[mp] page:', page && page.path);
  const info = await mp.evaluate(() => {
    try {
      const p = getCurrentPages().slice(-1)[0];
      return { state: p.data.state, flat: (p._flat || []).length, idx: p._idx, video: p.data.video, img: String(p.data.view && p.data.view.img || '').slice(-30) };
    } catch (e) { return 'ERR:' + e.message; }
  });
  console.log('[player] info:', JSON.stringify(info));
  // jump to slide 12 (index 11) via internal _go
  const jumped = await mp.evaluate(() => {
    try {
      const p = getCurrentPages().slice(-1)[0];
      p._go(11);
      return true;
    } catch (e) { return 'ERR:' + e.message; }
  });
  await sleep(1500);
  const hot = await mp.evaluate(() => {
    try {
      const p = getCurrentPages().slice(-1)[0];
      return { idx: p._idx, hot: p.data.hot, mediaFail: p.data.mediaFail };
    } catch (e) { return 'ERR:' + e.message; }
  });
  console.log('[jump]', jumped, 'hot:', JSON.stringify(hot).slice(0, 600));
  if (hot && hot.hot && hot.hot.length) {
    const opened = await mp.evaluate(() => {
      try {
        const p = getCurrentPages().slice(-1)[0];
        p.openMedia({ currentTarget: { dataset: { i: 0 } } });
        return true;
      } catch (e) { return 'ERR:' + e.message; }
    });
    console.log('[media] opened:', opened);
    for (let i = 0; i < 12; i++) {
      await sleep(1000);
      const st = await mp.evaluate(() => {
        try {
          const p = getCurrentPages().slice(-1)[0];
          return { video: p.data.video, fail: p.data.mediaFail, toast: '' };
        } catch (e) { return { err: String(e.message) }; }
      });
      console.log('[video t+' + (i + 1) + 's]', JSON.stringify(st).slice(0, 300));
      if (!st.video) break;
    }
  }
  // wx.downloadFile probe
  const dl = await mp.evaluate(() => new Promise((resolve) => {
    try {
      wx.downloadFile({
        url: 'https://tool-furina-fun.oss-cn-hongkong.aliyuncs.com/ppt/a/dmwalrdlgevz90l/c0e5834805/m0.mp4',
        timeout: 30000,
        success: function (r) { resolve({ ok: true, status: r.statusCode, path: String(r.tempFilePath || r.filePath || '').slice(-40), size: r.totalBytesWritten || r.dataLength || 0 }); },
        fail: function (e) { resolve({ ok: false, err: String(e && e.errMsg || e) }); }
      });
    } catch (e) { resolve({ ok: false, throw: String(e && e.message) }); }
  }));
  console.log('[downloadFile]', JSON.stringify(dl));
  try { await mp.screenshot({ path: require('path').join(__dirname, '_shots_mp_video.png') }); console.log('shot ok'); } catch (e) { console.log('shot fail', e.message); }
  await mp.disconnect();
  process.exit(0);
})().catch(e => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
