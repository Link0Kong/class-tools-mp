// cloudfunctions/notify/rest-config.js —— 通知扫描的 PostgREST 配置（2026-11-11 需求 11）
//
// 云函数定时器要用 PostgREST 轮询 notices 新通知（与小程序端同一个 CloudBase 网关）。
// 这里的默认值 = 小程序 utils/cloud-config.js 的 restBase + publishableKey（公开的 anon 令牌，
// 已随小程序客户端发布，不是高权限密钥）；可用云函数环境变量覆盖，无需改代码：
//   NOTIFY_REST_BASE    PostgREST 基址（结尾带 /）
//   NOTIFY_PUBLIC_KEY   publishableKey（Bearer）
//   NOTIFY_TMPL2        第二模板 ID（可选；留空 = 只用默认模板，向后兼容）
//   NOTIFY_SCAN_MIN_MS  新通知扫描最小间隔（毫秒，默认 5 分钟，定时器可能每分钟触发）
//   NOTIFY_STATE        小程序状态（formal / trial / developer；默认 formal，与 index.js MINI_STATE 一致）
//
// 严禁在此放 appsecret / service_role / 班级 token：班级 token 由客户端 bootstrap 上报，
// 存云开发数据库 notify_cfg 集合（只有本云函数可读），不会写进代码或日志。
module.exports = {
  restBase: process.env.NOTIFY_REST_BASE || 'https://tool-d4gosudok46e0e081.api.tcloudbasegateway.com/v1/rdb/rest/',
  publishableKey: process.env.NOTIFY_PUBLIC_KEY || 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjkwMTNkMzBkLWY3NTEtNGE4Yi05OGNlLTlmNTFiMzk3ZDdjNyJ9.eyJpc3MiOiJodHRwczovL3Rvb2wtZDRnb3N1ZG9rNDZlMGUwODEuYXAtc2hhbmdoYWkudGNiLWFwaS50ZW5jZW50Y2xvdWRhcGkuY29tIiwic3ViIjoiYW5vbiIsImF1ZCI6InRvb2wtZDRnb3N1ZG9rNDZlMGUwODEiLCJleHAiOjQwOTUyNzY4ODAsImlhdCI6MTc5MTU5MzY4MCwibm9uY2UiOiItdGJncVVhcVNZS25jNUx0VmZ2QWZRIiwiYXRfaGFzaCI6Ii10YmdxVWFxU1lLbmM1THRWZnZBZlEiLCJuYW1lIjoiQW5vbnltb3VzIiwic2NvcGUiOiJhbm9ueW1vdXMiLCJwcm9qZWN0X2lkIjoidG9vbC1kNGdvc3Vkb2s0NmUwZTA4MSIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJyb2xlIjoiYW5vbiIsImlzX2Fub255bW91cyI6dHJ1ZSwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiYW5vbnltb3VzIiwicHJvdmlkZXJzIjpbImFub255bW91cyJdfSwidXNlcl9tZXRhZGF0YSI6eyJuYW1lIjoiQW5vbnltb3VzIn0sInVzZXJfdHlwZSI6IiIsImNsaWVudF90eXBlIjoiY2xpZW50X3VzZXIiLCJpc19zeXN0ZW1fYWRtaW4iOmZhbHNlfQ.Iyf827jPzSxTtY6l9tjeRSWG0DVkU8a-sqOcg43b0sP-4CuykUQ_2DpIm3vQSd6t9gDjQRsODpuQzZt4X2iabRr7eahQnB5UFjNuHWBJYtg9O1IZSdx1qfiyQ9NHLHLMOGQKw95E5qhqEs-tQXu-FbASsAl4Y-O_ssL3_OrwFP6qUWfLRb53D0X5gqkumEaKvf-hHhSlyFCzOImKdTKnoI-Qr_N-xa3_WE1AWjGXC_5lo8BhsxZFrGXrkp90eB1kT4303lPA_bzuzP1RXHdrNRmJRbobZmOUUa3k8SoqoeSrizQxCSaL-1oyhZZBFn_zBMpN7wGw0H2uC8I-NTE5Vg',
  secondTmplId: process.env.NOTIFY_TMPL2 || '',
  scanMinMs: Number(process.env.NOTIFY_SCAN_MIN_MS) || 5 * 60 * 1000,
  state: process.env.NOTIFY_STATE || 'formal'
};
