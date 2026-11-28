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
//   * 2026-11-23 网站域名 tool.furina.fun 的 ICP 备案已通过（网站备案号 闽ICP备2026042939号-2）；
//     小程序自身备案号见 utils/compliance.js（闽ICP备2026042939号，保持不变、不带 -2）。
//     域名相关配置（dropBase / ttLegacy）已按正式域名恢复。
//   * 2026-11-28 P4 生产切流完成：数据与身份全部落 ECS（PostgreSQL + PostgREST），
//     CloudBase 仅保留到 2026-12-10 到期前供旧版客户端与回滚使用。

// ================================================================
// REST base 两档（2026-11-18 自建后端切流；2026-11-28 P4 已完成）
// ----------------------------------------------------------------
// 后端从腾讯云 CloudBase 迁到自建（阿里云 ECS · PostgreSQL 18 + PostgREST 13），
// API 路径/语义与 CloudBase 完全一致，客户端切流只改「档位」一个常量；
// 2026-11-28 切流：生产 Caddy 的 /v1/rdb/rest/* 已指向 ECS 本地 PostgREST。
//
//   cloudbase  ：腾讯云 CloudBase 网关；仅回滚/旧版用，2026-12-10 到期
//   selfhosted ：正式域名 https://tool.furina.fun/v1/rdb/rest/（生产档）
//
// 两档使用同一份 publishableKey（自建网关剥离 Authorization 头时，
// RLS 仍按 X-Class-Token 校验，客户端鉴权逻辑无需改动）。
// 切流/回滚：只改 ACTIVE_REST_PROFILE 一行 → 重新上传发布即可。
// 2026-11-28 P4 切流已完成：生产 = selfhosted（Caddy → ECS 自建 PostgREST）。
// cloudbase 档只保留到腾讯云 CloudBase 2026-12-10 到期前，作旧版/回滚通道。
const REST_PROFILES = {
  cloudbase: 'https://tool-d4gosudok46e0e081.api.tcloudbasegateway.com/v1/rdb/rest/',
  selfhosted: 'https://tool.furina.fun/v1/rdb/rest/'
};
// 当前档位：'cloudbase' | 'selfhosted'（2026-11-28 切流后 = selfhosted；CloudBase 到期后不可再回滚）
const ACTIVE_REST_PROFILE = 'selfhosted';

// 档位 → REST 根（未知档位回退到当前档位，避免配置写错时整个站点离线）
function resolveRestBase(profile) {
  const key = String(profile == null ? '' : profile).trim();
  if (key && REST_PROFILES[key]) return REST_PROFILES[key];
  return REST_PROFILES[ACTIVE_REST_PROFILE] || REST_PROFILES.cloudbase;
}

module.exports = {
  // 填好 restBase 与 publishableKey 后改为 true 即可开启同步
  enabled: true,

  // 当前 REST 档位（只读；切流改上面的 ACTIVE_REST_PROFILE）
  restProfile: ACTIVE_REST_PROFILE,
  // 档位地址表（只读；供诊断/测试展示，正常业务不要直接改这里）
  restProfiles: REST_PROFILES,
  // PostgREST 风格的 REST 基址，结尾必须有 '/'（= resolveRestBase(restProfile)）
  restBase: resolveRestBase(ACTIVE_REST_PROFILE),
  // 纯函数：档位 → REST 根（单元测试/诊断用；业务代码用 restBase）
  resolveRestBase: resolveRestBase,

  // 匿名可用的公开令牌（Bearer）
  publishableKey: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjkwMTNkMzBkLWY3NTEtNGE4Yi05OGNlLTlmNTFiMzk3ZDdjNyJ9.eyJpc3MiOiJodHRwczovL3Rvb2wtZDRnb3N1ZG9rNDZlMGUwODEuYXAtc2hhbmdoYWkudGNiLWFwaS50ZW5jZW50Y2xvdWRhcGkuY29tIiwic3ViIjoiYW5vbiIsImF1ZCI6InRvb2wtZDRnb3N1ZG9rNDZlMGUwODEiLCJleHAiOjQwOTUyNzY4ODAsImlhdCI6MTc5MTU5MzY4MCwibm9uY2UiOiItdGJncVVhcVNZS25jNUx0VmZ2QWZRIiwiYXRfaGFzaCI6Ii10YmdxVWFxU1lLbmM1THRWZnZBZlEiLCJuYW1lIjoiQW5vbnltb3VzIiwic2NvcGUiOiJhbm9ueW1vdXMiLCJwcm9qZWN0X2lkIjoidG9vbC1kNGdvc3Vkb2s0NmUwZTA4MSIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJyb2xlIjoiYW5vbiIsImlzX2Fub255bW91cyI6dHJ1ZSwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiYW5vbnltb3VzIiwicHJvdmlkZXJzIjpbImFub255bW91cyJdfSwidXNlcl9tZXRhZGF0YSI6eyJuYW1lIjoiQW5vbnltb3VzIn0sInVzZXJfdHlwZSI6IiIsImNsaWVudF90eXBlIjoiY2xpZW50X3VzZXIiLCJpc19zeXN0ZW1fYWRtaW4iOmZhbHNlfQ.Iyf827jPzSxTtY6l9tjeRSWG0DVkU8a-sqOcg43b0sP-4CuykUQ_2DpIm3vQSd6t9gDjQRsODpuQzZt4X2iabRr7eahQnB5UFjNuHWBJYtg9O1IZSdx1qfiyQ9NHLHLMOGQKw95E5qhqEs-tQXu-FbASsAl4Y-O_ssL3_OrwFP6qUWfLRb53D0X5gqkumEaKvf-hHhSlyFCzOImKdTKnoI-Qr_N-xa3_WE1AWjGXC_5lo8BhsxZFrGXrkp90eB1kT4303lPA_bzuzP1RXHdrNRmJRbobZmOUUa3k8SoqoeSrizQxCSaL-1oyhZZBFn_zBMpN7wGw0H2uC8I-NTE5Vg',

  // 班级身份 RPC（CloudBase PostgreSQL 函数名；一般不用改）
  rpc: {
    verify: 'rpc/class_verify',
    members: 'rpc/class_members',
    // 2026-11-17 通知列表轻量化：服务端把 body 里的 data URI 替换为空串 + lazy=true
    // （契约 web/deploy/cloudbase/2026-11-17_notice_meta.sql）。失败时 utils/cloud.js 自动回退旧整表。
    noticesMeta: 'rpc/class_notices_meta'
  },

  // 课表静态快照（legacy 兜底，只读）：2026-11-07 起课表优先读 CloudBase `site_assets` 行
  // （id='tt'，走统一 request 通道带 publishableKey + X-Class-Token）；该 CloudBase 请求失败
  // （网络 / 404 / 格式错）才回退到这里。保留该域名是为了兼容：仍建议把域名加进
  // 小程序后台 → 开发管理 → 服务器域名 → request 合法域名（不添加则 legacy 兜底不可用，只显示本机缓存）。
  // 留空则 CloudBase 失败后直接 reject（只用本机缓存 / 旧课表数据）。
  ttUrl: 'https://tool.furina.fun/tt.json',
  // 2026-11-17 因域名未备案曾默认关闭；2026-11-23 ICP 备案通过、域名恢复，legacy 兜底重新开启：
  // 只有 CloudBase 主链路失败（网络 / 404 / 格式错）才回退到上面的 ttUrl，平时不发请求。
  // 需在微信后台 request 合法域名里保留 https://tool.furina.fun，否则 legacy 兜底不可用（只显示本机缓存）。
  ttLegacy: true,

  // 网页版站点基址（只用于生成「抽签存证核验链接」= webBase + '/#verify=<recordId>'，
  // 小程序不向该域名发请求，因此不需要配到 request 合法域名；用户扫码后在浏览器打开核验页）。
  // 2026-11-14 撤销临时域名：固定用 `https://tool.furina.fun`（契约 web/draw/CONTRACT.md §4）；
  // 2026-11-23 备案通过、域名恢复，核验链接正式可用。
  webBase: 'https://tool.furina.fun',

  // 文件传输（临时云空间）/ 大屏互联后端：drop 服务（契约见 web/drop/CONTRACT.md）。
  // 正式地址（2026-11-23 ICP 备案通过后启用）；必须 HTTPS，并已在微信后台
  // 「request 合法域名」与「downloadFile 合法域名」同时加入 https://tool.furina.fun
  // （只加 request 会导致列表可见但文件下载失败）。
  // 留空 = 未配置服务地址：云空间/大屏互联提示「未配置服务地址」，不猜测地址、不发必失败请求。
  dropBase: 'https://tool.furina.fun/drop',

  // PPT 在线媒体缓存（三端与网页同口径，契约见 web/ppt/CONTRACT.md）：
  //   OSS 香港（tool-furina-fun.oss-cn-hongkong.aliyuncs.com）的 /ppt/** 媒体（分步图 WebP、缩略图、
  //   原样播放 MP4、media_files 单独下载音视频、下载包）→ https://tool.furina.fun/pptfiles/<path> 缓存。
  //   * base 留空 = webBase + '/pptfiles'（正式：https://tool.furina.fun/pptfiles，备案已通过 + HTTPS）；
  //   * 调试需要时填自有 HTTPS 地址（不要用 IP/http），尾斜杠会被归一；
  //   * enabled:false = 回滚为 OSS 直链（旧行为，无需改其它代码）；
  //   * 只映射本 OSS 桶的 /ppt/**；data:/file:/本地临时路径/其它域名原样返回。
  pptEcs: {
    enabled: true,
    base: ''
  },

  // 单次请求超时（毫秒；默认档，HTTP/网络体验优化 2026-11-18）
  timeout: 8000,
  // 超时分级：login（身份验证/登录首屏，弱网冷启动首次 TLS 最慢）/ poll（轮询与普通读写）/
  // upload（大分片上传，页面另有显式 timeout）。未配置时回退 timeout。
  timeouts: {
    default: 8000,
    login: 12000,
    poll: 8000,
    upload: 60000
  },

  // 网络层参数（utils/cloud.js 读取；一般不用改，2026-11-18 网络体验优化）
  net: {
    // https 域名请求开启 HTTP/2（微信基础库 2.10.4+ 支持；旧基础库忽略该选项，自动回退 HTTP/1.1）。
    // 自建后端已备案，走 Caddy HTTPS(HTTP/2)；CloudBase 网关本身支持 HTTP/2，无副作用。
    enableHttp2: true,
    // 并发上限（超过排队；弱网连续失败时降为 weakMaxConcurrent，避免把本来就拥堵的链路打爆）
    maxConcurrent: 8,
    weakMaxConcurrent: 3,
    // 幂等只读请求（GET / 只读 RPC）最多尝试次数（含首次）与退避基数
    retryAttempts: 2,
    retryBaseMs: 350,
    // 相同 GET 请求在途合并（多页面/定时器同时拉同一张表时只发 1 个请求）
    coalesce: true
  },

  // 表名（与网页版同一批表；一般不用改）
  tables: {
    homework: 'homework',  // 作业：{id, subject, content, due, date, author, owner, attachments, done, archived, ts}
    notices: 'notices',    // 通知：{id, title, body, imp, pin, author, owner, attachments, archived, ts}
    marks: 'marks',        // 勾选状态：{id: sid|kind|ref, seat, kind('hw'|'nt'|'ntdone'), ref, val, ts}
    userdata: 'userdata',  // 用户数据 v6：{id: 学号, blob: JSON字符串, ts}（CONTRACT §3）
    feedback: 'feedback',  // 反馈：{id, content, contact, acc, done, ts}
    fitrecs: 'fitrecs',    // 体测记录：{id, acc, data, arch, ts}
    visits: 'visits',      // 访问统计：{id: sid|slot|前端, slot, sid, name, did, client, ts}
    // 站点静态资源（2026-11-07 课表去域名化）：id='tt' 行 body=课表对象 {c,t,meta}，meta={source,fetchedAt,...}
    siteAssets: 'site_assets',
    // 2026-11-09 PPT 演示（契约 web/ppt/CONTRACT.md §3）：
    //   pptDecks  演示文件行（status 状态机 / manifest 播放清单 / cover_url）
    //   pptChunks 上传分片暂存（512KiB/片 base64；转换机取走后立即删除）
    pptDecks: 'ppt_decks',
    pptChunks: 'ppt_upload_chunks'
  }
};
