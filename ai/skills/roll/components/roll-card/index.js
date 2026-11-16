// ai/skills/roll/components/roll-card/index.js —— 点名卡片（原子组件）
// 渲染 getRollRoster / setRollRoster / markRollStatus / markAllRoll / resetRoll / getRollSummary / useDrawRoster 的结果。
// 约束（官方「原子组件」）：无网络/定时器/动画，点击不跳转；数据只从 structuredContent 读。
const { NotificationType } = wx.modelContext;
const RELATED_PAGE = '/pages/roll/roll';

Component({
  data: {
    title: '点名',
    sub: '',
    present: 0,
    absent: 0,
    unmarked: 0,
    total: 0,
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
        this.setData({ title: '点名', sub: '', present: 0, absent: 0, unmarked: 0, total: 0, list: [], foot: '点名状态暂时没有同步' });
        return;
      }
      const view = this._normalize(res.structuredContent || {});
      if (Array.isArray(view.list)) {
        view.list = view.list.map(function (it, i) { return Object.assign({ k: i }, it); });
      }
      this.setData(view);
    },

    _normalize(sc) {
      const c = sc.counts || {};
      const present = Number(c.present) || 0;
      const absent = Number(c.absent) || 0;
      const unmarked = Number(c.unmarked) || 0;
      const total = Number(c.total) || Number(sc.total) || Number(sc.count) || 0;
      const list = [];

      if (Array.isArray(sc.items)) {
        sc.items.forEach((it) => {
          list.push({ main: it.seat + ' ' + it.name, stateText: it.statusText || '', cls: it.status || '' });
        });
      } else if (Array.isArray(sc.seats)) {
        sc.seats.forEach((s) => {
          list.push({ main: s.seat + ' ' + s.name, stateText: '', cls: '' });
        });
      } else if (sc.seat) {
        list.push({ main: sc.seat + ' 号' + (sc.name ? ' ' + sc.name : '') + ' · ' + (sc.statusText || ''), stateText: '', cls: '' });
      }

      let title = '点名名单';
      let sub = total ? ('共 ' + total + ' 人') : '还没有名单';
      if (Array.isArray(sc.items)) title = '点名结果';
      else if (sc.seat) title = '已标记';
      else if (sc.ok && Array.isArray(sc.seats)) title = '名单已更新';
      else if (sc.ok) title = '点名已更新';

      let foot = '';
      if (!total) foot = '点右上角打开点名页设置名单';
      else if (!unmarked && Array.isArray(sc.items)) foot = '所有人都已标记';
      else foot = '到 / 假 / 未点 实时显示';

      return { title: title, sub: sub, present: present, absent: absent, unmarked: unmarked, total: total, list: list.slice(0, 12), foot: foot };
    }
  }
});
