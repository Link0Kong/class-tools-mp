/* ppt_dl_unit_tests.js —— PPT v2.0「下载中心」专项单测（2026-11-10）
 *
 * 契约唯一真源：web/ppt/CONTRACT.md §12（v2.0 功能重定义）
 *   §12.2 manifest v2（files.compat/pdf/source + compat.warnings）· §12.4.1 下载详情/列表标签
 *   §12.4.2 小程序下载方式（downloadFile 进度/可取消 → openDocument；shareFileMessage；复制链接）
 *   §12.4.3 旧 deck 兼容（兼容版未生成 + 在线预览 + 重新处理）· §12.6 红线（不降质/不删内容）
 *
 * 覆盖：
 *   A. manifest v2 归一化（files/compat 容错、slides 可为空、旧 v1 兼容、坏数据不白屏）
 *   B. 下载文件行（label/size/name/pages/打开类型）+ 旧 deck 原始文件行 + 安全文件名
 *   C. 下载详情视图（v2 / 旧 deck / 未就绪 / 兼容提示 / 在线预览 / 重新处理权限）
 *   D. 列表标签（「兼容版」「PDF」）+ filesOfDecks 轻查询 + 本机缓存
 *   E. 页面行为（内存 wx mock）：wx.downloadFile 进度/取消/失败、wx.openDocument 调用（pptx/pdf）、
 *      wx.shareFileMessage 转发/不可用降级复制链接、复制链接、旧 deck 预览/重新处理、onUnload abort
 *   F. 工程静态断言（app.json 注册 pptdl、列表点击=详情、旧播放器保留、VERSION 2.1.2）
 *
 * 说明：纯 Node + 内存 wx mock；不发真实请求、不启动模拟器。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { allPages } = require('./_app_pages.js');
const assert = require('assert');

const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');
const ROOT_N = ROOT.replace(/\\/g, '/');
const ID = { token: 'tok-ppt-dl-mp', sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: false, ts: 1 };
const ID2 = { token: 'tok-ppt-dl-guest', sid: '9999000004', name: '测试辛', role: '', badge: '', is_admin: false, ts: 2 };
const DECK = 'dabc123456xy';
const BASE = 'https://oss.test/ppt/a/' + DECK + '/20261110/';

/* ---------------- 内存 wx mock ---------------- */
function createCtx() {
  const mem = Object.create(null);
  let reqLog = [];
  let reqImpl = function (o) { o.success({ statusCode: 200, data: [] }); };
  let toastLog = [];
  let clipLog = [];
  let navLog = [];
  let openDocs = [];
  let dlCalls = [];
  let shareCalls = [];
  let modalLog = [];
  let saveAlbumCalls = [];      // wx.saveVideoToPhotosAlbum 调用（§12.8 视频保存到相册）
  let openSettingCalls = 0;     // 授权失败后 wx.openSetting 引导次数
  let saveAlbumImpl = function (o) { if (o && o.success) o.success(); };
  const wxMock = {
    getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
    setStorageSync(k, v) { mem[k] = v; },
    removeStorageSync(k) { delete mem[k]; },
    getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 0, limitSize: 10240 }; },
    request(o) { reqLog.push(o); reqImpl(o); },
    showToast(o) { toastLog.push(o && o.title); },
    showModal(o) { modalLog.push(o && o.title); if (o && o.success) o.success({ confirm: true, cancel: false }); },
    openSetting() { openSettingCalls += 1; },
    saveVideoToPhotosAlbum(o) { saveAlbumCalls.push(o); saveAlbumImpl(o); },
    showShareMenu() {}, stopPullDownRefresh() {}, hideLoading() {}, showLoading() {},
    setClipboardData(o) { clipLog.push(o && o.data); if (o && o.success) o.success(); },
    getClipboardData(o) { if (o && o.success) o.success({ data: clipLog[clipLog.length - 1] || '' }); },
    switchTab(o) { navLog.push('switchTab:' + String((o && o.url) || '')); },
    reLaunch() {}, navigateTo(o) { navLog.push(String((o && o.url) || '')); }, navigateBack() {},
    getWindowInfo() { return { windowWidth: 390, windowHeight: 844, statusBarHeight: 47, pixelRatio: 3 }; },
    getSystemInfoSync() { return { windowWidth: 390, windowHeight: 844, SDKVersion: '3.17.4', statusBarHeight: 47 }; },
    getAppBaseInfo() { return { SDKVersion: '3.17.4', theme: 'light' }; },
    nextTick(fn) { if (fn) fn(); },
    setKeepScreenOn() {},
    onWindowResize() {}, offWindowResize() {},
    onNetworkStatusChange() {}, offNetworkStatusChange() {},
    getNetworkType(o) { if (o && o.success) o.success({ networkType: 'wifi' }); },
    createSelectorQuery() {
      return {
        select() { return this; }, in() { return this; }, selectViewport() { return this; },
        boundingClientRect() { return this; }, scrollOffset() { return this; }, fields() { return this; },
        exec(cb) { if (cb) cb([{ left: 0, top: 0, width: 390, height: 844 }]); }
      };
    },
    // 下载：task 支持 onProgressUpdate / abort；测试手动触发 success/fail/progress
    downloadFile(o) {
      const task = {
        aborted: false,
        onProgressUpdate(cb) { task._cb = cb; },
        abort() { task.aborted = true; if (o && o.fail) o.fail({ errMsg: 'abort' }); }
      };
      dlCalls.push({ opts: o, task: task });
      return task;
    },
    openDocument(o) { openDocs.push(o); if (o && o.success) o.success(); },
    shareFileMessage(o) { shareCalls.push(o); if (o && o.success) o.success(); },
    createInnerAudioContext() { return { play() {}, stop() {}, destroy() {}, onEnded() {}, onError() {} }; },
    createVideoContext() { return { play() {}, pause() {}, stop() {}, seek() {}, playbackRate() {} }; }
  };
  return {
    mem: mem, wxMock: wxMock,
    clearMem() {
      Object.keys(mem).forEach(function (k) { delete mem[k]; });
      reqLog = []; toastLog = []; clipLog = []; navLog = []; openDocs = []; dlCalls = []; shareCalls = [];
      modalLog = []; saveAlbumCalls = []; openSettingCalls = 0;
      saveAlbumImpl = function (o) { if (o && o.success) o.success(); };
      reqImpl = function (o) { o.success({ statusCode: 200, data: [] }); };
    },
    setReq(fn) { reqImpl = fn; },
    reqLog() { return reqLog; },
    toastLog() { return toastLog; },
    clipLog() { return clipLog; },
    navLog() { return navLog; },
    openDocs() { return openDocs; },
    dlCalls() { return dlCalls; },
    shareCalls() { return shareCalls; },
    modalLog() { return modalLog; },
    saveAlbumCalls() { return saveAlbumCalls; },
    openSettingCalls() { return openSettingCalls; },
    setSaveAlbumImpl(fn) { saveAlbumImpl = fn; },
    resetSaveAlbumImpl() { saveAlbumImpl = function (o) { if (o && o.success) o.success(); }; },
    setIdentity(id) { mem['zq_class_identity'] = JSON.stringify(id || ID); }
  };
}
function purge() {
  Object.keys(require.cache).forEach(function (k) {
    if (k.replace(/\\/g, '/').indexOf(ROOT_N) !== 0) return;
    try {
      const m = require.cache[k];
      if (m && m.exports && typeof m.exports.udStop === 'function') m.exports.udStop();
    } catch (e) { /* ignore */ }
    delete require.cache[k];
  });
}
function R(rel) { return require(path.join(ROOT, rel)); }
function src(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function enableCloud(cloud) {
  cloud.configure({ enabled: true, restBase: 'https://rest.test/v1/rdb/rest/', publishableKey: 'pk-test', ttUrl: '' });
}
function loadPageDef(rel) {
  let def = null;
  global.Page = function (d) { def = d; };
  try { require(path.join(ROOT, rel)); } finally { delete global.Page; }
  assert.ok(def && typeof def === 'object', '页面未注册 Page：' + rel);
  return def;
}
function ctxOf(def) {
  const ctx = Object.assign({}, def);
  ctx.data = JSON.parse(JSON.stringify(def.data || {}));
  ctx.setData = function (o, cb) {
    Object.keys(o || {}).forEach(function (k) { this.data[k] = o[k]; }, this);
    if (cb) cb();
  };
  return ctx;
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
const waitFor = async function (fn, timeout) {
  const t0 = Date.now();
  const lim = timeout || 3000;
  while (Date.now() - t0 < lim) {
    if (fn()) return true;
    await sleep(10);
  }
  return !!fn();
};

/* ---------------- fixture ---------------- */
function compatManifest(extra) {
  const m = {
    v: 2,
    w: 960, h: 540,
    slides: [],
    base: BASE,
    files: {
      compat: { s: 'compat.pptx', size: 34560000, sha256: 'aa11', ext: 'pptx', name: '团日活动_兼容版.pptx' },
      pdf: { s: 'preview.pdf', size: 2345678, sha256: 'bb22', pages: 16, name: '团日活动.pdf' },
      source: { s: 'original.pptx', size: 34567000, sha256: 'cc33', ext: 'pptx', name: '团日活动.pptx' }
    },
    compat: {
      warnings: ['外链视频 1 处未随文件携带（第 7 页，路径尾 …/v.mp4）', '字体「思源宋体」未嵌入（许可限制）'],
      fonts_embedded: 2,
      converted_from: 'ppt'
    }
  };
  return Object.assign(m, extra || {});
}
function legacyManifest() {
  return {
    v: 1,
    base: BASE,
    src: BASE + 'source.pptx',
    w: 1600, h: 900,
    slides: [
      { tr: 'fade', trd: 500, notes: '', thumb: 't1.webp', steps: [{ img: 's1-1.webp' }] },
      { tr: 'fade', trd: 500, notes: '', thumb: 't2.webp', steps: [{ img: 's2-1.webp' }] }
    ],
    media: []
  };
}
function deckRow(extra) {
  return Object.assign({
    id: DECK,
    title: '团日活动',
    owner_sid: ID.sid,
    owner_name: '测试账号',
    status: 'ready',
    slide_count: 16,
    step_count: 16,
    source_name: '团日活动.pptx',
    source_size: 34567000,
    cover_url: 'https://oss.test/cover.webp',
    created_at: 1762700000000,
    converted_at: 1762700100000
  }, extra || {});
}
// §12.8 视频/音频单独下载 fixture（转换机最终 compat 包抽取，字段见契约）
function mediaFilesFixture() {
  return [
    {
      s: 'media/本草孝心_视频1_第7页.mp4', name: '本草孝心_视频1_第7页.mp4',
      size: 20158796, sha256: 'dd44', kind: 'video', dur: 150.92, w: 1024, h: 576,
      slides: [7], src: 'media1.mp4'
    },
    {
      s: 'media/本草孝心_音频1_第12页.m4a', name: '本草孝心_音频1_第12页.m4a',
      size: 1200000, sha256: 'ee55', kind: 'audio', dur: 225.582,
      slides: [12], src: 'media2.m4a'
    }
  ];
}
function mediaManifest() {
  const m = compatManifest();
  m.media_files = mediaFilesFixture();
  return m;
}
// 详情页 mock：GET 清单返回 manifest+deck；PATCH（重试）走 GET+POST upsert
function setDetailReq(C, manifest, deck) {
  C.setReq(function (o) {
    const u = String(o.url);
    const m = String(o.method || 'GET').toUpperCase();
    if (m === 'GET' && u.indexOf('/ppt_decks?') >= 0) {
      if (u.indexOf('id=eq.') >= 0) return o.success({ statusCode: 200, data: [{ manifest: manifest, title: deck.title, slide_count: deck.slide_count, step_count: deck.step_count, source_size: deck.source_size, cover_url: deck.cover_url, owner_sid: deck.owner_sid, owner_name: deck.owner_name, status: deck.status, progress: deck.progress, error: deck.error || '', source_name: deck.source_name, created_at: deck.created_at, converted_at: deck.converted_at }] });
      return o.success({ statusCode: 200, data: [deck] });
    }
    if (m === 'POST' && u.indexOf('/ppt_decks') >= 0) {
      const row = (o.data && o.data[0]) || {};
      return o.success({ statusCode: 201, data: [row] });
    }
    return o.success({ statusCode: 200, data: [] });
  });
}
async function loadDetailPage(C, opts) {
  const o = opts || {};
  purge();
  C.clearMem();
  C.setIdentity(o.identity || ID);
  const cloud = R('utils/cloud.js');
  enableCloud(cloud);
  setDetailReq(C, o.manifest === undefined ? compatManifest() : o.manifest, o.deck || deckRow());
  const def = loadPageDef('pages/ppt/pptdl/pptdl.js');
  const ctx = ctxOf(def);
  def.onLoad.call(ctx, { id: DECK });
  if (ctx.data.state !== 'denied') def.onShow.call(ctx);
  await waitFor(function () { return ctx.data.state === 'ready' || ctx.data.state === 'error'; }, 3000);
  return { def: def, ctx: ctx };
}

async function run(test) {
  const prevWx = global.wx;
  const C = createCtx();
  global.wx = C.wxMock;
  try {
    /* ============================================================
     * A. manifest v2 归一化（§12.2）
     * ============================================================ */
    await test('PPT-DL-A1 manifest v2：slides 可为空，files.compat/pdf/source 解析（URL/大小/名字/页数）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const m = ppt.normManifest(compatManifest());
      assert.ok(m, 'v2 兼容清单应可解析（slides=[] 合法）');
      assert.strictEqual(m.v, 2);
      assert.strictEqual(m.slides.length, 0);
      assert.strictEqual(m.stepTotal, 0);
      assert.strictEqual(m.hasFiles, true);
      assert.ok(m.files.compat && m.files.pdf && m.files.source);
      assert.strictEqual(m.files.compat.url, BASE + 'compat.pptx');
      assert.strictEqual(m.files.compat.size, 34560000);
      assert.strictEqual(m.files.compat.sizeText, '33.0MB');
      assert.strictEqual(m.files.compat.sha256, 'aa11');
      assert.strictEqual(m.files.compat.ext, 'pptx');
      assert.strictEqual(m.files.pdf.pages, 16);
      assert.strictEqual(m.files.pdf.sizeText, '2.2MB');
      assert.strictEqual(m.files.source.url, BASE + 'original.pptx');
      assert.deepStrictEqual(m.compat.warnings.length, 2);
      assert.strictEqual(m.compat.fontsEmbedded, 2);
      assert.strictEqual(m.compat.convertedFrom, 'ppt');
      assert.strictEqual(m.video, null, 'compat 模式无 video');
    });

    await test('PPT-DL-A2 旧 v1 manifest 兼容：slides 保留、files 全 null、hasFiles=false（不回归旧 deck）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const m = ppt.normManifest(legacyManifest());
      assert.ok(m);
      assert.strictEqual(m.v, 1);
      assert.strictEqual(m.slides.length, 2);
      assert.strictEqual(m.hasFiles, false);
      assert.strictEqual(m.files.compat, null);
      assert.strictEqual(m.files.pdf, null);
      assert.strictEqual(m.files.source, null);
      assert.deepStrictEqual(m.compat.warnings, []);
      assert.strictEqual(m.src, BASE + 'source.pptx');
      // 旧 deck 完全没 slides 也没 files → 还没转换完成
      assert.strictEqual(ppt.normManifest({ base: BASE }), null);
      assert.strictEqual(ppt.normManifest({ base: BASE, slides: [], files: {} }), null);
    });

    await test('PPT-DL-A3 manifest v2 容错：files 缺 s 丢弃、坏 compat 默认值、绝对 URL、JSON 字符串、未知字段忽略', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const m = ppt.normManifest({
        base: BASE,
        files: {
          compat: { size: 100 },                                  // 缺 s → 丢弃
          pdf: { s: 'https://cdn.test/preview.pdf', size: 10, pages: 3 },
          source: { s: 'original.ppt', ext: 'ppt', size: '123' }
        },
        compat: { warnings: 'oops', fonts_embedded: 'x', converted_from: 5 },
        unknown: { a: 1 }
      });
      assert.ok(m);
      assert.strictEqual(m.files.compat, null, '缺 s 的文件丢弃');
      assert.strictEqual(m.files.pdf.url, 'https://cdn.test/preview.pdf', '绝对 URL 直连');
      assert.strictEqual(m.files.source.size, 123, 'size 字符串容错');
      assert.strictEqual(m.files.source.ext, 'ppt');
      assert.deepStrictEqual(m.compat.warnings, [], 'warnings 非数组 → 空');
      assert.strictEqual(m.compat.convertedFrom, '5');
      assert.strictEqual(m.hasFiles, true);
      // 整份 JSON 字符串（PostgREST jsonb 可能返回字符串）
      const s = ppt.normManifest(JSON.stringify(compatManifest()));
      assert.ok(s && s.hasFiles && s.files.compat);
      // warnings 过多 → 截断 20
      const many = ppt.normManifest({ base: BASE, files: { compat: { s: 'c.pptx', size: 1 } }, compat: { warnings: new Array(30).fill('w') } });
      assert.strictEqual(many.compat.warnings.length, 20);
    });

    /* ============================================================
     * B. 下载文件行 / 文件名 / 打开类型（§12.4.1/§12.4.2）
     * ============================================================ */
    await test('PPT-DL-B1 fileRows：三行顺序=兼容版/PDF/原始，标签与大小、PDF 页数、建议文件名扩展名', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const m = ppt.normManifest(compatManifest());
      const rows = ppt.fileRows(m, { title: '团日活动' });
      assert.deepStrictEqual(rows.map(function (r) { return r.key; }), ['compat', 'pdf', 'source']);
      assert.strictEqual(rows[0].label, '兼容版 PPTX');
      assert.strictEqual(rows[0].sizeText, '33.0MB');
      assert.strictEqual(rows[0].name, '团日活动_兼容版.pptx');
      assert.strictEqual(rows[0].openType, 'pptx');
      assert.strictEqual(rows[1].label, 'PDF · 16 页');
      assert.strictEqual(rows[1].openType, 'pdf');
      assert.strictEqual(rows[1].name, '团日活动.pdf');
      assert.strictEqual(rows[2].label, '原始文件');
      assert.strictEqual(rows[2].name, '团日活动.pptx');
      // 缺 name/ext → 按 kind 兜底
      const bare = ppt.fileRows(ppt.normManifest({ base: BASE, files: { compat: { s: 'c.pptx', size: 5 } } }), { title: 'X' });
      assert.strictEqual(bare[0].name, 'X.pptx');
      assert.strictEqual(bare[0].openType, 'pptx');
      assert.strictEqual(bare[0].sizeText, '5B');
    });

    await test('PPT-DL-B2 旧 deck：无 files 时用 manifest.src 给「原始文件」行（仍可下载原件，§12.6）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const rows = ppt.fileRows(ppt.normManifest(legacyManifest()), { title: '旧演示' });
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].key, 'source');
      assert.strictEqual(rows[0].label, '原始文件');
      assert.strictEqual(rows[0].legacy, true);
      assert.strictEqual(rows[0].url, BASE + 'source.pptx');
      assert.strictEqual(rows[0].openType, 'pptx');
      assert.strictEqual(rows[0].name, '旧演示.pptx');
      assert.strictEqual(rows[0].sizeText, '');
      // 无 files 且无 src → 空数组
      assert.deepStrictEqual(ppt.fileRows(ppt.normManifest({ base: BASE, slides: [{ steps: [{ img: 's.webp' }] }] }), { title: 'x' }), []);
    });

    await test('PPT-DL-B3 safeFileName/openTypeOf：去非法字符、强制扩展名、空标题兜底、打开类型容错', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      assert.strictEqual(ppt.safeFileName('a:b*c?"<>|.pptx', 't', 'pptx'), 'abc.pptx');
      assert.strictEqual(ppt.safeFileName('dir/a b.pptx', 't', 'pptx'), 'a b.pptx', '带目录只取文件名');
      assert.strictEqual(ppt.safeFileName('', '团日活动', 'pdf'), '团日活动.pdf');
      assert.strictEqual(ppt.safeFileName('', '', 'pptx'), '演示文件.pptx');
      assert.strictEqual(ppt.safeFileName('旧文件.PPT', 't', 'pptx'), '旧文件.pptx', '统一用目标扩展名');
      assert.ok(ppt.safeFileName('x'.repeat(300), 't', 'pptx').length <= 125, '文件名截断 ≤120 + 扩展名');
      assert.strictEqual(ppt.openTypeOf('pdf'), 'pdf');
      assert.strictEqual(ppt.openTypeOf('PPTX'), 'pptx');
      assert.strictEqual(ppt.openTypeOf('ppt'), 'ppt');
      assert.strictEqual(ppt.openTypeOf(''), 'pptx');
      assert.strictEqual(ppt.openTypeOf('bin'), 'pptx', '未知扩展名按 pptx 兜底');
      assert.ok(ppt.DOWNLOAD_OPEN_TYPES.indexOf('pptx') >= 0 && ppt.DOWNLOAD_OPEN_TYPES.indexOf('pdf') >= 0);
    });

    /* ============================================================
     * C. 下载详情视图（§12.4.1/§12.4.3）
     * ============================================================ */
    await test('PPT-DL-C1 详情视图（v2 ready）：三行 + 兼容提示 + 元信息；无 slides/video 不显示在线预览', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const deck = deckRow();
      const view = ppt.downloadDetailView(ppt.normManifest(compatManifest()), deck, { mine: true });
      assert.strictEqual(view.isReady, true);
      assert.strictEqual(view.rows.length, 3);
      assert.strictEqual(view.hasCompat, true);
      assert.strictEqual(view.hasPdf, true);
      assert.strictEqual(view.hasSource, true);
      assert.strictEqual(view.missingCompat, false);
      assert.strictEqual(view.legacy, false);
      assert.strictEqual(view.hasWarnings, true);
      assert.strictEqual(view.warnings.length, 2);
      assert.strictEqual(view.canPreview, false, 'v2 compat 无旧字段 → 无在线预览');
      assert.strictEqual(view.allowRetry, true);
      assert.strictEqual(view.statusText, '');
      assert.ok(view.meta.indexOf('16 页') >= 0 && view.meta.indexOf('33') >= 0 && view.meta.indexOf('测试账号') >= 0, view.meta);
      assert.strictEqual(view.cover, 'https://oss.test/cover.webp');
    });

    await test('PPT-DL-C2 旧 deck：兼容版未生成 + 在线预览可用 + 原始文件行 + 重新处理（本人/管理员）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const view = ppt.downloadDetailView(ppt.normManifest(legacyManifest()), deckRow(), { mine: true });
      assert.strictEqual(view.legacy, true);
      assert.strictEqual(view.missingCompat, true);
      assert.strictEqual(view.hasCompat, false);
      assert.strictEqual(view.hasPdf, false);
      assert.strictEqual(view.rows.length, 1);
      assert.strictEqual(view.rows[0].key, 'source');
      assert.strictEqual(view.canPreview, true);
      assert.strictEqual(view.allowRetry, true);
      const other = ppt.downloadDetailView(ppt.normManifest(legacyManifest()), deckRow(), { mine: false, admin: false });
      assert.strictEqual(other.allowRetry, false, '非本人不显示重新处理（RLS 会拒）');
      const adm = ppt.downloadDetailView(ppt.normManifest(legacyManifest()), deckRow(), { mine: false, admin: true });
      assert.strictEqual(adm.allowRetry, true, '管理员可重新处理');
      // 只有 video 的旧 deck 也可在线预览
      const m = ppt.normManifest({ base: BASE, src: BASE + 's.pptx', video: { s: 'deck.mp4', dur: 60 } });
      const v2 = ppt.downloadDetailView(m, deckRow(), { mine: true });
      assert.strictEqual(v2.canPreview, true);
    });

    await test('PPT-DL-C3 未就绪/失败 deck：只显示状态与进度，不显示下载文件', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const processing = ppt.downloadDetailView(null, deckRow({ status: 'processing', progress: 42 }), { mine: true });
      assert.strictEqual(processing.isReady, false);
      assert.strictEqual(processing.rows.length, 0);
      assert.strictEqual(processing.statusText, '转换中 42%');
      const failed = ppt.downloadDetailView(null, deckRow({ status: 'failed', error: '兼容处理失败：文件损坏' }), { mine: true });
      assert.strictEqual(failed.isReady, false);
      assert.strictEqual(failed.statusText, '转换失败');
      const queued = ppt.downloadDetailView(null, deckRow({ status: 'queued' }), { mine: true });
      assert.strictEqual(queued.statusText, '排队转换');
      assert.strictEqual(ppt.statusTextOf('uploading'), '上传中');
      assert.strictEqual(ppt.statusTextOf('ready'), '');
    });

    await test('PPT-DL-C4 `--compat-only` 合并后的 deck：三行下载 + 旧 slides 保留 → 仍可在线预览（§12.3/§12.5）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const mm = compatManifest();
      mm.slides = legacyManifest().slides;         // compat-only 保留旧预览字段
      mm.video = { s: 'deck.mp4', dur: 60, chapters: [] };
      const view = ppt.downloadDetailView(ppt.normManifest(mm), deckRow(), { mine: true });
      assert.strictEqual(view.rows.length, 3);
      assert.strictEqual(view.legacy, false);
      assert.strictEqual(view.canPreview, true, '旧 slides 保留 → 预览入口仍显示');
      assert.strictEqual(view.isReady, true);
    });

    /* ============================================================
     * D. 列表标签 / files 轻查询 / 缓存（§12.4.1）
     * ============================================================ */
    await test('PPT-DL-D1 列表标签：filesMap → deckView.tagCompat/tagPdf；无缓存不显示', function () {
      purge();
      C.clearMem();
      const ppt = R('pages/ppt/utils/ppt.js');
      const deck = deckRow();
      const filesMap = {};
      filesMap[DECK] = { compat: true, pdf: true, at: Date.now() };
      const v = ppt.deckView(deck, { sid: ID.sid, filesMap: filesMap });
      assert.strictEqual(v.tagCompat, true);
      assert.strictEqual(v.tagPdf, true);
      assert.strictEqual(v.hasTag, true);
      const v2 = ppt.deckView(deck, { sid: ID.sid });
      assert.strictEqual(v2.tagCompat, false);
      const v3 = ppt.deckView(deck, { sid: ID.sid, filesMap: { [DECK]: { compat: true, pdf: false } } });
      assert.strictEqual(v3.tagCompat, true);
      assert.strictEqual(v3.tagPdf, false);
      assert.deepStrictEqual(ppt.tagsOf({ compat: {} }), { tagCompat: true, tagPdf: false });
      assert.deepStrictEqual(ppt.tagsOf(null), { tagCompat: false, tagPdf: false });
    });

    await test('PPT-DL-D2 filesOfDecks：轻查询 manifest->files（不拉整份 manifest）+ 写本机缓存；失败用缓存兜底', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const cloud = R('utils/cloud.js');
      enableCloud(cloud);
      const ppt = R('pages/ppt/utils/ppt.js');
      let url = '';
      C.setReq(function (o) {
        url = String(o.url);
        return o.success({ statusCode: 200, data: [{ id: DECK, files: { compat: { s: 'c.pptx' }, pdf: { s: 'p.pdf' } } }] });
      });
      const r = await ppt.filesOfDecks([DECK, 'dother']);
      assert.strictEqual(r.ok, true);
      assert.ok(url.indexOf('select=id,manifest->files') >= 0, '只查派生 files 字段；实际 ' + url);
      assert.ok(url.indexOf('id=in.(' + DECK + ',dother)') >= 0, '批量 in 过滤');
      assert.strictEqual(r.map[DECK].compat, true);
      assert.strictEqual(r.map[DECK].pdf, true);
      // 写本机缓存（离线/下次直接可用）
      const cached = ppt.filesMap();
      assert.strictEqual(cached[DECK].compat, true);
      assert.strictEqual(cached[DECK].pdf, true);
      // 请求失败 → ok:false + 返回缓存（不抛错、不影响列表）
      C.setReq(function (o) { o.fail({ errMsg: 'network' }); });
      const r2 = await ppt.filesOfDecks([DECK]);
      assert.strictEqual(r2.ok, false);
      assert.strictEqual(r2.map[DECK].compat, true, '失败时用本机缓存兜底');
    });

    await test('PPT-DL-D3 rememberFiles：详情页拉过 manifest 后写缓存（列表标签离线可用）', function () {
      purge();
      C.clearMem();
      const ppt = R('pages/ppt/utils/ppt.js');
      ppt.rememberFiles('deckZ', { compat: { s: 'c' }, pdf: null });
      const map = ppt.filesMap();
      assert.strictEqual(map.deckZ.compat, true);
      assert.strictEqual(map.deckZ.pdf, false);
      assert.ok(map.deckZ.at > 0);
      const raw = C.mem['zq_ppt_files_v1'];
      assert.ok(raw && typeof raw === 'object', '写入 zq_ppt_files_v1');
      ppt.rememberFiles('deckZ', { compat: null, pdf: { s: 'p' } });
      assert.strictEqual(ppt.filesMap().deckZ.compat, false);
      assert.strictEqual(ppt.filesMap().deckZ.pdf, true);
    });

    /* ============================================================
     * E. 页面行为（§12.4.2 downloadFile/openDocument/shareFileMessage）
     * ============================================================ */
    await test('PPT-DL-E1 详情页加载 v2 清单：state=ready、三行文件、兼容提示、大小显示', async function () {
      const r = await loadDetailPage(C);
      assert.strictEqual(r.ctx.data.state, 'ready');
      assert.strictEqual(r.ctx.data.d.rows.length, 3);
      assert.deepStrictEqual(r.ctx.data.d.rows.map(function (x) { return x.label; }), ['兼容版 PPTX', 'PDF · 16 页', '原始文件']);
      assert.strictEqual(r.ctx.data.d.rows[0].size, 34560000);
      assert.strictEqual(r.ctx.data.d.hasWarnings, true);
      assert.strictEqual(r.ctx.data.d.warnings[0].indexOf('外链视频') >= 0, true);
      assert.strictEqual(r.ctx.data.shareSupported, true, 'mock 端支持 shareFileMessage → 显示转发');
      r.def.onUnload.call(r.ctx);
    });

    await test('PPT-DL-E2 下载兼容版：wx.downloadFile(URL) → 进度 → 成功 → wx.openDocument(fileType=pptx, showMenu)', async function () {
      const r = await loadDetailPage(C);
      const def = r.def;
      const ctx = r.ctx;
      def.downloadFile.call(ctx, { currentTarget: { dataset: { key: 'compat' } } });
      const dl = C.dlCalls()[0];
      assert.ok(dl, '调用 wx.downloadFile');
      assert.strictEqual(dl.opts.url, BASE + 'compat.pptx', '下载的是 base+files.compat.s');
      // 进度
      dl.task._cb({ progress: 42, totalBytesWritten: 42, totalBytesExpectedToWrite: 100 });
      assert.strictEqual(ctx.data.dl.key, 'compat');
      assert.strictEqual(ctx.data.dl.pct, 42);
      assert.strictEqual(ctx.data.dl.text, '下载 42%');
      // 成功 → openDocument
      dl.opts.success({ statusCode: 200, tempFilePath: 'wxfile://tmp_compat.pptx' });
      assert.strictEqual(ctx.data.dl, null, '完成后关闭进度');
      const od = C.openDocs()[0];
      assert.ok(od, '调用 wx.openDocument');
      assert.strictEqual(od.filePath, 'wxfile://tmp_compat.pptx');
      assert.strictEqual(od.fileType, 'pptx');
      assert.strictEqual(od.showMenu, true);
      // 已下载文件缓存：再次转发不再下载
      const downloadsBefore = C.dlCalls().length;
      def.shareFile.call(ctx, { currentTarget: { dataset: { key: 'compat' } } });
      assert.strictEqual(C.dlCalls().length, downloadsBefore, '已下载 → 直接转发，不重复下载');
      assert.strictEqual(C.shareCalls()[0].fileName, '团日活动_兼容版.pptx');
      r.def.onUnload.call(ctx);
    });

    await test('PPT-DL-E3 下载 PDF：progress 缺省时用 totalBytesWritten/totalBytesExpectedToWrite 算百分比；fileType=pdf', async function () {
      const r = await loadDetailPage(C);
      const def = r.def;
      const ctx = r.ctx;
      def.downloadFile.call(ctx, { currentTarget: { dataset: { key: 'pdf' } } });
      const dl = C.dlCalls()[0];
      assert.strictEqual(dl.opts.url, BASE + 'preview.pdf');
      dl.task._cb({ totalBytesWritten: 50, totalBytesExpectedToWrite: 200 });   // progress 缺失 → 25%
      assert.strictEqual(ctx.data.dl.pct, 25);
      assert.strictEqual(ctx.data.dl.text, '下载 25%');
      dl.opts.success({ statusCode: 200, tempFilePath: 'wxfile://tmp_preview.pdf' });
      assert.strictEqual(C.openDocs()[0].fileType, 'pdf');
      r.def.onUnload.call(ctx);
    });

    await test('PPT-DL-E4 下载可取消：cancelDownload → task.abort + 进度关闭 + toast；abort 触发的 fail 不报错', async function () {
      const r = await loadDetailPage(C);
      const def = r.def;
      const ctx = r.ctx;
      def.downloadFile.call(ctx, { currentTarget: { dataset: { key: 'compat' } } });
      const dl = C.dlCalls()[0];
      def.cancelDownload.call(ctx, {});
      assert.strictEqual(dl.task.aborted, true, '调用 downloadTask.abort()');
      assert.strictEqual(ctx.data.dl, null);
      assert.ok(C.toastLog().indexOf('已取消下载') >= 0);
      // abort 后 fail 回调（mock 已触发）不得再弹失败 toast
      const fails = C.toastLog().filter(function (t) { return String(t).indexOf('下载失败') >= 0; });
      assert.strictEqual(fails.length, 0, '取消后不再提示下载失败');
      r.def.onUnload.call(ctx);
    });

    await test('PPT-DL-E5 下载失败：toast「下载失败，请检查网络后重试」+ 进度关闭 + 可重试', async function () {
      const r = await loadDetailPage(C);
      const def = r.def;
      const ctx = r.ctx;
      def.downloadFile.call(ctx, { currentTarget: { dataset: { key: 'compat' } } });
      C.dlCalls()[0].opts.fail({ errMsg: 'downloadFile:fail' });
      assert.strictEqual(ctx.data.dl, null);
      assert.ok(C.toastLog().some(function (t) { return String(t).indexOf('下载失败') >= 0; }), '失败 toast');
      // 非 200 也按失败处理
      C.clearMem();
      const r2 = await loadDetailPage(C);
      r2.def.downloadFile.call(r2.ctx, { currentTarget: { dataset: { key: 'compat' } } });
      C.dlCalls()[0].opts.success({ statusCode: 403, tempFilePath: '' });
      assert.strictEqual(r2.ctx.data.dl, null);
      assert.ok(C.openDocs().length === 0, '非 200 不打开文件');
      r2.def.onUnload.call(r2.ctx);
    });

    await test('PPT-DL-E6 转发：未下载过 → 先下载再 shareFileMessage；shareFileMessage 不可用 → 降级复制链接', async function () {
      const r = await loadDetailPage(C);
      const def = r.def;
      const ctx = r.ctx;
      // 未下载 → 点转发会先走 downloadFile，完成后 shareFileMessage
      def.shareFile.call(ctx, { currentTarget: { dataset: { key: 'pdf' } } });
      assert.strictEqual(C.dlCalls().length, 1, '转发前自动下载');
      C.dlCalls()[0].opts.success({ statusCode: 200, tempFilePath: 'wxfile://tmp_preview.pdf' });
      assert.strictEqual(C.shareCalls().length, 1);
      assert.strictEqual(C.shareCalls()[0].filePath, 'wxfile://tmp_preview.pdf');
      assert.strictEqual(C.shareCalls()[0].fileName, '团日活动.pdf');
      r.def.onUnload.call(ctx);
      // 端能力不可用 → 复制链接 + toast
      const r2 = await loadDetailPage(C);
      delete C.wxMock.shareFileMessage;
      r2.ctx.data.shareSupported = false;
      r2.def.shareFile.call(r2.ctx, { currentTarget: { dataset: { key: 'compat' } } });
      assert.strictEqual(C.dlCalls().length, 0, '不可用时不下载，直接复制链接');
      assert.strictEqual(C.clipLog()[0], BASE + 'compat.pptx');
      assert.ok(C.toastLog().some(function (t) { return String(t).indexOf('下载链接已复制') >= 0; }), '复制链接 toast');
      r2.def.onUnload.call(r2.ctx);
      // 复原 mock（后续用例需要）
      C.wxMock.shareFileMessage = function (o) { C.shareCalls().push(o); if (o && o.success) o.success(); };
    });

    await test('PPT-DL-E7 复制链接：wx.setClipboardData(row.url) + toast；无 URL 不崩', async function () {
      const r = await loadDetailPage(C);
      const def = r.def;
      const ctx = r.ctx;
      def.copyLink.call(ctx, { currentTarget: { dataset: { key: 'source' } } });
      assert.strictEqual(C.clipLog()[0], BASE + 'original.pptx');
      assert.ok(C.toastLog().some(function (t) { return String(t).indexOf('下载链接已复制') >= 0; }));
      def.copyLink.call(ctx, { currentTarget: { dataset: { key: 'nope' } } });
      assert.strictEqual(C.clipLog().length, 1, '未知 key 不复制');
      r.def.onUnload.call(ctx);
    });

    await test('PPT-DL-E8 旧 deck 详情页：兼容版未生成 + 在线预览(navigateTo pptplay) + 重新处理(PATCH queued)', async function () {
      const r = await loadDetailPage(C, { manifest: legacyManifest() });
      const def = r.def;
      const ctx = r.ctx;
      assert.strictEqual(ctx.data.d.legacy, true);
      assert.strictEqual(ctx.data.d.missingCompat, true);
      assert.strictEqual(ctx.data.d.rows.length, 1);
      assert.strictEqual(ctx.data.d.rows[0].key, 'source');
      assert.strictEqual(ctx.data.d.canPreview, true);
      assert.strictEqual(ctx.data.d.allowRetry, true);
      // 在线预览 → 旧播放器
      def.openPreview.call(ctx);
      assert.ok(C.navLog().some(function (u) { return u.indexOf('/pages/ppt/pptplay/pptplay?id=' + DECK) >= 0; }), '预览跳旧播放器');
      // 重新处理 → PATCH status=queued
      C.clearMem();
      const before = C.reqLog().length;
      const r2 = await loadDetailPage(C, { manifest: legacyManifest() });
      r2.def.retryDeck.call(r2.ctx);
      await waitFor(function () {
        return C.reqLog().slice(before).some(function (o) { return String(o.method || '').toUpperCase() === 'POST' && JSON.stringify(o.data || '').indexOf('queued') >= 0; });
      }, 2000);
      assert.ok(C.reqLog().some(function (o) { return JSON.stringify(o.data || '').indexOf('"status":"queued"') >= 0; }), '重新处理 = retryDeck(status=queued)');
      assert.ok(C.toastLog().some(function (t) { return String(t).indexOf('已提交重新处理') >= 0; }));
      r2.def.onUnload.call(r2.ctx);
    });

    await test('PPT-DL-E9 未就绪 deck：详情页 ready 但 isReady=false / 无下载行且不显示下载按钮', async function () {
      const r = await loadDetailPage(C, {
        manifest: null,
        deck: deckRow({ status: 'processing', progress: 42, owner_sid: ID.sid })
      });
      assert.strictEqual(r.ctx.data.state, 'ready');
      assert.strictEqual(r.ctx.data.d.isReady, false);
      assert.strictEqual(r.ctx.data.d.rows.length, 0);
      assert.strictEqual(r.ctx.data.d.statusText, '转换中 42%');
      assert.strictEqual(r.ctx.data.d.allowRetry, true);
      r.def.onUnload.call(r.ctx);
    });

    await test('PPT-DL-E10 onUnload 取消未完成下载（不泄漏 downloadTask）', async function () {
      const r = await loadDetailPage(C);
      r.def.downloadFile.call(r.ctx, { currentTarget: { dataset: { key: 'compat' } } });
      const task = C.dlCalls()[0].task;
      r.def.onUnload.call(r.ctx);
      assert.strictEqual(task.aborted, true, '页面销毁时 abort 下载（§12.4.2 大文件可取消）');
    });

    /* ============================================================
     * F. 工程静态接线（app.json / 列表 / 旧播放器保留 / VERSION）
     * ============================================================ */
    await test('PPT-DL-F1 app.json 注册 pptdl（共 24 页、不新增 tabBar）、页面 4 文件 + 分享 handler；VERSION 2.1.2', function () {
      purge();
      const app = JSON.parse(src('app.json'));
      assert.ok(allPages(app).indexOf('pages/ppt/pptdl/pptdl') >= 0, '注册下载详情页（分包）');
      assert.ok(allPages(app).indexOf('pages/ppt/pptplay/pptplay') >= 0, '旧播放器保留（预览入口，分包）');
      assert.strictEqual(app.tabBar.list.length, 3, '不新增 tabBar');
      ['.js', '.wxml', '.wxss', '.json'].forEach(function (ext) {
        assert.ok(fs.existsSync(path.join(ROOT, 'pages/ppt/pptdl/pptdl' + ext)), '缺少 ppdl' + ext);
      });
      const js = src('pages/ppt/pptdl/pptdl.js');
      ['onShareAppMessage', 'onShareTimeline', 'share.enable()', 'utils/share.js'].forEach(function (k) {
        assert.ok(js.indexOf(k) >= 0, '详情页缺少 ' + k);
      });
      assert.ok(/VERSION = '2\.1\.2'/.test(src('utils/version.js')), 'VERSION 为 2.1.2');
    });

    await test('PPT-DL-F2 详情页静态：wx.downloadFile/openDocument(showMenu)/shareFileMessage/复制链接/兼容提示/旧 deck', function () {
      purge();
      const js = src('pages/ppt/pptdl/pptdl.js');
      const wxml = src('pages/ppt/pptdl/pptdl.wxml');
      const wxss = src('pages/ppt/pptdl/pptdl.wxss');
      assert.ok(/wx\.downloadFile/.test(js) && /onProgressUpdate/.test(js), 'downloadFile + 进度');
      assert.ok(/\.abort\(\)/.test(js) && /_abortDownload/.test(js), '可取消下载');
      assert.ok(/wx\.openDocument/.test(js) && /fileType: row\.openType/.test(js) && /showMenu: true/.test(js), 'openDocument(fileType/showMenu)');
      assert.ok(/wx\.shareFileMessage/.test(js), '转发到聊天/电脑');
      assert.ok(/wx\.setClipboardData/.test(js), '复制链接');
      assert.ok(/兼容版未生成/.test(wxml) && /在线预览/.test(wxml) && /重新处理/.test(wxml), '旧 deck 三件套');
      assert.ok(/兼容提示/.test(wxml) && /dl-warn-i/.test(wxml), '兼容提示逐条');
      assert.ok(/downloadFile/.test(wxml) && /cancelDownload/.test(wxml) && /copyLink/.test(wxml) && /shareFile/.test(wxml), '文件行按钮');
      assert.ok(/\.dl-progress-bar \{/.test(wxss) && /\.dl-warn \{/.test(wxss), '进度条/兼容提示样式');
      assert.ok(/webp="\{\{true\}\}"/.test(wxml), '封面 image 必须 webp=true');
    });

    await test('PPT-DL-F3 列表页：点击=下载详情（openDeck→pptdl）、标签/轻查询接入、上传/轮询/删除/重试保留', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const cloud = R('utils/cloud.js');
      enableCloud(cloud);
      const listManifest = compatManifest();
      C.setReq(function (o) {
        const u = String(o.url);
        if (u.indexOf('/site_assets?') >= 0) return o.success({ statusCode: 200, data: [] });
        if (u.indexOf('manifest->files') >= 0) return o.success({ statusCode: 200, data: [{ id: DECK, files: { compat: { s: 'c' }, pdf: { s: 'p' } } }] });
        if (u.indexOf('/ppt_decks?') >= 0) return o.success({ statusCode: 200, data: [deckRow({ manifest: listManifest })] });
        return o.success({ statusCode: 200, data: [] });
      });
      const def = loadPageDef('pages/ppt/ppt.js');
      const ctx = ctxOf(def);
      def.onLoad.call(ctx);
      def.onShow.call(ctx);
      await waitFor(function () { return ctx.data.state === 'ready' && ctx.data.rows.length > 0; }, 3000);
      assert.strictEqual(ctx.data.rows[0].tagCompat, true, '列表标签「兼容版」');
      assert.strictEqual(ctx.data.rows[0].tagPdf, true, '列表标签「PDF」');
      // 点击卡片 = 下载详情
      const navBefore = C.navLog().length;
      def.openDeck.call(ctx, { currentTarget: { dataset: { id: DECK } } });
      assert.strictEqual(C.navLog().length, navBefore + 1);
      assert.ok(C.navLog()[navBefore].indexOf('/pages/ppt/pptdl/pptdl?id=' + DECK) >= 0, '跳下载详情；实际 ' + C.navLog()[navBefore]);
      assert.ok(!/\/pages\/ppt\/pptplay\/pptplay/.test(C.navLog()[navBefore]), '点击卡片不再直接进播放器');
      // 原有能力保留
      const listJs = src('pages/ppt/ppt.js');
      ['uploadTap', 'cancelTap', 'moreTap', 'retryTap', 'delTap', 'chooseMessageFile', 'POLL_MS = 10000'].forEach(function (k) {
        assert.ok(listJs.indexOf(k) >= 0, '保留 ' + k);
      });
      def.onUnload.call(ctx);
    });

    /* ============================================================
     * M. §12.8 视频/音频单独下载（media_files 纯逻辑 + 下载链）
     * ============================================================ */
    await test('PPT-DL-M1 manifest.media_files 归一化：URL/kind/时长/分辨率/slides/sha/size + 坏项丢弃 + 上限 20', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const m = ppt.normManifest(mediaManifest());
      assert.strictEqual(m.media_files.length, 2);
      assert.strictEqual(m.hasMediaFiles, true);
      const v = m.media_files[0];
      assert.strictEqual(v.kind, 'video');
      assert.strictEqual(v.url, BASE + 'media/本草孝心_视频1_第7页.mp4', 'url = manifest.base + s');
      assert.strictEqual(v.name, '本草孝心_视频1_第7页.mp4');
      assert.strictEqual(v.size, 20158796);
      assert.strictEqual(v.sizeText, '19.2MB');
      assert.strictEqual(v.dur, 150.92);
      assert.strictEqual(v.w, 1024);
      assert.strictEqual(v.h, 576);
      assert.deepStrictEqual(v.slides, [7]);
      assert.strictEqual(v.sha256, 'dd44');
      assert.strictEqual(v.ext, 'mp4');
      const a = m.media_files[1];
      assert.strictEqual(a.kind, 'audio');
      assert.strictEqual(a.ext, 'm4a');
      assert.deepStrictEqual(a.slides, [12]);
      // 坏项：缺 s 丢弃、slides 非数组/非法值清理、未知 kind 按 video
      const bad = ppt.normManifest({
        v: 2, base: BASE,
        files: { compat: { s: 'c.pptx', size: 1 } },
        media_files: [
          { name: '缺 s.mp4' },
          { s: 'media/x.mp4', kind: 'weird', slides: ['7', -2, 0, '9'] }
        ]
      });
      assert.strictEqual(bad.media_files.length, 1);
      assert.strictEqual(bad.media_files[0].kind, 'video', '未知 kind 按视频');
      assert.deepStrictEqual(bad.media_files[0].slides, [7, 9], '非法页号清理 + 字符串转数字');
      // 上限 20（转换机侧本应 ≤20，客户端再兜底）
      const many = [];
      for (let i = 0; i < 25; i++) many.push({ s: 'media/m' + i + '.mp4', kind: 'video' });
      const cap = ppt.normManifest({ v: 2, base: BASE, files: { compat: { s: 'c.pptx' } }, media_files: many });
      assert.strictEqual(cap.media_files.length, 20);
    });

    await test('PPT-DL-M2 无 media_files（旧 deck / 普通 compat deck）→ [] / hasMediaFiles=false（向后兼容不显示分组）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const m1 = ppt.normManifest(compatManifest());
      assert.deepStrictEqual(m1.media_files, []);
      assert.strictEqual(m1.hasMediaFiles, false);
      const m2 = ppt.normManifest(legacyManifest());
      assert.deepStrictEqual(m2.media_files, []);
      assert.strictEqual(m2.hasMediaFiles, false);
      // 只有 media_files 的清单也合法（防御：极端/未来场景）
      const only = ppt.normManifest({ v: 2, base: BASE, media_files: [{ s: 'media/a.mp4', kind: 'video', slides: [3] }] });
      assert.ok(only);
      assert.strictEqual(only.hasMediaFiles, true);
      assert.strictEqual(only.hasFiles, false);
    });

    await test('PPT-DL-M3 mediaRows：视频1 · 第 7 页 / 音频1 · 第 12 页（序号按类型分开）+ 时长·分辨率·大小·name·url', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const man = ppt.normManifest(mediaManifest());
      const rows = ppt.mediaRows(man);
      assert.strictEqual(rows.length, 2);
      assert.deepStrictEqual(rows.map(function (r) { return r.label; }), ['视频1 · 第 7 页', '音频1 · 第 12 页']);
      assert.strictEqual(rows[0].kind, 'video');
      assert.strictEqual(rows[0].isVideo, true);
      assert.strictEqual(rows[0].no, 1);
      assert.strictEqual(rows[0].durText, '2:31');
      assert.strictEqual(rows[0].resText, '1024×576');
      assert.strictEqual(rows[0].specText, '2:31 · 1024×576');
      assert.strictEqual(rows[0].sizeText, '19.2MB');
      assert.strictEqual(rows[0].metaText, '2:31 · 1024×576 · 19.2MB');
      assert.strictEqual(rows[0].name, '本草孝心_视频1_第7页.mp4', '文件名用 manifest name');
      assert.strictEqual(rows[0].url, BASE + 'media/本草孝心_视频1_第7页.mp4');
      assert.strictEqual(rows[1].kind, 'audio');
      assert.strictEqual(rows[1].isAudio, true);
      assert.strictEqual(rows[1].resText, '', '音频不显示分辨率');
      assert.strictEqual(rows[1].specText, '3:46');
      // 同一媒体多页 → 列多页；视频/音频序号各自从 1
      const multi = ppt.mediaRows(ppt.normManifest({
        v: 2, base: BASE, files: { compat: { s: 'c.pptx' } },
        media_files: [
          { s: 'media/v1.mp4', kind: 'video', dur: 12, w: 640, h: 360, slides: [7, 12] },
          { s: 'media/v2.mp4', kind: 'video', dur: 8, slides: [3] },
          { s: 'media/a1.m4a', kind: 'audio', dur: 30, slides: [1] }
        ]
      }));
      assert.deepStrictEqual(multi.map(function (r) { return r.label; }),
        ['视频1 · 第 7、12 页', '视频2 · 第 3 页', '音频1 · 第 1 页']);
      // 无 media_files → []
      assert.deepStrictEqual(ppt.mediaRows(ppt.normManifest(compatManifest())), []);
      assert.deepStrictEqual(ppt.mediaRows(null), []);
    });

    await test('PPT-DL-M4 详情视图：media_rows 挂到 d（hasMedia/mediaCount/mediaVideos/mediaAudios），三行下载不变', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const view = ppt.downloadDetailView(ppt.normManifest(mediaManifest()), deckRow(), { mine: true });
      assert.strictEqual(view.hasMedia, true);
      assert.strictEqual(view.mediaCount, 2);
      assert.strictEqual(view.mediaVideos, 1);
      assert.strictEqual(view.mediaAudios, 1);
      assert.strictEqual(view.mediaRows.length, 2);
      assert.strictEqual(view.mediaRows[0].key, 'media1');
      assert.strictEqual(view.rows.length, 3, '兼容版/PDF/原始文件三行保留');
      const noMedia = ppt.downloadDetailView(ppt.normManifest(compatManifest()), deckRow(), { mine: true });
      assert.strictEqual(noMedia.hasMedia, false);
      assert.deepStrictEqual(noMedia.mediaRows, []);
    });

    await test('PPT-DL-M5 页面：视频下载 进度 → wx.saveVideoToPhotosAlbum(filePath) + 已保存到相册', async function () {
      const r = await loadDetailPage(C, { manifest: mediaManifest() });
      const def = r.def;
      const ctx = r.ctx;
      assert.strictEqual(ctx.data.d.hasMedia, true);
      assert.strictEqual(ctx.data.d.mediaRows.length, 2);
      def.downloadFile.call(ctx, { currentTarget: { dataset: { key: 'media1' } } });
      const dl = C.dlCalls()[0];
      assert.ok(dl, '媒体行同样走 wx.downloadFile');
      assert.strictEqual(dl.opts.url, BASE + 'media/本草孝心_视频1_第7页.mp4');
      dl.task._cb({ progress: 50 });
      assert.strictEqual(ctx.data.dl.key, 'media1');
      assert.strictEqual(ctx.data.dl.text, '下载 50%');
      dl.opts.success({ statusCode: 200, tempFilePath: 'wxfile://tmp_video1.mp4' });
      assert.strictEqual(ctx.data.dl, null, '完成后进度关闭');
      assert.strictEqual(C.saveAlbumCalls().length, 1, '视频调用 saveVideoToPhotosAlbum');
      assert.strictEqual(C.saveAlbumCalls()[0].filePath, 'wxfile://tmp_video1.mp4');
      assert.ok(C.toastLog().some(function (t) { return String(t).indexOf('已保存到相册') >= 0; }), '保存成功 toast');
      r.def.onUnload.call(ctx);
    });

    await test('PPT-DL-M6 相册授权失败：showModal「需要相册权限」→ 确认后 wx.openSetting 引导', async function () {
      const r = await loadDetailPage(C, { manifest: mediaManifest() });
      const def = r.def;
      const ctx = r.ctx;
      C.setSaveAlbumImpl(function (o) { if (o && o.fail) o.fail({ errMsg: 'saveVideoToPhotosAlbum:fail auth deny' }); });
      def.downloadFile.call(ctx, { currentTarget: { dataset: { key: 'media1' } } });
      C.dlCalls()[0].opts.success({ statusCode: 200, tempFilePath: 'wxfile://tmp_video1.mp4' });
      assert.ok(C.modalLog().some(function (t) { return String(t).indexOf('需要相册权限') >= 0; }), '授权失败弹设置引导');
      assert.strictEqual(C.openSettingCalls(), 1, '确认「去设置」→ wx.openSetting');
      C.resetSaveAlbumImpl();
      r.def.onUnload.call(ctx);
    });

    await test('PPT-DL-M7 视频转发：先下载再 wx.shareFileMessage(fileName=manifest name)；已缓存不重复下载', async function () {
      const r = await loadDetailPage(C, { manifest: mediaManifest() });
      const def = r.def;
      const ctx = r.ctx;
      def.shareFile.call(ctx, { currentTarget: { dataset: { key: 'media1' } } });
      assert.strictEqual(C.dlCalls().length, 1, '未下载过 → 先下载');
      C.dlCalls()[0].opts.success({ statusCode: 200, tempFilePath: 'wxfile://tmp_video1.mp4' });
      assert.strictEqual(C.shareCalls().length, 1);
      assert.strictEqual(C.shareCalls()[0].fileName, '本草孝心_视频1_第7页.mp4', '文件名用 f.name');
      assert.strictEqual(C.shareCalls()[0].filePath, 'wxfile://tmp_video1.mp4');
      def.shareFile.call(ctx, { currentTarget: { dataset: { key: 'media1' } } });
      assert.strictEqual(C.dlCalls().length, 1, '已缓存 → 不再下载');
      assert.strictEqual(C.shareCalls().length, 2);
      r.def.onUnload.call(ctx);
    });

    await test('PPT-DL-M8 音频下载：wx.openDocument 打开；打开失败 → 降级转发（不阻塞）', async function () {
      const r = await loadDetailPage(C, { manifest: mediaManifest() });
      const def = r.def;
      const ctx = r.ctx;
      def.downloadFile.call(ctx, { currentTarget: { dataset: { key: 'media2' } } });
      C.dlCalls()[0].opts.success({ statusCode: 200, tempFilePath: 'wxfile://tmp_audio1.m4a' });
      assert.strictEqual(C.openDocs().length, 1, '音频走 openDocument');
      assert.strictEqual(C.openDocs()[0].filePath, 'wxfile://tmp_audio1.m4a');
      // 打开失败 → 有 share 能力则降级转发
      const origOpen = C.wxMock.openDocument;
      C.wxMock.openDocument = function (o) { C.openDocs().push(o); if (o && o.fail) o.fail({ errMsg: 'openDocument:fail' }); };
      try {
        def.downloadFile.call(ctx, { currentTarget: { dataset: { key: 'media2' } } });
        C.dlCalls()[1].opts.success({ statusCode: 200, tempFilePath: 'wxfile://tmp_audio1.m4a' });
        assert.ok(C.shareCalls().some(function (x) { return x.fileName === '本草孝心_音频1_第12页.m4a'; }), '打开失败降级转发');
      } finally { C.wxMock.openDocument = origOpen; }
      r.def.onUnload.call(ctx);
    });

    await test('PPT-DL-M9 媒体行：复制链接=f.name 对应 URL、取消 abort、失败 toast（复用同一进度状态）', async function () {
      const r = await loadDetailPage(C, { manifest: mediaManifest() });
      const def = r.def;
      const ctx = r.ctx;
      // 复制链接
      def.copyLink.call(ctx, { currentTarget: { dataset: { key: 'media1' } } });
      assert.strictEqual(C.clipLog()[0], BASE + 'media/本草孝心_视频1_第7页.mp4');
      // 取消
      def.downloadFile.call(ctx, { currentTarget: { dataset: { key: 'media2' } } });
      const task = C.dlCalls()[0].task;
      def.cancelDownload.call(ctx, {});
      assert.strictEqual(task.aborted, true);
      assert.strictEqual(ctx.data.dl, null);
      // 失败
      def.downloadFile.call(ctx, { currentTarget: { dataset: { key: 'media1' } } });
      C.dlCalls()[1].opts.fail({ errMsg: 'downloadFile:fail' });
      assert.strictEqual(ctx.data.dl, null);
      assert.ok(C.toastLog().some(function (t) { return String(t).indexOf('下载失败') >= 0; }), '失败 toast');
      r.def.onUnload.call(ctx);
    });

    await test('PPT-DL-M10 工程静态：WXML「视频单独下载」分组只由 hasMedia 控制、媒体行按钮齐；JS 保存相册/设置引导', function () {
      purge();
      const js = src('pages/ppt/pptdl/pptdl.js');
      const wxml = src('pages/ppt/pptdl/pptdl.wxml');
      const wxss = src('pages/ppt/pptdl/pptdl.wxss');
      assert.ok(/视频单独下载/.test(wxml), '分组标题');
      assert.ok(/wx:if="\{\{d\.hasMedia\}\}"/.test(wxml), '仅 media_files 非空显示（无字段不显示）');
      assert.ok(/wx:for="\{\{d\.mediaRows\}\}"/.test(wxml) && /item\.label/.test(wxml), '媒体行渲染');
      assert.ok(/item\.specText/.test(wxml) && /item\.sizeText/.test(wxml), '时长/分辨率 + 大小');
      assert.ok(/data-key="\{\{item\.key\}\}" bindtap="downloadFile"/.test(wxml), '媒体行下载按钮');
      assert.ok(/bindtap="shareFile"/.test(wxml) && /bindtap="copyLink"/.test(wxml) && /cancelDownload/.test(wxml), '转发/复制链接/取消');
      assert.ok(/wx\.saveVideoToPhotosAlbum/.test(js) && /需要相册权限/.test(js) && /wx\.openSetting/.test(js), '视频保存相册 + 授权失败设置引导');
      assert.ok(/_afterDownload/.test(js) && /_saveVideo/.test(js) && /_openAudio/.test(js), '媒体下载完成后动作分派');
      assert.ok(/wx\.openDocument/.test(js) && /_audioFallback/.test(js), '音频 openDocument + 失败降级');
      assert.ok(/\.dl-media-hd \{/.test(wxss) && /\.dl-row--media \{/.test(wxss), '媒体分组样式');
      assert.ok(/dl-list/.test(wxml) && /d\.rows\.length/.test(wxml), '原三行下载保留');
    });
  } finally {
    global.wx = prevWx;
  }
}

module.exports = { run: run };

if (require.main === module) {
  const results = [];
  let passN = 0, failN = 0;
  const test = async function (name, fn) {
    try { await fn(); passN += 1; results.push({ name: name, ok: true }); console.log('PASS  ' + name); }
    catch (e) { failN += 1; results.push({ name: name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
  };
  run(test).then(function () {
    const summary = { total: passN + failN, pass: passN, fail: failN, results: results, at: new Date().toISOString() };
    fs.writeFileSync(path.join(__dirname, 'ppt_dl_result.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log('\n================ ppt-dl: ' + passN + ' passed, ' + failN + ' failed ================');
    process.exit(failN ? 2 : 0);
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}
