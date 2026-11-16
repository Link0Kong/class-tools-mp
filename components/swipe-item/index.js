// components/swipe-item —— M3 观感的左滑操作项（重写自 v2）
// 用法：
//   <swipe-item data-key="{{item.id}}" actions="{{[{id:'done',label:'完成',type:'primary'},{id:'del',label:'删除',type:'error'}]}}"
//               bind:action="onAction" bind:open="onOpen" width="240">
//     <view class="m3-li m3-li--card">…</view>
//   </swipe-item>
// 事件：action -> { id, key }；open -> { key, open }
Component({
  options: { multipleSlots: true, styleIsolation: 'apply-shared' },
  properties: {
    key: { type: String, value: '' },
    index: { type: Number, value: -1 },
    actions: { type: Array, value: [] },
    width: { type: Number, value: 240 },
    disabled: { type: Boolean, value: false }
  },
  data: { x: 0, open: false },
  methods: {
    onStart(e) {
      if (this.data.disabled) return;
      const t = e.touches && e.touches[0];
      this._sx = t ? t.clientX : 0;
      this._sy = t ? t.clientY : 0;
      this._base = this.data.open ? -this.data.width : 0;
      this._lock = null;
    },
    onMove(e) {
      if (this.data.disabled || this._sx == null) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      const dx = t.clientX - this._sx;
      const dy = t.clientY - this._sy;
      if (this._lock === null) this._lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (this._lock !== 'x') return;
      let x = this._base + dx;
      if (x > 0) x = 0;
      if (x < -this.data.width - 40) x = -this.data.width - 40;
      this.setData({ x: x });
    },
    onEnd() {
      if (this.data.disabled || this._sx == null) return;
      const open = this.data.x < -this.data.width / 2;
      this.setData({ x: open ? -this.data.width : 0, open: open });
      if (open !== this.data.open) this.triggerEvent('open', { key: this.data.key, open: open });
      this._sx = null;
    },
    onAct(e) {
      this.setData({ x: 0, open: false });
      this.triggerEvent('action', {
        id: e.currentTarget.dataset.id,
        key: this.data.key,
        index: this.data.index
      });
    },
    onLongPress(e) {
      this.triggerEvent('longpress', { key: this.data.key, index: this.data.index, detail: e.detail });
    },
    close() { this.setData({ x: 0, open: false }); }
  }
});
