# 班级工具站 · 原生微信小程序（v25 / 2.0.0）

> **2026-11-17（待上传；代码版本仍 2.0.0）· 性能专项：通知整表 14MB → 0.30MB + 启动/请求错误率优化**：
> 微信后台性能报告：打开率 93.85%（iOS 50%）、总启动 1638ms、请求耗时 251ms、**请求错误率 45.45%**。
> 根因：`public.notices` auto 行 body 内嵌 data URI，整表已达 **14.07MB**；冷启动/签名变化即拉整表，
> 8s 超时 + GET 重试 → 错误率飙升；14MB > 5MB 缓存预算 → 缓存永远失败；旧 `cache.set` 还先分块再判预算，
> 额外复制 24 块造成主线程/内存峰值。修复：云端 `class_notices_meta`（lite body，data URI 置空 + `lazy=true`，
> 实测 **296KB**）+ 小程序按 id 懒加载附件/图片 + 预算前置 + `ttLegacy:false` + 401 统一回身份页 + 启动懒加载
> （`cloud/store/diag/notify` 不再在 app.js 顶部 require，`wx.cloud.init`/`store.get()` 移出 onLaunch，
> 30s 同步延后 300ms，身份页已登录自动进入改 onReady 立即切 + 600ms 兜底 + reLaunch 兜底（原 520ms））+ 无提醒时不调云函数 + 网络失败指数退避。
> 通知页只自动拉前 2 张有图片的卡的完整 body（其余点「图片加载中… 点击加载」），`_bodyTried` 负缓存修掉
> 「文件确实未获取」卡片的 84 次/页重复拉取。实测（devtools automator，测试身份）：冷启动请求 **10→7**（14MB 整表→0.30MB meta）、
> 二次启动 **2**，`evaluateScript` **513→391ms**（完整重编译；热态 171ms），通知页自动完整 body **14→2**；`unit.js 560/6`（6 项既有）、
> `sync_contract 34/0`、`cache_unit 22/0`、`nt_attach_url 10/0`、staticcheck/code_quality exit 0。
> 云端迁移 `web/deploy/cloudbase/2026-11-17_notice_meta.sql`（已应用）；小程序需用户上传发布；
> **VERSION 仍 2.0.0、UD v6 不变**。回滚：DROP 两个函数（小程序 404 自动回退旧链路）或回退源码。
>
> **2026-11-16（待上传；代码版本仍 2.0.0）· 删除「活动 / 今日校园 / 学信网」工具（用户要求，不是隐藏）**：
> 小程序端全仓检索确认**本来就没有**这三个工具——`app.json` 无对应页面、`utils/tools.js` 工具目录无入口，
> 也没有图标 / 资源 / 「使用说明」文案 / 路由 / 单测可删（2026-11-15 移植审计结论：三工具均「不移植」）。
> 本轮按统一要求把它们从产品中移除：小程序端**无代码变更**，仅同步文档旧表述（下方 2026-11-15 条目的
> 「未移植」清单划掉三项——它们已不再作为产品缺失项保留）。通知解析里的「今日校园」是**专有名词保护**
> （`utils/notice.js::absRelDates` 不把「今日校园」替换成日期），与工具入口无关，保留。
> 验证：`node unit.js` **554/6**（与基线一致；6 项为既有 draw ko-link / quickList 顺序 / 期次时间依赖失败）、
> `python staticcheck.py` exit 0（30 页、handlers / 分享 0 缺失）；小程序零构建链，本轮无代码改动故未跑 devtools automator；
> **VERSION 仍 2.0.0、未上传发布**。
>
> **2026-11-15（待上传；代码版本仍 2.0.0）· 移植性审计 + 可完整移植项（外观三选一 / 电费同期比较独立行 / 工具描述 2 行 / 深色 hero 中性化）**：
> 用户要求把安卓/网页新能力中**能完整移植的**移植到小程序、移植后会缺失的不移植。审计矩阵唯一文档
> `docs/PORTING_MATRIX_20261115.md`（逐工具「可完整移植 / 部分缺失 / 不移植」+ 理由 + 本轮实施清单 + 测试证据）。
> ① **外观**：新增 `utils/appearance.js`（跟随系统 / 浅色 / 深色，本机 `zq_appearance_v1`、即时生效、冷启动保持，与安卓 v4.55 同语义；
> 不进 UD v6 账号同步）+ `app.js` 在 `App()` 前包装全局 `Page`；全部 29 页根节点 `<page-meta page-style="{{themeStyle}}">`
> 内联覆写整组 `--md-*` token，原生外壳用 `wx.setNavigationBarColor/setBackgroundColor/setTabBarStyle` 同步；
> 页面级暗色（通知/课表/体测/点名/统计自有 token、工具图标、骨架屏等）由 `@media` 改 `.theme-dark` 类驱动，保证手动外观与系统交叉时一致；
> 「我的 → 外观」三选一卡；`util.theme()/nativeTheme()`/touchable 按压色同步。
> ② **电费**：自然周期同期比较改「区间用电」tile 内**独立一行**（`tilesOf.cmp/cmpUp`，不截断，暖沙/灰蓝着色），趋势图例补
> 「充值 +x 度（已折算）」；折算曲线/竖线/徽标、14d/70d 补拉、35% 守卫、异常扣减剔除已同源。③ **工具描述** 2 行 clamp + 卡高适配；
> ④ **深色 hero 中性化**（投票详情/抽签记录/体测/使用说明 mint）。
> **未移植（会缺失）**：~~活动、学信网、今日校园~~（2026-11-16 已按用户要求删除，不再保留入口）、教务 WebVPN 自动登录、快递、OPPO 推送、隐藏状态栏；通知"自动全部加载"小程序
> **天然满足**（一次整表 + 2KB 签名增量，无分页）。测试：新增 `appearance_unit_tests.js` **14/0**、`node unit.js` **554/6**
> （基线 540/6，未新增失败）、`sync_contract_test.js` 34/0、`v3_power_diag_tests.js` 65/0、`ug_cards_check.js` 59/0、
> `staticcheck.py` exit 0（29 页）、`code_quality_check.js` 通过；**未上传发布、VERSION 仍 2.0.0、未跑 automator/真机**。
>
> **2026-11-12（待上传；代码版本仍 2.0.0）· 抽签升级 v1：名称映射 + 云端存证 + 记录页 + 核验二维码**：契约 `web/draw/CONTRACT.md`
> （唯一真源）。新增 `utils/drawproof.js`：draw-v1 算法（mulberry32 uint32 显式版，与网页/核验页逐字节一致 + 4 组固定向量）、
> 名称映射解析（每行「序号 名称」/无序号自增/trim 1..40/后值覆盖/≤300/归一升序；优先级 映射 > 班级名单派生名 > 空）、
> 记录编号/seed/核验链接（`cloud-config.webBase` = `https://tool.furina.fun`）与 4 个存证 RPC 封装（复用统一 header/token，失败静默）。
> 抽签页新增「名称映射」按钮+弹层（textarea/已映射计数/清空/取消/保存，存 `store.draw.names`）；每次「开始抽签」用 seed 出结果并
> **异步创建云端存证**，结果区显示「存证中… / 已存证 · 今日第 N 次（全班今日共 M 次）/ 未存证（网络不可用）」；剔除/补抽/重置追加
> 时间线事件；「抽签记录」入口；导出图 编号=存证 id、参数区含存证编号/时间/今日次数/记录哈希、QR=核验链接（`qrTitle/qrCap`），
> 未存证不画 QR 并提示、剔除重抽明细改纯文本块；随机打乱只改显示顺序（不改抽取顺序、不记事件）。新增 `pages/drawrec`
> （今日/全部列表 + 详情：参数/初始结果/时间线/算法复算/哈希/二维码/复制核验链接；`?id=` 深链；不显示学号；原生分享）。
> 同步：`store`/`privacy` 默认 `draw.names:''`、`cloud.udSections/udApply` 应用（section 仍是 draw，不新增顶层键/section），
> 旧数据无字段按空。测试：`drawproof_unit_tests.js` **35/0**、`node unit.js` **535/0**（本任务新增 35 项；合跑含并行「长期通知」专项 12 项）、
> `node sync_contract_test.js` **34/0**（新增 draw.names 合并/换端/推送用例 + 夹具期望同步）、`python staticcheck.py` exit 0
> （**29 页**、handlers/分享 0 缺失）、`node code_quality_check.js` 全部规则通过、`ai_unit_lottery.js` 51/0。
> **VERSION 仍 2.0.0、零新依赖、待用户上传发布**；
> 云端 RPC 见 `web/deploy/cloudbase/2026-11-12_draw_proof.sql`，发布前确认 `webBase` 域名与微信后台合法域名。
>
> **2026-11-12（待上传；代码版本仍 2.0.0）· 名单三分类与网页版同步**：`pages/committee` 从「班委名单」升级为「名单」——
> 三 tab「班委 / 团员 / 全班」+ 计数徽标：班委（role/badge，按职务权重排序）、团员（`class_league` RPC 6h 缓存 ∩ 班级名单，
> 行上显示「团员」pill）、全班（仅姓名与座号）；管理员在班委 tab 点「管理」可逐人设置/清除职务
> （`class_set_role` RPC + editable 弹窗，留空=清除，成功后强制刷新名单）。团员按需加载、下拉刷新、空/错误/加载态齐全；
> 工具入口、使用说明、AI 页面元数据同步改名为「名单」。隐私：只显示姓名与座号，不显示学号。
> 测试：`committee_unit_tests.js` **8/8**（三分类视图/团员合并/计数/空态 + classSetRole 管理员契约/清空/非管理员/云端拒绝），
> 已挂 `unit.js`；全量 `node unit.js` **487/488**（唯一失败为并行电费改动的 v3 充值用例，与名单无关）；
> `staticcheck.py` handlers/分享 0 缺失；`code_quality_check.js` 全部规则通过。**VERSION 仍 2.0.0、待用户上传发布**。
>
> **2026-11-11（待上传；代码版本仍 2.0.0）· PPT v2.3 视频/音频单独下载分组**：契约 §12.8 新增「视频单独下载」——下载详情
> （`pages/pptdl`）在三行（兼容版/PDF/原始文件）之后，**仅 `manifest.media_files` 非空时**显示分组（旧 deck 无字段不显示）；
> 每行「视频1 · 第 7 页」/「音频1 · 第 12 页」+ 时长/分辨率 + 大小（文件名用 manifest `name`）；下载复用统一进度/取消/失败状态：
> 视频 → `wx.saveVideoToPhotosAlbum` 保存到相册（授权失败 `showModal` 引导 `wx.openSetting`，其它失败降级转发/复制链接）；
> 音频 → `wx.openDocument`（失败降级转发/链接）；「转发到聊天/电脑」`wx.shareFileMessage`（fileName=manifest `name`）+「复制链接」；
> 原三行下载/兼容提示/在线预览不变。测试：`node unit.js` **412/0**（`ppt_dl_unit_tests.js` **36/0**，v2.3 新增 10 项
> media_files 归一化/`mediaRows`/下载链 mock）、`ppt_unit_tests.js` 40/0、`ppt_video_unit_tests.js` 30/0、`sync_contract_test.js` 33/0、
> `staticcheck.py` exit 0（**26 页**、handlers/分享 0 缺失）、`code_quality_check.js` exit 0；automator `ppt_media_preview.js`
> **17 passed / 0 failed**（无 media_files 不显示 + 注入渲染 + 保存相册/授权引导/转发/音频打开/复制链接；截图 `_shots_ppt_media/`）。
> **VERSION 仍 2.0.0、未上传发布**。真机注意：单独视频/音频为 OSS 大文件（≤200MiB），需先配置 request+downloadFile 域名；
> 保存相册需用户授权（首次弹窗），转发/复制链接可作为降级路径。
>
> **2026-11-10（待上传；代码版本仍 2.0.0）· PPT v2.0 功能重定义：下载中心**：用户要求「不再以在线播放为主要功能，而是上传 PPT →
> 自动做**兼容性处理** → 多端下载，且不改变 PPT 本身质量」。小程序端按契约 §12 重定义：
> ① **列表点击卡片 = 下载详情**（`pages/pptdl`，不再默认进播放器；旧播放器保留为「在线预览」入口）；
> ② **三行下载**：兼容版 PPTX / PDF（显示页数与大小）/ 原始文件（`manifest.files` 的 base+s/size/name，显示大小）；
> ③ 下载方式：`wx.downloadFile`（**进度 UI、可取消、30–60MB 不读入内存**）→ `wx.openDocument({fileType:'pptx'|'pdf',showMenu:true})`
> 打开；支持 `wx.shareFileMessage` 时「转发到聊天/电脑」，不可用降级「复制链接」；每行「复制链接」（`wx.setClipboardData`）；
> ④ **兼容提示**：`manifest.compat.warnings` 橙色逐条显示（外链媒体/字体未嵌入等，不删除内容）；
> ⑤ **旧 deck（无 files）**：「兼容版未生成」+「在线预览」+「重新处理」（`retryDeck`，本人/管理员）；
> ⑥ 列表卡片小标签「**兼容版**」「**PDF**」（`manifest->files` 轻查询 + 本机缓存兜底，不拉整份 manifest）；
> ⑦ 未就绪 deck 只显示状态/进度、不显示下载；上传/10s 轮询/删除/重试/离线提示保持不变。
> 测试：`node unit.js` **363/0**（新增 `ppt_dl_unit_tests.js` **26/0**；原 `ppt_unit_tests.js` 40/0、`ppt_video_unit_tests.js` 30/0）、
> `sync_contract_test.js` 33/0、`staticcheck.py` exit 0（**24 页**、handlers/分享 0 缺失）、`code_quality_check.js` exit 0；
> automator `ppt_dl_preview.js` **27 passed / 0 failed**（真实 deck 旧形态 + v2 注入、下载链/取消/复制链接/转发/旧 deck 预览；截图 `_shots_ppt_dl/`）。**VERSION 仍 2.0.0、未上传发布**。
> **真机风险（必须用户做）**：微信公众平台把 `https://tool-furina-fun.oss-cn-hongkong.aliyuncs.com` 加入
> **request + downloadFile 合法域名**（香港默认域名能否过微信校验未查证）；OSS 若开防盗链需放行空 Referer 与
> `servicewechat.com`；上传发布后用**真机正式版**验一张图 + 一份 30–60MB 兼容包下载/打开。详见 `CHANGELOG.md` 顶部与契约 §12。
>
> **2026-11-10（待上传；代码版本仍 2.0.0）· PPT v1.2「原样播放」视频 + 便捷操作**：用户反馈「动画全部消失、视频依然无法播放、
> 各端操作不够便捷」。转换机新增 `manifest.video`（PowerPoint 直出高保真视频：动画/切换/内嵌视频+声音）后，播放器新增
> **原样播放模式**：`manifest.video` 存在且网络良好（wifi/4g/5g；2g/3g/断网默认分步）→ 默认视频全屏 contain（黑底），
> 自定义控制条 3s 自动隐藏：播放/暂停、`mm:ss / mm:ss`、**按 chapters 的上一页/下一页**、章节刻度进度条点 seek、
> 倍速 1×/1.25×/1.5×/2×（`playbackRate`）、复制视频链接（`wx.setClipboardData`，提示「可在浏览器下载/播放」）、从头、
> 原样/分步胶囊、关闭；点舞台显隐控制条、左右滑=章节前后（**不做** 1/3 点击翻页）；缓冲/下载/错误态不白屏。
> **降级链（契约 §11.4）**：`<video src=OSS直链>` → `binderror`/5s 未起播 → `wx.downloadFile` 临时文件（进度 UI、
> 20s 无进度/180s 上限看门狗、退出/切模式 abort）→ 仍失败**自动切分步 + toast**，下载失败短提示「需配置 OSS 域名」。
> **续播**：storage 按 deckId 记 `{mode,page,step,idx,t,dur,pt,n,at}`（7 天/未到末尾），列表卡片「继续」小徽标、
> 打开自动续播（toast「续播 05:42」）、控制条「从头」。**分步模式修复**：热点时序（图片 load/转场结束/resize 三处重算）、
> 热点 48→**64px**（≥56px）+ 脉冲 + 时长角标。**列表便捷**：整卡点击=直接播放（默认模式），上传/删除/重命名/下载不变。
> **devtools 实测（automator 9424，真实 deck `dmwalrdlgevz90l` 16 页、第 12 页内嵌视频 225.6s）**：
> 分步热点可播；把真实 OSS `m0.mp4` 注入为 `manifest.video` 后 **`<video src=OSS直链>` 在 devtools 确实播放**
> （timeupdate 0→19.6s 推进；OSS 响应带 `x-oss-force-download: true` + `Content-Disposition: attachment` 未阻断），
> `wx.downloadFile` 同 URL 也成功（14MB，devtools 限速波动约 11–33s → 必须有进度 UI，已实现）；降级/续播/控制条见
> `mp-class-tools-tests/ppt_video_preview.js`（automator **38 passed / 0 failed**）结果与 `_shots_ppt_video/` 截图。测试：`node unit.js` **337/0**
> （新增 `ppt_video_unit_tests.js` **30/0**，原 `ppt_unit_tests.js` 保持 40/0）、`sync_contract_test.js` 33/0、
> `staticcheck.py` exit 0（23 页、handlers/分享 0 缺失）、`code_quality_check.js` exit 0、`VERSION` 仍 2.0.0、未上传发布。
> **真机风险（必须用户做）**：微信公众平台把 `https://tool-furina-fun.oss-cn-hongkong.aliyuncs.com` 加入
> **request + downloadFile 合法域名**（香港默认域名能否过微信校验未查证，正式版必须真机验一段视频）；OSS 若开防盗链需放行
> 空 Referer 与 `servicewechat.com`。详见 `CHANGELOG.md` 顶部条目与 `utils/ppt.js` 头部注释（契约 `web/ppt/CONTRACT.md` §11）。
>
> **2026-11-10（待上传；代码版本仍 2.0.0）· PPT 上传修复 + 演示图标**：用户反馈「PPT 无法成功上传」——
> 根因是基础库 3.17.4 起 `FileSystemManager.openSync(path,'r')` 旧签名失效（报 `Cannot create property 'filePath' on string …`，
> 新签名为 `openSync({filePath,flag})`），`utils/ppt.js` 分片读取全部失败 → 上传必然中断。已改为
> **`readFile({filePath,position,length})` 优先 + `pickChunkBuffer` 旧库整文件切片 + 对象/旧字符串签名 `openSync` 回退**，
> 分片请求超时放宽 60s；devtools automator 实测 1MB PPT 3 片均 201、成功排队。演示图标从 40×40 线条改为
> **96×96 白色实心「演示屏+播放」**（与其它工具图标同风格）。真机需用户上传发布后生效。详见 CHANGELOG。
>
> **2026-11-09（待上传；代码版本仍 2.0.0）· PPT 演示（「演示」工具）**：新增 `pages/ppt`（列表+上传）与
> `pages/pptplay`（全屏播放器），任何人可从**聊天记录**选 `.ppt/.pptx` 上传（512KiB 分片、并发 ≤4、可取消），
> 本机转换机一次性转成**分步图片 + 外挂视频/音频**，三端只加载图片/视频 → 教室老电脑/手机都能流畅播放（不依赖
> PowerPoint 解码器）。列表：封面/标题/上传者/页数/状态胶囊（ready 不显示胶囊）、转换机心跳离线提示、10s 可见轮询、
> 失败重试、本人删除/重命名/下载原件、空态「从聊天选择」；播放器：纯黑全屏、点击右 2/3 / 左 1/3 与左右滑、
> step 语义（step=0 退上一页末步）、页切换五族动效、自动隐藏控制条 + 页内步点、顶部 step 进度、缩略图/备注抽屉、
> 视频/音频热点点击才播（不随 step 卸载、换页销毁）、黑屏、横竖屏 letterbox 自适应、退出释放。数据层 `utils/ppt.js`
> 实现契约 §4 全部接口（走 `utils/cloud.js` 统一 request + `X-Class-Token`），云表名/`cbDelete` 增量加入 cloud 配置；
> `app.json` 注册 2 页（共 23 页、不加 tabBar）、`utils/tools.js` 新增「演示」入口、新增 `images/tool-ppt.png`；
> `VERSION` 保持 2.0.0、未上传发布。**⚠️ 发布前必须由用户在微信公众平台把
> `https://tool-furina-fun.oss-cn-hongkong.aliyuncs.com` 加入 request + downloadFile 合法域名**（图片/视频直连 OSS；
> 香港默认域名能否通过微信校验未查证，需真机正式版验一张图+一段视频；OSS 防盗链需放行空 Referer 与
> `servicewechat.com`，否则 403）。测试：`node ppt_unit_tests.js` 38/0、`node unit.js` 297/0、
> `sync_contract_test.js` 33/0、`tool_sort_unit.js` 21/0、`staticcheck.py` exit 0（23 页）、`code_quality_check.js`
> 全部通过；automator/真机未跑（无自动化端口），页面视觉与真机加载未验证。详见 `CHANGELOG.md` 顶部条目与
> `utils/ppt.js` 头部注释（契约 `web/ppt/CONTRACT.md`、设计 `web/ppt/DESIGN.md`）。
>
> **2026-11-08（待上传；代码版本仍 2.0.0）· 电费趋势遮挡修复 + 诊断 v2 + 课表登录**：
> ① 电费趋势 canvas 在打开「关注宿舍」弹层/低电阈值面板时由 `wx:if` 移除、关闭后自动重绘（不再盖住选择框）；
> ② 诊断页**全班可见**（去管理员门禁）：服务健康 18 行 + 本机诊断代理在线 + 设备诊断 10 项 + 异常自动/手动上报
> `client_diag` + AI 分析结论与修复流程时间线（`diag_analysis`/`repair_tasks`，15s 轮询）；
> ③ 课表新增「登录教务」：提交自己的教务账号密码（密码提交后立即清空、不落盘）→ 云端收单（仅 PGP 密文）→
> 本机代理在校园网 SSO 抓取 → 回写为**我的课表**（`ttLocal`，优先于公共课表，走账号同步）；可「清除我的课表」回退。
> 版本仍 2.0.0、AI off；改动全部在本地，需用户上传发布后才生效。详见 CHANGELOG 顶部条目。
>
> **2026-11-07（待上传；代码版本仍 2.0.0）· 修复：趋势拖动到边界气泡被覆盖**：用户上传 2.0.1 后反馈
> 「电费趋势拖动靠近边界气泡内容被覆盖/裁切」。根因是拖动每一帧先用未 clamp 的命中点 x/y 渲染气泡，
> 实测回调回来前气泡越出 `.pw-plot` 被 `overflow:hidden` 裁掉。修复：新增 `estimateCursorTipSize` 首帧文字估宽 +
> `cursorTipLayout` 预 clamp，实测后精修；测量空值延迟 80ms 重试一次；气泡 DOM 移到 `.pw-plot` 外层
> （`.pw-trend-body` 内）；`z-index:4`、`max-width:calc(100% - 44rpx)`、20rpx 字号，边界不裁字/不被 y 轴遮。
> 测试：unit 234/0、v3 45/0（新增 estimate/预 clamp/测量失败安全值断言）、cache 18/0、sync 31/0、staticcheck 0、
> code_quality 通过；automator 未跑。仍需上传发布。
>
> **2026-11-07（未发版；版本号仍 2.0.0，待用户上传发布）· 电费趋势点击改网页版样式**：用户需求
> 「把小程序的电费趋势曲线点击做成网页版的样式」。小程序电费趋势的点击/左右拖动游标改为与网页
> `web/tools/index.html` 的 `POWER.detail*` 完全同款：竖直游标线 + **真实采样点 y 位置的圆点**（不再固定 50%）
> + **深色浮层气泡**「HH:MM / MM-DD HH:MM · 电量 xx.xx 度」——气泡深色 `#25332F` 白字、默认在点上方、
> 上方放不下自动翻到点下方并按 `[pad, plotH-pad-tipH]` clamp、水平按实测气泡宽 clamp 在
> `[pad, cw-pad]`（窄屏限宽），`utils/power.js` 新增纯函数 `cursorTipLayout(x,y,cw,plotH,tipW,tipH,pad)`
> （左/右/上/下边界与非法入参安全值）；页面 `_showCursor` 先按 canvas 同坐标系定位命中点（padX=6 / padT=12 /
> padB=10，`_drawTrend` 记录实测 `_plotH`），再在 `setData` 回调里实测 `.pw-plot`/`.pw-cursor-tip` 宽高修正
> 气泡锚点（`_cursorSeq` 防抖只应用最后一次；测量失败保留初值不崩）；**去掉底部可见的 `.pw-cursor-info`
> 信息胶囊**（改 `.pw-plot` 的 `aria-label` 无障碍文案）；同一采样点再点取消、拖动松手保留、切区间/换宿舍清游标；
> 区间 chips / 图例 / 坐标轴 / 其它页面零改动。验证：`node unit.js` **234/0**、
> `node v3_power_diag_tests.js` **45/0**（+2：cursorTipLayout 7 组边界、气泡实测/防抖/失败保留）、
> `node cache_unit_tests.js` **18/0**、`node sync_contract_test.js` **31/0**、`python staticcheck.py` **exit 0（21 页）**、
> `node code_quality_check.js` 全部通过；**automator 未运行**（无 9420 自动化端口，待 Lead 在开发者工具会话复跑
> `power_preview.js`）；未上传发布。详见 `CHANGELOG.md` 顶部条目。
>
> **2026-11-07（未发版；版本号仍 2.0.0，待用户上传发布）· 课表去域名化（CloudBase site_assets 优先）
> + 诊断 18 行 5 组**：用户即将暂停 `furina.fun` 全部解析，课表不再硬依赖
> `https://tool.furina.fun/tt.json`——`utils/cloud.js → ttFetch()` 改为 **CloudBase `public.site_assets`
> （id='tt'）优先**（`GET ?select=body,meta&id=eq.tt`，走统一 `request` 通道，带 publishableKey +
> `X-Class-Token`；body 兼容 JSON 字符串；成功后 `touchSync('tt')` 返回与旧 tt.json 同构的课表对象），
> 失败（网络/404/空行/格式错/旧配置无表名）才回退旧 `ttUrl`（`wx.request`，不带身份头，仅 legacy 兜底）；
> 6h TTL 缓存命中 0 请求、cloudOff / 云开关 / 身份守卫语义全部不变。`utils/diag.js` 与网页端完全对齐：
> **5 组 18 行**（站点与网页 / 云端后台 / 信息采集 / 定时任务 / 采集主机，新增 `dns_domain` / `tt_cloud` /
> `cloud_power_sync` / `cloud_xgj_sync` / `cloud_health_probe` 5 个 cloud 条目）；云端巡检
> `cloud_health_probe` 心跳缺失或超 15 分钟未更新时，其它 cloud 行「正常」→「注意」并在 detail 追加
> 「· 巡检未更新」（`cloudbase` 浏览器实时延迟覆盖除外；static 站点行由云端暂停语义控制）；网页按备案暂停时
> `site_static/site_tls` 的云端 `status=warn` 行直接展示「注意」不误报异常。
> 验证：`node unit.js` **232/0**、`node v3_power_diag_tests.js` **43/0**、`node cache_unit_tests.js` **18/0**、
> `node sync_contract_test.js` **31/0**、`python staticcheck.py` **exit 0（21 页）**、`node code_quality_check.js`
> 全部规则通过；**未上传发布**。详见 `CHANGELOG.md` 顶部条目。
>
> **2026-11-06（未发版；版本号仍 2.0.0，待用户上传发布）· 课表进入速度 + 电费趋势自动恢复**：课表页进入时
> **先显示本机缓存的当前周**（`onShow` 不再用「课表加载中…」骨架覆盖已渲染课表、删除 120ms 人为延迟，后台静默刷新，
> 成功才更新；无缓存才显示骨架）——automator 实测 onShow → 首帧 0–2ms；电费页趋势「数据积累中」偶发问题修复：
> **空历史结果不再写 5 分钟缓存** + row 成功但 24h 历史 <2 点时 **自动静默重试 1 次（650ms，force 绕缓存，
> 每宿舍+区间最多 1 次）** + canvas 未就绪补一次重绘，**进入页面无需手动刷新**；真实数据不足仍显示「数据积累中」。
> 验证：`unit.js` 226/0、`v3_power_diag_tests.js` 38/0、`staticcheck.py` exit 0、
> automator `tt_entry_preview.js` 20/0、`power_trend_entry_preview.js` 31/0（截图 `_shots_tt_entry/`、
> `_shots_power_trend_entry/`）。详见 `CHANGELOG.md` 顶部条目。
>
> **2026-11-06（未发版；版本号仍 2.0.0，待用户上传发布）· 工具页交互升级**：工具页删除「调整」按钮/排序弹层
> 与顶部「首页快捷」工具行，只剩「全部工具」；**长按工具拖动排序**（跟手幽灵、2 列网格迟滞重排、边缘自动滚动、
> 拖动中锁页面滚动；**不加拖动按钮/手柄，只用说明文字**提示可拖动）。首页快捷改为**按钮进入编辑模式**：
> 标题行右侧「编辑首页」→ 进入后点工具勾选/取消（最多 4 个，勾满 toast 提示）→「完成」退出；勾选结果在
> 工作台「常用工具」展示。数据：`homeTools`（UD v6，≤4）改为「用户勾选集合、不再自动补齐」，旧版全量顺序
> 首次读取迁移到本机 `toolOrder`；**工具页自定义顺序随账号云同步**（走 userdata v6 已有 `prefs.toolOrder`，不新增顶层键；默认自然顺序不写云端，用户拖过才同步）；云端 `udApply` 只应用 homeTools head ≤4。
> 详见 `CHANGELOG.md` 顶部条目与 `pages/all/*`。
>
> v25 = **v2.0.0 全班体验升级**（2.0.0，2026-11-05）：全站版本号 **2.0.0**（`utils/version.js` 唯一来源 → app.js
> `globalData.version`、「我的」页底部）；**页面滚动保位**（通用 `utils/scrollmem.js`，17 页接入，重进/切换恢复，
> 用户滚动即取消，内部横向 scroll-view 同样记忆）；**课表 6/7 天同页缩放（2026-11-06 用户反馈）**（周六/周日有课时
> 不再需要横向滑动看全：列宽始终按卡片内宽自适应 5/6/7 天 = 106/89/76rpx，6/7 天 dense 收紧字号——课程名
> 6 天 21rpx / 7 天 19rpx、单节块最多 2 行、7 天隐藏「第X-Y节」；横滑直接切上一周/下一周）；**通知长期安排**（recurrence：
> 「长期安排」徽标 + label + 本地计算「下次 MM-DD 周X HH:MM」，不判过期、不计入待处理）；**工作台双卡轮换**
> （作业/通知卡内最新一条每 5s 上浮淡出→下浮淡入 + 卡片轻微常驻浮动，页面隐藏暂停、≤1 条不轮换）；
> **通知管理员编辑/删除/恢复**（override_json/hidden/edited_at，云端 PATCH，仅管理员）；**全局动画统一**
> （200–320ms、reduced-motion 降级）；**体测男女/年级加入同步**（国标表页选择落 store.fit，与网页 userdata
> fit section 互通）；**marks 强制刷新/补发**（回到前台/进页/下拉刷新强制拉一次，失败补发）；**性能**（轮换/展开
> 局部 setData、bindscroll 不 setData）。详见「v2.0.0（2.0.0，2026-11-05）」章节。
>
> v24 = **课表内容左右滑动切周**（1.5.3，2026-11-05）：课表页的周次切换加入与网页端同款的滑动手势——
> 在课表内容区左右拖动时内容**跟手位移**，松手达到 56px 切上一周/下一周：旧内容先飞出（.16s + 淡出），
> 新一周从另一侧飞入（.23s cubic-bezier(.22,.8,.3,1)）；不到阈值回弹，第一周/最后一周橡皮筋阻尼 0.28 后回弹。
> 周表 6/7 天横向溢出时手势让给表格滚动（**2026-11-06 起已改为列宽自适应同页显示，不再横滑看全**，见 v25 说明）；周/日视图仍只点击切换；滑动后 320ms 内点击被忽略。
>
> v23 = **反馈建议停收 QQ / 微信联系方式**（1.5.2，2026-11-05）：反馈页删除「联系方式（可选）」输入框，提交只保留正文；
> 云端 `feedback.contact` 列保留（兼容表结构），新提交固定空串；按要求核查云端旧值（`feedback` 表 0 行，无旧值需清理）；
> 管理员反馈列表不再展示联系方式；
> AI 原子接口 `submitFeedback` 同步去掉 `contact` 参数。其余功能与云端契约不变。
>
> v22 = **导图 v2「清爽分享卡」**（1.5.1，2026-11-05）：导出图统一升级为与网页端逐像素同版式的清爽分享卡——
> 760 逻辑宽 / DPR2、暖白渐变底 + 圆角主卡 + 柔和投影、左上渐变装饰条 + 三色圆点品牌行、参数配置双列 tinted 面板
> （按实测宽度自动两列/单列）、区块标题方块；内容块支持 `text`（含富文本 run / mono）、`chips`（抽签结果胶囊）、
> `groups`（两列组卡）；页脚生成时间 + 唯一编号 + 品牌三色点，斜向平铺水印裁剪在卡内（alpha 0.03 / 700 15px）。
> 抽签 / 分组 / 结果单三页改用新 blocks API，作业 / 课表 / 体测沿用文本块自动适配；导出命名、参数配置、水印、时间、
> 编号与隐私约束（不出现学号/手机号/宿舍号）全部保留。版式规格：`web/tools/tests/export_card_v2_spec.md`。
>
> v21 = **微信 AI 开发模式全程序适配**（1.5.0，2026-11-05）：新增独立分包 `ai/`（8 SKILL / **60 原子接口** /
> **19 原子卡片** + 共享层）、全局提示词 `agent/AGENTS.md`、18 页页面元数据 `agent/page-meta.json` 与页面接力
> （`wx.onAgentHandoff` + `utils/agent.js` + 16 页消费）；AI 运行时与小程序共享身份、读写同一套 CloudBase 接口。
> 内测 beta 阶段不参与正式提审，发版前可用 `mp-class-tools-tests/ai_toggle.py --off` 关闭。详见「微信 AI 开发模式适配」章节。
>
> v20 = **通知提醒（微信订阅消息）**（1.4.7，2026-11-05）：通知卡片新增「提醒」——有截止时可选
> 截止前 1 天 / 2 小时 / 30 分钟，无截止可设今天/明天 20:00 或自定义日期时间；到点通过微信订阅消息推送，
> 点击消息直达该通知（`pages/nt/nt?gid=`）。已设提醒以胶囊展示，可修改/取消，换设备/重装后由云端 list 恢复；
> 简报区新增「新通知提醒」（下一条通知）。云函数 `notify` 扩展 `ntremind` 并改为每分钟定时触发。
> 详见「九、订阅消息」。
>
> v19 = **数据与隐私 + 用户内容全量同步**（1.4.6，2026-11-05）：新增「我的 → 数据与隐私」页（同步开关、
> 同步范围、本机/云端概览、立即同步、导出、清除云端/本机、隐私说明）；同步范围扩大到**所有用户改动内容**——
> 作业完成、**通知已处理**、通知置顶、工具栏顺序、体测录入、抽签/分组参数与名单选择、点名名单与到·假、隐藏项、
> 课表与提醒偏好、昵称；网页与小程序同一账号双向互通（`marks kind='ntdone'` + `userdata` blob v6，合并规则
> 两端逐字节一致）。详见「三·补二、数据与隐私与同步 v6（1.4.6）」。
>
> v18 = **性能与持久缓存**（1.4.5，2026-11-04）：通知 auto groups（一次响应约 2MB，其中 98% 是图片/附件
> data URI）改为**分块持久缓存 + 缓存优先**；30 秒轮询不再整表重拉——TTL 过期先用 `select=id,ts`（约 2KB）
> 签名校验，变了才拉整表；首次进入后即缓存，二次进入 0 请求/秒开。详见「三·补、性能与缓存（1.4.5）」。
>
> v17 = **通知页完整对齐网页端**（1.4.4，2026-11-04）：通知页按网页端通知页重做——**未过期默认展开、已过期默认收起**；附件从一行文字改为**文件卡（PDF/XLS 图标 + 预览/下载）**，图片网格预览，收集表 / 链接 / 小程序 / 公众号各有可操作行；简报新增「最近 3 条待处理」，支持「标记已处理」、已过期独立折叠区与分类筛选；同时重排手机阅读节奏（去重复标题、字段单列、4 格统计）。状态口径同步改为网页端规则：真实 `deadline`（含延期）优先，`expireAt` 只作自动归档兜底。
>
> v16 = **通知职位气泡 + OCR 标记**（1.4.2 / 1.4.3，2026-11-04）：通知卡片新增「发布者行」——**气泡直接显示班委职务**（1.4.3 起，如「班长」「学习委员」「副团支部书记」；无职务才退回「班委」兜底，非班委只显示姓名，无字段则整行不显示）；原始消息弹层里的发送者也同样显示「[职位] 姓名」；来自群图片 OCR 识别的通知在状态旁显示小「OCR」标记。数据仍由服务端下发，前端只读映射，老数据零迁移。
>
> v15 = **班级名单选择器 + 名单气泡**（1.4.1，2026-11-04）：抽签 / 分组 / 点名三处名单输入改为**只从班级名单（`class_members`，70 人）按座号选择**，不再支持自定义 / 粘贴名单；点「选择名单」弹出班级名单选择器（逐个点选 / 一键全选 / 清空 / 确定），已选名单在页面上以气泡摘要显示。旧自定义名单文本自动按姓名迁移为座号（匹配不到的人丢弃），点名「到 / 假」记录按姓名保留。**1.4.2 视觉简化**：名字气泡从液态糖果风改为 M3 简约 selected chip——未选 = `surface-container-lowest` 底 + `outline-variant` 细边 + `on-surface` 字，已选 = `primary-container` 底 + `primary` 边 + `on-primary-container` 字；去掉渐变 / 玻璃高光 / 浮动 / 弹跳 / 重阴影，只保留 hover-class 的 `scale(.97)` 轻按压（120ms）。
>
> v14 = **微信原生分享**（1.4.0，2026-11-04）：17 个页面全部接入「转发给朋友 / 分享到朋友圈」，每页有标题、5:4 封面与打开路径（课表带周次、通知带最新标题）。视觉与后端契约不变。
>
> v13 = **信息架构重设计**（1.3.2，2026-11-04）：工作台只做「今日课程 + 待办 + 4 个常用工具」；「工具」页改为完整工具目录 + 首页快捷排序；「我的」页集中身份、个人数据、同步、隐私与帮助。视觉与后端契约不变。
>
> v12 = **班级身份系统重构**（2026-11-04）：启动先进入「身份界面」，输入真实姓名 + 学号，由 CloudBase RPC `class_verify` 校验后签发班级 token；之后所有数据请求自动带 `X-Class-Token`，由服务端 RLS 鉴权。旧账号密码注册/登录、`X-Device-Id` 鉴权、`pages/verify` 二次认证、`admin` 账号名管理员判断全部下线。身份通过后自动请求 `class_members`（70 人名单）同步到本机，新增「班委名单」工具页；统计页改为按账号（学号/姓名）聚合、仅管理员可见。**UI 与后端契约之外的行为未变**：课表只读 / 周切换 / 本节详情、抽签分组、作业通知、体测、点名、反馈均照常可用，只是全部视为「身份后数据」。
>
> v11 = 课表与网页版同步（只读 / `tt.json` / 周切换 / 本节详情）。
> v10 = 体验与权限修复 + 与网页版同一套云端数据。
> v9 = 全部缺陷修复 + 同一套云端数据（39 项修复）。
> v8 = 云端启用与契约修复；v7 = 信息架构调整；v5 = 补齐网页版功能；v4 = 与网页版同一套账号 + 多端同步。
> 沿用 v3 的 Material 3 视觉体系（6 个组件 + `app.wxss` token），不引 CDN / npm / 第三方 UI 库。
> 除 `cloudfunctions/notify`（订阅消息发送）外，不接其他云开发能力；业务数据仍走原生 `wx.request`；
> 仓库只含公开的 publishable key，不含高权限密钥。

## v2.0.0（2.0.0，2026-11-05）

本次版本对齐网页端 v2.0.0，落地需求 1 / 2 / 3 / 5 / 9 / 10 / 11 / 12 / 13 / 14 / 15 / 16 的小程序侧。
**不新增任何后端能力**（仅读取 notices 新增的 `override_json/hidden/edited_at/edited_by` 四列，写只由管理员 PATCH），
不引入 CDN / npm / 第三方 SDK，全部虚构测试数据，不上传发布。

### 1. 版本号位置（需求 1）

| 位置 | 内容 |
| --- | --- |
| `utils/version.js` | **唯一来源**：`VERSION = '2.0.0'`、`text() = '班级工具 · v2.0.0'` |
| `app.js` | `globalData.version = version.VERSION`（其他代码/测试从这里读） |
| `pages/me/me.wxml` | 页脚小字 `{{versionText}}`（由 me.js 从 version.js 取值，不再硬编码） |
| `README.md` / `CHANGELOG.md` | 顶部标 v2.0.0（发版前只改 version.js + 这两处） |

导出图片不加版本号（沿用现状）。

### 2. 需求落点（小程序侧）

| 需求 | 实现位置 | 说明 |
| --- | --- | --- |
| 2 刷新/切换保位 | `utils/scrollmem.js` + 17 页接入 | 页面级纵向位置（attach/onScroll/save/restore）；`svSave/svGet` 记忆内部横向 scroll-view（课表周表、国标评分表）；恢复等 `data.state` 渲染完 → `pageScrollTo(duration:0)`，用户先滚动即取消 |
| 3 课表 6/7 天同页缩放（2026-11-06 用户反馈更新） | `pages/tt/tt.js/.wxml/.wxss` | 列宽始终按卡片内宽自适应（5/6/7 天 = 106/89/76rpx，内容宽 626/630/628rpx ≤630rpx），周六/周日有课也一屏完整显示、不再需要横向滑动；6/7 天 dense 缩放（课程名 21/19rpx、单节块最多 2 行、7 天隐藏「第X-Y节」、表头不截断），行高/跨节定位/点击区不变；周表不溢出后横滑直接切周（`_gridOverflow`/`_gridMaxX` 仅防御，恒 false/0） |
| 5 滑动卡死/异常审计 | `pages/tt`、`pages/nt`、`components/bottom-sheet` | tt `onHide/onUnload` 统一 `_swClear()` 收手势/动画；nt 展开收起定时器随页面清理；弹层 `wx:if` 挂载、遮罩 catchtouchmove；无 body 锁类残留 |
| 7 QQ 文件 / 压缩包附件 | `pages/nt`（mapGroup file item + `fileTap/previewArchiveFile/filePending`）+ `utils/notice.js archiveInfo` + `utils/cloud.js ntGroupFull` | `kind=file` **有 `url/src`** → 预览/下载；**有 `archive`（压缩包已识别）** → 外层不「待获取」，展示 `已识别 N 个文件` + 包内文件清单（默认展开，最多 6 行：类型 badge + 文件名 ellipsis + size + 预览/仅清单）；包内 3 个 data URI 文件可预览（`writeDataUri`→`wx.openDocument(showMenu:true)`，防重复点击/失败 toast），2 个仅清单不可点；archive.summary 一行小字（≤2 行）；`kind=file` 且无 url/archive → 「待获取」弹窗复制群名。**数据链**：`NT_FULL_Q=select=*`（含 body/archive），`NT_LITE_Q` 仅签名；首次/刷新整表拉全量；缓存旧 body 无 archive 时展开卡片会按 gid **单条刷新 body**（`ntGroupFull`，只 GET notices 单行，不新增接口/不上传），并回写内存/缓存 |
| 9 长期安排 | `utils/notice.js`（`recurOf/nextOf/nextTextOf/recurLabelOf`）+ `pages/nt`、`pages/index` | 解析 `recurrence`；「长期安排」徽标 + label + 本地计算「下次 MM-DD 周X HH:MM」；不判过期、actionable=false/长期安排不计入待处理与工作台轮换 |
| 11 工作台轮换 | `pages/index/index.js/.wxml/.wxss` | 作业/通知两卡同时展示；卡内最新一条每 5s「上浮淡出→下浮淡入」+ 卡片轻微常驻浮动；页面隐藏暂停、≤1 条不轮换、低版本降级、reduced-motion 关闭动画；轮换只 setData `title/sub/idx/anim` 四个字段 |
| 12 管理员编辑/删除/恢复 | `utils/cloud.js`（`ntAdminEdit/ntAdminHide`）、`pages/nt` | 解析 `override_json/hidden/edited_at`；管理员卡底「编辑/删除」+ 编辑弹层（title/cat/summary/deadline/eventAt/timeLabel）；「已隐藏」筛选（仅管理员）可恢复；`PATCH notices?id=eq.auto_<gid>`，不要求 return=representation |
| 13 全局动画统一 | `app.wxss`、`pages/nt/nt.wxss`、`pages/index/index.wxss` | 动效 200–320ms；通知展开/收起 max-height 高度过渡（收起动画后再移除内容）；`prefers-reduced-motion` 全局降级；ripple 反馈统一 320ms；页面转场仍由微信原生负责 |
| 14 体测男女/年级同步 | `pages/fttable`、`pages/ft`、`utils/cloud.js` | 国标表页初始值取 `store.fit`；`setSex/setGr` 写回 `store.fit.sex/grade` 并 `store.save()`（触发 userdata v6 fit section 同步）；主 ft 页 onShow 读 store / 拉 userdata 后刷新 UI（两端契约 `sex/grade` 已在 UD_FIT_KEYS） |
| 15 性能 | `pages/index`、`pages/nt`、`pages/tt` | 轮换/展开/标记已处理均局部 setData（只改文案/单卡）；`bindscroll` 只写内存不 setData；轮换/展开计时器随页面清理 |
| 16 通知/作业状态同步 | `app.js`、`pages/hw`、`pages/nt`、`pages/index`、`utils/cloud.js` | marks 真源不变；回到前台/进页/下拉刷新/onCloudSync 强制 `marksPull(true)` 绕过 2min TTL；变化后 `notifyPages` 重绘；写入失败进 `markPend`，恢复后 `flushPending` 补发 |
| 网站功能同步（电费 / 诊断） | `utils/power.js`、`utils/diag.js`、`pages/power`、`pages/diag`、`utils/cloud.js`、`utils/privacy.js`、`utils/store.js`、`utils/tools.js` | 2026-11-06 用户要求「同步网站和微信小程序的功能」：宿舍电费仪表盘 + 管理员诊断页；`power` section 进 userdata v6（13 键，与网站契约逐字节一致） |

### 2.1 网站功能同步（宿舍电费 / 管理员诊断，2026-11-06）

> 背景：用户要求「同步网站和微信小程序的功能」（网站 → 小程序，诊断页也进小程序仅管理员可见）。
> 只改小程序与测试工程，**不动网站 `web/`、不改云端 DDL / RLS、不上传发布**；版本号仍 2.0.0，AI 保持关闭。
> 网站仍为电费 / 诊断的主实现，小程序为移动端合理还原；网站后续若再改版，以 `power/power_history`
> 与 `service_health` 数据契约对齐即可（本轮按当前契约实现，未等待网站继续迭代）。

| 块 | 小程序实现 | 要点 |
| --- | --- | --- |
| 宿舍电费（普通工具） | `pages/power/*`、`utils/power.js`、`utils/cloud.js`（`powerRoom/powerHistory/powerPull`） | 17 间宿舍静态目录（与网站 `PW_ROOMS` 一致）；**宿舍选择已改版**：自定义 bottom-sheet（入口卡 → 遮罩弹层 → 4 个楼栋 pill → 房间网格 2–4 列自适应 → 点房间立即选中并收起；取消/遮罩可关；safe-area）——**不再使用原生 multiSelector**（用户真机列错乱根因）；**未选择 0 请求**；选择后并行读 `power?id=eq.<rv>` + **24h/7d 两档** `power_history`（30d 档再加当前档；`select=ts,quantity&roomverify=eq.<rv>&ts=gte.<now-range.ms>&order=ts.asc&limit=2000`，每档 5 分钟缓存，刷新 force 一起拉）；大号电量（网站 fmtMain：≥100 取整、否则 1 位小数）+ **v5 估算可用**（`rateFrom` 按 24h/7d 分段统计、跳过充值跳变段、`estimate` 0.65/0.35 混合、rate 下限 0.05、days=q/rate）+ 电量环（**estimate 天数/30**，无有效估算 0.04 小段；不是当前电量/400）+ **可调低电阈值**（UD `power.low`，默认 30，档位 10/20/30/40/50/60/80/100；判定 **q<low 低电 / low≤q<2low 偏低 / 其余充足**；低电标红）+ 最近更新；低电条「**剩 X 度 · 约 ≥30/X 天**」+「去完美校园充值」；**近 24h / 7天 / 30天趋势改为 canvas 2d 折线（v6：全量铺满 + 点击/拖动查看）**（区间 chips 24h/7天/30天，默认 24h、本机 `zq_power_range_v1` 记忆、不进 UD；**全部区间铺满容器（无横滑组件，canvas 宽=实测绘图区宽，全量采样按真实时间压缩绘制）**，点数上限 7d≤170/30d≤240；**点击/左右拖动查看最近真实采样点**：竖线 + 真实采样点圆点 + 深色浮层气泡「时间 · 电量 xx.xx 度」（网页版样式，越界翻下方并 clamp、窄屏限宽；24h HH:MM，7d/30d MM-DD HH:MM），同步 setData 不 rAF、松手保留、同点再点取消、不触发页面滚动；**x 坐标按真实时间比例**（非索引等分、不插值）；area 渐变 + 折线 #4E9082 + 2 条网格 + 末点；DPR 缩放；**固定 y 轴**（3 刻度 + 竖线，y 1 位小数；空态只留竖线无刻度）；**固定 x 轴覆盖层**（3/4/5 刻度：24h HH:MM、7d/30d MM-DD，同屏去重）；<2 采样显示「数据积累中」不绘制、不显示游标；图例随区间 起点/起 + 当前 + 近24h下降/区间下降；`d.recharge` 时标题旁「期间有充值」徽标；**慢更新提示（用户第 9 条）**：统计 24h history 相邻点 `|dq|>0.005` 的次数，≤2 时趋势标题旁显示「数据更新较慢 · 上次变化 MM-DD HH:MM」（无变化「数据未更新」），且估算可用 tile 标「参考」；正常房间不显示；不插值、不改真实阶梯；**真机横向溢出修复**：`.pw-plot` 在 flex 内 `flex:1 1 0; width:0; min-width:0; height:300rpx`，`.pw-trend-body` `width:100%; overflow:hidden`，scroll-view 显式 `width:100%;height:300rpx`；绘图宽改为 **SelectorQuery 实测 `.pw-plot`**（失败用窗宽 70% 保守兜底并先保守渲染再实测），24h `chartW ≤ 容器宽`，7d/30d 内容宽只在 scroll-view 内滚动；x 轴/图例 `overflow:hidden`，不撑破卡片）；history 按区间拉（`select=ts,quantity&roomverify=eq.<rv>&ts=gte.<now-range.ms>&order=ts.asc&limit=2000`，每区间 **5 分钟缓存**，切换区间缓存未过期→0 请求）；**估算可用/环/低电条均用 estimate 两档历史**；4 tiles：**估算可用（daysMain：≥30 显示「≥30」+ 副标 ≈rate 度/天）/ 区间用电（近24h/近7天/近30天，随区间）/ 低电阈值（可点改，8 档面板）/ 上次充值（值 2 位 + MM-DD HH:MM，无记录「—/暂无记录」）**；**视觉重构（2026-11-06）**：顶部关注宿舍单行入口、Hero 220rpx 小环 + 右上角小「刷新」、趋势标题/chips 分两行 + 趋势点击/拖动游标、**tiles 2×2 改 CSS Grid（真机 DPR 安全；房间/阈值面板同改 grid）**、卡片间距 16rpx；刷新 + 下拉刷新；2 分钟 TTL；`tools.js` 新增 `power`（`noHome:true`，与网站一致不进首页常用/排序） |
| 管理员诊断（仅管理员） | `pages/diag/*`、`utils/diag.js`、`utils/cloud.js`（`serviceHealth`） | 读 `public.service_health`（RLS `auth_admin`，**非管理员不显示入口且 0 请求**，页面 onLoad/onShow + cloud 双保险）；4 组（站点与云端 / 信息采集 / 定时任务 / 采集主机）；状态 ok/warn/down/offline/unknown 中文映射；cloudbase 行用本次请求延迟覆盖（<3s ok / ≥3s warn / 失败 down）；采集主机心跳 >15 分钟或缺失 → 所有 kind=local 行降级「离线」并显示「上报于 HH:MM」；site_static / jwxt 云端无行时退回本机 `ttCache.meta.fetchedAt`（≤30h ok / ≤54h warn / 其他 down）；汇总「N 项异常/注意/未知/全部正常」；刷新 + 停留页 60s 自动刷新（onHide/onUnload 停止）；`tools.js` 新增 `diag`（`admin:true`，规则同统计，不进首页） |
| 选择进同步（UD v6） | `utils/privacy.js`、`utils/cloud.js`、`utils/store.js` | **v5** `power = {sel:"<roomverify>",at:<ms>,low:<10–100 档位>}`（默认 low=30，旧数据无 low 按 30；非法值归一，70/90 不在档位）；顶层键序 `v,at,homeTools,fit,draw,group,roster,hide,tt,prefs,nick,power,homeToolsAt`（13 键 / at 10 section，与网站 `sync_check.py` 期望一致）；本机拥有 power（`UD_OWNED`）、脏检测/防抖推送/LWW 合并/云端拉取全部接入；本机 `zq_power_sel_<sid>`/`zq_power_low_<sid>` 只作离线兜底，真源是 `UD.power`；非法 roomverify 一律降级为未选择 |
| 访问统计排版（管理员） | `pages/stats/*` | 筛选改**两个 group**：模式组（按账号/按天/按小时，3 等分）与范围组（今天/近 7 天，2 等分右对齐）；group 内 `nowrap`，空间不足时**整组换行**（不再用 grow 把单个 chip 挤掉行）；chips min-height 80rpx（≥40px）；汇总卡 2 统计项 + 更新时间 `flex-wrap`（更新时间 `margin-left:auto`，窄屏整行靠右）；按天/按小时 `strow` label 120rpx + value 64rpx，均 nowrap/ellipsis，320 宽对齐不换行 |
| 隐私 | `pages/data`、`utils/privacy.js` | 电费页只显示规范楼栋 + 房间号 + 电量 + 时间，无姓名/学号；**不进导出 JSON**（AGENTS §4 唯一例外：本人可见、不导出、不对外分享）；同步范围增加「关注宿舍（电费）」；诊断仅管理员可见 |
| 工作台电费关注卡（v2.0.0） | `pages/index/*` | 回访时展示当前关注宿舍 + 剩余电量 + 状态（读 `store.power`，优先用 `cloud.powerCached` 2min 电量缓存，未命中按需 `power?id=eq.<rv>`）；**未选择时只引导「去选择关注宿舍」且 0 请求**；点击进入 `pages/power/power`；样式复用工作台卡片、手机/横屏不溢出；关注状态修复：无 UD 基线时本机选择用本机时间戳参与 merge、`power` 脏检测可触发推送、`onHide` 调 `cloud.udFlush()` 立即冲刷、云端权威清空不被旧本机兜底复活 |
| 图标 | `images/tool-power.png`、`images/tool-diag.png` | 40×40 PNG-8（205 / 212 B），媒体总量 109,337 B（106.77 KB，< 200 KB 硬线） |

> 工作台关注宿舍卡证据：`mp-class-tools-tests/_shots_power_home/`（automator 390 宽，6/6 PASS、0 console error）
> `01_home_power_empty.png`（未选择：引导卡、0 请求）/ `02_home_power_selected.png`（已选择：23号楼A座321 + 382 度 + 充足，更新 11-06 07:30）/
> `03_power_restored.png`（点卡片进入电费页，选择/数据恢复）/ `04_home_power_restored.png`（重整工作台卡片仍恢复）；
> 脚本 `home_power_preview.js`（本地 mock 身份/网络，不接触真实云端）。
> 电费慢更新徽标证据：`_shots_power_sync/09_slow_badge.png`（13号楼324：24h 仅 2 次变化 →
> 「数据更新较慢 · 上次变化 11-06 09:32」+ 估算可用 tile「参考」，真实阶梯不插值）。
> 电费趋势查看证据（task-28）：`_shots_power_sync/04c_cursor_7d_1/2/3.png`（7 天点击 12%/50%/88% → 游标移动、MM-DD HH:MM）、
> `04d_cursor_7d_drag.png`（左右拖动）、`05c_cursor_30d_drag.png`（30 天拖动）、`10_layout_24h.png`、`11_layout_7d.png`；
> 390 宽实测：卡片 right=374≤390、绘图区 right=318.33、canvas right=318.33（7d/30d 也只到绘图区右缘）、y 轴 left=322.33 > 绘图区右缘；
> 无 scroll-view/透明代理/「横滑查看」，页面无横向溢出；布局契约 320/360/430/667 全部 `chartW=绘图区宽`、最近点/时间格式单测覆盖。
> 电费选择/趋势/估算/排版证据：`mp-class-tools-tests/_shots_power_sync/`（开发者工具 automator，390 宽，30/30 PASS、0 console error）
> 访问统计排版证据：`mp-class-tools-tests/_shots_stats/`（automator 管理员 mock，390 宽，8/8 PASS、0 console error）
> 通知压缩包附件证据：`mp-class-tools-tests/_shots_nt_attach/`（automator 390 宽，5/5 PASS、0 console error）
> `01_nt_archive_card.png`（真实 group「预防艾滋病知识竞赛通知」卡片）/ `02_nt_archive_rows.png`（5 行清单：XLS/DOC/DOC 可预览、PPT×2 仅清单，
> 默认展开、无溢出）；脚本 `nt_archive_preview.js`（真实 group JSON 夹具 `_nt_fixtures/nt_archive_group.json`，mock 身份/请求，不接触真实云端）
> `01_stats_account.png`（筛选两组一行：模式 3 + 范围 2 右对齐；汇总 5/23/更新时间）/ `02_stats_day.png`（按天行 label/bar/value 对齐）/
> `03_stats_hour.png`（按小时行对齐）；脚本 `stats_preview.js`（本地 mock，不接触真实云端）。
> `00_power_empty.png`（未选择：单行入口 + 引导）/ `01_sheet_open.png`（自定义弹层：楼栋 pill + 房间网格）/ `01b_sheet_23A.png`（23A 9 间网格）/
> `02_dashboard_trend_24h.png`（紧凑 Hero + 24h 折线）/ `02b_tiles_24h_estimate.png`（v5 估算 tile + 低电阈值可点；**tiles 实测 2×2：两排同 top、等宽 176px**）/
> `06_low_panel.png`（低电阈值 8 档面板，选中 30）/ `07_low50_warn.png`（阈值 50、70 度 → 偏低）/ `08_low50_low.png`（阈值 50、40 度 → 低电+低电条）/
> `09_slow_badge.png`（慢更新徽标 + 参考）/ `10_layout_24h.png`、`11_layout_7d.png`（24h/7d 全量铺满、无横滑组件）/
> `04_trend_7d.png`（7 天全量折线）/ `04c_cursor_7d_1/2/3.png`（点击游标）/ `04d_cursor_7d_drag.png`（拖动游标）/ `04b_tiles_7d.png`（7 天 tile）/
> `05_trend_30d.png`（30 天全量折线）/ `05c_cursor_30d_drag.png`（30 天拖动游标）/ `05b_tiles_30d.png`（30 天 tile）/ `03_low.png`（低电态）；
> 脚本 `power_preview.js`（本地 mock 身份/网络，不接触真实云端）。趋势宽度修复证据：`10_layout_24h.png`/`11_layout_7d.png`
> 实测 390 宽：卡片 right=374≤390、绘图区 right=318.33、canvas right=318.33（7d 也只到绘图区右缘）、y 轴 left=322.33 > 绘图区右缘；
> 7d/30d 内容宽 464/1096 只在透明 scroll 代理内滚动，canvas 固定为容器宽并被裁切。
> 360/430 适配：弹层 room 网格 `flex:1 1 140rpx` + `max-width:33.333%`（2–4 列自适应）、卡片文案 ellipsis、
> 弹层 `max-height:82vh` 内部滚动、底部 `env(safe-area-inset-bottom)`，无横向溢出元素；
> 7d/30d 趋势差异（task-28 已取消横滑）：小程序与网页一致，绘图区固定宽、全部采样按真实时间比例压缩绘制；
> canvas 宽始终=绘图区宽，y 轴在右、点击/拖动只移动游标层，不移动 canvas；点数上限 7d≤170/30d≤240。

### 2.2 水量统计（2026-11-06，未发版；版本号仍 2.0.0）

> 与网站 WATER 模块同口径（契约：`web/tools/tests/_water_contract.md`；规则来源：`web/_water_rules/research.md`）。
> 只改小程序与测试工程，**不动网站 `web/`、不改云端 DDL/RLS、不上传发布**；AI 保持 off。

| 块 | 小程序实现 | 要点 |
| --- | --- | --- |
| 水量页（普通工具） | `pages/water/*` + `utils/water.js`（纯逻辑） | 关注宿舍沿用「宿舍电费」的 `power.sel`（两侧共用、可在页内切换）；未选择只引导、0 请求 |
| 录入与计算 | `pages/water/water.js` | 月份（原生 month picker）+ 水表读数（2 位）；自动对比上一条：用量=本次−上次；**水费=max(0, 用量−2×人数)×3.03（2 位）**；**折合扣电=水费÷0.58（1 位）**；首条「首次记录」；输入即时预览；读数小于上次拒绝；同月覆盖 |
| 人数与额度 | 4 / 6 人间（默认 4） | 免费额度 = 2 吨水 + 5 度电 / 人 / 月（4 人间 8 吨+20 度、6 人间 12 吨+30 度）；切换人数写回 `water.rooms[rv].p` 并全量重算 |
| 历史 | 按月倒序、可删除 | 每行：月份 / 读数 / 用量 / 水费 / 折合扣电；删除后自动重算；最多 120 条/房间 |
| 规则呈现（2026-11-06 用户反馈调整） | 页面内 | **电费计费规则移入「宿舍电费」页电量统计 tiles 区**：tiles 网格内新增满宽「计费规则」条（电价 0.58 元/度、区间电费 ≈¥X.XX、免费 5 度电/人/月按人数（4 人间=20 度）、水费 3.03 元/吨从电费账户扣 · 1 吨≈5.2 度、已忽略扣减摘要）；**水量页规则卡只留水费规则**（3.03 元/吨、每人 2 吨水/月免费定额、超出定额×3.03、折合扣电÷0.58、无阶梯/来源/以学校最新通知为准），不再重复电费单价/电免费定额；人数文案只提每月免费 8/12 吨水；不出现市政阶梯价 |
| 同步（UD v6） | `utils/privacy.js` / `utils/cloud.js` / `utils/store.js` | 新增第 11 个 section `water`（默认 `{rooms:{}}`，值内不镜像 at）：`water.rooms[<rv>]={p,recs:[{m:"YYYY-MM",r,ts}]}`，recs 按月唯一升序 ≤120、与网页端同格式；顶层 blob **14 键**（`v,at,homeTools,fit,draw,group,roster,hide,tt,prefs,nick,power,water,homeToolsAt`）；旧数据无 water → 默认、不报错；未拥有端原样保留；保存记录 → `store.save()` → 既有 1200ms 防抖同步 |
| 隐私 | `utils/privacy.js` | 水量与电费一样**不进导出 JSON**（宿舍号红线）；同步范围新增「抄表记录（水量）」 |
| 图标 | `images/tool-water.png` | 96×96 PNG-8（309 B）白色线性水滴，风格对齐同批线性图标（96 画布 / 白描边 / 透明底）；媒体预算仍 < 200 KB |

测试：`node unit.js` **212/212 PASS**（含 water 专项 12 项：公式 4/6 人间、未超定额=0、对比/删除重算、store 旧数据默认、
UD water section 合并/恢复、页面渲染/保存/删除/人数切换/未选择 0 数据）、`node sync_contract_test.js` **31/31 PASS**
（含 water web→mp / mp→web 期望值 / 旧数据默认 / 未拥有端保留）、`python staticcheck.py` exit 0（21 页、handlers 0 缺失）、
`cli.bat auto-preview` 编译通过、`python test_ai_toggle.py` 78/78、`node code_quality_check.js` 全部规则通过。

### 3. 审核相关说明（当前状态）

- 本版**不实现**审核模式，也不提供任何面向审核场景的特殊入口；此前相关源码/入口已移除。
- 唯一入口仍是**正常身份校验**：学号 + 姓名 → CloudBase RPC `class_verify`（真实班级名单），失败不进入班级数据。
- **测试身份已在云端班级名单新增**（审核时走正常身份页「学号 + 姓名」登录即可；`class_members` 已过滤该身份，
  班级名单仍 70 人、名单选择器不出现它）。客户端**不需要也不包含**任何测试账号代码/入口；凭据只随交付说明提供，
  不写入仓库文档。
- **除上述云端测试身份外，不添加任何其他审核相关功能。**
- AI 开发模式属于合规配置（非审核功能），发版默认关闭（`python ai_toggle.py --off`，源码保留）。

### 4. 合规与发版检查清单

已做全源码扫描（`v2_unit_tests.js`「合规静态扫描」用例，排除 AI 独立分包与云函数）：

- [x] 无 `web-view`、无 `wx.requestPayment`、无抽奖/激励视频/广告 SDK、无 `wx.navigateToMiniProgram` 第三方导流；
- [x] 无外部统计脚本/CDN/字体；网络域名仅 CloudBase 网关（`tool-d4gosudok46e0e081.api.tcloudbasegateway.com`，
      含 2026-11-07 起课表主链路 `site_assets`）与站点静态 `tool.furina.fun`（`utils/cloud-config.js`，
      **仅 legacy 兜底**，不再承担课表主链路）；
- [x] 不采集证件/位置/通讯录；页面只显示姓名与角色，不显示学号；
- [x] 「数据与隐私」页与身份页如实说明身份校验、同步范围、存储与用途。

**发版前必做（发布/审核注意事项）**：

1. **AI 开发模式不随正式版提交**：`cd mp-class-tools-tests && python ai_toggle.py --off`（源码保留；确认 `app.json` 的
   `agent` / `subPackages` AI 配置已关闭、且 `project.config.json` 的 `packOptions.ignore` 已含 `ai`、`agent`
   两条 folder 排除项后再上传）。**本次交付源码已执行 `--off`**（app.json 无 agent/subPackages，
   `project.config.json` packOptions.ignore = ai/agent 两条，`ai/` 源码保留；两文件备份在
   `mp-class-tools-tests/_backup_ai_toggle/`）。
   **发版后如需恢复 AI 适配**：`python ai_toggle.py --on`（同时移除 ignore 排除项；需重新上传/发布才生效）。
2. 云端迁移先执行（Lead 负责，2026-11-05 已执行并验证）：`web/deploy/cloudbase/2026-11-05_notice_admin_override.sql`
   （notices 增加 `override_json/hidden/edited_at/edited_by`）。
3. 小程序后台「隐私保护指引」按实际收集项声明：学号 + 姓名（仅用于班级名单校验）；无位置/通讯录/相册等。
4. 服务器域名无需新增（与 v11/v1.4.x 相同）：CloudBase 网关域名（**必填**，含课表 `site_assets` 主链路）+
   `tool.furina.fun`（**仅 legacy 兜底**，可不填；2026-11-07 课表已去域名化，DNS 暂停不影响主链路）。
5. `project.config.json` 的 `urlCheck` 开发期为 `false`，上传前按后台域名配置确认（真机请求需要合法域名）。
6. 版本号 2.0.0（提审前确认 `utils/version.js` 未被改动）；上传发布、AI 模式关闭、云端 DDL 由 Lead 执行，本分支不含上传/发布动作。

### 5. 测试与包体（2026-11-06）

- `node unit.js` **229/229 PASS**（原 123 项 + v2 专项 24 项 + v3 网站功能同步专项 **41 项**
  （含 v5 估算/低电阈值/同步 + task-23 工作台电费卡/持久化/UD 覆盖场景 + 第 9 条慢更新检测/参考标记 + 趋势宽度契约）+ 2026-11-06 07:05 通知文案精简同步 5 项：
  17 间宿舍目录 / v5 rateFrom 4 组 fixture + estimate 混合/下限 / 可调 low 档位与状态边界（q=low、2*low）/
  deriveRange（drop 累计/充值 lastUp）/ 4 tiles（估算可用+≈rate 度/天、区间用电、低电阈值、上次充值）/ 趋势图例 drop /
  低电条文案 / 电量环 days/30 / **自定义 bottom-sheet** / **trendLine 时间比例点位/≤240+区间上限 + xTicks/xticksWindow** /
  **canvas 折线绘制与 <2 点不画** / **趋势区间 chips 24h→7天→30天（fetch 契约/5min 缓存/预取后 0 请求/本机记忆/不进 UD）** /
  **期间有充值徽标 + 上次充值 tile** / **v5 阈值面板交互/UD 推送 {sel,at,low}/本机兜底/换端/旧数据** /
  未选择 0 请求 / 拉取 24h+7d 契约 / 低电 / 切换 / TTL / 失败降级 / 离线兜底 / 非法值降级 /
  诊断分组与延迟覆盖 / 主机心跳离线 / 快照兜底 / 非管理员 0 请求 / 管理员 60s 刷新 / UD 13 键与导出隐私）；
- `node sync_contract_test.js` **31/31 PASS**（v6 夹具与合并期望升级到 13 键：power 在 nick 后、at 10 section、
  值内 at 与 at.power 镜像、换端恢复；**v5 power.low 推送/旧数据迁移/非法值归一**；原需求 14/16 用例保持）；
- `python staticcheck.py` exit 0（**21 页**、handlers / 分享 handler 0 缺失、无 web-view / 用户信息接口）；
- AI 侧（AI 开发模式 `--off` 状态）：`node ai_unit_all.js` **8/8 PASS（296 项）**、`ai_contract_test.js`
  **PASS 92 / FAIL 0 / PENDING 5**（PEND 均为 AI 独立分包未启用项，与 AI off 基线一致）、`ai_eval_check.js --strict` **14/14 PASS**；
- 开发者工具 automator：`node tt_swipe_preview.js` **16/16 PASS、0 console error**（本轮未改 tt 手势代码）；
  `node power_preview.js` **30/30 PASS、0 console error、windowWidth=390**（弹层打开/切 23A 九间网格/选中收起/
  24h 折线/估算 tile/低电阈值面板/阈值 50 偏低与低电态/慢更新徽标+参考/7天与30天全量折线/点击 3 位置+拖动游标/充值徽标/上次充值 tile/低电态/
  页面横向溢出 + 全部区间 chartW=容器宽 + 无 scroll-view + y 轴不重叠 + 页面不滚动），
  `node home_power_preview.js` **6/6 PASS、0 console error、windowWidth=390**（工作台未选择引导卡 → 已选择卡 382 度/充足 →
  点卡片进电费页恢复 → 重整工作台仍恢复），截图见 §2.1 与 `_shots_power_sync/`、`_shots_power_home/`；
  `node stats_preview.js` **8/8 PASS、0 console error、windowWidth=390**（管理员 mock：筛选两组、汇总不挤、按天/按小时行对齐），
  `node nt_archive_preview.js` **5/5 PASS、0 console error、windowWidth=390**（真实 group 附件：archive 5 行/3 可预览/2 仅清单 + 内部 openDocument），
  `node perf_ug_preview.js` **6/6 PASS、0 console error、windowWidth=390**（首屏请求时序 + 使用说明页电费/通知附件/工作台卡/水量条目、无溢出），
  截图见 `_shots_stats/`、`_shots_nt_attach/`、`_shots_perf/`；
- **首屏时序（automator 390 宽，mock 身份/网络）**：本轮把 app 级 `ensureMembers/visitLog/marksPull(true)` 从 `onShow` 延后到
  `WARM_MS=300ms`（页面自身 onShow 仍立即强拉 marks），首屏测量窗口内请求 **2 个**（`marks` @144ms、`notices` @159ms），
  早于 250ms 的请求 2 个；`perf_ug_preview.js` 记录 automator 冷启动/reLaunch 重试 overhead 下 ready 约 **3.7s**（该值含自动化重试，非纯渲染耗时），
  UI 首屏截图见 `_shots_perf/01_index_first_screen.png`；
- **安全审计结论（task-28）**：全页面无 `<rich-text>` / `innerHTML` / `document.write` / `eval` / `new Function`（云端文本走 `text` 自动转义）；
  通知附件 `writeDataUri` 增加 **10MB data URI 上限** + 扩展名 `[a-z0-9]{1,8}` 白名单，临时文件路径固定 `USER_DATA_PATH/nt_<ts>_<rand>.<ext>`，
  **archive 原始文件名不参与路径**（无路径穿越）；token/identity 不写 console（无 token/identity 日志命中）；
  外部链接仅复制不内嵌 web-view（staticcheck 无 web-view / 用户信息接口）；失败路径均 toast/降级，无新增上传或云写。
- **发版包体（AI 开发模式已 `--off`，发布默认状态）**：`cli.bat auto-preview` 编译通过 **TOTAL 652,076 B**
  （单主包，无 AI 分包；本轮工作区并发合入其他会话的水量抄表等改动（21 页），包体相对上一轮 649,527 B +2,549 B，
  含 task-28 电费游标/使用说明/首屏延后/安全上限与测试脚本；通知 archive 改动见上一轮）
  开发期 AI 开启时基线为 TOTAL 1,044,276 B（main 688,982 + `/ai/` 355,294），两者均远低于 2MB 限制。
- 媒体资源：37 个 PNG 共 **109,337 B（106.77 KB）**（新增 tool-power 205 B / tool-diag 212 B），仍低于 200 KB 硬线。
- **代码质量修复后（2026-11-05 晚，未发版，版本号仍 2.0.0）**：图片资源 35 个 PNG **243,708 B → 108,978 B**
  （媒体总量 106.42 KB < 200 KB）；AI 关闭时 `project.config.json` 排除 `ai/`、`agent/`；
  `cli.bat auto-preview` 编译通过 **TOTAL 532,652 B**（原 667,382 B，-134,730 B）；`node unit.js` 147/147、
  `sync_contract_test.js` 29/29、`python staticcheck.py` exit 0、`python test_ai_toggle.py` 78/78。
  详见 §7 与 `mp-class-tools-tests/CODE_QUALITY_NOTES.md`；2026-11-06 新增电费/诊断后媒体与包体见本节上两行。

### 6. 已知限制

- 微信 WXSS 无法对 `height:auto` 做过渡：通知展开/收起用 `max-height`（4000rpx 上限，覆盖现有通知详情高度）；
  极长通知（超过 4000rpx）展开后仍会完整显示（动画结束时 max-height 释放），收起动画首帧可能略有跳变。
- 工作台轮换在基础库 < 2.9.0 时降级为不轮换（避免不必要的 setData）；「减少动效」下仅关闭动画、文案仍按 5s 轮换。
- 周表横向位置的边缘判定用 rpx→px 估算 + 实测最大值修正 + 20% 相对容差；极窄/极宽屏仍以实测最大值为准。
- **电费趋势图（v6，task-28）**：小程序为 **canvas 2d 折线**（区间 24h/7天/30天；面积渐变 + 折线 #4E9082 + 2 条网格 + 末点；
  DPR 缩放）；**全部区间铺满绘图区、无 scroll-view/透明代理/横滑提示**，canvas 宽=实测绘图区宽，
  全部采样按真实时间比例压缩绘制、点数上限 7d≤170/30d≤240（canvas 物理宽 ≤~5376）；
  **点击/左右拖动查看（2026-11-07 改网页版样式）**：按 x 找最近**真实采样点**，显示竖线 + 真实采样点 y 位置圆点
  + 深色浮层气泡「时间 · 电量 xx.xx 度」（24h HH:MM，7d/30d MM-DD HH:MM；深色 `#25332F` 白字圆角阴影、
  默认点上方、越界翻到下方并 clamp、窄屏限宽；不再有底部信息胶囊，文案同时挂在 `.pw-plot` 的 `aria-label`），
  同步 setData 不 rAF、松手保留、同点再点取消、`catchtouchmove` 不触发页面滚动；
  **固定 y 轴**：3 刻度 + 竖线、1 位小数，空态只留竖线无刻度；**固定 x 轴覆盖层**：3/4/5 刻度（24h HH:MM / 7d·30d MM-DD）；
  <2 采样只显示「数据积累中」不绘制、不显示游标；图例随区间（起点/起、dropLabel：近24h下降/区间下降；drop 只累计下降、忽略充值回弹）；
  **v5 估算可用/环/低电条改由 `rateFrom`+`estimate`**（24h+7d 分段统计、跳过充值跳变段、0.65/0.35 混合、rate 下限 0.05）
  计算，不再用单档 derive days；网站仍是电费页主实现，网站后续若改版需按新数据契约对齐。
- **电费估算/低电阈值（v5）**：`estimate` 需要 24h 与 7d 两档历史（选择后并行拉；各档 5 分钟缓存；刷新 force 一起拉）；
  tile1 主值 ≥30 显示「≥30」，副标「≈ rate 度/天」；低电阈值随账号同步（`UD.power.low`，默认 30，档位
  10/20/30/40/50/60/80/100，无 70/90），本机 `zq_power_low_<sid>` 仅兜底；判定 q<low 低电 / low≤q<2low 偏低。
- **趋势实现（v6）**：小程序与网站口径一致——固定绘图区宽 + 全部采样压缩绘制；点击/拖动只移动游标层，不移动 canvas；
  canvas 宽=绘图区宽，点数上限 7d≤170/30d≤240；2026-11-07 起游标为网页版样式（竖线 + 真实采样点圆点 +
  深色浮层气泡 `cursorTipLayout` 边界 clamp），无底部信息行。
- **电费趋势区间**：24h/7天/30天 chips 默认 24h，选择只记本机 `zq_power_range_v1`（不进 UD 同步）；
  history 每区间 5 分钟缓存，切换区间缓存未过期不请求；「期间有充值」徽标与「上次充值」tile 来自区间 deriveRange 的
  `recharge/lastUp`。
- **电费宿舍选择**：已由原生 multiSelector 改为自定义 bottom-sheet（楼栋 pill + 房间网格；
  360/430 下 2–4 列自适应、内滚 + safe-area，无横向溢出；390 宽 automator 截图见 `_shots_power_sync/`）。
- **电费数据边界**：数据侧保证 `public.power.quantity` 非空；`quantity=null` 不在产品路径（两端遇 null 都按 0 做
  防御性兜底，会显示低电，属实现兜底而非真实数据场景）。
- **诊断页**：微信小程序不能读证书，`site_tls` 只展示云端 `service_health` 行；`site_static` 没有同源站点可探测，
  云端无行时用本机课表快照新鲜度兜底；`cloudbase` 行用小程序本次请求延迟覆盖（网站用浏览器直连延迟）。
- **首页入口**：`power` 与网站一致不进首页常用/排序（仅「全部」页可见）；`diag` 仅管理员在「全部」页可见。
- **AI 元数据**：`agent/page-meta.json` / `ai/common/handoff.js` 仍为 18 页（AI 开发模式关闭，不随正式版提交）；
  若日后重新 `ai_toggle --on` 并把 AI 适配提交，需要为 `pages/power`、`pages/diag` 补 page-meta 条目。

### 7. 代码质量（DevTools「代码质量」面板）修复（2026-11-05 晚，未发版）

> 背景：2026-11-05 18:54 微信开发者工具「代码质量」扫描 2 项未通过 —— 图片和音频资源超 200 K、
> 19 个 AI 原子组件被判无使用。本轮只修这两项，不改业务代码；版本号按用户要求保持 2.0.0。

**规则口径**（逆向开发者工具内置检查器，详见 `mp-class-tools-tests/CODE_QUALITY_NOTES.md`）：

| 检查项 | 规则口径 | 修复前 | 修复后 |
| --- | --- | --- | --- |
| 图片和音频资源大小应不超过 200 K | **编译包内**所有图片/音频文件**总字节数**（非单文件；含未引用的资源文件） | 243,708 B（238.00 KB）✗ | **108,978 B（106.42 KB）✓** |
| 不应存在无使用的组件 | 基于编译产物（`compiledPkg`，dev 模式）的依赖图：组件 = `component:true` 的 JSON；页面/组件级要求标签真正出现在 WXML（含 import/include）/`componentPlaceholder`/`componentGenerics`；`Agent` 类型模块不在遍历范围 | 19 个 `ai/skills/*/components/*` ✗ | **0 ✓**（`ai/`、`agent/` 被排除出编译包） |
| 不应存在无依赖文件 | 同依赖图；`setting.ignoreDevUnusedFiles` / `ignoreUploadUnusedFiles` 均非 false 时按官方逻辑自动放行 | 已通过 | 已通过 |

**修复方式**：

1. **图片**：26 个较大 PNG 转 PNG-8 调色板量化（`share/*.png`、`logo.png`、`app-icon-1024.png` 为 256 色），
   小图标用精确调色板无损重编码；路径/文件名/扩展名/像素尺寸不变（share 仍 500×400、每张 ≤10.53 KB）。
   工具：`mp-class-tools-tests/optimize_images.py`（幂等，`--dry-run` 可先看）；生成脚本
   `mp-class-tools-tests/make_share_images.py` 已接入优化，重新生成不会回涨。
2. **无使用组件（含时序说明）**：18:54 扫描时 AI 开发模式仍开启（19:28 才 `--off`），`app.json.agent.skills`
   把 8 个技能目录下 19 个组件带进依赖图；它们只通过 `mcp.json` 的 `_meta.ui.componentPath` 被 AI 运行时引用、
   不是 `usingComponents` 声明，而官方检查器不遍历 `Agent` 模块 → 全部报无使用。修复：
   `mp-class-tools-tests/ai_toggle.py --off`（发版默认）现在同时向 `project.config.json` 的 `packOptions.ignore`
   写入 `ai`、`agent` 两条 folder 排除项 —— 所有编译模式（含上传 prod）都不再包含 AI 源码；
   回滚用 `--on` 精确移除这两条（源码目录不删除、不移动）。
   > 注意：AI 开启期间官方扫描仍会列出这 19 个组件（微信 AI 开发模式 beta 的静态分析限制，与本项目代码无关）；
   > 发版/质量扫描请保持 `--off` 状态。

**验证（2026-11-05 晚）**：

- `cli.bat auto-preview` 编译通过：**TOTAL 532,652 B**（修复前 667,382 B，-134,730 B = 图片压缩量）；
- 关键实验：关掉无依赖文件过滤模拟质量扫描编译时，加 `packOptions.ignore` 后编译包 907,329 B → **549,039 B**
  （-358,290 B），证明 `ai/`、`agent/` 确实从质量扫描产物中消失；
- 离线复刻检查器 `node mp-class-tools-tests/code_quality_check.js --project mp-class-tools`：
  媒体 106.42 KB PASS、未使用组件 0 PASS；
- 回归：`node unit.js` 147/147、`node sync_contract_test.js` 29/29、`python staticcheck.py` exit 0、
  `python test_ai_toggle.py` 78/78；
- 独立验收（第二位验收者，8 个独立脚本 + 19 份日志）：图片 PSNR 58–68 dB（近无损）、PNG CRC/Pillow/ffmpeg 全过、
  35 张尺寸与引用零变化、配置只差 ignore 两条、真实 DevTools ignore 因果实验复现 -358,290 B（详见
  `mp-class-tools-tests/_verify/VERIFY_REPORT.md`）。

**复扫方式**：微信开发者工具 → 调试器「代码质量」面板 → 「重新扫描」；预期上述两项变为「已通过」。
日常开发恢复 AI：`python mp-class-tools-tests/ai_toggle.py --on`；再发版前 `--off`。

## 一、班级身份系统（v12 核心）

### 1. 身份来源：只有 `class_verify`

| 环节 | 实现 |
| --- | --- |
| 启动页 | `app.json` 第一页 = `pages/identity/identity`（非 tabBar 页） |
| 输入 | 真实姓名 + 10 位学号（`pages/identity/identity.*`） |
| 校验 | `POST {restBase}rpc/class_verify`，body `{"p_sid":"学号","p_name":"姓名"}`，只带 `Authorization: Bearer <publishableKey>` |
| 成功 | 返回 `{ok:true, token, sid, name, role, badge, is_admin}`；小程序保存到 `wx storage['zq_class_identity']` |
| 失败 | 云端 `{ok:false, reason}`（如「姓名或学号不在班级名单中」），界面显示原因、不进入工作台 |
| 名单 | 验证成功后 `POST {restBase}rpc/class_members`（body `{}`，带 `X-Class-Token`）→ 70 人 `[{seat,sid,name,role,badge,is_admin}]`，缓存到本机 `classMembers` / `classRoster` |
| 进入 | 名单同步完（或失败降级提示）后 `wx.switchTab('/pages/index/index')` |

### 2. 请求鉴权：统一 `X-Class-Token`

- 所有 `wx.request` 统一从 `utils/cloud.js` 发出：
  - 数据请求默认带 `Authorization: Bearer <publishableKey>` + `X-Class-Token: <token>`；
  - 仅 `class_verify`（获取身份的入口）不带 `X-Class-Token`；
  - **没有有效身份时，`utils/cloud.js` 不发出任何数据请求**（直接 reject `identity-required`）。
- 课表数据（2026-11-07 起去域名化）：`utils/cloud.js → ttFetch()` **优先**请求 CloudBase
  `public.site_assets` 的 `id='tt'` 行（`GET ...?select=body,meta&id=eq.tt`，走统一 `request` 通道，
  带 `Authorization: Bearer <publishableKey>` + `X-Class-Token`）；该请求失败（网络 / 404 / 空行 / 格式错 /
  旧配置无 `tables.siteAssets`）才回退 legacy 站点静态 `https://tool.furina.fun/tt.json`（**不带身份头**，
  避免把班级 token 发到非 CloudBase 域名）。两者都失败时 reject，页面保留本机课表缓存、不阻塞进入。

### 3. 页面守卫：无身份不能使用任何页面

所有页面 `onShow` 第一行调用 `identity.ensure()`：本机没有有效身份 → `wx.reLaunch('/pages/identity/identity')`。
覆盖：工作台、工具、我的、课表、抽签、分组、结果单、作业、通知、体测、国标表、点名、反馈、使用说明、班委、统计。
工作台/工具/我的为 tabBar；身份页不是 tabBar，退出身份时同样 reLaunch 回身份页。

### 4. 身份信息页（「我的」）

`pages/me/me.*` 只展示：姓名、角色 / 徽章 / 管理员文字 pill、身份已验证状态（**不再显示头像与学号**）；提供「立即同步」「退出身份」「清空数据」「反馈建议」「使用说明」与数据隐私说明。
**不再有**密码输入、注册、昵称登录、复制账号等旧入口。

### 5. 班委名单（新增工具）

- 注册在 `utils/tools.js`（`key: 'bz'`，名称「班委」，普通工具、所有已认证同学可见，工作台/工具页均可进入）。
- 页面 `pages/committee/committee.*`：列出 `class_members` 中 **role 非空** 的成员，展示姓名、`role` / `badge` 文字气泡、管理员标识（不显示头像 / 学号）；
- 数据来自本机 `classMembers` 缓存；缓存缺失时静默重新请求 `class_members`，支持下拉刷新。

### 6. 统计页（按账号、仅管理员）

- `pages/stats/stats.*`：仅 `is_admin` 身份可进入（否则显示「仅管理员可见」）。
- 数据来源 `public.visits`：每次身份后访问写 `{id: sid+"|"+slot, slot, sid, name, did, ts}`（每小时同一账号去重），带 `X-Class-Token`。
- 页面按姓名聚合（**不显示学号**）：姓名、访问次数、最近访问时间；另可按天 / 按小时的去重账号数柱状图（今天 / 近 7 天）。
- **只统计有学号的 visits 行**：v12 之前的历史匿名访问（`sid` / `name` 为空）在页面侧被过滤，不会出现「未知账号」；也不按匿名设备统计（`did` 只作为上报去重用途）。

### 7. 退出身份

「我的 → 退出身份」：清除 `zq_class_identity` 与班级名单缓存（`classMembers` / `classRoster`），reLaunch 回身份页；作业/通知/体测等本机数据保留（可另行「清空数据」）。

## 二、云端配置与发布前检查

### 1. 云端配置（当前环境已填好并开启）

`utils/cloud-config.js`：

```js
module.exports = {
  enabled: true,
  restBase: 'https://tool-d4gosudok46e0e081.api.tcloudbasegateway.com/v1/rdb/rest/',
  publishableKey: '<公开（匿名）令牌>',
  rpc: { verify: 'rpc/class_verify', members: 'rpc/class_members' },
  ttUrl: 'https://tool.furina.fun/tt.json',        // legacy 兜底（新链路优先 CloudBase site_assets）
  tables: { homework, notices, marks, userdata, feedback, fitrecs, visits,
            power, powerHistory, serviceHealth,
            siteAssets: 'site_assets' }             // 2026-11-07：课表快照（id='tt' 行 body={c,t,meta}）
};
```

> 课表读取顺序（2026-11-07）：CloudBase `public.site_assets`（`id='tt'`）优先 → 失败回退 legacy
> `https://tool.furina.fun/tt.json` → 两者都失败保留本机缓存。`site_assets` 的 RLS：有效班级 token 可读
> （管理员 token 可写，由本机课表同步脚本回填）。

> `restBase` 对应网页版里的 `var CB`，`publishableKey` 对应 `var CBK`。
> **绝不要**把 appsecret / 高权限服务端密钥写进这里 —— 它随小程序包发到客户端。
> 旧的 `users` 表与 `public.roster` / `public.identity_verify` 不再从小程序读写；老数据留在云端不删。

### 2. 发布前 CloudBase RPC / RLS 权限要求

云端（CloudBase PostgreSQL + PostgREST）必须由管理员确认以下条件（**域名未变，无需新增域名**）：

| 项 | 要求 |
| --- | --- |
| `class_verify` | 允许 `anon`（publishable key）执行：`POST rpc/class_verify`，入参 `p_sid` / `p_name`；返回 token 与身份字段 |
| `class_members` | 允许持有效 `X-Class-Token` 的身份执行：`POST rpc/class_members`，body `{}`；无 token / 过期 token 返回空或拒绝 |
| 班级数据表 | `homework` / `notices` / `marks` / `fitrecs` / `userdata` / `feedback` / `visits` 的 RLS 必须校验 `X-Class-Token`（请求头由 PostgREST 透传给策略函数）；无 token 返回空/拒绝 |
| `visits` | 普通身份可 `INSERT`（写自己的 `sid`/`name`）；仅 `is_admin` 身份可 `SELECT` 全表（统计页） |
| token 生命周期 | token 不落日志；如设置过期时间，小程序重新验证即可（退出身份会清空本机 token） |

### 3. 服务器域名（上线必做，开发期已关校验）

`project.config.json` 现在是 `"urlCheck": false`（**仅开发期**方便调试）。
上传/发布前请在 **小程序后台 → 开发管理 → 开发设置 → 服务器域名** 添加（与 v11 相同，**域名未变**）：

| 类型 | 需要填的域名 | 说明 |
| --- | --- | --- |
| request 合法域名 | `tool-d4gosudok46e0e081.api.tcloudbasegateway.com` | `class_verify` / `class_members` 与全部数据表；**课表也优先走这里**（`site_assets` 表，2026-11-07 起） |
| request 合法域名 | `tool.furina.fun` | **仅 legacy 兜底**：CloudBase `site_assets` 读取失败时才回退 `https://tool.furina.fun/tt.json`。不添加也能正常使用（主链路已去域名化）；添加上则多一层旧链路兜底。用户暂停 `furina.fun` DNS 后该兜底自然失效，不影响 CloudBase 主链路 |

要求：**HTTPS**、端口 443、域名需 ICP 备案（国内主体）。不配的话真机上请求会被拦截。

## 三、目录结构

```
app.js / app.json / app.wxss   入口、全局配置、M3 设计系统（token + 组件样式 + 液态气泡 .lp-bubble/.lp-chip）
components/                    touchable(涟漪) · segmented · top-app-bar · bottom-sheet · empty-state · swipe-item · roster-picker(班级名单选择器)
pages/                         tabBar: index(工作台) all(工具) me(我的)
                               identity(身份首页) committee(班委) stats(统计) tt(课表) **data(数据与隐私)**
                               draw group sum hw nt ft fttable fb ug roll（18 页）
utils/                         identity · cloud · cloud-config · **cache(分块持久缓存)** · **privacy(导出/清除纯逻辑)** · store · roster(名单座号选择/迁移) · tools · canvas · fit · flow · notify · qr · util
images/                        tabBar 图标 / 工具图标
cloudfunctions/notify           订阅消息发送（与班级身份无关）
```

## 三·补、性能与缓存（1.4.5，2026-11-04）

**背景（实测）**：`notices` 表一次整表响应 **2,001,996 B**（43 行：24 auto + 19 manual；9 张图片 data URI
1.31MB + 5 个文件 data URI 0.61MB；元数据仅 53KB），服务端无 gzip。旧实现每 30s 轮询、每次进通知页都整表
重拉（≈236MB/h）；冷启动到通知页首屏要拉 3 次同一张表（≈5.9MB）。

**实现**
- `utils/cache.js`（新增）：wx storage 分块持久缓存。键 `zqc1_idx`（manifest，含 `{n,at,ttl,ver,bytes,chars}`）
  + `zqc1_<sid>_<name>_<i>`（块，UTF-8 估算 ≤600KB/块，低于单 key 1MB 上限；总预算 5MB，超限按 at LRU 淘汰）。
  按学号 sid 命名空间；缺块 / 损坏 / 版本不符 → 返回 null 并清理；写失败静默（业务照常走网络）。
- `utils/cloud.js`：
  - 通知：`ntAutoPull()` 有缓存 → 先给缓存；TTL（10min）过期 → 先发
    `notices?select=id,ts&order=ts.asc,id.asc`（≈2KB）比对 `id:ts` 签名，一致只更新 `lastSync`，
    不一致才整表拉并重写分块缓存；`force`（下拉刷新）只跳过 TTL、不跳过签名；单飞去重（`ntSync`）；
    真的变了才 `notifyPages()` 让页面重绘。
  - 其他表：`lastSync` TTL 门控（homework 10min、fit 5min、marks 2min、members/tt 6h），命中直接返回
    `zq_tools_v2` 本机数据（0 请求）；`cloudPull(force)` 供 30s 轮询（轮询无 force，TTL 内 0 请求）。
  - `ttFetch()`：课表走 6h TTL + `ttCache` 快照，不再每次进页重拉（2026-11-07 起数据源优先
    CloudBase `site_assets`，legacy `tt.json` 仅兜底）。
- `app.js`：首屏后 ~300ms 才后台预热（`WARM_MS`）；30s 轮询 TTL 门控；`udSync` 由每 30s 改为 5min 节流；
  onHide 清预热定时器。首次无缓存仍会拉一次整表（工作台需要通知待办），之后全部走缓存。
- 隐私：`identity.clear()` / 学号变化保存 / 「我的 → 清空数据」都会 `cache.clearAll()`，共用手机不串号。

**效果（Node mock + 真实云端只读探测）**
- 20 轮 × 30s 轮询：**90 请求 / 56.75MB → 9 请求 / 4KB**（整表 0 次、签名 1 次；−99.99%）。
- 二次启动到通知页首屏：8 请求 / 6.18MB → **2 请求 / 6B**；缓存命中 2.4ms（冷读分块 + parse 2MB）、
  内存热缓存 0.02ms；TTL 过期仅 1 次 ≈889B 签名请求。
- 真实云端：ts 签名查询 **2,152B / 38ms** vs 整表 **1.91MB / 322ms**（约 930×）。
- 开发者工具 automator（真实云端）：通知缓存落盘 **1,988,238B / 6 块 / 单块最大 612,415 字符**
  （<614,400 上限）；二次进入 **0 请求**、0 console error。

**验证**：`node unit.js` **79/79**（61 原有 + 18 缓存单测，`cache_unit_tests.js` 由 unit.js 调用）、
`node cache_perf_test.js` **16/16**、`python staticcheck.py` handlers missing 0、
`cli.bat preview` 编译通过（TOTAL 558.7KB / 572,155B）。
**说明**：真机未测（本机仅有开发者工具模拟器）；真机性能请以「请求次数/字节 + 首屏是否有缓存」为准。
风险：签名只含 `id:ts`，若服务端手工改内容但不更新 `ts`，客户端会继续用旧缓存；单条缓存 >5MB 会被预算拒绝。

## 三·补二、数据与隐私与同步 v6（1.4.6，2026-11-05）

**目标**：网页与小程序同一账号下，**用户自己改动的内容全部双向互通**；并把数据管理/隐私说明收进独立页面。
无新表、无 DDL、RLS 不变（`marks`/`userdata` 仍只允许本人 token 读写、无 DELETE）。

**同步范围**（两端同一契约）

| 类别 | 载体 | 说明 |
| --- | --- | --- |
| 作业完成 / 通知置顶 | `marks kind='hw' / 'nt'` | 1.4.6 前已有 |
| **通知已处理（自动通知）** | **`marks kind='ntdone'`**（新增） | ref = 通知组 id；取消写 `val=false`，不 DELETE |
| 工具栏顺序 / 体测录入 / 抽签参数 / 分组参数+名单 / 抽签参与名单 / 点名名单与到·假 / 隐藏项 / 课表与提醒偏好 / 昵称 | `userdata` blob **v6** | 每项带 `at` 时间戳，逐 section 合并 |
| 体测历史 | `fitrecs` | 既有 |
| 访问统计 / 反馈 | `visits` / `feedback` | 既有，**云端不可删除**（如实说明） |

**userdata v6**（单行 `{id:学号, blob, ts}`）：

```jsonc
{ "v":6,
  "at": { "homeTools":0,"fit":0,"draw":0,"group":0,"roster":0,"hide":0,"tt":0,"prefs":0,"nick":0 },
  "homeTools": [], "fit": {}, "draw": {}, "group": {},
  "roster": { "rosterSel":[],"rollSel":[],"rollSt":{},"rollNames":"" },
  "hide": { "hwHide":{},"ntHide":{} },
  "tt": { "ttView":"","ttUseMine":false,"ttLocal":null,"termStart":"" },
  "prefs": { "hwRemind":{},"ntSub":false,"ntSubAt":0 }, "nick": "",
  "homeToolsAt": 0 }   // 旧版兼容镜像
```

- **合并规则**（`utils/cloud.js mergeUd`，与网页 `UD.merge` 逐字节一致）：逐 section 比较 `at`，
  `remote.at >= local.at` 时云端赢（同 at 云端赢，幂等收敛）；缺少的字段用默认值；旧 v5 blob
  （`{v:5,fit,homeTools,homeToolsAt}`）自动迁移；**不拥有的 section 原样保留**（小程序不写 `nick` 与
  `tt` 除 `termStart` 外的字段）。
- 拉取：启动/回到前台/`cloudPull` 内 TTL 60s；推送：本机脏 section 防抖 1200ms，先 GET 合并再 POST upsert；
  离线进 `udPend` 待补发；应用远端数据**不会**重置进行中的抽签/分组结果。
- 关闭同步（隐私页开关，`store.cloudOff`）→ 不拉不推、marks 入队；恢复后补推一次。

**数据与隐私页**（`pages/data/data`，入口：我的 → 数据与隐私）
- 身份摘要（姓名/角色，**不显示学号**）；云同步开关与状态；12 项同步范围清单；
- 本机数据概览（`wx.getStorageInfoSync` + 各类条数）；云端数据说明（含访问统计/反馈不可删除的原因）；
- 操作：立即同步 / 导出我的数据（JSON → 剪贴板，**不含 token、学号、名单原文**）/ 清除云端我的数据
  （userdata 覆盖为空 v6 + marks 全置 false + fitrecs 归档；**清除后到用户再次显式修改前不会自动回推**，
  页面有说明）/ 清除本机数据（保留身份）；隐私说明（收集/不采集/用途/存储/保留/共享/反馈渠道）。
- 旧「只存本机/仅本机」文案已全部按新范围改写（me / identity / roll / ug / cloud-config）。

**验证**
- `node unit.js` **79/79**；`node sync_contract_test.js` **26/26**（merge 与契约 fixture 逐字节一致、v5 迁移、
  ntdone upsert/读取、远端应用、push body 契约含未拥有 section 保留、防抖、cloudOff、清除抑制期、导出隐私）；
- `python staticcheck.py`：**18 页**、handlers missing 0、分享 handler/封面 0 缺失；
  `node table_check`? 否；`cli.bat preview` 编译通过 **588.2 KB / 602,290 B**；
- 独立验收（QA，fresh context）：合并算法独立实现 116/116、wx mock 独立复跑 25 项、隐私 strict 31/31、
  开发者工具 automator 真实云端 **34/34 PASS / 0 console error**（含「标记已处理→退出重进仍已处理」、
  隐私页导入导出/开关/清除）。
- **未验证**：真机；真实云端写入默认不做（全 mock；发布前如需可在开发者工具里人工验证）。
- 风险：清除云端后本机仍保留内容，直到用户再次修改才重建云端副本（页面已说明）；marks 无 DELETE，
  还原只能写 `val=false`（功能等价）。

## 四、数据契约

| 键 / 表 | 用途 |
| --- | --- |
| `zq_class_identity` | 班级身份 `{token,sid,name,role,badge,is_admin,ts}`（wx storage，唯一身份真源） |
| `zq_tools_v2` | 本机主数据（作业 / 通知 / 名单 / 体测 / 工具顺序等，固定单桶）。1.4.1 起三处名单只存座号数组：`rosterSel`（抽签参与名单）/ `group.sel`（分组班级名单成员）/ `rollSel`（点名名单），`roster` / `group.names` / `rollNames` 为派生文本（由 `utils/roster.js` 写，不再手工编辑），`selVer` 为旧名单迁移标记。1.4.6 起新增 `ntDone`（通知已处理）/ `udCache`（最近合并的 userdata v6 快照）/ `udPend`（待推）/ `cloudOff`（仅本机）/ `udHoldUntil`（清除云端后的抑制期） |
| `zq_flow` | 抽签 → 分组 → 结果单 的跨页状态（小程序专用；不同步） |
| `ziqi.tools.v1` | 旧版数据（只读兼容） |
| `zqc1_idx` / `zqc1_<sid>_<name>_<i>` / `lastSync` | 通知 auto groups 分块持久缓存 + 各表上次同步时间（1.4.5；按学号隔离，退出身份/换号清空；总量 ≤5MB） |
| `homework` / `notices` | 作业 / 通知（带 `owner`=学号，管理员或发布者可删） |
| `marks` | 勾选状态 `{id: 学号\|kind\|ref, seat, kind, ref, val, ts}`；`kind = 'hw'（作业完成）\| 'nt'（通知置顶）\| 'ntdone'（自动通知已处理，1.4.6 新增）`；取消写 `val=false`，无 DELETE |
| `fitrecs` | 体测历史（`acc`=学号，最多两条） |
| `userdata` | 个人数据 blob **v6**（1.4.6）：`{v:6, at:{homeTools,fit,draw,group,roster,hide,tt,prefs,nick}, homeTools, fit, draw, group, roster, hide, tt, prefs, nick, homeToolsAt}`；`id`=学号；旧 v5 `{fit,homeTools,homeToolsAt}` 自动迁移 |
| `feedback` | 反馈 `{id,content,contact,acc(学号),done,ts}`；1.5.2 起 `contact` 停用（不再收集 QQ / 微信，新提交恒为空串，旧值已清空） |
| `visits` | 访问统计 `{id: 学号|slot, slot, sid, name, did, ts}`（统计页按账号聚合） |

## 微信原生分享（1.4.0，2026-11-04）

- **不塞自定义分享按钮**：直接用微信右上角「···」菜单的 转发 / 分享到朋友圈；每个页面 `onShow` 调 `share.enable()` 打开菜单（`wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage','shareTimeline'] })`）。
- **每页的分享内容**：`onShareAppMessage` 返回 `{ title, path, imageUrl }`；`onShareTimeline` 返回 `{ title, query, imageUrl }`（朋友圈打开当前页，不需要 path）。
  - 工作台：`班级工具｜今日课程 · 作业 · 通知` → `/pages/index/index`
  - 课表：`班级课表｜第 N 周` → `/pages/tt/tt?wk=N`（课表页 `onLoad` 支持 `wk`，打开即定位该周）
  - 通知：`班级通知｜<最新一条标题>` → `/pages/nt/nt`
  - 班委：`班委名单｜N 名班委` → `/pages/committee/committee`
  - 其它页（抽签/分组/结果单/作业/体测/国标表/点名/统计/反馈/使用说明/数据与隐私/我的/身份）：各自的标题 + 本页路径
- **分享封面**：`images/share/*.png`，500×400（微信建议 5:4），8 张（default / index / tt / hw / nt / draw / ft / bz）；生成脚本 `mp-class-tools-tests/make_share_images.py`。
- **回归**：`node share_check.js`（开发者工具 automator）逐页调用 `onShareAppMessage` / `onShareTimeline`，校验 title / path / query / 封面文件存在，并 hook `wx.showShareMenu` 确认菜单参数；`staticcheck.py` 增加「每页分享 handler + 封面存在」检查。

## 五、功能对照（网页版 → 小程序）

| 功能 | 小程序位置 | 状态 |
| --- | --- | --- |
| 班级身份验证（姓名 + 学号 → class_verify） | `pages/identity/*` + `utils/identity.js` | 新增；唯一身份入口 |
| 身份后页面守卫 | 各页 `onShow` 首行 `identity.ensure()` | 新增；无身份 reLaunch |
| 班委名单（role 非空 + 角色/徽章气泡） | `pages/committee/*` + `utils/tools.js` | 新增；全员可看 |
| 访问统计（按账号、仅管理员） | `pages/stats/*` + `public.visits` | 重写；不再按匿名设备 |
| 我的（身份信息 / 退出身份 / 数据隐私） | `pages/me/*` | 重写；移除密码/注册/昵称 |
| 课表：只读 / 周次切换 / 本节详情 | `pages/tt/tt.js` | v11 已完成，未破坏；请求改走 `cloud.ttFetch()`；1.5.3 起内容区左右滑动切周（跟手 + 飞出飞入，对齐网页）；2026-11-06 起 6/7 天列宽自适应同页完整显示（周六/周日有课不再需要横向滑动） |
| 抽签：范围/个数/排除/重复/剔除/补抽 | `pages/draw/draw.js` + `utils/util.js` | 完全对齐（第 1 步）；1.4.1 起参与名单只来自班级名单（座号选择），未选 = 只抽序号 |
| 分组：按组数或每组人数/打乱/轮转 | `pages/group/group.js` | 完全对齐（第 2 步）；1.4.1 起成员来源 = 上一步抽签 / 班级名单（座号选择） |
| 结果单：cfg+blocks/复制文本/导出图 | `pages/sum/sum.js` + `utils/canvas.js` | 完全对齐（第 3 步） |
| 作业板：发布 / 完成标记 / 云端 | `pages/hw/hw.js` + `utils/cloud.js` | 完全对齐（发布需身份，全部页面本就需身份） |
| 通知板：发布 / 置顶 / 重要 / 云端 | `pages/nt/nt.js` | 完全对齐 |
| 通知发布者职位气泡 / OCR 小标记 | `pages/nt/nt.{js,wxml,wxss}` | 新增（1.4.2）/ 改职位气泡（1.4.3）：`senderName/senderRole/senderBadge` + `ocr`，气泡文字 = 职务，后端下发前端只读 |
| 体测计算器 / 历史（按学号跨端） | `pages/ft/ft.js` + `utils/fit.js` + `public.fitrecs` | 完全对齐 |
| 体测国标评分表 | `pages/fttable/fttable.js` | 新增（男/女 × 年级） |
| 点名（到/假/沉底/沿用抽签名单） | `pages/roll/roll.js` | 记录随账号同步（1.4.6 起，`userdata.roster`）；1.4.1 起名单只来自班级名单（座号选择），可一键沿用抽签参与名单 |
| 统一导图出口（导出卡 v2：text / chips / groups） | `utils/canvas.js` | 完全对齐；1.5.1 起版式与网页端 `exportCard()` 一致，仅色板（暖色）/品牌（班级工具站）/二维码不同 |
| 反馈建议（提交 / 我的 / 管理员） | `pages/fb/fb.*` + `utils/cloud.js` | 完全对齐；管理员=is_admin；1.5.2 起不再收集 QQ / 微信联系方式 |
| 使用说明 | `pages/ug/ug.js` | 16 条：身份/工作台/抽签/名单/分组/作业通知/班委/工具排序与首页编辑/体测/反馈/点名/**宿舍电费（关注/低电阈值/点击拖动查看趋势/慢更新）**/**通知附件（微信文件/压缩包识别/跨源合并）**/**工作台电费卡**/**水量抄表**/分享；与网页口径一致、简洁 |
| 多端同步（拉取/推送/待补发） | `utils/cloud.js` + `app.js` | 完全对齐；按身份 token |
| 订阅消息（作业/通知） | `cloudfunctions/notify` + `utils/notify.js` | 保留，未改动 |
| **微信原生分享（转发 / 朋友圈）** | 各页 `onShareAppMessage` + `onShareTimeline` + `utils/share.js` | 新增（1.4.0）：每页有标题/封面/打开路径，课表带周次、通知带最新标题 |

### 导出卡 v2（1.5.1，2026-11-05）

- **入口**：所有页面仍只调 `utils/canvas.js` 的 `exportAndSave(page, '#card', opt)`；`opt` 结构
  `{title, sub, config:[[k,v]], blocks:[...], foot, rec}` 不变，`drawCard(g, canvas, opt)` 返回值仍是逻辑高度 `H`。
- **内容块三种**：`{label, lines:[string|runs], mono?}`（旧文本块全兼容）、`{label, chips:[{n,nm}]}`（抽签结果胶囊）、
  `{label, groups:[[{n,nm}]]}`（两列组卡，组头「第 N 组 + N 人」自动生成且不出现学号）。
- **页面接法**：`pages/draw` 用 `this.data.rows` 生成 chips；`pages/group` 用 `this.data.groups` 生成 groups；
  `pages/sum` 抽签 chips + 分组合成一个 groups 块；`pages/hw|tt|ft` 仍传文本块，字号/折行由版式自动处理。
- **版式要点**：760 逻辑宽 / DPR2；主卡内缩 22、圆角 22、投影只用于卡片填充；参数配置面板按标签 ≤104px、值 ≤190px
  的实测宽度自动判两列（306×2，间距 20）或单列（单列标签列宽按实测自适应 110–186，长标签不硬折行）；区块标题 = 5×5 圆角方块；页脚 = 生成时间 + 编号 + 右对齐品牌三色点。
- **水印与隐私**：斜向平铺「班级工具站」（700 15px、alpha 0.03、-20°）先 `clip()` 到主卡圆角路径，绝不画出卡外；
  导出图仅含参数、结果、时间与编号，不含学号 / 手机号 / 宿舍号。
- **回归**：`node unit.js`（导图断言覆盖标题/参数/页脚/编号/品牌、水印裁剪、两列/单列、chips、groups、高度自适应、折行、
  exportAndSave）+ `python staticcheck.py`；成图用 `python render_export.py draw|group|sum|hw|tt|ft` 落盘
  `mp-class-tools-tests/_shots/export/mp_*.png` 逐张肉眼核查（无溢出 / 无重叠 / 无截断 / 无空底 / 水印只在卡内）。

### 课表内容左右滑动（1.5.3，2026-11-05）

- **手势范围**：只包「课表内容」——周视图的周表滚动区 + 日视图的日期/课程区（`.ttswipe-track` 内）。
  网页端是「整张课表卡起手都能切周、只动 `.ttmain`」；小程序按设计规范「课表内容切上一周/下一周」收窄，
  周导航头部、周/日切换、下一节、全部课程列表不响应滑动（周/日视图仍只点击切换）。
- **参数（逐项对齐网页 `web/tools/index.html` §左右滑动）**：横向锁定 12px 且 `|dx|>|dy|*1.35`；松手
  `|dx|>|dy|*1.1` 且 ≥56px 才提交；无上一周/下一周时 0.28 阻尼；fly 距离 `min(340,max(120,窗口宽×0.5))`；
  飞出 `.16s ease` + opacity .25 → 150ms 后换周 → 新内容从 `-sign*W` 起、`.23s cubic-bezier(.22,.8,.3,1)` 飞入；
  滑动后 320ms 内**所有可点入口**（课程详情、星期、‹/›、本周、周/日、全部课程、导出）都忽略首下点击。
- **横向适配（2026-11-06 用户反馈改版）**：周表列宽**始终**按卡片内宽自适应——
  `colW = floor((TT_CARD_INNER - TT_PD_COL) / days.length)`（`TT_CARD_INNER`=630rpx、节次列 `TT_PD_COL`=96rpx），
  5/6/7 天 = **106/89/76rpx**，内容宽 `96 + N×colW` = **626/630/628rpx ≤ 630rpx**，**周六/周日有课也一屏完整显示，
  不再需要横向滑动看全**（旧版 6/7 天固定 106rpx → 732/838rpx 溢出，需先滚表格）。6/7 天挂 `.tt-dense`/`.tt-dense7`：
  课程名 21/19rpx、教室 17/15rpx、单节块课程名最多 2 行（`-webkit-line-clamp:2`）、7 天隐藏冗余「第X-Y节」（`showSpan=false`）、
  表头星期/日期 22/18rpx 且允许换行；行高 96rpx、跨节次定位、课程块点击区不变。
  `_gridOverflow`/`_gridMaxX`/`scroll-view` 仅保留为防御性兜底（恒 false/0）；周表不溢出的前提下，任何横向手势都直接切周。
  **注：这是小程序内的自适应列宽；网页 6 天用 `table-layout` 自适应，两端布局仍非逐位等价。**
- **已知差异（历史行为，本次未改语义）**：网页换周会重置日视图选中日，小程序保留既有 `_dayUser` 选择；本次只同步滑动效果。
- **回归（2026-11-06 更新）**：`node unit.js` 7b 段——5/6/7 天 `colW` 与内容宽 ≤630、`_gridOverflow=false`/`_gridMaxX=0`、
  6/7 天左右滑直接切周（无 giveScroll）、首末周 0.28 阻尼回弹、日视图、320ms 点击全抑制且过期恢复、多指/动画保护、卸载清理、
  WXML/WXSS 静态断言（colW 行内 style、dense/dense7 标记、7 天 `showSpan=false`、19rpx 下限、2 行 clamp）；
  `node tt_swipe_preview.js`（开发者工具 automator 真实渲染/触摸，390 宽模拟器）**43/43 PASS、0 console error**，
  截图 `_shots_tt_fit/`（00 5 天对照 / 01 6 天含周六 / 02 7 天含周六·周日 / 03 日视图滑动 / 04 切周后）。

## 六、数据与隐私

- 只使用 **姓名 / 学号 / 角色 / 徽章 / 管理员标识**；不采集、不展示身份证等证件信息。
- 页面不显示学号（1.3.3 起移除此前的打码展示）；学号只用于云端身份校验与数据归属；命令/日志不打印 token 明文。
- 云端只同步：作业、通知、勾选状态、体测历史、用户偏好、反馈、访问统计（`{slot,sid,name,did,ts}`）。
- 课表 / 抽签 / 分组 / 点名 / 体测 / 隐藏项 / 课表偏好 / 昵称等用户改动内容：1.4.6 起**随账号同步**（见「三·补二」），
  网页与小程序互通；可在「我的 → 数据与隐私」查看/导出/关闭同步/清除；身份 token 与班级名单缓存仍只在本机。
- 退出身份即清空本机身份 token 与班级名单缓存。

## 七、硬约束自检

```
云开发业务 API / 内嵌网页组件 / 用户信息接口  → 小程序业务代码 0 处
订阅消息：仅 cloudfunctions/notify 一个云函数（wx-server-sdk + cloud.openapi）
仓库只含公开 publishable key，不含 appsecret / 高权限服务端密钥
appid wx3df9869d229b96c4 · compileType miniprogram · libVersion 3.0.0 · urlCheck false（开发期）
```

## 八、测试与本地预览

> 最新基准（2026-11-11，task-7）：`node unit.js` **437/0**（含 `task7_unit_tests.js` 23 项：缓存/提醒/水量/预设/徽章）、
> `node sync_contract_test.js` **33/0**、`python staticcheck.py` exit 0、`node code_quality_check.js` exit 0、
> `node task7_preview.js` automator **34/0**（0 console error，截图 `_shots_task7/`）、
> `node cache_speed_bench.js` 改造前/后 3/3（`_perf_cache_v2_result.json`）。

```powershell
cd C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools-tests
node unit.js            # 单元/契约（437 项：缓存 / 同步 / 名单 / 通知 / 分享 / 投票 / PPT / task-7 等）
node sync_contract_test.js  # 数据同步契约：merge 与契约 fixture 逐字节一致、ntdone、push body、cloudOff、清除抑制期、导出隐私
python staticcheck.py   # 页面/组件/事件/硬约束/包体审计（26 页）
node code_quality_check.js  # 代码质量规则（退出码 0 = 通过）
node cache_speed_bench.js   # 需求 9：改造前（_baseline_cache_20261111 快照）vs 改造后 冷启动请求/首屏/setData 基准
node task7_unit_tests.js    # task-7 专项单测（23 项，独立运行）
node cloudfunctions/notify.test.js                  # 云函数 mock 35 项
node cloudfunctions/notify_fix_20261110.test.js     # 通知修复回归 18 项

# 微信开发者工具预览：
& "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto `
  --project "C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools" --auto-port 9424 --trust-project
node task7_preview.js     # 2026-11-11 task-7 五项需求 automator 实测（mock 网络，0 console error，截图 _shots_task7/）
node identity_preview.js  # 身份页 → 陈子麒/3260707024 验证 → 工作台 → 班委 → 统计，截图到 _shots/
node ia_preview.js        # v1.3.3 信息架构 / 隐私回归：工作台/工具/我的 截图 + 30 项数据/尺寸断言（_shots/ia/）
node roster_preview.js    # v1.4.1 名单选择器回归：70 气泡 → 全选 → 抽签带姓名 → 分组 → 点名沿用/重排，截图到 _shots/roster/
node nt_badge_preview.js  # v1.4.3 通知页回归：职位气泡 + OCR 标记 + 原始消息发送者（真实云端数据），浅色截图到 _shots/nt-badge/
node nt_preview.js        # v1.4.4 通知页全功能回归：默认展开/收起、文件卡、图片、表单/链接/小程序/公众号、标记已处理、原始消息、已截止区块，截图到 _shots/nt/
node tt_swipe_preview.js  # 2026-11-06 课表 6/7 天同页缩放回归：mock 身份+本地 fixture，真实渲染/触摸、全列可见/无横滑/课程名可读/横滑切周/点击详情，截图到 _shots_tt_fit/
```

> `e2e.js` 里的旧登录 / pages/verify / 课表管理用例在 v12 身份系统下已不适用（标注为 v13 待重写）；本次回归以 `unit.js` + `staticcheck.py` + 开发者工具预览截图为准。

## 九、订阅消息（作业截止提醒 / 通知提醒，1.4.7）

- 模板 ID：`eYDRJDSTJdRL-gvE0rM8EbuSZX6mA9L2U-UTA8MwSmo`
- 关键词映射：温馨提示 `thing2` / 时间 `time1` / 摘要 `thing3` / 日期 `time26`
- 云函数：`cloudfunctions/notify`（微信云开发环境 `fengdan-d6g7hnk4gf35685b3`，已部署 Active，Nodejs16.13，timeout 3s）。
  接口：`subscribe`（kind = `hw` 作业 / `ntremind` 单条通知提醒）、`list`（本人 active 提醒）、
  `cancel`（取消本人提醒）、`timer`（定时触发器**每分钟**，处理到点的作业 + 通知提醒）、
  `flush`（前端 catch-up：只补发调用者本人到点提醒，2026-11-10 新增）、`diag`（只读诊断：定时器心跳/积压/历史 lastError，不含 openid，2026-11-10 新增）。
  云函数仍保留 `kind='nt'` / `publishNotice` / `bootstrap` / `ntStatus` 供**旧版客户端**使用；2026-11-18 起新版客户端不再调用。
- **⚠️ 部署铁律（2026-11-10 根因）**：`cli cloud functions deploy` / IDE「上传并部署」**不会上传定时触发器**。
  改完 `config.json`（triggers）或新建云函数后，必须在开发者工具里**右键 `cloudfunctions/notify/config.json` →「上传触发器」**
  （或右键 `notify` 文件夹 →「上传触发器」）；否则云函数可调用、但 `timer` **永远不跑**，所有提醒都不会送达。
  验证：部署后任意时刻调 `notify {action:'diag'}`，`diag.hb.ts` 应在 2 分钟内不断刷新（source=`timer`）。
- **作业**：作业卡片「提醒」→ 选提前 1 天 / 2 小时 / 自定义时间 → 授权 → 云函数记录，定时器到点发送。
- **通知（1.4.7 新增；2026-11-18 修正提醒基准）**：
  - 通知卡片底部「提醒」：**有活动报名开始 `signupStart` 且未开始 → 以报名开始为基准**
    （报名开始前 1 天 / 2 小时 / 30 分钟 / 报名开始时）；报名开始已过或无报名窗口 → 回退截止
    （截止前 1 天 / 2 小时 / 30 分钟）；两者都没有 → 今天 / 明天 20:00；另有「自定义…」
    （date + time 选择，要求 ≥ now+1min、有截止时不晚于截止、无截止 30 天内；默认报名开始前 2 小时，
    提示文案显示「报名开始 …」而不是「截止 …」）。
  - 已设提醒显示胶囊「提醒 MM-DD HH:MM」；点它可 **修改 / 取消**。云端 `subscriptions` 集合按 openid 记录，
    进入/刷新通知页时用 `list` 核对（换设备/重装后仍能看到本账号提醒；离线保留本机缓存）。
  - 订阅消息点击进入 `pages/nt/nt?gid=<通知组 id>`：页面自动切「全部」、展开并滚动定位该通知。
  - **「新通知提醒」已于 2026-11-18 移除**：新版客户端不再显示简报区按钮、不再订阅 `kind='nt'`、不再写
    `ntSub/newNtAt`、不再调用 `notify.bootstrap/status`；云函数旧 action 仅为旧版客户端保留。
- 安全/隐私：openid 只存云端 `subscriptions` 集合、仅云函数使用；页面/导出不显示 openid；设置提醒需微信用户授权。
- 限制：**一次性订阅模板每次授权只能发一条消息**；若期间被其它提醒消耗，本条可能收不到（`list` 核对会清理失效项）。
- **2026-11-10 修复**：真实云端 `subscriptions` 里 2026-10-21～11-07 的 4 条 active 提醒从未发送（`sentEver=0`、无心跳），
  根因即上面的「触发器从未上传」。云函数已加：定时器心跳、`action='diag'`、**陈旧提醒守卫**（到点 >6h 不再补发，标 `skippedAt`），
  `action='flush'` + 小程序回前台自动补发本人到点提醒（触发器之外的送达保障）。旧积压已按 stale 清理（不发陈旧消息）。
- 测试：`mp-class-tools-tests/notify_ui_test.js`（前端 25 项）、`mp-class-tools-tests/notify_flush_ui_test.js`（flush/diag 契约 10 项）、
  `mp-class-tools-tests/cloudfunctions/notify.test.js`（云函数 mock 35 项）、
  `mp-class-tools-tests/cloudfunctions/notify_fix_20261110.test.js`（修复回归 18 项：心跳/陈旧守卫/flush/diag）；
  2026-11-11 新增 `task7_unit_tests.js` B 组（scan.js 签名/基线/新增检测/门控/诊断 + 第二模板 + 失败归因）；
  真实消息禁止用于自动化测试。

## 九·补、新通知提醒链路修复与部署配置（2026-11-11，task-7 需求 11）——**客户端功能已于 2026-11-18 移除**

> 2026-11-18 用户要求移除「微信新通知提醒」：新版小程序不再显示「新通知提醒」按钮/状态、不再订阅 `kind='nt'`、
> 不再写 `ntSub/newNtAt`、不再调用 `notify.bootstrap/status`。云函数 `notify` 的新通知扫描与旧 action **保留**，
> 仅为已发布的旧版客户端兼容，新版不触发；手动作业/通知提醒（`hw`/`ntremind`）不受影响。
> 以下为历史实现记录，便于旧版排障。

**根因（已定位并修复）**：`kind='nt'`（下一条通知）订阅此前只由云函数 `action='publishNotice'` 消费，
而全仓库没有任何调用方（网页发布通知走 CloudBase，不在微信云开发内）→ 用户开启「新通知提醒」后**永远不会发送**。
另外定时器当时未上传触发器，也会导致所有提醒不送达（2026-11-10 已修）。

**现在的可靠链路（全部在 CloudBase / 微信云开发既有范围内，不新增外部请求来源）**：

1. **客户端 bootstrap**：`app.js warmSync` 调 `notify.bootstrap(identity.token())`，把当前班级 token 上报云函数
   （本机 30 分钟节流，失败静默）；云函数先用 `rpc/class_members` 校验 token，通过后存云开发数据库
   `notify_cfg/__notify_cfg` 文档。token 过期（30 天）后任一小程序客户端再次打开小程序即自动刷新。
2. **云函数定时扫描**：`timer` 每分钟跑一次，在提醒处理之后调 `scanNewNotices()`：
   - 门控：无班级 token / 无 active `kind='nt'` 订阅 / 距上次扫描 < 5 分钟 → **不发任何外部请求**；
   - 用 PostgREST 拉 `notices?select=id,ts,title,hidden,edited_at&order=ts.asc,id.asc&archived=eq.false`
     （与小程序端签名 `ntSigOf` 同口径，**轻量、不拉正文/附件**）；
   - 首次运行只记录基线（不补发历史通知）；之后仅「基线里完全没有的新 id」算新通知；
     删除/隐藏/管理员编辑（签名变但没有新 id）只更新基线不发送；
   - 有新通知 → 取最新一条 title/时间 → 向 active 的 `kind='nt'` 订阅发送（一次性订阅发送成功即置 inactive），
     发送结果写 `sentCount/lastSentAt/lastError` 到 `__notify_cfg`；401/403 记 `token-invalid` 等客户端 bootstrap 刷新。
3. **按钮反馈（客户端）**：授权成功 toast「已开启 · 收到后自动关闭」；简报区显示「云端 N 人已订阅」与本人状态；
   **支持再次开启**（一次性订阅被消耗/过期后点按钮即重新授权）；失败区分可读原因：
   已拒绝提醒授权 / 未开启微信订阅消息（系统设置）/ 云函数未部署 / 网络不可用。
   `requestSubscribeMessage` 始终在点击的同步调用链里先执行（`utils/notify.js ask()` 是 `subscribeNotice()` 第一步）。
4. **诊断**：`notify {action:'diag'}` 增加 `notify` 脱敏视图（hasToken/tokenAgeDays/lastScanAt/lastSentAt/sentCount/
   lastError/baseline），`{action:'ntStatus'}` 返回云端 active 数 + 本人状态 + 心跳；「我的 → 诊断」页新增
   **提醒通道诊断** 卡（定时器心跳时间 / active 订阅数 / 新通知扫描 lastScanAt / lastError）。
5. **应用内提醒（低成本）**：云端通知签名变化且用户开过「新通知提醒」→ 本机 `store.newNtAt` 置位，
   工作台通知卡显示「新通知」角标；打开通知页即清除。

**第二模板 ID（可选，配置数组）**：
- 现只配置 1 个默认模板时行为与旧版完全一致（授权只请求 1 个 tmplIds，发送只用默认模板）。
- 微信后台新增第二个模板（建议关键词与默认模板一致：`thing2`/`time1`/`thing3`/`time26`）后，二选一配置：
  1) `utils/notify.js` 里 `SECOND_TEMPLATE_ID = '<模板ID>'`（授权侧会一次请求 `[默认, 第二]`，接受者优先）；
  2) 云函数环境变量 `NOTIFY_TMPL2=<模板ID>`（发送侧按订阅行 `tmplId` 选择；第二模板发送失败自动回落默认模板）。
  两侧都建议配置（授权侧决定"能否发"，发送侧决定"用哪个模板发"）。未配置即只用现有默认模板。
- 微信后台配置步骤：微信公众平台 → 订阅消息 → 我的模板 → 选用/新增模板 → 复制模板 ID；
  关键词必须与本项目模板数据字段同义（温馨提示/时间/摘要/日期），否则发送会报 47003（此时自动回落默认模板）。

### 2026-11-15 修复：`notify_cfg` 整文档覆盖（token/基线丢失）

- **根因**：云开发 `doc.set()` 是整文档替换，而 `patchCfg()` 原先每次都用 `doc.set({data:patch})`
  写入 `notify_cfg/__notify_cfg`。bootstrap 写入的班级 token 会在第一次 scan 写 `lastSig` 时被清空，
  之后所有扫描都在 `shouldScan` 的 `no-token` 门控处短路；每次 bootstrap 又会清掉 `lastSig/lastIds`，
  下一次扫描重新按首跑基线处理，新通知被跳过 → 线上表现就是「开启新通知提醒后收不到」。
- **修复**：`patchCfg()` 文档已存在时用 `doc.update({data:patch})` 合并字段；文档不存在时
  读取现有配置 + `scan.mergeCfg()` 合并后 `doc.set()` 创建完整文档。新增纯函数
  `scan.mergeCfg(raw, patch)`（保留 token / lastSig / lastIds / lastScanAt / sentCount / baselineAt 等）。
- **验证**：上传后调 `notify {action:'diag'}` → `notify.hasToken=true`、`lastScanAt` 持续刷新、
  `lastError` 为空；`hb.source` 在 1–2 分钟内应为 `timer`（若仍是 `flush` = 触发器没上传）。
  `diag.notify.cfgView` 仍不返回 token 明文。
- **测试**：`notify_flush_ui_test.js` 11/11（C7 防止回退成 `set({data:patch})`）；
  `task7_unit_tests.js` 24/24（B2b：bootstrap→scan→bootstrap 后 token/lastSig 不丢）。
- **部署**：仍需用户按下方步骤上传 `notify` 云函数（含 `scan.js`/`rest-config.js`）并「上传触发器」；
  只改源码不会影响线上旧版云函数。

**部署步骤（需用户在微信开发者工具操作；不得由自动化上传）**：

1. 微信开发者工具 → 云开发（环境 `fengdan-d6g7hnk4gf35685b3`）→ 云函数 `notify` → 右键「上传并部署：云端安装依赖」
   （本次新增 `cloudfunctions/notify/scan.js`、`rest-config.js`，必须随函数一起上传）。
2. 右键 `cloudfunctions/notify/config.json` →「上传触发器」（定时器每分钟；改了 triggers 必须重新上传触发器）。
3. 云开发控制台 → 数据库 → 新建集合 `notify_cfg`（权限：仅管理端/云函数可读写，**不要**开放给小程序直连；
   首次 `bootstrap`/`timer` 调 `createCollection` 也会自动建，手动建更稳）。
4. （可选）云函数配置里加环境变量：`NOTIFY_TMPL2`（第二模板 ID）、`NOTIFY_SCAN_MIN_MS`（扫描间隔，默认 300000）、
   `NOTIFY_REST_BASE` / `NOTIFY_PUBLIC_KEY`（默认值 = 小程序 cloud-config 公开 restBase + anon publishableKey，一般无需改）。
   未加环境变量不影响功能（默认即线上 CloudBase 网关）。
5. 真机自测：用测试身份打开小程序 → 通知页点「新通知提醒」并允许 → 云开发控制台 `notify_cfg/__notify_cfg` 应出现
   token/lastSig/lastScanAt；等 5 分钟后在网页端发一条新通知 → 5 分钟内应收到订阅消息；诊断页确认心跳与 lastError 为空。
   也可在云函数控制台手动测试 `{"action":"diag"}` / `{"action":"scan"}`（scan 仍受 5 分钟节流/订阅门控）。
6. **红线**：`notify_cfg` 里是班级 token，禁止把它写进代码/日志/文档截图；云函数返回的 diag 已脱敏（无 token/openid/ref）。

**已知限制（如实）**：一次性订阅模板每授权只能发一条；一次扫描最多发 100 人（函数 3s 超时保护）；两次通知间隔 <5 分钟
可能合并为「最新一条」提醒（用户只会收到最新通知的提示）；触发器没上传时链路仍不通（先看诊断页心跳）。

## 九·补二、水量共享（2026-11-11，task-7 需求 6；契约 `web/tools/tests/_water_shared_contract.md`）

- 云端表（由网页侧迁移 `deploy/cloudbase/2026-11-11_water_shared.sql` 创建并应用，mp 不新增 DDL/RLS）：
  `public.water (roomverify, month, reading, persons, updated_at)` 主键 `(roomverify,month)`；
  `public.water_room (roomverify, persons)`；RLS 沿用班级 token（`auth_ok()`）。
- 小程序端（`utils/cloud.js` `waterList/waterUpsert/waterDelete/waterRoomGet/waterRoomUpsert`，
  全部走既有统一 `wx.request` → CloudBase PostgREST 通道，**不新增外部请求来源**）：
  进入水量页/切宿舍先渲染本机缓存（UD v6 `water` 继续作离线缓存）→ GET 云端核对；
  同月云端覆盖本地、本机独有月份自动补传；保存/删除/改人数先写本机再尽力写云端，
  失败进本机 `store.waterPend` 离线队列，进页/onShow/恢复后自动重试；GET 有 60s TTL，切页不重复拉。
- **23 号楼 A/B 座固定 4 人间**（`4-23A---*` / `4-23B---*`）：人数选择器禁用并显示「4 人间（固定）」，
  本机与云端 `water_room.persons` 强制 4，首次进入自动 upsert 4。
- 文案（契约 §5）：去掉「每月免费 8/12 吨水」；「免费额度/免费定额」统一改「定额」，公式与数值不变
  （水费 = max(0, 用量 − 2×人数) × 3.03；折合扣电 = 水费 ÷ 0.58）。
- 测试：`unit.js` C 组 + `water_unit_tests.js`（页面/公式/UID water 兼容）；automator `task7_preview.js` C 组
  （云端合并显示、23A 固定、离线 pending 重试、文案检查）；真实云端写只用测试身份且 finally 清理（本轮未做真实写）。

## 九·补三、名单快捷预设 + 徽章去重（2026-11-11，task-7 需求 8/2）

- `components/roster-picker` 新增「全班 / 班委 / 团员 / 清空」快捷预设（抽签、分组、点名三处名单选择器共用）：
  点击先套基础集合（全班 = 全班成员；班委 = `role|badge` 非空；团员 = `class_league` 缓存 ∩ 班级名单），
  **之后仍可逐个点气泡增删**；confirm 仍返回座号升序数组（`{ seats:[...] }`），数据格式不变。
- `pages/vote` 发起投票「可见范围 → 指定成员」同样增加这四个快捷预设（写入 `form.audSeats` 座号数组，不存学号）。
- 团员名单数据源：`rpc/class_league`（网页侧 2026-11-11 已应用；返回 `{ok,seats:[{seat,name}]}`，无学号），
  小程序 `utils/cloud.js leaguePull()` 归一后缓存 `store.classLeague`（6h TTL，离线用缓存，失败静默）。
- 徽章去重（需求 2）：`utils/util.js showBadge(badge, role)` —— 职务文字已展示时不再重复输出同义「班委」badge 气泡
  （`role` 为空时仍保留徽章；「管理员」等非同义徽章保留）；班委名单页/我的/数据与隐私页统一使用；
  班委工具描述同步为「职务 · 名单」；班委页副标题不再写「身份徽章」。

## 九·补四、首屏加载与缓存提速（2026-11-11，task-7 需求 9）

在既有 1.4.4/1.4.5 缓存体系（分块持久缓存 / 签名校验 / TTL / 单飞）之上补齐：

1. **有缓存首帧直接渲染**：`pages/index` 新增 `_hasLocalData()`、`pages/hw` 新增 `_hasLocalHw()`；
   有本机缓存时 `onShow` **不再先出 120ms/140ms 骨架**，直接同步 `refresh()`（无缓存时保持原骨架逻辑）。
2. **启动请求去重**：`cloud.marksFresh(ms)` 记录最近一次 marks 拉取时间；`app.warmSync` 在页面 onShow
   刚强拉过（5s 内）时不再重复强拉 → 冷启动 marks 请求 2 → 1。
3. **只 setData 变化字段**：`utils/util.js diffPatch(prev, next)`（浅比较 + 对象 JSON 比较）；
   工作台 `refresh()` 用它下发补丁（状态未变化时 0 次 setData）→ 页面重入 setData 6 次/3111B → 5 次/522B。
4. 既有保障不变：`marksPull` 单飞、TTL 内 0 请求、通知 ~2KB 签名校验变了才整表拉、`cloudOff` 仅本机、
   页面 onShow 仍按要求强拉 marks（sync_contract 需求 16 契约不变）。

**实测（本机，真实数字与测量方法见 `mp-class-tools-tests/cache_speed_bench.js` + `task7_preview.js`）**：
- Node 基准（同一冷启动剧本跑「改造前」`_baseline_cache_20261111` 快照 vs 改造后源码，mock 网络）：
  - 首次启动请求 **13 → 12**（marks 2→1）；
  - 二次冷启动（保留 storage）请求 **2 → 1**（marks 2→1），首屏计算耗时 **11.4ms → 0.3ms**；
  - 页面重入 setData **6 次/3111B → 5 次/522B（-83%）**。
- devtools automator（`task7_preview.js` A 组，mock 网络）：有缓存时 `wx.reLaunch` → 工作台 `state=data` **217–284ms**、
  期间请求 0–1（marks）、无 loading 骨架；无缓存对照仍能正常到 data（不白屏）。

## 九·补五、文件传输 · 临时云空间（2026-11-12，与网页同步；源码就绪，待用户上传发布）

> 与网页 `tools/index.html` 的「文件传输 = 临时云空间」同一后端：ECS drop 服务 v2.2（契约 `web/drop/CONTRACT.md`）。
> VERSION 仍 2.0.0（用户要求「直到下一次成功上传发布」不改）。

- **语义**：同账号（同班级 token）跨设备自动共享同一云空间，**不需要房间码 / 链接 / 配对**；上传、下载、单文件删除、清空空间；文件自上传完成起保留 **72 小时**，任意大小（8MiB 分片）。
- **页面**：`pages/cloudspace/cloudspace`（临时云空间：文件数/占用/保留规则、上传进度、文件列表、下载/删除/清空）。
- **入口**：`utils/tools.js` 新增 `{ key: 'file', name: '文件传输', icoImg: '/images/tool-file.png', url: '/pages/cloudspace/cloudspace' }`，在「全部工具」里，可勾选进首页（homeTools ≤4 契约不变）。
- **上传**：`wx.chooseMessageFile`（从微信聊天选文件）→ `POST /drop/upload/init` → 逐片 `FileSystemManager.readFile(position/length)` 读 ArrayBuffer → `POST /drop/upload/chunk`（原始字节，8MiB）→ `POST /drop/upload/finish`；大文件不整文件读入内存。
- **下载**：`wx.downloadFile`（签名 URL）→ `wx.openDocument`；失败回退 `wx.shareFileMessage`（发回聊天）；图片走 `wx.previewImage`。
- **删除/清空**：`DELETE /drop/file/<fileId>?sessionId=…`（v2.2 新增，仅本账号会话 owner；幂等）；清空= `POST /drop/close` 后自动重开新空间。
- **认证**：请求头 `X-Device-Id` = 班级身份 token（与网页同口径；drop 服务只认这个头）。
- **域名（发布必做）**：
  - **开发版**：默认直连 ECS `http://121.196.47.2/drop`（仅开发者工具，勾「不校验合法域名」）；
  - **体验版 / 正式版**：都强制 HTTPS + 微信后台合法域名，默认 `https://tool.furina.fun/drop`；不能用 IP/http；
    发布前把 `https://tool.furina.fun` 同时加入微信后台 **request 合法域名** 与 **downloadFile 合法域名**（需 DNS 恢复 + HTTPS 启用后）；
  - 临时换域名：在 `utils/cloud-config.js` 设置 `dropBase` 为该域名的 HTTPS drop 地址，并把该域名同时加入 request/downloadFile。
  - **2026-11-14 撤销临时域名**：用户决定等 `tool.furina.fun` 备案完成，`dropBase` 已改回 `''`（开发版默认直连 ECS `http://121.196.47.2/drop`，勾「不校验合法域名」）；ko-link.cn 不再使用。体验版/正式版待 furina DNS+HTTPS 恢复、微信后台加合法域名后再配置。
  

- **测试**：`mp-class-tools-tests/cloudspace_unit_tests.js`（24 项：分片规划/大小/剩余时间/事件合并/文件视图/请求契约/基址环境/工程接线/无房间码 UI），已挂入 `unit.js`；`node unit.js` **461 passed / 0 failed**、`staticcheck.py` 通过、`code_quality_check.js` 全规则通过。
- **待用户操作**：在微信开发者工具重新打开项目 → 编译 → 上传（我们已修复开发者工具代理 18081 问题）；上传后用测试身份在真机验上传/下载/删除。

## 九·补六、大屏互联（presence 门控）+ 文件云空间「打开」+ 域名停用期使用说明（2026-11-12）

> 与网页同步：drop v2.3 `/presence`（大屏在线 30s 心跳）；无大屏时不显示入口；有设备开大屏时小程序可用「大屏互联」。

- **presence**：网页大屏每 10s `POST /drop/presence {stage:true}`，关闭 `{stage:false}`；小程序 `utils/screencast.js` 的 `presence()` 查 `GET /presence`。
- **入口**：`pages/all` 在 onShow 检查 presence，**只有 stage=true** 时在「全部工具」里动态显示「🛰 大屏互联」卡片；不在线不显示、不请求其它接口。
- **页面**：`pages/screencast`（4 文件）——状态/发文字/传文件（`wx.chooseMessageFile` + 8MiB 分片）/遥控 11 项（聚焦 4、退出聚焦、计时开始/暂停/重置、抽签、恢复全屏、关闭大屏）；复用 `utils/cloudspace.js` 的 drop 请求与基址。
- **测试**：`mp-class-tools-tests/screencast_unit_tests.js`（16 项：指令/协议/页面接线/动态显示/打开按钮）挂入 `unit.js`；`node unit.js 478/0`、`staticcheck.py` 通过、`code_quality_check.js` 全规则通过。
- **文件云空间**：下载后按钮变「打开」（`zq_mp_file_opened_v1` 本机标记），与网页一致；再点重新 `wx.downloadFile` 后打开。
- **域名停用期间（tool.furina.fun DNS 暂停）怎么正常用**：
  1. **大多数功能不需要它**：身份/课表/作业/通知/投票/名单/水量/诊断/PPT 列表走 CloudBase HTTPS 网关（`restBase`），DNS 暂停不影响；
  2. **受影响**：文件云空间、大屏互联（drop 服务）、部分静态加速下载；开发/体验版默认直连 ECS `http://121.196.47.2/drop`，开发者工具勾「不校验合法域名」即可测试；
  3. **正式版**必须 `https://tool.furina.fun/drop`（request + downloadFile 合法域名），所以要么恢复 DNS/HTTPS（`web_pause.py --off` + `ecs_site.py apply --https`），要么临时换一个已备案域名 CNAME 到 ECS 并在微信后台配置；
  4. 正式版不能走 IP/http；DNS 暂停期间可先用体验版（仅你/管理员）验证文件与互联。

## 九·补七、网页最近修复同步到小程序（2026-11-12 晚）

> 同步网页 2026-11-12 两批修复中**适用于小程序**的部分；大屏拖动/接收模块/预设布局等属于网页大屏（小程序无该页面），不在此列。

- **电费「充值后趋势不明显」**：`utils/power.js trendLine` 与网页同口径——检测区间内充值跳变（Δq>0.5）后，绘图值改为**扣除累计充值后的折算剩余**（连续下降），`q` 仍保留真实剩余供游标/详情；页面绘出充值竖虚线（canvas 有 try 保护，旧基础库/测试 ctx 不崩），徽标文案「期间有充值（已折算）」；`hi/mid/lo` 按折算范围。
- **文件列表「上传后看不到」**：小程序 `utils/cloudspace.js applyEvents` 本来就兼容 `/state` 的 `fileId` 字段（网页是 `p.id` 才出 P0）；新增单测 `A5b` 锁定「只给 fileId 也能进列表」，防回归。
- **文件云空间「下载后变打开」**：`pages/cloudspace` 下载成功后记 `zq_mp_file_opened_v1`，按钮变「打开」（再点重新下载后打开），与网页一致。
- **PPT 统一「打开文件」**：`pages/pptdl` 文件行按钮由「下载」改为「打开文件」（下载后 `wx.openDocument`，系统/Office/WPS 打开），不再强调直接放映；旧 deck 的「在线预览」保留为次要入口。
- **画布测量兜底**（随电费改动一并修复）：`_renderWhenReady` 在 selectorQuery 回调丢失时 1.2s 兜底渲染、测量完成后补渲染暂存请求（切换区间不再停在旧数据）。
- 测试：`node unit.js` **488/0**（新增电费充值折算、fileId-only 事件、云空间打开标记等用例）；`staticcheck.py` 通过（handlers missing []、share missing []）；`code_quality_check.js` 全部规则通过。
- 发布：VERSION 仍 2.0.0，需重新上传/设为体验版后生效；文件云空间/大屏互联仍需 HTTPS 域名白名单（见 §九·补六）。


## 九·补八、小程序备案号展示（2026-11-12 晚）

- 备案号：**闽ICP备2026042939号**（用户提供，唯一来源 `utils/compliance.js` 的 `ICP_BEIAN`）。
- 位置：`pages/me`「我的」页底部、版本号上方；`pages/me/me.js` 提供 `copyIcp`，点击复制备案号（微信不允许小程序直接打开工信部外链）。
- 样式：`.icp-note` 最小高度 40px、可换行，不挤压「退出身份」按钮。
- 测试：`v2_unit_tests.js` 合规静态扫描新增断言（号码唯一来源 + 我的页绑定 + 复制处理）；`node unit.js` **488/0**、`staticcheck.py` 通过、`code_quality_check.js` 全部规则通过。
- 发布：版本仍 2.0.0，需重新上传体验版/正式版后可见；与文件云空间域名配置互不影响。


## v13 / Monet 与通知（2026-11-04 18:35）

- 视觉：`app.wxss` M3 token 和 `theme.json` 改为莫奈色（奶油底、睡莲青、雾蓝、暖沙、灰粉）；页面/组件旧品牌色同步替换。
- 通知：`pages/nt/*` 重写为云端自动通知，读取 `public.notices` 中 `id like 'auto_%'` 且 `body` 前缀 `[[CLASS_NOTICE_V1]]` 的行。
  - 顶部班级简报：待处理 / 24h / 7 天 / 已过期
  - 状态与分类筛选
  - AI 摘要/要点/字段拆分
  - 附件：图片预览、PDF 打开
  - 原始消息弹层
  - 旧「发布通知 / 置顶 / 重要 / 手动通知」组件已移除
- `utils/cloud.js` 新增 `ntAutoPull()`；`ntPull()` 自动排除 auto 行。
- 验证：`node unit.js` 49 passed；`python staticcheck.py` handlers missing 0；`cli preview` 编译成功（TOTAL 264.4KB）。

## 通知人群可见性（服务端）

`public.notices.audience` 由 RLS 按登录身份过滤，客户端不需要额外过滤：

- `all`：已认证全班
- `committee`：班委（`class_ids.role` 非空或 badge 含班委）
- `sid:3260707024`：仅陈子麒（红会群）
- `admin`：管理员（保留）

自动采集映射在 `C:\briefdesk\scripts\sync_notices_cloud.py`；小程序 `ntAutoPull()` 只收到服务端允许的行。

## 通知时间字段
- 服务端通知增加 eventAt / expireAt / timeLabel；**1.4.4 起口径与网页端一致**：真实截止 `deadline`（含 `extensions` 最后一次延期）优先并用于状态文案；`expireAt` 只是「何时不再显示为进行中」的自动归档兜底，**不再当截止时间显示**；无截止时按 `eventAt`（结束/归档用 `archiveAt || eventAt`）判断；两者都没有 = 「无时间」（只作知悉，不算过期）；`alert:true`（有新名单）即使已过截止也不算过期。
- 状态文案：`已截止 · 自动完成` / `已延长 · 已截止` / `已结束 · 自动归档` / `剩 N 分钟` / `今天 HH:MM 截止` / `N 天后截止` / `MM-DD HH:MM 截止` / `无时间`；工作台与通知页共用 `utils/notice.js`，避免两处计数不一致。

## 通知详情（2026-11-04，1.4.4 重做）
- **默认展开**：未过期通知默认展开、已过期默认收起；「已过期」区块默认折叠（显示组数，点开才渲染卡片）。卡片底部「收起/展开」随时切换，本页会话内记住状态。
- **详情内容**：AI 摘要 + 要点；字段拆分（时间/地点/对象/内容/报名/截止/要求/联系方式/补充）；文件卡（PDF/XLS/DOC/PPT 图标 + 文件名 + 大小/说明 + 预览/下载）；图片 2 列网格（base64 一次性转本地临时文件后渲染，点击全屏预览）；收集表 / 链接 / 小程序 / 公众号行（打开=复制链接，符合小程序平台限制）；无 AI 摘要时展示 2 行原文摘录。
- **原始消息**：底部弹层显示来源 + 每段「原始消息/补充通知 + [职位] 发送者 + 时间 + 全文」。
- **标记已处理**：未过期卡片可切换，状态变「已处理」并置灰；1.4.6 起**持久化且跨端同步**（`marks kind='ntdone'`，网页端同样生效）；「全部」筛选可看到已处理卡片。
- **简报 / 筛选**：待处理 / 24h 截止 / 7 天内 / 已过期四格 + 最近 3 条待处理（点击跳转并展开）+ 刷新；筛选 = 全部 / 待处理 / 已截止 + 分类（全部分类 / 教务 / 活动 / 班级事务 / 缴费）。

## 通知发布者与 OCR 标记（1.4.2 / 1.4.3，2026-11-04）

- **发布者行**：CloudBase 自动通知组新增 `senderName` / `senderRole` / `senderBadge`；`pages/nt/nt.js` 的 `mapGroup()` 直接映射（均 trim，缺省空串）并计算 `pubBadge = senderRole || senderBadge`，`applyFilter()` 透传后由 `pages/nt/nt.wxml` 渲染：
  - 班委发布 → `[班长] 陈玉霞`（**气泡直接显示职务，1.4.3 起不再用「班委」统称、也不再带「· 职务」尾巴**）；`senderRole` 为空但 `senderBadge=班委` 的旧数据退回 `[班委] 姓名`；
  - 非班委 → 只显示姓名；`senderName` 为空 → 整行不渲染。
- **原始消息弹层**：`openRaw()` 为 text / follow 块补充发送者 `fromName` 与 `fromBadge = fromRole || fromBadge`（兼容旧字段 `from`），弹层每块头部显示「原始消息 / 补充通知 + [职位] 发送者姓名」。
- **OCR 图片通知**：通知组带 `ocr: true` → 卡片状态旁显示小「OCR」标记（`isOcr`）；`items[]` 的 `kind:"img"` 仍是图片（展开后才加载、点击全屏预览），`kind:"text"` 的识别文字照旧进「原始消息」弹层。无 `ocr` 字段 = 普通通知，老数据零迁移。
- **只读契约**：字段由服务端在 `[[CLASS_NOTICE_V1]]` JSON 里下发，小程序不推断；不改云端 schema / 不调用写接口。
- **样式**：`.nt-sub` / `.nt-role` / `.nt-who` / `.nt-raw-hd` / `.nt-ocr` 全部取 `--md-*` 变量（职务气泡 + 中性描边 OCR 标记），浅色 / 暗色跟随系统。
- **回归**：`node unit.js` 61/61（含 pubBadge 规则 / wxml 渲染条件 / 原始消息发送者映射断言）；`node nt_badge_preview.js light`（开发者工具 automator，真实云端数据）**22/22 PASS、0 console error**——12 张卡片中 9 张职位气泡（DOM 文字 `劳动委员/学习委员/班长/生活委员…`，无「班委」）、4 张 OCR 通知、原始消息发送者气泡 = 学习委员，截图 `mp-class-tools-tests/_shots/nt-badge/nt-light.png`（职位气泡 + OCR 卡）与 `nt-light-raw.png`（原始消息发送者）。深色截图需在模拟器底部手动切主题，本次未做（颜色全部走 `--md-*` token，静态可验）。

## 通知页完整对齐网页端（1.4.4，2026-11-04）

- **对照对象**：网页端通知页 `briefdesk-plan/build_notice_board.py`（页面结构、默认展开规则、状态口径、卡片/时间线、原始消息弹层、已处理与已过期区块）。
- **功能清单**：简报四统计 + 最近 3 条待处理；筛选「全部 / 待处理 / 已截止」+ 分类；卡片分类徽章 / OCR / 状态 / 原始消息 / 来源 / 职位气泡；AI 摘要 + 要点；6 项字段拆分；文件卡（预览/下载）；图片网格（预览）；收集表（报名中/已截止 + 打开）；链接 / 小程序 / 公众号（复制链接）；原文摘录；标记已处理；已过期折叠区；刷新 / 下拉刷新。
- **移动端取舍**：字段拆分改**单列**「标签 + 文本」（网页端在窄屏也是单列）；图片/附件文案一行内截断、点击进详情；去掉了页面内重复大标题（原生导航栏已有）；所有可点区域 ≥ 52rpx。
- **平台限制**：小程序不能 `web-view` 打开外部网页（项目硬约束 0 处 web-view），因此收集表/链接/小程序/公众号的「打开」= 复制链接并用 toast 提示；文件用 `wx.openDocument` 原生预览 + 菜单保存/转发；公众号文章无法在小程序内直接阅读（可复制链接到微信打开）。
- **数据**：只读云端 `[[CLASS_NOTICE_V1]]` JSON（`items[]` 的 file/img/form/link/mini/article/text/follow/merged），不改 schema、不写云表；`data.autoList` 保留为当前列表兼容别名。
- **回归**：`node nt_preview.js`（新增）19/19 PASS、0 console error——默认展开 12/12、过期收起 12/12、5 张文件卡、6 张图卡、表单/链接/小程序/公众号行、图片落地、收起/展开、标记已处理计数、原始消息、已截止筛选与区块展开；`node nt_badge_preview.js light` 22/22 PASS（气泡/OCR 兼容）；`node unit.js` 61/61；`node ia_preview.js` 30/30；`python staticcheck.py` 17 页 handlers 0 缺失；`cli.bat preview` 编译通过 558.8 KB。截图 `mp-class-tools-tests/_shots/nt/`（01-top / 02-raw-sheet / 03-expired-filter / 04-file-card / 05-form-row），桌面交付图 `小程序通知页_网页功能复刻_20261104.png`。

## 暗色模式（1.3.1，2026-11-04）

- **开关**：`app.json` 已开 `"darkmode": true` + `themeLocation: theme.json`；系统切深色即自动生效，无需 App 内开关。
- **颜色体系**：`app.wxss` 的 M3 token 在 `@media (prefers-color-scheme: dark)` 下整套替换；页面/组件一律用 `var(--md-*)`，**不要再写死 hex**。
- **课表页**：`pages/tt/tt.wxss` 顶部有一段 `--tt-*` 页面级变量（浅色 = 原配色，暗色 = 深色值）；课程色板在文件末尾 `.tt-c0~.tt-c15`（各含浅/暗两套），JS 仅通过 `colorOf()` 返回索引，**新增课程颜色请改 wxss 而不是 js**。
- **TabBar 图标**：`theme.json` 的 `tabWorkIcon/tabToolsIcon/tabMeIcon*` 变量分别指向 `images/tab-*-dark.png` 与浅色版；新增 tab 时按同样方式在 theme.json 两套里登记图标变量。
- **原生控件**：`<slider>/<switch>` 的颜色属性不能吃 CSS 变量，统一用 `util.nativeTheme()` 返回的 `th.primary / th.track` 绑定，并在 `wx.onThemeChange` 里更新。
- **占位符**：input/textarea 用 `placeholder-class="ph"`；`.ph` 只在暗色媒体查询里设色（浅色保留系统默认）。
- **不要**把导出图片（`utils/canvas.js`）改成暗色：导出图是给人/群看的分享图，固定浅色。
- 回归方式：开发者工具「模拟器底部手机图标 → 浅色/深色」切主题后逐页截图；`node unit.js` + `python staticcheck.py` 保持全绿。

## 信息架构（1.3.2，2026-11-04）

三个 tab 各司其职，不再互相复制：

| Tab | 只放什么 | 不再放什么 |
| --- | --- | --- |
| 工作台 `pages/index` | 问候（无头像）；今日课程（含进行中 / 已结束 / 下次课）；作业待交、通知待处理两张待办卡；4 个常用工具快捷 +「全部」 | 数据概览、云同步、数据与隐私、清空记录、完整工具长列表、页内大标题（原生导航栏已是唯一标题） |
| 工具 `pages/all` | 「首页快捷」4 个 +「全部工具」2 列目录；右上「调整」打开底部弹层用 ↑/↓ 调顺序（前 4 个带「首页」） | 旧长条卡片与拖动排序；反馈建议 / 使用说明（归「我的」） |
| 我的 `pages/me` | 身份卡；「我的数据」四项个人指标（待交作业 / 已完成作业 / 抽签记录 / 体测记录）；云同步；数据与隐私 + 清空数据；反馈建议 / 使用说明；退出身份 | 旧 6 项全站统计；重复的长隐私说明 |

- 首页快捷 = `homeTools` 前 4 个（`tools.quickList(4)`）；`homeTools` 仍是完整顺序，旧版数据无需迁移。
- 今日课程 / 下一次课在 `utils/ttplan.js`；通知待处理与最紧一条在 `utils/notice.js`（与 `pages/nt` 共用同一套截止口径）。
- 本机无课表缓存时，工作台会自动请求一次课表（2026-11-07 起 CloudBase `site_assets` 优先、失败回退
  legacy `tt.json`）并写入 `store.ttCache`；通知组缓存 60s，切 tab 回来先显示缓存再后台刷新。
- 1.3.3 起：页面不显示头像，也不显示学号（此前的打码展示已移除）；身份卡只留姓名 + 角色 / 徽章 pill，班委 / 统计同理。学号仍用于云端身份校验与数据归属，不进入页面。
- 回归：`node ia_preview.js`（开发者工具 automator）覆盖三页截图 + 30 项断言（含首页快捷、今日课程、待办数量、工具目录、排序弹层、我的四项指标、无横向溢出、无 console error）。

## 名单选择与名单气泡（1.4.1 → 1.4.2，2026-11-04）

用户要求：各处的名单输入改为**不支持自定义名单**，点名单选择按钮后弹出班级名单，选择班级中的人或一键全选，名字用**气泡**显示（1.4.2 起按用户反馈简化为 M3 简约 chip，贴合整站克制风格）。

### 1. 三处入口

| 页面 | 入口 | 交互 |
| --- | --- | --- |
| 抽签 `pages/draw` | 参数卡片「参与名单」行 +「选择名单」 | 已选摘要气泡（最多 8 个 +「+N」）+ 提示「已选 N 人 · 只从名单中抽」/「未选择 · 只抽序号」；原「编辑名单」底部弹层（textarea / 粘贴 / 清空 / 导入班级名单）已删除 |
| 分组 `pages/group` | 成员来源 chip「班级名单」+「选择名单」 | 原「粘贴名单」textarea 已删除；未选名单点「开始分组」→ toast「请先选择名单」；成员按座号升序 |
| 点名 `pages/roll` | 「选择名单」+「沿用抽签名单」+「重置本轮」 | 原「导入班级名单 / 用抽签页名单 / 编辑名单」与编辑弹层已删除；沿用抽签名单为空 → toast「抽签页还没有选择名单」 |

### 2. 选择器组件 `components/roster-picker`

- 复用 `bottom-sheet`；`show` / `title` / `selected` 由页面传入；内部从 `store.classMembers` 读名单（缺失时调 `cloud.classMembersPull()` 重拉，失败给「重新加载」）。
- 头部「标题 + 已选 N / 70」；主体 scroll-view 气泡网格（max-height 55vh、3 列、70 个气泡、可点区 ≥72rpx）；底部「全选 / 清空」+「取消 / 确定」。
- 点气泡逐个切换；初始选择 = 传入 selected；确定 `triggerEvent('confirm', {seats})`，取消 / 点遮罩 `triggerEvent('close')`。
- 视觉（`app.wxss` 共享 `.lp-bubble` / `.lp-chip`，组件 `styleIsolation: 'apply-shared'`；**1.4.2 起为 M3 简约 selected chip**）：胶囊形；未选 = `surface-container-lowest` 底 + `outline-variant` 1rpx 边 + `on-surface` 字（28rpx / 600）；已选 = `primary-container` 底 + `primary` 边 + `on-primary-container` 字；座号 20rpx、opacity .55、与名字间隔 8rpx。**无**渐变背景 / `::after` 玻璃高光 / `lpFloat` 浮动 / `lpPop` 弹跳 / 重阴影；按压只保留 `hover-class` 的 `scale(.97)` + 120ms transition。页面摘要 `.lp-chip` 为同款选中样式的小号版（24rpx、padding 8rpx 18rpx），`+N` 为虚线幽灵 chip。纯 WXSS/WXML，无图片 / 第三方库 / web-view。

### 3. 数据与迁移

- `utils/store.js`：新增 `rosterSel` / `group.sel` / `rollSel`（座号数组，mkD 归一为去重、升序、正整数）与 `selVer` 迁移标记；`group` 仍深合并。
- `utils/roster.js`（新）：
  - `members()` 清洗 classMembers（正整数座号 + 非空姓名，升序去重）；
  - `selOf(mode)` / `setSel(mode, seats)` / `rollSet(seats)` / `textOf` / `namesTextOf` / `summary` / `poolFilter`；
  - `setSel` 同时写派生文本：draw → `store.roster`（「座号 姓名」多行，`util.rosterMap` 解析）；group → `store.group.names`（仅姓名）；roll → `store.rollNames`（「座号 姓名」，点名 renders 的 parseNames 会去掉座号），并重排 `rollSt`；
  - `migrate()`：旧自定义名单文本 → 座号（逐行取姓名与 classMembers **精确匹配**，匹配不到丢弃）；点名旧 `rollSt` 以「旧下标 → 姓名 → 新下标」保留同一个人 到/假；成功置 `selVer = 1` 不再重跑；`classMembers` 为空时返回 false，`cloud.saveMembers()` 成功后与各页 load / onShow 自动重试。
- `utils/cloud.js`：`saveMembers()` 成功后触发 `roster.migrate()`（名单到位即补迁移）。`classRoster` 字段保留但页面不再使用。
- 抽签语义：未选名单 = 只抽序号；选了名单 → 抽签池 = 名单 ∩ 范围 − 排除，结果必带姓名（姓名取派生名单文本，与网页端 `nameOf` 同源）；导出参数「参与名单（N 人）」；只选 3 人时池 = 3，抽 10 个会提示「名单内可用人数 3 个…（可打开「允许重复」）」。
- 分组：`source` 新值 `'pick'`（兼容旧 `'paste'`，load 归一）；成员 = 已选座号按升序的 `{n: 座号, nm: 姓名}`；派生 `group.names` 仅姓名文本。
- 点名：渲染仍用派生 `rollNames`；`data.namesCount = rollSel.length`；名单变化经 `roster.rollSet` 重排状态。

### 4. 验证

- `node unit.js` **61/61 PASS**（1.4.1 新增 8 项名单断言 + 1.4.2 通知 2 项；本次视觉简化与姓名口径修正未改动断言）。
- `python staticcheck.py`：18 页 handlers missing 0、分享 handler / 封面 0 缺失、无 MISSING / COMPONENT MISSING。
- `cli.bat preview` 编译成功：**TOTAL 527.7 KB（540336 B）**（1.4.1 为 542237 B；简化后删掉渐变 / 高光 / 浮动 / 弹跳样式与动画参数，包体略降）。
- `node roster_preview.js`（automator + 真实班级身份 class_verify，只读）：**22/22 PASS、0 console error**；`node roster_verify.js`（独立验收脚本）：**58/58 PASS、0 console error**（补齐 1.4.1 遗留的 4 项动态：分组 5 人、点名沿用 + 改选状态保留、取消不写回、0 console error）。截图：`mp-class-tools-tests/_shots/roster/`（实现者）与 `_shots/roster_verify/`（独立验收）。
- 姓名口径（1.4.2 修正）：抽签 / 分组姓名只取派生名单文本（与网页端 `nameOf` 同源）——未选参与名单 = 只抽序号，结果不显示姓名；选了名单才带姓名。


# README 追加章节（AI 适配）

## 微信 AI 开发模式适配（v21 / 1.5.0，2026-11-05）

> 微信「小程序 AI 开发模式」（用户侧即「微信 AI / 小微操作小程序」）当前为**内测 beta**：
> 需在「微信公众平台 → 基础功能 → AI 能力」选择「开发模式」申请开通；官方明确
> **暂未开放该模式的代码提审**，因此本适配**不要作为正式版本提交审核**，正式发版前可用
> `mp-class-tools-tests/ai_toggle.py --off` 临时移除配置（源码保留）。
> 若只想要平台自动读取小程序（自动模式），在同一入口选择「自动模式」即可，无需本适配。

**一句话**：把小程序 18 个页面的业务能力封装成 **8 个 SKILL / 60 个原子接口 / 19 张原子卡片**，
配置全局提示词（`agent/AGENTS.md`）、页面元数据（`agent/page-meta.json`）和 18 页页面接力（handoff），
让微信 AI 能读懂并操作班级工具站；AI 运行时与小程序共享登录身份，数据读写走同一套 CloudBase 接口与 RLS。

### 1. 目录与配置

```
ai/                         独立分包（app.json subPackages root=ai, independent:true, pages:[]）
  common/                   共享层：config / auth / rest / local / marks / result / fmt / handoff
  skills/<skill>/           SKILL.md + mcp.json + index.js + apis/* + components/* (+ lib/*)
agent/AGENTS.md             全局提示词（instruction，≤10000B）
agent/page-meta.json        18 页页面元数据（pageMetadata，≤8000B）
utils/agent.js              主包页面接力读取工具（页面 onLoad 调用）
app.json                    lazyCodeLoading + subPackages + agent{skills,instruction,pageMetadata}
project.config.json         packOptions.ignore：--off 时排除 ai/、agent/（发版默认，ai_toggle.py 维护）
```

`app.json` 里的 `agent.skills` 共 8 项：`classIdentity / homework / notice / timetable / lottery / fitness / rollCall / myAccount`。

### 2. SKILL 与接口清单（60 个）

| SKILL | 接口数 | 覆盖能力 | 卡片 |
| --- | --- | --- | --- |
| classIdentity | 8 | 身份验证、我的资料/数据概览、班级名单、班委、工具目录、使用说明、工作台总览 | 5 |
| homework | 6 | 作业列表/详情/摘要/完成标记/发布/删除 | 1 |
| notice | 5 | 通知简报/列表/详情/已处理/置顶 | 3 |
| timetable | 6 | 周次/整周/今天/下一节/课程详情/开学日期 | 1 |
| lottery | 10 | 抽签/补抽/剔除/重置/分组/结果单 | 2 |
| fitness | 7 | 体测评分/国标表/历史记录/保存/重命名/删除 | 2 |
| rollCall | 7 | 点名名单/到·假/批量/重置/统计/沿用抽签名单 | 1 |
| myAccount | 11 | 同步状态/立即同步/数据概览/导出/清除云端/清除本机/反馈/访问统计 | 4 |

明细见 `mp-class-tools-tests/ai-eval-cases.json`（92 条真实用户 query 覆盖 60/60 接口）与
`_ai_task/qa/ai_contract_result.json`。

### 3. 页面接力（handoff）与页面元数据

- 原子接口返回 `handoff`，用户点卡片进入对应页面；主包 `app.js` 用 `wx.onAgentHandoff` 按 `pageId` 暂存，
  页面 `onLoad` 用 `utils/agent.pick(this)` 取一次并先渲染、再后台强制刷新（无阻塞弹窗/白屏）。
- query 约定：`hw?tab&id`、`nt?gid&filter`、`tt?wk&day`、`draw/group/sum?step`、`ft?recordId`、
  `fttable?sex&grade&item`、`roll`、`committee?roleOnly`、`stats?days`、`fb?tab=mine`、`index/all/me/data/ug/identity`。
- 18 个页面全部登记 `pageMetadata`（未命中原子接口时，AI 可用「账号卡片/服务直达」引导进页面）。

### 4. 数据、隐私与安全

- **身份**：AI 运行时读取小程序 storage `zq_class_identity`（同一登录身份）；未认证时所有数据接口返回
  `identity-required` 并 handoff 到身份页；`classIdentity` 技能里的 `verifyClassIdentity` 是唯一无需身份的入口。
- **请求**：原子接口用 `wx.request` 调同一 CloudBase PostgREST（`Authorization: Bearer <publishableKey>` +
  `X-Class-Token`），RLS 校验不变；无身份时不发任何数据请求。
- **不展示**：学号、手机号、token、设备号、完整名单原文；附件/图片只给名称/大小/数量，data URI 不进入模型上下文。
- **确认**：发布/删除/重置/清除等破坏性操作必须 `confirmed:true` 才执行（未确认返回 need-confirm，不写盘）。
- **零新增依赖**：无 npm / 构建链 / CDN / web-view；`ai/` 是独立分包，普通页面不加载。

### 5. 测试与验证

```powershell
cd C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools-tests
node ai_contract_test.js      # 静态契约 99 项
node ai_unit_all.js           # 8 个技能原子接口单测（296 项，mock wx）
node ai_eval_check.js --strict # 评测用例覆盖度（92 条 / 60 接口 100%）
node ai_handoff_check.js      # 页面接力回归（automator；不可用时自动退化静态断言）
```

现状：契约 99/99 PASS；技能单测 8/8 文件全绿（identity 31 / account 41 / homework 33 / notice 32 /
timetable 39 / roll 43 / lottery 50 / fitness 27）；评测用例 92 条覆盖 60/60 接口（复杂用例 32.6%，
negative 10 条，unregistered 4 条）；`cli.bat auto-preview` 编译通过（TOTAL 993,304 B；main 637,645 B；
`/ai/` 355,659 B）；既有回归 `unit.js 104 / sync_contract 26 / staticcheck 18 页` 保持通过。

### 6. 开通体验与发版

1. 「微信公众平台 → 基础功能 → AI 能力」选择**开发模式**申请（内测白名单；自动模式可同时开启）。
2. 微信开发者工具（2.02.2608080+）→ 编译模式切「小程序 AI 编译」→ 基础库 3.16.2+；
   真机：iOS 微信 8.0.74+ / 安卓 8.0.78+。
3. 用真实班级账号走一遍：身份验证 → 工作台 → 作业/通知/课表/抽签等，确认卡片与接力页。
4. 正式发版前：`python mp-class-tools-tests\ai_toggle.py --off` 移除 AI 配置（并把 `ai/`、`agent/` 写入
   `project.config.json` 的 `packOptions.ignore` 排除出编译包，代码质量扫描不再报「无使用组件」）；
   发版后 `--on` 完整恢复。

> 当前限制（实测）：本机 appid `wx3df9869d229b96c4` **尚未开通 AI 开发模式内测权限**，
> 开发者工具 `cli agent tool` 返回 `agent compile mode is disabled`（`checkAgentCompileEnable` 未通过 appid 白名单），
> 因此原子接口的真机/运行时验证需先申请权限；本次以静态契约 + Node 单测 + 编译验证为准。

### 7. 维护注意（两处同改清单）

AI 原子接口运行在独立 JS 环境，**不能 require 主包 utils/**，以下为同步副本，改主包时请同步修改：

| AI 侧副本 | 主包来源 |
| --- | --- |
| `ai/common/config.js` | `utils/cloud-config.js` |
| `ai/common/fmt.js` | `utils/util.js` + `utils/notice.js` |
| `ai/skills/identity/lib/tools.js` | `utils/tools.js` |
| `ai/skills/identity/lib/ttplan.js` | `utils/ttplan.js` |
| `ai/skills/fitness/lib/fit.js` | `utils/fit.js` |

### 8. 本次验证摘要（2026-11-05）

- 静态契约 **99/99**；8 技能原子接口单测 **296 项全绿**；评测用例 **92 条 / 60 接口 100% 覆盖**；
  QA 独立探测 **98/98**、页面接力静态复核 **41/41**；老回归 `unit.js 104 / sync_contract 26 / staticcheck 18 页` 全绿。
- 编译：TOTAL **993,304 B**（main 637,645 B + `/ai/` 355,659 B）。
- **未验证**：本机 appid 未开通 AI 开发模式内测（`agent compile mode is disabled`），运行时/真机需开通后补验。
- 详细验收报告见交付目录 `班级工具_微信AI适配_20261105\验收报告.md` 与 `_ai_task/reports/REPORT.md`。


> **2026-11-09（待上传；代码版本仍 2.0.0）· 诊断 v2.1**：AI 结论改为**下挂到对应异常项下方**（折叠一行：severity 点+标题+状态胶囊+⚙；点击展开原因/建议/flow/关联修复；无关联进「其它诊断」折叠区），进展轮询 15s→**10s**，设备上报/展示信息最小化（无品牌/型号/语言，detail 必带 check id）；WXML 嵌套数组限制用预渲染文本兜底。详见 CHANGELOG 顶部条目。





