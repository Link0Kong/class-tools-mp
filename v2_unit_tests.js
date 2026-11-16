/* v2_unit_tests.js —— 「班级工具站 v2.0.0」小程序端专项单测（需求 1/2/5/9/10/11/12/13/14/16 的纯逻辑面）
 *
 * 运行方式：
 *   node v2_unit_tests.js     # 独立运行，自带 wx mock，结果写 v2_unit_result.json
 *   node unit.js              # unit.js 末尾 require 本文件 run(test)，并入总表
 *
 * 约束：全部为 Node 内存 mock，不启动模拟器、不发真实请求、不读写真实云端；不需要真实班级数据。
 * 被测文件：utils/version.js、utils/scrollmem.js、utils/notice.js、
 *           utils/store.js / identity.js / cloud.js、pages/nt、pages/index 以及 app.wxss / 页面样式静态断言。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = 'C:/Users/Ko_Li/.openclaw/workspace/mp-class-tools';
const ROOT_N = ROOT.replace(/\\/g, '/');
const WEB_INDEX = 'C:/Users/Ko_Li/.openclaw/workspace/web/tools/index.html';

const ID = { token: 'tok-v2-1', sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: true, ts: 1 };
const ID2 = { token: 'tok-v2-2', sid: '9999000004', name: '谢梓萱', role: '', badge: '', is_admin: false, ts: 2 };

// 作业夹具日期必须相对「今天」生成：截止后 3 天会被 cloud.pruneHomework（util.hwExpired）清掉，
// 写死日期会让用例随时间失效（2026-11-13 实测 2026-11-10 的夹具被清理 → 需求11 两条断言失败）。
function dayAfter(n) {
  const d = new Date(Date.now() + (Number(n) || 0) * 86400000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ---------------------------------------------------------------- wx mock 上下文 */
function createCtx() {
  const mem = Object.create(null);
  let reqLog = [];
  let reqImpl = function (o) { o.success({ statusCode: 200, data: [] }); };
  let pageScrollToLog = [];
  let toastLog = [];
  let modalLog = [];
  let navLog = [];
  const wxMock = {
    getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
    setStorageSync(k, v) { mem[k] = v; },
    removeStorageSync(k) { delete mem[k]; },
    getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 0, limitSize: 10240 }; },
    request(o) { reqLog.push(o); reqImpl(o); },
    showToast(o) { toastLog.push(o && o.title); },
    showModal(o) { modalLog.push(o && o.title); if (o && o.success) o.success({ confirm: true, cancel: false }); },
    showActionSheet(o) { if (o && o.success) o.success({ tapIndex: 0 }); },
    showLoading() {}, hideLoading() {},
    pageScrollTo(o) { pageScrollToLog.push(o && o.scrollTop); if (o && o.success) o.success(); },
    setClipboardData(o) { if (o && o.success) o.success(); },
    getWindowInfo() { return { windowWidth: 375, windowHeight: 667 }; },
    getSystemInfoSync() { return { windowWidth: 375, windowHeight: 667, SDKVersion: '3.0.0' }; },
    getAppBaseInfo() { return { SDKVersion: '3.0.0', SDKVersionInfo: '3.0.0' }; },
    createSelectorQuery() {
      return {
        in() { return this; }, select() { return this; }, selectViewport() { return this; },
        boundingClientRect() { return this; }, scrollOffset() { return this; },
        fields() { return this; }, exec(cb) { if (cb) cb([{ top: 100 }, { scrollTop: 0 }]); }
      };
    },
    navigateTo(o) { navLog.push(o && o.url); },
    switchTab(o) { navLog.push(o && o.url); },
    reLaunch(o) { navLog.push(o && o.url); },
    nextTick(fn) { if (fn) fn(); },
    getFileSystemManager() { return { writeFile(o) { if (o && o.success) o.success({}); } }; },
    env: { USER_DATA_PATH: '/tmp' },
    cloud: undefined
  };
  return {
    mem: mem, wxMock: wxMock,
    clearMem() { Object.keys(mem).forEach(function (k) { delete mem[k]; }); reqLog = []; pageScrollToLog = []; toastLog = []; modalLog = []; navLog = []; reqImpl = function (o) { o.success({ statusCode: 200, data: [] }); }; },
    setReq(fn) { reqImpl = fn; },
    reqLog() { return reqLog; },
    reqUrls(frag) { return reqLog.filter(function (o) { return String((o && o.url) || '').indexOf(frag) >= 0; }); },
    pageScrollToLog() { return pageScrollToLog; },
    toastLog() { return toastLog; },
    modalLog() { return modalLog; },
    setIdentity(id) { mem['zq_class_identity'] = JSON.stringify(id || ID); }
  };
}

function purge() {
  Object.keys(require.cache).forEach(function (k) {
    if (k.replace(/\\/g, '/').indexOf(ROOT_N) !== 0) return;
    try {
      const m = require.cache[k];
      if (m && m.exports && typeof m.exports.udStop === 'function') m.exports.udStop();
    } catch (e) { /* ignore */ }
    delete require.cache[k];
  });
}
function R(rel) { return require(path.join(ROOT, rel)); }
function fresh() { purge(); return { store: R('utils/store.js'), identity: R('utils/identity.js'), cloud: R('utils/cloud.js') }; }
function enableCloud(cloud) {
  cloud.configure({ enabled: true, restBase: 'https://rest.test/v1/rdb/rest/', publishableKey: 'pk-test', ttUrl: 'https://static.test/tt.json' });
}
function loadPage(rel) {
  let def = null;
  const file = path.join(ROOT, 'pages', rel + '.js');
  try { delete require.cache[require.resolve(file)]; } catch (e) { /* ignore */ }
  global.Page = function (d) { def = d; };
  try { require(file); } finally { delete global.Page; }
  assert.ok(def && typeof def === 'object', '页面未注册 Page：' + rel);
  return def;
}
// 极简 setData：支持 'a.b' / 'a[0].b' 路径；记录每次调用的 key 列表（用于断言「只更新文案字段」）
function makeSetData(ctx) {
  ctx.__log = [];
  return function (o, cb) {
    ctx.__log.push(Object.keys(o || {}));
    Object.keys(o || {}).forEach(function (k) {
      const parts = k.replace(/\[(\d+)\]/g, '.$1').split('.');
      let t = ctx.data;
      for (let i = 0; i < parts.length - 1; i++) {
        if (t[parts[i]] == null) t[parts[i]] = {};
        t = t[parts[i]];
      }
      t[parts[parts.length - 1]] = o[k];
    });
    ctx.last = o;
    if (cb) cb();
  };
}
function ctxOf(def, extra) {
  const ctx = Object.assign({}, def);
  ctx.data = JSON.parse(JSON.stringify(def.data || {}));
  ctx.setData = makeSetData(ctx);
  if (extra) Object.assign(ctx, extra);
  return ctx;
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
function src(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function walk(dir, out) {
  fs.readdirSync(dir).forEach(function (n) {
    const p = path.join(dir, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (/node_modules|_backup|__pycache__|\.git|images/.test(n)) return;
      walk(p, out);
    } else out.push(p);
  });
  return out;
}

/* ---------------------------------------------------------------- 通知测试数据 */
const NT_PREFIX = '[[CLASS_NOTICE_V1]]';
function autoNotice(g, extra) {
  return Object.assign({
    id: 'auto_' + g.id,
    title: g.title,
    body: NT_PREFIX + JSON.stringify(g),
    imp: false, pin: false, author: '系统', owner: 'system', attachments: '', archived: false,
    ts: 1000 + (g._i || 0), hidden: false, override_json: '', edited_at: 0, edited_by: ''
  }, extra || {});
}
function sampleNoticeGroups() {
  const wed = { freq: 'monthly_weeks', weekday: 3, weeks: [1, 2, 3], time: '17:30', startAt: '2026-11-04T17:30:00+08:00', label: '每月前三周 周三 17:30' };
  return [
    { id: 'g1', _i: 0, title: '宿舍卫生检查安排', cat: '班级事务', recurrence: wed, actionable: false, summary: '长期安排', aiSummary: '长期安排', aiPoints: ['长期安排'], items: [{ kind: 'text', text: '每月前三周周三 17:30 检查' }] },
    { id: 'g2', _i: 1, title: '报名通知（待处理）', cat: '活动', deadline: '2026-12-31T18:00:00+08:00', eventAt: '2026-12-31T12:00:00+08:00', actionable: true, summary: '报名', aiSummary: '报名', items: [{ kind: 'text', text: '报名开始' }, { kind: 'text', label: '补充通知', text: '时间已调整' }], updatedAt: '2026-11-05T12:37:00+08:00' },
    { id: 'g3', _i: 2, title: '已过期活动', cat: '活动', deadline: '2020-01-01T00:00:00+08:00', actionable: true, summary: '过期', aiSummary: '过期', items: [] }
  ];
}
function ntPullMock(C, groups, hiddenIds, overrides) {
  C.setReq(function (o) {
    const u = String(o.url || '');
    if (u.indexOf('/notices') >= 0 && o.method === 'GET') {
      const rows = (groups || sampleNoticeGroups()).map(function (g, i) {
        const row = autoNotice(Object.assign({ _i: i }, g));
        if ((hiddenIds || []).indexOf(g.id) >= 0) row.hidden = true;
        if (overrides && overrides[g.id]) row.override_json = JSON.stringify(overrides[g.id]);
        return row;
      });
      return o.success({ statusCode: 200, data: rows });
    }
    if (u.indexOf('/notices') >= 0) return o.success({ statusCode: 200, data: [] });
    return o.success({ statusCode: 200, data: [] });
  });
}

/* ================================================================ RUN */
function run(test) {
  const prevWx = global.wx;
  const C = createCtx();
  global.wx = C.wxMock;
  const prevGetCurrentPages = global.getCurrentPages;
  const prevGetApp = global.getApp;
  // 调试/防泄漏：记录测试期间创建的 interval（若测试漏停，结束时打印调用栈，避免 unit.js 被挂住）
  const prevSetInterval = global.setInterval;
  const liveIntervals = [];
  global.setInterval = function (fn, ms) {
    const id = prevSetInterval(fn, ms);
    liveIntervals.push({ id: id, ms: ms, stack: String(new Error().stack || '').split('\n').slice(2, 5).join(' | ') });
    return id;
  };
  const finishTimers = function () {
    global.setInterval = prevSetInterval;
    if (!liveIntervals.length) return;
    // 页面级 interval（工作台 5s 轮换）在真实运行中由 onHide/onUnload 停止；测试里可能因异步
    // setData 回调晚于断言而多发一次，这里统一清理，避免 unit.js 进程被 timer 挂住。
    liveIntervals.forEach(function (x) { global.clearInterval(x.id); });
    console.log('INFO  v2 测试清理遗留 interval ' + liveIntervals.length + ' 个（工作台轮换计时器，运行时由 onHide 停止）');
  };

  return (async function () {
    /* ============================================================
       需求 1：版本号 2.0.0（唯一来源 + 我的页 + 文档）
       ============================================================ */
    await test('需求1：utils/version.js 是唯一版本来源（2.0.0）', function () {
      purge();
      const v = R('utils/version.js');
      assert.strictEqual(v.VERSION, '2.0.0');
      assert.strictEqual(v.text(), '班级工具 · v2.0.0');
      const app = src('app.js');
      assert.ok(/require\('\.\/utils\/version\.js'\)/.test(app), 'app.js 应 require utils/version.js');
      assert.ok(/version:\s*version\.VERSION/.test(app), 'app.js globalData.version 应引用 version.VERSION');
    });

    await test('需求1：「我的」页底部显示版本号（动态，不再硬编码 v1.3.3）', function () {
      const meJs = src('pages/me/me.js');
      const meWxml = src('pages/me/me.wxml');
      assert.ok(/versionText/.test(meJs) && /version\.text\(\)/.test(meJs), 'me.js 应提供 versionText');
      assert.ok(/\{\{versionText\}\}/.test(meWxml), 'me.wxml 底部应展示 {{versionText}}');
      assert.ok(!/v1\.3\.3/.test(meWxml), '不应再有硬编码 v1.3.3');
      assert.ok(/class="footer-note"/.test(meWxml), '版本号应在页脚小字（footer-note）');
    });

    /* ============================================================
       需求 2：utils/scrollmem.js（页面滚动保位 + 内部 scroll-view）
       ============================================================ */
    await test('需求2：scrollmem 记录 → 恢复（数据态渲染完成后瞬时滚回，不阻塞）', async function () {
      purge();
      const sm = R('utils/scrollmem.js');
      sm.resetAll();
      C.clearMem();
      const pageA = { route: 'pages/sample/sample', data: { state: 'loading' }, setData: function () {} };
      sm.attach(pageA);
      sm.onScroll(pageA, { scrollTop: 320 });
      sm.save(pageA);
      assert.strictEqual(sm.memOf('pages/sample/sample'), 320);
      // 新实例（模拟页面被销毁后重进）：loading 态先不恢复，转 data 后恢复
      const pageB = { route: 'pages/sample/sample', data: { state: 'loading' }, setData: function () {} };
      sm.attach(pageB);
      const before = C.pageScrollToLog().length;
      assert.strictEqual(sm.restore(pageB, { gap: 10, timeout: 200, delay: 0 }), true);
      await sleep(20);
      assert.strictEqual(C.pageScrollToLog().length, before, 'loading 期间不应滚动');
      pageB.data.state = 'data';
      await sleep(40);
      assert.strictEqual(C.pageScrollToLog().length, before + 1, 'data 态后应恢复一次');
      assert.strictEqual(C.pageScrollToLog()[C.pageScrollToLog().length - 1], 320);
    });

    await test('需求2：同一实例后续 onShow 不恢复；用户先滚动则取消恢复；离开页面取消计时器', async function () {
      purge();
      const sm = R('utils/scrollmem.js');
      sm.resetAll();
      C.clearMem();
      const p = { route: 'pages/a/a', data: { state: 'data' }, setData: function () {} };
      sm.attach(p);
      sm.onScroll(p, { scrollTop: 200 }); sm.save(p);
      const q = { route: 'pages/a/a', data: { state: 'data' }, setData: function () {} };
      sm.attach(q);
      assert.strictEqual(sm.restore(q, { gap: 10, timeout: 100 }), true, '首次 onShow 恢复');
      await sleep(30);                          // 等这次恢复真正执行完
      const n0 = C.pageScrollToLog().length;
      assert.strictEqual(sm.restore(q, { gap: 10, timeout: 100 }), false, '同实例再次 onShow 不再恢复');
      // 用户滚动 → 取消尚未执行的恢复
      const r = { route: 'pages/b/b', data: { state: 'loading' }, setData: function () {} };
      sm.attach(r);
      sm.onScroll(r, { scrollTop: 777 }); sm.save(r);
      const s = { route: 'pages/b/b', data: { state: 'data' }, setData: function () {} };
      sm.attach(s);
      sm.restore(s, { gap: 10, timeout: 100, delay: 20 });
      sm.onScroll(s, { scrollTop: 5 });          // 恢复前用户自己滚了
      await sleep(60);
      assert.strictEqual(C.pageScrollToLog().length, n0, '用户自己滚动后不应再恢复');
      // 离开页面取消计时器
      const t = { route: 'pages/c/c', data: { state: 'loading' }, setData: function () {} };
      sm.attach(t);
      sm.onScroll(t, { scrollTop: 50 }); sm.save(t);
      const u = { route: 'pages/c/c', data: { state: 'loading' }, setData: function () {} };
      sm.attach(u);
      sm.restore(u, { gap: 10, timeout: 200, delay: 40 });
      sm.save(u);
      await sleep(60);
      assert.strictEqual(C.pageScrollToLog().length, n0, 'save（页面隐藏）应取消未执行的恢复');
    });

    await test('需求2：内部 scroll-view 位置记忆（svSave/svGet）', function () {
      purge();
      const sm = R('utils/scrollmem.js');
      sm.resetAll();
      const p = { route: 'pages/tt/tt' };
      assert.strictEqual(sm.svGet(p, 'ttgrid'), null);
      sm.svSave(p, 'ttgrid', { scrollLeft: 49.33, scrollTop: 0 });
      assert.deepStrictEqual(sm.svGet(p, 'ttgrid'), { left: 49.33, top: 0 });
      sm.svClear(p, 'ttgrid');
      assert.strictEqual(sm.svGet(p, 'ttgrid'), null);
    });

    await test('需求2：17 个页面都接入 scrollmem（attach/restore/save/onScroll）', function () {
      const pages = ['index/index', 'all/all', 'me/me', 'nt/nt', 'hw/hw', 'ft/ft', 'fb/fb', 'data/data',
        'committee/committee', 'stats/stats', 'ug/ug', 'fttable/fttable', 'roll/roll', 'group/group', 'sum/sum', 'draw/draw', 'tt/tt'];
      pages.forEach(function (rel) {
        const s = src('pages/' + rel + '.js');
        assert.ok(/scrollmem\.attach\(this\)/.test(s), rel + ' 缺 attach');
        assert.ok(/scrollmem\.onScroll\(this, e\)/.test(s), rel + ' 缺 onPageScroll 记录');
        assert.ok(/scrollmem\.save\(this\)/.test(s), rel + ' 缺 onHide/onUnload 保存');
      });
      // fttable / tt 还处理内部 scroll-view
      assert.ok(/svSave\(this, 'fttable'/.test(src('pages/fttable/fttable.js')), 'fttable 应记录横向位置');
      assert.ok(/scroll-left="\{\{smLeft\}\}"/.test(src('pages/fttable/fttable.wxml')), 'fttable 应恢复横向位置');
    });

    /* ============================================================
       需求 9：长期安排（recurrence）—— 下次时间本地计算 / 不判过期 / 不计入待处理
       ============================================================ */
    await test('需求9：monthly_weeks「每月前三周 周三 17:30」下次时间计算', function () {
      purge();
      const notice = R('utils/notice.js');
      const g = { recurrence: { freq: 'monthly_weeks', weekday: 3, weeks: [1, 2, 3], time: '17:30', startAt: '2026-11-04T17:30:00+08:00', label: '每月前三周 周三 17:30' } };
      const now = new Date(2026, 10, 5, 10, 0).getTime();       // 2026-11-05（周四）10:00
      const ts = notice.nextOf(g, now);
      const d = new Date(ts);
      assert.strictEqual(d.getMonth() + 1, 11);
      assert.strictEqual(d.getDate(), 11, '11 月第 2 个周三 = 11 日');
      assert.strictEqual(d.getHours(), 17); assert.strictEqual(d.getMinutes(), 30);
      assert.strictEqual(notice.nextTextOf(g, now), '下次 11-11 周三 17:30');
      assert.strictEqual(notice.recurLabelOf(g), '每月前三周 周三 17:30');
      // 超过本月前三次后 → 下月第 1 个周三（2026-11-26 之后 → 12-02）
      const late = new Date(2026, 10, 26, 12, 0).getTime();
      assert.strictEqual(notice.nextTextOf(g, late), '下次 12-02 周三 17:30');
      // startAt 之前不算开始：startAt = 2026-11-20 → 11 月剩余周三 25 日（第 4 次，不在 weeks）→ 12-02
      const g2 = JSON.parse(JSON.stringify(g));
      g2.recurrence.startAt = '2026-11-20T17:30:00+08:00';
      assert.strictEqual(notice.nextTextOf(g2, now), '下次 12-02 周三 17:30');
    });

    await test('需求9：weekly / monthly_day / daily 三种频率的下次时间', function () {
      purge();
      const notice = R('utils/notice.js');
      const now = new Date(2026, 10, 5, 10, 0).getTime();       // 周四 10:00
      assert.strictEqual(notice.nextTextOf({ recurrence: { freq: 'weekly', weekday: 6, time: '09:00' } }, now), '下次 11-07 周六 09:00');
      assert.strictEqual(notice.nextTextOf({ recurrence: { freq: 'monthly_day', day: 15, time: '20:00' } }, now), '下次 11-15 周日 20:00');
      assert.strictEqual(notice.nextTextOf({ recurrence: { freq: 'daily', time: '08:00' } }, now), '下次 11-06 周五 08:00');
      // 今天 08:00 已过 → 明天；未过 → 今天
      assert.strictEqual(notice.nextTextOf({ recurrence: { freq: 'daily', time: '18:00' } }, now), '下次 11-05 周四 18:00');
      assert.strictEqual(notice.nextOf({}, now), null);
      assert.strictEqual(notice.nextOf({ recurrence: { freq: 'bad' } }, now), null);
    });

    await test('需求9：长期安排不判过期 / 不计入待处理 / 不参与「最紧急一条」', function () {
      purge();
      const notice = R('utils/notice.js');
      const rec = { id: 'g1', recurrence: { freq: 'monthly_weeks', weekday: 3, weeks: [1, 2, 3], time: '17:30', startAt: '2020-01-01T17:30:00+08:00', label: '每月前三周 周三 17:30' }, deadline: '2020-01-01T00:00:00+08:00', actionable: false, title: '宿舍卫生检查' };
      const soon = { id: 'g2', title: '报名', deadline: new Date(Date.now() + 3600000).toISOString(), actionable: true };
      const st = notice.statusOf(rec);
      assert.strictEqual(st.expired, false);
      assert.strictEqual(st.key, 'recurring');
      // 契约 2026-11-05 §2.2：长期安排 label = 「长期安排 · <label>」
      assert.strictEqual(st.label, '长期安排 · 每月前三周 周三 17:30');
      assert.strictEqual(notice.isExpired(rec), false, '有 deadline 且已过也不判过期');
      const stat = notice.statOf([rec, soon], {});
      assert.strictEqual(stat.pending, 1, '长期安排不计入待处理，只有 g2');
      assert.strictEqual(stat.expired, 0);
      const u = notice.mostUrgent([rec, soon], {});
      assert.strictEqual(u.id, 'g2');
      // actionable=false 的普通通知也不计入待处理
      assert.strictEqual(notice.statOf([Object.assign({}, soon, { actionable: false })], {}).pending, 0);
    });

    await test('需求12：override_json 套用（白名单字段；null 表示清空该字段）', function () {
      purge();
      const notice = R('utils/notice.js');
      const g = { id: 'g', title: '原标题', cat: '活动', summary: 'old', deadline: '2026-01-01T00:00:00+08:00', _override: { title: '新标题', cat: '教务', deadline: null, timeLabel: '报名 11-07 12:00' } };
      const out = notice.applyOverride(g);
      assert.strictEqual(out.title, '新标题');
      assert.strictEqual(out.cat, '教务');
      assert.strictEqual(out.deadline, undefined, 'null = 清空覆盖字段');
      assert.strictEqual(out.timeLabel, '报名 11-07 12:00');
      assert.strictEqual(g.title, '原标题', '不应修改原对象');
      assert.deepStrictEqual(notice.applyOverride({ id: 'x' }), { id: 'x' }, '无 override 原样返回');
    });

    /* ============================================================
       审核相关（用户 2026-11-05 指示）：除云端测试身份外，不保留任何审核功能。
       本用例锁定「审核模式已移除」的现状，防止后续被重新加回。
       ============================================================ */
    await test('审核：不保留审核模式（产品源码无相关引用/入口；身份页仍是学号+姓名登录）', function () {
      ['utils/demo.js', 'utils/demo-data.js'].forEach(function (f) {
        assert.ok(!fs.existsSync(path.join(ROOT, f)), '不应保留审核模式文件：' + f);
      });
      const files = [
        'utils/cloud.js', 'utils/store.js', 'utils/identity.js', 'utils/notify.js',
        'pages/identity/identity.js', 'pages/identity/identity.wxml',
        'pages/me/me.js', 'pages/me/me.wxml', 'pages/data/data.js'
      ];
      files.forEach(function (f) {
        const t = src(f);
        assert.ok(!/demo/i.test(t), f + ' 不应再有相关引用');
        assert.ok(!/演示模式|审核用|审核员/.test(t), f + ' 不应再有审核文案');
      });
      const idWxml = src('pages/identity/identity.wxml');
      assert.ok(/bindtap="submit"/.test(idWxml), '身份页应保留学号+姓名登录');
      // 文档允许说明「本版不实现审核模式」，但不得再把审核入口/模式描述成可用功能
      const readme = src('README.md');
      assert.ok(!/审核模式入口|审核模式预览|（审核用）|审核员可/.test(readme), 'README 不应再把演示/审核模式描述为可用功能');
      assert.ok(/ai_toggle\.py --off/.test(readme), 'README 应保留发版前 AI 开发模式关闭说明（合规配置）');
      const changelog = src('CHANGELOG.md');
      assert.ok(!/审核模式入口|审核模式预览|（审核用）|审核员可/.test(changelog), 'CHANGELOG 不应再把演示/审核模式描述为可用功能');
    });

    /* ============================================================
       需求 12：通知管理员编辑 / 删除 / 恢复（cloud PATCH 契约 + 通知页交互）
       ============================================================ */
    await test('需求12：cloud.ntAdminEdit/ntAdminHide 走 PATCH notices?id=eq.auto_<gid>（override_json/hidden/edited_at/edited_by）', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const { cloud } = fresh();
      enableCloud(cloud);
      C.setReq(function (o) { o.success({ statusCode: 200, data: [] }); });
      const patchLog = [];
      C.setReq(function (o) { patchLog.push(o); o.success({ statusCode: 200, data: [] }); });
      const ok = await cloud.ntAdminEdit('g_test', { title: '管理员改名', cat: '教务' });
      assert.strictEqual(ok, true);
      const req = patchLog[0];
      assert.strictEqual(req.method, 'PATCH');
      assert.ok(String(req.url).indexOf('/notices?id=eq.auto_g_test') >= 0, 'PATCH 路径应为 notices?id=eq.auto_<gid>：' + req.url);
      const body = req.data;
      assert.strictEqual(typeof body.override_json, 'string');
      const ov = JSON.parse(body.override_json);
      assert.strictEqual(ov.title, '管理员改名');
      assert.strictEqual(ov.cat, '教务');
      assert.ok(body.edited_at > 0 && typeof body.edited_at === 'number');
      assert.strictEqual(body.edited_by, ID.sid);
      assert.ok(!(req.header && req.header.Prefer), '管理员写通知不应要求 return=representation');
      assert.strictEqual(req.header['X-Class-Token'], ID.token, '应带身份 token');
      // 删除 / 恢复
      patchLog.length = 0;
      assert.strictEqual(await cloud.ntAdminHide('g_test', true), true);
      assert.strictEqual(patchLog[0].data.hidden, true);
      patchLog.length = 0;
      assert.strictEqual(await cloud.ntAdminHide('g_test', false), true);
      assert.strictEqual(patchLog[0].data.hidden, false);
      // 非管理员：拒绝且零请求
      C.setIdentity(ID2);
      purge();
      const c2 = fresh(); enableCloud(c2.cloud);
      C.reqLog().length = 0;
      assert.strictEqual(await c2.cloud.ntAdminEdit('g_test', { title: 'x' }), false, '非管理员不得编辑');
      assert.strictEqual(C.reqLog().length, 0, '非管理员不应发写请求');
    });

    await test('需求12：通知轻量签名纳入 hidden/edited_at（否则管理员改动永远命中缓存）', function () {
      purge();
      const { cloud } = fresh();
      const a = cloud.ntSigOf([{ id: 'auto_x', ts: 100, hidden: false, edited_at: 0 }]);
      const b = cloud.ntSigOf([{ id: 'auto_x', ts: 100, hidden: true, edited_at: 0 }]);
      const c = cloud.ntSigOf([{ id: 'auto_x', ts: 100, hidden: false, edited_at: 12345 }]);
      assert.notStrictEqual(a, b, 'hidden 变化必须改变签名（ts 不变）');
      assert.notStrictEqual(a, c, 'edited_at 变化必须改变签名（ts 不变）');
      assert.ok(a.indexOf('0') >= 0 && b.indexOf('1') >= 0, '签名应包含 hidden 位');
      const js = src('utils/cloud.js');
      assert.ok(/select=id,ts,hidden,edited_at/.test(js), '轻量签名查询应 select hidden/edited_at');
      assert.ok(/_hidden\s*=\s*!!r\.hidden/.test(js) && /_override\s*=\s*ntParseOverride/.test(js), '整表解析应保留 hidden/override_json');
    });

    await test('需求12：通知页解析 override/hidden + 管理员「已隐藏」筛选 + 编辑/删除/恢复', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const { cloud } = fresh();
      enableCloud(cloud);
      ntPullMock(C, sampleNoticeGroups(), ['g3'], { g2: { title: '已改名通知' } });
      const def = loadPage('nt/nt');
      const ctx = ctxOf(def, {
        _raw: [], _all: [], _expanded: {}, _done: {}, _remind: {}, _imgs: {}, _loadingImgs: {},
        _first: true, _lastPull: 0, _remindAt: 0, _remindPulling: false, _foldTimers: {},
        _pendingGid: '', _pendingFilter: '',
        data: JSON.parse(JSON.stringify(def.data))
      });
      ctx.data.isAdmin = true;
      await ctx.pull(true);
      await sleep(20);
      assert.strictEqual(ctx.data.state, 'ready');
      assert.ok(ctx.data.cards.length >= 1, '正常列表应有未隐藏通知');
      assert.ok(!ctx.data.cards.some(function (c) { return c.id === 'g3'; }), '默认筛选不显示已隐藏通知');
      assert.ok(!ctx.data.cards.some(function (c) { return c.id === 'g1'; }), '2026-11-12：长期安排移出主列表，进长期通知区');
      assert.strictEqual(ctx.data.hasHidden, 1, '管理员应知道有 1 条已隐藏');
      // 长期安排卡片字段（需求 9；2026-11-12 移到 longtermCards）
      assert.strictEqual(ctx.data.longtermCount, 1, '长期区只有 g1');
      const rec = ctx.data.longtermCards.filter(function (c) { return c.id === 'g1'; })[0];
      assert.ok(rec && rec.recurring === true, '长期安排卡片应有 recurring 标记');
      // 契约 2026-11-05 §2.2：状态 chip = 「长期安排 · label」（label 来自 recurrence.label）
      assert.strictEqual(rec.statusLabel, '长期安排 · 每月前三周 周三 17:30');
      assert.ok(/^下次 \d\d-\d\d 周[日一二三四五六] \d\d:\d\d$/.test(rec.nextText), '长期安排应显示下次时间：' + rec.nextText);
      assert.strictEqual(rec.canDone, false, '长期安排不显示「标记已处理」');
      assert.strictEqual(rec.admin, true);
      // 简报统计不含长期安排/已隐藏
      assert.strictEqual(ctx.data.stats.pending, 1, '仅 g2 计入待处理');
      // 覆盖套用（标题改为已改名通知）
      const g2 = ctx.data.cards.filter(function (c) { return c.id === 'g2'; })[0];
      assert.strictEqual(g2.title, '已改名通知', 'override_json 应套用到卡片标题');
      assert.strictEqual(g2.updated, true, '有 updatedAt/edited_at 应显示「已更新」');
      // 已隐藏筛选
      ctx.data.filter = 'hidden';
      ctx.applyFilter();
      assert.strictEqual(ctx.data.cards.length, 1);
      assert.strictEqual(ctx.data.cards[0].id, 'g3');
      assert.strictEqual(ctx.data.cards[0].hidden, true);
      // 恢复
      C.setReq(function (o) { o.success({ statusCode: 200, data: [] }); });
      ctx.adminRestore({ currentTarget: { dataset: { gid: 'g3' } } });
      await sleep(20);
      assert.strictEqual(ctx._rawById('g3')._hidden, false, '恢复后 raw 不应再 hidden');
      // 删除
      ctx.adminDelete({ currentTarget: { dataset: { gid: 'g2' } } });
      await sleep(20);
      assert.strictEqual(ctx._rawById('g2')._hidden, true, '删除后 raw 标记 hidden');
      // 编辑：打开弹层 → 改字段 → 保存
      ctx.data.isAdmin = true;
      C.setReq(function (o) { o.success({ statusCode: 200, data: [] }); });
      ctx.openEdit({ currentTarget: { dataset: { gid: 'g1' } } });
      assert.strictEqual(ctx.data.editSheet, true);
      assert.strictEqual(ctx.data.editTitle, '宿舍卫生检查安排');
      ctx.onEditField({ currentTarget: { dataset: { k: 'title' } }, detail: { value: '长期安排（编辑后）' } });
      ctx.saveEdit();
      await sleep(20);
      assert.strictEqual(ctx.data.editSheet, false);
      assert.strictEqual(ctx._rawById('g1')._override.title, '长期安排（编辑后）');
      assert.ok(ctx._rawById('g1')._editedAt > 0, '保存后应记录编辑时间');
    });

    await test('需求7：通知附件缺失显示「待获取」，点击提示去来源群查看并复制群名（有 url 仍走预览/下载）', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const { cloud } = fresh();
      enableCloud(cloud);
      const due = new Date(Date.now() + 86400000).toISOString();
      const groups = [{
        id: 'gf', _i: 0, title: '通知带附件', cat: '教务', source: 'QQ 群「示例班级群」', actionable: true,
        deadline: due, summary: '', aiSummary: '',
        items: [
          { kind: 'file', name: '未获取附件.pdf', size: '128 KB' },                                  // 无 url = 暂未获取
          { kind: 'file', name: '已获取附件.pdf', url: 'data:application/pdf;base64,JVBERg==' }       // 有 url = 正常
        ]
      }];
      ntPullMock(C, groups);
      const def = loadPage('nt/nt');
      const ctx = ctxOf(def, {
        _raw: [], _all: [], _expanded: {}, _done: {}, _remind: {}, _imgs: {}, _loadingImgs: {},
        _first: true, _lastPull: 0, _remindAt: 0, _remindPulling: false, _foldTimers: {},
        _pendingGid: '', _pendingFilter: ''
      });
      await ctx.pull(true);
      await sleep(20);
      const card = (ctx.data.cards || [])[0];
      assert.ok(card, '通知卡应渲染');
      const files = (card.items || []).filter(function (x) { return x.kind === 'file'; });
      assert.strictEqual(files.length, 2);
      assert.strictEqual(files[0].pending, true, '无 url 的附件应标记「待获取」');
      assert.strictEqual(files[0].hasUrl, false);
      assert.strictEqual(files[1].pending, false, '有 url 的附件不标记待获取');
      assert.strictEqual(files[1].hasUrl, true);
      assert.ok(card.groupName.indexOf('示例班级群') >= 0, '卡片应带通知来源群名：' + card.groupName);

      // 点击「待获取」→ 弹窗（内容含来源群名 / 确认按钮=复制群名）→ 复制群名
      const prevModal = global.wx.showModal, prevClip = global.wx.setClipboardData;
      let modalArg = null, clipData = null;
      global.wx.showModal = function (o) { modalArg = o; if (o && o.success) o.success({ confirm: true, cancel: false }); };
      global.wx.setClipboardData = function (o) { clipData = o && o.data; if (o && o.success) o.success(); };
      def.filePending.call(ctx, { currentTarget: { dataset: { gid: 'gf', i: 0 } } });
      global.wx.showModal = prevModal;
      global.wx.setClipboardData = prevClip;
      assert.ok(modalArg, '应弹窗提示');
      assert.ok(/暂未获取/.test(modalArg.content) && /QQ 群「示例班级群」/.test(modalArg.content), '提示文案应含来源群名：' + (modalArg && modalArg.content));
      assert.strictEqual(modalArg.confirmText, '复制群名');
      assert.ok(clipData && clipData.indexOf('示例班级群') >= 0, '确认后应复制群名：' + clipData);
      // 已有 url 的附件点击「待获取」不应弹窗（走预览/下载）
      let modal2 = null;
      global.wx.showModal = function (o) { modal2 = o; };
      def.filePending.call(ctx, { currentTarget: { dataset: { gid: 'gf', i: 1 } } });
      global.wx.showModal = prevModal;
      assert.strictEqual(modal2, null, '有 url 的附件不弹「待获取」');
      // 静态：WXML 有待获取徽标 + 点击入口；样式有 pending 态
      const wxml = src('pages/nt/nt.wxml');
      const wxss = src('pages/nt/nt.wxss');
      assert.ok(/待获取/.test(wxml) && /filePending/.test(wxml), 'nt.wxml 应有待获取徽标与点击入口');
      assert.ok(/nt-file--pending/.test(wxss) && /nt-file-badge/.test(wxss), 'nt.wxss 应有待获取样式');
    });

    /* ============================================================
       需求 11：工作台双卡轮换 + 常驻浮动 + 暂停/降级
       ============================================================ */
    await test('需求11：工作台两卡同时展示最新条目（作业列表按截止升序、通知排除长期安排/已处理）', function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const { store } = fresh();
      store.get().homework = [
        { id: 'h1', subject: '示例作业 A', due: '', date: dayAfter(20), time: '18:00', ts: 1 },
        { id: 'h2', subject: '示例作业 B', due: '', date: dayAfter(7), time: '18:00', ts: 2 },
        { id: 'h3', subject: '示例作业 C', due: '', date: dayAfter(1), time: '18:00', ts: 3 }
      ];
      store.get().ntDone = { g5: true };           // 已处理的一条：不应出现在轮换列表/待处理计数
      store.save();
      const def = loadPage('index/index');
      const ctx = ctxOf(def, { _hidden: false, _first: true });
      ctx.refresh();
      assert.strictEqual(ctx.data.hw.open, 3);
      assert.strictEqual(ctx.data.hw.items.length, 3, '作业卡应带轮换条目列表');
      assert.strictEqual(ctx.data.hw.title, '示例作业 C', '第一条 = 最早截止的作业');
      assert.ok(ctx.data.hw.anim === '');
      def._rotStop.call(ctx);                      // 测试内不留 5s 轮换计时器
      // 通知视图：排除已处理 / 长期安排 / 行动=false
      const gs = sampleNoticeGroups().slice();
      gs.push({ id: 'g4', title: '无行动项', actionable: false, summary: '' });
      gs.push({ id: 'g5', title: '已处理通知', deadline: '2026-12-30T18:00:00+08:00', actionable: true, summary: '' });
      const view = def.ntView.call(ctx, gs);
      assert.strictEqual(view.state, 'ok');
      assert.ok(view.items.length >= 1);
      assert.strictEqual(view.items[0].title, '报名通知（待处理）');
      assert.ok(!view.items.some(function (x) { return x.title === '宿舍卫生检查安排'; }), '长期安排不进轮换');
      assert.ok(!view.items.some(function (x) { return x.title === '无行动项'; }), 'actionable=false 不进轮换');
      assert.ok(!view.items.some(function (x) { return x.title === '已处理通知'; }), '已处理不进轮换');
      assert.strictEqual(view.pending, 1, '已处理 g5 不计入待处理，只剩 g2');
    });

    await test('需求11：轮换只更新文案字段（上浮淡出→下浮淡入），≤1 条不轮换，隐藏时暂停', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const { store } = fresh();
      store.get().homework = [
        { id: 'h1', subject: '作业一', date: dayAfter(5), time: '18:00', ts: 1 },
        { id: 'h2', subject: '作业二', date: dayAfter(10), time: '18:00', ts: 2 }
      ];
      store.save();
      const def = loadPage('index/index');
      const ctx = ctxOf(def, { _hidden: false, _rot: null, _rotTimers: [], state: 'data' });
      ctx.data.state = 'data';
      ctx.refresh();
      await sleep(30);                          // 冲刷 refresh 内异步 setData（通知缓存）
      def._rotStop.call(ctx);
      ctx.__log.length = 0;
      def._rotateCard.call(ctx, 'hw');
      await sleep(320);                         // 上浮淡出结束（260ms）→ 换文案 + 下浮淡入
      const keys = [];
      ctx.__log.forEach(function (ks) { keys.push.apply(keys, ks); });
      keys.forEach(function (k) {
        assert.ok(/^hw\.(anim|idx|title|sub)$/.test(k), '轮换只应更新文案字段，出现：' + k);
      });
      assert.strictEqual(ctx.data.hw.title, '作业二', '轮换到第二条');
      assert.strictEqual(ctx.data.hw.idx, 1);
      assert.strictEqual(ctx.data.hw.anim, 'in');
      await sleep(400);
      assert.strictEqual(ctx.data.hw.anim, '', '下浮淡入结束后清空动画类');
      // ≤1 条：不启动计时器
      ctx.data.hw.items = [{ title: '唯一', sub: '' }];
      def._restartRotate.call(ctx);
      assert.strictEqual(ctx._rot, null, '≤1 条不应轮换');
      // ≥2 条：启动；隐藏后 tick 不生效
      ctx.data.hw.items = [{ title: 'a', sub: '' }, { title: 'b', sub: '' }];
      def._restartRotate.call(ctx);
      assert.ok(ctx._rot, '≥2 条应启动轮换计时器');
      ctx._hidden = true;
      const before = ctx.data.hw.idx;
      def._rotTick.call(ctx);
      await sleep(320);
      assert.strictEqual(ctx.data.hw.idx, before, '页面隐藏时轮换暂停');
      def._rotStop.call(ctx);
      assert.strictEqual(ctx._rot, null);
    });

    await test('需求11：静态 —— 双卡常驻浮动 / 轮换动画 / reduced-motion 降级 / 5s 间隔', function () {
      const js = src('pages/index/index.js');
      const wxml = src('pages/index/index.wxml');
      const wxss = src('pages/index/index.wxss');
      assert.ok(/ROT_MS = 5000/.test(js), '轮换间隔应为 5s');
      assert.ok(/wb-task--float/.test(wxml), '两张待办卡应带常驻浮动类');
      assert.strictEqual((wxml.match(/wb-task--float(?!-)/g) || []).length, 2, '作业/通知两张卡都应有常驻浮动');
      assert.strictEqual((wxml.match(/wb-rot /g) || []).length, 2, '两卡内最新一条都应走轮换动画');
      assert.ok(/@keyframes wbRotOut/.test(wxss) && /@keyframes wbRotIn/.test(wxss), '缺少上浮淡出/下浮淡入关键帧');
      assert.ok(/@keyframes wbFloat/.test(wxss), '缺少常驻轻微浮动关键帧');
      assert.ok(/@media \(prefers-reduced-motion: reduce\)/.test(wxss), '缺少减少动效降级');
      assert.ok(/\.26s/.test(wxss) && /\.32s/.test(wxss), '动画时长应克制（.26s/.32s）');
      assert.ok(/onHide\(\)[\s\S]{0,200}_rotStop/.test(js), '页面隐藏时应暂停轮换');
      assert.ok(/_motionOk\(\)/.test(js) && /SDKVersion/.test(js), '低版本应降级（SDKVersion 判断）');
    });

    /* ============================================================
       需求 13：全局动画统一（时长 / 降级 / 通知展开收起高度过渡）
       ============================================================ */
    await test('需求13：全局 reduced-motion 降级 + 克制时长；通知展开/收起高度过渡', function () {
      const app = src('app.wxss');
      assert.ok(/@media \(prefers-reduced-motion: reduce\)/.test(app), 'app.wxss 应有全局减少动效降级');
      assert.ok(/--md-dur-short:\s*200ms/.test(app) && /--md-dur-medium:\s*300ms/.test(app), '全局动效 token 应在 200–300ms');
      assert.ok(/animation-duration: 320ms/.test(app), '按钮 ripple 反馈应统一到 320ms 以内');
      const nt = src('pages/nt/nt.wxss');
      assert.ok(/@keyframes ntDetailOpen/.test(nt) && /@keyframes ntDetailClose/.test(nt), '通知展开/收起应有高度过渡关键帧');
      assert.ok(/max-height/.test(nt) && /overflow: hidden/.test(nt), '展开收起用 max-height + overflow 过渡');
      assert.ok(/@media \(prefers-reduced-motion: reduce\)/.test(nt), '通知动画应有减少动效降级');
      const ntJs = src('pages/nt/nt.js');
      assert.ok(/closing/.test(ntJs) && /_clearFoldTimers/.test(ntJs), '收起动画结束再移除内容，并在页面隐藏时清理');
      // 弹层（bottom-sheet 组件）已有进入动画
      const bs = src('components/bottom-sheet/index.wxss');
      assert.ok(/@keyframes bsUp/.test(bs) && /@keyframes bsFade/.test(bs), 'bottom-sheet 进入动画保留');
      // 页面进入动画级联保留
      assert.ok(/@keyframes mdEnter/.test(app) && /\.enter-6/.test(app));
    });

    /* ============================================================
       需求 14：体测 sex/grade 同步（udSections 显式包含 + ft 页 onShow 刷新）
       ============================================================ */
    await test('需求14：udSections().fit 显式包含 sex/grade；远端应用后 ft 页 onShow 刷新 UI', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const { store, cloud } = fresh();
      enableCloud(cloud);
      store.get().fit = { sex: 'f', grade: '34', h: '170', w: '60', vc: '', r50: '', sit: '', jump: '', pull: '', durM: '', durS: '' };
      store.save();
      const view = cloud.udSections();
      assert.strictEqual(view.fit.sex, 'f', 'udSections().fit 必须带 sex');
      assert.strictEqual(view.fit.grade, '34', 'udSections().fit 必须带 grade');
      // 远端 blob 应用（另一端把 sex/grade 改了）
      const blob = JSON.stringify({
        v: 6, at: { homeTools: 0, fit: 200, draw: 0, group: 0, roster: 0, hide: 0, tt: 0, prefs: 0, nick: 0 },
        fit: { sex: 'm', grade: '12', h: '180' }, homeTools: [], draw: {}, group: {}, roster: { rosterSel: [], rollSel: [], rollSt: {}, rollNames: '' }, hide: { hwHide: {}, ntHide: {} }, tt: { termView: '', termStart: '' }, prefs: { hwRemind: {}, ntSub: false, ntSubAt: 0 }, nick: '', homeToolsAt: 0
      });
      cloud.udApply(blob);
      store.reload();
      assert.strictEqual(store.get().fit.sex, 'm');
      assert.strictEqual(store.get().fit.grade, '12');
      assert.strictEqual(store.get().fit.h, '180');
      // ft 页 onShow → _syncFit 拉云端；onCloudSync 重绘 UI
      const def = loadPage('ft/ft');
      const ctx = ctxOf(def, { _first: false, _typingAt: 0, _hoAt: 0, _agent: null, _agentQ: null });
      ctx.data.state = 'data';
      // 本机旧值（另一端刚在网页把 sex/grade 改成 m/12）→ 应用远端后再进 ft 页，UI 必须刷新
      store.get().fit = { sex: 'f', grade: '34', h: '150' };
      store.save();
      const remote2 = JSON.parse(blob);
      remote2.at.fit = Date.now() + 1000;
      remote2.fit = { sex: 'm', grade: '12', h: '180' };
      cloud.udApply(remote2);
      store.reload();
      def.onCloudSync.call(ctx);
      assert.strictEqual(ctx.data.sex, 'm', 'ft 页应显示远端 sex');
      assert.strictEqual(ctx.data.grade, '12', 'ft 页应显示远端 grade');
      assert.strictEqual(ctx.data.form.h, '180', 'ft 页应显示远端体测输入');
      // 契约夹具/两端字段一致：fit keys 必须与网页端 UD_FIT_KEYS 相同
      const expect = ['sex', 'grade', 'h', 'w', 'vc', 'r50', 'sit', 'jump', 'pull', 'durM', 'durS'];
      const defs = R('utils/store.js').DEF.fit;
      expect.forEach(function (k) { assert.ok(k in defs, 'store DEF.fit 缺字段：' + k); });
      assert.ok(fs.existsSync(WEB_INDEX), '网页端 index.html 应存在（跨端契约核对）');
      const web = fs.readFileSync(WEB_INDEX, 'utf8');
      const m = web.match(/var UD_FIT_KEYS=\[([^\]]*)\]/);
      assert.ok(m, '网页端应有 UD_FIT_KEYS');
      const webKeys = m[1].split(',').map(function (s) { return s.replace(/["'\s]/g, ''); }).filter(Boolean);
      assert.deepStrictEqual(webKeys.slice().sort(), expect.slice().sort(), '两端 fit 字段集合必须一致（契约 §4）');

      // —— pages/fttable（国标评分表页）：选择男女/年级必须写回 store.fit 并触发同步 ——
      store.get().fit = { sex: 'f', grade: '34', h: '165' };
      store.save();
      purge();                                    // 重新加载页面模块（store 保持磁盘数据）
      const store2 = R('utils/store.js');
      const cloud2 = R('utils/cloud.js'); enableCloud(cloud2);
      const ftDef = loadPage('fttable/fttable');
      const ftctx = ctxOf(ftDef, { _agent: null, _agentQ: null });
      ftDef.onLoad.call(ftctx, {});
      assert.strictEqual(ftctx.data.sex, 'f', 'fttable 初始男女应取自 store.fit');
      assert.strictEqual(ftctx.data.grade, '34', 'fttable 初始年级应取自 store.fit');
      assert.ok(ftctx.data.rows.some(function (r) { return r.n === '1 分钟仰卧起坐'; }), '女生态度评分表应显示仰卧起坐');
      ftDef.setSex.call(ftctx, { currentTarget: { dataset: { v: 'm' } } });
      assert.strictEqual(store2.get().fit.sex, 'm', 'fttable 选男 → 写回 store.fit.sex');
      assert.strictEqual(store2.get().fit.h, '165', '写回 sex 不应丢失其它体测输入');
      ftDef.setGr.call(ftctx, { currentTarget: { dataset: { v: '12' } } });
      assert.strictEqual(store2.get().fit.grade, '12', 'fttable 选大一大二 → 写回 store.fit.grade');
      // 已持久化到本机存储（换页/重启后可读）
      const persisted = JSON.parse(C.mem['zq_tools_v2']);
      assert.strictEqual(persisted.fit.sex, 'm');
      assert.strictEqual(persisted.fit.grade, '12');
      // udSections（上云 body 的来源）也立即带上新值
      assert.strictEqual(cloud2.udSections().fit.sex, 'm', 'userdata fit section 应带 fttable 的选择');
      assert.strictEqual(cloud2.udSections().fit.grade, '12');
      // 主 ft 页再次 onShow → load() 读 store，显示同一个值
      const ftMain = loadPage('ft/ft');
      const ftMainCtx = ctxOf(ftMain, { _agent: null, _agentQ: null, _first: false });
      ftMainCtx.data.state = 'data';
      ftMain.load.call(ftMainCtx);
      assert.strictEqual(ftMainCtx.data.sex, 'm', '体测主页应显示 fttable 选的男');
      assert.strictEqual(ftMainCtx.data.grade, '12', '体测主页应显示 fttable 选的大一大二');
      // 反向：体测主页改性别 → fttable 新实例显示新值
      store2.get().fit.sex = 'f'; store2.get().fit.grade = '34'; store2.save();
      const ftDef2 = loadPage('fttable/fttable');
      const ftctx2 = ctxOf(ftDef2, { _agent: null, _agentQ: null });
      ftDef2.onLoad.call(ftctx2, {});
      assert.strictEqual(ftctx2.data.sex, 'f', 'fttable 重开应显示体测主页改后的性别');
      assert.strictEqual(ftctx2.data.grade, '34');
      try { cloud2.udStop(); } catch (e) { /* 清掉可能排队的 userdata 推送防抖 */ }
    });

    /* ============================================================
       需求 16：marks 强制刷新 / 补发 / 页面重绘
       ============================================================ */
    await test('需求16：marksPull(true) 绕过 TTL 强制拉；变化后通知页面重绘；markPend 恢复后补发', async function () {
      purge();
      C.clearMem();
      C.setIdentity(ID);
      const { store, cloud } = fresh();
      enableCloud(cloud);
      let notifyN = 0;
      global.getApp = function () { return { notifyPages: function () { notifyN += 1; } }; };
      // 第一次拉取：远端 ntDone → 本机应用 + 通知页面重绘
      C.setReq(function (o) {
        if (String(o.url).indexOf('/marks') >= 0 && o.method === 'GET') {
          return o.success({ statusCode: 200, data: [{ id: ID.sid + '|ntdone|g9', seat: ID.sid, kind: 'ntdone', ref: 'g9', val: true, ts: 1 }] });
        }
        return o.success({ statusCode: 200, data: [] });
      });
      await cloud.marksPull(true);
      assert.strictEqual(store.get().ntDone.g9, true, '远端已处理应写入本机');
      await sleep(80);
      assert.ok(notifyN >= 1, 'marks 变化后应 notifyPages 重绘');
      // TTL 内非 force 不再请求；force 必须再请求
      C.reqLog().length = 0;
      await cloud.marksPull(false);
      assert.strictEqual(C.reqLog().length, 0, 'TTL 内非 force 应 0 请求');
      await cloud.marksPull(true);
      assert.strictEqual(C.reqLog().length, 1, 'force 必须绕过 TTL 强制拉一次');
      // 写入失败 → markPend；恢复后 cloudPull → flushPending 补发成功并清队列
      C.setReq(function (o) { if (o.fail) o.fail({ errMsg: 'mock-fail' }); else o.success({ statusCode: 500, data: [] }); });
      const ok = await cloud.setMark('ntdone', 'g10', true);
      assert.strictEqual(ok, false, '写入失败应返回 false');
      assert.strictEqual(store.get().ntDone.g10, true, '本机已生效');
      assert.ok((store.get().markPend || []).some(function (p) { return p.ref === 'g10'; }), '失败应进待补发队列 markPend');
      C.setReq(function (o) { o.success({ statusCode: 200, data: [] }); });
      await cloud.cloudPull(true);
      await sleep(60);                          // flushPending 的补发请求是异步落定的
      assert.strictEqual((store.get().markPend || []).length, 0, '恢复后应补发并清空 markPend');
      global.getApp = prevGetApp;
    });

    await test('需求16：hw/nt/index 页面 onShow / 下拉刷新 / onCloudSync 强制 marksPull(true)', function () {
      ['pages/hw/hw.js', 'pages/nt/nt.js', 'pages/index/index.js'].forEach(function (rel) {
        const s = src(rel);
        assert.ok(/cloud\.marksPull\(true\)/.test(s), rel + ' 应强制拉一次 marks');
      });
      assert.ok(/marksSync\(\)/.test(src('pages/hw/hw.js')), 'hw 页应有 marksSync');
      assert.ok(/onCloudSync\(\) \{ this\.refresh\(\); this\.marksSync\(\); \}/.test(src('pages/hw/hw.js')), 'hw 页 onCloudSync 应刷新 marks');
      assert.ok(/cloud\.marksPull\(true\)/.test(src('app.js')), 'app.onShow 回到前台应强制拉 marks');
    });

    /* ============================================================
       需求 3/5：滑动卡住 / 手势异常审计（静态）
       ============================================================ */
    await test('需求5：滑动卡死/手势冲突审计 —— 无全局 body 锁残留、弹层遮罩拦截滚动后可解除、页面隐藏不残留动画', function () {
      // 小程序无 body/锁屏类；确认没有网页端那类全局锁混入
      const all = walk(path.join(ROOT, 'pages'), []).concat(walk(path.join(ROOT, 'utils'), []));
      all.forEach(function (f) {
        if (!/\.(js|wxml|wxss)$/.test(f)) return;
        const s = fs.readFileSync(f, 'utf8');
        assert.ok(s.indexOf('nt-modal-open') < 0 && s.indexOf('id-locked') < 0 && s.indexOf('rst-lock') < 0,
          '不应出现网页端 body 锁类（小程序不存在 body 锁）：' + f);
      });
      // 弹层：bottom-sheet 只在 show 时挂载（关闭即卸载遮罩，不会永久阻止滚动）
      const bs = src('components/bottom-sheet/index.wxml');
      assert.ok(/wx:if="\{\{show\}\}"/.test(bs), 'bottom-sheet 应仅在 show 时挂载（关闭即解除遮罩）');
      assert.ok(/catchtouchmove="noop"/.test(bs), '弹层遮罩应拦截遮罩上的滚动穿透');
      // tt：页面隐藏/卸载清理滑动手势与动画定时器；nt：清理展开收起定时器
      const tt = src('pages/tt/tt.js');
      assert.ok(/onHide\(\)[\s\S]{0,400}_swClear\(\)/.test(tt), 'tt onHide 应收尾滑动手势/动画');
      assert.ok(/onUnload\(\)[\s\S]{0,220}_swClear\(\)/.test(tt), 'tt onUnload 应收尾滑动手势/动画');
      const nt = src('pages/nt/nt.js');
      assert.ok(/onHide\(\)[\s\S]{0,200}_clearFoldTimers/.test(nt) && /onUnload\(\)[\s\S]{0,200}_clearFoldTimers/.test(nt), 'nt 页面隐藏/卸载应清展开收起定时器');
      // 内联 scroll-view 不嵌套纵向滚动（课表/评分表只横向）
      const ttWxml = src('pages/tt/tt.wxml');
      assert.ok(/scroll-x/.test(ttWxml) && !/scroll-y/.test(ttWxml), '课表周表只允许横向 scroll-view');
      // 顶部栏收缩只在阈值带内单次提交（不会来回抽动）
      assert.ok(/_scBusy/.test(tt) && /_scBusy/.test(src('pages/hw/hw.js')), '滚动态收缩应单次提交避免抖动');
    });

    await test('需求10：合规静态扫描（无 web-view / 支付 / 抽奖 / 外部小程序导流 / 第三方广告）', function () {
      const files = walk(ROOT, []).filter(function (f) {
        return /\.(js|json|wxml|wxss)$/.test(f) &&
          f.replace(/\\/g, '/').indexOf('/ai/') < 0 &&          // AI 独立分包由各自的契约测试覆盖（发版前整体关闭）
          f.indexOf('cloudfunctions') < 0;                       // 云函数（订阅消息）不属于客户端界面
      });
      const forbidden = [
        ['web-view', /<web-view/i],
        ['wx.requestPayment', /wx\.requestPayment/],
        ['wx.openBusinessView', /wx\.openBusinessView/],
        ['wx.navigateToMiniProgram', /wx\.navigateToMiniProgram/],
        ['激励视频/插屏广告', /createRewardedVideoAd|createInterstitialAd|createBannerAd/],
        ['外链下载 App', /itms-apps|apps\.apple\.com|apk/i],
        ['外部统计脚本', /hm\.baidu|google-analytics|umeng|cnzz/i]
      ];
      files.forEach(function (f) {
        const s = fs.readFileSync(f, 'utf8');
        forbidden.forEach(function (pair) {
          assert.ok(!pair[1].test(s), '源码出现违规能力「' + pair[0] + '」：' + f);
        });
      });
      // 只允许：1) CloudBase 网关 2) 站点静态 tt.json 3) 通知内容里的业务链接（用户数据）
      const cfg = src('utils/cloud-config.js');
      const urls = cfg.match(/https?:\/\/[^'"\s)]+/g) || [];
      urls.forEach(function (u) {
        assert.ok(/tcloudbasegateway\.com|tool\.furina\.fun|ko-link\.cn/.test(u), '配置文件出现未授权域名：' + u);
      });
      // 小程序备案号（2026-11-12 用户提供）：唯一来源 + 我的页底部展示 + 点击复制
      assert.ok(/闽ICP备2026042939号/.test(src('utils/compliance.js')), '备案号唯一来源缺失');
      assert.ok(/icpBeian/.test(src('pages/me/me.wxml')) && /copyIcp/.test(src('pages/me/me.js')), '我的页未展示备案号/复制处理');
      // 隐私口径：身份页 / 数据与隐私页 / 我的页都有说明
      assert.ok(/数据与隐私/.test(src('pages/identity/identity.wxml')) && /数据与隐私/.test(src('pages/me/me.wxml')) && /隐私说明/.test(src('pages/data/data.wxml')));
    });

    /* ============================================================
       汇总：本文件的静态断言之外，页面级行为在上面的 test 内已覆盖
       ============================================================ */
    // 收尾：停掉页面测试可能留下的轮换/防抖定时器，避免 unit.js 进程被 timer 挂住
    finishTimers();
    if (process.getActiveResourcesInfo) {
      const info = process.getActiveResourcesInfo();
      const nT = info.filter(function (x) { return x === 'Timeout'; }).length;
      if (nT > 0) console.log('WARN  v2 测试结束时仍有 Timeout：' + nT + ' 个 ' + JSON.stringify(info));
    }
  })().catch(function (e) { finishTimers(); throw e; });
}

module.exports = { run: run };

/* 独立运行：node v2_unit_tests.js */
if (require.main === module) {
  const results = [];
  let passN = 0, failN = 0;
  const test = async function (name, fn) {
    try { await fn(); passN += 1; results.push({ name: name, ok: true }); console.log('PASS  ' + name); }
    catch (e) { failN += 1; results.push({ name: name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
  };
  run(test).then(function () {
    const summary = { total: passN + failN, pass: passN, fail: failN, results: results, at: new Date().toISOString() };
    fs.writeFileSync(path.join(__dirname, 'v2_unit_result.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log('\n================ v2 unit: ' + passN + ' passed, ' + failN + ' failed ================');
    // 独立运行：页面/云模块可能留下轮换/防抖定时器（浏览器环境不存在进程退出的概念），
    // 测试结束显式退出，避免 node 进程被 timer 挂住。
    process.exit(failN ? 2 : 0);
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}
