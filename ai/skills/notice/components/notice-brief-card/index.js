// ai/skills/notice/components/notice-brief-card/index.js —— 通知简报卡片
Component({
  lifetimes: {
    created() {
      this._ctx = wx.modelContext.getContext(this);
      this._view = wx.modelContext.getViewContext(this);
      try { this._view.setRelatedPage({ query: 'filter=pending' }); } catch (e) { /* ignore */ }
      const NT = wx.modelContext.NotificationType || {};
      this._ctx.on(NT.Result || 'result', (data) => {
        const r = (data && data.result) || {};
        const sc = (r._meta && r._meta.cardData) || r.structuredContent || {};
        this.renderCard(sc);
      });
    }
  },
  data: {
    title: '通知简报', pending: 0, urgent24h: 0, week: 0, expired: 0,
    next: null, offline: false
  },
  methods: {
    renderCard(sc) {
      sc = sc || {};
      const next = sc.next ? {
        id: String(sc.next.id || ''),
        title: String(sc.next.title || ''),
        statusText: String(sc.next.statusText || ''),
        deadlineText: String(sc.next.deadlineText || '')
      } : null;
      this.setData({
        title: sc.title || '通知简报',
        pending: Number(sc.pending) || 0,
        urgent24h: Number(sc.urgent24h) || 0,
        week: Number(sc.week) || 0,
        expired: Number(sc.expired) || 0,
        next: next,
        offline: !!sc.offline
      });
      try { this._view.setRelatedPage({ query: 'filter=pending' }); } catch (e) { /* ignore */ }
    },
    follow(text, name, args) {
      this._ctx.sendFollowUpMessage({
        content: [
          { type: 'text', text: String(text) },
          { type: 'api/call', data: { name: String(name), arguments: args || {} } }
        ]
      });
    },
    onNextTap() {
      if (!this.data.next || !this.data.next.id) return;
      this.follow('看看最紧迫的那条通知', 'getNoticeDetail', { noticeId: this.data.next.id });
    },
    onListTap() {
      this.follow('看看待处理的通知列表', 'listNotices', { status: 'pending' });
    },
    onExpiredTap() {
      this.follow('看看已过期的通知', 'listNotices', { status: 'expired' });
    }
  }
});
