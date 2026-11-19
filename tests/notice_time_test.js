/* notice_time_test.js —— 通知时间显示口径（契约 2026-11-05《通知时间显示与识别_契约》§2 / §3）单测
 *
 * 被测：
 *   utils/notice.js    fmtWhen / statusOf（「<时间> <动作>」+ 报名优先）/ whenInfo·whenOf /
 *                      absRelDates / anchorOf / parseMsgTime / statOf / mostUrgent
 *   pages/nt/nt.js     aiSummary / aiPoints / aiSegments / 原文 quotes / 合并转发 / 原始消息弹层过 absRelDates；
 *                      简报「最近截止」与状态 chip 同口径
 *   pages/nt/nt.wxml   状态 chip 渲染 statusLabel；长期安排不在 chip 外重复一枚 badge
 *
 * 基准（契约 §7）：now = 2026-11-05 23:00（周四），锚点示例 = 消息发送时刻「11-05 20:47」。
 *
 * 运行：
 *   node notice_time_test.js     # 独立运行（结果写 notice_time_result.json）
 *   node unit.js                 # unit.js 末尾把本文件并入总表
 *
 * 依赖：仅 Node 内置模块 + 本目录既有 wx mock 约定（不访问真实云端、不发订阅消息）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');
const H = 3600 * 1000;
const D = 24 * H;
const NOW = new Date(2026, 10, 5, 23, 0, 0, 0).getTime();   // 2026-11-05 23:00 周四

function at(y, mo, d, hh, mi) { return new Date(y, mo - 1, d, hh || 0, mi || 0, 0, 0).getTime(); }
function iso(y, mo, d, hh, mi) { return new Date(y, mo - 1, d, hh || 0, mi || 0, 0, 0).toISOString(); }
function noticeMod() { return require(path.join(ROOT, 'utils/notice.js')); }
function src(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/* ---------- nt 页加载（openRaw 功能断言用；独立运行时补一个最小 wx mock） ---------- */
function purgeNtPage() {
  Object.keys(require.cache).forEach(function (k) {
    if (k.replace(/\\/g, '/').indexOf(ROOT + '/pages/nt/') === 0) delete require.cache[k];
  });
}
function loadNtPage() {
  const hadWx = Object.prototype.hasOwnProperty.call(global, 'wx');
  const prevWx = global.wx;
  if (!hadWx || !global.wx) {
    const mem = Object.create(null);
    global.wx = {
      getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
      setStorageSync(k, v) { mem[k] = v; },
      removeStorageSync(k) { delete mem[k]; },
      getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 0, limitSize: 10240 }; },
      request(o) { if (o && o.success) o.success({ statusCode: 200, data: [] }); },
      showToast() {}, showModal() {}, showLoading() {}, hideLoading() {},
      setClipboardData(o) { if (o && o.success) o.success(); },
      getSystemInfoSync() { return { windowWidth: 375, windowHeight: 667, platform: 'devtools' }; },
      createSelectorQuery() {
        return { select() { return this; }, boundingClientRect() { return this; }, selectViewport() { return this; }, scrollOffset() { return this; }, exec(cb) { if (cb) cb([]); } };
      },
      nextTick(fn) { fn(); }, pageScrollTo() {}, stopPullDownRefresh() {}
    };
  }
  const hadPage = Object.prototype.hasOwnProperty.call(global, 'Page');
  const prevPage = global.Page;
  let def = null;
  global.Page = function (d) { def = d; };
  purgeNtPage();
  try {
    require(path.join(ROOT, 'pages/nt/nt.js'));
  } finally {
    if (hadPage) global.Page = prevPage; else delete global.Page;
    purgeNtPage();
    if (!hadWx) delete global.wx;
    else global.wx = prevWx;
  }
  return def;
}

async function run(test) {

  /* ============================================================
     契约 §2.1：fmtWhen 时间部分（临近相对化 / ≥7 天绝对 / 已过绝对）
     ============================================================ */
  await test('契约§2.1 fmtWhen：分钟后 / 小时后 / 天后 / ≥7 天与已过用绝对 MM-DD HH:MM', function () {
    const n = noticeMod();
    assert.strictEqual(n.fmtWhen(NOW - 60000, NOW), '11-05 22:59', '已过 → 绝对');
    assert.strictEqual(n.fmtWhen(NOW - 3 * D, NOW), '11-02 23:00', '过期多日 → 绝对');
    assert.strictEqual(n.fmtWhen(NOW + 1000, NOW), '1 分钟后', '剩余 <1 分钟 → 最小 1 分钟');
    assert.strictEqual(n.fmtWhen(NOW + 30 * 60000, NOW), '30 分钟后');
    assert.strictEqual(n.fmtWhen(NOW + 59 * 60000 + 59000, NOW), '60 分钟后', 'ceil 到 60 分钟（仍未满 1h）');
    assert.strictEqual(n.fmtWhen(NOW + H, NOW), '1 小时后');
    assert.strictEqual(n.fmtWhen(NOW + 13 * H, NOW), '13 小时后', '明天 12:00 = 13 小时后');
    assert.strictEqual(n.fmtWhen(NOW + 23 * H + 59 * 60000, NOW), '24 小时后', 'ceil 到 24 小时（仍未满 1 天）');
    assert.strictEqual(n.fmtWhen(NOW + 24 * H, NOW), '1 天后');
    assert.strictEqual(n.fmtWhen(NOW + 3 * D, NOW), '3 天后');
    assert.strictEqual(n.fmtWhen(NOW + 7 * D - 1, NOW), '7 天后', '6.99 天 → ceil 7 天');
    assert.strictEqual(n.fmtWhen(NOW + 7 * D, NOW), '11-12 23:00', '≥7 天 → 绝对');
    assert.strictEqual(n.fmtWhen(iso(2026, 12, 20, 9, 30), NOW), '12-20 09:30');
    assert.strictEqual(n.fmtWhen(null, NOW), '');
    assert.strictEqual(n.fmtWhen('bad', NOW), '');
  });

  /* ============================================================
     契约 §2.2：statusOf 统一「<时间> <动作>」+ 旧 bug（明天 12:00 显示「今天 12:00」）修复
     ============================================================ */
  await test('契约§2.2：明天 12:00 显示「13 小时后 截止」，绝不出现「今天 HH:MM」', function () {
    const n = noticeMod();
    const g = { id: 'g_tomorrow', deadline: iso(2026, 11, 6, 12, 0) };
    const st = n.statusOf(g, NOW);
    assert.strictEqual(st.label, '13 小时后 截止');
    assert.ok(st.label.indexOf('今天') < 0, '不得再出现「今天」混排：' + st.label);
    assert.ok(/^(N 分钟后|N 小时后|N 天后|MM-DD HH:MM)/.test(st.label.replace(/^\d+ /, 'N ')), '格式应为「时间 动作」');
    assert.strictEqual(st.key, 'today', 'key 保持不变（<24h = today）');
    assert.strictEqual(st.cls, 'urgent');
    assert.strictEqual(st.expired, false);
    // A2：申报材料 11-06 12:00 报送姓名截止（§0.2 精简后显示「报送截止」）
    const g2 = { id: 'g_report', deadline: iso(2026, 11, 6, 12, 0), deadlineAction: '报送姓名截止' };
    assert.strictEqual(n.statusOf(g2, NOW).label, '13 小时后 报送截止');
    // 绝对日期分支（≥7 天）
    assert.strictEqual(n.statusOf({ deadline: iso(2026, 11, 13, 23, 0) }, NOW).label, '11-13 23:00 截止');
  });

  await test('契约§2.2：紧迫度分桶（key / cls / expired 保持不变）', function () {
    const n = noticeMod();
    const cases = [
      // [deadline, key, cls, label]
      [iso(2026, 11, 5, 23, 30), 'urgent', 'urgent', '30 分钟后 截止'],
      [iso(2026, 11, 6, 0, 0), 'today', 'urgent', '1 小时后 截止'],
      [iso(2026, 11, 6, 1, 0), 'today', 'urgent', '2 小时后 截止'],
      [iso(2026, 11, 6, 22, 0), 'today', 'urgent', '23 小时后 截止'],
      [iso(2026, 11, 6, 23, 0), 'soon', 'active', '1 天后 截止'],
      [iso(2026, 11, 8, 23, 0), 'active', 'active', '3 天后 截止'],
      [iso(2026, 11, 7, 18, 0), 'soon', 'active', '2 天后 截止']
    ];
    cases.forEach(function (c) {
      const st = n.statusOf({ deadline: c[0] }, NOW);
      assert.strictEqual(st.key, c[1], 'key：' + c[0]);
      assert.strictEqual(st.cls, c[2], 'cls：' + c[0]);
      assert.strictEqual(st.label, c[3], 'label：' + c[0]);
      assert.strictEqual(st.expired, false);
    });
    const past = n.statusOf({ deadline: iso(2026, 11, 4, 12, 0) }, NOW);
    assert.strictEqual(past.key, 'expired');
    assert.strictEqual(past.cls, 'expired');
    assert.strictEqual(past.expired, true);
    assert.strictEqual(past.label, '11-04 12:00 截止', '已过期也是「时间 动作」，不再用「已截止 · 自动完成」');
  });

  /* ============================================================
     契约 §2.2 3：活动报名优先（signupStart / signupEnd）
     ============================================================ */
  await test('契约§0.2：chip 动作精简（映射 + 报名已截止→报名截止 + ≤6 字）', function () {
    const n = noticeMod();
    const map = [
      ['报送姓名截止', '报送截止'],
      ['集合点名', '点名'],
      ['活动开始', '开始'],
      ['签到开始', '签到'],
      ['签到签退', '签到'],
      ['比赛开始', '比赛'],
      ['考试开始', '考试'],
      ['报名已截止', '报名截止'],
      ['报名截止', '报名截止'],
      ['', ''],
      ['这是一个很长的动作名字', '这是一个很长']
    ];
    map.forEach(function (c) {
      const got = n.conciseAction(c[0]);
      assert.strictEqual(got, c[1], 'conciseAction(' + c[0] + ')');
      assert.ok(got.length <= 6, '动作必须 ≤6 字：' + got);
    });
    // 显示层直接生效：deadlineAction/eventAction 都过精简
    assert.strictEqual(n.statusOf({ deadline: iso(2026, 11, 6, 12, 0), deadlineAction: '报送姓名截止' }, NOW).label, '13 小时后 报送截止');
    assert.strictEqual(n.statusOf({ eventAt: iso(2026, 11, 6, 8, 0), eventAction: '集合点名' }, NOW).label, '9 小时后 点名');
    assert.strictEqual(n.statusOf({ eventAt: iso(2026, 11, 7, 9, 0), eventAction: '签到签退' }, NOW).label, '2 天后 签到');
    assert.strictEqual(n.statusOf({ eventAt: iso(2026, 11, 7, 9, 0), eventAction: '比赛开始' }, NOW).label, '2 天后 比赛');
    // 报名已过：仍 expired（红色/已过期样式），但文案不含「已」
    const expiredSignup = n.statusOf({ signupStart: iso(2026, 11, 1, 10, 0), signupEnd: iso(2026, 11, 3, 10, 0) }, NOW);
    assert.strictEqual(expiredSignup.key, 'expired');
    assert.strictEqual(expiredSignup.label, '11-03 10:00 报名截止');
    assert.ok(expiredSignup.label.indexOf('已截止') < 0, '不得出现「报名已截止」');
    // 所有 chip label 的动作部分 ≤6 字
    [
      n.statusOf({ deadline: iso(2026, 11, 6, 12, 0), deadlineAction: '报送姓名截止' }, NOW),
      n.statusOf({ eventAt: iso(2026, 11, 6, 8, 0), eventAction: '集合点名' }, NOW),
      n.statusOf({ signupEnd: iso(2026, 11, 10, 18, 0) }, NOW)
    ].forEach(function (st) {
      const action = st.label.slice(st.label.lastIndexOf(' ') + 1);
      assert.ok(action.length <= 6, 'chip 动作超长：' + st.label);
    });
  });

  await test('契约§2.2：报名优先（开始前→报名开始 / 窗口内→报名截止 / 已过→报名截止·§0.2 不加已）', function () {
    const n = noticeMod();
    const g = {
      id: 'g_signup', cat: '活动',
      signupStart: iso(2026, 11, 6, 10, 0),
      signupEnd: iso(2026, 11, 10, 18, 0),
      deadline: iso(2026, 11, 12, 18, 0), deadlineAction: '提交截止',
      eventAt: iso(2026, 11, 14, 9, 0), eventAction: '活动开始'
    };
    // 开始前：以 signupStart 为准
    const before = n.statusOf(g, NOW);
    assert.strictEqual(before.label, '11 小时后 报名开始', '未开始 → 报名开始');
    assert.strictEqual(before.expired, false);
    // 窗口内：以 signupEnd 为准（不显示活动/截止时间）
    const mid = n.statusOf(g, at(2026, 11, 7, 12, 0));
    assert.strictEqual(mid.label, '4 天后 报名截止', '窗口内 → 报名截止（不是活动开始/提交截止）');
    assert.strictEqual(mid.expired, false);
    // 已过 signupEnd：报名已截止 → 过期
    const after = n.statusOf(g, at(2026, 11, 11, 9, 0));
    assert.strictEqual(after.label, '11-10 18:00 报名截止');
    assert.strictEqual(after.key, 'expired');
    assert.strictEqual(after.expired, true);
    // 旧数据（无 signup 字段）→ 仍按 deadline，不出现「报名」字样
    const old = n.statusOf({ deadline: iso(2026, 11, 6, 12, 0) }, NOW);
    assert.strictEqual(old.label, '13 小时后 截止');
    assert.ok(old.label.indexOf('报名') < 0);
    // 只有 signupEnd（契约要求至少要有这个）也报名优先
    const onlyEnd = n.statusOf({ signupEnd: iso(2026, 11, 10, 18, 0) }, NOW);
    assert.strictEqual(onlyEnd.label, '5 天后 报名截止');
    // 只有 signupStart 没有 signupEnd（数据不完整）的兜底：
    //   未开始 → 报名开始；已开始 → 退回 deadline / eventAt / 无时间（不做「报名已截止」误判）
    assert.strictEqual(n.statusOf({ signupStart: iso(2026, 11, 6, 10, 0) }, NOW).label, '11 小时后 报名开始');
    assert.deepStrictEqual(n.statusOf({ signupStart: iso(2026, 11, 4, 10, 0) }, NOW),
      { key: 'none', label: '无时间', cls: 'none', expired: false });
    assert.strictEqual(n.statusOf({ signupStart: iso(2026, 11, 4, 10, 0), eventAt: iso(2026, 11, 7, 9, 0) }, NOW).label, '2 天后 开始');
    // 只有 signupStart 且已开始 + deadline → 退回 deadline（不误判报名截止）
    const partial = n.statusOf({ signupStart: iso(2026, 11, 4, 10, 0), deadline: iso(2026, 11, 7, 18, 0) }, NOW);
    assert.strictEqual(partial.label, '2 天后 截止');
    assert.strictEqual(partial.key, 'soon');
    // whenOf / whenInfo 与 chip 同口径（排序用）
    assert.strictEqual(n.whenOf(g, NOW), at(2026, 11, 6, 10, 0), '主显示时间 = signupStart');
    assert.strictEqual(n.whenOf(g, at(2026, 11, 7, 12, 0)), at(2026, 11, 10, 18, 0), '窗口内 = signupEnd');
    assert.deepStrictEqual(n.whenInfo({ deadline: iso(2026, 11, 6, 12, 0), deadlineAction: '报送姓名截止' }, NOW),
      { ts: at(2026, 11, 6, 12, 0), action: '报送截止' });
  });

  /* ============================================================
     契约 §2.2 4/5：延期（extensions）与活动时间、优先级
     ============================================================ */
  await test('契约§2.2：延期取最后一条 deadline（key 保持 extended / extended_past）', function () {
    const n = noticeMod();
    const ahead = {
      deadline: iso(2026, 11, 4, 12, 0),
      extensions: [{ deadline: iso(2026, 11, 6, 12, 0) }, { deadline: iso(2026, 11, 8, 12, 0) }]
    };
    const st = n.statusOf(ahead, NOW);
    assert.strictEqual(st.key, 'extended', '延期未截止 key 不变');
    assert.strictEqual(st.cls, 'extended');
    assert.strictEqual(st.label, '3 天后 截止', '取最后一条延期并按「时间 动作」显示（不再「已延长 · …」）');
    const past = { deadline: iso(2026, 11, 1, 12, 0), extensions: [{ deadline: iso(2026, 11, 4, 12, 0) }] };
    const sp = n.statusOf(past, NOW);
    assert.strictEqual(sp.key, 'extended_past');
    assert.strictEqual(sp.expired, true);
    assert.strictEqual(sp.label, '11-04 12:00 截止');
  });

  await test('契约§2.2：deadline 优先于 eventAt；只有 eventAt 时用 eventAction', function () {
    const n = noticeMod();
    const both = {
      deadline: iso(2026, 11, 6, 12, 0), deadlineAction: '提交截止',
      eventAt: iso(2026, 11, 7, 9, 0), eventAction: '集合点名'
    };
    assert.strictEqual(n.statusOf(both, NOW).label, '13 小时后 提交截止', '有 deadline 时以 deadline 为主');
    const ev = n.statusOf({ eventAt: iso(2026, 11, 6, 8, 0), eventAction: '集合点名' }, NOW);
    assert.strictEqual(ev.label, '9 小时后 点名');
    assert.strictEqual(ev.key, 'active', '只有活动时间的 key 保持旧口径 active（不按紧迫度改 key）');
    assert.strictEqual(ev.expired, false);
    const evPast = n.statusOf({ eventAt: iso(2026, 11, 5, 8, 0) }, NOW);
    assert.strictEqual(evPast.key, 'expired');
    assert.strictEqual(evPast.label, '11-05 08:00 开始', '已结束也是「时间 动作」');
    // archiveAt（expireAt）之后才算结束：eventAt 已过但未归档 → 仍 active，时间用绝对（fmtWhen 已过分支）
    const archived = n.statusOf({ eventAt: iso(2026, 11, 5, 8, 0), expireAt: iso(2026, 11, 6, 8, 0) }, NOW);
    assert.strictEqual(archived.expired, false);
    assert.strictEqual(archived.label, '11-05 08:00 开始');
    assert.strictEqual(archived.cls, 'active');
    // 既无截止也无活动 → 无时间
    assert.deepStrictEqual(n.statusOf({}, NOW), { key: 'none', label: '无时间', cls: 'none', expired: false });
  });

  await test('契约§2.2：长期安排 = 「长期安排 · label」（label 缺 → 长期安排），不判过期', function () {
    const n = noticeMod();
    const g = {
      id: 'g_rec', actionable: false, deadline: iso(2020, 1, 1, 0, 0),
      recurrence: { freq: 'monthly_weeks', weekday: 3, weeks: [1, 2, 3], time: '17:30', startAt: '2026-11-04T17:30:00+08:00', label: '每月前三周 周三 17:30' }
    };
    const st = n.statusOf(g, NOW);
    assert.strictEqual(st.key, 'recurring');
    assert.strictEqual(st.cls, 'recurring');
    assert.strictEqual(st.expired, false, '有已过 deadline 也不判过期');
    assert.strictEqual(st.label, '长期安排 · 每月前三周 周三 17:30');
    const noLabel = { recurrence: { freq: 'weekly', weekday: 3, time: '17:30' } };
    assert.strictEqual(n.statusOf(noLabel, NOW).label, '长期安排');
    // alert 保持用户熟悉的例外文案
    const alert = { deadline: iso(2026, 11, 4, 12, 0), alert: true };
    assert.strictEqual(n.statusOf(alert, NOW).label, '已截止 · 有新名单');
    assert.strictEqual(n.statusOf(alert, NOW).key, 'alert');
    assert.strictEqual(n.statusOf(alert, NOW).expired, false);
  });

  /* ============================================================
     契约 §2.2 注：排序 / 简报刊数跟主显示时间（报名优先）一致
     ============================================================ */
  await test('契约§2.2：statOf / mostUrgent 按主显示时间（报名优先）统计与排序', function () {
    const n = noticeMod();
    const a = { id: 'a', signupEnd: iso(2026, 11, 6, 0, 0) };                       // 1 小时后报名截止
    const b = { id: 'b', deadline: iso(2026, 11, 6, 3, 0) };                        // 4 小时后截止
    const c = { id: 'c', signupStart: iso(2026, 11, 1, 10, 0), signupEnd: iso(2026, 11, 3, 10, 0) }; // 报名已截止 → 过期
    // 固定 now：statOf/mostUrgent 内部用 Date.now()，这里用真实 now 构造成相对时间
    const realNow = Date.now();
    const mk = function (ms) { return new Date(realNow + ms).toISOString(); };
    const live = [
      { id: 'signup', signupEnd: mk(1 * H) },      // 主显示 1 小时后报名截止
      { id: 'deadline', deadline: mk(4 * H) },     // 4 小时后截止
      { id: 'closed', signupStart: mk(-3 * D), signupEnd: mk(-2 * D) }
    ];
    const stats = n.statOf(live, {});
    assert.strictEqual(stats.pending, 2, '报名已截止的不算待处理');
    assert.strictEqual(stats.expired, 1);
    assert.strictEqual(stats.urgent, 2);
    assert.strictEqual(stats.week, 2);
    assert.strictEqual(n.mostUrgent(live, {}).id, 'signup', '最紧急按主显示时间（报名优先）');
    // 显式 now 的 statusOf 断言（不依赖真实时钟）
    assert.strictEqual(n.statusOf(a, NOW).label, '1 小时后 报名截止');
    assert.strictEqual(n.statusOf(b, NOW).label, '4 小时后 截止');
    assert.strictEqual(n.statusOf(c, NOW).expired, true);
  });

  /* ============================================================
     契约 §3：相对日期替换 absRelDates（锚点 = 第一条 item 的 time）
     ============================================================ */
  await test('契约§3 absRelDates：今天/明天/今晚/明早/后天/大后天 + 保留时间词', function () {
    const n = noticeMod();
    const A = '11-05 20:47';                 // 周四晚
    assert.strictEqual(n.absRelDates('明天 12:00 截止', A), '11-06 12:00 截止');
    assert.strictEqual(n.absRelDates('明天12:00 前报送', A), '11-06 12:00 前报送', '无空格原文也要可读');
    assert.strictEqual(n.absRelDates('明天中午前交', A), '11-06 中午前交', '保留时间词（明天中午前 → NN-NN 中午前）');
    assert.strictEqual(n.absRelDates('今晚 24 点截止', A), '11-05 晚 24 点截止');
    assert.strictEqual(n.absRelDates('明早8点集合', A), '11-06 早 8点集合');
    assert.strictEqual(n.absRelDates('明晚点名', A), '11-06 晚点名');
    assert.strictEqual(n.absRelDates('后天交材料', A), '11-07 交材料');
    assert.strictEqual(n.absRelDates('大后天交材料', A), '11-08 交材料');
    assert.strictEqual(n.absRelDates('今天下午开会', A), '11-05 下午开会');
    assert.strictEqual(n.absRelDates('明日复明日', A), '11-06 复11-06');
  });

  await test('契约§3 absRelDates：本周X / 下周X / 裸周X（周一为一周起点）', function () {
    const n = noticeMod();
    const A = '11-05 20:47';                 // 2026-11-05 周四
    assert.strictEqual(n.absRelDates('本周日 17:00 开会', A), '11-08 17:00 开会');
    assert.strictEqual(n.absRelDates('这周日交', A), '11-08 交');
    assert.strictEqual(n.absRelDates('本周三已过', A), '11-04 已过', '本周X 可能是已经过去的日子');
    assert.strictEqual(n.absRelDates('下周一 8:00 升旗', A), '11-09 8:00 升旗');
    assert.strictEqual(n.absRelDates('下星期三交表', A), '11-11 交表');
    assert.strictEqual(n.absRelDates('下星期日', A), '11-15');
    assert.strictEqual(n.absRelDates('周日晚点名', A), '11-08 晚点名', '裸「周日」= 最近一个未来的周日，保留「晚点名」');
    assert.strictEqual(n.absRelDates('周六补课', A), '11-07 补课');
    assert.strictEqual(n.absRelDates('周三前提交', A), '11-11 前提交', '本周三已过 → 下一个周三');
    assert.strictEqual(n.absRelDates('周四开会', A), '11-05 开会', '今天同星期 → 今天');
    assert.strictEqual(n.absRelDates('星期一上午', A), '11-09 上午');
    assert.strictEqual(n.absRelDates('礼拜天休息', A), '11-08 休息');
    // 周日锚点：本周一 = 11-02（周一为一周起点）
    const SUN = '11-08 09:00';
    assert.strictEqual(n.absRelDates('本周一', SUN), '11-02');
    assert.strictEqual(n.absRelDates('本周日', SUN), '11-08');
    assert.strictEqual(n.absRelDates('下周一', SUN), '11-09');
    assert.strictEqual(n.absRelDates('周一', SUN), '11-09', '周日当天说「周一」= 明天');
    assert.strictEqual(n.absRelDates('周日', SUN), '11-08', '今天同星期 → 今天');
  });

  await test('契约§3 absRelDates：绝对日期/非相对语义不动；无锚点或坏锚点原样返回', function () {
    const n = noticeMod();
    const A = '11-05 20:47';
    assert.strictEqual(n.absRelDates('11月6日 12:00 前提交', A), '11月6日 12:00 前提交', '已有绝对日期不动');
    assert.strictEqual(n.absRelDates('2026-11-06 12:00 截止', A), '2026-11-06 12:00 截止');
    assert.strictEqual(n.absRelDates('上周五已经发过', A), '上周五已经发过', '上周X 不属本轮规则 → 原样');
    assert.strictEqual(n.absRelDates('每周三 17:30 检查', A), '每周三 17:30 检查', '每周X 不替换');
    assert.strictEqual(n.absRelDates('隔周五值日', A), '隔周五值日');
    assert.strictEqual(n.absRelDates('下下周一', A), '下下周一', '下下周X 不在规则内 → 原样（不得输出畸形「下11-09」）');
    assert.strictEqual(n.absRelDates('', A), '');
    assert.strictEqual(n.absRelDates(null, A), '');
    assert.strictEqual(n.absRelDates('明天 12:00', null), '明天 12:00', '无锚点 → 原样');
    assert.strictEqual(n.absRelDates('明天 12:00', 'not-a-time'), '明天 12:00', '坏锚点 → 原样');
    // 锚点也接受时间戳 / Date
    assert.strictEqual(n.absRelDates('明天', at(2026, 11, 5, 10, 30)), '11-06');
    assert.strictEqual(n.absRelDates('明天', new Date(2026, 10, 5, 10, 30)), '11-06');
    // 跨年：锚点 12-31 无年份，按离 now 最近推断年份
    const jan1 = at(2027, 1, 1, 10, 0);
    assert.strictEqual(n.parseMsgTime('12-31 20:00', jan1), at(2026, 12, 31, 20, 0));
    assert.strictEqual(n.absRelDates('明天 老师检查', '12-31 20:00', jan1), '01-01 老师检查');
    // 锚点解析：MM-DD HH:MM / ISO / 时间戳
    assert.strictEqual(n.parseMsgTime('11-05 20:47', NOW), at(2026, 11, 5, 20, 47));
    assert.strictEqual(n.parseMsgTime('2026-11-05T20:47:00+08:00', NOW), at(2026, 11, 5, 20, 47));
    assert.strictEqual(n.parseMsgTime(at(2026, 11, 5, 20, 47), NOW), at(2026, 11, 5, 20, 47));
    assert.strictEqual(n.parseMsgTime('', NOW), null);
  });

  await test('契约§0.1 absRelDates：裸日号 N号/N日（仅语境替换；序号不替换）', function () {
    const n = noticeMod();
    const A = '11-05 10:00';                 // 锚点 11-05
    assert.strictEqual(n.absRelDates('5号上午9点比赛', A), '11-05 上午9点比赛');
    assert.strictEqual(n.absRelDates('4号下午交材料', A), '11-04 下午交材料');
    assert.strictEqual(n.absRelDates('10号比赛', A), '11-10 比赛');
    assert.strictEqual(n.absRelDates('5号 上午集合', A), '11-05 上午集合');
    assert.strictEqual(n.absRelDates('5号当天报到', A), '11-05 当天报到');
    assert.strictEqual(n.absRelDates('42号同学负责搬水', A), '42号同学负责搬水', '序号不得替换');
    assert.strictEqual(n.absRelDates('5号楼集合', A), '5号楼集合');
    assert.strictEqual(n.absRelDates('学号42号同学', A), '学号42号同学');
    assert.strictEqual(n.absRelDates('11月6日 12:00', A), '11月6日 12:00', '绝对日期不动');
  });

  await test('契约§0.1 absRelDates：裸时段 → 前缀锚点日期；周期词/已有日期保留（标题也生效）', function () {
    const n = noticeMod();
    const A = '11-05 10:00';
    assert.strictEqual(n.absRelDates('下午招聘会请准时到场', A), '11-05 下午招聘会请准时到场', '标题也要日期化');
    assert.strictEqual(n.absRelDates('上午9:00 集合', A), '11-05 上午9:00 集合');
    assert.strictEqual(n.absRelDates('晚上点名', A), '11-05 晚上点名');
    assert.strictEqual(n.absRelDates('凌晨三点', A), '11-05 凌晨三点');
    assert.strictEqual(n.absRelDates('运动会观众明早8:50到看台集合', A), '运动会观众11-06 早 8:50到看台集合');
    assert.strictEqual(n.absRelDates('每天下午 5 点打卡', A), '每天下午 5 点打卡', '每天 → 保留');
    assert.strictEqual(n.absRelDates('每周上午检查', A), '每周上午检查');
    assert.strictEqual(n.absRelDates('长期安排：下午 17:30', A), '长期安排：下午 17:30');
    assert.strictEqual(n.absRelDates('11-05 下午开会', A), '11-05 下午开会', '已有日期不重复加');
    assert.strictEqual(n.absRelDates('11月5日下午开会', A), '11月5日下午开会');
    assert.strictEqual(n.absRelDates('下午招聘会请准时到场', '11-04 09:00'), '11-04 下午招聘会请准时到场', '用该条消息锚点');
  });

  await test('契约§0.1 absRelDates：「今日校园」不替换；绝对日期+括号相对词去重', function () {
    const n = noticeMod();
    const A = '11-05 10:00';
    assert.strictEqual(n.absRelDates('今日校园打卡', A), '今日校园打卡', 'App 专有名词不得替换');
    assert.strictEqual(n.absRelDates('今日校园 App 提交', A), '今日校园 App 提交');
    assert.strictEqual(n.absRelDates('11月6日（周五）前提交', A), '11月6日前提交');
    assert.strictEqual(n.absRelDates('11月14日（下周六）报名', A), '11月14日报名');
    assert.strictEqual(n.absRelDates('11月3日（上周五）已发', A), '11月3日已发');
    assert.strictEqual(n.absRelDates('11-03（10-30）', A), '11-03', '矛盾括号去重（绝对日期为准）');
    // 相对词+括号相对词同一天 → 合并为一个日期（11-04 周三 20:00 锚点：「本周四（明天）」= 11-05）
    assert.strictEqual(n.absRelDates('本周四（明天）上午', '11-04 20:00'), '11-05 上午');
  });

  await test('契约§3 anchorOf：整卡锚点 = 第一条带 time 的 item（格式 MM-DD HH:MM）', function () {
    const n = noticeMod();
    const g = {
      id: 'g_anchor',
      items: [
        { kind: 'file', name: '附件.pdf', time: '' },
        { kind: 'text', text: '明天 12:00 前交电子版', time: '11-05 20:47' },
        { kind: 'follow', text: '周日晚点名交纸质版', time: '11-05 21:07' }
      ]
    };
    assert.strictEqual(n.anchorOf(g, NOW), at(2026, 11, 5, 20, 47));
    assert.strictEqual(n.anchorOf({ items: [] }, NOW), null);
    assert.strictEqual(n.anchorOf({}, NOW), null);
    // 整卡一致：两条 item 文本都用同一个锚点（20:47），与 follow 自己的 21:07 无关
    const A = n.anchorOf(g, NOW);
    assert.strictEqual(n.absRelDates('明天', A), '11-06');
    assert.strictEqual(n.absRelDates('周日', A), '11-08');
  });

  /* ============================================================
     页面渲染层：pages/nt 调用 absRelDates / 简报同口径
     ============================================================ */
  await test('pages/nt：aiSummary/aiPoints/aiSegments/quotes/合并转发/原始消息/标题都过 absRelDates（静态）', function () {
    const ntJs = src('pages/nt/nt.js');
    assert.ok(/function mapGroup\(rawG, nowTs\)[\s\S]{0,900}notice\.anchorOf\(g\)/.test(ntJs), 'mapGroup 应取整卡锚点');
    assert.ok(/summary:\s*abs\(g\.aiSummary/.test(ntJs), 'aiSummary 应过 absRelDates');
    assert.ok(/points:\s*\(g\.aiPoints \|\| \[\]\)\.slice\(0, 3\)\.map\(abs\)/.test(ntJs), 'aiPoints 应过 absRelDates');
    assert.ok(/segs:\s*compactSegs\(g\.aiSegments\)\.map\(function \(sg\) \{ return \{ type: sg\.type, cls: sg\.cls, text: abs\(sg\.text\) \}; \}\)/.test(ntJs), 'aiSegments 应过 absRelDates');
    assert.ok(/text:\s*abs\(shown\)/.test(ntJs), '原文 quotes 应过 absRelDates');
    assert.ok(/text:\s*abs\(splitText\(m\.text\)\.join\('\\n'\)\)/.test(ntJs), '合并转发 messages 应过 absRelDates');
    // 契约 §0.1：标题也要日期化（旧卡「运动会观众明早8:50…」「下午招聘会请准时到场」）
    assert.ok(/title:\s*abs\(g\.title \|\| '班级通知'\)/.test(ntJs), '卡片标题应过 absRelDates');
    // 契约 2026-11-14 §2.4/§3：简报（最近待处理）标题同样先 absRelDates 再统一 M月D日（相对周）
    assert.ok(/title:\s*card \? card\.title : notice\.fmtDisplayDates\(go\.title \|\| '班级通知'/.test(ntJs), '简报标题应过日期化');
    const raw = ntJs.slice(ntJs.indexOf('openRaw(e)'), ntJs.indexOf('closeRaw()'));
    assert.ok(/notice\.anchorOf\(g\)/.test(raw) && /notice\.fmtDisplayDates\(splitText\(it\.text\)/.test(raw), '「原始消息」弹层应过日期化');
    assert.ok(/rawTitle:\s*notice\.fmtDisplayDates\(g\.title \|\| '原始消息', anchor, now\)/.test(raw), '「原始消息」弹层标题也应日期化');
    // 简报「最近截止」与状态 chip 同口径：直接用 statusOf().label，不再拼旧「MM-DD HH:MM 截止」
    assert.ok(/notice\.whenOf\(/.test(ntJs), '排序应跟主显示时间（报名优先）');
    // 契约 2026-11-14 §2.4：简报（_briefNextOf）与 statOf 同口径；meta 复用 statusOf().label 并统一日期格式
    const brief = ntJs.slice(ntJs.indexOf('_briefNextOf(nowArg)'), ntJs.indexOf('// ============================================================ 管理员编辑'));
    assert.ok(/meta: notice\.fmtDatesCn\(notice\.statusOf\(go, now\)\.label, now\)/.test(brief), '简报 meta 应复用 statusOf label 并格式化日期');
    assert.ok(/if \(notice\.isLongterm\(go, now\)\) return;/.test(brief) && /notice\.hasTimeAnchor\(go\)/.test(brief), '简报应排除资料/无时间（§2.4）');
    assert.ok(brief.indexOf('fmtTime(') < 0 && brief.indexOf('timeLabelOf') < 0, '简报不应再用旧时间文案拼接');
  });

  await test('pages/nt：契约§0.3 有 aiSummary 的卡正文不内联原文；原始消息全进按钮', function () {
    const ntJs = src('pages/nt/nt.js');
    // 内联原文（quotes）只允许无 aiSummary 的历史卡；有 AI 摘要的卡一律 []（全部进「原始消息」按钮）
    assert.ok(/quotes:\s*g\.aiSummary \? \[\] : quotes\.slice\(0, 2\)/.test(ntJs), '有 aiSummary 的卡不应内联原文');
    assert.ok(/const hasRaw = textItems\.length > 0;/.test(ntJs), 'hasRaw = 存在任何 text/follow item');
    const wxml = src('pages/nt/nt.wxml');
    assert.ok(/wx:if="\{\{card\.hasRaw\}\}"[^>]*catchtap="openRaw"[^>]*>原始消息<\/view>/.test(wxml), '存在原文时「原始消息」按钮必须显示');
    // 卡片正文只放 AI 摘要/要点/segments（quotes 之外没有第二条内联原文路径）
    const body = ntJs.slice(ntJs.indexOf('summary: abs('), ntJs.indexOf('expanded: st.expired'));
    assert.ok(body.indexOf('quotes:') >= 0 && body.indexOf('quotes: g.aiSummary ? []') >= 0);
  });

  await test('pages/nt：状态 chip 渲染 statusLabel；长期安排 chip 已含 label，不在头部重复 badge', function () {
    const wxml = src('pages/nt/nt.wxml');
    assert.ok(/<text class="nt-status nt-status--\{\{card\.statusCls\}\}">\{\{card\.statusLabel\}\}<\/text>/.test(wxml), '状态 chip 渲染 statusLabel');
    // 契约 2026-11-14 §2.3：期次卡头部 = 分类徽标 +「长期安排」徽标 + 状态胶囊（仅 isOcc 卡出现，定义卡不重复）
    assert.ok(/<text wx:if="\{\{card\.isOcc\}\}" class="nt-recur-badge">长期安排<\/text>/.test(wxml), '期次卡应有「长期安排」徽标');
    const ntJs = src('pages/nt/nt.js');
    assert.ok(/statusLabel:\s*notice\.fmtDatesCn\(st\.label, now\)/.test(ntJs), 'mapGroup 的 statusLabel = statusOf().label 经 M月D日（相对周）格式化');
    assert.ok(/statusLabel:\s*occ\.label/.test(ntJs), '期次卡状态胶囊 = 本次 M月D日（周X）HH:MM');
    const wxss = src('pages/nt/nt.wxss');
    assert.ok(/\.nt-hd \{[^}]*flex-wrap: wrap/.test(wxss), '长 label（如「长期安排 · label」）应允许换行，避免溢出');
  });

  await test('pages/nt：openRaw 相对日期替换 + 全部原文进按钮（功能；药膳/申报 3 条口径）', function () {
    const def = loadNtPage();
    assert.ok(def && typeof def.openRaw === 'function', 'nt 页未注册 openRaw');
    const group = {
      id: 'g_raw', title: '运动会观众明早8:50到看台集合', aiSummary: '11-06 早 8:50 到看台集合',
      items: [
        { kind: 'text', fromName: '吴静怡', time: '11-05 20:47', text: '明天 12:00 前把电子版发给我，周日晚点名交纸质版。' },
        { kind: 'follow', fromName: '吴静怡', time: '11-05 21:07', text: '补充：今晚 24 点前在群里确认。' },
        { kind: 'follow', fromName: '吴静怡', time: '11-05 21:07', text: '补充：5号上午9点比赛，下午招聘会请准时到场。' }
      ]
    };
    const ctx = {
      data: JSON.parse(JSON.stringify(def.data)),
      _raw: [group],
      _rawById: def._rawById,
      setData(o) { Object.assign(this.data, o); }
    };
    def.openRaw.call(ctx, { currentTarget: { dataset: { gid: 'g_raw' } } });
    assert.strictEqual(ctx.data.rawSheet, true);
    const blocks = ctx.data.rawBlocks;
    assert.strictEqual(blocks.length, 3, '全部 text/follow 原文都要进「原始消息」按钮（药膳/申报 3 条口径）');
    assert.strictEqual(blocks[0].type, '原始消息');
    assert.strictEqual(blocks[1].type, '补充通知');
    assert.strictEqual(blocks[2].type, '补充通知');
    // 契约 2026-11-14 §3：相对词先换成绝对日期，再统一 M月D日（相对周）
    assert.ok(/11月6日（[^）]+） 12:00 前把电子版/.test(blocks[0].text), '原始消息「明天 12:00」应替换并格式化：' + blocks[0].text);
    assert.ok(/11月8日（[^）]+） 晚点名/.test(blocks[0].text), '原始消息「周日晚点名」应替换并格式化：' + blocks[0].text);
    assert.ok(blocks[0].text.indexOf('明天') < 0 && blocks[0].text.indexOf('周日晚点名') < 0, '不应残留相对日期裸词（括号内相对周是契约 §3 的预期格式）');
    assert.ok(/11月5日（[^）]+） 晚 24 点/.test(blocks[1].text), '补充通知同样用整卡锚点替换并格式化：' + blocks[1].text);
    assert.ok(/11月5日（[^）]+） 上午9点比赛/.test(blocks[2].text), '裸日号「5号上午」应替换并格式化：' + blocks[2].text);
    assert.ok(/11月5日（[^）]+） 下午招聘会/.test(blocks[2].text), '裸时段「下午」应前缀日期并格式化：' + blocks[2].text);
    assert.ok(/^运动会观众11月6日（[^）]+） 早 8:50到看台集合$/.test(ctx.data.rawTitle), '弹层标题也要日期化：' + ctx.data.rawTitle);
  });
}

module.exports = { run: run };

/* 独立运行：node notice_time_test.js */
if (require.main === module) {
  const results = [];
  let passN = 0, failN = 0;
  const test = async function (name, fn) {
    try { await fn(); passN += 1; results.push({ name: name, ok: true }); console.log('PASS  ' + name); }
    catch (e) { failN += 1; results.push({ name: name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
  };
  run(test).then(function () {
    const summary = { total: passN + failN, pass: passN, fail: failN, results: results, at: new Date().toISOString() };
    fs.writeFileSync(path.join(__dirname, 'notice_time_result.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log('\n================ notice time: ' + passN + ' passed, ' + failN + ' failed ================');
    process.exitCode = failN ? 2 : 0;
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}
