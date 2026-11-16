// ai/skills/account/components/data-card/index.js —— 数据概览 / 导出卡（原子组件）
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
          this.setData({ d: card || {}, ready: !!(card && (card.counts || card.summary || card.cleared)) });
          try { view.setRelatedPage({ query: 'tab=overview' }); } catch (e) { /* 忽略 */ }
        });
      } catch (e) { /* 非 AI 环境静默降级 */ }
    }
  }
});
