// components/roster-picker —— 班级名单选择器（v15 / 1.4.2；2026-11-11 需求 8 新增快捷预设）
// 名单只有 class_members 一个来源（store.classMembers，70 人，座号升序）；不可自定义 / 粘贴。
// 搜索和范围只影响展示，快捷预设替换选中座号，也可逐人增删。
// 用法：
//   <roster-picker show="{{picker}}" title="参与名单" selected="{{rosterSel}}"
//                  bind:confirm="onRosterConfirm" bind:close="closePicker" />
const roster = require('../../utils/roster.js');
const cloud = require('../../utils/cloud.js');
const util = require('../../utils/util.js');

Component({
  options: { multipleSlots: true, styleIsolation: 'apply-shared' },
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '选择名单' },
    selected: { type: Array, value: [] }
  },
  data: {
    loading: false, failed: false, leagueBusy: false,
    items: [], selMap: {}, count: 0, total: 0, query: '', scope: 'all',
    quick: ''                                     // 当前生效的快捷预设：'' | all | committee | league
  },
  observers: {
    show(v) { if (v) this.openPicker(); else this._request = (this._request || 0) + 1; }
  },
  lifetimes: {
    attached() { if (this.data.show) this.openPicker(); }
  },
  methods: {
    // 打开：从本机 classMembers 读名单；为空则静默重拉一次（离线时给「重新加载」）
    openPicker() {
      const request = this._request = (this._request || 0) + 1;
      this._matchedSeats = [];
      this.setData({ query: '', scope: 'all', leagueBusy: false });
      const list = roster.members();
      if (list.length) { this.build(list); return; }
      this.setData({ loading: true, failed: false });
      cloud.classMembersPull().then(() => {
        if (request !== this._request) return;
        const l = roster.members();
        if (l.length) this.build(l);
        else this.setData({ loading: false, failed: true, items: [], selMap: {}, count: 0, total: 0 });
      }).catch(() => {
        if (request !== this._request) return;
        this.setData({ loading: false, failed: true, items: [], selMap: {}, count: 0, total: 0 });
      });
    },
    // 先恢复整份选择，再独立筛选要展示的成员。
    build(list) {
      const set = {};
      list.forEach(function (m) { set[m.seat] = true; });
      const selMap = {};
      let count = 0;
      roster.normSeats(this.data.selected).forEach(function (s) {
        if (set[s]) { selMap[s] = true; count += 1; }
      });
      this._members = list;
      this.setData({ loading: false, failed: false, selMap: selMap, count: count, total: list.length, quick: '' });
      this.filterItems();
    },
    filterItems() {
      const rows = roster.filterMembers(this._members || [], this.data.scope, this.data.query, undefined, this._matchedSeats);
      this.setData({ items: rows.map(function (m) {
        return { seat: m.seat, name: m.name, role: m.role || m.badge || '', key: 'k' + m.seat };
      }) });
    },
    setQuery(e) {
      this._matchedSeats = e.detail.seats || [];
      this.setData({ query: e.detail.value });
      this.filterItems();
    },
    setScope(e) {
      const scope = e.detail.value;
      this.setData({ scope: scope });
      this.filterItems();
      if (scope === 'league') cloud.leaguePull().then(() => this.filterItems());
    },
    // 套用基础集合（只替换选中集合，之后仍可逐个增删）
    applySeats(seats, quick) {
      this._selection = (this._selection || 0) + 1;
      const known = {};
      (this._members || []).forEach(function (it) { known[it.seat] = true; });
      const selMap = {};
      let count = 0;
      roster.normSeats(seats).forEach(function (s) {
        if (known[s]) { selMap[s] = true; count += 1; }
      });
      this.setData({ selMap: selMap, count: count, quick: quick || '' });
      return count;
    },
    quickAll() {
      const n = this.applySeats(roster.quickSeats('all'), 'all');
      if (!n) util.toast('班级名单未同步');
    },
    quickCommittee() {
      const n = this.applySeats(roster.quickSeats('committee'), 'committee');
      if (!n) util.toast('班委名单为空');
    },
    quickLeague() {
      if (this.data.leagueBusy) return;
      const cached = roster.quickSeats('league');
      if (cached.length) { this.applySeats(cached, 'league'); return; }
      this.setData({ leagueBusy: true });
      const request = this._request;
      const selection = this._selection;
      cloud.leaguePull().then((list) => {
        if (request !== this._request) return;
        this.setData({ leagueBusy: false });
        if (selection !== this._selection) return;
        const seats = roster.quickSeats('league');
        if (seats.length) this.applySeats(seats, 'league');
        else util.toast(list && list.length ? '团员名单为空' : '暂无可选团员');
      }).catch(() => {
        this.setData({ leagueBusy: false });
        util.toast('团员名单暂不可用');
      });
    },
    quickNone() { this.applySeats([], ''); },
    toggleSeat(e) {
      const seat = Number(e.currentTarget.dataset.seat);
      if (!seat) return;
      this._selection = (this._selection || 0) + 1;
      const on = !this.data.selMap[seat];
      const o = {};
      o['selMap.' + seat] = on;
      o.count = Math.max(0, this.data.count + (on ? 1 : -1));
      o.quick = '';                                 // 手动增删后不再高亮快捷预设
      this.setData(o);
    },
    retry() { this.openPicker(); },
    cancel() { this.triggerEvent('close'); },
    confirm() {
      const map = this.data.selMap;
      const seats = Object.keys(map).filter(function (k) { return map[k]; }).map(Number)
        .filter(function (n) { return isFinite(n); }).sort(function (a, b) { return a - b; });
      this.triggerEvent('confirm', { seats: seats });
    }
  }
});
