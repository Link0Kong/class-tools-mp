/* ai_unit_identity.js —— identity SKILL 原子接口单元测试（CONTRACT §8.2）
 *
 * 运行：cd mp-class-tools-tests && node ai_unit_identity.js
 * 基座：_ai_harness.js（mock wx / modelContext / storage / rest 路由；不触网）
 *
 * 覆盖：8 个原子接口 × 成功 / 空结果或错误分支 / 入参校验；
 *       未认证 identity-required；写操作（verifyClassIdentity）请求体与 public 头；
 *       handoff query/payload；返回结构（H.call 自动校验 CONTRACT §4）。
 */
'use strict';
const H = require('./_ai_harness.js');

const SKILL = 'ai/skills/identity';

function start(over, routes) {
  const fx = H.mkFixture(over || {});
  const rs = (routes === undefined) ? basicRoutes(fx) : routes;
  const wx = H.createWx({ storage: fx.storage, routes: rs });
  return { fx: fx, wx: wx };
}
function load(wx) { return H.loadSkill(wx, SKILL); }
function basicRoutes(fx) {
  return [
    { url: 'rpc/class_verify', method: 'POST', handler: function (req) {
      const d = req.data || {};
      if (d.p_sid === '3260799999' && d.p_name === '测试账号') {
        return { statusCode: 200, data: { ok: true, token: 'tok-verified', sid: d.p_sid, name: d.p_name, role: '副团支书', badge: '班委', is_admin: true } };
      }
      return { statusCode: 200, data: { ok: false, reason: '姓名或学号不在班级名单中' } };
    } },
    { url: 'rpc/class_members', method: 'POST', data: function () { return fx.MEMBERS; } },
    { url: 'notices', method: 'GET', data: function () { return fx.NOTICE_ROWS; } },
    { url: 'homework', method: 'GET', data: function () { return fx.HOMEWORK; } },
    { url: 'tt.json', method: 'GET', data: function () { return { c: fx.TT.c, t: fx.TT.t }; } }
  ];
}
function textOf(res) { return (res.content || []).map(function (c) { return c.text; }).join(' '); }

(async function main() {
  /* ================= getMyProfile ================= */
  await H.test('getMyProfile：成功返回身份卡 + pagePath(me) + handoff', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'getMyProfile', {});
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.verified, true);
    H.eq(sc.name, '测试账号');
    H.eq(sc.role, '副团支书');
    H.eq(sc.badge, '班委');
    H.eq(sc.isAdmin, true);
    H.eq(sc.memberCount, 8);
    H.eq(sc.pagePath, '/pages/me/me');
    const h = H.handoffOf(res);
    H.eq(h.query, '');
    H.eq(typeof h.payload, 'object');
    H.eq(s.wx.calls.requests.length, 0, '纯本机读取，不发请求');
  });

  await H.test('getMyProfile：未认证 → identity-required + handoff 到身份页', async function () {
    const s = start({ identity: false });
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'getMyProfile', {});
    H.isErr(res, 'identity-required');
    H.includes(textOf(res), '身份验证');
    const h = H.handoffOf(res);
    H.eq(h.query, '');
    H.eq(h.payload.reason, 'identity-required');
  });

  await H.test('getMyProfile：成功返回 content 为中文事实+动作（≤300 字）', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'getMyProfile', {});
    H.ok(textOf(res).length > 0 && textOf(res).length <= 300, 'content 长度异常: ' + textOf(res).length);
    H.includes(textOf(res), '测试账号');
  });

  /* ================= verifyClassIdentity ================= */
  await H.test('verifyClassIdentity：成功 → 保存身份 + 同步名单 + 请求体/public 头正确', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'verifyClassIdentity', { sid: '3260799999', name: ' 测试账号 ' });
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.verified, true);
    H.eq(sc.membersSynced, true);
    H.eq(sc.memberCount, 8);
    H.eq(sc.isAdmin, true);
    H.eq(sc.pagePath, '/pages/index/index');
    H.eq(H.handoffOf(res).payload.verified, true);
    const req = H.lastRequest(s.wx, 'rpc/class_verify');
    H.deepEq(req.data, { p_sid: '3260799999', p_name: '测试账号' }, '验证请求体');
    H.eq(req.method, 'POST');
    H.eq(req.header['X-Class-Token'], undefined, 'public 请求不带身份 token');
    H.ok(req.header.Authorization, 'public 请求带 publishable key');
    const saved = JSON.parse(s.wx.getStorageSync('zq_class_identity'));
    H.eq(saved.name, '测试账号');
    H.eq(saved.token, 'tok-verified');
    H.eq(H.lastRequest(s.wx, 'rpc/class_members').method, 'POST');
  });

  await H.test('verifyClassIdentity：学号格式错误 → invalid-input，且不发请求', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'verifyClassIdentity', { sid: '12345', name: '测试账号' });
    H.isErr(res, 'invalid-input');
    H.includes(textOf(res), '10 位');
    H.eq(s.wx.calls.requests.length, 0);
  });

  await H.test('verifyClassIdentity：缺姓名 → invalid-input', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'verifyClassIdentity', { sid: '3260799999', name: '   ' });
    H.isErr(res, 'invalid-input');
    H.eq(s.wx.calls.requests.length, 0);
  });

  await H.test('verifyClassIdentity：名单不匹配 → verify-failed 并给出原因', async function () {
    const s = start({ identity: false });
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'verifyClassIdentity', { sid: '9999000099', name: '不存在' });
    H.isErr(res, 'verify-failed');
    H.includes(textOf(res), '不在班级名单中');
    H.eq(s.wx.getStorageSync('zq_class_identity'), '', '验证失败不保存身份');
  });

  await H.test('verifyClassIdentity：网络失败 → network/timeout 错误且不保存身份', async function () {
    const s = start({ identity: false }, [
      { url: 'rpc/class_verify', method: 'POST', fail: 'request:fail timeout' }
    ]);
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'verifyClassIdentity', { sid: '3260799999', name: '测试账号' });
    H.isErr(res, 'timeout');
    H.includes(textOf(res), '网络');
    H.eq(s.wx.getStorageSync('zq_class_identity'), '');
  });

  await H.test('verifyClassIdentity：名单同步失败不影响验证成功（membersSynced=false）', async function () {
    const s = start({}, [
      { url: 'rpc/class_verify', method: 'POST', data: { ok: true, token: 'tok-2', sid: '3260799999', name: '测试账号', role: '', badge: '', is_admin: false } },
      { url: 'rpc/class_members', method: 'POST', fail: 'request:fail mock' }
    ]);
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'verifyClassIdentity', { sid: '3260799999', name: '测试账号' });
    H.isOk(res);
    H.eq(res.structuredContent.verified, true);
    H.eq(res.structuredContent.membersSynced, false);
    H.includes(textOf(res), '名单稍后同步');
  });

  /* ================= listClassMembers ================= */
  await H.test('listClassMembers：成功 → total/分页/不含学号 + pagePath(committee)', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'listClassMembers', {});
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.total, 8);
    H.eq(sc.page, 1);
    H.eq(sc.pageSize, 20);
    H.eq(sc.items.length, 8);
    H.eq(sc.items[0].seat, 1);
    H.eq(sc.items[0].name, '测试甲');
    H.eq(sc.pagePath, '/pages/committee/committee');
    sc.items.forEach(function (it) { H.eq(it.sid, undefined, 'items 不得包含学号'); });
    H.eq(H.handoffOf(res).query, '');
  });

  await H.test('listClassMembers：roleOnly=true → 只返回班委且 handoff query=roleOnly=1', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'listClassMembers', { roleOnly: true });
    H.isOk(res);
    H.eq(res.structuredContent.total, 4);
    res.structuredContent.items.forEach(function (it) { H.ok(it.role, '班委应带 role: ' + JSON.stringify(it)); });
    H.eq(H.handoffOf(res).query, 'roleOnly=1');
    H.eq(res.structuredContent.items[0].name, '测试乙');
  });

  await H.test('listClassMembers：keyword 过滤 + page/pageSize 分页', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const filtered = await H.call(s.wx, apis, 'listClassMembers', { keyword: '委员' });
    H.eq(filtered.structuredContent.total, 2);
    const paged = await H.call(s.wx, apis, 'listClassMembers', { page: 2, pageSize: 3 });
    H.eq(paged.structuredContent.total, 8);
    H.eq(paged.structuredContent.items.length, 3);
    H.eq(paged.structuredContent.items[0].seat, 12);
    const empty = await H.call(s.wx, apis, 'listClassMembers', { page: 99 });
    H.isOk(empty);
    H.eq(empty.structuredContent.items.length, 0);
    H.eq(empty.structuredContent.total, 8);
    H.includes(textOf(empty), '没有查到第 99 页');
    const miss = await H.call(s.wx, apis, 'listClassMembers', { keyword: '不存在的名字' });
    H.includes(textOf(miss), '没有查到匹配');
  });

  await H.test('listClassMembers：pageSize 超上限钳制到 50；keyword 过长 invalid-input', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'listClassMembers', { pageSize: 999 });
    H.eq(res.structuredContent.pageSize, 50);
    const bad = await H.call(s.wx, apis, 'listClassMembers', { keyword: '一二三四五六七八九十一二三四五六七八九十一' });
    H.isErr(bad, 'invalid-input');
  });

  await H.test('listClassMembers：名单缓存为空且云端无数据 → 空结果（非 isError）', async function () {
    const s = start({ patch: function (fx) { fx.STORE.classMembers = []; } }, [
      { url: 'rpc/class_members', method: 'POST', data: [] }
    ]);
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'listClassMembers', {});
    H.isOk(res);
    H.eq(res.structuredContent.total, 0);
    H.includes(textOf(res), '名单');
  });

  await H.test('listClassMembers：未认证 → identity-required', async function () {
    const s = start({ identity: false });
    const { apis } = load(s.wx);
    H.isErr(await H.call(s.wx, apis, 'listClassMembers', {}), 'identity-required');
  });

  /* ================= getCommittee ================= */
  await H.test('getCommittee：成功 → 仅班委、管理员优先、按座号排序', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'getCommittee', {});
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.total, 4);
    H.eq(sc.items[0].name, '测试账号');
    H.eq(sc.items[0].role, '副团支书');
    H.eq(sc.pagePath, '/pages/committee/committee');
    H.eq(H.handoffOf(res).query, 'roleOnly=1');
    H.includes(textOf(res), '班委');
  });

  await H.test('getCommittee：名单为空且云端无数据 → 空结果 + 引导', async function () {
    const s = start({ patch: function (fx) { fx.STORE.classMembers = []; } }, [
      { url: 'rpc/class_members', method: 'POST', data: [] }
    ]);
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'getCommittee', {});
    H.isOk(res);
    H.eq(res.structuredContent.total, 0);
    H.includes(textOf(res), '还没有班级名单缓存');
  });

  await H.test('getCommittee：未认证 → identity-required', async function () {
    const s = start({ identity: false });
    const { apis } = load(s.wx);
    H.isErr(await H.call(s.wx, apis, 'getCommittee', {}), 'identity-required');
  });

  /* ================= getMyOverview ================= */
  await H.test('getMyOverview：成功 → 四项指标与主包 pages/me 口径一致', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'getMyOverview', {});
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.pendingHomework, 4);
    H.eq(sc.doneHomework, 1);
    H.eq(sc.drawRecords, 4);
    H.eq(sc.fitnessRecords, 2);
    H.eq(sc.pagePath, '/pages/me/me');
    H.eq(s.wx.calls.requests.length, 0, '纯本机计算');
  });

  await H.test('getMyOverview：未认证 → identity-required', async function () {
    const s = start({ identity: false });
    const { apis } = load(s.wx);
    H.isErr(await H.call(s.wx, apis, 'getMyOverview', {}), 'identity-required');
  });

  await H.test('getMyOverview：空数据 → 全 0 且仍成功', async function () {
    const s = start({ patch: function (fx) { fx.STORE.homework = []; fx.STORE.fitRecs = []; } });
    s.wx.setStorageSync('zq_flow', { draw: null, group: null, updatedAt: 0 });
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'getMyOverview', {});
    H.isOk(res);
    H.eq(res.structuredContent.pendingHomework, 0);
    H.eq(res.structuredContent.doneHomework, 0);
    H.eq(res.structuredContent.drawRecords, 0);
    H.eq(res.structuredContent.fitnessRecords, 0);
  });

  /* ================= getToolsDirectory ================= */
  await H.test('getToolsDirectory：管理员 → 9 个工具含统计 + 首页快捷 4 个', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'getToolsDirectory', {});
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.homeTools.length, 4);
    H.eq(sc.all.length, 9);
    H.eq(sc.pagePath, '/pages/all/all');
    const stats = sc.all.filter(function (t) { return t.key === 'stats'; })[0];
    H.ok(stats, '管理员应能看到统计工具');
    H.eq(typeof stats.cat, 'string');
    H.eq(typeof stats.desc, 'string');
    H.eq(sc.homeTools[0].key, 'tt', 'store 默认 homeTools 属旧版顺序，会迁移到默认目录顺序（主包 tools 同逻辑）');
  });

  await H.test('getToolsDirectory：非管理员 → 不含统计；未认证也可用', async function () {
    const s = start({ identity: { is_admin: false, role: '', badge: '' } });
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'getToolsDirectory', {});
    H.isOk(res);
    H.eq(res.structuredContent.all.length, 8);
    H.eq(res.structuredContent.all.filter(function (t) { return t.key === 'stats'; }).length, 0);
  });

  await H.test('getToolsDirectory：未认证（无身份）→ 仍可用且不含管理员工具', async function () {
    const s = start({ identity: false });
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'getToolsDirectory', {});
    H.isOk(res);
    H.eq(res.structuredContent.all.length, 8);
    H.eq(res.structuredContent.pagePath, '/pages/all/all');
  });

  /* ================= getUsageGuide ================= */
  await H.test('getUsageGuide：section=all → 15 节；无需身份', async function () {
    const s = start({ identity: false });
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'getUsageGuide', { section: 'all' });
    H.isOk(res);
    H.eq(res.structuredContent.sections.length, 15);
    H.eq(res.structuredContent.sections[0].title, '① 班级身份');
    H.eq(res.structuredContent.pagePath, '/pages/ug/ug');
    H.eq(H.handoffOf(res).query, '');
  });

  await H.test('getUsageGuide：section=identity/sync 只返回对应章节', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const id = await H.call(s.wx, apis, 'getUsageGuide', { section: 'identity' });
    H.eq(id.structuredContent.sections.length, 1);
    H.includes(id.structuredContent.sections[0].title, '身份');
    const sync = await H.call(s.wx, apis, 'getUsageGuide', { section: 'sync' });
    H.eq(sync.structuredContent.sections.length, 1);
    H.includes(sync.structuredContent.sections[0].content, '云同步');
  });

  await H.test('getUsageGuide：非法 section → invalid-input', async function () {
    const s = start();
    const { apis } = load(s.wx);
    H.isErr(await H.call(s.wx, apis, 'getUsageGuide', { section: 'nope' }), 'invalid-input');
  });

  /* ================= getWorkspaceOverview ================= */
  await H.test('getWorkspaceOverview：成功 → 周次/今日课程/作业/通知/首页快捷', async function () {
    const s = start();
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'getWorkspaceOverview', {});
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.week, 9, '夹具今天 = 第 9 周');
    /* 夹具 TT 的「今日课程」随真实星期几变化（避免周几不同导致测试腐化）：
       期望 = 夹具中 day=今天 的课程按开始节次排序 */
    const dow = (new Date().getDay() + 6) % 7;
    const expToday = s.fx.TT.c.filter(function (c) { return c.day === dow; })
      .sort(function (a, b) { return a.start - b.start; })
      .map(function (c) { return c.name; });
    H.deepEq(sc.todayCourses.map(function (c) { return c.name; }), expToday, '今日课程 = 夹具中今天的课（按开始节次）');
    H.eq(sc.hwPending, 4);
    H.eq(sc.hwMostUrgent.id, 'hw_003', '按截止时间排序：最早截止（已过期 2 天）的最紧');
    H.eq(sc.hwMostUrgent.subject, '程序设计基础');
    H.includes(sc.hwMostUrgent.left, '已过期');
    H.eq(sc.ntPending, 2, 'ntg_002 未处理 + ntg_004 无时间未处理；ntg_001 已处理、ntg_003 已截止');
    H.eq(sc.ntMostUrgent.id, 'ntg_002');
    H.eq(sc.homeTools.length, 4);
    H.eq(sc.pagePath, '/pages/index/index');
    const h = H.handoffOf(res);
    H.eq(h.payload.week, 9);
    H.ok(H.lastRequest(s.wx, 'notices'), '应从云端拉通知组（本机 store 无 auto groups）');
    H.includes(textOf(res), '第 9 周');
  });

  await H.test('getWorkspaceOverview：通知拉取失败 → 仍成功，说明通知数量未统计', async function () {
    const s = start({}, [
      { url: 'notices', method: 'GET', fail: 'request:fail mock' }
    ]);
    const { apis } = load(s.wx);
    const res = await H.call(s.wx, apis, 'getWorkspaceOverview', {});
    H.isOk(res);
    H.eq(res.structuredContent.ntPending, 0);
    H.includes(textOf(res), '通知数据暂时无法同步');
  });

  await H.test('getWorkspaceOverview：未认证 → identity-required', async function () {
    const s = start({ identity: false });
    const { apis } = load(s.wx);
    H.isErr(await H.call(s.wx, apis, 'getWorkspaceOverview', {}), 'identity-required');
  });

  /* ================= 组件静态检查（组件目录四件套 + Result 监听 + setRelatedPage） ================= */
  await H.test('原子组件：5 个卡片四件套齐全，监听 Result 且调用 setRelatedPage', function () {
    const fs = require('fs');
    const path = require('path');
    const dir = path.resolve(__dirname, '..', SKILL, 'components');
    const cards = ['profile-card', 'roster-card', 'overview-card', 'tools-card', 'workspace-card'];
    cards.forEach(function (name) {
      ['index.js', 'index.json', 'index.wxml', 'index.wxss'].forEach(function (f) {
        H.ok(fs.existsSync(path.join(dir, name, f)), name + ' 缺少 ' + f);
      });
      const js = fs.readFileSync(path.join(dir, name, 'index.js'), 'utf8');
      H.includes(js, 'NotificationType', name + ' 未使用 NotificationType');
      H.includes(js, 'Result', name + ' 未监听 Result');
      H.includes(js, 'setRelatedPage', name + ' 未调用 setRelatedPage');
      H.includes(js, 'Component(', name + ' 必须用 Component()');
      const json = JSON.parse(fs.readFileSync(path.join(dir, name, 'index.json'), 'utf8'));
      H.eq(json.component, true, name + ' index.json 必须 component:true');
      const wxss = fs.readFileSync(path.join(dir, name, 'index.wxss'), 'utf8');
      H.ok(wxss.indexOf('animation') < 0 && wxss.indexOf('transition') < 0, name + ' wxss 不得含动画');
      H.ok(wxss.indexOf('overflow-y') < 0, name + ' wxss 不得含 overflow-y');
      H.includes(wxss, 'prefers-color-scheme', name + ' wxss 缺暗色适配');
    });
  });

  const out = H.report('identity');
  process.exitCode = out.ok ? 0 : 1;
})().catch(function (e) {
  console.error('IDENTITY UNIT CRASH', e && (e.stack || e));
  process.exitCode = 1;
});
