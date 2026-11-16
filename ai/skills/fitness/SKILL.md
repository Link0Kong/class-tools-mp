# 体测（fitness）

大学生体测国标（七项）算分、国标评分表查询、本机历史记录管理。与小程序「体测」页 / 「国标表」页共用同一份本机数据与评分逻辑（评分表与主包 `utils/fit.js` 完全一致）。

## 前提

所有接口都要求已完成身份验证（本机有班级身份）。未认证时接口返回 isError 并给出身份页入口：先引导用户完成身份验证，不要重试同一接口。

## 业务流程

### 1. 算分

1. 用户说出体测项目成绩时（可能一次只说几项），调用 calculateFitness：性别 sex=m/f、年级 grade=12（大一大二）/34（大三大四）必填，其余项目按用户实际说的填写；没说到的项目不要传。
2. 返回 score（标准分）、bonus（加分）、total（总分）、level（等级：优秀 / 良好 / 及格 / 不及格）、bmi 和逐项得分 items。
3. 缺项是允许的：接口按缺项计分，并在 content 里说明缺了几项；用户追问某项分数时用 items 里对应项回答。
4. 用户想看单项评分标准时调用 getFitnessStandards（可按 item 只看一项）。

### 2. 保存 / 查看 / 修改记录

- 保存：saveFitnessRecord，入参与 calculateFitness 相同，另可传 name 自定义记录名；属于写云端操作，必须用户确认后传 confirmed=true。
  - 本机只保留最近 2 条记录；同一份数据只是补填项目时会合并到原记录，不会新增。
  - 超出 2 条的旧记录会自动归档（云端 arch=true），接口返回 dropped 数量，可向用户说明。
- 查看：listFitnessRecords 返回本机最近 2 条（recordId / 名称 / 日期 / 总分 / 等级）；要看某条详情用 getFitnessRecord + recordId。
- 改名：renameFitnessRecord（recordId、name）。
- 删除：deleteFitnessRecord，破坏性操作，必须用户确认后传 confirmed=true；删除会同步归档云端记录。

## 接口依赖

| 接口 | 前置条件 |
|---|---|
| calculateFitness | 无；sex / grade 必填，至少一项成绩 |
| getFitnessStandards | 无；sex / grade 必填 |
| listFitnessRecords | 无；无记录时返回空数组并说明 |
| getFitnessRecord | recordId 取自 listFitnessRecords / saveFitnessRecord 返回值 |
| saveFitnessRecord | 需 confirmed=true；入参同 calculateFitness |
| renameFitnessRecord | recordId 存在 |
| deleteFitnessRecord | recordId 存在；需 confirmed=true |

## 业务约束

- 记录 ID（recordId）只能取自接口返回，不要编造；找不到时先 listFitnessRecords 再重试，不要用猜的 ID 反复调用。
- 破坏性操作（保存覆盖同类记录、删除记录）先询问用户，用户同意后才传 confirmed=true；未确认返回 need-confirm，按返回文案引导用户。
- 成绩数值有合理范围（身高 100–250cm、体重 25–200kg、肺活量 500–8000mL、50 米 3–15s、坐位体前屈 -20–40cm、立定跳远 50–350cm、引体 0–100 次、长跑 >0 秒）；超出范围按缺项计，不要替用户编造成绩。
- 长跑成绩可传秒数（如 250）或「分'秒」文本（如 4'10"）；男生用 run1000、女生用 run800，引体向上 pullUp 仅男生、仰卧起坐 sitUp 仅女生。
- 评分表是国标固定数据，不要自行计算或改写；需要解释某档分数时以 getFitnessStandards 返回为准。
- 接口返回的 pagePath 可用于给用户页面入口；不要自己拼页面路径。
