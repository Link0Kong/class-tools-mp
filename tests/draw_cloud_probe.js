/* draw_cloud_probe.js —— 抽签存证 RPC 只读探测（测试身份；不打印 token、不写业务数据）
 *
 * 用途：确认云端 `draw_record_list` / `draw_record_get` 是否已应用（契约 web/draw/CONTRACT.md §1.3），
 * 以及测试身份可见口径（is_test 隔离 / 今日次数 / 记录字段是否泄露 sid）。
 *
 * 用法：node draw_cloud_probe.js [recordId]
 *   - 默认官方测试身份 3260799999 / 测试账号（仅只读）；
 *   - 传 recordId 时额外调用 draw_record_get；
 *   - 不调用 create/append/purge，不写入任何业务数据。
 */
'use strict';
const https = require('https');
const cfg = require('C:/Users/Ko_Li/.openclaw/workspace/mp-class-tools/utils/cloud-config.js');

function post(path, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(cfg.restBase.replace(/\/$/, '') + path);
    const data = JSON.stringify(body || {});
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.publishableKey }, headers || {}),
      timeout: 15000
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(buf); } catch (e) { parsed = buf; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function shapeOf(obj) {
  if (!obj || typeof obj !== 'object') return typeof obj;
  if (Array.isArray(obj)) return 'array(' + obj.length + ')';
  return Object.keys(obj).join(',');
}

(async () => {
  const rid = process.argv[2] || '';
  const v = await post('/rpc/class_verify', { p_sid: '3260799999', p_name: '测试账号' });
  const d = v.data || {};
  console.log('class_verify status =', v.status, '| ok =', d.ok, '| token =', d.token ? ('len ' + String(d.token).length) : '(none)');
  if (!d.token) { console.log('verify body =', JSON.stringify(d).slice(0, 300)); process.exit(1); }
  const h = { 'X-Class-Token': d.token };

  const list = await post('/rpc/draw_record_list', { p_scope: 'today', p_limit: 30 }, h);
  console.log('draw_record_list status =', list.status);
  if (list.status !== 200) { console.log('list body =', JSON.stringify(list.data).slice(0, 400)); process.exit(2); }
  const raw = Array.isArray(list.data) ? (list.data[0] || {}) : (list.data || {});
  console.log('list ok =', raw.ok, '| scope =', raw.scope, '| day =', raw.day,
    '| today_count =', raw.today_count, '| today_mine =', raw.today_mine, '| records =', Array.isArray(raw.records) ? raw.records.length : '(none)');
  if (Array.isArray(raw.records) && raw.records.length) {
    const r = raw.records[0] || {};
    console.log('record shape =', shapeOf(r));
    console.log('record id/day/seq =', r.id, r.day, r.seq_day, '| at =', r.at, '| event_count =', r.event_count);
    console.log('record has sid =', Object.prototype.hasOwnProperty.call(r, 'sid'), '| keys leak sid =',
      JSON.stringify(r).indexOf('"sid"') >= 0 || JSON.stringify(r).indexOf('sid:') >= 0);
    console.log('params =', JSON.stringify(r.params), '| labels =', JSON.stringify(r.labels), '| hash len =', String(r.hash || '').length);
  }

  if (rid) {
    const g = await post('/rpc/draw_record_get', { p_id: rid }, h);
    console.log('draw_record_get status =', g.status);
    const gd = Array.isArray(g.data) ? (g.data[0] || {}) : (g.data || {});
    console.log('get ok =', gd.ok, '| reason =', gd.reason || '');
    if (gd.record) {
      console.log('get record shape =', shapeOf(gd.record));
      console.log('canon present =', typeof gd.record.canon === 'string', '| seed =', gd.record.seed, '| algo =', gd.record.algo);
      console.log('events =', Array.isArray(gd.record.events) ? gd.record.events.length : '(none)');
    }
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.message); process.exit(1); });
