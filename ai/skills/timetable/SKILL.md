# 课表技能（timetable）

班级工具站小程序的课表能力。数据来自教务快照 `tt.json`（本机缓存 `ttCache`，6 小时过期后自动刷新），
周次由「开学日期 + 课程周次/单双周」换算。只读为主，唯一的写操作是设置开学日期。

## 适用场景

- 今天有什么课 / 现在上什么课 / 今天还有几节课 → `getTodayCourses`
- 下一节课是什么 / 还有多久上课 → `getNextCourse`
- 本周课表 / 下周课表 / 第 N 周课表 / 周三上什么课 → `getTimetable`
- 现在第几周 / 开学日期是哪天 / 这学期几周 → `getWeekInfo`
- 某门课在哪上 / 谁教 / 什么时候上 → `getCourseDetail`
- 用户明确给出开学日期 → `setTermStart`

不适用：作业与截止时间（用 homework 技能）、通知（用 notice 技能）。

## 接口与参数

| 接口 | 入参 | 用途 |
|---|---|---|
| `getWeekInfo` | 无 | 开学日期、当前周、总周数、是否有课表数据 |
| `getTimetable` | `week`?：1-60 整数或 `current`/`next`/`prev`（不传=本周）；`day`?：1-7（1=周一） | 指定周/某天课程 |
| `getTodayCourses` | 无 | 今天课程 + 进行中/未开始/已结束 |
| `getNextCourse` | 无 | 今天起 14 天内最近一节课 |
| `getCourseDetail` | `courseName`（必填，原文取自课程结果） | 教师/教室/节次/周次/后续上课日期 |
| `setTermStart` | `termStart`：`YYYY-MM-DD`（必填） | 设置开学日期（本机，下次打开自动同步） |

## 数据口径（不要自行推算）

- 第 1 周 = 开学日期所在周；当前周 = `floor(今天 - 开学日期)/7 + 1`。
- 开学日期优先用用户本机设置（`store.termStart`）；未设置时自动用教务快照里的学期开始日期，
  这时应在回复里提醒「可在课表页设置开学日期」。
- 课程是否在本周上：`weeks`（如 `1-16`）包含当前周且不违反 `parity`（单周/双周）；两者都为空视为全学期。
- 节次时间固定 12 节（第 1 节 08:10 起），接口已返回 `startText`/`endText`/`span`，不要重算。
- 教室 `room` 是短标识（如 `01105`）；`roomFull` 是教务原文。

## 使用规则

1. 用户没给周次时不要猜，调用 `getTodayCourses` / `getWeekInfo` / `getTimetable`（不传 week 即本周）。
2. 课程名必须来自接口返回的 `courses[].name`，不要编造；`getCourseDetail` 查不到时会返回可选课程名，可据此追问。
3. `week` 超出学期范围时接口会按最后一周展示并在文案里说明，直接转述即可。
4. 还没有开学日期时：`getTimetable` 只能用具体周次；`getTodayCourses`/`getNextCourse` 无法判断，应引导用户提供开学日期后调 `setTermStart`。
5. 课表数据拉取失败或本机无缓存时，接口返回空结果 + 引导打开课表页；不要用记忆里的旧课表编造结果。
6. `setTermStart` 只在用户明确给出日期时调用；日期格式必须是 `YYYY-MM-DD`，口述日期先换算（如「9 月 1 号开学」→ 今年 `2026-09-01`，跨年时确认年份）。
7. 返回结果里的 `pagePath` 是课表页链接；需要用户看完整课表时可引导点开或说「去课表页看」。
8. 单次回复控制在 200 字内：先给结论（第几周/今天几节课/下一节是什么），再给 1 个下一步动作。

## 示例

- 「今天有课吗」→ `getTodayCourses`（无参）→ 转述 `stateText` 与课程列表。
- 「下一节课几点」→ `getNextCourse`（无参）→ 课程名 + `dayText`/`dateText` + `span` + `startText` + `leftText`。
- 「下周课表」→ `getTimetable({week:"next"})`→ 按天概述。
- 「高数在哪上」→ 先 `getTimetable` 拿到课程名，再 `getCourseDetail({courseName:"高等数学"})`。
- 「我们 9 月 1 号开学」→ 确认年份后 `setTermStart({termStart:"2026-09-01"})`。
