# 小程序 v2.0.0 增量验收报告：网站→小程序功能同步（电费 + 诊断 + UD 13 键契约）

> 独立 QA（fresh context，不参与实现）· 2026-11-06 07:03–07:20（Asia/Shanghai）· task-13
> 对象：mp-dev task-12（网站 → 小程序功能同步：`pages/power/*`、`pages/diag/*`、userdata v6 `power` section 13 键）
> **结论：功能同步 PASS（0 FAIL）。核心项全部独立复核通过；另有 2 个 PEND 信息项 + 1 个包体声明差异需 Lead/后续处理（见 §6）。**
> 约束遵守：不改产品代码、不部署/上传、不写云端、不打印任何凭据；测试全部用 Node `wx` mock（0 真实网络）。
> 说明：复验期间（07:05–07:06）mp-dev 又更新了 `pages/nt/nt.js`、`utils/notice.js`（修正通知文案测试口径），本报告以 **07:15 最终快照** 为准。

## 0. 被测快照（sha256）

| 文件 | 字节 | sha256 |
|---|---|---|
| `pages/power/power.js` | 8,383 | `dabd1bbd…e7fddd` |
| `pages/diag/diag.js` | 5,391 | `f4e48d74…82b60` |
| `utils/power.js` | 10,749 | `f5e66631…5aae` |
| `utils/diag.js` | 7,635 | `edef7878…ac049c` |
| `utils/cloud.js` | 75,724 | `0db2635c…1bdc8a` |
| `utils/privacy.js` | 6,561 | `422d9012…2165d1` |
| `utils/notice.js`（07:06 更新后） | 29,057 | `e4394388…695010` |
| `app.json` | 1,690 | `56777971…a8faf` |

## 1. 电费页（PASS，逐项证据）

### 1.1 入口与目录
- ✅ `app.json` 注册 **20 页**，含 `pages/power/power`、`pages/diag/diag`；无 demo/审核页。
- ✅ `utils/tools.js`：宿舍电费 `noHome:true`（不占首页常用/排序）、诊断 `admin:true`；「全部」页按 `!t.admin || admin` 过滤。
- ✅ 17 间房间目录（4 栋：13号楼2 / 16号楼2 / 23号楼A座10 / 23号楼B座3），`rv/label/building/room` 自洽且唯一；
  与网站 `PW_ROOMS` **逐项一致**（顺序、rv 集合、数量；QA 只读解析网站源码交叉核对）。

### 1.2 未选择 / 选择后的请求（QA 独立 mock 断言）
- ✅ 未选择宿舍：页面 `onLoad/onShow` 后 **0 个 `power` / `power_history` 请求**，`state=idle`。
- ✅ 选择宿舍（picker 两列 → rv 往返）：只请求该房间
  - `GET power?select=id,label,building,room,quantity,unit,low,updated_at&id=eq.1-16---306`
  - `GET power_history?select=roomverify,quantity,ts&roomverify=eq.1-16---306&order=ts.asc&ts=gte.<24h前>&limit=500`
  - 两个请求均带 `X-Class-Token` 与 `Authorization`（值不打印）；切换房间后只请求新房间。
- ✅ 非法 roomverify（bogus）→ 按未选择处理、0 请求、不显示脏数据；非法 quantity（非数字）→ `q=null` 显示「—」、状态 idle。
- ✅ 本机离线兜底 `zq_power_sel_<sid>`：无 UD 值时并入 `UD.power` 并按该房间加载；兜底键按 sid 命名，切换身份不串用他人关注宿舍。

### 1.3 仪表盘渲染
- ✅ 大号电量（`150.40` 度）+ 状态中文（>100 充足 / 30–100 偏低 / <30 低电；云端 `low=true` 也低电）+ 环形 `conic-gradient` + 最近更新时间。
- ✅ 状态切换独立验证：50 度→「偏低」，20 度→「低电」且 `lowOn=true`（低电提示条）。
- ✅ 近 24h 趋势：按小时聚合柱状图（≤24 桶、pct 10–100），起止时间/起点/当前展示；`derive` 给出日均用电/可用天数/采样间隔。
- ✅ 4 tiles = 估算可用 / 近 24h 用电 / 采样 / 下次同步（约 1 小时 · ClassPowerSync），空数据时 4 项为「—」。
- ✅ 刷新按钮 + 下拉刷新（force）；**2 分钟 TTL**：`load(false)` 重复 0 新请求，`load(true)`/下拉绕过 TTL 重新请求。
- ✅ 失败降级：有旧数据 → 保持 `ready` + toast「刷新失败，显示上次数据」；首次失败 → `error` 态可重试；云端空行 → `error` 态不渲染脏数据。

### 1.4 隐私
- ✅ 电费页只显示规范楼栋 + 房间号 + 电量 + 时间：源码无「姓名/学号/手机号」，无 `classMembers/classRoster`，无导出/canvas 逻辑；`onShareAppMessage` 仅页面入口（不带数据）。
- ✅ `privacy.buildExport` **不含** power/关注宿舍/roomverify（宿舍号只在本页本人可见，不进导出 JSON）。
- ✅ 数据与隐私页声明收集「关注宿舍（仅规范楼栋+房间号）」且「不导出、不对外分享」。
- ✅ 关注宿舍进 `userdata v6 power`：`pick` 写 `store.power={sel,at}` → 防抖 1200ms 推送；换端（模拟远端 UD）恢复；本机 v5→v6 迁移后 `power` 默认空。

## 2. 诊断页（PASS）
- ✅ **仅管理员**：非管理员 `onLoad/onShow/手动 load` 三层全部 denied，**0 个 service_health 请求**；`cloud.serviceHealth` 内部再校验（未登录/非管理员/isEnabled=false 直接返回 forbidden，不发请求）。
- ✅ 管理员读取 `GET service_health?select=id,name,kind,status,detail,meta,checked_at&order=id`，带 `X-Class-Token`；
  渲染 **4 组 13 项**（站点与云端 3 / 信息采集 6 / 定时任务 3 / 采集主机 1），状态中文（正常/注意/异常/离线/未知）。
- ✅ cloudbase 行用本次请求延迟覆盖（<3s 正常；慢→注意；失败→异常）；失败时 hint「云端连接失败」且不误报其它行离线。
- ✅ 采集主机心跳 >15min → 所有 `kind=local` 行降级「离线」+ 行尾「上报于 HH:MM」，汇总「采集主机离线」。
- ✅ `site_static` / `jwxt` 云端无行 → 本机课表快照兜底（≤30h ok / ≤54h warn / >54h down，展示「课表快照 X 小时前」）。
- ✅ 60s 自动刷新（`REFRESH_MS=60000`，仅当前页可见时执行）；`onHide/onUnload` 停止定时器；手动刷新可用；错误态不崩。

## 3. UD v6 契约（13 键，PASS）
- ✅ `privacy.SECTION_KEYS` = **10 section**（`homeTools,fit,draw,group,roster,hide,tt,prefs,nick,power`，power 最后）、`VERSION=6`、`DEFAULTS.power={sel:'',at:0}`、`SCOPE` 含「关注宿舍（电费）」。
- ✅ `mergeUd` 输出顶层键顺序 **`v,at,homeTools,fit,draw,group,roster,hide,tt,prefs,nick,power,homeToolsAt` = 13 键**；`at` 恰 10 section；`power.at` 与 `at.power` 镜像；`homeToolsAt===at.homeTools`。
- ✅ LWW：远端新 `power` 赢 / 本机新赢 / 未拥有 section（nick）原样保留 / v5 迁移不回归（fixture `legacy_v5.json`）。
- ✅ 推送 blob：本机选择 → 防抖 1200ms → `POST userdata` body `{id:<sid>, blob:<13 键 JSON>, ts}`；首次无基线时 `at.power` 可为 0（契约 §3.4 不抢时间戳），有基线后改动会提升 `at.power` 且 `power.at` 镜像同步。
- ✅ **与网站逐字节一致**：`web/tools/tests/sync_check.py` 的期望键顺序 `v,at,homeTools,fit,draw,group,roster,hide,tt,prefs,nick,power,homeToolsAt` 与 mp 契约完全相同（只读交叉核对）；网站 `UD_KEYS` 10 键顺序一致；`_sync_fixtures` 两端 merge 期望一致。

## 4. 门禁复跑（独立执行）

| 检查 | 命令 | 结果 |
|---|---|---|
| 产品单元测试 | `node unit.js` | **182 passed / 0 failed** ✅（复验期间 mp-dev 修正 notice 文案断言后从 174/177 变为 182/182；见 §6.3） |
| 同步契约 | `node sync_contract_test.js` | **30 passed / 0 failed** ✅ |
| 源码静态审计 | `python staticcheck.py` | **exit 0** ✅（handlers 缺失 []、secret 0、urlCheck false、20 页） |
| AI 三件套 | `node ai_unit_identity.js` / `ai_unit_homework.js` / `ai_unit_notice.js` | **31/31、33/33、32/32 PASS** ✅ |
| QA 合规/隐私静态扫描（已按 20 页 + 无审核模式 + 电费/诊断新特性更新） | `python _qa_v2/static_scan.py --tag sync_final` | **63 项：PASS 61 / FAIL 0 / PEND 2**（2 PEND = 信息项，见 §6）✅ |
| QA 独立行为检查（本次新建） | `node _qa_v2/mp_sync_features_check.js --tag sync_final` | **38 项：PASS 36 / FAIL 0 / PEND 2** ✅ |
| 既有 QA 回归 | `node _qa_v2/mp_v2_check.js --tag sync_final` | **47 项：PASS 47 / FAIL 0 / PEND 1** ✅ |
| mp-dev v3 电费/诊断测试（交叉参考） | `node v3_power_diag_tests.js` | 15 passed / 0 failed ✅ |
| 代码质量检查（媒体/包体规则） | `node code_quality_check.js --project …` | 图片和音频/组件/无依赖文件 全 PASS ✅ |
| 独立编译 | `cli.bat auto-preview` | **exit 0**（AppID wx3df9869d229b96c4）✅ |
| **包体实测（独立）** | `cli.bat preview` | **TOTAL 572,945 B（559.5 KB）单主包** ✅（< 2MB 限制） |
| 媒体预算 | QA 独立复算 `images/**/*.png` | **37 个 PNG = 109,337 B** ✅（与声明一致） |
| 版本 / AI | `utils/version.js`、`app.json`、`ai_toggle.py --status` | **2.0.0**；`app.json` 无 `agent/subPackages`（AI off，`ai/` 源码保留 8 SKILL OK）✅ |

## 5. 与 Lead 交付摘要的差异（QA 实测 vs 声称）

| 项 | mp-dev 声称 | QA 实测 | 判定 |
|---|---|---|---|
| 包体 | 570,087 B | **572,945 B**（devtools preview，07:15） | **声明为 07:02 快照，之后 `nt.js`(07:05)/`notice.js`(07:06) 有改动** → 以实测为准；建议 mp-dev 刷新编译信息后再报数 |
| unit | 177/177 | **182/182**（07:15 快照，修复 notice 文案测试后；07:05 首次复跑为 174/177） | 最终全绿；过程记录见 §6.3 |
| 媒体 | 109,337 B | 109,337 B（37 PNG） | 一致 ✅ |
| 房间目录 | 与网站一致 | 17 间、rv 顺序逐项一致 | 一致 ✅ |
| 状态阈值 | >100 充足 / 30–100 偏低 / <30 低电 | MP 实现 `WARN=100` 与验收文字一致；**网站当前 `PW_WARN=60`** | **PEND**：需 Lead 决定网站是否同步为 100（或修改验收文字） |

## 6. PEND 项（不阻塞本轮功能验收）

1. **状态阈值两端差异**：MP `LOW=30 / WARN=100`（与 task-13 验收文字一致），网站当前 `PW_LOW=30 / PW_WARN=60`。
   60–100 度区间网站显示「偏低」、小程序显示「充足」。属「网站→小程序功能同步」的一致性疑点，需 Lead 决定统一口径（改网站或改文字）。
2. **包体声明差异**：见 §5，实测 572,945 B；`_compile_info_off.json` 仍为 07:02 快照（570,087）。
3. **unit 过程**：07:05 首次复跑为 174/177（3 条通知文案断言按旧长文案「报送姓名截止/集合点名/报名已截止」，产品已按契约 §0.2 精简为「报送截止/点名/报名截止」；mp-dev 自己的 `unit-result.json` 当时也是 174/3）。07:06 mp-dev 修正测试与 notice.js 后为 **182/182**——**非产品缺陷，属测试口径滞后**，已恢复全绿。
4. **quantity=null 边界**：`normalizeRow({quantity:null})` → `Number(null)=0` → 显示 0.00 低电（网站 `Number()` 同口径）；无真实数据触发，建议数据侧保证非空。

## 7. 结论

- **小程序端「网站→小程序功能同步」（电费页 / 诊断页 / userData v6 13 键）功能验收 PASS**：核心行为、隐私、管理员门限、同步契约全部独立复核通过，0 FAIL。
- 门禁最终快照全绿：unit 182/182、sync_contract 30/30、staticcheck exit 0、AI 三件套全 PASS、QA static_scan 61 PASS/0 FAIL、QA 独立行为 36 PASS/0 FAIL、mp_v2 47/47、v3 15/15、devtools 编译/预览 exit 0、包体 572,945 B 单主包、媒体 109,337 B、版本 2.0.0、AI off。
- 建议：①mp-dev 刷新 `_compile_info_off.json`/README 的包体与 unit 数字（07:02 → 07:15 快照）；②Lead 决定状态阈值两端统一口径；③发版前按既定清单做真机/上传检查（本轮未上传、未发布）。

## 8. 复现命令

```powershell
cd C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools-tests
node unit.js && node sync_contract_test.js && python staticcheck.py
node ai_unit_identity.js && node ai_unit_homework.js && node ai_unit_notice.js
node v3_power_diag_tests.js
cd _qa_v2
python static_scan.py --tag sync_final
node mp_sync_features_check.js --tag sync_final
node mp_v2_check.js --tag sync_final
cd ..\..\mp-class-tools
& "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto-preview --project . --auto-port 9420
```
证据：`_qa_v2/_reports/mp_sync_features_sync_final.json`、`mp_static_sync_final.json`、`mp_v2_sync_final.json`、`mp_preview_size_sync_final.json`、`_reports/` 下既有 JSON。

## 9. PEND 收口 · delta 复核（2026-11-06 07:20，task-13 追加）

> mp-dev 已按 Lead 要求收口两个 PEND 并做 4 处界面语义对齐；本节为 QA **小范围 delta 复核**（不重跑全量 QA 套件）。
> 最终快照：`utils/power.js`（07:14，WARN=60）、`pages/power/power.js`（07:14）、`v3_power_diag_tests.js`（07:15）、
> `_compile_info_off.json`（07:16，573,399）、README/CHANGELOG/tests README（07:16）。

| 复核项 | 结果 | 证据 |
|---|---|---|
| ① 阈值与文案 | **PASS** | `LOW=30 / WARN=60`；`stateOf`：29.99→low、30→warn、59.99→warn、60→ok、100→ok；`stateText` 低电/偏低/充足；与网站 `PW_LOW=30, PW_WARN=60` 一致 |
| ② 界面语义与网站 07:01 定稿一致 | **PASS** | 4 tiles 文案/顺序/单位（估算可用·天 / 近24h用电·度 / 低电阈值·30度 / 更新·约1小时/次）；趋势图例三值（起点/当前/**近 24h 下降**，drop 只累计下降忽略充值回弹：180→170.2→150.4 得 29.6，插入 999 回弹仍 29.6）；环形 `arcs=days/30`（ARC_DAYS=30、ARC_MIN=0.02、ARC_FALLBACK=0.04、上限 1）；低电条「剩 X 度 · 约 Y 天」；`fmtMain`（≥100 取整、否则 1 位）；QA 行为断言 + 只读网站源码逐项交叉均 PASS |
| ③ 数字一致 | **PASS** | `_compile_info_off.json` = **573,399 B**；QA 独立 `cli.bat preview` 实测 **573,399 B（560.0 KB，单主包）——完全一致（0 差异）**；README/CHANGELOG/tests README 均写 **182/182、573,399 B**；全库无 570,087 / 177 残留（历史段以外 0 处） |
| ④ 门禁独立复跑 | **PASS** | `unit.js` **182/182**、`v3_power_diag_tests` **15/15**、`sync_contract` **30/30**、`staticcheck` **exit 0**、`cli preview` exit 0 |
| ⑤ 功能不回归 | **PASS** | 电费页 60/100 边界显示偏低/充足（页面级断言）；13 键顺序/power.at 镜像/推送 blob 不回归（sync_contract 30/30 + QA 行为）；未选择 0 请求、诊断管理员门限（QA 行为 37 PASS / 0 FAIL） |
| ⑥ 合规扫描 | **FAIL（1 处，非功能）** | QA `static_scan` 67 项 PASS 65 / **FAIL 1** / PEND 1；FAIL = **`mp-class-tools/pages/power/power.js:5` 文件头注释仍为旧文案**「>100 充足 / 30–100 偏低 / <30 低电」→ 建议改为「≥60 充足 / 30–60 偏低 / <30 低电」。产品代码/页面/文档其余部分已无旧文案（README 已正确同步；扫描初版对 README「≥100 取整」的误报已收敛） |

**收口结论：两个 PEND 实质已完成**（阈值/界面对齐/数字/门禁/功能不回归全部 PASS）；
**仅剩 1 行源码注释残留**（`pages/power/power.js:5`，不影响行为），mp-dev 清理后 QA `static_scan` 即恢复 0 FAIL（可 30 秒内复跑确认）。

**收口复核更新（2026-11-06 07:22，mp-dev 清理注释后复跑）**：`pages/power/power.js` 第 5/7 行注释已改为新口径（功能代码未动）；QA `python _qa_v2/static_scan.py --tag delta` 复跑 **67 项：PASS 66 / FAIL 0 / PEND 1**（PEND=包体/配置信息项），防回退项「全库无 30–100 偏低 / ≥100 充足残留」= **0 处**；`unit.js` 182/182、`v3_power_diag_tests` 15/15、`sync_contract` 30/30、`staticcheck` exit 0、`cli preview` **573,399 B**（与 `_compile_info_off.json` 完全一致）→ **收口完成，最终 PASS**。
