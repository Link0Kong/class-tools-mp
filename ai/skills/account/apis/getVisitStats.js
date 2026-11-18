// ai/skills/account/apis/getVisitStats.js —— 访问统计（原子接口，仅管理员）
//
// 与主包 pages/stats/stats.js 同口径（2026-11-18）：
// - 按最近登录 ts 倒序（不再按访问次数优先）；
// - 记录并输出最近登录端（client：web/mp/android/win/harmony）；
// - 忽略测试账号（3260799999 / 9999 段 10 位）与匿名历史行；
// - 输出不含学号与设备号。
const auth = require('../../../common/auth.js');
const rest = require('../../../common/rest.js');
const fmt = require('../../../common/fmt.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');

const MAX_ROWS = 5000;
const NAME_TOP = 15;
const CLIENT_LABEL = { web: '网页', mp: '小程序', android: '安卓', win: 'Windows', harmony: '鸿蒙' };

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function slotTs(slot) {
  const s = String(slot || '');
  if (s.length < 13) return 0;
  const d = new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)), Number(s.slice(11, 13)), 0, 0, 0);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
function tsOf(r) { return (Number(r && r.ts) || 0) || slotTs(r && r.slot); }
function clientLabel(c) { return CLIENT_LABEL[String(c || '').trim().toLowerCase()] || '未记录'; }
function isTestSid(sid) {
  const s = String(sid || '').trim();
  return s === '3260799999' || /^9999\d{6}$/.test(s);
}

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
  const q = 'select=id,slot,sid,name,ts,client&slot=gte.' + encodeURIComponent(fromSlot) + '&order=ts.desc&limit=' + MAX_ROWS;

  return rest.get(rest.CONFIG.tables.visits, q).then(function (rows) {
    const all = Array.isArray(rows) ? rows : [];
    // 只统计绑定学号的访问（历史匿名行不参与）；测试账号一律忽略。
    const bound = all.filter(function (r) {
      const sid = String(r && r.sid == null ? '' : r.sid).trim();
      return sid !== '' && !isTestSid(sid);
    });

    // —— 按账号（sid）聚合：访问次数 + 最近登录时间/端 ——
    const map = {};
    bound.forEach(function (r) {
      const sid = String(r.sid || '').trim();
      if (!sid) return;
      const name = String(r.name || '').trim() || '（无姓名）';
      const ts = tsOf(r);
      if (!map[sid]) map[sid] = { name: name, visits: 0, lastTs: 0, lastClient: '' };
      map[sid].visits += 1;
      if (ts >= map[sid].lastTs) { map[sid].lastTs = ts; map[sid].lastClient = String(r.client || '').trim(); }
      if (name && name !== '（无姓名）') map[sid].name = name;
    });
    const byName = Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (x, y) { return (y.lastTs - x.lastTs) || (y.visits - x.visits); })
      .slice(0, NAME_TOP)
      .map(function (x) {
        return {
          name: x.name,
          visits: x.visits,
          lastText: x.lastTs ? fmt.fmtDateTime(x.lastTs) : '—',
          lastClient: clientLabel(x.lastClient)
        };
      });

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
      const top = byName.slice(0, 3).map(function (x) { return x.name + '（最近 ' + x.lastText + ' · ' + x.lastClient + '）'; }).join('、');
      text = s.rangeText + '共 ' + total + ' 次访问、' + accounts + ' 位同学活跃；最近登录的是：' + top +
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
