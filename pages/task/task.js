// pages/task/task.js —— 个人任务（网页任务模块的小程序移植）
//
// 能力对齐（2026-11-22）：
//   · 我的任务 / 班级作业双段；任务未分组；分组/视图自定义顺序（随 taskdata 同步）
//   · 快速添加、截止日期/时间、提醒、重复、标签、我的一天、重要
//   · 详情只读 + 独立编辑按钮；步骤展开、步骤备注；附件（本机文件）
//   · 班级作业 / 通知 → 任务；taskdata 云同步（与网页同一张表/同一份 blob 格式）
//   · 分享：任务页汇总卡 / 单任务卡（sharecard + shareflow）
const task = require('../../utils/task.js');
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');
const identity = require('../../utils/identity.js');
const cloud = require('../../utils/cloud.js');
const share = require('../../utils/share.js');
const sharecard = require('../../utils/sharecard.js');
const shareflow = require('../../utils/shareflow.js');
const notify = require('../../utils/notify.js');

const REMIND = [
  { k: 'none', n: '不提醒' }, { k: 'due', n: '到期时' },
  { k: '5', n: '提前 5 分钟' }, { k: '15', n: '提前 15 分钟' },
  { k: '30', n: '提前 30 分钟' }, { k: '60', n: '提前 1 小时' },
  { k: '1440', n: '提前 1 天' }, { k: 'custom', n: '指定时间' }
];
const REPEAT = [
  { k: '', n: '不重复' }, { k: 'daily', n: '每天' }, { k: 'weekday', n: '工作日' },
  { k: 'weekly', n: '每周' }, { k: 'monthly', n: '每月' }, { k: 'yearly', n: '每年' }
];
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip', mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4'
};

function pad(n) { return ('0' + n).slice(-2); }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function extOf(n) { const m = String(n || '').match(/\.([a-z0-9]{1,6})$/i); return m ? m[1].toLowerCase() : ''; }
function mimeOf(n) { return MIME[extOf(n)] || 'application/octet-stream'; }
function isImg(t) { return /^image\//.test(String(t || '')); }
function fmtSize(n) {
  n = Number(n) || 0;
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(2) + 'GB';
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + 'MB';
  return Math.max(1, Math.round(n / 1024)) + 'KB';
}
function fmtDate(ms) {
  const d = new Date(Number(ms) || Date.now());
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function copyTask(t) {
  return JSON.parse(JSON.stringify(t || {}));
}
function tagsOf(s) {
  return String(s || '').split(/[,，;；#]+/).map(function (x) { return x.trim(); })
    .filter(function (x, i, a) { return x && a.indexOf(x) === i; }).slice(0, 6);
}
function attsOf(t) {
  return task.parseAttachments(t && t.attachments).map(function (a) {
    const ext = extOf(a.n);
    return Object.assign({}, a, {
      sizeText: fmtSize(a.s),
      badge: a.img ? 'IMG' : (ext ? ext.toUpperCase().slice(0, 4) : 'FILE')
    });
  });
}

Page(shareflow.install({
  data: {
    state: 'data',
    errorText: '',
    seg: 'my',
    segs: [{ id: 'my', label: '我的任务' }, { id: 'class', label: '班级作业' }],
    scrolled: false,
    views: [],
    groups: [],
    counts: { all: 0, myday: 0, important: 0, planned: 0, done: 0 },
    tasks: [],
    doneTasks: [],
    doneOpen: false,
    ui: { view: 'all', list: '', sort: 'default', search: '' },
    searchOpen: false,
    quickTitle: '',
    quickStar: false,
    quickDueOpen: false,
    quickDate: '',
    quickTime: '',
    quickListIdx: 0,
    quickListLabel: '未分组',
    listNames: ['未分组'],
    listIds: [''],
    syncText: '',
    cloudEnabled: false,
    classOpen: [],
    classCount: 0,
    remindBar: { show: false, id: '', title: '', meta: '' },
    detail: { show: false, task: null },
    editor: { show: false },
    manage: { show: false, views: [], groups: [] },
    groupForm: { show: false, id: '', name: '', color: 'cy', isNew: true, colors: [] },
    shared: { show: false, t: '', d: '', l: '', note: '', steps: [] },
    remindOptions: REMIND.map(function (x) { return x.n; }),
    defaultRemindOptions: REMIND.slice(0, 7).map(function (x) { return x.n; }),
    defaultRemindIdx: 0,
    defaultRemindLabel: '不提醒',
    repeatOptions: REPEAT.map(function (x) { return x.n; }),
    sortLabel: '默认排序',
    busy: false
  },

  onLoad(options) {
    this._expanded = {};
    this._dead = false;
    this._pendingTask = (options && options.task) ? String(options.task) : '';
    this._shared = null;
    if (options && options.shared) {
      let raw = String(options.shared), obj = null;
      try { obj = JSON.parse(raw); } catch (e) {
        try { obj = JSON.parse(decodeURIComponent(raw)); } catch (e2) { obj = null; }
      }
      if (obj && obj.t) this._shared = obj;
    }
    this._remindTimer = null;
    this._classRaw = [];
    task.onStatus((s) => { if (!this._dead) this.setData({ syncText: s, cloudEnabled: cloud.isEnabled() }); });
  },
  onShow() {
    share.enable();
    if (!identity.ensure()) return;
    this._dead = false;
    try { store.reload(); } catch (e) {}
    try { task.resetCache(); } catch (e) {}
    this.refresh();
    task.boot();
    task.pull().then(() => { if (!this._dead) this.refresh(); }).catch(function () {});
    this.startReminderTimer();
  },
  onHide() {
    this.stopReminderTimer();
    task.flush();
  },
  onUnload() {
    this._dead = true;
    this.stopReminderTimer();
    task.flush();
  },
  onPullDownRefresh() {
    const self = this;
    task.pull(true).then(function () { self.refresh(); wx.stopPullDownRefresh(); },
      function () { wx.stopPullDownRefresh(); });
  },
  onPageScroll(e) {
    const y = Number(e && e.scrollTop) || 0;
    const next = y > 64 ? true : (y < 20 ? false : this.data.scrolled);
    if (next !== this.data.scrolled && !this._scBusy) {
      this._scBusy = true;
      this.setData({ scrolled: next }, () => { this._scBusy = false; });
    }
  },

  // ------------------------------------------------------------ 列表
  refresh() {
    try {
      const ui = task.readUi();
      if (ui.view === 'list' && !task.listExact(ui.list)) { ui.view = 'all'; ui.list = ''; }
      if (ui.view === 'list' && !ui.list) ui.view = 'all';
      const counts = task.counts();
      const active = ui.view === 'list' ? ui.list : ui.view;
      const views = task.smartList().map(function (v) {
        return { k: v.k, n: v.n, icon: v.icon, count: counts[v.k] || 0, on: v.k === active };
      });
      const groups = task.lists().map(function (l) {
        return {
          id: l.id, name: l.name, color: l.color, hex: task.COLOR_HEX[l.color] || task.COLOR_HEX.cy,
          count: task.items().filter(function (t) { return !t.done && t.list === l.id; }).length,
          on: ui.view === 'list' && ui.list === l.id
        };
      });
      const listNames = ['未分组'], listIds = [''];
      task.lists().forEach(function (l) { listNames.push(l.name); listIds.push(l.id); });
      let qIdx = listIds.indexOf(ui.quickList);
      if (qIdx < 0) qIdx = ui.view === 'list' ? Math.max(0, listIds.indexOf(ui.list)) : 0;
      const raw = ui.view === 'done' ? [] : task.viewItems(ui.view, ui.list, ui.search, ui.sort);
      const done = task.viewItems('done', '', ui.search, ui.sort).slice(0, 60);
      const hw = (store.get().homework || []).filter(function (h) {
        const doneMap = store.get().hwDone || {}, hide = store.get().hwHide || {};
        return !(h.id ? doneMap[h.id] : h.done) && !(h.id && hide[h.id]);
      });
      this._classRaw = hw;
      const classOpen = hw.map(function (h) {
        const info = util.dueInfo(h);
        const atts = task.parseAttachments(h.attachments);
        return {
          id: h.id || ('ts' + h.ts), subject: h.subject || '', content: h.content || '',
          dueText: info && info.txt ? info.txt : '', cls: info && info.cls ? info.cls : 'muted',
          dateText: h.date ? (h.date + (h.time ? ' ' + h.time : '')) : '',
          attCount: atts.length
        };
      });
      this._ui = ui;
      this.setData({
        state: 'data', errorText: '', ui: ui, counts: counts,
        views: views, groups: groups, tasks: raw.map((t) => this.taskVM(t, false)),
        doneTasks: done.map((t) => this.taskVM(t, true)), doneOpen: !!ui.doneOpen,
        listNames: listNames, listIds: listIds, quickListIdx: qIdx,
        quickListLabel: listNames[qIdx] || '未分组',
        searchOpen: !!ui.search, classOpen: classOpen, classCount: classOpen.length,
        syncText: task.syncText(), cloudEnabled: cloud.isEnabled(),
        sortLabel: ({ default: '默认排序', due: '按截止时间', created: '按创建时间', important: '按重要性' })[ui.sort] || '默认排序'
      }, () => {
        if (this._pendingTask) {
          const id = this._pendingTask; this._pendingTask = '';
          this.openDetail(id);
        }
        if (this._shared) { this.openShared(this._shared); this._shared = null; }
      });
    } catch (e) {
      this.setData({ state: 'error', errorText: '读取任务失败：' + ((e && e.message) || e) });
    }
  },
  taskVM(t, done) {
    const steps = (t.steps || []).map(function (s, i) { return { text: s.text, done: !!s.done, note: s.note || '', idx: i }; });
    let sd = 0; steps.forEach(function (s) { if (s.done) sd++; });
    const atts = attsOf(t);
    return {
      id: t.id, title: t.title, notes: t.notes, done: !!t.done,
      starred: !!t.starred, dueText: task.dueText(t), dueMs: task.dueMs(t),
      remindText: task.reminderText(t), repeatText: task.repeatText(t.repeat),
      myDay: t.myDay === task.today(),
      tags: (t.tags || []).slice(0, 3), moreTags: Math.max(0, (t.tags || []).length - 3),
      listName: t.list ? task.findList(t.list).name : '', listHex: t.list ? task.COLOR_HEX[task.findList(t.list).color] : '',
      stepDone: sd, stepTotal: steps.length, steps: steps, expanded: !!this._expanded[t.id],
      atts: atts, attCount: atts.length,
      sourceHw: !!t.sourceHwId, sourceNotice: !!t.sourceNoticeId,
      overdue: !!(t.due && task.dueMs(t) && task.dueMs(t) < Date.now() && !t.done),
      doneText: t.doneAt ? fmtDate(t.doneAt) : ''
    };
  },
  onSeg(e) {
    const seg = e.detail.value;
    this.setData({ seg: seg });
    if (seg === 'my') this.refresh();
  },
  onView(e) {
    const v = e.currentTarget.dataset.k;
    if (!v) return;
    const ui = task.readUi();
    ui.view = v; ui.list = '';
    if (v === 'done') ui.doneOpen = true;
    task.writeUi(ui);
    this.refresh();
  },
  onGroup(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const ui = task.readUi();
    ui.view = 'list'; ui.list = id; ui.quickList = id;
    task.writeUi(ui);
    this.refresh();
  },
  onSearchInput(e) {
    const v = e.detail.value;
    this.setData({ 'ui.search': v });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => { const ui = task.readUi(); ui.search = v; task.writeUi(ui); this.refresh(); }, 180);
  },
  toggleSearch() {
    const open = !this.data.searchOpen;
    this.setData({ searchOpen: open });
    if (!open) {
      const ui = task.readUi(); ui.search = ''; task.writeUi(ui); this.refresh();
    }
  },
  onSort() {
    const self = this;
    wx.showActionSheet({
      itemList: ['默认排序', '按截止时间', '按创建时间', '按重要性'],
      success: function (r) {
        const sorts = ['default', 'due', 'created', 'important'];
        const ui = task.readUi(); ui.sort = sorts[r.tapIndex] || 'default'; task.writeUi(ui);
        self.refresh();
      }
    });
  },
  toggleDoneOpen() {
    const ui = task.readUi(); ui.doneOpen = !ui.doneOpen; task.writeUi(ui);
    this.setData({ doneOpen: ui.doneOpen });
  },
  onTaskTap(e) { this.openDetail(e.currentTarget.dataset.id); },
  onCheck(e) {
    const t = task.findTask(e.currentTarget.dataset.id);
    if (!t) return;
    if (!t.done) { try { notify.cancelTask(t.id).catch(function () {}); } catch (e) {} }
    const r = task.setDone(t.id, !t.done);
    if (r && r.next && r.next.due) util.toast('已完成 · 下次 ' + r.next.due.slice(5));
    this.refresh();
  },
  onStar(e) { task.toggleStar(e.currentTarget.dataset.id); this.refresh(); },
  onExpand(e) {
    const id = e.currentTarget.dataset.id;
    this._expanded[id] = !this._expanded[id];
    this.refresh();
  },
  onStepTap(e) {
    const t = task.findTask(e.currentTarget.dataset.id);
    const i = Number(e.currentTarget.dataset.idx);
    if (!t || !t.steps[i]) return;
    task.setStepDone(t.id, i, !t.steps[i].done);
    this.refresh();
  },
  onEdit(e) { this.openEditor(e.currentTarget.dataset.id); },

  // 快速添加
  onQuickInput(e) { this.setData({ quickTitle: e.detail.value }); },
  toggleQuickStar() { this.setData({ quickStar: !this.data.quickStar }); },
  toggleQuickDue() { this.setData({ quickDueOpen: !this.data.quickDueOpen }); },
  onQuickDate(e) {
    const d = e.detail.value;
    this.setData({ quickDate: d, 'quickDueOpen': true });
  },
  onQuickTime(e) { this.setData({ quickTime: e.detail.value }); },
  onQuickList(e) {
    const i = Number(e.detail.value) || 0;
    this.setData({ quickListIdx: i, quickListLabel: this.data.listNames[i] || '未分组' });
  },
  clearQuickDue() { this.setData({ quickDate: '', quickTime: '', quickDueOpen: false }); },
  addQuick() {
    const title = String(this.data.quickTitle || '').trim();
    if (!title) { util.toast('填写任务标题'); return; }
    let due = this.data.quickDate || '', time = this.data.quickTime || '';
    if (time && !due) { util.toast('请先选择截止日期'); return; }
    const list = this.data.listIds[this.data.quickListIdx] || '';
    const prefs = task.prefs();
    let mode = (due && prefs.defaultRemind && prefs.defaultRemind !== 'none') ? prefs.defaultRemind : 'none';
    const item = task.emptyItem({
      title: title.slice(0, 200), list: list, due: due, dueTime: due ? time : '',
      remindMode: mode, starred: !!this.data.quickStar,
      myDay: this._ui && this._ui.view === 'myday' ? task.today() : ''
    });
    item.remindAt = task.calcRemindAt(item.due, item.dueTime, item.remindMode, 0);
    task.items().push(item);
    task.save();
    this._syncTaskReminder(task.findTask(item.id), null);
    this.setData({ quickTitle: '', quickStar: false, quickDate: '', quickTime: '', quickDueOpen: false });
    this.refresh();
    util.toast('已添加');
  },

  // ------------------------------------------------------------ 详情
  buildDetail(t) {
    const steps = (t.steps || []).map(function (s, i) { return { text: s.text, done: !!s.done, note: s.note || '', idx: i }; });
    const atts = attsOf(t);
    const tags = (t.tags || []).slice();
    return {
      id: t.id, title: t.title, notes: t.notes, done: !!t.done, starred: !!t.starred,
      listName: t.list ? task.findList(t.list).name : '未分组',
      dueText: task.dueText(t), remindText: task.reminderText(t), repeatText: task.repeatText(t.repeat),
      myDay: t.myDay === task.today(), tags: tags, steps: steps, attachments: atts,
      sourceType: t.sourceNoticeId ? '班级通知' : (t.sourceHwId ? '班级作业' : ''),
      sourceTitle: t.sourceTitle || '', hasSource: !!(t.sourceNoticeId || t.sourceHwId),
      createdText: fmtDate(t.createdAt), updatedText: fmtDate(t.updatedAt),
      hasNotes: !!String(t.notes || '').trim(), sourceNoticeId: t.sourceNoticeId || '', sourceHwId: t.sourceHwId || ''
    };
  },
  openDetail(id) {
    const t = task.findTask(id);
    if (!t) { util.toast('任务不存在'); return; }
    this.setData({ detail: { show: true, task: this.buildDetail(t) } });
  },
  closeDetail() { this.setData({ 'detail.show': false }); },
  detailCheck() {
    const d = this.data.detail.task; if (!d) return;
    if (!d.done) { try { notify.cancelTask(d.id).catch(function () {}); } catch (e) {} }
    const r = task.setDone(d.id, !d.done);
    const t = task.findTask(d.id);
    if (t) this.setData({ 'detail.task': this.buildDetail(t) });
    if (r && r.next && r.next.due) util.toast('已完成 · 下次 ' + r.next.due.slice(5));
    this.refresh();
  },
  detailStar() {
    const d = this.data.detail.task; if (!d) return;
    task.toggleStar(d.id);
    const t = task.findTask(d.id);
    if (t) this.setData({ 'detail.task': this.buildDetail(t) });
    this.refresh();
  },
  detailStep(e) {
    const d = e.currentTarget.dataset;
    task.setStepDone(this.data.detail.task.id, Number(d.idx), !d.done);
    const t = task.findTask(this.data.detail.task.id);
    if (t) this.setData({ 'detail.task': this.buildDetail(t) });
    this.refresh();
  },
  detailEdit() {
    const id = this.data.detail.task && this.data.detail.task.id;
    this.closeDetail();
    if (id) this.openEditor(id);
  },
  detailSource() {
    const d = this.data.detail.task; if (!d) return;
    const url = d.sourceNoticeId ? ('/pages/nt/nt?gid=' + encodeURIComponent(d.sourceNoticeId))
      : (d.sourceHwId ? ('/pages/hw/hw?id=' + encodeURIComponent(d.sourceHwId)) : '');
    if (!url) return;
    this.closeDetail();
    wx.navigateTo({ url: url });
  },
  detailAtt(e) {
    const a = this.data.detail.task.attachments[Number(e.currentTarget.dataset.i)];
    if (a) this.previewAtt(a);
  },
  detailShare() {
    const d = this.data.detail.task;
    if (!d) return;
    const opts = this._detailShareOpts(d);
    if (!opts) return;
    shareflow.open(this, opts);
  },
  moveTask(e) {
    const d = this.data.detail.task;
    if (!d) return;
    const dir = Number(e.currentTarget.dataset.d) || 0;
    const arr = task.items().filter(function (x) { return !x.done; }).sort(function (a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); });
    const i = arr.findIndex(function (x) { return x.id === d.id; });
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) { util.toast('已到边界'); return; }
    const a = arr[i], b = arr[j], oa = a.order;
    a.order = b.order; b.order = oa;
    task.save(); this.refresh();
    const t = task.findTask(d.id);
    if (t) this.setData({ 'detail.task': this.buildDetail(t) });
  },

  // ------------------------------------------------------------ 编辑器
  openEditor(id) {
    if (id && typeof id !== 'string') id = (id.currentTarget && id.currentTarget.dataset && id.currentTarget.dataset.id) || '';
    id = id ? String(id) : '';
    const t = id ? task.findTask(id) : null;
    if (id && !t) { util.toast('任务不存在'); return; }
    const prefs = task.prefs();
    let mode = t ? (t.remindMode || 'none') : (prefs.defaultRemind || 'none');
    if (mode === 'custom' && !t) mode = 'none';
    let rIdx = REMIND.findIndex(function (r) { return r.k === mode; });
    if (rIdx < 0) rIdx = 0;
    let rpIdx = REPEAT.findIndex(function (r) { return r.k === (t ? t.repeat : ''); });
    if (rpIdx < 0) rpIdx = 0;
    const list = t ? t.list : (this._ui && this._ui.view === 'list' ? this._ui.list : '');
    let lIdx = this.data.listIds.indexOf(list);
    if (lIdx < 0) lIdx = 0;
    const now = Date.now();
    let cd = t && t.remindCustom ? new Date(t.remindCustom) : new Date(now + 3600000);
    const edit = {
      show: true, isNew: !t, id: t ? t.id : '',
      title: t ? t.title : '', notes: t ? t.notes : '',
      due: t ? t.due : '', dueTime: t ? t.dueTime : '',
      remindMode: mode, remindIdx: rIdx, customDate: ymd(cd), customTime: hhmm(cd),
      repeat: t ? t.repeat : '', repeatIdx: rpIdx,
      list: list, listIdx: lIdx, tagsText: t ? (t.tags || []).join(', ') : '',
      remindLabel: (REMIND[rIdx] || REMIND[0]).n,
      repeatLabel: (REPEAT[rpIdx] || REPEAT[0]).n,
      listLabel: this.data.listNames[lIdx] || '未分组',
      done: t ? !!t.done : false, starred: t ? !!t.starred : false,
      myDay: t ? t.myDay === task.today() : false,
      steps: t ? (t.steps || []).map(function (s) { return { text: s.text, done: !!s.done, note: s.note || '' }; }) : [],
      attachments: t ? attsOf(t) : [], stepAdd: '', busy: false
    };
    this._editOriginal = t ? copyTask(t) : null;
    this.setData({ editor: edit });
  },
  closeEditor() { this.setData({ 'editor.show': false }); },
  onEditInput(e) { this.setData({ ['editor.' + e.currentTarget.dataset.k]: e.detail.value }); },
  onEditDate(e) { this.setData({ 'editor.due': e.detail.value }); if (!e.detail.value) this.setData({ 'editor.dueTime': '' }); },
  onEditTime(e) { this.setData({ 'editor.dueTime': e.detail.value }); },
  onEditCustomDate(e) { this.setData({ 'editor.customDate': e.detail.value }); },
  onEditCustomTime(e) { this.setData({ 'editor.customTime': e.detail.value }); },
  clearEditorDue() { this.setData({ 'editor.due': '', 'editor.dueTime': '' }); },
  onEditList(e) {
    const i = Number(e.detail.value) || 0;
    this.setData({ 'editor.listIdx': i, 'editor.listLabel': this.data.listNames[i] || '未分组' });
  },
  onEditRemind(e) {
    const i = Number(e.detail.value) || 0;
    this.setData({ 'editor.remindIdx': i, 'editor.remindMode': REMIND[i].k, 'editor.remindLabel': REMIND[i].n });
  },
  onEditRepeat(e) {
    const i = Number(e.detail.value) || 0;
    this.setData({ 'editor.repeatIdx': i, 'editor.repeat': REPEAT[i].k, 'editor.repeatLabel': REPEAT[i].n });
  },
  toggleEditDone() { this.setData({ 'editor.done': !this.data.editor.done }); },
  toggleEditStar() { this.setData({ 'editor.starred': !this.data.editor.starred }); },
  toggleEditMyDay() { this.setData({ 'editor.myDay': !this.data.editor.myDay }); },

  onEditStepText(e) { this.setData({ ['editor.steps[' + e.currentTarget.dataset.i + '].text']: e.detail.value }); },
  onEditStepNote(e) { this.setData({ ['editor.steps[' + e.currentTarget.dataset.i + '].note']: e.detail.value }); },
  onEditStepDone(e) {
    const i = Number(e.currentTarget.dataset.i);
    this.setData({ ['editor.steps[' + i + '].done']: !this.data.editor.steps[i].done });
  },
  onEditStepDel(e) {
    const arr = this.data.editor.steps.slice();
    arr.splice(Number(e.currentTarget.dataset.i), 1);
    this.setData({ 'editor.steps': arr });
  },
  onStepAddInput(e) { this.setData({ 'editor.stepAdd': e.detail.value }); },
  addEditStep() {
    const v = String(this.data.editor.stepAdd || '').trim();
    if (!v) return;
    if (this.data.editor.steps.length >= 50) { util.toast('步骤最多 50 条'); return; }
    const arr = this.data.editor.steps.slice();
    arr.push({ text: v.slice(0, 120), done: false, note: '' });
    this.setData({ 'editor.steps': arr, 'editor.stepAdd': '' });
  },

  chooseAttachment() {
    const e = this.data.editor;
    if (!e || !e.show) return;
    const left = 2 - (e.attachments || []).length;
    if (left <= 0) { util.toast('最多 2 个附件'); return; }
    if (!wx.chooseMessageFile && !wx.chooseMedia) { util.toast('当前微信版本不支持选择附件'); return; }
    const self = this;
    const onFiles = function (files) { self._saveTaskFiles(files); };
    if (wx.chooseMessageFile) {
      wx.chooseMessageFile({
        count: left, type: 'all',
        success: function (r) { onFiles((r.tempFiles || []).slice(0, left)); },
        fail: function (err) { if (!/cancel/i.test(String(err && err.errMsg))) util.toast('选择附件失败'); }
      });
    } else {
      wx.chooseMedia({
        count: left, mediaType: ['image', 'video'], sourceType: ['album', 'camera'],
        success: function (r) {
          onFiles((r.tempFiles || []).map(function (f) {
            const t = f.fileType === 'image' ? 'image/jpeg' : (f.fileType === 'video' ? 'video/mp4' : '');
            return { path: f.tempFilePath, name: '附件', size: f.size, type: t };
          }));
        }
      });
    }
  },
  _saveTaskFiles(files) {
    if (!files || !files.length) return;
    const fs = wx.getFileSystemManager();
    const self = this;
    const out = [];
    let i = 0;
    const next = function () {
      if (i >= files.length) {
        const arr = (self.data.editor.attachments || []).concat(out).slice(0, 2);
        self.setData({ 'editor.attachments': arr });
        if (out.length) util.toast('已添加 ' + out.length + ' 个附件');
        return;
      }
      const f = files[i++];
      const name = String(f.name || f.path || '附件').split('/').pop();
      const ext = extOf(name) || 'bin';
      const dest = wx.env.USER_DATA_PATH + '/task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.' + ext;
      const done = function (p) {
        const type = f.type && String(f.type).indexOf('/') >= 0 ? f.type : mimeOf(name);
        out.push({
          id: task.newId('a'), n: name.slice(0, 120), t: type, s: Number(f.size) || 0,
          path: p || f.path, img: isImg(type), sizeText: fmtSize(f.size),
          badge: isImg(type) ? 'IMG' : (ext ? ext.toUpperCase().slice(0, 4) : 'FILE')
        });
        next();
      };
      try {
        fs.copyFile({
          srcPath: f.path || f.tempFilePath, destPath: dest,
          success: function () { done(dest); },
          fail: function () { done(f.path || f.tempFilePath); }
        });
      } catch (e) { done(f.path || f.tempFilePath); }
    };
    next();
  },
  removeAttachment(e) {
    const i = Number(e.currentTarget.dataset.i);
    const arr = (this.data.editor.attachments || []).slice();
    const a = arr.splice(i, 1)[0];
    if (a && a.path) { try { wx.getFileSystemManager().unlink({ filePath: a.path }); } catch (e) {} }
    this.setData({ 'editor.attachments': arr });
  },
  previewEditorAtt(e) {
    const a = (this.data.editor.attachments || [])[Number(e.currentTarget.dataset.i)];
    if (a) this.previewAtt(a);
  },
  previewAtt(a) {
    if (!a) return;
    if (a.img && a.path) { wx.previewImage({ current: a.path, urls: [a.path] }); return; }
    if (/^video\//.test(a.t) && wx.previewMedia) { wx.previewMedia({ sources: [{ url: a.path, type: 'video' }] }); return; }
    if (/^audio\//.test(a.t)) {
      try {
        if (this._audio) { this._audio.stop(); this._audio.destroy(); }
        this._audio = wx.createInnerAudioContext(); this._audio.src = a.path; this._audio.play();
        util.toast('正在播放音频');
      } catch (e) { util.toast('音频播放失败'); }
      return;
    }
    if (/^text\//.test(a.t) || /\.(txt|md|csv|json|log)$/i.test(a.n)) {
      try {
        wx.getFileSystemManager().readFile({
          filePath: a.path, encoding: 'utf8',
          success: function (r) {
            wx.showModal({ title: a.n, content: String(r.data || '').slice(0, 3000), showCancel: false, confirmText: '关闭' });
          },
          fail: function () { util.toast('读取文本失败'); }
        });
      } catch (e) { util.toast('读取文本失败'); }
      return;
    }
    if (a.path && (/\.pdf$/i.test(a.n) || /\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(a.n))) {
      wx.openDocument({ filePath: a.path, showMenu: true, fail: function () { util.toast('无法打开该文件'); } });
      return;
    }
    util.toast('该类型暂不支持预览');
  },

  _syncTaskReminder(t, old) {
    if (!t) return;
    if (t.done) { try { notify.cancelTask(t.id).catch(function () {}); } catch (e) {} return; }
    if (!t.remindAt || t.remindAt <= Date.now() + 60000) {
      if (old && old.remindAt) { try { notify.cancelTask(t.id).catch(function () {}); } catch (e) {} }
      return;
    }
    if (old && old.remindAt === t.remindAt && old.title === t.title && old.due === t.due && old.dueTime === t.dueTime) return;
    // saveEditor/addQuick 都是用户点击的同步调用链，ask() 会在这里直接触发订阅授权
    try {
      notify.subscribeTask(t, t.remindAt, '任务提醒').catch(function (err) {
        if (String((err && err.message) || '') === 'denied') util.toast('任务已保存；提醒未开启');
      });
    } catch (e) { /* 旧基础库/未部署云函数时静默，任务本身已保存 */ }
  },
  saveEditor() {
    const e = this.data.editor;
    if (!e || !e.show) return;
    const title = String(e.title || '').replace(/\s+/g, ' ').trim();
    if (!title) { util.toast('填写任务标题'); return; }
    if (e.due && !task.dateOk(e.due)) { util.toast('截止日期无效'); return; }
    if (e.dueTime && !e.due) { util.toast('请先选择截止日期'); return; }
    if (e.due && e.dueTime && !task.timeOk(e.dueTime)) { util.toast('时间无效'); return; }
    const list = this.data.listIds[e.listIdx] || '';
    const mode = REMIND[e.remindIdx] ? REMIND[e.remindIdx].k : 'none';
    let custom = 0;
    if (mode === 'custom') {
      const d = util.toDate(e.customDate);
      if (!d) { util.toast('指定提醒日期无效'); return; }
      const m = String(e.customTime || '').match(/^(\d{1,2}):(\d{2})$/);
      if (!m) { util.toast('指定提醒时间无效'); return; }
      d.setHours(+m[1], +m[2], 0, 0);
      custom = d.getTime();
    }
    const steps = (e.steps || []).map(function (s) {
      return { text: String(s.text || '').trim(), done: !!s.done, note: String(s.note || '').trim().slice(0, 500) };
    }).filter(function (s) { return !!s.text; }).slice(0, 50);
    const base = e.isNew ? task.emptyItem() : copyTask(task.findTask(e.id) || task.emptyItem());
    if (!e.isNew && !task.findTask(e.id)) { util.toast('任务不存在'); return; }
    Object.assign(base, {
      title: title.slice(0, 200), notes: String(e.notes || '').slice(0, 5000),
      list: list, due: e.due || '', dueTime: e.due ? (e.dueTime || '') : '',
      remindMode: mode, remindCustom: custom,
      remindAt: task.calcRemindAt(e.due, e.due ? e.dueTime : '', mode, custom),
      repeat: (REPEAT[e.repeatIdx] || REPEAT[0]).k,
      starred: !!e.starred, myDay: e.myDay ? task.today() : '',
      tags: tagsOf(e.tagsText), steps: steps,
      attachments: e.attachments && e.attachments.length ? JSON.stringify(e.attachments.map(function (a) {
        return { id: a.id || '', n: a.n, t: a.t, s: a.s, path: a.path, img: !!a.img };
      })) : '',
      updatedAt: Date.now()
    });
    if (e.isNew) base.createdAt = Date.now();
    base.done = false; base.doneAt = 0;
    task.upsert(base);
    if (e.done) task.setDone(base.id, true);
    const saved = task.findTask(base.id);
    if (saved && !saved.done) this._syncTaskReminder(saved, this._editOriginal);
    else if (saved) { try { notify.cancelTask(saved.id).catch(function () {}); } catch (err) {} }    if (!e.isNew) {
      const old = this._editOriginal;
      if (old && old.title && old.title !== base.title) { /* 保留来源字段 */ }
    }
    this.setData({ 'editor.show': false });
    this.refresh();
    util.toast(e.isNew ? '已添加' : '已保存');
  },
  deleteEditor() {
    const e = this.data.editor;
    if (!e || e.isNew) { this.closeEditor(); return; }
    const self = this;
    wx.showModal({
      title: '删除任务', content: '删除后不可恢复，确定？', confirmText: '删除', confirmColor: '#B87870',
      success: function (r) {
        if (!r.confirm) return;
        task.removeTask(e.id);
        try { notify.cancelTask(e.id).catch(function () {}); } catch (err) {}
        self.setData({ 'editor.show': false, 'detail.show': false });
        self.refresh(); util.toast('已删除');
      }
    });
  },

  // ------------------------------------------------------------ 管理（视图/分组排序、分组增删改）
  openManage() {
    const views = task.smartList().map(function (v, i) { return { k: v.k, n: v.n, icon: v.icon, i: i }; });
    const groups = task.lists().map(function (l, i) {
      return { id: l.id, name: l.name, color: l.color, hex: task.COLOR_HEX[l.color], i: i };
    });
    let di = REMIND.slice(0, 7).findIndex(function (r) { return r.k === (task.prefs().defaultRemind || 'none'); });
    if (di < 0) di = 0;
    this.setData({ manage: { show: true, views: views, groups: groups }, defaultRemindIdx: di, defaultRemindLabel: REMIND[di].n });
  },
  closeManage() { this.setData({ 'manage.show': false }); },
  onDefaultRemind(e) {
    const i = Number(e.detail.value) || 0;
    const mode = (REMIND[i] || REMIND[0]).k;
    const p = task.prefs();
    p.defaultRemind = mode;
    task.save();
    this.setData({ defaultRemindIdx: i, defaultRemindLabel: (REMIND[i] || REMIND[0]).n });
    util.toast('默认提醒：' + (REMIND[i] || REMIND[0]).n);
  },
  exportIcs() {
    let text = '';
    try { text = task.icsText(true); } catch (e) { text = ''; }
    if (!text || text.indexOf('BEGIN:VEVENT') < 0) { util.toast('没有带截止日期的未完成任务'); return; }
    const fallback = function () {
      wx.setClipboardData({ data: text, success: function () { util.toast('ICS 已复制，可粘贴到日历'); } });
    };
    try {
      const p = wx.env.USER_DATA_PATH + '/class-tools-tasks.ics';
      wx.getFileSystemManager().writeFile({
        filePath: p, data: text, encoding: 'utf8',
        success: function () {
          if (wx.shareFileMessage) {
            wx.shareFileMessage({
              filePath: p, fileName: '班级工具任务.ics',
              success: function () {}, fail: function (err) {
                if (!/cancel/i.test(String(err && err.errMsg))) fallback();
              }
            });
          } else fallback();
        },
        fail: fallback
      });
    } catch (e) { fallback(); }
  },
  moveView(e) {
    const i = Number(e.currentTarget.dataset.i), d = Number(e.currentTarget.dataset.d);
    const arr = this.data.manage.views.slice();
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    const x = arr.splice(i, 1)[0]; arr.splice(j, 0, x);
    task.reorderSidebar(arr.map(function (v) { return v.k; }));
    this.setData({ 'manage.views': arr.map(function (v, k) { return Object.assign({}, v, { i: k }); }) });
    this.refresh();
  },
  moveGroup(e) {
    const i = Number(e.currentTarget.dataset.i), d = Number(e.currentTarget.dataset.d);
    const arr = this.data.manage.groups.slice();
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    const x = arr.splice(i, 1)[0]; arr.splice(j, 0, x);
    task.reorderGroups(arr.map(function (g) { return g.id; }));
    this.setData({ 'manage.groups': arr.map(function (g, k) { return Object.assign({}, g, { i: k }); }) });
    this.refresh(); this.openManage();
  },
  openGroupForm(e) {
    const id = e.currentTarget.dataset.id || '';
    const l = id ? task.listExact(id) : null;
    this.setData({
      'manage.show': false,
      groupForm: {
        show: true, id: id, isNew: !l, name: l ? l.name : '', color: l ? l.color : 'cy', colors: task.COLORS
      }
    });
  },
  closeGroupForm() { this.setData({ 'groupForm.show': false }); },
  onGroupName(e) { this.setData({ 'groupForm.name': e.detail.value }); },
  pickGroupColor(e) { this.setData({ 'groupForm.color': e.currentTarget.dataset.c }); },
  saveGroupForm() {
    const g = this.data.groupForm;
    const name = String(g.name || '').trim();
    if (!name) { util.toast('填写分组名称'); return; }
    if (g.isNew) task.addGroup(name, g.color);
    else task.updateGroup(g.id, { name: name, color: g.color });
    this.setData({ 'groupForm.show': false });
    this.openManage(); this.refresh(); util.toast('已保存');
  },
  deleteGroupForm() {
    const g = this.data.groupForm;
    if (!g || g.isNew) return;
    const self = this;
    wx.showModal({
      title: '删除分组', content: '分组内任务会移到未分组，确定？', confirmText: '删除', confirmColor: '#B87870',
      success: function (r) {
        if (!r.confirm) return;
        task.deleteGroup(g.id);
        const ui = task.readUi(); if (ui.view === 'list' && ui.list === g.id) { ui.view = 'all'; ui.list = ''; task.writeUi(ui); }
        self.setData({ 'groupForm.show': false });
        self.openManage(); self.refresh(); util.toast('已删除');
      }
    });
  },

  // ------------------------------------------------------------ 班级作业段
  openHW() { wx.navigateTo({ url: '/pages/hw/hw' }); },
  classToTask(e) {
    const i = Number(e.currentTarget.dataset.i);
    const h = this._classRaw[i];
    if (!h) return;
    task.addFromHW(h);
    this.refresh();
  },
  classAllToTask() {
    const self = this;
    const todo = (this._classRaw || []).filter(function (h) {
      return !task.items().some(function (t) { return t.sourceHwId && t.sourceHwId === h.id; });
    });
    if (!todo.length) { util.toast('没有可加入的未完成作业'); return; }
    wx.showModal({
      title: '加入任务', content: '把 ' + todo.length + ' 项未完成作业加入任务？',
      success: function (r) {
        if (!r.confirm) return;
        todo.forEach(function (h) { task.addFromHW(h, true); });
        self.refresh(); util.toast('已加入 ' + todo.length + ' 项');
      }
    });
  },

  // ------------------------------------------------------------ 页内提醒
  startReminderTimer() {
    this.stopReminderTimer();
    this.checkReminders();
    this._remindTimer = setInterval(() => this.checkReminders(), 20000);
  },
  stopReminderTimer() {
    if (this._remindTimer) { clearInterval(this._remindTimer); this._remindTimer = null; }
  },
  checkReminders() {
    if (this._dead) return;
    const now = Date.now();
    const hit = task.items().filter(function (t) {
      return !t.done && t.remindAt > 0 && t.remindAt <= now && !(t.snoozeUntil > now) && !(t.lastNotifyAt >= t.remindAt);
    })[0];
    if (!hit) { if (this.data.remindBar.show) this.setData({ remindBar: { show: false } }); return; }
    hit.lastNotifyAt = now; task.saveQuiet();
    this.setData({ remindBar: { show: true, id: hit.id, title: hit.title, meta: task.dueText(hit) || '任务提醒' } });
  },
  remindDone() {
    const id = this.data.remindBar.id;
    if (id) {
      task.setDone(id, true);
      try { notify.cancelTask(id).catch(function () {}); } catch (e) {}
    }
    this.setData({ remindBar: { show: false } });
    this.refresh();
  },
  remindSnooze() {
    const id = this.data.remindBar.id;
    const t = id ? task.findTask(id) : null;
    if (t) { t.snoozeUntil = Date.now() + 10 * 60000; t.lastNotifyAt = 0; task.save(); }
    this.setData({ remindBar: { show: false } });
    util.toast('10 分钟后提醒');
  },
  remindClose() { this.setData({ remindBar: { show: false } }); },

  // ------------------------------------------------------------ 分享
  openShared(s) {
    if (!s || !s.t) return;
    this.setData({
      shared: {
        show: true, t: String(s.t || '').slice(0, 100),
        d: String(s.d || ''), l: String(s.l || '未分组'),
        note: String(s.n || '').slice(0, 500),
        steps: (Array.isArray(s.s) ? s.s : []).slice(0, 6).map(function (x) { return String(x || '').slice(0, 120); })
      }
    });
  },
  closeShared() { this.setData({ 'shared.show': false }); },
  saveShared() {
    const s = this.data.shared;
    if (!s || !s.t) return;
    const item = task.emptyItem({
      title: s.t, notes: s.note || '', list: '',
      steps: (s.steps || []).map(function (x) { return { text: x, done: false, note: '' }; })
    });
    // 分享只带展示用截止文案；无法可靠还原时留空，由用户补日期
    task.items().push(item); task.save();
    this.setData({ 'shared.show': false });
    this.refresh(); util.toast('已保存为我的任务');
  },
  _shareTaskQuery(t) {
    if (!t) return '';
    const p = {
      t: String(t.title || '').slice(0, 60),
      d: String(t.dueText || '').slice(0, 32),
      l: String(t.listName || '').slice(0, 12),
      n: '',
      s: (t.steps || []).slice(0, 3).map(function (x) { return String(x.text || '').slice(0, 40); })
    };
    try {
      const q = 'shared=' + encodeURIComponent(JSON.stringify(p));
      return q.length <= 900 ? q : '';
    } catch (e) { return ''; }
  },
  _shareOpenOpts() {
    const detail = this.data.detail;
    const time = util.timeStr();
    if (detail.show && detail.task) {
      return this._detailShareOpts(detail.task);
    }
    const open = this.data.tasks || [], done = this.data.doneTasks || [];
    if (!open.length && !done.length) { util.toast('任务列表是空的'); return null; }
    return {
      title: '我的任务 · 未完成 ' + open.length + ' 条',
      view: sharecard.buildTaskView({ open: open, done: done, nick: identity.name(), time: time })
    };
  },
  _detailShareOpts(d) {
    const lines = (d.steps || []).slice(0, 6).map(function (s, i) {
      return { label: s.done ? '✓ 步骤' : '步骤 ' + (i + 1), text: s.text + (s.note ? (' · ' + s.note) : '') };
    });
    if (!lines.length && d.hasNotes) lines.push({ label: '备注', text: String(d.notes || '').slice(0, 80) });
    return {
      title: d.title,
      view: sharecard.buildTaskView({
        focus: {
          title: d.title,
          subtitle: [d.listName, d.dueText, d.done ? '已完成' : ''].filter(Boolean).join(' · '),
          lines: lines,
          note: d.remindText ? ('提醒：' + d.remindText) : ''
        },
        open: [], done: [], time: util.timeStr()
      })
    };
  },
  openShare() { const o = this._shareOpenOpts(); if (o) shareflow.open(this, o); },
  closeShare() { shareflow.close(this); },
  shareImage() { shareflow.shareImage(this); },
  onShareAppMessage() {
    const d = this.data.detail;
    const title = d.show && d.task ? ('任务｜' + d.task.title) : ('我的任务｜未完成 ' + (this.data.tasks || []).length + ' 条');
    return share.message({
      title: title,
      path: '/pages/task/task',
      query: d.show && d.task ? this._shareTaskQuery(d.task) : '',
      imageUrl: this.data.shareImg || sharecard.FALLBACK.task
    });
  },
  onShareTimeline() {
    const d = this.data.detail;
    const title = d.show && d.task ? ('任务｜' + d.task.title) : '我的任务｜班级工具';
    return share.timeline({
      title: title,
      query: d.show && d.task ? this._shareTaskQuery(d.task) : '',
      imageUrl: this.data.shareImg || sharecard.FALLBACK.task
    });
  }
}));
