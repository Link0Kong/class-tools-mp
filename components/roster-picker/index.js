// components/roster-picker —— 班级名单选择器（v15 / 1.4.2；2026-11-11 需求 8 新增快捷预设）
// 名单只有 class_members 一个来源（store.classMembers，70 人，座号升序）；不可自定义 / 粘贴。
// 点气泡逐个切换，支持「全班 / 班委 / 团员 / 清空」快捷预设 +「确定」；打开时用传入的 selected（座号数组）做初始选择。
// 快捷预设语义（需求 8）：点击先套基础集合（全班 = 全部成员；班委 = role/badge 非空；团员 = class_league 缓存），
//   **之后仍可逐个点气泡增删**；座号数组数据格式不变（confirm detail = { seats:[座号升序] }）。
// 视觉：M3 简约 selected chip（未选 = surface-container-lowest 底 + outline-variant 边；
//       已选 = primary-container 底 + primary 边 + on-primary-container 字），无浮动 / 弹跳动画。
// 用法：
//   <roster-picker show="{{picker}}" title="参与名单" selected="{{rosterSel}}"
//                  bind:confirm="onRosterConfirm" bind:close="closePicker" />
const store = require('../../utils/store.js');
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
    items: [], selMap: {}, count: 0, total: 0,
    quick: ''                                     // 当前生效的快捷预设：'' | all | committee | league
  },
  observers: {
    show(v) { if (v) this.openPicker(); }
  },
  lifetimes: {
    attached() { if (this.data.show) this.openPicker(); }
  },
  methods: {
    // 打开：从本机 classMembers 读名单；为空则静默重拉一次（离线时给「重新加载」）
    openPicker() {
      const list = roster.members();
      if (list.length) { this.build(list); return; }
      this.setData({ loading: true, failed: false });
      cloud.classMembersPull().then(() => {
        const l = roster.members();
        if (l.length) this.build(l);
        else this.setData({ loading: false, failed: true, items: [], selMap: {}, count: 0, total: 0 });
      }).catch(() => {
        this.setData({ loading: false, failed: true, items: [], selMap: {}, count: 0, total: 0 });
      });
    },
    // 一次性渲染名单（之后只 setData 单个气泡的选中路径，不重复下发整份成员）
    build(list) {
      const set = {};
      list.forEach(function (m) { set[m.seat] = true; });
      const selMap = {};
      let count = 0;
      roster.normSeats(this.data.selected).forEach(function (s) {
        if (set[s]) { selMap[s] = true; count += 1; }
      });
      const items = list.map(function (m) {
        return { seat: m.seat, name: m.name, key: 'k' + m.seat };
      });
      this.setData({ loading: false, failed: false, items: items, selMap: selMap, count: count, total: list.length, quick: '' });
    },
    // 套用基础集合（只替换选中集合，之后仍可逐个增删）
    applySeats(seats, quick) {
      const known = {};
      this.data.items.forEach(function (it) { known[it.seat] = true; });
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
      cloud.leaguePull().then((list) => {
        this.setData({ leagueBusy: false });
        const n = this.applySeats(roster.quickSeats('league'), 'league');
        if (!n) util.toast(list && list.length ? '团员名单为空' : '团员名单暂不可用（离线时先在班级名单页同步）');
      }).catch(() => {
        this.setData({ leagueBusy: false });
        util.toast('团员名单暂不可用');
      });
    },
    quickNone() { this.applySeats([], ''); },
    toggleSeat(e) {
      const seat = Number(e.currentTarget.dataset.seat);
      if (!seat) return;
      const on = !this.data.selMap[seat];
      const o = {};
      o['selMap.' + seat] = on;
      o.count = Math.max(0, this.data.count + (on ? 1 : -1));
      o.quick = '';                                 // 手动增删后不再高亮快捷预设
      this.setData(o);
    },
    selectAll() {
      const map = {};
      this.data.items.forEach(function (it) { map[it.seat] = true; });
      this.setData({ selMap: map, count: this.data.items.length, quick: 'all' });
    },
    clearAll() { this.setData({ selMap: {}, count: 0, quick: '' }); },
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
