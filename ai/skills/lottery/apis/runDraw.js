// ai/skills/lottery/apis/runDraw.js —— 执行抽签
const local = require('../../../common/local.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const algo = require('../lib/algo.js');
const guard = require('../lib/guard.js');

module.exports = guard.run(async function runDraw(args) {
  const cur = algo.loadDraw();
  const start = args.start == null ? cur.start : algo.numOf(args.start);
  const end = args.end == null ? cur.end : algo.numOf(args.end);
  if (start == null || end == null) {
    return result.invalid('抽签范围 start / end 需为数字序号（例如 1 和 70）。省略则沿用当前配置。');
  }
  const lo = Math.min(start, end), hi = Math.max(start, end);
  if (lo < 1 || !isFinite(lo) || hi - lo + 1 > 100000) {
    return result.invalid('抽签范围无效：起止序号需为正整数且范围不超过 10 万个序号（当前 ' + start + ' – ' + end + '）。');
  }

  const n = algo.intOf(args.count);
  if (n == null || n <= 0) return result.invalid('抽取个数 count 需为正整数，例如「抽 10 个」传 10。');
  if (n > 10000) return result.invalid('抽取个数 count 过大，最多 10000 个。');

  const dup = args.allowDuplicate === true;
  let sortKey = args.sort == null ? cur.sort : String(args.sort);
  if (args.sort == null && sortKey === 'rand') sortKey = 'draw';   // 页面当前停在「随机打乱」时按抽取顺序出结果
  if (['draw', 'num', 'desc'].indexOf(sortKey) < 0) {
    return result.invalid('sort 只能为 draw（按抽取顺序）、num（按序号升序）或 desc（从大到小）。');
  }
  const excl = String(args.exclude == null ? '' : args.exclude).replace(/[^\d,，\s\-~—]/g, '').slice(0, 100);

  // 已有结果 → 覆盖需用户确认（绝不静默覆盖）
  const fl0 = local.getFlow();
  const existing = !!(fl0.draw && fl0.draw.result && fl0.draw.result.length);
  if (existing && args.confirmed !== true) {
    return result.needConfirm('已有抽签结果 ' + fl0.draw.result.length + ' 个，重新抽签会覆盖旧结果。请先向用户确认是否覆盖；用户确认后再调用 runDraw 并传 confirmed=true。');
  }

  // 参与名单：数组 = 显式座号；'current' / 省略 = 沿用本机已选名单
  let sel;
  if (Array.isArray(args.rosterSeats)) {
    const r = algo.resolveSeats(args.rosterSeats);
    if (r.req.length && r.membersEmpty) {
      return result.invalid('班级名单尚未同步，无法按座号指定参与名单。请先在身份验证后同步班级名单，或省略 rosterSeats 沿用本机已选名单。');
    }
    if (r.unknown.length) {
      return result.invalid('座号 ' + r.unknown.join('、') + ' 不在班级名单中，请从 getDrawConfig 返回的 rosterSeats 或班组名单里选择座号。');
    }
    sel = algo.setRosterSel(r.seats);
  } else {
    if (args.rosterSeats != null && args.rosterSeats !== 'current') {
      return result.invalid('rosterSeats 需为座号数组，或传 "current"（沿用本机已选名单），或省略。');
    }
    sel = algo.selSeats();
  }

  // 与页面 saveCfg 一致：先落盘参数，再校验抽签池
  algo.saveDraw({ start: start, end: end, count: n, dup: dup, excl: excl, sort: sortKey, autoRe: cur.autoRe });
  const b = algo.buildPool(start, end, excl, sel);
  if (!b.pool.length) {
    return result.invalid(b.sel.length ? '名单内没有可用序号，请检查范围 / 排除设置。' : '排除后没有可用序号，请检查范围 / 排除设置。');
  }
  if (!dup && n > b.pool.length) {
    return result.invalid((b.sel.length ? '名单内可用人数 ' : '可用序号只有 ') + b.pool.length +
      ' 个，不能取 ' + n + ' 个（可打开「允许重复」后重试）。');
  }

  const st = algo.doDraw({ pool: b, n: n, dup: dup, sort: sortKey });
  const flow = algo.patchDraw(st);
  const rows = algo.drawRows(st, sortKey);
  const named = rows.filter(function (r) { return !!r.nm; }).length;
  const pg = guard.page('draw');
  const data = {
    items: algo.itemsOf(rows),
    poolSize: b.pool.length,
    cfg: st.cfg,
    steps: algo.steps(),
    drawnAt: flow.updatedAt,
    pagePath: pg.pagePath,
    pageTitle: pg.pageTitle
  };
  const content = '抽签完成：共 ' + rows.length + ' 个结果' + (named ? ('（' + named + ' 个带姓名）') : '') +
    '，抽签池 ' + b.pool.length + ' 个。下一步：需要分组时调用 runGroup，或打开抽签页查看结果。';
  return result.ok(content, data, { handoff: handoff.handoffTo('draw', 'step=1') });
}, '抽签结果');
