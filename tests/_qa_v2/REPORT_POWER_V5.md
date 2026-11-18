# 小程序电费 v5 · 最终验收报告（task-21）

> 独立 QA（fresh context）· 2026-11-06 08:15–08:35（Asia/Shanghai）· task-21
> 对象：mp-dev task-20 —— 电费对齐网站 07:56 **v5**：估算算法重构（`rateFrom/estimate`）+ 可调低电阈值（`UD.power.low`）。
> **结论：PASS（0 FAIL），最终交付结论。**（v4 报告 `REPORT_POWER_V4.md` 已标注为阶段报告。）
> 约束遵守：未改产品代码、未上传/发布、未写云端、未打印凭据。

## 0. 被测快照（最终 v5）

| 文件 | 字节 | sha256 |
|---|---|---|
| `pages/power/power.js` | 21,970 | `3c17a065…d4bc` |
| `pages/power/power.wxml` | 8,012 | `7f883d69…8eff` |
| `pages/power/power.wxss` | 10,956 | `ce65b7c8…9903` |
| `utils/power.js` | 20,789 | `15ff22db…b58b` |
| `utils/cloud.js` | 78,028 | `40c92332…413b` |
| `utils/privacy.js` | 6,570 | `7d03cf61…c8eb` |
| `_compile_info_off.json` | 128 | **TOTAL 592,727 B** |

截图（QA 逐张独立查看，`_shots_power_sync/`，16 checks / 390 宽 / DPR3 / **0 console errors**）：
`01_sheet_open`(80,375)、`01b_sheet_23A`(95,260)、`02_dashboard_trend_24h`(89,151)、**`02b_tiles_24h_estimate`(96,190)**、
`03_low`(90,060)、`04_trend_7d`(94,139)、`04b_tiles_7d`(105,271)、`04c_trend_7d_scrolled`(93,626)、
`05_trend_30d`(93,121)、`05b_tiles_30d`(104,662)、`05c_trend_30d_scrolled`(92,790)、
**`06_low_panel`(106,258)**、**`07_low50_warn`(86,093)**、**`08_low50_low`(88,850)**。

## 1. 估算算法 v5 — PASS

### 1.1 rateFrom 分段统计（QA 独立 fixture）
- ✅ 正常下降：`used=6 度 / hours=12h → rate=12 度/天`。
- ✅ **充值跳变整段跳过**：序列加入 `+100` 跳变后，`used` 仍 6、`hours` 仍 12（跳变段既不计用电也不计时长），`recharge=true`。
- ✅ 持平日：`used=0`、`hours` 累计（12h）→ `rate=0`，由 estimate 抬到**下限 0.05**。
- ✅ 数据不足（<2 点）→ `rate=null`。

### 1.2 estimate 混合与边界
- ✅ Fixture：24h（10 度/12h → 20/天）+ 7d（70 度/168h → 10/天）→ **`rate = 0.65*20 + 0.35*10 = 16.5`**；`days = q/rate`（q=330 → 20.0 天，精确）。
- ✅ **仅一档有效**：仅 24h 有效用 20/天；仅 7d 有效用 10/天；两档都无效 → `valid=false`。
- ✅ 极低速率（持平日）→ `rate=0.05`，q=100 → `days=2000` → **tile1 显示「≥30」、daysText「≥30 天」、环满环（arcs=1）**。
- ✅ 无估算：`daysMain='—'`、`daysText='数据积累中'`（页面趋势空态一致）。

### 1.3 tile1 / 环 / 低电条 / 拉取
- ✅ tile1 主值：`days>=30 → '≥30'`，否则 1 位（`5.3`）；副标 **`≈ X.X 度/天`**（截图 6.6 天 / ≈57.7 度/天）。
- ✅ 环 `arcs = estimate.days/30`（valid 时 0.02–1，无有效估算 0.04，未选择 0）；低电条 `剩 X 度 · 约 ≥30/X 天`；均用 estimate（非旧 derive）。
- ✅ **拉取同时有 24h + 7d**：选择宿舍后 `powerPull` 恒并行 `24h`+`7d`（30d 档再加当前档）；初始 history 请求 2 条（24h/7d），均 `select=ts,quantity&limit=2000&order=ts.asc&ts=gte.<窗口>`；各档 5min 缓存（切 7d 0 请求、切 30d +1、回 7d 0）；未选择 0 请求。
- ✅ 页面实测：q=330 场景 tile1 值与副标跨区间不变（估算与区间无关），环/低电条/状态均按 estimate。

## 2. 可调低电阈值 v5 — PASS
- ✅ 默认 30；档位 **[10,20,30,40,50,60,80,100]**（无 70/90）；`normLow`：非法/越界→30，70→60、90→80、44→40、46→50、'50'→50。
- ✅ UI：点「低电阈值」tile（带 `›`，仅该 tile 触发）开/关面板；8 档选中态（30 高亮）；点选立即生效并关闭；`06_low_panel.png` 目检：8 档 + 提示「低于该电量标红；低于 2 倍为偏低」。
- ✅ 判定边界（`stateOf(row, low)`）：`q<low` 低电 / `low≤q<2*low` 偏低 / 其余充足。
  - low=30：29.99→低电、30→偏低、59.99→偏低、60→充足；
  - **low=50：49.99→低电、50→偏低、60→偏低（截图 07）、99.99→偏低、100→充足**（截图/断言一致）。
- ✅ 推送/同步：`UD.power = {sel,at,low}`；改阈值 `at=Date.now()` 触发脏检测 → 防抖 push blob（13 顶层键不变、`power{sel,at,low}`、`power.at===at.power`）。
- ✅ 旧数据无 `low` → 30；LWW：remote 新（low40）赢 / local 新（low50）赢；换端应用远端 low=80；非法 low 应用时归一（70→60）；本机 `zq_power_low_<sid>` 兜底、换账号隔离；`privacy.DEFAULTS.power = {sel:'',at:0,low:30}`。
- ✅ 与网站契约逐字节一致：web `sync_check.py` 期望 `"low": 30` 与 `power:{sel:"",at:0,low:30}`；网站源码含 `zq_power_low`/`rateFrom`/`estimate`/`≥30`/`aria-label="低电阈值"`。
- ✅ 阈值/环形/低电条/pill 全联动：低电条仅在 `q<low` 显示；环颜色/st pill 用同一 `stateOf`（低电红/偏低暖沙/充足雾青）。

## 3. v4 不回归 — PASS
区间 chips/本机记忆/5min 缓存、recharge/lastUp/「期间有充值」/上次充值 tile、tile2 随档、图例 dropLabel/起点文案、7d/30d 横滑 + 固定 y 轴 + x 覆盖层 + 真实时间比例 + 降采样上限 + canvas 物理宽 ≤5376、选择 sheet（0 请求/立即收起）、UD 13 键、诊断门限、TTL/force/失败降级：全部 PASS（`power_v5_check` 中 25 项 v4 用例原样复跑 + 新增 8 项 v5 用例；截图 04/05 系列与 v4 一致）。

## 4. 门禁（独立复跑，最终 v5 字节）
| 检查 | 结果 |
|---|---|
| `node unit.js` | **191/191 PASS** |
| `node v3_power_diag_tests.js` | **24/24 PASS** |
| `node sync_contract_test.js` | **30/30 PASS** |
| `python staticcheck.py` | **exit 0** |
| AI 三件套基线 | identity 31/31、homework 33/33、notice 32/32 PASS |
| `cli auto-preview` / `cli preview` | exit 0；**TOTAL 592,727 B（578.8 KB）单主包 = `_compile_info_off.json` 完全一致** |
| QA `static_scan.py --tag power_v5`（新增 v5 断言） | **80 项：PASS 79 / FAIL 0 / PEND 1**（PEND=包体/配置信息项）✅ |
| QA **`power_v5_check.js --tag power_v5`**（本任务新建） | **33 项：PASS 33 / FAIL 0** ✅ |
| QA `mp_sync_features_check.js`（适配 v5） | **40 项：PASS 39 / FAIL 0 / PEND 1**（quantity=null 边界信息）✅ |
| 既有 QA `mp_v2_check.js` | **47 项：PASS 47 / FAIL 0 / PEND 1** ✅ |

## 5. 截图目检（QA 独立看图结论）
- `02b_tiles_24h_estimate`：tile1 **估算可用 6.6 天** + 副标 **≈57.7 度/天**；tile2 近 24h 用电 48.0 度；tile3 **低电阈值 30 度（带 › 可点）**；tile4 上次充值「— / 暂无记录」。
- `06_low_panel`：面板 8 档（10/20/30/40/50/60/80/100），30 选中态、× 关闭、提示文案完整；无遮挡/溢出。
- `07_low50_warn`：阈 50 下 70.0 度 → pill **偏低**（暖沙环），符合 50≤70<100。
- `08_low50_low`：阈 50 下 40.0 度 → pill **低电**、低电条「剩 40.00 度 · 约 0.5 天」、红环小段，符合 40<50。
- 其余 24h/7d/30d/横滑后/充值徽标/上次充值/低电态截图均清晰，x 变 y 固定、无拉伸模糊。

## 6. 信息项（非阻塞）
1. `quantity=null` 边界：两端 `Number(null)=0`（无真实数据触发；建议数据侧保证非空）。
2. **aria**：网站有 `aria-label="低电阈值"` 等 aria；小程序仅在 sheet 关闭按钮用 `aria-*`，阈值/pill 未加 aria（不影响功能；如后续做无障碍可补）。
3. 截图设备 390 宽；360/430 布局规则未变（沿用 v3.1/v4 的自适应规则）。
4. 估算 rate 下限/≥30 等为产品既定口径；降采样等距取点已在此前说明。

## 7. 最终结论
**小程序电费 v5（估算算法 + 可调低电阈值）最终验收 = PASS，可交付（源码级；未上传/发布）。**
最终包体 **592,727 B** 与 `_compile_info_off.json` 完全一致；v4/v3.1 全部功能不回归；三层独立检查（`power_v5_check` / `static_scan` / `mp_sync_features` / `mp_v2_check`）与全部门禁全绿。

## 8. 复现
```powershell
cd C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools-tests
node unit.js; node v3_power_diag_tests.js; node sync_contract_test.js; python staticcheck.py
cd _qa_v2
python static_scan.py --tag power_v5
node power_v5_check.js --tag power_v5
node mp_sync_features_check.js --tag power_v5
node mp_v2_check.js --tag power_v5
cd ..\..\mp-class-tools && & "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto-preview --project . --auto-port 9420
```
证据：`_qa_v2/_reports/mp_power_v5_power_v5.json`、`mp_static_power_v5.json`、`mp_sync_features_power_v5.json`、`mp_v2_power_v5.json`、`_shots_power_sync/`。
