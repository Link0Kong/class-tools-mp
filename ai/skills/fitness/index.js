// ai/skills/fitness/index.js —— 注册体测原子接口
// 接口名必须与 mcp.json apis[].name、apis/ 文件名（小驼峰）逐字一致。
const skill = wx.modelContext.createSkill('ai/skills/fitness');

skill.registerAPI('calculateFitness', require('./apis/calculateFitness'));
skill.registerAPI('getFitnessStandards', require('./apis/getFitnessStandards'));
skill.registerAPI('listFitnessRecords', require('./apis/listFitnessRecords'));
skill.registerAPI('getFitnessRecord', require('./apis/getFitnessRecord'));
skill.registerAPI('saveFitnessRecord', require('./apis/saveFitnessRecord'));
skill.registerAPI('renameFitnessRecord', require('./apis/renameFitnessRecord'));
skill.registerAPI('deleteFitnessRecord', require('./apis/deleteFitnessRecord'));

module.exports = { skill: skill };
