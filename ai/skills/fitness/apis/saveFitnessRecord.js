// ai/skills/fitness/apis/saveFitnessRecord.js —— 保存体测记录（本机历史 ≤2 条 + 云端 fitrecs）
const local = require('../../../common/local.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const fit = require('../lib/fit.js');
const rec = require('../lib/rec.js');
const guard = require('../lib/guard.js');

module.exports = guard.run(async function saveFitnessRecord(args) {
  if (args.confirmed !== true) {
    return result.needConfirm('保存体测记录会写入本机历史（最多保留最近 2 条，较早记录归档）并同步到云端。请先向用户确认是否保存；用户确认后再调用 saveFitnessRecord 并传 confirmed=true。');
  }
  const b = rec.buildForm(args);
  if (b.err) return result.invalid(b.err);
  const r = fit.ftCalc(b.form);
  if (!r.wtDone) {
    return result.invalid('还没有有效成绩，无法保存：请至少填写一项在合理范围内的成绩（身高 100–250cm、体重 25–200kg、肺活量 500–8000mL、50 米 3–15s、坐位体前屈 -20–40cm、立定跳远 50–350cm、引体 0–100 次、长跑 >0 秒）。');
  }

  // pages/ft saveInput：当前输入写回本机 store.fit
  local.patchStore(function (d) { d.fit = b.form; return d; });
  const stored = local.readStore().fit || b.form;
  const fields = JSON.parse(JSON.stringify(stored));
  const nameIn = args.name == null ? '' : String(args.name).trim().slice(0, 24);

  const list = rec.getRecs();
  const mergeAt = rec.findMergeIndex(list, fields, r.sex, r.gr);
  let recObj, merged = false;
  if (mergeAt >= 0) {
    // 同一份数据只是补填了项目：更新原记录，不新增一条（pages/ft saveRec）
    recObj = list[mergeAt];
    recObj.fields = fields;
    recObj.total = r.total;
    recObj.grade = r.grade;
    recObj._sync = false;
    if (!recObj.name) recObj.name = rec.recName(recObj);
    if (nameIn) recObj.name = nameIn;
    merged = true;
  } else {
    const ts = Date.now();
    recObj = {
      id: rec.cbId(), ts: ts, name: nameIn || ('体测 ' + rec.recDate(ts)),
      sex: r.sex, gr: r.gr, fields: fields,
      total: r.total, grade: r.grade, _sync: false
    };
    list.unshift(recObj);
  }
  const dropped = list.splice(2);   // 只保留最近两条
  rec.setRecs(list);

  // 被挤出的旧记录 → 云端归档（utils/cloud.js fitDelete）
  let droppedArchived = 0;
  for (let i = 0; i < dropped.length; i++) {
    const x = dropped[i];
    if (x && x.id && !x._sync) {
      const ok = await rec.fitDelete(x.id);
      if (ok) droppedArchived += 1;
    }
  }
  // 推送本条（失败置 _sync 待补发，本机数据不受影响）
  let synced = false;
  if (rec.cloudOn()) {
    synced = await rec.fitPush(recObj);
    rec.setRecs(list);
  }

  const pg = guard.page('ft');
  const data = {
    ok: true,
    recordId: String(recObj.id),
    name: recObj.name,
    total: r.total,
    totalText: r.totalText,
    level: r.grade,
    merged: merged,
    synced: synced,
    dropped: dropped.length,
    droppedArchived: droppedArchived,
    pagePath: pg.pagePath,
    pageTitle: pg.pageTitle
  };
  const parts = ['已保存体测记录「' + recObj.name + '」：总评 ' + r.totalText + ' · ' + r.grade];
  if (merged) parts.push('（已合并到原记录，未新增）');
  if (dropped.length) parts.push('本机最多保留最近 2 条，较早的 ' + dropped.length + ' 条已归档');
  parts.push(synced ? '已同步云端' : '云端同步未完成，本机已保存（待补发）');
  parts.push('下一步：可打开体测页查看历史记录。');
  return result.ok(parts.join('；') + '。', data,
    { handoff: handoff.handoffTo('ft', 'recordId=' + encodeURIComponent(String(recObj.id))) });
}, '体测记录');
