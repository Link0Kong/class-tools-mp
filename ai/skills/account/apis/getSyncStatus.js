// ai/skills/account/apis/getSyncStatus.js —— 云同步状态（原子接口，未验证身份也可调用）
const auth = require('../../../common/auth.js');
const local = require('../../../common/local.js');
const rest = require('../../../common/rest.js');
const fmt = require('../../../common/fmt.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');

// 上次同步时间：优先 userdata 基线里的 section 时间戳，其次 AI 侧记录的同步时间
function lastSyncAt(d) {
  let at = 0;
  const cache = d.udCache;
  if (cache && cache.at && typeof cache.at === 'object') {
    Object.keys(cache.at).forEach(function (k) { at = Math.max(at, Number(cache.at[k]) || 0); });
  }
  const agent = Number(local.getAgentCache('lastSyncAt')) || 0;
  return Math.max(at, agent);
}

module.exports = function getSyncStatus() {
  const id = auth.getIdentity();
  const d = local.readStore();
  const pending = (d.markPend || []).length + (d.udPend ? 1 : 0);
  const holdUntil = Number(d.udHoldUntil) || 0;
  const hold = holdUntil > Date.now();
  const at = lastSyncAt(d);
  const networkEnabled = rest.isConfigured();
  const s = {
    verified: !!id,
    off: !!d.cloudOff,
    hold: hold,
    pending: pending,
    lastSyncText: at ? fmt.fmtDateTime(at) : '',
    network: { enabled: networkEnabled },
    pagePath: handoff.PAGES.data,
    pageTitle: '数据与隐私'
  };

  const parts = [];
  if (!networkEnabled) {
    parts.push('当前云端服务未配置或不可用，只能使用本机数据。');
  } else if (!id) {
    parts.push('还没有完成班级身份验证，云同步尚未启用。');
  } else if (d.cloudOff) {
    parts.push('云同步已关闭，当前为「仅本机」模式，不再拉取或推送云端数据。');
  } else {
    parts.push('云同步已开启。');
    if (at) parts.push('上次同步：' + s.lastSyncText + '。');
    else parts.push('本机还没有同步记录，可以立即同步一次。');
    if (pending) parts.push('有 ' + pending + ' 条本机改动待补发，联网后会自动补发。');
  }
  if (hold) parts.push('最近清除过云端数据，在用户修改同步内容前不会自动回写云端。');
  if (!id) parts.push('完成身份验证后可以在「数据与隐私」页打开云同步。');
  else if (!d.cloudOff && networkEnabled && !pending) parts.push('需要手动刷新时可以立即同步。');

  return result.ok(parts.join(''), s, {
    _meta: { cardData: { verified: s.verified, off: s.off, hold: s.hold, pending: pending, lastSyncText: s.lastSyncText, networkEnabled: networkEnabled } },
    handoff: handoff.handoffTo('data', '', { tab: 'sync' })
  });
};
