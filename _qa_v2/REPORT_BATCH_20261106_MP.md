# 小程序 task-30 终验报告（第 2/5/6/9 项 · 2026-11-06 晚）

> 独立 QA（qa）· 2026-11-06 22:10–22:35 · task-30（小程序部分）
> 对象：mp-dev task-28 完成后的本地源码（版本 2.0.0 / AI off）；**未上传、未部署、未改产品代码**。
> 方法：**miniprogram-automator + mp.screenshot**（未使用 pyautogui/屏幕操作，未使用 preview/auto-preview 推手机）。
> 相关 web 报告：`web/tools/tests/_qa_v2/REPORT_BATCH_20261106.md`。

## 2) 小程序电费趋势（点击/拖动/无横滑）— PASS
- ✅ automator 独立执行 `power_preview.js`：**30 PASS / 0 FAIL / 0 console error**（windowWidth=390）。
- ✅ **点击 3 个位置**：游标竖线+圆点+信息正确显示
  - `10-31 17:08 · 电量 682.96 度`（24h/7d 左段）
  - `11-03 13:35 · 电量 547.16 度`（中段）
  - `11-06 03:48 · 电量 475.90 度`（右段）
  - 截图：`_shots_power_sync/04c_cursor_7d_1.png`、`04c_cursor_7d_2.png`、`04c_cursor_7d_3.png`（QA 已逐张目检：竖线/圆点/信息条位置随点击移动，刻度不遮挡）。
- ✅ **拖动**：`_shots_power_sync/04d_cursor_7d_drag.png` 显示拖动后游标更新为 `11-05 15:22 · 电量 538.49 度`，松手保留、页面不滚动（automator 断言 scrollTop 不变）。
- ✅ **无 scroll-view / 无横滑提示**：页面查询 `scroll-view=0`、`pw-plot-scroll` 代理=0；wxml 无 `<scroll-view>`；`chartW === cw`（289.67=289.67，全量铺满）；无 `trend.hint`。
- ✅ canvas 不越绘图区：canvas 实测宽 = 绘图容器宽，页面级横向溢出探测 0 项（`right ≤ windowWidth`）。
- ✅ 区间 24h/7d/30d：标题/图例/3·4·5 x 刻度/充值徽标/上次充值 tile 正确；30d 拖动游标更新且松手保留；空态（0 采样）不显示游标、显示「数据积累中」。
- ✅ 页面交互回归：低电阈值面板 8 档、阈值 50 时 70 度偏低/40 度低电、慢更新徽标、工作台电费卡、320–667 宽度兜底不溢出（automator 30 项覆盖）。

## 5) 使用说明（小程序侧）— PASS
- ✅ `perf_ug_preview.js` automator：UG 条目 **16 个**，含 `power`（电费趋势点击/拖动/不横滑）、`ntattach`（QQ/微信附件/压缩包）、`powercard`、`water`（水量抄表）、`share` 等新功能；UG 页无横向溢出（390 宽，overflow=[]）。
- ✅ 与网页 `#s-ug` 关键词矩阵交叉核对通过（电费趋势查看/水量抄表/全部页拖动排序/通知附件，两端均覆盖；详见 web 报告 §5）。

## 6) 首屏渲染时序/请求数（小程序）— PASS
- ✅ automator 首屏时序：**firstScreen=3877ms**（含 reLaunch 重试 overhead；cold start 含模拟器开销，非线上真机绝对值）。
- ✅ 首屏 250ms 内云请求 **2 个**（marks / notices），其余请求延后（WARM_MS 后），**无首屏阻塞**；0 console error。
- ✅ 页面切换无异常（automator reLaunch/切换；无白屏/报错）。

## 9) 全量回归（小程序）— **PASS（1 项测试债）**
| 检查 | 结果 |
|---|---|
| `v3_power_diag_tests.js` | **41/41 PASS** |
| `sync_contract_test.js` | **31/31 PASS** |
| `staticcheck.py` | **exit 0** |
| AI 三件套 | identity 31/31、homework 33/33、notice 32/32 PASS |
| automator `power_preview.js` | **30/30 PASS**，0 console error |
| automator `perf_ug_preview.js` | **6/6 PASS**，0 console error |
| `unit.js` | **227 passed / 2 failed** ⚠️（见下） |
| `tool_sort_preview.js` | 未执行：脚本要求独立自动化实例 `ws://127.0.0.1:9436`，本轮 devtools 只开 9420 实例；属环境限制，不计 FAIL |

### unit.js 2 项失败（**测试桩过期，需 mp-dev 修复**；非功能回归）
1. `power 页：趋势 canvas 2d 绘制（DPR 缩放/面积渐变/折线/2 网格/末点）与 <2 点不画` — 断言 `44 !== 0`：
   task-28 在 21:47 改动 `pages/power/power.js`（canvas 重试/绘制路径），unit.js 停在 20:47 的 mock；单测 mock 里 canvas ops=0。automator 真机窗口 `canvasDrawn=true`、`linePoints≥2`，功能正常。
2. `power 页：趋势区间 chips 24h→7天→30天（fetch 契约/5min 缓存/标题 tile 图例 x 刻度/本机记忆）` — 断言 `3 !== 1`：
   单测 mock 未提供 30d history 路由 → v9 自动重试增加请求；automator 中区间切换/缓存行为 PASS。
- 证据：`unit.js` mtime 20:47:54 < `pages/power/power.js` mtime 21:47:53；建议 mp-dev 更新 unit mock/期望后重跑（不影响本轮功能结论）。

## 结论
**小程序部分（第 2/5/6/9 项）功能验收 PASS**：电费趋势点击/拖动/无横滑、使用说明、首屏时序与请求优先级、v3/sync/staticcheck/AI/automator 全绿。
唯一遗留：unit.js 2 项因 task-28 后单测桩未同步而失败（测试债，建议 dev 修）；tool_sort_preview 因无 9436 自动化实例未跑。


---

## 附录：最终 delta 复核（2026-11-06 22:5x，测试桩修复后）
- ✅ `unit.js` 独立复跑 **2 次连续 229/229 PASS**（0 failed）。
- ✅ `v3_power_diag_tests.js` **41/41 PASS**、`sync_contract_test.js` **31/31 PASS**、`staticcheck.py` **exit 0**。
- ✅ automator `power_preview.js`（重启 devtools auto 后）**30 PASS / 0 FAIL / 0 console error**：点击/拖动游标、无 scroll-view、铺满、无溢出、30d/低电/慢更新均通过。
- ✅ 产品零改动（本次 delta 仅测试桩修复）；包体 652,076B 由 mp-dev 提供，本轮未上传。
- ℹ️ `tool_sort_preview.js` 的 31/31 由 Lead/mp-dev 以临时 WS 副本执行；QA 本轮未重复跑（不影响本轮 delta 结论）。
