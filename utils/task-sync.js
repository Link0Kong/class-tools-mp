// taskdata v1. Work on the original cloud document so UI normalization cannot discard another client's fields.
function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function equal(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.prototype.hasOwnProperty.call(b, k) && equal(a[k], b[k]));
}
function validRows(rows) {
  if (!Array.isArray(rows)) return false;
  const ids = new Set();
  return rows.every(row => {
    if (!object(row) || typeof row.id !== 'string' || !row.id || ids.has(row.id)) return false;
    ids.add(row.id);
    return true;
  });
}
function decode(blob, ts) {
  let root;
  if (blob === '' && ts === 0) root = { v: 1, items: [], lists: [] };
  else {
    try { root = typeof blob === 'string' ? JSON.parse(blob) : blob; }
    catch (e) { return null; }
  }
  let leaf = root;
  const path = [];
  while (object(leaf)) {
    if (Array.isArray(leaf.items)) {
      if (!validRows(leaf.items) || (leaf.lists !== undefined && !validRows(leaf.lists))) return null;
      return { root, leaf, path };
    }
    if (path.length === 3) break;
    const key = ['task', 'data', 'v'].find(k => object(leaf[k]));
    if (!key) break;
    path.push(key);
    leaf = leaf[key];
  }
  return null;
}
function encode(wire, leaf) {
  function replace(node, depth) {
    if (depth === wire.path.length) return leaf;
    const key = wire.path[depth];
    return Object.assign({}, node, { [key]: replace(node[key], depth + 1) });
  }
  return JSON.stringify(replace(wire.root, 0));
}
function editFields(base, local, remote) {
  const result = Object.assign({}, remote);
  Object.keys(local).forEach(k => { if (!equal(base[k], local[k])) result[k] = local[k]; });
  return result;
}
function duplicateTask(a, b) {
  if (a.fromId) return a.fromId === b.fromId && a.due === b.due;
  return (a.sourceHwId && a.sourceHwId === b.sourceHwId) || (a.sourceNoticeId && a.sourceNoticeId === b.sourceNoticeId);
}
function mergeRows(base, local, remote, dedupe) {
  const index = rows => new Map((rows || []).map(row => [row.id, row]));
  const before = index(base), after = index(local), result = index(remote);
  before.forEach((row, id) => { if (!after.has(id)) result.delete(id); });
  after.forEach((row, id) => {
    const old = before.get(id), existing = result.get(id);
    if (equal(old, row) || (old && !existing)) return;
    if (!existing && dedupe && Array.from(result.values()).some(other => duplicateTask(row, other))) return;
    result.set(id, editFields(old || {}, row, existing));
  });
  return Array.from(result.values());
}
function rebase(base, local, remote) {
  const out = Object.assign({}, remote, { items: mergeRows(base.items, local.items, remote.items, true) });
  if (local.lists && (remote.lists || !equal(base.lists, local.lists))) {
    out.lists = mergeRows(base.lists, local.lists, remote.lists, false);
  }
  if (local.prefs && (remote.prefs || !equal(base.prefs, local.prefs))) {
    const edited = Object.assign({}, local.prefs);
    if ((edited.sidebarOrderAt || 0) < ((remote.prefs || {}).sidebarOrderAt || 0)) {
      delete edited.sidebarOrder;
      delete edited.sidebarOrderAt;
    }
    out.prefs = editFields(base.prefs || {}, edited, remote.prefs);
  }
  const groups = new Set((out.lists || []).map(row => row.id));
  out.items = out.items.map(item => {
    const row = Object.assign({}, item);
    delete row.attachments;
    delete row.localFiles;
    if (row.list && out.lists && !groups.has(row.list)) row.list = '';
    return row;
  });
  return out;
}
function stamp(value) {
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
function response(rows, sent) {
  if (Array.isArray(rows) && !rows.length) return 'zero';
  const row = Array.isArray(rows) && rows.length === 1 && rows[0];
  return row && row.id === sent.id && row.blob === sent.blob &&
    (row.ts === sent.ts || row.ts === String(sent.ts)) ? 'row' : 'unverified';
}
module.exports = { equal, decode, encode, rebase, response, stamp };
