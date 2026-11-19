/* 云端通知表只读探测（性能优化 1.4.4 的签名/整表校验用；不写任何云表）
 *
 * 用法：node perf_cloud_probe.js [sid] [name]
 * 默认 测试账号 / 3260799999（与 identity_probe.js 相同，只读 RPC）。
 *
 * 验证目标：
 *   1) 轻量签名查询 notices?select=id,ts&order=ts.asc,id.asc&archived=eq.false 可用（RLS 允许、返回 ~2KB）；
 *   2) 轻量查询与整表查询的 (id,ts) 顺序完全一致 → utils/cloud.js 的签名比对有效；
 *   3) 实测 整表 ~2MB vs 签名 ~2KB 的体积比（缓存方案的核心收益）。
 *
 * 输出：_perf_cloud_probe.json（只含行数/字节数/耗时，不含通知内容与 token）
 */
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const cfg = require(require('path').resolve(__dirname, '..', 'utils', 'cloud-config.js'));

const REST = String(cfg.restBase || '').replace(/\/$/, '');

function req(method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(REST + p);
    const data = body === undefined ? null : JSON.stringify(body);
    const h = Object.assign({ Authorization: 'Bearer ' + cfg.publishableKey }, headers || {});
    if (data) h['Content-Type'] = 'application/json';
    const t0 = Date.now();
    const r = https.request({
      hostname: u.hostname, path: u.pathname + (u.search || ''), method: method,
      headers: h, timeout: 20000
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(buf); } catch (e) { parsed = null; }
        resolve({ status: res.statusCode, bytes: Buffer.byteLength(buf, 'utf8'), chars: buf.length, data: parsed, ms: Date.now() - t0 });
      });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function sigOf(rows) {
  return (rows || []).map((r) => String((r && r.id) || '') + ':' + String((r && r.ts) == null ? '' : r.ts)).join('|');
}

(async () => {
  const sid = process.argv[2] || '3260799999';
  const name = process.argv[3] || '测试账号';
  const out = { at: new Date().toISOString(), endpoint: REST.replace(/^https:\/\//, '').split('/')[0] };
  const v = await req('POST', '/rpc/class_verify', { p_sid: sid, p_name: name });
  const id = v.data || {};
  out.verify = { status: v.status, ok: !!id.ok, tokenLength: id.token ? String(id.token).length : 0 };
  if (!id.token) {
    console.log('class_verify 失败：', v.status, String(id.reason || '').slice(0, 120));
    out.error = 'verify-failed';
    fs.writeFileSync(path.join(__dirname, '_perf_cloud_probe.json'), JSON.stringify(out, null, 2), 'utf8');
    process.exit(0);
  }
  const H = { 'X-Class-Token': id.token };
  const rowsQ = 'notices?select=id,ts&order=ts.asc,id.asc&archived=eq.false';
  const fullQ = 'notices?select=*&order=ts.asc,id.asc&archived=eq.false';

  const lite1 = await req('GET', '/' + rowsQ, undefined, H);
  const lite2 = await req('GET', '/' + rowsQ, undefined, H);      // 第二次：验证顺序稳定
  const full = await req('GET', '/' + fullQ, undefined, H);

  const liteRows = Array.isArray(lite1.data) ? lite1.data : [];
  const liteRows2 = Array.isArray(lite2.data) ? lite2.data : [];
  const fullRows = Array.isArray(full.data) ? full.data : [];
  const sigLite = sigOf(liteRows);
  const sigLite2 = sigOf(liteRows2);
  const sigFull = sigOf(fullRows.map((r) => ({ id: r.id, ts: r.ts })));
  const autoRows = fullRows.filter((r) => String(r.body || '').indexOf('[[CLASS_NOTICE_V1]]') === 0);
  let autoGroups = 0, badGroups = 0;
  autoRows.forEach((r) => {
    try {
      const g = JSON.parse(String(r.body).slice('[[CLASS_NOTICE_V1]]'.length));
      if (g && g.id) autoGroups += 1; else badGroups += 1;
    } catch (e) { badGroups += 1; }
  });

  out.notices = {
    status: { lite: lite1.status, liteRepeat: lite2.status, full: full.status },
    rows: { lite: liteRows.length, full: fullRows.length, autoRows: autoRows.length, autoGroups: autoGroups, badAutoJson: badGroups },
    bytes: { lite: lite1.bytes, liteRepeat: lite2.bytes, full: full.bytes },
    ms: { lite: lite1.ms, liteRepeat: lite2.ms, full: full.ms },
    ratio: { fullVsLite: lite1.bytes > 0 ? Math.round(full.bytes / lite1.bytes * 100) / 100 : null },
    sig: {
      length: sigLite.length,
      liteStableAcrossCalls: sigLite === sigLite2,
      sameOrderAsFullQuery: sigLite === sigFull,
      rowsHaveTs: liteRows.every((r) => r && r.ts !== undefined && r.ts !== null)
    }
  };

  // 其他小表（确认「只有 notices 是大头」）
  const hw = await req('GET', '/homework?select=*&order=ts.asc&archived=eq.false', undefined, H);
  const fit = await req('GET', '/fitrecs?select=*&acc=eq.' + encodeURIComponent(sid) + '&arch=eq.false&order=ts.desc', undefined, H);
  const mk = await req('GET', '/marks?select=*&seat=eq.' + encodeURIComponent(sid), undefined, H);
  out.otherTables = {
    homework: { status: hw.status, rows: Array.isArray(hw.data) ? hw.data.length : null, bytes: hw.bytes },
    fitrecs: { status: fit.status, rows: Array.isArray(fit.data) ? fit.data.length : null, bytes: fit.bytes },
    marks: { status: mk.status, rows: Array.isArray(mk.data) ? mk.data.length : null, bytes: mk.bytes }
  };

  out.pass = {
    liteOk: lite1.status === 200,
    fullOk: full.status === 200,
    liteUnder4KB: lite1.bytes < 4096,
    fullOver1_5MB: full.bytes > 1.5 * 1024 * 1024,
    sigStable: sigLite === sigLite2,
    sigMatchesFullOrder: sigLite === sigFull,
    allAutoJsonOk: badGroups === 0
  };
  fs.writeFileSync(path.join(__dirname, '_perf_cloud_probe.json'), JSON.stringify(out, null, 2), 'utf8');

  console.log('== 云端通知表只读探测（不含内容/token）==');
  console.log('notices 行数：lite ' + liteRows.length + ' / full ' + fullRows.length + '（auto ' + autoRows.length + ' 行 → ' + autoGroups + ' 组，坏 JSON ' + badGroups + '）');
  console.log('字节：lite ' + lite1.bytes + ' B / 整表 ' + (full.bytes / 1024 / 1024).toFixed(2) + ' MB（' + out.notices.ratio.fullVsLite + '×）');
  console.log('签名长度 ' + sigLite.length + ' 字符；两次 lite 顺序一致=' + out.notices.sig.liteStableAcrossCalls + '；与整表顺序一致=' + out.notices.sig.sameOrderAsFullQuery);
  console.log('耗时：lite ' + lite1.ms + 'ms / 整表 ' + full.ms + 'ms');
  console.log('其他表：homework ' + hw.bytes + 'B / fitrecs ' + fit.bytes + 'B / marks ' + mk.bytes + 'B');
  const fails = Object.keys(out.pass).filter((k) => !out.pass[k]);
  console.log(fails.length ? ('FAIL: ' + fails.join(', ')) : 'PASS: 全部校验通过');
  process.exitCode = fails.length ? 2 : 0;
})().catch((e) => { console.error('PROBE ERROR', e && e.message); process.exit(1); });
