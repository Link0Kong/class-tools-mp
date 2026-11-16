/* water_unit_tests.js —— 宿舍「水量统计」专项单测（2026-11-06，随 unit.js 运行）
 *
 * 覆盖 web/tools/tests/_water_contract.md §0/§1/§2/§6 的小程序侧：
 *   A. 计费常量与水费公式（4/6 人间、未超定额=0 元、保留 2 位、折合扣电 1 位）；
 *   B. 用量对比 / 删除后重算 / 同月覆盖 / 读数回退拒绝 / 120 条上限 / 2 位归一；
 *   C. store 旧数据默认 {rooms:{}} + 坏数据归一；
 *   D. UD water section：udSections / udApply（web→mp）/ 合并默认值；
 *   E. pages/water 页面注册、事件、渲染（历史倒序 / 对比 / 人数切换 / 保存 / 删除重算）、
 *      规则卡文案（0.58/3.03/2 吨+5 度/来源/以学校最新通知为准；不出现市政阶梯价）、app.json 注册。
 * 说明：仅 Node 内置模块 + unit.js 的 wx 内存 mock；不访问真实云端。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = 'C:/Users/Ko_Li/.openclaw/workspace/mp-class-tools';
const ID = { token: 'tok-water-1', sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: true, ts: 1 };

function purge() {
  Object.keys(require.cache).forEach(function (k) {
    const kk = k.replace(/\\/g, '/');
    if (kk.indexOf(ROOT) !== 0) return;
    const m = require.cache[k];
    try { if (m && m.exports && typeof m.exports.udStop === 'function') m.exports.udStop(); } catch (e) { /* ignore */ }
    delete require.cache[k];
  });
}
function R(rel) { return require(path.join(ROOT, rel)); }
function src(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function setIdentity() { global.wx.setStorageSync('zq_class_identity', JSON.stringify(ID)); }
function clearStorage() {
  Object.keys(require.cache).forEach(function (k) { /* noop: storage mock lives in unit.js */ });
}
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
  ctx.setData = function (o, cb) { Object.assign(this.data, o); if (cb) cb(); };
  return ctx;
}

async function run(test) {
  /* ============================ A. 计费公式 ============================ */
  await test('water：计费常量与 web 契约 §0 一致（0.58 / 3.03 / 2 吨+5 度 / 4|6 人）', function () {
    purge();
    const water = R('utils/water.js');
    assert.strictEqual(water.RULES.elec, 0.58);
    assert.strictEqual(water.RULES.water, 3.03);
    assert.strictEqual(water.RULES.waterFreePP, 2);
    assert.strictEqual(water.RULES.elecFreePP, 5);
    assert.strictEqual(water.RULES.personsDef, 4);
    assert.deepStrictEqual(water.RULES.personsOpts, [4, 6]);
    assert.strictEqual(water.RULES.waterDate, '2025-09-05');
    assert.strictEqual(water.RULES.elecDate, '2025-09-05');
    assert.strictEqual(water.RULES.quotaDate, '2021-07');
    assert.strictEqual(water.normPersons(4), 4);
    assert.strictEqual(water.normPersons(6), 6);
    assert.strictEqual(water.normPersons(5), 4, '非法人数 → 默认 4');
    assert.strictEqual(water.quotaOf(4), 8);
    assert.strictEqual(water.quotaOf(6), 12);
    assert.strictEqual(water.quotaElecOf(4), 20);
  });

  await test('water：水费 = max(0, 用量−2×人数)×3.03（4/6 人间、未超定额=0、2 位）', function () {
    const water = R('utils/water.js');
    // 4 人间免费 8 吨
    assert.strictEqual(water.feeOf(6, 4), 0, '用量 6 < 8 → 0 元');
    assert.strictEqual(water.feeOf(8, 4), 0, '刚好 8 吨 → 0 元');
    assert.strictEqual(water.feeOf(10, 4), 6.06, '(10-8)*3.03');
    assert.strictEqual(water.feeOf(9.5, 4), 4.55, '1.5*3.03=4.545 → 4.55');
    // 6 人间免费 12 吨
    assert.strictEqual(water.feeOf(12, 6), 0);
    assert.strictEqual(water.feeOf(15, 6), 9.09, '(15-12)*3.03');
    // 折合扣电 = 水费/0.58（1 位）
    assert.strictEqual(water.degOf(6.06), 10.4);
    assert.strictEqual(water.degOf(21.21), 36.6);
    assert.strictEqual(water.TON_TO_DEG.toFixed(4), '5.2241');
    assert.ok(Math.abs(water.TON_TO_DEG - 3.03 / 0.58) < 1e-12);
  });

  /* ============================ B. 对比 / 重算 ============================ */
  const RECS = [
    { m: '2026-09', r: 100.0, ts: 3 },
    { m: '2026-10', r: 106.0, ts: 2 },   // 乱序输入
    { m: '2026-11', r: 115.0, ts: 1 }
  ];
  await test('water：自动对比（用量=本次−上次，首条「首次记录」）', function () {
    const water = R('utils/water.js');
    const cmp = water.compareOf(RECS, 4);
    assert.strictEqual(cmp.empty, false);
    assert.strictEqual(cmp.first, false);
    assert.strictEqual(cmp.rec.m, '2026-11');
    assert.strictEqual(cmp.prev.m, '2026-10');
    assert.strictEqual(cmp.usage, 9, '115-106');
    assert.strictEqual(cmp.fee, 3.03, '(9-8)*3.03');
    assert.strictEqual(cmp.deg, 5.2);
    assert.strictEqual(cmp.over, 1);
    assert.strictEqual(water.compareOf([], 4).empty, true);
    const only = water.compareOf([{ m: '2026-09', r: 100, ts: 1 }], 4);
    assert.strictEqual(only.first, true);
    assert.strictEqual(only.usage, null);
  });

  await test('water：历史按月倒序 + 用量/水费随人数；删除后自动重算', function () {
    const water = R('utils/water.js');
    let hist = water.buildHistory(RECS, 4);
    assert.deepStrictEqual(hist.map((x) => x.m), ['2026-11', '2026-10', '2026-09'], '倒序');
    assert.strictEqual(hist[2].usage, null, '最早一条用量 —');
    assert.strictEqual(hist[1].usage, 6);
    assert.strictEqual(hist[0].usage, 9);
    assert.strictEqual(hist[0].fee, 3.03);
    // 6 人间：9 吨未超 12 吨定额 → 0 元
    assert.strictEqual(water.buildHistory(RECS, 6)[0].fee, 0);
    // 删除 2026-10 后：2026-11 的用量 = 115 − 100 = 15，水费 (15−8)*3.03 = 21.21
    const del = water.delRecord(RECS, '2026-10');
    assert.deepStrictEqual(del.map((x) => x.m), ['2026-09', '2026-11']);
    const hist2 = water.buildHistory(del, 4);
    assert.strictEqual(hist2[0].m, '2026-11');
    assert.strictEqual(hist2[0].usage, 15, '删除后按剩余的上一条重算用量');
    assert.strictEqual(hist2[0].fee, 21.21);
    assert.strictEqual(hist2[0].deg, 36.6);
    assert.strictEqual(hist2[1].usage, null);
  });

  await test('water：保存校验（读数回退拒绝 / 同月覆盖 / 非法输入 / 120 条上限 / 2 位归一）', function () {
    const water = R('utils/water.js');
    // 读数小于上一条 → 拒绝（不落盘）
    let r = water.saveRecord(RECS, '2026-12', 90, 4, 10);
    assert.strictEqual(r.ok, false);
    assert.ok(r.reason.indexOf('不能小于') >= 0);
    assert.deepStrictEqual(r.recs, undefined);
    // 同月覆盖（10 月改成 104）
    r = water.saveRecord(RECS, '2026-10', 104.567, 4, 10);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.replaced, true);
    const hit = r.recs.filter((x) => x.m === '2026-10')[0];
    assert.strictEqual(hit.r, 104.57, '读数保留 2 位');
    assert.strictEqual(hit.ts, 10);
    assert.deepStrictEqual(r.recs.map((x) => x.m), ['2026-09', '2026-10', '2026-11']);
    // 非法输入
    assert.strictEqual(water.saveRecord(RECS, '2026-13', 120, 4).ok, false, '非法月份');
    assert.strictEqual(water.saveRecord(RECS, '2026-12', -1, 4).ok, false, '负数读数');
    assert.strictEqual(water.saveRecord(RECS, '2026-12', 'abc', 4).ok, false, '非数字');
    // 首条无上一条 → 任意合法读数
    assert.strictEqual(water.saveRecord([], '2026-09', 0, 4).ok, true, '0 是合法初始读数');
    // 120 条上限丢最旧
    const many = [];
    for (let i = 0; i < 125; i++) {
      const m = '20' + String(10 + Math.floor(i / 12)).slice(-2) + '-' + ('0' + (i % 12 + 1)).slice(-2);
      many.push({ m: m, r: 100 + i, ts: i });
    }
    const capped = water.normRecs(many);
    assert.strictEqual(capped.length, 120);
    assert.strictEqual(capped[119].r, 224, '保留最新 120 条');
    // 乱序 + 同月重复：按 ts 取较新、升序
    const dup = water.normRecs([{ m: '2026-11', r: 1, ts: 1 }, { m: '2026-10', r: 2, ts: 2 }, { m: '2026-11', r: 3.456, ts: 3 }]);
    assert.deepStrictEqual(dup.map((x) => x.m), ['2026-10', '2026-11']);
    assert.strictEqual(dup[1].r, 3.46);
  });

  await test('water：输入即时预览（写入后的用量/水费/折合扣电；读数回退提示）', function () {
    const water = R('utils/water.js');
    const pv = water.previewOf(RECS, '2026-12', 130.4, 4, 9);
    assert.strictEqual(pv.valid, true);
    assert.strictEqual(pv.usage, 15.4, '130.4-115.0');
    assert.strictEqual(pv.fee, 22.42, '(15.4-8)*3.03=22.422 → 保留 2 位');
    assert.strictEqual(pv.deg, 38.7);
    assert.strictEqual(pv.over, 7.4);
    const bad = water.previewOf(RECS, '2026-12', 90, 4);
    assert.strictEqual(bad.valid, false);
    assert.ok(bad.reason.indexOf('不能小于') >= 0);
    // 同月覆盖预览：10 月改 110（上一条 9 月 100）→ 用量 10
    const rep = water.previewOf(RECS, '2026-10', 110, 4);
    assert.strictEqual(rep.valid, true);
    assert.strictEqual(rep.replaced, true);
    assert.strictEqual(rep.usage, 10);
  });

  /* ============================ C. store 归一 ============================ */
  await test('store：旧数据无 water → 默认 {rooms:{}}；坏 water 归一；withPersons/withRecs 写回', function () {
    purge();
    const store = R('utils/store.js');
    const water = R('utils/water.js');
    // 旧数据（无 water 键）读取不报错，默认空 rooms
    const d0 = store.mkD({ power: { sel: '4-23A---321', at: 1 } });
    assert.deepStrictEqual(d0.water, { rooms: {} });
    // 坏数据 → 空对象
    assert.deepStrictEqual(store.mkD({ water: 'bad' }).water, { rooms: {} });
    // 正常数据归一：人数非法 → 4；recs 2 位/升序
    const d1 = store.mkD({ water: { rooms: { '1-16---305': { p: 9, recs: [{ m: '2026-11', r: 10.129, ts: 2 }, { m: '2026-10', r: 9, ts: 1 }] } } } });
    assert.strictEqual(d1.water.rooms['1-16---305'].p, 4);
    assert.deepStrictEqual(d1.water.rooms['1-16---305'].recs.map((x) => x.m), ['2026-10', '2026-11']);
    assert.strictEqual(d1.water.rooms['1-16---305'].recs[1].r, 10.13);
    // 页面写回纯函数：人数 / 记录互不覆盖
    let w = water.withPersons({ rooms: {} }, '4-23A---321', 6);
    assert.strictEqual(w.rooms['4-23A---321'].p, 6);
    assert.deepStrictEqual(w.rooms['4-23A---321'].recs, []);
    w = water.withRecs(w, '4-23A---321', RECS);
    assert.strictEqual(w.rooms['4-23A---321'].p, 6, '写记录不清人数');
    assert.strictEqual(w.rooms['4-23A---321'].recs.length, 3);
    assert.strictEqual(water.roomOf(w, '4-23A---321').p, 6);
    assert.deepStrictEqual(water.roomOf(w, 'nope').recs, [], '未拥有房间 → 默认空');
  });

  /* ============================ D. UD water section ============================ */
  await test('UD：water section 在 11 个 section 末位；udSections 输出 {rooms}；udApply 恢复 web 值', function () {
    purge();
    const privacy = R('utils/privacy.js');
    const cloud = R('utils/cloud.js');
    const store = R('utils/store.js');
    assert.deepStrictEqual(privacy.SECTION_KEYS.slice(-2), ['power', 'water']);
    assert.deepStrictEqual(privacy.DEFAULTS.water, { rooms: {} });
    const empty = privacy.emptyV6();
    assert.deepStrictEqual(Object.keys(empty), ['v', 'at'].concat(privacy.SECTION_KEYS).concat(['homeToolsAt']));
    assert.strictEqual(Object.keys(empty).length, 14);
    assert.strictEqual(Object.keys(empty.at).length, 11);
    assert.deepStrictEqual(cloud.mergeUd(null, {}).water, { rooms: {} }, '合并缺省 water={rooms:{}}');
    assert.strictEqual(cloud.mergeUd(null, {}).at.water, 0);
    // web → mp：远端 blob 的 water 应用到 store；值内不镜像 at
    const webWater = { rooms: { '4-23A---321': { p: 4, recs: [{ m: '2026-10', r: 106.2, ts: 1762100000000 }] } } };
    const remote = { v: 6, at: { homeTools: 0, fit: 0, draw: 0, group: 0, roster: 0, hide: 0, tt: 0, prefs: 0, nick: 0, power: 0, water: 1762300900000 }, homeTools: [], fit: {}, draw: {}, group: {}, roster: { rosterSel: [], rollSel: [], rollSt: {}, rollNames: '' }, hide: { hwHide: {}, ntHide: {} }, tt: { ttView: '', ttUseMine: false, ttLocal: null, termStart: '' }, prefs: { hwRemind: {}, ntSub: false, ntSubAt: 0 }, nick: '', power: { sel: '', at: 0, low: 30 }, water: webWater, homeToolsAt: 0 };
    assert.strictEqual(cloud.udApply(remote), true);
    assert.deepStrictEqual(store.get().water, webWater, 'water 随账号恢复');
    assert.strictEqual(store.get().water.at, undefined, 'water 值内不镜像 at（只有 power 有）');
    // 本机视图 → udSections：结构一致、无 at 镜像
    const view = cloud.udSections();
    assert.deepStrictEqual(view.water, webWater);
    assert.deepStrictEqual(Object.keys(view.water), ['rooms']);
  });

  /* ============================ E. 页面 ============================ */
  await test('页面：app.json 注册 pages/water/water；tools 目录「水量」可勾选进首页；图标存在且在媒体预算内', function () {
    purge();
    const app = JSON.parse(src('app.json'));
    assert.ok(app.pages.indexOf('pages/water/water') >= 0, 'app.json 应注册 water 页');
    assert.ok(!app.subPackages || !app.subPackages.length, '水量页在主包');
    const tools = R('utils/tools.js');
    const t = tools.toolOf('water');
    assert.ok(t && t.name === '水量' && t.url === '/pages/water/water', '工具目录应有「水量」');
    // 2026-11-06 起：水量可被用户主动勾选进首页（与宿舍电费 power 不同，power 仍 noHome）
    assert.strictEqual(!!t.noHome, false, '水量可勾选进首页（用户主动勾选；power 仍不参与）');
    assert.ok(tools.homeEligible(t), '水量应是合法的首页勾选项');
    assert.ok(fs.existsSync(path.join(ROOT, 'images/tool-water.png')), '缺少 images/tool-water.png');
    assert.ok(fs.statSync(path.join(ROOT, 'images/tool-water.png')).size <= 2048, '图标应 ≤2KB');
    let media = 0;
    (function walk(d) {
      fs.readdirSync(d).forEach(function (x) {
        const p = path.join(d, x);
        if (fs.statSync(p).isDirectory()) walk(p); else media += fs.statSync(p).size;
      });
    })(path.join(ROOT, 'images'));
    assert.ok(media <= 200 * 1024, '媒体预算硬线 200KB，实际 ' + media + 'B');
  });

  await test('页面：模块注册 + 关键事件 + 分享 handler（2026-11-11 起接云端共享，见 _water_shared_contract §2）', function () {
    purge();
    const def = loadPage('pages/water/water.js');
    ['openSheet', 'closeSheet', 'pickBuilding', 'pickRoom', 'pickPersons', 'onMonthChange', 'onReadingInput',
      'saveRecord', 'delRecord', 'goPower', 'onCloudSync', 'onShareAppMessage', 'onShareTimeline', '_render'].forEach(function (k) {
      assert.strictEqual(typeof def[k], 'function', 'water 页缺少 ' + k);
    });
    assert.ok(def.data && def.data.persons === 4 && def.data.personsOptions.map(function (o) { return o.p; }).join(',') === '4,6', '默认 4 人间、可选 4/6');
    assert.ok(def.data.personsOptions[0].label === '4 人间' && def.data.personsOptions[1].label === '6 人间', '人数文案不再出现每月免费 N 吨水（契约 §5）：' + JSON.stringify(def.data.personsOptions));
    const js = src('pages/water/water.js');
    ['onShareAppMessage', 'onShareTimeline', 'share.enable()', 'utils/share.js'].forEach(function (k) {
      assert.ok(js.indexOf(k) >= 0, 'water 页缺少 ' + k);
    });
    // 2026-11-11 需求 6：水量改为云端共享（唯一通道是 utils/cloud.js 既有 CloudBase PostgREST），
    // 页面不得直接 wx.request / 不得出现新的外部请求来源。
    assert.ok(!/wx\.request/.test(js), '水量页不应直接发原生网络请求（统一走 utils/cloud.js）');
    assert.ok(!/https?:\/\//.test(js), '水量页不出现外部 URL');
    ['cloud.waterList', 'cloud.waterUpsert', 'cloud.waterDelete', 'cloud.waterRoomGet', 'cloud.waterRoomUpsert'].forEach(function (k) {
      assert.ok(js.indexOf(k) >= 0, '水量页缺少云端共享调用 ' + k);
    });
    assert.ok(/waterPend/.test(js) && /_flushPending/.test(js), '水量页应有离线待补发队列（契约 §3.2）');
    assert.ok(/isFixed4|personsLocked/.test(js), '水量页应处理 23A/23B 固定 4 人间（契约 §4）');
    assert.ok(/is_admin|admin/.test(js) === false, '水量页不涉及管理员逻辑');
    const wxml = src('pages/water/water.wxml');
    ['wt-pick', 'wt-persons', 'wt-field', 'wt-preview', 'wt-hrow', 'wt-del', 'wt-rule', 'wt-save',
      'onMonthChange', 'onReadingInput', 'saveRecord', 'delRecord', 'pickPersons', 'pickRoom'].forEach(function (k) {
      assert.ok(wxml.indexOf(k) >= 0, 'water.wxml 缺少 ' + k);
    });
    // 水费规则卡（2026-11-06 用户反馈）：只留水费规则；电费单价/5 度电定额已移入电量统计
    const ruleText = wxml + js + src('utils/water.js');
    ['3.03', '超出定额部分', '水费 ÷ 0.58', '无阶梯、无额外加价',
      '以学校最新通知为准', '2025-09-05', '2021'].forEach(function (k) {
      assert.ok(ruleText.indexOf(k) >= 0, '水费规则卡缺少「' + k + '」');
    });
    const rv4 = R('utils/water.js').ruleView(4);
    assert.strictEqual(rv4.freeText, '每人 2 吨水/月（4 人间 = 8 吨）', '水费规则卡只提水定额');
    assert.deepStrictEqual(rv4.personsOptions.map(function (o) { return o.label; }),
      ['4 人间', '6 人间'], '人数文案只留 4 人间/6 人间（契约 §5：去掉每月免费 N 吨水）');
    assert.ok(!/免费/.test(rv4.freeText + rv4.formula + rv4.personsOptions.map(function (o) { return o.label; }).join('')),
      '水费规则/人数文案不得再出现「免费」字样（契约 §5）');
    assert.strictEqual(rv4.elecPrice, undefined, '水量页规则不再含电费单价字段');
    assert.ok(wxml.indexOf('电费') < 0 || wxml.indexOf('水费规则') >= 0, '水量页仍有水费规则卡');
    const pageText = wxml + js;
    assert.ok(!/0\.58\s*元\/度/.test(pageText) && !/5\s*度电/.test(pageText) && !/2 吨水 \+ 5 度电/.test(pageText), '水量页不得再出现电费单价 / 5 度电定额行');
    assert.ok(!/阶梯|7\.20|0\.4983|市政/.test(wxml), '页面不得出现市政阶梯价');
  });

  await test('页面：历史倒序/对比渲染、人数切换写回、保存与删除后重算（本机数据）', async function () {
    purge();
    global.wx.removeStorageSync('zq_tools_v2');
    const store = R('utils/store.js');
    const def = loadPage('pages/water/water.js');
    setIdentity();
    // 电费页已关注 13 号楼 324（power.sel 是两侧共用的真源；13/16 号楼 4/6 人间可选）
    store.get().power = { sel: '1-13---324', at: Date.now(), low: 30 };
    store.get().water = { rooms: { '1-13---324': { p: 4, recs: RECS.slice() } } };
    store.save();
    const ctx = pageCtx(def);
    ctx.onLoad();
    ctx._render();
    assert.strictEqual(ctx.data.state, 'ready');
    assert.strictEqual(ctx.data.hasSel, true);
    assert.strictEqual(ctx.data.selLabel, '13号楼324');
    assert.strictEqual(ctx.data.personsLocked, false, '13 号楼人数可改');
    assert.deepStrictEqual(ctx.data.history.map((x) => x.m), ['2026-11', '2026-10', '2026-09']);
    assert.strictEqual(ctx.data.history[0].usageText, '9.00');
    assert.strictEqual(ctx.data.history[0].feeText, '3.03');
    assert.strictEqual(ctx.data.history[0].degText, '5.2');
    assert.strictEqual(ctx.data.cmp.usageText, '9.00');
    assert.strictEqual(ctx.data.histCount, 3);
    // 人数 4 → 6：写回 water.rooms[rv].p，历史水费按 6 人定额重算（9 吨 < 12 → 0）
    ctx.pickPersons({ currentTarget: { dataset: { p: 6 } } });
    assert.strictEqual(store.get().water.rooms['1-13---324'].p, 6, '人数应写回 water section');
    assert.strictEqual(ctx.data.persons, 6);
    assert.strictEqual(ctx.data.history[0].feeText, '0.00', '6 人间 9 吨未超定额');
    assert.strictEqual(ctx.data.rules.quotaWater, 12);
    ctx.pickPersons({ currentTarget: { dataset: { p: 4 } } });
    assert.strictEqual(ctx.data.history[0].feeText, '3.03');
    // 保存 2026-12 读数 130.4（上月 2026-11 = 115）→ 用量 15.4，水费 22.42，折合 38.7
    ctx.onMonthChange({ detail: { value: '2026-12' } });
    assert.strictEqual(ctx.data.month, '2026-12');
    ctx.onReadingInput({ detail: { value: '130.4' } });
    assert.ok(ctx.data.preview && ctx.data.preview.valid, '输入应即时预览');
    assert.strictEqual(ctx.data.preview.usageText, '15.40');
    assert.strictEqual(ctx.data.preview.feeText, '22.42');
    ctx.saveRecord();
    const recs = store.get().water.rooms['1-13---324'].recs;
    assert.deepStrictEqual(recs.map((x) => x.m), ['2026-09', '2026-10', '2026-11', '2026-12'], '保存后按月升序');
    assert.strictEqual(ctx.data.reading, '', '保存后清空读数');
    assert.strictEqual(ctx.data.history[0].m, '2026-12');
    assert.strictEqual(ctx.data.history[0].usageText, '15.40');
    assert.strictEqual(ctx.data.history[0].feeText, '22.42');
    // 读数回退 → 拒绝，不落盘
    ctx.onMonthChange({ detail: { value: '2027-01' } });
    ctx.onReadingInput({ detail: { value: '90' } });
    ctx.saveRecord();
    assert.strictEqual(store.get().water.rooms['1-13---324'].recs.length, 4, '读数回退不应落盘');
    // 删除 2026-11 → 2026-12 用量改按 2026-10 重算 = 130.4 − 106 = 24.4
    ctx.delRecord({ currentTarget: { dataset: { m: '2026-11' } } });
    await new Promise((r) => setTimeout(r, 0));
    const after = store.get().water.rooms['1-13---324'].recs;
    assert.deepStrictEqual(after.map((x) => x.m), ['2026-09', '2026-10', '2026-12']);
    assert.strictEqual(ctx.data.history[0].m, '2026-12');
    assert.strictEqual(ctx.data.history[0].usageText, '24.40', '删除后自动重算用量');
    // 切换关注宿舍（与电费共用）→ 未拥有房间显示空态
    ctx.pickRoom({ currentTarget: { dataset: { rv: '1-16---305' } } });
    assert.strictEqual(store.get().power.sel, '1-16---305', '切换关注宿舍应写 power section（电费页同值）');
    assert.strictEqual(ctx.data.history.length, 0);
    assert.strictEqual(ctx.data.cmp.empty, true);
    ctx.pickPersons({ currentTarget: { dataset: { p: 6 } } });
    assert.strictEqual(store.get().water.rooms['1-16---305'].p, 6);
  });

  await test('页面：未选择关注宿舍 → 只引导不渲染表单（0 请求 / 0 数据）', function () {
    purge();
    global.wx.removeStorageSync('zq_tools_v2');
    global.wx.removeStorageSync('zq_power_sel_3260799999');
    const store = R('utils/store.js');
    store.reload();
    const def = loadPage('pages/water/water.js');
    const ctx = pageCtx(def);
    ctx.onLoad();
    ctx._render();
    assert.strictEqual(ctx.data.state, 'idle');
    assert.strictEqual(ctx.data.hasSel, false);
    assert.deepStrictEqual(ctx.data.history, []);
    assert.strictEqual(ctx.data.cmp.empty, true);
  });

  /* ============================ F. power 计费规则条（2026-11-06 用户反馈：电费规则进电量统计） ============================ */
  await test('power 计费规则条：billOf 文案 / 区间电费=区间用电×0.58 / 免费额度按人数 / 扣减摘要', function () {
    purge();
    const pw = R('utils/power.js');
    const b4 = pw.billOf({ drop: 10, deductN: 0 }, 4);
    assert.strictEqual(b4.elecText, '0.58 元/度');
    assert.strictEqual(b4.feeText, '≈ ¥5.80', '10 度 × 0.58 = 5.80');
    assert.strictEqual(b4.freeText, '5 度电/人/月（4 人间 = 20 度）');
    assert.ok(b4.waterText.indexOf('3.03 元/吨从电费账户扣') >= 0 && b4.waterText.indexOf('1 吨≈5.2 度') >= 0, b4.waterText);
    assert.strictEqual(b4.hasDed, false);
    const b6 = pw.billOf({ drop: 12.5, deductN: 2, deductDeg: 6.5, deductYuan: 3.77, deductWaterN: 2 }, 6);
    assert.strictEqual(b6.feeText, '≈ ¥7.25', '12.5 度 × 0.58 = 7.25');
    assert.strictEqual(b6.freeText, '5 度电/人/月（6 人间 = 30 度）');
    assert.strictEqual(b6.hasDed, true);
    assert.ok(b6.dedText.indexOf('已忽略 2 次水费扣除') >= 0 && b6.dedText.indexOf('6.5 度') >= 0 && b6.dedText.indexOf('3.77 元') >= 0, b6.dedText);
    const bDef = pw.billOf(null, 9);
    assert.strictEqual(bDef.persons, 4, '非法人数 → 默认 4');
    assert.strictEqual(bDef.feeText, '—', '无区间用电 → —');
  });

  await test('power 异常扣减（与网站同口径）：扣减段不计入区间用电/rate，摘要标异常扣减', function () {
    purge();
    const pw = R('utils/power.js');
    const t0 = Date.parse('2026-11-01T00:00:00+08:00');
    const pts = [];
    for (let i = 0; i < 11; i++) pts.push({ q: 100 - i, t: t0 + i * 3600e3 });
    pts.push({ q: 61, t: t0 + 11 * 3600e3 });   // 最后一次 30 度异常扣减（> max(5, 4×1)）
    const dr = pw.deriveRange(pts, { q: 61 });
    assert.strictEqual(dr.deductN, 1, '异常扣减 1 次');
    assert.strictEqual(dr.deductDeg, 29);
    assert.strictEqual(dr.deductYuan, 16.82);
    assert.strictEqual(dr.drop, 10, '扣减段不计入区间用电（10 段 × 1 度）');
    assert.strictEqual(dr.deductWaterN, 0, '无水量匹配 → 异常扣减');
    const rr = pw.rateFrom(pts);
    assert.strictEqual(rr.deductN, 1, 'rateFrom 同样跳过异常扣减');
    const bill = pw.billOf(dr, 4);
    assert.ok(bill.hasDed && bill.dedText.indexOf('异常扣减') >= 0, bill.dedText);
    // 页面/样式契约：bill 条在 tiles 网格内满宽、字段齐全、手机不横向溢出
    const wxml = src('pages/power/power.wxml');
    const wxss = src('pages/power/power.wxss');
    const pjs = src('pages/power/power.js');
    ['class="pw-bill"', 'bill.elecText', 'bill.feeText', 'bill.freeText', 'bill.waterText', 'bill.dedText'].forEach(function (k) {
      assert.ok(wxml.indexOf(k) >= 0, 'power.wxml 缺少『' + k + '』');
    });
    assert.ok(/\.pw-bill \{[^}]*grid-column: 1 \/ -1;/.test(wxss), '计费规则条应在 tiles 网格内满宽');
    assert.ok(/\.pw-bill-ded \{/.test(wxss) && /flex-wrap: wrap/.test(wxss), '规则条换行、不横向溢出');
    assert.ok(/power\.billOf\(dRange/.test(pjs) && /waterUtil\.roomOf\(store\.get\(\)\.water/.test(pjs), '页面按关注宿舍在水量记录里的 p 计算免费额度');
  });
}

module.exports = { run: run };

if (require.main === module) {
  const results = [];
  let passN = 0, failN = 0;
  const test = async function (name, fn) {
    try { await fn(); passN += 1; results.push({ name: name, ok: true }); console.log('PASS  ' + name); }
    catch (e) { failN += 1; results.push({ name: name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
  };
  // 独立运行需要一份极简 wx mock（unit.js 里注入的是完整 mock）
  if (!global.wx) {
    const mem = Object.create(null);
    global.wx = {
      getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
      setStorageSync(k, v) { mem[k] = v; },
      removeStorageSync(k) { delete mem[k]; },
      showToast() {}, showModal(o) { if (o && o.success) o.success({ confirm: true }); },
      navigateTo() {}, showShareMenu() {}
    };
  }
  run(test).then(function () {
    console.log('\n================ water: ' + passN + ' passed, ' + failN + ' failed ================');
    process.exitCode = failN ? 2 : 0;
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}
