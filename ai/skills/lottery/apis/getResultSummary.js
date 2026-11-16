// ai/skills/lottery/apis/getResultSummary.js —— 抽签 + 分组结果单（纯文本，可直接给用户）
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const algo = require('../lib/algo.js');
const guard = require('../lib/guard.js');

module.exports = guard.run(async function getResultSummary() {
  const s = algo.buildSummary();
  const pg = guard.page('sum');
  const hasDraw = !!s.drawBlock;
  const hasGroup = !!s.groupBlocks;
  const text = algo.capText(s.text, 2000);

  const drawData = hasDraw ? {
    exists: true,
    count: s.drawBlock.items.length,
    items: s.drawBlock.items.map(function (x) { return { number: x.n, name: x.nm || '' }; }),
    removed: (s.draw && s.draw.removed) || [],
    cfg: (s.draw && s.draw.cfg) || null
  } : { exists: false, count: 0, items: [], removed: [], cfg: null };

  const groupData = hasGroup ? {
    exists: true,
    groupCount: s.groupBlocks.length,
    groups: s.groupBlocks.map(function (b, i) {
      return {
        index: i + 1,
        size: b.items.length,
        members: b.items.map(function (x) { return { number: x.n, name: x.nm || '' }; })
      };
    }),
    cfg: (s.group && s.group.cfg) || null
  } : { exists: false, groupCount: 0, groups: [], cfg: null };

  const data = {
    draw: drawData,
    group: groupData,
    text: text,
    sub: s.sub,
    pagePath: pg.pagePath,
    pageTitle: pg.pageTitle
  };

  if (!hasDraw && !hasGroup) {
    return result.ok('还没有抽签或分组结果，暂时无法生成结果单。请先调用 runDraw 抽签' + '，需要分组时再调用 runGroup。', data,
      { handoff: handoff.handoffTo('sum', 'step=3') });
  }

  const parts = [];
  if (hasDraw) parts.push('抽签 ' + drawData.count + ' 个');
  if (hasGroup) parts.push('分组 ' + groupData.groupCount + ' 组');
  const content = '结果单已生成：' + parts.join(' / ') + '。可直接把 text 读给用户或让用户复制，也可以打开结果单页复制 / 导出图片。';
  return result.ok(content, data, { handoff: handoff.handoffTo('sum', 'step=3') });
}, '结果单');
