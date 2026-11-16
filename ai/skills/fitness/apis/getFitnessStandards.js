// ai/skills/fitness/apis/getFitnessStandards.js —— 国标评分表（20 档 × 6 项）
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const fit = require('../lib/fit.js');
const guard = require('../lib/guard.js');

const ITEMS = [
  { key: 'vc', label: '肺活量', unit: 'mL' },
  { key: 'r50', label: '50 米跑', unit: '秒' },
  { key: 'sit', label: '坐位体前屈', unit: 'cm' },
  { key: 'jump', label: '立定跳远', unit: 'cm' },
  { key: 'pull', label: '引体 / 仰卧', unit: '次' },
  { key: 'dur', label: '1000 / 800 米', unit: '分·秒' }
];

module.exports = guard.run(async function getFitnessStandards(args) {
  const sex = args.sex === 'f' ? 'f' : (args.sex === 'm' ? 'm' : null);
  if (!sex) return result.invalid('sex 需为 m（男）或 f（女）。');
  const gradeRaw = String(args.grade == null ? '' : args.grade);
  const grade = gradeRaw === '12' ? '12' : (gradeRaw === '34' ? '34' : null);
  if (!grade) return result.invalid('grade 需为 12（大一 / 大二）或 34（大三 / 大四）。');

  let only = null;
  if (args.item != null && args.item !== '') {
    only = String(args.item);
    if (!ITEMS.some(function (x) { return x.key === only; })) {
      return result.invalid('item 需为 vc / r50 / sit / jump / pull / dur 之一；不传则返回全部 6 项。');
    }
  }

  const col = fit.ftCol(sex, grade);
  const items = ITEMS.filter(function (it) { return !only || it.key === only; }).map(function (it) {
    let tab, label = it.label, unit = it.unit;
    if (it.key === 'pull') {
      tab = sex === 'f' ? fit.FTB.sup : fit.FTB.pull;
      label = sex === 'f' ? '1 分钟仰卧起坐' : '引体向上';
    } else if (it.key === 'dur') {
      tab = fit.FTB.dur;
      label = sex === 'f' ? '800 米跑' : '1000 米跑';
    } else {
      tab = fit.FTB[it.key];
    }
    const rows = (tab[col] || []).map(function (v, i) {
      return { score: fit.FTS[i], value: it.key === 'dur' ? fit.ftMS(v) : String(v) };
    });
    return { key: it.key, label: label, unit: unit, rows: rows };
  });

  const pg = guard.page('fttable');
  const data = {
    sex: sex,
    grade: grade,
    sexText: sex === 'f' ? '女' : '男',
    gradeText: grade === '34' ? '大三大四' : '大一大二',
    items: items,
    pagePath: pg.pagePath,
    pageTitle: pg.pageTitle
  };
  const query = 'sex=' + sex + '&grade=' + grade + (only ? ('&item=' + only) : '');
  const content = '已给出 ' + data.sexText + ' · ' + data.gradeText + ' 的国标评分表（' + items.length + ' 项，每项 20 档，100 分至 10 分）。' +
    '需要完整表格可打开国标评分表页；算分请用 calculateFitness。';
  return result.ok(content, data, { handoff: handoff.handoffTo('fttable', query) });
}, '国标评分表');
