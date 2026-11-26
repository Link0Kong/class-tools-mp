/* tool_sort_unit.js —— 小程序「工具页长按拖动排序 + 首页工具主动勾选」单元/契约测试
 *
 * 运行：node tool_sort_unit.js
 * 依赖：仅 Node 内置模块 + wx 内存 mock（绝不访问真实云端/模拟器）。
 *
 * 背景（2026-11-06 v2.0.0，用户口径）：
 *   · homeTools（UD v6，≤4）= 用户勾选的首页工具 key 数组，不再自动补齐；
 *   · 全部工具自定义顺序 = store.toolOrder，**随账号云同步**（走 userdata v6 的 prefs.toolOrder，不新增顶层键），
 *     拖动只改它 + 按新顺序重排 homeTools；默认自然顺序不写云端（toolOrderSetAt=0）；
 *   · 旧版 homeTools（全量顺序，长度 >4）首次读取时迁移（前 4 个可上首页 = 勾选，全量顺序 = toolOrder）；
 *   · 页面无「调整」按钮/排序弹层，只有说明文字 + 每格右侧勾选控件 + 长按拖动。
 *
 * 覆盖：默认勾选 4 / 归一与非法过滤 / 勾选上限 4 / 取消勾选 / 按 toolOrder 排列 / 迁移 /
 *       未知新工具补末尾 / quickList / catalog 顺序 / moveTool+setToolOrder / UD 契约（head-only）/
 *       导出与隐私 / 页面方法（无旧弹层、说明文字、勾选联动、拖动目标重排与落盘）。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');
const results = [];
let passN = 0, failN = 0, skipN = 0;

async function test(name, fn) {
  try { await fn(); passN++; results.push({ name: name, ok: true }); console.log('PASS  ' + name); }
  catch (e) {
    failN++;
    results.push({ name: name, ok: false, err: String((e && e.message) || e) });
    console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e));
  }
}

/* ---------------- wx mock（内存 storage + 可注入 request） ---------------- */
const mem = Object.create(null);
let reqLog = [];
let reqImpl = (o) => o.success({ statusCode: 200, data: [] });
let toastLog = [];
let modalLog = [];
let navLog = [];
let pageScrollLog = [];
let vibrateLog = [];

global.wx = {
  getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
  setStorageSync(k, v) { mem[k] = v; },
  removeStorageSync(k) { delete mem[k]; },
  getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 9, limitSize: 10240 }; },
  getAccountInfoSync() { return { miniProgram: { version: '2.0.0' } }; },
  getAppBaseInfo() { return { SDKVersion: '3.0.0', theme: 'light' }; },
  getSystemInfoSync() { return { SDKVersion: '3.0.0', theme: 'light', windowWidth: 375, windowHeight: 667, screenWidth: 375, screenHeight: 667, pixelRatio: 2, platform: 'devtools' }; },
  getWindowInfo() { return { windowWidth: 375, windowHeight: 667, screenWidth: 375, screenHeight: 667, pixelRatio: 2 }; },
  request(o) { reqLog.push(o); reqImpl(o); },
  showToast(o) { toastLog.push(o && o.title); },
  showModal(o) { modalLog.push(o); if (o && o.success) o.success({ confirm: true, cancel: false }); },
  showLoading() {}, hideLoading() {}, showShareMenu() {},
  setClipboardData(o) { if (o && o.success) o.success(); },
  navigateTo(o) { navLog.push({ type: 'navigateTo', url: o && o.url }); },
  switchTab(o) { navLog.push({ type: 'switchTab', url: o && o.url }); },
  reLaunch(o) { navLog.push({ type: 'reLaunch', url: o && o.url }); },
  pageScrollTo(o) { pageScrollLog.push(o); if (o && o.success) o.success(); },
  vibrateShort(o) { vibrateLog.push(o); },
  createSelectorQuery() {
    const q = {
      selectAll() { return q; }, selectViewport() { return q; }, select() { return q; },
      boundingClientRect() { return q; }, scrollOffset() { return q; },
      exec(cb) { if (cb) cb([[], { scrollTop: 0, scrollLeft: 0 }]); }
    };
    return q;
  },
  onThemeChange() {}, offThemeChange() {}, onAgentHandoff() {}
};

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
    tools: require(path.join(ROOT, 'utils/tools.js')),
    identity: require(path.join(ROOT, 'utils/identity.js')),
    cloud: require(path.join(ROOT, 'utils/cloud.js')),
    privacy: require(path.join(ROOT, 'utils/privacy.js'))
  };
}
function clearMem() {
  Object.keys(mem).forEach(function (k) { delete mem[k]; });
  reqLog = []; toastLog = []; modalLog = []; navLog = []; pageScrollLog = []; vibrateLog = [];
  reqImpl = (o) => o.success({ statusCode: 200, data: [] });
}
const ID = { token: 'tok-test-tools', sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: false, ts: 1 };
function setIdentity(id) { mem['zq_class_identity'] = JSON.stringify(id || ID); }
function keysOf(list) { return (list || []).map(function (t) { return typeof t === 'string' ? t : t.key; }); }
function loadPage(rel) {
  let def = null;
  global.Page = (d) => { def = d; };
  try { require(path.join(ROOT, rel)); } finally { delete global.Page; }
  assert.ok(def, rel + ' 未注册 Page');
  return def;
}
function pageCtx(def) {
  const ctx = Object.assign({}, def);
  ctx.data = JSON.parse(JSON.stringify(def.data));
  ctx._setDataLog = [];
  ctx.setData = function (o, cb) {
    ctx._setDataLog.push(o);
    Object.keys(o || {}).forEach(function (k) {
      if (k.indexOf('.') > 0) return;          // 简单 mock 不处理路径写法（本测试用不到）
      ctx.data[k] = o[k];
    });
    if (cb) cb();
  };
  return ctx;
}

/* ============================================================ */
(async function main() {
  /* ---------- 1. 默认勾选 4 个 / 目录顺序 ---------- */
  await test('默认：勾选 4 个（hw/nt/ft/draw）、HOME_MAX=4、toolOrder=TOOLS 自然顺序', () => {
    const { store, tools } = fresh();
    clearMem();
    setIdentity();
    assert.strictEqual(tools.HOME_MAX, 4, 'HOME_MAX 必须是 4（UD 契约 ≤4）');
    assert.deepStrictEqual(tools.homeTools(), ['hw', 'nt', 'ft', 'draw'], '默认勾选应保留现有前 4 个');
    assert.deepStrictEqual(keysOf(tools.quickList(4)), ['hw', 'nt', 'ft', 'draw']);
    assert.deepStrictEqual(tools.toolOrder(), keysOf(tools.TOOLS), '默认 toolOrder = TOOLS 自然顺序');
    assert.deepStrictEqual(tools.defaultHome(), ['hw', 'nt', 'ft', 'draw']);
    assert.strictEqual(store.get().homeToolsAt, 0, '默认数据不应伪造 homeToolsAt');
  });

  /* ---------- 2. 归一：只去重/过滤，不补齐 ---------- */
  await test('归一：去重 / 非法 key / 管理员工具按身份过滤，最多保留前 4 个（不自动补齐）', () => {
    const { store, tools } = fresh();
    clearMem();
    setIdentity();
    // 直接写脏数据 → homeTools() 归一后落盘
    store.get().homeTools = ['hw', 'hw', 'bogus', 'stats', 'diag', 'power', 'nt', 'ft', 'draw', 'roll'];
    tools.homeTools();
    assert.deepStrictEqual(store.get().homeTools, ['hw', 'diag', 'power', 'nt'], '应去重并过滤非法/非管理员工具，只留前 4');
    // 不足 4 个不再补齐（新语义：勾选几个就几个）
    store.get().homeTools = ['draw', 'hw'];
    assert.deepStrictEqual(tools.homeTools(), ['draw', 'hw']);
    // 空集合保持空（不自动回默认）
    store.get().homeTools = [];
    assert.deepStrictEqual(tools.homeTools(), []);
    // 2026-11-22：电费 / 诊断恢复可勾选（安卓与网页工具栏都允许），管理员工具仅管理员可勾选
    assert.strictEqual(tools.homeEligible(tools.toolOf('water')), true, '水量可以勾选进首页');
    assert.strictEqual(tools.homeEligible(tools.toolOf('power')), true, '宿舍电费可以勾选进首页');
    assert.strictEqual(tools.homeEligible(tools.toolOf('diag')), true, '诊断可以勾选进首页');
    assert.strictEqual(tools.homeEligible(tools.toolOf('stats')), false, '非管理员不能勾选统计');
    const admin = { token: 'tok-tool-admin', sid: 'fixture-admin-tools', name: '管理员夹具', role: '班长', badge: '班委', is_admin: true, ts: 1 };
    assert.strictEqual(tools.homeEligible(tools.toolOf('stats'), admin), true, '管理员可以勾选统计');
  });

  /* ---------- 3. 勾选上限 4 / 取消勾选 / 按 toolOrder 排列 ---------- */
  await test('勾选：上限 4（第 5 个被拒、状态不变）+ 取消勾选释放位子 + 勾选顺序按 toolOrder', () => {
    const { store, tools, cloud } = fresh();
    clearMem();
    // 自定义工具顺序：draw / group / hw / nt / ft / tt ...（2026-11-09 追加 ppt 演示，2026-11-11 追加 vote 投票，
    // 2026-11-12 追加 file 文件传输，2026-11-14 追加 map 地图，2026-11-22 分组拆分追加 group）
    const order = ['draw', 'group', 'hw', 'nt', 'ft', 'tt', 'roll', 'bz', 'power', 'water', 'vote', 'file', 'map', 'stats', 'diag', 'ppt'];
    tools.setToolOrder(order);
    assert.deepStrictEqual(tools.toolOrder(), order);
    // 现有勾选按新工具顺序重排（勾选集合不变）
    assert.deepStrictEqual(tools.homeTools(), ['draw', 'hw', 'nt', 'ft']);
    // 勾第 5 个 → 被拒绝
    const before = tools.homeTools().slice();
    const at0 = store.get().homeToolsAt;
    const r = tools.setHomeTool('tt', true);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'max', '勾满 4 个再勾第 5 个应返回 reason=max（页面据此 toast）');
    assert.deepStrictEqual(tools.homeTools(), before, '被拒后勾选集合不应变化');
    assert.strictEqual(store.get().homeToolsAt, at0, '被拒后不应提升 homeToolsAt');
    // 取消勾选 → 释放位子；再勾 tt → 按 toolOrder 插在 ft 之后
    assert.strictEqual(tools.setHomeTool('nt', false).ok, true);
    assert.deepStrictEqual(tools.homeTools(), ['draw', 'hw', 'ft']);
    assert.strictEqual(tools.setHomeTool('tt', true).ok, true);
    assert.deepStrictEqual(tools.homeTools(), ['draw', 'hw', 'ft', 'tt'], '勾选顺序 = 全部工具顺序');
    assert.strictEqual(tools.isHome('tt'), true);
    assert.strictEqual(tools.isHome('nt'), false);
    assert.ok(store.get().homeToolsAt > 0, '勾选变化应提升 homeToolsAt（UD LWW 依据）');
    // toggleHome 取反
    assert.strictEqual(tools.toggleHome('tt').ok, true);
    assert.deepStrictEqual(tools.homeTools(), ['draw', 'hw', 'ft']);
    // 非法 key → invalid；非管理员的统计工具 → invalid，不产生变化
    assert.strictEqual(tools.setHomeTool('bogus', true).reason, 'invalid');
    assert.strictEqual(tools.setHomeTool('stats', true).reason, 'invalid');
    // 同步触发（tools.js 复用 cloud.udPushSoon；测试里打桩计数）
    let pushN = 0;
    const orig = cloud.udPushSoon;
    cloud.udPushSoon = function () { pushN++; };
    try {
      tools.setHomeTool('draw', false);
      tools.setToolOrder(['hw', 'draw'].concat(order.filter(function (k) { return k !== 'hw' && k !== 'draw'; })));
    } finally { cloud.udPushSoon = orig; }
    assert.ok(pushN >= 1, '勾选/排序改动应触发云同步（udPushSoon）');
  });

  /* ---------- 4. 旧数据迁移 ---------- */
  await test('迁移：旧版 homeTools 全量顺序（7 项）→ 前 4 个为勾选 + 全量顺序为 toolOrder', () => {
    const { store, tools } = fresh();
    clearMem();
    const legacy = ['roll', 'tt', 'draw', 'hw', 'nt', 'ft', 'bz'];   // 旧版：用户自定义的「全部工具」顺序
    store.get().homeTools = legacy.slice();
    store.get().homeToolsAt = 1700000000000;
    // 首次访问任意 API 即迁移
    assert.deepStrictEqual(keysOf(tools.quickList(4)), ['roll', 'tt', 'draw', 'hw'], '勾选 = 旧顺序前 4 个');
    const order = tools.toolOrder();
    assert.deepStrictEqual(order.slice(0, 7), legacy, 'toolOrder 应沿用旧的全量顺序');
    assert.deepStrictEqual(order.slice(7), ['group', 'power', 'water', 'vote', 'file', 'map', 'stats', 'diag', 'ppt'], '其余工具按 TOOLS 顺序补在末尾（group 是独立工具）');
    assert.deepStrictEqual(store.get().homeTools, ['roll', 'tt', 'draw', 'hw']);
    assert.strictEqual(store.get().homeToolsAt, 1700000000000, '迁移不改 homeToolsAt（交给 LWW 裁决）');
    // 迁移幂等：再读不变
    assert.deepStrictEqual(tools.homeTools(), ['roll', 'tt', 'draw', 'hw']);
    assert.deepStrictEqual(tools.toolOrder(), order);
    // 落盘：重新从 storage 读（reload）仍是迁移后的数据
    store.reload();
    assert.deepStrictEqual(store.get().homeTools, ['roll', 'tt', 'draw', 'hw']);
    assert.deepStrictEqual(store.get().toolOrder, order);
  });

  await test('迁移：8 项旧数据（含 noHome/管理员残留）→ 勾选只取可上首页的前 4 个', () => {
    const { store, tools } = fresh();
    clearMem();
    store.get().homeTools = ['tt', 'hw', 'nt', 'ft', 'draw', 'roll', 'bz', 'power'];
    assert.deepStrictEqual(tools.homeTools(), ['tt', 'hw', 'nt', 'ft']);
    assert.deepStrictEqual(tools.toolOrder().slice(0, 8), ['tt', 'hw', 'nt', 'ft', 'draw', 'roll', 'bz', 'power']);
  });

  /* ---------- 5. toolOrder 归一与未知工具 ---------- */
  await test('toolOrder：未知/非法 key 丢弃，缺失的新工具按 TOOLS 顺序补末尾', () => {
    const { store, tools } = fresh();
    clearMem();
    store.get().toolOrder = ['hw', 'tt', 'futureTool', 'hw', 'diag'];
    assert.deepStrictEqual(tools.toolOrder(), ['hw', 'tt', 'diag', 'nt', 'ft', 'draw', 'group', 'roll', 'bz', 'power', 'water', 'vote', 'file', 'map', 'stats', 'ppt'],
      '已知 key 保留顺序，未知 key 丢弃，缺失 key 按 TOOLS 顺序补末尾');
    // normalizeToolOrder 纯函数
    assert.deepStrictEqual(tools.normalizeToolOrder(['diag']).slice(0, 3), ['diag', 'tt', 'hw']);
    assert.strictEqual(tools.normalizeToolOrder(['diag']).length, tools.TOOLS.length);
    // catalog 顺序 = toolOrder；测试账号看不到投票入口，班委身份下顺序完整
    const committee = { token: 'tok-tool-committee', sid: 'fixture-committee-tools', name: '班委夹具', role: '班长', badge: '班委', is_admin: false, ts: 1 };
    assert.deepStrictEqual(keysOf(tools.catalog(committee)), tools.toolOrder());
    assert.deepStrictEqual(keysOf(tools.catalog()), tools.toolOrder().filter(function (k) { return k !== 'vote'; }));
  });

  /* ---------- 6. moveTool / setToolOrder ---------- */
  await test('moveTool/setToolOrder：插到目标位置、越界夹紧、未知 key 不动、勾选顺序跟随、落盘', () => {
    const { store, tools } = fresh();
    clearMem();
    // 默认勾选 hw/nt/ft/draw；把 draw 拖到第 0 个
    const order1 = tools.moveTool('draw', 0);
    assert.strictEqual(order1[0], 'draw');
    assert.deepStrictEqual(tools.homeTools(), ['draw', 'hw', 'nt', 'ft'], 'homeTools 应按新 toolOrder 重排');
    assert.ok(store.get().homeToolsAt > 0, '首页顺序变化应提升 homeToolsAt');
    // 越界 → 夹到末尾
    const order2 = tools.moveTool('draw', 999);
    assert.strictEqual(order2[order2.length - 1], 'draw');
    // 未知 key → 原顺序
    const order3 = tools.moveTool('bogus', 2);
    assert.deepStrictEqual(order3, tools.toolOrder());
    // setToolOrder 任意顺序 + 只接受合法 key
    const custom = ['bz', 'unknown', 'tt', 'roll', 'water'];
    const saved = tools.setToolOrder(custom);
    const expectFirst = ['bz', 'tt', 'roll', 'water'];
    assert.deepStrictEqual(saved.slice(0, 4), expectFirst);
    assert.strictEqual(saved.indexOf('unknown'), -1);
    assert.strictEqual(saved.length, tools.TOOLS.length);
    // 落盘（重新 reload 仍一致）
    store.reload();
    const raw = JSON.parse(mem[require('../utils/store.js').KEY]);
    assert.deepStrictEqual(raw.toolOrder, saved, 'toolOrder 必须落盘到 zq_tools_v2');
    assert.deepStrictEqual(tools.toolOrder(), saved);
    // 拖一个没勾选的工具 → homeTools 内容不变
    const homeBefore = tools.homeTools().slice();
    tools.moveTool('roll', 0);
    assert.deepStrictEqual(tools.homeTools(), homeBefore, '勾选集合/顺序不受未勾选工具拖动影响');
  });

  /* ---------- 7. quickList / homeList ---------- */
  await test('quickList：只返回勾选工具（≤4，顺序=勾选顺序，cap 生效）；homeList 同源', () => {
    const { store, tools } = fresh();
    clearMem();
    store.get().homeTools = ['tt', 'hw'];
    assert.deepStrictEqual(keysOf(tools.quickList(4)), ['tt', 'hw']);
    assert.deepStrictEqual(keysOf(tools.quickList(1)), ['tt']);
    assert.deepStrictEqual(keysOf(tools.quickList(99)), ['tt', 'hw'], 'quickList 不会自动补到 4 个');
    assert.deepStrictEqual(keysOf(tools.homeList()), ['tt', 'hw']);
    store.get().homeTools = [];
    assert.deepStrictEqual(tools.quickList(4), [], '无勾选 → 空（首页显示引导空态）');
  });

  /* ---------- 8. UD 契约 ---------- */
  await test('空勾选可持久化：取消全部后 reload / 再读都不回退默认 4 个', () => {
    const { store, tools } = fresh();
    clearMem();
    store.get().homeTools = [];
    store.get().homeToolsAt = 1800000004000;
    store.save();
    store.reload();                                  // 模拟切页/重启（onShow 里的 store.reload）
    assert.deepStrictEqual(store.get().homeTools, [], '空数组是合法勾选状态，不得回退默认 4 个');
    assert.deepStrictEqual(tools.homeTools(), []);
    assert.deepStrictEqual(tools.quickList(4), []);
    // 缺字段（老数据）才回默认
    delete mem[store.KEY];
    store.reload();
    assert.deepStrictEqual(tools.homeTools(), ['hw', 'nt', 'ft', 'draw'], '字段缺失才回默认勾选');
  });
  await test('云同步契约：homeTools ≤4 进 blob；自定义 toolOrder 走 prefs.toolOrder（不新增顶层键；默认不写）', () => {
    const { store, tools, cloud } = fresh();
    clearMem();
    setIdentity();
    // 默认（用户没拖过排序）：prefs.toolOrder 不写，顶层键保持契约 14 键
    let view = cloud.udSections();
    assert.ok(Array.isArray(view.homeTools) && view.homeTools.length <= 4);
    assert.strictEqual(view.toolOrder, undefined, '不得新增顶层 toolOrder 键');
    assert.strictEqual(view.prefs.toolOrder, undefined, '默认自然顺序不写 prefs.toolOrder');
    // 用户拖过排序后：写进已有 prefs section（顶层键仍 14 个），homeTools 仍 ≤4
    tools.setToolOrder(['draw', 'hw', 'nt', 'ft', 'tt', 'roll', 'bz', 'power', 'water', 'stats', 'diag']);
    store.get().homeTools = ['draw', 'hw', 'nt', 'ft', 'tt', 'roll'];   // 脏数据 6 项
    view = cloud.udSections();
    assert.deepStrictEqual(view.homeTools, ['draw', 'hw', 'nt', 'ft'], 'udSections.homeTools 必须 ≤4');
    assert.strictEqual(view.toolOrder, undefined, '不得新增顶层 toolOrder 键');
    assert.ok(Array.isArray(view.prefs.toolOrder), '自定义顺序写进 prefs.toolOrder');
    assert.deepStrictEqual(view.prefs.toolOrder.slice(0, 3), ['draw', 'hw', 'nt']);
    const merged = cloud.mergeUd(view, {});
    assert.strictEqual(Object.keys(merged).length, 14, '顶层仍 14 键（v/at/11 section/homeToolsAt，不新增 section）');
    assert.deepStrictEqual(Object.keys(merged.at).length, 11);
    // 用户把顺序拖回自然顺序（仍算用户改动）→ 仍写入，保证“重置”能跨端生效
    tools.setToolOrder(tools.normalizeToolOrder([]));
    view = cloud.udSections();
    assert.ok(Array.isArray(view.prefs.toolOrder), '重置为自然顺序也要写云端（否则旧自定义会被云端拉回）');
  });

  await test('云同步：设备 A 自定义顺序 + 首页勾选 → 设备 B 应用后 工具顺序/首页顺序一致（换设备正常）', () => {
    const A = fresh();
    clearMem();
    setIdentity();
    const order = ['draw', 'hw', 'nt', 'ft', 'tt', 'roll', 'bz', 'power', 'water', 'stats', 'diag'];
    A.tools.setToolOrder(order);
    A.store.get().homeTools = ['draw', 'roll'];
    A.store.get().homeToolsAt = 1800000010000;
    A.store.save();
    const viewA = A.cloud.udSections();
    assert.ok(Array.isArray(viewA.prefs.toolOrder), '设备 A 的 blob 应带 prefs.toolOrder');
    const blobA = A.cloud.mergeUd(viewA, {});
    // 模拟换设备：清空本机存储 + 重新加载模块
    const B = fresh();
    clearMem();
    setIdentity();
    assert.strictEqual(B.cloud.udApply(blobA), true);
    assert.deepStrictEqual(B.tools.toolOrder().slice(0, 4), order.slice(0, 4), '设备 B：工具自定义顺序从云端恢复');
    assert.deepStrictEqual(B.tools.homeTools(), ['draw', 'roll'], '设备 B：首页勾选/顺序从云端恢复');
    assert.deepStrictEqual(B.tools.quickList(4).map(function (t) { return t.key; }), ['draw', 'roll']);
  });

  /* ---------- 8b. 跨端 key（2026-11-22：安卓/鸿蒙 fit/roster/group、网页 committee） ---------- */
  await test('跨端 key：安卓写入 fit/roster/group → 小程序归一为体测/名单/分组（group 不再并入 draw）', () => {
    const { store, tools, cloud } = fresh();
    clearMem();
    setIdentity();
    const T1 = 1800000020000, T2 = 1800000021000;
    const android = {
      v: 6,
      at: { homeTools: T1, fit: 0, draw: 0, group: 0, roster: 0, hide: 0, tt: 0, prefs: T2, nick: 0, power: 0, water: 0 },
      homeTools: ['fit', 'roster', 'hw', 'nt'],
      fit: {}, draw: {}, group: {}, roster: { rosterSel: [], rollSel: [], rollSt: {}, rollNames: '' },
      hide: { hwHide: {}, ntHide: {} }, tt: { termStart: '' },
      prefs: { hwRemind: {}, ntSub: false, ntSubAt: 0, toolOrder: ['roster', 'fit', 'hw', 'nt', 'draw', 'tt', 'group', 'roll'] },
      nick: '', power: { sel: '', at: 0, low: 30 }, water: { rooms: {} }, homeToolsAt: T1
    };
    assert.strictEqual(cloud.udApply(android), true);
    assert.deepStrictEqual(tools.homeTools(), ['ft', 'bz', 'hw', 'nt'], '安卓的 fit/roster 必须是体测/名单，不能丢');
    assert.deepStrictEqual(tools.toolOrder().slice(0, 6), ['bz', 'ft', 'hw', 'nt', 'draw', 'tt'], '安卓顺序归一后保持相对位置');
    assert.strictEqual(tools.toolOrder().indexOf('group'), 6, 'group 是独立工具，不再被映射成 draw');
    assert.strictEqual(tools.localKey('group'), 'group', '读云端不把 group 并入 draw');
    assert.strictEqual(store.get().toolOrderSetAt, T2, '应用安卓顺序后本机时间戳 = 云端 at.prefs');
  });

  await test('跨端 key：小程序写云端统一 canonical（bz→committee），不写 fit/roster/bz', () => {
    const { store, tools, cloud } = fresh();
    clearMem();
    setIdentity();
    tools.setToolOrder(['draw', 'ft', 'bz', 'hw', 'nt', 'tt', 'roll', 'water']);
    store.get().homeTools = ['ft', 'bz', 'hw'];
    store.get().homeToolsAt = 1800000030000;
    store.save();
    const view = cloud.udSections();
    assert.deepStrictEqual(view.homeTools, ['ft', 'committee', 'hw'], 'homeTools 写云端用网页/安卓可识别的 committee');
    assert.ok(view.prefs.toolOrder.indexOf('committee') >= 0, 'prefs.toolOrder 写云端同样用 committee');
    ['fit', 'roster', 'bz'].forEach(function (k) {
      assert.strictEqual(view.prefs.toolOrder.indexOf(k), -1, '写云端不得出现小程序本机/安卓旧 key：' + k);
    });
    // 网页 canonical（committee）再回读 → 仍是本机 bz（幂等，不会来回改名）
    assert.deepStrictEqual(tools.normalizeHome(['ft', 'committee', 'hw']), ['ft', 'bz', 'hw']);
    assert.deepStrictEqual(tools.normalizeToolOrder(['committee', 'ft']).slice(0, 2), ['bz', 'ft']);
  });

  await test('跨端 key：小程序勾选电费/诊断（原 noHome）可进首页并写云端', () => {
    const { store, tools, cloud } = fresh();
    clearMem();
    setIdentity();
    // 默认已勾 4 个（hw/nt/ft/draw）→ 先取消两个腾位子
    assert.strictEqual(tools.setHomeTool('ft', false).ok, true);
    assert.strictEqual(tools.setHomeTool('nt', false).ok, true);
    assert.deepStrictEqual(tools.homeTools(), ['hw', 'draw']);
    assert.strictEqual(tools.setHomeTool('power', true).ok, true, '电费可勾选');
    assert.strictEqual(tools.setHomeTool('diag', true).ok, true, '诊断可勾选');
    assert.deepStrictEqual(tools.homeTools(), ['hw', 'draw', 'power', 'diag'], '勾选顺序按 toolOrder');
    const view = cloud.udSections();
    assert.ok(view.homeTools.indexOf('power') >= 0 && view.homeTools.indexOf('diag') >= 0, '电费/诊断随 homeTools 进云端');
    assert.ok(store.get().homeTools.indexOf('power') >= 0);
  });

  await test('云同步边界：无基线时自定义顺序抢时间戳；远端 prefs 无 toolOrder 不清空本机自定义', () => {
    const { store, tools, cloud } = fresh();
    clearMem();
    setIdentity();
    const order = ['roll', 'draw', 'hw', 'nt', 'ft', 'tt', 'bz', 'power', 'water', 'stats', 'diag'];
    tools.setToolOrder(order);
    assert.ok(store.get().toolOrderSetAt > 0, '用户拖过排序 → 本机标记 toolOrderSetAt');
    const view = cloud.udSections();
    assert.ok(view.at.prefs >= store.get().toolOrderSetAt, '无基线：at.prefs 抬到本机改动时间，避免被旧云端 prefs 覆盖');
    assert.deepStrictEqual(view.prefs.toolOrder.slice(0, 3), order.slice(0, 3));
    // 模拟云端 prefs 更晚但没有 toolOrder（其它端只改了提醒偏好）→ 不应清空本机自定义顺序
    const remote = {
      v: 6,
      at: { homeTools: 0, fit: 0, draw: 0, group: 0, roster: 0, hide: 0, tt: 0, prefs: 1900000000000, nick: 0, power: 0, water: 0 },
      homeTools: ['hw'], fit: {}, draw: {}, group: {}, roster: { rosterSel: [], rollSel: [], rollSt: {}, rollNames: '' },
      hide: { hwHide: {}, ntHide: {} }, tt: { termStart: '' }, prefs: { hwRemind: {}, ntSub: false, ntSubAt: 0 },
      nick: '', power: { sel: '', at: 0, low: 30 }, water: { rooms: {} }, homeToolsAt: 0
    };
    cloud.udApply(remote);
    assert.deepStrictEqual(tools.toolOrder().slice(0, 3), order.slice(0, 3), '远端没有 toolOrder 时保留本机自定义顺序（脏检测自愈回推）');
  });

  await test('UD 应用：远端 homeTools 2 项 → 本机只保留 2 项（旧 tail 不会回来）', () => {
    const { store, tools, cloud } = fresh();
    clearMem();
    setIdentity();
    store.get().homeTools = ['hw', 'nt', 'ft', 'draw'];
    store.save();
    const remote = {
      v: 6,
      at: { homeTools: 1800000000000, fit: 0, draw: 0, group: 0, roster: 0, hide: 0, tt: 0, prefs: 0, nick: 0, power: 0, water: 0 },
      homeTools: ['tt', 'draw'],
      fit: {}, draw: {}, group: {}, roster: { rosterSel: [], rollSel: [], rollSt: {}, rollNames: '' },
      hide: { hwHide: {}, ntHide: {} }, tt: { termStart: '' }, prefs: { hwRemind: {}, ntSub: false, ntSubAt: 0 },
      nick: '', power: { sel: '', at: 0, low: 30 }, water: { rooms: {} }, homeToolsAt: 1800000000000
    };
    assert.strictEqual(cloud.udApply(remote), true);
    assert.deepStrictEqual(store.get().homeTools, ['tt', 'draw'], '云端 ≤4 的勾选集合应原样应用');
    assert.strictEqual(store.get().homeToolsAt, 1800000000000);
    assert.deepStrictEqual(tools.homeTools(), ['tt', 'draw'], '之后读取不得自动补齐第 5+ 项');
    assert.deepStrictEqual(keysOf(tools.quickList(4)), ['tt', 'draw']);
    // 远端 5 项脏数据（不应出现，但兼容）→ 只应用前 4
    remote.homeTools = ['tt', 'draw', 'hw', 'nt', 'ft'];
    remote.at.homeTools = 1800000001000;
    remote.homeToolsAt = 1800000001000;
    cloud.udApply(remote);
    assert.deepStrictEqual(store.get().homeTools, ['tt', 'draw', 'hw', 'nt'], '云端最多应用前 4 个');
  });

  await test('UD 应用：旧版全量 homeTools 先迁移 toolOrder 再应用云端值（旧顺序不丢）', () => {
    const { store, tools, cloud } = fresh();
    clearMem();
    setIdentity();
    const legacy = ['roll', 'tt', 'draw', 'hw', 'nt', 'ft', 'bz'];
    store.get().homeTools = legacy.slice();
    store.get().homeToolsAt = 1000;
    store.save();
    const remote = {
      v: 6,
      at: { homeTools: 1800000002000, fit: 0, draw: 0, group: 0, roster: 0, hide: 0, tt: 0, prefs: 0, nick: 0, power: 0, water: 0 },
      homeTools: ['tt', 'hw'],
      fit: {}, draw: {}, group: {}, roster: { rosterSel: [], rollSel: [], rollSt: {}, rollNames: '' },
      hide: { hwHide: {}, ntHide: {} }, tt: { termStart: '' }, prefs: { hwRemind: {}, ntSub: false, ntSubAt: 0 },
      nick: '', power: { sel: '', at: 0, low: 30 }, water: { rooms: {} }, homeToolsAt: 1800000002000
    };
    cloud.udApply(remote);
    assert.deepStrictEqual(tools.toolOrder().slice(0, 7), legacy, 'udApply 前必须先迁移旧全量顺序到 toolOrder');
    assert.deepStrictEqual(store.get().homeTools, ['tt', 'hw'], '云端勾选集合应用（≤4）');
    assert.deepStrictEqual(tools.homeTools(), ['tt', 'hw']);
  });

  await test('UD 应用：云端空勾选语义（at>0 主动清空 → 应用；at=0 无数据 → 不覆盖本机默认）', () => {
    const { store, tools, cloud } = fresh();
    clearMem();
    setIdentity();
    const mk = (arr, at) => ({
      v: 6,
      at: { homeTools: at, fit: 0, draw: 0, group: 0, roster: 0, hide: 0, tt: 0, prefs: 0, nick: 0, power: 0, water: 0 },
      homeTools: arr,
      fit: {}, draw: {}, group: {}, roster: { rosterSel: [], rollSel: [], rollSt: {}, rollNames: '' },
      hide: { hwHide: {}, ntHide: {} }, tt: { termStart: '' }, prefs: { hwRemind: {}, ntSub: false, ntSubAt: 0 },
      nick: '', power: { sel: '', at: 0, low: 30 }, water: { rooms: {} }, homeToolsAt: at
    });
    // 云端无数据（at=0，新账号/旧版清除）→ 不覆盖本机默认勾选
    cloud.udApply(mk([], 0));
    assert.deepStrictEqual(store.get().homeTools, ['hw', 'nt', 'ft', 'draw'], '空 + at=0 视为无数据，保留本机默认');
    // 云端主动全部取消（at>0）→ 应用空勾选（否则取消无法跨端生效）
    store.get().homeToolsAt = 0;
    cloud.udApply(mk([], 1800000005000));
    assert.deepStrictEqual(store.get().homeTools, [], '空 + at>0 = 用户主动取消，必须应用');
    assert.strictEqual(store.get().homeToolsAt, 1800000005000);
    assert.deepStrictEqual(tools.quickList(4), []);
  });

  /* ---------- 9. 导出 / 隐私 ---------- */
  await test('导出/隐私：homeTools ≤4 + prefs.toolOrder（工具页顺序）随同导出；v6 空 blob/14 顶层键契约不变', () => {
    const { store, tools, privacy } = fresh();
    clearMem();
    tools.setToolOrder(['draw', 'hw', 'nt', 'ft', 'tt', 'roll', 'bz', 'power', 'water', 'stats', 'diag']);
    store.get().homeTools = ['draw', 'hw', 'nt', 'ft'];
    const exp = privacy.buildExport(store.get(), ID, 1800000003000);
    assert.deepStrictEqual(exp.sync.homeTools, ['draw', 'hw', 'nt', 'ft']);
    assert.deepStrictEqual(exp.sync.prefs.toolOrder.slice(0, 3), ['draw', 'hw', 'nt'], '工具页自定义顺序已进入同步并随导出');
    assert.ok(privacy.exportJson(store.get(), ID).indexOf('toolOrder') >= 0);
    // 隐私 section 清单 / 空 v6 不变（不新增顶层键）
    assert.deepStrictEqual(privacy.SECTION_KEYS, ['homeTools', 'fit', 'draw', 'group', 'roster', 'hide', 'tt', 'prefs', 'nick', 'power', 'water']);
    assert.deepStrictEqual(Object.keys(privacy.emptyV6()), ['v', 'at'].concat(privacy.SECTION_KEYS).concat(['homeToolsAt']));
    assert.ok(privacy.emptyV6().prefs.toolOrder === undefined, '空 v6 不带 toolOrder（默认不占同步体积）');
    // SCOPE 同步范围文案已覆盖工具页顺序
    assert.ok(privacy.SCOPE.indexOf('工具栏顺序与工具页顺序') >= 0, privacy.SCOPE.join(','));
  });

  /* ---------- 10. 页面：async 与静态 ---------- */
  await test('页面静态：无顶部首页快捷区 / 无勾选框；有「编辑首页」按钮 + 编辑态说明 + 徽标 + 触摸 handler', () => {
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/all/all.wxml'), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, 'pages/all/all.js'), 'utf8');
    const idxWxml = fs.readFileSync(path.join(ROOT, 'pages/index/index.wxml'), 'utf8');
    // 顶部「首页快捷」展示区（标题 + 快捷行 + 空态）必须整块删除
    assert.strictEqual(wxml.indexOf('q-row'), -1, '顶部首页快捷行 q-row 必须删除');
    assert.strictEqual(wxml.indexOf('q-empty'), -1, '顶部快捷空态 q-empty 必须删除');
    assert.strictEqual(wxml.indexOf('>首页快捷<'), -1, '页面不再展示「首页快捷」区块标题');
    assert.ok(wxml.indexOf('id="home-edit-btn"') >= 0, '「编辑首页」按钮必须有固定 id（自动化断言用）');
    assert.ok(wxml.indexOf('编辑首页') >= 0 && wxml.indexOf("'完成'") >= 0, '按钮普通态「编辑首页」→ 编辑态「完成」');
    assert.ok(wxml.indexOf('长按工具可拖动排序') >= 0, '普通模式说明「长按工具可拖动排序」');
    assert.ok(wxml.indexOf('点工具加入或移出首页快捷（最多 4 个）') >= 0, '编辑模式说明文字');
    // 普通模式不得有任何勾选框：徽标只在编辑模式渲染
    assert.strictEqual(wxml.indexOf('tool-check'), -1, '不得再有普通态勾选框');
    assert.strictEqual(wxml.indexOf('home-check'), -1);
    assert.ok(wxml.indexOf('wx:if="{{editMode}}"') >= 0, '勾选徽标只在编辑模式渲染');
    assert.ok(wxml.indexOf('id="tile-home-mark-{{item.key}}"') >= 0, '选中徽标固定 id 便于自动化断言');
    // 交互 handler
    assert.ok(wxml.indexOf('bindtap="toggleEditMode"') >= 0, '按钮必须绑定编辑态切换');
    assert.ok(wxml.indexOf('bindtap="onToolTap"') >= 0, 'tile 点按统一走 onToolTap（普通打开 / 编辑切换）');
    assert.ok(wxml.indexOf('bindtouchstart="onToolTouchStart"') >= 0, '工具格必须绑定长按拖动 touchstart');
    assert.ok(wxml.indexOf('bindtouchmove="onToolTouchMove"') >= 0);
    assert.ok(wxml.indexOf('bindtouchend="onToolTouchEnd"') >= 0);
    assert.ok(wxml.indexOf('page-meta') >= 0, '拖动中需要 page-meta 锁页面滚动');
    // 页面 JS：无旧弹层/旧勾选框逻辑，保留拖动与轻震
    assert.strictEqual(js.indexOf('orderShow'), -1, 'all.js 不应再有排序弹层状态');
    assert.strictEqual(js.indexOf('QUICK_N'), -1, '页面不再维护顶部快捷区（QUICK_N）');
    assert.strictEqual(js.indexOf('quickEmpty'), -1);
    assert.strictEqual(js.indexOf('moveInHome'), -1);
    assert.ok(js.indexOf('editMode') >= 0, 'all.js 必须有编辑模式状态');
    assert.ok(js.indexOf('vibrateShort') >= 0, '长按进入拖动应有轻震反馈');
    // 工作台：勾选工具 + 无勾选引导空态（保持不变）
    assert.ok(idxWxml.indexOf('尚未勾选常用工具') >= 0);
    assert.ok(idxWxml.indexOf('去勾选') >= 0);
  });

  await test('页面方法：编辑首页模式切换 / 编辑态点 tile 勾选（第5个 toast）/ 普通态点 tile 打开工具 / onShow 退出编辑态', () => {
    const { store, tools } = fresh();
    clearMem();
    setIdentity();
    toastLog = [];
    navLog = [];
    const def = loadPage('pages/all/all.js');
    assert.strictEqual(def.openOrder, undefined, '旧「调整」按钮方法应删除');
    assert.strictEqual(def.closeOrder, undefined);
    assert.strictEqual(def.move, undefined);
    ['onToolTap', 'openTool', 'toggleEditMode', 'toggleHome', 'render', 'onToolTouchStart', 'onToolTouchMove', 'onToolTouchEnd', 'onToolTouchCancel', 'applyAgentHandoff', 'onCloudSync', 'onShow'].forEach(function (k) {
      assert.strictEqual(typeof def[k], 'function', '缺少页面方法 ' + k);
    });
    const ctx = pageCtx(def);
    def.render.call(ctx);
    assert.strictEqual(ctx.data.quick, undefined, '页面 data 不再有顶部快捷区数据');
    assert.strictEqual(ctx.data.editMode, false, '默认普通模式');
    assert.ok(ctx.data.all.length >= 9, '普通同学可见工具（不含统计/诊断）');
    assert.strictEqual(ctx.data.all.some(function (x) { return x.key === 'stats'; }), false, '非管理员不渲染统计');
    assert.strictEqual(ctx.data.all.filter(function (x) { return x.home; }).length, 4, '勾选态仍计算（编辑模式徽标用）');
    // 普通模式点 tile → 打开工具，不改变勾选
    def.onToolTap.call(ctx, { currentTarget: { dataset: { key: 'tt' } } });
    assert.deepStrictEqual(navLog.map(function (x) { return x.url; }), ['/pages/tt/tt'], '普通模式点 tile 打开工具');
    assert.strictEqual(ctx.data.all.filter(function (x) { return x.home; }).length, 4, '普通模式点 tile 不改勾选');
    // 点按钮进入编辑模式
    def.toggleEditMode.call(ctx);
    assert.strictEqual(ctx.data.editMode, true, '点「编辑首页」进入编辑模式');
    // 编辑态点 tile = 切换勾选，不打开工具；勾满 4 个再点第 5 个 → toast
    navLog = [];
    def.onToolTap.call(ctx, { currentTarget: { dataset: { key: 'tt' } } });
    assert.deepStrictEqual(toastLog, ['最多选 4 个'], '编辑态勾满后再点应 toast「最多选 4 个」');
    assert.deepStrictEqual(navLog, [], '编辑模式点 tile 不应打开工具');
    assert.strictEqual(ctx.data.all.find(function (x) { return x.key === 'tt'; }).home, false, '被拒后状态不变');
    // 取消一个 → 再选 tt（按 toolOrder 顺序进入）
    def.onToolTap.call(ctx, { currentTarget: { dataset: { key: 'nt' } } });
    assert.strictEqual(store.get().homeTools.indexOf('nt'), -1, '编辑态再点已选 tile = 移出首页');
    def.onToolTap.call(ctx, { currentTarget: { dataset: { key: 'tt' } } });
    assert.deepStrictEqual(store.get().homeTools, ['tt', 'hw', 'ft', 'draw'], '新勾选按 toolOrder 排序');
    assert.strictEqual(ctx.data.all.find(function (x) { return x.key === 'tt'; }).home, true, '徽标/描边态更新');
    // 点「完成」退出编辑模式
    def.toggleEditMode.call(ctx);
    assert.strictEqual(ctx.data.editMode, false, '点「完成」退出编辑模式');
    // onShow（切页/回前台）强制退出编辑态
    def.toggleEditMode.call(ctx);
    assert.strictEqual(ctx.data.editMode, true);
    def.onShow.call(ctx);
    assert.strictEqual(ctx.data.editMode, false, '切页/回到前台后必须退出编辑态');
  });

  await test('页面拖动算法：2 列网格最近格子 + 迟滞；reorder 后松手落盘 toolOrder/homeTools', () => {
    const { store, tools } = fresh();
    clearMem();
    setIdentity();
    const def = loadPage('pages/all/all.js');
    const ctx = pageCtx(def);
    def.render.call(ctx);
    // 编辑模式内禁用长按拖动；普通模式保留
    ctx.data.editMode = true;
    def.onToolTouchStart.call(ctx, { touches: [{ clientX: 10, clientY: 10 }], currentTarget: { dataset: { key: 'tt' } } });
    assert.ok(!ctx._longT, '编辑模式内不得启动长按拖动');
    ctx.data.editMode = false;
    def.onToolTouchStart.call(ctx, { touches: [{ clientX: 10, clientY: 10 }], currentTarget: { dataset: { key: 'tt' } } });
    assert.ok(!!ctx._longT, '普通模式长按拖动仍可用');
    def._clearLongPress.call(ctx);
    const keys0 = ctx.data.all.map(function (x) { return x.key; });
    // 伪造 2 列网格几何（每格 180×70，间距 10）：index → (row, col)
    const slots = [];
    keys0.forEach(function (k, i) {
      const row = Math.floor(i / 2), col = i % 2;
      slots.push({ left: col * 190, top: row * 80, width: 180, height: 70, right: col * 190 + 180, bottom: row * 80 + 70 });
    });
    ctx._drag = { key: 'tt', curIndex: 0, slots: slots, scrollTop: 0, lastAuto: 0, lastMeasure: 0, keysSnapshot: keys0.slice(), pointer: { x: 0, y: 0 } };
    // 指针在第 4 格中心 → 目标 index 3
    assert.strictEqual(def._targetIndex.call(ctx, slots[3].left + 90, slots[3].top + 35), 3);
    // 指针在第 0 格中心 → 目标 0（= 当前，不切换）
    assert.strictEqual(def._targetIndex.call(ctx, slots[0].left + 90, slots[0].top + 35), 0);
    // 迟滞：指针刚到第 3 格边缘、离第 1 格更近时保持当前目标
    const near = def._targetIndex.call(ctx, slots[1].left + 8, slots[1].top + 8);
    assert.ok(near === 0 || near === 1, '临界位置应在当前/相邻格之间稳定（不抖动）');
    // 实时重排
    def._reorderTo.call(ctx, 3);
    assert.strictEqual(ctx.data.all[3].key, 'tt');
    assert.strictEqual(ctx._drag.curIndex, 3);
    // 松手落定 → toolOrder 落盘 + homeTools 按新顺序 + 重绘
    def._endDrag.call(ctx);
    assert.strictEqual(ctx._drag, null);
    assert.strictEqual(ctx.data.dragging, false);
    const savedOrder = tools.toolOrder();
    assert.strictEqual(savedOrder.indexOf('tt'), 3, '松手后 toolOrder 应保留拖动后的顺序');
    const raw = JSON.parse(mem[require('../utils/store.js').KEY]);
    assert.strictEqual(raw.toolOrder.indexOf('tt'), 3, '拖动结果必须落盘到 zq_tools_v2');
    assert.deepStrictEqual(tools.homeTools(), ['hw', 'nt', 'ft', 'draw'], '未勾选工具的拖动不影响勾选集合');
    // 拖动对快捷顺序的影响：把已勾选的 draw 拖到最前 → 首页快捷顺序同步
    assert.deepStrictEqual(tools.setHomeTool('hw', false).ok, true);
    assert.deepStrictEqual(tools.setHomeTool('tt', true).ok, true);
    const ctx2 = pageCtx(def);
    def.render.call(ctx2);
    const keys2 = ctx2.data.all.map(function (x) { return x.key; });
    const slots2 = [];
    keys2.forEach(function (k, i) {
      const row = Math.floor(i / 2), col = i % 2;
      slots2.push({ left: col * 190, top: row * 80, width: 180, height: 70, right: col * 190 + 180, bottom: row * 80 + 70 });
    });
    const drawIdx = keys2.indexOf('draw');
    ctx2._drag = { key: 'draw', curIndex: drawIdx, slots: slots2, scrollTop: 0, lastAuto: 0, lastMeasure: 0, keysSnapshot: keys2.slice(), pointer: { x: 0, y: 0 } };
    def._reorderTo.call(ctx2, 0);
    def._endDrag.call(ctx2);
    assert.strictEqual(tools.toolOrder()[0], 'draw');
    assert.strictEqual(tools.homeTools()[0], 'draw', '已勾选工具拖到最前 → 首页快捷顺序同步');
  });

  await test('工作台页面：quick = 勾选工具；无勾选时 quickEmpty = true（引导空态）', () => {
    const { store } = fresh();
    clearMem();
    setIdentity();
    const def = loadPage('pages/index/index.js');
    const ctx = pageCtx(def);
    ctx.data.state = 'data';
    ctx._hidden = false;
    ctx._restartRotate = function () {};
    def.refresh.call(ctx);
    assert.deepStrictEqual(keysOf(ctx.data.quick), ['hw', 'nt', 'ft', 'draw']);
    assert.strictEqual(ctx.data.quickEmpty, false);
    store.get().homeTools = [];
    def.refresh.call(ctx);
    assert.deepStrictEqual(ctx.data.quick, []);
    assert.strictEqual(ctx.data.quickEmpty, true, '无勾选时首页显示引导空态');
  });

  await test('回归：自定义顺序后勾选只剩 draw/hw/nt 不会被旧默认迁移误补回 4 个（homeToolsAt>0）', () => {
    const { store, tools } = fresh();
    clearMem();
    setIdentity();
    const d = store.get();
    d.toolOrder = ['draw', 'hw', 'nt', 'ft', 'tt', 'roll', 'bz', 'power', 'water', 'stats', 'diag'];
    d.homeTools = ['draw', 'hw', 'nt'];   // 与 LEGACY_HOMES[0] 同形，但用户改动过（homeToolsAt>0）
    d.homeToolsAt = Date.now();
    store.save();
    assert.deepStrictEqual(tools.homeTools(), ['draw', 'hw', 'nt'], '不应被误迁移回默认 4 个');
  });

  /* ---------- 汇总 ---------- */
  const out = { at: new Date().toISOString(), pass: passN, fail: failN, skip: skipN, checks: results };
  fs.writeFileSync(path.join(__dirname, 'tool_sort_unit_result.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n============ ' + passN + ' passed, ' + failN + ' failed ============');
  process.exit(failN ? 1 : 0);
})().catch((e) => {
  console.error('FATAL ' + ((e && e.stack) || e));
  process.exit(1);
});
