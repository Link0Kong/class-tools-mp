// pages/sum/sum.js —— 第 3 步：结果单（抽签 + 分组汇总，可复制 / 导图）
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');
const flow = require('../../utils/flow.js');
const canvas = require('../../utils/canvas.js');
const identity = require('../../utils/identity.js');
const share = require('../../utils/share.js');
const agent = require('../../utils/agent.js');
const scrollmem = require('../../utils/scrollmem.js');

Page({
  data: {
    state: 'loading',
    errorText: '',
    cfg: [], viewBlocks: [], text: '', sub: '', showCfg: false,
    steps: [
      { id: 's1', label: '抽签', done: false },
      { id: 's2', label: '分组', done: false },
      { id: 's3', label: '结果单', done: false }
    ]
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
    this.applyAgentHandoff();
    if (this._first) {
      this._first = false;
      this.setData({ state: 'loading' });
      this._t = setTimeout(() => { this._t = null; this.build(); }, 140);
    } else {
      this.build();
    }
  },
  onHide() {
    scrollmem.save(this); if (this._t) { clearTimeout(this._t); this._t = null; } },
  onUnload() {
    scrollmem.save(this); if (this._t) { clearTimeout(this._t); this._t = null; } },
  onPullDownRefresh() { this.build(); wx.stopPullDownRefresh(); },

  // —— AI 页面接力（step=3）：结果单从 zq_flow 渲染；payload 只在本机 flow 缺失时兜底 ——
  applyAgentHandoff() {
    if (this._agentApplied) return false;
    this._agentApplied = true;
    const h = this._agent;
    const p = (h && h.payload) || {};
    const q = Object.assign({}, this._agentQ || {}, (h && h.query) || {});
    if (!h && !this._agentQ) return false;
    this._hoStep = parseInt(q.step, 10) || 3;
    try {
      const fl = flow.getFlow();
      const d = (p.draw && typeof p.draw === 'object') ? p.draw : null;
      if (d && Array.isArray(d.result) && !(fl.draw && fl.draw.result)) flow.patch('draw', d);
      else if (Array.isArray(p.items) && !(fl.draw && fl.draw.result)) {
        const result = p.items.map(function (x) {
          return (x && typeof x === 'object') ? Number(x.number != null ? x.number : x.n) : Number(x);
        }).filter(function (n) { return isFinite(n); });
        if (result.length) flow.patch('draw', { result: result, pool: [], removed: [], log: [], cfg: (p.cfg && typeof p.cfg === 'object') ? p.cfg : null });
      }
      const g = (p.group && typeof p.group === 'object') ? p.group : null;
      if (g && Array.isArray(g.result) && !(fl.group && fl.group.result)) flow.patch('group', g);
    } catch (e) { /* payload 渲染失败保留本机已有结果单 */ }
    return true;
  },

  build() {
    try {
      const fl = flow.getFlow();
      const rm = util.rosterMap(store.get().roster).m;
      const rn = Object.keys(rm).length;
      const docs = [];
      let drawBlock = null;
      let groupBlocks = null;

      if (fl.draw && fl.draw.result) {
        const A = fl.draw, c = A.cfg || {};
        docs.push(['抽签 · 范围', c.range], ['抽签 · 个数', c.count], ['抽签 · 允许重复', c.dup],
          ['抽签 · 排除', c.excl], ['抽签 · 排序', c.sort]);
        if (rn) docs.push(['抽签 · 名单对应', '已启用（' + rn + ' 人）']);
        const runs = [];
        const items = [];
        A.result.forEach(function (n) {
          const nm = rm[n];
          if (nm) { runs.push({ t: String(n) + ' ', dim: true }); runs.push({ t: nm + '  ', strong: true, glue: true }); }
          else runs.push({ t: String(n) + '  ' });
          items.push({ n: n, nm: nm || '', k: items.length });
        });
        if (A.removed && A.removed.length) docs.push(['抽签 · 剔除', A.removed.join(',')]);
        drawBlock = { label: '抽签结果（' + A.result.length + ' 个）', mono: false, lines: [runs], items: items };
      }

      if (fl.group && fl.group.result) {
        const G = fl.group, c = G.cfg || {};
        docs.push(['分组 · 成员来源', c.source], ['分组 · 方式', c.mode], ['分组 · 人数', c.total],
          ['分组 · 组数', c.groups], ['分组 · 成员分配', c.inner]);
        groupBlocks = G.result.map(function (gp, i) {
          const runs = [];
          const items = [];
          gp.forEach(function (m) {
            if (m.nm && m.n != null) { runs.push({ t: String(m.n) + ' ', dim: true }); runs.push({ t: m.nm + '   ', strong: true, glue: true }); }
            else if (m.nm) runs.push({ t: m.nm + '   ', strong: true });
            else runs.push({ t: String(m.n) + '   ' });
            items.push({ n: m.n == null ? '' : m.n, nm: m.nm || '', k: items.length });
          });
          return { label: '第 ' + (i + 1) + ' 组（' + gp.length + ' 人）', mono: false, lines: [runs], items: items };
        });
      }

      const apiBlocks = [];
      const viewBlocks = [];
      if (drawBlock) {
        // v2 导图：抽签用 chips、分组用 groups（页面内展示仍走 viewBlocks）
        apiBlocks.push({
          label: drawBlock.label,
          chips: drawBlock.items.map(function (it) { return { n: it.n, nm: it.nm || '' }; })
        });
        viewBlocks.push({ label: drawBlock.label, items: drawBlock.items });
      }
      if (groupBlocks) {
        apiBlocks.push({
          label: '分组结果',
          groups: groupBlocks.map(function (b) {
            return b.items.map(function (it) { return { n: it.n, nm: it.nm || '' }; });
          })
        });
        groupBlocks.forEach(function (b) { viewBlocks.push({ label: b.label, items: b.items }); });
      }

      const hasData = apiBlocks.length > 0;
      const textLines = docs.map(function (kv) { return kv[0] + '：' + kv[1]; });
      let text = textLines.join('\n');
      if (drawBlock) text += '\n\n' + drawBlock.lines[0].map(function (r) { return r.t; }).join('');
      if (groupBlocks) {
        groupBlocks.forEach(function (b) {
          text += '\n\n' + b.label + '\n' + b.lines[0].map(function (r) { return r.t; }).join('');
        });
      }

      let sub = '';
      if (fl.draw && fl.draw.cfg) sub = '范围 ' + fl.draw.cfg.range;
      if (fl.group && fl.group.cfg) sub = (sub ? sub + ' · ' : '') + fl.group.cfg.groups + ' 组';

      this.setData({
        state: hasData ? 'data' : 'empty',
        errorText: '',
        cfg: docs.map(function (kv) { return { k: kv[0], v: kv[1] }; }),
        viewBlocks: viewBlocks,
        text: text,
        sub: sub,
        _api: apiBlocks
      });
      this.syncSteps();
    } catch (e) {
      this.setData({ state: 'error', errorText: '汇总失败：' + ((e && e.message) || e) });
    }
  },


  // 步骤条完成态（只读 flow，不改动任何业务数据）
  syncSteps() {
    const fl = flow.getFlow();
    const drawN = (fl.draw && fl.draw.result) ? fl.draw.result.length : 0;
    const grpN = (fl.group && fl.group.result) ? fl.group.result.length : 0;
    this.setData({
      steps: [
        { id: 's1', label: '抽签', done: drawN > 0 },
        { id: 's2', label: '分组', done: grpN > 0 },
        { id: 's3', label: '结果单', done: !!(drawN && grpN) }
      ]
    });
  },

  toggleCfg() { this.setData({ showCfg: !this.data.showCfg }); },

  copyText() {
    if (!this.data.viewBlocks.length) { util.toast('暂无内容'); return; }
    util.copyText(this.data.text);
  },

  exportImg() {
    if (!this.data.viewBlocks.length) { util.toast('先完成抽签或分组'); return; }
    canvas.exportAndSave(this, '#card', {
      title: '班级工具 · 结果单',
      sub: this.data.sub,
      config: this.data.cfg.map(function (kv) { return [kv.k, kv.v]; }),
      blocks: this.data._api || [],
      foot: '生成时间 ' + util.timeStr(),
      rec: util.recId('SUM')
    });
  },

  onStep(e) {
    const i = e.detail.index;
    if (i === 1) this.goDraw();
    else if (i === 2) this.goGroup();
  },
  goDraw() { util.backTo('pages/draw/draw'); },
  goGroup() { util.backTo('pages/group/group'); },
  onPageScroll(e) { scrollmem.onScroll(this, e); },
  onShareAppMessage() {
    return share.message({
      title: '抽签分组结果单｜可复制 · 可导出图片',
      path: '/pages/sum/sum',
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '抽签分组结果单｜可复制 · 可导出图片',
      imageUrl: '/images/share/default.png'
    });
  }
});
