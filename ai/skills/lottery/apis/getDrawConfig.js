// ai/skills/lottery/apis/getDrawConfig.js —— 读取抽签当前配置与状态
const local = require('../../../common/local.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const algo = require('../lib/algo.js');
const guard = require('../lib/guard.js');

module.exports = guard.run(async function getDrawConfig() {
  const cfg = algo.loadDraw();
  const sel = algo.selSeats();
  const b = algo.buildPool(cfg.start, cfg.end, cfg.excl, sel);
  const fl = local.getFlow();
  const hasDraw = !!(fl.draw && fl.draw.result && fl.draw.result.length);
  const hasGroup = !!(fl.group && fl.group.result && fl.group.result.length);
  const nDraw = hasDraw ? fl.draw.result.length : 0;
  const nGroup = hasGroup ? fl.group.result.length : 0;

  const pg = guard.page('draw');
  const data = {
    range: { start: +cfg.start, end: +cfg.end },
    count: +cfg.count,
    allowDuplicate: !!cfg.dup,
    excludeText: cfg.excl,
    sort: cfg.sort,
    poolSize: b.pool.length,
    rosterCount: sel.length,
    rosterSeats: sel,
    hasDrawResult: hasDraw,
    hasGroupResult: hasGroup,
    pagePath: pg.pagePath,
    pageTitle: pg.pageTitle
  };

  const content = [
    '当前抽签配置：范围 ' + cfg.start + ' – ' + cfg.end + '，抽 ' + cfg.count + ' 个，' +
      (cfg.dup ? '允许重复' : '不重复') + '，排除 ' + (cfg.excl || '无') + '，' + (algo.SORT_LABEL[cfg.sort] || '按抽取顺序') +
      '；可用抽签池 ' + b.pool.length + ' 个，参与名单 ' + (sel.length ? (sel.length + ' 人') : '未选（只抽序号）') + '。',
    hasDraw ? ('已有抽签结果 ' + nDraw + ' 个' + (hasGroup ? ('、分组结果 ' + nGroup + ' 组') : '') + '，重新抽签会覆盖旧结果。') : '还没有抽签结果。',
    '下一步：直接调用 runDraw 抽签；想调整参数可打开抽签页。'
  ].join('');

  return result.ok(content, data, { handoff: handoff.handoffTo('draw', 'step=1') });
}, '抽签配置');
