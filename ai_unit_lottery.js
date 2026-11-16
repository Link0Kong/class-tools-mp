/* ai_unit_lottery.js —— 抽签 / 分组 / 结果单（SKILL lottery）原子接口单元测试
 *
 * 运行：cd mp-class-tools-tests && node ai_unit_lottery.js
 * 基座：_ai_harness.js（mock wx / modelContext / storage 夹具）
 *
 * 覆盖：10 个接口（成功 / 空结果 / 参数错误 / 确认门禁 / 未认证）+ 与主包页面逐字节的算法/文案断言：
 *   - runDraw 结果与 cfg 文案（"1 – 4" 的 en dash、dup 是/否、excl 无…）逐字节；
 *   - zq_flow 结构 = {draw:{result,pool,removed,log,cfg}, group:{result,cfg}}（与 utils/flow.js 页面写入一致）；
 *   - refill / removeAt(autoRe) / reset 语义 = pages/draw/draw.js；
 *   - 分组算法 = pages/group/group.js（按组数/每组人数/打乱/轮流分配）；
 *   - 结果单文本 = pages/sum/sum.js build（含 2000 字截断）。
 * 随机数通过 lib/algo.setRng 注入，断言完全确定。
 */
'use strict';

const path = require('path');
const H = require('./_ai_harness.js');

const EMPTY_FLOW = { draw: null, group: null, updatedAt: 0 };
const PAGE_CFG = {
  range: '1 – 4', rangeF: '1-4', count: '2', dup: '否', excl: '无',
  sort: '按抽取顺序', pool: '4', sel: '0', selF: ''
};
const GROUP_CFG = {
  source: '上一步抽签序号', mode: '按组数(2 组)', total: '4', groups: '2', inner: '按原顺序轮流分配'
};
const GROUP_CFG_ROSTER = {
  source: '班级名单（3 人）', mode: '按组数(2 组)', total: '3', groups: '2', inner: '按原顺序轮流分配'
};

function drawSt(over) {
  return Object.assign({ result: [1, 2], pool: [1, 2, 3, 4], removed: [], log: [], cfg: PAGE_CFG }, over || {});
}
function groupSt(over) {
  return Object.assign({
    result: [[{ n: 1, nm: '李学盈' }, { n: 2, nm: '王梓萱' }], [{ n: 3, nm: '赵思远' }, { n: 4, nm: '' }]],
    cfg: GROUP_CFG
  }, over || {});
}

function make(opts) {
  opts = opts || {};
  const fx = H.mkFixture(opts.over);
  const storage = Object.assign({}, fx.storage, opts.storage || {});
  if (opts.noIdentity) delete storage.zq_class_identity;
  const wx = H.createWx({ storage: storage });
  const L = H.loadSkill(wx, 'ai/skills/lottery');
  const algo = require(path.join(L.path, 'lib', 'algo.js'));
  return {
    fx: fx, wx: wx, L: L, algo: algo,
    call: function (name, args, o) { return H.call(wx, L.apis, name, args || {}, o); }
  };
}
function flowOf(wx) {
  const v = wx.getStorageSync('zq_flow');
  if (!v) return null;
  return typeof v === 'string' ? JSON.parse(v) : v;
}
function storeOf(wx) {
  const v = wx.getStorageSync('zq_tools_v2');
  return typeof v === 'string' ? JSON.parse(v) : v;
}
function names(list, key) { return list.map(function (x) { return x[key]; }); }

(async function main() {
  /* ================================================================ 基础 / 未认证 */
  await H.test('接口清单与 mcp.json 逐字一致（10 个）', function () {
    const m = make();
    const mcpNames = m.L.mcp.apis.map(function (a) { return a.name; });
    H.eq(m.L.apiNames.length, 10, '注册接口数');
    H.deepEq(m.L.apiNames.slice().sort(), mcpNames.slice().sort(), 'index.js 注册名 = mcp.apis 名');
    H.notOk(m.L.warnings.length ? m.L.warnings.some(function (w) { return /兜底|没有通过/.test(w); }) : false, '没有注册兜底警告');
  });

  await H.test('未认证：getDrawConfig 返回 identity-required + 身份页 handoff', async function () {
    const m = make({ noIdentity: true });
    const res = await m.call('getDrawConfig', {});
    H.isErr(res, 'identity-required');
    const hv = H.handoffOf(res);
    H.eq(hv.path, '/pages/identity/identity', 'handoff 指向身份页');
    H.includes(res.content[0].text, '身份验证');
  });

  await H.test('未认证：runDraw 返回 identity-required', async function () {
    const m = make({ noIdentity: true });
    const res = await m.call('runDraw', { count: 2 });
    H.isErr(res, 'identity-required');
  });

  /* ================================================================ getDrawConfig */
  await H.test('getDrawConfig：返回本机参数与池大小（夹具 1–50 / 抽 4）', async function () {
    const m = make();
    const res = await m.call('getDrawConfig', {});
    H.isOk(res);
    const sc = res.structuredContent;
    H.deepEq(sc.range, { start: 1, end: 50 });
    H.eq(sc.count, 4);
    H.eq(sc.allowDuplicate, false);
    H.eq(sc.sort, 'draw');
    H.eq(sc.rosterCount, 8);
    H.eq(sc.poolSize, 8, '参与名单 8 人 → 池 8');  // 夹具 rosterSel 全在 1–50 内
    H.eq(sc.hasDrawResult, true);
    H.eq(sc.hasGroupResult, true);
    H.eq(sc.pagePath, '/pages/draw/draw');
    H.eq(H.handoffOf(res).query, 'step=1');
  });

  await H.test('getDrawConfig：无结果 / 未选名单 → 池 = 范围', async function () {
    const m = make({ storage: { zq_flow: EMPTY_FLOW, zq_tools_v2: Object.assign({}, H.mkFixture().STORE, { rosterSel: [], roster: '' }) } });
    const res = await m.call('getDrawConfig', {});
    H.isOk(res);
    H.eq(res.structuredContent.hasDrawResult, false);
    H.eq(res.structuredContent.hasGroupResult, false);
    H.eq(res.structuredContent.rosterCount, 0);
    H.eq(res.structuredContent.poolSize, 50, '1–50 未选名单不筛选');
    H.includes(res.content[0].text, '还没有抽签结果');
  });

  /* ================================================================ runDraw */
  await H.test('runDraw：首次抽签（注入 rng=0）结果确定、cfg 逐字节、zq_flow 与页面结构一致', async function () {
    const m = make({ storage: { zq_flow: EMPTY_FLOW } });
    m.algo.setRng(function () { return 0; });
    const res = await m.call('runDraw', { start: 1, end: 4, count: 2, rosterSeats: [] });
    H.isOk(res);
    const sc = res.structuredContent;
    H.deepEq(sc.items, [{ number: 2, name: '' }, { number: 3, name: '' }], 'rng=0 的洗牌结果');
    H.eq(sc.poolSize, 4);
    H.deepEq(sc.cfg, PAGE_CFG, 'cfg 文案与 pages/draw doDraw 逐字节一致');
    H.deepEq(names(sc.steps, 'done'), [true, false, false], '步骤条');
    H.eq(typeof sc.drawnAt, 'number');
    H.eq(sc.pagePath, '/pages/draw/draw');
    H.eq(H.handoffOf(res).query, 'step=1');

    const fl = flowOf(m.wx);
    H.deepEq(Object.keys(fl.draw), ['result', 'pool', 'removed', 'log', 'cfg'], 'draw 结构 = 页面 flow.patch');
    H.deepEq(fl.draw.result, [2, 3]);
    H.deepEq(fl.draw.pool, [1, 2, 3, 4]);
    H.deepEq(fl.draw.removed, []);
    H.deepEq(fl.draw.log, []);
    H.eq(fl.group, null);
    H.ok(fl.updatedAt > 0);

    const st = storeOf(m.wx);
    // 2026-11-12 抽签升级 v1：draw.names（自定义序号名称映射）由抽签页维护，AI saveDraw 原样保留（初始为空串）
    H.deepEq(st.draw, { start: 1, end: 4, count: 2, dup: false, excl: '', sort: 'draw', autoRe: true, names: '' }, 'store.draw = 页面 saveCfg');
    H.deepEq(st.rosterSel, [], 'rosterSeats:[] 清空本机参与名单');
  });

  await H.test('runDraw：已有结果且未传 confirmed → need-confirm 且不改动结果', async function () {
    const m = make();
    const before = JSON.stringify(flowOf(m.wx));
    const res = await m.call('runDraw', { count: 2 });
    H.isErr(res, 'need-confirm');
    H.includes(res.content[0].text, 'confirmed=true');
    H.eq(JSON.stringify(flowOf(m.wx)), before, '确认门禁不写入');
  });

  await H.test('runDraw：confirmed=true 覆盖旧结果', async function () {
    const m = make();
    m.algo.setRng(function () { return 0; });
    const res = await m.call('runDraw', { start: 1, end: 4, count: 2, rosterSeats: [], confirmed: true });
    H.isOk(res);
    H.deepEq(res.structuredContent.items, [{ number: 2, name: '' }, { number: 3, name: '' }]);
    H.deepEq(flowOf(m.wx).draw.result, [2, 3]);
  });

  await H.test('runDraw：AI 写回 store.draw 时保留用户名称映射（draw.names 不被清空）', async function () {
    // 2026-11-12 抽签升级 v1：draw.names 由抽签页维护、随 userdata v6 同步；AI 只改抽签参数。
    const m = make({ storage: {
      zq_flow: EMPTY_FLOW,
      zq_tools_v2: Object.assign({}, H.mkFixture().STORE, {
        draw: { start: 1, end: 50, count: 3, dup: false, excl: '', sort: 'draw', autoRe: true, names: '1 甲组\n2 乙组' }
      })
    } });
    m.algo.setRng(function () { return 0; });
    const res = await m.call('runDraw', { start: 1, end: 4, count: 2, rosterSeats: [], confirmed: true });
    H.isOk(res);
    H.eq(storeOf(m.wx).draw.names, '1 甲组\n2 乙组', 'AI 保存抽签参数不得清空名称映射');
    H.eq(storeOf(m.wx).draw.count, 2);
  });

  await H.test('runDraw：count 缺失 / 非正 → invalid-input', async function () {
    const m = make({ storage: { zq_flow: EMPTY_FLOW } });
    H.isErr(await m.call('runDraw', { rosterSeats: [] }), 'invalid-input');
    H.isErr(await m.call('runDraw', { count: 0, rosterSeats: [] }), 'invalid-input');
    H.isErr(await m.call('runDraw', { count: -3, rosterSeats: [] }), 'invalid-input');
  });

  await H.test('runDraw：不重复且 count > 池大小 → invalid-input（页面同文案口径）', async function () {
    const m = make({ storage: { zq_flow: EMPTY_FLOW } });
    const res = await m.call('runDraw', { start: 1, end: 2, count: 3, rosterSeats: [] });
    H.isErr(res, 'invalid-input');
    H.includes(res.content[0].text, '可用序号只有 2 个');
  });

  await H.test('runDraw：allowDuplicate=true 允许超池重复（rng=0 → 全取池首）', async function () {
    const m = make({ storage: { zq_flow: EMPTY_FLOW } });
    m.algo.setRng(function () { return 0; });
    const res = await m.call('runDraw', { start: 1, end: 2, count: 3, rosterSeats: [], allowDuplicate: true });
    H.isOk(res);
    H.deepEq(names(res.structuredContent.items, 'number'), [1, 1, 1]);
    H.eq(res.structuredContent.cfg.dup, '是');
  });

  await H.test('runDraw：sort=num / desc 输出顺序（rng=0.5）', async function () {
    const m = make({ storage: { zq_flow: EMPTY_FLOW } });
    m.algo.setRng(function () { return 0.5; });
    const num = await m.call('runDraw', { start: 1, end: 6, count: 3, rosterSeats: [], sort: 'num' });
    H.deepEq(names(num.structuredContent.items, 'number'), [1, 2, 6], 'num 升序（洗牌 [1,6,2] 后排序）');
    H.eq(num.structuredContent.cfg.sort, '按序号升序');
    const desc = await m.call('runDraw', { start: 1, end: 6, count: 3, rosterSeats: [], sort: 'desc', confirmed: true });
    H.deepEq(names(desc.structuredContent.items, 'number'), [6, 2, 1], 'desc 降序');
    H.eq(desc.structuredContent.cfg.sort, '从大到小');
    H.isErr(await m.call('runDraw', { count: 1, sort: 'rand' }), 'invalid-input');
  });

  await H.test('runDraw：排除序号计入池与 cfg（excl）', async function () {
    const m = make({ storage: { zq_flow: EMPTY_FLOW } });
    m.algo.setRng(function () { return 0; });
    const res = await m.call('runDraw', { start: 1, end: 4, count: 2, exclude: '2,4', rosterSeats: [] });
    H.isOk(res);
    H.deepEq(names(res.structuredContent.items, 'number'), [3, 1], '池 [1,3] 洗牌后取 2');
    H.eq(res.structuredContent.poolSize, 2);
    H.eq(res.structuredContent.cfg.excl, '2,4');
    H.eq(res.structuredContent.cfg.range, '1 – 4');
  });

  await H.test('runDraw：范围反序自动交换（页面 Math.min/max 语义）', async function () {
    const m = make({ storage: { zq_flow: EMPTY_FLOW } });
    m.algo.setRng(function () { return 0; });
    const res = await m.call('runDraw', { start: 4, end: 1, count: 2, rosterSeats: [] });
    H.isOk(res);
    H.eq(res.structuredContent.poolSize, 4);
    H.eq(res.structuredContent.cfg.rangeF, '1-4');
  });

  await H.test('runDraw：显式 rosterSeats 写入 store.rosterSel/roster 且结果带姓名', async function () {
    const m = make({ storage: { zq_flow: EMPTY_FLOW } });
    m.algo.setRng(function () { return 0; });
    const res = await m.call('runDraw', { start: 1, end: 4, count: 2, rosterSeats: [2, 1] });
    H.isOk(res);
    H.deepEq(names(res.structuredContent.items, 'number'), [2, 1], '池按座号升序 [1,2] 洗牌（rng=0）');
    H.deepEq(names(res.structuredContent.items, 'name'), ['王梓萱', '李学盈'], '姓名取派生名单文本');
    const st = storeOf(m.wx);
    H.deepEq(st.rosterSel, [1, 2]);
    H.eq(st.roster, '1 李学盈\n2 王梓萱');
    H.eq(JSON.stringify(flowOf(m.wx).draw.pool), '[1,2]');
  });

  await H.test('runDraw：rosterSeats 含未知座号 → invalid-input', async function () {
    const m = make({ storage: { zq_flow: EMPTY_FLOW } });
    const res = await m.call('runDraw', { count: 1, rosterSeats: [1, 99] });
    H.isErr(res, 'invalid-input');
    H.includes(res.content[0].text, '99');
  });

  await H.test('runDraw：rosterSeats="current" 沿用本机已选名单', async function () {
    const m = make({ storage: { zq_flow: EMPTY_FLOW } });
    m.algo.setRng(function () { return 0; });
    const res = await m.call('runDraw', { start: 1, end: 50, count: 2, rosterSeats: 'current' });
    H.isOk(res);
    H.eq(res.structuredContent.poolSize, 8, '夹具 rosterSel 8 人');
    H.eq(res.structuredContent.cfg.sel, '8');
  });

  await H.test('runDraw：范围过大 → invalid-input（保护）', async function () {
    const m = make({ storage: { zq_flow: EMPTY_FLOW } });
    H.isErr(await m.call('runDraw', { start: 1, end: 1000000, count: 1, rosterSeats: [] }), 'invalid-input');
  });

  /* ================================================================ refillDraw */
  await H.test('refillDraw：未确认 → need-confirm', async function () {
    const m = make();
    H.isErr(await m.call('refillDraw', { count: 6 }), 'need-confirm');
  });

  await H.test('refillDraw：补抽到目标个数（rng=0，log 记补抽）', async function () {
    const m = make({ storage: { zq_flow: { draw: drawSt({ result: [1] }), group: null, updatedAt: 1 } } });
    m.algo.setRng(function () { return 0; });
    const res = await m.call('refillDraw', { count: 3, confirmed: true });
    H.isOk(res);
    H.deepEq(names(res.structuredContent.added, 'number'), [2, 3]);
    H.deepEq(names(res.structuredContent.items, 'number'), [1, 2, 3]);
    const d = flowOf(m.wx).draw;
    H.deepEq(d.result, [1, 2, 3]);
    H.eq(d.log.length, 2);
    H.eq(d.log[0].act, '补抽');
    H.eq(typeof d.log[0].t, 'string');
  });

  await H.test('refillDraw：无抽签结果 → invalid-input', async function () {
    const m = make({ storage: { zq_flow: EMPTY_FLOW } });
    H.isErr(await m.call('refillDraw', { count: 3, confirmed: true }), 'invalid-input');
  });

  await H.test('refillDraw：目标不大于当前 → 空补抽但仍成功', async function () {
    const m = make();
    const res = await m.call('refillDraw', { count: 2, confirmed: true });
    H.isOk(res);
    H.deepEq(res.structuredContent.added, []);
    H.includes(res.content[0].text, '没有可补抽');
  });

  await H.test('refillDraw：count 非法 → invalid-input', async function () {
    const m = make();
    H.isErr(await m.call('refillDraw', { count: 0, confirmed: true }), 'invalid-input');
  });

  /* ================================================================ removeDrawResult */
  await H.test('removeDrawResult：未确认 → need-confirm', async function () {
    const m = make();
    H.isErr(await m.call('removeDrawResult', { number: 17 }), 'need-confirm');
  });

  await H.test('removeDrawResult：剔除 + autoRe 自动补抽（pages/draw removeAt 语义）', async function () {
    const m = make({ storage: { zq_flow: { draw: drawSt({ result: [1, 2, 3] }), group: null, updatedAt: 1 } } });
    m.algo.setRng(function () { return 0; });
    const res = await m.call('removeDrawResult', { number: 2, confirmed: true });
    H.isOk(res);
    H.deepEq(names(res.structuredContent.items, 'number'), [1, 3, 4], '剔除 2 后补抽 4');
    H.deepEq(res.structuredContent.removed, [2]);
    H.eq(res.structuredContent.removedNumber, 2);
    H.deepEq(names(res.structuredContent.added, 'number'), [4]);
    const d = flowOf(m.wx).draw;
    H.deepEq(d.removed, [2]);
    H.deepEq(names(d.log, 'act'), ['剔除', '补抽']);
  });

  await H.test('removeDrawResult：序号不存在 → invalid-input', async function () {
    const m = make();
    H.isErr(await m.call('removeDrawResult', { number: 999, confirmed: true }), 'invalid-input');
  });

  await H.test('removeDrawResult：autoRe=false 只剔除不补抽', async function () {
    const m = make({
      storage: {
        zq_flow: { draw: drawSt({ result: [1, 2, 3] }), group: null, updatedAt: 1 },
        zq_tools_v2: Object.assign({}, H.mkFixture().STORE, { draw: { start: 1, end: 50, count: 3, dup: false, excl: '', sort: 'draw', autoRe: false } })
      }
    });
    const res = await m.call('removeDrawResult', { number: 2, confirmed: true });
    H.isOk(res);
    H.deepEq(names(res.structuredContent.items, 'number'), [1, 3]);
    H.deepEq(res.structuredContent.added, []);
  });

  await H.test('removeDrawResult：无结果 → invalid-input', async function () {
    const m = make({ storage: { zq_flow: EMPTY_FLOW } });
    H.isErr(await m.call('removeDrawResult', { number: 1, confirmed: true }), 'invalid-input');
  });

  /* ================================================================ getDrawResult */
  await H.test('getDrawResult：存在结果时姓名取派生名单文本（无对应不编造）', async function () {
    const m = make();
    const res = await m.call('getDrawResult', {});
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.exists, true);
    H.deepEq(names(sc.items, 'number'), [3, 17, 24, 42]);
    H.deepEq(names(sc.items, 'name'), ['', '', '测试账号', ''], '只匹配 roster 里的 24');
    H.deepEq(objectKeys(sc.cfg), ['range', 'rangeF', 'count', 'dup', 'excl', 'sort', 'pool', 'sel', 'selF']);
    H.eq(H.handoffOf(res).query, 'step=1');
  });

  await H.test('getDrawResult：无结果 → exists=false', async function () {
    const m = make({ storage: { zq_flow: EMPTY_FLOW } });
    const res = await m.call('getDrawResult', {});
    H.isOk(res);
    H.eq(res.structuredContent.exists, false);
    H.deepEq(res.structuredContent.items, []);
    H.includes(res.content[0].text, '还没有抽签结果');
  });

  await H.test('getDrawResult：removed 透出 + store.draw.sort=num 时升序展示', async function () {
    const m = make({
      storage: {
        zq_flow: { draw: drawSt({ result: [5, 1, 3], removed: [7] }), group: null, updatedAt: 1 },
        zq_tools_v2: Object.assign({}, H.mkFixture().STORE, { draw: { start: 1, end: 9, count: 3, dup: false, excl: '', sort: 'num', autoRe: true } })
      }
    });
    const res = await m.call('getDrawResult', {});
    H.deepEq(names(res.structuredContent.items, 'number'), [1, 3, 5], 'num 排序');
    H.deepEq(res.structuredContent.removed, [7]);
  });

  /* ================================================================ resetDraw */
  await H.test('resetDraw：未确认 → need-confirm 且不写入', async function () {
    const m = make();
    const before = JSON.stringify(flowOf(m.wx));
    H.isErr(await m.call('resetDraw', {}), 'need-confirm');
    H.eq(JSON.stringify(flowOf(m.wx)), before);
  });

  await H.test('resetDraw：确认后清空 draw+group，保留抽签参数', async function () {
    const m = make();
    const res = await m.call('resetDraw', { confirmed: true });
    H.isOk(res);
    H.deepEq(res.structuredContent.cleared, { draw: true, group: true });
    const fl = flowOf(m.wx);
    H.eq(fl.draw, null);
    H.eq(fl.group, null);
    H.deepEq(names(res.structuredContent.steps, 'done'), [false, false, false]);
    H.eq(storeOf(m.wx).draw.end, 50, 'store.draw 参数不受重置影响（页面 reset 同口径）');
  });

  /* ================================================================ runGroup */
  await H.test('runGroup：source=prev 无抽签结果 → invalid-input', async function () {
    const m = make({ storage: { zq_flow: EMPTY_FLOW } });
    H.isErr(await m.call('runGroup', { mode: 'groups', value: 2 }), 'invalid-input');
  });

  await H.test('runGroup：按组数分组（4 人 2 组，轮流分配，cfg 逐字节）', async function () {
    const m = make({ storage: { zq_flow: { draw: drawSt({ result: [12, 24, 26, 31] }), group: null, updatedAt: 1 } } });
    const res = await m.call('runGroup', { mode: 'groups', value: 2 });
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.groupCount, 2);
    H.eq(sc.total, 4);
    H.deepEq(sc.groups.map(function (g) { return names(g.members, 'number'); }), [[12, 26], [24, 31]]);
    H.deepEq(sc.groups[0].members[1], { number: 26, name: '谢梓萱' }, '姓名取 store.roster');
    H.deepEq(sc.cfg, GROUP_CFG, 'cfg 文案与 pages/group doGroup 逐字节');
    H.eq(H.handoffOf(res).query, 'step=2');
    const fl = flowOf(m.wx);
    H.deepEq(Object.keys(fl.group), ['result', 'cfg']);
    H.deepEq(fl.group.result[0].map(function (x) { return x.n; }), [12, 26]);
    H.deepEq(storeOf(m.wx).group, { source: 'prev', names: '', sel: [], mode: 'groups', n: 2, shuffle: false });
  });

  await H.test('runGroup：已有分组未确认 → need-confirm', async function () {
    const m = make();
    H.isErr(await m.call('runGroup', { mode: 'groups', value: 2 }), 'need-confirm');
  });

  await H.test('runGroup：shuffle=true（rng=0）打乱后分配', async function () {
    const m = make({ storage: { zq_flow: { draw: drawSt({ result: [12, 24, 26, 31] }), group: null, updatedAt: 1 } } });
    m.algo.setRng(function () { return 0; });
    const res = await m.call('runGroup', { mode: 'groups', value: 2, shuffle: true });
    H.isOk(res);
    H.deepEq(res.structuredContent.groups.map(function (g) { return names(g.members, 'number'); }), [[24, 31], [26, 12]]);
    H.eq(res.structuredContent.cfg.inner, '打乱后随机分配');
    H.eq(storeOf(m.wx).group.shuffle, true);
  });

  await H.test('runGroup：按每组人数（4 人 / 3 → 2 组）', async function () {
    const m = make({ storage: { zq_flow: { draw: drawSt({ result: [12, 24, 26, 31] }), group: null, updatedAt: 1 } } });
    const res = await m.call('runGroup', { mode: 'size', value: 3 });
    H.isOk(res);
    H.eq(res.structuredContent.groupCount, 2);
    H.eq(res.structuredContent.cfg.mode, '按每组人数(3 人)');
    H.eq(res.structuredContent.mode, 'size');
    H.eq(storeOf(m.wx).group.mode, 'per');
  });

  await H.test('runGroup：source=roster + rosterSeats 写入 store.group.sel/names', async function () {
    const m = make({ storage: { zq_flow: EMPTY_FLOW } });
    const res = await m.call('runGroup', { mode: 'groups', value: 2, source: 'roster', rosterSeats: [7, 1, 2] });
    H.isOk(res);
    H.deepEq(res.structuredContent.groups.map(function (g) { return names(g.members, 'name'); }), [['李学盈', '赵思远'], ['王梓萱']]);
    H.deepEq(res.structuredContent.cfg, GROUP_CFG_ROSTER);
    const st = storeOf(m.wx);
    H.deepEq(st.group.sel, [1, 2, 7], '座号排序归一');
    H.eq(st.group.names, '李学盈\n王梓萱\n赵思远');
    H.eq(st.group.source, 'pick', '页面 source 口径 pick = 班级名单');
  });

  await H.test('runGroup：source=roster 无名单 / 少于 2 人 → invalid-input', async function () {
    const m = make({ storage: { zq_flow: EMPTY_FLOW } });
    H.isErr(await m.call('runGroup', { mode: 'groups', value: 2, source: 'roster' }), 'invalid-input');
    const m2 = make({ storage: { zq_flow: EMPTY_FLOW } });
    H.isErr(await m2.call('runGroup', { mode: 'groups', value: 2, source: 'roster', rosterSeats: [1] }), 'invalid-input');
  });

  await H.test('runGroup：mode / value / source 非法 → invalid-input', async function () {
    const m = make();
    H.isErr(await m.call('runGroup', { mode: 'xxx', value: 2 }), 'invalid-input');
    H.isErr(await m.call('runGroup', { mode: 'groups', value: 0 }), 'invalid-input');
    H.isErr(await m.call('runGroup', { mode: 'groups', value: 2, source: 'paste' }), 'invalid-input');
  });

  /* ================================================================ getGroupResult */
  await H.test('getGroupResult：存在结果（夹具）解析 source/mode/value', async function () {
    const m = make();
    const res = await m.call('getGroupResult', {});
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.exists, true);
    H.eq(sc.source, 'prev');
    H.eq(sc.mode, 'groups');
    H.eq(sc.value, 2);
    H.eq(sc.shuffle, false);
    H.eq(sc.groups.length, 2);
    H.deepEq(sc.groups[0].members, [{ number: 3, name: '李学盈' }, { number: 17, name: '' }]);
    H.eq(H.handoffOf(res).query, 'step=2');
  });

  await H.test('getGroupResult：无结果 → exists=false', async function () {
    const m = make({ storage: { zq_flow: { draw: drawSt(), group: null, updatedAt: 1 } } });
    const res = await m.call('getGroupResult', {});
    H.eq(res.structuredContent.exists, false);
    H.deepEq(res.structuredContent.groups, []);
    H.includes(res.content[0].text, '还没有分组结果');
  });

  await H.test('getGroupResult：size 模式从 cfg 文案还原 value', async function () {
    const m = make({
      storage: {
        zq_flow: {
          draw: drawSt(),
          group: { result: [[{ n: 1, nm: '' }], [{ n: 2, nm: '' }]], cfg: { source: '班级名单（3 人）', mode: '按每组人数(3 人)', total: '3', groups: '1', inner: '打乱后随机分配' } },
          updatedAt: 1
        }
      }
    });
    const res = await m.call('getGroupResult', {});
    H.eq(res.structuredContent.mode, 'size');
    H.eq(res.structuredContent.value, 3);
    H.eq(res.structuredContent.source, 'roster');
    H.eq(res.structuredContent.shuffle, true);
  });

  /* ================================================================ resetGroup */
  await H.test('resetGroup：未确认 → need-confirm', async function () {
    const m = make();
    H.isErr(await m.call('resetGroup', {}), 'need-confirm');
  });

  await H.test('resetGroup：确认后只清空分组，保留抽签结果', async function () {
    const m = make();
    const res = await m.call('resetGroup', { confirmed: true });
    H.isOk(res);
    const fl = flowOf(m.wx);
    H.eq(fl.group, null);
    H.ok(fl.draw && fl.draw.result.length, '抽签结果保留');
    H.deepEq(names(res.structuredContent.steps, 'done'), [true, false, false]);
  });

  /* ================================================================ getResultSummary */
  await H.test('getResultSummary：结果单文本 = pages/sum build（关键行逐字节）', async function () {
    const m = make();
    const res = await m.call('getResultSummary', {});
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.draw.exists, true);
    H.eq(sc.draw.count, 4);
    H.deepEq(sc.draw.removed, []);
    H.eq(sc.group.exists, true);
    H.eq(sc.group.groupCount, 2);
    const lines = sc.text.split('\n');
    H.eq(lines[0], '抽签 · 范围：1 – 50');
    H.eq(lines[1], '抽签 · 个数：4');
    H.eq(lines[2], '抽签 · 允许重复：否');
    H.eq(lines[3], '抽签 · 排除：无');
    H.eq(lines[4], '抽签 · 排序：按抽取顺序');
    H.eq(lines[5], '抽签 · 名单对应：已启用（8 人）');
    H.notIncludes(sc.text, '抽签结果（4 个）', '页面 sum.js 文本中抽签块不带 label（只有分组块带）');
    H.includes(sc.text, '第 1 组（2 人）');
    H.includes(sc.text, '分组 · 成员来源：上一步抽签序号');
    H.ok(sc.text.length <= 2000, 'text ≤2000 字');
    H.eq(sc.pagePath, '/pages/sum/sum');
    H.eq(H.handoffOf(res).query, 'step=3');
  });

  await H.test('getResultSummary：无抽签无分组 → 空结果说明（isError=false）', async function () {
    const m = make({ storage: { zq_flow: EMPTY_FLOW } });
    const res = await m.call('getResultSummary', {});
    H.isOk(res);
    H.eq(res.structuredContent.draw.exists, false);
    H.eq(res.structuredContent.group.exists, false);
    H.eq(res.structuredContent.text, '');
    H.includes(res.content[0].text, '还没有抽签或分组结果');
  });

  await H.test('getResultSummary：超长结果单截断到 ≤2000 字', async function () {
    const many = [];
    for (let i = 1; i <= 800; i++) many.push(i);
    const m = make({
      storage: {
        zq_flow: {
          draw: drawSt({ result: many, pool: many.slice() }),
          group: null,
          updatedAt: 1
        }
      }
    });
    const res = await m.call('getResultSummary', {});
    H.isOk(res);
    H.ok(res.structuredContent.text.length <= 2000, '截断后 ≤2000 字，实际 ' + res.structuredContent.text.length);
    H.includes(res.structuredContent.text, '…（已截断）');
  });

  /* ================================================================ 其它 */
  await H.test('mcp.json：10 个接口均声明 pagePath + componentPath，pagePath 属 draw/group/sum', function () {
    const m = make();
    const allow = ['/pages/draw/draw', '/pages/group/group', '/pages/sum/sum'];
    m.L.mcp.apis.forEach(function (a) {
      const ui = (a._meta && a._meta.ui) || {};
      H.eq(typeof ui.pagePath, 'string', a.name + ' pagePath');
      H.ok(allow.indexOf(ui.pagePath) >= 0, a.name + ' pagePath 在接力页集合内');
      H.eq(typeof ui.componentPath, 'string', a.name + ' componentPath');
    });
    H.eq(m.L.mcp.components.length, 2);
  });

  const rep = H.report('lottery');
  process.exitCode = rep.fail ? 1 : 0;
})().catch(function (e) {
  console.error('lottery 单测自身异常：', e && (e.stack || e));
  process.exitCode = 2;
});

function objectKeys(o) { return o && typeof o === 'object' ? Object.keys(o) : []; }
