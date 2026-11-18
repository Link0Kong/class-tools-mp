/* identity_encoding_unit.js —— 本机身份名乱码防护（2026-11-18）
 * 背景：自动化/旧链路把中文名按非 UTF-8 写入 storage 时会出现 U+FFFD（�），
 * 首页问候/作业昵称/数据页/导出图都会显示一片乱码。identity.normalize 必须把这种身份判无效，
 * 让页面回身份页重新验证，而不是继续展示乱码。
 * 运行：node identity_encoding_unit.js
 */
'use strict';
const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const mem = {};
global.wx = {
  getStorageSync(k) { return mem[k] === undefined ? '' : mem[k]; },
  setStorageSync(k, v) { mem[k] = v; },
  removeStorageSync(k) { delete mem[k]; },
  getStorageInfoSync() { return { keys: Object.keys(mem), currentSize: 0, limitSize: 10240 }; },
  getSystemInfoSync() { return {}; },
  getAppBaseInfo() { return {}; }
};
const identity = require(path.join(ROOT, 'utils', 'identity.js'));
let pass = 0;
function T(name, fn) { try { fn(); pass++; console.log('PASS  ' + name); } catch (e) { console.log('FAIL  ' + name + ' :: ' + e.message); process.exitCode = 1; } }

T('乱码姓名（U+FFFD）保存被拒且清空身份', function () {
  const bad = { token: 'tok', sid: '3260799999', name: '\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\u02FA\uFFFD', role: '', badge: '', is_admin: false, ts: 1 };
  assert.strictEqual(identity.save(bad), null);
  assert.strictEqual(identity.has(), false);
  assert.ok(!mem['zq_class_identity']);
});

T('典型 mojibake（锟斤拷 / Ã / ï¿½）也被拒', function () {
  ['锟斤拷', 'Ã¤Â¸Â­', 'ï¿½', 'â€‹'].forEach(function (nm) {
    assert.strictEqual(identity.save({ token: 't', sid: '3260799999', name: nm, ts: 1 }), null, nm);
  });
});

T('正常中文姓名仍可保存/读取', function () {
  const ok = identity.save({ token: 'tok', sid: '3260799999', name: '测试账号', role: '', badge: '', is_admin: false, ts: 1 });
  assert.ok(ok && ok.name === '测试账号');
  assert.strictEqual(identity.get().name, '测试账号');
  assert.strictEqual(identity.has(), true);
});

console.log('---------------- ' + pass + ' passed ----------------');
