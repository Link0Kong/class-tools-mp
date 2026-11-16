# 独立验收报告 · 微信小程序「代码质量」两项修复

- 验收人：verifier（独立验收，未修改任何业务代码）
- 验收时间：2026-11-05 21:44 – 21:58（Asia/Shanghai）
- 被验收项目：`C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools`（微信小程序，version 2.0.0，**未上传/未发布**）
- 验收脚本目录：`C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools-tests\`（本报告与脚本在 `_verify/`，未改 `mp-class-tools` 任何文件）
- 环境：Windows；Python 3.12.8 + Pillow 11.3.0 + numpy 2.5.3；Node v24.21.0；ffmpeg 9.0.2；微信开发者工具 Stable **v2.02.2608080**（CLI HTTP 端口 9433，IDE 运行中，主窗口标题 `mp-class-tools`，已登录）

---

## 0. 结论摘要

| # | 验收项 | 结论 | 关键数字 |
|---|---|---|---|
| 1 | 离线复刻检查器（3 条规则） | **PASS** | exit 0；媒体 106.42 KB / 未使用组件 0 / 无依赖文件放行 |
| 1b | 「修复前」FAIL 复现（临时副本） | **PASS（复现成功）** | 媒体 **243,708 B = 238.00 KB FAIL**；未使用组件 **19 FAIL**；exit 1 |
| 2 | 独立复算媒体总量 + 图片完整性 | **PASS** | 35 张 PNG **108,978 B = 106.42 KB**（<200KB，≤150KB 目标也达标）；无音频 |
| 2b | 图片引用/尺寸/PNG 结构/画质 | **PASS** | 30 条引用无断链；35 张尺寸全部未变（share 仍 500×400）；chunk CRC 全合法、PIL+ffmpeg 全解码；share PSNR 58–68 dB |
| 3 | ai_toggle 完整周期（真实 + 副本） | **PASS** | on/off 往返**字节级无损**；幂等；损坏 JSON 不写盘；真实项目零改动；test_ai_toggle 78/78 |
| 4 | 既有测试回归 | **PASS** | unit **147/147**；staticcheck exit 0；sync_contract **29/29**；AI-on 副本 ai_contract_test `--final` **99/99 pass, 0 fail, 0 pending** |
| 5 | DevTools 真实编译 + ignore 因果实验 | **PASS** | 真实项目 auto-preview exit 0，**TOTAL 532,652 B**；experiment：**907,329 → 549,039 B（-358,290 B）**，与逆向笔记逐字节吻合 |
| 6 | 真实「代码质量→重新扫描」 | **无法脚本触发 → 已给出人工步骤** | CLI 无该命令（`cli.bat -h` 已核实）；面板扫描走 webview→backend IPC |
| 7 | 过程文件清理清单 | 已列出（见 §8） | 工作区内无本次新增过程文件；`_backup_ai_toggle` 有 2 个可删的重复备份 |

**总体判定：两项修复在「离线复刻 + 真实编译 + 逆向源码」三层证据下均可认定有效；唯一未完成的闭环是官方「代码质量」面板的人工重新扫描（无法安全自动化），已在 §7 给出人工步骤与预期结果。**

⚠️ **但任务书对第 2 项（19 个未使用组件）的根因描述与事实不符**，详见 §1。修复本身正确，但汇报口径需要修正，否则会误导后续发版判断。

---

## 1. 前置修正：19 个未使用组件的真实根因与时间线（重要挑错）

任务书（及 task-1 原始描述）称：「根因是 AI 开发模式关闭（app.json 无 agent/subPackages）但 ai/、agent/ 源码保留」。**这与事实不符。** 独立取证：

| 证据 | 内容 |
|---|---|
| `_backup_v2_20261105\app.json` | 3,288 B，mtime **13:31:06**：含 `subPackages:[{root:"ai",independent:true,pages:[]}]` + `agent.skills`（8 项）→ **AI 开启版** |
| `_backup_ai_toggle\app.json.bak-20261105-192803` | 3,288 B = AI 开启版；即 **19:28 执行 `--off` 之前项目是 AI 开启状态** |
| 当前 `app.json` | 1,640 B，mtime **19:28:03**（`--off` 写入），无 `subPackages`/`agent` |
| `_v2_compile_info.json` | 19:23 编译：main 688,982 B + **`/ai/` 355,294 B** → 19:23 时 AI 分包确实在编译包内 |
| DevTools `app.asar` 分析器源码（本次独立提取核对） | `Agent` 模块 `build()` 会把所辖目录下 `"component": true` 的 JSON 逐个 `addDep` 成 `Component` 依赖（19 个 ai 组件因此进入依赖图） |
| DevTools `checkUnusedComponents` 源码 | 只遍历 `Page/Component/MainPackage/SubPackage` 四类模块 → **父节点是 `Agent` 的组件永远进不了「已使用」集合** → 19 个全报未使用 |

结论时间线：**18:54 官方扫描时 AI 是开启的** → 19 个 ai 组件经 `agent.skills` 进入依赖图，又因 `Agent` 不在未使用检查的遍历类型里而被判「无使用」。

因此两项修复的真实分工是：

1. **19 个未使用组件的直接修复 = 19:28 的 `ai_toggle.py --off`**（移除 app.json 的 `subPackages`+`agent` → ai/ 不再从 app.json 可达 → 不在依赖图 → 官方扫描不再报）；**不是本轮新加的 `packOptions.ignore`**。
2. **本轮新增的两个改动**：
   - 图片压缩 → 修复 `IMAGE_AND_AUDIO_LIMIT`（本轮核心，证据充分）；
   - `packOptions.ignore=[ai,agent]` → 对**上传（prod）包**是**必需**的保险（`ignoreUploadUnusedFiles` 未设置 → 上传编译默认**不做**无依赖过滤，只有 ignore 能挡住 ai/、agent/ 进上传包）；对 dev/质量扫描是冗余保险（dev 本来就会过滤未引用代码）。

> 复刻检查器 `code_quality_check.js` 的未使用组件规则按任务要求采用「项目源文件全量扫描」的**更严格模式**，所以它在「AI off + ignore 空」副本上也能复现 19 个（见 §2.1）；这**不能**当作「官方扫描一定会报 19」的证据。官方实际口径见上表源码证据。

---

## 2. 逐项验收

### 2.1 清单 1：离线复刻检查器（3 条规则）

命令：`cd mp-class-tools-tests; node code_quality_check.js --project ../mp-class-tools --json`

真实项目（修复后）结果：**exit 0，全部规则通过**（证据：`_verify/cqc_real_20261105-214519.json`、`_verify/cqc_real_human.log`）

| 规则 | success | 实测 |
|---|---|---|
| `IMAGE_AND_AUDIO_LIMIT` | **true** | totalBytes=**108,978**，totalKB=**106.42**，fileCount=35（limit 200 KB，严格小于） |
| `CONTAINS_UNUSED_COMPONENTS` | **true** | count=**0**；totalComponents=7，usedComponents=7，unresolved=[] |
| `CONTAINS_UNUSED_CODES` | **true** | settingPass=true（`ignoreDevUnusedFiles=true`，`ignoreUploadUnusedFiles=null` → 官方放行语义直接 PASS）；packageCodeFileCount=126 / used=126 / unusedInPackage=0；静态全量无依赖文件 10 个（均为设计如此：app.miniapp.json、cloudfunctions/*（6 个）、i18n/base.json、project.miniapp.json、project.private.config.json），无新增异常 |

「修复前」FAIL 复现（临时副本，`ignore=[]` + 还原优化前图片；证据 `_verify/cqc_oldmedia_nofix.json`）：

```
EXIT=1
IMAGE_AND_AUDIO_LIMIT: success=False  totalBytes=243708  totalKB=238
CONTAINS_UNUSED_COMPONENTS: success=False  count=19
CONTAINS_UNUSED_CODES: success=True
```

- 媒体 **238.00 KB > 200 KB FAIL** —— 与 18:54 官方扫描一致；
- 未使用组件 **19 个** —— 全部为 `ai/skills/*/components/*/index.json`，category=`unreferenced`。独立核对：`ai/skills/*/components/*/index.json` 恰好 **19 个且全部 `"component": true`**，且被 AI 开启版备份的 8 条 `agent.skills[].path` **全覆盖**。

其他规则（复刻脚本未实现，按官方 asar 源码判定条件独立核对；证据 `_verify/other-rules.log`，脚本 `_verify/verify_other_rules.py`）：

| 官方规则 | 官方判定条件（asar 源码） | 当前项目 |
|---|---|---|
| `JS_COMPRESS_OPEN` | `!!setting.minified` | true ✓ |
| `WXML_COMPRESS_OPEN` | `!!setting.minifyWXML` | true ✓ |
| `WXSS_COMPRESS_OPEN` | `!!setting.minifyWXSS` | true ✓ |
| `LAZYCODE_LOADING_OPEN` | `!!app.json.lazyCodeLoading` | `"requiredComponents"` ✓ |
| `PACKAGE_SIZE_LIMIT` | 每个包 ≤ limit(1.5)×1024 KB=1536 KB | 实测编译包 532,652 B=**520.2 KB** ✓ |
| `PLUGIN_OVER_SIZE` / `CONTAINS_OTHER_PKG_JS` / `CONTAINS_OTHER_PKG_COMPONENTS` / `CONTAINS_UNUSED_PLUGINS` | 插件相关 | 项目未声明插件（app.json 无 plugins，`localPlugins=false`）→ 不适用/直接 PASS ✓ |
| `CONTAINS_APPSECRET` | compiledPkg 的 .js/.json 中 `/\W([0-9a-fA-F]{32})\W/` 候选再由服务端校验 | 项目内 85 个 js/json（ai/agent 除外，近似包内范围）**0 个 32 位 hex 候选** ✓ |

> 口径提醒：复刻脚本输出的 `package.totalBytes=788,159`（769.69 KB）是**未经压缩的源文件原始字节近似值**，**不是** DevTools 真实编译包体积（真实为 532,652 B）。原因：脚本按源文件原始字节统计、且把 `project.config.json` 也计入（实测往 project.config.json 加 1000 B，脚本 total 增 953 B）。这不影响上面 3 条规则判定，但**不要把 769.69 KB 当包体对外汇报**。

### 2.2 清单 2：独立复算媒体总量 + 图片完整性

脚本：`_verify/verify_media.py`（直接按扩展名遍历，不信任 PNG 优化脚本），证据 `_verify/media-verify.log`。

**媒体总量（独立复算）**：35 个文件全部为图片、**0 音频**，合计 **108,978 B = 106.42 KB**
- `< 200 KB（204,800 B）`：**PASS**；`≤ 150 KB 目标`：**PASS**
- 与 `code_quality_check.js` 交叉核对：**总字节一致、35 个文件逐文件字节完全一致**
- 按 `packOptions.ignore` 排除规则：ai/、agent/ 下无任何媒体文件，两种口径结果相同（35 个）

**优化前基线**：`_backup_v21_pre_ai_20261105\images`（2026-11-05 08:06 快照）独立复算 = **35 个文件 / 243,708 B**，与文档声称值**完全一致**；逐文件对比：
- 文件名集合一致（无增无减）；**像素尺寸 35/35 全部未变**（share 8 张均 **500×400**）；
- 34 张字节变小（share 8 张 21,217–24,917 → 9,286–10,783 B；logo 10,630→2,221 B；app-icon-1024 30,789→13,737 B），1 张不变（tab-me.png 481 B）；明细见 media-verify.log。

**PNG 结构 / 解码**：
- 35 张 PNG 全部通过 chunk 级校验（签名、chunk 顺序、**CRC32 全部正确**、IHDR/PLTE/tRNS/IEND 合法、无尾随字节）；
- 23 张为 PNG-8（bitDepth=8, colorType=3）、25 张带 tRNS；其余 12 张是既有合法变体（bitDepth=4/1 的索引图、tab-me.png 为 colorType=6 真彩）；
- **Pillow `verify()+load()` 35/35 通过；ffmpeg `-xerror -f null` 35/35 解码通过**。
- 画质量化对比（`_verify/verify_image_quality.py`，`_verify/image-quality.log`）：35 张 PSNR 最小 49.35 dB（logo）；**share 8 张 PSNR 58.07–67.76 dB、98.5%–99.2% 像素完全相同**；透明区未被填充（logo 仅抗锯齿 alpha 有 ≤25/255 的量化，视觉无感）。→ 属「近无损」，肉眼无差。

**引用完整性**：
- 全项目 30 条 `images/...` 引用中的目标**全部存在**；唯一「断链」是 `utils/share.js` 第 5–6 行**注释示例**里的 `images/share/xx.png`（非真实引用）；
- app.json 的 16 个 `@theme` 变量全部能在 theme.json 解析；theme.json 的 tabBar 图标路径全部存在；
- 8 张 share 图全部被页面/分享工具引用；
- **6 张未被引用的图片（死资源，仍合法计入媒体总量）**：`app-icon-1024.png`（13,737 B，12.6%）、`tab-draw.png`、`tab-draw-on.png`、`tab-sched.png`、`tab-sched-on.png`、`tool-all.png`。当前总量远低于阈值，不影响 PASS；如未来想再降总量可优先处理（app-icon 可移出 images/ 作素材，其余可直接删，但均不影响任何规则）。

### 2.3 清单 3：ai_toggle 完整周期

**真实项目 `--status`**（证据 `_verify/ai_toggle_status_real.log`）：

```
pages: 18
AI 分包: 未启用      agent: 未启用
packOptions.ignore: 2 条（ai: 已排除，agent: 已排除）
ai/ 目录: 存在（184 个文件）   agent/ 目录: 存在（2 个文件）
8 个 SKILL 路径全部 OK；备份目录 2 个备份
```

**真实项目配置差异**（`_verify/verify_config_diff.py`，`_verify/config-diff.log`）：
- `project.config.json` vs 备份（21:32:52）：**除 `packOptions.ignore` 外字段零变化**；ignore 精确为 `[{folder,ai},{folder,agent}]`；CRLF 风格保持（61→71 行）；字节 1701→1849；
  - 唯一非语义变化：写回时补了**末尾换行**（原文件无；ai_toggle 文档声明会补）→ 良性。
- `app.json`：无 `subPackages`、无 `agent`；与 AI 开启版备份相比**只少了 `subPackages` 与 `agent` 两块**（agent.skills 8 项），无其它 added/changed；CRLF、无 BOM、末尾换行正常。

**副本完整周期**（`_verify/verify_ai_toggle_cycle.py`，全程 `%TEMP%`，证据 `_verify/ai_toggle_cycle.log`）：
- 初始副本与真实项目字节一致；
- `--off` 幂等 → 输出「已是关闭状态，无需修改」、文件字节不变；
- `--on` → app.json 与 AI 开启版备份 **JSON 语义完全一致**（subPackages independent、agent 8 skills）、ignore 中 ai/agent 被移除、其它 include 未动、备份写入 `--backup-dir`；
- `--on` 幂等 → 文件字节不变；
- `--off` → **app.json / project.config.json 与初始字节完全一致（往返无损）**，ignore 精确恢复两条；
- 损坏 JSON 防御：app.json 非法 / project.config.json 非法 → 均非 0 退出且**两个文件都不写**（全有或全无）；
- `--on` 前置校验：ai/ 缺失 → 拒绝开启且不写文件；
- **真实项目全程哈希零改动**；`python test_ai_toggle.py` → **78 PASS / 0 FAIL**。

### 2.4 清单 4：既有测试套件回归（发版 off 状态）

| 测试 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `node unit.js` | **147 passed / 0 failed**，exit 0（INFO：遗留 interval 5 个、WARN：Timeout 1 个——测试脚本自身的定时器现象，非本次改动引入；unit.js 本轮未改） |
| 静态检查 | `python staticcheck.py` | **exit 0**（pages 18、handlers missing []、share handlers missing []、share images 8、web-view 0、getUserProfile 0、total 1526.9 KB、urlCheck False；`appsecret` 字样计数为信息项，非 32 位 hex） |
| 同步契约 | `node sync_contract_test.js` | **29 passed / 0 failed**，exit 0 |
| AI 契约（AI-on 副本） | `node ai_contract_test.js --final --json` | **99 pass / 0 fail / 0 pending / 0 warn，exit 0** |

证据：`_verify/unit.log`、`_verify/staticcheck.log`、`_verify/sync_contract.log`、`_verify/ai_contract_on.log`（AI 契约测试脚本不支持 `--project`，我按它的目录约定在 `%TEMP%` 搭了 `{mp-class-tools(AI on), mp-class-tools-tests(仅 2 个脚本)}` 布局运行，未碰真实项目）。

### 2.5 清单 5：开发者工具真实编译验证（关键）

**真实项目 auto-preview**（不上传、不发布）：

```
cli.bat auto-preview --project ...\mp-class-tools --info-output %TEMP%\...
√ auto-preview（exit 0，无编译错误）
{"size":{"total":532652,"packages":[{"name":"TOTAL","size":532652}]}}
```

- **编译成功，TOTAL = 532,652 B（520.2 KB）**，且 packages 中**没有 `/ai/` 分包**；
- 与历史 `_compile_info_off.json`（20:12:58，修复前 AI off + 旧图 + 无 ignore）的 **667,382 B** 对比：**-134,730 B**，而 `243,708 − 108,978 = 134,730` —— **体积下降量恰好等于图片压缩量**，说明：
  - 媒体压缩确实进入了真实编译包（媒体总量口径 = 编译包内媒体字节数，可信）；
  - `packOptions.ignore` 对 preview/dev 包**不产生额外体积差**（ai/agent 本来就被 dev 的无依赖文件过滤剔除）→ 与逆向笔记 p0=p1=p2=532,652 的实验一致。
  - 因此任务书「期望 ai+agent 共约 355KB 被排除」对 auto-preview 不成立（那只在关闭无依赖过滤/上传 prod 场景才体现）。

**`packOptions.ignore` 生效的因果实验**（真实 DevTools，`%TEMP%` 副本，复刻逆向笔记 p3/p4；证据 `_verify/devtools-ignore-experiment.log`）：
- p3 = 副本（ignore=[]，`ignoreDevUnusedFiles=false` 关掉无依赖过滤，模拟质量扫描编译语义）→ **TOTAL 907,329 B**
- p4 = p3 + `ignore=[{folder,ai},{folder,agent}]` → **TOTAL 549,039 B**
- **差值 = 358,290 B**，与逆向笔记记录值 **逐字节一致** → **DevTools 编译器确实识别该 ignore 条目并从编译产物中移除 ai/、agent/**。
- 另从 `app.asar` 独立提取 `filerules.js` 源码核对：`folder` 规则实现为 `leading(path,"/").startsWith(trailing(leading(value.toLowerCase(),"/"),"/"))`，即 `{"type":"folder","value":"ai"}` 会匹配所有 `ai/...` 路径 → **ignore 条目格式有效**。

**关于「ai/、agent/ 不在真实编译包内」的置信度**：auto-preview 的 info-output 只给体积、不给文件清单，无法直接列文件证明；但（a）dev 无依赖过滤源码已独立核对，（b）ignore 规则源码+实验已证生效，（c）历史 p2（物理删除 ai/agent 后体积不变）实验一致 → **高置信度**。若需 100%，可在 DevTools「详情 → 代码包分析」查看文件清单（人工，见 §7）。

### 2.6 清单 6：真实「代码质量 → 重新扫描」

**不能安全自动化**：`cli.bat -h` 的命令列表中没有代码质量扫描命令（cli cloud/open/preview/auto-preview/upload/build-npm/auto/close/cache/...）；质量面板的扫描由 webview `handleScanCode` → `IWebCodeQualityService.getCompileResultAndCheckWithProxyFunc` 走 IDE 内部 IPC/后端服务触发，无对外 CLI/HTTP 入口。GUI 自动化对最小化窗口属于「激进操作」，按指示不执行。→ **转为人工步骤（见 §7）**。

### 2.7 清单 7：过程文件清理

见 §8。

---

## 3. 关键数字口径总表（防止误读）

| 指标 | 数值 | 出处/说明 |
|---|---|---|
| 媒体总量（修复后） | **108,978 B / 106.42 KB**（35 PNG，0 音频） | 独立遍历 + 复刻检查器 + 编译体积差，三方一致 |
| 媒体总量（修复前） | **243,708 B / 238.00 KB** | 优化前备份独立复算，精确复现 |
| auto-preview 编译包（当前） | **532,652 B / 520.2 KB** | DevTools CLI 实测（本次） |
| auto-preview 编译包（20:12 基线） | 667,382 B | 历史 `_compile_info_off.json`；与当前差 134,730 B = 媒体压缩量 |
| 质量扫描语义（关无依赖过滤）包体 | 907,329 →（加 ignore）549,039 B | 本次真实 DevTools 实验，-358,290 B |
| AI 开启时 `/ai/` 分包 | 355,294 B | 19:23 历史 `_v2_compile_info.json` |
| 复刻检查器 package.totalBytes | 788,159 B（原始字节、含 project.config.json） | **不是**真实编译包体积，仅脚本内部口径 |

---

## 4. 挑错 / 风险 / 待办

1. **[已更正前提] 19 个组件的根因是「18:54 扫描时 AI 开启」，不是「AI 关闭但源码保留」**（§1）。修复本身正确，但汇报时请按真实分工描述：直接修复 = `--off` 去掉 app.json AI 配置；本轮 `ignore` 是上传包保险 + 防回归。
2. **[待办·关键] 官方「代码质量 → 重新扫描」未实际执行**（无法脚本触发）。当前所有 PASS 结论来自离线复刻 + 真实编译 + asar 源码，建议 Lead/用户手动点一次「重新扫描」做最终确认（§7，预计 1–2 分钟）。
3. **[发版门禁] 上传（prod）编译默认不做无依赖过滤**：`ignoreUploadUnusedFiles` 未设置（默认不过滤），`packOptions.ignore` 是阻止 ai/、agent/ 进上传包的**唯一保险**。发版前请保持 `app.json` off + ignore 两条存在；**不要在上传前跑 `ai_toggle.py --on`**（会把 AI 配置和 ignore 同时恢复）。
4. **[口径] 不要把复刻检查器的 `package.totalBytes`（788,159 B / 769.69 KB）当真实包体**，它按源文件原始字节且含 project.config.json（实测探针 +1000 B → +953 B）；真实编译包 = 532,652 B。建议后续在脚本输出/文档中标注该局限。
5. **[低风险] `project.config.json` 写回补了末尾换行**（原文件无），是 ai_toggle 声明的行为，语义无影响。
6. **[低风险] 6 张死资源图片**仍计入媒体总量（app-icon-1024 等，共约 14.9 KB）；当前远超阈值合规，可选清理。
7. **[已发现/已清理] 我验收时的 AI 契约探针在 `_backup_ai_toggle` 里写入了 2 个重复备份**（见 §8，内容与当前项目文件完全相同，可安全删除）；`%TEMP%` 有 2 个实验副本目录被 DevTools 进程短暂占用，关闭 IDE 后可删。
8. **[既有问题·非本轮] 3 个遗留 node 进程**仍在运行（`unit.js`×2、`v2_unit_tests.js`，创建于 19:01–19:09，非本次验收产生）；如确认无用途建议清理。另 2 个 `node ... --input-type=module --eval` 进程为其他系统组件，未动。
9. **[版本号] 2.0.0 未被改动**：`utils/version.js` 仍 `VERSION='2.0.0'`；未上传/未发布。

---

## 5. 最终结论（对 task-4 清单）

- **修复 1（图片和音频资源 ≤200K）：验收通过（PASS）** —— 独立复算 106.42 KB、真机编译体积差精确吻合、PNG 结构/解码/引用/尺寸/PSNR 全部通过。证据强度足以认定。
- **修复 2（不应存在无使用的组件）：验收通过（PASS，代码/编译层证据），但建议以官方面板重扫作最终闭环** —— 官方判定源码已独立核对、真实编译实验证明 ignore 生效、19 个组件的根因与修复路径清晰；唯一缺口是**官方面板未实际重新扫描**（无自动化入口）。若人工重扫仍报 19，按 §7 排查（优先确认 app.json 是否被重新打开 AI）。
- **发版约束**：保持 AI off + `packOptions.ignore` 两条；未上传/未发布；版本号 2.0.0。

---

## 6. 复现命令（全部只读项目，副本在 %TEMP%）

```powershell
cd C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools-tests

# 1) 离线复刻检查（真实项目）
node code_quality_check.js --project ../mp-class-tools --json

# 2) 独立复算媒体 + 图片完整性 + 配置差异
python _verify\verify_media.py
python _verify\verify_config_diff.py
python _verify\verify_image_quality.py
python _verify\verify_other_rules.py

# 3) ai_toggle 周期（全部在 %TEMP% 副本）
python _verify\verify_ai_toggle_cycle.py
python ai_toggle.py --status

# 4) 既有测试
node unit.js ; python staticcheck.py ; node sync_contract_test.js ; python test_ai_toggle.py

# 5) DevTools 真实编译（不 --upload）
& 'C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat' auto-preview `
  --project C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools --info-output "$env:TEMP\out.json"

# 6) asar 源码取证 + ignore 因果实验（真实 DevTools，%TEMP% 副本，不上传）
python _verify\verify_asar.py
python _verify\verify_devtools_ignore.py
```

---

## 7. 人工复扫步骤（清单 6 交付）

前置：IDE 已登录，**主窗口标题应为 `mp-class-tools`**（验收结束时已核实，当前就是）。若 IDE 显示的是 `%TEMP%` 下的副本窗口，请先切回 `mp-class-tools`（本验收的实验副本均已 `cli close`）。

1. 打开微信开发者工具 `mp-class-tools` 项目窗口。
2. 顶部菜单 **「工具」→「代码质量」**（或界面「代码质量」面板）。
3. 点 **「重新扫描」**（旧结果里可能仍显示 18:54 的红色 2 项，必须重新扫描）。等待完成（会自己重新编译一次，约 1–2 分钟）。
4. **预期结果：13 条规则全部「已通过」**，重点三条：
   - 图片和音频资源：**106.42 KB ≤ 200 K** ✓
   - 不应存在无使用的组件：**0 个** ✓
   - 不应存在无依赖文件：通过 ✓（本项目 `ignoreDevUnusedFiles=true` 放行）
   - 代码包大小：**520.2 KB ≤ 1.5 MB** ✓
5. 若仍报 19 个未使用组件：
   - 先在 `mp-class-tools-tests` 跑 `python ai_toggle.py --status`，确认「AI 分包/agent 未启用」「ignore ai/agent 已排除」；
   - 确认 `mp-class-tools/app.json` 无 `subPackages`/`agent`（`--status` 会显示）；
   - IDE **「工具」→「清除缓存」→「全部清除」**，重新编译后再扫一次；
   - 若依然异常，把扫描结果截图/文字回报 Lead。
6. **扫描结束后不要点「上传」/「发布」**（本轮仍未上传）。

---

## 8. 过程文件 / 清理清单

**(a) 工作区内：**
- `mp-class-tools/`：**无任何本次验收新增过程文件**（全量扫描：无 `.bak/.tmp/.log/__pycache__` 等；本轮 project 侧改动仅 images/、project.config.json，以及 Lead 的 README/CHANGELOG 文档、ai-packager 的 ai/README.md 文档）。验收期间未改项目任何文件（关键文件哈希验收前后一致：app.json `4A1F6147…`、project.config.json `63EDF58B…`）。
- `mp-class-tools-tests/_verify/`：**本报告的交付物（保留）**：8 个验收脚本 + 19 个日志/JSON 证据（见附录）。
- `mp-class-tools-tests/_backup_ai_toggle/`：**2 个可删的重复备份**（我的 AI 契约探针 `--on` 时写入默认备份目录）：
  - `app.json.bak-20261105-215216`（1,640 B，内容 = 当前 app.json，哈希一致）
  - `project.config.json.bak-20261105-215216`（1,849 B，内容 = 当前 project.config.json，哈希一致）
  - 另 2 个任务相关备份 `app.json.bak-20261105-192803`、`project.config.json.bak-20261105-213252` **必须保留**。
- `mp-class-tools-tests/unit-result.json`、`sync_contract_result.json`：被本轮测试按脚本设计重写（历史同类产物，非新增；可选清理）。
- **未发现** `_shots`/预览图等新增过程产物（`_shots`、`_qa_v2` 等均为 20:00 前历史产物）。

**(b) %TEMP%（不在工作区，可删；多数已清理）：**
- 已删除：`verifier_nofix_*`、`verifier_cycle_*`、`verifier_oldmedia_*`、`verify_ai_contract_probe`、`verify_asar_extract`、`verify_auto_preview_*.json` 等（约 12 MB）。
- **仍占用（DevTools 进程短时锁定，关闭 IDE 窗口/重启后可删）**：`%TEMP%\verify_devtools_ignore\`、`%TEMP%\verify_devtools_ignore_b\`（我的 ignore 因果实验副本，约 6 MB）。
- 非本次任务（未动，供 Lead 判断）：`%TEMP%\cq_probe\`（scanner-analyst 实验副本，约 18.6 MB / 4,141 文件）、`cq_*.json`、`liveverify_qyio8in6`、`verify_stats_shots`。
- IDE「最近项目」中可能残留指向已删除 `%TEMP%` 副本的条目（已关闭，无副作用）。

**(c) 遗留进程（非本次产生）：**`node unit.js`×2、`node v2_unit_tests.js`（创建于 19:01–19:09），建议确认后清理。

---

## 附录 A：验收证据文件（`mp-class-tools-tests/_verify/`）

| 文件 | 内容 |
|---|---|
| `VERIFY_REPORT.md` | 本报告 |
| `verify_media.py` + `media-verify.log` | 媒体独立复算/基线对比/PNG 结构/引用 |
| `verify_image_quality.py` + `image-quality.log` | 优化前后逐像素 PSNR/alpha |
| `verify_config_diff.py` + `config-diff.log` | app.json / project.config.json 差异 |
| `verify_asar.py` + `asar-verify.log`（+ `%TEMP%` 已清理的模块提取） | 从 app.asar 独立复核检查器/编译器源码 |
| `verify_other_rules.py` + `other-rules.log` | 其余 10 条官方规则条件复核 |
| `verify_ai_toggle_cycle.py` + `ai_toggle_cycle.log` | on/off/status/幂等/防御/真实项目零改动 |
| `verify_ai_contract_on.py` + `ai_contract_on.log` | AI-on 副本 ai_contract_test --final 99/99 |
| `verify_devtools_ignore.py` + `devtools-ignore-experiment.log` | 真实 DevTools ignore 因果实验 907,329→549,039 |
| `cqc_real_20261105-214519.json` / `cqc_real_human.log` | 修复后复刻检查结果（PASS） |
| `cqc_oldmedia_nofix.json` | 修复前复现（媒体 238 KB FAIL + 19 组件 FAIL） |
| `cqc_nofix_*.json` / `cqc_real_excl_*.json` | 包体口径/过滤对照实验 |
| `unit.log` / `staticcheck.log` / `sync_contract.log` / `test_ai_toggle.log` | 既有测试套件输出 |
| `ai_toggle_status_real.log` | 真实项目 `ai_toggle --status` |

## 附录 B：本报告关键工具版本

Python 3.12.8 / Pillow 11.3.0 / numpy 2.5.3 / Node v24.21.0 / ffmpeg 9.0.2 / 微信开发者工具 Stable v2.02.2608080（asar `package.json` 窗口标题独立核对）。
