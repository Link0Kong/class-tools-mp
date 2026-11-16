// ai/skills/identity/apis/getWorkspaceOverview.js —— 工作台总览（原子接口）
//
// 口径与主包 pages/index/index.js 一致：
//   今日课程 / 下一节课 ← utils/ttplan.plan（这里用 lib/ttplan.js 的同步副本）；
//   作业待交 ← 未完成、未隐藏、未过期的作业（截止后 3 天视为过期）；
//   通知待处理 ← [[CLASS_NOTICE_V1]] 组 + fmt.noticeStatOf / noticeMostUrgent（与主包通知页口径一致）。
// 网络不可用时全部回退本机缓存，接口仍然成功返回（content 如实说明）。
const auth = require('../../../common/auth.js');
const local = require('../../../common/local.js');
const fmt = require('../../../common/fmt.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const tools = require('../lib/tools.js');
const ttplan = require('../lib/ttplan.js');
const workspace = require('../lib/workspace.js');

function subjectOf(h) {
  const s = String((h && (h.subject || h.content)) || '').trim();
  return s.length > 18 ? s.slice(0, 18) + '…' : s;
}

function hwOpenList(d, now) {
  const done = d.hwDone || {};
  const hide = d.hwHide || {};
  return (d.homework || []).filter(function (h) {
    if (!h) return false;
    if (h.id && hide[h.id]) return false;
    const isDone = h.id ? !!done[h.id] : !!h.done;
    if (isDone) return false;
    if (fmt.hwExpired(h, now)) return false;      // 截止 3 个完整天后自动清除（与主包 pruneHomework 一致）
    return true;
  }).sort(function (a, b) {
    const x = fmt.hwDue(a), y = fmt.hwDue(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return x - y;
  });
}

module.exports = function getWorkspaceOverview() {
  const id = auth.getIdentity();
  if (!id) return result.identityFail();

  const now = new Date();
  const nowTs = now.getTime();
  return Promise.all([
    workspace.loadHomework(),
    workspace.loadNoticeGroups(),
    workspace.loadTimetable()
  ]).then(function (r) {
    const d = local.readStore();
    const courses = r[2] ? (r[2].c || []) : [];
    const term = (r[2] && r[2].t) || d.termStart || '';
    const plan = ttplan.plan(courses, term, now);
    const week = plan.week || 0;

    // —— 作业待交 ——
    const open = hwOpenList(d, nowTs);
    const hwTop = open[0] || null;
    const hwMostUrgent = hwTop ? { id: hwTop.id || '', subject: subjectOf(hwTop), left: fmt.hwDueInfo(hwTop, nowTs).txt } : null;

    // —— 通知待处理（null = 拿不到通知数据） ——
    const groups = r[1];
    const ntKnown = Array.isArray(groups);
    const ntDone = d.ntDone || {};
    let ntPending = 0;
    let ntMostUrgent = null;
    if (ntKnown) {
      const stat = fmt.noticeStatOf(groups, ntDone, nowTs);
      ntPending = stat.pending;
      const u = fmt.noticeMostUrgent(groups, ntDone);
      if (u) {
        const st = fmt.noticeStatusOf(u, nowTs);
        const title = String(u.title || '班级通知');
        ntMostUrgent = { id: u.id || '', title: title.length > 30 ? title.slice(0, 30) + '…' : title, statusText: st.label };
      }
    }

    // —— 今日课程 / 下一节 ——
    const todayCourses = (plan.today || []).map(function (c) {
      return { name: c.name, room: c.room, startText: c.startText, endText: c.endText, span: c.span, state: c.state };
    });
    const nextCourse = plan.next ? {
      name: plan.next.name, teacher: plan.next.teacher || '', room: plan.next.room,
      dayText: plan.next.dayText, dateText: plan.next.dateText, span: plan.next.span,
      startText: plan.next.startText, endText: plan.next.endText
    } : null;

    const homeTools = tools.quickList(d.homeTools, 4);
    const s = {
      week: week,
      todayCourses: todayCourses,
      nextCourse: nextCourse,
      hwPending: open.length,
      hwMostUrgent: hwMostUrgent,
      ntPending: ntPending,
      ntMostUrgent: ntMostUrgent,
      homeTools: homeTools,
      pagePath: handoff.PAGES.index,
      pageTitle: '工作台'
    };

    // —— content：事实 + 下一步 ——
    const parts = [];
    parts.push(week ? ('现在是第 ' + week + ' 周。') : '还没有设置开学日期，暂时算不出周次。');
    if (!courses.length) parts.push('本机还没有课表缓存。');
    else if (!todayCourses.length) parts.push('今天没有课。');
    else {
      const live = todayCourses.filter(function (c) { return c.state !== 'done'; })[0];
      parts.push('今天 ' + todayCourses.length + ' 节课' + (live ? '，接下来是「' + live.name + '」（' + live.startText + '-' + live.endText + '，' + live.room + '）' : '，都已经结束') + '。');
    }
    if (nextCourse) parts.push('下一节：' + nextCourse.dayText + ' ' + nextCourse.span + '「' + nextCourse.name + '」' + (nextCourse.room ? '（' + nextCourse.room + '）' : '') + '。');
    parts.push('作业待交 ' + open.length + ' 条' + (hwMostUrgent ? '（最紧：' + hwMostUrgent.subject + '，' + hwMostUrgent.left + '）' : '') + '。');
    if (ntKnown) parts.push('通知待处理 ' + ntPending + ' 条' + (ntMostUrgent ? '（最紧：' + ntMostUrgent.title + ' · ' + ntMostUrgent.statusText + '）' : '') + '。');
    else parts.push('通知数据暂时无法同步（可能是网络不可用），待处理数量未统计。');
    parts.push('需要明细可以分别查看作业、通知或课表。');

    return result.ok(parts.join(''), s, {
      _meta: { cardData: { week: week, todayCourses: todayCourses, nextCourse: nextCourse, hwPending: open.length, hwMostUrgent: hwMostUrgent, ntPending: ntPending, ntMostUrgent: ntMostUrgent, homeTools: homeTools } },
      handoff: handoff.handoffTo('index', '', { week: week, hwPending: open.length, ntPending: ntPending })
    });
  });
};
