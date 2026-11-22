/* group_split_unit.js —— 抽签 / 分组拆分 + 删除结果单（契约 web/group/CONTRACT.md）
 *
 * 运行：node group_split_unit.js（也可由 unit.js require 挂入主链）
 * 覆盖：
 *   1) utils/tools.js：draw / group 两个独立 key、group 可勾选进首页、group 不再映射 draw；
 *   2) utils/flow.js：最近抽签（drawLast）跨重启可读、重置只清当前抽签、分组结果不受影响；
 *   3) pages/group：全班 / 最近抽签 / 自选名单三来源、名称优先级、全班 = pick + 全座号、
 *      结果摘要、未知 source 归一 prev；
 *   4) pages/draw：无步骤条/无「下一步 · 分组」、重置只清抽签并保留最近抽签；
 *   5) pages/sum 已删除 + 全仓无坏引用（ai/ 也清理）。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..').replace(/\\/g, '/');
const MEMBERS = [
  { seat: 1, sid: '9999000001', name: '测试甲', role: '', badge: '', is_admin: false },
  { seat: 24, sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: true },
  { seat: 26, sid: '9999000004', name: '测试辛', role: '', badge: '', is_admin: false }
];
const ID = { token: 'tok-group-test', sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: true, ts: 1 };

function purge() {
  Object.keys(require.cache).forEach(function (k) {
    const kk = k.replace(/\\/g, '/');
    if (kk.indexOf(ROOT) !== 0) return;
    const m = require.cache[k];
    try { if (m && m.exports && typeof m.exports.udStop === 'function') m.exports.udStop(); } catch (e) { /* ignore */ }
    delete require.cache[k];
  });
}
function fresh() {
  purge();
  return {
    store: require(path.join(ROOT, 'utils/store.js')),
    flow: require(path.join(ROOT, 'utils/flow.js')),
    tools: require(path.join(ROOT, 'utils/tools.js')),
    roster: require(path.join(ROOT, 'utils/roster.js')),
    util: require(path.join(ROOT, 'utils/util.js')),
    drawproof: require(path.join(ROOT, 'utils/drawproof.js'))
  };
}
function clearStorage() {
  ['zq_tools_v2', 'zq_flow', 'zq_class_identity', 'zq_ud_cache', 'ziqi.tools.v1'].forEach(function (k) {
    try { wx.removeStorageSync(k); } catch (e) { /* ignore */ }
  });
}
function seed(store, opts) {
  const d = store.get();
  d.classMembers = MEMBERS.slice();
  d.classRoster = MEMBERS.map(function (m) { return m.seat + ' ' + m.name; }).join('\n');
  d.selVer = 1;
  if (opts && opts.names != null) d.draw.names = String(opts.names);
  store.save();
}
function setIdentity() { wx.setStorageSync('zq_class_identity', JSON.stringify(ID)); }
function loadPage(rel) {
  let def = null;
  global.Page = function (d) { def = d; };
  try { require(path.join(ROOT, rel)); } finally { delete global.Page; }
  assert.ok(def, rel + ' 未注册 Page');
  return def;
}
function pageCtx(def) {
  const ctx = Object.assign({}, def);
  ctx.data = JSON.parse(JSON.stringify(def.data));
  ctx._setData = [];
  ctx.setData = function (o, cb) {
    ctx._setData.push(o);
    Object.keys(o || {}).forEach(function (k) {
      if (k.indexOf('.') > 0) return;
      ctx.data[k] = o[k];
    });
    if (cb) cb();
  };
  return ctx;
}
function toastSpy() {
  const log = [];
  const orig = wx.showToast;
  wx.showToast = function (o) { log.push(o && o.title); };
  return { log: log, restore: function () { wx.showToast = orig; } };
}

async function run(test) {
  /* ---------------- 1. 工具目录 ---------------- */
  await test('工具目录：draw / group 是两个独立 key，group 可勾选进首页且不再映射 draw', function () {
    clearStorage();
    const { store, tools } = fresh();
    assert.strictEqual(tools.toolOf('draw').name, '抽签', 'draw 名称应为「抽签」');
    assert.strictEqual(tools.toolOf('draw').meta.indexOf('分组'), -1, 'draw meta 不应再提分组');
    assert.ok(tools.toolOf('group'), 'group 工具未注册');
    assert.strictEqual(tools.toolOf('group').name, '分组');
    assert.strictEqual(tools.toolOf('group').url, '/pages/group/group');
    assert.strictEqual(tools.toolOf('group').icoImg, '/images/tool-group.png');
    assert.strictEqual(tools.localKey('group'), 'group', 'SYNC_KEY_IN 不得再把 group 映射到 draw');
    assert.deepStrictEqual(tools.fromSyncKeys(['group', 'draw', 'group']), ['group', 'draw'], '读云端保留两个独立 key');
    assert.deepStrictEqual(tools.toSyncKeys(['group', 'bz']), ['group', 'committee'], '写云端 group 原样、bz→committee');

    // 默认 4 个勾选里没有 group（draw 仍保留），但 group 是普通可勾选工具
    assert.deepStrictEqual(tools.defaultHome(), ['hw', 'nt', 'ft', 'draw']);
    assert.ok(tools.catalog().some(function (t) { return t.key === 'group'; }), 'group 应出现在全部工具');
    assert.strictEqual(tools.setHomeTool('ft', false).ok, true);
    const r = tools.setHomeTool('group', true);
    assert.strictEqual(r.ok, true, 'group 应可勾选进首页');
    assert.deepStrictEqual(store.get().homeTools, ['hw', 'nt', 'draw', 'group'], '勾选按 toolOrder 排列');
    assert.strictEqual(store.get().homeTools.length <= tools.HOME_MAX, true, 'homeTools 仍 ≤4');
  });

  /* ---------------- 2. flow 持久化 ---------------- */
  await test('flow：最近抽签跨重启可读；重置只清当前抽签，分组结果与 drawLast 保留', function () {
    clearStorage();
    let f = fresh();
    const st = { result: [2, 3, 7], pool: [1, 2, 3, 7], removed: [], log: [], cfg: { range: '1 – 10', count: '3' } };
    f.flow.patch('draw', st);
    f.flow.saveLastDraw(st);
    f.flow.patch('group', { result: [[{ n: 2, nm: '测试甲' }]], cfg: { groups: '1' } });
    // 重置：只清当前抽签（与 pages/draw reset 一致）
    f.flow.patch('draw', null);
    // 模拟冷启动：清 require 缓存，storage 里的 zq_flow 仍在
    const f2 = fresh();
    const fl = f2.flow.getFlow();
    assert.strictEqual(fl.draw, null, '重置后当前抽签为空');
    assert.ok(fl.group && fl.group.result, '分组结果不被抽签重置清空');
    const last = f2.flow.lastDraw();
    assert.deepStrictEqual(last.result, [2, 3, 7], '最近抽签跨重启可读');
    assert.deepStrictEqual(last.pool, [1, 2, 3, 7]);
    assert.ok(last.at > 0 && last.cfg && last.cfg.range === '1 – 10');
    // 旧数据（只有 draw、没有 drawLast）回退到 draw
    wx.setStorageSync('zq_flow', JSON.stringify({ draw: { result: [5], pool: [5], removed: [], log: [], cfg: null }, group: null, updatedAt: 1 }));
    assert.deepStrictEqual(fresh().flow.lastDraw().result, [5], '旧 flow 数据回退当前 draw，不报错');
  });

  /* ---------------- 3. 分组页 ---------------- */
  await test('分组页：最近抽签来源读 flow.drawLast，名称映射优先于班级名单派生名', function () {
    clearStorage();
    setIdentity();
    let f = fresh();
    seed(f.store, { names: '1 映射甲' });
    f.store.get().roster = '1 名单甲\n24 测试账号\n26 测试辛';
    f.store.save();
    f.flow.saveLastDraw({ result: [1, 24, 26], pool: [1, 24, 26], cfg: { range: '1 – 26' } });
    const def = loadPage('pages/group/group.js');
    const ctx = pageCtx(def);
    ctx.load();
    assert.strictEqual(ctx.data.source, 'prev', 'group.source 默认 prev');
    assert.strictEqual(ctx.data.prevN, 3, '最近抽签人数 3');
    assert.ok(ctx.data.prevTime, '最近抽签带时间');
    assert.strictEqual(ctx.data.allN, 3, '全班人数来自 class_members');
    ctx.useRecent();
    assert.strictEqual(ctx.data.source, 'prev');
    const mem = ctx.members();
    assert.deepStrictEqual(mem.map(function (m) { return m.nm; }), ['映射甲', '测试账号', '测试辛'], '名称映射 > 班级名单派生名');
  });

  await test('分组页：全班 = source pick + 全班座号；结果摘要正确且与自选口径等价', function () {
    clearStorage();
    setIdentity();
    const f = fresh();
    seed(f.store);
    const def = loadPage('pages/group/group.js');
    const ctx = pageCtx(def);
    ctx.load();
    ctx.useAll();
    assert.strictEqual(ctx.data.source, 'pick', '全班内部仍是 pick（不新增 source 取值）');
    assert.strictEqual(ctx.data.src, 'all', '视图高亮全班');
    assert.deepStrictEqual(f.store.get().group.sel, [1, 24, 26], '全班 = 班级名单全部座号');
    assert.strictEqual(f.store.get().group.source, 'pick');
    ctx.useManual();
    assert.strictEqual(ctx.data.src, 'pick', '明确点自选名单 → 高亮自选（即使集合恰为全班）');
    ctx.useAll();
    assert.strictEqual(ctx.data.src, 'all');
    ctx.setData({ n: 2, mode: 'groups' });
    ctx.doGroup();
    const st = f.flow.getFlow().group;
    assert.ok(st && st.result && st.result.length === 2, '按组数 2 应分成 2 组');
    assert.ok(/^全班（3 人）$/.test(st.cfg.source), 'cfg 记录全班来源：' + st.cfg.source);
    assert.strictEqual(st.cfg.total, '3');
    assert.strictEqual(ctx.data.summary, '共 3 人 · 2 组 · 每组 1–2 人', '结果摘要');
    assert.strictEqual(ctx.data.groupN, 2);
    // 重新进入页面（冷启动）仍能读到分组结果，且「全班」判定来自集合比较
    const f2 = fresh();
    const ctx2 = pageCtx(loadPage('pages/group/group.js'));
    ctx2.load();
    assert.strictEqual(ctx2.data.src, 'all', '已选集合 = 全班集合 → 全班');
    assert.strictEqual(ctx2.data.summary, '共 3 人 · 2 组 · 每组 1–2 人');
    assert.ok(f2.flow.getFlow().group && f2.flow.getFlow().group.result);
  });

  await test('分组页：无最近抽签时置灰提示、不改来源；自选名单全选/清空可用', function () {
    clearStorage();
    setIdentity();
    const f = fresh();
    seed(f.store);
    const def = loadPage('pages/group/group.js');
    const ctx = pageCtx(def);
    ctx.load();
    assert.strictEqual(ctx.data.prevN, 0);
    ctx.setData({ source: 'pick', src: 'pick' });
    const spy = toastSpy();
    ctx.useRecent();
    assert.ok(spy.log.some(function (t) { return /还没有抽签结果/.test(t); }), '无最近抽签应提示');
    assert.strictEqual(ctx.data.source, 'pick', '提示后不改来源');
    spy.restore();
    ctx.selectAll();
    assert.deepStrictEqual(f.store.get().group.sel, [1, 24, 26], '自选全选 = 全班座号');
    assert.strictEqual(ctx.data.src, 'all');
    ctx.clearAll();
    assert.deepStrictEqual(f.store.get().group.sel, [], '清空自选名单');
    assert.strictEqual(ctx.data.src, 'pick');
  });

  await test('分组页：未知 source 归一 prev；保存只写 prev | pick', function () {
    clearStorage();
    setIdentity();
    const f = fresh();
    seed(f.store);
    f.store.get().group.source = 'weird';
    f.store.save();
    assert.strictEqual(f.store.mkD({ group: { source: 'weird' } }).group.source, 'prev', 'store 层未知 source 归一 prev');
    assert.strictEqual(f.store.mkD({ group: { source: 'paste' } }).group.source, 'pick', '旧 paste 归一 pick');
    const def = loadPage('pages/group/group.js');
    const ctx = pageCtx(def);
    ctx.load();
    assert.strictEqual(ctx.data.source, 'prev', '未知 source 归一 prev');
    ctx.setData({ source: 'unknown' });
    ctx.saveCfg();
    assert.strictEqual(f.store.get().group.source, 'prev', '保存时归一 prev');
    ctx.setData({ source: 'pick' });
    ctx.saveCfg();
    assert.strictEqual(f.store.get().group.source, 'pick');
  });

  /* ---------------- 4. 抽签页 ---------------- */
  await test('抽签页：无步骤条 / 无「下一步 · 分组」；重置只清抽签并保留分组与最近抽签', function () {
    clearStorage();
    setIdentity();
    const f = fresh();
    seed(f.store);
    const drawSt = { rid: 'dtest12345678', seed: 's', result: [2, 3], pool: [1, 2, 3], removed: [], log: [], cfg: { range: '1 – 3', count: '2', dup: '否' }, proof: { status: 'failed' } };
    f.flow.patch('draw', drawSt);
    f.flow.saveLastDraw(drawSt);
    f.flow.patch('group', { result: [[{ n: 2, nm: '测试甲' }], [{ n: 3, nm: '' }]], cfg: { groups: '2', total: '2' } });
    const def = loadPage('pages/draw/draw.js');
    assert.strictEqual(def.data.steps, undefined, 'draw data 不再有 steps');
    assert.strictEqual(typeof def.toGroup, 'undefined', 'draw 不再有 toGroup');
    assert.strictEqual(typeof def.toSum, 'undefined', 'draw 不再有 toSum');
    assert.strictEqual(typeof def.onStep, 'undefined', 'draw 不再有步骤切换');
    const ctx = pageCtx(def);
    ctx.load();
    assert.strictEqual(ctx.data.state, 'data');
    ctx.reset();
    assert.strictEqual(f.flow.getFlow().draw, null, '重置清当前抽签');
    assert.ok(f.flow.getFlow().group && f.flow.getFlow().group.result, '重置不清分组结果');
    assert.deepStrictEqual(f.flow.lastDraw().result, [2, 3], '重置保留最近抽签，供分组沿用');
    assert.strictEqual(ctx.data.state, 'empty');
    assert.strictEqual(ctx.data.steps, undefined);
  });

  await test('抽签页 WXML：无 segmented / 第 1 步 / 下一步；分组页 WXML：无上一步 / 下一步 / 结果单', function () {
    const drawWxml = fs.readFileSync(path.join(ROOT, 'pages/draw/draw.wxml'), 'utf8');
    const drawJs = fs.readFileSync(path.join(ROOT, 'pages/draw/draw.js'), 'utf8');
    const groupWxml = fs.readFileSync(path.join(ROOT, 'pages/group/group.wxml'), 'utf8');
    assert.strictEqual(/<segmented/.test(drawWxml), false, 'draw 仍有 segmented');
    assert.strictEqual(/第 1 步/.test(drawWxml), false, 'draw 仍有第 1 步文案');
    assert.strictEqual(/下一步 · 分组/.test(drawWxml), false, 'draw 仍有下一步分组');
    assert.strictEqual(/toSum|pages\/sum/.test(drawJs), false, 'draw 仍引用结果单');
    assert.strictEqual(/<segmented/.test(groupWxml), false, 'group 仍有 segmented');
    assert.strictEqual(/上一步|下一步|结果单/.test(groupWxml), false, 'group 仍有步骤文案');
    assert.ok(/最近抽签/.test(groupWxml) && /全班/.test(groupWxml) && /自选名单/.test(groupWxml), 'group 三来源');
    assert.ok(/开始分组/.test(groupWxml) && /重新分组/.test(groupWxml), '分组按钮文案');
    assert.ok(/summary/.test(groupWxml), '分组结果摘要');
  });

  /* ---------------- 5. 删除结果单 / 引用清理 ---------------- */
  await test('删除结果单：pages/sum 不存在、app.json 未注册、全仓（含 ai/）无 /pages/sum 引用', function () {
    assert.strictEqual(fs.existsSync(path.join(ROOT, 'pages/sum')), false, 'pages/sum 目录应删除');
    const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
    assert.strictEqual(app.pages.indexOf('pages/sum/sum'), -1, 'app.json 仍注册结果单');
    assert.ok(app.pages.indexOf('pages/draw/draw') >= 0 && app.pages.indexOf('pages/group/group') >= 0, '两个页面都应注册');
    const bad = [];
    (function walk(dir) {
      fs.readdirSync(dir, { withFileTypes: true }).forEach(function (ent) {
        const abs = path.join(dir, ent.name);
        const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
        if (ent.isDirectory()) {
          if (/^(tests|node_modules|\.git|_backup|miniprogram_npm)/.test(rel) || rel.indexOf('/node_modules') >= 0) return;
          walk(abs);
          return;
        }
        if (!/\.(js|json|wxml|wxss|md)$/.test(ent.name)) return;
        if (rel === 'CHANGELOG.md') return; // 历史记录保留（新版本条目说明删除）
        const txt = fs.readFileSync(abs, 'utf8');
        if (txt.indexOf('/pages/sum/sum') >= 0 || /['"]pages\/sum\/sum['"]/.test(txt)) bad.push(rel);
      });
    })(ROOT);
    assert.deepStrictEqual(bad, [], '仍有结果单页面引用：' + bad.join(', '));
  });

  await test('单测自身已挂入 unit.js require 链', function () {
    const unitSrc = fs.readFileSync(path.join(__dirname, 'unit.js'), 'utf8');
    assert.ok(unitSrc.indexOf('group_split_unit.js') >= 0, 'unit.js 未挂入 group_split_unit.js');
  });
}

module.exports = { run: run };

if (require.main === module) {
  if (!global.wx) {
    const mem = Object.create(null);
    global.wx = {
      getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
      setStorageSync(k, v) { mem[k] = v; },
      removeStorageSync(k) { delete mem[k]; },
      getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 9, limitSize: 10240 }; },
      getAccountInfoSync() { return { miniProgram: { version: '2.1.0' } }; },
      showToast() {}, showModal(o) { if (o && o.success) o.success({ confirm: true, cancel: false }); },
      showShareMenu() {}, navigateTo() {}, reLaunch() {}, switchTab() {},
      onThemeChange() {}, offThemeChange() {}, onAgentHandoff() {}
    };
  }
  const results = [];
  let passN = 0, failN = 0;
  const test = async function (name, fn) {
    try { await fn(); passN += 1; results.push({ name: name, ok: true }); console.log('PASS  ' + name); }
    catch (e) { failN += 1; results.push({ name: name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
  };
  run(test).then(function () {
    fs.writeFileSync(path.join(__dirname, 'group_split_result.json'), JSON.stringify({ total: passN + failN, pass: passN, fail: failN, results: results, at: new Date().toISOString() }, null, 2), 'utf8');
    console.log('\n================ group-split: ' + passN + ' passed, ' + failN + ' failed ================');
    process.exitCode = failN ? 2 : 0;
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}
