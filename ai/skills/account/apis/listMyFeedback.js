// ai/skills/account/apis/listMyFeedback.js —— 我的反馈记录（原子接口）
const auth = require('../../../common/auth.js');
const rest = require('../../../common/rest.js');
const fmt = require('../../../common/fmt.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');

const LIMIT = 20;
const CONTENT_MAX = 120;

module.exports = function listMyFeedback() {
  const id = auth.getIdentity();
  if (!id) return result.identityFail();
  if (!rest.isConfigured()) {
    return result.fail('云端服务未配置，暂时查不到反馈记录；稍后再试。', 'cloud-disabled');
  }
  return rest.get(rest.CONFIG.tables.feedback, 'select=*&order=ts.desc').then(function (rows) {
    const mine = (Array.isArray(rows) ? rows : []).filter(function (f) {
      return f && String(f.acc || '') === id.sid;
    }).slice(0, LIMIT);
    const items = mine.map(function (f) {
      const content = String(f.content || '');
      return {
        feedbackId: String(f.id || ''),
        content120: fmt.truncate(content, CONTENT_MAX),
        done: !!f.done,
        tsText: fmt.fmtDateTime(Number(f.ts) || 0)
      };
    });
    const s = {
      total: items.length,
      items: items,
      pagePath: handoff.PAGES.fb,
      pageTitle: '反馈建议'
    };
    let text;
    if (!items.length) {
      text = '你还没有提交过反馈。如果遇到问题或有建议，可以直接告诉我，我帮你提交给管理员。';
    } else {
      const undone = items.filter(function (x) { return !x.done; }).length;
      text = '你共提交过 ' + items.length + ' 条反馈' + (undone ? '，其中 ' + undone + ' 条还未处理' : '，都已被处理') +
        '。最新一条：' + items[0].content120 + (items[0].done ? '（已处理）' : '（待处理）') + '。';
    }
    return result.ok(text, s, {
      _meta: { cardData: { total: items.length, items: items.slice(0, 6) } },
      handoff: handoff.handoffTo('fb', '', { tab: 'mine' })
    });
  }).catch(function (e) {
    return result.fromError(e, '反馈列表');
  });
};
