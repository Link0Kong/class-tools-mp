// ai/skills/fitness/components/fitness-card/index.js —— 体测算分 / 单条记录 / 历史列表卡片
Component({
  data: {
    mode: 'score',
    title: '体测成绩',
    sub: '',
    total: '',
    level: '',
    bmi: '',
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
      const pageQ = (q) => { try { this._view.setRelatedPage({ query: q }); } catch (e) { /* ignore */ } };

      // 单条记录详情：sc.record.score
      if (sc.record && sc.record.score) {
        const rt = sc.record;
        const s = rt.score || {};
        const rows = (s.items || []).map((it) => ({
          label: it.label,
          value: String(it.value == null ? '—' : it.value),
          score: it.score == null ? '—' : (String(it.score) + (it.bonus ? ('+' + it.bonus) : ''))
        }));
        this.setData({
          mode: 'score',
          title: (rt.name || '体测记录') + ' · ' + (rt.dateText || ''),
          sub: (rt.sexText || '') + ' · ' + (rt.gradeText || ''),
          total: s.totalText || (s.total == null ? '—' : String(s.total)),
          level: s.level || '',
          bmi: s.bmiText ? ('BMI ' + s.bmiText) : '',
          rows: rows,
          empty: false
        });
        pageQ('recordId=' + encodeURIComponent(String(rt.recordId || '')));
        return;
      }

      // 历史列表：items[].recordId
      if (Array.isArray(sc.items) && sc.items.length && sc.items[0] && sc.items[0].recordId) {
        const rows = sc.items.slice(0, 2).map((it) => ({
          label: (it.name || '体测') + '  ' + (it.dateText || ''),
          value: it.total == null ? '—' : String(it.total),
          score: it.level || ''
        }));
        this.setData({
          mode: 'history',
          title: '体测历史 · ' + sc.items.length + ' 条',
          sub: '本机最多保留最近 2 条',
          total: '', level: '', bmi: '',
          rows: rows,
          empty: false
        });
        pageQ('');
        return;
      }

      // 算分结果 / 刚保存的记录
      if (sc.level != null && sc.total != null) {
        const rows = (sc.items || []).map((it) => ({
          label: it.label,
          value: String(it.value == null ? '—' : it.value),
          score: it.score == null ? '—' : (String(it.score) + (it.bonus ? ('+' + it.bonus) : ''))
        }));
        this.setData({
          mode: 'score',
          title: sc.name ? ('已保存 · ' + sc.name) : '体测成绩',
          sub: (sc.sex === 'f' ? '女' : (sc.sex === 'm' ? '男' : '')) + (sc.grade ? (' · ' + (sc.grade === '34' ? '大三大四' : '大一大二')) : ''),
          total: sc.totalText || (sc.total == null ? '—' : String(sc.total)),
          level: sc.level || '',
          bmi: sc.bmiText ? ('BMI ' + sc.bmiText) : '',
          rows: rows,
          empty: false
        });
        pageQ(sc.recordId ? ('recordId=' + encodeURIComponent(String(sc.recordId))) : '');
        return;
      }

      this.setData({ mode: 'score', title: '体测成绩', sub: '', total: '', level: '', bmi: '', rows: [], empty: true });
      pageQ('');
    }
  }
});
