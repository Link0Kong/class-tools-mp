// ai/skills/notice/components/notice-detail-card/index.js —— 通知详情卡片
// 原子组件限制：只读 structuredContent/_meta，不联网、不定时器、不滚动、不加动画。
Component({
  lifetimes: {
    created() {
      this._ctx = wx.modelContext.getContext(this);
      this._view = wx.modelContext.getViewContext(this);
      try { this._view.setRelatedPage({ query: '' }); } catch (e) { /* ignore */ }
      const NT = wx.modelContext.NotificationType || {};
      this._ctx.on(NT.Result || 'result', (data) => {
        const r = (data && data.result) || {};
        const sc = (r._meta && r._meta.cardData) || r.structuredContent || {};
        this.renderCard(sc);
      });
    }
  },
  data: {
    title: '通知详情', detail: null, fields: [], points: [], raw: [], items: [],
    senderName: '', senderRole: '', ocrText: '', offline: false
  },
  methods: {
    renderCard(sc) {
      sc = sc || {};
      const d = sc.detail || (sc.item || sc.detail || null);
      if (!d) {
        this.setData({ title: sc.title || '通知详情', detail: null, fields: [], points: [], raw: [], items: [] });
        return;
      }
      const fields = [];
      const f = d.fields && typeof d.fields === 'object' ? d.fields : {};
      Object.keys(f).forEach(function (k) {
        if (fields.length < 6) fields.push({ k: String(k), v: String(f[k] || '').slice(0, 90) });
      });
      const kindText = { file: '附件', form: '收集表', link: '链接', mini: '小程序', article: '文章', merged: '聊天记录' };
      const items = (Array.isArray(d.items) ? d.items : []).slice(0, 5).map(function (it) {
        return {
          kind: String(it.kind || ''),
          kindText: kindText[it.kind] || '详情',
          name: String(it.name || it.title || ''),
          meta: [it.size, it.type, it.statusText, it.host, it.count ? (it.count + ' 条') : '', it.note]
            .filter(function (x) { return !!x; }).join(' · ')
        };
      });
      const raw = (Array.isArray(d.raw) ? d.raw : []).slice(0, 3).map(function (r) {
        return {
          label: String(r.label || '原始消息'),
          meta: [r.fromName, r.fromBadge, r.time].filter(function (x) { return !!x; }).join(' · '),
          text: String(r.text || '').slice(0, 300)
        };
      });
      const points = (Array.isArray(d.points) ? d.points : []).slice(0, 6).map(function (p) { return String(p).slice(0, 80); });
      const ocr = d.ocr && d.ocr.flagged ? ('含 OCR 识别内容' + (d.ocr.count ? '（' + d.ocr.count + ' 处）' : '')) : '';
      this.setData({
        title: d.title || sc.title || '通知详情',
        detail: {
          id: String(d.id || ''),
          category: String(d.category || '通知'),
          statusText: String(d.statusText || ''),
          expired: !!d.expired,
          done: !!d.done,
          pinned: !!d.pinned,
          deadlineText: String(d.deadlineText || ''),
          eventText: String(d.eventText || ''),
          summary: String(d.summary || '').slice(0, 300),
          images: Number(d.images) || 0,
          source: String(d.source || '')
        },
        fields: fields,
        points: points,
        raw: raw,
        items: items,
        senderName: String((d.sender && d.sender.name) || ''),
        senderRole: String((d.sender && d.sender.role) || ''),
        ocrText: ocr,
        offline: !!sc.offline
      });
      const id = String(d.id || '');
      try { this._view.setRelatedPage({ query: id ? ('gid=' + encodeURIComponent(id)) : '' }); } catch (e) { /* ignore */ }
    },
    follow(text, name, args) {
      this._ctx.sendFollowUpMessage({
        content: [
          { type: 'text', text: String(text) },
          { type: 'api/call', data: { name: String(name), arguments: args || {} } }
        ]
      });
    },
    onDoneTap() {
      const d = this.data.detail;
      if (!d || !d.id) return;
      this.follow('把这条通知标记为已处理', 'setNoticeDone', { noticeId: d.id, done: true });
    },
    onUndoneTap() {
      const d = this.data.detail;
      if (!d || !d.id) return;
      this.follow('把这条通知恢复为待处理', 'setNoticeDone', { noticeId: d.id, done: false });
    },
    onPinTap() {
      const d = this.data.detail;
      if (!d || !d.id) return;
      this.follow(d.pinned ? '取消置顶这条通知' : '置顶这条通知', 'setNoticePinned', { noticeId: d.id, pinned: !d.pinned });
    }
  }
});
