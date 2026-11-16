// ai/skills/identity/lib/workspace.js —— 工作台总览的数据装载（作业 / 通知 / 课表）
//
// 原子接口环境与主包页面共享 storage，但主包的部分缓存（通知 auto groups）不在 zq_tools_v2 里，
// 因此本文件按需做「一次轻量兜底拉取 + 本机缓存」：
//   * 作业：store.homework 为空时拉 homework 表（小表）并写回 store.homework（与主包 raw 行同构）；
//   * 通知：拉 notices 表解析 [[CLASS_NOTICE_V1]] 组，缓存到 AI 专用键 zqa1_ntGroups（10 分钟 TTL）；
//   * 课表：store.ttCache 为空/过 6h 时拉 tt.json（公开静态文件，不带身份 token）。
// 网络失败一律回退本机缓存（不抛错），保证工作台总览在离线时仍可回答。
const rest = require('../../../common/rest.js');
const local = require('../../../common/local.js');

const NT_PREFIX = '[[CLASS_NOTICE_V1]]';
const NT_CACHE = 'ntGroups';
const NT_TTL = 10 * 60 * 1000;
const TT_TTL = 6 * 60 * 60 * 1000;

function canNet() {
  return !!(rest.isConfigured() && !local.getCloudOff());
}

// 作业：本机有缓存直接用；没有就拉一次（作业表很小），失败返回 []
function loadHomework() {
  const d = local.readStore();
  if (d.homework && d.homework.length) return Promise.resolve(d.homework);
  if (!canNet()) return Promise.resolve([]);
  return rest.get(rest.CONFIG.tables.homework, 'select=*&order=ts.desc&archived=eq.false').then(function (rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (list.length) {
      local.patchStore(function (dd) { dd.homework = list; return dd; });
    }
    return list;
  }).catch(function () { return []; });
}

// notices 行 → auto group（坏 JSON 单行跳过，不影响其它通知）
function parseGroups(rows) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    const body = String((r && r.body) || '');
    if (body.indexOf(NT_PREFIX) !== 0) return;
    try {
      const g = JSON.parse(body.slice(NT_PREFIX.length));
      if (g && g.id) out.push(g);
    } catch (e) { /* 单行坏 JSON 跳过 */ }
  });
  return out;
}

// 通知组：优先 10 分钟内 AI 缓存；否则整表拉一次（2MB，主包也是整表拉）后解析缓存。
// 返回 null 表示「当前拿不到通知数据」（离线且无缓存），[] 表示确实没有通知。
function loadNoticeGroups() {
  const cached = local.getAgentCache(NT_CACHE);
  const hasCache = !!(cached && Array.isArray(cached.g));
  if (hasCache && (Date.now() - (Number(cached.at) || 0)) < NT_TTL) return Promise.resolve(cached.g);
  if (!canNet()) return Promise.resolve(hasCache ? cached.g : null);
  return rest.get(rest.CONFIG.tables.notices, 'select=*&order=ts.asc,id.asc&archived=eq.false')
    .then(function (rows) {
      const gs = parseGroups(rows);
      local.setAgentCache(NT_CACHE, { at: Date.now(), g: gs });
      return gs;
    })
    .catch(function () { return hasCache ? cached.g : null; });
}

// 课表快照：store.ttCache（{c,t,at,meta}）；过期/为空时拉 tt.json
function loadTimetable() {
  const d = local.readStore();
  const cache = (d.ttCache && Array.isArray(d.ttCache.c)) ? d.ttCache : null;
  const fresh = cache && cache.at && (Date.now() - Number(cache.at)) < TT_TTL;
  if (fresh) return Promise.resolve(cache);
  if (!canNet() || !rest.CONFIG.ttUrl) return Promise.resolve(cache);
  return rest.fetchJson(rest.CONFIG.ttUrl).then(function (body) {
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
    if (!body || !Array.isArray(body.c)) return cache;
    const next = { c: body.c, t: body.t || '', at: Date.now(), meta: body.meta || null };
    local.patchStore(function (dd) { dd.ttCache = next; return dd; });
    return next;
  }).catch(function () { return cache; });
}

module.exports = {
  NT_PREFIX: NT_PREFIX, NT_CACHE: NT_CACHE,
  parseGroups: parseGroups,
  loadHomework: loadHomework, loadNoticeGroups: loadNoticeGroups, loadTimetable: loadTimetable
};
