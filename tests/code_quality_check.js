#!/usr/bin/env node
/**
 * code_quality_check.js —— 微信开发者工具「代码质量」检查规则离线复刻（零依赖）
 *
 * 复刻目标（逆向自微信开发者工具 app.asar，2026-11-05 版本）：
 *   1) IMAGE_AND_AUDIO_LIMIT   图片和音频资源大小应不超过 200K（总量，单位 KB）
 *   2) CONTAINS_UNUSED_COMPONENTS 不应存在无使用的组件
 *   3) CONTAINS_UNUSED_CODES      不应存在无依赖文件（含 setting 放行语义）
 *
 * 官方实现位置（app.asar 内）：
 *   js/3b6b93029b234f57c8b150f8796c7aef.js  qualityChecker（checkImageAndAudioSizeLimit / checkUnusedComponents / checkUnusedCodes）
 *   js/9223b7e8fdc904a1d4c72f9829351a93.json QUALITY_CHECK_OPTION 默认配置（limit / regList 扩展名全集）
 *   js/a3164a4a59bfa8f8b04e4f49fdd1d52e.js  CodeDenpendencyQualityChecker（未使用组件/无依赖文件的判定实现）
 *   js/common/miniprogram-builder/utils/packOptionsHelper.js  packOptions.ignore / 无依赖文件过滤
 *   js/common/miniprogram-builder/modules/corecompiler/summerCompiler.js 编译包文件清单过滤
 *
 * 用法：
 *   node code_quality_check.js                         # 默认校验 ../mp-class-tools
 *   node code_quality_check.js --project ../mp-class-tools
 *   node code_quality_check.js --project <dir> --json  # 只输出 JSON（便于 CI/脚本消费）
 *
 * 退出码：全部规则通过 => 0；有规则未通过 => 1；参数/项目错误 => 2。
 *
 * 说明（重要，详见 CODE_QUALITY_NOTES.md）：
 *   - 编译包文件清单按官方语义近似：项目源文件 - packOptions 规则排除 - （dev 模式下可选的）无依赖代码文件过滤；
 *     官方只把 white-list 扩展名纳入编译包，本脚本同样只纳入常见小程序扩展名。
 *   - CONTAINS_UNUSED_COMPONENTS 的官方判定基于「依赖图」（只统计已声明/注册过的组件）；
 *     本脚本额外扫描项目内全部 `"component": true` 的 JSON（更严格的静态检查），
 *     因此 AI 开发模式关闭（app.json 无 agent/subPackages）时仍会把 ai/skills/* 下 19 个组件报为未使用。
 *     输出里用 category 区分「未被任何 usingComponents 引用」与「已声明但 WXML 未真正使用」。
 *   - CONTAINS_UNUSED_CODES 的 require/import 解析只处理字面量路径，不处理动态 require / npm / 插件路径；
 *     官方 setting 放行语义：只有当 ignoreDevUnusedFiles === false 或 ignoreUploadUnusedFiles === false
 *     至少一个显式为 false 时才真正判失败，否则一律 PASS（见官方 checkUnusedCodes 返回值）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// 0. 官方常量（从 QUALITY_CHECK_OPTION 默认配置对齐）
// ---------------------------------------------------------------------------

const QUALITY_CHECK_OPTION = {
  checkList: [
    {
      name: 'IMAGE_AND_AUDIO_LIMIT',
      enabled: true,
      desc: '图片和音频资源大小应不超过 %s K',
      limit: 200,
      level: 2,
      title: '图片和音频资源',
      typeName: '代码包',
    },
    {
      name: 'CONTAINS_UNUSED_COMPONENTS',
      enabled: true,
      desc: '不应存在无使用的组件 %s',
      level: 3,
      handlerText: '建议去除',
      title: '组件',
      typeName: '无使用或无依赖文件',
    },
    {
      name: 'CONTAINS_UNUSED_CODES',
      enabled: true,
      desc: '不应存在无依赖文件',
      level: 3,
      handlerText: '点击查看',
      title: '代码文件',
      typeName: '无使用或无依赖文件',
    },
  ],
  // 官方 regList.IMAGE_AND_AUDIO_LIMIT（顺序/内容逐项对齐）
  regList: {
    IMAGE_AND_AUDIO_LIMIT: [
      '.jpg', '.jpeg', '.png', '.svg', '.webp', '.gif',
      '.flac', '.m4a', '.ogg', '.ape', '.amr', '.wma', '.wav',
      '.mp3', '.mp4', '.aac', '.aiff', '.caf',
    ],
  },
};

// 官方 MiniProgramWhiteList 默认值（js/common/miniprogram-builder/utils/white_ext_list.js）
// 线上会从服务端拉取更新，这里用「默认 + 媒体扩展名」的并集，避免漏掉可入包资源。
const PACKAGE_WHITE_EXT = new Set([
  '.wxml', '.wxss', '.wxs', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.js', '.json',
  '.cer', '.mp3', '.aac', '.m4a', '.mp4', '.wav', '.ogg', '.silk', '.wasm', '.br',
  '.cur', '.ico', '.skel', '.crt', '.cert',
  // IMAGE_AND_AUDIO_LIMIT 里出现、但默认白名单未列出的扩展名（服务端白名单可能包含）
  '.webp', '.flac', '.ape', '.amr', '.wma', '.aiff', '.caf',
]);

// 官方 isCodeFile 正则（packOptionsHelper.js / tools.js）：只有这些扩展名会参与「无依赖文件」过滤
const CODE_FILE_RE = /\.(json|wxml|wxss|js|wxs|ts|less|sass|scss)$/;

// ---------------------------------------------------------------------------
// 1. 参数解析
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    project: path.resolve(__dirname, '..'),
    json: false,
    includeCloudfunctionsCode: false, // 默认按官方 dev 编译语义：cloudfunction 代码文件会被「无依赖文件」过滤掉
    excludeUnusedFilter: false, // 仅诊断：关闭无依赖文件过滤，观察编译包原始清单
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project' || a === '-p') {
      if (!argv[i + 1]) throw new Error('--project 缺少路径参数');
      opts.project = path.resolve(argv[++i]);
    } else if (a === '--json') {
      opts.json = true;
    } else if (a === '--include-cloudfunctions-code') {
      opts.includeCloudfunctionsCode = true;
    } else if (a === '--exclude-unused-filter') {
      opts.excludeUnusedFilter = true;
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    } else {
      throw new Error('未知参数: ' + a);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// 2. 基础工具
// ---------------------------------------------------------------------------

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

function stripExt(p) {
  const i = p.lastIndexOf('.');
  const j = p.lastIndexOf('/');
  return i > j ? p.slice(0, i) : p;
}

function extname(p) {
  const i = p.lastIndexOf('.');
  const j = p.lastIndexOf('/');
  if (i <= j) return '';
  return p.slice(i);
}

function readJsonFile(abs) {
  try {
    let s = fs.readFileSync(abs, 'utf8');
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

/** 递归枚举目录下所有普通文件（返回 { rel, abs, size }，rel 使用 posix 分隔符） */
function walkFiles(rootAbs) {
  const out = [];
  const seenDirs = new Set();
  const visit = (absDir, relDir) => {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of entries) {
      const abs = path.join(absDir, ent.name);
      const rel = relDir ? relDir + '/' + ent.name : ent.name;
      let st;
      try {
        st = fs.statSync(abs);
      } catch (e) {
        continue;
      }
      if (st.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git') continue;
        if (seenDirs.has(abs)) continue;
        seenDirs.add(abs);
        visit(abs, rel);
      } else if (st.isFile()) {
        out.push({ rel, abs, size: st.size });
      }
    }
  };
  visit(rootAbs, '');
  return out;
}

function posixJoin(...parts) {
  return path.posix.join(...parts.filter((p) => p !== '' && p !== undefined && p !== null));
}

function posixDirname(p) {
  const d = path.posix.dirname(p);
  return d === '.' ? '' : d;
}

function posixNormalize(p) {
  let n = path.posix.normalize(toPosix(p));
  while (n.startsWith('./')) n = n.slice(2);
  if (n === '.') n = '';
  return n;
}

// ---------------------------------------------------------------------------
// 3. packOptions 规则匹配（复刻 js/common/miniprogram-builder/utils/filerules.js）
//    官方实现：path 统一小写 + '/' 分隔；type: prefix/suffix/folder/file/glob/regexp
// ---------------------------------------------------------------------------

function leading(p, ch) {
  return p.startsWith(ch) ? p : ch + p;
}
function trailing(p, ch) {
  return p.endsWith(ch) ? p : p + ch;
}

function globToRegExp(glob) {
  // minimatch 子集：** 跨目录，* 单层，? 单字符；其余字符转义
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  try {
    return new RegExp('^' + re + '$');
  } catch (e) {
    return null;
  }
}

function doRule(relPathLower, rule) {
  if (!rule || (rule.type !== 'regexp' && typeof rule.value !== 'string')) return false;
  const p = relPathLower;
  const base = p.slice(p.lastIndexOf('/') + 1);
  const v = String(rule.value).toLowerCase();
  switch (rule.type) {
    case 'prefix':
      return base.startsWith(v);
    case 'suffix':
      return base.endsWith(v);
    case 'folder':
      // leading(e,"/").startsWith(trailing(leading(l,"/"),"/"))
      return leading(p, '/').startsWith(trailing(leading(v, '/'), '/'));
    case 'file':
      return leading(p, '/') === leading(v, '/');
    case 'glob': {
      const re = globToRegExp(v);
      if (!re) return false;
      return re.test(p) || re.test(leading(p, '/'));
    }
    case 'regexp': {
      try {
        const re = new RegExp(String(rule.value), 'igm');
        return re.test(p);
      } catch (e) {
        return false;
      }
    }
    default:
      return false;
  }
}

function buildRuleMatcher(rules) {
  const list = Array.isArray(rules) ? rules.filter((r) => r && typeof r === 'object') : [];
  return (relPath) => {
    if (list.length === 0) return false;
    const p = toPosix(relPath).toLowerCase();
    for (const rule of list) {
      if (doRule(p, rule)) return true;
    }
    return false;
  };
}

function createPackOptionsMatcher(packOptions) {
  const includeMatch = buildRuleMatcher(packOptions && packOptions.include);
  const ignoreMatch = buildRuleMatcher(packOptions && packOptions.ignore);
  return {
    includeMatch,
    ignoreMatch,
    isIncluded(rel) {
      return includeMatch(rel);
    },
    isIgnoredByRules(rel) {
      // 官方：!isFileIncluded && isFileIgnored
      return !includeMatch(rel) && ignoreMatch(rel);
    },
    isNotIgnored(rel) {
      return !(this.isIgnoredByRules(rel));
    },
  };
}

// ---------------------------------------------------------------------------
// 4. 读取项目配置（project.config.json + project.private.config.json 合并）
// ---------------------------------------------------------------------------

function loadProject(projectDir) {
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    throw new Error('项目目录不存在: ' + projectDir);
  }
  const confPath = path.join(projectDir, 'project.config.json');
  const privPath = path.join(projectDir, 'project.private.config.json');
  const projectConfig = readJsonFile(confPath);
  if (!projectConfig) throw new Error('无法解析 project.config.json: ' + confPath);
  const privateConfig = fs.existsSync(privPath) ? readJsonFile(privPath) : null;

  // 官方 formatBackedProject 会把 private 配置合并进项目 setting（private 优先）
  const setting = Object.assign(
    {},
    projectConfig.setting || {},
    (privateConfig && privateConfig.setting) || {}
  );

  const miniprogramRoot = toPosix(projectConfig.miniprogramRoot || '').replace(/\/$/, '').replace(/^\.\//, '');
  const cloudfunctionRoot = toPosix(projectConfig.cloudfunctionRoot || '').replace(/\/$/, '');

  const rootAbs = miniprogramRoot ? path.join(projectDir, miniprogramRoot) : projectDir;
  if (!fs.existsSync(rootAbs)) throw new Error('miniprogramRoot 不存在: ' + rootAbs);

  const appJsonPath = path.join(rootAbs, 'app.json');
  const appJson = readJsonFile(appJsonPath);
  if (!appJson) throw new Error('无法解析 app.json: ' + appJsonPath);

  return {
    projectDir,
    rootAbs,
    miniprogramRoot,
    cloudfunctionRoot,
    projectConfig,
    privateConfig,
    setting,
    appJson,
    files: walkFiles(rootAbs),
    packOptions: projectConfig.packOptions || { ignore: [], include: [] },
  };
}

// ---------------------------------------------------------------------------
// 5. 编译包文件清单
//    官方链路：SummerCompiler._getPackageFiles -> filterFactory(dev|preview|prod)
//      - include 规则命中 => Include
//      - packOptions.ignore 规则命中 => PackOptionsIgnore（所有模式都生效）
//      - 无依赖代码文件 => AnalyseNoUse（dev/preview 用 setting.ignoreDevUnusedFiles，prod 用 setting.ignoreUploadUnusedFiles）
//      - 官方只打包 white-list 扩展名
//    本脚本：先算静态「无依赖代码文件」（规则 C 的图），再按模式决定是否从编译包中剔除。
// ---------------------------------------------------------------------------

function isCodeFile(rel) {
  return CODE_FILE_RE.test(extname(rel));
}

function isMediaFile(rel) {
  const ext = extname(rel).toLowerCase();
  return QUALITY_CHECK_OPTION.regList.IMAGE_AND_AUDIO_LIMIT.includes(ext);
}

// ---------------------------------------------------------------------------
// 6. 规则 A：IMAGE_AND_AUDIO_LIMIT
//    官方：遍历 compiledPkg 所有条目，path.extname(key).toLowerCase() ∈ regList 则累加 Buffer 长度；
//          totalBytes / 1024 < limit(200) => PASS（严格小于）。
// ---------------------------------------------------------------------------

function checkImageAndAudioLimit(pkg) {
  const config = QUALITY_CHECK_OPTION.checkList.find((c) => c.name === 'IMAGE_AND_AUDIO_LIMIT');
  const limit = config.limit || 200;
  const hits = [];
  let totalBytes = 0;
  for (const f of pkg.files) {
    if (!isMediaFile(f.rel)) continue;
    totalBytes += f.size;
    hits.push({ file: f.rel, bytes: f.size });
  }
  hits.sort((a, b) => b.bytes - a.bytes || (a.file < b.file ? -1 : 1));
  const totalKB = totalBytes / 1024;
  const success = totalKB < limit;
  return {
    name: 'IMAGE_AND_AUDIO_LIMIT',
    title: config.title,
    desc: config.desc,
    level: config.level,
    limit,
    success,
    totalBytes,
    totalKB: Math.round(totalKB * 100) / 100,
    fileCount: hits.length,
    files: hits,
  };
}

// ---------------------------------------------------------------------------
// 7. 组件图（规则 B）
//    官方 CodeDenpendencyQualityChecker.checkUnusedComponents 语义：
//      - 组件 = analyzer 依赖图里 type === "Component" 的模块（JSON 路径，如 ".../index.json"）
//      - 已使用：MainPackage/SubPackage 直接依赖（app.json / 分包级 usingComponents）一律算使用；
//        Page/Component 依赖需满足：该标签在其 WXML（含 import/include 的 WXML）里真正出现，
//        或 json.componentPlaceholder 映射了该标签，或 componentGenerics 默认标签。
//      - 未使用 = 图中 Component 模块不在「已使用」集合里。
//    本脚本额外扫描项目内全部 "component": true 的 JSON（严格静态模式），
//    用来覆盖官方依赖图看不到的「完全未被引用的组件文件」。
// ---------------------------------------------------------------------------

/** 解析 usingComponents 值到组件 json 相对路径（相对 miniprogramRoot） */
function resolveComponentJsonPath(fromJsonRel, refValue) {
  if (typeof refValue !== 'string' || refValue === '') return null;
  if (/^(plugin|plugin-private):\/\//.test(refValue)) return { plugin: true };
  let target = refValue.split('?')[0];
  if (target.startsWith('/')) {
    target = target.slice(1);
  } else {
    target = posixJoin(posixDirname(fromJsonRel), target);
  }
  target = posixNormalize(target);
  if (!target) return null;
  if (target.endsWith('.json')) return { jsonPath: target };
  return { jsonPath: target + '.json' };
}

/** 读取 WXML 文本（不存在返回 null） */
function readWxml(project, jsonRel) {
  const wxmlRel = stripExt(jsonRel) + '.wxml';
  const abs = path.join(project.rootAbs, wxmlRel.split('/').join(path.sep));
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

/**
 * 收集 WXML 文件里出现的标签名（含 import/include 的递归 WXML）。
 * 官方 Wxml.useTags 用正则 /<([\w\-]+)(\s|>|\/)/g；并递归 findChildrenRecursively("Wxml") 统计 import/include。
 */
function collectWxmlTags(project, wxmlRel, tagSet, visited) {
  if (wxmlRel in visited) return;
  visited[wxmlRel] = true;
  const abs = path.join(project.rootAbs, wxmlRel.split('/').join(path.sep));
  if (!fs.existsSync(abs)) return;
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    return;
  }
  const tagRe = /<([\w-]+)(\s|>|\/)/g;
  let m;
  while ((m = tagRe.exec(text))) tagSet.add(m[1]);
  const refRe = /<(import|include)[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((m = refRe.exec(text))) {
    const src = m[2].split('?')[0];
    if (src.startsWith('.')) {
      const r = posixNormalize(posixJoin(posixDirname(wxmlRel), src));
      collectWxmlTags(project, r, tagSet, visited);
    }
  }
}

function buildComponentIndex(project) {
  const jsonByPath = new Map();
  for (const f of project.files) {
    if (!f.rel.endsWith('.json')) continue;
    const obj = readJsonFile(f.abs);
    if (obj && typeof obj === 'object') jsonByPath.set(f.rel, obj);
  }
  return jsonByPath;
}

function checkUnusedComponents(project, pkg, jsonByPath, packOptions) {
  const config = QUALITY_CHECK_OPTION.checkList.find((c) => c.name === 'CONTAINS_UNUSED_COMPONENTS');
  const app = project.appJson;

  // 项目内全部组件（"component": true 的 JSON）；packOptions 排除后不参与检查。
  // 注意：这里刻意扫描「项目源文件」而不是编译包（任务要求：AI 关闭时也要复现 19 个 ai 组件）。
  // 官方 analyzer 只会看到依赖图里出现过的组件，因此本列表比官方实际报出更严格（见 CODE_QUALITY_NOTES.md §B）。
  const allComponents = [];
  for (const [rel, json] of jsonByPath.entries()) {
    if (json.component === true) allComponents.push(rel);
  }
  allComponents.sort();
  const candidates = allComponents.filter((rel) => packOptions.isNotIgnored(rel));

  // ---- 已使用集合 ----
  const used = new Set(); // 组件 json 相对路径
  const active = new Set(); // 需要继续展开 usingComponents 的 json
  const activeQueue = [];
  const declaredBy = new Map(); // 组件 json -> 首次被谁声明（诊断）
  const rendered = new Set(); // 被真实标签使用过的组件
  const unresolved = [];

  const activate = (jsonRel) => {
    if (active.has(jsonRel) || !jsonByPath.has(jsonRel)) return;
    active.add(jsonRel);
    activeQueue.push(jsonRel);
  };

  const markUsed = (jsonRel, fromJson, viaTag) => {
    if (!jsonByPath.has(jsonRel)) {
      unresolved.push({ path: jsonRel, from: fromJson });
      return;
    }
    if (!declaredBy.has(jsonRel)) declaredBy.set(jsonRel, fromJson);
    if (!used.has(jsonRel)) {
      used.add(jsonRel);
      activate(jsonRel);
    }
    if (viaTag) rendered.add(jsonRel);
  };

  // app.json 全局 usingComponents：官方 MainPackage 直接依赖 => 一律算使用
  const processJsonUsingComponents = (jsonRel, opts) => {
    const json = jsonByPath.get(jsonRel);
    if (!json) return;
    const wxmlTags = opts.tagCheck ? new Set() : null;
    if (opts.tagCheck) {
      const wxmlRel = stripExt(jsonRel) + '.wxml';
      collectWxmlTags(project, wxmlRel, wxmlTags, {});
    }
    const placeholderTags = new Set(Object.values(json.componentPlaceholder || {}).map(String));
    const genericTags = new Set();
    for (const [tag, val] of Object.entries(json.componentGenerics || {})) {
      if (val && typeof val === 'object' && typeof val.default === 'string') {
        genericTags.add(tag + '-default');
      }
    }
    const using = json.usingComponents || {};
    for (const [tag, ref] of Object.entries(using)) {
      const resolved = resolveComponentJsonPath(jsonRel, ref);
      if (!resolved || resolved.plugin) continue;
      const target = resolved.jsonPath;
      let isUsed = true;
      if (opts.tagCheck) {
        isUsed =
          wxmlTags.has(tag) ||
          placeholderTags.has(tag) ||
          (json.componentGenerics && genericTags.has(tag + '-default'));
        // 官方还接受 componentGenerics 解析出的 `${tag}-default` 标签出现在 WXML 中
        if (!isUsed && wxmlTags.has(tag + '-default')) isUsed = true;
      }
      if (isUsed) markUsed(target, jsonRel, opts.tagCheck);
      else if (!declaredBy.has(target)) declaredBy.set(target, jsonRel);
    }
  };

  // 规则 1：app.json 全局 usingComponents（无条件使用）
  processJsonUsingComponents('app.json', { tagCheck: false });
  // 规则 2：分包级 usingComponents（官方 SubPackage 直接依赖 => 无条件使用）
  const subs = app.subPackages || app.subpackages || [];
  for (const sub of subs) {
    if (!sub || typeof sub !== 'object' || !sub.usingComponents) continue;
    for (const [tag, ref] of Object.entries(sub.usingComponents)) {
      const resolved = resolveComponentJsonPath('app.json', ref);
      if (!resolved || resolved.plugin) continue;
      markUsed(resolved.jsonPath, 'app.json#subpackage(' + (sub.root || '') + ')', false);
    }
  }

  // 规则 3：页面（app.json.pages + 分包 pages）-> 激活并按 WXML 标签检查其 usingComponents
  const pageSet = new Set();
  for (const p of app.pages || []) pageSet.add(stripExt(String(p)) + '.json');
  for (const sub of subs) {
    for (const p of (sub && sub.pages) || []) {
      pageSet.add(posixJoin(sub.root || '', String(p)).replace(/^\//, '') + '.json');
    }
  }
  for (const pageJson of pageSet) activate(pageJson);
  // 自定义 tabBar / appBar 组件也是入口
  if (app.tabBar && app.tabBar.custom) activate('custom-tab-bar/index.json');
  if (app.appBar) activate('app-bar/index.json');

  while (activeQueue.length > 0) {
    const rel = activeQueue.shift();
    processJsonUsingComponents(rel, { tagCheck: true });
  }

  // ---- 组件分类 ----
  const unused = [];
  for (const rel of candidates) {
    if (used.has(rel)) continue;
    const isDeclared = declaredBy.has(rel);
    unused.push({
      path: rel,
      category: isDeclared ? 'declared-but-not-used' : 'unreferenced',
      declaredBy: declaredBy.get(rel) || null,
    });
  }
  unused.sort((a, b) => (a.path < b.path ? -1 : 1));
  const rules = [
    {
      name: config.name,
      title: config.title,
      desc: config.desc,
      level: config.level,
      success: unused.length === 0,
      count: unused.length,
      unused,
      totalComponents: candidates.length,
      usedComponents: candidates.length - unused.length,
      unresolved,
    },
  ];
  return { rule: rules[0], allComponents, candidates, used };
}

// ---------------------------------------------------------------------------
// 8. 代码依赖图（规则 C）
//    官方：Analyzer 从 app.json（MainPackage）出发，沿规则依赖 + JS require/import + WXML import/include/wxs + WXSS @import 建图；
//          checkUnusedCodeFiles = 编译包中 code 扩展名文件 - 图模块路径。
//    本脚本为静态近似：只解析字面量路径；不处理动态 require/插件/npm 包内部依赖。
// ---------------------------------------------------------------------------

const JS_REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const JS_IMPORT_FROM_RE = /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const JS_EXPORT_FROM_RE = /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;
const WXML_SRC_RE = /<(import|include|wxs)[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
const WXSS_IMPORT_RE = /@import\s+(?:url\()?\s*['"]([^'"]+)['"]/g;

function resolveModulePath(project, fromRel, request, extHints) {
  let req = String(request).split('?')[0];
  if (req.startsWith('plugin://') || req.startsWith('plugin-private://')) return null;
  if (req.startsWith('/')) req = req.slice(1);
  else req = posixJoin(posixDirname(fromRel), req);
  req = posixNormalize(req);
  if (!req) return null;
  const abs = path.join(project.rootAbs, req.split('/').join(path.sep));
  const tryPaths = [req];
  if (extHints) {
    for (const ext of extHints) tryPaths.push(req + ext);
  }
  for (const p of tryPaths) {
    const a = path.join(project.rootAbs, p.split('/').join(path.sep));
    try {
      if (fs.statSync(a).isFile()) return p;
    } catch (e) {
      /* continue */
    }
  }
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    for (const ext of extHints || ['.js']) {
      const p = req + '/index' + ext;
      try {
        if (fs.statSync(path.join(project.rootAbs, p.split('/').join(path.sep))).isFile()) return p;
      } catch (e) {
        /* continue */
      }
    }
  }
  return null;
}

function buildCodeGraph(project, jsonByPath) {
  const app = project.appJson;
  const usedFiles = new Set();
  const queue = [];
  const enqueue = (rel) => {
    if (!rel) return;
    const norm = posixNormalize(rel);
    const abs = path.join(project.rootAbs, norm.split('/').join(path.sep));
    let st = null;
    try {
      st = fs.statSync(abs);
    } catch (e) {
      return;
    }
    if (!st.isFile()) return;
    if (usedFiles.has(norm)) return;
    usedFiles.add(norm);
    queue.push(norm);
  };
  const extOf = (rel) => extname(rel).toLowerCase();

  // 入口：app.json / app.js / app.wxss / 配置里声明的 json
  enqueue('app.json');
  enqueue('app.js');
  enqueue('app.wxss');
  enqueue(toPosix(app.sitemapLocation || 'sitemap.json'));
  enqueue(toPosix(app.themeLocation || 'theme.json'));
  enqueue('project.config.json');
  enqueue('ext.json');
  if (app.tabBar && app.tabBar.custom) enqueue('custom-tab-bar/index.json');
  if (app.appBar) enqueue('app-bar/index.json');

  const subs = app.subPackages || app.subpackages || [];
  for (const sub of subs) {
    for (const [tag, ref] of Object.entries((sub && sub.usingComponents) || {})) {
      const r = resolveComponentJsonPath('app.json', ref);
      if (r && !r.plugin) {
        enqueueComponentFiles(r.jsonPath);
      }
    }
  }
  function enqueueComponentFiles(jsonRel) {
    enqueue(jsonRel);
    for (const ext of ['.js', '.wxml', '.wxss']) enqueue(stripExt(jsonRel) + ext);
  }
  function enqueuePage(pagePath) {
    const base = String(pagePath).replace(/^\//, '');
    enqueue(base + '.json');
    for (const ext of ['.js', '.wxml', '.wxss']) enqueue(base + ext);
  }
  for (const p of app.pages || []) enqueuePage(p);
  for (const sub of subs) {
    for (const p of (sub && sub.pages) || []) {
      enqueuePage(posixJoin(sub.root || '', String(p)).replace(/^\//, ''));
    }
  }

  // Agent（AI 开发模式）：官方 Agent 模块会把 skills 目录下所有文件纳入依赖图
  const agent = app.agent;
  if (agent && Array.isArray(agent.skills)) {
    for (const skill of agent.skills) {
      const dir = posixNormalize(String((skill && skill.path) || '').replace(/\/$/, ''));
      if (!dir) continue;
      for (const f of project.files) {
        if (f.rel === dir || f.rel.startsWith(dir + '/')) {
          if (extOf(f.rel) !== '.md') enqueue(f.rel);
        }
      }
    }
    if (agent.pageMetadata) enqueue(toPosix(agent.pageMetadata));
  }
  // 全局 usingComponents（app.json）
  for (const [tag, ref] of Object.entries(app.usingComponents || {})) {
    const r = resolveComponentJsonPath('app.json', ref);
    if (r && !r.plugin) enqueueComponentFiles(r.jsonPath);
  }

  // BFS：按文件类型展开依赖
  const maxIter = 50000;
  let guard = 0;
  while (queue.length > 0 && guard++ < maxIter) {
    const rel = queue.shift();
    const ext = extOf(rel);
    const abs = path.join(project.rootAbs, rel.split('/').join(path.sep));
    let text = '';
    if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg' && ext !== '.gif' && ext !== '.svg' && ext !== '.webp') {
      try {
        text = fs.readFileSync(abs, 'utf8');
      } catch (e) {
        text = '';
      }
    }
    if (ext === '.json') {
      const json = jsonByPath.get(rel);
      if (!json) continue;
      for (const [tag, ref] of Object.entries(json.usingComponents || {})) {
        const r = resolveComponentJsonPath(rel, ref);
        if (r && !r.plugin) enqueueComponentFiles(r.jsonPath);
      }
      for (const [tag, val] of Object.entries(json.componentGenerics || {})) {
        if (val && typeof val === 'object' && typeof val.default === 'string') {
          const r = resolveComponentJsonPath(rel, val.default);
          if (r && !r.plugin) enqueueComponentFiles(r.jsonPath);
        }
      }
    } else if (ext === '.js' || ext === '.wxs' || ext === '.ts') {
      let m;
      const reList = [JS_REQUIRE_RE, JS_IMPORT_FROM_RE, JS_EXPORT_FROM_RE];
      for (const re of reList) {
        re.lastIndex = 0;
        while ((m = re.exec(text))) {
          const p = resolveModulePath(project, rel, m[1], ['.js', '.json', '.wxs', '.ts']);
          if (p) enqueue(p);
        }
      }
    } else if (ext === '.wxml') {
      let m;
      WXML_SRC_RE.lastIndex = 0;
      while ((m = WXML_SRC_RE.exec(text))) {
        const type = m[1].toLowerCase();
        const p = resolveModulePath(project, rel, m[2], type === 'wxs' ? ['.wxs'] : ['.wxml']);
        if (p) enqueue(p);
      }
    } else if (ext === '.wxss' || ext === '.less' || ext === '.scss' || ext === '.sass') {
      let m;
      WXSS_IMPORT_RE.lastIndex = 0;
      while ((m = WXSS_IMPORT_RE.exec(text))) {
        const p = resolveModulePath(project, rel, m[1], ['.wxss', '.less', '.scss', '.sass']);
        if (p) enqueue(p);
      }
    }
  }
  return usedFiles;
}

function checkUnusedCodes(project, pkg, jsonByPath, opts) {
  const config = QUALITY_CHECK_OPTION.checkList.find((c) => c.name === 'CONTAINS_UNUSED_CODES');
  const usedFiles = buildCodeGraph(project, jsonByPath);
  const setting = project.setting || {};
  const ignoreDev = setting.ignoreDevUnusedFiles;
  const ignoreUpload = setting.ignoreUploadUnusedFiles;

  // 编译包内 code 文件（官方 checkUnusedCodeFiles 只看 fileHelper.getFileList 的 code 扩展名）
  const packageCodeFiles = pkg.files
    .map((f) => f.rel)
    .filter((rel) => isCodeFile(rel))
    .sort();
  const unusedInPackage = packageCodeFiles.filter((rel) => !usedFiles.has(rel));

  // 静态全量：项目内所有 code 文件（含被 dev 无依赖过滤剔除的），用于修复参考
  const staticUnused = project.files
    .map((f) => f.rel)
    .filter((rel) => isCodeFile(rel))
    .filter((rel) => pkg.packOptions.isNotIgnored(rel))
    .filter((rel) => !usedFiles.has(rel))
    .sort();

  // 官方放行语义（js/3b6b93029b234f57c8b150f8796c7aef.js checkUnusedCodes 返回值）：
  //   !(!1 === ignoreDevUnusedFiles || !1 === ignoreUploadUnusedFiles) || checkedResult
  // 其中 checkedResult 是对「编译包」跑 checkUnusedCodeFiles() 的结果（PASS = 列表为空）。
  const forceCheck = ignoreDev === false || ignoreUpload === false;
  const success = forceCheck ? unusedInPackage.length === 0 : true;

  return {
    name: config.name,
    title: config.title,
    desc: config.desc,
    level: config.level,
    success,
    settingPass: !forceCheck,
    ignoreDevUnusedFiles: ignoreDev === undefined ? null : ignoreDev,
    ignoreUploadUnusedFiles: ignoreUpload === undefined ? null : ignoreUpload,
    packageCodeFileCount: packageCodeFiles.length,
    usedCodeFileCount: usedFiles.size,
    unusedInPackage,
    staticUnused,
  };
}

// ---------------------------------------------------------------------------
// 9. 输出（人类可读 + --json）
// ---------------------------------------------------------------------------

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  return (n / 1024).toFixed(2) + ' KB';
}

function printHuman(result) {
  const L = [];
  L.push('============================================================');
  L.push(' 微信开发者工具「代码质量」离线复刻校验');
  L.push(' 项目: ' + result.projectDir);
  L.push(' miniprogramRoot: ' + (result.miniprogramRoot || '(空 = 项目根)'));
  L.push(' 编译包: ' + result.package.fileCount + ' 个文件 / ' + fmtBytes(result.package.totalBytes) + '（源文件原始字节近似，非真实编译包体积）');
  L.push(' 无依赖文件过滤(dev): ' + (result.package.unusedFilesFiltered ? '开启（' + result.package.unusedFilesFilteredCount + ' 个代码文件被剔除）' : '关闭'));
  L.push('============================================================');

  for (const rule of result.rules) {
    L.push('');
    L.push('【' + rule.name + '】' + (rule.success ? '✔ PASS' : '✘ FAIL') + '  ' + rule.title);
    if (rule.name === 'IMAGE_AND_AUDIO_LIMIT') {
      L.push('  描述: ' + rule.desc.replace('%s', String(rule.limit)));
      L.push('  实测: ' + fmtBytes(rule.totalBytes) + ' / ' + rule.limit + ' KB = ' + rule.totalKB + ' KB（共 ' + rule.fileCount + ' 个文件）');
      L.push('  判定: 总量(KB) < limit（严格小于） => ' + (rule.success ? '通过' : '未通过'));
      if (rule.files.length) {
        L.push('  明细 Top ' + Math.min(rule.files.length, 20) + ':');
        for (const f of rule.files.slice(0, 20)) L.push('    ' + fmtBytes(f.bytes).padStart(9) + '  ' + f.file);
      }
    } else if (rule.name === 'CONTAINS_UNUSED_COMPONENTS') {
      L.push('  描述: ' + rule.desc.replace('%s', ':'));
      L.push('  组件总数(源文件 "component": true): ' + rule.totalComponents + '，已使用: ' + rule.usedComponents + '，未使用: ' + rule.count);
      if (rule.count) {
        for (const c of rule.unused) {
          L.push('    [' + (c.category === 'unreferenced' ? '未被引用' : '已声明未使用') + '] ' + c.path + (c.declaredBy ? '  ← ' + c.declaredBy : ''));
        }
      }
    } else if (rule.name === 'CONTAINS_UNUSED_CODES') {
      L.push('  描述: ' + rule.desc);
      L.push('  setting.ignoreDevUnusedFiles = ' + rule.ignoreDevUnusedFiles + '，setting.ignoreUploadUnusedFiles = ' + rule.ignoreUploadUnusedFiles);
      L.push('  官方放行语义: ' + (rule.settingPass ? '两个 setting 均非显式 false => 直接 PASS（不检查）' : '至少一个显式 false => 按实际检查结果判定'));
      L.push('  编译包内无依赖代码文件: ' + rule.unusedInPackage.length + ' 个');
      L.push('  静态全量无依赖代码文件（含被过滤的）: ' + rule.staticUnused.length + ' 个');
      if (rule.staticUnused.length) {
        for (const f of rule.staticUnused.slice(0, 40)) L.push('    ' + f);
        if (rule.staticUnused.length > 40) L.push('    ... 其余 ' + (rule.staticUnused.length - 40) + ' 个见 --json');
      }
    }
  }

  L.push('');
  L.push('------------------------------------------------------------');
  L.push('汇总: ' + result.summary);
  L.push('退出码: ' + (result.success ? 0 : 1));
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// 10. main
// ---------------------------------------------------------------------------

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error('[code_quality_check] ' + e.message);
    console.error('用法: node code_quality_check.js --project <小程序项目目录> [--json]');
    process.exitCode = 2;
    return;
  }
  if (opts.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0] + '*/');
    return;
  }

  let project;
  try {
    project = loadProject(opts.project);
  } catch (e) {
    console.error('[code_quality_check] ' + e.message);
    process.exitCode = 2;
    return;
  }

  const jsonByPath = buildComponentIndex(project);
  const packOptions = createPackOptionsMatcher(project.packOptions);

  // ---- 编译包清单：源文件 -> white-list 扩展名 -> packOptions 规则 -> （可选）无依赖代码文件过滤 ----
  // 注意：project.files 的 rel 已相对于 miniprogramRoot（loadProject 时 walkFiles(rootAbs)）。
  const baseCandidates = [];
  for (const f of project.files) {
    const ext = extname(f.rel).toLowerCase();
    if (!PACKAGE_WHITE_EXT.has(ext)) continue;
    if (packOptions.isIgnoredByRules(f.rel)) continue;
    baseCandidates.push({ rel: f.rel, rootRel: f.rel, size: f.size });
  }

  // 静态无依赖代码文件（用于 dev 过滤模拟）——先做一次图计算
  const packFilesStub = {
    files: baseCandidates.map((c) => ({ rel: c.rel, size: c.size })),
    fileByRel: new Set(baseCandidates.map((c) => c.rel)),
    packOptions,
  };
  const unusedCodesProbe = checkUnusedCodes(project, packFilesStub, jsonByPath, opts);

  // 官方 dev 编译模式：setting.ignoreDevUnusedFiles 为真时，把无依赖代码文件从编译包中剔除
  const devUnusedFilterEnabled = !opts.excludeUnusedFilter && Boolean(project.setting.ignoreDevUnusedFiles);
  const filteredOut = new Set();
  if (devUnusedFilterEnabled) {
    for (const rel of unusedCodesProbe.staticUnused) {
      // 官方过滤只作用于 isCodeFile 扩展名的文件（cloudfunction 目录下代码同样会被判定为「无依赖」而剔除）
      filteredOut.add(rel);
    }
  }

  const pkgFiles = baseCandidates
    .filter((c) => !filteredOut.has(c.rel))
    .map((c) => ({ rel: c.rel, size: c.size }));
  const pkg = {
    files: pkgFiles,
    fileByRel: new Set(pkgFiles.map((f) => f.rel)),
    totalBytes: pkgFiles.reduce((s, f) => s + f.size, 0),
    fileCount: pkgFiles.length,
    unusedFilesFiltered: devUnusedFilterEnabled,
    unusedFilesFilteredCount: filteredOut.size,
    packOptions,
  };

  // ---- 三条规则 ----
  const ruleA = checkImageAndAudioLimit(pkg);
  const ruleB = checkUnusedComponents(project, pkg, jsonByPath, packOptions);
  const ruleC = checkUnusedCodes(project, pkg, jsonByPath, opts);

  // CONTAINS_UNUSED_COMPONENTS：官方依赖图语义下，未引用组件看不到；这里保留严格静态结果用于验收
  const rules = [ruleA, ruleB.rule, ruleC];
  const failed = rules.filter((r) => !r.success);

  const result = {
    tool: 'code_quality_check.js',
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    projectDir: project.projectDir,
    miniprogramRoot: project.miniprogramRoot,
    cloudfunctionRoot: project.cloudfunctionRoot,
    setting: {
      ignoreDevUnusedFiles: project.setting.ignoreDevUnusedFiles === undefined ? null : project.setting.ignoreDevUnusedFiles,
      ignoreUploadUnusedFiles: project.setting.ignoreUploadUnusedFiles === undefined ? null : project.setting.ignoreUploadUnusedFiles,
    },
    packOptionsIgnore: (project.packOptions && project.packOptions.ignore) || [],
    package: {
      fileCount: pkg.fileCount,
      totalBytes: pkg.totalBytes,
      unusedFilesFiltered: pkg.unusedFilesFiltered,
      unusedFilesFilteredCount: pkg.unusedFilesFilteredCount,
      note: '按官方 dev 编译语义近似：white-list 扩展名 + packOptions 规则 + 无依赖代码文件过滤（可由 setting 关闭）。注意 totalBytes 为源文件原始字节近似（含 project.config.json 等未压缩内容），仅用于文件清单/媒体统计，不等于 DevTools 真实编译包体积（真实包体用 cli auto-preview 量）',
    },
    rules,
    summary: failed.length === 0 ? '全部规则通过' : '未通过: ' + failed.map((r) => r.name).join(', '),
    success: failed.length === 0,
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    console.log(printHuman(result));
  }
  process.exitCode = result.success ? 0 : 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  loadProject,
  QUALITY_CHECK_OPTION,
  checkImageAndAudioLimit,
  checkUnusedComponents,
  checkUnusedCodes,
};
