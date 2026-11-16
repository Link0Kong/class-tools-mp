# v2.0.0 终验待验清单（小程序 · final acceptance checklist）

> 用法：Lead 发出「mp 最终源码冻结」信号后按序执行，结果写入 `mp-class-tools-tests/_qa_v2/REPORT.md`。
> 不启动模拟器（除 automator 可选冒烟，需协调且加 `MP_AUTO_ALLOW=1`）；不访问真实云端写入、不上传发布。

## A. 冻结确认

- [ ] 记录 mp 最终源码清单哈希（与 `_reports/mp_source_manifest_baseline.json` 对比：
      `python -c` 重算见 BASELINE.md；差异文件应全部属于 v2 改动）
- [ ] `utils/version.js` = `2.0.0`；`app.js globalData.version` 引用它；「我的」页展示
- [ ] `README.md` / `CHANGELOG.md` **顶部**已标注 v2.0.0（基线 FAIL 项，终验必须 PASS）
- [ ] 确认 AI 开发模式处理：`app.json` agent/`ai/` 源码保留；**上传发布前必须 `python ai_toggle.py --off`**
      （`python ai_toggle.py --status` 核验；此条为发布动作，报告中单列）

## B. 必跑命令与通过标准

```powershell
cd C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools-tests\_qa_v2
node mp_v2_check.js --tag final       # 通过标准：FAIL 0（PEND 仅允许信息项）
python static_scan.py --tag final     # 通过标准：无 FAIL（PEND 允许：AI 发布动作、包体信息）
python run_existing.py --tag final    # 通过标准：unit / sync_contract / staticcheck 全部 PASS
# 可选（与 Lead/mp-dev 协调开发者工具空闲时）：
$env:MP_AUTO_ALLOW="1"; node automator_optional.js
```

- [ ] `mp_v2_check` FAIL=0；记录 PASS/PEND 数
- [ ] `static_scan` 无 FAIL（基线 2 个 README/CHANGELOG FAIL 应翻绿）
- [ ] `run_existing`：`unit.js` 全过、**`sync_contract_test.js` 全过（基线曾 25/1，必须翻绿）**、`staticcheck.py` exit 0
- [ ] automator（可选）：页面渲染 + 第 9 周真实触摸右滑切周 + 0 console error（或明确记录环境 SKIP）

## C. 逐需求「基线待验 → 终验必 PASS」清单

- [ ] 需求 1：版本 2.0.0 四处一致（version.js / app.js / 我的页 / README+CHANGELOG 顶部）
- [ ] 需求 2：scrollmem 11 页接入 + 重建恢复/取消/不重复行为断言全过
- [ ] 需求 3：第 9 周 6 天溢出（`_gridOverflow=true, _gridMaxX>0`）下：左边缘右滑切上一周 / 右边缘左滑切下一周 /
      非边缘让表格滚动不抑制点击；5 天周、日视图、第 1 周边界回归全过；automator 真触摸证据（可选）
- [ ] 需求 5：无全局 catchtouchmove；课表方向锁；滚动/弹层路径无卡死（结合需求 2 断言）
- [ ] 需求 7（Lead 补充）：**通知卡 file 无 url → 「待获取」徽标 + 点击提示含群名**（两端一致）
- [ ] 需求 9：长期安排徽标 + 下次时间；不判过期/不计待处理
- [ ] 需求 10（用户 20:07 新指示）：**审核/演示模式已移除**——demo.js/demo-data.js 不存在、身份页/我的无入口文案、cloud/store 无 demo 拦截、README/CHANGELOG 已清理 + 合规清单
- [ ] 需求 11：工作台两卡同时展示；5s 轮换 + .26/.32s + 常驻浮动 + onHide 暂停 + ≤1 不轮换 + reduced-motion
- [ ] 需求 12：管理员编辑/删除/恢复（PATCH 契约、非管理员拒绝、override 白名单、已隐藏筛选仅管理员）
- [ ] 需求 13：通知展开/收起动画 + reduced-motion 降级（样式断言）
- [ ] 需求 14：`udSections.fit` 全字段；PUSH blob fit；merge；**国标评分表页 fttable 切男女/年级 → store.fit →
      userdata PUSH → 重进保持 → 体测主页同值**（Lead 指定口径）
- [ ] 需求 15：setData 轮换局部更新（代码走查信息项）+ 既有回归全绿
- [ ] 需求 16：marks 强制拉取 / TTL / onShow marksPull(true) / 离线 markPend 补发 / setMark 契约
- [ ] 合规/隐私：web-view 0；无诱导分享/关注/抽奖/支付/外链下载/第三方导流；无真实手机号/宿舍号/真实姓名/真实学号；
      反馈页不收集联系方式；`wx.cloud` 仅 notify 云函数；无 appsecret 实际值
- [ ] 隐私指引入口（我的 → 数据与隐私）文案与代码一致；服务器域名/`urlCheck` 上传前核对（发布动作）

## D. 交付说明必备项（写进 REPORT.md，供用户上传发布）

- [ ] 版本 2.0.0、包体大小、`cli auto-preview` 编译结果（由 mp-dev 提供，QA 复核数值）
- [ ] 上传前：`python ai_toggle.py --off`（关闭 AI 开发模式，源码保留）；上传后如需评测再开
- [ ] 服务器域名：`tool-d4gosudok46e0e081.api.tcloudbasegateway.com`、`tool.furina.fun`（未变）
- [ ] 隐私指引：学号+姓名（身份校验）；数据与隐私页口径；不采集手机号/证件/位置
- [ ] 真机复核建议：第 9 周课表滑动、通知页滚动、工作台轮换、导出图

## E. 结论

- [ ] 16 条需求逐条 PASS/FAIL 表 + 证据（命令输出/JSON/截图）
- [ ] 独立结论：「是否可交付（源码 + 发布说明）」
- [ ] 过程数据清理建议（`_reports/final`、`_shots` 保留；其余由 Lead 决定）

## v2.0.0 网站功能同步（电费 / 诊断 / UD 13 键，2026-11-06 task-13）

- [ ] `app.json` 20 页含 `pages/power/power`、`pages/diag/diag`；tools 中 power `noHome`、diag `admin`
- [ ] 电费页：未选择 0 请求；选择后只请求该房间 `power?id=eq.<rv>` + `power_history(24h/order/limit=500)`；状态阈值/趋势/4 tiles/低电/刷新/下拉/TTL 2min/失败降级/离线兜底
- [ ] 电费隐私：无姓名/学号/手机号/全班名单；不导出（`buildExport` 无 power）；数据隐私页声明
- [ ] 诊断页：仅管理员（三层门限 + cloud 守卫，非管理员 0 请求）；4 组 13 项；cloudbase 延迟覆盖；主机 15min 离线降级；site_static/jwxt 课表快照兜底；60s 刷新且 onHide 停
- [ ] UD v6：13 顶层键顺序（power 在 nick 后）、at 10 section、power.at 镜像、LWW、v5 迁移、推送 blob；与 web `sync_check.py` 期望逐字节一致
- [ ] 门禁：`unit.js` 182/182、`sync_contract 30/30`、`staticcheck.py` exit 0、AI 三件套、`cli auto-preview` exit 0；包体实测（devtools preview）572,945 B 单主包、媒体 37 PNG 109,337 B、版本 2.0.0、AI off
- [ ] PEND 处理：①网站 `PW_WARN=60` vs 小程序 `100` 阈值口径统一；②mp-dev 包体/unit 数字按 07:15 快照刷新

## 电费 UI 重做 + 趋势折线图（2026-11-06 task-15）

- [ ] 全库无 `multiSelector`/`<picker`（电费选择）残留；power 页面为自定义 bottom-sheet（遮罩/标题/楼栋 pill/房间网格/取消/safe-area）
- [ ] 房间目录分组：13号楼 324/308、16号楼 305/306、23A 321/323–330（9）、23B 422–425（4）
- [ ] 开弹层/切楼栋/取消 0 请求；点房间立即选中并收起、只请求该房间、UD.power 13 键不回归
- [ ] 触控区：房间按钮 88rpx（360≈42.2px / 390≈45.8px）、取消 96rpx；360/430 无横向溢出（WXSS 自适应规则 + 截图目检）
- [ ] 趋势：`<canvas type="2d" id="pwTrend">`、柱状 DOM 已移除；≥2 点画面积/折线/2 网格/末点/DPR 缩放；<2 点「数据积累中」不画；刷新/切宿舍重绘；390 截图清晰无拉伸
- [ ] 门禁：unit 184/184、v3 17/17、sync_contract 30/30、staticcheck exit 0、AI 三件套、cli preview 579,567 B = `_compile_info_off.json`；QA static_scan 72 项 0 FAIL

## 电费 v4 最终版（2026-11-06 task-19）

- [ ] 三档区间 chips（默认 24h/本机 `zq_power_range_v1`/不进 UD）；history `select=ts,quantity&limit=2000&order=ts.asc&ts=gte` 每档 5min 缓存；估算可用/环/低电条用 24h
- [ ] 24h 不横滑且铺满；7d/30d 内容宽>容器可横滑、隐藏滚动条、切档/换房 scrollLeft 归零；x 按真实时间比例；降采样 7d≤170/30d≤240；canvas 物理宽≤5376
- [ ] 固定 y 轴 3 刻度+竖线（横滑后文本/位置不变；空态只留竖线）；固定 x 覆盖层随 bindscroll 刷新（24h 3 个 HH:MM、7d 4 个、30d 5 个 MM-DD，无重复）
- [ ] v3.1 不回归：充值/上次充值/区间 tile2/图例/选择 sheet/未选择 0 请求/UD 13 键/阈值 30/60/环形/低电条/诊断/TTL/失败降级
- [ ] 门禁：unit 189、v3 22、sync_contract 30、staticcheck exit 0、AI 三件套、cli preview **587,846 B = `_compile_info_off.json`**；QA static_scan 76 项 0 FAIL、power_v4 25/25、mp_sync 40/0/1、mp_v2 47/47

## 电费 v5 最终版（2026-11-06 task-21 · 最终交付）

- [ ] 估算：rateFrom/estimate 分段统计（充值段跳过、持平日 rate 下限 0.05、24h/7d 0.65/0.35 混合、仅一档有效）；≥30→「≥30」+满环；tile1 副标 ≈rate 度/天；环/低电条用 estimate；拉取恒 24h+7d
- [ ] 可调低电阈值：默认 30、档位 [10..100] 8 档、点阈值 tile 开面板、判定 q<low / low≤q<2low / 其余；UD power={sel,at,low}（旧数据→30、LWW、本机 zq_power_low_<sid>、非法归一）、13 键不变、与 web sync_check 一致
- [ ] v4 不回归：区间/横滑/固定双轴/时间比例/5min 缓存/recharge/lastUp/tile2/tile4/图例/sheet/零请求/诊断/TTL
- [ ] 门禁：unit 191、v3 24、sync_contract 30、staticcheck exit 0、AI 三件套、cli preview **592,727 B = `_compile_info_off.json`**；QA static_scan 80 项 0 FAIL、power_v5_check 33/33、mp_sync 39/0/1、mp_v2 47/47
