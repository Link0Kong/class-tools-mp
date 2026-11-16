# 小程序电费 UI 重做 + 趋势折线图 · 独立验收报告（task-15）

> 独立 QA（fresh context）· 2026-11-06 07:33–07:55（Asia/Shanghai）· task-15
> 对象：mp-dev task-14 —— 宿舍选择自定义 bottom-sheet（替换原生 multiSelector，修真机列错乱）+ 近 24h 趋势 canvas 2d 折线（替换 DOM 柱状图）。
> **结论：PASS（0 FAIL）**；功能/交互/视觉/门禁全部独立复核通过。附 3 个信息项（非阻塞，见 §6）。
> 约束遵守：不改产品代码、不上传/发布、不写云端、不打印凭据。

## 0. 被测快照

| 文件 | 字节 | sha256 |
|---|---|---|
| `pages/power/power.js` | 13,528 | `07cb8615…d4bf` |
| `pages/power/power.wxml` | 5,759 | `b859bea6…1f21` |
| `pages/power/power.wxss` | 8,329 | `a50f3dad…a767` |
| `utils/power.js` | 11,851 | `64fb03f6…7f1f` |
| `_compile_info_off.json` | 128 | TOTAL **579,567 B** |

截图（mp-dev 已出图，QA 逐张独立查看）：`_shots_power_sync/`
`01_sheet_open.png`（80,582 B · `00249d56…`）、`01b_sheet_23A.png`（95,473 B · `21f397e5…`）、
`02_dashboard_trend.png`（89,489 B · `33b365bb…`）、`03_low.png`（91,520 B · `f955664f…`）；
`result.json`：windowWidth **390**、pixelRatio 3、consoleErrors **[]**。

## 1. 选择 UI（自定义 bottom-sheet）— PASS

### 1.1 静态结构
- ✅ `pages/power/power.wxml` 含完整 sheet：`pw-mask`（遮罩，`bindtap="closeSheet"`）/ `pw-sheet` / `pw-sheet-title`（关注宿舍）/ `pw-sheet-x`（×）/ `pw-blds` + `pw-bld`（4 楼栋 pill）/ `pw-rooms` + `pw-room-btn`（房间网格）/ `pw-cancel`（取消）；`catchtouchmove` 锁定背景滚动；`safe-area-inset-bottom` 适配。
- ✅ **全库无 `multiSelector` / `<picker`（电费选择）残留**：power wxml/js 内 0 处；`utils/power.js` 已删除 `pickerOf`/`rvFromPicker`（改为 `roomsOfBuilding`/`buildingOf`/`rvOf`/`labelOf`）。其他页面的日期/时间 `<picker>` 与本功能无关。
- ✅ 房间目录分组正确：**13号楼 324/308（2）**、**16号楼 305/306（2）**、**23号楼A座 321/323–330（9）**、**23号楼B座 422–425（4）**，共 17 间；`buildingOf/rvOf/labelOf` 往返一致。

### 1.2 行为（QA 独立 wx mock 断言）
- ✅ 打开 sheet 默认定位当前已选楼栋；切楼栋只更新该栋房间网格；**开弹层、切楼栋、取消/遮罩关闭全程 0 个 `power`/`power_history` 请求**。
- ✅ 点房间：**立即选中并收起**（同一次 setData 先 `sheetOpen:false` 再发请求）、`selectedRv`/`selLabel` 更新（选中态高亮 ✓）、写入 `UD.power`，且**只请求该房间** `power?id=eq.<rv>` + `power_history(select/order/ts=gte/limit=500)` 各 1 次。
- ✅ 未选择时页面始终 0 请求；选择后进 UD v6 `power` section（13 顶层键/power.at 镜像/防抖推送）不回归（QA 契约用例 + `sync_contract` 30/30）。

### 1.3 触控区 / 360·430 布局
| 目标 | WXSS | 360 宽 | 390 宽 | 430 宽 |
|---|---|---|---|---|
| 房间按钮 `.pw-room-btn` | min-height 88rpx | 42.2px | 45.8px | 50.5px |
| 取消 `.pw-cancel` | min-height 96rpx | 46.1px | 49.9px | 55.0px |
| 关闭 × / 楼栋 pill | 80rpx | 38.4px | 41.6px | 45.9px |
- 房间按钮（主选择目标）360 下 42.2px ≥40、390/430 下 ≥44 ✓；取消 ≥46 ✓。
- 布局规则：sheet `width:100%`、房间 `flex-wrap` + `max-width:calc(33.333% - 12rpx)`、`@media (max-width:360px)` 切 2 列、canvas/图表 `width:100%`、tiles `calc(50% - 8rpx)`、无固定超宽 → **360/430 无横向溢出（静态）**；390 截图目检无裁切/横向滚动。

### 1.4 截图目检（QA 独立看图）
- `01_sheet_open.png`：遮罩+底部 sheet；标题「关注宿舍」+ ×；4 个楼栋 pill（13号楼选中）；「房间（13号楼）」两枚按钮 **324 / 308**；底部「取消」。排版无溢出、点击区充足。
- `01b_sheet_23A.png`：切到 23号楼A座 → 房间网格 **321 / 323 / 324 / 325 / 326 / 327 / 328 / 329 / 330**（9 间，3 列换行，最后 330 单独一行）+ 取消；无横向溢出、无遮挡。

## 2. 趋势折线图（canvas 2d）— PASS
- ✅ 页面有 `<canvas type="2d" id="pwTrend">`；`pw-bars/pw-bar-cell` 柱状 DOM **已移除**；y 轴 `hi/mid/lo` 三个刻度位。
- ✅ ≥2 采样时绘制：QA canvas mock 记录到 `clearRect`、2 条网格 + 折线 + 末点（`stroke`≥2）、面积渐变（`createLinearGradient` + 2 个 `addColorStop`、`fill`≥2）、`lineTo`≥4、末点 `arc(r=3)`；DPR：`pixelRatio=2` 下 `canvas.width=720 / height=320`（CSS 360×160）且执行 `scale(2,2)`。
- ✅ `<2 采样`：`trend.empty=true`、文案「数据积累中」、`hi/mid/lo=—`，且 canvas **不绘制**（QA 断言 ops 无新增）。
- ✅ 刷新 / 切换宿舍后重绘（`clearRect` 次数递增）；`onShow` 重绘分支存在。
- ✅ 图例三值：起点 / 当前 / 近 24h 下降（`fmtDrop` 2 位小数），与 `derive` 的累计下降（忽略充值回弹）一致。
- ✅ 截图目检：`02_dashboard_trend.png`（382 度·充足·环形约 days/30、折线自左上到右下、面积渐变、2 条网格、末点圆、右侧 100.00/81.60/63.20 刻度、图例 100.00/382.02/36.80）与 `03_low.png`（22.3 度·低电、低电条「剩 22.25 度 · 约 0.6 天」、小段红色环、折线 60.00→23.20）——**线段清晰可见、无拉伸模糊/锯齿、无遮挡按钮**。

## 3. 不回归 — PASS
- 阈值 30/60 + 边界（59.99 偏低 / 60 充足 / 29.99 低电）、4 tiles 文案与单位、环形 days/30（0.02/0.04/1）、低电条「剩 X 度 · 约 Y 天」、`fmtMain`：QA 行为断言全部 PASS。
- 诊断页管理员门限（非管理员 0 service_health 请求）：PASS；UD v6 13 键顺序/power.at 镜像/推送 blob：PASS（`sync_contract` 30/30 + QA 契约用例）。
- 未选择 0 请求、2 分钟 TTL/force、失败降级（有旧数据保留+toast / 首次 error）、空行 error、离线兜底：QA 行为断言 PASS。

## 4. 门禁（独立复跑，最终快照）
| 检查 | 结果 |
|---|---|
| `node unit.js` | **184/184 PASS** |
| `node v3_power_diag_tests.js` | **17/17 PASS**（新增 sheet/canvas 用例） |
| `node sync_contract_test.js` | **30/30 PASS** |
| `python staticcheck.py` | **exit 0** |
| AI 三件套基线 | identity **31/31**、homework **33/33**、notice **32/32** PASS |
| `cli auto-preview` / `cli preview` | exit 0；**TOTAL 579,567 B（566.0 KB）单主包**，与 `_compile_info_off.json` **完全一致** |
| QA `static_scan.py --tag power_ui`（已更新旧 picker/柱状断言） | **72 项：PASS 71 / FAIL 0 / PEND 1**（PEND=包体/配置信息项）✅ |
| QA `mp_sync_features_check.js --tag power_ui` | **42 项：PASS 40 / FAIL 0 / PEND 2**（见 §6）✅ |
| 既有 QA `mp_v2_check.js --tag power_ui` | **47 项：PASS 47 / FAIL 0 / PEND 1**（catchtouchmove 断言已更新为允许遮罩/弹层写法）✅ |

## 5. 结论
**「小程序电费：宿舍选择 UI 重做 + 趋势折线图」= PASS，可交付（源码级；未上传/发布）。**
原生 multiSelector 根因已消除（全库无残留），自定义 sheet 交互/房间目录/0 请求/选中即收起/UD 同步全部符合；趋势 canvas 折线（DPR/面积/网格/末点/刻度）与空态/重绘行为符合，390 截图目检清晰无拉伸。门禁全绿，包体 579,567 B 与编译信息一致。

## 6. 信息项（非阻塞，不影响本轮验收）
1. **小型控件 80rpx 在 360 宽下 = 38.4px（<40 名义值）**：关闭 × / 楼栋 pill；主选择目标房间按钮 42.2px@360、45.8px@390 满足 ≥40/44。若后续追求严格 44pt 全控件，可把 80rpx→88rpx。
2. **网站 07:34 后继续演进**：网站端 4th tile 已从「更新」改为「上次充值」并加入时间范围（24h/7d/30d），mp 按 Lead 指定 **07:01 定稿**实现（更新·约 1 小时/次）；属网站后续迭代，不影响本轮 mp 验收。
3. `quantity=null` 边界：两端 `Number(null)=0` → 0.00 低电（无真实数据触发，建议数据侧保证非空）。
4. **360/430 视觉**：devtools 截图仅 390；360/430 以 WXSS 自适应规则（2 列/3 列、100% 宽、无固定超宽）验证无横向溢出，如有需要可后续补 360/430 真机截图。

## 7. 复现
```powershell
cd C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools-tests
node unit.js; node v3_power_diag_tests.js; node sync_contract_test.js; python staticcheck.py
cd _qa_v2
python static_scan.py --tag power_ui
node mp_sync_features_check.js --tag power_ui
node mp_v2_check.js --tag power_ui
cd ..\..\mp-class-tools && & "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto-preview --project . --auto-port 9420
```
证据：`_qa_v2/_reports/mp_static_power_ui.json`、`mp_sync_features_power_ui.json`、`mp_v2_power_ui.json`、`_shots_power_sync/`。
