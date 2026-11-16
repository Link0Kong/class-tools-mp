// ai/skills/fitness/apis/renameFitnessRecord.js —— 重命名体测历史记录
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const rec = require('../lib/rec.js');
const guard = require('../lib/guard.js');

module.exports = guard.run(async function renameFitnessRecord(args) {
  const id = args.recordId == null ? '' : String(args.recordId).trim();
  if (!id) return result.invalid('缺少 recordId。请先调用 listFitnessRecords 获取 items[].recordId 原值，不要编造。');
  const name = args.name == null ? '' : String(args.name).trim();
  if (!name) return result.invalid('记录名称不能为空；请让用户给出新名称后再调用。');

  const list = rec.getRecs();
  const idx = rec.findRecIndex(id);
  if (idx < 0) {
    return result.notFound('未找到 recordId=' + id + ' 的体测记录。请先调用 listFitnessRecords 获取有效 recordId，再重试。');
  }
  const r = list[idx];
  r.name = name.slice(0, 24);
  rec.setRecs(list);

  let synced = false;
  if (rec.cloudOn()) {
    synced = await rec.fitPush(r);
    rec.setRecs(list);
  }
  const pg = guard.page('ft');
  const data = {
    ok: true,
    recordId: String(r.id),
    name: r.name,
    synced: synced,
    pagePath: pg.pagePath,
    pageTitle: pg.pageTitle
  };
  const content = '已把体测记录改名为「' + r.name + '」' + (synced ? '，已同步云端' : '，云端同步未完成（本机已保存，待补发）') +
    '。下一步：可打开体测页查看历史记录。';
  return result.ok(content, data, { handoff: handoff.handoffTo('ft', 'recordId=' + encodeURIComponent(String(r.id))) });
}, '体测记录');
