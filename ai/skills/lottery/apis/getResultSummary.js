// ai/skills/lottery/apis/getResultSummary.js —— 抽签 + 分组文字摘要（纯文本，可直接读给用户或复制）
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const algo = require('../lib/algo.js');
const guard = require('../lib/guard.js');

module.exports = guard.run(async function getResultSummary() {
  const s = algo.buildSummary();
  const pg = guard.page('group');
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
    return result.ok('还没有抽签或分组结果，暂时无法生成摘要。可以调用 runDraw 抽签，或调用 runGroup 直接从全班/班级名单分组。', data,
      { handoff: handoff.handoffTo('group') });
  }

  const parts = [];
  if (hasDraw) parts.push('抽签 ' + drawData.count + ' 个');
  if (hasGroup) parts.push('分组 ' + groupData.groupCount + ' 组');
  const content = '摘要已生成：' + parts.join(' / ') + '。可直接把 text 读给用户或让用户复制；需要图片时打开抽签页/分组页分享。';
  return result.ok(content, data, { handoff: handoff.handoffTo('group') });
}, '抽签与分组摘要');
