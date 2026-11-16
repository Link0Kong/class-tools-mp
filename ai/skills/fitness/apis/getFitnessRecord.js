// ai/skills/fitness/apis/getFitnessRecord.js —— 读取一条体测历史记录（完整表单 + 评分）
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const fit = require('../lib/fit.js');
const rec = require('../lib/rec.js');
const guard = require('../lib/guard.js');

module.exports = guard.run(async function getFitnessRecord(args) {
  const id = args.recordId == null ? '' : String(args.recordId).trim();
  if (!id) return result.invalid('缺少 recordId。请先调用 listFitnessRecords 获取 items[].recordId 原值，不要编造。');
  const r = rec.findRec(id);
  if (!r) {
    return result.notFound('未找到 recordId=' + id + ' 的体测记录。请先调用 listFitnessRecords 获取有效 recordId，再重试。');
  }
  const form = rec.formFromRec(r);
  const score = fit.ftCalc(form);
  const pg = guard.page('ft');
  const data = {
    record: {
      recordId: String(r.id),
      name: rec.recName(r),
      dateText: rec.recDate(r.ts),
      ts: r.ts || 0,
      sex: form.sex,
      sexText: form.sex === 'f' ? '女' : '男',
      grade: form.grade,
      gradeText: form.grade === '34' ? '大三大四' : '大一大二',
      form: {
        height: form.h, weight: form.w, vitalCapacity: form.vc, run50: form.r50,
        sitReach: form.sit, standingJump: form.jump,
        pullUp: form.sex === 'm' ? form.pull : '', sitUp: form.sex === 'f' ? form.pull : '',
        run1000: form.sex === 'm' ? (form.durM + "'" + (String(form.durS || 0).length < 2 ? '0' : '') + (form.durS || 0) + '"') : '',
        run800: form.sex === 'f' ? (form.durM + "'" + (String(form.durS || 0).length < 2 ? '0' : '') + (form.durS || 0) + '"') : '',
        durM: form.durM,
        durS: form.durS
      },
      score: rec.calcData(score)
    },
    pagePath: pg.pagePath,
    pageTitle: pg.pageTitle
  };
  const content = '已找到体测记录「' + data.record.name + '」（' + data.record.dateText + '，' + data.record.sexText + ' · ' + data.record.gradeText +
    '）：总评 ' + score.totalText + ' · ' + score.grade + '。下一步：可打开体测页回填该记录，或调用 listFitnessRecords 查看其他记录。';
  return result.ok(content, data, { handoff: handoff.handoffTo('ft', 'recordId=' + encodeURIComponent(String(r.id))) });
}, '体测记录');
