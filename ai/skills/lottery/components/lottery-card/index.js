// ai/skills/lottery/components/lottery-card/index.js —— 抽签结果 / 抽签+分组摘要卡片
Component({
  data: {
    kind: 'draw',
    title: '抽签结果',
    cfgRows: [],
    rows: [],
    more: 0,
    removedText: '',
    textLines: [],
    empty: false
  },
  lifetimes: {
    created() {
      try {
        this._ctx = wx.modelContext.getContext(this);
        this._view = wx.modelContext.getViewContext(this);
        this._view.setRelatedPage({ query: '' });
        const NT = wx.modelContext.NotificationType;
        this._ctx.on(NT.Result, (data) => this._render(data));
      } catch (e) { /* 卡片环境异常时保持初始态 */ }
    }
  },
  methods: {
    _render(data) {
      const res = (data && data.result) || {};
      const sc = res.structuredContent || (data && data.structuredContent) || {};
      // 摘要模式：有 text 且没有 items
      if (sc.text && !sc.items) {
        const lines = String(sc.text).split('\n').filter((s) => !!s).slice(0, 16);
        this.setData({ kind: 'summary', title: '抽签 · 分组摘要', cfgRows: [], rows: [], more: 0, removedText: '', textLines: lines, empty: false });
        try { this._view.setRelatedPage({ query: '' }); } catch (e) { /* ignore */ }
        return;
      }
      const items = Array.isArray(sc.items) ? sc.items : [];
      const cfg = sc.cfg || {};
      const cfgRows = [];
      if (cfg.range) cfgRows.push({ k: '范围', v: cfg.range });
      if (cfg.count) cfgRows.push({ k: '个数', v: cfg.count });
      if (cfg.dup) cfgRows.push({ k: '允许重复', v: cfg.dup });
      if (cfg.excl) cfgRows.push({ k: '排除', v: cfg.excl });
      if (cfg.sort) cfgRows.push({ k: '排序', v: cfg.sort });
      const rows = items.slice(0, 20).map((it) => it && it.name ? (it.number + ' ' + it.name) : String(it && it.number));
      const removed = Array.isArray(sc.removed) ? sc.removed : [];
      const poolSize = typeof sc.poolSize === 'number' ? sc.poolSize : null;
      this.setData({
        kind: 'draw',
        title: items.length ? ('抽签结果 · ' + items.length + ' 个' + (poolSize != null ? ('（池 ' + poolSize + '）') : '')) : '抽签结果',
        cfgRows: cfgRows,
        rows: rows,
        more: Math.max(0, items.length - 20),
        removedText: removed.length ? removed.join('、') : '',
        textLines: [],
        empty: !items.length
      });
      try { this._view.setRelatedPage({ query: '' }); } catch (e) { /* ignore */ }
    }
  }
});
