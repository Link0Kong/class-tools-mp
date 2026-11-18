/* ai_unit_roll.js —— roll SKILL 原子接口单元测试（Node + _ai_harness.js，不发真实网络）
 *
 * 口径对齐：pages/roll/roll.js（rollSt 存 'in'/'ab'，页面再映射「已到/请假」）、utils/roster.js（writeRoll 按姓名保留状态）。
 * 夹具时间固定为 2026-11-05 14:00，roll 各接口与时间无关，但仍注入 __now 保持一致。
 */
'use strict';
const H = require('./_ai_harness.js');

const NOW = new Date(2026, 10, 5, 14, 0, 0).getTime();

function env(over, wxOpts) {
  const fx = H.mkFixture(Object.assign({ now: NOW }, over || {}));
  const wx = H.createWx(Object.assign({ storage: fx.storage }, wxOpts || {}));
  const L = H.loadSkill(wx, 'ai/skills/roll');
  return { fx: fx, wx: wx, L: L, apis: L.apis };
}
function call(e, name, args) {
  return H.call(e.wx, e.apis, name, Object.assign({ __now: NOW }, args || {}));
}
function storeOf(wx) {
  const raw = wx.__storage.zq_tools_v2;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}
function patchStore(wx, fn) {
  const s = storeOf(wx);
  fn(s);
  wx.__storage.zq_tools_v2 = JSON.stringify(s);
}
function emptyRoster(wx) {
  patchStore(wx, function (s) { s.rollSel = []; s.rollNames = ''; s.rollSt = {}; });
}
function emptyDraw(wx) {
  patchStore(wx, function (s) { s.rosterSel = []; s.roster = ''; });
}

(async function main() {

  /* ============================================================ getRollRoster */
  await H.test('getRollRoster：成功（8 人，来源 draw，状态统计）', async () => {
    const e = env();
    const r = await call(e, 'getRollRoster');
    H.isOk(r);
    const sc = r.structuredContent;
    H.eq(sc.count, 8);
    H.eq(sc.seats.length, 8);
    H.eq(sc.seats[0].seat, 1);
    H.eq(sc.seats[0].name, '李学盈');
    H.eq(sc.source, 'draw', 'rollSel 与抽签参与名单一致');
    H.eq(sc.counts.total, 8);
    H.eq(sc.counts.present, 2);
    H.eq(sc.counts.absent, 1);
    H.eq(sc.counts.unmarked, 5);
    H.eq(sc.pagePath, '/pages/roll/roll');
    H.eq(H.handoffOf(r).payload.seats.length, 8);
    H.includes(r.content[0].text, '8 人');
  });

  await H.test('getRollRoster：空名单（结果为空 + 引导设置）', async () => {
    const e = env();
    emptyRoster(e.wx);
    const r = await call(e, 'getRollRoster');
    H.isOk(r);
    H.eq(r.structuredContent.count, 0);
    H.eq(r.structuredContent.source, '');
    H.eq(r.structuredContent.seats.length, 0);
    H.includes(r.content[0].text, '还没有点名名单');
  });

  await H.test('getRollRoster：旧数据只有 rollNames 时按姓名反查座号', async () => {
    const e = env();
    patchStore(e.wx, function (s) { s.rollSel = []; });   // 保留 rollNames
    const r = await call(e, 'getRollRoster');
    H.isOk(r);
    H.eq(r.structuredContent.count, 8);
    H.eq(r.structuredContent.seats[0].name, '李学盈');
  });

  await H.test('getRollRoster：未认证 → identity-required', async () => {
    const e = env({ identity: false });
    H.isErr(await call(e, 'getRollRoster'), 'identity-required');
  });

  /* ============================================================ setRollRoster */
  await H.test('setRollRoster：指定座号（写 rollSel/rollNames，按姓名保留状态）', async () => {
    const e = env();
    const r = await call(e, 'setRollRoster', { seats: [24, 1, 2] });
    H.isOk(r);
    const sc = r.structuredContent;
    H.eq(sc.ok, true);
    H.eq(sc.count, 3);
    H.eq(sc.seats.map(function (x) { return x.seat; }).join(','), '1,2,24', '座号升序');
    H.eq(sc.preserved, 2, '李学盈(到)+王梓萱(假) 按姓名保留');
    H.eq(sc.counts.present, 1);
    H.eq(sc.counts.absent, 1);
    H.eq(sc.counts.unmarked, 1);
    const st = storeOf(e.wx);
    H.eq(st.rollSel.join(','), '1,2,24');
    H.eq(st.rollNames, '1 李学盈\n2 王梓萱\n24 测试账号');
    H.eq(st.rollSt['0'], 'in', '写入口径与 pages/roll 一致：in');
    H.eq(st.rollSt['1'], 'ab');
    H.includes(r.content[0].text, '同步');
  });

  await H.test('setRollRoster：source=draw 沿用抽签名单', async () => {
    const e = env();
    patchStore(e.wx, function (s) { s.rollSel = [1]; s.rollNames = '1 李学盈'; s.rollSt = {}; });
    const r = await call(e, 'setRollRoster', { source: 'draw' });
    H.isOk(r);
    H.eq(r.structuredContent.count, 8);
    H.eq(r.structuredContent.source, 'draw');
    H.eq(storeOf(e.wx).rollSel.length, 8);
  });

  await H.test('setRollRoster：source=class 使用全班名单', async () => {
    const e = env();
    patchStore(e.wx, function (s) { s.rollSel = [1]; s.rollNames = '1 李学盈'; s.rollSt = {}; });
    const r = await call(e, 'setRollRoster', { source: 'class' });
    H.isOk(r);
    H.eq(r.structuredContent.count, e.fx.MEMBERS.length);
    H.eq(r.structuredContent.source, 'class');
  });

  await H.test('setRollRoster：source=current 不变更名单', async () => {
    const e = env();
    const before = storeOf(e.wx);
    const r = await call(e, 'setRollRoster', { source: 'current' });
    H.isOk(r);
    H.eq(r.structuredContent.count, 8);
    H.eq(storeOf(e.wx).rollSel.join(','), before.rollSel.join(','));
    H.includes(r.content[0].text, '没有变化');
  });

  await H.test('setRollRoster：未知座号被忽略、全部未知 → invalid-input', async () => {
    const e = env();
    const r = await call(e, 'setRollRoster', { seats: [1, 999] });
    H.isOk(r);
    H.eq(r.structuredContent.count, 1);
    H.eq(r.structuredContent.ignored, 1);
    const bad = await call(e, 'setRollRoster', { seats: [999, 1000] });
    H.isErr(bad, 'invalid-input');
    H.includes(bad.content[0].text, '座号');
  });

  await H.test('setRollRoster：seats 空数组清空名单', async () => {
    const e = env();
    const r = await call(e, 'setRollRoster', { seats: [] });
    H.isOk(r);
    H.eq(r.structuredContent.count, 0);
    H.eq(storeOf(e.wx).rollSel.length, 0);
    H.eq(storeOf(e.wx).rollNames, '');
  });

  await H.test('setRollRoster：抽签名单为空时 source=draw 报错引导', async () => {
    const e = env();
    emptyDraw(e.wx);
    const r = await call(e, 'setRollRoster', { source: 'draw' });
    H.isErr(r, 'empty-draw');
    H.includes(r.content[0].text, '抽签页');
  });

  await H.test('setRollRoster：参数错误（seats 非数组 / source 非法 / 都没传）', async () => {
    const e = env();
    H.isErr(await call(e, 'setRollRoster', { seats: '1,2' }), 'invalid-input');
    H.isErr(await call(e, 'setRollRoster', { source: 'foo' }), 'invalid-input');
    H.isErr(await call(e, 'setRollRoster', {}), 'invalid-input');
  });

  await H.test('setRollRoster：未认证 → identity-required', async () => {
    const e = env({ identity: false });
    H.isErr(await call(e, 'setRollRoster', { seats: [1] }), 'identity-required');
  });

  /* ============================================================ markRollStatus */
  await H.test('markRollStatus：标记 24 号到（写 in，统计+1）', async () => {
    const e = env();
    const r = await call(e, 'markRollStatus', { seat: 24, status: 'present' });
    H.isOk(r);
    const sc = r.structuredContent;
    H.eq(sc.ok, true);
    H.eq(sc.seat, 24);
    H.eq(sc.name, '测试账号');
    H.eq(sc.status, 'present');
    H.eq(sc.statusText, '已到');
    H.eq(sc.counts.present, 3);
    H.eq(sc.counts.absent, 1);
    H.eq(sc.counts.unmarked, 4);
    const st = storeOf(e.wx);
    H.eq(st.rollSt['4'], 'in', '第 5 位（24 号）下标 4');
    H.includes(r.content[0].text, '24 号');
  });

  await H.test('markRollStatus：标记 45 号假（写 ab）', async () => {
    const e = env();
    const r = await call(e, 'markRollStatus', { seat: 45, status: 'absent' });
    H.isOk(r);
    H.eq(r.structuredContent.statusText, '请假');
    H.eq(r.structuredContent.counts.absent, 2);
    H.eq(storeOf(e.wx).rollSt['7'], 'ab');
  });

  await H.test('markRollStatus：座号不在名单 → invalid-input（给出合法座号）', async () => {
    const e = env();
    const r = await call(e, 'markRollStatus', { seat: 3, status: 'present' });
    H.isErr(r, 'invalid-input');
    H.includes(r.content[0].text, '座号 3');
    H.includes(r.content[0].text, '1');
  });

  await H.test('markRollStatus：参数错误（seat/status）', async () => {
    const e = env();
    H.isErr(await call(e, 'markRollStatus', { seat: 0, status: 'present' }), 'invalid-input');
    H.isErr(await call(e, 'markRollStatus', { seat: 1, status: 'late' }), 'invalid-input');
    H.isErr(await call(e, 'markRollStatus', { seat: 1 }), 'invalid-input');
  });

  await H.test('markRollStatus：空名单 → invalid-input 引导先设名单', async () => {
    const e = env();
    emptyRoster(e.wx);
    const r = await call(e, 'markRollStatus', { seat: 1, status: 'present' });
    H.isErr(r, 'invalid-input');
    H.includes(r.content[0].text, 'setRollRoster');
  });

  await H.test('markRollStatus：旧数据（仅 rollNames）也可标记并归一化 rollSel', async () => {
    const e = env();
    patchStore(e.wx, function (s) { s.rollSel = []; s.rollSt = {}; });
    const r = await call(e, 'markRollStatus', { seat: 2, status: 'present' });
    H.isOk(r);
    H.eq(storeOf(e.wx).rollSel.length, 8, '归一化写回 rollSel');
    H.eq(r.structuredContent.counts.present, 1);
  });

  await H.test('markRollStatus：未认证 → identity-required', async () => {
    const e = env({ identity: false });
    H.isErr(await call(e, 'markRollStatus', { seat: 1, status: 'present' }), 'identity-required');
  });

  /* ============================================================ markAllRoll */
  await H.test('markAllRoll：未 confirmed → need-confirm 且不写本机', async () => {
    const e = env();
    const before = JSON.stringify(storeOf(e.wx).rollSt);
    const r = await call(e, 'markAllRoll', { status: 'present' });
    H.isErr(r, 'need-confirm');
    H.includes(r.content[0].text, '全部 8 人');
    H.eq(JSON.stringify(storeOf(e.wx).rollSt), before, '未确认不得写本机');
  });

  await H.test('markAllRoll：confirmed → 全部到（写 in）', async () => {
    const e = env();
    const r = await call(e, 'markAllRoll', { status: 'present', confirmed: true });
    H.isOk(r);
    H.eq(r.structuredContent.counts.present, 8);
    H.eq(r.structuredContent.counts.absent, 0);
    H.eq(r.structuredContent.counts.unmarked, 0);
    const st = storeOf(e.wx).rollSt;
    H.eq(Object.keys(st).length, 8);
    Object.keys(st).forEach(function (k) { H.eq(st[k], 'in'); });
  });

  await H.test('markAllRoll：confirmed → 全部假（写 ab）', async () => {
    const e = env();
    const r = await call(e, 'markAllRoll', { status: 'absent', confirmed: true });
    H.isOk(r);
    H.eq(r.structuredContent.counts.absent, 8);
    const st = storeOf(e.wx).rollSt;
    Object.keys(st).forEach(function (k) { H.eq(st[k], 'ab'); });
  });

  await H.test('markAllRoll：空名单 → invalid-input', async () => {
    const e = env();
    emptyRoster(e.wx);
    H.isErr(await call(e, 'markAllRoll', { status: 'present', confirmed: true }), 'invalid-input');
  });

  await H.test('markAllRoll：status 非法 → invalid-input', async () => {
    const e = env();
    H.isErr(await call(e, 'markAllRoll', { status: 'ok', confirmed: true }), 'invalid-input');
  });

  await H.test('markAllRoll：未认证 → identity-required', async () => {
    const e = env({ identity: false });
    H.isErr(await call(e, 'markAllRoll', { status: 'present', confirmed: true }), 'identity-required');
  });

  /* ============================================================ resetRoll */
  await H.test('resetRoll：未 confirmed → need-confirm 且保留记录', async () => {
    const e = env();
    const before = JSON.stringify(storeOf(e.wx).rollSt);
    const r = await call(e, 'resetRoll');
    H.isErr(r, 'need-confirm');
    H.eq(JSON.stringify(storeOf(e.wx).rollSt), before, '未确认不得清空');
  });

  await H.test('resetRoll：confirmed → 清空到/假记录，名单保留', async () => {
    const e = env();
    const r = await call(e, 'resetRoll', { confirmed: true });
    H.isOk(r);
    H.eq(r.structuredContent.ok, true);
    H.eq(r.structuredContent.cleared, 3, '原 fixture 有 3 条记录');
    H.eq(r.structuredContent.count, 8);
    H.eq(r.structuredContent.counts.unmarked, 8);
    const st = storeOf(e.wx);
    H.eq(Object.keys(st.rollSt).length, 0);
    H.eq(st.rollSel.length, 8, '名单保留');
  });

  await H.test('resetRoll：空名单 confirmed 也能正常返回', async () => {
    const e = env();
    emptyRoster(e.wx);
    const r = await call(e, 'resetRoll', { confirmed: true });
    H.isOk(r);
    H.eq(r.structuredContent.cleared, 0);
    H.eq(r.structuredContent.counts.total, 0);
  });

  await H.test('resetRoll：未认证 → identity-required', async () => {
    const e = env({ identity: false });
    H.isErr(await call(e, 'resetRoll', { confirmed: true }), 'identity-required');
  });

  /* ============================================================ getRollSummary */
  await H.test('getRollSummary：统计与逐人状态（按座号升序）', async () => {
    const e = env();
    const r = await call(e, 'getRollSummary');
    H.isOk(r);
    const sc = r.structuredContent;
    H.eq(sc.total, 8);
    H.eq(sc.present, 2);
    H.eq(sc.absent, 1);
    H.eq(sc.unmarked, 5);
    H.eq(sc.items.length, 8);
    H.eq(sc.items[0].seat, 1);
    H.eq(sc.items[0].status, 'present');
    H.eq(sc.items[0].statusText, '已到');
    H.eq(sc.items[1].status, 'absent');
    H.eq(sc.items[1].statusText, '请假');
    H.eq(sc.items[7].status, 'unmarked');
    H.eq(sc.items[7].statusText, '未点');
    H.includes(r.content[0].text, '未点');
    H.eq(H.handoffOf(r).payload.summary, true);
  });

  await H.test('getRollSummary：全部标记后未点为 0', async () => {
    const e = env();
    await call(e, 'markAllRoll', { status: 'present', confirmed: true });
    const r = await call(e, 'getRollSummary');
    H.isOk(r);
    H.eq(r.structuredContent.unmarked, 0);
    H.eq(r.structuredContent.present, 8);
    H.includes(r.content[0].text, '所有人都已标记');
  });

  await H.test('getRollSummary：空名单 → 空结果', async () => {
    const e = env();
    emptyRoster(e.wx);
    const r = await call(e, 'getRollSummary');
    H.isOk(r);
    H.eq(r.structuredContent.total, 0);
    H.deepEq(r.structuredContent.items, []);
    H.includes(r.content[0].text, '还没有点名名单');
  });

  await H.test('getRollSummary：未认证 → identity-required', async () => {
    const e = env({ identity: false });
    H.isErr(await call(e, 'getRollSummary'), 'identity-required');
  });

  /* ============================================================ useDrawRoster */
  await H.test('useDrawRoster：沿用到点名（保留同姓名状态）', async () => {
    const e = env();
    patchStore(e.wx, function (s) { s.rollSel = [1]; s.rollNames = '1 李学盈'; s.rollSt = {}; });
    const r = await call(e, 'useDrawRoster');
    H.isOk(r);
    const sc = r.structuredContent;
    H.eq(sc.ok, true);
    H.eq(sc.count, 8);
    H.eq(sc.source, 'draw');
    H.eq(storeOf(e.wx).rollSel.length, 8);
    H.eq(H.handoffOf(r).payload.seats.length, 8);
    H.includes(r.content[0].text, '抽签');
  });

  await H.test('useDrawRoster：抽签参与名单为空 → isError 引导先去抽签', async () => {
    const e = env();
    emptyDraw(e.wx);
    const r = await call(e, 'useDrawRoster');
    H.isErr(r, 'empty-draw');
    H.includes(r.content[0].text, '抽签页');
  });

  await H.test('useDrawRoster：本机无班级名单 → empty-members', async () => {
    const e = env({ members: [] });
    const r = await call(e, 'useDrawRoster');
    H.isErr(r, 'empty-members');
    H.includes(r.content[0].text, '身份验证');
  });

  await H.test('useDrawRoster：未认证 → identity-required', async () => {
    const e = env({ identity: false });
    H.isErr(await call(e, 'useDrawRoster'), 'identity-required');
  });

  /* ============================================================ 契约 / 静态 */
  await H.test('契约：mcp.json 接口名与 registerAPI 完全一致（7 个）', async () => {
    const e = env();
    const names = e.L.mcp.apis.map(function (a) { return a.name; }).sort();
    H.deepEq(e.L.apiNames.slice().sort(), names);
    H.eq(names.length, 7);
    H.eq(e.L.warnings.length, 0, '加载告警: ' + e.L.warnings.join('|'));
    e.L.mcp.apis.forEach(function (a) {
      H.ok(a.inputSchema && a.inputSchema.type === 'object', a.name + ' inputSchema 必须为 object');
      H.eq(a._meta.ui.pagePath, '/pages/roll/roll', a.name + ' pagePath');
      H.eq(a._meta.ui.componentPath, 'components/roll-card/index');
    });
    H.eq(e.L.mcp.components.length, 1);
    H.eq(e.L.mcp.components[0].relatedPage, '/pages/roll/roll');
  });

  await H.test('契约：破坏性接口在 inputSchema 声明 confirmed', async () => {
    const e = env();
    ['markAllRoll', 'resetRoll'].forEach(function (name) {
      const api = e.L.mcp.apis.filter(function (a) { return a.name === name; })[0];
      H.ok(api, name + ' 应在 mcp.json');
      H.ok(api.inputSchema.properties.confirmed, name + ' 应声明 confirmed');
      H.eq(api.inputSchema.properties.confirmed.type, 'boolean');
    });
  });

  await H.test('契约：成功返回均有 pagePath、content ≤200 字、handoff 结构正确', async () => {
    const e = env();
    const cases = [
      ['getRollRoster', {}],
      ['setRollRoster', { seats: [1, 2] }],
      ['markRollStatus', { seat: 1, status: 'present' }],
      ['markAllRoll', { status: 'present', confirmed: true }],
      ['resetRoll', { confirmed: true }],
      ['getRollSummary', {}],
      ['useDrawRoster', {}]
    ];
    for (let i = 0; i < cases.length; i++) {
      const r = await call(e, cases[i][0], cases[i][1]);
      H.isOk(r);
      H.eq(r.structuredContent.pagePath, '/pages/roll/roll', cases[i][0] + ' pagePath');
      H.ok(r.content[0].text.length <= 200, cases[i][0] + ' content 超 200 字：' + r.content[0].text.length);
      if (r.handoff !== undefined) {
        H.eq(typeof r.handoff, 'function', cases[i][0] + ' handoff');
        const hv = r.handoff();
        H.eq(typeof hv.query, 'string');
        H.eq(typeof hv.payload, 'object');
      }
    }
  });

  await H.test('契约：失败返回不写本机（参数错误时存储不变）', async () => {
    const e = env();
    const before = JSON.stringify(storeOf(e.wx));
    await call(e, 'markRollStatus', { seat: 999, status: 'present' });
    await call(e, 'markAllRoll', { status: 'present' });
    await call(e, 'resetRoll', {});
    H.eq(JSON.stringify(storeOf(e.wx)), before, '失败/待确认调用不得写本机');
  });

  await H.test('契约：SKILL.md ≤ 16000B、mcp.json 去 outputSchema/空白 ≤ 24000B', async () => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.resolve(__dirname, '..', 'ai', 'skills', 'roll');
    const skillSize = fs.statSync(path.join(dir, 'SKILL.md')).size;
    H.ok(skillSize <= 16000, 'SKILL.md 大小 ' + skillSize);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8'));
    raw.apis.forEach(function (a) { delete a.outputSchema; });
    const compact = JSON.stringify(raw).replace(/\s+/g, '');
    H.ok(compact.length <= 24000, 'mcp.json 计数 ' + compact.length);
  });

  const rep = H.report('roll');
  if (rep.fail) process.exitCode = 1;
})().catch(function (e) {
  console.error('SUITE CRASH:', (e && e.stack) || e);
  process.exitCode = 1;
});
