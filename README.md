# 班级工具站 · 微信小程序

面向高校班级的微信小程序：身份核验之后，把抽签、分组、课表、作业、通知、名单、点名、投票等班级事务放到一个入口里。

![version](https://img.shields.io/badge/version-2.1.0-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![platform](https://img.shields.io/badge/platform-%E5%BE%AE%E4%BF%A1%E5%B0%8F%E7%A8%8B%E5%BA%8F-07C160)

## 简介

班级工具站是原生微信小程序（WXML / WXSS / JavaScript），**不依赖 npm，没有构建链**，用微信开发者工具导入仓库根目录即可运行。

它和网页端、Android、鸿蒙、Windows 端共用同一套云数据契约：同一份班级身份、`userdata`（v6）、作业、通知、投票等数据在各端之间互通，换端不需要重新录入。

## 功能

- **身份核验**：学号 + 姓名与班级名单比对，换取短期班级 token；没有公开注册。
- **工作台与自定义工具栏**：首页勾选常用工具（最多 4 个），全部工具长按拖动排序，顺序随账号云同步。
- **抽签与存证**：范围、人数、排除号与是否重复；结果单、存证记录与核验二维码。
- **分组**：随机/按条件分组、组名编辑与结果导出。
- **课表**：周视图 / 日视图、今日课程、下一节课、学期周次。
- **任务（原作业工具入口）**：个人任务 + 班级作业统一入口；分组/步骤与步骤备注/附件/截止与提醒/重复/标签/我的一天/重要；与网页任务共用 `taskdata` 云同步，工作台/通知均可转入，支持分享卡与单任务分享预览。原班级作业发布/附件/勾选能力保留在任务页「班级作业」分段内。
- **通知**：列表与详情、附件、置顶与已处理、长期通知归档。
- **体测**：国标算分、等级与历史记录。
- **名单**：班委 / 团员 / 全班，按座号展示（不展示学号）。
- **点名**：到 / 假 / 未点、批量操作、统计，可沿用抽签名单。
- **电费**：关注宿舍、剩余电量、低电阈值与趋势。
- **水量**：抄表人数、读数与水费分摊。
- **投票**：单选 / 多选、匿名 / 实名、可见范围与截止时间。
- **PPT 下载**：演示文件列表、下载中心与在线播放（分步图 / 视频 / PDF）。
- **文件传输**：同账号设备之间的临时云空间（文件保留 72 小时）。
- **校园地图**：自制校园地图与位置分享。
- **统计**：班级访问统计（仅管理员可见），按姓名聚合。
- **诊断**：设备、网络、时钟自检与接口延迟，便于排查问题。

## 在线体验与发布

- 线上入口：微信搜索小程序「班级工具」（以微信公众平台实际发布版本为准）。
- 小程序需要在[微信公众平台](https://mp.weixin.qq.com/)上传代码、提交审核并发布。
- **本仓库只包含源码**，不包含已构建的发布包；体验版 / 正式版由开发者工具上传后生成。
- 首次部署需要在云端导入班级名单，并配置身份核验 RPC（见 `utils/cloud-config.js`）。

## 开发与构建

环境：微信开发者工具（稳定版）、Node.js 16+、Python 3（仅静态检查用）。

1. 微信开发者工具 → 导入项目 → 选择**仓库根目录**（不是 `miniapp/`）。
2. AppID：仓库内是作者已发布小程序的 AppID；调试自己的环境时换成自己的 AppID（`project.config.json` → `appid`）。
3. 云端：修改 `utils/cloud-config.js` 中的 `restBase`、`publishableKey` 与 RPC 名。未配置时小程序以离线模式运行，身份核验不可用。
4. 测试（在仓库根目录执行）：

   ```bash
   node tests/unit.js                # 单元/契约测试（mock wx，不访问真实云端）
   node tests/sync_contract_test.js  # 跨端 userdata v6 同步契约
   python tests/staticcheck.py       # 静态检查（页面四件套、事件、分享、包体等）
   ```

5. 真机预览：开发者工具「预览」扫码；发布前在微信后台配置 request / downloadFile 合法域名。

## 项目结构

```text
app.js / app.json / app.wxss   小程序入口、页面注册与全局样式
pages/                         页面（身份、工作台、抽签、课表、作业、通知……）
components/                    复用组件（底部弹层、分段、名单选择器等）
utils/                         纯逻辑与云端访问（store / cloud / identity / legal 等）
images/                        图标与分享封面
cloudfunctions/notify/         微信云开发订阅消息云函数
tests/                         Node / Python 测试与静态检查
ai/                            微信「小程序 AI」原子接口（独立分包，可选）
```

## 技术栈

- 原生 WXML / WXSS / JavaScript（CommonJS），无前端框架、无构建依赖
- 微信云开发 CloudBase（PostgreSQL + PostgREST）作为数据与身份后端
- 订阅消息云函数（Node.js）
- 测试：Node.js `assert` + wx mock；Python 静态检查

> `ai/` 是微信「小程序 AI」原子接口，默认不注册进 `app.json`（AI 开发模式关闭），不会进入发布包；启用前请自行评估平台审核与合规要求。

## 相关仓库

| 端 | 仓库 |
| --- | --- |
| 网页 / 部署 | [class-tools-site](https://github.com/Link0Kong/class-tools-site) |
| 微信小程序（本仓库） | [class-tools-mp](https://github.com/Link0Kong/class-tools-mp) |
| Android | [class-tools-android](https://github.com/Link0Kong/class-tools-android) |
| 鸿蒙 | [class-tools-harmony](https://github.com/Link0Kong/class-tools-harmony) |
| Windows | [class-tools-windows](https://github.com/Link0Kong/class-tools-windows) |

## 文档

- [CHANGELOG.md](CHANGELOG.md)：版本变更记录
- [tests/README.md](tests/README.md)：测试组织与运行方式
- [utils/cloud-config.js](utils/cloud-config.js)：云端地址、RPC 与数据表契约（注释即契约摘要）
- [CONTRIBUTING.md](CONTRIBUTING.md) / [SECURITY.md](SECURITY.md) / [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## 隐私与数据

- 身份核验只使用**学号 + 姓名**与班级名单比对，签发短期班级 token；没有公开注册与账号密码。
- 页面与导出**不展示、不导出学号与手机号**；访问统计按姓名聚合。
- 仓库内测试只使用测试身份（`3260799999` / 9999 段）与虚构姓名，不含真实班级名单。
- 实际部署时请替换示例班级数据，并按 [SECURITY.md](SECURITY.md) 管理云端密钥与合法域名。

## 免责声明

本项目是班级内部辅助工具，**不是学校、学院或任何官方平台**；课表、成绩、通知、评奖等信息以学校正式发布为准。

## 许可证

[MIT](LICENSE)
