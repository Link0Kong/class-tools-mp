const { test } = require('node:test');
const assert = require('node:assert/strict');
const { device } = require('./mock_device');
const wait = () => new Promise(resolve => setImmediate(resolve));
function setup(mode) {
  const records = new Map(), writes = [];
  let create;
  const dev = device({respond(req) {
    const {p_id:id, p_kind:kind, p_n:n, p_added:added} = req.data;
    const ok = data => req.success({statusCode:200,data});
    if (req.url.endsWith('draw_record_create')) {
      create = () => { const r = {id,hash:'synthetic',result:req.data.p_result,events:[],event_count:0};
        records.set(id,r); ok({ok:true,record:r}); };
    } else if (req.url.endsWith('draw_event_append')) {
      writes.push([id,kind]);
      const record = records.get(id);
      if (mode !== 'rejected') {
        const event = {seq:record.events.length+1,kind,n,added};
        record.events.push(event); record.event_count = event.seq;
        if (mode !== 'lost') { ok({ok:true,event,event_count:event.seq}); return; }
        req.fail(Error('lost response'));
      } else ok({ok:false,reason:'denied'});
    } else if (req.url.endsWith('draw_record_get')) ok({ok:true,record:records.get(id)});
    else throw Error(req.url);
  }});
  const page = dev.page('draw/draw'), flow = dev.util('flow');
  page.data.start = 1; page.data.end = 8; page.data.count = 3; page.data.autoRe = false;
  return {dev,page,flow,records,writes,confirm:()=>create()};
}

test('creation in flight, ordered remove/refill/reset complete for the detached record', async () => {
  const {page,flow,records,writes,confirm} = setup('success');
  page.doDraw(); await wait();
  const id = flow.getFlow().draw.rid;
  page.removeAt(0); page.refill(); page.reset();
  assert.equal(flow.getFlow().draw,null);
  page.doDraw();
  confirm();
  await wait(); await wait();
  assert.deepEqual(writes,[[id,'remove'],[id,'refill'],[id,'reset']]);
  assert.deepEqual(records.get(id).events.map(e=>e.seq),[1,2,3]);
  assert.notEqual(flow.getFlow().draw.rid,id);
});
for (const mode of ['lost','rejected']) {
  test(mode + ': export follows the confirmed sequence; reading cannot duplicate append', async () => {
    const {dev,page,flow,records,writes,confirm} = setup(mode);
    page.doDraw(); await wait(); confirm(); await wait();
    const id = flow.getFlow().draw.rid, initial = records.get(id).result.slice();
    assert.ok(page.buildExportOpt().qr);
    page.removeAt(0);
    assert.equal(page.buildExportOpt().qr,undefined);
    await wait(); await wait();
    const output = page.buildExportOpt();
    if (mode === 'lost') assert.ok(output.qr);
    else { assert.equal(output.qr,undefined); assert.match(JSON.stringify(output.config),/未确认/); }
    page.buildExportOpt();
    await dev.util('draw-events').recover(()=>{});
    assert.deepEqual(writes,[[id,'remove']]);
    assert.deepEqual(records.get(id).result, initial);
  });
}
