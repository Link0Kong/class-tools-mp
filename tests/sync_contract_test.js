/* sync_contract_test.js —— 用户数据同步 v6 跨端契约测试（小程序端）
 *
 * 运行：node sync_contract_test.js
 * 依赖：仅 Node 内置模块 + wx 内存 mock；绝不访问真实云端（wx.request 全部被 mock 接管）。
 *
 * 覆盖（_sync_task/CONTRACT.md §3 / §5）：
 *   1) mergeUd 与 fixtures/merge_ref.js 的输出逐字节一致（web↔mp 双向 + v5 迁移 + 幂等）；
 *   2) marks kind='ntdone'：读取应用 / upsert body 契约 / 失败进待补发 / cloudOff 入队；
 *   3) 远端 v6 blob 应用到 store 各 section（含 mp 不拥有的 tt 其余字段 / nick 保留语义）；
 *   4) 本机改动 → 脏检测防抖 1200ms → push body 契约（at 提升、未拥有 section 原样、顶层镜像）；
 *   5) cloudOff：不拉不推、marks 入队；恢复后补推并拉一次；
 *   6) 隐私模块纯逻辑：导出 JSON（不含 token / 学号 / 名单原文）、空 v6 blob、marks 置否行、清除云端；
 *   7) 首进无基线 / 远端 v5 迁移 / 幂等 push（无差异不发 POST）。
 *
 * 夹具：`_sync_fixtures/`（= _sync_task/fixtures 的副本；契约要求两端测试加载同一份夹具）。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');
const FIX = path.join(__dirname, '_sync_fixtures');
const results = [];
let passN = 0, failN = 0;

async function test(name, fn) {
  try { await fn(); passN++; results.push({ name, ok: true }); console.log('PASS  ' + name); }
  catch (e) { failN++; results.push({ name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function readJson(n) { return JSON.parse(fs.readFileSync(path.join(FIX, n), 'utf8')); }
function readText(n) { return fs.readFileSync(path.join(FIX, n), 'utf8'); }
const WEB = readJson('userdata_v6_web.json');
const MP = readJson('userdata_v6_mp.json');
const V5 = readJson('legacy_v5.json');
const MARKS = readJson('marks_ntdone_rows.json');
const SECTION_KEYS = ['homeTools', 'fit', 'draw', 'group', 'roster', 'hide', 'tt', 'prefs', 'nick', 'power', 'water'];

/* ---------------- wx mock（内存 storage + 可注入 request） ---------------- */
const mem = Object.create(null);
let reqLog = [];
let reqImpl = (o) => o.success({ statusCode: 200, data: [] });
let toastLog = [];
let modalLog = [];
let clipLog = [];
global.wx = {
  getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
  setStorageSync(k, v) { mem[k] = v; },
  removeStorageSync(k) { delete mem[k]; },
  getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 9, limitSize: 10240 }; },
  getAccountInfoSync() { return { miniProgram: { version: '1.4.6' } }; },
  request(o) { reqLog.push(o); reqImpl(o); },
  showToast(o) { toastLog.push(o && o.title); },
  showModal(o) { modalLog.push(o); if (o && o.success) o.success({ confirm: true }); },
  setClipboardData(o) { clipLog.push(o && o.data); if (o && o.success) o.success(); },
  navigateTo() {}, switchTab() {}, reLaunch() {}, showShareMenu() {},
  onThemeChange() {}, offThemeChange() {}
};

const ID = { token: 'tok-sync-1', sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: true, ts: 1 };
const ID2 = { token: 'tok-sync-2', sid: '9999000004', name: '测试辛', role: '', badge: '', is_admin: false, ts: 2 };
const MEMBERS = [
  { seat: 1, sid: '9999000001', name: '测试甲', role: '', badge: '', is_admin: false },
  { seat: 24, sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: true },
  { seat: 26, sid: '9999000004', name: '测试辛', role: '', badge: '', is_admin: false }
];

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
    identity: require(path.join(ROOT, 'utils/identity.js')),
    cloud: require(path.join(ROOT, 'utils/cloud.js')),
    privacy: require(path.join(ROOT, 'utils/privacy.js')),
    notice: require(path.join(ROOT, 'utils/notice.js'))
  };
}
function clearMem() {
  Object.keys(mem).forEach((k) => delete mem[k]);
  reqLog = []; clipLog = []; toastLog = []; modalLog = [];
  reqImpl = ok([]);
}
function ok(data) { return (o) => o.success({ statusCode: 200, data: data === undefined ? [] : data }); }
function failReq(o) { o.fail({ errMsg: 'request:fail mock' }); }
function setIdentity(id) { mem['zq_class_identity'] = JSON.stringify(id || ID); }
function urlOf(o) { return String((o && o.url) || ''); }
function reqsOf(frag) { return reqLog.filter((o) => urlOf(o).indexOf(frag) >= 0); }
function postsTo(frag) { return reqLog.filter((o) => o.method === 'POST' && urlOf(o).indexOf(frag) >= 0); }
function cloudFresh() {
  const m = fresh();
  clearMem();
  m.cloud.configure({
    enabled: true,
    restBase: 'https://mock.test/v1/rdb/rest/',
    publishableKey: 'pub',
    ttUrl: 'https://static.test/tt.json',
    timeout: 1000,
    rpc: { verify: 'rpc/class_verify', members: 'rpc/class_members' }
  });
  return m;
}
function seedClassMembers(store) {
  store.get().classMembers = MEMBERS.slice();
  store.get().classRoster = MEMBERS.map((m) => m.seat + ' ' + m.name).join('\n');
  store.save();
}
// 页模块加载（不启动模拟器）
function loadPage(rel) {
  let def = null;
  global.Page = (d) => { def = d; };
  try { require(path.join(ROOT, rel)); } finally { delete global.Page; }
  assert.ok(def, rel + ' 未注册 Page');
  return def;
}

(async function main() {
  /* ============================================================
     1. 合并算法（契约 oracle：fixtures/merge_ref.js 生成的三份期望输出）
     ============================================================ */
  await test('合并：web↔mp 双向 + v5 迁移与 fixtures 期望输出逐字节一致', () => {
    const { cloud } = fresh();
    clearMem();
    const norm = (o) => JSON.stringify(o, null, 2) + '\n';
    assert.strictEqual(norm(cloud.mergeUd(MP, WEB)), readText('expected_merge_web_mp.json'), 'merge(mp remote, web local) 与 oracle 不一致');
    assert.strictEqual(norm(cloud.mergeUd(WEB, MP)), readText('expected_merge_mp_web.json'), 'merge(web remote, mp local) 与 oracle 不一致');
    assert.strictEqual(norm(cloud.mergeUd(V5, { at: {}, fit: { sex: 'm' } })), readText('expected_v5_migrate.json'), 'v5 迁移与 oracle 不一致');
  });

  await test('合并：键顺序固定（v/at/11 section/homeToolsAt，含 power/water）、幂等、缺数据回默认', () => {
    const { cloud } = fresh();
    clearMem();
    const m = cloud.mergeUd(MP, WEB);
    assert.deepStrictEqual(Object.keys(m), ['v', 'at'].concat(SECTION_KEYS).concat(['homeToolsAt']));
    assert.deepStrictEqual(Object.keys(m.at), SECTION_KEYS);
    assert.strictEqual(m.v, 6);
    assert.strictEqual(m.homeToolsAt, m.at.homeTools);
    // 幂等：合并结果再与同一 remote/本地合并，输出不变
    assert.strictEqual(JSON.stringify(cloud.mergeUd(MP, m)), JSON.stringify(m));
    assert.strictEqual(JSON.stringify(cloud.mergeUd(m, {})), JSON.stringify(m));
    // 坏 JSON / 缺字段 → 不会抛错，回退默认
    const d = cloud.mergeUd(null, null);
    assert.strictEqual(d.v, 6);
    assert.deepStrictEqual(d.homeTools, []);
    assert.deepStrictEqual(d.roster, { rosterSel: [], rollSel: [], rollSt: {}, rollNames: '' });
    assert.strictEqual(d.tt.termStart, '');
    assert.strictEqual(d.nick, '');
    // tie-break：远端赢（ra >= la）
    const tie = cloud.mergeUd({ v: 6, at: { nick: 5 }, nick: 'cloud' }, { at: { nick: 5 }, nick: 'local' });
    assert.strictEqual(tie.nick, 'cloud', '时间戳相同应云端赢');
  });

  /* ============================================================
     2. marks：kind='ntdone'（通知已处理）
     ============================================================ */
  await test('marks：fixture 行读取 → store.ntDone（true/false），hw/nt 同步应用，仅查本人 seat', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    reqImpl = (o) => {
      if (urlOf(o).indexOf('/marks?') >= 0) return ok(MARKS)(o);
      return ok([])(o);
    };
    await cloud.marksPull(true);
    const get = reqLog.find((o) => urlOf(o).indexOf('/marks?') >= 0 && o.method === 'GET');
    assert.ok(get, '未发 marks GET');
    assert.ok(urlOf(get).indexOf('seat=eq.' + ID.sid) >= 0, 'marks 必须只查本人 seat');
    assert.strictEqual(store.get().ntDone.auto_g_testA, true, 'val=true 的 ntdone 组应进入 store.ntDone');
    assert.strictEqual(store.get().ntDone.auto_g_testB, false, 'val=false 的 ntdone 组应记录为未处理');
    assert.strictEqual(store.get().hwDone.hw_test1, true);
    assert.strictEqual(store.get().ntPin.notice_test1, true);
  });

  await test('marks：setMark(ntdone) upsert body/id/标题契约；失败进待补发；cloudOff 入队零请求', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    reqImpl = ok([]);
    assert.strictEqual(await cloud.setMark('ntdone', 'auto_g_x', true), true);
    const post = postsTo('/marks')[0];
    assert.ok(post, '未发 marks POST');
    assert.ok(/resolution=merge-duplicates/.test(String(post.header.Prefer || '')), '写 marks 必须 merge-duplicates upsert');
    assert.deepStrictEqual(post.data[0], {
      id: ID.sid + '|ntdone|auto_g_x', seat: ID.sid, kind: 'ntdone', ref: 'auto_g_x', val: true, ts: post.data[0].ts
    });
    assert.ok(post.data[0].ts > 0);
    assert.strictEqual(store.get().ntDone.auto_g_x, true, '本机应已生效');
    assert.strictEqual(cloud.pendCount(), 0);
    // 失败 → 待补发队列
    reqImpl = failReq;
    assert.strictEqual(await cloud.setMark('ntdone', 'auto_g_y', true), false);
    assert.ok((store.get().markPend || []).some((p) => p.kind === 'ntdone' && p.ref === 'auto_g_y'), '失败应进 markPend');
    // cloudOff → 本地生效 + 入队，不发请求
    reqLog = [];
    store.get().cloudOff = true;
    store.save();
    assert.strictEqual(await cloud.setMark('ntdone', 'auto_g_z', false), false);
    assert.strictEqual(store.get().ntDone.auto_g_z, false);
    assert.strictEqual(reqLog.length, 0, 'cloudOff 时 marks 写入不应发请求');
    assert.ok((store.get().markPend || []).some((p) => p.ref === 'auto_g_z'), 'cloudOff 时 marks 写入应入队');
    cloud.udStop();
  });

  await test('通知页：toggleDone 写 store.ntDone + marks ntdone；再次点击恢复', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    reqImpl = ok([]);
    const def = loadPage('pages/nt/nt.js');
    const ctx = {
      data: { cards: [], expiredCards: [], filter: 'active' },
      _raw: [{ id: 'auto_g_page', title: '测试通知', items: [] }],
      _all: [], _expanded: {}, _done: {}, _imgs: {}, _loadingImgs: {},
      _rawById: def._rawById,
      _cardById: def._cardById,
      _briefNextOf: def._briefNextOf,
      applyFilter() { this._filtered = (this._filtered || 0) + 1; },
      setData(o, cb) { Object.assign(this.data, o); if (cb) cb(); }
    };
    def.toggleDone.call(ctx, { currentTarget: { dataset: { gid: 'auto_g_page' } } });
    await sleep(10);
    assert.strictEqual(store.get().ntDone.auto_g_page, true, '标记已处理应持久化到 store.ntDone');
    const post = postsTo('/marks')[0];
    assert.ok(post, '未发 marks POST');
    assert.strictEqual(post.data[0].kind, 'ntdone');
    assert.strictEqual(post.data[0].id, ID.sid + '|ntdone|auto_g_page');
    assert.ok(ctx._filtered >= 1, '应重绘筛选');
    def.toggleDone.call(ctx, { currentTarget: { dataset: { gid: 'auto_g_page' } } });
    await sleep(10);
    assert.strictEqual(store.get().ntDone.auto_g_page, false, '再次点击应恢复为待处理');
    assert.strictEqual(postsTo('/marks').length, 2, '恢复也应写云端 val=false');
    cloud.udStop();
  });

  /* ============================================================
     3. 远端 v6 → 本机应用
     ============================================================ */
  await test('应用：web 写出的 v6 blob → store 各 section（含词汇映射、派生名单、autoRe 保留）', () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    seedClassMembers(store);
    store.get().draw.autoRe = false;             // mp 独有字段，不应被同步覆盖
    store.save();
    assert.strictEqual(cloud.udApply(WEB), true);
    const d = store.get();
    assert.deepStrictEqual(d.homeTools, WEB.homeTools, 'homeTools 应完整应用（v2.0.0：≤4 勾选集合，不保留本机第 5+ 位尾序）');
    assert.strictEqual(d.fit.sex, 'f');
    assert.strictEqual(d.fit.h, '165');
    assert.strictEqual(d.draw.end, 60);
    assert.strictEqual(d.draw.count, 8);
    assert.strictEqual(d.draw.dup, true);
    assert.strictEqual(d.draw.excl, '3,7');
    assert.strictEqual(d.draw.sort, 'desc');
    // 2026-11-12 抽签升级 v1：draw.names（自定义序号名称映射）随 draw section 应用（不新增顶层键）
    assert.strictEqual(d.draw.names, WEB.draw.names, 'draw.names 应从云端 draw section 应用');
    assert.strictEqual(d.draw.autoRe, false, '本机独有 autoRe 不应被覆盖');
    // 网页词汇 → 小程序词汇
    assert.strictEqual(d.group.source, 'pick', 'source=names → pick');
    assert.strictEqual(d.group.mode, 'per', 'mode=pergroup → per');
    assert.strictEqual(d.group.n, 3);
    assert.strictEqual(d.group.shuffle, true);
    assert.deepStrictEqual(d.group.sel, [1, 2, 3, 4, 5, 6]);
    assert.deepStrictEqual(d.rosterSel, [1, 2, 3, 4, 5]);
    assert.deepStrictEqual(d.rollSel, [6, 7, 8]);
    assert.deepStrictEqual(d.rollSt, { 0: '到', 1: '假' });
    assert.strictEqual(d.rollNames, WEB.roster.rollNames);
    assert.deepStrictEqual(d.hwHide, { hw_x: true });
    assert.deepStrictEqual(d.ntHide, { nt_y: true });
    assert.strictEqual(d.termStart, '2026-08-31');
    assert.strictEqual(d.ntSub, true);
    assert.strictEqual(d.ntSubAt, 1762290000000);
    // 派生文本按本机 classMembers 重建（不覆盖同步 section 本身）
    assert.ok(d.roster.indexOf('测试甲') >= 0, '抽签派生名单文本应按 classMembers 重建');
    // 基线 = 合并结果
    assert.strictEqual(d.udCache.v, 6);
    assert.strictEqual(d.nick, undefined, 'mp store 没有 nick 字段（网页端字段）');
  });

  await test('homeTools：draw 与 group 是两个独立 key（不再把 group 映射成 draw）', () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    seedClassMembers(store);
    const tools = require(path.join(ROOT, 'utils/tools.js'));
    const remote = JSON.parse(JSON.stringify(WEB));
    const at = Date.now() + 60000;
    remote.homeTools = ['draw', 'group', 'hw', 'nt'];
    remote.homeToolsAt = at;
    remote.at.homeTools = at;
    remote.prefs = Object.assign({}, remote.prefs, { toolOrder: ['draw', 'group', 'hw', 'nt', 'tt'] });
    remote.at.prefs = at;
    assert.strictEqual(cloud.udApply(remote), true);
    assert.deepStrictEqual(store.get().homeTools, ['draw', 'group', 'hw', 'nt'], '两个 key 都要保留');
    assert.strictEqual(tools.localKey('group'), 'group', '读云端不得把 group 归一到 draw');
    assert.strictEqual(tools.toolOf('group').url, '/pages/group/group');
    assert.deepStrictEqual(tools.toolOrder().slice(0, 5), ['draw', 'group', 'hw', 'nt', 'tt'], '云端顺序保留 group 独立位置');
    const view = cloud.udSections();
    assert.deepStrictEqual(view.homeTools, ['draw', 'group', 'hw', 'nt'], '写回云端 group 保持独立 key');
    // 小程序本机 key → 云端 canonical：只改 bz，不碰 group
    assert.deepStrictEqual(tools.toSyncKeys(['group', 'bz', 'draw']), ['group', 'committee', 'draw']);
    cloud.udStop();
  });

  await test('应用：v5 blob 也可直接应用（归一为 v6 基线）', () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    seedClassMembers(store);
    assert.strictEqual(cloud.udApply(V5), true);
    const d = store.get();
    assert.deepStrictEqual(d.homeTools.slice(0, 4), V5.homeTools.slice(0, 4));
    assert.strictEqual(d.fit.h, '170');
    assert.strictEqual(d.udCache.v, 6, '应用后基线应是 v6');
    assert.strictEqual(d.homeToolsAt, V5.homeToolsAt);
  });

  /* ============================================================
     4. 拉取 / 推送 / 防抖 / 幂等
     ============================================================ */
  await test('推送：本机改动 → at 提升，未拥有 section（tt 其余字段 / nick）原样保留，body 结构完整', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    seedClassMembers(store);
    cloud.udApply(WEB);                          // 先建立基线（模拟上一次同步）
    store.get().termStart = '2026-09-14';        // 本机独有的 tt 字段（只写 termStart）
    store.get().fit.h = '180';
    store.get().draw.count = 12;
    store.get().draw.names = '1 第一组\n2 第二组';   // 2026-11-12：名称映射随 draw section 同步
    store.save();
    assert.strictEqual(store.get().udPend, true, '有脏 section 时应置待补发标记');
    reqLog = [];
    reqImpl = (o) => {
      if (o.method === 'GET' && urlOf(o).indexOf('/userdata?') >= 0) return ok([{ id: ID.sid, blob: JSON.stringify(WEB) }])(o);
      return o.success({ statusCode: 201, data: [] });
    };
    const r = await cloud.udPush();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.pushed, true);
    assert.strictEqual(store.get().udPend, false, '推送成功应清待补发');
    const post = reqLog.find((o) => o.method === 'POST' && urlOf(o) === 'https://mock.test/v1/rdb/rest/userdata');
    assert.ok(post, '未发 userdata POST');
    assert.strictEqual(post.data[0].id, ID.sid, 'userdata id 必须是学号');
    assert.ok(/resolution=merge-duplicates/.test(String(post.header.Prefer || '')), 'userdata 必须 upsert');
    const body = JSON.parse(post.data[0].blob);
    assert.strictEqual(body.v, 6);
    assert.deepStrictEqual(Object.keys(body), ['v', 'at'].concat(SECTION_KEYS).concat(['homeToolsAt']));
    assert.deepStrictEqual(Object.keys(body.at), SECTION_KEYS);
    assert.strictEqual(body.homeToolsAt, body.at.homeTools, '顶层 homeToolsAt 镜像必须等于 at.homeTools');
    // 本机改动赢，且 at 被提升
    assert.strictEqual(body.tt.termStart, '2026-09-14');
    assert.ok(body.at.tt > WEB.at.tt, '本机改动的 section 时间戳应被提升');
    assert.strictEqual(body.fit.h, '180');
    assert.ok(body.at.fit > WEB.at.fit);
    assert.strictEqual(body.draw.count, 12);
    assert.strictEqual(body.draw.names, '1 第一组\n2 第二组', 'draw.names 应随 draw section 推送');
    assert.ok(body.at.draw > WEB.at.draw, 'draw 改动（含 names）应抬高 at.draw');
    // 未拥有 section 原样保留
    assert.strictEqual(body.tt.ttView, WEB.tt.ttView);
    assert.strictEqual(body.tt.ttUseMine, WEB.tt.ttUseMine);
    assert.deepStrictEqual(body.tt.ttLocal, WEB.tt.ttLocal);
    assert.strictEqual(body.nick, WEB.nick, 'mp 不写 nick，push 时必须原样保留云端昵称');
    // 未改动 section 保留云端值
    assert.deepStrictEqual(body.roster.rollSel, WEB.roster.rollSel);
    assert.deepStrictEqual(body.hide, WEB.hide);
    assert.deepStrictEqual(body.prefs, WEB.prefs);
    // power（v5）：值 {sel,at,low}；旧云端值无 low → 本机规范化 low=30 并视为改动（本地赢）
    assert.deepStrictEqual(body.power, { sel: WEB.power.sel, at: body.at.power, low: 30 });
    assert.ok(body.at.power > WEB.at.power, 'v5 补 low 后 power section 应更新（迁移旧值）');
    cloud.udStop();
  });

  await test('power（关注宿舍）：本机选择 → 14 键 blob / at 镜像 / 换端从云端恢复', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    seedClassMembers(store);
    cloud.udApply(WEB);                            // 建立基线（云端已有 WEB.power）
    reqLog = [];
    reqImpl = (o) => {
      if (o.method === 'GET' && urlOf(o).indexOf('/userdata?') >= 0) return ok([{ id: ID.sid, blob: JSON.stringify(WEB) }])(o);
      return o.success({ statusCode: 201, data: [] });
    };
    const at = Date.now();
    store.get().power = { sel: '1-16---305', at: at, low: 50 };
    store.save();                                   // 本机改动 → 脏检测
    assert.strictEqual(store.get().udPend, true, '选择关注宿舍应触发待补发');
    const r = await cloud.udPush();
    assert.strictEqual(r.ok, true);
    const post = postsTo('/userdata')[0];
    assert.ok(post, '应 POST userdata');
    const body = JSON.parse(post.data[0].blob);
    assert.deepStrictEqual(Object.keys(body), ['v', 'at'].concat(SECTION_KEYS).concat(['homeToolsAt']));
    assert.strictEqual(Object.keys(body).length, 14, '顶层应为 14 键（v/at/11 section/homeToolsAt）');
    assert.deepStrictEqual(Object.keys(body.at), SECTION_KEYS);
    assert.strictEqual(body.power.sel, '1-16---305', '关注宿舍随 power section 上云');
    assert.strictEqual(body.power.low, 50, 'v5 低电阈值随 power section 上云');
    assert.ok(body.at.power > WEB.at.power, '本机改动应抢占 power 时间戳');
    assert.strictEqual(body.power.at, body.at.power, '值内 at 必须与 at.power 镜像一致');
    // 换端恢复：另一台设备（或网页）选择的低值 → udApply 应用到本机 store
    const remote = JSON.parse(JSON.stringify(WEB));
    remote.power = { sel: '4-23B---424', at: 1777777777000, low: 60 };
    remote.at.power = 1777777777000;
    assert.strictEqual(cloud.udApply(remote), true);
    assert.strictEqual(store.get().power.sel, '4-23B---424', '换端后应从云端恢复关注宿舍');
    assert.strictEqual(store.get().power.at, 1777777777000);
    assert.strictEqual(store.get().power.low, 60, '换端后应从云端恢复低电阈值');
    // v5 迁移：旧 power 无 low → 应用后按默认 30
    const old = JSON.parse(JSON.stringify(WEB));
    old.power = { sel: '4-23B---424', at: 1777777778000 };
    old.at.power = 1777777778000;
    cloud.udApply(old);
    assert.strictEqual(store.get().power.low, 30, '旧数据无 low → 默认 30');
    // 非法 low → 规范化到合法档位（70/90 不在档位表）
    const bad = JSON.parse(JSON.stringify(WEB));
    bad.power = { sel: '4-23B---424', at: 1777777779000, low: 999 };
    bad.at.power = 1777777779000;
    cloud.udApply(bad);
    assert.strictEqual(store.get().power.low, 30, '越界 low → 默认 30');
    // 清空云端后的空 blob 也包含 power 默认值（与合并默认输出一致）
    const v5exp = JSON.parse(fs.readFileSync(path.join(__dirname, '_sync_fixtures/expected_v5_migrate.json'), 'utf8'));
    assert.deepStrictEqual(v5exp.power, { sel: '', at: 0, low: 30 });
    cloud.udStop();
  });

  await test('water（水量统计）：web→mp 恢复 / mp→web 期望值 / 旧数据默认 / 未拥有端原样保留', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    seedClassMembers(store);

    // 1) web → mp：远端 blob 里的 water 应用到本机（换设备恢复）
    assert.strictEqual(cloud.udApply(WEB), true);
    assert.deepStrictEqual(store.get().water, WEB.water, 'web 写出的 water 应完整恢复到本机');
    assert.deepStrictEqual(store.get().water.rooms['4-23A---321'].recs.map((r) => r.m), ['2026-09', '2026-10']);
    assert.strictEqual(store.get().water.rooms['4-23A---321'].p, 4);

    // 2) mp → web：本机抄表记录 → push body 中 water 值结构 {rooms:{rv:{p,recs:[{m,r,ts}]}}}
    reqLog = [];
    reqImpl = (o) => {
      if (o.method === 'GET' && urlOf(o).indexOf('/userdata?') >= 0) return ok([{ id: ID.sid, blob: JSON.stringify(WEB) }])(o);
      return o.success({ statusCode: 201, data: [] });
    };
    const at = Date.now();
    const recs = [
      { m: '2026-09', r: 100.5, ts: 1762000000000 },
      { m: '2026-10', r: 115.2, ts: 1762100000000 }
    ];
    store.get().water = { rooms: { '4-23A---321': { p: 4, recs: recs } } };
    store.save();
    assert.strictEqual(store.get().udPend, true, '抄表记录应触发待补发');
    const r = await cloud.udPush();
    assert.strictEqual(r.ok, true);
    const post = postsTo('/userdata')[0];
    assert.ok(post, '应 POST userdata');
    const body = JSON.parse(post.data[0].blob);
    assert.deepStrictEqual(Object.keys(body), ['v', 'at'].concat(SECTION_KEYS).concat(['homeToolsAt']));
    assert.strictEqual(Object.keys(body).length, 14, '顶层 14 键（v/at/11 section/homeToolsAt）');
    assert.deepStrictEqual(Object.keys(body.at), SECTION_KEYS);
    assert.deepStrictEqual(body.water, { rooms: { '4-23A---321': { p: 4, recs: recs } } }, 'water 值内不镜像 at，与网站同格式');
    assert.ok(body.at.water > WEB.at.water, '本机改动应抢占 water 时间戳');
    assert.strictEqual(body.nick, WEB.nick, '未拥有端（nick）原样保留');
    assert.deepStrictEqual(body.tt.ttLocal, WEB.tt.ttLocal, '未拥有 tt 其余字段原样保留');

    // 3) 旧数据无 water → 默认 {rooms:{}}，不报错、不覆盖其他 section
    const old = JSON.parse(JSON.stringify(WEB));
    delete old.water;
    delete old.at.water;
    const d0 = store.get();
    d0.water = { rooms: {} };
    store.save();
    assert.strictEqual(cloud.udApply(old), true);
    assert.deepStrictEqual(store.get().water, { rooms: {} }, '旧数据无 water → 默认空 rooms');
    assert.deepStrictEqual(store.get().homeTools.slice(0, 4), old.homeTools);
    const mergedOld = cloud.mergeUd(old, {});
    assert.deepStrictEqual(mergedOld.water, { rooms: {} }, 'merge 缺省 water={rooms:{}}');
    assert.strictEqual(mergedOld.at.water, 0);

    // 4) 人数 p 与记录随 water 同步（p=6 房间）
    const remote6 = JSON.parse(JSON.stringify(WEB));
    remote6.water = { rooms: { '1-16---305': { p: 6, recs: [{ m: '2026-11', r: 130.05, ts: 1762200000000 }] } } };
    remote6.at.water = 1777777777000;
    cloud.udApply(remote6);
    assert.strictEqual(store.get().water.rooms['1-16---305'].p, 6, '宿舍人数 6 随账号同步');
    // 坏数据归一：recs 乱序/重复月/负值 → 升序唯一、丢弃坏行
    remote6.water = { rooms: { '1-16---305': { p: 9, recs: [
      { m: '2026-11', r: 140.2, ts: 2 }, { m: '2026-10', r: 130.1, ts: 1 }, { m: '2026-11', r: 141.2345, ts: 3 }, { m: 'bad', r: 1, ts: 1 }
    ] } } };
    remote6.at.water = 1777777778000;
    cloud.udApply(remote6);
    const wr = store.get().water.rooms['1-16---305'];
    assert.strictEqual(wr.p, 4, '非法人数 → 默认 4');
    assert.deepStrictEqual(wr.recs.map((x) => x.m), ['2026-10', '2026-11'], '按月唯一升序');
    assert.strictEqual(wr.recs[1].r, 141.23, '读数保留 2 位');
    cloud.udStop();
  });

  /* 2026-11-12 抽签升级 v1：draw.names（自定义序号名称映射）随既有 draw section 同步（不新增顶层键/section） */
  await test('抽签名称映射（draw.names）：LWW 合并 / 云端应用 / 本机改动推送 / 旧数据无字段按空', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    seedClassMembers(store);

    // 1) 云端应用（换端恢复）：web 写出的 draw.names 完整应用，且不影响本机 autoRe / 其它 section
    store.get().draw.autoRe = false;
    store.save();
    assert.strictEqual(cloud.udApply(WEB), true);
    assert.strictEqual(store.get().draw.names, WEB.draw.names, '云端 draw.names 应应用到本机');
    assert.strictEqual(store.get().draw.autoRe, false, '本机独有 autoRe 不应被 draw section 覆盖');

    // 2) LWW：同 section 内时间戳新的赢（draw.names 不需要单独时间戳）
    const newer = cloud.mergeUd(
      { v: 6, at: { draw: 10 }, draw: { names: '1 网页组' } },
      { at: { draw: 5 }, draw: { names: '1 小程序组' } }
    );
    assert.strictEqual(newer.draw.names, '1 网页组', 'draw.at 更大的一侧（含 names）应赢');
    const tie = cloud.mergeUd(
      { v: 6, at: { draw: 10 }, draw: { names: '1 网页组' } },
      { at: { draw: 10 }, draw: { names: '1 小程序组' } }
    );
    assert.strictEqual(tie.draw.names, '1 网页组', '时间戳相同 → 云端赢（draw section 整体 LWW）');

    // 3) 本机改动：只改 names → 脏检测命中 draw → push body 带新映射并抬 at.draw
    reqLog = [];
    reqImpl = (o) => {
      if (o.method === 'GET' && urlOf(o).indexOf('/userdata?') >= 0) return ok([{ id: ID.sid, blob: JSON.stringify(WEB) }])(o);
      return o.success({ statusCode: 201, data: [] });
    };
    store.get().draw.names = '1 第一组\n2 第二组\n4 第四组';   // 与夹具 WEB.draw.names 不同，确保本机改动赢
    store.save();
    assert.strictEqual(store.get().udPend, true, 'names 改动应触发待补发');
    const r = await cloud.udPush();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.pushed, true);
    const body = JSON.parse(postsTo('/userdata')[0].data[0].blob);
    assert.deepStrictEqual(Object.keys(body), ['v', 'at'].concat(SECTION_KEYS).concat(['homeToolsAt']), '仍为 14 键 / 11 section');
    assert.strictEqual(body.draw.names, '1 第一组\n2 第二组\n4 第四组');
    assert.ok(body.at.draw > WEB.at.draw, 'names 改动应抬 at.draw');
    assert.strictEqual(body.at.names, undefined, '不得新增 names section 时间戳');

    // 4) 旧数据（draw 无 names）：
    //    a) 本机也没有映射（新装/未升级）→ 应用后按空串（store 默认值），不报错；
    //       旧客户端（网页未升级）push 时 draw section 没有 names，本机不能凭空生成脏数据。
    const old = JSON.parse(JSON.stringify(WEB));
    delete old.draw.names;
    const fresh2 = cloudFresh();
    setIdentity(ID);
    fresh2.store.get().draw.names = '';
    fresh2.store.save();
    assert.strictEqual(fresh2.cloud.udApply(old), true);
    assert.strictEqual(fresh2.store.get().draw.names, '', '旧数据 + 本机无映射 → 空串（不报错）');
    assert.strictEqual(fresh2.cloud.udSections().draw.names, '', 'udSections 始终带 names 字段（空串）');
    fresh2.cloud.udStop();

    //    b) 本机已有映射、旧客户端 blob 没这个字段 → 保留本机映射（不能被旧端 push 静默清空）
    assert.strictEqual(cloud.udApply(old), true);
    assert.strictEqual(store.get().draw.names, '1 第一组\n2 第二组\n4 第四组', '旧数据无 names 不得覆盖本机已保存映射');
    cloud.udStop();
  });

  await test('课表登录（tt.ttLocal）：本机登录写 ttLocal → UD v6 tt section LWW 抬 at.tt / 未拥有时云端值原样保留 / 清除覆盖 / 换端恢复', async () => {
    // A) 本机未写过 ttLocal：udSections 保留云端（缓存）ttLocal，不改 null（不覆盖别人的个人课表）
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    seedClassMembers(store);
    cloud.udApply(WEB);                       // 建立基线（WEB.tt.ttLocal 已存在）
    let view = cloud.udSections();
    assert.deepStrictEqual(view.tt.ttLocal, WEB.tt.ttLocal, '未拥有时 ttLocal 原样保留');
    assert.ok(store.get().ttLocal && store.get().ttLocal.c.length === 1, 'udApply 应把云端个人课表应用到本机 store.ttLocal（课表页显示）');
    assert.strictEqual(store.get().ttLocalAt, 0, '只读应用不写 ttLocalAt（不抢 LWW）');
    assert.strictEqual(view.at.tt, WEB.at.tt, '未拥有时 at.tt 保持云端值（不被抬高）');

    // B) 本机登录成功：写 ttLocal + ttLocalAt → udSections 带上并抬高 at.tt；push body 契约
    reqLog = [];
    reqImpl = (o) => {
      if (o.method === 'GET' && urlOf(o).indexOf('/userdata?') >= 0) return ok([{ id: ID.sid, blob: JSON.stringify(WEB) }])(o);
      return o.success({ statusCode: 201, data: [] });
    };
    const mine = { c: [{ name: '我的体育', day: 2, start: 3, end: 4, weeks: '1-16', parity: 'all', teacher: '王', room: '体育馆' }], t: '2026-09-01' };
    const at = Date.now();
    store.get().ttLocal = store.normTtLocal(mine);
    store.get().ttLocalAt = at;
    store.save();
    assert.strictEqual(store.get().udPend, true, '登录成功应触发待补发（1200ms 防抖）');
    view = cloud.udSections();
    assert.deepStrictEqual(view.tt.ttLocal, mine, 'udSections 应带本机个人课表');
    assert.ok(view.at.tt >= at, '本机写入 ttLocal → at.tt 抬高（LWW）');
    const up = await cloud.udPush();
    assert.strictEqual(up.ok, true);
    const post = postsTo('/userdata')[0];
    assert.ok(post, '应 POST userdata');
    const body = JSON.parse(post.data[0].blob);
    assert.deepStrictEqual(body.tt.ttLocal, mine, 'push body tt.ttLocal = {c,t}（与网页同字段）');
    assert.ok(body.at.tt > WEB.at.tt, 'body at.tt 应大于云端旧值');
    assert.strictEqual(body.tt.termStart, store.get().termStart, 'termStart 仍随 tt section 同步');
    assert.strictEqual(body.tt.ttView, WEB.tt.ttView, 'ttView 未拥有原样保留');

    // C) 清除我的课表：ttLocal null + 抬 at.tt → 覆盖云端个人课表
    await sleep(2);   // 保证 at.tt 严格大于 B 步（同 at 时云端赢，避免同毫秒幂等跳过导致偶发不稳定）
    reqLog = [];
    reqImpl = (o) => {
      if (o.method === 'GET' && urlOf(o).indexOf('/userdata?') >= 0) return ok([{ id: ID.sid, blob: JSON.stringify(body) }])(o);
      return o.success({ statusCode: 201, data: [] });
    };
    store.get().ttLocal = null;
    store.get().ttLocalAt = at + 1000;
    store.save();
    const up2 = await cloud.udPush();
    assert.strictEqual(up2.ok, true);
    const body2 = JSON.parse(postsTo('/userdata')[0].data[0].blob);
    assert.strictEqual(body2.tt.ttLocal, null, '清除后 push ttLocal=null（跨端清除依赖 at.tt 更新）');
    assert.ok(body2.at.tt > body.at.tt, '清除也要抬 at.tt');

    // D) 换端恢复：远端（网页/安卓）登录的个人课表 → udApply 写 store.ttLocal（课表页优先显示）
    const remote = JSON.parse(JSON.stringify(WEB));
    remote.tt = { ttView: 'week', ttUseMine: true, ttLocal: mine, termStart: '2026-09-01' };
    remote.at.tt = Date.now() + 5000;
    cloud.udApply(remote);
    assert.strictEqual(store.get().ttLocal.c[0].name, '我的体育', '换端应恢复个人课表');
    assert.strictEqual(store.get().ttLocal.t, '2026-09-01');
    // 远端清除 → 本机也回 null 且回到「未拥有」
    remote.tt.ttLocal = null;
    remote.at.tt += 1000;
    cloud.udApply(remote);
    assert.strictEqual(store.get().ttLocal, null);
    assert.strictEqual(store.get().ttLocalAt, 0, '远端清空后本机回到未拥有（不再抬高时间戳）');
    cloud.udStop();
  });

  await test('课表登录：ttLocal 坏数据归一（缺 name/day/start 越界 → 丢弃；非对象 → null）', () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    const norm = store.normTtLocal({
      c: [
        { name: '正常课', day: 0, start: 1, end: 2, weeks: '1-16', parity: 'odd', teacher: '张', room: 'A101', junk: 'x' },
        { name: '', day: 1, start: 1, end: 2 },
        { name: '坏 day', day: 9, start: 1, end: 2 },
        { name: '坏 start', day: 1, start: 0, end: 2 },
        { name: '坏 end', day: 1, start: 3, end: 2 },
        null, 'x'
      ],
      t: '2026-09-01'
    });
    assert.strictEqual(norm.c.length, 1, '只保留合法课程');
    assert.deepStrictEqual(Object.keys(norm.c[0]).sort(), ['day', 'end', 'name', 'parity', 'room', 'start', 'teacher', 'weeks']);
    assert.strictEqual(norm.c[0].junk, undefined, '未知字段丢弃');
    assert.strictEqual(norm.t, '2026-09-01');
    assert.strictEqual(store.normTtLocal(null), null);
    assert.strictEqual(store.normTtLocal({ c: [] }), null);
    assert.strictEqual(store.normTtLocal({ t: '2026-09-01' }), null);
    // 坏 ttLocal 在 mkD 里归一（ttLocalAt 也会被清零）
    const raw = store.mkD({ ttLocal: { c: [{ name: 'x', day: 1, start: 1, end: 2 }] }, ttLocalAt: 123 });
    assert.strictEqual(raw.ttLocal.c[0].name, 'x');
    const raw2 = store.mkD({ ttLocal: { bad: 1 }, ttLocalAt: 123 });
    assert.strictEqual(raw2.ttLocal, null);
    assert.strictEqual(raw2.ttLocalAt, 0);
  });


  await test('推送：本地无差异 → 只 GET 不 POST（幂等，不产生多余写入）', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    seedClassMembers(store);
    cloud.udApply(WEB);
    const c = store.get().udCache;
    if (c && c.power) c.power = { sel: c.power.sel, at: c.power.at, low: 30 };
    store.save();
    reqLog = [];
    reqImpl = (o) => {
      if (urlOf(o).indexOf('/userdata?') >= 0) return ok([{ id: ID.sid, blob: JSON.stringify(WEB) }])(o);
      return o.success({ statusCode: 200, data: [] });
    };
    const r = await cloud.udPush();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.pushed, false, '与云端一致时不应 POST');
    assert.strictEqual(postsTo('/userdata').length, 0);
    assert.ok(reqsOf('/userdata?').length >= 1, '应至少 GET 一次云端现状');
    cloud.udStop();
  });

  await test('脏检测防抖：本机改动后 0 请求，约 1.2s 后自动推送一次', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    seedClassMembers(store);
    cloud.udApply(WEB);
    reqLog = [];
    reqImpl = (o) => {
      if (o.method === 'GET' && urlOf(o).indexOf('/userdata?') >= 0) return ok([{ id: ID.sid, blob: JSON.stringify(WEB) }])(o);
      return o.success({ statusCode: 201, data: [] });
    };
    store.get().draw.count = 15;
    store.save();                                // 触发 store.save → udTouch 脏检测
    assert.strictEqual(reqLog.length, 0, '防抖窗口内不应立刻发请求');
    assert.strictEqual(store.get().udPend, true);
    await sleep(1400);
    assert.ok(reqsOf('/userdata?').length >= 1, '1.2s 后应自动拉云端再做合并');
    const post = postsTo('/userdata')[0];
    assert.ok(post, '1.2s 后应自动推送');
    assert.strictEqual(JSON.parse(post.data[0].blob).draw.count, 15);
    cloud.udStop();
  });

  await test('拉取：远端 v5 blob 迁移为 v6 并应用，同时把 v6 写回云端', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    seedClassMembers(store);
    store.get().homeToolsAt = 1000;              // 本机更旧 → 云端 homeTools 赢
    store.get().fit = { sex: 'f', grade: '34', h: '188' };
    store.get().draw.count = 7;                  // v5 没有 draw → 本机保留
    store.save();
    let remoteBlob = JSON.stringify(V5);
    reqImpl = (o) => {
      const u = urlOf(o);
      if (o.method === 'GET' && u.indexOf('/userdata?') >= 0) return ok([{ id: ID.sid, blob: remoteBlob }])(o);
      if (o.method === 'POST' && u === 'https://mock.test/v1/rdb/rest/userdata') { remoteBlob = o.data[0].blob; return o.success({ statusCode: 201, data: [] }); }
      return o.success({ statusCode: 200, data: [] });
    };
    const r = await cloud.udPull(true);
    assert.strictEqual(r.ok, true);
    const d = store.get();
    assert.strictEqual(d.udCache.v, 6, '远端 v5 拉取后本机基线应是 v6');
    assert.deepStrictEqual(d.homeTools.slice(0, 4), V5.homeTools.slice(0, 4), '云端 homeTools（at 更新）应赢');
    assert.strictEqual(d.fit.h, '170', 'v5 的 fit at=0 与本地 at=0 tie → 云端赢（契约 §3.3）');
    assert.strictEqual(d.draw.count, 7, '云端没有的 draw section 应保留本机值');
    // 契约 §3.3：v5 迁移后「正常 merge 并写回 v6」→ pull 内立即写回一次
    assert.strictEqual(r.migratedV5, true);
    assert.strictEqual(r.pushed, true);
    assert.strictEqual(r.willPush, false, 'v5 写回是同步完成的，不再安排防抖推送');
    const post = postsTo('/userdata');
    assert.strictEqual(post.length, 1, 'v5 拉取后应恰写回 1 次');
    assert.strictEqual(JSON.parse(post[0].data[0].blob).v, 6);
    cloud.udStop();
  });

  await test('v5 写回幂等：mock 远端 v5 → 恰 1 次 POST v6；再 pull 不重复写；抑制期内不写', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    seedClassMembers(store);
    let remoteBlob = JSON.stringify(V5);
    let posts = 0;
    reqImpl = (o) => {
      const u = urlOf(o);
      if (o.method === 'GET' && u.indexOf('/userdata?') >= 0) return ok([{ id: ID.sid, blob: remoteBlob }])(o);
      if (o.method === 'POST' && u === 'https://mock.test/v1/rdb/rest/userdata') {
        posts += 1;
        remoteBlob = o.data[0].blob;             // 写回后云端变成 v6
        return o.success({ statusCode: 201, data: [] });
      }
      return o.success({ statusCode: 200, data: [] });
    };
    const r = await cloud.udPull(true);
    assert.strictEqual(r.migratedV5, true);
    assert.strictEqual(posts, 1, '远端 v5 → 恰 1 次 POST 写回');
    const body = JSON.parse(remoteBlob);
    assert.strictEqual(body.v, 6, '写回 body 必须是 v6');
    assert.deepStrictEqual(body.fit, V5.fit, 'v5 的 fit 值应保留');
    assert.deepStrictEqual(body.homeTools.slice(0, 4), V5.homeTools.slice(0, 4), 'v5 的 homeTools 值应保留');
    assert.strictEqual(body.homeToolsAt, V5.homeToolsAt, '顶层 homeToolsAt 镜像保留');
    // v5 没有的 section = 本机默认值（mp 的默认口径，契约 §3.3「其余 section 缺省」）
    assert.deepStrictEqual(body.draw, { start: 1, end: 70, count: 10, dup: false, excl: '', sort: 'draw', names: '' });
    assert.deepStrictEqual(body.group, { source: 'prev', mode: 'groups', n: 4, shuffle: false, sel: [] });
    assert.deepStrictEqual(body.roster, { rosterSel: [], rollSel: [], rollSt: {}, rollNames: '' });
    assert.deepStrictEqual(body.hide, { hwHide: {}, ntHide: {} });
    assert.strictEqual(body.nick, '', '网页端 section 缺省为空串');
    // 写回后 remote 已是 v6：再次 pull 不再重复写
    await cloud.udPull(true);
    assert.strictEqual(posts, 1, 'v6 幂等：再次 pull 不应重复写回');
    // 清除抑制期内拉到 v5 也不写回（避免把清除后的云端又写回数据）
    remoteBlob = JSON.stringify(V5);
    store.get().udHoldUntil = Date.now() + 60 * 1000;
    store.save();
    const r3 = await cloud.udPull(true);
    assert.strictEqual(r3.migratedV5, false, '抑制期内不做 v5 写回');
    assert.strictEqual(posts, 1, '抑制期内不应 POST');
    cloud.udStop();
  });

  await test('首进（无基线）：云端没有的 section 保留本机值，云端已有的按 at 裁决', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    seedClassMembers(store);
    store.get().draw.count = 6;
    store.get().rosterSel = [1];
    store.get().ntDone = { auto_g_keep: true };
    store.save();
    reqImpl = (o) => {
      if (urlOf(o).indexOf('/userdata?') >= 0) return ok([{ id: ID.sid, blob: JSON.stringify(WEB) }])(o);
      return o.success({ statusCode: 200, data: [] });
    };
    await cloud.udPull(true);
    const d = store.get();
    assert.strictEqual(d.draw.count, WEB.draw.count, '云端已有的 draw（at>0）应赢');
    assert.strictEqual(d.ntDone.auto_g_keep, true, 'ntDone 属于 marks 状态，不受 userdata 覆盖');
    assert.deepStrictEqual(d.rosterSel, WEB.roster.rosterSel);
    cloud.udStop();
  });

  /* ============================================================
     5. cloudOff 云同步开关
     ============================================================ */
  await test('cloudOff：不拉不推、marks 入队；恢复后补推并拉一次', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    seedClassMembers(store);
    cloud.udApply(WEB);
    const off = await cloud.setCloudOff(true);
    assert.strictEqual(off.off, true);
    assert.strictEqual(store.get().cloudOff, true);
    reqLog = [];
    const pulled = await cloud.cloudPull(true);
    assert.deepStrictEqual(pulled, { off: true, cloudOff: true }, 'cloudOff 时 cloudPull 应短路');
    assert.strictEqual(reqLog.length, 0, 'cloudOff 时不应有任何请求');
    await cloud.setMark('hw', 'hw_off', true);
    assert.strictEqual(reqLog.length, 0, 'cloudOff 时 marks 写入不应发请求');
    assert.ok((store.get().markPend || []).some((p) => p.ref === 'hw_off'));
    // 恢复：先补发队列，再拉一次
    reqImpl = (o) => {
      if (o.method === 'POST' && urlOf(o).indexOf('/marks') >= 0) return o.success({ statusCode: 201, data: [] });
      return o.success({ statusCode: 200, data: [] });
    };
    const on = await cloud.setCloudOff(false);
    assert.strictEqual(on.ok, true);
    assert.strictEqual(store.get().cloudOff, false);
    assert.ok(postsTo('/marks').some((o) => o.data[0].ref === 'hw_off'), '恢复后应补发 cloudOff 期间排队的 marks');
    assert.ok(reqsOf('/userdata?').length >= 1, '恢复后应拉一次 userdata');
    cloud.udStop();
  });

  await test('cloudOff：读路径（marks/fit/hw/nt/成员/tt）全部零请求且返回本机缓存', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    store.get().cloudOff = true;
    store.get().fitRecs = [{ id: 'r1', ts: 1, sex: 'm', gr: '12', fields: {}, total: 80, grade: '良好' }];
    store.get().homework = [{ id: 'h1', subject: 'x' }];
    store.save();
    reqLog = [];
    const rs = await Promise.all([
      cloud.marksPull(true), cloud.fitPull(true), cloud.hwPull(true),
      cloud.ntPull(true), cloud.ntAutoPull(true), cloud.ensureMembers(true),
      cloud.ttFetch(true).then(() => 'ok').catch((e) => e.message)
    ]);
    assert.strictEqual(reqLog.length, 0, 'cloudOff 时应 0 请求');
    assert.strictEqual(rs[1].length, 1, 'fitPull 应返回本机体测记录');
    assert.strictEqual(rs[2].length, 1, 'hwPull 应返回本机作业');
    assert.strictEqual(rs[6], 'cloud-off', 'ttFetch 在 cloudOff 时应拒绝但不发请求');
  });

  /* ============================================================
     6. 清除云端我的数据（契约 §5.5）
     ============================================================ */
  await test('清除云端：userdata 覆盖为空 v6 / marks 全置 false / fitrecs 逐条 arch / 本机 marks 镜像清空', async () => {
    const { cloud, store, privacy } = cloudFresh();
    setIdentity(ID);
    seedClassMembers(store);
    cloud.udApply(WEB);
    store.get().hwDone = { hw_test1: true };
    store.get().ntPin = { notice_test1: true };
    store.get().ntDone = { auto_g_testA: true };
    store.save();
    reqLog = [];
    reqImpl = (o) => {
      const u = urlOf(o);
      if (o.method === 'POST' && u === 'https://mock.test/v1/rdb/rest/userdata') return o.success({ statusCode: 201, data: [] });
      if (u.indexOf('/marks?') >= 0 && o.method === 'GET') return ok(MARKS)(o);
      if (u.indexOf('/marks') >= 0 && o.method === 'POST') return o.success({ statusCode: 201, data: [] });
      if (u.indexOf('/fitrecs') >= 0 && o.method === 'GET' && u.indexOf('id=eq.') >= 0) return ok([{ id: 'r1', acc: ID.sid, arch: false }])(o);
      if (u.indexOf('/fitrecs?') >= 0 && o.method === 'GET') return ok([{ id: 'r1', acc: ID.sid, arch: false }, { id: 'r2', acc: ID.sid, arch: false }])(o);
      return o.success({ statusCode: 201, data: [] });
    };
    const r = await cloud.udClearCloud();
    assert.strictEqual(r.ok, true, (r && r.reason) || '清除失败');
    assert.strictEqual(r.marks, MARKS.length);
    assert.strictEqual(r.fitrecs, 2);
    const up = postsTo('/userdata')[0];
    assert.ok(up, '未发 userdata 覆盖');
    assert.strictEqual(JSON.stringify(JSON.parse(up.data[0].blob)), JSON.stringify(privacy.emptyV6()), 'userdata 应覆盖为空 v6 blob');
    const mp = postsTo('/marks')[0];
    assert.ok(mp, '未发 marks 置否');
    assert.strictEqual(mp.data.length, MARKS.length);
    mp.data.forEach((row) => {
      assert.strictEqual(row.val, false, 'marks 全部置 false（不 DELETE）');
      assert.ok(row.id.indexOf('|') > 0);
    });
    const arch = postsTo('/fitrecs').filter((o) => o.data[0] && o.data[0].arch === true);
    assert.strictEqual(arch.length, 2, '体测记录应逐条 arch=true');
    const d = store.get();
    assert.deepStrictEqual(d.hwDone, {});
    assert.deepStrictEqual(d.ntPin, {});
    assert.deepStrictEqual(d.ntDone, {});
    assert.strictEqual(d.udPend, false);
    // 清除成功后进入抑制期：基线对齐本机、不自动回推（QA 观察修复）
    assert.ok(d.udHoldUntil > Date.now(), '清除后应设置抑制期 udHoldUntil');
    assert.strictEqual(cloud.udStatus().hold, true);
    assert.strictEqual(r.holdUntil, d.udHoldUntil);
    cloud.udStop();
  });

  await test('清除云端后抑制期：1.2s 内不自动回推；显式修改设置后才重新同步', async () => {
    const { cloud, store, privacy } = cloudFresh();
    setIdentity(ID);
    seedClassMembers(store);
    cloud.udApply(WEB);                       // 先有同步基线（模拟老用户）
    reqLog = [];
    reqImpl = (o) => {
      const u = urlOf(o);
      if (o.method === 'POST' && u === 'https://mock.test/v1/rdb/rest/userdata') return o.success({ statusCode: 201, data: [] });
      if (o.method === 'GET' && u.indexOf('/userdata?') >= 0) {
        // 清除后云端 = 空 v6 blob
        return ok([{ id: ID.sid, blob: privacy.emptyBlob() }])(o);
      }
      if (u.indexOf('/marks?') >= 0 && o.method === 'GET') return ok(MARKS)(o);
      if (u.indexOf('/marks') >= 0 && o.method === 'POST') return o.success({ statusCode: 201, data: [] });
      if (u.indexOf('/fitrecs?') >= 0 && o.method === 'GET') return ok([])(o);
      return o.success({ statusCode: 201, data: [] });
    };
    const r = await cloud.udClearCloud();
    assert.strictEqual(r.ok, true);
    const postsAfterClear = postsTo('/userdata').length;
    assert.strictEqual(postsAfterClear, 1, '清除动作只应有 1 次 userdata 覆盖写入');
    assert.strictEqual(store.get().udHoldUntil > Date.now(), true, '清除后应处于抑制期');
    // 抑制期内：自动轮询 + 显式 udPush 都不能把本机设置推回云端
    await cloud.cloudPull(true);
    const pushed = await cloud.udPush();
    assert.strictEqual(pushed.ok, false);
    assert.strictEqual(pushed.hold, true, '抑制期内 udPush 应返回 hold 并跳过');
    await sleep(1400);
    assert.strictEqual(postsTo('/userdata').length, postsAfterClear, '抑制期内（含防抖窗口）不应自动回推云端');
    assert.strictEqual(store.get().udPend, false);
    // 用户显式修改同步内容 → 解除抑制 → 1.2s 防抖后重新上传合并后的副本
    store.get().draw.count = 15;
    store.save();
    assert.strictEqual(store.get().udHoldUntil, 0, '显式改动应解除抑制期');
    await sleep(1400);
    assert.strictEqual(postsTo('/userdata').length, postsAfterClear + 1, '显式改动后应重新同步一次');
    const reUp = postsTo('/userdata')[postsAfterClear];
    const body = JSON.parse(reUp.data[0].blob);
    assert.strictEqual(body.draw.count, 15);
    assert.ok(body.at.draw > 0);
    assert.strictEqual(store.get().udPend, false);
    cloud.udStop();
  });

  /* ============================================================
     7. 隐私模块纯逻辑（utils/privacy.js + pages/data/data.js）
     ============================================================ */
  await test('隐私：导出 JSON 不含 token / 学号 / 名单原文 / 设备 id；含身份摘要与同步范围', () => {
    const { store, privacy } = cloudFresh();
    setIdentity(ID);
    seedClassMembers(store);
    const d = store.get();
    d.ntDone = { auto_g_1: true };
    d.hwDone = { hw_1: true };
    d.draw.count = 9;
    d.rosterSel = [1, 24];
    d.rollSel = [26];
    d.rollNames = '26 测试辛';
    d.group.sel = [1];
    d.did = 'dev-secret-id';
    d.markPend = [];
    store.save();
    const json = privacy.exportJson(d, ID);
    assert.ok(json.indexOf('tok-sync-1') < 0, '导出不能包含 token');
    assert.ok(json.indexOf(ID.sid) < 0, '导出不能包含学号');
    assert.ok(json.indexOf('测试甲') < 0, '导出不能包含班级名单原文 / 他人姓名');
    assert.ok(json.indexOf('dev-secret-id') < 0, '导出不能包含设备 id');
    const j = JSON.parse(json);
    assert.strictEqual(j.schema, 'class-tools-userdata');
    assert.strictEqual(j.who.name, ID.name);
    assert.strictEqual(j.who.role, ID.role);
    assert.strictEqual(j.sync.draw.count, 9);
    assert.strictEqual(j.sync.marks.ntDone.auto_g_1, true);
    assert.deepStrictEqual(j.sync.roster.rosterSel, [1, 24]);
    assert.deepStrictEqual(j.sync.group.sel, [1]);
    assert.strictEqual(j.sync.roster.rollNames, undefined, '名单文本不导出');
    assert.strictEqual(j.sync.group.names, undefined, '派生名单文本不导出');
    assert.strictEqual(j.counts.ntDone, 1);
  });

  await test('隐私：空 v6 blob 与 merge 默认输出一致；marks 置否行契约', () => {
    const { cloud, privacy } = cloudFresh();
    assert.strictEqual(JSON.stringify(privacy.emptyV6()), JSON.stringify(cloud.mergeUd(null, {})), '空 blob 必须与合并默认输出同结构');
    const rows = privacy.marksOffRows(MARKS, ID.sid);
    assert.strictEqual(rows.length, MARKS.length);
    rows.forEach((r) => {
      assert.strictEqual(r.val, false);
      assert.strictEqual(r.seat, ID.sid);
      assert.ok(/^\d+\|(hw|nt|ntdone)\|/.test(r.id));
      assert.ok(r.ts > 0);
    });
    assert.deepStrictEqual(privacy.marksOffRows([null, {}, { kind: 'hw', ref: '' }], ID.sid), [], '坏行应被忽略');
  });

  await test('隐私页：exportData 复制 JSON 到剪贴板（不含 token），toast 提示', async () => {
    const { store } = cloudFresh();
    setIdentity(ID);
    seedClassMembers(store);
    store.get().ntDone = { auto_g_1: true };
    store.save();
    const def = loadPage('pages/data/data.js');
    const ctx = { data: {}, setData(o) { Object.assign(this.data, o); } };
    clipLog = []; toastLog = [];
    def.exportData.call(ctx);
    assert.strictEqual(clipLog.length, 1, '应调用 setClipboardData 一次');
    assert.ok(clipLog[0].indexOf('class-tools-userdata') >= 0, '剪贴板应是导出 JSON');
    assert.ok(clipLog[0].indexOf('tok-sync-1') < 0, '剪贴板不能包含 token');
    assert.ok(/已复制/.test(String(toastLog[toastLog.length - 1] || '')), '应有成功提示');
  });

  /* ============================================================
     8. 其它契约点：cloudPull 纳入 ud / store 新字段 / 简报排除已处理
     ============================================================ */
  await test('cloudPull：首轮包含 userdata 拉取，60s TTL 内 0 请求，force 立即', async () => {
    const { cloud } = cloudFresh();
    setIdentity(ID);
    reqImpl = ok([]);
    await cloud.cloudPull();
    assert.ok(reqsOf('/userdata?').length >= 1, 'cloudPull 应包含 udSync');
    reqLog = [];
    await cloud.cloudPull();
    assert.strictEqual(reqsOf('/userdata?').length, 0, '60s TTL 内不应重复拉 userdata');
    await cloud.cloudPull(true);
    assert.ok(reqsOf('/userdata?').length >= 1, 'force 应立即拉 userdata');
    cloud.udStop();
  });

  await test('store：ntDone/udCache/udPend/cloudOff/udHoldUntil 默认值与 mkD 归一', () => {
    const { store } = fresh();
    clearMem();
    const d = store.get();
    assert.deepStrictEqual(d.ntDone, {});
    assert.strictEqual(d.udCache, null);
    assert.strictEqual(d.udPend, false);
    assert.strictEqual(d.cloudOff, false);
    assert.strictEqual(d.udHoldUntil, 0);
    const mk = store.mkD({ ntDone: { a: true }, udCache: { v: 6 }, udPend: 1, cloudOff: 'yes', udHoldUntil: '123456' });
    assert.deepStrictEqual(mk.ntDone, { a: true });
    assert.deepStrictEqual(mk.udCache, { v: 6 });
    assert.strictEqual(mk.udPend, true);
    assert.strictEqual(mk.cloudOff, true);
    assert.strictEqual(mk.udHoldUntil, 123456);
    const bad = store.mkD({ ntDone: 'x', udCache: 'x', udPend: 0, cloudOff: 0, udHoldUntil: 'garbage' });
    assert.deepStrictEqual(bad.ntDone, {});
    assert.strictEqual(bad.udCache, null);
    assert.strictEqual(bad.udPend, false);
    assert.strictEqual(bad.cloudOff, false);
    assert.strictEqual(bad.udHoldUntil, 0);
  });

  await test('通知简报：statOf / mostUrgent 排除「已处理」（ntDone）', () => {
    const { notice } = fresh();
    const groups = [
      { id: 'auto_a', title: 'A', deadline: '2099-01-01T00:00:00+08:00' },
      { id: 'auto_b', title: 'B', deadline: '2099-01-02T00:00:00+08:00' }
    ];
    const all = notice.statOf(groups);
    assert.strictEqual(all.pending, 2);
    assert.strictEqual(notice.mostUrgent(groups).id, 'auto_a');
    const done = { auto_a: true };
    const filtered = notice.statOf(groups, done);
    assert.strictEqual(filtered.pending, 1, '已处理不计入待处理');
    assert.strictEqual(notice.mostUrgent(groups, done).id, 'auto_b', '已处理不参与最紧一条');
  });

  await test('页面：draw/group/roll/ft/me/nt/index 均实现 onCloudSync（应用远端后重绘，不重置结果）', () => {
    const pages = ['draw/draw', 'group/group', 'roll/roll', 'ft/ft', 'me/me', 'nt/nt', 'index/index'];
    pages.forEach((p) => {
      const src = fs.readFileSync(path.join(ROOT, 'pages', p.split('/')[0], p.split('/')[1] + '.js'), 'utf8');
      assert.ok(/onCloudSync\s*\(\)/.test(src), p + ' 缺少 onCloudSync');
    });
    // draw / group：onCloudSync 只重读参数与选择，不能调用 load()/doDraw() 重置进行中的结果
    ['draw/draw', 'group/group'].forEach((p) => {
      const src = fs.readFileSync(path.join(ROOT, 'pages', p.split('/')[0], p.split('/')[1] + '.js'), 'utf8');
      const at = src.indexOf('onCloudSync()');
      assert.ok(at >= 0);
      const body = src.slice(at, at + 1200);
      assert.ok(body.indexOf('this.load()') < 0, p + ' 的 onCloudSync 不应调用 load()（会重置结果）');
      assert.ok(body.indexOf('flow.patch') < 0, p + ' 的 onCloudSync 不应写 flow');
    });
    // app.json 已注册隐私页
    const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
    assert.ok(app.pages.indexOf('pages/data/data') >= 0, 'app.json 未注册 pages/data/data');
  });

  await test('页面：隐私页四件套齐全 + 内容覆盖契约 §5.5（开关/范围/导出/清除/隐私说明，无外部链接）', () => {
    ['data.js', 'data.json', 'data.wxml', 'data.wxss'].forEach((f) => {
      assert.ok(fs.existsSync(path.join(ROOT, 'pages/data', f)), '缺少 pages/data/' + f);
    });
    const wxml = fs.readFileSync(path.join(ROOT, 'pages/data/data.wxml'), 'utf8');
    ['云同步', '同步范围', '导出我的数据', '清除云端我的数据', '清除本机数据', '隐私说明',
      '访问统计', '反馈', '不采集', '用途', '存储', '保留'].forEach((k) => {
      assert.ok(wxml.indexOf(k) >= 0, '隐私页缺少内容：' + k);
    });
    assert.ok(wxml.indexOf('bindchange="toggleCloud"') >= 0, '缺少云同步开关');
    assert.ok(!/https?:\/\//.test(wxml), '隐私页不能放外部链接');
    const js = fs.readFileSync(path.join(ROOT, 'pages/data/data.js'), 'utf8');
    assert.ok(js.indexOf('wx.setClipboardData') >= 0, '导出应写剪贴板');
    assert.ok(js.indexOf('udClearCloud') >= 0, '清除云端应走 udClearCloud');
    assert.ok(js.indexOf('wx.getStorageInfoSync') >= 0, '本机概览应读 getStorageInfoSync');
    // 清除云端后的语义说明：不自动恢复、再次修改设置时重新同步（QA 观察修复）
    assert.ok(js.indexOf('不会自动恢复') >= 0, '清除确认弹窗应说明本机保留内容不会自动恢复');
    assert.ok(js.indexOf('修改设置时会重新同步') >= 0, '清除后 toast 应说明修改设置时重新同步');
    assert.ok(wxml.indexOf('{{hold}}') >= 0, '抑制期状态应在页面可见（已清除 · 再次修改设置时重新同步）');
  });

  await test('未登录 / 未配置：udPull/udPush/udClearCloud 返回原因且零请求', async () => {
    const { cloud } = cloudFresh();
    clearMem();                                  // 无身份
    const r1 = await cloud.udPull(true);
    assert.strictEqual(r1.ok, false);
    assert.ok(/身份/.test(r1.reason));
    assert.strictEqual(reqLog.length, 0);
    reqImpl = ok([]);
    clearMem();
    setIdentity(ID);
    cloud.configure({ enabled: false });
    const r2 = await cloud.udPush();
    assert.strictEqual(r2.ok, false);
    assert.ok(/未连接云端/.test(r2.reason));
    assert.strictEqual(reqLog.length, 0);
    const r3 = await cloud.udClearCloud();
    assert.strictEqual(r3.ok, false);
    assert.strictEqual(reqLog.length, 0);
  });

  /* ============================================================
     v2.0.0 需求 14：体测 sex/grade 加入同步（fttable 选择 → store.fit → userdata fit section）
     ============================================================ */
  await test('需求14：fttable 选男女/年级写回 store.fit，随 userdata fit section 上云（契约 §4）', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    seedClassMembers(store);
    // 页面：加载国标评分表页（不启动模拟器）
    const def = loadPage('pages/fttable/fttable.js');
    const ctx = Object.assign({}, def);
    ctx.data = JSON.parse(JSON.stringify(def.data));
    ctx.setData = function (o, cb) { Object.assign(this.data, o); if (cb) cb(); };
    ctx._agent = null; ctx._agentQ = null;
    def.onLoad.call(ctx, {});
    // 初始取 store.fit（这里默认 m/12）
    assert.strictEqual(ctx.data.sex, 'm');
    assert.strictEqual(ctx.data.grade, '12');
    def.setSex.call(ctx, { currentTarget: { dataset: { v: 'f' } } });
    def.setGr.call(ctx, { currentTarget: { dataset: { v: '34' } } });
    assert.strictEqual(store.get().fit.sex, 'f', 'fttable 选女 → store.fit.sex=f');
    assert.strictEqual(store.get().fit.grade, '34', 'fttable 选大三大四 → store.fit.grade=34');
    assert.strictEqual(ctx.data.sex, 'f');
    assert.strictEqual(ctx.data.grade, '34');
    // userdata 上云 body：fit section 显式带 sex/grade
    let pushBody = null;
    reqImpl = (o) => {
      if (urlOf(o).indexOf('/userdata?') >= 0 && o.method === 'GET') return o.success({ statusCode: 200, data: [] });
      if (urlOf(o).indexOf('/userdata') >= 0 && o.method === 'POST') { pushBody = o.data && o.data[0]; return o.success({ statusCode: 200, data: [] }); }
      return o.success({ statusCode: 200, data: [] });
    };
    reqLog = [];
    const pushed = await cloud.udPush();
    assert.strictEqual(pushed.ok, true);
    cloud.udStop();
    assert.ok(pushBody, '应 POST userdata');
    const blob = JSON.parse(pushBody.blob);
    assert.strictEqual(blob.v, 6);
    assert.strictEqual(blob.fit.sex, 'f', 'push blob 的 fit section 必须包含 sex');
    assert.strictEqual(blob.fit.grade, '34', 'push blob 的 fit section 必须包含 grade');
    // 字段集合与网页 UD_FIT_KEYS 完全一致（契约 §4「两端逐字节同字段」）
    // 网页仓库不在本仓库内：默认尝试同级 ../web，可用 WEB_REPO 环境变量指定；找不到时只校验必需键。
    const webHtml = process.env.WEB_REPO
      ? path.join(process.env.WEB_REPO, 'tools/index.html')
      : path.join(ROOT, '..', 'web', 'tools', 'index.html');
    let webKeys = ['sex', 'grade'];
    if (fs.existsSync(webHtml)) {
      const web2 = fs.readFileSync(webHtml, 'utf8');
      const wm = web2.match(/var UD_FIT_KEYS=\[([^\]]*)\]/);
      assert.ok(wm, '网页端应有 UD_FIT_KEYS');
      webKeys = wm[1].split(',').map((s) => s.replace(/["'\s]/g, '')).filter(Boolean);
      assert.deepStrictEqual(Object.keys(blob.fit).sort(), webKeys.slice().sort(), 'push blob fit 字段集合应与网页 UD_FIT_KEYS 一致');
    } else {
      console.log('SKIP  网页端 UD_FIT_KEYS 对照（未找到 ' + webHtml + '）');
    }
    // 主 ft 页 onShow → load() 读 store，显示同一个值
    const ftDef = loadPage('pages/ft/ft.js');
    const ftCtx = Object.assign({}, ftDef);
    ftCtx.data = JSON.parse(JSON.stringify(ftDef.data));
    ftCtx.setData = function (o, cb) { Object.assign(this.data, o); if (cb) cb(); };
    ftCtx._agent = null; ftCtx._agentQ = null;
    ftDef.load.call(ftCtx);
    assert.strictEqual(ftCtx.data.sex, 'f', '体测主页应显示国标表选的性别');
    assert.strictEqual(ftCtx.data.grade, '34');
    // 网页端契约字段集合一致
    for (const k of ['sex', 'grade']) assert.ok(webKeys.indexOf(k) >= 0, '网页 UD_FIT_KEYS 应含 ' + k);
    // 需求 14 静态：ft 页 onShow 会 _syncFit（远端应用后刷新 UI）
    const ftSrc = fs.readFileSync(path.join(ROOT, 'pages/ft/ft.js'), 'utf8');
    assert.ok(/_syncFit\(/.test(ftSrc) && /cloud\.udSync/.test(ftSrc), 'ft 页 onShow 应拉 userdata → onCloudSync 刷新 UI');
    const fttSrc = fs.readFileSync(path.join(ROOT, 'pages/fttable/fttable.js'), 'utf8');
    assert.ok(/_persist\(/.test(fttSrc) && /store\.save\(\)/.test(fttSrc), 'fttable 选男女/年级应落 store 并触发同步');
  });

  /* ============================================================
     v2.0.0 需求 16：marks 强制刷新 / 补发 / 页面重绘
     ============================================================ */
  await test('需求16：marksPull(true) 绕过 TTL；远端变化 notifyPages；失败进 markPend 后补发并清队列', async () => {
    const { cloud, store } = cloudFresh();
    setIdentity(ID);
    let notifyN = 0;
    global.getApp = () => ({ notifyPages: () => { notifyN += 1; } });
    reqImpl = (o) => {
      if (urlOf(o).indexOf('/marks') >= 0 && o.method === 'GET') {
        return o.success({ statusCode: 200, data: [
          { id: ID.sid + '|ntdone|g_remote', seat: ID.sid, kind: 'ntdone', ref: 'g_remote', val: true, ts: 1 },
          { id: ID.sid + '|hw|h_remote', seat: ID.sid, kind: 'hw', ref: 'h_remote', val: true, ts: 2 }
        ] });
      }
      return o.success({ statusCode: 200, data: [] });
    };
    reqLog = [];
    await cloud.marksPull(true);
    assert.strictEqual(store.get().ntDone.g_remote, true, '远端通知已处理应应用到本机');
    assert.strictEqual(store.get().hwDone.h_remote, true, '远端作业已完成应应用到本机');
    await sleep(80);
    assert.ok(notifyN >= 1, 'marks 变化应 notifyPages → 工作台/列表重绘');
    reqLog = [];
    await cloud.marksPull(false);
    assert.strictEqual(reqsOf('/marks').length, 0, '2min TTL 内非 force 应 0 请求');
    await cloud.marksPull(true);
    assert.strictEqual(reqsOf('/marks').length, 1, 'force 必须绕过 TTL 强制拉一次');
    // 写入失败 → markPend；恢复后 cloudPull → flushPending 补发
    reqImpl = (o) => { o.fail({ errMsg: 'request:fail mock' }); };
    const okWrite = await cloud.setMark('ntdone', 'g_pend', true);
    assert.strictEqual(okWrite, false);
    assert.ok((store.get().markPend || []).some((p) => p.ref === 'g_pend'), '写失败应进 markPend');
    reqImpl = ok([]);
    reqLog = [];
    await cloud.cloudPull(true);
    await sleep(60);
    assert.strictEqual((store.get().markPend || []).length, 0, '恢复后应补发并清空 markPend');
    assert.ok(postsTo('/marks').length >= 1, '应补发 POST marks');
    delete global.getApp;
    cloud.udStop();
  });

  await test('需求16：hw/nt/index 页面 onShow/下拉刷新/onCloudSync 强制 marksPull(true)；app.onShow 回前台强制拉', () => {
    ['pages/hw/hw.js', 'pages/nt/nt.js', 'pages/index/index.js'].forEach((rel) => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert.ok(/cloud\.marksPull\(true\)/.test(src), rel + ' 应强制拉一次 marks');
    });
    const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    assert.ok(/cloud\.marksPull\(true\)/.test(app), 'app.onShow（回到前台）应强制拉 marks');
    // 写入失败保留待补发（cloud.setMark → pushPending），恢复后 cloudPull 内 flushPending
    const cloudSrc = fs.readFileSync(path.join(ROOT, 'utils/cloud.js'), 'utf8');
    assert.ok(/function flushPending/.test(cloudSrc) && /flushPending\(\);/.test(cloudSrc), 'cloudPull 应调用 flushPending 补发');
  });

  /* ---------------- 汇总 ---------------- */
  purge();                                       // 清掉可能遗留的防抖 timer
  const summary = { total: passN + failN, pass: passN, fail: failN, results, at: new Date().toISOString() };
  fs.writeFileSync(path.join(__dirname, 'sync_contract_result.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log('\n================ ' + passN + ' passed, ' + failN + ' failed ================');
  process.exitCode = failN ? 2 : 0;
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
