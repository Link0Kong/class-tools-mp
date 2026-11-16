// ai/skills/account/apis/clearCloudData.js —— 清除云端「我的数据」（原子接口，破坏性操作）
//
// 与主包 cloud.udClearCloud 同口径（RLS 无 DELETE，只能覆盖/置否/归档）：
//   1) userdata 覆盖为空 v6；
//   2) marks 本人全部行 upsert val=false；
//   3) fitrecs 本人未归档行 upsert arch=true（保留 data 原文）；
//   4) 本机：udCache 置为「本机现值基线」+ 30 天抑制期，避免清完立刻被自动回写；本机勾选状态清空。
// 访问统计（visits）与反馈（feedback）无法删除，内容如实说明。
const auth = require('../../../common/auth.js');
const local = require('../../../common/local.js');
const rest = require('../../../common/rest.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const v6 = require('../lib/v6.js');

const HOLD_MS = 30 * 24 * 60 * 60 * 1000;

const CONFIRM_TEXT = '尚未执行：清除云端我的数据会把「我的数据」覆盖为空、勾选状态全部置否、体测记录归档；' +
  '访问统计与反馈建议无法删除；本机内容保留。请先向用户确认是否清除，用户确认后再次调用并传 confirmed=true。';

module.exports = function clearCloudData(args) {
  const id = auth.getIdentity();
  if (!id) return result.identityFail();
  const a = args || {};
  if (a.confirmed !== true) return result.needConfirm(CONFIRM_TEXT);

  if (!rest.isConfigured()) return result.fail('云端服务未配置，无法清除云端数据。', 'cloud-disabled');
  const before = local.readStore();
  if (before.cloudOff) return result.fail('云同步已关闭（仅本机），无法清除云端数据。请先打开云同步再试。', 'cloud-off');

  const sid = id.sid;
  const now = Date.now();
  let markN = 0;
  let fitN = 0;

  return rest.upsert(rest.CONFIG.tables.userdata, [{ id: sid, blob: v6.emptyBlob(), ts: now }])
    .then(function () {
      return rest.get(rest.CONFIG.tables.marks, 'select=*&seat=eq.' + encodeURIComponent(sid));
    })
    .then(function (rows) {
      const offs = v6.marksOffRows(rows, sid, now);
      markN = offs.length;
      if (!offs.length) return null;
      return rest.upsert(rest.CONFIG.tables.marks, offs);
    })
    .then(function () {
      return rest.get(rest.CONFIG.tables.fitrecs,
        'select=*&acc=eq.' + encodeURIComponent(sid) + '&arch=eq.false');
    })
    .then(function (list) {
      const rows = (Array.isArray(list) ? list : []).filter(function (r) { return !!(r && r.id); });
      fitN = rows.length;
      if (!rows.length) return null;
      const ups = rows.map(function (r) {
        return Object.assign({}, r, { arch: true, ts: now });
      });
      return rest.upsert(rest.CONFIG.tables.fitrecs, ups);
    })
    .then(function () {
      local.patchStore(function (d) {
        d.udCache = v6.baselineBlob(d, now);
        d.udHoldUntil = now + HOLD_MS;
        d.udPend = false;
        d.markPend = [];
        d.hwDone = {};
        d.ntPin = {};
        d.ntDone = {};
        return d;
      });
      local.setAgentCache('lastSyncAt', now);
      const s = {
        ok: true,
        cleared: { userdata: true, marks: markN, fitrecs: fitN },
        pagePath: handoff.PAGES.data,
        pageTitle: '数据与隐私'
      };
      const text = '已清除云端我的数据：我的数据覆盖为空、' + markN + ' 条勾选状态置否、' + fitN +
        ' 条体测记录归档。访问统计与反馈建议无法删除；本机内容保留。' +
        '在用户下次修改同步内容前，不会自动把本机内容回写云端。';
      return result.ok(text, s, {
        _meta: { cardData: { cleared: s.cleared, hold: true } },
        handoff: handoff.handoffTo('data', '', { tab: 'privacy' })
      });
    })
    .catch(function (e) {
      return result.fail('清除云端数据未完成：' + ((e && e.code === 'network') ? '网络不可用' : '服务暂时不可用') +
        '。已成功写入的部分不会回滚，请稍后在「数据与隐私」页重试。', (e && e.code) || 'error');
    });
};
