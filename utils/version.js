// utils/version.js —— 小程序版本号（唯一来源）
//
// app.js 从这里读取版本并写入 globalData.version，
// 「我的」页底部与 README / CHANGELOG 顶部展示同一版本号。以后发版只改这里（连同文档），
// 页面里不要再硬编码版本字符串。
const VERSION = '2.1.2';
const RELEASED_AT = '2026-11-26';

function text() { return '班级工具 · v' + VERSION; }

module.exports = { VERSION: VERSION, RELEASED_AT: RELEASED_AT, text: text };
