// pages/water/water.js —— 宿舍「水量统计」（v2.0.0 网站功能同步，2026-11-06；2026-11-11 接云端共享）
//
// 2026-11-20 视觉重做（水量界面优化）：
//   * 顶部「本期用水」主卡：用量大数字 + 水费/折合扣电 + 定额进度条，超定额状态一眼可见；
//   * 宿舍人数改为 1–6 等宽分段的「人数选择器」，定额说明只出现一次；
//   * 录入抄表拆成「月份 / 大号读数输入 / 即时测算」三层，保存按钮修复为 M3 filled；
//   * 抄表历史改为「月份 + 读数 + 用量/水费/折合」三列，减少小字堆叠；
//   * 水费规则卡压缩为 2×2 信息格 + 公式行；空态/首次记录/离线态都有独立文案。
//   只改展示与少量交互（滚动到表单、离线重试），计费/云端共享/存储口径全部沿用下方原逻辑。
//
// 与网站 WATER 模块同口径（契约 web/tools/tests/_water_contract.md + 2026-11-11 共享契约
// _water_shared_contract.md）：
//   * 关注宿舍沿用「宿舍电费」的 power.sel（可在此切换；未选择时页面只引导、0 请求、0 数据）；
//   * 宿舍人数 1–6（默认 4）→ 每月水定额 = 2 吨水 × 人数；
//   * 每月手动抄表（月份 + 水表读数），自动对比上一条：用量 = 本次 − 上次；
//   * 水费 = max(0, 用量 − 2×人数) × 3.03；折合扣电 = 水费 ÷ 0.58；
//   * 历史按月倒序、可删除，删除后用量/水费/折合扣电全部自动重算；
//   * 水费规则卡（2026-11-06 用户反馈：电费规则移入「宿舍电费」页电量统计；
//     2026-11-11 契约 §5：文案统一叫「定额」，不再出现「每月免费 N 吨水」，公式数值不变）。
//
// 共享按身份与房间读取。只有可证明的用户操作能进入共享待发队列。
const shared = require('../../utils/water-shared.js');
const writing = new Map();
const latestRefresh = new Map();
const store = require('../../utils/store.js');
const identity = require('../../utils/identity.js');
const cloud = require('../../utils/cloud.js');
const power = require('../../utils/power.js');
const water = require('../../utils/water.js');
const util = require('../../utils/util.js');
const share = require('../../utils/share.js');
const scrollmem = require('../../utils/scrollmem.js');

const SELKEY = 'zq_power_sel_';                 // 与电费页共用本机离线兜底键
function fallbackKey() { return SELKEY + (identity.sid() || ''); }
function readFallback() {
  try { return String(wx.getStorageSync(fallbackKey()) || ''); } catch (e) { return ''; }
}
function writeFallback(rv) {
  try {
    if (rv) wx.setStorageSync(fallbackKey(), rv);
    else wx.removeStorageSync(fallbackKey());
  } catch (e) { /* 离线兜底写失败不影响云端真源 */ }
}
function emptyCmp() {
  return {
    empty: true, first: true, monthText: '', readingText: '—', prevMonthText: '',
    usageText: '—', feeText: '0.00', degText: '0.0', overText: '', quotaText: ''
  };
}
function hhmm(ts) {
  const d = new Date(Number(ts) || 0);
  if (isNaN(d.getTime())) return '';
  return util.pad(d.getHours()) + ':' + util.pad(d.getMinutes());
}
// '2026-11' → '2026 年 11 月'（只用于展示；picker / 存储仍用 YYYY-MM）
function monthLabel(m) {
  const s = water.normMonth(m);
  if (!s) return '';
  return s.slice(0, 4) + ' 年 ' + Number(s.slice(5, 7)) + ' 月';
}

Page({
  data: {
    state: 'idle',            // idle（未选宿舍）| ready
    hasSel: false,
    sel: '',
    selLabel: '',
    persons: 4,
    personsLocked: false,
    personsOptions: water.ruleView(4).personsOptions,   // 「1 人间」…「6 人间」（2026-11-19 自选）
    personQuota: water.quotaOf(4),
    month: '',
    monthText: '',
    reading: '',
    preview: null,            // { valid, usageText, feeText, degText, overText, reason }
    cmp: emptyCmp(),          // 本期对比（最新一条 vs 上一条）
    quotaPct: 0,              // 定额进度（0–100，超出按 100 展示）
    quotaUsedText: '',        // 「已用 238%」/ 首次占位
    quotaFootText: '',        // 「超出 11.00 吨」/「剩余 3.00 吨」
    statusText: '',           // 主卡状态胶囊：超定额 / 定额内 / 首次记录
    statusTone: 'empty',      // over | ok | first | empty
    prevReadHint: '',         // 录入表单上方「上次读数 …」
    tiles: [],                // 本期用量 / 水费 / 折合扣电
    history: [],
    histCount: 0,
    rules: {},
    footer: '',
    syncText: '',             // 云端共享状态：宿舍共享 · 已同步 / 离线 · 已存本机
    syncErr: false,
    waterPending: false,      // 有离线待补发的云端写操作（契约 §3.2）
    // 自定义宿舍选择 bottom-sheet（与电费页同款交互）
    sheetOpen: false,
    buildings: [],
    activeBuilding: '',
    buildingRooms: [],
    selectedRv: ''
  },

  onLoad() {
    scrollmem.attach(this);
    this._active = true;
    this._netCb = e => { if (this._active && e.isConnected) this._cloudSync(true); };
    if (wx.onNetworkStatusChange) wx.onNetworkStatusChange(this._netCb);
    this.setData({
      buildings: power.BLDS,
      activeBuilding: power.BLDS[0],
      buildingRooms: power.roomsOfBuilding(power.BLDS[0]),
      month: water.monthOf(),
      monthText: monthLabel(water.monthOf()),
      rules: water.ruleView(4)
    });
    this._syncSel(true);
  },
  onShow() {
    this._active = true;
    share.enable();
    if (!identity.ensure()) { this._render(); return; }
    scrollmem.restore(this);
    try { store.reload(); } catch (e) { /* ignore */ }
    this._syncSel(false);
    this._render();
    this._cloudSync(false);
  },
  onHide() { this._active = false; scrollmem.save(this); },
  onUnload() {
    this._active = false; scrollmem.save(this);
    if (wx.offNetworkStatusChange) wx.offNetworkStatusChange(this._netCb);
  },
  onPageScroll(e) { scrollmem.onScroll(this, e); },
  // 云端 userdata 应用后（换端 / 网页端改动）：重新读取本机 water / power，并核对云端共享表
  onCloudSync() {
    this._syncSel(true);
    this._render();
    this._cloudSync(false);
  },

  // 读取 power.sel（与电费页共享；离线兜底键只在无 UD 基线时补位，云端权威清空不复活）
  _syncSel(force) {
    const d = store.get();
    const base = d.udCache;
    const allowFallback = !base || !base.power || base.power.sel === undefined;
    let rv = power.normalizeSel((d.power && d.power.sel) || '');
    if (!rv && allowFallback) rv = power.normalizeSel(readFallback());
    const locked = water.isFixed4(rv);
    const changed = force || rv !== this.data.sel;
    if (!changed) {
      if (locked !== this.data.personsLocked) this.setData({ personsLocked: locked });
      return false;
    }
    this.setData({ sel: rv, hasSel: !!rv, selLabel: power.labelOf(rv), selectedRv: rv, personsLocked: locked });
    return true;
  },
  _context() {
    return { sid: identity.sid(), token: identity.token(), revision: identity.revision(), localRevision: store.localRevision(), rv: this.data.sel };
  },
  _owns(c) {
    return this._active && c.sid && c.sid === identity.sid() && c.token === identity.token() &&
      c.rv === this.data.sel && c.revision === identity.revision() && c.localRevision === store.localRevision();
  },
  _room() {
    const c = this._context();
    const state = shared.read(c.sid, c.rv);
    return state.denied ? { p: 4, recs: [] } : shared.display(state);
  },
  _deny(c) {
    const state = shared.read(c.sid, c.rv);
    state.denied = true;
    shared.save(c.sid, c.rv, state);
    this._render();
    this.setData({ syncText: '身份失效或无权查看 · 请重新验证', syncErr: true });
  },
  async _cloudSync(force) {
    const c = this._context();
    if (!this._owns(c) || !c.rv) return false;
    if (!cloud.isReadyForSync()) {
      this.setData({ syncText: '离线 · 已保存本机', syncErr: true }); return false;
    }
    const key = c.sid + '|' + c.rv;
    const ticket = {};
    latestRefresh.set(key, ticket);
    const valid = () => this._owns(c) && latestRefresh.get(key) === ticket;
    try {
      const previous = shared.read(c.sid, c.rv);
      const fresh = force || previous.ops.length > 0 || previous.denied || this.data.syncErr || !Array.isArray(previous.rows);
      const [list, people] = await Promise.all([cloud.waterList(c.rv, fresh), cloud.waterRoomGet(c.rv)]);
      if (!valid()) { if (!identity.has()) this._render(); return false; }
      if ([list, people].some(r => /http40[13]/.test(r.reason || ''))) { this._deny(c); return false; }
      const gotRows = list.ok && !list.cached && Array.isArray(list.rows);
      const gotPeople = people.ok && (people.persons === null || water.roomPersonsOf({ persons: people.persons }) !== null);
      if ((gotRows || gotPeople) && !(gotRows && list.rows.length || gotPeople && people.persons !== null)) {
        const authorized = await cloud.waterIdentity(c.sid);
        if (!valid()) return false;
        if (!authorized) { this._deny(c); return false; }
      }
      const state = shared.read(c.sid, c.rv);
      if (gotRows || gotPeople) state.denied = false;
      if (gotRows) state.rows = list.rows;
      if (gotPeople) state.people = people.persons;
      shared.save(c.sid, c.rv, state);
      this._render();
      const result = await this._flushPending(c, key, valid, { rows: gotRows, people: gotPeople });
      if (!valid() || shared.read(c.sid, c.rv).denied) return false;
      if (result === 'reread') return this._cloudSync(true);
      const pending = shared.read(c.sid, c.rv).ops.length;
      const full = (gotRows || (list.cached && Array.isArray(state.rows))) && gotPeople;
      this.setData({ syncText: pending ? '有本机操作待核对' :
        (full ? '宿舍共享 · 已同步' : '部分数据未核对 · 已保留本机记录'),
        syncErr: !!pending || !full, waterPending: !!pending });
      return full && !pending;
    } catch (err) {
      if (!identity.has()) this._render();
      else if (valid() && /http40[13]/.test(String(err && err.message))) this._deny(c);
      else if (valid()) this.setData({ syncText: '未能核对共享数据 · 已保留本机', syncErr: true });
      return false;
    }
  },
  async _flushPending(c, key, valid, got) {
    if (!c) return this._cloudSync(true);
    if (writing.has(key)) { await writing.get(key); return 'reread'; }
    let release;
    writing.set(key, new Promise(resolve => { release = resolve; }));
    let written = false;
    try {
      for (const candidate of shared.read(c.sid, c.rv).ops) {
        if (!valid() || !(candidate.field === 'people' ? got.people : got.rows)) continue;
        const state = shared.read(c.sid, c.rv);
        const op = state.ops.find(item => item.id === candidate.id);
        if (!op || state.denied) continue;
        const choice = shared.decision(op, shared.value(state, op.field));
        if (choice === 'satisfied') {
          state.ops = state.ops.filter(item => item.id !== op.id);
          shared.save(c.sid, c.rv, state); continue;
        }
        if (choice === 'review') continue;
        op.outcomeUnknown = true;
        shared.save(c.sid, c.rv, state);
        let receipt;
        if (op.field === 'people') receipt = await cloud.waterRoomUpsert(c.rv, op.desired);
        else if (op.desired === null) receipt = await cloud.waterDelete(c.rv, op.field);
        else receipt = await cloud.waterUpsert(c.rv, op.field, op.desired.reading, op.desired.persons);
        if (!valid()) return;
        if (receipt.ok) written = true;
        else if (/http40[13]/.test(receipt.reason)) { this._deny(c); return; }
        else if (receipt.reason === 'offline') {
          const current = shared.read(c.sid, c.rv);
          const previous = current.ops.find(item => item.id === op.id);
          if (previous) { previous.outcomeUnknown = false; shared.save(c.sid, c.rv, current); }
        }
      }
    } finally { writing.delete(key); release(); }
    this._render();
    return written ? 'reread' : undefined;
  },
  _queue(field, desired, source) {
    const c = this._context();
    if (!this._owns(c)) return;
    const state = shared.read(c.sid, c.rv);
    if (state.denied) { util.toast('请重新验证身份'); return; }
    shared.queue(state, field, desired, source);
    shared.save(c.sid, c.rv, state);
    this._render();
    this.setData({ syncText: '待同步 · 已保存本机', syncErr: true });
    return this._cloudSync(true);
  },
  reviewPending() {
    const c = this._context();
    if (!this._owns(c)) return;
    const state = shared.read(c.sid, c.rv), op = state.ops[0];
    if (!op || state.denied) return;
    const current = shared.value(state, op.field);
    if (current === undefined) { util.toast('先联网核对当前共享值'); this._cloudSync(true); return; }
    const label = value => value === null ? '无记录' : typeof value === 'number' ? value + ' 人' :
      value.reading + ' 吨（' + value.persons + ' 人）';
    wx.showActionSheet({ itemList: ['确认提交本机操作', '采用当前共享值'], success: r => {
      if (!this._owns(c)) return;
      wx.showModal({ title: op.field === 'people' ? '核对居住人数' : '核对 ' + op.field,
        content: '共享值：' + label(current) + '。本机意图：' + label(op.desired) + '。',
        success: choice => {
          if (!choice.confirm || !this._owns(c)) return;
          const fresh = shared.read(c.sid, c.rv);
          if (!fresh.ops.some(o => o.id === op.id) || !shared.same(current, shared.value(fresh, op.field))) return;
          fresh.ops = fresh.ops.filter(o => o.id !== op.id);
          if (r.tapIndex === 0) shared.queue(fresh, op.field, op.desired);
          shared.save(c.sid, c.rv, fresh); this._render(); this._cloudSync(true);
        } });
    } });
  },
  async viewPrivate() {
    const c = this._context();
    if (!this._owns(c)) return;
    const initial = shared.read(c.sid, c.rv);
    if (initial.denied) { util.toast('请先重新验证身份'); return; }
    let history = initial.history;
    try {
      const data = await cloud.waterPrivateHistory(c.sid, c.rv);
      if (!this._owns(c)) return;
      history = data;
      const state = shared.read(c.sid, c.rv); state.history = data; shared.save(c.sid, c.rv, state);
    } catch (e) {
      if (!this._owns(c)) return;
      if (/http40[13]/.test(String(e.message))) { this._deny(c); return; }
    }
    if (!history || !history.recs.length) { util.toast('没有已确认归属的个人旧记录'); return; }
    wx.showModal({ title: '个人旧账本', content: history.recs.map(r => r.m + '　' + r.r + ' 吨').join('\n'),
      confirmText: '选月导入', cancelText: '关闭', success: r => {
        if (!r.confirm || !this._owns(c)) return;
        wx.showModal({ title: '输入要导入的月份', editable: true, placeholderText: 'YYYY-MM',
          success: pick => {
            const rec = history.recs.find(row => row.m === pick.content);
            if (!pick.confirm || !rec || !this._owns(c)) return;
            const cur = shared.value(shared.read(c.sid, c.rv), rec.m);
            wx.showModal({ title: '导入 ' + rec.m,
              content: '历史值 ' + rec.r + ' 吨；共享值 ' + (cur ? cur.reading + ' 吨' : cur === null ? '无记录' : '尚未核对') + '。',
              success: yes => { if (yes.confirm && this._owns(c)) this._queue(rec.m, { reading: rec.r, persons: history.p }, 'confirmed-import'); } });
          } });
      } });
  },

  /* ---------------- 自定义宿舍选择弹层（与电费页同款） ---------------- */
  openSheet() {
    const b = power.buildingOf(this.data.sel) || this.data.buildings[0];
    this.setData({
      sheetOpen: true,
      activeBuilding: b,
      buildingRooms: power.roomsOfBuilding(b),
      selectedRv: this.data.sel
    });
  },
  closeSheet() { this.setData({ sheetOpen: false }); },
  noop() { /* 阻止弹层内点击冒泡到遮罩 */ },
  pickBuilding(e) {
    const b = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.b) || '');
    if (this.data.buildings.indexOf(b) < 0) return;
    this.setData({ activeBuilding: b, buildingRooms: power.roomsOfBuilding(b) });
  },
  pickRoom(e) {
    const rv = power.normalizeSel((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.rv) || '');
    if (!rv) return;
    this.setData({ sheetOpen: false, selectedRv: rv });
    // 关注宿舍是电费页的 power.sel（真源 UD.power）：在这里切换同样写 power section 并触发同步
    const d = store.get();
    d.power = { sel: rv, at: Date.now(), low: power.normLow(d.power && d.power.low) };
    store.save();
    writeFallback(rv);
    this._syncSel(true);
    this._render();
    this._cloudSync(true);       // 切宿舍 = 新的共享房间：强制核对云端（契约 §3.1）
  },
  goPower() { wx.navigateTo({ url: '/pages/power/power' }); },
  // 空态 CTA：滚到录入抄表卡（selector 不支持时回退固定偏移）
  scrollToForm() {
    if (!wx.pageScrollTo) return;
    wx.pageScrollTo({
      selector: '#wtForm', duration: 300,
      fail: function () { wx.pageScrollTo({ scrollTop: 520, duration: 300 }); }
    });
  },
  // 离线状态可点重试：复用同一云端核对链路（不新增请求通道）
  retryCloud() {
    if (!this.data.syncErr) return;
    this._cloudSync(true);
  },

  /* ---------------- 录入 / 人数 / 删除 ---------------- */
  pickPersons(e) {
    const p = water.roomPersonsOf({ persons: e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.p });
    const rv = this.data.sel;
    if (!rv || p === null || !identity.has()) return;
    if (p === this.data.persons && shared.read(identity.sid(), rv).people === p) return;
    return this._queue('people', p);
  },
  onMonthChange(e) {
    const m = water.normMonth(e && e.detail && e.detail.value) || water.monthOf();
    this.setData({ month: m, monthText: monthLabel(m) });
    this._render();
  },
  onReadingInput(e) {
    this.setData({ reading: String(e && e.detail && e.detail.value || '') });
    this._renderPreview();
  },
  saveRecord() {
    const rv = this.data.sel;
    if (!rv) { util.toast('先选择关注宿舍'); return; }
    const room = this._room();
    const result = water.saveRecord(room.recs, this.data.month, this.data.reading, this.data.persons);
    if (!result.ok) { util.toast(result.reason); return; }
    this.setData({ reading: '' });
    return this._queue(result.rec.m, { reading: result.rec.r, persons: room.p });
  },
  delRecord(e) {
    const month = water.normMonth(e && e.currentTarget && e.currentTarget.dataset.m);
    const c = this._context();
    if (!month || !this._owns(c)) return;
    wx.showModal({ title: '删除抄表记录', content: '删除 ' + month + ' 的共享记录？',
      success: result => { if (result.confirm && this._owns(c)) this._queue(month, null); } });
  },

  /* ---------------- 渲染 ---------------- */
  _renderPreview() {
    const rv = this.data.sel;
    if (!rv || String(this.data.reading).trim() === '') {
      if (this.data.preview) this.setData({ preview: null });
      return;
    }
    const room = this._room();
    const pv = water.previewOf(room.recs, this.data.month, this.data.reading, this.data.persons);
    if (!pv || !pv.valid) {
      this.setData({ preview: { valid: false, reason: (pv && pv.reason) || '请输入有效读数' } });
      return;
    }
    this.setData({
      preview: {
        valid: true, reason: '',
        usageText: water.fmtReading(pv.usage),
        feeText: water.fmtMoney(pv.fee),
        degText: water.fmtDeg(pv.deg),
        overText: pv.over > 0 ? (water.fmtReading(pv.over) + ' 吨') : '',
        over: pv.over > 0,
        replaced: !!pv.replaced,
        first: pv.usage == null
      }
    });
  },
  _render() {
    const rv = this.data.sel;
    const fixed = water.isFixed4(rv);
    const persons = fixed ? 4 : this.data.persons;
    const rules = water.ruleView(persons);
    const monthText = monthLabel(this.data.month);
    if (!rv) {
      this.setData({
        state: 'idle', persons: 4, personsLocked: false, preview: null, cmp: emptyCmp(), tiles: [], history: [], histCount: 0,
        rules: rules, personsOptions: rules.personsOptions, personQuota: water.quotaOf(4),
        monthText: monthText, prevReadHint: '', quotaPct: 0, quotaUsedText: '', quotaFootText: '',
        statusText: '', statusTone: 'empty',
        syncText: '', syncErr: false, waterPending: false,
        footer: '关注宿舍与「宿舍电费」共用；选择保存在账号里，换设备登录会同步'
      });
      return;
    }
    const room = this._room();
    const p = fixed ? 4 : room.p;
    const recs = room.recs;
    const hist = water.buildHistory(recs, p);
    const cmp = water.compareOf(recs, p);
    const rulesP = water.ruleView(p);
    const quota = water.quotaOf(p);
    const histRows = hist.map(function (row) {
      const rowOver = row.over > 0;
      return {
        m: row.m,
        rText: water.fmtReading(row.r),
        usageText: row.usage == null ? '—' : water.fmtReading(row.usage),
        feeText: row.usage == null ? '—' : water.fmtMoney(row.fee),
        degText: row.usage == null ? '—' : water.fmtDeg(row.deg),
        first: !!row.first,
        over: rowOver,
        tagText: row.first ? '首次' : (rowOver ? ('超 ' + water.fmtReading(row.over) + ' 吨') : '定额内'),
        tagTone: row.first ? 'neutral' : (rowOver ? 'error' : 'ok')
      };
    });
    const latest = hist.length ? hist[0] : null;
    const tiles = [
      {
        key: 'usage', label: '本次用量', value: latest && latest.usage != null ? water.fmtReading(latest.usage) : '—',
        unit: '吨', sub: latest ? ('读数 ' + water.fmtReading(latest.r) + ' 吨') : ''
      },
      {
        key: 'fee', label: '本期水费', value: latest && latest.usage != null ? water.fmtMoney(latest.fee) : '0.00',
        unit: '元', sub: latest && latest.usage != null
          ? (latest.over > 0 ? ('超出定额 ' + water.fmtReading(latest.over) + ' 吨') : ('未超定额 · 定额 ' + quota + ' 吨'))
          : ''
      },
      {
        key: 'deg', label: '折合扣电', value: latest && latest.usage != null ? water.fmtDeg(latest.deg) : '0.0',
        unit: '度', sub: '水费 ÷ ' + water.RULES.elec.toFixed(2)
      }
    ];
    // 主卡：0–100 的定额进度（超出仍显示满格，状态胶囊/脚注给出具体超额）
    let statusText = '待录入', statusTone = 'empty', quotaPct = 0, quotaUsedText = '', quotaFootText = '录入第一次读数后开始统计';
    if (!cmp.empty && !cmp.first) {
      const used = Number(cmp.usage) || 0;
      const pct = quota > 0 ? Math.round(used / quota * 100) : 0;
      quotaPct = Math.max(0, Math.min(100, pct));
      quotaUsedText = '已用 ' + pct + '%';
      if (cmp.over > 0) {
        statusText = '超定额';
        statusTone = 'over';
        quotaFootText = '超出 ' + water.fmtReading(cmp.over) + ' 吨';
      } else {
        statusText = '定额内';
        statusTone = 'ok';
        quotaFootText = '剩余 ' + water.fmtReading(Math.max(0, quota - used)) + ' 吨';
      }
    } else if (!cmp.empty) {
      statusText = '首次记录';
      statusTone = 'first';
      quotaUsedText = '';
      quotaFootText = '下次抄表自动计算用量';
    }
    // 录入提示：本月已有记录优先提示覆盖；否则给上一条读数，避免输错
    const editMonth = this.data.month;
    const same = recs.filter(function (x) { return x.m === editMonth; })[0];
    const before = recs.filter(function (x) { return x.m < editMonth; });
    const prev = before.length ? before[before.length - 1] : null;
    let prevReadHint = '首次抄表 · 暂无上次读数';
    if (same) prevReadHint = '本月已有记录 ' + water.fmtReading(same.r) + ' 吨 · 保存将覆盖';
    else if (prev) prevReadHint = '上次读数 ' + water.fmtReading(prev.r) + ' 吨 · ' + prev.m;
    this.setData({
      state: 'ready',
      persons: p,
      personsLocked: fixed,
      rules: rulesP,
      personsOptions: rulesP.personsOptions,
      personQuota: quota,
      monthText: monthText,
      prevReadHint: prevReadHint,
      quotaPct: quotaPct,
      quotaUsedText: quotaUsedText,
      quotaFootText: quotaFootText,
      statusText: statusText,
      statusTone: statusTone,
      histCount: histRows.length,
      history: histRows,
      waterPending: !!identity.sid() && !shared.read(identity.sid(), rv).denied && shared.read(identity.sid(), rv).ops.length > 0,
      tiles: tiles,
      cmp: {
        empty: !!cmp.empty,
        first: !!cmp.first,
        monthText: cmp.rec ? cmp.rec.m : '',
        readingText: cmp.rec ? water.fmtReading(cmp.rec.r) : '—',
        prevMonthText: cmp.prev ? cmp.prev.m : '',
        prevReadingText: cmp.prev ? water.fmtReading(cmp.prev.r) : '',
        usageText: cmp.usage == null ? '—' : water.fmtReading(cmp.usage),
        feeText: water.fmtMoney(cmp.fee),
        degText: water.fmtDeg(cmp.deg),
        over: cmp.over > 0,
        overText: cmp.over > 0 ? ('超出定额 ' + water.fmtReading(cmp.over) + ' 吨') : '',
        quotaText: '每月定额 ' + quota + ' 吨水（' + p + ' 人 × 2 吨）'
      },
      footer: '用量 = 本次读数 − 上次读数；水费与折合扣电按校方规则估算，实际以学校账户为准。数据以宿舍为单位云端共享，同宿舍同学可共同维护。'
    });
    this._renderPreview();
  },

  onShareAppMessage() {
    return share.message({
      title: '班级工具｜宿舍水量 · 每月抄表算水费',
      path: '/pages/water/water',
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '班级工具｜宿舍水量 · 每月抄表算水费',
      imageUrl: '/images/share/default.png'
    });
  }
});
