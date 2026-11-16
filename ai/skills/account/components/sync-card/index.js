// ai/skills/account/components/sync-card/index.js —— 云同步状态卡（原子组件）
//
// 卡片内唯一交互：点「立即同步」→ 以用户第一人称上行一条消息并显式调用 syncNow（官方 §3.5/§7）。
Component({
  data: { d: {}, ready: false, canSync: false },
  lifetimes: {
    created() {
      try {
        const ctx = wx.modelContext.getContext(this);
        const view = wx.modelContext.getViewContext(this);
        const N = wx.modelContext.NotificationType;
        this._ctx = ctx;
        this._view = view;
        ctx.on(N.Result, (event) => {
          const r = (event && event.result) || {};
          const sc = r.structuredContent || {};
          const card = (r._meta && r._meta.cardData) || sc;
          this.setData({
            d: card || {},
            ready: !!card && (card.off !== undefined || card.refreshed !== undefined),
            canSync: !!(card && card.verified && !card.off && card.networkEnabled)
          });
          try { view.setRelatedPage({ query: 'tab=sync' }); } catch (e) { /* 忽略 */ }
        });
      } catch (e) { /* 非 AI 环境静默降级 */ }
    }
  },
  methods: {
    onSync() {
      try {
        this._ctx.sendFollowUpMessage({
          content: [
            { type: 'text', text: '帮我立即同步一下云端数据' },
            { type: 'api/call', data: { name: 'syncNow', arguments: {} } }
          ]
        });
      } catch (e) { /* 忽略 */ }
    }
  }
});
