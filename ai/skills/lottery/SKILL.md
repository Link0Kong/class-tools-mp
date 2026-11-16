# 抽签 · 分组 · 结果单（lottery）

班级三步工作流：抽签 → 分组 → 结果单。原子接口与小程序「抽签 / 分组 / 结果单」三个页面共用同一份本机工作流状态，接口执行完可用 handoff 直接打开页面继续操作。

## 前提与数据来源

- 所有接口都要求已完成身份验证（本机有班级身份）。未认证时接口返回 isError 并给出身份页入口：引导用户去验证，不要重试同一接口。
- 参与名单唯一来源是班级名单（class_members），按座号选择；姓名只取名单派生文本。没有选择参与名单时只抽序号，结果可能没有姓名，不要编造姓名。
- 抽签参数（范围 / 个数 / 是否重复 / 排除 / 排序）与抽签、分组结果都保存在本机，页面与接口完全互通。

## 业务流程

### 1. 抽签

1. 用户要抽签时，先调用 getDrawConfig 了解当前参数与是否已有抽签结果。
2. 用户明确给出参数时按用户说的传参；用户没说范围时沿用当前配置（默认 1–70，抽 10 个，不重复）。
3. 调用 runDraw。返回 items 已带序号与姓名，cfg 为本次结果配置。
4. 已有抽签结果时，runDraw 覆盖旧结果前必须由用户明确同意：未确认返回 need-confirm，按返回文案询问用户「是否覆盖上一次抽签结果」，用户同意后再调用并传 confirmed=true。
5. 结果写入后，用户点卡片或询问详情时用 handoff 打开抽签页（draw?step=1）。

### 2. 补抽 / 剔除

- refillDraw：把结果补到目标总个数。前置：已有抽签结果；必须 confirmed=true。
- removeDrawResult：按序号剔除当前结果中的一个，并按「自动补抽」设置决定是否补一个。前置：已有抽签结果；必须 confirmed=true。
- 两个接口都属于修改已有结果的破坏性操作，未确认时返回 need-confirm。

### 3. 分组

1. 成员来源 source：prev = 上一步抽签序号（默认）；roster = 班级名单已选座号（可传 rosterSeats 指定，或省略沿用本机已选名单）。
2. 分组方式 mode：groups = 按组数（value 为组数）；size = 按每组人数（value 为每组人数）。
3. 调用 runGroup。source=prev 时要求已有抽签结果；source=roster 时要求已选名单至少 2 人。
4. 已有分组结果时覆盖需 confirmed=true。
5. handoff 打开分组页（group?step=2）。

### 4. 结果单

- getResultSummary：汇总抽签与分组，返回纯文本结果单 text（可直接读给用户或让用户复制）。页面入口 sum?step=3。
- 抽签与分组都为空时返回空结果说明，不要编造内容。

## 接口依赖

| 接口 | 前置条件 |
|---|---|
| getDrawConfig | 无；建议抽签前先读 |
| runDraw | 无；覆盖已有结果需 confirmed=true |
| refillDraw / removeDrawResult | 已有抽签结果；均需 confirmed=true |
| getDrawResult | 无；无结果时 exists=false |
| resetDraw | 破坏性，必须 confirmed=true；清空抽签与分组 |
| runGroup | source=prev 需抽签结果；source=roster 需已选名单 ≥2 人；覆盖已有分组需 confirmed=true |
| getGroupResult | 无；无结果时 exists=false |
| resetGroup | 破坏性，必须 confirmed=true |
| getResultSummary | 抽签或分组任一存在 |

## 业务约束

- 用户确认规则：覆盖已有结果、补抽、剔除、重置一律先询问用户，用户同意后才传 confirmed=true；不要静默执行破坏性操作。
- 结果以本机工作流状态为准：同一个结果不要重复生成；用户只是想看结果时调用 getDrawResult / getGroupResult / getResultSummary，不要重新抽签。
- 抽签算法固定：先按范围生成序号、去掉排除项、再按参与名单过滤得到抽签池；不重复 = 洗牌后取前 N 个，允许重复 = 每次从池中随机取一个。
- 分组算法固定：按组数时取组数（不少于 2、不超过人数），按每组人数时向上取整；成员按顺序轮流分配到各组，勾选「打乱」时先洗牌。
- 结果单 text 里的序号与姓名是事实数据，不要改写；需要更多内容时引导用户打开结果单页。
- 接口返回的 pagePath 可用于给用户页面入口；不要自己拼页面路径。
