// ai/skills/account/apis/getDataOverview.js —— 我的数据概览（原子接口）
//
// 与主包 pages/data/data.js 的「本机数据」区 + utils/privacy.countsOf 同口径：
//   只报条数/体积，不输出任何名单、通知、作业原文。
const auth = require('../../../common/auth.js');
const local = require('../../../common/local.js');
const rest = require('../../../common/rest.js');
const fmt = require('../../../common/fmt.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const v6 = require('../lib/v6.js');

function hit(o) {
  if (!o || typeof o !== 'object') return 0;
  return Object.keys(o).filter(function (k) { return !!o[k]; }).length;
}
function storageInfo() {
  try {
    const i = wx.getStorageInfoSync ? wx.getStorageInfoSync() : null;
    return {
      keys: (i && i.keys) ? i.keys.length : 0,
      storageKB: Math.round(Number((i && i.currentSize) || 0))
    };
  } catch (e) { return { keys: 0, storageKB: 0 }; }
}

module.exports = function getDataOverview() {
  const id = auth.getIdentity();
  if (!id) return result.identityFail();

  const d = local.readStore();
  const st = storageInfo();
  const counts = {
    homework: (d.homework || []).length,
    notices: (d.notices || []).length,
    marks: hit(d.hwDone) + hit(d.ntPin) + hit(d.ntDone),
    fitRecs: (d.fitRecs || []).length,
    members: (d.classMembers || []).length
  };
  const s = {
    local: st,
    counts: counts,
    cloud: {
      ranges: v6.SCOPE.slice(),
      notDeletable: ['访问统计', '反馈建议']
    },
    pagePath: handoff.PAGES.data,
    pageTitle: '数据与隐私'
  };
  const text = '本机占用约 ' + st.storageKB + ' KB（' + st.keys + ' 个存储键）。当前本机有作业 ' + counts.homework +
    ' 条、通知 ' + counts.notices + ' 条、勾选状态 ' + counts.marks + ' 项、体测记录 ' + counts.fitRecs +
    ' 条、班级名单 ' + counts.members + ' 人。云端同步范围共 ' + v6.SCOPE.length +
    ' 项；访问统计与反馈建议无法删除。需要清理时可以在数据与隐私页操作。';
  return result.ok(text, s, {
    _meta: { cardData: { local: st, counts: counts, ranges: v6.SCOPE.slice(), notDeletable: ['访问统计', '反馈建议'] } },
    handoff: handoff.handoffTo('data', '', { tab: 'overview' })
  });
};
