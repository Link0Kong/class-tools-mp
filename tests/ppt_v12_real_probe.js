// mp v1.2 真实 deck 视频模式验证（automator 9424）：
// 打开 dmwalrdlgevz90l → 默认原样播放？直连 deck.mp4 是否起播？章节下一页/倍速/切分步？
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9424';
const DECK = 'dmwalrdlgevz90l';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const R = {};
function chk(n, c, d) { R[n] = !!c; console.log((c ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? ' | ' + JSON.stringify(d).slice(0, 260) : '')); }

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[mp] connected');
  await mp.reLaunch('/pages/pptplay/pptplay?id=' + DECK);
  await sleep(3000);
  let info = await mp.evaluate(() => {
    const p = getCurrentPages().slice(-1)[0];
    return { state: p.data.state, mode: p.data.mode, hasVideo: p.data.hasVideo, vstage: p.data.vstage, vsrc: String(p.data.vsrc || '').slice(-24), vdur: p.data.vdur, vloading: p.data.vloading, vtimeText: p.data.vtimeText, vpages: p.data.vpages, vticks: (p.data.vticks || []).length, vpage: p.data.vpage };
  });
  console.log('[init]', JSON.stringify(info));
  chk('player ready', info.state === 'ready', info.state);
  chk('default mode video (hasVideo)', info.mode === 'video', info.mode);
  chk('manifest video pages=16/ticks=16', info.vpages === 16 && info.vticks === 16, { vpages: info.vpages, vticks: info.vticks });
  chk('vsrc deck.mp4 or download temp', /deck\.mp4|tmp/.test(info.vsrc), info.vsrc);

  // wait up to 90s: direct play or download fallback
  let played = false, vstage = info.vstage, dl = null;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const st = await mp.evaluate(() => {
      const p = getCurrentPages().slice(-1)[0];
      return { mode: p.data.mode, vstage: p.data.vstage, vdur: p.data.vdur, vt: p.data.vt, vtimeText: p.data.vtimeText, vloading: p.data.vloading, vdl: p.data.vdl, vpaused: p.data.vpaused, vsrc: String(p.data.vsrc || '').slice(-24), hint: p.data.vhint };
    });
    vstage = st.vstage; dl = st.vdl;
    if (i % 5 === 0) console.log('[t+' + (i + 1) + 's]', JSON.stringify(st));
    if (st.vstage === 'step' || st.mode === 'step') { info = st; break; }
    if (st.vdur > 300 && st.vt > 2) { played = true; info = st; break; }
    if (i === 12 && st.vsrc) { /* keep waiting */ }
  }
  chk('video actually plays (vdur~303.6 & vt>2)', played && Math.abs((info.vdur || 0) - 303.6) < 3, { vdur: info.vdur, vt: info.vt, vtimeText: info.vtimeText, vstage: info.vstage });

  if (played) {
    // next chapter
    const before = await mp.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; return { page: p.data.vpage, vt: p.data.vt }; });
    await mp.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; p.onVNextPage(); });
    await sleep(1800);
    const after = await mp.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; return { page: p.data.vpage, vt: p.data.vt, text: p.data.vtimeText }; });
    console.log('[next]', JSON.stringify(before), '->', JSON.stringify(after));
    chk('next chapter moves to page2', after.page === 2, after);
    // rate
    await mp.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; p.onVRateTap(); });
    await sleep(600);
    const rate = await mp.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; return { r: p.data.vrate, t: p.data.vrateText }; });
    chk('rate cycles', rate.r !== 1, rate);
    // screenshot
    try { await mp.screenshot({ path: require('path').join(__dirname, '_shots_ppt_v12_mp_real.png') }); console.log('shot saved'); } catch (e) { console.log('shot fail', String(e.message).slice(0, 80)); }
    // switch to step mode via page method
    await mp.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; try { p.switchStep(); } catch (e) {} });
    await sleep(1200);
    const step = await mp.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; return { mode: p.data.mode, hot: (p.data.hot || []).length }; });
    chk('switch to step mode', step.mode === 'step', step);
  }
  await mp.disconnect();
  const pass = Object.values(R).filter(Boolean).length;
  console.log('=== MP VIDEO RESULT: ' + pass + '/' + Object.keys(R).length + ' PASS ===');
  process.exit(pass === Object.keys(R).length ? 0 : 1);
})().catch(e => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
