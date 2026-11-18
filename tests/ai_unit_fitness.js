/* ai_unit_fitness.js —— 体测（SKILL fitness）原子接口单元测试
 *
 * 运行：cd mp-class-tools-tests && node ai_unit_fitness.js
 * 基座：_ai_harness.js（mock wx / modelContext / storage 夹具）
 *
 * 必须项（CONTRACT §5 T4b / task-4）：
 *   ★ fit 一致性矩阵：ai/skills/fitness/lib/fit.js（移植版）与主包 utils/fit.js 逐项对比
 *     覆盖 男/女 × 12/34 年级 × 每项 20 档阈值 ± 边界 / 离群 / 缺项 / 空表单 —— 输出必须完全一致；
 *   ★ saveFitnessRecord 写入云端 fitrecs 的行格式与 utils/cloud.js fitPush 一致（arch/acc/data/ts、upsert 头）；
 *     本机 fitRecs ≤2 条、补填合并、挤出归档（fitDelete 等价：读整行 → upsert arch=true）。
 * 另覆盖 7 个接口的成功 / 空结果 / 参数错误 / 确认门禁 / 未认证。
 */
'use strict';

const path = require('path');
const H = require('./_ai_harness.js');

// 主包实现（只读对比参照）与移植版（被测）
const MAIN_FIT = require(path.join(H.PROJECT, 'utils', 'fit.js'));
const PORT_FIT = require(path.join(H.PROJECT, 'ai', 'skills', 'fitness', 'lib', 'fit.js'));
// 主包 fitrecs 行格式参照（cloud.fitPush 的 data JSON 字段）
const FIT_ROW_KEYS = ['id', 'ts', 'n', 'sex', 'gr', 'fields', 'total', 'grade'];

function make(opts) {
  opts = opts || {};
  const fx = H.mkFixture(opts.over);
  const storage = Object.assign({}, fx.storage, opts.storage || {});
  if (opts.noIdentity) delete storage.zq_class_identity;
  const routes = opts.routes !== undefined ? opts.routes : [
    { url: /fitrecs\?/, method: 'GET', handler: function (req) { return { statusCode: 200, data: (opts.cloudRows && opts.cloudRows(req)) || [] }; } },
    { url: /fitrecs$/, method: 'POST', handler: function (req) { return { statusCode: 201, data: req.data }; } }
  ];
  const wx = H.createWx({ storage: storage, routes: routes });
  const L = H.loadSkill(wx, 'ai/skills/fitness');
  return {
    fx: fx, wx: wx, L: L,
    call: function (name, args, o) { return H.call(wx, L.apis, name, args || {}, o); }
  };
}
function storeOf(wx) {
  const v = wx.getStorageSync('zq_tools_v2');
  return typeof v === 'string' ? JSON.parse(v) : v;
}
function posts(wx) { return H.requestsMatching(wx, function (r) { return r.method === 'POST' && /fitrecs$/.test(r.url); }); }
function gets(wx) { return H.requestsMatching(wx, function (r) { return r.method === 'GET' && /fitrecs\?/.test(r.url); }); }
function rowOf(req) { return req && req.data && req.data[0] ? req.data[0] : null; }
// 与 utils/cloud.js fitPush 相同的行格式
function assertFitRow(row, recId) {
  H.hasKeys(row, ['id', 'acc', 'data', 'arch', 'ts'], 'fitrecs 行字段');
  H.eq(row.id, recId, '行 id = 记录 id');
  H.eq(row.acc, '3260799999', '行 acc = 身份学号');
  H.eq(row.arch, false, '行 arch=false');
  H.eq(typeof row.ts, 'number');
  const d = JSON.parse(row.data);
  H.deepEq(Object.keys(d).sort(), FIT_ROW_KEYS.slice().sort(), 'data JSON 字段 = cloud.fitPush');
  H.eq(d.id, recId);
  H.eq(typeof d.ts, 'number');
  H.eq(typeof d.n, 'string');
  H.eq(typeof d.total, 'number');
  H.eq(typeof d.grade, 'string');
  H.ok(d.fields && typeof d.fields === 'object', 'data.fields 为对象');
  H.ok(['m', 'f'].indexOf(d.sex) >= 0, 'data.sex = m/f');
  H.ok(['12', '34'].indexOf(d.gr) >= 0, 'data.gr = 12/34');
  return d;
}

// ---- 矩阵工具 ----
function diffCalc(form) {
  const a = MAIN_FIT.ftCalc(form);
  const b = PORT_FIT.ftCalc(form);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error('移植版与主包 ftCalc 输出不一致\n  form=' + JSON.stringify(form) +
      '\n  主包=' + JSON.stringify(a) + '\n  移植=' + JSON.stringify(b));
  }
}
function secToForm(sec) { return { durM: String(Math.floor(sec / 60)), durS: String(sec % 60) }; }
function itemCase(key, value) {
  const c = {};
  if (key === 'dur') { const t = secToForm(value); c.durM = t.durM; c.durS = t.durS; }
  else c[key] = String(value);
  return c;
}

(async function main() {
  /* ================================================================ ★ fit 一致性矩阵 */
  await H.test('fit 表数据 / 辅助函数与主包逐项一致（FTB/FTP/BMI/范围/字段映射）', function () {
    H.deepEq(PORT_FIT.FTS, MAIN_FIT.FTS, 'FTS 分数档');
    H.deepEq(PORT_FIT.FTB, MAIN_FIT.FTB, 'FTB 成绩表');
    H.deepEq(PORT_FIT.FTP, MAIN_FIT.FTP, 'FTP 加分表');
    H.deepEq(PORT_FIT.FTBMI, MAIN_FIT.FTBMI, 'FTBMI 范围');
    H.deepEq(PORT_FIT.FTRANGE, MAIN_FIT.FTRANGE, 'FTRANGE 校验范围');
    H.deepEq(PORT_FIT.FTFIELDS, MAIN_FIT.FTFIELDS, 'FTFIELDS 字段映射');
    ['m', 'f'].forEach(function (sex) {
      ['12', '34'].forEach(function (gr) {
        H.eq(PORT_FIT.ftCol(sex, gr), MAIN_FIT.ftCol(sex, gr), 'ftCol ' + sex + gr);
        H.eq(PORT_FIT.ftCol(sex, gr), (sex === 'f' ? 'f' : 'm') + gr);
      });
    });
    // ftScore / ftPlus 全表扫描
    let n = 0;
    Object.keys(MAIN_FIT.FTB).forEach(function (k) {
      ['m12', 'm34', 'f12', 'f34'].forEach(function (col) {
        const sex = col.charAt(0), gr = col.slice(1);
        const tab = MAIN_FIT.FTB[k];
        const arr = tab[col];
        if (!arr) return;
        arr.forEach(function (v) {
          [v, v - 1, v + 1, v - 0.1, v + 0.1, null].forEach(function (x) {
            if (x != null) {
              H.eq(PORT_FIT.ftScore(tab, x, sex, gr), MAIN_FIT.ftScore(tab, x, sex, gr), 'ftScore ' + k + ' ' + col + ' ' + x);
            } else {
              H.eq(PORT_FIT.ftScore(tab, null, sex, gr), MAIN_FIT.ftScore(tab, null, sex, gr), 'ftScore null');
            }
            n += 1;
          });
        });
      });
    });
    Object.keys(MAIN_FIT.FTP).forEach(function (k) {
      const tab = MAIN_FIT.FTP[k];
      [null, 0, 0.5, 1, 4, 9, 10, 11, 20, 35, 50, 60].forEach(function (gap) {
        H.eq(PORT_FIT.ftPlus(tab, gap), MAIN_FIT.ftPlus(tab, gap), 'ftPlus ' + k + ' gap=' + gap);
        n += 1;
      });
    });
    [null, -1, 0, 1, 120, 197, 250, 372, 800].forEach(function (x) {
      H.eq(PORT_FIT.ftMS(x), MAIN_FIT.ftMS(x), 'ftMS ' + x);
      n += 1;
    });
    [['', ''], ['3', '50'], ['4', '5'], [null, 45], ['4', null], ['abc', '5'], [0, 30], ['16', '40']].forEach(function (p) {
      H.eq(PORT_FIT.ftSec(p[0], p[1]), MAIN_FIT.ftSec(p[0], p[1]), 'ftSec ' + JSON.stringify(p));
      H.eq(PORT_FIT.ftNum(p[0]), MAIN_FIT.ftNum(p[0]), 'ftNum ' + JSON.stringify(p[0]));
      n += 2;
    });
    H.ok(n > 500, '扫描比较次数 ' + n);
  });

  await H.test('fit 矩阵：男女 × 12/34 × 每项 20 档阈值 ± 步长 + 边界/离群/缺项/空表单（输出完全一致）', function () {
    const TABLES = [
      { key: 'vc', tab: 'vc', step: 1 },
      { key: 'r50', tab: 'r50', step: 0.1 },
      { key: 'sit', tab: 'sit', step: 0.1 },
      { key: 'jump', tab: 'jump', step: 1 },
      { key: 'pull', tab: null, step: 1 },   // 男 → FTB.pull，女 → FTB.sup
      { key: 'dur', tab: 'dur', step: 1 }
    ];
    let n = 0;
    ['m', 'f'].forEach(function (sex) {
      ['12', '34'].forEach(function (grade) {
        // 1) 阈值扫描：每项 20 档 × {档值, -步长, +步长}
        TABLES.forEach(function (it) {
          const tableKey = (it.key === 'pull') ? (sex === 'f' ? 'sup' : 'pull') : it.tab;
          const arr = MAIN_FIT.FTB[tableKey][MAIN_FIT.ftCol(sex, grade)];
          H.eq(arr.length, 20, '每项 20 档 ' + tableKey);
          arr.forEach(function (v, i) {
            H.eq(MAIN_FIT.FTS[i] != null, true, 'FTS 档位');
            [v, v - it.step, v + it.step].forEach(function (x) {
              const form = Object.assign({ sex: sex, grade: grade }, itemCase(it.key, x));
              diffCalc(form); n += 1;
            });
          });
        });
        // 2) 完整成绩 + 边界 + 离群 + 缺项 + 空表单
        const full = { sex: sex, grade: grade, h: '175', w: '68', vc: '4200', r50: '7.2', sit: '12.5', jump: '240', pull: sex === 'm' ? '12' : '45', durM: '3', durS: '50' };
        const cases = [
          {},
          { h: '', w: '', vc: '', r50: '', sit: '', jump: '', pull: '', durM: '', durS: '' },
          full,
          { sex: sex, grade: grade, h: '100', w: '25', vc: '500', r50: '3', sit: '-20', jump: '50', pull: '0', durM: '0', durS: '1' },
          { sex: sex, grade: grade, h: '250', w: '200', vc: '8000', r50: '15', sit: '40', jump: '350', pull: '100', durM: '16', durS: '40' },
          { sex: sex, grade: grade, h: '99', w: '24', vc: '499', r50: '2.9', sit: '-20.1', jump: '49', pull: '-1', durM: '0', durS: '0' },
          { sex: sex, grade: grade, h: '251', w: '201', vc: '8001', r50: '15.1', sit: '40.1', jump: '351', pull: '101', durM: '99', durS: '59' },
          { sex: sex, grade: grade, h: '175', w: '68' },
          { sex: sex, grade: grade, durM: '4', durS: '5' },
          { sex: sex, grade: grade, vc: '5040' },
          { sex: sex, grade: grade, h: 'abc', w: '68' },
          { sex: sex, grade: grade, h: '0', w: '0' },
          { sex: sex, grade: grade, h: '100', w: '200' },
          { sex: sex, grade: grade, h: '250', w: '25' },
          full
        ];
        cases.forEach(function (c) {
          const form = Object.assign({}, c, { sex: sex, grade: grade });
          diffCalc(form); n += 1;
        });
        // 3) 加分边界（引体/仰卧/长跑超过满分线的档位）
        const plusRows = sex === 'm' ? MAIN_FIT.FTP.pull : MAIN_FIT.FTP.sup;
        plusRows.forEach(function (p) {
          const base = MAIN_FIT.FTB[sex === 'm' ? 'pull' : 'sup'][MAIN_FIT.ftCol(sex, grade)][0];
          diffCalc(Object.assign({ sex: sex, grade: grade }, itemCase('pull', base + p[0]))); n += 1;
          diffCalc(Object.assign({ sex: sex, grade: grade }, itemCase('pull', base + p[0] - 1))); n += 1;
        });
        (sex === 'm' ? MAIN_FIT.FTP.durM : MAIN_FIT.FTP.durF).forEach(function (p) {
          const best = MAIN_FIT.FTB.dur[MAIN_FIT.ftCol(sex, grade)][0];
          diffCalc(Object.assign({ sex: sex, grade: grade }, itemCase('dur', best - p[0]))); n += 1;
          diffCalc(Object.assign({ sex: sex, grade: grade }, itemCase('dur', best - p[0] + 1))); n += 1;
        });
      });
    });
    H.ok(n > 1500, '矩阵比较次数 ' + n);
  });

  /* ================================================================ 未认证 */
  await H.test('未认证：calculateFitness → identity-required + 身份页 handoff', async function () {
    const m = make({ noIdentity: true });
    const res = await m.call('calculateFitness', { sex: 'm', grade: '12', height: 175 });
    H.isErr(res, 'identity-required');
    H.eq(H.handoffOf(res).path, '/pages/identity/identity');
  });

  /* ================================================================ calculateFitness */
  await H.test('calculateFitness：男 12 全项 → 与主包 ftCalc 结果逐项一致', async function () {
    const m = make();
    const args = {
      sex: 'm', grade: '12', height: 175, weight: 68, vitalCapacity: 4200, run50: 7.2,
      sitReach: 12.5, standingJump: 240, pullUp: 12, run1000: "3'50\""
    };
    const res = await m.call('calculateFitness', args);
    H.isOk(res);
    const sc = res.structuredContent;
    const expect = MAIN_FIT.ftCalc({ sex: 'm', grade: '12', h: '175', w: '68', vc: '4200', r50: '7.2', sit: '12.5', jump: '240', pull: '12', durM: '3', durS: '50' });
    H.eq(sc.total, expect.total);
    H.eq(sc.level, expect.grade);
    H.eq(sc.score, expect.std);
    H.eq(sc.bonus, expect.plus);
    H.eq(sc.bmi, 22.2);
    H.eq(sc.miss, 0);
    H.eq(sc.items.length, 7);
    H.deepEq(sc.items.map(function (x) { return x.key; }), ['bmi', 'vc', 'r50', 'sit', 'jump', 'pull', 'dur']);
    H.eq(sc.items[6].label, '1000 米跑');
    H.eq(sc.items[5].label, '引体向上');
    H.eq(sc.items[6].value, "3'50\"");
    H.eq(sc.pagePath, '/pages/ft/ft');
    H.eq(H.handoffOf(res).query, '');
  });

  await H.test('calculateFitness：女 34 用 sitUp/run800，标签为仰卧起坐/800 米', async function () {
    const m = make();
    const res = await m.call('calculateFitness', {
      sex: 'f', grade: '34', height: 162, weight: 52, vitalCapacity: 3100, run50: 8.0,
      sitReach: 21, standingJump: 195, sitUp: 45, run800: 235
    });
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.items[5].label, '1 分钟仰卧起坐');
    H.eq(sc.items[6].label, '800 米跑');
    H.eq(sc.items[6].value, "3'55\"", '235 秒 = 3\'55"');
    H.eq(sc.level, MAIN_FIT.ftCalc({ sex: 'f', grade: '34', h: '162', w: '52', vc: '3100', r50: '8', sit: '21', jump: '195', pull: '45', durM: '3', durS: '55' }).grade);
  });

  await H.test('calculateFitness：长跑三种格式等价（秒数 / 分\'秒 / 分:秒 / 分秒文本）', async function () {
    const m = make();
    const base = { sex: 'm', grade: '12', vitalCapacity: 4200, run50: 7.2, sitReach: 12.5, standingJump: 240, pullUp: 12 };
    const out = [];
    for (const v of [250, "4'10\"", '4:10', '4分10秒', 250.0]) {
      const r = await m.call('calculateFitness', Object.assign({}, base, { run1000: v }));
      H.isOk(r, '格式 ' + JSON.stringify(v));
      out.push(r.structuredContent.total);
    }
    H.eq(out.filter(function (x) { return x === out[0]; }).length, out.length, '所有格式等价，实际 ' + JSON.stringify(out));
    H.isErr(await m.call('calculateFitness', Object.assign({}, base, { run1000: 'abc' })), 'invalid-input');
  });

  await H.test('calculateFitness：缺项计分（miss）与超范围按缺项，不编造', async function () {
    const m = make();
    const res = await m.call('calculateFitness', { sex: 'm', grade: '12', height: 175, weight: 68, run50: 200 });
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.miss, 6, '七项中只 BMI 有效 → 缺 6 项');
    H.eq(sc.bmi, 22.2);
    H.includes(res.content[0].text, '缺项');
  });

  await H.test('calculateFitness：无任何成绩 / 参数非法 → invalid-input', async function () {
    const m = make();
    H.isErr(await m.call('calculateFitness', { sex: 'm', grade: '12' }), 'invalid-input');
    H.isErr(await m.call('calculateFitness', { sex: 'x', grade: '12', height: 175 }), 'invalid-input');
    H.isErr(await m.call('calculateFitness', { sex: 'm', grade: '13', height: 175 }), 'invalid-input');
    H.isErr(await m.call('calculateFitness', { sex: 'm', grade: '12', height: 'abc' }), 'invalid-input');
  });

  /* ================================================================ getFitnessStandards */
  await H.test('getFitnessStandards：男 12 六项 × 20 档，满分/60 分档与主包表一致', async function () {
    const m = make();
    const res = await m.call('getFitnessStandards', { sex: 'm', grade: '12' });
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.items.length, 6);
    sc.items.forEach(function (it) { H.eq(it.rows.length, 20, it.key + ' 20 档'); });
    H.deepEq(sc.items.map(function (x) { return x.key; }), ['vc', 'r50', 'sit', 'jump', 'pull', 'dur']);
    H.deepEq(sc.items[0].rows[0], { score: 100, value: '5040' });
    H.deepEq(sc.items[0].rows[14], { score: 60, value: '3100' });
    H.deepEq(sc.items[5].rows[0], { score: 100, value: "3'17\"" }, '1000 米 197 秒');
    H.deepEq(sc.items[5].rows[19], { score: 10, value: "6'12\"" }, '1000 米 372 秒');
    H.eq(H.handoffOf(res).query, 'sex=m&grade=12');
    H.eq(sc.pagePath, '/pages/fttable/fttable');
  });

  await H.test('getFitnessStandards：女 34 标签（仰卧起坐 / 800 米）+ item 过滤', async function () {
    const m = make();
    const res = await m.call('getFitnessStandards', { sex: 'f', grade: '34', item: 'pull' });
    H.isOk(res);
    H.eq(res.structuredContent.items.length, 1);
    H.eq(res.structuredContent.items[0].label, '1 分钟仰卧起坐');
    H.deepEq(res.structuredContent.items[0].rows[0], { score: 100, value: '57' });
    const all = await m.call('getFitnessStandards', { sex: 'f', grade: '34', item: 'dur' });
    H.eq(all.structuredContent.items[0].label, '800 米跑');
    H.eq(H.handoffOf(all).query, 'sex=f&grade=34&item=dur');
  });

  await H.test('getFitnessStandards：sex/grade/item 非法 → invalid-input', async function () {
    const m = make();
    H.isErr(await m.call('getFitnessStandards', { sex: 'x', grade: '12' }), 'invalid-input');
    H.isErr(await m.call('getFitnessStandards', { sex: 'm', grade: '99' }), 'invalid-input');
    H.isErr(await m.call('getFitnessStandards', { sex: 'm', grade: '12', item: 'xxx' }), 'invalid-input');
  });

  /* ================================================================ listFitnessRecords */
  await H.test('listFitnessRecords：夹具 2 条记录（recordId/名称/日期/总分/等级/明细）', async function () {
    const m = make();
    const res = await m.call('listFitnessRecords', {});
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.total, 2);
    H.deepEq(sc.items.map(function (x) { return x.recordId; }), ['fit_001', 'fit_002']);
    H.eq(sc.items[0].name, '体测 2026-11-04');
    H.eq(sc.items[0].sexText, '男');
    H.eq(sc.items[0].gradeText, '大一大二');
    H.eq(sc.items[0].total, 82.5);
    H.eq(sc.items[0].level, '良好');
    H.includes(sc.items[0].detail, '身高 175cm');
    H.eq(sc.pagePath, '/pages/ft/ft');
  });

  await H.test('listFitnessRecords：无记录 → 空数组 + 说明（isError=false）', async function () {
    const m = make({ storage: { zq_tools_v2: Object.assign({}, H.mkFixture().STORE, { fitRecs: [] }) } });
    const res = await m.call('listFitnessRecords', {});
    H.isOk(res);
    H.deepEq(res.structuredContent.items, []);
    H.eq(res.structuredContent.total, 0);
    H.includes(res.content[0].text, '还没有体测历史记录');
  });

  /* ================================================================ getFitnessRecord */
  await H.test('getFitnessRecord：返回完整表单 + 重新计算的评分明细', async function () {
    const m = make();
    const res = await m.call('getFitnessRecord', { recordId: 'fit_001' });
    H.isOk(res);
    const r = res.structuredContent.record;
    H.eq(r.recordId, 'fit_001');
    H.eq(r.name, '体测 2026-11-04');
    H.eq(r.sexText, '男');
    H.eq(r.form.height, '175');
    H.eq(r.form.run1000, "3'50\"");
    H.eq(r.score.total, 79.1);
    H.eq(r.score.level, '及格');
    H.eq(H.handoffOf(res).query, 'recordId=fit_001');
  });

  await H.test('getFitnessRecord：recordId 缺失 → invalid-input；不存在 → not-found', async function () {
    const m = make();
    H.isErr(await m.call('getFitnessRecord', {}), 'invalid-input');
    H.isErr(await m.call('getFitnessRecord', { recordId: 'nope' }), 'not-found');
  });

  /* ================================================================ saveFitnessRecord */
  await H.test('saveFitnessRecord：未确认 → need-confirm 且不写本机/云端', async function () {
    const m = make();
    const before = JSON.stringify(storeOf(m.wx).fitRecs);
    const res = await m.call('saveFitnessRecord', { sex: 'm', grade: '12', height: 175, weight: 68 });
    H.isErr(res, 'need-confirm');
    H.eq(JSON.stringify(storeOf(m.wx).fitRecs), before);
    H.eq(posts(m.wx).length, 0);
  });

  await H.test('saveFitnessRecord：同数据补填 → 合并到原记录，不新增；云端 upsert 行格式 = fitPush', async function () {
    const m = make();
    const res = await m.call('saveFitnessRecord', {
      sex: 'm', grade: '12', height: 175, weight: 68, vitalCapacity: 4200, run50: 7.2,
      sitReach: 12.5, standingJump: 240, pullUp: 12, run1000: "3'50\"", confirmed: true
    });
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.merged, true);
    H.eq(sc.recordId, 'fit_001', '合并到夹具 fit_001');
    H.eq(sc.synced, true);
    H.eq(sc.dropped, 0);
    const list = storeOf(m.wx).fitRecs;
    H.eq(list.length, 2, '本机 fitRecs 仍 2 条');
    H.eq(list[0].id, 'fit_001');
    H.eq(list[0].total, 79.1);
    const ps = posts(m.wx);
    H.eq(ps.length, 1, '一次 upsert');
    H.eq(ps[0].header.Prefer, 'return=representation,resolution=merge-duplicates', 'upsert 头 = fitPush');
    assertFitRow(rowOf(ps[0]), 'fit_001');
    H.eq(storeOf(m.wx).fit.pull, '12', 'store.fit = 页面 saveInput 口径');
    H.eq(H.handoffOf(res).query, 'recordId=fit_001');
  });

  await H.test('saveFitnessRecord：新数据 → 新增记录 + 挤出旧记录归档（arch=true）', async function () {
    const m = make({
      cloudRows: function (req) {
        if (/id=eq\.fit_002/.test(req.url)) return [{ id: 'fit_002', acc: '3260799999', data: '{"id":"fit_002"}', arch: false, ts: 1 }];
        return [];
      }
    });
    const res = await m.call('saveFitnessRecord', {
      sex: 'm', grade: '12', height: 175, weight: 70, vitalCapacity: 4200, run50: 7.2,
      sitReach: 12.5, standingJump: 240, pullUp: 12, run1000: "3'50\"", name: '期中体测', confirmed: true
    });
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.merged, false);
    H.eq(sc.name, '期中体测');
    H.eq(sc.dropped, 1, '挤出 1 条旧记录');
    const list = storeOf(m.wx).fitRecs;
    H.eq(list.length, 2);
    H.eq(list[0].name, '期中体测');
    H.eq(list[1].id, 'fit_001', '保留原第一条');
    H.eq(list.filter(function (x) { return x.id === 'fit_002'; }).length, 0, 'fit_002 被挤出');
    // 归档：GET 整行 → POST arch=true（utils/cloud.js cbPatch/fitDelete 等价）
    const gs = gets(m.wx);
    H.ok(gs.length >= 1, '有读整行请求');
    const archPost = posts(m.wx).filter(function (r) { return rowOf(r) && rowOf(r).arch === true; });
    H.eq(archPost.length, 1, '一次归档 upsert');
    H.eq(rowOf(archPost[0]).id, 'fit_002');
    H.eq(rowOf(archPost[0]).arch, true);
    // 新记录 upsert 行
    const newPost = posts(m.wx).filter(function (r) { return rowOf(r) && rowOf(r).arch === false; });
    H.eq(newPost.length, 1, '一次新记录 upsert');
    const d = assertFitRow(rowOf(newPost[0]), sc.recordId);
    H.eq(d.n, '期中体测');
    H.eq(d.total, 79.1);
  });

  await H.test('saveFitnessRecord：云端失败仍本机保存（synced=false, _sync=true 待补发）', async function () {
    const m = make({ routes: [
      { url: /fitrecs$/, method: 'POST', fail: 'request:fail mock' }
    ] });
    const res = await m.call('saveFitnessRecord', { sex: 'm', grade: '12', height: 175, weight: 70, confirmed: true });
    H.isOk(res);
    H.eq(res.structuredContent.synced, false);
    const list = storeOf(m.wx).fitRecs;
    H.eq(list[0]._sync, true, '失败标记待补发');
    H.includes(res.content[0].text, '待补发');
  });

  await H.test('saveFitnessRecord：无有效成绩 / 参数非法 → invalid-input', async function () {
    const m = make();
    H.isErr(await m.call('saveFitnessRecord', { sex: 'm', grade: '12', confirmed: true }), 'invalid-input');
    H.isErr(await m.call('saveFitnessRecord', { sex: 'x', grade: '12', height: 175, confirmed: true }), 'invalid-input');
    H.isErr(await m.call('saveFitnessRecord', { sex: 'm', grade: '12', height: 'abc', confirmed: true }), 'invalid-input');
  });

  /* ================================================================ renameFitnessRecord */
  await H.test('renameFitnessRecord：改名写入本机 + 云端 upsert（无需 confirmed）', async function () {
    const m = make();
    const res = await m.call('renameFitnessRecord', { recordId: 'fit_001', name: '期中体测' });
    H.isOk(res);
    H.eq(res.structuredContent.name, '期中体测');
    H.eq(res.structuredContent.synced, true);
    H.eq(storeOf(m.wx).fitRecs[0].name, '期中体测');
    const ps = posts(m.wx);
    H.eq(ps.length, 1);
    const d = assertFitRow(rowOf(ps[0]), 'fit_001');
    H.eq(d.n, '期中体测');
    H.eq(H.handoffOf(res).query, 'recordId=fit_001');
  });

  await H.test('renameFitnessRecord：空名 / 缺 recordId / 记录不存在', async function () {
    const m = make();
    H.isErr(await m.call('renameFitnessRecord', { recordId: 'fit_001', name: '   ' }), 'invalid-input');
    H.isErr(await m.call('renameFitnessRecord', { name: 'x' }), 'invalid-input');
    H.isErr(await m.call('renameFitnessRecord', { recordId: 'nope', name: 'x' }), 'not-found');
  });

  /* ================================================================ deleteFitnessRecord */
  await H.test('deleteFitnessRecord：未确认 → need-confirm 且不删除', async function () {
    const m = make();
    const before = JSON.stringify(storeOf(m.wx).fitRecs);
    H.isErr(await m.call('deleteFitnessRecord', { recordId: 'fit_002' }), 'need-confirm');
    H.eq(JSON.stringify(storeOf(m.wx).fitRecs), before);
  });

  await H.test('deleteFitnessRecord：删除本机记录 + 云端归档（GET 整行 → upsert arch=true）', async function () {
    const m = make({
      cloudRows: function (req) {
        if (/id=eq\.fit_002/.test(req.url)) return [{ id: 'fit_002', acc: '3260799999', data: '{"id":"fit_002"}', arch: false, ts: 1 }];
        return [];
      }
    });
    const res = await m.call('deleteFitnessRecord', { recordId: 'fit_002', confirmed: true });
    H.isOk(res);
    const sc = res.structuredContent;
    H.eq(sc.archived, true);
    H.eq(sc.remaining, 1);
    const list = storeOf(m.wx).fitRecs;
    H.eq(list.length, 1);
    H.eq(list[0].id, 'fit_001');
    H.eq(gets(m.wx).length, 1, '读整行');
    const arch = posts(m.wx).filter(function (r) { return rowOf(r) && rowOf(r).arch === true; });
    H.eq(arch.length, 1);
    H.eq(rowOf(arch[0]).id, 'fit_002');
  });

  await H.test('deleteFitnessRecord：缺 recordId → invalid-input；不存在 → not-found', async function () {
    const m = make();
    H.isErr(await m.call('deleteFitnessRecord', { confirmed: true }), 'invalid-input');
    H.isErr(await m.call('deleteFitnessRecord', { recordId: 'nope', confirmed: true }), 'not-found');
  });

  /* ================================================================ mcp / 契约细节 */
  await H.test('mcp.json：7 个接口均有 pagePath/componentPath，pagePath 属 ft/fttable；组件 relatedPage 正确', function () {
    const m = make();
    const allow = ['/pages/ft/ft', '/pages/fttable/fttable'];
    m.L.mcp.apis.forEach(function (a) {
      const ui = (a._meta && a._meta.ui) || {};
      H.ok(allow.indexOf(ui.pagePath) >= 0, a.name + ' pagePath ' + ui.pagePath);
      H.ok(typeof ui.componentPath === 'string' && ui.componentPath.length > 0, a.name + ' componentPath');
    });
    H.deepEq(m.L.mcp.components.map(function (c) { return c.relatedPage; }), ['/pages/ft/ft', '/pages/fttable/fttable']);
  });

  await H.test('mcp.json：写接口 confirmed 必填 / recordId 必填声明正确', function () {
    const m = make();
    const byName = {};
    m.L.mcp.apis.forEach(function (a) { byName[a.name] = a; });
    const req = function (n) { return byName[n].inputSchema.required || []; };
    H.ok(req('saveFitnessRecord').indexOf('confirmed') >= 0);
    H.ok(req('deleteFitnessRecord').indexOf('confirmed') >= 0);
    H.ok(req('getFitnessRecord').indexOf('recordId') >= 0);
    H.ok(req('renameFitnessRecord').indexOf('name') >= 0);
    H.ok(req('calculateFitness').indexOf('sex') >= 0 && req('calculateFitness').indexOf('grade') >= 0);
  });

  const rep = H.report('fitness');
  process.exitCode = rep.fail ? 1 : 0;
})().catch(function (e) {
  console.error('fitness 单测自身异常：', e && (e.stack || e));
  process.exitCode = 2;
});
