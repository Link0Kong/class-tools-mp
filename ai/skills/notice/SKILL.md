# 通知 SKILL（notice）

班级工具站小程序的「班级通知」业务：通知简报、通知列表、单条详情、标记已处理、置顶。

## 一、数据来源与 `[[CLASS_NOTICE_V1]]` 解析规则

### 1. 云端表结构
- 数据在云端 `public.notices` 表，AI 侧只读取 `archived=false` 的行（`select=*&order=ts.asc,id.asc`）。
- **自动通知行**：`body` 以 `[[CLASS_NOTICE_V1]]` 开头，后面紧跟一段通知组 JSON。整表约 2MB（其中约 98% 是图片/附件的 base64 data URI），因此：
  - 解析后立即剥离图片 `src`、附件 `url` 等大字段，只保留名称/大小/类型/数量；
  - 解析结果缓存在 AI 专用 storage 键 `zqa1_nt_cache_v1`（含时间戳），5 分钟内复用，避免每次对话都拉整表；断网时优先用该缓存兜底。
- **手动通知行**：`body` 是纯文本（非前缀格式），同样支持：包装成一条「文本通知」，标题取 `title`，正文取 `body`，发送者取 `author`，没有截止时间（状态为「无时间」）。
- 单行 JSON 损坏时跳过该行，不影响其它通知。
- 分类来自组的 `cat`（教务/团务/考试/缴费/活动/班级事务/通知…），未知分类按「通知」处理。

### 2. 组字段（只读，不推断）
组 JSON 字段：`id / title / cat / source / group / senderName / senderRole / senderBadge / deadline / extensions[] / expireAt / eventAt / timeLabel / aiSummary / aiPoints[] / aiSegments[] / items[] / actionable / alert / ocr / createdAt`。
- `aiSummary`：AI 摘要（列表最多回 120 字、详情最多 600 字）。
- `aiPoints[]`：要点，每条最多回 80 字、最多 6 条。
- `aiSegments[]`：字段拆分（`{type,text}`），type 归一到「时间/地点/对象/内容/报名/截止/要求/联系方式/补充」，详情最多回 6 项。
- `items[]` 的 kind：
  - `text`：原始消息正文；`follow`：补充通知正文 → 详情 `raw[]`（最多 3 段、每段截断 500 字）。
  - `img`：图片 → **只回数量**（`images`），绝不回 data URI / base64。
  - `file`：附件 → 名称、大小、类型（PDF/XLS/DOC/PPT/图片/压缩包/文件），不回内容。
  - `form`：收集表 → 名称、开放/已截止（按 `close` 的 `MM-DD HH:mm` 判断）、是否可打开。
  - `link` / `mini` / `article`：链接/小程序/公众号文章 → 名称、域名（host）、来源，不回完整 URL。
  - `merged`：合并转发聊天记录 → 标题、条数、前 6 条消息摘要。
- `sender`：`{name, role, badge, source, group}`；气泡文字优先 `senderRole`，其次 `senderBadge`（与通知页一致）。
- `ocr`：`{flagged, count}`，表示通知或其图片带 OCR 识别内容；不回 OCR 原文（在通知页查看）。
- `actionable=false` 的通知只作知悉，不计入待处理。

## 二、通知状态口径（与通知页、网页端逐字节一致）

1. **真实截止时间优先级**：有 `extensions[]` 时取**最后一次延期**的 `deadline`，否则取 `deadline`；格式为 ISO 时间（如 `2026-11-10T18:00:00+08:00`）。
   - 展示时用真实截止（`deadlineText`），**绝不把 `expireAt` 当截止时间展示**。
2. **`expireAt` 只是自动归档兜底**：它决定的是「多久后不再显示为进行中」，不是用户要赶的截止时间。只有「无真实截止但有 `eventAt`」时，才用 `archiveAt || eventAt` 判断活动是否结束。
3. **`alert=true` 的组即使过了真实截止也不算过期**，仍留在待处理（提示「已截止 · 有新名单」）。
4. **既没有真实截止、也没有 `eventAt`** 的通知不算过期，状态「无时间」，只作知悉。
5. 状态文案（与页面一致）：`剩 N 分钟` / `今天 HH:mm 截止` / `今天 24:00` / `N 天后截止` / `MM-DD HH:mm 截止` / `已延长 · …截止` / `已过期（已截止 · 自动完成）` / `已延长 · 已截止` / `已结束 · 自动归档` / `无时间` / `已截止 · 有新名单` / `已处理`。
6. 已标记已处理（marks `kind=ntdone`）的通知**不计入待处理**，但仍可通过 `status=done` 查到；置顶（marks `kind=nt`）只是个人排序偏好。

## 三、接口依赖与编排

| 接口 | 作用 | 前置条件 | 上下游 |
|---|---|---|---|
| `getNoticeBriefing` | 简报：待处理/24h/7 天/已过期 + 最紧迫一条 | 已身份验证 | 用户泛问时先用；再按需 `listNotices` |
| `listNotices` | 通知列表（状态/分类/关键词/条数） | 已身份验证 | 返回 `items[].id` 供详情/已处理/置顶引用 |
| `getNoticeDetail` | 单条详情（摘要/要点/字段/详情项/原始消息/发送者/OCR） | 已身份验证 + 有效 `noticeId` | `noticeId` 只能取 `listNotices` 的 `items[].id` |
| `setNoticeDone` | 标记已处理 / 恢复待处理 | 已身份验证 + 有效 `noticeId` | 已过期通知不允许标记已处理 |
| `setNoticePinned` | 置顶 / 取消置顶 | 已身份验证 + 有效 `noticeId` | 个人偏好，不影响他人 |

典型流程：
1. 用户问「有什么新通知 / 有没有要处理的」→ `getNoticeBriefing` → 展示简报并追问是否看待处理列表。
2. 用户问「期中考试的通知里说了什么」→ `listNotices`（`keyword=期中考试`）→ 取唯一一条 `id` → `getNoticeDetail`。
3. 用户说「这个我看过了」→ 先 `listNotices`/`getNoticeDetail` 定位 → `setNoticeDone`（`done=true`）。
4. 用户说「把它置顶」→ `setNoticePinned`（`pinned=true`）。
5. 用户要「全部通知」→ `listNotices`（`status=all`，必要时 `limit=50`），已过期与已处理会分别标注。

### ID 规则（硬约束）
- 所有 `noticeId` 必须取自接口返回的真实 `id` 原值，**禁止从用户自然语言推断、禁止编造、禁止使用示例值**。
- 上下文没有有效 id 时先调用 `listNotices`；接口返回 `invalid-input`（未找到）时按提示重新获取，不要用同一 id 重复重试。

## 四、写操作规则
- `setNoticeDone` 与 `setNoticePinned` 都是**可撤销**的个人状态（写云端 marks，与网页端互通），**不需要 `confirmed`**；但必须在调用成功后再向用户陈述「已处理 / 已置顶」。
- 对**已过期**通知调用 `setNoticeDone(done=true)` 会被拒绝：已过期内容只需知悉，不需要处理动作；可引导用户查看 `status=expired`。
- 「全部标记已处理」这类批量动作不在本 SKILL 提供，需要时请用户在通知页操作。

## 五、失败兜底
- **网络不可用**：优先使用 AI 缓存（`zqa1_nt_cache_v1`）或本机手动通知缓存；文案注明「来自本机缓存」。完全无缓存时返回网络错误，引导稍后重试或打开通知页。
- **标记已处理/置顶失败**：本机已生效并进入待补发队列，返回 `pending=true`；告知用户「已在本机生效，联网后自动同步」，不要重复调用。
- **未认证**：所有接口返回 `identity-required` 并引导打开身份验证页（学号+姓名）。
- **空结果**：不是错误。说明「没有查到」，并给出替代动作（换分类/关键词、看全部、看已过期）。
- 通知整表较大是已知事实：**不要把大量原文、data URI、base64 塞进回复或结构化数据**；摘要/要点/原文摘录都已经做长度限制。

## 六、返回与展示约定
- `structuredContent` 含 `pagePath`（通知页路径，正文可渲染蓝链）与结构化数据；`_meta.cardData` 只给原子组件渲染，模型不读。
- 原子组件：`notice-brief-card`（简报）、`notice-card`（列表）、`notice-detail-card`（详情），都关联通知页 `/pages/nt/nt`；接力 query 约定：`nt?gid=<id>&filter=pending|expired|done`。
- 回复中的事实以接口返回为准：状态看 `statusText`，截止看 `deadlineText`，不要自行推算或改写时间。

## 七、边界示例
- 用户问「上周那个已截止的通知说了什么」→ `listNotices(status=expired, keyword=…)` 找 id → `getNoticeDetail`（已过期仍可查看，但不可标记已处理）。
- 用户说「所有通知都处理完了」→ 先 `getNoticeBriefing` 给出待处理条数，再询问是否逐条标记；不要一次性批量写 marks。
- 用户要「图片/附件原件」→ AI 侧只提供名称/大小/数量，引导到通知页预览或下载。
