// pages/draw/draw.js —— 抽签（独立工具；不再有「下一步 · 分组」，分组在 pages/group）
// 算法：draw-v1（utils/drawproof.js，与网页/核验页逐字节一致：seed → mulberry32 → 洗牌不放回 / 允许重复）。
// 1.3.4 名单改造：参与名单只能从班级名单（class_members）里按座号选择，不再支持自定义文本；
//   未选择名单 = 只抽序号；选择了名单 = 抽签池只保留所选座号，结果必带姓名。
// 2026-11-12 抽签升级 v1（契约 web/draw/CONTRACT.md §2/§3.1/§4）：
//   * 名称映射：store.draw.names（每行「序号 名称」），结果名称优先级 = 映射 > 班级名单派生名 > ''；
//   * 每次「开始抽签」= 1 条云端存证（draw_record_create，异步不阻塞页面），结果区显示「今日第 N 次」；
//   * 剔除 / 补抽 / 重置 → draw_event_append 追加时间线（失败静默）；
//   * 导出图：编号 = 存证 id、参数区含存证信息、二维码 = webBase + '/#verify=<id>'；未存证不加二维码。
// 2026-11-22 分组拆分（契约 web/group/CONTRACT.md §1.1/§3）：重置只清抽签结果；每次成功抽签
//   额外写 flow.drawLast，分组页「最近抽签」跨重启可读，重置也不清空它。
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');
const flow = require('../../utils/flow.js');
const canvas = require('../../utils/canvas.js');
const identity = require('../../utils/identity.js');
const share = require('../../utils/share.js');
const roster = require('../../utils/roster.js');
const agent = require('../../utils/agent.js');
const scrollmem = require('../../utils/scrollmem.js');
const drawproof = require('../../utils/drawproof.js');
const sharecard = require('../../utils/sharecard.js');
const shareflow = require('../../utils/shareflow.js');

const SORT_LABEL = { draw: '按抽取顺序', num: '按序号升序', desc: '从大到小', rand: '随机打乱' };
const PROOF_SLOW_MS = 6000;   // 存证超过约 6s 未回包 → 按「未存证」展示（请求仍在，成功后会自愈）

Page(shareflow.install({
  data: {
    state: 'loading',            // 结果区：loading | empty | error | data
    errorText: '',
    start: 1, end: 70, count: 10, dup: false, excl: '', sort: 'draw', autoRe: true,
    rows: [], removed: [], poolLen: 0, cfg: null,
    rosterSel: [], selChips: [], selMore: 0, selCount: 0,
    // 名称映射（契约 §3.1）：names = 已保存文本；namesOpen = 弹层；namesDraft = 弹层草稿
    names: '', namesN: 0, namesSum: '未设置', namesOpen: false, namesDraft: '', namesDraftN: 0,
    // 存证状态（契约 §3.2/§3.3）：'' | pending | ok | failed
    proofStatus: '', proofCls: '', proofText: '', proofId: '',
    picker: false,
    th: { primary: '#5E8F87', track: '#E6E9E8' }   // 原生 slider/switch 配色（跟随系统主题）
  },

  onLoad(options) {
    scrollmem.attach(this);
    options = options || {};
    this._dead = false;
    this._proofSeq = 0;          // 存证序号：新抽签会作废旧请求的回调
    this._proofRid = '';         // 在途存证记录 id（load 恢复时区分「本页在途」与「上次遗留」）
    this._pendEvents = [];       // 存证在途期间的剔除/补抽事件（成功后补发）
    this._agent = agent.pick(this);            // AI 页面接力（wx.onAgentHandoff），只消费一次
    this._agentQ = agent.pickQuery(options);   // 备用：handoff query 随页面参数传入
    // 朋友圈从抽签页分享「存证」时只能带 query（当前页是 draw）：打开后转去存证详情页
    let sharedId = String(options.id || '');
    try { sharedId = decodeURIComponent(sharedId); } catch (e) { /* 保持原串 */ }
    this._sharedId = sharedId;
    this._first = true;
    this.setData({ th: util.nativeTheme() });
    if (wx.onThemeChange) {
      this._onTheme = () => { this.setData({ th: util.nativeTheme() }); };
      wx.onThemeChange(this._onTheme);
    }
  },
  onShow() {
    share.enable();
    scrollmem.restore(this);
    if (!identity.ensure()) return;
    // 分享到朋友圈的存证链接（当前页固定是 draw）：转到只读存证详情；只跳一次，返回后仍停留在抽签页
    if (this._sharedId && !this._sharedNav) {
      this._sharedNav = true;
      wx.navigateTo({ url: '/pages/drawrec/drawrec?id=' + encodeURIComponent(this._sharedId) });
      return;
    }
    this.setData({ th: util.nativeTheme() });
    try { store.reload(); } catch (e) { /* ignore */ }
    try { roster.migrate(); } catch (e) { /* 旧自定义名单迁移失败不阻塞页面 */ }
    this.applyAgentHandoff();
    if (this._first) {
      this._first = false;
      this.setData({ state: 'loading' });
      this._t = setTimeout(() => { this._t = null; this.load(); }, 140);
    } else {
      this.load();
    }
  },
  onHide() {
    scrollmem.save(this); if (this._t) { clearTimeout(this._t); this._t = null; } },
  onUnload() {
    scrollmem.save(this);
    this._dead = true;
    if (this._t) { clearTimeout(this._t); this._t = null; }
    if (this._proofSlowT) { clearTimeout(this._proofSlowT); this._proofSlowT = null; }
    if (this._shareT) { clearTimeout(this._shareT); this._shareT = null; }
    if (this._onTheme && wx.offThemeChange) { wx.offThemeChange(this._onTheme); this._onTheme = null; }
  },
  onPullDownRefresh() { this.load(); wx.stopPullDownRefresh(); },

  // —— AI 页面接力：抽签结果本就落在 zq_flow，先按 payload 兜底落盘再渲染，随后 load() 刷新 ——
  applyAgentHandoff() {
    if (this._agentApplied) return false;
    this._agentApplied = true;
    const h = this._agent;
    const p = (h && h.payload) || {};
    if (!h && !this._agentQ) return false;
    try {
      const fl = flow.getFlow();
      const has = !!(fl.draw && fl.draw.result);
      if (!has) {
        const st = (p.draw && typeof p.draw === 'object') ? p.draw : null;
        const rows = Array.isArray(p.items) ? p.items : (Array.isArray(p.result) ? p.result : null);
        if (st && Array.isArray(st.result)) {
          flow.patch('draw', st);
        } else if (rows) {
          const result = rows.map(function (x) {
            return (x && typeof x === 'object') ? Number(x.number != null ? x.number : x.n) : Number(x);
          }).filter(function (n) { return isFinite(n); });
          if (result.length) {
            flow.patch('draw', { result: result, pool: [], removed: [], log: [], cfg: (p.cfg && typeof p.cfg === 'object') ? p.cfg : null });
          }
        }
      }
    } catch (e) { /* payload 渲染失败保留本机已有结果 */ }
    return true;
  },
  // 云端 userdata 应用后重绘：只重读「参数 + 参与名单 + 名称映射」，不重置进行中的抽签结果（契约 §5.4）
  onCloudSync() {
    try {
      store.reload();
      const dr = store.get().draw || {};
      const info = roster.summary('draw', 8);
      this.setData({
        start: dr.start == null ? 1 : dr.start,
        end: dr.end == null ? 70 : dr.end,
        count: dr.count == null ? 10 : dr.count,
        dup: !!dr.dup,
        excl: dr.excl || '',
        sort: /^(num|desc|rand)$/.test(dr.sort) ? dr.sort : 'draw',
        autoRe: dr.autoRe !== false,
        rosterSel: roster.selOf('draw'),
        selChips: info.chips,
        selMore: info.more,
        selCount: info.count,
        // 契约 §3.1：UD.apply 后刷新映射摘要（映射变化也要重绘结果名称）
        names: String(dr.names == null ? '' : dr.names),
        namesN: drawproof.parseNames(dr.names || '').length,
        namesSum: drawproof.namesSummary(dr.names || '')
      });
      if (flow.getFlow().draw) this.apply(flow.getFlow().draw);
    } catch (e) { /* 重绘失败不影响当前结果 */ }
  },

  // 读本机配置 + 本机工作流结果
  load() {
    try {
      try { roster.migrate(); } catch (e) { /* ignore */ }
      const d = store.get();
      const dr = d.draw || {};
      const fl = flow.getFlow();
      const info = roster.summary('draw', 8);
      this.setData({
        start: dr.start == null ? 1 : dr.start,
        end: dr.end == null ? 70 : dr.end,
        count: dr.count == null ? 10 : dr.count,
        dup: !!dr.dup,
        excl: dr.excl || '',
        sort: /^(num|desc|rand)$/.test(dr.sort) ? dr.sort : 'draw',
        autoRe: dr.autoRe !== false,
        rosterSel: roster.selOf('draw'),
        selChips: info.chips,
        selMore: info.more,
        selCount: info.count,
        names: String(dr.names == null ? '' : dr.names),
        namesN: drawproof.parseNames(dr.names || '').length,
        namesSum: drawproof.namesSummary(dr.names || ''),
        errorText: ''
      });
      if (fl.draw && fl.draw.result) {
        // 上次离开页面时存证还在途（本页实例已不在）→ 无法等回包，按未存证展示（记录仍可能已落云端）
        const pf = fl.draw.proof;
        if (pf && pf.status === 'pending' && this._proofRid !== fl.draw.rid) {
          fl.draw.proof = { status: 'failed' };
          flow.patch('draw', fl.draw);
        }
        this.apply(fl.draw);
      } else {
        this.setData({
          rows: [], removed: [], cfg: null, poolLen: 0, state: 'empty',
          proofStatus: '', proofCls: '', proofText: '', proofId: ''
        });
      }
    } catch (e) {
      this.setData({ state: 'error', errorText: '读取失败：' + ((e && e.message) || e) });
    }
  },

  onInput(e) {
    const k = e.currentTarget.dataset.k;
    let v = e.detail.value;
    if (k === 'excl') v = String(v || '').replace(/[^\d,，\s\-~—]/g, '').slice(0, 100);
    const o = {}; o[k] = v; this.setData(o);
  },
  onNum(e) {
    const k = e.currentTarget.dataset.k;
    const v = String(e.detail.value || '').replace(/[^\d]/g, '').slice(0, 6);
    const o = {}; o[k] = v === '' ? '' : +v; this.setData(o);
  },
  onSwitch(e) { this.setData({ dup: e.detail.value }); },
  onCountSlider(e) { this.setData({ count: e.detail.value }); },
  setAutoRe(e) { this.setData({ autoRe: !!e.detail.value }); },

  // 结果排序：只改显示顺序（契约 §2：不改 st.result、不记事件；随机打乱也不改抽取顺序）
  setSort(e) {
    const v = e.currentTarget.dataset.v;
    const label = SORT_LABEL[v] || '按抽取顺序';
    const st = flow.getFlow().draw;
    if (st && st.cfg) { st.cfg.sort = label; }
    if (v === 'rand') {
      if (!st || !st.result) { util.toast('先抽一次签'); this.setData({ sort: v }); return; }
      if (st) flow.patch('draw', st);
      this.setData({ sort: v }, () => this.renderRows());
      return;
    }
    if (st) flow.patch('draw', st);
    this.setData({ sort: v }, () => this.renderRows());
  },

  // —— 参与名单（唯一来源：班级名单 class_members，按座号选择；不支持自定义 / 粘贴）——
  openPicker() { this.setData({ picker: true }); },
  closePicker() { this.setData({ picker: false }); },
  syncSel() {
    const info = roster.summary('draw', 8);
    this.setData({ rosterSel: roster.selOf('draw'), selChips: info.chips, selMore: info.more, selCount: info.count });
  },
  onRosterConfirm(e) {
    const seats = (e.detail && e.detail.seats) || [];
    roster.setSel('draw', seats);
    this.syncSel();
    this.setData({ picker: false });
    if (flow.getFlow().draw) this.apply(flow.getFlow().draw);
    util.toast(seats.length ? ('已选 ' + seats.length + ' 人') : '已清空参与名单');
  },

  buildPool() {
    const lo = Math.min(+this.data.start, +this.data.end);
    const hi = Math.max(+this.data.start, +this.data.end);
    const excl = util.parseExcl(this.data.excl);
    const range = [];
    for (let i = lo; i <= hi; i++) { if (excl.indexOf(i) < 0) range.push(i); }
    // 1.3.4：选了参与名单 → 抽签池 = 名单 ∩ 范围 − 排除；未选 → 只抽序号（不限名单）
    const sel = roster.selOf('draw');
    return { lo: lo, hi: hi, excl: excl, pool: roster.poolFilter(range, sel), sel: sel };
  },

  saveCfg() {
    const d = store.get();
    d.draw = {
      start: +this.data.start, end: +this.data.end, count: +this.data.count,
      dup: !!this.data.dup, excl: this.data.excl, sort: this.data.sort, autoRe: this.data.autoRe !== false,
      // 名称映射（契约 §3.1）：映射只在弹层保存时改写，这里必须原样保留，避免「抽签」清空映射
      names: String((d.draw && d.draw.names) || '')
    };
    store.save();
  },

  /* ---------------- 名称映射（契约 §3.1：每行「序号 名称」；映射 > 班级名单派生名 > ''） ---------------- */
  openNames() {
    const names = String((store.get().draw || {}).names || '');
    this.setData({
      namesOpen: true,
      namesDraft: names,
      namesDraftN: drawproof.parseNames(names).length
    });
  },
  closeNames() { this.setData({ namesOpen: false }); },
  noop() { /* 弹层内点按阻止冒泡 */ },
  onNamesInput(e) {
    const v = String((e && e.detail && e.detail.value) || '');
    this.setData({ namesDraft: v, namesDraftN: drawproof.parseNames(v).length });
  },
  // 清空 = 清空弹层输入（不落盘）；要点保存才生效（避免误触清掉已保存映射）
  clearNamesDraft() { this.setData({ namesDraft: '', namesDraftN: 0 }); },
  saveNames() {
    const text = drawproof.normNamesText(this.data.namesDraft || '');
    const n = drawproof.parseNames(text).length;
    const d = store.get();
    d.draw = Object.assign({}, d.draw, { names: text });
    store.save();
    this.setData({
      names: text, namesN: n, namesSum: drawproof.namesSummary(text),
      namesOpen: false, namesDraft: text, namesDraftN: n
    });
    // 映射变化 → 立即重绘结果名称（映射 > 班级名单派生名）
    if (flow.getFlow().draw) this.apply(flow.getFlow().draw);
    util.toast(n ? ('已保存映射 ' + n + ' 项') : '已清空映射');
  },

  /* ---------------- 抽签（每次点击 = 1 条云端存证，契约 §2/§3.2） ---------------- */
  doDraw() {
    this.saveCfg();
    const b = this.buildPool();
    if (!isFinite(b.lo) || !isFinite(b.hi) || (b.hi - b.lo + 1) <= 0) { util.toast('范围无效'); return; }
    if (!b.pool.length) {
      util.toast(b.sel.length ? '名单内没有可用序号，请检查范围 / 排除' : '排除后没有可用序号');
      return;
    }
    const n = +this.data.count || 1;
    if (n <= 0) { util.toast('抽取个数要大于 0'); return; }
    if (!this.data.dup && n > b.pool.length) {
      util.toast((b.sel.length ? '名单内可用人数 ' : '可用序号只有 ') + b.pool.length + ' 个，不能取 ' + n + ' 个（可打开「允许重复」）');
      return;
    }
    // draw-v1：seed + 记录编号先生成，算法输出可被核验页原样复算（契约 §2）
    const seed = drawproof.newSeed();
    const rid = drawproof.newRecordId();
    const res = drawproof.drawV1(seed, b.pool, n, this.data.dup);
    const names = String((store.get().draw || {}).names || '');
    const cfg = {
      range: b.lo + ' – ' + b.hi, rangeF: b.lo + '-' + b.hi, count: String(n),
      dup: this.data.dup ? '是' : '否',
      excl: b.excl.length ? b.excl.join(',') : '无',
      sort: SORT_LABEL[this.data.sort] || '按抽取顺序',
      pool: String(b.pool.length),
      sel: String(b.sel.length), selF: b.sel.join(',')
    };
    const st = {
      result: res, pool: b.pool.slice(), removed: [], log: [], cfg: cfg,
      seed: seed, rid: rid,
      proof: { status: 'pending', slow: false }      // 契约 §3.2 状态：pending | ok | failed
    };
    this._pendEvents = [];
    flow.patch('draw', st);
    flow.saveLastDraw(st);                         // 最近一次成功抽签（分组页「最近抽签」）
    this.apply(st);
    wx.showToast({ title: '抽签完成', icon: 'success', duration: 900 });
    this._createProof(st, b, n, names);
  },

  // 异步创建存证（不阻塞页面；6s 未回包按「未存证」展示，回包成功再自愈）
  _createProof(st, b, n, names) {
    const self = this;
    const rid = st.rid;
    const seq = (this._proofSeq = (this._proofSeq || 0) + 1);
    this._proofRid = rid;
    const params = drawproof.buildParams({
      lo: b.lo, hi: b.hi, count: n, dup: this.data.dup, excl: b.excl,
      sort: this.data.sort, rosterN: b.sel.length, namesN: drawproof.parseNames(names).length
    });
    const labels = drawproof.labelsOf(names, st.result);
    if (this._proofSlowT) { clearTimeout(this._proofSlowT); this._proofSlowT = null; }
    this._proofSlowT = setTimeout(function () {
      self._proofSlowT = null;
      if (self._dead || seq !== self._proofSeq) return;
      const cur = flow.getFlow().draw;
      if (!cur || cur.rid !== rid || !cur.proof || cur.proof.status !== 'pending') return;
      cur.proof = { status: 'pending', slow: true };   // 契约 §3.3：pending 超过约 6s → 未存证（不画二维码）
      flow.patch('draw', cur);
      self.applyProof(cur.proof);
    }, PROOF_SLOW_MS);
    drawproof.recordCreate({
      id: rid, params: params, pool: st.pool, result: st.result, labels: labels, seed: st.seed
    }).then(function (r) {
      if (self._dead || seq !== self._proofSeq) return;
      if (self._proofSlowT) { clearTimeout(self._proofSlowT); self._proofSlowT = null; }
      self._proofRid = '';
      const cur = flow.getFlow().draw;
      if (!cur || cur.rid !== rid) return;
      if (r && r.ok) {
        const rec = r.record || {};
        cur.proof = {
          status: 'ok',
          id: rid,
          at: drawproof.atMs(rec.at) || Date.now(),          // 服务端时间（存证时间）
          hash: String(rec.hash || ''),
          seq_day: Number(rec.seq_day) || 0,
          today_count: Number(rec.today_count != null ? rec.today_count : r.today_count) || 0,
          today_mine: Number(rec.today_mine != null ? rec.today_mine : r.today_mine) || 0,
          day: String(rec.day || '')
        };
        if (rec.event_count) cur.proof.event_count = Number(rec.event_count) || 0;
        flow.patch('draw', cur);
        self.applyProof(cur.proof);
        self._flushProofEvents();
      } else {
        cur.proof = { status: 'failed' };
        flow.patch('draw', cur);
        self.applyProof(cur.proof);
        self._pendEvents = [];
      }
    }).catch(function () {
      if (self._dead || seq !== self._proofSeq) return;
      if (self._proofSlowT) { clearTimeout(self._proofSlowT); self._proofSlowT = null; }
      self._proofRid = '';
      const cur = flow.getFlow().draw;
      if (!cur || cur.rid !== rid) return;
      cur.proof = { status: 'failed' };
      flow.patch('draw', cur);
      self.applyProof(cur.proof);
      self._pendEvents = [];
    });
  },

  // 存证状态 → data（结果区一行状态；导出图/记录入口都用同一份 proof）
  applyProof(proof) {
    if (this._dead) return;
    const ok = drawproof.proofReady(proof);
    const slow = !!(proof && proof.slow);
    const status = proof && proof.status ? String(proof.status) : '';
    this.setData({
      proofStatus: status,
      proofCls: ok ? 'ok' : ((status === 'pending' && !slow) ? 'pending' : (status ? 'fail' : '')),
      proofText: drawproof.proofLine(proof),
      proofId: ok ? String(proof.id) : ''
    });
  },

  // 事件追加（契约 §3.2）：存证在途时先入队，创建成功后补发；未存证/失败直接跳过（失败静默，不阻塞）
  _appendEvent(kind, extra) {
    const st = flow.getFlow().draw || {};
    const proof = st.proof || null;
    const body = Object.assign({ kind: kind }, extra || {});
    if (!st.rid) return;
    if (proof && proof.status === 'pending') { this._pendEvents.push(body); return; }
    if (!proof || proof.status !== 'ok') return;
    drawproof.eventAppend(Object.assign({ id: st.rid }, body)).catch(function () { /* 静默 */ });
  },
  _flushProofEvents() {
    const st = flow.getFlow().draw || {};
    const queued = this._pendEvents || [];
    this._pendEvents = [];
    if (!st.rid || !drawproof.proofReady(st.proof)) return;
    queued.forEach(function (body) {
      drawproof.eventAppend(Object.assign({ id: st.rid }, body)).catch(function () { /* 静默 */ });
    });
  },

  apply(st) {
    // 名称优先级（契约 §3.1）：映射 > 班级名单派生名（store.roster，选了参与名单才有）> ''；
    // 显示排序只改顺序，st.result 仍是 draw-v1 抽取顺序（核验复算依赖它）。
    const names = String((store.get().draw || {}).names || '');
    const rows = drawproof.rowsOf(st.result || [], names, store.get().roster || '', this.data.sort);
    this.setData({
      rows: rows,
      removed: st.removed || [],
      poolLen: st.pool ? st.pool.length : 0,
      cfg: st.cfg || null,
      state: rows.length ? 'data' : 'empty'
    });
    this.applyProof(st.proof || null);
    this._scheduleShareCard();
  },


  renderRows() { this.apply(flow.getFlow().draw || { result: this.data.rows.map(function (r) { return r.n; }) }); },

  removeAt(idx) {
    const fl = flow.getFlow();
    const st = fl.draw;
    if (!st || !st.result || idx < 0 || idx >= st.result.length) return;
    const n = st.result[idx];
    st.result.splice(idx, 1);
    st.removed = (st.removed || []).concat([n]);
    st.log = (st.log || []).concat([{ t: util.timeStr(), n: n, act: '剔除' }]);
    // 剔除后自动重抽（与网页版 #aAutoRe 同义）
    let pick = null;
    if (this.data.autoRe !== false) {
      const cfg = st.cfg || {};
      const pool = (st.pool || []).filter(function (p) {
        return (st.removed || []).indexOf(p) < 0 && (cfg.dup === '是' || (st.result || []).indexOf(p) < 0);
      });
      if (pool.length) {
        pick = pool[Math.floor(Math.random() * pool.length)];
        st.result.push(pick);
        st.log.push({ t: util.timeStr(), n: pick, act: '补抽' });
      }
    }
    flow.patch('draw', st);
    this.apply(st);
    if (st.result.length) flow.saveLastDraw(st);   // 剔除/补抽后的可用结果同步给分组页
    // 契约 §3.2：剔除 → kind:'remove', n:剔除号, added:补抽号（无自动重抽则 null）；失败静默
    this._appendEvent('remove', { n: n, added: pick });
  },
  remove(e) { this.removeAt(+e.detail.index); },

  onLongPress(e) {
    const i = +e.detail.index;
    wx.showActionSheet({
      itemList: ['剔除这个序号', '补抽一个'],
      success: (r) => {
        if (r.tapIndex === 0) this.removeAt(i);
        else if (r.tapIndex === 1) this.refill();
      }
    });
  },

  refill() {
    const fl = flow.getFlow();
    const st = fl.draw;
    if (!st) { util.toast('先抽一次签'); return; }
    const target = +((st.cfg && st.cfg.count) || this.data.count) || 1;
    const pool = st.pool || [];
    const picked = {};
    (st.result || []).forEach(function (n) { picked[n] = true; });
    const addedList = [];
    while (st.result.length < target) {
      const avail = pool.filter(function (n) { return st.cfg && st.cfg.dup === '是' ? true : !picked[n]; });
      if (!avail.length) break;
      const n = avail[Math.floor(Math.random() * avail.length)];
      st.result.push(n); picked[n] = true; addedList.push(n);
      st.log = (st.log || []).concat([{ t: util.timeStr(), n: n, act: '补抽' }]);
    }
    if (!addedList.length) util.toast('没有可补抽的序号了');
    flow.patch('draw', st);
    this.apply(st);
    if (st.result.length) flow.saveLastDraw(st);
    // 契约 §3.2：补抽 → kind:'refill', added:补抽号（逐个追加；失败静默只影响时间线）
    addedList.forEach((n) => this._appendEvent('refill', { added: n }));
  },

  reset() {
    wx.showModal({
      title: '重置抽签',
      content: '清空本次抽签结果与剔除记录？（不影响分组结果，最近抽签结果仍可在分组页沿用）',
      confirmText: '重置',
      confirmColor: '#A2543E',
      success: (r) => {
        if (!r.confirm) return;
        // 契约 §3.2：清空结果前先追加 kind:'reset'（在途事件随创建成功后补发；未存证则跳过）
        this._appendEvent('reset', {});
        flow.patch('draw', null);        // 只清当前抽签；flow.drawLast 保留给分组页
        this._pendEvents = [];
        this.setData({
          rows: [], removed: [], cfg: null, poolLen: 0, state: 'empty',
          proofStatus: '', proofCls: '', proofText: '', proofId: ''
        });
        util.toast('已重置本轮抽签');
      }
    });
  },

  /* ---------------- 记录入口（契约 §3.2：「抽签记录」→ pages/drawrec） ---------------- */
  openRecords() { wx.navigateTo({ url: '/pages/drawrec/drawrec' }); },
  openRecordDetail() {
    if (!this.data.proofId) return;
    wx.navigateTo({ url: '/pages/drawrec/drawrec?id=' + encodeURIComponent(this.data.proofId) });
  },

  /* ---------------- 导出图片（契约 §3.3：rec = 存证 id、参数区存证信息、二维码 = 核验链接） ---------------- */
  // 返回 canvas.exportAndSave 的 opt（纯数据，单测可直接断言：编号/参数行/二维码/明细文本块）
  buildExportOpt() {
    const cfg = this.data.cfg || {};
    const st = flow.getFlow().draw || {};
    const proof = st.proof || null;
    const ready = drawproof.proofReady(proof);
    const lines = drawproof.removeLogLines(st.log || [], 8);
    const blocks = [{
      label: '抽中结果（' + this.data.rows.length + '）',
      chips: this.data.rows.map(function (r) { return { n: r.n, nm: r.nm || '' }; })
    }];
    // 契约 §3.3：剔除重抽明细改放纯文本块（qrNote 已被存证信息占用）；最多 8 行，超出省略
    if (lines.length) blocks.push({ label: '剔除重抽', lines: lines });
    else if (this.data.removed.length) blocks.push({ label: '已剔除（' + this.data.removed.length + '）', lines: [this.data.removed.join('、')] });
    const selN = cfg.sel != null ? String(cfg.sel) : String(this.data.selCount || 0);
    const config = [
      ['抽签 · 范围', cfg.range || '-'],
      ['抽签 · 个数', cfg.count || '-'],
      ['抽签 · 允许重复', cfg.dup || '-'],
      ['抽签 · 排除', cfg.excl || '-'],
      ['抽签 · 排序', cfg.sort || '-'],
      ['抽签 · 参与名单', selN === '0' ? '未选择 · 只抽序号' : ('已选 ' + selN + ' 人 · 只从名单中抽')]
    ];
    // 契约 §3.1：N>0 时导出参数加「名称映射 N 项」（以已保存的映射为准，避免页面 data 过期）
    const namesN = drawproof.parseNames(String((store.get().draw || {}).names || '')).length;
    if (namesN > 0) config.push(['名称映射', namesN + ' 项']);
    drawproof.proofConfigLines(proof).forEach(function (kv) { config.push(kv); });
    const opt = {
      title: '抽签结果',
      sub: cfg.range ? ('范围 ' + cfg.range) : '',
      config: config,
      blocks: blocks,
      foot: '生成时间 ' + util.timeStr(),
      rec: ready ? String(proof.id) : util.recId('DRAW')     // 已存证 = 存证编号；未存证回退本机编号
    };
    if (ready) {
      opt.qr = drawproof.verifyUrl(proof.id);
      opt.qrTitle = '抽签存证核验';
      opt.qrCap = '扫码核验本次抽签记录（需登录班级身份）';
      opt.qrNote = drawproof.proofQrNote(proof);
    }
    return opt;
  },
  exportImg() {
    if (!this.data.rows.length) { util.toast('先抽签再分享'); return; }
    const st = flow.getFlow().draw || {};
    if (!drawproof.proofReady(st.proof)) util.toast('本次未存证，图片无法核验');
    canvas.exportAndSave(this, '#card', this.buildExportOpt());
  },
  onPageScroll(e) { scrollmem.onScroll(this, e); },

  /* ---------------- 原生分享（2026-11-19）：结果页可见按钮 + 具体标题 + 存证深链 ----------------
   * - 有存证：path=/pages/drawrec/drawrec?id=<存证 id>（点击卡片直达只读存证详情）
   * - 无存证：path=/pages/draw/draw（带明确标题，至少不是泛品牌文案）
   * - 5:4 图：结果渲染后异步 canvas 生成，失败/未就绪回退 images/share/draw.png（onShareAppMessage 必须同步返回）
   */
  _shareInfo() {
    const st = flow.getFlow().draw || {};
    const ready = drawproof.proofReady(st.proof);
    const n = (this.data.rows || []).length;
    const cfg = this.data.cfg || {};
    let title = n ? ('抽签结果 · ' + n + ' 个') : '抽签｜抽号 · 存证 · 分享';
    if (n && cfg.range) title += '（' + cfg.range + (cfg.dup === '是' ? ' · 可重复' : '') + '）';
    if (ready && st.proof && st.proof.id) {
      return { title: title, path: '/pages/drawrec/drawrec', query: 'id=' + encodeURIComponent(String(st.proof.id)) };
    }
    return { title: title, path: '/pages/draw/draw', query: '' };
  },
  // 2026-11-20 分享弹层：5:4 卡片封面 + 完整导出长图（图片分享）
  _shareOpenOpts() {
    if (!(this.data.rows || []).length) { util.toast('先抽签再分享'); return null; }
    const st = flow.getFlow().draw || {};
    return {
      title: this._shareInfo().title,
      view: sharecard.buildDrawView({
        rows: this.data.rows,
        cfg: this.data.cfg,
        proofReady: drawproof.proofReady(st.proof),
        proofId: st.proof && st.proof.id,
        time: util.timeStr()
      }),
      posterOpt: this.buildExportOpt()
    };
  },
  openShare() { shareflow.open(this, this._shareOpenOpts()); },
  closeShare() { shareflow.close(this); },
  shareImage() { shareflow.shareImage(this); },
  _scheduleShareCard() {
    if (this._shareT) { clearTimeout(this._shareT); this._shareT = null; }
    if (!(this.data.rows || []).length) { this._shareImg = ''; this._shareSig = ''; return; }
    const self = this;
    this._shareT = setTimeout(function () {
      self._shareT = null;
      self._makeShareCard();
    }, 180);
  },
  _makeShareCard() {
    if (this._dead || !(this.data.rows || []).length) return;
    const st = flow.getFlow().draw || {};
    const view = sharecard.buildDrawView({
      rows: this.data.rows,
      cfg: this.data.cfg,
      proofReady: drawproof.proofReady(st.proof),
      proofId: st.proof && st.proof.id,
      time: util.timeStr()
    });
    const sig = sharecard.signature(view);
    if (sig === this._shareSig && this._shareImg) return;
    this._shareSig = sig;
    const self = this;
    sharecard.render(this, 'shareCanvas', view).then(function (p) {
      if (!self._dead && p) self._shareImg = p;
    }).catch(function () { /* 画图失败：分享继续用静态封面 */ });
  },
  onShareAppMessage() {
    const info = this._shareInfo();
    return share.message({
      title: info.title,
      path: info.path,
      query: info.query,
      imageUrl: this.data.shareImg || this._shareImg || sharecard.FALLBACK.draw
    });
  },
  onShareTimeline() {
    const info = this._shareInfo();
    return share.timeline({
      title: info.title,
      query: info.query,
      imageUrl: this.data.shareImg || this._shareImg || sharecard.FALLBACK.draw
    });
  }
}));
