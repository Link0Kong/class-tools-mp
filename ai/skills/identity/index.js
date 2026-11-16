// ai/skills/identity/index.js —— 注册 identity SKILL 的全部原子接口
//
// 约定（官方「接入方式 §3.3」）：
//   * wx.modelContext.createSkill(skillPath) 的 skillPath 必须与 app.json 的 agent.skills[].path 一致；
//   * registerAPI(name, handler) 的 name 必须与 mcp.json 的 apis[].name、apis/<name>.js 一致。
const skill = wx.modelContext.createSkill('ai/skills/identity');

skill.registerAPI('getMyProfile', require('./apis/getMyProfile.js'));
skill.registerAPI('verifyClassIdentity', require('./apis/verifyClassIdentity.js'));
skill.registerAPI('listClassMembers', require('./apis/listClassMembers.js'));
skill.registerAPI('getCommittee', require('./apis/getCommittee.js'));
skill.registerAPI('getMyOverview', require('./apis/getMyOverview.js'));
skill.registerAPI('getToolsDirectory', require('./apis/getToolsDirectory.js'));
skill.registerAPI('getUsageGuide', require('./apis/getUsageGuide.js'));
skill.registerAPI('getWorkspaceOverview', require('./apis/getWorkspaceOverview.js'));
