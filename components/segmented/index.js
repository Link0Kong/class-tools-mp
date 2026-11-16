// components/segmented —— M3 SegmentedButton（药丸分段控件，带选中滑块动画）
// 用法：
//   <segmented items="{{segs}}" value="{{segVal}}" bindchange="onSeg" />
//   items: [{ id:'a', label:'全部', done:false }, …]   done=true 时标签前显示 ✓（步骤条用）
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    items: { type: Array, value: [] },
    value: { type: String, value: '' },
    compact: { type: Boolean, value: false }
  },
  data: { idx: 0, cell: 100, count: 1 },
  observers: {
    'items, value': function (items, value) {
      const n = (items && items.length) || 1;
      let idx = 0;
      for (let i = 0; i < (items || []).length; i++) { if (items[i].id === value) { idx = i; break; } }
      this.setData({ idx: idx, count: n, cell: 100 / n });
    }
  },
  methods: {
    onTap(e) {
      if (this.data.disabled) return;
      const id = e.currentTarget.dataset.id;
      if (id === this.data.value) return;
      // index 为 1 起的序号（步骤条 1-2-3 语义），i 为 0 起的下标
      this.triggerEvent('change', { value: id, index: Number(e.currentTarget.dataset.i) + 1, i: Number(e.currentTarget.dataset.i) });
    }
  }
});
