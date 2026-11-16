// components/touchable —— M3 触感层（自绘涟漪 ripple + 按压态）
// 用法：<touchable cls="m3-li m3-li--card" bindtap="go">…</touchable>
// 说明：小程序没有内置 ripple，这里在 touchstart 记录触点坐标，自绘圆形做 scale 动画，
//       touchend / touchcancel 后淡出回收。所有可点区域都应包一层。
const appearance = require('../../utils/appearance.js');
Component({
  options: { multipleSlots: true, styleIsolation: 'apply-shared' },
  properties: {
    cls: { type: String, value: '' },
    disabled: { type: Boolean, value: false },
    // 按压态叠色；传 'none' 可关掉；'auto' = 跟随系统主题（暗色用浅色叠色）
    pressColor: { type: String, value: 'auto' }
  },
  data: { rips: [], pressed: false, pressBg: 'rgba(0, 0, 0, 0.05)' },
  lifetimes: {
    detached() {
      if (this._timers) this._timers.forEach(function (t) { clearTimeout(t); });
      this._timers = [];
    }
  },
  methods: {
    // 解析按压叠色：'auto' 时按当前生效主题取（显式外观偏好优先，其次系统；每次 touchstart 读取，切换后立即生效）
    pressBgOf() {
      const v = this.data.pressColor;
      if (v && v !== 'auto') return v;
      let theme = '';
      try { theme = appearance.resolved(); } catch (e) { theme = ''; }
      if (!theme) {
        try {
          const bi = wx.getAppBaseInfo ? wx.getAppBaseInfo() : null;
          theme = (bi && bi.theme) || '';
          if (!theme && wx.getSystemInfoSync) theme = wx.getSystemInfoSync().theme || '';
        } catch (e) { /* 取不到主题时按浅色处理 */ }
      }
      return theme === 'dark' ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.05)';
    },
    onStart(e) {
      if (this.data.disabled) return;
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || null;
      this._pt = t ? { x: t.clientX, y: t.clientY } : null;
      const bg = this.pressBgOf();
      this.setData({ pressed: bg !== 'none', pressBg: bg });
      this.spawn();
    },
    onEnd() {
      if (this.data.pressed) this.setData({ pressed: false });
    },
    spawn() {
      const self = this;
      const pt = this._pt;
      this.createSelectorQuery().select('.tch').boundingClientRect(function (rect) {
        if (!rect) return;
        const cx = pt && typeof pt.x === 'number' ? pt.x - rect.left : rect.width / 2;
        const cy = pt && typeof pt.y === 'number' ? pt.y - rect.top : rect.height / 2;
        const d = Math.max(rect.width, rect.height) * 2.2;
        const id = (self._rid = (self._rid || 0) + 1);
        const item = { id: id, x: cx - d / 2, y: cy - d / 2, d: d };
        const rips = self.data.rips.concat([item]);
        self.setData({ rips: rips });
        self._timers = self._timers || [];
        self._timers.push(setTimeout(function () {
          self.setData({ rips: self.data.rips.filter(function (r) { return r.id !== id; }) });
        }, 460));
      }).exec();
    }
  }
});
