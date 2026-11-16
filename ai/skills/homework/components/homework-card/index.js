// ai/skills/homework/components/homework-card/index.js —— 作业卡片（列表 / 详情 / 概览 / 空态）
// 原子组件限制：只读 structuredContent/_meta，不联网、不定时器、不滚动、不加动画。
Component({
  lifetimes: {
    created() {
      this._ctx = wx.modelContext.getContext(this);
      this._view = wx.modelContext.getViewContext(this);
      try { this._view.setRelatedPage({ query: 'tab=pending' }); } catch (e) { /* ignore */ }
      const NT = wx.modelContext.NotificationType || {};
      this._ctx.on(NT.Result || 'result', (data) => {
        const r = (data && data.result) || {};
        const sc = (r._meta && r._meta.cardData) || r.structuredContent || {};
        this.renderCard(sc);
      });
    }
  },
  data: {
    title: '作业',
    mode: 'list',          // list | detail | summary
    items: [],
    item: null,
    stats: null,
    total: 0,
    emptyText: '没有符合条件的作业',
    offline: false,
    tab: 'pending'
  },
  methods: {
    renderCard(sc) {
      sc = sc || {};
      const detail = sc.item || null;
      const items = (Array.isArray(sc.items) ? sc.items : []).slice(0, 6).map(function (it) {
        return {
          id: String(it.id || ''),
          subject: it.subject || '',
          content120: it.content120 || '',
          dueText: it.dueText || '',
          author: it.author || '',
          done: !!it.done,
          status: it.status || (it.done ? 'done' : 'pending'),
          statusText: it.done ? '已完成' : (it.status === 'overdue' ? '已过截止' : '待交')
        };
      });
      const item = detail ? {
        id: String(detail.id || ''),
        subject: detail.subject || '',
        content: String(detail.content || '').slice(0, 320),
        more: String(detail.content || '').length > 320,
        dueText: detail.dueText || '',
        dueDateText: detail.dueDateText || '',
        author: detail.author || '',
        done: !!detail.done,
        status: detail.status || (detail.done ? 'done' : 'pending'),
        statusText: detail.done ? '已完成' : (detail.status === 'overdue' ? '已过截止' : '待交'),
        attachments: (Array.isArray(detail.attachments) ? detail.attachments : []).slice(0, 4).map(function (a) {
          return { name: String(a.name || '附件'), sizeText: a.sizeText || '' };
        })
      } : null;
      // 概览：无 item、无 items 数组，但带 pending/done/overdue 计数
      const isSummary = !item && !Array.isArray(sc.items) && sc.pending !== undefined;
      const stats = isSummary ? {
        pending: Number(sc.pending) || 0,
        done: Number(sc.done) || 0,
        overdue: Number(sc.overdue) || 0,
        next: sc.next ? {
          id: String(sc.next.id || ''),
          subject: String(sc.next.subject || '作业'),
          leftText: String(sc.next.leftText || '')
        } : null
      } : null;
      const tab = sc.tab || (item && item.done ? 'done' : 'pending');
      const mode = item ? 'detail' : (isSummary ? 'summary' : 'list');
      this.setData({
        title: sc.title || '作业',
        mode: mode,
        items: items,
        item: item,
        stats: stats,
        total: Number(sc.total) || items.length,
        emptyText: sc.emptyText || '没有符合条件的作业',
        offline: !!sc.offline,
        tab: tab
      });
      try {
        this._view.setRelatedPage({ query: 'tab=' + tab + (item && item.id ? '&id=' + encodeURIComponent(item.id) : '') });
      } catch (e) { /* ignore */ }
    },
    follow(text, name, args) {
      this._ctx.sendFollowUpMessage({
        content: [
          { type: 'text', text: String(text) },
          { type: 'api/call', data: { name: String(name), arguments: args || {} } }
        ]
      });
    },
    onItemTap(e) {
      const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
      if (!id) return;
      this.follow('查看这条作业的详情', 'getHomeworkDetail', { homeworkId: id });
    },
    onDoneTap(e) {
      const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
      if (!id) return;
      this.follow('把这条作业标记为已完成', 'setHomeworkDone', { homeworkId: id, done: true });
    },
    onPendingTap(e) {
      const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
      if (!id) return;
      this.follow('把这条作业的完成标记取消', 'setHomeworkDone', { homeworkId: id, done: false });
    },
    onListTap() {
      this.follow('看看待交的作业列表', 'listHomework', { status: 'pending' });
    }
  }
});
