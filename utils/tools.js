// utils/tools.js —— 工具目录（唯一真源）
// 与网页版 TOOLS 对齐；「抽签 / 分组 / 结果单」是同一个工具：draw 页为第 1 步，group / sum 页为第 2 / 3 步。
//
// 2026-11-06 v2.0.0 语义调整（与网页「全部页」拖动排序口径一致）：
//   homeTools（云端 userdata v6，≤4）= 用户**主动勾选**的首页工具 key 数组（按 toolOrder 的相对顺序）；
//     不再自动补齐，只去重/过滤非法项；旧版「全量顺序」数据在首次读取时迁移（见 migrateLegacy）。
//   toolOrder = 「全部工具」目录的展示/拖动顺序；随账号云同步（userdata v6 已有 prefs.toolOrder，
//     不新增顶层键；toolOrderSetAt>0 才写云端，默认自然顺序不写；详见 utils/cloud.js）。
//   拖动排序只改 toolOrder，并按新顺序重排 homeTools（勾选集合不变）；homeTools 顺序变了才提升
//   homeToolsAt 并触发 UD 同步（与网页端 LWW 合并）。
//
// 2026-11-22 跨端 key 归一（用户反馈「安卓端排序/首页勾选同步不到小程序」）：
//   userdata v6 的 homeTools / prefs.toolOrder 是五端共用同一份数组，但历史 key 词表并不统一：
//     · 小程序本机：体测 = ft，名单 = bz，分组并入 draw；
//     · 网页：      体测 = ft，名单 = committee；
//     · 安卓/鸿蒙：  体测 = fit，名单 = roster，另有独立 group 工具。
//   小程序把安卓/鸿蒙写入的 fit / roster / group 当未知 key 丢弃 → 体测、名单从首页消失、顺序也丢，
//   随后还会把过滤后的数组回推云端，把安卓端的勾选一起改掉。这里统一在读写云端时做别名转换：
//   读云端 = 外部 key → 本机 key；写云端 = 本机 key → 网页 canonical key（bz → committee），
//   安卓/鸿蒙侧对 ft / committee 做反向映射（见各端 ToolCatalog/HomeToolsEditor）。
const identity = require('./identity.js');

// 云端 key → 本机 key（读）；本机 key → 云端 key（写）
const SYNC_KEY_IN = { fit: 'ft', roster: 'bz', committee: 'bz', group: 'draw', task: 'hw' };
const SYNC_KEY_OUT = { bz: 'committee' };

// 把任意端写入的 key 归一成本机 key（未知 key 原样返回，由调用方决定丢弃/保留）
function localKey(k) { return SYNC_KEY_IN[k] || k; }
// 本机 key → 跨端 canonical key（网页/安卓/鸿蒙都能识别）
function syncKey(k) { return SYNC_KEY_OUT[k] || k; }

// 云端数组 → 本机数组（保序去重；未知 key 原样保留，避免改写别的端的偏好）
function fromSyncKeys(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach(function (k) {
    const lk = localKey(k);
    if (out.indexOf(lk) < 0) out.push(lk);
  });
  return out;
}
// 本机数组 → 云端数组（保序去重；未知 key 原样保留）
function toSyncKeys(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach(function (k) {
    const sk = syncKey(localKey(k));
    if (out.indexOf(sk) < 0) out.push(sk);
  });
  return out;
}

const TOOLS = [
  { key: 'tt',   name: '课表',   ico: '📅', icoImg: '/images/tool-tt.png', meta: '周次 · 下一节课', desc: '班级课表与下一节课；教务自动同步，全员查看', url: '/pages/tt/tt', tab: false, tone: 'primary' },
  { key: 'hw',   name: '任务',   ico: '✓', icoImg: '/images/tool-task.png', meta: '个人任务 · 班级作业 · 云同步', desc: '个人任务与班级作业统一入口：分组、步骤备注、附件、截止提醒、重复；班级作业/通知可加入任务', url: '/pages/task/task', tab: false, tone: 'primary' },
  { key: 'nt',   name: '班级通知', ico: '📢', icoImg: '/images/tool-nt.png', meta: '简报 · 筛选 · 附件', desc: '云端班级通知；AI 拆分、附件预览、原始消息', url: '/pages/nt/nt', tab: false, tone: 'primary' },
  { key: 'ft',   name: '体测',   ico: '📏', icoImg: '/images/tool-ft.png', meta: '大学国标 · 加分', desc: '大学体测七项算分、附加分与等级，实时出分', url: '/pages/ft/ft', tab: false, tone: '' },
  { key: 'draw', name: '抽签分组', ico: '🎲', icoImg: '/images/tool-draw.png', meta: '抽号 · 分组 · 结果单', desc: '抽号 → 分组 → 结果单；可剔除重抽、可分享卡片或长图', url: '/pages/draw/draw', tab: false, tone: '' },
  { key: 'roll', name: '点名',   ico: '🙋', icoImg: '/images/tool-roll.png', meta: '到 · 假 · 沉底', desc: '线下点名核对：叫到一个勾一个，可到/请假，已处理自动沉底', url: '/pages/roll/roll', tab: false, tone: 'tertiary' },
  { key: 'bz',   name: '名单',   ico: '🏅', icoImg: '/images/tool-bz.png', meta: '班委 · 团员 · 全班', desc: '班级名单三分类：班委职务 / 团员 / 全班；所有已认证同学都可查看', url: '/pages/committee/committee', tab: false, tone: 'tertiary' },
  // v2.0.0 与网站功能同步：宿舍电费（普通工具；2026-11-22 起可主动勾选进首页，与网页工具栏/安卓一致）；
  // 诊断（2026-11-08 起对所有已认证同学可见；2026-11-22 起同样可勾选）
  { key: 'power', name: '宿舍电费', ico: '⚡', icoImg: '/images/tool-power.png', meta: '关注宿舍 · 电量 · 24h 趋势', desc: '关注自己宿舍，查看剩余电量、近 24h 趋势与估算可用天数；与网站同一份云端数据', url: '/pages/power/power', tab: false, tone: 'tertiary' },
  // 2026-11-06 水量统计（与网站同口径）：关注宿舍沿用「宿舍电费」的选择；**可以勾选进首页**（用户可主动选择）
  { key: 'water', name: '水量', ico: '💧', icoImg: '/images/tool-water.png', meta: '每月抄表 · 自动对比 · 水费', desc: '每月手动抄一次水表，自动对比上次算用量；按校方规则（2 吨/人/月免费，超出 3.03 元/吨）估水费与折合扣电', url: '/pages/water/water', tab: false, tone: 'primary' },
  // 2026-11-11 投票（与网页 TOOLS 对齐，契约 web/vote/CONTRACT.md §4.1）：限时/长时、自定义标题与选项、实时结果；
  // 默认不进首页勾选，用户可在「全部工具」编辑首页时主动加入（homeEligible）。
  { key: 'vote', name: '投票', ico: '🗳', icoImg: '/images/tool-vote.png', meta: '限时 · 长时 · 实时结果', desc: '限时/长时投票，自定义标题与选项，全班实时查看结果', url: '/pages/vote/vote', tab: false, tone: 'primary' },
  // 2026-11-12 文件传输=临时云空间（与网页 TOOLS key='file' 对齐）：同账号跨设备自动共享，
  // 无需房间码/链接/配对；任意大小 8MiB 分片上传、单文件删除、清空空间；文件自上传起保留 3 天。
  { key: 'file', name: '文件传输', ico: '☁', icoImg: '/images/tool-file.png', meta: '临时云空间 · 3 天', desc: '同账号跨设备临时云空间：上传/下载/删除文件，任意大小分片上传，文件自上传起保留 3 天', url: '/pages/cloudspace/cloudspace', tab: false, tone: 'primary' },
  { key: 'map', name: '地图', ico: '🗺', icoImg: '/images/tool-map.png', meta: '2.5D · 道路导航', desc: '校园 2.5D 地图、楼栋楼层与按道路步行导航；与课表下一节联动', url: '/pages/map/map', tab: false, tone: 'primary' },
  { key: 'stats', name: '统计',  ico: '📊', icoImg: '/images/tool-stats.png', meta: '访问次数 · 设备 · 版本 · 仅管理员', desc: '按访问次数排序的访问统计（同次数按最近访问；汇总摘要、趋势、登录端、版本/设备分布与账号明细，不显示学号），仅管理员可见', url: '/pages/stats/stats', tab: false, tone: 'primary', admin: true },
  // 2026-11-08 诊断 v2：所有有效班级身份可见（不再仅管理员）；2026-11-22 起可主动勾选进首页
  { key: 'diag', name: '诊断',  ico: '🩺', icoImg: '/images/tool-diag.png', meta: '服务状态 · 设备诊断 · AI 分析', desc: '依赖服务运行状态 + 本机设备诊断 + AI 原因/修复流程；所有已认证同学可查看', url: '/pages/diag/diag', tab: false, tone: 'tertiary' },
  // 2026-11-09 PPT 演示（与网页「演示」同名，契约 web/ppt/CONTRACT.md §8.3）：
  // 上传 .ppt/.pptx → 本机转换机转分步图片 + 外挂媒体 → 任意设备流畅播放；可主动勾选进首页
  { key: 'ppt', name: '演示',  ico: '📽', icoImg: '/images/tool-ppt.png', meta: '上传 PPT · 自动转换 · 分步播放', desc: '上传 PPT 自动转换成分步图片与视频热点；老电脑/手机都能流畅播放，班级共享', url: '/pages/ppt/ppt', tab: false, tone: 'primary' }
];

// 首页最多勾选 4 个工具（UD v6 契约：homeTools ≤ 4，与网页端一致）
const HOME_MAX = 4;
const LEGACY_HOMES = [['draw', 'hw', 'nt'], ['hw', 'nt', 'ft', 'draw']]; // 极旧版默认首页（读到即迁移为默认勾选）
const HIDDEN = [];                      // 课表已正式上线，不再隐藏入口

function toolOf(key) {
  if (key === 'task') key = 'hw';                 // 2026-11-22 旧「任务」独立 key 兼容
  for (let i = 0; i < TOOLS.length; i++) if (TOOLS[i].key === key) return TOOLS[i];
  return null;
}
function isHidden(key) { return HIDDEN.indexOf(key) >= 0; }
function visible(t) { return !!t && !isHidden(t.key); }

// 投票入口（2026-11-21 用户口径）：仅班委可见；普通同学与测试账号在目录/首页/说明里完全隐藏。
// 只影响「入口」展示，不影响 pages/votedetail —— 收到投票或点分享卡片时仍正常进入。
// id 省略时按本机身份判断；传入身份对象便于单测/页面显式判断。
const VOTE_KEY = 'vote';
function entryAllowed(t, id) {
  if (!visible(t)) return false;
  if (t.key === VOTE_KEY && !identity.canUseVote(id)) return false;
  return true;
}
// 可作为首页勾选项：可见、非 noHome、管理员工具仅管理员可勾选（2026-11-22：电费/诊断恢复可勾选，
// 与网页工具栏（电费用短标签「电费」）和安卓端「全部工具」编辑一致；stats 仍是管理员工具）
function homeEligible(t, id) {
  if (!visible(t) || !entryAllowed(t, id) || t.noHome) return false;
  if (!t.admin) return true;
  return (id === undefined) ? identity.isAdmin() : !!(id && id.is_admin);
}

function same(a, b) { return JSON.stringify(a || []) === JSON.stringify(b || []); }

// 默认勾选 = 现有首页前 4 个（store.DEF.homeTools：hw / nt / ft / draw），老用户升级无感知
function defaultHome(id) {
  const store = require('./store.js');
  return normalizeHome(store.DEF.homeTools.slice(), id);
}

// 工具顺序改动后把偏好推到云端（未验证身份/断网/云同步关闭时静默跳过）
// v19：走 userdata v6 的防抖推送（udPushSoon）；没有该接口时退回旧的 pushPrefs。
function syncPrefs() {
  try {
    const cloud = require('./cloud.js');
    if (cloud && cloud.udPushSoon) cloud.udPushSoon();
    else if (cloud && cloud.pushPrefs) cloud.pushPrefs();
  } catch (e) { /* 云端不可用时不影响本机排序 */ }
}

// ---------------------------------------------------------------------------
// toolOrder（本机「全部工具」顺序）
// ---------------------------------------------------------------------------

// 归一：合法可见 key 去重；跨端别名（fit/roster/committee/group）先归一成本机 key；
// 未知/缺失的新工具按 TOOLS 自然顺序补到末尾
function normalizeToolOrder(raw) {
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach(function (k) {
    const lk = localKey(k);
    const t = toolOf(lk);
    if (visible(t) && out.indexOf(lk) < 0) out.push(lk);
  });
  TOOLS.forEach(function (t) { if (visible(t) && out.indexOf(t.key) < 0) out.push(t.key); });
  return out;
}

// 旧数据迁移（幂等；不落盘，由调用方 save）：
//   · 旧版 homeTools = 全部工具全量顺序（≤8）→ 前 4 个「可上首页」= 勾选，全量顺序 = toolOrder；
//   · toolOrder 缺失/脏 → 归一补全。
// 注意：迁移不动 homeToolsAt，交给云端 LWW 与网页端裁决；旧全量顺序视为用户旧偏好，
//       迁移时写 toolOrderSetAt，让「工具页自定义顺序」随账号同步（见 cloud.js prefs.toolOrder）。
function migrateLegacy(d) {
  let changed = false;
  d = d || {};
  if (!Array.isArray(d.toolOrder)) { d.toolOrder = []; changed = true; }
  const home = Array.isArray(d.homeTools) ? d.homeTools.slice() : [];
  if (home.length > HOME_MAX) {
    d.toolOrder = normalizeToolOrder(home);          // 旧的全量顺序 → 本机工具顺序
    d.homeTools = normalizeHome(home);               // 前 4 个可上首页的 key → 勾选
    d.toolOrderSetAt = Number(d.toolOrderSetAt) || Date.now();
    changed = true;
  }
  const norm = normalizeToolOrder(d.toolOrder);
  if (!same(norm, d.toolOrder)) { d.toolOrder = norm; changed = true; }
  return changed;
}

// 保证 store 里的 homeTools / toolOrder 已完成迁移 + 归一（首次调用时可能落盘一次）
function ensure() {
  const store = require('./store.js');
  const d = store.get();
  if (migrateLegacy(d)) store.save();
  return d;
}

function toolOrder() {
  return ensure().toolOrder.slice();
}

// 设置「全部工具」顺序（拖动松手时调用）：只接受合法 key，其余按归一规则补末尾；
// 保存后按新顺序重排 homeTools（勾选集合不变）；homeTools 顺序真的变了才提升 homeToolsAt 并触发同步。
function setToolOrder(keys) {
  const store = require('./store.js');
  const d = ensure();
  const order = normalizeToolOrder(keys);
  if (same(order, d.toolOrder)) return order;
  d.toolOrder = order;
  d.toolOrderSetAt = Date.now();                    // 用户拖过排序 → 参与 UD v6 prefs.toolOrder 同步
  const home = normalizeHome(d.homeTools);
  if (home.length) {
    home.sort(byToolOrder(order));
    if (!same(home, d.homeTools)) {
      d.homeTools = home;
      d.homeToolsAt = Date.now();                    // 首页顺序变了 → 参与 UD v6 LWW
      store.save();
      syncPrefs();
      return order;
    }
  }
  store.save();
  return order;
}

// 把 key 移动到 to 位置（0 起；越界夹紧），其余顺延；勾选集合不变，首页顺序按新工具顺序重排
function moveTool(key, to) {
  const d = ensure();
  if (!toolOf(key)) return d.toolOrder.slice();
  const order = d.toolOrder.slice();
  const i = order.indexOf(key);
  const j = Math.max(0, Math.min(order.length - 1, parseInt(to, 10) || 0));
  if (i < 0 || i === j) return order;
  order.splice(i, 1);
  order.splice(j, 0, key);
  return setToolOrder(order);
}

function byToolOrder(order) {
  return function (a, b) {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
  };
}

// ---------------------------------------------------------------------------
// homeTools（云端勾选集合，≤4）
// ---------------------------------------------------------------------------

// 只做去重/过滤（可见、非 noHome、管理员工具按身份），**只保留前 4 个**，不再自动补齐。
// 2026-11-22：先做跨端 key 归一（安卓 fit/roster/group、网页 committee → 本机 ft/bz/draw），
// 否则安卓端勾选的「体测/名单」会被当未知 key 丢掉，并回推覆盖云端。
function normalizeHome(home, id) {
  const out = [];
  (home || []).forEach(function (k) {
    const lk = localKey(k);
    const t = toolOf(lk);
    if (homeEligible(t, id) && out.indexOf(lk) < 0 && out.length < HOME_MAX) out.push(lk);
  });
  return out;
}

// 当前勾选的首页工具（≤4；顺序 = 本机勾选/工具顺序）。
// 注意：云端/网页写入的顺序照单全收（不在这里按 toolOrder 重排），避免两端来回改写；
// 本机勾选/拖动产生的顺序由 setHomeTool / setToolOrder 保证按 toolOrder 排列。
// 投票入口对普通同学/测试账号隐藏后，历史勾选里的 vote 也会在这里被过滤（不展示、不占首页位）。
function homeTools(id) {
  const store = require('./store.js');
  const d = ensure();
  let next = normalizeHome(d.homeTools, id);
  // 极旧版默认首页（未经过「调整」页）→ 迁移为默认勾选。
  // 必须限定 homeToolsAt===0（从未用户改动过）：否则用户自定义 toolOrder 后把勾选减到
  // draw/hw/nt 这类与旧默认同形的组合时，会被误判成旧数据、每次读取又被补回 4 个。
  if (Number(d.homeToolsAt) === 0 && LEGACY_HOMES.some(function (x) { return same(d.homeTools, x); })) next = defaultHome(id);
  if (!same(next, d.homeTools)) { d.homeTools = next; store.save(); }
  return d.homeTools.slice();
}

function isHome(key) { return homeTools().indexOf(key) >= 0; }

// 勾选/取消勾选首页工具：{ ok, reason: 'changed'|'same'|'max'|'invalid', list }
// 勾勾满 4 个后再勾第 5 个 → ok:false / reason:'max'（页面弹 wx.showToast，不改状态）
function setHomeTool(key, on) {
  const store = require('./store.js');
  const t = toolOf(key);
  const list = homeTools();
  if (!homeEligible(t)) return { ok: false, reason: 'invalid', list: list };
  const i = list.indexOf(key);
  const want = !!on;
  if (want && i >= 0) return { ok: true, reason: 'same', list: list };
  if (!want && i < 0) return { ok: true, reason: 'same', list: list };
  if (want) {
    if (list.length >= HOME_MAX) return { ok: false, reason: 'max', list: list };
    list.push(key);
    list.sort(byToolOrder(ensure().toolOrder));     // 勾选顺序 = 全部工具顺序
  } else {
    list.splice(i, 1);
  }
  const d = store.get();
  d.homeTools = list;
  d.homeToolsAt = Date.now();
  store.save();
  syncPrefs();
  return { ok: true, reason: 'changed', list: list.slice() };
}

// 开关：on 省略 = 取反
function toggleHome(key, on) {
  return setHomeTool(key, on === undefined ? !isHome(key) : on);
}

// 兼容旧接口：勾选集合（工具对象列表）
function homeList() {
  return homeTools().map(toolOf).filter(function (t) { return homeEligible(t); });
}

// 工作台 / 工具页「首页快捷」：当前勾选的工具（顺序 = 勾选顺序），cap 上限仍受 HOME_MAX=4 约束
function quickList(n, id) {
  const cap = Math.max(1, Math.min(HOME_MAX, +n || HOME_MAX));
  return homeTools(id).slice(0, cap).map(toolOf).filter(function (t) { return homeEligible(t, id); });
}

// 工具页目录：全部可见工具（含管理员工具，由页面按身份决定是否渲染），按本机 toolOrder 排列
function catalog(id) {
  return toolOrder().map(toolOf).filter(function (t) { return entryAllowed(t, id); });
}

module.exports = {
  TOOLS: TOOLS, HOME_MAX: HOME_MAX, HIDDEN: HIDDEN, toolOf: toolOf, isHidden: isHidden,
  visible: visible, entryAllowed: entryAllowed, homeEligible: homeEligible,
  localKey: localKey, syncKey: syncKey, fromSyncKeys: fromSyncKeys, toSyncKeys: toSyncKeys,
  defaultHome: defaultHome, normalizeHome: normalizeHome, homeTools: homeTools,
  normalizeToolOrder: normalizeToolOrder, migrateLegacy: migrateLegacy,
  toolOrder: toolOrder, setToolOrder: setToolOrder, moveTool: moveTool,
  isHome: isHome, setHomeTool: setHomeTool, toggleHome: toggleHome,
  homeList: homeList, quickList: quickList, catalog: catalog
};
