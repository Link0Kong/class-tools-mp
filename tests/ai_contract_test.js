/* ai_contract_test.js —— 微信 AI 开发模式适配 · 静态契约校验（CONTRACT §8.1）
 *
 * 运行：node ai_contract_test.js            # 开发期：缺失技能记 PENDING（不阻断）
 *       node ai_contract_test.js --final    # 验收期：缺失技能/配置一律 FAIL（严格）
 *       node ai_contract_test.js --json     # 只输出 JSON（供脚本用）
 * 退出码：有 FAIL → 1；否则 0（PENDING 不失败，但会在汇总里列出）。
 * 结果文件：_ai_task/qa/ai_contract_result.json
 *
 * 校验范围（CONTRACT §2/§5/§6/§7/§8.1）：
 *   app.json（subPackages independent / agent.skills / lazyCodeLoading / 18 页）
 *   8 个 skill：SKILL.md≤16000B、mcp.json≤24000B（去 outputSchema 与空白）、index.js、
 *     apis/*.js 与 mcp apis 一一对应、runtime mock 注册覆盖、组件四件套、
 *     _meta.ui.pagePath/componentPath、relatedPage 在 page-meta 中、outputSchema page-link 规则、
 *     破坏性接口 confirmed 参数、组件 JS 必做调用（getContext/getViewContext/setRelatedPage）
 *   agent/AGENTS.md≤10000B、agent/page-meta.json≤8000B + 18 页覆盖
 *   ai/common 共享层存在性、禁用 API 扫描（含主包 require 越界）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HARNESS = tryRequire('./_ai_harness.js');
const ROOT = (HARNESS && HARNESS.PROJECT) || path.resolve(__dirname, '..', 'mp-class-tools');
const AI = path.join(ROOT, 'ai');
const ARGS = process.argv.slice(2);
const FINAL = ARGS.indexOf('--final') >= 0;
const JSON_ONLY = ARGS.indexOf('--json') >= 0;
const RESULT_FILE = path.resolve(__dirname, '..', '_ai_task', 'qa', 'ai_contract_result.json');

// CONTRACT §2 期望的 8 个技能（name / path / 一句话职责）
const EXPECT_SKILLS = [
  { name: 'classIdentity', path: 'ai/skills/identity' },
  { name: 'homework', path: 'ai/skills/homework' },
  { name: 'notice', path: 'ai/skills/notice' },
  { name: 'timetable', path: 'ai/skills/timetable' },
  { name: 'lottery', path: 'ai/skills/lottery' },
  { name: 'fitness', path: 'ai/skills/fitness' },
  { name: 'rollCall', path: 'ai/skills/roll' },
  { name: 'myAccount', path: 'ai/skills/account' }
];
// 破坏性写操作（CONTRACT §4）：入参必须有 confirmed
const DESTRUCTIVE_API = ['publishHomework', 'deleteHomework', 'refillDraw', 'removeDrawResult', 'resetDraw', 'resetGroup', 'deleteFitnessRecord', 'clearCloudData', 'clearLocalData', 'markAllRoll'];
// 覆盖已有结果/可选确认（confirmed 应在 schema 中出现）
const CONFIRM_OPTIONAL_API = ['runDraw', 'runGroup', 'saveFitnessRecord', 'markFeedbackDone'];
// 禁用 API（原子接口运行环境，CONTRACT §0）
const FORBIDDEN_PATTERNS = [
  [/\bwx\.showToast\s*\(/, 'wx.showToast'],
  [/\bwx\.showModal\s*\(/, 'wx.showModal'],
  [/\bwx\.showActionSheet\s*\(/, 'wx.showActionSheet'],
  [/\bwx\.showLoading\s*\(/, 'wx.showLoading'],
  [/\bwx\.hideLoading\s*\(/, 'wx.hideLoading'],
  [/\bwx\.navigateTo\s*\(/, 'wx.navigateTo'],
  [/\bwx\.redirectTo\s*\(/, 'wx.redirectTo'],
  [/\bwx\.reLaunch\s*\(/, 'wx.reLaunch'],
  [/\bwx\.switchTab\s*\(/, 'wx.switchTab'],
  [/\bwx\.navigateBack\s*\(/, 'wx.navigateBack'],
  [/\bwx\.getSystemInfoSync\s*\(/, 'wx.getSystemInfoSync'],
  [/\bwx\.getSystemInfo\s*\(/, 'wx.getSystemInfo'],
  [/\bwx\.getFileSystemManager\s*\(/, 'wx.getFileSystemManager'],
  [/\bwx\.createSelectorQuery\s*\(/, 'wx.createSelectorQuery'],
  [/\bwx\.setClipboardData\s*\(/, 'wx.setClipboardData'],
  [/\bgetApp\s*\(/, 'getApp()'],
  [/\bgetCurrentPages\s*\(/, 'getCurrentPages()']
];

/* ---------------- 结果收集 ---------------- */
const R = { pass: [], fail: [], pending: [], warn: [] };
function ok(name, detail) { R.pass.push({ name: name, detail: detail || '' }); if (!JSON_ONLY) console.log('PASS     ' + name + (detail ? '  —  ' + detail : '')); }
function bad(name, detail) { R.fail.push({ name: name, detail: detail || '' }); if (!JSON_ONLY) console.log('FAIL     ' + name + '  —  ' + (detail || '')); }
function pend(name, detail) { R.pending.push({ name: name, detail: detail || '' }); if (!JSON_ONLY) console.log('PENDING  ' + name + (detail ? '  —  ' + detail : '')); }
function warn(name, detail) { R.warn.push({ name: name, detail: detail || '' }); if (!JSON_ONLY) console.log('WARN     ' + name + '  —  ' + (detail || '')); }
function section(title) { if (!JSON_ONLY) console.log('\n---- ' + title + ' ----'); }

/* ---------------- 工具 ---------------- */
function tryRequire(p) { try { return require(p); } catch (e) { return null; } }
function exists(p) { try { fs.statSync(p); return true; } catch (e) { return false; } }
function isFile(p) { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }
function sizeOf(p) { try { return fs.statSync(p).size; } catch (e) { return -1; } }
function byteLen(s) { return Buffer.byteLength(String(s), 'utf8'); }
function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } }
function readJson(p) {
  const t = readText(p);
  if (t === null) return { error: '文件不存在: ' + p };
  try { return { value: JSON.parse(t) }; } catch (e) { return { error: 'JSON 解析失败: ' + e.message }; }
}
function listDirs(p) { try { return fs.readdirSync(p, { withFileTypes: true }).filter(function (d) { return d.isDirectory(); }).map(function (d) { return d.name; }); } catch (e) { return []; } }
function listFiles(p) { try { return fs.readdirSync(p); } catch (e) { return []; } }
function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/'); }
function normPage(p) {
  let s = String(p || '').trim().split('?')[0].split('#')[0];
  if (!s) return '';
  if (s.charAt(0) !== '/') s = '/' + s;
  return s;
}
// 去掉 JS 注释（保守：块注释 + 行注释），避免注释里提到禁用 API 造成误报
function stripJsComments(code) {
  return String(code || '')
    .replace(/\/\*[\s\S]*?\*\//g, function (m) { return m.replace(/[^\n]/g, ' '); })
    .replace(/(^|[^:\\])\/\/[^\n]*/g, function (m, p1) { return p1; });
}
function walkJs(dir, out) {
  out = out || [];
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  ents.forEach(function (d) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) {
      if (d.name === 'node_modules' || d.name.charAt(0) === '.') return;
      walkJs(p, out);
    } else if (/\.js$/.test(d.name)) out.push(p);
  });
  return out;
}
function getPAGES() {
  const h = tryRequire(path.join(AI, 'common', 'handoff.js'));
  return h && h.PAGES ? h.PAGES : null;
}
function collectComponentPaths(mcp, skillDir) {
  // 返回 [{componentPath, relatedPage, source}]（兼容 _meta.ui、apis[].components、顶层 components）
  const out = [];
  function pushComp(cp, relatedPage, source) {
    if (!cp) return;
    out.push({ componentPath: String(cp), relatedPage: relatedPage || '', source: source });
  }
  function lookApis(list) {
    (Array.isArray(list) ? list : []).forEach(function (api) {
      if (!api || typeof api !== 'object') return;
      const ui = (api._meta && api._meta.ui) || api.ui || {};
      const cp = ui.componentPath || ui.component || api.componentPath;
      const rp = ui.relatedPage || api.relatedPage || '';
      if (cp) pushComp(cp, rp, 'api:' + (api.name || '?'));
      (Array.isArray(api.components) ? api.components : []).forEach(function (c) {
        if (typeof c === 'string') pushComp(c, rp, 'api:' + (api.name || '?') + '.components');
        else if (c && (c.path || c.componentPath)) pushComp(c.path || c.componentPath, c.relatedPage || rp, 'api:' + (api.name || '?') + '.components');
      });
    });
  }
  lookApis(mcp.apis);
  lookApis(mcp.tools);
  lookApis(mcp.functions);
  const comps = mcp.components;
  if (Array.isArray(comps)) {
    comps.forEach(function (c) {
      if (typeof c === 'string') pushComp(c, '', 'components[]');
      else if (c && (c.path || c.componentPath)) pushComp(c.path || c.componentPath, c.relatedPage || '', 'components[]');
    });
  } else if (comps && typeof comps === 'object') {
    Object.keys(comps).forEach(function (k) {
      const c = comps[k];
      if (typeof c === 'string') pushComp(c, '', 'components.' + k);
      else if (c && (c.path || c.componentPath)) pushComp(c.path || c.componentPath, c.relatedPage || '', 'components.' + k);
      else pushComp(k, '', 'components.' + k);
    });
  }
  // 去重（同 path 保留首个）
  const seen = {};
  return out.filter(function (c) { const k = c.componentPath; if (seen[k]) return false; seen[k] = 1; return true; });
}
function resolveComponentDir(skillDir, cp) {
  const raw = String(cp || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const cands = [path.resolve(skillDir, raw)];
  if (raw.indexOf('ai/skills/') === 0) cands.push(path.resolve(ROOT, raw));
  cands.push(path.resolve(ROOT, raw));
  for (let i = 0; i < cands.length; i++) if (isDir(cands[i])) return cands[i];
  return cands[0];
}
function findPageMetaEntries(json) {
  if (!json) return null;
  if (Array.isArray(json)) return json;
  const arrKeys = ['pages', 'list', 'items', 'pageMetadata', 'metadata'];
  for (let i = 0; i < arrKeys.length; i++) if (Array.isArray(json[arrKeys[i]])) return json[arrKeys[i]];
  // 对象映射形式：{ '/pages/index/index': {...} }
  const keys = Object.keys(json).filter(function (k) { return k.charAt(0) === '/'; });
  if (keys.length) return keys.map(function (k) { return Object.assign({ path: k }, (json[k] && typeof json[k] === 'object') ? json[k] : {}); });
  return null;
}
function stripOutputSchema(v) {
  if (Array.isArray(v)) return v.map(stripOutputSchema);
  if (v && typeof v === 'object') {
    const out = {};
    Object.keys(v).forEach(function (k) {
      if (k === 'outputSchema') return;
      out[k] = stripOutputSchema(v[k]);
    });
    return out;
  }
  return v;
}
function walkSchema(node, fn, parent) {
  if (!node || typeof node !== 'object') return;
  fn(node, parent);
  if (Array.isArray(node)) { node.forEach(function (x) { walkSchema(x, fn, node); }); return; }
  Object.keys(node).forEach(function (k) { if (node[k] && typeof node[k] === 'object') walkSchema(node[k], fn, node); });
}

/* ================================================================ 主流程 */

function main() {
  if (!JSON_ONLY) {
    console.log('== 微信 AI 开发模式 · 静态契约校验 ==');
    console.log('项目: ' + ROOT);
    console.log('模式: ' + (FINAL ? '验收（--final，缺失即 FAIL）' : '开发（缺失技能记 PENDING）'));
    console.log('时间: ' + new Date().toISOString());
  }

  const appRes = readJson(path.join(ROOT, 'app.json'));
  const app = appRes.value || {};
  const appHasAgent = !!(app.agent && Array.isArray(app.agent.skills));
  const PAGES = getPAGES();

  /* ---------------- 一、前提交付物 ---------------- */
  section('一、app.json / 分包 / 入口');
  if (appRes.error) { bad('app.json 可解析', appRes.error); return finish(); }
  ok('app.json 可解析');

  if (!exists(AI)) { pend('ai/ 独立分包目录存在', '尚未创建: ' + AI); }
  else ok('ai/ 独立分包目录存在');

  const subPackages = app.subPackages || app.subpackages || [];
  const aiSub = (Array.isArray(subPackages) ? subPackages : []).filter(function (s) { return s && String(s.root || '').replace(/\/+$/, '') === 'ai'; })[0];
  if (!appHasAgent && !aiSub) {
    pend('app.json subPackages 含 ai 独立分包', 'Lead 统一追加（root=ai, independent=true, pages=[]）');
    pend('app.json lazyCodeLoading', 'Lead 统一追加 lazyCodeLoading=requiredComponents');
  } else {
    if (!aiSub) bad('app.json subPackages 含 ai 分包');
    else if (aiSub.independent !== true) bad('ai 分包必须 independent:true', JSON.stringify(aiSub));
    else if (!Array.isArray(aiSub.pages)) bad('ai 分包 pages 必须是数组（本项目应为 []）');
    else ok('app.json subPackages: ai independent:' + aiSub.independent + ' pages:[]');
    if (app.lazyCodeLoading === 'requiredComponents') ok('app.json lazyCodeLoading=requiredComponents');
    else bad('app.json lazyCodeLoading 必须为 "requiredComponents"', '实际: ' + JSON.stringify(app.lazyCodeLoading));
  }

  // 主包 18 页
  const appPages = (Array.isArray(app.pages) ? app.pages : []).map(normPage);
  if (PAGES) {
    const want = Object.keys(PAGES).map(function (k) { return normPage(PAGES[k]); });
    const missing = want.filter(function (p) { return appPages.indexOf(p) < 0; });
    if (missing.length) bad('app.json pages 覆盖 handoff.PAGES 18 页', '缺少: ' + missing.join(', '));
    else ok('app.json pages 覆盖 handoff.PAGES 18 页');
  } else bad('读取 ai/common/handoff.js 的 PAGES', '无法 require，检查 ai/common/handoff.js');

  // agent 配置 / 技能清单
  section('二、agent 配置');
  if (!appHasAgent) {
    pend('app.json agent.skills 已配置', 'Lead 统一追加（8 技能）');
    pend('agent/AGENTS.md（instruction ≤10000B）', '页面接力会话（pm-pages-meta）产出');
    pend('agent/page-meta.json（pageMetadata ≤8000B，18 页）', '页面接力会话（pm-pages-meta）产出');
  } else {
    const ai = app.agent;
    if (typeof ai.instruction === 'string' && ai.instruction) ok('agent.instruction 已声明: ' + ai.instruction);
    else bad('agent.instruction 缺失');
    if (typeof ai.pageMetadata === 'string' && ai.pageMetadata) ok('agent.pageMetadata 已声明: ' + ai.pageMetadata);
    else bad('agent.pageMetadata 缺失');
    if (ai.skills.length > 30) bad('agent.skills 数量 ≤30', '实际 ' + ai.skills.length);
    else ok('agent.skills 数量 = ' + ai.skills.length + '（≤30）');
    const declared = {};
    let skillBasicOk = true;
    ai.skills.forEach(function (s, i) {
      if (!s || typeof s !== 'object') { bad('agent.skills[' + i + '] 结构', '应为 {name,description,path}'); skillBasicOk = false; return; }
      const miss = ['name', 'description', 'path'].filter(function (k) { return typeof s[k] !== 'string' || !s[k]; });
      if (miss.length) { bad('agent.skills[' + (s.name || i) + '] 字段', '缺/空: ' + miss.join(',')); skillBasicOk = false; }
      if (s.name && declared[s.name]) { bad('agent.skills 名称唯一', '重复: ' + s.name); skillBasicOk = false; }
      declared[s.name] = s;
      const dir = path.resolve(ROOT, String(s.path || ''));
      if (!isDir(dir)) { bad('agent.skills[' + (s.name || i) + '].path 目录存在', s.path + ' → ' + dir); skillBasicOk = false; }
    });
    if (skillBasicOk) ok('agent.skills 结构/名称唯一/路径存在');
    const expNames = EXPECT_SKILLS.map(function (s) { return s.name; });
    const missExp = expNames.filter(function (n) { return !declared[n]; });
    const extra = Object.keys(declared).filter(function (n) { return expNames.indexOf(n) < 0; });
    if (missExp.length) bad('agent.skills 覆盖 CONTRACT §2 的 8 技能', '缺少: ' + missExp.join(', '));
    else ok('agent.skills 覆盖 CONTRACT §2 的 8 技能');
    if (extra.length) warn('agent.skills 含契约外技能', extra.join(', '));
    // 期望 path 对齐
    const pathMap = {};
    EXPECT_SKILLS.forEach(function (s) { pathMap[s.name] = s.path; });
    Object.keys(declared).forEach(function (n) {
      if (pathMap[n] && declared[n].path && declared[n].path.replace(/\/+$/, '') !== pathMap[n]) {
        bad('agent.skills[' + n + '].path 与契约一致', '期望 ' + pathMap[n] + '，实际 ' + declared[n].path);
      }
    });
  }

  /* ---------------- 三、ai/common 共享层 ---------------- */
  section('三、ai/common 共享层');
  const COMMON_FILES = ['config.js', 'rest.js', 'auth.js', 'local.js', 'marks.js', 'result.js', 'fmt.js', 'handoff.js'];
  const missCommon = COMMON_FILES.filter(function (f) { return !isFile(path.join(AI, 'common', f)); });
  if (missCommon.length) bad('ai/common 8 个共享模块齐全', '缺少: ' + missCommon.join(', '));
  else ok('ai/common 8 个共享模块齐全');

  /* ---------------- 四、逐技能校验 ---------------- */
  section('四、SKILL 静态契约');
  // 技能目录：优先 app.json 声明，否则 CONTRACT 期望
  let skillDirs = [];
  if (appHasAgent) {
    app.agent.skills.forEach(function (s) {
      if (!s || !s.path) return;
      const dir = path.resolve(ROOT, s.path);
      const exp = EXPECT_SKILLS.filter(function (x) { return x.name === s.name; })[0];
      skillDirs.push({ name: s.name || path.basename(dir), dir: dir, declared: true, exp: exp });
    });
  } else {
    EXPECT_SKILLS.forEach(function (s) {
      skillDirs.push({ name: s.name, dir: path.resolve(ROOT, s.path), declared: false, exp: s });
    });
  }
  // 额外发现未声明的目录
  const knownDirs = {};
  skillDirs.forEach(function (s) { knownDirs[path.resolve(s.dir).toLowerCase()] = 1; });
  listDirs(path.join(AI, 'skills')).forEach(function (d) {
    const p = path.join(AI, 'skills', d);
    if (!knownDirs[path.resolve(p).toLowerCase()]) skillDirs.push({ name: d, dir: p, declared: false, exp: null });
  });

  const globalApiNames = {};   // api 名全局唯一
  const metaPaths = [];        // 组件声明的 relatedPage（延迟到 page-meta 读取后校验）
  const checkedSkills = [];

  skillDirs.forEach(function (sk) {
    const label = 'skill ' + sk.name;
    try {
      if (!isDir(sk.dir)) {
        if (FINAL || sk.declared) bad(label + ' 目录存在', '缺少 ' + rel(sk.dir));
        else pend(label + ' 目录存在', '未开始（' + rel(sk.dir) + '）');
        return;
      }
      checkedSkills.push(sk);
      // 1) 三件套
      const skillMd = path.join(sk.dir, 'SKILL.md');
      const mcpPath = path.join(sk.dir, 'mcp.json');
      const indexPath = path.join(sk.dir, 'index.js');
      if (!isFile(skillMd)) bad(label + ' SKILL.md 存在', rel(skillMd));
      else {
        const n = sizeOf(skillMd);
        if (n > 16000) bad(label + ' SKILL.md ≤16000B', '实际 ' + n + 'B');
        else if (byteLen(readText(skillMd)) !== n) warn(label + ' SKILL.md 字节数（非 UTF-8？）');
        else ok(label + ' SKILL.md ≤16000B', n + 'B');
      }
      if (!isFile(indexPath)) bad(label + ' index.js 存在', rel(indexPath));
      else {
        const code = stripJsComments(readText(indexPath) || '');
        if (code.indexOf('createSkill') < 0) bad(label + ' index.js 使用 wx.modelContext.createSkill');
        else ok(label + ' index.js 使用 createSkill');
        if (code.indexOf('registerAPI') < 0) bad(label + ' index.js 使用 registerAPI 注册接口');
      }
      // 2) mcp.json
      const mcpRes = readJson(mcpPath);
      if (mcpRes.error) { bad(label + ' mcp.json 存在且可解析', mcpRes.error); return; }
      const mcp = mcpRes.value;
      const stripped = JSON.stringify(stripOutputSchema(mcp));
      const mcpSize = byteLen(stripped);
      if (mcpSize > 24000) bad(label + ' mcp.json ≤24000B（去 outputSchema/空白）', '实际 ' + mcpSize + 'B');
      else ok(label + ' mcp.json ≤24000B（去 outputSchema/空白）', mcpSize + 'B');
      if (typeof mcp.name === 'string' && !mcp.name) bad(label + ' mcp.json name 不能为空');
      // 注：本项目的 mcp.json 结构 = { apis:[...], components:[...] }，技能标识在 app.json agent.skills（CONTRACT §2）
      const apis = mcp.apis || mcp.tools || mcp.functions;
      if (!Array.isArray(apis) || !apis.length) { bad(label + ' mcp.json apis[] 非空'); return; }
      const apiNames = [];
      let apiProblems = [];
      apis.forEach(function (api, i) {
        if (!api || typeof api !== 'object') { apiProblems.push('apis[' + i + '] 非对象'); return; }
        const nm = api.name;
        if (typeof nm !== 'string' || !nm) { apiProblems.push('apis[' + i + '].name 缺失'); return; }
        if (apiNames.indexOf(nm) >= 0) apiProblems.push('apis[].name 重复: ' + nm);
        apiNames.push(nm);
        if (globalApiNames[nm]) apiProblems.push('接口名跨技能重复: ' + nm + '（已出现在 ' + globalApiNames[nm] + '）');
        else globalApiNames[nm] = sk.name;
        if (typeof api.description !== 'string' || api.description.trim().length < 4) apiProblems.push(nm + ': description 缺失/过短（中文写清取值来源）');
        const schema = api.inputSchema || api.input_schema || api.parameters;
        if (!schema || typeof schema !== 'object' || Array.isArray(schema)) apiProblems.push(nm + ': 缺 inputSchema（JSON Schema object）');
        else {
          if (schema.type !== 'object') apiProblems.push(nm + ': inputSchema.type 必须是 "object"');
          if (Array.isArray(schema.required)) {
            const props = schema.properties || {};
            schema.required.forEach(function (k) { if (!(k in props)) apiProblems.push(nm + ': inputSchema.required 含未定义属性 ' + k); });
          }
        }
        // 破坏性接口 confirmed
        if (DESTRUCTIVE_API.indexOf(nm) >= 0) {
          const props = (schema && schema.properties) || {};
          if (!('confirmed' in props)) apiProblems.push(nm + ': 破坏性接口 inputSchema 必须有 confirmed 参数');
          else if (props.confirmed && props.confirmed.type && props.confirmed.type !== 'boolean') apiProblems.push(nm + ': confirmed 类型必须是 boolean');
        } else if (CONFIRM_OPTIONAL_API.indexOf(nm) >= 0) {
          const props = (schema && schema.properties) || {};
          if (!('confirmed' in props)) warn(label + ' ' + nm + ' 建议声明 confirmed 参数（覆盖已有结果需确认）');
        }
        // outputSchema
        const out = api.outputSchema;
        if (!out) warn(label + ' ' + nm + ' 未声明 outputSchema');
        else {
          let pageLinkNodes = 0;
          walkSchema(out, function (node) {
            if (!node || typeof node !== 'object' || Array.isArray(node)) return;
            if (node.format === 'page-link') {
              pageLinkNodes += 1;
              if (typeof node['x-link-text-field'] !== 'string' || !node['x-link-text-field']) {
                apiProblems.push(nm + ': outputSchema 声明 format=page-link 但缺 x-link-text-field');
              }
            }
          });
          const props = out && out.properties;
          if (props && !props.pagePath && !pageLinkNodes) warn(label + ' ' + nm + ' outputSchema 未声明 pagePath 字段');
        }
        // 页面/组件声明（_meta.ui）
        const ui = (api._meta && api._meta.ui) || api.ui || {};
        const pagePath = ui.pagePath || api.pagePath;
        const compPath = ui.componentPath || api.componentPath;
        if (!pagePath && !compPath) apiProblems.push(nm + ': 必须有 _meta.ui.pagePath 或 _meta.ui.componentPath（CONTRACT §5）');
        if (pagePath && PAGES) {
          const np = normPage(pagePath);
          const known = Object.keys(PAGES).some(function (k) { return normPage(PAGES[k]) === np; });
          if (!known) apiProblems.push(nm + ': _meta.ui.pagePath 不是 handoff.PAGES 页面: ' + pagePath);
        }
      });
      if (apiProblems.length) bad(label + ' apis[] 结构', apiProblems.slice(0, 8).join('；') + (apiProblems.length > 8 ? ' …共 ' + apiProblems.length + ' 项' : ''));
      else ok(label + ' apis[] 结构', apiNames.length + ' 个接口');
      // 3) apis/ 文件与 mcp 一一对应
      const apisDir = path.join(sk.dir, 'apis');
      if (!isDir(apisDir)) bad(label + ' apis/ 目录存在');
      else {
        const files = listFiles(apisDir).filter(function (f) { return /\.js$/.test(f); }).map(function (f) { return f.replace(/\.js$/, ''); });
        const missFile = apiNames.filter(function (nm) { return files.indexOf(nm) < 0; });
        if (missFile.length) bad(label + ' apis/<接口名>.js 与 mcp 一一对应', '缺少文件: ' + missFile.join(', ') + '（现有: ' + files.join(', ') + '）');
        else ok(label + ' apis/<接口名>.js 与 mcp 一一对应', files.length + ' 个文件');
        const extraFile = files.filter(function (f) { return apiNames.indexOf(f) < 0 && f.charAt(0) !== '_'; });
        if (extraFile.length) warn(label + ' apis/ 有未在 mcp 声明的文件', extraFile.join(', '));
      }
      // 4) 静态 + 运行时注册覆盖
      let staticNames = [];
      if (isFile(indexPath)) {
        const raw = readText(indexPath) || '';
        const re1 = /registerAPI\(\s*['"]([A-Za-z0-9_]+)['"]/g;
        let m;
        while ((m = re1.exec(raw))) staticNames.push(m[1]);
        const re2 = /registerAPI\(\s*\{[^}]*?name\s*:\s*['"]([A-Za-z0-9_]+)['"]/g;
        while ((m = re2.exec(raw))) staticNames.push(m[1]);
      }
      let runtimeNames = [];
      let runtimeErr = null;
      if (HARNESS) {
        try {
          const fx = HARNESS.mkFixture();
          const wx = HARNESS.createWx({ storage: fx.storage });
          const loaded = HARNESS.loadSkill(wx, sk.dir);
          runtimeNames = loaded.apiNames.slice();
          if (loaded.mcpError) bad(label + ' mcp.json 运行时读取', loaded.mcpError);
        } catch (e) { runtimeErr = (e && e.message) || String(e); }
      } else {
        warn(label + ' 运行时注册校验', '未找到 _ai_harness.js，跳过');
      }
      if (runtimeErr) bad(label + ' index.js 可被 Node require 并注册接口', runtimeErr.split('\n').slice(0, 6).join(' / '));
      else if (HARNESS) {
        const missRun = apiNames.filter(function (nm) { return runtimeNames.indexOf(nm) < 0; });
        const extraRun = runtimeNames.filter(function (nm) { return apiNames.indexOf(nm) < 0; });
        if (missRun.length) bad(label + ' 运行时注册覆盖 mcp apis[]', '未注册: ' + missRun.join(', ') + '（运行时: ' + runtimeNames.join(', ') + '）');
        else ok(label + ' 运行时注册覆盖 mcp apis[]', runtimeNames.length + ' 个');
        if (extraRun.length) warn(label + ' 运行时注册多于 mcp 声明', extraRun.join(', '));
        if (staticNames.length) {
          const missStatic = apiNames.filter(function (nm) { return staticNames.indexOf(nm) < 0; });
          if (missStatic.length) bad(label + ' index.js 静态 registerAPI 覆盖 mcp apis[]', '静态扫描未命中: ' + missStatic.join(', '));
          else ok(label + ' index.js 静态 registerAPI 覆盖 mcp apis[]');
        } else if (runtimeNames.length) {
          warn(label + ' index.js 静态扫描未命中 registerAPI 字面量', '可能为动态注册（运行时已覆盖 ' + runtimeNames.length + ' 个，可接受）');
        }
      }
      // 5) 组件四件套 + relatedPage
      const comps = collectComponentPaths(mcp, sk.dir);
      if (!comps.length) bad(label + ' mcp.json 声明卡片组件', 'components[] / _meta.ui.componentPath 均未声明（CONTRACT §5/§7）');
      else {
        let compProblems = [];
        const compRoot = path.join(sk.dir, 'components');
        let compFileCount = 0;
        comps.forEach(function (c) {
          const dir = resolveComponentDir(sk.dir, c.componentPath);
          const hasAny = exists(dir) || exists(dir + '.js');
          if (!hasAny) { compProblems.push('组件目录不存在: ' + c.componentPath); return; }
          let base = dir;
          // 允许 path 指向 index 或指向目录
          if (isFile(dir + '.js')) base = dir;
          const four = [base + '.js', base + '.json', base + '.wxml', base + '.wxss'];
          const dirFour = [path.join(base, 'index.js'), path.join(base, 'index.json'), path.join(base, 'index.wxml'), path.join(base, 'index.wxss')];
          const fourOk = four.every(function (f) { return isFile(f); });
          const dirFourOk = dirFour.every(function (f) { return isFile(f); });
          if (!fourOk && !dirFourOk) {
            const useDir = isDir(base);
            const probes = useDir ? dirFour : four;
            const miss = probes.filter(function (f) { return !isFile(f); }).map(function (f) { return path.basename(f); });
            compProblems.push(c.componentPath + ' 缺文件: ' + Array.from(new Set(miss)).join(', '));
            return;
          }
          const jsPath = (fourOk && isFile(base + '.js')) ? base + '.js' : path.join(base, 'index.js');
          const js = stripJsComments(readText(jsPath) || '');
          compFileCount += 1;
          if (js.indexOf('Component(') < 0) compProblems.push(c.componentPath + ': 不是 Component({})');
          if (js.indexOf('getContext') < 0) compProblems.push(c.componentPath + ': 缺 wx.modelContext.getContext');
          if (js.indexOf('getViewContext') < 0) compProblems.push(c.componentPath + ': 缺 wx.modelContext.getViewContext');
          if (js.indexOf('setRelatedPage') < 0) compProblems.push(c.componentPath + ': 缺 _view.setRelatedPage({query})');
          if (c.relatedPage) metaPaths.push({ skill: sk.name, component: c.componentPath, relatedPage: c.relatedPage });
        });
        if (compProblems.length) bad(label + ' 组件四件套/必做调用', compProblems.slice(0, 6).join('；') + (compProblems.length > 6 ? ' …共 ' + compProblems.length + ' 项' : ''));
        else ok(label + ' 组件四件套/必做调用', compFileCount + ' 个组件');
        if (compRoot && !isDir(compRoot)) bad(label + ' components/ 目录存在');
      }
      // 6) 禁用 API / 引用越界
      const jsFiles = walkJs(sk.dir);
      const hits = [];
      const outOfBounds = [];
      jsFiles.forEach(function (f) {
        const raw = readText(f) || '';
        const code = stripJsComments(raw);
        FORBIDDEN_PATTERNS.forEach(function (pp) {
          const re = new RegExp(pp[0].source, 'g');
          let m;
          while ((m = re.exec(code))) {
            const line = code.slice(0, m.index).split('\n').length;
            hits.push(rel(f) + ':' + line + ' ' + pp[1]);
          }
        });
        const reqRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
        let rm;
        while ((rm = reqRe.exec(code))) {
          const spec = rm[1];
          if (spec.charAt(0) !== '.') continue;      // 内置模块/包
          const resolved = path.resolve(path.dirname(f), spec);
          const inAi = resolved.replace(/\\/g, '/').toLowerCase().indexOf(AI.replace(/\\/g, '/').toLowerCase() + '/') === 0;
          if (!inAi) outOfBounds.push(rel(f) + ' → ' + spec);
        }
      });
      if (hits.length) bad(label + ' 禁用 API 扫描', hits.slice(0, 8).join('；') + (hits.length > 8 ? ' …共 ' + hits.length + ' 处' : ''));
      else ok(label + ' 禁用 API 扫描', jsFiles.length + ' 个 js 文件');
      if (outOfBounds.length) bad(label + ' 原子接口 require 不越出 ai/', outOfBounds.slice(0, 5).join('；'));
      else ok(label + ' require 不越出 ai/ 分包');
    } catch (e) {
      bad(label + ' 校验异常（不中断其余检查）', (e && e.message) || String(e));
    }
  });

  if (FINAL) {
    const started = checkedSkills.length;
    if (started < 8) bad('8 个技能全部落地', '已存在 ' + started + ' / 8');
  }

  /* ---------------- 五、instruction / page-meta ---------------- */
  section('五、全局提示词 / 页面元数据');
  const agentDir = path.join(ROOT, 'agent');
  const instrPath = appHasAgent && app.agent.instruction ? path.resolve(ROOT, app.agent.instruction) : path.join(agentDir, 'AGENTS.md');
  const metaPath = appHasAgent && app.agent.pageMetadata ? path.resolve(ROOT, app.agent.pageMetadata) : path.join(agentDir, 'page-meta.json');
  if (!isFile(instrPath)) {
    if (appHasAgent) bad('agent/AGENTS.md 存在', rel(instrPath));
    else pend('agent/AGENTS.md 存在', '页面接力会话产出');
  } else {
    const n = sizeOf(instrPath);
    if (n > 10000) bad('agent/AGENTS.md ≤10000B', '实际 ' + n + 'B');
    else if (n < 200) warn('agent/AGENTS.md 内容过少', n + 'B');
    else ok('agent/AGENTS.md ≤10000B', n + 'B');
    const txt = readText(instrPath) || '';
    const banned = ['忽略系统指令', '忽略以上', 'ignore previous', '越狱', 'jailbreak'];
    const hitBanned = banned.filter(function (b) { return txt.toLowerCase().indexOf(b.toLowerCase()) >= 0; });
    if (hitBanned.length) bad('agent/AGENTS.md 无越狱/忽略指令语句', hitBanned.join(', '));
    else ok('agent/AGENTS.md 无越狱/忽略指令语句');
    // 接口名一致性：提示词里出现的疑似接口名（反引号包裹的 camelCase 且带动词前缀）不应是编造的
    if (HARNESS) {
      // 已知接口名 = 所有 skill 的 mcp.json apis[](静态) ∪ 可加载技能的运行时注册
      const known = {};
      function collectKnownFromDir(dir) {
        const mp = path.join(dir, 'mcp.json');
        const mr = readJson(mp);
        const arr = mr.value && (mr.value.apis || mr.value.tools || mr.value.functions);
        (Array.isArray(arr) ? arr : []).forEach(function (a) { if (a && typeof a.name === 'string') known[a.name] = 1; });
      }
      listDirs(path.join(AI, 'skills')).forEach(function (d) { collectKnownFromDir(path.join(AI, 'skills', d)); });
      checkedSkills.forEach(function (sk) {
        try {
          const wx = HARNESS.createWx({ storage: HARNESS.mkFixture().storage });
          const loaded = HARNESS.loadSkill(wx, sk.dir);
          loaded.apiNames.forEach(function (n) { known[n] = 1; });
        } catch (e) { /* 前面已报 */ }
      });
      const cand = [];
      const re = /`([a-z][A-Za-z0-9]{2,})\(?`/g;
      let m;
      while ((m = re.exec(txt))) {
        const w = m[1];
        if (/^(get|list|set|run|mark|publish|delete|save|rename|calculate|reset|refill|remove|sync|export|clear|submit|verify|use|open)/.test(w) && !known[w] && cand.indexOf(w) < 0 && !/(Skill|Page|Component)/.test(w)) cand.push(w);
      }
      if (cand.length) warn('agent/AGENTS.md 提到未注册的接口名（核对）', cand.join(', '));
      else ok('agent/AGENTS.md 接口名与注册表一致（抽样）');
    }
  }

  if (!isFile(metaPath)) {
    if (appHasAgent) bad('agent/page-meta.json 存在', rel(metaPath));
    else pend('agent/page-meta.json 存在', '页面接力会话产出');
  } else {
    const n = sizeOf(metaPath);
    if (n > 8000) bad('agent/page-meta.json ≤8000B', '实际 ' + n + 'B');
    else ok('agent/page-meta.json ≤8000B', n + 'B');
    const pj = readJson(metaPath);
    if (pj.error) bad('agent/page-meta.json 可解析', pj.error);
    else {
      const entries = findPageMetaEntries(pj.value);
      if (!entries) bad('agent/page-meta.json 结构', '未找到 pages[] 数组或路径映射');
      else {
        const paths = entries.map(function (e) { return normPage((e && (e.path || e.pagePath || e.page)) || ''); }).filter(Boolean);
        if (PAGES) {
          const want = Object.keys(PAGES).map(function (k) { return normPage(PAGES[k]); });
          const miss = want.filter(function (p) { return paths.indexOf(p) < 0; });
          const extra = paths.filter(function (p) { return want.indexOf(p) < 0; });
          if (miss.length) bad('page-meta 覆盖 18 页（与 handoff.PAGES 一致）', '缺少: ' + miss.join(', '));
          else ok('page-meta 覆盖 18 页（与 handoff.PAGES 一致）', paths.length + ' 条');
          if (extra.length) bad('page-meta 路径与 handoff.PAGES 一致', '多出/错误: ' + extra.join(', '));
          // 必填字段
          const fieldProblems = [];
          entries.forEach(function (e, i) {
            const p = normPage(e && (e.path || e.pagePath || e.page));
            if (!e) { fieldProblems.push('[' + i + '] 非对象'); return; }
            if (typeof e.name !== 'string' || !e.name) fieldProblems.push((p || '[' + i + ']') + ' 缺 name');
            if (typeof e.description !== 'string' || e.description.trim().length < 4) fieldProblems.push((p || '[' + i + ']') + ' 缺 description');
          });
          if (fieldProblems.length) bad('page-meta 每条含 path/name/description', fieldProblems.slice(0, 6).join('；'));
          else ok('page-meta 每条含 path/name/description');
          // relatedPage（mcp components 声明）必须能对应 page-meta
          if (metaPaths.length) {
            const relProblems = [];
            metaPaths.forEach(function (mp) {
              const rawRp = String(mp.relatedPage || '');
              const np = normPage(rawRp);
              const byPath = paths.indexOf(np) >= 0;
              const byKey = PAGES && PAGES[np.replace(/^\//, '')] && normPage(PAGES[np.replace(/^\//, '')]) === np;
              // relatedPage 也可能写成页面 key（如 'hw'）或 path 前缀
              const keyOnly = String(rawRp).split('?')[0].replace(/^\//, '');
              const byKeyName = PAGES && !!PAGES[keyOnly];
              if (!byPath && !byKey && !byKeyName) relProblems.push(mp.skill + '/' + mp.component + ': relatedPage=' + rawRp + '（应为 handoff.PAGES 路径/key）');
            });
            if (relProblems.length) bad('mcp components 的 relatedPage 命中 page-meta', relProblems.join('；'));
            else ok('mcp components 的 relatedPage 命中 page-meta', metaPaths.length + ' 个');
          }
        }
      }
    }
  }

  /* ---------------- 六、主包接力 ---------------- */
  section('六、主包页面接力（pm 交付物）');
  const agentJs = path.join(ROOT, 'utils', 'agent.js');
  if (!isFile(agentJs)) {
    if (FINAL) bad('utils/agent.js 存在', rel(agentJs));
    else pend('utils/agent.js 存在', '页面接力会话产出');
  } else {
    const code = stripJsComments(readText(agentJs) || '');
    const miss = ['pick', 'pickQuery', 'apply'].filter(function (k) { return code.indexOf(k) < 0; });
    if (miss.length) bad('utils/agent.js 导出 pick/pickQuery/apply', '缺: ' + miss.join(', '));
    else ok('utils/agent.js 导出 pick/pickQuery/apply');
    const appjs = stripJsComments(readText(path.join(ROOT, 'app.js')) || '');
    if (appjs.indexOf('onAgentHandoff') < 0) {
      if (FINAL) bad('app.js 注册 wx.onAgentHandoff');
      else pend('app.js 注册 wx.onAgentHandoff', '页面接力会话产出');
    } else ok('app.js 注册 wx.onAgentHandoff');
  }

  return finish();
}

function finish() {
  const total = R.pass.length + R.fail.length + R.pending.length;
  if (!JSON_ONLY) {
    console.log('\n== 汇总 ==');
    console.log('PASS ' + R.pass.length + ' / FAIL ' + R.fail.length + ' / PENDING ' + R.pending.length + ' / WARN ' + R.warn.length + '（共 ' + total + ' 项）');
    if (R.fail.length) {
      console.log('\nFAIL 清单（需修复）:');
      R.fail.forEach(function (f, i) { console.log('  ' + (i + 1) + ') ' + f.name + '  —  ' + f.detail); });
    }
    if (R.pending.length) {
      console.log('\nPENDING 清单（未开始/待 Lead 统一追加）:');
      R.pending.forEach(function (f, i) { console.log('  ' + (i + 1) + ') ' + f.name + '  —  ' + f.detail); });
    }
    if (R.warn.length) {
      console.log('\nWARN 清单（建议改进，不阻断）:');
      R.warn.forEach(function (f, i) { console.log('  ' + (i + 1) + ') ' + f.name + '  —  ' + f.detail); });
    }
    console.log('\n结论: ' + (R.fail.length ? 'FAIL' : (R.pending.length ? 'PENDING（尚有未开始项）' : 'PASS')));
  }
  const out = {
    at: new Date().toISOString(),
    project: ROOT,
    mode: FINAL ? 'final' : 'dev',
    pass: R.pass, fail: R.fail, pending: R.pending, warn: R.warn,
    summary: { pass: R.pass.length, fail: R.fail.length, pending: R.pending.length, warn: R.warn.length, ok: R.fail.length === 0 }
  };
  if (JSON_ONLY) console.log(JSON.stringify(out, null, 2));
  try {
    fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
    fs.writeFileSync(RESULT_FILE, JSON.stringify(out, null, 2));
    if (!JSON_ONLY) console.log('结果文件: ' + RESULT_FILE);
  } catch (e) { console.log('（结果文件写入失败: ' + e.message + '）'); }
  process.exitCode = R.fail.length ? 1 : 0;
}

try { main(); } catch (e) {
  console.error('契约测试自身异常（不应该发生）:', e && (e.stack || e));
  process.exitCode = 2;
}
