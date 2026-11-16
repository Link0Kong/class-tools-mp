// ai/skills/fitness/apis/deleteFitnessRecord.js —— 删除体测历史记录（本机 + 云端归档）
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const rec = require('../lib/rec.js');
const guard = require('../lib/guard.js');

module.exports = guard.run(async function deleteFitnessRecord(args) {
  if (args.confirmed !== true) {
    return result.needConfirm('删除体测记录会同时从本机历史移除，并把云端记录置为归档（不可恢复）。请先向用户确认要删除哪条记录；用户确认后再调用 deleteFitnessRecord 并传 confirmed=true。');
  }
  const id = args.recordId == null ? '' : String(args.recordId).trim();
  if (!id) return result.invalid('缺少 recordId。请先调用 listFitnessRecords 获取 items[].recordId 原值，不要编造。');

  const list = rec.getRecs();
  const idx = rec.findRecIndex(id);
  if (idx < 0) {
    return result.notFound('未找到 recordId=' + id + ' 的体测记录（可能已删除）。请先调用 listFitnessRecords 查看当前记录，不要重复删除。');
  }
  const r = list.splice(idx, 1)[0];
  rec.setRecs(list);

  let archived = false;
  if (rec.cloudOn() && r && r.id) archived = await rec.fitDelete(r.id);

  const pg = guard.page('ft');
  const data = {
    ok: true,
    recordId: String(id),
    name: rec.recName(r),
    archived: archived,
    remaining: rec.getRecs().length,
    pagePath: pg.pagePath,
    pageTitle: pg.pageTitle
  };
  const content = '已删除体测记录「' + data.name + '」，本机剩余 ' + data.remaining + ' 条。' +
    (archived ? '云端记录已归档。' : '云端记录未完成归档（联网后会由下次同步处理）。') +
    '下一步：可打开体测页查看剩余历史。';
  return result.ok(content, data, { handoff: handoff.handoffTo('ft', '') });
}, '体测记录');
