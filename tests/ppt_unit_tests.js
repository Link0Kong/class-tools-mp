/* ppt_unit_tests.js —— 「演示」（PPT 演示）专项单测（2026-11-09，随 unit.js 运行，也可独立跑）
 *
 * 契约唯一真源：web/ppt/CONTRACT.md
 *   §3 云端表（deck 字段 / chunk 512KiB / RLS 字段）/ §4 接口 / §5 manifest v1 / §7 动效映射 / §8.1 状态文案
 *
 * 覆盖：
 *   A. URL 解析（http/https/data 直连、相对拼 base）、文件名/标题/大小/时间格式化、文件校验
 *   B. deckId 生成、分片计数/切片区间、§4.1 建行字段（RLS：owner_sid=self、client=mp）、上传百分比
 *   C. manifest 归一化（缺字段/未知字段/坏数据容错、页切换映射、全局媒体表合并、缩略图兜底）
 *   D. step 扁平序列 / 页码换算 / 进度 / 控制条文案 / letterbox 适配矩形 / 热点 px 矩形 / 预加载 / 缩略图
 *   E. 状态文案映射（上传中/排队/转换中/完成/失败/转换机离线）、列表排序与过滤、心跳 180s 离线
 *   F. 上传并发任务池（并发上限/重试/永久失败/取消）、uploadChunks（读文件→base64→发送链路）、
 *      readChunkBase64（wx FS 异步 read 路径）
 *   G. 云端 §4 接口契约（wx.request mock：建行/分片 upsert/列表 select/清单/软删/重试/失败落状态/
 *      取消清理/心跳/轮询/错误文案）
 *   H. 工程静态断言（app.json / tools.js / 图标 / 页面 4 文件 / WXML 事件 / 播放器配置 / VERSION）
 *
 * 说明：纯 Node + 内存 wx mock；不发真实请求、不读写真实云端、不启动模拟器。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { allPages } = require('./_app_pages.js');
const assert = require('assert');

const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');
const ROOT_N = ROOT.replace(/\\/g, '/');
const ID = { token: 'tok-ppt-mp', sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: false, ts: 1 };
const ID2 = { token: 'tok-ppt-guest', sid: '9999000004', name: '测试辛', role: '', badge: '', is_admin: false, ts: 2 };
const SID = ID.sid;

function createCtx() {
  const mem = Object.create(null);
  let reqLog = [];
  let reqImpl = function (o) { o.success({ statusCode: 200, data: [] }); };
  let toastLog = [];
  let navLog = [];
  const wxMock = {
    getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
    setStorageSync(k, v) { mem[k] = v; },
    removeStorageSync(k) { delete mem[k]; },
    getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 0, limitSize: 10240 }; },
    request(o) { reqLog.push(o); reqImpl(o); },
    showToast(o) { toastLog.push(o && o.title); },
    showModal(o) { if (o && o.success) o.success({ confirm: true, cancel: false }); },
    showShareMenu() {}, stopPullDownRefresh() {}, hideLoading() {}, showLoading() {},
    switchTab() {}, reLaunch() {}, navigateTo(o) { navLog.push(String((o && o.url) || '')); },
    navigateBack(o) { navLog.push('back:' + String((o && o.delta) || 1)); },
    getWindowInfo() { return { windowWidth: 390, windowHeight: 844, pixelRatio: 3 }; },
    getSystemInfoSync() { return { windowWidth: 390, windowHeight: 844, SDKVersion: '3.0.0' }; },
    getAppBaseInfo() { return { SDKVersion: '3.0.0', theme: 'light' }; },
    nextTick(fn) { if (fn) fn(); },
    setKeepScreenOn() {},
    createSelectorQuery() {
      return { in() { return this; }, select() { return this; }, selectViewport() { return this; }, boundingClientRect() { return this; }, scrollOffset() { return this; }, fields() { return this; }, exec(cb) { if (cb) cb([{ top: 0 }, { scrollTop: 0 }]); } };
    },
    createVideoContext() { return { play() {}, stop() {}, pause() {} }; },
    createInnerAudioContext() { return { play() {}, stop() {}, destroy() {}, onEnded() {}, onError() {} }; }
  };
  return {
    mem: mem, wxMock: wxMock,
    clearMem() {
      Object.keys(mem).forEach(function (k) { delete mem[k]; });
      reqLog = []; toastLog = []; navLog = [];
      reqImpl = function (o) { o.success({ statusCode: 200, data: [] }); };
    },
    setReq(fn) { reqImpl = fn; },
    reqLog() { return reqLog; },
    navLog() { return navLog; },
    toastLog() { return toastLog; },
    urlsOf(frag) { return reqLog.filter(function (o) { return String((o && o.url) || '').indexOf(frag) >= 0; }); },
    methodsOf(method) { return reqLog.filter(function (o) { return String(o.method || 'GET').toUpperCase() === method; }); },
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
function loadPage(rel) {
  let def = null;
  const file = path.join(ROOT, 'pages', rel + '.js');
  global.Page = function (d) { def = d; };
  try { require(file); } finally { delete global.Page; }
  assert.ok(def && typeof def === 'object', '页面未注册 Page：' + rel);
  return def;
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
const waitFor = async function (fn, timeout) {
  const t0 = Date.now();
  const lim = timeout || 3000;
  while (Date.now() - t0 < lim) {
    if (fn()) return true;
    await sleep(20);
  }
  return !!fn();
};
// 页面级测试：捕获 Page 定义 + 极简 setData 上下文（本模块页面 setData 都是扁平 key）
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

// ---- 测试用 manifest ----
function manifestFixture() {
  return {
    v: 1,
    base: 'https://oss.test/ppt/a/dabc123456/20261109/',
    src: 'https://oss.test/ppt/src/dabc123456/source.pptx',
    w: 1600, h: 900,
    slides: [
      {
        tr: 'fade', trd: 500, notes: '第一页备注', thumb: 't1.webp',
        steps: [
          { img: 's1-1.webp', media: [{ s: 'm0.mp4', k: 'v', x: 0.1, y: 0.2, w: 0.5, h: 0.6 }] },
          { img: 's2-1.webp', media: [] }
        ]
      },
      { tr: 'wipe', trd: 380, notes: '', thumb: '', steps: [{ img: 'https://cdn.test/x.webp' }] }
    ],
    media: [{ s: 'm0.mp4', k: 'v', w: 1280, h: 720, dur: 12.4 }]
  };
}

async function run(test) {
  const prevWx = global.wx;
  const C = createCtx();
  global.wx = C.wxMock;
  const prevFsFactory = C.wxMock.getFileSystemManager;
  const prevB64Factory = C.wxMock.arrayBufferToBase64;
  const prevChooseFile = C.wxMock.chooseMessageFile;
  try {
    /* ============================================================
     * A. URL 解析 / 格式化 / 文件校验
     * ============================================================ */
    await test('PPT-A1 URL 解析：http/https/data 直连；相对路径按 base 拼接（三端一致 §5）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      assert.strictEqual(ppt.isAbsUrl('https://a.test/x.webp'), true);
      assert.strictEqual(ppt.isAbsUrl('http://a.test/x.webp'), true);
      assert.strictEqual(ppt.isAbsUrl('data:image/png;base64,AAA'), true);
      assert.strictEqual(ppt.isAbsUrl('s1-1.webp'), false);
      assert.strictEqual(ppt.joinUrl('https://oss.test/a/b/', 's1-1.webp'), 'https://oss.test/a/b/s1-1.webp');
      assert.strictEqual(ppt.joinUrl('https://oss.test/a/b', 's1-1.webp'), 'https://oss.test/a/b/s1-1.webp', 'base 无尾斜杠自动补');
      assert.strictEqual(ppt.joinUrl('https://oss.test/a/b/', '/abs/s1.webp'), 'https://oss.test/a/b/abs/s1.webp', '相对路径去前导斜杠');
      assert.strictEqual(ppt.joinUrl('https://oss.test/a/b/', 'https://cdn.test/z.webp'), 'https://cdn.test/z.webp', '绝对地址直连');
      assert.strictEqual(ppt.joinUrl('', 's1.webp'), 's1.webp', '无 base 时原样返回');
      assert.strictEqual(ppt.joinUrl('https://oss.test/a/', ''), '', '空路径 → 空串');
      assert.strictEqual(ppt.resolveUrl('https://oss.test/a/', 'media/m0.mp4'), 'https://oss.test/a/media/m0.mp4');
    });

    await test('PPT-A2 展示工具：标题/扩展名/fmtSize/fmtWhen', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      assert.strictEqual(ppt.baseNameOf('C:\\Users\\a\\班会.pptx'), '班会');
      assert.strictEqual(ppt.baseNameOf('/tmp/演示.PPT'), '演示');
      assert.strictEqual(ppt.extOf('a.PPTX'), 'pptx');
      assert.strictEqual(ppt.extOf('noext'), '');
      assert.strictEqual(ppt.trimTitle('  班会 PPT  ', 'x.pptx'), '班会 PPT');
      assert.strictEqual(ppt.trimTitle('', '班会.pptx'), '班会');
      assert.strictEqual(ppt.trimTitle('', ''), '未命名演示');
      assert.strictEqual(ppt.trimTitle('长'.repeat(120), '').length, 80, '标题截断 ≤80 字');
      assert.strictEqual(ppt.fmtSize(512), '512B');
      assert.strictEqual(ppt.fmtSize(2048), '2.0KB');
      assert.strictEqual(ppt.fmtSize(2 * 1024 * 1024), '2.0MB');
      assert.strictEqual(ppt.fmtSize(0), '0B');
      const when = new Date(2026, 10, 9, 8, 5).getTime();
      assert.strictEqual(ppt.fmtWhen(when), '11-09 08:05');
      assert.strictEqual(ppt.fmtWhen(0), '');
    });

    await test('PPT-A3 文件校验：仅 .ppt/.pptx、非空、≤64MiB；fileOf 兼容 path/tempFilePath', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      assert.strictEqual(ppt.validateFile({ name: 'a.pptx', size: 10 }).ok, true);
      assert.strictEqual(ppt.validateFile({ name: 'a.PPT', size: 10 }).ok, true);
      const txt = ppt.validateFile({ name: 'a.txt', size: 10 });
      assert.strictEqual(txt.ok, false);
      assert.ok(/只支持/.test(txt.reason));
      assert.strictEqual(ppt.validateFile({ name: 'a.pptx', size: 0 }).ok, false);
      const big = ppt.validateFile({ name: 'a.pptx', size: 64 * 1024 * 1024 + 1 });
      assert.strictEqual(big.ok, false);
      assert.ok(/64MB/.test(big.reason));
      assert.strictEqual(ppt.validateFile({ name: '', size: 1 }).ok, false);
      const f1 = ppt.fileOf({ path: '/tmp/a.pptx', name: '班会.pptx', size: 100 });
      assert.strictEqual(f1.ok, true);
      assert.strictEqual(f1.path, '/tmp/a.pptx');
      const f2 = ppt.fileOf({ tempFilePath: '/tmp/b.pptx', size: 100 });
      assert.strictEqual(f2.ok, true, '缺 name 时用路径文件名（仍需 .pptx 扩展名）');
      assert.strictEqual(f2.name, 'b.pptx');
    });

    /* ============================================================
     * B. deckId / 分片几何 / §4.1 建行字段
     * ============================================================ */
    await test('PPT-B1 deckId：d + base36(ts) + 6 位随机小写字母数字（§3.1）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const at = 1762700000000;
      const id = ppt.deckId(at);
      assert.ok(/^d[0-9a-z]+$/.test(id), '只有小写字母数字：' + id);
      assert.strictEqual(id.slice(0, 1 + at.toString(36).length), 'd' + at.toString(36), '时间戳 base36 前缀');
      assert.strictEqual(id.length - 1 - at.toString(36).length, 6, '后缀 6 位');
      assert.notStrictEqual(ppt.deckId(), ppt.deckId(), '随机后缀不重复（概率 1/2.1e9，正常不会偶发）');
    });

    await test('PPT-B2 分片计数/区间：512KiB/片，最后一片可小（§3.2）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const K = 512 * 1024;
      assert.strictEqual(ppt.CHUNK_SIZE, K);
      assert.strictEqual(ppt.chunkCount(0), 0);
      assert.strictEqual(ppt.chunkCount(1), 1);
      assert.strictEqual(ppt.chunkCount(K), 1);
      assert.strictEqual(ppt.chunkCount(K + 1), 2);
      assert.strictEqual(ppt.chunkCount(10 * 1024 * 1024), 20);
      assert.strictEqual(ppt.chunkCount(64 * 1024 * 1024), 128, '64MiB 上限 = 128 片');
      assert.strictEqual(ppt.MAX_CHUNKS, 128);
      assert.deepStrictEqual(ppt.chunkRange(K + 100, 0), { offset: 0, length: K });
      assert.deepStrictEqual(ppt.chunkRange(K + 100, 1), { offset: K, length: 100 });
      assert.deepStrictEqual(ppt.chunkRange(K + 100, 9), { offset: 9 * K, length: 0 }, '越界 → 长 0');
    });

    await test('PPT-B3 建行字段（§4.1 + RLS）：owner_sid=self、client=mp、uploading、chunk_count、deleted=false', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const now = 1762700000000;
      const row = ppt.deckRow({ deckId: 'dabc123456xy', title: ' 班会 ', sourceName: '班会.pptx', sourceSize: 600 * 1024, sid: SID, ownerName: '测试账号', now: now });
      assert.strictEqual(row.id, 'dabc123456xy');
      assert.strictEqual(row.title, '班会');
      assert.strictEqual(row.owner_sid, SID, 'RLS：owner_sid 必须=本人 sid');
      assert.strictEqual(row.owner_name, '测试账号');
      assert.strictEqual(row.client, 'mp', '小程序端 = mp');
      assert.strictEqual(row.status, 'uploading');
      assert.strictEqual(row.source_name, '班会.pptx');
      assert.strictEqual(row.source_size, 600 * 1024);
      assert.strictEqual(row.chunk_count, 2);
      assert.strictEqual(row.deleted, false);
      assert.strictEqual(row.created_at, now);
      assert.strictEqual(row.updated_at, now);
      assert.strictEqual(row.aspect, undefined, 'aspect 由转换机写，客户端不猜');
      assert.strictEqual(row.manifest, undefined, 'manifest 由转换机写');
      const row2 = ppt.deckRow({ sourceName: 'x'.repeat(300) + '.pptx', sourceSize: 0, sid: SID });
      assert.strictEqual(row2.title.length, 80, '默认标题=文件名去扩展名，≤80 字');
      assert.strictEqual(row2.chunk_count, 0);
    });

    await test('PPT-B4 上传百分比：done/total 取整并 clamp 0..100', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      assert.strictEqual(ppt.uploadPct(0, 24), 0);
      assert.strictEqual(ppt.uploadPct(12, 24), 50);
      assert.strictEqual(ppt.uploadPct(24, 24), 100);
      assert.strictEqual(ppt.uploadPct(99, 24), 100);
      assert.strictEqual(ppt.uploadPct(5, 0), 0);
      assert.strictEqual(ppt.uploadPct(-3, 10), 0);
    });

    /* ============================================================
     * C. manifest v1 归一化
     * ============================================================ */
    await test('PPT-C1 manifest 归一化：默认值/URL 解析/全局媒体表合并/缩略图兜底（§5）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const m = ppt.normManifest(manifestFixture());
      assert.ok(m);
      assert.strictEqual(m.v, 1);
      assert.strictEqual(m.w, 1600);
      assert.strictEqual(m.h, 900);
      assert.strictEqual(m.base, 'https://oss.test/ppt/a/dabc123456/20261109/');
      assert.strictEqual(m.src, 'https://oss.test/ppt/src/dabc123456/source.pptx');
      assert.strictEqual(m.slides.length, 2);
      assert.strictEqual(m.stepTotal, 3, '扁平 step 总数 = 2 + 1');
      assert.strictEqual(m.slides[0].steps[0].url, m.base + 's1-1.webp', '相对 img 拼 base');
      assert.strictEqual(m.slides[0].thumbUrl, m.base + 't1.webp');
      assert.strictEqual(m.slides[1].steps[0].url, 'https://cdn.test/x.webp', '绝对 img 直连');
      assert.strictEqual(m.slides[1].thumbUrl, 'https://cdn.test/x.webp', 'thumb 缺省用第一步 img');
      const h = m.slides[0].steps[0].media[0];
      assert.strictEqual(h.url, m.base + 'm0.mp4', '热点 s 拼 base');
      assert.strictEqual(h.k, 'v');
      assert.strictEqual(h.dur, 12.4, '全局媒体表 dur 合并');
      assert.strictEqual(h.swappedFrom, undefined);
      assert.deepStrictEqual(m.media, [{ s: 'm0.mp4', k: 'v', w: 1280, h: 720, dur: 12.4 }]);
      assert.deepStrictEqual(m.slides[0].steps[1].media, [], '空 media 保持数组');
    });

    await test('PPT-C2 manifest 容错：缺字段/未知值/坏数据不白屏（§5 兼容）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const raw = {
        base: 'https://oss.test/b/',
        slides: [
          { tr: 'unknown-effect', steps: [{ img: 'a.webp' }] },
          { steps: [{ img: 'b.webp', media: [{ s: 'x.mp4', k: 'weird', x: -1, y: 2, w: 9, h: 0 }] }] }
        ]
      };
      const m = ppt.normManifest(raw);
      assert.ok(m, '缺 notes/thumb/w/h 仍可用');
      assert.strictEqual(m.w, 1600, 'w 默认 1600');
      assert.strictEqual(m.h, 900, 'h 默认 900');
      assert.strictEqual(m.src, '', 'src 缺省空串');
      assert.strictEqual(m.slides[0].tr, 'fade', '未知页切换 → fade');
      assert.strictEqual(m.slides[0].trd, 450, 'trd 缺省 450');
      assert.strictEqual(m.slides[0].notes, '', 'notes 缺省空串');
      const h = m.slides[1].steps[0].media[0];
      assert.strictEqual(h.k, 'v', '未知 k → 视频');
      assert.strictEqual(h.x, 0, '坐标 clamp 0..1');
      assert.strictEqual(h.y, 1);
      assert.strictEqual(h.w, 1);
      assert.strictEqual(h.h, 0);
      assert.strictEqual(ppt.normManifest('{}'), null, '空对象 → null');
      assert.strictEqual(ppt.normManifest(null), null);
      assert.strictEqual(ppt.normManifest('not-json'), null);
      assert.strictEqual(ppt.normManifest({ slides: [] }), null, '无 slide → null');
      assert.strictEqual(ppt.normManifest({ slides: [{ steps: [] }] }), null, '无 step 的页被丢弃 → null');
      const withEmpty = ppt.normManifest({ slides: [{ steps: [{ img: 'a.webp' }] }, { steps: [] }, { steps: [{ img: 'b.webp' }] }] });
      assert.strictEqual(withEmpty.slides.length, 2, '无 step 的页被丢弃、其它页保留');
      assert.ok(ppt.normManifest({ v: 99, slides: [{ steps: [{ img: 'a.webp' }] }] }), '未知 v 忽略');
      assert.strictEqual(ppt.normTransition('Fade'), 'fade', '大小写归一');
      assert.strictEqual(ppt.normTransition(''), 'fade');
      assert.strictEqual(ppt.normTrd(0), 450);
      assert.strictEqual(ppt.normTrd(5000), 2000, 'trd 上限 2000');
      assert.strictEqual(ppt.normTrd(300), 300);
      assert.strictEqual(ppt.normManifest(JSON.stringify(manifestFixture())).slides.length, 2, 'JSON 字符串入参也接受');
    });

    await test('PPT-C3 媒体条目：无 s 丢弃、音频 k=a、w/h/dur 缺省 0', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      assert.strictEqual(ppt.normMedia(null), null);
      assert.strictEqual(ppt.normMedia({ x: 0.1 }), null, '无 s 的热点丢弃');
      assert.strictEqual(ppt.normMedia({ s: 'a.m4a', k: 'a' }).k, 'a');
      assert.deepStrictEqual(ppt.normMediaRow({ s: 'a.mp4' }), { s: 'a.mp4', k: 'v', w: 0, h: 0, dur: 0 });
      assert.strictEqual(ppt.normMediaRow({}), null);
      assert.strictEqual(ppt.normStep(null, ''), null);
      assert.strictEqual(ppt.normStep({ video: 'x' }, ''), null, '无 img 的 step 丢弃');
      assert.strictEqual(ppt.normSlide({ steps: [] }, ''), null);
      assert.strictEqual(ppt.stepCountOf(null), 0);
    });

    /* ============================================================
     * D. step 序列 / 页码换算 / 矩形 / 预加载
     * ============================================================ */
    await test('PPT-D1 扁平 step 序列与页码换算：posOf/advance/pageStart/progressPct/posText', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const m = ppt.normManifest(manifestFixture());
      const flat = ppt.flatSteps(m);
      assert.strictEqual(flat.length, 3);
      assert.deepStrictEqual(flat.map(function (x) { return [x.p, x.s]; }), [[0, 0], [0, 1], [1, 0]]);
      assert.strictEqual(flat[0].url, m.slides[0].steps[0].url);
      assert.strictEqual(ppt.posOf(m, 0, 1), 1);
      assert.strictEqual(ppt.posOf(m, 1, 0), 2);
      assert.strictEqual(ppt.posOf(m, 5, 0), -1);
      assert.strictEqual(ppt.advance(flat, 0, 1), 1);
      assert.strictEqual(ppt.advance(flat, 2, 1), -1, '最后一步再下一步 → -1（边界）');
      assert.strictEqual(ppt.advance(flat, 0, -1), -1, '第一步再上一步 → -1');
      assert.strictEqual(ppt.advance([], 0, 1), -1);
      assert.strictEqual(ppt.pageStart(m, 0), 0);
      assert.strictEqual(ppt.pageStart(m, 1), 2);
      assert.strictEqual(ppt.pageStart(m, 9), -1);
      assert.strictEqual(ppt.progressPct(0, 3), 33.3);
      assert.strictEqual(ppt.progressPct(2, 3), 100);
      assert.strictEqual(ppt.progressPct(0, 0), 0);
      assert.strictEqual(ppt.posText(0, 0, 12, 3), '1/12 · 1/3');
      assert.strictEqual(ppt.posText(11, 2, 12, 3), '12/12 · 3/3');
      assert.strictEqual(ppt.posText(0, 0, 12, 1), '1/12', '单步页只显示页');
      assert.strictEqual(ppt.posText(99, 9, 12, 3), '12/12 · 3/3', '越界 clamp');
    });

    await test('PPT-D2 viewAt：当前帧视图（图片/备注/文案/进度/页切换/热点）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const m = ppt.normManifest(manifestFixture());
      const v = ppt.viewAt(m, 1);
      assert.strictEqual(v.page, 1);
      assert.strictEqual(v.step, 2);
      assert.strictEqual(v.img, m.slides[0].steps[1].url);
      assert.strictEqual(v.notes, '第一页备注');
      assert.strictEqual(v.hasNotes, true);
      assert.strictEqual(v.posText, '1/2 · 2/2');
      assert.strictEqual(v.progressPct, 66.7);
      assert.strictEqual(v.tr, 'fade');
      assert.strictEqual(v.trd, 500);
      assert.deepStrictEqual(v.hotspots, []);
      assert.strictEqual(v.stepTotal, 3);
      assert.strictEqual(v.thumbUrl, m.slides[0].thumbUrl);
      const v2 = ppt.viewAt(m, 99);
      assert.strictEqual(v2.idx, 2, '下标 clamp 到末尾');
      assert.strictEqual(v2.page, 2);
      assert.strictEqual(ppt.viewAt({ slides: [] }, 0), null, '空 manifest → null');
    });

    await test('PPT-D3 fitRect（letterbox contain）/ hotRects（0..1 → px）/ 预加载 / 缩略图', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const portrait = ppt.fitRect(390, 844, 1600, 900);
      assert.deepStrictEqual(portrait, { left: 0, top: 312, width: 390, height: 219 }, '竖屏 16:9 上下黑边（(844-219.375)/2 取整）');
      const landscape = ppt.fitRect(844, 390, 1600, 900);
      assert.deepStrictEqual(landscape, { left: 75, top: 0, width: 693, height: 390 }, '横屏 16:9 左右黑边');
      const fourThree = ppt.fitRect(844, 390, 1600, 1200);
      assert.deepStrictEqual(fourThree, { left: 162, top: 0, width: 520, height: 390 }, '4:3 横屏');
      const rects = ppt.hotRects([{ s: 'm0.mp4', k: 'v', url: 'https://o/m0.mp4', x: 0.1, y: 0.2, w: 0.5, h: 0.6, dur: 3 }],
        { left: 0, top: 0, width: 1000, height: 500 });
      assert.strictEqual(rects[0].left, 100);
      assert.strictEqual(rects[0].top, 100);
      assert.strictEqual(rects[0].width, 500);
      assert.strictEqual(rects[0].height, 300);
      assert.strictEqual(rects[0].url, 'https://o/m0.mp4');
      assert.strictEqual(rects[0].dur, 3);
      const tiny = ppt.hotRects([{ s: 'a', k: 'a', x: 0, y: 0, w: 0, h: 0 }], { left: 0, top: 0, width: 1000, height: 500 });
      assert.ok(tiny[0].width >= 28 && tiny[0].height >= 28, '极小热点保底可点（≥28px）');
      assert.deepStrictEqual(ppt.hotRects(null, null).length, 0);

      const m = ppt.normManifest(manifestFixture());
      const pre = ppt.preloadList(m, 0, 2);
      assert.deepStrictEqual(pre, [m.slides[0].steps[1].url, m.slides[1].steps[0].url], '当前步后 2 张');
      assert.strictEqual(ppt.preloadList(m, 2, 2).length, 0, '末尾无后续');
      assert.strictEqual(ppt.preloadList(m, 0, 1).length, 1);
      const thumbs = ppt.thumbList(m);
      assert.strictEqual(thumbs.length, 2);
      assert.deepStrictEqual(thumbs.map(function (t) { return t.pageNo; }), [1, 2]);
      assert.strictEqual(thumbs[0].url, m.slides[0].thumbUrl);
      assert.strictEqual(thumbs[1].url, m.slides[1].thumbUrl);
      assert.strictEqual(thumbs[0].steps, 2, '第 1 页 2 步（抽屉步指示）');
      assert.deepStrictEqual(thumbs[0].stepArr, [1, 2]);
      assert.strictEqual(thumbs[1].steps, 1);
    });

    await test('PPT-D4 播放器帧细节：页内步点（step≥2 才显示）、预加载计划、热点圆钮、时长角标', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const m = ppt.normManifest(manifestFixture());
      // 页内步点：第 1 页有 2 步 → 2 个点且当前步高亮；第 2 页只有 1 步 → 不显示
      const v0 = ppt.viewAt(m, 0);
      assert.strictEqual(v0.showDots, true);
      assert.deepStrictEqual(v0.dots.map(function (d) { return d.on; }), [true, false]);
      assert.strictEqual(v0.posText, '1/2 · 1/2');
      assert.strictEqual(v0.pageText, '1 / 2');
      const v1 = ppt.viewAt(m, 1);
      assert.deepStrictEqual(v1.dots.map(function (d) { return d.on; }), [false, true]);
      const v2 = ppt.viewAt(m, 2);
      assert.strictEqual(v2.showDots, false, '单步页不显示步点（DESIGN §4.4）');
      // 后退到上一页最后一步：flat 序列 [p0s0, p0s1, p1s0]；从 p1s0 后退 = p0s1
      const flat = ppt.flatSteps(m);
      assert.strictEqual(ppt.advance(flat, 2, -1), 1, 'step=0 后退 → 上一页最后一步（契约 §5 播放语义）');
      // 预加载计划：当前步后 2 张图 + 相邻页缩略图（DESIGN §5.1）
      const plan0 = ppt.preloadPlan(m, 0);
      assert.deepStrictEqual(plan0.steps, [m.slides[0].steps[1].url, m.slides[1].steps[0].url]);
      assert.deepStrictEqual(plan0.thumbs, [m.slides[1].thumbUrl]);
      assert.deepStrictEqual(ppt.preloadPlan(m, 99).steps, [], '末尾无预加载');
      // 热点圆钮：以热点矩形中心定位，48px 圆，视频带「视频 0:12」角标
      const rect = { left: 0, top: 0, width: 1000, height: 500 };
      const btn = ppt.hotButtons([{ s: 'm0.mp4', k: 'v', url: 'https://o/m0.mp4', x: 0.1, y: 0.2, w: 0.5, h: 0.6, dur: 72 }], rect, { size: 48 })[0];
      assert.strictEqual(btn.size, 48);
      assert.strictEqual(btn.left, Math.round(0 + 0.35 * 1000 - 24));
      assert.strictEqual(btn.top, Math.round(0 + 0.5 * 500 - 24));
      assert.strictEqual(btn.badge, '视频 1:12');
      assert.strictEqual(btn.fail, false);
      const audioBtn = ppt.hotButtons([{ s: 'a.m4a', k: 'a', url: 'https://o/a.m4a', x: 0.5, y: 0.5, w: 0.1, h: 0.1 }], rect, { size: 48 })[0];
      assert.strictEqual(audioBtn.badge, '音频');
      assert.strictEqual(audioBtn.size, 32, '音频热点降级成 32px 小喇叭（DESIGN §4.7）');
      const failBtn = ppt.hotButtons([{ s: 'm0.mp4', k: 'v', url: 'u', x: 0, y: 0, w: 1, h: 1 }], rect, { size: 48, failMap: { 'm0.mp4': true } })[0];
      assert.strictEqual(failBtn.fail, true, '失败热点灰化（DESIGN §4.7）');
      assert.strictEqual(ppt.fmtDur(0), '0:00');
      assert.strictEqual(ppt.fmtDur(12.4), '0:12');
      assert.strictEqual(ppt.fmtDur(72), '1:12');
      assert.strictEqual(ppt.fmtDur(600), '10:00');
    });

    /* ============================================================
     * E. 状态文案 / 排序 / 心跳
     * ============================================================ */
    await test('PPT-E1 状态文案映射（§4.4/§8.1）：上传中%/排队/转换中%/完成/失败/未知', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const mine = { id: 'd1', owner_sid: SID, status: 'uploading', source_size: 1024, error: '' };
      const up = ppt.statusView(mine, { sid: SID, up: { deckId: 'd1', done: 5, total: 10 } });
      assert.strictEqual(up.pill, '上传中 50%');
      assert.strictEqual(up.show, true);
      assert.strictEqual(up.playable, false);
      const other = ppt.statusView({ id: 'd2', owner_sid: ID2.sid, status: 'uploading' }, { sid: SID });
      assert.strictEqual(other.show, false, '别人的上传中不显示');
      assert.strictEqual(ppt.statusView({ id: 'd3', owner_sid: SID, status: 'queued' }, { sid: SID }).pill, '排队转换');
      const queuedOff = ppt.statusView({ id: 'd4', owner_sid: SID, status: 'queued' }, { sid: SID, hb: { known: true, online: false } });
      assert.strictEqual(queuedOff.sub, '转换机离线 · 排队中');
      const proc = ppt.statusView({ id: 'd5', owner_sid: SID, status: 'processing', progress: 61 }, { sid: SID });
      assert.strictEqual(proc.pill, '转换中 61%');
      const ready = ppt.statusView({ id: 'd6', owner_sid: SID, status: 'ready' }, { sid: SID });
      assert.strictEqual(ready.playable, true);
      assert.strictEqual(ready.cls, 'ok');
      assert.strictEqual(ready.pill, '', 'DESIGN §4.1：ready 不显示状态胶囊（只显示页数）');
      const failed = ppt.statusView({ id: 'd7', owner_sid: SID, status: 'failed', error: '转换超时' }, { sid: SID });
      assert.strictEqual(failed.pill, '转换失败');
      assert.strictEqual(failed.sub, '转换超时');
      assert.strictEqual(failed.retryable, true);
      const upFailed = ppt.statusView({ id: 'd7b', owner_sid: SID, status: 'failed', error: ppt.UPLOAD_ERR }, { sid: SID });
      assert.strictEqual(upFailed.pill, '上传中断', 'DESIGN §4.2：上传失败胶囊写「上传中断」');
      assert.strictEqual(ppt.statusView({ id: 'd8', owner_sid: ID2.sid, status: 'failed' }, { sid: SID }).retryable, false, '别人的失败不可重试');
      assert.strictEqual(ppt.statusView({ id: 'd9', owner_sid: SID, status: 'weird' }, { sid: SID }).pill, '未知状态');
      // 删除入口：仅本人/管理员（§8.1）
      assert.strictEqual(ppt.statusView({ id: 'a', owner_sid: SID, status: 'ready' }, { sid: SID }).deletable, true);
      assert.strictEqual(ppt.statusView({ id: 'a', owner_sid: ID2.sid, status: 'ready' }, { sid: SID }).deletable, false);
      assert.strictEqual(ppt.statusView({ id: 'a', owner_sid: ID2.sid, status: 'ready' }, { sid: SID, admin: true }).deletable, true);
    });

    await test('PPT-E2 deckView 卡片字段 + sortDecks 本人活跃置顶 + listView 过滤', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const d = { id: 'dA', title: '班会', owner_sid: SID, owner_name: '测试账号', status: 'ready', slide_count: 12, step_count: 12, aspect: '16:9', source_size: 2 * 1024 * 1024, created_at: new Date(2026, 10, 9, 8, 5).getTime() };
      const v = ppt.deckView(d, { sid: SID });
      assert.strictEqual(v.meta, '12 页 · 测试账号（我）', 'DESIGN §4.1：元信息「38 页 · 测试账号」');
      assert.strictEqual(v.ownerIsMe, true);
      assert.strictEqual(v.when, '11-09 08:05');
      assert.strictEqual(v.hasCover, false);
      assert.strictEqual(v.hasPill, false, 'ready 无胶囊');
      assert.strictEqual(v.playable, true);
      const other = ppt.deckView({ id: 'dB', owner_sid: ID2.sid, owner_name: '测试辛', status: 'ready', slide_count: 3 }, { sid: SID });
      assert.strictEqual(other.meta, '3 页 · 测试辛');
      const uploading = ppt.deckView({ id: 'dC', owner_sid: SID, status: 'uploading', title: 'x', source_size: 1048576 }, { sid: SID, up: { deckId: 'dC', done: 3, total: 6 } });
      assert.strictEqual(uploading.uploading, true);
      assert.strictEqual(uploading.upPct, 50, '占位卡片封面进度条');
      assert.strictEqual(uploading.pill, '上传中 50%');
      const uploadingNoUp = ppt.deckView({ id: 'dD', owner_sid: SID, status: 'uploading', title: 'x' }, { sid: SID });
      assert.strictEqual(uploadingNoUp.upPct, 0);
      assert.strictEqual(uploadingNoUp.uploading, false);

      const list = [
        { id: 'old', owner_sid: SID, status: 'ready', created_at: 100 },
        { id: 'otherNew', owner_sid: ID2.sid, status: 'ready', created_at: 400 },
        { id: 'mineQueue', owner_sid: SID, status: 'queued', created_at: 200 },
        { id: 'otherUp', owner_sid: ID2.sid, status: 'uploading', created_at: 500 },
        { id: 'mineProc', owner_sid: SID, status: 'processing', created_at: 300 }
      ];
      assert.deepStrictEqual(ppt.sortDecks(list, SID).map(function (x) { return x.id; }), ['mineProc', 'mineQueue', 'otherUp', 'otherNew', 'old']);
      const rows = ppt.listView(list, { sid: SID });
      assert.strictEqual(rows.filter(function (r) { return r.id === 'otherUp'; }).length, 0, '别人的 uploading 不显示');
      assert.deepStrictEqual(rows.map(function (r) { return r.id; }), ['mineProc', 'mineQueue', 'otherNew', 'old']);
    });

    await test('PPT-E3 转换机心跳：seen_at ≤180s 在线、>180s 离线、坏数据/缺失容错（§3.4）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const now = 1762700000000;
      assert.strictEqual(ppt.HB_OFFLINE_MS, 180000);
      const online = ppt.hbView({ body: { online: true, seen_at: now - 60000, queued: 2, version: '1.0', host: 'pc' }, updated_at: 0 }, now);
      assert.strictEqual(online.known, true);
      assert.strictEqual(online.online, true);
      assert.strictEqual(online.queued, 2);
      assert.strictEqual(online.text, '转换机在线');
      const off = ppt.hbView({ body: { online: true, seen_at: now - 180001 }, updated_at: 0 }, now);
      assert.strictEqual(off.online, false);
      assert.strictEqual(off.text, '转换机离线 · 任务排队中');
      const noSeen = ppt.hbView({ body: { online: true }, updated_at: now - 1000 }, now);
      assert.strictEqual(noSeen.online, true, 'seen_at 缺失时用 updated_at 兜底');
      const jsonBody = ppt.hbView({ body: JSON.stringify({ online: true, seen_at: now - 1000 }), updated_at: 0 }, now);
      assert.strictEqual(jsonBody.online, true, 'body 为 JSON 字符串也接受');
      const bad = ppt.hbView({ body: '{bad json', updated_at: now - 1000 }, now);
      assert.strictEqual(bad.known, true);
      assert.strictEqual(bad.online, false, '坏 body → 离线（不报错）');
      const none = ppt.hbView(null, now);
      assert.strictEqual(none.known, false);
      assert.strictEqual(none.text, '');
      assert.strictEqual(ppt.hbView({ body: { online: false, seen_at: now } }, now).offline, true, 'online=false 直接离线');
    });

    await test('PPT-E4 上传中断识别：重试方式（上传中断→重新上传 / 转换失败→重新排队）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      assert.strictEqual(ppt.UPLOAD_ERR, '上传中断，请重试');
      assert.strictEqual(ppt.isUploadInterrupted('上传中断，请重试'), true);
      assert.strictEqual(ppt.isUploadInterrupted('转换超时'), false);
      assert.strictEqual(ppt.retryMode({ error: '上传中断，请重试' }), 'reupload');
      assert.strictEqual(ppt.retryMode({ error: '转换失败：PowerPoint 崩溃' }), 'queue');
      assert.strictEqual(ppt.retryMode(null), 'queue');
    });

    await test('PPT-E5 错误文案：身份过期/网络/服务端/413 映射中文（不抛异常）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      assert.strictEqual(ppt.reasonOf(new Error('identity-required')), '身份已过期，请重新进入');
      assert.strictEqual(ppt.reasonOf(new Error('cloud-disabled')), '云服务未开启');
      assert.strictEqual(ppt.reasonOf(new Error('http403')), '身份已过期，请重新进入');
      assert.strictEqual(ppt.reasonOf(new Error('http413')), '上传内容过大，请压缩后再试');
      assert.strictEqual(ppt.reasonOf(new Error('http500')), '服务暂时不可用，请稍后重试');
      assert.ok(/网络不可用/.test(ppt.reasonOf({ errMsg: 'request:fail timeout' })));
      assert.ok(/操作失败/.test(ppt.reasonOf(null)));
    });

    /* ============================================================
     * F. 上传并发任务池 / 分片链路 / 读文件
     * ============================================================ */
    await test('PPT-F1 runPool：并发 ≤4、全部完成、进度最终 100%（上传并发调度 mock）', async function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      let inflight = 0, maxInflight = 0, runCount = 0;
      const progress = [];
      const r = await ppt.runPool({
        total: 10, concurrency: 4, retry: 0,
        run: function () {
          runCount += 1;
          inflight += 1;
          maxInflight = Math.max(maxInflight, inflight);
          return sleep(5).then(function () { inflight -= 1; });
        },
        onProgress: function (done, total) { progress.push([done, total]); },
        sleep: function () { return Promise.resolve(); }
      });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.done, 10);
      assert.strictEqual(runCount, 10);
      assert.ok(maxInflight <= 4, '并发上限 4，实际 ' + maxInflight);
      assert.ok(maxInflight >= 2, '确实并行');
      assert.deepStrictEqual(progress[progress.length - 1], [10, 10], '最后一次进度 = 全部完成');
    });

    await test('PPT-F2 runPool：单片失败重试 2 次（共 3 次）后成功；永久失败返回 error 且不挂起', async function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      let attempt = 0;
      const ok = await ppt.runPool({
        total: 1, concurrency: 1, retry: 2, backoff: [1, 1],
        run: function () { attempt += 1; return attempt <= 2 ? Promise.reject(new Error('http500')) : Promise.resolve(); },
        sleep: function () { return Promise.resolve(); }
      });
      assert.strictEqual(ok.ok, true);
      assert.strictEqual(attempt, 3, '失败 2 次后第 3 次成功（重试 2 次）');
      let failAttempt = 0;
      const bad = await ppt.runPool({
        total: 1, concurrency: 1, retry: 2, backoff: [1, 1],
        run: function () { failAttempt += 1; return Promise.reject(new Error('http500')); },
        sleep: function () { return Promise.resolve(); }
      });
      assert.strictEqual(bad.ok, false);
      assert.strictEqual(failAttempt, 3);
      assert.ok(bad.error && /http500/.test(String(bad.error.message || bad.error)));
    });

    await test('PPT-F3 runPool：取消后停止派发、不挂起、已完成的 done 计数正确', async function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      let cancelled = false, runCount = 0;
      const p = ppt.runPool({
        total: 20, concurrency: 4, retry: 0,
        run: function () {
          runCount += 1;
          if (runCount >= 2) cancelled = true;         // 第 2 片开始后用户点「取消」
          return sleep(3);
        },
        isCancelled: function () { return cancelled; },
        sleep: function () { return Promise.resolve(); }
      });
      const r = await p;
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.cancelled, true);
      assert.ok(runCount < 20, '取消后不再派发剩余任务，实际执行 ' + runCount);
      assert.ok(r.done >= 0);
      // 空任务池（size=0）→ 立即成功
      const empty = await ppt.runPool({ total: 0 });
      assert.strictEqual(empty.ok, true);
      assert.strictEqual(empty.done, 0);
    });

    await test('PPT-F4 uploadChunks：读文件按 offset/length → base64 → 逐片发送（尺寸/序号/进度/mock）', async function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const size = 512 * 1024 + 1024;          // 2 片：512KiB + 1KiB
      const sent = [];
      const reads = [];
      const progress = [];
      const r = await ppt.uploadChunks({
        deckId: 'dabc123456xy', ownerSid: SID, size: size, path: '/tmp/a.pptx',
        readChunk: function (p, offset, length) {
          reads.push({ path: p, offset: offset, length: length });
          return Promise.resolve(Buffer.alloc(length, offset % 256).toString('base64'));
        },
        send: function (payload) {
          sent.push(payload);
          return Promise.resolve();
        },
        onProgress: function (done, total) { progress.push([done, total]); },
        sleep: function () { return Promise.resolve(); }
      });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.done, 2);
      assert.deepStrictEqual(reads.map(function (x) { return [x.offset, x.length]; }), [[0, 512 * 1024], [512 * 1024, 1024]]);
      assert.strictEqual(sent.length, 2);
      const byIdx = sent.slice().sort(function (a, b) { return a.idx - b.idx; });
      assert.deepStrictEqual(byIdx.map(function (x) { return x.idx; }), [0, 1]);
      assert.strictEqual(byIdx[0].deckId, 'dabc123456xy');
      assert.strictEqual(byIdx[0].ownerSid, SID);
      assert.strictEqual(Buffer.from(byIdx[0].base64, 'base64').length, 512 * 1024, '第 0 片 base64 解码 = 512KiB');
      assert.strictEqual(Buffer.from(byIdx[1].base64, 'base64').length, 1024, '最后一片可小');
      assert.deepStrictEqual(progress[progress.length - 1], [2, 2]);
      // 发送失败 → 整体失败（页面据此 markUploadFailed）
      const bad = await ppt.uploadChunks({
        deckId: 'd', ownerSid: SID, size: 1024, path: '/tmp/a.pptx',
        readChunk: function () { return Promise.resolve('AAAA'); },
        send: function () { return Promise.reject(new Error('http500')); },
        retry: 1, backoff: [1], sleep: function () { return Promise.resolve(); }
      });
      assert.strictEqual(bad.ok, false);
    });

    await test('PPT-F5 pickChunkBuffer：readFile 分段/旧库整文件切片/长度不足 → null', async function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const mk = function (n) { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = i % 256; return b.buffer; };
      // 新库 readFile 已按 position/length 返回（长度正好 = length）
      const exact = ppt.pickChunkBuffer(mk(8), 1024, 8);
      assert.deepStrictEqual(Array.prototype.slice.call(new Uint8Array(exact)), [0, 1, 2, 3, 4, 5, 6, 7]);
      // 旧库忽略 position/length，返回整文件 → 自己切片
      const sliced = ppt.pickChunkBuffer(mk(64), 16, 8);
      assert.deepStrictEqual(Array.prototype.slice.call(new Uint8Array(sliced)), [16, 17, 18, 19, 20, 21, 22, 23]);
      // 数据不足本片 → null
      assert.strictEqual(ppt.pickChunkBuffer(mk(10), 8, 8), null);
      assert.strictEqual(ppt.pickChunkBuffer(null, 0, 8), null);
    });

    await test('PPT-F5b readChunkBase64：优先 readFile(position,length)（基础库 3.x openSync 旧签名已不可用）', async function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const prevFs = C.wxMock.getFileSystemManager;
      const prevB64 = C.wxMock.arrayBufferToBase64;
      let readFileArgs = null;
      let openCalled = false;
      C.wxMock.getFileSystemManager = function () {
        return {
          readFile: function (o) {
            readFileArgs = { filePath: o.filePath, position: o.position, length: o.length };
            const u8 = new Uint8Array(o.length);
            for (let i = 0; i < u8.length; i++) u8[i] = (o.position + i) % 256;
            o.success({ data: u8.buffer });
          },
          openSync: function () { openCalled = true; throw new Error('should-not-call'); }
        };
      };
      C.wxMock.arrayBufferToBase64 = function (buf) { return Buffer.from(new Uint8Array(buf)).toString('base64'); };
      try {
        const b64 = await ppt.readChunkBase64('/tmp/new-lib.pptx', 1024, 8);
        assert.deepStrictEqual(readFileArgs, { filePath: '/tmp/new-lib.pptx', position: 1024, length: 8 });
        assert.deepStrictEqual(Array.prototype.slice.call(Buffer.from(b64, 'base64')), [0, 1, 2, 3, 4, 5, 6, 7]);
        assert.strictEqual(openCalled, false, '优先 readFile，不应走 openSync');
        // 旧基础库忽略 position/length（返回整文件）→ pickChunkBuffer 切片
        C.wxMock.getFileSystemManager = function () {
          return {
            readFile: function (o) {
              const whole = new Uint8Array(64);
              for (let i = 0; i < 64; i++) whole[i] = i;
              o.success({ data: whole.buffer });
            }
          };
        };
        const b642 = await ppt.readChunkBase64('/tmp/old-lib.pptx', 16, 8);
        assert.deepStrictEqual(Array.prototype.slice.call(Buffer.from(b642, 'base64')), [16, 17, 18, 19, 20, 21, 22, 23]);
      } finally {
        C.wxMock.getFileSystemManager = prevFs;
        C.wxMock.arrayBufferToBase64 = prevB64;
      }
    });

    await test('PPT-F5c readChunkBase64：readFile 失败 → openSync(对象签名/旧签名)回退 + closeSync；全失败 reject file-read', async function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const prevFs = C.wxMock.getFileSystemManager;
      const prevB64 = C.wxMock.arrayBufferToBase64;
      let closed = 0;
      const makeFs = function (openImpl) {
        return {
          readFile: function (o) { o.fail({ errMsg: 'readFile:fail' }); },
          openSync: openImpl,
          closeSync: function () { closed += 1; },
          read: function (o) {
            const u8 = new Uint8Array(o.arrayBuffer);
            for (let i = 0; i < u8.length; i++) u8[i] = (o.position + i) % 256;
            o.success({ bytesRead: u8.length });
          }
        };
      };
      C.wxMock.arrayBufferToBase64 = function (buf) { return Buffer.from(new Uint8Array(buf)).toString('base64'); };
      try {
        // 新对象签名 openSync({filePath,flag}) 回退路径
        let objArg = null;
        C.wxMock.getFileSystemManager = function () {
          return makeFs(function (arg) {
            if (typeof arg === 'object' && arg) { objArg = arg; return 'fd-obj'; }
            throw new Error('legacy-not-expected');
          });
        };
        const b64 = await ppt.readChunkBase64('/tmp/a.pptx', 1024, 8);
        assert.deepStrictEqual(objArg, { filePath: '/tmp/a.pptx', flag: 'r' }, '新基础库用对象签名');
        assert.deepStrictEqual(Array.prototype.slice.call(Buffer.from(b64, 'base64')), [0, 1, 2, 3, 4, 5, 6, 7]);
        assert.strictEqual(closed, 1, '读完必须 closeSync');
        // 只有旧字符串签名可用时也能回退
        let oldArg = null;
        C.wxMock.getFileSystemManager = function () {
          return makeFs(function (arg) {
            if (typeof arg === 'string') { oldArg = arg; return 'fd-old'; }
            throw new Error('object-not-supported');
          });
        };
        await ppt.readChunkBase64('/tmp/b.pptx', 0, 4);
        assert.strictEqual(oldArg, '/tmp/b.pptx', '旧基础库回退字符串签名');
        // 全部失败 → file-read（页面提示「文件读取失败」）
        C.wxMock.getFileSystemManager = function () {
          return { readFile: function (o) { o.fail({}); }, openSync: function () { throw new Error('denied'); } };
        };
        let err = null;
        try { await ppt.readChunkBase64('/tmp/c.pptx', 0, 4); } catch (e) { err = e; }
        assert.ok(err && /file-read/.test(String(err.message)));
      } finally {
        C.wxMock.getFileSystemManager = prevFs;
        C.wxMock.arrayBufferToBase64 = prevB64;
      }
    });

    /* ============================================================
     * G. 云端接口契约（§4；wx.request mock）
     * ============================================================ */
    await test('PPT-G1 createDeck：POST /ppt_decks（return=representation），body=§4.1 建行字段', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const cloud = R('utils/cloud.js');
      enableCloud(cloud);
      const ppt = R('pages/ppt/utils/ppt.js');
      C.setReq(function (o) {
        assert.strictEqual(String(o.method).toUpperCase(), 'POST');
        assert.ok(String(o.url).indexOf('/ppt_decks') >= 0, o.url);
        const rows = o.data;
        assert.ok(Array.isArray(rows) && rows.length === 1);
        assert.strictEqual(rows[0].owner_sid, SID);
        assert.strictEqual(rows[0].client, 'mp');
        assert.strictEqual(rows[0].status, 'uploading');
        assert.strictEqual(rows[0].chunk_count, 2);
        assert.ok(String((o.header || {}).Prefer || '').indexOf('return=representation') >= 0);
        assert.ok(String((o.header || {}).Authorization || '').indexOf('Bearer pk-test') >= 0, '带 publishableKey');
        assert.strictEqual(o.header['X-Class-Token'], ID.token, '带班级身份头');
        o.success({ statusCode: 201, data: rows });
      });
      const r = await ppt.createDeck({ title: '班会', sourceName: '班会.pptx', sourceSize: 600 * 1024 });
      assert.strictEqual(r.ok, true);
      assert.ok(/^d[0-9a-z]+$/.test(r.deckId));
      assert.strictEqual(r.chunkCount, 2);
      // 403 → 中文提示（身份过期）
      C.clearMem(); C.setIdentity(ID);
      purge(); R('utils/store.js');
      const cloud2 = R('utils/cloud.js'); enableCloud(cloud2);
      const ppt2 = R('pages/ppt/utils/ppt.js');
      C.setReq(function (o) { o.success({ statusCode: 403, data: { message: 'denied' } }); });
      const bad = await ppt2.createDeck({ sourceName: 'a.pptx', sourceSize: 10 });
      assert.strictEqual(bad.ok, false);
      assert.strictEqual(bad.reason, '身份已过期，请重新进入');
    });

    await test('PPT-G2 sendChunk：POST /ppt_upload_chunks upsert（merge-duplicates,return=minimal）+ base64 行', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const cloud = R('utils/cloud.js');
      enableCloud(cloud);
      const ppt = R('pages/ppt/utils/ppt.js');
      let seen = null;
      C.setReq(function (o) {
        seen = o;
        o.success({ statusCode: 201, data: null });
      });
      await ppt.sendChunk({ deckId: 'dabc123456xy', ownerSid: SID, idx: 3, base64: 'QUJD' });
      assert.ok(String(seen.url).indexOf('/ppt_upload_chunks') >= 0);
      assert.ok(String(seen.header.Prefer).indexOf('resolution=merge-duplicates') >= 0);
      assert.ok(String(seen.header.Prefer).indexOf('return=minimal') >= 0);
      assert.deepStrictEqual(seen.data, [{ deck_id: 'dabc123456xy', owner_sid: SID, idx: 3, data: 'QUJD', ts: seen.data[0].ts }]);
      assert.ok(seen.data[0].ts > 0);
    });

    await test('PPT-G3 listDecks：GET 轻字段（无 manifest）、deleted=eq.false、order/limit 契约', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const cloud = R('utils/cloud.js');
      enableCloud(cloud);
      const ppt = R('pages/ppt/utils/ppt.js');
      let url = '';
      C.setReq(function (o) {
        url = String(o.url);
        o.success({ statusCode: 200, data: [{ id: 'd1', title: 'a', status: 'ready' }] });
      });
      const r = await ppt.listDecks();
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.list.length, 1);
      assert.ok(url.indexOf('select=id,title,owner_sid,owner_name,status,progress,error,slide_count,step_count,aspect,cover_url,source_name,source_size,created_at,converted_at,client') >= 0);
      assert.ok(url.indexOf('manifest') < 0, '列表禁止带 manifest（§4.4）');
      assert.ok(url.indexOf('deleted=eq.false') >= 0);
      assert.ok(url.indexOf('order=created_at.desc') >= 0);
      assert.ok(url.indexOf('limit=100') >= 0);
      // 网络失败 → {ok:false, reason}
      C.setReq(function (o) { o.fail({ errMsg: 'request:fail timeout' }); });
      const bad = await ppt.listDecks();
      assert.strictEqual(bad.ok, false);
      assert.strictEqual(bad.list.length, 0);
      assert.ok(/网络不可用/.test(bad.reason));
    });

    await test('PPT-G4 getManifest：清单归一化；空 manifest→「还没转换完成」；无行→「演示不存在或已删除」', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const cloud = R('utils/cloud.js');
      enableCloud(cloud);
      const ppt = R('pages/ppt/utils/ppt.js');
      let url = '';
      C.setReq(function (o) {
        url = String(o.url);
        o.success({ statusCode: 200, data: [{ title: '班会', manifest: manifestFixture(), slide_count: 3 }] });
      });
      const r = await ppt.getManifest('dabc123456xy');
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.manifest.stepTotal, 3);
      assert.strictEqual(r.deck.title, '班会');
      assert.ok(url.indexOf('/ppt_decks?select=manifest,title,slide_count,step_count,aspect,cover_url,source_name,source_key,converted_at') >= 0);
      assert.ok(url.indexOf('id=eq.dabc123456xy') >= 0);
      // manifest 为字符串 JSON（云端 jsonb 可能回对象，也可能回字符串）
      C.setReq(function (o) { o.success({ statusCode: 200, data: [{ title: 'x', manifest: JSON.stringify(manifestFixture()) }] }); });
      assert.strictEqual((await ppt.getManifest('d2')).ok, true, 'manifest 字符串也接受');
      // 空/未转换
      C.setReq(function (o) { o.success({ statusCode: 200, data: [{ title: 'x', manifest: {} }] }); });
      const pending = await ppt.getManifest('d3');
      assert.strictEqual(pending.ok, false);
      assert.strictEqual(pending.reason, '还没转换完成');
      // 无行
      C.setReq(function (o) { o.success({ statusCode: 200, data: [] }); });
      const missing = await ppt.getManifest('d4');
      assert.strictEqual(missing.ok, false);
      assert.strictEqual(missing.reason, '演示不存在或已删除');
    });

    await test('PPT-G5 patchDeck 系列（§4.3/§4.6）：submit=queued、softDelete=deleted、retry=queued+progress0、失败落状态', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const cloud = R('utils/cloud.js');
      enableCloud(cloud);
      const ppt = R('pages/ppt/utils/ppt.js');
      const posts = [];
      C.setReq(function (o) {
        const m = String(o.method || 'GET').toUpperCase();
        if (m === 'GET') return o.success({ statusCode: 200, data: [{ id: 'dabc123456xy', title: 'x', owner_sid: SID }] });
        posts.push(o);
        return o.success({ statusCode: 201, data: o.data });
      });
      const sub = await ppt.submitDeck('dabc123456xy', 1024, 1);
      assert.strictEqual(sub.ok, true);
      let row = posts[posts.length - 1].data[0];
      assert.strictEqual(row.status, 'queued');
      assert.strictEqual(row.chunk_count, 1);
      assert.strictEqual(row.source_size, 1024);
      assert.strictEqual(row.progress, 0);
      assert.strictEqual(row.error, '');
      assert.ok(row.updated_at > 0);
      await ppt.softDelete('dabc123456xy');
      row = posts[posts.length - 1].data[0];
      assert.strictEqual(row.deleted, true);
      await ppt.retryDeck('dabc123456xy');
      row = posts[posts.length - 1].data[0];
      assert.strictEqual(row.status, 'queued');
      assert.strictEqual(row.progress, 0);
      assert.strictEqual(row.error, '');
      await ppt.markUploadFailed('dabc123456xy', '网络中断');
      row = posts[posts.length - 1].data[0];
      assert.strictEqual(row.status, 'failed');
      assert.strictEqual(row.error, '网络中断');
    });

    await test('PPT-G6 取消上传：DELETE 分片（本人可删）+ 软删 deck（§8.1 取消即软删；Lead 要求清理分片）', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const cloud = R('utils/cloud.js');
      enableCloud(cloud);
      const ppt = R('pages/ppt/utils/ppt.js');
      const ms = [];
      C.setReq(function (o) {
        const m = String(o.method || 'GET').toUpperCase();
        ms.push(m + ' ' + String(o.url));
        if (m === 'GET') return o.success({ statusCode: 200, data: [{ id: 'dabc123456xy', owner_sid: SID, title: 'x' }] });
        return o.success({ statusCode: 201, data: o.data });
      });
      const r = await ppt.cancelUpload('dabc123456xy');
      assert.strictEqual(r.ok, true);
      assert.ok(ms.some(function (x) { return x.indexOf('DELETE') === 0 && x.indexOf('/ppt_upload_chunks?deck_id=eq.dabc123456xy') >= 0; }), '应 DELETE 本人的分片：' + JSON.stringify(ms));
      const post = C.methodsOf('POST').pop();
      assert.strictEqual(post.data[0].deleted, true, '取消 → 软删 deck');
      // 上传失败落状态时同样清理分片（避免数据库残留）
      ms.length = 0;
      await ppt.markUploadFailed('dabc123456xy', ppt.UPLOAD_ERR);
      assert.ok(ms.some(function (x) { return x.indexOf('DELETE') === 0; }), '失败时清理分片');
      const failedPost = C.methodsOf('POST').pop();
      assert.strictEqual(failedPost.data[0].status, 'failed');
      assert.strictEqual(failedPost.data[0].error, ppt.UPLOAD_ERR);
    });

    await test('PPT-G7 心跳与轮询：GET site_assets?id=eq.ppt_agent（同轮拉列表+心跳 §4.7）', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const cloud = R('utils/cloud.js');
      enableCloud(cloud);
      const ppt = R('pages/ppt/utils/ppt.js');
      const seen = [];
      C.setReq(function (o) {
        const u = String(o.url);
        seen.push(u);
        if (u.indexOf('/site_assets?') >= 0) return o.success({ statusCode: 200, data: [{ body: { online: true, seen_at: Date.now() - 1000, queued: 1 }, updated_at: '2026-11-09T00:00:00Z' }] });
        return o.success({ statusCode: 200, data: [{ id: 'd1', status: 'queued', owner_sid: SID, created_at: 1 }] });
      });
      const hb = await ppt.heartbeat();
      assert.strictEqual(hb.ok, true);
      assert.strictEqual(hb.hb.online, true);
      assert.ok(seen[seen.length - 1].indexOf('/site_assets?select=body,updated_at&id=eq.ppt_agent') >= 0);
      seen.length = 0;
      const round = await ppt.pollRound();
      assert.strictEqual(round.ok, true);
      assert.strictEqual(round.hbOk, true);
      assert.strictEqual(round.list.length, 1);
      assert.strictEqual(round.hb.queued, 1);
      assert.strictEqual(seen.length, 2, '同一轮 = 列表 + 心跳 2 个请求');
      // 心跳行缺失 → known:false（不报错）
      C.clearMem(); C.setIdentity(ID);
      purge(); R('utils/store.js');
      const cloud2 = R('utils/cloud.js'); enableCloud(cloud2);
      const ppt2 = R('pages/ppt/utils/ppt.js');
      C.setReq(function (o) { o.success({ statusCode: 200, data: [] }); });
      const hb2 = await ppt2.heartbeat();
      assert.strictEqual(hb2.ok, true);
      assert.strictEqual(hb2.hb.known, false);
    });

    /* ============================================================
     * H. 工程静态断言（页面/注册/图标/配置/share）
     * ============================================================ */
    await test('PPT-H1 工程：app.json 注册 2 页（不加 tabBar）、tools.js「演示」、图标存在且媒体预算内', function () {
      purge();
      const app = JSON.parse(src('app.json'));
      assert.ok(allPages(app).indexOf('pages/ppt/ppt') >= 0, 'app.json 注册 pages/ppt/ppt（分包）');
      assert.ok(allPages(app).indexOf('pages/ppt/pptplay/pptplay') >= 0, 'app.json 注册 pages/ppt/pptplay/pptplay（分包）');
      assert.strictEqual(app.tabBar.list.length, 3, '不新增 tabBar');
      const tools = R('utils/tools.js');
      const t = tools.toolOf('ppt');
      assert.ok(t, '工具目录应有 ppt');
      assert.strictEqual(t.name, '演示');
      assert.strictEqual(t.url, '/pages/ppt/ppt');
      assert.strictEqual(!!t.noHome, false, '演示可被主动勾选进首页（≤4）');
      assert.ok(t.icoImg === '/images/tool-ppt.png', '图标路径');
      assert.ok(fs.existsSync(path.join(ROOT, 'images/tool-ppt.png')), '图标文件存在');
      assert.ok(fs.statSync(path.join(ROOT, 'images/tool-ppt.png')).size <= 2048, '图标 ≤2KB（与其它工具图标一致）');
      const media = (function walk(d) { let n = 0; fs.readdirSync(d).forEach(function (x) { const p = path.join(d, x); if (fs.statSync(p).isDirectory()) n += walk(p); else n += fs.statSync(p).size; }); return n; })(path.join(ROOT, 'images'));
      assert.ok(media <= 200 * 1024, '媒体预算硬线 200KB，实际 ' + media + 'B');
      assert.ok(/VERSION = '2\.0\.4'/.test(src('utils/version.js')), '版本号为 2.0.4');
    });

    await test('PPT-H2 工程：两页 4 文件 + 分享 handler；列表封面 webp + 空态唯一小字；播放器 custom/auto/disableScroll', function () {
      purge();
      ['pages/ppt/ppt', 'pages/ppt/pptplay/pptplay'].forEach(function (p) {
        ['.js', '.wxml', '.wxss', '.json'].forEach(function (ext) {
          assert.ok(fs.existsSync(path.join(ROOT, p + ext)), '缺少 ' + p + ext);
        });
        const js = src(p + '.js');
        ['onShareAppMessage', 'onShareTimeline', 'share.enable()', "utils/share.js"].forEach(function (k) {
          assert.ok(js.indexOf(k) >= 0, p + ' 缺少 ' + k);
        });
        const json = JSON.parse(src(p + '.json'));
        assert.ok(json.navigationBarTitleText, p + ' 缺少标题');
      });
      const play = JSON.parse(src('pages/ppt/pptplay/pptplay.json'));
      assert.strictEqual(play.navigationStyle, 'custom', '播放器自定义导航（全屏舞台）');
      assert.strictEqual(play.pageOrientation, 'auto', '播放器允许横屏');
      assert.strictEqual(play.disableScroll, true, '播放器禁页面滚动（手势用于切页）');
      const listJson = JSON.parse(src('pages/ppt/ppt.json'));
      assert.strictEqual(listJson.enablePullDownRefresh, true, '列表页支持下拉刷新');

      // DESIGN §3.2 硬前置：<image> 必须 webp="{{true}}"，否则真机 .webp 全白
      const listWxml = src('pages/ppt/ppt.wxml');
      const playWxml = src('pages/ppt/pptplay/pptplay.wxml');
      assert.ok(/webp="\{\{true\}\}"/.test(listWxml), '列表封面 image 必须带 webp 属性（真机 .webp）');
      assert.ok((playWxml.match(/webp="\{\{true\}\}"/g) || []).length >= 2, '播放器主图与缩略图都必须带 webp 属性');
      // DESIGN §4.2：小程序唯一上传入口 = 聊天记录；空态一行小字是唯一允许的说明
      assert.ok(listWxml.indexOf('从聊天选择') >= 0 && listWxml.indexOf('先把 .pptx 发到聊天') >= 0, '空态按钮「从聊天选择」+ 唯一一行小字');
      assert.ok(listWxml.indexOf('还没有演示文件') >= 0, '空态文案');
      assert.ok(/extension: \['ppt', 'pptx'\]/.test(src('pages/ppt/ppt.js')), '只能从聊天记录选 .ppt/.pptx');
    });

    await test('PPT-H3 工程：列表页上传/占位/10s 可见轮询/取消清理/删除重试/长按更多/状态胶囊', function () {
      purge();
      const listJs = src('pages/ppt/ppt.js');
      const listWxml = src('pages/ppt/ppt.wxml');
      assert.ok(/chooseMessageFile/.test(listJs), '选文件入口');
      assert.ok(/uploadChunks/.test(listJs) && /uploadChunks|readChunkBase64/.test(src('pages/ppt/utils/ppt.js')) && /readChunkBase64|getFileSystemManager/.test(src('pages/ppt/utils/ppt.js')), '分片读取/上传链路');
      assert.ok(/POLL_MS = 10000/.test(listJs), '可见时 10s 轮询');
      assert.ok(/onHide\(\)/.test(listJs) && /_stopPoll/.test(listJs), '隐藏停止轮询');
      assert.ok(/_startPoll/.test(listJs) && /onShow\(\)/.test(listJs), 'onShow 立即拉取 + 启动轮询');
      assert.ok(/onPullDownRefresh/.test(listJs), '下拉刷新强拉');
      assert.ok(/cancelUpload/.test(listJs) && /softDelete/.test(listJs) && /retryDeck/.test(listJs) && /markUploadFailed/.test(listJs), '取消（软删+清分片）/删除/失败重试');
      assert.ok(/ppt\.listView/.test(listJs) && /pollRound|heartbeat/.test(listJs), '列表视图 + 心跳同轮');
      assert.ok(/self\.load\(true\)/.test(listJs), '建行后立刻刷新（占位先行 A1）');
      assert.ok(/showActionSheet/.test(listJs) && /重命名/.test(listJs) && /下载原件/.test(listJs), '长按/⋯ 更多菜单：重命名 / 下载原件 / 删除');
      assert.ok(/cancelTap/.test(listJs) && /wx\.showModal/.test(listJs), '取消二次确认');
      assert.ok(/uploadTap/.test(listWxml) && /ppt-cover-up/.test(listWxml), '上传主按钮 + 占位封面进度条');
      assert.ok(/ppt-pill/.test(listWxml) && /item\.hasPill/.test(listWxml), '状态胶囊（ready 由 hasPill 隐藏）');
    });

    await test('PPT-H4 工程：播放器（step 语义/媒体层生命周期/自动隐藏/步点/黑屏/转场/缩略图/备注/预加载/失败降级/释放）', function () {
      purge();
      const playJs = src('pages/ppt/pptplay/pptplay.js');
      const playWxml = src('pages/ppt/pptplay/pptplay.wxml');
      const playWxss = src('pages/ppt/pptplay/pptplay.wxss');
      // image + video；controls 原生控制；object-fit contain
      assert.ok(/<image/.test(playWxml) && /<video/.test(playWxml), '图片舞台 + 视频媒体层');
      assert.ok(/controls/.test(playWxml) && /object-fit="contain"/.test(playWxml), '视频原生 controls + contain');
      // 手势：点击左右 1/3（宽度 / 3 判定）+ 左右滑
      assert.ok(/bindtouchstart="onTS"/.test(playWxml) && /bindtouchend="onTE"/.test(playWxml), '触摸手势绑定');
      assert.ok(/w \/ 3/.test(playJs) && /nextStep\(\)/.test(playJs) && /prevStep\(\)/.test(playJs), '点击右 2/3 下一步 / 左 1/3 上一步');
      assert.ok(/Math\.abs\(dx\) >= swipeMin/.test(playJs), '左右滑动切换（阈值 40px 或屏宽 12%）');
      // step 语义：后退单位=step；step=0 退上一页末步（ppt.advance）
      assert.ok(/ppt\.advance\(this\._flat, this\._idx, -1\)/.test(playJs), '后退单位 = step（step=0 自动回上一页末步）');
      // 媒体层不随 step 卸载：只在换页时 _closeMedia
      assert.ok(/if \(pageChanged\) this\._closeMedia\(\)/.test(playJs), '媒体层只在换页/退出时销毁（契约 §5）');
      assert.ok(/title: '退出演示？'/.test(playJs) && /enableAlertBeforeUnload/.test(playJs), '退出二次确认（有进度时）');
      // 自动隐藏控制条 + 顶部文件名淡出
      assert.ok(/CTRL_HIDE_MS = 3200/.test(playJs) && /_showCtrl/.test(playJs) && /_hideCtrl/.test(playJs), '控制条自动隐藏');
      assert.ok(/TITLE_FADE_MS = 3000/.test(playJs), '左上文件名 3s 淡出');
      // 黑屏（课堂单键）+ 步点（step≥2 才显示）+ 页内步点渲染
      assert.ok(/toggleBlack/.test(playJs) && /class="pl-black"/.test(playWxml), '黑屏按钮');
      assert.ok(/view\.showDots/.test(playWxml) && /view\.dots/.test(playWxml), '页内步点仅 step≥2 显示');
      assert.ok(/pageText/.test(playWxml), '页码按页（3 / 12）');
      // 顶部 2px 进度条（按 step）+ 缩略图/备注抽屉
      assert.ok(/pl-progress/.test(playWxml) && /view\.progressPct/.test(playWxml), '顶部进度条按 step 总进度');
      assert.ok(/\.pl-progress \{[^}]*height: 2px/.test(playWxss), '进度条 2px（DESIGN §4.3）');
      assert.ok(/thumbList/.test(playJs) && /pl-thumb/.test(playWxml) && /pickThumb/.test(playJs), '缩略图抽屉 + 点页跳转');
      assert.ok(/\.pl-drawer--thumb \{[^}]*height: 62vh/.test(playWxss), '缩略图抽屉手机高度 62vh');
      assert.ok(/pl-thumb-dots/.test(playWxml) && /pl-thumb-step--on/.test(playWxss), '当前页多步时缩略图下方标当前步（DESIGN §4.5）');
      assert.ok(/poster="\{\{view\.img\}\}"/.test(playWxml), '视频层用当前步图作 poster（DESIGN §5.4）');
      assert.ok(/本页无备注/.test(playWxml) && /pl-notes/.test(playWxss), '备注抽屉（空则「本页无备注」，不透明底）');
      // 转场：契约 §7 五族 + 同页切步淡入；动画类 a/b 双份保证重触发
      ['fade', 'push', 'wipe', 'zoom', 'cover'].forEach(function (t) {
        assert.ok(new RegExp('\\.pl-an-' + t + '-a').test(playWxss), '缺少页切换动效 ' + t);
      });
      assert.ok(/\.pl-an-step-a/.test(playWxss) && /plStepA 120ms/.test(playWxss), '同页切步 120ms 淡入');
      // 失败降级：图片保留上一张 + 重试；视频热点灰化「视频不可用」；不阻塞翻页
      assert.ok(/图片加载失败 · 重试/.test(playWxml) && /onImgErr/.test(playJs) && /retryImg/.test(playWxml), '图片失败保留上一张 + 重试');
      assert.ok(/slide\.thumbUrl|v\.thumbUrl/.test(playJs) && /_fallbackTried/.test(playJs), '图片失败先降级 thumb 尺寸');
      assert.ok(/视频不可用/.test(playWxml) && /onVideoErr/.test(playJs), '视频失败热点灰化「视频不可用」');
      assert.ok(/onVideoEnd/.test(playJs) && /closeMedia/.test(playWxml), '播完/关闭回当前步');
      // 预加载：downloadFile ≤6 并发；2G/断网暂停
      assert.ok(/wx\.downloadFile/.test(playJs), '预加载用 wx.downloadFile');
      const m = playJs.match(/PRELOAD_CONCURRENCY = (\d+)/);
      assert.ok(m && Number(m[1]) <= 6, '预加载并发 ≤6（微信 downloadFile 上限 10）');
      assert.ok(/onNetworkStatusChange/.test(playJs) && /_netOff/.test(playJs), '弱网暂停预加载');
      // 横竖屏自适应 + 回收
      assert.ok(/onResize/.test(playJs) && /fitRect/.test(playJs) && /onWindowResize/.test(playJs), '横竖屏自适应（letterbox 热点定位）');
      assert.ok(/onUnload/.test(playJs) && /_release\(\)/.test(playJs) && /destroy/.test(playJs), '退出释放（图片/视频/音频/定时器/网络监听）');
      assert.ok(/setKeepScreenOn/.test(playJs), '放映期间保持屏幕常亮');
    });

    /* ============================================================
     * I. 页面级行为（内存 wx mock：真实走 cloud.js request 通道）
     * ============================================================ */
    await test('PPT-I1 列表页：onShow 强拉列表 + 心跳同轮 + 别人的 uploading 过滤 + onHide 停轮询', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const cloud = R('utils/cloud.js');
      enableCloud(cloud);
      C.setReq(function (o) {
        const u = String(o.url);
        if (u.indexOf('/site_assets?') >= 0) {
          return o.success({ statusCode: 200, data: [{ body: { online: true, seen_at: Date.now() - 5000, queued: 2 }, updated_at: '2026-11-09T00:00:00Z' }] });
        }
        if (u.indexOf('/ppt_decks?') >= 0) {
          return o.success({ statusCode: 200, data: [
            { id: 'dReady', title: '班会', owner_sid: ID2.sid, owner_name: '测试辛', status: 'ready', slide_count: 12, created_at: 200 },
            { id: 'dMineQueue', title: '我的', owner_sid: SID, owner_name: '测试账号', status: 'queued', created_at: 100 },
            { id: 'dOtherUp', title: '别人在传', owner_sid: ID2.sid, owner_name: '测试辛', status: 'uploading', created_at: 300 }
          ] });
        }
        return o.success({ statusCode: 200, data: [] });
      });
      const def = loadPageDef('pages/ppt/ppt.js');
      const ctx = ctxOf(def);
      def.onLoad.call(ctx);
      def.onShow.call(ctx);
      await waitFor(function () { return ctx.data.state === 'ready' && ctx.data.rows.length > 0; }, 2000);
      assert.strictEqual(ctx.data.state, 'ready');
      assert.strictEqual(ctx.data.rows.length, 2, '别人的 uploading 不显示');
      assert.deepStrictEqual(ctx.data.rows.map(function (r) { return r.id; }), ['dMineQueue', 'dReady'], '本人进行中置顶');
      assert.strictEqual(ctx.data.hb.known, true);
      assert.strictEqual(ctx.data.hb.online, true);
      assert.strictEqual(ctx.data.empty, false);
      assert.ok(ctx._poll, '可见时启动 10s 轮询');
      def.onHide.call(ctx);
      assert.strictEqual(ctx._poll, null, 'onHide 停止轮询');
      def.onUnload.call(ctx);
    });

    await test('PPT-I2 列表页：聊天选文件 → 改标题 → 建行 → 2 片上传（512KiB/片）→ 提交 queued（端到端 mock）', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const cloud = R('utils/cloud.js');
      enableCloud(cloud);
      const FILE_SIZE = 600 * 1024;               // 2 片：512KiB + 88KiB
      const fileBuf = Buffer.alloc(FILE_SIZE);
      for (let i = 0; i < FILE_SIZE; i++) fileBuf[i] = i % 251;
      const chunks = [];
      const deckPosts = [];
      let createdRow = null;
      const deckRows = [];
      C.setReq(function (o) {
        const u = String(o.url);
        const m = String(o.method || 'GET').toUpperCase();
        if (m === 'GET' && u.indexOf('/ppt_decks?') >= 0) {
          if (u.indexOf('id=eq.') >= 0) {
            const id = decodeURIComponent((u.match(/id=eq\.([^&]+)/) || [])[1] || '');
            const row = deckRows.filter(function (x) { return x.id === id; })[0];
            return o.success({ statusCode: 200, data: row ? [row] : [] });
          }
          return o.success({ statusCode: 200, data: deckRows.slice() });
        }
        if (m === 'GET' && u.indexOf('/site_assets?') >= 0) return o.success({ statusCode: 200, data: [] });
        if (m === 'POST' && u.indexOf('/ppt_upload_chunks') >= 0) { chunks.push(o.data[0]); return o.success({ statusCode: 201, data: null }); }
        if (m === 'POST' && u.indexOf('/ppt_decks') >= 0) {
          const row = (o.data && o.data[0]) || {};
          deckPosts.push(row);
          const i = deckRows.map(function (x) { return x.id; }).indexOf(row.id);
          if (i >= 0) deckRows[i] = row; else deckRows.push(row);
          if (row.status === 'uploading' && !createdRow) createdRow = row;
          return o.success({ statusCode: 201, data: [row] });
        }
        return o.success({ statusCode: 200, data: [] });
      });
      // 选文件 + 读文件 + base64（真实 FS 路径用 mock 替代，仅在 wx 层替身）
      C.wxMock.chooseMessageFile = function (o) {
        if (o && o.success) o.success({ tempFiles: [{ path: '/tmp/班会.pptx', name: '班会.pptx', size: FILE_SIZE }] });
      };
      C.wxMock.getFileSystemManager = function () {
        return {
          // 基础库 3.x 首选：readFile({position,length}) 返回本片 ArrayBuffer
          readFile: function (o) {
            const u8 = new Uint8Array(o.length);
            fileBuf.copy(Buffer.from(u8.buffer), 0, o.position, o.position + o.length);
            o.success({ data: u8.buffer });
          },
          openSync: function () { return 9; },
          closeSync: function () {},
          read: function (o) {
            Buffer.from(o.arrayBuffer).fill(0);
            fileBuf.copy(Buffer.from(o.arrayBuffer), 0, o.position, o.position + o.length);
            o.success({ bytesRead: o.length });
          }
        };
      };
      C.wxMock.arrayBufferToBase64 = function (buf) { return Buffer.from(new Uint8Array(buf)).toString('base64'); };
      const def = loadPageDef('pages/ppt/ppt.js');
      const ctx = ctxOf(def);
      def.onLoad.call(ctx);
      def.onShow.call(ctx);
      await sleep(20);
      def.uploadTap.call(ctx);
      assert.strictEqual(ctx.data.titleOpen, true, '选完文件弹出标题编辑');
      assert.strictEqual(ctx.data.titleDraft, '班会', '默认标题 = 文件名去扩展名');
      ctx.data.titleDraft = '班会演示';
      def.confirmTitle.call(ctx);
      await waitFor(function () { return ctx.data.up === null && C.toastLog().some(function (t) { return String(t) === '排队转换'; }); }, 4000);
      assert.ok(createdRow, '应 POST 建行');
      assert.strictEqual(createdRow.owner_sid, SID);
      assert.strictEqual(createdRow.client, 'mp');
      assert.strictEqual(createdRow.title, '班会演示');
      assert.strictEqual(createdRow.chunk_count, 2);
      assert.strictEqual(chunks.length, 2, '600KiB → 2 片');
      const byIdx = chunks.slice().sort(function (a, b) { return a.idx - b.idx; });
      assert.deepStrictEqual(byIdx.map(function (x) { return x.idx; }), [0, 1]);
      assert.strictEqual(Buffer.from(byIdx[0].data, 'base64').length, 512 * 1024, '第 0 片 = 512KiB 原始字节');
      assert.strictEqual(Buffer.from(byIdx[1].data, 'base64').length, FILE_SIZE - 512 * 1024, '最后一片为剩余字节');
      assert.strictEqual(Buffer.from(byIdx[0].data, 'base64')[300], fileBuf[300], 'base64 内容来自源文件正确 offset');
      const submitRow = deckPosts.filter(function (r) { return r.status === 'queued'; }).pop();
      assert.ok(submitRow, '提交 queued（§4.3）');
      assert.strictEqual(submitRow.chunk_count, 2);
      assert.strictEqual(submitRow.source_size, FILE_SIZE);
      assert.strictEqual(ctx.data.up, null, '完成后进度条关闭');
      def.onUnload.call(ctx);
      C.wxMock.chooseMessageFile = prevChooseFile;
      C.wxMock.getFileSystemManager = prevFsFactory;
      C.wxMock.arrayBufferToBase64 = prevB64Factory;
    });

    await test('PPT-I3 播放器页：加载清单 → 步进/点击左右 1/3/滑动/黑屏/媒体层/抽屉/退出释放', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const cloud = R('utils/cloud.js');
      enableCloud(cloud);
      const manifest = manifestFixture();
      let listUrl = '';
      C.setReq(function (o) {
        const u = String(o.url);
        if (u.indexOf('/ppt_decks?') >= 0) {
          listUrl = u;
          return o.success({ statusCode: 200, data: [{ title: '班会演示', cover_url: 'https://oss.test/cover.webp', manifest: manifest, slide_count: 2 }] });
        }
        return o.success({ statusCode: 200, data: [] });
      });
      // 页面舞台尺寸 mock（390×844 竖屏）
      C.wxMock.createSelectorQuery = function () {
        return {
          select: function () { return this; },
          boundingClientRect: function () { return this; },
          exec: function (cb) { if (cb) cb([{ left: 0, top: 0, width: 390, height: 844 }]); }
        };
      };
      C.wxMock.onWindowResize = function () {};
      C.wxMock.offWindowResize = function () {};
      C.wxMock.onNetworkStatusChange = function () {};
      C.wxMock.getNetworkType = function (o) { if (o && o.success) o.success({ networkType: 'wifi' }); };
      C.wxMock.setKeepScreenOn = function () {};
      C.wxMock.enableAlertBeforeUnload = function () {};
      C.wxMock.disableAlertBeforeUnload = function () {};
      C.wxMock.downloadFile = function () {};
      const def = loadPageDef('pages/ppt/pptplay/pptplay.js');
      const ctx = ctxOf(def);
      def.onLoad.call(ctx, { id: 'dabc123456xy' });
      await waitFor(function () { return ctx.data.state === 'ready'; }, 2000);
      assert.strictEqual(ctx.data.state, 'ready');
      assert.strictEqual(ctx.data.title, '班会演示');
      assert.ok(listUrl.indexOf('select=manifest') >= 0, '播放前取清单（§4.5）');
      assert.strictEqual(ctx.data.thumbs.length, 2);
      assert.strictEqual(ctx.data.view.page, 1);
      assert.strictEqual(ctx.data.view.step, 1);
      assert.strictEqual(ctx.data.view.posText, '1/2 · 1/2');
      assert.strictEqual(ctx.data.view.showDots, true, '第 1 页 2 步 → 显示步点');
      assert.strictEqual(ctx.data.hot.length, 1, '第 1 步有 1 个视频热点');
      assert.ok(ctx.data.hot[0].left >= 0 && ctx.data.hot[0].top >= 0, '热点按图片实际渲染矩形定位');
      // 下一步（step 级别）→ 第 1 页第 2 步
      def.nextStep.call(ctx);
      assert.strictEqual(ctx.data.view.step, 2);
      assert.strictEqual(ctx.data.view.posText, '1/2 · 2/2');
      // 再下一步 → 第 2 页第 1 步；后退一次 → 上一页最后一步（step 语义）
      def.nextStep.call(ctx);
      assert.strictEqual(ctx.data.view.page, 2);
      assert.strictEqual(ctx.data.view.step, 1);
      def.prevStep.call(ctx);
      assert.strictEqual(ctx.data.view.page, 1, 'step=0 后退 → 上一页最后一步');
      assert.strictEqual(ctx.data.view.step, 2);
      // 回到第 1 页第 1 步后：点击右 2/3 → 下一步；点击左 1/3 → 上一步
      def._go.call(ctx, 0);
      def.onTS.call(ctx, { touches: [{ clientX: 200, clientY: 400 }] });
      def.onTE.call(ctx, { changedTouches: [{ clientX: 204, clientY: 402 }] });
      assert.strictEqual(ctx.data.view.step, 2, '点击右 2/3 下一步');
      def.onTS.call(ctx, { touches: [{ clientX: 30, clientY: 400 }] });
      def.onTE.call(ctx, { changedTouches: [{ clientX: 34, clientY: 401 }] });
      assert.strictEqual(ctx.data.view.step, 1, '点击左 1/3 上一步');
      // 左滑 → 下一步；右滑 → 上一步
      def.onTS.call(ctx, { touches: [{ clientX: 300, clientY: 400 }] });
      def.onTE.call(ctx, { changedTouches: [{ clientX: 120, clientY: 405 }] });
      assert.strictEqual(ctx.data.view.step, 2, '左滑下一步');
      def.onTS.call(ctx, { touches: [{ clientX: 120, clientY: 400 }] });
      def.onTE.call(ctx, { changedTouches: [{ clientX: 300, clientY: 405 }] });
      assert.strictEqual(ctx.data.view.step, 1, '右滑上一步');
      // 媒体层：点热点打开视频；关闭回当前步；媒体层不随 step 卸载（换页才关）
      def.openMedia.call(ctx, { currentTarget: { dataset: { i: 0 } } });
      assert.ok(ctx.data.video && ctx.data.video.url, '点热点才打开视频层');
      assert.strictEqual(ctx.data.view.step, 1, '打开媒体不动当前步');
      def.nextStep.call(ctx);                       // 同页切步：媒体层保持
      assert.ok(ctx.data.video, '同页切步不卸载媒体层（契约 §5 播放语义）');
      def.nextStep.call(ctx);                       // 换页：媒体层销毁
      assert.strictEqual(ctx.data.video, null, '换页销毁媒体层');
      // 黑屏开关
      def.toggleBlack.call(ctx);
      assert.strictEqual(ctx.data.black, true);
      def.toggleBlack.call(ctx);
      assert.strictEqual(ctx.data.black, false);
      // 抽屉：缩略图点页跳转 / 备注
      def.openThumb.call(ctx);
      assert.strictEqual(ctx.data.drawer, 'thumb');
      def.pickThumb.call(ctx, { currentTarget: { dataset: { p: 0 } } });
      assert.strictEqual(ctx.data.view.page, 1);
      def.openNotes.call(ctx);
      assert.strictEqual(ctx.data.drawer, 'notes');
      assert.strictEqual(ctx.data.view.notes, '第一页备注');
      def.closeDrawer.call(ctx);
      // 退出释放
      const before = ctx.data.imgA;
      def.onUnload.call(ctx);
      assert.strictEqual(ctx._dead, true, '退出后标记销毁（异步回调不再 setData）');
      assert.strictEqual(ctx.data.imgA, '', '退出释放图片解码');
      assert.strictEqual(ctx.data.video, null);
      assert.ok(before, '释放前有图');
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
    fs.writeFileSync(path.join(__dirname, 'ppt_unit_result.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log('\n================ ppt: ' + passN + ' passed, ' + failN + ' failed ================');
    process.exit(failN ? 2 : 0);
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}
