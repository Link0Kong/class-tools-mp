# 班级工具站小程序 · 测试与修复工程

## 通知卡片分享 + 投票卡片不预览结果（2026-11-20，未发版；待用户上传发布）

- **通知卡片分享**（`pages/nt`）：每张卡片底栏「分享」→ bottom-sheet 展示 5:4 预览图 +「图片分享」/「微信卡片分享」。
  图片分享走 `wx.showShareImageMenu`（旧基础库降级 `wx.saveImageToPhotosAlbum`）；微信卡片用原生 `button open-type=share`，
  title=`班级通知｜<标题>`、path=`/pages/nt/nt?gid=<id>`、imageUrl=预览图。预览图失败回退 `images/share/nt.png`，
  `sharecard.render()` 2.5s 超时兜底，弹层不会停在「生成中」。
- **通知分享图**（`utils/sharecard.js`）：新增 `buildNoticeView` / `drawNotice`（标题/分类/状态/摘要/≤2 要点/来源/时间；
  不含附件、图片、学号、收件人）；按卡片 signature 缓存。
- **投票分享卡**：`buildVoteView` 不输出 pct/count/total，`drawVote` 不画结果条/百分比/票数，固定提示
  「结果请打开投票页查看」；`votedetail` 页面提示同步改为「分享卡片不显示结果，点开卡片进入投票」。
- **复跑**：`node unit.js`（share_legal_unit B2/B4/B5/D6/D7，**617 passed / 7 failed**，7 项为既有失败）；
  `node nt_share_check.js`（automator，真实测试身份 3260799999，**17/17**，截图 `_shots/nt_share/`）；
  `python staticcheck.py` / `node code_quality_check.js` 通过。**未上传发布，VERSION 仍 2.0.0。**

## 统计排序「访问次数优先」口径（2026-11-18，未发版）

对应契约 `web/统计多端_最新登录_契约_20261118.md`：**访问次数降序 → 最近访问时间降序**；默认今天、分钟时间、登录端、忽略测试账号。
- `unit.js`：统计页夹具新增王五 3 次（含更早今天访问），断言次数优先、同次数按最近访问；`visitLog`/`statsPull` 断言不变。
- `ai_unit_account.js`：`getVisitStats` 断言仍为次数优先（李学盈 2 次居首）、`lastClient`、过滤测试账号。
- 实测 `node unit.js` **588 passed / 7 failed**（7 项为并行会话既有失败：合规域名/ko-link/draw/期次/发布，不属于本次）；`node ai_unit_account.js` **41/0**；`staticcheck.py`/`code_quality_check.js` 通过。

## 访问统计「最新登录」口径（2026-11-18，未发版）

对应契约 `web/统计多端_最新登录_契约_20261118.md`：按最近登录倒序、默认今天、分钟时间、登录端、忽略测试账号。
- `unit.js`：`visitLog` 断言 `client=mp`/`id=sid|slot|mp`；statsPull 断言 `ts,client`；统计页断言默认 today、最近登录排序、`MM/DD HH:mm`、端标签、过滤 `3260799999`/9999 段/匿名。
- `ai_unit_account.js`：`getVisitStats` 断言 `lastClient`、最近登录排序、过滤测试账号、limit 5000；夹具改用 9000 段（不再用 9999 段冒充真实成员）。
- `stats_preview.js`：mock 行补 `client`，打开断言默认 `range=today`。
- 实测 `node unit.js` **597/0**、`node ai_unit_account.js` **41/0**、`staticcheck.py` exit 0、`code_quality_check.js` 退出码 0。

## 移除「新通知提醒」+ 手动提醒以报名开始为基准（2026-11-18，未发版）

- **移除新通知提醒**：删除 `pages/nt` 简报区按钮/状态、`pages/index` 工作台「新通知」角标、`utils/notify.js`
  `subscribeNotice/publishNotice/status/bootstrap`、`app.js` bootstrap、`utils/cloud.js` `newNtAt` 写入、诊断页新通知扫描行；
  云函数 `kind='nt'`/旧 action 保留给旧版客户端。
- **手动提醒基准**：`pages/nt/nt.js` 新增 `remindBaseOf()`——活动有未开始的 `signupStart` → 以报名开始为基准
  （快捷项「报名开始前 1 天 / 2 小时 / 30 分钟 / 报名开始时」、自定义默认提前 2 小时）；报名开始已过/无报名窗口回退截止。
  `notify.subscribeNoticeReminder` 支持 `baseTs`，模板 `dateText` 显示报名开始而不是截止。
- **测试**：`unit.js` **571/7**（7 条均为既有失败：quickList 1 + 需求12 长期时间 1 + draw ko-link 4 + 期次时间依赖 1）；
  新增快捷项/自定义默认/已移除断言；`task7_unit_tests` B5/B7、`task7_preview` B/F 同步更新；
  `staticcheck.py` exit 0、`code_quality_check.js` 退出码 0。
- **本机 automator（测试身份）**：通知页无「新通知提醒」按钮/状态；`signupStart=+3d` 的假活动返回 4 个报名开始基准快捷项；
  `subscribeNoticeReminder` 的 `dateText=报名开始时间`。

## 通知「发布时间」统一（2026-11-18，未发版；待用户上传发布）

对应契约 `web/通知三端_发布时间统一_契约_20261118.md`（用户原话：「将通知中不含时间的时间设定为发布时间，动作设为发布，并参与排序等等统一计算」）。
只改 `mp-class-tools/**` 与 `mp-class-tools-tests/**`；**未上传发布、VERSION 仍 2.0.0、UD v6 不变、无新增网络请求/依赖**。

| 文件 | 覆盖 | 复跑 |
| --- | --- | --- |
| `notice_publish_unit.js`（**新增**，8 项） | 发布§1 `publishedTsOf`（publishedAt 优先 / 坏字段与旧缓存回退 pubTsOf / updatedAt 较晚 / 无时间 null）；§2 `statusOf` published 分支（label「MM-DD HH:MM 发布」/cls active/expired false/动作取 publishAction/未来相对时间/过期·长期·真实锚点优先/none 兜底）；§3 `hasTimeAnchor` 只看真实锚点 + `longtermSubtypeOf` 发布卡移出资料栏；§4 `listRankOf` 档 4 + `mainListCompare`/`mainEntryCompare` 档内发布时间倒序、none 最后；§5 `statOf` 发布卡按 actionable 计入待处理、24h/7 天不进、latest 用 publishedAt、mostUrgent 排除资料兜底；§6 `pages/nt` applyFilter 发布卡进主列表 / 资料栏 0 条 / chip 格式 / 简报计入 / 最新发布倒序；§7 工作台 `ntView` 待办数与轮换计入；§8 静态接线（导出/页面使用/资料栏 infoCount 条件/版本/无新增请求依赖） | `node notice_publish_unit.js`（独立运行写 `notice_publish_result.json`）或 `node unit.js`（末尾已挂载，并入总表） |
| `notice_occ_unit.js`（**改**） | 页面§2.1 夹具：items 时间 → 发布卡（契约 2026-11-18）；待处理 4→5、发布卡进主列表、资料栏 0 条、24h/7 天仍不含发布卡、分类筛选/资料栏折叠断言同步；`cardOf.pubTs` 改走 `publishedTsOf` | `node notice_occ_unit.js` / `node unit.js` |
| `v3_power_diag_tests.js`（**改**） | 「nt 附件 archive 自愈」夹具无锚点有 items 时间 → 发布卡：默认待处理视图即按需补完整 body（不再等「全部」资料栏）、资料栏 0 条、卡在主列表且 chip 以「发布」结尾 | `node v3_power_diag_tests.js` / `node unit.js` |
| `unit.js`（**改**） | 末尾挂载 `notice_publish_unit.js`（总断言 561 → **569**，既有 7 项失败不变） | `node unit.js` |

**实测（本机 2026-11-18）**：`node unit.js` **569 passed / 7 failed**（7 项均为本任务前既有失败：quickList 1 + 需求12 长期时间 1 + draw ko-link 4 + 期次时间依赖 1）、
`node notice_publish_unit.js` **8/0**、`node notice_occ_unit.js` **8/1（既有期次时间依赖）**、`node notice_longterm_unit.js` **13/0**、
`node notice_time_test.js` **20/0**、`node nt_attach_url_tests.js` **10/0**、`node sync_contract_test.js` **34/0**、
`python staticcheck.py` **exit 0（30 页）**、`node code_quality_check.js` **全部规则通过（退出码 0）**。
真实 board 对拍：104 组 `publishedAt` 全量存在；新增字段口径与旧缓存回退口径统计完全一致（pending 23 / urgent 9 / week 14 / expired 77 / longterm 2），
`publishAction` 9 组 + 1 组「仅有 signupStart 且已开始」按 statusOf 同口径显示「发布」，资料栏 0 条。

## 性能专项：通知 14MB→0.30MB + 启动/请求错误率（2026-11-17，未发版；待用户上传发布）

对应微信后台性能报告（打开率 93.85%、启动 1638ms、请求错误率 45.45%）。只改 `mp-class-tools/**`
与 `mp-class-tools-tests/**`（云端新增 `class_notices_meta` RPC，迁移在 `web/deploy/cloudbase/2026-11-17_notice_meta.sql`），
**未上传发布、VERSION 仍 2.0.0、UD v6 不变**。

| 文件 | 覆盖 | 复跑 |
| --- | --- | --- |
| `cache_unit_tests.js`（**改**，22 项） | 新增：meta RPC 优先/lite body lazy 原样进缓存且无 data URI；meta 404 才回退旧整表；meta 401 清身份且不回退；`ttLegacy:false` 时 site_assets 失败不再打 tool.furina.fun；保留原 16 项（分块/预算/TTL/签名/force/后台刷新/退出身份） | `node cache_unit_tests.js` / `node unit.js` |
| `nt_attach_url_tests.js`（**改**，10 项） | 新增：lite lazy 附件/图片 → 前 2 张有图片的卡自动拉完整 body 一次后可用；确实无 url 的附件只自动补拉一次（`_bodyTried` 负缓存防死循环）；`bootPull` 支持自定义请求 mock；保留原 URL/data URI 双形态 8 项 | `node nt_attach_url_tests.js` / `node unit.js` |
| `unit.js`（**改**） | 挂载上述断言；单测 config 显式 `ttLegacy:true`（生产 false），总断言 **560 / 6 既有失败** | `node unit.js` |
| `perf_notice_probe.js`（**新增，本地诊断**） | devtools automator + 官方测试身份：冷启动请求/字节/`evaluateScript`、storage keys（不含值）；**不含真实账号/token** | 先 `cli.bat auto --project ... --auto-port 9431`，再 `node perf_notice_probe.js` |

**实测（本机 2026-11-17）**：`unit.js` **560/6**（6 项既有失败：quickList 顺序 1 + draw ko-link 4 + 期次时间依赖 1）、
`sync_contract_test.js` **34/0**、`cache_unit_tests.js` **22/0**、`nt_attach_url_tests.js` **10/0**、
`staticcheck.py` exit 0（30 页）、`code_quality_check.js` exit 0；devtools automator（测试身份）冷启动请求 **10→7**（marks/site_assets/notices-lite/meta/visits/fit/homework/members，**209,393B / 0 失败**）、二次启动 **2**（marks/power），`evaluateScript` **513→391ms**
（完整重编译；热态复测 171ms），通知页自动完整 body **14→2**；真实云端 meta RPC **122 行 / 296,482B / 0 data URI**（旧整表 14.07MB）。

## 外观（跟随系统/浅色/深色）+ 电费同期比较独立行 专项（2026-11-15，未发版；待用户上传发布）

对应「移植性审计 + 可完整移植项」任务（审计矩阵 `mp-class-tools/docs/PORTING_MATRIX_20261115.md`）。
只改 `mp-class-tools/**` 与 `mp-class-tools-tests/**`；**未上传发布、VERSION 仍 2.0.0、UD v6 不变（外观偏好只存本机）**。

| 文件 | 覆盖 | 复跑 |
| --- | --- | --- |
| `appearance_unit_tests.js`（**新增**，14 项） | A 模式默认/持久化/非法入参/冷启动；B `pageStyle`（跟随系统为空、浅/深整组 token + `color-scheme`、分号结尾）；C **与 `app.wxss` LIGHT/DARK token 逐项对拍**（防两套色值漂移）；D `applyChrome` 导航栏/窗口/下拉背景/tabBar 参数 + API 缺失容错；E `themeClass`（显式 vs 系统交叉）；F 全局 `Page` 包装（首帧注入、onShow 同步外壳与原 onShow、幂等、`wx.onThemeChange` 只在跟随系统时刷新）；G `notifyPages` 单页失败隔离；H `util.theme()/nativeTheme()` 外观感知；I 29 页 WXML `page-meta themeStyle` + 根节点 `themeClass` 静态接线（含 `pages/all` 合并拖动 style）；J 页面级暗色块改 `.theme-dark`（通知/课表/体测/点名/统计 + app.wxss 轻量映射）与深色 hero 中性化（投票详情/抽签记录/使用说明）；K 「我的 → 外观」卡接线（模式数据/处理函数/选中态/不进 UD）；L 工具描述 2 行 clamp + 卡高；M 电费独立比较行 + 充值图例；N **`require('app.js')` 真实接线**（`App()` 前包装 Page → `pages/me` 首帧 themeStyle=深色 + onShow 深色导航栏） | `node appearance_unit_tests.js`（独立运行写 `appearance_result.json`）或 `node unit.js`（末尾已挂载，并入总表） |
| `unit.js`（**改**） | 末尾挂载 `appearance_unit_tests.js`（总断言 540 → **554**，含本任务 +14） | `node unit.js` |
| `v3_power_diag_tests.js`（**改**） | 电费自然周期同期比较断言由 `tiles[1].sub` 改为独立 `cmp/cmpUp`（8 处：单元 4 + 页面 4），并新增「副标不再拼接比较 / 无下降不显示比较」断言 | `node v3_power_diag_tests.js` |

**实测结果（本机，2026-11-15）**：`node appearance_unit_tests.js` **14/0**；`node unit.js` **554 passed / 6 failed**
（基线 540/6，本任务 +14 且未新增失败；6 项为既有失败：draw 的 ko-link.cn 期望 4 + quickList 顺序 1 + 期次时间依赖 1）；
`node v3_power_diag_tests.js` **65/0**、`node sync_contract_test.js` **34/0**、`node ug_cards_check.js` **59/0**、
`python staticcheck.py` **exit 0（29 页）**、`node code_quality_check.js` **全部规则通过**；`node tool_sort_unit.js` 18/3 与基线一致。
**未跑 automator / 真机**（本机无自动化端口），页面视觉以静态契约 + 单测覆盖；需用户上传体验版后真机确认浅/深色导航栏与 tabBar。

> v20 / 1.4.7（2026-11-05；v19 = 数据同步/隐私 1.4.6，v20 = 通知提醒 1.4.7）后：回归基准 = `node unit.js`（104/104）+ `notify_ui_test.js`（25/25）+ `cloudfunctions/notify.test.js`（35/35）+ `python staticcheck.py`（17 页、handlers / 分享 handler / 封面 0 缺失）+ 开发者工具预览（`nt_preview.js` 19 项通知页全功能断言、`nt_badge_preview.js` 22 项气泡/OCR、`ia_preview.js` 30 项信息架构、`share_check.js` 17 页分享、`identity_preview.js` 身份流程、`cache_perf_test.js` / `perf_*` 缓存性能）。
> - `e2e.js` 中旧的登录/注册、pages/verify 认证、课表管理旧用例已不适用，**标注为 v13 待重写**，本次不运行；
> - 新增 `identity_probe.js`（RPC 只读探测，不写云表）与 `identity_preview.js`（开发者工具里走完身份 → 工作台 → 班委 → 统计并截图到 `_shots/`）。

## PPT 演示专项（2026-11-09，未发版；待用户上传发布）

对应 task-3（PPT 演示 · 微信小程序端）。契约唯一真源 `web/ppt/CONTRACT.md`（含 2026-11-09 播放语义补充），
设计参考 `web/ppt/DESIGN.md`。只改 `mp-class-tools/**` 与 `mp-class-tools-tests/**`（不动 web/、android/、云端 DDL/RLS），
**未上传发布、VERSION 仍 2.0.0**。

| 文件 | 覆盖 | 复跑 |
| --- | --- | --- |
| `ppt_unit_tests.js`（**新增**，38 项） | 默认自建内存 wx mock（不发真实请求）；A URL 解析（http/https/data 直连、相对拼 base）/标题/大小/时间格式化/文件校验；B deckId（d+base36(ts)+6 位随机）、分片计数/区间（512KiB，最后一片可小）、§4.1 建行字段（RLS owner_sid=self、client=mp、uploading、deleted=false）、上传百分比；C manifest v1 归一化（缺字段/未知值/坏数据容错、页切换未知→fade、trd 默认 450、全局媒体表合并、缩略图兜底）；D step 扁平序列/posOf/advance/页码换算/progress/控制条文案/`fitRect` letterbox/`hotRects`/`hotButtons`（视频 48px、音频 32px、时长角标）/预加载计划/缩略图；E 状态文案（上传中%/排队/转换中%/失败/上传中断/未知、ready 无胶囊）、排序与别人的 uploading 过滤、心跳 180s 离线、重试方式、错误文案；F `runPool` 并发 ≤4/重试 2 次/永久失败/取消不挂起、`uploadChunks` 读文件→base64→发送链路（600KiB=2 片、offset/长度/内容、进度）、`readChunkBase64`（wx FS `openSync/read(position)/closeSync` + `arrayBufferToBase64`、失败容错）；G §4 云端接口（`POST /ppt_decks` 建行、分片 upsert Prefer、列表 select 不含 manifest、清单归一化/空 manifest/无行、queued/deleted/retry patch、失败清理分片、`DELETE` 分片、心跳与轮询 2 请求）；H 工程静态断言（app.json 注册 2 页/不加 tabBar、tools「演示」、图标 ≤2KB/媒体预算、两页 4 文件+分享 handler、`webp="{{true}}"`、播放器 custom/auto/disableScroll、step 语义、媒体层只在换页销毁、步点、黑屏、转场 CSS、预加载并发 ≤6、退出释放）；I 页面级（列表 onShow 强拉+心跳同轮+过滤+onHide 停轮询；聊天选文件→改标题→建行→2 片上传→queued 端到端；播放器步进/点击左右 1/3/滑动/黑屏/媒体层生命周期/抽屉/退出释放） | `node ppt_unit_tests.js`（独立运行写 `ppt_unit_result.json`）或 `node unit.js`（末尾已挂载，并入总表） |
| `unit.js`（**改**） | 末尾 require `ppt_unit_tests.js`；`catalog()` 期望追加 `ppt`（工具目录自然顺序末尾） | `node unit.js` |
| `tool_sort_unit.js`（**改**） | TOOLS 末尾新增 `ppt` → 同步 3 处顺序断言（自定义顺序 / 迁移补末尾 / 归一补末尾） | `node tool_sort_unit.js` |

**实测结果（本机，2026-11-09）**：`node ppt_unit_tests.js` **38 passed / 0 failed**；`node unit.js` **297 passed / 0 failed**；
`node sync_contract_test.js` **33 passed / 0 failed**；`node tool_sort_unit.js` **21 passed / 0 failed**；
`python staticcheck.py` **exit 0（23 页、handlers / 分享 handler 0 缺失）**；`node code_quality_check.js` **全部规则通过（退出码 0）**。
**未跑 automator / 真机**（无 9420 自动化端口）；页面视觉与 OSS 真机加载未验证，需用户在微信公众平台配置
request + downloadFile 合法域名后用真机正式版验证一张图 + 一段视频。

## PPT v1.2「原样播放」视频 + 续播 + 降级链专项（2026-11-10，未发版；待用户上传发布）

对应 task-7。契约唯一真源 `web/ppt/CONTRACT.md` §11（**§11.4 小程序媒体传输降级链**）；设计参考 `web/ppt/DESIGN.md`。
只改 `mp-class-tools/**` 与 `mp-class-tools-tests/**`（不动 web/、android/、云端 DDL/RLS，不部署/不推手机）；
**未上传发布、VERSION 仍 2.0.0**。

| 文件 | 覆盖 | 复跑 |
| --- | --- | --- |
| `ppt_video_unit_tests.js`（**新增**，30 项） | 默认自建内存 wx mock（不发真实请求）；A `manifest.video` 归一化容错（缺失/坏数据/非字符串 s/未知字段/绝对 URL/base 拼接/chapters 排序去重单调/ticks 百分比）；B 章节 seek（`videoChapterAt` 边界、`videoPageOf`、`videoSeekTarget`=t+0.05 且 clamp、`videoPrevNext` 首尾、`mm:ss` 文本/百分比）；C 模式选择（无视频→分步；wifi/4g/5g/unknown→原样；2g/3g/none→分步；设备偏好优先/非法偏好忽略/按 deckId storage）；D 续播（7 天、视频 >5s 且 <95%、分步首末步、`resumeText`、storage 存取/过期清理/100 条上限、`deckView.resumeShow` 徽标）；E 降级链状态机（direct→download→temp→step 全事件/未知状态安全、reset、下载进度未知总长→-1/文案）；F 倍速循环 1×/1.25×/1.5×/2×、常量（5s/3s/7 天）；G 工程静态接线（WXML 自制控制条/章节刻度/缓冲/下载态/模式胶囊/手势层、JS `chooseMode`/`videoStageNext`/downloadFile abort/看门狗/`createVideoContext('plv')`/`playbackRate`/复制链接/续播/热点三处重算/热点≥56px、列表「继续」徽标、VERSION 2.0.0）；H 页面级行为（默认视频模式+缓冲态、控制条章节 seek/进度条/倍速/复制链接/从头、直连失败→下载进度→临时文件→分步+toast、下载失败提示需配置 OSS 域名、下载无进度看门狗、退出 abort、模式切换双向定位、视频/分步续播、2g 默认分步、热点尺寸/角标） | `node ppt_video_unit_tests.js`（独立运行写 `ppt_video_result.json`）或 `node unit.js`（末尾已挂载，并入总表） |
| `unit.js`（**改**） | 末尾 require `ppt_video_unit_tests.js`（总断言 307 → **337**） | `node unit.js` |
| `ppt_video_preview.js`（**新增**，automator 实测） | 开发者工具 automator（端口 9424，**不 preview/不推手机**）：真实 deck `dmwalrdlgevz90l`（16 页、第 12 页内嵌视频 225.6s）列表整卡点击→播放器→分步热点（64px/「视频 3:46」/点开媒体层）；把真实 OSS `m0.mp4` 注入为 `manifest.video` 验证原样播放（直连是否真播放/timeupdate 推进、章节上下页 seek、倍速、暂停/继续、复制链接）；降级链（直连 404→下载进度 UI→下载失败自动分步+「需配置 OSS 域名」提示；mock downloadFile 返回真实临时文件→临时文件播放）；续播（播后退出→storage→列表「继续 00:31」→用 `wx.request` 包装器注入 manifest.video 重开→默认原样+续播）；wx.downloadFile 真实下载 OSS 视频结论；异常 deck 错误页不白屏；console error=0；截图 12 张到 `_shots_ppt_video/`，结果写 `ppt_video_preview_result.json` | 先 `"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto --project "C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools" --auto-port 9424 --trust-project`，再 `node ppt_video_preview.js`（`WS` 环境变量可覆盖 ws） |
| `ppt_unit_tests.js`（未改） | 保持 38→（现状 40 项）全过，不受本次影响 | `node ppt_unit_tests.js` |

**实测结果（本机，2026-11-10）**：`node unit.js` **337 passed / 0 failed**（=307 + 新增 30）；`node ppt_unit_tests.js` **40 passed / 0 failed**；
`node ppt_video_unit_tests.js` **30 passed / 0 failed**；`node sync_contract_test.js` **33 passed / 0 failed**；
`python staticcheck.py` **exit 0（23 页、handlers / 分享 handler 0 缺失）**；`node code_quality_check.js` **全部规则通过（退出码 0）**；
`node ppt_video_preview.js` automator 实跑 **38 passed / 0 failed**（截图见 `_shots_ppt_video/`）。

**devtools 关键结论（决定「原样播放」默认路径）**：
1. OSS 默认域名响应实测带 `x-oss-force-download: true` + `Content-Disposition: attachment`（`Content-Type: video/mp4`，14MB）；
2. **`<video src=OSS直链>` 在开发者工具里确实播放**（timeupdate 持续推进 0→19.6s、后续 156→169s）→ §11.4 第 1 步可行；
3. **`wx.downloadFile` 同 URL 也成功**（statusCode 200、`http://tmp/…mp4`；14MB 在 devtools 约 11–56s（限速波动大））→ 第 2 步可行，
   但必须有下载进度 UI（已实现）与 20s 无进度/180s 上限看门狗（已实现，避免卡死）；
4. devtools `urlCheck=false`，**正式版真机行为仍需用户验证**（见下）。

**真机风险 / 需用户做的事（无法自动化）**：微信公众平台把 `https://tool-furina-fun.oss-cn-hongkong.aliyuncs.com` 加入
**request + downloadFile 合法域名**（香港默认域名能否过微信校验未查证）；OSS 若开防盗链需放行空 Referer 与
`servicewechat.com`；上传发布后用**真机正式版**验一张图 + 一段视频（含「原样播放」与弱网默认分步）。

## PPT v2.0 下载中心 + v2.3 视频单独下载专项（2026-11-10/11，未发版；待用户上传发布）

对应 task-11（v2.0 下载中心）+ task-19（v2.3 视频/音频单独下载）。契约唯一真源 `web/ppt/CONTRACT.md` **§12（功能重定义）**、
**§12.8（视频/音频单独下载）**。只改 `mp-class-tools/**` 与 `mp-class-tools-tests/**`（不动 web/、android/、云端 DDL/RLS，不部署/不推手机）；
**未上传发布、VERSION 仍 2.0.0**。

| 文件 | 覆盖 | 复跑 |
| --- | --- | --- |
| `ppt_dl_unit_tests.js`（**新增**，36 项 = v2.0 26 + v2.3 10） | 默认自建内存 wx mock（不发真实请求）；A manifest v2 归一化（`slides` 可为空 + `files.compat/pdf/source`；旧 v1 兼容；缺 s/坏 compat/JSON 字符串/未知字段容错；warnings 截断 20）；B 下载文件行（三行顺序/label/大小/PDF 页数/建议文件名/打开类型）+ 旧 deck `manifest.src` 原始行 + `safeFileName`；C 详情视图（v2 ready / 旧 deck / video-only / 未就绪 / compat-only 合并 / 重试权限）；D 列表标签 + `filesOfDecks` 轻查询 + 缓存；E 页面行为（下载进度→`wx.openDocument`、取消 abort、失败 toast、转发/降级复制链接、旧 deck 预览/重试、onUnload abort）；F 工程静态接线；**M（§12.8）**：`manifest.media_files` 归一化（URL/kind/dur/w/h/slides/size/sha/坏项丢弃/上限 20）、无 media_files 兼容（`hasMediaFiles=false` 不显示）、`mediaRows` 行数据（「视频1 · 第 7 页」「音频1 · 第 12 页」序号按类型分开、多页「第 7、12 页」、时长/分辨率/大小/name/url）、详情视图 `hasMedia/mediaCount/mediaVideos/mediaAudios`、视频下载→`wx.saveVideoToPhotosAlbum`、相册授权失败→`showModal`+`wx.openSetting`、视频转发 `shareFileMessage(fileName=manifest name)`、音频→`openDocument`（失败降级转发）、媒体行复制链接/取消/失败 toast、WXML/JS 静态接线 | `node ppt_dl_unit_tests.js`（独立运行写 `ppt_dl_result.json`）或 `node unit.js`（末尾已挂载） |
| `unit.js`（**改**） | 末尾 require `ppt_dl_unit_tests.js`（总断言 402 → **412**；本文件新增 10 项） | `node unit.js` |
| `ppt_video_unit_tests.js`（**改**） | G3 列表断言按 §12.4.1 更新：整卡点击=下载详情（`openDeck` → `/pages/ppt/pptdl/pptdl?id=`）、「兼容版/PDF」小标签与轻查询；播放器/续播用例全部保留 | `node ppt_video_unit_tests.js` |
| `ppt_dl_preview.js`（**新增**，automator 实测） | 开发者工具 automator（端口 9424，**不 preview/不推手机**）：列表点击卡片=下载详情（不再进播放器）；真实 deck 形态识别（旧 deck「兼容版未生成 + 在线预览 + 重新处理」/ v2 三行下载）；用 `wx.request` 内存包装器注入 v2 `manifest.files+compat`（不写云端）验证列表「兼容版/PDF」标签、三行大小、两条橙色兼容提示；mock `wx.downloadFile`（进度 42%→成功）→ `wx.openDocument(fileType=pptx,showMenu)`、取消 `abort`、失败、复制链接（剪贴板校验）、`wx.shareFileMessage` 转发链；点「在线预览」进入旧播放器；截图 7 张到 `_shots_ppt_dl/`，结果写 `ppt_dl_preview_result.json` | 先 `"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto --project "C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools" --auto-port 9424 --trust-project`，再 `node ppt_dl_preview.js`（`WS` 可覆盖 ws） |
| `ppt_media_preview.js`（**新增**，automator 实测 v2.3） | 无 media_files 的 deck 断言「视频单独下载」分组**不显示**；`wx.request` 包装器注入 §12.8 `media_files`（视频 第7页 150.92s 1024×576 19.2MB / 音频 第12页 225.582s）后断言分组标题、两行「视频1 · 第 7 页」「音频1 · 第 12 页」、时长/分辨率/大小、三行下载仍保留；mock `wx.downloadFile`（进度 42%→成功）→ 视频 `wx.saveVideoToPhotosAlbum`（已保存到相册）/ 相册授权失败 `showModal`+`wx.openSetting` / 视频「转发」`shareFileMessage(fileName)` / 音频 `wx.openDocument` / 媒体行「复制链接」剪贴板；截图 4 张到 `_shots_ppt_media/`，结果写 `ppt_media_preview_result.json` | 同上（9424 端口），再 `node ppt_media_preview.js` |

**实测结果（本机，2026-11-10/11）**：`node unit.js` **412 passed / 0 failed**（402 + 新增 10）；`node ppt_dl_unit_tests.js` **36 passed / 0 failed**；
`node ppt_unit_tests.js` **40 passed / 0 failed**；`node ppt_video_unit_tests.js` **30 passed / 0 failed**；
`node sync_contract_test.js` **33 passed / 0 failed**；`python staticcheck.py` **exit 0（26 页、handlers / 分享 handler 0 缺失）**；
`node code_quality_check.js` **全部规则通过（退出码 0）**；`node ppt_dl_preview.js` automator **27 passed / 0 failed**（截图 `_shots_ppt_dl/`）；
`node ppt_media_preview.js` automator **17 passed / 0 failed**（截图 `_shots_ppt_media/`）。

**v2.3 视频/音频单独下载（§12.8）关键点**：分组仅在 `manifest.media_files` 非空时显示（旧 deck 无字段不显示）；行文案由
`pages/ppt/utils/ppt.js::mediaRows` 生成（序号按类型分开、多页列出、时长/分辨率/大小/`name`）；视频下载 → `wx.saveVideoToPhotosAlbum`
（授权失败 `showModal`→`wx.openSetting`，其它失败降级转发/复制链接）；音频下载 → `wx.openDocument`（失败降级转发）；
`wx.shareFileMessage` 转发文件名用 manifest `name`；媒体行与三行共用同一 `dl` 下载状态（进度/取消/失败 toast/复制链接），
**真实 deck 当前无 media_files → 分组不显示，转换机上线 media_files 后自动出现**（无需再改客户端）。

**大文件与真机风险（需用户）**：兼容包可能 = 源 **30–60MB**、单独视频 ≤200MiB，小程序用 `wx.downloadFile` 落临时文件 +
`onProgressUpdate` 显示进度 + 可取消，不读入内存；微信公众平台需把 `https://tool-furina-fun.oss-cn-hongkong.aliyuncs.com` 加入
**request + downloadFile 合法域名**（香港默认域名能否过微信校验未查证）；OSS 若开防盗链需放行空 Referer 与 `servicewechat.com`；
发布后**真机正式版**验证：下载一份 30–60MB 兼容包并用 `wx.openDocument` 打开、下载单独视频并保存到相册（授权弹窗）、
转发到电脑（devtools 不能代表真机）。

## 抽签升级 v1：名称映射 + 云端存证 + 记录页 + 核验二维码专项（2026-11-12，未发版；待用户上传发布）

对应 task-2（小程序端）。契约唯一真源 `web/draw/CONTRACT.md`（§2 算法 / §3.1 名称映射 / §3.2 存证与今日次数 /
§3.3 导出图 / §3.4 核验视图 / §4 小程序 / §5.3 测试）。只改 `mp-class-tools/**` 与 `mp-class-tools-tests/**`
（不动 web/、云端 DDL/RLS，不部署/不推送）；**未上传发布、VERSION 仍 2.0.0、UD v6 不变（只在既有 draw section 内加 names）**。

| 文件 | 覆盖 | 复跑 |
| --- | --- | --- |
| `drawproof_unit_tests.js`（**新增**，35 项） | 默认自建内存 wx mock（不发真实请求）；**A** draw-v1 契约 4 组固定向量 + 确定性/幂等/空池/count=0/可重复超池/不改入参池；**B** newSeed 16 位 hex、newRecordId 匹配 `^d[0-9a-z]{8,31}$`、`verifyUrl` = webBase + `/#verify=`（cloud-config `webBase` 临时 ko-link.cn）；**C** parseNames 边界（分隔符/无序号自增/trim/后值覆盖/0 号丢弃/超 40 字截断/≤300 升序）、nameMap/namesText/normNamesText/namesSummary、nameOf 优先级（映射>班级名单>空）、rowsOf 排序（含 rand 只改显示顺序）、labelsOf（只命中/升序/去重/≤300）；**D** buildParams 归一（range/excl/count/sort/rosterN/namesN 白名单结构）、paramLines/paramSummary/resultSummary、存证状态文案/导出参数行/QR note、removeLogLines（≤8 行+省略）、时间格式化；**E** replayResult/replayOk（复算/篡改/缺字段）、recordRow/listView（无学号）、detailView（参数/结果本地解析/时间线/复算/哈希/核验链接）、timelineRows；**F** 4 个 RPC（URL/body/统一 header Bearer+X-Class-Token、jsonb 数组解包、中文 reason 透传、网络错误→「网络不可用」、无身份零请求、事件白名单、limit 夹紧）；**G** pages/draw 页面级（名称映射弹层打开/计数/清空/取消/保存归一/摘要/重绘、doDraw 用 draw-v1 seed 且存证 payload=params/pool/result/labels/seed/algo、状态「已存证 · 今日第 N 次」、失败→未存证且导出无 QR+编号回退、导出 opt 存证编号/时间/今日/哈希/QR/qrTitle/qrCap/剔除重抽文本块、剔除/补抽/重置事件追加与在途排队补发、记录入口导航、onCloudSync 刷新映射摘要）；**H** pages/drawrec 页面级（`?id=` 深链详情、二维码 canvas 绘制 fillRect、复制核验链接/存证编号、分享深链、今日/全部列表切换与行摘要、点行开详情/返回列表、记录不存在/网络失败兜底、未登录零请求）；**I** canvas `qrTitle/qrCap` 可选覆盖（默认文案不变、不传 qr 不绘制）+ 工程静态接线（app.json 注册/4 文件/分享/draw 页接线/store+privacy+cloud 同步字段/不新增 section 或顶层键/单测挂入 unit.js） | `node drawproof_unit_tests.js`（独立运行写 `drawproof_result.json`）或 `node unit.js`（末尾已挂载，并入总表） |
| `unit.js`（**改**） | 末尾 require `drawproof_unit_tests.js`（本任务 +35 项：488 → 523；合跑时并行「长期通知」专项再 +12 → **535/0**） | `node unit.js` |
| `sync_contract_test.js`（**改**） | §5.3：`_sync_fixtures/` 的 `userdata_v6_web/mp.json` draw 加 `names` 并 `node merge_ref.js` 重新生成 3 份期望；`draw` 默认值改 `{names:''}`（与 `utils/privacy.js` DEFAULTS 一致）；应用/推送/v5 写回断言同步；**新增**「draw.names：LWW 合并 / 云端应用 / 本机改动推送 / 旧数据无字段按空/保留本机映射」1 项 | `node sync_contract_test.js` |
| `_sync_fixtures/merge_ref.js` / `userdata_v6_*.json` / `expected_*.json`（**改**） | 契约 oracle DEFAULTS.draw=`{names:''}`；夹具 web/mp draw 各带不同 names 验证 LWW；期望输出重新生成（与 `utils/privacy.js` 同口径） | `node _sync_fixtures/merge_ref.js` 可重新生成 expected |
| `_sync_fixtures/marks_ntdone_rows.json`（**改**） | 测试身份红线：`seat`/`id` 从真实管理员学号改为官方测试身份 `3260799999`（原值与 `sync_contract_test.js` 的 `r.seat === ID.sid` 断言冲突，且违反「测试只用测试账号」） | 无 |
| `ai_unit_lottery.js`（**改**） | `store.draw` 期望补 `names:''`；**新增**「AI runDraw 保存抽签参数时保留 draw.names」1 项 | `node ai_unit_lottery.js` |

**实测结果（本机，2026-11-12）**：`node drawproof_unit_tests.js` **35 passed / 0 failed**；`node unit.js` **535 passed / 0 failed**
（本任务新增 35 项：488 → 523；最终合跑时另一并行会话的「长期通知」专项新增 12 项 → 535，全部通过）；
`node sync_contract_test.js` **34 passed / 0 failed**（33 + 新增 1）；`python staticcheck.py` **exit 0（29 页、handlers / 分享 handler 0 缺失）**；
`node code_quality_check.js` **全部规则通过（退出码 0）**；`node ai_unit_lottery.js` **51 PASS / 0 FAIL**。
**未跑 automator / 真机**（本机 9400–9500 无自动化端口；页面视觉未截图），未上传发布。

**云端前置 / 待用户事项**：① 云端 RPC（`draw_records` / `draw_events` + 4 个 `draw_record_*`）由 Lead 按
`web/deploy/cloudbase/2026-11-12_draw_proof.sql` 应用后才可真实存证；未应用时本机显示「未存证（网络不可用）」、抽签本身不受影响。
② 发布前确认 `utils/cloud-config.js` 的 `webBase`（当前临时 `https://ko-link.cn`，恢复后改回 `https://tool.furina.fun`），
核验链接由用户扫码在浏览器打开（小程序不请求该域名，无需配 request 域名）。③ 本机 `unit.js`/`sync_contract_test.js` 为 mock，
真实云端只读验证（测试身份）待 RPC 就绪后由 Lead/QA 执行。

## 课表进入速度 + 电费趋势自动恢复专项（2026-11-06，未发版）

对应 task-5 / task-6：用户反馈「优化课表的加载速度，例如以先加载当前周保障进入速度」+
「有时进入电费界面时趋势显示统计中，需要刷新才出现」；并要求**用微信开发者工具自动化接口
（miniprogram-automator）做操作测试与屏幕获取**（不做屏幕/鼠标操作、不 preview 推手机）。
只改 `mp-class-tools/pages/tt/tt.js`、`pages/power/power.js`、`utils/cloud.js`（电费历史缓存）与测试；
未动 `web/`、云端 DDL/RLS、未上传发布（版本仍 2.0.0、AI off）。

| 文件 | 覆盖 | 复跑 |
| --- | --- | --- |
| `unit.js`（**改**） | 新增 §7c「课表进入速度」6 项（L1389-1600）：有本机 `ttCache` → `onShow` 同步返回即 `state='data'`、`rows>0`、`wk=当前周`（第 5 周）、**无 loading 中间态**、tt.json 请求已在 `onShow` 返回时发出（无 120ms 延迟）；旧版 `d.course` 同样直显；远程成功静默更新 `total/srcText`、远程失败保留缓存；无缓存 → 先 loading 再 data；静态断言 loading 受 `_hasLocalTt()` 保护、无 `setTimeout`/`120` | `node unit.js` |
| `v3_power_diag_tests.js`（**改**） | +5 项：首轮 power_history 网络失败 → 页面自动静默重试后趋势自动出现（不点刷新、请求数有界）；首轮 HTTP 200 空 → 自动恢复且**空结果不写 5 分钟缓存**；真实仅 1 点 → 恰 1 次重试后停止、仍「数据积累中」；正常数据 0 额外请求；canvas 节点未就绪兜底重绘 1 次 | `node v3_power_diag_tests.js` |
| `tt_entry_preview.js`（**新增**） | automator 真实渲染：mock 身份 + mock `wx.request`（tt.json 延迟 800ms）+ 预置 ttCache，`reLaunch('/pages/tt/tt')` 后采样/截图。A 有缓存：首帧 data + 当前周（5 列/第 5 周）+ 无骨架 + 首帧早于网络 + 后台静默更新落盘（20 项）；B 无缓存对照：骨架 → 网络后 data。产出 `_shots_tt_entry/*.png` + `result.json` | 先 `cli.bat auto --project mp-class-tools --port 9433 --auto-port 9420 --trust-project`，再 `node tt_entry_preview.js`（`TT_ENTRY_WS` 可覆盖 ws） |
| `power_trend_entry_preview.js`（**新增**） | automator 真实渲染：mock 身份 + mock `wx.request`（挂在 `getApp().globalData` 不污染 wx），**全程不点刷新**。变体 A 首轮 history 失败 → 自动重试后趋势自动出图（11 点折线、canvas 已绘、请求有界）；B 首轮 HTTP 200 空 → 自动出图；C 正常 24h（0 额外请求）；D 真实仅 1 点 → 仍「数据积累中」且不循环。产出 `_shots_power_trend_entry/*.png` + `result.json`，失败 exit 2 | 先 `cli.bat auto … --auto-port 9420 --trust-project`，再 `node power_trend_entry_preview.js`（`POWER_TREND_WS`/`--ws` 可覆盖） |

**实测结果（2026-11-06 20:5x，Lead 实跑）**：`node unit.js` **226/0**；`node v3_power_diag_tests.js` **38/0**；
`python staticcheck.py` **exit 0**；automator `tt_entry_preview.js` **20 PASS / 0 FAIL / 0 console error**；
`power_trend_entry_preview.js` **31 PASS / 0 FAIL / 0 console error**（390 宽模拟器）。
说明：场景 B（无缓存对照）mock 延迟用 4000ms（devtools `reLaunch` 返回可能 1–2s+，需保证返回后仍能看到骨架）；
全程未使用屏幕/鼠标自动化、未推手机。

## 课表 6/7 天同页缩放专项（2026-11-06，未发版）

对应 task-2：用户反馈「微信小程序课表在周六/周天有课时，用优化显示比例的方式让其显示在同一页、不影响课程观看，
而不是课表需要滑动才能完整观看」。只改 `mp-class-tools/pages/tt/` 与 `mp-class-tools-tests/`
（**不动 web/、云端 DDL/RLS、不上传发布、版本号仍 2.0.0、AI 保持 off**）。

| 文件 | 覆盖 | 复跑 |
| --- | --- | --- |
| `unit.js`（**改**） | 7b 段按新行为重写：days=5/6/7 时 `colW = floor((630-96)/days)` = **106/89/76rpx** 且内容宽 96+days×colW ≤630rpx、`_gridOverflow=false`/`_gridMaxX=0`；6/7 天周表左右滑**直接切周**（无 giveScroll）；首/末周 0.28 阻尼回弹；5 天对照；日视图横滑；320ms tap 全抑制且过期恢复；WXML/WXSS 静态断言（colW 行内 style、dense/dense7 标记、7 天 `showSpan=false`、课程名 19rpx 下限、单节块 2 行 clamp、旧 `_gridAtEdge`/giveScroll 分支已删除）。另修复既有 nt 气泡正则过时（`.nt-sub` 内新增嵌套 `.nt-src` 使非贪婪匹配截断；1 处、仅测试文件，与本次功能无关） | `node unit.js` |
| `tt_swipe_preview.js`（**改**） | 开发者工具 automator 真实渲染/触摸：mock 身份 + 本地 `_tt_fixture_20261106.json`（第 3 周真实「周六有课」=6 天；第 10 周注入周六/周日课程=7 天）；断言 6/7 天全列（含周六/周日）在卡片内、无横向滚动、课程名可读（实测字号 ≥9px）、7 天 `.cspan` 0 个、单节块不裁半行、横滑切周、320ms 点击抑制、点击课程仍开详情；0 console error | 先 `cli.bat auto --project mp-class-tools --port 9433 --auto-port 9420 --trust-project`，再 `node tt_swipe_preview.js` |
| `_tt_fixture_20261106.json`（**新增**） | 课表 fixture（= 当日线上 `tools/tt.json` 的本地只读快照，测试不访问网络/云端） | 无 |

**结果（本机实跑）**：`node unit.js` **215/215 PASS**；`python staticcheck.py` **exit 0**（21 页、handlers/分享 handler 0 缺失）；
`node code_quality_check.js` **全部规则通过**；`node tt_swipe_preview.js` **43/43 PASS / 0 console error**
（模拟器 windowWidth=390，rpx 等比布局与 375 宽同构）。截图：`_shots_tt_fit/00-week-5day-baseline.png`（5 天对照）、
`01-week-6day-sat-full.png`（6 天含周六）、`02-week-7day-sat-sun-full.png`（7 天含周六/周日）、
`03-day-view.png`（日视图滑动跟手帧）、`04-6day-after-swipe.png`；结果 `_shots_tt_fit/result.json`。

> 已知限制 / 环境说明：
> - 截图在 devtools 模拟器**深色主题**下采集（布局/字号与浅色一致，暗色为产品既有主题；不影响本专项的列宽/字号验证）；
> - 采集时另一并行会话正在使用同一台机器的微信开发者工具（反复重启 devtools / 占用 9420 automator 端口）；
>   最终完整 PASS 为 20:11 抢到稳定窗口后跑出（`result.json`：windowWidth=390、43/43、0 console error）；
> - 7 天场景的周六/周日课程为**测试注入**（线上 tt.json 仅个别周周六有课、无周日课），仅内存注入，不落盘/不上传；
> - 备份：改前 `tt.js/tt.wxml/tt.wxss` 在 `_backup_tt_fit_20261106/`。

## v2.0.0 小程序端专项（2.0.0，2026-11-05）

对应 task-3（需求 1/2/3/5/7/9/11/12/13/14/15/16 + 审核相关现状）。**新增/改动测试文件**：

| 文件 | 覆盖 | 复跑 |
| --- | --- | --- |
| `v2_unit_tests.js`（**新增**，24 项） | 需求 1 版本唯一来源/我的页页脚；需求 2 `scrollmem` 记录→恢复/取消/首开一次/横向 scroll-view；需求 9 recurrence 下次时间（4 种频率 + startAt + 不判过期/不计待处理）；需求 12 `ntAdminEdit/ntAdminHide` PATCH 契约+签名纳入 hidden/edited_at+通知页 override/hidden/已隐藏/编辑删除恢复；需求 7 附件缺 url「待获取」徽标 + 点击弹窗复制群名；需求 11 双卡轮换（只 setData 文案字段/≤1 不轮换/隐藏暂停/静态动画）；需求 13 全局 reduced-motion/克制时长/通知高度过渡；需求 14 fttable→store.fit→udSections→ft 页刷新；需求 16 marks 强制 TTL/notifyPages/markPend 补发；需求 5 滑动卡死审计；需求 10 合规静态扫描；**审核相关：锁定「不保留审核模式」（源码无相关引用、身份页仍学号+姓名登录）** | `node v2_unit_tests.js`（独立运行写 `v2_unit_result.json`）或 `node unit.js`（并入总表） |
| `unit.js`（**改**） | 7b 段课表滑动用例按需求 3 新规则重写：6/7 天溢出非边缘 giveScroll、右边缘左滑切下一周、左边缘右滑切上一周、5 天不溢出直接切、首/末周阻尼、`bindscroll/scroll-left` 静态断言；末尾并入 `v2_unit_tests.js` | `node unit.js` |
| `sync_contract_test.js`（**改**） | 需求 14：fttable 选择 → `store.fit` → `udPush` blob 的 fit 字段集合 == web `UD_FIT_KEYS`；需求 16：`marksPull(true)` 绕过 TTL、远端变化 notifyPages、失败进 markPend 后 `cloudPull` 补发清队列、页面强制刷新的静态断言 | `node sync_contract_test.js` |
| `tt_swipe_preview.js`（**改**） | 需求 3 automator 真实触摸定向复测：自动定位「周末有课 → 6/7 天横向溢出」的周（优先第 9 周；线上 tt.json 更新后周末课周次会变），非边缘 giveScroll / 右边缘左滑切下一周 / 左边缘右滑切上一周 / 日视图切周 / 短滑后点击抑制 | 先 `cli.bat auto --project mp-class-tools --port 9433 --auto-port 9420 --trust-project`，再 `node tt_swipe_preview.js` |

**结果**（发版默认状态 = AI 开发模式 `--off`）：`unit.js` **147/147**（原 123 + v2 24）、`sync_contract_test.js` **29/29**、
`staticcheck.py` exit 0（AI off 后复跑仍 exit 0）、`ai_unit_all.js` 8/8（296，AI off 前验证）、`ai_contract_test.js` 99/99、
`ai_eval_check.js --strict` 14/14（AI off 前验证）、`tt_swipe_preview.js` **16/16 PASS / 0 console error**；
开发者工具 `cli.bat auto-preview` 编译通过：**AI off 发布包 TOTAL 667,382 B（单主包）**；
开发期 AI 开启基线 TOTAL 1,044,276 B（main 688,982 + `/ai/` 355,294）。
> 2026-11-05 晚代码质量修复后（见文末「代码质量修复」节）：AI off 发布包 **TOTAL 532,652 B**（图片压缩 -134,730 B）。

## v2.0.0 网站功能同步专项（宿舍电费 / 管理员诊断，2026-11-06）

对应 task-12（用户要求「同步网站和微信小程序的功能」，网站 → 小程序；只改 mp + tests，不动 web/、云端，不上传）。**新增/改动测试文件**：

| 文件 | 覆盖 | 复跑 |
| --- | --- | --- |
| `v3_power_diag_tests.js`（**新增**，41 项） | 电费：17 间宿舍目录与网站 `PW_ROOMS` 一致 / 自定义 bottom-sheet / 非法值降级 / **v5 低电档位归一（无 70/90）与状态边界 q<low / low≤q<2low** / RANGES 24h/7d/30d / **v5 rateFrom 4 组 fixture + estimate 混合/单档/下限** / deriveRange drop/充值 lastUp / 4 tiles（估算+≈rate、区间用电、低电阈值、上次充值）/ 电量环 estimate/30 / 低电条 / **第 9 条 slowUpdate（正常/慢/无变化/阈值 0.005/边界）+ 页面慢更新徽标/tile「参考」** / **趋势 v6：全部区间铺满绘图区（无横滑/无 scroll 组件）、点击/拖动最近真实采样点游标（24h HH:MM、7d/30d MM-DD HH:MM）、空态不显示、页面不滚动** / 未选择 0 请求 / **拉取 24h+7d 契约** / TTL 2min+history 5min / 失败降级+离线兜底；sheet 交互；trendLine 时间比例/≤240+区间上限、xTicks/xticksWindow；canvas 绘制；期间有充值/上次充值；**v5 阈值面板交互/UD 推送 {sel,at,low}/at 镜像/本机兜底/换端/旧数据**；**task-23 工作台卡/持久化**；**task-28 安全审计（无 rich-text/innerHTML/eval、data URI 10MB 上限、扩展名白名单、archive 文件名不参与路径、token 不落日志）**；诊断 4 组 13 项/权限/60s；工程静态断言；契约：privacy 11 section / 空 v6 与 merge 默认一致 / 14 顶层键 / power 不进导出 | `node v3_power_diag_tests.js`（独立运行写 `v3_power_diag_result.json`）或 `node unit.js`（并入总表） |
| `home_power_preview.js`（**新增**，task-23） | 开发者工具 automator 390 宽截图/断言（本地 mock 身份+网络，不接触真实云端）：工作台未选择引导卡且 0 个 power 请求 / 已选择展示 23号楼A座321 + 382 度 + 充足（2min 缓存命中可 0 请求）/ 点卡片进入电费页且选择/数据恢复 / 重整工作台卡片仍恢复；产出 `_shots_power_home/{01_home_power_empty,02_home_power_selected,03_power_restored,04_home_power_restored}.png` 与 `result.json` | 先 `cli.bat auto --project ... --auto-port 9420 --trust-project`，再 `node home_power_preview.js` |
| `power_preview.js`（**改**） | 开发者工具 automator 390 宽截图/断言（本地 mock 身份+网络，不接触真实云端）：未选择单行入口/引导；弹层打开/切 23A 九间/点房间选中收起；24h 紧凑 Hero + 折线；**v5 估算 tile**/**低电阈值面板**/**阈值 50 偏低与低电态**/**第 9 条慢更新徽标+参考**/**页面横向溢出 + 全部区间 chartW=容器宽 + y 轴不重叠 + 无 scroll-view**；**task-28：7 天点击 12%/50%/88% 三个位置游标 + 拖动、30 天点击/拖动游标、松手保留、页面不滚动**；产出 `_shots_power_sync/{00_power_empty,01_sheet_open,01b_sheet_23A,02_dashboard_trend_24h,02b_tiles_24h_estimate,06_low_panel,07_low50_warn,08_low50_low,09_slow_badge,10_layout_24h,11_layout_7d,04_trend_7d,04c_cursor_7d_1,04c_cursor_7d_2,04c_cursor_7d_3,04d_cursor_7d_drag,04b_tiles_7d,05_trend_30d,05c_cursor_30d_drag,05b_tiles_30d,03_low}.png` 与 `result.json`；**30/30 PASS** | 先 `cli.bat auto --project ... --auto-port 9420 --trust-project`，再 `node power_preview.js` |
| `perf_ug_preview.js`（**新增**，task-28） | 开发者工具 automator 390 宽：mock 身份/网络记录首屏请求时序（首屏 2 个请求：marks @131ms / notices @145ms；250ms 内 2 个）与 UI 截图；使用说明页 16 条含电费/通知附件/工作台卡/水量抄表、滚动截图、无横向溢出；产出 `_shots_perf/{01_index_first_screen,02_ug_power,03_ug_notice}.png` 与 `result.json` | 先 `cli.bat auto --project ... --auto-port 9420 --trust-project`，再 `node perf_ug_preview.js` |
| `nt_archive_preview.js`（**新增**） | 开发者工具 automator 390 宽通知压缩包附件截图/断言：真实 group 夹具（`_nt_fixtures/nt_archive_group.json`，源 briefdesk board-data `g_qqfile_8b01d25799`）→ 5 行清单/3 可预览/2 仅清单、meta「压缩包 · 已识别 5 个文件」、`archiveOk` 不待获取；内部 XLSX 预览走 writeDataUri+openDocument(showMenu:true)；模拟缓存旧 body 时按需 `ntGroupFull` 自愈；产出 `_shots_nt_attach/{01_nt_archive_card,02_nt_archive_rows}.png` 与 `result.json` | 先 `cli.bat auto --project ... --auto-port 9420 --trust-project`，再 `node nt_archive_preview.js` |
| `stats_preview.js`（**新增**） | 开发者工具 automator 390 宽管理员 mock 截图/断言：统计页筛选两组（模式 3 chips / 范围 2 chips，整组换行不单 chip 掉行）、汇总卡 2 统计项+更新时间不挤、按天/按小时 strow 的 label/bar/value 同行对齐且不溢出；产出 `_shots_stats/{01_stats_account,02_stats_day,03_stats_hour}.png` 与 `result.json` | 先 `cli.bat auto --project ... --auto-port 9420 --trust-project`，再 `node stats_preview.js` |
| `unit.js`（**改**） | 末尾 require `v3_power_diag_tests.js`；quickList/catalog、udSync 等旧断言同步到 21 页/10 section | `node unit.js` |
| `sync_contract_test.js`（**改**） | SECTION_KEYS 10 键（power 在 nick 后）；`_sync_fixtures/*` 升级 13 键（power 值/at 镜像、换端恢复、v5 迁移）；新增 power 契约用例 | `node sync_contract_test.js` |
| `_sync_fixtures/merge_ref.js` / `userdata_v6_*.json` / `expected_*.json`（**改**） | 与网站 `web/tools/tests/sync_check.py` 的 WEB/MP/V5 夹具及 EXP_* 期望逐字段核对一致 | `node _sync_fixtures/merge_ref.js` 可重新生成 expected |
| `ai_unit_identity.js`（**改**） | 旧「今日课程」断言写死周四课表（周五/周末必挂）；改为按夹具 TT 的 `day=今天` 动态计算（AI 三件套恢复 8/8） | `node ai_unit_all.js` |

**结果**（发版默认状态 = AI 开发模式 `--off`）：`unit.js` **229/229 PASS**（原 123 + v2 24 + v3 41 +
2026-11-06 07:05 通知文案精简同步 5 项，后者为非电费/诊断改动）、
`sync_contract_test.js` **31/31 PASS**、`staticcheck.py` **exit 0（21 页、handlers/分享 0 缺失）**、
`ai_unit_all.js` **8/8（296 项）**、`ai_contract_test.js` **PASS 92 / FAIL 0 / PENDING 5**（AI off 基线）、
`ai_eval_check.js --strict` **14/14**；`cli.bat auto-preview` 编译通过 **TOTAL 652,076 B（单主包）**
（含 07:05 通知文案精简同步、电费对齐网站 07:01 定稿 +454 B、宿舍选择 bottom-sheet + canvas 折线 +6,168 B、
趋势区间 24h/7天/30天 +5,157 B、v4 横滑 + 固定 y 轴 + x 覆盖层 +3,122 B、v5 估算重构 + 可调低电阈值 +4,881 B、
task-23 工作台电费关注卡 + 持久化修复 +4,268 B、第 9 条慢更新徽标 +「参考」+1,011 B、真机趋势溢出修复 +1,011 B、
电费界面排版重构 +1,604 B、固定宽 canvas 横滑裁切修复 +232 B、tiles 真机 2×2 Grid 修复 −187 B、访问统计筛选/汇总/列表排版修复 +1,293 B），媒体 37 个 PNG = **109,337 B**。证据：`v3_power_diag_result.json`、
`_compile_info_off.json`、`_shots_power_sync/`（27/27 PASS）、`_shots_power_home/`（6/6 PASS）、`_shots_stats/`（8/8 PASS）、`_shots_nt_attach/`（5/5 PASS），均 390 宽、0 console error。

> 已知限制：电费趋势为 canvas 2d 折线（24h 铺满不横滑；7d/30d 用「固定宽 canvas + 透明 scroll 代理」横滑，canvas 宽=绘图区宽、
> 内容宽 n*gap+16 仅作滚动占位、canvas rect 永不超出卡片；
> 点数上限 7d≤170/30d≤240、canvas 物理宽 ≤~5376，x 按真实时间比例）；固定 y 轴（3 刻度 + 竖线，空态只留竖线无刻度，
> 1 位小数）；固定 x 轴覆盖层（可见窗口 3/4/5 刻度、bindscroll 16ms 节流、同屏去重，24h HH:MM / 7d·30d MM-DD）；
> <2 采样显示「数据积累中」不绘制；**v5 估算用 rateFrom+estimate（24h+7d 两档、跳过充值跳变、0.65/0.35、rate≥0.05）**，
> 选择后并行拉 24h+7d（30d 档再加当前档）、各档 5min 缓存；低电阈值随 UD power.low 同步（默认 30，
> 档位 10/20/30/40/50/60/80/100，无 70/90；本机 `zq_power_low_<sid>` 仅兜底）；区间只记本机 `zq_power_range_v1`（不进 UD）；
> 与网站实现差异：小程序用 scroll-view 包超宽 canvas（网站为固定 canvas + scroll 代理），固定双轴/时间比例一致；
> 宿舍选择为自定义 bottom-sheet（360/430 下 2–4 列自适应、内滚 + safe-area）；
> 诊断 `site_tls` 只展示云端行、`site_static` 用本机课表快照兜底；网站仍是电费/诊断主实现（后续网站改版需按数据契约对齐）；
> AI page-meta 仍 18 页（AI off，重开前需补 2 页）。
> 电费数据边界：数据侧保证 `public.power.quantity` 非空；`quantity=null` 不在产品路径（两端按 0 防御性兜底，非真实场景）。

> 审核相关：按用户 2026-11-05 指示，小程序**不保留审核模式**（此前预览脚本 `v2_preview_check.js` 已删除、
> 相关源码与文档已清理）；测试身份已由云端班级名单新增（审核时走正常身份页登录；客户端无代码/入口，
> 凭据只随交付说明提供、不写入仓库文档）。除该云端测试身份外不添加任何审核相关功能。
> QA `_qa_v2/static_scan.py` 中与审核模式相关的断言需随本次移除同步更新。
>
> 备份：`_backup_v2_20261105/`（改动前关键文件快照：app.js/app.json/app.wxss、utils/cloud|store|identity|notice、
> pages/tt、pages/nt、pages/index、pages/me、pages/identity、README、CHANGELOG）；被移除的审核模式历史文件
> 保留在 `_backup_v2_20261105/removed_audit_mode/`（仅回滚用备份，不参与包体、不被产品代码引用）。
>
> 发版默认状态：AI 开发模式已 `python ai_toggle.py --off`（`app.json` 无 agent/subPackages，
> `project.config.json` 的 `packOptions.ignore` 含 ai/agent 两条排除项，`ai/` 源码保留；
> 两文件备份在 `_backup_ai_toggle/`）；QA `_qa_v2/static_scan.py` 无 AI PEND。
> 发版后如需恢复 AI 适配：`python ai_toggle.py --on`（需重新上传/发布才生效）。

被测项目：`C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools`（v25 / 2.0.0，2026-11-06）
测试日期：2026-10-18（初版）/ 2026-10-20（v10 回归）/ 2026-11-04（v11 课表 / v12 身份系统）

## 最终结果

- 通知提醒（1.4.7，2026-11-05）：`notify_ui_test.js` **25/25 PASS**（前端 mock：授权/拒绝/参数契约/快捷项/自定义校验/胶囊/取消/list 核对/静态断言）；云函数 `cloudfunctions/notify.test.js` **35/35 PASS**（wx-server-sdk mock：subscribe/list/cancel/publishNotice/timer、边界、零真实发送）；独立验收（QA）：云函数契约 50/50、前端契约 42/42、automator 23/23（未真实授权/未发消息）、真实云只读 list 4/4。
- 单元/契约：**104 项，104 通过**（2026-11-05 v20 通知提醒后复跑：79 原有 + 25 通知提醒 UI 单测）。
- 数据同步 / 隐私（1.4.6，2026-11-05）：`sync_contract_test.js` **26/26 PASS**——merge 与契约 fixture 逐字节一致（`_sync_fixtures/`）、v5 迁移、`marks kind='ntdone'` upsert/读取、远端 v6 应用到 store 各 section、push body 契约（含未拥有 section 保留）、1200ms 防抖、cloudOff 阻断、清除云端后抑制期（不自动回推）、导出隐私（无 token/学号/名单原文）。独立验收（QA）：合并算法独立实现 116/116、wx mock 独立复跑 25 项、隐私 strict 31/31、automator 真实云端 **34/34 PASS / 0 console error**。
- 性能缓存（1.4.5）：`cache_perf_test.js` **16/16 PASS**——20 轮 × 30s 轮询 90 请求 / 56.75MB → **9 请求 / 4KB**（通知整表 0 次、签名 1 次）；二次进入通知页 0 请求；TTL 过期仅 1 次 ≈889B 签名请求。`perf_cloud_probe.js`（只读真实云端）全 PASS：整表 1.91MB / 322ms vs 签名 2,152B / 38ms。`perf_nt_preview.js`（automator 真实云端）：缓存 1,988,238B / 6 块 / 单块最大 612,415 字符、二次进入 0 请求、0 console error；结果 `_perf_*_result.json`。
- 通知页（1.4.4）：`nt_preview.js` **19 项全过、0 console error**——默认展开 12/12、已过期收起 12/12、5 张文件卡、6 张图卡、表单/链接/小程序/公众号行、图片落地、收起/展开、标记已处理计数、原始消息、已截止筛选与区块展开；截图见 `_shots/nt/`。
- 静态审计：**18 页**、handlers missing 0、分享 handler / 封面 0 缺失、无 web-view / 用户信息接口；旧 pages/verify 已删除。
- 身份系统：`class_verify` 真实 RPC 探测通过（陈子麒 / 3260707024 → token + role=副团支书 + is_admin=true；class_members 70 人）。
- 信息架构 / 隐私（1.3.3）：`ia_preview.js` 30 项全过（工作台快捷=4、今日课程、作业/通知待办、工具目录与排序弹层、我的四项指标、**首页/我的无头像与学号字段**、三页无横向溢出、0 console error）；截图见 `_shots/ia/`。
- 微信原生分享（1.4.0）：`share_check.js` 58 项全过——17 页 `onShareAppMessage` / `onShareTimeline` 均返回 title/path/query/imageUrl，封面文件存在，`wx.showShareMenu` 菜单含转发 + 朋友圈，课表分享带 `wk=` 且打开定位该周，通知/班委标题动态取数；0 console error。
- 定点回归：开发者工具预览身份页 → 验证 → 工作台 → 班委 → 统计，截图见 `_shots/`。
- 历史端到端：2026-10-18 曾 74 项全过；v11 起改为「unit + staticcheck + 定点预览」，`e2e.js` 待 v13 重写。
- 网页版：2026-11-05 08:2x 用户数据跨端同步 v6 + 通知已处理上线（线上 373,691 B · sha256 `eeb5e348…`；`sync_check.py` 110/110、`perf_check.py` 123/123、roster 199/199、reset 109/109、overflow 0、export 正常、committee 14/14）。

## 文件

- `unit.js` / `unit-result.json`：Node 单元/契约测试（v20 起 104 项，含缓存 / 同步 / 通知提醒 UI 单测）。
- `notify_ui_test.js`：**v1.4.7 通知提醒前端回归**（Node + mock wx：requestSubscribeMessage accept/deny、wx.cloud.callFunction 捕获）——参数契约、快捷项、自定义校验、胶囊、取消、list 核对、页面静态断言；25/25。
- `notify_flush_ui_test.js`：**2026-11-10 提醒链路修复前端契约**（静态/参数；mock，不发真实消息）——`flushReminders()` 不请求授权、`app.js warmSync` 回前台补发且失败静默、云函数 `flush/diag/心跳/陈旧守卫/config 触发器`；10/10。
- `cloudfunctions/notify.test.js` + `cloudfunctions/_mock/wx-server-sdk.js`：**v1.4.7 云函数契约回归**（内存 mock 集合/openapi/getWXContext）——subscribe/list/cancel/publishNotice/timer、边界、零真实发送；35/35。
- `cloudfunctions/notify_fix_20261110.test.js`：**2026-11-10 提醒链路修复回归**（内存 mock，零真实发送）——定时器心跳、陈旧提醒 6h 守卫（含边界）、flush 只处理调用者 openid、diag 聚合与隐私（无 openid/ref）、发送失败 attempts、config 触发器；18/18。
- `_notify_fix_20261110/`：**2026-11-10 微信提醒从未送达的根因取证与修复交付**——`REPORT.md`（结论/证据/用户一步操作/验收）、`probe_cloud.js` / `probe_diag.js` / `verify_trigger.js`（真实云端只读诊断 + 触发器上传后验证）、`trigger_research/`（触发器上传为何无法程序化，含证据）。
- `sync_contract_test.js` / `_sync_fixtures/`：**v1.4.6 跨端同步契约测试**（Node + mock wx；夹具副本不依赖外部目录）——merge 与网页端逐字节一致、v5 迁移、`ntdone`、远端应用、push body、防抖、cloudOff、清除抑制期、导出隐私、页面静态断言。
- `cache_unit_tests.js` / `cache_unit_result.json`：**v1.4.5 缓存与同步门控单测**（由 `unit.js` require 调用）——分块 >1MB 读写、块上限、TTL、sid 隔离、损坏/缺块回退、预算淘汰、退出身份清空、`cloudPull` TTL 门控、`force` 只跳过 TTL、无 `getApp` 不崩。
- `cache_perf_test.js` / `_perf_cache_result.json`：**v1.4.5 性能量化**（Node mock wx + 2MB 合成通知）——轮询次数/字节、二次进入 0 请求、TTL 签名请求计数。
- `perf_cloud_probe.js` / `_perf_cloud_probe.json`：只读真实云端探测（整表 vs `select=id,ts` 签名查询的体积/耗时/顺序一致性；**不打印 token 与内容**）。
- `perf_nt_preview.js` / `_perf_nt_preview_result.json`：开发者工具 automator 实测（真实云端）——缓存落盘块数/单块上限、二次进入请求数、console 错误。
- `nt_badge_preview.js`：**v1.4.3 通知页「职位气泡 + OCR 标记」回归**（开发者工具 automator，真实云端数据）——断言 `pubBadge = senderRole || senderBadge`（气泡文字 = 职务，不再统一「班委」）、`.nt-sub .nt-role` / `.nt-ocr` / `.nt-raw-hd` DOM 渲染（v1.4.4 重构后选择器已同步）、原始消息发送者气泡（`fromRole || fromBadge`）、OCR 文字进原始消息，浅色截图 `_shots/nt-badge/`；结果 `_shots/nt-badge/result-light.json`（22/22，0 console error）。深色需先在模拟器底部工具栏切「深色」再跑 `node nt_badge_preview.js dark`。
- `nt_preview.js` / `nt-result.json`：**v1.4.4 通知页全功能回归**（开发者工具 automator，真实云端 24 组数据）——默认展开 / 已过期收起、附件文件卡（预览/下载）、图片懒加载与预览、收集表/链接/小程序/公众号行、标记已处理、原始消息弹层、已截止筛选与折叠区；19/19 PASS、0 console error，截图 `_shots/nt/`（01-top / 02-raw-sheet / 03-expired-filter / 04-file-card / 05-form-row）。
- `staticcheck.py`：页面/组件/事件/硬约束/包体/urlCheck 审计。
- `identity_probe.js`：`class_verify` / `class_members` 只读探测（打印身份字段与名单人数，不打印 token 明文、不写云表）。
- `identity_preview.js`：微信开发者工具（miniprogram-automator）身份流程预览 + 截图（`_shots/`）。
- `ia_preview.js` / `ia-result.json`：**v1.3.3 信息架构 / 隐私回归**——工作台 / 工具 / 我的三页截图（`_shots/ia/`）+ 30 项页面数据、尺寸、排序弹层、无头像/无学号断言。
- `share_check.js` / `share-result.json`：**v1.4.0 微信原生分享回归**——逐页调用 `onShareAppMessage` / `onShareTimeline`、校验分享参数与封面文件、hook `wx.showShareMenu`、验证课表 `?wk=` 定位与通知/班委动态标题。
- `make_share_images.py`：生成 `images/share/*.png`（500×400，5:4）与桌面「分享卡片」总览图。
- `theme_preview.js`：**暗色/浅色双主题逐页截图回归**（22 页/态，含弹层）。需先在开发者工具模拟器底部工具栏「手机图标 → 浅色 / 深色」选主题，再跑 `node theme_preview.js dark|light`；截图落 `_shots/theme-<主题>/`。
- `e2e.js` / `e2e-result.json`：旧端到端用例（**v13 待重写**，v12 不运行）。
- `cloud_patch_fallback_test.js`：小程序不依赖 PATCH 的软删/更新回归（v12 的 cbPatch 仍走 upsert，可参考）。
- `ui_debug.js` / `ui_drag_test.js` / `ui_scroll_test.js`：v10/v11 定点 UI 回归（部分依赖旧登录，v13 更新）。
- `cloudcheck.py` / `cloudprivacy.py`：CloudBase PostgREST 只读探测（不写数据、不打印内容）。
- `security_hardening.sql` / `security_rollback.sql`：2026-10-18 云端 RLS（历史，v12 的 RPC 权限见项目 README 第二节）。
- `_backup_v11_pre_identity_20261104/`、`_backup_v13_pre_ia_20261104/`、`_backup_v14_pre_share_20261104/`、`_backup_v16_pre_nt_parity_20261104/`、`_backup_v19_pre_datasync_20261105/`、`_backup_v20_pre_notifyremind_20261105/`：改动前的项目快照（回滚用；v19 = 数据同步/隐私 1.4.6 前，v20 = 通知提醒 1.4.7 前）。
- `make_fix_report.py` + `report_assets_after/`：历史修复复测报告。

## 复跑

```powershell
cd C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools-tests
node unit.js
node sync_contract_test.js   # v1.4.6 数据同步契约（夹具在 _sync_fixtures/）
node notify_ui_test.js       # v1.4.7 通知提醒前端契约（mock，不发真实消息）
node notify_flush_ui_test.js # 2026-11-10 提醒链路修复契约（flush/diag/心跳/陈旧守卫；mock）
cd cloudfunctions && node notify.test.js            # v1.4.7 云函数契约（mock，不发真实消息）
cd cloudfunctions && node notify_fix_20261110.test.js  # 2026-11-10 修复回归（mock）
python staticcheck.py

# 只读探测云端身份 RPC（不会写任何云表）
node identity_probe.js
node identity_probe.js 3260707026 谢梓萱

# 开发者工具预览（需先启动工具并 auto 连上）
& "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto `
  --project "C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools" --auto-port 9420 --trust-project
node identity_preview.js
node ia_preview.js
node nt_badge_preview.js light  # v1.4.3 通知页：职位气泡 + OCR 标记 + 原始消息发送者（真实云端数据，浅色）

# 暗色模式回归：先在模拟器底部工具栏切「深色」，再跑
node theme_preview.js dark
# 浅色回归：切「浅色」后
node theme_preview.js light
```

说明：身份预览使用真实云端 `class_verify`（只读校验，不写数据库），会清空开发者工具模拟器 storage 后重新验证；截图落在 `_shots/`。
`theme_preview.js` 同样会清空模拟器 storage 并重新验证身份（只读 RPC），用于对比两套主题下的页面截图。



# mp-class-tools-tests/README 追加片段

## 微信 AI 开发模式适配测试（v21 / 1.5.0，2026-11-05）

被测对象：`mp-class-tools/ai/**`（8 SKILL / 60 原子接口 / 19 原子卡片）+ `agent/**` + 主包页面接力。
全部测试不访问真实云端写入、不发送订阅消息、不上传/发布小程序。

| 文件 | 作用 | 复跑 |
| --- | --- | --- |
| `_ai_harness.js` | Node 测试基座：mock `wx`（内存 storage / request 路由与请求断言 / 禁用 API 检测）+ `wx.modelContext` mock + `loadSkill` + 断言库 | 由各测试 require |
| `ai_contract_test.js` | 静态契约：app.json agent/subPackages、8 技能三件套、大小上限、apis↔文件↔注册一致、组件四件套与 `getContext/getViewContext/setRelatedPage`、relatedPage×page-meta、outputSchema page-link、confirmed、禁用 API、require 不越出 `ai/`、老回归文件 | `node ai_contract_test.js`（`--final` 严格模式） |
| `ai_unit_all.js` | 汇总运行 8 个 `ai_unit_<skill>.js`（子进程隔离，缺文件 SKIP 不崩） | `node ai_unit_all.js` |
| `ai_unit_identity.js` / `ai_unit_account.js` / `ai_unit_homework.js` / `ai_unit_notice.js` / `ai_unit_timetable.js` / `ai_unit_roll.js` / `ai_unit_lottery.js` / `ai_unit_fitness.js` | 各技能原子接口单测：成功/空结果/参数错误/未认证/写请求体/confirmed 不写盘/handoff/数据 URI 安全 | `node ai_unit_<skill>.js` |
| `ai_eval_cases.json` + `ai_eval_check.js` | 评测用例（92 条，覆盖 60/60 接口；复杂 32.6%；negative 10；unregistered 4；time/location 标签）与检测脚本 | `node ai_eval_check.js --strict` |
| `ai_handoff_check.js` | 页面接力回归：开发者工具 automator 注入 `globalData.agentHandoffs` 后打开 hw/nt/tt/draw/group/sum/ft/roll/me/data/fb/committee/stats 等页，断言 query 生效、无阻塞弹层/白屏、0 console error；开发者工具不可用时退化静态断言 | 先 `cli.bat auto --project mp-class-tools --auto-port 9431 --trust-project`，再 `node ai_handoff_check.js` |
| `ai_toggle.py` | 发版开关：`--status / --on / --off` 修改 `mp-class-tools/app.json` 的 AI 配置，并在 `--off` 时向 `project.config.json` 的 `packOptions.ignore` 增补 ai/agent folder 排除项（`--on` 精确移除；两文件都备份到 `_backup_ai_toggle/`，不删不移动源码） | `python ai_toggle.py --off` / `--on` / `--status` |

**结果文件**（`_ai_task/qa/`）：`ai_contract_result.json`、`ai_unit_all_result.json`、`ai_eval_check_result.json`、`handoff_result.json`。

**已知环境限制**：本机 appid `wx3df9869d229b96c4` 未开通 AI 开发模式内测权限，开发者工具
`cli agent tool` 返回 `agent compile mode is disabled`；原子接口/组件运行时验证需先在
「微信公众平台 → 基础功能 → AI 能力」申请「开发模式」，再用「小程序 AI 编译」模式与评测插件验证。

---

## 代码质量修复测试（2026-11-05 晚，未发版）

被测对象：微信开发者工具「代码质量」面板（内置 11 条规则，基于本地编译产物静态分析）。
2026-11-05 18:54 扫描有 2 项未通过，本目录新增以下工具/测试复现与验收（规则口径详见 `CODE_QUALITY_NOTES.md`）：

| 文件 | 作用 | 复跑 |
| --- | --- | --- |
| `code_quality_check.js` | **离线复刻检查器**（零依赖 Node）：按 DevTools 规则算媒体总量（IMAGE_AND_AUDIO_LIMIT）、未使用组件（CONTAINS_UNUSED_COMPONENTS）、无依赖文件（CONTAINS_UNUSED_CODES，含 setting 放行语义）、包体；编译包文件清单尊重 `project.config.json` 的 `packOptions.ignore`。PASS/FAIL 汇总 + 退出码 | `node code_quality_check.js --project ../mp-class-tools [--json]` |
| `CODE_QUALITY_NOTES.md` | 规则逆向笔记：asar 中 qualityChecker/CodeDenpendencyQualityChecker 的实现、扩展名表/limit、`compiledPkg` 来源、`packOptions.ignore` 生效实验（关掉无依赖过滤：907,329 B → 549,039 B）与置信度 | — |
| `optimize_images.py` | PNG-8 调色板量化批量压缩（幂等）：`share/` 自动 12KB/张上限，其余 20KB；`--dry-run / --root / --colors / --max-kb / --quiet` | `python optimize_images.py [--dry-run]` |
| `make_share_images.py` | 分享卡片生成脚本（已接入 `save_optimized()`，重新生成不回涨） | `python make_share_images.py`（会重写桌面总览图） |
| `test_ai_toggle.py` | `ai_toggle.py` 全周期测试（%TEMP% 副本）：on/off 恢复、ignore 精确增删、幂等、部分状态、损坏 JSON 防御、真实项目零改动 | `python test_ai_toggle.py`（**78 PASS / 0 FAIL**） |

**修复结果（发版默认 off 态，真实项目）**：

- 图片+音频总量：243,708 B（238.00 KB）→ **108,978 B（106.42 KB）**（硬线 200 KB ✓，内部目标 ≤150 KB ✓）；
  `images/` 35 个 PNG 路径/尺寸不变，share 8 张仍 500×400、每张 ≤10.53 KB；
- 无使用组件：19 个 `ai/skills/*/components/*` → **0**。时序：18:54 扫描时 AI 开发模式仍开启（19:28 才 `--off`），
  官方检查器不遍历 `Agent` 模块（原子组件只由 `mcp.json` 的 `_meta.ui.componentPath` 声明）→ 19 个全报；
  `ai_toggle.py --off` 另把 `ai/`、`agent/` 写入 `project.config.json` 的 `packOptions.ignore`，
  所有编译模式（含上传 prod）都不再包含 AI 源码；源码保留、`--on` 可恢复。
- 开发者工具 `cli.bat auto-preview` 编译通过：**TOTAL 532,652 B**（原 667,382 B，-134,730 B = 图片压缩量）；
- 回归：`node unit.js` 147/147、`node sync_contract_test.js` 29/29、`python staticcheck.py` exit 0、
  `python test_ai_toggle.py` 78/78；
- 最终确认：微信开发者工具「代码质量 → 重新扫描」预期两项均「已通过」（离线复刻同口径 PASS）。
- 独立验收（第二个验收者）：`_verify/VERIFY_REPORT.md` —— 8 个独立脚本复核 PASS：媒体 108,978 B 独立复算一致、
  35 张 PNG chunk CRC/Pillow/ffmpeg 全过、尺寸与引用零变化、share PSNR 58–68 dB、配置只差 ignore 两条、
  真实 DevTools ignore 因果实验 907,329→549,039 B（-358,290 B）、AI-on 副本 ai_contract_test 99/99。

---

## 通知时间显示口径（2026-11-05，契约《通知时间显示与识别_契约_20261105》§2/§3，未发版）

被测对象：`mp-class-tools/utils/notice.js`（`fmtWhen` / `statusOf` 新 label / 报名优先 `signupStart·signupEnd` /
`absRelDates` / `anchorOf` / `whenInfo·whenOf` / `statOf·mostUrgent`）、`pages/nt/nt.js`（aiSummary / aiPoints /
aiSegments / 原文 quotes / 合并转发 / 原始消息弹层过相对日期替换；简报「最近截止」同口径）、
`pages/nt/nt.wxml`（状态 chip = `<时间> <动作>`；长期安排不重复 badge）、`pages/nt/nt.wxss`（长 label 换行）。

| 文件 | 覆盖 | 复跑 |
| --- | --- | --- |
| `notice_time_test.js`（**新增**，15 项） | 契约 §2.1 相对阈值（分钟后/小时后/天后/≥7 天绝对/已过绝对）；§2.2「明天 12:00」不再显示「今天」、报名优先三态（报名开始/报名截止/报名已截止）、延期 extended/extended_past、eventAt/eventAction、deadline 优先、长期安排 `长期安排 · label`、alert 例外、statOf/mostUrgent 主显示时间同口径；§3 `absRelDates` 词表（今天/今晚/明早/明天/后天/大后天/本周X/下周X/裸周X、保留「中午前/晚点名」、绝对日期与上周X/每周X 不动、无锚点原样、跨年推断、周一为一周起点）；`anchorOf` = 第一条带 time 的 item；页面静态断言（渲染层调用 absRelDates/anchorOf、简报复用 statusOf label、wxml chip/recur badge）；`openRaw` 功能断言（原始消息弹层按整卡锚点替换） | `node notice_time_test.js`（独立，写 `notice_time_result.json`）或 `node unit.js`（并入总表） |

**结果**：`node unit.js` **162/162**（原 147 + 本契约 15）、`node sync_contract_test.js` 29/29、
`python staticcheck.py` exit 0、`node ai_unit_notice.js` 32/32（AI 技能走 `ai/common/fmt.js` 的独立副本，口径未动）、
开发者工具 `cli.bat auto-preview`（`%TEMP%` 副本，仅编译不上传）编译通过 **TOTAL 536,107 B**（单主包，AI off）。
版本号未改（仍 2.0.0），未上传/发布。

**边界口径（与 board/QA 联调约定）**：只有 `signupStart` 无 `signupEnd` 时——未开始 → `… 报名开始`；
已开始 → 退回 deadline / eventAt / 无时间（不误判「报名已截止」，契约要求数据至少带 signupEnd）；
`下下周X` 不在契约规则内 → 原样保留（不输出「下11-09」）；`上周X` / `每周X` / `隔周五` → 原样；
「11月6日（周五）」括号内裸 `周五` 的替换方式在第三轮改为去重删括号，见下节。

**旧口径断言更新（只改口径，不删覆盖）**：
- `v2_unit_tests.js`「需求9：长期安排不判过期…」：`statusOf().label` 断言 `'长期安排'` → `'长期安排 · 每月前三周 周三 17:30'`；
- `v2_unit_tests.js`「需求12：通知页 override/hidden…」：`card.statusLabel` 同样改为 `'长期安排 · 每月前三周 周三 17:30'`。
- 其余旧断言无需改：`ai_unit_notice.js` 断言的是 `ai/common/fmt.js` 的独立口径（未在本轮范围），仍 32/32 PASS；
  `notify_ui_test.js` / `sync_contract_test.js` 不依赖状态 label 文案。

---

## 通知时间显示口径 · 第三轮（2026-11-06，契约 §0 第三轮补充，未发版）

对应 task-8（R3-T3 miniapp）。用户原话：「下午招聘会请准时到场还是没有修复日期问题，请再次检查所有通知是否符合，
同时时间动作应该尽量精简，药膳答题打卡活动报名下方请放置经ai精简后的内容，而原始消息应该都被放入按钮中」。

被测对象：`mp-class-tools/utils/notice.js`（新增 `conciseAction` 动作精简；`absRelDates` 按 §0.1 增强）、
`pages/nt/nt.js`（标题日期化、有 aiSummary 的卡不内联原文、简报/原始消息弹层标题日期化）。

| 文件 | 覆盖 | 复跑 |
| --- | --- | --- |
| `notice_time_test.js`（**20 项**，本轮 +5） | §0.2 chip 动作精简：`报送姓名截止→报送截止`、`集合点名→点名`、`活动开始→开始`、`签到开始/签到签退→签到`、`比赛开始→比赛`、`考试开始→考试`、`报名已截止→报名截止`、≤6 字截断，且 statusOf 显示层直接生效；§0.1 absRelDates 增强：裸日号 `N号/N日`（5号上午→11-05 上午、4号下午→11-04 下午、10号比赛；`42号同学`/`5号楼`/`学号42号` 不替换）、裸时段前缀（`下午招聘会`→11-05 下午…；每天/每周/长期/已有日期保留）、今早/明早/明晚、标题样例（`运动会观众明早8:50…`）、「今日校园」不替换、绝对日期+括号相对词去重（`11月6日（周五）`→`11月6日`、`11-03（10-30）`→`11-03`、`本周四（明天）`同一天合并）；§0.3 页面：有 aiSummary 的卡 `quotes=[]`、hasRaw/「原始消息」按钮必须显示、标题过 absRelDates、openRaw 含全部 3 条原文（原始+2 补充）并按整卡锚点日期化 + 弹层标题日期化 | `node notice_time_test.js` 或 `node unit.js`（并入总表） |

**结果**：`node unit.js` **191/191**（含本文件 20 项；同会话另有 v3 电费/诊断 24 项）、
`node sync_contract_test.js` **30/30**、`python staticcheck.py` exit 0。版本仍 2.0.0、未上传/发布。

**本轮更新的旧断言（notice_time_test.js，只改口径不删覆盖）**：
- `'13 小时后 报送姓名截止'` → `'13 小时后 报送截止'`（§0.2 精简）；
- `'11-10 18:00 报名已截止'` → `'11-10 18:00 报名截止'`（§0.2 不加「已」）；
- `'9 小时后 集合点名'` → `'9 小时后 点名'`；
- `whenInfo().action`：`'报送姓名截止'` → `'报送截止'`。

**与 web/board 的差异（联调提示）**：① 裸时段时间判定用「同一分句前 12 字内有日期」而非整句，
避免 `11-05 上午9点比赛，下午招聘会` 里「下午」因前一分句的日期而漏补；② 绝对日期+括号内相对词去重
**以绝对日期为准一律删括号**（含 `11月3日（上周五）` 这类不匹配括号 → `11月3日`），对应 R6 矛盾括号；
③ 「今早」→ `MM-DD 早`（归入早/晚词，不再留裸「今」）；④ 「今日校园」白名单只对 `今日`+`校园` 生效。
## 诊断 v2 + 课表登录 + 电费趋势 canvas 遮挡专项（2026-11-08，未发版）

对应 task-10（用户：① 电费趋势线覆盖宿舍选择框；② 诊断页设备诊断/AI 分析/自动修复/全员可见；③ 课表登录个人教务课表）。
只改 `mp-class-tools/pages/{power,diag,tt,index}`、`app.js`、`utils/{cloud,diag,store,tools}.js` 与测试；未改版本号（2.0.0）、AI off、未上传发布。
云契约 `C:\Users\Ko_Li\.openclaw\workspace\_diag_task\CONTRACT.md`。

| 文件 | 覆盖 | 复跑 |
| --- | --- | --- |
| `unit.js`（改） | 电费趋势 `#pwTrend` 的 `wx:if` 含 `!sheetOpen && !lowOpen`、关闭后重绘且不重复请求、覆盖层打开忽略触摸；诊断页去 admin 门禁/设备检查/agent 卡静态断言；课表登录入口/密码不落 storage/优先级 ttLocal 等静态+行为断言；`_hasLocalTt`/loadRemote 期望更新 | `node unit.js` → **257/0** |
| `v3_power_diag_tests.js`（改） | canvas 绘制→开弹层跳过→关闭恢复且请求计数不变；诊断/登录纯函数与 cloud 方法断言 | `node v3_power_diag_tests.js` → **60/0** |
| `sync_contract_test.js`（改） | UD v6 `tt.ttLocal` LWW/推送/拉取/清空/归一（与网页同字段；夹具未改） | `node sync_contract_test.js` → **33/0** |
| `power_canvas_overlay_preview.js`（新增） | automator：初始绘制/开宿舍弹层 canvas 移除/关后恢复 0 请求/低电面板/滚动后无残留（9 checks） | `cli.bat auto --auto-port 9420` 后 `node power_canvas_overlay_preview.js` |
| `diag_v2_preview.js`（新增） | automator：非管理员可见/18 行服务健康/设备 10 项/自动上报 payload 脱敏/agent+AI+修复渲染/15s 轮询（16 checks） | 同上 |
| `tt_login_preview.js`（新增） | automator：登录成功→我的课表、agent_offline、failed、清除回退；密码不落 storage（mocked RPC） | 同上 |
| `_lead_verify_20261108/lead_mp_verify.js`（Lead 实跑） | 真实只读云端：覆盖层打开截图无趋势线+关闭恢复、普通成员诊断页 5 组 18 行+设备 10 项+agent 在线+AI 6 条、个人课表优先/登录入口/清空回退；**13 PASS / 0 FAIL / 0 console error**，截图 7 张 | `$env:CLASS_TOKEN=<token>; node _lead_verify_20261108/lead_mp_verify.js` |

**实测**：`node unit.js` 257/0、`v3` 60/0、`sync` 33/0、`python staticcheck.py` exit 0、`node code_quality_check.js` 全通过；
Lead automator（真实只读云端）**13/0**，0 console error。**需用户上传发布后真机复核 canvas 同层差异**。

## 诊断 v2.1 自动化（2026-11-09，Lead 实跑 devtools）
- `diag_v21_preview.js`：**23 PASS / 0 FAIL / 0 console error**，截图 `_shots_diag_v21/`（01_collapsed/02_expanded/03_others_expanded/04_after_poll）。覆盖：无独立大卡、health_ids/checks 下挂、正常行无 AI、其它诊断收起、折叠行 31px、状态胶囊 running/fixed/⚙、点击展开 cause+建议+flow+关联修复、收起、10s 轮询自动 running→fixed、无横向溢出。
- 前置：`cli.bat auto --project mp-class-tools --port 9433 --auto-port 9420 --trust-project`。
- 已知 WXML 限制：嵌套数组 `.length`/`wx:for` 在部分基础库不可靠 → `utils/diag.js` 预渲染 `suggestionsText`/`flowText` 字符串，`unit.js` 静态断言已同步（259/0）。

## task-7 专项（2026-11-11，反馈第 2/6/8/9/11 条；源码就绪，待用户上传发布）

对应 task-7：**9 加载与缓存提速 / 11 新通知提醒修复 / 6 水量共享 / 8 名单快捷预设 / 2 徽章去重**。
只改 `mp-class-tools/**` 与 `mp-class-tools-tests/**`（含 cloudfunctions/notify 源码）；**不动 web 仓库 / 云端 DDL / 安卓；
未上传发布，VERSION 仍 2.0.0、UD v6 契约不变、无新增外部请求来源、未打印 token**。
契约：`web/tools/tests/_water_shared_contract.md`（水量）、`mp-class-tools/README.md §九·补`（提醒部署配置）。

| 文件 | 覆盖 | 复跑 |
| --- | --- | --- |
| `task7_unit_tests.js`（**新增**，23 项） | **A 缓存**：diffPatch 只变化字段 / marksFresh 首屏去重 / marksPull 单飞（并发 1 请求、顺序 force 仍拉）/ 首屏缓存 0 等待 + 二次 refresh 0 setData / waterList 60s TTL；**B 提醒**：cloudfunctions/notify/scan.js 签名/首跑基线/新增 id 检测/隐藏排除/编辑不发送/文案截断/诊断脱敏（无 token）/shouldScan 门控/tokenHealthy；templateIds 默认 1 个、classify 可读原因、ask 请求数组、subscribeNotice 带 tmplId、status/diag/bootstrap 不外泄 token；云函数接线静态（timer→扫描/bootstrap/ntStatus/scan/NOTIFY_TMPL2/NOTICE_SCAN_Q/无 token 打印）；nt 页反馈/可再次开启/active 数/诊断页心跳+lastError；**C 水量**：23A/23B 固定 4、mergeCloud 云端覆盖+本地补传、pending 队列归一/覆盖/清理、water* PostgREST 口径（GET/POST/DELETE/Prefer/on_conflict）、页面 23A 锁定/云端合并/离线保存 pending/恢复清空/文案无「免费」；**D 预设**：roster 全班/班委/团员集合、leaguePull 请求/6h 缓存/失败保留、roster-picker 组件预设行为+confirm 座号数组、投票指定成员预设；**E 徽章**：showBadge 去重、班委页渲染（职务保留/badge 空）、工具描述同步、me/data 去重 | `node task7_unit_tests.js`（独立运行写 `task7_unit_result.json`）或 `node unit.js`（末尾已挂载，总断言 414→**437**） |
| `cache_speed_bench.js`（**新增**，基准） | 需求 9「改造前 vs 改造后」：同一冷启动剧本（首次启动 / 二次冷启动保留 storage / 页面重入）分别跑 `_baseline_cache_20261111` 快照与当前源码；统计请求数/按表分布、首屏 state=data 时间、页面重入 setData 次数与字节；3 项断言全绿，结果写 `_perf_cache_v2_result.json` | `node cache_speed_bench.js` |
| `task7_preview.js`（**新增**，automator 34 项） | devtools（mock 身份 + wx.request/wx.cloud/requestSubscribeMessage 内存 mock，**不发真实请求/不写云表**）：**A** 有缓存工作台首帧 data（无骨架）/请求 0–1/首屏 217–284ms/重入 diff 381B/无缓存对照；**B** 授权成功 toast「已开启 · 收到后自动关闭」/云端 3 人已订阅/再次开启（subLog=2）/拒绝提示/云函数未部署提示；**C** 23A 固定 4/云端合并 111.00/定额文案/同步状态/改 6 被拒/离线 pending put/恢复清空；**D** 抽签名单组件全班 4/班委 3/团员 2、预设后仍可增删、投票指定成员班委 [1,2,3]/团员 [2,4]；**E** 班委页职务保留+badge 空+工具描述；**F** 诊断页心跳「2 分钟前」/active 3/新通知 lastError；**G** 0 console error + 9 张截图 | 先 `cli.bat auto --project mp-class-tools --auto-port 9424 --trust-project`，再 `node task7_preview.js`（`WS` 可覆盖，如 ws://127.0.0.1:9424） |
| `unit.js`（改） | 末尾 require `task7_unit_tests.js`（414 → **437** 断言） | `node unit.js` |
| `water_unit_tests.js`（改） | 按共享契约更新：人数文案只留「4 人间/6 人间」（去掉每月免费 N 吨水）、水量页接云端共享（页面断言）、23A/23B 固定 4 人间（13 号楼场景测 4/6 切换） | `node water_unit_tests.js` / `node unit.js` |
| `notify_ui_test.js`（改） | 简报区新通知提醒：授权 toast 文案/请求模板数组/再次开启/状态显示（不再「已订阅直接 return」）；nt.wxml 按钮/状态断言更新 | `node notify_ui_test.js` / `node unit.js` |
| `cloudfunctions/notify_fix_20261110.test.js`（改） | timer 返回结构新增 `scan` 字段（新通知扫描结果），既有字段不变 | `node cloudfunctions/notify_fix_20261110.test.js` |
| `sync_contract_test.js`（改） | 既有偶发失败稳定化：C 步与 B 步 push 可能落在同一毫秒（LWW 同 at 云端赢 → 幂等跳过），加 `sleep(2)` 保证 at.tt 严格递增；连续 8 次实跑 33/0 | `node sync_contract_test.js` |
| `_baseline_cache_20261111/`（**新增快照**） | 改造前小程序源码快照（不含 node_modules / `_backup`），仅供 `cache_speed_bench.js` 对照；**不是发布产物** | 无需运行 |

**实测（本机，2026-11-11）**：`node unit.js` **437/0**；`node task7_unit_tests.js` **23/0**；`node sync_contract_test.js` **33/0**（连跑 8 次稳定）；
`python staticcheck.py` **exit 0（26 页）**；`node code_quality_check.js` **全部规则通过**；`node cloudfunctions/notify.test.js` **35/0**；
`node cloudfunctions/notify_fix_20261110.test.js` **18/0**；`node cache_speed_bench.js` **3/3**（`_perf_cache_v2_result.json`）；
`node task7_preview.js` automator **34/0，0 console error**，截图 `_shots_task7/`（9 张）。

**需用户执行（不代做）**：① 微信开发者工具上传 `cloudfunctions/notify`（含 scan.js/rest-config.js）+ 右键 config.json「上传触发器」；
② 云开发数据库建 `notify_cfg` 集合（仅云函数可读写）；③（可选）云函数环境变量 `NOTIFY_TMPL2` 第二模板；
④ 上传发布小程序后在真机点「新通知提醒」→ 网页端发一条新通知 → 5 分钟内收到；诊断页确认心跳/lastError；
⑤ 真机验水量共享（同宿舍两台设备/两个账号看到同一条记录）与 23A/23B 固定四人间。
**自动化未发真实订阅消息、未写真实云表。**
