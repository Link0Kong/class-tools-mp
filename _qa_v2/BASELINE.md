# 小程序 v2.0.0 · 独立验收基线审计（改动前/集成中）

> 独立 QA（fresh context）· 审计时间 2026-11-05 18:45–19:15（Asia/Shanghai）
> 不启动模拟器、不访问真实云端、不发送订阅消息、不上传/发布。演示数据全虚构。
>
> 完整跨端基线与需求 4/5 复现结论见网页端 `web/tools/tests/_qa_v2/BASELINE.md`；
> 本文只记小程序侧。**注意：mp-dev 的 v2 改动自 17:44 已开始，工作区没有完整「改动前」副本**，
> 故基线 = 审计时刻（19:0x）的集成中状态 + 源码逐文件哈希清单锚点。

## 1. 锚点

- 源码哈希清单（308 个 `.js/.wxml/.wxss/.json`，排除 node_modules/cloudfunctions/images）：
  `_reports/mp_source_manifest_baseline.json`
- 被测项目：`C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools`
- 工具链：Node 24.21 / Python 3.12；微信开发者工具 automator 端口 9420 **可达**（mp-dev 会话）
- `automator_optional.js`（需 `$env:MP_AUTO_ALLOW="1"` 才接管，避免干扰他人会话）本次实跑 **4 PASS / 0 FAIL**：
  工作台可打开、课表定位第 9 周（`overflow=true, gridX=0/53`）、**真实触摸右滑 → 第 8 周**、0 console error。
  即需求 3「第 9 周 6 天溢出不再整周禁用滑动」在开发者工具真实触摸下也成立。
  默认运行（不加 MP_AUTO_ALLOW）为 SKIP，不会误伤他人会话。

## 2. 既有门禁基线（`python run_existing.py --tag baseline`）

| 命令 | 结果 | 摘要 |
|---|---|---|
| `node unit.js` | **PASS** | 123 passed / 0 failed（已含 v2 新单测；v1.5.3 时为 119） |
| `node sync_contract_test.js` | **FAIL** | 25 passed / 1 failed：`通知页：toggleDone 写 store.ntDone + marks ntdone… :: this._cardById is not a function` |
| `python staticcheck.py` | **PASS** | exit 0；handlers missing []（18 页、分享 handler/封面 0 缺失） |

> 那个 `sync_contract` FAIL 是 **mp-dev 重构进行中的瞬时状态**（同目录 `_backup_v2_20261105/` 为现场），
> 不是 v1.5.3 的既有缺陷；**终验必须全绿**，否则不能交付。日志：`_reports/existing_mp_baseline/`。

## 3. 独立验收脚手架基线

### 3.1 行为断言（`node mp_v2_check.js --tag baseline`）：46 项，**PASS 45 / FAIL 1 / PEND 1**

唯一 FAIL：**README / CHANGELOG 顶部未标 2.0.0**（`utils/version.js` 已是 2.0.0，文档待补）。
PEND：setData 体积/频率走查（信息项，轮换只更新 4 个小字段，代码核对通过）。

已 PASS 的 v2 能力（终验逐条复核）：
- 需求 1：`utils/version.js VERSION=2.0.0`、`app.js globalData.version`、「我的」页展示版本号；
- 需求 2：`utils/scrollmem.js` 完整 API；实例重建恢复（`pageScrollTo durtion:0`）、用户自己滚动则取消恢复、同实例不重复恢复；
- 需求 3：第 9 周周六有课 → `days=6 / _gridOverflow / _gridMaxX>0`；**左边缘右滑切上一周**、**右边缘左滑切下一周**、
  **边缘内横向手势让给表格滚动且不抑制点击**；5 天周 / 日视图 / 第 1 周回归；
- 需求 9：`recurrence` 解析、`nextTextOf`、不判过期不计待办、通知页长期安排徽标+下次时间；
- 需求 10：`demo.enter/exit`（sid=demo / 演示同学）、演示数据虚构、演示模式 0 真实请求、写操作本机成功、身份页入口/我的退出；
- 需求 11：`ROT_MS=5000`、`.26s/.32s`、>1 条才轮换、onHide 停止、实测 5s 后两卡 idx 前进 + out/in 帧、≤1 不轮换；
- 需求 12：`ntAdminRowId=auto_<gid>`、`ntAdminEdit → PATCH notices?id=eq.auto_<gid>`（override_json/edited_at/edited_by/X-Class-Token）、
  `ntAdminHide(true/false)`、非管理员本地拒绝 0 请求、override 白名单（null 清空该字段）、通知页解析 + 编辑弹层 + 已隐藏筛选；
- 需求 13：通知展开/收起 `.26/.28s` max-height 动画 + reduced-motion 关闭；工作台轮换 `.26/.32s` + 常驻浮动 + reduced-motion；
- 需求 14：`udSections.fit` 全字段；`udPush` blob 含 `fit.sex/grade` 且 `at.fit` 更新；远端 merge；
  **国标评分表页（fttable）切男女/年级 → store.fit → userdata PUSH → 重进保持 → 体测主页读同一份值**（Lead 指定口径，PASS）；
- 需求 16：`marksPull(force)` 强制读 + 写 `ntDone/hwDone`；TTL 内非 force 0 请求 / force 绕过；nt+hw 页 onShow `marksPull(true)`；
  离线 `markPend` → `flushPending` 补发；`setMark` 契约（id/seat/kind/ref/val/upsert Prefer）；
- 需求 5：无页面级 `catchtouchmove`；课表横向方向锁（12px / 1.35）。

### 3.2 静态合规/隐私/版本（`python static_scan.py --tag baseline`）：47 项，**PASS 42 / FAIL 2 / PEND 3**

- FAIL×2：README / CHANGELOG 顶部未标 2.0.0（同上，文档待补）。
- PEND×3：AI 开发模式配置存在（`app.json` agent + `ai/` 分包，**发版前必须 `python ai_toggle.py --off`**，源码保留）；
  需求 7「待获取」提示（plan 未把需求 7 列入小程序清单，信息项）；包体信息（1651.4 KB、appid `wx3df9869d229b96c4`、`urlCheck=false`）。
- 合规全部 PASS：`web-view` 0；无诱导分享/关注、抽奖、支付、外链下载 App、第三方导流关键词；
  无真实手机号/宿舍号/真实姓名/真实学号；无 `wx.cloud` 业务数据 API（仅 `cloudfunctions/notify` 订阅消息云函数）；
  无 appsecret/service_role/secretKey 实际值；反馈页不收集 QQ/微信联系方式；数据与隐私页含收集项/用途/存储说明。

## 4. 已知限制 / 风险

1. **真机未测 / 开发者工具仅冒烟**：`automator_optional.js` 已跑通 4/4（需 `MP_AUTO_ALLOW=1`，且开发者工具需在跑，
   端口 9420）；完整真实触摸回归仍以 `mp-class-tools-tests/tt_swipe_preview.js`（mp-dev 维护）为准；真机发版前人工复核。
2. **AI 开发模式**：源码保留是设计决定；上传前必须 `ai_toggle.py --off`（发布动作，交付说明列明）。
3. **`sync_contract_test.js` 瞬时 FAIL**：终验必须复跑全绿。
4. 小程序侧未做需求 7「待获取」提示（plan 未列入小程序清单）；如需要请 Lead 决策，否则按信息项记录。
5. 演示模式合规以「演示数据无真实隐私信息 + 网络层 0 真实请求」为验收标准（已自动化），
   微信审核口径仍需人工按交付说明核对（隐私指引/服务器域名等）。

## 5. 复现命令

```powershell
cd C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools-tests\_qa_v2
node mp_v2_check.js --tag baseline
python static_scan.py --tag baseline
python run_existing.py --tag baseline
node automator_optional.js            # 默认 SKIP；协调后可 $env:MP_AUTO_ALLOW="1"; node automator_optional.js
```

## 6. 状态更新（19:2x 复查，非基线，仅记录进展）

基线审计（19:0x）之后 mp-dev 继续提交，复查结果：

| 项 | 基线（19:0x） | 复查（19:2x） | 说明 |
|---|---|---|---|
| README / CHANGELOG 顶部 2.0.0 | FAIL | **PASS** | 已更新为 `v25 / 2.0.0`、CHANGELOG `## 2.0.0` |
| 需求 7「待获取」提示（小程序侧，Lead 补充） | PEND（未实现） | **PASS** | `nt.wxml` 徽标 + `nt.js filePending` 点击提示「前往 QQ 群「<群名>」查看；下载后会自动上线」+ 复制群名 |
| `mp_v2_check.js` | 45 PASS / 1 FAIL / 1 PEND | **47 PASS / 0 FAIL / 1 PEND** | 已含需求 7 正式断言 |
| `static_scan.py` | 42 PASS / 2 FAIL / 3 PEND | **45 PASS / 0 FAIL / 2 PEND** | PEND = AI 发布动作、包体信息 |
| `node unit.js` | 123/0 | **150/0** | 新增 v2 单测 |
| `node sync_contract_test.js` | 25/1（`_cardById`） | **29/0 PASS** | 瞬时 FAIL 已修复 |
| `python staticcheck.py` | PASS | PASS | handlers missing [] |

> 结论：小程序 v2 源码在 19:2x 已基本完整；**终验只需等 Lead 的「最终源码冻结」信号后整体复跑**（以本节命令为准，
> 数字以终验那次为准）。基线 FAIL 项（文档版本号、需求 7）现已全部翻绿，可作为终验 PASS 的先行证据。
