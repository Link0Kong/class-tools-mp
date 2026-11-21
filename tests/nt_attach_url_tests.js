/* nt_attach_url_tests.js —— 小程序通知附件「签名 URL / data URI 双形态」专项单测（2026-11-10 迁移第 2 步）
 *
 * 背景（三端共用改造）：云端通知 body 里的附件由 base64 `data:` URI 改为签名 HTTPS URL
 *   https://tool.furina.fun/att/<id>?exp=<unix>&sig=<hex64>（GET 直出字节，无鉴权头；备案期可能是 http://...）。
 *   小程序通知页必须同时支持两种形态：data URI 全流程不变，URL 新增分支。
 *
 * 运行：
 *   node nt_attach_url_tests.js     # 独立运行（自带 wx mock）
 *   node unit.js                    # unit.js 末尾 require 本文件 run(test)，并入总表
 *
 * 覆盖（全部为 Node 内存 mock，不启动模拟器、不发真实网络请求）：
 *   1) mapGroup：URL 文件 hasUrl/pending/meta（it.size 优先；无 size 显示「附件」而不是 0 B）；
 *      data URI 旧口径（base64 估算字节 / it.size 优先）不变；无 url 仍「待获取」；
 *   2) 压缩包 archive.files[]：URL 与 data URI 都有 hasUrl/size，包内文件列表不丢；
 *   3) _filePathOf：data URI → writeDataUri；https/http URL → wx.downloadFile → tempFilePath；
 *      非 200 / fail 都 reject（不落坏文件）；非 data/非 http 的本地路径原样返回；
 *   4) previewFile：URL → 下载 → wx.openDocument（temp 路径无扩展名时用 fileType 兜底）；
 *      图片走 previewImage；下载失败 toast 不崩；data URI 旧分支仍写临时文件；
 *   5) downloadFile：URL → 下载 → openDocument(showMenu=true) 提示保存；失败 toast「下载失败」；
 *   6) previewArchiveFile：包内 URL 下载后按类型打开/预览；仅清单文件 toast 且不请求；
 *   7) ensureImgs：data URI 落盘；https URL 直接作为 <image src>（不 downloadFile）；
 *   8) 静态接线：nt.wxml 图片/附件入口不变、nt.js 保留 data URI 分支 + 新增 URL 分支、不写死域名、版本号不变。
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');
const ROOT_N = ROOT.replace(/\\/g, '/');

const ID = { token: 'tok-att-1', sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: true, ts: 1 };
const NT_PREFIX = '[[CLASS_NOTICE_V1]]';
// 契约形态：/att/<32 位十六进制>?exp=<unix 秒>&sig=<hex64>（只测协议判断，不写死域名）
const URL_HTTPS = 'https://tool.furina.fun/att/0123456789abcdef0123456789abcdef?exp=1790000000&sig=' + 'a'.repeat(64);
const URL_HTTP = 'http://example.test/att/fedcba9876543210fedcba9876543210?exp=1790000000&sig=' + 'b'.repeat(64);
const DATA_PDF = 'data:application/pdf;base64,' + 'JVBERi0xLjQK'.repeat(400);   // 4800 字符 ≈ 3600 B → 4 KB
const DATA_DOCX = 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,' + 'QUJD'.repeat(100);

/* ---------------------------------------------------------------- 公共小工具 */
let passN = 0, failN = 0;
async function test(name, fn) {
  try { await fn(); passN++; console.log('PASS  ' + name); }
  catch (e) { failN++; console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function src(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function R(rel) { return require(path.join(ROOT, rel)); }
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
function loadNtPage() {
  const file = path.join(ROOT, 'pages/nt/nt.js');
  try { delete require.cache[require.resolve(file)]; } catch (e) { /* ignore */ }
  const prevPage = global.Page;
  let def = null;
  global.Page = function (d) { def = d; };
  try { require(file); } finally {
    if (prevPage === undefined) { try { delete global.Page; } catch (e) { /* ignore */ } } else global.Page = prevPage;
  }
  assert.ok(def && typeof def.pull === 'function', 'nt 页未注册 Page');
  return def;
}

/* ---------------------------------------------------------------- wx mock 上下文 */
function createCtx() {
  const mem = Object.create(null);
  const log = { requests: [], downloads: [], opens: [], previews: [], toasts: [], writes: [] };
  let reqImpl = function (o) { if (o && o.success) o.success({ statusCode: 200, data: [] }); };
  let dlImpl = function (o) { if (o && o.success) o.success({ statusCode: 200, tempFilePath: '/tmp/wx-download/nt_file.tmp' }); };
  let openImpl = function (o) { if (o && o.success) o.success(); };
  let writeImpl = function (o) { log.writes.push(o); if (o && o.success) o.success({}); };
  const wxMock = {
    getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
    setStorageSync(k, v) { mem[k] = v; },
    removeStorageSync(k) { delete mem[k]; },
    getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 0, limitSize: 10240 }; },
    request(o) { log.requests.push(o); reqImpl(o); },
    showToast(o) { log.toasts.push(o && o.title); },
    showModal(o) { if (o && o.success) o.success({ confirm: true, cancel: false }); },
    showLoading() {}, hideLoading() {},
    setClipboardData(o) { if (o && o.success) o.success(); },
    getClipboardData(o) { if (o && o.success) o.success({ data: '' }); },
    getWindowInfo() { return { windowWidth: 375, windowHeight: 667 }; },
    getSystemInfoSync() { return { windowWidth: 375, windowHeight: 667, SDKVersion: '3.0.0' }; },
    getAppBaseInfo() { return { SDKVersion: '3.0.0' }; },
    createSelectorQuery() {
      return {
        in() { return this; }, select() { return this; }, selectViewport() { return this; },
        boundingClientRect() { return this; }, scrollOffset() { return this; },
        fields() { return this; }, exec(cb) { if (cb) cb([{ top: 100 }, { scrollTop: 0 }]); }
      };
    },
    navigateTo(o) { if (o && o.success) o.success(); },
    switchTab(o) { if (o && o.success) o.success(); },
    reLaunch(o) { if (o && o.success) o.success(); },
    nextTick(fn) { if (fn) fn(); },
    downloadFile(o) { log.downloads.push({ url: o && o.url }); dlImpl(o); },
    openDocument(o) { log.opens.push({ filePath: o && o.filePath, fileType: o && o.fileType, showMenu: o && o.showMenu }); openImpl(o); },
    previewImage(o) { log.previews.push({ urls: (o && o.urls) || [], current: o && o.current }); },
    getFileSystemManager() { return { writeFile(o) { writeImpl(o); } }; },
    env: { USER_DATA_PATH: '/tmp/user' }
  };
  return {
    mem: mem, wxMock: wxMock, log: log,
    clear() {
      Object.keys(mem).forEach(function (k) { delete mem[k]; });
      Object.keys(log).forEach(function (k) { log[k].length = 0; });
      reqImpl = function (o) { if (o && o.success) o.success({ statusCode: 200, data: [] }); };
      dlImpl = function (o) { if (o && o.success) o.success({ statusCode: 200, tempFilePath: '/tmp/wx-download/nt_file.tmp' }); };
      openImpl = function (o) { if (o && o.success) o.success(); };
      writeImpl = function (o) { log.writes.push(o); if (o && o.success) o.success({}); };
    },
    setReq(fn) { reqImpl = fn; },
    setDownload(fn) { dlImpl = fn; },
    setOpen(fn) { openImpl = fn; },
    setWrite(fn) { writeImpl = fn; },
    setIdentity(id) { mem['zq_class_identity'] = JSON.stringify(id || ID); }
  };
}

/* ---------------------------------------------------------------- setData / 拉取 mock */
// 极简 setData：支持 'a.b' / 'a[0].b' 路径
function makeSetData(ctx) {
  return function (o, cb) {
    Object.keys(o || {}).forEach(function (k) {
      const parts = k.replace(/\[(\d+)\]/g, '.$1').split('.');
      let t = ctx.data;
      for (let i = 0; i < parts.length - 1; i++) {
        if (t[parts[i]] == null) t[parts[i]] = {};
        t = t[parts[i]];
      }
      t[parts[parts.length - 1]] = o[k];
    });
    if (cb) cb();
  };
}
function ctxOf(def, extra) {
  const ctx = Object.assign({}, def);
  ctx.data = JSON.parse(JSON.stringify(def.data || {}));
  ctx.setData = makeSetData(ctx);
  if (extra) Object.assign(ctx, extra);
  return ctx;
}
function autoRow(g, i) {
  return {
    id: 'auto_' + g.id,
    title: g.title || '',
    body: NT_PREFIX + JSON.stringify(Object.assign({ _i: i }, g)),
    imp: false, pin: false, author: '系统', owner: 'system', attachments: '',
    archived: false, ts: 1000 + i, hidden: false, override_json: '', edited_at: 0, edited_by: ''
  };
}
// 通知页 pull 走 cloud.ntAutoPull：mock /notices GET 或 meta RPC 返回 auto 通知行（其它请求空数组）
function ntPullMock(C, groups) {
  C.setReq(function (o) {
    const u = String((o && o.url) || '');
    if (u.indexOf('/notices') >= 0 || u.indexOf('class_notices_meta') >= 0) {
      return o.success({ statusCode: 200, data: (groups || []).map(autoRow) });
    }
    return o.success({ statusCode: 200, data: [] });
  });
}
// 按真实通知页流程 pull 一次（身份/云配置/mock 请求 → mapGroup → 卡片数据）
async function bootPull(C, groups, reqImpl) {
  C.clear();
  C.setIdentity(ID);
  purge();
  const cloud = R('utils/cloud.js');
  cloud.configure({ enabled: true, restBase: 'https://rest.test/v1/rdb/rest/', publishableKey: 'pk-test', ttUrl: '' });
  if (typeof reqImpl === 'function') C.setReq(reqImpl);
  else ntPullMock(C, groups);
  const def = loadNtPage();
  const ctx = ctxOf(def, {
    _raw: [], _all: [], _expanded: {}, _done: {}, _remind: {}, _imgs: {}, _loadingImgs: {},
    _first: true, _lastPull: 0, _remindAt: 0, _remindPulling: false, _foldTimers: {},
    _pendingGid: '', _pendingFilter: ''
  });
  await def.pull.call(ctx, true);
  for (let i = 0; i < 100 && ctx.data.state === 'loading'; i++) await sleep(10);
  assert.strictEqual(ctx.data.state, 'ready', 'pull 未就绪：' + ctx.data.errorText);
  return { def: def, ctx: ctx };
}

/* ================================================================ RUN */
function run(outerTest) {
  const T = (typeof outerTest === 'function') ? outerTest : test;
  const prevWx = global.wx;
  const C = createCtx();
  global.wx = C.wxMock;

  return (async function () {
    try {
      /* ------------------------------------------------ 1. 卡片映射：大小 / hasUrl / pending */
      await T('附件URL：mapGroup 两种形态（URL 用 it.size、无 size 不显示 0 B；data URI 旧口径不变）', async function () {
        const groups = [{
          id: 'g_att', title: '附件形态', cat: '教务', actionable: true,
          deadline: '2099-01-01T00:00:00+08:00',
          items: [
            { kind: 'file', name: '签名URL有size.pdf', url: URL_HTTPS, size: '82 KB', note: '通知原文' },
            { kind: 'file', name: '签名URL无size.pdf', url: URL_HTTP },
            { kind: 'file', name: 'data有size.pdf', url: DATA_PDF, size: '128 KB' },
            { kind: 'file', name: 'data无size.pdf', url: DATA_PDF },
            { kind: 'file', name: '暂无附件.pdf' }
          ]
        }];
        const { def, ctx } = await bootPull(C, groups);
        const card = (ctx.data.cards || []).find(function (x) { return x.id === 'g_att'; });
        assert.ok(card, '缺少附件通知卡');
        const files = (card.items || []).filter(function (x) { return x.kind === 'file'; });
        assert.strictEqual(files.length, 5, '5 个 file item 都应在时间线里');
        // URL + it.size：优先 it.size，保留 note 拼接
        assert.strictEqual(files[0].hasUrl, true, 'URL 附件 hasUrl=true');
        assert.strictEqual(files[0].pending, false, 'URL 附件不是「待获取」');
        assert.strictEqual(files[0].meta, '82 KB · 通知原文', 'URL 用 it.size 拼 meta：' + files[0].meta);
        // URL 无 size：不能显示 0 B
        assert.strictEqual(files[1].hasUrl, true);
        assert.strictEqual(files[1].pending, false);
        assert.strictEqual(files[1].meta, '附件', 'URL 无 size 应兜底「附件」而不是 0 B：' + files[1].meta);
        assert.ok(!/0\s*B/.test(files[1].meta), '不得出现 0 B');
        // 旧 data URI：it.size 优先；无 it.size 按 base64 估算（4800 字符 ≈ 3600 B → 4 KB）
        assert.strictEqual(files[2].meta, '128 KB', 'data URI + it.size 保持原口径');
        assert.strictEqual(files[3].meta, '4 KB', 'data URI 无 size 仍按 base64 估算：' + files[3].meta);
        // 无 url：仍「待获取」
        assert.strictEqual(files[4].hasUrl, false);
        assert.strictEqual(files[4].pending, true, '无 url 附件仍是「待获取」');

        // 点击分流：URL → previewFile；无 url → filePending（不弹「待获取」说明给已有 URL 的）
        let previewN = 0, pendingN = 0;
        const tapCtx = Object.assign({}, ctx, {
          previewFile() { previewN++; },
          filePending() { pendingN++; }
        });
        def.fileTap.call(tapCtx, { currentTarget: { dataset: { gid: 'g_att', i: files[0].i } } });
        def.fileTap.call(tapCtx, { currentTarget: { dataset: { gid: 'g_att', i: files[4].i } } });
        assert.strictEqual(previewN, 1, '有 URL 的附件点击应走预览/下载');
        assert.strictEqual(pendingN, 1, '无 URL 的附件点击走待获取说明');
      });

      /* ------------------------------------------------ 1b. lite lazy（2026-11-17 通知轻量化） */
      await T('附件URL 2026-11-17：lite lazy 附件/图片 → 拉完整 body 一次后可用；不缩减入口', async function () {
        const liteGroup = {
          id: 'g_lazy', title: '轻量通知', cat: '教务', actionable: true,
          deadline: '2099-01-01T00:00:00+08:00',
          items: [
            { kind: 'img', src: '', lazy: true, caption: '图' },
            { kind: 'file', name: '附件.pdf', url: '', lazy: true, size: '4 KB' }
          ]
        };
        const fullGroup = {
          id: 'g_lazy', title: '轻量通知', cat: '教务', actionable: true,
          deadline: '2099-01-01T00:00:00+08:00',
          items: [
            { kind: 'img', src: 'data:image/png;base64,' + 'A'.repeat(200), caption: '图' },
            { kind: 'file', name: '附件.pdf', url: DATA_PDF, size: '4 KB' }
          ]
        };
        const liteRows = [autoRow(liteGroup, 0)];
        const fullRows = [autoRow(fullGroup, 0)];
        let fullN = 0;
        const { def, ctx } = await bootPull(C, [liteGroup], function (o) {
          const u = String((o && o.url) || '');
          if (u.indexOf('select=*&id=eq.') >= 0) { fullN++; return o.success({ statusCode: 200, data: fullRows }); }
          if (u.indexOf('class_notices_meta') >= 0 || u.indexOf('/notices') >= 0) return o.success({ statusCode: 200, data: liteRows });
          return o.success({ statusCode: 200, data: [] });
        });
        // 前 AUTO_IMG_CARDS 张自动拉完整 body：第 0 张应拉 1 次
        assert.strictEqual(fullN, 1, '首卡自动拉完整 body 1 次');
        const card = (ctx.data.cards || []).find(function (x) { return x.id === 'g_lazy'; });
        assert.ok(card, 'lite 卡片应渲染');
        const file = (card.items || []).find(function (x) { return x.kind === 'file'; });
        assert.strictEqual(file.hasUrl, true, 'lazy 附件仍显示「预览/下载」');
        assert.strictEqual(file.pending, false, 'lazy 附件不是「待获取」');
        assert.ok((ctx._imgs['g_lazy'] || []).length >= 1, '图片应已落盘');
        const path = await def._filePathOf.call(ctx, 'g_lazy', 1);
        assert.ok(path && String(path).length > 0, '完整 body 到达后附件可打开');
        assert.strictEqual(C.log.writes.length >= 1, true, 'data URI 应写临时文件');
        // 自动路径不循环：已有 _bodyTried 后反复 applyFilter 不再拉 body
        const before = fullN;
        for (let i = 0; i < 5; i++) ctx.applyFilter();
        await sleep(30);
        assert.strictEqual(fullN, before, '自动路径不得重复拉同一 body');
      });

      await T('附件URL 2026-11-17：确实无 url 的附件只自动补拉一次（_bodyTried 负缓存防死循环）', async function () {
        const g = { id: 'g_miss', title: '缺附件', cat: '教务', actionable: true, deadline: '2099-01-01T00:00:00+08:00', items: [{ kind: 'file', name: 'missing.pdf' }] };
        const row = autoRow(g, 0);
        let fullN = 0;
        const { ctx } = await bootPull(C, [g], function (o) {
          const u = String((o && o.url) || '');
          if (u.indexOf('select=*&id=eq.') >= 0) { fullN++; return o.success({ statusCode: 200, data: [row] }); }
          if (u.indexOf('class_notices_meta') >= 0 || u.indexOf('/notices') >= 0) return o.success({ statusCode: 200, data: [row] });
          return o.success({ statusCode: 200, data: [] });
        });
        await sleep(60);
        assert.strictEqual(fullN, 1, '展开时自动补拉 1 次');
        for (let i = 0; i < 8; i++) ctx.applyFilter();
        await sleep(60);
        assert.strictEqual(fullN, 1, '仍无 url 时不得每次重绘都重拉：' + fullN);
        const card = (ctx.data.cards || []).find(function (x) { return x.id === 'g_miss'; });
        const file = (card.items || []).find(function (x) { return x.kind === 'file'; });
        assert.strictEqual(file.pending, true, '无 url 仍显示「待获取」');
      });


      await T('附件URL：压缩包 archive.files[] 的 URL/dataURI 都有 hasUrl/size（外层 URL 也可用）', async function () {
        const groups = [{
          id: 'g_zip', title: '压缩包', cat: '教务', actionable: true,
          deadline: '2099-01-01T00:00:00+08:00',
          items: [{
            kind: 'file', name: '材料.zip', url: URL_HTTPS, size: '1.2 MB', archiveOk: true,
            archive: {
              status: 'ok', count: 3, summary: '含申报表、名单与说明',
              files: [
                { name: '申报表.pdf', size: '82 KB', url: URL_HTTPS },
                { name: '名单.xlsx', size: '', url: URL_HTTP },
                { name: '说明.txt', size: '2 KB' }
              ]
            }
          }]
        }];
        const { ctx } = await bootPull(C, groups);
        const card = (ctx.data.cards || []).find(function (x) { return x.id === 'g_zip'; });
        assert.ok(card, '缺少压缩包通知卡');
        const it = (card.items || [])[0];
        assert.ok(it, '缺少压缩包 item');
        assert.strictEqual(it.hasUrl, true, '外层 zip 是 URL，可预览/下载');
        assert.strictEqual(it.pending, false);
        assert.strictEqual(it.archiveOk, true);
        assert.strictEqual(it.archiveCount, 3);
        assert.ok(/申报表/.test(it.archiveSummary), '包内摘要保留');
        assert.strictEqual(it.archiveFiles.length, 3, '包内文件清单保留');
        assert.strictEqual(it.archiveFiles[0].hasUrl, true, '包内 URL 文件 hasUrl');
        assert.strictEqual(it.archiveFiles[0].size, '82 KB');
        assert.strictEqual(it.archiveFiles[0].extText, 'PDF');
        assert.strictEqual(it.archiveFiles[1].hasUrl, true);
        assert.strictEqual(it.archiveFiles[1].size, '', '包内无 size 留空，不显示 0 B');
        assert.strictEqual(it.archiveFiles[2].hasUrl, false, '仅清单文件 hasUrl=false');
        assert.strictEqual(it.archiveFiles[2].size, '2 KB');
      });

      /* ------------------------------------------------ 3. _filePathOf：双形态取本地路径 */
      await T('附件URL：_filePathOf 双形态（dataURI 落盘 / https+http 下载 / 非200·fail reject / 本地路径直通）', async function () {
        C.clear();
        const def = loadNtPage();
        const g = {
          id: 'g1', items: [
            { kind: 'file', name: 'a.pdf', url: URL_HTTPS },
            { kind: 'file', name: 'b.docx', url: DATA_DOCX },
            { kind: 'file', name: 'c.bin', url: '/tmp/already-local.bin' },
            { kind: 'file', name: 'd.pdf', url: URL_HTTP },
            { kind: 'file', name: 'e.pdf', url: 'data:application/pdf;base64,' }
          ]
        };
        const ctx = { _raw: [g], _rawById: def._rawById, _filePathOf: def._filePathOf };

        // 1) HTTPS 签名 URL → wx.downloadFile → tempFilePath
        const p1 = await def._filePathOf.call(ctx, 'g1', 0);
        assert.strictEqual(p1, '/tmp/wx-download/nt_file.tmp', 'URL 应返回 downloadFile 的 tempFilePath');
        assert.strictEqual(C.log.downloads.length, 1);
        assert.strictEqual(C.log.downloads[0].url, URL_HTTPS, 'downloadFile 必须请求原签名 URL（含 exp/sig）');

        // 2) 旧 data URI → writeDataUri 落盘（带原扩展名）
        const p2 = await def._filePathOf.call(ctx, 'g1', 1);
        assert.ok(/^\/tmp\/user\/nt_.*\.docx$/.test(p2), 'data URI 应落盘并保留扩展名：' + p2);
        assert.strictEqual(C.log.writes.length, 1);
        assert.strictEqual(C.log.writes[0].encoding, 'base64');

        // 3) 非 data/非 http：视为本地路径直通，不下载
        const p3 = await def._filePathOf.call(ctx, 'g1', 2);
        assert.strictEqual(p3, '/tmp/already-local.bin');
        assert.strictEqual(C.log.downloads.length, 1, '本地路径不应触发 downloadFile');

        // 4) http:// 调试形态同样识别为 URL（只判断协议，不写死域名）
        await def._filePathOf.call(ctx, 'g1', 3);
        assert.strictEqual(C.log.downloads.length, 2);
        assert.strictEqual(C.log.downloads[1].url, URL_HTTP);

        // 5) 非 200（签名过期 403）→ reject
        C.setDownload(function (o) { o.success({ statusCode: 403, tempFilePath: '/tmp/bad' }); });
        await assert.rejects(def._filePathOf.call(ctx, 'g1', 0), /http403/, '403 应 reject 而不是当附件打开');
        // 6) 下载 fail → reject（错误信息可读）
        C.setDownload(function (o) { o.fail({ errMsg: 'downloadFile:fail mock' }); });
        await assert.rejects(def._filePathOf.call(ctx, 'g1', 0), /downloadFile:fail mock/);
        // 7) 坏 data URI → reject（不写坏文件）
        await assert.rejects(def._filePathOf.call(ctx, 'g1', 4), /bad-data-uri/);
      });

      /* ------------------------------------------------ 4. previewFile */
      await T('附件URL：previewFile URL→下载→openDocument（fileType 兜底）；图片走 previewImage；失败 toast 不崩', async function () {
        C.clear();
        const def = loadNtPage();
        const g = {
          id: 'g2', items: [
            { kind: 'file', name: '通知.pdf', url: URL_HTTPS },
            { kind: 'file', name: '照片.png', url: URL_HTTPS },
            { kind: 'file', name: '旧附件.docx', url: DATA_DOCX },
            { kind: 'file', name: '动图.webp', url: URL_HTTPS }
          ]
        };
        const ctx = { _raw: [g], _rawById: def._rawById, _filePathOf: def._filePathOf };
        C.setDownload(function (o) { o.success({ statusCode: 200, tempFilePath: '/tmp/wx-download/abc_noext' }); });

        // 1) URL pdf：下载后 openDocument，temp 路径无扩展名 → 必须传 fileType
        def.previewFile.call(ctx, { currentTarget: { dataset: { gid: 'g2', i: 0 } } });
        await sleep(30);
        assert.strictEqual(C.log.opens.length, 1, 'URL 文件应走 openDocument');
        assert.strictEqual(C.log.opens[0].filePath, '/tmp/wx-download/abc_noext');
        assert.strictEqual(C.log.opens[0].fileType, 'pdf', '无扩展名临时文件必须用 fileType 兜底');
        assert.strictEqual(C.log.opens[0].showMenu, false, '预览不显示保存菜单');
        assert.strictEqual(C.log.downloads[0].url, URL_HTTPS);

        // 2) URL 图片文件：预览图片（不 openDocument）
        def.previewFile.call(ctx, { currentTarget: { dataset: { gid: 'g2', i: 1 } } });
        await sleep(30);
        assert.strictEqual(C.log.previews.length, 1, '图片文件应走 previewImage');
        assert.deepStrictEqual(C.log.previews[0].urls, ['/tmp/wx-download/abc_noext']);
        assert.strictEqual(C.log.opens.length, 1, '图片不应走 openDocument');

        // 3) 旧 data URI：落盘后 openDocument（旧流程不变）
        def.previewFile.call(ctx, { currentTarget: { dataset: { gid: 'g2', i: 2 } } });
        await sleep(30);
        assert.strictEqual(C.log.opens.length, 2);
        assert.ok(/^\/tmp\/user\/nt_.*\.docx$/.test(C.log.opens[1].filePath), 'data URI 仍写临时文件');
        assert.strictEqual(C.log.opens[1].fileType, 'docx');

        // 4) URL 图片没有 MIME 可用：按文件名后缀兜底（webp 也应走 previewImage）
        def.previewFile.call(ctx, { currentTarget: { dataset: { gid: 'g2', i: 3 } } });
        await sleep(30);
        assert.strictEqual(C.log.previews.length, 2, 'webp 图片文件 URL 也应预览图片');
        assert.strictEqual(C.log.opens.length, 2, 'webp 图片不应走 openDocument');

        // 4) URL 下载失败（403）→ toast「附件下载失败」，不崩
        C.setDownload(function (o) { o.success({ statusCode: 403, tempFilePath: '/tmp/bad' }); });
        let before = C.log.toasts.length;
        def.previewFile.call(ctx, { currentTarget: { dataset: { gid: 'g2', i: 0 } } });
        await sleep(30);
        assert.ok(C.log.toasts.slice(before).some(function (t) { return /附件下载失败/.test(t); }),
          '下载失败应有 toast：' + JSON.stringify(C.log.toasts));
        // 5) openDocument 打开失败 → toast「该文件暂不支持预览」
        C.setDownload(function (o) { o.success({ statusCode: 200, tempFilePath: '/tmp/ok' }); });
        C.setOpen(function (o) { if (o && o.fail) o.fail({ errMsg: 'openDocument:fail' }); });
        before = C.log.toasts.length;
        def.previewFile.call(ctx, { currentTarget: { dataset: { gid: 'g2', i: 0 } } });
        await sleep(30);
        assert.ok(C.log.toasts.slice(before).some(function (t) { return /暂不支持预览/.test(t); }));
      });

      /* ------------------------------------------------ 5. downloadFile */
      await T('附件URL：downloadFile URL→下载→openDocument(showMenu=true) 提示保存；失败 toast「下载失败」', async function () {
        C.clear();
        const def = loadNtPage();
        const g = { id: 'g3', items: [{ kind: 'file', name: '材料.xlsx', url: URL_HTTPS }] };
        const ctx = { _raw: [g], _rawById: def._rawById, _filePathOf: def._filePathOf };
        C.setDownload(function (o) { o.success({ statusCode: 200, tempFilePath: '/tmp/wx-download/dl_noext' }); });
        C.setOpen(function (o) { if (o && o.success) o.success(); });
        let before = C.log.toasts.length;
        def.downloadFile.call(ctx, { currentTarget: { dataset: { gid: 'g3', i: 0 } } });
        await sleep(30);
        assert.strictEqual(C.log.opens.length, 1);
        assert.strictEqual(C.log.opens[0].showMenu, true, '下载走保存菜单');
        assert.strictEqual(C.log.opens[0].fileType, 'xlsx');
        assert.ok(C.log.toasts.slice(before).some(function (t) { return /保存 \/ 转发/.test(t); }), '提示可在菜单保存');
        // 下载失败 → toast「下载失败」
        C.setDownload(function (o) { o.fail({ errMsg: 'downloadFile:fail' }); });
        before = C.log.toasts.length;
        def.downloadFile.call(ctx, { currentTarget: { dataset: { gid: 'g3', i: 0 } } });
        await sleep(30);
        assert.ok(C.log.toasts.slice(before).some(function (t) { return /下载失败/.test(t); }));
      });

      /* ------------------------------------------------ 6. previewArchiveFile */
      await T('附件URL：previewArchiveFile 包内 URL→下载打开（fileType）；图片→previewImage；仅清单 toast 且不下载', async function () {
        C.clear();
        const def = loadNtPage();
        const g = {
          id: 'g4', items: [{
            kind: 'file', name: '材料.zip', url: URL_HTTPS, archiveOk: true,
            archive: {
              status: 'ok', count: 3,
              files: [
                { name: '申报表.pdf', size: '82 KB', url: URL_HTTPS },
                { name: '照片.jpg', size: '30 KB', url: URL_HTTP },
                { name: '说明.txt', size: '2 KB' }
              ]
            }
          }]
        };
        const ctx = { _raw: [g], _rawById: def._rawById, _archivePathOf: def._archivePathOf };
        C.setDownload(function (o) { o.success({ statusCode: 200, tempFilePath: '/tmp/wx-download/arch_noext' }); });
        C.setOpen(function (o) { if (o && o.success) o.success(); });

        // 包内 pdf URL → 下载 → openDocument(fileType)
        def.previewArchiveFile.call(ctx, { currentTarget: { dataset: { gid: 'g4', i: 0, ai: 0 } } });
        await sleep(30);
        assert.strictEqual(C.log.downloads.length, 1);
        assert.strictEqual(C.log.downloads[0].url, URL_HTTPS, '包内 URL 应原样下载');
        assert.strictEqual(C.log.opens.length, 1);
        assert.strictEqual(C.log.opens[0].fileType, 'pdf');
        assert.strictEqual(C.log.opens[0].showMenu, true);

        // 包内图片 URL → previewImage（下载到临时文件后预览）
        def.previewArchiveFile.call(ctx, { currentTarget: { dataset: { gid: 'g4', i: 0, ai: 1 } } });
        await sleep(30);
        assert.strictEqual(C.log.downloads.length, 2);
        assert.strictEqual(C.log.downloads[1].url, URL_HTTP);
        assert.strictEqual(C.log.previews.length, 1);
        assert.deepStrictEqual(C.log.previews[0].urls, ['/tmp/wx-download/arch_noext']);
        assert.strictEqual(C.log.opens.length, 1, '图片不 openDocument');

        // 仅清单（无 url）：toast 且不下载
        const dBefore = C.log.downloads.length;
        def.previewArchiveFile.call(ctx, { currentTarget: { dataset: { gid: 'g4', i: 0, ai: 2 } } });
        await sleep(20);
        assert.strictEqual(C.log.downloads.length, dBefore, '仅清单文件不应下载');
        assert.ok(C.log.toasts.some(function (t) { return /仅清单/.test(t); }), '仅清单应 toast');

        // 包内 URL 下载失败 → toast「打开失败」，不崩
        C.setDownload(function (o) { o.success({ statusCode: 403, tempFilePath: '/tmp/bad' }); });
        const tBefore = C.log.toasts.length;
        def.previewArchiveFile.call(ctx, { currentTarget: { dataset: { gid: 'g4', i: 0, ai: 0 } } });
        await sleep(30);
        assert.ok(C.log.toasts.slice(tBefore).some(function (t) { return /打开失败/.test(t); }));
      });

      /* ------------------------------------------------ 7. ensureImgs */
      await T('附件URL：ensureImgs dataURI 落盘、https URL 直连 <image src>（不下载），且只转一次', async function () {
        C.clear();
        const def = loadNtPage();
        const g = {
          id: 'g5', items: [
            { kind: 'img', src: 'data:image/png;base64,' + 'QUJD'.repeat(100), caption: '截图' },
            { kind: 'img', src: URL_HTTPS, caption: '网络图' }
          ]
        };
        const patched = {};
        const ctx = {
          _raw: [g], _rawById: def._rawById, _imgs: {}, _loadingImgs: {},
          patchCard(gid, p) { patched[gid] = Object.assign(patched[gid] || {}, p); }
        };
        const imgs = await def.ensureImgs.call(ctx, 'g5');
        assert.strictEqual(imgs.length, 2, '两张图都应加载');
        assert.ok(/^\/tmp\/user\/nt_.*\.jpg$/.test(imgs[0].path), 'data URI 图片仍落盘：' + imgs[0].path);
        assert.strictEqual(imgs[1].path, URL_HTTPS, 'URL 图片直接给 <image src>，不落盘');
        assert.strictEqual(C.log.downloads.length, 0, '图片 URL 不应走 downloadFile');
        assert.strictEqual(C.log.writes.length, 1, '仅 data URI 落盘一次');
        assert.deepStrictEqual(patched['g5'].imgs, imgs, '应回填卡片 imgs');
        // 缓存：同卡片再取不重复转换
        const again = await def.ensureImgs.call(ctx, 'g5');
        assert.strictEqual(again, imgs, 'ensureImgs 应命中缓存');
        assert.strictEqual(C.log.writes.length, 1);
        // 坏 data URI → 过滤掉不崩
        C.clear();
        const bad = { id: 'g6', items: [{ kind: 'img', src: 'data:image/png;base64,' }] };
        const ctx2 = { _raw: [bad], _rawById: def._rawById, _imgs: {}, _loadingImgs: {}, patchCard() {} };
        const none = await def.ensureImgs.call(ctx2, 'g6');
        assert.deepStrictEqual(none, [], '坏 data URI 图片应被过滤而不是抛错');
      });

      /* ------------------------------------------------ 8. 静态接线 / 兼容性护栏 */
      await T('附件URL：静态接线（wxml 入口不变、双分支都在、不写死域名、版本号仍 2.0.0）', function () {
        const wxml = src('pages/nt/nt.wxml');
        const js = src('pages/nt/nt.js');
        // 图片仍是 <image src="{{im.path}}">（URL 形态由 ensureImgs 直接给 https 地址）
        assert.ok(/<image class="nt-img" src="\{\{im\.path\}\}" mode="aspectFill"><\/image>/.test(wxml), '图片入口不变');
        assert.ok(/catchtap="fileTap"/.test(wxml), '附件行点击入口不变');
        assert.ok(/catchtap="previewFile"/.test(wxml) && /catchtap="downloadFile"/.test(wxml), '预览/下载按钮不变');
        // 双形态分支：data URI 分支保留；http(s) 分支走 downloadFile
        assert.ok(/function isHttpUrl\(/.test(js), '新增 isHttpUrl 协议判断');
        assert.ok(/if \(s\.indexOf\('data:'\) === 0\) return writeDataUri\(s, name\)/.test(js), 'tempPathOf 保留 data URI 分支');
        assert.ok(/if \(isHttpUrl\(s\)\) return remoteTempOf\(s\)/.test(js), 'tempPathOf 新增 http(s) 分支');
        assert.ok(/function remoteTempOf\(/.test(js) && /wx\.downloadFile\(\{/.test(js), 'URL 分支走 wx.downloadFile');
        assert.ok(/fileType = ft/.test(js), 'openDocument 用 fileType 兜底无扩展名临时文件');
        assert.ok(/function fileSizeText\(/.test(js) && /if \(isHttpUrl\(src\)\) return given/.test(js),
          'URL 大小用 it.size / 留空，不显示 0 B');
        assert.ok(/function isImageFileOf\(/.test(js), 'URL 形态图片判定用文件名兜底（无 MIME 可用）');
        // 不写死附件域名（契约要求只判断 ^https?://；注释里的示例 URL 不算代码逻辑）
        const codeLines = js.split('\n').filter(function (line) { return !/^\s*(\/\/|\*|\/\*)/.test(line); });
        assert.ok(!codeLines.some(function (line) { return /tool\.furina\.fun/.test(line); }),
          'nt.js 代码不得写死附件域名（注释例外）');
        assert.ok(!codeLines.some(function (line) { return /tool-furina-fun\.oss/.test(line); }),
          'nt.js 不得写死 OSS 域名');
        // 版本号未改、不重新上传发布
        const ver = R('utils/version.js');
        assert.strictEqual(ver.VERSION, '2.0.0', '版本号仍 2.0.0');
      });
    } finally {
      if (prevWx === undefined) { try { delete global.wx; } catch (e) { /* ignore */ } } else global.wx = prevWx;
    }
  })();
}

module.exports = { run: run };

/* 独立运行：node nt_attach_url_tests.js */
if (require.main === module) {
  run().then(function () {
    console.log('\n---------------- ' + passN + ' passed, ' + failN + ' failed ----------------');
    process.exitCode = failN ? 2 : 0;
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}
