// ai/skills/homework/index.js —— 注册 homework SKILL 的全部原子接口
//
// 平台约定（微信「小程序 AI 开发模式」）：
//   const skill = wx.modelContext.createSkill('<与 app.json agent.skills[].path 一致>')
//   skill.registerAPI('<mcp.json apis[].name>', handler)
// 本 SKILL 的接口名/文件名/mcp.json 声明三者必须逐字一致。
const skill = wx.modelContext.createSkill('ai/skills/homework');

skill.registerAPI('listHomework', require('./apis/listHomework.js'));
skill.registerAPI('getHomeworkDetail', require('./apis/getHomeworkDetail.js'));
skill.registerAPI('getHomeworkSummary', require('./apis/getHomeworkSummary.js'));
skill.registerAPI('setHomeworkDone', require('./apis/setHomeworkDone.js'));
skill.registerAPI('publishHomework', require('./apis/publishHomework.js'));
skill.registerAPI('deleteHomework', require('./apis/deleteHomework.js'));
