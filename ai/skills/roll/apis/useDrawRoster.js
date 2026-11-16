// ai/skills/roll/apis/useDrawRoster.js —— 沿用抽签页参与名单作为点名名单
const result = require('../../../common/result.js');
const auth = require('../../../common/auth.js');
const handoff = require('../../../common/handoff.js');
const local = require('../../../common/local.js');
const roll = require('../lib/roll.js');

module.exports = async function useDrawRoster() {
  if (!auth.hasIdentity()) return result.identityFail();
  const store = local.readStore();
  const draw = roll.drawSeats(store);
  if (!draw.length) {
    return result.fail('抽签页还没有选择参与名单，无法沿用到点名。请先打开抽签页完成名单选择，再让我沿用；也可以改为指定座号或使用全班名单。', 'empty-draw');
  }
  if (!roll.classSeats().length) {
    return result.fail('本机还没有班级名单（classMembers），无法校验抽签名单。请先在小程序里完成身份验证并同步名单后再试。', 'empty-members');
  }
  const written = roll.writeRoll(draw);
  const text = '已沿用抽签页参与名单作为点名名单，共 ' + written.seats.length + ' 人。' +
    (written.preserved > 0 ? '原有到/假记录已按姓名保留 ' + written.preserved + ' 条。' : '') +
    roll.syncNote() + '现在可以开始点到了。';

  return result.ok(text, {
    ok: true,
    seats: written.seats,
    count: written.seats.length,
    source: 'draw',
    counts: written.counts,
    preserved: written.preserved,
    pagePath: handoff.PAGES.roll,
    linkText: '打开点名页'
  }, {
    handoff: handoff.handoffTo('roll', '', { seats: written.seatsNum, items: roll.stateItems() })
  });
};
