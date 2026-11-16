// ai/skills/account/apis/submitFeedback.js —— 提交反馈建议（原子接口）
//
// 平台通过 _meta.context.query 透传本轮用户原文（mcp.json 已声明），模型参数缺失时用它兜底，
// 避免让模型复述原文导致内容丢失。云端契约与主包 cloud.fbSend 一致：
//   public.feedback { id, content, contact, acc(学号), done, ts }
// 1.5.2 起不再收集 QQ / 微信联系方式：contact 列保留（兼容表结构与旧数据），新提交固定空串。
const auth = require('../../../common/auth.js');
const rest = require('../../../common/rest.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');

const MAX_CONTENT = 500;

function cbId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

module.exports = function submitFeedback(args, context) {
  const id = auth.getIdentity();
  if (!id) return result.identityFail();

  const a = args || {};
  const query = String((context && context.query) || '').trim();
  let content = String(a.content == null ? '' : a.content).trim();
  if (!content) content = query;                 // 声明了原文透传：参数缺失时用本轮原文兜底
  if (!content) {
    return result.invalid('缺少反馈内容。请让用户先说明要反馈的问题或建议，再重新提交。');
  }
  if (content.length > MAX_CONTENT) {
    return result.invalid('反馈内容过长（最多 ' + MAX_CONTENT + ' 字）。请精简后重新提交，不要截断用户原意。');
  }
  if (!rest.isConfigured()) {
    return result.fail('云端服务未配置，暂时无法提交反馈。可以稍后再试。', 'cloud-disabled');
  }

  const row = {
    id: cbId(),
    content: content,
    contact: '',
    acc: id.sid,
    done: false,
    ts: Date.now()
  };
  return rest.post(rest.CONFIG.tables.feedback, [row]).then(function () {
    const s = {
      ok: true,
      feedbackId: row.id,
      pagePath: handoff.PAGES.fb,
      pageTitle: '反馈建议'
    };
    const text = '反馈已提交给管理员。管理员处理后可以在反馈页看到状态；需要的话可以查看我的反馈记录。';
    return result.ok(text, s, {
      _meta: { cardData: { ok: true, feedbackId: row.id, content120: content.length > 120 ? content.slice(0, 120) + '…' : content } },
      handoff: handoff.handoffTo('fb', '', { tab: 'mine' })
    });
  }).catch(function (e) {
    return result.fromError(e, '反馈');
  });
};
