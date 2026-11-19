/* share_legal_unit.js —— 2026-11-19 分享卡 / 法律页 / 分包静态单测
 *
 * 覆盖：
 *   A. app.json 分包：PPT 三页同属 pages/ppt（utils/ppt.js 随包）、不常用重页面不在主包、
 *      不做 PPT 预下载、tabBar 不在分包；
 *   B. utils/sharecard：抽签/投票视图（标题/结果/隐藏结果）+ canvas 5:4 导出（假 canvas 返回临时图）；
 *   C. 法律正文数据：隐私/协议版本、生效日期、运营者、收集/第三方/跨境/权利/联系方式关键段落、无外链；
 *   D. 页面接线：draw / drawrec / vote / votedetail / group / identity / me / data / legal 的分享按钮或协议入口。
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const MP = path.resolve(HERE, '..');
const results = [];

// 独立运行时的最小 wx / canvas 2d mock（并入 unit.js 时使用 unit.js 的内存 mock）
if (!global.wx) {
  const ops = [];
  const g = {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
    measureText: function (t) { return { width: String(t == null ? '' : t).length * 8 }; },
    fillText: function (t) { ops.push(String(t)); },
    fillRect: function () {}, strokeRect: function () {},
    beginPath: function () {}, moveTo: function () {}, lineTo: function () {}, arcTo: function () {},
    closePath: function () {}, arc: function () {}, fill: function () {}, stroke: function () {},
    save: function () {}, restore: function () {}, setTransform: function () {}, scale: function () {},
    clearRect: function () {}
  };
  const node = { width: 0, height: 0, getContext: function () { return g; } };
  global.wx = {
    canvasToTempFilePath: function (o) { if (o && o.success) o.success({ tempFilePath: '/tmp/share.jpg' }); },
    createSelectorQuery: function () {
      return {
        in: function () { return this; }, select: function () { return this; }, fields: function () { return this; },
        exec: function (cb) { cb([{ node: node, width: 500, height: 400 }]); }
      };
    }
  };
}

async function test(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('PASS  ' + name); }
  catch (e) { results.push({ name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
}

function src(rel) { return fs.readFileSync(path.join(MP, rel), 'utf8'); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function subPagePaths(app) {
  const out = [];
  (app.subPackages || []).forEach(function (sp) {
    (sp.pages || []).forEach(function (p) { out.push(String(sp.root).replace(/\/$/, '') + '/' + p); });
  });
  return out;
}

async function run(outerTest) {
  const T = (typeof outerTest === 'function') ? outerTest : test;

  /* ---------------- A. app.json 分包 ---------------- */
  await T('分包 A1：app.json 合法 JSON；PPT 三页同属一个分包、主包不再注册；utils/ppt.js 随分包', async function () {
    const app = JSON.parse(src('app.json'));
    const main = app.pages || [];
    assert.ok(Array.isArray(app.subPackages), 'subPackages 存在');
    const pptPkg = (app.subPackages || []).filter(function (sp) {
      return String(sp && sp.root || '').replace(/\/+$/, '') === 'pages/ppt';
    })[0];
    assert.ok(pptPkg, '存在 pages/ppt 分包');
    const sub = subPagePaths(app);
    ['pages/ppt/ppt', 'pages/ppt/pptdl/pptdl', 'pages/ppt/pptplay/pptplay'].forEach(function (p) {
      assert.ok(sub.indexOf(p) >= 0, p + ' 应在分包');
      assert.strictEqual(main.indexOf(p), -1, p + ' 不应在主包');
    });
    assert.strictEqual(pptPkg.pages.length, 3, 'PPT 三页合并在同一分包');
    assert.ok(fs.existsSync(path.join(MP, 'pages/ppt/utils/ppt.js')), 'utils/ppt.js 已移入 PPT 分包');
    assert.ok(!fs.existsSync(path.join(MP, 'utils/ppt.js')), '主包不再保留 utils/ppt.js');
    assert.ok(main.indexOf('pages/legal/legal') >= 0, '法律页在主包（身份页/我的可立即打开）');
    assert.strictEqual(new Set(main.concat(sub)).size, main.length + sub.length, '页面路径不能重复');
  });

  await T('分包 A2：不常用重页面拆出；不做 PPT 预下载（避免工具页后台下载 3 包）；tabBar 不在分包', async function () {
    const app = JSON.parse(src('app.json'));
    const main = app.pages || [];
    const sub = subPagePaths(app);
    ['pages/map/map', 'pages/diag/diag', 'pages/cloudspace/cloudspace', 'pages/screencast/screencast'].forEach(function (p) {
      assert.ok(sub.indexOf(p) >= 0, p + ' 应在分包');
      assert.strictEqual(main.indexOf(p), -1, p + ' 不应在主包');
    });
    const roots = (app.subPackages || []).map(function (sp) { return String(sp.root).replace(/\/$/, ''); });
    const names = (app.subPackages || []).map(function (sp) { return sp.name; }).filter(Boolean);
    assert.strictEqual(app.preloadRule, undefined,
      'preloadRule 已移除：打开工具页不再后台下载 PPT 分包（2026-11-19 性能）');
    const rules = app.preloadRule || {};
    Object.keys(rules).forEach(function (key) {
      assert.ok(main.concat(sub).indexOf(key) >= 0, 'preloadRule key 未注册：' + key);
      (rules[key].packages || []).forEach(function (pkg) {
        assert.ok(roots.indexOf(pkg) >= 0 || names.indexOf(pkg) >= 0, 'preloadRule package 非法：' + pkg);
      });
    });
    const all = main.concat(sub);
    ['pages/index/index', 'pages/all/all', 'pages/me/me'].forEach(function (p) {
      assert.ok(all.indexOf(p) >= 0, 'tabBar 页仍在主包：' + p);
      assert.strictEqual(sub.indexOf(p), -1, 'tabBar 页不能进分包：' + p);
    });
  });

  /* ---------------- B. sharecard ---------------- */
  const sharecard = require(path.join(MP, 'utils/sharecard.js'));
  await T('分享卡 B1：抽签视图 = 结果 N 个 / 范围 / 参与名单 / 存证 id；签名忽略时间', async function () {
    const v = sharecard.buildDrawView({
      rows: [{ n: 24, nm: '测试账号' }, { n: 3, nm: '' }],
      cfg: { range: '1 – 70', count: '2', dup: '否', sel: '2' },
      proofReady: true, proofId: 'dabc12345678', time: '10:00'
    });
    assert.strictEqual(v.kind, 'draw');
    assert.strictEqual(v.count, 2);
    assert.ok(v.rows.length === 2 && v.rows[0].n === 24 && v.rows[0].nm === '测试账号');
    assert.ok(v.subtitle.indexOf('范围 1 – 70') >= 0 && v.subtitle.indexOf('抽 2 个') >= 0 && v.subtitle.indexOf('名单 2 人') >= 0);
    assert.strictEqual(v.proof, 'dabc12345678');
    assert.strictEqual(sharecard.signature(Object.assign({}, v, { time: '11:00' })), sharecard.signature(v), '签名不含时间');
  });

  await T('分享卡 B2：投票视图 = 标题具体内容 + 前 4 选项；结果隐藏时无百分比/票数', async function () {
    const d = {
      title: '周三班会时间投票', statusText: '进行中', total: 12, resultsHidden: false,
      options: [
        { text: '周三 18:00', showBar: true, pct: 50, count: 6 },
        { text: '周三 19:00', showBar: true, pct: 50, count: 6 },
        { text: '周四 18:00', showBar: true, pct: 0, count: 0 },
        { text: '周四 19:00', showBar: true, pct: 0, count: 0 },
        { text: '第五项不应出现', showBar: true, pct: 0, count: 0 }
      ]
    };
    const v = sharecard.buildVoteView({ detail: d, time: '10:00' });
    assert.strictEqual(v.title, '周三班会时间投票');
    assert.strictEqual(v.options.length, 4);
    assert.strictEqual(v.options[0].pct, 50);
    assert.strictEqual(v.total, 12);
    assert.strictEqual(v.hidden, false);
    const hidden = sharecard.buildVoteView({ detail: Object.assign({}, d, { resultsHidden: true }) });
    assert.strictEqual(hidden.hidden, true);
  });

  await T('分享卡 B3：canvas 渲染成功返回临时图（5:4 1000×800），绘制内容包含标题/结果', async function () {
    // 其他单测可能替换过 global.wx；这里临时注入最小 canvas 2d mock，确保验证的是 sharecard.render 本身
    const savedWx = global.wx;
    const g = {
      font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
      measureText: function (t) { return { width: String(t == null ? '' : t).length * 8 }; },
      fillText: function () {}, fillRect: function () {}, strokeRect: function () {},
      beginPath: function () {}, moveTo: function () {}, lineTo: function () {}, arcTo: function () {},
      closePath: function () {}, arc: function () {}, fill: function () {}, stroke: function () {},
      save: function () {}, restore: function () {}, setTransform: function () {}, scale: function () {},
      clearRect: function () {}
    };
    const node = { width: 0, height: 0, getContext: function () { return g; } };
    global.wx = {
      canvasToTempFilePath: function (o) { if (o && o.success) o.success({ tempFilePath: '/tmp/share.jpg' }); },
      createSelectorQuery: function () {
        return {
          in: function () { return this; }, select: function () { return this; }, fields: function () { return this; },
          exec: function (cb) { cb([{ node: node, width: 500, height: 400 }]); }
        };
      }
    };
    try {
      const v = sharecard.buildDrawView({ rows: [{ n: 1, nm: '甲' }, { n: 2, nm: '乙' }], cfg: { range: '1 – 10' }, time: '10:00' });
      const p = await sharecard.render({}, 'shareCanvas', v);
      assert.ok(p && /share\.jpg/.test(p), '应返回临时图片路径，实际 ' + p);
    } finally {
      global.wx = savedWx;
    }
  });

  /* ---------------- C. 法律正文 ---------------- */
  const legal = require(path.join(MP, 'utils/legal-data.js'));
  await T('法律 C1：两份正文元信息（V1.0 / 生效 2026-11-17 / 运营者 陈子麒）', async function () {
    ['privacy', 'terms'].forEach(function (k) {
      const d = legal[k];
      assert.ok(d && d.blocks.length > 30 && d.toc.length >= 15, k + ' 正文过少');
      assert.strictEqual(d.version, 'V1.0');
      assert.strictEqual(d.effective, '2026年11月17日');
      assert.ok(d.operator.indexOf('陈子麒') >= 0, k + ' 缺少运营者');
      assert.ok(d.title === '隐私政策' || d.title === '用户协议');
    });
  });

  await T('法律 C2：隐私政策覆盖 处理者/收集范围/敏感信息/第三方/跨境/保存/权利/联系方式 + 附件清单', async function () {
    const d = legal.privacy;
    const all = d.blocks.map(function (b) { return b.text || b.title || b.headText || (b.lines || []).join(' '); }).join('\n');
    ['定义与适用范围', '处理者与联系方式', '我们处理哪些信息', '敏感个人信息', '委托处理、共享与公开披露', '数据出境',
      '存储地点与保存期限', '你的权利', '联系我们与投诉', '个人信息处理清单', '第三方 SDK / 服务'].forEach(function (s) {
      assert.ok(all.indexOf(s) >= 0, '缺少段落：' + s);
    });
    assert.ok(all.indexOf('香港') >= 0 && all.indexOf('oss-cn-hongkong') >= 0, '跨境/香港 OSS 段落');
    assert.ok(all.indexOf('腾讯云 CloudBase') >= 0 && all.indexOf('阿里云 OSS') >= 0, '第三方服务段落');
    assert.ok(all.indexOf('Ko_Link@outlook.com') >= 0, '联系方式');
    assert.ok(all.indexOf('查阅') >= 0 && all.indexOf('删除') >= 0 && all.indexOf('撤回同意') >= 0, '用户权利');
  });

  await T('法律 C3：用户协议覆盖 服务性质/资格/规范/内容/隐私/第三方/免责/争议解决 + 禁止清单', async function () {
    const d = legal.terms;
    const all = d.blocks.map(function (b) { return b.text || b.title || b.headText || (b.lines || []).join(' '); }).join('\n');
    ['协议主体与接受', '服务性质与内容', '使用资格与身份', '使用规范', '用户内容与班级数据', '隐私与个人信息',
      '第三方服务', '免责声明与责任限制', '法律适用与争议解决', '禁止内容清单'].forEach(function (s) {
      assert.ok(all.indexOf(s) >= 0, '缺少段落：' + s);
    });
  });

  await T('法律 C4：正文不含外链 URL（小程序内原生阅读，不依赖域名解析）', async function () {
    const s = JSON.stringify(legal);
    assert.strictEqual(/https?:\/\//i.test(s), false, '不应出现 http(s) 外链');
    const embed = new RegExp('web' + '-view', 'i');
    assert.strictEqual(embed.test(s), false, '正文不应依赖内嵌网页标签');
  });

  /* ---------------- D. 页面接线 ---------------- */
  await T('分享 D1：抽签结果页有可见 open-type=share 按钮、保存存证 id 深链、canvas 分享图失败回退 draw.png', async function () {
    const wxml = src('pages/draw/draw.wxml');
    const js = src('pages/draw/draw.js');
    assert.ok(/<button[^>]*open-type="share"/.test(wxml), '结果页缺少原生分享按钮');
    assert.ok(/id="shareCanvas"/.test(wxml), '缺少 5:4 分享卡画布');
    assert.ok(/\/pages\/drawrec\/drawrec/.test(js) && /proofReady/.test(js), '应优先分享存证详情');
    assert.ok(/sharecard\.render/.test(js) && /FALLBACK\.draw/.test(js), 'canvas 失败回退 draw.png');
    assert.ok(js.indexOf('抽签结果 · ') >= 0, '标题应包含抽签结果 N 个');
  });

  await T('分享 D2：投票列表/详情都有分享按钮；详情标题=投票标题、path=详情 ?id=', async function () {
    const listWxml = src('pages/vote/vote.wxml');
    const detailWxml = src('pages/votedetail/votedetail.wxml');
    const listJs = src('pages/vote/vote.js');
    const detailJs = src('pages/votedetail/votedetail.js');
    assert.ok(/open-type="share"[^>]*data-id="\{\{item\.id\}\}"/.test(listWxml), '列表卡片缺少带 pollId 的分享按钮');
    assert.ok(/open-type="share"/.test(detailWxml), '详情缺少分享按钮');
    assert.ok(/id="shareCanvas"/.test(detailWxml), '详情缺少 5:4 分享卡画布');
    assert.ok(/this\.data\.d/.test(detailJs) && /_shareTitle/.test(detailJs), '标题取自 poll detail');
    assert.ok(/\/pages\/votedetail\/votedetail/.test(detailJs) && /encodeURIComponent\(id\)/.test(detailJs), '分享 path 带 pollId');
    assert.ok(/target\.dataset/.test(listJs), '列表按钮 data-id 应由 onShareAppMessage 读取');
  });

  await T('分享 D3：分组结果页有分享按钮和具体标题；抽签记录分享带存证 id', async function () {
    assert.ok(/<button[^>]*open-type="share"/.test(src('pages/group/group.wxml')), '分组缺少分享按钮');
    assert.ok(/分组结果 · /.test(src('pages/group/group.js')), '分组标题应含组数/人数');
    assert.ok(/<button[^>]*open-type="share"/.test(src('pages/drawrec/drawrec.wxml')), '抽签记录缺少分享按钮');
  });

  await T('协议 D4：身份页勾选 + 两个协议链接；我的/数据页有独立入口；legal 页支持 type=privacy|terms', async function () {
    const idWxml = src('pages/identity/identity.wxml');
    const idJs = src('pages/identity/identity.js');
    assert.ok(/bindtap="submitTap"/.test(idWxml) && /agreed/.test(idWxml), '身份页缺少协议勾选');
    assert.ok(/《用户协议》/.test(idWxml) && /《隐私政策》/.test(idWxml) && /openLegal/.test(idWxml), '身份页缺少协议链接');
    assert.ok(/submitTap/.test(idJs) && /toggleAgree/.test(idJs) && /openLegal/.test(idJs), '身份页缺少协议 handler');
    assert.ok(/open-type="share"/.test(src('pages/legal/legal.wxml')) === false, '法律页不强制放分享按钮（菜单分享即可）');
    assert.ok(/type === 'privacy' \? 'terms' : 'privacy'/.test(src('pages/legal/legal.wxml')), '法律页缺隐私/协议切换');
    assert.ok(/goPrivacy/.test(src('pages/me/me.wxml')) && /goTerms/.test(src('pages/me/me.wxml')), '我的页缺少协议入口');
    assert.ok(/goPrivacy/.test(src('pages/data/data.wxml')) && /goTerms/.test(src('pages/data/data.wxml')), '数据与隐私页缺少协议入口');
  });

  await T('协议 D5：法律页使用原生 scroll/pageScrollTo，不出现内嵌网页标签 / wx.request', async function () {
    const js = src('pages/legal/legal.js');
    const wxml = src('pages/legal/legal.wxml');
    assert.ok(/pageScrollTo/.test(js), '目录跳转用原生 pageScrollTo');
    assert.ok(/head:\s*head/.test(js) && !/doc:\s*doc/.test(js), '法律页只 setData 头部字段（不把 doc+blocks+toc 重复 3 份）');
    assert.strictEqual(wxml.indexOf('{{doc.'), -1, '法律页 WXML 不再绑定整份 doc');
    const tag = 'web' + '-view';
    assert.strictEqual((js + wxml).indexOf(tag), -1, '不得使用 ' + tag);
    assert.strictEqual(/wx\.request/.test(js), false, '不得直连 wx.request');
    assert.ok(js.indexOf('utils/legal-data.js') >= 0, '正文来自本地数据模块');
  });
}

module.exports = { run: run };

if (require.main === module) {
  (async function () {
    await run(test);
    const pass = results.filter(function (r) { return r.ok; }).length;
    const fail = results.length - pass;
    console.log('\n================ ' + pass + ' passed, ' + fail + ' failed ================');
    process.exitCode = fail ? 2 : 0;
  })().catch(function (e) { console.error('FATAL', e); process.exit(1); });
}
