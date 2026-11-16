// pages/all/all.js —— 工具（v2.0.0：长按拖动排序 + 「编辑首页」模式勾选首页快捷）
//
// 本页职责（用户 2026-11-06 二次确认的口径）：
//   · 页面主体只有「全部工具」目录（tools.catalog()，顺序 = 本机 toolOrder；管理员额外看到统计）；
//     顶部不再展示「首页快捷」工具行（改由工作台「常用工具」展示勾选结果）。
//   · 「全部工具」标题行右侧按钮：普通态「编辑首页」→ 点开进入「首页快捷编辑模式」，编辑态「完成」→ 点按退出。
//   · 普通模式：没有任何勾选框；点 tile = 打开工具；长按 350ms 拖动排序（幽灵/2 列迟滞/边缘自动滚动/
//     page-meta 锁滚动/拖后抑制 tap）；标题下说明「长按工具可拖动排序」。
//   · 编辑模式：说明变「点工具加入或移出首页快捷（最多 4 个）」；点 tile = 切换是否加入首页快捷（不打开工具）；
//     选中 tile 显示主色描边 + 右侧对勾徽标（未选中空心圆）；勾满 4 个再点第 5 个 → toast「最多选 4 个」；
//     编辑模式内禁用长按拖动；点「完成」退出（切页/onShow 回来也强制退出编辑态）。
//   · 选择顺序/持久化沿用 tools.setHomeTool（≤4、按 toolOrder、立即 save + udPushSoon）
//   · 保留 AI handoff focusKey 高亮/滚动、分享、暗色 token、onCloudSync 重绘。
// 反馈建议 / 使用说明已迁到「我的」页。
const store = require('../../utils/store.js');
const tools = require('../../utils/tools.js');
const identity = require('../../utils/identity.js');
const cloud = require('../../utils/cloud.js');
const share = require('../../utils/share.js');
const agent = require('../../utils/agent.js');
const scrollmem = require('../../utils/scrollmem.js');

const LONG_PRESS_MS = 350;  // 长按多久进入拖动
const MOVE_TOL = 10;        // 长按判定期间允许的抖动（px），超过就取消长按（让页面正常滚动）
const HYST = 0.10;          // 目标格子切换迟滞（归一化距离平方，越小越灵敏）
const AUTO_MS = 80;         // 边缘自动滚动节流
const AUTO_STEP = 14;       // 边缘自动滚动每步 px
const EDGE_RPX = 120;       // 距屏幕上下边缘多少 rpx 内触发自动滚动

// 页面只需要展示字段，避免把整份 TOOLS（含长 desc）塞进 setData
function viewOf(t) {
  return {
    key: t.key,
    name: t.name,
    ico: t.ico,
    icoImg: t.icoImg,
    meta: t.meta || '',
    url: t.url,
    tab: !!t.tab,
    tone: t.tone === 'primary' || t.tone === 'tertiary' ? t.tone : 'secondary'
  };
}

Page({
  data: {
    all: [], focusKey: '',
    editMode: false,          // 首页快捷编辑模式（按钮「编辑首页」/「完成」切换）
    // 拖动状态：dragging = 是否拖动中；dragKey = 被拖工具；ghost = 跟手幽灵（fixed 定位，px）
    dragging: false,
    dragKey: '',
    dragPageStyle: '',        // page-meta 的 page-style：拖动中 overflow:hidden 锁页面滚动
    ghost: { x: 0, y: 0, name: '', ico: '', icoImg: '', tone: 'secondary' }
  },

  onLoad(options) {
    scrollmem.attach(this);
    options = options || {};
    this._agent = agent.pick(this);            // AI 页面接力（wx.onAgentHandoff），只消费一次
    this._agentQ = agent.pickQuery(options);   // 备用：handoff query 随页面参数传入
    this._winCache = null;
  },

  onShow() {
    share.enable();
    scrollmem.restore(this);
    if (!identity.ensure()) return;
    try { store.reload(); } catch (e) { /* 读取失败时沿用内存里的旧数据 */ }
    this._resetDrag();                          // 切页/同步回来时拖动状态不应残留
    this._exitEdit();                           // 切页回来强制退出编辑态（避免误操作）
    this.render();
    this.applyAgentHandoff();
    this._checkScreencast();                    // 2026-11-12：电脑大屏在线时才显示「大屏互联」
  },

  // 大屏在线状态（drop /presence，30s 心跳）；不在线时目录里不出现该工具
  _checkScreencast() {
    const that = this;
    let sc = null;
    try { sc = require('../../utils/screencast.js'); } catch (e) { return; }
    sc.presence().then(function (r) {
      const on = !!(r && r.stage);
      if (on !== !!that._stageOn) {
        that._stageOn = on;
        that.render();
      }
    }).catch(function () {});
  },

  // 云端同步（udPull → udApply）后勾选集合可能变化 → 重新计算（拖动中不打断；编辑态保留以便连续勾选）
  onCloudSync() {
    if (this.data.dragging) return;
    try { store.reload(); } catch (e) { /* ignore */ }
    this.render();
  },

  // —— AI 页面接力：按 payload/query 的 key 定位到某个工具（只高亮/滚动，不自动打开）——
  applyAgentHandoff() {
    if (this._agentApplied) return false;
    this._agentApplied = true;
    const h = this._agent;
    const p = (h && h.payload) || {};
    const q = Object.assign({}, this._agentQ || {}, (h && h.query) || {});
    if (!h && !this._agentQ) return false;
    const key = String(q.key || p.key || p.tool || '');
    if (!key) return true;
    const hit = (this.data.all || []).some(function (x) { return x.key === key; });
    if (hit) {
      this._setFocus(key);
      scrollmem.cancel(this);
      try { wx.pageScrollTo({ selector: '#all-tool-' + key, duration: 240, offsetTop: -120 }); } catch (e) { /* 旧基础库仅高亮 */ }
    }
    return true;
  },
  _setFocus(key) {
    this.setData({ focusKey: key });
    if (this._focusT) clearTimeout(this._focusT);
    this._focusT = setTimeout(() => { this._focusT = null; this.setData({ focusKey: '' }); }, 2400);
  },

  // —— 重绘：全部工具（按 toolOrder）+ 勾选态（编辑模式用于选中徽标/描边）——
  render() {
    const admin = cloud.isAdmin();
    const home = tools.homeTools();
    const homeSet = {};
    home.forEach(function (k) { homeSet[k] = true; });
    const all = tools.catalog().filter(function (t) {
      return !t.admin || admin;                 // 仅「统计」仍是管理员工具；诊断 v2 已对全班可见
    }).map(function (t) {
      const v = viewOf(t);
      v.home = !!homeSet[t.key];
      return v;
    });
    if (this._stageOn) {
      all.push({
        key: 'screencast', name: '大屏互联', ico: '🛰', icoImg: '', meta: '电脑大屏已开启 · 传文件/遥控',
        url: '/pages/screencast/screencast', tab: false, tone: 'tertiary', home: false
      });
    }
    this.setData({ all: all });
  },

  // —— 「编辑首页」/「完成」按钮：切换首页快捷编辑模式 ——
  toggleEditMode() {
    if (this.data.dragging) return;
    this._clearLongPress();
    this.setData({ editMode: !this.data.editMode });
    this.render();                              // 进入/退出编辑态时刷新勾选态（同步可能刚变）
  },

  // —— 点工具 tile：普通模式 = 打开工具；编辑模式 = 切换是否加入首页快捷 ——
  onToolTap(e) {
    if (this.data.dragging) return;
    if (String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || '') === 'screencast') {
      wx.navigateTo({ url: '/pages/screencast/screencast' });
      return;
    }
    if (Date.now() < (this._supTapUntil || 0)) return;
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    if (this.data.editMode) { this.toggleHome(key); return; }
    this.openTool(key);
  },

  openTool(key) {
    const t = tools.toolOf(key);
    if (!t) return;
    if (t.tab) wx.switchTab({ url: t.url });
    else wx.navigateTo({ url: t.url });
  },

  // 编辑模式内切换首页快捷：勾满 4 个再点第 5 个 → toast「最多选 4 个」且状态不变
  toggleHome(key) {
    const item = (this.data.all || []).find(function (x) { return x.key === key; });
    if (!item) return;
    const rev = tools.setHomeTool(key, !item.home);
    if (!rev.ok) {
      if (rev.reason === 'max') wx.showToast({ title: '最多选 4 个', icon: 'none' });
      return;
    }
    this.render();                              // 选中徽标/描边联动刷新
  },

  // —— 长按拖动排序（普通模式；编辑模式禁用） ——
  onToolTouchStart(e) {
    if (this.data.dragging || this.data.editMode) return;
    const ts = e.touches;
    if (!ts || ts.length !== 1) { this._clearLongPress(); return; }
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const t = ts[0];
    this._press = { key: key, x: t.clientX, y: t.clientY, t0: Date.now() };
    this._clearLongPress();
    this._longT = setTimeout(() => { this._longT = null; this._beginDrag(); }, LONG_PRESS_MS);
  },

  onToolTouchMove(e) {
    if (this.data.dragging) { this._dragMove(e); return; }
    const p = this._press;
    const t = e.touches && e.touches[0];
    if (!p || !t) return;
    // 长按判定期间移动 = 用户在滚页面，不进入拖动
    if (Math.abs(t.clientX - p.x) > MOVE_TOL || Math.abs(t.clientY - p.y) > MOVE_TOL) this._clearLongPress();
  },

  onToolTouchEnd() {
    this._clearLongPress();
    // 可能已创建拖动状态但页面还没切到 dragging（异步量格子几何期间用户已松手）→ 一并收尾
    if (this.data.dragging || this._drag) this._endDrag();
  },

  onToolTouchCancel() {
    this._clearLongPress();
    if (this.data.dragging || this._drag) this._cancelDrag();
  },

  _clearLongPress() {
    if (this._longT) { clearTimeout(this._longT); this._longT = null; }
  },

  // 长按到点：进入拖动（先量一次格子几何，再切 dragging 状态）
  _beginDrag() {
    if (this.data.dragging || this.data.editMode || !this._press) return;
    const key = this._press.key;
    const all = this.data.all || [];
    const idx = all.findIndex(function (x) { return x.key === key; });
    if (idx < 0) return;
    const item = all[idx];
    this._drag = {
      key: key,
      curIndex: idx,
      slots: [],
      scrollTop: 0,
      lastAuto: 0,
      lastMeasure: 0,
      keysSnapshot: all.map(function (x) { return x.key; }),
      pointer: { x: this._press.x, y: this._press.y }
    };
    this._supTapUntil = Date.now() + 700;        // 拖动后抑制一次 tap（落定后再顺延）
    try { wx.vibrateShort({ type: 'light' }); } catch (e) { /* 部分机型不支持 */ }
    this._measureSlots(() => {
      if (!this._drag) return;
      this.setData({
        dragging: true,
        dragKey: key,
        dragPageStyle: 'overflow: hidden;',       // 真机拖动中禁止页面滚动（page-meta）
        ghost: {
          x: this._press.x, y: this._press.y,
          name: item.name, ico: item.ico, icoImg: item.icoImg, tone: item.tone
        }
      });
    });
  },

  // 量格子几何（初始 2 列网格位置 + 页面滚动位置）
  _measureSlots(cb) {
    const drag = this._drag;
    if (!drag) { if (cb) cb(); return; }
    let q = null;
    try { q = wx.createSelectorQuery(); } catch (e) { q = null; }
    if (!q) { if (cb) cb(); return; }
    q.selectAll('.tool-cell').boundingClientRect();
    q.selectViewport().scrollOffset();
    q.exec((res) => {
      if (!this._drag) return;
      const rects = (res && Array.isArray(res[0]) ? res[0] : []) || [];
      const vp = (res && res[1]) || {};
      this._drag.slots = rects.map(function (r) {
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      });
      if (vp && typeof vp.scrollTop === 'number') this._drag.scrollTop = vp.scrollTop;
      if (cb) cb();
    });
  },

  // 指针位置 → 目标下标（最近格子中心 + 迟滞；slot 位置在拖动期间不变，所以不必每次重排后重量）
  _targetIndex(px, py) {
    const drag = this._drag;
    if (!drag || !drag.slots.length) return -1;
    let best = -1, bestD = Infinity, curD = Infinity;
    for (let i = 0; i < drag.slots.length; i++) {
      const s = drag.slots[i];
      const cx = s.left + s.width / 2;
      const cy = s.top + s.height / 2;
      const dx = (px - cx) / Math.max(1, s.width);
      const dy = (py - cy) / Math.max(1, s.height);
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
      if (i === drag.curIndex) curD = d;
    }
    if (best < 0) return -1;
    // 迟滞：指针要明显更靠近新格子才切换，避免在边界来回抖动
    if (drag.curIndex >= 0 && best !== drag.curIndex && isFinite(curD) && bestD > curD - HYST) return drag.curIndex;
    return best;
  },

  _dragMove(e) {
    const drag = this._drag;
    const t = e.touches && e.touches[0];
    if (!drag || !t) return;
    const px = t.clientX, py = t.clientY;
    const g = this.data.ghost;
    if (Math.abs(px - g.x) >= 1 || Math.abs(py - g.y) >= 1) this.setData({ 'ghost.x': px, 'ghost.y': py });
    const target = this._targetIndex(px, py);
    if (target >= 0 && target !== drag.curIndex) this._reorderTo(target);
    this._autoScroll(px, py);
  },

  // 实时重排 data.all（被拖工具插到 target 位置，其余顺延）；wx:key=key，DOM 复用不闪
  _reorderTo(target) {
    const drag = this._drag;
    if (!drag) return;
    const all = (this.data.all || []).slice();
    const cur = all.findIndex(function (x) { return x.key === drag.key; });
    if (cur < 0 || target < 0 || target >= all.length || target === cur) return;
    const item = all.splice(cur, 1)[0];
    all.splice(target, 0, item);
    drag.curIndex = target;
    this.setData({ all: all });
  },

  // 边缘自动滚动：指针距屏幕上/下边缘 < 120rpx 时用 wx.pageScrollTo 小步滚动（节流 80ms）
  _autoScroll(px, py) {
    const drag = this._drag;
    if (!drag) return;
    const now = Date.now();
    if (now - drag.lastAuto < AUTO_MS) return;
    const win = this._win();
    const edge = Math.max(36, win.ww * EDGE_RPX / 750);
    let dir = 0;
    if (py < edge) dir = -1;
    else if (py > win.wh - edge) dir = 1;
    if (!dir) return;
    drag.lastAuto = now;
    const next = Math.max(0, drag.scrollTop + dir * AUTO_STEP);
    try {
      wx.pageScrollTo({
        scrollTop: next,
        duration: 0,
        success: () => {
          setTimeout(() => {
            if (!this._drag) return;
            this._measureSlots();                // 滚动后重新取几何（坐标已变）
          }, 30);
        },
        fail: () => { /* 旧基础库/不可滚时忽略 */ }
      });
    } catch (e) { /* ignore */ }
  },

  _win() {
    if (this._winCache) return this._winCache;
    let w = null;
    try {
      w = wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : null);
    } catch (e) { w = null; }
    this._winCache = (w && w.windowWidth) ? { ww: w.windowWidth, wh: w.windowHeight } : { ww: 375, wh: 667 };
    return this._winCache;
  },

  // 松手落定：保存 toolOrder（本机偏好）+ 按新顺序重排 homeTools（勾选集合不变）+ 重绘
  _endDrag() {
    const drag = this._drag;
    if (!drag) return;
    const keys = (this.data.all || []).map(function (x) { return x.key; });
    const changed = drag.keysSnapshot.join(',') !== keys.join(',');
    this._drag = null;
    this.setData({
      dragging: false, dragKey: '', dragPageStyle: '',
      ghost: { x: 0, y: 0, name: '', ico: '', icoImg: '', tone: 'secondary' }
    });
    if (changed) tools.setToolOrder(keys);
    this._supTapUntil = Date.now() + 350;
    this.render();
  },

  // 被系统打断（来电/多指等）：放弃本次拖动，恢复持久化顺序（不落盘）
  _cancelDrag() {
    const had = !!this._drag;
    this._drag = null;
    this.setData({
      dragging: false, dragKey: '', dragPageStyle: '',
      ghost: { x: 0, y: 0, name: '', ico: '', icoImg: '', tone: 'secondary' }
    });
    if (had) {
      this._supTapUntil = Date.now() + 350;
      this.render();
    }
  },

  _exitEdit() {
    if (!this.data.editMode) return false;
    this.setData({ editMode: false });
    return true;
  },

  _resetDrag() {
    this._clearLongPress();
    if (this._focusT) { clearTimeout(this._focusT); this._focusT = null; }
    if (this.data.dragging || this._drag) {
      this._drag = null;
      this.setData({ dragging: false, dragKey: '', dragPageStyle: '' });
    }
  },

  onPageScroll(e) {
    scrollmem.onScroll(this, e);
    // 兜底：真机上万一页面被滚动（page-meta 未生效），拖动中重新量几何，幽灵/目标不跑偏
    if (this._drag) {
      const now = Date.now();
      if (!this._drag.lastMeasure || now - this._drag.lastMeasure > 120) {
        this._drag.lastMeasure = now;
        this._measureSlots();
      }
    }
  },
  onHide() { scrollmem.save(this); this._resetDrag(); },
  onUnload() { scrollmem.save(this); this._resetDrag(); },
  onShareAppMessage() {
    return share.message({
      title: '班级工具｜全部功能一页打开',
      path: '/pages/all/all',
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '班级工具｜全部功能一页打开',
      imageUrl: '/images/share/default.png'
    });
  }
});
