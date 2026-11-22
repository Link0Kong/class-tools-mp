// utils/version.js —— 小程序版本号（唯一来源）
//
// 2026-11-22 起：当前版本 2.1.0（界面字号/间距整体放大）。写在这个文件里，由 app.js 挂到 globalData.version，
// 「我的」页底部与 README / CHANGELOG 顶部展示同一版本号。以后发版只改这里（连同文档），
// 页面里不要再硬编码版本字符串。
const VERSION = '2.1.0';
const RELEASED_AT = '2026-11-22';

function text() { return '班级工具 · v' + VERSION; }

module.exports = { VERSION: VERSION, RELEASED_AT: RELEASED_AT, text: text };
