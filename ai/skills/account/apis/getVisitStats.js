// ai/skills/account/apis/getVisitStats.js —— 访问统计（原子接口，仅管理员）
//
// 与主包 pages/stats/stats.js 同口径：只统计有学号的 visits 行，按姓名聚合访问次数与最近时间，
// 按天/按小时统计「活跃账号数」（去重学号）。输出不含学号与设备号。
const auth = require('../../../common/auth.js');
const rest = require('../../../common/rest.js');
const fmt = require('../../../common/fmt.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');

const MAX_ROWS = 2000;
const NAME_TOP = 15;

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

module.exports = function getVisitStats(args) {
  const id = auth.getIdentity();
  if (!id) return result.identityFail();
  if (!id.is_admin) {
    return result.fail('访问统计仅管理员可查看。如果需要了解班级数据，可以问作业、通知或课表。', 'forbidden');
  }
  const a = args || {};
  let days = parseInt(a.days, 10);
  if (!isFinite(days)) days = 7;
  if (days !== 7 && days !== 30) {
    return result.invalid('days 只能是 7 或 30（统计近 7 天或近 30 天）。');
  }
  if (!rest.isConfigured()) {
    return result.fail('云端服务未配置，暂时无法查看访问统计。', 'cloud-disabled');
  }

  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0);
  const fromSlot = ymd(from) + '-00';
  const q = 'select=id,slot,sid,name,ts&slot=gte.' + encodeURIComponent(fromSlot) + '&order=ts.desc&limit=' + MAX_ROWS;

  return rest.get(rest.CONFIG.tables.visits, q).then(function (rows) {
    const all = Array.isArray(rows) ? rows : [];
    // 只统计绑定学号的访问（v12 之前的匿名历史行不参与）
    const bound = all.filter(function (r) { return String(r && r.sid == null ? '' : r.sid).trim() !== ''; });

    // —— 按姓名聚合 ——
    const map = {};
    bound.forEach(function (r) {
      const name = String(r.name || '').trim() || '（无姓名）';
      const ts = Number(r.ts) || 0;
      if (!map[name]) map[name] = { name: name, visits: 0, lastTs: 0 };
      map[name].visits += 1;
      map[name].lastTs = Math.max(map[name].lastTs, ts);
    });
    const byName = Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (x, y) { return (y.visits - x.visits) || (y.lastTs - x.lastTs); })
      .slice(0, NAME_TOP)
      .map(function (x) { return { name: x.name, visits: x.visits, lastText: x.lastTs ? fmt.fmtDateTime(x.lastTs) : '—' }; });

    // —— 按天：活跃账号数（去重学号） ——
    const byDay = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = ymd(d);
      const set = {};
      bound.forEach(function (r) {
        if (String(r.slot || '').slice(0, 10) !== key) return;
        const sid = String(r.sid || '').trim();
        if (sid) set[sid] = 1;
      });
      byDay.push({ date: key.slice(5), count: Object.keys(set).length });
    }

    // —— 按小时：活跃账号数 ——
    const buckets = [];
    for (let h = 0; h < 24; h++) buckets.push({});
    bound.forEach(function (r) {
      const h = parseInt(String(r.slot || '').slice(11, 13), 10);
      if (!(h >= 0 && h < 24)) return;
      const sid = String(r.sid || '').trim();
      if (sid) buckets[h][sid] = 1;
    });
    const byHour = buckets.map(function (m, h) { return { hour: pad(h), count: Object.keys(m).length }; });

    const total = bound.length;
    const accounts = Object.keys(map).length;
    const s = {
      total: total,
      accounts: accounts,
      byName: byName,
      byDay: byDay,
      byHour: byHour,
      rangeText: '近 ' + days + ' 天（' + ymd(from).slice(5) + ' 至 ' + ymd(now).slice(5) + '）',
      pagePath: handoff.PAGES.stats,
      pageTitle: '访问统计'
    };
    let text;
    if (!total) {
      text = '近 ' + days + ' 天还没有访问记录。等同学们使用后可以再来查看。';
    } else {
      const top = byName.slice(0, 3).map(function (x) { return x.name + '（' + x.visits + ' 次）'; }).join('、');
      text = s.rangeText + '共 ' + total + ' 次访问、' + accounts + ' 位同学活跃；访问最多的是：' + top +
        '。需要看按天/按小时分布可以继续问。';
    }
    return result.ok(text, s, {
      _meta: { cardData: { total: total, accounts: accounts, byName: byName.slice(0, 6), byDay: byDay.slice(-7), byHour: byHour.filter(function (b) { return b.count > 0; }).slice(0, 12), rangeText: s.rangeText } },
      handoff: handoff.handoffTo('stats', 'days=' + days, { days: days })
    });
  }).catch(function (e) {
    return result.fromError(e, '访问统计');
  });
};
