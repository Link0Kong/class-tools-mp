// Each verified account keeps its own confirmed room snapshot and explicit pending actions.
const water = require('./water.js');
function key(sid, room) { return 'zq_water_shared_v2_' + encodeURIComponent(sid) + ':' + encodeURIComponent(room); }
function read(sid, room) {
  const entry = sid && room && wx.getStorageSync(key(sid, room));
  return entry ? JSON.parse(entry) : { ops: [] };
}
function save(sid, room, state) { wx.setStorageSync(key(sid, room), JSON.stringify(state)); }
function value(state, field) {
  if (field === 'people') return state.people;
  if (!Array.isArray(state.rows)) return undefined;
  const row = state.rows.find(r => r.month === field);
  return row ? { reading: Number(row.reading), persons: Number(row.persons) } : null;
}
function same(a, b) {
  return a === b || (!!a && !!b && typeof a === 'object' && typeof b === 'object' &&
    a.reading === b.reading && a.persons === b.persons);
}
function decision(op, current) {
  if (!['user', 'confirmed-import'].includes(op.source) || current === undefined) return 'review';
  if (same(current, op.desired)) return 'satisfied';
  return !op.outcomeUnknown && op.base !== undefined && same(op.base, current) ? 'send' : 'review';
}
function queue(state, field, desired, source) {
  const previous = state.ops.find(op => op.field === field);
  state.seq = (state.seq || 0) + 1;
  const op = { id: state.seq, field, desired, source: source || 'user',
    base: previous && previous.outcomeUnknown ? previous.desired : value(state, field) };
  state.ops = state.ops.filter(item => item.field !== field);
  state.ops.push(op);
  return op;
}
function display(state) {
  const months = new Map((state.rows || []).map(row => [row.month, Number(row.reading)]));
  let p = state.people || 4;
  state.ops.forEach(op => {
    if (op.field === 'people') p = op.desired;
    else if (op.desired === null) months.delete(op.field);
    else months.set(op.field, op.desired.reading);
  });
  return { p, recs: water.normRecs(Array.from(months, ([m, r]) => ({ m, r, ts: 0 }))) };
}
module.exports = { read, save, value, same, decision, queue, display };
