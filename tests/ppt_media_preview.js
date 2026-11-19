// ppt_media_preview.js —— PPT v2.3 §12.8 小程序「视频单独下载」分组 automator 实测（2026-11-11）
//
// 运行（开发者工具已开、自动化端口 9424）：
//   node ppt_media_preview.js
// 环境变量：WS=ws://127.0.0.1:9424（默认）
//
// 覆盖（能测尽测；不写云端）：
//   1. 无 media_files 的 deck：下载详情**不显示**「视频单独下载」分组（向后兼容）；
//   2. 用 wx.request 内存包装器注入 §12.8 media_files（视频 第7页 150.92s 1024×576 / 音频 第12页 225.582s），
//      断言分组渲染：视频1 · 第 7 页 / 音频1 · 第 12 页 + 时长/分辨率/大小 + 下载/转发/复制链接按钮；
//   3. 下载链（mock wx.downloadFile，避免大文件）：进度 UI → 视频 `wx.saveVideoToPhotosAlbum`（保存到相册）；
//      相册授权失败 → `showModal` 引导 → `wx.openSetting`；视频「转发到聊天/电脑」→ `wx.shareFileMessage(fileName)`;
//      音频下载 → `wx.openDocument`；媒体行「复制链接」→ 剪贴板 URL；
//   4. 原有三行下载（兼容版/PDF/原始文件）仍渲染；截图 4 张到 `_shots_ppt_media/`；0 console error。
'use strict';
const fs = require('fs');
const path = require('path');
const automator = require('miniprogram-automator');

const WS = process.env.WS || 'ws://127.0.0.1:9424';
const SHOTS = path.join(__dirname, '_shots_ppt_media');
const DECK = 'dmwalrdlgevz90l';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let passN = 0, failN = 0;
function ok(name, cond, extra) {
  if (cond) { passN += 1; results.push({ name: name, ok: true }); console.log('PASS  ' + name + (extra ? ('  [' + extra + ']') : '')); }
  else { failN += 1; results.push({ name: name, ok: false, extra: extra }); console.log('FAIL  ' + name + (extra ? ('  :: ' + extra) : '')); }
}
function shotName(n) { return path.join(SHOTS, n); }
async function shot(mp, name) {
  try { await mp.screenshot({ path: shotName(name) }); return true; }
  catch (e) { console.log('[warn] screenshot ' + name + ' :: ' + (e && (e.message || e))); return false; }
}
async function dataOf(page) {
  if (!page) return {};
  try { return await page.data(); } catch (e) { console.log('[warn] page.data timeout'); return {}; }
}
async function safe(fn, fallback) {
  try { return await fn(); }
  catch (e) { console.log('[warn] automator call :: ' + (e && (e.message || e))); return fallback; }
}
async function reLaunch(mp, url) { await safe(function () { return mp.reLaunch(url); }); await sleep(1800); }
async function navTo(mp, url) { return safe(function () { return mp.navigateTo(url); }, null); }
async function curPage(mp) { return safe(function () { return mp.currentPage(); }, null); }
async function el(page, sel) { if (!page) return null; return safe(function () { return page.$(sel); }, null); }
async function els(page, sel) { if (!page) return []; return safe(function () { return page.$$(sel); }, []); }
async function tap(element) { if (!element) return false; return safe(function () { return element.tap(); }, false); }
async function waitFor(fn, timeout, step) {
  const t0 = Date.now();
  const lim = timeout || 10000;
  const st = step || 250;
  while (Date.now() - t0 < lim) {
    const v = await fn();
    if (v) return v;
    await sleep(st);
  }
  return null;
}
(async function () {
  fs.mkdirSync(SHOTS, { recursive: true });
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[automator] connected', WS);
  const caps = await mp.evaluate(function () {
    return {
      downloadFile: typeof wx.downloadFile,
      openDocument: typeof wx.openDocument,
      saveVideoToPhotosAlbum: typeof wx.saveVideoToPhotosAlbum,
      shareFileMessage: typeof wx.shareFileMessage,
      setClipboardData: typeof wx.setClipboardData,
      sdk: (wx.getAppBaseInfo ? wx.getAppBaseInfo().SDKVersion : '')
    };
  });
  console.log('[caps]', JSON.stringify(caps));
  const consoleErrors = [];
  try { mp.on('console', function (msg) { if (msg && (msg.type === 'error' || msg.level === 'error')) consoleErrors.push(String(msg.args || msg.text || '')); }); } catch (e) { /* ignore */ }
  const origEval = mp.evaluate.bind(mp);
  mp.evaluate = async function () {
    try { return await origEval.apply(null, arguments); }
    catch (e) { console.log('[warn] evaluate timeout'); return null; }
  };
  const hardTimer = setTimeout(function () { console.error('[FATAL] 总超时 10 分钟'); process.exit(2); }, 10 * 60 * 1000);
  try {
    /* 清掉上一轮可能残留的系统弹窗 */
    await safe(function () {
      return mp.evaluate(function () {
        try { if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload(); } catch (e) { /* ignore */ }
        try { wx.reLaunch({ url: '/pages/ppt/ppt' }); } catch (e) { /* ignore */ }
        return true;
      });
    });
    await sleep(2500);

    /* ---------- 0. 安装 manifest 包装器 + 媒体下载 mock（全部内存，不写云） ---------- */
    const setup = await mp.evaluate(function (DECK_ID) {
      const g = getApp();
      try {
        // 上次运行残留先还原
        if (g.__mediaWrapped && g.__mOrig) {
          try { wx.request = g.__mOrig.req; } catch (e) { /* ignore */ }
          delete g.__mediaWrapped;
        }
        g.__dlMode = 'real';
        g.__mOrig = { req: wx.request };
        const base = 'https://tool-furina-fun.oss-cn-hongkong.aliyuncs.com/ppt/a/' + DECK_ID + '/c0e5834805/';
        const fakeFiles = {
          compat: { s: 'compat.pptx', size: 33554432, sha256: 'aaaa', ext: 'pptx', name: '本草孝心_兼容版.pptx' },
          pdf: { s: 'preview.pdf', size: 2345678, sha256: 'bbbb', pages: 16, name: '本草孝心.pdf' },
          source: { s: 'original.pptx', size: 34567000, sha256: 'cccc', ext: 'pptx', name: '本草孝心_原始文件.pptx' }
        };
        const fakeCompat = { warnings: [], fonts_embedded: 2, converted_from: 'ppt' };
        const fakeMedia = [
          {
            s: 'media/本草孝心_视频1_第7页.mp4', name: '本草孝心_视频1_第7页.mp4', size: 20158796, sha256: 'dd44',
            kind: 'video', dur: 150.92, w: 1024, h: 576, slides: [7], src: 'media1.mp4'
          },
          {
            s: 'media/本草孝心_音频1_第12页.m4a', name: '本草孝心_音频1_第12页.m4a', size: 1200000, sha256: 'ee55',
            kind: 'audio', dur: 225.582, slides: [12], src: 'media2.m4a'
          }
        ];
        g.__fakeBase = base;
        wx.request = function (o) {
          const s = o && o.success;
          if (s) {
            o.success = function (res) {
              try {
                const u = String((o && o.url) || '');
                const mode = g.__dlMode || 'real';
                if (res && res.statusCode === 200 && Array.isArray(res.data) && mode !== 'real') {
                  const isDetail = u.indexOf('select=manifest') >= 0 && u.indexOf('id=eq.' + encodeURIComponent(DECK_ID)) >= 0;
                  if (isDetail && res.data[0] && res.data[0].manifest) {
                    const man = res.data[0].manifest;
                    if (mode === 'media') {
                      man.files = fakeFiles;
                      man.compat = fakeCompat;
                      man.media_files = fakeMedia;
                      man.v = 2;
                    } else if (mode === 'legacy') {
                      delete man.files;
                      delete man.compat;
                      delete man.media_files;
                    }
                  }
                }
              } catch (e) { /* ignore */ }
              s(res);
            };
          }
          return g.__mOrig.req.call(wx, o);
        };
        g.__mediaWrapped = true;

        // 媒体下载 / 保存 / 打开 / 转发 / 弹窗 mock（下载≤1s，避免真下大文件）
        g.__dlLog = []; g.__openLog = []; g.__shareLog = []; g.__saveLog = []; g.__modalLog = []; g.__settingCount = 0;
        g.__mockDelay = 700; g.__saveMode = 'ok';
        g.__origMp = {
          dl: wx.downloadFile, open: wx.openDocument, save: wx.saveVideoToPhotosAlbum,
          share: wx.shareFileMessage, modal: wx.showModal, setting: wx.openSetting
        };
        wx.downloadFile = function (o) {
          const rec = { url: String((o && o.url) || ''), aborted: false };
          g.__dlLog.push(rec);
          const task = {
            abort: function () { rec.aborted = true; },
            onProgressUpdate: function (cb) { rec.cb = cb; }
          };
          setTimeout(function () { if (rec.cb && !rec.aborted) rec.cb({ progress: 42, totalBytesWritten: 42, totalBytesExpectedToWrite: 100 }); }, 120);
          setTimeout(function () {
            if (rec.aborted) return;
            rec.ok = true;
            const ext = /\.m4a$/i.test(rec.url) ? 'm4a' : 'mp4';
            if (o && o.success) o.success({ statusCode: 200, tempFilePath: 'wxfile://mock-media-' + g.__dlLog.length + '.' + ext });
          }, g.__mockDelay || 700);
          return task;
        };
        wx.openDocument = function (o) { g.__openLog.push({ filePath: o && o.filePath }); if (o && o.success) o.success(); };
        wx.saveVideoToPhotosAlbum = function (o) {
          g.__saveLog.push({ filePath: o && o.filePath });
          if (g.__saveMode === 'authfail') { if (o && o.fail) o.fail({ errMsg: 'saveVideoToPhotosAlbum:fail auth deny' }); return; }
          if (o && o.success) o.success();
        };
        wx.shareFileMessage = function (o) {
          g.__shareLog.push({ filePath: o && o.filePath, fileName: o && o.fileName });
          if (o && o.success) o.success();
        };
        wx.showModal = function (o) {
          g.__modalLog.push(o && o.title);
          if (o && o.success) o.success({ confirm: true, cancel: false });
        };
        wx.openSetting = function () { g.__settingCount += 1; };
        return { ok: true };
      } catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
    }, DECK);
    ok('安装 manifest.media_files 内存包装器 + 媒体下载 mock（不写云端）', !!(setup && setup.ok), JSON.stringify(setup));
    async function setMode(mode) { await mp.evaluate(function (m) { getApp().__dlMode = m; return true; }, mode); }
    async function openDetail() {
      await reLaunch(mp, '/pages/ppt/ppt');
      const list = await curPage(mp);
      const ld = await waitFor(async function () { const x = await dataOf(list); return x.state === 'ready' ? x : null; }, 15000);
      const rows = (ld && ld.rows) || [];
      const idx = rows.map(function (r) { return r.id; }).indexOf(DECK);
      const cards = await els(list, '.ppt-card');
      await tap(cards[idx >= 0 ? idx : 0]);
      await sleep(2200);
      let page = await curPage(mp);
      if (!page || String(page.path || '').indexOf('pptdl') < 0) {
        page = await navTo(mp, '/pages/ppt/pptdl/pptdl?id=' + encodeURIComponent(DECK));
        await sleep(1500);
      }
      const d = await waitFor(async function () { const x = await dataOf(page); return x.state === 'ready' ? x : null; }, 15000);
      return { page: page, d: d };
    }

    /* ---------- 1. 无 media_files（真实 deck 或强制 legacy）：分组不显示 ---------- */
    let R = await openDetail();
    ok('真实 deck 下载详情加载（state=ready）', !!R.d, R.d ? ('hasMedia=' + (R.d.d && R.d.d.hasMedia) + ' legacy=' + (R.d.d && R.d.d.legacy)) : 'timeout');
    let realHasMedia = !!(R.d && R.d.d && R.d.d.hasMedia);
    console.log('[real] hasMedia=', realHasMedia, 'rows=', ((R.d && R.d.d && R.d.d.rows) || []).length);
    if (realHasMedia) {
      await setMode('legacy');
      R = await openDetail();
      realHasMedia = false;
    }
    const mediaElHidden = await el(R.page, '.dl-media');
    ok('无 media_files：不显示「视频单独下载」分组（向后兼容）', !mediaElHidden && !(R.d && R.d.d && R.d.d.hasMedia),
      'hasMedia=' + (R.d && R.d.d && R.d.d.hasMedia) + ' el=' + !!mediaElHidden);
    await shot(mp, '01-detail-no-media.png');

    /* ---------- 2. 注入 media_files：分组渲染 ---------- */
    await setMode('media');
    R = await openDetail();
    const V = R.d && R.d.d;
    ok('§12.8 分组渲染：hasMedia/mediaCount=2', !!(V && V.hasMedia && V.mediaCount === 2 && V.mediaRows && V.mediaRows.length === 2),
      V ? ('count=' + V.mediaCount) : 'no-detail');
    ok('媒体行文案：视频1 · 第 7 页 / 音频1 · 第 12 页', !!(V && V.mediaRows[0].label === '视频1 · 第 7 页' && V.mediaRows[1].label === '音频1 · 第 12 页'),
      V ? JSON.stringify((V.mediaRows || []).map(function (x) { return x.label; })) : 'no-detail');
    ok('媒体行信息：时长/分辨率 + 大小 + 文件名', !!(V &&
      /2:31/.test(String(V.mediaRows[0].specText)) && /1024×576/.test(String(V.mediaRows[0].specText)) && V.mediaRows[0].sizeText === '19.2MB' &&
      /本草孝心_视频1_第7页\.mp4/.test(String(V.mediaRows[0].name)) &&
      V.mediaRows[1].isAudio === true && /3:46/.test(String(V.mediaRows[1].specText))),
      V ? (V.mediaRows[0].specText + ' / ' + V.mediaRows[0].sizeText) : 'no-detail');
    ok('原有三行下载仍保留（兼容版/PDF/原始文件）', !!(V && V.rows && V.rows.length === 3), V ? ('rows=' + V.rows.length) : 'no-detail');
    const mediaGroup = await el(R.page, '.dl-media');
    ok('WXML 分组元素存在（.dl-media）', !!mediaGroup);
    await shot(mp, '02-media-group.png');

    /* ---------- 3. 视频下载 → 保存到相册；转发；音频 → openDocument；授权失败引导；复制链接 ---------- */
    const dlBtns = await els(R.page, '.dl-media .dl-btn--filled');
    ok('媒体行下载按钮存在（2 个）', dlBtns.length === 2, 'btns=' + dlBtns.length);
    // 视频下载（第 1 个按钮）
    await tap(dlBtns[0]);
    const progress = await waitFor(async function () {
      const x = await dataOf(R.page);
      return (x.dl && x.dl.pct === 42) ? x.dl : null;
    }, 3000, 100);
    ok('视频下载：进度 UI（下载 42%）', !!progress, progress ? progress.text : 'no-progress');
    await shot(mp, '03-media-download-progress.png');
    const saveLog = await waitFor(async function () {
      const v = await mp.evaluate(function () { return getApp().__saveLog; });
      return v && v.length ? v : null;
    }, 5000, 150);
    ok('视频下载完成 → wx.saveVideoToPhotosAlbum（保存到相册）', !!(saveLog && saveLog.length && /mock-media-1\.mp4$/.test(String(saveLog[0].filePath))),
      saveLog ? String(saveLog[0].filePath) : 'no-save');
    // 视频转发（已缓存临时文件 → 直接 shareFileMessage；媒体 subbtn 顺序：视频转发/视频复制/音频转发/音频复制）
    const subs = await els(R.page, '.dl-media .dl-subbtn');
    await tap(subs[0]);
    const shareLog = await waitFor(async function () {
      const v = await mp.evaluate(function () { return getApp().__shareLog; });
      return v && v.length ? v : null;
    }, 4000, 150);
    ok('视频「转发到聊天/电脑」→ wx.shareFileMessage（fileName=manifest name）',
      !!(shareLog && shareLog.length && shareLog[0].fileName === '本草孝心_视频1_第7页.mp4'),
      shareLog ? JSON.stringify(shareLog[0]) : 'no-share');
    // 音频下载（按钮列表重新取：视频行已恢复「下载」，顺序仍 [视频,音频]）
    const dlBtns2 = await els(R.page, '.dl-media .dl-btn--filled');
    await tap(dlBtns2[1]);
    const openLog = await waitFor(async function () {
      const v = await mp.evaluate(function () { return getApp().__openLog; });
      return v && v.length ? v : null;
    }, 5000, 150);
    ok('音频下载完成 → wx.openDocument（系统播放器打开）', !!(openLog && openLog.length && /mock-media-2\.m4a$/.test(String(openLog[0].filePath))),
      openLog ? String(openLog[0].filePath) : 'no-open');
    // 相册授权失败 → showModal 引导 → openSetting
    await mp.evaluate(function () { getApp().__saveMode = 'authfail'; return true; });
    const dlBtns3 = await els(R.page, '.dl-media .dl-btn--filled');
    await tap(dlBtns3[0]);
    const modalLog = await waitFor(async function () {
      const v = await mp.evaluate(function () { return getApp().__modalLog; });
      return v && v.length ? v : null;
    }, 5000, 150);
    const settingCount = await mp.evaluate(function () { return getApp().__settingCount || 0; });
    ok('相册授权失败：showModal「需要相册权限」+「去设置」→ wx.openSetting',
      !!(modalLog && modalLog.some(function (t) { return String(t).indexOf('需要相册权限') >= 0; }) && settingCount >= 1),
      'modal=' + JSON.stringify(modalLog) + ' openSetting=' + settingCount);
    await mp.evaluate(function () { getApp().__saveMode = 'ok'; return true; });
    // 复制链接（音频行第 2 个 subbtn）
    const subs2 = await els(R.page, '.dl-media .dl-subbtn');
    await tap(subs2[3]);
    await sleep(500);
    const clipVal = await (async function () {
      await mp.evaluate(function () {
        const g = getApp();
        g.__clip = null;
        wx.getClipboardData({ success: function (r) { g.__clip = r && r.data; }, fail: function () { g.__clip = '__fail__'; } });
        return true;
      });
      await sleep(350);
      return mp.evaluate(function () { return getApp().__clip; });
    })();
    ok('媒体行「复制链接」→ 剪贴板 = 音频 OSS URL', /^https:\/\/.*\.m4a$/i.test(String(clipVal)), String(clipVal).slice(-40));
    await shot(mp, '04-media-row-actions.png');

    /* ---------- 4. 还原 mock/包装器 ---------- */
    const restore = await mp.evaluate(function () {
      const g = getApp();
      try {
        if (g.__mOrig && g.__mOrig.req) wx.request = g.__mOrig.req;
        if (g.__origMp) {
          Object.keys(g.__origMp).forEach(function (k) {
            const map = { dl: 'downloadFile', open: 'openDocument', save: 'saveVideoToPhotosAlbum', share: 'shareFileMessage', modal: 'showModal', setting: 'openSetting' };
            if (k === 'dl') wx.downloadFile = g.__origMp.dl;
            else if (k === 'open') wx.openDocument = g.__origMp.open;
            else if (k === 'save') wx.saveVideoToPhotosAlbum = g.__origMp.save;
            else if (k === 'share') wx.shareFileMessage = g.__origMp.share;
            else if (k === 'modal') wx.showModal = g.__origMp.modal;
            else if (k === 'setting') wx.openSetting = g.__origMp.setting;
            void map;
          });
        }
        delete g.__mediaWrapped;
        g.__dlMode = 'real';
        return { ok: true };
      } catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
    });
    ok('恢复 devtools 内存 mock（不污染后续会话）', !!(restore && restore.ok), JSON.stringify(restore));
    await reLaunch(mp, '/pages/ppt/ppt');

    /* ---------- 5. 汇总 ---------- */
    const realErrors = consoleErrors.filter(function (s) { return !/downloadFile:fail|404|ERR_|net::|mock-media/i.test(String(s)); });
    ok('无小程序 console error', realErrors.length === 0, 'errors=' + realErrors.length + (realErrors.length ? (' :: ' + realErrors.slice(0, 2).join(' | ')) : ''));
    console.log('\n[结论] 真实 deck hasMedia（未注入时）：' + realHasMedia + '（转换机 media_files 上线后自动显示，无字段时不显示）');
    console.log('[结论] media_files 注入：分组/行文案/下载→保存相册/授权失败引导/转发/音频 openDocument/复制链接 均实测');
    console.log('[截图] ' + SHOTS);
    const summary = { at: new Date().toISOString(), pass: passN, fail: failN, total: passN + failN, caps: caps, results: results };
    fs.writeFileSync(path.join(__dirname, 'ppt_media_preview_result.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log('\n================ ppt-media automator: ' + passN + ' passed, ' + failN + ' failed ================');
    clearTimeout(hardTimer);
    try { await mp.disconnect(); } catch (e) { /* ignore */ }
    process.exit(failN ? 2 : 0);
  } catch (e) {
    clearTimeout(hardTimer);
    console.error('[FATAL]', e && (e.stack || e.message || e));
    fs.writeFileSync(path.join(__dirname, 'ppt_media_preview_result.json'), JSON.stringify({ at: new Date().toISOString(), pass: passN, fail: failN, fatal: String((e && e.message) || e), results: results }, null, 2), 'utf8');
    try { await mp.disconnect(); } catch (e2) { /* ignore */ }
    process.exit(1);
  }
})();
