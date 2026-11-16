// ai/skills/identity/apis/getUsageGuide.js —— 使用说明（原子接口，纯静态文案，不强制身份）
//
// 内容来源：主包 pages/ug/ug.js 的 12 条说明 + pages/data/data.js 的同步/隐私口径。
// 只做「按章节取文案」，不含任何用户数据；未验证身份也可调用，便于新用户先了解功能。
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');

const SECTIONS = [
  {
    key: 'identity', title: '① 班级身份',
    content: '打开小程序先进入身份界面：输入真实姓名 + 10 位学号，通过云端班级名单校验后进入工作台。身份只用于名单校验，页面只显示姓名与角色、不显示学号；换人使用时在「我的」退出身份。'
  },
  {
    key: 'features', title: '② 工作台',
    content: '工作台只放今天要做的事：今日课程、作业待交、通知待处理，外加 4 个常用工具。其余功能在「工具」，身份与数据在「我的」。'
  },
  {
    key: 'features', title: '③ 抽签',
    content: '设好范围、个数与参与名单后开始抽签。选了参与名单就只从名单里的人抽（结果带姓名），不选则只抽序号。结果可左滑剔除；打开「剔除后自动重抽」会补一个，也可点「补抽」。'
  },
  {
    key: 'features', title: '④ 名单',
    content: '名单不再手工输入：点「选择名单」弹出班级名单（70 人）的液态气泡，逐个点选或一键全选，已选的人以气泡摘要显示。名单只来自班级身份下发的 class_members，不再支持自定义或粘贴。'
  },
  {
    key: 'features', title: '⑤ 分组 / 结果单',
    content: '抽签后点「下一步 · 分组」，成员来源可选「上一步抽签」或「班级名单」；可按组数或每组人数分；结果单可复制，也可导出图片。'
  },
  {
    key: 'features', title: '⑥ 作业 / 通知',
    content: '验证身份后可以发布，发布后全员同步。删除时：管理员和发布者删掉后所有人都看不到；其他人只能隐藏自己的那一条。通知已处理 / 置顶状态按账号同步。'
  },
  {
    key: 'features', title: '⑦ 名单',
    content: '查看班级里填写了职务的成员，姓名旁用文字气泡标出角色 / 徽章；所有已验证身份的同学都能查看。'
  },
  {
    key: 'features', title: '⑧ 工具与排序',
    content: '「工具」页是全部功能目录：长按工具可拖动排序；点右上「编辑首页」进入编辑模式后，点工具可勾选/取消首页快捷（最多 4 个），点「完成」退出。勾选结果在工作台「常用工具」展示。'
  },
  {
    key: 'features', title: '⑨ 体测',
    content: '填入任意一项就实时算单项分；全部填完后显示总分和等级。长跑按「分 : 秒」填写。历史最多两条，可回填、改名。'
  },
  {
    key: 'features', title: '⑩ 反馈建议',
    content: '写下问题或建议提交；可查看自己的反馈记录，管理员可看到全部并标记已处理。'
  },
  {
    key: 'features', title: '⑪ 点名',
    content: '点「选择名单」从班级名单里逐个选或全选，点「沿用抽签名单」直接用抽签页的参与名单；点「到 / 假」记录，已处理的自动沉底，再点一次可撤销。名单与记录按账号同步。'
  },
  {
    key: 'features', title: '⑫ 分享',
    content: '右上角「···」可转发给朋友或分享到朋友圈；每个页面都带好了标题、封面和打开路径，课表会带上当前周次，通知会带最新一条标题。'
  },
  {
    key: 'sync', title: '云同步',
    content: '在「我的 → 数据与隐私」可查看同步状态、立即同步、关闭云同步（关闭后仅本机，恢复后自动补推）。同步范围：作业完成、通知已处理、通知置顶、工具栏顺序、体测录入、抽签参数、分组与名单、点名名单与到·假、隐藏项、课表偏好、通知提醒偏好、昵称；网页与小程序使用同一账号互通。'
  },
  {
    key: 'privacy', title: '数据与隐私',
    content: '身份 token、班级名单缓存、设备标识只保存在本机。页面与导出不显示学号、手机号、名单原文。可在「数据与隐私」导出我的数据（JSON）、清除云端我的数据（访问统计与反馈无法删除）、清除本机数据（保留身份）。'
  },
  {
    key: 'tools', title: '常用入口',
    content: '工作台：今日课程 / 待办 / 常用工具；工具页：全部功能与首页排序；我的页：身份、我的数据四项、云同步、数据与隐私、反馈与使用说明。'
  }
];

function pick(section) {
  const key = String(section == null ? 'all' : section).trim();
  if (!key || key === 'all') return SECTIONS.slice();
  return SECTIONS.filter(function (s) { return s.key === key; });
}

module.exports = function getUsageGuide(args) {
  const a = args || {};
  const allowed = ['all', 'identity', 'sync', 'privacy', 'features', 'tools'];
  const section = String(a.section == null ? 'all' : a.section).trim();
  if (allowed.indexOf(section) < 0) {
    return result.invalid('section 取值应为：' + allowed.join('、') + '。请按接口说明重新传参。');
  }
  const list = pick(section);
  const sections = list.map(function (s) { return { title: s.title, content: s.content }; });
  const s = {
    sections: sections,
    pagePath: handoff.PAGES.ug,
    pageTitle: '使用说明'
  };
  const titles = sections.map(function (s2) { return s2.title; }).join('、');
  const text = '已为你整理' + (section === 'all' ? '完整使用说明' : '「' + section + '」相关说明') +
    '（' + sections.length + ' 节：' + titles + '）。需要更具体的功能用法可以继续问。';
  return result.ok(text, s, {
    _meta: { cardData: { count: sections.length, titles: sections.map(function (s2) { return s2.title; }) } },
    handoff: handoff.handoffTo('ug', '', {})
  });
};
