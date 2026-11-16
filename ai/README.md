# ai/ —— 微信 AI 开发模式（小程序 AI / 微信AI操作）适配包

> 本目录是**独立分包**（`app.json.subPackages: [{root:"ai", independent:true, pages:[]}]`），
> 只在微信「小程序 AI 开发模式」运行时被加载，普通小程序页面不会引用这里任何代码。
> 官方能力：把小程序功能抽象成**原子接口**（apis）+ **原子组件**（components），封装成 SKILL 供微信 AI 调用，
> 并可通过 handoff 把对话流程接力到小程序页面。

## 结构

```
ai/
  common/                 共享层（技能内 require，不要复制改逻辑）
    config.js             云端配置（与 utils/cloud-config.js 同步；只含公开 publishable key）
    auth.js               身份（读 storage 'zq_class_identity'；class_verify / class_members RPC）
    rest.js               PostgREST / RPC 唯一出口（统一头、超时、GET 重试、错误码）
    local.js              本机存储（zq_tools_v2 / zq_flow 读写；与主包同键同结构）
    marks.js              marks 表读写（hw / ntdone / nt；失败入 markPend 队列）
    result.js             统一返回结构与标准文案（ok / fail / identityFail / fromError）
    fmt.js                日期时间 + 作业截止 + 通知状态口径（与 utils/util.js、utils/notice.js 逐字节一致）
    handoff.js            页面路径常量 + handoff 构造（含动态 path 覆盖）
  skills/<skill>/
    SKILL.md              业务说明（≤16000 B）
    mcp.json              模型可调用能力声明（≤24000 B，去掉 outputSchema/空白后计）
    index.js              skill = wx.modelContext.createSkill('ai/skills/<skill>') + registerAPI(...)
    apis/*.js             原子接口实现（只依赖 ai/common 与技能内 lib；禁止 getApp/页面 API/showToast）
    components/*/         原子组件（自定义组件四件套；Result 事件渲染 + setRelatedPage）
    lib/*.js              技能内纯逻辑（可 Node 单测）
agent/                    主包内：AGENTS.md 全局提示词、page-meta.json 页面元数据
utils/agent.js            主包页面侧 handoff 消费工具
```

## 8 个 SKILL

| skill path | 能力 |
| --- | --- |
| ai/skills/identity | 身份验证/我的信息/班级名单/班委/我的数据概览/工具目录/使用说明/工作台总览 |
| ai/skills/homework | 作业列表/详情/摘要/完成标记/发布/删除 |
| ai/skills/notice | 通知简报/列表/详情/已处理/置顶 |
| ai/skills/timetable | 周次/整周/今天/下一节/课程详情/开学日期 |
| ai/skills/lottery | 抽签/补抽/剔除/重置/分组/结果单 |
| ai/skills/fitness | 体测评分/国标表/历史记录/保存/重命名/删除 |
| ai/skills/roll | 点名名单/到·假/批量/重置/统计/沿用抽签名单 |
| ai/skills/account | 同步状态/立即同步/数据概览/导出/清除云端/清除本机/反馈/访问统计 |

## 开发约定（与 _ai_task/CONTRACT.md 一致）

1. **只写自己技能目录**；共享逻辑一律放 `ai/common`（由 Lead 维护）。
2. 原子接口返回 `result.ok(...)` / `result.fail(...)` / `result.identityFail()`；破坏性操作必须 `confirmed:true`。
3. 列表/详情返回 `structuredContent.pagePath`（mcp.json outputSchema 标 `format:"page-link"` + `x-link-text-field`），
   同时返回 `handoff: handoff.handoffTo(pageKey, query, payload)`，页面由主包 `utils/agent.js` 消费。
4. 原子接口环境**不能**用 `wx.showToast / wx.navigateTo / getApp / getCurrentPages / wx.getSystemInfoSync`；
   文件/图片 data URI 不得进入 content/structuredContent。
5. 组件 WXSS 受限：仅 class/标签/后代选择器，不要动画/滚动；点击操作用 `sendFollowUpMessage` 上行用户文案。

## 测试

```powershell
cd C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools-tests
node ai_contract_test.js     # 静态契约（app.json/skills/mcp/组件/page-meta/大小/注册覆盖/禁用 API）
node ai_unit_all.js          # 各技能原子接口单测（mock wx，不访问真实云端）
```

## 上线注意

- 微信 AI 开发模式当前为**内测 beta**：需在「微信公众平台 → 基础功能 → AI 能力」申请「开发模式」；
  官方明确「暂未开放代码提审」，**不要**把 AI 模式代码作为正式版本提交审核。
- 正式发版前如不准备接入，用 `mp-class-tools-tests/ai_toggle.py --off` 切换到发版状态。它现在同时做两件事：
  1. 移除 `app.json` 的 `subPackages`(/ai/) 与 `agent` 字段；
  2. 向 `project.config.json` 的 `packOptions.ignore` 增补两条 folder 排除项（`ai`、`agent`），
     让 `ai/` 与 `agent/` 不再进入微信开发者工具的编译包 —— 发版包体因此减小，
     「代码质量」里把 `ai/skills/*/components/*` 列为无使用组件的 `CONTAINS_UNUSED_COMPONENTS` 也随之消失。
  源码目录 `ai/`、`agent/` 始终保留在项目内（不删除、不移动），每次写入前脚本会自动备份到
  `mp-class-tools-tests/_backup_ai_toggle/`。
- `ai_toggle.py --on` 完整恢复日常 AI 开发状态：写回 `app.json` 的 AI 配置，并精确移除本脚本增补的
  `ai`/`agent` 两条 ignore 条目（用户原有的 `packOptions.ignore` / `include` 条目不受影响）。
- **质量扫描验证方式**：`--off` 后在微信开发者工具「代码质量 → 重新扫描」，`CONTAINS_UNUSED_COMPONENTS`
  不应再列出 `ai/skills/*/components/*`（目标 0 个）；也可运行离线校验
  `node mp-class-tools-tests/code_quality_check.js --project mp-class-tools`（若该脚本存在）。
- AI 运行时与小程序共享登录身份（storage `zq_class_identity`）；未认证时原子接口统一返回 identity-required 并引导身份页。
