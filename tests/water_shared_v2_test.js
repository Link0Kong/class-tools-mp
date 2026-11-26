const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { device } = require('./mock_device.js');
const shared = require('../utils/water-shared.js');
const water = require('../utils/water.js');
const vectors = require('./_sync_fixtures/water_shared_v2_cases.json');
const journey = vectors.journey, room = journey.rooms[0], nextRoom = journey.rooms[1], month = journey.month;
const firstSid = '9999000001', secondSid = '9999000002';
const clone = x => JSON.parse(JSON.stringify(x));
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });

function server() {
  const rooms = new Map(), writes = [];
  function ledger(key) {
    if (!rooms.has(key)) rooms.set(key, { months: new Map(), people: null });
    return rooms.get(key);
  }
  return { ledger, writes, respond(req) {
    const url = new URL(req.url), token = req.header['X-Class-Token'];
    const id = token.split('/')[0];
    const rv = req.data && req.data.roomverify || (url.searchParams.get('roomverify') || '').slice(3);
    const target = ledger(rv);
    const ok = (data, header) => req.success({ statusCode: 200, data: clone(data), header: header || {} });
    if (url.pathname === '/rpc/class_whoami') return ok({ ok: true, sid: id });
    if (url.pathname === '/userdata') return ok([]);
    assert.ok(['/water','/water_room'].includes(url.pathname), req.url);
    if (req.method === 'GET') {
      if (url.pathname === '/water_room') return ok(target.people === null ? [] : [{roomverify:rv, persons:target.people}]);
      const all = Array.from(target.months.values()).sort((a,b) => a.month.localeCompare(b.month));
      const offset = Number(url.searchParams.get('offset')), rows = all.slice(offset, offset + 200);
      return ok(rows, { 'Content-Range': rows.length ? offset + '-' + (offset + rows.length - 1) + '/' + all.length : '*/' + all.length });
    }
    writes.push([id,rv,req.method,url.pathname]);
    if (url.pathname === '/water_room') target.people = req.data.persons;
    else if (req.method === 'DELETE') target.months.delete(url.searchParams.get('month').slice(3));
    else target.months.set(req.data.month,clone(req.data));
    ok([]);
  } };
}
function openPage(client, key = room) {
  const page = client.page('water/water');
  page.onLoad();
  page.setData({ sel: key, hasSel: true });
  page._render();
  return page;
}
function setReading(page, m, value) {
  page.setData({ month: m, reading: String(value) });
  return page.saveRecord();
}

test('vendored W07 vectors match the domain owner', () => {
  const original = path.resolve(__dirname,'../../web/tools/tests/water_shared_v2_cases.json');
  if (existsSync(original)) assert.deepEqual(vectors,JSON.parse(readFileSync(original,'utf8')));
});
test('all shared people values and absence', () => {
  for (const n of vectors.persons.valid) assert.equal(water.roomPersonsOf({ persons:n }),n);
  for (const n of vectors.persons.invalid) assert.equal(water.roomPersonsOf({ persons:n }),null);
  assert.equal(shared.display({ops:[],people:null}).p,vectors.persons.absentDefault);
});
for (const v of vectors.replayCases) test('W07 explicit replay ' + v.id, () => {
  assert.equal(shared.decision(v, v.current), v.decision);
});
for (const v of vectors.refreshCases) test('W07 water page refresh ' + v.id, async () => {
  const host = server(), c = device(host), page = openPage(c);
  const repo = c.util('water-shared');
  repo.save(firstSid,room,{ rows:[{roomverify:room,month,reading:9,persons:5}], people:5, ops:[] });
  const oldRows = v.records === 'ttl-skip';
  if (oldRows) {
    host.ledger(room).months.set(month,{roomverify:room,month,reading:9,persons:5});
    await c.util('cloud').waterList(room,true);
  }
  c.intercept = req => {
    const url = new URL(req.url);
    const success = (data,header={}) => req.success({statusCode:200,data,header});
    if (url.pathname === '/water') {
      if (v.records === 'failed') req.fail(new Error('offline'));
      else if (v.records === 'invalid') success({});
      else if (v.records === 'foreign-row') success([{roomverify:nextRoom,month,reading:8,persons:3}]);
      else if (v.records === 'partial') success([],{'Content-Range':'*/2'});
      else success([]);
    } else if (url.pathname === '/water_room') {
      if (v.people === 'failed') req.fail(new Error('offline'));
      else if (v.people === 'invalid') success([{roomverify:room,persons:7}]);
      else if (v.people === 'complete-3') success([{roomverify:room,persons:3}]);
      else success([]);
    } else return false;
    return true;
  };
  await page._cloudSync(!oldRows);
  assert.deepEqual(clone(page.data.history.map(r=>r.m)),v.expectMonths);
  assert.equal(page.data.persons,v.expectPersons);assert.equal(host.writes.length,0);
});

test('W07 two-client journey, offline recording, reopening, and older client replay', async () => {
  const host = server(), a = device(host), b = device(host);
  b.login(secondSid,'two');
  const pa = openPage(a), pb = openPage(b);
  await pa._cloudSync(true); await pb._cloudSync(true);
  await setReading(pa,month,journey.first.reading);
  await pa.pickPersons(event('p',journey.serverPersons)); await pb._cloudSync(true);
  assert.equal(pb._room().recs[0].r,journey.first.reading);
  // Start the same UI deletion with a confirmed modal and drain its asynchronous save.
  let queued;
  const enqueue = pa._queue.bind(pa);pa._queue = (...args) => (queued = enqueue(...args));
  pa.delRecord(event('m',month));await queued;
  const count = host.writes.length;
  await pb._cloudSync(true);
  assert.deepEqual(clone(pb.data.history.map(r=>r.m)),journey.afterDeleteRefresh.months);
  assert.equal(pb.data.persons, journey.afterDeleteRefresh.persons);
  assert.equal(host.writes.length-count,journey.afterDeleteRefresh.sharedWrites);
  b.util('cloud').configure({enabled:false});
  await setReading(pb,journey.nextMonth,journey.next.reading);
  const restarted = device(host,b.storage);
  restarted.login(secondSid,'reopened');
  const after = openPage(restarted);
  assert.equal(after.data.history[0].m,journey.nextMonth);
  await after._cloudSync(true);
  assert.deepEqual(Array.from(host.ledger(room).months.keys()),journey.afterOfflineCreate.months);
  assert.equal(host.writes.length-count,journey.afterOfflineCreate.sharedWrites);
  const beforeLegacy = host.writes.length;
  await b.util('cloud').configure({enabled:true});
  await b.util('cloud').waterUpsert(room,month,journey.first.reading,journey.first.persons);
  await pa._cloudSync(true);
  assert.deepEqual(Array.from(host.ledger(room).months.keys()).sort(),journey.afterLegacyReconnect.months);
  assert.equal(host.writes.length-beforeLegacy,journey.afterLegacyReconnect.sharedWrites);
});

test('room switch, late unauthorized callback and legacy unowned operations', async () => {
  const host = server(), c = device(host), page = openPage(c);
  host.ledger(nextRoom).people = 2;
  c.util('store').get().waterPend = [{op:'put',rv:room,m:month,r:7,p:4,at:1}];
  let request, captured;
  const started = new Promise(resolve=>{captured=resolve;});
  c.intercept = req => {
    if (!req.url.includes('/water?')) return false;
    request = req;captured();return true;
  };
  const old = page._cloudSync(true);await started;
  c.login(firstSid,'renewed');page.setData({sel:nextRoom});c.intercept=null;
  await page._cloudSync(true);
  request.success({statusCode:401,data:{}});await old;
  assert.equal(c.identity.token(),firstSid+'/renewed');assert.equal(page.data.persons,2);
  assert.equal(host.writes.length,0);assert.equal(c.util('store').get().waterPend.length,1);
});
test('empty RLS read + unavailable identity RPC preserves cache; explicit denial hides it; authorized retry recovers', async () => {
  const host=server(), c=device(host),page=openPage(c);
  host.ledger(room).months.set(month,{roomverify:room,month,reading:9,persons:4});
  await page._cloudSync(true);host.ledger(room).months.clear();
  let response={statusCode:503,data:{}};
  c.intercept = req => {
    if (!req.url.includes('rpc/class_whoami')) return false;
    req.success(response);return true;
  };
  await page._cloudSync(true);
  assert.equal(page.data.history.length,1);assert.ok(!c.util('water-shared').read(firstSid,room).denied);
  response={statusCode:200,data:{ok:false}};
  await page._cloudSync(true);
  assert.equal(page.data.history.length,0);assert.equal(c.util('water-shared').read(firstSid,room).denied,true);
  c.intercept=null;await page._cloudSync(true);
  assert.equal(c.util('water-shared').read(firstSid,room).denied,false);assert.equal(host.writes.length,0);
});

test('an explicit default creates a room record and a lost create followed by delete requires confirmation', async () => {
  const host = server(), c = device(host), page = openPage(c);
  await page._cloudSync(true);
  await page.pickPersons(event('p',4));
  assert.equal(host.ledger(room).people,4);
  c.intercept = req => {
    if (req.method !== 'POST' || !req.url.includes('/water?')) return false;
    host.respond(Object.assign({},req,{success: () => req.fail(new Error('lost reply'))}));
    return true;
  };
  await setReading(page,month,10);
  host.ledger(room).months.delete(month);c.intercept = null;
  await page._cloudSync(true);
  assert.equal(host.ledger(room).months.size,0);
  assert.equal(c.util('water-shared').read(firstSid,room).ops.length,1);
  const before = host.writes.length;
  c.wx.showActionSheet = opts => opts.success({tapIndex:0});
  let submitted;
  const sync = page._cloudSync.bind(page);
  page._cloudSync = force => (submitted = sync(force));
  page.reviewPending();await submitted;
  assert.equal(host.writes.length,before+1);
  assert.equal(host.ledger(room).months.get(month).reading,10);
  assert.equal(c.util('water-shared').read(firstSid,room).ops.length,0);
});

test('same-room late read and late write receipt do not cancel a newer request or draft', async () => {
  const host = server(), c = device(host), page = openPage(c);
  await page._cloudSync(true);
  let request, captured;
  let ready = new Promise(resolve=>{captured=resolve;});
  c.intercept = req => {
    if (req.method !== 'GET' || !req.url.includes('/water?')) return false;
    request = req;captured();return true;
  };
  const stale = page._cloudSync(true);await ready;
  c.intercept = null;host.ledger(room).people=3;await page._cloudSync(true);
  request.success({statusCode:200,data:[{roomverify:room,month,reading:7,persons:4}],header:{'Content-Range':'0-0/1'}});
  await stale;assert.equal(page.data.history.length,0);assert.equal(page.data.persons,3);

  ready = new Promise(resolve=>{captured=resolve;});
  c.intercept = req => {
    if (req.method !== 'POST' || !req.url.includes('/water?')) return false;
    request=req;captured();return true;
  };
  const first=setReading(page,month,10);await ready;
  c.intercept=null;const second=setReading(page,month,11);host.respond(request);
  await Promise.all([first,second]);
  assert.equal(host.ledger(room).months.get(month).reading,11);
  assert.equal(c.util('water-shared').read(firstSid,room).ops.length,0);
});

test('clearing local data discards shared checkpoints and ignores an already issued read', async () => {
  const host=server(), c=device(host),page=openPage(c);
  host.ledger(room).people=3;await page._cloudSync(true);
  let get,signal;
  const captured=new Promise(resolve=>{signal=resolve;});
  c.intercept=req=>{
    if (!req.url.includes('/water_room?')) return false;
    get=req;signal();return true;
  };
  const pending=page._cloudSync(true);await captured;
  c.util('store').reset();host.respond(get);await pending;
  assert.deepEqual(clone(c.util('water-shared').read(firstSid,room)),{ops:[]});
  assert.equal(host.ledger(room).people,3);
});
