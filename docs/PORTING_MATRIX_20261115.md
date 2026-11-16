# 微信小程序移植性审计（2026-11-15）

> 目标：把网页端 / 安卓端近期新增能力中**能完整移植**的部分移植到微信小程序；**移植后会功能缺失的不要移植**。
> 范围：只改 `mp-class-tools/**` 与 `mp-class-tools-tests/**`；不发布、不改版本号（仍 2.0.0）、不改 UD v6 契约。
> 依据：安卓 v4.55.0 / v4.56.0（`android-class-tools/docs/REPORT_ROUND62_20261115.md`、`docs/CHANGELOG.md`）、
> 网页 `web/CHANGELOG.md`（截至 2026-11-15 增量 61）、小程序 `README.md` / `CHANGELOG.md` / 源码。
>
> 判定口径：
> - **可完整移植**：小程序现有数据能力（CloudBase RPC / PostgREST / 本机存储 / 原生页面）足以 1:1 复刻，无能力缺口；
> - **部分缺失**：能做出入口/界面，但核心能力依赖小程序不具备的机制（任意 WebView JS 注入、跨 App 跳转、系统级权限/状态栏、原生推送 SDK 等），
>   **不做**（宁可没有，也不做半残功能）；
> - **不移植**：安卓/网页独有且与小程序运行环境冲突，或用户已明确要求小程序不做（如教务入口）。

## 一、逐工具矩阵

| 工具（key） | 网页 | 安卓 | 小程序现状 | 判定 | 说明 / 依据 |
| --- | --- | --- | --- | --- | --- |
| 抽签 / 分组 / 结果单（draw） | 抽签 + 分组 + 结果单 + 云端存证 + 抽签记录 + 名称映射 + 核验二维码 | 抽签/分组（无云端存证） | 抽签三步 + 分组 + 结果单 + `pages/drawrec` 存证记录 + `utils/drawproof`（draw-v1 逐字节一致） | ✅ 已对齐 | 小程序已含网页 draw 升级 v1（2026-11-12） |
| 课表（tt） | 周/日视图 + 教务登录（个人课表） | 周/日视图 + 下一节 | 周/日视图 + 6/7 天同页缩放 + 教务登录（`ttLocal` 同步） | ✅ 已对齐 | 小程序额外做了 6/7 天同页缩放 |
| 名单（committee） | 班委 / 团员 / 全班 + 管理员设职务 | 名单三分类 | 三 tab + 计数徽标 + 管理员 `class_set_role` | ✅ 已对齐 | 2026-11-12 同步 |
| 作业（hw） | 列表 / 截止 / 完成勾选 / 发布 | 列表 / 完成状态 | 列表 + 倒计时 + 完成勾选 + 发布/附件 | ✅ 已对齐 | 同一 `marks` 真源 |
| 通知（nt） | 模板整页（长期安排期次 + 5 卡 + 资料栏 + 时间归一） | 同口径 + **自动加载全部** | 同口径（长期/期次/5 卡/资料栏/时间归一）+ 一次整表拉取 | ✅ 已对齐（自动加载无需移植） | 小程序数据层无分页：`utils/cloud.js ntFullFetch` 一次 `select=*` 拉全表 + 2KB 签名增量刷新，页面没有“加载更多/剩余 N 条”，首屏即全部；见 §二-1 |
| 体测（ft） | 七项算分 + 等级 + 历史 | 录入/评分/历史 | 七项算分 + 国标评分表页 + 两条历史 | ✅ 已对齐 | — |
| 点名（roll） | 到 / 假 / 沉底 / 名单选择 | 到 / 假 / 一键点名 | 到 / 假 / 沉底 / 抽签名单沿用 / 重置本轮 | ✅ 已对齐 | — |
| 统计（stats） | 按姓名聚合，仅管理员 | **未提供** | 按姓名聚合，仅管理员 | ✅ 小程序已具备 | 安卓 v4.55 审计确认「统计」「大屏互联」仍为网页/小程序专用 |
| 诊断（diag） | 服务健康 18 行 + 设备诊断 10 项 + AI 分析/修复流程 | 服务/设备/AI 修复 | 同口径（v2.1：AI 结论下挂异常项、10s 轮询） | ✅ 已对齐 | — |
| 电费（power） | 剩余电量 + 24h/7d/30d + 充值折算 + 异常扣减 + 自然周期同期 + 13/16 日更口径 | v4.55 对齐网页 | 充值折算曲线/竖线/「期间有充值（已折算）」+ 异常扣减 + 自然周期同期 + 14d/70d 补拉 + 13/16 隐藏 24h + 日更口径 | ⚠️ 部分细节待对齐 → **本轮实施** | 小程序把「较X同期 ±x%」拼进区间用电 tile 的单行副标（有被 nowrap 截断风险），网页/安卓为**独立一行**完整显示；充值度数图例文案小程序未显示。本轮改独立行 + 图例「充值 +x 度（已折算）」，其余口径已同源 |
| 水量（water） | 4/6 人间 + 每月抄表 + 用量/水费 | 月份记录 + 云端同步 | 4/6 人间 + 月份记录 + 云端同步（水量 section） | ✅ 已对齐 | — |
| 投票（vote） | 限时/长时 + 多选/匿名 + 可见范围 + 管理 | 同口径 | 同口径（含可见范围「指定成员」座号多选） | ✅ 已对齐 | 2026-11-11 增量 35 已同步 |
| 演示（ppt） | 上传 → 兼容版/PDF/原始 + 单独视频/音频下载 + 在线预览 | v3.6 同口径 | `pages/ppt` 列表/上传 + `pages/pptdl` 下载中心（含 media_files）+ `pages/pptplay` | ✅ 已对齐（发布受域名白名单限制） | 小程序已含 §12.8 视频/音频单独下载；真机需微信后台把 OSS 域名加入 request+downloadFile |
| 文件传输（file / 云空间） | 临时云空间（drop v2.2+） | v4.55 新增 | `pages/cloudspace`（mine/upload/下载/删除/清空/72h） | ✅ 已对齐（发布受域名配置限制） | 同 ECS drop 服务 |
| 大屏互联（screencast） | 大屏端 + 手机控制器 | **未提供** | `pages/screencast`（presence 在线才显示；传文件/文字/遥控 11 项） | ✅ 小程序已具备 | 依赖 drop 服务与 HTTPS 域名 |
| 地图（map） | iframe 2.5D + 与课表联动 | WebView 嵌网页 + 定位桥（v4.55/56 修白屏、贴边） | 原生 Canvas 2.5D（旋转/缩放/楼层/路线/定位/与课表联动） | ✅ 已对齐（无需移植） | 安卓 v4.55/56 的地图修复是 **WebView 专属**（canvas 白屏、显式 viewport、Android 定位 JS 桥），小程序原生绘制无此问题 |
| 使用说明（ug） | 19 张卡 | 25 张卡 | 19 张卡（按小程序工具集适配，含文件传输/大屏互联卡） | ✅ 已对齐（各端按工具集适配） | 卡片数不是跨端硬契约，内容按各自可用工具集 |
| 反馈（fb） | 有 | 有 | 有 | ✅ 已对齐 | — |
| 教务（jw） | 点卡片直跳官方 + 浏览器密码管理器 | WebView 自动登录 + 卡片速览 + WebVPN 自动填充 | **无入口**（2026-11-13 用户明确要求撤销小程序端入口） | ❌ 不移植 | 小程序无任意 WebView JS 注入/自动填充能力；且用户已要求撤销入口 |
| 学信网（chsi） | 官方工具入口卡片页（不抓数据） | 数据卡 + 10 官方入口 + 手动登录 + WebView 提取 | 无 | ❌ 不移植 | 数据卡依赖 WebView 内 JS 注入/页面内容提取；小程序 `<web-view>` 只能打开配置过的业务域名且不能注入脚本，做出来只能给入口、拿不到数据 = 半残 |
| 活动（activity） | 无 | 第二课堂：学校账号 WebView 登录 + 原生 token + 报名 | 无 | ❌ 不移植 | 依赖学校 H5 微信环境下的原生 token / WebView 注入与会话种子；小程序无法在第三方页面注入 JS |
| 今日校园（today） | 无 | 12 入口 + 融合门户 CAS 自动登录 | 无 | ❌ 不移植 | 同上：CAS 自动登录依赖 WebView 表单注入，小程序无此能力 |
| 快递（express） | 无 | 拼多多/淘宝身份码、菜鸟/京东一键打开官方 App | 无 | ❌ 不移植 | 小程序 **不能直接调起其他 App**（`wx.navigateToMiniProgram` 只对小程序；外链只能在 web-view/复制链接），做出来只能“复制链接”，功能缺失 |
| OPPO 推送 | — | OPPO PUSH SDK（App 未运行也能收系统通知栏） | 微信订阅消息（`cloudfunctions/notify` + `wx.requestSubscribeMessage`） | ❌ 不移植 | 小程序只能用微信订阅消息，不能接第三方推送 SDK；现有提醒链路已覆盖 |

## 二、跨端行为 / UI 专项矩阵

| 专项 | 网页 | 安卓 | 小程序 | 判定 / 本轮处置 |
| --- | --- | --- | --- | --- |
| **1. 通知自动全部加载** | 通知模板整页渲染（服务端已合成全部通知，无分页） | 原分页「加载更多」→ v4.55 自动连续加载剩余页 + 剩余条数 + 失败重试一次 | 无分页：`ntAutoPull` 一次 `select=*` 拉全表（~2MB，分块缓存）→ 页面 `applyFilter` 全量分组；只有 2KB 签名增量刷新，无“加载更多”按钮 | ✅ **已天然满足，无需改动** | 首屏即全部；无剩余条数概念。本轮不引入伪分页（引入反而多 2MB 重复请求） |
| **2. 电费「充值后趋势可读」** | 折算剩余曲线 + 充值竖虚线 + 「期间有充值」+ y 轴折算范围 + 图例充值度数 | v4.55 对齐网页 | 折算曲线 + 充值竖虚线 + 「期间有充值（已折算）」徽标 + y 轴按折算范围 + 异常扣减剔除（2026-11-12 / 增量 43） | ⚠️ 缺「图例充值度数」→ **本轮实施** | `Utils/power.trendLine` 已算 `rechargeTotal`，页面未展示；本轮在趋势图例补「充值 +x 度（已折算）」 |
| **3. 电费同期比较位置/口径** | 自然周期同期（较昨日/上周/上月），tile 内**独立一行**，14d/70d 补拉，35% 覆盖守卫 | v4.55 同口径、tile 内独立行 | 口径/补拉/守卫均已实现（增量 43），但文案拼在 tile 单行副标 | ⚠️ 位置不对 → **本轮实施** | `tilesOf` 增加独立 `cmp` 字段，WXML 在区间用电 tile 内新增独立行（`white-space:normal` 完整显示）；随 pct 正负着色（≥0 暖沙 / <0 灰蓝，与网页 `.opt-up/.opt-down` 同义） |
| **4. 外观：跟随系统 / 浅色 / 深色** | 无此设置（网页固定浅色） | v4.55「我的 → 外观」三选一（本机 DataStore、实时生效、冷启动保持） | 只有 `darkmode:true` + `theme.json` + `prefers-color-scheme` 自动跟随系统；无手动覆盖 | ⚠️ 可完整移植 → **本轮实施** | 官方推荐方案：`page-meta page-style` 在页面根节点覆写 CSS 变量（小程序无 :root/JS 改 CSS 变量能力），配合 `wx.setNavigationBarColor` / `wx.setBackgroundColor` / `wx.setTabBarStyle` 同步原生外壳；偏好只存本机（`zq_appearance_v1`，不进 UD v6，与安卓 DataStore 同语义） |
| **5. 隐藏状态栏（沉浸式）** | — | v4.55 全局隐藏状态栏（下滑临时显示，「外观」可关） | 不可行：小程序**无法隐藏系统状态栏**（`navigationStyle:custom` 只能隐藏导航栏） | ❌ 不做 | 仅隐藏小程序导航栏会带来刘海/安全区与返回手势问题，收益低、风险高 |
| **6. 2 行工具描述 / 卡片高度** | — | v4.55 副标最多 2 行（12sp/16sp）、卡高 96dp、拖动几何同步 | `pages/all` 工具卡描述 `white-space:nowrap; text-overflow:ellipsis` **单行截断** | ⚠️ 可完整移植 → **本轮实施** | `.tool-meta` 改 2 行 clamp + 卡片 `min-height` 相应增大（颜色/圆角/拖动命中/长按逻辑不变，拖动几何由实测 rect 驱动） |
| **7. 深色模式「绿色 hero」观感** | — | v4.55 工作台/我的/使用说明大面积绿色渐变 hero → 深色下中性 tonal 深色 | 小程序没有品牌绿渐变 hero，但有 4 处 `--md-primary-container` 大色块：投票详情 hero / 抽签记录 hero / 体测 hero 卡 / 使用说明 mint hero 卡 | ⚠️ 可完整移植 → **本轮实施** | 新增 `.theme-dark` 局部覆盖：上述 hero 深色改 `--md-surface-container-high` 中性底 + `--md-on-surface` 文字，品牌绿只留小面积（pill/图标） |
| **8. 浅色底栏黑影** | 无底栏 | v4.55 修复悬浮玻璃 dock 阴影溢出 | 原生 tabBar（无自定义阴影；`theme.json` 只有 `borderStyle` 细线） | ✅ 不适用 | 小程序原生 tabBar 不存在该问题 |
| **9. 工具拖动排序** | 全部页卡片拖动 v2.1（本体基准） | v4.55 修 7 项拖动问题 | 全部页长按 350ms 拖动 + 跟手幽灵 + 2 列网格迟滞重排 + `page-meta` 锁滚动 + 边缘自动滚动 + 拖后抑制 tap | ✅ 已对齐 | 安卓 7 项修复是 Compose 侧 bug；小程序实现已于 2026-11-06 按同一交互规格落地并有 21 项单测 |
| **10. 主题/外观与原生控件** | — | 外观三选一 + 壁纸取色 | 原生 switch/slider 颜色由 `util.nativeTheme()` 按系统主题给出 | ⚠️ 一并修正 → **本轮实施** | `util.theme()` 改为读外观偏好（显式浅/深时按偏好，系统模式仍跟随系统），保证原生控件与页面 token 一致 |
| **11. OPPO 推送 / 通知栏** | — | v4.50+ OPPO PUSH SDK | 微信订阅消息（现有提醒链路） | ❌ 不移植 | 第三方推送 SDK 小程序不支持 |
| **12. 云空间 / 大屏互联服务端** | drop v2.3（presence/分片/签名下载） | v4.55 接入云空间 | 已接入 drop v2.2/2.3（`utils/cloudspace.js`、`utils/screencast.js`） | ✅ 已对齐 | 域名恢复后随发布生效 |
| **13. 身份门禁 / 同步契约 / 导出图** | 学号+姓名 token、UD v6 | 同口径 | 同口径（UD v6；导出卡 v2 三端共用规格） | ✅ 已对齐 | 本审计不改契约 |

## 三、本轮实施清单（可完整移植项）

1. **电费对齐网页/安卓**
   - `utils/power.js::tilesOf`：区间用电 tile 增加独立比较字段 `cmp`（`较昨日/上周/上月同期 ±x%`）；`sub` 只保留「该区间无更新」等原有语义（与网页 `.pw-cmp` 独立行一致）。
   - `pages/power/power.wxml/.wxss`：tile 内新增独立行（可换行、不截断），≥0 用 `--md-tertiary`、<0 用 `--md-secondary`（对齐网页 `.opt-up/.opt-down`）。
   - 趋势图例补「充值 +x 度（已折算）」（`trend.rechargeTotalText` 已有数据，本轮展示）。
   - 14d/70d 补拉、35% 覆盖守卫、折算曲线/竖线/徽标、异常扣减剔除：**已实现，复核不改**。
2. **外观 跟随系统 / 浅色 / 深色（本机偏好）**
   - 新增 `utils/appearance.js`：模式读写（`zq_appearance_v1`）、`resolved()`、`pageStyle()`（整组 `--md-*` token 内联值，浅/深各一套，与 `app.wxss` 对齐）、`applyChrome()`（导航栏/窗口底色/原生 tabBar/下拉背景）、`notifyPages()`。
   - `app.js`：启动时装饰全局 `Page`（给所有页面注入 `themeStyle` / `themeClass` 并在 `onShow` 同步），注册 `wx.onThemeChange`（仅「跟随系统」时刷新外壳与页面）。
   - 所有页面 WXML 根节点加 `<page-meta page-style="{{themeStyle}}">`（`pages/all` 与既有 `dragPageStyle` 合并），使浅/深覆盖对整页生效。
   - `pages/nt`、`pages/tt`、`pages/ft`、`pages/roll`、`pages/stats` 的页面级暗色变量由 `@media` 改为 `.theme-dark` 类（跟随 `resolved()`，避免“显式浅色 + 系统深色”时页面局部仍是暗色）。
   - 「我的」页新增「外观」卡：跟随系统 / 浅色 / 深色 三选一，选中即全局生效并落本机（不同步账号，与安卓一致）。
   - `utils/util.js::theme()` 改为外观感知，原生控件配色一致。
3. **2 行工具描述 / 卡片高度**：`pages/all/all.wxss` `.tool-meta` 2 行 clamp + `.tool-cell__in` 高度适配。
4. **深色 hero 中性色**：投票详情 / 抽签记录 / 体测 hero 卡 / 使用说明 mint hero 在深色下改中性 tonal 底（品牌绿只留小面积）。

**未移植（如实）**：活动、学信网、今日校园、教务（含 WebVPN 自动登录）、快递、OPPO 推送、隐藏状态栏、通知分页式自动加载（小程序无分页，天然全量）。
**理由汇总**：前三者 + 教务依赖「任意 WebView 的 JS 注入 / 学校原生 token / CAS 自动登录」；快递依赖调起第三方 App；OPPO 推送依赖原生 SDK；隐藏状态栏依赖系统级窗口控制；通知自动加载是安卓分页 bug 特有的修复，小程序无对应场景。

## 四、验证计划

- 单测：`node unit.js`（含 v3_power_diag_tests.js 电费断言 + 新增外观专项 `appearance_unit_tests.js`）、`node sync_contract_test.js`、`python staticcheck.py`、`node code_quality_check.js`；
- 静态契约：全页面 `page-meta` 覆盖、外观 token 与 `app.wxss` 逐项一致、显式模式的页面级暗色变量走 `.theme-dark`、电费比较/图例接线；
- 回归：`node tool_sort_unit.js`、`node drawproof_unit_tests.js`、通知/投票/PPT 等专项（与基线对比，不新增失败）；
- **不发布、不改 VERSION 2.0.0、不改 UD v6**；不跑 automator/真机（本机无自动化端口，页面视觉以静态契约 + 单测覆盖）。

## 五、实施结果与测试证据（2026-11-15，本轮已完成）

### 5.1 改动文件（小程序源码）

| 项 | 文件 | 说明 |
| --- | --- | --- |
| 电费同期比较独立行 | `utils/power.js`、`pages/power/power.wxml`、`pages/power/power.wxss` | `tilesOf` 新增 `cmp`/`cmpUp`（副标 `sub` 保持原语义）；tile 内新增不截断的独立比较行，≥0 暖沙 `<0` 灰蓝；趋势图例新增「充值 +x 度（已折算）」 |
| 外观三选一（核心） | **新增** `utils/appearance.js`、`app.js` | 模式读写/归一（`zq_appearance_v1`）、`resolved()`、`pageStyle()`（整组 30 个 `--md-*` token）、`themeClass()`、`applyChrome()`（导航栏/窗口底色/下拉背景/tabBar，均 try 降级）、`notifyPages()`、`decoratePages()`（App() 前包装全局 Page，注入首帧 `themeStyle/themeClass` 并包装 onShow；失败静默=跟随系统） |
| 外观页面接线 | 全部 29 页 `.wxml` + 根节点 class；`pages/me/me.wxml/.js/.wxss` | 每页 `<page-meta page-style="{{themeStyle}}">`（`pages/all` 与 `dragPageStyle` 合并）；根节点 `{{themeClass}}`；「我的 → 外观」卡三选一（跟随系统/浅色/深色，本机偏好、即时生效） |
| 显式模式下页面级暗色 | `app.wxss` + `pages/{nt,tt,ft,roll,stats,all,index,power}/*.wxss` | 原 `@media` 暗色块改 `.theme-dark` 类驱动（含通知/课表/体测/点名/统计页面自有 token、工具图标、骨架/placeholder）；`app.wxss` 仅保留系统 token 的 `@media`（跟随系统首帧） |
| 深色 hero 中性化 | `pages/{votedetail,drawrec,ft}/*.wxss`、`app.wxss`（ug mint） | 投票详情/抽签记录/体测 hero/使用说明 mint hero 深色改 `--md-surface-container-high` 中性 tonal 底，品牌绿只留小面积 |
| 2 行工具描述 | `pages/all/all.wxss` | `.tool-meta` 2 行 clamp（去掉单行 nowrap 截断）、`.tool-cell__in` min-height 132→148rpx；拖动仍按实测 rect |
| 原生控件配色 | `utils/util.js`、`components/touchable/index.js` | `theme()` 改读实际生效主题（`appearance.resolved()`），`nativeTheme()`/ripple 按压色一致 |

### 5.2 测试（本机实跑）

- **新增** `mp-class-tools-tests/appearance_unit_tests.js`：**14 passed / 0 failed**（A 模式读写/归一/持久化、B pageStyle、C `app.wxss` token 逐项对拍、D 原生外壳参数、E themeClass 交叉、F Page 包装/系统主题变化、G notifyPages、H util.nativeTheme、I 29 页静态接线、J 暗色块类驱动 + hero、K 外观卡接线、L 工具描述 2 行、M 电费比较/充值图例、N `app.js` 真实接线：require app.js → Page 被包装 → me 页首帧 themeStyle=深色 + onShow 同步导航栏）；
- `node unit.js`：**554 passed / 6 failed**（基线 540 passed / 6 failed；本任务 +14 且**未新增失败**；6 项失败为基线既有：draw 的 ko-link.cn 期望 4 项 + quickList 顺序 1 项 + 期次时间依赖 1 项，与本次改动无关）；
- `node sync_contract_test.js` **34/0**、`node v3_power_diag_tests.js` **65/0**（电费比较 8 处断言已改为 `cmp` 独立行）、`node ug_cards_check.js` **59/0**、`python staticcheck.py` **exit 0（29 页、handlers/分享 0 缺失）**、`node code_quality_check.js` **全部规则通过（exit 0）**；
- `node tool_sort_unit.js` **18/3**（与改动前基线完全一致，3 项失败为工具目录新增 ppt/file/map 后的既有期望过期，与本次无关）。

### 5.3 未做 / 已知取舍（如实）

- 外观首帧：显式浅/深色下导航栏由 `wx.setNavigationBarColor` 在页面 onShow 覆盖，冷启动首帧可能短暂显示系统 theme.json 导航色（页面内容首帧已正确，无白/黑闪）；这是微信原生能力边界。
- `Page` 全局包装属于运行时注入：小程序各页面 JS 都走全局 `Page()`，包装失败（运行时差异/严格模式）会自动降级为"跟随系统"，**不会导致页面不可用**；单测 N 已覆盖真实 `app.js` 接线。
- 安卓的"隐藏状态栏/顶部呼吸区"、通知分页自动加载、WebView 系工具（活动/学信网/今日校园/教务 WebVPN）与第三方推送（OPPO）均**不移植**，理由见 §一/§二。
- 未跑 automator/真机（本机无自动化端口）；页面视觉以静态契约 + 单测断言覆盖，真机观感需用户上传体验版后确认。
- **未发布、VERSION 仍 2.0.0、UD v6 契约未改**；外观偏好只存本机（不进账号同步）、不改云端/DB。

