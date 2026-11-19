// pages/ppt/pptplay/pptplay.js —— 全屏播放器（PPT 分步图片 + 媒体热点 + v1.2「原样播放」视频）
//
// 契约：web/ppt/CONTRACT.md §5（manifest 播放语义）/ §7（页切换动效）/ §8.1 / §8.3 /
//       §11（v1.2 原样播放 + 便捷操作）/ §11.4（小程序媒体传输降级链）
// 设计：web/ppt/DESIGN.md §4.3–4.9 / §4.11 / §5（技术前置与降级）
//   * 黑色全屏舞台（navigationStyle:custom + pageOrientation:auto + disableScroll），图片 contain letterbox；
//   * 两种模式（§11.3.1）：原样播放（manifest.video，网络良好/用户偏好时默认）与分步浏览（图片 + step + 热点）；
//   * 原样播放（§11.3.2）：视频全屏 contain、自动开始、自定义控制条 3s 自动隐藏（播放/暂停、mm:ss/mm:ss、
//     上一页/下一页按 chapters seek、章节刻度进度条点 seek、倍速 1×/1.25×/1.5×/2×、复制视频链接、从头、关闭、
//     原样/分步胶囊）；点舞台显隐控制条（不做 1/3 点击翻页）；左右滑=上一页/下一页；缓冲/下载态不白屏；
//   * 媒体降级链（§11.4）：<video src=ECS /pptfiles（OSS /ppt/** 映射；见 utils/ppt.js pptEcsUrl）> →
//     binderror/5s 未起播 → wx.downloadFile 临时文件（进度/可取消）→
//     仍失败 → 自动切分步 + toast，全程不白屏不卡死；
//   * 续播（§11.3.4）：storage 按 deckId 记 {mode,page,step,idx,t,at,dur,pt,n}，打开自动续播（可从头播放）；
//     列表卡片「继续」徽标由 utils/ppt.js 的 resumeBadge 判定；
//   * 分步模式：点击右 2/3 → 下一步、左 1/3 → 上一步；左右滑动切换；后退单位=step（step=0 退上一页末步）；
//     热点时序修复（图片 load / 转场结束 / resize 三处重算）、热点直径 ≥56px + 时长角标 + 脉冲；
//   * 底部自动隐藏控制条、顶部进度/文件名、缩略图/备注抽屉、黑屏、横竖屏 letterbox 自适应、退出释放；
//   * <image> 全部带 webp="{{true}}"（否则真机 .webp 白图）；图片失败保留上一张 + 「图片加载失败 · 重试」；
//     视频/音频热点失败 → 热点灰化「视频不可用」，不阻塞翻页；
//   * 预加载：仅分步模式（原样播放不浪费 40–55MB 视频带宽），wx.downloadFile 并发 ≤4；2G/断网暂停；
//   * 退出：控制条「更多 → 退出演示」/ 系统返回（有进度时 enableAlertBeforeUnload 二次确认）。
const identity = require('../../../utils/identity.js');
const ppt = require('../utils/ppt.js');
const util = require('../../../utils/util.js');
const share = require('../../../utils/share.js');

const CTRL_HIDE_MS = 3200;          // 任意触摸 → 控制条 3s 后淡出（DESIGN §4.4）
const TITLE_FADE_MS = 3000;         // 左上文件名 3s 后淡出，之后不再出现（DESIGN §4.3）
const PRELOAD_CONCURRENCY = 4;      // wx.downloadFile 并发上限 10 → 预加载 ≤6（DESIGN §3.2，这里留余量）
const PRELOAD_MAX = 24;             // 预加载队列上限（防低端机内存/临时文件膨胀）
const HOT_SIZE = 64;                // 热点圆钮 ≥56px（v1.2 §11.3.3：手机 64px）
const SWIPE_MIN = 48;               // 滑动阈值 40px 或屏宽 12% 取大（DESIGN §4.9）
const V_CTRL_HIDE_MS = 3000;        // 原样播放控制条 3s 自动隐藏（§11.3.2）
const V_SAVE_MS = 4000;             // 播放中续播落盘节流（§11.3.4）
const V_NET_WAIT_MS = 600;          // 网络类型未就绪时最多等 600ms 再决定默认模式（§11.3.1）
const V_DL_STALL_MS = 20000;        // 下载降级 20s 无进度 → 判失败（不卡死，§11.4）
const V_DL_MAX_MS = 180000;         // 下载降级总时长上限 180s（40–55MB 视频的保护上限）

// 网络类型归一化（wx.getNetworkType: wifi/4g/5g/3g/2g/none/unknown）
function strType(v) { return String(v == null ? '' : v).toLowerCase(); }

Page({
  data: {
    state: 'loading',               // loading | ready | error | denied
    errorText: '',
    title: '',
    titleOn: true,
    view: null,                     // ppt.viewAt 当前帧
    imgA: '',                       // 当前图（动效作用层）
    imgB: '',                       // 上一张（交叉/退场底图；切完置空释放解码）
    animCls: '',
    hot: [],                        // 热点圆钮（px）
    thumbs: [],
    drawer: '',                     // '' | 'thumb' | 'notes'
    black: false,                   // 黑屏（课堂单键）
    blackHint: false,
    ctrlOn: true,
    audioOn: false,
    video: null,                    // {url,s} 分步模式媒体层；null = 未打开
    imgErr: false,
    mediaFail: {},                  // { <s>: true } 热点失败灰化
    winW: 375,
    winH: 667,
    // ---- v1.2 原样播放（§11）----
    mode: '',                       // '' 未定 | 'video' 原样播放 | 'step' 分步浏览
    hasVideo: false,                // manifest.video 存在（顶栏显示「原样」胶囊）
    vposter: '',                    // 视频 poster（封面/首步图，立即有画面）
    vsrc: '',                       // 当前 video src（OSS 直链或下载后的临时文件）
    vauto: false,                   // 是否 autoplay（用户从列表进入 = 手势，允许自动开始）
    vstage: '',                     // direct | download | temp | step（§11.4 降级链）
    vloading: false,                // 初始加载 / 缓冲中（40–55MB 视频必须给缓冲态）
    vpaused: true,
    vt: 0,
    vdur: 0,
    vtimeText: '00:00 / 00:00',
    vpct: 0,
    vticks: [],                     // 章节刻度 [{i,t,pct}]
    vpage: 1,                       // 当前章节页码（1-based）
    vpages: 0,
    vrate: 1,
    vrateText: '1×',
    vctrlOn: true,                  // 原样播放控制条 3s 自动隐藏
    vdl: null,                      // 下载降级进度 {on,pct,text}
    vhint: '',                      // 视频模式短提示（续播/降级原因，自动消失）
    topPad: 0                       // 状态栏高度（自定义导航下顶栏/胶囊/关闭避开状态栏）
  },

  onLoad(options) {
    this._dead = false;
    this._id = '';
    try { this._id = decodeURIComponent(String((options && options.id) || '')); } catch (e) { this._id = String((options && options.id) || ''); }
    this._m = null;
    this._flat = [];
    this._idx = -1;
    this._stage = null;
    this._fit = null;
    this._t0 = null;
    this._par = 0;
    this._ctrlTimer = null;
    this._titleTimer = null;
    this._bTimer = null;
    this._blackTimer = null;
    this._layoutT = null;
    this._leaveGuard = false;
    this._fallbackTried = false;
    this._audioCtx = null;
    this._audioS = '';
    this._mediaFail = {};
    this._dlQ = [];
    this._dlActive = 0;
    this._dlDone = {};
    this._netOff = false;
    this._ready = false;
    // ---- v1.2 原样播放（§11）----
    this._v = null;               // 归一化 manifest.video
    this._vCtx = null;            // wx.createVideoContext('plv')
    this._vDlTask = null;         // wx.downloadFile 任务（退出/切模式时 abort）
    this._vTempPath = '';         // 下载后的临时文件
    this._vStarted = false;       // 是否已真正起播（5s 降级判定用）
    this._vStartT = null;         // 直连起播看门狗定时器
    this._vCtrlTimer = null;      // 原样播放控制条自动隐藏
    this._vHintTimer = null;
    this._vSaveAt = 0;            // 续播落盘节流
    this._vNeedSeek = -1;         // 换 src / 降级后待 seek 的秒数
    this._vDlTimer = null;        // 下载降级看门狗（无进度/超时 → 分步，§11.4）
    this._vDlSeenAt = 0;
    this._resume = null;          // 本机续播记录（§11.3.4）
    this._netType = '';           // wx.getNetworkType（§11.3.1 默认模式）
    this._netGot = false;
    this._netQueue = null;
    // 自定义导航：顶栏/模式胶囊/关闭按钮避开状态栏（env(safe-area-inset-top) 在部分环境为 0）
    this._topPad = 0;
    try {
      const wi = wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {});
      this._topPad = Math.max(0, Math.round(Number(wi && wi.statusBarHeight) || 0));
    } catch (e) { this._topPad = 0; }
    // 横竖屏切换（pageOrientation:auto）：页面 onResize + 全局兜底
    this._resizeCb = () => {
      if (this.data.state !== 'ready') return;
      if (this.data.mode === 'video') this._showVCtrl();
      else this._layoutSoon();
    };
    try { if (wx.onWindowResize) wx.onWindowResize(this._resizeCb); } catch (e) { /* 旧基础库忽略 */ }
    this._bindNet();
    if (!identity.has()) { this.setData({ state: 'denied' }); return; }
    if (!this._id) { this.setData({ state: 'error', errorText: '缺少演示参数' }); return; }
    this._load();
  },

  onShow() {
    share.enable();
    if (!identity.ensure()) return;
    try { wx.setKeepScreenOn({ keepScreenOn: true }); } catch (e) { /* ignore */ }
    if (this.data.state === 'ready' && !this.data.black) {
      if (this.data.mode === 'video') this._showVCtrl();
      else this._showCtrl();
    }
  },
  onHide() {
    try { wx.setKeepScreenOn({ keepScreenOn: false }); } catch (e) { /* ignore */ }
    this._closeMedia();
    this._vPauseSave();               // 切后台/退出：暂停并落续播（§11.3.4）
  },
  onUnload() { this._release(); },
  onResize() {
    if (this.data.state !== 'ready') return;
    if (this.data.mode === 'video') this._showVCtrl();
    else this._layoutSoon();
  },

  /* ---------------- 加载清单 ---------------- */
  _load() {
    const self = this;
    ppt.getManifest(this._id).then(function (r) {
      if (self._dead) return;
      if (!r.ok) { self.setData({ state: 'error', errorText: r.reason || '演示加载失败' }); return; }
      self._m = r.manifest;
      self._v = r.manifest.video || null;      // v1.2 可选原样播放视频（缺失 → 仅分步）
      self._flat = ppt.flatSteps(r.manifest);
      if (!self._flat.length) { self.setData({ state: 'error', errorText: '演示内容为空' }); return; }
      self._deck = r.deck || {};
      // 续播（§11.3.4）：7 天内且未到末尾才有效；无效则清掉，避免列表一直挂「继续」
      const saved = ppt.resumeOf(self._id);
      self._resume = (saved && ppt.resumeValid(saved, Date.now())) ? saved : null;
      if (saved && !self._resume) ppt.clearResume(self._id);
      const v0 = ppt.viewAt(r.manifest, 0);
      const cover = ppt.pptEcsUrl(String((self._deck && self._deck.cover_url) || ''));
      self._idx = 0;
      self._ready = true;
      self._coverB = !!cover;
      const d = {
        state: 'ready',
        title: String(self._deck.title || '演示'),
        titleOn: true,
        view: v0,
        thumbs: ppt.thumbList(r.manifest),
        imgA: v0.img,
        imgB: cover || '',                 // 先用封面铺满（立即有画面），steps[0] 到位后淡入替换
        animCls: cover ? 'pl-an-step-a' : '',
        mediaFail: {},
        topPad: self._topPad || 0,
        hasVideo: !!self._v,
        vposter: cover || v0.img,          // 原样播放 poster：封面/首步图（40MB 视频加载时也有画面）
        vticks: self._v ? self._v.ticks : [],
        vdur: self._v ? self._v.dur : 0,
        vpages: r.manifest.slides.length,
        vpage: 1
      };
      self.setData(d, function () {
        if (self._dead) return;
        self._layout(function () {
          if (self._dead) return;
          self._updateHot();
          self._startTitleFade();
          self._decideMode();              // 默认模式（§11.3.1）：video+网络良好/偏好 → 原样播放
          self._preload(0);
          if (cover) {
            // 兜底：主图迟迟不 load 也在 1.5s 后撤掉封面（正常由 onImgLoad 更早撤）
            self._bTimer = setTimeout(function () {
              self._bTimer = null;
              if (self._dead || !self._coverB) return;
              self._coverB = false;
              self.setData({ imgB: '', animCls: '' });
            }, 1500);
          }
        });
      });
    });
  },

  /* ---------------- v1.2 默认模式选择 / 续播落地（§11.3.1 / §11.3.4） ---------------- */
  _decideMode() {
    if (this._dead) return;
    const self = this;
    const go = function () {
      if (self._dead) return;
      const pref = ppt.modeOf(self._id);
      const mode = ppt.chooseMode({ hasVideo: !!self._v, networkType: self._netType, pref: pref });
      self._modeChosen = mode;
      if (mode === ppt.MODE_VIDEO) {
        if (self.data.mode === 'video') return;
        self.setData({ mode: 'video', ctrlOn: false });
        self._vEnter(self._videoTargetForCurrent());
        if (self._resume && self._resume.mode === ppt.MODE_VIDEO) self._vToast(ppt.resumeText(self._resume, Date.now()));
        return;
      }
      // 分步模式
      if (self.data.mode !== 'step') {
        self.setData({ mode: 'step' });
        if (self.data.state === 'ready') { self._showCtrl(); self._layoutSoon(); }
      }
      if (self._resume) {
        if (self._resume.mode === ppt.MODE_STEP) {
          const j = Math.max(0, Math.min(self._flat.length - 1, self._resume.idx));
          if (j > 0) self._go(j);
          self._showCtrl();
          self._toastResume(ppt.resumeText(self._resume, Date.now()));
        } else {
          // 续播的是视频位置但当前分步（弱网/用户偏好）→ 定位到该视频时间对应页
          const p = ppt.videoPageOf(self._v, self._resume.t);
          const j = p >= 0 ? ppt.pageStart(self._m, p) : -1;
          if (j > 0) self._go(j);
        }
      }
    };
    // 网络类型异步：hasVideo 且尚未拿到时最多等 600ms（§11.3.1）
    if (this._v && !this._netGot && this._netType === '') {
      this._netQueue = go;
      setTimeout(function () {
        if (self._dead) return;
        const f = self._netQueue;
        self._netQueue = null;
        if (f) f();
      }, V_NET_WAIT_MS);
      return;
    }
    go();
  },
  _toastResume(text) {
    if (text) util.toast(text);
  },
  _vToast(text) {
    if (!text) return;
    this._vHint(text);
    util.toast(text);
  },

  /* ---------------- 布局（横竖屏/letterbox/热点） ---------------- */
  _layoutSoon() {
    if (this._layoutT) return;
    const self = this;
    this._layoutT = setTimeout(function () {
      self._layoutT = null;
      if (!self._dead) self._layout();
    }, 60);
  },
  _layout(cb) {
    const self = this;
    const m = this._m;
    if (!m) return;
    const apply = function (rect) {
      if (self._dead) return;
      self._stage = rect;
      self._fit = ppt.fitRect(rect.width, rect.height, m.w, m.h);
      self.setData({ winW: Math.round(rect.width), winH: Math.round(rect.height) }, function () {
        if (self._dead) return;
        self._updateHot();
        if (cb) cb();
      });
    };
    try {
      const q = wx.createSelectorQuery();
      q.select('.pl-stage').boundingClientRect();
      q.exec(function (res) {
        const r = res && res[0];
        if (r && r.width > 0 && r.height > 0) {
          apply({ left: r.left || 0, top: r.top || 0, width: r.width, height: r.height });
          return;
        }
        let win = {};
        try { win = wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {}); } catch (e) { win = {}; }
        apply({ left: 0, top: 0, width: Math.max(1, Number(win.windowWidth) || 375), height: Math.max(1, Number(win.windowHeight) || 667) });
      });
    } catch (e) {
      apply({ left: 0, top: 0, width: Math.max(1, this.data.winW), height: Math.max(1, this.data.winH) });
    }
  },
  _updateHot() {
    if (this.data.mode === 'video') {
      if (this.data.hot.length) this.setData({ hot: [] });
      return;
    }
    const v = this.data.view;
    if (!v || !this._fit) {
      if (this.data.hot.length) this.setData({ hot: [] });
      return;
    }
    // v1.2 §11.3.3：热点尺寸 ≥56px（手机 64px）+ 时长角标（hotButtons）
    this.setData({ hot: ppt.hotButtons(v.hotspots, this._fit, { size: HOT_SIZE, failMap: this._mediaFail }) });
  },

  /* ---------------- 步进（页切换动效 §7 / step 内 120ms 淡入） ---------------- */
  _animName(kind, tr) {
    this._par = (this._par + 1) % 2;
    const suffix = this._par ? 'b' : 'a';
    if (kind === 'step') return 'pl-an-step-' + suffix;
    const t = ppt.normTransition(tr);
    if (t === 'none') return '';
    return 'pl-an-' + t + '-' + suffix;
  },
  _go(next) {
    if (this._dead || !this._flat.length) return false;
    const j = Math.round(Number(next));
    if (!(j >= 0 && j < this._flat.length)) return false;
    const m = this._m;
    const prevIdx = this._idx;
    const prevIt = (prevIdx >= 0 && prevIdx < this._flat.length) ? this._flat[prevIdx] : null;
    const it = this._flat[j];
    const pageChanged = !prevIt || prevIt.p !== it.p;
    if (pageChanged) this._closeMedia();      // 媒体层只在换页/退出播放器时销毁（契约 §5）
    const v = ppt.viewAt(m, j);
    let anim = '';
    let dur = 0;
    if (pageChanged) {
      dur = (it.slide.tr === 'none') ? 0 : ppt.normTrd(it.slide.trd);
      anim = dur ? this._animName('page', it.slide.tr) : '';
    } else {
      dur = ppt.STEP_FADE_MS;
      anim = this._animName('step');
    }
    if (this._bTimer) { clearTimeout(this._bTimer); this._bTimer = null; }
    this._idx = j;
    this._fallbackTried = false;
    const d = { view: v, imgA: v.img, imgErr: false, animCls: anim };
    d.imgB = (prevIt && dur) ? prevIt.url : '';
    const self = this;
    this.setData(d, function () {
      if (self._dead) return;
      self._updateHot();
      if (dur) {
        self._bTimer = setTimeout(function () {
          self._bTimer = null;
          if (self._dead) return;
          self.setData({ imgB: '', animCls: '' });
          // v1.2 §11.3.3 热点时序修复：过渡结束后必须重算热点（图/布局可能刚完成）
          self._updateHot();
        }, dur + 40);
      }
      self._showCtrl();
      self._preload(j);
      self._saveStep();          // 续播（§11.3.4；分步模式记页/步）
      self._syncLeaveGuard();
    });
    return true;
  },
  nextStep() {
    this._showCtrl();
    const j = ppt.advance(this._flat, this._idx, 1);
    if (j >= 0) this._go(j);
  },
  prevStep() {
    this._showCtrl();
    const j = ppt.advance(this._flat, this._idx, -1);   // step=0 后退 → 上一页最后一步
    if (j >= 0) this._go(j);
  },

  /* ---------------- 触摸手势（单击左右 1/3、左右滑；不与页面滚动冲突） ---------------- */
  onTS(e) {
    const t = (e && e.touches && e.touches[0]) || null;
    if (!t) return;
    this._t0 = { x: t.clientX, y: t.clientY, at: Date.now() };
    this._showCtrl();
  },
  onTE(e) {
    const t = (e && e.changedTouches && e.changedTouches[0]) || null;
    const s = this._t0;
    this._t0 = null;
    if (!t || !s || this.data.black || this.data.video) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    const dt = Date.now() - s.at;
    const w = (this._stage && this._stage.width) || this.data.winW || 375;
    const left = (this._stage && this._stage.left) || 0;
    const swipeMin = Math.max(SWIPE_MIN, Math.round(w * 0.12));
    if (Math.abs(dx) >= swipeMin && Math.abs(dx) > Math.abs(dy) * 1.2) {
      if (dx < 0) this.nextStep(); else this.prevStep();
      return;
    }
    // 点击：右 2/3 下一步、左 1/3 上一步
    if (Math.abs(dx) < 16 && Math.abs(dy) < 16 && dt < 450) {
      if (t.clientX - left < w / 3) this.prevStep();
      else this.nextStep();
    }
  },
  onTC() { this._t0 = null; },
  noop() { /* 阻止手势区事件冒泡到页面 */ },

  /* ---------------- 控制条自动隐藏 ---------------- */
  _startTitleFade() {
    const self = this;
    if (this._titleTimer) clearTimeout(this._titleTimer);
    this._titleTimer = setTimeout(function () {
      self._titleTimer = null;
      if (!self._dead && self.data.titleOn) self.setData({ titleOn: false });
    }, TITLE_FADE_MS);
  },
  _showCtrl() {
    if (this._dead) return;
    if (this.data.mode === 'video') { this._showVCtrl(); return; }
    if (!this.data.ctrlOn && !this.data.black) this.setData({ ctrlOn: true });
    if (this._ctrlTimer) clearTimeout(this._ctrlTimer);
    const self = this;
    this._ctrlTimer = setTimeout(function () {
      self._ctrlTimer = null;
      if (self._dead) return;
      if (self.data.drawer || self.data.black || self.data.video) return;
      if (self.data.ctrlOn) self.setData({ ctrlOn: false });
    }, CTRL_HIDE_MS);
  },
  _hideCtrl() {
    if (this._ctrlTimer) { clearTimeout(this._ctrlTimer); this._ctrlTimer = null; }
    if (this.data.ctrlOn) this.setData({ ctrlOn: false });
  },

  /* ---------------- 图片加载失败：降级 thumb + 重试（不白屏） ---------------- */
  onImgLoad() {
    if (this._dead) return;
    if (this.data.imgErr) this.setData({ imgErr: false });
    // 首帧：steps[0] 就绪后撤掉封面（DESIGN §4.3「cover 铺满 → 主图 120ms 淡入替换」）
    if (this._coverB) {
      this._coverB = false;
      if (this._bTimer) { clearTimeout(this._bTimer); this._bTimer = null; }
      this.setData({ imgB: '', animCls: '' });
    }
    // v1.2 §11.3.3 热点时序修复：图片 load 后重算热点（避免「本页有视频但热点没渲染」竞态）
    this._updateHot();
  },
  onImgErr() {
    if (this._dead) return;
    const v = this.data.view;
    if (v && !this._fallbackTried && v.thumbUrl && v.thumbUrl !== v.img) {
      this._fallbackTried = true;
      this.setData({ imgA: v.thumbUrl, imgErr: false });   // 降级用 400 宽缩略图撑住画面
      return;
    }
    this.setData({ imgErr: true });                         // 保留上一张图，只提示重试
  },
  retryImg() {
    if (this._dead || !this.data.view) return;
    this._fallbackTried = false;
    this.setData({ imgErr: false });
    const self = this;
    const v = this.data.view;
    const url = ppt.isAbsUrl(v.img) && /^https?:/i.test(v.img) ? (v.img + (v.img.indexOf('?') >= 0 ? '&' : '?') + '_r=' + Date.now()) : v.img;
    this.setData({ imgA: '' }, function () {
      if (!self._dead) self.setData({ imgA: url });
    });
  },

  /* ---------------- 媒体热点：点击才播 / 独立全屏媒体层 / 失败灰化 ---------------- */
  openMedia(e) {
    if (this._dead) return;
    const i = Number((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.i) || 0);
    const item = this.data.hot[i];
    if (!item) return;
    if (item.fail) { util.toast(item.k === 'a' ? '音频不可用' : '视频不可用'); return; }
    this._hideCtrl();
    if (item.k === 'a') { this._toggleAudio(item); return; }
    this.setData({ video: { url: item.url, s: item.s }, drawer: '' });
  },
  closeMedia() {
    if (this.data.video) this.setData({ video: null });
  },
  onVideoEnd() { this.setData({ video: null }); },
  onVideoErr() {
    const v = this.data.video;
    if (v && v.s) this._markMediaFail(v.s);
    this.setData({ video: null });
    util.toast('视频不可用');
  },
  _markMediaFail(s) {
    if (!s) return;
    this._mediaFail[s] = true;
    this.setData({ mediaFail: Object.assign({}, this._mediaFail) });
    this._updateHot();
  },
  _toggleAudio(item) {
    if (this._audioS === item.s && this._audioCtx) { this._stopAudio(); return; }
    this._stopAudio();
    const self = this;
    try {
      const ctx = wx.createInnerAudioContext();
      this._audioCtx = ctx;
      this._audioS = item.s;
      ctx.src = item.url;
      ctx.autoplay = true;
      ctx.onEnded(function () { self._stopAudio(); });
      ctx.onError(function () { self._markMediaFail(item.s); self._stopAudio(); util.toast('音频不可用'); });
      ctx.play();
      this.setData({ audioOn: true });
      this._showCtrl();
    } catch (e) { util.toast('音频不可用'); }
  },
  _stopAudio() {
    if (this._audioCtx) {
      try { this._audioCtx.stop(); this._audioCtx.destroy(); } catch (e) { /* ignore */ }
      this._audioCtx = null;
    }
    this._audioS = '';
    if (this.data.audioOn) this.setData({ audioOn: false });
  },
  _closeMedia() {
    if (this.data.video) this.setData({ video: null });
    this._stopAudio();
  },

  /* ================================================================
   * v1.2「原样播放」视频模式（契约 §11.3.1/§11.3.2/§11.4）
   *   模式：video（原样播放 manifest.video）/ step（分步浏览）
   *   降级链：direct 直链 → download wx.downloadFile 临时文件 → step 分步 + toast
   * ================================================================ */
  /* ---------------- 续播存取（§11.3.4） ---------------- */
  _saveStep() {
    if (!this._m || !this._flat.length || this._idx < 0 || this._idx >= this._flat.length) return;
    const it = this._flat[this._idx];
    ppt.saveResume(this._id, {
      mode: ppt.MODE_STEP, page: it.p, step: it.s, idx: this._idx,
      pt: this._m.slides.length, n: this._flat.length, at: Date.now()
    });
  },
  _vSave() {
    const v = this._v;
    if (!v || this._dead) return;
    const dur = Number(this.data.vdur) || v.dur || 0;
    const t = Number(this.data.vt) || 0;
    if (!(t > 0)) return;
    if (dur > 0 && t >= dur * ppt.RESUME_END_RATIO) { ppt.clearResume(this._id); return; }
    ppt.saveResume(this._id, { mode: ppt.MODE_VIDEO, t: t, dur: dur, at: Date.now() });
  },
  _savePos() {
    if (this.data.mode === 'video') this._vSave();
    else this._saveStep();
  },

  /* ---------------- 模式切换 / 进入 / 退出 ---------------- */
  _videoTargetForCurrent() {
    const v = this._v;
    if (!v) return 0;
    if (this._resume && this._resume.mode === ppt.MODE_VIDEO && ppt.resumeValid(this._resume, Date.now())) return this._resume.t;
    let page = 0;
    if (this._resume && this._resume.mode === ppt.MODE_STEP) page = this._resume.page;
    else if (this._idx >= 0 && this._flat[this._idx]) page = this._flat[this._idx].p;
    const t = ppt.videoSeekTarget(v, page);
    return t >= 0 ? t : 0;
  },
  _vEnter(targetT) {
    if (this._dead) return;
    const v = this._v;
    if (!v) { this.setData({ mode: 'step' }); this._showCtrl(); return; }
    this._closeMedia();
    this._hideCtrl();
    this._vStop();
    const t = Math.max(0, Number(targetT) || 0);
    this._vNeedSeek = t;
    this._vCh = -1;
    const self = this;
    this.setData({
      mode: 'video',
      vstage: ppt.V_STAGE.direct,
      vsrc: v.url,
      vauto: true,
      vloading: true,
      vpaused: false,
      vt: t,
      vdur: v.dur || 0,
      vtimeText: ppt.videoTimeText(t, v.dur || 0),
      vpct: ppt.videoPct(t, v.dur || 0),
      vticks: v.ticks || [],
      vpages: (this._m && this._m.slides.length) || 0,
      vpage: (ppt.videoPageOf(v, t) + 1) || 1,
      vrate: 1,
      vrateText: '1×',
      vdl: null,
      ctrlOn: false
    }, function () {
      if (self._dead) return;
      try { self._vCtx = wx.createVideoContext('plv', self); } catch (e) { self._vCtx = null; }
      self._vArmStartWatch();       // §11.4：直链 5s 未起播 → 下载降级
      self._showVCtrl();
    });
  },
  _vGoStep(toastText) {
    if (this._dead) return;
    const v = this._v;
    const t = Number(this.data.vt) || 0;
    this._vStop();
    ppt.saveMode(this._id, ppt.MODE_STEP);     // 用户/降级后记住设备偏好（§11.3.1）
    this.setData({ mode: 'step', vsrc: '', vauto: false, vdl: null, vloading: false, vpaused: true, ctrlOn: false });
    if (v) {
      const p = ppt.videoPageOf(v, t);
      const j = p >= 0 ? ppt.pageStart(this._m, p) : -1;
      if (j >= 0) this._go(j);
    }
    this._showCtrl();
    if (toastText) util.toast(toastText);
  },
  switchVideo() {
    if (this._dead) return;
    if (!this._v) { util.toast('该演示没有原样视频'); return; }
    if (this.data.mode === 'video') { this._showVCtrl(); return; }
    this._saveStep();
    ppt.saveMode(this._id, ppt.MODE_VIDEO);
    this._vEnter(this._videoTargetForCurrent());
  },
  switchStep() {
    if (this._dead) return;
    if (this.data.mode !== 'video') { this._showCtrl(); return; }
    this._vGoStep('');
  },
  _vPauseSave() {
    if (this.data.mode !== 'video' || !this.data.vsrc) return;
    this._vSave();
    try { if (this._vCtx) this._vCtx.pause(); } catch (e) { /* ignore */ }
  },
  _vStop() {
    this._vClearStartWatch();
    this._vDlClear();
    this._vAbortDownload();
    try { if (this._vCtx) { this._vCtx.stop(); this._vCtx = null; } } catch (e) { /* ignore */ }
    this._vTempPath = '';
    this._vStarted = false;
    this._vNeedSeek = -1;
  },
  _vAbortDownload() {
    const task = this._vDlTask;
    this._vDlTask = null;
    if (task && typeof task.abort === 'function') { try { task.abort(); } catch (e) { /* ignore */ } }
  },

  /* ---------------- 降级链（§11.4）：direct → download → temp → step ---------------- */
  _vArmStartWatch() {
    const self = this;
    this._vClearStartWatch();
    this._vStartT = setTimeout(function () {
      self._vStartT = null;
      if (self._dead || self.data.mode !== 'video' || self._vStarted) return;
      const stage = self.data.vstage;
      if (stage === ppt.V_STAGE.direct) self._vFallback('direct-timeout');
      else if (stage === ppt.V_STAGE.temp) self._vFallback('temp-error');
    }, ppt.V_START_TIMEOUT_MS);
  },
  _vClearStartWatch() {
    if (this._vStartT) { clearTimeout(this._vStartT); this._vStartT = null; }
  },
  _vFallback(evt) {
    if (this._dead || this.data.mode !== 'video') return;
    const cur = this.data.vstage || ppt.V_STAGE.direct;
    const n = ppt.videoStageNext(cur, evt);
    this._vClearStartWatch();
    if (n.action === 'download') { this._vDownload(); return; }
    if (n.action === 'play-temp') { this._vPlayTemp(); return; }
    if (n.action === 'fallback-step') {
      if (n.hint) this._vHint(n.hint);
      this._vGoStep(n.toast);
    }
  },
  _vDownload() {
    const v = this._v;
    if (!v) { this._vGoStep(); return; }
    this._vTempPath = '';
    this.setData({
      vstage: ppt.V_STAGE.download, vsrc: '', vauto: false, vloading: true, vpaused: true,
      vdl: { on: true, pct: -1, text: ppt.downloadText(-1) }
    });
    try { if (this._vCtx) { this._vCtx.stop(); this._vCtx = null; } } catch (e) { /* ignore */ }
    const self = this;
    let task = null;
    try {
      task = wx.downloadFile({
        url: v.url,
        success: function (res) {
          self._vDlTask = null;
          self._vDlClear();
          if (self._dead || self.data.mode !== 'video' || self.data.vstage !== ppt.V_STAGE.download) return;
          if (!res || res.statusCode !== 200 || !res.tempFilePath) { self._vDownloadFail(); return; }
          self._vTempPath = res.tempFilePath;
          const n = ppt.videoStageNext(ppt.V_STAGE.download, 'download-ok');
          self.setData({ vstage: n.stage, vdl: null });
          self._vPlayTemp();
        },
        fail: function () {
          self._vDlTask = null;
          self._vDlClear();
          if (self._dead || self.data.mode !== 'video') return;
          self._vDownloadFail();
        }
      });
      this._vDlTask = task || null;
      this._vDlArm();             // 无进度/超时看门狗（不卡死，§11.4）
      if (task && typeof task.onProgressUpdate === 'function') {
        task.onProgressUpdate(function (r) { self._vDlProgress(r); });
      }
    } catch (e) { this._vDlClear(); this._vDownloadFail(); }
  },
  _vDlProgress(r) {
    if (this._dead || !r || this.data.mode !== 'video') return;
    this._vDlSeenAt = Date.now();
    let pct = Number(r.progress);
    if (!isFinite(pct)) pct = ppt.downloadPct(r.totalBytesWritten, r.totalBytesExpectedToWrite);
    pct = Math.round(pct);
    this.setData({ vdl: { on: true, pct: pct, text: ppt.downloadText(pct) } });
  },
  // 下载降级看门狗：20s 无进度或 180s 总时长 → 判失败（自动切分步，不卡死）
  _vDlArm() {
    this._vDlClear();
    const self = this;
    const t0 = Date.now();
    this._vDlSeenAt = t0;
    this._vDlTimer = setInterval(function () {
      if (self._dead || self.data.mode !== 'video' || self.data.vstage !== ppt.V_STAGE.download) { self._vDlClear(); return; }
      const now = Date.now();
      if (now - self._vDlSeenAt > V_DL_STALL_MS || now - t0 > V_DL_MAX_MS) {
        self._vDlClear();
        self._vDownloadFail();
      }
    }, 2000);
  },
  _vDlClear() {
    if (this._vDlTimer) { clearInterval(this._vDlTimer); this._vDlTimer = null; }
  },
  _vDlCheck() {
    if (this._dead || this.data.mode !== 'video' || this.data.vstage !== ppt.V_STAGE.download) return false;
    const now = Date.now();
    if (now - this._vDlSeenAt > V_DL_STALL_MS) { this._vDlClear(); this._vDownloadFail(); return true; }
    return false;
  },
  _vDownloadFail() {
    if (this._dead || this.data.mode !== 'video') return;
    this._vDlClear();
    const n = ppt.videoStageNext(ppt.V_STAGE.download, 'download-fail');
    this._vTempPath = '';
    this.setData({ vdl: null });
    if (n.hint) this._vHint(n.hint);
    this._vGoStep(n.toast);       // 仍失败 → 自动切分步（不阻塞，§11.4）
  },
  _vPlayTemp() {
    const src = this._vTempPath;
    if (!src) { this._vGoStep(); return; }
    const cur = Number(this.data.vt) || 0;
    this._vNeedSeek = cur > 0.5 ? cur : 0;
    this._vStarted = false;
    const self = this;
    this.setData({
      vstage: ppt.V_STAGE.temp, vsrc: src, vauto: false, vloading: true, vpaused: false, vdl: null
    }, function () {
      if (self._dead) return;
      try { self._vCtx = wx.createVideoContext('plv', self); } catch (e) { self._vCtx = null; }
      self._vArmStartWatch();
      self._showVCtrl();
    });
  },

  /* ---------------- 播放控制 ---------------- */
  _vCtxPlay() {
    try { if (this._vCtx) this._vCtx.play(); } catch (e) { /* ignore */ }
    if (this.data.vpaused) this.setData({ vpaused: false });
  },
  _vCtxPause() {
    try { if (this._vCtx) this._vCtx.pause(); } catch (e) { /* ignore */ }
    this._vSave();
    this._syncLeaveGuard();
  },
  _vSeek(t) {
    if (this._dead || this.data.mode !== 'video') return;
    const dur = Number(this.data.vdur) || 0;
    let tt = Math.max(0, Number(t) || 0);
    if (dur > 0) tt = Math.min(tt, Math.max(0, dur - 0.05));
    this._vNeedSeek = -1;
    try { if (this._vCtx) this._vCtx.seek(tt); } catch (e) { /* ignore */ }
    this._vUpdateTime(tt);
    this._vSaveAt = 0;
    this._vSave();
    this._showVCtrl();
  },
  _vPageStep(dir) {
    if (this._dead || this.data.mode !== 'video') return;
    const v = this._v;
    if (!v) return;
    const n = ppt.videoPrevNext(v, Number(this.data.vt) || 0, dir);
    if (!n) { this._vHint(dir > 0 ? '已是最后一页' : '已是第一页'); return; }
    this._vSeek(n.t);             // 按章节 seek（§11.3.2），播放状态保持不变
  },
  _vRestart() {
    if (this._dead || this.data.mode !== 'video') return;
    ppt.clearResume(this._id);
    if (this.data.vstage === ppt.V_STAGE.step) return;
    this._vSeek(0);
    this._vCtxPlay();
  },
  _vUpdateTime(t) {
    const v = this._v;
    const dur = Number(this.data.vdur) || (v ? v.dur : 0);
    const d = {
      vt: t,
      vtimeText: ppt.videoTimeText(t, dur),
      vpct: ppt.videoPct(t, dur)
    };
    const page = v ? ppt.videoPageOf(v, t) : -1;
    if (page >= 0) d.vpage = page + 1;
    this.setData(d);
    const ch = v ? ppt.videoChapterAt(v, t) : -1;
    if (ch !== this._vCh) { this._vCh = ch; this._syncLeaveGuard(); }
  },
  _vHint(text) {
    if (!text) return;
    this.setData({ vhint: text });
    if (this._vHintTimer) clearTimeout(this._vHintTimer);
    const self = this;
    this._vHintTimer = setTimeout(function () {
      self._vHintTimer = null;
      if (!self._dead) self.setData({ vhint: '' });
    }, 3000);
  },
  _showVCtrl() {
    if (this._dead || this.data.mode !== 'video') return;
    if (!this.data.vctrlOn) this.setData({ vctrlOn: true });
    if (this._vCtrlTimer) clearTimeout(this._vCtrlTimer);
    const self = this;
    this._vCtrlTimer = setTimeout(function () {
      self._vCtrlTimer = null;
      if (self._dead) return;
      if (self.data.vctrlOn && !self.data.vloading) self.setData({ vctrlOn: false });
    }, V_CTRL_HIDE_MS);
  },
  _hideVCtrl() {
    if (this._vCtrlTimer) { clearTimeout(this._vCtrlTimer); this._vCtrlTimer = null; }
    if (this.data.vctrlOn) this.setData({ vctrlOn: false });
  },
  _toggleVCtrl() {
    if (this._dead || this.data.mode !== 'video') return;
    if (this.data.vctrlOn) this._hideVCtrl();
    else this._showVCtrl();
  },
  _evClientX(e) {
    const t = (e && e.touches && e.touches[0]) || (e && e.changedTouches && e.changedTouches[0]) || null;
    if (t && isFinite(t.clientX)) return t.clientX;
    const d = e && e.detail;
    if (d && isFinite(d.x)) return d.x;
    return NaN;
  },

  /* ---------------- 视频事件（wxml bind*） ---------------- */
  onVMeta(e) {
    if (this._dead || this.data.mode !== 'video') return;
    const det = (e && e.detail) || {};
    const d = Number(det.duration);
    const dur = isFinite(d) && d > 0 ? d : (Number(this.data.vdur) || 0);
    const set = { vdur: dur, vtimeText: ppt.videoTimeText(Number(this.data.vt) || 0, dur) };
    const target = this._vNeedSeek;
    if (target >= 0) {
      this._vNeedSeek = -1;
      try { if (this._vCtx) this._vCtx.seek(target); } catch (err) { /* ignore */ }
    }
    this.setData(set);
    this._vCtxPlay();          // autoplay 被系统拒绝时兜底（§11.3.1 显示大播放键）
  },
  onVTime(e) {
    if (this._dead || this.data.mode !== 'video') return;
    const t = Number((e && e.detail && e.detail.currentTime));
    if (!isFinite(t)) return;
    // 起播判定以 timeupdate 为准（部分基础库/注入场景不触发 bindplaying；
    // 视频能推进时间就证明真的在播 → 清掉 5s 降级看门狗与缓冲态）
    if (!this._vStarted) {
      this._vStarted = true;
      this._vClearStartWatch();
    }
    if (this.data.vloading && t > 0.2) this.setData({ vloading: false });
    this._vUpdateTime(t);
    const now = Date.now();
    if (now - this._vSaveAt > V_SAVE_MS) { this._vSaveAt = now; this._vSave(); }
  },
  onVPlay() {
    if (this._dead || this.data.mode !== 'video') return;
    this._vStarted = true;
    this._vClearStartWatch();
    this.setData({ vpaused: false, vloading: false });
    this._syncLeaveGuard();
  },
  onVPause() {
    if (this._dead || this.data.mode !== 'video') return;
    this.setData({ vpaused: true });
    this._vSave();
  },
  onVWaiting() {
    if (this._dead || this.data.mode !== 'video') return;
    this.setData({ vloading: true });          // 40–55MB 直链流播需要缓冲态
  },
  onVPlaying() {
    if (this._dead || this.data.mode !== 'video') return;
    this._vStarted = true;
    this._vClearStartWatch();
    this.setData({ vloading: false, vpaused: false });
    this._syncLeaveGuard();
  },
  onVCanPlay() {
    if (this._dead || this.data.mode !== 'video') return;
    if (this.data.vloading && this.data.vsrc && this.data.vstage !== ppt.V_STAGE.download) this.setData({ vloading: false });
  },
  onVEnded() {
    if (this._dead || this.data.mode !== 'video') return;
    const dur = Number(this.data.vdur) || 0;
    this.setData({ vpaused: true, vt: dur, vtimeText: ppt.videoTimeText(dur, dur), vpct: 100 });
    ppt.clearResume(this._id);                  // 播完 = 到达末尾，列表不再显示「继续」
    this._syncLeaveGuard();
    this._showVCtrl();
  },
  onVErr() {
    if (this._dead || this.data.mode !== 'video') return;
    const stage = this.data.vstage;
    if (stage === ppt.V_STAGE.direct) this._vFallback('direct-error');
    else if (stage === ppt.V_STAGE.temp) this._vFallback('temp-error');
  },
  onVTS(e) {
    const t = (e && e.touches && e.touches[0]) || null;
    if (!t) return;
    this._vt0 = { x: t.clientX, y: t.clientY, at: Date.now() };
  },
  onVTE(e) {
    const t = (e && e.changedTouches && e.changedTouches[0]) || null;
    const s = this._vt0;
    this._vt0 = null;
    if (!t || !s || this._dead || this.data.mode !== 'video') return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    const w = Number(this.data.winW) || 375;
    const swipeMin = Math.max(SWIPE_MIN, Math.round(w * 0.12));
    if (Math.abs(dx) >= swipeMin && Math.abs(dx) > Math.abs(dy) * 1.2) {
      this._vPageStep(dx < 0 ? 1 : -1);       // 左右滑 = 上一页/下一页（§11.3.2）
    }
  },
  // 点击舞台 = 显示/隐藏控制条（不做 1/3 点击翻页，§11.3.2）
  onVStageTap() { this._toggleVCtrl(); },

  /* ---------------- 控制条按钮（wxml bindtap） ---------------- */
  onVToggle() { if (this.data.vpaused) this._vCtxPlay(); else this._vCtxPause(); this._showVCtrl(); },
  onVBigPlay() { this._vCtxPlay(); this._showVCtrl(); },
  onVPrevPage() { this._vPageStep(-1); },
  onVNextPage() { this._vPageStep(1); },
  onVRateTap() {
    if (this._dead) return;
    const r = ppt.nextRate(this.data.vrate);
    try { if (this._vCtx) this._vCtx.playbackRate(r); } catch (e) { /* ignore */ }
    this.setData({ vrate: r, vrateText: ppt.rateText(r) });
    this._showVCtrl();
  },
  onVCopyLink() {
    const v = this._v;
    if (!v || !v.url) return;
    try {
      wx.setClipboardData({
        data: v.url,
        success: function () { util.toast('可在浏览器下载/播放'); },
        fail: function () { util.toast('复制失败'); }
      });
    } catch (e) { util.toast('复制失败'); }
    this._showVCtrl();
  },
  onVRestart() { this._vRestart(); },
  onVBarTap(e) {
    if (this._dead || this.data.mode !== 'video') return;
    const x = this._evClientX(e);
    if (!isFinite(x)) return;
    const self = this;
    const apply = function (rect) {
      if (self._dead || !rect || !(rect.width > 0)) return;
      const ratio = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
      const dur = Number(self.data.vdur) || 0;
      if (dur > 0) self._vSeek(ratio * dur);
    };
    try {
      const q = wx.createSelectorQuery();
      q.select('.pl-vbar').boundingClientRect();
      q.exec(function (res) { apply(res && res[0]); });
    } catch (err) { /* ignore */ }
    this._showVCtrl();
  },
  onVTickTap(e) {
    if (this._dead) return;
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const page = Number(ds.i);
    let target = -1;
    if (this._v) target = ppt.videoSeekTarget(this._v, page);
    if (target < 0 && isFinite(Number(ds.t))) target = Number(ds.t) + 0.05;
    if (target < 0) return;
    this._vSeek(target);
  },

  /* ---------------- 黑屏（课堂单键；点击任意处恢复） ---------------- */
  toggleBlack() {
    if (this._dead) return;
    if (this.data.black) {
      if (this._blackTimer) { clearTimeout(this._blackTimer); this._blackTimer = null; }
      this.setData({ black: false, blackHint: false, ctrlOn: false });   // 恢复不显示任何 UI
      return;
    }
    this._closeMedia();
    if (this.data.mode === 'video') this._vPauseSave();   // 黑屏讲解时暂停原样播放（避免只闻其声）
    this.setData({ black: true, blackHint: true, drawer: '', ctrlOn: false });
    const self = this;
    this._blackTimer = setTimeout(function () {
      self._blackTimer = null;
      if (!self._dead) self.setData({ blackHint: false });
    }, 1600);
  },

  /* ---------------- 抽屉：缩略图 / 备注 ---------------- */
  openThumb() { this._hideCtrl(); this.setData({ drawer: 'thumb', ctrlOn: false }); },
  openNotes() { this._hideCtrl(); this.setData({ drawer: 'notes', ctrlOn: false }); },
  closeDrawer() { this.setData({ drawer: '' }); this._showCtrl(); },
  pickThumb(e) {
    const p = Number((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.p));
    if (!(p >= 0)) return;
    const j = ppt.pageStart(this._m, p);
    if (j < 0) return;
    this.setData({ drawer: '' });
    this._showCtrl();
    this._go(j);
  },

  /* ---------------- 更多：从头播放 / 下载原件 / 退出演示 ---------------- */
  openMore() {
    this._hideCtrl();
    const hasSrc = !!(this._m && this._m.src);
    const items = hasSrc ? ['从头播放', '下载原件', '退出演示'] : ['从头播放', '退出演示'];
    const self = this;
    wx.showActionSheet({
      itemList: items,
      success(res) {
        const i = (res && res.tapIndex) || 0;
        if (i === 0) { self.restart(); return; }
        if (hasSrc && i === 1) self._downloadSource();
        else self.closePlayer();
      }
    });
  },
  // 「从头播放」（§11.3.4）：视频 seek 0 / 分步回第 1 页第 1 步
  restart() {
    if (this._dead) return;
    if (this.data.mode === 'video') { this._vRestart(); return; }
    ppt.clearResume(this._id);
    this._go(0);
    this._showCtrl();
  },
  _downloadSource() {
    ppt.openSourceUrl(this._m && this._m.src).then(function (r) {
      if (!r.ok) util.toast(r.reason || '原件下载失败');
    });
  },
  closePlayer() {
    if (this._dead) return;
    this._savePos();                 // 退出前落续播（§11.3.4）
    let hasProgress = false;
    if (this.data.mode === 'video') {
      const dur = Number(this.data.vdur) || (this._v ? this._v.dur : 0);
      const t = Number(this.data.vt) || 0;
      hasProgress = t > 5 && !(dur > 0 && t >= dur * 0.95);
    } else {
      hasProgress = !!(this._idx > 0 && this._flat && this._idx < this._flat.length - 1);
    }
    const self = this;
    if (!hasProgress) { this._back(); return; }
    wx.showModal({
      title: '退出演示？',
      content: '',
      confirmText: '退出',
      cancelText: '继续',
      success(res) { if (res && res.confirm) self._back(); }
    });
  },
  _back() {
    try {
      wx.navigateBack({ delta: 1, fail: function () { wx.switchTab({ url: '/pages/all/all' }); } });
    } catch (e) { wx.switchTab({ url: '/pages/all/all' }); }
  },
  goAll() { wx.switchTab({ url: '/pages/all/all' }); },
  // 有进度且不在末尾时，系统返回手势二次确认（DESIGN §4.3；视频模式按秒数判断 §11.3.4）
  _syncLeaveGuard() {
    if (typeof wx.enableAlertBeforeUnload !== 'function') return;
    let on = false;
    if (this.data.mode === 'video') {
      const dur = Number(this.data.vdur) || (this._v ? this._v.dur : 0);
      const t = Number(this.data.vt) || 0;
      on = t > 5 && !(dur > 0 && t >= dur * 0.95);
    } else {
      on = !!(this._flat && this._idx > 0 && this._idx < this._flat.length - 1);
    }
    try {
      if (on && !this._leaveGuard) { wx.enableAlertBeforeUnload({ message: '退出演示？' }); this._leaveGuard = true; }
      else if (!on && this._leaveGuard) { if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload(); this._leaveGuard = false; }
    } catch (e) { /* 旧基础库忽略（关闭按钮仍有确认） */ }
  },

  /* ---------------- 预加载（当前步后 2 张 + 相邻页缩略图；wx.downloadFile ≤4；弱网暂停） ---------------- */
  _bindNet() {
    const self = this;
    const setType = function (t) {
      self._netType = strType(t);
      self._netOff = (self._netType === '2g' || self._netType === 'none');
      if (!self._netGot) {
        self._netGot = true;
        const f = self._netQueue;
        self._netQueue = null;
        if (f) f();
      }
    };
    try {
      if (wx.onNetworkStatusChange) {
        this._netCb = function (res) { setType((res && res.networkType) || ''); };
        wx.onNetworkStatusChange(this._netCb);
      }
      if (wx.getNetworkType) {
        wx.getNetworkType({
          success: function (r) { setType((r && r.networkType) || ''); },
          fail: function () { setType(''); }     // 取不到就按网络良好处理（失败再降级，§11.3.1）
        });
      } else {
        setType('');
      }
    } catch (e) { setType(''); }
  },
  _preload(idx) {
    if (!this._m || this._netOff) return;
    if (this.data.mode === 'video') return;   // 原样播放不预加载分步图（省 40–55MB 视频带宽，§11.3.1）
    const plan = ppt.preloadPlan(this._m, idx);
    const urls = plan.steps.concat(plan.thumbs);
    for (let i = 0; i < urls.length; i++) this._enqueueDl(urls[i]);
  },
  _enqueueDl(url) {
    const u = String(url || '');
    if (!u || this._dlDone[u]) return;
    if (this._dlQ.indexOf(u) >= 0) return;
    this._dlQ.push(u);
    if (this._dlQ.length > PRELOAD_MAX) this._dlQ.shift();
    this._dlPump();
  },
  _dlPump() {
    if (this._dead) return;
    while (this._dlActive < PRELOAD_CONCURRENCY && this._dlQ.length) {
      const u = this._dlQ.shift();
      if (!u || this._dlDone[u]) continue;
      this._dlDone[u] = true;
      this._dlActive += 1;
      const self = this;
      try {
        wx.downloadFile({
          url: u,
          success: function () { self._dlActive -= 1; self._dlPump(); },
          fail: function () { self._dlActive -= 1; self._dlPump(); }
        });
      } catch (e) { this._dlActive -= 1; }
    }
  },

  /* ---------------- 退出释放 ---------------- */
  _release() {
    this._savePos();                 // 退出前落续播（§11.3.4；onHide 已存过一次，这里兜底）
    this._dead = true;
    if (this._ctrlTimer) { clearTimeout(this._ctrlTimer); this._ctrlTimer = null; }
    if (this._titleTimer) { clearTimeout(this._titleTimer); this._titleTimer = null; }
    if (this._bTimer) { clearTimeout(this._bTimer); this._bTimer = null; }
    if (this._blackTimer) { clearTimeout(this._blackTimer); this._blackTimer = null; }
    if (this._layoutT) { clearTimeout(this._layoutT); this._layoutT = null; }
    if (this._vCtrlTimer) { clearTimeout(this._vCtrlTimer); this._vCtrlTimer = null; }
    if (this._vHintTimer) { clearTimeout(this._vHintTimer); this._vHintTimer = null; }
    if (this._vStartT) { clearTimeout(this._vStartT); this._vStartT = null; }
    this._vDlClear();
    this._vAbortDownload();          // 退出时取消下载降级（§11.4）
    try { if (this._vCtx) { this._vCtx.stop(); this._vCtx = null; } } catch (e) { /* ignore */ }
    this._stopAudio();
    try {
      if (this._leaveGuard && wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
      this._leaveGuard = false;
    } catch (e) { /* ignore */ }
    try { if (this._netCb && wx.offNetworkStatusChange) wx.offNetworkStatusChange(this._netCb); } catch (e) { /* ignore */ }
    try { if (this._resizeCb && wx.offWindowResize) wx.offWindowResize(this._resizeCb); } catch (e) { /* ignore */ }
    try { wx.setKeepScreenOn({ keepScreenOn: false }); } catch (e) { /* ignore */ }
    // 释放图片/视频解码（页面销毁前兜底；<video> 随节点移除释放）
    try { this.setData({ imgA: '', imgB: '', video: null, hot: [], vsrc: '', vdl: null }); } catch (e) { /* ignore */ }
    this._flat = [];
    this._m = null;
    this._v = null;
    this._dlQ = [];
    this._dlDone = {};
  },

  onShareAppMessage() {
    return share.message({
      title: '班级工具｜演示',
      path: '/pages/ppt/ppt',
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '班级工具｜演示 · PPT 分步播放',
      imageUrl: '/images/share/default.png'
    });
  }
});
