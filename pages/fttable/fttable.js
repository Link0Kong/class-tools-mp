// pages/fttable/fttable.js —— 大学生体测国标评分表（需求 14：男女/年级与体测页、云端 userdata 同步）
const store = require('../../utils/store.js');
const fit = require('../../utils/fit.js');
const identity = require('../../utils/identity.js');
const util = require('../../utils/util.js');
const share = require('../../utils/share.js');
const agent = require('../../utils/agent.js');
const scrollmem = require('../../utils/scrollmem.js');
const sharecard = require('../../utils/sharecard.js');
const shareflow = require('../../utils/shareflow.js');

const ITEMS = [
  { key: 'vc', n: '肺活量', u: 'mL' },
  { key: 'r50', n: '50 米跑', u: '秒' },
  { key: 'sit', n: '坐位体前屈', u: 'cm' },
  { key: 'jump', n: '立定跳远', u: 'cm' },
  { key: 'pull', n: '引体 / 仰卧', u: '次' },
  { key: 'dur', n: '1000 / 800 米', u: '分·秒' }
];

// 归一：sex 只认 m/f，grade 只认 12/34（与体测主页 / userdata fit section 同一契约）
function normSex(v) { return v === 'f' ? 'f' : 'm'; }
function normGr(v) { return v === '34' ? '34' : '12'; }
function fitOfStore() {
  let f = {};
  try { f = store.get().fit || {}; } catch (e) { f = {}; }
  return { sex: normSex(f.sex), grade: normGr(f.grade) };
}

Page(shareflow.install({
  data: { sex: 'm', grade: '12', scores: fit.FTS, rows: [], focus: '', smLeft: 0 },
  onLoad(options) {
    scrollmem.attach(this);
    options = options || {};
    this._agent = agent.pick(this);            // AI 页面接力（wx.onAgentHandoff），只消费一次
    this._agentQ = agent.pickQuery(options);   // 备用：handoff query 随页面参数传入
    // 需求 2：内部横向 scroll-view 重进时恢复上次横向位置（只恢复一次）
    const sv = scrollmem.svGet(this, 'fttable');
    if (sv && sv.left > 0) this.setData({ smLeft: sv.left });
    // 需求 14：初始男女/年级取自 store.fit（体测主页 / 云端 userdata 的同一份值），不再固定 m/12
    this.setData(fitOfStore());
    this.build();
    this.applyAgentHandoff();
  },
  onShow() {
    share.enable();
    if (!identity.ensure()) return;
    scrollmem.restore(this);
    // 需求 14：从体测主页/云端同步回来后再进本页，显示最新男女/年级
    try {
      const f = fitOfStore();
      if (f.sex !== this.data.sex || f.grade !== this.data.grade) {
        this.setData(f, () => this.build());
      }
    } catch (e) { /* 读取失败保留当前表格 */ }
  },
  // 内部横向 scroll-view 位置记录（只写内存，不 setData）
  onGridScroll(e) { scrollmem.svSave(this, 'fttable', e && e.detail); },

  // —— AI 页面接力：按 sex/grade 切换评分表，按 item 定位到对应项目行（只高亮/滚动，不阻塞）——
  applyAgentHandoff() {
    if (this._agentApplied) return false;
    this._agentApplied = true;
    const h = this._agent;
    const p = (h && h.payload) || {};
    const q = Object.assign({}, this._agentQ || {}, (h && h.query) || {});
    if (!h && !this._agentQ) return false;
    const sex = String(q.sex || p.sex || '');
    const grade = String(q.grade || p.grade || p.gr || '');
    const item = String(q.item || p.item || '');
    const next = {};
    if (sex === 'm' || sex === 'f') next.sex = sex;
    if (grade === '12' || grade === '34') next.grade = grade;
    if (Object.keys(next).length) {
      // 接力改参数也要落 store（否则体测页/云端仍是旧值）
      this._persist(next);
      this.setData(next, () => this.build());
    }
    if (item) {
      this.setData({ focus: item });
      setTimeout(() => this.scrollToItem(item), 80);
    }
    return true;
  },
  // 需求 14：把本页选择的男女/年级写回 store.fit（体测主页共用同一份输入）并 store.save()
  // → store.save 内部触发 cloud.udTouch，userdata v6 的 fit section（web UD_FIT_KEYS 含 sex/grade）随之同步。
  _persist(next) {
    try {
      const d = store.get();
      d.fit = Object.assign({}, d.fit || {});
      if (next && (next.sex === 'm' || next.sex === 'f')) d.fit.sex = next.sex;
      if (next && (next.grade === '12' || next.grade === '34')) d.fit.grade = next.grade;
      store.save();
    } catch (e) { /* 落盘失败不影响当前表格显示 */ }
  },
  setSex(e) {
    const v = normSex(e.currentTarget.dataset.v);
    if (v === this.data.sex) return;
    this._persist({ sex: v });
    this.setData({ sex: v, focus: '' }, () => this.build());
  },
  setGr(e) {
    const v = normGr(e.currentTarget.dataset.v);
    if (v === this.data.grade) return;
    this._persist({ grade: v });
    this.setData({ grade: v, focus: '' }, () => this.build());
  },
  build() {
    const sex = this.data.sex === 'f' ? 'f' : 'm';
    const gr = this.data.grade === '34' ? '34' : '12';
    const rows = ITEMS.map((it) => {
      let tab, n = it.n, u = it.u;
      if (it.key === 'pull') {
        tab = sex === 'f' ? fit.FTB.sup : fit.FTB.pull;
        n = sex === 'f' ? '1 分钟仰卧起坐' : '引体向上';
      } else if (it.key === 'dur') {
        tab = fit.FTB.dur;
        n = sex === 'f' ? '800 米跑' : '1000 米跑';
      } else {
        tab = fit.FTB[it.key];
      }
      const col = fit.ftCol(sex, gr);
      const vals = (tab[col] || []).map((v) => (it.key === 'dur' ? fit.ftMS(v) : String(v)));
      return { key: it.key, n: n, u: u, vals: vals };
    });
    this.setData({ rows: rows });
  },
  _shareOpenOpts() {
    return {
      title: '国标体测评分表 · ' + (this.data.sex === 'f' ? '女' : '男') + ' · ' + (this.data.grade === '34' ? '大三/大四' : '大一/大二'),
      view: sharecard.buildFttableView({
        sex: this.data.sex, grade: this.data.grade, rows: this.data.rows, time: util.timeStr()
      })
    };
  },
  openShare() { shareflow.open(this, this._shareOpenOpts()); },
  closeShare() { shareflow.close(this); },
  shareImage() { shareflow.shareImage(this); },
  onPageScroll(e) { scrollmem.onScroll(this, e); },
  onHide() { scrollmem.save(this); },
  onUnload() { scrollmem.save(this); },
  onShareAppMessage() {
    return share.message({
      title: '大学体测国标评分表 · ' + (this.data.sex === 'f' ? '女' : '男') + ' · ' + (this.data.grade === '34' ? '大三/大四' : '大一/大二'),
      path: '/pages/fttable/fttable',
      imageUrl: this.data.shareImg || sharecard.FALLBACK.fttable
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '大学体测国标评分表',
      imageUrl: this.data.shareImg || sharecard.FALLBACK.fttable
    });
  }
}));
