// pages/index/index.js —— 工作台（v1.3.2 信息架构重设计：今日课程 + 待办 + 常用工具）
//
// 首页只负责「今天要做什么」：
//   · 今日课程时间线（本次/下一次课；没有课表缓存时自动拉一次 tt.json）
//   · 待办：作业待交、通知待处理（各显示数量 + 最近/最紧一条）
//   · 常用工具：用户在「工具」页主动勾选的工具（≤4，顺序 = 勾选顺序；2026-11-06 起不再自动取前 4 个），
//     无勾选时显示引导空态「尚未勾选常用工具」→ 去工具页勾选
// 统计总览 / 云同步详情 / 数据与隐私 / 完整工具清单已分别归到「我的」与「工具」页，首页不再重复。
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');
const identity = require('../../utils/identity.js');
const cloud = require('../../utils/cloud.js');
const tools = require('../../utils/tools.js');
const ttplan = require('../../utils/ttplan.js');
const notice = require('../../utils/notice.js');
const share = require('../../utils/share.js');
const agent = require('../../utils/agent.js');
const scrollmem = require('../../utils/scrollmem.js');
const power = require('../../utils/power.js');
const task = require('../../utils/task.js');

const QUICK_N = 4;          // 首页常用工具最多 4 个（用户勾选；在「工具」页长按拖动排序 / 右侧勾选）
const NT_TTL = 60000;       // 通知组缓存 60s（切 tab 回来不重复请求）
// 需求 11：两卡「最新一条」轮换 —— 每 5s 上浮淡出 → 下浮淡入；≤1 条不轮换；页面隐藏暂停。
const ROT_MS = 5000;        // 轮换间隔
const ROT_OUT = 260;        // 上浮淡出时长（与 index.wxss 的 .wb-rot--out 一致）
const ROT_IN = 320;         // 下浮淡入时长（与 index.wxss 的 .wb-rot--in 一致）

// 模块级缓存：tab 页实例常驻，切回来先用缓存再后台刷新
let _ntGroups = null;
let _ntAt = 0;
let _ntPulling = false;
let _ttTried = false;

function courseCardState(source, now) {
  const today = ttplan.plan(source.courses, source.term, now);
  const hr = now.getHours();
  return {
    today: today,
    weekText: today.week ? ('第 ' + today.week + ' 周') : '',
    dateText: now.getFullYear() + '-' + util.pad(now.getMonth() + 1) + '-' + util.pad(now.getDate()),
    hello: hr < 6 ? '夜深了' : (hr < 11 ? '早上好' : (hr < 14 ? '中午好' : (hr < 18 ? '下午好' : '晚上好')))
  };
}

function hwOpenItems(d) {
  const list = task.pendingHomework(d);
  list.sort(function (a, b) {
    const x = util.hwDue(a), y = util.hwDue(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return x - y;
  });
  return list;
}

function shortTitle(h) {
  const s = String((h && (h.subject || h.content)) || '').trim();
  return s.length > 18 ? s.slice(0, 18) + '…' : s;
}

// 需求 11 + 契约 2026-11-14 §2.4 + 2026-11-18 §5：通知卡轮换用的「待处理」列表（与 utils/notice.statOf 同口径）
//   · 资料兜底卡（longtermSubtypeOf='info'：无锚点且无发布时间，正常 0 条）不计；长期安排定义卡不计；
//   · 发布卡（无真实时间锚点但有发布时间）计入，主显示时间为空 → 排最后；
//   · 长期安排的期次（窗口内、未处理，ref=<gid>@occ:<YYYYMMDD>）计入，按 next 参与排序；
//   · 已过期 / actionable=false / 已处理 不计。
function ntOpenItems(groups, done, nowArg) {
  const now = (nowArg == null || isNaN(Number(nowArg))) ? Date.now() : Number(nowArg);
  const out = [];
  (groups || []).forEach(function (g) {
    if (!g) return;
    const st = notice.statusOf(g, now);
    if (st.expired) return;
    if (notice.isActionable(g) === false) return;
    const rec = notice.recurOf(g);
    if (rec) {
      const occ = notice.isRecurEnded(g, now) ? null : notice.occOf(g, now);
      if (!occ || (done && done[occ.key])) return;
      out.push({ title: String(g.title || '班级通知'), sub: occ.label, ts: occ.next, alert: !!g.alert });
      return;
    }
    if (notice.isLongterm(g, now)) return;             // 资料兜底卡（无锚点且无发布时间）：不占待办
    if (done && done[g.id]) return;
    // 契约 2026-11-18 §5：发布卡视为有时间锚点（主显示时间为空 → 轮换排序排最后）
    if (!notice.hasTimeAnchor(g) && notice.publishedTsOf(g, now) == null) return;
    const w = notice.whenInfo(g, now);
    out.push({ title: String(g.title || '班级通知'), sub: st.label || '', ts: w ? w.ts : null, alert: !!g.alert });
  });
  out.sort(function (a, b) {
    const aa = a.alert ? 1 : 0, ba = b.alert ? 1 : 0;
    if (aa !== ba) return ba - aa;
    if (a.ts == null && b.ts == null) return 0;
    if (a.ts == null) return 1;
    if (b.ts == null) return -1;
    return a.ts - b.ts;
  });
  return out.map(function (x) { return { title: x.title, sub: x.sub }; });
}
// 需求 11：卡片文案视图（轮换只改 title/sub/idx/anim 这几个字段）
function cardViewOf(items) {
  const first = items[0] || { title: '', sub: '' };
  return { items: items, idx: 0, title: first.title, sub: first.sub, anim: '' };
}
// 版本号比较（低版本降级判断用）
function verAtLeast(a, b) {
  const pa = String(a || '0').split('.'), pb = String(b || '0').split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = parseInt(pa[i], 10) || 0, nb = parseInt(pb[i], 10) || 0;
    if (na !== nb) return na > nb;
  }
  return true;
}

Page({
  data: {
    state: 'loading',       // loading | error | data
    errorText: '',
    hello: '',
    dateText: '',
    weekText: '',
    identity: null,
    quick: [],
    quickEmpty: false,      // true = 用户没有勾选任何首页工具 → 「常用工具」区域显示引导空态
    today: null,            // utils/ttplan.plan() 的结果
    hw: { open: 0, items: [], idx: 0, title: '', sub: '', anim: '' },
    task: { open: 0, myday: 0, important: 0, title: '', sub: '' },
    nt: { state: 'syncing', pending: 0, items: [], idx: 0, title: '', sub: '', anim: '' },
    // 关注宿舍电费卡片（v2.0.0）：未选择时只做引导、0 请求；选择后读 store.power + power 行
    powerCard: { has: false, sel: '', label: '', qText: '—', unit: '度', stateKey: 'idle', stateText: '未选择', updText: '', loading: false }
  },

  onLoad(options) {
    scrollmem.attach(this);
    options = options || {};
    this._agent = agent.pick(this);            // AI 页面接力（wx.onAgentHandoff），只消费一次
    this._agentQ = agent.pickQuery(options);   // 备用：handoff query 随页面参数传入
    this._first = true;
  },

  onShow() {
    share.enable();
    scrollmem.restore(this);
    if (!identity.ensure()) return;
    this._hidden = false;
    this.scheduleCourseClock();
    try { store.reload(); } catch (e) { /* ignore */ }
    try { task.resetCache(); task.boot(); task.pull().then(() => { if (!this._hidden) this.refresh(); }).catch(function () {}); } catch (e) { /* ignore */ }
    this.applyAgentHandoff();
    if (this._first) {
      this._first = false;
      // 需求 9（2026-11-11）：本机有缓存 → 首帧直接渲染（不再等 120ms 骨架延迟）；
      // 无任何本机数据时才先出骨架，避免空状态闪烁。
      if (this._hasLocalData()) {
        this.refresh();
      } else {
        this.setData({ state: 'loading' });
        this._t = setTimeout(() => { this._t = null; this.refresh(); }, 120);  // 让骨架屏可见
      }
    } else {
      this.refresh();
    }
    this.loadPowerCard();
    // 需求 16：进页强制拉一次 marks（绕过 2min TTL）→ 作业完成 / 通知已处理计数立即刷新
    if (identity.has() && cloud.isEnabled()) {
      cloud.marksPull(true).then(() => { _ntAt = 0; this.refresh(); }).catch(function () { /* 离线保留本机状态 */ });
    }
  },
  // 本机是否有可立即渲染的工作台缓存（作业/通知缓存/课表/勾选状态任一即可）
  _hasLocalData() {
    try {
      const d = store.get();
      if (Array.isArray(d.homework) && d.homework.length) return true;
      if (ttplan.localSource(d).courses.length) return true;
      if (d.ntDone && Object.keys(d.ntDone).length) return true;
      if (d.classMembers && d.classMembers.length) return true;
      if (d.task && ((d.task.items && d.task.items.length) || (d.task.lists && d.task.lists.length))) return true;
    } catch (e) { /* ignore */ }
    return false;
  },
  onHide() {
    this._hidden = true;
    this._rotStop();
    try { task.flush(); } catch (e) { /* ignore */ }
    scrollmem.save(this); this.clearTimer(); },
  onUnload() {
    this._hidden = true;
    this._rotStop();
    try { task.flush(); } catch (e) { /* ignore */ }
    scrollmem.save(this); this.clearTimer(); },
  clearTimer() {
    clearTimeout(this._t);
    clearTimeout(this._courseTimer);
    this._t = null;
  },

  scheduleCourseClock() {
    clearTimeout(this._courseTimer);
    this._courseTimer = setTimeout(() => {
      if (this._hidden) return;
      const fields = courseCardState(ttplan.localSource(store.get()), new Date());
      const patch = util.diffPatch(this.data, fields);
      if (patch) this.setData(patch);
      this.scheduleCourseClock();
    }, 60000 - Date.now() % 60000);
  },

  onPullDownRefresh() {
    this.pullTT(true);
    this.pullNotices(true);
    task.pull(true).then(() => this.refresh()).catch(function () {});
    this.refresh();
    this.loadPowerCard(true);
    wx.stopPullDownRefresh();
  },

  // 重绘：本机数据（课表缓存 / 作业 / 身份）+ 通知缓存
  refresh() {
    try {
      cloud.pruneHomework();
      const d = store.get();
      const now = new Date();
      const id = identity.get();
      // —— 待办任务 = 个人任务 + 班级作业（任务工具接管原作业卡槽位）——
      const tc = task.counts();
      const taskOpenAll = task.viewItems('all', '', '', 'due');
      const open = hwOpenItems(d);
      const merged = [];
      open.forEach(function (h) {
        const di = util.dueInfo(h);
        merged.push({ title: shortTitle(h), sub: di && di.txt ? di.txt : '', due: util.hwDue(h), order: 0, kind: 'hw' });
      });
      taskOpenAll.forEach(function (t) {
        merged.push({
          title: shortTitle({ content: t.title }), sub: task.dueText(t),
          due: task.dueMs(t), order: Number(t.order) || 0, kind: 'task'
        });
      });
      merged.sort(function (a, b) {
        if (a.due == null && b.due == null) return (a.order || 0) - (b.order || 0);
        if (a.due == null) return 1;
        if (b.due == null) return -1;
        return a.due - b.due;
      });
      const hwItems = merged.slice(0, 5).map(function (x) { return { title: x.title, sub: x.sub }; });
      const hwView = cardViewOf(hwItems);

      // —— 今日课程 / 下一次课 ——
      const source = ttplan.localSource(d);
      const courseFields = courseCardState(source, now);
      const quick = tools.quickList(QUICK_N);   // 用户勾选的首页工具（≤4；无勾选时为空 → 引导空态；投票仅班委可见）
      const state = {
        state: 'data',
        errorText: '',
        identity: id ? {
          name: id.name,
          role: id.role || '',
          isAdmin: !!id.is_admin
        } : null,
        quick: quick,
        quickEmpty: quick.length === 0,
        ...courseFields,
        hw: Object.assign({ open: merged.length }, hwView),
        task: { open: tc.all, hwOpen: open.length, myday: tc.myday, important: tc.important }
      };
      // 需求 9：只把变化的顶层字段 setData（避免每次 onShow 整页重渲染；首次 state 不同 → 全量下发）
      const patch = util.diffPatch(this.data, state);
      if (patch) this.setData(patch, () => this._restartRotate());
      else this._restartRotate();

      // —— 异步补数据（不阻塞首屏）——
      if (source.kind === 'local' && !source.courses.length) this.pullTT(false);
      this.pullNotices(false);
    } catch (e) {
      this.setData({ state: 'error', errorText: '读取本机数据失败：' + ((e && e.message) || e) });
    }
  },

  // —— 关注宿舍电费卡片（v2.0.0）：未选择 0 请求；选择后优先用 2min 电量缓存，再按需刷新 ——
  loadPowerCard(force) {
    const d = store.get();
    const rv = power.normalizeSel(d.power && d.power.sel);
    if (!rv) {
      this._powerRv = '';
      this.setData({
        powerCard: { has: false, sel: '', label: '', qText: '—', unit: '度', stateKey: 'idle', stateText: '未选择', updText: '', loading: false }
      });
      return Promise.resolve(false);
    }
    const low = power.normLow(d.power && d.power.low);
    this._powerRv = rv;
    let cached = null;
    try { cached = cloud.powerCached(rv); } catch (e) { cached = null; }
    this._setPowerCard(rv, cached, low, !cached);
    if (!identity.has() || !cloud.isEnabled()) return Promise.resolve(false);
    return cloud.powerRoom(rv, !!force).then((row) => {
      if (this._powerRv !== rv) return false;
      this._setPowerCard(rv, row ? power.normalizeRow(row) : null, low, false);
      return !!row;
    }).catch(function () { return false; });
  },
  _setPowerCard(rv, row, low, loading) {
    const st = row ? power.stateOf(row, low) : 'idle';
    this.setData({
      powerCard: {
        has: true, sel: rv, label: power.labelOf(rv),
        qText: row ? power.fmtMain(row.q) : '—',
        unit: row ? (row.unit || '度') : '度',
        stateKey: row ? st : 'idle',
        stateText: row ? power.stateText(st) : '同步中',
        updText: row ? power.updText(row.upd) : '',
        loading: !!loading
      }
    });
  },
  goPower() { wx.navigateTo({ url: '/pages/power/power' }); },

  retry() {
    _ttTried = false;
    this.setData({ state: 'loading' });
    this._t = setTimeout(() => { this._t = null; this.refresh(); }, 120);
  },

  // 云端后台刷新完成后重绘：清掉通知 60s 节流，立刻用最新缓存重算待办（仍是 0 请求）
  onCloudSync() { _ntAt = 0; this.refresh(); this.loadPowerCard(); },

  // —— AI 页面接力：工作台无页面参数；接力进入时先渲染本机数据，再后台拉课表/通知 ——
  applyAgentHandoff() {
    if (this._agentApplied) return false;
    this._agentApplied = true;
    const h = this._agent;
    if (!h && !this._agentQ) return false;
    this.refresh();
    this.pullTT(false);
    this.pullNotices(false);
    return true;
  },

  // ---------------------- 课表（只读快照） ----------------------
  pullTT(force) {
    if (this._ttBusy) return;
    if (!force && _ttTried) return;
    if (!cloud.isEnabled() || !identity.has()) return;
    _ttTried = true;
    this._ttBusy = true;
    cloud.ttFetch(force).then((raw) => {
      let body = raw;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
      if (body && Array.isArray(body.c)) {
        const d = store.get();
        d.ttCache = { c: body.c, t: body.t || '', at: Date.now(), meta: body.meta || null };
        store.save();
        this.refresh();
      }
    }).catch(() => { /* 保留本机缓存/旧数据，不阻断工作台 */ }).then(() => {
      this._ttBusy = false;
    });
  },

  // ---------------------- 通知（云端自动通知） ----------------------
  pullNotices(force) {
    if (!cloud.isEnabled() || !identity.has()) {
      this.setData({ nt: { state: 'off', pending: 0, items: [], idx: 0, title: '通知需联网同步', sub: '', anim: '' } });
      return;
    }
    if (_ntGroups) this.setData({ nt: this.ntView(_ntGroups) }, () => this._restartRotate());
    if (_ntPulling) return;
    if (!force && _ntGroups && Date.now() - _ntAt < NT_TTL) return;
    _ntPulling = true;
    cloud.ntAutoPull(force).then((groups) => {
      _ntGroups = groups || [];
      _ntAt = Date.now();
      this.setData({ nt: this.ntView(_ntGroups) }, () => this._restartRotate());
    }).catch(() => {
      this.setData({ nt: { state: 'error', pending: 0, items: [], idx: 0, title: '通知同步失败', sub: '', anim: '' } });
    }).then(() => {
      _ntPulling = false;
    });
  },

  ntView(groups) {
    // 已处理（marks kind='ntdone'，v19 跨端持久化）不计入待处理；长期通知（长期安排 + 无时间/长期有效）不占待办
    const done = store.get().ntDone;
    const stats = notice.statOf(groups, done);
    const items = ntOpenItems(groups, done).slice(0, 5);
    const view = cardViewOf(items);
    return Object.assign({ state: 'ok', pending: stats.pending }, view);
  },

  // ---------------------- 需求 11：两卡「最新一条」轮换 ----------------------
  // 每 5s：上浮淡出（.26s）→ 换下一条 → 下浮淡入（.32s）；只更新 title/sub/idx/anim 四个小字段。
  // 页面隐藏 / 状态非 data / ≤1 条 时不轮换；低版本基础库降级为不轮换（避免频繁 setData）。
  _motionOk() {
    try {
      const info = wx.getAppBaseInfo ? wx.getAppBaseInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : null);
      const v = (info && info.SDKVersion) || '';
      if (!v) return true;
      return verAtLeast(v, '2.9.0');
    } catch (e) { return true; }
  },
  _restartRotate() {
    this._rotStop();
    if (this._hidden || this.data.state !== 'data') return;
    if (!this._motionOk()) return;
    const hwN = ((this.data.hw && this.data.hw.items) || []).length;
    const ntN = ((this.data.nt && this.data.nt.items) || []).length;
    if (Math.max(hwN, ntN) <= 1) return;                     // ≤1 条不轮换
    this._rot = setInterval(() => this._rotTick(), ROT_MS);
  },
  _rotStop() {
    if (this._rot) { clearInterval(this._rot); this._rot = null; }
    (this._rotTimers || []).forEach(clearTimeout);
    this._rotTimers = [];
  },
  _rotTick() {
    if (this._hidden || this.data.state !== 'data') return;
    this._rotateCard('hw');
    this._rotateCard('nt');
  },
  _rotateCard(key) {
    const card = this.data[key] || {};
    const items = card.items || [];
    if (items.length <= 1) return;
    this._rotTimers = this._rotTimers || [];
    this.setData((function () { const o = {}; o[key + '.anim'] = 'out'; return o; })());
    this._rotTimers.push(setTimeout(() => {
      const cur = this.data[key] || {};
      const list = cur.items || [];
      if (list.length <= 1) return;
      const next = ((cur.idx || 0) + 1) % list.length;
      const it = list[next] || { title: '', sub: '' };
      const p = {};
      p[key + '.idx'] = next;
      p[key + '.title'] = it.title;
      p[key + '.sub'] = it.sub;
      p[key + '.anim'] = 'in';
      this.setData(p);
      this._rotTimers.push(setTimeout(() => {
        const q = {}; q[key + '.anim'] = ''; this.setData(q);
      }, ROT_IN));
    }, ROT_OUT));
  },

  // ---------------------- 导航 ----------------------
  open(e) {
    const url = e.currentTarget.dataset.url;
    const tab = e.currentTarget.dataset.tab;
    if (!url) return;
    if (tab) wx.switchTab({ url: url });
    else wx.navigateTo({ url: url });
  },
  goTT() { wx.navigateTo({ url: '/pages/tt/tt' }); },
  goTask() { wx.navigateTo({ url: '/pages/task/task' }); },
  goNT() { wx.navigateTo({ url: '/pages/nt/nt' }); },
  goMe() { wx.switchTab({ url: '/pages/me/me' }); },
  goAll() { wx.switchTab({ url: '/pages/all/all' }); },
  onPageScroll(e) { scrollmem.onScroll(this, e); },
  onShareAppMessage() {
    return share.message({
      title: '班级工具｜今日课程 · 作业 · 通知',
      path: '/pages/index/index',
      imageUrl: '/images/share/index.png'
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '班级工具｜今日课程 · 作业 · 通知',
      imageUrl: '/images/share/index.png'
    });
  }
});
