// ai/skills/lottery/index.js —— 注册抽签 / 分组 / 摘要原子接口
// 接口名必须与 mcp.json apis[].name、apis/ 文件名（小驼峰）逐字一致。
const skill = wx.modelContext.createSkill('ai/skills/lottery');

skill.registerAPI('getDrawConfig', require('./apis/getDrawConfig'));
skill.registerAPI('runDraw', require('./apis/runDraw'));
skill.registerAPI('refillDraw', require('./apis/refillDraw'));
skill.registerAPI('removeDrawResult', require('./apis/removeDrawResult'));
skill.registerAPI('getDrawResult', require('./apis/getDrawResult'));
skill.registerAPI('resetDraw', require('./apis/resetDraw'));
skill.registerAPI('runGroup', require('./apis/runGroup'));
skill.registerAPI('getGroupResult', require('./apis/getGroupResult'));
skill.registerAPI('resetGroup', require('./apis/resetGroup'));
skill.registerAPI('getResultSummary', require('./apis/getResultSummary'));

module.exports = { skill: skill };
