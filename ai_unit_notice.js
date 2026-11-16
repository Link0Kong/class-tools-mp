/* ai_unit_notice.js —— notice SKILL 原子接口单测（Node + _ai_harness.js）
 *
 * 覆盖 5 个接口，每个接口 ≥3 用例；重点验证：
 *   * [[CLASS_NOTICE_V1]] 解析（自动组 + 手动行、坏行跳过）
 *   * 通知状态口径（真实 deadline / 已过期 / 无时间 / 已处理）
 *   * data URI 绝不进入 structuredContent/content
 *   * marks kind=ntdone / nt 的云端写入体
 *   * 离线缓存兜底、未认证、参数错误
 * 复跑： cd mp-class-tools-tests && node ai_unit_notice.js
 */
'use strict';
const H = require('./_ai_harness.js');

const SKILL = 'ai/skills/notice';
const SID = '3260799999';

function noticesRoute(fx) {
  return { url: 'notices', method: 'GET', handler: function () { return (fx.NOTICE_ROWS || []).slice(); } };
}
function routesOf(fx, opts) {
  opts = opts || {};
  return [
    opts.noticesFail ? { url: 'notices', method: 'GET', fail: 'request:fail mock' } : noticesRoute(fx),
    opts.noticesData !== undefined ? { url: 'notices', method: 'GET', data: opts.noticesData } : null,
    opts.marksPostFail
      ? { url: 'marks', method: 'POST', fail: 'request:fail mock' }
      : { url: 'marks', method: 'POST', handler: function (req) { return { statusCode: 201, data: req.data }; } },
    { url: 'marks', method: 'GET', data: [] }
  ].filter(Boolean);
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
function noticesGets(wx) {
  return (wx.calls.requests || []).filter(function (r) { return r.method === 'GET' && String(r.url).indexOf('notices') >= 0; });
}
function marksPosts(wx) {
  return (wx.calls.requests || []).filter(function (r) { return r.method === 'POST' && String(r.url).indexOf('marks') >= 0; });
}
function emptyNoticeOver() {
  return { notices: [], patch: function (fx) { fx.STORE.notices = []; } };
}

(async function main() {
  /* ============================================================ getNoticeBriefing */
  await H.test('getNoticeBriefing：统计待处理/24h/7天/已过期 + 最紧迫一条', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'getNoticeBriefing', {});
    H.eq(res.isError, false);
    const sc = res.structuredContent;
    H.eq(sc.pending, 3, '待处理 3 条（ntg_002/ntg_004/手动行；ntg_001 已处理、ntg_003 已过期）');
    H.eq(sc.urgent24h, 1, '24 小时内 1 条（ntg_002）');
    H.eq(sc.week, 1, '7 天内 1 条');
    H.eq(sc.expired, 1, '已过期 1 条（ntg_003）');
    H.eq(sc.total, 5, '全部 5 条（4 自动组 + 1 手动行）');
    H.eq(sc.done, 1, '已处理 1 条');
    H.eq(sc.next.id, 'ntg_002', '最紧迫 Next');
    H.match(sc.next.statusText, /今天 .* 截止/, 'next 状态文案（24h 内）');
    H.match(sc.pagePath, /^\/pages\/nt\/nt/, 'pagePath');
    H.eq(H.handoffOf(res).query, 'filter=pending', 'handoff query');
  });

  await H.test('getNoticeBriefing：拉取参数口径（select=*/order/archived=false）', async function () {
    const { wx, apis } = setup();
    await H.call(wx, apis, 'getNoticeBriefing', {});
    const req = noticesGets(wx)[0];
    H.ok(req, '有 notices GET 请求');
    H.includes(req.url, 'select=*');
    H.includes(req.url, 'order=ts.asc,id.asc');
    H.includes(req.url, 'archived=eq.false');
    H.eq(req.header['X-Class-Token'], 'tok-fixture-ai-20261105', '带身份 token');
  });

  await H.test('getNoticeBriefing：没有任何通知 → 0 条、next=null（非错误）', async function () {
    const ctx = setup(emptyNoticeOver(), { routes: [{ url: 'notices', method: 'GET', data: [] }] });
    const res = await H.call(ctx.wx, ctx.apis, 'getNoticeBriefing', {});
    H.eq(res.isError, false);
    H.eq(res.structuredContent.pending, 0);
    H.eq(res.structuredContent.expired, 0);
    H.eq(res.structuredContent.next, null);
    H.includes(res.content[0].text, '没有待处理通知', '空结果文案');
  });

  await H.test('getNoticeBriefing：未认证 → identity-required', async function () {
    const { wx, apis } = setup({ identity: false });
    H.isErr(await H.call(wx, apis, 'getNoticeBriefing', {}), 'identity-required');
  });

  await H.test('getNoticeBriefing：网络失败但本机有手动通知缓存 → 离线成功', async function () {
    const { wx, apis } = setup({}, { routeOpts: { noticesFail: true } });
    const res = await H.call(wx, apis, 'getNoticeBriefing', {});
    H.eq(res.isError, false, '离线仍可用');
    H.eq(res.structuredContent.offline, true, 'offline 标记');
    H.eq(res.structuredContent.total, 1, '本机手动通知 1 条');
    H.includes(res.content[0].text, '本机缓存', '离线文案');
  });

  /* ============================================================ listNotices */
  await H.test('listNotices：默认 pending（已处理/已过期排除），按紧迫度排序', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'listNotices', {});
    H.eq(res.isError, false);
    const sc = res.structuredContent;
    H.eq(sc.total, 3, '待处理 3 条');
    H.eq(sc.items.length, 3);
    H.eq(sc.items[0].id, 'ntg_002', '24h 内截止的排第一');
    H.includes(sc.items.map(function (x) { return x.id; }), 'nt_manual_1', '手动通知也支持');
    H.eq(sc.items[sc.items.length - 1].id, 'ntg_004', '无时间的排最后');
    H.match(sc.pagePath, /filter=pending/);
    H.eq(H.handoffOf(res).query, 'filter=pending');
  });

  await H.test('listNotices：expired / done / all 三种状态', async function () {
    const a = setup();
    const expired = await H.call(a.wx, a.apis, 'listNotices', { status: 'expired' });
    H.eq(expired.structuredContent.total, 1);
    H.eq(expired.structuredContent.items[0].id, 'ntg_003');
    H.eq(expired.structuredContent.items[0].expired, true);
    H.includes(expired.structuredContent.items[0].statusText, '已截止');

    const b = setup();
    const done = await H.call(b.wx, b.apis, 'listNotices', { status: 'done' });
    H.eq(done.structuredContent.total, 1, '已处理 1 条（ntg_001）');
    H.eq(done.structuredContent.items[0].id, 'ntg_001');
    H.eq(done.structuredContent.items[0].done, true);
    H.eq(done.structuredContent.items[0].statusText, '已处理');

    const c = setup();
    const all = await H.call(c.wx, c.apis, 'listNotices', { status: 'all' });
    H.eq(all.structuredContent.total, 5, '全部 5 条');
    H.eq(all.structuredContent.pagePath, '/pages/nt/nt', 'all 不带 filter');
  });

  await H.test('listNotices：分类 / 关键词 / limit', async function () {
    const a = setup();
    const byCat = await H.call(a.wx, a.apis, 'listNotices', { status: 'all', category: '团务' });
    H.eq(byCat.structuredContent.total, 1);
    H.eq(byCat.structuredContent.items[0].id, 'ntg_002');

    const b = setup();
    const byKw = await H.call(b.wx, b.apis, 'listNotices', { status: 'all', keyword: '期中考试' });
    H.eq(byKw.structuredContent.total, 1);
    H.eq(byKw.structuredContent.items[0].id, 'ntg_001');

    const c = setup();
    const limited = await H.call(c.wx, c.apis, 'listNotices', { status: 'all', limit: 2 });
    H.eq(limited.structuredContent.items.length, 2);
    H.eq(limited.structuredContent.total, 5);
    H.includes(limited.content[0].text, '前 2 条');
  });

  await H.test('listNotices：列表项不含 data URI / base64（整表 2MB 安全）', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'listNotices', { status: 'all' });
    const text = JSON.stringify(res);
    H.notIncludes(text, 'data:', '不得出现 data URI');
    H.notIncludes(text, 'base64', '不得出现 base64');
    const ntg1 = res.structuredContent.items.filter(function (x) { return x.id === 'ntg_001'; })[0];
    H.eq(ntg1.images, 1, '图片只给数量');
    H.eq(ntg1.files.length, 1, '附件只给元信息');
    H.eq(ntg1.files[0].name, '期中考试安排.pdf');
    H.eq(ntg1.files[0].size, '240 KB');
    H.eq(ntg1.files[0].type, 'PDF');
    H.eq(ntg1.files[0].url, undefined, '不回附件 url');
  });

  await H.test('listNotices：空结果不是错误', async function () {
    const ctx = setup(emptyNoticeOver(), { routes: [{ url: 'notices', method: 'GET', data: [] }] });
    const res = await H.call(ctx.wx, ctx.apis, 'listNotices', {});
    H.eq(res.isError, false);
    H.eq(res.structuredContent.total, 0);
    H.eq(res.structuredContent.items.length, 0);
    H.includes(res.content[0].text, '没有查到');
  });

  await H.test('listNotices：参数错误（status / limit）→ invalid-input', async function () {
    const { wx, apis } = setup();
    H.isErr(await H.call(wx, apis, 'listNotices', { status: 'new' }), 'invalid-input');
    H.isErr(await H.call(wx, apis, 'listNotices', { limit: 0 }), 'invalid-input');
    H.isErr(await H.call(wx, apis, 'listNotices', { limit: 51 }), 'invalid-input');
    H.isErr(await H.call(wx, apis, 'listNotices', { limit: '10' }), 'invalid-input');
  });

  await H.test('listNotices：未认证 → identity-required', async function () {
    const { wx, apis } = setup({ identity: false });
    H.isErr(await H.call(wx, apis, 'listNotices', {}), 'identity-required');
  });

  await H.test('listNotices：5 分钟内命中缓存（不重复拉 2MB 整表）', async function () {
    const { wx, apis } = setup();
    await H.call(wx, apis, 'getNoticeBriefing', {});
    const first = noticesGets(wx).length;
    H.eq(first, 1, '首次拉整表 1 次');
    H.resetRequests(wx);
    await H.call(wx, apis, 'listNotices', {});
    await H.call(wx, apis, 'getNoticeBriefing', {});
    H.eq(noticesGets(wx).length, 0, '缓存命中后 0 次整表请求');
  });

  await H.test('listNotices：网络失败 → 本机缓存兜底（offline=true）', async function () {
    const { wx, apis } = setup({}, { routeOpts: { noticesFail: true } });
    const res = await H.call(wx, apis, 'listNotices', {});
    H.eq(res.isError, false);
    H.eq(res.structuredContent.offline, true);
    H.eq(res.structuredContent.total, 1, '本机手动通知 1 条');
  });

  /* ============================================================ getNoticeDetail */
  await H.test('getNoticeDetail：摘要/要点/字段/发送者/OCR/附件元信息', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'getNoticeDetail', { noticeId: 'ntg_001' });
    H.eq(res.isError, false);
    const d = res.structuredContent.detail;
    H.eq(d.id, 'ntg_001');
    H.eq(d.category, '考试');
    H.eq(d.statusText, '已处理', 'fixture 中已标记已处理');
    H.isStr(d.deadlineText);
    H.includes(d.summary, '教务处');
    H.eq(d.points.length, 3);
    H.eq(d.fields['时间'], '11 月 12 日-14 日');
    H.eq(d.files[0].name, '期中考试安排.pdf');
    H.eq(d.images, 1);
    H.eq(d.raw.length, 1);
    H.includes(d.raw[0].text, '各位同学');
    H.eq(d.sender.name, '张老师');
    H.eq(d.sender.role, '辅导员');
    H.eq(d.ocr.flagged, true);
    H.eq(d.ocr.count, 1);
    H.match(res.structuredContent.pagePath, /gid=ntg_001/);
    H.eq(H.handoffOf(res).query, 'gid=ntg_001');
    H.notIncludes(JSON.stringify(res), 'data:', '不得出现 data URI');
  });

  await H.test('getNoticeDetail：收集表等详情项 / 无时间通知', async function () {
    const a = setup();
    const form = await H.call(a.wx, a.apis, 'getNoticeDetail', { noticeId: 'ntg_002' });
    H.eq(form.structuredContent.detail.items.length, 1);
    H.eq(form.structuredContent.detail.items[0].kind, 'form');
    H.includes(form.structuredContent.detail.items[0].name, '团日活动报名');
    H.eq(form.structuredContent.detail.done, false);
    H.eq(form.structuredContent.detail.items[0].statusText.length > 0, true);

    const b = setup();
    const none = await H.call(b.wx, b.apis, 'getNoticeDetail', { noticeId: 'ntg_004' });
    H.eq(none.structuredContent.detail.statusText, '无时间');
    H.eq(none.structuredContent.detail.deadlineText, '');
  });

  await H.test('getNoticeDetail：手动纯文本通知也能看详情', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'getNoticeDetail', { noticeId: 'nt_manual_1' });
    H.eq(res.isError, false);
    H.eq(res.structuredContent.detail.title, '教室调整通知');
    H.eq(res.structuredContent.detail.manual, true);
    H.includes(res.structuredContent.detail.raw[0].text, 'B201');
  });

  await H.test('getNoticeDetail：缺 id / id 不存在 → invalid-input', async function () {
    const { wx, apis } = setup();
    H.isErr(await H.call(wx, apis, 'getNoticeDetail', {}), 'invalid-input');
    H.isErr(await H.call(wx, apis, 'getNoticeDetail', { noticeId: 'nope' }), 'invalid-input');
  });

  await H.test('getNoticeDetail：未认证 → identity-required', async function () {
    const { wx, apis } = setup({ identity: false });
    H.isErr(await H.call(wx, apis, 'getNoticeDetail', { noticeId: 'ntg_001' }), 'identity-required');
  });

  /* ============================================================ setNoticeDone */
  await H.test('setNoticeDone：标记已处理写入 marks（kind=ntdone,val=true）', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'setNoticeDone', { noticeId: 'ntg_002', done: true });
    H.eq(res.isError, false);
    H.eq(res.structuredContent.done, true);
    H.eq(res.structuredContent.pending, false);
    const req = H.lastRequest(wx, 'marks');
    H.eq(req.method, 'POST');
    H.eq(req.data[0].id, SID + '|ntdone|ntg_002', 'marks 行 id');
    H.eq(req.data[0].kind, 'ntdone');
    H.eq(req.data[0].ref, 'ntg_002');
    H.eq(req.data[0].val, true);
    H.eq(storeOf(wx).ntDone.ntg_002, true, '本机镜像');
    H.match(res.structuredContent.pagePath, /gid=ntg_002/);
  });

  await H.test('setNoticeDone：恢复待处理写 val=false', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'setNoticeDone', { noticeId: 'ntg_001', done: false });
    H.eq(res.structuredContent.done, false);
    H.eq(H.lastRequest(wx, 'marks').data[0].val, false);
    H.eq(storeOf(wx).ntDone.ntg_001, false, '本机镜像取消');
  });

  await H.test('setNoticeDone：已过期通知不允许标记已处理', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'setNoticeDone', { noticeId: 'ntg_003', done: true });
    H.isErr(res, 'invalid-input');
    H.includes(res.content[0].text, '已过期');
    H.eq(marksPosts(wx).length, 0, '不应发写请求');
  });

  await H.test('setNoticeDone：参数错误 / id 不存在 → invalid-input', async function () {
    const { wx, apis } = setup();
    H.isErr(await H.call(wx, apis, 'setNoticeDone', { noticeId: 'ntg_002' }), 'invalid-input');
    H.isErr(await H.call(wx, apis, 'setNoticeDone', { done: true }), 'invalid-input');
    H.isErr(await H.call(wx, apis, 'setNoticeDone', { noticeId: 'nope', done: true }), 'invalid-input');
    H.eq(marksPosts(wx).length, 0, '参数错误不写云端');
  });

  await H.test('setNoticeDone：云端失败 → 本机生效 + pending=true', async function () {
    const ctx = setup({}, { routeOpts: { marksPostFail: true } });
    const res = await H.call(ctx.wx, ctx.apis, 'setNoticeDone', { noticeId: 'ntg_002', done: true });
    H.eq(res.isError, false);
    H.eq(res.structuredContent.pending, true);
    H.eq(storeOf(ctx.wx).ntDone.ntg_002, true, '本机镜像已写');
    H.eq(storeOf(ctx.wx).markPend.length, 1, '进入待补发队列');
  });

  await H.test('setNoticeDone：未认证 → identity-required', async function () {
    const { wx, apis } = setup({ identity: false });
    H.isErr(await H.call(wx, apis, 'setNoticeDone', { noticeId: 'ntg_002', done: true }), 'identity-required');
  });

  /* ============================================================ setNoticePinned */
  await H.test('setNoticePinned：置顶写入 marks（kind=nt,val=true）', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'setNoticePinned', { noticeId: 'ntg_004', pinned: true });
    H.eq(res.isError, false);
    H.eq(res.structuredContent.pinned, true);
    const req = H.lastRequest(wx, 'marks');
    H.eq(req.data[0].id, SID + '|nt|ntg_004');
    H.eq(req.data[0].kind, 'nt');
    H.eq(req.data[0].ref, 'ntg_004');
    H.eq(req.data[0].val, true);
    H.eq(storeOf(wx).ntPin.ntg_004, true, '本机镜像');
  });

  await H.test('setNoticePinned：取消置顶写 val=false', async function () {
    const { wx, apis } = setup();
    const res = await H.call(wx, apis, 'setNoticePinned', { noticeId: 'ntg_002', pinned: false });
    H.eq(res.structuredContent.pinned, false);
    H.eq(H.lastRequest(wx, 'marks').data[0].val, false);
  });

  await H.test('setNoticePinned：参数错误 / id 不存在 → invalid-input', async function () {
    const { wx, apis } = setup();
    H.isErr(await H.call(wx, apis, 'setNoticePinned', { noticeId: 'ntg_002' }), 'invalid-input');
    H.isErr(await H.call(wx, apis, 'setNoticePinned', { noticeId: 'nope', pinned: true }), 'invalid-input');
    H.eq(marksPosts(wx).length, 0);
  });

  await H.test('setNoticePinned：云端失败 → pending=true', async function () {
    const ctx = setup({}, { routeOpts: { marksPostFail: true } });
    const res = await H.call(ctx.wx, ctx.apis, 'setNoticePinned', { noticeId: 'ntg_004', pinned: true });
    H.eq(res.isError, false);
    H.eq(res.structuredContent.pending, true);
    H.eq(storeOf(ctx.wx).ntPin.ntg_004, true);
  });

  await H.test('setNoticePinned：未认证 → identity-required', async function () {
    const { wx, apis } = setup({ identity: false });
    H.isErr(await H.call(wx, apis, 'setNoticePinned', { noticeId: 'ntg_004', pinned: true }), 'identity-required');
  });

  /* ============================================================ 解析健壮性 / 注册表 */
  await H.test('解析：坏 JSON 行跳过，其它通知不受影响', async function () {
    const fx = H.mkFixture();
    const rows = fx.NOTICE_ROWS.slice();
    rows.push({ id: 'bad_row', title: '', body: '[[CLASS_NOTICE_V1]]{bad json', archived: false, ts: Date.now() - 60000 });
    const wx = H.createWx({ storage: fx.storage, routes: [{ url: 'notices', method: 'GET', data: rows }] });
    const loaded = H.loadSkill(wx, SKILL, { fixture: fx });
    const res = await H.call(wx, loaded.apis, 'listNotices', { status: 'all' });
    H.eq(res.isError, false);
    H.eq(res.structuredContent.total, 5, '坏行被跳过，其余 5 条正常');
  });

  await H.test('notice：registerAPI 与 mcp.json 名称逐字一致（5 个）', async function () {
    const loaded = setup().loaded;
    const names = loaded.apiNames.slice().sort();
    H.deepEq(names, ['getNoticeBriefing', 'getNoticeDetail', 'listNotices', 'setNoticeDone', 'setNoticePinned'], '注册接口名');
    H.eq(loaded.mcpError, null, 'mcp.json 可解析');
    const mcpNames = loaded.mcp.apis.map(function (a) { return a.name; }).sort();
    H.deepEq(mcpNames, names, 'mcp.json 接口名与注册一致');
    loaded.mcp.apis.forEach(function (a) {
      H.ok(a._meta && a._meta.ui && a._meta.ui.componentPath, a.name + ' componentPath');
      H.ok(a._meta && a._meta.ui && a._meta.ui.pagePath, a.name + ' pagePath');
      H.eq(typeof a.inputSchema, 'object', a.name + ' inputSchema');
    });
    H.eq(loaded.mcp.components.length, 3, '3 个原子组件');
    loaded.mcp.components.forEach(function (c) {
      H.eq(c.relatedPage, '/pages/nt/nt', c.path + ' relatedPage');
    });
  });

  const rep = H.report('notice', { file: 'ai_unit_notice_result.json' });
  process.exit(rep.fail ? 1 : 0);
})().catch(function (e) {
  console.error('测试脚本异常：', e && e.stack || e);
  process.exit(1);
});
