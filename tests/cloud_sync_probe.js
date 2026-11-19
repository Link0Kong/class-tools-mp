/* cloud_sync_probe.js —— 真实云端只读探测：测试身份的 userdata 里 homeTools / prefs.toolOrder 现状
 * 用法：node cloud_sync_probe.js
 * 说明：只读（GET），不写任何云表；不打印 token / 不打印通知等其它内容。
 */
'use strict';
const https = require('https');
const cfg = require(require('path').resolve(__dirname, '..', 'utils', 'cloud-config.js'));

function req(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(cfg.restBase.replace(/\/$/, '') + path);
    const data = body == null ? null : JSON.stringify(body);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: method,
      headers: Object.assign({ Authorization: 'Bearer ' + cfg.publishableKey }, headers || {}),
      timeout: 15000
    };
    if (data) { opts.headers['Content-Type'] = 'application/json'; opts.headers['Content-Length'] = Buffer.byteLength(data); }
    const r = https.request(opts, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(buf); } catch (e) { parsed = buf; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const SID = '3260799999';
  const NAME = '测试账号';
  const v = await req('POST', '/rpc/class_verify', { p_sid: SID, p_name: NAME });
  const d = v.data || {};
  console.log('class_verify status =', v.status, '| ok =', d.ok, '| reason =', d.reason || '');
  if (!d.token) { console.log('body =', JSON.stringify(d).slice(0, 300)); return; }
  console.log('identity =', d.sid, d.name, '| is_admin =', d.is_admin, '| token length =', String(d.token).length);
  const h = { 'X-Class-Token': 'holder' };
  h['X-Class-Token'] = d.token;
  const g = await req('GET', '/userdata?select=*&id=eq.' + encodeURIComponent(SID), null, h);
  console.log('userdata GET status =', g.status, '| rows =', Array.isArray(g.data) ? g.data.length : '(not array)');
  if (!Array.isArray(g.data) || !g.data.length) { console.log('体: 测试身份暂无 userdata 行（换设备同步会由客户端首次推送创建）'); return; }
  const row = g.data[0];
  let blob = null;
  try { blob = JSON.parse(row.blob); } catch (e) { console.log('blob JSON 解析失败'); return; }
  console.log('blob 顶层键 =', Object.keys(blob).join(','));
  console.log('at 键 =', blob.at ? Object.keys(blob.at).join(',') : '(none)');
  console.log('homeTools =', JSON.stringify(blob.homeTools));
  console.log('homeToolsAt =', blob.homeToolsAt, '| at.homeTools =', blob.at && blob.at.homeTools);
  console.log('prefs 键 =', blob.prefs ? Object.keys(blob.prefs).join(',') : '(none)');
  if (blob.prefs) {
    console.log('prefs.toolOrder =', JSON.stringify(blob.prefs.toolOrder || null));
    console.log('prefs.ntSub =', blob.prefs.ntSub, '| prefs.hwRemind size =', Object.keys(blob.prefs.hwRemind || {}).length);
  }
  console.log('row.ts =', row.ts, '| row.id =', row.id);
})().catch((e) => { console.error('PROBE ERROR', e && e.message); process.exit(1); });
