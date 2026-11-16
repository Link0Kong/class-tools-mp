// ai/common/marks.js —— 勾选状态（marks 表）读写
//
// 与主包 utils/cloud.js 的 setMark/marksPull 完全同一契约：
//   行 { id: '<学号>|<kind>|<ref>', seat: 学号, kind: 'hw'|'nt'|'ntdone', ref, val: bool, ts }
//   * kind='hw'     作业完成
//   * kind='nt'     通知置顶
//   * kind='ntdone' 通知已处理
//   * 取消 = 写 val:false（表无 DELETE）
// 失败策略：先写本机（页面立即可见），网络失败进 markPend 队列（主包下次 cloudPull 自动补发）。
const auth = require('./auth.js');
const rest = require('./rest.js');
const local = require('./local.js');

function markId(kind, ref) {
  return auth.sid() + '|' + kind + '|' + ref;
}

function rowOf(kind, ref, val) {
  const seat = auth.sid();
  return { id: markId(kind, ref), seat: seat, kind: kind, ref: String(ref), val: !!val, ts: Date.now() };
}

// 写一条勾选状态；返回 { ok, pending? }
function setMark(kind, ref, val) {
  if (!ref) return Promise.resolve({ ok: false, pending: false, reason: 'invalid-ref' });
  local.applyMarkLocal(kind, ref, val);
  const seat = auth.sid();
  if (!seat) return Promise.resolve({ ok: false, pending: true, reason: 'identity-required' });
  if (!rest.isConfigured() || local.getCloudOff()) {
    local.queuePending({ seat: seat, kind: kind, ref: String(ref), val: !!val });
    return Promise.resolve({ ok: false, pending: true, reason: local.getCloudOff() ? 'cloud-off' : 'cloud-disabled' });
  }
  return rest.upsert(rest.CONFIG.tables.marks, [rowOf(kind, ref, val)]).then(function () {
    local.dropPending(seat, kind, String(ref));
    return { ok: true, pending: false };
  }).catch(function (e) {
    local.queuePending({ seat: seat, kind: kind, ref: String(ref), val: !!val });
    return { ok: false, pending: true, reason: (e && e.code) || 'network' };
  });
}

// 批量写（清空云端数据等场景）
function setMarks(rows) {
  const seat = auth.sid();
  if (!seat) return Promise.resolve({ ok: false, count: 0, reason: 'identity-required' });
  const list = (rows || []).filter(function (r) { return r && r.ref; }).map(function (r) {
    return rowOf(r.kind, r.ref, r.val);
  });
  if (!list.length) return Promise.resolve({ ok: true, count: 0 });
  if (!rest.isConfigured()) return Promise.resolve({ ok: false, count: 0, reason: 'cloud-disabled' });
  return rest.upsert(rest.CONFIG.tables.marks, list).then(function () {
    return { ok: true, count: list.length };
  }).catch(function (e) {
    return { ok: false, count: 0, reason: (e && e.code) || 'network' };
  });
}

// 拉本人全部勾选并应用到本机（供「我的→数据与隐私→立即同步」类接口用）
function pullMarks() {
  const seat = auth.sid();
  if (!seat) return Promise.resolve({ ok: false, count: 0, reason: 'identity-required' });
  if (!rest.isConfigured() || local.getCloudOff()) return Promise.resolve({ ok: false, count: 0, reason: 'cloud-off' });
  return rest.get(rest.CONFIG.tables.marks, 'select=*&seat=eq.' + encodeURIComponent(seat)).then(function (list) {
    local.patchStore(function (d) {
      (list || []).forEach(function (x) {
        if (!x || !x.ref) return;
        if (x.kind === 'hw') { d.hwDone = d.hwDone || {}; d.hwDone[x.ref] = !!x.val; }
        else if (x.kind === 'nt') { d.ntPin = d.ntPin || {}; d.ntPin[x.ref] = !!x.val; }
        else if (x.kind === 'ntdone') { d.ntDone = d.ntDone || {}; d.ntDone[x.ref] = !!x.val; }
      });
      return d;
    });
    return { ok: true, count: (list || []).length };
  }).catch(function (e) {
    return { ok: false, count: 0, reason: (e && e.code) || 'network' };
  });
}

// 补发本机队列（主包也会补发；AI 侧主动调用便于「立即同步」）
function flushPending() {
  const seat = auth.sid();
  const pend = local.getPending();
  if (!seat || !pend.length) return Promise.resolve({ ok: true, count: 0 });
  if (!rest.isConfigured() || local.getCloudOff()) return Promise.resolve({ ok: false, count: 0, reason: 'cloud-off' });
  const rows = pend.map(function (p) {
    return { id: p.seat + '|' + p.kind + '|' + p.ref, seat: p.seat, kind: p.kind, ref: String(p.ref), val: !!p.val, ts: Date.now() };
  });
  return rest.upsert(rest.CONFIG.tables.marks, rows).then(function () {
    pend.forEach(function (p) { local.dropPending(p.seat, p.kind, String(p.ref)); });
    return { ok: true, count: rows.length };
  }).catch(function (e) {
    return { ok: false, count: 0, reason: (e && e.code) || 'network' };
  });
}

function pendingCount() { return local.getPending().length; }

module.exports = {
  markId: markId, rowOf: rowOf,
  setMark: setMark, setMarks: setMarks, pullMarks: pullMarks, flushPending: flushPending, pendingCount: pendingCount
};
