// ai/common/config.js —— 微信 AI 原子接口环境的云端配置
//
// 说明：
//   * 公开令牌不在本文件复制：统一由主包 utils/cloud-config.js 导出，这里只 require；
//     若独立分包环境无法 require 主包，则 publishableKey 为空 → AI 云端能力不可用（普通页面不受影响），
//     部署时可把 key 放到独立分包的构建变量/配置里再赋给 publishableKey。
//   * 只包含公开 publishable key（随小程序包公开），绝不放 appsecret / 高权限密钥。
//   * 所有数据请求统一走 ai/common/rest.js。
let shared = {};
try { shared = require('../../utils/cloud-config.js') || {}; } catch (e) { shared = {}; }

module.exports = {
  enabled: true,
  restBase: shared.restBase || '',
  publishableKey: shared.publishableKey || '',
  rpc: { verify: 'rpc/class_verify', members: 'rpc/class_members' },
  ttUrl: 'https://tool.furina.fun/tt.json',
  timeout: 15000,
  tables: {
    homework: 'homework',
    notices: 'notices',
    marks: 'marks',
    userdata: 'userdata',
    feedback: 'feedback',
    fitrecs: 'fitrecs',
    visits: 'visits'
  }
};
