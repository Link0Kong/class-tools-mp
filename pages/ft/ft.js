// pages/ft/ft.js —— 大学生体测计算器（国标）
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');
const fit = require('../../utils/fit.js');
const canvas = require('../../utils/canvas.js');
const cloud = require('../../utils/cloud.js');
const identity = require('../../utils/identity.js');
const share = require('../../utils/share.js');
const agent = require('../../utils/agent.js');
const scrollmem = require('../../utils/scrollmem.js');

const SEX = [{ v: 'm', n: '男' }, { v: 'f', n: '女' }];
const GR = [{ v: '12', n: '大一 / 大二' }, { v: '34', n: '大三 / 大四' }];
const FIELDS = [
  { k: 'h', n: '身高', u: 'cm', ph: '', type: 'digit', dec: 1 },
  { k: 'w', n: '体重', u: 'kg', ph: '', type: 'digit', dec: 1 },
  { k: 'vc', n: '肺活量', u: 'mL', ph: '', type: 'number', dec: 0 },
  { k: 'r50', n: '50 米跑', u: '秒', ph: '', type: 'digit', dec: 2 },
  { k: 'sit', n: '坐位体前屈', u: 'cm', ph: '', type: 'text', dec: 1, neg: true },
  { k: 'jump', n: '立定跳远', u: 'cm', ph: '', type: 'number', dec: 0 },
  { k: 'pull', n: '引体 / 仰卧起坐', u: '次', ph: '', type: 'number', dec: 0 }
];
const DUR_FIELDS = ['durM', 'durS'];
function blankForm() {
  return { h: '', w: '', vc: '', r50: '', sit: '', jump: '', pull: '', durM: '', durS: '' };
}
function cleanNumber(v, dec, allowNeg) {
  v = String(v == null ? '' : v).replace(/[^\d.\-]/g, '');
  if (!allowNeg) v = v.replace(/-/g, '');
  else {
    const neg = v.charAt(0) === '-';
    v = v.replace(/-/g, '');
    if (neg) v = '-' + v;
  }
  const dot = v.indexOf('.');
  if (dot >= 0) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
  if (dec === 0) v = v.replace(/\..*$/, '');
  else if (dot >= 0) v = v.split('.')[0] + '.' + v.split('.')[1].slice(0, dec);
  return v;
}
function cleanInt(v) {
  return String(v == null ? '' : v).replace(/[^\d]/g, '');
}
function recDate(ts) {
  const d = new Date(ts || 0);
  return util.pad(d.getMonth() + 1) + '-' + util.pad(d.getDate()) + ' ' + util.pad(d.getHours()) + ':' + util.pad(d.getMinutes());
}
function recDetail(f) {
  f = f || {};
  const p = [];
  if (f.h) p.push('身高 ' + f.h + 'cm');
  if (f.w) p.push('体重 ' + f.w + 'kg');
  if (f.vc) p.push('肺活量 ' + f.vc + 'mL');
  if (f.r50) p.push('50米 ' + f.r50 + 's');
  if (f.sit) p.push('坐位 ' + f.sit + 'cm');
  if (f.jump) p.push('跳远 ' + f.jump + 'cm');
  if (f.pull) p.push((f.sex === 'f' ? '仰卧 ' : '引体 ') + f.pull + '次');
  if (f.durM || f.durS) p.push('长跑 ' + (f.durM || '0') + "'" + util.pad(f.durS || 0) + '"');
  return p.join(' · ') || '（无成绩明细）';
}
function recName(r) {
  return (r && r.name) ? String(r.name) : ('体测 ' + recDate(r && r.ts));
}
const FIT_KEYS = ['h', 'w', 'vc', 'r50', 'sit', 'jump', 'pull', 'durM', 'durS'];
function sval(v) { return String(v == null ? '' : v).trim(); }
// 旧记录的非空项都和新数据一致（新数据只是多填了项）→ 可合并
function fitSubset(oldF, newF) {
  oldF = oldF || {}; newF = newF || {};
  let any = false;
  for (let i = 0; i < FIT_KEYS.length; i++) {
    const k = FIT_KEYS[i], ov = sval(oldF[k]), nv = sval(newF[k]);
    if (ov) {
      any = true;
      if (nv !== ov) return false;
    }
  }
  return any;
}
function findMergeIndex(list, fields, sex, gr) {
  for (let i = 0; i < (list || []).length; i++) {
    const r = list[i];
    if ((r.sex || 'm') !== sex || (r.gr || '12') !== gr) continue;
    if (fitSubset(r.fields || {}, fields)) return i;
  }
  return -1;
}
function withVals(form) {
  return FIELDS.map(function (f) {
    return { k: f.k, n: f.n, u: f.u, ph: f.ph, type: f.type, v: form[f.k] || '' };
  });
}

Page({
  data: {
    state: 'loading',
    errorText: '',
    sex: 'm', grade: '12',
    form: blankForm(), fields: [],
    res: null, hist: [], hasData: false,
    sexOpts: SEX, grOpts: GR,
    barWidth: 0, barCls: ''
  },

  onLoad(options) {
    scrollmem.attach(this);
    options = options || {};
    this._agent = agent.pick(this);            // AI 页面接力（wx.onAgentHandoff），只消费一次
    this._agentQ = agent.pickQuery(options);   // 备用：handoff query 随页面参数传入
    this._first = true;
  },
  onShow() {
    share.enable();
    scrollmem.restore(this);
    if (!identity.ensure()) return;
    try { store.reload(); } catch (e) { /* ignore */ }
    if (this._first) {
      this._first = false;
      this.setData({ state: 'loading' });
      this._t = setTimeout(() => { this._t = null; this.load(); this.applyAgentHandoff(); this._syncFit(); }, 140);
    } else {
      this.load();
      this.applyAgentHandoff();
      this._syncFit();
    }
  },
  onHide() {
    scrollmem.save(this); if (this._t) { clearTimeout(this._t); this._t = null; } },
  onUnload() {
    scrollmem.save(this); if (this._t) { clearTimeout(this._t); this._t = null; } },
  onPullDownRefresh() { this.load(); this._syncFit(true); wx.stopPullDownRefresh(); },
  // 需求 14：进页 / 下拉刷新时从云端拉一次 userdata（fit section 含 sex/grade）→ 应用后按 onCloudSync
  // 的同一套逻辑刷新 UI（远端改过性别/年级后，体测页立刻显示新值）。离线时静默保留本机。
  _syncFit(force) {
    if (!identity.has() || !cloud.isEnabled()) return;
    cloud.udSync(!!force).then(() => {
      try { store.reload(); } catch (e) { /* ignore */ }
      this.onCloudSync();
    }).catch(function () { /* 离线保留本机 */ });
  },
  // 云端 userdata 应用后重绘（契约 §5.4）：只重读体测输入与历史记录，不重置已算结果；
  // 用户正在输入时（1.2s 内）跳过写值，避免同步把正在编辑的输入框覆盖/打断。
  onCloudSync() {
    try {
      store.reload();
      this.renderHist();
      if (this._typingAt && Date.now() - this._typingAt < 1200) return;
      if (this._hoAt && Date.now() - this._hoAt < 5000) return;   // 接力预填后 5s 内不让同步覆盖
      const f = store.get().fit || {};
      const form = {
        h: f.h || '', w: f.w || '', vc: f.vc || '', r50: f.r50 || '', sit: f.sit || '',
        jump: f.jump || '', pull: f.pull || '', durM: f.durM || '', durS: f.durS || ''
      };
      const filled = this.hasAny(form);
      this.setData({
        sex: f.sex === 'f' ? 'f' : 'm',
        grade: f.grade === '34' ? '34' : '12',
        form: form,
        fields: withVals(form),
        hasData: filled,
        state: filled ? 'data' : 'empty'
      }, () => { if (filled) this.recalc(true); });
    } catch (e) { /* 重绘失败不影响当前结果 */ }
  },

  // —— AI 页面接力：按 recordId 预填历史记录（本地优先、payload 兜底），再后台静默刷新 ——
  applyAgentHandoff() {
    if (this._agentApplied) return false;
    this._agentApplied = true;
    const h = this._agent;
    const p = (h && h.payload) || {};
    const q = Object.assign({}, this._agentQ || {}, (h && h.query) || {});
    if (!h && !this._agentQ) return false;
    const recordId = String(q.recordId || p.recordId || '');
    this._hoRecordId = recordId;
    const fallback = (p.record && typeof p.record === 'object') ? p.record
      : ((p.fields && typeof p.fields === 'object') ? p : null);
    const rec = this.findHoRecord(recordId, fallback);
    if (rec) { this.prefillHoRecord(rec); return true; }
    // 本机没有这条记录：后台拉一次云端记录再补填（不阻塞、不弹窗）
    if (identity.has()) {
      cloud.cloudPull().then(() => {
        const r = this.findHoRecord(recordId, fallback);
        if (r) this.prefillHoRecord(r);
      }).catch(function () { /* 离线时保持本机数据 */ });
    }
    return true;
  },
  findHoRecord(recordId, fallback) {
    const list = store.get().fitRecs || [];
    if (recordId) {
      for (let i = 0; i < list.length; i++) if (String(list[i].id || '') === recordId) return list[i];
    }
    if (fallback) return fallback;
    return null;
  },
  prefillHoRecord(rec) {
    try {
      const src = (rec.fields && typeof rec.fields === 'object') ? rec.fields : rec;
      const form = {
        h: src.h || '', w: src.w || '', vc: src.vc || '', r50: src.r50 || '', sit: src.sit || '',
        jump: src.jump || '', pull: src.pull || '', durM: src.durM || '', durS: src.durS || ''
      };
      if (!this.hasAny(form)) return;
      const sex = (src.sex || rec.sex) === 'f' ? 'f' : 'm';
      const grade = (src.grade || rec.gr) === '34' ? '34' : '12';
      const res = fit.ftCalc(Object.assign({ sex: sex, grade: grade }, form));
      this._hoAt = Date.now();
      this.setData({
        sex: sex, grade: grade, form: form, fields: withVals(form),
        hasData: true, state: 'data', res: res,
        barWidth: Math.max(0, Math.min(100, res.total)),
        barCls: res.total >= 80 ? '' : (res.total >= 60 ? 'warn' : 'danger')
      });
    } catch (e) { /* 预填失败不影响原页面 */ }
  },

  load() {
    try {
      const d = store.get();
      const f = d.fit || {};
      const form = {
        h: f.h || '', w: f.w || '', vc: f.vc || '', r50: f.r50 || '', sit: f.sit || '',
        jump: f.jump || '', pull: f.pull || '', durM: f.durM || '', durS: f.durS || ''
      };
      const filled = this.hasAny(form);
      this.setData({
        state: filled ? 'data' : 'empty',
        errorText: '',
        sex: f.sex === 'f' ? 'f' : 'm',
        grade: f.grade === '34' ? '34' : '12',
        form: form,
        fields: withVals(form),
        res: null,
        hasData: filled,
        hist: []
      }, () => { if (filled) this.recalc(true); });
      // 首次打开也要走和保存/删除后的同一套映射，否则历史卡片会拿到裸记录而显示空白
      this.renderHist();
    } catch (e) {
      this.setData({ state: 'error', errorText: '读取失败：' + ((e && e.message) || e) });
    }
  },

  hasAny(form) {
    form = form || {};
    return FIELDS.some(function (x) { return String(form[x.k] || '').trim() !== ''; }) ||
      DUR_FIELDS.some(function (k) { return String(form[k] || '').trim() !== ''; });
  },
  syncFields() { this.setData({ fields: withVals(this.data.form) }); },

  // 自动算分：输入即刷新结果，和网页版一致，不再需要点「计算成绩」
  recalc(silent) {
    const f = this.saveInput();
    const res = fit.ftCalc(f);
    const any = this.hasAny(this.data.form);
    this.setData({
      state: any ? 'data' : 'empty',
      hasData: any,
      res: any ? res : null,
      barWidth: any ? Math.max(0, Math.min(100, res.total)) : 0,
      barCls: res.total >= 80 ? '' : (res.total >= 60 ? 'warn' : 'danger')
    });
    if (!silent) {
      if (!any) util.toast('先填写至少一项成绩');
      else if (res.miss) util.toast('还有 ' + res.miss + ' 项没填，已按缺项计');
      else util.toast('总评 ' + res.totalText + ' · ' + res.grade);
    }
    return res;
  },

  onInput(e) {
    this._typingAt = Date.now();       // 输入中：云同步应用值先跳过，避免覆盖正在编辑的内容
    const k = e.currentTarget.dataset.k;
    let v = e.detail.value;
    if (k === 'durM' || k === 'durS') v = cleanInt(v).slice(0, k === 'durM' ? 3 : 2);
    else {
      const f = FIELDS.filter(function (x) { return x.k === k; })[0];
      v = cleanNumber(v, f ? f.dec : 1, !!(f && f.neg)).slice(0, 6);
    }
    const f = Object.assign({}, this.data.form);
    f[k] = v;
    this.setData({ form: f, state: 'data' }, () => { this.syncFields(); this.recalc(true); });
  },
  setSex(e) { this.setData({ sex: e.currentTarget.dataset.v }, () => this.recalc(true)); },
  setGr(e) { this.setData({ grade: e.currentTarget.dataset.v }, () => this.recalc(true)); },

  saveInput() {
    const d = store.get();
    const f = Object.assign({ sex: this.data.sex, grade: this.data.grade }, this.data.form);
    d.fit = f;
    store.save();
    return f;
  },

  openTable() { wx.navigateTo({ url: '/pages/fttable/fttable' }); },
  calc() { return this.recalc(false); },

  saveRec() {
    const f = this.saveInput();
    const r = fit.ftCalc(f);
    if (!r.wtDone) { util.toast('先填写成绩'); return; }
    const d = store.get();
    d.fitRecs = (d.fitRecs || []).slice(0, 2);
    const fields = JSON.parse(JSON.stringify(store.get().fit));
    const mergeAt = findMergeIndex(d.fitRecs, fields, r.sex, r.gr);
    let rec, merged = false;
    if (mergeAt >= 0) {
      // 同一份数据只是补填了项目：更新原记录，不新增一条
      rec = d.fitRecs[mergeAt];
      rec.fields = fields;
      rec.total = r.total;
      rec.grade = r.grade;
      rec._sync = false;
      if (!rec.name) rec.name = recName(rec);
      merged = true;
    } else {
      const ts = Date.now();
      rec = {
        id: cloud.cbId(), ts: ts, name: '体测 ' + recDate(ts),
        sex: r.sex, gr: r.gr, fields: fields,
        total: r.total, grade: r.grade, _sync: false
      };
      d.fitRecs.unshift(rec);
    }
    const dropped = d.fitRecs.splice(2);   // 只保留最近两条
    store.save();
    this.renderHist();
    dropped.forEach(function (x) {
      if (identity.has() && x.id && !x._sync) cloud.fitDelete(x.id);
    });
    if (identity.has()) {
      cloud.fitPush(rec).then((ok) => {
        this.renderHist();
        util.toast(merged ? (ok ? '已合并并同步' : '已合并，联网后补发') : (ok ? '已保存并同步' : '已保存，联网后自动补发'));
      });
    } else {
      util.toast(merged ? '已合并到历史记录' : '已保存到本机');
    }
  },
  renderHist() {
    const list = (store.get().fitRecs || []).slice(0, 2).map(function (r) {
      return Object.assign({}, r, {
        name: recName(r),
        when: recDate(r.ts),
        sexText: r.sex === 'f' ? '女' : '男',
        grText: r.gr === '34' ? '大三大四' : '大一大二',
        totalText: r.total != null ? Number(r.total).toFixed(1) : '—',
        detail: recDetail(Object.assign({ sex: r.sex }, r.fields || {})),
        cls: r.total >= 90 ? 'great' : (r.total >= 80 ? 'good' : (r.total >= 60 ? 'pass' : 'fail'))
      });
    });
    this.setData({ hist: list });
  },
  setHistoryName(i, name) {
    const d = store.get();
    const r = (d.fitRecs || [])[i];
    if (!r) return false;
    const v = String(name == null ? '' : name).trim().slice(0, 24);
    if (!v) { util.toast('记录名称不能为空'); return false; }
    r.name = v;
    store.save();
    this.renderHist();
    if (identity.has()) cloud.fitPush(r);
    util.toast('已改名');
    return true;
  },
  renameRec(e) {
    const i = +e.currentTarget.dataset.i;
    const r = (store.get().fitRecs || [])[i];
    if (!r) return;
    wx.showModal({
      title: '历史记录名称',
      editable: true,
      placeholderText: '例如：期中体测 / 补测',
      content: r.name || recName(r),
      success: (res) => {
        if (res.confirm) this.setHistoryName(i, res.content);
      }
    });
  },
  restoreRec(e) {
    const i = +e.currentTarget.dataset.i;
    const r = (store.get().fitRecs || [])[i];
    if (!r) return;
    const d = store.get();
    d.fit = JSON.parse(JSON.stringify(r.fields || {}));
    store.save();
    const f = d.fit;
    const form = {
      h: f.h || '', w: f.w || '', vc: f.vc || '', r50: f.r50 || '', sit: f.sit || '',
      jump: f.jump || '', pull: f.pull || '', durM: f.durM || '', durS: f.durS || ''
    };
    this.setData({ sex: f.sex === 'f' ? 'f' : 'm', grade: f.grade === '34' ? '34' : '12', form: form, fields: withVals(form) }, () => {
      this.recalc(true);
      util.toast('已回填成绩');
    });
  },
  delRec(e) {
    const i = +e.currentTarget.dataset.i;
    const d = store.get();
    const r = (d.fitRecs || [])[i];
    if (!r) return;
    d.fitRecs.splice(i, 1);
    store.save();
    this.renderHist();
    if (identity.has() && r.id) cloud.fitDelete(r.id);
    util.toast('已删除');
  },
  reset() {
    wx.showModal({
      title: '清空输入',
      content: '清空体测输入与结果？',
      confirmText: '清空',
      confirmColor: '#A2543E',
      success: (r) => {
        if (!r.confirm) return;
        const d = store.get();
        d.fit = Object.assign({ sex: this.data.sex, grade: this.data.grade }, blankForm());
        store.save();
        this.setData({ form: blankForm(), res: null, state: 'empty', hasData: false, barWidth: 0 });
        this.syncFields();
      }
    });
  },

  exportImg() {
    if (!this.hasAny(this.data.form)) { util.toast('先填写成绩'); return; }
    const res = this.data.res || fit.ftCalc(this.saveInput());
    this.setData({ res: res });
    const lines = res.rows.map(function (r) {
      const s = r.s == null ? '—' : String(r.s);
      const p = r.p ? ('  +' + r.p) : '';
      return r.n + '（' + r.sub + '  ' + r.wt + '%）：' + r.v + '  →  ' + s + p;
    });
    canvas.exportAndSave(this, '#card', {
      title: '体测成绩',
      sub: (this.data.sex === 'f' ? '女' : '男') + ' · ' + (this.data.grade === '34' ? '大三大四' : '大一大二'),
      config: [
        ['标准总分', String(res.std)],
        ['加分', String(res.plus)],
        ['总评', String(res.totalText)],
        ['等级', res.grade],
        ['缺项', String(res.miss)]
      ],
      blocks: [{ label: '各项得分', lines: lines }],
      foot: '生成时间 ' + util.timeStr(),
      rec: util.recId('FIT')
    });
  },
  onPageScroll(e) { scrollmem.onScroll(this, e); },
  onShareAppMessage() {
    return share.message({
      title: '大学体测算分器｜国标七项实时出分',
      path: '/pages/ft/ft',
      imageUrl: '/images/share/ft.png'
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '大学体测算分器｜国标七项实时出分',
      imageUrl: '/images/share/ft.png'
    });
  }
});
