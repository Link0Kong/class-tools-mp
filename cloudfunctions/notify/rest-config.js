// cloudfunctions/notify/rest-config.js —— 通知扫描的 PostgREST 配置（2026-11-11 需求 11）
//
// 云函数定时器要用 PostgREST 轮询 notices 新通知（与小程序端同一个 CloudBase 网关）。
// 云函数独立部署，不能 require 主包 utils/cloud-config.js，公开令牌只通过环境变量注入
// （仓库不保存第二份 JWT）；可用云函数环境变量覆盖，无需改代码：
//   NOTIFY_REST_BASE    PostgREST 基址（结尾带 /）
//   NOTIFY_PUBLIC_KEY   publishableKey（Bearer；未配置时扫描会失败并记录 rest-failed）
//   NOTIFY_TMPL2        第二模板 ID（可选；留空 = 只用默认模板，向后兼容）
//   NOTIFY_SCAN_MIN_MS  新通知扫描最小间隔（毫秒，默认 5 分钟，定时器可能每分钟触发）
//   NOTIFY_STATE        小程序状态（formal / trial / developer；默认 formal，与 index.js MINI_STATE 一致）
//
// 严禁在此放 appsecret / service_role / 班级 token：班级 token 由客户端 bootstrap 上报，
// 存云开发数据库 notify_cfg 集合（只有本云函数可读），不会写进代码或日志。
module.exports = {
  restBase: process.env.NOTIFY_REST_BASE || 'https://tool-d4gosudok46e0e081.api.tcloudbasegateway.com/v1/rdb/rest/',
  publishableKey: process.env.NOTIFY_PUBLIC_KEY || '',
  secondTmplId: process.env.NOTIFY_TMPL2 || '',
  scanMinMs: Number(process.env.NOTIFY_SCAN_MIN_MS) || 5 * 60 * 1000,
  state: process.env.NOTIFY_STATE || 'formal'
};
