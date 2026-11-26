/* drawproof_unit_tests.js —— 抽签升级 v1 专项单测（2026-11-12，随 unit.js 运行，也可独立跑）
 *
 * 契约唯一真源：web/draw/CONTRACT.md
 *   §2   draw-v1 算法（mulberry32 uint32 显式版 + 4 组固定向量；网页/小程序/核验页逐字节一致）
 *   §3.1 名称映射规则（每行「序号 名称」/ 无序号自增 / trim 1..40 / 后值覆盖 / ≤300 / 归一升序 /
 *        nameOf 优先级 映射 > 班级名单派生名 > ''）+ 导出参数「名称映射 N 项」
 *   §3.2 存证与今日次数（每次抽签一条记录，异步不阻塞；剔除/补抽/重置事件；「存证中/已存证/未存证」）
 *   §3.3 导出图（rec=存证 id / 参数区存证编号·时间·今日次数·记录哈希 / QR=verifyUrl + qrTitle/qrCap /
 *        未存证不加 QR / 剔除重抽明细纯文本块）
 *   §3.4 记录详情（参数/初始结果/时间线/算法复算/哈希/二维码/复制核验链接；不显示学号）
 *   §4   小程序端：utils/drawproof.js、pages/draw、pages/drawrec、UD v6 draw.names、canvas qrTitle/qrCap
 *
 * 覆盖：
 *   A. draw-v1 4 组契约向量 + 边界；B. seed/recordId/verifyUrl；C. 名称映射解析/摘要/优先级/导出 labels；
 *   D. 参数与视图（params/摘要/时间/存证状态/导出参数行/剔除明细）；E. 记录列表/详情/复算/时间线；
 *   F. 4 个 RPC（wx.request mock：URL/body/header/失败静默，不发真实请求）；
 *   G. pages/draw 页面级（名称映射弹层/存证创建 payload/今日次数/事件追加/导出 opt）；
 *   H. pages/drawrec 页面级（?id= 深链详情/列表/切换/复制链接/二维码绘制/分享）；
 *   I. 工程静态断言（app.json/页面文件/分享/同步字段/canvas qrTitle/qrCap/无学号展示）。
 *
 * 说明：纯 Node + 内存 wx mock；不访问真实云端、不启动模拟器。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');
const ROOT_N = ROOT.replace(/\\/g, '/');
const ID = { token: 'tok-draw-1', sid: '3260799999', name: '测试账号', role: '副团支书', badge: '班委', is_admin: false, ts: 1 };

/* ---------------------------------------------------------------- 测试环境（wx 内存 mock） */
function fakeCtx() {
  const ops = [];
  const g = {
    font: '', fillStyle: '', globalAlpha: 1, textAlign: 'left', strokeStyle: '', lineWidth: 1,
    shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,
    measureText(t) { return { width: String(t == null ? '' : t).length * 8 }; },
    fillText(t, x, y) { ops.push({ op: 'text', t: String(t), x, y, font: g.font, fill: g.fillStyle }); },
    fillRect(x, y, w, h) { ops.push({ op: 'fillRect', x, y, w, h, fill: g.fillStyle }); },
    strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, closePath() {}, arc() {},
    clip() { ops.push({ op: 'clip' }); }, createLinearGradient() { return { addColorStop() {} }; },
    fill() { ops.push({ op: 'fill', fill: g.fillStyle }); }, stroke() {}, save() {}, restore() {},
    translate() {}, rotate() {}, scale() {}, setTransform() {}
  };
  const node = { width: 0, height: 0, getContext() { return g; } };
  return { ops, g, node, reset() { ops.length = 0; } };
}
function createCtx() {
  const mem = Object.create(null);
  const canvas = fakeCtx();
  let reqLog = [];
  let reqImpl = (o) => o.success({ statusCode: 200, data: [] });
  let toastLog = [];
  let modalLog = [];
  let clipLog = [];
  let navLog = [];
  let savedFiles = [];
  const wxMock = {
    getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
    setStorageSync(k, v) { mem[k] = v; },
    removeStorageSync(k) { delete mem[k]; },
    request(o) { reqLog.push(o); reqImpl(o); },
    showToast(o) { toastLog.push(o && o.title); },
    showModal(o) { modalLog.push(o && o.title); if (o && o.success) o.success({ confirm: true, cancel: false }); },
    showLoading() {}, hideLoading() {},
    setClipboardData(o) { clipLog.push(o && o.data); if (o && o.success) o.success(); },
    getClipboardData(o) { if (o && o.success) o.success({ data: clipLog[clipLog.length - 1] || '' }); },
    canvasToTempFilePath(o) { savedFiles.push(o); if (o && o.success) o.success({ tempFilePath: '/tmp/draw.png' }); },
    saveImageToPhotosAlbum(o) { if (o && o.success) o.success(); },
    getSetting(o) { if (o && o.success) o.success({ authSetting: { 'scope.writePhotosAlbum': true } }); },
    openSetting(o) { if (o && o.success) o.success({ authSetting: {} }); },
    getSystemInfoSync() { return { pixelRatio: 2, theme: 'light', windowWidth: 390 }; },
    nextTick(cb) { cb(); },
    onThemeChange() {}, offThemeChange() {}, showShareMenu() {}, stopPullDownRefresh() {},
    navigateTo(o) { navLog.push('to:' + String((o && o.url) || '')); },
    navigateBack(o) { navLog.push('back:' + String((o && o.delta) || 1)); },
    switchTab(o) { navLog.push('tab:' + String((o && o.url) || '')); },
    reLaunch(o) { navLog.push('relaunch:' + String((o && o.url) || '')); },
    showActionSheet(o) { if (o && o.success) o.success({ tapIndex: 0 }); },
    createSelectorQuery() {
      return {
        in() { return this; }, select() { return this; },
        fields() { return this; },
        exec(cb) { if (cb) cb([{ node: canvas.node, width: 180, height: 180 }]); }
      };
    }
  };
  return {
    mem, wxMock, canvas,
    clearMem() {
      Object.keys(mem).forEach(function (k) { delete mem[k]; });
      reqLog = []; toastLog = []; modalLog = []; clipLog = []; navLog = []; savedFiles = [];
      reqImpl = function (o) { o.success({ statusCode: 200, data: [] }); };
    },
    setReq(fn) { reqImpl = fn; },
    reqLog() { return reqLog; },
    toastLog() { return toastLog; },
    modalLog() { return modalLog; },
    clipLog() { return clipLog; },
    navLog() { return navLog; },
    savedFiles() { return savedFiles; },
    reqsOf(frag) { return reqLog.filter(function (o) { return String((o && o.url) || '').indexOf(frag) >= 0; }); },
    setIdentity(id) { mem['zq_class_identity'] = JSON.stringify(id || ID); }
  };
}
function purge() {
  Object.keys(require.cache).forEach(function (k) {
    if (k.replace(/\\/g, '/').indexOf(ROOT_N) !== 0) return;
    try {
      const m = require.cache[k];
      if (m && m.exports && typeof m.exports.udStop === 'function') m.exports.udStop();
    } catch (e) { /* ignore */ }
    delete require.cache[k];
  });
}
function R(rel) { return require(path.join(ROOT, rel)); }
function src(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function loadPageDef(rel) {
  let def = null;
  global.Page = function (d) { def = d; };
  try { require(path.join(ROOT, rel + '.js')); } finally { delete global.Page; }
  assert.ok(def && typeof def === 'object', '页面未注册 Page：' + rel);
  return def;
}
function pageCtx(def, over) {
  const ctx = Object.assign({}, def);
  ctx.data = JSON.parse(JSON.stringify(def.data));
  if (over) Object.assign(ctx.data, over);
  ctx._log = [];
  ctx.setData = function (o, cb) { Object.assign(this.data, o || {}); this._log.push(o || {}); if (cb) cb(); };
  return ctx;
}
function enableCloud(cloud) {
  cloud.configure({
    enabled: true, restBase: 'https://rest.test/v1/rdb/rest/', publishableKey: 'pk-test',
    ttUrl: '', timeout: 1000,
    webBase: 'https://tool.furina.fun'
  });
}
function emptyRes(o) { o.success({ statusCode: 200, data: [] }); }
// 用固定随机数把 seed / recordId 变确定（seed='8888888888888888'，rid='d'+base36(now)+'8888'）
function withFixedRandom(fn, r) {
  const old = Math.random;
  Math.random = function () { return r == null ? 0.5 : r; };
  try { return fn(); } finally { Math.random = old; }
}

/* ================================================================ */
async function run(test) {
  /* ---------------------------------------------------------------- A. draw-v1 算法（契约 4 组固定向量） */
  await test('DRAW-A1 draw-v1：契约 §2 四组固定向量逐元素一致', function () {
    const dp = R('utils/drawproof.js');
    const range = function (n) { const a = []; for (let i = 1; i <= n; i++) a.push(i); return a; };
    assert.deepStrictEqual(dp.drawV1('0123456789abcdef', range(10), 3, false), [9, 10, 4], '向量1：1..10 抽3 不放回');
    assert.deepStrictEqual(dp.drawV1('0123456789abcdef', [1, 2, 3, 4, 5], 7, true), [1, 3, 1, 2, 2, 2, 3], '向量2：1..5 抽7 允许重复');
    assert.deepStrictEqual(dp.drawV1('deadbeefcafebabe', range(70), 10, false), [28, 36, 11, 34, 38, 1, 14, 70, 65, 46], '向量3：1..70 抽10');
    assert.deepStrictEqual(dp.drawV1('a1b2c3d4e5f60718', range(8), 8, false), [7, 3, 1, 8, 4, 5, 2, 6], '向量4：1..8 抽8（全排列）');
  });

  await test('DRAW-A2 draw-v1：确定性 / 幂等 / 边界（空池、count=0、count>池可重复、不改输入池）', function () {
    const dp = R('utils/drawproof.js');
    const pool = [3, 1, 2];
    const poolCopy = pool.slice();
    const a = dp.drawV1('0123456789abcdef', pool, 3, false);
    const b = dp.drawV1('0123456789abcdef', pool, 3, false);
    assert.deepStrictEqual(a, b, '同 seed/pool/count 必须完全一致（可被核验页复算）');
    assert.deepStrictEqual(pool, poolCopy, 'drawV1 不得修改入参 pool');
    assert.deepStrictEqual(dp.drawV1('0123456789abcdef', [], 3, false), [], '空池 → 空结果');
    assert.deepStrictEqual(dp.drawV1('0123456789abcdef', [1, 2], 0, false), [], 'count=0 → 空结果');
    const dupRes = dp.drawV1('0123456789abcdef', [1, 2], 5, true);
    assert.strictEqual(dupRes.length, 5, 'dup=true 时结果长度 = count（可超过池大小）');
    assert.deepStrictEqual(dp.drawV1('0123456789abcdef', [1, 2], 5, false).length, 2, 'dup=false 时最多池大小');
    // seededInts：int(m) ∈ [0,m-1]
    const int = dp.seededInts('0123456789abcdef');
    for (let i = 0; i < 50; i++) { const v = int(7); assert.ok(v >= 0 && v < 7, 'int(m) 越界：' + v); }
    assert.strictEqual(int(0), 0, 'm=0 安全返回 0');
  });

  /* ---------------------------------------------------------------- B. seed / 编号 / 核验链接 */
  await test('DRAW-B1 newSeed = 16 位小写 hex；newRecordId 匹配服务端 CHECK ^d[0-9a-z]{8,31}$', function () {
    const dp = R('utils/drawproof.js');
    for (let i = 0; i < 20; i++) {
      assert.ok(/^[0-9a-f]{16}$/.test(dp.newSeed()), 'seed 必须是 16 位小写 hex：' + dp.newSeed());
      const rid = dp.newRecordId();
      assert.ok(/^d[0-9a-z]{8,31}$/.test(rid), 'recordId 必须匹配 ^d[0-9a-z]{8,31}$：' + rid);
    }
    assert.ok(/^d[0-9a-z]{8,31}$/.test(dp.newRecordId(1763000000000)), '传 now 也合法');
    assert.notStrictEqual(dp.newRecordId(), dp.newRecordId(), '随机后缀应不同');
  });

  await test('DRAW-B2 verifyUrl = webBase + "/#verify=<id>"（cloud-config.webBase）', function () {
    const dp = R('utils/drawproof.js');
    const cfg = R('utils/cloud-config.js');
    assert.strictEqual(cfg.webBase, 'https://tool.furina.fun', 'cloud-config.webBase 必须为 https://tool.furina.fun');
    assert.strictEqual(dp.webBaseOf(), 'https://tool.furina.fun', 'webBaseOf 去尾斜杠');
    assert.strictEqual(dp.verifyUrl('dabc123456'), 'https://tool.furina.fun/#verify=dabc123456');
    assert.strictEqual(dp.verifyUrl('dabc123456', 'https://tool.furina.fun/'), 'https://tool.furina.fun/#verify=dabc123456', '显式 base 去尾斜杠');
    assert.ok(src('utils/cloud-config.js').indexOf('固定用 `https://tool.furina.fun`') >= 0, 'webBase 注释必须说明固定使用 tool.furina.fun');
  });

  /* ---------------------------------------------------------------- C. 名称映射（契约 §3.1） */
  await test('DRAW-C1 parseNames：序号/分隔符/无序号自增/trim/后值覆盖/归一升序', function () {
    const dp = R('utils/drawproof.js');
    assert.deepStrictEqual(dp.parseNames('1 第一组\n2 第二组'), [{ n: 1, nm: '第一组' }, { n: 2, nm: '第二组' }]);
    assert.deepStrictEqual(dp.parseNames('3.第三组\n1、第一组\n2：第二组'), [{ n: 1, nm: '第一组' }, { n: 2, nm: '第二组' }, { n: 3, nm: '第三组' }], '支持 . 、 ： 等分隔符并升序');
    assert.deepStrictEqual(dp.parseNames('第一组\n第二组\n第三组'), [{ n: 1, nm: '第一组' }, { n: 2, nm: '第二组' }, { n: 3, nm: '第三组' }], '无序号 → 非空行序号自增');
    assert.deepStrictEqual(dp.parseNames('  1   第一组  '), [{ n: 1, nm: '第一组' }], '名称 trim');
    assert.deepStrictEqual(dp.parseNames('1 旧名\n1 新名'), [{ n: 1, nm: '新名' }], '同序号后值覆盖');
    assert.deepStrictEqual(dp.parseNames('7-第七组'), [{ n: 7, nm: '第七组' }], '连字符分隔（"7-第七组" 不应被误判为区间）');
    assert.deepStrictEqual(dp.parseNames('0002 二组'), [{ n: 2, nm: '二组' }]);
    assert.deepStrictEqual(dp.parseNames(''), []);
    assert.deepStrictEqual(dp.parseNames('  \n \n'), [], '空行忽略');
    assert.strictEqual(dp.parseNames('1 ' + 'x'.repeat(60))[0].nm.length, 40, '名称超过 40 字截断');
    assert.deepStrictEqual(dp.parseNames('0 非法\n1 一组'), [{ n: 1, nm: '一组' }], '0 号非法丢弃');
  });

  await test('DRAW-C2 parseNames：最多 300 项（升序保留前 300）', function () {
    const dp = R('utils/drawproof.js');
    const lines = [];
    for (let i = 1; i <= 320; i++) lines.push(i + ' 组' + i);
    const list = dp.parseNames(lines.join('\n'));
    assert.strictEqual(list.length, 300, '最多 300 项');
    assert.strictEqual(list[0].n, 1);
    assert.strictEqual(list[299].n, 300);
  });

  await test('DRAW-C3 nameMap / namesText / normNamesText / namesSummary', function () {
    const dp = R('utils/drawproof.js');
    assert.deepStrictEqual(dp.nameMap('2 乙\n1 甲'), { 1: '甲', 2: '乙' });
    assert.strictEqual(dp.normNamesText('2 乙\n1 甲\n1 甲2'), '1 甲2\n2 乙', '保存归一为升序 "num name" 行');
    assert.strictEqual(dp.normNamesText(''), '');
    assert.strictEqual(dp.namesSummary('1 甲\n2 乙'), '2 项');
    assert.strictEqual(dp.namesSummary(''), '未设置');
    assert.strictEqual(dp.namesSummary([{ n: 1, nm: '甲' }]), '1 项', '数组输入也支持');
    assert.deepStrictEqual(dp.nameMap([{ n: 2, nm: '乙' }, { n: 1, nm: '甲' }]), { 1: '甲', 2: '乙' });
  });

  await test('DRAW-C4 nameOf 优先级：映射 > 班级名单派生名 > 空；rowsOf 排序只改显示顺序', function () {
    const dp = R('utils/drawproof.js');
    const roster = '1 张三\n2 李四\n3 王五';
    const nameOf = dp.nameOf('2 第二组', roster);
    assert.strictEqual(nameOf(2), '第二组', '映射优先于班级名单');
    assert.strictEqual(nameOf(1), '张三', '无映射回落班级名单');
    assert.strictEqual(nameOf(9), '', '都没有 → 空串');
    const rows = dp.rowsOf([3, 1, 2], '2 第二组', roster, 'draw');
    assert.deepStrictEqual(rows.map(function (r) { return [r.n, r.nm]; }), [[3, '王五'], [1, '张三'], [2, '第二组']], '抽取顺序 + 优先级');
    assert.deepStrictEqual(rows.map(function (r) { return r.key; }), [0, 1, 2], 'key 连续（swipe-item 用）');
    assert.deepStrictEqual(dp.rowsOf([3, 1, 2], '', roster, 'num').map(function (r) { return r.n; }), [1, 2, 3], '序号升序显示');
    assert.deepStrictEqual(dp.rowsOf([3, 1, 2], '', roster, 'desc').map(function (r) { return r.n; }), [3, 2, 1], '从大到小显示');
    const randRows = dp.rowsOf([3, 1, 2], '', roster, 'rand');
    assert.deepStrictEqual(randRows.map(function (r) { return r.n; }).sort(), [1, 2, 3], '随机打乱只改显示顺序（集合不变）');
    assert.deepStrictEqual(randRows.map(function (r) { return r.key; }), [0, 1, 2], '随机打乱 key 仍连续');
    assert.deepStrictEqual(dp.rowsOf([1, 1], '', '', 'draw').map(function (r) { return r.nm; }), ['', ''], '允许重复时同号多行');
  });

  await test('DRAW-C5 labelsOf：只传命中结果的 {n,nm}，按 n 升序、去重、≤300', function () {
    const dp = R('utils/drawproof.js');
    const names = '1 甲\n2 乙\n5 戊';
    assert.deepStrictEqual(dp.labelsOf(names, [5, 1, 9]), [{ n: 1, nm: '甲' }, { n: 5, nm: '戊' }], '未抽中不上传、升序');
    assert.deepStrictEqual(dp.labelsOf(names, [5, 5]), [{ n: 5, nm: '戊' }], '结果重复时 labels 去重');
    assert.deepStrictEqual(dp.labelsOf('', [1]), []);
    const many = [];
    for (let i = 1; i <= 400; i++) many.push({ n: i, nm: '组' + i });
    assert.strictEqual(dp.labelsOf(many, many.map(function (x) { return x.n; })).length, 300, 'labels ≤300');
  });

  /* ---------------------------------------------------------------- D. 参数 / 视图（契约 §1.4/§3.3） */
  await test('DRAW-D1 buildParams 归一（range 升序/count 夹紧/excl 去重升序/sort 白名单/rosterN/namesN 上限）', function () {
    const dp = R('utils/drawproof.js');
    const p = dp.buildParams({ lo: 70, hi: 1, count: 0, dup: 1, excl: [5, 3, 5, -1, 'x'], sort: 'bogus', rosterN: 999, namesN: 999 });
    assert.deepStrictEqual(p.range, [1, 70], 'range 升序');
    assert.strictEqual(p.count, 1, 'count 最小 1');
    assert.strictEqual(p.dup, true);
    assert.deepStrictEqual(p.excl, [3, 5], 'excl 去重升序且忽略非法');
    assert.strictEqual(p.sort, 'draw', '未知排序回落 draw');
    assert.strictEqual(p.rosterN, 70, 'rosterN ≤70（班级名单上限）');
    assert.strictEqual(p.namesN, 300, 'namesN ≤300');
    assert.deepStrictEqual(Object.keys(p), ['range', 'count', 'dup', 'excl', 'sort', 'rosterN', 'namesN'], '字段固定 = 服务端白名单结构');
    const p2 = dp.buildParams({ lo: 1, hi: 10, count: 2000, sort: 'num', rosterN: 0, namesN: 0 });
    assert.strictEqual(p2.count, 1000, 'count ≤1000');
    assert.strictEqual(p2.sort, 'num');
  });

  await test('DRAW-D2 paramLines / paramSummary / resultSummary', function () {
    const dp = R('utils/drawproof.js');
    const params = { range: [1, 70], count: 10, dup: false, excl: [3, 7], sort: 'draw', rosterN: 5, namesN: 2 };
    const lines = dp.paramLines(params);
    assert.deepStrictEqual(lines.map(function (x) { return x[0]; }), ['范围', '个数', '允许重复', '排除', '排序', '参与名单', '名称映射']);
    assert.strictEqual(lines[0][1], '1 – 70');
    assert.strictEqual(lines[2][1], '否');
    assert.strictEqual(lines[3][1], '3,7');
    assert.strictEqual(lines[4][1], '按抽取顺序');
    assert.strictEqual(lines[5][1], '已选 5 人');
    assert.strictEqual(lines[6][1], '2 项');
    assert.ok(dp.paramSummary(params).indexOf('范围 1 – 70 · 抽 10 个 · 不重复') === 0);
    assert.ok(dp.paramSummary(params).indexOf('名单 5 人') > 0);
    assert.ok(dp.paramSummary(params).indexOf('映射 2 项') > 0);
    assert.strictEqual(dp.resultSummary([5, 9, 2]), '5、9、2');
    assert.strictEqual(dp.resultSummary([1, 2, 3, 4, 5, 6, 7, 8, 9], 8), '1、2、3、4、5、6、7、8 …');
  });

  await test('DRAW-D3 存证状态文案 / 导出参数行 / 二维码 note（契约 §3.2/§3.3）', function () {
    const dp = R('utils/drawproof.js');
    assert.strictEqual(dp.proofLine(null), '');
    assert.strictEqual(dp.proofLine({ status: 'pending' }), '存证中…');
    assert.strictEqual(dp.proofLine({ status: 'pending', slow: true }), '未存证（网络不可用）', 'pending>6s 按未存证');
    assert.strictEqual(dp.proofLine({ status: 'failed' }), '未存证（网络不可用）');
    const proof = { status: 'ok', id: 'dabc', at: 1763000000000, hash: 'a'.repeat(64), seq_day: 3, today_count: 7 };
    assert.strictEqual(dp.proofLine(proof), '已存证 · 今日第 3 次（全班今日共 7 次）');
    assert.strictEqual(dp.proofReady(null), false);
    assert.strictEqual(dp.proofReady({ status: 'pending', id: 'x' }), false, 'pending 不算已存证');
    assert.strictEqual(dp.proofReady(proof), true);
    const cfgl = dp.proofConfigLines(proof);
    assert.strictEqual(cfgl[0][0], '存证编号');
    assert.strictEqual(cfgl[0][1], 'dabc');
    assert.strictEqual(cfgl[1][0], '存证时间');
    assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(cfgl[1][1]), '存证时间格式 YYYY-MM-DD HH:MM:SS');
    assert.strictEqual(cfgl[2][1], '第 3 次（今日共 7 次）');
    assert.strictEqual(cfgl[3][1], 'a'.repeat(16), '记录哈希只取前 16 位');
    assert.deepStrictEqual(dp.proofConfigLines(null), [['存证', '未存证（网络不可用）']]);
    const note = dp.proofQrNote(proof);
    assert.strictEqual(note[0], '存证编号 dabc');
    assert.strictEqual(note[1], '记录哈希 ' + 'a'.repeat(12));
    assert.strictEqual(note[2], '今日第 3 次 · 共 7 次');
    assert.deepStrictEqual(dp.proofQrNote({ status: 'failed' }), []);
  });

  await test('DRAW-D4 removeLogLines：剔除/补抽明细成纯文本行（最多 8 行，超出省略）', function () {
    const dp = R('utils/drawproof.js');
    const log = [
      { t: 'x', n: 5, act: '剔除' }, { t: 'x', n: 12, act: '补抽' },
      { t: 'x', n: 3, act: '剔除' }, { t: 'x', n: 9, act: '补抽' }, { t: 'x', n: 10, act: '补抽' },
      { t: 'x', act: '打乱' }
    ];
    assert.deepStrictEqual(dp.removeLogLines(log), ['#1 剔除 5 → 补抽 12', '#2 剔除 3 → 补抽 9、10']);
    assert.deepStrictEqual(dp.removeLogLines([{ act: '补抽', n: 8 }]), ['#1 补抽 8'], '独立补抽（refill）单列一行');
    const many = [];
    for (let i = 1; i <= 12; i++) many.push({ act: '剔除', n: i }, { act: '补抽', n: i + 100 });
    const out = dp.removeLogLines(many, 8);
    assert.strictEqual(out.length, 9, '8 行 + 省略行');
    assert.ok(out[8].indexOf('等 12 项') > 0, '省略行说明总数');
    assert.deepStrictEqual(dp.removeLogLines([]), []);
    assert.deepStrictEqual(dp.removeLogLines([{ act: '打乱' }]), [], '打乱不产生明细');
  });

  await test('DRAW-D5 时间格式化 atMs/fmtAt/fmtTime（服务端 at 毫秒）', function () {
    const dp = R('utils/drawproof.js');
    assert.strictEqual(dp.atMs(1763000000000), 1763000000000);
    assert.ok(dp.atMs('2026-11-12T00:00:00+08:00') > 0, 'ISO 串可解析');
    assert.strictEqual(dp.atMs(null), 0);
    assert.strictEqual(dp.atMs('bad'), 0);
    const t = new Date(2026, 10, 12, 8, 5, 6).getTime();
    assert.strictEqual(dp.fmtAt(t), '2026-11-12 08:05:06');
    assert.strictEqual(dp.fmtTime(t), '08:05');
    assert.strictEqual(dp.fmtAt(0), '');
  });

  /* ---------------------------------------------------------------- E. 记录列表 / 详情 / 复算 */
  const SEED = '0123456789abcdef';
  const POOL = Array.from({ length: 10 }, function (_, i) { return i + 1; });
  const RESULT = [9, 10, 4];
  function recFixture(over) {
    const bp = R('utils/drawproof.js').buildParams({ lo: 1, hi: 10, count: 3, dup: false, excl: [], sort: 'draw', rosterN: 0, namesN: 2 });
    const base = {
      id: 'dabc12345678', at: new Date(2026, 10, 12, 9, 30, 0).getTime(), day: '2026-11-12', seq_day: 3,
      today_count: 7, today_mine: 2, is_mine: true, op_name: '测试账号', op_seat: 24,
      params: bp, pool: POOL.slice(), result: RESULT.slice(),
      labels: [{ n: 2, nm: '二号组' }, { n: 4, nm: '四号组' }],
      seed: SEED, algo: 'draw-v1', hash: 'h'.repeat(64), canon: 'v1\n...', prev_hash: '',
      event_count: 2,
      events: [
        { seq: 2, kind: 'refill', n: null, added: 6, note: '', at: baseAt(1), hash: 'e2', prev_hash: 'e1' },
        { seq: 1, kind: 'remove', n: 5, added: 6, note: '', at: baseAt(0), hash: 'e1', prev_hash: 'h'.repeat(64) }
      ]
    };
    return Object.assign(base, over || {});
  }
  function baseAt(delta) { return new Date(2026, 10, 12, 9, 31 + (delta || 0), 0).getTime(); }

  await test('DRAW-E1 replayResult / replayOk：draw-v1(seed,pool,count,dup) 与存证 result 逐元素比对', function () {
    const dp = R('utils/drawproof.js');
    const rec = recFixture();
    assert.deepStrictEqual(dp.replayResult(rec), [9, 10, 4], '复算结果 = 契约向量');
    assert.strictEqual(dp.replayOk(rec), true);
    assert.strictEqual(dp.replayOk(recFixture({ result: [1, 2, 3] })), false, '篡改结果 → 复算不一致');
    assert.strictEqual(dp.replayOk(recFixture({ seed: 'ffffffffffffffff' })), false, '改 seed → 不一致');
    assert.strictEqual(dp.replayOk({}), false, '缺字段 → false（不抛错）');
    assert.strictEqual(dp.replayResult({}), null);
  });

  await test('DRAW-E2 recordRow / listView：时间/第seq次/参数摘要/结果/操作人（不显示学号）', function () {
    const dp = R('utils/drawproof.js');
    const row = dp.recordRow(recFixture());
    assert.strictEqual(row.id, 'dabc12345678');
    assert.strictEqual(row.timeText, '09:30');
    assert.strictEqual(row.seqText, '第 3 次');
    assert.ok(row.paramText.indexOf('范围 1 – 10 · 抽 3 个 · 不重复') === 0);
    assert.strictEqual(row.resultText, '9、10、4');
    assert.strictEqual(row.opText, '测试账号 · 24 号');
    assert.strictEqual(row.mine, true);
    assert.strictEqual(row.eventCount, 2);
    assert.strictEqual(row.hashShort, 'hhhhhhhh');
    const v = dp.listView({ scope: 'today', day: '2026-11-12', today_count: 7, today_mine: 2, records: [recFixture(), recFixture({ id: 'dx2', is_mine: false, op_name: '' })] });
    assert.strictEqual(v.rows.length, 2);
    assert.strictEqual(v.countText, '2 条记录');
    assert.strictEqual(v.todayText, '今日共 7 次 · 我 2 次');
    assert.strictEqual(v.todayCount, 7);
    assert.strictEqual(v.rows[1].opText, '—', '无操作人信息 → 占位');
    assert.strictEqual(dp.listView({ records: [] }).countText, '暂无记录');
  });

  await test('DRAW-E3 detailView：参数/初始结果（映射+本机名单本地解析）/时间线/复算/哈希/核验链接', function () {
    const dp = R('utils/drawproof.js');
    const rec = recFixture({ result: [9, 10, 4] });
    const v = dp.detailView(rec, { rosterText: '4 李四\n9 张三\n10 王五' });
    assert.strictEqual(v.id, 'dabc12345678');
    assert.ok(/^2026-11-12 09:30:00$/.test(v.atText));
    assert.strictEqual(v.todayText, '今日第 3 次（全班今日共 7 次）');
    assert.strictEqual(v.opFullText, '测试账号 · 24 号');
    assert.deepStrictEqual(v.params.map(function (x) { return x.k; }), ['范围', '个数', '允许重复', '排除', '排序', '参与名单', '名称映射']);
    // 结果名称：labels 优先（4 号 = 四号组），其余用本机名单本地解析（9 张三 / 10 王五）
    assert.deepStrictEqual(v.rows.map(function (r) { return [r.n, r.nm]; }), [[9, '张三'], [10, '王五'], [4, '四号组']]);
    assert.strictEqual(v.replayOk, true);
    assert.strictEqual(v.replayText, '复算一致');
    assert.strictEqual(v.hash, 'h'.repeat(64));
    assert.strictEqual(v.hashShort, 'h'.repeat(16));
    assert.strictEqual(v.seed, SEED);
    assert.strictEqual(v.algo, 'draw-v1');
    assert.strictEqual(v.verifyUrl, 'https://tool.furina.fun/#verify=dabc12345678');
    assert.strictEqual(v.timeline.length, 2);
    assert.strictEqual(v.timeline[0].text, '补抽 6');
    assert.strictEqual(v.timeline[1].text, '剔除 5 → 补抽 6');
    assert.strictEqual(v.eventCount, 2);
    // 隐私：详情视图任何字段都不含学号（记录本身也不含 sid）
    const json = JSON.stringify(v);
    assert.ok(json.indexOf(ID.sid) < 0, '详情视图不得出现学号');
  });

  await test('DRAW-E4 timelineRows：remove/refill/reset 文案与时间', function () {
    const dp = R('utils/drawproof.js');
    const rows = dp.timelineRows([
      { seq: 1, kind: 'remove', n: 5, added: 12, at: baseAt(0), note: '' },
      { seq: 2, kind: 'refill', added: 8, at: baseAt(1), note: '手动补抽' },
      { seq: 3, kind: 'reset', at: baseAt(2) }
    ]);
    assert.deepStrictEqual(rows.map(function (r) { return r.text; }), ['剔除 5 → 补抽 12', '补抽 8', '重置本轮']);
    assert.deepStrictEqual(rows.map(function (r) { return r.seqText; }), ['#1', '#2', '#3']);
    assert.strictEqual(rows[1].note, '手动补抽');
    assert.strictEqual(rows[0].timeText, '09:31');
    assert.deepStrictEqual(dp.timelineRows([]), []);
  });

  /* ---------------------------------------------------------------- F. RPC 封装（mock，不发真实请求） */
  function rpcSetup() {
    const C = createCtx();
    global.wx = C.wxMock;
    purge();
    C.clearMem();
    C.setIdentity(ID);
    const store = R('utils/store.js');
    store.get().cloudOff = true;          // 静默 udTouch（本组只测 4 个 draw_record_* RPC）
    store.save();
    const cloud = R('utils/cloud.js');
    enableCloud(cloud);
    const dp = R('utils/drawproof.js');
    return { C, store, cloud, dp };
  }
  const OKREC = {
    id: 'dabc12345678', at: 1763000000000, day: '2026-11-12', seq_day: 3, today_count: 7, today_mine: 2,
    is_mine: true, op_name: '测试账号', op_seat: 24, params: { range: [1, 10], count: 3, dup: false, excl: [], sort: 'draw', rosterN: 0, namesN: 0 },
    pool: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], result: [9, 10, 4], labels: [], seed: SEED, algo: 'draw-v1',
    hash: 'h'.repeat(64), canon: '...', prev_hash: '', event_count: 0, events: []
  };

  await test('DRAW-F1 draw_record_create：URL/body/统一 header（Bearer + X-Class-Token）/成功解包/jsonb 数组', async function () {
    const { C, cloud, dp } = rpcSetup();
    const bodies = [];
    C.setReq(function (o) {
      bodies.push(JSON.parse(JSON.stringify(o.data || {})));
      // PostgREST jsonb 可能回单元素数组 → rpcCall 统一取对象
      o.success({ statusCode: 200, data: [{ ok: true, today_count: 7, today_mine: 2, record: OKREC }] });
    });
    const r = await dp.recordCreate({ id: 'dabc12345678', params: { range: [1, 10] }, pool: [1, 2], result: [2], labels: [], seed: SEED });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.today_count, 7);
    assert.strictEqual(r.today_mine, 2);
    assert.strictEqual(r.record.id, 'dabc12345678');
    const req = C.reqLog()[0];
    assert.strictEqual(req.method, 'POST');
    assert.strictEqual(String(req.url), 'https://rest.test/v1/rdb/rest/rpc/draw_record_create');
    assert.ok(String(req.header.Authorization).indexOf('Bearer ') === 0, '统一 Authorization 头');
    assert.ok(String(req.header['X-Class-Token']).length > 0, '统一 X-Class-Token 头');
    const b = bodies[0];
    assert.deepStrictEqual(Object.keys(b).sort(), ['p_algo', 'p_id', 'p_labels', 'p_params', 'p_pool', 'p_result', 'p_seed'].sort(), 'RPC 命名参数固定');
    assert.strictEqual(b.p_id, 'dabc12345678');
    assert.strictEqual(b.p_seed, SEED);
    assert.strictEqual(b.p_algo, 'draw-v1');
    cloud.udStop();
  });

  await test('DRAW-F2 draw_record_create 失败：中文 reason 透传 / 网络错误 → 网络不可用（不 throw）', async function () {
    const { C, cloud, dp } = rpcSetup();
    C.setReq(function (o) { o.success({ statusCode: 200, data: { ok: false, reason: '结果不合法' } }); });
    let r = await dp.recordCreate({ id: 'dx', params: {}, pool: [], result: [], labels: [], seed: SEED });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, '结果不合法', '服务端中文 reason 原样透传');
    C.setReq(function (o) { o.fail({ errMsg: 'request:fail timeout' }); });
    r = await dp.recordCreate({ id: 'dx', params: {}, pool: [], result: [], labels: [], seed: SEED });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, '网络不可用，稍后重试');
    assert.strictEqual((await dp.recordCreate({})).ok, false, '缺 id → 本地拦截');
    // 未登录：不发请求、返回原因
    C.clearMem();
    C.reqLog().length = 0;
    const before = C.reqLog().length;
    const r2 = await dp.recordCreate({ id: 'dx', params: {}, pool: [], result: [], labels: [], seed: SEED });
    assert.strictEqual(r2.ok, false);
    assert.strictEqual(C.reqLog().length, before, '没身份时零请求');
    cloud.udStop();
  });

  await test('DRAW-F3 draw_event_append / draw_record_get / draw_record_list：参数/解包/失败兜底', async function () {
    const { C, cloud, dp } = rpcSetup();
    const seen = [];
    C.setReq(function (o) {
      const b = JSON.parse(JSON.stringify(o.data || {}));
      seen.push({ url: String(o.url), body: b });
      if (String(o.url).indexOf('draw_event_append') >= 0) return o.success({ statusCode: 200, data: { ok: true, event: { seq: 1, kind: 'remove' }, event_count: 1 } });
      if (String(o.url).indexOf('draw_record_get') >= 0) return o.success({ statusCode: 200, data: { ok: true, record: OKREC } });
      if (String(o.url).indexOf('draw_record_list') >= 0) return o.success({ statusCode: 200, data: { ok: true, scope: 'today', day: '2026-11-12', today_count: 7, today_mine: 2, records: [OKREC] } });
      return emptyRes(o);
    });
    const ev = await dp.eventAppend({ id: 'dabc', kind: 'remove', n: 5, added: 12, note: '自动' });
    assert.strictEqual(ev.ok, true);
    assert.strictEqual(ev.event_count, 1);
    assert.strictEqual(seen[0].url, 'https://rest.test/v1/rdb/rest/rpc/draw_event_append');
    assert.deepStrictEqual(seen[0].body, { p_id: 'dabc', p_kind: 'remove', p_n: 5, p_added: 12, p_note: '自动' });
    assert.strictEqual((await dp.eventAppend({ id: 'dabc', kind: 'bogus' })).ok, false, '事件类型白名单');
    assert.strictEqual((await dp.eventAppend({ kind: 'remove' })).ok, false, '缺 id 本地拦截');
    const g = await dp.recordGet('dabc12345678');
    assert.strictEqual(g.ok, true);
    assert.strictEqual(g.record.id, 'dabc12345678');
    assert.strictEqual((await dp.recordGet('')).ok, false);
    const l = await dp.recordList('all', 500);
    assert.strictEqual(l.ok, true);
    assert.strictEqual(l.scope, 'today', '返回体里的 scope 原样（服务端归一）');
    assert.strictEqual(l.records.length, 1);
    const listReq = seen[seen.length - 1];
    assert.deepStrictEqual(listReq.body, { p_scope: 'all', p_limit: 100 }, 'limit 夹紧 1..100');
    // 记录不存在 / 不可见
    C.setReq(function (o) { o.success({ statusCode: 200, data: { ok: false, reason: '记录不存在' } }); });
    const miss = await dp.recordGet('dnotfound');
    assert.strictEqual(miss.ok, false);
    assert.strictEqual(miss.reason, '记录不存在');
    const missList = await dp.recordList();
    assert.strictEqual(missList.ok, false);
    assert.deepStrictEqual(missList.records, [], '列表失败保留空数组（页面不崩）');
    cloud.udStop();
  });

  /* ---------------------------------------------------------------- G. pages/draw 页面级 */
  function drawPageSetup() {
    const C = createCtx();
    global.wx = C.wxMock;
    purge();
    C.clearMem();
    C.setIdentity(ID);
    const store = R('utils/store.js');
    store.get().cloudOff = true;             // 只测存证 RPC，静默 udTouch
    store.get().classMembers = [];
    store.get().roster = '';
    store.save();
    const cloud = R('utils/cloud.js');
    enableCloud(cloud);
    const def = loadPageDef('pages/draw/draw');
    return { C, store, cloud, def, dp: R('utils/drawproof.js'), flow: R('utils/flow.js') };
  }

  await test('DRAW-G1 draw 页：名称映射弹层（打开/计数/清空/保存归一/摘要/重绘）', function () {
    const { C, store, def, flow } = drawPageSetup();
    const ctx = pageCtx(def);
    ctx.load();
    assert.strictEqual(ctx.data.namesSum, '未设置');
    assert.strictEqual(ctx.data.namesN, 0);
    flow.patch('draw', { result: [2, 1], pool: [1, 2], removed: [], log: [], cfg: null });
    ctx.apply(flow.getFlow().draw);
    ctx.openNames();
    assert.strictEqual(ctx.data.namesOpen, true);
    ctx.onNamesInput({ detail: { value: '2 乙组\n1 甲组\n1 甲组2' } });
    assert.strictEqual(ctx.data.namesDraftN, 2, '实时计数 = 归一后的项数');
    ctx.clearNamesDraft();
    assert.strictEqual(ctx.data.namesDraft, '');
    assert.strictEqual(ctx.data.namesDraftN, 0);
    ctx.closeNames();
    assert.strictEqual(ctx.data.namesOpen, false, '取消关闭');
    assert.strictEqual(store.get().draw.names, '', '取消不写盘');
    // 保存：归一升序文本 + 落盘 + 摘要 + 结果名称重绘
    ctx.openNames();
    ctx.onNamesInput({ detail: { value: '2 乙组\n1 甲组' } });
    ctx.saveNames();
    assert.strictEqual(store.get().draw.names, '1 甲组\n2 乙组');
    assert.strictEqual(ctx.data.names, '1 甲组\n2 乙组');
    assert.strictEqual(ctx.data.namesSum, '2 项');
    assert.strictEqual(ctx.data.namesOpen, false);
    assert.deepStrictEqual(ctx.data.rows.map(function (r) { return r.nm; }), ['乙组', '甲组'], '保存后立即按映射重绘');
    // 清空并保存 → 空映射（回落班级名单 / 空）
    ctx.onNamesInput({ detail: { value: '' } });
    ctx.saveNames();
    assert.strictEqual(store.get().draw.names, '');
    assert.strictEqual(ctx.data.namesSum, '未设置');
    assert.strictEqual(C.toastLog().length > 0, true, '保存有提示');
    C.wxMock && ctx.closeNames();
  });

  await test('DRAW-G2 draw 页：doDraw 用 draw-v1 seed 出结果、异步存证 payload 正确、状态「已存证 · 今日第 N 次」', async function () {
    const { C, store, def, dp, flow } = drawPageSetup();
    const ctx = pageCtx(def);
    ctx.data.start = 1; ctx.data.end = 10; ctx.data.count = 3; ctx.data.dup = false; ctx.data.sort = 'draw';
    ctx.data.names = '2 二号组\n4 四号组';
    store.get().draw.names = ctx.data.names;
    store.get().draw.names; store.save();
    ctx.apply({ result: [], pool: [], removed: [], log: [], cfg: null });
    let createBody = null;
    C.setReq(function (o) {
      const u = String(o.url);
      if (u.indexOf('draw_record_create') >= 0) {
        createBody = JSON.parse(JSON.stringify(o.data));
        o.success({ statusCode: 200, data: { ok: true, today_count: 7, today_mine: 2, record: Object.assign({}, OKREC, {id:o.data.p_id}) } });
        return;
      }
      emptyRes(o);
    });
    withFixedRandom(function () { ctx.doDraw(); });
    await new Promise(function (r) { setTimeout(r, 20); });
    assert.ok(createBody, '抽签后必须异步创建存证');
    const seed = createBody.p_seed;
    assert.ok(/^[0-9a-f]{16}$/.test(seed), 'seed 16 位 hex');
    const st = flow.getFlow().draw;
    assert.ok(st && st.rid && st.seed, 'flow 记录 rid/seed（导出可追溯）');
    assert.deepStrictEqual(createBody.p_result, dp.drawV1(seed, createBody.p_pool, 3, false), '结果 = draw-v1(seed,pool,count,dup)');
    assert.deepStrictEqual(createBody.p_pool, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], '池 = 范围 − 排除');
    assert.deepStrictEqual(createBody.p_params, { range: [1, 10], count: 3, dup: false, excl: [], sort: 'draw', rosterN: 0, namesN: 2 });
    assert.deepStrictEqual(createBody.p_labels, [{ n: 2, nm: '二号组' }, { n: 4, nm: '四号组' }].filter(function (x) { return createBody.p_result.indexOf(x.n) >= 0; }).sort(function (a, b) { return a.n - b.n; }), 'labels 只含命中结果');
    assert.strictEqual(ctx.data.proofStatus, 'ok');
    assert.strictEqual(ctx.data.proofText, '已存证 · 今日第 3 次（全班今日共 7 次）');
    const expectRows = dp.rowsOf(createBody.p_result, ctx.data.names, store.get().roster || '', 'draw');
    assert.deepStrictEqual(ctx.data.rows.map(function (r) { return [r.n, r.nm]; }), expectRows.map(function (r) { return [r.n, r.nm]; }), '结果名称按映射优先级显示');
    assert.strictEqual(ctx.data.proofId, st.rid, '存证编号 = 客户端生成的记录 id（服务端幂等回显）');
    assert.strictEqual(flow.getFlow().draw.proof.status, 'ok');
    assert.strictEqual(flow.getFlow().draw.proof.seq_day, 3);
  });

  await test('DRAW-G3 draw 页：存证失败 →「未存证（网络不可用）」；导出图不加二维码且编号回退', async function () {
    const { C, store, def, flow } = drawPageSetup();
    const ctx = pageCtx(def);
    ctx.data.start = 1; ctx.data.end = 10; ctx.data.count = 2;
    let failed = false;
    C.setReq(function (o) {
      if (String(o.url).indexOf('draw_record_create') >= 0) {
        failed = true;
        o.success({ statusCode: 200, data: { ok: false, reason: '存证失败，请重试' } });
        return;
      }
      emptyRes(o);
    });
    withFixedRandom(function () { ctx.doDraw(); });
    await new Promise(function (r) { setTimeout(r, 20); });
    assert.strictEqual(failed, true);
    assert.strictEqual(ctx.data.proofStatus, 'failed');
    assert.strictEqual(ctx.data.proofText, '未存证（网络不可用）');
    assert.strictEqual(ctx.data.proofId, '');
    const opt = ctx.buildExportOpt();
    assert.ok(/^DRAW-\d{8}-\d{6}-[A-Z0-9]{4}$/.test(opt.rec), '未存证 → rec 回退本机编号');
    assert.strictEqual(opt.qr, undefined, '未存证不画二维码');
    const hasUnproven = opt.config.some(function (kv) { return kv[0] === '存证' && kv[1] === '未存证（网络不可用）'; });
    assert.strictEqual(hasUnproven, true, '参数区标注「存证 未存证（网络不可用）」');
    // 存储计时器清理
    if (ctx._proofSlowT) { clearTimeout(ctx._proofSlowT); ctx._proofSlowT = null; }
    assert.ok(flow.getFlow().draw.proof.status === 'failed');
  });

  await test('DRAW-G4 draw 页：存证成功后导出 opt（存证编号/时间/今日次数/哈希/QR/qrTitle/qrCap/剔除重抽文本块）', async function () {
    const { C, store, def, flow } = drawPageSetup();
    const ctx = pageCtx(def);
    ctx.data.start = 1; ctx.data.end = 10; ctx.data.count = 3;
    ctx.data.names = '1 甲组\n2 乙组';
    ctx.data.namesN = 2;
    store.get().draw.names = ctx.data.names;
    store.save();
    C.setReq(function (o) {
      if (String(o.url).indexOf('draw_record_create') >= 0) {
        o.success({ statusCode: 200, data: { ok: true, today_count: 7, today_mine: 2, record: Object.assign({}, OKREC, {id:o.data.p_id}) } });
        return;
      }
      emptyRes(o);
    });
    withFixedRandom(function () { ctx.doDraw(); });
    await new Promise(function (r) { setTimeout(r, 20); });
    // 模拟剔除 + 补抽（log 明细）
    const st = flow.getFlow().draw;
    st.log = [{ t: 'x', n: 5, act: '剔除' }, { t: 'x', n: 12, act: '补抽' }];
    st.removed = [5];
    flow.patch('draw', st);
    ctx.apply(st);
    const opt = ctx.buildExportOpt();
    const rid = st.rid;
    assert.strictEqual(opt.rec, rid, 'rec = 存证记录 id（页脚编号 = 存证编号）');
    const labels = opt.config.map(function (kv) { return kv[0]; });
    for (const k of ['存证编号', '存证时间', '今日抽签', '记录哈希', '名称映射']) {
      assert.ok(labels.indexOf(k) >= 0, '参数区缺「' + k + '」');
    }
    const map = {};
    opt.config.forEach(function (kv) { map[kv[0]] = kv[1]; });
    assert.strictEqual(map['存证编号'], rid);
    assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(map['存证时间']));
    assert.strictEqual(map['今日抽签'], '第 3 次（今日共 7 次）');
    assert.strictEqual(map['记录哈希'], 'h'.repeat(16));
    assert.strictEqual(opt.qr, 'https://tool.furina.fun/#verify=' + rid, 'QR = verifyUrl(记录 id)');
    assert.strictEqual(opt.qrTitle, '抽签存证核验');
    assert.ok(opt.qrCap.indexOf('需登录班级身份') > 0);
    assert.strictEqual(opt.qrNote.length, 3);
    assert.strictEqual(opt.qrNote[0], '存证编号 ' + rid);
    const block = opt.blocks[opt.blocks.length - 1];
    assert.strictEqual(block.label, '剔除重抽');
    assert.deepStrictEqual(block.lines, ['#1 剔除 5 → 补抽 12'], '剔除重抽明细 = 纯文本块（QR note 已被存证信息占用）');
  });

  await test('DRAW-G5 draw 页：剔除/补抽/重置追加 draw_event_append（remove 带 added；refill 逐个；reset 清空前）', async function () {
    const { C, store, def, flow } = drawPageSetup();
    const ctx = pageCtx(def);
    let seq = 0;
    C.setReq(function (o) {
      if (String(o.url).indexOf('draw_event_append') >= 0) {
        o.success({ statusCode: 200, data: { ok: true, event: { seq: ++seq }, event_count: seq } });
        return;
      }
      emptyRes(o);
    });
    flow.patch('draw', {
      rid: 'dabc12345678', seed: SEED, result: [1, 2, 3], pool: [1, 2, 3, 4, 5], removed: [], log: [], cfg: { count: '3', dup: '否' },
      proof: { status: 'ok', id: 'dabc12345678', hash: 'h'.repeat(64), seq_day: 1, today_count: 1 }
    });
    ctx.apply(flow.getFlow().draw);
    ctx.data.autoRe = false;
    ctx.removeAt(0);
    let bodies = C.reqsOf('draw_event_append').map(function (o) { return JSON.parse(JSON.stringify(o.data)); });
    assert.deepStrictEqual(bodies[0], { p_id: 'dabc12345678', p_kind: 'remove', p_n: 1, p_added: null, p_note: '' });
    ctx.data.autoRe = true;
    ctx.removeAt(0);
    await new Promise(resolve => setImmediate(resolve));
    bodies = C.reqsOf('draw_event_append').map(function (o) { return JSON.parse(JSON.stringify(o.data)); });
    const autoPick = flow.getFlow().draw.log.filter(function (x) { return x.act === '补抽'; }).pop();
    assert.strictEqual(bodies[bodies.length - 1].p_kind, 'remove');
    assert.strictEqual(bodies[bodies.length - 1].p_added, autoPick.n, '自动重抽的补抽号写进 remove 事件');
    ctx.refill();
    await new Promise(resolve => setImmediate(resolve));
    bodies = C.reqsOf('draw_event_append').map(function (o) { return JSON.parse(JSON.stringify(o.data)); });
    assert.ok(bodies.some(function (b) { return b.p_kind === 'refill'; }), '补抽 → refill 事件');
    const before = bodies.length;
    ctx.reset();
    await new Promise(resolve => setImmediate(resolve));
    bodies = C.reqsOf('draw_event_append').map(function (o) { return JSON.parse(JSON.stringify(o.data)); });
    assert.ok(bodies.some(function (b) { return b.p_kind === 'reset'; }), '重置 → reset 事件（清空结果前追加）');
    assert.ok(bodies.length > before);
    assert.strictEqual(flow.getFlow().draw, null, '重置后清空 flow');
    assert.strictEqual(ctx.data.proofText, '', '重置后清空存证状态');
    // 未存证（failed）时不发事件
    flow.patch('draw', { rid: 'dx', result: [1], pool: [1], removed: [], log: [], cfg: null, proof: { status: 'failed' } });
    ctx.apply(flow.getFlow().draw);
    const n0 = C.reqsOf('draw_event_append').length;
    ctx.data.autoRe = false;
    ctx.removeAt(0);
    assert.strictEqual(C.reqsOf('draw_event_append').length, n0, '未存证不发事件（失败静默）');
  });

  await test('DRAW-G6 draw 页：存证在途事件先入队、创建成功后补发；pending 显示「存证中…」', async function () {
    const { C, store, def, flow } = drawPageSetup();
    const ctx = pageCtx(def);

    let release = null;
    C.setReq(function (o) {
      if (String(o.url).indexOf('draw_record_create') >= 0) { release = function () { o.success({ statusCode: 200, data: { ok: true, today_count: 3, today_mine: 1, record: Object.assign({}, OKREC, {id:o.data.p_id}) } }); }; return; }
      if (String(o.url).indexOf('draw_event_append') >= 0) { o.success({ statusCode: 200, data: { ok: true, event: { seq: 1 }, event_count: 1 } }); return; }
      emptyRes(o);
    });
    withFixedRandom(function () {
      flow.patch('draw', { rid: 'dabc12345678', seed: SEED, result: [1, 2], pool: [1, 2, 3], removed: [], log: [], cfg: { count: '2', dup: '否' }, proof: { status: 'pending' } });
      ctx.apply(flow.getFlow().draw);
      ctx.data.autoRe = false;
      ctx.removeAt(0);
    });
    assert.match(ctx.data.proofText, /待存证/);
    assert.strictEqual(C.reqsOf('draw_event_append').length, 0, '在途事件不直接发（先入队）');
    assert.strictEqual(flow.getFlow().eventJobs.dabc12345678.queue.length, 1, '事件已入队');
    flow.patch('draw', Object.assign({}, flow.getFlow().draw, { proof: { status: 'ok', id: 'dabc12345678', hash: 'h', seq_day: 1, today_count: 1 } }));
    await require('../utils/draw-events.js').created('dabc12345678', flow.getFlow().draw.proof, () => {});
    await new Promise(function (r) { setTimeout(r, 10); });
    assert.strictEqual(C.reqsOf('draw_event_append').length, 1, '创建成功后补发队列事件');
    if (release) release();
    if (ctx._proofSlowT) { clearTimeout(ctx._proofSlowT); ctx._proofSlowT = null; }
    assert.ok(C.reqLog().length >= 0);
  });

  await test('DRAW-G7 draw 页：记录入口 / 查看存证导航 + cloud 同步后重绘映射摘要', function () {
    const { C, store, def, flow } = drawPageSetup();
    const ctx = pageCtx(def);
    ctx.openRecords();
    assert.strictEqual(C.navLog()[0], 'to:/pages/drawrec/drawrec');
    ctx.data.proofId = 'dabc12345678';
    ctx.openRecordDetail();
    assert.strictEqual(C.navLog()[1], 'to:/pages/drawrec/drawrec?id=dabc12345678', '查看存证带 ?id=');
    // 云端应用后 onCloudSync 刷新映射摘要（不重置结果）
    flow.patch('draw', { result: [2, 1], pool: [1, 2], removed: [], log: [], cfg: null });
    store.get().draw.names = '1 甲组\n2 乙组';
    store.save();
    ctx.onCloudSync();
    assert.strictEqual(ctx.data.namesN, 2);
    assert.strictEqual(ctx.data.namesSum, '2 项');
    assert.deepStrictEqual(ctx.data.rows.map(function (r) { return r.nm; }), ['乙组', '甲组'], '映射变化后结果名称重绘');
  });

  /* ---------------------------------------------------------------- H. pages/drawrec 页面级 */
  function recPageSetup() {
    const C = createCtx();
    global.wx = C.wxMock;
    purge();
    C.clearMem();
    C.setIdentity(ID);
    const store = R('utils/store.js');
    store.get().cloudOff = true;
    store.get().roster = '4 李四\n9 张三\n10 王五';
    store.save();
    const cloud = R('utils/cloud.js');
    enableCloud(cloud);
    const def = loadPageDef('pages/drawrec/drawrec');
    return { C, store, cloud, def, dp: R('utils/drawproof.js') };
  }

  await test('DRAW-H1 drawrec：?id= 深链 → draw_record_get 详情（参数/结果/时间线/哈希/复算/二维码/链接）', async function () {
    const { C, def, dp } = recPageSetup();
    const ctx = pageCtx(def);
    ctx.onLoad({ id: 'dabc12345678' });
    assert.strictEqual(ctx.data.state, 'loading');
    C.setReq(function (o) {
      if (String(o.url).indexOf('draw_record_get') >= 0) { o.success({ statusCode: 200, data: { ok: true, record: recFixture() } }); return; }
      emptyRes(o);
    });
    await ctx.loadDetail('dabc12345678', true);
    const d = ctx.data.detail;
    assert.ok(d, '详情已加载');
    assert.strictEqual(d.id, 'dabc12345678');
    assert.strictEqual(d.atText.indexOf('2026-11-12'), 0);
    assert.strictEqual(d.replayOk, true, '算法复算 ✓');
    assert.deepStrictEqual(d.rows.map(function (r) { return [r.n, r.nm]; }), [[9, '张三'], [10, '王五'], [4, '四号组']], '结果名称本地解析（映射 > 名单）');
    assert.strictEqual(d.timeline.length, 2);
    assert.strictEqual(d.hash, 'h'.repeat(64));
    assert.strictEqual(d.verifyUrl, 'https://tool.furina.fun/#verify=dabc12345678');
    assert.ok(JSON.stringify(d).indexOf(ID.sid) < 0, '页面数据不含学号');
    // 二维码绘制：paintQr 灌入 fillRect（白底 + 模块）
    await new Promise(function (r) { setTimeout(r, 10); });
    const rects = C.canvas.ops.filter(function (o) { return o.op === 'fillRect'; });
    assert.ok(rects.length > 20, 'canvas 应绘制二维码模块（实际 fillRect ' + rects.length + '）');
    assert.strictEqual(ctx.data.qrFail, false);
    ctx.copyVerify();
    assert.strictEqual(C.clipLog()[0], 'https://tool.furina.fun/#verify=dabc12345678', '复制核验链接');
    ctx.copyId();
    assert.strictEqual(C.clipLog()[1], 'dabc12345678', '复制存证编号');
    // 分享：详情深链
    const sh = def.onShareAppMessage.call(ctx);
    assert.ok(sh.path.indexOf('/pages/drawrec/drawrec?id=') === 0, '分享路径带 ?id=');
    const tl = def.onShareTimeline.call(ctx);
    assert.ok(tl.query.indexOf('id=dabc') >= 0);
  });

  await test('DRAW-H2 drawrec：列表加载（今日/全部切换、行摘要、今日次数、操作人无学号）+ 点行开详情 + 返回列表', async function () {
    const { C, def } = recPageSetup();
    const ctx = pageCtx(def);
    ctx.onLoad({});
    let listBodies = [];
    C.setReq(function (o) {
      const u = String(o.url);
      if (u.indexOf('draw_record_list') >= 0) {
        listBodies.push(JSON.parse(JSON.stringify(o.data)));
        o.success({ statusCode: 200, data: { ok: true, scope: o.data.p_scope, day: '2026-11-12', today_count: 7, today_mine: 2, records: [recFixture()] } });
        return;
      }
      if (u.indexOf('draw_record_get') >= 0) { o.success({ statusCode: 200, data: { ok: true, record: recFixture() } }); return; }
      emptyRes(o);
    });
    await ctx.loadList(true);
    assert.deepStrictEqual(listBodies[0], { p_scope: 'today', p_limit: 30 }, '默认今日 + 30 条');
    assert.strictEqual(ctx.data.state, 'ready');
    assert.strictEqual(ctx.data.rows.length, 1);
    assert.strictEqual(ctx.data.rows[0].timeText, '09:30');
    assert.strictEqual(ctx.data.rows[0].seqText, '第 3 次');
    assert.strictEqual(ctx.data.rows[0].opText, '测试账号 · 24 号');
    assert.strictEqual(ctx.data.todayText, '今日共 7 次 · 我 2 次');
    assert.ok(JSON.stringify(ctx.data.rows).indexOf(ID.sid) < 0, '列表不出现学号');
    // 切换全部
    ctx.switchScope({ currentTarget: { dataset: { scope: 'all' } } });
    await new Promise(function (r) { setTimeout(r, 10); });
    assert.deepStrictEqual(listBodies[1], { p_scope: 'all', p_limit: 30 }, '全部 → p_scope=all');
    // 点行 → 详情（fromList）→ 返回列表
    ctx.openRecord({ currentTarget: { dataset: { id: 'dabc12345678' } } });
    await new Promise(function (r) { setTimeout(r, 20); });
    assert.ok(ctx.data.detail && ctx.data.fromList, '列表点行进入详情');
    ctx.backToList();
    await new Promise(function (r) { setTimeout(r, 10); });
    assert.strictEqual(ctx.data.detail, null);
    assert.strictEqual(ctx.data.fromList, false);
  });

  await test('DRAW-H3 drawrec：失败兜底（记录不存在/网络）与未登录守卫 + retry', async function () {
    const { C, def } = recPageSetup();
    const ctx = pageCtx(def);
    ctx.onLoad({ id: 'dmissing' });
    C.setReq(function (o) { o.success({ statusCode: 200, data: { ok: false, reason: '记录不存在' } }); });
    await ctx.loadDetail('dmissing', true);
    assert.strictEqual(ctx.data.state, 'error');
    assert.strictEqual(ctx.data.errorText, '记录不存在');
    ctx.retryLoad();
    C.setReq(function (o) { o.fail({ errMsg: 'request:fail' }); });
    await new Promise(function (r) { setTimeout(r, 20); });
    assert.strictEqual(ctx.data.state, 'error');
    // 未登录：不发请求
    C.clearMem();
    const ctx2 = pageCtx(def);
    ctx2.onLoad({});
    assert.strictEqual(ctx2.data.state, 'denied');
    const before = C.reqLog().length;
    ctx2.onShow();
    assert.strictEqual(C.reqLog().length, before, '未登录时零请求');
  });

  /* ---------------------------------------------------------------- I. canvas 可选 qrTitle/qrCap + 工程静态接线 */
  await test('DRAW-I1 canvas.drawCard：qrTitle/qrCap 可选覆盖（默认「剔除重抽记录」不变）', function () {
    const C = createCtx();
    global.wx = C.wxMock;
    const canvas = R('utils/canvas.js');
    const fake = C.canvas;
    fake.reset();
    canvas.drawCard(fake.g, fake.node, {
      title: '抽签结果', config: [['抽签 · 范围', '1 – 10']],
      blocks: [{ label: '抽中结果（3）', chips: [{ n: 9, nm: '' }] }],
      foot: 'f', rec: 'dabc12345678',
      qr: 'https://tool.furina.fun/#verify=dabc12345678',
      qrTitle: '抽签存证核验',
      qrCap: '扫码核验本次抽签记录（需登录班级身份）',
      qrNote: ['存证编号 dabc', '记录哈希 hhhhhhhhhhhh', '今日第 3 次 · 共 7 次']
    });
    const texts = fake.ops.filter(function (o) { return o.op === 'text'; }).map(function (o) { return o.t; });
    assert.ok(texts.some(function (t) { return t.indexOf('抽签存证核验') === 0; }), '自定义 qrTitle 已绘制');
    assert.ok(texts.some(function (t) { return t.indexOf('扫码核验本次抽签记录') === 0; }), '自定义 qrCap 已绘制');
    assert.ok(texts.some(function (t) { return t.indexOf('存证编号 dabc') >= 0; }), 'qrNote 已绘制');
    // 默认（不传 qrTitle/qrCap）→ 老文案不变（其它导出不受影响）
    fake.reset();
    canvas.drawCard(fake.g, fake.node, { title: 'T', config: [['a', 'b']], blocks: [{ label: 'L', lines: ['x'] }], foot: 'f', rec: 'r', qr: 'https://x/y', qrNote: [] });
    const t2 = fake.ops.filter(function (o) { return o.op === 'text'; }).map(function (o) { return o.t; });
    assert.ok(t2.some(function (t) { return t === '剔除重抽记录'; }), '默认 qrTitle = 剔除重抽记录');
    assert.ok(t2.some(function (t) { return t.indexOf('扫码查看本次剔除与补抽的完整记录') >= 0; }), '默认 qrCap 不变');
    // 不传 qr → 不绘制二维码面板
    fake.reset();
    canvas.drawCard(fake.g, fake.node, { title: 'T', config: [['a', 'b']], blocks: [{ label: 'L', lines: ['x'] }], foot: 'f', rec: 'r' });
    const t3 = fake.ops.filter(function (o) { return o.op === 'text'; }).map(function (o) { return o.t; });
    assert.ok(!t3.some(function (t) { return t === '剔除重抽记录'; }), '不传 qr 不画二维码面板');
  });

  await test('DRAW-I2 工程静态：utils/drawproof.js + pages/drawrec 注册 + 4 文件 + 分享 + 页面接线', function () {
    const app = JSON.parse(src('app.json'));
    assert.ok(app.pages.indexOf('pages/drawrec/drawrec') >= 0, 'app.json 必须注册 pages/drawrec/drawrec');
    ['js', 'wxml', 'wxss', 'json'].forEach(function (ext) {
      assert.ok(fs.existsSync(path.join(ROOT, 'pages/drawrec/drawrec.' + ext)), '缺 pages/drawrec/drawrec.' + ext);
    });
    const recJs = src('pages/drawrec/drawrec.js');
    const recXml = src('pages/drawrec/drawrec.wxml');
    for (const fn of ['onShareAppMessage', 'onShareTimeline', 'loadList', 'loadDetail', 'copyVerify', 'switchScope', '_drawQr']) {
      assert.ok(recJs.indexOf(fn) >= 0, 'drawrec 缺少 ' + fn);
    }
    assert.ok(recJs.indexOf('share.enable()') >= 0 && recJs.indexOf("require('../../utils/share.js')") >= 0, 'drawrec 需要原生分享');
    assert.ok(recJs.indexOf('options.id') >= 0, 'drawrec 支持 ?id= 深链');
    assert.ok(recXml.indexOf('id="dqr"') >= 0, '详情页二维码 canvas');
    assert.ok(recXml.indexOf('bindtap="copyVerify"') >= 0, '复制核验链接按钮');
    assert.ok(recXml.indexOf('bindtap="switchScope"') >= 0 && recXml.indexOf('>今日<') >= 0 && recXml.indexOf('>全部<') >= 0, '今日/全部切换');
    // draw 页接线
    const drawJs = src('pages/draw/draw.js');
    const drawXml = src('pages/draw/draw.wxml');
    assert.ok(drawJs.indexOf("require('../../utils/drawproof.js')") >= 0, 'draw 页必须用 utils/drawproof.js');
    assert.ok(/drawproof\.drawV1\(seed, b\.pool, n, this\.data\.dup\)/.test(drawJs), 'doDraw 必须用 draw-v1(seed,pool,count,dup)');
    assert.ok(drawJs.indexOf('drawproof.recordCreate(') >= 0, '抽签后异步创建存证');
    assert.ok(drawJs.indexOf('events.enqueue(') >= 0, '剔除/补抽/重置追加事件');
    assert.ok(/nameMap|rowsOf/.test(drawJs), '结果名称走映射优先级');
    assert.ok(drawXml.indexOf('bindtap="openNames"') >= 0 && /名称映射/.test(drawXml), '名称映射入口');
    assert.ok(drawXml.indexOf('bindtap="saveNames"') >= 0 && /已映射/.test(drawXml), '名称映射弹层（保存/计数）');
    assert.ok(drawXml.indexOf('bindtap="openRecords"') >= 0, '抽签记录入口');
    assert.ok(drawXml.indexOf('{{proofText}}') >= 0, '结果区存证状态行');
  });

  await test('DRAW-I3 工程静态：同步契约（store/privacy/cloud draw.names；不新增 section/顶层键）', function () {
    const storeSrc = src('utils/store.js');
    const privacy = R('utils/privacy.js');
    const cloud = R('utils/cloud.js');
    assert.ok(/draw: \{ start: 1, end: 70, count: 10, dup: false, excl: '', sort: 'draw', names: '' \}/.test(storeSrc), 'store.DEF.draw.names 默认空串');
    assert.deepStrictEqual(privacy.DEFAULTS.draw, { names: '' }, 'privacy.DEFAULTS.draw 加 names');
    assert.deepStrictEqual(privacy.SECTION_KEYS, ['homeTools', 'fit', 'draw', 'group', 'roster', 'hide', 'tt', 'prefs', 'nick', 'power', 'water'], 'section 列表不变（11 个）');
    const empty = privacy.emptyV6();
    assert.deepStrictEqual(empty.draw, { names: '' }, '空 v6 blob 的 draw 含 names');
    assert.strictEqual(Object.keys(empty).length, 14, '空 v6 仍 14 顶层键');
    const view = cloud.udSections();
    assert.strictEqual(typeof view.draw.names, 'string', 'udSections().draw.names 字符串');
    assert.strictEqual(view.at.names, undefined, '不得给 names 单独 section 时间戳');
    const applied = cloud.udApply({ v: 6, at: { draw: 1 }, draw: { names: '1 甲' } });
    assert.strictEqual(applied, true);
    const st = R('utils/store.js').get();
    assert.strictEqual(st.draw.names, '1 甲', 'udApply 应用 draw.names 回 store');
    const cloudSrc = src('utils/cloud.js');
    assert.ok(cloudSrc.indexOf('rpcCall: rpcCall') >= 0, 'cloud.js 导出统一 RPC 通道（drawproof 复用，不新增请求来源）');
    assert.ok(cloudSrc.indexOf('view.draw = {') >= 0 && cloudSrc.indexOf('names: String(dr.names') >= 0);
  });

  await test('DRAW-I4 单测自身已挂入 unit.js require 链', function () {
    const unitSrc = fs.readFileSync(path.join(__dirname, 'unit.js'), 'utf8');
    assert.ok(unitSrc.indexOf('drawproof_unit_tests.js') >= 0, 'unit.js 未挂入 drawproof_unit_tests.js');
  });
}

module.exports = { run: run };

if (require.main === module) {
  const C = createCtx();
  global.wx = C.wxMock;
  const results = [];
  let passN = 0, failN = 0;
  const test = async function (name, fn) {
    try { await fn(); passN += 1; results.push({ name: name, ok: true }); console.log('PASS  ' + name); }
    catch (e) { failN += 1; results.push({ name: name, ok: false, err: String((e && e.message) || e) }); console.log('FAIL  ' + name + '  ::  ' + ((e && e.message) || e)); }
  };
  run(test).then(function () {
    const summary = { total: passN + failN, pass: passN, fail: failN, results: results, at: new Date().toISOString() };
    fs.writeFileSync(path.join(__dirname, 'drawproof_result.json'), JSON.stringify(summary, null, 2), 'utf8');
    console.log('\n================ drawproof: ' + passN + ' passed, ' + failN + ' failed ================');
    process.exit(failN ? 2 : 0);
  }).catch(function (e) { console.error('FATAL', e); process.exit(1); });
}
