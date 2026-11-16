'use strict';
// 验证：小程序不依赖 PATCH，软删/更新走 GET 整行 + POST upsert。
const path = require('path');
const ROOT = path.join(__dirname, '..', 'mp-class-tools');
const calls = [];
const store = {};
global.wx = {
  getStorageSync: (k) => store[k] === undefined ? '' : store[k],
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: (k) => { delete store[k]; },
  request: (o) => {
    calls.push(o.method + ' ' + o.url);
    if (o.method === 'GET') { o.success({ statusCode: 200, data: [{ id: 'r1', acc: 'u1', data: '{}', arch: false, ts: 1 }] }); return; }
    o.success({ statusCode: 201, data: [] });
  }
};
const cloud = require(path.join(ROOT, 'utils/cloud.js'));
cloud.configure({ enabled: true, restBase: 'https://example.test/rest/', publishableKey: 'k' });
cloud.sessionSet('u1', 'hash');
cloud.cbPatch('fitrecs', 'r1', { arch: true }).then(() => {
  const ok = !calls.some((x) => x.indexOf('PATCH') === 0) && calls.some((x) => x.indexOf('GET') === 0) && calls.some((x) => x.indexOf('POST') === 0);
  console.log(calls.join('\n'));
  console.log(ok ? 'PASS patch fallback' : 'FAIL patch fallback');
  process.exit(ok ? 0 : 1);
}).catch((e) => { console.error(e); process.exit(1); });
