// ai/skills/timetable/index.js —— 注册 timetable SKILL 的全部原子接口
// 与 mcp.json 的 apis[].name 逐字一致；skillPath 与 app.json agent.skills[].path 一致。
const skill = wx.modelContext.createSkill('ai/skills/timetable');

const getWeekInfo = require('./apis/getWeekInfo.js');
const getTimetable = require('./apis/getTimetable.js');
const getTodayCourses = require('./apis/getTodayCourses.js');
const getNextCourse = require('./apis/getNextCourse.js');
const getCourseDetail = require('./apis/getCourseDetail.js');
const setTermStart = require('./apis/setTermStart.js');

skill.registerAPI('getWeekInfo', getWeekInfo);
skill.registerAPI('getTimetable', getTimetable);
skill.registerAPI('getTodayCourses', getTodayCourses);
skill.registerAPI('getNextCourse', getNextCourse);
skill.registerAPI('getCourseDetail', getCourseDetail);
skill.registerAPI('setTermStart', setTermStart);

module.exports = { skill: skill };
