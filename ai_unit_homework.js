/* ai_unit_homework.js —— homework SKILL 原子接口单测（Node + _ai_harness.js）
 *
 * 覆盖 6 个接口，每个接口 ≥3 用例（成功/空结果/参数错误/未认证/写操作请求体/离线兜底）。
 * 复跑： cd mp-class-tools-tests && node ai_unit_homework.js
 */
'use strict';
const H = require('./_ai_harness.js');

const SKILL = 'ai/skills/homework';
const SID = '3260799999';

function homeworkGetRoute(fx) {
  return {
    url: 'homework', method: 'GET',
    handler: function (req) {
      const m = String(req.url).match(/[?&]id=eq\.([^&]+)/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        return (fx.HOMEWORK || []).filter(function (h) { return h.id === id; });
      }
      return (fx.HOMEWORK || []).slice();
    }
  };
}
function routesOf(fx, opts) {
  opts = opts || {};
  return [
    homeworkGetRoute(fx),
    opts.marksPostFail
      ? { url: 'marks', method: 'POST', fail: 'request:fail mock' }
      : { url: 'marks', method: 'POST', handler: function (req) { return { statusCode: 201, data: req.data }; } },
    { url: 'marks', method: 'GET', data: [] },
    opts.postHomeworkFail
      ? { url: 'homework', method: 'POST', fail: 'request:fail mock' }
      : { url: 'homework', method: 'POST', handler: function (req) { return { statusCode: 201, data: req.data }; } }
  ].concat(opts.extra || []);
}

function setup(over, opts) {
  opts = opts || {};
  const fx = H.mkFixture(over);
  const routes = typeof opts.routes === 'function' ? opts.routes(fx) : (opts.routes || routesOf(fx, opts.routeOpts));
  const wx = H.createWx({ storage: fx.storage, routes: routes });
  const loaded = H.loadSkill(wx, SKILL, { fixture: fx });
  return { fx: fx, wx: wx, apis: loaded.apis, loaded: loaded };
}

function storeOf(wx) {
  const raw = wx.getStorageSync('zq_tools_v2');
  try { return typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); } catch (e) { return {}; }
}
function postCalls(wx, needle) {
  return (wx.calls.requests || []).filter(function (r) {
    return r.method === 'POST' && String(r.url).indexOf(needle || 'homework') >= 0;
  });
}

(async function main() {
  /* ============================================================ listHomework */
  await H.test('listHomework：默认 pending 只看未完成（已过截止不算待交）', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'listHomework', {});
    H.eq(res.isError, false, 'isError');
    H.eq(res.structuredContent.total, 3, 'pending 条数（hw_001/hw_002/hw_004）');
    H.deepEq(res.structuredContent.items.map(function (x) { return x.id; }), ['hw_001', 'hw_002', 'hw_004'], '待交按截止排序，无截止的排最后');
    H.eq(res.structuredContent.items[0].status, 'pending', '状态');
    H.match(res.structuredContent.pagePath, /^\/pages\/hw\/hw/, 'pagePath');
    H.eq(H.handoffOf(res).query, 'tab=pending', 'handoff query');
    H.includes(res.content[0].text, '共查到 3 条', 'content 事实');
  });

  await H.test('listHomework：status=all 含已完成+已过截止，已完成排最后', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'listHomework', { status: 'all' });
    H.eq(res.structuredContent.total, 5, '全部 5 条');
    const items = res.structuredContent.items;
    H.eq(items[items.length - 1].id, 'hw_005', '已完成最后');
    H.eq(items[items.length - 1].status, 'done', 'done 状态');
    H.eq(items[3].id, 'hw_003', '已过截止在 done 之前');
    H.eq(items[3].status, 'overdue', 'overdue 状态');
    H.includes(res.structuredContent.pagePath, 'tab=all', 'pagePath tab=all');
  });

  await H.test('listHomework：status=overdue / done 精确筛选', async function () {
    const one = setup();
    const overdue = await H.call(one.wx, one.apis, 'listHomework', { status: 'overdue' });
    H.eq(overdue.structuredContent.total, 1, 'overdue 1 条');
    H.eq(overdue.structuredContent.items[0].id, 'hw_003');
    const two = setup();
    const done = await H.call(two.wx, two.apis, 'listHomework', { status: 'done' });
    H.eq(done.structuredContent.total, 1, 'done 1 条');
    H.eq(done.structuredContent.items[0].id, 'hw_005');
    H.eq(done.structuredContent.items[0].done, true);
    H.includes(done.structuredContent.pagePath, 'tab=done');
  });

  await H.test('listHomework：subject / keyword 过滤', async function () {
    const a = setup();
    const bySubject = await H.call(a.wx, a.apis, 'listHomework', { status: 'all', subject: '数学' });
    H.eq(bySubject.structuredContent.total, 1, '科目模糊匹配高等数学');
    H.eq(bySubject.structuredContent.items[0].id, 'hw_001');
    const b = setup();
    const byKeyword = await H.call(b.wx, b.apis, 'listHomework', { status: 'all', keyword: '实验' });
    H.eq(byKeyword.structuredContent.total, 2, '关键词「实验」命中 hw_003/hw_005');
    const ids = byKeyword.structuredContent.items.map(function (x) { return x.id; });
    H.includes(ids, 'hw_003'); H.includes(ids, 'hw_005');
  });

  await H.test('listHomework：limit 生效且 total 是全量', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'listHomework', { status: 'all', limit: 2 });
    H.eq(res.structuredContent.items.length, 2, '只回 2 条');
    H.eq(res.structuredContent.total, 5, 'total 全量 5');
    H.includes(res.content[0].text, '前 2 条', 'content 说明截断');
  });

  await H.test('listHomework：空结果不是错误（无作业）', async function () {
    const { wx, apis } = setup({ homework: [] });
    const res = await H.call(wx, apis, 'listHomework', {});
    H.eq(res.isError, false, '空结果 isError=false');
    H.isArray(res.structuredContent.items);
    H.eq(res.structuredContent.items.length, 0);
    H.eq(res.structuredContent.total, 0);
    H.includes(res.content[0].text, '没有查到', '空结果文案');
  });

  await H.test('listHomework：参数错误（status / limit）→ invalid-input', async function () {
    const { wx, apis } = setup();
    H.isErr(await H.call(wx, apis, 'listHomework', { status: 'todo' }), 'invalid-input');
    H.isErr(await H.call(wx, apis, 'listHomework', { limit: 0 }), 'invalid-input');
    H.isErr(await H.call(wx, apis, 'listHomework', { limit: 51 }), 'invalid-input');
    H.isErr(await H.call(wx, apis, 'listHomework', { limit: 1.5 }), 'invalid-input');
  });

  await H.test('listHomework：未认证 → identity-required + 身份页 handoff', async function () {
    const { wx, apis } = setup({ identity: false });
    const res = await H.call(wx, apis, 'listHomework', {});
    H.isErr(res, 'identity-required');
    const hv = H.handoffOf(res);
    H.includes(hv.query, '', 'handoff 可调用');
    H.eq(typeof res.handoff, 'function');
  });

  await H.test('listHomework：网络失败回退本机缓存（offline=true）', async function () {
    const fx = H.mkFixture();
    const wx = H.createWx({
      storage: fx.storage,
      routes: [{ url: 'homework', method: 'GET', fail: 'request:fail mock' }]
    });
    const loaded = H.loadSkill(wx, SKILL, { fixture: fx });
    const res = await H.call(wx, loaded.apis, 'listHomework', {});
    H.eq(res.isError, false, '离线仍给本机缓存');
    H.eq(res.structuredContent.offline, true, 'offline 标记');
    H.eq(res.structuredContent.total, 3, '本机缓存里待交 3 条');
    H.includes(res.content[0].text, '本机缓存', 'content 说明离线');
  });

  /* ============================================================ getHomeworkDetail */
  await H.test('getHomeworkDetail：成功返回完整内容与截止', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'getHomeworkDetail', { homeworkId: 'hw_001' });
    H.eq(res.isError, false);
    const item = res.structuredContent.item;
    H.eq(item.id, 'hw_001');
    H.eq(item.subject, '高等数学');
    H.includes(item.content, '习题 3.1');
    H.eq(item.done, false);
    H.eq(item.status, 'pending');
    H.eq(item.attachments.length, 0);
    H.match(res.structuredContent.pagePath, /id=hw_001/);
    H.includes(H.handoffOf(res).query, 'id=hw_001');
  });

  await H.test('getHomeworkDetail：附件只回名称/大小/类型，不回内容', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'getHomeworkDetail', { homeworkId: 'hw_005' });
    const item = res.structuredContent.item;
    H.eq(item.done, true);
    H.eq(item.attachments.length, 1);
    const att = item.attachments[0];
    H.eq(att.name, '预习要求.pdf');
    H.eq(att.sizeText, '120 KB');
    H.eq(att.type, 'application/pdf');
    H.notIncludes(JSON.stringify(res), 'data:', '不得出现 data URI');
  });

  await H.test('getHomeworkDetail：缺 id / id 不存在 → invalid-input', async function () {
    const { wx, apis } = setup();
    H.isErr(await H.call(wx, apis, 'getHomeworkDetail', {}), 'invalid-input');
    H.isErr(await H.call(wx, apis, 'getHomeworkDetail', { homeworkId: 'hw_not_exist' }), 'invalid-input');
  });

  await H.test('getHomeworkDetail：未认证 → identity-required', async function () {
    const { wx, apis } = setup({ identity: false });
    H.isErr(await H.call(wx, apis, 'getHomeworkDetail', { homeworkId: 'hw_001' }), 'identity-required');
  });

  /* ============================================================ getHomeworkSummary */
  await H.test('getHomeworkSummary：概览计数 + 最近到期', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'getHomeworkSummary', {});
    H.eq(res.structuredContent.pending, 4, '待交（含已过截止）4 条');
    H.eq(res.structuredContent.done, 1, '已完成 1 条');
    H.eq(res.structuredContent.overdue, 1, '已过截止 1 条');
    H.eq(res.structuredContent.next.id, 'hw_003', '最近到期（已过截止）');
    H.isStr(res.structuredContent.next.leftText);
    H.match(res.structuredContent.pagePath, /^\/pages\/hw\/hw/);
  });

  await H.test('getHomeworkSummary：空作业 → 计数 0、next=null', async function () {
    const { wx, apis } = setup({ homework: [] });
    const res = await H.call(wx, apis, 'getHomeworkSummary', {});
    H.eq(res.isError, false);
    H.eq(res.structuredContent.pending, 0);
    H.eq(res.structuredContent.done, 0);
    H.eq(res.structuredContent.overdue, 0);
    H.eq(res.structuredContent.next, null);
  });

  await H.test('getHomeworkSummary：未认证 → identity-required', async function () {
    const { wx, apis } = setup({ identity: false });
    H.isErr(await H.call(wx, apis, 'getHomeworkSummary', {}), 'identity-required');
  });

  /* ============================================================ setHomeworkDone */
  await H.test('setHomeworkDone：标记完成写入 marks（kind=hw,val=true）', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'setHomeworkDone', { homeworkId: 'hw_001', done: true });
    H.eq(res.isError, false);
    H.eq(res.structuredContent.done, true);
    H.eq(res.structuredContent.pending, false);
    const req = H.lastRequest(wx, 'marks');
    H.ok(req, '有 marks 请求');
    H.eq(req.method, 'POST');
    H.eq(req.data[0].id, SID + '|hw|hw_001', 'marks 行 id');
    H.eq(req.data[0].kind, 'hw');
    H.eq(req.data[0].ref, 'hw_001');
    H.eq(req.data[0].val, true);
    H.eq(req.header.Prefer, 'return=representation,resolution=merge-duplicates', 'upsert Prefer');
    H.eq(storeOf(wx).hwDone.hw_001, true, '本机镜像');
  });

  await H.test('setHomeworkDone：取消完成写 val=false', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'setHomeworkDone', { homeworkId: 'hw_005', done: false });
    H.eq(res.structuredContent.done, false);
    H.eq(H.lastRequest(wx, 'marks').data[0].val, false);
    H.eq(storeOf(wx).hwDone.hw_005, false, '本机镜像取消');
  });

  await H.test('setHomeworkDone：参数错误 / id 不存在 → invalid-input', async function () {
    const { wx, apis } = setup();
    H.isErr(await H.call(wx, apis, 'setHomeworkDone', { homeworkId: 'hw_001' }), 'invalid-input');
    H.isErr(await H.call(wx, apis, 'setHomeworkDone', { homeworkId: 'hw_001', done: 'yes' }), 'invalid-input');
    H.isErr(await H.call(wx, apis, 'setHomeworkDone', { homeworkId: 'nope', done: true }), 'invalid-input');
    H.eq(postCalls(wx, 'marks').length, 0, '参数错误不应发写请求');
  });

  await H.test('setHomeworkDone：云端失败 → 本机生效 + pending=true', async function () {
    const ctx = setup({}, { routeOpts: { marksPostFail: true } });
    const res = await H.call(ctx.wx, ctx.apis, 'setHomeworkDone', { homeworkId: 'hw_002', done: true });
    H.eq(res.isError, false, '本机已生效');
    H.eq(res.structuredContent.pending, true, 'pending 标记');
    H.eq(storeOf(ctx.wx).hwDone.hw_002, true, '本机镜像已写');
    H.eq(storeOf(ctx.wx).markPend.length, 1, '进入待补发队列');
    H.includes(res.content[0].text, '补发', '文案说明');
  });

  await H.test('setHomeworkDone：未认证 → identity-required', async function () {
    const { wx, apis } = setup({ identity: false });
    H.isErr(await H.call(wx, apis, 'setHomeworkDone', { homeworkId: 'hw_001', done: true }), 'identity-required');
  });

  /* ============================================================ publishHomework */
  await H.test('publishHomework：未确认 → need-confirm 且不发写请求', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'publishHomework', { subject: '数学', content: '做习题 4.1' });
    H.isErr(res, 'need-confirm');
    H.eq(postCalls(wx, 'homework').length, 0, '未确认不得写云端');
  });

  await H.test('publishHomework：确认后写云端行（字段对齐 hwRow）', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'publishHomework', {
      subject: ' 数学 ', content: '完成习题 4.1 第 1-5 题', dueDate: '2026-12-01', dueTime: '18:00', confirmed: true
    });
    H.eq(res.isError, false);
    H.eq(res.structuredContent.ok, true);
    H.eq(res.structuredContent.pending, false);
    const req = H.lastRequest(wx, 'homework');
    H.eq(req.method, 'POST');
    const row = req.data[0];
    H.eq(row.subject, '数学', 'subject trim');
    H.eq(row.content, '完成习题 4.1 第 1-5 题');
    H.eq(row.date, '2026-12-01');
    H.eq(row.time, '18:00');
    H.eq(row.due, '2026-12-01 18:00');
    H.eq(row.author, '测试账号');
    H.eq(row.owner, SID);
    H.eq(row.archived, false);
    H.eq(row.done, false);
    H.isStr(res.structuredContent.homeworkId);
    H.eq(row.id, res.structuredContent.homeworkId, '响应 id 与云端行一致');
    const local = storeOf(wx).homework.filter(function (x) { return x.id === res.structuredContent.homeworkId; });
    H.eq(local.length, 1, '本机同步保存');
    H.eq(local[0]._pending, false, '云端成功清除 pending');
  });

  await H.test('publishHomework：参数错误（无内容 / 截止已过 / 日期格式错）', async function () {
    const { wx, apis } = setup();
    H.isErr(await H.call(wx, apis, 'publishHomework', { confirmed: true }), 'invalid-input');
    H.isErr(await H.call(wx, apis, 'publishHomework', { content: 'x', dueDate: '2020-01-01', confirmed: true }), 'invalid-input');
    H.isErr(await H.call(wx, apis, 'publishHomework', { content: 'x', dueDate: '2026/12/01', confirmed: true }), 'invalid-input');
    H.isErr(await H.call(wx, apis, 'publishHomework', { content: 'x', dueTime: '18:00', confirmed: true }), 'invalid-input');
    H.isErr(await H.call(wx, apis, 'publishHomework', { content: 'x', dueDate: '2026-12-01', dueTime: '25:99', confirmed: true }), 'invalid-input');
    H.eq(postCalls(wx, 'homework').length, 0, '参数错误不写云端');
  });

  await H.test('publishHomework：云端失败 → 本机 pending 行 + 不重复发布提示', async function () {
    const ctx = setup({}, { routeOpts: { postHomeworkFail: true } });
    const res = await H.call(ctx.wx, ctx.apis, 'publishHomework', { content: '离线发布测试', confirmed: true });
    H.eq(res.isError, false, '本机已保存');
    H.eq(res.structuredContent.pending, true);
    H.includes(res.content[0].text, '不要重复发布', '文案');
    const rows = storeOf(ctx.wx).homework.filter(function (x) { return x.id === res.structuredContent.homeworkId; });
    H.eq(rows.length, 1);
    H.eq(rows[0]._pending, true, '标记待补发');
  });

  await H.test('publishHomework：未认证 → identity-required', async function () {
    const { wx, apis } = setup({ identity: false });
    H.isErr(await H.call(wx, apis, 'publishHomework', { content: 'x', confirmed: true }), 'identity-required');
  });

  /* ============================================================ deleteHomework */
  await H.test('deleteHomework：未确认 → need-confirm 且不发写请求', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'deleteHomework', { homeworkId: 'hw_002' });
    H.isErr(res, 'need-confirm');
    H.eq(postCalls(wx, 'homework').length, 0, '未确认不得写云端');
  });

  await H.test('deleteHomework：本人删除 → 读整行 + upsert archived=true + 本机移除', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'deleteHomework', { homeworkId: 'hw_002', confirmed: true });
    H.eq(res.isError, false);
    H.eq(res.structuredContent.deleted, true);
    const req = H.lastRequest(wx, 'homework');
    H.eq(req.method, 'POST');
    H.eq(req.data[0].id, 'hw_002');
    H.eq(req.data[0].archived, true);
    H.includes(req.data[0].content, 'Unit 4', 'upsert 保留了整行内容');
    const left = storeOf(wx).homework.filter(function (x) { return x.id === 'hw_002'; });
    H.eq(left.length, 0, '本机已移除');
  });

  await H.test('deleteHomework：非本人非管理员 → permission-denied', async function () {
    const { wx, apis } = setup({ identity: { is_admin: false } });
    const res = await H.call(wx, apis, 'deleteHomework', { homeworkId: 'hw_001', confirmed: true });
    H.isErr(res, 'permission-denied');
    H.includes(res.content[0].text, '发布者', '说明权限原因');
    H.eq(postCalls(wx, 'homework').length, 0, '无权限不得写云端');
  });

  await H.test('deleteHomework：id 不存在 → invalid-input', async function () {
    const { wx, apis } = setup();
    H.isErr(await H.call(wx, apis, 'deleteHomework', { homeworkId: 'nope', confirmed: true }), 'invalid-input');
  });

  await H.test('deleteHomework：云端失败 → 失败且本机数据保留', async function () {
    const ctx = setup({}, { routeOpts: { postHomeworkFail: true } });
    const res = await H.call(ctx.wx, ctx.apis, 'deleteHomework', { homeworkId: 'hw_002', confirmed: true });
    H.isErr(res, 'network');
    H.eq(storeOf(ctx.wx).homework.filter(function (x) { return x.id === 'hw_002'; }).length, 1, '本机未删');
  });

  await H.test('deleteHomework：未认证 → identity-required', async function () {
    const { wx, apis } = setup({ identity: false });
    H.isErr(await H.call(wx, apis, 'deleteHomework', { homeworkId: 'hw_002', confirmed: true }), 'identity-required');
  });

  /* ============================================================ 注册表 / mcp 一致性 */
  await H.test('homework：registerAPI 与 mcp.json 名称逐字一致（6 个）', async function () {
    const loaded = setup().loaded;
    const names = loaded.apiNames.slice().sort();
    H.deepEq(names, ['deleteHomework', 'getHomeworkDetail', 'getHomeworkSummary', 'listHomework', 'publishHomework', 'setHomeworkDone'], '注册接口名');
    H.eq(loaded.mcpError, null, 'mcp.json 可解析');
    const mcpNames = loaded.mcp.apis.map(function (a) { return a.name; }).sort();
    H.deepEq(mcpNames, names, 'mcp.json 接口名与注册一致');
    loaded.mcp.apis.forEach(function (a) {
      H.ok(a._meta && a._meta.ui && a._meta.ui.componentPath, a.name + ' componentPath');
      H.ok(a._meta && a._meta.ui && a._meta.ui.pagePath, a.name + ' pagePath');
      H.eq(typeof a.inputSchema, 'object', a.name + ' inputSchema');
    });
  });

  const rep = H.report('homework', { file: 'ai_unit_homework_result.json' });
  process.exit(rep.fail ? 1 : 0);
})().catch(function (e) {
  console.error('测试脚本异常：', e && e.stack || e);
  process.exit(1);
});
