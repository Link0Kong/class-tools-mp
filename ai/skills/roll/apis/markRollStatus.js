// ai/skills/roll/apis/markRollStatus.js —— 标记单个座号的到/假
const result = require('../../../common/result.js');
const auth = require('../../../common/auth.js');
const handoff = require('../../../common/handoff.js');
const local = require('../../../common/local.js');
const roll = require('../lib/roll.js');

const INPUT_STATUS = { present: 'in', absent: 'ab' };

module.exports = async function markRollStatus(args) {
  if (!auth.hasIdentity()) return result.identityFail();
  args = args || {};
  const seat = Number(args.seat);
  if (!isFinite(seat) || !Number.isInteger(seat) || seat < 1) {
    return result.invalid('seat 需为座号（正整数），取值来自 getRollRoster 返回的 seats[].seat。');
  }
  const code = INPUT_STATUS[args.status];
  if (!code) {
    return result.invalid('status 只能是 present（到）或 absent（假）。');
  }
  const store = local.readStore();
  const seats = roll.effectiveSeats(store);
  if (!seats.length) {
    return result.invalid('当前还没有点名名单。请先调用 setRollRoster 设置名单（可用 source=draw 沿用抽签名单），再点到。');
  }
  const idx = seats.indexOf(seat);
  if (idx < 0) {
    return result.invalid('座号 ' + seat + ' 不在当前点名名单里。当前名单座号：' +
      seats.slice(0, 20).join('、') + (seats.length > 20 ? ' 等' : '') + '。');
  }
  // 旧数据只有 rollNames 没有 rollSel 时先归一化（按姓名保留状态，与 pages/roll 渲染口径一致）
  if (!roll.normSeats(store.rollSel).length) roll.writeRoll(seats);
  const r = roll.setStatus(seat, code);
  if (!r) return result.invalid('座号 ' + seat + ' 不在当前点名名单里，请先调用 getRollRoster 确认名单。');

  const name = (roll.rowsOf(seats).filter(function (x) { return x.seat === seat; })[0] || {}).name || '';
  const statusText = roll.STATUS_TEXT[code];
  const text = '已把 ' + seat + ' 号' + (name ? ' ' + name : '') + ' 标记为' + statusText + '。当前 ' +
    roll.countsText(r.counts) + '。' + (local.getCloudOff() ? '云同步已关闭，仅保存在本机。' : '');

  return result.ok(text, {
    ok: true,
    seat: seat,
    name: name,
    status: code === 'in' ? 'present' : 'absent',
    statusText: statusText,
    counts: r.counts,
    pagePath: handoff.PAGES.roll,
    linkText: '打开点名页'
  }, {
    handoff: handoff.handoffTo('roll', '', { seat: seat, status: code, items: roll.stateItems() })
  });
};
