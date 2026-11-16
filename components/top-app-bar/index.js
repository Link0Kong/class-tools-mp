// components/top-app-bar —— M3 顶栏（大标题，可随滚动收缩为小标题）
// 用法：<top-app-bar title="班级工具" subtitle="三步走" collapsed="{{scrolled}}" />
// 页面里加 onPageScroll(e){ this.setData({ scrolled: e.scrollTop > 40 }); }
Component({
  options: { multipleSlots: true, styleIsolation: 'apply-shared' },
  properties: {
    title: { type: String, value: '' },
    subtitle: { type: String, value: '' },
    collapsed: { type: Boolean, value: false }
  }
});
