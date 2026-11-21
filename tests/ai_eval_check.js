/* ai_eval_check.js —— 微信 AI 评测用例校验（CONTRACT §8.5）
 *
 * 运行：node ai_eval_check.js            # 开发期：用 CONTRACT 接口清单校验（缺技能不阻断）
 *       node ai_eval_check.js --strict   # 验收期：entities.source 必须真实存在于 mcp.json 注册表
 * 校验：
 *   1) JSON 可解析、cases ≥30、id 唯一、intent 非空；
 *   2) 标签合法；标签覆盖要求：unregistered（private_data/product_service）、relative-time/absolute-time、
 *      negative 8–10 条（business-state + input-quality）；
 *   3) 覆盖率 ≥85% 原子接口（source + tools 去重，分母 = CONTRACT §5 的 60 个接口）；
 *   4) 复杂用例（多条件/多步骤）≥30%，complex 标签必须有依据（tools≥2 / conditions≥2 / multi-step）；
 *   5) entities.source / tools 必须是 mcp 工具名；unregistered 用例不得指向具体工具。
 * 结果文件：tests/_reports/ai_eval_check_result.json
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = (function () {
  const cands = [path.resolve(__dirname, '..'), path.resolve(process.cwd(), 'mp-class-tools')];
  for (let i = 0; i < cands.length; i++) { try { if (fs.statSync(cands[i]).isDirectory()) return cands[i]; } catch (e) {} }
  return cands[0];
})();
const CASES_FILE = path.join(__dirname, 'ai_eval_cases.json');
const RESULT_FILE = path.resolve(__dirname, '_reports', 'ai_eval_check_result.json');
const STRICT = process.argv.slice(2).indexOf('--strict') >= 0;

// CONTRACT §5 全部 60 个原子接口（分母 / 开发期合法工具名）
const CONTRACT_APIS = {
  identity: ['getMyProfile', 'verifyClassIdentity', 'listClassMembers', 'getCommittee', 'getMyOverview', 'getToolsDirectory', 'getUsageGuide', 'getWorkspaceOverview'],
  homework: ['listHomework', 'getHomeworkDetail', 'getHomeworkSummary', 'setHomeworkDone', 'publishHomework', 'deleteHomework'],
  notice: ['getNoticeBriefing', 'listNotices', 'getNoticeDetail', 'setNoticeDone', 'setNoticePinned'],
  timetable: ['getWeekInfo', 'getTimetable', 'getTodayCourses', 'getNextCourse', 'getCourseDetail', 'setTermStart'],
  roll: ['getRollRoster', 'setRollRoster', 'markRollStatus', 'markAllRoll', 'resetRoll', 'getRollSummary', 'useDrawRoster'],
  lottery: ['getDrawConfig', 'runDraw', 'refillDraw', 'removeDrawResult', 'getDrawResult', 'resetDraw', 'runGroup', 'getGroupResult', 'resetGroup', 'getResultSummary'],
  fitness: ['calculateFitness', 'getFitnessStandards', 'listFitnessRecords', 'getFitnessRecord', 'saveFitnessRecord', 'renameFitnessRecord', 'deleteFitnessRecord'],
  account: ['getSyncStatus', 'syncNow', 'setCloudSync', 'getDataOverview', 'exportMyData', 'clearCloudData', 'clearLocalData', 'submitFeedback', 'listMyFeedback', 'markFeedbackDone', 'getVisitStats']
};
const ALL_APIS = [].concat.apply([], Object.keys(CONTRACT_APIS).map(function (k) { return CONTRACT_APIS[k]; }));
const DESTRUCTIVE = ['publishHomework', 'deleteHomework', 'refillDraw', 'removeDrawResult', 'resetDraw', 'resetGroup', 'deleteFitnessRecord', 'clearCloudData', 'clearLocalData', 'markAllRoll'];

const ALLOWED_TAGS = [
  'identity', 'homework', 'notice', 'timetable', 'roll', 'lottery', 'fitness', 'account',
  'product_service', 'private_data', 'unregistered',
  'relative-time', 'absolute-time',
  'negative', 'business-state', 'input-quality',
  'complex', 'multi-step', 'cross-skill', 'confirm'
];
const SKILL_TAGS = ['identity', 'homework', 'notice', 'timetable', 'roll', 'lottery', 'fitness', 'account'];

const R = { pass: [], fail: [], warn: [] };
function ok(name, detail) { R.pass.push({ name: name, detail: detail || '' }); console.log('PASS  ' + name + (detail ? '  —  ' + detail : '')); }
function bad(name, detail) { R.fail.push({ name: name, detail: detail || '' }); console.log('FAIL  ' + name + '  —  ' + (detail || '')); }
function warn(name, detail) { R.warn.push({ name: name, detail: detail || '' }); console.log('WARN  ' + name + '  —  ' + (detail || '')); }

function readJson(p) { try { return { value: JSON.parse(fs.readFileSync(p, 'utf8')) }; } catch (e) { return { error: String(e && e.message) }; } }

// 真实注册表（各部分 skill 完成为止可缺）：ai/skills/*/mcp.json 的 apis[].name
function actualApis() {
  const out = {};
  const base = path.join(ROOT, 'ai', 'skills');
  let dirs = [];
  try { dirs = fs.readdirSync(base, { withFileTypes: true }).filter(function (d) { return d.isDirectory(); }).map(function (d) { return d.name; }); } catch (e) { return out; }
  dirs.forEach(function (d) {
    const r = readJson(path.join(base, d, 'mcp.json'));
    const arr = r.value && (r.value.apis || r.value.tools || r.value.functions);
    (Array.isArray(arr) ? arr : []).forEach(function (a) { if (a && typeof a.name === 'string') out[a.name] = d; });
  });
  return out;
}

function main() {
  console.log('== 微信 AI · 评测用例校验（' + (STRICT ? 'strict' : 'dev') + '）==');
  console.log('项目: ' + ROOT);
  console.log('用例: ' + CASES_FILE + '\n');

  const parsed = readJson(CASES_FILE);
  if (parsed.error) { bad('ai_eval_cases.json 可解析', parsed.error); return finish(); }
  const doc = parsed.value || {};
  const cases = doc.cases;
  if (!Array.isArray(cases)) { bad('cases 是数组'); return finish(); }
  ok('ai_eval_cases.json 可解析', cases.length + ' 条用例');

  const actual = actualApis();
  const actualList = Object.keys(actual);
  const known = {};   // 合法工具名（strict 用 actual；dev 用 CONTRACT ∪ actual）
  ALL_APIS.forEach(function (n) { if (!STRICT || actual[n]) known[n] = 1; });
  if (!STRICT) Object.keys(actual).forEach(function (n) { known[n] = 1; });
  const contractSet = {};
  ALL_APIS.forEach(function (n) { contractSet[n] = 1; });

  // ---- 基础数量 ----
  if (cases.length < 30) bad('用例数量 ≥30', '实际 ' + cases.length);
  else ok('用例数量 ≥30', cases.length + ' 条');

  const ids = {};
  const tagCount = {};
  const intents = {};
  const problems = [];
  const referenced = {};
  let complexN = 0, unregisteredN = 0, negativeN = 0;
  const sub = { 'business-state': 0, 'input-quality': 0, 'private_data': 0, 'product_service': 0, 'relative-time': 0, 'absolute-time': 0 };

  cases.forEach(function (c, i) {
    const label = '[' + i + ']' + (c && c.id ? ' ' + c.id : '');
    if (!c || typeof c !== 'object') { problems.push(label + ' 不是对象'); return; }
    if (!c.id || typeof c.id !== 'string') problems.push(label + ' 缺 id');
    else if (ids[c.id]) problems.push(label + ' id 重复: ' + c.id);
    ids[c.id] = 1;
    if (typeof c.intent !== 'string' || c.intent.trim().length < 2) problems.push(label + ' intent 为空/过短');
    else if (intents[c.intent.trim()]) warn('用例 intent 重复', c.id + ' = ' + intents[c.intent.trim()]);
    else intents[c.intent.trim()] = c.id;
    const tags = Array.isArray(c.tags) ? c.tags : [];
    if (!tags.length) problems.push(label + ' tags 为空');
    tags.forEach(function (t) {
      tagCount[t] = (tagCount[t] || 0) + 1;
      if (ALLOWED_TAGS.indexOf(t) < 0) problems.push(label + ' 未知 tag: ' + t);
    });
    if (tags.indexOf('complex') >= 0) complexN += 1;
    if (tags.indexOf('unregistered') >= 0) unregisteredN += 1;
    if (tags.indexOf('negative') >= 0) negativeN += 1;
    ['business-state', 'input-quality', 'private_data', 'product_service', 'relative-time', 'absolute-time'].forEach(function (t) {
      if (tags.indexOf(t) >= 0) sub[t] += 1;
    });

    // 普通用例应带技能 tag（unregistered / 纯输入质量负例可无）
    const hasSkillTag = tags.some(function (t) { return SKILL_TAGS.indexOf(t) >= 0; });
    if (!hasSkillTag && tags.indexOf('unregistered') < 0 && tags.indexOf('input-quality') < 0) {
      warn('用例缺技能 tag', label + ' tags=' + JSON.stringify(tags));
    }

    const ent = c.entities || {};
    const src = ent.source;
    const tools = Array.isArray(ent.tools) ? ent.tools : [];
    const unregistered = tags.indexOf('unregistered') >= 0;
    if (src !== undefined && src !== null && src !== '') {
      if (unregistered) problems.push(label + ' unregistered 用例不应有 entities.source=' + src);
      if (typeof src !== 'string') problems.push(label + ' entities.source 必须是字符串');
      else if (!known[src]) problems.push(label + ' entities.source 不是 mcp 工具名: ' + src);
      else referenced[src] = 1;
    }
    tools.forEach(function (t) { if (typeof t !== 'string' || !known[t]) problems.push(label + ' entities.tools 含非 mcp 工具名: ' + t); else referenced[t] = 1; });
    if (unregistered && tools.length) problems.push(label + ' unregistered 用例不应有 entities.tools');
    if (ent.conditions !== undefined && !(typeof ent.conditions === 'number' && ent.conditions >= 2)) problems.push(label + ' entities.conditions 应为 ≥2 的数字');

    // 复杂依据
    const complexJustified = tools.length >= 2 || (typeof ent.conditions === 'number' && ent.conditions >= 2) || tags.indexOf('multi-step') >= 0 || tags.indexOf('cross-skill') >= 0;
    if (tags.indexOf('complex') >= 0 && !complexJustified) problems.push(label + ' complex 标签缺依据（tools≥2 / conditions≥2 / multi-step）');
    if (tags.indexOf('complex') < 0 && (tools.length >= 2 || (typeof ent.conditions === 'number' && ent.conditions >= 2))) {
      warn('用例是多条件/多步骤但没标 complex', label);
    }
    // 破坏性接口应有 confirm 标签
    const srcs = (src ? [src] : []).concat(tools);
    srcs.forEach(function (s) {
      if (DESTRUCTIVE.indexOf(s) >= 0 && tags.indexOf('confirm') < 0) warn('破坏性接口缺 confirm 标签', label + ' → ' + s);
    });
    // 负例子类
    if (tags.indexOf('negative') >= 0 && tags.indexOf('business-state') < 0 && tags.indexOf('input-quality') < 0) {
      problems.push(label + ' negative 用例必须标注 business-state 或 input-quality');
    }
    // unregistered 必须带 private_data / product_service
    if (unregistered && tags.indexOf('private_data') < 0 && tags.indexOf('product_service') < 0) {
      problems.push(label + ' unregistered 用例必须带 private_data 或 product_service');
    }
  });
  if (problems.length) bad('用例结构与标签规则', problems.slice(0, 12).join('；') + (problems.length > 12 ? ' …共 ' + problems.length + ' 项' : ''));
  else ok('用例结构与标签规则（' + cases.length + ' 条逐项）');

  // ---- 标签覆盖 ----
  if (negativeN < 8 || negativeN > 10) bad('negative 用例 8–10 条', '实际 ' + negativeN);
  else ok('negative 用例 8–10 条', negativeN + ' 条');
  if (sub['business-state'] < 1 || sub['input-quality'] < 1) bad('negative 覆盖业务状态 + 输入质量', 'business-state=' + sub['business-state'] + ', input-quality=' + sub['input-quality']);
  else ok('negative 覆盖业务状态 + 输入质量', 'business-state=' + sub['business-state'] + ', input-quality=' + sub['input-quality']);
  if (unregisteredN < 2) bad('unregistered 用例 ≥2', '实际 ' + unregisteredN);
  else ok('unregistered 用例 ≥2', unregisteredN + ' 条');
  if (sub['private_data'] < 1) bad('覆盖 private_data', '实际 0');
  else ok('覆盖 private_data', sub['private_data'] + ' 条');
  if (sub['product_service'] < 1) bad('覆盖 product_service', '实际 0');
  else ok('覆盖 product_service', sub['product_service'] + ' 条');
  if (sub['relative-time'] < 5) warn('relative-time 用例偏少（建议 ≥5）', '实际 ' + sub['relative-time']);
  else ok('覆盖 relative-time', sub['relative-time'] + ' 条');
  if (sub['absolute-time'] < 5) warn('absolute-time 用例偏少（建议 ≥5）', '实际 ' + sub['absolute-time']);
  else ok('覆盖 absolute-time', sub['absolute-time'] + ' 条');
  if (tagCount['confirm'] < 5) warn('confirm 用例偏少（建议 ≥5）', '实际 ' + (tagCount['confirm'] || 0));

  // ---- 复杂用例占比 ----
  const ratio = cases.length ? complexN / cases.length : 0;
  const ratioText = (ratio * 100).toFixed(1) + '%（' + complexN + '/' + cases.length + '）';
  if (ratio < 0.3) bad('复杂用例占比 ≥30%', ratioText);
  else ok('复杂用例占比 ≥30%', ratioText);

  // ---- 覆盖率 ----
  const covered = Object.keys(referenced).filter(function (n) { return contractSet[n]; });
  const covRatio = covered.length / ALL_APIS.length;
  const uncovered = ALL_APIS.filter(function (n) { return !referenced[n]; });
  const covText = (covRatio * 100).toFixed(1) + '%（' + covered.length + '/' + ALL_APIS.length + '）';
  if (covRatio < 0.85) bad('原子接口覆盖率 ≥85%', covText + '；未覆盖: ' + uncovered.join(', '));
  else ok('原子接口覆盖率 ≥85%', covText + (uncovered.length ? '；未覆盖: ' + uncovered.join(', ') : '；全覆盖'));
  // 分技能覆盖
  const perSkill = Object.keys(CONTRACT_APIS).map(function (k) {
    const list = CONTRACT_APIS[k];
    const hit = list.filter(function (n) { return referenced[n]; }).length;
    return k + ' ' + hit + '/' + list.length;
  });
  ok('分技能覆盖', perSkill.join(' · '));

  // ---- strict：引用的工具必须真实在 mcp.json ----
  if (STRICT) {
    const missingActual = Object.keys(referenced).filter(function (n) { return !actual[n]; });
    if (missingActual.length) bad('[strict] 用例引用的工具尚未在 mcp.json 注册', missingActual.join(', '));
    else ok('[strict] 用例引用的工具全部在 mcp.json 注册', Object.keys(referenced).length + ' 个');
  } else if (actualList.length) {
    const missingActual = Object.keys(referenced).filter(function (n) { return !actual[n]; });
    if (missingActual.length) warn('部分用例工具名尚未出现在 mcp.json（技能未完成时正常）', missingActual.join(', '));
    else ok('用例工具名与 mcp.json 注册表一致', actualList.length + ' 个已注册');
  }

  // ---- 输出补充文件（可选：给评测平台的扁平数组） ----
  const out = {
    at: new Date().toISOString(),
    casesFile: CASES_FILE,
    mode: STRICT ? 'strict' : 'dev',
    summary: {
      cases: cases.length,
      complex: complexN, complexRatio: Number(ratio.toFixed(4)),
      unregistered: unregisteredN, negative: negativeN,
      tags: tagCount,
      coverage: Number(covRatio.toFixed(4)), covered: covered.length, totalApis: ALL_APIS.length,
      uncovered: uncovered,
      perSkill: perSkill,
      ok: R.fail.length === 0
    },
    pass: R.pass, fail: R.fail, warn: R.warn
  };
  try {
    fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
    fs.writeFileSync(RESULT_FILE, JSON.stringify(out, null, 2));
    console.log('\n结果文件: ' + RESULT_FILE);
  } catch (e) { console.log('（结果文件写入失败: ' + e.message + '）'); }
  return finish();
}

function finish() {
  console.log('\n== 汇总 ==');
  console.log('PASS ' + R.pass.length + ' / FAIL ' + R.fail.length + ' / WARN ' + R.warn.length);
  if (R.fail.length) {
    console.log('FAIL 清单:');
    R.fail.forEach(function (f, i) { console.log('  ' + (i + 1) + ') ' + f.name + '  —  ' + f.detail); });
  }
  if (R.warn.length) {
    console.log('WARN 清单:');
    R.warn.forEach(function (f, i) { console.log('  ' + (i + 1) + ') ' + f.name + '  —  ' + f.detail); });
  }
  console.log('结论: ' + (R.fail.length ? 'FAIL' : 'PASS'));
  process.exitCode = R.fail.length ? 1 : 0;
}

try { main(); } catch (e) {
  console.error('ai_eval_check 自身异常:', e && (e.stack || e));
  process.exitCode = 2;
}
