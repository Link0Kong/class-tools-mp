# ai/ —— 微信「小程序 AI」适配包

> 本目录是**独立分包**（`root: "ai"`，独立于主包运行），只在微信「小程序 AI 开发模式」下被加载；
> 主包页面不引用这里任何代码。当前 `app.json` **未注册**该分包，因此默认不参与编译与发布。
> 官方能力：把小程序功能抽象成**原子接口**（apis）+ **原子组件**（components），封装成 SKILL 供微信 AI 调用，
> 并可通过 handoff 把对话流程接力到小程序页面。

## 结构

```text
ai/
  common/                 共享层（技能内 require，不要复制改逻辑）
    config.js             云端配置（require 主包 utils/cloud-config.js；只含公开 publishable key）
    auth.js               身份（读 storage 'zq_class_identity'；class_verify / class_members RPC）
    rest.js               PostgREST / RPC 唯一出口（统一头、超时、GET 重试、错误码）
    local.js              本机存储（zq_tools_v2 / zq_flow 读写；与主包同键同结构）
    marks.js              marks 表读写（hw / ntdone / nt；失败入 markPend 队列）
    result.js             统一返回结构与标准文案（ok / fail / identityFail / fromError）
    fmt.js                日期时间 + 作业截止 + 通知状态口径（与 utils/util.js、utils/notice.js 一致）
    handoff.js            页面路径常量 + handoff 构造（含动态 path 覆盖）
  skills/<skill>/
    SKILL.md              业务说明（≤16000 B）
    mcp.json              模型可调用能力声明（≤24000 B，去掉 outputSchema/空白后计）
    index.js              skill = wx.modelContext.createSkill('ai/skills/<skill>') + registerAPI(...)
    apis/*.js             原子接口实现（只依赖 ai/common 与技能内 lib；禁止 getApp/页面 API/showToast）
    components/*/         原子组件（自定义组件四件套；Result 事件渲染 + setRelatedPage）
    lib/*.js              技能内纯逻辑（可 Node 单测）
utils/agent.js            主包页面侧 handoff 消费工具
```

## 8 个 SKILL

| skill path | 能力 |
| --- | --- |
| ai/skills/identity | 身份验证/我的信息/班级名单/班委/我的数据概览/工具目录/使用说明/工作台总览 |
| ai/skills/homework | 作业列表/详情/摘要/完成标记/发布/删除 |
| ai/skills/notice | 通知简报/列表/详情/已处理/置顶 |
| ai/skills/timetable | 周次/整周/今天/下一节/课程详情/开学日期 |
| ai/skills/lottery | 抽签/补抽/剔除/重置/分组/摘要（抽签与分组独立） |
| ai/skills/fitness | 体测评分/国标表/历史记录/保存/重命名/删除 |
| ai/skills/roll | 点名名单/到·假/批量/重置/统计/沿用抽签名单 |
| ai/skills/account | 同步状态/立即同步/数据概览/导出/清除云端/清除本机/反馈/访问统计 |

## 开发约定

1. 共享逻辑一律放 `ai/common`，技能目录只放本技能实现。
2. 原子接口返回 `result.ok(...)` / `result.fail(...)` / `result.identityFail()`；破坏性操作必须 `confirmed:true`。
3. 列表/详情返回 `structuredContent.pagePath`（mcp.json outputSchema 标 `format:"page-link"` + `x-link-text-field`），
   同时返回 `handoff: handoff.handoffTo(pageKey, query, payload)`，页面由主包 `utils/agent.js` 消费。
4. 原子接口环境**不能**用 `wx.showToast / wx.navigateTo / getApp / getCurrentPages / wx.getSystemInfoSync`；
   文件/图片 data URI 不得进入 content/structuredContent。
5. 组件 WXSS 受限：仅 class/标签/后代选择器，不要动画/滚动；点击操作用 `sendFollowUpMessage` 上行用户文案。

## 测试

在仓库根目录运行（Node + mock `wx.modelContext`，不访问真实云端）：

```bash
node tests/ai_unit_all.js    # 各技能原子接口单测，结果写入 tests/_reports/
node tests/ai_eval_check.js  # 意图/实体评分，用例见 tests/ai_eval_cases.json
```

## 启用与发布

- 微信「小程序 AI 开发模式」需在微信公众平台申请开通，平台可能限制代码提审；未开通时请保持 `app.json` 不注册 `ai` 分包。
- 启用时需要：在 `app.json.subPackages` 增加 `{ "root": "ai", "independent": true, "pages": [] }`，
  并在 `project.config.json.packOptions.ignore` 中移除 `ai` 目录（或按平台要求配置）。
- 关闭 / 发版时反向操作：删除该分包注册，并确保 `ai/` 不进入编译包（`packOptions.ignore` 增加 `ai`）。
- AI 运行时与小程序共享登录身份（storage `zq_class_identity`）；未认证时原子接口统一返回 identity-required 并引导身份页。
