// pages/water/water.js —— 宿舍「水量统计」（v2.0.0 网站功能同步，2026-11-06；2026-11-11 接云端共享）
//
// 与网站 WATER 模块同口径（契约 web/tools/tests/_water_contract.md + 2026-11-11 共享契约
// _water_shared_contract.md）：
//   * 关注宿舍沿用「宿舍电费」的 power.sel（可在此切换；未选择时页面只引导、0 请求、0 数据）；
//   * 宿舍人数 4 / 6（默认 4；23 号楼 A/B 座固定 4 人间、不可改）→ 每月水定额 = 2 吨水 × 人数；
//   * 每月手动抄表（月份 + 水表读数），自动对比上一条：用量 = 本次 − 上次；
//   * 水费 = max(0, 用量 − 2×人数) × 3.03；折合扣电 = 水费 ÷ 0.58；
//   * 历史按月倒序、可删除，删除后用量/水费/折合扣电全部自动重算；
//   * 水费规则卡（2026-11-06 用户反馈：电费规则移入「宿舍电费」页电量统计；
//     2026-11-11 契约 §5：文案统一叫「定额」，不再出现「每月免费 N 吨水」，公式数值不变）。
//
// 2026-11-11 云端共享（需求 6，契约 §1–§4）：
//   * 进入水量页 / 切换宿舍：先渲染本机缓存（store.water，秒开）→ 再 GET 云端（public.water + water_room）；
//     同 month 云端覆盖本地，本地独有月份补传（失败静默进离线队列）；云端失败保留本机缓存并显示「离线」；
//   * 保存 / 删除 / 改人数：先写本机 + store.save()（UD v6 water 继续作离线缓存）→ 再尽力写云端；
//     失败进 store.waterPend，onShow/进页/联网时自动重试（契约 §3.2）；
//   * 云端数据为宿舍共享：同宿舍任一同学写入后，其他人进入即可看到（以宿舍为单位）；
//   * 2026-11-19：取消 23A/23B 固定四人间，所有宿舍均可自选 1–6 人间（不再强制 upsert=4）；
//   * 隐私：只显示规范楼栋 + 房间号，不含姓名 / 学号（与电费同一红线）。
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

Page({
  data: {
    state: 'idle',            // idle（未选宿舍）| ready
    hasSel: false,
    sel: '',
    selLabel: '',
    persons: 4,
    personsLocked: false,     // 23A/23B 固定 4 人间（契约 §4）
    personsOptions: water.ruleView(4).personsOptions,   // 「1 人间」…「6 人间」（2026-11-19 自选）
    personQuota: water.quotaOf(4),
    month: '',
    reading: '',
    preview: null,            // { valid, usageText, feeText, degText, overText, reason }
    cmp: emptyCmp(),          // 本期对比（最新一条 vs 上一条）
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
    this._first = true;
    this._syncing = false;
    this._fixed4Pushed = {};        // 本会话内已把固定 4 人间写回云端的房间（避免每次进入重复 POST）
    this.setData({
      buildings: power.BLDS,
      activeBuilding: power.BLDS[0],
      buildingRooms: power.roomsOfBuilding(power.BLDS[0]),
      month: water.monthOf(),
      rules: water.ruleView(4)
    });
    this._syncSel(true);
  },
  onShow() {
    share.enable();
    if (!identity.ensure()) return;
    scrollmem.restore(this);
    try { store.reload(); } catch (e) { /* ignore */ }
    const changed = this._syncSel(false);
    if (this._first) {
      this._first = false;
      this._render();
    } else if (changed) {
      this._render();
    }
    // 2026-11-11 需求 6：先渲染本机缓存，再云端核对 / 补传离线队列（不阻塞首屏）
    this._cloudSync(false);
  },
  onHide() { scrollmem.save(this); },
  onUnload() { scrollmem.save(this); },
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
    if (locked) {
      // 23A/23B 固定 4 人间：本机镜像也强制 4（契约 §4）
      const d2 = store.get();
      const room = water.roomOf(d2.water, rv);
      if (room.p !== 4) {
        d2.water = water.withPersons(d2.water, rv, 4);
        store.save();
      }
    }
    return true;
  },

  /* ---------------- 云端共享（契约 §2/§3；唯一通道 utils/cloud.js） ---------------- */
  _cloudSync(force) {
    const rv = this.data.sel;
    if (!rv) return Promise.resolve(false);
    if (!identity.has() || !cloud.isEnabled()) {
      this.setData({ syncText: '仅本机（未连接云端）', syncErr: true });
      return Promise.resolve(false);
    }
    if (this._syncing) return Promise.resolve(false);
    this._syncing = true;
    // 顺序：先补发离线队列（保证本机写入不被云端旧值覆盖）→ 再 GET 核对/合并
    return this._flushPending().then(() => this._pullCloud(rv, force)).then((ok) => {
      this._syncing = false;
      return ok;
    }).catch(() => {
      this._syncing = false;
      this.setData({ syncText: '离线 · 已存本机', syncErr: true });
      return false;
    });
  },
  // 云端 GET + 合并：同 month 云端覆盖本地；本地独有月份补传；返回是否成功
  _pullCloud(rv, force) {
    if (!rv) return Promise.resolve(false);
    return Promise.all([cloud.waterList(rv, force), cloud.waterRoomGet(rv)]).then((res) => {
      const list = res[0] || {}, roomRes = res[1] || {};
      if (!list.ok && !roomRes.ok) {
        this.setData({ syncText: '离线 · 已存本机', syncErr: true });
        return false;
      }
      if (list.cached) {                       // 60s TTL 内：不重复合并/重绘（需求 9 TTL 门控）
        this.setData({ syncText: '宿舍共享 · 已同步', syncErr: false });
        return true;
      }
      const d = store.get();
      const local = water.roomOf(d.water, rv);
      const merged = water.mergeCloud(local.recs, list.rows || []);
      let changed = false;
      if (merged.changed) {
        d.water = water.withRecs(d.water, rv, merged.recs);
        changed = true;
      }
      // 人数：23A/23B 固定 4；其它楼栋以云端 water_room 为准（云端无行按本机/默认 4）
      let persons = local.p;
      if (water.isFixed4(rv)) persons = 4;
      else if (roomRes.ok && roomRes.persons) persons = roomRes.persons;
      if (persons !== local.p) {
        d.water = water.withPersons(d.water, rv, persons);
        changed = true;
      }
      if (changed) store.save();
      d.waterSyncAt = Date.now();
      store.save();
      this.setData({ syncText: '宿舍共享 · 已同步 ' + hhmm(d.waterSyncAt), syncErr: false });
      if (changed) this._render();
      // 固定 4 人间：首次进入自动 upsert water_room.persons=4（契约 §4）
      if (water.isFixed4(rv) && !this._fixed4Pushed[rv]) {
        this._fixed4Pushed[rv] = true;
        cloud.waterRoomUpsert(rv, 4).catch(function () { /* 失败不影响本地固定 4 */ });
      }
      // 本地独有月份补传（失败进离线队列，下次重试）
      (merged.missing || []).forEach((row) => {
        cloud.waterUpsert(rv, row.m, row.r, this.data.persons).then((r) => {
          if (!r || !r.ok) this._pendPut(rv, row.m, row.r);
        });
      });
      return true;
    });
  },
  // 离线待补发队列重试（契约 §3.2）：进页 / onShow / 切宿舍 / 保存后调用
  _flushPending() {
    const d = store.get();
    const ops = water.normOps(d.waterPend);
    if (!ops.length) return Promise.resolve(true);
    const jobs = ops.map((op) => {
      if (op.op === 'put') return cloud.waterUpsert(op.rv, op.m, op.r, op.p || 4).then((r) => (r && r.ok) ? op : null);
      if (op.op === 'del') return cloud.waterDelete(op.rv, op.m).then((r) => (r && r.ok) ? op : null);
      return cloud.waterRoomUpsert(op.rv, op.p || 4).then((r) => (r && r.ok) ? op : null);
    });
    if (!identity.has() || !cloud.isEnabled()) return Promise.resolve(false);
    return Promise.all(jobs).then((done) => {
      let left = store.get().waterPend;
      done.filter(Boolean).forEach((op) => { left = water.dropOp(left, op); });
      const dd = store.get();
      dd.waterPend = water.normOps(left);
      store.save();
      this.setData({ waterPending: left.length > 0 });
      return left.length === 0;
    }).catch(() => false);
  },
  _pendPut(rv, m, r) {
    const d = store.get();
    d.waterPend = water.pushOp(d.waterPend, { op: 'put', rv: rv, m: m, r: r, p: this.data.persons, at: Date.now() });
    store.save();
  },
  _pendDel(rv, m) {
    const d = store.get();
    d.waterPend = water.pushOp(d.waterPend, { op: 'del', rv: rv, m: m, at: Date.now() });
    store.save();
  },
  _pendPersons(rv, p) {
    const d = store.get();
    d.waterPend = water.pushOp(d.waterPend, { op: 'persons', rv: rv, p: p, at: Date.now() });
    store.save();
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

  /* ---------------- 录入 / 人数 / 删除 ---------------- */
  pickPersons(e) {
    const p = water.normPersons((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.p));
    if (p === this.data.persons) return;
    const rv = this.data.sel;
    if (!rv) return;
    if (water.isFixed4(rv)) { util.toast('23A/23B 固定 4 人间，不可修改'); return; }
    const d = store.get();
    d.water = water.withPersons(d.water, rv, p);   // 房间人数进 water section（随账号同步；云端共享表同步写）
    store.save();
    this.setData({ persons: p });
    this._render();
    if (identity.has() && cloud.isEnabled()) {
      cloud.waterRoomUpsert(rv, p).then((r) => {
        if (!r || !r.ok) { this._pendPersons(rv, p); util.toast('已保存本机 · 云端稍后重试'); }
      });
    }
  },
  onMonthChange(e) {
    const m = water.normMonth(e && e.detail && e.detail.value) || water.monthOf();
    this.setData({ month: m });
    this._render();
  },
  onReadingInput(e) {
    this.setData({ reading: String(e && e.detail && e.detail.value || '') });
    this._renderPreview();
  },
  saveRecord() {
    const rv = this.data.sel;
    if (!rv) { util.toast('先选择关注宿舍'); return; }
    const room = water.roomOf(store.get().water, rv);
    const r = water.saveRecord(room.recs, this.data.month, this.data.reading, this.data.persons);
    if (!r.ok) { util.toast(r.reason); return; }
    const d = store.get();
    d.water = water.withRecs(d.water, rv, r.recs);
    store.save();                                   // UD v6 water 继续作离线缓存；随后写云端共享表
    this.setData({ reading: '' });
    this._render();
    util.toast(r.replaced ? ('已更新 ' + this.data.month + ' 记录') : '已保存 ' + this.data.month + ' 记录');
    const p = this.data.persons;
    if (identity.has() && cloud.isEnabled()) {
      cloud.waterUpsert(rv, r.rec.m, r.rec.r, p).then((res) => {
        if (!res || !res.ok) { this._pendPut(rv, r.rec.m, r.rec.r); util.toast('已保存本机 · 云端稍后重试'); }
      });
    }
  },
  delRecord(e) {
    const m = water.normMonth((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.m));
    const rv = this.data.sel;
    if (!m || !rv) return;
    wx.showModal({
      title: '删除抄表记录',
      content: '删除 ' + m + ' 的记录？删除后用量与水费会按剩余记录重算。',
      success: (res) => {
        if (!res || !res.confirm) return;
        const d = store.get();
        const room = water.roomOf(d.water, rv);
        d.water = water.withRecs(d.water, rv, water.delRecord(room.recs, m));
        store.save();
        this._render();
        util.toast('已删除 ' + m + ' 记录');
        if (identity.has() && cloud.isEnabled()) {
          cloud.waterDelete(rv, m).then((r) => {
            if (!r || !r.ok) { this._pendDel(rv, m); util.toast('已删除本机 · 云端稍后重试'); }
          });
        }
      }
    });
  },

  /* ---------------- 渲染 ---------------- */
  _renderPreview() {
    const rv = this.data.sel;
    if (!rv || String(this.data.reading).trim() === '') {
      if (this.data.preview) this.setData({ preview: null });
      return;
    }
    const room = water.roomOf(store.get().water, rv);
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
        overText: pv.over > 0 ? (water.fmtReading(pv.over) + ' 吨') : ''
      }
    });
  },
  _render() {
    const rv = this.data.sel;
    const fixed = water.isFixed4(rv);
    const persons = fixed ? 4 : this.data.persons;
    const rules = water.ruleView(persons);
    if (!rv) {
      this.setData({
        state: 'idle', persons: 4, personsLocked: false, preview: null, cmp: emptyCmp(), tiles: [], history: [], histCount: 0,
        rules: rules, personsOptions: rules.personsOptions, personQuota: water.quotaOf(4),
        syncText: '', syncErr: false, waterPending: false,
        footer: '关注宿舍与「宿舍电费」共用；选择保存在账号里，换设备登录会同步'
      });
      return;
    }
    const room = water.roomOf(store.get().water, rv);
    const p = fixed ? 4 : room.p;
    const recs = room.recs;
    const hist = water.buildHistory(recs, p);
    const cmp = water.compareOf(recs, p);
    const rulesP = water.ruleView(p);
    const quota = water.quotaOf(p);
    const histRows = hist.map(function (row) {
      return {
        m: row.m,
        rText: water.fmtReading(row.r),
        usageText: row.usage == null ? '—' : water.fmtReading(row.usage),
        feeText: row.usage == null ? '—' : water.fmtMoney(row.fee),
        degText: row.usage == null ? '—' : water.fmtDeg(row.deg),
        first: !!row.first
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
    this.setData({
      state: 'ready',
      persons: p,
      personsLocked: fixed,
      rules: rulesP,
      personsOptions: rulesP.personsOptions,
      personQuota: quota,
      histCount: histRows.length,
      history: histRows,
      waterPending: water.normOps(store.get().waterPend).length > 0,
      tiles: tiles,
      cmp: {
        empty: !!cmp.empty,
        first: !!cmp.first,
        monthText: cmp.rec ? cmp.rec.m : '',
        readingText: cmp.rec ? water.fmtReading(cmp.rec.r) : '—',
        prevMonthText: cmp.prev ? cmp.prev.m : '',
        usageText: cmp.usage == null ? '—' : water.fmtReading(cmp.usage),
        feeText: water.fmtMoney(cmp.fee),
        degText: water.fmtDeg(cmp.deg),
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
