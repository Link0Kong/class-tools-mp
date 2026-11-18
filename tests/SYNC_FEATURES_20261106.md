# 小程序 v2.0.0 · 网站功能同步说明（宿舍电费 v5 + 管理员诊断）

> 日期：2026-11-06
> 用户需求：「同步网站和微信小程序的功能」→ **网站 → 小程序**（以网站为准），诊断页也进小程序、仅管理员可见。
> 本轮对齐网站最终版：网站 **532,533 B · sha256 `e38bddcf…`**（电费 v5，2026-11-06 07:49 上线，08:00 后未再变）。
> 小程序：**592,727 B（578.8 KB）单主包**；版本 **2.0.0**（用户要求：下次成功上传发布前不改版本号）；**AI 开发模式 off**；本轮**未上传/未发布**。

---

## 一、本次交付（网站 → 小程序）

| 网站功能 | 小程序实现 |
|---|---|
| 宿舍电费 v5（关注宿舍 / 电量 / 24h·7天·30天趋势 / 估算可用 / 可调低电阈值 / 上次充值） | `pages/power/*` + `utils/power.js`；17 间宿舍目录与网站逐项一致；数据读 `public.power` + `public.power_history`（auth_ok），阈值随账号同步 |
| 关注宿舍 + 低电阈值随账号同步 | userdata v6 `power={sel,at,low}`，顶层 **13 键**不变，与网站逐字节一致；旧数据无 low→30；LWW 按 at |
| 管理员「诊断」页（`public.service_health`） | `pages/diag/*` + `utils/diag.js`，仅管理员可见/可请求；4 组 13 项、延迟覆盖、采集主机离线降级、课表快照兜底、60s 刷新 |
| 通知时间显示与识别修复 | 此前已同口径同步（`utils/notice.js`、`pages/nt`），本轮回归通过 |
| 「全部」页入口 | `tools.js` 新增 `power`（普通、不进首页快捷栏）与 `diag`（admin:true，规则同统计） |

### 用户反馈问题的修复
- **宿舍选择异常**（原生 multiSelector 第二列把每栋房间拼成「305 室,306 室…」）：彻底移除原生 picker，改为**自定义底部弹层**：楼栋 pill 分段 → 房间网格（2–4 列、44px 触控）→ 点房间立即选中并收起；遮罩/×/取消可关；360/430 无横向溢出。
- **趋势改折线图**：canvas 2D 折线（面积渐变 + 2 条网格 + 末点 + 固定 y 轴 3 刻度 + 固定 x 轴覆盖层 + 真实时间比例 x）；24h 不横滑、7天/30天可左右横滑。

### 与网站 v5 对齐的关键口径
- **三档区间** 24h / 7天 / 30天：title/tile/dropLabel/x 刻度数（3/4/5）逐项一致；默认 24h，本机记忆 `zq_power_range_v1`（不进 UD）。
- **历史请求**：`power_history?select=ts,quantity&roomverify=eq.<rv>&ts=gte.<窗口>&order=ts.asc&limit=2000`；每档 5 分钟缓存；**恒拉 24h+7d** 用于估算（30d 档再拉 30d）；未选择宿舍 0 请求。
- **估算可用**：`rateFrom` 分段统计（充值跳变整段跳过、持平日只计时长）→ 24h/7d 速率 **0.65/0.35 混合**、rate 下限 0.05、`days=q/rate`；≥30 天显示「≥30」并满环；tile 副标 `≈ rate 度/天`；环/低电条/aria 全用该估算。
- **可调低电阈值**：默认 30，档位 `[10,20,30,40,50,60,80,100]`；点「低电阈值」tile 弹 8 档面板，选中立即生效并随账号同步；判定 `q<low` 低电 / `low≤q<low*2` 偏低 / 其余充足。
- **上次充值 / 期间有充值**：历史跳变（`q[i]-q[i-1]>0.05`）的最后一次重置度数 + 时间；tile4「上次充值」；趋势标题旁「期间有充值」徽标。
- 状态阈值说明：状态由**用户低电阈值 low** 决定（低电 <low、偏低 <2×low、其余充足），不再固定 30/60。

---

## 二、验证结果

| 门禁 | 结果 |
|---|---|
| **独立 QA 最终验收（v5）** | **PASS，0 FAIL**（报告 `_qa_v2/REPORT_POWER_V5.md`：估算 fixture、阈值契约、v4 回归、包体/截图） |
| 功能 QA（task-13） | PASS 0 FAIL（电费页 / 诊断页 / 13 键契约 / 隐私 / 管理员门限） |
| `node unit.js` | **191 / 191 PASS** |
| `node v3_power_diag_tests.js` | **24 / 24 PASS** |
| `node sync_contract_test.js` | **30 / 30 PASS**（含 power low 推送/迁移/换端） |
| `python staticcheck.py` | **exit 0**（20 页、handlers/分享 handler 0 缺失） |
| AI 三件套（AI off 基线） | ai_unit_all 8/8（296 项）、ai_contract 92 PASS/0 FAIL/5 PEND、ai_eval 14/14 |
| 微信开发者工具 `cli auto-preview` | **TOTAL 592,727 B（578.8 KB）单主包**，无 AI 分包；= `_compile_info_off.json` |
| 媒体资源预算 | 37 PNG = **109,337 B**（硬线 200 KB） |
| QA 脚手架 | `static_scan` 80 项 79 PASS/0 FAIL/1 PEND；`power_v5_check` 33/33；`mp_sync_features` 40/39/0/1；`mp_v2_check` 47/47 |
| 自动化预览 | `power_preview.js` 16/16 PASS、390 宽、0 console error；截图 14–15 张（`_shots_power_sync/`） |

关键截图（工作区）：`_shots_power_sync/02b_tiles_24h_estimate.png`（估算 tile + 阈值可点）、`06_low_panel.png`（8 档阈值面板）、`07_low50_warn.png`（阈值 50 → 偏低）、`08_low50_low.png`（阈值 50 → 低电）、`04_trend_7d.png`/`04c_trend_7d_scrolled.png`（7 天横滑前后）、`05_trend_30d.png`、`01_sheet_open.png`/`01b_sheet_23A.png`（选择弹层）、`02_dashboard_trend_24h.png`、`03_low.png`。

---

## 三、已知限制（不影响交付）

1. 桌面端比例 UI 优化属网站专属（大屏排布），小程序不适用；网站仍是电费/诊断主实现。
2. 7天/30天趋势：小程序用 `scroll-view` 包超宽 canvas（网站为固定 canvas + 滚动代理）；固定双轴、时间比例、可见窗口刻度、降采样（7d≤170/30d≤240）行为一致，**无网站式横向拖动惯性差异**（原生 scroll-view）。
3. 诊断页 `site_tls` 证书小程序读不到，仅展示云端上报行；`site_static` 用本机课表快照兜底。
4. `public.power.quantity = null` 不在产品路径（数据侧保证非空；两端按 0 防御性兜底）。
5. 低电阈值档位不含 70/90（与网站一致）；远端传入非档位值会就近归一（70→60、90→80）。
6. 无障碍：阈值面板/pill 的 aria 小程序未全量添加（仅 sheet 关闭按钮有），后续可补。
7. AI 元数据 `agent/page-meta.json` 仍 18 页：AI 关闭不影响发版；**日后重开 AI 开发模式前需补 power/diag 两页**。
8. 网站若后续继续改版（v6+），小程序需按同一数据契约（`public.power` / `public.power_history` / `userdata.power`）再对齐。

---

## 四、上传/发布步骤（待用户操作）

1. 微信开发者工具导入 `C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools`；
2. 确认 `utils/version.js` = **2.0.0**、`app.json` AI off（`python ai_toggle.py --status`）；
3. 上传版本 2.0.0（备注：功能同步：宿舍电费 + 管理员诊断）；
4. 审核账号：**学号 3260799999 / 姓名 测试账号**（云端 `is_test` 身份，不在班级名单/统计显示）；
5. 提审前确认云端隐私保护指引补充：「关注宿舍（电费）仅本人可见、不导出」「低电阈值随账号同步」。
6. 回滚：本次未改数据库表/RLS/云函数；小程序回滚 = 回退到微信后台上一线上版本。

---

## 五、相关报告与证据

- QA 最终验收（v5）：`mp-class-tools-tests/_qa_v2/REPORT_POWER_V5.md`
- QA 阶段报告：`REPORT_POWER_V4.md`（阶段）、`REPORT_POWER_UI.md`、`REPORT_SYNC_FEATURES.md`
- 编译信息：`mp-class-tools-tests/_compile_info_off.json`（592,727 B）
- 截图：`mp-class-tools-tests/_shots_power_sync/`
- 文档：`mp-class-tools/README.md` §2.1、`CHANGELOG.md` 顶部章节、`mp-class-tools-tests/README.md`
