// ai/skills/account/components/stats-card/index.js —— 访问统计卡（原子组件，仅管理员）
Component({
  data: { d: {}, ready: false },
  lifetimes: {
    created() {
      try {
        const ctx = wx.modelContext.getContext(this);
        const view = wx.modelContext.getViewContext(this);
        const N = wx.modelContext.NotificationType;
        this._view = view;
        ctx.on(N.Result, (event) => {
          const r = (event && event.result) || {};
          const sc = r.structuredContent || {};
          const card = (r._meta && r._meta.cardData) || sc;
          this.setData({ d: card || {}, ready: !!card && card.total !== undefined });
          try { view.setRelatedPage({ query: 'days=7' }); } catch (e) { /* 忽略 */ }
        });
      } catch (e) { /* 非 AI 环境静默降级 */ }
    }
  }
});
