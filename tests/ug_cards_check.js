#!/usr/bin/env node
/* ug_cards_check.js —— 微信小程序「使用说明」卡片化重构的纯文本静态断言（无需模拟器 / 零依赖）
 *
 * 契约：C:\Users\Ko_Li\.openclaw\workspace\web\使用说明_卡片化重构契约_20261112.md §4
 * 目标：不启动微信开发者工具就能验证 pages/ug/{js,wxml,wxss,json} 的结构与文案硬规则：
 *   * 一屏一张卡：swiper（19 张卡）+ 分类 chips + 总览 + 上一张/下一张 + 页码；
 *   * 卡面：11 类 scene 配图（≥8 种实际使用）+ 标题 + 一句话 + 3 条步骤 + 1 条提示；
 *   * 文案硬规则（§0）：标题 ≤8 字 / 作用 ≤20 字 / 步骤 ≤24 字 / 提示 ≤30 字 / 每卡 3 步；
 *   * 无 http(s) 资源、无 <image>、无新增图片依赖（主包体积红线）；
 *   * 保留 top-app-bar / share.enable / onShareAppMessage / onShareTimeline /
 *     agent handoff（SECTION_MAP → 卡片 index，不再依赖 #ug- 锚点）/ scrollmem / 版本 2.0.0；
 *   * 交互逻辑（Vm 沙箱里跑真实 Page 定义）：切卡 / 首尾 clamp / 分类跳转 / 总览开关 / handoff 定位。
 *
 * 用法：
 *   node ug_cards_check.js            # 人类可读
 *   node ug_cards_check.js --json     # 机器可读
 *   node ug_cards_check.js --verbose  # 附带每项细节
 * 退出码：全部通过 => 0；有失败 => 1；文件/环境问题 => 2。
 *
 * 复用：perf_ug_preview.js / ui_scroll_test.js 在 automator 不可用时 require 本文件跑 runChecks() 兜底。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const PAGE_DIR = path.join(ROOT, 'pages', 'ug');
const FILES = {
  js: path.join(PAGE_DIR, 'ug.js'),
  wxml: path.join(PAGE_DIR, 'ug.wxml'),
  wxss: path.join(PAGE_DIR, 'ug.wxss'),
  json: path.join(PAGE_DIR, 'ug.json')
};

const EXPECT_IDS = ['id', 'home', 'draw', 'roster', 'bz', 'tt', 'hw', 'nt', 'ft', 'roll',
  'power', 'water', 'vote', 'ppt', 'file', 'screencast', 'all', 'data', 'fb'];
const CAT_KEYS = ['start', 'study', 'life', 'team', 'more'];
const CAT_NAMES = { start: '入门', study: '学习', life: '生活', team: '协作', more: '更多' };
const SCENES = ['picks', 'steps', 'grid', 'list', 'chart', 'people', 'transfer', 'ballot', 'droplet', 'shield', 'slides'];
const TONES = ['mint', 'blue', 'sand', 'rose', 'violet'];

// §0 文案硬规则
const LIMIT = { title: 8, sub: 20, step: 24, tip: 30 };

function cjkLen(s) { return Array.from(String(s == null ? '' : s)).length; }

function makeRequireStub() {
  return function reqStub(p) {
    const s = String(p);
    if (s.indexOf('version.js') >= 0) {
      return { VERSION: '2.0.0', RELEASED_AT: '2026-11-05', text: function () { return '班级工具 · v2.0.0'; } };
    }
    if (s.indexOf('identity.js') >= 0) {
      return { ensure: function () { return true; }, has: function () { return true; }, get: function () { return null; } };
    }
    if (s.indexOf('share.js') >= 0) {
      return {
        enable: function () { },
        message: function (c) { return c || {}; },
        timeline: function (c) { return c || {}; }
      };
    }
    if (s.indexOf('agent.js') >= 0) {
      return {
        pick: function () { return null; },
        pickQuery: function () { return null; },
        apply: function () { return null; },
        parseQuery: function () { return {}; }
      };
    }
    if (s.indexOf('scrollmem.js') >= 0) {
      return {
        attach: function () { }, restore: function () { }, save: function () { },
        onScroll: function () { }, cancel: function () { },
        svSave: function () { }, svGet: function () { return null; }, svClear: function () { },
        resetAll: function () { }, memOf: function () { return 0; }
      };
    }
    return {};
  };
}

// 用 Vm 跑真实的 pages/ug/ug.js（只替换小程序运行时依赖），拿到 Page 定义与 CARDS 数据
function loadPage() {
  const src = fs.readFileSync(FILES.js, 'utf8');
  let pageDef = null;
  const sandbox = {
    require: makeRequireStub(),
    Page: function (def) { pageDef = def; },
    wx: {
      getWindowInfo: function () { return { windowWidth: 390, windowHeight: 753 }; },
      getSystemInfoSync: function () { return { windowWidth: 390, windowHeight: 753 }; },
      showShareMenu: function () { },
      pageScrollTo: function () { }
    },
    console: { log: function () { }, warn: function () { }, error: function () { } },
    setTimeout: function () { return 0; },
    clearTimeout: function () { }
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'pages/ug/ug.js' });
  return { page: pageDef, src: src };
}

// 造一个够用的 Page 实例：直接复用真实 Page 方法，只屏蔽需要真实渲染层的 _measure / _growTo
function makeInstance(pageDef, section) {
  const inst = {};
  Object.keys(pageDef).forEach(function (k) { inst[k] = pageDef[k]; });
  inst.data = JSON.parse(JSON.stringify(pageDef.data));
  inst._measure = function () { };
  inst.setData = function (patch, cb) { Object.assign(this.data, patch); if (typeof cb === 'function') cb(); };
  if (section !== undefined) {
    inst._agent = { pageId: 'sim', path: 'pages/ug/ug', query: {}, payload: { section: section } };
    inst._agentQ = null;
    inst._agentApplied = false;
  }
  return inst;
}

function runChecks(opts) {
  opts = opts || {};
  const verbose = !!opts.verbose;
  const results = [];
  let pass = 0, fail = 0;
  function check(name, ok, detail) {
    const row = { name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 400) };
    results.push(row);
    if (ok) pass++; else fail++;
    if (!opts.quiet) console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (row.detail ? ' :: ' + row.detail : ''));
    return ok;
  }

  // ---------------------------------------------------------------- 0. 文件存在
  let js = '', wxml = '', wxss = '', json = null;
  try {
    js = fs.readFileSync(FILES.js, 'utf8');
    wxml = fs.readFileSync(FILES.wxml, 'utf8');
    wxss = fs.readFileSync(FILES.wxss, 'utf8');
    json = JSON.parse(fs.readFileSync(FILES.json, 'utf8'));
  } catch (e) {
    check('读取 pages/ug/{js,wxml,wxss,json}', false, e.message);
    return { pass: pass, fail: fail, results: results };
  }
  check('读取 pages/ug/{js,wxml,wxss,json}', true, 'js=' + js.length + 'B wxml=' + wxml.length + 'B wxss=' + wxss.length + 'B');

  // ---------------------------------------------------------------- 1. Page 定义
  let loaded = null, page = null;
  try { loaded = loadPage(); page = loaded.page; } catch (e) { check('加载 pages/ug/ug.js（Page 定义）', false, e.message); }
  check('加载 pages/ug/ug.js（Page 定义）', !!(page && page.data && page.data.cards), page ? 'data keys=' + Object.keys(page.data || {}).length : '');
  if (!page) return { pass: pass, fail: fail, results: results };

  const cards = page.data.cards || [];
  const cats = page.data.cats || [];
  const ovGroups = page.data.ovGroups || [];

  // ---------------------------------------------------------------- 2. 页面结构（wxml）
  check('保留 top-app-bar 组件', /<top-app-bar\b/.test(wxml) && !!(json.usingComponents && json.usingComponents['top-app-bar']),
    JSON.stringify((json.usingComponents || {})['top-app-bar']));
  check('顶栏不重复页面大标题（仅「左右滑动 · 一键总览」提示 + 分类胶囊 + 页码 + 总览一行）',
    !/title="使用说明"/.test(wxml) && /<top-app-bar title=""/.test(wxml) && /class="ug-hint"/.test(wxml) && /左右滑动 · 一键总览/.test(wxml));
  check('wxml 有 swiper 一屏一张卡（bindchange="onSwipe" duration=280 circular=false）',
    /<swiper\b/.test(wxml) && /bindchange="onSwipe"/.test(wxml) && /duration="280"/.test(wxml) && /circular="\{\{false\}\}"/.test(wxml));
  check('swiper-item 循环渲染 cards（19 张卡的数据驱动结构）',
    /<swiper-item[^>]*wx:for="\{\{cards\}\}"/.test(wxml) && /<template is="ug-card"/.test(wxml));
  check('swiper 高度由 swiperH（selector query 实测）驱动，不写死',
    /style="height:\{\{swiperH\}\}px"/.test(wxml) && /createSelectorQuery/.test(js) && /swiperH/.test(js));
  check('一屏一张卡：实测后 cardH 写回（内容装得下才撑满，装不下保留卡内滚动）',
    /cardH/.test(js) && /'height:' \+ cardH/.test(wxml) && /_measured/.test(js) && /scroll-y/.test(wxml));
  check('卡片模板含分类胶囊/页码/总览按钮（卡头行）',
    /class="ug-head"/.test(wxml) && /class="ug-cat-pill"/.test(wxml) && /class="ug-ov-btn"/.test(wxml) && /总览/.test(wxml) && /bindtap="openOv"/.test(wxml));
  check('分类 chips：scroll-x + 5 类 + 点击跳转 + 当前高亮',
    /<scroll-view[^>]*scroll-x[^>]*class="ug-chips"|class="ug-chips"[^>]*scroll-x/.test(wxml) &&
    /wx:for="\{\{cats\}\}"/.test(wxml) && /bindtap="jumpCat"/.test(wxml) && /ug-chip--on/.test(wxml));
  check('上一张 / 下一张按钮 + 页码 + 首尾禁用态',
    /bindtap="prev"/.test(wxml) && /bindtap="next"/.test(wxml) && /上一张/.test(wxml) && /下一张/.test(wxml) &&
    /ug-nav--off/.test(wxml) && /\{\{cur \+ 1\}\}\/\{\{cards\.length\}\}/.test(wxml));
  check('一键总览：遮罩 + 分组清单 + 条目跳卡 + 关闭',
    /class="ug-ov"/.test(wxml) && /wx:if="\{\{ov\}\}"/.test(wxml) && /bindtap="closeOv"/.test(wxml) &&
    /bindtap="jumpTo"/.test(wxml) && /wx:for="\{\{ovGroups\}\}"/.test(wxml) && /catchtap="noop"/.test(wxml));
  check('卡片模板：hero + 标题 + 一句话 + 步骤 + 提示',
    /class="ug-hero/.test(wxml) && /class="ug-title"/.test(wxml) && /class="ug-sub"/.test(wxml) &&
    /class="ug-step"/.test(wxml) && /class="ug-tip"/.test(wxml) && /<template is="ug-scene"/.test(wxml));
  check('保留 ugver 版本行（版本仍 2.0.0）',
    /class="ugver"/.test(wxml) && /\{\{versionText\}\}/.test(wxml) && /utils\/version\.js/.test(js) &&
    page.data.versionText === '班级工具 v2.0.0', page.data.versionText);
  check('版本号未硬编码（唯一来源 utils/version.js）',
    !/'班级工具 v2\.0\.0'/.test(js) && !/>[^<]*班级工具 v2\.0\.0/.test(wxml));

  // ---------------------------------------------------------------- 3. 配图 scene（11 类，≥8 种实际使用）
  const usedScenes = {};
  cards.forEach(function (c) { usedScenes[c.scene] = (usedScenes[c.scene] || 0) + 1; });
  const usedList = Object.keys(usedScenes);
  const SCENE_SHAPE = {
    picks: '.ug-ball', steps: '.ug-spot', grid: '.ug-cell', list: '.ug-row',
    chart: '.ug-bar', people: '.ug-ava', transfer: '.ug-dev', ballot: '.ug-opt',
    droplet: '.ug-drop', shield: '.ug-shield', slides: '.ug-sl'
  };
  const sceneMissing = SCENES.filter(function (s) {
    const inWxml = new RegExp('ug-sc-' + s + '\\b').test(wxml);
    const inWxss = new RegExp('\\' + SCENE_SHAPE[s] + '\\b').test(wxss);
    return !inWxml || !inWxss;
  });
  check('11 类 scene 模板齐全（wxml 分支 + wxss 形状样式）', sceneMissing.length === 0, sceneMissing.join(',') || 'ok');
  check('scene 至少实际用到 8 种（卡片数据）', usedList.length >= 8, 'used=' + usedList.length + ' ' + JSON.stringify(usedScenes));
  check('scene 取值都在契约 11 类内', usedList.every(function (s) { return SCENES.indexOf(s) >= 0; }), usedList.join(','));
  check('配图不新增图片资源（无 <image / 无 http(s) / 无 src=）',
    !/<image\b/.test(wxml) && !/https?:\/\//.test(wxml) && !/\bsrc\s*=/.test(wxml) && !/https?:\/\//.test(js) && !/https?:\/\//.test(wxss) && !/url\(/.test(wxss));

  // ---------------------------------------------------------------- 4. 卡片数据（19 张 / 分类 / 文案硬规则）
  check('卡片数量 = 19', cards.length === 19, 'cards=' + cards.length);
  const ids = cards.map(function (c) { return c.id; });
  check('卡片 id 与契约 §4.2 逐项一致', ids.length === EXPECT_IDS.length && EXPECT_IDS.every(function (id, i) { return ids[i] === id; }), ids.join(','));
  check('卡片 id 唯一', new Set(ids).size === ids.length, 'unique=' + new Set(ids).size);
  check('分类 = 5 类（start/study/life/team/more）', cats.length === 5 && cats.map(function (c) { return c.key; }).join(',') === CAT_KEYS.join(','),
    cats.map(function (c) { return c.key + ':' + c.name; }).join(','));
  check('每张卡分类合法且每个分类非空', cards.every(function (c) { return CAT_KEYS.indexOf(c.cat) >= 0; }) &&
    CAT_KEYS.every(function (k) { return cards.some(function (c) { return c.cat === k; }); }));
  check('分类名与契约一致（入门/学习/生活/协作/更多）', cats.every(function (c) { return CAT_NAMES[c.key] === c.name; }), cats.map(function (c) { return c.name; }).join('/'));
  check('分类按契约分组计数（入门 2 / 学习 8 / 生活 2 / 协作 4 / 更多 3）',
    [2, 8, 2, 4, 3].every(function (n, i) { return cards.filter(function (c) { return c.cat === CAT_KEYS[i]; }).length === n; }),
    CAT_KEYS.map(function (k) { return k + '=' + cards.filter(function (c) { return c.cat === k; }).length; }).join(' '));
  check('每张卡标题 ≤8 字且非空', cards.every(function (c) { return c.title && cjkLen(c.title) <= LIMIT.title; }),
    cards.filter(function (c) { return !c.title || cjkLen(c.title) > LIMIT.title; }).map(function (c) { return c.id + ':' + c.title; }).join(',') || 'ok');
  check('每张卡一句话作用 ≤20 字且非空', cards.every(function (c) { return c.sub && cjkLen(c.sub) <= LIMIT.sub; }),
    cards.filter(function (c) { return !c.sub || cjkLen(c.sub) > LIMIT.sub; }).map(function (c) { return c.id + ':' + cjkLen(c.sub) + ':' + c.sub; }).join(',') || 'ok');
  check('每张卡 3 条步骤、每条 ≤24 字且非空',
    cards.every(function (c) { return Array.isArray(c.steps) && c.steps.length === 3 && c.steps.every(function (s) { return s && cjkLen(s) <= LIMIT.step; }); }),
    cards.filter(function (c) { return !Array.isArray(c.steps) || c.steps.length !== 3 || !c.steps.every(function (s) { return s && cjkLen(s) <= LIMIT.step; }); }).map(function (c) { return c.id + ':' + (c.steps || []).length; }).join(',') || 'ok');
  check('每张卡 1 条提示、≤30 字且非空（本功能要求每卡必有）',
    cards.every(function (c) { return c.tip && cjkLen(c.tip) <= LIMIT.tip; }),
    cards.filter(function (c) { return !c.tip || cjkLen(c.tip) > LIMIT.tip; }).map(function (c) { return c.id + ':' + cjkLen(c.tip) + ':' + c.tip; }).join(',') || 'ok');
  check('卡片标题不重复（一个功能只在一张卡）', new Set(cards.map(function (c) { return c.title; })).size === cards.length);
  check('每张卡 scene/tone/icon 合法',
    cards.every(function (c) { return SCENES.indexOf(c.scene) >= 0 && TONES.indexOf(c.tone) >= 0 && !!c.icon; }),
    cards.filter(function (c) { return SCENES.indexOf(c.scene) < 0 || TONES.indexOf(c.tone) < 0 || !c.icon; }).map(function (c) { return c.id; }).join(',') || 'ok');
  check('文案不出现开发者/实现细节（接口/数据表/版本号/测试账号）',
    !/class_members|userdata|PostgREST|云函数|token|接口|数据库|utils\/|\/pages\/|2\.0\.0/.test(cards.map(function (c) {
      return [c.title, c.sub, c.tip].concat(c.steps).join('|');
    }).join('|')));
  check('文案遵守「点」不用「点击」', !/点击/.test(cards.map(function (c) { return [c.title, c.sub, c.tip].concat(c.steps).join('|'); }).join('|')));
  const byId = {};
  cards.forEach(function (c) { byId[c.id] = c; });
  check('数字与规则抽查与小程序现状一致（文件保留 3 天 / 水量 2 吨·3.03 元/吨 / 电费 13·16 号日更且无 24h / 投票 5–120 分钟）',
    /3 天/.test(byId.file.tip) &&
    /2 吨/.test(byId.water.tip) &&
    byId.water.steps.some(function (s) { return s.indexOf('3.03') >= 0; }) &&
    /13\s*\/\s*16/.test(byId.power.tip) &&
    byId.power.tip.indexOf('不提供 24h') >= 0 &&
    byId.vote.steps.some(function (s) { return s.indexOf('5–120') >= 0; }),
    JSON.stringify({ file: byId.file.tip, water: byId.water.tip, power: byId.power.tip }));
  check('电费卡文案不把电价写成免费电量（事实纠正：0.58 元/度是电价，不是免费额度）',
    !cards.some(function (c) { return /免费电量/.test([c.title, c.sub, c.tip].concat(c.steps).join('|')); }));
  check('总览分组：5 组 / 共 19 条 / 条目字段完整',
    ovGroups.length === 5 && ovGroups.reduce(function (n, g) { return n + g.cards.length; }, 0) === 19 &&
    ovGroups.every(function (g) { return !!g.name && g.cards.length > 0 && g.cards.every(function (c) { return typeof c.idx === 'number' && !!c.title && !!c.sub; }); }),
    ovGroups.map(function (g) { return g.name + '=' + g.cards.length; }).join(' '));

  // ---------------------------------------------------------------- 5. 保留项（分享 / handoff / scrollmem）
  check('保留 share.enable / onShareAppMessage / onShareTimeline',
    /share\.enable\(\)/.test(js) && /onShareAppMessage\s*\(/.test(js) && /onShareTimeline\s*\(/.test(js) && /utils\/share\.js/.test(js));
  check('保留 agent handoff（SECTION_MAP → 卡片 index），不再用 #ug- 锚点',
    /SECTION_MAP/.test(js) && /agent\.pick\(this\)/.test(js) && /applyAgentHandoff\s*\(/.test(js) &&
    /setData\(\{\s*cur:/.test(js) && !/['"]#ug-/.test(js) && !/wx\.pageScrollTo\(/.test(js));
  check('保留 scrollmem（attach/restore/save/onScroll）',
    /scrollmem\.attach\(this\)/.test(js) && /scrollmem\.restore\(this\)/.test(js) && /scrollmem\.onScroll\(this/.test(js) && /scrollmem\.save\(this\)/.test(js));
  check('保留 identity.ensure（页面守卫）', /identity\.ensure\(\)/.test(js));

  // ---------------------------------------------------------------- 6. WXSS 只新增 .ug-* 类
  const wxssNoComment = wxss.replace(/\/\*[\s\S]*?\*\//g, '');
  const classSel = [];
  (wxssNoComment.match(/\.([A-Za-z][A-Za-z0-9_-]*)/g) || []).forEach(function (m) { classSel.push(m.slice(1)); });
  const nonUg = Array.from(new Set(classSel.filter(function (c) { return c.indexOf('ug') !== 0; })));
  check('WXSS 只使用 .ug-* 新类（不改全局样式）', nonUg.length === 0, nonUg.join(','));
  check('WXSS 无外链/字体/图片资源', !/@import/.test(wxss) && !/url\(/.test(wxss) && !/https?:/.test(wxss));

  // ---------------------------------------------------------------- 7. 交互逻辑（真实 Page 方法）
  const handlers = ['onSwipe', 'prev', 'next', 'jumpCat', 'jumpTo', 'openOv', 'closeOv', 'noop', 'applyAgentHandoff', 'onShareAppMessage', 'onShareTimeline'];
  check('交互 handler 齐全（wxml bind/catch 都能在 js 找到）', handlers.every(function (h) { return typeof page[h] === 'function'; }),
    handlers.filter(function (h) { return typeof page[h] !== 'function'; }).join(',') || 'ok');

  let inst = makeInstance(page);
  check('初始：第 1 张 / 分类 start / 总览关闭', inst.data.cur === 0 && inst.data.curCat === 'start' && inst.data.ov === false,
    JSON.stringify({ cur: inst.data.cur, cat: inst.data.curCat, ov: inst.data.ov }));
  inst.prev();
  check('首张「上一张」clamp 不循环（cur 仍 0）', inst.data.cur === 0);
  inst.next();
  check('「下一张」→ 第 2 张（工作台）', inst.data.cur === 1 && inst.data.curCat === 'start', JSON.stringify({ cur: inst.data.cur, cat: inst.data.curCat }));
  inst.prev();
  check('「上一张」→ 回到第 1 张', inst.data.cur === 0);
  inst.onSwipe({ detail: { current: 5 } });
  check('swiper onSwipe 更新卡片与分类（第 6 张 → 学习）', inst.data.cur === 5 && inst.data.curCat === 'study' && inst.data.catName === '学习',
    JSON.stringify({ cur: inst.data.cur, cat: inst.data.curCat, name: inst.data.catName }));
  inst.jumpCat({ currentTarget: { dataset: { cat: 'life' } } });
  check('分类 chip「生活」跳到该分类首卡（第 11 张：宿舍电费）', inst.data.cur === 10 && cards[10].id === 'power',
    JSON.stringify({ cur: inst.data.cur, id: cards[inst.data.cur].id }));
  inst.jumpCat({ currentTarget: { dataset: { cat: 'more' } } });
  check('分类 chip「更多」跳到该分类首卡（第 17 张：工具与排序）', inst.data.cur === 16 && cards[16].id === 'all',
    JSON.stringify({ cur: inst.data.cur, id: cards[inst.data.cur].id }));
  inst.openOv();
  check('总览按钮打开遮罩弹层', inst.data.ov === true);
  const ovIdx = ovGroups[2].cards[0].idx;
  inst.jumpTo({ currentTarget: { dataset: { idx: ovIdx } } });
  check('总览条目：关闭弹层并跳到对应卡', inst.data.ov === false && inst.data.cur === ovIdx,
    JSON.stringify({ ov: inst.data.ov, cur: inst.data.cur, idx: ovIdx }));
  inst.openOv();
  inst.closeOv();
  check('关闭总览不影响当前卡', inst.data.ov === false && inst.data.cur === ovIdx);
  inst.jumpTo({ currentTarget: { dataset: { idx: 18 } } });
  inst.next();
  check('末张「下一张」clamp 不循环（第 19 张）', inst.data.cur === 18, 'cur=' + inst.data.cur);
  inst.prev();
  check('末张前一跳正常', inst.data.cur === 17);

  // handoff：SECTION_MAP → 卡片 index（旧 AI section 键全部仍可定位）
  const HO = {
    identity: 'id', features: 'home', tools: 'all', sync: 'data', privacy: 'data',
    roll: 'roll', power: 'power', powercard: 'home', ntattach: 'nt', share: 'home',
    water: 'water', group: 'draw', homework: 'hw', notice: 'nt', fitness: 'ft',
    committee: 'bz', feedback: 'fb', file: 'file', screencast: 'screencast', vote: 'vote', ppt: 'ppt', data: 'data'
  };
  let hoBad = [];
  Object.keys(HO).forEach(function (sec) {
    const i2 = makeInstance(page, sec);
    const ret = i2.applyAgentHandoff();
    const idx = EXPECT_IDS.indexOf(HO[sec]);
    if (!ret || i2.data.cur !== idx || i2.data.ov !== false) hoBad.push(sec + '→' + i2.data.cur + '(want ' + idx + ')');
  });
  check('agent handoff：section → 卡片 index（22 个旧/新 section 键）', hoBad.length === 0, hoBad.join(',') || 'ok');
  const i3 = makeInstance(page, 'roll');
  i3.applyAgentHandoff();
  const again = i3.applyAgentHandoff();
  check('agent handoff 只消费一次（第二次返回 false）', again === false);
  const i4 = makeInstance(page, '不存在的section');
  const ret4 = i4.applyAgentHandoff();
  check('未知 section 不报错、不改当前卡', ret4 === true && i4.data.cur === 0);

  // ---------------------------------------------------------------- 汇总
  if (!opts.quiet) {
    console.log('');
    console.log('================ ug_cards_check: ' + pass + ' passed, ' + fail + ' failed ================');
  }
  return { pass: pass, fail: fail, results: results, cards: cards.length, scenes: usedList.length };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const asJson = args.indexOf('--json') >= 0;
  const verbose = args.indexOf('--verbose') >= 0;
  try {
    const r = runChecks({ quiet: asJson, verbose: verbose });
    if (asJson) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    process.exitCode = r.fail ? 1 : 0;
  } catch (e) {
    console.error('[ug_cards_check] ' + (e && e.stack || e));
    process.exitCode = 2;
  }
}

module.exports = { runChecks: runChecks, EXPECT_IDS: EXPECT_IDS, CAT_KEYS: CAT_KEYS, SCENES: SCENES };
