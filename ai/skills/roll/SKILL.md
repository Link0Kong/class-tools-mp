# 点名技能（roll）

班级工具站小程序的点名能力：从班级名单里选一批人作为点名名单，逐人记录「到 / 假」，
支持统计与重置，也支持沿用抽签页的参与名单。

## 适用场景

- 查看当前点名名单 / 几个人 → `getRollRoster`
- 设置名单：沿用抽签名单、使用全班名单、指定座号 → `setRollRoster` / `useDrawRoster`
- 「3 号到了」「12 号请假」→ `markRollStatus`
- 「全部到 / 全部请假」→ `markAllRoll`（需用户确认）
- 「点了多少人」「谁还没点到」→ `getRollSummary`
- 「重置本轮点名」→ `resetRoll`（需用户确认）

不适用：抽签/分组（用 lottery 技能）。

## 接口与参数

| 接口 | 入参 | 说明 |
|---|---|---|
| `getRollRoster` | 无 | 名单 `seats[{seat,name}]`、`count`、`source`（draw/class）、到·假统计 |
| `setRollRoster` | `seats`?：座号数组；`source`?：`current`/`draw`/`class` | 与 seats 同时传时以 seats 为准；`seats:[]` 清空名单 |
| `useDrawRoster` | 无 | 沿用抽签页参与名单；抽签名单为空时返回错误，引导先去抽签 |
| `markRollStatus` | `seat`：座号；`status`：`present`/`absent` | 单人标记 |
| `markAllRoll` | `status`：`present`/`absent`；`confirmed` | 批量标记，破坏性：必须 confirmed=true |
| `getRollSummary` | 无 | `total/present/absent/unmarked` + `items[{seat,name,status}]` |
| `resetRoll` | `confirmed` | 清空到/假记录（名单保留），破坏性：必须 confirmed=true |

## 数据口径（不要说错）

- 名单只来自班级官方名单（`classMembers`，按座号）。座号必须取自 `getRollRoster` 的 `seats[].seat`，不要编造。
- 「到」= `present`（本机存 `in`）、「假」= `absent`（本机存 `ab`）；未标记 = `unmarked`。
- 名单变化时，已有到/假记录会按「姓名」保留并重排，不会丢。
- 写入只保存到本机；下一次打开小程序时随用户数据自动同步云端（云同步关闭时仅本机）。不要在回复里说已同步云端。
- `counts` 字段：`present`（已到）、`absent`（请假）、`unmarked`（未点）、`total`（名单人数）。

## 使用规则

1. 先确认名单：用户没提名单时先调 `getRollRoster`；名单为空时引导「沿用抽签名单 / 指定座号」。
2. `markRollStatus` 的 seat 必须是名单里的座号；接口会校验并返回合法座号提示，不要重试编造的座号。
3. 「全部到」「重置」属破坏性操作：`markAllRoll` / `resetRoll` 首次调用不传 `confirmed`，接口会返回待确认提示；
   向用户复述影响（人数 / 清空记录），用户确认后再调用并传 `confirmed:true`。不要替用户默认确认。
4. 用户说「3 号到了」但 3 号不在名单里时，先说明不在名单、给出当前名单座号，再问是否需要加入（`setRollRoster` 指定座号）。
5. 回复简洁：先给动作结果（谁标成了什么、当前统计），再给 1 个下一步（继续点 / 看统计 / 重置）。
6. 不要把学号、完整班级名单原文贴进回复；只回复本轮点名名单内的座号与姓名。

## 示例

- 「点名用抽签的人」→ `useDrawRoster`（无参）→ 复述人数并提示可以开始点到。
- 「名单用全班」→ `setRollRoster({source:"class"})`。
- 「1 号 2 号 7 号点名」→ `setRollRoster({seats:[1,2,7]})`。
- 「5 号到了」→ 先 `getRollRoster` 确认 5 号在名单，再 `markRollStatus({seat:5,status:"present"})`。
- 「全部到」→ `markAllRoll({status:"present"})` → 得到待确认提示 → 用户说「确认」→ `markAllRoll({status:"present",confirmed:true})`。
- 「谁还没点到」→ `getRollSummary` → 转述未点名单（可截断）。
