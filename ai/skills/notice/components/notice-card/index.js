// ai/skills/notice/components/notice-card/index.js —— 通知列表卡片
// 原子组件限制：只读 structuredContent/_meta，不联网、不定时器、不滚动、不加动画。
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
  data: { title: '班级通知', items: [], total: 0, status: 'pending', offline: false, confirm: null },
  methods: {
    renderCard(sc) {
      sc = sc || {};
      // 确认态：setNoticeDone / setNoticePinned 的返回（无 items，只有 done/pinned）
      const isConfirm = !Array.isArray(sc.items) && (sc.done !== undefined || sc.pinned !== undefined);
      let confirm = null;
      if (isConfirm) {
        let text = '状态已更新';
        if (sc.done === true) text = '已标记为已处理';
        else if (sc.done === false) text = '已恢复为待处理';
        else if (sc.pinned === true) text = '已置顶';
        else if (sc.pinned === false) text = '已取消置顶';
        if (sc.pending) text += '（本机已生效，联网后自动同步）';
        confirm = { text: text, pending: !!sc.pending };
      }
      const items = (Array.isArray(sc.items) ? sc.items : []).slice(0, 6).map(function (it) {
        const files = (Array.isArray(it.files) ? it.files : []).slice(0, 2).map(function (f) {
          return { name: String(f.name || '附件'), size: String(f.size || '') };
        });
        return {
          id: String(it.id || ''),
          title: String(it.title || '班级通知'),
          category: String(it.category || '通知'),
          statusText: String(it.statusText || ''),
          expired: !!it.expired,
          done: !!it.done,
          pinned: !!it.pinned,
          deadlineText: String(it.deadlineText || ''),
          eventText: String(it.eventText || ''),
          summary: String(it.summary || '').slice(0, 90),
          images: Number(it.images) || 0,
          files: files,
          timeText: String(it.timeText || '')
        };
      });
      const status = sc.status || 'pending';
      this.setData({
        title: sc.title || '班级通知',
        items: items,
        total: Number(sc.total) || items.length,
        status: status,
        offline: !!sc.offline,
        confirm: confirm
      });
      if (isConfirm) return;
      const filter = status === 'all' ? '' : status;
      try { this._view.setRelatedPage({ query: filter ? ('filter=' + filter) : '' }); } catch (e) { /* ignore */ }
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
      this.follow('看看这条通知的详情', 'getNoticeDetail', { noticeId: id });
    },
    onDoneTap(e) {
      const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
      if (!id) return;
      this.follow('把这条通知标记为已处理', 'setNoticeDone', { noticeId: id, done: true });
    }
  }
});
