// ai/skills/roll/apis/setRollRoster.js —— 设置点名名单（seats 座号数组 / source=current|draw|class）
// 写本机 store.rollSel + 派生 rollNames（"座号 姓名" 多行），并按姓名保留 到/假 状态（对齐 utils/roster.writeRoll）
const result = require('../../../common/result.js');
const auth = require('../../../common/auth.js');
const handoff = require('../../../common/handoff.js');
const local = require('../../../common/local.js');
const roll = require('../lib/roll.js');

function out(seatsNum, source, counts, extra) {
  const rows = roll.rowsOf(seatsNum);
  return Object.assign({
    ok: true,
    seats: rows,
    count: rows.length,
    source: source,
    counts: counts,
    pagePath: handoff.PAGES.roll,
    linkText: '打开点名页'
  }, extra || {});
}

module.exports = async function setRollRoster(args) {
  if (!auth.hasIdentity()) return result.identityFail();
  args = args || {};
  const hasSeats = Object.prototype.hasOwnProperty.call(args, 'seats') && args.seats !== undefined && args.seats !== null;
  if (hasSeats && !Array.isArray(args.seats)) {
    return result.invalid('seats 需为座号数组（如 [1,2,7]）。不传 seats 时可用 source=draw/class/current。');
  }
  const source = args.source;
  if (source !== undefined && source !== null && source !== '' && ['current', 'draw', 'class'].indexOf(source) < 0) {
    return result.invalid('source 只能是 current（保持当前名单）、draw（沿用抽签名单）、class（全班名单）。');
  }
  const store = local.readStore();
  const clsSeats = roll.classSeats();

  let target = null;
  if (hasSeats) {
    target = args.seats;
  } else if (source === 'current') {
    const seats = roll.effectiveSeats(store);
    const counts = roll.countsOf(seats, store.rollSt || {});
    return result.ok(
      seats.length ? ('点名名单没有变化，仍是 ' + seats.length + ' 人。' + roll.countsText(counts) + '。')
        : '当前还没有点名名单。可以从班级名单里选人，或沿用抽签页参与名单。',
      out(seats, roll.inferSource(store, seats), counts),
      { handoff: handoff.handoffTo('roll', '', { seats: seats }) }
    );
  } else if (source === 'draw') {
    target = roll.drawSeats(store);
    if (!target.length) {
      return result.fail('抽签页还没有选择参与名单，无法沿用。请先打开抽签页完成名单选择，再让我沿用到点名；也可以指定座号或使用全班名单。', 'empty-draw');
    }
  } else if (source === 'class') {
    target = clsSeats;
    if (!target.length) {
      return result.fail('本机还没有班级名单（classMembers），无法设置全班名单。请先在小程序里完成身份验证并同步名单后再试。', 'empty-members');
    }
  } else {
    return result.invalid('请提供 seats（座号数组），或 source=current/draw/class 之一。');
  }

  const norm = roll.normSeats(target);
  if (norm.length && !clsSeats.length) {
    return result.fail('本机还没有班级名单（classMembers），无法校验/填入座号。请先在小程序里完成身份验证并同步名单后再试。', 'empty-members');
  }
  const picked = roll.pickedOf(norm);
  if (norm.length && !picked.length) {
    return result.invalid('这些座号都不在班级名单里。当前可用座号示例：' + clsSeats.slice(0, 15).join('、') +
      (clsSeats.length > 15 ? ' 等' : '') + '。请确认座号后重试。');
  }
  const ignored = norm.length - picked.length;
  const written = roll.writeRoll(picked.map(function (m) { return m.seat; }));
  const sourceOut = (source === 'draw' || source === 'class')
    ? source
    : roll.inferSource(local.readStore(), written.seatsNum);

  let text = '点名名单已更新为 ' + written.seats.length + ' 人' +
    (sourceOut === 'draw' ? '（沿用抽签页参与名单）' : '（来自班级名单）') + '。';
  if (ignored > 0) text += '已忽略 ' + ignored + ' 个不在班级名单里的座号；';
  if (written.preserved > 0) text += '原有到/假记录已按姓名保留 ' + written.preserved + ' 条。';
  text += roll.syncNote() + '现在可以开始点到了。';

  return result.ok(text, out(written.seatsNum, sourceOut, written.counts, {
    ignored: ignored,
    preserved: written.preserved,
    namesText: written.rollNames
  }), {
    handoff: handoff.handoffTo('roll', '', { seats: written.seatsNum, items: roll.stateItems() })
  });
};
