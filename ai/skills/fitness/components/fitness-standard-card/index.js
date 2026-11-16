// ai/skills/fitness/components/fitness-standard-card/index.js —— 国标评分表卡片
Component({
  data: {
    title: '国标评分表',
    sub: '',
    rows: [],
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
      const items = Array.isArray(sc.items) ? sc.items : [];
      const rows = items.slice(0, 6).map((it) => {
        const r = Array.isArray(it.rows) ? it.rows : [];
        const at = (score) => {
          const hit = r.filter((x) => x.score === score)[0];
          return hit ? String(hit.value) : '—';
        };
        return {
          label: it.label || '',
          unit: it.unit || '',
          full: at(100),
          pass: at(60)
        };
      });
      const sexText = sc.sexText || (sc.sex === 'f' ? '女' : '男');
      const gradeText = sc.gradeText || (sc.grade === '34' ? '大三大四' : '大一大二');
      this.setData({
        title: '国标评分表 · ' + sexText + ' · ' + gradeText,
        sub: items.length + ' 项（满分 100 / 及格 60 分标准）',
        rows: rows,
        empty: !items.length
      });
      const q = 'sex=' + (sc.sex === 'f' ? 'f' : 'm') + '&grade=' + (sc.grade === '34' ? '34' : '12');
      try { this._view.setRelatedPage({ query: q }); } catch (e) { /* ignore */ }
    }
  }
});
