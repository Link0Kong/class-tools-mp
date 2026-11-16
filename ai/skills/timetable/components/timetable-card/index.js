// ai/skills/timetable/components/timetable-card/index.js —— 课表卡片（原子组件）
// 渲染 getWeekInfo / getTimetable / getTodayCourses / getNextCourse / getCourseDetail / setTermStart 的结果。
// 约束（官方「原子组件」）：无网络/定时器/动画，点击不跳转；数据只从 structuredContent 读。
const { NotificationType } = wx.modelContext;
const RELATED_PAGE = '/pages/tt/tt';

Component({
  data: {
    title: '课表',
    sub: '',
    rows: [],
    list: [],
    foot: ''
  },

  lifetimes: {
    created() {
      this._ctx = wx.modelContext.getContext(this);
      this._view = wx.modelContext.getViewContext(this);
      // 必做：关联小程序页面（右上角入口）
      this._view.setRelatedPage({ path: RELATED_PAGE, query: '' });
      this._ctx.on(NotificationType.Result, (data) => {
        this._render(data && data.result ? data.result : data);
      });
    }
  },

  methods: {
    _render(res) {
      if (!res || res.isError) {
        this.setData({ title: '课表', sub: '', rows: [], list: [], foot: '暂时没有可展示的课表数据' });
        return;
      }
      const sc = res.structuredContent || {};
      const viewCtx = this._view;
      const q = this._queryOf(sc.pagePath);
      if (q !== this._lastQuery) {
        this._lastQuery = q;
        viewCtx.setRelatedPage({ path: RELATED_PAGE, query: q });
      }
      const view = this._normalize(sc);
      if (Array.isArray(view.list)) {
        view.list = view.list.map(function (it, i) { return Object.assign({ k: i }, it); });
      }
      this.setData(view);
    },

    _queryOf(pagePath) {
      const s = String(pagePath || '');
      const i = s.indexOf('?');
      return i >= 0 ? s.slice(i + 1) : '';
    },

    _normalize(sc) {
      // 1) 整周课表 { week, weekText, days:[{dayText,dateText,courses:[...]}] }
      if (Array.isArray(sc.days)) {
        const list = [];
        sc.days.forEach((d) => {
          (d.courses || []).forEach((c) => {
            list.push({
              main: d.dayText + ' ' + c.name,
              meta: [c.span, c.startText ? (c.startText + '-' + c.endText) : '', c.room, c.teacher]
                .filter(Boolean).join(' · '),
              stateText: c.parity && c.parity !== 'all' ? c.parityText : ''
            });
          });
        });
        return {
          title: sc.weekText || '课表',
          sub: sc.total ? ('本周 ' + sc.total + ' 节课') : '本周没有课',
          rows: [],
          list: list.slice(0, 12),
          foot: sc.total > 12 ? ('还有 ' + (sc.total - 12) + ' 节课，点右上角查看完整课表') : ''
        };
      }
      // 2) 今天课程 { date, dayText, week, courses:[{...,state,stateText}], stateText }
      if (Array.isArray(sc.courses)) {
        return {
          title: '今天 · ' + (sc.dayText || ''),
          sub: [sc.date, sc.week ? ('第 ' + sc.week + ' 周') : ''].filter(Boolean).join(' · '),
          rows: [],
          list: sc.courses.slice(0, 12).map((c) => ({
            main: c.name,
            meta: [c.span, c.startText ? (c.startText + '-' + c.endText) : '', c.room, c.teacher]
              .filter(Boolean).join(' · '),
            stateText: c.stateText || ''
          })),
          foot: sc.stateText || ''
        };
      }
      // 3) 下一节课 { found, name, dayText, dateText, span, startText, endText, room, teacher, leftText }
      if (typeof sc.found === 'boolean') {
        if (!sc.found) return { title: '下一节课', sub: '', rows: [], list: [], foot: '近期没有排课' };
        return {
          title: '下一节 · ' + (sc.name || ''),
          sub: [sc.dayText, sc.dateText].filter(Boolean).join(' '),
          rows: [
            { label: '节次', value: [sc.span, sc.startText ? (sc.startText + '-' + sc.endText) : ''].filter(Boolean).join(' ') },
            { label: '教室', value: sc.room || '—' },
            { label: '老师', value: sc.teacher || '—' }
          ],
          list: [],
          foot: sc.leftText || ''
        };
      }
      // 4) 课程详情 { name, teacher, room, weeks, parityText, dayText, span, nextDates[] }
      if (Array.isArray(sc.nextDates) && sc.name) {
        const rows = [
          { label: '老师', value: sc.teacher || '—' },
          { label: '教室', value: sc.room || '—' },
          { label: '时间', value: [sc.dayText, sc.span].filter(Boolean).join(' ') || '—' },
          { label: '周次', value: [sc.weeks, sc.parityText].filter(Boolean).join(' · ') || '—' }
        ];
        return {
          title: sc.name,
          sub: '',
          rows: rows,
          list: sc.nextDates.slice(0, 5).map((d) => ({ main: d, meta: '', stateText: '' })),
          foot: sc.nextDates.length ? '' : '接下来没有该课程'
        };
      }
      // 5) 周次信息 { termStart, currentWeek, totalWeeks, weekText }
      if (sc.currentWeek !== undefined || sc.termStart !== undefined) {
        return {
          title: sc.weekText || '教学周',
          sub: sc.todayText || '',
          rows: [
            { label: '开学日期', value: sc.termStart || '未设置' },
            { label: '当前周', value: sc.currentWeek ? ('第 ' + sc.currentWeek + ' 周') : '未开学' },
            { label: '总周数', value: sc.totalWeeks ? (sc.totalWeeks + ' 周') : '—' }
          ],
          list: [],
          foot: sc.hasTimetable ? '' : '课表还没同步'
        };
      }
      return { title: '课表', sub: '', rows: [], list: [], foot: '' };
    }
  }
});
