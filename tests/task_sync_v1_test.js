// Run with node --test tests/task_sync_v1_test.js. No network or real credentials.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { device } = require('./mock_device.js');
const vectors = require('./_sync_fixtures/taskdata_conflicts_v1.json');
const protocol = require('../utils/task-sync.js');
const sid = '9999000001', secondSid = '9999000002';
const clone = x => JSON.parse(JSON.stringify(x));
const fixturePath = path.resolve(__dirname, '../../web/deploy/tests/taskdata_conflicts_v1.json');

test('packaged W03 vectors match their owner in a five-repository checkout', () => {
  if (existsSync(fixturePath)) assert.deepEqual(vectors, JSON.parse(readFileSync(fixturePath, 'utf8')));
});
for (const v of vectors.merge) test('W03 merge ' + v.name, () => {
  assert.deepEqual(protocol.rebase(v.base, v.local, v.remote), v.expected);
});
for (const v of vectors.wire) test('W03 wire ' + v.name, () => {
  const decoded = protocol.decode(v.blob, v.ts);
  assert.deepEqual(decoded && decoded.path, v.path);
  if (decoded && decoded.path.length) {
    const result = JSON.parse(protocol.encode(decoded, { items: [{ id: 'replacement' }] }));
    let leaf = result;
    for (const key of v.path) leaf = leaf[key];
    assert.deepEqual(leaf, { items: [{ id: 'replacement' }] });
  }
});
for (const v of vectors.returnedRows) test('W03 receipt ' + v.name, () => {
  assert.equal(protocol.response(v.rows, { id: sid, ts: 42, blob: '{"items":[]}' }), v.event);
});

function server() {
  const db = new Map(), calls = [];
  return { db, calls, respond(req) {
    const url = new URL(req.url), method = req.method;
    const owner = req.header['X-Class-Token'].split('/')[0];
    const filter = url.searchParams.get('id'), row = db.get(owner);
    calls.push({ method, filter, prior: url.searchParams.get('ts'), prefer: req.header.Prefer });
    assert.equal(url.pathname, '/taskdata');
    if (method === 'GET') {
      assert.equal(filter, 'eq.' + owner);
      return req.success({ statusCode: 200, data: row ? [clone(row)] : [] });
    }
    assert.equal(req.data.id, owner);
    if (method === 'POST') {
      assert.equal(req.header.Prefer, 'resolution=ignore-duplicates,return=representation');
      if (row) return req.success({ statusCode: 201, data: [] });
    } else {
      assert.equal(method, 'PATCH');
      assert.equal(filter, 'eq.' + owner);
      assert.equal(req.header.Prefer, 'return=representation');
      if (!row || url.searchParams.get('ts') !== 'eq.' + row.ts) return req.success({ statusCode: 200, data: [] });
    }
    db.set(owner, clone(req.data));
    req.success({ statusCode: 200, data: [clone(req.data)] });
  } };
}

function add(client, id, title) {
  return client.task.upsert(client.task.emptyItem({ id, title }));
}

test('two devices racing first inserts, offline edit versus delete, metadata and attachment projection', async () => {
  const host = server(), a = device(host), b = device(host);
  await Promise.all([a.task.pull(true), b.task.pull(true)]);
  add(a, 'a', 'A'); add(b, 'b', 'B');
  await Promise.all([a.task.flush(), b.task.flush()]);
  assert.deepEqual(JSON.parse(host.db.get(sid).blob).items.map(i => i.id).sort(), ['a','b']);
  assert.equal(host.calls.filter(r => r.method === 'POST').length, 2);
  await Promise.all([a.task.pull(true), b.task.pull(true)]);
  const record = host.db.get(sid), raw = JSON.parse(record.blob);
  raw.future = { z: 1 }; raw.items[0].foreign = [2];
  const retained = raw.items[0].id, deleted = raw.items[1].id;
  record.blob = JSON.stringify({ meta: 17, data: raw });
  a.task.removeTask(deleted); await a.task.flush();
  const local = b.task.findTask(deleted); local.title = 'offline'; b.task.save();
  const item = b.task.findTask(retained); item.title = 'edited'; item.attachments = '[{"n":"doc","path":"qa-local"}]'; b.task.save();
  await b.task.flush();
  const saved = JSON.parse(host.db.get(sid).blob);
  assert.equal(saved.meta,17); assert.deepEqual(saved.data.future,{z:1});
  assert.deepEqual(saved.data.items.map(i => i.id),[retained]); assert.deepEqual(saved.data.items[0].foreign,[2]);
  assert.doesNotMatch(host.db.get(sid).blob,/qa-local/); assert.match(b.task.findTask(retained).attachments,/qa-local/);
});

test('four misses keep draft; bad acknowledgment cannot confirm; lost success is read back after restart', async () => {
  const host = server(), a = device(host);
  add(a,'a','A');
  let writes = 0;
  a.intercept = req => {
    if (req.method === 'GET') return false;
    req.success({statusCode:200,data: ++writes % 2 ? [] : [{}]}); return true;
  };
  await a.task.flush();
  assert.equal(writes,4); assert.equal(a.task.state().dirty,true); assert.equal(host.db.size,0);
  a.intercept = req => {
    if (req.method === 'GET') return false;
    host.respond(Object.assign({}, req, {success: () => req.fail(new Error('lost-reply'))})); return true;
  };
  await a.task.flush(); assert.equal(a.task.state().dirty,true);
  const b = device(host, a.storage), seen = host.calls.length;
  assert.equal(await b.task.pull(true),true); assert.equal(b.task.state().dirty,false);
  assert.deepEqual(host.calls.slice(seen).map(r => r.method),['GET']);
});

test('in-flight edit continues; old token and account callbacks leave renewed identity and drafts alone', async () => {
  const host = server(), a = device(host);
  add(a,'a','draft');
  let request, ready;
  const waiting = new Promise(resolve => { ready = resolve; });
  a.intercept = req => {
    if (req.method !== 'POST') return false;
    request = req; ready(); return true;
  };
  const job = a.task.flush(); await waiting;
  a.task.findTask('a').title = 'during write'; a.task.save();
  a.intercept = null;host.respond(request);await job;
  assert.equal(JSON.parse(host.db.get(sid).blob).items[0].title,'during write');
  let signal;
  const seen = new Promise(resolve => { signal = resolve; });
  a.intercept = req => {request = req;signal();return true;};
  const stale = a.task.pull(true);await seen;
  a.login(sid,'renewed');request.success({statusCode:401});await stale;
  assert.equal(a.identity.token(),sid+'/renewed');
  a.task.findTask('a').title = 'keep on A';a.task.save();
  a.login(secondSid,'other');assert.equal(a.task.items().length,0);
  a.login(sid,'back');assert.equal(a.task.findTask('a').title,'keep on A');
});

test('a timestamp-only old cache needs explicit confirmation; malformed cloud snapshot never writes', async () => {
  const host = server(), old = {items:[{id:'old',title:'old task',createdAt:1,updatedAt:1}], lists:[]};
  const storage = {zq_task_owner_v1:sid, zq_tools_v2:JSON.stringify({task:old})};
  storage['zq_task_cloud_'+sid] = JSON.stringify({ts:5});
  host.db.set(sid,{id:sid,ts:8,blob:JSON.stringify({items:[{id:'remote',title:'remote task'}],lists:[]})});
  const a = device(host,storage);await a.task.pull(true);
  assert.deepEqual(host.calls.map(x=>x.method),['GET']);assert.ok(a.task.legacyDraft());
  assert.equal(a.task.items()[0].id,'remote');a.task.restoreLegacy();await a.task.flush();
  assert.deepEqual(JSON.parse(host.db.get(sid).blob).items.map(row=>row.id).sort(),['old','remote']);
  add(a,'new','dirty');host.db.get(sid).blob='{';
  const start = host.calls.length;
  await a.task.flush();assert.equal(a.task.state().dirty,true);
  assert.deepEqual(host.calls.slice(start).map(r=>r.method),['GET']);
});

test('unsupported PATCH or a denied table keeps edits locally and never uses an unconditional upsert', async () => {
  const host = server(), client = device(host);
  add(client, 'a', 'old');
  await client.task.flush();
  client.task.findTask('a').title = 'offline';
  client.task.save();
  const writes = [];
  for (const code of [405, 403]) {
    client.intercept = req => {
      if (req.method === 'GET') return false;
      writes.push(req.method);
      req.success({ statusCode: code, data: {} });
      return true;
    };
    await client.task.flush();
    assert.equal(client.task.state().dirty, true);
    assert.match(client.task.status(), code === 405 ? /不支持条件更新/ : /无权限/);
    assert.equal(JSON.parse(host.db.get(sid).blob).items[0].title, 'old');
  }
  assert.deepEqual(writes, ['PATCH', 'PATCH']);
});

test('large checkpoints survive device storage-key limits and a failed replacement', () => {
  const c = device(server()), files = new Map();
  c.wx.env = { USER_DATA_PATH: '/qa' };
  c.wx.getFileSystemManager = () => ({
    readFileSync: file => files.get(file),
    writeFileSync: (file,data) => { files.set(file,data); },
    unlinkSync: file => files.delete(file),
  });
  const checkpoints = c.util('task-storage');
  const first = { ts:1, text:'甲'.repeat(250000) }, second = { ts:2, text:'乙'.repeat(250000) };
  checkpoints.write('qa-large',first);
  assert.equal(checkpoints.read('qa-large').text, first.text);
  const write = c.wx.setStorageSync;
  c.wx.setStorageSync = () => { throw new Error('quota'); };
  assert.throws(() => checkpoints.write('qa-large',second), /quota/);
  assert.equal(checkpoints.read('qa-large').text, first.text);
  c.wx.setStorageSync=write;
  checkpoints.write('qa-large',second);assert.equal(files.size,1);
  checkpoints.remove('qa-large');assert.equal(files.size,0);
});

test('RLS-hidden GET [] retains a known baseline and offline edits across restart, then merges after access returns', async () => {
  const host = server(), a = device(host);
  add(a,'owned','confirmed');await a.task.flush();
  assert.equal(host.calls.find(r=>r.method==='POST').prefer,'resolution=ignore-duplicates,return=representation');
  a.intercept=req=>{
    if(req.method==='GET') { req.success({statusCode:200,data:[]});return true; }
    throw new Error('an invisible pre-existing row must not be recreated');
  };
  await a.task.pull(true);
  assert.equal(a.task.findTask('owned').title,'confirmed');
  a.task.findTask('owned').title='edited offline';a.task.save();
  await a.task.flush();
  assert.equal(a.task.state().dirty,true);assert.match(a.task.status(),/不可见/);
  assert.equal(JSON.parse(host.db.get(sid).blob).items[0].title,'confirmed');
  const b=device(host,a.storage);
  b.intercept=a.intercept;await b.task.pull(true);
  assert.equal(b.task.state().dirty,true);assert.equal(b.task.findTask('owned').title,'edited offline');
  b.intercept=null;await b.task.flush();
  assert.equal(b.task.state().dirty,false);
  assert.deepEqual(host.calls.filter(r=>r.method!=='GET').map(r=>r.method),['POST','PATCH']);
  assert.equal(JSON.parse(host.db.get(sid).blob).items[0].title,'edited offline');
});
