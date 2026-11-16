'use strict';
// 仅测试用：mock wx-server-sdk 的桥接模块。
// notify.test.js 通过 Module._resolveFilename 把 require('wx-server-sdk') 指到这里，
// 具体实现由测试进程设置的 global.__WX_SERVER_SDK_FACTORY__ 提供。
// 本文件无任何网络/文件访问，不会真实发送订阅消息。
const factory = global.__WX_SERVER_SDK_FACTORY__;
if (typeof factory !== 'function') {
  throw new Error('notify.test.js: global.__WX_SERVER_SDK_FACTORY__ 未设置');
}
module.exports = factory();
