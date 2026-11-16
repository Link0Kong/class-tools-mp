// ai/skills/notice/index.js —— 注册 notice SKILL 的全部原子接口
//
// 平台约定（微信「小程序 AI 开发模式」）：
//   const skill = wx.modelContext.createSkill('<与 app.json agent.skills[].path 一致>')
//   skill.registerAPI('<mcp.json apis[].name>', handler)
// 本 SKILL 的接口名/文件名/mcp.json 声明三者必须逐字一致。
const skill = wx.modelContext.createSkill('ai/skills/notice');

skill.registerAPI('getNoticeBriefing', require('./apis/getNoticeBriefing.js'));
skill.registerAPI('listNotices', require('./apis/listNotices.js'));
skill.registerAPI('getNoticeDetail', require('./apis/getNoticeDetail.js'));
skill.registerAPI('setNoticeDone', require('./apis/setNoticeDone.js'));
skill.registerAPI('setNoticePinned', require('./apis/setNoticePinned.js'));
