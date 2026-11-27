const DATA = require('./campus_map.js');
const campus = require('./campus_logic.js');
const share = require('../../utils/share.js');
const appearance = require('../../utils/appearance.js');

const CX = DATA.vb[0] / 2;
const CY = DATA.vb[1] / 2;
const BY_ID = Object.fromEntries(DATA.buildings.map(building => [building.id, building]));
const LANDMARKS = ['图书馆', '自强楼', '厚德楼', '食堂', '田径场'];
const COLORS = {
  light: { bg: '#EDF1E7', water: '#B3D7E5', bank: '#89B8CA', road: '#FCF5E6', edge: '#C9C4B3',
    fill: '#CAD4C7', wall: '#E6EBE2', selected: '#66AD96', route: '#176E5A', ink: '#304B41', halo: '#FAFCF5' },
  dark: { bg: '#1C2823', water: '#315867', bank: '#517D8C', road: '#5D6255', edge: '#414C43',
    fill: '#576E61', wall: '#3C5146', selected: '#43937A', route: '#9CE6C8', ink: '#E3EEE6', halo: '#132620' }
};
const BUILDING_COLORS = {
  教学楼: ['#BCD7C5', '#E2EDE2', '#557A68', '#435B51'],
  图书馆: ['#B1CDDE', '#DDE8EE', '#526F83', '#3C535F'],
  宿舍: ['#DBC4A0', '#EEE2CD', '#8A7356', '#635644'],
  科研: ['#CCC5DA', '#E9E3EE', '#6A6382', '#514D61'],
  运动: ['#AFCAA0', '#DBE7D3', '#58764C', '#445A3D']
};

const DIRECTORY = campus.directory(DATA);
const WALK = campus.routePlanner(DATA.walk);
const ORIGINS = Object.entries(DATA.walk.origins).map(([id, name]) => ({id, name}));

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

Page({
  data: {
    query: '', results: [], searched: false,
    sel: null, room: '', subtitle: '', routeText: '', routeMeta: '',
    details: false, origin: 'south', origins: ORIGINS, floorOpen: false, floors: [], floor: 0, rooms: [],
    orgs: [], orgIndex: 0, hasPlan: false, activeRoom: '', roomInfo: '',
    loading: true, failed: false, mode: 'iso'
  },

  onLoad(options) {
    share.enable();
    this._target = String(options && options.room || '');
    try { this._target = decodeURIComponent(this._target); } catch (e) {}
    this._alive = true;
    this._home = true;
    this._w = this._h = 0;
    this._view = { scale: 1, x: 0, y: 0, zoom: 1, yaw: 0, pitch: .77 };
    this.setAngles(0, .77);
  },

  onReady() { this.measureCanvas(); },
  onShow() {
    this._systemDark = appearance.resolved() === 'dark';
    this.scheduleDraw();
  },
  onResize() { this.measureCanvas(); if (this.data.hasPlan) this.measurePlan(); },
  onUnload() { this._alive = false; clearTimeout(this._measureTimer); },

  measureCanvas(retry = 0) {
    if (!this._alive) return;
    clearTimeout(this._measureTimer);
    const seq = (this._measureSeq || 0) + 1;
    this._measureSeq = seq;
    wx.createSelectorQuery().in(this).select('#map').fields({ node: true, size: true, rect: true }).exec(items => {
      if (!this._alive || seq !== this._measureSeq) return;
      const item = items && items[0];
      if (!item || !item.node || !item.width || !item.height) {
        if (retry < 5) this._measureTimer = setTimeout(() => this.measureCanvas(retry + 1), 150);
        else this.setData({ loading: false, failed: true });
        return;
      }
      const first = !this._ctx;
      this._rect = { x: item.left || 0, y: item.top || 0 };
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const dpr = Math.min(info.pixelRatio || 1, 2, Math.sqrt(2100000 / (item.width * item.height)));
      if (!first && this._w === item.width && this._h === item.height && this._dpr === dpr) return;
      const anchor = first ? null : this.unproject(this._w / 2, this._h / 2);
      this._w = item.width;
      this._h = item.height;
      this._dpr = dpr;
      this._canvas = item.node;
      this._canvas.width = Math.max(1, Math.round(this._w * dpr));
      this._canvas.height = Math.max(1, Math.round(this._h * dpr));
      this._ctx = this._canvas.getContext('2d');
      if (!this._ctx) { this.setData({ loading: false, failed: true }); return; }
      if (!anchor || this._home) this.resetView();
      else {
        this.fitBase();
        this.anchor(anchor, this._w / 2, this._h / 2);
      }
      this.setData({ loading: false, failed: false });
      if (first && this._target) {
        const matches = DIRECTORY.search(this._target);
        const target = matches[0];
        if (target) {
          if (matches.length === 1 || !target.item) this.openTarget(target);
          else this.search(this._target);
        } else wx.showToast({ title: '地图未收录该教室', icon: 'none' });
      }
      this.scheduleDraw();
    });
  },

  retryCanvas() { this.setData({ loading: true, failed: false }); this.measureCanvas(); },

  setAngles(yaw, pitch) {
    this._view.yaw = yaw;
    this._view.pitch = pitch;
    this._cy = Math.cos(yaw);
    this._sy = Math.sin(yaw);
    this._sp = Math.sin(pitch);
    this._cp = Math.cos(pitch);
  },

  raw(x, y, z = 0) {
    const dx = x - CX, dy = y - CY;
    const depth = dx * this._sy + dy * this._cy;
    return [dx * this._cy - dy * this._sy, depth * this._sp - z * this._cp, depth * this._cp + z * this._sp];
  },
  project(x, y, z) {
    const v = this._view, q = this.raw(x, y, z), scale = v.scale * v.zoom;
    return [v.x + q[0] * scale, v.y + q[1] * scale, q[2]];
  },
  unproject(x, y) {
    const v = this._view, scale = v.scale * v.zoom;
    const rx = (x - v.x) / scale, ry = (y - v.y) / (scale * this._sp);
    return [CX + rx * this._cy + ry * this._sy, CY - rx * this._sy + ry * this._cy];
  },
  anchor(point, x, y, z) {
    const p = this.project(point[0], point[1], z);
    this._view.x += x - p[0];
    this._view.y += y - p[1];
  },
  heightOf(b) {
    return this.data.mode === 'flat' || b.n === '田径场' ? 0 : (b.h || 0);
  },

  area() {
    const top = Math.min(46, this._h * .16);
    const bottom = this.data.sel ? Math.min(74, this._h * .3) : 18;
    return { width: Math.max(1, this._w - 32), height: Math.max(1, this._h - top - bottom),
      x: this._w / 2, y: (this._h + top - bottom) / 2 };
  },
  fitBase() {
    const points = [];
    DATA.buildings.forEach(b => campus.parts(b, this.data.mode === 'flat').forEach(part => part.p.forEach(p => points.push(this.raw(p[0], p[1], part.h)))));
    DATA.roads.concat(DATA.water).forEach(shape => shape.p.forEach(p => points.push(this.raw(p[0], p[1]))));
    const bounds = this.bounds(points), a = this.area(), v = this._view;
    v.scale = Math.min(a.width / bounds.width, a.height / bounds.height);
    v.x = a.x - bounds.x * v.scale;
    v.y = a.y - bounds.y * v.scale;
  },
  bounds(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
    }
    return { width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY),
      x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  },
  resetView() {
    if (!this._ctx) return;
    const landscape = this._w > this._h * 1.2;
    const flat = this.data.mode === 'flat';
    this.setAngles(landscape ? (flat ? 0 : -.31) : -1.48, flat ? Math.PI / 2 : .77);
    this._home = true;
    this._view.zoom = 1;
    this.fitBase();
    this.scheduleDraw();
  },
  setMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (this.data.mode === mode) return;
    if (!this._ctx) { this.setData({ mode }); return; }
    const a = this.area(), p = this.unproject(a.x, a.y), v = this._view;
    if (this._home) { this.setData({ mode }); this.resetView(); return; }
    this.setData({ mode });
    this.setAngles(v.yaw, mode === 'flat' ? Math.PI / 2 : .77);
    this.fitBase();
    this.anchor(p, a.x, a.y);
    this.scheduleDraw();
  },
  rotate() {
    if (!this._ctx) return;
    const a = this.area(), point = this.unproject(a.x, a.y);
    this.setAngles(this._view.yaw + Math.PI / 4, this._view.pitch);
    this.anchor(point, a.x, a.y);
    this._home = false;
    this.scheduleDraw();
  },
  zoom(e) {
    if (!this._ctx) return;
    const a = this.area(), point = this.unproject(a.x, a.y);
    this._view.zoom = clamp(this._view.zoom * (e.currentTarget.dataset.zoom === 'in' ? 1.3 : 1 / 1.3), .55, 6);
    this.anchor(point, a.x, a.y);
    this._home = false;
    this.scheduleDraw();
  },

  scheduleDraw() {
    if (!this._ctx || this._framePending) return;
    this._framePending = true;
    const frame = () => { this._framePending = false; if (this._alive) this.draw(); };
    if (this._canvas.requestAnimationFrame) this._canvas.requestAnimationFrame(frame);
    else setTimeout(frame, 16);
  },
  path(points, closed) {
    const c = this._ctx;
    c.beginPath();
    c.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) c.lineTo(points[i][0], points[i][1]);
    if (closed) c.closePath();
  },
  worldPath(points, z = 0) { return points.map(p => this.project(p[0], p[1], z)); },
  draw() {
    const c = this._ctx, w = this._w, h = this._h;
    const dark = this.data.themeClass == null ? this._systemDark : this.data.themeClass === 'theme-dark';
    const colors = dark ? COLORS.dark : COLORS.light;
    const v = this._view, scale = v.scale * v.zoom;
    c.setTransform(this._canvas.width / w, 0, 0, this._canvas.height / h, 0, 0);
    c.fillStyle = colors.bg;
    c.fillRect(0, 0, w, h);
    c.lineCap = c.lineJoin = 'round';

    DATA.water.forEach(shape => {
      this.path(this.worldPath(shape.p), true);
      c.fillStyle = colors.water; c.fill();
      c.strokeStyle = colors.bank; c.lineWidth = 1; c.stroke();
    });
    DATA.roads.forEach(road => {
      this.path(this.worldPath(road.p), false);
      const line = Math.max(1.4, (road.w || 2.4) * scale);
      c.strokeStyle = colors.edge; c.lineWidth = line + 1.4; c.stroke();
      c.strokeStyle = colors.road; c.lineWidth = line; c.stroke();
    });

    const selected = this.data.sel && BY_ID[this.data.sel.id];
    const route = this._route;
    if (route && route.pts.length > 1) {
      this.path(this.worldPath(route.pts), false);
      c.strokeStyle = colors.halo; c.lineWidth = 6; c.stroke();
      c.strokeStyle = colors.route; c.lineWidth = 3; c.stroke();
    }

    const faces = [];
    DATA.buildings.forEach(b => {
      const height = this.heightOf(b);
      const center = this.project(b.x, b.y, height / 2), margin = Math.max(80, scale * 110);
      if (center[0] < -margin || center[0] > w + margin || center[1] < -margin || center[1] > h + margin) return;
      const active = selected && b.id === selected.id;
      const shades = BUILDING_COLORS[b.k];
      const roof = active ? colors.selected : shades ? shades[dark ? 2 : 0] : colors.fill;
      const wall = active ? (dark ? '#2C674F' : '#B5DBC9') : shades ? shades[dark ? 3 : 1] : colors.wall;
      for (const part of campus.parts(b, this.data.mode === 'flat')) {
        const top = this.worldPath(part.p, part.h), bottom = part.h ? this.worldPath(part.p) : top;
        let depth = 0;
        top.forEach((p, i) => {
          depth += p[2];
          if (!part.h) return;
          const j = (i + 1) % top.length;
          faces.push({ b, points: [bottom[i], bottom[j], top[j], p], fill: wall,
            depth: (bottom[i][2] + bottom[j][2] + top[j][2] + p[2]) / 4, active });
        });
        faces.push({ b, points: top, fill: roof, depth: depth / top.length, active });
      }
    });
    faces.sort((a, b) => a.depth - b.depth);
    this._faces = faces;
    faces.forEach(face => {
      this.path(face.points, true);
      c.fillStyle = face.fill; c.fill();
      c.strokeStyle = face.active ? colors.route : colors.edge;
      c.lineWidth = face.active ? 1.5 : .7; c.stroke();
    });

    const labels = [];
    const label = (text, x, y, z, emphasis) => {
      const p = this.project(x, y, z);
      if (p[0] < 20 || p[0] > w - 20 || p[1] < 30 || p[1] > h - (selected ? 72 : 12)) return;
      c.font = emphasis ? 'bold 13px sans-serif' : '12px sans-serif';
      const width = c.measureText(text).width + 12;
      if (labels.some(q => Math.abs(q.x - p[0]) < (q.w + width) / 2 && Math.abs(q.y - p[1]) < 16)) return;
      labels.push({ x: p[0], y: p[1], w: width });
      c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.lineWidth = 3; c.strokeStyle = colors.halo; c.strokeText(text, p[0], p[1] - 3);
      c.fillStyle = emphasis ? colors.route : colors.ink; c.fillText(text, p[0], p[1] - 3);
    };
    if (selected) label(selected.n, selected.x, selected.y, this.heightOf(selected), true);
    label('宋慈湖', 415, 238, 0, false);
    label('正大门', DATA.gate[0], DATA.gate[1], 0, false);
    for (const b of DATA.buildings) {
      if (b !== selected && (LANDMARKS.includes(b.n) || (scale > 1.05 && !/^(补全建筑\d+|自定义建筑)$/.test(b.n)))) {
        label(b.n, b.x, b.y, this.heightOf(b), false);
      }
    }
  },

  onSearch(e) { this.search(e.detail.value); },
  search(query) {
    this._hits = DIRECTORY.search(query);
    const results = this._hits.map(({ building, room, item, level, missing }, i) => ({
      key: item ? item.key : building.id + i,
      title: item ? room + ' · ' + item.name : room || building.n,
      sub: item ? [building.n, level + ' 层', item.org].filter(Boolean).join(' · ')
        : missing ? building.n + ' · 房间未收录' : building.k
    }));
    this.setData({ query, results, searched: !!query.trim() });
  },
  closeResults() {
    if (this.data.searched) this.setData({ searched: false, results: [] });
  },
  clearSearch() { this.setData({ query: '' }); this.closeResults(); },
  confirmSearch() {
    const hit = DIRECTORY.search(this.data.query)[0];
    if (hit) { this.clearSearch(); this.openTarget(hit); }
  },
  tapResult(e) {
    const hit = this._hits && this._hits[Number(e.currentTarget.dataset.index)];
    if (hit) { this.clearSearch(); this.openTarget(hit); }
  },
  openTarget(hit) {
    this.selectBuilding(hit.building, hit.room, true, hit.item ? hit : null);
    if (hit.item) this.openFloors();
  },
  refreshRoute(building, origin = this.data.origin) {
    const from = DATA.walk.origins[origin] || (BY_ID[origin] && BY_ID[origin].n);
    this._route = WALK.route(origin, building.id);
    const route = this._route;
    this.setData({
      origin, routeTitle: '起点 · ' + from,
      routeText: route ? [from, ...route.names.filter(name => name !== '校内支路'), building.n + (building.entry ? '' : '附近')].join(' → ')
        : origin === building.id ? (DIRECTORY.indoor[building.id] ? '已在此楼，可查看楼层' : '请选择另一栋楼作为终点') : '暂无路线',
      routeMeta: route ? '约 ' + route.mins + ' 分钟 · ' + route.m + ' 米' : ''
    });
    this.scheduleDraw();
  },
  chooseOrigin(e) {
    if (!this.data.sel) return;
    const building = BY_ID[this.data.sel.id];
    const origin = e.currentTarget.dataset.origin === 'building' ? building.id : e.currentTarget.dataset.origin;
    this.refreshRoute(building, origin);
  },
  subtitle(b, code, hit) {
    return [code && (hit ? code + ' · ' + hit.level + ' 层' : code + ' 未收录'),
      b.no && b.no + ' 号楼', b.k !== '其他' && b.k !== '补全建筑' && b.k].filter(Boolean).join(' · ');
  },
  selectBuilding(b, room = '', center = false, hit = null) {
    if (!b) return;
    this._activeRoom = hit;
    this.setData({sel: {id: b.id, name: b.n, hasRooms: !!DIRECTORY.indoor[b.id]}, room,
      subtitle: this.subtitle(b, room, hit), details: false});
    this.refreshRoute(b);
    if (center && this._ctx) {
      const area = this.area();
      this._view.zoom = Math.max(this._view.zoom, 1.65);
      this.anchor([b.x, b.y], area.x, area.y, this.heightOf(b));
      this._home = false;
    }
    this.scheduleDraw();
  },
  clearSelection() {
    this._route = this._activeRoom = null;
    this.setData({ sel: null, room: '', subtitle: '', details: false, floorOpen: false });
    this.scheduleDraw();
  },
  toggleDetails() { this.setData({ details: !this.data.details }); },
  fitRoute() {
    if (!this._ctx || !this.data.sel) return;
    const b = BY_ID[this.data.sel.id], route = this._route;
    if (!route || route.pts.length < 2) return;
    this.setData({ details: false });
    const area = this.area(), v = this._view;
    const points = route.pts.map(p => this.raw(p[0], p[1])).concat([this.raw(b.x, b.y, this.heightOf(b))]);
    const bounds = this.bounds(points);
    v.zoom = clamp(Math.min(area.width * .88 / bounds.width, area.height * .84 / bounds.height) / v.scale, .55, 3.8);
    v.x = area.x - bounds.x * v.zoom * v.scale;
    v.y = area.y - bounds.y * v.zoom * v.scale;
    this._home = false;
    this.scheduleDraw();
  },
  openFloors() {
    const group = this.data.sel && DIRECTORY.indoor[this.data.sel.id];
    if (!group) return;
    this.setData({floorOpen: true, floors: group.map(floor => floor.level)});
    this.showFloor(this._activeRoom ? this._activeRoom.level : group[0].level);
  },
  closeFloors() {
    this._plan = this._planCtx = this._planGesture = null;
    this.setData({ floorOpen: false, hasPlan: false });
  },
  tapFloor(e) { this.showFloor(Number(e.currentTarget.dataset.floor)); },
  showFloor(level) {
    const floor = DIRECTORY.indoor[this.data.sel.id].find(item => item.level === level);
    if (!floor) return;
    this._floor = floor;
    this._plan = null;
    const orgs = Array.from(new Set(floor.rooms.map(room => room.org).filter(Boolean)));
    this.setData({ floor: level, orgs: orgs.length ? ['全部机构', ...orgs] : [], orgIndex: 0, hasPlan: !!floor.size },
      () => { if (floor.size) this.measurePlan(); });
    this.updateFloorRooms(0);
  },
  filterOrg(e) { this.updateFloorRooms(Number(e.detail.value)); },
  updateFloorRooms(orgIndex) {
    const floor = this._floor;
    const active = this._activeRoom && floor.rooms.find(room => room.key === this._activeRoom.item.key);
    const rooms = floor.rooms.filter(room => !orgIndex || room.org === this.data.orgs[orgIndex])
      .map(({code, name, org, key}) => ({code, name, org: org || '', key}));
    const roomInfo = active ? [active.code, active.name, active.org,
      floor.size && !active.p && '平面位置待核实'].filter(Boolean).join(' · ') : '';
    this.setData({ rooms, orgIndex, activeRoom: active ? active.key : '', roomInfo });
    this.drawPlan();
  },
  chooseRoom(e) { this.selectRoom(e.currentTarget.dataset.key); },
  selectRoom(key) {
    const item = this._floor && this._floor.rooms.find(room => room.key === key);
    if (!item) return;
    const b = BY_ID[this.data.sel.id];
    this._activeRoom = {item, level: this._floor.level};
    this.setData({room: item.code, subtitle: this.subtitle(b, item.code, this._activeRoom)});
    this.updateFloorRooms(this.data.orgIndex);
  },
  measurePlan() {
    const floor = this._floor;
    wx.createSelectorQuery().in(this).select('#floorPlan').fields({node: true, size: true, rect: true}).exec(items => {
      const plan = items && items[0];
      if (!this._alive || this._floor !== floor || !this.data.floorOpen || !plan || !plan.node || !plan.width || !plan.height) return;
      this._planNode = plan.node;
      this._planRect = {x: plan.left, y: plan.top};
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const dpr = Math.min(info.pixelRatio || 1, 2);
      plan.node.width = Math.round(plan.width * dpr); plan.node.height = Math.round(plan.height * dpr);
      this._planCtx = plan.node.getContext('2d');
      this._planCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._plan = {width: plan.width, height: plan.height};
      this.fitPlan();
    });
  },
  fitPlan() {
    const v = this._plan, floor = this._floor;
    if (!v || !floor || !floor.size) return;
    const [w, h] = floor.size;
    v.fit = v.scale = Math.min((v.width - 12) / w, (v.height - 12) / h);
    v.x = (v.width - w * v.scale) / 2;
    v.y = (v.height - h * v.scale) / 2;
    this.drawPlan();
  },
  zoomPlan(e) {
    const v = this._plan;
    if (v) this.scalePlan(e.currentTarget.dataset.zoom === 'in' ? 1.28 : 1 / 1.28, v.width / 2, v.height / 2);
  },
  scalePlan(factor, x, y) {
    const v = this._plan;
    if (!v) return;
    const [w, h] = this._floor.size;
    const next = clamp(v.scale * factor, v.fit, v.fit * 5);
    v.x = clamp(x - (x - v.x) * next / v.scale, 20 - w * next, v.width - 20);
    v.y = clamp(y - (y - v.y) * next / v.scale, 20 - h * next, v.height - 20);
    v.scale = next;
    this.drawPlan();
  },
  drawPlan() {
    if (!this._plan || !this._planCtx || !this._floor || !this._floor.size || !this.data.floorOpen) return;
    campus.floorScene(this._planCtx, this._floor, this._activeRoom && this._activeRoom.item.key, this._plan,
      this.data.themeClass == null ? this._systemDark : this.data.themeClass === 'theme-dark');
  },
  planPoint(touch) {
    return [typeof touch.x === 'number' ? touch.x : touch.clientX - this._planRect.x,
      typeof touch.y === 'number' ? touch.y : touch.clientY - this._planRect.y];
  },
  planStart(e) {
    if (!this._plan) return;
    this._planGesture = {points: e.touches.map(touch => this.planPoint(touch)), moved: e.touches.length > 1};
  },
  planMove(e) {
    const gesture = this._planGesture, v = this._plan;
    if (!gesture || !v) return;
    const points = e.touches.map(touch => this.planPoint(touch));
    if (!points.length) return;
    const [point, second] = points, [previous, before] = gesture.points;
    const dx = point[0] - previous[0], dy = point[1] - previous[1];
    if (!gesture.moved && !second && Math.hypot(dx, dy) < 4) return;
    gesture.moved = true;
    gesture.points = points;
    if (second && before) {
      const distance = Math.hypot(previous[0] - before[0], previous[1] - before[1]);
      if (distance > 1) this.scalePlan(Math.hypot(point[0] - second[0], point[1] - second[1]) / distance,
        (point[0] + second[0]) / 2, (point[1] + second[1]) / 2);
    } else if (!second && !before) {
      v.x += dx; v.y += dy; this.scalePlan(1, v.width / 2, v.height / 2);
    }
  },
  planEnd(e) {
    const gesture = this._planGesture, v = this._plan;
    this._planGesture = null;
    if (!gesture || gesture.moved || !v || !e.changedTouches.length) return;
    const point = this.planPoint(e.changedTouches[0]);
    const x = (point[0] - v.x) / v.scale, y = (point[1] - v.y) / v.scale;
    const room = this._floor.rooms.find(entry => entry.p && campus.contains(x, y, entry.p));
    if (room) this.selectRoom(room.key);
  },
  planCancel() { this._planGesture = null; },

  position(t) {
    if (t.x != null) return [t.x, t.y];
    return [t.clientX - this._rect.x, t.clientY - this._rect.y];
  },
  beginGesture(touches, tap) {
    this._gesture = null;
    if (!touches.length || !this._ctx) return;
    const a = this.position(touches[0]);
    if (touches.length < 2) {
      this._gesture = { point: a, tap, time: Date.now() };
      return;
    }
    const b = this.position(touches[1]), dx = b[0] - a[0], dy = b[1] - a[1];
    this._gesture = { distance: Math.max(10, Math.hypot(dx, dy)), angle: Math.atan2(dy, dx),
      zoom: this._view.zoom, yaw: this._view.yaw, world: this.unproject((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) };
  },
  onTouchStart(e) { this.closeResults(); this.beginGesture(e.touches || [], !this._gesture); },
  onTouchMove(e) {
    const g = this._gesture, ts = e.touches || [];
    if (!g || !ts.length) return;
    const a = this.position(ts[0]), v = this._view;
    if (ts.length >= 2 && g.world) {
      const b = this.position(ts[1]), dx = b[0] - a[0], dy = b[1] - a[1];
      v.zoom = clamp(g.zoom * Math.hypot(dx, dy) / g.distance, .55, 6);
      if (this.data.mode === 'iso') this.setAngles(g.yaw + Math.atan2(dy, dx) - g.angle, v.pitch);
      this.anchor(g.world, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    } else if (g.point) {
      const dx = a[0] - g.point[0], dy = a[1] - g.point[1];
      if (g.tap && Math.hypot(dx, dy) < 6) return;
      g.tap = false;
      g.point = a;
      v.x += dx;
      v.y += dy;
    }
    this._home = false;
    this.scheduleDraw();
  },
  onTouchEnd(e) {
    const g = this._gesture, touches = e.touches || [];
    if (!touches.length && g && g.tap && Date.now() - g.time < 600 && e.changedTouches && e.changedTouches.length) {
      const p = this.position(e.changedTouches[0]);
      if (Math.hypot(p[0] - g.point[0], p[1] - g.point[1]) < 6) {
        const building = this.hit(p[0], p[1]);
        if (building) this.selectBuilding(building);
      }
    }
    this.beginGesture(touches, false);
  },
  onTouchCancel() { this._gesture = null; },
  hit(x, y) {
    const faces = this._faces || [];
    for (let i = faces.length - 1; i >= 0; i--) {
      if (campus.contains(x, y, faces[i].points)) return faces[i].b;
    }
    let nearest = null, radius = 12;
    for (const b of DATA.buildings) {
      const p = this.project(b.x, b.y, this.heightOf(b));
      const distance = Math.hypot(x - p[0], y - p[1]);
      if (distance < radius) { radius = distance; nearest = b; }
    }
    return nearest;
  },
  openTT() {
    const pages = getCurrentPages();
    const previous = pages[pages.length - 2];
    if (previous && previous.route === 'pages/tt/tt') wx.navigateBack();
    else wx.navigateTo({ url: '/pages/tt/tt' });
  },
  aboutMap() {
    wx.showModal({ title: '旗山校区地图', content: '地图和步行时间为示意。拖动平移，双指缩放，点建筑查看教室和路线。', showCancel: false });
  },
  shareQuery() {
    const target = this.data.room || (this.data.sel && this.data.sel.id);
    return target ? 'room=' + encodeURIComponent(target) : '';
  },
  onShareAppMessage() {
    const query = this.shareQuery();
    return { title: '福建中医药大学旗山校区地图', path: '/pages/map/map' + (query ? '?' + query : '') };
  },
  onShareTimeline() { return { title: '福建中医药大学旗山校区地图', query: this.shareQuery() }; }
});
