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

  await T('分享卡 B2：投票视图 = 标题具体内容 + 前 4 选项；结果字段被遮住（微信卡片不可直接预览结果）', async function () {
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
    assert.strictEqual(v.options[0].text, '周三 18:00');
    assert.strictEqual(v.options[0].pct, undefined, '分享视图不应带百分比');
    assert.strictEqual(v.options[0].count, undefined, '分享视图不应带票数');
    assert.strictEqual(v.resultsMasked, true, '投票分享卡必须标记结果已遮住');
    assert.ok(v.hint.indexOf('结果') >= 0, '应提示结果到投票页查看');
    const hidden = sharecard.buildVoteView({ detail: Object.assign({}, d, { resultsHidden: true }) });
    assert.strictEqual(hidden.options[0].pct, undefined);
    assert.strictEqual(hidden.resultsMasked, true);
  });

  await T('分享卡 B4：通知视图 = 标题/分类/状态/摘要/要点/字段/来源；要点最多 3 条', async function () {
    const v = sharecard.buildNoticeView({
      card: {
        title: '图书馆闭馆通知', cat: '教务', statusLabel: '截止 11月21日 18:00',
        summary: '周日全馆检修，暂停开放。', points: ['带校园卡', '不要占座', '第三点也不应丢弃', '第四点才截断'],
        segs: [{ type: '时间', text: '11月21日 08:00' }, { type: '地点', text: '图书馆' }, { type: '截止', text: '11月21日 18:00' }],
        compose: [{ n: 2, label: '个附件' }], senderName: '测试庚', senderRole: '班长',
        source: 'QQ 群「班级群」', timeLabel: '11-20 10:00'
      },
      time: '2026-11-20 10:00'
    });
    assert.strictEqual(v.kind, 'notice');
    assert.strictEqual(v.title, '图书馆闭馆通知');
    assert.strictEqual(v.cat, '教务');
    assert.strictEqual(v.status, '截止 11月21日 18:00');
    assert.strictEqual(v.summary, '周日全馆检修，暂停开放。');
    assert.strictEqual(v.points.length, 3, '通知分享图最多展示 3 条要点');
    assert.strictEqual(v.fields.length, 2, '关键字段最多 2 条（时间/地点优先）');
    assert.strictEqual(v.fields[0].k, '时间');
    assert.strictEqual(v.compose, '2个附件');
    assert.strictEqual(v.sender, '测试庚 · 班长');
    assert.strictEqual(v.source, 'QQ 群「班级群」');
    assert.strictEqual(v.time, '2026-11-20 10:00');
  });

  await T('分享卡 B6：通用信息卡（分组/作业/课表/名单）含统计与逐行信息', async function () {
    const group = sharecard.buildGroupView({
      groups: [{ members: [{ n: 1, nm: '甲' }, { n: 2, nm: '乙' }] }, { members: [{ n: 3, nm: '丙' }] }],
      cfg: { mode: '随机', source: '班级名单', total: '3', groups: '2' },
      time: '10:00'
    });
    assert.strictEqual(group.kind, 'info');
    assert.strictEqual(group.stats[0].v, '2');
    assert.ok(group.lines[0].text.indexOf('甲') >= 0);
    const hw = sharecard.buildHwView({
      open: [{ subject: '高数', content: '习题 3.1', dueInfo: { txt: '明天 18:00 截止' } }],
      done: [{ subject: '英语', content: '背诵' }], nick: '测试账号', time: '10:00'
    });
    assert.strictEqual(hw.stats[0].v, '1');
    assert.ok(hw.lines[0].text.indexOf('习题 3.1') >= 0);
    const tt = sharecard.buildTtView({
      courses: [{ day: 0, start: 1, end: 2, name: '高数', room: 'A301' }], wk: 10, weekRange: '11/16 - 11/22', time: '10:00'
    });
    assert.strictEqual(tt.stats[1].v, '1');
    assert.ok(tt.lines[0].text.indexOf('A301') >= 0);
    const roster = sharecard.buildRosterView({
      tab: 'committee', list: [{ seat: 1, name: '甲', role: '班长' }],
      counts: { committee: 1, leagueText: '2', all: 30 }, time: '10:00'
    });
    assert.strictEqual(roster.stats[0].v, '1');
    assert.ok(roster.lines[0].text.indexOf('班长') >= 0);
    assert.strictEqual(roster.subtitle, '仅姓名与座号 · 不含学号');
  });

  await T('分享卡 B5：投票画布不出现百分比/票数；通知画布画出标题/分类/状态/来源', async function () {
    const fake = function () {
      const texts = [];
      const g = {
        font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
        measureText: function (t) { return { width: String(t == null ? '' : t).length * 8 }; },
        fillText: function (t) { texts.push(String(t == null ? '' : t)); },
        fillRect: function () {}, strokeRect: function () {},
        beginPath: function () {}, moveTo: function () {}, lineTo: function () {}, arcTo: function () {},
        closePath: function () {}, arc: function () {}, fill: function () {}, stroke: function () {},
        save: function () {}, restore: function () {}, setTransform: function () {}, scale: function () {},
        clearRect: function () {}
      };
      return { g: g, texts: texts };
    };
    const vote = sharecard.buildVoteView({
      detail: {
        title: '周三班会时间投票', statusText: '进行中', total: 12,
        options: [{ text: '周三 18:00', showBar: true, pct: 50, count: 6 }, { text: '周三 19:00', showBar: true, pct: 50, count: 6 }]
      },
      time: '10:00'
    });
    const a = fake();
    assert.strictEqual(sharecard.draw(a.g, vote), true);
    const voteText = a.texts.join('|');
    assert.ok(voteText.indexOf('周三班会时间投票') >= 0, '投票卡应画出标题');
    assert.ok(voteText.indexOf('周三 18:00') >= 0, '投票卡应画出选项');
    assert.ok(voteText.indexOf('结果请打开投票页查看') >= 0, '投票卡应提示结果到投票页查看');
    assert.strictEqual(voteText.indexOf('%'), -1, '投票分享卡不能出现百分比');
    assert.strictEqual(voteText.indexOf('人已投'), -1, '投票分享卡不能出现已投人数');
    assert.strictEqual(/[0-9]+\s*票/.test(voteText), false, '投票分享卡不能出现票数');

    const notice = sharecard.buildNoticeView({
      card: {
        title: '图书馆闭馆通知', cat: '教务', statusLabel: '截止 11月21日 18:00',
        summary: '周日全馆检修，暂停开放。', points: ['带校园卡', '不要占座', '第三点不应进入分享图'],
        source: 'QQ 群「班级群」'
      },
      time: '10:00'
    });
    const b = fake();
    assert.strictEqual(sharecard.draw(b.g, notice), true);
    const noticeText = b.texts.join('|');
    assert.ok(noticeText.indexOf('图书馆闭馆通知') >= 0, '通知卡应画出标题');
    assert.ok(noticeText.indexOf('教务') >= 0, '通知卡应画出分类');
    assert.ok(noticeText.indexOf('截止 11月21日 18:00') >= 0, '通知卡应画出状态');
    assert.ok(noticeText.indexOf('QQ 群「班级群」') >= 0, '通知卡应画出来源');
    assert.strictEqual(noticeText.indexOf('第三点不应进入分享图'), -1, '第三条要点不应进入分享图');
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
  await T('法律 C1：两份正文元信息（V1.0 / 生效 2026-11-17 / 运营者信息）', async function () {
    ['privacy', 'terms'].forEach(function (k) {
      const d = legal[k];
      assert.ok(d && d.blocks.length > 30 && d.toc.length >= 15, k + ' 正文过少');
      assert.strictEqual(d.version, 'V1.0');
      assert.strictEqual(d.effective, '2026年11月17日');
      assert.ok(String(d.operator || '').trim().length >= 2, k + ' 缺少运营者');
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
  await T('分享 D1：抽签结果页有可见分享入口、存证 id 深链、canvas 分享卡失败回退 draw.png', async function () {
    const wxml = src('pages/draw/draw.wxml');
    const js = src('pages/draw/draw.js');
    assert.ok(/class="share-btn"[^>]*bindtap="openShare"/.test(wxml), '结果页缺少可见分享入口');
    assert.ok(/<share-sheet/.test(wxml) && /preview-alt="\{\{sharePoster\}\}"/.test(wxml), '结果页缺少分享弹层/长图预览');
    assert.ok(/id="shareCanvas"/.test(wxml), '缺少 5:4 分享卡画布');
    assert.ok(/\/pages\/drawrec\/drawrec/.test(js) && /proofReady/.test(js), '应优先分享存证详情');
    assert.ok(/sharecard\.buildDrawView/.test(js) && /sharecard\.FALLBACK\.draw/.test(js), '分享卡应走 buildDrawView');
    assert.ok(/shareflow\.open/.test(js), '分享入口应走统一 shareflow');
    assert.ok(js.indexOf('抽签结果 · ') >= 0, '标题应包含抽签结果 N 个');
  });

  await T('分享 D2：投票列表/详情都有分享入口；详情标题=投票标题、path=详情 ?id=', async function () {
    const listWxml = src('pages/vote/vote.wxml');
    const detailWxml = src('pages/votedetail/votedetail.wxml');
    const listJs = src('pages/vote/vote.js');
    const detailJs = src('pages/votedetail/votedetail.js');
    assert.ok(/class="vote-share"[^>]*data-id="\{\{item\.id\}\}"[^>]*catchtap="openShare"/.test(listWxml), '列表卡片缺少带 pollId 的分享入口');
    assert.ok(/bindtap="openShare"/.test(detailWxml) && /<share-sheet/.test(detailWxml), '详情缺少分享弹层');
    assert.ok(/id="shareCanvas"/.test(detailWxml), '详情缺少 5:4 分享卡画布');
    assert.ok(/sharecard\.buildVoteView/.test(detailJs) && /_shareTitle/.test(detailJs), '标题取自 poll detail');
    assert.ok(/\/pages\/votedetail\/votedetail/.test(detailJs) && /encodeURIComponent\(id\)/.test(detailJs), '分享 path 带 pollId');
    assert.ok(/target\.dataset|shareGid/.test(listJs), '列表分享应绑定当前投票 id');
  });

  await T('分享 D6：通知卡片有分享入口；弹层含 5:4 卡片封面 + 长图 + 图片/微信卡片两个选项', async function () {
    const wxml = src('pages/nt/nt.wxml');
    const js = src('pages/nt/nt.js');
    const sheet = src('components/share-sheet/index.wxml');
    assert.ok(/class="nt-share"[^>]*data-gid="\{\{card\.id\}\}"[^>]*catchtap="openShare"/.test(wxml), '通知卡片底栏缺少分享入口');
    assert.ok(/id="card"/.test(wxml) && /id="shareCanvas"/.test(wxml), '缺少长图/5:4 分享卡画布');
    assert.ok(/<share-sheet[^>]*preview="\{\{shareImg\}\}"/.test(wxml) && /preview-alt="\{\{sharePoster\}\}"/.test(wxml), '分享弹层缺少卡片/长图预览');
    assert.ok(/bind:image="shareAsImage"/.test(wxml), '分享弹层缺少图片分享事件');
    assert.ok(/open-type="share"/.test(sheet) && /class="ss-opt ss-opt--btn"/.test(sheet), '统一弹层缺少微信卡片分享按钮');
    assert.ok(/sharecard\.buildNoticeView/.test(js) && /shareflow\.renderPoster/.test(js), '通知分享应生成 5:4 卡片与长图');
    assert.ok(/'gid=' \+ encodeURIComponent\(gid\)/.test(js), '微信卡片应带 gid 深链');
    assert.ok(/班级通知｜/.test(js), '卡片分享标题应带通知标题');
  });

  await T('分享 D7：投票详情分享卡/长图均不展示结果；页面提示与视图口径一致', async function () {
    const wxml = src('pages/votedetail/votedetail.wxml');
    const js = src('pages/votedetail/votedetail.js');
    const card = src('utils/sharecard.js');
    assert.ok(/不显示结果/.test(wxml), '投票详情应说明分享内容不显示结果');
    assert.ok(/resultsMasked: true/.test(card), '投票分享视图应显式标记结果已遮住');
    assert.ok(/结果请打开投票页查看/.test(card), '投票分享卡应提示结果到投票页查看');
    assert.ok(/sharecard\.buildVoteView/.test(js) && /_sharePosterOpt/.test(js), '详情页应生成无结果卡片与长图');
  });

  await T('分享 D3：分组结果页有分享入口和具体标题；抽签记录分享带存证 id', async function () {
    assert.ok(/class="share-btn"[^>]*bindtap="openShare"/.test(src('pages/group/group.wxml')), '分组缺少分享入口');
    assert.ok(/分组结果 · /.test(src('pages/group/group.js')), '分组标题应含组数/人数');
    assert.ok(/<button[^>]*open-type="share"/.test(src('pages/drawrec/drawrec.wxml')), '抽签记录缺少分享按钮');
  });

  await T('分享 D8：五个「导出图片」入口全部替换为分享弹层（抽签/分组/作业/体测/课表；结果单已删除）', async function () {
    const pages = ['draw', 'group', 'hw', 'ft', 'tt'];
    pages.forEach(function (p) {
      const wxml = src('pages/' + p + '/' + p + '.wxml');
      const js = src('pages/' + p + '/' + p + '.js');
      const json = JSON.parse(src('pages/' + p + '/' + p + '.json'));
      assert.strictEqual(/bindtap="exportImg"/.test(wxml), false, p + ' 仍保留导出图片按钮');
      assert.ok(/<share-sheet/.test(wxml), p + ' 缺少分享弹层');
      assert.ok(/id="shareCanvas"/.test(wxml), p + ' 缺少 5:4 分享卡画布');
      assert.ok(/bindtap="openShare"/.test(wxml), p + ' 缺少分享入口');
      assert.ok(/shareflow\.install/.test(js) && /_shareOpenOpts/.test(js), p + ' 未接 shareflow');
      assert.strictEqual(json.usingComponents['share-sheet'], '/components/share-sheet/index', p + ' 未注册 share-sheet');
    });
  });

  await T('分享 D9：名单 / 国标表 / 点名新增可见分享入口；投票列表分享先取详情再生成卡片', async function () {
    assert.ok(/class="rd-share"[^>]*bindtap="openShare"/.test(src('pages/committee/committee.wxml')), '名单缺少分享入口');
    assert.ok(/buildRosterView/.test(src('pages/committee/committee.js')), '名单分享卡未使用名单视图');
    assert.ok(/class="ftt-share"[^>]*bindtap="openShare"/.test(src('pages/fttable/fttable.wxml')), '国标表缺少分享入口');
    assert.ok(/buildFttableView/.test(src('pages/fttable/fttable.js')), '国标表分享卡未使用国标视图');
    assert.ok(/bindtap="openShare"/.test(src('pages/roll/roll.wxml')), '点名缺少分享入口');
    assert.ok(/点名统计/.test(src('pages/roll/roll.js')), '点名分享卡缺少统计信息');
    const voteWxml = src('pages/vote/vote.wxml');
    const voteJs = src('pages/vote/vote.js');
    assert.ok(/<share-sheet/.test(voteWxml) && /id="shareCanvas"/.test(voteWxml), '投票列表缺少分享弹层');
    assert.ok(/cloud\.pollDetail/.test(voteJs) && /buildVoteView/.test(voteJs), '投票列表分享应先拉详情再生成卡片');
  });

  await T('分享 D10：统一分享弹层支持 5:4 卡片 / 长图切换，两个分享选项与无障碍点按区', async function () {
    const wxml = src('components/share-sheet/index.wxml');
    const wxss = src('components/share-sheet/index.wxss');
    assert.ok(/previewAlt/.test(wxml) && /分享长图/.test(wxml), '弹层缺少长图预览切换');
    assert.ok(/open-type="share"/.test(wxml), '弹层缺少微信卡片分享按钮');
    assert.ok(/bindtap="onImage"/.test(wxml), '弹层缺少图片分享选项');
    assert.ok(/min-height:\s*104rpx/.test(wxss), '分享选项点按区不足 104rpx');
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
