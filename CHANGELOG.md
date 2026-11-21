# 版本记录

## 投票入口仅班委可见（2026-11-21，源码就绪；待用户上传发布；VERSION 仍 2.0.0）

> 用户要求：小程序端投票工具只在班委前显示；普通同学与测试账号完全隐藏入口，只保留收到投票时的弹窗/点击投票分享卡片时的正常进入；其他端功能保持不变。

- **`utils/identity.js`**：新增统一口径 `isCommitteeOf/isCommittee`（role 非空或 badge 含「班委」，与服务端 `auth_is_committee()` 一致）、`isTestSid/isTest`（官方测试身份 `3260799999` + 9999 段 QA 身份，与统计/抽签存证同口径）、`canUseVote`（仅非测试班委可见）。
- **`utils/tools.js`**：`entryAllowed` 对 `vote` 应用 `canUseVote`，并贯穿 `homeEligible` / `normalizeHome` / `homeTools` / `quickList` / `catalog`。工具页「全部工具」、工作台首页快捷、首页勾选（历史已勾选的 vote 会被过滤，不占 4 个名额）均不再出现投票入口；其它工具与顺序不变。
- **`pages/ug/ug.js`**：使用说明的「投票」卡跟随同一口径隐藏（普通同学/测试账号不展示无法使用的功能说明），卡片索引/总览/上下张/AI 接力均按过滤后的列表工作。
- **未改 `pages/votedetail`**：详情页不加入口门禁，收到投票或点击投票分享卡片仍按原路径正常进入、查看与投票；`pages/vote` 的编辑深链也未改，避免影响历史投票管理。
- **测试**：`vote_unit_tests.js` **40/0**（新增 VOTE-E1：班委/普通/官方测试/9999 QA/is_test 口径、目录/首页/使用说明隐藏、详情分享不受影响）；`tool_sort_unit.js` **21/0**（同步补上既有 `map` 工具的顺序夹具）；`unit.js` **632 passed / 2 failed**（2 项为既有时间依赖失败：期次§1.3、发布§5，与本次无关）。未改 VERSION / UD v6 / 云端契约，未上传发布。

## 电费「上次充值」跨区间并显示充值量（2026-11-21，源码就绪；待用户上传发布；VERSION 仍 2.0.0）

> 用户要求：修复电费「上次充值」只在选择区间内查找的问题，并改为显示上次的充值量；五端同步。

- **`utils/power.js`**：新增 `lastRecharge(points)`（按 t 升序取最后一次 `Δq>0.05`，返回 `{t,reset,delta}`）；`slowStats.lastRecharge` 补 `delta`；`tilesOf` 新增跨区间参数，值显示 `+delta` 度（充值量），不再显示充值后余额；无记录仍「—/暂无记录」。
- **`pages/power/power.js`**：所有房间恒拉 30d 历史（云端仅保留 30 天），实时房 `power.lastRecharge(hist30)`、慢频房 `estimateSlow.lastRecharge`；切 24h/7d/30d 值不变；30d 缺失回退区间 `lastUp`。
- **测试**：`node tests/v3_power_diag_tests.js` **67/0**；`node tests/unit.js` 627/6（6 项为其他会话/时间相关的既有失败，电费无失败）。
- **待办**：需用户在微信开发者工具上传发布后生效。

## 全工具分享 + 导出图片改分享 + 分享信息增强（2026-11-20，源码就绪；待用户上传发布；VERSION 仍 2.0.0）

> 用户原话：「在适合的工具处都添加分享，原先导出图片的地方也替换为分享，并且注意分享的卡片和图片应该有足够的信息，我目前发现通知的分享和投票的分享信息量都不足」。

- **统一分享弹层**：新增 `components/share-sheet`（bottom-sheet 内「微信卡片封面 / 分享长图」双预览 + 「图片分享 / 微信卡片分享」两个选项）与 `utils/shareflow.js`（安装数据/方法、并行生成卡片与长图、canvas 串行队列、`showShareImageMenu` 相册兜底）。页面接入只需 `Page(shareflow.install({ ... _shareOpenOpts() ... }))` + 一行组件 + `#shareCanvas`。
- **导出图片 → 分享**：抽签、分组、结果单、作业、体测、课表 6 处底栏「导出图片」全部替换为「分享」；图片分享复用原完整导出长图（`canvas.exportCard`），微信卡片改用新增 5:4 信息卡。原 `exportImg()` 方法保留以兼容旧测试/隐藏入口，但页面不再暴露。
- **新增可见分享**：通知每张卡片（保留）、投票列表（点击先拉 `poll_detail` 再生成）、投票详情、名单、国标评分表、点名统计。点名分享卡只含「已到/请假/未点」统计，不含姓名学号。电费/水量/统计等隐私或仅管理员页面不新增内容分享。
- **信息增强**：
  - 通知：卡片增加发布者/时间/地点/截止/附件图片数量；图片分享改为完整长图（标题、来源/发布者/附件、AI 摘要、要点、关键信息、原文摘录、内容组成）。
  - 投票：卡片增加发起人、时限、说明、规则标签、4 个选项；图片分享为完整长图（说明 + 全部选项）；仍**不画百分比/票数/总票数**，结果只能点开小程序查看。
  - 通用信息卡：分组/结果单/作业/体测/课表/名单/国标评分表，含最多 3 个统计块 + 6 行明细 + 备注。
- **测试**：`share_legal_unit.js` **22/22**（B2/B4/B5/B6/D1–D10：视图、无结果、画布文本、六页接线、统一弹层、名单/国标/点名、投票列表先取详情）；`nt_share_check.js` automator **17/17**（真实测试身份；5:4 卡片 ~68KB + 完整长图 ~240KB + 微信卡片 title/path/imageUrl + 0 console error）；`unit.js` **621 passed / 7 failed**（7 项为既有失败：合规域名 / ko-link / draw×3 / 期次 / 发布）；`staticcheck.py` handlers / 分享 handler 0 缺失；`code_quality_check.js` 全部通过。
- **未做**：未上传/发布；未改 VERSION（2.0.0）/ UD v6 / 云端契约。

## 通知卡片分享（预览图 + 图片 / 微信卡片）+ 投票卡片不预览结果（2026-11-20，源码就绪；待用户上传发布；VERSION 仍 2.0.0）

> 用户原话：「微信小程序端的通知工具的卡片设为可支持分享，点击分享后弹出预览图和选项选择以图片分享还是微信卡片分享，同时投票功能的微信卡片分享不应该可以直接预览投票结果」。

- **通知卡片分享**（`pages/nt`）：卡片底栏新增「分享」。点击打开 bottom-sheet，先展示 5:4 预览图，再选两种方式：
  - 「图片分享」→ `wx.showShareImageMenu`（发送给朋友 / 保存到相册）；旧基础库或低版本微信降级 `wx.saveImageToPhotosAlbum`，拒绝相册权限时弹「去设置」。
  - 「微信卡片分享」→ 原生 `button open-type="share"`；title=`班级通知｜<标题>`、path=`/pages/nt/nt?gid=<id>`、imageUrl=本次 canvas 预览图；右上角菜单仍按页面级分享。
- **通知分享图**（`utils/sharecard.js`）：新增 `buildNoticeView` / `drawNotice`，只画标题 / 分类 / 状态 / AI 摘要 / 最多 2 条要点 / 来源 / 时间；不含附件、图片、学号、收件人。按卡片缓存（signature 去时间），失败回退 `images/share/nt.png` 且图片分享禁用；`render()` 加 2.5s 超时兜底，避免弹层卡在「生成中」。
- **投票分享卡收紧**：`buildVoteView` 不再输出 pct/count/total，`drawVote` 不再画结果条 / 百分比 / 票数，固定提示「结果请打开投票页查看」；`votedetail` 分享按钮旁提示改为「分享卡片不显示结果，点开卡片进入投票」。结果只能点开小程序查看，不能通过聊天里的卡片封面直接预览。
- **测试**：`share_legal_unit.js` B2/B4/B5/D6/D7（**18/18**）；新增 `nt_share_check.js` automator 回归 **17/17**（真实测试身份 3260799999，注入固定卡片，验证弹层/预览图临时文件约 66KB/两个选项/卡片按钮整行/分享 title+path+imageUrl/关闭复位/0 console error；截图 `_shots/nt_share/share_sheet.png`、`vote_card.png`）；`unit.js` **617 passed / 7 failed**（7 项为既有失败：合规域名/ko-link/draw×3/期次/发布，与本次无关）；`staticcheck.py` handlers / 分享 handler 0 缺失；`code_quality_check.js` 全部通过。
- **未做**：未上传/发布；未改 VERSION（2.0.0）/ UD v6 / 云端契约。

## 页面加载性能：PPT 三页合并单分包 + utils/ppt.js 移出主包 + 去掉工具页预下载 + 外观 onShow 去重（2026-11-19，源码就绪；待用户上传发布；VERSION 仍 2.0.0）

> 用户原话：「微信小程序的各个页面加载速率严重变慢了，同时主包内存在未使用的 js 文件 ppt.js」。

- **根因核查**：`utils/ppt.js`（74.2KB）只被 `pages/ppt`、`pages/pptdl`、`pages/pptplay` 三个页面 `require`，
  主包页面 0 引用；但它留在主包、三个 PPT 页面又各自是独立分包，所以不能直接删除。同时 `pages/all` 的
  `preloadRule` 在 WiFi 下会后台下载上述 3 个 PPT 分包（编译体积约 90KB），与工具页/后续页面首屏请求抢带宽。
- **PPT 单分包**：`pages/pptdl/*`、`pages/pptplay/*` 并入 `pages/ppt` 分包，`utils/ppt.js` 移到
  `pages/ppt/utils/ppt.js`；路由改为 `/pages/ppt/pptdl/pptdl`、`/pages/ppt/pptplay/pptplay`（列表页 `/pages/ppt/ppt`
  不变）。`app.json` 由 3 个 PPT 分包合并为 1 个，其余 diag/cloudspace/screencast/map 分包不变。
- **去掉预下载**：删除 `preloadRule`；打开工具页不再下载 PPT 分包，首次打开演示页才下载（122,076 B）。
- **外观 onShow 去重**（`utils/appearance.js`）：每次 onShow 只读一次 storage；主题未变不 `setData`；
  同一页面实例 + 同一主题只应用一次原生外壳（导航栏/窗口/下拉/tabBar 4 次桥调用 → 0；非 tab 页不再调用
  注定失败的 `setTabBarStyle`）。`utils/share.js` 同一页面实例只 `showShareMenu` 一次。
- **法律正文页**（`pages/legal`）：`setData` 不再把 `doc`（内含 blocks/toc）+ `blocks` + `toc` 三份正文
  传给渲染层，改为 `head + blocks + toc` 一份；`doc` 只保留在 JS 内取标题/导航栏标题。
- **实测**：devtools automator（官方测试身份）非 tab 页 onShow 原生 API 4 → 3；连续切 tab 9 次 36 → 12 次；
  主包编译体积 **1,041,453 → 1,010,114 B（−31,339 B，−3.0%）**；`unit.js 613/7`（7 项既有 ko-link/时间依赖失败，与本次无关）、
  `staticcheck.py` 0、`code_quality_check.js` 0；PPT 三条新路由冒烟通过。
- **未做**：未上传/发布；VERSION 仍 2.0.0、UD v6/云端表不变。回滚：恢复 `pages/pptdl`、`pages/pptplay`、
  `utils/ppt.js` 与旧 `app.json`（含 `preloadRule`），并还原 `utils/appearance.js`/`utils/share.js`。

## 微信通知提醒改用「日程提醒（基础信息）」模板（2026-11-19，源码就绪；云函数待用户上传；小程序待用户发布；VERSION 仍 2.0.0）

> 用户原话：「微信通知提醒改用基础信息」+ 模板信息：模版 ID `ZqIur9lMTUTrbKeTXzirEEtHosvLFm-7sULeBjmyMjk`、
> 模版编号 9109、标题「日程提醒」、类目「办公」、详细内容「日程 `thing1` / 时间 `time2` / 地点 `thing3` / 日程描述 `thing5`」。

- **云端 `cloudfunctions/notify`**：默认模板改为新模板；新增 `LEGACY_TEMPLATE_ID`（旧「温馨提示」模板）兼容旧客户端——
  订阅行没有 `tmplId` = 旧客户端，继续按旧模板/旧字段发送；新客户端订阅时写入 `tmplId`，发送按新模板字段。
  **云函数可以先上线、小程序后发布，旧客户端提醒不中断。**
- **新模板字段映射**：`thing1` 日程 = 通知标题/作业摘要（`summary`，≤20 字）；`time2` 时间 = 活动/截止时间
  （`dateText`，缺省回退提醒时间 `timeText`、再回退 `fmt(fireAt)`；支持中文 / ISO / 纯日期 / 无年份中文格式，统一成
  `YYYY年M月D日 HH:mm`）；`thing3` 地点 = 通知「地点」段落（`aiSegments`，缺省「班级工具」）；`thing5` 日程描述 =
  提醒类型（`tip`：作业截止提醒 / 通知提醒 / 新通知，≤20 字）。
- **小程序**：`utils/notify.js` 的 `TEMPLATE_ID` 改为新模板；作业/通知订阅均携带 `tmplId`；通知订阅从 `aiSegments`
  提取「地点」并携带 `place`；新增 `placeOf()`；`pages/nt/nt.js` 把 `aiSegments` 传入订阅函数。未改 VERSION / UD v6。
- **上线顺序（重要）**：① 先上传云函数 `notify`（双模板兼容代码）→ 旧客户端继续按旧模板送达；② 再上传/发布新版小程序
  → 新设置的提醒走新模板；③ 切换前已存在的 active 提醒仍按旧模板发送（微信授权绑定旧模板），发送/过期后自然清空；
  ④ 等新版全覆盖后再删 `LEGACY_TEMPLATE_ID` 分支（本次保留）。
- **测试**：`cloudfunctions/notify.test.js` **40/0**（新增新模板字段映射/时间格式回退/地点回退/旧模板兼容/订阅 tmplId+place）、
  `notify_ui_test.js` **28/0**（新增地点段落 → place、payload 带 tmplId）、`notify_fix_20261110.test.js` **18/0**、
  `task7_unit_tests.js` **24/0**；`unit.js` **594 passed / 7 failed**（7 条为既有失败：合规域名/ko-link/期次/发布，不属于本次）；
  `staticcheck.py` exit 0、`code_quality_check.js` exit 0。自动化未发送真实订阅消息。
- **未做**：未上传云函数、未上传/发布小程序；未改 `VERSION`（仍 2.0.0）/ UD v6 契约 / 云端表结构。

## 名单左右滑动切分类 + 团员计数常显（2026-11-19，源码就绪；待用户上传发布；VERSION 仍 2.0.0）

> 用户原话：「增加名单的滑动切换功能和对应动效，修复团员名单在为打开时不显示数字的问题」。

- **滑动切分类**（`pages/committee/*` + `utils/roster.js`）：与课表页（`pages/tt`）同一套动效参数——横向锁定 12px / |dx|>|dy|×1.35、1:1 跟手、提交阈值 56px、边界 0.28 橡皮筋、滑动后 320ms 吞点击；提交流程为「旧内容飞出（±W, opacity .25, .16s）150ms → 换分类 → 新内容从另一侧进场 → 20ms 后 .23s cubic-bezier(.22,.8,.3,1) 弹回」。手势容器 `.rd-swipe` 只包名单内容（含空态/加载态），不包顶部 tab 头，纵向手势不 `preventDefault`。新增 `roster.TAB_KEYS/tabIndex/tabKeyOf/tabNeighbor/tabIndicator` 纯逻辑；`_swClear()` 在 onHide/onUnload 统一清定时器。
- **liquid 指示条**：三个 tab 的选中底色改由 `.rd-ind` 滑块承担（`left/width` 由 `tabIndicator()` 的百分比驱动，`.32s cubic-bezier(.3,.9,.32,1)` 过渡），tab 只负责文字/数字配色。
- **团员计数常显（bug 修复）**：`listView().counts.leagueText` 未加载时原为 `''` → 改为 `'0'`，新增 `counts.loading`（`league: !loaded`）；加载中数字照常显示、仅 1.1s opacity 脉冲。**注意**：占位不能用 `color:transparent`+`background:currentColor`（截图实测数字会一起消失）。
- **测试**：`committee_unit_tests.js` **10/10**（新增滑动纯逻辑 + 页面手势接线两组）；`committee_swipe_preview.js` **22/22**（automator 真实渲染，含跟手位移/飞出/进场/指示条百分比/边界阻尼/右滑回退/点击 tab/0 console error）；全量 `unit.js` **593 passed / 7 failed**（7 项为既有失败，与本次无关）；`staticcheck.py` handlers 0 缺失；`code_quality_check.js` 退出 0。
- **未做**：未上传/发布；未改 VERSION、UD v6 契约、云端表结构。

## 水量图标重绘：实心绿水滴 → 白色线性水滴（2026-11-19，源码就绪；待用户上传发布；VERSION 仍 2.0.0）

> 用户原话：「优化微信小程序水量图标」。

- **问题**：`images/tool-water.png` 是 40×40 实心不透明绿水滴（665 B），而工具图标要放在主色 `--md-primary`（#4E9082）圆 chip 上显示才可见——同色叠加后只剩一个几乎看不见的小点（截图中与同批白色线性图标 `tool-hw`/`tool-draw`/`tool-nt` 观感完全不同），且 40px 源图被拉伸到 40/48rpx 显示发虚。
- **修复**：按同批线性图标实测规格重绘——96×96 画布、字形留白与字面尺寸对齐同批（约 54–62px 字宽）、白色描边 ~2.3px 线宽、透明底 PNG-8；8× 超采样生成抗锯齿，输出 P 模式 2 色索引图标（309 B，比原图更小）。仅替换位图，`utils/tools.js` 的 `ico: '💧'`（使用说明页 emoji，非图片）与页面结构未动。
- **验证**：在 72rpx chip、40/48rpx 两种显示尺寸与 color chip 底色合成后逐像素比对，与同批线性图标线宽/视觉重量一致；`node unit.js` **588 passed / 7 failed**（7 项与改动前基线完全一致：合规域名/ko-link/draw/期次/发布，本次不涉及）；`node code_quality_check.js` 全部规则通过（exit 0）；`images/` 媒体总量 116,027 B（预算 200 KB）。

## 统计排序改为「访问次数优先」（2026-11-18，源码就绪；待用户上传发布；VERSION 仍 2.0.0）

> 用户原话：「把排序设成访问次数排序优先，访问次数相同时按访问时间排序」。与网页/安卓/Windows 同口径。

- `pages/stats/stats.js`：账号排序改为 `count` 降序 → `lastTs` 降序；页面说明/标题同步「按访问次数排序（次数相同按最近访问）」。
- `utils/tools.js`、`agent/page-meta.json`、`ai/.../mcp.json` 描述同步；AI `getVisitStats` 排序改为 `visits` 降序 → `lastTs` 降序，文案「访问最多的是」。
- 测试：`unit.js` 统计页新增「次数优先/同次数按最近访问」断言；`ai_unit_account.js` 同步；全量 `588 passed / 7 failed`（7 项为并行会话既有失败：合规域名/ko-link/draw/期次/发布，不属于本次）；`staticcheck.py`/`code_quality_check.js` 通过。

## 访问统计：按最新登录排序 + 分钟时间 + 登录端 + 忽略测试账号（2026-11-18，源码就绪；待用户上传发布；VERSION 仍 2.0.0）

> 用户原话：「将所有端的统计工具统一更新为按最新登录顺序排序，默认打开为今天，时间精确到分钟，记录具体登录端，忽略测试账号」。唯一契约 `web/统计多端_最新登录_契约_20261118.md`。

- `utils/cloud.js`：`visitLog` 行增 `client:"mp"`，`id=sid|slot|mp`，去重键改为 `zq_visit_slot_<sid>_mp`（同机切号不再漏记）；`statsPull` 取 `id,slot,sid,name,ts,client`、`order=ts.desc&limit=5000`。
- `pages/stats`：默认 `range:'today'` 且 `onShow` 归位；按账号 `max(ts)` 倒序；`MM/DD HH:mm`；显示最近登录端（网页/小程序/安卓/Windows/鸿蒙/未记录）；过滤 `3260799999` 与 9999 段 10 位测试身份、匿名行；摘要/按天/按小时同口径。
- `ai/skills/account/apis/getVisitStats.js` + `mcp.json`：同口径（最近登录排序、`lastClient`、过滤测试账号；不返回学号/设备号）。
- **测试**：`node unit.js` **597/0**、`node ai_unit_account.js` **41/0**、`python staticcheck.py` exit 0、`node code_quality_check.js` 退出码 0；`stats_preview.js` 增加默认今天/client 字段断言。
- **未做**：未上传/发布；未改 VERSION / UD v6 / 云端表结构（`visits.client` 迁移见 web 仓库）。

## 移除「新通知提醒」+ 手动提醒改以活动报名开始为基准（2026-11-18，源码就绪；待用户上传发布；VERSION 仍 2.0.0）

> 用户原话：「移除微信新通知提醒功能，另外我发现手动设置提醒不是以活动报名开始时间为基准而是以截止为基准」。

- **移除「新通知提醒」客户端功能**：删除通知页简报区按钮/云端 active 状态/授权反馈、工作台「新通知」角标、
  `utils/notify.js` 的 `subscribeNotice/publishNotice/status/bootstrap/clearStatusCache`、`app.js` 的 bootstrap 调用、
  `utils/cloud.js` 的 `newNtAt` 写入、`utils/store.js` 的 `newNtAt` 字段、诊断页「新通知扫描」行；
  `ntSub/ntSubAt` 仍保留在 userdata v6 prefs 里做旧数据兼容，但新版不再读写/展示。
  云函数 `notify` 的 `kind='nt'` / `publishNotice` / `bootstrap` / `ntStatus` **保留**，仅服务已发布的旧版客户端。
- **手动提醒基准修正**：新增 `remindBaseOf(raw)`——活动有未开始的 `signupStart` → 以**报名开始**为基准；
  报名开始已过/无报名窗口 → 回退截止；快捷项变为「报名开始前 1 天 / 2 小时 / 30 分钟 / 报名开始时」，
  自定义默认「报名开始前 2 小时」、提示显示「报名开始 …」；`subscribeNoticeReminder` 新增 `baseTs`，
  订阅消息模板的日期显示报名开始而不是截止。作业/单条通知提醒链路不变。
- **测试**：`unit.js` **571/7**（7 条均为既有失败：quickList/toolOrder、长期安排时间、ko-link 旧断言、抽签核验链接、期次时间依赖）；
  新增「快捷项以报名开始为基准」「自定义默认按报名开始」「新通知提醒已移除」用例；`notify_ui_test`/`task7_unit_tests`/`task7_preview` 同步更新；
  `staticcheck.py` / `code_quality_check.js` 退出 0。
- **本机验证**：devtools 通知页无「新通知提醒」按钮/状态；构造 `signupStart=+3d` 的活动，快捷项为报名开始前 1 天/2 小时/30 分钟/报名开始时；
  `subscribeNoticeReminder` 的 `dateText=报名开始时间`。
- **未做**：未上传/发布小程序；未改云函数（旧客户端兼容）；未改 VERSION / UD v6 契约。
## 身份名/通知缓存乱码防护 + 水费副标 `undefined` 修复（2026-11-18，源码就绪；待用户上传发布；VERSION 仍 2.0.0）

> 用户反馈「微信小程序出现了很多异常字符」。排查结论：**正常登录链路（class_verify → identity.save → storage）中文名正确**；
> 复现到的乱码来自本机 `zq_class_identity.name` 被写成替换字符 `U+FFFD`（`�����˺�`），
> 首页问候 / 作业昵称 / 数据页同步文案 / 导出图都共用这个字段，所以看起来「一片乱码」。
> 典型来源是自动化脚本/旧链路把中文按非 UTF-8 注入 storage；真实用户若本机旧缓存被污染也会命中。

- **`utils/identity.js`**：`normalize()` 检测姓名中的 `U+FFFD` / `锟斤拷` / `ï¿½` / `Ã.` / `â€` / `ðŸ` → 判身份无效并清空，页面回身份页重新验证，不再继续渲染乱码。
- **`utils/cloud.js`**：`ntLoad()` / `ntSnapGet()` 增加 `ntTextCorrupt()` 自愈——分块缓存或 `zq_nt_snap_v1_<sid>` 快照若含乱码，直接丢弃并重新拉取，避免通知标题/正文整片显示 `�`。
- **`pages/water/water.js`**：折合扣电副标误用 `rulesP.elecPrice`（ruleView 已移除该字段）→ 显示「水费 ÷ undefined」；改 `water.RULES.elec.toFixed(2)`，现显示「水费 ÷ 0.58」。
- **测试**：新增 `identity_encoding_unit.js` **3/0**（U+FFFD/典型 mojibake 拒绝、正常中文保留）；`water_unit_tests.js` 新增副标断言；`unit.js` **569/7**（7 条均为既有：quickList/toolOrder、长期安排时间、ko-link 旧断言、抽签核验链接、期次时间依赖）；`staticcheck.py` exit 0。
- **本机验证**：devtools 测试身份重新 `identity.login` 后 `name` 码点 `27979,35797,36134,21495`（测试账号），首页/作业/数据/通知页零 `�`；`perf_notice_probe.js` 改为用 `String.fromCharCode(...)` 在端内构造中文名，避免自动化桥接再次写入乱码。
- **未做**：未上传/发布小程序；若用户真机仍显示乱码，需清除小程序缓存并重新验证身份（或提供截图/页面进一步定位）。

## 通知「发布时间」统一：无时间锚点通知 → 发布时间 / 动作「发布」/ 参与排序与统计（2026-11-18，源码就绪；待用户上传发布；VERSION 仍 2.0.0）

> 用户原话（2026-11-18 12:45）：「将通知中不含时间的时间设定为发布时间，动作设为发布，并参与排序等等统一计算」。
> 唯一契约 `web/通知三端_发布时间统一_契约_20261118.md`（数据字段 `publishedAt` / `publishAction` 已由数据管线生成，云端 body 已带）。
> 只改 `mp-class-tools/**` 与 `mp-class-tools-tests/**`；**未上传发布、VERSION 仍 2.0.0、UD v6 契约不变、无新增网络请求/依赖**。

- **`utils/notice.js`**：新增 `publishedTsOf(g, nowTs)`（优先 `publishedAt`，旧缓存回退 `pubTsOf`：items 最新消息时间 / updatedAt 较晚者）；
  `statusOf` 在最终 `none` 之前新增 `published` 分支（`{key:'published', label: fmtWhen(...)+' '+(publishAction||'发布'), cls:'active', expired:false}`，
  长期安排 / `expired:true` / 既有过期规则优先不变）；`longtermSubtypeOf` 的 info 判定加「有发布时间 → 不再归资料栏」；
  `listRankOf` 发布卡档 4，`mainListCompare` / `mainEntryCompare` 档 4 内按发布时间倒序（无发布时间最后，其余档位规则不变）；
  `statOf` 发布卡视为有时间锚点按 `actionable` 计入待处理（24h/7 天窗口仍只看主显示时间，发布卡不进未来窗口），
  `latestOf` 改用 `publishedTsOf`。
- **`pages/nt/nt.js`**：卡片 `pubTs` 改走 `publishedTsOf`（「最新发布」倒序）；简报 `_briefNextOf` 计入发布卡（主显示时间空 → 排最后，chip 文案「<时间> 发布」）。
- **`pages/index/index.js`**：工作台待办数走 `statOf`（自动含发布卡），轮换列表同步计入发布卡。
- **`pages/nt/nt.wxml`**：无需改动——资料栏原本就是 `wx:if="{{filter === 'all' && infoCount}}"`，发布卡移出后 0 条自动隐藏；
  仍保留「既无时间锚点又无发布时间」的兜底卡（正常数据 0 条）。
- **兼容**：旧缓存没有 `publishedAt` 时按组内 items 时间 / updatedAt 现场推算，不退回「无时间」；真实 board 104 组新增字段口径与旧缓存回退口径统计完全一致
  （pending 23 / urgent 9 / week 14 / expired 77 / longterm 2，资料栏 0 条；`publishAction` 9 组 + 1 组仅有 `signupStart` 且已开始的边界组按 statusOf 同口径显示「发布」）。
- **测试**：`notice_publish_unit.js`（新增）**8/0**；`unit.js` **569/7**（7 条均为本任务前既有失败：quickList/toolOrder、长期安排时间、ko-link 旧断言、抽签核验链接、期次时间依赖；
  改动前基线 561/7，现 +8 全过）；`notice_occ_unit.js` 8/1（既有期次时间依赖）、`notice_longterm_unit.js` 13/0、`notice_time_test.js` 20/0、
  `nt_attach_url_tests.js` 10/0、`sync_contract_test.js` 34/0、`staticcheck.py` / `code_quality_check.js` 退出 0。
- **未做**：未上传/发布小程序（需用户在微信开发者工具上传发布后生效）；未改版本号；安卓/网页按同一契约由各自会话处理，本轮未触碰。

## 通知弱网/无网兜底：单 key 快照 + 离线文案（2026-11-18，源码就绪；待用户上传发布；VERSION 仍 2.0.0）

> 用户反馈：微信小程序在弱网或无网时不显示之前加载好的通知。分块缓存（`utils/cache.js`）本身支持 SWR，但旧版本 14MB 整表会因超预算不落盘；分块索引损坏、配额淘汰或请求失败时页面可能只剩空态/「同步中」。

- **`utils/cloud.js`**：新增 `zq_nt_snap_v1_<sid>` 单 key 快照（≤900KB，超限只保留最近通知组），每次成功 `class_notices_meta` 后与分块缓存同时写入；`ntLoad()` 在分块缓存读不到时回退快照；首次无缓存且网络失败时也返回快照，不再直接返回 `[]`；`netState()` 增加 `cached/offline/lastOk/lastFail`。
- **`pages/nt/nt.js`**：已有卡片时刷新不再把 `syncText` 压成「同步中」；弱网/无网显示「离线 · 显示上次同步」/「缓存 · 上次同步」，不再误报「云端已同步」；请求异常时保留已有卡片，只更新状态文案。
- **`utils/cache.js`**：`clearAll()` / `clearOtherSids()` 同步清理通知快照，退出/切号不残留上一位同学的通知。
- **测试**：`cache_unit_tests.js` **24/0**（新增「分块缓存丢失 + 断网冷启动返回快照」「快照按学号隔离」）；`unit.js` **561/7**（7 条既有失败：quickList/toolOrder、长期安排时间、ko-link 旧断言、抽签核验链接等，改动前基线 9 条含本任务 2 条，现只剩既有 7 条）；`sync_contract_test.js 34/0`；`staticcheck.py`/`code_quality_check.js` 退出 0。
- **真实 automator E2E（测试身份）**：在线加载 18 条 → 删除全部 `zqc1_*` 分块缓存并 mock 断网 → 重启通知页仍显示 18 条，文案「离线 · 显示上次同步」，无 JS 崩溃。
- **未做**：未上传/发布小程序、未改 `VERSION`（仍 2.0.0）、未改 UD v6 契约；用户上传后真机验证。

## 移植性审计 + 可完整移植项：外观（跟随系统/浅色/深色）、电费同期比较独立行、工具描述 2 行、深色 hero 中性化（2026-11-15，源码就绪；待用户上传发布）

> 用户要求：把安卓/网页新能力中**能完整移植的**移植到小程序（移植后会缺失的不移植，尽量多移植）。唯一审计文档
> `docs/PORTING_MATRIX_20261115.md`（逐工具「可完整移植 / 部分缺失 / 不移植」+ 理由 + 本轮实施清单 + 测试证据）。
> 只改 `mp-class-tools/**` 与 `mp-class-tools-tests/**`；**未上传发布、VERSION 仍 2.0.0、UD v6 契约不变（外观偏好只存本机，不进账号同步）**。

- **外观三选一（新增 `utils/appearance.js` + `app.js` 接线）**：「我的 → 外观」= 跟随系统 / 浅色 / 深色（本机 `zq_appearance_v1`、
  即时生效、冷启动保持，与安卓 v4.55 同语义）。小程序没有 :root / JS 改 CSS 变量能力，采用官方推荐方案：
  全部 29 页根节点 `<page-meta page-style="{{themeStyle}}">` 内联覆写整组 `--md-*` token（显式浅/深），
  原生外壳用 `wx.setNavigationBarColor/setBackgroundColor/setBackgroundTextStyle/setTabBarStyle` 同步；
  `app.js` 在 `App()` 前包装全局 `Page`，首帧注入 `themeStyle/themeClass` 并在 onShow 同步（包装失败静默降级=跟随系统）。
  页面级自有暗色（通知 `--nt-*`、课表 `--tt-*`/课程色板、体测评分色、点名、统计、工具图标、骨架屏/placeholder、tool-meta 等）
  由 `@media` 改为 `.theme-dark` 类驱动，保证「显式浅色+系统深色 / 显式深色+系统浅色」也一致；`utils/util.theme()`/`nativeTheme()`
  与 touchable 涟漪按压色改读实际生效主题。
- **电费对齐网页/安卓（增量 43 补齐）**：自然周期同期比较从「区间用电 tile 单行副标」改为**独立一行**（`tilesOf.cmp/cmpUp`，
  不截断、≥0 暖沙 `<0` 灰蓝，与网页 `.pw-cmp/.opt-up/.opt-down` 同义）；趋势图例补「充值 +x 度（已折算）」。
  折算曲线/充值竖线/「期间有充值（已折算）」、14d/70d 补拉、35% 覆盖守卫、异常扣减剔除复核已同源，不改口径。
- **工具描述 2 行 / 卡片高度**：`pages/all` `.tool-meta` 由单行 nowrap 截断改 2 行 clamp（`-webkit-line-clamp:2`），
  `.tool-cell__in` min-height 132→148rpx；拖动/排序/编辑首页逻辑不变（几何按实测 rect）。
- **深色 hero 中性化**（对齐安卓 v4.55 反馈）：投票详情 `/pages/votedetail`、抽签记录 `/pages/drawrec`、体测 `/pages/ft` 的
  `--md-primary-container` 大色块与使用说明 mint hero，深色下改中性 `--md-surface-container-high` / `--md-on-surface`，
  品牌绿只留小面积（徽标/数字）；浅色不变。
- **审计结论（未移植，如实）**：活动、学信网、今日校园、教务（含 WebVPN 自动登录）、快递、OPPO 推送依赖小程序不具备的
  WebView JS 注入 / 第三方 App 调起 / 原生推送 SDK；隐藏状态栏系统级不可行；通知"自动全部加载"是小程序**天然满足**
  （一次整表拉取 + 2KB 签名增量，无分页/加载更多），不引入伪分页。详见矩阵文档 §一/§二。
- **测试**：新增 `mp-class-tools-tests/appearance_unit_tests.js` **14/0**（含 token 与 app.wxss 逐项对拍、29 页静态接线、
  `require app.js` 真实包装链路）；`node unit.js` **554/6**（基线 540/6，未新增失败；6 项为既有 draw/ko-link 与时间依赖失败）、
  `sync_contract_test.js` **34/0**、`v3_power_diag_tests.js` **65/0**（比较断言改 `cmp`）、`ug_cards_check.js` **59/0**、
  `staticcheck.py` exit 0（29 页）、`code_quality_check.js` 通过；`tool_sort_unit.js` 18/3 与基线一致。
- **待用户**：微信开发者工具重新编译 → 上传发布；真机确认浅/深色导航栏、tabBar 与页面观感。
- 回滚：还原本轮改动的源码文件（新增 `utils/appearance.js`、`tests/appearance_unit_tests.js` 可直接删除；各页 WXML 去掉
  `<page-meta>`/`{{themeClass}}`；`.theme-dark` 规则还原为 `@media`；`app.js` 去掉 appearance 接线；`util.js`/touchable 还原 theme()）。

## 提醒链路修复：`notify_cfg` 整文档覆盖导致 token/基线丢失（2026-11-15，源码就绪；待用户上传云函数 + 上传触发器）

> 用户反馈「微信小程序提醒功能异常」。排查发现三层问题（线上实测，2026-11-15 19:47–19:50）：
> ① 微信云开发里实际部署的 `notify` 仍是 2026-11-10 旧版（`action='ntStatus'/'bootstrap'/'scan'` 均返回 `unknown-action`，`diag` 无 `notify` 字段）；
> ② 定时触发器没有真正注册：`diag.hb.source` 一直为 `flush`（只有小程序回前台补发时写心跳），等待 80s 无 `timer` 心跳；
> ③ 源码里 `patchCfg()` 用 `doc.set({data:patch})` 写 `notify_cfg/__notify_cfg`，而云开发 `set` 是**整文档替换**——
> 客户端 bootstrap 写入的班级 token 会在第一次 scan 写 `lastSig` 时被清掉，之后每次扫描都在 `shouldScan` 处 `no-token` 短路；
> 每次 bootstrap 又会清掉 `lastSig/lastIds`，下一次扫描重新当首跑基线，新通知被跳过。这正是「开启新通知提醒后收不到」反复出现的根因。

- **云函数修复**（`cloudfunctions/notify/index.js` + `scan.js`）：
  - `patchCfg()` 改为「已存在 → `doc.update({data:patch})` 字段合并；不存在 → 读取现有配置 + `scan.mergeCfg()` 合并后 `doc.set()` 创建完整文档」；
  - 新增纯函数 `scan.mergeCfg(raw, patch)`（保留 token/tokenAt/lastSig/lastIds/lastScanAt/sentCount/baselineAt 等未提及字段）；
  - bootstrap 不再清基线，scan 不再清 token；`diag.notify.hasToken/lastScanAt/baseline` 可用于上传后核验。
- **测试**：`notify_flush_ui_test.js` **11/11**（新增 C7：禁止 `set({data:patch})` 整文档覆盖）；`task7_unit_tests.js` **24/24**（新增 B2b：bootstrap→scan→bootstrap 序列 token/lastSig/lastIds 全保留）；`node --check` 通过。
- **部署状态（重要）**：本次只改源码，**未自动上传云函数、未改小程序前端、未动 VERSION 2.0.0/UD v6**。线上旧版云函数无法靠客户端修复，需用户按 README §九·补：
  1) 开发者工具右键 `cloudfunctions/notify` →「上传并部署：云端安装依赖」（必须带 `scan.js`/`rest-config.js`）；
  2) 右键 `cloudfunctions/notify/config.json` →「上传触发器」（`0 */1 * * * * *`；CLI 部署不会带触发器）；
  3) 云开发控制台确认 `notify_cfg` 集合存在（首次 bootstrap/scan 也会自动建）；
  4) 上传后调 `notify {action:'diag'}`：`hb.source` 应在 1–2 分钟内变成 `timer`、`notify.hasToken=true`、`lastScanAt` 持续刷新。
- 回滚：还原 `cloudfunctions/notify/index.js` / `scan.js` 与两个测试文件；云函数回滚为重新上传旧版（本次未部署，云端状态未变）。

## 撤销 ko-link.cn 临时域名（2026-11-14，源码就绪；待用户重新上传）

> 用户决定等 `tool.furina.fun` 备案完成，三端（网页/小程序/安卓）中所有 ko-link.cn 引用全部撤销。

- `utils/cloud-config.js`：`webBase` 固定 `https://tool.furina.fun`（核验二维码链接基址）；`dropBase` 改回 `''`（未配置时云空间提示等待配置；体验版/正式版待 furina DNS+HTTPS 恢复后再配微信 request/downloadFile 合法域名）。
- `utils/drawproof.js` 注释同步，无逻辑改动。
- 微信后台：不需要添加 `ko-link.cn` 合法域名（也从未成功添加过）；若之前加过请删除，等 furina 恢复后再配 `https://tool.furina.fun`。
- 版本仍 2.0.0、UD 仍 v6；**需用户重新上传体验版/正式版后生效**。
- 配套服务端/网页：ECS Caddy 站点块只保留 `tool.furina.fun`、`ko-link.cn` DNS A 记录已删除（见 `web/HANDOFF.md` 增量 59）。

## 抽签升级 v1：名称映射 + 云端存证 + 记录页 + 核验二维码（2026-11-12，源码就绪；待用户上传发布）

> 契约唯一真源 `web/draw/CONTRACT.md`（§2 算法 / §3.1 名称映射 / §3.2 存证 / §3.3 导出图 / §3.4 核验视图 / §4 小程序）。
> 只改 `mp-class-tools/**` 与 `mp-class-tools-tests/**`；**VERSION 仍 2.0.0、UD 仍 v6（只在既有 draw section 内加字段）、零新依赖**。

- 新增 `utils/drawproof.js`：draw-v1 算法（mulberry32 uint32 显式版，网页/小程序/核验页逐字节一致，含契约 4 组固定向量）、
  `parseNames/nameMap/labelsOf/rowsOf`（§3.1 规则：`序号 名称`、无序号自增、trim 1..40、后值覆盖、≤300、归一升序；
  nameOf 优先级 = 映射 > 班级名单派生名 > 空）、`newRecordId/newSeed`、`verifyUrl`（`cloud-config.webBase`，临时 `https://ko-link.cn`）、
  4 个 RPC 封装（`draw_record_create/append/get/list`，复用 cloud.js 统一 header/token，失败静默不阻塞抽签）、
  记录列表/详情视图模型（参数/时间线/复算/哈希/二维码）与二维码绘制。
- `pages/draw`：新增「名称映射」按钮 + 弹层（textarea + 已映射计数 + 清空/取消/保存，存 `store.draw.names`）；
  每次「开始抽签」用 `draw-v1(seed, pool, count, dup)` 出结果并**异步创建云端存证**，结果区显示
  「存证中… / 已存证 · 今日第 N 次（全班今日共 M 次）/ 未存证（网络不可用）」；剔除/补抽/重置追加 `draw_event_append`
  （在途排队、成功后补发，失败静默）；新增「抽签记录」入口与「查看存证」；
  导出图 `rec=存证 id`、参数区加存证编号/时间/今日次数/记录哈希（未存证标注「未存证」且不画 QR、编号回退本机编号）、
  QR=核验链接（`qrTitle/qrCap`）、剔除重抽明细改纯文本块；随机打乱改为只改显示顺序（不改抽取顺序、不记事件）。
- 新增 `pages/drawrec`（app.json 注册）：今日/全部切换、列表（时间/第 seq 次/参数摘要/结果/操作人/我的）、
  详情（参数/初始结果/剔除重抽时间线/算法复算/哈希/二维码/复制核验链接）支持 `?id=` 深链；**不显示学号**；原生分享。
- 同步：`store.js` `DEF.draw.names`、`privacy.js` `DEFAULTS.draw.names`、`cloud.js` `udSections().draw.names` + `udApply` 应用
  （section 仍是 draw，不新增顶层键/section）；旧数据无字段按空；导出 `rpcCall` 统一 RPC 通道供 drawproof 复用。
- `utils/canvas.js`：`drawCard` 支持可选 `qrTitle/qrCap`（默认「剔除重抽记录」+ 原说明不变，其它导出不受影响）。
- AI（源码保留、发版仍 off）：`ai/skills/lottery/lib/algo.js` 保存抽签参数时保留 `draw.names`，避免 AI 抽签清空用户映射。
- 测试：新增 `drawproof_unit_tests.js` **35/0**（算法 4 向量/映射边界/labels/recordId/seed/视图 payload/RPC mock/
  页面级名称映射+存证+事件+导出 opt+记录页）；`node unit.js` **535/0**（本任务 +35；合跑含并行「长期通知」专项 12 项）、
  `node sync_contract_test.js` **34/0**（新增 draw.names 合并/换端/推送用例，夹具与期望同步更新）、
  `python staticcheck.py` exit 0（29 页、handlers/分享 0 缺失）、`node code_quality_check.js` 全部规则通过；`ai_unit_lottery.js` 51/0。
- 待用户上传发布；发布前确认 `webBase`（当前 ko-link.cn）与微信后台合法域名；云端 RPC 由 Lead 按契约迁移文件应用。


## 小程序备案号展示（2026-11-12 晚，源码就绪；待上传）

- 新增 `utils/compliance.js`：`ICP_BEIAN = '闽ICP备2026042939号'`（唯一来源）、`ICP_LINK`。
- `pages/me`「我的」页底部（版本号上方）展示「备案号：闽ICP备2026042939号」，点击复制；`.icp-note` 最小高度 40px。
- 测试：`v2_unit_tests.js` 合规扫描新增断言；`node unit.js` **488/0**、`staticcheck.py`/`code_quality_check.js` 通过。
- 发布：VERSION 仍 2.0.0，重新上传即可；ko-link.cn 的 request/downloadFile 域名配置仍需在微信后台完成（见上一条）。

## 临时切换 drop 域名到 ko-link.cn（2026-11-12 晚，源码就绪；待上传体验版）

- `utils/cloud-config.js`：`dropBase: 'https://ko-link.cn/drop'`（furina DNS/备案恢复前的临时值；恢复后改回 `''`）。
- 微信后台：`request 合法域名` + `downloadFile 合法域名` 加 `https://ko-link.cn`（域名须完成 ICP 备案）。
- ECS 侧 Caddy 已同时服务 `ko-link.cn`/`www`，`https://ko-link.cn/drop/__health` version=2.3，签名下载 URL 同为 `https://ko-link.cn/drop/...`。
- 测试：`cloudspace_unit_tests` C1–C3 在测试内临时清空 `dropBase` 验证环境默认逻辑；合规扫描白名单加入临时域名；`node unit.js` **488/0**、staticcheck/code_quality 通过。
- 待办：小程序备案号展示（等用户提供号码后写到「我的」页底部）。

## 同步网页最近修复（2026-11-12 晚，源码就绪；待上传发布）

- 电费充值后趋势：与网页同口径，`trendLine` 折算充值跳变（连续下降）+ 充值竖虚线 + 「期间有充值（已折算）」徽标；y 轴按折算范围，真实剩余保留在游标/详情。
- 文件列表：`applyEvents` 兼容 `/state` 的 `fileId` 字段；新增单测锁定（网页 P0 的同类问题）。
- 文件云空间：下载后按钮变「打开」（`zq_mp_file_opened_v1`），与网页一致。
- PPT：文件行统一「打开文件」（下载后 `wx.openDocument`），弱化直接放映；旧 deck 在线预览保留为次要入口。
- 画布测量：selectorQuery 回调丢失时 1.2s 兜底 + 测量完成后补渲染暂存请求。
- 测试：`node unit.js` **488/0**；`staticcheck.py`/`code_quality_check.js` 全部通过；VERSION 仍 2.0.0。

## 名单三分类同步网页版（2026-11-12，源码就绪；待用户上传发布）

> 用户需求「微信小程序的名单也要和网页版同步功能」；只改 `mp-class-tools/**` 与 `mp-class-tools-tests/**`；
> **VERSION 仍 2.0.0、UD v6 不变、无新增外部请求来源（沿用 CloudBase class_members / class_league / class_set_role）**。

- `pages/committee` 重写为「名单」：三分类 tab「班委 / 团员 / 全班」+ 计数徽标（团员未加载时计数为空）；
  班委按职务权重排序（班长→…→廉政监督员，座号兜底），团员为 `class_league` 缓存 ∩ 班级名单并显示「团员」pill，
  全班按座号升序、仅姓名与座号；每行只在 role 非空时显示职务 pill（重复「班委」badge 经 `util.showBadge` 去重）。
- 管理员「管理」：班委 tab 显示入口，进入后列出全班；点成员用 `wx.showModal({editable:true})` 设置/清除职务
  （`class_set_role` RPC，`p_role=''`+`p_badge=''` 清除），成功后 `classMembersPull(true)` 强制刷新。
- `utils/cloud.js`：新增 `classSetRole(sid, role)`（管理员校验 + 与网页相同的 RPC body，成功后调用方刷新名单）。
- `utils/roster.js`：新增 `ROLE_RANK` 与 `listView(kind, opts)` 纯函数（三分类行/计数/说明/空态文案），供页面与单测复用。
- 工具入口/使用说明/AI 元数据：`utils/tools.js` 名称「班委」→「名单」、副标题「班委 · 团员 · 全班」；
  `pages/ug`、`ai/skills/identity/lib/tools.js`、`agent/page-meta.json`、`getCommittee/listClassMembers` 页标题同步。
- 测试：新增 `mp-class-tools-tests/committee_unit_tests.js`（8 项，已挂 `unit.js`）：
  - 班委分类仅 role/badge + 职务排序；管理态显示全班；团员合并班级名单角色 + 团员标记 + 计数；
    团员未加载加载态/无计数；全班座号升序 + 文案；
  - `classSetRole` 管理员契约（p_sid/p_role/p_badge + X-Class-Token）、清空职务 badge 为空、非管理员/缺 sid/云端拒绝报错。
  实测：`node committee_unit_tests.js` **8/8**；`node unit.js` **487/488**（唯一失败为并行电费改动的
  v3「期间有充值徽标」用例，与本次名单改动无关，power.js 于本工作期间被外部修改）；`staticcheck.py` handlers/分享 0 缺失；
  `code_quality_check.js` 全部规则通过。
- 发布前（用户操作）：微信开发者工具重新编译上传；无需新增域名（沿用 CloudBase）。回滚：还原
  `pages/committee/*`、`utils/cloud.js`、`utils/roster.js`、`utils/tools.js`、`pages/ug/ug.js` 与 AI/agent 元数据。

## 大屏互联 presence 门控 + 文件云空间「打开」+ 域名停用说明（2026-11-12，源码就绪；待用户上传发布）

> 与网页 drop v2.3 同步；只改 `mp-class-tools/**` 与 `mp-class-tools-tests/**`；VERSION 仍 2.0.0、UD v6 不变。

- drop v2.3：`GET/POST /presence`（大屏在线 30s 心跳）。
- 新增 `utils/screencast.js` + `pages/screencast`：presence 在线才可用；发文字、传文件（8MiB 分片）、遥控 11 项；`app.json` 注册（28 页）。
- `pages/all`：仅在 `presence.stage=true` 时动态显示「大屏互联」入口；不在线不显示。
- `pages/cloudspace`：文件下载后按钮变「打开」（`zq_mp_file_opened_v1`）。
- 测试：新增 `screencast_unit_tests.js`（16 项，挂 unit.js）；`node unit.js` **478/0**、`staticcheck.py` 通过、`code_quality_check.js` 全部规则通过。
- 域名停用期：课表/作业/通知/投票/名单/水量等仍可用（CloudBase HTTPS）；文件云空间/大屏互联需 drop 域名（开发/体验版可直连 ECS http + 不校验域名；正式版需 https://tool.furina.fun/drop + 微信后台 request/downloadFile 合法域名）。

## 文件传输 · 临时云空间（2026-11-12，源码就绪；待用户上传发布）

> 与网页同步「文件传输 = 临时云空间」；只改 `mp-class-tools/**` 与 `mp-class-tools-tests/**`；
> **未上传发布，VERSION 仍 2.0.0、UD v6 契约不变、无新增外部请求来源（默认仅 CloudBase；文件传输按域名配置走 drop）**。

- 新增 `utils/cloudspace.js`：drop v2.2 API（mine/open/state/upload init·chunk·finish/file DELETE/close）+ 纯逻辑（8MiB 分片规划、大小、72h 剩余时间、file/filedel 事件合并、空间统计、文件名清洗）。
- 新增 `pages/cloudspace`（文件传输/临时云空间）：同账号自动共享；上传（`wx.chooseMessageFile`，逐片读 ArrayBuffer）、列表下载（downloadFile→openDocument→shareFileMessage 回退）、单文件删除、清空空间、5s 轮询、下拉刷新、原生分享。
- `utils/tools.js` 新增 `file` 工具入口（图标 `images/tool-file.png`）；`app.json` 注册页面；`utils/cloud-config.js` 新增 `dropBase`（留空=开发/体验版直连 ECS、正式版 https://tool.furina.fun/drop）。
- 测试：新增 `cloudspace_unit_tests.js`（24 项，已挂 unit.js）；`node unit.js` **461/0**、`staticcheck.py` 通过、`code_quality_check.js` 全部规则通过。
- 合规：按用户 2026-11-11「测试只用测试账号」红线，`mp-class-tools-tests/**` 内真实管理员/同学学号与姓名夹具统一替换为测试身份（3260799999/测试账号 与 9999 段合成 QA 身份），复跑 unit 461/0。
- 发布前：微信后台配置 request + downloadFile 合法域名 `https://tool.furina.fun`（DNS/HTTPS 就绪后）；DevTools 重新编译上传。

## task-7：缓存提速 + 新通知提醒修复 + 水量共享 + 名单快捷预设 + 徽章去重（2026-11-11，源码就绪；待用户上传发布）

> 用户反馈第 2/6/8/9/11 条。**只改 `mp-class-tools/**` 与 `mp-class-tools-tests/**`（含 cloudfunctions/notify 源码）；
> 不动 web 仓库 / 云端 DDL / 安卓；未上传发布，VERSION 仍 2.0.0、UD v6 契约不变、无新增外部请求来源、未打印 token。**

### ① 需求 9 · 加载与缓存提速

| 改动 | 文件 |
| --- | --- |
| 有本机缓存时首屏**不再先出骨架**：`_hasLocalData()` / `_hasLocalHw()` 为真 → onShow 同步 refresh；无缓存保留原 120/140ms 骨架 | `pages/index/index.js`、`pages/hw/hw.js` |
| 启动请求去重：`cloud.marksFresh(ms)`（最近一次 marks 拉取时间）；`app.warmSync` 在页面刚强拉过（5s 内）不再重复强拉 → 冷启动 marks 2→1 请求 | `utils/cloud.js`、`app.js` |
| `utils/util.js diffPatch(prev,next)`：只 setData 变化字段（浅比较 + 对象 JSON 比较）；工作台 refresh 用补丁下发，状态未变化时 0 次 setData | `utils/util.js`、`pages/index/index.js` |
| 保持既有保障：通知 ~2KB 签名校验/分块缓存/TTL、marksPull 单飞、页面 onShow 强拉 marks（sync_contract 需求 16 契约不变） | — |

**实测（真实数字 + 方法）**：`mp-class-tools-tests/cache_speed_bench.js`（同一冷启动剧本跑「改造前」
`_baseline_cache_20261111` 快照 vs 改造后源码，Node mock 网络）：
- 首次启动请求 **13 → 12**（marks 2→1）；
- 二次冷启动请求 **2 → 1**（marks 2→1）、首屏计算 **11.4ms → 0.3ms**；
- 页面重入 setData **6 次/3111B → 5 次/522B（-83%）**。
devtools automator（`task7_preview.js` A 组）：有缓存 `wx.reLaunch` → 工作台 `state=data` **217–284ms**、请求 0–1，
无 loading 骨架；无缓存对照正常到 data（不白屏）；0 console error。

### ② 需求 11 · 新通知提醒（用户反馈「开启后收不到」）

**根因**：`kind='nt'` 订阅只由云函数 `action='publishNotice'` 消费，而全仓库无任何调用方（网页发布通知走 CloudBase，
不在微信云开发内）→ 永不发送。定时器未上传触发器是另一个已知原因（2026-11-10 已修）。

- **云端（`cloudfunctions/notify`）**：新增 `scan.js` 纯逻辑 + `rest-config.js`：
  - `timer` 后调 `scanNewNotices()`：门控（无 token / 无 active nt 订阅 / 距上次 <5min → 0 外部请求）→
    PostgREST 拉 `notices?select=id,ts,title,hidden,edited_at`（轻量、同客户端签名口径）→ 首跑只记基线；
    仅新 id 算新通知（删除/隐藏/编辑不发送）→ 向 active `kind='nt'` 发送并置 inactive，更新 `lastScanAt/lastSentAt/sentCount/lastError`；
    401/403 记 `token-invalid`。
  - 新增 `action='bootstrap'`（客户端上报班级 token → `rpc/class_members` 校验 → 存 `notify_cfg/__notify_cfg`）、
    `action='ntStatus'`（云端 active 数 + 本人状态 + 心跳/扫描诊断）、`action='scan'`（人工排查，仍受节流）；
    `action='diag'` 增加脱敏 `notify` 视图（**不含 token/openid/ref**）。
  - 第二模板：环境变量 `NOTIFY_TMPL2` / `rest-config.secondTmplId`；发送按订阅行 `tmplId` 选择，第二模板失败自动回落默认模板；
    未配置时行为与旧版一致。
- **客户端**：`utils/notify.js` 新增 `templateIds()`（默认 1 个 / 配置后数组）、`status()`、`diag()`、`bootstrap(token)`、
  `classify(err)`（denied / unsupported / disabled-setting / cloud-missing / network）；`ask()` 支持模板数组并优先第二模板。
  `app.warmSync` 调 `notify.bootstrap(identity.token())`（30 分钟节流，失败静默）。
  `pages/nt`：授权成功 toast「**已开启 · 收到后自动关闭**」、显示「云端 N 人已订阅」、**支持再次开启**、
  失败给出可读原因；简报区状态文案。工作台通知卡新增「新通知」角标（`store.newNtAt`，打开通知页清除）。
  `pages/diag` 新增「**提醒通道诊断**」卡：定时器心跳时间 / active 订阅数 / 新通知扫描 lastScanAt / lastError。
- **部署配置步骤**（详见 README §九·补）：上传 `notify` 云函数（含 scan.js/rest-config.js）→ 上传触发器
  （config.json，勿漏）→ 建 `notify_cfg` 集合（仅云函数可读写）→（可选）环境变量 NOTIFY_TMPL2/NOTIFY_SCAN_MIN_MS →
  真机自测（点开启 → 控制台看 token/lastSig → 发新通知 → 5 分钟内收到；诊断页心跳/lastError 正常）。
- **测试**：`task7_unit_tests.js` B 组（scan.js 签名/基线/新增检测/门控/诊断脱敏 + 第二模板 + 失败归因 + 云函数接线静态）；
  `cloudfunctions/notify.test.js` 35/0、`notify_fix_20261110.test.js` 18/0（timer 返回结构新增 scan 字段已同步测试）；
  automator `task7_preview.js` B/F 组（授权成功/再次开启/拒绝/云函数未部署/诊断页心跳/active/lastError）。

### ③ 需求 6 · 水量共享（契约 `web/tools/tests/_water_shared_contract.md`）

- `utils/cloud.js` 新增 `waterList / waterUpsert / waterDelete / waterRoomGet / waterRoomUpsert / waterForceFresh`
  （全部走既有统一 `wx.request` → CloudBase PostgREST，不新增外部请求来源；GET 60s TTL）。
- `utils/water.js` 新增 `isFixed4 / fixedPersons / cloudRecsOf / mergeCloud / roomPersonsOf / normOp / pushOp / dropOp`：
  同月云端覆盖本地、本地独有月份进补传、离线 pending 队列；23A/23B 固定 4 人间。
- `pages/water`：进入/切宿舍先渲染本机缓存（UD v6 water 继续作离线缓存）→ GET 云端合并 → 补传本地独有月份；
  保存/删除/改人数先本机再尽力写云端；失败进 `store.waterPend`，进页/onShow/恢复后自动重试；
  23A/23B 人数选择器禁用显示「4 人间（固定）」；页脚显示「宿舍共享 · 已同步 / 离线 · 已存本机」。
- 文案：去掉「每月免费 8/12 吨水」，人数选项只留「4 人间/6 人间」；「免费额度/定额」统一改「定额」（公式数值不变）。
- 测试：`task7_unit_tests.js` C 组（合并/固定四人/请求口径/离线队列/页面/pending 重试/文案）+ `water_unit_tests.js` 更新；
  automator `task7_preview.js` C 组（云端合并显示、23A 固定、改 6 被拒、离线 pending 恢复清空、文案检查）。

### ④ 需求 8 · 名单快捷预设（全班/班委/团员）

- `components/roster-picker` 新增「全班 / 班委 / 团员 / 清空」行：点击套基础集合，之后仍可逐个点气泡增删，
  confirm 仍返回座号升序数组（抽签/分组/点名三处共用，数据格式不变）。
- `pages/vote`「可见范围 → 指定成员」同样增加四个快捷预设（写入 `form.audSeats` 座号数组，不存学号）。
- `utils/roster.js` 新增 `quickSeats(kind) / committeeSeats() / leagueSeats()`；`utils/cloud.js` 新增 `leaguePull()`
  （`rpc/class_league`，6h TTL + `store.classLeague` 缓存，失败保留缓存；接口已由网页侧 2026-11-11 应用）。
- 测试：`task7_unit_tests.js` D 组 + automator D 组（组件三类预设人数、预设后可增删、投票预设座号）。

### ⑤ 需求 2 · 徽章去重

- `utils/util.js showBadge(badge, role)`：职务文字已展示时不重复输出同义「班委」badge 气泡（role 为空保留徽章；
  管理员等非同义徽章保留）；`pages/committee`（渲染 + AI 接力）、`pages/me`、`pages/data` 统一使用。
- 班委页副标题/分享标题去掉「身份徽章」；`utils/tools.js` 班委工具描述改为「职务 · 名单」。
- 测试：`task7_unit_tests.js` E 组 + automator E 组（职务保留、badge 为空、工具描述）。

### ⑥ 测试真实输出（本机，2026-11-11）

```text
cd mp-class-tools-tests
node unit.js                    -> 437 passed / 0 failed      （基线 414 + task7 新增 23）
node task7_unit_tests.js        -> 23 passed / 0 failed
node sync_contract_test.js      -> 33 passed / 0 failed       （另修复既有偶发：C 步 LWW 同毫秒幂等跳过 → sleep(2) 稳定化）
python staticcheck.py           -> exit 0（26 页；handlers / 分享 handler 缺失 0）
node code_quality_check.js      -> 全部规则通过（退出码 0）
node cloudfunctions/notify.test.js                 -> 35 passed / 0 failed
node cloudfunctions/notify_fix_20261110.test.js    -> 18 passed / 0 failed
node cache_speed_bench.js       -> 3/3 检查通过（改造前/后对比，_perf_cache_v2_result.json）
node task7_preview.js           -> automator 34 passed / 0 failed，0 console error，截图 _shots_task7/（9 张）
```

### ⑦ 风险与取舍（如实）

- **未真机验证**：automator 为开发者工具模拟器 + mock 网络；真实订阅消息发送/真机授权/通知到达需用户发布后按 README 步骤自测
  （云函数已部署 + 触发器已上传 + 客户端 bootstrap 后 5 分钟内到达）。自动化全程未发送真实订阅消息、未写真实云表。
- **token 存储**：班级 token 存云开发数据库 `notify_cfg`（仅云函数可读写）；云函数返回的 diag 已脱敏。若该集合被误开放给
  客户端直读，会暴露 token —— 部署步骤明确要求仅云函数/管理端权限。
- **扫描间隔**：定时器每分钟触发但扫描节流 5 分钟；两条通知间隔 <5 分钟时只推送最新一条（一次性订阅本来也只能发一条）。
- **一次性订阅**：每次授权只能发一条，发送成功即 inactive；用户需再次点「新通知提醒」（按钮已支持再次开启并显示状态）。
- **水量共享**：真实云端写入只用测试身份且 finally 清理（本轮未做真实写，mock 覆盖 GET/POST/DELETE 口径）；
  多端并发编辑同月记录为 LAST-WRITE-WINS（无冲突提示，契约如此）。
- **团员预设**：依赖 `rpc/class_league`（已在云端应用）；离线时用本机缓存，无缓存时 toast「团员名单暂不可用」。
- **缓存提速**：改造前数字来自改造前源码快照（`mp-class-tools-tests/_baseline_cache_20261111`，仅源码不含 node_modules），
  剧本为「首次启动 / 二次冷启动 / 页面重入」；真机冷启动绝对耗时会更大，但请求数与 setData 差异同向。

## 电费：13/16 号楼隐藏 24h 趋势 + 电费比较自然周期同期（2026-11-11，源码就绪；待用户上传发布）

> 用户「小程序也要」→ 与网页增量 42 同口径。**只改 `mp-class-tools/**` 与 `mp-class-tools-tests/**`；VERSION 仍 2.0.0、UD v6 不变、未上传发布。**

- **隐藏 24h**：`utils/power.js` 新增 `showRange/rangesOfBuilding/normRangeForBuilding`（13/16 号楼主楼不提供 24h 档）；`pages/power/power.js` `_syncSel` 过滤 `data.ranges`（24h 按钮不渲染）、选中慢楼栋自动落 7 天、切回实时房恢复进入前档位；24h 数据仍拉取，仅用于 `isSlowRoom`（日更/降级）与估算，不展示 24h 趋势。
- **电费比较**：`utils/power.js` 新增 `CMP_LABEL/CMP_TITLE` + `cmpSourceKey/naturalWindows/ptsBetween/cmpCoverage/naturalCompare`（24h 较昨日同期、7d 较上周同期、30d 较上月同期；两周期覆盖 <窗口 35% 不显示）；`tilesOf(..., cmp)` 在「区间用电」tile 副标追加「较X同期 ±x%」；`utils/cloud.js` `POWER_RANGE_MS` 增 14d/70d 隐藏取数窗口；`pages/power/power.js` `load()` 按需补拉（实时房 7d→14d、30d→70d；慢楼栋 7d 用已预取 30d）+ 缓存分支/渲染同步。
- **与网页差异（如实）**：小程序 7d 比较取数按楼栋选窗口（13/16 用 30d；其他楼栋 14d），网页按 isSlowRoom 数据口径（慢楼栋提速时网页用 14d）；现网历史约 6 天 → 「较上周/上月同期」暂不显示，数据积累后自动出现。
- **测试**：`mp-class-tools-tests/v3_power_diag_tests.js` **64/64**（新增 utils 窗口边界/取数/覆盖降级/tile 副标 + page 隐藏/默认/恢复/三档比较/请求窗口）；`node unit.js` **414/0**、`sync_contract_test.js` **33/0**、`staticcheck.py` exit 0、`code_quality_check.js` exit 0；automator `power_natural_cmp_preview.js` **9/9 PASS**（mock 70 天自然周期，截图 `_shots_power_natural_cmp/`，0 console error）。
- **发布**：需用户在微信开发者工具上传发布后生效；回滚=源码回退上一版重新上传。

## PPT v2.3 视频/音频单独下载分组（2026-11-11，源码就绪；小程序待用户上传发布）

> 用户要求（2026-11-11）：「加入视频单独下载功能」——教室电脑/旧 PowerPoint/WPS 打不开内嵌视频时，可把视频/音频单独下载到本机，
> 用任意播放器播放。契约唯一真源 `web/ppt/CONTRACT.md` **§12.8**（转换机从最终 compat 包抽取并写 `manifest.media_files`）。
> 只改 `mp-class-tools/**` 与 `mp-class-tools-tests/**`（不动 web/、android/、云端；转换机 media_files 已在并行任务实现）；
> **未上传发布、VERSION 仍 2.0.0**。

### ① 能力（按契约 §12.8）

- 下载详情 `pages/pptdl` 在「兼容版 PPTX / PDF / 原始文件」三行之后新增分组 **「视频单独下载」**：
  **仅 `manifest.media_files` 非空时显示**（旧 deck 无字段不显示、不白屏；分组内同时容纳音频行）。
- 每行：`视频1 · 第 7 页` / `音频1 · 第 12 页`（序号按类型分别从 1 开始；同一媒体多页 → `第 7、12 页`）+ `时长 · 分辨率 · 大小`
  （音频无分辨率）；文件名用 manifest `name`（转发时 `wx.shareFileMessage.fileName`）。
- 下载（与三行共用同一进度/取消/失败状态，避免重复点击）：
  - 视频 `wx.downloadFile`（进度 `下载 42%`、取消 `downloadTask.abort()`、失败 toast）→ **`wx.saveVideoToPhotosAlbum` 保存到相册**；
    授权失败（`auth/deny/permission`）→ `wx.showModal`「需要相册权限」→ 确认「去设置」→ `wx.openSetting`；其它失败 →
    有转发能力则降级转发，否则提示复制链接用播放器打开；
  - 音频 `wx.downloadFile` → `wx.openDocument`（系统播放器/WPS 打开）；失败 → 转发/复制链接降级；
  - 「转发到聊天/电脑」：未下载过则先下载再 `wx.shareFileMessage({filePath,fileName})`；已下载复用临时文件不重复下载；
  - 「复制链接」：`wx.setClipboardData(row.url)`（URL = `manifest.base + s`）。
- 原三行下载、大小、兼容提示（橙色逐条）、旧 deck「兼容版未生成 + 在线预览 + 重新处理」、列表标签等全部保持不变。

### ② 改动文件

| 文件 | 改动 |
| --- | --- |
| `utils/ppt.js` | 新增 §12.8 段：`normMediaFile`（s/url=base+s/name/size/sha256/kind video\|audio/dur/w/h/slides，坏项丢弃、未知 kind 按视频）、`normMediaFiles`（≤20 条）、`mediaRows(man)`（行数据：序号按类型分开、`视频1 · 第 7 页`、多页列出、`durText`/`resText`/`specText`/`sizeText`/`name`/`url`，供页面+单测）；`normManifest` 挂载 `media_files/hasMediaFiles`（只有 media_files 的清单也合法，向后兼容）；`downloadDetailView` 增加 `mediaRows/hasMedia/mediaCount/mediaVideos/mediaAudios`；导出新函数 |
| `pages/pptdl/pptdl.js` | 行查找合并 `d.rows + d.mediaRows`；`_startDownload` 成功后 `_afterDownload` 分派：视频 `_saveVideo`（含 `_saveVideoFail` 授权引导/降级）、音频 `_openAudio`（`_audioFallback` 降级）、其它仍 `openDocument`/转发；复用现有进度/取消/失败/复制链接 |
| `pages/pptdl/pptdl.wxml` | 三行之后新增 `.dl-media` 分组（`wx:if="{{d.hasMedia}}"`）：标题「视频单独下载」+ 媒体行（label/specText/sizeText + 下载/取消/进度 + 转发/复制链接）；「暂无可下载文件」兜底条件改为 `!d.rows.length && !d.hasMedia` |
| `pages/pptdl/pptdl.wxss` | `.dl-media` / `.dl-media-hd` / `.dl-row--media` 样式 |
| `mp-class-tools-tests/ppt_dl_unit_tests.js` | **+10 项（26→36）**：M1 media_files 归一化（URL/kind/dur/w/h/slides/sha/size/坏项/上限）、M2 无 media_files 兼容、M3 `mediaRows` 文案与序号/多页、M4 详情视图字段、M5 视频下载→保存相册、M6 授权失败→showModal+openSetting、M7 转发 fileName/缓存复用、M8 音频 openDocument+失败降级、M9 媒体行复制链接/取消/失败、M10 工程静态接线；mock 增加 `saveVideoToPhotosAlbum`/`showModal`/`openSetting` 捕获 |
| `mp-class-tools-tests/ppt_media_preview.js` | **新增** automator 实测：无 media_files 分组隐藏 → 注入 media_files 渲染 → mock 下载链（进度/保存相册/授权引导/转发/音频打开/复制链接），截图 `_shots_ppt_media/`，结果 `ppt_media_preview_result.json` |
| `mp-class-tools/README.md`、`mp-class-tools-tests/README.md` | 顶部/专项测试表更新（v2.3 增量、真机授权与大文件风险） |

### ③ 测试（本机实跑，2026-11-11）

```text
cd mp-class-tools-tests
node unit.js                    -> 412 passed / 0 failed   （402 + 本任务新增 10；含 ppt-dl 36）
node ppt_dl_unit_tests.js       -> 36 passed / 0 failed
node ppt_unit_tests.js          -> 40 passed / 0 failed
node ppt_video_unit_tests.js    -> 30 passed / 0 failed
node sync_contract_test.js      -> 33 passed / 0 failed
python staticcheck.py           -> exit 0（26 页；handlers / 分享 handler 缺失 0）
node code_quality_check.js      -> 全部规则通过（退出码 0）
node ppt_media_preview.js       -> automator 17 passed / 0 failed（截图 _shots_ppt_media/）
```

### ④ 实测与取舍

- devtools automator（9424）：真实 deck 当前**无 media_files → 分组不显示**（符合向后兼容）；用 `wx.request` 内存包装器注入
  §12.8 `media_files`（视频 第7页 150.92s/1024×576/19.2MB、音频 第12页 225.582s）后：分组标题/两行文案正确、三行下载仍保留；
  mock `wx.downloadFile` 进度 42% → 视频 `saveVideoToPhotosAlbum`（已保存到相册）、相册授权失败 `showModal`+`openSetting`、
  视频转发 `shareFileMessage(fileName=本草孝心_视频1_第7页.mp4)`、音频 `openDocument`、媒体行复制链接剪贴板均通过；0 console error。
- 取舍：视频保存到相册是「下载到本机相册」的微信合规方式（不提供文件管理器直存）；授权被拒时只能引导设置或转发；
  媒体大文件（≤200MiB）与三行共用同一串行下载状态（同刻只下一个，避免并发大文件）；真实转换机 media_files 上线后自动显示，无需再改客户端。

## PPT v2.0 功能重定义：小程序「下载中心」（2026-11-10，源码就绪；小程序待用户上传发布）

> 用户原话（2026-11-10 22:05）：「重新定义该功能，不再在线播放为主要功能，而是以上传ppt，自动对内容进行兼容性处理，
> 并提供多端下载的方式，不改变ppt本身质量」。
> 契约唯一真源 `web/ppt/CONTRACT.md` **§12（v2.0）**；只改 `mp-class-tools/**` 与 `mp-class-tools-tests/**`
> （不动 web/、android/、云端 DDL/RLS，不部署/不推手机）；**未上传发布、VERSION 仍 2.0.0**。

### ① 定位与能力（按契约 §12.4）

- **列表点击卡片 = 下载详情**（新页 `pages/pptdl`）——不再默认进播放器；旧播放器 `pages/pptplay` 保留为「在线预览」入口（§12.4.3）。
- **三行下载**（§12.2/§12.4.1）：`manifest.files` 的 兼容版 PPTX / PDF（显示页数）/ 原始文件（base+`s`、`size`、`name`），每行显示大小；
- **小程序下载方式**（§12.4.2）：`wx.downloadFile`（**进度 UI、可取消 `downloadTask.abort()`、失败提示**；30–60MB 不读入内存）→
  `wx.openDocument({filePath,fileType:'pptx'|'pdf',showMenu:true})` 用系统/WPS/Office 打开；
  可用 `wx.shareFileMessage` 时「**转发到聊天/电脑**」（未下载过则先下载再转发，复用临时文件），不可用自动降级「复制链接」；
  每行「复制链接」（`wx.setClipboardData`，提示「下载链接已复制」）；
- **兼容提示**（§12.2/§12.4.1）：`manifest.compat.warnings` 橙色区块逐条显示（外链媒体未随文件携带/字体未嵌入等，**不删除内容**）；
- **旧 deck（无 files）**（§12.4.3）：「兼容版未生成」+「在线预览」+「重新处理」（`retryDeck` → `status=queued`，仅本人/管理员），
  若 `manifest.src` 存在仍提供「原始文件」下载（§12.6 旧 deck 仍可下载原始）；
- **列表小标签**「兼容版」「PDF」（§12.4.1）：批量轻查询 `manifest->files` 派生字段（不拉整份 manifest，避免回归 §4.4）
  + 本机缓存 `zq_ppt_files_v1`（打开过详情/轻查询后离线可用），失败静默不影响列表；
- 未就绪 deck 详情页只显示状态/进度（不显示下载）；上传/10s 可见轮询/心跳离线/删除/重试/空态保持不变；不新增 tabBar。

### ② 改动文件

| 文件 | 改动 |
| --- | --- |
| `utils/ppt.js` | 新增 **C2 段**（§12）：`normFileRow/normFiles/normCompat`（files 容错、warnings 截断）、`safeFileName`（去非法字符/强制扩展名/120 字截断）、`openTypeOf`（openDocument fileType）、`fileRows`（三行 + 旧 deck 原始行）、`downloadDetailView`（详情视图/旧 deck/未就绪/预览/重试权限）、`statusTextOf`、`tagsOf`、本机文件标签缓存 `rememberFiles/filesMap/filesOfDecks`；`normManifest` 升级 v2（slides 可为空、files 合法、video-only 旧 deck 兼容）；`MANIFEST_SELECT` 追加 `source_size/owner_sid/owner_name/status/created_at/progress/error`（详情页需要）；`deckView` 增加 `tagCompat/tagPdf`；`getManifest` 写入标签缓存 |
| `pages/pptdl/pptdl.(js/wxml/wxss/json)` | **新增下载详情页**：头部封面/标题/元信息/状态；三行文件下载（进度/取消/失败 toast）+ 转发/复制链接；橙色兼容提示逐条；旧 deck 三件套；在线预览跳旧播放器；重新处理后 2s 自动刷新；未就绪只显示状态；`onUnload` abort；分享 handler |
| `pages/ppt/ppt.(js/wxml/wxss)` | 点击卡片改为 `openDeck` → `/pages/pptdl/pptdl?id=`；新增 `_loadTags()`（ready deck 批量轻查 files 标签，失败用缓存）；卡片显示「兼容版」「PDF」小标签（移除已不适用于新定位的「继续」徽标展示）；上传/轮询/删除/重试/更多菜单保持 |
| `app.json` | 注册 `pages/pptdl/pptdl`（共 24 页，不新增 tabBar） |
| `mp-class-tools-tests/ppt_dl_unit_tests.js` | **新增 26 项**：manifest v2 容错/旧 v1 兼容、文件行/页数/文件名/打开类型、详情视图（v2/旧 deck/未就绪/compat-only 合并）、列表标签+files 轻查询+缓存、页面行为（downloadFile 进度/取消/失败、openDocument pptx/pdf、shareFileMessage 转发/降级复制链接、复制链接、旧 deck 预览/重试、未就绪、onUnload abort）、工程静态接线 |
| `mp-class-tools-tests/unit.js` | 末尾 require `ppt_dl_unit_tests.js`（总断言 337 → **363**） |
| `mp-class-tools-tests/ppt_video_unit_tests.js` | G3 列表断言按 §12.4.1 更新（整卡点击=详情、「兼容版/PDF」标签；v1.2 播放器/续播测试保留） |
| `mp-class-tools-tests/ppt_dl_preview.js` | **新增** automator 实测脚本（列表→详情、旧 deck 预览、v2 三行/兼容提示/mock downloadFile+openDocument 下载链/取消/复制链接/转发、截图 `_shots_ppt_dl/`、结果 `ppt_dl_preview_result.json`） |
| `mp-class-tools/README.md`、`mp-class-tools-tests/README.md` | 顶部/专项测试表更新（含 OSS 域名与 30–60MB 真机风险） |

### ③ 测试（本机实跑）

```text
cd mp-class-tools-tests
node unit.js                    -> 363 passed / 0 failed   （337 + 新增 26；含 ppt 40 / ppt-video 30 / ppt-dl 26）
node ppt_dl_unit_tests.js       -> 26 passed / 0 failed
node ppt_unit_tests.js          -> 40 passed / 0 failed
node ppt_video_unit_tests.js    -> 30 passed / 0 failed
node sync_contract_test.js      -> 33 passed / 0 failed
python staticcheck.py           -> exit 0（24 页；handlers / 分享 handler 缺失 0）
node code_quality_check.js      -> 全部规则通过（退出码 0）
node ppt_dl_preview.js          -> automator：27 passed / 0 failed（真实 deck 旧形态 + v2 注入；截图 _shots_ppt_dl/）
```

### ④ 实测结论 / 真机风险 / 已知取舍

- devtools automator 实测（详见 `ppt_dl_preview.js` 输出与 `_shots_ppt_dl/`，**27 passed / 0 failed**）：列表点击卡片进入 `pages/pptdl`（不再进播放器）；
  旧 deck 显示「兼容版未生成 + 在线预览 + 重新处理」，点预览进入旧播放器；v2（内存注入模拟转换机产物）显示三行下载 +
  大小 + 两条橙色兼容提示 + 列表「兼容版/PDF」标签；下载链路用 mock `wx.downloadFile`（进度 42% → 成功）→
  `wx.openDocument(fileType=pptx, showMenu)`；取消 → `downloadTask.abort()`；复制链接 → 剪贴板校验；转发走
  `wx.shareFileMessage`（devtools 3.17.4 该 API 可用；不可用端会降级复制链接）。
  注：若自动化会话里残留旧播放器的「退出演示？」系统弹窗（devtools 会话态，非本页代码），重新编译一次小程序即清除。
- **大文件**：兼容包可能 = 源 30–60MB；`wx.downloadFile` 落临时文件、`onProgressUpdate` 显示 `下载 42%`、可取消，不读入内存。
- **真机风险（必须用户做，无法自动化）**：微信公众平台把 `https://tool-furina-fun.oss-cn-hongkong.aliyuncs.com` 加入
  **request + downloadFile 合法域名**（香港默认域名能否过微信校验未查证）；OSS 若开防盗链需放行空 Referer 与
  `servicewechat.com`；发布后用**真机正式版**下载一份 30–60MB 兼容包并 `openDocument` 验证（devtools 不能代表真机）。
- 已知取舍：小程序不提供「保存到相册/文件管理器」（仅 `openDocument(showMenu)` 可另存/转发）；`manifest.compat.warnings`
  只展示不阻断（契约红线：不删除外链媒体/动画等内容）；旧 deck 的「原始文件」大小未知时不显示大小（manifest.src 无 size 字段）；
  列表标签依赖 `manifest->files` 派生查询，若后端/网关不支持该 JSON path 则仅显示已打开过详情的 deck 标签（本机缓存兜底，不影响下载功能）。

## PPT v1.2「原样播放」视频 + 续播 + 降级链（2026-11-10，源码就绪；小程序待用户上传发布）

> 用户反馈（2026-11-10 20:39）：「继续优化在各设备上的演示效果，我希望的是在网络良好时达到电脑本地文件的播放效果，
> 目前 PPT 内动画全部消失，视频也依然无法播放，且各端操作都不够便捷」。
> 契约唯一真源 `web/ppt/CONTRACT.md` §11（含 **§11.4 小程序媒体传输特别说明**）；只改 `mp-class-tools/**` 与
> `mp-class-tools-tests/**`（不动 web/、android/、云端 DDL/RLS、不部署/不推手机）；**未上传发布、VERSION 仍 2.0.0**。

### ① 能力（按契约 §11.3/§11.4）

- **两种模式**：`原样播放`（`manifest.video`：PowerPoint 直出视频，含动画/切换/内嵌视频+声音）与 `分步浏览`（原图片/step/热点）。
  - 默认：`manifest.video` 存在且网络良好（`wx.getNetworkType` = wifi/4g/5g/unknown；2g/3g/none 默认分步）→ 原样播放并自动开始；
  - 用户手动切换后本机记住偏好（`zq_ppt_mode_v1`，按 deckId；不进 UD 同步），下次优先用户选择；
  - 顶栏常驻「原样 / 分步」胶囊（控制条隐藏时也能切）。
- **原样播放控制条**（3s 自动隐藏，点舞台显隐）：播放/暂停、`mm:ss / mm:ss`、**上一页/下一页按 chapters seek（不是 ±10s）**、
  章节刻度进度条点按 seek（`videoContext.seek`）、倍速 1×/1.25×/1.5×/2×（`playbackRate`）、复制视频链接
  （`wx.setClipboardData` + 短提示「可在浏览器下载/播放」）、从头、关闭；左右滑=章节前后；**不做** 1/3 点击翻页（避免与视频冲突）。
- **降级链（§11.4，全程不白屏/不卡死）**：`<video src=OSS直链>` 直连 → `binderror` 或 **5s 内未起播**（timeupdate 判定，
  兼容部分基础库不触发 bindplaying）→ `wx.downloadFile` 到临时文件播放（**下载进度 UI**；20s 无进度 / 180s 总时长看门狗；
  退出页面/切模式 `downloadTask.abort()`）→ 仍失败**自动切分步 + toast「网络不佳，已切换分步浏览」**，下载失败短提示
  「需在微信后台配置 OSS 域名」。
- **缓冲态**：40–55MB 视频直链流播必须给缓冲 UI（转圈 + 「缓冲中…」）；暂停/autoplay 被拒显示大播放键。
- **续播（§11.3.4）**：storage 按 deckId 记 `{mode,page,step,idx,t,dur,pt,n,at}`（key `zq_ppt_resume_v1`，7 天/未到末尾有效，最多 100 条）；
  列表卡片封面左上「**继续**」小徽标；打开**自动续播**（视频 toast「续播 05:42」，分步「续播 3/12」），控制条「从头」可重置。
- **分步模式修复**：热点时序（图片 `load` 后 / 转场结束定时器 / `resize` 三处重算 `_updateHot`，消除「本页有视频但热点没渲染」竞态）；
  热点直径 48→**64px**（契约 ≥56px）+ 轻微脉冲 + 时长角标「视频 3:46」；原有点击/滑动/黑屏/抽屉/缩略图/备注/预加载保持。
- **列表便捷**：整卡点击=直接播放（默认模式由播放器决定）；上传/删除/重命名/下载原件/轮询/心跳全部不变；不新增 tabBar、不加说明文字。

### ② 改动文件

| 文件 | 改动 |
| --- | --- |
| `utils/ppt.js` | 新增 §12 段（D2）：`normVideo`（manifest.video 容错：s 必须非空字符串、chapters 过滤/按 t 排序/同页去重/单调不减、ticks）、`fmtVideoClock/videoTimeText/videoPct`、`videoChapterAt/videoPageOf/videoSeekTarget/videoPrevNext`（章节 seek）、`chooseMode`（网络/设备偏好默认模式）、`videoStageNext`（direct→download→temp→step 状态机）、`downloadPct/downloadText`、`nextRate/rateText`、`normResume/resumeValid/resumeText/resumeBadge`、本机 storage（`resumeAll/resumeOf/saveResume/clearResume/modeOf/saveMode`）；`normManifest` 增加 `video`；`deckView` 增加 `resumeShow/resumeText`；导出新常量/函数 |
| `pages/pptplay/pptplay.js` | 新增视频模式全套：`_decideMode`（默认模式+续播落地）、`_vEnter/_vGoStep/_vPlayTemp/_vDownload/_vFallback`、视频事件（meta/time/play/pause/waiting/playing/canplay/ended/error）、控制条（toggle/前后页/进度条/刻度/倍速/复制链接/从头）、手势（点舞台显隐、左右滑章节）、缓冲/下载/短提示、看门狗（5s 起播 / 20s 下载无进度 / 180s 上限）、`_vSave/_saveStep` 续播；`onImgLoad`/转场结束/`onResize` 重算热点；`HOT_SIZE=64`；`_release` 释放视频/取消下载；黑屏时暂停视频；`closePlayer/_syncLeaveGuard` 按视频秒数判断进度；更多菜单加「从头播放」 |
| `pages/pptplay/pptplay.wxml` | 视频模式层（`<video id="plv" controls=false autoplay contain>` + 手势层 + 缓冲/下载/大播放键/短提示 + 自制控制条与章节刻度）；顶栏「原样/分步」胶囊 + 关闭；热点脉冲元素；`<image webp>` 全部保留 |
| `pages/pptplay/pptplay.wxss` | 视频层/控制条/章节刻度/缓冲/下载进度/提示/胶囊样式；`prefers-reduced-motion` 覆盖新动画 |
| `pages/ppt/ppt.js/.wxml/.wxss` | `_render` 传入 `resumeAll()`；卡片封面左上「继续」徽标样式（7 天/未到末尾） |
| `mp-class-tools-tests/ppt_video_unit_tests.js` | **新增 30 项**（A manifest.video 容错 / B 章节 seek / C 模式选择 / D 续播存取+徽标 / E 降级链状态机+下载进度 / F 倍速+常量 / G 工程静态接线 / H 页面级内存 mock 行为） |
| `mp-class-tools-tests/unit.js` | 末尾 require `ppt_video_unit_tests.js`（307 → **337**） |
| `mp-class-tools-tests/ppt_video_preview.js` | **新增** automator 实测脚本（真实 deck + 真实 OSS 视频；截图 `_shots_ppt_video/`；写 `ppt_video_preview_result.json`） |
| `mp-class-tools/README.md` | 顶部新增本条摘要（含真机风险与需用户配置 OSS 域名） |
| `mp-class-tools-tests/README.md` | 新增「PPT v1.2」专项测试表中段 |

### ③ devtools 实测结论（automator 9424，2026-11-10；真实 deck `dmwalrdlgevz90l` 16 页 / 第 12 页内嵌视频 225.6s / 真实 OSS `m0.mp4` 14MB）

- `wx.downloadFile` 同 URL：**成功** statusCode=200、`http://tmp/…mp4`，14MB 在 devtools 约 **11–56s**（限速波动明显 → 必须有进度 UI）。
- 把真实 `m0.mp4` 注入为 `manifest.video` 后：**`<video src=OSS直链>` 在 devtools 确实播放**（`timeupdate` 持续推进
  0→19.6s、之后 156→169s；OSS 响应带 `x-oss-force-download: true` + `Content-Disposition: attachment` **未阻断**）；
  章节下一页落在 chapter 起点（页码 12→13）、倍速 1.25×、暂停/继续、复制链接（剪贴板读到视频 URL）、
  点舞台显隐控制条（不翻页）、顶栏「原样/分步」胶囊 UI 双向切换均通过。
- 分步模式：真实 deck 第 12 页热点 64px、角标「视频 3:46」、点击打开媒体层不报错。
- 降级链：直连 404 → 下载进度 UI（「下载 42%」）→ 下载失败 → **自动切分步 + 短提示「下载失败 · 需配置 OSS 域名」**；
  mock `downloadFile` 成功返回真实临时文件 → **临时文件播放 timeupdate 推进**（§11.4 第 2 步）。
- 续播：播放后退出 → 本机 storage 写入 `{mode:'video',t:31,dur:225.6,at}` → 列表「继续 00:31」→ 重开（用
  `wx.request` 包装器给清单注入 `manifest.video` 模拟转换机补转后的场景）**默认原样播放且续播到 ~31s**。
- 截图 12 张（`_shots_ppt_video/`）：`01-list` / `02-step-hotspot` / `03-media-layer` / `04-video-playing` /
  `05-controls` / `06-download-progress` / `07-fallback-step` / `08-list-continue` / `09-resume` /
  `10-temp-file-playing` / `11-deck-error` / `12-mode-capsule-step`。
- **真机风险（必须用户做，无法自动化）**：微信开发者工具 `urlCheck=false` 才能直连 OSS；正式版必须把
  `https://tool-furina-fun.oss-cn-hongkong.aliyuncs.com` 加入 **request + downloadFile 合法域名**（香港默认域名能否过微信校验
  未查证）→ 需用户上传发布后**真机正式版验一张图 + 一段视频**；OSS 若开防盗链需放行空 Referer 与 `servicewechat.com`；
  OSS 的 `Content-Disposition: attachment` 对真机 `<video>`/`downloadFile` 的影响 devtools 无法代表，已在代码里按 §11.4 降级链兜底。

### ④ 测试（本机实跑）

```text
cd mp-class-tools-tests
node unit.js                 -> 337 passed / 0 failed   （307 + 新增 30；含 ppt 40）
node ppt_unit_tests.js       -> 40 passed / 0 failed
node ppt_video_unit_tests.js -> 30 passed / 0 failed
node sync_contract_test.js   -> 33 passed / 0 failed
python staticcheck.py        -> exit 0（23 页；handlers / 分享 handler 缺失 0）
node code_quality_check.js   -> 全部规则通过（退出码 0）
node ppt_video_preview.js    -> automator：38 passed / 0 failed（真实 deck + 真实 OSS 视频、截图 12 张、
                                `ppt_video_preview_result.json`；直连可播/下载 14MB 11–33s/临时文件播放/降级/续播全过）
```

### ⑤ 已知取舍（如实）

- 原样播放的视频节奏由转换机导出决定（单击动画合并为自动连续播放）；需要自主控制节奏时切「分步」；
- 视频比图片大（720p，16 页约 10–40MB；本 deck 实测 14MB/225s），弱网默认分步，可选择复制链接用浏览器下载；
- 小程序不提供「下载到相册」：仅复制链接（§11.3.4 允许的端能力）；全屏依靠 `pageOrientation:auto` + 自定义导航，
  没有浏览器 Fullscreen API 可调；
- 下载降级受微信 10 个并发/域名白名单限制，单文件超 180s 直接回退分步（不无限等待）；
- 真机 `<video>` 是否接受 OSS `attachment` 响应需用户真机验证（devtools 结论仅作参考）。

> **2026-11-10（待上传；代码版本仍 2.0.0）· 微信提醒（订阅消息）从未送达 · 根因修复**：用户反馈「我发现微信提醒功能从来没成功过，检查并修复」。
> 已用真实云端只读诊断 + automator 实证根因，非猜测（证据 `mp-class-tools-tests/_notify_fix_20261110/probe_diag.json`）。

### ① 根因（实证）
- 真实云开发环境 `fengdan-d6g7hnk4gf35685b3` 的 `subscriptions` 集合里，**4 条 2026-10-21～11-07 已到点的 active 提醒全部没被处理**
  （2 条 hw 作业截止、2 条 ntremind 通知提醒），`sentEver=0`、无任何 `lastError`（说明**一次发送都没尝试过**）。
- 云函数 `notify` 的定时器**心跳从未出现过**（部署修复前 `diag.hb=null`）→ 结论：`timer` 从未被调用。
- 根因 = **定时触发器从未真正上传到云端**：`cli cloud functions deploy` 与 IDE「上传并部署」都**只传代码、不传 config.json 的 triggers**；
  必须由开发者工具右键 `config.json` →「上传触发器」（2026-11-05 只做了 CLI 部署，QA 明确标注「触发器实际调度未在线证实」）。
  云函数本身可被小程序调用（list/subscribe 正常），所以前端显示「已设置提醒」但消息永远不会来。
- 附注：11-07 的 2 条提醒（`g_dorm` 20:00 / `药膳答题打卡` 11:55）是用户在已发布的 2.0.1 真机上设置的，同样没送达 —— 与本诊断一致。

### ② 修复
- **云函数 `cloudfunctions/notify`（已 CLI 部署，Active）**：
  - `timer()` 增加**定时器心跳**（`subscriptions/__notify_hb`，`action:'diag'` 可读，用于随时判定触发器是否在跑）；
  - 新增 **陈旧提醒守卫** `STALE_MS=6h`：到点超过 6 小时的提醒不再发送（避免触发器第一次跑起来时补发几天前的消息），
    直接 `active:false + skippedAt + lastError='stale:<h>h'`；边界内（≤6h）照常发送；
  - 新增 `action:'flush'`：前端 catch-up，**只处理调用者自己 openid** 的到点提醒（不传 openid 返回 no-openid；不碰他人）；
  - 新增 `action:'diag'`：只读聚合（心跳 agoMs/source、total/active/activeDue/各类 kind、sentEver、skippedStale、lastErrors 最近 10 条），
    **不返回 openid/ref**，可安全从小程序端调用；
  - `timer` 返回结构变为 `{ok,sent,stale,total,errors}`（`publishNotice/list/cancel/subscribe` 契约不变）。
- **小程序前端（源码就绪，待用户上传发布）**：
  - `utils/notify.js` 新增 `flushReminders()`（直接 `call({action:'flush'})`，不请求订阅授权、不需要点击）；
  - `app.js` 的 `warmSync()`（冷启动/回前台后 300ms）调用 `flushReminders()`，失败静默 —— 定时触发器之外的**第二道送达保障**；
    只补发本人到点提醒，离线/未授权不影响启动。
- **旧积压清理**：修复版部署后调用一次 `flush`，把 4 条陈旧提醒全部标 `stale` 跳过（**未发送**，避免打扰），云端 `activeDue=0`。

### ③ 用户需完成的一步（无法自动化）
- 微信开发者工具 **full mode** 打开项目 → 左侧 `cloudfunctions/notify` → **右键 `config.json`（或右键 `notify` 文件夹）→「上传触发器」**。
  （IDE 的触发器上传只在 renderer 右键菜单 → 主进程 batchCreateTrigger → 需登录态换 STS，CLI/HTTP/MCP 均无入口，已核实不可程序化；
  lite mode 窗口没有文件树，需普通项目窗口。）
- 上传后 1–2 分钟生效；验证脚本 `mp-class-tools-tests/_notify_fix_20261110/verify_trigger.js`（心跳刷新 = PASS）。
- 小程序前端这轮改动（flush fallback）**不急于发版**，可下次上传时一并带上；触发器修好后核心提醒链路即恢复。
- 「新通知提醒」（`kind='nt'`）仍无发布端调用方（网页发布通知走 CloudBase，不在微信云开发内），本轮不扩大范围，已在 README §九 标注。

### ④ 测试（本机实跑）
- 新增 `mp-class-tools-tests/cloudfunctions/notify_fix_20261110.test.js` → **18/18 PASS**（心跳/陈旧守卫/6h 边界/flush 只本人/diag 聚合与隐私/发送失败 attempts）。
- 新增 `mp-class-tools-tests/notify_flush_ui_test.js` → **10/10 PASS**（notify.js flush 契约、app.js warmSync 接线、云函数 diag/flush/心跳/守卫、config 触发器）。
- 回归：`cloudfunctions/notify.test.js` **35/35**、`node unit.js`、`node sync_contract_test.js`、`node notify_ui_test.js`、`python staticcheck.py` 见交付报告。
- 真实云端只读取证：`probe_diag.json`（修复前 hb=null/activeDue=4/sentEver=0 → 修复后 stale=4、activeDue=0）；诊断全程未发送真实订阅消息。
- 未验证：真实到点送达（需触发器上传 + 用户真实授权一次）；本轮未上传小程序、未改 `VERSION`（仍 2.0.0）。

## PPT 上传修复 + 演示图标（2026-11-10，待上传；代码版本仍 2.0.0）

> 用户反馈：「PPT 根本无法成功上传」「优化 PPT 功能的图标」。已用微信开发者工具 automator 在真实运行时复现并修复。
>
> **根因**：微信基础库 3.17.4 起 `FileSystemManager.openSync(path, 'r')` 旧签名失效（实测报
> `Cannot create property 'filePath' on string '...'`，新签名为 `openSync({filePath, flag})`），
> 而 `utils/ppt.js` 的 `readChunkBase64` 一直用旧签名 → 每一片文件都读取失败 → 上传必然中断（云端 0 分片）。
> 旧单测的 wx mock 里 `openSync` 永远返回 fd，掩盖了该问题；生产环境无法上传。
>
> **修复**：`utils/ppt.js`
> ① 优先 `readFile({filePath, position, length})`（2.10.0+ 支持分段）读取本片；长度与请求不符（旧库忽略 position/length 返回整文件）时
> 用新增纯函数 `pickChunkBuffer(data, offset, length)` 自行切片；
> ② 失败再按「`openSync({filePath,flag})` 对象签名 → `openSync(path,'r')` 旧字符串签名」回退 `openSync/read`；
> ③ 分片上传单请求超时放宽到 60s（`utils/cloud.js` 的 `cbPost` 支持 per-request `opts.timeout`）；
> ④ `utils/ppt.js` 导出 `pickChunkBuffer` 供单测。
> **图标**：`images/tool-ppt.png` 由 40×40 线条图改为 **96×96 白色实心「演示屏 + 播放三角 + 支架」**
> （与 `tool-draw`/`tool-hw` 等 96×96 图标同风格，1.5KB）；生成器 `mp-class-tools-tests/_make_ppt_icon.py` 同步更新。
>
> **验证**：`ppt_unit_tests.js` **40/0**（新增 pickChunkBuffer 3 组、readFile 分段/旧库切片、双签名回退、全失败 reject 等用例）；
> devtools automator 真实走页面上传 1MB 假 PPT：3 个分片请求均 **201**（其中 2 个 body ≈699KB）→ 提交 queued 成功；
> 「工具」页截图确认新图标渲染正常。真机微信仍需用户上传发布后生效。

## PPT 演示（「演示」工具）· 微信小程序端 — 2026-11-09（待上传；代码版本仍 2.0.0）

> 用户需求（2026-11-09）：「任意设备都能完整、流畅地播放 PPT；任何人可上传」——教室老电脑 PPT 动画多会卡死/无响应，
> 嵌入视频换机器就「媒体不可用」。方案：上传端只传源文件，本机转换机（Windows + PowerPoint COM）一次性渲染成
> **分步图片 + 外挂媒体（H.264 MP4 / AAC）**，三端播放器只加载图片/视频 → 老设备也能秒开。
> 契约唯一真源：`web/ppt/CONTRACT.md`（v1，含 2026-11-09 播放语义补充）；设计参考：`web/ppt/DESIGN.md`。
> 三端同做（本文件只记小程序）；**未改版本号（2.0.0）**、AI 保持 off、**源码完成待用户上传发布**。

### ① 新增页面
- **`pages/ppt/ppt`（列表 + 上传，4 文件）**：标题「演示」+ 右上「上传」主按钮；卡片流（封面 128×72 webp + 标题单行 + 元信息「38 页 · 管理员」+ 状态胶囊；`ready` 不显示胶囊）；转换机心跳横幅（同轮拉取，离线「转换机离线 · 排队任务中」不报错）；上传 = `wx.chooseMessageFile` 从聊天记录选 `.ppt/.pptx`（≤64MiB）→ 可改标题（默认文件名去扩展名 ≤80 字）→ 建行后**占位卡片先行**、封面底部 3px 进度条 → 512KiB 分片并发 ≤4 上传 → 自动 `queued`；失败胶囊「上传中断」+ 行内「重试」（上传中断=重选文件重传全部分片，转换失败=重新排队）；`⋯`/长按 → 重命名 / 下载原件 / 删除（仅本人）；取消上传二次确认后**清分片 + 软删**（不残留云端）；空态「还没有演示文件」+「从聊天选择」+ 一行小字「先把 .pptx 发到聊天」（全站唯一允许的说明句，设计稿指定）；可见时 10s 轮询（`onShow` 强拉、`onHide`/`onUnload` 停止）、下拉刷新；加载骨架 3 张。
- **`pages/pptplay/pptplay`（全屏播放器，4 文件）**：`navigationStyle:custom` + `pageOrientation:auto` + `disableScroll`；纯黑舞台、图片 `contain` letterbox；点击右 2/3 下一步、左 1/3 上一步、左右滑（阈值 40px 或屏宽 12% 取大）；**后退单位 = step，`step=0` 后退到上一页最后一步**；双图 A/B 交叉 + 契约 §7 页切换动效（fade/push/wipe/zoom/cover，同页切步 120ms 淡入；类名 a/b 交替保证连续切换可重触发）；底部自动隐藏控制条（`‹ 页码 + 页内步点 ›`｜缩略图/备注/黑屏/更多；步点仅当前页 step≥2 显示）；顶部 2px 进度条（按 step）+ 左上文件名 3s 淡出；缩略图抽屉（手机 62vh、点页跳转、当前页描边 + 多步页当前步短线）；备注抽屉（50vh、不透明底、空则「本页无备注」）；视频/音频热点 = 归一化坐标 × **图片实际渲染矩形**（letterbox 内），**点击才播**、媒体层独立全屏（原生 `controls`、`poster`=当前步图）、**不随 step 卸载（只在换页/退出销毁）**；黑屏（课堂单键，点任意处恢复且不显示 UI）；更多 → 下载原件（`manifest.src` → `wx.downloadFile` → `wx.openDocument`）/ 退出演示（有进度且不在末页时二次确认，系统返回手势亦拦截）；横竖屏 `onResize`+`onWindowResize` 重算 letterbox 与热点；退出释放图片/视频/音频/定时器/网络监听、关屏幕常亮。
- **`utils/ppt.js`**：契约 §4 全部接口走 `utils/cloud.js` 统一 request 通道（Bearer publishableKey + `X-Class-Token`）：`createDeck`（§4.1 建行字段/RLS `owner_sid=self`、`client='mp'`）、`sendChunk`（§4.2 upsert `resolution=merge-duplicates,return=minimal`）、`uploadChunks`（`wx.getFileSystemManager` 按 offset/length 读 ArrayBuffer → `wx.arrayBufferToBase64`，512KiB/片、并发 ≤4、失败重试 2 次 400/1200ms 退避、进度回调、可取消）、`submitDeck`（§4.3）、`listDecks`（§4.4 轻字段，不带 manifest）、`getManifest`（§4.5）、`patchDeck/softDelete/retryDeck/markUploadFailed`（§4.6；失败/取消都清理分片）、`heartbeat`（§3.4 `site_assets id='ppt_agent'`，180s 离线判定）、`pollRound`（§4.7 列表+心跳同一轮）、`openSource/openSourceUrl`（下载原件）；纯逻辑：deckId 生成、分片计数/区间、文件校验、manifest v1 归一化（未知字段忽略、缺字段默认、URL 解析、全局媒体表合并、缩略图兜底）、step 扁平序列/页码换算/进度/控制条文案/letterbox `fitRect`/热点矩形与圆钮/预加载计划/缩略图列表/状态文案/列表排序过滤/心跳视图/错误中文化——全部可在 Node 单测。
- **云表常量**：`utils/cloud-config.js` 与 `utils/cloud.js` 增加 `pptDecks:'ppt_decks'` / `pptChunks:'ppt_upload_chunks'` 表名 + 通用 `cbDelete`（本人在 RLS 下可删自己的分片，用于取消/失败清理）。
- **工程**：`app.json` 注册 2 页（不加 tabBar，共 23 页）；`utils/tools.js` 增 `{key:'ppt', name:'演示', icoImg:'/images/tool-ppt.png', url:'/pages/ppt/ppt'}`（可主动勾选进首页 ≤4）；新增 40×40 白色图标 `images/tool-ppt.png`（322B，媒体预算仍 <29KB/200KB），`VERSION` 保持 2.0.0。

### ② DESIGN / 契约落地要点（研究结论，勿回退）
- **`<image>` 全部带 `webp="{{true}}"`**（列表封面、播放器主图/缩略图）——否则真机 `.webp` 白图（DESIGN §3.2/§7-1）。
- 上传唯一入口 = 聊天记录选文件；空态按钮「从聊天选择」+ 一行小字（DESIGN §4.2/§7-10）。
- 图片加载失败：先降级 `thumb` 尺寸、再失败显示「图片加载失败 · 重试」并保留上一张图（不白屏、不阻塞翻页）；视频/音频失败：热点灰化「视频不可用」+ 不阻塞翻页。
- 预加载：当前步后 2 张 + 相邻页缩略图，`wx.downloadFile` 并发 4（≤6，官方上限 10）；2G/断网暂停预加载。
- 媒体层 z 高于舞台、打开时隐藏控制条/顶部进度；黑屏/错误/抽屉层级按 DESIGN §4.3（10/20/30/40/41/50/51/60）。

### ③ 测试（本机实跑，全部为真实输出）
- `node mp-class-tools-tests/ppt_unit_tests.js` → **38 passed, 0 failed**（A URL/格式化/文件校验、B deckId/分片/§4.1 建行 RLS 字段、C manifest 归一化容错、D step 序列/页码/进度/热点/预加载、E 状态文案/排序/心跳/错误文案、F 并发任务池/重试/取消/uploadChunks/readChunkBase64、G §4 云端接口 wx.request mock（建行/分片 upsert/列表 select/清单/软删/重试/失败清理/心跳轮询）、H 工程静态断言（app.json/tools/图标/4 文件/分享/webp/播放器配置/关键实现）、I 页面级（列表轮询过滤、聊天选文件→2 片上传→queued 端到端、播放器步进/点击左右 1/3/滑动/黑屏/媒体层生命周期/抽屉/退出释放））。
- `node unit.js` → **297 passed, 0 failed**（已挂载 ppt_unit_tests）。
- `node sync_contract_test.js` → **33 passed, 0 failed**（未改 UD v6 契约，仅工具目录新增作品）。
- `node tool_sort_unit.js` → **21 passed, 0 failed**（TOOLS 末尾新增 ppt，已同步顺序断言）。
- `node code_quality_check.js` → **全部规则通过（退出码 0）**。
- `python staticcheck.py` → **exit 0（23 页；handlers 0 缺失、分享 handler 0 缺失、分享封面齐全）**。
- **未跑 automator/真机**（无自动化端口；按约定页面靠静态检查 + WXML/WXSS 自查，**视觉与真机加载未验证**）。

### ④ 已知风险 / 待用户操作
1. **必须由用户在微信公众平台配置 OSS 域名**：把 `https://tool-furina-fun.oss-cn-hongkong.aliyuncs.com` 加入 **request 合法域名 + downloadFile 合法域名**（图片/视频/清单图片都直连 OSS）；香港地域 OSS 默认域名能否通过微信校验**未查证**，**发布前务必用真机正式版（非开发者工具/体验版）验一张图 + 一段视频**。
2. 若 OSS 开了防盗链：需放行空 Referer 与小程序固定 Referer `https://servicewechat.com/...`，否则 403「图全裂」。
3. 代码完成后**需用户上传发布**才在本机微信生效；版本号仍 2.0.0（用户要求发版前不改）。
4. 转换机需开机在线的 Windows+PowerPoint 主机；离线时任务排队（页面已显示「转换机离线 · 排队任务中」）。
5. 已知取舍（与契约 §1 一致，不掩饰）：逐段文字动画合并为整段出现、强调/运动路径只取每步最终态；超大文件（>60 页/媒体>200MB）转换慢或跳过该媒体；上传中断重试需重新选同一文件。

## 电费趋势 canvas 遮挡 + 诊断 v2（全班可见/设备诊断/AI 分析+修复流程）+ 课表登录（个人教务课表）— 2026-11-08（待上传；代码版本仍 2.0.0）

> 用户需求（2026-11-08）：① 电费趋势图的线会覆盖在宿舍选择框之上；② 诊断页加入使用设备诊断、异常自动上传云端、由 AI 扫描服务给出可能原因、云端易修复问题在本机在线时由本机直接修复并在诊断页展示流程、设备端问题给建议、诊断所有人可见；③ 课表登录入口（每人用自己的教务账号取自己的课表，解决体育课不同）。
> 三端同做（本文件记小程序）；未改版本号（2.0.0），AI 保持 off，**源码完成待用户上传发布**。云契约 `_diag_task/CONTRACT.md`；迁移 `web/deploy/cloudbase/2026-11-08_diag_login.sql`。

### ① 电费趋势 canvas 遮挡修复
- 根因：部分机型/基础库 canvas 非同层渲染（原生组件置顶），会盖住后打开的「宿舍选择」bottom-sheet / 低电阈值面板。
- 修复：`pages/power/power.wxml` 的 `#pwTrend` 改为 `wx:if="{{!trend.empty && !sheetOpen && !lowOpen}}"`；`power.js` 新增 `_trendOverlayOpen()`/`_redrawAfterOverlay()`，打开覆盖层时移除 canvas 并跳过绘制/触摸，关闭时 `setData` 回调 + `wx.nextTick` 复用已有数据重绘（**0 额外请求**）。

### ② 诊断 v2（pages/diag，全班可见）
- 去掉管理员门禁（onLoad/onShow/WXML/cloud 内 admin 判断）；仅保留「有效班级身份」。
- 新增本机诊断代理在线卡（`rpc/diag_agent_info`）；**设备诊断 10 项**：应用版本/设备与系统/屏幕与语言/基础库/内存+内存警告/本地存储/网络/云端网关延迟/site_assets/JS 错误数；异常自动上报 + 手动「重新检测/上报异常」。
- `client_diag` 上报（账号 token 归属 sid，detail/device 全脱敏；同指纹 10 分钟 1 条、每批≤3、失败静默）。
- AI 分析 + 修复流程卡：读 `diag_analysis`/`repair_tasks`（15s 可见轮询，本机在线状态、severity/cause/suggestion/fixable/action/status + flow 时间线）；保留 18 行/5 组服务健康与下拉/60s 刷新。
- `app.js`：`onError`/`onUnhandledRejection` 自动上报（仅已登录、去重限频、不阻塞）；内存警告计数。`utils/tools.js` diag 改 `noHome`（全班「全部工具」可见、不进首页勾选）。

### ③ 课表登录（个人 ttLocal）
- tt 页新增「登录教务」入口 + bottom-sheet（学号默认班级身份 sid、只读；密码 `password` 输入，提交后立即清空、不落 storage/日志）→ `rpc/tt_login_enqueue` → 1.5s 轮询 `rpc/tt_login_status` ≤120s（agent_offline/rate/pwd/auth/failed/expired 分别提示）→ 成功写 `store.ttLocal={c,t}` 并走 UD v6 `tt.ttLocal` 同步（与网页同字段）→ 立即切「我的课表」；优先级 **ttLocal（个人）> ttCache/site_assets（公共）**；「清除我的课表」回退。
- 本机代理（`C:\briefdesk\scripts\diag_agent.py` + `BriefdeskDiagAgent` 每分钟）负责解密/SSO/抓取，密码仅密文过云、用后清空。

### 测试（本机实跑；automator 由 Lead 统一运行）
- `node unit.js` **257/0**、`node v3_power_diag_tests.js` **60/0**、`node sync_contract_test.js` **33/0**、`python staticcheck.py` exit 0、`node code_quality_check.js` 全通过。
- automator：`power_canvas_overlay_preview.js` / `diag_v2_preview.js` / `tt_login_preview.js` 已写；Lead 另用真实只读云端脚本 `_lead_verify_20261108/lead_mp_verify.js` 实跑 **13 PASS / 0 FAIL / 0 console error**（覆盖层打开截图无趋势线、关闭恢复；普通成员诊断页 5 组 18 行 + 设备 10 项 + 本机代理在线 + AI 6 条；个人课表优先/登录入口/清空回退；截图 7 张）。
- 待上传后在真机复测（canvas 同层差异只有真机最明显）。

## 电费 13/16 号楼电表「日更」特异性统计 — 2026-11-07（待上传；代码版本仍 2.0.0）

> 用户需求：「对 16 号楼和 13 号楼的电量统计做特异性功能优化，避免因统计频次的不同导致观感不佳和功能失效」。
> 与网页同口径（规格 `web/tools/tests/power_cadence_spec.md` §1–§4）。

> 真实数据依据（2026-11-07 只读探测 `public.power_history`）：13/16 号楼 4 间房 47h 内各只有 **1 次**数值变化
> （均在 2026-11-06 09:46 同批）＝网关日更；对照 23A/23B 抽样 4 间 45–46 次、中位间隔 1.0h＝准实时。
> 原逻辑下 13号楼324 剩 67.72 度却显示 ≥30 天（实际约 6 天）；13-308/16-305/16-306 同样假 ≥30 天。

> 实现：
> - `utils/power.js`：常量 `CH=0.005 / MIN_SEG_H=6 / EXPECT_H=24 / SLOW_BUILDINGS=['13号楼','16号楼'] / SLOW_COVER_CHANGES=6`（L442-446）；
>   新增 `isSlowBuilding`（L447）/ `changesIn`（L459）/ `eventsOf`（L466）/ `slowStats`（L481）/ `estimateSlow`（L523）/
>   `isSlowRoom`（L533）/ `noUpdateText`（L539）/ `stepSegments`（L545）/ `changeDots`（L557），并全部导出（L758-764）。
>   `slowStats`：30d 真实变化点分段（`dq>0.05 && dtH>=6h` 有效用电段；中位阈值 `max(5,4×中位数)` 剔异常大跌；
>   1 段按预期 24h 折算 `ref=true`，≥2 段按时间加权 `ref=false`）。
> - `estimate` 加 §1.4 通用守卫（L385-405）：24h/7d 窗口真实用电均 ≤0.05 度 → `valid=false`「数据积累中」，
>   不再用 0.05 度/天下限伪造 ≥30 天；有效时才应用下限。`isSlowRoom` 含数据覆盖降级（24h 变化 ≥6 次 → 实时口径）。
> - `slowUpdate` 补 `lastChange/lastRecharge`（L417）；`tilesOf` 支持慢频（L569）：tile1 参考按 `est.ref`、
>   tile2 该区间无下降时副标「该区间无更新」、tile4 用 30d `lastRecharge`；`trendLine` 平线居中等（L622）。
> - `pages/power/*`：选中慢频房 `load()` 额外拉 30d（L333；缓存 5 分钟，3 窗口，失败不阻塞其它窗口）；
>   `pickRange`（L203）切档补 30d；`_renderData`（L404）慢/实时估算分流（L417-419）、hero 更新时间=lastChange /
>   「近 30 天无变化」（L446）；趋势头「日更」徽标（`power.wxml` L66-67、`power.wxss` L86）；
>   `_drawTrend`（L518）阶梯线 + 真实变化点 + 平线垂直居中 + 无更新提示。
> - 不改 UD v6（`power={sel,at,low}`）、`VERSION` 2.0.0、分享/隐私边界。
> - 测试：`v3_power_diag_tests.js` **53/0**（较基线 45 增 8：slowStats S1–S5/X1/S7、§1.4 守卫 L1/L2、
>   isSlowRoom 数据覆盖、noUpdateText/stepSegments/changeDots/tilesOf 慢频断言）；`unit.js` **254/0**、
>   `sync_contract_test.js` **31/0**、`tool_sort_unit.js` **21/0**、`staticcheck.py` exit 0、`code_quality_check.js` 全部规则通过；
>   automator `power_preview.js` **31/0**（0 console error），截图 `_shots_power_sync/09_daily_badge.png`、
>   `09b_no_update.png`；日志 `_power_cadence_work/FINAL_20261107-225104_*.log`。
> - **与并行会话「电费趋势气泡跟手」改动共存**（`utils/power.js cursorFollowLayout`、页面 `_cursorPos/_plotTop` 等，
>   `tip_follow_unit.js` 12 项已挂 `unit.js`）；两边改动合并后 mp 门禁全绿。
> - **仍需用户在微信开发者工具上传发布后生效**；代码 `VERSION` 仍 2.0.0。

## 电费趋势信息气泡改为「固定右上角」— 2026-11-07（待上传；代码版本仍 2.0.0）

> 用户需求：「把气泡直接不放在图内，而是在趋势图的右上角上部（不要放在图内）固定显示」。
> 本版替换同日第一版「气泡跟手」：气泡固定在趋势图右上角上部（区间行右侧、绘图区外），不随手指移动；
> 竖线 + 圆点仍对准最近真实采样点，拖动只更新文字与游标位置。

> 实现：
> - `pages/power/power.wxml`：新增 `.pw-trend-top` 包裹 `.pw-ranges` + 气泡 `.pw-cursor-tip`（移出 `.pw-trend-body`，绘图区外）。
> - `pages/power/power.wxss`：`.pw-cursor-tip` 改静态布局（`position:static; margin-left:auto; max-width:60%; text-align:right;
>   white-space:normal`），删除 absolute/transform/`--below` 变体；新增 `.pw-trend-top` flex 行。
> - `pages/power/power.js`：`cursor` 数据简化为 `{on,left,top,text}`；`_showCursor(frac)` 只 setData 竖线/圆点 + 文字；
>   删除 `_placeCursorTip/_cursorSeq/_cursorPos/_plotTop/CURSOR_TIP_*` 与指针 y 传递。
> - `utils/power.js`：移除跟手定位 `cursorFollowLayout`；旧 `cursorTipLayout`/`estimateCursorTipSize` 保留（历史单测）。
> - 测试：新增 `tip_fixed_unit.js` **5/5**（已挂 `unit.js`）；回归 `v3_power_diag_tests` **53/53**、`unit.js` **247/247**、
>   `sync_contract_test` **31/31**、`staticcheck.py` exit 0、`code_quality_check.js` 通过。
> - 仍需用户上传发布；代码 `VERSION` 仍为 2.0.0。


## 修复：电费趋势拖动到边界时气泡被裁切/遮挡 — 2026-11-07（待上传；代码版本仍 2.0.0）

> 用户 10:51 反馈（上传 2.0.1 后）：电费趋势拖动接近边界时气泡内容被覆盖/裁切。
>
> 根因：拖动的每一帧先按未 clamp 的命中点 x/y 渲染气泡，`createSelectorQuery` 实测回调返回前（连续拖动时尤其明显）
> 气泡会越出 `.pw-plot` 边界，被 `.pw-plot { overflow: hidden }` 裁掉；另外气泡与 y 轴覆盖层 z-index 同级，存在被遮挡风险。
>
> 修复：
> - `utils/power.js` 新增 `estimateCursorTipSize(text)`；页面 `_showCursor` 先用**文字估宽 + `cursorTipLayout` 预 clamp**
>   再 setData（首帧就不越界），实测宽高回来后再精修。
> - `_placeCursorTip` 对「节点/尺寸未就绪（width/height=0）」延迟 80ms 重试一次；重试仍失败保留预 clamp 安全值，不崩。
> - 气泡 DOM 从 `.pw-plot` 内移到 `.pw-trend-body` 内（绘图区外层），从根上避开 `.pw-plot overflow:hidden` 的裁切。
> - `.pw-cursor-tip`：`z-index:4`（高于 y 轴 3）、`max-width: calc(100% - 44rpx)`、字号 20rpx / padding 3rpx 12rpx，
>   边界处不裁字、不被坐标轴遮挡。
> - 测试：`node unit.js` **234/0**、`node v3_power_diag_tests.js` **45/0**（新增 estimate 单测、预 clamp 左边界不越界、
>   测量失败保留安全初值、静态断言「气泡在绘图区外层」）、`cache_unit_tests` **18/0**、`sync_contract_test` **31/0**、
>   `staticcheck.py` **exit 0**、`code_quality_check.js` 通过；automator 未运行（无 9420 端口）。
> - 仍需用户上传发布；代码 `VERSION` 仍为 2.0.0（与微信后台上传版本号 2.0.1 是两套编号）。

## 电费趋势点击改网页版样式（深色浮层气泡 + 真实采样点圆点）— 2026-11-07（未发版；版本号保持 2.0.0；未上传发布）

> 用户需求（2026-11-07 09:42）：「把小程序的电费趋势曲线点击做成网页版的样式」。
> 参考 `web/tools/index.html` 的 `POWER.detail*` / `POWER.placeTip` / CSS `.pw-detail*`：点击/左右拖动按 x 命中
> 最近**真实采样点** → 竖直游标线 + **真实采样点 y 位置的圆点**（不再固定 50% 高度）+ **深色浮层气泡**
> 「HH:MM / MM-DD HH:MM · 电量 xx.xx 度」；气泡默认在点上方、越界翻到下方并 clamp；同一采样点再点取消、
> 拖动松手保留、切区间清除；无横滑。只改小程序电费页/工具函数与测试，**不改 web、不改其它页面样式、不上传发布**。

### 1. 纯函数 `cursorTipLayout`（utils/power.js）

- 新增 `cursorTipLayout(x, y, cw, plotH, tipW, tipH, pad)` → `{left, top, below}`：
  - 水平：气泡盒（宽 tipW）整体 clamp 在 `[pad, cw-pad]`，`left` 返回气泡中心（WXML `translate(-50%,…)`）；
    窄容器时气泡宽按可用宽截断、`left = cw/2`（限宽不越界）。
  - 垂直：默认点上方（`below=false`，锚点 `top=y-8`，`translate(-50%,-100%)` → 气泡占 `[top-tipH, top]`）；
    上方放不下（`y-8-tipH < pad`）→ 翻到下方（`below=true`，锚点 `top=y+10`），下方再按
    `[pad, plotH-pad-tipH]` clamp；容器过矮/入参非法（NaN/字符串/0）返回有限安全值，绝不 NaN/抛错。
- 与网页 `POWER.placeTip` 同口径（pad=6，上方 -8 / 下方 +10、水平 `pad+tw/2 ~ cw-pad-tw/2`），并补充了
  移动端窄屏限宽与非法入参兜底。

### 2. pages/power：游标几何与气泡实测（pages/power/power.js / .wxml / .wxss）

- `_drawTrend`：绘制常量抽为 `PLOT_PAD_X=6 / PLOT_PAD_T=12 / PLOT_PAD_B=10`，并记录实际绘图高
  `this._plotH = H`（canvas 节点实测高）；canvas 绘制参数/视觉不变。
- `_cursorFrac`：clientX → 绘图区比例后**反解 canvas 坐标系**（扣掉左右 padding），命中点与折线严格对齐。
- `_showCursor(frac)`：`power.nearestPoint` 找最近真实采样点 → 计算实际像素
  `x = padX + p.x*(cw-2padX)`、`y = padT + p.y*(plotH-padT-padB)`（y 为 0..1 归一化，0=最高电量，未弄反）→
  先 setData `cursor {on,left,top,tipLeft,tipTop,text,below:false}`（气泡默认点上方），再在 setData 回调里
  `wx.createSelectorQuery()` 实测 `.pw-plot` 与 `.pw-cursor-tip` 宽高，用 `cursorTipLayout` 修正
  `tipLeft/tipTop/below`；`_cursorSeq` 防抖只应用最后一次点击/拖动的测量结果；节点缺失或测量失败保留原值不崩。
- 游标数据拆两组坐标（网页同款视觉所必需）：`cursor.left/top` = 竖线/圆点（真实采样点，不被 clamp 移动），
  `cursor.tipLeft/tipTop/below` = 气泡锚点（水平/垂直 clamp、越界翻到点下方）。`_renderData`/清档/换宿舍/
  清游标统一重置 `cursorOff()`（含 `below/tipLeft/tipTop`），并递增 `_cursorSeq` 作废旧测量回调。
- touch 语义不变：`onTrendTouch/onTrendTouchMove/onTrendTouchEnd` 原样；同一采样点再点取消、拖动松手保留、
  空态跳过、`catchtouchmove` 不触发页面滚动。
- WXML：`.pw-plot` 内新增 `.pw-cursor-tip`（`wx:if cursor.on`，`style="left:{{cursor.tipLeft}}px;top:{{cursor.tipTop}}px"`，
  `below` 变体给 `--below` class）；圆点改为 `style="top:{{cursor.top}}px"`；**删除底部可见的 `.pw-cursor-info`
  信息胶囊**，游标文案改挂 `.pw-plot` 的 `aria-label="{{cursor.on ? cursor.text : ''}}"`。
- WXSS：气泡深色 `#25332F` + 白字 + 10rpx 圆角 + `0 10rpx 28rpx rgba(20,30,27,.28)` 阴影 +
  22rpx/tabular-nums + `white-space:nowrap; max-width:80%; overflow:hidden; text-overflow:ellipsis`，
  `transform: translate(-50%,-100%)`，`.pw-cursor-tip--below { transform: translate(-50%,0) }`；
  圆点 `translate(-50%,-50%)` 居中；竖线保留；区间 chips/图例/坐标轴/其它页面样式零改动。

### 3. 测试（全部 Node 内存 mock；未跑开发者工具）

- `node v3_power_diag_tests.js` → **45 passed / 0 failed**（原 43，+2）：
  - 新增「cursorTipLayout 7 组边界」（正常/左/右边缘、顶部翻转、底部、窄宽、极矮 clamp、非法入参）；
  - 新增「游标气泡实测修正」：mock `.pw-plot`=263×130 / `.pw-cursor-tip`=120×24 —— 中点不 clamp、左/右边缘
    水平 clamp、顶部翻下方、窄屏居中、测量失败保留初值、连续两次点击只应用最后一次（防抖）；
  - 原 v6 游标用例断言同步到新坐标（left = padX + x*(cw-2padX)、圆点真实 y、气泡 below/tipLeft 初值），
    同点取消后断言位置/文案归零；工程静态断言同步（气泡类名/深色/transform/aria-label/无 `.pw-cursor-info`/
    `_plotH`/PLOT_PAD_T/B/`cursorTipLayout`/`_cursorSeq`）。
- `node unit.js` → **234 passed / 0 failed**（含 v3 45 项）。
- `node cache_unit_tests.js` **18/0**、`node sync_contract_test.js` **31/0**（未涉及，确认无回退）。
- `python staticcheck.py` → **exit 0**（21 页、handlers/分享 handler 0 缺失、total bytes 1,902,674）；
  `node code_quality_check.js` → 全部规则通过。
- automator（`power_preview.js` / `power_trend_entry_preview.js`）：本机无 9420 自动化端口（开发者工具开着但未
  `cli auto` 起自动化会话），**未运行**；两脚本只读 `page.data.cursor.on/left/text` 与 `.pw-plot` 布局，
  不含 `.pw-cursor-info`/旧圆点选择器断言，**无需改断言**；需 Lead 在 automator 会话复跑确认截图
  （建议补一张游标气泡截图：中段/左右边缘/顶部翻转）。

### 4. 约束 / 已知限制 / 回滚

- 版本号仍 2.0.0（未上传/发布）；未改 `web/`、`C:\briefdesk`、计划任务、其它页面视觉。
- 气泡为移动端异步实测定位：首帧先按点上方渲染，再按实测宽高修正（通常同帧内完成）；若 `.pw-cursor-tip`
  节点/尺寸取不到，保留点上方初值（不崩、不跳）。`below` 判定以气泡实测高为准，极端字体缩放下气泡可能比
  预期高，仍会被下方 `[pad, plotH-pad-tipH]` clamp 限制在绘图区内。
- 回滚：`utils/power.js`（删 `cursorTipLayout`/导出）、`pages/power/power.js`（`_showCursor`/`_placeCursorTip`）、
  `.wxml/.wxss`（恢复信息行与旧圆点）三处；无数据/云端/同步契约改动。

## 课表去域名化（CloudBase site_assets 优先）+ 诊断 18 行 5 组 — 2026-11-07（未发版；版本号保持 2.0.0；未上传发布）

> 背景：用户即将「挑选时间把 furina.fun 的解析**全部暂停**，网页暂时暂停使用」。
> 本条目只改小程序侧数据源与诊断语义，严格按唯一契约 `web/tools/tests/dns_pause_tt_health_spec.md` §4/§6：
> **不改视觉样式、不改版本号（仍 2.0.0）、不改其它功能、不上传发布、不执行微信开发者工具自动化**。
> 写权限内改动：`utils/cloud-config.js`、`utils/cloud.js`、`utils/diag.js`、`mp-class-tools-tests/unit.js`、
> `mp-class-tools-tests/v3_power_diag_tests.js`、本文档与 `README.md`。

### 1. 课表改读 CloudBase（不再硬依赖 tool.furina.fun）

- `utils/cloud-config.js`：新增 `tables.siteAssets = 'site_assets'`；`ttUrl` 保留为 **legacy 兜底**。
- `utils/cloud.js → ttFetch(force)`：
  - 保留身份守卫 / 云开关 / cloudOff / 6h TTL 缓存命中（TTL 内 0 请求直接返回 `store.ttCache`）。
  - **CloudBase 优先**：`GET {restBase}site_assets?select=body,meta&id=eq.tt`，走统一 `request` 通道
    （`Authorization: Bearer <publishableKey>` + `X-Class-Token`）；取 `list[0]`，`body` 兼容 JSON 字符串
    （`JSON.parse`），校验 `body && Array.isArray(body.c)`；成功 `touchSync('tt')` 并返回 body
    （与旧 `tt.json` 同构 `{c,t,meta}`）。
  - **失败回退 legacy**：网络 / 404 / 空行 / 格式错 / 旧配置没有 `tables.siteAssets` → `wx.request`
    GET `CONFIG.ttUrl`（**不带身份头**，保持既有兼容语义）；成功同样 `touchSync('tt')`。
  - 两者都失败 → reject；调用方（`pages/tt`、`pages/index`）原有 catch 保留本机缓存、不阻塞页面。
- 云端表 `public.site_assets`（id='tt' 行：body=课表对象、meta={source,fetchedAt,...}，RLS 有效班级 token 可读）
  由 cloud-tt 负责建表与回填；小程序仅读。表暂未建好时 CloudBase 失败 → 自动回退 legacy，不报错。

### 2. 诊断与网页端完全一致（5 组 18 行）

- `utils/diag.js`：
  - GROUPS：`站点与网页`(site_static, site_tls, dns_domain) / `云端后台`(cloudbase, tt_cloud, cloud_power_sync,
    cloud_xgj_sync, cloud_health_probe) / `信息采集` / `定时任务` / `采集主机`。
  - NAMES 新增：`dns_domain=域名解析`、`tt_cloud=课表云端数据`、`cloud_power_sync=电费云同步`、
    `cloud_xgj_sync=学工记云同步`、`cloud_health_probe=云端巡检`；KINDS 这 5 个均 `cloud`。
  - **cloud 行新鲜度**：以 `cloud_health_probe.checked_at` 为巡检心跳；缺失 / >15 分钟时，其它 `kind=cloud`
    行状态为 `ok` 的改为 `warn` 并在 detail 追加「· 巡检未更新」（`cloudbase` 的浏览器实时延迟覆盖除外；
    `kind=static` 的站点行不参与，由云端暂停语义控制——`status=warn` 的暂停行直接展示「注意」）。
  - `build(ctx)` 入参/出参结构与 `pages/diag` 调用完全兼容；旧的 `site_static`/`jwxt` 无行时用
    `ttCache.meta.fetchedAt` 兜底逻辑保留。

### 3. 测试（全部 Node 内存 mock，不发真实请求；未跑开发者工具）

- `node unit.js` → **232 passed / 0 failed**：新增/改写 §7「课表请求统一出口」2 项——
  「ttFetch 优先 CloudBase site_assets（断言请求 URL/方法/带 `X-Class-Token`、body 字符串解析、返回同构）」
  与「site_assets 失败（404/空行/旧配置无表）→ 回退 legacy ttUrl（不带 token）」；
  §7c 课表进入速度 3 项断言同步为「onShow 同步发出 site_assets 请求」（原先断言 tt.json）。
- `node v3_power_diag_tests.js` → **43 passed / 0 failed**（原 41，+2）：
  4 组 13 行 → **5 组 18 行**、新名称/KINDS；新增「云端巡检缺失/超 15 分钟 → 其它 cloud 行 ok→warn +「· 巡检未更新」」
  与「站点暂停语义：云端 status=warn 的暂停行显示「注意」、不被巡检过期改成异常」；
  诊断页管理员用例同步 5 组 / 18 行。
- `node cache_unit_tests.js` → **18 passed / 0 failed**（6h TTL 命中 0 请求行为不变）。
- `node sync_contract_test.js` → **31 passed / 0 failed**（cloudOff 时 ttFetch 仍 0 请求、reject `cloud-off` 不变）。
- `python staticcheck.py` → **exit 0**（21 页、handlers/分享 handler 0 缺失、total bytes 1,886,507）；
  `node code_quality_check.js` → 全部规则通过。

### 4. 发布/域名说明（用户侧动作）

- **服务器域名**：CloudBase 网关域名必填（课表已走 `site_assets` 主链路）；`tool.furina.fun` **仅 legacy 兜底**，
  可不填，暂停 DNS 后该兜底自然失效，不影响主链路。若后续想彻底移除旧链路，可在下一次发版删除 `ttUrl` 兜底。
- **版本号 2.0.0 未改**（用户要求直到成功上传发布不改）；**未上传、未发布**，需用户手动上传发布。
- 回滚：三处 utils 改动均为加法/小范围替换（`tables.siteAssets`、`ttFetch` 数据源顺序、diag 分组/名称/降级），
  回滚只需恢复这三个文件；无云端 DDL 变更、无数据迁移、不影响既有同步契约。

## 课表进入速度（缓存先显示当前周）+ 电费趋势偶发「数据积累中」自动恢复 — 2026-11-06（未发版；版本号保持 2.0.0，AI 保持 off；待用户上传发布）

> 用户需求原话：「优化课表的加载速度，例如以先加载当前周保障进入速度，同时修复有时进入电费界面时趋势显示统计中，
> 需要刷新才出现的问题。」并要求**用微信开发者工具自动化接口（miniprogram-automator）做操作测试与屏幕获取**
> （不屏幕操作、不 preview 推手机）。
> 只改 `mp-class-tools/pages/tt/tt.js`、`pages/power/power.js`、`utils/cloud.js`（电费历史缓存）与测试；
> **不动网站 `web/`、不动云端 DDL/RLS、不上传发布、不改版本号（2.0.0）、AI 保持 off**。

### 1. 课表进入速度（先加载当前周）

- **根因**：`pages/tt/tt.js` `onShow` 先 `loadCached()` 同步渲染本机当前周缓存，随后 `if (this._first)` **无条件**
  `setData({ state: 'loading' })` 把课表盖成「课表加载中…」骨架，并且 `setTimeout(…, 120)` 后才 `loadRemote()`；
  `ttFetch` 6h TTL 过期时走网络（0.5–2s）→ 本机明明有缓存也要等网络，进入慢。
- **修复**（`pages/tt/tt.js`，+16/−4）：新增 `_hasLocalTt()`（分享课表 > `store.ttCache.c` > 旧 `store.course`）；
  loading 仅在本机**没有任何课表数据**时设置；删除 120ms 人为延迟，`onShow` 立即后台静默刷新（成功才 `refresh()`
  覆盖，失败保留缓存）；页面结构/样式/滑动/换周/导出/分享零改动。
- **效果**（automator 实跑，390 宽）：`onShow → 首帧 data = 0–2ms`；有缓存首帧即第 5 周当前周（5 个星期列、
  无 loading 采样），首帧早于 tt.json 返回（mock 延迟 800ms）；网络返回后静默 3→4 门 + 来源变「教务 M/D HH:MM」并落盘；
  无缓存对照组仍先「课表加载中…」骨架、网络返回后转数据。

### 2. 电费趋势「数据积累中」需刷新才出现

- **根因**（Node mock 复现，三处叠加）：
  1) `utils/cloud.js` `powerHistory` 把网络失败与 HTTP 200 空数组都当 `[]`，旧实现**把空数组也写进 5 分钟缓存**
     → 首轮失败/空之后 5 分钟内每次进页/切区间命中空缓存（0 请求、趋势一直空），只有手动刷新（force）才恢复；
  2) `pages/power/power.js` 首次进入只 `load(false)` 一次，row 成功但 24h 历史 <2 点时无任何补救；
  3) `_drawTrend` 在 canvas 节点未就绪时静默 `return`，无人重绘（潜在空白）。
- **修复**：
  - `utils/cloud.js`：`powerHistory` 仅**非空**结果写缓存（失败/空不缓存；`POWER_HIST_TTL=5min` 与 force 契约不变）；
  - `pages/power/power.js`：`load(force, silent)`；新增 `_autoRetrySparse(rv, rng)` —— row 成功但 24h 历史 <2 点时
    650ms 后自动静默重试一次（force 绕缓存），每个「宿舍+区间」最多 1 次、不循环，换宿舍/区间/离页自动放弃，
    成功后自动重绘趋势；`_drawTrend` 节点未就绪时 180ms 补一次重绘（每次渲染最多 1 次）；`onUnload` 清理定时器。
  - 真实数据不足（只有 1 个采样点）最终仍显示「数据积累中」，不伪造数据。
- **效果**（automator 实跑，**全程不点刷新**）：首轮 history 网络失败 → 自动重试后 24h 折线自动出现
  （11 点、382 度；请求有界 history=6/row=2，观察窗 0 新增）；首轮 HTTP 200 空 → 自动出图（history=4/row=2）；
  正常数据 0 额外请求（history=2/row=1）；真实仅 1 点 → 恰 1 次重试后停止、仍「数据积累中」。

### 3. 验证（2026-11-06 20:5x，Lead 实跑）

- `node unit.js` → **226 passed / 0 failed**（新增 6 项课表进入速度用例 unit.js §7c L1389-1600；含此前 6/7 天缩放
  与并行会话的用例）。
- `node v3_power_diag_tests.js` → **38 passed / 0 failed**（基线 33，+5 电费用例；连跑 3 次稳定）。
- `python staticcheck.py` → **exit 0**（21 页、handlers/分享 0 缺失、total bytes 1,843,142）。
- **微信开发者工具 automator**（miniprogram-automator，模拟器 390 宽，Lead 统一运行；未用屏幕/鼠标操作、
  未 `preview`/`auto-preview` 推手机）：
  - `node tt_entry_preview.js` → **20 PASS / 0 FAIL / 0 console error**，截图 `_shots_tt_entry/`
    （`00-cache-entry-current-week` / `01-no-cache-skeleton` / `02-no-cache-after-network` / `03-cache-after-network`）；
  - `node power_trend_entry_preview.js` → **31 PASS / 0 FAIL / 0 console error**，截图 `_shots_power_trend_entry/`
    （变体 A 首轮失败自动出图 / B 首轮 200 空自动出图 / C 正常 24h / D 真实 1 点仍数据积累中）。

### 4. 约束 / 已知限制 / 回滚

- 未改版本号（2.0.0）、AI 保持 off、未动云端 / `web/` / 其它页面；无同步契约与数据结构改动。
- 断网等两次都失败仍需手动刷新（原兜底不变）；非首次 onShow（页面实例存活、选择未变且趋势空）不重新 load（原有行为）。
- `tt_entry_preview.js` 场景 B（无缓存对照组）mock 延迟由 800ms 调整为 **4000ms**：devtools `reLaunch` 返回可能
  1–2s+，需保证返回后仍能观察到骨架；A 场景仍 800ms，不影响「首帧早于网络」断言。
- 改前备份：`mp-class-tools-tests/_backup_tt_entry_20261106/`（tt.js）、`_backup_power_trend_20261106/`
  （power.page.js/cloud.js/v3 tests）；回滚 = 覆盖回对应文件（无数据迁移 / 云端操作）。

## 工具页：长按拖动排序 + 首页工具主动勾选 — 2026-11-06（未发版；版本号保持 2.0.0，AI 保持 off；待用户上传发布）

> 用户需求原话：「把微信小程序的工具排序方式也同步为此方式，但不必加按钮，改为使用一定说明文字让用户知道可拖动，
> 微信小程序的首页工具从自动前四个改为用户主动勾选」。用户确认口径：拖动对象 = 全部工具列表；首页快捷 = 勾选的工具
> 按该顺序显示；默认保留现有前 4 个为已勾选。
> 只改 `pages/all/*`、`pages/index/*`、`utils/{tools,store,cloud}.js` 与测试；**不动网站 `web/`、不动云端 DDL/RLS、
> 不上传发布、不改版本号（2.0.0）、AI 保持 off**。

### 更新内容

- **工具页（pages/all）改版**：删除右上「调整」按钮与 bottom-sheet 排序弹层（↑/↓ 与 orderList 状态），并**移除顶部「首页快捷」工具行**（页面主体只保留「全部工具」）；普通模式**没有任何勾选框**：点工具打开、长按 350ms 拖动排序（说明文字「长按工具可拖动排序」）。首页快捷改为**按钮进入编辑模式**：标题行右侧固定按钮 `#home-edit-btn`（「编辑首页」⇄「完成」）→ 编辑态说明文字变「点工具加入或移出首页快捷（最多 4 个）」，点工具 tile 切换是否加入（不打开工具，选中显示主色描边 + 对勾徽标 `#tile-home-mark-<key>`，未选中空心圆），勾满 4 个再点第 5 个 → `wx.showToast`「最多选 4 个」且状态不变，编辑态禁用长按拖动，点「完成」退出；勾选结果在工作台「常用工具」展示。
- **长按拖动排序**：350ms 长按 → `wx.vibrateShort` 轻震 + fixed 跟手幽灵（图标 + 名称 + 抬起阴影，原 cell 弱化）；按 2 列网格行/列 + 迟滞实时重排；指针距屏幕上下边缘 120rpx 内自动滚动（80ms / 14px 步进，滚动后重取几何）；拖动中 `page-meta page-style=overflow:hidden` 锁页面滚动（`onPageScroll` 兜底重排几何）；松手 `tools.setToolOrder(全部 key)`（本机偏好落盘 + 按新顺序重排勾选集合，`homeToolsAt` 变化才触发 UD 同步）；拖动后 350~700ms 抑制一次 tap，避免拖完误开工具；保留 AI handoff 的 focusKey 高亮/滚动定位与分享。
- **工作台（pages/index）**：常用工具 = 勾选工具（≤4，不再自动前 4）；无勾选时显示引导空态「尚未勾选常用工具」（点按 switchTab 去工具页勾选）。
- **数据语义（与网页 UD v6 共用 `homeTools`）**：`homeTools` = 用户勾选集合（≤4；只去重/过滤 visible+非 admin+非 noHome，**不再自动补齐**）；`toolOrder` = 本机「全部工具」顺序（不进 UD、不随账号同步、不导出，同网页 `zq_all_order_v1` 定位）；旧版「全量顺序」首次读取迁移：前 4 个可上首页 = 勾选、全量顺序 = toolOrder；取消全部勾选会持久化为空数组（重进/重载不回退默认，靠 `at` 语义区分主动清空与无数据）。云端 `udApply` 只应用 head ≤4（删除旧 `head.concat(tail)`），空数组按 `at>0`（主动清空）才应用、`at=0` 不覆盖本机默认。
- **口径调整**：`water`（水量）去掉 `noHome` → 可被勾选进首页；`power`（宿舍电费）仍不参与勾选（工作台已有独立电费卡，与网页一致）。

### 改版（2026-11-06 20:45，旅行者要求）：按钮进入「首页快捷编辑模式」+ 移除顶部快捷展示

> 用户原话：「不要直接加勾选框，而是添加按钮使用户点击时开始首页快捷栏编辑方式，移除最上方的首页快捷工具展示。
> 注意请利用微信开放工具的自动化接口来进行操作测试和屏幕获取，而不是用屏幕操作的方式，也不要在测试时把页面推送到我的手机。」

- **交互定稿**：普通模式无勾选框；标题行右侧「编辑首页」按钮 → 编辑模式（按钮变「完成」，说明文字变「点工具加入或移出首页快捷（最多 4 个）」）；编辑态点 tile 切换首页快捷（不打开工具）、选中 tile 主色描边 + 右侧对勾徽标、未选中空心圆；勾满 4 个第 5 个 toast「最多选 4 个」；编辑态禁用长按拖动；点「完成」退出；`onShow` 强制退出编辑态（切页/回前台重置）。顶部「首页快捷」工具行删除（**勾选结果只在工作台「常用工具」展示**）。
- **实现范围**：`pages/all/all.{js,wxml,wxss}`（删 quick/q-row/`tool-check`；增 `editMode`/`toggleEditMode`/`onToolTap`/`toggleHome`、`.all-edit`/`.tool-cell--home`/`.tool-home-mark`；长按拖动保留，编辑态在 `onToolTouchStart`/`_beginDrag` 直接 return）。
- **测试（严格按要求：只用微信开发者工具自动化接口）**：`tool_sort_preview.js` 重写 → **31/0 PASS、0 console error**（automator 9436 + `mp.screenshot` 截图；覆盖：无顶部快捷区、普通态无勾选框、按钮/文案、进入编辑态、清空→点选 4 个、第 5 个被拒 toast、取消一个、完成退出、工作台 quick 顺序、普通态长按拖动仍生效、编辑态禁拖、relaunch 持久化）；`tool_sort_unit.js` 19/0（静态/方法断言同步新 UI，保留数据层/UD 契约）；`unit.js` 215/0、`sync_contract_test.js` 31/0、`staticcheck.py` exit 0。**未使用 pyautogui/win32gui/屏幕截图，未跑 `cli preview`/`auto-preview`/真机预览（不向手机推送页面）**；编译/页面加载通过 `cli.bat auto --project ... --auto-port 9436 --trust-project` 验证。
- **验收后修正（独立验收 P2，已修）**：`#home-edit-btn` 实测点按高度 29.3px（< 40px 设计口径）→ `.all-edit` 改为 pill 按钮：`display:inline-flex; min-height:80rpx; padding:0 28rpx; background:var(--md-primary-container)`（编辑态「完成」为主色实底），点按热区 **80rpx×≥40px**，视觉上也明确是按钮；改后复跑 `tool_sort_preview.js` **31/0**（截图已刷新）、`tool_sort_unit.js` 19/0、`unit.js` 226/0、`staticcheck.py` exit 0。
- **独立验收**：另一位 QA 只用 automator（9437 + mp.screenshot）独立复验 **41/41 PASS / 0 console error**，结论 PASS；报告 `mp-class-tools-tests/_tool_sort_verify2/VERIFY_REPORT2.md`。

- **截图**：`mp-class-tools-tests/_shots_tool_sort2/00~10.png` + `result.json`（浅色主题，390×753 模拟器）。

### 验证

- `node unit.js` **215/215**、`node sync_contract_test.js` **31/31**、`python staticcheck.py` exit 0（handlers/share 缺失 0）。
- 新增 `tool_sort_unit.js` **18/18**：默认勾选 4、去重/非法过滤、勾选上限 + toast、取消勾选、按 toolOrder 排序、旧 7~8 项迁移、未知工具补末尾、quickList/catalog 顺序、moveTool/setToolOrder 落盘、空勾选持久化、`udSections` ≤4 且不含 toolOrder、`udApply` 远端 2 项不恢复 tail、空数组 at 语义、导出隐私、页面静态断言。
- 新增 `tool_sort_preview.js`（miniprogram-automator，390×844，mock 身份）：**38/38 PASS、0 console error** —— 说明文字存在、无「调整」按钮、勾第 5 个 toast、取消勾选、长按真实 touchstart/move/touchend 拖动 draw→第 1 位、幽灵/页面锁滚动、落盘（data + `zq_tools_v2.toolOrder`/`homeTools`）、工作台快捷顺序、空勾选空态、relaunch 持久化。
- 截图：`mp-class-tools-tests/_shots_tool_sort/00~10.png` + `result.json`（暗色主题）；`cli.bat auto-preview` 编译通过。
- 既有断言最小适配：`unit.js` 4 条（defaultHome/normalize/moveTool/quickList 新语义）、`water_unit_tests.js` 1 条（water 可勾选）、`sync_contract_test.js` 1 条（homeTools 整体应用、不保留第 5+ 位尾序）、`ia_preview.js` 排序弹层段改为「说明文字/无调整按钮/勾选控件/第 5 个被拒」。

### 验收后修正（独立验收 P2，Lead 收口）

- P2-1（真实边界，已修）：`utils/tools.js` 的旧默认迁移只应在 `homeToolsAt===0`（从未改动）时触发；否则用户自定义 toolOrder 后把勾选减到 `draw/hw/nt`（与旧默认同形）会被误迁移回默认 4 个。已加条件 + 永久回归用例（`tool_sort_unit.js` 19/19）。
- P2-2：`pages/all/all.json` 删除未使用的 `bottom-sheet` 组件声明。
- P2-3：`pages/ug/ug.js`、`ai/skills/identity/apis/getUsageGuide.js` 的「工具与排序」文案改为长按拖动 + 编辑模式勾选的说明（不再写「点调整 ↑/↓」）。
- P2-4：`agent/page-meta.json` 的 `pages/all` 描述同步新交互。
- 复跑：`unit.js` 215/0、`sync_contract_test.js` 31/0、`tool_sort_unit.js` 19/0、`staticcheck.py` exit 0、`auto-preview` 编译通过。

### 云同步补齐：工具页自定义顺序（2026-11-06 21:00，旅行者要求）

> 用户原话：「注意检查工具的自定义顺序和首页是否有进入云同步并正常运行」。

- **结论（检查后）**：首页勾选 `homeTools`（≤4）**本来就走** userdata v6 云同步且在真实云端正常（见下方只读探测）；「全部工具自定义顺序」此前仅在 `store.toolOrder` 本机保存、**未进云同步** —— 本次已补齐。
- **实现（不新增 v6 顶层键，复用已有 `prefs` section）**：
  - `utils/store.js`：新增本机标记 `toolOrderSetAt`（用户拖过排序才 >0，默认 0）；
  - `utils/tools.js`：`setToolOrder()` 落盘顺序时写 `toolOrderSetAt`；旧版「全量顺序」迁移到 toolOrder 时也标记（视为用户旧偏好，随账号带走）；
  - `utils/cloud.js`：`udSections()` 仅在 `toolOrderSetAt>0` 时把 `prefs.toolOrder` 放进 blob（默认设备不写、不动 v6 夹具/14 键契约）；无基线时用 `toolOrderSetAt` 抬 `at.prefs`，避免首次同步被旧云端 prefs 覆盖；`udApply()` 远端有 `prefs.toolOrder` → 归一后应用到本机 `toolOrder`，远端没有时**不清空**本机自定义（prefs 脏检测会自愈回推，避免两端静默丢顺序）；
  - `utils/privacy.js`：导出 JSON 的 `sync.prefs` 带上 `toolOrder`，同步范围文案改「工具栏顺序与工具页顺序」；空 v6 blob / 14 顶层键 / 11 section 契约不变。
  - 网页端：（`web/AGENTS.md` §4b-7/10）网页不拥有 `prefs`，合并时从最近结果原样保留 → 小程序顺序不会因网页端保存被清掉；网页自己的「全部页卡片顺序」仍按原设计为本机偏好（`zq_all_order_v1`）。
- **验证**：
  - `tool_sort_unit.js` **21/21 PASS**（新增：默认不写 prefs.toolOrder / 用户拖过才写且顶层仍 14 键 / 重置为自然顺序也同步 / **设备 A 自定义顺序+首页 → 设备 B 应用后工具顺序与首页顺序一致** / 无基线抢时间戳 / 远端无 toolOrder 不清空本机 / 导出含 toolOrder）；
  - `unit.js` 226/0、`sync_contract_test.js` 31/0、`staticcheck.py` exit 0、`tool_sort_preview.js` 31/0（0 console error，UI 未受影响）；
  - **真实云端只读探测**（`mp-class-tools-tests/cloud_sync_probe.js`，测试身份 3260799999，只 GET 不写）：class_verify 200 → userdata 行存在、blob 14 顶层键、`homeTools=["draw","hw","nt","tt"]` 且 `homeToolsAt=at.homeTools` 镜像一致 → 说明「首页」云同步链路在真实云端正常工作；新 `prefs.toolOrder` 为本次新增字段，首次拖动后会随 prefs 一起推送。
- **已知边界**：极端情况下若另一台设备在「只改提醒偏好」时把 prefs 时间戳推得更晚且其 blob 无 toolOrder，本机自定义顺序会保留并在下一轮脏检测回推（LWW 语义，不会静默丢失）；「清除云端我的数据」后本机 toolOrder 按既有语义保留，用户下次改动会随 prefs 重建云端副本。

### 兼容 / 未覆盖

- VERSION 仍 **2.0.0**；网页端同一 `homeTools` 字段已同步为「只存用户选择（≤4）、显示时补齐但不写回」（见 `web/CHANGELOG.md` 增量 20），跨端勾选 1–3 个不会打开一次网页就被补回 4 个。
- 真机滚动锁依赖 `page-meta page-style`（模拟器只能断言 data 值）；边缘自动滚动分支未纳入 automator 断言（建议真机手测一次长按拖动）。
- 工具页自定义顺序随账号同步（`prefs.toolOrder`，见上方「云同步补齐」节）；网页端自己的「全部页卡片顺序」仍为本机偏好（`zq_all_order_v1`，不进 UD），两端不互相改写。

## 通知页配色优化：莫奈纸面 v2（更整洁 / 深浅双主题）— 2026-11-06（未发版；版本号保持 2.0.0，AI 保持 off；待用户上传发布）

> 用户需求原话：「优化微信小程序端通知工具的色彩搭配，依然以莫奈色为主，但整体更倾向于整洁的画面，保持深色和浅色模式都要有较好体验」。
> 只改 `mp-class-tools/pages/nt/{nt.wxss,nt.wxml}` 与 `mp-class-tools-tests/` 验收产物；**不动网站 `web/`、不动云端 DDL/RLS、不上传发布、不改版本号（2.0.0）、AI 保持 off**。

### 更新内容

- **页面级莫奈 token（`pages/nt/nt.wxss` 全量重写，19,099 B → 23,741 B）**：新增 30 个 `--nt-*` 语义 token，浅色定义在 `.nt-page`、深色在 `@media (prefers-color-scheme: dark) .nt-page`（30/30，无缺口）；不污染全站 `app.wxss`。保留莫奈主色（奶油纸 `#F4F0E6`、纸白 `#FFFCF6`、睡莲青、雾蓝、暖沙、灰粉、藕紫、鼠尾草灰）并补齐深色同族值。
- **更整洁**：去掉简报渐变、卡片投影、虚线拼贴与 `filter: brightness()` 暗色补丁（渐变 2→1、虚线 5→1、投影 2→0、filter 1→0，仅保留功能性渐变/虚线各 1 处）；卡片改为「暖纸白 + 1rpx 细线」单一分隔；简报 4 统计改为无框格 + 竖向细线。
- **莫奈色只当语义标签**：分类/来源/状态/文件类型由「饱和实底白字」改为「tint 底 + ink 字」；来源胶囊改为中性描边 + 10rpx 莫奈色点；分段标签由 5 组彩色收敛为「时间/截止=暖沙、要求=灰粉、其余中性」。
- **深色专项**：已过期/已处理卡在暗色下改用普通卡片表面（避免与页底同色丢失卡片边界）；深色体验：墨绿纸底 `#1B1E1A` + 抬升卡片 `#23271F` + 内嵌块 `#1C2019`，tint/ink 成对换值；不再依赖亮度补丁。
- **已处理卡**：由整卡 `opacity: .78` 改为「下沉底色 + 状态灰化 + 标题删除线」，文字仍达 WCAG AA。
- **弹层内全局 M3 组件页面级小修**：`.nt-page .m3-btn--filled`（3.65:1 → 5.09:1）、`.nt-page .m3-li__trail`（4.48 → 9.05），仅通知页生效。
- **WXML 2 处**：`.nt-src` 由 `<text>` 改 `<view>` + `.nt-src-dot`（莫奈色点）；简报计数徽标 `.nt-chip` → `.nt-brief-chip`（旧版与筛选胶囊同名导致样式互相覆盖，属样式 bug 修复）。事件绑定 39/26、`wx:` 指令 76 条前后完全一致；**`nt.js` 未改**。

### 验证

- **配色审计**（新增 `mp-class-tools-tests/color_audit.py`，可复跑）：页面 WCAG AA 硬失败 **41/11 → 0/0**（浅/深）；语义色组合 36 项全 PASS、最低 4.61:1（暗色最低 5.43）；暗色 token 缺口 0；`filter` 7→0、`box-shadow` 2→0、样式内颜色字面量 24→2（仅图片字幕功能性）、独立色相 21→2。前后对比报告 `_color_audit/COMPARE.md`。
- **功能门禁**：`node unit.js` **215/215**（另一路「课表列宽」任务新增用例；通知页相关 14 条全 PASS）、`python staticcheck.py` exit 0（handlers missing []）、`node sync_contract_test.js` 31/31、`node code_quality_check.js` 全部规则通过；`nt.js` 与 `app.wxss` 与改色前逐字节相同（`_qa_color/summary.md`）。
- **双主题实拍**（新增 `mp-class-tools-tests/nt_theme_shots.js` + `_shots_color/`）：微信开发者工具 390×844，浅色 6 张 / 深色 5 张，`systemInfo.theme` 校验一致、0 console error；真实云端通知数据。
- **冻结指纹**：`pages/nt/nt.wxss` 23,741 B sha256 `a0b154d5982531e6…`；`pages/nt/nt.wxml` 18,669 B sha256 `54ecfe5be6329c19…`。设计口径见 `mp-class-tools-tests/_color_plan/DESIGN_SPEC.md`。
- 交付：桌面 `小程序通知工具_配色优化_20261106/`（说明、配色规范图、双主题实拍、前后对比、交互预览、验收记录、源码副本）。

## 课表 6/7 天同页缩放（周六/周日有课不再需要横向滑动）— 2026-11-06（未发版；版本号保持 2.0.0，AI 保持 off；待用户上传发布）

> 用户反馈：「对于微信小程序的课表功能，请在周六周天有课时用优化显示比例的方式让其显示在同一页并且不影响课程观看，
> 而不是课表需要滑动才能完整观看」。只改 `mp-class-tools/pages/tt/` 与 `mp-class-tools-tests/`；
> **不动网站 `web/`、不动云端 DDL/RLS、不上传发布、不改版本号（2.0.0）、AI 保持 off**。

### 更新内容

- **列宽始终按卡片内宽自适应**（`pages/tt/tt.js`）：新增常量 `TT_PD_COL = 96`（节次标签列），
  `colW = Math.floor((TT_CARD_INNER - TT_PD_COL) / days.length)`；5/6/7 天 = **106/89/76rpx**，
  内容宽 `96 + days×colW` = **626/630/628rpx ≤ 630rpx**（`.page` 32rpx×2 + `.ttcard` 28rpx×2 已核实，
  `TT_CARD_INNER=630rpx` 与真实内容框一致），周表不再横向溢出（`_gridOverflow` 恒 false、`_gridMaxX` 恒 0，
  仅保留为防御性兜底）。
- **6/7 天 dense 缩放**（`tt.wxss` + `tt.wxml`）：周表按 JS 标记挂 `.tt-dense` / `.tt-dense7`；
  课程名 6 天 21rpx / 7 天 **19rpx**（≈9.5px 下限）；教室 17/15rpx；单节课块（`.crs-one`）
  课程名最多 2 行（`-webkit-line-clamp:2`，不再裁半行），跨节块可完整换行；
  7 天隐藏冗余「第X-Y节」`.cspan`（`showSpan=false`，跨节高度已表达）；
  星期 22rpx / 日期 18rpx 且表头允许换行（「今天」徽标不截断）；
  **行高 96rpx、跨节次绝对定位、课程块可点区与 `bindtap="openDetail"` 全部不变**。
- **手势简化**（`tt.js`）：周表不再横向溢出 → 删除 `_gridAtEdge` / `_swipeEnabled` / `giveScroll`
  「先滚表格到边缘才切周」分支；任何横向手势直接跟手切上一周/下一周（参数不变：横向锁定 12px 且
  `|dx|>|dy|×1.35`、提交 56px、首/末周 0.28 阻尼、飞出/飞入 150/230ms、320ms tap 抑制）。
  `scroll-view` + `onGridScroll`/`scroll-left` 保留作防御（正常数据恒不滚动）。
- **测试**（`mp-class-tools-tests/`）：
  - `unit.js` 7b 段重写：5/6/7 天 `colW` 与内容宽 ≤630、`_gridOverflow=false`/`_gridMaxX=0`、
    6/7 天直接切周（左/右）、首末周阻尼回弹、日视图、320ms tap 抑制、WXML/WXSS 静态断言
    （colW 行内 style、dense/dense7 标记、19rpx 下限、2 行 clamp、无 giveScroll/_gridAtEdge 旧分支）；
    顺手修复**既有** nt 气泡测试正则过时（`.nt-sub` 内新增嵌套 `.nt-src` 导致非贪婪匹配截断；
    仅测试文件 1 处，与本次课表功能无关，修复后基线由 213/214 恢复全绿）。
  - `tt_swipe_preview.js` 重写：mock 身份 + 本地 `_tt_fixture_20261106.json`（第 3 周真实「周六有课」6 天；
    第 10 周注入周六/周日课程 → 7 天），断言全列（含周六/周日）在卡片内、无横向滚动、课程名可读、
    7 天无 `.cspan`、横滑切周、320ms 抑制、点击课程仍开详情；截图到 `_shots_tt_fit/`。

### 验证

- `node unit.js` **215/215 PASS**；`python staticcheck.py` exit 0（21 页、handlers/分享 handler 0 缺失）；
  `node code_quality_check.js` 全部规则通过。
- `node tt_swipe_preview.js`（微信开发者工具 automator，模拟器 390 宽）**43/43 PASS / 0 console error**；
  截图 `_shots_tt_fit/00-week-5day-baseline.png`（5 天对照）、`01-week-6day-sat-full.png`（6 天含周六）、
  `02-week-7day-sat-sun-full.png`（7 天含周六/周日）、`03-day-view.png`（日视图滑动跟手帧）、
  `04-6day-after-swipe.png`；逐张目检课程名可读、无重叠/裁切、卡片框外无内容。
- 小程序源码改动**不随网页上线**：需用户下次在微信开发者工具上传发布后生效（待用户上传）。
- 备份：改前 `tt.js/tt.wxml/tt.wxss` 在 `mp-class-tools-tests/_backup_tt_fit_20261106/`。

## 计费规则信息层级调整 — 2026-11-06（未发版；版本号保持 2.0.0，AI 保持 off；待用户上传发布）

> 用户反馈「电费的计费规则应放入电量统计里」→ 网页调整上线后，小程序同步同一口径。只改 `mp-class-tools/` 与
> `mp-class-tools-tests/`；不碰 web、版本号、密钥。

- **电费页（`pages/power`）**：在「电量统计」tiles 网格内新增**满宽计费规则条**（`grid-column:1/-1`）：
  电价 0.58 元/度、区间电费 ≈¥X.XX（=区间用电×0.58）、免费 5 度电/人/月（按关注宿舍人数 = 水量记录 `p`，缺省 4）、
  水费 3.03 元/吨从电费账户扣 · 1 吨≈5.2 度、已忽略扣减摘要（有异常扣减时显示「已忽略 N 次…」）。
  `utils/power.js` 新增 `deductOf`（异常扣减识别，与网站同口径：`dq > max(5, 4×正常单段用电中位数)` 不计入区间用电/
  `rateFrom`）、`billOf`（规则条数据），`deriveRange`/`rateFrom` 输出扣减字段。
- **水量页（`pages/water`）**：规则卡只保留水费规则（水费 3.03 元/吨、每人 2 吨水/月免费定额、超出定额×3.03、
  折合扣电 = 水费÷0.58、无阶梯/来源/以学校最新通知为准），删除电费单价与 5 度电免费额度行；人数选项文案改为
  「4 人间（每月免费 8 吨水）/ 6 人间（每月免费 12 吨水）」。
- **测试**：unit.js 新增 2 项（billOf 文案/区间电费/免费额度按人数/扣减摘要；异常扣减不计入区间用电与 rate）。
  验证：`node unit.js` 214/214、`node sync_contract_test.js` 31/31、`python staticcheck.py` exit 0（21 页、handlers 0 缺失）、
  `node code_quality_check.js` 全部规则通过、`cli.bat auto-preview` 编译通过。

## 水量统计 — 2026-11-06（未发版；版本号保持 2.0.0，AI 保持 off）

> 与网站「水量」同口径（契约 `web/tools/tests/_water_contract.md`；规则来源 `web/_water_rules/research.md`）。
> 只改 `mp-class-tools/` 与 `mp-class-tools-tests/`：**不动网站 `web/`（另一会话在改）、不动云端 DDL/RLS、不上传发布**；
> 版本号按用户要求保持 2.0.0，AI 开发模式保持 `--off`。

### 更新内容

- **新增「水量」页（普通工具）**：`pages/water/*` + `utils/water.js`（纯函数）；`app.json` 注册、`utils/tools.js`
  目录新增 `water`（`noHome`，与网站一致不进首页常用）、新增 40×40 图标 `images/tool-water.png`。
- **关注宿舍沿用「宿舍电费」的 `power.sel`**（同一份 UD power section，页内可切换，未选择只引导、0 请求、0 数据）。
- **抄表与计费（网站同口径）**：月份 + 水表读数（2 位）→ 自动对比上一条（用量 = 本次 − 上次）；
  `水费 = max(0, 用量 − 2×人数) × 3.03`（2 位）；`折合扣电 = 水费 ÷ 0.58`（1 位）；宿舍人数 4/6（默认 4）；
  免费额度 2 吨水 + 5 度电 / 人 / 月；首条「首次记录」；输入即时预览；读数小于上次拒绝、同月覆盖；
  历史按月倒序可删除、删除后自动重算；每房间最多 120 条。
- **计费规则卡**：0.58 元/度、3.03 元/吨、2 吨+5 度/人/月、每学年 10 个月、寒暑假无补贴、
  来源（福建中医药大学后勤基建处 2025-09-05 / 2021 公寓管理规定）、以学校最新通知为准；不出现市政阶梯价。
- **同步（userdata v6 第 11 个 section）**：`water` 默认 `{rooms:{}}`，值结构
  `{rooms:{<roomverify>:{p:4|6,recs:[{m:"YYYY-MM",r,ts}]}}}`（recs 按月唯一升序、最多 120 条，与网页端同格式）；
  顶层 blob **14 键**（`...,power,water,homeToolsAt`）；既有 LWW 合并/脏检测/1200ms 防抖/云端拉取全部接入；
  旧数据无 water → 默认不报错；未拥有端原样保留；水量与电费一样不进导出 JSON（宿舍号隐私红线）。
- **版本号**：保持 2.0.0（不改 `utils/version.js`）；不实现演示/审核模式。

### 验证

- `node unit.js` **212/212 PASS**（water 专项 12 项）、`node sync_contract_test.js` **31/31 PASS**、
  `python staticcheck.py` exit 0（21 页、handlers/分享 handler 0 缺失）、`cli.bat auto-preview` 编译通过、
  `python test_ai_toggle.py` 78/78、`node code_quality_check.js` 全部规则通过。
- 小程序源码改动**不随网页上线**：需用户下次在微信开发者工具上传发布后生效（待用户上传）。

## 网站功能同步（宿舍电费 / 管理员诊断）— 2026-11-06（未发版；版本号保持 2.0.0，AI 保持 off）

> 用户要求「同步网站和微信小程序的功能」（方向：网站 → 小程序；诊断页也进小程序，仅管理员可见）。
> 本轮只改 `mp-class-tools/` 与 `mp-class-tools-tests/`：**不动网站 `web/`（另一会话在改）、不动云端 DDL/RLS、
> 不上传发布**；版本号按用户要求保持 2.0.0，AI 开发模式保持 `--off`。

### 更新内容

- **宿舍电费「数据仪表盘」（普通工具）**：新增 `pages/power/*` + `utils/power.js`（纯逻辑）+
  `utils/cloud.js` 的 `powerRoom / powerHistory / powerPull`（直接读 CloudBase `public.power` /
  `public.power_history`，RLS auth_ok，无需新云函数/DDL）。
  - 17 间宿舍静态目录与网站 `PW_ROOMS` 逐项一致；**宿舍选择 UI 重做（2026-11-06 用户真机截图反馈）**：
    原生 multiSelector 第二列把每栋房间拼成字符串（「305 室,306 室」「321 室,323 室,…」）无法选择 → 改为
    **自定义 bottom-sheet**（入口卡 → 遮罩弹层 → 4 个楼栋 pill → 房间网格 2–4 列自适应 → 点房间立即选中并收起 /
    取消 / 遮罩关闭；触控 ≥44px、safe-area、内滚不横向溢出）；纯函数 `roomsOfBuilding/rvOf/labelOf/buildingOf`；
    **未选择宿舍时 0 个 power/power_history 请求**，选择后并行读当前行 + 所选区间采样
    （history：`select=ts,quantity&roomverify=eq.<rv>&ts=gte.<now-range.ms>&order=ts.asc&limit=2000`）；
  - 大号电量（网站 fmtMain：≥100 取整、否则 1 位小数）+ 电量环（**可用天数/30**，有效估算时最少 0.02、最大 1，
    无有效估算 0.04 小段；状态色按 30/60 阈值）+ 状态 pill（**≥60 充足 / 30–60 偏低 / <30 低电**；
    云端 `low=true` 也按低电）+ 最近更新；低电标红 + 低电条「**剩 X 度 · 约 Y 天**」+「去完美校园充值」；
  - **趋势区间 24h / 7天 / 30天（对齐网站 v3.1）**：区间 chips（默认 24h，只记本机 `zq_power_range_v1`、不进 UD）；
    history 按区间拉，**每区间 5 分钟缓存**（缓存未过期切换区间 0 请求）；趋势 canvas 2d 折线
    （面积渐变 + 折线 #4E9082 + 2 条网格 + 末点；DPR 缩放；标题/图例随区间；
    `recharge=true` 时标题旁「期间有充值」徽标）；
  - **趋势 v4（对齐网站 07:38 增量11）**：**7d/30d 可左右横滑**（`scroll-view scroll-x` 包超宽 canvas；内容宽
    = max(容器, n*gap+16)，gap 7d=16/30d=9；点数上限 7d≤170/30d≤240，canvas 物理宽 ≤~5376）；24h 铺满不横滑；
    **x 按真实时间比例**（非索引等分）；**固定 y 轴**（3 刻度 + 竖线，横滑不动，1 位小数；空态只留竖线无刻度）；
    **固定 x 轴覆盖层**（可见窗口取 3/4/5 刻度：24h HH:MM、7d/30d MM-DD，`bindscroll` 16ms 节流刷新、同屏去重，
    横滑时 x 变/y 不变）；切档/换宿舍 scrollLeft 归零；
  - **估算 v5（对齐网站 07:56 增量12）**：新增 `rateFrom(pts)`（逐点 dq=q[i-1]-q[i]、dt>0：
    dq>0.05 正常用电 used+=dq/hours+=dt；dq<-0.05 充值跳变整段跳过；|dq|≤0.05 只计时长）+
    `estimate(pts24,pts7,row)`（v24/v7 需 n≥2&span≥6&rate 有限；两者有效 rate=**0.65*r24+0.35*r7**，
    仅一档有效用该档；rate<0 置 0 再 **max(rate,0.05)**；days=row.q/rate）；tile1 主值 **≥30 显示「≥30」**，
    副标「≈ rate 度/天」；环 arcs=estimate.days/30（0.02/0.04 边界）；低电条「约 ≥30/X 天」；
    **拉取并行 power + 24h + 7d（30d 档再加当前档），各档 5 分钟缓存**；估算/环/低电条不再用单档 derive days；
  - **可调低电阈值 v5**：UD `power = {sel,at,low}`（默认 30，档位 **[10,20,30,40,50,60,80,100]（无 70/90）**；
    旧数据无 low 按 30；非法/越界归一；LWW 仍按 at；13 顶层键不变）；判定 **q<low 低电 / low≤q<2low 偏低 / 其余充足**
    （pill/环色/低电条/alert 全用）；低电阈值 tile 变可点按钮 → 8 档小面板（选中态，点选立即生效并关闭）；
    `setLow` 更新本地 low + `at=now` 触发 UD 推送 + 本机 `zq_power_low_<sid>` 兜底；换端从远端 low 恢复；
  - 4 个指标 tile（v5）：**估算可用（daysMain + ≈rate 度/天）/ 区间用电（随区间）/ 低电阈值（可点改）/
    上次充值（lastUp.reset 2 位 + MM-DD HH:MM，无记录「—/暂无记录」）**；刷新 + 下拉刷新；2 分钟电量 TTL；
  - `utils/tools.js` 新增 `power`（`noHome:true`，与网站一致不进首页常用/排序，仅「全部」页可见）。
- **工作台电费关注卡 + 关注宿舍持久化审计（2026-11-06 task-23）**：
  - `pages/index` 新增「宿舍电费」卡：读 `store.power` 展示关注宿舍 + 剩余电量/状态（优先 `cloud.powerCached` 2min 缓存，
    未命中按需 `power?id=eq.<rv>`）；**未选择只显示「去选择关注宿舍」引导且 0 请求**；点击 `wx.navigateTo('/pages/power/power')`；
    样式复用工作台卡片（`wb-power`），手机/横屏不溢出；下拉刷新可 force 刷新电量。
  - 持久化/同步审计发现并修复：① `udOwnedDirty` 无 UD 基线返回 [] → 新装/清缓存后选完宿舍不会推送；
    ② `udSections` 无基线时 power 时间戳按 0 参与 merge → 云端空 power(at=0) 会把刚选宿舍覆盖为空（「每次打开重新选择」）；
    ③ 云端权威清空选择时，本机旧兜底键会复活关注宿舍（换端取消关注失效）；④ 选完马上退出时 1200ms 防抖未发。
    修复：无基线时本机已有选择只把 `power` 视为脏并按本机 at 参与 merge；本机兜底键仅在无 UD 基线时补位，云端明确空则清理；
    新增 `cloud.udFlush()` 并在 `app.onHide` 调用（立即冲刷待推送）；页面 `onShow` 继续 `store.reload` 冷启动恢复。
  - 补单测：新装无基线选完 → `udPull` 不被空 power 覆盖 + 推送 `{sel,at,low}`；页面重启/选完立即退出 flush/换端恢复/
    云端权威清空不复活/云同步关闭或离线本机恢复且 0 请求；工作台卡未选择 0 请求、已选择展示、2min 缓存不重复请求、点击跳转。
- **电费慢更新提示（用户第 9 条，网关日更）**：`utils/power.js` 新增 `slowUpdate(hist24)`——24h history 相邻点
  `|dq|>0.005` 计一次，**≤2 次**视为慢更新；趋势标题旁显示「数据更新较慢 · 上次变化 MM-DD HH:MM」，
  无变化显示「数据未更新」；「估算可用」tile 加「参考」小字；正常房间不显示；**不插值、不改真实阶梯**；
  标题行 flex-wrap + 徽标 `overflow-wrap:anywhere`，360/430/横屏不溢出。
- **管理员诊断页（仅管理员）**：新增 `pages/diag/*` + `utils/diag.js`（纯逻辑）+ `utils/cloud.js` `serviceHealth()`
  读 `public.service_health`（RLS **auth_admin**；非管理员不显示入口且 0 请求——页面 onLoad/onShow + cloud 三层守卫）。
  - 4 组（站点与云端 / 信息采集 / 定时任务 / 采集主机）、13 个服务项；状态 ok/warn/down/offline/unknown 中文映射；
  - `cloudbase` 行用本次请求延迟覆盖（<3s ok / ≥3s warn / 请求失败 down）；采集主机心跳 >15 分钟或缺失时
    所有 kind=local 行降级「离线」并显示「上报于 HH:MM」；`site_static` / `jwxt` 云端无行时退回本机
    `ttCache.meta.fetchedAt` 新鲜度（≤30h ok / ≤54h warn / 其他 down）；汇总「N 项异常/注意/未知/全部正常」；
  - 刷新 + 停留本页 60s 自动刷新（onHide/onUnload 停止定时器）；`utils/tools.js` 新增 `diag`（`admin:true`，
    规则同统计，不进首页）。
- **选择进同步（userdata v6 新增 power section）**：`power = {sel:"<roomverify>", at:<ms>}`；顶层键序升级为
  `v,at,homeTools,fit,draw,group,roster,hide,tt,prefs,nick,power,homeToolsAt`（**13 键 / at 10 section**，
  与网站 `web/tools/tests/sync_check.py` 期望逐字节一致）。改 `utils/privacy.js`（SECTION_KEYS/DEFAULTS/SCOPE/空 v6）+
  `utils/cloud.js`（UD_KEYS/UD_OWNED/udSections/udApply/udChanged/脏检测/`udMirrorPower` 值内 at 镜像）+
  `utils/store.js`（DEF.power + 迁移）；本机 `zq_power_sel_<sid>` 只作离线兜底，真源是 `UD.power`；
  非法 roomverify 一律降级为未选择（不请求/不展示）；导出 JSON 不含 power（宿舍号隐私红线）。
- **图标**：新增 `images/tool-power.png`（205 B）、`images/tool-diag.png`（212 B），40×40 PNG-8；
  媒体总量 109,337 B（106.77 KB）仍 < 200 KB 硬线。
- **数据与隐私页**：同步范围新增「关注宿舍（电费）」；「收集 / 共享」说明补充电费仅本人可见、不导出，
  诊断仅管理员可见。
- **电费趋势真机横向溢出修复（task-25）**：`.pw-plot` 在 flex 内改为 `flex:1 1 0; width:0; min-width:0; height:300rpx`
  （scroll-view 需确定宽高），`.pw-trend-body`/`.pw-trend` 限宽 `overflow:hidden`，scroll-view 显式 `width:100%;height:300rpx`；
  绘图宽不再用 `windowWidth-96` 估算，改为 **SelectorQuery 实测 `.pw-plot`**（先保守 70% 宽渲染，DOM 就绪后实测重绘；
  测量失败保留保守宽），24h `chartW` 强制 ≤ 容器宽，7d/30d 内容宽只在 scroll-view 内横滑；x 轴/图例 `overflow:hidden`。
  390 实测卡片 right=374 ≤ 390、绘图容器 277.67、24h canvas 277.67、7d 内容 464，DOM rect 无横向溢出；布局契约单测覆盖
  320/360/430/667 横屏（兜底容器宽 ≤ 卡片预算、24h=cw、7d/30d 内容宽>cw）。

- **固定宽 canvas 横滑裁切修复（2026-11-06，真机截图复核）**：发现 7d/30d 的宽 canvas 在 scroll-view 内仍会画到卡片外/压 y 轴。
  改为 **固定宽 canvas（=实测绘图区宽）+ 透明 scroll 代理**：canvas 只负责绘制可见窗口（内容按 `scrollLeft` 偏移），
  7d/30d 的内容宽仅作为 scroll 代理的占位宽，页面/卡片内不会出现超宽 canvas；y 轴列独立背景 + z-index 3，
  横滑时保持固定不被线覆盖；`bindscroll` 16ms 节流同时刷新 x 刻度与 canvas。
  390 实测：卡片 right=374≤390、绘图区 right=318.33、**canvas right=318.33（7d 初始/横滑后均如此）**、y 轴 left=322.33>绘图区右缘；
  `power_preview.js` 增至 26/26（新增 canvas 裁切在绘图区内、滑后仍不越界断言）。
- **电费界面排版重构（2026-11-06）**：顶部关注宿舍改**单行入口**「关注宿舍 · 楼栋房间 ›」（去掉仪表卡重复宿舍名）；
  Hero 紧凑化（220rpx 小环 + 右侧状态 pill /「剩余电量」/更新时间，**右上角小号「刷新」**替代整行大按钮，低电条保留在 hero 底部）；
  趋势卡标题/徽标与区间 chips 分两行、chips 78rpx（仍 ≥40px 触控），绘图区 260rpx，7d/30d 右缘渐隐 +「横滑查看」
  （24h/无数据不显示，且不盖 y 轴），x 轴/图例紧凑；tiles 2×2 小卡（20rpx padding / 38rpx 数值）；卡片间距 16rpx；
  390 实测无横向溢出、y 轴不重叠；`power_preview.js` 26/26 PASS（新增 00 未选择截图、宽度/溢出/y 轴/横滑提示断言）。
- **tiles 真机 2×2 Grid 修复（2026-11-06，用户真机反馈）**：`.pw-tiles` 由 flex + `width:calc(50% - 6rpx)` 改为
  **CSS Grid `repeat(2, minmax(0,1fr))` + gap 12rpx**，`.pw-tile{width:auto;min-width:0}`；真机 DPR/小数取整不会再掉成一列。
  同类审计：`.pw-rooms` 改 3 列 grid（≤360px 2 列）、`.pw-lowsel-g` 改 4 列 grid，去掉 `33.333%-12rpx` 等临界宽度。
  390 automator 实测 4 个 tile：两排同 top、等宽 176px、right≤374；`power_preview.js` 增至 27/27（新增 tiles 2×2 rect 断言），
  v3 新增 360/375/390/414 数学余量+静态 grid 断言（32 项）。
- **访问统计筛选/汇总/列表排版修复（2026-11-06，真机反馈「今天/近 7 天错行」）**：筛选改为两个 group
  （模式组 3 chips / 范围组 2 chips），group 内 `nowrap`、空间不足整组换行，去掉 `grow` 弹簧；
  chips min-height 80rpx（≥40px）；汇总卡 `flex-wrap` + 更新时间 `margin-left:auto`；按天/按小时 `strow`
  label 120rpx、value 64rpx、均 nowrap/ellipsis。新增 `stats_preview.js`（管理员 mock，390 宽 8/8 PASS）与 v3 静态/数学断言（33 项）。
- **通知压缩包附件（archive）支持（2026-11-06，用户反馈「预防艾滋病知识竞赛通知」附件未同步）**：
  `utils/notice.js` 新增 `archiveInfo(item)`（ok/count/summary≤120 字/files≤6，只元数据不含 data URI）；`pages/nt` `mapGroup`
  对 `kind=file` 输出 `archiveOk/archiveCount/archiveSummary/archiveFiles[{name,extKind,extText,size,hasUrl}]`；
  `pending` 仅「无 url 且无 archiveOk」时为 true；WXML 文件行下方默认展开包内清单（类型 badge + 文件名 ellipsis + size +
  「预览」/「仅清单」），内部 data URI 文件走 `writeDataUri`→`wx.openDocument(showMenu:true)`（防重复点击/失败 toast），
  无 url 的仅清单不可点；外层 zip 无 url 但有 archive 时显示「已识别 N 个文件」不再「待获取」。
  **数据链**：`NT_FULL_Q=select=*`（body 含 archive）；`NT_LITE_Q` 仅签名；首次/刷新整表拉全量。另加
  `cloud.ntGroupFull(gid)` 单条 body 按需刷新（缓存旧 body 无 archive、ts 签名未变时，展开卡片会 GET notices 单行一次并回写缓存，
  不新增接口/不上传），解决「后补附件但签名不变」的缓存自愈。真实 group 夹具
  `_nt_fixtures/nt_archive_group.json`（5 文件/3 可预览/2 仅清单）；`nt_archive_preview.js` 390 宽 5/5 PASS。
- **task-28（2026-11-06）：电费趋势详细查看（取消横滑）+ 使用说明更新 + 首屏/安全优化**
  - 电费趋势删除 7d/30d 横滑：删除固定宽 canvas + 透明 scroll 代理 +「横滑查看」，全部区间 canvas 宽=绘图区宽、全量采样按真实时间比例压缩绘制；
    新增点击/左右拖动查看最近真实采样点（竖线+圆点+信息行「时间 · 电量 xx.xx 度」；24h HH:MM，7d/30d MM-DD HH:MM；同步 setData、松手保留、同点再点取消；
    `catchtouchmove` 不触发页面滚动；空态/<2 点不显示）；保留充值/慢更新/低电阈值/估算。
  - `utils/power.js` 新增 `nearestPoint/cursorLabel`；页面 `onTrendTouch/onTrendTouchMove/onTrendTouchEnd`、`_plotLeft` 实测、cursor 数据；
    v3 新增 8 组交互/无横滑/布局断言（41 项）；`power_preview.js` 30/30（7d 点击 3 个位置 + 拖动截图、30d 拖动、无 scroll-view/页面不滚动）。
  - `pages/ug` 使用说明补齐宿舍电费（关注/低电阈值/趋势点击拖动/慢更新）、通知附件（微信/QQ/压缩包识别/跨源合并）、工作台电费卡、水量抄表；
  - 首屏：app 级 `ensureMembers/visitLog/marksPull(true)` 从 `onShow` 延后到 `WARM_MS=300ms`（页面自身 onShow 仍即时拉 marks）；automator `perf_ug_preview.js` 记录首屏 2 个请求（marks @131ms / notices @145ms）、UI 首屏截图；
  - 安全：全页面无 rich-text/innerHTML/eval；`writeDataUri` 加 10MB data URI 上限 + 扩展名 `[a-z0-9]{1,8}` 白名单（固定前缀临时路径，archive 文件名不参与路径）；
    token/identity 不落 console；外部链接仅复制；异常路径 toast/降级。
- **测试**：新增 `mp-class-tools-tests/v3_power_diag_tests.js`（**41 项**，并入 `unit.js`；含
  **v5 rateFrom 4 组 fixture / estimate 24h+7d 混合与 rate 下限 / 低电档位与状态边界（q=low、2*low）/ 阈值面板交互 /
  UD 推送 {sel,at,low} / 本机兜底 / 换端恢复 / 旧数据无 low **；
  deriveRange（drop 累计/充值 lastUp）、4 tiles（估算+≈rate 度/天、区间用电、低电阈值、上次充值）、趋势图例 drop、
  低电条文案、电量环 days/30、自定义 bottom-sheet（无 multiSelector / 选楼栋/房间/取消/切换/选中态、选中前 0 请求）、
  trendLine 时间比例点位/≤240+区间上限 + xTicks/xticksWindow、canvas 绘制调用 / <2 点不画、
  **趋势区间 chips（24h→7天→30天 fetch 契约/5min 缓存/预取后 0 请求/本机记忆/不进 UD）**、
  **期间有充值徽标 + 上次充值 tile**）；
  新增 `mp-class-tools-tests/power_preview.js`（automator 390 宽：弹层打开/23A 网格/24h 仪表盘+折线/估算 tile/
  低电阈值面板/阈值 50 偏低与低电态/7天与30天区间（含充值徽标、上次充值 tile、横滑前后）/低电态，0 console error）；
  新增 `mp-class-tools-tests/home_power_preview.js`（automator 390 宽：工作台未选择引导卡 0 请求/已选择 382 度充足/
  点卡片进电费页恢复/重整工作台仍恢复，6/6 PASS）；
  同步契约测试与 `_sync_fixtures/*` 升级到 13 键 + **v5 power.low 推送/旧数据迁移/非法归一**；
  修复 `ai_unit_identity.js` 一个「今日课程」按真实星期几腐化的旧断言（改为按夹具 TT 动态计算，非产品改动）。
- **文档**：README 增加 §2.1「网站功能同步（电费 / 管理员诊断）」与测试/包体/已知限制更新。

### 验证

- `node unit.js` **229/229 PASS**（原 123 + v2 24 + v3 41 + 2026-11-06 07:05 通知文案精简同步 5 + 并发合入的水量抄表等）
- `node sync_contract_test.js` **31/31 PASS**（13 键夹具 / 合并期望 / power 值与 at 镜像 / 换端恢复 / **v5 low 推送与迁移**）
- `python staticcheck.py` **exit 0**（21 页、handlers / 分享 handler 0 缺失、无 web-view / 用户信息接口）
- AI 侧（AI off 状态）：`node ai_unit_all.js` **8/8（296 项）**、`ai_contract_test.js` **PASS 92 / FAIL 0 /
  PENDING 5**（PEND 均为 AI 独立分包未启用项，与 AI off 基线一致）、`ai_eval_check.js --strict` **14/14 PASS**
- automator 390 宽：`node power_preview.js` **30/30 PASS、0 console error**（含 7d 点击 3 位置/拖动游标、30d 拖动、无 scroll-view/页面不滚动）；`node home_power_preview.js`
  **6/6 PASS、0 console error**；`node stats_preview.js` **8/8 PASS、0 console error**；
  `node nt_archive_preview.js` **5/5 PASS、0 console error**；`node perf_ug_preview.js` **6/6 PASS、0 console error**（首屏时序/使用说明）；截图
  `mp-class-tools-tests/_shots_power_sync/{00_power_empty,01_sheet_open,01b_sheet_23A,02_dashboard_trend_24h,02b_tiles_24h_estimate,06_low_panel,07_low50_warn,08_low50_low,09_slow_badge,10_layout_24h,11_layout_7d,04_trend_7d,04c_trend_7d_scrolled,04b_tiles_7d,05_trend_30d,05c_trend_30d_scrolled,05b_tiles_30d,03_low}.png`
  与 `mp-class-tools-tests/_shots_power_home/{01_home_power_empty,02_home_power_selected,03_power_restored,04_home_power_restored}.png`
- `cli.bat auto-preview` 编译通过：**TOTAL 652,076 B**（单主包，无 AI 分包；本轮工作区并发合入其他会话的水量抄表等改动
  （21 页），相对上一轮 649,527 B +2,549 B；含 task-28 电费游标/使用说明/首屏延后/安全上限与测试脚本）
- 测试证据：`mp-class-tools-tests/v3_power_diag_result.json`、`_compile_info_off.json`、`_shots_power_sync/result.json`、`_shots_nt_attach/result.json`

### 已知限制

- 电费趋势图（v4）：小程序为 canvas 2d 折线（区间 24h/7天/30天；面积渐变 + 折线 #4E9082 + 2 网格 + 末点；DPR 缩放）；
  24h 铺满不横滑；7d/30d `scroll-view` 原生横滑（内容宽 = max(容器, n*gap+16)，点数上限 7d≤170/30d≤240，
  canvas 物理宽 ≤~5376），x 按真实时间比例；固定 y 轴（3 刻度 + 竖线，空态只留竖线无刻度，1 位小数）；
  固定 x 轴覆盖层（可见窗口 3/4/5 刻度、bindscroll 16ms 节流、同屏去重，24h HH:MM / 7d·30d MM-DD）；
  <2 采样只显示「数据积累中」不绘制；**v5 估算/环/低电条用 rateFrom+estimate（24h+7d 分段统计、跳过充值跳变、
  0.65/0.35 混合、rate 下限 0.05）**；小程序暂不含桌面端比例优化。
  与网站实现差异：小程序用 scroll-view 包超宽 canvas（网站为固定 canvas + scroll 代理），两者固定双轴/时间比例一致。
  网站仍是电费/诊断主实现，若网站后续改版需按新的 `power/power_history` / `service_health` 契约对齐。
- 电费估算/低电阈值（v5）：estimate 需同时具备 24h+7d 两档历史（选择后并行拉、各档 5min 缓存、刷新 force 一起拉）；
  tile1 ≥30 显示「≥30」，副标 ≈rate 度/天；低电阈值随 UD power.low 同步（默认 30，档位
  10/20/30/40/50/60/80/100，无 70/90），本机 `zq_power_low_<sid>` 仅兜底；判定 q<low 低电 / low≤q<2low 偏低。
- 电费趋势区间：24h/7天/30天 chips 默认 24h，只记本机 `zq_power_range_v1`（不进 UD 同步）；history 每区间
  5 分钟缓存，缓存未过期切换区间 0 请求；「期间有充值」徽标与「上次充值」tile 来自区间 deriveRange 的
  `recharge/lastUp`。
- 电费宿舍选择：自定义 bottom-sheet 取代原生 multiSelector（楼栋 pill + 房间网格；360/430 下 2–4 列自适应、
  内滚 + safe-area，无横向溢出）；390 宽 automator 截图见 `mp-class-tools-tests/_shots_power_sync/`。
- 电费数据边界：数据侧保证 `public.power.quantity` 非空；`quantity=null` 不在产品路径（两端遇 null 都按 0 做
  防御性兜底，会显示低电，属实现兜底而非真实数据场景）。
- 诊断页：小程序不能读证书，`site_tls` 只展示云端行；`site_static` 无同源站点可探测，云端无行时用本机课表快照兜底；
  `cloudbase` 行用小程序本次请求延迟覆盖（网站用浏览器直连延迟）。
- AI 元数据（`agent/page-meta.json`、`ai/common/handoff.js`）仍为 18 页——AI 开发模式关闭、不随正式版提交；
  日后若重新 `ai_toggle --on` 并把 AI 适配提交，需要给 power/diag 补 page-meta 条目。

## 代码质量修复 — 2026-11-05（未发版；版本号保持 2.0.0，不新增功能）

> 按用户要求「直到下一次成功上传发布前不改版本号」，本节为 v2.0.0 的**发版前质量修复**，版本号仍为 2.0.0，
> 仅动资源文件与项目配置，不改任何业务代码/数据契约，不上传、不发布。

### 背景（微信开发者工具「代码质量」2026-11-05 18:54 扫描）

代码包 / 无使用或无依赖文件两节共有 2 项未通过：

1. **代码包 · 图片和音频资源大小应不超过 200 K（未通过）**：包内 35 个图片资源合计 **238.00 KB**。
   规则统计的是「图片+音频资源总量」（不是单个文件），当前超限约 38 KB。
2. **无使用或无依赖文件 · 不应存在无使用的组件（未通过）**：列出 19 个
   `ai/skills/*/components/*/index.json`。

根因分析：

- **图片**：分享卡片 `images/share/*.png` 8 张为 500×400 RGB PNG（21.2–24.9 KB/张，合计 185.9 KB），
  另有无代码引用的 `images/app-icon-1024.png`（30.8 KB，仅作小程序图标源素材）与 `images/logo.png`（10.6 KB），
  合计 243,708 B > 200 KB。
- **组件（时序是关键）**：18:54 扫描时 AI 开发模式**仍处于开启状态**（19:28 才执行 `ai_toggle.py --off`）。
  AI 开启时 `app.json.agent.skills` 会让依赖分析器把 8 个技能目录下的 19 个 `"component": true` 组件加入依赖图；
  但这套原子组件只通过 `mcp.json` 的 `_meta.ui.componentPath` 供 AI 运行时渲染，**不是** `usingComponents` 声明，
  而官方检查器只遍历 Page/Component/MainPackage/SubPackage、不处理 `Agent` 类型模块 → 19 个全部判「无使用」。
  AI 关闭后（当前发版默认）dev 编译会按无依赖文件过滤剔除 `ai/`，官方扫描即可通过；但**上传（prod）模式默认
  不做无依赖过滤**（本项目未设 `ignoreUploadUnusedFiles`），所以仍需 `packOptions.ignore` 才能保证 `ai/`、`agent/`
  不进上传包、任何编译模式下都不再被扫描列名。
- 其余项（JS/WXML/WXSS 压缩、组件按需注入、插件大小、无依赖文件）扫描时本来就通过；其中
  「不应存在无依赖文件」在 `setting.ignoreDevUnusedFiles` 非 false 时按官方逻辑自动放行。

### 更新内容

- **图片资源压缩（PNG-8 调色板量化）**：`images/` 35 个 PNG **243,708 B → 108,978 B（-55.3%）**，
  媒体总量 **106.42 KB**（硬线 200 KB，内部目标 ≤150 KB，余量 44 KB）。
  - 路径 / 文件名 / 扩展名 / 像素尺寸全部不变（`share/*.png` 仍 500×400，每张 9.07–10.53 KB）；
  - `share/`、`logo.png`、`app-icon-1024.png` 为 256 色量化（目检 + 像素误差统计无可感知差异）；
    `tab-*` / `tool-*` 小图标用精确调色板**无损**重编码；
  - 新增 `mp-class-tools-tests/optimize_images.py`：幂等批量压缩脚本（`--dry-run / --root / --colors / --max-kb / --quiet`，
    `share/` 自动 12 KB/张上限），以后新增图片一键压、重复跑 no-op；
  - `mp-class-tools-tests/make_share_images.py` 新增 `save_optimized()` 并接入 `build()`，
    重新生成分享卡片仍输出优化后的体积（隔离测试 8 张逐字节一致，不会回涨）。
- **AI 源码排除出编译包**：`mp-class-tools-tests/ai_toggle.py` 扩展 —— `--off`（发版默认）在移除 `app.json`
  AI 配置的同时，向 `project.config.json` 的 `packOptions.ignore` 增补
  `{"type":"folder","value":"ai"}`、`{"type":"folder","value":"agent"}` 两条排除项；`--on` 精确移除这两条
  （用户已有 `ignore`/`include` 条目不动）。每次写入前备份到 `_backup_ai_toggle/`，`--status` 显示排除状态。
  源码目录 `ai/`、`agent/` **不删除、不移动**，随时可用 `--on` 恢复日常 AI 开发。
- **新增 `mp-class-tools-tests/test_ai_toggle.py`**（%TEMP% 副本）：app.json/project.config.json 完整 on/off 周期、
  幂等、部分状态补写、损坏 JSON 防御、真实项目与备份目录零改动 —— **78 PASS / 0 FAIL**。
- **新增离线复刻校验**：`mp-class-tools-tests/code_quality_check.js` + `CODE_QUALITY_NOTES.md`
  （逆向开发者工具规则后复刻：媒体总量、未使用组件、无依赖文件与 setting 放行语义、编译包文件清单尊重 `packOptions.ignore`）。
- 文档：`ai/README.md`「上线注意」补充新行为；本 CHANGELOG 与 `README.md` §「代码质量修复」记录结论。

### 验证

- 真实项目已执行 `python ai_toggle.py --off`：`project.config.json` 仅 `packOptions.ignore` 由 `[]` 变为 2 条
  （1701 B → 1849 B，其余字段/顺序不变），备份 `_backup_ai_toggle/project.config.json.bak-20261105-213252`。
- 开发者工具 `cli.bat auto-preview` 编译通过：**TOTAL 532,652 B**（修复前 667,382 B，-134,730 B，
  正好等于图片压缩节省量；单主包）。
- 关键实验（%TEMP% 副本，关掉无依赖文件过滤模拟质量扫描编译）：编译包 TOTAL 907,329 B；加入
  `packOptions.ignore` 的 ai/agent 两条后降至 **549,039 B（-358,290 B）** —— 证明 `packOptions.ignore`
  确实会把 `ai/`、`agent/` 从质量扫描所用编译产物中排除（详见 `mp-class-tools-tests/CODE_QUALITY_NOTES.md`）；
  默认 dev 过滤下 `ignore=[]` / `ignore=ai,agent` / 物理删除 ai,agent 三者编译体积完全相同（532,652 B），
  即 dev 模式本就过滤未引用 ai 文件，ignore 对**上传（prod）包**是必需项。
- 既有回归：`node unit.js` **147/147**、`sync_contract_test.js` **29/29**、`python staticcheck.py` exit 0、
  `python test_ai_toggle.py` **78/78**。
- 媒体总量独立复算 108,978 B（106.42 KB）< 200 KB；全部图片引用路径/尺寸核对通过。
- 独立验收（第二个验收者，`mp-class-tools-tests/_verify/VERIFY_REPORT.md`）：8 个独立脚本复核 PASS ——
  媒体独立复算一致、PNG chunk CRC/Pillow/ffmpeg 全过、35 张尺寸/引用零变化、share PSNR 58–68 dB、
  `project.config.json` 仅 ignore 两条差异、真实 DevTools ignore 因果实验复现 907,329→549,039 B（-358,290 B）、
  AI-on 副本 `ai_contract_test.js --final` 99/99。
- 微信开发者工具「代码质量 → 重新扫描」：预期「图片和音频资源」与「无使用组件」两项均通过
  （离线复刻检查器同口径输出 PASS；最终以开发者工具重新扫描为准）。

### 回滚

- 图片：从 git/备份恢复 `images/` 即可（本仓库当前无提交，素材原件见本轮会话备份或 `mp-class-tools-tests/` 生成脚本重生成）。
- AI 排除：`python mp-class-tools-tests/ai_toggle.py --on` 精确恢复 `app.json` 与 `project.config.json`；
  需要完全回到修复前可用 `_backup_ai_toggle/project.config.json.bak-20261105-213252` 覆盖。

## 2.0.0 — 2026-11-05（v2.0.0 全班体验升级：滚动保位 / 课表滑动手势修复 / 长期安排 / 管理员编辑 / 同步修复）

### 版本描述（短版）

全站版本号 **2.0.0**（`utils/version.js` 唯一来源 → app.js `globalData.version` + 「我的」页底部）。本版落地上级 v2.0.0
需求的微信小程序侧：页面滚动保位（17 页）、课表第 9 周 6 天周表横向溢出时「到边缘才切周」的滑动手势修复、
通知长期安排（recurrence）、工作台双卡 5s 轮换 + 常驻浮动、通知管理员编辑/删除/恢复（云端 override_json/hidden）、
全局动画统一与 reduced-motion 降级、体测男女/年级加入 userdata 同步、通知已处理/作业完成 marks 强制刷新与补发、
局部 setData 性能优化。不新增后端能力、不引第三方库、不修改业务数据表结构（仅只读 notices 新增四列，写只由管理员
PATCH），不上传发布。**审核相关：按用户指示不实现审核模式；仅保留云端名单中的测试身份（客户端无代码/入口）。**

### 更新内容

- **需求 1 版本号**：新增 `utils/version.js`（`VERSION='2.0.0'`，`text()` 唯一文案）；`app.js` `globalData.version`；
  「我的」页页脚改用 `{{versionText}}`（去掉硬编码 v1.3.3）；README / CHANGELOG 顶部标 v2.0.0；导出图不加版本号。
- **需求 2 页面滚动保位**：新增 `utils/scrollmem.js`——17 个页面接入 `attach / onScroll / save / restore`：
  页面实例重建后的第一次 `onShow` 恢复上次滚动位置（等 `data.state` 渲染完成再瞬时 `pageScrollTo(duration:0)`），
  用户先滚动即取消、页面隐藏/卸载清计时器；`svSave/svGet` 记忆内部横向 scroll-view（课表周表横向位置、
  国标评分表横向位置），`scroll-left` 初值恢复；页面内主动定位（跳通知/作业/工具/章节）先 `scrollmem.cancel`。
- **需求 3 课表滑动修复**：根因 = 第 9 周周六有课 → `days=6` → `colW=106` → `_gridOverflow=true` → 旧
  `_swipeEnabled()` 周视图直接返回 false（整周禁滑）。改为：周表 `scroll-view` `bindscroll` 记录 `_gridX`，
  `_buildData` 按 `96+N×colW` 与卡片内宽换算 `_gridMaxX`（并用实测最大值修正 rpx→px 误差）；`_gridAtEdge(x0,dir)`
  判定**手势方向是否已到表格边缘**——未到边缘本次手势让给表格横向滚动（`giveScroll`：不产生位移、不切周、不抑制
  点击），到边缘才跟手/飞出/飞入；首/末周边缘仍 0.28 阻尼；7 天/5 天/日视图均覆盖；`onGridScroll` 只写内存不 setData；
  `onHide/onUnload` 统一 `_swClear()` 收手势与动画定时器。
- **需求 5 滑动卡死/异常审计**：tt 页面隐藏即收手势/动画（避免隐藏期间 setData 抖动并残留状态）；nt 展开/收起
  延时定时器随 `onHide/onUnload` 清理；确认弹层只在 `show` 时挂载（关闭即解除遮罩滚动拦截）、遮罩 `catchtouchmove`；
  全源码无网页端那类 body 锁类；课表/评分表的内部 scroll-view 只横向不嵌套纵向。
- **需求 7 QQ 文件暂未获取（小程序侧）**：通知卡 `kind=file` 且无 `url/src` 的附件显示「待获取」徽标 + 虚线附件卡；
  点击弹窗「该文件暂未获取，请前往 QQ 群「<通知来源群名>」查看；下载后会自动上线」，确认按钮「复制群名」
  （`wx.setClipboardData`，失败提示手动记录）；有 url 时保持原有预览/下载。
- **需求 9 长期安排**：`utils/notice.js` 新增 `recurOf / nextOf / nextTextOf / recurLabelOf`（支持 weekly、
  monthly_weeks、monthly_day、daily；monthly_weeks 按「每月第 N 次出现的 weekday」，支持 startAt 起始约束）；
  通知卡片显示「长期安排」徽标 + label + 本地计算「下次 MM-DD 周X HH:MM」；`statusOf` 对 recurrence 永不判过期；
  `statOf / mostUrgent` 与工作台轮换均排除长期安排（actionable=false 不计入待处理）；条目 label 优先用云端
  `items[].label`（补充通知）；有 `updatedAt/_editedAt` 显示「已更新」。
- **审核相关（按用户 2026-11-05 最新指示）**：完整移除此前实现的小程序审核模式——删除相关源码文件，
  还原 `utils/cloud.js` / `utils/store.js` / `utils/identity.js` / `utils/notify.js` / `pages/identity` /
  `pages/me` / `pages/data` 中的相关分支与入口；身份页只保留正常「学号 + 姓名」登录。
  **测试身份由云端班级名单新增**（审核时走正常身份页登录；`class_members` 已过滤该身份；客户端不需要也不包含
  任何测试账号代码/入口，凭据只随交付说明提供、不写入仓库文档）。**除该云端测试身份外，不再添加任何审核相关功能。**
- **需求 11 工作台双卡轮换**：作业/通知卡同时展示；卡内「最新一条」每 5s 上浮淡出（.26s）→ 下浮淡入（.32s），
  两张卡常驻 6s 轻微浮动（±3rpx）；页面 `onHide` 暂停、`≤1` 条不轮换、基础库 < 2.9.0 降级不轮换、
  `prefers-reduced-motion` 关动画；轮换只 setData `title/sub/idx/anim`（不整卡重绘）；通知轮换列表排除
  已过期/长期安排/actionable=false/已处理。
- **需求 12 通知管理员编辑/删除/恢复**：`utils/cloud.js` 新增 `ntAdminEdit(gid, patch)` / `ntAdminHide(gid, hidden)`
  → `PATCH notices?id=eq.auto_<gid>`（写 `override_json`（白名单 title/cat/summary/aiSummary/deadline/eventAt/
  expireAt/timeLabel）、`hidden`、`edited_at`、`edited_by`，不要求 return=representation）；轻量签名查询扩展为
  `select=id,ts,hidden,edited_at` 且签名纳入 hidden/edited_at（否则管理员改动不改 ts 永远命中缓存）；整表解析保留
  override/hidden/edited 字段；通知页管理员卡底「编辑/删除」、编辑 bottom-sheet（6 字段）、「已隐藏」筛选（仅管理员）
  +「恢复」，失败 toast；非管理员由 cloud 过滤 hidden、页面也不显示入口。
- **需求 13 全局动画统一**：`app.wxss` 增加全局 `prefers-reduced-motion` 降级（enter/sheet/shimmer/各组件过渡），
  ripple 反馈统一 320ms；通知展开/收起改为 `max-height + opacity` 高度过渡（展开 .28s / 收起 .26s
  cubic-bezier(.2,.8,.3,1)，收起动画结束后再移除内容，`onHide` 清理延时定时器）；工作台轮换/浮动动画同样支持降级；
  页面切换沿用微信原生转场。
- **需求 14 体测男女/年级同步**：`pages/fttable` 初始 `sex/grade` 取自 `store.fit`（归一 m/f、12/34）；`setSex/setGr`
  写回 `store.fit` 并 `store.save()`（触发 userdata v6 fit section 的脏检测/上云），AI 接力改参数同样落 store；
  主 ft 页 onShow 读 store + `_syncFit()` 拉 userdata 后重绘 UI；sync_contract 新增「fttable 选择 → store.fit →
  push blob fit 字段集合 == web UD_FIT_KEYS」断言。
- **需求 15 性能**：工作台轮换只更新 4 个文案字段；nt「标记已处理」改为局部更新单卡 + 4 个统计数字（仅「待处理」
  筛选时重排列表）；tt `bindscroll` 不 setData；页面隐藏清理轮换/展开/滑动计时器；既有缓存/TTL/分包策略不变。
- **需求 16 通知/作业状态同步**：`app.js` 回到前台 `marksPull(true)`；hw/nt/index 页面 onShow / 下拉刷新 /
  onCloudSync 强制拉一次 marks（绕过 2min TTL）；marks 远端值变化后 `notifyPages` 让工作台计数与列表立即重绘；
  hw 页新增 `marksSync()`；写入失败仍进 `markPend`，恢复后 `cloudPull` 内 `flushPending` 补发并清队列。
- **测试**：新增 `mp-class-tools-tests/v2_unit_tests.js`（**24 项**：版本/scrollmem/长期安排/管理员编辑删除/QQ 文件待获取/
  工作台轮换/动画/体测与 marks 同步/合规扫描/不保留审核模式），并入 `unit.js`；`unit.js` 7b 段课表滑动用例按新规则
  重写并新增 6/7 天边缘场景；`tt_swipe_preview.js` 自动定位周末有课的周（6 天溢出、giveScroll、左右边缘切周、日视图）；
  `sync_contract_test.js` 新增需求 14/16 契约断言；README 增加 v2.0.0 章节（版本号位置/需求落点/审核相关说明/合规与
  发版清单/测试与包体/已知限制）。

### 验证

- `node unit.js` **147/147 PASS**（原 123 + v2 专项 24）
- `node sync_contract_test.js` **29/29 PASS**（新增需求 14/16 用例）
- `python staticcheck.py` exit 0（18 页、handlers / 分享 handler 0 缺失、无 web-view / 用户信息接口；AI off 后复跑仍 exit 0）
- AI 侧未破坏（AI 开关关闭前验证）：`node ai_unit_all.js` 8/8（296 项）、`ai_contract_test.js` **99/99**、`ai_eval_check.js --strict` **14/14**
- 开发者工具 automator 真实 touch：`node tt_swipe_preview.js` **16/16 PASS、0 console error**（自动定位周末有课的周：
  本轮真实数据命中第 7 周 6 天 / gridMaxX=53px，优先测第 9 周；非边缘让表格滚、右边缘左滑切下一周、左边缘右滑切上一周、
  日视图切周；截图 `_shots/tt-swipe/`）
- **AI 开关已关闭（发版默认）**：`python ai_toggle.py --off` 执行成功（app.json 无 agent/subPackages，`ai/` 源码保留，
  备份 `_backup_ai_toggle/app.json.bak-*`）
- 微信开发者工具 `cli.bat auto-preview` 编译通过：**AI off 发布包 TOTAL 667,382 B**（单主包，无 AI 分包）；
  开发期 AI 开启基线 TOTAL 1,044,276 B（main 688,982 + /ai/ 355,294），均远低于 2MB
- 合规静态扫描（v2 单测内）：无 web-view / 支付 / 抽奖 / 广告 / 第三方小程序导流 / 外部统计；网络域名仅
  CloudBase 网关与 `tool.furina.fun`；无审核相关入口与源码引用

### 发布注意（本次未上传）

1. **AI 开发模式已关闭**（`python ai_toggle.py --off`，发版默认状态）；发版后如需恢复 AI 适配：
   `python ai_toggle.py --on`（需重新上传/发布才生效）；
2. 云端迁移已由 Lead 执行并验证（notices override_json/hidden/edited_at/edited_by）；
3. 小程序后台隐私保护指引声明「学号 + 姓名（班级名单校验）」；服务器域名无需新增；
4. 版本号 2.0.0（`utils/version.js`）；上传/发布由 Lead 执行。

## 1.5.3 — 2026-11-05（课表内容左右滑动切周）

### 版本描述（短版）

把网页端的课表滑动效果同步到小程序：课表内容区左右拖动时跟手位移，松手达到 56px 切上一周/下一周——旧内容先飞出
（.16s + 淡出），新一周从另一侧飞入（.23s cubic-bezier(.22,.8,.3,1)）；不到阈值回弹，第一周/最后一周橡皮筋阻尼
0.28 后回弹。周表 6/7 天横向溢出时手势让给表格滚动；周/日视图仍只点击切换；滑动后 320ms 内点击被忽略。

### 更新内容

- **`pages/tt/tt.js`**：新增网页同款参数（`SW_LOCK=12` / `SW_LOCK_RATIO=1.35` / `SW_COMMIT=56` / `SW_DAMP_EDGE=0.28` /
  `SW_TAP_GUARD=320`）与 `onSwipeStart/Move/End/Cancel`、`_swipeSnap/_swipeCommit`；`refresh()` 拆出 `_buildData()`，
  让「换周数据 + 飞入起点」在同一次 setData 渲染，避免闪帧；溢出判定单一公式 `96 + days×colW > TT_CARD_INNER(630rpx)`；
  动画定时器统一登记并在 `onUnload` 清理；多指中断回弹、动画中禁起新手势 / touchcancel 不打断、snap 回调带手势序号。
- **点击抑制（对齐网页全局吞噬）**：滑动后 320ms 内 `openDetail / pickDay / prevWeek / nextWeek / thisWeek / setView /
  toggleList / openGroup / exportImg` 全部忽略首下点击，避免换周动画 150ms 窗口内点 ‹/› 造成周次回跳或点击丢失。
- **`pages/tt/tt.wxml`**：周表 `scroll-view` 与日视图外层包 `.ttswipe > .ttswipe-track` 并绑定触摸事件；「全部课程」移到
  滑动区外（对齐网页 `.ttmain` 与 `.ttside` 的边界）；移除旧「周导航区域左右滑动」`onWkTouchStart/End`（与网页一致：头部只点击）。
- **`pages/tt/tt.wxss`**：`.ttcard{overflow:hidden}` 裁剪飞出动画（卡片自带 28rpx 内边距，阴影不被切）、
  `.ttswipe-track{will-change:transform,opacity}`。
- **测试**：`unit.js` 新增 7b 段 10 项（跟手 1:1 / 边界 0.28 阻尼 / 纵向不锁定 / 飞出→换周→飞入时序 / 6 天溢出禁用 + 5 天可滑 /
  真实滑动后 320ms 点击全抑制且过期恢复 / 首周不换周只回弹 / 纵向占优不提交不抑制 / 多指与动画保护 / 卸载清定时器 / 静态参数对齐）；
  新增 `tt_swipe_preview.js`（开发者工具 automator 真实触摸事件回归）。

### 验证

- `node unit.js` **119/119 PASS**（新增 10 项课表滑动用例）
- `node sync_contract_test.js` **26/26 PASS**；`python staticcheck.py` exit 0（18 页、handlers / share handlers missing `[]`）
- AI 侧既有能力未破坏：`node ai_unit_all.js` 8/8（296 项）、`ai_contract_test.js` **99/99**、`ai_eval_check.js --strict` **14/14**
- `node tt_swipe_preview.js`（开发者工具 automator，真实 touchstart/touchmove/touchend）：**17/17 PASS、0 console error**；
  覆盖：跟手 / 飞出 / 换周 / 日视图滑动 / 课程卡点击 / 短滑后 320ms 内点卡片被忽略且过期恢复 / 动画中点头部「上一周」被忽略；
  截图 `mp-class-tools-tests/_shots/tt-swipe/`
- 独立只读复核（对照网页逐项）：核心动效与参数等价；复核提出的点击抑制覆盖不全、多指中断残留、动画中 touchcancel 打断、
  snap 过期回调、旋屏缓存、溢出双硬编码等问题已全部修复；手势范围收窄（只内容区）与 6 天溢出判定属两端布局/设计差异，已在注释与 README 写明
- 微信开发者工具 `cli.bat auto-preview` 编译通过：TOTAL **1,000,731 B**（main 645,437 + /ai/ 355,294）

## 1.5.2 — 2026-11-05（反馈建议停收 QQ / 微信联系方式）

### 版本描述（短版）

反馈建议页删除「联系方式（可选）」输入框：提交反馈只需要正文，不再收集 QQ / 微信。云端 `feedback.contact`
列保留（兼容表结构与旧数据），新提交固定写入空串；管理员反馈列表不再展示联系方式。微信 AI 开发模式的
`submitFeedback` 原子接口同步去掉 `contact` 参数。按用户要求核查并处理云端旧值：`feedback` 表当前 0 行，
不存在需要清空的联系方式。

### 更新内容

- **反馈页 `pages/fb/fb.*`**：删除联系方式输入框与 `contact` data / `onContact` 处理；提交只传正文；反馈列表 `metaText` 只显示时间。
- **`utils/cloud.js` `fbSend(content)`**：去掉 `contact` 入参；INSERT 行固定 `contact: ''`（保留列以兼容表结构与旧数据）；
  `fbDone` 的整行 upsert 原样保留 `row.contact`，不主动改写其它端提交的数据。
- **AI 原子接口 `ai/skills/account/apis/submitFeedback.js` + `mcp.json` + `SKILL.md`**：去掉 `contact` 入参、长度校验与「已附联系方式」话术；
  接口描述与意图分流不再引导模型索取联系方式。
- **数据与隐私页 `pages/data/data.wxml`**：反馈说明由「提交内容与联系方式」改为「提交内容」。
- **云端数据**：管理员身份只读核验 `public.feedback` 共 0 行、`contact` 非空 0 行，无旧值需要清理（行保留策略不变，仍不支持 DELETE）。
  清空工具 `mp-class-tools-tests/clear_feedback_contact.py`（默认只统计，`--apply` 才写；只打印条数，不打印 token / 内容）。
- **测试**：`unit.js` 反馈用例改为不传联系方式并断言请求体 `contact === ''`，新增 1 项静态断言（页面 / 云端 / AI 接口均不再出现联系方式）；
  `ai_unit_account.js` 断言即使模型传了 `contact` 也写空串；`e2e.js`（历史用例）同步去掉 `contact`。

### 验证

- `node unit.js` **109/109 PASS**（反馈断言改 1 项 + 新增 1 项静态检查后全绿）
- `node sync_contract_test.js` **26/26 PASS**；`python staticcheck.py` exit 0（18 页、handlers / share handlers missing `[]`）
- `node ai_unit_all.js` **8/8 文件、296 项 PASS**（account 41）；`node ai_contract_test.js` **99/99 PASS**；`node ai_eval_check.js --strict` **14/14 PASS**（92 用例 / 60 接口）
- 微信开发者工具 `cli.bat auto-preview` 编译通过：TOTAL **997,598 B**（main 642,304 + /ai/ 355,294）
- 云端核验（管理员 `class_verify` 只读；`class_members` 70 人、`visits` 可读证明 token 生效）：`feedback` 0 行，`contact` 无旧值

## 1.5.1 — 2026-11-05（导图 v2：清爽分享卡）

### 版本描述（短版）

导出图统一升级为与网页端同版式的「清爽分享卡」：760 逻辑宽 / DPR2，暖白渐变底 + 圆角主卡 + 柔和投影，
左上渐变装饰条 + 三色圆点品牌行，参数配置双列 tinted 面板（自动两列/单列），内容块支持文本 / chips / groups，
页脚保留生成时间 + 唯一编号 + 品牌三色点，斜向平铺水印裁剪在卡内。抽签 / 分组 / 结果单改用新 blocks API，
作业 / 课表 / 体测沿用文本块自动适配；导出命名、参数配置、水印与隐私约束不变。

### 更新内容

- **`utils/canvas.js` 重写 `drawCard()`（逐像素移植网页端 `exportCard()`，规格 `web/tools/tests/export_card_v2_spec.md`）**：
  - 画布 `W=760 / DPR=2`；底色垂直渐变（`#F2EDE2 → #F4F0E6`）；主卡内缩 `M=22`、圆角 22、白底 + 1px 边框，
    投影 `rgba(48,58,53,0.13)` / blur 26 / offsetY 8（只用于卡片填充）；内容盒 `X=50 / RX=710 / CW=660`。
  - 头部：左上 4×40 装饰条（primary→primary2 竖向渐变）+ 三色圆点（r=3，primary/primary2/sand）+ 品牌
    「班级工具站」11px/800 ink3；标题 30px/800（超 CW 逐级降到 22 仍超则截断加 `…`）；副标题 13px/500
    （降到 11.5 再截断）；1px 分隔线。
  - 参数配置：tinted 面板（panel/panelBorder 底边、圆角 14、pad 14）；标签 12.5px/500 ink3、值 14px/600 ink2，
    行高 21、标签列宽 104、间距 6；按「标签实测 ≤104 且值实测 ≤190」自动判两列（列宽 306 / 列距 20）或单列
    （单列标签列宽按实测自适应 110–186，长标签不硬折行），长值在值列内换行，行高按行数自适应。
  - 内容块（按 blocks 顺序）：区块标题 = 5×5 圆角方块 + 12.5px/800 primary；`text` 兼容 string / dim·strong·glue
    富文本 run / mono（20px/800 primary，行高 30）；新增 `chips`（30 高白底胶囊、数字 13.5px/800 primary +
    姓名 12px/500 ink2，自动换行）与 `groups`（两列组卡、groupBg 底、组头「第 N 组」+ 右侧「N 人」、成员横排换行）；
    全部高度自适应、画布无空底。
  - 页脚：分隔线 + 生成时间（11.5px/500）+ 编号（11px/500）+ 右侧品牌三色点（r=2.5）+ 品牌 11.5px/800 primary
    （右对齐到 RX）；画布高 `H = 卡底 + 22`。
  - 水印：先 `clip()` 到主卡圆角路径再画，alpha 0.03、700 15px、-20°，以画布中心平铺（x 步长 300 / y 步长 140、
    textAlign center），页面底色上不会出现被切半的水印字。
  - 色板换成规格 §1 的小程序暖色板，品牌 / 水印文字 = 班级工具站；对外 API 不变（`drawCard` 返回 H，
    `exportCard/saveToAlbum/exportAndSave` 与 `W/PAD/DPR/fontOf/wrap/rr` 均保留）。
- **页面入口改新 blocks API**：`pages/draw/draw.js` 抽签结果用 `chips`（`this.data.rows`）；`pages/group/group.js`
  分组用 `groups`（`this.data.groups`）；`pages/sum/sum.js` 抽签用 `chips`、各分组合成一个 `groups` 块；
  `pages/hw|tt|ft` 不改（文本块自动适配）。页面内展示 / 复制文本逻辑未动。
- **测试**：`mp-class-tools-tests/unit.js` 假 canvas 补 `createLinearGradient / arc / clip / shadow*` 与 textAlign/alpha
  记录；水印断言改为 v2（700 15px / alpha 0.03 / 先 clip 后画）；新增参数两列/单列自动判断、chips、groups、
  高度自适应 + DPR 放大断言。
- **文档**：README 版本号 v22 / 1.5.1，头部加导图 v2 说明与「导出卡 v2（1.5.1）」小节。

### 验证

- `node unit.js` **108/108 PASS**（导图相关 10 项全绿：标题/参数配置/页脚/编号/品牌、水印裁剪、两列/单列、
  chips、groups、高度自适应、换行、exportAndSave）。
- `python staticcheck.py` **exit 0**：18 页、handlers missing `[]`、share handlers missing `[]`、8 张分享封面齐全。
- `python render_export.py draw|group|sum|hw|tt|ft` → `mp-class-tools-tests/_shots/export/mp_{draw,group,sum,hw,tt,ft}.png`
  共 6 张逐张肉眼核查：无溢出 / 无重叠 / 无截断 / 无空底，水印只在卡内；另以「超长标题 + 20 个带姓名 chip +
  5 组 × 14 人」压力样例复核（标题自动降号截断、chips 自动换行、组卡两列等高、画布高度自适应）。
- 与网页端参考图（`web/tools/tests/_shots/export_*.png`）对照：主卡内缩/圆角/投影、头部基线与字号、参数面板
  行高与列布局、区块标题方块、列表与组卡间距、页脚结构一致；差异仅限色板（暖色）、品牌文字（班级工具站）
  与小程序无二维码。

## 1.5.0 — 2026-11-05（微信 AI 开发模式全程序适配）

### 版本描述（短版）

把小程序 18 个页面的业务能力封装成 8 个 SKILL / 60 个原子接口 / 19 张原子卡片，配置全局提示词、18 页页面元数据与页面接力（handoff），
让微信 AI（小程序 AI 开发模式）能读懂并操作班级工具站。AI 运行时与小程序共享登录身份与同一套 CloudBase 数据接口。
微信 AI 开发模式当前为内测 beta，本版本相关代码**不参与正式提审**；发版前用 `mp-class-tools-tests/ai_toggle.py --off` 关闭配置。

### 更新内容

- **新增独立分包 `ai/`**（`app.json.subPackages` root=ai, independent, pages=[]）：普通小程序页面零引用，不改变现有页面加载路径。
- **8 个 SKILL**：`classIdentity`（身份/名单/班委/我的概览/工作台总览/工具目录/使用说明，8 接口 5 卡片）、
  `homework`（6/1）、`notice`（5/3）、`timetable`（6/1）、`lottery`（抽签+分组+结果单，10/2）、`fitness`（7/2）、
  `rollCall`（7/1）、`myAccount`（同步/数据/隐私/反馈/统计，11/4）；合计 **60 原子接口 / 19 原子卡片**。
- **`ai/common/` 共享层**：身份（共享 storage `zq_class_identity`）、PostgREST/RPC 请求（`X-Class-Token`、超时/重试/错误码）、
  本机存储（`zq_tools_v2`/`zq_flow`）、marks（hw/ntdone/nt，失败入待补发队列）、统一返回结构（ok/fail/identityFail/confirmed 门禁）、
  日期/作业/通知口径（与主包逐字节一致）、页面接力构造。
- **`app.json`**：新增 `agent.skills(8)` + `agent.instruction("agent/AGENTS.md", 7,969B)` +
  `agent.pageMetadata("agent/page-meta.json", 18 页 7,139B)`；`lazyCodeLoading` 保持。
- **页面接力**：`app.js` 注册 `wx.onAgentHandoff`；新增 `utils/agent.js`（pick/pickQuery/apply）；16 页 onLoad 消费
  （先按 query/payload 渲染，再后台强制刷新；不新增阻塞弹窗/蒙层）；`pages/nt` 支持 `gid`/`filter` query。
- **隐私与安全**：不展示学号/手机号/token/设备号/完整名单原文；附件只给名称/大小/数量（data URI 不进模型上下文）；
  未认证统一 identity-required 并引导身份页；破坏性操作必须 `confirmed:true`（未确认不写盘）。
- **测试与工具**：新增 `mp-class-tools-tests/_ai_harness.js`（mock wx/modelContext）、`ai_contract_test.js`（99 项静态契约）、
  8 个 `ai_unit_*.js`（296 项）、`ai_eval_cases.json`（92 条评测用例，覆盖 60/60 接口）、`ai_handoff_check.js`、
  `ai_toggle.py`（发版开关）。

### 验证

- `node ai_contract_test.js --final` **99/99 PASS**；`node ai_unit_all.js` **8 文件 / 296 项 PASS**；
  `node ai_eval_check.js --strict` PASS（92 用例、60/60 接口 100%、复杂 32.6%、negative 10、unregistered 4）。
- QA 独立探测 **98/98 PASS**（60 接口逐一、11 个破坏性接口「未确认零写请求」、未认证零请求、导出隐私、通知/体测/抽签口径与主包一致）；
  页面接力静态复核 **41/41 PASS**（automator 实跑 4 页注入回归 PASS，其余因多会话 IDE 重启中断，记环境受限）。
- 回归：`unit.js 104/104`、`sync_contract_test.js 26/26`、`staticcheck.py exit 0`（18 页、handlers/分享 0 缺失）。
- 编译：`cli.bat auto-preview` 通过 —— TOTAL **993,304 B**（main 637,645 B + `/ai/` 355,659 B）。
- **未验证（环境限制）**：appid `wx3df9869d229b96c4` 未开通 AI 开发模式内测权限，`cli agent tool` 返回
  `agent compile mode is disabled`；原子接口/卡片的运行时与真机验证需先在公众平台申请「开发模式」，再用「小程序 AI 编译」验证。

## 1.4.7 — 2026-11-05（通知提醒：微信订阅消息）

### 版本描述（短版，适合审核 / 更新说明）

通知卡片新增「提醒」：可在截止前（1 天 / 2 小时 / 30 分钟）或自定义日期时间，通过微信订阅消息提醒自己；
已设提醒以胶囊展示、可修改/取消，换设备后仍能看到；简报区新增「新通知提醒」（订阅下一条通知）。

### 更新内容

- **通知卡片提醒（`pages/nt/*`）**：未过期卡片底部「提醒」按钮；有截止 → 截止前 1 天 / 2 小时 / 30 分钟（自动过滤已过时项）；
  无截止 → 今天 / 明天 20:00；另有「自定义…」→ 底部弹层（日期 + 时间选择，要求 ≥ 现在 1 分钟、有截止时不晚于截止、
  无截止 30 天内）。已设提醒显示胶囊「提醒 MM-DD HH:MM」，点击可修改/取消。
- **微信订阅消息**：设置时调用 `wx.requestSubscribeMessage`（必须在点击同步链最前），授权成功后再调云函数
  `subscribe`（`kind='ntremind'`，ref=通知组 id）；拒绝时明确提示且不写本机缓存。
- **云端提醒核对**：通知页加载/刷新/`onCloudSync` 调云函数 `list`，按 openid 恢复本账号提醒（换设备/重装可见），
  清理 `fireAt` 已过 10 分钟且云端无记录的本机项；离线保留本机缓存、失败静默。
- **深链**：订阅消息 `page=pages/nt/nt?gid=<id>`；页面数据就绪后自动切「全部」、展开并滚动定位该通知（只执行一次）。
- **新通知提醒**：简报区小按钮订阅「下一条通知」（`kind='nt', ref='next'`），发布新通知时由云函数发送。
- **本地缓存**：`store.ntRemind`（新增 DEF 字段，按通知组 id 存 `{ref,fireAt,label,ts}`；不同步到 userdata/web，
  因为订阅消息是 openid 维度、网页无此能力）；`utils/notify.js` 新增 `subscribeNoticeReminder / listReminders / cancelReminder`。
- **隐私说明**：数据与隐私页「隐私说明」新增「订阅」条——通知提醒需微信授权订阅消息；openid 仅用于发送提醒、仅云函数使用。
- **云函数 `cloudfunctions/notify`（已部署）**：扩展 `kind='ntremind'`：`subscribe`（校验 ref/fireAt 开区间/同 openid
  活跃 ≤50/去重更新）、`list`（本人 active、字段裁剪、按 fireAt 升序 ≤100）、`cancel`（本人）、`timer` 处理
  hw + ntremind 到点发送（每批 20；成功置 inactive，失败 attempts+1，3 次后停用；消息 page 带 gid）、
  `publishNotice` 只发 `kind='nt'`；定时触发器 10 分钟 → **每分钟**（`0 */1 * * * * *`）。
  部署环境 `fengdan-d6g7hnk4gf35685b3`（Active / Nodejs16.13 / timeout 3s）；回滚备份
  `cloudfunctions/_backup/notify_20261105-1309_preRemind/`。

### 验证

- 前端：`node notify_ui_test.js` **25/25**、`node unit.js` **104/104**、`node sync_contract_test.js` **26/26**（无回归）、
  `python staticcheck.py` 18 页 / handlers 0 缺失、`cli preview` 编译通过（main 622.7KB）。
- 云函数：`notify.test.js` **35/35**（mock，零真实发送）；已部署并 download 比对 sha256 与本地一致。
- 独立验收（QA）：云函数契约 **50/50**、前端契约 **42/42**、automator UI 全流程 **23/23**（合成数据 + 全 stub，
  未真实授权/未发消息；7 张截图）；真实云函数只读 `list` 调用 4/4；页面/导出不展示 openid。
- **未验证**：真机真实授权与到点送达（需用户发布前实测一次；自动化全程未触发真实订阅消息）、定时触发器在线调度
  （config/download 已证实含每分钟 cron，控制台需人工确认）、弱网/真机。

### 说明 / 风险

- 一次性订阅模板：每次授权只能发送一条消息；若期间被其它提醒消耗，本条可能收不到（云端 list 核对会清理失效项）。
- 云函数部署已生效（服务端），**小程序前端需上传发布后正式版才有入口**。
- `send` 成功但 `markDone` 失败时会在下一分钟重发；一次性订阅通常已消耗 → 第 2 次失败记 attempts，3 次后停用。

## 1.4.6 — 2026-11-05（数据与隐私模块 + 用户内容全量同步，与网页端互通）

### 版本描述（短版，适合审核 / 更新说明）

新增「我的 → 数据与隐私」页：可查看同步范围与本机/云端数据、一键同步、导出数据、关闭云同步、清除云端/本机数据，并附隐私说明。同步范围扩大为**所有用户改动内容**——作业完成、通知已处理 / 置顶、工具栏顺序、体测录入与记录、抽签 / 分组参数与名单选择、点名名单与到·假、隐藏项、课表与提醒偏好、昵称；网页与小程序同一账号下自动双向互通。

### 更新内容

- **通知已处理（新）**：`marks` 新增 `kind='ntdone'`（ref=自动通知组 id），写入用 upsert、取消写 `val=false`（无 DELETE）；通知页「标记已处理」由会话内状态改为**持久化并跨端同步**；网页端使用同一行数据，两端行 id 规则一致（`学号|kind|ref`）。
- **userdata blob 升级 v6**：`{v:6, at:{homeTools,fit,draw,group,roster,hide,tt,prefs,nick}, ...}`，每个 section 带时间戳、逐项 last-write-wins 合并（同时间戳云端赢，幂等收敛）；旧 v5（`fit`+`homeTools`+`homeToolsAt`）自动迁移；保留未拥有 section（小程序不写 `nick` 与 `tt` 中除 `termStart` 外的字段），避免用默认值覆盖网页数据。
- **同步触发**：`cloudPull` 内 TTL 60s 拉取；`store.save()` 后脏检测、防抖 1200ms 合并推送（先 GET 合并再 POST upsert）；离线进 `udPend` 待补发；应用远端数据不会重置进行中的抽签/分组结果；`draw/group/roll/ft` 页补 `onCloudSync`。
- **数据与隐私页**（`pages/data/*`，18 页）：身份摘要（不显示学号）、云同步开关（仅本机模式）、12 项同步范围、本机数据概览（`wx.getStorageInfoSync`）、云端数据说明、立即同步、导出我的数据（JSON→剪贴板，不含 token/学号/名单原文）、清除云端我的数据（空 v6 + marks 置否 + fitrecs 归档；访问统计/反馈不可删，页面如实说明）、清除本机数据（保留身份）、隐私说明（收集/不采集/用途/存储/保留/不共享/反馈渠道）。
- **清除语义修复**：清除云端后新增 `udHoldUntil` 抑制期——在用户再次显式修改同步内容前**不会自动回推**本机数据重建云端副本；页面文案同步说明；清除期间暂停脏检测、等在途推送落定，防「先清后写」。
- **旧文案全量校准**：me / identity / roll / ug / cloud-config 中「课表 / 抽签参数 / 点名记录只存本机」「标记已处理不落库」等过期表述已更新为新范围（同步可关、可清除；身份 token 与班级名单缓存仍仅本机）。
- **接口变化**：`udSync()` 返回 `{ok,changed,pushed,reason}`（移除旧 conflict 弹窗路径）；新增 `udStatus/setCloudOff/udClearCloud/udPendingCount/isReadyForSync`；`cloudPull` 返回新增 `ud` 字段。

### 验证

- `node unit.js` **79/79**；`node sync_contract_test.js` **26/26**（merge 与契约 fixture 逐字节一致、v5 迁移、ntdone、push body 含未拥有 section 保留、防抖、cloudOff、清除抑制期、导出隐私、页面静态断言）；夹具副本 `mp-class-tools-tests/_sync_fixtures/`。
- `python staticcheck.py`：18 页、handlers missing 0、分享 handler / 封面 0 缺失；`cli.bat preview` 编译通过 **588.2 KB / 602,290 B**。
- 独立验收（QA）：合并算法独立实现 116/116、wx mock 独立复跑、隐私 strict 31/31、开发者工具 automator 真实云端 **34/34 PASS / 0 console error**（含「标记已处理→退出重进仍已处理」、隐私页开关/导出/清除、清除后不自动回推）。
- **未验证**：真机；真实云端写入默认不做（契约/单测/模拟器层面验证；发布前如需可在开发者工具人工验证）。
- **说明/风险**：marks 无 DELETE，「清除」只能置否/归档；清除云端后本机内容保留、再次修改设置时重建云端副本（页面已说明）；cloudOff 只拦同步读写与自动写，用户显式发布作业/通知/反馈仍走网络。

## 未发布 · 2026-11-04 修复 visits / feedback 写入 401（源码已改，随下次发版生效）

- **根因**：`public.visits` / `public.feedback` 的 SELECT RLS 原来只有管理员；而 `utils/cloud.js` 的
  `visitLog()`（访问统计埋点）与 `fbSend()`（反馈提交）写请求统一带 PostgREST
  `Prefer: return=representation`。PostgREST 的 INSERT + returning 要求新行**同时能被 SELECT** →
  非管理员写入返回 `401 DATABASE_42501 new row violates row-level security policy`，被 `.catch` 静默吞掉。
  现象：统计只有管理员自己一个人、普通同学反馈提交一直失败。
- **改动**：`utils/cloud.js` 两处 `headers(true)` → `headers(false)`（文件 +2 字节，其余 0 改动），
  写入不再请求返回行；返回/错误处理保持不变。
- **验证**：`node unit.js` **79/79**；`python staticcheck.py` 17 页、handlers missing 0、分享 handler/封面 0 缺失；
  临时 mock（mock 全部 `wx.request`，不碰真实网络）**20/20**：visits/feedback POST 均无 `Prefer`、
  仍带 `X-Class-Token` / `Authorization` / `Content-Type`。
- **服务端同批修复**（网页仓库 `web/CLOUDBASE.md`「访问统计 / 反馈 RLS」）：RLS 放行「本人行」SELECT，
  所以**未发版前小程序写入已恢复**；本源码改动发版后不再依赖该放宽。
- 关联：网页端同一根因同一批修复（`web/CHANGELOG.md` 2026-11-04 23:35 / HANDOFF §27）。

## 1.4.5 — 2026-11-04（性能：通知分块持久缓存 + 30s 轮询不再重拉 2MB）

### 版本描述（短版，适合审核 / 更新说明）

通知、作业等云端数据改为「本机持久缓存优先」：首次进入后即缓存，之后打开秒开；30 秒后台轮询不再整表重拉
约 2MB 的通知数据（改为 ~2KB 签名校验，内容变了才拉整表）。弱网/流量场景明显更省、更流畅，界面与功能不变。

### 更新内容

- **新增 `utils/cache.js`（分块持久缓存）**：`zqc1_idx` manifest + `zqc1_<sid>_<name>_<i>` 分块，单块按 UTF-8
  估算 ≤600KB（远低于微信单 key 1MB 上限）、总预算 5MB 按 at LRU 淘汰；按学号 sid 命名空间；TTL；缺块 /
  损坏 / 版本不符 → 返回 null 并清理；写失败静默；退出身份 / 换号 / 清空数据 → `clearAll()`。
- **`utils/cloud.js` 通知缓存优先 + 轻量签名**：`ntAutoPull()` 有缓存先给缓存；TTL（10min）过期先发
  `notices?select=id,ts&order=ts.asc,id.asc`（≈2KB）与缓存 `id:ts` 签名比对，一致只更新时间、不拉整表；
  不一致才整表拉并重写缓存；`force`（下拉刷新）只跳过 TTL 不跳过签名；`ntSync` 单飞去重；真的变了才
  `notifyPages()` 让当前页重绘。
- **其余表 TTL 门控**（`lastSync` manifest）：homework 10min、fitrecs 5min、marks 2min、class_members 6h、
  tt.json 6h；命中直接用 `zq_tools_v2` / `ttCache` 本机数据（0 请求）。`cloudPull(force)` 供 30s 轮询与下拉刷新。
- **`app.js`**：首次前台后 ~300ms 才后台预热（不阻塞首屏）；30s 轮询 TTL 门控；`udSync` 每 30s → 5min 节流；
  onHide 清理预热定时器。
- **页面最小改动**：`pages/hw/hw.wxml` 附件缩略图 3 处加 `lazy-load`；`pages/index/index.js` 的
  `onCloudSync` 复位 60s 节流并透传 force、`ttFetch(force)`；`pages/tt/tt.js` 共享数据时不再重复请求；
  `pages/committee/committee.js` 下拉刷新 force。**`pages/nt/nt.*` 零改动**（缓存优先在 cloud.js 层生效）。
- **隐私**：缓存按学号隔离；`identity.clear()`、学号变化保存、我的→清空数据均清空缓存，共用手机不串号。

### 验证

- `node unit.js` **79/79 PASS**（61 原有 + 18 新增缓存单测 `cache_unit_tests.js`：分块 >1MB、TTL、
  sid 隔离、损坏/缺块回退、预算淘汰、退出身份清空、cloudPull TTL 门控、force 语义、无 getApp 不崩）。
- `node cache_perf_test.js` **16/16 PASS**：20 轮 × 30s 轮询 90 请求 / 56.75MB → **9 请求 / 4KB**；
  二次进入通知页 **0 请求**；TTL 过期仅 1 次签名请求。
- `node perf_cloud_probe.js`（只读真实云端，不打印 token/内容）全 PASS：整表 1.91MB/322ms vs 签名
  2,152B/38ms；lite 两次顺序一致且与整表一致。
- 开发者工具 automator（真实云端，`_perf_nt_preview_result.json`）：12 卡渲染、缓存 1,988,238B / 6 块 /
  单块最大 612,415 字符、二次进入 0 请求、0 console error。
- `python staticcheck.py`：17 页、handlers missing 0、分享 handler / 封面 0 缺失；
  `cli.bat preview` 编译通过（TOTAL 558.7KB / 572,155B）。
- 说明：真机未测；「首次无缓存」仍会拉一次整表（工作台需要通知待办），之后全部走缓存。

## 1.4.4 — 2026-11-04（通知页完整对齐网页端 + 手机界面优化）

### 版本描述（短版，适合审核 / 更新说明）

通知页按网页端通知页完整重做：**未过期通知默认展开、已过期默认收起**；附件从「一行文字」升级为**文件卡（PDF/XLS 图标 + 预览/下载）**，图片支持网格预览，收集表/链接/小程序/公众号各有一行可操作卡片；新增简报「最近 3 条待处理」、标记已处理、已过期独立折叠区；同时去掉重复标题、重排手机阅读节奏。

### 更新内容

- **默认展开规则**：`mapGroup()` 按网页端口径计算 `expired`，`expanded = !expired`；已过期卡片及「已过期」区块默认收起，点「展开」才显示详情。展开/收起会记住本页状态（`_expanded`）。
- **状态口径对齐网页端**（`utils/notice.js` 重写）：真实截止 `deadline`（含 `extensions` 最后一次延期）优先，`expireAt` 只作自动归档兜底、不再当截止时间显示；无截止时按 `eventAt`/`archiveAt` 判断；`alert`（有新名单）不算过期；状态文案对齐「已截止 · 自动完成 / 已延长 · 已截止 / 已结束 · 自动归档 / 剩 N 分钟 / 今天 HH:MM 截止 / N 天后截止 / 无时间」。工作台与通知页继续共用该口径。
- **卡片**：分类/OCR/状态/「原始消息」；来源 + 发布者职位气泡；AI 摘要 + 要点；字段拆分（时间/地点/对象/内容/报名/截止/要求/联系方式/补充）；底部「标记已处理 + 展开/收起」。已处理卡片状态变「已处理」并置灰（与网页一致，本页会话内有效、不落库）。
- **附件 / 媒体（对齐网页端）**：
  - 文件：文件卡展示（按扩展名显示 PDF/XLS/DOC/PPT 图标 + 文件名 + 大小/说明），提供「预览」「下载」；data URI 先写临时文件再 `wx.openDocument` / `wx.previewImage`，远程附件走 `wx.downloadFile`；
  - 图片：2 列网格 + 说明，base64 一次性转本地临时文件（不塞进 `setData`），点击全屏预览；
  - 收集表：显示报名中/已截止 + 截止时间 + 「打开」；链接 / 小程序 / 公众号：显示文件名/标题/域名 + 「打开 / 复制链接」（小程序内不能直接开外部网页，统一复制链接，符合平台限制）；
  - 原文摘录：无 AI 摘要时在详情里展示前 2 行原文 + 发送者职位气泡；「原始消息」底部弹层保留完整原文。
- **简报与筛选**：四项统计（待处理 / 24h 截止 / 7 天内 / 已过期）+ 最近 3 条待处理（点击跳转并展开对应卡片）+ 刷新；筛选改为「全部 / 待处理 / 已截止 + 分类（全部分类 / 教务 / 活动 / 班级事务 / 缴费）」；已过期独立折叠区显示组数。
- **手机界面优化**：移除页面内重复的大标题（保留原生导航栏），简报改 4 格紧凑统计，字段拆分为单列「标签 + 文本」行，按钮可点区域 ≥ 52rpx，图片/附件卡圆角与间距统一；颜色全部走 `--md-*` token，暗色自动跟随。
- **兼容**：云端数据契约不变（只读 `[[CLASS_NOTICE_V1]]` JSON），不改 schema / 不写云表；`data.autoList` 保留为当前列表的兼容别名，旧回归脚本可继续读取。
- **验证**：
  - `node unit.js` **61/61 PASS**（通知页两条旧断言已按新契约更新：默认展开、筛选透传、原始消息气泡、展开后懒加载图片）；
  - `node nt_preview.js`（新增，开发者工具 automator，真实云端 24 组通知）**19/19 PASS、0 console error**：默认展开 12/12、过期收起 12/12、附件卡 5、图片卡 6、表单/链接/小程序/公众号行、图片落地、收起/展开、标记已处理计数、原始消息、已过期筛选与区块展开；
  - `node nt_badge_preview.js light` **22/22 PASS**（职位气泡/OCR/原始消息兼容回归）；`node ia_preview.js` **30/30 PASS**；`python staticcheck.py` 17 页、handlers missing 0、分享 handler/封面 0 缺失；
  - `cli.bat preview` 编译通过 **TOTAL 558.8 KB / 572,184 B**。
- **截图**：`mp-class-tools-tests/_shots/nt/`（01-top / 02-raw-sheet / 03-expired-filter / 04-file-card / 05-form-row）；桌面交付图 `小程序通知页_网页功能复刻_20261104.png`（改版前 vs 改版后 6 个场景）。

## 1.4.3 — 2026-11-04（通知气泡改为直接显示职位）

### 版本描述（短版，适合审核 / 更新说明）

通知卡的发布者气泡不再统一显示「班委」，改为直接显示班委职务（如「班长」「学习委员」「副团支部书记」）；原始消息弹层里的发送者也同样显示职位气泡。

### 更新内容

- **发布者行**：`pages/nt/nt.js` 的 `mapGroup()` 新增 `pubBadge = senderRole || senderBadge`（`senderName` / `senderRole` / `senderBadge` 原字段保留），`applyFilter()` 透传；`pages/nt/nt.wxml` 改为 `[职位] 姓名`——气泡文字取 `pubBadge`（**职务优先**，`senderRole` 为空才退回「班委」兜底，非班委不显示气泡），去掉原「· 职务」尾巴。
- **原始消息弹层**：`openRaw()` 为每个 text / follow 块补充发送者 `fromName` 与 `fromBadge = fromRole || fromBadge`（兼容旧字段 `from`）；`pages/nt/nt.wxml` 弹层每块头部显示「原始消息 / 补充通知 + [职位] 发送者姓名」，不再出现「班委」统称。
- **样式**：`.nt-badge` 复用暖沙容器气泡；删除不再使用的 `.nt-role`；新增 `.nt-raw-hd` / `.nt-raw-from`（原始消息头部一行）；仍全部使用 `--md-*` token，无写死 hex。
- **数据契约不变**：CloudBase 继续下发 `senderName/senderRole/senderBadge` 与 `items[].fromName/fromRole/fromBadge`；纯前端展示调整，不改 schema / 不调写接口。`senderRole` 为空但 `senderBadge=班委` 的旧数据退回显示「班委」（当前云端数据 0 条触发）。
- **验证**：`node unit.js` **61/61 PASS**（更新断言：`pubBadge = senderRole`、无 role 退回 senderBadge、wxml 不再出现「班委」统称 / 无「· 职务」尾巴、原始消息 `fromBadge = fromRole || fromBadge`）；`python staticcheck.py` 17 页 handlers missing 0、分享 handler / 封面 0 缺失；`node nt_badge_preview.js light`（开发者工具 automator，真实云端数据）**22/22 PASS、0 console error**——12 张卡片中 9 张职位气泡，DOM 气泡文字 `["劳动委员","学习委员","班长","生活委员","班长","班长"]`（无「班委」）、4 张 OCR 通知、原始消息发送者气泡 = 学习委员；浅色截图 `mp-class-tools-tests/_shots/nt-badge/nt-light.png` / `nt-light-raw.png`。深色截图未做（样式全部走 `--md-*` token，静态可验）。

## 1.4.2 — 2026-11-04（通知页：班委气泡 + OCR 图片通知；名单名字 UI 简化）

### 版本描述（短版，适合审核 / 更新说明）

班级通知卡片新增发布者行：班委发布的通知在姓名前显示「班委」气泡并带职务；来自群图片 OCR 识别的通知在状态旁显示小「OCR」标记，便于区分文字通知与图片识别通知。同时把 v15 的名单名字气泡简化为 M3 简约 chip（未选细边描边、已选浅色容器，更贴合整站克制风格）。

### 更新内容

- **发布者行**：`pages/nt/nt.js` 的 `mapGroup()` 映射 CloudBase 通知组新增字段 `senderName` / `senderRole` / `senderBadge`（统一 trim，缺省空串），`applyFilter()` 原样透传给卡片；`pages/nt/nt.wxml` 在标题下方渲染「[班委] 姓名 · 职务」——**班委气泡固定在姓名前面**，非班委只显示姓名，`senderName` 为空时整行不渲染（老数据零迁移）。
- **OCR 图片通知**：通知组带 `ocr: true` 时，卡片顶部状态旁显示克制的「OCR」小标记（`isOcr`）；图片仍是 `items[].kind:"img"`（展开后才加载、点击全屏预览），OCR 识别文字（`items[].kind:"text"`）照旧进「原始消息」底部弹层——交互与 1.4.1 一致，不新增层级。
- **样式**：`pages/nt/nt.wxss` 新增 `.nt-pub` / `.nt-badge` / `.nt-pub-name` / `.nt-role` / `.nt-ocr`；全部使用 `--md-*` M3 token（班委气泡 = 暖沙容器色，OCR 标记 = 中性描边），浅色 / 暗色跟随系统，不写死 hex。
- **数据契约（后端下发，前端只读）**：`senderName` 已去座号数字；`senderRole` / `senderBadge` 非班委为空串；`ocr` 无字段即普通通知。小程序端不推断字段（`senderRole` 有值但 `senderBadge` 缺失时不显示气泡），不改云端 schema / 不调写接口。
- **名单名字 UI 简化（v15 名单选择器视觉跟进）**：`app.wxss` 的 `.lp-bubble` / `.lp-chip` 从「液态糖果风」改为 M3 简约 selected chip——未选 = `surface-container-lowest` 底 + `outline-variant` 1rpx 边 + `on-surface` 字（28rpx / 600）；已选 = `primary-container` 底 + `primary` 边 + `on-primary-container` 字；座号 20rpx、opacity .55、与名字间隔 8rpx。去掉渐变背景、`::after` 玻璃高光、`lpFloat` 浮动、`lpPop` 弹跳、重阴影与 `--lp-*` 私有 token；按压只保留 `hover-class` 的 `scale(.97)` + 120ms transition。`components/roster-picker` 移除 `.lp-float` 外壳与内联动画参数，JS 删除 dur / delay / popSeat / popTimer 逻辑（全选 / 清空 / 取消 / 确定 / 计数 / 重新加载行为不变）；页面摘要 `.lp-chip` 为同款选中样式的小号版，`+N` 改虚线幽灵 chip。纯视觉改动，数据 / 迁移 / 云端契约不变。
- **名单姓名口径修正（与网页端对齐）**：`pages/draw/draw.js` 的 `apply()` 与 `pages/group/group.js` 的 `members()`（上一步抽签分支）姓名只取派生名单文本 `util.rosterMap(store.roster)`（与网页端 `nameOf` 同源）——未选参与名单 = 只抽序号，结果不再用班级名单全量姓名兜底；选了名单才带姓名。由独立验收脚本 `roster_verify.js` 发现（1.4.1 会显示未选座号的姓名）。
- **验证**：`node unit.js` **61/61 PASS**（新增 2 项：senderName/senderRole/senderBadge/isOcr 映射 + applyFilter 透传；班委气泡在姓名前的渲染条件 + OCR 标记条件 + openRaw 收入 OCR 文字 + 图片按需加载）；`python staticcheck.py` 17 页 handlers missing 0、分享 handler / 封面 0 缺失、无 MISSING / COMPONENT MISSING；开发者工具 automator 通知页回归 **14/14 PASS、0 console error**（真实云端数据：14 张卡片、10 张带 `senderName/senderBadge/senderRole`、4 张 OCR 通知 `.nt-ocr`/`.nt-badge` DOM 均命中），浅色截图 `mp-class-tools-tests/_shots/nt-badge/nt-light.png`（含 OCR 卡）与 `nt-light-raw.png`（OCR 文字进原始消息）；深色截图未做（需在模拟器手动切主题，样式全部用 `--md-*` token 静态可验）。**名单视觉简化 / 姓名口径复跑**：`cli.bat preview` TOTAL **527.7 KB（540336 B）**；`node roster_preview.js` **22/22 PASS**、`node roster_verify.js`（独立验收）**58/58 PASS**，均 0 console error，截图 `_shots/roster/` 与 `_shots/roster_verify/`。

## 1.4.1 — 2026-11-04（名单只来自班级名单 + 液态气泡选择器）

### 版本描述（短版，适合审核 / 更新说明）

抽签 / 分组 / 点名三处名单不再支持自定义输入：点「选择名单」从班级名单（70 人）里逐个选择或一键全选，已选名单用液态气泡显示；旧的自定义名单文本会自动迁移为班级成员。

### 更新内容

- **三处名单入口改造（不再支持自定义名单）**
  - 抽签页：删除「编辑名单」底部弹层（textarea / 粘贴 / 清空 / 导入班级名单）；参数卡片改为「参与名单」行 +「选择名单」按钮，已选成员以液态气泡摘要显示（最多 8 个 + 「+N」），提示「已选 N 人 · 只从名单中抽」/「未选择 · 只抽序号」。
  - 分组页：成员来源「粘贴名单」改为「班级名单」；删除粘贴 textarea，改为已选气泡摘要 +「选择名单」；未选名单点「开始分组」提示「请先选择名单」；成员按座号升序参与分组。
  - 点名页：删除「导入班级名单 / 用抽签页名单 / 编辑名单」与编辑弹层；改为「选择名单」+「沿用抽签名单」+「重置本轮」，名单以所选座号成员呈现；沿用抽签名单为空时提示「抽签页还没有选择名单」。
- **新增组件 `components/roster-picker`**：复用 `bottom-sheet`，页面传 `show` / `title` / `selected`；内部从 `class_members` 读名单（缺失时重拉，失败给「重新加载」），按座号升序渲染气泡；头部「已选 N / 70」，底部「全选 / 清空 / 取消 / 确定」；点气泡切换、打开时初始 = 传入选择、确定回传 `{seats}`、取消/点遮罩关闭；55vh 滚动区、可点区 ≥72rpx。
- **液态气泡视觉**：`app.wxss` 新增共享 `.lp-bubble` / `.lp-chip`（M3 token + 暗色适配）——胶囊形；未选 = surface-container 底 + outline-variant 描边 + 轻投影 + 半透明，已选 = 主色渐变（浅色 #5E8F87→#7BA99D，暗色 --md-primary 系）+ 内高光 + 白/深字；名字为主、座号 20rpx 小字；`::after` 径向渐变玻璃高光；气泡 3.5–5s 错峰浮动、按压果冻 scale(.92,.88) + 圆角变化、选中 pop 动画；页面上的已选摘要复用同一套液态样式（`styleIsolation: apply-shared`，纯 WXSS/WXML，无图片 / 第三方库 / web-view）。
- **数据模型（本机）**：`zq_tools_v2` 新增 `rosterSel` / `group.sel` / `rollSel`（座号数组，去重、升序、正整数）与 `selVer` 迁移标记；`roster` / `group.names` / `rollNames` 保留为派生文本（draw → 「座号 姓名」多行、group → 仅姓名、roll → 「座号 姓名」），页面不再手工编辑；`classRoster` 保留但不再使用。新增 `utils/roster.js` 统一负责 `members()` / `selOf` / `setSel` / `rollSet` / `textOf` / `namesTextOf` / `summary` / `poolFilter` / `migrate`。
- **旧数据迁移**：旧自定义名单文本逐行取姓名与 `class_members` 精确匹配 → 座号，匹配不到的人丢弃；点名旧 `rollSt` 以「旧下标 → 姓名 → 新下标（按座号升序）」保留同一个人的 到/假 状态；迁移成功置 `selVer = 1` 不再重跑；名单缓存为空时保留旧文本、返回 false，`utils/cloud.js` 的 `saveMembers()` 成功后与各页 load / onShow 自动重试。
- **抽签语义**：未选名单 = 只抽序号（原行为）；选了参与名单 → 抽签池 = 名单 ∩ 范围 − 排除，结果必带姓名；导出参数与结果卡改为「参与名单（N 人）」；只选 3 人时抽签池 = 3，抽 10 个会提示「名单内可用人数 3 个…（可打开「允许重复」）」。
- **分组语义**：`source` 新值 `'pick'`，兼容旧 `'paste'`（load 归一为 `pick`）；成员 = 已选座号按升序的 `{n: 座号, nm: 姓名}`；派生 `group.names` 仅姓名文本。
- **点名语义**：渲染仍用派生 `rollNames`；`data.namesCount = rollSel.length`；名单变化经 `roster.rollSet` 重排 到/假 状态（同一个人状态不丢）；重置本轮只清状态、保留名单。
- **使用说明**：`pages/ug/ug.js` 更新「抽签 / 名单 / 分组 / 点名」四条文案（名单不可自定义、选择名单 + 液态气泡、分组来源、点名沿用抽签名单）。
- **验证**：`node unit.js` **59/59 PASS**（新增 8 项：store 新字段与座号归一 / members 清洗 + textOf / setSel 过滤未知座号 + 抽签池过滤 / 旧文本迁移 + 状态按姓名重排 + 幂等 / rollSet 状态保留 / classMembers 为空延迟迁移 / saveMembers 自动迁移 / draw buildPool）；`python staticcheck.py` 17 页 handlers missing 0、无 MISSING / COMPONENT MISSING；`cli.bat preview` 编译成功 **TOTAL 529.5 KB（542203 B）**；`node roster_preview.js`（开发者工具 automator + 真实 class_verify 只读身份）**22/22 PASS、0 console error**，截图 `mp-class-tools-tests/_shots/roster/`（选择器空 / 全选、抽签结果带姓名、分组、点名沿用与状态保留）。
- **不加** npm / CDN / 构建链 / web-view；不改云端 schema / RLS / 接口；不部署（仅编译验证）。

## 1.4.0 — 2026-11-04（微信原生分享）

### 版本描述（短版，适合审核 / 更新说明）

小程序全部 17 个页面接入微信原生分享：右上角「···」可转发给朋友或分享到朋友圈，分享卡片带页面标题、5:4 封面与对应打开路径（课表会带上当前周次，通知会带上最新一条标题）。

### 更新内容

- **原生分享菜单**：新增 `utils/share.js`，每页 `onShow` 调 `share.enable()` → `wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage','shareTimeline'] })`，转发 / 朋友圈都可用；不额外塞自定义分享按钮。
- **每页分享内容**：17 页全部实现 `onShareAppMessage`（`{title, path, imageUrl}`）与 `onShareTimeline`（`{title, query, imageUrl}`）。
  - 工作台 → `/pages/index/index`；工具 → `/pages/all/all`；我的 → `/pages/me/me`；
  - 课表 → `班级课表｜第 N 周` + `/pages/tt/tt?wk=N`（课表页新增 `?wk=` 打开定位，`onLoad` 读取后直接显示该周）；
  - 通知 → `班级通知｜<最新一条标题>`；班委 → `班委名单｜N 名班委`；抽签 / 分组 / 结果单 / 作业板 / 体测 / 国标表 / 点名 / 统计 / 反馈 / 使用说明 / 身份页各自带标题与本页路径。
- **分享封面**：新增 `images/share/*.png`（500×400，5:4；default / index / tt / hw / nt / draw / ft / bz 共 8 张），由 `mp-class-tools-tests/make_share_images.py` 生成（莫奈暖白底 + 彩色圆底白字形图标），避免转发时默认截屏出现空白或滚动状态。
- **使用说明**：新增第 ⑫ 条「分享」。
- **验证**：`node share_check.js`（开发者工具 automator）逐页调用两个分享接口并校验 title / path / query / 封面文件，**58 项全过、0 console error**；hook `wx.showShareMenu` 确认菜单同时带 `shareAppMessage` + `shareTimeline`；`node unit.js` 51/51（新增分享参数单测）；`staticcheck.py` 增加「每页分享 handler + 封面存在」检查，17 页 0 缺失。

## 1.3.3 — 2026-11-04（去掉头像；页面不再显示学号）

### 版本描述（短版，适合审核 / 更新说明）

移除工作台 / 我的 / 身份页的姓名首字头像，并取消「学号打码展示」：所有页面不再显示学号（姓名在班级内本就公开），身份验证仍使用姓名 + 学号。

### 更新内容

- **去掉头像**：工作台顶部、我的身份卡、身份页已保存身份卡不再渲染姓名首字头像；相关样式与数据字段（`avatar`）一并删除，页面改为纯文字身份信息（姓名 + 角色 / 徽章 pill）。
- **不再显示学号**：我的身份卡、身份页已保存身份卡、班委名单、访问统计、反馈归属兜底全部去掉学号展示（原先均为打码学号，现直接不展示）；统计页改为「按姓名聚合（不显示学号）」，班委名单只显示姓名 / 职务 / 徽章，反馈里查不到姓名时显示「（未知成员）」而不是学号前缀。
- **代码清理**：`utils/identity.js` 删除 `maskSid` / `sidMask`（页面已无打码展示需求）；学号仍作为云端身份 / 作业归属 / 访问统计的内部键，不上页面。
- **文案**：身份页隐私说明改为「只显示姓名与角色，不显示学号」；使用说明同步；我的页版本号 v1.3.3。
- **验证**：`node unit.js` 50/50（新增 maskSid 已移除、统计页无学号字段断言）；`staticcheck.py` 17 页 handlers missing 0；开发者工具回归（ia_preview 30 项 / identity_preview 26 项）全过，浅色截图确认工作台、我的、身份页、班委、统计均无头像与学号。

## 1.3.2 — 2026-11-04（信息架构重设计：工作台 / 工具 / 我的）

### 版本描述（短版，适合审核 / 更新说明）

首页工作台精简为「今日课程 + 待办 + 常用工具」，工具页改为完整工具目录并支持调整首页快捷，我的页集中身份、个人数据、同步、隐私与帮助。

### 更新内容

- **工作台（`pages/index`）**：只保留问候、今日课程（进行中 / 已结束 / 下次课）、作业待交与通知待处理两张待办卡、4 个常用工具快捷 +「全部」入口；移除数据概览、云同步、数据与隐私、清空记录与完整工具长列表。tab 页不再叠加页内大标题（原生导航栏已是唯一标题，消除「班级工具」双标题）。
- **今日课程**：新增 `utils/ttplan.js`，从课表快照计算今天的课程、上课中 / 已结束状态，以及未来 14 天内的下一次课；本机没有课表缓存时自动拉取一次 `tt.json` 并缓存。
- **待办**：新增 `utils/notice.js`（通知截止/简报口径与通知页共用），首页显示待处理数量与最紧的一条；作业待交按截止时间排序并显示最近一条。
- **工具页（`pages/all`）**：改为「首页快捷 4 个 + 全部工具 2 列目录」；右上「调整」打开底部弹层，用 ↑ / ↓ 调整顺序（前 4 个带「首页」标记）。移除旧长条卡片、拖动排序与反馈建议 / 使用说明入口（迁到「我的」）。
- **我的页（`pages/me`）**：身份卡 +「我的数据」四项个人指标（待交作业 / 已完成作业 / 抽签记录 / 体测记录）+ 云同步 + 数据与隐私（3 行短说明 + 清空数据）+ 帮助（反馈建议 / 使用说明）+ 退出身份；移除旧的 6 项全站统计与重复长隐私文。
- **共享口径**：通知时间线抽到 `utils/notice.js`（`pages/nt` 改用），工具目录新增 `tools.quickList()` / `tools.catalog()`；旧版本地 `homeTools` 顺序继续兼容（不需要迁移）。
- **验证**：`node unit.js` 50/50；`staticcheck.py` 17 页、handlers missing 0；开发者工具浅色回归 28 项全过（工作台今日/待办/快捷、工具目录与排序弹层、我的四项指标、无 console error、三页无横向溢出），截图见 `mp-class-tools-tests/_shots/ia/`；暗色沿用 M3 token（新样式颜色均取 `var(--md-*)`，工具图标白字形放在彩色/容器圆底上）。

## 1.3.1 — 2026-11-04（暗色模式优化）

### 版本描述（短版，适合审核 / 更新说明）

补齐原生小程序在系统 DarkMode 下的显示：课表页、组件、原生控件、图标与占位符全部跟随深色主题，浅色模式观感保持不变。

### 更新内容

- **课表页（`pages/tt/*`）**：`tt.wxss` 引入 30+ 个页面级 `--tt-*` 变量（浅色值 = 原配色），`@media (prefers-color-scheme: dark)` 给出深色值；卡片、周/日导航、下一节卡、周表网格、日视图、全部课程、课程详情弹层全部暗色化。课程色板由 JS 内联 hex 改为 CSS 类 `.tt-c0~.tt-c15`（16 组，各含浅/暗两套色值），JS 只分配稳定索引，系统切主题时**无需重渲染**即自动换色；顺带修好详情弹层课程色点此前取不到颜色的问题。
- **TabBar 图标**：`theme.json` 新增 `tabWorkIcon/tabToolsIcon/tabMeIcon` 等变量，`app.json` 用 `@变量` 引用；新增 6 张暗色图标（未选中 `#C8C2B5`、选中 `#9BC9BB`，与暗色 tabBar 文字色一致）。同时补 `backgroundColorTop/Bottom`，避免下拉回弹区域露浅色。
- **全局样式（`app.wxss`）**：新增 `--md-on-error`（暗色错误按钮用深字）、`--md-press-overlay`（暗色按压态用浅色叠色）；暗色下工具图标圆形底改为深色容器（secondary/primary/tertiary-container）、骨架屏扫光降低亮度。
- **组件**：`touchable` 按压叠色默认改为 `auto`，touchstart 时按系统主题取色（暗色 `rgba(255,255,255,.10)`），主题切换后立即生效。
- **原生控件**：抽签 / 分组页的 `<slider>`、`<switch>` 颜色不再写死 `#5E8F87`，改由 `utils/util.js` 新增的 `util.nativeTheme()` 计算（暗色 primary `#9BC9BB`、slider 底槽 `#3E443B`），并监听 `wx.onThemeChange` 实时更新。
- **输入占位符**：统一给 input/textarea 加 `placeholder-class="ph"`，仅在暗色下用 `--md-on-surface-variant`（浅色保持系统默认，不改原观感）。
- **零散暗色修正**：统计柱状图底槽、工具页拖动投影、点名未处理 pill 在深色下补可见底色。
- **验证**：开发者工具暗色/浅色双主题逐页截图（22 页/态）比对；浅色模式改动前后像素对比除系统时钟/云端动态数据外无肉眼差异；49 项单元测试全过、静态审计 handlers missing 0；暗色下实时切换主题（不重编译）slider/switch/CSS 变量均即时生效。

## 1.3.0 — 2026-11-04（班级身份系统重构）

### 版本描述（短版，适合审核 / 更新说明）

1.3.0 将登录方式改为班级身份验证：输入真实姓名 + 学号，经云端班级名单校验后进入；移除旧账号密码注册/登录与二次认证；新增班委名单，访问统计改为按账号聚合、仅管理员可见。

### 更新内容

- **启动身份界面**：新增 `pages/identity/identity`（非 tabBar 首屏）。输入真实姓名 + 10 位学号 → CloudBase RPC `class_verify`；失败直接显示云端原因，不进入工作台。验证成功后保存班级 token / 身份，并请求 `class_members` 把 70 人名单同步到本机，再进入工作台。
- **统一鉴权**：所有 `wx.request` 统一从 `utils/cloud.js` 发出；数据请求自动带 `X-Class-Token`，无有效身份时不发任何数据请求。旧的账号密码注册/登录、`utils/login.js`、`utils/sha256.js`、`X-Device-Id` 鉴权、`pages/verify` 认证页、`admin` 账号名管理员判断全部下线。
- **页面守卫**：没有有效身份时，所有页面（工作台 / 工具 / 我的 / 课表 / 抽签 / 分组 / 结果单 / 作业 / 通知 / 体测 / 国标表 / 点名 / 反馈 / 使用说明 / 班委 / 统计）在 `onShow` 立即 `wx.reLaunch` 回身份页；身份只来自 `class_verify`。
- **我的页改为身份信息**：展示姓名、打码学号、角色 / 徽章 / 管理员文字气泡、身份状态；提供「立即同步」「退出身份」「清空数据」「反馈建议」「使用说明」与数据隐私说明，不再有密码 / 注册 / 昵称入口。
- **班委名单（新工具）**：`utils/tools.js` 注册「班委」，工作台 / 工具页可进入；列出 `class_members` 中 role 非空成员，姓名 + role / badge 文字 pill（不依赖头像），按官方职务顺序展示，普通成员也可查看。已按《关于公布示例班级班委会拟定结果的通知》导入 18 名班委（班长测试庚、团支书测试辛、副团支书管理员等）。
- **统计改为按账号**：`visits` 表新增 `sid` / `name`，每次身份后访问写 `{id: sid+"|"+slot, slot, sid, name, did, ts}`；统计页仅管理员（is_admin）可见，按学号 / 姓名聚合访问次数与最近时间，可按天 / 按小时查看；**只统计有学号的 visits 行，旧匿名访问（sid/name 为空）会被过滤，不再出现「未知账号」**。
- **名单来源替换**：抽签 / 点名「导入班级名单」改用 `class_members` 结果（本机 `classMembers` / `classRoster` 缓存），不再依赖 `public.roster` / `identity_verify`；移除旧的「更新云端名单」入口。
- **现有功能保持**：课表 UI / 只读 / 周切换 / 本节详情、抽签分组、作业通知、体测、点名、反馈、订阅消息均继续可用，只改鉴权与身份入口；课表 `tt.json` 请求也统一改走 `utils/cloud.js`（不携带班级 token）。
- **数据与隐私**：页面学号一律打码；只使用姓名 / 学号 / 角色，不采集证件信息；退出身份清空本机 token 与班级名单缓存。
- **发布前要求**：CloudBase 需保证 `class_verify` 对 publishable key 可执行、`class_members` 与班级数据表校验 `X-Class-Token`、`visits` 仅管理员可读；服务器域名与 v11 相同（`tool-d4gosudok46e0e081.api.tcloudbasegateway.com`、`tool.furina.fun`），无需新增。

## 1.2.0 — 2026-11-04（课表与网页版同步）

- **课表改为只读自动同步**：从 `https://tool.furina.fun/tt.json` 读取教务快照，缓存本机供离线查看；移除添加课程 / 删除 / 清空 / 开学日期编辑入口。
- **全员可见**：课表不再隐藏；工作台工具列表默认包含课表，旧默认顺序自动迁移。
- **周切换**：上一周 / 下一周按钮 + 周导航区域左右滑动；显示周次、日期范围和「本周」。
- **本节课程详情**：点周表格子或课程列表，只显示这一节的教师、日期 + 节次 + 起止时间、教室，并给出以本次为准的下一节上课时间。
- **手机可读性**：周表列宽收窄、周末无课时自动隐藏，窄列教室显示短标识（如 `01105`），完整教室保留在详情。
- **配色**：换用与网页版一致的莫奈色板；下一节课卡只在今天还有课时显示。
- **UI 对齐网页端**：课表改为单一暖白圆角卡片；周导航 ‹ 第N周 ›、周/日分段、渐变下一节卡、周表莫奈色块、日视图色条卡、全部课程默认收起、本节详情底部弹层；去掉页面内顶部 app bar，改用原生导航栏。
- **按开发者工具预览修正**：周表改为绝对定位课程块，跨节次连续显示（对齐网页 rowspan），5 天自动铺满宽度、6/7 天横向滑动；修复「今天」徽标与全局 `.badge` 样式冲突；默认周视图，日视图在今天无课时自动落到本周第一天有课的日期；课程块高度/文字溢出调优。
- **节次列重做**：宽度 96rpx、浅色圆角时间格、行高 96rpx 与网页端行高对齐；「第N节」+ 起止时间三行居中，课程块与节次格严格对齐。
- **配置**：`utils/cloud-config.js` 新增 `ttUrl`；发布前需在小程序后台把 `tool.furina.fun` 加入 request 合法域名。

## 1.1.1 — 2026-10-22（修复）

- **体测：长跑「秒」填了不算**：长跑下限从 120 秒放宽到 1 秒（0:00 仍视为无效，不拿满分）。女生 800 米 1'5x"、只填秒等输入不再被判成缺项（行里 — / 总分不变），保存记录也会把长跑计入总分。
- 长跑两个输入框补 `bindblur`，离开输入框时再同步一次，避免最后一次编辑没有写进数据。

## 1.1.0 — 2026-10-21

### 版本描述（短版，适合审核 / 更新说明）

1.1.0 新增作业截止与班级通知的订阅提醒，作业/通知支持图片和文件附件；优化名单编辑、工作台问候、点名与「我的」页面，并完善多端同步、深色模式和网络稳定性。

### 更新内容

- **订阅提醒**：作业可按「提前 1 天 / 提前 2 小时 / 自定义时间」订阅截止提醒；通知页可订阅下一条班级通知。到点由云函数发送微信订阅消息。
- **图片 / 文件附件**：作业和通知最多添加 2 个附件；图片原图不超过 5MB，自动压缩后上传；普通文件不超过 2MB；支持预览、打开和下载。
- **登录边界**：未登录也能查看作业/通知、勾选完成作业、置顶通知；发布作业/通知需要登录；班级名单仍需登录并完成姓名 + 学号认证。
- **名单**：抽签、分组、点名中的名单均支持自定义；班级名单仅作为可选按钮导入，不再自动覆盖自定义名单。
- **点名**：名单改为「编辑名单」按钮 + 底部弹层，长名单不再撑高页面，可在弹层内滚动编辑。
- **工作台**：问候语右侧显示账号并右对齐，长账号自动省略；移除卡片底部日期。
- **我的**：登录后只保留右上角账号小按钮，长账号居中省略；点击可同步、复制账号或退出登录。
- **体测**：输入框改为更清晰的卡片布局，长跑按「分 : 秒」填写；填入成绩实时算分，不再需要单独点计算；输入框保持空白无占位提示，并限制字母/非法字符。
- **作业**：截止日期支持可选具体时间，未设置时间按当天 00:00 计算；截止提醒按新截止时间计算；布置作业可一键使用「下一节该课程上课时间」；自定义提醒改为日期 + 时间选择器，并拦截过去时间、晚于截止等不合理设置；作业前图标改为书本图标。
- **抽签**：重置抽签时同步清空分组结果，避免旧分组残留。
- **输入校验**：抽签、分组、课表、学号等数字输入同步增加清洗，只接受合法数字/区间格式。
- **同步**：小程序工具排序按账号同步；网页端通知置顶与小程序共用个人状态，跨设备生效。
- **结果单**：抽签与分组结果改为编号+姓名卡片网格；参数配置默认收起，结果块之间增加间距，长列表不再挤成一团。
- **整体间距**：统一卡片底部间距、按钮操作条间距和标签换行间距，避免页面元素贴在一起。
- **体验与稳定性**：修复使用说明下滑抽动、名单编辑无法下滑、深浅色模式页面残留颜色、部分基础库不支持 PATCH 导致网络错误等问题；增强弱网重试。

## 2026-11-04 Monet 与通知
- M3 token/theme 改为莫奈色；通知页读取 CloudBase auto notices，简报/筛选/AI拆解/附件/原始消息；移除旧发布/置顶/手动逻辑。

## 2026-11-04 18:45 小程序 UI 修复
- 工具页「打开」按钮：移除固定 283rpx 卡片高度和 16px 内联间距，改为 flex 卡片、描述自适应、按钮固定在卡片底部，避免位置偏移。
- 首页工具图标：课表/班委补 `tool-tt.png` / `tool-bz.png`，全部工具统一白线图标；首页图标底色改为实色莫奈色（睡莲青/雾蓝/暖沙），白图标不再落在浅色容器上。
- 网页国标体测评分表：首列 sticky 加 `z-index:3`，表头 `z-index:4`，左上角 `z-index:5`；用不透明卡片底色 + 右侧分隔线，横向滑动时分数据不再覆盖项目名；表格改 `border-collapse:separate`。
- 验证：小程序 unit 49/49、staticcheck handlers missing 0、cli preview 编译成功（405.1KB）；网页生产环境打开国标表横向滚动，首列保持覆盖。

## 诊断 v2.1（AI 下挂异常项/折叠展开/10s/设备最小化）— 2026-11-09（待上传；代码版本仍 2.0.0）

> 用户 2026-11-09 要求：AI 诊断项放在对应异常项下面、简化显示、详情可展开；进展及时更新；设备信息只留可能致错信息。契约 `_diag_task/CONTRACT_V2_1.md`；网页已上线同口径。

- **AI 下挂**：删除独立「AI 分析」/「修复记录」大卡；`utils/diag.js::groupAnalyses` 按 `related.health_ids` 挂服务健康**异常行**、按 `related.checks` 挂设备检查行（agent 由 `client_diag.detail.check` 推导）；无关联/目标已恢复 →「其它诊断」默认收起只显示条数；修复记录在 AI 展开态按 `related.repair_id` 显示 action/状态/结果/时间。
- **折叠/展开**：折叠一行 ≈31px（severity 点 + 标题≤22 字 + ⚙可自动修复/建议 + 状态胶囊 待处理/修复中/已修复/修复失败 + ›）；点击整行展开 cause/建议/flow 时间线/关联修复；异常行无 AI：本机在线→「AI 分析排队中…」、离线→「本机离线，已留存待开机修复」；顶部摘要 `可自动修复 N · 已修复 M`。
- **10s 进展**：`DIAG_REFRESH_MS 15000→10000`；onShow 立即拉；running/fixed 胶囊与 flow 实时更新；保留健康 60s；页脚「服务健康 60 秒 · 诊断与修复 10 秒 · 更新 HH:MM:SS」。
- **设备信息最小化（§B）**：`utils/diag.js` 新增 `DEVICE_WHITELIST`/`DETAIL_WHITELIST`，`deviceSafe`/`buildReportRows` 只出 platform/osVersion/baseLib/screen{w,h,dpr}/memoryMB/storagePct/network/clockSkewMs，detail 必带 `check` + latency_ms/storage_pct/clock_skew_ms/err_count/code；`deviceChecks` 10 项改 `app/sdk/screen/memory/storage/network/gateway/clock/timetable/js`（无品牌/型号/语言）；`cloud.diagPing` 读取 Date 头算 clockSkew。
- **WXML 限制兜底（2026-11-09 实测）**：微信 WXML 对**嵌套数组的 `.length` 与 `wx:for`** 在部分基础库返回异常（页面数据有、DOM 不渲染）→ 展开体的建议/flow 由 JS 预渲染为 `suggestionsText\n· …` / `flowText`（`white-space:pre-line`），模板只传对象；`dg-flow-t--run` 高亮进行中。
- **测试**：`node unit.js` **259/0**、`node v3_power_diag_tests.js` **62/0**、`node sync_contract_test.js` **33/0**、`python staticcheck.py` exit 0、`code_quality_check.js` 全通过；automator `diag_v21_preview.js` Lead 实跑 devtools：**23 PASS / 0 FAIL / 0 console error**（下挂映射/正常行无 AI/其它诊断/折叠 31px/胶囊 running·fixed·⚙/展开 cause+建议+flow+关联修复/收起/10s 轮询 running→fixed/无横向溢出），截图 `mp-class-tools-tests/_shots_diag_v21/`。
- **上传后待真机复核**：真机基础库的嵌套数组表现可能与 devtools 不同；若真机渲染正常可简化为模板数组渲染。
