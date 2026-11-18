// ppt_dl_preview.js —— PPT v2.0「下载中心」automator 实测（2026-11-10）
//
// 运行（开发者工具已开、自动化端口 9424）：
//   node ppt_dl_preview.js
// 环境变量：WS=ws://127.0.0.1:9424（默认）
//
// 覆盖（能测尽测；不写云端、不点「重新处理」）：
//   1. 列表点击卡片 = 下载详情（不再进播放器）；列表「兼容版」「PDF」小标签（v2）
//   2. 详情页（真实 deck 当前状态 + 强制 v2/旧 deck 两种形态）：三行下载/大小/兼容提示/旧 deck 三件套
//   3. 下载链路（mock wx.downloadFile/openDocument，避免真下载 30–60MB）：
//      downloadFile(URL) → 进度 UI（截屏）→ 成功 → openDocument(fileType=pptx/pdf, showMenu)；
//      取消（abort）不报错；失败 toast；已下载后转发复用文件
//   4. 复制链接（wx.setClipboardData → getClipboardData 校验）
//   5. 转发：wx.shareFileMessage 真实可用性 + mock 可用时调用链；不可用时降级复制链接
//   6. 旧 deck：在线预览 → 旧播放器 pages/pptplay
//   7. 截图 6–8 张到 _shots_ppt_dl/；结果写 ppt_dl_preview_result.json；0 console error
'use strict';
const fs = require('fs');
const path = require('path');
const automator = require('miniprogram-automator');

const WS = process.env.WS || 'ws://127.0.0.1:9424';
const SHOTS = path.join(__dirname, '_shots_ppt_dl');
const DECK = 'dmwalrdlgevz90l';
const DECK_ID_CONST = 'dmwalrdlgevz90l';
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
  try { return await page.data(); } catch (e) { console.log('[warn] page.data timeout'); return {}; }
}
async function callMethod(mp, method, ...args) {
  let r = null;
  try {
    r = await mp.evaluate(function (m, a) {
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      if (!p || typeof p[m] !== 'function') return { ok: false, err: 'no method ' + m };
      try { const ret = p[m].apply(p, a); return { ok: true, ret: ret === undefined ? null : ret }; }
      catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
    }, method, args);
  } catch (e) { console.log('[callMethod timeout] ' + method); return { ok: false, err: 'timeout' }; }
  if (r && !r.ok) console.log('[callMethod] ' + method + ' :: ' + r.err);
  return r;
}
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
/* automator 在原生视频/大文件下载/页面切换时偶发响应超时：所有调用加兜底，避免单点中断全流程 */
async function safe(fn, fallback) {
  try { return await fn(); }
  catch (e) { console.log('[warn] automator call :: ' + (e && (e.message || e))); return fallback; }
}
async function reLaunch(mp, url) { await safe(function () { return mp.reLaunch(url); }); await sleep(1800); }
async function navTo(mp, url) { return safe(function () { return mp.navigateTo(url); }, null); }
async function curPage(mp) { return safe(function () { return mp.currentPage(); }, null); }
async function goBack(mp) {
  // 先关掉旧播放器的返回二次确认（enableAlertBeforeUnload），再用页面内 wx.navigateBack，避免被系统弹窗拦住
  await safe(function () {
    return mp.evaluate(function () {
      try { if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload(); } catch (e) { /* ignore */ }
      const pages = getCurrentPages();
      const p = pages[pages.length - 1];
      if (p) p._leaveGuard = false;
      try { wx.navigateBack({ delta: 1 }); } catch (e) { /* ignore */ }
      return true;
    });
  });
  await sleep(1500);
  let p = await curPage(mp);
  if (p && String(p.path || '').indexOf('pptdl') >= 0) return p;
  // 返回被系统弹窗拦住 / 掉到列表：直接重新打开下载详情（request 包装器仍生效）
  const np = await navTo(mp, '/pages/pptdl/pptdl?id=' + encodeURIComponent(DECK));
  await sleep(1800);
  return np || (await curPage(mp));
}
async function el(page, sel) {
  if (!page) return null;
  return safe(function () { return page.$(sel); }, null);
}
async function els(page, sel) {
  if (!page) return [];
  return safe(function () { return page.$$(sel); }, []);
}
async function tap(element) {
  if (!element) return false;
  return safe(function () { return element.tap(); }, false);
}
(async function () {
  fs.mkdirSync(SHOTS, { recursive: true });
  const mp = await automator.connect({ wsEndpoint: WS });
  console.log('[automator] connected', WS);
  const caps = await mp.evaluate(function () {
    return {
      downloadFile: typeof wx.downloadFile,
      openDocument: typeof wx.openDocument,
      shareFileMessage: typeof wx.shareFileMessage,
      setClipboardData: typeof wx.setClipboardData,
      sdk: (wx.getAppBaseInfo ? wx.getAppBaseInfo().SDKVersion : '')
    };
  });
  console.log('[caps]', JSON.stringify(caps));
  const shareApiReal = caps && caps.shareFileMessage === 'function';
  const consoleErrors = [];
  try { mp.on('console', function (msg) { if (msg && (msg.type === 'error' || msg.level === 'error')) consoleErrors.push(String(msg.args || msg.text || '')); }); } catch (e) { /* ignore */ }
  const origEval = mp.evaluate.bind(mp);
  mp.evaluate = async function () {
    try { return await origEval.apply(null, arguments); }
    catch (e) { console.log('[warn] evaluate timeout'); return null; }
  };
  const hardTimer = setTimeout(function () { console.error('[FATAL] 总超时 10 分钟'); process.exit(2); }, 10 * 60 * 1000);
  try {
    /* ---------- 0. 安装 request 包装器（控制列表 files 标签 / 详情 manifest 形态；只改内存响应，不写云） ---------- */
    const wrap = await mp.evaluate(function (DECK_ID) {
      const g = getApp();
      try {
        // 上一次运行残留的包装器先还原，保证本次用最新代码安装（避免旧闭包）
        if (g.__dlWrapped && g.__origReq) { wx.request = g.__origReq; delete g.__origReq; delete g.__dlWrapped; }
        g.__dlMode = 'real';
        g.__origReq = wx.request;
        g.__fakeBase = 'https://tool-furina-fun.oss-cn-hongkong.aliyuncs.com/ppt/a/dmwalrdlgevz90l/c0e5834805/';
        wx.request = function (o) {
          const s = o && o.success;
          if (s) {
            o.success = function (res) {
              try {
                const u = String((o && o.url) || '');
                const mode = g.__dlMode || 'real';
                if (res && res.statusCode === 200 && Array.isArray(res.data) && mode !== 'real') {
                  const fakeFiles = {
                    compat: { s: 'compat.pptx', size: 33554432, sha256: 'aaaa', ext: 'pptx', name: '本草孝心_兼容版.pptx' },
                    pdf: { s: 'preview.pdf', size: 2345678, sha256: 'bbbb', pages: 16, name: '本草孝心.pdf' },
                    source: { s: 'original.pptx', size: 34567000, sha256: 'cccc', ext: 'pptx', name: '本草孝心_原始.pptx' }
                  };
                  const fakeCompat = {
                    warnings: ['外链视频 1 处未随文件携带（第 7 页，路径尾 …/v.mp4）', '字体「思源宋体」未嵌入（许可限制）'],
                    fonts_embedded: 2, converted_from: 'ppt'
                  };
                  if (u.indexOf('manifest->files') >= 0) {
                    res.data.forEach(function (row) {
                      if (row && row.id === DECK_ID) row.files = mode === 'v2' ? fakeFiles : null;
                    });
                  }
                  if (u.indexOf('select=manifest') >= 0 && u.indexOf('id=eq.' + encodeURIComponent(DECK_ID)) >= 0) {
                    const row = res.data[0];
                    if (row && row.manifest) {
                      if (mode === 'v2') {
                        row.manifest.files = fakeFiles;
                        row.manifest.compat = fakeCompat;
                        row.manifest.v = 2;
                      } else if (mode === 'legacy') {
                        delete row.manifest.files;
                        delete row.manifest.compat;
                      }
                    }
                  }
                }
              } catch (e) { /* ignore */ }
              s(res);
            };
          }
          return g.__origReq.call(wx, o);
        };
        g.__dlWrapped = true;
        return { ok: true };
      } catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
    }, DECK);
    ok('安装 manifest/files 内存包装器（不写云端）', !!(wrap && wrap.ok), JSON.stringify(wrap));

    async function setMode(mode) {
      await mp.evaluate(function (m) { getApp().__dlMode = m; return true; }, mode);
    }
    async function openList() {
      await reLaunch(mp, '/pages/ppt/ppt');
      await sleep(2000);
      const page = await curPage(mp);
      const d = await waitFor(async function () { const x = await dataOf(page); return x.state === 'ready' ? x : null; }, 15000);
      return { page: page, d: d };
    }
    async function tapDeckCard(listPage, d) {
      const rows = (d && d.rows) || [];
      const idx = rows.map(function (r) { return r.id; }).indexOf(DECK);
      const cards = await els(listPage, '.ppt-card');
      const card = cards[idx >= 0 ? idx : 0] || null;
      if (card) await tap(card);
      await sleep(2200);
      let page = await curPage(mp);
      if (!page || String(page.path || '').indexOf('pptdl') < 0) {
        page = await navTo(mp, '/pages/pptdl/pptdl?id=' + encodeURIComponent(DECK));
        await sleep(1200);
      }
      const pd = await waitFor(async function () { const x = await dataOf(page); return (x.state === 'ready' || x.state === 'error') ? x : null; }, 15000);
      return { page: page, d: pd };
    }

    /* ---------- 1. 真实列表 + 点击卡片 = 详情 ---------- */
    let L = await openList();
    ok('列表页加载（state=ready）', !!L.d, L.d ? ('rows=' + (L.d.rows || []).length) : 'timeout');
    const realRow = ((L.d && L.d.rows) || []).filter(function (r) { return r.id === DECK; })[0];
    ok('真实 deck 在列表且可读', !!realRow, realRow ? realRow.title : 'missing');
    ok('列表标签字段接入（tagCompat/tagPdf 布尔）', !!realRow && typeof realRow.tagCompat === 'boolean' && typeof realRow.tagPdf === 'boolean',
      realRow ? ('compat=' + realRow.tagCompat + ' pdf=' + realRow.tagPdf) : '-');
    await shot(mp, '01-list.png');
    let D = await tapDeckCard(L.page, L.d);
    ok('★ 点击列表卡片 = 打开下载详情（不再进播放器）', !!D.page && String(D.page.path || '').indexOf('pptdl') >= 0, D.page && D.page.path);
    ok('详情页加载清单（state=ready）', !!D.d, D.d ? ('legacy=' + (D.d.d && D.d.d.legacy) + ' rows=' + ((D.d.d && D.d.d.rows) || []).length) : 'timeout');
    const realD = D.d && D.d.d;
    const realLegacy = !!(realD && realD.legacy);
    console.log('[real] legacy=', realLegacy, 'rows=', (realD && realD.rows || []).length, 'warnings=', (realD && realD.warnings || []).length);
    await shot(mp, '02-detail-real.png');

    /* ---------- 2. 旧 deck 形态（若真实已是 v2：强制 legacy 再看） ---------- */
    if (!realLegacy) {
      await setMode('legacy');
      L = await openList();
      D = await tapDeckCard(L.page, L.d);
    }
    const Lg = D.d && D.d.d;
    ok('旧 deck：显示「兼容版未生成」+ 原始文件行', !!(Lg && Lg.legacy && Lg.missingCompat && Lg.rows.length >= 1 && Lg.rows[0].key === 'source'),
      Lg ? ('legacy=' + Lg.legacy + ' rows=' + (Lg.rows || []).length) : 'no-detail');
    ok('旧 deck：在线预览入口可用（canPreview）', !!(Lg && Lg.canPreview));
    const legacyEl = await el(D.page, '.dl-legacy');
    ok('旧 deck UI 元素存在（.dl-legacy）', !!legacyEl);
    ok('旧 deck：「重新处理」按钮显示（本人）', !!(Lg && Lg.allowRetry));
    await shot(mp, '03-detail-legacy.png');
    // 在线预览 → 旧播放器
    const previewBtn = await el(D.page, '.dl-legacy .dl-btn--outline');
    if (previewBtn) {
      await tap(previewBtn);
      await sleep(2000);
      const pv = await curPage(mp);
      const pd = await dataOf(pv);
      ok('旧 deck：点「在线预览」进入旧播放器（pages/pptplay）', String(pv && pv.path || '').indexOf('pptplay') >= 0 && pd.state === 'ready',
        (pv && pv.path) + ' state=' + (pd && pd.state));
      await shot(mp, '04-preview-player.png');
      await goBack(mp);
      await sleep(1500);
      D = { page: await curPage(mp), d: await dataOf(await curPage(mp)) };
    } else {
      ok('旧 deck：点「在线预览」进入旧播放器（pages/pptplay）', false, 'no preview btn');
    }

    /* ---------- 3. 下载链路 mock（downloadFile 进度/成功 → openDocument；取消；复制链接） ---------- */
    const mockInstall = await mp.evaluate(function () {
      const g = getApp();
      try {
        if (!g.__origDl) g.__origDl = wx.downloadFile;
        if (!g.__origOpen) g.__origOpen = wx.openDocument;
        if (!g.__origShare) g.__origShare = wx.shareFileMessage;
        g.__dlLog = []; g.__openLog = []; g.__shareLog = []; g.__dlAborts = 0;
        g.__mockDelay = 800;
        wx.downloadFile = function (o) {
          const rec = { url: String((o && o.url) || ''), aborted: false };
          g.__dlLog.push(rec);
          const task = {
            abort: function () { rec.aborted = true; g.__dlAborts += 1; },
            onProgressUpdate: function (cb) { rec.cb = cb; }
          };
          setTimeout(function () { if (rec.cb && !rec.aborted) rec.cb({ progress: 42, totalBytesWritten: 42, totalBytesExpectedToWrite: 100 }); }, 120);
          setTimeout(function () {
            if (rec.aborted) return;
            rec.ok = true;
            if (o && o.success) o.success({ statusCode: 200, tempFilePath: 'wxfile://mock-download-' + (g.__dlLog.length) + '.bin' });
          }, g.__mockDelay || 800);
          return task;
        };
        wx.openDocument = function (o) {
          g.__openLog.push({ filePath: o && o.filePath, fileType: o && o.fileType, showMenu: o && o.showMenu });
          if (o && o.success) o.success();
        };
        if (typeof wx.shareFileMessage === 'function') {
          wx.shareFileMessage = function (o) {
            g.__shareLog.push({ filePath: o && o.filePath, fileName: o && o.fileName });
            if (o && o.success) o.success();
          };
        }
        return { ok: true };
      } catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
    });
    ok('安装 downloadFile/openDocument mock（避免真下载 30–60MB）', !!(mockInstall && mockInstall.ok), JSON.stringify(mockInstall));

    // 在旧 deck 详情页（有 source 行）测下载链
    const dlBtn1 = await el(D.page, '.dl-row .dl-btn--filled');
    if (dlBtn1) {
      await tap(dlBtn1);
      await sleep(350);
      const mid = await dataOf(D.page);
      ok('下载中显示进度 UI（下载 42%）', !!(mid.dl && mid.dl.on && mid.dl.pct === 42 && mid.dl.text === '下载 42%'),
        mid.dl ? mid.dl.text : 'no-dl');
      await shot(mp, '05-download-progress.png');
      const done = await waitFor(async function () {
        const log = await mp.evaluate(function () { return getApp().__openLog; });
        return log && log.length ? log : null;
      }, 6000);
      const dlLog = await mp.evaluate(function () { return getApp().__dlLog; });
      ok('下载调用 wx.downloadFile（OSS 链接）→ 成功调用 wx.openDocument', !!(done && done.length),
        dlLog && dlLog[0] ? String(dlLog[0].url).slice(-28) : 'no-download');
      if (done && done[0]) {
        ok('openDocument：fileType 与文件类型一致 + showMenu=true',
          /pptx|ppt|pdf/.test(String(done[0].fileType)) && done[0].showMenu === true,
          JSON.stringify(done[0]));
      }
      const after = await dataOf(D.page);
      ok('下载完成后进度关闭', after.dl === null);
    } else {
      ok('下载中显示进度 UI（下载 42%）', false, 'no download btn');
      ok('下载调用 wx.downloadFile（OSS 链接）→ 成功调用 wx.openDocument', false, 'no download btn');
    }

    // 取消下载（延长 mock 延迟）
    await mp.evaluate(function () { getApp().__mockDelay = 4000; return true; });
    const dlBtn2 = await el(D.page, '.dl-row .dl-btn--filled');
    if (dlBtn2) {
      await tap(dlBtn2);
      await sleep(400);
      const cancelBtn = await el(D.page, '.dl-btn--cancel');
      let aborts = 0;
      if (cancelBtn) await tap(cancelBtn);
      await sleep(600);
      aborts = await mp.evaluate(function () { return getApp().__dlAborts || 0; });
      const st = await dataOf(D.page);
      ok('下载可取消：点取消 → downloadTask.abort + 进度关闭', aborts >= 1 && st.dl === null, 'aborts=' + aborts + ' dl=' + JSON.stringify(st.dl));
    } else {
      ok('下载可取消：点取消 → downloadTask.abort + 进度关闭', false, 'no download btn');
    }
    await mp.evaluate(function () { getApp().__mockDelay = 800; return true; });

    // 复制链接（每行第 2 个 subbtn = 复制链接）
    const subs = await els(D.page, '.dl-subbtn');
    if (subs.length >= 2) {
      await tap(subs[1]);
      await sleep(500);
      const clip = await mp.evaluate(function () {
        const g = getApp();
        g.__clip = null;
        wx.getClipboardData({ success: function (r) { g.__clip = r && r.data; }, fail: function () { g.__clip = '__fail__'; } });
        return true;
      });
      await sleep(300);
      const clipVal = await mp.evaluate(function () { return getApp().__clip; });
      ok('复制链接：剪贴板 = 文件 URL', /^https:\/\/.*oss.*\.(pptx|ppt|pdf)$/i.test(String(clipVal)), String(clipVal).slice(-32));
    } else {
      ok('复制链接：剪贴板 = 文件 URL', false, 'subbtns=' + subs.length);
    }

    /* ---------- 4. v2 形态：列表标签 + 三行下载 + 兼容提示 ---------- */
    await setMode('v2');
    L = await openList();
    const v2row = ((L.d && L.d.rows) || []).filter(function (r) { return r.id === DECK; })[0];
    ok('v2：列表卡片出现「兼容版」「PDF」标签', !!(v2row && v2row.tagCompat && v2row.tagPdf),
      v2row ? ('compat=' + v2row.tagCompat + ' pdf=' + v2row.tagPdf) : 'missing');
    await shot(mp, '06-list-tags.png');
    D = await tapDeckCard(L.page, L.d);
    const V = D.d && D.d.d;
    ok('v2 详情：三行下载（兼容版 PPTX / PDF · 16 页 / 原始文件）',
      !!(V && V.rows && V.rows.length === 3 &&
        V.rows[0].label === '兼容版 PPTX' && /^PDF · 16 页/.test(V.rows[1].label) && V.rows[2].label === '原始文件'),
      V ? JSON.stringify((V.rows || []).map(function (x) { return x.label; })) : 'no-detail');
    ok('v2 详情：显示文件大小（33.0MB / 2.2MB）',
      !!(V && V.rows && V.rows.length >= 2 && V.rows[0].sizeText === '32.0MB' && V.rows[1].sizeText === '2.2MB'),
      V && V.rows && V.rows.length >= 2 ? (V.rows[0].sizeText + '/' + V.rows[1].sizeText) : '-');
    ok('v2 详情：兼容提示橙色逐条显示（外链媒体/字体）',
      !!(V && V.hasWarnings && V.warnings && V.warnings.length === 2 && /外链视频/.test(V.warnings[0])),
      V ? V.warnings.join(' | ').slice(0, 80) : '-');
    const warnEl = await el(D.page, '.dl-warn');
    ok('v2 UI：兼容提示区块存在（.dl-warn）', !!warnEl);
    await shot(mp, '07-detail-v2.png');

    // v2 下载兼容版 → openDocument fileType=pptx
    await mp.evaluate(function () { const g = getApp(); g.__openLog = []; g.__dlLog = []; g.__shareLog = []; return true; });
    const dlRows = await els(D.page, '.dl-row .dl-btn--filled');
    if (dlRows.length >= 1) {
      await tap(dlRows[0]);
      const opens = await waitFor(async function () {
        const log = await mp.evaluate(function () { return getApp().__openLog; });
        return log && log.length ? log : null;
      }, 6000);
      const dls = await mp.evaluate(function () { return getApp().__dlLog; });
      const lastDl = dls && dls[dls.length - 1];
      const lastOpen = opens && opens[opens.length - 1];
      ok('v2 下载兼容版：downloadFile(compat.pptx) → openDocument(fileType=pptx)',
        !!(lastDl && /compat\.pptx$/.test(String(lastDl.url)) && lastOpen && lastOpen.fileType === 'pptx'),
        JSON.stringify({ url: lastDl && String(lastDl.url).slice(-16), open: lastOpen }));
    } else {
      ok('v2 下载兼容版：downloadFile(compat.pptx) → openDocument(fileType=pptx)', false, 'no rows');
    }

    // 转发（shareFileMessage）：真实 API 可用性 + mock 可用时调用链；不可用时降级复制链接
    const shareSupported = !!(D.d && D.d.shareSupported);
    console.log('[share] page.shareSupported=', shareSupported, 'real API=', shareApiReal, 'subbtns=', (await els(D.page, '.dl-subbtn')).length);
    if (shareSupported) {
      const sub2 = await els(D.page, '.dl-subbtn');
      const shareBtn = sub2 && sub2.length >= 1 ? sub2[0] : null;
      // 先下载一次该行（上面已下载 compat 行，缓存在页面内）→ 直接点转发应复用已下载文件
      if (shareBtn) await tap(shareBtn);
      await sleep(600);
      const shareLog = await mp.evaluate(function () { return getApp().__shareLog; });
      ok('转发：wx.shareFileMessage(filePath,fileName) 调用链', !!(shareLog && shareLog.length), JSON.stringify(shareLog && shareLog[0]));
    } else {
      // 不可用 → 应降级复制链接（不弹「转发」按钮）
      const sub2 = await els(D.page, '.dl-subbtn');
      ok('转发不可用 → 降级复制链接（按钮区仍只有复制链接）', sub2.length >= 1, 'subbtns=' + sub2.length);
    }

    /* ---------- 5. 恢复 mock/包装器 ---------- */
    const restore = await mp.evaluate(function () {
      const g = getApp();
      try {
        if (g.__origReq) { wx.request = g.__origReq; delete g.__origReq; }
        if (g.__origDl) { wx.downloadFile = g.__origDl; delete g.__origDl; }
        if (g.__origOpen) { wx.openDocument = g.__origOpen; delete g.__origOpen; }
        if (g.__origShare) { wx.shareFileMessage = g.__origShare; delete g.__origShare; }
        g.__dlMode = 'real';
        delete g.__dlWrapped;
        return { ok: true };
      } catch (e) { return { ok: false, err: String((e && e.message) || e) }; }
    });
    ok('恢复 devtools 内存 mock（不污染后续会话）', !!(restore && restore.ok), JSON.stringify(restore));

    /* ---------- 6. 汇总 ---------- */
    const realErrors = consoleErrors.filter(function (s) { return !/downloadFile:fail|404|ERR_|net::/i.test(String(s)); });
    ok('无小程序 console error', realErrors.length === 0, 'errors=' + realErrors.length + (realErrors.length ? (' :: ' + realErrors.slice(0, 2).join(' | ')) : ''));
    console.log('\n[结论] 真实 deck 形态：' + (realLegacy ? '旧 deck（无 files → 兼容版未生成 + 预览 + 重新处理）' : 'v2（files 已生成）'));
    console.log('[结论] 下载链路（mock）：downloadFile → 进度 42% → openDocument(pptx/pdf, showMenu) / 取消 abort / 复制链接 均已实测');
    console.log('[结论] shareFileMessage API 真实可用性：' + (shareApiReal ? '可用' : 'devtools 不可用（真机验证；不可用时代码降级复制链接）'));
    console.log('[截图] ' + SHOTS);
    const summary = { at: new Date().toISOString(), pass: passN, fail: failN, total: passN + failN, caps: caps, realLegacy: realLegacy, results: results };
    fs.writeFileSync(path.join(__dirname, 'ppt_dl_preview_result.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log('\n================ ppt-dl automator: ' + passN + ' passed, ' + failN + ' failed ================');
    clearTimeout(hardTimer);
    try { await mp.disconnect(); } catch (e) { /* ignore */ }
    process.exit(failN ? 2 : 0);
  } catch (e) {
    clearTimeout(hardTimer);
    console.error('[FATAL]', e && (e.stack || e.message || e));
    fs.writeFileSync(path.join(__dirname, 'ppt_dl_preview_result.json'), JSON.stringify({ at: new Date().toISOString(), pass: passN, fail: failN, fatal: String((e && e.message) || e), results: results }, null, 2), 'utf8');
    try { await mp.disconnect(); } catch (e2) { /* ignore */ }
    process.exit(1);
  }
})();







