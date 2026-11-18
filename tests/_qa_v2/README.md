# 班级工具站小程序 v2.0.0 · 独立验收脚手架

> 独立 QA（fresh context）维护，不参与实现。所有测试用一个内存 `wx` mock 跑在 Node 里
> （不启动模拟器、不访问真实云端、不发送订阅消息、不上传/发布）。**审核/演示模式已按用户 2026-11-05 20:07 指示移除**，
> 相关断言改为「不存在」校验；其余契约/行为测试数据为虚构。

## 1. 目录与文件

| 文件 | 作用 |
|---|---|
| `mp_v2_check.js` | **主验收脚本**（Node + wx mock）：版本 / scrollmem 滚动保位 / 第 9 周课表滑动 / 长期安排 / 审核模式已移除 / 工作台轮换 / 管理员编辑删除 / 动画降级 / 体测同步（含国标表页）/ marks 同步 |
| `mp_sync_features_check.js` | **task-13 增量验收**（Node + wx mock，独立于 mp-dev v3 测试）：电费页（0 请求/URL 契约/状态阈值/TTL/失败降级/离线兜底/隐私）+ 诊断页（管理员门限/13 项/离线降级/课表快照兜底/60s 定时器）+ UD v6 13 键契约（顺序/镜像/LWW/v5 迁移/推送 blob）+ 与网站 PW_ROOMS/UD_KEYS/sync_check 只读交叉核对 |
| `static_scan.py` | 源码合规 & 隐私 & 版本 & AI 开发模式 **静态扫描**：web-view / 诱导分享 / 抽奖 / 支付 / 外链下载 / 第三方导流 / 真实隐私数据 / 版本号 / README 标注 / AI 配置 |
| `run_existing.py` | 既有门禁复跑：`node unit.js`、`node sync_contract_test.js`、`python staticcheck.py`（`--with-ai` 附带 AI 侧信息项） |
| `automator_optional.js` | 开发者工具 automator 可选回归：连不上（未 `cli.bat auto`）时 **SKIP 不失败**，连上后跑触摸/页面冒烟 |
| `_reports/` | 结果 JSON + 既有门禁原始日志 |
| `REPORT_SYNC_FEATURES.md` | task-13 增量验收报告（电费/诊断/UD 13 键；含 PEND 收口 §9） |
| `REPORT_POWER_UI.md` | task-15 验收报告（宿舍选择 bottom-sheet + 趋势 canvas 折线；含截图目检/触控尺寸/DPR 证据） |
| `REPORT_POWER_V4.md` | task-19 **阶段报告**（电费 v4：区间/横滑/固定 y 轴/x 覆盖层/真实时间比例；最终结论以 v5 为准） |
| `power_v4_check.js` | task-19 独立 v4 验收脚本（横滑宽/固定轴/时间比例/上限/区间历史契约/回归，25 项） |
| `power_v5_check.js` | **任务 21 最终验收脚本**（v5 估算 rateFrom/estimate fixture、可调低电阈值 UD.power.low/边界/面板、v4 全量回归+网站契约，33 项） |
| `REPORT_POWER_V5.md` | **task-21 最终验收报告**（电费 v5：估算算法 + 可调低电阈值；包体 592,727；最终 PASS） |
| `BASELINE.md` | 改动前基线审计结论与复现命令 |

依赖：Node 24（仅内置模块）、Python 3.12。被测项目：`C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools`。

## 2. 运行命令

```powershell
cd C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools-tests\_qa_v2

node mp_v2_check.js --tag final      # 主验收（退出码 0 = 全绿）
python static_scan.py --tag final    # 静态合规/隐私扫描
python run_existing.py --tag final   # 既有门禁（unit / sync_contract / staticcheck）

# 基线（在 v2 集成的冻结点上跑同一套命令，留存对照）
node mp_v2_check.js --tag baseline
python static_scan.py --tag baseline
python run_existing.py --tag baseline

# 可选：开发者工具 automator（先启动工具并 auto 连上，否则 SKIP）
& "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto `
  --project "C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools" --auto-port 9420 --trust-project
node automator_optional.js
```

## 3. 需求 ↔ 验收项映射

| 需求 | 验收项（`mp_v2_check.js` / `static_scan.py`） | 判定标准 |
|---|---|---|
| 1 版本 2.0.0 | `version.js VERSION=2.0.0`；`app.js globalData.version`；「我的」页展示；README/CHANGELOG 顶部 | 四处一致；docs 顶部必须出现 2.0.0 |
| 2 滚动保位 | `scrollmem` API 完整；页面实例重建后 `wx.pageScrollTo({duration:0})` 恢复；用户自己滚动则取消恢复；同一实例不重复恢复；11 页接入 | 行为断言全过 + 11 页静态接入 |
| 3 第 9 周课表滑动 | 第 9 周周六有课 → `days=6`、`_gridOverflow=true`、`_gridMaxX>0`；**左边缘右滑 → 切上一周**（不再整周禁用）；**左边缘左滑 → 让表格滚动不切周**；**右边缘左滑 → 切下一周**；5 天周/日视图回归；第 1 周边界只回弹 | 逐项行为断言；溢出判定公式 `96+N×colW>630rpx` |
| 5 滑动卡死审计 | 页面无全局 `catchtouchmove`；课表横向手势方向锁（12px / 1.35 比例） | 静态断言 |
| 7 文件待获取（Lead 补充两端一致） | `mp_v2_check.js` / `static_scan.py`：file 无 url → 「待获取」徽标 + 点击提示含群名（复制群名） | 模板/提示断言 |
| 9 长期安排 | `recurrence` 解析、`nextTextOf`（含周X/时间）、不判过期、不计待处理；通知页展示徽标+下次时间 | 单元 + 静态 |
| 10 审核/演示模式移除（用户 20:07 指示） | `utils/demo.js`/`demo-data.js` 不存在；身份页/「我的」无演示入口与文案；cloud/store/notify 无 demo 拦截/演示桶；README/CHANGELOG 写明「不实现审核模式」；源码 0 处演示数据 | 静态 + 文件存在性断言 |
| 11 工作台轮换 | `ROT_MS=5000`、`.26s/.32s`、>1 条才轮换、onHide 停止；实际 5s 后两卡 `idx` 前进且 `anim=out→in`；≤1 条不启动 | 行为断言（真实等 6s） |
| 12 管理员编辑/删除/恢复 | `ntAdminRowId=auto_<gid>`；`ntAdminEdit` → `PATCH notices?id=eq.auto_<gid>` + `override_json/edited_at/edited_by` + `X-Class-Token`；`ntAdminHide(true/false)`；非管理员本地拒绝且 0 请求；`override_json` 白名单（null 清空该字段）；通知页解析 hidden/override + 编辑弹层 + 「已隐藏」筛选仅管理员 | 契约断言 + 静态 |
| 13 动画/减动效 | 通知展开/收起 `max-height` 动画 `.26/.28s`；index 轮换 `.26/.32s` + 常驻浮动；三处 `prefers-reduced-motion` 降级（animation:none） | 静态样式断言 |
| 14 体测同步 | `udSections().fit` 含全部字段（sex/grade/…）；`udPush` blob 含 `fit.sex/grade` 且 `at.fit` 更新；远端 merge 覆盖；ft 页 onShow 拉取应用；**国标评分表页（fttable）切换男女/年级 → `store.fit` 更新 → userdata PUSH blob 同步 → 重进保持 → 体测主页读同一份值**（Lead 指定最终口径） | 行为断言 |
| 15 性能 | setData 轮换只更新 4 个小字段（代码走查，信息项）+ 既有回归全绿（`run_existing.py`） | 信息项 + 门禁 |
| 16 通知/作业同步 | `marksPull(force)` 强制 GET + 写入 `ntDone/hwDone`；TTL 内非 force 0 请求、force 绕过；nt/hw 页 onShow `marksPull(true)`；离线 `markPend` → `flushPending` 补发；`setMark` 契约（id/seat/kind/ref/val/upsert Prefer） | 行为 + 契约断言 |
| 合规 | `static_scan.py`：web-view 0；无诱导分享/关注、抽奖、支付、外链下载 App 关键词；第三方导流；真实手机号/宿舍号/真实姓名/真实学号 0；无 `wx.cloud` 业务数据 API（仅 notify 云函数）；无 appsecret 实际值；反馈页不收集联系方式 | 全部 PASS（信息项除外） |
| AI 开发模式 | `app.json` **已 off**（无 agent/subPackages）；`ai/` 源码保留；上传前保持 off（`ai_toggle.py --status` 核对） | PASS（发布动作项，交付说明须列明） |
| 既有门禁 | `run_existing.py`：unit / sync_contract / staticcheck | 全绿 |

## 4. 判定说明

1. **wx mock 隔离**：`global.wx` 内存 storage/request；`utils/cloud.js` 的 `request()` 只走 mock，测试可断言请求
   URL/method/body/header；任何真实网络都无法发生。审核/演示模式已移除，改为断言「相关文件/入口/代码不存在」。
2. **行为优先**：页面/模块通过 `global.Page` 捕获定义 + 自建 ctx（`setData` 记录调用）驱动，不依赖模拟器。
   动画时长这类纯样式用静态断言（与 `wxss` 直接对照），并在 README 写明。
3. **契约对齐 plan**：
   - `override_json` 白名单 `{title,cat,summary,aiSummary,deadline,eventAt,expireAt,timeLabel}`，`null`/`''` = 清空该字段；
   - `hidden` 软删除，管理员可恢复，采集重建不复活；
   - `marks`：`id=<sid>|kind|ref`、`seat=sid`、`val` 布尔、upsert（无 DELETE）；
   - `userdata` v6：`fit` section 含 `sex`/`grade`，逐 section `at` 时间戳合并（同 at 云端赢）。
4. **automator 可选（安全闸）**：`automator_optional.js` 默认 SKIP（避免干扰正在进行的开发者工具会话）；
   协调后 `$env:MP_AUTO_ALLOW="1"; node automator_optional.js` 接管冒烟（工作台 / 课表第 9 周 / 真实触摸右滑切周 / console error）。
   完整真实触摸回归仍以 `mp-class-tools-tests/tt_swipe_preview.js`（mp-dev 维护）为准；发版前需真机人工复核。

## 5. 基线/终验结果

- 基线：见 `BASELINE.md` 与 `_reports/mp_v2_baseline.json`、`_reports/mp_static_baseline.json`、`_reports/existing_mp_baseline.json`。
- 终验：按 **`FINAL_CHECKLIST.md`** 执行——`node mp_v2_check.js --tag final` 退出码 0 +
  `python static_scan.py --tag final` 无 FAIL + `run_existing.py --tag final` 全绿。
- 基线→复查状态：`BASELINE.md` §6（文档版本号、需求 7、sync_contract 瞬时 FAIL 在 19:2x 已全部翻绿）。
