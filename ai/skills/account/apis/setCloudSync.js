// ai/skills/account/apis/setCloudSync.js —— 打开 / 关闭云同步（原子接口）
const auth = require('../../../common/auth.js');
const local = require('../../../common/local.js');
const marks = require('../../../common/marks.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');

module.exports = function setCloudSync(args) {
  const id = auth.getIdentity();
  if (!id) return result.identityFail();

  const a = args || {};
  if (typeof a.enabled !== 'boolean') {
    return result.invalid('enabled 必须为 true（打开云同步）或 false（关闭，仅本机）。请按接口说明重新传参。');
  }
  const enabled = a.enabled;
  local.setCloudOff(!enabled);
  const off = !enabled;

  const done = function (extraText) {
    const s = {
      ok: true,
      off: off,
      pagePath: handoff.PAGES.data,
      pageTitle: '数据与隐私'
    };
    const text = off
      ? '已切换为「仅本机」：不再拉取或推送云端数据，本机功能不受影响；本机改动会进入待补发队列，重新打开云同步后自动补发。'
      : ('已重新开启云同步，' + (extraText || '本机待补发的改动会自动补发，并拉取一次云端数据。'));
    return result.ok(text, s, {
      _meta: { cardData: { off: off, enabled: !off } },
      handoff: handoff.handoffTo('data', '', { tab: 'sync' })
    });
  };

  if (!enabled) return done();
  // 打开时顺带补发本机待补发的勾选状态（失败不影响开关本身，下次主包同步会补）
  return marks.flushPending().then(function (r) {
    return done(r && r.count ? '已补发 ' + r.count + ' 条本机改动，' : '');
  }).catch(function () {
    return done();
  });
};
