// A pending mutation lives with its record and verified account, including after the page resets.
const flow = require('./flow.js');
const identity = require('./identity.js');
const api = require('./drawproof.js');
const running = new Map();

function read(id) { return (flow.getFlow().eventJobs || {})[id]; }
function update(id, job) {
  const state = flow.getFlow();
  const jobs = state.eventJobs || {};
  if (job && job.queue.length) jobs[id] = job;
  else delete jobs[id];
  state.eventJobs = jobs;
  const current = state.draw;
  if (current && current.rid === id && current.proof) {
    current.proof.timeline = job && job.queue.length ? (job.blocked ? 'unknown' : 'pending') : 'ok';
    if (job) current.proof.event_count = job.count;
  }
  flow.setFlow(state);
}
function sameEvent(event, expected, seq) {
  return event && Number(event.seq) === seq && event.kind === expected.kind &&
    (event.n == null ? null : Number(event.n)) === (expected.n == null ? null : expected.n) &&
    (event.added == null ? null : Number(event.added)) === (expected.added == null ? null : expected.added);
}
async function drain(id, notify) {
  const revision = identity.revision(), key = revision + ':' + id;
  if (running.has(key)) return running.get(key);
  async function send() {
    let job;
    while ((job = read(id)) && job.ready && job.queue.length && identity.revision() === revision) {
      const op = job.queue[0], next = job.count + 1;
      let confirmed = false;
      if (!op.sent) {
        op.sent = true;
        update(id, job);
        try {
          const ack = await api.eventAppend(Object.assign({ id }, op.body));
          confirmed = ack.ok && Number(ack.event && ack.event.seq || ack.event_count) === next &&
            (!ack.event || !ack.event.kind || sameEvent(ack.event, op.body, next));
        } catch (e) {}
      }
      if (identity.revision() !== revision) return;
      if (!confirmed) {
        try {
          const detail = await api.recordGet(id), rec = detail.record;
          confirmed = detail.ok && rec && rec.id === id && Array.isArray(rec.events) &&
            rec.events.some(evt => sameEvent(evt, op.body, next));
        } catch (e) {}
      }
      if (identity.revision() !== revision) return;
      // Other user actions can append to this queue while a reply is in flight.
      job = read(id);
      if (!job) return;
      if (!confirmed) { job.blocked = true; update(id, job); notify(id); return; }
      job.count = next;
      job.queue.shift();
      job.blocked = false;
      update(id, job);
      notify(id);
    }
  }
  const promise = send();
  running.set(key, promise);
  try { await promise; } finally { running.delete(key); }
}
function enqueue(st, body, notify) {
  if (!st || !st.rid || !st.proof || st.proof.status === 'failed') return;
  const job = read(st.rid) || { ready: st.proof.status === 'ok', count: Number(st.proof.event_count) || 0, queue:[] };
  job.queue.push({ body, sent:false });
  update(st.rid, job);
  notify(st.rid);
  if (job.ready) return drain(st.rid, notify);
}
function created(id, proof, notify) {
  const job = read(id);
  if (!job) return;
  job.ready = proof.status === 'ok';
  job.blocked = !job.ready;
  job.count = Number(proof.event_count) || 0;
  update(id, job);
  return drain(id, notify);
}
async function recover(notify, activeCreate) {
  const revision = identity.revision();
  for (const [id, job] of Object.entries(flow.getFlow().eventJobs || {})) {
    if (id === activeCreate || identity.revision() !== revision) continue;
    if (job.ready) { await drain(id, notify); continue; }
    const detail = await api.recordGet(id);
    if (revision !== identity.revision()) return;
    if (detail.ok && detail.record && detail.record.id === id && Number(detail.record.event_count || 0) === 0) {
      job.ready = true;
      update(id, job);
      await drain(id, notify);
    }
  }
}
module.exports = { enqueue, created, recover };
