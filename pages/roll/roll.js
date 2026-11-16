// pages/roll/roll.js —— 点名
// 1.3.4 名单改造：名单只来自班级名单（class_members），按座号选择；不再支持自定义 / 粘贴 / 导入。
//   - 「选择名单」：弹出班级名单液态气泡选择器，选完按座号升序排列；
//   - 「沿用抽签名单」：直接使用抽签页已选参与名单（为空时提示）；
//   - 选择变化时 到/假 状态按姓名保留（roster.rollSet 重排下标，同一个人状态不丢）；
//   - 渲染仍用派生 store.rollNames（"座号 姓名"），parseNames 去掉座号后与 rollSt 下标一一对应。
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');
const identity = require('../../utils/identity.js');
const share = require('../../utils/share.js');
const roster = require('../../utils/roster.js');
const agent = require('../../utils/agent.js');
const scrollmem = require('../../utils/scrollmem.js');

function parseNames(txt) {
  const out = [];
  String(txt == null ? '' : txt).split(/\r?\n/).forEach(function (line) {
    let s = line.trim(); if (!s) return;
    const m = s.match(/^\d+\s*[.,、:：\-]?\s*(.+)$/);
    const n = (m ? m[1] : s).trim();
    if (n) out.push(n);
  });
  return out;
}

Page({
  data: {
    list: [], sum: { inN: 0, abN: 0, un: 0 },
    namesCount: 0, selCount: 0, rollSel: [], picker: false
  },

  onLoad(options) {
    scrollmem.attach(this);
    options = options || {};
    this._agent = agent.pick(this);            // AI 页面接力（wx.onAgentHandoff），只消费一次
    this._agentQ = agent.pickQuery(options);   // 备用：handoff query 随页面参数传入
  },
  onShow() {
    share.enable();
    scrollmem.restore(this);
    if (!identity.ensure()) return;
    try { store.reload(); } catch (e) { /* ignore */ }
    try { roster.migrate(); } catch (e) { /* ignore */ }
    this.applyAgentHandoff();
    this.render();
  },
  // 云端 userdata 应用后重绘：名单 / 到·假记录可能来自另一端（契约 §5.4）
  onCloudSync() {
    try { store.reload(); } catch (e) { /* ignore */ }
    this.render();
  },

  // —— AI 页面接力：应用 payload 里的名单 / 到·假状态（先渲染），随后 render 重绘 ——
  applyAgentHandoff() {
    if (this._agentApplied) return false;
    this._agentApplied = true;
    const h = this._agent;
    const p = (h && h.payload) || {};
    const q = Object.assign({}, this._agentQ || {}, (h && h.query) || {});
    if (!h && !this._agentQ) return false;
    const items = Array.isArray(p.items) ? p.items.filter(function (x) { return x && x.seat; }) : null;
    try {
      if (items && items.length) {
        // items 来自 markRollStatus / getRollSummary：按座号写名单 + 到/假状态（与页面点按同构）
        const list = items.slice().sort(function (a, b) { return (+a.seat) - (+b.seat); });
        const d = store.get();
        d.rollSel = list.map(function (x) { return +x.seat; });
        d.rollNames = list.map(function (x) { return String(x.seat) + ' ' + String(x.name || ''); }).join('\n');
        const st = {};
        list.forEach(function (x, i) {
          const s = String(x.status || '');
          if (s === 'present' || s === 'in' || s === '到') st[i] = 'in';
          else if (s === 'absent' || s === 'ab' || s === '假') st[i] = 'ab';
        });
        d.rollSt = st;
        store.save();
      } else if (Array.isArray(p.seats) && p.seats.length) {
        roster.rollSet(p.seats);          // 只应用名单；到/假状态按姓名保留
      }
    } catch (e) { /* payload 应用失败保留本机数据 */ }
    return true;
  },
  render() {
    const d = store.get();
    const raw = parseNames(d.rollNames);
    const seats = roster.selOf('roll');
    const st = d.rollSt || {};
    let inN = 0, abN = 0;
    const list = raw.map(function (nm, i) {
      const s = st[i] || '';
      if (s === 'in') inN++; else if (s === 'ab') abN++;
      return { i: i, nm: nm, seat: seats[i] || 0, s: s };
    });
    list.sort(function (a, b) { const sa = a.s ? 1 : 0, sb = b.s ? 1 : 0; return sa !== sb ? sa - sb : a.i - b.i; });
    this.setData({
      list: list,
      namesCount: seats.length,
      selCount: seats.length,
      rollSel: seats,
      sum: { inN: inN, abN: abN, un: raw.length - inN - abN }
    });
  },

  // —— 名单（只来自班级名单 class_members，按座号选择）——
  openPicker() { this.setData({ picker: true }); },
  closePicker() { this.setData({ picker: false }); },
  onRosterConfirm(e) {
    const seats = (e.detail && e.detail.seats) || [];
    roster.rollSet(seats);
    this.setData({ picker: false });
    this.render();
    util.toast(seats.length ? ('名单已更新 · ' + seats.length + ' 人') : '已清空名单');
  },
  // 沿用抽签名单 = 抽签页「参与名单」的已选座号
  useDraw() {
    const seats = roster.selOf('draw');
    if (!seats.length) { util.toast('抽签页还没有选择名单'); return; }
    roster.rollSet(seats);
    this.render();
    util.toast('已沿用抽签名单 · ' + seats.length + ' 人');
  },

  toggle(e) {
    const i = +e.currentTarget.dataset.i;
    const v = e.currentTarget.dataset.v;
    const d = store.get();
    d.rollSt = d.rollSt || {};
    if (d.rollSt[i] === v) delete d.rollSt[i]; else d.rollSt[i] = v;
    store.save(); this.render();
  },
  reset() {
    wx.showModal({
      title: '重置本轮点名', content: '清空本轮到/假记录？（名单保留）', confirmText: '重置', confirmColor: '#A2543E',
      success: (r) => { if (!r.confirm) return; const d = store.get(); d.rollSt = {}; store.save(); this.render(); util.toast('已重置本轮'); }
    });
  },

  onPageScroll(e) { scrollmem.onScroll(this, e); },
  onHide() { scrollmem.save(this); },
  onUnload() { scrollmem.save(this); },
  onShareAppMessage() {
    return share.message({
      title: '班级点名｜到 / 假 / 沉底',
      path: '/pages/roll/roll',
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '班级点名｜到 / 假 / 沉底',
      imageUrl: '/images/share/default.png'
    });
  }
});
