// 参考实现：userdata v6 合并算法（契约 oracle）。两端实现必须与之逐字节等价。
// 用法：node merge_ref.js  → 生成 expected_merge_web_mp.json / expected_merge_mp_web.json / expected_v5_migrate.json
const fs = require('fs');
const path = require('path');
const DIR = __dirname;

const KEYS = ['homeTools', 'fit', 'draw', 'group', 'roster', 'hide', 'tt', 'prefs', 'nick', 'power', 'water'];
const DEFAULTS = {
  homeTools: [],
  fit: {},
  // 2026-11-12 抽签升级 v1（web/draw/CONTRACT.md §3.1/§4）：draw section 内新增 names 字段
  // （自定义序号名称映射文本，空 = 未设置）；与 utils/privacy.js DEFAULTS 保持一致。
  draw: { names: '' },
  group: {},
  roster: { rosterSel: [], rollSel: [], rollSt: {}, rollNames: '' },
  hide: { hwHide: {}, ntHide: {} },
  tt: { ttView: '', ttUseMine: false, ttLocal: null, termStart: '' },
  prefs: { hwRemind: {}, ntSub: false, ntSubAt: 0 },
  nick: '',
  power: { sel: '', at: 0, low: 30 },
  water: { rooms: {} }
};

function num(v) { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; }
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

function normalizeV5(old) {
  if (!old || typeof old !== 'object') return null;
  return {
    v: 6,
    at: { homeTools: num(old.homeToolsAt), fit: 0 },
    homeTools: Array.isArray(old.homeTools) ? clone(old.homeTools) : undefined,
    fit: (old.fit && typeof old.fit === 'object') ? clone(old.fit) : undefined
  };
}

function mergeBlob(remoteIn, localIn) {
  let remote = remoteIn;
  if (remote && Number(remote.v) === 5) remote = normalizeV5(remote);
  const local = localIn || {};
  const out = { v: 6, at: {} };
  KEYS.forEach(function (k) {
    const ra = remote && remote.at ? num(remote.at[k]) : 0;
    const la = local.at ? num(local.at[k]) : 0;
    const hasR = !!(remote && remote[k] !== undefined && remote[k] !== null);
    const hasL = !!(local[k] !== undefined && local[k] !== null);
    if (hasR && (!hasL || ra >= la)) { out[k] = clone(remote[k]); out.at[k] = ra; }
    else if (hasL) { out[k] = clone(local[k]); out.at[k] = la; }
    else { out[k] = clone(DEFAULTS[k]); out.at[k] = 0; }
  });
  out.homeToolsAt = out.at.homeTools;
  return out;
}

function readJson(name) { return JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8')); }
function writeJson(name, obj) { fs.writeFileSync(path.join(DIR, name), JSON.stringify(obj, null, 2) + '\n'); }

const web = readJson('userdata_v6_web.json');
const mp = readJson('userdata_v6_mp.json');
const v5 = readJson('legacy_v5.json');

// 两个方向的合并（合并应满足：merge(a,b) 与 merge(b,a) 对各 section 的赢家一致，仅缺省填充顺序不同）
writeJson('expected_merge_web_mp.json', mergeBlob(mp, web));   // 云端=mp 写的，本机=web 本机视图
writeJson('expected_merge_mp_web.json', mergeBlob(web, mp));   // 云端=web 写的，本机=mp 本机视图
writeJson('expected_v5_migrate.json', mergeBlob(v5, { at: {}, fit: { sex: 'm' } }));
console.log('ref merge written: expected_merge_web_mp / expected_merge_mp_web / expected_v5_migrate');
