/* ppt_ecs_unit_tests.js —— PPT 在线媒体 ECS /pptfiles 映射单测（2026-11-18 迁移优化）
 *
 * 背景：网页端（commit f0a829e）已把 OSS 香港 `tool-furina-fun.oss-cn-hongkong.aliyuncs.com/ppt/**`
 * 媒体映射到 ECS `/pptfiles/<path>` 缓存；小程序的在线预览/原样播放/下载复用同一映射。
 *
 * 覆盖：
 *   A. pptEcsUrl 纯函数：本桶 /ppt/** → ECS；data:/file:/外域/非 /ppt 路径/相对引用 原样；
 *      编码路径与 ?query 保留；http/https 与大小写 host；
 *   B. base 规则：缺省 = cloud-config.webBase + '/pptfiles'；自定义 base（devtools http IP）覆盖；
 *      enabled:false → 回滚 OSS 直链；
 *   C. manifest 归一化集成：slides.steps[].img / slide.thumbUrl / video.url / files.url /
 *      media_files.url / src / 热点 media url 全部映射；data: 图原样。
 */
'use strict';

const path = require('path');
const assert = require('assert');

const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');
const ROOT_N = ROOT.replace(/\\/g, '/');
const OSS = 'https://tool-furina-fun.oss-cn-hongkong.aliyuncs.com';
const ECS = 'https://tool.furina.fun/pptfiles';

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

function createWx() {
  const mem = Object.create(null);
  return {
    mem: mem,
    wx: {
      getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
      setStorageSync(k, v) { mem[k] = v; },
      removeStorageSync(k) { delete mem[k]; },
      getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 0, limitSize: 10240 }; },
      request(o) { o.success({ statusCode: 200, data: [] }); },
      showToast() {}, showLoading() {}, hideLoading() {},
      getSystemInfoSync() { return { windowWidth: 390, windowHeight: 844, SDKVersion: '3.0.0' }; },
      getAppBaseInfo() { return { SDKVersion: '3.0.0' }; },
      getWindowInfo() { return { windowWidth: 390, windowHeight: 844, pixelRatio: 3 }; }
    }
  };
}

function withConfig(mutator, fn) {
  const cfg = require(path.join(ROOT, 'utils/cloud-config.js'));
  const saved = { webBase: cfg.webBase, pptEcs: Object.assign({}, cfg.pptEcs) };
  try {
    if (mutator) mutator(cfg);
    return fn(cfg);
  } finally {
    cfg.webBase = saved.webBase;
    cfg.pptEcs = saved.pptEcs;
  }
}

function run(test) {
  return (async () => {
    await test('PPT-ECS A1：本桶 /ppt/** 映射到 webBase+/pptfiles（编码路径与 ?query 保留）', function () {
      purge();
      const ctx = createWx();
      global.wx = ctx.wx;
      const ppt = require(path.join(ROOT, 'pages/ppt/utils/ppt.js'));
      withConfig(null, function () {
        assert.strictEqual(ppt.pptEcsUrl(OSS + '/ppt/a/d1/b0/s1-1.webp'), ECS + '/ppt/a/d1/b0/s1-1.webp');
        // 视频 + query 原样保留（Range/缓存参数不丢）
        assert.strictEqual(ppt.pptEcsUrl(OSS + '/ppt/a/d1/b0/deck.mp4?from=web'), ECS + '/ppt/a/d1/b0/deck.mp4?from=web');
        // 中文/编码路径原样保留（Caddy 解码后按 OSS pathname 命中缓存）
        const encoded = '/ppt/a/d1/b0/media/%E6%9C%AC%E8%8D%89_%E8%A7%86%E9%A2%911_%E7%AC%AC7%E9%A1%B5.mp4';
        assert.strictEqual(ppt.pptEcsUrl(OSS + encoded), ECS + encoded);
        const raw = '/ppt/a/d1/b0/media/视频1_第7页.mp4';
        assert.strictEqual(ppt.pptEcsUrl(OSS + raw), ECS + raw);
        // scheme/host 大小写不敏感（URL host 不区分大小写）
        assert.strictEqual(ppt.pptEcsUrl('HTTPS://TOOL-FURINA-FUN.OSS-CN-HONGKONG.ALIYUNCS.COM/ppt/a/x.webp'),
          ECS + '/ppt/a/x.webp');
        assert.strictEqual(ppt.pptEcsUrl('http://tool-furina-fun.oss-cn-hongkong.aliyuncs.com/ppt/a/x.webp'),
          ECS + '/ppt/a/x.webp');
      });
    });

    await test('PPT-ECS A2：不映射（data:/file:/本地路径/其它域名/非 /ppt 路径/已 ECS 地址）原样返回', function () {
      purge();
      const ctx = createWx();
      global.wx = ctx.wx;
      const ppt = require(path.join(ROOT, 'pages/ppt/utils/ppt.js'));
      withConfig(null, function () {
        [
          'data:image/webp;base64,AAAA',
          'file:///tmp/a.webp',
          'content://media/external/a.webp',
          '/local/tmp/a.webp',
          'wxfile://tmp/a.webp',
          'https://cdn.example.com/ppt/a/x.webp',                 // 其它域名（即使路径像 /ppt/）
          'https://tool-furina-fun.oss-cn-hongkong.aliyuncs.com/android/latest.json', // 本桶非 /ppt 路径
          'https://tool-furina-fun.oss-cn-hongkong.aliyuncs.com/ppt-media/a.webp',     // 前缀不是 /ppt/
          'https://tool-furina-fun.oss-cn-hongkong.aliyuncs.com/ppt',                 // 无尾斜杠
          ECS + '/ppt/a/x.webp',                                   // 已映射地址幂等
          '',
          's1-1.webp'
        ].forEach(function (u) {
          assert.strictEqual(ppt.pptEcsUrl(u), u, '不应映射：' + u);
        });
      });
    });

    await test('PPT-ECS B1：base 规则（缺省 webBase+/pptfiles / 自定义 HTTPS base / enabled:false 回滚）', function () {
      purge();
      const ctx = createWx();
      global.wx = ctx.wx;
      const ppt = require(path.join(ROOT, 'pages/ppt/utils/ppt.js'));
      // 1) 缺省：webBase(https://tool.furina.fun) + /pptfiles
      withConfig(null, function (cfg) {
        cfg.pptEcs = { enabled: true, base: '' };
        assert.strictEqual(ppt.pptEcsBase(), ECS);
        assert.strictEqual(ppt.pptEcsUrl(OSS + '/ppt/a/x.webp'), ECS + '/ppt/a/x.webp');
      });
      // 2) 自定义 base（私有部署/调试）：HTTPS；尾斜杠被归一
      withConfig(function (cfg) { cfg.pptEcs = { enabled: true, base: 'https://cdn.example.com/pptfiles/' }; }, function () {
        assert.strictEqual(ppt.pptEcsBase(), 'https://cdn.example.com/pptfiles');
        assert.strictEqual(ppt.pptEcsUrl(OSS + '/ppt/a/x.webp'), 'https://cdn.example.com/pptfiles/ppt/a/x.webp');
      });
      // 3) enabled:false → OSS 直链（回滚旧行为）
      withConfig(function (cfg) { cfg.pptEcs = { enabled: false, base: '' }; }, function () {
        assert.strictEqual(ppt.pptEcsBase(), '');
        assert.strictEqual(ppt.pptEcsUrl(OSS + '/ppt/a/x.webp'), OSS + '/ppt/a/x.webp');
      });
      // 4) webBase 为空 + 未自定义 base → 不映射（不会拼出坏地址）
      withConfig(function (cfg) { cfg.webBase = ''; cfg.pptEcs = { enabled: true, base: '' }; }, function () {
        assert.strictEqual(ppt.pptEcsUrl(OSS + '/ppt/a/x.webp'), OSS + '/ppt/a/x.webp');
      });
    });

    await test('PPT-ECS C1：manifest 归一化后 img/thumb/video/files/media_files/src/热点全部走 /pptfiles', function () {
      purge();
      const ctx = createWx();
      global.wx = ctx.wx;
      const ppt = require(path.join(ROOT, 'pages/ppt/utils/ppt.js'));
      withConfig(null, function () {
        const raw = {
          v: 2,
          base: OSS + '/ppt/a/d1/b0/',
          src: OSS + '/ppt/src/d1/source.pptx',
          w: 1600, h: 900,
          slides: [
            {
              thumb: 't1.webp',
              steps: [{
                img: 's1-1.webp',
                media: [
                  { s: 'media/v1.mp4', k: 'v', x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
                  { s: 'data:image/webp;base64,AAAA', k: 'v', x: 0, y: 0, w: 0.1, h: 0.1 }
                ]
              }],
              notes: ''
            }
          ],
          video: { s: 'deck.mp4', w: 1280, h: 720, dur: 10, chapters: [{ i: 0, t: 0 }] },
          files: {
            compat: { s: 'compat.pptx', size: 100 },
            pdf: { s: 'preview.pdf', size: 50, pages: 3 },
            source: { s: 'original.pptx', size: 200 }
          },
          media_files: [{ s: 'media/视频1_第7页.mp4', kind: 'video', size: 1, dur: 1, slides: [1] }],
          media: [{ s: 'media/v1.mp4', k: 'v', w: 1024, h: 576, dur: 3 }]
        };
        const m = ppt.normManifest(raw);
        assert.ok(m, 'manifest 应解析成功');
        assert.strictEqual(m.slides[0].steps[0].url, ECS + '/ppt/a/d1/b0/s1-1.webp');
        assert.strictEqual(m.slides[0].thumbUrl, ECS + '/ppt/a/d1/b0/t1.webp');
        assert.strictEqual(m.slides[0].steps[0].media[0].url, ECS + '/ppt/a/d1/b0/media/v1.mp4');
        assert.strictEqual(m.slides[0].steps[0].media[1].url, 'data:image/webp;base64,AAAA', 'data: 媒体原样');
        assert.strictEqual(m.video.url, ECS + '/ppt/a/d1/b0/deck.mp4');
        assert.strictEqual(m.files.compat.url, ECS + '/ppt/a/d1/b0/compat.pptx');
        assert.strictEqual(m.files.pdf.url, ECS + '/ppt/a/d1/b0/preview.pdf');
        assert.strictEqual(m.files.source.url, ECS + '/ppt/a/d1/b0/original.pptx');
        assert.strictEqual(m.media_files[0].url, ECS + '/ppt/a/d1/b0/media/视频1_第7页.mp4');
        assert.strictEqual(m.src, ECS + '/ppt/src/d1/source.pptx');
        // 扁平 step 序列/缩略图列表/预加载计划派生 URL 同样已映射
        assert.strictEqual(ppt.flatSteps(m)[0].url, ECS + '/ppt/a/d1/b0/s1-1.webp');
        assert.strictEqual(ppt.thumbList(m)[0].url, ECS + '/ppt/a/d1/b0/t1.webp');
        const plan = ppt.preloadPlan(m, 0);
        assert.ok(plan.steps.every(function (u) { return u.indexOf(ECS + '/') === 0; }), '预加载 URL 应全部映射');
      });
    });

    await test('PPT-ECS C2：mock/外域 base 的 manifest 不受影响（旧行为不回退）', function () {
      purge();
      const ctx = createWx();
      global.wx = ctx.wx;
      const ppt = require(path.join(ROOT, 'pages/ppt/utils/ppt.js'));
      withConfig(null, function () {
        const raw = { base: 'https://mock.oss.test/ppt/a/d1/b0/', slides: [{ steps: [{ img: 's1.webp' }] }], w: 1600, h: 900 };
        const m = ppt.normManifest(raw);
        assert.strictEqual(m.slides[0].steps[0].url, 'https://mock.oss.test/ppt/a/d1/b0/s1.webp');
        // 相对引用无 base → 保持相对（调用方自行处理）
        const m2 = ppt.normManifest({ slides: [{ steps: [{ img: 'rel.webp' }] }], w: 1600, h: 900 });
        assert.strictEqual(m2.slides[0].steps[0].url, 'rel.webp');
      });
    });

    await test('PPT-ECS C3：封面 cover_url 经同一 helper 映射（列表/详情/播放器首帧）', function () {
      purge();
      const ctx = createWx();
      global.wx = ctx.wx;
      const ppt = require(path.join(ROOT, 'pages/ppt/utils/ppt.js'));
      const fs = require('fs');
      withConfig(null, function () {
        const oss = OSS;
        const ecs = ECS;
        const cover = oss + '/ppt/a/dmwalrdlgevz90l/c0e5834805/cover.webp';
        const mapped = ecs + '/ppt/a/dmwalrdlgevz90l/c0e5834805/cover.webp';
        const deck = { id: 'd1', title: '演示', status: 'ready', created_at: 1, cover_url: cover };

        // 1) 列表卡片（deckView/listView）：cover 映射，hasCover 仍按非空判断
        const v = ppt.deckView(deck, { sid: '3260799999' });
        assert.strictEqual(v.cover, mapped);
        assert.strictEqual(v.hasCover, true);
        const rows = ppt.listView([deck], { sid: '3260799999' });
        assert.strictEqual(rows[0].cover, mapped);

        // 2) 下载详情页（downloadDetailView）：cover 映射
        const dv = ppt.downloadDetailView(null, deck, { sid: '3260799999' });
        assert.strictEqual(dv.cover, mapped);

        // 3) 非本桶 / data: / 空封面原样（不误伤）
        assert.strictEqual(ppt.deckView({ id: 'd2', status: 'ready', cover_url: 'https://cdn.example.com/c.webp' }, {}).cover,
          'https://cdn.example.com/c.webp');
        assert.strictEqual(ppt.deckView({ id: 'd3', status: 'ready', cover_url: 'data:image/webp;base64,AAAA' }, {}).cover,
          'data:image/webp;base64,AAAA');
        const noCover = ppt.deckView({ id: 'd4', status: 'ready' }, {});
        assert.strictEqual(noCover.cover, '');
        assert.strictEqual(noCover.hasCover, false);
        assert.strictEqual(ppt.deckView({ id: 'd5', status: 'ready', cover_url: '' }, {}).cover, '');

        // 4) 播放器首帧：pages/pptplay 用 ppt.pptEcsUrl 包裹 _deck.cover_url（静态接线断言，防回退直连）
        const page = fs.readFileSync(path.join(ROOT, 'pages/ppt/pptplay/pptplay.js'), 'utf8');
        assert.ok(/const cover = ppt\.pptEcsUrl\(String\(\(self\._deck && self\._deck\.cover_url\) \|\| ''\)\);/.test(page),
          'pptplay 首帧封面必须经 ppt.pptEcsUrl 映射');

        // 5) 无覆盖/外域封面的 deckView 仍可正常渲染（show/playable 字段不受影响）
        assert.ok(v.playable === true || v.playable === false);
      });
    });
  })();
}

module.exports = { run: run };

/* 独立运行：node ppt_ecs_unit_tests.js */
if (require.main === module) {
  let passN = 0, failN = 0;
  const test = async function (name, fn) {
    try { await fn(); passN++; console.log('PASS  ' + name); }
    catch (e) { failN++; console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
  };
  module.exports.run(test).then(function () {
    console.log('\n================ ppt ecs unit: ' + passN + ' passed, ' + failN + ' failed ================');
    process.exitCode = failN ? 2 : 0;
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}
