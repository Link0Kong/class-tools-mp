// ai/skills/account/lib/reset.js —— 「清除本机数据」的字段口径
//
// 与主包 utils/store.js 的 DEF + pages/data/data.js 的 clearLocal 一致：
//   清空课表缓存 / 作业 / 通知 / 名单 / 体测 / 工作流与同步缓存；身份（zq_class_identity）保留。
// 主包清理由 cloud.cache.clearAll() 完成的部分（通知分块缓存等）在本层按 storage 键清理兜底。
const KEEP = ['zq_class_identity', 'zq_tools_v2', 'zq_flow'];

const DEF = {
  course: [], homework: [], notices: [], termStart: '',
  roster: '', rosterSel: [], classRoster: '', hwDone: {}, ntPin: {}, hwHide: {}, ntHide: {}, markPend: [],
  ntDone: {}, udCache: null, udPend: false, cloudOff: false, udHoldUntil: 0,
  rollNames: '', rollSel: [], rollSt: {}, did: '', hwRemind: {}, ntSub: false, ntSubAt: 0,
  ntRemind: {},
  fitRecs: [],
  classMembers: [], classMembersAt: 0,
  homeTools: ['hw', 'nt', 'ft', 'draw'], homeToolsAt: 0,
  ttCache: null,
  draw: { start: 1, end: 70, count: 10, dup: false, excl: '', sort: 'draw' },
  group: { source: 'prev', names: '', sel: [], mode: 'groups', n: 4, shuffle: false },
  fit: { sex: 'm', grade: '12', h: '', w: '', vc: '', r50: '', sit: '', jump: '', pull: '', durM: '', durS: '' },
  settings: { kind: 'webhook', url: '' }
};

function defaultStore() {
  const d = JSON.parse(JSON.stringify(DEF));
  d.selVer = 0;
  return d;
}

// 清理主包缓存等非主数据 storage 键（保留身份 / 主数据 / 工作流三键）
function clearExtraKeys(local) {
  const removed = [];
  try {
    const info = (wx.getStorageInfoSync ? wx.getStorageInfoSync() : null);
    const keys = (info && info.keys) || [];
    keys.forEach(function (k) {
      if (KEEP.indexOf(String(k)) >= 0) return;
      local.removeKey(k);
      removed.push(String(k));
    });
  } catch (e) { /* 存储信息不可用时静默跳过 */ }
  return removed;
}

module.exports = {
  KEEP: KEEP, DEF: DEF, defaultStore: defaultStore, clearExtraKeys: clearExtraKeys
};
