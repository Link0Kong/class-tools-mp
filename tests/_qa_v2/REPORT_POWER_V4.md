# 小程序电费 v4 · delta 验收报告（task-19 · **阶段报告，非最终结论**）

> **【状态更新 2026-11-06 08:0x】本报告为 v4 阶段的验收过程证据，不是最终交付结论。**
> 网站已于 07:56 上线电费 **v5**（532,533B / e38bddcf：估算算法重构 + 可调低电阈值 UD `power.low`），mp-dev 正在对齐 v5（task-20）。
> **最终验收将以 task-21 在最终 v5 字节上完成（v4 全部点 + v5 估算算法 fixture + 低电阈值/low 契约/判定边界 + 包体/截图）为准。**

> 独立 QA（fresh context）· 2026-11-06 07:55–08:10（Asia/Shanghai）· task-19
> 对象：mp-dev task-18 —— 电费对齐网站 07:38 **v4**：7d/30d 趋势横滑、固定 y 轴、固定 x 轴覆盖层、真实时间比例、降采样/物理宽上限。
> v4 阶段结论：PASS（0 FAIL）。最终字节上一次性完整 delta：v3.1 全项 + v4 横滑/固定轴/时间比例/空态/包体/截图均通过。
> 约束遵守：未改产品代码、未上传/发布、未写云端、未打印凭据。

## 0. 被测快照（最终 v4）

| 文件 | 字节 | 说明 |
|---|---|---|
| `pages/power/power.js` | 19,783 | 区间/横滑/测量/固定轴/绘制 |
| `pages/power/power.wxml` | 7,231 | scroll-view + 固定 y 轴 + x 覆盖层 |
| `pages/power/power.wxss` | 9,782 | pw-plot/滚动条隐藏/轴样式 |
| `utils/power.js` | 17,113 | RANGES/chartWidth/trendLine(时间比例)/trendLimit/xticksWindow/deriveRange |
| `utils/cloud.js` | 76,782 | POWER_RANGE_MS / POWER_HIST_TTL 5min / limit=2000 |
| `_compile_info_off.json` | 128 | **TOTAL 587,846 B** |

截图（QA 逐张独立查看，`_shots_power_sync/`）：`01_sheet_open`(80,358)、`01b_sheet_23A`(95,240)、`02_dashboard_trend_24h`(89,509)、
`03_low`(92,188)、`04_trend_7d`(94,190)、`04b_tiles_7d`(104,527)、`04c_trend_7d_scrolled`(93,677)、
`05_trend_30d`(93,261)、`05b_tiles_30d`(103,507)、`05c_trend_30d_scrolled`(92,933)；`result.json` windowWidth 390 / pixelRatio 3 / consoleErrors `[]`。

## 1. 区间与数据契约 — PASS
- ✅ 三档 chips（24h / 7天 / 30天）wxml 渲染、默认 24h；`zq_power_range_v1` 本机持久化：切 7d 后 storage=`7d`，重进页恢复 7d；**不进 UD**（`store.power` 始终只有 `{sel,at}`，切档无 userdata 请求）。
- ✅ history 契约逐项：`select=ts,quantity`、`roomverify=eq.<rv>`、`order=ts.asc`、`limit=2000`、`ts=gte.<now-窗口>`（24h/7d/30d 窗口偏差均在容差内）。
- ✅ 每档 5 分钟缓存：初始 24h 1 次 history；切 7d +1、切 30d +1、**切回 7d 0 请求**；`POWER_HIST_TTL = 5*60*1000` 静态确认。
- ✅ 估算可用/环形/低电条固定用 24h：7d 下 tile1 与 24h 完全一致；低电条天数取 24h `deriveRange`；`ringArc(row,d24)`。
- ✅ 切档/换房后 `scrollLeft` 归零（页面数据与 `_sl` 同步复位）；换房只请求新房间。

## 2. 趋势 v4 — PASS
### 2.1 横滑与宽度
- ✅ **24h 不横滑且铺满**：`scroll-x="{{range !== '24h'}}"`（24h=false）；`chartW === 容器宽`（mock 360）；无滚动条（`show-scrollbar="{{false}}"`/`enhanced`）。
- ✅ **7d/30d 内容宽 > 容器可横滑**：`chartWidth = max(容器, n*gap+16)`（7d gap16、30d gap9）；实测 7d/30d chartW 均 > 360，切回 24h 恢复 360。
- ✅ 降采样上限：`TREND_LIMIT = {24h:240, 7d:170, 30d:240}`；600 点输入时 7d 输出 ≤170、30d ≤240、24h ≤240，首末点保留。
- ✅ **canvas 物理宽 ≤5376**：`MAX_PHYS=5376`；30d 超宽 canvas 在 pixelRatio=3 时 DPR 被钳制，`node.width ≤ 5376`（QA 独立断言）。

### 2.2 真实时间比例
- ✅ 纯函数：不均匀时间点（0/1h/3h/10h）→ x = 0/0.1/0.3/1.0；y 按电量。
- ✅ canvas：`lineTo` 横坐标间距与时间差成比例（22h 窗口内 1/2/10/9h 采样，实测段间距与期望比例误差 ≤1.5px）。

### 2.3 固定 y 轴
- ✅ wxml 固定 `pw-yaxis`（`pw-yline` + 3 个 `pw-ylab`），空态 `wx:if="{{!trend.empty}}"` 只留竖线无刻度。
- ✅ 7d 横滑后 `hiText/midText/loText` 与标题不变（QA 断言 y 文本/位置固定）；y 轴 1 位小数（`toFixed(1)`，截图 720.0/551.0/382.0）。

### 2.4 固定 x 轴覆盖层
- ✅ `bindscroll="onTrendScroll"` → 16ms 节流 `_refreshXTicks` → `xticksWindow(points, range, cw, chartW, sl)`；横滑后刻度 label/left 变化；同屏无重复日期。
- ✅ 刻度数/格式：24h **3 个 HH:MM**、7d **4 个 MM-DD**、30d **5 个 MM-DD**（QA 断言 + 截图：24h `09:57/20:23/05:47`；7d 初始 `10-30…11-03` → 横滑后 `11-01…11-05`；30d 初始 `10-07…10-14` → 横滑后 `10-14…10-21`）。
- ✅ 横滑时 x 变、y 不变（见 2.3）。

## 3. v3.1/v3/v2 不回归 — PASS
- ✅ recharge/lastUp：充值上升不计入 drop；`d.recharge` 徽标「期间有充值」；tile4「上次充值」= `lastUp.reset`（2 位）+ `MM-DD HH:MM`，无记录 `—`/`暂无记录`。
- ✅ tile2 随档：近 24h/7 天/30 天用电（截图 510.5 / 887.7 度）；图例 `dropLabel` 24h「近 24h 下降」、7d/30d「区间下降」；起点文案 24h「起点」/其余「起」。
- ✅ 区间 chips、sheet（打开/切楼栋/取消 0 请求；点房间立即选中并收起）、未选择 0 请求、UD 13 键/`power.at` 镜像、阈值 30/60、环形 days/30、低电条、诊断管理员门限、TTL 2min/force/失败降级：全部 PASS（QA v4 脚本回归用例 + `mp_v2_check` 47/47 + `sync_contract` 30/30）。
- ✅ 空态：<2 采样 → 「数据积累中」、y 刻度「—」、x 刻度空、**不绘制 canvas**、只留 y 竖线。

## 4. 门禁与合规（独立复跑，最终 v4 字节）
| 检查 | 结果 |
|---|---|
| `node unit.js` | **189/189 PASS** |
| `node v3_power_diag_tests.js` | **22/22 PASS** |
| `node sync_contract_test.js` | **30/30 PASS** |
| `python staticcheck.py` | **exit 0** |
| AI 三件套基线 | identity 31/31、homework 33/33、notice 32/32 PASS |
| `cli auto-preview` / `cli preview` | exit 0；**TOTAL 587,846 B（574.1 KB）单主包**，与 `_compile_info_off.json` **完全一致** |
| QA `static_scan.py --tag power_v4`（已更新 v4 断言） | **76 项：PASS 75 / FAIL 0 / PEND 1**（PEND=包体/配置信息项）✅ |
| QA `power_v4_check.js --tag power_v4`（本任务新建） | **25 项：PASS 25 / FAIL 0** ✅ |
| QA `mp_sync_features_check.js`（已适配 v4） | **41 项：PASS 40 / FAIL 0 / PEND 1**（quantity=null 边界信息）✅ |
| 既有 QA `mp_v2_check.js` | **47 项：PASS 47 / FAIL 0 / PEND 1** ✅ |

## 5. 截图目检（QA 独立看图结论）
- 24h：24h chip 选中、无横滑、图占满卡宽；固定 y 轴 3 刻度 430.0/406.0/382.0（1 位小数）；x 3 个 HH:MM；图例 起点/当前/近24h下降。
- 7d 初始：内容宽>容器，右侧被截断可继续滑；x 4 个（10-30/10-31/11-01/11-03）；y 720.0/551.0/382.0 固定；「期间有充值」徽标；折线含充值跳变。
- 7d 横滑后：x 变为 11-01/11-02/11-04/11-05，**y 刻度与位置不变**；折线左移、可见充值后段。
- 30d 初始/横滑后：x 5 个（10-07…10-14 → 10-14…10-21），y 980.0/681.0/382.0 固定；横滑前后仅 x 变化。
- tiles（7d/30d）：估算可用 8.0 天（24h 口径）、区间用电 510.5/887.7 度、低电阈值 30 度、上次充值 694.96 度（11-03 17:38）/931.29 度（10-26 23:48）。
- 选择弹层/低电态：sheet 布局正常无溢出；低电 22.3 度 + 低电条「剩 22.25 度 · 约 0.5 天」+ 小段红环，清晰无遮挡。

## 6. 信息项（非阻塞）
1. `quantity=null` 边界：两端 `Number(null)=0` → 0.00 低电（无真实数据触发，建议数据侧保证非空）。
2. 截图设备为 390 宽；360/430 布局规则未变（sheet 2/4 列自适应、plot 100%、无固定超宽），本轮未重出小屏截图。
3. 降采样实现为**等距取点**（首末保留）而非横向滚动原始点；与 task-19「允许实现注明」一致（已在代码注释/README 说明）。

## 7. 结论
**小程序电费 v4（区间/横滑/固定 y 轴/固定 x 覆盖层/真实时间比例/充值语义）最终 delta 验收 = PASS，可交付（源码级；未上传/发布）。**
最终包体 **587,846 B** 与编译信息一致；v3.1/v3 全部功能不回归；门禁与 QA 三层独立检查全绿。

## 8. 复现
```powershell
cd C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools-tests
node unit.js; node v3_power_diag_tests.js; node sync_contract_test.js; python staticcheck.py
cd _qa_v2
python static_scan.py --tag power_v4
node power_v4_check.js --tag power_v4
node mp_sync_features_check.js --tag power_v4
node mp_v2_check.js --tag power_v4
cd ..\..\mp-class-tools && & "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto-preview --project . --auto-port 9420
```
证据：`_qa_v2/_reports/mp_power_v4_power_v4.json`、`mp_static_power_v4.json`、`mp_sync_features_power_v4.json`、`mp_v2_power_v4.json`、`_shots_power_sync/`。
