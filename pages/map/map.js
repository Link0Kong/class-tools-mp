// pages/map/map.js — 校内地图（原生 Canvas 2.5D，可旋转/缩放/楼层/路线）
const DATA = require('../../data/campus_map.js');
const share = require('../../utils/share.js');

const CX = DATA.vb[0] / 2;
const CY = DATA.vb[1] / 2;
// WGS84 -> master 像素（OSM 图书馆/第一食堂/动物实验中心 拟合）
Page({
  data: {
    query: '',
    sel: null,
    routeText: '',
    routeMeta: '',
    loading: true,
    mode: 'iso'
  },

  onLoad(options) {
    try { share.enable(); } catch (e) {}
    this._room = options && options.room ? decodeURIComponent(options.room) : '';
    this._view = { scale: 1, ox: 0, oy: 0, zoom: 1, yaw: -0.55, pitch: 0.55, flat: false };
    this._dpr = 1; this._w = 0; this._h = 0;
    this._touches = {}; this._pinch = null; this._start = null; this._moved = 0;
  },

  onReady() { this.initCanvas(); },

  initCanvas() {
    const q = wx.createSelectorQuery().in(this);
    q.select('#map').fields({ node: true, size: true, rect: true }).exec(res => {
      const item = res && res[0];
      if (!item || !item.node) { this.setData({ loading: false }); return; }
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const dpr = Math.min(info.pixelRatio || 1, 3);
      const canvas = item.node;
      canvas.width = item.width * dpr;
      canvas.height = item.height * dpr;
      this._canvas = canvas;
      this._ctx = canvas.getContext('2d');
      this._dpr = dpr; this._w = item.width; this._h = item.height;
      this._rect = { left: item.left || 0, top: item.top || 0 };
      this.fit();
      this.setData({ loading: false });
      if (this._room) this.pickRoom(this._room);
      else { var d = this.findBuilding("自强楼"); if (d) this.selectBuilding(d, true); }
    });
  },

  /* ---------- 投影：世界 (x,y,z) -> 屏幕 ---------- */
  proj(x, y, z) {
    const v = this._view;
    const dx = x - CX, dy = y - CY;
    const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
    const rx = dx * cy - dy * sy;
    const ry = dx * sy + dy * cy;
    const s = v.scale * v.zoom;
    return [v.ox + rx * s, v.oy + (ry * Math.sin(v.pitch) - (z || 0) * Math.cos(v.pitch)) * s];
  },

  unproj(sx, sy) {
    const v = this._view, s = v.scale * v.zoom;
    const rx = (sx - v.ox) / s;
    const ry = (sy - v.oy) / (s * Math.sin(v.pitch));
    const cy = Math.cos(v.yaw), syaw = Math.sin(v.yaw);
    return [CX + rx * cy + ry * syaw, CY - rx * syaw + ry * cy];
  },

  palette(b) {
    const g = b.g || '', k = b.k || '', n = b.n || '';
    if (k.indexOf('图书馆') >= 0 || n.indexOf('图书馆') >= 0) return { roof: '#A9C4D8', wall: '#D7E3EB', ink: '#4E6B87' };
    if (g === 'academic') return { roof: '#9FC0B0', wall: '#D6E8DE', ink: '#3E6B5E' };
    if (g === 'residential') return { roof: '#D8BE99', wall: '#EADAC2', ink: '#7C6A52' };
    if (g === 'sports') return { roof: '#A8C58E', wall: '#D9E7C4', ink: '#55734C' };
    if (g === 'landscape') return { roof: '#B9CF9E', wall: '#DFE9CF', ink: '#5F7A4E' };
    return { roof: '#A9B9CC', wall: '#DDE5EC', ink: '#52677A' };
  },

  fit() {
    const v = this._view;
    const pts = [[0, 0], [DATA.vb[0], 0], [DATA.vb[0], DATA.vb[1]], [0, DATA.vb[1]]];
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    const save = { scale: v.scale, ox: v.ox, oy: v.oy };
    v.scale = 1; v.ox = 0; v.oy = 0; v.zoom = 1;
    pts.concat([[DATA.vb[0] / 2, DATA.vb[1] / 2]]).forEach(p => {
      [0, 26].forEach(z => {
        const q = this.proj(p[0], p[1], z);
        minx = Math.min(minx, q[0]); maxx = Math.max(maxx, q[0]);
        miny = Math.min(miny, q[1]); maxy = Math.max(maxy, q[1]);
      });
    });
    v.scale = Math.max(this._w / (maxx - minx), this._h / (maxy - miny)) * 1.02;
    v.zoom = 1;
    v.ox = this._w / 2 - ((minx + maxx) / 2) * v.scale;
    v.oy = this._h / 2 - ((miny + maxy) / 2) * v.scale;
    this.draw();
  },

  scheduleDraw() {
    if (this._rafPending) return;
    this._rafPending = true;
    setTimeout(() => { this._rafPending = false; this.draw(); }, 16);
  },

  /* ---------- 绘制 ---------- */
  poly(pts, z) {
    const ctx = this._ctx;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const q = this.proj(p[0], p[1], z || 0);
      if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
    });
    ctx.closePath();
  },

  draw() {
    const ctx = this._ctx;
    if (!ctx) return;
    const dpr = this._dpr, w = this._w, h = this._h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#F3F5EC'; ctx.fillRect(0, 0, w, h);

    // 地面
    this.poly([[0, 0], [DATA.vb[0], 0], [DATA.vb[0], DATA.vb[1]], [0, DATA.vb[1]]], 0);
    ctx.fillStyle = '#E9EFD9'; ctx.fill();
    ctx.strokeStyle = 'rgba(140,160,125,.3)'; ctx.lineWidth = 1; ctx.stroke();

    // 水系
    DATA.water.forEach(f => {
      this.poly(f.p, 0);
      ctx.fillStyle = '#CFE7F2'; ctx.fill();
      ctx.strokeStyle = 'rgba(100,150,175,.45)'; ctx.lineWidth = 1; ctx.stroke();
    });

    // 道路
    DATA.roads.forEach(r => {
      if (!r.p || r.p.length < 2) return;
      ctx.beginPath();
      r.p.forEach((p, i) => { const q = this.proj(p[0], p[1], 0.12); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      ctx.strokeStyle = '#D8CBB4'; ctx.lineWidth = Math.max(2.4, (r.w || 2.4) * this._view.scale * this._view.zoom * 1.6); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.strokeStyle = '#F7EFDF'; ctx.lineWidth = Math.max(1.2, (r.w || 2.4) * this._view.scale * this._view.zoom * 0.95); ctx.stroke();
    });

    // 建筑投影阴影
    DATA.buildings.forEach(b => {
      if (!b.p || b.p.length < 3) return;
      ctx.save(); ctx.translate(3.5, 5.5);
      this.poly(b.p, 0);
      ctx.fillStyle = 'rgba(45,60,45,.10)'; ctx.fill();
      ctx.restore();
    });

    // 建筑体块（画家算法）
    const faces = [];
    DATA.buildings.forEach(b => {
      const fp = b.p || [];
      if (fp.length < 3) return;
      const c = this.proj(b.x, b.y, 0);
      if (c[0] < -120 || c[0] > this._w + 120 || c[1] < -120 || c[1] > this._h + 120) return;
      if (b.fl === 0 || (b.n || '').indexOf('田径场') >= 0) {
        // 场地：平面 + 浅色
        faces.push({ d: (b.x + b.y) / 2, type: 'flat', b: b, fp: fp });
        return;
      }
      if (this._view.flat) {
        faces.push({ d: (b.x + b.y) / 2, type: 'flat', b: b, fp: fp });
        return;
      }
      const zTop = b.h || (b.fl || 5) * 3.05;
      for (let i = 0; i < fp.length; i++) {
        const a = fp[i], c = fp[(i + 1) % fp.length];
        faces.push({ d: (a[0] + c[0] + a[1] + c[1]) / 4, type: 'side', b: b, a: a, c: c, z: zTop });
      }
      let sx = 0, sy = 0;
      fp.forEach(p => { sx += p[0]; sy += p[1]; });
      faces.push({ d: (sx / fp.length + sy / fp.length) / 2 + zTop * 0.2, type: 'top', b: b, fp: fp, z: zTop });
    });
    faces.sort((a, b) => a.d - b.d);
    faces.forEach(f => {
      const b = f.b;
      const sel = this.data.sel && this.data.sel.id === b.id;
      const track = b.fl === 0 || (b.n || '').indexOf('田径场') >= 0;
      const col = this.palette(b);
      if (f.type === 'flat') {
        this.poly(f.fp, track ? 0.1 : 0.05);
        ctx.fillStyle = sel ? '#4E9082' : (track ? '#D9E7C4' : col.wall);
        ctx.strokeStyle = sel ? '#2E6B5E' : '#B9A487';
        ctx.lineWidth = sel ? 2 : 0.8;
        ctx.fill(); ctx.stroke();
        return;
      }
      if (f.type === 'side') {
        const p = [this.proj(f.a[0], f.a[1], 0), this.proj(f.c[0], f.c[1], 0), this.proj(f.c[0], f.c[1], f.z), this.proj(f.a[0], f.a[1], f.z)];
        ctx.beginPath();
        p.forEach((q, i) => { if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
        ctx.closePath();
        ctx.fillStyle = sel ? '#CFE6DD' : (track ? '#D9E7C4' : col.wall);
        ctx.strokeStyle = sel ? 'rgba(46,107,94,.8)' : 'rgba(100,80,58,.30)';
        ctx.lineWidth = sel ? 1.2 : 0.65;
        ctx.fill(); ctx.stroke();
      } else {
        this.poly(f.fp, f.z);
        ctx.fillStyle = sel ? '#4E9082' : (track ? '#D9E7C4' : col.roof);
        ctx.strokeStyle = sel ? '#2E6B5E' : '#B9A487';
        ctx.lineWidth = sel ? 1.8 : 0.8;
        ctx.fill(); ctx.stroke();
      }
    });

    // 路线（建筑之后，保证可见）
    if (this.data.sel && DATA.routes[this.data.sel.id]) {
      const rt = DATA.routes[this.data.sel.id];
      ctx.beginPath();
      rt.p.forEach((p, i) => { const q = this.proj(p[0], p[1], 0.6); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      ctx.strokeStyle = 'rgba(78,144,130,.95)'; ctx.lineWidth = 3.2; ctx.setLineDash([7, 6]); ctx.lineCap = 'round'; ctx.stroke(); ctx.setLineDash([]);
    }

    // 校门
    const gate = this.proj(DATA.gate[0], DATA.gate[1], 0.4);
    ctx.beginPath(); ctx.arc(gate[0], gate[1], 4, 0, Math.PI * 2); ctx.fillStyle = '#4E9082'; ctx.fill();

    // 选中楼标签
    if (this.data.sel) {
      const b = DATA.buildings.find(x => x.id === this.data.sel.id);
      if (b) {
        const p = this.proj(b.x, b.y, (b.h || 8) + 3);
        const text = b.n || '建筑';
        ctx.font = '600 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(247,248,244,.96)';
        ctx.strokeText(text, p[0], p[1]); ctx.fillStyle = '#23302E'; ctx.fillText(text, p[0], p[1]);
      }
    }
  },

  /* ---------- 交互 ---------- */
  pt(t) {
    if (t.x != null) return { x: t.x, y: t.y };
    const r = this._rect || { left: 0, top: 0 };
    return { x: (t.clientX || 0) - r.left, y: (t.clientY || 0) - r.top };
  },

  findBuilding(q) {
    q = String(q || '').trim();
    if (!q) return null;
    let b = DATA.buildings.find(x => x.id === q || x.n === q);
    if (b) return b;
    const m = q.match(/^(\d{2})/);
    if (m) {
      const no = String(parseInt(m[1], 10));
      b = DATA.buildings.find(x => String(x.no || '').replace(/^0+/, '') === no);
      if (b) return b;
    }
    return DATA.buildings.find(x => (x.n || '').indexOf(q) >= 0) || null;
  },

  pickRoom(room) { const b = this.findBuilding(room); if (b) this.selectBuilding(b); },

  selectBuilding(b, center) {
    const rt = DATA.routes[b.id];
    this.setData({
      sel: { id: b.id, n: b.n || '建筑', fl: b.fl || 0, no: b.no || '', x: b.x, y: b.y },
      routeText: rt ? (rt.r || []).join(' → ') : '',
      routeMeta: rt ? ('约 ' + rt.t + ' 分钟 · ' + Math.round(rt.m) + ' m') : '暂无步行路线'
    });
    if (center && this._w) {
      const p = this.proj(b.x, b.y, 0);
      this._view.ox += this._w / 2 - p[0];
      this._view.oy += this._h / 2 - p[1];
    }
    this.draw();
  },

  hit(sx, sy) {
    let best = null, bd = 1e9;
    DATA.buildings.forEach(b => {
      if (!b.p || b.p.length < 3) return;
      const pts = b.p.map(p => this.proj(p[0], p[1], (b.h || 0) * 0.5));
      if (pointInPoly(sx, sy, pts)) {
        const c = this.proj(b.x, b.y, 0);
        const d = Math.hypot(c[0] - sx, c[1] - sy);
        if (d < bd) { bd = d; best = b; }
      }
    });
    if (!best) {
      DATA.buildings.forEach(b => {
        const c = this.proj(b.x, b.y, 0);
        const d = Math.hypot(c[0] - sx, c[1] - sy);
        if (d < 18 && d < bd) { bd = d; best = b; }
      });
    }
    return best;
  },

  onSearch(e) { this.setData({ query: e.detail.value }); },
  doSearch() {
    const b = this.findBuilding(this.data.query);
    if (!b) { wx.showToast({ title: '没找到这栋楼', icon: 'none' }); return; }
    this.selectBuilding(b, true);
  },
  tapBuilding(e) {
    if (this._moved > 7) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const q = this.pt(t);
    const b = this.hit(q.x, q.y);
    if (b) this.selectBuilding(b);
  },
  clearRoute() { this.setData({ sel: null, routeText: '', routeMeta: '' }); this.draw(); },
  openTT() { wx.navigateTo({ url: '/pages/tt/tt' }); },
  resetView() { this._view.yaw = -0.55; this._view.pitch = 0.55; this._view.flat = false; this.setData({ mode: 'iso' }); this.fit(); },
  toggleMode() {
    const flat = !this._view.flat;
    this._view.flat = flat;
    this._view.pitch = flat ? 0.999 : 0.55;
    this.setData({ mode: flat ? 'flat' : 'iso' });
    this.fit();
  },
  rotateL() { this._view.yaw -= Math.PI / 12; this.draw(); },
  rotateR() { this._view.yaw += Math.PI / 12; this.draw(); },

  onTouchStart(e) {
    this._moved = 0;
    const ts = e.touches || [];
    this._touches = {};
    ts.forEach(t => { this._touches[t.identifier] = this.pt(t); });
    if (ts.length >= 2) {
      const a = this.pt(ts[0]), b = this.pt(ts[1]);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const wp = this.unproj(mx, my);
      this._pinch = {
        d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        zoom: this._view.zoom, mx: mx, my: my,
        wx: wp[0], wy: wp[1]
      };
      this._start = null;
    } else if (ts.length === 1) {
      const q0 = this.pt(ts[0]);
      this._start = { x: q0.x, y: q0.y, yaw: this._view.yaw, pitch: this._view.pitch };
    }
  },

  onTouchMove(e) {
    const ts = e.touches || [];
    this._moved += 1;
    if (ts.length >= 2 && this._pinch) {
      const a = this.pt(ts[0]), b = this.pt(ts[1]);
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const p = this._pinch;
      this._view.zoom = Math.max(0.35, Math.min(4, p.zoom * d / p.d));
      // 让捏合中点下的地面点保持在手指中点
      const q = this.proj(p.wx, p.wy, 0);
      this._view.ox += mx - q[0];
      this._view.oy += my - q[1];
      this.scheduleDraw();
      return;
    }
    if (ts.length === 1 && this._start) {
      const t = this.pt(ts[0]);
      const dx = t.x - this._start.x, dy = t.y - this._start.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        // 与网页一致：单指水平旋转、垂直俯仰
        this._view.yaw = this._start.yaw - dx * 0.0045;
        this._view.pitch = Math.max(0.30, Math.min(1.552, this._start.pitch + dy * 0.003));
        this.scheduleDraw();
      }
    }
  },

  onTouchEnd(e) { this._pinch = null; this._start = null; this.tapBuilding(e); },

  onShareAppMessage() {
    return { title: '福建中医药大学旗山校区 2.5D 地图', path: '/pages/map/map' };
  },
  onShareTimeline() {
    return { title: '福建中医药大学旗山校区 2.5D 地图', query: '' };
  }
});
