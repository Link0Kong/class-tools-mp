/* vote_unit_tests.js —— 「投票」专项单测（2026-11-11，随 unit.js 运行，也可独立跑）
 *
 * 契约唯一真源：web/vote/CONTRACT.md
 *   §1 数据模型（标题 1–80 / 说明 ≤500 / 选项 2–20 / 配图 data URL ≤150000 字符 / 规则归一 / 时间语义）
 *   §2 RPC（poll_create / poll_list / poll_detail / poll_submit / poll_manage）
 *   §4 小程序端要求（页面/注册/交互/分享/失败兜底/单测）
 *
 * 覆盖：
 *   A. utils/vote.js 纯逻辑：id 规则 / 规则归一 / 选项编辑与校验 / 截止判定 / 倒计时与时间格式化 /
 *      百分比 / 结果可见性 / 多选上限 / 排序 / 卡片与详情视图模型 / 发起 payload / 编辑回填 / 轮询节奏 / 配图缩放 /
 *      可见人范围（§1.6：归一 all/committee/league/custom、custom 座号去重升序与空校验、范围标签、payload/回填）
 *   B. utils/cloud.js 5 个 RPC 的 URL / body / header / 错误 reason 映射（wx.request mock，绝不访问真实云端；
 *      含 p_audience / p_audience_seats 透传）
 *   C. 页面级：pages/vote 列表渲染/筛选/失败保留列表/发起 payload、pages/votedetail 加载/勾选/提交/管理、
 *      指定成员范围选择（名单只显示姓名、内部座号、至少 1 人）
 *   D. 工程静态断言：app.json 注册 / tools.js 入口与顺序 / 两页 8 文件 / 图标 / WXML handler / 分享 / 隐私红线 /
 *      可见范围 4 段与成员多选接线
 *
 * 说明：纯 Node + 内存 wx mock；不发真实请求、不读写真实云端、不启动模拟器。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { allPages } = require('./_app_pages.js');
const assert = require('assert');

const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');
const ROOT_N = ROOT.replace(/\\/g, '/');
const VOTE_PAGE = 'pages/vote/vote';
const DETAIL_PAGE = 'pages/votedetail/votedetail';
const ID = { token: 'tok-vote-1', sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: false, ts: 1 };

// ---------------------------------------------------------------- 测试环境（wx 内存 mock）
function createCtx() {
  const mem = Object.create(null);
  let reqLog = [];
  let reqImpl = function (o) { o.success({ statusCode: 200, data: [] }); };
  let toastLog = [];
  let modalLog = [];
  let navLog = [];
  const wxMock = {
    getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
    setStorageSync(k, v) { mem[k] = v; },
    removeStorageSync(k) { delete mem[k]; },
    request(o) { reqLog.push(o); reqImpl(o); },
    showToast(o) { toastLog.push(o && o.title); },
    showModal(o) { modalLog.push(o && o.title); if (o && o.success) o.success({ confirm: true, cancel: false }); },
    showShareMenu() {}, stopPullDownRefresh() {}, showLoading() {}, hideLoading() {},
    navigateTo(o) { navLog.push('to:' + String((o && o.url) || '')); },
    navigateBack(o) { navLog.push('back:' + String((o && o.delta) || 1)); },
    switchTab(o) { navLog.push('tab:' + String((o && o.url) || '')); },
    reLaunch(o) { navLog.push('relaunch:' + String((o && o.url) || '')); },
    showActionSheet(o) { if (o && o.success) o.success({ tapIndex: 0 }); },
    getImageInfo(o) { if (o && o.success) o.success({ width: 1280, height: 720 }); },
    chooseMedia(o) { if (o && o.success) o.success({ tempFiles: [{ tempFilePath: '/tmp/vote_test.jpg', size: 1024 }] }); },
    createSelectorQuery() {
      return { select() { return this; }, fields() { return this; }, exec(cb) { if (cb) cb([{ node: null }]); } };
    },
    canvasToTempFilePath() {},
    getFileSystemManager() { return { readFile(o) { if (o && o.success) o.success({ data: 'AAAA' }); } }; }
  };
  return {
    mem, wxMock,
    clearMem() {
      Object.keys(mem).forEach(function (k) { delete mem[k]; });
      reqLog = []; toastLog = []; modalLog = []; navLog = [];
      reqImpl = function (o) { o.success({ statusCode: 200, data: [] }); };
    },
    setReq(fn) { reqImpl = fn; },
    reqLog() { return reqLog; },
    toastLog() { return toastLog; },
    modalLog() { return modalLog; },
    navLog() { return navLog; },
    reqsOf(frag) { return reqLog.filter(function (o) { return String((o && o.url) || '').indexOf(frag) >= 0; }); },
    urls() { return reqLog.map(function (o) { return String((o && o.url) || ''); }); },
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
function src(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function fileOf(rel) { return path.join(ROOT, rel); }
function enableCloud(cloud) {
  cloud.configure({ enabled: true, restBase: 'https://rest.test/v1/rdb/rest/', publishableKey: 'pk-test', ttUrl: '' });
}
function loadPageDef(rel) {
  let def = null;
  global.Page = function (d) { def = d; };
  try { require(path.join(ROOT, rel + '.js')); } finally { delete global.Page; }
  assert.ok(def && typeof def === 'object', '页面未注册 Page：' + rel);
  return def;
}
function ctxOf(def) {
  const ctx = Object.assign({}, def);
  ctx.data = JSON.parse(JSON.stringify(def.data || {}));
  ctx.setData = function (o, cb) {
    const self = this;
    Object.keys(o || {}).forEach(function (k) {
      // 支持 'form.title' / 'd.countdownText' 这类路径 key（页面实际用法）
      if (k.indexOf('.') > 0) {
        const seg = k.split('.');
        let cur = self.data;
        for (let i = 0; i < seg.length - 1; i += 1) {
          if (cur[seg[i]] === undefined || cur[seg[i]] === null) cur[seg[i]] = {};
          cur = cur[seg[i]];
        }
        cur[seg[seg.length - 1]] = o[k];
      } else {
        self.data[k] = o[k];
      }
    });
    if (cb) cb();
  };
  return ctx;
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
const waitFor = async function (fn, timeout) {
  const t0 = Date.now();
  const lim = timeout || 2000;
  while (Date.now() - t0 < lim) {
    if (fn()) return true;
    await sleep(10);
  }
  return !!fn();
};
function asHandler(name) { return function (e) { return this[name](e); }; }

// ---------------------------------------------------------------- 固定测试数据
const NOW = new Date().getTime();
function pollFixture(over) {
  return Object.assign({
    id: 'pabc12345',
    title: '班会投票',
    description: '',
    mode: 'quick',
    owner_name: '测试账号',
    settings: { multi: false, maxChoices: 1, anonymous: true, allowChange: true, resultVisibility: 'afterVote' },
    deadline: NOW + 10 * 60 * 1000,
    status: 'open',
    closed_at: 0,
    created_at: NOW - 5000,
    updated_at: NOW - 5000,
    audience: 'all',
    audience_count: 0,
    closed: false,
    total: 3,
    counts: {},
    has_voted: false,
    my_choices: [],
    results_hidden: true,
    mine: false,
    can_manage: false
  }, over || {});
}
function detailFixture(over) {
  const base = {
    ok: true,
    now: NOW,
    poll: {
      id: 'pabc12345',
      title: '班服颜色',
      description: '选一个',
      mode: 'quick',
      owner_name: '测试账号',
      settings: { multi: false, maxChoices: 1, anonymous: true, allowChange: true, resultVisibility: 'afterVote' },
      options: [{ id: 'o1', text: '红色' }, { id: 'o2', text: '蓝色' }],
      deadline: NOW + 10 * 60 * 1000,
      status: 'open',
      closed_at: 0,
      created_at: NOW - 60000,
      updated_at: NOW - 60000,
      audience: 'all',
      audience_count: 0,
      audience_seats: []
    },
    closed: false,
    total: 3,
    counts: { o1: 2, o2: 1 },
    has_voted: false,
    my_choices: [],
    results_hidden: true,
    mine: false,
    can_manage: false,
    voters: []
  };
  return Object.assign(base, over || {});
}
function optionPairs(list) { return list.map(function (o) { return [o.id, o.text]; }); }

async function run(test) {
  const prevWx = global.wx;
  const C = createCtx();
  global.wx = C.wxMock;
  const prevGetPages = global.getCurrentPages;
  try {
    /* ============================================================
     * A. utils/vote.js 纯逻辑
     * ============================================================ */
    await test('VOTE-A1 常量与 id 规则：标题/说明/选项/配图上限对齐契约 §1；pollId/optionId 合法且唯一', function () {
      purge();
      const v = R('utils/vote.js');
      assert.strictEqual(v.LIMITS.title, 80);
      assert.strictEqual(v.LIMITS.desc, 500);
      assert.strictEqual(v.LIMITS.optMin, 2);
      assert.strictEqual(v.LIMITS.optMax, 20);
      assert.strictEqual(v.LIMITS.optText, 80);
      assert.strictEqual(v.LIMITS.optDesc, 200);
      assert.strictEqual(v.LIMITS.imgChars, 150000);
      assert.strictEqual(v.LIMITS.imgTotalChars, 1600000, '全部配图合计上限与网页端/服务端一致（1,600,000 字符）');
      assert.deepStrictEqual(v.QUICK_MINS, [5, 10, 30, 60, 120]);
      assert.deepStrictEqual(v.VIS, ['always', 'afterVote', 'afterClose']);
      const ids = {};
      for (let i = 0; i < 60; i += 1) {
        const id = v.pollId();
        assert.ok(/^p[a-z0-9]{4,32}$/.test(id), 'pollId 不合法：' + id);
        assert.ok(id.length >= 5 && id.length <= 33, 'pollId 长度 5–33：' + id);
        ids[id] = 1;
        const oid = v.optionId();
        assert.ok(/^[A-Za-z0-9_-]{1,24}$/.test(oid), 'optionId 不合法：' + oid);
      }
      assert.ok(Object.keys(ids).length >= 55, 'pollId 应基本唯一');
    });

    await test('VOTE-A2 normSettings：默认值 / 单选强制 maxChoices=1 / 多选 2–20 且不超过选项数 / 枚举兜底', function () {
      purge();
      const v = R('utils/vote.js');
      const d = v.normSettings(null, 4);
      assert.deepStrictEqual(d, { multi: false, maxChoices: 1, anonymous: true, allowChange: true, resultVisibility: 'afterVote' });
      assert.strictEqual(v.normSettings({ multi: true, maxChoices: 3 }, 4).maxChoices, 3);
      assert.strictEqual(v.normSettings({ multi: true, maxChoices: 99 }, 4).maxChoices, 4, '不得超过选项数');
      assert.strictEqual(v.normSettings({ multi: true, maxChoices: 99 }, 30).maxChoices, 20, '最多 20');
      assert.strictEqual(v.normSettings({ multi: true, maxChoices: 1 }, 4).maxChoices, 2, '多选至少 2');
      assert.strictEqual(v.normSettings({ multi: false, maxChoices: 5 }, 4).maxChoices, 1, '单选恒为 1');
      assert.strictEqual(v.normSettings({ multi: true, maxChoices: 'x' }, 4).maxChoices, 2);
      assert.strictEqual(v.normSettings({ anonymous: false }).anonymous, false);
      assert.strictEqual(v.normSettings({ allowChange: false }).allowChange, false);
      assert.strictEqual(v.normSettings({ resultVisibility: 'bogus' }).resultVisibility, 'afterVote');
      assert.strictEqual(v.normSettings({ resultVisibility: 'always' }).resultVisibility, 'always');
      assert.strictEqual(v.normSettings().multi, false);
    });

    await test('VOTE-A3 选项编辑：add 上限 20 / remove 保底 2 / 上移下移 / normOption 归一与图片校验', function () {
      purge();
      const v = R('utils/vote.js');
      const n0 = v.newOption('');
      assert.ok(/^[A-Za-z0-9_-]{1,24}$/.test(n0.id));
      assert.strictEqual(n0.text, '');
      // 追加到 20 后拒绝
      let opts = [v.newOption('A'), v.newOption('B')];
      for (let i = 2; i < 20; i += 1) {
        const r = v.addOption(opts);
        assert.strictEqual(r.ok, true, '第 ' + (i + 1) + ' 个应可添加');
        opts = r.options;
      }
      assert.strictEqual(opts.length, 20);
      const over = v.addOption(opts);
      assert.strictEqual(over.ok, false);
      assert.ok(over.reason.indexOf('最多') >= 0);
      // 删除保底 2
      assert.strictEqual(v.removeOption([v.newOption('A'), v.newOption('B')], 0).ok, false, '只剩 2 个时不能删');
      const three = [v.newOption('A'), v.newOption('B'), v.newOption('C')];
      const rm = v.removeOption(three, 1);
      assert.strictEqual(rm.ok, true);
      assert.deepStrictEqual(rm.options.map(function (o) { return o.text; }), ['A', 'C']);
      // 上移下移
      const mv = v.moveOption(three, 2, -1);
      assert.strictEqual(mv.moved, true);
      assert.deepStrictEqual(mv.options.map(function (o) { return o.text; }), ['A', 'C', 'B']);
      assert.strictEqual(v.moveOption(three, 0, -1).moved, false, '首项上移无变化');
      assert.strictEqual(v.moveOption(three, 2, 1).moved, false, '末项下移无变化');
      // normOption：保留合法 id、裁文字/说明、丢弃非法图片
      const keep = v.normOption({ id: 'oABC_-1', text: ' 文字 ', desc: ' 说明 ', img: 'data:image/jpeg;base64,AAA' });
      assert.strictEqual(keep.id, 'oABC_-1');
      assert.strictEqual(keep.text, '文字');
      assert.strictEqual(keep.desc, '说明');
      assert.ok(keep.img.indexOf('data:image/jpeg;base64,') === 0);
      const fixed = v.normOption({ id: 'bad id!', text: 'x'.repeat(100), desc: 'y'.repeat(300), img: 'http://x/a.jpg' });
      assert.ok(/^[A-Za-z0-9_-]{1,24}$/.test(fixed.id), '非法 id 应重新生成');
      assert.strictEqual(fixed.text.length, 80);
      assert.strictEqual(fixed.desc.length, 200);
      assert.strictEqual(fixed.img, '', '非 data:image/ 前缀图片应丢弃');
      assert.strictEqual(v.validImg('data:image/jpeg;base64,AAA'), true);
      assert.strictEqual(v.validImg('data:image/png;base64,' + 'A'.repeat(150001)), false);
      assert.strictEqual(v.validImg('http://a/x.png'), false);
    });

    await test('VOTE-A4 选项校验：2–20 / 文字必填且 ≤80 / 说明 ≤200 / 图片前缀与大小 / 配图总量', function () {
      purge();
      const v = R('utils/vote.js');
      assert.strictEqual(v.validateOptions([]).ok, false);
      assert.strictEqual(v.validateOptions([{ id: 'o1', text: 'A' }]).ok, false, '少于 2 项');
      assert.strictEqual(v.validateOptions([{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }]).ok, true);
      const empty = v.validateOptions([{ id: 'o1', text: 'A' }, { id: 'o2', text: '  ' }]);
      assert.strictEqual(empty.ok, false);
      assert.ok(empty.reason.indexOf('第 2 个') >= 0);
      assert.strictEqual(v.validateOptions([{ id: 'o1', text: 'A' }, { id: 'o2', text: 'x'.repeat(81) }]).ok, false);
      assert.strictEqual(v.validateOptions([{ id: 'o1', text: 'A', desc: 'y'.repeat(201) }, { id: 'o2', text: 'B' }]).ok, false);
      const badImg = v.validateOptions([{ id: 'o1', text: 'A', img: 'https://x/a.png' }, { id: 'o2', text: 'B' }]);
      assert.strictEqual(badImg.ok, false);
      assert.ok(badImg.reason.indexOf('图片格式') >= 0);
      const bigImg = v.validateOptions([{ id: 'o1', text: 'A', img: 'data:image/jpeg;base64,' + 'A'.repeat(150001) }, { id: 'o2', text: 'B' }]);
      assert.strictEqual(bigImg.ok, false);
      assert.ok(bigImg.reason.indexOf('图片过大') >= 0);
      // 边界（与服务端 1,600,000 字符同口径）：恰好 1,600,000 通过；1,600,001 拒绝
      const P = 'data:image/jpeg;base64,';
      const imgOfChars = function (n) { return P + 'A'.repeat(n - P.length); };
      const edge = [];
      for (let i = 0; i < 10; i += 1) edge.push({ id: 'e' + i, text: 'T' + i, img: imgOfChars(150000) });
      edge.push({ id: 'e10', text: 'T10', img: imgOfChars(100000) });
      assert.strictEqual(v.imgTotalChars(edge), 1600000);
      assert.strictEqual(v.LIMITS.imgTotalChars, 1600000, '合计上限必须是 1,600,000 字符（与网页端/服务端一致）');
      assert.strictEqual(v.validateOptions(edge).ok, true, '恰好 1,600,000 字符应通过');
      const edgeOver = edge.slice();
      edgeOver[edgeOver.length - 1] = { id: 'e10', text: 'T10', img: imgOfChars(100001) };
      const overRes = v.validateOptions(edgeOver);
      assert.strictEqual(overRes.ok, false, '1,600,001 字符应拒绝');
      assert.ok(overRes.reason.indexOf('总大小') >= 0, overRes.reason);
    });

    await test('VOTE-A5 截止判定与倒计时：deadline=0 / status=closed / 到点 / closed 标记 / 文案格式', function () {
      purge();
      const v = R('utils/vote.js');
      assert.strictEqual(v.isClosed({ deadline: 0, status: 'open' }, NOW), false, '不限时');
      assert.strictEqual(v.isClosed({ deadline: NOW - 1, status: 'open' }, NOW), true, '本地时钟到点');
      assert.strictEqual(v.isClosed({ deadline: NOW + 1, status: 'open' }, NOW), false);
      assert.strictEqual(v.isClosed({ deadline: 0, status: 'closed' }, NOW), true, '提前结束');
      assert.strictEqual(v.isClosed({ deadline: 0, status: 'open', closed: true }, NOW), true, '服务端 closed 为准');
      assert.strictEqual(v.isClosed({ deadline: NOW + 1000, status: 'open' }, NOW + 5000), true, 'now 参数生效');
      assert.strictEqual(v.remainingMs({ deadline: NOW + 5000 }, NOW), 5000);
      assert.strictEqual(v.remainingMs({ deadline: NOW - 5000 }, NOW), 0, '已过截止不为负');
      assert.strictEqual(v.remainingMs({ deadline: 0 }, NOW), 0);
      assert.strictEqual(v.countdownText({ deadline: 0, status: 'open' }, NOW), '不限时');
      assert.strictEqual(v.countdownText({ deadline: NOW - 1, status: 'open' }, NOW), '已截止');
      assert.strictEqual(v.countdownText({ deadline: NOW + 90000, status: 'open' }, NOW), '剩 01:30');
      assert.strictEqual(v.countdownText({ deadline: NOW + 3661000, status: 'open' }, NOW), '剩 01:01:01');
      assert.strictEqual(v.formatRemain(1000), '剩 00:01');
      assert.strictEqual(v.formatRemain(0), '剩 00:00');
      assert.strictEqual(v.formatRemain(100 * 3600 * 1000), '剩 100:00:00', '长时倒计时按总小时');
    });

    await test('VOTE-A6 时间格式化 / picker 解析：MM-DD HH:MM、跨年补年份、非法日期返回 0', function () {
      purge();
      const v = R('utils/vote.js');
      const pad2 = function (n) { return String(n).padStart(2, '0'); };
      // 必须用「相对未来」时间：写死 2026-11-11 18:30 作为 open 截止，在 18:30 之后运行会被
      // deadlineText 正确判为「已结束」，导致门禁不可重复（QA 2026-11-11 18:40 实测）。
      const when = new Date(Date.now() + 2 * 3600 * 1000);
      when.setSeconds(0, 0);
      const ts = when.getTime();
      const y = when.getFullYear();
      const mmdd = pad2(when.getMonth() + 1) + '-' + pad2(when.getDate());
      const hhmm = pad2(when.getHours()) + ':' + pad2(when.getMinutes());
      const dateStr = y + '-' + mmdd;
      const sameYear = y === new Date().getFullYear();
      assert.strictEqual(v.fmtDateTime(ts), (sameYear ? '' : y + '-') + mmdd + ' ' + hhmm);
      assert.strictEqual(v.fmtTime(ts), hhmm);
      assert.strictEqual(v.dateStrOf(ts), dateStr);
      assert.strictEqual(v.timeStrOf(ts), hhmm);
      assert.strictEqual(v.parseDeadline(dateStr, hhmm), ts);
      assert.strictEqual(v.parseDeadline(dateStr, '8:05'), new Date(y, when.getMonth(), when.getDate(), 8, 5).getTime());
      // 跨年补年份（固定到「下一年的 01-15 09:00」：与当前年份必然不同，且不参与 now 顺序判定）
      const ny = new Date();
      ny.setFullYear(ny.getFullYear() + 1, 0, 15);
      ny.setHours(9, 0, 0, 0);
      assert.strictEqual(v.fmtDateTime(ny.getTime()), ny.getFullYear() + '-01-15 09:00', '跨年补年份');
      assert.strictEqual(v.parseDeadline('2026-02-30', '10:00'), 0, '不存在的日期');
      assert.strictEqual(v.parseDeadline('2026-13-01', '10:00'), 0);
      assert.strictEqual(v.parseDeadline('2026-11-11', '25:00'), 0);
      assert.strictEqual(v.parseDeadline('', '10:00'), 0);
      assert.strictEqual(v.parseDeadline('2026-11-11', ''), 0);
      assert.strictEqual(v.quickDeadline(30, NOW), NOW + 30 * 60000);
      assert.strictEqual(v.deadlineText({ deadline: 0 }, NOW), '不限时');
      assert.strictEqual(v.deadlineText({ deadline: ts, status: 'open' }, Date.now()).indexOf('截止 ') === 0, true, '相对未来时间应显示「截止 …」');
      const closedText = v.deadlineText({ deadline: ts, status: 'closed', closed_at: ts }, ts + 1000);
      assert.ok(closedText.indexOf('已结束') === 0, closedText);
    });

    await test('VOTE-A7 百分比 / 结果可见性：pctOf 四舍五入、三种可见口径、匿名不产生投票人', function () {
      purge();
      const v = R('utils/vote.js');
      assert.strictEqual(v.pctOf(7, 12), 58);
      assert.strictEqual(v.pctOf(1, 3), 33);
      assert.strictEqual(v.pctOf(0, 0), 0);
      assert.strictEqual(v.pctOf(5, 0), 0);
      const rows = v.pctRows({ o1: 3, o2: 1 }, [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }], 4);
      assert.deepStrictEqual(rows, [
        { id: 'o1', count: 3, pct: 75 },
        { id: 'o2', count: 1, pct: 25 },
        { id: 'o3', count: 0, pct: 0 }
      ]);
      const always = { resultVisibility: 'always' };
      const after = { resultVisibility: 'afterVote' };
      const close = { resultVisibility: 'afterClose' };
      assert.strictEqual(v.resultsVisible(always, { hasVoted: false, closed: false }), true);
      assert.strictEqual(v.resultsVisible(after, { hasVoted: false, closed: true }), false);
      assert.strictEqual(v.resultsVisible(after, { hasVoted: true, closed: false }), true);
      assert.strictEqual(v.resultsVisible(close, { hasVoted: true, closed: false }), false);
      assert.strictEqual(v.resultsVisible(close, { hasVoted: false, closed: true }), true);
      // detailView：匿名投票即使服务端误回 voters 也不展示（隐私红线）
      const detail = detailFixture({
        has_voted: true, results_hidden: false, anonymous: false,
        poll: Object.assign(detailFixture().poll, { settings: { multi: false, maxChoices: 1, anonymous: true, allowChange: true, resultVisibility: 'afterVote' } }),
        voters: [{ name: '张三', choices: ['o1'] }]
      });
      assert.deepStrictEqual(v.detailView(detail, { now: NOW }).voters, [], '匿名投票不显示投票人');
      // 实名 + 可见 → 投票人姓名 + 所选文字
      const real = detailFixture({
        has_voted: true, results_hidden: false,
        poll: Object.assign(detailFixture().poll, { settings: { multi: false, maxChoices: 1, anonymous: false, allowChange: true, resultVisibility: 'afterVote' } }),
        voters: [{ name: '张三', choices: ['o1'] }, { name: '李四', choices: ['o2'] }]
      });
      assert.deepStrictEqual(v.detailView(real, { now: NOW }).voters, [
        { name: '张三', text: '红色' }, { name: '李四', text: '蓝色' }
      ]);
    });

    await test('VOTE-A8 多选上限与提交校验：单选替换 / 多选切换 / 超上限拒绝 / 非法与重复选项', function () {
      purge();
      const v = R('utils/vote.js');
      const single = v.normSettings({ multi: false });
      assert.deepStrictEqual(v.toggleChoice([], 'o1', single).choices, ['o1']);
      assert.deepStrictEqual(v.toggleChoice(['o1'], 'o2', single).choices, ['o2'], '单选替换');
      const multi = v.normSettings({ multi: true, maxChoices: 2 }, 4);
      let r = v.toggleChoice([], 'o1', multi);
      assert.strictEqual(r.ok, true);
      r = v.toggleChoice(r.choices, 'o2', multi);
      assert.strictEqual(r.ok, true);
      const over = v.toggleChoice(r.choices, 'o3', multi);
      assert.strictEqual(over.ok, false);
      assert.strictEqual(over.reason, '最多选 2 项');
      assert.deepStrictEqual(over.choices, ['o1', 'o2'], '超上限不改动已选');
      assert.deepStrictEqual(v.toggleChoice(['o1', 'o2'], 'o1', multi).choices, ['o2'], '再次点击取消');
      const opts = [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }];
      assert.strictEqual(v.validateChoices(['o9'], opts, single).reason, '选项不合法');
      assert.strictEqual(v.validateChoices(['o1', 'o1'], opts, single).reason, '重复的选项');
      assert.strictEqual(v.validateChoices([], opts, single).reason, '请选择 1 项');
      assert.strictEqual(v.validateChoices([], opts, multi).reason, '至少选 1 项');
      assert.strictEqual(v.validateChoices(['o1', 'o2'], opts, single).reason, '只能选 1 项');
      assert.strictEqual(v.validateChoices(['o1', 'o2', 'o3'], opts, multi).reason, '最多选 2 项');
      assert.strictEqual(v.validateChoices(['o1'], opts, single).ok, true);
      assert.strictEqual(v.validateChoices(['o1', 'o2'], opts, multi).ok, true);
    });

    await test('VOTE-A9 排序与卡片视图：进行中按截止升序（不限时在后）/ 已结束按创建倒序', function () {
      purge();
      const v = R('utils/vote.js');
      const polls = [
        pollFixture({ id: 'pclosed0001', title: '已结束', deadline: NOW - 1000, created_at: NOW - 3000 }),
        pollFixture({ id: 'plater00001', title: '晚截止', deadline: NOW + 3600000, created_at: NOW - 2000 }),
        pollFixture({ id: 'pnone000001', title: '不限时', deadline: 0, created_at: NOW - 4000 }),
        pollFixture({ id: 'pearly00001', title: '早截止', deadline: NOW + 60000, created_at: NOW - 1000 })
      ];
      const open = v.sortPolls(polls, 'open', NOW);
      assert.deepStrictEqual(open.map(function (p) { return p.id; }), ['pearly00001', 'plater00001', 'pnone000001']);
      const closed = v.sortPolls(polls, 'closed', NOW);
      assert.deepStrictEqual(closed.map(function (p) { return p.id; }), ['pclosed0001']);
      const cards = open.map(function (p) { return v.cardView(p, NOW); });
      assert.strictEqual(cards[0].title, '早截止');
      assert.strictEqual(cards[0].statusText, '进行中');
      assert.strictEqual(cards[0].openTimed, true);
      assert.ok(cards[0].countdownText.indexOf('剩 ') === 0);
      assert.strictEqual(cards[2].countdownText, '不限时');
      assert.strictEqual(cards[0].tags.length, 3, '卡片规则标签 3 个');
      assert.strictEqual(cards[0].tags[0].text, '单选');
      assert.strictEqual(cards[0].tags[1].text, '匿名');
      assert.strictEqual(cards[0].tags[2].text, '投票后可见');
      assert.strictEqual(cards[0].totalText, '3 人已投');
      const endCard = v.cardView(polls[0], NOW);
      assert.strictEqual(endCard.closed, true);
      assert.strictEqual(endCard.countdownText, '已结束');
      assert.strictEqual(endCard.statusText, '已结束');
      // 不修改入参顺序
      assert.deepStrictEqual(polls.map(function (p) { return p.id; }), ['pclosed0001', 'plater00001', 'pnone000001', 'pearly00001']);
    });

    await test('VOTE-A10 详情视图：结果条/勾选回显/隐藏口径/管理入口/改票文案', function () {
      purge();
      const v = R('utils/vote.js');
      const hidden = v.detailView(detailFixture(), { now: NOW });
      assert.ok(hidden);
      assert.strictEqual(hidden.title, '班服颜色');
      assert.strictEqual(hidden.ownerText, '发起人 测试账号');
      assert.strictEqual(hidden.statusText, '进行中');
      assert.strictEqual(hidden.total, 3);
      assert.strictEqual(hidden.resultsHidden, true);
      assert.strictEqual(hidden.options[0].showBar, false, '结果隐藏时不显示百分比条');
      assert.strictEqual(hidden.options[0].count, 0);
      assert.strictEqual(hidden.canVote, true);
      assert.strictEqual(hidden.submitText, '提交投票');
      assert.ok(hidden.hiddenTip.indexOf('投票后可见') >= 0);
      assert.strictEqual(hidden.options[1].text, '蓝色');
      // 已投票 + 可见（服务端口径 results_hidden=false）
      const voted = v.detailView(detailFixture({
        has_voted: true, results_hidden: false, counts: { o1: 2, o2: 1 }, my_choices: ['o1']
      }), { now: NOW });
      assert.strictEqual(voted.resultsHidden, false);
      assert.strictEqual(voted.options[0].count, 2);
      assert.strictEqual(voted.options[0].pct, 67);
      assert.strictEqual(voted.options[0].showBar, true);
      assert.strictEqual(voted.options[0].selected, true, '回显 my_choices');
      assert.strictEqual(voted.submitText, '改票');
      // 关闭的投票：不可投票、不可提前结束；total>0 → 不可编辑
      const closedDetail = detailFixture();
      closedDetail.closed = true;
      closedDetail.poll.status = 'closed';
      closedDetail.can_manage = true;
      closedDetail.poll.settings = { multi: true, maxChoices: 2, anonymous: false, allowChange: true, resultVisibility: 'afterClose' };
      closedDetail.results_hidden = false;
      const closedView = v.detailView(closedDetail, { now: NOW });
      assert.strictEqual(closedView.closed, true);
      assert.strictEqual(closedView.canVote, false);
      assert.strictEqual(closedView.canClose, false);
      assert.strictEqual(closedView.canEdit, false, '已有票不可编辑');
      assert.strictEqual(closedView.canExtend, true);
      assert.strictEqual(closedView.extendLabel, '重开');
      assert.strictEqual(closedView.tags[0].text, '多选 2 项');
      assert.strictEqual(closedView.tags[1].text, '实名');
      // 无票 + 管理者 → 可编辑
      const editable = v.detailView(detailFixture({ total: 0, can_manage: true }), { now: NOW });
      assert.strictEqual(editable.canEdit, true);
      assert.strictEqual(editable.canClose, true);
      assert.strictEqual(editable.canDelete, true);
      // 传入 choices 时以页面勾选为准（改票中途）
      const mid = v.detailView(detailFixture({ has_voted: true, results_hidden: false }), { now: NOW, choices: ['o2'] });
      assert.strictEqual(mid.options[1].selected, true);
      assert.strictEqual(mid.options[0].selected, false);
      // 数据不完整 → null
      assert.strictEqual(v.detailView(null), null);
      assert.strictEqual(v.detailView({ ok: false, reason: '投票不存在' }), null);
    });

    await test('VOTE-A11 轮询节奏：quick 或截止 <6h → 5s；长时/不限时/已结束 → 10s', function () {
      purge();
      const v = R('utils/vote.js');
      assert.strictEqual(v.pollIntervalOf(pollFixture({ mode: 'quick' }), NOW), 5000);
      assert.strictEqual(v.pollIntervalOf(pollFixture({ mode: 'long', deadline: NOW + 6 * 3600 * 1000 + 1000 }), NOW), 10000);
      assert.strictEqual(v.pollIntervalOf(pollFixture({ mode: 'long', deadline: NOW + 3600 * 1000 }), NOW), 5000);
      assert.strictEqual(v.pollIntervalOf(pollFixture({ mode: 'long', deadline: 0 }), NOW), 10000);
      assert.strictEqual(v.pollIntervalOf(pollFixture({ mode: 'quick', deadline: NOW - 1000 }), NOW), 10000, '已到截止 → 慢轮询');
      assert.strictEqual(v.pollIntervalOf(pollFixture({ mode: 'quick', status: 'closed', closed: true }), NOW), 10000, '提前结束 → 慢轮询');
      assert.strictEqual(v.pollIntervalOf(detailFixture(), NOW), 5000, '详情结构也可判定');
      assert.strictEqual(v.pollIntervalOf(detailFixture({ poll: Object.assign(detailFixture().poll, { mode: 'long', deadline: 0 }) }), NOW), 10000);
      const closedDetail = detailFixture({ closed: true });
      closedDetail.poll.status = 'closed';
      assert.strictEqual(v.pollIntervalOf(closedDetail, NOW), 10000, '详情 closed=true → 慢轮询');
    });

    await test('VOTE-A12 发起 payload：字段校验 / 归一 / 选项 desc·img 按需省略 / id 规则', function () {
      purge();
      const v = R('utils/vote.js');
      const base = {
        title: ' 标题 ',
        description: '  说明  ',
        mode: 'quick',
        deadline: NOW + 30 * 60000,
        options: [{ id: 'o1', text: ' A ' }, { id: 'o2', text: 'B', desc: '补充', img: 'data:image/jpeg;base64,AAA' }],
        settings: { multi: true, maxChoices: 99, anonymous: true, allowChange: true, resultVisibility: 'afterVote' }
      };
      const r = v.buildPayload(base, NOW);
      assert.strictEqual(r.ok, true);
      const p = r.payload;
      assert.strictEqual(p.title, '标题');
      assert.strictEqual(p.description, '说明');
      assert.strictEqual(p.mode, 'quick');
      assert.strictEqual(p.deadline, NOW + 30 * 60000);
      assert.ok(/^p[a-z0-9]{4,32}$/.test(p.id), '未传 id 时自动生成');
      assert.strictEqual(p.options.length, 2);
      assert.deepStrictEqual(p.options[0], { id: 'o1', text: 'A' }, '空 desc/img 省略');
      assert.strictEqual(p.options[1].desc, '补充');
      assert.ok(p.options[1].img.indexOf('data:image/jpeg') === 0);
      assert.deepStrictEqual(p.settings, { multi: true, maxChoices: 2, anonymous: true, allowChange: true, resultVisibility: 'afterVote' }, 'maxChoices 按选项数归一');
      // 保留合法 id（编辑复用）
      const kept = v.buildPayload(Object.assign({}, base, { id: 'pabc12345' }), NOW);
      assert.strictEqual(kept.payload.id, 'pabc12345');
      // 错误分支
      assert.strictEqual(v.buildPayload(Object.assign({}, base, { title: '' }), NOW).reason, '请填写投票标题');
      assert.strictEqual(v.buildPayload(Object.assign({}, base, { title: 'x'.repeat(81) }), NOW).reason, '标题最多 80 字');
      assert.strictEqual(v.buildPayload(Object.assign({}, base, { description: 'x'.repeat(501) }), NOW).reason, '说明最多 500 字');
      assert.strictEqual(v.buildPayload(Object.assign({}, base, { options: [{ id: 'o1', text: 'A' }] }), NOW).ok, false);
      assert.strictEqual(v.buildPayload(Object.assign({}, base, { deadline: NOW - 1 }), NOW).reason, '截止时间需要晚于当前时间');
      assert.strictEqual(v.buildPayload(Object.assign({}, base, { deadline: -5 }), NOW).reason, '截止时间不正确');
      // 不限时：deadline=0 允许
      const none = v.buildPayload(Object.assign({}, base, { deadline: 0 }), NOW);
      assert.strictEqual(none.ok, true);
      assert.strictEqual(none.payload.deadline, 0);
    });

    await test('VOTE-A13 编辑回填 editorFromPoll：时限类型 / 日期时间串 / 选项与规则还原', function () {
      purge();
      const v = R('utils/vote.js');
      const deadline = new Date(2026, 10, 12, 9, 5).getTime();
      const detail = detailFixture();
      detail.poll.deadline = deadline;
      detail.poll.mode = 'long';
      detail.poll.settings = { multi: true, maxChoices: 2, anonymous: false, allowChange: false, resultVisibility: 'afterClose' };
      const e = v.editorFromPoll(detail);
      assert.strictEqual(e.type, 'long');
      assert.strictEqual(e.dDate, '2026-11-12');
      assert.strictEqual(e.dTime, '09:05');
      assert.strictEqual(e.title, '班服颜色');
      assert.strictEqual(e.description, '选一个');
      assert.strictEqual(e.options.length, 2);
      assert.strictEqual(e.settings.multi, true);
      assert.strictEqual(e.settings.maxChoices, 2);
      assert.strictEqual(e.settings.anonymous, false);
      assert.strictEqual(e.settings.allowChange, false);
      assert.strictEqual(e.settings.resultVisibility, 'afterClose');
      const unlimited = v.editorFromPoll(detailFixture({ poll: Object.assign(detailFixture().poll, { deadline: 0 }) }));
      assert.strictEqual(unlimited.type, 'none');
      assert.strictEqual(unlimited.deadline, 0);
    });

    await test('VOTE-A14 配图缩放 fitRect：长边 ≤640、等比、整数、非法输入置 0', function () {
      purge();
      const v = R('utils/vote.js');
      assert.deepStrictEqual(v.fitRect(1280, 720, 640), { w: 640, h: 360 });
      assert.deepStrictEqual(v.fitRect(720, 1280, 640), { w: 360, h: 640 });
      assert.deepStrictEqual(v.fitRect(300, 200, 640), { w: 300, h: 200 }, '小图不放大');
      assert.deepStrictEqual(v.fitRect(641, 100, 640), { w: 640, h: 100 });
      assert.deepStrictEqual(v.fitRect(0, 100, 640), { w: 0, h: 0 });
      assert.deepStrictEqual(v.fitRect('x', 1, 640), { w: 0, h: 0 });
      const r = v.fitRect(1000, 777, 640);
      assert.ok(r.w <= 640 && r.h <= 640 && r.w > 0 && r.h > 0);
      assert.ok(Math.abs(r.w / r.h - 1000 / 777) < 0.01, '等比');
    });

    await test('VOTE-A15 可见范围归一：all/committee/league/custom、非法值兜底 all、custom 座号去重升序与空校验', function () {
      purge();
      const v = R('utils/vote.js');
      assert.deepStrictEqual(v.AUD, ['all', 'committee', 'league', 'custom']);
      assert.strictEqual(v.SEAT_MIN, 1);
      assert.strictEqual(v.SEAT_MAX, 70);
      assert.strictEqual(v.normAudience('all'), 'all');
      assert.strictEqual(v.normAudience('committee'), 'committee');
      assert.strictEqual(v.normAudience('league'), 'league');
      assert.strictEqual(v.normAudience('custom'), 'custom');
      assert.strictEqual(v.normAudience('bogus'), 'all', '非法值兜底 all');
      assert.strictEqual(v.normAudience(''), 'all');
      assert.strictEqual(v.normAudience(undefined), 'all');
      assert.strictEqual(v.normAudience(' committee '), 'committee', '去首尾空白');
      // 座号归一：只保留 1–70 整数、去重、升序
      assert.deepStrictEqual(v.normAudienceSeats([5, '2', 2, 0, 71, -1, 'x', 3, 3]), [2, 3, 5]);
      assert.deepStrictEqual(v.normAudienceSeats([70, 1, 69.5]), [1, 70], '非整数/越界丢弃');
      assert.deepStrictEqual(v.normAudienceSeats(null), []);
      assert.deepStrictEqual(v.normAudienceSeats(['10', 9]), [9, 10]);
      // custom 至少 1 人（reason 与服务端 poll_norm_audience 同文案）
      const empty = v.normAudienceChoice('custom', []);
      assert.strictEqual(empty.ok, false);
      assert.strictEqual(empty.reason, '请选择可见成员');
      assert.strictEqual(v.normAudienceChoice('custom', [0, 71, 'x']).ok, false, '无效座号等于空');
      assert.deepStrictEqual(v.normAudienceChoice('committee', [3, 5]).seats, [], '非 custom 座号恒 []');
      assert.deepStrictEqual(v.normAudienceChoice('custom', [5, 2, 5]), { ok: true, reason: '', audience: 'custom', seats: [2, 5] });
      // 范围标签：all 不显示；班委/团员固定文案；指定 N 人
      assert.strictEqual(v.audienceTag('all', 5), '', '全班不显示范围标签');
      assert.strictEqual(v.audienceTag('committee', 0), '班委可见');
      assert.strictEqual(v.audienceTag('league', 0), '团员可见');
      assert.strictEqual(v.audienceTag('custom', 3), '指定 3 人');
      assert.strictEqual(v.audienceTag('custom', 0), '指定成员可见');
      assert.strictEqual(v.audienceTagOf({ audience: 'custom', audience_count: 2 }), '指定 2 人');
      assert.strictEqual(v.audienceTagOf({ audience: 'custom', audience_seats: [1, 2, 3] }), '指定 3 人', '无 count 时按座号数');
      assert.strictEqual(v.audienceTagOf({}), '', '旧数据无范围 = 全班不显示');
      assert.strictEqual(v.audienceText('all'), '全班');
      assert.strictEqual(v.audienceText('committee'), '班委');
      assert.strictEqual(v.audienceText('league'), '团员');
      assert.strictEqual(v.audienceText('custom'), '指定成员');
    });

    await test('VOTE-A16 可见范围贯穿：buildPayload 带 audience/audienceSeats、editorFromPoll 回填、card/detail 带范围标签', function () {
      purge();
      const v = R('utils/vote.js');
      const base = {
        title: '范围投票', description: '说明', mode: 'quick', deadline: NOW + 600000,
        options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }], settings: {}
      };
      // 默认 / 非法值 → all；audienceSeats 恒 []
      const allP = v.buildPayload(base, NOW);
      assert.strictEqual(allP.ok, true);
      assert.strictEqual(allP.payload.audience, 'all');
      assert.deepStrictEqual(allP.payload.audienceSeats, []);
      const inv = v.buildPayload(Object.assign({}, base, { audience: 'bogus', audienceSeats: [3] }), NOW);
      assert.strictEqual(inv.ok, true);
      assert.strictEqual(inv.payload.audience, 'all');
      assert.deepStrictEqual(inv.payload.audienceSeats, []);
      // committee / league：不带座号
      assert.strictEqual(v.buildPayload(Object.assign({}, base, { audience: 'committee' }), NOW).payload.audience, 'committee');
      assert.deepStrictEqual(v.buildPayload(Object.assign({}, base, { audience: 'league', audienceSeats: [3] }), NOW).payload.audienceSeats, [], '非 custom 不保留座号');
      // custom：座号去重升序
      const cp = v.buildPayload(Object.assign({}, base, { audience: 'custom', audienceSeats: [5, 2, 5] }), NOW);
      assert.strictEqual(cp.ok, true);
      assert.strictEqual(cp.payload.audience, 'custom');
      assert.deepStrictEqual(cp.payload.audienceSeats, [2, 5]);
      // custom 空座号：客户端拦截（reason 与服务端同文案）
      const bad = v.buildPayload(Object.assign({}, base, { audience: 'custom', audienceSeats: [] }), NOW);
      assert.strictEqual(bad.ok, false);
      assert.strictEqual(bad.reason, '请选择可见成员');
      // editorFromPoll 回填（custom 座号仅管理者详情返回）
      const d = detailFixture({ total: 0, can_manage: true });
      d.poll.audience = 'custom';
      d.poll.audience_count = 2;
      d.poll.audience_seats = [5, 2];
      const e = v.editorFromPoll(d);
      assert.strictEqual(e.audience, 'custom');
      assert.deepStrictEqual(e.audienceSeats, [2, 5], '回填座号去重升序');
      assert.strictEqual(e.audienceCount, 2);
      const eAll = v.editorFromPoll(detailFixture());
      assert.strictEqual(eAll.audience, 'all');
      assert.deepStrictEqual(eAll.audienceSeats, []);
      // cardView：all 3 个标签（不显示范围）；其它范围追加第 4 个范围标签
      assert.deepStrictEqual(v.cardView(pollFixture(), NOW).tags.map(function (t) { return t.text; }), ['单选', '匿名', '投票后可见']);
      const cComm = v.cardView(pollFixture({ audience: 'committee' }), NOW);
      assert.deepStrictEqual(cComm.tags.map(function (t) { return t.text; }), ['单选', '匿名', '投票后可见', '班委可见']);
      assert.strictEqual(cComm.tags[3].key, 'aud');
      assert.strictEqual(cComm.audienceTag, '班委可见');
      assert.strictEqual(v.cardView(pollFixture({ audience: 'league' }), NOW).audienceTag, '团员可见');
      const cCus = v.cardView(pollFixture({ audience: 'custom', audience_count: 3 }), NOW);
      assert.strictEqual(cCus.tags.length, 4);
      assert.strictEqual(cCus.tags[3].text, '指定 3 人');
      assert.strictEqual(cCus.audience, 'custom');
      // detailView：all 4 个规则标签；其它范围追加范围标签且 audience_count 直接使用
      const dvAll = v.detailView(detailFixture(), { now: NOW });
      assert.strictEqual(dvAll.tags.length, 4, 'all 只有规则标签');
      assert.strictEqual(dvAll.audienceTag, '');
      const dv = v.detailView(d, { now: NOW });
      assert.strictEqual(dv.tags.length, 5);
      assert.strictEqual(dv.tags[4].text, '指定 2 人');
      assert.strictEqual(dv.tags[4].key, 'aud');
      assert.strictEqual(dv.audienceTag, '指定 2 人');
      assert.strictEqual(dv.audience, 'custom');
      assert.strictEqual(dv.audienceCount, 2);
    });

    /* ============================================================
     * B. utils/cloud.js —— 5 个 poll RPC 的请求契约（mock wx.request）
     * ============================================================ */
    function cloudCtx() {
      const c = createCtx();
      global.wx = c.wxMock;
      purge();
      const cloud = R('utils/cloud.js');
      c.setIdentity(ID);
      enableCloud(cloud);
      return { C: c, cloud: cloud };
    }
    await test('VOTE-B1 poll_list：POST rpc/poll_list、body {}、publishableKey + X-Class-Token、返回归一', async function () {
      const { C: c, cloud } = cloudCtx();
      c.setReq(function (o) {
        if (String(o.url).indexOf('/rpc/poll_list') >= 0) {
          o.success({ statusCode: 200, data: { ok: true, now: 1760000000000, polls: [{ id: 'pabc12345', title: 'x' }] } });
          return;
        }
        o.success({ statusCode: 200, data: [] });
      });
      const r = await cloud.pollList();
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.now, 1760000000000);
      assert.strictEqual(r.polls.length, 1);
      const reqs = c.reqsOf('/rpc/poll_list');
      assert.strictEqual(reqs.length, 1);
      const o = reqs[0];
      assert.strictEqual(o.url, 'https://rest.test/v1/rdb/rest/rpc/poll_list');
      assert.strictEqual(String(o.method).toUpperCase(), 'POST');
      assert.deepStrictEqual(o.data, {});
      assert.strictEqual(o.header.Authorization, 'Bearer pk-test');
      assert.strictEqual(o.header['X-Class-Token'], 'tok-vote-1');
      assert.strictEqual(o.header['Content-Type'], 'application/json');
      assert.strictEqual(o.header.Prefer, undefined, 'RPC 不写 Prefer');
    });

    await test('VOTE-B2 poll_create：参数名与 payload 一一对应、mode 归一、失败 reason 透传', async function () {
      const { C: c, cloud } = cloudCtx();
      c.setReq(function (o) {
        o.success({ statusCode: 200, data: { ok: true, now: NOW, poll: { id: 'pabc12345', title: '标题' }, can_manage: true } });
      });
      const r = await cloud.pollCreate({
        id: 'pabc12345', title: '标题', description: '说明', mode: 'long',
        deadline: NOW + 3600000,
        options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B', img: 'data:image/jpeg;base64,AAA' }],
        settings: { multi: false, maxChoices: 1, anonymous: true, allowChange: true, resultVisibility: 'afterVote' }
      });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.poll.id, 'pabc12345');
      const o = c.reqsOf('/rpc/poll_create')[0];
      assert.strictEqual(o.url, 'https://rest.test/v1/rdb/rest/rpc/poll_create');
      assert.deepStrictEqual(o.data, {
        p_id: 'pabc12345',
        p_title: '标题',
        p_description: '说明',
        p_mode: 'long',
        p_options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B', img: 'data:image/jpeg;base64,AAA' }],
        p_settings: { multi: false, maxChoices: 1, anonymous: true, allowChange: true, resultVisibility: 'afterVote' },
        p_deadline: NOW + 3600000,
        // 可见范围（§1.6）：新客户端总是显式传；默认 all + 空座号（服务端默认值等价）
        p_audience: 'all',
        p_audience_seats: []
      });
      // 不完整 payload：本地拦截，不发请求
      const before = c.reqLog().length;
      const bad = await cloud.pollCreate({});
      assert.strictEqual(bad.ok, false);
      assert.strictEqual(c.reqLog().length, before, '缺参数不应发请求');
      // 业务失败（HTTP 200 + ok:false）：中文 reason 原样透传
      c.setReq(function (o2) { o2.success({ statusCode: 200, data: { ok: false, reason: '标题过长' } }); });
      const fail = await cloud.pollCreate({ id: 'pabc12345', title: '标题' });
      assert.strictEqual(fail.ok, false);
      assert.strictEqual(fail.reason, '标题过长');
    });

    await test('VOTE-B3 poll_detail / poll_submit：body 参数名 p_id、p_choices 数组、返回结构合并', async function () {
      const { C: c, cloud } = cloudCtx();
      c.setReq(function (o) {
        if (String(o.url).indexOf('/rpc/poll_detail') >= 0) { o.success({ statusCode: 200, data: detailFixture() }); return; }
        if (String(o.url).indexOf('/rpc/poll_submit') >= 0) { o.success({ statusCode: 200, data: detailFixture({ has_voted: true, results_hidden: false }) }); return; }
        o.success({ statusCode: 200, data: [] });
      });
      const d = await cloud.pollDetail('pabc12345');
      assert.strictEqual(d.ok, true);
      assert.strictEqual(d.poll.id, 'pabc12345');
      assert.strictEqual(c.reqsOf('/rpc/poll_detail')[0].data.p_id, 'pabc12345');
      const s = await cloud.pollSubmit('pabc12345', ['o1', 'o2']);
      assert.strictEqual(s.ok, true);
      assert.strictEqual(s.has_voted, true);
      const subReq = c.reqsOf('/rpc/poll_submit')[0];
      assert.deepStrictEqual(subReq.data, { p_id: 'pabc12345', p_choices: ['o1', 'o2'] });
      // 空 id 本地拦截
      const noId = await cloud.pollDetail('');
      assert.strictEqual(noId.ok, false);
      assert.strictEqual(noId.reason, '缺少投票参数');
    });

    await test('VOTE-B4 poll_manage：edit/close/extend/delete 动作、可选参数按需传（deadline=0 保留）', async function () {
      const { C: c, cloud } = cloudCtx();
      c.setReq(function (o) { o.success({ statusCode: 200, data: detailFixture({ can_manage: true }) }); });
      // close：只传必需参数
      let r = await cloud.pollManage({ id: 'pabc12345', action: 'close' });
      assert.strictEqual(r.ok, true);
      assert.deepStrictEqual(c.reqsOf('/rpc/poll_manage').pop().data, { p_id: 'pabc12345', p_action: 'close' });
      // extend：p_deadline 显式传（含 0 = 改为不限时的语义保留）
      await cloud.pollManage({ id: 'pabc12345', action: 'extend', deadline: NOW + 600000 });
      assert.deepStrictEqual(c.reqsOf('/rpc/poll_manage').pop().data, { p_id: 'pabc12345', p_action: 'extend', p_deadline: NOW + 600000 });
      await cloud.pollManage({ id: 'pabc12345', action: 'extend', deadline: 0 });
      assert.strictEqual(c.reqsOf('/rpc/poll_manage').pop().data.p_deadline, 0, 'p_deadline=0 必须保留（改为不限时）');
      // edit：title/description/options/settings/deadline 全部传
      await cloud.pollManage({
        id: 'pabc12345', action: 'edit', title: 'T', description: 'D',
        options: [{ id: 'o1', text: 'A' }], settings: { multi: false }, deadline: NOW + 1000
      });
      const editBody = c.reqsOf('/rpc/poll_manage').pop().data;
      assert.deepStrictEqual(editBody, {
        p_id: 'pabc12345', p_action: 'edit', p_title: 'T', p_description: 'D',
        p_options: [{ id: 'o1', text: 'A' }], p_settings: { multi: false }, p_deadline: NOW + 1000
      });
      // delete
      await cloud.pollManage({ id: 'pabc12345', action: 'delete' });
      assert.deepStrictEqual(c.reqsOf('/rpc/poll_manage').pop().data, { p_id: 'pabc12345', p_action: 'delete' });
      // 非法参数本地拦截
      const before = c.reqLog().length;
      assert.strictEqual((await cloud.pollManage({ id: 'pabc', action: 'bogus' })).ok, false);
      assert.strictEqual((await cloud.pollManage({ action: 'close' })).ok, false);
      assert.strictEqual(c.reqLog().length, before);
    });

    await test('VOTE-B5 错误 reason 映射：网络失败/http 500 → 网络不可用；无身份 → 请先完成身份验证；云未配置 → 云端未连接', async function () {
      // 网络失败（wx.request fail）
      let ctx = cloudCtx();
      ctx.C.setReq(function (o) { o.fail({ errMsg: 'request:fail timeout' }); });
      let r = await ctx.cloud.pollList();
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.reason, '网络不可用，稍后重试');
      // POST 不自动重试（只发一次，避免重复投票）
      assert.strictEqual(ctx.C.reqLog().length, 1);
      // http 500
      ctx = cloudCtx();
      ctx.C.setReq(function (o) { o.success({ statusCode: 500, data: { message: 'boom' } }); });
      r = await ctx.cloud.pollDetail('pabc12345');
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.reason, '网络不可用，稍后重试');
      // 无身份：不发请求
      ctx = cloudCtx();
      ctx.C.clearMem();
      r = await ctx.cloud.pollList();
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.reason, '请先完成身份验证');
      assert.strictEqual(ctx.C.reqLog().length, 0, '无身份不得发数据请求');
      // 云端未配置：不发请求
      ctx = cloudCtx();
      ctx.cloud.configure({ enabled: false });
      r = await ctx.cloud.pollList();
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.reason, '云端未连接');
      assert.strictEqual(ctx.C.reqLog().length, 0);
    });

    await test('VOTE-B6 工程约束：5 个函数已导出、rpc 配置名与契约一致、不新增请求通道、不打印 token', function () {
      const { cloud } = cloudCtx();
      ['pollCreate', 'pollList', 'pollDetail', 'pollSubmit', 'pollManage'].forEach(function (k) {
        assert.strictEqual(typeof cloud[k], 'function', 'cloud.' + k + ' 未导出');
      });
      assert.strictEqual(cloud.CONFIG.rpc.pollCreate, 'rpc/poll_create');
      assert.strictEqual(cloud.CONFIG.rpc.pollList, 'rpc/poll_list');
      assert.strictEqual(cloud.CONFIG.rpc.pollDetail, 'rpc/poll_detail');
      assert.strictEqual(cloud.CONFIG.rpc.pollSubmit, 'rpc/poll_submit');
      assert.strictEqual(cloud.CONFIG.rpc.pollManage, 'rpc/poll_manage');
      const source = src('utils/cloud.js');
      // 5 个封装一律走 rpcCall（既有通道），不新增 wx.request 通道
      ['pollCreate', 'pollList', 'pollDetail', 'pollSubmit', 'pollManage'].forEach(function (k) {
        assert.ok(source.indexOf('function ' + k + '(') >= 0, '缺少 ' + k + ' 实现');
      });
      assert.strictEqual((source.match(/wx\.request\(/g) || []).length, 3, 'wx.request 直连数量应保持既有 3 处');
      assert.ok(source.indexOf('pollCreate: pollCreate') >= 0);
      assert.ok(!/console\.(log|warn|error|info)/.test(source), 'cloud.js 不得打印日志（含 token 风险）');
      // 5 个新函数内部必须调用 rpcCall（逐个函数体粗检）
      const seg = source.slice(source.indexOf('// ---------------------------------------------------------------- 投票'));
      assert.ok(seg.indexOf('rpcCall(CONFIG.rpc.pollCreate') >= 0);
      assert.ok(seg.indexOf('rpcCall(CONFIG.rpc.pollList') >= 0);
      assert.ok(seg.indexOf('rpcCall(CONFIG.rpc.pollDetail') >= 0);
      assert.ok(seg.indexOf('rpcCall(CONFIG.rpc.pollSubmit') >= 0);
      assert.ok(seg.indexOf('rpcCall(CONFIG.rpc.pollManage') >= 0);
    });

    await test('VOTE-B7 可见范围请求体：poll_create 带 p_audience/p_audience_seats；manage 显式传才带（旧版不传=保持）；detail 透传', async function () {
      const { C: c, cloud } = cloudCtx();
      c.setReq(function (o) {
        o.success({ statusCode: 200, data: { ok: true, now: NOW, poll: { id: 'pabc12345', audience: 'custom', audience_count: 2 } } });
      });
      // create 默认 all + []
      await cloud.pollCreate({ id: 'pabc12345', title: 'T' });
      let body = c.reqsOf('/rpc/poll_create').pop().data;
      assert.strictEqual(body.p_audience, 'all');
      assert.deepStrictEqual(body.p_audience_seats, []);
      // create custom：座号原样透传（数值化；归一/校验在 utils/vote.js + 服务端）
      await cloud.pollCreate({ id: 'pabc12345', title: 'T', audience: 'custom', audienceSeats: [5, 2] });
      body = c.reqsOf('/rpc/poll_create').pop().data;
      assert.strictEqual(body.p_audience, 'custom');
      assert.deepStrictEqual(body.p_audience_seats, [5, 2]);
      // create committee：非 custom 不保留座号
      await cloud.pollCreate({ id: 'pabc12345', title: 'T', audience: 'committee', audienceSeats: [3] });
      body = c.reqsOf('/rpc/poll_create').pop().data;
      assert.strictEqual(body.p_audience, 'committee');
      assert.deepStrictEqual(body.p_audience_seats, []);
      // create 非法范围 → all（兜底，不报错）
      await cloud.pollCreate({ id: 'pabc12345', title: 'T', audience: 'bogus' });
      assert.strictEqual(c.reqsOf('/rpc/poll_create').pop().data.p_audience, 'all');
      // manage edit：显式传范围才发送
      await cloud.pollManage({
        id: 'pabc12345', action: 'edit', title: 'T', description: '',
        options: [{ id: 'o1', text: 'A' }], settings: { multi: false }, deadline: NOW + 1000,
        audience: 'custom', audienceSeats: [7, 3]
      });
      let mbody = c.reqsOf('/rpc/poll_manage').pop().data;
      assert.strictEqual(mbody.p_audience, 'custom');
      assert.deepStrictEqual(mbody.p_audience_seats, [7, 3]);
      // manage 不传范围 → 不带键（服务端保持原范围，旧版页面兼容）
      await cloud.pollManage({ id: 'pabc12345', action: 'close' });
      mbody = c.reqsOf('/rpc/poll_manage').pop().data;
      assert.strictEqual(mbody.p_audience, undefined);
      assert.strictEqual(mbody.p_audience_seats, undefined);
      // 显式改成 all：p_audience=all + 空座号（清空旧 custom）
      await cloud.pollManage({ id: 'pabc12345', action: 'edit', title: 'T', options: [], settings: {}, deadline: NOW + 1000, audience: 'all' });
      mbody = c.reqsOf('/rpc/poll_manage').pop().data;
      assert.strictEqual(mbody.p_audience, 'all');
      assert.deepStrictEqual(mbody.p_audience_seats, []);
      // detail 直接使用服务端返回的 audience 字段（不做本地改写）
      c.setReq(function (o) {
        o.success({ statusCode: 200, data: { ok: true, now: NOW, poll: { id: 'pabc12345', audience: 'custom', audience_count: 3, audience_seats: [] } } });
      });
      const d = await cloud.pollDetail('pabc12345');
      assert.strictEqual(d.poll.audience, 'custom');
      assert.strictEqual(d.poll.audience_count, 3);
      assert.deepStrictEqual(d.poll.audience_seats, [], '非管理者详情座号恒 []（服务端 privacy 限制）');
    });

    /* ============================================================
     * C. 页面级
     * ============================================================ */
    function pageEnv() {
      const c = createCtx();
      global.wx = c.wxMock;
      purge();
      const cloud = R('utils/cloud.js');
      c.setIdentity(ID);
      enableCloud(cloud);
      return { C: c, cloud: cloud };
    }
    await test('VOTE-C1 pages/vote：列表渲染/筛选/失败保留列表 + toast（契约 §4.2 失败兜底）', async function () {
      const { C: c } = pageEnv();
      const def = loadPageDef(VOTE_PAGE);
      const ctx = ctxOf(def);
      const openEarly = pollFixture({ id: 'pearly00001', title: '早截止', deadline: NOW + 60000, created_at: NOW - 1000 });
      const openLate = pollFixture({ id: 'plater00001', title: '晚截止', deadline: NOW + 3600000, created_at: NOW - 2000 });
      const unlimited = pollFixture({ id: 'pnone000001', title: '不限时', deadline: 0, created_at: NOW - 3000 });
      const ended = pollFixture({ id: 'pclosed0001', title: '已结束', deadline: NOW - 1000, created_at: NOW - 4000 });
      c.setReq(function (o) {
        if (String(o.url).indexOf('/rpc/poll_list') < 0) { o.success({ statusCode: 200, data: [] }); return; }
        o.success({ statusCode: 200, data: { ok: true, now: NOW, polls: [ended, openLate, unlimited, openEarly] } });
      });
      try {
        ctx.onLoad({});
        ctx.onShow();
        assert.ok(await waitFor(function () { return ctx.data.rows.length === 3; }), '列表应有 3 个进行中');
        assert.deepStrictEqual(ctx.data.rows.map(function (r) { return r.title; }), ['早截止', '晚截止', '不限时']);
        assert.deepStrictEqual([ctx.data.openCount, ctx.data.closedCount], [3, 1]);
        assert.strictEqual(ctx.data.state, 'ready');
        assert.strictEqual(ctx.data.empty, false);
        // 已结束筛选
        ctx.switchTab({ currentTarget: { dataset: { tab: 'closed' } } });
        assert.strictEqual(ctx.data.rows.length, 1);
        assert.strictEqual(ctx.data.rows[0].title, '已结束');
        assert.strictEqual(ctx.data.rows[0].closed, true);
        // 网络失败：保留已渲染列表 + toast
        c.setReq(function (o) { o.fail({ errMsg: 'request:fail' }); });
        await ctx.load(true);
        assert.strictEqual(ctx.data.rows.length, 1, '失败不清空列表');
        assert.ok(ctx.data.listError.indexOf('网络') >= 0, ctx.data.listError);
        assert.ok(c.toastLog().join('|').indexOf('网络不可用，稍后重试') >= 0);
        // 空态文案按筛选切换（契约 §3.2 同文案）
        ctx.switchTab({ currentTarget: { dataset: { tab: 'open' } } });
        assert.strictEqual(ctx.data.rows.length, 3, '筛选回进行中仍用上次数据');
      } finally {
        ctx.onHide();
        ctx.onUnload();
      }
    });

    await test('VOTE-C2 pages/vote：发起投票 → poll_create 参数完整（选项/规则/时限）；网络重试复用同一 id', async function () {
      const { C: c } = pageEnv();
      const def = loadPageDef(VOTE_PAGE);
      const ctx = ctxOf(def);
      let createFails = 1;   // 第一次 poll_create 模拟网络失败，第二次成功（校验 §2.1 幂等重试）
      c.setReq(function (o) {
        if (String(o.url).indexOf('/rpc/poll_create') >= 0) {
          if (createFails > 0) { createFails -= 1; o.fail({ errMsg: 'request:fail mock' }); return; }
          o.success({ statusCode: 200, data: detailFixture() });
          return;
        }
        if (String(o.url).indexOf('/rpc/poll_list') >= 0) { o.success({ statusCode: 200, data: { ok: true, now: NOW, polls: [] } }); return; }
        o.success({ statusCode: 200, data: [] });
      });
      try {
        ctx.onLoad({});
        ctx.onShow();
        await waitFor(function () { return ctx.data.state === 'ready'; });
        ctx.openCreate();
        assert.strictEqual(ctx.data.formOpen, true);
        // 校验失败：标题为空 → 不发请求
        const before = c.reqLog().length;
        ctx.submitCreate();
        assert.strictEqual(c.reqLog().length, before, '空标题不应发请求');
        assert.ok(c.toastLog().join('|').indexOf('请填写投票标题') >= 0);
        // 正常填写
        ctx.onTitleInput({ detail: { value: '班会投票' } });
        ctx.onDescInput({ detail: { value: '说明' } });
        ctx.onOptText({ currentTarget: { dataset: { i: 0 } }, detail: { value: '选项A' } });
        ctx.onOptText({ currentTarget: { dataset: { i: 1 } }, detail: { value: '选项B' } });
        ctx.onOptDesc({ currentTarget: { dataset: { i: 1 } }, detail: { value: '补充' } });
        ctx.onMultiChange({ detail: { value: true } });
        ctx.pickMax({ currentTarget: { dataset: { n: 2 } } });
        ctx.onAnonChange({ detail: { value: false } });
        ctx.pickVis({ currentTarget: { dataset: { vis: 'afterClose' } } });
        ctx.pickQuick({ currentTarget: { dataset: { min: 10 } } });
        // 第一次：网络失败 → 弹层保持、表单值保留、toast 网络提示
        ctx.submitCreate();
        assert.ok(await waitFor(function () { return c.reqsOf('/rpc/poll_create').length === 1; }), '应发出 poll_create');
        await sleep(20);
        assert.strictEqual(ctx.data.formOpen, true, '网络失败不关闭弹层');
        assert.ok(c.toastLog().join('|').indexOf('网络不可用，稍后重试') >= 0);
        const firstId = c.reqsOf('/rpc/poll_create')[0].data.p_id;
        // 第二次：重试复用同一 p_id（幂等），成功后关闭弹层
        ctx.submitCreate();
        assert.ok(await waitFor(function () { return c.reqsOf('/rpc/poll_create').length === 2; }), '重试应再次发出 poll_create');
        const body = c.reqsOf('/rpc/poll_create')[1].data;
        assert.strictEqual(body.p_id, firstId, '重试必须复用同一 id（契约 §2.1 幂等）');
        assert.strictEqual(body.p_title, '班会投票');
        assert.strictEqual(body.p_description, '说明');
        assert.strictEqual(body.p_mode, 'quick');
        assert.ok(body.p_deadline > Date.now() + 8 * 60000, '限时 10 分钟');
        assert.strictEqual(body.p_options.length, 2);
        assert.strictEqual(body.p_options[1].desc, '补充');
        assert.deepStrictEqual(body.p_settings, { multi: true, maxChoices: 2, anonymous: false, allowChange: true, resultVisibility: 'afterClose' });
        // 可见范围默认「全班」（表单默认值）
        assert.strictEqual(body.p_audience, 'all');
        assert.deepStrictEqual(body.p_audience_seats, []);
        assert.ok(await waitFor(function () { return ctx.data.formOpen === false; }), '成功后关闭弹层');
        assert.ok(c.toastLog().join('|').indexOf('已发起') >= 0);
      } finally {
        ctx.onHide();
        ctx.onUnload();
      }
    });

    await test('VOTE-C3 pages/vote：编辑（?edit=id）预填 → poll_manage action=edit 保存', async function () {
      const { C: c } = pageEnv();
      const def = loadPageDef(VOTE_PAGE);
      const ctx = ctxOf(def);
      const detail = detailFixture({ total: 0, can_manage: true });
      // 编辑回填可见范围（custom 座号仅管理者详情返回）
      detail.poll.audience = 'custom';
      detail.poll.audience_count = 2;
      detail.poll.audience_seats = [5, 2];
      c.setReq(function (o) {
        if (String(o.url).indexOf('/rpc/poll_detail') >= 0) { o.success({ statusCode: 200, data: detail }); return; }
        if (String(o.url).indexOf('/rpc/poll_manage') >= 0) { o.success({ statusCode: 200, data: detail }); return; }
        if (String(o.url).indexOf('/rpc/poll_list') >= 0) { o.success({ statusCode: 200, data: { ok: true, now: NOW, polls: [] } }); return; }
        o.success({ statusCode: 200, data: [] });
      });
      try {
        ctx.onLoad({ edit: 'pabc12345' });
        ctx.onShow();
        assert.ok(await waitFor(function () { return ctx.data.formOpen === true; }), '应打开编辑弹层');
        assert.strictEqual(ctx.data.editing, true);
        assert.strictEqual(ctx.data.form.title, '班服颜色');
        assert.strictEqual(ctx.data.form.type, 'long');
        assert.strictEqual(ctx.data.form.options.length, 2);
        // 可见范围回填：custom + 座号去重升序
        assert.strictEqual(ctx.data.form.aud, 'custom');
        assert.deepStrictEqual(ctx.data.form.audSeats, [2, 5]);
        assert.strictEqual(ctx.data.selectedCount, 2);
        ctx.onTitleInput({ detail: { value: '班服颜色（改）' } });
        ctx.submitCreate();
        assert.ok(await waitFor(function () { return c.reqsOf('/rpc/poll_manage').length === 1; }), '编辑应走 poll_manage');
        const body = c.reqsOf('/rpc/poll_manage')[0].data;
        assert.strictEqual(body.p_action, 'edit');
        assert.strictEqual(body.p_id, 'pabc12345');
        assert.strictEqual(body.p_title, '班服颜色（改）');
        assert.strictEqual(body.p_options.length, 2);
        assert.ok(body.p_settings);
        assert.ok(typeof body.p_deadline === 'number');
        // 编辑必须带可见范围（custom + 原始座号）
        assert.strictEqual(body.p_audience, 'custom');
        assert.deepStrictEqual(body.p_audience_seats, [2, 5]);
      } finally {
        ctx.onHide();
        ctx.onUnload();
      }
    });

    await test('VOTE-C4 pages/votedetail：详情加载 / 勾选 / 提交 / 结果渲染（契约 §2.3）', async function () {
      const { C: c } = pageEnv();
      const def = loadPageDef(DETAIL_PAGE);
      const ctx = ctxOf(def);
      c.setReq(function (o) {
        if (String(o.url).indexOf('/rpc/poll_detail') >= 0) { o.success({ statusCode: 200, data: detailFixture() }); return; }
        if (String(o.url).indexOf('/rpc/poll_submit') >= 0) {
          o.success({ statusCode: 200, data: detailFixture({ has_voted: true, results_hidden: false, my_choices: ['o2'] }) });
          return;
        }
        o.success({ statusCode: 200, data: [] });
      });
      try {
        ctx.onLoad({ id: 'pabc12345' });
        ctx.onShow();
        assert.ok(await waitFor(function () { return ctx.data.state === 'ready'; }), '详情应加载完成');
        assert.strictEqual(ctx.data.d.title, '班服颜色');
        assert.strictEqual(ctx.data.d.canVote, true);
        assert.strictEqual(ctx.data.choices.length, 0);
        // 单选勾选（替换）
        ctx.pickOption({ currentTarget: { dataset: { id: 'o1' } } });
        assert.deepStrictEqual(ctx.data.choices, ['o1']);
        ctx.pickOption({ currentTarget: { dataset: { id: 'o2' } } });
        assert.deepStrictEqual(ctx.data.choices, ['o2'], '单选再点另一项 = 替换');
        // 提交
        ctx.submitVote();
        assert.ok(await waitFor(function () { return c.reqsOf('/rpc/poll_submit').length === 1; }), '应发出 poll_submit');
        assert.deepStrictEqual(c.reqsOf('/rpc/poll_submit')[0].data, { p_id: 'pabc12345', p_choices: ['o2'] });
        assert.ok(await waitFor(function () { return ctx.data.d.hasVoted === true; }), '提交成功后回显已投');
        assert.strictEqual(ctx.data.d.resultsHidden, false);
        assert.strictEqual(ctx.data.d.submitText, '改票');
        assert.ok(c.toastLog().join('|').indexOf('已投票') >= 0);
        const opt2 = ctx.data.d.options.filter(function (o) { return o.id === 'o2'; })[0];
        assert.strictEqual(opt2.selected, true);
        assert.strictEqual(opt2.showBar, true);
        assert.strictEqual(opt2.pct, 33, '1/3 票');
      } finally {
        ctx.onHide();
        ctx.onUnload();
      }
    });

    await test('VOTE-C5 pages/votedetail：管理（提前结束/延长/删除）全部带确认并调用 poll_manage', async function () {
      const { C: c } = pageEnv();
      const def = loadPageDef(DETAIL_PAGE);
      const ctx = ctxOf(def);
      const manageDetail = detailFixture({ total: 0, can_manage: true });
      c.setReq(function (o) {
        if (String(o.url).indexOf('/rpc/poll_detail') >= 0) { o.success({ statusCode: 200, data: manageDetail }); return; }
        if (String(o.url).indexOf('/rpc/poll_manage') >= 0) { o.success({ statusCode: 200, data: manageDetail }); return; }
        o.success({ statusCode: 200, data: [] });
      });
      try {
        ctx.onLoad({ id: 'pabc12345' });
        ctx.onShow();
        assert.ok(await waitFor(function () { return ctx.data.state === 'ready'; }));
        assert.strictEqual(ctx.data.d.canEdit, true);
        // 编辑（无票 + 管理者）：showModal 确认后才跳编辑页（契约 §4.2 管理动作带确认）
        ctx.manageEdit();
        assert.ok(c.modalLog().some(function (t) { return t === '编辑投票'; }), '编辑前必须有确认弹窗');
        assert.ok(c.navLog().join('|').indexOf('to:/pages/vote/vote?edit=pabc12345') >= 0, '确认后跳编辑页');
        // 提前结束（showModal 确认）
        ctx.manageClose();
        assert.ok(c.modalLog().some(function (t) { return t === '提前结束'; }), '结束前必须有确认弹窗');
        assert.ok(await waitFor(function () { return c.reqsOf('/rpc/poll_manage').length === 1; }));
        assert.deepStrictEqual(c.reqsOf('/rpc/poll_manage')[0].data, { p_id: 'pabc12345', p_action: 'close' });
        // 延长：+10 分钟（确认弹窗后才调用 poll_manage）
        ctx.openExtend();
        assert.strictEqual(ctx.data.extendOpen, true);
        ctx.pickExtQuick({ currentTarget: { dataset: { min: 10 } } });
        ctx.confirmExtend();
        assert.ok(c.modalLog().join('|').indexOf('延长截止') >= 0, '延长前必须有确认弹窗');
        assert.ok(await waitFor(function () { return c.reqsOf('/rpc/poll_manage').length === 2; }));
        const ext = c.reqsOf('/rpc/poll_manage')[1].data;
        assert.strictEqual(ext.p_action, 'extend');
        assert.ok(ext.p_deadline > Date.now() + 8 * 60000, '+10 分钟');
        // 删除（showModal 确认；确认后返回）
        global.getCurrentPages = function () { return [{ route: VOTE_PAGE }, { route: DETAIL_PAGE }]; };
        ctx.manageDelete();
        assert.ok(c.modalLog().some(function (t) { return t === '删除投票'; }), '删除前必须有确认弹窗');
        assert.ok(await waitFor(function () { return c.reqsOf('/rpc/poll_manage').length === 3; }));
        assert.deepStrictEqual(c.reqsOf('/rpc/poll_manage')[2].data, { p_id: 'pabc12345', p_action: 'delete' });
        await sleep(20);    // 等 poll_manage 的 .then 回调执行完（_back 在微任务里）
        assert.ok(c.navLog().join('|').indexOf('back:1') >= 0, '删除成功后返回上一页');
      } finally {
        delete global.getCurrentPages;
        ctx.onHide();
        ctx.onUnload();
      }
    });

    await test('VOTE-C6 pages/votedetail：加载失败不白屏（有旧数据保留 + toast），无 id 显示错误态', async function () {
      const { C: c } = pageEnv();
      const def = loadPageDef(DETAIL_PAGE);
      const ctx = ctxOf(def);
      c.setReq(function (o) {
        if (String(o.url).indexOf('/rpc/poll_detail') >= 0) { o.success({ statusCode: 200, data: detailFixture() }); return; }
        o.success({ statusCode: 200, data: [] });
      });
      try {
        ctx.onLoad({ id: 'pabc12345' });
        ctx.onShow();
        assert.ok(await waitFor(function () { return ctx.data.state === 'ready'; }));
        // 之后网络失败：保留详情 + toast
        c.setReq(function (o) { o.fail({ errMsg: 'request:fail' }); });
        ctx.load(true);
        await waitFor(function () { return c.toastLog().join('|').indexOf('网络不可用') >= 0; });
        assert.strictEqual(ctx.data.state, 'ready');
        assert.ok(ctx.data.d, '失败时保留已渲染详情');
        assert.ok(c.toastLog().join('|').indexOf('网络不可用，稍后重试') >= 0);
      } finally {
        ctx.onHide();
        ctx.onUnload();
      }
      // 无 id
      const { C: c2 } = pageEnv();
      const def2 = loadPageDef(DETAIL_PAGE);
      const ctx2 = ctxOf(def2);
      try {
        ctx2.onLoad({});
        assert.strictEqual(ctx2.data.state, 'error');
        assert.ok(ctx2.data.errorText.indexOf('缺少') >= 0);
      } finally {
        ctx2.onUnload();
      }
    });

    await test('VOTE-C7 pages/vote：指定成员可见范围（名单只显示姓名、内部用座号、至少 1 人、提交带座号）', async function () {
      const { C: c } = pageEnv();
      // 预置班级名单（classMembers 里含 sid；页面 data 必须剥离，不得出现学号）
      const store = R('utils/store.js');
      store.get().classMembers = [
        { seat: 1, sid: 'SID-PRIVATE-001', name: '测试甲', role: '', badge: '', is_admin: false },
        { seat: 24, sid: 'SID-PRIVATE-024', name: '测试账号', role: '副团支书', badge: '班委', is_admin: false },
        { seat: 5, sid: 'SID-PRIVATE-005', name: '张三', role: '', badge: '', is_admin: false }
      ];
      store.save();
      const def = loadPageDef(VOTE_PAGE);
      const ctx = ctxOf(def);
      c.setReq(function (o) {
        if (String(o.url).indexOf('/rpc/poll_create') >= 0) { o.success({ statusCode: 200, data: detailFixture() }); return; }
        if (String(o.url).indexOf('/rpc/poll_list') >= 0) { o.success({ statusCode: 200, data: { ok: true, now: NOW, polls: [] } }); return; }
        o.success({ statusCode: 200, data: [] });
      });
      try {
        ctx.onLoad({});
        ctx.onShow();
        await waitFor(function () { return ctx.data.state === 'ready'; });
        ctx.openCreate();
        // 默认全班；成员数据已就绪（按座号升序）
        assert.strictEqual(ctx.data.form.aud, 'all');
        assert.strictEqual(ctx.data.members.length, 3);
        assert.deepStrictEqual(ctx.data.members.map(function (m) { return m.name; }), ['测试甲', '张三', '测试账号']);
        assert.deepStrictEqual(ctx.data.members.map(function (m) { return m.seat; }), [1, 5, 24]);
        assert.strictEqual(JSON.stringify(ctx.data.members).indexOf('SID-PRIVATE'), -1, '页面 data 不得包含学号');
        // 切到指定成员
        ctx.pickAudience({ currentTarget: { dataset: { a: 'custom' } } });
        assert.strictEqual(ctx.data.form.aud, 'custom');
        assert.strictEqual(ctx.data.selectedCount, 0);
        // 填标题/选项后未选人提交 → 客户端拦截，不发请求
        ctx.onTitleInput({ detail: { value: '范围投票' } });
        ctx.onOptText({ currentTarget: { dataset: { i: 0 } }, detail: { value: 'A' } });
        ctx.onOptText({ currentTarget: { dataset: { i: 1 } }, detail: { value: 'B' } });
        const before = c.reqLog().length;
        ctx.submitCreate();
        assert.strictEqual(c.reqLog().length, before, 'custom 空座号不应发请求');
        assert.ok(c.toastLog().join('|').indexOf('请选择可见成员') >= 0);
        // 选 2 人（乱序点击）→ 内部座号升序
        ctx.toggleMember({ currentTarget: { dataset: { seat: 24 } } });
        ctx.toggleMember({ currentTarget: { dataset: { seat: 5 } } });
        assert.deepStrictEqual(ctx.data.form.audSeats, [5, 24]);
        assert.strictEqual(ctx.data.selectedCount, 2);
        const selMap = {};
        ctx.data.members.forEach(function (m) { selMap[m.seat] = m.sel; });
        assert.strictEqual(selMap[5], true);
        assert.strictEqual(selMap[24], true);
        assert.strictEqual(selMap[1], false);
        ctx.submitCreate();
        assert.ok(await waitFor(function () { return c.reqsOf('/rpc/poll_create').length === 1; }), '应发出 poll_create');
        const body = c.reqsOf('/rpc/poll_create')[0].data;
        assert.strictEqual(body.p_audience, 'custom');
        assert.deepStrictEqual(body.p_audience_seats, [5, 24]);
        // 再点已选成员 = 取消
        ctx.toggleMember({ currentTarget: { dataset: { seat: 5 } } });
        assert.deepStrictEqual(ctx.data.form.audSeats, [24]);
        // 切回全班：座号清空（提交时 p_audience_seats 恒 []）
        ctx.pickAudience({ currentTarget: { dataset: { a: 'all' } } });
        assert.strictEqual(ctx.data.form.aud, 'all');
        assert.deepStrictEqual(ctx.data.form.audSeats, []);
        assert.strictEqual(ctx.data.selectedCount, 0);
      } finally {
        ctx.onHide();
        ctx.onUnload();
      }
    });

    /* ============================================================
     * D. 静态断言（页面注册 / 入口 / 文件 / 图标 / 事件 / 分享 / 隐私）
     * ============================================================ */
    await test('VOTE-D1 app.json：两页已注册（水位之后、PPT 之前）且页面 4 件套齐全', function () {
      const app = JSON.parse(src('app.json'));
      assert.ok(Array.isArray(app.pages));
      assert.ok(allPages(app).indexOf(VOTE_PAGE) >= 0, 'app.json 未注册 pages/vote/vote');
      assert.ok(allPages(app).indexOf(DETAIL_PAGE) >= 0, 'app.json 未注册 pages/votedetail/votedetail');
      const iWater = app.pages.indexOf('pages/water/water');
      const iVote = app.pages.indexOf(VOTE_PAGE);
      const iPpt = allPages(app).indexOf('pages/ppt/ppt');
      assert.ok(iWater >= 0 && iVote > iWater, '投票页应位于 water 之后');
      assert.ok(iPpt >= 0, 'PPT 页应在主包或分包注册');
      [VOTE_PAGE, DETAIL_PAGE].forEach(function (p) {
        ['.js', '.wxml', '.json', '.wxss'].forEach(function (ext) {
          assert.ok(fs.existsSync(fileOf(p + ext)), 'MISSING ' + p + ext);
        });
        const j = JSON.parse(src(p + '.json'));
        assert.ok(j.navigationBarTitleText, p + '.json 缺少标题');
        assert.strictEqual(typeof j.usingComponents, 'object');
      });
    });

    await test('VOTE-D2 utils/tools.js：vote 入口字段与网页 TOOLS 对齐、位于 water 后 file 前', function () {
      purge();
      const tools = R('utils/tools.js');
      const t = tools.toolOf('vote');
      assert.ok(t, '工具目录缺少 vote');
      assert.deepStrictEqual(t, {
        key: 'vote', name: '投票', ico: '🗳', icoImg: '/images/tool-vote.png',
        meta: '限时 · 长时 · 实时结果',
        desc: '限时/长时投票，自定义标题与选项，全班实时查看结果',
        url: '/pages/vote/vote', tab: false, tone: 'primary'
      });
      const idx = tools.TOOLS.map(function (x) { return x.key; });
      assert.ok(idx.indexOf('water') < idx.indexOf('vote'), 'vote 应在 water 之后');
      assert.ok(idx.indexOf('vote') < idx.indexOf('file'), 'vote 应在 file 之前');
      // 2026-11-21 用户口径：仅班委可见；测试账号/普通同学完全隐藏入口
      const committee = { token: 'tok-vote-c', sid: 'fixture-committee-vote', name: '班委夹具', role: '班长', badge: '班委', is_admin: false, ts: 1 };
      assert.strictEqual(tools.entryAllowed(t, committee), true, '班委应可见投票入口');
      assert.strictEqual(tools.homeEligible(t, committee), true, '班委可把投票勾选进首页快捷');
      assert.strictEqual(tools.entryAllowed(t, ID), false, '测试账号应隐藏投票入口');
      assert.strictEqual(tools.homeEligible(t, ID), false, '测试账号不可勾选投票');
      assert.strictEqual(tools.entryAllowed(t, { token: 't', sid: 'fixture-ordinary-vote', name: '普通同学', role: '', badge: '', is_admin: false, ts: 1 }), false, '普通同学应隐藏投票入口');
      // 非投票工具不受影响
      assert.strictEqual(tools.entryAllowed(tools.toolOf('water'), ID), true, '测试账号仍可见其它工具');
    });

    await test('VOTE-D3 图标 /images/tool-vote.png：PNG 96×96 且体积在代码质量限制内', function () {
      const f = fileOf('images/tool-vote.png');
      assert.ok(fs.existsSync(f), '缺少 images/tool-vote.png');
      const buf = fs.readFileSync(f);
      assert.strictEqual(buf.slice(0, 8).toString('hex'), '89504e470d0a1a0a', '不是 PNG');
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      assert.strictEqual(w, 96);
      assert.strictEqual(h, 96);
      assert.ok(buf.length > 200 && buf.length < 200 * 1024, '图标体积异常：' + buf.length);
    });

    await test('VOTE-D4 WXML 事件 handler 全部在页面 JS 中定义（staticcheck 同口径）', function () {
      [VOTE_PAGE, DETAIL_PAGE].forEach(function (p) {
        const js = src(p + '.js');
        const wxml = src(p + '.wxml');
        const handlers = {};
        const re = /(?:bind|catch)[:]?[a-zA-Z]+="([A-Za-z_$][\w$]*)"/g;
        let m;
        while ((m = re.exec(wxml))) handlers[m[1]] = 1;
        const names = Object.keys(handlers);
        assert.ok(names.length >= 10, p + ' handler 数量异常：' + names.length);
        names.forEach(function (h) {
          const reg = new RegExp('\\b(function\\s+' + h.replace(/\$/g, '\\$') + '\\b|' + h.replace(/\$/g, '\\$') + '\\s*[:(])');
          assert.ok(reg.test(js), p + ' 的 WXML handler 未在 JS 定义：' + h);
        });
      });
    });

    await test('VOTE-D5 分享：两页都有 onShareAppMessage / onShareTimeline / share.enable() / require utils/share.js', function () {
      [VOTE_PAGE, DETAIL_PAGE].forEach(function (p) {
        const js = src(p + '.js');
        assert.ok(js.indexOf('onShareAppMessage') >= 0, p + ' 缺少 onShareAppMessage');
        assert.ok(js.indexOf('onShareTimeline') >= 0, p + ' 缺少 onShareTimeline');
        assert.ok(js.indexOf('share.enable()') >= 0, p + ' 缺少 share.enable()');
        assert.ok(js.indexOf('utils/share.js') >= 0, p + ' 未 require utils/share.js');
        assert.ok(js.indexOf('/images/share/default.png') >= 0, p + ' 分享图缺失');
      });
    });

    await test('VOTE-D6 隐私与零外部请求：不出现 wx.cloud / wx.request / http(s) 外链；页面不发多余同步请求', function () {
      const files = [
        VOTE_PAGE + '.js', VOTE_PAGE + '.wxml', VOTE_PAGE + '.wxss', VOTE_PAGE + '.json',
        DETAIL_PAGE + '.js', DETAIL_PAGE + '.wxml', DETAIL_PAGE + '.wxss', DETAIL_PAGE + '.json',
        'utils/vote.js'
      ];
      files.forEach(function (f) {
        const s = src(f);
        assert.strictEqual(s.indexOf('wx.cloud'), -1, f + ' 不得使用 wx.cloud');
        assert.strictEqual(s.indexOf('wx.request'), -1, f + ' 不得直连 wx.request（必须走 utils/cloud.js）');
        assert.strictEqual(/https?:\/\//.test(s), false, f + ' 不得出现外部 URL');
      });
      // 纯逻辑模块不得依赖任何模块 / 平台 API / 定时器
      const v = src('utils/vote.js');
      assert.strictEqual(/\brequire\s*\(/.test(v), false, 'utils/vote.js 不应 require 其它模块');
      assert.strictEqual(/wx\.[a-zA-Z]/.test(v), false, 'utils/vote.js 不应调用 wx.* API');
      assert.strictEqual(/set(Interval|Timeout)\s*\(/.test(v), false, 'utils/vote.js 不应使用定时器');
      // 页面隐私：不渲染学号字段（RPC 也不返回 sid）；匿名投票不渲染 voters
      const detail = src(DETAIL_PAGE + '.wxml');
      assert.ok(detail.indexOf('d.voters.length') >= 0, '详情需渲染实名投票人');
      assert.strictEqual(detail.indexOf('sid'), -1, '详情 WXML 不得出现学号');
      assert.strictEqual(src(VOTE_PAGE + '.wxml').indexOf('sid'), -1, '发起页 WXML 不得出现学号（指定成员只显示姓名）');
      // 配图：chooseMedia → canvas 压缩 → JPEG data URL 链路存在
      const votePage = src(VOTE_PAGE + '.js');
      assert.ok(votePage.indexOf('chooseMedia') >= 0, '缺少 wx.chooseMedia 选图');
      assert.ok(votePage.indexOf('canvasToTempFilePath') >= 0, '缺少 canvas 压缩');
      assert.ok(votePage.indexOf('data:image/jpeg;base64,') >= 0, '缺少 JPEG data URL');
      assert.ok(votePage.indexOf('IMG_MAX_SIDE = 640') >= 0, '配图长边上限 640');
      const voteWxml = src(VOTE_PAGE + '.wxml');
      assert.ok(voteWxml.indexOf('<canvas') >= 0 && voteWxml.indexOf('id="voteCanvas"') >= 0, '缺少隐藏 canvas');
      assert.ok(src('utils/vote.js').indexOf('imgChars: 150000') >= 0, '配图 ≤150000 字符限制');
    });

    await test('VOTE-D7 轮询不泄漏：两页 onHide/onUnload 清定时器、onShow 恢复；详情有 5s/10s 口径', function () {
      [VOTE_PAGE, DETAIL_PAGE].forEach(function (p) {
        const js = src(p + '.js');
        assert.ok(js.indexOf('_stopPoll') >= 0, p + ' 缺少 _stopPoll');
        assert.ok(/onHide\(\)\s*\{[^}]*_stopPoll/.test(js), p + ' onHide 未停止轮询');
        assert.ok(/onUnload\(\)\s*\{[^}]*_stopPoll/.test(js), p + ' onUnload 未停止轮询');
        assert.ok(/clear(Interval|Timeout)\(/.test(js), p + ' 缺少 clearInterval/clearTimeout');
      });
      const detail = src(DETAIL_PAGE + '.js');
      assert.ok(detail.indexOf('vote.pollIntervalOf') >= 0, '详情轮询必须用 pollIntervalOf（5s/10s）');
      assert.ok(detail.indexOf('setTimeout') >= 0);
      assert.ok(detail.indexOf('onShow()') >= 0);
    });

    await test('VOTE-D9 可见范围静态接线：发起页 4 段 + 指定成员名单多选（只显示姓名）+ 纯逻辑/cloud 字段齐备', function () {
      const voteWxml = src(VOTE_PAGE + '.wxml');
      // 4 段范围按钮（data-a 供自动化断言）
      ['all', 'committee', 'league', 'custom'].forEach(function (a) {
        assert.ok(voteWxml.indexOf('data-a="' + a + '"') >= 0, '发起页缺少可见范围段 button[data-a=' + a + ']');
      });
      ['全班', '班委', '团员', '指定成员'].forEach(function (t) {
        assert.ok(voteWxml.indexOf(t) >= 0, '发起页缺少范围文案：' + t);
      });
      // 指定成员：scroll-view 名单多选（chips），只显示姓名 + 座号 data
      assert.ok(voteWxml.indexOf('bindtap="toggleMember"') >= 0, '缺少成员点按 handler');
      assert.ok(voteWxml.indexOf('data-seat="{{item.seat}}"') >= 0, '成员 chips 内部必须用座号');
      assert.ok(voteWxml.indexOf('vote-mem-scroll') >= 0, '成员名单需 scroll-view 承载');
      assert.ok(voteWxml.indexOf('{{item.name}}') >= 0, '成员 chips 只显示姓名');
      assert.ok(voteWxml.indexOf('selectedCount') >= 0, '需显示已选人数');
      // 页面：范围选择 / 名单同步 / 提交带新字段（不出现 sid 展示逻辑）
      const votePage = src(VOTE_PAGE + '.js');
      ['utils/roster.js', 'pickAudience', 'toggleMember', '_syncMembers', 'audSeats', 'audienceSeats'].forEach(function (k) {
        assert.ok(votePage.indexOf(k) >= 0, '投票页缺少范围接线：' + k);
      });
      // 纯逻辑模块导出范围函数
      purge();
      const v = R('utils/vote.js');
      ['normAudience', 'normAudienceSeats', 'normAudienceChoice', 'audienceTag', 'audienceText', 'audienceTagOf'].forEach(function (k) {
        assert.strictEqual(typeof v[k], 'function', 'utils/vote.js 未导出 ' + k);
      });
      assert.deepStrictEqual(v.AUD, ['all', 'committee', 'league', 'custom']);
      // cloud.js：poll_create / poll_manage 透传两个新参数
      const cloudSrc = src('utils/cloud.js');
      assert.ok(cloudSrc.indexOf('p_audience: aud.audience') >= 0, 'poll_create 未带 p_audience');
      assert.ok(cloudSrc.indexOf('p_audience_seats: aud.seats') >= 0, 'poll_create 未带 p_audience_seats');
      assert.ok(cloudSrc.indexOf('body.p_audience = aud.audience') >= 0, 'poll_manage 未透传 p_audience');
      assert.ok(cloudSrc.indexOf('body.p_audience_seats = aud.seats') >= 0, 'poll_manage 未透传 p_audience_seats');
      // 详情页沿用 detailView 的范围标签（d.tags 渲染）
      assert.ok(src(DETAIL_PAGE + '.wxml').indexOf('wx:for="{{d.tags}}"') >= 0, '详情页需渲染范围标签（tags）');
    });

    await test('VOTE-E1 入口可见性：仅班委可见；普通同学/测试账号在目录、首页与使用说明中完全隐藏；详情分享入口不受影响', function () {
      global.wx = C.wxMock;
      purge();
      const identity = R('utils/identity.js');
      const tools = R('utils/tools.js');
      const store = R('utils/store.js');
      const committee = { token: 'tok-vote-c', sid: 'fixture-committee-vote', name: '班委夹具', role: '班长', badge: '班委', is_admin: false, ts: 1 };
      const ordinary = { token: 'tok-vote-o', sid: 'fixture-ordinary-vote', name: '普通同学夹具', role: '', badge: '', is_admin: false, ts: 1 };
      const officialTest = { token: 'tok-vote-t', sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: true, ts: 1 };
      const qaTest = { token: 'tok-vote-q', sid: '9999000001', name: '测试同学', role: '班长', badge: '班委', is_admin: false, ts: 1 };
      // 班委口径 = role 非空 或 badge 含「班委」；测试账号无论职务一律不可见
      assert.strictEqual(identity.canUseVote(committee), true, '班委可见');
      assert.strictEqual(identity.canUseVote({ sid: 'fixture-badge-vote', role: '', badge: '班委' }), true, 'badge=班委 也属班委');
      assert.strictEqual(identity.canUseVote(ordinary), false, '普通同学不可见');
      assert.strictEqual(identity.canUseVote({ sid: 'fixture-empty-vote', role: '', badge: '' }), false);
      assert.strictEqual(identity.canUseVote(officialTest), false, '官方测试账号应隐藏');
      assert.strictEqual(identity.canUseVote(qaTest), false, '9999 段 QA 测试账号应隐藏');
      assert.strictEqual(identity.canUseVote({ sid: 'fixture-flag-vote', role: '班长', badge: '班委', is_test: true }), false, 'is_test 身份应隐藏');
      assert.strictEqual(identity.canUseVote(null), false, '无身份不可见');
      // 入口判定：只影响 vote，其它工具不变
      const vt = tools.toolOf('vote');
      assert.strictEqual(tools.entryAllowed(vt, committee), true);
      assert.strictEqual(tools.entryAllowed(vt, ordinary), false);
      assert.strictEqual(tools.entryAllowed(vt, officialTest), false);
      assert.strictEqual(tools.entryAllowed(tools.toolOf('water'), officialTest), true, '其它工具不因测试账号隐藏');
      // 首页：历史勾选里的 vote 对普通同学/测试账号被过滤，不占首页位；班委保留
      C.clearMem();
      C.setIdentity(committee);
      store.get().homeTools = ['vote', 'hw']; store.save();
      assert.strictEqual(identity.canUseVote(), true, '本机班委身份：入口可见');
      assert.deepStrictEqual(tools.quickList(4).map(function (t) { return t.key; }), ['vote', 'hw'], '班委首页保留投票');
      C.setIdentity(ordinary);
      store.get().homeTools = ['vote', 'hw']; store.save();
      assert.strictEqual(identity.canUseVote(), false, '本机普通身份：入口隐藏');
      assert.deepStrictEqual(tools.quickList(4).map(function (t) { return t.key; }), ['hw'], '普通同学首页隐藏投票');
      C.setIdentity(officialTest);
      assert.strictEqual(identity.canUseVote(), false, '本机测试身份：入口隐藏');
      // 工具页目录：普通/测试账号不渲染投票卡；班委渲染
      C.setIdentity(ordinary);
      const allDef = loadPageDef('pages/all/all');
      const allOrd = ctxOf(allDef);
      allDef.render.call(allOrd);
      assert.strictEqual(allOrd.data.all.some(function (x) { return x.key === 'vote'; }), false, '普通同学工具页无投票入口');
      C.setIdentity(officialTest);
      const allTest = ctxOf(allDef);
      allDef.render.call(allTest);
      assert.strictEqual(allTest.data.all.some(function (x) { return x.key === 'vote'; }), false, '测试账号工具页无投票入口');
      C.setIdentity(committee);
      const allCom = ctxOf(allDef);
      allDef.render.call(allCom);
      assert.strictEqual(allCom.data.all.some(function (x) { return x.key === 'vote'; }), true, '班委工具页保留投票入口');
      // 使用说明：无入口的同学不展示投票说明卡
      C.setIdentity(ordinary);
      const ugDef = loadPageDef('pages/ug/ug');
      const ugOrd = ctxOf(ugDef);
      ugDef.onLoad.call(ugOrd, {});
      assert.strictEqual((ugOrd.data.cards || []).some(function (c) { return c.id === 'vote'; }), false, '普通同学使用说明无投票卡');
      C.setIdentity(committee);
      const ugCom = ctxOf(ugDef);
      ugDef.onLoad.call(ugCom, {});
      assert.strictEqual((ugCom.data.cards || []).some(function (c) { return c.id === 'vote'; }), true, '班委使用说明保留投票卡');
      // 详情页不设入口门禁：分享卡片/收到投票时普通同学仍可正常进入
      const detailJs = src(DETAIL_PAGE + '.js');
      assert.strictEqual(detailJs.indexOf('canUseVote'), -1, '投票详情页不得按身份拦截（分享卡片必须可进入）');
      assert.ok(detailJs.indexOf("path: '/pages/votedetail/votedetail'") >= 0, '分享卡片仍指向详情页');
      C.clearMem();
      C.setIdentity(ID);
    });

    await test('VOTE-D8 单测自身已挂入 unit.js require 链', function () {
      const unitSrc = fs.readFileSync(path.join(__dirname, 'unit.js'), 'utf8');
      assert.ok(unitSrc.indexOf('vote_unit_tests.js') >= 0, 'unit.js 未挂入 vote_unit_tests.js');
    });
  } finally {
    global.wx = prevWx;
    if (prevGetPages === undefined) { try { delete global.getCurrentPages; } catch (e) { /* ignore */ } }
    else global.getCurrentPages = prevGetPages;
  }
}

module.exports = { run: run };

if (require.main === module) {
  const C = createCtx();
  global.wx = C.wxMock;
  const results = [];
  let passN = 0, failN = 0;
  const test = async function (name, fn) {
    try { await fn(); passN += 1; results.push({ name: name, ok: true }); console.log('PASS  ' + name); }
    catch (e) { failN += 1; results.push({ name: name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
  };
  run(test).then(function () {
    const summary = { total: passN + failN, pass: passN, fail: failN, results: results, at: new Date().toISOString() };
    fs.writeFileSync(path.join(__dirname, 'vote_unit_result.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log('\n================ vote: ' + passN + ' passed, ' + failN + ' failed ================');
    process.exit(failN ? 2 : 0);
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}
