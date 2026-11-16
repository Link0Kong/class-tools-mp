// ai/skills/roll/apis/getRollRoster.js —— 当前点名名单（座号 + 姓名）与来源
const result = require('../../../common/result.js');
const auth = require('../../../common/auth.js');
const handoff = require('../../../common/handoff.js');
const local = require('../../../common/local.js');
const roll = require('../lib/roll.js');

module.exports = async function getRollRoster() {
  if (!auth.hasIdentity()) return result.identityFail();
  const store = local.readStore();
  const seats = roll.effectiveSeats(store);
  const rows = roll.rowsOf(seats);
  const source = roll.inferSource(store, seats);
  const counts = roll.countsOf(seats, store.rollSt || {});
  let text;
  if (!rows.length) {
    text = '还没有点名名单。可以从班级名单里选人（让我把座号设进名单），或沿用抽签页已选的参与名单。';
  } else {
    text = '点名名单共 ' + rows.length + ' 人' +
      (source === 'draw' ? '（沿用抽签页参与名单）' : '（来自班级名单）') + '。' +
      roll.countsText(counts) + '。';
  }
  return result.ok(text, {
    seats: rows,
    count: rows.length,
    source: source,
    counts: counts,
    namesText: roll.textOf(seats),
    pagePath: handoff.PAGES.roll,
    linkText: '打开点名页'
  }, {
    handoff: handoff.handoffTo('roll', '', {
      seats: rows.map(function (r) { return r.seat; }),
      items: roll.stateItems()
    })
  });
};
