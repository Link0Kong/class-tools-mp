// 复现 v2：instrument page methods to find who cancels the upload.
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9422';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, timeout = 8000, step = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const v = await fn(); if (v) return v; await sleep(step); }
  return null;
}
(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  await mp.reLaunch('/pages/ppt/ppt');
  await sleep(1800);
  const page = await mp.currentPage();
  console.log('[mp]', page.path, 'state=', (await page.data()).state);

  const setup = await mp.evaluate(() => {
    try {
      globalThis.__log = [];
      const L = (tag, extra) => { globalThis.__log.push({ tag: tag, extra: extra || '', stack: (new Error()).stack.split('\n').slice(2, 6).join(' | ') }); };
      globalThis.__L = L;
      // wx.request log
      if (!globalThis.__wrapped) {
        globalThis.__wrapped = true;
        const orig = wx.request;
        wx.request = function (o) {
          const rec = { url: String((o && o.url) || '').replace(/^https?:\/\/[^/]+/, ''), m: (o && o.method) || 'GET' };
          try { rec.len = JSON.stringify((o && o.data) || '').length; } catch (e) { }
          globalThis.__log.push({ tag: 'REQ', extra: rec.url, data: rec });
          const s = o.success, f = o.fail;
          o.success = function (res) { rec.s = (res && res.statusCode) || 0; s && s(res); };
          o.fail = function (err) { rec.fail = String((err && err.errMsg) || err); f && f(err); };
          return orig.call(wx, o);
        };
      }
      // file + choose patch
      const fs = wx.getFileSystemManager();
      const path = wx.env.USER_DATA_PATH + '/repro_upload2.pptx';
      const size = 1024 * 1024 + 12345;
      const buf = new ArrayBuffer(size); const u8 = new Uint8Array(buf);
      for (let i = 0; i < size; i++) u8[i] = 65 + (i % 20);
      fs.writeFileSync(path, buf);
      wx.chooseMessageFile = function (o) { setTimeout(function () { o && o.success && o.success({ tempFiles: [{ name: 'repro_upload2.pptx', size: size, path: path }] }); }, 30); };
      // instrument page instance methods (current page)
      const p = getCurrentPages().slice(-1)[0];
      globalThis.__pagePath = p && p.route;
      ['_cancelUploadSilently', 'cancelTap', '_endUpload', '_failUpload', 'onUnload', 'onHide', 'onShow', 'uploadTap', 'confirmTitle', '_startUpload'].forEach(function (name) {
        if (!p || typeof p[name] !== 'function') return;
        const orig = p[name];
        p[name] = function () {
          L('CALL:' + name, JSON.stringify([].slice.call(arguments)).slice(0, 120));
          try { return orig.apply(this, arguments); } catch (e) { L('THROW:' + name, String(e && e.message)); throw e; }
        };
      });
      return { ok: true, page: globalThis.__pagePath, hasCancelTap: !!(p && p.cancelTap), hasSilent: !!(p && p._cancelUploadSilently) };
    } catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
  });
  console.log('[setup]', JSON.stringify(setup));

  const upBtn = await page.$('.ppt-upbtn');
  if (!upBtn) throw new Error('no upload btn');
  await upBtn.tap();
  const sheet = await waitFor(() => page.$('.ppt-sheet'), 6000);
  console.log('[ui] sheet', !!sheet);
  const go = await page.$('.ppt-sheet-btns .m3-btn--filled');
  await go.tap();
  console.log('[ui] confirm tapped');
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const st = await page.data();
    const up = st.up || {};
    console.log('[t+' + (i + 1) + 's]', JSON.stringify({ on: up.on, phase: up.phase, pct: up.pct, done: up.done, total: up.total, uploading: st.uploading }));
    if (!up.on && i > 3) break;
  }
  const log = await mp.evaluate(() => globalThis.__log || []);
  console.log('[log] total entries', log.length);
  for (const e of log) {
    if (e.tag === 'REQ') { continue; }
    if (e.tag === 'CALL:_startUpload' || e.tag === 'REQ') continue;
    console.log('   ', e.tag, e.extra, e.stack ? ('\n        ' + e.stack) : '');
  }
  const reqs = log.filter(e => e.tag === 'REQ').map(e => e.data);
  console.log('[reqs]', reqs.length);
  for (const r of reqs) console.log('   ', JSON.stringify(r));
  await mp.disconnect();
  process.exit(0);
})().catch(e => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
