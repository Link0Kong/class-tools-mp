// ai/skills/lottery/apis/runGroup.js —— 分组（最近抽签序号 / 班级名单已选座号）
const local = require('../../../common/local.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const algo = require('../lib/algo.js');
const guard = require('../lib/guard.js');

module.exports = guard.run(async function runGroup(args) {
  const mode = String(args.mode == null ? '' : args.mode);
  if (mode !== 'groups' && mode !== 'size') {
    return result.invalid('mode 只能为 groups（按组数）或 size（按每组人数）。');
  }
  const value = algo.intOf(args.value);
  if (value == null || value <= 0) {
    return result.invalid('value 需为正整数：mode=groups 时是组数（至少 2），mode=size 时是每组人数（至少 1）。');
  }
  const sourceIn = args.source == null ? 'prev' : String(args.source);
  if (sourceIn !== 'prev' && sourceIn !== 'roster') {
    return result.invalid('source 只能为 prev（最近抽签序号）或 roster（班级名单已选座号）。');
  }
  const shuffle = args.shuffle === true;

  // 已有分组结果 → 覆盖需用户确认
  const fl0 = local.getFlow();
  const existing = !!(fl0.group && fl0.group.result && fl0.group.result.length);
  if (existing && args.confirmed !== true) {
    return result.needConfirm('已有分组结果 ' + fl0.group.result.length + ' 组，重新分组会覆盖旧结果。请先向用户确认是否覆盖；用户确认后再调用 runGroup 并传 confirmed=true。');
  }

  let mem;
  if (sourceIn === 'roster') {
    let seats;
    if (Array.isArray(args.rosterSeats)) {
      const r = algo.resolveSeats(args.rosterSeats);
      if (r.req.length && r.membersEmpty) {
        return result.invalid('班级名单尚未同步，无法按座号分组。请先完成身份验证同步班级名单，或省略 rosterSeats 沿用本机已选分组名单。');
      }
      if (r.unknown.length) {
        return result.invalid('座号 ' + r.unknown.join('、') + ' 不在班级名单中，请从班级名单里重新选择座号。');
      }
      seats = algo.setGroupSel(r.seats);
    } else {
      if (args.rosterSeats != null && args.rosterSeats !== 'current') {
        return result.invalid('rosterSeats 需为座号数组，或传 "current"（沿用本机已选分组名单），或省略。');
      }
      seats = algo.groupSelSeats();
    }
    const picked = algo.pickedOf(seats);
    if (!picked.length) {
      return result.invalid('还没有选择分组用的班级名单座号。请先在分组页选择成员，或传 rosterSeats 指定座号（至少 2 人）。');
    }
    if (picked.length < 2) return result.invalid('名单至少要有 2 人才能分组（当前 ' + picked.length + ' 人）。');
    mem = picked.map(function (m) { return { n: m.seat, nm: m.name }; });
  } else {
    mem = algo.prevMembers();
    if (!mem) {
      return result.invalid('还没有最近抽签结果，无法用最近抽签序号分组。可先调用 runDraw 抽签，或改用 source=roster 从班级名单分组（分组不依赖抽签）。');
    }
  }

  const pageSource = sourceIn === 'roster' ? 'pick' : 'prev';
  const pageMode = mode === 'size' ? 'per' : 'groups';
  algo.saveGroup({ source: pageSource, mode: pageMode, n: value, shuffle: shuffle });
  const g = algo.doGroup({ source: pageSource, mem: mem, mode: pageMode, value: value, shuffle: shuffle });
  algo.patchGroup(g.st);

  const info = algo.groupInfo(g.st);
  const pg = guard.page('group');
  const data = {
    groups: info.groups,
    mode: mode,
    value: value,
    groupCount: g.groups,
    total: mem.length,
    shuffle: shuffle,
    source: sourceIn,
    cfg: g.st.cfg,
    pagePath: pg.pagePath,
    pageTitle: pg.pageTitle
  };
  const content = '已分 ' + g.groups + ' 组（共 ' + mem.length + ' 人，来源：' + (sourceIn === 'prev' ? '最近抽签' : '班级名单') +
    '，' + (shuffle ? '打乱后随机分配' : '按原顺序轮流分配') + '）。可打开分组页查看 / 复制 / 分享，或调用 getResultSummary 生成文字摘要。';
  return result.ok(content, data, { handoff: handoff.handoffTo('group') });
}, '分组结果');
