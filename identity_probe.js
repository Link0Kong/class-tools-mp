/* 身份 RPC 只读探测：class_verify + class_members（不写任何云表）
 * 用法：node identity_probe.js [sid] [name]
 * 默认使用 测试账号 / 3260799999；打印 token 长度与名单人数，不打印 token 明文。
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

(async () => {
  const sid = process.argv[2] || '3260799999';
  const name = process.argv[3] || '测试账号';
  const v = await post('/rpc/class_verify', { p_sid: sid, p_name: name });
  console.log('class_verify status =', v.status);
  const d = v.data || {};
  console.log('class_verify keys =', Object.keys(d));
  console.log('ok =', d.ok, '| reason =', d.reason || '');
  if (d.token) {
    console.log('token length =', String(d.token).length, '| sid =', d.sid, '| name =', d.name, '| role =', d.role, '| badge =', d.badge, '| is_admin =', d.is_admin);
    const m = await post('/rpc/class_members', {}, { 'X-Class-Token': d.token });
    console.log('class_members status =', m.status, '| count =', Array.isArray(m.data) ? m.data.length : '(not array)');
    if (Array.isArray(m.data) && m.data.length) {
      console.log('member keys =', Object.keys(m.data[0]));
      console.log('first =', JSON.stringify(m.data[0]));
      const withRole = m.data.filter((x) => x && x.role);
      console.log('role non-empty count =', withRole.length);
      console.log('roles sample =', JSON.stringify(withRole.slice(0, 5)));
    } else {
      console.log('class_members body =', JSON.stringify(m.data).slice(0, 500));
    }
  } else {
    console.log('class_verify body =', JSON.stringify(d).slice(0, 500));
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.message); process.exit(1); });
