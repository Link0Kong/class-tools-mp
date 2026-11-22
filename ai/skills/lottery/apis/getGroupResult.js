// ai/skills/lottery/apis/getGroupResult.js —— 读取当前分组结果
const local = require('../../../common/local.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const algo = require('../lib/algo.js');
const guard = require('../lib/guard.js');

module.exports = guard.run(async function getGroupResult() {
  const fl = local.getFlow();
  const st = fl.group;
  const pg = guard.page('group');
  const base = { pagePath: pg.pagePath, pageTitle: pg.pageTitle };

  if (!st || !st.result || !st.result.length) {
    const data = Object.assign({
      exists: false, groups: [], source: null, mode: null, value: null, shuffle: false, cfg: null
    }, base);
    return result.ok('还没有分组结果。分组不依赖抽签：可用全班、最近抽签或班级名单，打开分组页或调用 runGroup 即可。', data,
      { handoff: handoff.handoffTo('group') });
  }

  const info = algo.groupInfo(st);
  const data = Object.assign({
    exists: true,
    groups: info.groups,
    source: info.source,
    mode: info.mode,
    value: info.value,
    shuffle: info.shuffle,
    cfg: st.cfg || null
  }, base);
  const content = '当前分组结果共 ' + info.groups.length + ' 组（共 ' + info.total + ' 人，来源：' +
    (info.source === 'prev' ? '最近抽签' : '班级名单') + '）。需要文字摘要时调用 getResultSummary，或打开分组页查看 / 复制 / 分享。';
  return result.ok(content, data, { handoff: handoff.handoffTo('group') });
}, '分组结果');
