// ai/skills/fitness/apis/calculateFitness.js —— 计算体测单项 / 总分（国标）
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const fit = require('../lib/fit.js');
const rec = require('../lib/rec.js');
const guard = require('../lib/guard.js');

module.exports = guard.run(async function calculateFitness(args) {
  const b = rec.buildForm(args);
  if (b.err) return result.invalid(b.err);
  const r = fit.ftCalc(b.form);
  const data = Object.assign(rec.calcData(r), {
    sex: r.sex,
    grade: r.gr,
    pagePath: guard.page('ft').pagePath,
    pageTitle: guard.page('ft').pageTitle
  });
  const parts = ['体测总评 ' + r.totalText + ' · ' + r.grade + '（标准分 ' + r.std + (r.plus ? (' + 加分 ' + r.plus) : '') + '）'];
  if (data.bmi != null) parts.push('BMI ' + data.bmiText);
  parts.push(r.miss ? ('有 ' + r.miss + ' 项未填或超出合理范围，已按缺项计') : '七项已填齐');
  parts.push('下一步：需要保存时调用 saveFitnessRecord（需用户确认），或打开体测页查看明细。');
  return result.ok(parts.join('；') + '。', data, { handoff: handoff.handoffTo('ft', '') });
}, '体测成绩');
