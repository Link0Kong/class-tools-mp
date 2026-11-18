/* ai_unit_account.js —— account SKILL 原子接口单元测试（CONTRACT §8.2）
 *
 * 运行：cd mp-class-tools-tests && node ai_unit_account.js
 * 基座：_ai_harness.js（mock wx / modelContext / storage / rest 路由；不触网）
 *
 * 覆盖：11 个原子接口 × 成功 / 空结果或错误分支 / 入参校验；
 *       写操作请求体（feedback 提交、marks 置否、fitrecs 归档、userdata 覆盖）；
 *       未认证 identity-required；任务项确认规则（clearCloudData/clearLocalData 需 confirmed）；
 *       handoff query/payload 与 pagePath；隐私口径（导出不含 token/学号/名单原文）。
 */
'use strict';
const H = require('./_ai_harness.js');

const SKILL = 'ai/skills/account';
const SID = '3260799999';

function start(over, routes) {
  const fx = H.mkFixture(over || {});
  const wx = H.createWx({ storage: fx.storage, routes: routes || [] });
  return { fx: fx, wx: wx };
}
function load(wx) { return H.loadSkill(wx, SKILL); }
function textOf(res) { return (res.content || []).map(function (c) { return c.text; }).join(' '); }

// 常用路由：四张小表 + feedback + visits（各接口按需取用）
function tableRoutes(fx) {
  return [
    { url: 'marks', method: 'GET', data: [
      { id: SID + '|hw|hw_001', seat: SID, kind: 'hw', ref: 'hw_001', val: true, ts: fx.now },
      { id: SID + '|ntdone|ntg_002', seat: SID, kind: 'ntdone', ref: 'ntg_002', val: false, ts: fx.now }
    ] },
    { url: 'homework', method: 'GET', data: function () { return fx.HOMEWORK; } },
    { url: 'fitrecs', method: 'GET', data: [
      { id: 'fit_001', acc: SID, data: JSON.stringify(fx.FIT_RECORDS[0]), arch: false, ts: fx.now }
    ] },
    { url: 'userdata', method: 'GET', data: [{ id: SID, blob: JSON.stringify({ v: 6, at: { homeTools: fx.now }, homeTools: ['tt', 'hw'], fit: {}, draw: {}, group: {}, roster: {}, hide: {}, tt: {}, prefs: {}, nick: '' }), ts: fx.now }] },
    { url: 'marks', method: 'POST', handler: function (req) { return { statusCode: 201, data: req.data }; } },
    { url: 'userdata', method: 'POST', handler: function (req) { return { statusCode: 201, data: req.data }; } },
    { url: 'fitrecs', method: 'POST', handler: function (req) { return { statusCode: 201, data: req.data }; } },
    { url: 'feedback', method: 'GET', data: function () { return fx.FEEDBACK || []; } },
    { url: 'feedback', method: 'POST', handler: function (req) { return { statusCode: 201, data: req.data }; } }
  ];
}
function withFeedback(fx) {
  fx.FEEDBACK = [
    { id: 'fb_001', content: '通知页图片加载慢，希望优化一下。', contact: '', acc: SID, done: false, ts: fx.now - 3600000 },
    { id: 'fb_002', content: '已经处理过的反馈', contact: '微信 abc', acc: SID, done: true, ts: fx.now - 7200000 },
    { id: 'fb_003', content: '别人的反馈', contact: '', acc: '9999000001', done: false, ts: fx.now - 10800000 }
  ];
  return fx;
}

(async function main() {
  /* ================= getSyncStatus ================= */
  await H.test('getSyncStatus：已认证 → verified/未关闭/无待补发/network.enabled', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'getSyncStatus', {});
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.verified, true);
    H.eq(sc.off, false);
    H.eq(sc.hold, false);
    H.eq(sc.pending, 0);
    H.eq(sc.lastSyncText, '');
    H.eq(sc.network.enabled, true);
    H.eq(sc.pagePath, '/pages/data/data');
    H.eq(s.wx.calls.requests.length, 0, '状态为纯本机读取');
    H.eq(H.handoffOf(res).query, '');
  });

  await H.test('getSyncStatus：未认证 → 仍成功（不返回 identity-required），提示先验证', async function () {
    const s = start({ identity: false });
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'getSyncStatus', {});
    H.isOk(res);
    H.eq(res.structuredContent.verified, false);
    H.includes(textOf(res), '身份验证');
  });

  await H.test('getSyncStatus：cloudOff/待补发/抑制期 → off/pending/hold 正确', async function () {
    const s = start({ patch: function (fx) {
      fx.STORE.cloudOff = true;
      fx.STORE.markPend = [{ seat: SID, kind: 'hw', ref: 'hw_001', val: true }];
      fx.STORE.udPend = true;
      fx.STORE.udHoldUntil = fx.now + 3600000;
    } });
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'getSyncStatus', {});
    H.isOk(res);
    H.eq(res.structuredContent.off, true);
    H.eq(res.structuredContent.pending, 2, '1 条 markPend + 1 条 udPend');
    H.eq(res.structuredContent.hold, true);
    H.includes(textOf(res), '仅本机');
    H.includes(textOf(res), '清除过云端');
  });

  /* ================= syncNow ================= */
  await H.test('syncNow：成功刷新四类小表（marks/homework/fitrecs/userdata 均有请求）', async function () {
    const s = start({}, tableRoutes(H.mkFixture()));
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'syncNow', {});
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.ok, true);
    H.deepEq(sc.refreshed, { marks: true, homework: true, fitrecs: true, userdata: true });
    H.isNum(sc.at);
    H.ok(H.lastRequest(s.wx, 'marks'), '应拉 marks');
    H.ok(H.lastRequest(s.wx, 'homework'), '应拉 homework');
    H.ok(H.lastRequest(s.wx, 'fitrecs'), '应拉 fitrecs');
    H.ok(H.lastRequest(s.wx, 'userdata'), '应拉 userdata');
    H.ok(!H.lastRequest(s.wx, 'notices'), '通知整表不在本接口拉取');
    const store = JSON.parse(s.wx.getStorageSync('zq_tools_v2'));
    H.ok(store.udCache && store.udCache.v === 6, 'userdata 应写入 udCache 基线');
    H.eq(store.udPend, false);
    H.ok(s.wx.getStorageSync('zqa1_lastSyncAt'), '应记录同步时间');
    H.eq(H.handoffOf(res).query, '');
  });

  await H.test('syncNow：cloudOff → cloud-off 失败且不发请求', async function () {
    const s = start({ patch: function (fx) { fx.STORE.cloudOff = true; } });
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'syncNow', {});
    H.isErr(res, 'cloud-off');
    H.includes(textOf(res), '云同步已关闭');
    H.eq(s.wx.calls.requests.length, 0);
  });

  await H.test('syncNow：未认证 → identity-required，不发请求', async function () {
    const s = start({ identity: false });
    const { apis } = load(s.wx);
    H.isErr(await H.call(s.wx, apis, 'syncNow', {}), 'identity-required');
    H.eq(s.wx.calls.requests.length, 0);
  });

  await H.test('syncNow：网络失败 → 部分刷新失败但不抛错', async function () {
    const s = start({}, [
      { url: 'marks', method: 'GET', fail: 'request:fail mock' },
      { url: 'homework', method: 'GET', data: [] },
      { url: 'fitrecs', method: 'GET', data: [] },
      { url: 'userdata', method: 'GET', data: [] }
    ]);
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'syncNow', {});
    H.isOk(res);
    H.eq(res.structuredContent.ok, false);
    H.eq(res.structuredContent.refreshed.marks, false);
    H.eq(res.structuredContent.refreshed.homework, true);
    H.includes(textOf(res), '部分数据刷新失败');
  });

  /* ================= setCloudSync ================= */
  await H.test('setCloudSync：enabled=false → off=true 并写入本机 cloudOff', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'setCloudSync', { enabled: false });
    H.isOk(res);
    H.eq(res.structuredContent.off, true);
    H.eq(JSON.parse(s.wx.getStorageSync('zq_tools_v2')).cloudOff, true);
    H.includes(textOf(res), '仅本机');
    H.eq(H.handoffOf(res).query, '');
  });

  await H.test('setCloudSync：enabled=true → 打开并补发 markPend（请求体正确）', async function () {
    const fx = H.mkFixture({ patch: function (f) {
      f.STORE.cloudOff = true;
      f.STORE.markPend = [{ seat: SID, kind: 'hw', ref: 'hw_001', val: true }];
    } });
    const wx = H.createWx({ storage: fx.storage, routes: [
      { url: 'marks', method: 'POST', handler: function (req) { return { statusCode: 201, data: req.data }; } }
    ] });
    const { apis } = load(wx);
    const res = await H.call(wx, apis, 'setCloudSync', { enabled: true });
    H.isOk(res);
    H.eq(res.structuredContent.off, false);
    H.eq(JSON.parse(wx.getStorageSync('zq_tools_v2')).cloudOff, false);
    const req = H.lastRequest(wx, 'marks');
    H.deepEq(req.data[0], { id: SID + '|hw|hw_001', seat: SID, kind: 'hw', ref: 'hw_001', val: true, ts: req.data[0].ts });
    H.eq(req.header.Prefer, 'return=representation,resolution=merge-duplicates');
  });

  await H.test('setCloudSync：enabled 非 boolean → invalid-input', async function () {
    const s = start();
    const { apis } = load(s.wx);
    H.isErr(await H.call(s.wx, apis, 'setCloudSync', { enabled: 'yes' }), 'invalid-input');
    H.isErr(await H.call(s.wx, apis, 'setCloudSync', {}), 'invalid-input');
    H.eq(s.wx.calls.requests.length, 0);
  });

  await H.test('setCloudSync：未认证 → identity-required', async function () {
    const s = start({ identity: false });
    const { apis } = load(s.wx);
    H.isErr(await H.call(s.wx, apis, 'setCloudSync', { enabled: false }), 'identity-required');
  });

  /* ================= getDataOverview ================= */
  await H.test('getDataOverview：成功 → 本机体积/条数/同步范围/不可删除项', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'getDataOverview', {});
    H.isOk(res);
    const sc = res.structuredContent;
    H.isNum(sc.local.storageKB);
    H.ok(sc.local.keys >= 3, 'storage keys: ' + sc.local.keys);
    H.eq(sc.counts.homework, 5);
    H.eq(sc.counts.notices, 1);
    H.eq(sc.counts.marks, 3, 'hwDone 1 + ntPin 1 + ntDone 1');
    H.eq(sc.counts.fitRecs, 2);
    H.eq(sc.counts.members, 8);
    H.eq(sc.cloud.ranges.length, 12);
    H.deepEq(sc.cloud.notDeletable, ['访问统计', '反馈建议']);
    H.eq(sc.pagePath, '/pages/data/data');
  });

  await H.test('getDataOverview：未认证 → identity-required', async function () {
    const s = start({ identity: false });
    const { apis } = load(s.wx);
    H.isErr(await H.call(s.wx, apis, 'getDataOverview', {}), 'identity-required');
  });

  await H.test('getDataOverview：空数据 → 全 0 且成功', async function () {
    const s = start({ patch: function (fx) {
      fx.STORE.homework = []; fx.STORE.notices = []; fx.STORE.hwDone = {}; fx.STORE.ntPin = {};
      fx.STORE.ntDone = {}; fx.STORE.fitRecs = []; fx.STORE.classMembers = [];
    } });
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'getDataOverview', {});
    H.isOk(res);
    H.deepEq(res.structuredContent.counts, { homework: 0, notices: 0, marks: 0, fitRecs: 0, members: 0 });
  });

  /* ================= exportMyData ================= */
  await H.test('exportMyData：成功 → JSON 可解析、≤8KB、不含 token/学号/名单原文', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'exportMyData', {});
    H.isOk(res);
    const sc = res.structuredContent;
    H.ok(sc.summary.bytes <= 8192, '导出字节数 ' + sc.summary.bytes);
    H.ok(sc.summary.bytes > 100, '导出内容不应为空');
    H.eq(sc.summary.homework, 5);
    const obj = JSON.parse(sc.jsonText);
    H.eq(obj.schema, 'class-tools-userdata');
    H.eq(obj.who.name, '测试账号');
    H.notIncludes(sc.jsonText, 'tok-fixture-ai-20261105', '不得包含身份 token');
    H.notIncludes(sc.jsonText, SID, '不得包含学号');
    H.notIncludes(sc.jsonText, '李学盈', '不得包含班级名单原文');
    H.notIncludes(sc.jsonText, 'classMembers');
    H.eq(sc.pagePath, '/pages/data/data');
    H.eq(H.handoffOf(res).query, '');
  });

  await H.test('exportMyData：marks 极多 → 剪裁到 8KB 以内且仍可解析', async function () {
    const s = start({ patch: function (fx) {
      const done = {};
      for (let i = 0; i < 600; i++) done['hw_' + String(i).padStart(4, '0')] = true;
      fx.STORE.hwDone = done;
    } });
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'exportMyData', {});
    H.isOk(res);
    H.ok(res.structuredContent.summary.bytes <= 8192, '剪裁后仍超限: ' + res.structuredContent.summary.bytes);
    H.ok(JSON.parse(res.structuredContent.jsonText), '剪裁后 JSON 必须可解析');
  });

  await H.test('exportMyData：未认证 → identity-required', async function () {
    const s = start({ identity: false });
    const { apis } = load(s.wx);
    H.isErr(await H.call(s.wx, apis, 'exportMyData', {}), 'identity-required');
  });

  /* ================= clearCloudData ================= */
  await H.test('clearCloudData：未 confirmed → need-confirm 且不执行任何写操作', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'clearCloudData', {});
    H.isErr(res, 'need-confirm');
    H.includes(textOf(res), '确认');
    H.eq(s.wx.calls.requests.length, 0, '未确认不得发请求');
  });

  await H.test('clearCloudData：confirmed=true → userdata 覆盖空 v6、marks 置否、fitrecs 归档', async function () {
    const fx = H.mkFixture();
    const routes = [
      { url: 'userdata', method: 'POST', handler: function (req) { return { statusCode: 201, data: req.data }; } },
      { url: 'marks', method: 'GET', data: [
        { id: SID + '|hw|hw_001', seat: SID, kind: 'hw', ref: 'hw_001', val: true, ts: fx.now },
        { id: SID + '|nt|ntg_002', seat: SID, kind: 'nt', ref: 'ntg_002', val: true, ts: fx.now }
      ] },
      { url: 'marks', method: 'POST', handler: function (req) { return { statusCode: 201, data: req.data }; } },
      { url: 'fitrecs', method: 'GET', data: [
        { id: 'fit_001', acc: SID, data: JSON.stringify(fx.FIT_RECORDS[0]), arch: false, ts: fx.now }
      ] },
      { url: 'fitrecs', method: 'POST', handler: function (req) { return { statusCode: 201, data: req.data }; } }
    ];
    const wx = H.createWx({ storage: fx.storage, routes: routes });
    const { apis } = load(wx);
    const res = await H.call(wx, apis, 'clearCloudData', { confirmed: true });
    H.isOk(res);
    H.deepEq(res.structuredContent.cleared, { userdata: true, marks: 2, fitrecs: 1 });
    // userdata 覆盖为空 v6
    const udReq = H.lastRequest(wx, 'userdata');
    const blob = JSON.parse(udReq.data[0].blob);
    H.eq(blob.v, 6);
    H.deepEq(blob.homeTools, []);
    H.eq(blob.at.homeTools, 0);
    // marks 全部 val=false
    const marksReq = H.lastRequest(wx, 'marks');
    H.eq(marksReq.data.length, 2);
    marksReq.data.forEach(function (r) { H.eq(r.val, false); });
    // fitrecs 归档
    const fitReq = H.lastRequest(wx, 'fitrecs');
    H.eq(fitReq.data[0].arch, true);
    // 本机：保持干净基线 + 抑制期 + 勾选清空
    const store = JSON.parse(wx.getStorageSync('zq_tools_v2'));
    H.ok(store.udHoldUntil > Date.now(), '应进入抑制期');
    H.deepEq(store.hwDone, {});
    H.deepEq(store.markPend, []);
    H.ok(store.udCache && store.udCache.at.homeTools > 0, 'udCache 应为本机现值基线');
    H.eq(H.handoffOf(res).query, '');
  });

  await H.test('clearCloudData：网络失败 → 明确失败且不声称成功', async function () {
    const s = start({}, [
      { url: 'userdata', method: 'POST', fail: 'request:fail mock' }
    ]);
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'clearCloudData', { confirmed: true });
    H.isErr(res);
    H.includes(textOf(res), '清除云端数据未完成');
  });

  await H.test('clearCloudData：未认证 → identity-required（即使 confirmed=true）', async function () {
    const s = start({ identity: false });
    const { apis } = load(s.wx);
    H.isErr(await H.call(s.wx, apis, 'clearCloudData', { confirmed: true }), 'identity-required');
  });

  /* ================= clearLocalData ================= */
  await H.test('clearLocalData：未 confirmed → need-confirm 且不清数据', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'clearLocalData', {});
    H.isErr(res, 'need-confirm');
    const store = JSON.parse(s.wx.getStorageSync('zq_tools_v2'));
    H.eq(store.homework.length, 5, '未确认不得清数据');
  });

  await H.test('clearLocalData：confirmed=true → 清本机（保留身份）并清理缓存键', async function () {
    const s = start();
    s.wx.setStorageSync('zqa1_ntGroups', { at: 1, g: [] });
    s.wx.setStorageSync('zq_visit_slot', SID + '|2026-11-05-13');
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'clearLocalData', { confirmed: true });
    H.isOk(res);
    H.eq(res.structuredContent.ok, true);
    H.eq(res.structuredContent.identityKept, true);
    H.eq(res.structuredContent.pagePath, '/pages/data/data');
    // 身份保留
    const id = JSON.parse(s.wx.getStorageSync('zq_class_identity'));
    H.eq(id.name, '测试账号');
    // 主数据被重置
    const store = JSON.parse(s.wx.getStorageSync('zq_tools_v2'));
    H.deepEq(store.homework, []);
    H.deepEq(store.classMembers, []);
    H.deepEq(store.homeTools, ['hw', 'nt', 'ft', 'draw']);
    // 工作流清空
    const flow = JSON.parse(s.wx.getStorageSync('zq_flow'));
    H.eq(flow.draw, null);
    // 缓存键被清理
    H.eq(s.wx.getStorageSync('zqa1_ntGroups'), '');
    H.eq(s.wx.getStorageSync('zq_visit_slot'), '');
  });

  await H.test('clearLocalData：未认证 → identity-required', async function () {
    const s = start({ identity: false });
    const { apis } = load(s.wx);
    H.isErr(await H.call(s.wx, apis, 'clearLocalData', { confirmed: true }), 'identity-required');
  });

  /* ================= submitFeedback ================= */
  await H.test('submitFeedback：成功 → 请求体含 content/空 contact/acc/done，返回 feedbackId', async function () {
    const fx = withFeedback(H.mkFixture());
    const wx = H.createWx({ storage: fx.storage, routes: tableRoutes(fx) });
    const { apis } = load(wx);
    const res = await H.call(wx, apis, 'submitFeedback', { content: '通知页图片加载慢，希望优化', contact: '微信 abc' });
    H.isOk(res);
    H.ok(res.structuredContent.feedbackId, '应返回 feedbackId');
    H.eq(res.structuredContent.pagePath, '/pages/fb/fb');
    const body = H.lastRequest(wx, 'feedback').data[0];
    H.eq(body.content, '通知页图片加载慢，希望优化');
    H.eq(body.contact, '', '联系方式已停收：即使模型传了 contact 也写空串');
    H.eq(body.acc, SID);
    H.eq(body.done, false);
    H.isNum(body.ts);
    H.eq(typeof body.id, 'string');
    H.eq(H.handoffOf(res).query, '');
  });

  await H.test('submitFeedback：参数缺失时用平台透传的本轮原文兜底（_meta.context.query）', async function () {
    const fx = withFeedback(H.mkFixture());
    const wx = H.createWx({ storage: fx.storage, routes: tableRoutes(fx) });
    const { apis } = load(wx);
    const res = await H.call(wx, apis, 'submitFeedback', {}, { query: '作业提交后页面一直转圈' });
    H.isOk(res);
    H.eq(H.lastRequest(wx, 'feedback').data[0].content, '作业提交后页面一直转圈');
  });

  await H.test('submitFeedback：content 过长/空白 → invalid-input 且不发请求', async function () {
    const s = start();
    const { apis } = load(s.wx);
    H.isErr(await H.call(s.wx, apis, 'submitFeedback', { content: 'x'.repeat(501) }), 'invalid-input');
    H.isErr(await H.call(s.wx, apis, 'submitFeedback', { content: '   ' }), 'invalid-input');
    H.eq(s.wx.calls.requests.length, 0);
  });

  await H.test('submitFeedback：未认证 → identity-required；网络失败 → network', async function () {
    const s = start({ identity: false });
    const { apis } = load(s.wx);
    H.isErr(await H.call(s.wx, apis, 'submitFeedback', { content: '测试' }), 'identity-required');
    const s2 = start({}, [{ url: 'feedback', method: 'POST', fail: 'request:fail mock' }]);
    const a2 = load(s2.wx);
    const res = await H.call(s2.wx, a2.apis, 'submitFeedback', { content: '测试网络失败' });
    H.isErr(res, 'network');
  });

  /* ================= listMyFeedback ================= */
  await H.test('listMyFeedback：只返回自己的反馈 + 摘要/时间/处理状态', async function () {
    const fx = withFeedback(H.mkFixture());
    const wx = H.createWx({ storage: fx.storage, routes: tableRoutes(fx) });
    const { apis } = load(wx);
    const res = await H.call(wx, apis, 'listMyFeedback', {});
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.total, 2);
    H.eq(sc.items[0].feedbackId, 'fb_001');
    H.eq(sc.items[0].done, false);
    H.ok(sc.items[0].content120.length <= 121, '内容摘要应截断到 120 字');
    H.ok(sc.items[0].tsText.length > 0);
    H.eq(sc.pagePath, '/pages/fb/fb');
    H.eq(H.handoffOf(res).query, '');
  });

  await H.test('listMyFeedback：空结果 → isError=false + 引导提交', async function () {
    const fx = withFeedback(H.mkFixture());
    fx.FEEDBACK = [];
    const wx = H.createWx({ storage: fx.storage, routes: tableRoutes(fx) });
    const { apis } = load(wx);
    const res = await H.call(wx, apis, 'listMyFeedback', {});
    H.isOk(res);
    H.eq(res.structuredContent.total, 0);
    H.deepEq(res.structuredContent.items, []);
    H.includes(textOf(res), '还没有提交过反馈');
  });

  await H.test('listMyFeedback：未认证 → identity-required', async function () {
    const s = start({ identity: false });
    const { apis } = load(s.wx);
    H.isErr(await H.call(s.wx, apis, 'listMyFeedback', {}), 'identity-required');
  });

  /* ================= markFeedbackDone ================= */
  await H.test('markFeedbackDone：非管理员 → forbidden', async function () {
    const fx = withFeedback(H.mkFixture());
    const s = start({ identity: { is_admin: false, role: '', badge: '' } });
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'markFeedbackDone', { feedbackId: 'fb_001' });
    H.isErr(res, 'forbidden');
    H.includes(textOf(res), '管理员');
    H.eq(s.wx.calls.requests.length, 0);
  });

  await H.test('markFeedbackDone：管理员成功 → 读整行后 upsert done=true', async function () {
    const fx = withFeedback(H.mkFixture());
    const routes = [
      { url: 'feedback', method: 'GET', data: fx.FEEDBACK },
      { url: 'feedback', method: 'POST', handler: function (req) { return { statusCode: 201, data: req.data }; } }
    ];
    const wx = H.createWx({ storage: fx.storage, routes: routes });
    const { apis } = load(wx);
    const res = await H.call(wx, apis, 'markFeedbackDone', { feedbackId: 'fb_001' });
    H.isOk(res);
    H.eq(res.structuredContent.feedbackId, 'fb_001');
    H.eq(res.structuredContent.done, true);
    const body = H.lastRequest(wx, 'feedback').data[0];
    H.eq(body.id, 'fb_001');
    H.eq(body.done, true);
  });

  await H.test('markFeedbackDone：feedbackId 不存在 → not-found；缺参 → invalid-input', async function () {
    const fx = withFeedback(H.mkFixture());
    const wx = H.createWx({ storage: fx.storage, routes: [
      { url: 'feedback', method: 'GET', data: [] }
    ] });
    const { apis } = load(wx);
    H.isErr(await H.call(wx, apis, 'markFeedbackDone', { feedbackId: 'fb_nope' }), 'not-found');
    H.isErr(await H.call(wx, apis, 'markFeedbackDone', {}), 'invalid-input');
  });

  await H.test('markFeedbackDone：未认证 → identity-required', async function () {
    const s = start({ identity: false });
    const { apis } = load(s.wx);
    H.isErr(await H.call(s.wx, apis, 'markFeedbackDone', { feedbackId: 'fb_001' }), 'identity-required');
  });

  /* ================= getVisitStats ================= */
  function visitRoutes(fx, rows) {
    return [
      { url: 'visits', method: 'GET', data: rows || [] }
    ];
  }
  function visitRows(fx) {
    const now = new Date(fx.now);
    const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    const ymd = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    const today = ymd(now);
    const yest = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    return [
      { id: SID + '|' + today + '-13|mp', slot: today + '-13', sid: SID, name: '测试账号', ts: fx.now, client: 'mp' },
      { id: '9000000001|' + today + '-12|web', slot: today + '-12', sid: '9000000001', name: '李学盈', ts: fx.now - 3600000, client: 'web' },
      { id: '9000000002|' + today + '-12|mp', slot: today + '-12', sid: '9000000002', name: '王梓萱', ts: fx.now - 4000000, client: 'mp' },
      { id: '9000000001|' + yest + '-09|android', slot: yest + '-09', sid: '9000000001', name: '李学盈', ts: fx.now - 20 * 3600000, client: 'android' },
      { id: '9000000003|' + today + '-11|win', slot: today + '-11', sid: '9000000003', name: '赵六', ts: fx.now - 2 * 3600000, client: 'win' },
      { id: 'anon|' + today + '-08', slot: today + '-08', sid: '', name: '', ts: fx.now - 30 * 3600000 }
    ];
  }

  await H.test('getVisitStats：管理员成功 → 按最近登录/端/忽略测试账号（不含学号）', async function () {
    const fx = H.mkFixture();
    const rows = visitRows(fx);
    const wx = H.createWx({ storage: fx.storage, routes: visitRoutes(fx, rows) });
    const { apis } = load(wx);
    const res = await H.call(wx, apis, 'getVisitStats', { days: 7 });
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.total, 4, '匿名行与测试账号不参与统计');
    H.eq(sc.accounts, 3);
    H.eq(sc.byName[0].name, '李学盈', '按最近登录排序');
    H.eq(sc.byName[0].visits, 2);
    H.eq(sc.byName[0].lastClient, '网页');
    H.eq(sc.byName[1].name, '王梓萱');
    H.eq(sc.byName[1].lastClient, '小程序');
    H.eq(sc.byName[2].name, '赵六');
    H.eq(sc.byName[2].lastClient, 'Windows');
    H.eq(sc.byDay.length, 7);
    H.eq(sc.byHour.length, 24);
    H.match(sc.rangeText, /^近 7 天/);
    H.eq(sc.pagePath, '/pages/stats/stats');
    H.eq(H.handoffOf(res).query, 'days=7');
    // 隐私/过滤：输出中不得有学号，也不得出现测试账号
    H.notIncludes(JSON.stringify(sc), SID, '统计不得出现学号');
    H.notIncludes(JSON.stringify(sc), '9000000001', '统计不得出现学号');
    H.notIncludes(JSON.stringify(sc), '测试账号', '统计不得出现测试账号');
    H.ok(H.lastRequest(wx, 'visits').url.indexOf('limit=5000') >= 0, '访问统计查询应限量');
  });

  await H.test('getVisitStats：days=30 与空结果', async function () {
    const fx = H.mkFixture();
    const wx = H.createWx({ storage: fx.storage, routes: visitRoutes(fx, []) });
    const { apis } = load(wx);
    const res = await H.call(wx, apis, 'getVisitStats', { days: 30 });
    H.isOk(res);
    H.eq(res.structuredContent.total, 0);
    H.eq(res.structuredContent.byDay.length, 30);
    H.match(res.structuredContent.rangeText, /^近 30 天/);
    H.includes(textOf(res), '还没有访问记录');
    H.eq(H.handoffOf(res).query, 'days=30');
  });

  await H.test('getVisitStats：非管理员 → forbidden；days 非法 → invalid-input', async function () {
    const fx = H.mkFixture({ identity: { is_admin: false, role: '', badge: '' } });
    const wx = H.createWx({ storage: fx.storage, routes: [] });
    const { apis } = load(wx);
    const res = await H.call(wx, apis, 'getVisitStats', { days: 7 });
    H.isErr(res, 'forbidden');
    H.includes(textOf(res), '管理员');
    H.eq(wx.calls.requests.length, 0);
    const s = start();
    const a = load(s.wx);
    H.isErr(await H.call(s.wx, a.apis, 'getVisitStats', { days: 15 }), 'invalid-input');
  });

  await H.test('getVisitStats：未认证 → identity-required', async function () {
    const s = start({ identity: false });
    const { apis } = load(s.wx);
    H.isErr(await H.call(s.wx, apis, 'getVisitStats', { days: 7 }), 'identity-required');
  });

  /* ================= 跨接口联调 + 组件静态检查 ================= */
  await H.test('联调：syncNow 后 getSyncStatus 显示上次同步时间', async function () {
    const fx = H.mkFixture();
    const routes = tableRoutes(fx);
    const wx = H.createWx({ storage: fx.storage, routes: routes });
    const { apis } = load(wx);
    const a = await H.call(wx, apis, 'syncNow', {});
    H.eq(a.structuredContent.ok, true);
    const b = await H.call(wx, apis, 'getSyncStatus', {});
    H.isOk(b);
    H.ok(b.structuredContent.lastSyncText.length >= 16, '应显示 YYYY-MM-DD HH:mm: ' + b.structuredContent.lastSyncText);
  });

  await H.test('原子组件：4 个卡片四件套齐全，监听 Result 且调用 setRelatedPage', function () {
    const fs = require('fs');
    const path = require('path');
    const dir = path.resolve(__dirname, '..', SKILL, 'components');
    const cards = ['sync-card', 'data-card', 'feedback-card', 'stats-card'];
    cards.forEach(function (name) {
      ['index.js', 'index.json', 'index.wxml', 'index.wxss'].forEach(function (f) {
        H.ok(fs.existsSync(path.join(dir, name, f)), name + ' 缺少 ' + f);
      });
      const js = fs.readFileSync(path.join(dir, name, 'index.js'), 'utf8');
      H.includes(js, 'NotificationType', name + ' 未使用 NotificationType');
      H.includes(js, 'setRelatedPage', name + ' 未调用 setRelatedPage');
      H.includes(js, 'Component(', name + ' 必须用 Component()');
      const json = JSON.parse(fs.readFileSync(path.join(dir, name, 'index.json'), 'utf8'));
      H.eq(json.component, true, name + ' index.json 必须 component:true');
      const wxml = fs.readFileSync(path.join(dir, name, 'index.wxml'), 'utf8');
      H.ok(wxml.indexOf('bindtap') >= 0 || name !== 'sync-card', name + ' sync-card 应有同步按钮');
      const wxss = fs.readFileSync(path.join(dir, name, 'index.wxss'), 'utf8');
      H.ok(wxss.indexOf('animation') < 0 && wxss.indexOf('transition') < 0, name + ' wxss 不得含动画');
      H.ok(wxss.indexOf('overflow-y') < 0, name + ' wxss 不得含 overflow-y');
      H.includes(wxss, 'prefers-color-scheme', name + ' wxss 缺暗色适配');
    });
  });

  const out = H.report('account');
  process.exitCode = out.ok ? 0 : 1;
})().catch(function (e) {
  console.error('ACCOUNT UNIT CRASH', e && (e.stack || e));
  process.exitCode = 1;
});
