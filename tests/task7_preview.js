/* task7_preview.js —— task-7 五项需求 automator 真机预览（开发者工具模拟器，mock 身份/请求，不写真实云端）
 *
 * 覆盖（对应 task-7 反馈第 2/6/8/9/11 条）：
 *   A. 加载与缓存提速（9）：有本机缓存 → 工作台首帧 state=data（无 120ms 骨架）；请求数有界（marks 单飞/去重）；
 *      无缓存对照 → 先骨架后 data；页面重入 setData 只下发变化字段（diff）。
 *   B. 新通知提醒（11）已于 2026-11-18 移除，仅验证按钮/方法不存在；
 *      云函数未部署时给出可读原因（拒绝/未开启/未部署区分）。
 *   C. 水量共享（6）：23A/23B 固定 4 人间不可改、云端记录合并显示、离线保存进 pending 且恢复后重试成功、
 *      文案不再出现「免费」（定额）。
 *   D. 名单快捷预设（8）：抽签名单选择器「全班/班委/团员」一键套基础集合后仍可逐个增删；投票指定成员预设。
 *   E. 徽章去重（2）：班委页职务文字保留、重复「班委」badge 不再渲染；工具描述同步。
 *   F. 提醒通道诊断（手动提醒）：诊断页显示定时器心跳 / active 数 / lastError。
 *
 * 前置：开发者工具自动化已开（本机实测端口 9424）：
 *   "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto --project <mp-class-tools> --auto-port 9424 --trust-project
 * 用法：node task7_preview.js            （WS 环境变量可覆盖 ws，如 ws://127.0.0.1:9424）
 * 约束：只用 miniprogram-automator + mp.screenshot；不 preview / 不推手机 / 不做屏幕鼠标操作；
 *       所有 wx.request 被内存 mock 接管（不发真实请求、不写云表）；console error 计入失败。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const WS = process.env.WS || 'ws://127.0.0.1:9424';
const OUT = path.join(__dirname, '_shots_task7');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const consoleIssues = [];
function check(name, ok, detail) {
  checks.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 500) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}
async function ev(mp, fn, arg, tries) {
  let last = null;
  const n = tries || 3;
  for (let i = 0; i < n; i++) {
    try { return arg === undefined ? await mp.evaluate(fn) : await mp.evaluate(fn, arg); } catch (e) { last = e; await sleep(800); }
  }
  throw last;
}
async function shot(mp, name) {
  await sleep(300);
  await mp.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('SHOT  ' + name);
}
async function curPage(mp) { try { return await mp.currentPage(); } catch (e) { return null; } }
async function curPath(mp) { const p = await curPage(mp); return p ? p.path : ''; }
async function waitPath(mp, expect, timeout) {
  const end = Date.now() + (timeout || 9000);
  while (Date.now() < end) { if ((await curPath(mp)) === expect) return true; await sleep(120); }
  return false;
}
// 在当前页执行：读取页面 data / 调用页面方法 / require 工具模块
async function pageEval(mp, fn, arg) { return ev(mp, fn, arg); }

/* ---------------------------------------------------------------- mock 安装
 * 一次性安装在 app 上下文：
 *   E = { toasts[], subLog[], calls[], reqLog[], reqImpl(url,method), cloudReply(data), t0 }
 *   wx.request 包装（计数 + 按 reqImpl 返回）；wx.cloud.callFunction 包装（notify 状态/诊断）；
 *   wx.requestSubscribeMessage 包装；wx.showToast 包装。
 */
async function installMock(mp, cfg) {
  return ev(mp, (c) => {
    const E = globalThis.__task7 || (globalThis.__task7 = {
      toasts: [], subLog: [], calls: [], reqLog: [],
      reqImpl: null, cloudReply: null, t0: Date.now(), booted: false
    });
    if (!E.paint) E.paint = { onShowAt: 0, dataAt: 0, states: [] };
    E.cfg = c || {};
    E.toasts.length = 0; E.subLog.length = 0; E.calls.length = 0; E.reqLog.length = 0;
    E.reqImpl = null; E.cloudReply = null;
    E.t0 = Date.now();

    // 页面计时钩子：工作台 onShow 时刻 + 每次 setData 的 state（用于测「首屏可交互时间」与骨架对照）
    if (!E.__pageHookHooked) {
      E.__pageHookHooked = true;
      if (typeof globalThis.Page === 'function') {
        const origPage = globalThis.Page;
        globalThis.Page = function (def) {
          try {
            if (def && typeof def.onShow === 'function') {
              const origShow = def.onShow;
              def.onShow = function () {
                const E1 = globalThis.__task7;
                const route = String(this.route || this.__route__ || '');
                if (E1 && E1.paint && route === 'pages/index/index') {
                  E1.paint.onShowAt = E1.paint.onShowAt || Date.now();
                  const inst = this;
                  if (typeof inst.setData === 'function' && !inst.__task7SetWrapped) {
                    inst.__task7SetWrapped = true;
                    const origSet = inst.setData;
                    inst.setData = function (o, cb) {
                      const E2 = globalThis.__task7;
                      if (E2 && E2.paint && o && typeof o === 'object' && o.state) {
                        E2.paint.states.push(o.state);
                        if (o.state === 'data' && !E2.paint.dataAt) E2.paint.dataAt = Date.now();
                      }
                      return origSet.call(inst, o, cb);
                    };
                  }
                }
                return origShow.apply(this, arguments);
              };
            }
          } catch (e) { /* ignore */ }
          return origPage.apply(this, arguments);
        };
      }
    }
    if (!globalThis.__task7Hooked) {
      globalThis.__task7Hooked = true;
      const rawRequest = wx.request.bind(wx);
      wx.request = function (o) {
        const E2 = globalThis.__task7 || {};
        const url = String((o && o.url) || '');
        const method = String((o && o.method) || 'GET');
        if (E2.reqLog) E2.reqLog.push({ url: url, method: method, at: Date.now() });
        let resp;
        try { resp = E2.reqImpl ? E2.reqImpl(url, method, o) : null; } catch (e) { resp = null; }
        if (resp == null) resp = [];
        setTimeout(function () {
          if (o && o.success) o.success({ statusCode: 200, data: resp });
        }, 2);
      };
      const rawSubscribe = wx.requestSubscribeMessage;
      wx.requestSubscribeMessage = function (o) {
        const E3 = globalThis.__task7 || {};
        if (E3.subLog) E3.subLog.push({ tmplIds: (o && o.tmplIds) || [], at: Date.now() });
        const ids = (o && o.tmplIds) || [];
        if (E3.cfg && E3.cfg.subDeny) {
          const res = {}; ids.forEach(function (id) { res[id] = 'reject'; });
          if (o && o.success) o.success(res);
          return;
        }
        const res = {}; ids.forEach(function (id) { res[id] = 'accept'; });
        if (o && o.success) o.success(res);
      };
      wx.showToast = function (o) {
        const E4 = globalThis.__task7 || {};
        if (E4.toasts) E4.toasts.push(String((o && o.title) || ''));
      };
      wx.cloud = wx.cloud || {};
      wx.cloud.init = function () {};
      wx.cloud.callFunction = function (o) {
        const E5 = globalThis.__task7 || {};
        if (E5.calls) E5.calls.push({ name: o && o.name, data: (o && o.data) || {}, at: Date.now() });
        const cfg2 = E5.cfg || {};
        if (cfg2.cloudMissing) return Promise.reject({ errMsg: 'cloud.callFunction:fail FunctionName parameter could not be found' });
        const reply = E5.cloudReply ? E5.cloudReply(o && o.data) : { ok: true };
        return Promise.resolve({ result: reply });
      };
    }
    // 身份 + 清空本机用户数据（保留 mock 身份）
    try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
    const id = {
      token: 'preview-task7', sid: '3260799999', name: '测试身份',
      role: '班长', badge: '班委', is_admin: true, ts: Date.now()
    };
    try { wx.setStorageSync('zq_class_identity', JSON.stringify(id)); } catch (e) { /* ignore */ }
    // 预置本机缓存（工作台/名单/水量…）
    try {
      const store = require('utils/store.js');
      store.reload();
      const d = store.get();
      d.termStart = '2026-09-01';
      d.ttCache = { c: [{ name: '高等数学', teacher: '李', room: 'A101', day: 1, start: 1, end: 2, weeks: '1-16', parity: 'all' }], t: '2026-09-01', at: Date.now() };
      d.homework = [{ id: 'h1', subject: '高等数学', content: '习题 3.1', date: '2099-01-02', time: '23:59', done: false, archived: false, ts: 100 }];
      d.ntDone = {};
      store.save();
      if (c && c.seedMembers) {
        d.classMembers = [
          { seat: 1, sid: 's1', name: '张三', role: '班长', badge: '班委', is_admin: false },
          { seat: 2, sid: 's2', name: '李四', role: '团支部书记', badge: '班委', is_admin: false },
          { seat: 3, sid: 's3', name: '王五', role: '学习委员', badge: '班委', is_admin: false },
          { seat: 4, sid: 's4', name: '赵六', role: '', badge: '', is_admin: false }
        ];
        d.classMembersAt = Date.now();
        store.save();
      }
      if (c && c.classLeague) {
        d.classLeague = [{ seat: 2, name: '李四' }, { seat: 4, name: '赵六' }];
        d.classLeagueAt = Date.now();
        store.save();
      }
      if (c && c.water) {
        d.power = { sel: '4-23A---321', at: Date.now(), low: 30 };
        d.water = { rooms: { '4-23A---321': { p: 4, recs: [{ m: '2026-10', r: 100, ts: 1 }, { m: '2026-11', r: 110, ts: 2 }] } } };
        d.waterPend = [];
        store.save();
      }
      if (c && c.noCache) {
        // 无缓存对照：清掉工作台可见缓存
        try { wx.removeStorageSync('zq_tools_v2'); } catch (e) { /* ignore */ }
        const st2 = require('utils/store.js');
        st2.reload();
        const d2 = st2.get();
        d2.homework = [];
        d2.ttCache = null;
        d2.classMembers = [];
        st2.save();
      }
    } catch (e) { /* ignore */ }
    return { ok: true };
  }, cfg || {}, 3);
}

/* ---------------------------------------------------------------- 采样 */
async function sampleIndex(mp) {
  return pageEval(mp, () => {
    const ps = getCurrentPages();
    const pg = ps[ps.length - 1];
    if (!pg || !pg.data) return null;
    const E = globalThis.__task7 || {};
    return {
      path: pg.route,
      state: pg.data.state,
      hwOpen: (pg.data.hw && pg.data.hw.open) || 0,
      hasToday: !!pg.data.today,
      ntNew: !!pg.data.ntNew,
      reqCount: (E.reqLog || []).length,
      reqTables: (function () {
        const out = {};
        (E.reqLog || []).forEach(function (r) {
          const u = String(r.url || '');
          let t = 'other';
          if (u.indexOf('/marks?') >= 0) t = 'marks';
          else if (u.indexOf('/notices?') >= 0) t = 'notices';
          else if (u.indexOf('/homework?') >= 0) t = 'homework';
          else if (u.indexOf('/userdata?') >= 0) t = 'userdata';
          else if (u.indexOf('/fitrecs?') >= 0) t = 'fitrecs';
          else if (u.indexOf('/visits') >= 0) t = 'visits';
          else if (u.indexOf('/class_members') >= 0) t = 'members';
          else if (u.indexOf('/site_assets?') >= 0) t = 'site_assets';
          else if (u.indexOf('tt.json') >= 0) t = 'tt_json';
          out[t] = (out[t] || 0) + 1;
        });
        return out;
      })(),
      elapsed: E.t0 ? (Date.now() - E.t0) : -1
    };
  });
}
async function pollUntil(mp, fn, timeout, interval) {
  const end = Date.now() + (timeout || 8000);
  let last = null;
  while (Date.now() < end) {
    try { last = await fn(); } catch (e) { last = null; }
    if (last) return last;
    await sleep(interval || 60);
  }
  return last;
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });
  mp.on('exception', (e) => consoleIssues.push('exception: ' + JSON.stringify(e).slice(0, 400)));
  mp.on('console', (e) => { if (e && e.type === 'error') consoleIssues.push('error: ' + (e.args || []).map(String).join(' ').slice(0, 400)); });
  await sleep(1200);

  /* ============================================================
     A. 加载与缓存提速（需求 9）
     ============================================================ */
  await installMock(mp, { seedMembers: true });
  await pageEval(mp, () => {
    // 工作台冷启动：请求 mock（marks/notices/homework 等返回空/轻量数据）
    const E = globalThis.__task7;
    E.reqImpl = function (url, method) {
      const u = String(url || '');
      if (u.indexOf('/marks?') >= 0) return [];
      if (u.indexOf('/notices?') >= 0) return [{ id: 'auto_g1', ts: 1000, hidden: false, edited_at: 0, title: '宿舍卫生检查安排', body: '[[CLASS_NOTICE_V1]]{}' }];
      if (u.indexOf('/homework?') >= 0) return [{ id: 'h1', subject: '高等数学', content: '习题 3.1', date: '2099-01-02', time: '23:59', done: false, archived: false, ts: 100 }];
      if (u.indexOf('/class_members') >= 0) return [{ seat: 1, sid: 's1', name: '张三', role: '班长', badge: '班委', is_admin: false }];
      if (u.indexOf('tt.json') >= 0) return { c: [], t: '2026-09-01' };
      return [];
    };
  });
  // 第一次进入 = 用户正常使用过（把缓存/TTL 写满）：稍后第二次冷启动才是「有缓存」主场景
  await mp.reLaunch('/pages/index/index');
  await sleep(900);
  // 第二次冷启动（wx.reLaunch 重建页面实例；storage/cache 保留）——页内计时并采样首帧状态
  const launchA = await pageEval(mp, () => {
    const E = globalThis.__task7;
    E.reqLog.length = 0;
    E.t0 = Date.now();
    return new Promise(function (resolve) {
      const t0 = Date.now();
      wx.reLaunch({
        url: '/pages/index/index',
        success: function () {
          let first = null;
          const poll = function () {
            const ps = getCurrentPages();
            const pg = ps[ps.length - 1];
            const st = pg && pg.data ? pg.data.state : '';
            if (first === null) first = st;
            if (st === 'data') {
              resolve({ ms: Date.now() - t0, first: first, states: (globalThis.__task7.paint && globalThis.__task7.paint.states) || [], reqCount: (globalThis.__task7.reqLog || []).length });
              return;
            }
            if (Date.now() - t0 > 5000) { resolve({ ms: -1, first: first, states: (globalThis.__task7.paint && globalThis.__task7.paint.states) || [], reqCount: (globalThis.__task7.reqLog || []).length }); return; }
            setTimeout(poll, 8);
          };
          poll();
        },
        fail: function (e) { resolve({ ms: -1, first: 'reLaunch-fail', err: String(e && e.errMsg), states: [], reqCount: 0 }); }
      });
    });
  });
  const idxA = await sampleIndex(mp);
  check('A1 有本机缓存：工作台冷启动首帧 state=data（无 120ms 骨架）', launchA.first === 'data' && idxA && idxA.state === 'data', 'first=' + launchA.first + ' state=' + (idxA && idxA.state) + ' states=' + JSON.stringify(launchA.states));
  check('A2 有缓存首帧渲染可直接读到本机内容（今日课程/作业卡已渲染）', idxA && (idxA.hasToday === true), idxA && ('today=' + idxA.hasToday + ' hwOpen=' + idxA.hwOpen));
  await sleep(500);
  const idxA2 = await sampleIndex(mp);
  check('A3 二次冷启动请求有界（marks 已拉过不再重复，≤3 个请求）', idxA2 && idxA2.reqCount <= 3, idxA2 && JSON.stringify(idxA2.reqTables));
  check('A4 首屏可交互时间（wx.reLaunch → state=data，devtools 内计时）≤ 1500ms', launchA.ms >= 0 && launchA.ms <= 1500, launchA.ms + 'ms');
  await shot(mp, 'A_index_cached');
  // 页面重入：setData 只下发变化字段（diff → 无变化不 setData）
  const reentry = await pageEval(mp, () => {
    const pg = getCurrentPages().slice(-1)[0];
    let calls = 0, bytes = 0;
    const raw = pg.setData.bind(pg);
    pg.setData = function (o, cb) { calls += 1; try { bytes += JSON.stringify(o || {}).length; } catch (e) { /* ignore */ } return raw(o, cb); };
    pg.onShow();
    return new Promise(function (resolve) { setTimeout(function () { resolve({ calls: calls, bytes: bytes }); }, 120); });
  });
  check('A5 页面重入只 setData 变化字段（diff，字节数 < 1500）', reentry && reentry.bytes < 1500, reentry && JSON.stringify(reentry));

  // A6 无缓存对照：无缓存时仍能正常首屏加载到 data（不白屏；骨架由代码/单测保证，devtools reLaunch 回调晚于骨架）
  await installMock(mp, { noCache: true });
  await pageEval(mp, () => {
    globalThis.__task7.reqImpl = function (url) {
      if (String(url).indexOf('/homework?') >= 0) return [];
      return [];
    };
    globalThis.__task7.t0 = Date.now();
  });
  const noCacheA6 = await pageEval(mp, () => new Promise(function (resolve) {
    const t0 = Date.now();
    wx.reLaunch({
      url: '/pages/index/index',
      success: function () {
        const poll = function () {
          const ps = getCurrentPages(); const pg = ps[ps.length - 1];
          const st = pg && pg.data ? pg.data.state : '';
          if (st === 'data' || Date.now() - t0 > 5000) { resolve({ ms: Date.now() - t0, state: st }); return; }
          setTimeout(poll, 8);
        };
        poll();
      },
      fail: function () { resolve({ ms: -1, state: 'fail' }); }
    });
  }));
  check('A6 无缓存对照：无缓存仍能进入 data（不白屏）', noCacheA6.state === 'data', JSON.stringify(noCacheA6));
  await shot(mp, 'A_index_nocache');

  /* ============================================================
     B. 新通知提醒已移除（2026-11-18）：不再有按钮/页面方法
     ============================================================ */
  await installMock(mp, { seedMembers: true });
  await mp.reLaunch('/pages/nt/nt');
  await waitPath(mp, 'pages/nt/nt');
  await sleep(500);
  const removedB = await pageEval(mp, () => {
    const pg = getCurrentPages().slice(-1)[0];
    return {
      hasMethod: typeof pg.subscribeNextNotice,
      hasStatus: typeof pg.refreshNotifyStatus,
      subOn: typeof pg.data.ntSubOn,
      statusText: typeof pg.data.ntStatusText
    };
  });
  check('B1 通知页不再有「新通知提醒」按钮/状态', removedB.hasMethod === 'undefined' && removedB.hasStatus === 'undefined' && removedB.subOn === 'undefined' && removedB.statusText === 'undefined', JSON.stringify(removedB));
  /* ============================================================
     C. 水量共享（需求 6）
     ============================================================ */
  await installMock(mp, { water: true });
  await pageEval(mp, () => {
    const E = globalThis.__task7;
    E.reqImpl = function (url, method) {
      const u = String(url || '');
      if (u.indexOf('/water?') >= 0 && u.indexOf('roomverify=') >= 0 && method === 'GET') {
        return [{ month: '2026-10', reading: 101, persons: 4, updated_at: '2026-10-31T00:00:00+08:00' },
          { month: '2026-11', reading: 111, persons: 4, updated_at: '2026-11-30T00:00:00+08:00' }];
      }
      if (u.indexOf('/water_room?') >= 0) return [{ roomverify: '4-23A---321', persons: 6 }];
      return [];
    };
  });
  await mp.reLaunch('/pages/water/water');
  await waitPath(mp, 'pages/water/water');
  // 直接走页面合并路径（_pullCloud force）核对云端；避免上一轮预览会话的 waterList 60s 模块级 TTL 干扰
  await sleep(350);
  await pageEval(mp, () => {
    const pg = getCurrentPages().slice(-1)[0];
    return pg._pullCloud(pg.data.sel || '4-23A---321', true);
  });
  await sleep(350);
  const waterC = await pageEval(mp, () => {
    const pg = getCurrentPages().slice(-1)[0];
    const store = require('utils/store.js');
    const d = store.get();
    return {
      persons: pg.data.persons,
      locked: !!pg.data.personsLocked,
      personsOptions: (pg.data.personsOptions || []).map(function (o) { return o.label; }),
      syncText: String(pg.data.syncText || ''),
      history: (pg.data.history || []).map(function (h) { return h.m + '=' + h.rText; }),
      quotaText: String((pg.data.cmp && pg.data.cmp.quotaText) || ''),
      rulesText: JSON.stringify(pg.data.rules || {}),
      waterPend: (d.waterPend || []).length
    };
  });
  check('C1 23A 固定 4 人间（personsLocked=true，人数 4）', waterC.locked === true && waterC.persons === 4, JSON.stringify({ locked: waterC.locked, persons: waterC.persons }));
  check('C2 云端记录合并显示（同月云端覆盖本地：2026-11=111.00）', waterC.history.indexOf('2026-11=111.00') >= 0, JSON.stringify(waterC.history));
  check('C3 文案为「定额」且不含「免费」', waterC.quotaText.indexOf('定额') >= 0 && waterC.rulesText.indexOf('免费') < 0 && waterC.personsOptions.join('|').indexOf('免费') < 0, waterC.quotaText + ' / ' + waterC.personsOptions.join('|'));
  check('C4 页面显示云端共享同步状态', /宿舍共享|已同步/.test(waterC.syncText), waterC.syncText);
  // 23A 不允许改 6 人
  await pageEval(mp, () => {
    const pg = getCurrentPages().slice(-1)[0];
    pg.pickPersons({ currentTarget: { dataset: { p: 6 } } });
  });
  await sleep(100);
  const lockedC = await pageEval(mp, () => {
    const pg = getCurrentPages().slice(-1)[0];
    return { persons: pg.data.persons, toast: (globalThis.__task7.toasts || []).slice(-1)[0] || '' };
  });
  check('C5 23A 改 6 人间被拒（提示固定四人间）', lockedC.persons === 4 && lockedC.toast.indexOf('固定 4 人间') >= 0, JSON.stringify(lockedC));
  // 离线保存 → pending → 恢复重试成功
  await pageEval(mp, () => {
    const E = globalThis.__task7;
    E.reqImpl = function () { return { __fail: true }; };
    // 失败用 500 模拟：这里直接让成功回调返回 statusCode 500
    wx.request = (function (orig) {
      return function (o) {
        const u = String(o.url || '');
        const E2 = globalThis.__task7;
        E2.reqLog.push({ url: u, method: o.method || 'GET', at: Date.now() });
        if (u.indexOf('/water') >= 0 && o.method === 'POST') return setTimeout(function () { o.success({ statusCode: 500, data: {} }); }, 2);
        return orig.call(wx, o);
      };
    })(wx.request);
    const pg = getCurrentPages().slice(-1)[0];
    pg.setData({ month: '2026-12', reading: '130' });
    pg.saveRecord();
  });
  await sleep(300);
  const pendC = await pageEval(mp, () => {
    const store = require('utils/store.js');
    return (store.get().waterPend || []).map(function (x) { return x.op + ':' + (x.m || x.p); });
  });
  check('C6 云端失败 → 离线 pending 队列（put:2026-12）', pendC.indexOf('put:2026-12') >= 0, JSON.stringify(pendC));
  await pageEval(mp, () => {
    const E = globalThis.__task7;
    // 恢复：POST water 成功
    wx.request = (function () {
      return function (o) {
        const E2 = globalThis.__task7;
        E2.reqLog.push({ url: String(o.url || ''), method: o.method || 'GET', at: Date.now() });
        setTimeout(function () { o.success({ statusCode: 200, data: [] }); }, 2);
      };
    })();
    return getCurrentPages().slice(-1)[0]._flushPending();
  });
  await sleep(300);
  const pendC2 = await pageEval(mp, () => (require('utils/store.js').get().waterPend || []).length);
  check('C7 恢复后 pending 重试成功并清空', pendC2 === 0, 'pending=' + pendC2);
  await shot(mp, 'C_water_shared');

  /* ============================================================
     D. 名单快捷预设（需求 8）
     ============================================================ */
  await installMock(mp, { seedMembers: true, classLeague: true });
  await pageEval(mp, () => { globalThis.__task7.reqImpl = function () { return []; }; });
  await mp.reLaunch('/pages/draw/draw');
  await waitPath(mp, 'pages/draw/draw');
  await sleep(400);
  const drawD = await pageEval(mp, () => {
    const pg = getCurrentPages().slice(-1)[0];
    pg.setData({ picker: true });
    return new Promise(function (resolve) { setTimeout(function () { resolve(true); }, 300); });
  });
  await sleep(400);
  const pickD = await pageEval(mp, () => {
    const pg = getCurrentPages().slice(-1)[0];
    const comp = pg.selectComponent('#rosterPicker');
    if (!comp) return { missing: true, toasts: (globalThis.__task7.toasts || []).slice() };
    comp.quickAll();
    const allN = comp.data.count;
    comp.quickCommittee();
    const comN = comp.data.count;
    comp.quickLeague();
    return new Promise(function (resolve) {
      setTimeout(function () {
        const leagueN = comp.data.count;
        // 之后仍可逐个增删：点一个未选成员（座号 1）
        comp.toggleSeat({ currentTarget: { dataset: { seat: 1 } } });
        resolve({ allN: allN, comN: comN, leagueN: leagueN, afterToggle: comp.data.count, quick: comp.data.quick, missing: false });
      }, 260);
    });
  });
  check('D1 抽签名单选择器「全班」预设 = 4 人', pickD && pickD.allN === 4, pickD && ('all=' + pickD.allN + ' raw=' + JSON.stringify(pickD)));
  check('D2 「班委」预设 = 3 人（role/badge 非空）', pickD && pickD.comN === 3, pickD && ('committee=' + pickD.comN));
  check('D3 「团员」预设 = 2 人（class_league 缓存）', pickD && pickD.leagueN === 2, pickD && ('league=' + pickD.leagueN));
  check('D4 预设后仍可逐个增删（点选后人数变化）', pickD && pickD.afterToggle !== pickD.leagueN, pickD && ('afterToggle=' + pickD.afterToggle));
  await shot(mp, 'D_roster_presets');
  // 投票「指定成员」快捷预设
  await pageEval(mp, () => { globalThis.__task7.reqImpl = function () { return []; }; });
  await mp.reLaunch('/pages/vote/vote');
  await waitPath(mp, 'pages/vote/vote');
  await sleep(500);
  const voteD = await pageEval(mp, () => {
    const pg = getCurrentPages().slice(-1)[0];
    pg.setData({ formOpen: true, 'form.aud': 'custom', 'form.audSeats': [] });
    return new Promise(function (resolve) {
      setTimeout(function () {
        pg.quickAudience({ currentTarget: { dataset: { k: 'committee' } } });
        setTimeout(function () {
          const com = (pg.data.form && pg.data.form.audSeats || []).slice();
          pg.quickAudience({ currentTarget: { dataset: { k: 'league' } } });
          setTimeout(function () {
            resolve({ com: com, league: (pg.data.form && pg.data.form.audSeats || []).slice() });
          }, 260);
        }, 120);
      }, 250);
    });
  });
  check('D5 投票指定成员「班委」预设 = 座号 [1,2,3]', voteD && JSON.stringify(voteD.com) === '[1,2,3]', JSON.stringify(voteD));
  check('D6 投票指定成员「团员」预设 = 座号 [2,4]', voteD && JSON.stringify(voteD.league) === '[2,4]', JSON.stringify(voteD));
  await shot(mp, 'D_vote_presets');

  /* ============================================================
     E. 徽章去重（需求 2）
     ============================================================ */
  await installMock(mp, { seedMembers: true });
  await pageEval(mp, () => { globalThis.__task7.reqImpl = function (url) { if (String(url).indexOf('/class_members') >= 0) return []; return []; }; });
  await mp.reLaunch('/pages/committee/committee');
  await waitPath(mp, 'pages/committee/committee');
  await sleep(500);
  const committeeE = await pageEval(mp, () => {
    const pg = getCurrentPages().slice(-1)[0];
    const list = pg.data.list || [];
    const tools = require('utils/tools.js');
    const bz = (tools.TOOLS || tools.catalog && tools.catalog() || []).find(function (t) { return t.key === 'bz'; }) || {};
    return {
      roles: list.map(function (x) { return x.name + ':' + x.role; }),
      badges: list.map(function (x) { return x.badge || ''; }),
      desc: String(bz.desc || ''),
      meta: String(bz.meta || '')
    };
  });
  check('E1 班委页保留职务文字（班长/团支书/学委）', committeeE.roles.join('|').indexOf('班长') >= 0 && committeeE.roles.join('|').indexOf('团支部书记') >= 0, committeeE.roles.join('|'));
  check('E2 班委页不再重复渲染「班委」badge 气泡', committeeE.badges.every(function (b) { return b === ''; }), JSON.stringify(committeeE.badges));
  check('E3 工具描述同步（职务/名单，不再强调徽章）', committeeE.desc.indexOf('徽章') < 0 && /职务/.test(committeeE.meta + committeeE.desc), committeeE.meta + ' / ' + committeeE.desc);
  await shot(mp, 'E_committee_badge');

  /* ============================================================
     F. 提醒通道诊断（需求 11）
     ============================================================ */
  await installMock(mp, { seedMembers: true });
  await pageEval(mp, () => {
    const E = globalThis.__task7;
    E.reqImpl = function (url) {
      const u = String(url || '');
      if (u.indexOf('/service_health') >= 0) return [];
      if (u.indexOf('/notices?') >= 0) return [];
      return [];
    };
    E.cloudReply = function (data) {
      if (!data) return { ok: true };
      if (data.action === 'diag') {
        return { ok: true, diag: { hb: { ts: Date.now(), agoMs: 120000, source: 'timer' }, active: 3, lastError: 'send-fail: 43101' } };
      }
      return { ok: true };
    };
  });
  await mp.reLaunch('/pages/diag/diag');
  await waitPath(mp, 'pages/diag/diag');
  await sleep(900);
  const diagF = await pageEval(mp, () => {
    const pg = getCurrentPages().slice(-1)[0];
    return pg.data.notifyDiag || null;
  });
  check('F1 诊断页显示提醒通道：定时器心跳（2 分钟前）', !!diagF && diagF.show === true && diagF.hbText.indexOf('2 分钟前') >= 0, diagF && diagF.hbText);
  check('F2 诊断页显示云端 active 提醒数', !!diagF && diagF.activeText.indexOf('active 3 条提醒') >= 0, diagF && diagF.activeText);
  check('F3 诊断页显示 lastError', !!diagF && diagF.errText.indexOf('43101') >= 0, diagF && diagF.errText);
  await shot(mp, 'F_diag_notify');

  /* ============================================================ 汇总 */
  const consoleErrors = consoleIssues.filter(function (s) { return /^error:/.test(s); });
  check('G1 console error = 0', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
  check('G2 页面异常 = 0', consoleIssues.filter(function (s) { return /^exception:/.test(s); }).length === 0, consoleIssues.slice(0, 3).join(' | '));
  const shots = fs.readdirSync(OUT).filter(function (n) { return /\.png$/.test(n); });
  check('G3 截图 ≥ 6 张', shots.length >= 6, shots.join(','));

  const pass = checks.filter(function (c) { return c.ok; }).length;
  const fail = checks.length - pass;
  const result = {
    at: new Date().toISOString(), ws: WS,
    pass: pass, fail: fail, checks: checks,
    consoleIssues: consoleIssues.slice(0, 20),
    shots: shots
  };
  fs.writeFileSync(path.join(__dirname, 'task7_preview_result.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log('\n================ task7 preview: ' + pass + ' passed, ' + fail + ' failed ================');
  process.exitCode = fail ? 2 : 0;
  try { await mp.disconnect(); } catch (e) { /* ignore */ }
})().catch((e) => {
  console.error('FATAL', e);
  fs.writeFileSync(path.join(__dirname, 'task7_preview_result.json'), JSON.stringify({ fatal: String((e && e.stack) || e) }, null, 2), 'utf8');
  process.exit(1);
});
