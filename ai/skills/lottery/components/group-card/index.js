// ai/skills/lottery/components/group-card/index.js —— 分组结果卡片
Component({
  data: {
    title: '分组结果',
    modeText: '',
    rows: [],
    more: 0,
    empty: false
  },
  lifetimes: {
    created() {
      try {
        this._ctx = wx.modelContext.getContext(this);
        this._view = wx.modelContext.getViewContext(this);
        this._view.setRelatedPage({ query: 'step=2' });
        const NT = wx.modelContext.NotificationType;
        this._ctx.on(NT.Result, (data) => this._render(data));
      } catch (e) { /* 卡片环境异常时保持初始态 */ }
    }
  },
  methods: {
    _render(data) {
      const res = (data && data.result) || {};
      const sc = res.structuredContent || (data && data.structuredContent) || {};
      const groups = Array.isArray(sc.groups) ? sc.groups : [];
      const rows = groups.slice(0, 8).map((g) => {
        const members = Array.isArray(g && g.members) ? g.members : [];
        const names = members.map((m) => (m && m.name) ? (m.number != null ? (m.number + ' ' + m.name) : m.name) : String(m && m.number));
        let line = names.join('、');
        if (line.length > 60) line = line.slice(0, 58) + '…';
        return { index: (g && g.index) || 0, size: members.length, line: line };
      });
      const modeText = sc.mode === 'size'
        ? ('按每组 ' + (sc.value == null ? '-' : sc.value) + ' 人')
        : ('按组数 ' + (sc.value == null ? '-' : sc.value));
      this.setData({
        title: groups.length ? ('分组结果 · ' + groups.length + ' 组 / ' + (sc.total != null ? sc.total + ' 人' : '-')) : '分组结果',
        modeText: groups.length ? modeText : '',
        rows: rows,
        more: Math.max(0, groups.length - 8),
        empty: !groups.length
      });
      try { this._view.setRelatedPage({ query: 'step=2' }); } catch (e) { /* ignore */ }
    }
  }
});
