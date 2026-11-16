// cloudfunctions/notify/scan.js —— 新通知扫描纯逻辑（2026-11-11 需求 11）
//
// 背景（用户反馈「开启新通知提醒后收不到」根因之一）：
//   kind='nt' 订阅只由 action='publishNotice' 消费，而全仓库没有任何调用方（网页发布通知走 CloudBase，
//   不在微信云开发内）→ 订阅永远不会被发送。修复：timer 里用 PostgREST 轮询 notices 的轻量签名，
//   发现新通知后向 active 的 kind='nt' 订阅发送。
//
// 本文件只放纯函数（不 require wx-server-sdk / http 模块），便于 Node 单测：
//   sigOf(rows)           与小程序端 utils/cloud.js ntSigOf 完全同口径的签名
//   idKeys(rows)          ['<id>:<ts>'] 基线键（用于找出新增 id）
//   detectNew(prev, rows) 返回 { baseline, changed, newRows, sig, ids }
//   pickLatest(rows)      最新一条（按 ts 升序表的最后一条；排除 hidden）
//   messageOf(row, fmt)   组装订阅消息文案（thing2/time1/thing3/time26 所需文本）
//   normCfg(raw)          云端 __notify_cfg 文档归一（坏数据宽容）
//   mergeCfg(raw, patch)  配置增量合并（保留 token/lastSig 等未提及字段；2026-11-15）
//   cfgView(cfg, now)     诊断用脱敏视图（绝不含 token 明文）
//   shouldScan(cfg, now, minMs, hasNtSubs)  是否值得/允许发起一次扫描
//
// 首跑规则：没有 lastSig 基线 → 只记录基线（不补发历史通知）。
// 变更规则：签名变了但没有任何新增 id（删除/隐藏/管理员编辑）→ 只更新基线，不发送。
// token：bootstrap 上报并校验；401/403 → lastError='token-invalid'，等客户端再次 bootstrap 刷新。
const SIG_SEP = '|';
const IDS_CAP = 500;
const TOKEN_MAX_AGE_MS = 30 * 24 * 3600 * 1000;   // 班级 token 30 天有效；超龄诊断提示需要 bootstrap 刷新

// 与小程序端 utils/cloud.js ntSigOf 逐字节一致（行来源：select=id,ts,hidden,edited_at&order=ts.asc,id.asc）
function sigOf(rows) {
  return (Array.isArray(rows) ? rows : []).map(function (r) {
    return String((r && r.id) || '') + ':' +
      String((r && r.ts) == null ? '' : r.ts) + ':' +
      ((r && r.hidden) ? '1' : '0') + ':' +
      String((r && r.edited_at) == null ? 0 : r.edited_at);
  }).join(SIG_SEP);
}
function idKeys(rows) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    const id = String((r && r.id) || '');
    if (!id) return;
    out.push(id + ':' + String((r && r.ts) == null ? '' : r.ts));
  });
  return out;
}
function idOf(key) { return String(key || '').split(':')[0]; }

// 归一基线：接受旧 {lastSig, lastIds} / 新 {sig, ids} 两种形状（首次 undefined → 空基线）
function baselineOf(prev) {
  const p = prev || {};
  const sig = typeof p.lastSig === 'string' ? p.lastSig : (typeof p.sig === 'string' ? p.sig : '');
  const ids = Array.isArray(p.lastIds) ? p.lastIds.map(String) : (Array.isArray(p.ids) ? p.ids.map(String) : []);
  return { sig: sig, ids: ids };
}

// 检测：返回 { baseline, changed, newRows, sig, ids }
//   baseline=true → 首次运行（只记录基线，不发送历史）
//   newRows     → 新增 id 的行（已排除 hidden，按 ts 升序）
function detectNew(prev, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const sig = sigOf(list);
  const ids = idKeys(list);
  const base = baselineOf(prev);
  const baseline = !base.sig && !base.ids.length;
  const known = {};
  base.ids.forEach(function (k) { known[k] = true; });
  const prevIdSet = {};
  base.ids.forEach(function (k) { prevIdSet[idOf(k)] = true; });
  const newRows = [];
  if (!baseline) {
    list.forEach(function (r) {
      const id = String((r && r.id) || '');
      const ts = String((r && r.ts) == null ? '' : r.ts);
      if (!id || known[id + ':' + ts]) return;
      // 只有「基线里完全没有的 id」才算新通知；已存在 id 的 ts/编辑变化不算新通知（避免补发/打扰）
      if (prevIdSet[id]) return;
      if (r && r.hidden) return;
      newRows.push(r);
    });
    newRows.sort(function (a, b) { return (Number(a.ts) || 0) - (Number(b.ts) || 0); });
  }
  return {
    baseline: baseline,
    changed: !baseline && sig !== base.sig,
    newRows: newRows,
    sig: sig,
    ids: ids.slice(-IDS_CAP)
  };
}

// 最新一条可见通知（ts 升序表的最后一条；排除 hidden）
function pickLatest(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter(function (r) { return r && !r.hidden; });
  if (!list.length) return null;
  let best = list[0];
  for (let i = 1; i < list.length; i++) {
    if ((Number(list[i].ts) || 0) >= (Number(best.ts) || 0)) best = list[i];
  }
  return best;
}

// 订阅消息文案（fmt(ms) 由 index.js 注入，上海时区）
function messageOf(row, fmt) {
  const f = typeof fmt === 'function' ? fmt : function (ms) { return String(ms || ''); };
  const title = String((row && (row.title || row.subject)) || '班级通知').replace(/\s+/g, ' ').trim();
  const ts = Number(row && row.ts) || Date.now();
  const short = title.length > 18 ? title.slice(0, 17) + '…' : title;
  return {
    title: title,
    tip: '新通知',
    timeText: f(ts),
    summary: short,
    dateText: f(ts)
  };
}

// 云端 __notify_cfg 文档归一（含 token 的文档只在云端使用；本函数不对外返回 token）
function normCfg(raw) {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  return {
    token: typeof o.token === 'string' ? o.token : '',
    tokenAt: Number(o.tokenAt) || 0,
    lastSig: typeof o.lastSig === 'string' ? o.lastSig : '',
    lastIds: Array.isArray(o.lastIds) ? o.lastIds.map(String).slice(-IDS_CAP) : [],
    lastScanAt: Number(o.lastScanAt) || 0,
    lastSentAt: Number(o.lastSentAt) || 0,
    sentCount: Number(o.sentCount) || 0,
    lastError: String(o.lastError || ''),
    lastErrAt: Number(o.lastErrAt) || 0,
    baselineAt: Number(o.baselineAt) || 0,
    bootAt: Number(o.bootAt) || 0
  };
}

// 合并配置增量（2026-11-15）：notify_cfg 的 patch 必须保留未提及字段（尤其 token / lastSig）。
//   normCfg 先把旧文档归一成完整默认值，再覆盖本次 patch；调用方用 set 写回完整文档即可。
function mergeCfg(raw, patch) {
  const out = normCfg(raw);
  const p = (patch && typeof patch === 'object' && !Array.isArray(patch)) ? patch : {};
  Object.keys(p).forEach(function (k) { out[k] = p[k]; });
  return out;
}

// 诊断脱敏视图（不含 token 明文，符合「不打印/不返回 token」红线）
function cfgView(raw, now) {
  const cfg = normCfg(raw);
  const t = Number(now) || Date.now();
  return {
    hasToken: !!cfg.token,
    tokenAgeH: cfg.tokenAt ? Math.round((t - cfg.tokenAt) / 3600000) : 0,
    tokenAgeDays: cfg.tokenAt ? Math.round((t - cfg.tokenAt) / 86400000) : 0,
    lastScanAt: cfg.lastScanAt,
    lastSentAt: cfg.lastSentAt,
    sentCount: cfg.sentCount,
    lastError: cfg.lastError,
    lastErrAt: cfg.lastErrAt,
    baselineAt: cfg.baselineAt,
    bootAt: cfg.bootAt,
    baseline: !!cfg.lastSig
  };
}

// 是否值得发起一次扫描：
//   * 没有班级 token → 不扫（等待客户端 bootstrap；避免无意义的外部请求）
//   * 没有 active kind='nt' 订阅 → 不扫（不产生无人可发的请求）
//   * 距上次扫描 < minMs（默认 5 分钟）→ 不扫（控制请求频率，定时器可能每分钟触发）
function shouldScan(cfg, now, minMs, hasNtSubs) {
  const c = normCfg(cfg);
  const t = Number(now) || Date.now();
  if (!c.token) return { ok: false, reason: 'no-token' };
  if (!hasNtSubs) return { ok: false, reason: 'no-subscribers' };
  const gap = Number(minMs) || 5 * 60 * 1000;
  if (c.lastScanAt && (t - c.lastScanAt) < gap) return { ok: false, reason: 'too-soon' };
  return { ok: true, reason: '' };
}

// token 诊断（诊断页提示「需要客户端重新 bootstrap」用）
function tokenHealthy(cfg, now) {
  const c = normCfg(cfg);
  if (!c.token) return false;
  const t = Number(now) || Date.now();
  return !c.tokenAt || (t - c.tokenAt) < TOKEN_MAX_AGE_MS;
}

module.exports = {
  SIG_SEP: SIG_SEP, IDS_CAP: IDS_CAP, TOKEN_MAX_AGE_MS: TOKEN_MAX_AGE_MS,
  sigOf: sigOf, idKeys: idKeys, idOf: idOf, baselineOf: baselineOf,
  detectNew: detectNew, pickLatest: pickLatest, messageOf: messageOf,
  normCfg: normCfg, mergeCfg: mergeCfg, cfgView: cfgView, shouldScan: shouldScan, tokenHealthy: tokenHealthy
};
