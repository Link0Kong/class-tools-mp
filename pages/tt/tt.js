// pages/tt/tt.js —— 课表（与网页版同步：只读 / 教务 tt.json / 按周切换 / 本节详情）
// v12：请求统一走 utils/cloud.js 的 ttFetch（要求已通过班级身份验证）。
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');
const canvas = require('../../utils/canvas.js');
const identity = require('../../utils/identity.js');
const cloud = require('../../utils/cloud.js');
const share = require('../../utils/share.js');
const agent = require('../../utils/agent.js');
const scrollmem = require('../../utils/scrollmem.js');

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const PERIODS = [
  ['08:10', '08:55'], ['08:55', '09:40'], ['09:50', '10:30'], ['10:40', '11:25'],
  ['11:25', '12:10'], ['14:30', '15:15'], ['15:15', '16:00'], ['16:10', '16:55'],
  ['16:55', '17:40'], ['19:00', '19:45'], ['19:45', '20:30'], ['20:30', '21:20']
];
// 课表内容左右滑动切周：与网页端（web/tools/index.html §左右滑动）同一套参数。
const SW_LOCK = 12;           // 横向锁定阈值（px）
const SW_LOCK_RATIO = 1.35;   // |dx| > |dy| * 1.35 才判定为横向滑动
const SW_COMMIT = 56;         // 松手提交阈值（px，网页同为 56）
const SW_DAMP_EDGE = 0.28;    // 到第一周/最后一周（无目标）时的跟手阻尼
const SW_TAP_GUARD = 320;     // 滑动后抑制点击的时长（ms，网页同为 320）
const LOGIN_POLL_MS = 1500;   // 课表登录：轮询 rpc/tt_login_status 间隔（契约 §4；与网页同口径）
const LOGIN_TIMEOUT_MS = 120000;   // 课表登录：最长等待 120s（超时提示可重试）
const LOGIN_MSG = {
  auth: '身份已失效，请重新验证后重试',
  pwd: '教务密码不合法，请检查后重试',
  agent_offline: '本机代理解密服务不在线，请稍后重试',
  rate: '登录次数过多，请 1 小时后再试',
  encrypt: '密码加密失败，请稍后重试',
  expired: '登录任务已过期，请重试',
  failed: '教务登录失败，请检查学号与密码',
  network: '网络不可用，请稍后重试'
};
const TT_CARD_INNER = 630;    // 周表可用宽度（rpx）= 750 - 2×32（.page 左右 padding）- 2×28（.ttcard 内边距）
const TT_PD_COL = 96;         // 左侧节次标签列宽（rpx），与 tt.wxss 的 .tpd/.tplabels 一致；「第12节」不截断
// 课程色板：16 组，实际颜色由 pages/tt/tt.wxss 的 .tt-c0 ~ .tt-c15 定义（含暗色变体）。
// 这里只给每门课分配稳定索引，系统主题切换时无需重新渲染即可自动换色。
const TT_COLOR_N = 16;
const _colorMap = {}, _colorNext = { n: 0 };
function colorOf(name) {
  const k = String(name || '');
  const hit = _colorMap[k];
  if (hit !== undefined) return hit;
  const idx = _colorNext.n++ % TT_COLOR_N;
  _colorMap[k] = idx;
  return idx;
}
function active(c, wk) {
  if (!wk) return true;
  const ws = util.parseWeeks(c.weeks);
  if (ws.length && ws.indexOf(wk) < 0) return false;
  if (c.parity === 'odd' && wk % 2 === 0) return false;
  if (c.parity === 'even' && wk % 2 === 1) return false;
  return true;
}
function fmtDate(d) { return d ? ((d.getMonth() + 1) + '/' + d.getDate()) : ''; }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function fmtMeta(ts) {
  const d = new Date(Number(ts));
  if (!ts || isNaN(d)) return '教务同步';
  return '教务 ' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
function dateOf(term, wk, di) {
  const t = util.toDate(term || '');
  if (!t || isNaN(t) || !wk) return null;
  const d = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  d.setDate(d.getDate() + (wk - 1) * 7 + di);
  return d;
}
function sessionStart(term, wk, c) {
  const d = dateOf(term, wk, c.day);
  const p = PERIODS[c.start - 1];
  if (!d || !p) return null;
  const hm = String(p[0]).split(':');
  d.setHours(+hm[0] || 0, +hm[1] || 0, 0, 0);
  return d;
}
function roomShort(r) {
  const s = String(r || '').trim();
  if (!s) return '';
  if (s.length <= 7) return s;
  const m = s.match(/(\d{3,6})/);
  if (m) return m[1];
  const d = s.match(/(\d+-\d+)/);
  if (d) return d[1];
  const q = s.match(/^([^(（]+)[(（]([^)）]*)[)）]$/);
  if (q) {
    if (q[1] === q[2]) return q[1];
    if (q[2].length <= 7) return q[2];
  }
  return s.slice(0, 7) + '…';
}
function decodeShare(s) {
  try {
    const o = JSON.parse(decodeURIComponent(s));
    if (!o || typeof o !== 'object') return null;
    return { c: Array.isArray(o.c) ? o.c : [], t: o.t || '' };
  } catch (e) { return null; }
}

Page({
  data: {
    state: 'loading',
    errorText: '',
    view: 'week',
    wk: null, maxWeek: 18, isThisWeek: true,
    weekLabel: '', weekRange: '', srcText: '',
    head: [], rows: [], rowH: 96, colW: 106, dayCols: [], dayBar: [], dayList: [],
    dense: false, dense7: false, showSpan: true, gridOverflow: false,   // 6/7 天窄列缩放标记 + 溢出兜底标记
    groups: [], listOpen: false, next: null,
    total: 0, scrolled: false, cdText: '',
    detail: null, showDetail: false,
    swipeStyle: '',                                       // 内容区左右滑动的跟手/动画内联样式
    hScrollLeft: 0,                                       // 周表 scroll-view 横向位置（重进恢复用）
    // 2026-11-08 课表登录（个人教务课表 → store.ttLocal → UD v6 tt.ttLocal）：底部弹层 + 轮询状态
    shared: false,                                        // 分享进入（只读分享课表，不显示登录入口）
    mine: false,                                          // 当前渲染的是「我的课表」（ttLocal 优先于公共快照）
    loginOpen: false, loginSid: '', loginPwd: '', loginBusy: false,
    loginMsg: '', loginErr: '', loginCanClear: false
  },

  onLoad(options) {
    scrollmem.attach(this);
    options = options || {};
    this._agent = agent.pick(this);            // AI 页面接力（wx.onAgentHandoff），只消费一次
    this._agentQ = agent.pickQuery(options);   // 备用：handoff query 随页面参数传入
    this._shared = options.tt ? decodeShare(options.tt) : null;
    this._courses = [];
    this._term = '';
    this._meta = null;
    this._wk = null;
    const shareWk = parseInt(options.wk, 10);
    if (shareWk > 0) this._wk = shareWk;
    this._day = null;
    this._dayUser = false;
    this._first = true;
    this._fetching = false;
    this._remoteOk = false;
    // 周表横向溢出兜底：列宽按卡片内宽自适应后 5/6/7 天均为 96+days×colW ≤ 630rpx，不再需要横向滚动
    // （2026-11-06 用户反馈：周六/周日有课时也要一屏看全）。以下状态保留为防御——scroll-view 仍绑定
    // bindscroll/scroll-left，未来若列宽常数或数据变化导致溢出也不会崩，但正常数据下恒为 false / 0。
    this._gridOverflow = false;   // 周表横向溢出（当前恒 false）
    this._gridX = 0;              // 周表 scroll-view 当前横向位置（px，bindscroll 记录；不溢出时恒 0）
    this._gridMaxX = 0;           // 周表可横向滚动的最大距离（px；当前恒 0）
    // 需求 2：重进时恢复周表横向滚动位置（内部 scroll-view；只恢复一次）
    const sv = scrollmem.svGet(this, 'ttgrid');
    if (sv && sv.left > 0) this.setData({ hScrollLeft: sv.left });
    this._sw = null;              // 当前滑动手势
    this._swAnim = false;         // 换周飞出/飞入动画进行中
    this._swTimers = [];          // 动画定时器（卸载时统一清理）
    this._swSeq = 0;              // 手势/回弹序号（防止过期的 snap 回调清掉新样式）
    this._supTap = 0;             // 滑动结束后短暂抑制 tap
    // 2026-11-08 课表登录状态（密码只存在 data.loginPwd，提交后立刻清空；不落 storage、不进日志/上报）
    this._mine = false;
    this._loginJob = '';
    this._loginTimer = null;
    this._loginDeadline = 0;
  },
  onShow() {
    share.enable();
    scrollmem.restore(this);
    if (!identity.ensure()) return;
    try { store.reload(); } catch (e) { /* ignore */ }
    this.applyAgentHandoff();
    this.loadCached();
    // 2026-11-06 进入速度（用户反馈「先加载当前周保障进入速度」）：
    // loadCached() 已同步渲染本机课表（默认当前周）。本机有课表时**不能**再 setData 骨架把它盖掉，
    // 只有本机确实没有任何课表数据（ttCache / 旧 course 都空）才显示「课表加载中…」。
    if (this._first) {
      this._first = false;
      if (!this._hasLocalTt()) this.setData({ state: 'loading' });
    }
    // 后台静默刷新立即发起（不再人为等 120ms）：成功才 refresh 覆盖，失败由 loadRemote 的 catch 保留缓存。
    this.loadRemote(this._hoForce);
    this.startTick();
  },
  onHide() {
    scrollmem.save(this);
    if (this._t) { clearTimeout(this._t); this._t = null; }
    this.stopTick();
    this._swClear();               // 页面隐藏：终止进行中的跟手/飞行动画，避免隐藏期间 setData 抖动
    this._loginHide();             // 课表登录轮询停止 + 关弹层（回来后可重新点「登录教务」）
  },
  onUnload() {
    scrollmem.save(this);
    if (this._t) { clearTimeout(this._t); this._t = null; }
    this.stopTick();
    this._swClear();               // 页面卸载时清掉飞出/飞入/回弹动画定时器与手势状态
    this._loginHide();
  },
  // 统一的滑动手势/动画收尾（onHide / onUnload / 重绘前）
  _swClear() {
    (this._swTimers || []).forEach(clearTimeout);
    this._swTimers = [];
    this._sw = null;
    this._swAnim = false;
    this._swSeq = (this._swSeq || 0) + 1;
    if (this.data && this.data.swipeStyle) this.setData({ swipeStyle: '' });
  },
  onPullDownRefresh() { this.loadRemote(true); },
  // 云同步应用后（换端登录 / 清除个人课表）→ 重新挑选数据源并重绘（不重复请求；正在登录轮询时不动）
  onCloudSync() {
    try { store.reload(); } catch (e) { /* ignore */ }
    this._pickSource();
    this.refresh();
    if (this.data.loginOpen) this.setData({ loginCanClear: !!this._mineLocal() });
  },
  retry() { this.loadRemote(true); },

  // —— AI 页面接力：先定位到指定周 / 星期，再用 payload 自带课表兜底渲染；随后后台 force 刷新 ——
  applyAgentHandoff() {
    if (this._agentApplied) return false;
    this._agentApplied = true;
    const h = this._agent;
    const p = (h && h.payload) || {};
    const q = Object.assign({}, this._agentQ || {}, (h && h.query) || {});
    if (!h && !this._agentQ) return false;
    const wk = parseInt(q.wk || p.wk || p.week, 10);
    if (wk > 0) this._wk = Math.max(1, Math.min(30, wk));
    const day = parseInt(q.day || p.day, 10);
    if (day >= 1 && day <= 7) {
      this._day = day - 1;
      this._dayUser = true;
      this.setData({ view: 'day' });
    } else if (wk > 0) {
      this.setData({ view: 'week' });
    }
    this._hoForce = true;          // 让 onShow 的教务拉取绕过缓存 TTL
    return true;
  },

  /* 数据来源（2026-11-08 起）：旧分享 > 我的课表 ttLocal（个人）> 教务缓存 ttCache / site_assets（公共）> 旧本地课表（兼容） */
  loadCached() {
    if (this._shared) {
      this._mine = false;
      this._courses = this._shared.c || [];
      this._term = this._shared.t || '';
      this._meta = null;
      this.refresh();
      return;
    }
    this._pickSource();
    this.refresh();
  },

  // 按优先级挑选数据源并写入页面私有状态（_courses/_term/_meta/_mine）；**不发起请求**。
  // 优先级（需求 ③）：个人 ttLocal（登录教务成功写入）> 公共课表（site_assets → store.ttCache）> 旧 course。
  // 返回 'shared' | 'mine' | 'cache' | 'local'。
  _pickSource() {
    if (this._shared) { this._mine = false; return 'shared'; }
    const d = store.get();
    const tl = (d.ttLocal && Array.isArray(d.ttLocal.c) && d.ttLocal.c.length) ? d.ttLocal : null;
    if (tl) {
      this._mine = true;
      this._courses = tl.c;
      this._term = tl.t || d.termStart || '';
      this._meta = { mine: true, fetchedAt: Number(d.ttLocalAt) || 0 };
      return 'mine';
    }
    this._mine = false;
    const cache = d.ttCache && Array.isArray(d.ttCache.c) ? d.ttCache : null;
    if (cache) {
      this._courses = cache.c;
      this._term = cache.t || '';
      this._meta = cache.meta || null;
      return 'cache';
    }
    this._courses = Array.isArray(d.course) ? d.course : [];
    this._term = d.termStart || '';
    this._meta = null;
    return 'local';
  },

  // 本机是否有可渲染的课表数据（决定进入时是否显示「课表加载中…」骨架）：
  // 口径与 _pickSource 一致（分享 > ttLocal > ttCache > 旧 course）；有数据 = 进入即显示，不用骨架覆盖。
  _hasLocalTt() {
    if (this._shared) return !!(this._shared.c && this._shared.c.length);
    const d = store.get();
    if (d.ttLocal && Array.isArray(d.ttLocal.c) && d.ttLocal.c.length) return true;
    const cache = d.ttCache && Array.isArray(d.ttCache.c) ? d.ttCache.c : null;
    const list = cache || (Array.isArray(d.course) ? d.course : []);
    return list.length > 0;
  },

  loadRemote(donePull) {
    const finish = () => {
      if (donePull) wx.stopPullDownRefresh();
      if (this.data.state === 'loading') this.refresh();
    };
    if (this._shared) { finish(); return; }
    if (this._fetching) { finish(); return; }
    this._fetching = true;
    cloud.ttFetch(donePull).then((raw) => {
      let body = raw;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
      if (body && Array.isArray(body.c)) {
        const d = store.get();
        d.ttCache = { c: body.c, t: body.t || '', at: Date.now(), meta: body.meta || null };
        store.save();
        this._remoteOk = true;
        this._pickSource();          // 个人课表（ttLocal）优先：公共快照只更新缓存，不覆盖「我的课表」
        this.refresh();
      }
    }).catch(() => { /* 保留缓存 / 本机旧数据，不阻断页面 */ }).then(() => {
      this._fetching = false;
      finish();
    });
  },

  refresh() {
    const data = this._buildData();
    if (data) this.setData(data);
  },

  // 生成一次渲染数据（周/日视图、周次信息、全部课程分组等）；出错时只落到 error 态并返回 null
  _buildData() {
    try {
      const all = this._courses || [];
      const term = this._term || '';
      const cur = util.weekNum(term);
      let mx = 0;
      all.forEach(function (c) { util.parseWeeks(c.weeks).forEach(function (n) { if (n > mx) mx = n; }); });
      mx = Math.min(Math.max(mx, cur || 0, 18), 30);
      let wk = this._wk == null ? cur : this._wk;
      if (wk != null) wk = Math.max(1, Math.min(mx, wk));
      const today = new Date().getDay();
      const ti = (today === 0 ? 6 : today - 1);
      const act = all.filter(function (c) { return active(c, wk); });
      const days = [0, 1, 2, 3, 4, 5, 6].filter(function (di) {
        return di < 5 || act.some(function (c) { return c.day === di; });
      });
      // 列宽始终按卡片内宽自适应（用户 2026-11-06：周六/周日有课时也要同一页看全，不能靠横滑）：
      // 5/6/7 天 → 106/89/76rpx，内容宽 96+days×colW = 626/630/628rpx ≤ TT_CARD_INNER(630rpx)，精确成立。
      const colW = Math.floor((TT_CARD_INNER - TT_PD_COL) / Math.max(1, days.length));
      const dense = days.length >= 6;    // 6/7 天窄列：字号/内边距收紧、课程名最多 2 行、日期头可换行
      const dense7 = days.length >= 7;   // 7 天再隐藏冗余「第X-Y节」（跨节高度已表达，省出教室行空间）
      const currentAct = cur == null ? [] : all.filter(function (c) { return active(c, cur); });
      let maxP = 12;
      all.forEach(function (c) { maxP = Math.max(maxP, c.end || 1); });
      maxP = Math.min(maxP, 14);

      const head = days.map(function (di) {
        return {
          n: DAYS[di],
          d: fmtDate(dateOf(term, wk, di)),
          today: wk != null && wk === cur && di === ti
        };
      });
      const rows = [];
      for (let p = 1; p <= maxP; p++) {
        const cells = days.map(function (di) {
          const items = [];
          act.forEach(function (c) {
            if (c.day !== di || p < c.start || p > c.end) return;
            const start = p === c.start;
            items.push({
              cid: all.indexOf(c),
              name: start ? c.name : '',
              meta: start ? roomShort(c.room) : '',
              span: start && c.end > c.start ? ('第' + c.start + '-' + c.end + '节') : '',
              cont: !start,
              ci: colorOf(c.name)
            });
          });
          return { d: di, items: items, today: wk != null && wk === cur && di === ti };
        });
        rows.push({
          p: p,
          t: PERIODS[p - 1] ? (PERIODS[p - 1][0] + '-' + PERIODS[p - 1][1]) : '',
          t1: PERIODS[p - 1] ? PERIODS[p - 1][0] : '',
          t2: PERIODS[p - 1] ? PERIODS[p - 1][1] : '',
          cells: cells
        });
      }

      /* 周视图：按行高绝对定位课程块，跨节次时连续成一块 */
      const ROW = 96;
      const dayCols = days.map(function (di) { return { d: di, courses: [] }; });
      act.forEach(function (c) {
        const col = dayCols.filter(function (x) { return x.d === c.day; })[0];
        if (!col) return;
        col.courses.push({
          cid: all.indexOf(c), name: c.name, meta: roomShort(c.room),
          span: '第' + c.start + '-' + c.end + '节', tall: c.end > c.start,
          ci: colorOf(c.name),
          top: (c.start - 1) * ROW + 3,
          height: (c.end - c.start + 1) * ROW - 6
        });
      });

      const list = act.slice().sort(function (a, b) {
        return (a.day - b.day) || (a.start - b.start);
      }).map(function (c) {
        return Object.assign({}, c, {
          cid: all.indexOf(c),
          dayName: DAYS[c.day] || '',
          roomShort: roomShort(c.room),
          ci: colorOf(c.name)
        });
      });

      const sel = this.pickSelectedDay(days, act, wk, cur, ti);
      const dayBar = days.map(function (di) {
        return {
          d: di, n: DAYS[di].slice(1), date: fmtDate(dateOf(term, wk, di)),
          today: wk != null && wk === cur && di === ti,
          has: act.some(function (c) { return c.day === di; }),
          on: di === sel
        };
      });
      const dayList = act.filter(function (c) { return c.day === sel; })
        .sort(function (a, b) { return a.start - b.start; })
        .map(function (c) {
          const p1 = PERIODS[c.start - 1] || ['', ''];
          return Object.assign({}, c, {
            cid: all.indexOf(c), time: p1[0], dayName: DAYS[c.day] || '',
            ci: colorOf(c.name)
          });
        });
      const gmap = {}, groups = [];
      all.forEach(function (c) {
        const k = String(c.name || '');
        let g = gmap[k];
        if (!g) { g = { name: k, pills: [], rooms: [], teachers: [], ci: colorOf(k), firstDay: c.day || 0 }; gmap[k] = g; groups.push(g); }
        const pill = (DAYS[c.day] || '') + ' ' + c.start + '-' + c.end;
        if (g.pills.indexOf(pill) < 0) g.pills.push(pill);
        if (c.room && g.rooms.indexOf(c.room) < 0) g.rooms.push(c.room);
        if (c.teacher && g.teachers.indexOf(c.teacher) < 0) g.teachers.push(c.teacher);
      });
      groups.sort(function (a, b) { return (a.firstDay - b.firstDay) || String(a.name).localeCompare(String(b.name), 'zh'); });
      groups.forEach(function (g) { g.meta = [g.teachers.join('、'), g.rooms.join(' / ')].filter(Boolean).join(' · '); });

      const nx = this.nextClass(currentAct, cur, ti);
      const a = dateOf(term, wk, 0);
      const b = dateOf(term, wk, 6);
      // 周表宽度：96 + N×colW（rpx）。colW 自适应后 5/6/7 天 = 626/630/628rpx，恒 ≤ 卡片内宽，
      // 所有星期列（含周六/周日）同页完整可见 → 左右手势直接切上一周/下一周（见 onSwipeMove/onSwipeEnd）。
      // _gridOverflow/_gridMaxX 保留为防御性兜底（当前恒 false / 0）：若未来列宽常数或数据导致溢出，
      // scroll-view 仍可横向滚动；unit.js 与 tt_swipe_preview.js 均有断言覆盖该状态。
      const contentRpx = TT_PD_COL + days.length * colW;
      this._gridOverflow = contentRpx > TT_CARD_INNER;
      this._gridMaxX = this._gridOverflow
        ? Math.max(0, Math.round((contentRpx - TT_CARD_INNER) * this._winW() / 750))
        : 0;
      if (this._gridMaxX) this._gridX = Math.min(this._gridX || 0, this._gridMaxX);
      else this._gridX = 0;
      return {
        state: all.length ? 'data' : 'empty',
        errorText: '',
        wk: wk,
        weekLabel: wk != null ? ('第 ' + wk + ' 周') : '全部课程',
        weekRange: (a && b) ? (fmtDate(a) + ' – ' + fmtDate(b)) : '',
        // 来源文案：分享 > 我的课表（个人 ttLocal）> 公共教务快照 > 本机旧数据
        srcText: this._shared ? '分享' : (this._mine ? '我的课表' : (this._meta ? fmtMeta(this._meta.fetchedAt) : (this._remoteOk ? '教务同步' : '本机'))),
        mine: !!this._mine,
        shared: !!this._shared,
        maxWeek: mx,
        isThisWeek: wk == null || wk === cur,
        head: head,
        rows: rows,
        dayBar: dayBar,
        dayList: dayList,
        dayCols: dayCols,
        rowH: ROW,
        colW: colW,
        dense: dense,
        dense7: dense7,
        showSpan: !dense7,
        gridOverflow: this._gridOverflow,
        groups: groups,
        list: list,
        total: all.length,
        next: nx,
        cdText: this.cdOf(nx)
      };
    } catch (e) {
      this.setData({ state: 'error', errorText: '读取课表失败：' + ((e && e.message) || e) });
      return null;
    }
  },

  pickSelectedDay(days, act, wk, cur, ti) {
    let sel = this._dayUser ? this._day : null;
    if (sel == null || days.indexOf(sel) < 0) {
      const todayHas = act.some(function (c) { return c.day === ti; });
      if (wk != null && wk === cur && days.indexOf(ti) >= 0 && todayHas) sel = ti;
      else {
        sel = days[0];
        for (let i = 0; i < days.length; i++) {
          const di = days[i];
          if (act.some(function (c) { return c.day === di; })) { sel = di; break; }
        }
      }
    }
    this._day = sel;
    return sel;
  },

  nextClass(list, wk, ti) {
    if (!list.length) return null;
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const arr = list.slice().sort(function (a, b) { return a.start - b.start; });
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      if (c.day !== ti) continue;
      const p = PERIODS[c.end - 1];
      const st = PERIODS[c.start - 1];
      if (!p || !st) continue;
      const ee = p[1].split(':');
      if ((+ee[0] * 60 + +ee[1]) < mins) continue;
      return {
        name: c.name, start: c.start, end: c.end, day: c.day, room: c.room || '',
        dayName: DAYS[c.day] || '', time: st[0],
        soon: true
      };
    }
    return null;
  },

  onPageScroll(e) {
    scrollmem.onScroll(this, e);
    const y = e.scrollTop;
    const next = y > 64 ? true : (y < 20 ? false : this.data.scrolled);
    if (next !== this.data.scrolled && !this._scBusy) {
      this._scBusy = true;
      this.setData({ scrolled: next }, () => { this._scBusy = false; });
    }
  },
  cdOf(nx) {
    if (!nx) return '';
    const p = PERIODS[nx.start - 1];
    if (!p) return '';
    const now = new Date();
    const ti = (now.getDay() === 0 ? 6 : now.getDay() - 1);
    if (nx.day !== ti) return '';
    const mins = now.getHours() * 60 + now.getMinutes();
    const ss = String(p[0]).split(':');
    const target = (+ss[0]) * 60 + (+ss[1]);
    if (target <= mins) return '';
    const d = target - mins;
    if (d >= 60) return Math.floor(d / 60) + ' 小时 ' + (d % 60) + ' 分后上课';
    return d + ' 分钟后上课';
  },
  startTick() {
    this.stopTick();
    this._tick = setInterval(() => {
      const t = this.cdOf(this.data.next);
      if (t !== this.data.cdText) this.setData({ cdText: t });
    }, 30000);
  },
  stopTick() { if (this._tick) { clearInterval(this._tick); this._tick = null; } },

  setView(e) {
    if (this._tapBlocked()) return;   // 与网页一致：滑动后的第一下点击一律忽略（周/日切换只点击）
    const v = e.currentTarget.dataset.v === 'day' ? 'day' : 'week';
    if (v === this.data.view) return;
    this.setData({ view: v });
  },
  pickDay(e) {
    if (this._tapBlocked()) return;   // 滑动结束后的 tap 不切换星期
    this._day = +e.currentTarget.dataset.td;
    this._dayUser = true;
    this.refresh();
  },
  toggleList() {
    if (this._tapBlocked()) return;
    this.setData({ listOpen: !this.data.listOpen });
  },

  prevWeek() {
    if (this._tapBlocked()) return;   // 320ms > 动画换周的 150ms，避免换周动画期间点击造成周次回跳
    const wk = this.data.wk;
    if (!wk || wk <= 1) return;
    this._wk = wk - 1; this.refresh();
  },
  nextWeek() {
    if (this._tapBlocked()) return;
    const wk = this.data.wk;
    if (!wk || wk >= this.data.maxWeek) return;
    this._wk = wk + 1; this.refresh();
  },
  thisWeek() {
    if (this._tapBlocked()) return;
    this._wk = null; this._day = null; this._dayUser = false; this.refresh();
  },

  /* 周切换：上一周 / 下一周按钮 + 课表内容左右滑动（与网页端同款：跟手 → 松手吸附 / 飞出飞入）。
     网页规则照搬：横向锁定 12px、提交阈值 56px、到边界橡皮筋阻尼 0.28、动画 150ms 飞出 +
     230ms cubic-bezier(.22,.8,.3,1) 飞入、滑动后 320ms 内点击一律吞掉；周/日视图切换只点击。
     手势范围：只包「课表内容」（周表 / 日视图），比网页「整张课表卡起手都能切周」窄——按设计规范
     「课表内容切上一周/下一周」收窄；周导航 / 周-日切换 / 下一节 / 全部课程不参与滑动。
     2026-11-06：周表列宽改为按卡片内宽自适应（5/6/7 天 = 106/89/76rpx，恒不横向溢出），
     因此任何横向手势都直接跟手切上一周/下一周，不再有「先滚表格、到边缘才切周」的分支。 */
  _winW() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      return (info && info.windowWidth) || 375;
    } catch (e) { return 375; }
  },
  _swipeTarget(dir) {
    const wk = this.data.wk;
    if (!wk) return null;
    if (dir > 0 && wk >= this.data.maxWeek) return null;
    if (dir < 0 && wk <= 1) return null;
    return { dir: dir };
  },
  // 周表横向滚动位置（scroll-view bindscroll，px）：重进恢复 + 防御性状态记录，不触发 setData。
  // 列宽自适应后周表不再横向溢出（_gridMaxX 恒 0），正常设备上该回调不会被触发；保留以兜底未来变宽。
  onGridScroll(e) {
    const d = (e && e.detail) || {};
    this._gridX = Number(d.scrollLeft) || 0;
    scrollmem.svSave(this, 'ttgrid', d);
  },
  _tapBlocked() { return Date.now() < (this._supTap || 0); },
  _swLater(fn, ms) {
    const id = setTimeout(fn, ms);
    this._swTimers.push(id);
    return id;
  },
  onSwipeStart(e) {
    if (!e.touches || e.touches.length !== 1) {
      // 拖动中变成多指：先回弹，避免把已经拖出的位移留在页面上
      if (this._sw) { this._sw = null; this._swipeSnap(); }
      return;
    }
    if (this._swAnim) return;
    this._swSeq = (this._swSeq || 0) + 1;   // 让上一次尚未触发的 snap 回调失效
    const t = e.touches[0];
    // 周表列宽自适应后不再横向溢出：起手不再区分「滚表格 / 切周」，统一按切周手势处理
    this._sw = { sx: t.clientX, sy: t.clientY, lock: false, live: true, last: 0 };
  },
  onSwipeMove(e) {
    const s = this._sw;
    if (!s || !s.live) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const dx = t.clientX - s.sx;
    const dy = t.clientY - s.sy;
    if (!s.lock) {
      if (Math.abs(dx) < SW_LOCK) return;
      if (Math.abs(dx) > Math.abs(dy) * SW_LOCK_RATIO) s.lock = true;   // 横向锁定 = 切周手势
      else { s.live = false; return; }                                   // 纵向/斜向：交给页面滚动
    }
    const tgt = this._swipeTarget(dx < 0 ? 1 : -1);
    const x = Math.round(dx * (tgt ? 1 : SW_DAMP_EDGE));
    if (x === s.last) return;
    s.last = x;
    this.setData({ swipeStyle: 'transform:translateX(' + x + 'px);transition:none;' });
  },
  onSwipeEnd(e) {
    const s = this._sw;
    this._sw = null;
    if (!s || !s.live || !s.lock) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - s.sx;
    const dy = t.clientY - s.sy;
    if (!(Math.abs(dx) > Math.abs(dy) * 1.1)) { this._swipeSnap(); return; }
    this._supTap = Date.now() + SW_TAP_GUARD;   // 与网页一致：真正横向滑动后的 320ms 内吞掉 tap
    const dir = dx < 0 ? 1 : -1;
    if (this._swipeTarget(dir) && Math.abs(dx) >= SW_COMMIT) this._swipeCommit(dir);
    else this._swipeSnap();
  },
  onSwipeCancel() {
    if (this._swAnim) return;   // 飞行动画中收到 touchcancel 不打断
    this._sw = null;
    this._swipeSnap();
  },
  _swipeSnap() {
    if (!this.data.swipeStyle) return;
    const seq = this._swSeq = (this._swSeq || 0) + 1;
    this.setData({ swipeStyle: 'transform:translateX(0);opacity:1;transition:transform .2s cubic-bezier(.22,.8,.3,1);' });
    this._swLater(() => {
      if (this._swSeq === seq && !this._swAnim) this.setData({ swipeStyle: '' });
    }, 220);
  },
  _swipeCommit(dir) {
    const wk = this.data.wk;
    if (!wk) { this._swipeSnap(); return; }
    const nwk = dir > 0 ? Math.min(this.data.maxWeek, wk + 1) : Math.max(1, wk - 1);
    if (nwk === wk) { this._swipeSnap(); return; }
    const W = Math.min(340, Math.max(120, this._winW() * 0.5));
    const sign = dir > 0 ? -1 : 1;
    this._swAnim = true;
    // 1) 旧内容飞出（transform .16s ease + 透明度 .25；150ms 后换页）
    this.setData({ swipeStyle: 'transform:translateX(' + (sign * W) + 'px);opacity:.25;transition:transform .16s ease,opacity .16s ease;' });
    this._swLater(() => {
      // 2) 换周 + 新内容从另一侧进场（同一次 setData，避免闪一格）
      this._wk = nwk;
      const data = this._buildData() || {};
      data.swipeStyle = 'transform:translateX(' + (-sign * W) + 'px);opacity:0;transition:none;';
      this.setData(data, () => {
        this._swLater(() => {
          // 3) 弹回原位（.23s cubic-bezier(.22,.8,.3,1)）
          this.setData({ swipeStyle: 'transform:translateX(0);opacity:1;transition:transform .23s cubic-bezier(.22,.8,.3,1),opacity .23s ease;' });
          this._swLater(() => { this._swAnim = false; this.setData({ swipeStyle: '' }); }, 250);
        }, 20);
      });
    }, 150);
  },

  /* 课程详情：本次点击的这一节 + 下次上课 */
  openGroup(e) {
    if (this._tapBlocked()) return;   // 滑动后的第一下点击不误开详情
    const name = e.currentTarget.dataset.name;
    const nx = this.findNext(name, new Date());
    if (nx) { this.setData({ detail: this.detailOf(nx.c, nx.week), showDetail: true }); return; }
    const c = (this._courses || []).filter(function (x) { return String(x.name) === String(name); })[0];
    if (c) this.setData({ detail: this.detailOf(c, this.data.wk), showDetail: true });
  },
  openDetail(e) {
    if (this._tapBlocked()) return;   // 滑动结束后的 tap 不误开课程详情
    const cid = +e.currentTarget.dataset.cid;
    const c = (this._courses || [])[cid];
    if (!c) return;
    this.setData({ detail: this.detailOf(c, this.data.wk), showDetail: true });
  },
  closeDetail() { this.setData({ showDetail: false }); },
  detailOf(c, wk) {
    const term = this._term || '';
    const date = dateOf(term, wk, c.day);
    const p1 = PERIODS[c.start - 1] || ['', ''];
    const p2 = PERIODS[c.end - 1] || ['', ''];
    let time = (date ? fmtDate(date) + ' ' : '') + (DAYS[c.day] || '') + ' 第' + c.start + '-' + c.end + '节';
    if (p1[0]) time += '（' + p1[0] + '–' + p2[1] + '）';
    const after = sessionStart(term, wk, c) || new Date();
    const nx = this.findNext(c.name, after);
    let next = '暂无后续课程';
    if (nx) {
      const np1 = PERIODS[nx.c.start - 1] || ['', ''];
      const np2 = PERIODS[nx.c.end - 1] || ['', ''];
      next = fmtDate(nx.date) + ' ' + (DAYS[nx.c.day] || '') + ' 第' + nx.c.start + '-' + nx.c.end + '节';
      if (np1[0]) next += '（' + np1[0] + '–' + np2[1] + '）';
    }
    return { name: c.name, teacher: c.teacher || '—', room: c.room || '—', time: time, next: next, ci: colorOf(c.name) };
  },
  findNext(name, after) {
    const all = this._courses || [];
    const term = this._term || '';
    const cur = util.weekNum(term);
    let mx = 0;
    all.forEach(function (c) { util.parseWeeks(c.weeks).forEach(function (n) { if (n > mx) mx = n; }); });
    mx = Math.min(Math.max(mx, cur || 0, 18), 30);
    let best = null, bestAt = null;
    all.forEach(function (c) {
      if (String(c.name) !== String(name)) return;
      for (let w = 1; w <= mx; w++) {
        if (!active(c, w)) continue;
        const st = sessionStart(term, w, c);
        if (!st) continue;
        if (after && st.getTime() <= after.getTime()) continue;
        if (!bestAt || st < bestAt) { best = { c: c, date: st, week: w }; bestAt = st; }
      }
    });
    return best;
  },

  /* ================= 课表登录（2026-11-08，契约 CONTRACT §4） =================
   * 弹层：学号（默认当前班级身份 sid，只读——云端 login_jobs.sid 由 token 决定，改写无效）
   *      + 教务密码（只存 data.loginPwd，提交后立即清空；不落 storage、不写日志、不进错误上报）
   * 流程：rpc/tt_login_enqueue → 1.5s 轮询 rpc/tt_login_status（≤120s）→ done 写 store.ttLocal 与 UD v6 tt.ttLocal。
   * 错误码：agent_offline / rate / pwd / auth / failed 分别提示；失败不阻塞公共课表查看。
   * 优先级：ttLocal（个人）> ttCache/site_assets（公共）；「清除我的课表」回退公共。
   */
  _mineLocal() {
    const tl = store.get().ttLocal;
    return (tl && Array.isArray(tl.c) && tl.c.length) ? tl : null;
  },
  openLogin() {
    if (this._tapBlocked() || this._shared) return;
    if (!identity.ensure()) return;
    this._loginStop();
    this.setData({
      loginOpen: true,
      loginSid: identity.sid(),
      loginPwd: '',
      loginBusy: false,
      loginMsg: '',
      loginErr: '',
      loginCanClear: !!this._mineLocal()
    });
  },
  closeLogin() { this._loginStop(); this.setData({ loginOpen: false, loginPwd: '', loginBusy: false, loginMsg: '' }); },
  _loginHide() {
    this._loginStop();
    if (this.data.loginOpen) this.setData({ loginOpen: false, loginPwd: '', loginBusy: false, loginMsg: '' });
  },
  onLoginPwdInput(e) { this.setData({ loginPwd: String((e && e.detail && e.detail.value) || '') }); },
  _loginStop() {
    if (this._loginTimer) { clearTimeout(this._loginTimer); this._loginTimer = null; }
    this._loginJob = '';
    this._loginDeadline = 0;
  },
  _loginFail(reason) {
    this.setData({ loginBusy: false, loginMsg: '', loginErr: LOGIN_MSG[String(reason || '')] || '登录失败，请稍后重试' });
  },
  loginTap() {
    if (this.data.loginBusy) return;
    const pwd = String(this.data.loginPwd || '');
    if (!pwd) { util.toast('请输入教务密码'); return; }
    if (!identity.has()) { util.toast('请先完成身份验证'); return; }
    this.setData({ loginBusy: true, loginErr: '', loginMsg: '正在提交登录…' });
    this._loginStop();
    return cloud.ttLoginEnqueue(pwd).then((r) => {
      this.setData({ loginPwd: '' });                   // 提交后立刻从页面 data 清除密码
      if (!r || !r.ok) { this._loginFail((r && r.reason) || 'failed'); return false; }
      this.setData({ loginMsg: r.reused ? '已有登录任务，等待本机代理…' : '已提交，等待本机代理登录教务…' });
      this._pollLogin(r.job_id);
      return true;
    }).catch(() => { this._loginFail('network'); return false; });
  },
  _pollLogin(jobId) {
    const jid = String(jobId || '');
    this._loginStop();
    if (!jid) { this._loginFail('failed'); return; }
    this._loginJob = jid;
    this._loginDeadline = Date.now() + LOGIN_TIMEOUT_MS;
    const tick = () => {
      if (!this._loginJob || this._loginJob !== jid) return;
      if (!this.data.loginOpen) { this._loginStop(); return; }
      if (Date.now() > this._loginDeadline) { this._loginStop(); this._loginFail('expired'); return; }
      cloud.ttLoginStatus(jid).then((r) => {
        if (!this._loginJob || this._loginJob !== jid) return;
        if (!r || !r.ok) {            // 网络抖动：继续轮询直到 120s 超时（不立即失败）
          this._loginTimer = setTimeout(tick, LOGIN_POLL_MS);
          return;
        }
        const st = String(r.status || '');
        if (st === 'done') { this._loginStop(); this._applyMine(r.result); return; }
        if (st === 'failed') { this._loginStop(); this._loginFail('failed'); return; }
        if (st === 'expired') { this._loginStop(); this._loginFail('expired'); return; }
        this.setData({ loginMsg: st === 'claimed' ? '本机代理正在登录教务…' : '等待本机代理处理…' });
        this._loginTimer = setTimeout(tick, LOGIN_POLL_MS);
      }).catch(() => {
        if (this._loginJob === jid) this._loginTimer = setTimeout(tick, LOGIN_POLL_MS);
      });
    };
    tick();
  },
  // 登录成功：写 store.ttLocal（{c,t}，与网页 UD v6 tt.ttLocal 同字段）→ save 触发 UD 脏检测（1200ms 防抖推送）
  // → 立即切「我的课表」（ttLocal 优先于公共快照）。
  _applyMine(result) {
    const c = (result && Array.isArray(result.c)) ? result.c : [];
    const tl = store.normTtLocal({ c: c, t: String((result && result.t) || '') });
    if (!tl) { this.setData({ loginBusy: false, loginMsg: '', loginErr: '教务返回的课表为空，请稍后重试' }); return false; }
    const d = store.get();
    d.ttLocal = tl;
    d.ttLocalAt = Date.now();
    store.save();
    this._pickSource();
    this.refresh();
    this.setData({ loginBusy: false, loginMsg: '', loginErr: '', loginOpen: false, loginPwd: '', loginCanClear: true });
    util.toast('已切换为我的课表');
    return true;
  },
  // 清除我的课表：ttLocal=null + ttLocalAt=now（抬高 at.tt 覆盖云端）→ 回退公共课表
  clearMine() {
    if (!this._mineLocal()) { util.toast('当前没有个人课表'); return; }
    wx.showModal({
      title: '清除我的课表',
      content: '清除后课表页回退为公共课表，个人课表也会从账号同步中删除。',
      confirmText: '清除',
      success: (r) => {
        if (!r || !r.confirm) return;
        const d = store.get();
        d.ttLocal = null;
        d.ttLocalAt = Date.now();
        store.save();
        this._pickSource();
        this.refresh();
        this.setData({ loginCanClear: false, loginErr: '', loginMsg: '已清除个人课表' });
        util.toast('已回退公共课表');
      }
    });
  },

  exportImg() {
    if (this._tapBlocked()) return;   // 与网页一致：滑动后的第一下点击被忽略
    const all = this._courses || [];
    const wk = this.data.wk;
    if (!all.length) { util.toast('课表是空的'); return; }
    const list = all.filter(function (c) { return active(c, wk); });
    if (!list.length) { util.toast('这一周没有课'); return; }
    const blocks = [];
    DAYS.forEach(function (dn, di) {
      const cs = list.filter(function (c) { return c.day === di; }).sort(function (a, b) { return a.start - b.start; });
      if (!cs.length) return;
      blocks.push({
        label: dn,
        lines: cs.map(function (c) {
          return '第' + c.start + '-' + c.end + '节  ' + c.name +
            (c.teacher ? ' · ' + c.teacher : '') + (c.room ? ' · ' + c.room : '') +
            '  (' + (c.weeks || '1-16') + (c.parity === 'odd' ? ' 单周' : (c.parity === 'even' ? ' 双周' : '')) + ')';
        })
      });
    });
    canvas.exportAndSave(this, '#card', {
      title: wk ? ('第 ' + wk + ' 周课表') : '课程表',
      sub: this.data.weekRange || '未设置开学日期',
      config: [
        ['开学日期', this._term || '未设置'],
        ['课程数', String(list.length)],
        ['周次', wk ? ('第 ' + wk + ' 周') : '全部']
      ],
      blocks: blocks,
      foot: '生成时间 ' + util.timeStr(),
      rec: util.recId('TT')
    });
  },
  onShareAppMessage() {
    const wk = this.data.wk;
    return share.message({
      title: '班级课表｜第 ' + (wk || '?') + ' 周',
      path: '/pages/tt/tt',
      query: wk ? ('wk=' + wk) : '',
      imageUrl: '/images/share/tt.png'
    });
  },
  onShareTimeline() {
    const wk = this.data.wk;
    return share.timeline({
      title: '班级课表｜第 ' + (wk || '?') + ' 周',
      query: wk ? ('wk=' + wk) : '',
      imageUrl: '/images/share/tt.png'
    });
  },
  openMap() {
    const n = this.data.next || {};
    const room = n.room || '';
    wx.navigateTo({ url: '/pages/map/map' + (room ? '?room=' + encodeURIComponent(room) : '') });
  },
});
