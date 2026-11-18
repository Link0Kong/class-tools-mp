// 复现「小程序 PPT 上传失败」（UI 真实路径）：patch wx.chooseMessageFile 选本地文件 → 点上传 → 点开始上传，
// 记录 wx.request 每个请求的 URL/方法/body 大小/HTTP 状态。仅排查用；结束后请在云端软删本次测试 deck。
const automator = require('miniprogram-automator');
const WS = process.env.WS || 'ws://127.0.0.1:9422';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, timeout = 8000, step = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[mp] connected');
  await mp.reLaunch('/pages/ppt/ppt');
  await sleep(2000);
  let page = await mp.currentPage();
  console.log('[mp] page:', page && page.path);
  console.log('[page] state:', JSON.stringify(await page.data()).slice(0, 300));

  // 1) 打桩：记录请求 + 伪造「聊天选文件」+ 造本地文件
  const setup = await mp.evaluate(() => {
    try {
      globalThis.__pptReqLog = [];
      if (!globalThis.__pptReqWrapped) {
        globalThis.__pptReqWrapped = true;
        const orig = wx.request;
        wx.request = function (o) {
          const rec = { url: String((o && o.url) || ''), method: (o && o.method) || 'GET' };
          try { rec.len = JSON.stringify((o && o.data) || '').length; } catch (e) { rec.len = -1; }
          globalThis.__pptReqLog.push(rec);
          const s = o.success, f = o.fail;
          o.success = function (res) { rec.status = (res && res.statusCode) || 0; try { rec.body = JSON.stringify(res && res.data).slice(0, 200); } catch (e) { } s && s(res); };
          o.fail = function (err) { rec.fail = String((err && err.errMsg) || err).slice(0, 240); f && f(err); };
          return orig.call(wx, o);
        };
      }
      const fs = wx.getFileSystemManager();
      const path = wx.env.USER_DATA_PATH + '/repro_upload.pptx';
      const size = 1024 * 1024 + 12345;
      const buf = new ArrayBuffer(size);
      const u8 = new Uint8Array(buf);
      for (let i = 0; i < size; i++) u8[i] = 65 + (i % 20);
      fs.writeFileSync(path, buf);
      const st = fs.statSync(path);
      globalThis.__reproFile = { name: 'repro_upload.pptx', size: st.size, path: path };
      wx.chooseMessageFile = function (o) {
        setTimeout(function () {
          try { o && o.success && o.success({ tempFiles: [globalThis.__reproFile] }); } catch (e) { o && o.fail && o.fail(e); }
        }, 30);
      };
      return { ok: true, file: globalThis.__reproFile };
    } catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
  });
  console.log('[setup]', JSON.stringify(setup));

  // 2) 点「上传」→ 弹标题 → 点「开始上传」
  const upBtn = await page.$('.ppt-upbtn');
  console.log('[ui] upload btn:', !!upBtn);
  if (!upBtn) throw new Error('no .ppt-upbtn (page state?)');
  await upBtn.tap();
  const sheet = await waitFor(() => page.$('.ppt-sheet'), 6000);
  console.log('[ui] title sheet:', !!sheet);
  const go = await page.$('.ppt-sheet-btns .m3-btn--filled');
  console.log('[ui] confirm btn:', !!go);
  if (!go) throw new Error('no confirm button');
  await go.tap();
  console.log('[upload] started');

  // 3) 等上传结束（最多 120s）
  let last = '';
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    const st = await page.data();
    const up = st.up || {};
    const cur = JSON.stringify({ on: up.on, phase: up.phase, pct: up.pct, done: up.done, total: up.total, uploading: st.uploading });
    if (cur !== last) { console.log('[progress]', cur); last = cur; }
    if (!up.on) break;
  }

  // 4) 请求日志
  const log = await mp.evaluate(() => (globalThis.__pptReqLog || []).map(r => ({
    url: r.url.replace(/^https?:\/\/[^/]+/, ''), m: r.method, len: r.len, s: r.status, fail: r.fail
  })));
  const ppt = log.filter(r => /ppt_decks|ppt_upload_chunks/.test(r.url));
  console.log('[req] ppt requests:', ppt.length, '| failed:', ppt.filter(r => r.fail || r.s >= 400).length);
  for (const r of ppt.slice(0, 16)) console.log('   ', JSON.stringify(r));
  const failed = ppt.filter(r => r.fail || r.s >= 400);
  for (const r of failed.slice(0, 8)) console.log('  !!', JSON.stringify(r));
  const big = log.filter(r => r.len > 500000);
  console.log('[req] bodies>500KB:', big.length, big.slice(0, 4).map(r => ({ u: r.url, len: r.len, s: r.s, fail: r.fail })));

  // 5) 页面数据里的新 deck
  const rows = (await page.data()).rows || [];
  const mine = rows.filter(r => r.title === '自动化上传复现');
  console.log('[deck]', JSON.stringify(mine.slice(0, 2)));
  await mp.disconnect();
  process.exit(0);
})().catch(e => { console.error('FAIL', (e && e.stack) || e); process.exit(1); });
