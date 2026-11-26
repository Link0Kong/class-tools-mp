const { test } = require('node:test');
const assert = require('node:assert/strict');
const { device } = require('./mock_device');
const A = '9999000001', B = '9999000002';
const tick = () => new Promise(resolve => setImmediate(resolve));
const reply = (req, data, statusCode = 200) => req.success({ statusCode, data });

for (const code of [200, 401]) {
  for (const next of [A, B]) {
    test(`late members, marks and userdata ${code}; next ${next === A ? 'ticket' : 'account'}`, async () => {
      const requests = [];
      const dev = device({ respond(req) { requests.push(req); } });
      const cloud = dev.util('cloud'), store = dev.util('store'), flow = dev.util('flow');
      flow.saveLastDraw({ result:[9] });
      store.get().ttLocal = { c:[{name:'previous', day:1, start:1, end:1}], t:'2026-09-07' };
      store.saveQuiet();
      const old = [cloud.classMembersPull(true), cloud.marksPull(true), cloud.udPull(true)];
      await tick();
      const previous = requests.splice(0);
      assert.equal(previous.length, 3);
      dev.login(next, 'new');
      const fresh = cloud.classMembersPull(true);
      await tick();
      assert.equal(requests.length, 1);
      assert.equal(requests[0].header['X-Class-Token'], next + '/new');
      reply(requests.shift(), [{seat:2,name:'current'}]);
      await fresh;
      previous.forEach(req => reply(req, req.url.includes('class_members') ? [{seat:1,name:'stale'}]
        : req.url.includes('marks?') ? [{kind:'hw',ref:'stale',val:true}]
        : [{blob: JSON.stringify({v:6, nick:'stale',at:{nick:20}})}], code));
      await Promise.all(old);
      assert.equal(dev.identity.token(), next + '/new');
      assert.equal(cloud.members()[0].name, 'current');
      assert.equal(store.get().hwDone.stale, undefined);
      assert.doesNotMatch(dev.util('privacy').exportJson(store.get(), dev.identity.get()), /stale/);
      if (next === B) {
        assert.equal(flow.lastDraw(), null);
        assert.equal(store.get().ttLocal, null);
        dev.identity.logout(); dev.login(A, 'back');
        assert.equal(flow.lastDraw().result[0], 9);
        assert.equal(store.get().ttLocal.c[0].name, 'previous');
      }
    });
  }
}

test('failed roster request retains known members; an explicit empty roster removes them', async () => {
  let next = [{seat:1,name:'fixture'}], status = 200;
  const dev = device({ respond(req) { reply(req, next, status); } });
  const cloud = dev.util('cloud');
  await cloud.classMembersPull(true);
  status = 503;
  await cloud.classMembersPull(true);
  assert.equal(cloud.members().length, 1);
  status = 200; next = [];
  await cloud.classMembersPull(true);
  assert.equal(cloud.members().length, 0);
});

test('unknown legacy snapshots stay read-only; only explicitly owned pending marks are recovered', () => {
  const original = JSON.stringify({ nick:'owner unknown', markPend:[
    {seat:A,kind:'hw',ref:'A',val:true}, {seat:B,kind:'hw',ref:'B',val:true}
  ] });
  const storage = { zq_tools_v2:original, zq_flow:JSON.stringify({draw:{result:[8]}}) };
  const dev = device({ respond() { throw Error('unexpected network'); } }, storage);
  for (const sid of [A,B]) {
    dev.login(sid, 'test');
    const store = dev.util('store');
    assert.equal(store.get().markPend.length, 1);
    assert.equal(store.get().markPend[0].seat, sid);
    assert.equal(dev.util('flow').lastDraw(), null);
    store.saveQuiet();
    assert.equal(storage.zq_tools_v2, original);
  }
});
