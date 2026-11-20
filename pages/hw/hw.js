// pages/hw/hw.js —— 作业板（未完成 / 已完成，本地 + 可选云同步）
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');
const cloud = require('../../utils/cloud.js');
const identity = require('../../utils/identity.js');
const canvas = require('../../utils/canvas.js');
const notify = require('../../utils/notify.js');
const share = require('../../utils/share.js');
const agent = require('../../utils/agent.js');
const scrollmem = require('../../utils/scrollmem.js');
const sharecard = require('../../utils/sharecard.js');
const shareflow = require('../../utils/shareflow.js');

const TAG = { grey: 'muted', red: 'danger', warn: 'warn', ok: 'ok' };
const ATT_PICK_IMAGE = 5 * 1024 * 1024, ATT_PICK_FILE = 2 * 1024 * 1024, ATT_STORE = 1.9 * 1024 * 1024, ATT_N = 2;
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf', txt: 'text/plain', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip' };
function extOf(n) { const m = String(n || '').match(/\.([a-z0-9]+)$/i); return m ? m[1].toLowerCase() : ''; }
function mimeOf(n) { return MIME[extOf(n)] || 'application/octet-stream'; }
function isImg(t) { return /^image\//.test(String(t || '')); }
function fmtSize(n) { n = Number(n) || 0; return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB'; }
function parseAtt(s) {
  if (!s) return [];
  let a = s;
  if (typeof s === 'string') { try { a = JSON.parse(s); } catch (e) { a = []; } }
  if (!Array.isArray(a)) return [];
  return a.filter(function (x) { return x && x.d && x.n; }).map(function (x) {
    return { n: x.n, t: x.t || mimeOf(x.n), s: +x.s || 0, d: x.d, img: isImg(x.t || mimeOf(x.n)), sizeText: fmtSize(x.s) };
  });
}
function readBase64(path) {
  return new Promise(function (resolve, reject) {
    wx.getFileSystemManager().readFile({ filePath: path, encoding: 'base64', success: function (r) { resolve(r.data); }, fail: reject });
  });
}
function writeTemp(a) {
  return new Promise(function (resolve, reject) {
    const ext = extOf(a.n) || 'bin';
    const path = wx.env.USER_DATA_PATH + '/att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.' + ext;
    wx.getFileSystemManager().writeFile({ filePath: path, data: a.d, encoding: 'base64', success: function () { resolve(path); }, fail: reject });
  });
}
function compressImage(path, quality) {
  return new Promise(function (resolve) {
    if (!wx.compressImage) { resolve(path); return; }
    wx.compressImage({
      src: path, quality: quality,
      success: function (r) { resolve(r.tempFilePath || path); },
      fail: function () { resolve(path); }
    });
  });
}
function emptyForm() { return { subject: '', content: '', due: '', date: '', time: '', author: '' }; }
const PERIODS = [
  ['08:10', '08:55'], ['08:55', '09:40'], ['09:50', '10:30'], ['10:40', '11:25'],
  ['11:25', '12:10'], ['14:30', '15:15'], ['15:15', '16:00'], ['16:10', '16:55'],
  ['16:55', '17:40'], ['19:00', '19:45'], ['19:45', '20:30'], ['20:30', '21:20']
];
function pad2(n) { return ('0' + n).slice(-2); }
function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function hhmm(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function weekAt(termStart, date) {
  if (!termStart) return null;
  const a = util.toDate(termStart);
  if (!a) return null;
  const x = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const y = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const w = Math.floor((y - x) / 604800000) + 1;
  return w > 0 ? w : null;
}
function courseOn(c, date, termStart) {
  const w = weekAt(termStart, date);
  if (w && c.weeks) {
    const ws = util.parseWeeks(c.weeks);
    if (ws.length && ws.indexOf(w) < 0) return false;
  }
  if (w && c.parity === 'odd' && w % 2 === 0) return false;
  if (w && c.parity === 'even' && w % 2 === 1) return false;
  return true;
}
function dueOf(h) { return util.hwDue(h); }
function isDone(d, h) {
  if (h.id) return !!(d.hwDone && d.hwDone[h.id]);
  return !!h.done;
}
function isHidden(d, h) { return h.id ? !!(d.hwHide && d.hwHide[h.id]) : false; }

Page(shareflow.install({
  data: {
    state: 'loading',
    errorText: '',
    tab: 'open',                  // open | done
    nick: '', open: [], done: [], hiddenN: 0,
    sheet: false, form: emptyForm(), attachList: [], attachCount: 0, attMax: ATT_PICK_FILE, attN: ATT_N,
    nextClass: null, today: '',
    remindSheet: false, remindFor: null, remindDate: '', remindClock: '',
    remindDueText: '', remindStart: '', remindEnd: '',
    cloudEnabled: false,
    syncText: '',
    scrolled: false,
    segs: []
  },

  onLoad(options) {
    scrollmem.attach(this);
    options = options || {};
    this._agent = agent.pick(this);            // AI 页面接力（wx.onAgentHandoff），只消费一次
    this._agentQ = agent.pickQuery(options);   // 备用：handoff query 随页面参数传入
    this._first = true;
    this.setData({ today: util.todayStr() });
  },
  onShow() {
    share.enable();
    scrollmem.restore(this);
    if (!identity.ensure()) return;
    try { store.reload(); } catch (e) { /* ignore */ }
    this.applyAgentHandoff();
    if (this._first) {
      this._first = false;
      // 需求 9（2026-11-11）：本机有作业缓存 → 首帧直接渲染（去掉首屏 140ms 骨架延迟）；
      // 无缓存时才先出骨架。
      if (this._hasLocalHw()) {
        this.refresh();
        this.cloudSync();
        this.marksSync();
      } else {
        this.setData({ state: 'loading' });
        this._t = setTimeout(() => { this._t = null; this.refresh(); this.cloudSync(); this.marksSync(); }, 140);
      }
    } else {
      this.refresh();
      this.cloudSync();
      this.marksSync();
    }
  },
  // 本机是否有可立即渲染的作业缓存（有则首帧直接 data，不等骨架）
  _hasLocalHw() {
    try { const d = store.get(); return Array.isArray(d.homework) && d.homework.length > 0; } catch (e) { return false; }
  },
  onHide() {
    scrollmem.save(this); if (this._t) { clearTimeout(this._t); this._t = null; } },
  onUnload() {
    scrollmem.save(this); if (this._t) { clearTimeout(this._t); this._t = null; } },
  onPullDownRefresh() {
    this.refresh();
    this.cloudSync(true);
    this.marksSync();
    wx.stopPullDownRefresh();
  },
  onCloudSync() { this.refresh(); this.marksSync(); },
  // 需求 16：进页 / 下拉刷新 / 收到云端同步通知时强制拉一次 marks（绕过 2min TTL），
  // 拿到最新的「已完成」状态后立即重绘列表；离线时静默保留本机状态。
  marksSync() {
    if (!identity.has() || !cloud.isEnabled()) return;
    cloud.marksPull(true).then(() => { try { store.reload(); } catch (e) { /* ignore */ } this.refresh(); })
      .catch(function () { /* 离线保留本机状态 */ });
  },

  // —— AI 页面接力：先按 handoff 切 tab / 定位到指定作业，再走原有 cloudSync 后台刷新 ——
  // 不做任何阻塞弹窗/蒙层；页面守卫（identity.ensure）照常先执行。
  applyAgentHandoff() {
    if (this._agentApplied) return false;
    this._agentApplied = true;
    const h = this._agent;
    const p = (h && h.payload) || {};
    const q = Object.assign({}, this._agentQ || {}, (h && h.query) || {});
    if (!h && !this._agentQ) return false;
    const tab = String(q.tab || p.tab || '');
    if (tab === 'done') this.setData({ tab: 'done' });
    else if (tab === 'pending' || tab === 'all') this.setData({ tab: 'open' });
    const id = String(q.id || p.homeworkId || p.id || (Array.isArray(p.ids) && p.ids[0] ? p.ids[0] : '') || '');
    if (id) this._hoId = id;              // 等 refresh 出数据后在 setData 回调里滚动定位
    return true;
  },
  // 定位到某条作业：切换对应分段并滚动到它（节点 id 见 hw.wxml 的 hw-{{item.id}}）
  _scrollToFocus(id) {
    if (!id) return;
    const open = this.data.open || [];
    const done = this.data.done || [];
    const hitOpen = open.some(function (x) { return String(x.id || '') === id; });
    const hitDone = done.some(function (x) { return String(x.id || '') === id; });
    if (!hitOpen && !hitDone) return;     // 数据还没同步到：保留 _hoId，下一次 refresh 再试
    if (!hitOpen && hitDone) this.setData({ tab: 'done', hoFocus: id });
    else this.setData({ tab: 'open', hoFocus: id });
    scrollmem.cancel(this);
    try {
      wx.pageScrollTo({ selector: '#hw-' + id, duration: 240, offsetTop: -120 });
    } catch (e) { /* 旧基础库不支持 selector：仅高亮 */ }
    this._hoId = '';
  },

  // 进入页面 / 下拉刷新时自动拉一次云端（未配置时零请求、零报错）
  cloudSync(force) {
    if (!cloud.isEnabled() || this._pulling) return;
    this._pulling = true;
    cloud.cloudPull(!!force).then(() => { this._pulling = false; this.refresh(); }).catch(() => { this._pulling = false; });
  },
  syncMark(hw, val) {
    if (!identity.has() || !hw || !hw.id) return;
    cloud.setMark('hw', hw.id, val).then((ok) => {
      if (!ok && cloud.isEnabled()) util.toast('同步失败，稍后自动重试');
      this.refresh();
    });
  },

  refresh() {
    try {
      cloud.pruneHomework();
      const d = store.get();
      const all = (d.homework || []).slice();
      const open = [], done = [];
      let hiddenN = 0;
      all.forEach(function (h) {
        if (isHidden(d, h)) { hiddenN += 1; return; }
        const item = Object.assign({}, h, { dueInfo: util.dueInfo(h), done: isDone(d, h) });
        item.tagCls = TAG[item.dueInfo.cls] || 'muted';
        item.canDelete = cloud.canDelete(h);
        item.actions = [{ id: 'del', label: item.canDelete ? '删除' : '隐藏', type: 'error' }];
        item.atts = parseAtt(h.attachments); item.attCount = item.atts.length;
        item.dateText = h.date ? (h.date + (h.time ? ' ' + h.time : ' 00:00')) : '';
        const rk = h.id || ('ts' + h.ts);
        const rm = (d.hwRemind || {})[rk];
        item.remindText = rm && rm.fireAt && rm.fireAt > Date.now() ? (rm.label || '已设置') : '';
        (item.done ? done : open).push(item);
      });
      open.sort(function (a, b) {
        const x = dueOf(a), y = dueOf(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return x - y;
      });
      done.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
      this.setData({
        state: 'data',
        errorText: '',
        nick: identity.name(),
        open: open, done: done, hiddenN: hiddenN,
        cloudEnabled: cloud.isEnabled(),
        syncText: cloud.syncText(),
        segs: [
          { id: 'open', label: '未完成 ' + open.length },
          { id: 'done', label: '已完成 ' + done.length }
        ]
      }, () => { this._scrollToFocus(this._hoId); });
    } catch (e) {
      this.setData({ state: 'error', errorText: '读取作业失败：' + ((e && e.message) || e) });
    }
  },

  // —— v3：顶栏收缩 + 分段过滤 ——
  onPageScroll(e) {
    scrollmem.onScroll(this, e);
    const y = e.scrollTop;
    const next = y > 64 ? true : (y < 20 ? false : this.data.scrolled);
    if (next !== this.data.scrolled && !this._scBusy) {
      this._scBusy = true;
      this.setData({ scrolled: next }, () => { this._scBusy = false; });
    }
  },
  onSeg(e) { this.setData({ tab: e.detail.value }); },

  setTab(e) { this.setData({ tab: e.currentTarget.dataset.v }); },

  openSheet() {
    this.setData({ sheet: true, form: emptyForm(), attachList: [], attachCount: 0, nextClass: null, today: util.todayStr() });
  },
  closeSheet() { this.setData({ sheet: false }); },
  noop() { /* 遮罩 catchtouchmove */ },
  onInput(e) {
    const k = e.currentTarget.dataset.k;
    const f = Object.assign({}, this.data.form);
    f[k] = e.detail.value;
    this.setData({ form: f }, () => { if (k === 'subject') this.syncNextClass(); });
  },
  onDate(e) {
    const f = Object.assign({}, this.data.form);
    f.date = e.detail.value;
    this.setData({ form: f }, () => this.syncNextClass());
  },
  onTime(e) {
    const f = Object.assign({}, this.data.form);
    f.time = e.detail.value;
    if (!f.date) f.date = util.todayStr();
    this.setData({ form: f });
  },
  clearTime() {
    const f = Object.assign({}, this.data.form);
    f.time = '';
    this.setData({ form: f });
  },

  // 根据科目匹配课表，找出下一节该课程的上课时间
  syncNextClass() {
    const subject = String(this.data.form.subject || '').trim();
    if (!subject) { if (this.data.nextClass) this.setData({ nextClass: null }); return; }
    const d = store.get();
    const all = d.course || [];
    const norm = subject.toLowerCase();
    let list = all.filter(function (c) { return String(c.name || '').trim().toLowerCase() === norm; });
    if (!list.length) list = all.filter(function (c) {
      const n = String(c.name || '').trim().toLowerCase();
      return n && (n.indexOf(norm) >= 0 || norm.indexOf(n) >= 0);
    });
    if (!list.length) { if (this.data.nextClass) this.setData({ nextClass: null }); return; }
    const now = Date.now();
    let best = null;
    for (let i = 0; i < 28; i++) {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() + i);
      const di = (day.getDay() + 6) % 7;
      list.forEach(function (c) {
        if (+c.day !== di) return;
        const p = PERIODS[+c.start - 1];
        if (!p) return;
        if (!courseOn(c, day, d.termStart)) return;
        const hm = p[0].split(':');
        const ts = new Date(day.getFullYear(), day.getMonth(), day.getDate(), +hm[0], +hm[1], 0, 0).getTime();
        if (ts <= now + 60000) return;
        if (!best || ts < best.ts) {
          best = { name: c.name, date: ymd(day), time: p[0], ts: ts, period: +c.start, room: c.room || '' };
        }
      });
      if (best) break;
    }
    this.setData({ nextClass: best });
  },
  useNextClass() {
    const n = this.data.nextClass;
    if (!n) return;
    const f = Object.assign({}, this.data.form);
    f.date = n.date;
    f.time = n.time;
    if (!String(f.due || '').trim()) f.due = '下节课前';
    this.setData({ form: f });
    util.toast('已设为 ' + n.date + ' ' + n.time);
  },

  nickOf() {
    const v = String(this.data.nick || '').trim();
    return v || identity.name();
  },

  add() {
    const f = this.data.form;
    if (!String(f.content || '').trim()) { util.toast('填写作业内容'); return; }
    const d = store.get();
    const it = {
      subject: String(f.subject || '').trim(),
      content: String(f.content || '').trim(),
      due: String(f.due || '').trim(),
      date: f.date || '',
      time: f.date ? (f.time || '') : '',
      author: String(f.author || '').trim() || this.nickOf(),
      attachments: this.data.attachList.length ? JSON.stringify(this.data.attachList) : '',
      done: false,
      ts: Date.now()
    };
    const due = dueOf(it);
    if (it.date && due == null) { util.toast('截止时间格式不正确'); return; }
    if (due != null && due <= Date.now()) { util.toast('截止时间已过，请调整日期或时间'); return; }
    d.homework.push(it);
    store.save();
    this.setData({ sheet: false, form: emptyForm(), attachList: [], attachCount: 0, nextClass: null });
    this.refresh();
    wx.showToast({ title: '已添加作业', icon: 'success', duration: 900 });
    cloud.hwPublish(it).then((ok) => {
      if (!ok && cloud.isEnabled()) util.toast('已存本机，稍后自动补发');
      this.refresh();
    });
  },

  // —— 附件：图片（≤5MB 原图，自动压缩）/ 文件（≤2MB），最多 2 个 ——
  chooseImages() {
    if (!wx.chooseMedia) { util.toast('当前微信版本不支持选择图片'); return; }
    const left = ATT_N - this.data.attachList.length;
    if (left <= 0) { util.toast('最多 ' + ATT_N + ' 个附件'); return; }
    wx.chooseMedia({
      count: left, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (res) => {
        const list = (res.tempFiles || []).map(function (f, i) {
          const p = f.tempFilePath || '';
          const m = p.match(/\.([a-z0-9]+)$/i);
          return { path: p, size: f.size, name: '图片' + (i + 1) + '.' + (m ? m[1] : 'jpg'), image: true };
        });
        this.loadFiles(list);
      }
    });
  },
  chooseFiles() {
    if (!wx.chooseMessageFile) { util.toast('当前微信版本不支持选择文件'); return; }
    const left = ATT_N - this.data.attachList.length;
    if (left <= 0) { util.toast('最多 ' + ATT_N + ' 个附件'); return; }
    wx.chooseMessageFile({
      count: left, type: 'all',
      success: (res) => {
        const list = (res.tempFiles || []).map(function (f) { return { path: f.path, size: f.size, name: f.name, image: false }; });
        this.loadFiles(list);
      }
    });
  },
  loadFiles(list) {
    const ok = [], bad = [];
    (list || []).forEach(function (f) {
      const limit = f.image ? ATT_PICK_IMAGE : ATT_PICK_FILE;
      (Number(f.size) > limit ? bad : ok).push(f);
    });
    if (bad.length) util.toast(bad[0].image ? '图片原图不能超过 5MB' : '文件不能超过 2MB');
    if (!ok.length) return;
    Promise.all(ok.map((f) => {
      const prep = f.image ? compressImage(f.path, 70) : Promise.resolve(f.path);
      return prep.then((path) => readBase64(path)).then((d) => {
        if (d.length <= ATT_STORE) return d;
        if (!f.image) return null;
        return compressImage(f.path, 40).then((p2) => readBase64(p2)).then((d2) => d2.length <= ATT_STORE ? d2 : null);
      }).then((d) => {
        if (!d) return null;
        const t = f.image ? 'image/jpeg' : mimeOf(f.name);
        const n = f.image ? f.name.replace(/\.[^.]+$/, '') + '.jpg' : f.name;
        return { n: n, t: t, s: Math.round(d.length * 0.75), d: d, img: f.image, sizeText: fmtSize(Math.round(d.length * 0.75)) };
      });
    })).then((arr) => {
      const list = arr.filter(Boolean);
      if (!list.length) { util.toast('附件太大，压缩后仍超过限制'); return; }
      const used = this.data.attachList.reduce(function (n, a) { return n + String(a.d || '').length; }, 0);
      const add = list.reduce(function (n, a) { return n + a.d.length; }, 0);
      if (used + add > 4.2 * 1024 * 1024) { util.toast('附件总大小过大，请减少一个'); return; }
      const next = this.data.attachList.concat(list).slice(0, ATT_N);
      this.setData({ attachList: next, attachCount: next.length });
    }).catch(() => util.toast('读取附件失败'));
  },
  removeFile(e) {
    const i = +e.currentTarget.dataset.i;
    const arr = this.data.attachList.slice();
    arr.splice(i, 1);
    this.setData({ attachList: arr, attachCount: arr.length });
  },
  previewAtt(e) {
    const ds = e.currentTarget.dataset;
    const list = ds.list, i = +ds.i, j = +ds.j;
    let a = null;
    if (list === 'files') a = this.data.attachList[j];
    else { const it = this.data[list] && this.data[list][i]; a = it && it.atts && it.atts[j]; }
    if (!a) return;
    wx.showLoading({ title: '打开中', mask: true });
    writeTemp(a).then((path) => {
      wx.hideLoading();
      if (a.img) wx.previewImage({ urls: [path], current: path });
      else wx.openDocument({
        filePath: path, showMenu: true,
        fail: () => {
          if (wx.shareFileMessage) wx.shareFileMessage({ filePath: path, fileName: a.n, fail: () => util.toast('该文件暂不支持预览') });
          else util.toast('该文件暂不支持预览');
        }
      });
    }).catch(() => { wx.hideLoading(); util.toast('打开失败'); });
  },

  remind(e) {
    const it = this.data.open[+e.currentTarget.dataset.index];
    if (!it) return;
    const due = dueOf(it);
    if (due == null) { util.toast('这条作业没有截止日期'); return; }
    if (due <= Date.now()) { util.toast('截止时间已过'); return; }
    const minAt = Date.now() + 60000;
    const opts = [];
    if (due - 86400000 > minAt) opts.push({ label: '截止前 1 天', at: due - 86400000 });
    if (due - 7200000 > minAt) opts.push({ label: '截止前 2 小时', at: due - 7200000 });
    if (!opts.length) { this.customRemind(it); return; }
    opts.push({ label: '自定义时间', at: 0 });
    wx.showActionSheet({
      itemList: opts.map(function (o) { return o.label; }),
      success: (r) => {
        const o = opts[r.tapIndex];
        if (!o || !o.at) this.customRemind(it);
        else this.doRemind(it, o.at, o.label);
      }
    });
  },
  customRemind(it) {
    const due = dueOf(it);
    if (due == null || due <= Date.now()) { util.toast('截止时间已过'); return; }
    let suggest = due - 7200000;
    if (suggest <= Date.now() + 60000) suggest = due - 60000;
    if (suggest <= Date.now() + 60000) { util.toast('距离截止太近，无法设置提醒'); return; }
    this.setData({
      remindSheet: true, remindFor: it,
      remindDate: ymd(new Date(suggest)), remindClock: hhmm(new Date(suggest)),
      remindDueText: '截止 ' + it.date + ' ' + (it.time || '00:00'),
      remindStart: util.todayStr(), remindEnd: it.date
    });
  },
  closeRemind() { this.setData({ remindSheet: false, remindFor: null }); },
  onRemindDate(e) { this.setData({ remindDate: e.detail.value }); },
  onRemindClock(e) { this.setData({ remindClock: e.detail.value }); },
  confirmRemind() {
    const it = this.data.remindFor;
    const date = this.data.remindDate, clock = this.data.remindClock;
    if (!it || !date || !clock) { util.toast('选择提醒日期和时间'); return; }
    const d = util.toDate(date);
    if (!d) { util.toast('提醒日期无效'); return; }
    const hm = clock.split(':');
    d.setHours(+hm[0], +hm[1], 0, 0);
    const fireAt = d.getTime();
    const due = dueOf(it);
    if (due == null) { util.toast('截止时间无效'); return; }
    if (fireAt <= Date.now() + 60000) { util.toast('提醒时间至少晚于现在 1 分钟'); return; }
    if (fireAt > due) { util.toast('提醒时间不能晚于截止时间'); return; }
    this.setData({ remindSheet: false, remindFor: null });
    this.doRemind(it, fireAt, '自定义');
  },
  doRemind(it, fireAt, label) {
    const due = dueOf(it);
    if (due == null || due <= Date.now()) { util.toast('截止时间已过'); return; }
    if (fireAt <= Date.now() + 60000) { util.toast('提醒时间至少晚于现在 1 分钟'); return; }
    if (fireAt > due) { util.toast('提醒时间不能晚于截止时间'); return; }
    notify.subscribeHomework(it, fireAt, label).then(() => {
      const d = store.get();
      d.hwRemind = d.hwRemind || {};
      d.hwRemind[it.id || ('ts' + it.ts)] = { fireAt: fireAt, label: label };
      store.save();
      this.refresh();
      util.toast('已订阅提醒');
    }).catch((err) => {
      const m = String((err && err.message) || err);
      if (m === 'denied') util.toast('未授权提醒');
      else if (m === 'unsupported') util.toast('当前微信版本不支持订阅消息');
      else util.toast('提醒服务未配置或未联网');
    });
  },

  toggle(e) {
    const it = this.data.open[+e.currentTarget.dataset.index];
    if (!it) return;
    const d = store.get();
    const target = d.homework.filter(function (h) { return (h.ts || 0) === (it.ts || 0) && h.content === it.content; })[0];
    if (!target) return;
    if (target.id) { d.hwDone = d.hwDone || {}; d.hwDone[target.id] = true; }
    else target.done = true;
    store.save();
    this.refresh();
    this.syncMark(target, true);
  },

  untoggle(e) {
    const it = this.data.done[+e.currentTarget.dataset.index];
    if (!it) return;
    const d = store.get();
    const target = d.homework.filter(function (h) { return (h.ts || 0) === (it.ts || 0) && h.content === it.content; })[0];
    if (!target) return;
    if (target.id) { d.hwDone = d.hwDone || {}; delete d.hwDone[target.id]; }
    else target.done = false;
    store.save();
    this.refresh();
    this.syncMark(target, false);
  },

  removeAt(listName, i) {
    const it = this.data[listName][i];
    if (!it) return;
    const mine = cloud.canDelete(it);
    wx.showModal({
      title: mine ? '删除作业' : '隐藏作业',
      content: mine ? ('确认删除「' + (it.subject ? '【' + it.subject + '】' : '') + it.content + '」？删除后所有人都看不到。')
        : '仅从你的列表中隐藏这条作业，其他人和发布者不受影响。',
      confirmText: mine ? '删除' : '隐藏',
      confirmColor: '#A2543E',
      success: (r) => {
        if (!r.confirm) return;
        const d = store.get();
        const idx = d.homework.findIndex(function (h) { return (h.ts || 0) === (it.ts || 0) && h.content === it.content; });
        if (idx < 0) return;
        if (!mine) {
          if (it.id) { d.hwHide = d.hwHide || {}; d.hwHide[it.id] = true; }
          else d.homework.splice(idx, 1);
        } else if (d.homework[idx].id) {
          const id = d.homework[idx].id;
          d.homework.splice(idx, 1);
          cloud.hwArchive(id);
        } else {
          d.homework.splice(idx, 1);
        }
        store.save();
        this.refresh();
      }
    });
  },
  delOpen(e) { this.removeAt('open', +e.detail.index); },
  delDone(e) { this.removeAt('done', +e.detail.index); },

  pullCloud() {
    if (!cloud.isEnabled()) { util.toast('当前未联网，显示本机数据'); return; }
    wx.showLoading({ title: '同步中', mask: true });
    cloud.hwPull(true).then((rows) => {
      wx.hideLoading();
      if (!rows) { util.toast('云端没有返回数据'); return; }
      const d = store.get();
      const localIds = {};
      (d.homework || []).forEach(function (h) { if (h.id) localIds[h.id] = true; });
      let added = 0;
      rows.forEach(function (r) { if (r && r.id && !localIds[r.id]) { d.homework.push(r); added += 1; } });
      store.save();
      this.refresh();
      util.toast('已同步 ' + added + ' 条');
    }).catch(function () { wx.hideLoading(); util.toast('同步失败'); });
  },

  _sharePosterOpt() {
    const d = store.get();
    if (!(d.homework || []).length) return null;
    const blocks = [];
    if (this.data.open.length) {
      blocks.push({
        label: '未完成（' + this.data.open.length + '）',
        lines: this.data.open.map(function (h) {
          return (h.subject ? '【' + h.subject + '】' : '') + h.content + '  —— ' + h.dueInfo.txt;
        })
      });
    }
    if (this.data.done.length) {
      blocks.push({
        label: '已完成（' + this.data.done.length + '）',
        lines: this.data.done.map(function (h) { return '✓ ' + (h.subject ? '【' + h.subject + '】' : '') + h.content; })
      });
    }
    return {
      title: '作业板',
      sub: this.data.nick ? ('@' + this.data.nick) : '',
      config: [
        ['未完成', String(this.data.open.length)],
        ['已完成', String(this.data.done.length)],
        ['署名', this.data.nick || identity.name()]
      ],
      blocks: blocks,
      foot: '生成时间 ' + util.timeStr(),
      rec: util.recId('HW')
    };
  },
  exportImg() {
    const d = store.get();
    if (!(d.homework || []).length) { util.toast('作业板是空的'); return; }
    canvas.exportAndSave(this, '#card', this._sharePosterOpt());
  },
  _shareOpenOpts() {
    if (!(this.data.open.length || this.data.done.length)) { util.toast('作业板是空的'); return null; }
    return {
      title: '班级作业板 · 未完成 ' + this.data.open.length + ' 条',
      view: sharecard.buildHwView({
        open: this.data.open, done: this.data.done, nick: this.data.nick, time: util.timeStr()
      }),
      posterOpt: this._sharePosterOpt()
    };
  },
  openShare() { shareflow.open(this, this._shareOpenOpts()); },
  closeShare() { shareflow.close(this); },
  shareImage() { shareflow.shareImage(this); },
  onShareAppMessage() {
    return share.message({
      title: '班级作业板 · 未完成 ' + this.data.open.length + ' 条 · 已完成 ' + this.data.done.length + ' 条',
      path: '/pages/hw/hw',
      imageUrl: this.data.shareImg || sharecard.FALLBACK.hw
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '班级作业板 · 未完成 ' + this.data.open.length + ' 条 · 已完成 ' + this.data.done.length + ' 条',
      imageUrl: this.data.shareImg || sharecard.FALLBACK.hw
    });
  }
}));
