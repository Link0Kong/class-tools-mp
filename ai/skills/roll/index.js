// ai/skills/roll/index.js —— 注册 roll SKILL 的全部原子接口
// 与 mcp.json 的 apis[].name 逐字一致；skillPath 与 app.json agent.skills[].path 一致。
const skill = wx.modelContext.createSkill('ai/skills/roll');

const getRollRoster = require('./apis/getRollRoster.js');
const setRollRoster = require('./apis/setRollRoster.js');
const markRollStatus = require('./apis/markRollStatus.js');
const markAllRoll = require('./apis/markAllRoll.js');
const resetRoll = require('./apis/resetRoll.js');
const getRollSummary = require('./apis/getRollSummary.js');
const useDrawRoster = require('./apis/useDrawRoster.js');

skill.registerAPI('getRollRoster', getRollRoster);
skill.registerAPI('setRollRoster', setRollRoster);
skill.registerAPI('markRollStatus', markRollStatus);
skill.registerAPI('markAllRoll', markAllRoll);
skill.registerAPI('resetRoll', resetRoll);
skill.registerAPI('getRollSummary', getRollSummary);
skill.registerAPI('useDrawRoster', useDrawRoster);

module.exports = { skill: skill };
