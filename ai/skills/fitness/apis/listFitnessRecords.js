// ai/skills/fitness/apis/listFitnessRecords.js —— 本机体测历史记录（≤2 条）
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const rec = require('../lib/rec.js');
const guard = require('../lib/guard.js');

module.exports = guard.run(async function listFitnessRecords() {
  const list = rec.getRecs();
  const items = list.map(rec.recItem);
  const pg = guard.page('ft');
  const data = {
    items: items,
    total: items.length,
    pagePath: pg.pagePath,
    pageTitle: pg.pageTitle
  };
  const content = items.length
    ? ('本机共有 ' + items.length + ' 条体测历史记录（最多保留最近 2 条）：' +
       items.map(function (x) { return x.name + '（' + x.total + ' · ' + x.level + '）'; }).join('；') +
       '。需要详情可调用 getFitnessRecord 并传 recordId，或打开体测页查看。')
    : '还没有体测历史记录。可以先用 calculateFitness 算分，用户确认后调用 saveFitnessRecord 保存。';
  return result.ok(content, data, { handoff: handoff.handoffTo('ft', '') });
}, '体测记录');
