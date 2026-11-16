// ai/skills/account/index.js —— 注册 account SKILL 的全部原子接口
const skill = wx.modelContext.createSkill('ai/skills/account');

skill.registerAPI('getSyncStatus', require('./apis/getSyncStatus.js'));
skill.registerAPI('syncNow', require('./apis/syncNow.js'));
skill.registerAPI('setCloudSync', require('./apis/setCloudSync.js'));
skill.registerAPI('getDataOverview', require('./apis/getDataOverview.js'));
skill.registerAPI('exportMyData', require('./apis/exportMyData.js'));
skill.registerAPI('clearCloudData', require('./apis/clearCloudData.js'));
skill.registerAPI('clearLocalData', require('./apis/clearLocalData.js'));
skill.registerAPI('submitFeedback', require('./apis/submitFeedback.js'));
skill.registerAPI('listMyFeedback', require('./apis/listMyFeedback.js'));
skill.registerAPI('markFeedbackDone', require('./apis/markFeedbackDone.js'));
skill.registerAPI('getVisitStats', require('./apis/getVisitStats.js'));
