// components/bottom-sheet —— M3 底部弹层（顶部圆角 xl + 遮罩拦截滚动）
Component({
  options: { multipleSlots: true, styleIsolation: 'apply-shared' },
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' }
  },
  methods: {
    noop() {},
    onClose() { this.triggerEvent('close'); }
  }
});
