// utils/cloud-config.js —— 云端配置（唯一需要你自己填的文件）
//
// 说明：
//   * 本文件是「用户可替换的配置常量」；只包含 CloudBase PostgREST 地址与公开的 publishable key，
//     不含 appsecret / service_role 等高权限密钥。
//   * publishableKey 是「只读/公开」用的匿名令牌，会随请求发到客户端，
//     因此只放公开令牌，绝不要把 appsecret / service_role 之类的高权限密钥写在这里。
//   * 同一环境还提供两个班级身份 RPC（见 rpc 字段）：
//       POST rpc/class_verify   {p_sid,p_name}       → 身份 token + 姓名/学号/角色/徽章/管理员标识
//       POST rpc/class_members  {}（带 X-Class-Token）→ 全班名单 [{seat,sid,name,role,badge,is_admin}]
//     这是 v12 / 1.3.0 之后唯一的身份来源；旧的账号密码 users 表不再使用。
//   * 发布前请把 restBase 的域名加进小程序后台 → 开发管理 → 服务器域名 → request 合法域名（详见 README.md）。
//   * 留空或 enabled:false 时，小程序完全离线运行：所有功能可用、数据只落本机存储、
//     不发任何网络请求、不报错；但身份验证依赖云端，离线时无法进入工作台。
//   * v19 起「所有用户改动的内容」（勾选 / 抽签 / 分组 / 点名 / 隐藏 / 偏好等）也走 userdata v6
//     与 marks 同步；用户可在「我的 → 数据与隐私」关闭云同步（cloudOff，仅本机）。

module.exports = {
  // 填好 restBase 与 publishableKey 后改为 true 即可开启同步
  enabled: true,

  // PostgREST 风格的 REST 基址，结尾必须有 '/'
  restBase: 'https://tool-d4gosudok46e0e081.api.tcloudbasegateway.com/v1/rdb/rest/',

  // 匿名可用的公开令牌（Bearer）
  publishableKey: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjkwMTNkMzBkLWY3NTEtNGE4Yi05OGNlLTlmNTFiMzk3ZDdjNyJ9.eyJpc3MiOiJodHRwczovL3Rvb2wtZDRnb3N1ZG9rNDZlMGUwODEuYXAtc2hhbmdoYWkudGNiLWFwaS50ZW5jZW50Y2xvdWRhcGkuY29tIiwic3ViIjoiYW5vbiIsImF1ZCI6InRvb2wtZDRnb3N1ZG9rNDZlMGUwODEiLCJleHAiOjQwOTUyNzY4ODAsImlhdCI6MTc5MTU5MzY4MCwibm9uY2UiOiItdGJncVVhcVNZS25jNUx0VmZ2QWZRIiwiYXRfaGFzaCI6Ii10YmdxVWFxU1lLbmM1THRWZnZBZlEiLCJuYW1lIjoiQW5vbnltb3VzIiwic2NvcGUiOiJhbm9ueW1vdXMiLCJwcm9qZWN0X2lkIjoidG9vbC1kNGdvc3Vkb2s0NmUwZTA4MSIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJyb2xlIjoiYW5vbiIsImlzX2Fub255bW91cyI6dHJ1ZSwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiYW5vbnltb3VzIiwicHJvdmlkZXJzIjpbImFub255bW91cyJdfSwidXNlcl9tZXRhZGF0YSI6eyJuYW1lIjoiQW5vbnltb3VzIn0sInVzZXJfdHlwZSI6IiIsImNsaWVudF90eXBlIjoiY2xpZW50X3VzZXIiLCJpc19zeXN0ZW1fYWRtaW4iOmZhbHNlfQ.Iyf827jPzSxTtY6l9tjeRSWG0DVkU8a-sqOcg43b0sP-4CuykUQ_2DpIm3vQSd6t9gDjQRsODpuQzZt4X2iabRr7eahQnB5UFjNuHWBJYtg9O1IZSdx1qfiyQ9NHLHLMOGQKw95E5qhqEs-tQXu-FbASsAl4Y-O_ssL3_OrwFP6qUWfLRb53D0X5gqkumEaKvf-hHhSlyFCzOImKdTKnoI-Qr_N-xa3_WE1AWjGXC_5lo8BhsxZFrGXrkp90eB1kT4303lPA_bzuzP1RXHdrNRmJRbobZmOUUa3k8SoqoeSrizQxCSaL-1oyhZZBFn_zBMpN7wGw0H2uC8I-NTE5Vg',

  // 班级身份 RPC（CloudBase PostgreSQL 函数名；一般不用改）
  rpc: {
    verify: 'rpc/class_verify',
    members: 'rpc/class_members'
  },

  // 课表静态快照（legacy 兜底，只读）：2026-11-07 起课表优先读 CloudBase `site_assets` 行
  // （id='tt'，走统一 request 通道带 publishableKey + X-Class-Token）；该 CloudBase 请求失败
  // （网络 / 404 / 格式错）才回退到这里。保留该域名是为了兼容：仍建议把域名加进
  // 小程序后台 → 开发管理 → 服务器域名 → request 合法域名（不添加则 legacy 兜底不可用，只显示本机缓存）。
  // 留空则 CloudBase 失败后直接 reject（只用本机缓存 / 旧课表数据）。
  ttUrl: 'https://tool.furina.fun/tt.json',

  // 网页版站点基址（只用于生成「抽签存证核验链接」= webBase + '/#verify=<recordId>'，
  // 小程序不向该域名发请求，因此不需要配到 request 合法域名；用户扫码后在浏览器打开核验页）。
  // 2026-11-14 撤销临时域名：固定用 `https://tool.furina.fun`（契约 web/draw/CONTRACT.md §4）；
  // 该域名 DNS/备案恢复前，二维码核验链接暂不可用，等 furina 恢复后自动生效。
  webBase: 'https://tool.furina.fun',

  // 文件传输（临时云空间）后端：ECS drop 服务（契约 web/drop/CONTRACT.md v2.2）。
  // 留空 = 开发版默认直连 ECS 测试地址（仅开发者工具，勾「不校验合法域名」）；
  // 体验版/正式版默认 https://tool.furina.fun/drop（体验版与正式版都强制 HTTPS + 合法域名，不能用 IP/http）。
  // 发布前请把 https://tool.furina.fun 同时加入微信后台「request 合法域名」与「downloadFile 合法域名」
  // （需 DNS 恢复 + HTTPS 启用；若临时换域名，这里填该域名的 HTTPS drop 地址）。
  // 2026-11-14 撤销临时域名：恢复 `''`（留空 = 开发版默认直连 ECS 测试地址；
  // 体验版/正式版等 tool.furina.fun DNS/备案恢复后再配微信合法域名，见上）。
  dropBase: '',

  // 单次请求超时（毫秒）
  timeout: 8000,

  // 表名（与网页版同一批表；一般不用改）
  tables: {
    homework: 'homework',  // 作业：{id, subject, content, due, date, author, owner, attachments, done, archived, ts}
    notices: 'notices',    // 通知：{id, title, body, imp, pin, author, owner, attachments, archived, ts}
    marks: 'marks',        // 勾选状态：{id: sid|kind|ref, seat, kind('hw'|'nt'|'ntdone'), ref, val, ts}
    userdata: 'userdata',  // 用户数据 v6：{id: 学号, blob: JSON字符串, ts}（CONTRACT §3）
    feedback: 'feedback',  // 反馈：{id, content, contact, acc, done, ts}
    fitrecs: 'fitrecs',    // 体测记录：{id, acc, data, arch, ts}
    visits: 'visits',      // 访问统计：{id: sid|slot, slot, sid, name, did, ts}
    // 站点静态资源（2026-11-07 课表去域名化）：id='tt' 行 body=课表对象 {c,t,meta}，meta={source,fetchedAt,...}
    siteAssets: 'site_assets',
    // 2026-11-09 PPT 演示（契约 web/ppt/CONTRACT.md §3）：
    //   pptDecks  演示文件行（status 状态机 / manifest 播放清单 / cover_url）
    //   pptChunks 上传分片暂存（512KiB/片 base64；转换机取走后立即删除）
    pptDecks: 'ppt_decks',
    pptChunks: 'ppt_upload_chunks'
  }
};
