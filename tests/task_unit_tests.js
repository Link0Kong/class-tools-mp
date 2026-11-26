/* task_unit_tests.js —— 小程序任务模块纯逻辑/契约测试（不启动模拟器）
 * 运行：node tests/task_unit_tests.js
 * 覆盖：数据归一（未分组/步骤备注）、分组/视图顺序、作业/通知转入、重复任务、
 *       taskdata 视图剥离附件、分享卡任务视图。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..').replace(/\\/g, '/');
let mem = Object.create(null);
let toasts = [];
global.wx = {
  getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
  setStorageSync(k, v) { mem[k] = v; },
  removeStorageSync(k) { delete mem[k]; },
  showToast(o) { toasts.push(o && o.title); },
  getFileSystemManager() { return { copyFile() {}, unlink() {}, readFile() {} }; },
  navigateTo() {}, switchTab() {}
};
mem['zq_class_identity'] = JSON.stringify({ token: 'tok-task-unit', sid: '3260799999', name: '测试账号', role: '', badge: '', is_admin: false, ts: 1 });

const store = require(path.join(ROOT, 'utils/store.js'));
const task = require(path.join(ROOT, 'utils/task.js'));
const sharecard = require(path.join(ROOT, 'utils/sharecard.js'));
let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); pass++; console.log('PASS  ' + name); }
  catch (e) { fail++; console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
}
function reset() {
  mem = Object.create(null);
  mem['zq_class_identity'] = JSON.stringify({ token: 'tok-task-unit', sid: '3260799999', name: '测试账号', role: '', badge: '', is_admin: false, ts: 1 });
  toasts = [];
  Object.keys(require.cache).forEach(function (k) {
    if (k.replace(/\\/g, '/').indexOf(ROOT) === 0) delete require.cache[k];
  });
}
function fresh() {
  reset();
  const s = require(path.join(ROOT, 'utils/store.js'));
  return { store: s, task: require(path.join(ROOT, 'utils/task.js')) };
}

T('默认任务数据：无 inbox 分组、prefs 有 sidebarOrder', function () {
  const x = fresh(), d = x.task.data();
  assert.strictEqual(d.lists.length, 0);
  assert.strictEqual(d.items.length, 0);
  assert.deepStrictEqual(d.prefs.sidebarOrder, []);
  assert.strictEqual(d.prefs.sidebarOrderAt, 0);
});

T('归一：旧 inbox 分组丢弃、任务归未分组、步骤备注保留', function () {
  const x = fresh();
  const d = x.task.normData({
    lists: [{ id: 'inbox', name: '任务', order: 0 }, { id: 'l1', name: '学习', color: 'bl', order: 1 }],
    items: [{
      id: 't1', title: ' 复习  ', list: 'inbox', done: false,
      steps: [{ text: '看例题', done: true, note: '先看 3.2 节' }, { text: '做习题', done: false }],
      tags: ['甲', '甲', '乙'], updatedAt: 5
    }],
    prefs: { sound: false, defaultRemind: '30', sidebarOrder: ['done', 'all'], sidebarOrderAt: 9 },
    updatedAt: 10
  });
  assert.deepStrictEqual(d.lists.map(function (l) { return l.id; }), ['l1']);
  assert.strictEqual(d.items[0].list, '');
  assert.strictEqual(d.items[0].title, '复习');
  assert.strictEqual(d.items[0].steps[0].note, '先看 3.2 节');
  assert.deepStrictEqual(d.items[0].tags, ['甲', '乙']);
  assert.strictEqual(d.prefs.sidebarOrder[0], 'done');
  assert.strictEqual(d.prefs.sidebarOrderAt, 9);
});

T('分组：新建/改名/排序/删除后任务回未分组', function () {
  const x = fresh(), t = x.task;
  const a = t.addGroup('学习', 'bl');
  const b = t.addGroup('生活', 'sd');
  assert.ok(a && b);
  assert.deepStrictEqual(t.lists().map(function (l) { return l.name; }), ['学习', '生活']);
  t.reorderGroups([b.id, a.id]);
  assert.deepStrictEqual(t.lists().map(function (l) { return l.id; }), [b.id, a.id]);
  const item = t.emptyItem({ title: '买牙膏', list: a.id });
  t.items().push(item); t.save();
  t.deleteGroup(a.id);
  assert.strictEqual(t.findTask(item.id).list, '');
  assert.ok(!t.listExact(a.id));
});

T('视图顺序：reorderSidebar 写 prefs 并带时间戳', function () {
  const x = fresh(), t = x.task;
  const order = ['important', 'all', 'done', 'planned', 'myday'];
  t.reorderSidebar(order);
  assert.deepStrictEqual(t.sidebar().order, order);
  assert.ok(t.sidebar().at > 0);
  assert.strictEqual(t.smartList()[0].k, 'important');
});

T('任务：快速字段/步骤备注/附件 JSON 归一', function () {
  const x = fresh(), t = x.task;
  const it = t.emptyItem({
    title: '写报告', list: '', due: '2099-01-02', dueTime: '18:30',
    steps: [{ text: '查资料', done: false, note: '图书馆' }],
    attachments: JSON.stringify([{ n: 'a.txt', t: 'text/plain', s: 3, path: '/tmp/a.txt', img: false }])
  });
  t.items().push(it); t.save();
  const got = t.findTask(it.id);
  assert.strictEqual(got.steps[0].note, '图书馆');
  assert.strictEqual(t.parseAttachments(got.attachments)[0].path, '/tmp/a.txt');
  assert.strictEqual(t.dueText(got), '1月2日 18:30');
});

T('重复任务：完成生成下一次，取消完成回收下一次', function () {
  const x = fresh(), t = x.task;
  const it = t.emptyItem({ title: '每周复盘', due: '2099-01-01', repeat: 'weekly' });
  t.items().push(it); t.save();
  const r = t.setDone(it.id, true);
  assert.ok(r && r.next && r.next.fromId === it.id);
  assert.strictEqual(r.next.repeat, 'weekly');
  assert.ok(r.next.due > it.due);
  t.setDone(it.id, false);
  assert.ok(!t.items().some(function (x) { return x.fromId === it.id && !x.done; }));
});

T('隔离：同机换学号后任务不串号（owner 检查 + store 清空）', function () {
  const x = fresh(), t = x.task;
  t.items().push(t.emptyItem({ title: '甲同学的任务' })); t.save();
  assert.strictEqual(t.items().length, 1);
  mem['zq_class_identity'] = JSON.stringify({ token: 'tok-task-unit-2', sid: '9999000001', name: '测试乙', role: '', badge: '', is_admin: false, ts: 2 });
  t.resetCache();
  const store = require(path.join(ROOT, 'utils/store.js'));
  store.reload();
  assert.strictEqual(t.items().length, 0, '换号后不能看到上一位同学的任务');
  t.items().push(t.emptyItem({ title: '乙同学的任务' })); t.save();
  assert.strictEqual(t.items().length, 1);
});

T('ICS 导出：含带时间的 VEVENT、标题/备注/步骤，转义换行与逗号', function () {
  const x = fresh(), t = x.task;
  const it = t.emptyItem({ title: '复习,高数;A', notes: '第一行\n第二行', due: '2099-01-02', dueTime: '18:30', steps: [{ text: '看例题', done: false }] });
  t.items().push(it); t.save();
  const ics = t.icsText(true);
  assert.ok(ics.indexOf('BEGIN:VCALENDAR') === 0);
  assert.ok(ics.indexOf('DTSTART:20990102T183000') >= 0);
  assert.ok(ics.indexOf('SUMMARY:复习\\,高数\\;A') >= 0);
  assert.ok(ics.indexOf('DESCRIPTION:第一行\\n第二行') >= 0);
  assert.ok(ics.indexOf('步骤：看例题') >= 0);
  assert.ok(ics.indexOf('END:VEVENT') >= 0);
});

T('班级作业 → 任务：来源/截止/标题/防重复', function () {
  const x = fresh(), t = x.task;
  const h = { id: 'hw1', subject: '英语', content: 'Unit 3 练习', due: '下节课前', date: '2099-02-03', time: '09:30' };
  const one = t.addFromHW(h);
  assert.ok(one && one.sourceHwId === 'hw1');
  assert.strictEqual(one.list, '');
  assert.strictEqual(one.dueTime, '09:30');
  assert.ok(one.tags.indexOf('班级作业') >= 0);
  assert.strictEqual(t.addFromHW(h), null);
  assert.strictEqual(t.items().filter(function (z) { return z.sourceHwId === 'hw1'; }).length, 1);
});

T('通知 → 任务：来源/正文/截止/防重复', function () {
  const x = fresh(), t = x.task;
  const g = {
    id: 'nt1', title: '班会通知', cat: '班级事务', summary: '周三开班会',
    deadline: '2099-03-04T18:30:00+08:00',
    items: [{ kind: 'text', text: '请带笔记本' }]
  };
  const one = t.addFromNotice(g);
  assert.ok(one && one.sourceNoticeId === 'nt1');
  assert.ok(one.notes.indexOf('请带笔记本') >= 0);
  assert.strictEqual(one.due, '2099-03-04');
  assert.strictEqual(one.dueTime, '18:30');
  assert.strictEqual(t.addFromNotice(g), null);
});

T('taskdata 视图：附件清空、分组/步骤/视图顺序保留', function () {
  const x = fresh(), t = x.task;
  const l = t.addGroup('学习', 'bl');
  const it = t.emptyItem({ title: '背单词', list: l.id, steps: [{ text: '第一页', done: false, note: 'n' }], attachments: JSON.stringify([{ n: 'a.txt', path: '/tmp/a', s: 1 }]) });
  t.items().push(it); t.save();
  t.reorderSidebar(['done', 'all']);
  const v = t.taskView(t.data());
  assert.strictEqual(v.items[0].attachments, '');
  assert.strictEqual(v.lists.length, 1);
  assert.strictEqual(v.items[0].steps[0].note, 'n');
  assert.deepStrictEqual(v.prefs.sidebarOrder, ['done', 'all']);
});

T('分组视图、明天标签和无截止日期的自定义提醒', function () {
  const t = fresh().task, group = t.addGroup('实验', 'cy');
  t.writeUi({ view: 'list', list: group.id });
  assert.strictEqual(t.readUi().view, 'list');
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const ymd = [tomorrow.getFullYear(), String(tomorrow.getMonth() + 1).padStart(2, '0'), String(tomorrow.getDate()).padStart(2, '0')].join('-');
  assert.strictEqual(t.dueText({ due: ymd }), '明天');
  assert.strictEqual(t.calcRemindAt('', '', 'custom', 12345), 12345);
  assert.strictEqual(t.dateOk('2026-02-30'), false);
});

T('长期逾期任务顺延到未来，撤销保留已编辑的下一次', function () {
  const t = fresh().task, parent = t.emptyItem({ title: '练习', due: '2020-01-01', repeat: 'weekly' });
  t.items().push(parent);
  const child = t.setDone(parent.id, true).next;
  assert.ok(t.dueMs(child) > Date.now());
  assert.strictEqual(new Date(child.due + 'T12:00:00').getDay(), 3);
  child.updatedAt = child.createdAt + 1;
  t.setDone(parent.id, false);
  assert.ok(t.findTask(child.id));
});

T('分享卡：任务视图包含标题/截止/步骤', function () {
  const v = sharecard.buildTaskView({
    focus: { title: '复习高数', subtitle: '学习 · 今天 20:00', lines: [{ label: '步骤 1', text: '看例题 · 先看 3.2' }], note: '提醒：提前 30 分钟' },
    open: [], done: [], time: '20:00'
  });
  assert.strictEqual(v.title, '复习高数');
  assert.ok(v.subtitle.indexOf('今天 20:00') >= 0);
  assert.ok(JSON.stringify(v.lines).indexOf('看例题') >= 0);
});

T('页面/入口：app.json 注册任务页、工具入口与四件套齐全', function () {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  assert.ok(app.pages.indexOf('pages/task/task') >= 0);
  const files = ['task.js', 'task.wxml', 'task.wxss', 'task.json'];
  files.forEach(function (f) { assert.ok(fs.existsSync(path.join(ROOT, 'pages/task', f)), f); });
  const tools = require(path.join(ROOT, 'utils/tools.js'));
  const one = tools.toolOf('hw');
  assert.ok(one && one.url === '/pages/task/task' && one.name === '任务', '任务必须接管原作业工具槽位');
  assert.ok(one.icoImg === '/images/tool-task.png', '任务使用统一白色工具图标');
  assert.ok(!tools.TOOLS.some(function (t) { return t.key === 'task'; }), '不再保留独立 task 工具入口');
  const js = fs.readFileSync(path.join(ROOT, 'pages/task/task.js'), 'utf8');
  ['onShareAppMessage', 'onShareTimeline', 'openShare', 'saveEditor', 'addFromHW'].forEach(function (m) {
    assert.ok(js.indexOf(m) >= 0, '缺少 ' + m);
  });
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/task/task.wxml'), 'utf8');
  ['share-sheet', 'bottom-sheet', 'openEditor', 'saveEditor', 'detailShare', 'chooseAttachment'].forEach(function (m) {
    assert.ok(wxml.indexOf(m) >= 0, 'WXML 缺少 ' + m);
  });
  const page = fs.readFileSync(path.join(ROOT, 'pages/nt/nt.js'), 'utf8');
  assert.ok(page.indexOf('addFromNotice') >= 0 && fs.readFileSync(path.join(ROOT, 'pages/nt/nt.wxml'), 'utf8').indexOf('addToTask') >= 0, '通知未接任务');
  const hw = fs.readFileSync(path.join(ROOT, 'pages/hw/hw.js'), 'utf8');
  assert.ok(hw.indexOf('addFromHW') >= 0 && fs.readFileSync(path.join(ROOT, 'pages/hw/hw.wxml'), 'utf8').indexOf('toTask') >= 0, '作业板未接任务');
  const idx = fs.readFileSync(path.join(ROOT, 'pages/index/index.wxml'), 'utf8');
  assert.ok(idx.indexOf('goTask') >= 0, '工作台未接任务卡');
  assert.ok(idx.indexOf('待办任务') >= 0 && idx.indexOf('tool-task.png') >= 0, '工作台任务卡未统一标题/图标');
  assert.ok(idx.indexOf('作业待交') < 0, '工作台不应再保留旧作业卡');
  assert.strictEqual(tools.normalizeHome(['task']).join(','), 'hw', '旧 task key 必须迁移到原作业槽位 hw');
  assert.strictEqual(tools.normalizeToolOrder(['task'])[0], 'hw', '旧 task 排序 key 必须迁移');
});

T('AI 整理：只显式发送原文，选择后回填，保存才写入，待填任务继续排队', function () {
  const x = fresh();
  let page;
  let sent;
  let submissions = 0;
  let aborted = false;
  global.Page = (config) => { page = config; };
  wx.request = (request) => {
    if (!request.url.endsWith('/task-ai/suggest')) return;
    sent = request;
    submissions++;
    return { abort() { aborted = true; } };
  };
  try {
    require(path.join(ROOT, 'pages/task/task.js'));
    page.setData = function (changes) {
      Object.keys(changes).forEach((key) => {
        const keys = key.split('.');
        const parent = keys.length === 2 ? this.data[keys[0]] : this.data;
        parent[keys[keys.length - 1]] = changes[key];
      });
    };
    page.refresh = function () {};
    page._syncTaskReminder = function () {};
    const enter = (text) => page.onAiInput({ detail: { value: text } });
    const candidate = { title: '准备报告', notes: '十分钟', due: '2026-12-02', dueTime: '09:30',
      steps: [{ text: '拟提纲', note: '先确定主题', done: true }], suggestions: ['留出练习时间'] };

    page.openAi();
    enter(' 明早交报告，还有阅读作业 ');
    assert.strictEqual(submissions, 0);
    page.submitAi();
    page.submitAi();
    assert.strictEqual(submissions, 1);
    assert.deepStrictEqual(sent.data, { text: '明早交报告，还有阅读作业', localDate: x.task.today() });
    assert.strictEqual(sent.header['X-Class-Token'], 'tok-task-unit');
    sent.success({ statusCode: 429 });
    assert.ok(page.data.ai.status.includes('频繁'));
    assert.strictEqual(page.data.ai.text, ' 明早交报告，还有阅读作业 ');

    page.submitAi();
    sent.success({ statusCode: 200, data: { drafts: [candidate, { title: '阅读作业', due: '2026-02-31', dueTime: '10:00' }] } });
    assert.strictEqual(page.data.ai.picker, true);
    assert.strictEqual(page.data.editor.show, false);
    assert.strictEqual(x.task.items().length, 0);
    page.chooseAiDraft({ currentTarget: { dataset: { index: 0 } } });
    assert.strictEqual(page.data.editor.title, '准备报告');
    assert.strictEqual(page.data.editor.due, '2026-12-02');
    assert.strictEqual(page.data.editor.dueTime, '09:30');
    assert.ok(page.data.editor.notes.includes('完成建议\n• 留出练习时间'));
    assert.deepStrictEqual(page.data.editor.steps, [{ text: '拟提纲', note: '先确定主题', done: false }]);
    page.closeEditor();
    assert.strictEqual(page.data.ai.drafts.length, 2);
    page.openAiDraft(0);
    page.data.editor.title = '核对过的报告';
    page.saveEditor();
    assert.deepStrictEqual(x.task.items().map((item) => item.title), ['核对过的报告']);
    assert.strictEqual(page.data.ai.show, true);
    assert.strictEqual(page.data.ai.drafts.length, 1);
    page.openAiDraft(0);
    assert.strictEqual(page.data.editor.due, '');
    assert.strictEqual(page.data.editor.dueTime, '');
    page.closeEditor();

    page.showAiInput();
    enter('保留原文字');
    page.submitAi();
    page.closeAi();
    sent.success({ statusCode: 200, data: { drafts: [candidate] } });
    assert.strictEqual(aborted, true);
    assert.strictEqual(page.data.ai.show, false);
    assert.strictEqual(page.data.editor.show, false);
    assert.strictEqual(page.data.ai.drafts[0].title, '阅读作业');
    page.openAi();
    page.showAiInput();
    page.submitAi();
    sent.success({ statusCode: 200, data: { drafts: [candidate] } });
    assert.strictEqual(page.data.editor.show, true);
    assert.strictEqual(page.data.editor.title, '准备报告');
    assert.strictEqual(x.task.items().length, 1);
  } finally {
    delete global.Page;
    delete wx.request;
  }
});

console.log('\n================ ' + pass + ' passed, ' + fail + ' failed ================');
if (fail) process.exit(1);
