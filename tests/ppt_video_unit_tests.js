/* ppt_video_unit_tests.js —— PPT v1.2「原样播放」视频 + 便捷操作 专项单测（2026-11-10）
 *
 * 契约唯一真源：web/ppt/CONTRACT.md §11（v1.2）
 *   §11.1 manifest.video（可选字段/容错）· §11.3.1 模式与默认值 · §11.3.2 原样播放控制条
 *   §11.3.3 分步热点时序修复与尺寸 · §11.3.4 续播与列表便捷 · §11.4 小程序降级链
 *
 * 覆盖：
 *   A. manifest.video 归一化容错（缺失/坏数据/未知字段/绝对 URL/章节排序去重/刻度）
 *   B. 章节 seek（videoChapterAt / videoPageOf / videoSeekTarget / videoPrevNext / 时间文本）
 *   C. 模式选择（无视频/设备偏好/网络 wifi·4g·5g·unknown·2g·3g·none）
 *   D. 续播存取（normResume/resumeValid/resumeText/7 天/末尾判定/storage/模式偏好/列表徽标）
 *   E. 降级链状态机（direct→download→temp→step）+ 下载进度/文案
 *   F. 倍速循环 / URL 解析 / 时间格式化
 *   G. 工程静态接线（播放器/列表/版本号/热点尺寸）
 *   H. 页面级行为（内存 wx mock：默认模式、章节/倍速/复制链接/切模式、直连失败→下载→临时文件→分步、
 *      下载失败→分步、续播自动定位、弱网默认分步、列表「继续」徽标）
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
const ID = { token: 'tok-ppt-video-mp', sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: false, ts: 1 };

/* ---------------- wx 内存 mock（视频模式需要的全部 API） ---------------- */
function createCtx() {
  const mem = Object.create(null);
  let reqLog = [];
  let reqImpl = function (o) { o.success({ statusCode: 200, data: [] }); };
  let toastLog = [];
  let clipLog = [];
  let videoCalls = [];       // createVideoContext 的调用记录（play/pause/seek/playbackRate/stop）
  let videoCtx = null;
  let dl = null;             // 最近一次 wx.downloadFile 的 options / task
  const wxMock = {
    getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
    setStorageSync(k, v) { mem[k] = v; },
    removeStorageSync(k) { delete mem[k]; },
    getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 0, limitSize: 10240 }; },
    request(o) { reqLog.push(o); reqImpl(o); },
    showToast(o) { toastLog.push(o && o.title); },
    showModal(o) { if (o && o.success) o.success({ confirm: true, cancel: false }); },
    showShareMenu() {}, stopPullDownRefresh() {}, hideLoading() {}, showLoading() {},
    setClipboardData(o) { clipLog.push(o && o.data); if (o && o.success) o.success(); },
    switchTab() {}, reLaunch() {}, navigateTo() {}, navigateBack() {},
    getWindowInfo() { return { windowWidth: 390, windowHeight: 844, pixelRatio: 3 }; },
    getSystemInfoSync() { return { windowWidth: 390, windowHeight: 844, SDKVersion: '3.0.0' }; },
    getAppBaseInfo() { return { SDKVersion: '3.0.0', theme: 'light' }; },
    nextTick(fn) { if (fn) fn(); },
    setKeepScreenOn() {},
    enableAlertBeforeUnload() {},
    disableAlertBeforeUnload() {},
    onWindowResize() {},
    offWindowResize() {},
    onNetworkStatusChange() {},
    offNetworkStatusChange() {},
    getNetworkType(o) { if (o && o.success) o.success({ networkType: wxMock.__net || 'wifi' }); },
    __net: 'wifi',
    createSelectorQuery() {
      return {
        _sel: '',
        in() { return this; },
        select(sel) { this._sel = String(sel || ''); return this; },
        selectViewport() { return this; },
        boundingClientRect() { return this; }, scrollOffset() { return this; }, fields() { return this; },
        exec(cb) {
          if (!cb) return;
          // 舞台 390×844；章节进度条 left=10 / 宽 300（onVBarTap 按 x 定位）
          if (this._sel.indexOf('pl-vbar') >= 0) cb([{ left: 10, top: 800, width: 300, height: 22 }]);
          else cb([{ left: 0, top: 0, width: 390, height: 844 }]);
        }
      };
    },
    createVideoContext() {
      const ctx = {
        play() { videoCalls.push('play'); },
        pause() { videoCalls.push('pause'); },
        stop() { videoCalls.push('stop'); },
        seek(t) { videoCalls.push('seek:' + t); },
        playbackRate(r) { videoCalls.push('rate:' + r); }
      };
      videoCtx = ctx;
      return ctx;
    },
    downloadFile(o) {
      const task = {
        onProgressUpdate(cb) { task._cb = cb; },
        abort() { task.aborted = true; videoCalls.push('abort'); }
      };
      dl = { opts: o, task: task };
      return task;
    },
    createInnerAudioContext() { return { play() {}, stop() {}, destroy() {}, onEnded() {}, onError() {} }; }
  };
  return {
    mem: mem, wxMock: wxMock,
    clearMem() {
      Object.keys(mem).forEach(function (k) { delete mem[k]; });
      reqLog = []; toastLog = []; clipLog = []; videoCalls = []; videoCtx = null; dl = null;
      reqImpl = function (o) { o.success({ statusCode: 200, data: [] }); };
      wxMock.__net = 'wifi';
    },
    setReq(fn) { reqImpl = fn; },
    reqLog() { return reqLog; },
    toastLog() { return toastLog; },
    clipLog() { return clipLog; },
    videoCalls() { return videoCalls; },
    videoCtx() { return videoCtx; },
    dl() { return dl; },
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

/* ---------------- 测试用 manifest.video / manifest ---------------- */
function videoFixture() {
  return {
    s: 'deck.mp4', w: 1280, h: 720, dur: 342.5, q: '720p',
    chapters: [{ i: 0, t: 0 }, { i: 1, t: 8.7 }, { i: 2, t: 15.2 }, { i: 3, t: 30 }]
  };
}
function manifestWithVideo() {
  const base = 'https://oss.test/ppt/a/dabc/20261110/';
  return {
    v: 1,
    base: base,
    src: 'https://oss.test/ppt/src/dabc/source.pptx',
    w: 1600, h: 900,
    slides: [
      { tr: 'fade', trd: 500, notes: '第一页备注', thumb: 't1.webp', steps: [{ img: 's1-1.webp', media: [{ s: 'm0.mp4', k: 'v', x: 0.1, y: 0.2, w: 0.5, h: 0.6 }] }] },
      { tr: 'fade', trd: 400, notes: '第二页', thumb: 't2.webp', steps: [{ img: 's2-1.webp' }] },
      { tr: 'fade', trd: 400, notes: '', thumb: 't3.webp', steps: [{ img: 's3-1.webp' }] },
      { tr: 'fade', trd: 400, notes: '', thumb: 't4.webp', steps: [{ img: 's4-1.webp' }] }
    ],
    media: [{ s: 'm0.mp4', k: 'v', w: 1280, h: 720, dur: 225.6 }],
    video: videoFixture()
  };
}
// 页面级：mock 云请求返回带 video 的 manifest；identity + cloud 已就绪
async function loadVideoPage(C, opts) {
  const o = opts || {};
  purge();
  C.clearMem();
  C.setIdentity(ID);
  const cloud = R('utils/cloud.js');
  enableCloud(cloud);
  C.wxMock.__net = o.net || 'wifi';
  if (o.resume) C.mem['zq_ppt_resume_v1'] = o.resume;
  const manifest = o.manifest || manifestWithVideo();
  C.setReq(function (req) {
    const u = String(req.url);
    if (u.indexOf('/ppt_decks?') >= 0) {
      return req.success({ statusCode: 200, data: [{ title: '班会演示', cover_url: 'https://oss.test/cover.webp', manifest: manifest, slide_count: 4 }] });
    }
    return req.success({ statusCode: 200, data: [] });
  });
  const def = loadPageDef('pages/ppt/pptplay/pptplay.js');
  const ctx = ctxOf(def);
  def.onLoad.call(ctx, { id: 'dabc123456xy' });
  await waitFor(function () { return ctx.data.state === 'ready' && ctx.data.mode !== ''; }, 3000);
  return { def: def, ctx: ctx };
}

async function run(test) {
  const prevWx = global.wx;
  const C = createCtx();
  global.wx = C.wxMock;
  try {
    /* ============================================================
     * A. manifest.video 归一化容错（§11.1）
     * ============================================================ */
    await test('PPT-V-A1 manifest.video：缺失/坏数据 → null（回退分步，不报错白屏）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      assert.strictEqual(ppt.normVideo(null, 'https://oss.test/a/'), null);
      assert.strictEqual(ppt.normVideo(undefined, ''), null);
      assert.strictEqual(ppt.normVideo({}, ''), null, '缺 s');
      assert.strictEqual(ppt.normVideo('deck.mp4', ''), null, '字符串不是对象');
      assert.strictEqual(ppt.normVideo([], ''), null, '数组不是对象');
      assert.strictEqual(ppt.normVideo({ s: '   ' }, ''), null, '空 s');
      assert.strictEqual(ppt.normVideo({ s: 123 }, ''), null, 's 非字符串 → 空');
      const bare = ppt.normVideo({ s: 'deck.mp4' }, 'https://oss.test/a/b');
      assert.ok(bare, '最小字段也能解析');
      assert.strictEqual(bare.url, 'https://oss.test/a/b/deck.mp4', '相对 s 拼 base');
      assert.strictEqual(bare.w, 1280);
      assert.strictEqual(bare.h, 720);
      assert.strictEqual(bare.dur, 0);
      assert.deepStrictEqual(bare.chapters, []);
      assert.deepStrictEqual(bare.ticks, []);
      assert.strictEqual(bare.q, '');
    });

    await test('PPT-V-A2 manifest.video：URL 解析（绝对/data: 直连、base 无尾斜杠、未知字段忽略）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const abs = ppt.normVideo({ s: 'https://cdn.test/deck.mp4', extra: 'x', w: 999999 }, 'https://oss.test/a/');
      assert.strictEqual(abs.url, 'https://cdn.test/deck.mp4');
      assert.strictEqual(abs.w, 8192, 'w clamp 上限');
      const data = ppt.normVideo({ s: 'data:video/mp4;base64,AAA' }, 'https://oss.test/a/');
      assert.strictEqual(data.url, 'data:video/mp4;base64,AAA');
      const bare = ppt.normVideo({ s: 'deck.mp4' }, 'https://oss.test/a');
      assert.strictEqual(bare.url, 'https://oss.test/a/deck.mp4', 'base 无尾斜杠自动补');
      assert.strictEqual('extra' in abs, false, '未知字段不进入归一化结果');
      assert.strictEqual(abs.q, '');
      const q = ppt.normVideo({ s: 'deck.mp4', q: '1080p' }, '');
      assert.strictEqual(q.q, '1080p');
    });

    await test('PPT-V-A3 manifest.video：chapters 容错（坏项丢弃/按 t 排序/同页去重/单调不减）+ 刻度百分比', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const v = ppt.normVideo({
        s: 'deck.mp4', dur: 100,
        chapters: [
          { i: 3, t: 30 }, { i: 1, t: 10 }, { bad: 1 }, { i: -1, t: 5 }, { i: '2', t: '20' },
          { i: 1, t: 12 }, { i: 4, t: 5 }, { i: 5, t: 90 }, { i: 6, t: 95 }
        ]
      }, '');
      assert.deepStrictEqual(v.chapters.map(function (c) { return c.i; }), [4, 1, 2, 3, 5, 6], '按 t 排序、同页只留第一个');
      assert.deepStrictEqual(v.chapters.map(function (c) { return c.t; }), [5, 10, 20, 30, 90, 95]);
      for (let i = 1; i < v.chapters.length; i++) assert.ok(v.chapters[i].t >= v.chapters[i - 1].t, 't 单调不减');
      assert.strictEqual(v.ticks.length, v.chapters.length);
      assert.strictEqual(v.ticks[0].pct, 5, '5s/100s → 5%');
      assert.strictEqual(v.ticks[v.ticks.length - 1].pct, 95);
      // 单调修复：后面的章节时间小于等于前面的 → 抬平
      const flat = ppt.normVideo({ s: 'd.mp4', dur: 10, chapters: [{ i: 0, t: 3 }, { i: 1, t: 1 }] }, '');
      assert.deepStrictEqual(flat.chapters.map(function (c) { return c.t; }), [1, 3], '按 t 排序后自然单调');
      const zero = ppt.normVideo({ s: 'd.mp4', dur: 0, chapters: [{ i: 0, t: 2 }] }, '');
      assert.strictEqual(zero.ticks[0].pct, 0, 'dur=0 时刻度按 0 处理，不除零');
    });

    await test('PPT-V-A4 normManifest：有 video 时归一化挂载，缺失/坏 video 仍保留分步（§11.1 兼容规则）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const m1 = ppt.normManifest(manifestWithVideo());
      assert.ok(m1 && m1.video, 'manifest.video 归一化到 manifest.video');
      assert.strictEqual(m1.video.url, 'https://oss.test/ppt/a/dabc/20261110/deck.mp4');
      assert.strictEqual(m1.video.chapters.length, 4);
      assert.strictEqual(m1.stepTotal, 4);
      const m2 = ppt.normManifest({ base: 'https://oss.test/a/', slides: [{ steps: [{ img: 's1.webp' }] }] });
      assert.strictEqual(m2.video, null, '无 video → null（仅分步模式）');
      assert.strictEqual(m2.slides.length, 1, '分步内容不受影响');
      const m3 = ppt.normManifest({ base: 'https://oss.test/a/', slides: [{ steps: [{ img: 's1.webp' }] }], video: { s: '' } });
      assert.strictEqual(m3.video, null, '坏 video 不影响分步播放');
      // JSON 字符串形态（PostgREST jsonb 可能返回字符串）
      const m4 = ppt.normManifest(JSON.stringify(manifestWithVideo()));
      assert.ok(m4 && m4.video && m4.video.dur === 342.5);
    });

    /* ============================================================
     * B. 章节 seek（§11.3.2：按 chapters seek，非 ±10s）
     * ============================================================ */
    await test('PPT-V-B1 章节定位：videoChapterAt / videoPageOf 边界（早于/正好/之间/末尾）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const v = ppt.normVideo(videoFixture(), '');
      assert.strictEqual(ppt.videoChapterAt(v, -3), -1, '早于第一章节（t=0 前）');
      assert.strictEqual(ppt.videoChapterAt(v, 0), 0);
      assert.strictEqual(ppt.videoChapterAt(v, 8.6), 0);
      assert.strictEqual(ppt.videoChapterAt(v, 8.7), 1, '正好在章节时间点');
      assert.strictEqual(ppt.videoChapterAt(v, 20), 2);
      assert.strictEqual(ppt.videoChapterAt(v, 999), 3, '超过最后一章节 → 最后一页');
      assert.strictEqual(ppt.videoPageOf(v, 0), 0);
      assert.strictEqual(ppt.videoPageOf(v, 30), 3);
      assert.strictEqual(ppt.videoPageOf({ chapters: [] }, 5), -1, '无章节 → -1');
    });

    await test('PPT-V-B2 章节 seek 目标：chapters[i].t + 0.05、clamp [0, dur-0.05]、找不到页 → -1', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const v = ppt.normVideo(videoFixture(), '');
      assert.strictEqual(ppt.videoSeekTarget(v, 0), 0.05);
      assert.strictEqual(ppt.videoSeekTarget(v, 1), 8.75);
      assert.strictEqual(ppt.videoSeekTarget(v, 3), 30.05);
      assert.strictEqual(ppt.videoSeekTarget(v, 99), -1, '不存在的页');
      assert.strictEqual(ppt.videoSeekTarget(v, -1), -1);
      const end = ppt.normVideo({ s: 'd.mp4', dur: 10, chapters: [{ i: 0, t: 0 }, { i: 1, t: 9.99 }] }, '');
      assert.strictEqual(ppt.videoSeekTarget(end, 1), 9.95, 'clamp 到 dur - 0.05');
      const noDur = ppt.normVideo({ s: 'd.mp4', dur: 0, chapters: [{ i: 0, t: 3 }] }, '');
      assert.strictEqual(ppt.videoSeekTarget(noDur, 0), 3.05, 'dur 未知不 clamp');
    });

    await test('PPT-V-B3 上一页/下一页（章节边界）：videoPrevNext 首尾返回 null、保持 ±1 页', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const v = ppt.normVideo(videoFixture(), '');
      assert.strictEqual(ppt.videoPrevNext(v, 0, -1), null, '第一页再上一页 → null');
      assert.deepStrictEqual(ppt.videoPrevNext(v, 0, 1), { page: 1, t: 8.75, index: 1 });
      assert.deepStrictEqual(ppt.videoPrevNext(v, 8.7, 1), { page: 2, t: 15.25, index: 2 });
      assert.deepStrictEqual(ppt.videoPrevNext(v, 20, -1), { page: 1, t: 8.75, index: 1 });
      assert.strictEqual(ppt.videoPrevNext(v, 30, 1), null, '最后一页再下一页 → null');
      assert.strictEqual(ppt.videoPrevNext({ chapters: [] }, 0, 1), null, '无章节 → null');
      assert.deepStrictEqual(ppt.videoPrevNext(v, 0, 5), { page: 1, t: 8.75, index: 1 }, 'dir 只认正负');
      assert.deepStrictEqual(ppt.videoPrevNext(v, 0, -5), null);
    });

    await test('PPT-V-B4 时间文本 / 百分比：mm:ss、负值 clamp、vpct 0–100', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      assert.strictEqual(ppt.fmtVideoClock(0), '00:00');
      assert.strictEqual(ppt.fmtVideoClock(5), '00:05');
      assert.strictEqual(ppt.fmtVideoClock(65), '01:05');
      assert.strictEqual(ppt.fmtVideoClock(342.5), '05:42', '小数向下取整');
      assert.strictEqual(ppt.fmtVideoClock(-9), '00:00');
      assert.strictEqual(ppt.videoTimeText(12, 342.5), '00:12 / 05:42');
      assert.strictEqual(ppt.videoPct(0, 100), 0);
      assert.strictEqual(ppt.videoPct(50, 100), 50);
      assert.strictEqual(ppt.videoPct(0, 0), 0, 'dur=0 不除零');
      assert.strictEqual(ppt.videoPct(200, 100), 100, 'clamp 100');
      assert.strictEqual(ppt.videoPct(-5, 100), 0);
    });

    /* ============================================================
     * C. 模式选择（§11.3.1）
     * ============================================================ */
    await test('PPT-V-C1 默认模式：无 video → 分步；wifi/4g/5g/unknown → 原样；2g/3g/none → 分步', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      assert.strictEqual(ppt.chooseMode({ hasVideo: false, networkType: 'wifi' }), 'step');
      ['wifi', '4g', '5g', 'unknown', '', 'ethernet'].forEach(function (nt) {
        assert.strictEqual(ppt.chooseMode({ hasVideo: true, networkType: nt }), 'video', nt + ' → 原样');
      });
      ['2g', '3g', 'none', '2G', 'None'].forEach(function (nt) {
        assert.strictEqual(ppt.chooseMode({ hasVideo: true, networkType: nt }), 'step', nt + ' → 分步');
      });
    });

    await test('PPT-V-C2 设备偏好优先：用户切换过 video/step → 优先（即使网络相反；无 video 仍分步）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      assert.strictEqual(ppt.chooseMode({ hasVideo: true, networkType: '2g', pref: 'video' }), 'video', '用户偏好原样优先于弱网');
      assert.strictEqual(ppt.chooseMode({ hasVideo: true, networkType: 'wifi', pref: 'step' }), 'step', '用户偏好分步优先于好网');
      assert.strictEqual(ppt.chooseMode({ hasVideo: false, networkType: 'wifi', pref: 'video' }), 'step', '无 video 不能强制原样');
      assert.strictEqual(ppt.chooseMode({ hasVideo: true, networkType: 'wifi', pref: 'bogus' }), 'video', '非法偏好忽略');
      assert.strictEqual(ppt.chooseMode({}), 'step');
    });

    await test('PPT-V-C3 模式偏好 storage：按 deckId 记住，坏值忽略，不进 UD 同步（本机 key）', function () {
      purge();
      C.clearMem();
      const ppt = R('pages/ppt/utils/ppt.js');
      assert.strictEqual(ppt.modeOf('deckA'), '');
      assert.strictEqual(ppt.saveMode('deckA', 'video'), 'video');
      assert.strictEqual(ppt.modeOf('deckA'), 'video');
      assert.strictEqual(ppt.saveMode('deckA', 'step'), 'step');
      assert.strictEqual(ppt.modeOf('deckA'), 'step');
      assert.strictEqual(ppt.modeOf('deckB'), '', '按 deckId 隔离');
      assert.strictEqual(ppt.saveMode('deckB', 'bogus'), '', '非法值不写');
      assert.strictEqual(ppt.modeOf('deckB'), '');
      assert.ok(ppt.MODE_KEY.indexOf('zq_ppt_mode') === 0, '本机 storage key（不进 userdata 云同步）');
    });

    /* ============================================================
     * D. 续播（§11.3.4）
     * ============================================================ */
    await test('PPT-V-D1 resumeValid：视频 >5s 且 <95% 才算未播完；7 天内有效', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const now = 1762700000000;
      assert.strictEqual(ppt.resumeValid(null, now), false);
      assert.strictEqual(ppt.resumeValid({ t: 0, at: now }, now), false);
      assert.strictEqual(ppt.resumeValid({ mode: 'video', t: 3, dur: 100, at: now }, now), false, '≤5s 不算进度');
      assert.strictEqual(ppt.resumeValid({ mode: 'video', t: 42, dur: 100, at: now }, now), true);
      assert.strictEqual(ppt.resumeValid({ mode: 'video', t: 96, dur: 100, at: now }, now), false, '≥95% 视为已到末尾');
      assert.strictEqual(ppt.resumeValid({ mode: 'video', t: 42, dur: 100, at: now - 8 * 24 * 3600e3 }, now), false, '超过 7 天失效');
      assert.strictEqual(ppt.resumeValid({ mode: 'video', t: 42, dur: 100, at: now + 3600e3 }, now), false, '未来时间戳视为异常');
      assert.strictEqual(ppt.resumeValid({ mode: 'step', idx: 0, n: 10, at: now }, now), false, '第 1 步不算进度');
      assert.strictEqual(ppt.resumeValid({ mode: 'step', idx: 5, n: 10, at: now }, now), true);
      assert.strictEqual(ppt.resumeValid({ mode: 'step', idx: 9, n: 10, at: now }, now), false, '最后一步视为看完');
      assert.strictEqual(ppt.resumeValid({ mode: 'step', idx: 5, n: 0, at: now }, now), true, '总步数未知时按 idx>0 判断');
    });

    await test('PPT-V-D2 resumeText：视频「续播 05:42」/ 分步「续播 3/12」；无效返回空串', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      const now = 1762700000000;
      assert.strictEqual(ppt.resumeText({ mode: 'video', t: 342.5, dur: 400, at: now }, now), '续播 05:42');
      assert.strictEqual(ppt.resumeText({ mode: 'step', page: 2, pt: 12, idx: 3, n: 20, at: now }, now), '续播 3/12');
      assert.strictEqual(ppt.resumeText({ mode: 'step', idx: 0, n: 20, at: now }, now), '');
      assert.strictEqual(ppt.resumeText(null, now), '');
    });

    await test('PPT-V-D3 续播 storage：saveResume/resumeOf/resumeAll/clearResume + 过期清理 + 数量上限', function () {
      purge();
      C.clearMem();
      const ppt = R('pages/ppt/utils/ppt.js');
      const now = Date.now();
      assert.strictEqual(ppt.resumeOf('deckA', now), null);
      ppt.saveResume('deckA', { mode: 'video', t: 120, dur: 300, at: now });
      const a = ppt.resumeOf('deckA', now);
      assert.ok(a && a.mode === 'video' && a.t === 120 && a.dur === 300);
      // 默认 at = 现在
      const saved = ppt.saveResume('deckB', { mode: 'step', page: 1, step: 0, idx: 2, pt: 8, n: 20 });
      assert.ok(saved.at > 0);
      assert.strictEqual(ppt.resumeAll(now).deckB.mode, 'step');
      // 过期记录读取时被清理
      assert.strictEqual(ppt.resumeValid({ mode: 'video', t: 120, dur: 300, at: now - 9 * 24 * 3600e3 }, now), false);
      assert.strictEqual(ppt.resumeOf('deckOld', now), null);
      ppt.saveResume('deckOld', { mode: 'video', t: 120, dur: 300, at: now - 9 * 24 * 3600e3 });
      assert.strictEqual(ppt.resumeOf('deckOld', now), null, '9 天前的记录不再返回');
      assert.strictEqual(ppt.resumeAll(now).deckOld, undefined, '读取时清理过期项');
      // 清除
      ppt.clearResume('deckA');
      assert.strictEqual(ppt.resumeOf('deckA', now), null);
      // 上限 100（超出按 at 最旧淘汰）
      for (let i = 0; i < 108; i++) ppt.saveResume('deck' + i, { mode: 'video', t: 30 + i, dur: 300, at: now - (200 - i) * 1000 });
      const all = ppt.resumeAll(now);
      assert.ok(Object.keys(all).length <= 100, '最多保留 100 条，实际 ' + Object.keys(all).length);
      assert.ok(all.deck107, '最新的记录保留');
      assert.ok(!all.deck0, '最旧的记录被淘汰');
    });

    await test('PPT-V-D4 列表「继续」徽标：deckView 增加 resumeShow/resumeText（7 天/未到末尾），不影响原有字段', function () {
      purge();
      C.clearMem();
      const ppt = R('pages/ppt/utils/ppt.js');
      const now = Date.now();
      const resumeMap = {
        dReady: { mode: 'video', t: 120, dur: 300, at: now },
        dEnd: { mode: 'video', t: 298, dur: 300, at: now },
        dOld: { mode: 'video', t: 120, dur: 300, at: now - 8 * 24 * 3600e3 }
      };
      const base = { id: 'dReady', title: '班会', status: 'ready', owner_sid: ID.sid, slide_count: 16, created_at: 100 };
      const v1 = ppt.deckView(base, { sid: ID.sid, resumeMap: resumeMap, now: now });
      assert.strictEqual(v1.resumeShow, true);
      assert.strictEqual(v1.resumeText, '续播 02:00');
      assert.strictEqual(v1.playable, true, '原有 playable 字段不变');
      const v2 = ppt.deckView(Object.assign({}, base, { id: 'dEnd' }), { sid: ID.sid, resumeMap: resumeMap, now: now });
      assert.strictEqual(v2.resumeShow, false, '已看完不显示徽标');
      const v3 = ppt.deckView(Object.assign({}, base, { id: 'dOld' }), { sid: ID.sid, resumeMap: resumeMap, now: now });
      assert.strictEqual(v3.resumeShow, false, '7 天前不显示');
      const v4 = ppt.deckView(base, { sid: ID.sid, now: now });
      assert.strictEqual(v4.resumeShow, false, '没有续播表时不显示（兼容旧调用）');
      assert.ok('resumeText' in v1 && 'resume' in v1);
    });

    /* ============================================================
     * E. 降级链状态机（§11.4）
     * ============================================================ */
    await test('PPT-V-E1 降级状态机：direct →(error/timeout)→ download →(ok)→ temp →(error)→ step', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      let n = ppt.videoStageNext('direct', 'direct-error');
      assert.deepStrictEqual([n.stage, n.action], ['download', 'download']);
      n = ppt.videoStageNext('direct', 'direct-timeout');
      assert.deepStrictEqual([n.stage, n.action], ['download', 'download'], '5s 未起播也走下载');
      n = ppt.videoStageNext('download', 'download-ok');
      assert.deepStrictEqual([n.stage, n.action], ['temp', 'play-temp']);
      n = ppt.videoStageNext('download', 'download-fail');
      assert.deepStrictEqual([n.stage, n.action], ['step', 'fallback-step']);
      assert.strictEqual(n.toast, '网络不佳，已切换分步浏览');
      assert.ok(/OSS/.test(n.hint), '下载失败给出「需配置 OSS 域名」短提示');
      n = ppt.videoStageNext('temp', 'temp-error');
      assert.deepStrictEqual([n.stage, n.action], ['step', 'fallback-step']);
      n = ppt.videoStageNext('direct', 'play-ok');
      assert.deepStrictEqual([n.stage, n.action], ['direct', 'ok']);
      n = ppt.videoStageNext('download', 'reset');
      assert.deepStrictEqual([n.stage, n.action], ['direct', 'play-direct'], 'reset 回到直链');
      n = ppt.videoStageNext('weird', 'direct-error');
      assert.strictEqual(n.stage, 'step', '未知状态安全落到分步');
      // 完整链：直连失败 → 下载失败 → 分步
      let st = ppt.videoStageNext('direct', 'direct-error').stage;
      st = ppt.videoStageNext(st, 'download-fail').stage;
      assert.strictEqual(st, 'step');
      // 完整链：直连失败 → 下载成功 → 临时文件失败 → 分步
      let st2 = ppt.videoStageNext('direct', 'direct-timeout').stage;
      st2 = ppt.videoStageNext(st2, 'download-ok').stage;
      assert.strictEqual(st2, 'temp');
      assert.strictEqual(ppt.videoStageNext(st2, 'temp-error').stage, 'step');
    });

    await test('PPT-V-E2 下载进度：downloadPct 未知总长 → -1、四舍五入、clamp；downloadText「下载 34%」', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      assert.strictEqual(ppt.downloadPct(0, 0), -1, '总长未知（下载中…）');
      assert.strictEqual(ppt.downloadPct(50, 100), 50);
      assert.strictEqual(ppt.downloadPct(1, 3), 33);
      assert.strictEqual(ppt.downloadPct(200, 100), 100);
      assert.strictEqual(ppt.downloadPct(-5, 100), 0);
      assert.strictEqual(ppt.downloadText(-1), '下载中…');
      assert.strictEqual(ppt.downloadText(34), '下载 34%');
      assert.strictEqual(ppt.downloadText(0), '下载 0%');
      assert.strictEqual(ppt.downloadPct(null, null), -1);
    });

    /* ============================================================
     * F. 倍速循环 / 常量
     * ============================================================ */
    await test('PPT-V-F1 倍速：1× → 1.25× → 1.5× → 2× → 循环；未知值回 1×（§11.3.2）', function () {
      purge();
      const ppt = R('pages/ppt/utils/ppt.js');
      assert.deepStrictEqual(ppt.V_RATES, [1, 1.25, 1.5, 2]);
      assert.strictEqual(ppt.nextRate(1), 1.25);
      assert.strictEqual(ppt.nextRate(1.25), 1.5);
      assert.strictEqual(ppt.nextRate(1.5), 2);
      assert.strictEqual(ppt.nextRate(2), 1);
      assert.strictEqual(ppt.nextRate(3), 1, '未知 → 1×');
      assert.strictEqual(ppt.rateText(1), '1×');
      assert.strictEqual(ppt.rateText(1.25), '1.25×');
      assert.strictEqual(ppt.rateText(2), '2×');
      assert.strictEqual(ppt.V_START_TIMEOUT_MS, 5000, '直连 5s 未起播 → 下载（§11.4）');
      assert.strictEqual(ppt.V_CTRL_HIDE_MS, 3000, '控制条 3s 自动隐藏');
      assert.strictEqual(ppt.RESUME_TTL_MS, 7 * 24 * 3600 * 1000, '续播 7 天');
      assert.deepStrictEqual(ppt.V_STAGE, { direct: 'direct', download: 'download', temp: 'temp', step: 'step' });
    });

    /* ============================================================
     * G. 工程静态接线（页面 / 列表 / WXML / 版本号）
     * ============================================================ */
    await test('PPT-V-G1 播放器 WXML：自制控制条/章节刻度/倍速/复制链接/缓冲与下载态/不白屏', function () {
      purge();
      const wxml = src('pages/ppt/pptplay/pptplay.wxml');
      assert.ok(/<video/.test(wxml) && /id="plv"/.test(wxml), '视频模式 <video id="plv">');
      assert.ok(/controls="\{\{false\}\}"/.test(wxml), '不用原生 controls（自制控制条 §11.3.2）');
      assert.ok(/autoplay="\{\{vauto\}\}"/.test(wxml), '自动开始（被拒时显示大播放键）');
      assert.ok(/object-fit="contain"/.test(wxml), '视频 contain letterbox');
      assert.ok(/bindtimeupdate="onVTime"/.test(wxml) && /binderror="onVErr"/.test(wxml), '时间/错误事件');
      assert.ok(/bindwaiting="onVWaiting"/.test(wxml) && /bindplaying="onVPlaying"/.test(wxml), '缓冲态事件');
      ['onVToggle', 'onVPrevPage', 'onVNextPage', 'onVRateTap', 'onVCopyLink', 'onVRestart'].forEach(function (h) {
        assert.ok(new RegExp('catchtap="' + h + '"').test(wxml), '控制条按钮 ' + h);
      });
      assert.ok(/onVBarTap/.test(wxml) && /onVTickTap/.test(wxml), '章节进度条点击 seek + 章节刻度点');
      assert.ok(/vticks/.test(wxml) && /vpct/.test(wxml) && /vtimeText/.test(wxml), '章节刻度/进度/时间');
      assert.ok(/class="pl-vdl"/.test(wxml) && /vdl && vdl\.on/.test(wxml), '下载降级进度 UI（§11.4）');
      assert.ok(/class="pl-vload"/.test(wxml) && /缓冲中…/.test(wxml), '加载/缓冲态（40–55MB 视频不白屏）');
      assert.ok(/class="pl-vbig"/.test(wxml), '暂停/autoplay 被拒的大播放键');
      assert.ok(/switchVideo/.test(wxml) && /switchStep/.test(wxml) && /原样/.test(wxml) && /分步/.test(wxml), '原样/分步模式胶囊');
      assert.ok(/onVTS/.test(wxml) && /onVTE/.test(wxml) && /class="pl-vhit"/.test(wxml), '点舞台显隐控制条 + 左右滑手势层');
      assert.ok(/bindtap="onVStageTap"/.test(wxml), '点舞台用 tap 事件显隐控制条（Element.tap 可验证）');
    });

    await test('PPT-V-G2 播放器 JS：降级链/downloadFile 可取消/章节 seek/倍速/续播/热点时序修复', function () {
      purge();
      const js = src('pages/ppt/pptplay/pptplay.js');
      assert.ok(/ppt\.chooseMode/.test(js), '默认模式由 utils 纯函数决定（§11.3.1）');
      assert.ok(/ppt\.videoStageNext/.test(js), '降级链状态机（§11.4）');
      assert.ok(/wx\.downloadFile/.test(js) && /_vDlTask/.test(js) && /abort/.test(js), 'downloadFile 降级 + 退出/切模式可取消');
      assert.ok(/onProgressUpdate/.test(js) && /_vDlProgress/.test(js), '下载进度 UI');
      assert.ok(/createVideoContext\('plv'/.test(js), 'VideoContext 控制同一个视频');
      assert.ok(/seek\(/.test(js) && /_vPageStep/.test(js) && /videoPrevNext/.test(js), '上一页/下一页按 chapters seek');
      assert.ok(/playbackRate/.test(js) && /ppt\.nextRate/.test(js), '倍速 playbackRate（1×/1.25×/1.5×/2×）');
      assert.ok(/setClipboardData/.test(js) && /可在浏览器下载\/播放/.test(js), '复制视频链接 + 短提示（§11.3.4）');
      assert.ok(/onVStageTap/.test(js) && /_toggleVCtrl/.test(js), '点舞台显隐控制条（tap 事件）');
      assert.ok(/resumeOf/.test(js) && /saveResume/.test(js) && /续播/.test(js), '续播存取');
      assert.ok(/saveMode/.test(js) && /modeOf/.test(js), '模式偏好本机记忆');
      assert.ok(/_vArmStartWatch/.test(js) && /V_START_TIMEOUT_MS|ppt\.V_START_TIMEOUT_MS/.test(js), '直连 5s 未起播降级');
      assert.ok(/_vDlArm/.test(js) && /V_DL_STALL_MS/.test(js), '下载降级无进度看门狗（不卡死）');
      assert.ok(/if \(!this\._vStarted\)[\s\S]{0,260}_vClearStartWatch/.test(js) || /时间就证明真的在播|timeupdate/.test(js), '以 timeupdate 判定起播（兼容不触发 bindplaying 的基础库）');
      assert.ok(/_vGoStep/.test(js) && /网络不佳，已切换分步浏览/.test(src('pages/ppt/utils/ppt.js')), '仍失败自动切分步 + toast');
      // 热点时序修复（§11.3.3）：图片 load / 转场结束 / resize 三处重算
      assert.ok(/onImgLoad\(\)[\s\S]{0,900}_updateHot\(\)/.test(js), '图片 load 后重算热点');
      assert.ok(/_bTimer = setTimeout[\s\S]{0,600}_updateHot\(\)/.test(js), '转场结束后重算热点');
      assert.ok(/onResize\(\)[\s\S]{0,220}_layoutSoon/.test(js), 'resize/orientation 重算布局与热点');
      const hot = js.match(/HOT_SIZE = (\d+)/);
      assert.ok(hot && Number(hot[1]) >= 56, '热点直径 ≥56px（§11.3.3），实际 ' + (hot && hot[1]));
      assert.ok(/vloading/.test(js) && /onVWaiting/.test(js), '缓冲态');
    });

    await test('PPT-V-G3 列表 v2.0 下载中心：整卡点击=详情 + 「兼容版/PDF」标签 + 上传/删除/重命名保留', function () {
      purge();
      const listJs = src('pages/ppt/ppt.js');
      const listWxml = src('pages/ppt/ppt.wxml');
      const listWxss = src('pages/ppt/ppt.wxss');
      // v2.0 §12.4.1：列表标签 = 轻查 manifest->files（不是整份 manifest），并有本机缓存兜底
      assert.ok(/filesMap/.test(listJs), '列表读取文件标签缓存');
      assert.ok(/filesOfDecks\(/.test(listJs), '批量轻查询 files 标签（§12.4.1）');
      assert.ok(/item\.tagCompat/.test(listWxml) && /item\.tagPdf/.test(listWxml), '卡片「兼容版」「PDF」小标签');
      assert.ok(/\.ppt-tag--compat/.test(listWxss) && /\.ppt-tag--pdf/.test(listWxss), '标签样式');
      // v2.0 §12.4.1：点击卡片 = 打开下载详情（不再直接进播放器）
      assert.ok(/openDeck/.test(listJs) && /bindtap="openDeck"/.test(listWxml), '整卡点击=下载详情');
      assert.ok(/\/pages\/ppt\/pptdl\/pptdl\?id=/.test(listJs), '跳转下载详情页');
      ['uploadTap', 'delTap|moreTap', 'retryTap', 'downloadSource|openSource', 'renameDeck'].forEach(function (k) {
        assert.ok(new RegExp(k).test(listJs), '保留原有能力 ' + k);
      });
      assert.ok(/bindlongpress="moreTap"/.test(listWxml), '长按更多保留');
    });

    await test('PPT-V-G4 红线：VERSION 2.0.4、页面配置不变、不新增 tabBar、不使用 wx.cloud', function () {
      purge();
      assert.ok(/VERSION = '2\.0\.4'/.test(src('utils/version.js')), 'VERSION 为 2.0.4');
      const play = JSON.parse(src('pages/ppt/pptplay/pptplay.json'));
      assert.strictEqual(play.navigationStyle, 'custom');
      assert.strictEqual(play.pageOrientation, 'auto');
      assert.strictEqual(play.disableScroll, true);
      const app = JSON.parse(src('app.json'));
      assert.strictEqual(allPages(app).indexOf('pages/ppt/pptplay/pptplay') >= 0, true);
      const wxml = src('pages/ppt/pptplay/pptplay.wxml');
      assert.ok(!/wx\.cloud/.test(wxml) && !/web-view/.test(wxml), '不引入云开发 SDK / web-view');
      assert.ok(/webp="\{\{true\}\}"/.test(wxml), '图片仍必须 webp=true（真机 .webp）');
    });

    /* ============================================================
     * H. 页面级行为（内存 wx mock）
     * ============================================================ */
    await test('PPT-V-H1 默认视频模式：manifest.video + wifi → 原样播放，直链 src + autoplay + 缓冲态', async function () {
      const r = await loadVideoPage(C);
      const ctx = r.ctx;
      assert.strictEqual(ctx.data.mode, 'video', '有 video 且 wifi → 默认原样播放（§11.3.1）');
      assert.strictEqual(ctx.data.vstage, 'direct', '先尝试 <video src=OSS直链>（§11.4 第 1 步）');
      assert.strictEqual(ctx.data.vsrc, 'https://oss.test/ppt/a/dabc/20261110/deck.mp4');
      assert.strictEqual(ctx.data.vauto, true);
      assert.strictEqual(ctx.data.vloading, true, '初始缓冲态（不白屏）');
      assert.strictEqual(ctx.data.vdur, 342.5);
      assert.strictEqual(ctx.data.vpages, 4);
      assert.strictEqual(ctx.data.vticks.length, 4, '章节刻度');
      assert.strictEqual(ctx.data.vtimeText, '00:00 / 05:42');
      assert.ok(ctx.data.vposter, 'poster 有画面');
      assert.ok(ctx.data.hasVideo);
      // 模拟播放起播 + 时间推进
      r.def.onVMeta.call(ctx, { detail: { duration: 342.5 } });
      r.def.onVPlaying.call(ctx);
      assert.strictEqual(ctx.data.vloading, false, '起播后关闭缓冲态');
      assert.strictEqual(ctx.data.vpaused, false);
      r.def.onVTime.call(ctx, { detail: { currentTime: 12 } });
      assert.strictEqual(ctx.data.vt, 12);
      assert.strictEqual(ctx.data.vtimeText, '00:12 / 05:42');
      assert.strictEqual(Math.round(ctx.data.vpct), 4, 'vpct 4%');
      assert.strictEqual(ctx.data.vpage, 2, '12s 落在第 2 章（t=8.7）');
      r.def.onUnload.call(ctx);
    });

    await test('PPT-V-H2 控制条：播放/暂停、章节上一页/下一页 seek、进度条 seek、倍速、复制链接、从头', async function () {
      const r = await loadVideoPage(C);
      const ctx = r.ctx;
      const def = r.def;
      def.onVMeta.call(ctx, { detail: { duration: 342.5 } });
      def.onVPlaying.call(ctx);
      // 播放/暂停
      def.onVToggle.call(ctx);
      assert.ok(C.videoCalls().indexOf('pause') >= 0, '暂停调用');
      def.onVToggle.call(ctx);
      const plays = C.videoCalls().filter(function (x) { return x === 'play'; }).length;
      assert.ok(plays >= 1, '播放调用');
      // 章节下一页：8.7 + 0.05
      def.onVTime.call(ctx, { detail: { currentTime: 2 } });
      def.onVNextPage.call(ctx);
      assert.ok(C.videoCalls().some(function (x) { return x === 'seek:8.75'; }), '下一页按 chapters seek（不是 ±10s）');
      assert.strictEqual(ctx.data.vt, 8.75);
      assert.strictEqual(ctx.data.vpage, 2);
      def.onVNextPage.call(ctx);
      assert.ok(C.videoCalls().some(function (x) { return x === 'seek:15.25'; }));
      def.onVPrevPage.call(ctx);
      assert.ok(C.videoCalls().some(function (x) { return x === 'seek:8.75'; }));
      // 第一页再上一页：提示「已是第一页」且不 seek
      def.onVTime.call(ctx, { detail: { currentTime: 0 } });
      const before = C.videoCalls().length;
      def.onVPrevPage.call(ctx);
      assert.strictEqual(C.videoCalls().length, before, '第一页不再 seek');
      assert.strictEqual(ctx.data.vhint, '已是第一页', '边界提示');
      // 章节刻度点：data-i 跳页
      def.onVTickTap.call(ctx, { currentTarget: { dataset: { i: 2, t: 15.2 } } });
      assert.ok(C.videoCalls().some(function (x) { return x === 'seek:15.25'; }), '刻度点按章节 seek');
      // 点舞台显隐控制条（不做 1/3 点击翻页）+ 左右滑=章节前后（当前 15.25s / 第 3 章）
      def._hideVCtrl.call(ctx);
      assert.strictEqual(ctx.data.vctrlOn, false);
      const pageBeforeTap = ctx.data.vpage;
      def.onVStageTap.call(ctx);
      assert.strictEqual(ctx.data.vctrlOn, true, '点舞台显示控制条');
      assert.strictEqual(ctx.data.vpage, pageBeforeTap, '点舞台不翻页（§11.3.2）');
      def.onVStageTap.call(ctx);
      assert.strictEqual(ctx.data.vctrlOn, false, '再点隐藏控制条');
      def.onVTS.call(ctx, { touches: [{ clientX: 300, clientY: 400 }] });
      def.onVTE.call(ctx, { changedTouches: [{ clientX: 100, clientY: 405 }] });
      assert.ok(C.videoCalls().some(function (x) { return x === 'seek:30.05'; }), '左滑 → 下一章节（30.05s）');
      def.onVTS.call(ctx, { touches: [{ clientX: 100, clientY: 400 }] });
      def.onVTE.call(ctx, { changedTouches: [{ clientX: 300, clientY: 402 }] });
      assert.ok(C.videoCalls().some(function (x) { return x === 'seek:15.25'; }), '右滑 → 上一章节（15.25s）');
      // 进度条点击 seek（x 在 [10,380] 内 → (200-10)/300 ≈ 63.3% → 217s 左右）
      def.onVTime.call(ctx, { detail: { currentTime: 10 } });
      def.onVBarTap.call(ctx, { changedTouches: [{ clientX: 160 }] });
      const seekCall = C.videoCalls().filter(function (x) { return x.indexOf('seek:') === 0; }).pop();
      assert.ok(/^seek:\d+/.test(seekCall), '进度条点击 seek；实际 ' + seekCall);
      const target = Number(String(seekCall).split(':')[1]);
      assert.ok(target > 150 && target < 200, '按 x 比例定位（50% → ~171s），实际 ' + target);
      // 倍速循环
      def.onVRateTap.call(ctx);
      assert.strictEqual(ctx.data.vrate, 1.25);
      assert.strictEqual(ctx.data.vrateText, '1.25×');
      assert.ok(C.videoCalls().indexOf('rate:1.25') >= 0, 'playbackRate 生效');
      def.onVRateTap.call(ctx); def.onVRateTap.call(ctx); def.onVRateTap.call(ctx);
      assert.strictEqual(ctx.data.vrate, 1, '循环回 1×');
      // 复制视频链接
      def.onVCopyLink.call(ctx);
      assert.strictEqual(C.clipLog()[0], 'https://oss.test/ppt/a/dabc/20261110/deck.mp4');
      assert.ok(C.toastLog().indexOf('可在浏览器下载/播放') >= 0, '短提示');
      // 从头
      def.onVRestart.call(ctx);
      assert.ok(C.videoCalls().some(function (x) { return x === 'seek:0'; }), '从头 seek 0');
      def.onUnload.call(ctx);
    });

    await test('PPT-V-H3 直连失败 → wx.downloadFile 降级（进度 → 临时文件播放）→ 临时文件失败 → 分步 + toast', async function () {
      const r = await loadVideoPage(C);
      const ctx = r.ctx;
      const def = r.def;
      // 第 1 步：<video src=直链> binderror → 进入下载
      def.onVErr.call(ctx);
      assert.strictEqual(ctx.data.vstage, 'download', '直连 binderror → downloadFile');
      assert.ok(ctx.data.vdl && ctx.data.vdl.on, '显示下载进度 UI');
      const dl = C.dl();
      assert.ok(dl && /deck\.mp4$/.test(dl.opts.url), '下载的是同一个 manifest.video URL');
      // 下载进度
      dl.task._cb({ progress: 34 });
      assert.strictEqual(ctx.data.vdl.pct, 34);
      assert.strictEqual(ctx.data.vdl.text, '下载 34%');
      assert.strictEqual(ctx.data.vloading, true);
      // 下载完成 → 临时文件播放（§11.4 第 2 步）
      dl.opts.success({ statusCode: 200, tempFilePath: 'wxfile://tmp_deck.mp4' });
      assert.strictEqual(ctx.data.vstage, 'temp');
      assert.strictEqual(ctx.data.vsrc, 'wxfile://tmp_deck.mp4', '改用 tempFilePath 播放');
      assert.strictEqual(ctx.data.vdl, null);
      assert.ok(ctx.data.vsrc.indexOf('http') !== 0, '不再直连 OSS');
      // 临时文件也失败 → 自动切分步（§11.4 第 3 步），不白屏
      def.onVErr.call(ctx);
      assert.strictEqual(ctx.data.mode, 'step', '仍失败自动切分步浏览');
      assert.ok(C.toastLog().indexOf('网络不佳，已切换分步浏览') >= 0, 'toast 提示');
      assert.strictEqual(ctx.data.state, 'ready', '页面不白屏');
      assert.strictEqual(pptModeOf(ctx), 'step', '记住设备偏好（切分步）');
      def.onUnload.call(ctx);
    });

    await test('PPT-V-H4 下载失败 → 自动分步 + 提示需配置 OSS 域名；下载任务退出时 abort', async function () {
      const r = await loadVideoPage(C);
      const ctx = r.ctx;
      const def = r.def;
      def.onVErr.call(ctx);
      const dl = C.dl();
      assert.strictEqual(ctx.data.vstage, 'download');
      dl.opts.fail();
      assert.strictEqual(ctx.data.mode, 'step', '下载失败 → 分步');
      assert.ok(C.toastLog().indexOf('网络不佳，已切换分步浏览') >= 0);
      assert.ok(/OSS/.test(ctx.data.vhint), '短提示「需配置 OSS 域名」');
      def.onUnload.call(ctx);
      // 下载无进度看门狗：20s 无进度 → 判失败并切分步（不卡死，§11.4）
      const r1b = await loadVideoPage(C);
      r1b.def.onVErr.call(r1b.ctx);
      assert.strictEqual(r1b.ctx.data.vstage, 'download');
      r1b.ctx._vDlSeenAt = Date.now() - 25000;
      const stalled = r1b.def._vDlCheck.call(r1b.ctx);
      assert.strictEqual(stalled, true, '触发无进度看门狗');
      assert.strictEqual(r1b.ctx.data.mode, 'step', '无进度 → 自动切分步（不卡死）');
      r1b.def.onUnload.call(r1b.ctx);
      // 退出时 abort 下载任务
      const r2 = await loadVideoPage(C);
      r2.def.onVErr.call(r2.ctx);
      const dl2 = C.dl();
      r2.def.onUnload.call(r2.ctx);
      assert.strictEqual(dl2.task.aborted, true, '退出播放器时取消下载（§11.4 可取消）');
    });

    await test('PPT-V-H5 模式切换：原样 → 分步（定位到当前视频章节页）→ 原样（章节 seek 回该页）', async function () {
      const r = await loadVideoPage(C);
      const ctx = r.ctx;
      const def = r.def;
      def.onVMeta.call(ctx, { detail: { duration: 342.5 } });
      def.onVPlaying.call(ctx);
      def.onVTime.call(ctx, { detail: { currentTime: 16 } });   // 第 3 章（page index 2）
      assert.strictEqual(ctx.data.vpage, 3);
      def.switchStep.call(ctx);
      assert.strictEqual(ctx.data.mode, 'step', '切到分步');
      assert.strictEqual(ctx.data.view.page, 3, '分步定位到当前视频章节对应页');
      assert.strictEqual(pptModeOf(ctx), 'step', '记住偏好');
      // 再切回原样：从当前分步页 seek 到该页章节
      def.switchVideo.call(ctx);
      assert.strictEqual(ctx.data.mode, 'video', '切回原样');
      assert.ok(ctx.data.vstage === 'direct' || ctx.data.vstage === 'temp');
      assert.ok(ctx.data.vt >= 15.2 && ctx.data.vt <= 15.4, '按当前页章节 seek（15.25），实际 ' + ctx.data.vt);
      assert.strictEqual(pptModeOf(ctx), 'video');
      def.onUnload.call(ctx);
    });

    await test('PPT-V-H6 续播：本机记录（视频 05:42）→ 打开自动定位；暂停/退出落盘；播完清除', async function () {
      const C2 = createCtx();
      global.wx = C2.wxMock;
      try {
        const now = Date.now();
        const r = await loadVideoPage(C2, { resume: { dabc123456xy: { mode: 'video', t: 342, dur: 400, at: now } } });
        const ctx = r.ctx;
        assert.strictEqual(ctx.data.mode, 'video');
        assert.ok(ctx.data.vt >= 341.9 && ctx.data.vt <= 342.1, '自动续播到 05:42，实际 ' + ctx.data.vt);
        assert.ok(C2.toastLog().some(function (t) { return /续播 05:42/.test(String(t)); }), 'toast「续播 05:42」');
        // 暂停落盘
        r.def.onVMeta.call(ctx, { detail: { duration: 400 } });
        r.def.onVPlaying.call(ctx);
        r.def.onVTime.call(ctx, { detail: { currentTime: 350 } });
        r.def.onVPause.call(ctx);
        const saved = C2.mem['zq_ppt_resume_v1']['dabc123456xy'];
        assert.ok(saved && saved.mode === 'video' && Math.round(saved.t) === 350, '暂停落盘 t=350');
        // 播完 → 清除记录（列表不再显示「继续」）
        r.def.onVEnded.call(ctx);
        assert.strictEqual(C2.mem['zq_ppt_resume_v1']['dabc123456xy'], undefined, '播完清除续播');
        r.def.onUnload.call(ctx);
      } finally {
        global.wx = C.wxMock;
      }
    });

    await test('PPT-V-H7 弱网默认分步（2g）：即使有 video 也走分步浏览；切原样仍可用', async function () {
      const C3 = createCtx();
      global.wx = C3.wxMock;
      try {
        const r = await loadVideoPage(C3, { net: '2g' });
        const ctx = r.ctx;
        assert.strictEqual(ctx.data.mode, 'step', '2g → 默认分步（§11.3.1）');
        assert.strictEqual(ctx.data.vsrc, '', '不加载 40–55MB 视频');
        assert.strictEqual(ctx.data.view.page, 1);
        // 用户手动切原样（弱网也能选，记住偏好）
        r.def.switchVideo.call(ctx);
        assert.strictEqual(ctx.data.mode, 'video');
        assert.ok(ctx.data.vsrc, '手动切换后开始加载视频');
        const ppt = require(path.join(ROOT, 'pages/ppt/utils/ppt.js'));
        assert.strictEqual(ppt.modeOf('dabc123456xy'), 'video', '手动切换后记住设备偏好');
        r.def.onUnload.call(ctx);
      } finally {
        global.wx = C.wxMock;
      }
    });

    await test('PPT-V-H8 分步模式续播：记录 {idx:2} → 打开定位第 2 步并提示；热点尺寸与重算接线', async function () {
      const C4 = createCtx();
      global.wx = C4.wxMock;
      try {
        const now = Date.now();
        // 无 video 的 manifest（旧 deck）→ 默认分步；第 1 页做成 2 个 step，便于验证 (页,步) 续播
        const manifest = manifestWithVideo();
        delete manifest.video;
        manifest.slides[0].steps = [
          { img: 's1-1.webp', media: [{ s: 'm0.mp4', k: 'v', x: 0.1, y: 0.2, w: 0.5, h: 0.6 }] },
          { img: 's1-2.webp' }
        ];
        const r = await loadVideoPage(C4, {
          manifest: manifest,
          resume: { dabc123456xy: { mode: 'step', page: 0, step: 1, idx: 1, pt: 4, n: 5, at: now } }
        });
        const ctx = r.ctx;
        assert.strictEqual(ctx.data.mode, 'step', '无 video → 分步（§11.3.1）');
        assert.strictEqual(ctx.data.view.idx, 1, '自动续播到记录的 step');
        assert.strictEqual(ctx.data.view.step, 2);
        assert.ok(C4.toastLog().some(function (t) { return /续播/.test(String(t)); }), '续播提示');
        // 热点：第 1 页有 1 个视频热点，尺寸 ≥56px
        r.def._go.call(ctx, 0);
        assert.strictEqual(ctx.data.hot.length, 1);
        assert.ok(ctx.data.hot[0].size >= 56, '热点直径 ≥56px，实际 ' + ctx.data.hot[0].size);
        assert.ok(/视频 \d+:\d\d/.test(ctx.data.hot[0].badge), '时长角标：' + ctx.data.hot[0].badge);
        r.def.onUnload.call(ctx);
      } finally {
        global.wx = C.wxMock;
      }
    });
  } finally {
    global.wx = prevWx;
  }
}
// 读取当前页面 mode 偏好（H 用例辅助）
function pptModeOf(ctx) {
  try {
    const ppt = require(path.join(ROOT, 'pages/ppt/utils/ppt.js'));
    return ppt.modeOf(ctx._id);
  } catch (e) { return ''; }
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
    fs.writeFileSync(path.join(__dirname, 'ppt_video_result.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log('\n================ ppt-video: ' + passN + ' passed, ' + failN + ' failed ================');
    process.exit(failN ? 2 : 0);
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}
