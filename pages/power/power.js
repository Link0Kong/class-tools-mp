// pages/power/power.js —— 宿舍电费「数据仪表盘」（v2.0.0：与网站 POWER v3.1 功能同步）
//
// 信息结构（与网站一致）：
//   * 关注宿舍选择：自定义 bottom-sheet（楼栋 pill + 房间网格；替换原生两列选择器）——
//     未选择时页面 0 请求；点房间 = 立即选中并收起（同时拉数据）；
//   * 趋势区间 chips：24h / 7天 / 30天（默认 24h；选择只记本机 zq_power_range_v1，不进 UD 同步）；
//   * 大号剩余电量（fmtMain）+ 环形（24h 估算可用天数/30）+ 状态（≥60 充足 / 30–60 偏低 / <30 低电，低电标红）+ 最近更新；
//   * 近 24h/7天/30天趋势：canvas 2d 折线（面积渐变 + 折线 + 2 条网格 + 末点；DPR 清晰；y 轴 hi/中/lo 刻度；
//     x 轴 3/4/5 个刻度：24h HH:MM、7d/30d MM-DD）；「期间有充值」徽标；
//   * 4 个指标 tile：估算可用（24h）/ 区间用电 / 低电阈值 30 度 / 上次充值（30d 最后一次充值量 + 时间，切档不变）；
//   * 刷新 + 下拉刷新；当前电量 2 分钟 TTL；history 每区间 5 分钟缓存；估算可用/低电条始终用 24h。
//   * 进入页面且已有关注宿舍、当前电量行成功但 24h 历史 <2 点（首轮网络抖动/空结果）→ 自动静默重试一次
//     （force=true 绕过 5 分钟缓存，延迟约 650ms；每个「宿舍 + 区间」最多 1 次，不循环）；成功后自动重绘趋势；
//     真实数据不足时最终仍显示「数据积累中」。
// 选择进同步：userdata v6 的 power section（{sel,at}），本机 zq_power_sel_<sid> 只作离线兜底。
// 隐私：只显示规范楼栋 + 房间号 + 电量 + 时间，不含姓名 / 学号；不提供导出/分享内容（分享仅页面入口）。
const store = require('../../utils/store.js');
const identity = require('../../utils/identity.js');
const cloud = require('../../utils/cloud.js');
const power = require('../../utils/power.js');
const waterUtil = require('../../utils/water.js');
const util = require('../../utils/util.js');
const share = require('../../utils/share.js');
const scrollmem = require('../../utils/scrollmem.js');

const SELKEY = 'zq_power_sel_';
const RANGE_KEY = 'zq_power_range_v1';
const LOWKEY = 'zq_power_low_';
function fallbackKey() { return SELKEY + (identity.sid() || ''); }
function lowKey() { return LOWKEY + (identity.sid() || ''); }
function readFallback() {
  try { return String(wx.getStorageSync(fallbackKey()) || ''); } catch (e) { return ''; }
}
function writeFallback(rv) {
  try {
    if (rv) wx.setStorageSync(fallbackKey(), rv);
    else wx.removeStorageSync(fallbackKey());
  } catch (e) { /* 离线兜底写失败不影响云端真源 */ }
}
function readLowFallback() {
  try { return power.normLow(wx.getStorageSync(lowKey())); } catch (e) { return 30; }
}
function writeLowFallback(low) {
  try { wx.setStorageSync(lowKey(), String(power.normLow(low))); } catch (e) { /* ignore */ }
}
function readRange() {
  try {
    const k = String(wx.getStorageSync(RANGE_KEY) || '');
    return power.rangeMeta(k).k === k ? k : '24h';
  } catch (e) { return '24h'; }
}
function writeRange(k) { try { wx.setStorageSync(RANGE_KEY, k); } catch (e) { /* ignore */ } }
// 增量 43（与网页增量 42 同口径）：13/16 号楼不展示 24h 档（隐藏按钮，选中时默认落 7 天）
function rangesFor(rv) {
  const b = power.buildingOf(rv);
  return power.RANGES.filter(function (r) { return power.showRange(b, r.k); }).map(function (r) { return { k: r.k, label: r.label }; });
}
function rangeAllowed(rv, k) { return power.showRange(power.buildingOf(rv), power.rangeMeta(k).k); }
const RING_COLOR = { ok: '#4E9082', warn: '#C79A5A', low: '#C0605A', idle: '#9AA7A1' };
// 2026-11-06 修复「进入页面趋势卡偶发数据积累中、需手动刷新」：
//   AUTO_RETRY_DELAY：24h 历史 <2 点时自动静默重试的延迟（用户可感知前完成，约 0.5–0.8s）；
//   DRAW_RETRY_DELAY：canvas 节点未就绪（首帧 / wx:if 刚显示）时补一次重绘的延迟。
const AUTO_RETRY_DELAY = 650;
const DRAW_RETRY_DELAY = 180;
// 趋势绘图内边距（与 _drawTrend 完全一致；游标的竖线/圆点也按同一坐标系定位，保证落在折线上）
const PLOT_PAD_X = 6;
const PLOT_PAD_T = 12;
const PLOT_PAD_B = 10;
// 空游标状态（cursor.left/top = 命中采样点像素；气泡固定显示在趋势图右上角上部，只更新 text）
function cursorOff() {
  return { on: false, left: 0, top: 0, text: '' };
}
function ringStyle(arcs, st) {
  const pct = Math.max(0, Math.min(100, arcs * 100));
  const color = RING_COLOR[st] || RING_COLOR.idle;
  return 'background:conic-gradient(' + color + ' 0% ' + pct.toFixed(2) + '%, var(--md-surface-container-high) ' + pct.toFixed(2) + '% 100%);';
}
function emptyTrend(rangeKey) {
  const m = power.rangeMeta(rangeKey);
  return {
    empty: true, note: '未选择宿舍', title: m.title, dropLabel: m.dropLabel,
    startLabel: m.k === '24h' ? '起点' : '起',
    startText: '—', curText: '—', dropText: '—', hiText: '—', midText: '—', loText: '—',
    recharge: false, xTicks: [],
    // v13（规格 power_cadence_spec.md §3）：慢频房固定「日更」徽标 + 所选区间无更新提示（画在 canvas 绘图区）
    daily: false, dailyText: '', dailyTitle: '', noUpd: ''
  };
}

Page({
  data: {
    state: 'idle',            // idle（未选择）| loading | ready | error
    errorText: '',
    hasSel: false,
    sel: '',
    selLabel: '',
    // 趋势区间（24h / 7天 / 30天；本机记忆，不同步）
    range: '24h',
    ranges: power.RANGES.map(function (r) { return { k: r.k, label: r.label }; }),
    rangeTitle: power.rangeMeta('24h').title,
    rangeTile: power.rangeMeta('24h').tile,
    // v5：可调低电阈值（默认 30；档位与网站一致，无 70/90）
    low: 30,
    lowOptions: power.LOW_OPTIONS,
    lowOpen: false,
    // 自定义选择弹层（替代原生两列选择器）
    sheetOpen: false,
    buildings: power.BLDS,
    activeBuilding: power.BLDS[0],
    buildingRooms: power.roomsOfBuilding(power.BLDS[0]),
    selectedRv: '',
    room: null,               // { label, q, unit, upd }
    qText: '—',
    unit: '度',
    stateKey: 'idle',
    stateText: '未选择',
    gaugeStyle: '',
    updText: '',
    trend: emptyTrend('24h'),
    chartW: 0,                // 绘图内容宽（= canvasW；全量压缩绘制，无横滑）
    canvasW: 0,               // 固定 canvas 宽 = 绘图区宽
    cursor: cursorOff(),     // 曲线查看游标：left/top=命中采样点像素；气泡固定在趋势图右上角（只更新 text）
    tiles: [],
    // 电量统计「计费规则」条（2026-11-06 用户反馈：电费计费规则放进电量统计 tiles 区下方）
    bill: null,
    lowOn: false,
    lowText: '',
    footer: ''
  },

  onLoad(options) {
    scrollmem.attach(this);
    options = options || {};
    this._first = true;
    this._loading = false;
    this._linePoints = [];
    this._xTicks = [];
    this._canvasDrawn = false;
    this._row = null;
    this._hist24 = [];
    this._hist7 = [];
    this._histRange = [];
    // 30d 全量历史（所有房间，云端只保留 30 天）：慢频房估算按真实变化点；
    // 实时房「上次充值」跨区间取 30d 最后上调（2026-11-21）。
    this._hist30 = [];
    this._hist30rv = '';      // _hist30 属于哪个房间（换房丢弃，避免串房）
    // 增量 43：比较取数窗口（14d/70d）缓存 + 当前比较窗口键 + 慢楼栋自动档位恢复
    this._histCmp = [];
    this._cmpKey = '';
    this._rangeBeforeSlow = '';
    this._lastSyncSel = undefined;
    this._slowCadence = false; // 当前渲染是否慢频口径（=isSlowRoom）→ canvas 阶梯线/变化点/无更新提示
    this._noUpd = '';         // 所选区间无更新提示（''=不显示；画在 canvas 绘图区内）
    this._cw = 0;             // 绘图容器宽（px，测得）
    this._cwMeasured = false;
    this._chartW = 0;         // 内容宽（= canvas 宽）
    this._plotLeft = 0;       // 绘图区左边缘（clientX 换算）
    this._touchActive = false;
    this._touchStartX = 0;
    this._touchMoved = false;
    this._cursorIndex = -1;
    this._plotH = 0;          // 绘图区实际高（px，_drawTrend 用 canvas 节点测量值回填；游标几何按它定位）
    // 2026-11-06 修复：自动静默重试 / canvas 兜底重绘状态（每次页面进入重置，不跨页面实例）
    this._autoRetryKeys = {}; // 'rv|range' -> 1：每个「宿舍 + 区间」最多自动重试 1 次，不循环
    this._autoRetryT = null;  // 排队中的自动重试定时器
    this._drawRetryN = 0;     // canvas 节点未就绪时的兜底重绘次数（每次渲染最多 1 次）
    this._drawRetryT = null;  // canvas 兜底重绘定时器
    const rng = readRange();
    this.setData({ range: rng, rangeTitle: power.rangeMeta(rng).title, rangeTile: power.rangeMeta(rng).tile });
    this._syncSel(true);
  },
  onReady() { this._drawTrend(); },

  onShow() {
    share.enable();
    if (!identity.ensure()) return;
    scrollmem.restore(this);
    try { store.reload(); } catch (e) { /* ignore */ }
    const changed = this._syncSel(false);
    if (this._first) {
      this._first = false;
      if (this.data.hasSel) this.load(false);
      else this.setData({ state: 'idle' });
    } else if (changed && this.data.hasSel) {
      this.load(false);
    } else if (!this.data.trend.empty) {
      this._drawTrend();                       // 切回页面重绘折线（canvas 可能已重建）
    }
  },
  onHide() { scrollmem.save(this); },
  onUnload() { scrollmem.save(this); this._cancelTimers(); },
  // 清理本页定时器（自动重试 / canvas 兜底），避免离页后回调落到已销毁页面
  _cancelTimers() {
    if (this._autoRetryT) { clearTimeout(this._autoRetryT); this._autoRetryT = null; }
    if (this._drawRetryT) { clearTimeout(this._drawRetryT); this._drawRetryT = null; }
    if (this._measureFallbackT) { clearTimeout(this._measureFallbackT); this._measureFallbackT = null; }
  },
  onResize() { this._cwMeasured = false; this._renderWhenReady(); },   // v4：窗口变化重新量宽/重绘  onPageScroll(e) { scrollmem.onScroll(this, e); },
  /* 下拉刷新：等回弹结束、页面回到原位后再重新量宽/绘线。
     否则 canvas 原生层会在回弹中按中间宽度/高度绘制，曲线与 x/y 轴覆盖层出现“漂移”。 */
  _finishPullDown() {
    try { wx.stopPullDownRefresh(); } catch (e) { /* 旧基础库/单测无此 API */ }
    setTimeout(() => {
      if (!this._row || this.data.state !== 'ready') return;
      this._cwMeasured = false;
      this._renderWhenReady();
    }, 90);
  },
  onPullDownRefresh() {
    if (!this.data.hasSel) { wx.stopPullDownRefresh(); this.setData({ state: 'idle' }); return; }
    this.load(true).then(() => this._finishPullDown()).catch(() => this._finishPullDown());
  },
  // 云端 userdata 应用后（换端选择变化）同步关注宿舍并重载
  onCloudSync() {
    const changed = this._syncSel(false);
    if (changed && this.data.hasSel) this.load(false);
  },

  /* ---------------- 趋势区间（24h / 7天 / 30天；只记本机） ---------------- */
  pickRange(e) {
    const k = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.k) || '');
    if (power.rangeMeta(k).k !== k || k === this.data.range) return;
    const m = power.rangeMeta(k);
    writeRange(k);
    this._linePoints = [];
    this._xTicks = [];
    this._canvasDrawn = false;
    this._cursorIndex = -1;
    this.setData({
      range: k,
      rangeTitle: m.title,
      rangeTile: m.tile,
      cursor: cursorOff(),
      trend: emptyTrend(k)
    });
    if (!this.data.hasSel) return;
    // 切换区间只在缓存过期时拉：区间缓存 + 24h 缓存都新鲜 → 直接用缓存重绘，0 请求
    // 2026-11-21：所有房间都需要 30d 缓存（「上次充值」取 30d 全量最后一次上调，切档不变），缺则走 load 补拉
    const rv = this.data.sel;
    const slowBld = power.isSlowBuilding(power.buildingOf(rv));
    this._rangeBeforeSlow = '';          // 用户手选档位 → 不再自动恢复
    const cached = cloud.powerHistCached(rv, k);
    const cached24 = k === '24h' ? cached : cloud.powerHistCached(rv, '24h');
    const cached30 = k === '30d' ? cached : cloud.powerHistCached(rv, '30d');
    // 增量 43：比较取数窗口缓存（7d→14d/30d；30d→70d；24h 用 7d）——缺失则走 load 补拉
    const cmpKey = power.cmpSourceKey(k, slowBld);
    const cachedCmp = !cmpKey || cmpKey === '7d' || cmpKey === '30d'
      ? true
      : (cmpKey === k ? !!cached : !!cloud.powerHistCached(rv, cmpKey));
    if (cached && (k === '24h' || cached24) && cached30 && cachedCmp && this._row) {
      this._histRange = power.normalizeHistory(cached);
      if (k === '24h') this._hist24 = this._histRange;
      else this._hist24 = power.normalizeHistory(cached24);
      this._hist30 = power.normalizeHistory(cached30);
      this._hist30rv = rv;
      if (cmpKey && cmpKey !== '7d' && cmpKey !== '30d') {
        this._histCmp = power.normalizeHistory(cmpKey === k ? cached : cloud.powerHistCached(rv, cmpKey));
        this._cmpKey = rv + '|' + cmpKey;
      }
      this._renderWhenReady();
    } else {
      this.load(false).then(() => this._drawTrend());
    }
  },

  /* ---------------- 自定义宿舍选择弹层（替换原生两列选择器） ---------------- */
  // 2026-11-08 修复（用户反馈：趋势图的线会盖住宿舍选择框）：
  //   单层渲染不支持的机型/基础库上 `canvas type=2d` 是原生组件，层级始终高于页面 view（即使弹层 z-index 更高）。
  //   因此任何覆盖层（宿舍 bottom-sheet / 低电阈值面板）打开时用 wx:if 把 #pwTrend 移除（保留空态占位），
  //   关闭后在 setData 回调 + wx.nextTick 里重绘（复用 _drawTrend/_renderData，不重复请求）。
  _trendOverlayOpen() { return !!(this.data.sheetOpen || this.data.lowOpen); },
  _redrawAfterOverlay() {
    if (this._trendOverlayOpen()) return;
    const redraw = () => {
      if (this._trendOverlayOpen()) return;
      if (!this._row) return;                                     // 未选择/无数据：无需绘制
      if (this._linePoints && this._linePoints.length >= 2) this._drawTrend();   // 复用点位直接重绘（0 请求）
      else this._renderData();                                    // 空态/不足 2 点：按现有数据重算（0 请求）
    };
    try { if (wx.nextTick) wx.nextTick(redraw); else setTimeout(redraw, 0); }
    catch (e) { setTimeout(redraw, 0); }
  },
  openSheet() {
    const b = power.buildingOf(this.data.sel) || this.data.buildings[0];
    this.setData({
      sheetOpen: true,
      activeBuilding: b,
      buildingRooms: power.roomsOfBuilding(b),
      selectedRv: this.data.sel
    });
  },
  closeSheet() {
    if (!this.data.sheetOpen) return;
    this.setData({ sheetOpen: false }, () => { this._redrawAfterOverlay(); });
  },
  noop() { /* 阻止弹层内点击冒泡到遮罩 */ },
  pickBuilding(e) {
    const b = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.b) || '');
    if (this.data.buildings.indexOf(b) < 0) return;
    this.setData({ activeBuilding: b, buildingRooms: power.roomsOfBuilding(b) });
  },
  pickRoom(e) {
    const rv = power.normalizeSel((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.rv) || '');
    if (!rv) return Promise.resolve(false);
    this.setData({ sheetOpen: false, selectedRv: rv }, () => { this._redrawAfterOverlay(); });   // 点房间 = 立即选中并收起
    return this.pick(rv);
  },

  // 从 store.power（真源本机镜像）或离线兜底键恢复选择；返回是否变化
  // 注意：非法 roomverify 一律降级为「未选择」（不显示脏数据，也不会发请求）。
  _syncSel(force) {
    const sp = store.get().power || {};
    const base = store.get().udCache;
    // 本机兜底键只在「没有云端基线」时补位：一旦有 udCache，云端 power 是权威值，
    // 云端明确清空选择时不能被旧兜底键复活（否则换端取消关注会失效）。
    const allowFallback = !base || !base.power || base.power.sel === undefined;
    let rv = power.normalizeSel(sp.sel);
    if (!rv && allowFallback) {
      const fb = power.normalizeSel(readFallback());
      if (fb) {
        const d = store.get();
        d.power = { sel: fb, at: Date.now(), low: power.normLow(d.power && d.power.low) };
        store.save();                     // 旧本机兜底选择一次性并入 UD（触发脏检测推送）
        writeFallback(fb);
        rv = fb;
      }
    }
    if (!rv && !allowFallback && readFallback()) writeFallback('');   // 云端已明确空 → 清掉陈旧兜底
    else if (rv && !allowFallback && readFallback() !== rv) writeFallback(rv);
    // v5：低电阈值（UD.power.low 真源；旧数据缺省 30；本机兜底键仅补位）
    let low = power.normLow(sp.low);
    if (!sp.at && readLowFallback()) low = readLowFallback();
    const lowChanged = low !== this.data.low;
    const changed = force || rv !== this.data.sel || (!!rv) !== this.data.hasSel || lowChanged;
    if (!changed) return false;
    if (lowChanged) {
      const d = store.get();
      d.power = { sel: rv, at: Date.now(), low: low };   // 阈值变化 → UD.power 变脏并按 LWW 推送
      store.save();
      writeLowFallback(low);
    }
    // 增量 43：13/16 号楼隐藏 24h 档位；选中时自动落 7 天，切回实时房恢复进入前档位
    const selChanged = force || rv !== this._lastSyncSel;
    this._lastSyncSel = rv;
    let range = this.data.range;
    let rangeNorm = false;
    if (!rv) {
      if (this._rangeBeforeSlow) { range = this._rangeBeforeSlow; this._rangeBeforeSlow = ''; rangeNorm = true; }
    } else if (selChanged && !rangeAllowed(rv, range)) {
      if (!this._rangeBeforeSlow) this._rangeBeforeSlow = range;
      range = '7d'; rangeNorm = true;
    } else if (selChanged && this._rangeBeforeSlow && !power.isSlowBuilding(power.buildingOf(rv))) {
      range = this._rangeBeforeSlow; this._rangeBeforeSlow = ''; rangeNorm = true;
    }
    const ranges = rangesFor(rv);
    this.setData({
      sel: rv,
      hasSel: !!rv,
      selLabel: power.labelOf(rv),
      selectedRv: rv,
      low: low,
      ranges: ranges,
      range: range,
      rangeTitle: power.rangeMeta(range).title,
      rangeTile: power.rangeMeta(range).tile
    });
    if (rangeNorm) { this._linePoints = []; this._xTicks = []; this._canvasDrawn = false; this._cursorIndex = -1; }
    if (!rv) {
      this._linePoints = [];
      this._xTicks = [];
      this._canvasDrawn = false;
      this._row = null;
      this._hist24 = [];
      this._hist7 = [];
      this._histRange = [];
      this._hist30 = [];
      this._hist30rv = '';
      this._slowCadence = false;
      this._noUpd = '';
      this._cursorIndex = -1;
      this.setData({
        state: 'idle', errorText: '', room: null, qText: '—', unit: '度',
        stateKey: 'idle', stateText: '未选择', gaugeStyle: ringStyle(0, 'idle'),
        updText: '', trend: emptyTrend(this.data.range), chartW: 0, cursor: cursorOff(),
        tiles: power.tilesOf(null, null, null, power.rangeMeta(this.data.range), this.data.low),
        bill: null,
        lowOn: false, lowText: '', footer: '选择保存在账号里，换设备登录会同步'
      });
    }
    return true;
  },

  // 拉取当前电量 + 所选区间采样 + 24h 采样（2 分钟电量 TTL；history 每区间 5 分钟缓存；force 跳过）
  // 2026-11-21：**所有房间**都拉 30d history（云端只保留 30 天）——慢频房供 slowStats/estimateSlow，
  //   实时房供「上次充值」跨区间（30d 最后一次上调）；选中 30d 时复用 powerPull 的 hist，不重复请求。
  //   30d 失败/为空不阻塞其它窗口（慢频估算「数据积累中」；上次充值回退所选区间 lastUp）。
  // silent=true：自动静默重试（不弹「刷新失败」toast、不改错误态），失败时保留上次展示
  load(force, silent) {
    const rv = this.data.sel;
    const rng = this.data.range;
    if (!rv) return Promise.resolve(false);
    if (this._autoRetryT) { clearTimeout(this._autoRetryT); this._autoRetryT = null; }  // 新的加载 → 取消排队中的自动重试
    if (this._loading) return Promise.resolve(false);
    this._loading = true;
    if (!this.data.room) this.setData({ state: 'loading', errorText: '' });
    const slowBld = power.isSlowBuilding(power.buildingOf(rv));
    if (this._hist30rv !== rv) { this._hist30 = []; this._hist30rv = rv; }   // 换宿舍：丢弃上一间 30d
    // 选中 30d 时 powerPull 的 hist 即 30d（避免重复请求）；否则所有房间并行拉 30d
    const p30 = (rng !== '30d') ? cloud.powerHistory(rv, '30d', !!force) : null;
    // 增量 43：比较取数窗口（24h→7d 已随 pull 拉取；7d→14d/30d；30d→70d）已缓存则不重复请求
    const cmpKey = power.cmpSourceKey(rng, slowBld);
    const cmpTag = rv + '|' + cmpKey;
    if (this._cmpKey !== cmpTag) { this._histCmp = []; this._cmpKey = cmpTag; }
    const needCmp = !!(cmpKey && cmpKey !== '7d' && cmpKey !== '30d' && !cloud.powerHistCached(rv, cmpKey));
    const pCmp = needCmp ? cloud.powerHistory(rv, cmpKey, !!force) : null;
    return Promise.all([cloud.powerPull(rv, rng, !!force), p30, pCmp]).then((arr) => {
      const r = arr[0];
      this._loading = false;
      if (this.data.sel !== rv) return false;             // 已切换宿舍：丢弃过期响应
      if (!r || !r.ok || !r.row) {
        if (this.data.room) {
          this.setData({ state: 'ready' });
          if (!silent) util.toast('刷新失败，显示上次数据');
        } else if (!silent) {
          this.setData({ state: 'error', errorText: '加载失败，点「刷新」重试' });
        }
        return false;
      }
      writeFallback(rv);
      this._row = power.normalizeRow(r.row);
      this._hist24 = power.normalizeHistory(r.hist24);
      this._hist7 = power.normalizeHistory(r.hist7);
      this._histRange = power.normalizeHistory(r.hist);
      // 30d 全量历史（所有房间）：慢频房用于 estimateSlow；实时房用于跨区间「上次充值」。
      // 失败保留上次；首次失败为空（慢频估算→「数据积累中」、上次充值→回退所选区间 lastUp）。
      const h30 = power.normalizeHistory(rng === '30d' ? r.hist : arr[1]);
      if (h30.length || !this._hist30.length) this._hist30 = h30;
      // 增量 43：比较取数窗口（14d/70d；7d/30d 走已拉窗口）——失败保留上次，不阻塞主渲染
      if (cmpKey && cmpKey !== '7d' && cmpKey !== '30d') {
        const hc = power.normalizeHistory(arr[2]);
        if (hc.length || !this._histCmp.length) this._histCmp = hc;
      }
      this._renderWhenReady();
      // 行已成功但 24h 历史 <2 点：多为首次 history 请求网络抖动被静默吞掉 / 首轮空结果
      // → 自动静默重试一次（force 绕缓存），成功后重绘趋势；每个「宿舍 + 区间」最多 1 次。
      if (this._hist24.length < 2) this._autoRetrySparse(rv, rng);
      return true;
    }).catch(() => {
      this._loading = false;
      if (this.data.room) {
        this.setData({ state: 'ready' });
        if (!silent) util.toast('刷新失败，显示上次数据');
      } else if (!silent) {
        this.setData({ state: 'error', errorText: '加载失败，点「刷新」重试' });
      }
      return false;
    });
  },

  // 24h 历史 <2 点时的自动静默重试（2026-11-06 用户反馈修复）：
  //   * force=true → 绕过 history 5 分钟缓存（包括历史上被空结果毒化的缓存）；
  //   * 延迟 AUTO_RETRY_DELAY（650ms）→ 弱网抖动/冷启动 DNS 恢复窗口，用户无需手动刷新；
  //   * 每个「宿舍 + 区间」只在 _autoRetryKeys 记一次 → 最多 1 次，不循环；
  //     真实数据不足（只有 1 个采样点）时不再自动请求，最终保留「数据积累中」。
  _autoRetrySparse(rv, rng) {
    const key = rv + '|' + rng;
    if (this._autoRetryKeys[key]) return;               // 已自动重试过 → 不再重试（不循环）
    this._autoRetryKeys[key] = 1;
    if (this._autoRetryT) { clearTimeout(this._autoRetryT); this._autoRetryT = null; }
    this._autoRetryT = setTimeout(() => {
      this._autoRetryT = null;
      if (!this.data.hasSel || this.data.sel !== rv || this.data.range !== rng) return;  // 已换宿舍/区间/离开
      this.load(true, true).then((ok) => { if (ok) this._drawTrend(); });                // 成功后自动重绘趋势
    }, AUTO_RETRY_DELAY);
  },

  // 用当前 _row / _hist24 / _hist7 / _histRange / _hist30 渲染仪表盘 + 区间趋势（不发起请求）
  _renderData(forceRender) {
    if (!forceRender && !this._cwMeasured) { this._renderWhenReady(); return; }
    const row = this._row;
    const hist24 = this._hist24 || [];
    const hist7 = this._hist7 || [];
    const histRange = this._histRange || hist24;
    const hist30 = this._hist30 || [];
    const rng = this.data.range;
    const meta = power.rangeMeta(rng);
    const low = power.normLow(this.data.low);
    const dRange = power.deriveRange(histRange, row);
    // v13（规格 §1.3/§1.5）：13/16 号楼 = 慢频（按真实变化点统计）；23A/23B = 实时（24h/7d 双窗口，§1.4 守卫）。
    // 数据覆盖：慢频楼栋 24h 变化 ≥6 次说明网关已提速 → 自动按实时口径，避免慢口径把高频变化当噪声。
    const slowRoom = power.isSlowRoom(this.data.sel, hist24);
    // 增量 43：自然周期同期比较（24h→昨日/7d→上周/30d→上月同期；覆盖不足/历史不足时 null → 不显示）
    // 取数窗口与 load 一致按楼栋判定：7d 慢楼栋用已预取的 30d、实时楼栋用 14d；30d 用 70d。
    const cmpKey = power.cmpSourceKey(rng, power.isSlowBuilding(power.buildingOf(this.data.sel)));
    const cmpHist = cmpKey === '7d' ? hist7 : (cmpKey === '30d' ? hist30 : (this._histCmp || []));
    const cmp = cmpKey ? power.naturalCompare(rng, cmpHist, Date.now()) : null;
    const est = slowRoom
      ? power.estimateSlow(hist30, row)                     // 30d 缓存；未加载完 → valid=false（数据积累中）
      : power.estimate(hist24, hist7, row);                 // 实时房：保留现有双窗口 + §1.4 守卫
    // 2026-11-21：上次充值跨区间（与安卓 PowerStats.lastRecharge/tilesOf 同口径）——
    // 慢频房用 30d 慢频统计的最后上升 est.lastRecharge，实时房用 30d 全量历史最后一次上调；
    // 30d 缺失时 null → tilesOf 回退所选区间 lastUp（旧预览/测试向后兼容）。
    const crossRecharge = slowRoom ? (est.lastRecharge || null) : power.lastRecharge(hist30);
    const slow = power.slowUpdate(hist24);                 // 实时房原有「数据更新较慢」徽标数据（慢频房改「日更」）
    const slowOn = !!(slow.slow && hist24.length >= 2 && !slowRoom);
    const st = power.stateOf(row, low);
    const q = row ? row.q : null;
    const arcs = power.ringArc(row, est);                 // v5：环 = estimate.days/30
    // 慢频图：不降采样（阶梯线 + 真实变化点保真；全采样按真实时间比例压缩铺满）；实时房沿用各区间降采样上限
    const tl = slowRoom
      ? power.trendLine(histRange, Math.max(2, histRange.length))
      : power.trendLine(histRange, power.trendLimit(rng));
    const noUpd = slowRoom ? power.noUpdateText(rng, histRange) : '';
    this._linePoints = tl.points || [];        // canvas 绘制用（不进 data；x 已按时间比例 0–1）
    this._rechargeMarks = tl.rechargeMarks || [];   // 充值位置（画竖虚线；趋势值已折算）
    this._slowCadence = slowRoom;              // canvas：阶梯线 + 变化点圆点 + 无更新提示（画在绘图区内）
    this._noUpd = noUpd;
    if (!this._cw) {
      let win = {};
      try { win = wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {}); } catch (e) { win = {}; }
      // 测宽失败时的保守兜底：按窗宽 70% 估绘图区宽（宁可窄一点，绝不超过容器）
      this._cw = power.fallbackContainerW(win.windowWidth || 390);
    }
    this._chartW = this._cw;
    this._cursorIndex = -1;
    this._xTicks = power.xticksWindow(this._linePoints, rng, this._cw, this._cw, 0);
    this._canvasDrawn = false;
    this._drawRetryN = 0;          // 每次渲染重新给 canvas 兜底重绘 1 次机会
    // hero 更新时间：慢频房用真实变化点（30d lastChange）；30 天内无变化 → 「近 30 天无变化」；实时房用云端 updated_at
    const updText = slowRoom
      ? (est.lastChange != null
        ? ('更新 ' + power.updText(new Date(est.lastChange).toISOString()))
        : (hist30.length ? '近 30 天无变化' : '—'))
      : (row && row.upd ? ('更新 ' + power.updText(row.upd)) : '—');
    const trend = {
      empty: tl.empty, note: tl.note,
      title: meta.title, dropLabel: meta.dropLabel, startLabel: rng === '24h' ? '起点' : '起',
      startText: power.fmtDrop(dRange.start),
      curText: power.fmtDrop(q != null ? q : dRange.end),
      dropText: power.fmtDrop(dRange.drop != null && dRange.drop > 0 ? dRange.drop : null),
      hiText: tl.hi != null ? tl.hi.toFixed(1) : '—',
      midText: tl.mid != null ? tl.mid.toFixed(1) : '—',
      loText: tl.lo != null ? tl.lo.toFixed(1) : '—',
      recharge: !!(tl.recharge || dRange.recharge),
      recharged: !!tl.recharge,
      rechargeTotalText: tl.recharge ? power.fmtDrop(tl.rechargeTotal) : '',
      slow: slowOn, slowText: slowOn ? slow.text : '',
      // v13：慢频房固定「日更」徽标（始终显示）；noUpd = 所选区间无更新提示（canvas 绘图区内绘制，不挡点选）
      daily: slowRoom, dailyText: slowRoom ? '日更' : '',
      dailyTitle: slowRoom ? '13/16 号楼网关日更，按真实更新点统计' : '',
      noUpd: noUpd,
      xTicks: this._xTicks
    };
    this.setData({
      state: 'ready',
      errorText: '',
      rangeTitle: meta.title,
      rangeTile: meta.tile,
      chartW: this._cw,
      canvasW: this._cw,
      cursor: cursorOff(),
      room: row ? { label: row.label || power.labelOf(this.data.sel), q: power.fmtQ(q), unit: row.unit, upd: power.updText(row.upd) } : null,
      qText: power.fmtMain(q),                 // 网站 fmtMain：≥100 取整，否则 1 位小数
      unit: row ? row.unit : '度',
      stateKey: st,
      stateText: power.stateText(st),
      gaugeStyle: ringStyle(arcs, st),
      updText: updText,
      trend: trend,
      tiles: power.tilesOf(row, est, dRange, meta, low, slowOn, cmp, crossRecharge),
      bill: power.billOf(dRange, waterUtil.roomOf(store.get().water, this.data.sel).p),
      lowOn: power.lowOn(row, low),
      lowText: power.lowText(row, est),
      footer: '低电阈值 < ' + low + ' 度标红 · 数据来自完美校园，约每小时同步'
    }, () => {
      this._drawTrend();
    });
  },

  // 先用保守宽度渲染（绝不溢出），DOM 就绪后实测 .pw-plot 宽并重绘
  _renderWhenReady() {
    if (this._cwMeasured) { this._renderData(); return; }
    if (this._measuring) { this._pendingRender = true; return; }
    this._measuring = true;
    this._renderData(true);
    const measure = () => {
      this._measurePlot((w) => {
        this._measuring = false;
        this._cwMeasured = true;
        const changed = w > 0 && Math.abs(w - this._cw) > 1;
        if (changed) this._cw = w;
        /* 测量期间可能有新的渲染请求（切区间/刷新）被暂存 → 测量完成后必须补渲染，否则会一直显示旧数据 */
        const pending = !!this._pendingRender;
        this._pendingRender = false;
        if (pending || changed) this._renderData();
      });
    };
    try { if (wx.nextTick) wx.nextTick(measure); else setTimeout(measure, 0); }
    catch (e) { setTimeout(measure, 0); }
    /* 兜底：个别机型/自动化环境 selectorQuery 回调可能丢失 → 不能一直卡在 _measuring=true */
    if (this._measureFallbackT) { clearTimeout(this._measureFallbackT); this._measureFallbackT = null; }
    const self = this;
    this._measureFallbackT = setTimeout(function () {
      self._measureFallbackT = null;
      if (self._cwMeasured) return;
      self._measuring = false;
      self._pendingRender = false;
      self._cwMeasured = true;
      self._pendingRender = false;
      self._renderData();
    }, 1200);
  },

  // canvas 2d 折线：面积渐变 + 折线 + 2 条网格 + 末点；DPR 缩放；无数据时跳过。
  // 2026-11-06：canvas 节点可能尚未就绪（首帧 / wx:if 从空态切显示 / 页面重建）→ 旧实现静默 return
  // 导致趋势空白且无人重绘；现在补一次短延迟重绘兜底（每次渲染最多 1 次，成功即恢复绘制）。
  _drawTrend() {
    // 覆盖层打开期间 canvas 被 wx:if 移除（避免原生层面盖住弹层）→ 直接跳过，关闭后 _redrawAfterOverlay 重绘
    if (this._trendOverlayOpen && this._trendOverlayOpen()) { this._canvasDrawn = false; return; }
    const points = this._linePoints;
    if (!points || points.length < 2) { this._canvasDrawn = false; return; }
    let res = null;
    try {
      res = wx.createSelectorQuery().select('#pwTrend').fields({ node: true, size: true });
    } catch (e) { this._drawTrendRetry(); return; }
    if (!res || typeof res.exec !== 'function') { this._drawTrendRetry(); return; }
    res.exec((list) => {
      const item = list && list[0];
      const node = item && item.node;
      const width = item && item.width, height = item && item.height;
      if (!node || !width || !height) { this._drawTrendRetry(); return; }
      const ctx = node.getContext && node.getContext('2d');
      if (!ctx) { this._drawTrendRetry(); return; }
      let dpr = 2;
      try {
        const info = wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : null);
        if (info && info.pixelRatio) dpr = Math.min(3, Math.max(1, info.pixelRatio));
      } catch (e) { dpr = 2; }
      // v4：超宽画布物理宽上限 ~5376（宽 canvas 横滑时避免超大纹理）
      const MAX_PHYS = 5376;
      if (width * dpr > MAX_PHYS) dpr = Math.max(1, MAX_PHYS / width);
      node.width = Math.round(width * dpr);
      node.height = Math.round(height * dpr);
      ctx.scale(dpr, dpr);
      const W = width, H = height;
      this._plotH = H;                 // 记录实际绘图高：游标圆点/气泡按同一坐标系定位（需在 px/py 之前）
      const padX = PLOT_PAD_X, padT = PLOT_PAD_T, padB = PLOT_PAD_B;
      const px = function (p) { return padX + p.x * (W - padX * 2); };
      const py = function (p) { return padT + p.y * (H - padT - padB); };
      ctx.clearRect(0, 0, W, H);
      // 2 条水平网格（对齐网站 .pw-trend-grid 的 32% / 72%）
      ctx.strokeStyle = 'rgba(78,144,130,.16)';
      ctx.lineWidth = 1;
      [0.32, 0.72].forEach(function (f) {
        const gy = padT + f * (H - padT - padB);
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
      });
      // 充值位置竖虚线（趋势已折算；只做标记）。canvas ctx 在测试/旧基础库可能方法不全 → try 保护
      if (this._rechargeMarks && this._rechargeMarks.length) {
        try {
          if (ctx.save) ctx.save();
          ctx.strokeStyle = 'rgba(185,143,99,.55)';
          ctx.lineWidth = 1;
          if (ctx.setLineDash) ctx.setLineDash([3, 3]);
          this._rechargeMarks.forEach(function (idx) {
            const pt = points[idx];
            if (!pt) return;
            const x = px(pt);
            ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
          });
          if (ctx.setLineDash) ctx.setLineDash([]);
          if (ctx.restore) ctx.restore();
        } catch (e) { /* 忽略：仅装饰标记，不影响主曲线 */ }
      }
      // 慢频（13/16 号楼日更）：阶梯线（先水平后垂直）；实时房：原折线（视觉不变）
      const drawn = this._slowCadence ? power.stepSegments(points) : points;
      // 面积渐变（下方半透明）
      const grad = ctx.createLinearGradient(0, padT, 0, H - padB);
      grad.addColorStop(0, 'rgba(78,144,130,.22)');
      grad.addColorStop(1, 'rgba(78,144,130,0)');
      ctx.beginPath();
      ctx.moveTo(px(drawn[0]), H - padB);
      drawn.forEach(function (p) { ctx.lineTo(px(p), py(p)); });
      ctx.lineTo(px(drawn[drawn.length - 1]), H - padB);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      // 折线 / 阶梯线
      ctx.beginPath();
      drawn.forEach(function (p, i) { if (i) ctx.lineTo(px(p), py(p)); else ctx.moveTo(px(p), py(p)); });
      ctx.strokeStyle = '#4E9082';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
      // 末点圆点（全量绘制始终在可见范围内）
      const last = points[points.length - 1];
      const lx = px(last);
      if (lx >= -6 && lx <= W + 6) {
        ctx.beginPath();
        ctx.arc(lx, py(last), 3, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.strokeStyle = '#4E9082';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      // 慢频：真实变化点小圆点（≤60 个）+ 所选区间无更新提示（画在绘图区内，不影响点击/游标）
      if (this._slowCadence) {
        power.changeDots(points).forEach(function (d) {
          const dx = px(d), dy = py(d);
          if (dx < -6 || dx > W + 6) return;
          ctx.beginPath();
          ctx.arc(dx, dy, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
          ctx.strokeStyle = '#4E9082';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });
        if (this._noUpd) {
          ctx.fillStyle = 'rgba(110,140,168,.95)';
          ctx.font = '11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(this._noUpd, W / 2, padT + (H - padT - padB) / 2 + 18);
        }
      }
      this._canvasDrawn = true;
      this._drawRetryN = 0;                     // 绘制成功：下一次渲染仍可享受兜底机会
    });
  },

  // canvas 节点未就绪时的兜底重绘：短延迟（DRAW_RETRY_DELAY）后再查一次节点；每次渲染最多补 1 次，绝不循环。
  _drawTrendRetry() {
    if (this._drawRetryN >= 1) return;
    this._drawRetryN = 1;
    if (this._drawRetryT) clearTimeout(this._drawRetryT);
    this._drawRetryT = setTimeout(() => {
      this._drawRetryT = null;
      this._drawTrend();
    }, DRAW_RETRY_DELAY);
  },

  // 实测绘图容器宽（SelectorQuery）；回调只拿宽度，不直接改渲染状态。失败/超时走保守兜底。
  _measurePlot(cb) {
    let called = false;
    let timer = null;
    const done = (w) => {
      if (called) return;
      called = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (w > 0) {
        if (typeof cb === 'function') { cb(w); return; }   // 回调自行更新 _cw / 重绘
        this._cw = Math.round(w);
        this._cwMeasured = true;
      } else {
        // 测量失败：保留估算宽度，标记已尝试，避免无限重试/空白
        this._cwMeasured = true;
        if (typeof cb === 'function') { cb(0); return; }
      }
      if (typeof cb === 'function') { cb(this._cw); return; }
      if (this._row && this.data.state === 'ready') this._renderData();
      else this._drawTrend();
    };
    try {
      wx.createSelectorQuery().select('.pw-plot').boundingClientRect().exec((res) => {
        const r = res && res[0];
        if (r && r.left != null) this._plotLeft = Number(r.left) || 0;
        done(r && r.width ? r.width : 0);
      });
      timer = setTimeout(() => done(0), 400);   // devtools/真机极端情况下 selectorQuery 不回调
    } catch (e) { done(0); }
  },
  // 曲线查看：按 clientX 换算成「曲线 x 比例」（与 _linePoints.x 同一坐标系，已扣掉 canvas 左右 padding），
  // 找最近真实采样点（同步写，不 rAF）。
  _cursorFrac(e) {
    const t = (e && e.touches && e.touches[0]) || (e && e.changedTouches && e.changedTouches[0]);
    if (!t || !this._cw) return null;
    const x = Number(t.clientX);
    if (!isFinite(x)) return null;
    const raw = (x - (this._plotLeft || 0)) / this._cw;        // 0..1 绘图区比例
    const inner = Math.max(1, this._cw - PLOT_PAD_X * 2);
    const f = (raw * this._cw - PLOT_PAD_X) / inner;           // 反解 canvas 坐标（含左右 padding）
    return Math.max(0, Math.min(1, f));
  },
  // 绘图区实际高：优先用 _drawTrend 实测的 canvas 节点高；canvas 未就绪时按 .pw-plot 的 260rpx 估算（px）。
  _effPlotH() {
    if (this._plotH > 0) return this._plotH;
    let win = {};
    try { win = wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {}); } catch (e) { win = {}; }
    const w = Number(win && win.windowWidth);
    return Math.round(260 * ((isFinite(w) && w > 0 ? w : 375) / 750));
  },
  // 点击/拖动命中最近真实采样点 → 竖直游标线 + 圆点（真实采样点 y 位置）+ 固定信息气泡。
  // 气泡固定在趋势图右上角上部（区间行右侧、绘图区外，见 WXML .pw-trend-top），这里只更新文字；
  // 不再做图内气泡定位/实测 clamp（用户 2026-11-07 要求：不要把气泡放在图内）。
  _showCursor(frac) {
    const pts = this._linePoints;
    if (!pts || pts.length < 2 || !this._cw) return;
    const hit = power.nearestPoint(pts, frac);
    if (!hit) return;
    const p = hit.point;
    this._cursorIndex = hit.index;
    const cw = this._cw;
    const plotH = this._effPlotH();
    const x = PLOT_PAD_X + p.x * Math.max(0, cw - PLOT_PAD_X * 2);
    const y = PLOT_PAD_T + p.y * Math.max(0, plotH - PLOT_PAD_T - PLOT_PAD_B);
    const text = power.cursorLabel(p.t, this.data.range) + ' · 电量 ' + power.fmtQ(p.q) + ' 度';
    this.setData({ cursor: { on: true, left: x, top: y, text: text } });
  },
  onTrendTouch(e) {
    if (this.data.trend.empty || this._trendOverlayOpen()) return;
    const t = (e && e.touches && e.touches[0]) || null;
    this._touchActive = true;
    this._touchMoved = false;
    this._touchStartX = t ? Number(t.clientX) : 0;
    this._cursorStartIndex = this._cursorIndex;
    const frac = this._cursorFrac(e);
    if (frac != null) this._showCursor(frac);
  },
  onTrendTouchMove(e) {
    if (!this._touchActive || this.data.trend.empty || this._trendOverlayOpen()) return;
    const t = (e && e.touches && e.touches[0]) || null;
    if (t && Math.abs(Number(t.clientX) - this._touchStartX) > 6) this._touchMoved = true;
    const frac = this._cursorFrac(e);
    if (frac != null) this._showCursor(frac);
  },
  onTrendTouchEnd() {
    if (!this._touchActive) return;
    this._touchActive = false;
    // 单击已在选中的同一采样点 → 取消查看（点空白/再点取消）；拖动松手保留
    if (!this._touchMoved && this._cursorIndex >= 0 && this._cursorIndex === this._cursorStartIndex) {
      this._cursorIndex = -1;
      this.setData({ cursor: cursorOff() });
    }
  },

  pick(rv) {
    rv = power.normalizeSel(rv);
    if (rv === this.data.sel) return Promise.resolve(false);
    const d = store.get();
    d.power = { sel: rv, at: Date.now(), low: power.normLow(d.power && d.power.low) };  // 真源：userdata v6 power section（1200ms 防抖推送）
    store.save();
    writeFallback(rv);
    this._syncSel(true);
    return rv ? this.load(true) : Promise.resolve(false);
  },
  // v5：低电阈值面板（8 档；点选立即生效并关闭，写 UD.power.low + 本机兜底）
  // 2026-11-08：面板打开期间移除 #pwTrend canvas（原生组件会盖住面板），关闭后重绘（见 _redrawAfterOverlay）。
  onTileTap(e) {
    const key = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) || '');
    if (key !== 'threshold') return;
    const open = !this.data.lowOpen;
    this.setData({ lowOpen: open }, () => { if (!open) this._redrawAfterOverlay(); });
  },
  closeLow() {
    if (!this.data.lowOpen) return;
    this.setData({ lowOpen: false }, () => { this._redrawAfterOverlay(); });
  },
  chooseLow(e) {
    const v = power.normLow((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v));
    this.setData({ lowOpen: false }, () => { this._redrawAfterOverlay(); });
    if (v === this.data.low) return;
    const d = store.get();
    d.power = { sel: this.data.sel, at: Date.now(), low: v };   // selAt=now → UD.power 变脏按 LWW 推送
    store.save();
    writeLowFallback(v);
    this.setData({ low: v });
    if (this._row) this._renderData();                          // 用已有数据重算 pill/环/低电条/tile
  },
  refreshTap() {
    if (!this.data.hasSel) { util.toast('先选择你要关注的宿舍'); return; }
    this.load(true).then(() => this._drawTrend());
  },
  retry() { if (this.data.hasSel) this.load(true); },
  goAll() { wx.switchTab({ url: '/pages/all/all' }); },

  onShareAppMessage() {
    return share.message({
      title: '班级工具｜宿舍电费 · 剩余电量与趋势',
      path: '/pages/power/power',
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '班级工具｜宿舍电费 · 剩余电量与趋势',
      imageUrl: '/images/share/default.png'
    });
  }
});
