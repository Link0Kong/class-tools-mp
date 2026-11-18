// utils/cache.js —— 分块持久缓存（v1 / 1.4.4，2026-11-04 性能优化）
//
// 为什么需要它：通知表 notices 的一次整表响应约 2 MB（24 组自动通知 = 60 KB 元数据 +
// 9 张图片 / 5 个附件 data URI 共 1.9 MB），而微信小程序 storage **单 key 上限约 1 MB、
// 总上限约 10 MB**，所以必须分块存；auto groups 又不落在 zq_tools_v2 里（那是手动通知）。
//
// 存储布局（全部 'zqc1_' 前缀，便于整体识别 / 清理）：
//   zqc1_idx                索引 { v:1, t:<ts>, items:{ "<sid>/<name>": {n,at,ttl,ver,bytes,chars} } }
//   zqc1_<sid>_<name>_<i>   第 i 块（纯字符串，读取时按序拼接 → JSON.parse）
//
// 契约：
//   * 按学号 sid 命名空间：没有身份（sid 为空）时读视为未命中、写直接被拒，避免同学串号；
//     退出身份 / 切换身份由 identity.js 调 clearAll() / clearOtherSids() 清理；
//   * 缺块、损坏、版本不符 → 读返回 null 并清理该条缓存（静默回退到网络）；
//   * 任何写失败（配额不足 / 单条超大）静默返回 false，绝不影响业务；
//   * 单块按 **UTF-8 字节** 估算 ≤ CHUNK_MAX_BYTES（600 KB，远低于 1 MB 单 key 限制），
//     单块字符数也 ≤ 600 KB，避免中文 3 字节把 key 撑爆；
//   * 总预算 MAX_BYTES（5 MB 估算字节），超限按 at 旧 → 新淘汰（LRU）；
//   * 只用 wx storage 同步接口（cloud.js 在后台刷新里调用，不阻塞首屏）。
//
// 本文件不 require cloud.js；identity.js 只在函数内部延迟 require，避免循环依赖。
var VER = 1;
var PREFIX = 'zqc1_';
var IDX_KEY = 'zqc1_idx';
// 2026-11-18：通知单 key 兜底快照（utils/cloud.js 写，弱网/无网用）；不属于分块缓存，
// 但切身份/退出时必须一起清，避免下一任同学读到上一位的通知。
var NT_SNAP_PREFIX = 'zq_nt_snap_v1_';
var CHUNK_MAX_BYTES = 600 * 1024;      // 单块上限（UTF-8 估算字节 & 字符数）
var CHUNK_MAX_CHARS = 600 * 1024;
var MAX_BYTES = 5 * 1024 * 1024;       // 总预算（估算字节）

function hasWx() { return typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function'; }
function sidOf() {
  try { return String(require('./identity.js').sid() || ''); } catch (e) { return ''; }
}
function now() { return Date.now(); }

// ---------------------------------------------------------------- 编码工具
// UTF-8 字节估算：ASCII 1、2 字节区 2、其余 3（emoji 代理对 4）。只用于容量控制，非精确值。
function byteLenOfCode(c, str, i) {
  if (c < 0x80) return 1;
  if (c < 0x800) return 2;
  if (c >= 0xD800 && c <= 0xDBFF) {
    var n = str.charCodeAt(i + 1);
    if (n >= 0xDC00 && n <= 0xDFFF) return 4;
  }
  return 3;
}
function utf8Len(str) {
  var s = String(str == null ? '' : str);
  var bytes = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      var n = s.charCodeAt(i + 1);
      if (n >= 0xDC00 && n <= 0xDFFF) { bytes += 4; i++; continue; }
    }
    bytes += (c < 0x80 ? 1 : (c < 0x800 ? 2 : 3));
  }
  return bytes;
}
// 按 UTF-8 估算字节切块：每块 ≤ CHUNK_MAX_BYTES 且字符数 ≤ CHUNK_MAX_CHARS
function splitChunks(str) {
  var out = [];
  var len = str.length;
  var start = 0, curBytes = 0;
  for (var i = 0; i < len; i++) {
    var c = str.charCodeAt(i);
    var step = 1;
    var b;
    if (c < 0x80) b = 1;
    else if (c < 0x800) b = 2;
    else if (c >= 0xD800 && c <= 0xDBFF) {
      var n = str.charCodeAt(i + 1);
      if (n >= 0xDC00 && n <= 0xDFFF) { b = 4; step = 2; } else b = 3;
    } else b = 3;
    if (curBytes + b > CHUNK_MAX_BYTES) {
      out.push(str.slice(start, i));
      start = i;
      curBytes = 0;
    }
    curBytes += b;
    i += (step - 1);
  }
  // 注意：正好在边界结束时 start 可能等于 len，此时不要再 push 空块
  //（空块会被读取端当作「缺块」，导致整条缓存被误判损坏）
  if (start < len) out.push(str.slice(start));
  if (!out.length) out.push(str);   // 空串（理论上 JSON 不会产生）兜底成 1 块
  return out;
}
function slug(name) { return String(name == null ? '' : name).replace(/[^A-Za-z0-9_]/g, '_'); }
function chunkKey(sid, name, i) { return PREFIX + sid + '_' + slug(name) + '_' + i; }
function itemKey(sid, name) { return sid + '/' + name; }

// ---------------------------------------------------------------- 索引
function readIdx() {
  var empty = { v: VER, t: 0, items: {} };
  if (!hasWx()) return empty;
  var raw;
  try { raw = wx.getStorageSync(IDX_KEY); } catch (e) { return empty; }
  if (raw === '' || raw === null || raw === undefined) return empty;
  var j = raw;
  if (typeof j === 'string') { try { j = JSON.parse(j); } catch (e) { return empty; } }
  if (!j || typeof j !== 'object' || j.v !== VER || !j.items || typeof j.items !== 'object') {
    // 旧版本 / 损坏索引：整层丢弃（分块随之变孤儿，尽量扫掉）
    sweepOrphans({});
    return empty;
  }
  return { v: VER, t: Number(j.t) || 0, items: j.items };
}
function writeIdx(idx) {
  if (!hasWx()) return false;
  try { wx.setStorageSync(IDX_KEY, JSON.stringify({ v: VER, t: now(), items: idx.items })); return true; }
  catch (e) { return false; }
}
// 尽量清扫不在索引里的 zqc1_* 分块（依赖 getStorageInfoSync；没有就跳过）
function sweepOrphans(items) {
  if (!hasWx() || typeof wx.getStorageInfoSync !== 'function') return;
  var keys = [];
  try { keys = (wx.getStorageInfoSync() || {}).keys || []; } catch (e) { return; }
  var keep = {};
  Object.keys(items || {}).forEach(function (k) {
    var e = items[k];
    var cut = k.indexOf('/');
    if (cut < 0 || !e) return;
    var sid = k.slice(0, cut), name = k.slice(cut + 1);
    for (var i = 0; i < (Number(e.n) || 0); i++) keep[chunkKey(sid, name, i)] = 1;
  });
  keys.forEach(function (k) {
    if (String(k).indexOf(PREFIX) === 0 && k !== IDX_KEY && !keep[k]) {
      try { wx.removeStorageSync(k); } catch (e) { /* ignore */ }
    }
  });
}
function removeEntry(entryKey, entry) {
  if (!hasWx()) return;
  var cut = entryKey.indexOf('/');
  var sid = entryKey.slice(0, cut), name = entryKey.slice(cut + 1);
  var n = (entry && Number(entry.n)) || 0;
  for (var i = 0; i < n; i++) {
    try { wx.removeStorageSync(chunkKey(sid, name, i)); } catch (e) { /* ignore */ }
  }
}
function entryBytes(e) { return (e && Number(e.bytes)) || 0; }
function totalBytes(idx) {
  var t = 0;
  Object.keys(idx.items || {}).forEach(function (k) { t += entryBytes(idx.items[k]); });
  return t;
}

// ---------------------------------------------------------------- 读
// 返回 { val, at, age, ttl, fresh, bytes, chars } 或 null；损坏 / 缺块 / 版本不符 → 清理并 null。
function getWithMeta(name) {
  if (!hasWx()) return null;
  var sid = sidOf();
  if (!sid) return null;                       // 没有身份：不读任何人的缓存
  var idx = readIdx();
  var key = itemKey(sid, name);
  var e = idx.items[key];
  if (!e) return null;
  if (Number(e.ver) !== VER) { del(name); return null; }
  var n = Number(e.n) || 0;
  if (n < 1) { del(name); return null; }
  var parts = [];
  for (var i = 0; i < n; i++) {
    var v;
    try { v = wx.getStorageSync(chunkKey(sid, name, i)); } catch (err) { del(name); return null; }
    if (typeof v !== 'string' || !v.length) { del(name); return null; }   // 缺块
    parts.push(v);
  }
  var text = parts.join('');
  if (Number(e.chars) > 0 && text.length !== Number(e.chars)) { del(name); return null; }  // 长度不符 = 损坏
  var val;
  try { val = JSON.parse(text); } catch (err2) { del(name); return null; }
  var at = Number(e.at) || 0;
  var ttl = Number(e.ttl) || 0;
  var age = Math.max(0, now() - at);
  return {
    val: val, at: at, age: age, ttl: ttl,
    fresh: ttl > 0 ? age < ttl : true,
    bytes: entryBytes(e), chars: Number(e.chars) || 0
  };
}
function get(name) { var m = getWithMeta(name); return m ? m.val : null; }
function fresh(name) { var m = getWithMeta(name); return !!(m && m.fresh); }
function age(name) { var m = getWithMeta(name); return m ? m.age : -1; }
function meta(name) {
  var m = getWithMeta(name);
  return m ? { at: m.at, age: m.age, ttl: m.ttl, fresh: m.fresh, bytes: m.bytes, chars: m.chars } : null;
}

// ---------------------------------------------------------------- 写
// ttl 毫秒；ttl <= 0 表示不过期（如 lastSync manifest）。
// 返回 true / false（失败静默，不抛错）。
function set(name, val, ttl) {
  if (!hasWx()) return false;
  var sid = sidOf();
  if (!sid) return false;                      // 没有身份：不落任何人数据
  if (val === undefined) { del(name); return true; }
  var text;
  try { text = JSON.stringify(val); } catch (e) { return false; }
  if (typeof text !== 'string') return false;
  // 2026-11-17 修复：先判总预算再切块。通知整表曾达 14MB，旧顺序会先 splitChunks 复制出
  // 24 个 600KB 分块（额外十余 MB 内存/主线程）才因超预算 return false，冷启动直接卡顿。
  var bytes = utf8Len(text);
  if (bytes > MAX_BYTES) return false;         // 单条超出总预算：放弃（业务照常走网络）
  var chunks = splitChunks(text);

  var idx = readIdx();
  var key = itemKey(sid, name);
  var old = idx.items[key];

  // 预算：淘汰其它最旧条目
  var others = 0;
  var victims = [];
  Object.keys(idx.items).forEach(function (k) {
    if (k === key) return;
    others += entryBytes(idx.items[k]);
    victims.push(k);
  });
  victims.sort(function (a, b) { return (Number(idx.items[a].at) || 0) - (Number(idx.items[b].at) || 0); });
  while (others + bytes > MAX_BYTES && victims.length) {
    var vk = victims.shift();
    others -= entryBytes(idx.items[vk]);
    removeEntry(vk, idx.items[vk]);
    delete idx.items[vk];
  }
  if (others + bytes > MAX_BYTES) return false;

  if (old) removeEntry(key, old);
  // 先写块，再写索引：中途失败只会留下「索引里没有的孤儿块」，不会读到半截数据
  try {
    for (var i = 0; i < chunks.length; i++) wx.setStorageSync(chunkKey(sid, name, i), chunks[i]);
  } catch (e2) {
    for (var j = 0; j < chunks.length; j++) {
      try { wx.removeStorageSync(chunkKey(sid, name, j)); } catch (e3) { /* ignore */ }
    }
    if (old) delete idx.items[key];
    writeIdx(idx);
    return false;
  }
  idx.items[key] = {
    n: chunks.length, at: now(), ttl: Number(ttl) || 0, ver: VER,
    bytes: bytes, chars: text.length
  };
  return writeIdx(idx);
}

function del(name) {
  if (!hasWx()) return false;
  var sid = sidOf();
  if (!sid) return false;
  var idx = readIdx();
  var key = itemKey(sid, name);
  var e = idx.items[key];
  if (!e) return false;
  removeEntry(key, e);
  delete idx.items[key];
  writeIdx(idx);
  return true;
}

// 当前身份的缓存全部删除（切换 / 退出身份时兜底）
function clear() {
  if (!hasWx()) return false;
  var sid = sidOf();
  if (!sid) return false;
  var idx = readIdx();
  var hit = false;
  Object.keys(idx.items).forEach(function (k) {
    if (k.indexOf(sid + '/') === 0) { removeEntry(k, idx.items[k]); delete idx.items[k]; hit = true; }
  });
  writeIdx(idx);
  return hit;
}

// 删除所有身份、所有条目的缓存（退出身份 / 清空数据用；隐私优先，直接全清）
function clearAll() {
  if (!hasWx()) return false;
  var idx = readIdx();
  Object.keys(idx.items).forEach(function (k) { removeEntry(k, idx.items[k]); });
  try { wx.removeStorageSync(IDX_KEY); } catch (e) { /* ignore */ }
  sweepOrphans({});
  sweepSnapshots('');
  return true;
}

// 只清掉「不是当前身份」的缓存（同一台手机换号登录时兜底；新身份缓存本身就是空的）
function clearOtherSids() {
  if (!hasWx()) return false;
  var sid = sidOf();
  if (!sid) return clearAll();
  var idx = readIdx();
  var hit = false;
  Object.keys(idx.items).forEach(function (k) {
    if (k.indexOf(sid + '/') !== 0) { removeEntry(k, idx.items[k]); delete idx.items[k]; hit = true; }
  });
  if (hit) writeIdx(idx);
  sweepSnapshots(sid);
  return hit;
}
// 清掉非 keepSid 的通知快照（keepSid 为空 = 全清）
function sweepSnapshots(keepSid) {
  if (!hasWx() || typeof wx.getStorageInfoSync !== 'function') return;
  var keys = [];
  try { keys = (wx.getStorageInfoSync() || {}).keys || []; } catch (e) { return; }
  keys.forEach(function (k) {
    k = String(k);
    if (k.indexOf(NT_SNAP_PREFIX) !== 0) return;
    if (keepSid && k === NT_SNAP_PREFIX + keepSid) return;
    try { wx.removeStorageSync(k); } catch (e) { /* ignore */ }
  });
}

function stats() {
  if (!hasWx()) return { sid: '', items: 0, bytes: 0, names: [], at: 0 };
  var sid = sidOf();
  var idx = readIdx();
  var names = [], bytes = 0, items = 0;
  Object.keys(idx.items).forEach(function (k) {
    var e = idx.items[k];
    items += 1;
    bytes += entryBytes(e);
    if (sid && k.indexOf(sid + '/') === 0) names.push(k.slice(k.indexOf('/') + 1));
  });
  return { sid: sid, items: items, bytes: bytes, names: names, at: Number(idx.t) || 0 };
}

module.exports = {
  VER: VER, PREFIX: PREFIX, IDX_KEY: IDX_KEY,
  CHUNK_MAX_BYTES: CHUNK_MAX_BYTES, CHUNK_MAX_CHARS: CHUNK_MAX_CHARS, MAX_BYTES: MAX_BYTES,
  get: get, getWithMeta: getWithMeta, fresh: fresh, age: age, meta: meta,
  set: set, del: del, clear: clear, clearAll: clearAll, clearOtherSids: clearOtherSids,
  stats: stats,
  // 测试/诊断辅助
  _utf8Len: utf8Len, _splitChunks: splitChunks, _chunkKey: chunkKey, _totalBytes: totalBytes
};
