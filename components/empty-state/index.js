// components/empty-state —— M3 空态：大圆形 tonal 图形 + 标题 + 副文 + 主按钮
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    icon: { type: String, value: '📭' },
    title: { type: String, value: '暂无数据' },
    text: { type: String, value: '' },
    actionText: { type: String, value: '' }
  },
  methods: { onAction() { this.triggerEvent('action'); } }
});
