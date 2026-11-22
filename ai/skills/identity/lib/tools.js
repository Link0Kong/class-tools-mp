// ai/skills/identity/lib/tools.js —— 工具目录（AI 原子接口内的只读副本）
//
// 原子接口环境不能 require 主包 utils/tools.js，因此这里维护一份与主包逐字一致的目录文案。
// 主包 utils/tools.js 是唯一真源：若工具名称/描述/顺序调整，这里同步（属于「发布前两处同改」清单）。
const TOOLS = [
  { key: 'tt', name: '课表', cat: '学习', desc: '班级课表与下一节课；教务自动同步，全员查看', admin: false },
  { key: 'hw', name: '作业板', cat: '学习', desc: '作业清单与截止倒计时；查看与勾选完成，验证身份后可发布', admin: false },
  { key: 'nt', name: '班级通知', cat: '学习', desc: '云端班级通知；AI 拆分、附件预览、原始消息', admin: false },
  { key: 'ft', name: '体测', cat: '健康', desc: '大学体测七项算分、附加分与等级，实时出分', admin: false },
  { key: 'draw', name: '抽签', cat: '班级事务', desc: '抽号并保存结果；可剔除补抽、存证核验、分享卡片或长图', admin: false },
  { key: 'group', name: '分组', cat: '班级事务', desc: '全班 / 最近抽签 / 自选名单一键分组；按组数或每组人数，可复制与分享', admin: false },
  { key: 'roll', name: '点名', cat: '班级事务', desc: '线下点名核对：叫到一个勾一个，可到/请假，已处理自动沉底', admin: false },
  { key: 'bz', name: '名单', cat: '班级事务', desc: '班级名单三分类（班委 / 团员 / 全班）；所有已认证同学都可查看', admin: false },
  { key: 'stats', name: '统计', cat: '管理', desc: '按姓名聚合的访问统计（不显示学号），仅管理员可见', admin: true }
];

const HOME_MAX = 8;                          // 主包首页最多展示的工具数
const HOME_SHOW = 4;                         // 工作台实际展示前 4 个
const LEGACY_HOMES = [['draw', 'hw', 'nt'], ['hw', 'nt', 'ft', 'draw']];

function toolOf(key) {
  for (let i = 0; i < TOOLS.length; i++) if (TOOLS[i].key === key) return TOOLS[i];
  return null;
}
function visible(t, admin) { return !!t && (!t.admin || !!admin); }
function defaultHome() {
  return TOOLS.filter(function (t) { return !t.admin; }).map(function (t) { return t.key; });
}
function same(a, b) { return JSON.stringify(a || []) === JSON.stringify(b || []); }
function normalizeHome(home) {
  const out = [];
  (home || []).forEach(function (k) {
    const t = toolOf(k);
    if (t && !t.admin && out.indexOf(k) < 0 && out.length < HOME_MAX) out.push(k);
  });
  TOOLS.forEach(function (t) {
    if (!t.admin && out.length < HOME_MAX && out.indexOf(t.key) < 0) out.push(t.key);
  });
  return out.slice(0, HOME_MAX);
}
// 工作台快捷：homeTools 归一化后的前 4 个
function quickList(home, n) {
  let list = normalizeHome(home);
  if (LEGACY_HOMES.some(function (x) { return same(home, x); })) list = defaultHome();
  const cap = Math.max(1, Math.min(HOME_SHOW, +n || HOME_SHOW));
  return list.slice(0, cap).map(toolOf).filter(Boolean).map(function (t) {
    return { key: t.key, name: t.name };
  });
}
// 全部工具目录（管理员才包含“统计”）
function catalog(admin) {
  return TOOLS.filter(function (t) { return visible(t, admin); }).map(function (t) {
    return { key: t.key, name: t.name, cat: t.cat, desc: t.desc };
  });
}

module.exports = {
  TOOLS: TOOLS, HOME_MAX: HOME_MAX, HOME_SHOW: HOME_SHOW,
  toolOf: toolOf, normalizeHome: normalizeHome, quickList: quickList, catalog: catalog
};
