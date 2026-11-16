/* ai_unit_all.js —— 汇总运行各技能单元测试（CONTRACT §8.2）
 *
 * 运行：node ai_unit_all.js                    # 默认：每个 ai_unit_<skill>.js 跑一个子进程（隔离崩溃/process.exit）
 *       node ai_unit_all.js --inproc           # 直接 require（兼容旧口径；子进程仍更安全）
 *       node ai_unit_all.js --only=identity,account
 *       node ai_unit_all.js --verbose          # 失败时打印被测文件完整输出
 * 缺失的实现者测试文件 → SKIP（不崩溃，不阻断）。
 * 结果文件：_ai_task/qa/ai_unit_all_result.json
 *
 * 约定：被测文件（ai_unit_<skill>.js）需自己 exit code 表示结果；无 exit code 时按输出里的 "FAIL" 行数判断。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = __dirname;
const QA_DIR = path.resolve(DIR, '..', '_ai_task', 'qa');
const RESULT_FILE = path.join(QA_DIR, 'ai_unit_all_result.json');
const ARGS = process.argv.slice(2);
const INPROC = ARGS.indexOf('--inproc') >= 0;
const VERBOSE = ARGS.indexOf('--verbose') >= 0;
const ONLY = (function () {
  const a = ARGS.filter(function (x) { return x.indexOf('--only=') === 0; })[0];
  if (!a) return null;
  return a.slice('--only='.length).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
})();

// CONTRACT 期望的 8 个技能 → 测试文件
const SKILLS = [
  { key: 'identity', file: 'ai_unit_identity.js' },
  { key: 'account', file: 'ai_unit_account.js' },
  { key: 'homework', file: 'ai_unit_homework.js' },
  { key: 'notice', file: 'ai_unit_notice.js' },
  { key: 'timetable', file: 'ai_unit_timetable.js' },
  { key: 'roll', file: 'ai_unit_roll.js' },
  { key: 'lottery', file: 'ai_unit_lottery.js' },
  { key: 'fitness', file: 'ai_unit_fitness.js' }
];

function exists(p) { try { fs.statSync(p).isFile(); return true; } catch (e) { return false; } }
function tail(text, n) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  return lines.slice(-n).join('\n');
}
function parseSummary(stdout) {
  // 兼容 harness report 行：== xxx ==  12 PASS / 1 FAIL / 0 SKIP  (13)  => PASS
  const re = /(\d+)\s+PASS\s*\/\s*(\d+)\s+FAIL(?:\s*\/\s*(\d+)\s+SKIP)?/g;
  let m, last = null;
  while ((m = re.exec(stdout))) last = { pass: +m[1], fail: +m[2], skip: +(m[3] || 0) };
  return last;
}

function main() {
  // 发现测试文件：契约清单 + 目录里其它 ai_unit_*.js
  const targets = [];
  const seen = {};
  SKILLS.forEach(function (s) { if (!ONLY || ONLY.indexOf(s.key) >= 0) { targets.push(s); seen[s.file] = 1; } });
  try {
    fs.readdirSync(DIR).forEach(function (f) {
      if (f === path.basename(__filename)) return;   // 排除自身
      if (!/^ai_unit_.*\.js$/.test(f)) return;
      if (seen[f]) return;
      if (ONLY) {
        const key = f.replace(/^ai_unit_/, '').replace(/\.js$/, '');
        if (ONLY.indexOf(key) < 0) return;
      }
      targets.push({ key: f.replace(/^ai_unit_/, '').replace(/\.js$/, ''), file: f });
    });
  } catch (e) { /* ignore */ }

  console.log('== 微信 AI · 技能单测汇总（' + (INPROC ? 'in-process require' : '子进程隔离') + '）==');
  console.log('目录: ' + DIR);
  console.log('时间: ' + new Date().toISOString() + '\n');

  const results = [];
  targets.forEach(function (t) {
    const filePath = path.join(DIR, t.file);
    const label = t.key;
    if (!exists(filePath)) {
      results.push({ key: label, file: t.file, status: 'SKIP', reason: '实现者尚未提供该测试文件' });
      console.log('SKIP  ' + t.file + '  ::  文件不存在（实现者尚未产出）');
      return;
    }
    if (INPROC) {
      const t0 = Date.now();
      try {
        require(filePath);
        results.push({ key: label, file: t.file, status: 'PASS', mode: 'inproc', ms: Date.now() - t0 });
        console.log('PASS  ' + t.file + '  （in-process require 完成；结果以被测文件自身输出为准）');
      } catch (e) {
        results.push({ key: label, file: t.file, status: 'FAIL', mode: 'inproc', ms: Date.now() - t0, reason: String((e && e.message) || e) });
        console.log('FAIL  ' + t.file + '  ::  ' + ((e && e.message) || e));
      }
      return;
    }
    const t0 = Date.now();
    const cp = spawnSync(process.execPath, [filePath], {
      cwd: DIR,
      encoding: 'utf8',
      timeout: 180000,
      env: Object.assign({}, process.env, { AI_UNIT_ALL_CHILD: '1' })
    });
    const ms = Date.now() - t0;
    const stdout = (cp.stdout || '') + (cp.stderr || '');
    const sum = parseSummary(stdout);
    const timedOut = cp.error && cp.error.code === 'ETIMEDOUT';
    let status, reason = '';
    if (timedOut) { status = 'FAIL'; reason = '子进程超时（180s）'; }
    else if (cp.status === 0 && (!sum || sum.fail === 0)) { status = 'PASS'; }
    else { status = 'FAIL'; reason = sum ? (sum.fail + ' 项失败') : ('exit code ' + cp.status); }
    results.push({
      key: label, file: t.file, status: status, mode: 'child', ms: ms,
      exitCode: cp.status, summary: sum || null, reason: reason,
      outputTail: tail(stdout, VERBOSE ? 80 : 12)
    });
    if (status === 'PASS') {
      console.log('PASS  ' + t.file + '  (' + (sum ? sum.pass + ' 项' : 'exit 0') + ', ' + ms + 'ms)');
    } else {
      console.log('FAIL  ' + t.file + '  ::  ' + reason + '  (' + ms + 'ms)');
      console.log('      ---- 输出尾部 ----');
      console.log(tail(stdout, VERBOSE ? 80 : 12).split('\n').map(function (l) { return '      ' + l; }).join('\n'));
    }
  });

  const pass = results.filter(function (r) { return r.status === 'PASS'; }).length;
  const fail = results.filter(function (r) { return r.status === 'FAIL'; }).length;
  const skip = results.filter(function (r) { return r.status === 'SKIP'; }).length;
  console.log('\n== 汇总 ==');
  console.log('PASS ' + pass + ' / FAIL ' + fail + ' / SKIP ' + skip + '（共 ' + results.length + ' 个技能测试文件）');
  if (skip) console.log('SKIP: ' + results.filter(function (r) { return r.status === 'SKIP'; }).map(function (r) { return r.file; }).join(', '));
  if (fail) console.log('FAIL: ' + results.filter(function (r) { return r.status === 'FAIL'; }).map(function (r) { return r.file; }).join(', '));
  console.log('结论: ' + (fail ? 'FAIL' : (skip ? 'PENDING（部分单测文件未产出）' : 'PASS')));

  const out = {
    at: new Date().toISOString(),
    dir: DIR,
    mode: INPROC ? 'inproc' : 'child',
    results: results,
    summary: { pass: pass, fail: fail, skip: skip, total: results.length, ok: fail === 0 }
  };
  try {
    fs.mkdirSync(QA_DIR, { recursive: true });
    fs.writeFileSync(RESULT_FILE, JSON.stringify(out, null, 2));
    console.log('结果文件: ' + RESULT_FILE);
  } catch (e) { console.log('（结果文件写入失败: ' + e.message + '）'); }
  process.exitCode = fail ? 1 : 0;
}

try { main(); } catch (e) {
  console.error('ai_unit_all 自身异常:', e && (e.stack || e));
  process.exitCode = 2;
}
