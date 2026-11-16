// ai/common/result.js —— 原子接口统一返回结构与标准文案
//
// 平台约定（见 _ai_task/CONTRACT.md §4 / 官方「接入方式」）：
//   { isError, content:[{type:'text',text}], structuredContent?, _meta?, handoff?, apiCalls? }
//   * isError:true → 不渲染卡片，content 用于引导下一步
//   * content 文字 = 「事实 + 下一步动作」，不要写死回复格式
//   * 未认证统一 identityFail()（引导打开身份页）
const handoff = require('./handoff.js');

const T = {
  IDENTITY_REQUIRED: '班级数据需要先完成身份验证（学号+姓名）。请打开身份验证页完成验证，然后回到对话重试。',
  NETWORK: '网络不可用，请检查网络后重试；已在本机保存的数据不受影响。',
  CLOUD_DISABLED: '云端服务暂不可用，请稍后重试。',
  NOT_FOUND: '没有找到对应的数据。请确认名称或编号是否正确，必要时先调用列表接口获取有效 ID，不要编造。',
  INVALID_INPUT: '入参不完整或格式不正确，请按接口说明补齐后重试。',
  CONFIRM: '该操作会修改班级数据。请先向用户确认操作内容，用户确认后再调用本接口并传 confirmed=true。'
};

function ok(text, structuredContent, extra) {
  const r = { isError: false, content: [{ type: 'text', text: String(text || '') }] };
  if (structuredContent && typeof structuredContent === 'object') r.structuredContent = structuredContent;
  if (extra && typeof extra === 'object') Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
  return r;
}

function fail(text, code, extra) {
  const r = {
    isError: true,
    content: [{ type: 'text', text: String(text || '') }],
    structuredContent: { error: { code: code || 'error' } }
  };
  if (extra && typeof extra === 'object') Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
  return r;
}

function needConfirm(text, extra) {
  return fail(text || T.CONFIRM, 'need-confirm', extra);
}

// 未认证：带 handoff 到身份页（页面路径在 mcp.json 里声明）
function identityFail(extra) {
  return fail(T.IDENTITY_REQUIRED, 'identity-required', Object.assign({
    handoff: handoff.handoffTo('identity', '', { reason: 'identity-required' })
  }, extra || {}));
}

// REST 错误 → 标准失败结果（e.code 见 ai/common/rest.js）
function fromError(e, what) {
  const code = (e && e.code) || 'error';
  if (code === 'identity-required') return identityFail();
  if (code === 'network' || code === 'timeout') return fail(T.NETWORK, code);
  if (code === 'cloud-disabled') return fail(T.CLOUD_DISABLED, code);
  if (code === 'http4xx') return fail('请求被云端拒绝（' + (what || '数据') + '）。请确认身份有效、数据归属正确后重试。', code);
  return fail('服务暂时不可用，请稍后重试。', code);
}

function invalid(text) { return fail(text || T.INVALID_INPUT, 'invalid-input'); }
function notFound(text) { return fail(text || T.NOT_FOUND, 'not-found'); }

module.exports = {
  T: T, ok: ok, fail: fail, needConfirm: needConfirm, identityFail: identityFail,
  fromError: fromError, invalid: invalid, notFound: notFound
};
