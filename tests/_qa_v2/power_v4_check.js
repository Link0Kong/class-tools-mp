/* _qa_v2/power_v4_check.js —— task-19 独立验收：小程序电费 v4（趋势横滑/固定轴/时间比例/区间）
 *
 * 运行：node power_v4_check.js [--tag power_v4]
 * 输出：PASS/FAIL/PEND + _reports/mp_power_v4_<tag>.json；退出码 0 = 无 FAIL。
 * 纯 Node + wx mock（无真实网络/不启动模拟器）；不读/打印任何密钥。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = 'C:/Users/Ko_Li/.openclaw/workspace/mp-class-tools';
const WEB = 'C:/Users/Ko_Li/.openclaw/workspace/web/tools/index.html';
const HERE = __dirname;
const REPORTS = path.join(HERE, '_reports');
const TAG = (function () { const i = process.argv.indexOf('--tag'); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'run'; })();

const results = [];
let passN = 0, failN = 0, pendN = 0;
async function test(req, name, fn) {
  try { await fn(); passN++; results.push({ req: String(req), name, ok: true, note: '' }); console.log('PASS  [' + req + '] ' + name); }
  catch (e) { failN++; results.push({ req: String(req), name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  [' + req + '] ' + name + '  ::  ' + ((e && e.message) || e)); }
}
function pend(req, name, note) { pendN++; results.push({ req: String(req), name, ok: null, note: String(note || '') }); console.log('PEND  [' + req + '] ' + name + (note ? '  --  ' + note : '')); }

/* ---------------- wx mock ---------------- */
const mem = Object.create(null);
let reqLog = [], toastLog = [];
let ROUTE = {};
function resetRoute() { ROUTE = { fail: false, power: [], hist24: [], hist7: [], hist30: [] }; }
resetRoute();
let CANVAS = { ops: [], node: null, queryW: 360 };
function resetCanvas() {
  const ops = [];
  const grad = { addColorStop(a, b) { ops.push(['addColorStop', [a, b]]); } };
  const c = {
    clearRect() { ops.push(['clearRect']); }, beginPath() { ops.push(['beginPath']); },
    moveTo(x, y) { ops.push(['moveTo', [x, y]]); }, lineTo(x, y) { ops.push(['lineTo', [x, y]]); },
    closePath() { ops.push(['closePath']); }, fill() { ops.push(['fill']); }, stroke() { ops.push(['stroke']); },
    arc(x, y, r) { ops.push(['arc', [x, y, r]]); }, scale(x, y) { ops.push(['scale', [x, y]]); },
    createLinearGradient() { ops.push(['gradient']); return grad; }
  };
  const node = { width: 0, height: 0, getContext(t) { return t === '2d' ? c : null; } };
  CANVAS = { ops: ops, node: node, queryW: 360 };
}
resetCanvas();
const PLOT_W = 360;
function reply(o, data) { o.success({ statusCode: 200, data: data === undefined ? [] : data }); }
global.wx = {
  getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
  setStorageSync(k, v) { mem[k] = v; },
  removeStorageSync(k) { delete mem[k]; },
  getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 1, limitSize: 10240 }; },
  request(o) {
    reqLog.push({ url: o.url, method: o.method, data: o.data, headerKeys: Object.keys(o.header || {}) });
    if (ROUTE.fail) { o.success({ statusCode: 500, data: 'qa-error' }); return; }
    const u = String(o.url || '');
    if (u.indexOf('power_history') >= 0) {
      const dec = decodeURIComponent(u);
      const m = dec.match(/ts=gte\.([^&]+)/);
      const cut = m ? Date.parse(m[1]) : 0;
      const diff = Date.now() - cut;
      if (diff > 20 * 864e5) return reply(o, ROUTE.hist30);
      if (diff > 2 * 864e5) return reply(o, ROUTE.hist7);
      return reply(o, ROUTE.hist24);
    }
    if (u.indexOf('/power?') >= 0) return reply(o, ROUTE.power);
    return reply(o, []);
  },
  pageScrollTo() {}, showToast(o) { toastLog.push(o && o.title); },
  showModal(o) { if (o && o.success) o.success({ confirm: true, cancel: false }); },
  showLoading() {}, hideLoading() {},
  setClipboardData(o) { if (o && o.success) o.success(); },
  getSetting(o) { if (o && o.success) o.success({ authSetting: {} }); },
  createSelectorQuery() {
    let sel = '', rect = false;
    const q = { in() { return q; }, select(x) { sel = String(x || ''); return q; },
      fields() { return q; }, boundingClientRect() { rect = true; return q; },
      selectViewport() { return q; }, scrollOffset() { return q; },
      exec(cb) {
        if (sel === '#pwTrend') { cb([{ node: CANVAS.node, width: CANVAS.queryW, height: 160 }]); return; }
        if (rect && sel === '.pw-plot') { cb([{ width: PLOT_W, height: 160, left: 0, top: 0 }]); return; }
        cb([{}]);
      } };
    return q;
  },
  navigateTo() {}, redirectTo() {}, switchTab() {}, reLaunch() {},
  getWindowInfo() { return { windowWidth: 390, windowHeight: 844, pixelRatio: 2, SDKVersion: '3.0.0' }; },
  getSystemInfoSync() { return { windowWidth: 390, windowHeight: 844, pixelRatio: 2, platform: 'devtools' }; },
  getAppBaseInfo() { return { SDKVersion: '3.0.0' }; },
  getDeviceInfo() { return { platform: 'devtools' }; },
  onThemeChange() {}, showShareMenu() {}, onAgentHandoff() {}, offAgentHandoff() {},
  stopPullDownRefresh() {}, startPullDownRefresh() {},
  createAnimation() { const a = { translate() { return a; }, opacity() { return a; }, scale() { return a; }, step() { return a; }, export() { return {}; } }; return a; },
  nextTick(fn) { setTimeout(fn, 0); },
  getNetworkType(o) { if (o && o.success) o.success({ networkType: 'wifi' }); },
  onNetworkStatusChange() {}
};
global.getApp = function () { return { globalData: {}, notifyPages() {} }; };
global.getCurrentPages = function () { return [{ route: 'pages/power/power' }]; };
global.Component = function () {};

function purge() {
  Object.keys(require.cache).forEach((k) => {
    if (k.replace(/\\/g, '/').indexOf(ROOT) === 0) {
      try { const m = require.cache[k]; if (m && m.exports && typeof m.exports.udStop === 'function') m.exports.udStop(); } catch (e) {}
      delete require.cache[k];
    }
  });
}
function load(rel) { return require(path.join(ROOT, rel)); }
function readSrc(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function readWeb() { try { return fs.readFileSync(WEB, 'utf8'); } catch (e) { return ''; } }
const ID_USER = { token: 'tok-qa-user-7c', sid: '9000000001', name: '测试同学01', role: '', badge: '', is_admin: false, ts: 1 };
function setIdentity(id) { mem['zq_class_identity'] = JSON.stringify(id || ID_USER); }
function clearMem() { Object.keys(mem).forEach((k) => delete mem[k]); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function loadPageDef(rel) {
  let def = null; global.Page = (d) => { def = d; };
  try { delete require.cache[require.resolve(path.join(ROOT, rel))]; require(path.join(ROOT, rel)); }
  finally { delete global.Page; }
  assert.ok(def, 'page 未注册 Page(): ' + rel);
  return def;
}
function mkCtx(def, data) {
  const ctx = Object.assign({}, def);
  ctx.data = Object.assign(JSON.parse(JSON.stringify(def.data || {})), data || {});
  ctx.setData = function (o, cb) {
    Object.keys(o).forEach((k) => {
      if (k.indexOf('.') >= 0) {
        const parts = k.split('.'); let cur = ctx.data;
        for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = cur[parts[i]] || {}; cur = cur[parts[i]]; }
        cur[parts[parts.length - 1]] = o[k];
      } else ctx.data[k] = o[k];
    });
    if (cb) cb();
  };
  return ctx;
}
function pickRoom(ctx, rv) { return ctx.pickRoom({ currentTarget: { dataset: { rv: rv } } }); }
function pickRange(ctx, k) { ctx.pickRange({ currentTarget: { dataset: { k: k } } }); }
function powerPage() {
  clearMem(); resetRoute(); resetCanvas(); purge(); setIdentity(ID_USER); toastLog = [];
  reqLog = [];
  const def = loadPageDef('pages/power/power.js');
  const ctx = mkCtx(def);
  return ctx;
}
function urls() { return reqLog.map((r) => String(r.url)); }
function reqOf(sub) { return reqLog.filter((r) => String(r.url).indexOf(sub) >= 0); }

const now = Date.now();
const ROW = { id: '4-23A---321', label: '23号楼A座321', building: '23号楼A座', room: '321', quantity: 382.02, unit: '度', low: false, updated_at: new Date(now - 20 * 60000).toISOString() };
function pt(q, msAgo) { return { quantity: q, ts: new Date(now - msAgo).toISOString() }; }
const HIST24 = [pt(500, 23 * 3600e3), pt(470, 15 * 3600e3), pt(430, 8 * 3600e3), pt(382.02, 0.6 * 3600e3)]; // 不均匀
function series(n, spanMs, startQ, rechargeAt) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = now - spanMs + Math.round(i * spanMs / (n - 1));
    let q = startQ - (startQ * 0.4) * i / (n - 1);
    if (rechargeAt != null && i === rechargeAt) q = startQ * 0.9;           // 充值上升
    out.push({ quantity: Math.round(q * 100) / 100, ts: new Date(t).toISOString() });
  }
  return out;
}
const HIST7 = series(42, 7 * 864e5, 900, 22);
const HIST30_BIG_RAW = series(600, 30 * 864e5, 1200, 400);
const HIST30 = series(64, 30 * 864e5, 1200, 40);

async function main() {
  const P = load('utils/power.js');
  const N24 = P.normalizeHistory(HIST24), N7 = P.normalizeHistory(HIST7), N30 = P.normalizeHistory(HIST30), N30BIG = P.normalizeHistory(HIST30_BIG_RAW);

  /* ---------- 静态：v4 结构 ---------- */
  await test('v4-静态', 'scroll-view 横滑：24h 关闭、7d/30d 开启，隐藏滚动条、bindscroll、内容宽=chartW', () => {
    const wxml = readSrc('pages/power/power.wxml');
    assert.ok(/<scroll-view[^>]*class="pw-plot"/.test(wxml));
    assert.ok(wxml.indexOf('scroll-x="{{range !== \'24h\'}}"') >= 0, '24h 应关闭横滑');
    assert.ok(wxml.indexOf('show-scrollbar="{{false}}"') >= 0, '未隐藏滚动条');
    assert.ok(wxml.indexOf('bindscroll="onTrendScroll"') >= 0);
    assert.ok(wxml.indexOf('style="width:{{chartW}}px"') >= 0);
    assert.ok(wxml.indexOf('pw-plot-inner') >= 0);
  });
  await test('v4-静态', '固定 y 轴：竖线 + 3 刻度，空态只留竖线；固定 x 轴覆盖层 left/shift', () => {
    const wxml = readSrc('pages/power/power.wxml');
    assert.ok(wxml.indexOf('pw-yaxis') >= 0 && wxml.indexOf('pw-yline') >= 0);
    assert.ok(/pw-ylab--hi/.test(wxml) && /pw-ylab--mid/.test(wxml) && /pw-ylab--lo/.test(wxml));
    assert.ok(/wx:if="\{\{!trend\.empty\}\}"[\s\S]{0,200}pw-ylab--hi/.test(wxml), 'y 刻度未按空态隐藏');
    assert.ok(wxml.indexOf('pw-xaxis') >= 0 && wxml.indexOf('style="left:{{item.left}}px;transform:translateX({{item.shift}})"') >= 0);
    const js = readSrc('pages/power/power.js');
    assert.ok(js.indexOf('MAX_PHYS = 5376') >= 0, '缺物理宽上限');
    assert.ok(js.indexOf('onTrendScroll') >= 0 && js.indexOf('_refreshXTicks') >= 0);
  });

  /* ---------- 纯函数：RANGES / 上限 / 宽度 / 时间比例 / 刻度 ---------- */
  await test('v4-纯函数', 'RANGES 三档与 title/tile/dropLabel/gap/xN；trendLimit 24h240/7d170/30d240', () => {
    assert.deepStrictEqual(P.rangeKeys(), ['24h', '7d', '30d']);
    assert.deepStrictEqual(P.RANGES.map((r) => [r.label, r.title, r.tile, r.dropLabel, r.gap, r.xN]), [
      ['24h', '近 24h 趋势', '近 24h 用电', '近 24h 下降', 0, 3],
      ['7天', '近 7 天趋势', '近 7 天用电', '区间下降', 16, 4],
      ['30天', '近 30 天趋势', '近 30 天用电', '区间下降', 9, 5]
    ]);
    assert.strictEqual(P.trendLimit('24h'), 240);
    assert.strictEqual(P.trendLimit('7d'), 170);
    assert.strictEqual(P.trendLimit('30d'), 240);
    assert.strictEqual(P.rangeMeta('bogus').k, '24h');
  });
  await test('v4-纯函数', 'chartWidth：24h=容器宽；7d/30d = max(容器, n*gap+16)', () => {
    assert.strictEqual(P.chartWidth('24h', 360, 99), 360);
    assert.strictEqual(P.chartWidth('7d', 360, 40), 40 * 16 + 16);
    assert.strictEqual(P.chartWidth('30d', 360, 60), 60 * 9 + 16);
    assert.strictEqual(P.chartWidth('7d', 2000, 10), 2000);
  });
  await test('v4-纯函数', 'x 坐标=真实时间比例：不均匀时间戳间距与时间差成比例', () => {
    const t0 = 1762290000000;
    const hist = [{ q: 100, t: t0 }, { q: 90, t: t0 + 3600e3 }, { q: 80, t: t0 + 3 * 3600e3 }, { q: 70, t: t0 + 10 * 3600e3 }];
    const tl = P.trendLine(hist);
    assert.deepStrictEqual(tl.points.map((p) => Math.round(p.x * 1e6) / 1e6), [0, 0.1, 0.3, 1]);
    assert.strictEqual(tl.points.length, 4);
    assert.ok(tl.points[1].y > tl.points[0].y, 'y 未按电量下降');
  });
  await test('v4-纯函数', '降采样上限：7d≤170、30d≤240、24h≤240；点数保留首末', () => {
    const many = [];
    for (let i = 0; i < 600; i++) many.push({ q: 1000 - i, t: 1762290000000 + i * 60000 });
    const l7 = P.trendLine(many, P.trendLimit('7d'));
    const l30 = P.trendLine(many, P.trendLimit('30d'));
    const l24 = P.trendLine(many, P.trendLimit('24h'));
    assert.ok(l7.points.length <= 170 && l7.points.length >= 100, '7d=' + l7.points.length);
    assert.ok(l30.points.length <= 240 && l30.points.length >= 150, '30d=' + l30.points.length);
    assert.ok(l24.points.length <= 240, '24h=' + l24.points.length);
    assert.strictEqual(l7.points[0].x, 0); assert.strictEqual(l7.points[l7.points.length - 1].x, 1);
  });
  await test('v4-纯函数', '可见窗口 x 刻度：3/4/5 个、HH:MM / MM-DD、无重复、横滑后变化', () => {
    const tl7 = P.trendLine(N7, P.trendLimit('7d'));
    const cw = 360, W = P.chartWidth('7d', cw, tl7.points.length);
    const a = P.xticksWindow(tl7.points, '7d', cw, W, 0);
    const b = P.xticksWindow(tl7.points, '7d', cw, W, 200);
    assert.strictEqual(a.length, 4);
    assert.ok(a.every((t) => /^\d{2}-\d{2}$/.test(t.label)), '7d 刻度格式: ' + JSON.stringify(a));
    assert.strictEqual(new Set(a.map((t) => t.label)).size, a.length, '同屏刻度重复: ' + JSON.stringify(a));
    assert.ok(a.some((t, i) => b[i] && (t.label !== b[i].label || Math.abs(t.left - b[i].left) > 5)), '横滑后 x 刻度未变化');
    const tl24 = P.trendLine(N24, P.trendLimit('24h'));
    const c24 = P.xticksWindow(tl24.points, '24h', cw, cw, 0);
    assert.strictEqual(c24.length, 3);
    assert.ok(c24.every((t) => /^\d{2}:\d{2}$/.test(t.label)), '24h 刻度格式: ' + JSON.stringify(c24));
    const tl30 = P.trendLine(N30, P.trendLimit('30d'));
    const W30 = P.chartWidth('30d', cw, tl30.points.length);
    assert.strictEqual(P.xticksWindow(tl30.points, '30d', cw, W30, 0).length, 5);
    assert.ok(P.xticksWindow(tl30.points, '30d', cw, W30, 0).every((t) => /^\d{2}-\d{2}$/.test(t.label)));
  });
  await test('v4-纯函数', 'deriveRange：充值上升忽略、recharge/lastUp 记录最后一次、drop 只累计下降', () => {
    const t0 = 1762290000000;
    const hist = [{ q: 100, t: t0 }, { q: 90, t: t0 + 3600e3 }, { q: 300, t: t0 + 2 * 3600e3 }, { q: 280, t: t0 + 4 * 3600e3 }];
    const d = P.deriveRange(hist, { q: 280 });
    assert.strictEqual(d.drop, 30, 'drop=' + d.drop);
    assert.strictEqual(d.recharge, true);
    assert.deepStrictEqual([d.lastUp.reset, d.lastUp.delta], [300, 210]);
    assert.ok(d.days > 0);
  });

  /* ---------- 页面：区间 + 横滑 + 固定轴 ---------- */
  await test('v4-页面', '未选择：0 请求、chartW=0、scrollLeft=0；打开 sheet/切楼栋仍 0 请求', async () => {
    const ctx = powerPage();
    ctx.onLoad({}); ctx.onShow();
    await sleep(40);
    assert.strictEqual(reqOf('/power').length, 0);
    assert.strictEqual(ctx.data.chartW, 0);
    assert.strictEqual(ctx.data.scrollLeft, 0);
    ctx.openSheet(); ctx.pickBuilding({ currentTarget: { dataset: { b: '23号楼A座' } } }); ctx.closeSheet();
    await sleep(60);
    assert.strictEqual(reqOf('/power').length, 0);
  });
  let ctx1;
  await test('v4-页面', '24h：chartW=容器宽(360)、不横滑、x 刻度 3 个 HH:MM、y 1 位小数', async () => {
    ctx1 = powerPage();
    ROUTE.power = [ROW]; ROUTE.hist24 = HIST24; ROUTE.hist7 = HIST7; ROUTE.hist30 = HIST30;
    ctx1.onLoad({}); ctx1.onShow(); await sleep(40);
    await pickRoom(ctx1, '4-23A---321'); await sleep(150);
    assert.strictEqual(ctx1.data.range, '24h');
    assert.strictEqual(ctx1.data.chartW, PLOT_W, '24h 内容宽应铺满容器');
    assert.strictEqual(ctx1.data.scrollLeft, 0);
    assert.strictEqual(ctx1.data.trend.xTicks.length, 3);
    assert.ok(ctx1.data.trend.xTicks.every((t) => /^\d{2}:\d{2}$/.test(t.label)));
    assert.ok(/^\d+\.\d$/.test(ctx1.data.trend.hiText), 'y 刻度非 1 位小数: ' + ctx1.data.trend.hiText);
    assert.ok(ctx1.data.trend.title === '近 24h 趋势');
    assert.strictEqual(ctx1.data.trend.dropLabel, '近 24h 下降');
    assert.strictEqual(ctx1.data.trend.startLabel, '起点');
  });
  await test('v4-页面', '7d：内容宽>容器、4 个 MM-DD 刻度、scrollLeft 归零、充值徽标/上次充值/tile2', async () => {
    ROUTE.power = [ROW]; ROUTE.hist24 = HIST24; ROUTE.hist7 = HIST7; ROUTE.hist30 = HIST30;
    ctx1._sl = 123;
    pickRange(ctx1, '7d');
    await sleep(200);
    assert.strictEqual(ctx1.data.range, '7d');
    assert.ok(ctx1.data.chartW > PLOT_W, '7d 内容宽未超容器: ' + ctx1.data.chartW);
    assert.strictEqual(ctx1.data.scrollLeft, 0, '切档 scrollLeft 未归零');
    assert.strictEqual(ctx1.data.trend.xTicks.length, 4);
    assert.ok(ctx1.data.trend.xTicks.every((t) => /^\d{2}-\d{2}$/.test(t.label)));
    assert.strictEqual(ctx1.data.trend.title, '近 7 天趋势');
    assert.strictEqual(ctx1.data.trend.dropLabel, '区间下降');
    assert.strictEqual(ctx1.data.trend.startLabel, '起');
    assert.strictEqual(ctx1.data.trend.recharge, true, '未识别充值');
    assert.strictEqual(ctx1.data.tiles[1].label, '近 7 天用电');
    assert.strictEqual(ctx1.data.tiles[3].label, '上次充值');
    assert.ok(ctx1.data.tiles[3].value !== '—', '上次充值值缺失');
    assert.ok(/^\d{2}-\d{2} \d{2}:\d{2}$/.test(ctx1.data.tiles[3].sub), '上次充值时间格式: ' + ctx1.data.tiles[3].sub);
  });
  await test('v4-页面', '7d 横滑：x 刻度变化、y 文本/标题不变（固定 y 轴）', async () => {
    const before = JSON.parse(JSON.stringify(ctx1.data.trend.xTicks));
    const yBefore = [ctx1.data.trend.hiText, ctx1.data.trend.midText, ctx1.data.trend.loText];
    ctx1.onTrendScroll({ detail: { scrollLeft: Math.round(ctx1.data.chartW * 0.35) } });
    await sleep(60);
    const after = ctx1.data.trend.xTicks;
    assert.ok(after.length === 4);
    const changed = after.some((t, i) => !before[i] || t.label !== before[i].label || Math.abs(t.left - before[i].left) > 5);
    assert.ok(changed, '横滑后 x 刻度未刷新: ' + JSON.stringify(before) + ' -> ' + JSON.stringify(after));
    assert.deepStrictEqual([ctx1.data.trend.hiText, ctx1.data.trend.midText, ctx1.data.trend.loText], yBefore, 'y 轴文本随横滑变化');
    assert.strictEqual(ctx1.data.trend.title, '近 7 天趋势');
  });
  await test('v4-页面', '30d：内容宽>容器、5 个 MM-DD、切回 24h 铺满且 scrollLeft 归零', async () => {
    pickRange(ctx1, '30d'); await sleep(200);
    assert.strictEqual(ctx1.data.range, '30d');
    assert.ok(ctx1.data.chartW > PLOT_W);
    assert.strictEqual(ctx1.data.trend.xTicks.length, 5);
    assert.ok(ctx1.data.trend.xTicks.every((t) => /^\d{2}-\d{2}$/.test(t.label)));
    assert.strictEqual(ctx1.data.tiles[1].label, '近 30 天用电');
    ctx1.onTrendScroll({ detail: { scrollLeft: 200 } }); await sleep(40);
    assert.ok(ctx1._sl > 0);
    pickRange(ctx1, '24h'); await sleep(150);
    assert.strictEqual(ctx1.data.chartW, PLOT_W);
    assert.strictEqual(ctx1.data.scrollLeft, 0);
    assert.strictEqual(ctx1.data.trend.xTicks.length, 3);
  });
  await test('v4-页面', '切换宿舍：scrollLeft 归零、只请求新房间；区间记忆 zq_power_range_v1 且不进 UD', async () => {
    pickRange(ctx1, '7d'); await sleep(200);
    ctx1.onTrendScroll({ detail: { scrollLeft: 180 } }); await sleep(40);
    const beforeReqs = reqLog.length;
    ROUTE.power = [Object.assign({}, ROW, { id: '1-16---305', label: '16号楼305', room: '305' })];
    ROUTE.hist24 = HIST24; ROUTE.hist7 = HIST7; ROUTE.hist30 = HIST30;
    await pickRoom(ctx1, '1-16---305'); await sleep(200);
    assert.strictEqual(ctx1.data.range, '7d', '区间选择未保留');
    assert.strictEqual(ctx1.data.scrollLeft, 0, '换房后 scrollLeft 未归零');
    const newReqs = reqLog.slice(beforeReqs);
    assert.ok(newReqs.some((r) => String(r.url).indexOf('id=eq.1-16---305') >= 0), '未请求新房间');
    assert.strictEqual(mem['zq_power_range_v1'], '7d', '区间未写入本机');
    const store = load('utils/store.js');
    assert.deepStrictEqual(Object.keys(store.get().power || {}).sort(), ['at', 'sel'], 'power UD 形状应为 {sel,at}');
    assert.strictEqual(reqLog.filter((r) => r.data && JSON.stringify(r.data).indexOf('userdata') >= 0).length, 0);
  });
  await test('v4-页面', '刷新/重进页：本机区间恢复 7d，读取缓存或重拉，x 刻度 4 个', async () => {
    const ctx2 = powerPage();
    mem['zq_power_range_v1'] = '7d';
    ROUTE.power = [ROW]; ROUTE.hist24 = HIST24; ROUTE.hist7 = HIST7; ROUTE.hist30 = HIST30;
    ctx2.onLoad({}); ctx2.onShow(); await sleep(40);
    await pickRoom(ctx2, '4-23A---321'); await sleep(250);
    assert.strictEqual(ctx2.data.range, '7d');
    assert.strictEqual(ctx2.data.trend.xTicks.length, 4);
    assert.ok(ctx2.data.chartW > PLOT_W);
  });

  /* ---------- 空态 / canvas DPR / 时间比例 ---------- */
  await test('v4-页面', '空态（<2 采样）：数据积累中、y 刻度隐藏、不绘制；只留竖线', async () => {
    const ctx3 = powerPage();
    ROUTE.power = [ROW]; ROUTE.hist24 = [HIST24[0]]; ROUTE.hist7 = [HIST7[0]]; ROUTE.hist30 = [HIST30[0]];
    ctx3.onLoad({}); ctx3.onShow(); await sleep(40);
    const before = CANVAS.ops.length;
    await pickRoom(ctx3, '4-23A---321'); await sleep(180);
    assert.strictEqual(ctx3.data.trend.empty, true);
    assert.strictEqual(ctx3.data.trend.note, '数据积累中');
    assert.strictEqual(ctx3.data.trend.hiText, '—');
    assert.strictEqual(ctx3.data.trend.xTicks.length, 0);
    assert.strictEqual(CANVAS.ops.length, before, '空态不应绘制 canvas');
    const wxml = readSrc('pages/power/power.wxml');
    assert.ok(/wx:if="\{\{!trend\.empty\}\}"/.test(wxml));
  });
  await test('v4-页面', 'canvas：24h 物理宽=chartW*dpr；30d 超宽时物理宽≤5376（DPR 钳制）', async () => {
    const ctx4 = powerPage();
    ROUTE.power = [ROW]; ROUTE.hist24 = HIST24; ROUTE.hist7 = HIST7; ROUTE.hist30 = HIST30;
    ctx4.onLoad({}); ctx4.onShow(); await sleep(40);
    await pickRoom(ctx4, '4-23A---321'); await sleep(200);
    assert.strictEqual(CANVAS.node.width, PLOT_W * 2, '24h canvas 物理宽=' + CANVAS.node.width);
    ROUTE.hist30 = HIST30_BIG_RAW;
    pickRange(ctx4, '30d'); await sleep(300);
    CANVAS.queryW = ctx4.data.chartW;
    ctx4._drawTrend(); await sleep(60);
    assert.ok(CANVAS.node.width <= 5376, '30d 物理宽超上限: ' + CANVAS.node.width);
    const oldInfo = global.wx.getWindowInfo;
    global.wx.getWindowInfo = function () { return { windowWidth: 390, windowHeight: 844, pixelRatio: 3, SDKVersion: '3.0.0' }; };
    try {
      ctx4._drawTrend(); await sleep(60);
      assert.ok(CANVAS.node.width <= 5376, 'pixelRatio=3 时物理宽超上限: ' + CANVAS.node.width);
    } finally { global.wx.getWindowInfo = oldInfo; }
  });
  await test('v4-页面', 'canvas 折线横坐标与时间比例一致（不均匀采样）', async () => {
    const ctx5 = powerPage();
    ROUTE.power = [ROW];
    ROUTE.hist24 = [pt(400, 23 * 3600e3), pt(380, 22 * 3600e3), pt(360, 20 * 3600e3), pt(340, 10 * 3600e3), pt(320, 1 * 3600e3)];
    ctx5.onLoad({}); ctx5.onShow(); await sleep(40);
    const before = CANVAS.ops.filter((o) => o[0] === 'lineTo').length;
    await pickRoom(ctx5, '4-23A---321'); await sleep(200);
    const lineOps = CANVAS.ops.filter((o) => o[0] === 'lineTo').slice(before + 2);  // 跳过 2 条网格线
    assert.ok(lineOps.length >= 5, 'lineTo 数=' + lineOps.length);
    const xs = lineOps.slice(0, 5).map((o) => o[1][0]);
    const diffs = [xs[1] - xs[0], xs[2] - xs[1], xs[3] - xs[2], xs[4] - xs[3]];
    const total = xs[4] - xs[0];
    // 时间差（小时）：1,2,10,9；总 22
    const expect = [1 / 22, 2 / 22, 10 / 22, 9 / 22].map((r) => r * total);
    diffs.forEach((d, i) => assert.ok(Math.abs(d - expect[i]) <= 1.5, '第' + i + '段间距 ' + d.toFixed(2) + ' 期望 ' + expect[i].toFixed(2)));
  });

  /* ---------- history 契约 / 5min 缓存 ---------- */
  await test('v4-页面', 'history 契约：select=ts,quantity、limit=2000、order=ts.asc、gte 按区间；5min 缓存切档 0 请求', async () => {
    const ctx6 = powerPage();
    ROUTE.power = [ROW]; ROUTE.hist24 = HIST24; ROUTE.hist7 = HIST7; ROUTE.hist30 = HIST30;
    ctx6.onLoad({}); ctx6.onShow(); await sleep(40);
    await pickRoom(ctx6, '4-23A---321'); await sleep(200);
    const h24 = reqOf('power_history');
    assert.strictEqual(h24.length, 1, '初始 history 请求数=' + h24.length);
    const u24 = decodeURIComponent(String(h24[0].url));
    ['select=ts,quantity', 'roomverify=eq.4-23A---321', 'order=ts.asc', 'limit=2000'].forEach((k) => assert.ok(u24.indexOf(k) >= 0, '缺 ' + k + ' -> ' + u24));
    const cut24 = Date.parse((u24.match(/ts=gte\.([^&]+)/) || [])[1]);
    assert.ok(Math.abs((Date.now() - cut24) - 24 * 3600e3) < 3 * 3600e3, '24h gte 窗口偏差');
    const before = reqLog.length;
    pickRange(ctx6, '7d'); await sleep(220);
    const newReqs = reqLog.slice(before);
    const h7 = newReqs.filter((r) => String(r.url).indexOf('power_history') >= 0);
    assert.strictEqual(h7.length, 1, '7d 切档 history 请求数=' + h7.length);
    const cut7 = Date.parse((decodeURIComponent(String(h7[0].url)).match(/ts=gte\.([^&]+)/) || [])[1]);
    assert.ok(Math.abs((Date.now() - cut7) - 7 * 864e5) < 6 * 3600e3, '7d gte 窗口偏差');
    const before30 = reqLog.length;
    pickRange(ctx6, '30d'); await sleep(220);
    const day30Reqs = reqLog.slice(before30).filter((r) => String(r.url).indexOf('power_history') >= 0);
    assert.strictEqual(day30Reqs.length, 1, '30d 切档 history 请求数=' + day30Reqs.length);
    const beforeBack = reqLog.length;
    pickRange(ctx6, '7d'); await sleep(220);
    assert.strictEqual(reqLog.length, beforeBack, '5min 缓存内切回 7d 不应请求（+' + (reqLog.length - beforeBack) + '）');
    assert.ok(readSrc('utils/cloud.js').indexOf('POWER_HIST_TTL = 5 * 60 * 1000') >= 0);
  });
  await test('v4-页面', '估算可用/环形/低电条仍用 24h（7d/30d 下 tile1 与 lowText 取 24h 数据）', async () => {
    const ctx7 = powerPage();
    ROUTE.power = [Object.assign({}, ROW, { quantity: 20, low: true })];
    ROUTE.hist24 = [pt(30, 22 * 3600e3), pt(25, 12 * 3600e3), pt(20, 0.5 * 3600e3)];
    ROUTE.hist7 = series(42, 7 * 864e5, 900, 22);
    ROUTE.hist30 = series(64, 30 * 864e5, 1200, 40);
    ctx7.onLoad({}); ctx7.onShow(); await sleep(40);
    await pickRoom(ctx7, '4-23A---321'); await sleep(200);
    const t24 = ctx7.data.tiles[0].value;
    pickRange(ctx7, '7d'); await sleep(220);
    assert.strictEqual(ctx7.data.tiles[0].value, t24, '7d 下估算可用未用 24h');
    assert.ok(/约 \d+\.\d 天/.test(ctx7.data.lowText), '低电条未用 24h 天数: ' + ctx7.data.lowText);
    assert.strictEqual(ctx7.data.lowOn, true);
  });

  /* ---------- 与网站 v4 交叉核对 ---------- */
  await test('v4-对齐网站', 'RANGES/区间本机键/5min 缓存/history 契约/界面语义与网站 v4 一致', () => {
    const w = readWeb();
    assert.ok(w.indexOf('var PW_RANGES=[') >= 0, '网站无 PW_RANGES');
    const wr = w.slice(w.indexOf('var PW_RANGES=['), w.indexOf('var PW_RANGE_MAP'));
    ['k:"24h"', 'title:"近 24h 趋势"', 'tile:"近 24h 用电"', 'dropLabel:"近 24h 下降"', 'gap:0', 'xN:3',
     'k:"7d"', 'gap:16', 'xN:4', 'k:"30d"', 'gap:9', 'xN:5'].forEach((k) => assert.ok(wr.replace(/\s/g, '').indexOf(k.replace(/\s/g, '')) >= 0, '网站缺 ' + k));
    assert.ok(w.indexOf('zq_power_range_v1') >= 0);
    assert.ok(w.indexOf('PW_HCACHE_TTL=5*60*1000') >= 0 || /PW_HCACHE_TTL\s*=\s*5\s*\*\s*60\s*\*\s*1000/.test(w));
    assert.ok(w.indexOf('limit=2000') >= 0 && w.indexOf('select=ts,quantity') >= 0);
    assert.ok(w.indexOf('期间有充值') >= 0 && w.indexOf('上次充值') >= 0);
    assert.ok(w.indexOf('scrollLeft') >= 0, '网站无横滑实现');
  });

  /* ---------- v3.1/v2 不回归 ---------- */
  await test('回归', '阈值 30/60、环形 days/30、低电条文案不回归', () => {
    assert.strictEqual(P.stateOf(P.normalizeRow({ quantity: 59.99 })), 'warn');
    assert.strictEqual(P.stateOf(P.normalizeRow({ quantity: 60 })), 'ok');
    assert.strictEqual(P.stateOf(P.normalizeRow({ quantity: 29.99 })), 'low');
    assert.strictEqual(P.stateText('ok') + '/' + P.stateText('warn') + '/' + P.stateText('low'), '充足/偏低/低电');
    const row = P.normalizeRow({ quantity: 100 });
    assert.strictEqual(P.ringArc(row, { valid: true, days: 30 }), 1);
    assert.strictEqual(P.ringArc(row, { valid: true, days: 0.3 }), P.ARC_MIN);
    assert.strictEqual(P.ringArc(null, null), 0);
    assert.ok(P.lowText(row, { valid: true, days: 6 }).indexOf('剩 100.00 度 · 约 6.0 天') === 0);
    assert.strictEqual(P.fmtMain(382.02), '382');
    assert.strictEqual(P.fmtMain(59.94), '59.9');
  });
  await test('回归', 'UD v6 13 键 + power 镜像 + 未拥有 section 保留', () => {
    clearMem(); setIdentity(ID_USER); purge();
    const cloud = load('utils/cloud.js');
    const merged = cloud.mergeUd({ v: 6, at: { power: 5, nick: 7 }, power: { sel: '4-23A---321', at: 5 }, nick: '云端昵称' }, { at: { power: 3 }, power: { sel: '1-16---305', at: 3 } });
    assert.deepStrictEqual(Object.keys(merged), ['v', 'at', 'homeTools', 'fit', 'draw', 'group', 'roster', 'hide', 'tt', 'prefs', 'nick', 'power', 'homeToolsAt']);
    assert.strictEqual(merged.power.sel, '4-23A---321');
    assert.strictEqual(merged.power.at, merged.at.power);
    assert.strictEqual(merged.nick, '云端昵称');
  });
  await test('回归', 'TTL/失败降级：TTL 内重复 load 0 请求、force 拉取；失败保留旧数据+toast', async () => {
    const ctx8 = powerPage();
    ROUTE.power = [ROW]; ROUTE.hist24 = HIST24; ROUTE.hist7 = HIST7; ROUTE.hist30 = HIST30;
    ctx8.onLoad({}); ctx8.onShow(); await sleep(40);
    await pickRoom(ctx8, '4-23A---321'); await sleep(200);
    const count = () => reqLog.length;
    const base = count();
    await ctx8.load(false); await sleep(60);
    assert.strictEqual(count(), base, 'TTL 内重复 load 又请求了');
    await ctx8.load(true); await sleep(100);
    assert.ok(count() > base, 'force 未重新请求');
    ROUTE.fail = true;
    await ctx8.load(true); await sleep(100);
    assert.strictEqual(ctx8.data.state, 'ready');
    assert.ok(toastLog.some((t) => String(t).indexOf('刷新失败') >= 0), '失败未提示');
    const ctx9 = powerPage();
    ROUTE.fail = true;
    ctx9.onLoad({}); ctx9.onShow(); await sleep(40);
    await pickRoom(ctx9, '4-23A---321'); await sleep(180);
    assert.strictEqual(ctx9.data.state, 'error');
  });
  await test('回归', '诊断页管理员门限/13 键/选择 sheet 静态不回归', () => {
    const dg = readSrc('pages/diag/diag.js');
    assert.ok(dg.indexOf("if (!identity.isAdmin()) { this.setData({ state: 'denied'") >= 0 || (dg.split('identity.isAdmin()').length - 1) >= 3);
    const cloud = readSrc('utils/cloud.js');
    assert.ok(cloud.indexOf('if (!identity.has() || !identity.isAdmin() || !isEnabled())') >= 0);
    const pw = readSrc('pages/power/power.wxml');
    assert.ok(pw.indexOf('pw-sheet') >= 0 && pw.indexOf('pw-rooms') >= 0 && pw.indexOf('pw-cancel') >= 0);
    assert.ok(pw.indexOf('multiSelector') < 0 && pw.indexOf('<picker') < 0);
  });

  /* ---------- 汇总 ---------- */
  fs.mkdirSync(REPORTS, { recursive: true });
  const out = path.join(REPORTS, 'mp_power_v4_' + TAG + '.json');
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), total: results.length, pass: passN, fail: failN, pend: pendN, rows: results }, null, 1), 'utf8');
  console.log('\n' + '='.repeat(66));
  console.log('power v4 check [' + TAG + ']: ' + results.length + ' 项，PASS ' + passN + '，FAIL ' + failN + '，PEND ' + pendN);
  console.log('结果 JSON:', out);
  console.log('='.repeat(66));
  return failN === 0 ? 0 : 1;
}

main().then((c) => process.exit(c)).catch((e) => { console.error('脚本异常:', e); process.exit(2); });
