/* ai_unit_timetable.js —— timetable SKILL 原子接口单元测试（Node + _ai_harness.js，不发真实网络）
 *
 * 时间口径：全部用固定「2026-11-05 周四 14:00（本地时区）」+ 夹具相对生成，
 *          通过接口的 __now 注入（仅测试用，不声明在 mcp.json）保证与运行时刻无关。
 * 期望值对齐：utils/ttplan.js（PERIODS/weekOf/active/sessionsOn/nextSession）与 pages/tt/tt.js。
 */
'use strict';
const H = require('./_ai_harness.js');

const NOW = new Date(2026, 10, 5, 14, 0, 0).getTime();        // 2026-11-05 周四 14:00
const NOW_2200 = new Date(2026, 10, 5, 22, 0, 0).getTime();   // 当天 22:00（课程全部结束）

function env(over, wxOpts) {
  const fx = H.mkFixture(Object.assign({ now: NOW }, over || {}));
  const routes = [{ url: 'tt.json', method: 'GET', data: fx.TT }].concat((wxOpts && wxOpts.routes) || []);
  const wx = H.createWx(Object.assign({ storage: fx.storage, routes: routes }, wxOpts || {}));
  const L = H.loadSkill(wx, 'ai/skills/timetable');
  return { fx: fx, wx: wx, L: L, apis: L.apis };
}
// 统一注入测试时间
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
function ttRequests(wx) { return H.requestsMatching(wx, 'tt.json'); }

(async function main() {

  /* ============================================================ getWeekInfo */
  await H.test('getWeekInfo：成功（本机开学日期 + 第 9 周）', async () => {
    const e = env();
    const r = await call(e, 'getWeekInfo');
    H.isOk(r);
    H.eq(r.structuredContent.currentWeek, 9, 'currentWeek');
    H.eq(r.structuredContent.totalWeeks, 18, 'totalWeeks');
    H.eq(r.structuredContent.weekText, '第 9 周');
    H.eq(r.structuredContent.termSource, 'term-start');
    H.eq(r.structuredContent.hasTimetable, true);
    H.eq(r.structuredContent.pagePath, '/pages/tt/tt');
    H.includes(r.content[0].text, '第 9 周');
  });

  await H.test('getWeekInfo：缺失本机开学日期时用教务快照 t 并提示设置', async () => {
    const e = env({ patch: function (fx) { fx.STORE.termStart = ''; } });
    const r = await call(e, 'getWeekInfo');
    H.isOk(r);
    H.eq(r.structuredContent.termStart, e.fx.TT.t, 'termStart 来自 ttCache.t');
    H.eq(r.structuredContent.termSource, 'tt-sync');
    H.eq(r.structuredContent.currentWeek, 9);
    H.includes(r.content[0].text, '教务同步');
    H.includes(r.content[0].text, '设置');
  });

  await H.test('getWeekInfo：完全没有开学日期（store 与 tt 都为空）', async () => {
    const e = env({ patch: function (fx) { fx.STORE.termStart = ''; fx.STORE.ttCache.t = ''; } });
    const r = await call(e, 'getWeekInfo');
    H.isOk(r);
    H.eq(r.structuredContent.currentWeek, null);
    H.eq(r.structuredContent.weekText, '未设置开学日期');
    H.includes(r.content[0].text, '开学日期');
  });

  await H.test('getWeekInfo：未认证 → identity-required', async () => {
    const e = env({ identity: false });
    const r = await call(e, 'getWeekInfo');
    H.isErr(r, 'identity-required');
    H.eq(H.handoffOf(r).query, '');
  });

  await H.test('getWeekInfo：缓存过期时请求 tt.json（GET、不带身份 token）并回写缓存', async () => {
    const e = env();
    await call(e, 'getWeekInfo');
    const reqs = ttRequests(e.wx);
    H.eq(reqs.length, 1, '一次 tt.json 请求');
    H.eq(reqs[0].method, 'GET');
    H.eq(reqs[0].header && reqs[0].header['X-Class-Token'], undefined, '静态课表不带 X-Class-Token');
    const st = storeOf(e.wx);
    H.eq(st.ttCache.at, NOW, '回写 ttCache.at');
    H.eq(st.ttCache.c.length, e.fx.TT.c.length, '回写课程数组');
    H.eq(st.ttCache.t, e.fx.TT.t);
  });

  await H.test('getWeekInfo：6h 内重复查询命中缓存（0 请求）', async () => {
    const e = env();
    await call(e, 'getWeekInfo');
    await call(e, 'getWeekInfo');
    H.eq(ttRequests(e.wx).length, 1, '第二次不再请求');
  });

  await H.test('getWeekInfo：网络失败时保留本机缓存并提示', async () => {
    const e = env({}, { routes: [{ url: 'tt.json', method: 'GET', fail: 'request:fail mock' }] });
    const r = await call(e, 'getWeekInfo');
    H.isOk(r);
    H.eq(r.structuredContent.hasTimetable, true, '缓存仍在');
    H.includes(r.content[0].text, '课表');
  });

  /* ============================================================ getTimetable */
  await H.test('getTimetable：默认本周（week=9，按天分组，工作日恒出现）', async () => {
    const e = env();
    const r = await call(e, 'getTimetable');
    H.isOk(r);
    const sc = r.structuredContent;
    H.eq(sc.week, 9);
    H.eq(sc.weekText, '第 9 周');
    H.eq(sc.total, 6, '第 9 周共 6 节');
    H.eq(sc.days.length, 5, '周一至周五 5 天（周末无课不出现）');
    H.eq(sc.days[0].day, 1);
    H.eq(sc.days[0].dayText, '周一');
    H.isArray(sc.days[0].courses);
    H.eq(sc.days[3].dayText, '周四');
    H.eq(sc.days[3].courses.length, 3, '周四 3 门课');
    H.eq(sc.days[3].courses[0].name, '高等数学');
    H.eq(sc.days[3].courses[0].room, '01105', '教室短标识');
    H.eq(sc.days[3].courses[0].span, '第1-2节');
    H.eq(sc.days[3].courses[0].startText, '08:10');
    H.includes(sc.pagePath, '/pages/tt/tt?wk=9');
    H.eq(H.handoffOf(r).query, 'wk=9');
  });

  await H.test('getTimetable：next / prev 周', async () => {
    const e = env();
    const nx = await call(e, 'getTimetable', { week: 'next' });
    H.eq(nx.structuredContent.week, 10);
    H.eq(nx.structuredContent.weekText, '第 10 周');
    const pv = await call(e, 'getTimetable', { week: 'prev' });
    H.eq(pv.structuredContent.week, 8);
  });

  await H.test('getTimetable：day=4 只返回周四', async () => {
    const e = env();
    const r = await call(e, 'getTimetable', { week: 9, day: 4 });
    H.isOk(r);
    H.eq(r.structuredContent.days.length, 1);
    H.eq(r.structuredContent.days[0].dayText, '周四');
    H.eq(r.structuredContent.total, 3);
    H.includes(r.structuredContent.pagePath, 'day=4');
  });

  await H.test('getTimetable：单双周过滤（第 8 周没有单周的线性代数）', async () => {
    const e = env();
    const r = await call(e, 'getTimetable', { week: 8 });
    const all = [];
    r.structuredContent.days.forEach(function (d) { d.courses.forEach(function (c) { all.push(c.name); }); });
    H.notIncludes(all, '线性代数', '第 8 周（双周）不应有单周课');
    const r9 = await call(e, 'getTimetable', { week: 9 });
    const all9 = [];
    r9.structuredContent.days.forEach(function (d) { d.courses.forEach(function (c) { all9.push(c.name); }); });
    H.includes(all9, '线性代数', '第 9 周（单周）应有线性代数');
  });

  await H.test('getTimetable：周次超出学期范围按最后一周展示并说明', async () => {
    const e = env();
    const r = await call(e, 'getTimetable', { week: 30 });
    H.isOk(r);
    H.eq(r.structuredContent.week, 18);
    H.includes(r.content[0].text, '超出学期范围');
  });

  await H.test('getTimetable：空结果（第 17 周没课）', async () => {
    const e = env();
    const r = await call(e, 'getTimetable', { week: 17 });
    H.isOk(r);
    H.eq(r.structuredContent.total, 0);
    H.includes(r.content[0].text, '没有课');
  });

  await H.test('getTimetable：week/day 参数非法 → invalid-input', async () => {
    const e = env();
    H.isErr(await call(e, 'getTimetable', { week: 0 }), 'invalid-input');
    H.isErr(await call(e, 'getTimetable', { week: 'abc' }), 'invalid-input');
    H.isErr(await call(e, 'getTimetable', { day: 8 }), 'invalid-input');
    H.isErr(await call(e, 'getTimetable', { week: 3.5 }), 'invalid-input');
  });

  await H.test('getTimetable：无开学日期时 next 报错、显式周次可用', async () => {
    const e = env({ patch: function (fx) { fx.STORE.termStart = ''; fx.STORE.ttCache.t = ''; } });
    H.isErr(await call(e, 'getTimetable', { week: 'next' }), 'invalid-input');
    const r = await call(e, 'getTimetable', { week: 9 });
    H.isOk(r);
    H.eq(r.structuredContent.week, 9);
    H.eq(r.structuredContent.total, 6);
  });

  await H.test('getTimetable：空课表（无缓存 + 拉取失败）引导打开课表页', async () => {
    const e = env({ patch: function (fx) { fx.STORE.ttCache = null; fx.STORE.course = []; } },
      { routes: [{ url: 'tt.json', method: 'GET', fail: 'request:fail mock' }] });
    const r = await call(e, 'getTimetable');
    H.isOk(r);
    H.eq(r.structuredContent.total, 0);
    H.eq(r.structuredContent.hasTimetable, false);
    H.includes(r.content[0].text, '课表页');
  });

  await H.test('getTimetable：未认证 → identity-required', async () => {
    const e = env({ identity: false });
    H.isErr(await call(e, 'getTimetable', { week: 9 }), 'identity-required');
  });

  /* ============================================================ getTodayCourses */
  await H.test('getTodayCourses：周四 14:00（2 节已结束 + 1 节未开始）', async () => {
    const e = env();
    const r = await call(e, 'getTodayCourses');
    H.isOk(r);
    const sc = r.structuredContent;
    H.eq(sc.date, '2026-11-05');
    H.eq(sc.dayText, '周四');
    H.eq(sc.week, 9);
    H.eq(sc.courses.length, 3);
    H.eq(sc.courses[0].name, '高等数学');
    H.eq(sc.courses[0].state, 'done');
    H.eq(sc.courses[0].stateText, '已结束');
    H.eq(sc.courses[2].name, '体育');
    H.eq(sc.courses[2].state, 'next');
    H.includes(sc.stateText, '还有 1 节课');
    H.includes(sc.stateText, '体育');
    H.eq(sc.next.name, '体育');
    H.includes(sc.pagePath, 'wk=9');
    H.includes(sc.pagePath, 'day=4');
  });

  await H.test('getTodayCourses：22:00 今天的课全部结束', async () => {
    const e = env();
    const r = await H.call(e.wx, e.apis, 'getTodayCourses', { __now: NOW_2200 });
    H.isOk(r);
    H.eq(r.structuredContent.stateText, '今天的课已结束');
    H.eq(r.structuredContent.courses.length, 3);
    r.structuredContent.courses.forEach(function (c) { H.eq(c.state, 'done', c.name); });
  });

  await H.test('getTodayCourses：今天没课', async () => {
    const e = env();
    patchStore(e.wx, function (s) {
      // 去掉周四/周一的课，保留其他天，避免夹具把「今天」塞满
      s.ttCache.c = s.ttCache.c.filter(function (c) { return c.day !== 3 && c.day !== 0; });
      s.ttCache.at = NOW;
    });
    const r = await call(e, 'getTodayCourses');
    H.isOk(r);
    H.eq(r.structuredContent.courses.length, 0);
    H.eq(r.structuredContent.stateText, '今天没有课');
    H.includes(r.content[0].text, '没有课');
  });

  await H.test('getTodayCourses：无开学日期 → 说明无法判断', async () => {
    const e = env({ patch: function (fx) { fx.STORE.termStart = ''; fx.STORE.ttCache.t = ''; } });
    const r = await call(e, 'getTodayCourses');
    H.isOk(r);
    H.eq(r.structuredContent.courses.length, 0);
    H.includes(r.structuredContent.stateText, '没有开学日期');
    H.eq(H.handoffOf(r).payload.reason, 'need-term-start');
  });

  await H.test('getTodayCourses：未认证 → identity-required', async () => {
    const e = env({ identity: false });
    H.isErr(await call(e, 'getTodayCourses'), 'identity-required');
  });

  /* ============================================================ getNextCourse */
  await H.test('getNextCourse：下一节是今天 19:45 的体育', async () => {
    const e = env();
    const r = await call(e, 'getNextCourse');
    H.isOk(r);
    const sc = r.structuredContent;
    H.eq(sc.found, true);
    H.eq(sc.name, '体育');
    H.eq(sc.dayText, '今天');
    H.eq(sc.dateText, '11/5');
    H.eq(sc.room, '田径场');
    H.eq(sc.teacher, '刘强');
    H.eq(sc.span, '第11-12节');
    H.eq(sc.startText, '19:45');
    H.eq(sc.endText, '21:20');
    H.eq(sc.week, 9);
    H.includes(sc.leftText, '剩');
    H.eq(H.handoffOf(r).query, 'wk=9');
  });

  await H.test('getNextCourse：14 天内没有课 → found:false', async () => {
    const e = env();
    // 所有课程周次改成 1-8（现在第 9 周），缓存标记为新鲜避免重新拉取覆盖
    patchStore(e.wx, function (s) {
      s.ttCache.c = s.ttCache.c.map(function (c) { return Object.assign({}, c, { weeks: '1-8' }); });
      s.ttCache.at = NOW;
    });
    const r = await call(e, 'getNextCourse');
    H.isOk(r);
    H.eq(r.structuredContent.found, false);
    H.includes(r.content[0].text, '14 天');
  });

  await H.test('getNextCourse：无开学日期 → found:false + 引导设置', async () => {
    const e = env({ patch: function (fx) { fx.STORE.termStart = ''; fx.STORE.ttCache.t = ''; } });
    const r = await call(e, 'getNextCourse');
    H.isOk(r);
    H.eq(r.structuredContent.found, false);
    H.includes(r.content[0].text, '开学日期');
    H.eq(H.handoffOf(r).payload.reason, 'need-term-start');
  });

  await H.test('getNextCourse：未认证 → identity-required', async () => {
    const e = env({ identity: false });
    H.isErr(await call(e, 'getNextCourse'), 'identity-required');
  });

  /* ============================================================ getCourseDetail */
  await H.test('getCourseDetail：高等数学（精确匹配）', async () => {
    const e = env();
    const r = await call(e, 'getCourseDetail', { courseName: '高等数学' });
    H.isOk(r);
    const sc = r.structuredContent;
    H.eq(sc.name, '高等数学');
    H.eq(sc.teacher, '李国强');
    H.eq(sc.room, '01105');
    H.eq(sc.weeks, '1-16');
    H.eq(sc.parity, 'all');
    H.eq(sc.dayText, '周四');
    H.eq(sc.span, '第1-2节');
    H.eq(sc.totalSchedules, 1);
    H.eq(sc.nextDates.length, 5);
    H.includes(sc.nextDates[0], '11/12');
    H.includes(sc.pagePath, '/pages/tt/tt');
  });

  await H.test('getCourseDetail：唯一模糊匹配（高等 → 高等数学）', async () => {
    const e = env();
    const r = await call(e, 'getCourseDetail', { courseName: '高等' });
    H.isOk(r);
    H.eq(r.structuredContent.name, '高等数学');
  });

  await H.test('getCourseDetail：课程不存在 → 空结果 + 可选课程名', async () => {
    const e = env();
    const r = await call(e, 'getCourseDetail', { courseName: '量子力学' });
    H.isOk(r);
    H.eq(r.structuredContent.totalSchedules, 0);
    H.includes(r.content[0].text, '没有找到');
    H.includes(r.structuredContent.availableNames, '高等数学');
    H.isArray(r.structuredContent.nextDates);
  });

  await H.test('getCourseDetail：参数错误（缺 courseName / 空串）→ invalid-input', async () => {
    const e = env();
    H.isErr(await call(e, 'getCourseDetail', {}), 'invalid-input');
    H.isErr(await call(e, 'getCourseDetail', { courseName: '   ' }), 'invalid-input');
    H.isErr(await call(e, 'getCourseDetail', { courseName: 123 }), 'invalid-input');
  });

  await H.test('getCourseDetail：未认证 → identity-required', async () => {
    const e = env({ identity: false });
    H.isErr(await call(e, 'getCourseDetail', { courseName: '高等数学' }), 'identity-required');
  });

  /* ============================================================ setTermStart */
  await H.test('setTermStart：成功写入本机并算出当前周', async () => {
    const e = env();
    const r = await call(e, 'setTermStart', { termStart: '2026-09-07' });
    H.isOk(r);
    H.eq(r.structuredContent.ok, true);
    H.eq(r.structuredContent.termStart, '2026-09-07');
    H.eq(r.structuredContent.currentWeek, 9);
    H.eq(r.structuredContent.weekText, '第 9 周');
    H.eq(storeOf(e.wx).termStart, '2026-09-07', '写回 store.termStart');
    H.includes(r.content[0].text, '第 9 周');
    H.includes(r.content[0].text, '同步');
    H.eq(H.handoffOf(r).query, 'wk=9');
    // 写本机后 getWeekInfo 立刻用新值
    const w = await call(e, 'getWeekInfo');
    H.eq(w.structuredContent.termStart, '2026-09-07');
  });

  await H.test('setTermStart：未来日期 → currentWeek null', async () => {
    const e = env();
    const r = await call(e, 'setTermStart', { termStart: '2027-02-22' });
    H.isOk(r);
    H.eq(r.structuredContent.currentWeek, null);
    H.eq(r.structuredContent.weekText, '尚未开学');
    H.includes(r.content[0].text, '第 1 周');
  });

  await H.test('setTermStart：非法日期 → invalid-input', async () => {
    const e = env();
    H.isErr(await call(e, 'setTermStart', { termStart: '2026/09/01' }), 'invalid-input');
    H.isErr(await call(e, 'setTermStart', { termStart: '2026-02-30' }), 'invalid-input');
    H.isErr(await call(e, 'setTermStart', { termStart: '2010-01-01' }), 'invalid-input');
    H.isErr(await call(e, 'setTermStart', { termStart: '' }), 'invalid-input');
    H.isErr(await call(e, 'setTermStart', {}), 'invalid-input');
    H.eq(storeOf(e.wx).termStart, e.fx.TT.t, '失败时不写本机');
  });

  await H.test('setTermStart：云同步关闭时提示仅本机', async () => {
    const e = env({ patch: function (fx) { fx.STORE.cloudOff = true; } });
    const r = await call(e, 'setTermStart', { termStart: '2026-09-07' });
    H.isOk(r);
    H.eq(r.structuredContent.cloudOff, true);
    H.includes(r.content[0].text, '云同步已关闭');
  });

  await H.test('setTermStart：未认证 → identity-required', async () => {
    const e = env({ identity: false });
    H.isErr(await call(e, 'setTermStart', { termStart: '2026-09-07' }), 'identity-required');
  });

  /* ============================================================ 契约 / 静态 */
  await H.test('契约：mcp.json 接口名与 registerAPI 完全一致（6 个）', async () => {
    const e = env();
    const names = e.L.mcp.apis.map(function (a) { return a.name; }).sort();
    H.deepEq(e.L.apiNames.slice().sort(), names);
    H.eq(names.length, 6);
    H.eq(e.L.warnings.length, 0, '加载告警应为空: ' + e.L.warnings.join('|'));
    e.L.mcp.apis.forEach(function (a) {
      H.ok(a.inputSchema && a.inputSchema.type === 'object', a.name + ' inputSchema 必须为 object');
      H.eq(a._meta.ui.pagePath, '/pages/tt/tt', a.name + ' pagePath');
      H.eq(a._meta.ui.componentPath, 'components/timetable-card/index');
    });
    H.eq(e.L.mcp.components.length, 1);
    H.eq(e.L.mcp.components[0].relatedPage, '/pages/tt/tt');
  });

  await H.test('契约：每次成功返回都有 pagePath；content ≤ 200 字；handoff 是函数', async () => {
    const e = env();
    const okCases = [
      ['getWeekInfo', {}],
      ['getTimetable', { week: 9 }],
      ['getTodayCourses', {}],
      ['getNextCourse', {}],
      ['getCourseDetail', { courseName: '大学英语' }],
      ['setTermStart', { termStart: '2026-09-07' }]
    ];
    for (let i = 0; i < okCases.length; i++) {
      const name = okCases[i][0];
      const r = await call(e, name, okCases[i][1]);
      H.isOk(r);
      H.isStr(r.structuredContent.pagePath, name + ' pagePath');
      H.ok(r.structuredContent.pagePath.indexOf('/pages/tt/tt') === 0, name + ' pagePath 指向课表页');
      H.ok(r.content[0].text.length <= 200, name + ' content 超 200 字：' + r.content[0].text.length);
      if (r.handoff !== undefined) {
        H.eq(typeof r.handoff, 'function', name + ' handoff');
        const hv = r.handoff();
        H.eq(typeof hv.query, 'string');
        H.eq(typeof hv.payload, 'object');
      }
    }
  });

  await H.test('契约：SKILL.md ≤ 16000B、mcp.json 去 outputSchema/空白 ≤ 24000B', async () => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.resolve(__dirname, '..', 'ai', 'skills', 'timetable');
    const skillSize = fs.statSync(path.join(dir, 'SKILL.md')).size;
    H.ok(skillSize <= 16000, 'SKILL.md 大小 ' + skillSize);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8'));
    raw.apis.forEach(function (a) { delete a.outputSchema; });
    const compact = JSON.stringify(raw).replace(/\s+/g, '');
    H.ok(compact.length <= 24000, 'mcp.json 计数 ' + compact.length);
  });

  const rep = H.report('timetable');
  if (rep.fail) process.exitCode = 1;
})().catch(function (e) {
  console.error('SUITE CRASH:', (e && e.stack) || e);
  process.exitCode = 1;
});

