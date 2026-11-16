// ai/skills/account/components/feedback-card/index.js —— 反馈记录 / 已提交卡（原子组件）
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
          this.setData({ d: card || {}, ready: !!(card && (card.items || card.feedbackId || card.ok)) });
          try { view.setRelatedPage({ query: 'tab=mine' }); } catch (e) { /* 忽略 */ }
        });
      } catch (e) { /* 非 AI 环境静默降级 */ }
    }
  }
});
