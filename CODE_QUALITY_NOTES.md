# 微信开发者工具「代码质量」检查器逆向笔记

> 目标：搞清 DevTools 代码质量中 `IMAGE_AND_AUDIO_LIMIT` / `CONTAINS_UNUSED_COMPONENTS` / `CONTAINS_UNUSED_CODES`
> 三项规则的精确语义，并给出可离线复现的校验脚本 `code_quality_check.js`。
>
> 逆向对象：`C:\Program Files (x86)\Tencent\微信web开发者工具\resources\app.asar`
> DevTools 版本：**Stable v2.02.2608080**（asar 内 `package.json` 的 `window.title`；`app.asar` 大小 223,542,557 B，mtime 2026-09-29）
> 取证日期：2026-11-05（本会话）
>
> ⚠️ 重要：本任务执行期间，**项目已被其他并行队友改为「修复后」状态**（图片优化 + `packOptions.ignore` 落地），
> 且本笔记对任务背景中两条前提做了修正。先看第 11 节「与任务原假设的差异」。

---

## 1. TL;DR（A–E 结论）

| 问题 | 结论 | 置信度 |
| --- | --- | --- |
| **A. 扩展名全集 / limit** | 18 个：`.jpg .jpeg .png .svg .webp .gif .flac .m4a .ogg .ape .amr .wma .wav .mp3 .mp4 .aac .aiff .caf`；`limit = 200`（KB）；判定 `总字节/1024 < 200`（**严格小于**）；统计的是**整个 compiledPkg 的全部条目之和**（跨主包/分包，不按包）；单文件不设限。 | 高 |
| **A. 是否包含 cloudfunction / ignore 文件** | 规则本身不做任何排除，只看 compiledPkg 里有什么。**packOptions.ignore 的文件不会出现**（编译阶段即剔除，实验 −358,290 B）。**cloudfunctions 目录：代码文件会被「无依赖文件过滤」剔除、媒体文件不会**（实测 +100,000 B png 入包并计入；+76,055 B js 不入包）。当前项目 cloudfunctions 无媒体，不影响图片计数。 | 高（实验） |
| **B. 未使用组件判定** | 组件 = analyzer 依赖图中 `type === "Component"` 的模块（JSON 路径）。已使用：`MainPackage`/`SubPackage` 直接依赖一律算用；`Page`/`Component` 依赖要求该标签真正出现在 WXML（含 import/include 递归）或 `componentPlaceholder`/`componentGenerics` 命中。官方**只能看到依赖图里的组件**（完全未被引用的组件根本不在图中）；`Agent` 类型模块不在遍历列表里，所以 **AI 模式开启时** `agent.skills` 引入的 19 个组件全部被判未使用。输出 = 组件 JSON 路径数组（UI 列表显示 `.../index.json`）。 | 高（代码）；时序推断中高 |
| **C. 无依赖文件判定** | 编译包中 `json/wxml/wxss/js/wxs/ts/less/sass/scss` 文件 − 依赖图模块路径；`reservedFile`（babel 输出目录）豁免。返回值：`!(!1===ignoreDevUnusedFiles || !1===ignoreUploadUnusedFiles) || c` → **两个 setting 任一显式 `false` 才真正判失败，否则无条件放行**（`undefined` 也放行）。本项目 `ignoreDevUnusedFiles=true` → PASS。 | 高 |
| **D. packOptions.ignore 是否让文件从 compiledPkg 消失** | **是**。质量扫描的 `compiledPkg` = 与预览/上传**同一套编译任务 + 同一个 SummerCompiler**，仅 `resultType` 不同（`dev` vs `preview/prod`）。编译文件枚举阶段 `filterFactory` 会应用 `include` / **`packOptions.ignore`** / 无依赖文件过滤，packOptions 规则**所有模式都生效**。实验：关闭无依赖过滤后加 `ignore:["ai","agent"]`，preview 包体积 907,329 → 549,039 B（−358,290 B = ai/agent 编译后体积）。 | 高（代码+实验） |
| **E. 质量扫描编译是否应用无依赖文件过滤** | **是**。`mode = resultType = "dev"` → `initUnusedFiles(..., "prod"===mode=false)` → 用 `setting.ignoreDevUnusedFiles`（本项目 `true`）→ 未引用代码文件从 compiledPkg 剔除。所以 AI 关闭时，ai/ 的代码文件根本不会进入质量扫描的编译产物（也解释了官方扫描在 AI 关闭时不应再报那 19 个组件）。上传（prod）模式用的是 `ignoreUploadUnusedFiles`，本项目未设置 → 默认 **不过滤**（只有 packOptions.ignore 能拦住 ai/、agent/ 进入上传包）。 | 高（代码+实验）；官方 rescan 未直接实测 |

---

## 2. 取证环境与方法

### 2.1 环境

- DevTools：`C:\Program Files (x86)\Tencent\微信web开发者工具`，Stable **v2.02.2608080**；IDE 运行中（CLI HTTP 端口 9433）。
- CLI：`...\cli.bat auto-preview --project <副本> --info-output <json>` 仅编译预览、不上传（本会话实验全部在 `%TEMP%\cq_probe\` 副本上做，未改动被检查项目）。
- 项目：`C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools`（原生小程序，`compileType: miniprogram`、`useCompilerPlugins: false`、`miniprogramRoot` 未设置）。

### 2.2 app.asar 解析方法（可复现）

asar 头部是 Electron Pickle 格式，格式等价于：

```
offset 0 : u32  payload_size_1 = 4
offset 4 : u32  header_pickle_size
offset 8 : u32  payload_size_2
offset 12: u32  json_length
offset 16: json_length 字节 header JSON（含 files 文件表）
data_start = 8 + header_pickle_size
```

实测：`data_start = 8,111,404`，`files` 表共 **30,831** 个条目；每个条目 `{size, offset}`，文件内容 = `app.asar[data_start + offset : +size]`。
本次用 %TEMP% 下的临时 Python 脚本（`asar_tools.py`）解析头部、按路径/内容 grep 定位模块，再用 `npx prettier` 格式化压缩后的 `js/*.js` 模块。**没有修改 app.asar，也没有解包全量**。

### 2.3 关键模块索引（asar 内绝对偏移 / 大小）

| 模块 | 偏移 | 大小 | 作用 |
| --- | --- | --- | --- |
| `js/3b6b93029b234f57c8b150f8796c7aef.js` | 15,646,697 | 10,449 | **qualityChecker** 单例：12 条检查项的 handler map，含 `checkImageAndAudioSizeLimit` / `checkUnusedComponents` / `checkUnusedCodes` |
| `js/9223b7e8fdc904a1d4c72f9829351a93.json` | 21,685,141 | 5,572 | **QUALITY_CHECK_OPTION 默认配置**（checkList + regList + innerPluginAppidList） |
| `js/5a871b71c894bab25894861146f3fc6d.js` | 18,099,600 | 3,806 | 把上面的 json 注册为 `qualitycheckoption_DATA`（StaticConfig） |
| `js/9ee2d300f0f2e8dc45a2dac175f991cf.js` | 24,526,011 | 1,357 | `CONFIG_KEY.QUALITY_CHECK_OPTION` 常量 |
| `js/9f38892dc215a3820438b97513d72488.js` | 24,542,460 | 2,135 | config service：`get(key) = cloneDeep(Data.proxy.StaticConfig[key])` |
| `js/a3164a4a59bfa8f8b04e4f49fdd1d52e.js` | 24,726,158 | 5,071 | **CodeDenpendencyQualityChecker**：未使用组件 / 无依赖文件判定的真正实现 |
| `js/38e3192aa3ebeac77282a639969ddde0.js` | 15,579,322 | 1,120 | **BaseCodeQuality**：`addVance…`；`getCompileResultAndCheckWithProxyFunc` |
| `js/404a7ad98cd64f16ad7d64d414e3d3f4.js` | 15,844,912 | 587 | **getCompiledResult**：质量扫描自己的编译入口 |
| `js/96e2c678762ca81d19246b2ba1cdbc0d.js` | 21,851,666 | 2,823 | 编译任务工厂（预览/上传/质量扫描共用），`run()` 内调 `getCompiler(project).compile(...)` |
| `js/527609dda0ad86da09fa2e9c04f60db9.js` | 17,663,378 | 29,028 | 上传/预览构建任务（`compile()` 传 `resultType: "preview"|"prod"`） |
| `js/539421ffe5f210b96f9cc163bd317685.js` | 17,733,598 | 8,202 | 代码质量面板 UI（「扫描/重新扫描」按钮） |
| `js/5c5ef37d1a48de3d4fc296c857cdad69.js` | 18,138,317 | 1,165 | 质量面板的 `checkerRender`（未使用组件列表如何渲染） |
| `js/99320996f3b096920cc05ad85c4f070e.js` | 22,124,445 | 3,164 | `createCompiledResultAnalyzer(project, compiledPkg)`：用 compiledPkg 造分析器 |
| `js/2284d089bdc8a13a71ccd7d868ed4f83.js` | 12,246,860 | 2,595,286 | **@wechat-miniprogram 代码分析器 bundle**（Analyzer/Graph/模块类型） |
| `js/common/miniprogram-builder/modules/index.js` | 40,264,661 | 6,932 | Builder：`getCompiler()` **恒返回 SummerCompiler** |
| `js/common/miniprogram-builder/modules/corecompiler/summerCompiler.js` | 40,134,643 | 24,801 | **SummerCompiler**：编译包文件清单 + `filterFactory` + `getFiltedFileListReason` |
| `js/common/miniprogram-builder/utils/packOptionsHelper.js` | 41,130,422 | 3,460 | `packOptions.ignore` / `include` / `unusedFiles` 过滤 |
| `js/common/miniprogram-builder/utils/filerules.js` | 41,061,023 | 1,499 | 规则匹配（prefix/suffix/folder/file/glob/regexp，minimatch） |
| `js/common/miniprogram-builder/modules/corecompiler/original/compile/miniprogram.js` | 39,764,228 | 3,829 | 旧版编译器（legacy，对照用：`isNotIgnoredByProjectConfig` 二次过滤） |
| `js/common/miniprogram-builder/build-server/tasks/common/utils/project/getcompiledjs.js` | 36,434,171 | 6,552 | build-server 侧未使用 JS 的「throw stub」处理 |

---

## 3. 代码质量检查调用链（总览）

```
[Webview UI] js/539421…js  handleScanCode  「扫描/重新扫描」按钮
   └─ IWebCodeQualityService.getCompileResultAndCheckWithProxyFunc(projectpath, flowId, onProgress, onDone)
        └─ [Backend] js/38e3192…js BaseCodeQuality.getCompileResultAndCheckWithProxyFunc
             ├─ projectContext.formatBackedProject(winId)        → 项目对象（含 setting / packOptions）
             ├─ js/404a7ad…js getCompiledResult(project)          → compiledPkg（文件路径→内容 Map）
             │     └─ js/96e2c678…js compile task
             │           getCompiler(project).compile({resultType:"dev", disableSpreadingUsingComponents:true, …})
             │           ↳ SummerCompiler.compile → getPackageFiles(mode="dev") → filterFactory("dev")
             │                → include / packOptions.ignore / 无依赖文件过滤 → 编译产物
             └─ js/3b6b930…js qualityChecker.check(project, {compiledPkg, flowId}, onProgress, onDone)
                   ├─ IMAGE_AND_AUDIO_LIMIT      → checkImageAndAudioSizeLimit(compiledPkg)
                   ├─ CONTAINS_UNUSED_COMPONENTS → createCompiledResultAnalyzer(project, compiledPkg) →
                   │                              CodeDenpendencyQualityChecker.checkUnusedComponents()
                   └─ CONTAINS_UNUSED_CODES      → CodeDenpendencyQualityChecker.checkUnusedCodeFiles()
                                                    + setting 放行逻辑
```

要点：**质量扫描会自己重新编译一次项目**（不是复用预览产物），`resultType = "dev"`，并把编译结果 `compiledPkg` 交给后续分析器。所以「`packOptions.ignore` 是否影响质量扫描」等价于「它是否影响这次编译的产物」。

---

## 4. A. IMAGE_AND_AUDIO_LIMIT（图片和音频资源大小）

### 4.1 官方配置（`js/9223b7e8…json`，由 `qualitycheckoption_DATA` 注册）

```json
{
  "name": "IMAGE_AND_AUDIO_LIMIT",
  "enabled": true,
  "desc": "图片和音频资源大小应不超过 %s K",
  "limit": 200,
  "level": 2,
  "title": "图片和音频资源",
  "typeName": "代码包"
}
```

```json
"regList": {
  "IMAGE_AND_AUDIO_LIMIT": [
    ".jpg", ".jpeg", ".png", ".svg", ".webp", ".gif",
    ".flac", ".m4a", ".ogg", ".ape", ".amr", ".wma", ".wav",
    ".mp3", ".mp4", ".aac", ".aiff", ".caf"
  ]
}
```

- 扩展名**共 18 个**（大小写：`e.extname(t).toLowerCase()` 后再查 Set，故大写扩展名也算）。
- 包含 `svg / webp / gif` 与音频（`flac/m4a/ogg/ape/amr/wma/wav/mp3/aac/aiff/caf`），**还包括视频 `.mp4`**。
- `limit` 缺省 200（代码 `t.limit || 200`）。
- 配置来源：`qualityChecker.getCheckList()` 里 `this._checkConfig = a.get(a.CONFIG_KEY.QUALITY_CHECK_OPTION)`；config service 取 `Data.proxy.StaticConfig.QUALITY_CHECK_OPTION`，其打包默认值就是 `js/9223b7e8…json`（`js/5a871b71…js` 中 `qualitycheckoption_DATA = require('./9223b7e8….json')`）。**运行期可能被服务端 meta 更新覆盖**（config 模块带 `startCheckUpdate`），但内置默认值即上表。

### 4.2 判定代码（`js/3b6b930…js`）

```js
this.checkImageAndAudioSizeLimit = async (t, i) => {
  const c = i.compiledPkg,          // 编译产物：{ 路径: Buffer|string }
        o = t.limit || 200;
  let l = 0;
  if (!this._imageAndAudioExtMap) {
    const e = (this._checkConfig?.regList || {}).IMAGE_AND_AUDIO_LIMIT || [];
    this._imageAndAudioExtMap = new Set(e);
  }
  for (const [t, i] of Object.entries(c)) {
    const a = e.extname(t).toLowerCase();          // path.extname(编译包路径)
    if (this._imageAndAudioExtMap.has(a)) {
      l += (Buffer.isBuffer(i) ? i : Buffer.from(i)).length;
    }
  }
  const d = l / 1024 < o;                          // 严格小于 200KB
  …reportAction({ uintData: l / 1024 })…
  return d;
};
```

结论：

1. **统计范围 = 整个 `compiledPkg` 的合计**，不按分包、不按页面；任意路径（含子包、cloudfunctions 若入包）里的媒体文件都算。
2. 判定：`总字节 / 1024 < 200`（**严格小于**；等于 200.00KB 不通过）。
3. 规则本身**不排除** cloudfunctions，也不认识 packOptions——它只看 compiledPkg 内容（见 D/E）。
4. 单文件不设上限，只有总量上限。

### 4.3 本项目实测

| 时间点 / 状态 | images/ 实测 | 结论 |
| --- | --- | --- |
| 任务开始时（21:22，优化前） | 35 个 PNG = **243,708 B = 238.00 KB** | 未通过（与 18:54 官方扫描一致） |
| 21:30 队友 `optimize_images.py` 优化后（当前） | 35 个 PNG = **108,978 B = 106.42 KB** | 通过 |
| 复刻脚本在「还原旧体积」副本上 | 243,708 B = 238.00 KB | 未通过（验证阈值逻辑） |

「还原旧体积」副本是把当前图片按优化前的实测尺寸补齐字节（8 张 share/*.png、app-icon-1024、logo），总字节精确回到 243,708；
用 `cli.bat auto-preview` 编译该副本得到 **包体积 TOTAL = 667,382 B**，与历史记录 `mp-class-tools-tests/_compile_info_off.json` 的 667,382 完全一致；
当前优化后副本编译为 **532,652 B**，差值 **134,730 B = 243,708 − 108,978**，完全吻合。→ 图片计数口径 = 编译包内媒体文件字节数，可信度高。

> cloudfunctions 补充实验（重要，见 §8）：在当前设置下，把 100,000 B 的 png 放进 `cloudfunctions/_probe/`，preview 包体积从 532,652 → 632,652（**+100,000，媒体会入包并会被本规则计入**）；把 76,055 B 的 js 放进去，体积不变（**代码文件被无依赖过滤剔除**）。当前项目 cloudfunctions 只有 js/json，因此对 238KB/106KB 结果无影响。

---

## 5. B. CONTAINS_UNUSED_COMPONENTS（无使用组件）

### 5.1 官方检查入口（`js/3b6b930…js`）

```js
this.checkUnusedComponents = async (e, t) => {
  const i = await this.getCodeDepsChecker(t),          // CodeDenpendencyQualityChecker
        a = await i.checkUnusedComponents();           // → 组件 JSON 路径数组
  e.detail = a;
  g(e, ":");
  let c = true;
  a.length > 0 && (c = false);
  …reportAction({ Data2: ""+c, uintData: a.length })…
  return c;
};
```

- 成功条件：返回数组为空。
- 结果放在 `e.detail`；UI 面板（`js/5c5ef37d…js` 的 `checkerRender`）把 detail 数组渲染成可点击列表：
  `CONTAINS_UNUSED_COMPONENTS(e) { const t = (e.detail||[]).map(e => e.toLowerCase().endsWith('.json') ? e : e + '.json'); return <ul>…openCodeAnalyse({filePath})…</ul> }`
  → 这就是列表里显示 `ai/skills/*/components/*/index.json` 的原因（detail 是「组件路径数组」，UI 会补 `.json` 后缀后展示）。
- 点击行为：`checkerHandler` → `command("openCodeAnalyse", { from:"CodeCheckerPanel", filePath })`。

### 5.2 真正实现（`js/a3164a4a…js`，CodeDenpendencyQualityChecker.checkUnusedComponents）

```js
async checkUnusedComponents() {
  const e = this.graph.modules.filter(e =>
      "Page" === e.type || "Component" === e.type ||
      "MainPackage" === e.type || "SubPackage" === e.type),
    t = [], s = new Set();
  await Promise.all(e.map(async (e) => {
    let a = {}; try { a = (await this.analyzer.fileHelper.getJSON(e.path)) || {}; } catch (e) {}
    const n = (e) => !!a.componentPlaceholder && Object.values(a.componentPlaceholder).includes(e),
          i = (t) => {                 // 该标签是否出现在 e 的 WXML（含递归 import/include）
            const a = e.findChild("Wxml");
            if (!a) return false;
            if (a.useTags?.has(t)) return true;
            return !!a.findChildrenRecursively("Wxml").find((e) => e.useTags?.has(t));
          },
          r = Array.from(e.deps).filter((e) => "Component" === e.type);
    for (const a of r) {
      ("MainPackage" === e.type || "SubPackage" === e.type || i(a.name) ||
       e.useTags?.has(a.name) || n(a.name)) && a.module
        ? s.add(a.module)                    // 已使用
        : t.push({ page: e.path, tag: a.name, path: a.path || undefined });  // 诊断（未返回）
    }
  }));
  return this.graph.modules
    .filter((e) => "Component" === e.type && !s.has(e))
    .map((e) => e.path);                     // 未使用 = 图中 Component 模块 − 已使用集合
}
```

逐步翻译：

1. **哪些文件算组件**：`analyzer.graph.modules` 里 `type === "Component"` 的模块。它们由分析器的 JSON 依赖产生：
   - 页面/组件 `json.usingComponents` 的每一项 → 一个 `Component` 依赖（`class A extends Dep`，`from:"json"`，**name = 标签名，path = 目标 json 路径**）；
   - `app.json` / 分包级 `usingComponents` 同理；
   - **AI 开发模式**：`app.json.agent.skills[].path` → `Agent` 模块，它把该目录下所有 `"component": true` 的 JSON 也加成 `Component` 依赖（`js/2284d089…js` 内 `Agent` 模块的 `isComponentJson = !(!t || !0!==t.component)`）。
   - ⚠️ 分析器是**从 `app.json` 入口沿依赖递归建图**的（`MainPackage: class ... build()` 只 add pages/usingComponents/subPackages/agent/… 的依赖），**没有「扫描所有 JSON」这一步**。因此「完全没被任何地方引用的组件文件」根本不在图里，官方这套规则**看不到**它们。
2. **已使用怎么建立**：
   - 遍历 `MainPackage` / `SubPackage` / `Page` / `Component` 模块的直接 `Component` 依赖；
   - `MainPackage`（app.json 全局 usingComponents）/ `SubPackage`（分包级 usingComponents）的依赖：**一律算使用**；
   - `Page` / `Component` 的依赖：必须满足至少一条
     a. 该标签真的出现在这个页面/组件的 WXML 里（`Wxml.useTags`，且递归包含它 `<import>/<include>` 的 WXML）；
     b. 该 json 的 `componentPlaceholder` 值里包含该标签；
     c. `componentGenerics` 的默认实现标签（`${tag}-default`）命中；
   - **`Agent` 模块不在上面的 `e` 遍历列表里** → Agent 引入的组件永远进不了「已使用」集合。
3. **输出**：`detail = [组件 JSON 路径...]`，UI 展示为文件路径列表。
4. **为什么列表只给 `…/index.json`**：组件模块的 path 就是其 JSON 文件路径；UI 再保证 `.json` 后缀，点击跳到代码分析视图。所以看到的是「组件定义文件」而不是 JS。

### 5.3 本项目为什么会出现 19 个（关键时序）

- `ai/README.md` 记录：`ai/` 是**独立分包**，`app.json.subPackages = [{root:"ai", independent:true, pages:[]}]` + `app.json.agent.skills = 8 个 skill 路径`。
- AI 开启时：`MainPackage.build()` 会为每个 `agent.skills[].path` 生成一个 `Agent` 模块 → 该目录下的 19 个 `component:true` JSON 进入依赖图（`Component` 模块）。
- 但 `checkUnusedComponents` 只遍历 Page/Component/MainPackage/SubPackage，`Agent` 不在其中 → 这 19 个组件的父依赖（Agent）永远不会被处理 → **19 个全部报「无使用组件」**。
- **时间线证据**：`mp-class-tools-tests/_backup_ai_toggle/app.json.bak-20261105-192803`（3,288 B）内容就是带 `subPackages`+`agent` 的 AI 开启版；当前 `app.json`（1,640 B）mtime 19:28:03 = 该备份之后才执行 `ai_toggle.py --off`。18:54 的官方扫描发生在 AI **开启**期间，所以 19 个成立。
- AI 关闭后：`ai/` 不再从 `app.json` 可达 → 不在依赖图；且 dev 编译还会把 ai/ 代码文件当「无依赖文件」过滤掉（见 §8 E）→ **官方扫描在 AI 关闭后不应再出现这 19 个组件**（代码推断，见 §11 修正 2）。

### 5.4 复刻脚本的严格模式（用于验收）

`code_quality_check.js` 按任务要求采用**更严格的静态扫描**：项目内全部 `"component": true` 的 JSON（尊重 packOptions.ignore）− 「已使用集合」。已使用集合按 §5.2 规则实现（app.json/分包级无条件使用；页面/组件级需 WXML 标签命中、componentPlaceholder、componentGenerics）。

实测：

| 项目状态 | 组件总数 | 已使用 | 未使用 |
| --- | --- | --- | --- |
| 修复前副本（`%TEMP%\cq_probe\p0_base`，packOptions.ignore=[]） | 26（7 常规 + 19 ai） | 7 | **19（全部 ai/skills/*，category=unreferenced）** |
| 当前项目（ignore=[ai,agent] 已落地） | 7 | 7 | **0** |

---

## 6. C. CONTAINS_UNUSED_CODES（无依赖文件）

### 6.1 官方检查入口 + 放行语义（`js/3b6b930…js`）

```js
this.checkUnusedCodes = async (e, t) => {
  const i = await this.getCodeDepsChecker(t),
        a = i.checkUnusedCodeFiles();          // 数组：无依赖文件
  e.detail = a;
  let c = true;
  a.length > 0 && (c = false);
  …reportAction(code_quality_result_detail, Data: e.name + "_SIZE"/"_NUMS", uintData)…
  return (
    !(!1 === t.project.setting.ignoreDevUnusedFiles ||
      !1 === t.project.setting.ignoreUploadUnusedFiles)
  ) || c;
};
```

放行语义（逐字）：`!(!1===ignoreDevUnusedFiles || !1===ignoreUploadUnusedFiles) || c`

- 两个 setting **都不是显式 `false`**（`true` 或 `undefined`）→ `!false = true` → **直接 PASS，不检查**；
- 只要有任意一个是显式 `false` → 采用 `c`（真正的检查结果：无依赖文件数组为空才 PASS）。
- 本项目：`project.private.config.json` 里 `"ignoreDevUnusedFiles": true`，`ignoreUploadUnusedFiles` 未设置（`undefined`）→ **放行**（与历史扫描「CONTAINS_UNUSED_CODES 已通过」一致）。

### 6.2 判定算法（`js/a3164a4a…js`）

```js
function n(e){ return /\.(json|wxml|wxss|js|wxs|ts|less|sass|scss)/.test(e); }
checkUnusedCodeFiles() {
  const t = this.analyzer.fileHelper.getFileList("").filter(t => n(e.posix.extname(t)));
  const s = new Set();
  this.analyzer.graph.modules.forEach(m => { const a = t.find(x => x === m.path); a && s.add(a); });
  t.forEach(x => { this.reservedFile(x) && s.add(x); });     // reservedFile = babel 输出目录
  return t.filter(x => !s.has(x));
}
```

- 候选集 = 编译包内扩展名命中 `json|wxml|wxss|js|wxs|ts|less|sass|scss` 的文件；
- 已依赖 = 依赖图模块路径（从 app.json 出发：pages/subPackages、usingComponents、JS `require/import`、WXML `import/include/wxs`、WXSS `@import`、agent skills 目录等）；
- `reservedFile = path.indexOf(babelRoot) >= 0`（`getHelperOutputPath(setting)`，默认 `@babel/runtime`）豁免；
- 输出同样是文件路径数组（`detail`），UI 的 handler 是 `openCodeAnalyse {filterType:"unused"}`。

### 6.3 本项目

- 编译包内无依赖代码文件 = **0**（dev 编译已把无依赖代码文件过滤掉，见 §8）。
- 静态全量（把过滤前的项目代码文件都算上）无依赖文件 **10 个**：
  `app.miniapp.json`、`cloudfunctions/notify/{index.js,config.json,package.json}`、
  `cloudfunctions/_backup/notify_20261105-1309_preRemind/{index.js,config.json,package.json}`、
  `i18n/base.json`、`project.miniapp.json`、`project.private.config.json`。
  （其中 cloudfunctions 是独立部署的云函数，不随小程序包上传；官方在 dev 模式会按「无依赖」过滤它们。）
- 结论：官方判定 **PASS**（setting 放行；且即使不放行，dev 编译产物中也没有无依赖代码文件）。

---

## 7. D. compiledPkg 是什么？packOptions.ignore 是否生效？（关键）

### 7.1 compiledPkg = 与预览/上传同一套编译的产物

```js
// js/38e3192…js  BaseCodeQuality
async getCompileResultAndCheckWithProxyFunc(e, t, r, c, i) {
  const s = await this.projectContext.formatBackedProject(e),
        n = await (0, a.getCompiledResult)(s);       // ← 编译，得到 compiledPkg
  return await o.qualityChecker.check(s, { compiledPkg: n, flowId: t }, r, c, i);
}

// js/404a7ad…js  getCompiledResult
exports.getCompiledResult = async s => {
  …t = (0, e.default)({...s, setting:{...s.setting, uglifyFileName:false}},
       { platform:"devtools", noCompile:true, resultType:"dev",
         onProgressUpdate(){}, onFilesIgnored(){}, onFilesMissing(){} });
  return await t;
};

// js/96e2c678…js  compile task run()
const p = await (0, a.getCompiler)(e);
t = await p.compile({
  __compileDebugInfo__: { from:"devtools", useNewCompileModule:true, devtoolsVersion:…, compileSetting:e.setting },
  compilePages: o.compilePages, analyzer: o.analyzer,
  disableSpreadingUsingComponents: true,
  resultType: o.resultType || "prod",
});

// js/527609…js（预览/上传任务）compile()
const i = { noCompile:true, onProgressUpdate:…, onFilesIgnored:…, onFilesMissing:…,
            compilerOptions:…, miniappOptions:…,
            resultType: "test" === e.uploadType ? "preview" : "prod" };
this._buildInstance = (0, K.default)(t, i);      // K = js/96e2c678…（同一个任务工厂）
```

→ 质量扫描 / 预览 / 上传用的是**同一个编译任务工厂 `96e2c678` + 同一个 `getCompiler`**，只是 `resultType` 分为 `dev` / `preview` / `prod`。
→ `compiledPkg` 就是这次编译的文件 Map（`{路径: 编译后内容}`），也就是「质量扫描所看到的包」。

### 7.2 编译器与过滤链

```js
// js/common/miniprogram-builder/modules/index.js （Builder）
async getCompiler() { return this.getSummerCompiler(); }      // ← 恒用 SummerCompiler（与 useCompilerPlugins 无关）

// summerCompiler.js
async compile(e) {
  const t = (await this.getPackageFiles(
      …, config.FullPkg,
      e.resultType,        // ← dev / preview / prod 就在这里分流
      e.useCache,
    )).map(e => e.path);
  …
}

async filterFactory(e) {                        // e = "dev" | "preview" | "prod"
  packOptionsHelper.updateState(this.project);
  await packOptionsHelper.initUnusedFiles(this.project, this.analyzer, "prod" === e, this.onProgressUpdate);
  const t = this._filterFactory ? await this._filterFactory(e) : () => 0;
  return (i, s) => {                            // i = 包类型, s = 文件绝对路径
    const a = packOptionsHelper.relativePath(s);
    return this.isMiniappPlatformInclude(s) || packOptionsHelper.isFileIncluded(a)
        ? EFilterCode.Include
        : packOptionsHelper.isIgnoredByRules(a)
          ? EFilterCode.PackOptionsIgnore        // ← packOptions.ignore
          : i === miniProgram && packOptionsHelper.isIgnoreByUnusedFiles(s, "prod" === e)
            ? EFilterCode.AnalyseNoUse           // ← 无依赖文件过滤（dev 用 ignoreDevUnusedFiles；prod 用 ignoreUploadUnusedFiles）
            : t(i, s);
  };
}
```

结论：

1. **`packOptions.ignore` 在「编译包文件枚举阶段」生效**（`isIgnoredByRules` 分支），对所有 resultType（dev/preview/prod）都生效；
2. 它发生在**打包/文件清单构建**阶段，而不是只在 upload 网络上传阶段 → 被 ignore 的文件**不会出现在 compiledPkg**，因此质量扫描看不到；
3. `include` 规则优先于 `ignore`（`isFileIncluded` 先返回 Include）；
4. 规则细节在 `filerules.js`：路径统一 `\`→`/` 并**转小写**；支持 `prefix`（按 basename 前缀）/`suffix`（按 basename 后缀）/`folder`（路径前缀 + `/`）/`file`（全路径相等）/`glob`（minimatch）/`regexp`。

### 7.3 可复现实验（全部在 `%TEMP%\cq_probe\` 副本上，只 auto-preview 不上传）

基线：当前项目整体复制（AI off、images 已优化、packOptions.ignore=[]，副本 `p0_base`）。

| 变体 | setting.ignoreDevUnusedFiles | packOptions.ignore | 额外改动 | preview TOTAL |
| --- | --- | --- | --- | --- |
| p0_base | true（默认，来自 private config） | `[]` | — | **532,652 B** |
| p1_ignore | true | `[ai, agent]` | — | 532,652 B |
| p2_nodel | true | `[]` | 物理删除 `ai/`、`agent/` 目录 | 532,652 B |
| p3_nofilter | **false**（+ignoreUpload=false） | `[]` | — | **907,329 B** |
| p4_nofilter_ignore | **false** | `[ai, agent]` | — | **549,039 B** |
| p8_clouddefault2 | true | `[]` | `cloudfunctions/_probe/probe.png` +100,000 B | 632,652 B |
| p9_cloudjs | true | `[]` | `cloudfunctions/_probe/probe.js` +76,055 B | 532,652 B |
| p10_cloudignore | true | `[cloudfunctions]` | 同 p8 的 png | 532,652 B |

解读：

- **p3 → p4：−358,290 B** = ai/ + agent/（源码 596,742 B）经编译（含压缩）后的体积 → **packOptions.ignore 确实把文件从编译产物中清除**。
- p0 = p1 = p2：在 `ignoreDevUnusedFiles=true` 的 dev/preview 编译下，ai/、agent/ 早已被无依赖文件过滤剔除 → 此时 `packOptions.ignore` 对预览包「看不出差异」（不是没生效，而是已经被过滤掉了）。
- p8：cloudfunctions 下的**媒体文件不会被无依赖过滤剔除**（过滤只针对代码扩展名 `isCodeFile`）→ 入包并计入 IMAGE_AND_AUDIO_LIMIT（+100,000）。
- p9：cloudfunctions 下的**代码文件**会被当无依赖文件过滤 → 不入包（+76,055 JS 对体积无影响）。
- p10：`packOptions.ignore: folder cloudfunctions` 后，cloudfunctions 的媒体也被排除（632,652 → 532,652）→ 再次证明 ignore 对编译包有效。

**D 结论：YES——packOptions.ignore（folder/file 等规则）会让文件从质量扫描的 compiledPkg 中消失，扫描不再看到 ai/、agent/。置信度：高（代码 + 实验双证据）。**

> 实践意义（结合 E）：AI 关闭 + `ignoreDevUnusedFiles=true` 时，dev 质量扫描本来就会过滤掉 ai/、agent/（ignore 是冗余保险）；
> 但**上传（prod）模式**用的是 `ignoreUploadUnusedFiles`，本项目未设置 → 默认**不做**无依赖过滤 → 只有 `packOptions.ignore` 能阻止 ai/、agent/ 进入上传包。
> 所以 `ai_toggle.py --off` 同时做「app.json 去 AI 配置 + packOptions.ignore ai/agent」是正确且必要的。

### 7.4 当前项目状态变更记录（与队友并行）

- `app.json`：19:28:03 由 `ai_toggle.py --off` 写入（AI 配置移除；`_backup_ai_toggle/app.json.bak-20261105-192803` = AI 开启版）。
- `project.config.json`：**21:32:52** 被写入 `packOptions.ignore = [{folder: ai}, {folder: agent}]`（本次任务期间由队友 ai-packager 落地）。
- `images/`：21:30 前后由 `optimize_images.py` 优化（238.00 KB → 106.42 KB）。
- 因此**本任务开始时项目是「未修复」状态，当前已是「修复后」状态**；本笔记的「修复前」数据来自 21:33 复制的 `p0_base` 副本（ignore=[]）。

---

## 8. E. 质量扫描的编译是否应用「无依赖文件过滤」

**答：应用。** 且模式相关：

```js
// SummerCompiler.filterFactory
await packOptionsHelper.initUnusedFiles(
  this.project,
  this.analyzer,
  "prod" === e,            // isUpload：dev/preview=false（用 ignoreDevUnusedFiles），prod=true（用 ignoreUploadUnusedFiles）
  this.onProgressUpdate,
);
```

```js
// packOptionsHelper.js
updateState(e) {
  …
  this.ignoreUploadUnusedFiles = Boolean(e.setting.ignoreUploadUnusedFiles);
  this.ignoreDevUnusedFiles = Boolean(e.setting.ignoreDevUnusedFiles);
}
isUnuserFilesEnable(e = false) {         // e = isUpload
  return e ? false !== this.ignoreUploadUnusedFiles        // prod: 需显式 true 才过滤
           : true === this.ignoreDevUnusedFiles || false !== this.ignoreDevUnusedFiles;
}                                        // dev : 等价于 Boolean(ignoreDevUnusedFiles)
```

- 质量扫描 `resultType === "dev"`，且 `"prod" === e` 为 `false` → 使用 `ignoreDevUnusedFiles`；本项目为 `true` → **会过滤**。
- 实验旁证：preview（同样走 dev 分支）在 `ignoreDevUnusedFiles=true` 时 532,652 B，改成 `false` 后 907,329 B（差 374,677 B ≈ ai/agent + 其它未引用代码）；p2 物理删除 ai/agent 体积不变 → 说明 ai/agent 本就被过滤。
- 影响：
  1. AI 关闭时，ai/ 的代码文件不会进入质量扫描的 compiledPkg → `CONTAINS_UNUSED_COMPONENTS` / `CONTAINS_UNUSED_CODES` 都看不到它们（官方扫描不该再报那 19 个组件）；
  2. AI 开启时，ai/ 通过 `agent.skills` 进入**源码分析器的依赖图** → 被判定为「有依赖」→ 不会被无依赖过滤剔除 → 进入 compiledPkg → 然后被 `checkUnusedComponents` 判为无使用组件（19 个）；
  3. `prod`（上传）模式不做默认无依赖过滤 → 上传包需要 `packOptions.ignore` 才能砍掉 ai/、agent/。

> 注意：`ignoreDevUnusedFiles` 是 DevTools 的「本地设置」项，通常存在 `project.private.config.json`（本项目即如此），
> 打包默认值来自项目配置合并（`formatBackedProject` 合并 project.config.json + project.private.config.json，private 优先）。

---

## 9. 复刻脚本 `code_quality_check.js`

位置：`mp-class-tools-tests/code_quality_check.js`（零依赖，Node ≥ 14；本机 Node v24.21.0 实测）。

```bash
node code_quality_check.js                          # 默认 ../mp-class-tools
node code_quality_check.js --project <dir> --json   # 机器可读输出
node code_quality_check.js --project <dir> --exclude-unused-filter   # 诊断：关闭 dev 无依赖过滤
node code_quality_check.js --help
# 退出码：全部通过 0；有规则未通过 1；参数/项目错误 2
```

实现要点（与官方语义对齐）：

| 脚本部分 | 复刻的官方语义 | 说明 |
| --- | --- | --- |
| 编译包清单 | 源文件 → white-list 扩展名（`MiniProgramWhiteList` 默认集 + 媒体扩展名并集）→ packOptions include/ignore 规则（folder/file/prefix/suffix/glob/regexp，路径小写）→ dev 模式无依赖代码文件过滤（`ignoreDevUnusedFiles`） | 官方 whitelist 会从服务端更新；脚本用默认集并集 |
| IMAGE_AND_AUDIO_LIMIT | 18 个扩展名、limit 200、`total/1024 < 200`、全包合计 | 与官方逐字对齐 |
| CONTAINS_UNUSED_COMPONENTS | app.json/分包级 usingComponents 一律算用；页面/组件级需 WXML 标签命中（含 import/include 递归）/componentPlaceholder/componentGenerics；组件 = `"component": true` 的 JSON | **严格模式**：扫描项目源文件全部组件（官方只看依赖图内组件），用于验收「AI 关闭时 19 个」 |
| CONTAINS_UNUSED_CODES | 从 app.json 沿 pages/subPackages/usingComponents/JS require-import/WXML import-include-wxs/WXSS @import 建图；候选 = code 扩展名文件；setting 放行语义 `!(ignoreDev===false \|\| ignoreUpload===false) \|\| 检查结果` | require/import 只解析字面量；不处理 npm/插件/动态路径（已知局限） |

实测结果：

| 场景 | 命令目标 | IMAGE_AND_AUDIO_LIMIT | CONTAINS_UNUSED_COMPONENTS | CONTAINS_UNUSED_CODES | 退出码 |
| --- | --- | --- | --- | --- | --- |
| 当前项目（修复后：AI off + ignore ai/agent + 图片已优化） | `../mp-class-tools` | **PASS 106.42 KB** | **PASS（7 组件全使用）** | **PASS（setting 放行；包内 0 个无依赖）** | **0** |
| 修复前副本（ignore=[]） | `%TEMP%\cq_probe\p0_base` | PASS 106.42 KB | **FAIL：19 个**（全部 ai/skills/*） | PASS（setting 放行；静态 186 个无依赖代码文件，含 ai/） | 1 |
| 还原旧图片体积副本（238.00 KB） | `%TEMP%\cq_probe\p238_mediafail` | **FAIL 238.00 KB** | FAIL：19 个（副本同修复前） | PASS | 1 |

> ⚠️ 口径提醒：脚本 JSON 里的 `package.totalBytes`（当前项目 788,159 B / 769.69 KB）是**源文件原始字节近似**
> （white-list + packOptions + dev 无依赖过滤后的源文件字节，且把 `project.config.json` 也计入），
> **不是** DevTools 真实编译包体积；真实包体请用 `cli.bat auto-preview --info-output` 量（当前 **532,652 B**）。
> 该值只用于文件清单/媒体统计，三条规则判定不受影响。

> 说明：任务要求「当前项目媒体总量≈238KB 未通过、19 个未使用组件」——这是**任务开始时的状态**。
> 任务执行中队友已先完成修复，因此对**当前真实项目**跑脚本已全部 PASS；用修复前副本 + 还原旧图片体积副本可稳定复现任务描述的两种 FAIL。
> 还原旧体积副本的官方编译包体积 667,382 B 与历史 `_compile_info_off.json` 完全一致，证明还原口径正确。

---

## 10. 实验复现步骤（可选，供复核）

```powershell
# 0) 准备副本（不要动真实项目）
$root = "$env:TEMP\cq_probe"
robocopy C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools $root\p0_base /E

# 1) 基线（当前设置）编译
& 'C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat' auto-preview `
    --project "$root\p0_base" --info-output "$root\out_p0.json"
# 读 out_p0.json.size.total

# 2) 关闭无依赖过滤（project.config.json 与 project.private.config.json 的 setting 都写 false）
#    → 再编译，观察体积上升（ai/agent 等未引用代码进入包）

# 3) 在 (2) 基础上给 project.config.json 加：
#    "packOptions": { "ignore": [ {"type":"folder","value":"ai"}, {"type":"folder","value":"agent"} ], "include": [] }
#    → 再编译，体积应回落约 358KB（= ai/agent 编译后体积）→ 证明 ignore 进编译包

# 4) cloudfunctions 行为：往副本 cloudfunctions/ 放 100KB png → 体积 +100KB；
#    放 76KB js → 体积不变（无依赖代码文件被过滤）

# 5) 副本用完可 cli.bat close --project <副本路径>（或直接删除 %TEMP%\cq_probe）
```

（本次实验产物：`%TEMP%\cq_probe\out_*.json`、副本 `p0_base/p1_ignore/p2_nodel/p3_nofilter/p4_nofilter_ignore/p8_clouddefault2/p9_cloudjs/p10_cloudignore/p238_mediafail`。）

---

## 11. 重要修正：与任务原假设的差异

1. **「当前项目 238KB 未通过 + 19 个未使用组件」已不是当前状态**：任务执行期间队友已落地两项修复——
   `project.config.json` 在 21:32:52 写入 `packOptions.ignore=[ai,agent]`；`images/` 在 21:30 左右被优化到 106.42 KB。
   当前真实项目三项均 PASS。修复前状态保存在 `%TEMP%\cq_probe\p0_base` 副本，复刻脚本对它输出 19 个未使用组件。
2. **「AI 关闭时官方扫描会报 19 个未使用组件」不成立（代码推断，置信度中高）**：
   官方 `CONTAINS_UNUSED_COMPONENTS` 只统计依赖图内的组件；AI 关闭后 ai/ 不在图中，而且 dev 编译会把这些代码文件当「无依赖文件」过滤掉。
   19 个的出现需要 **AI 开启**（`app.json.agent.skills` → Agent 模块 → 19 组件入图 → Agent 类型又不在未使用检查的遍历范围内）。
   时间线也吻合：AI 配置 13:31 写入，19:28 才 `--off`，18:54 的扫描正处于 AI 开启期。
   本复刻脚本按任务要求采用「项目源文件全量组件扫描」的**严格模式**，因此无论 AI 开关都能报出 19 个（修复前），
   这比官方实际报出更保守——验收时不能把它当作「官方一定报 19」的证据。
3. **「cloudfunctions 目录会被排除」不成立（实验）**：cloudfunctions 下的**媒体文件会进入编译包并计入 IMAGE_AND_AUDIO_LIMIT**（+100KB 实测），
   只有**代码文件**会被无依赖过滤剔除。脚本按实测语义实现；当前项目 cloudfunctions 无媒体文件，两种口径结果一致。
4. **无依赖过滤对质量扫描是生效的**（E），所以本项目的 `ignoreUploadUnusedFiles` 未设置（默认 false）时，上传（prod）编译**不会**过滤 ai/agent——
   `packOptions.ignore` 在这里是**必需**的，而不仅仅是保险。

---

## 12. 置信度与待验证点

| 项 | 置信度 | 说明 / 待验证 |
| --- | --- | --- |
| A：扩展名 18 个 / limit 200 / 总量严格<200 | 高 | 配置 JSON + 代码逐字核对；`QUALITY_CHECK_OPTION` 运行期可能被服务端更新（未抓包验证） |
| A：cloudfunctions 媒体计入 / 代码不计入 | 高 | auto-preview 实测（+100,000 / +0）；质量扫描用同一编译器（dev 分支） |
| B：官方判定算法 | 高 | `a3164a4a…js` 源码直读；组件类型/依赖来自 analyzer bundle（2.6MB 压缩包，按关键片段阅读） |
| B：19 个只在 AI 开启时出现 | 中高 | 代码推断（依赖图入口 + Agent 排除）+ 时间线；**未重跑官方 UI 扫描**（无法脚本触发） |
| C：setting 放行语义 | 高 | 返回值表达式逐字核对；本项目 setting 值来自 project.private.config.json |
| D：packOptions.ignore 进编译包 | 高 | 代码（filterFactory/isIgnoredByRules）+ 4 组体积实验 |
| D：质量扫描 compiledPkg 与预览同源 | 高 | 同一个任务工厂 `96e2c678` + 同一 `getCompiler`，仅 resultType 不同 |
| E：dev 编译应用无依赖过滤 | 高 | 代码 + 实验（preview 与 dev 走同一分支）；官方 UI rescan 未直接实测 |
| 复刻脚本与官方完全一致 | 中高 | 规则/阈值/放行逐字对齐；CONTAINS_UNUSED_COMPONENTS 用更严格源扫描；require/import 只解析字面量；WXML 标签用正则近似（官方用完整 WXML parser + analyzer） |
| 官方内部分析器细节（useTags/import 递归/Agent） | 中高 | analyzer bundle 未公开源码，按 bundle 关键片段 + 行为反推 |

**建议的最终验证**（人工）：在 DevTools 里对当前项目点击「代码质量 → 重新扫描」，确认
`IMAGE_AND_AUDIO_LIMIT` PASS（106.4KB）、`CONTAINS_UNUSED_COMPONENTS` PASS（0 个）、`CONTAINS_UNUSED_CODES` PASS；
如仍有 19 个组件，则按 §8/§11 的推断检查是否 AI 配置被重新打开（`app.json` 是否含 `agent`/`subPackages`）。

---

## 13. 附：官方代码片段原文（关键对照）

### A. checkImageAndAudioSizeLimit（完整）

```js
(this.checkImageAndAudioSizeLimit = async (t, i) => {
  var a;
  const c = i.compiledPkg,
    o = t.limit || 200;
  let l = 0;
  if (!this._imageAndAudioExtMap) {
    const e = ((null === (a = this._checkConfig) || void 0 === a ? void 0 : a.regList) || {})
      .IMAGE_AND_AUDIO_LIMIT || [];
    this._imageAndAudioExtMap = new Set(e);
  }
  for (const [t, i] of Object.entries(c)) {
    const a = e.extname(t).toLowerCase();
    if (this._imageAndAudioExtMap.has(a)) {
      l += (Buffer.isBuffer(i) ? i : Buffer.from(i)).length;
    }
  }
  const d = l / 1024 < o;
  return ((0, s.default)(n.IReportService).reportAction({
      Action: r.ActionType.code_quality_result_detail,
      Data: t.name, Data2: "" + d, Data4: this.flowId, uintData: l / 1024,
    }), g(t, "" + o), d);
});
```

### B/C. 未使用组件 / 无依赖文件返回值（qualityChecker）

```js
// CONTAINS_UNUSED_COMPONENTS
const i = await this.getCodeDepsChecker(t),
      a = await i.checkUnusedComponents();
e.detail = a;
a.length > 0 && (c = false);
return c;

// CONTAINS_UNUSED_CODES
const i = await this.getCodeDepsChecker(t),
      a = i.checkUnusedCodeFiles();
e.detail = a;
a.length > 0 && (c = false);
return !(!1 === t.project.setting.ignoreDevUnusedFiles ||
         !1 === t.project.setting.ignoreUploadUnusedFiles) || c;
```

### 已使用组件判定（CodeDenpendencyQualityChecker）

```js
const e = this.graph.modules.filter(e =>
    "Page" === e.type || "Component" === e.type ||
    "MainPackage" === e.type || "SubPackage" === e.type);
const n = (e) => !!a.componentPlaceholder && Object.values(a.componentPlaceholder).includes(e),
      i = (t) => { const a = e.findChild("Wxml"); if (!a) return false;
        if (a.useTags?.has(t)) return true;
        return !!a.findChildrenRecursively("Wxml").find(e => e.useTags?.has(t)); },
      r = Array.from(e.deps).filter(e => "Component" === e.type);
for (const a of r) {
  ("MainPackage" === e.type || "SubPackage" === e.type || i(a.name) ||
   e.useTags?.has(a.name) || n(a.name)) && a.module
    ? s.add(a.module) : t.push({ page: e.path, tag: a.name, path: a.path });
}
return this.graph.modules.filter(e => "Component" === e.type && !s.has(e)).map(e => e.path);
```

### D/E. 编译包过滤（summerCompiler.filterFactory）

```js
async filterFactory(e) {
  packOptionsHelper.updateState(this.project);
  await packOptionsHelper.initUnusedFiles(this.project, this.analyzer, "prod" === e, this.onProgressUpdate);
  const t = this._filterFactory ? await this._filterFactory(e) : () => 0;
  return (i, s) => {
    const a = packOptionsHelper.relativePath(s);
    return this.isMiniappPlatformInclude(s) || packOptionsHelper.isFileIncluded(a)
        ? EFilterCode.Include
        : packOptionsHelper.isIgnoredByRules(a)          // packOptions.ignore
          ? EFilterCode.PackOptionsIgnore
          : i === miniProgram && packOptionsHelper.isIgnoreByUnusedFiles(s, "prod" === e)
            ? EFilterCode.AnalyseNoUse               // 无依赖文件（dev: ignoreDevUnusedFiles；prod: ignoreUploadUnusedFiles）
            : t(i, s);
  };
}
```

---

*笔记生成：2026-11-05 · 逆向 + 实验 + 复刻脚本；所有实验均在 `%TEMP%` 副本上进行，未修改被检查项目。*
