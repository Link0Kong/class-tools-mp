// ai/skills/account/lib/sync.js —— 「立即同步」的四类小表拉取（对应主包 cloud.cloudPull 的子集）
//
//   * marks      → common/marks.pullMarks()（勾选状态）
//   * homework   → homework 表（小表）合并进 store.homework（与主包 hwPull 同构：保留待补发/新发布行）
//   * fitrecs    → fitrecs 表（按学号，arch=false），解析 data JSON 后合并进 store.fitRecs（≤2 条）
//   * userdata   → userdata 表（按学号）写入 store.udCache 作基线快照
// 通知整表（~2MB）不在本文件拉取：契约明确「通知整表太重不在此接口拉」。
const rest = require('../../../common/rest.js');
const local = require('../../../common/local.js');

const RECENT_MS = 5 * 60 * 1000;   // 主包 hwPull：5 分钟内刚发布/待补发的本机行保留
const FIT_MAX = 2;

function canNet() {
  return !!(rest.isConfigured() && !local.getCloudOff());
}

function pullHomework(sid) {
  if (!canNet()) return Promise.resolve({ ok: false, count: 0 });
  return rest.get(rest.CONFIG.tables.homework, 'select=*&order=ts.desc&archived=eq.false').then(function (rows) {
    const list = Array.isArray(rows) ? rows : [];
    const d = local.readStore();
    const byId = {};
    const merged = list.map(function (r) { if (r && r.id) byId[r.id] = 1; return r; });
    (d.homework || []).forEach(function (p) {
      if (!p) return;
      if (!p.id) { p._pending = true; merged.push(p); return; }
      if (byId[p.id]) return;
      if (p._pending || (p.ts && Date.now() - p.ts < RECENT_MS)) merged.push(p);
    });
    local.patchStore(function (dd) { dd.homework = merged; return dd; });
    return { ok: true, count: merged.length };
  }).catch(function (e) {
    return { ok: false, count: 0, code: (e && e.code) || 'network' };
  });
}

function pullFitRecs(sid) {
  if (!canNet()) return Promise.resolve({ ok: false, count: 0 });
  const seat = String(sid || '').trim();
  if (!seat) return Promise.resolve({ ok: false, count: 0, code: 'identity-required' });
  return rest.get(rest.CONFIG.tables.fitrecs,
    'select=*&acc=eq.' + encodeURIComponent(seat) + '&arch=eq.false&order=ts.desc').then(function (rows) {
    const d = local.readStore();
    const unsync = (d.fitRecs || []).filter(function (x) { return x && x._sync; });
    const seen = {};
    const cloud = [];
    (Array.isArray(rows) ? rows : []).forEach(function (x) {
      let rec = null;
      try { rec = JSON.parse(x.data); } catch (e) { rec = null; }
      if (!rec || !rec.id || seen[rec.id]) return;
      seen[rec.id] = 1;
      if (!rec.ts) rec.ts = Number(x.ts) || 0;
      if (rec.n) rec.name = rec.n;
      rec._sync = false;
      cloud.push(rec);
    });
    const merged = unsync.concat(cloud).slice(0, FIT_MAX);
    local.patchStore(function (dd) { dd.fitRecs = merged; return dd; });
    return { ok: true, count: merged.length };
  }).catch(function (e) {
    return { ok: false, count: 0, code: (e && e.code) || 'network' };
  });
}

function pullUserdata(sid) {
  if (!canNet()) return Promise.resolve({ ok: false, count: 0 });
  const seat = String(sid || '').trim();
  if (!seat) return Promise.resolve({ ok: false, count: 0, code: 'identity-required' });
  return rest.byId(rest.CONFIG.tables.userdata, seat).then(function (row) {
    let blob = null;
    if (row && row.blob) {
      if (typeof row.blob === 'object') blob = row.blob;
      else { try { blob = JSON.parse(String(row.blob)); } catch (e) { blob = null; } }
    }
    if (blob && typeof blob === 'object') {
      local.patchStore(function (dd) { dd.udCache = blob; dd.udPend = false; return dd; });
      return { ok: true, count: 1 };
    }
    // 云端还没有我的 userdata 行：不算失败，返回 0 并保留本机基线
    return { ok: true, count: 0 };
  }).catch(function (e) {
    return { ok: false, count: 0, code: (e && e.code) || 'network' };
  });
}

module.exports = {
  pullHomework: pullHomework, pullFitRecs: pullFitRecs, pullUserdata: pullUserdata
};
