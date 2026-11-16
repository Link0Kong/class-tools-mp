// ai/skills/identity/components/profile-card/index.js —— 身份卡（原子组件）
//
// 原子组件约束（官方「接入方式 §3.5」）：
//   * 只能读 wx.modelContext 的 Result 事件；无网络、无定时器、无动画、无页面跳转；
//   * created 里拿 context/view，Result 到达后渲染并 setRelatedPage（卡片右上角进小程序页面）。
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
          this.setData({ d: card || {}, ready: !!(card && card.name) });
          try { view.setRelatedPage({ query: '' }); } catch (e) { /* 忽略 */ }
        });
      } catch (e) { /* 非 AI 环境静默降级 */ }
    }
  }
});
