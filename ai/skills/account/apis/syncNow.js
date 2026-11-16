// ai/skills/account/apis/syncNow.js —— 立即同步四类小表（原子接口）
//
// 口径与主包 pages/data/data.js 的「立即同步」一致（cloud.cloudPull(force=true) 的子集）：
//   marks / homework / fitrecs / userdata 逐个刷新；通知整表太重，不在本接口拉取。
const auth = require('../../../common/auth.js');
const local = require('../../../common/local.js');
const rest = require('../../../common/rest.js');
const fmt = require('../../../common/fmt.js');
const marks = require('../../../common/marks.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const sync = require('../lib/sync.js');

module.exports = function syncNow() {
  const id = auth.getIdentity();
  if (!id) return result.identityFail();

  const d = local.readStore();
  if (!rest.isConfigured()) {
    return result.fail('云端服务未配置，暂时无法同步；本机数据不受影响。', 'cloud-disabled');
  }
  if (d.cloudOff) {
    return result.fail('云同步已关闭（仅本机），无法立即同步。请先打开云同步开关，再让我同步。', 'cloud-off');
  }

  const sid = id.sid;
  return Promise.all([
    marks.pullMarks(),
    sync.pullHomework(sid),
    sync.pullFitRecs(sid),
    sync.pullUserdata(sid)
  ]).then(function (r) {
    const refreshed = {
      marks: !!(r[0] && r[0].ok),
      homework: !!(r[1] && r[1].ok),
      fitrecs: !!(r[2] && r[2].ok),
      userdata: !!(r[3] && r[3].ok)
    };
    const at = Date.now();
    local.setAgentCache('lastSyncAt', at);
    return marks.flushPending().catch(function () { return null; }).then(function () {
      const ok = refreshed.marks && refreshed.homework && refreshed.fitrecs && refreshed.userdata;
      const names = { marks: '勾选状态', homework: '作业', fitrecs: '体测记录', userdata: '我的数据' };
      const failed = Object.keys(refreshed).filter(function (k) { return !refreshed[k]; });
      const s = {
        ok: ok,
        refreshed: refreshed,
        at: at,
        pagePath: handoff.PAGES.data,
        pageTitle: '数据与隐私'
      };
      const text = ok
        ? ('已刷新勾选状态、作业、体测记录和我的数据（' + fmt.fmtTime(at) + '）。通知整表较大，不在这里刷新；需要的话可以查看通知页。')
        : ('部分数据刷新失败：' + failed.map(function (k) { return names[k] || k; }).join('、') + '。本机数据不受影响，可以稍后再试。');
      return result.ok(text, s, {
        _meta: { cardData: { ok: ok, refreshed: refreshed, at: at } },
        handoff: handoff.handoffTo('data', '', { tab: 'sync' })
      });
    });
  }).catch(function (e) {
    return result.fromError(e, '同步');
  });
};
