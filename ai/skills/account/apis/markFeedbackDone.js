// ai/skills/account/apis/markFeedbackDone.js —— 标记反馈已处理（原子接口，仅管理员）
//
// 与主包 pages/fb/fb.js 的「标记已处理」一致：读整行 → 幂等 upsert（小程序不支持 PATCH）。
// 该操作可逆（done=false 可撤销），不属于破坏性操作，不强制 confirmed。
const auth = require('../../../common/auth.js');
const rest = require('../../../common/rest.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');

module.exports = function markFeedbackDone(args) {
  const id = auth.getIdentity();
  if (!id) return result.identityFail();
  if (!id.is_admin) {
    return result.fail('只有管理员可以标记反馈为已处理。可以把这条反馈交给管理员处理，或查看自己的反馈记录。', 'forbidden');
  }
  const a = args || {};
  const feedbackId = String(a.feedbackId == null ? '' : a.feedbackId).trim();
  if (!feedbackId) {
    return result.invalid('缺少 feedbackId。请先调用 listMyFeedback 获取反馈 ID，再重试；不要编造 ID。');
  }
  if (feedbackId.length > 80) return result.invalid('feedbackId 格式不正确，请使用接口返回的原值。');
  const done = a.done === undefined ? true : !!a.done;
  if (!rest.isConfigured()) return result.fail('云端服务未配置，暂时无法标记反馈。', 'cloud-disabled');

  return rest.byId(rest.CONFIG.tables.feedback, feedbackId).then(function (row) {
    if (!row) {
      return result.notFound('没有找到 ID 为 ' + feedbackId + ' 的反馈。请先从反馈列表获取有效 ID，再重试。');
    }
    const merged = {
      id: row.id,
      content: row.content || '',
      contact: row.contact || '',
      acc: row.acc || '',
      done: done,
      ts: row.ts || Date.now()
    };
    return rest.upsert(rest.CONFIG.tables.feedback, [merged]).then(function () {
      const s = {
        ok: true,
        feedbackId: String(row.id),
        done: done,
        pagePath: handoff.PAGES.fb,
        pageTitle: '反馈建议'
      };
      const text = done ? '已把这条反馈标记为已处理。' : '已把这条反馈改回未处理。';
      return result.ok(text, s, {
        _meta: { cardData: { feedbackId: String(row.id), done: done, content120: String(row.content || '').slice(0, 120) } },
        handoff: handoff.handoffTo('fb', '', { tab: 'all' })
      });
    });
  }).catch(function (e) {
    return result.fromError(e, '反馈');
  });
};
