// utils/ppt.js —— 「演示」工具（PPT 演示）小程序端数据层 + 纯逻辑（2026-11-09）
//
// 契约唯一真源：web/ppt/CONTRACT.md（v1）
//   §2 数据流 / §3 云端表 / §4 PostgREST 接口 / §5 manifest v1 / §7 页切换动效映射 / §8.1 通用交互
//
// 设计要点：
//   * 所有云端请求走 utils/cloud.js 的统一 request 通道（Authorization: Bearer <publishableKey>
//     + X-Class-Token）；本文件不保存/打印任何 token，页面只拿到 {ok, reason} 结果，不白屏；
//   * 分片上传：512 KiB 原始字节/片 → wx.getFileSystemManager 按 offset/length 读 ArrayBuffer →
//     wx.arrayBufferToBase64 → POST ppt_upload_chunks（并发 ≤4、失败重试 2 次 400/1200ms 退避、
//     进度回调、可取消）；读取函数与发送函数可注入（Node 单测用 mock，不碰 wx 文件系统）；
//   * manifest 归一化：缺字段/未知字段/坏数据都按默认值容错（契约 §5「兼容」），解析后的 URL、
//     step 扁平序列、热点矩形、预加载计划、页码换算全部是纯函数（可单测）；
//   * 状态文案与列表排序严格按契约 §4.4 / §8.1；转换机心跳按 §3.4 的 180s 离线判定。
//
// 页面：pages/ppt（列表 + 上传）、pages/pptplay（全屏播放器）。
const cloud = require('./cloud.js');
const CFG = require('./cloud-config.js');

/* ============================================================
 * 常量（与契约一致；改这里必须同步 CONTRACT.md）
 * ============================================================ */
const CHUNK_SIZE = 512 * 1024;              // 512 KiB 原始字节/片（§3.2）
const MAX_SOURCE_SIZE = 64 * 1024 * 1024;   // 转换机源文件上限 64MiB（§6）
const MAX_CHUNKS = Math.ceil(MAX_SOURCE_SIZE / CHUNK_SIZE); // 128 片
const UPLOAD_CONCURRENCY = 4;               // 并行度 ≤4（§3.2）
const UPLOAD_RETRY = 2;                     // 失败重试 2 次（§4.2）
const RETRY_BACKOFF = [400, 1200];          // 指数退避 400ms / 1200ms（§4.2）
const HB_OFFLINE_MS = 180000;               // 心跳 >3 分钟 → 转换机离线（§3.4）
const HEARTBEAT_ID = 'ppt_agent';           // site_assets.id（§3.4）
const CLIENT = 'mp';                        // 本端标识（§3.1）
const EXTS = ['ppt', 'pptx'];               // 允许的源文件扩展名
const TITLE_MAX = 80;                       // 标题 ≤80 字（§3.1）
const NOTES_MAX = 2000;                     // 备注截断（转换机侧也截断到 2000）
const TRANSITIONS = ['none', 'fade', 'push', 'wipe', 'zoom', 'cover'];
const DEFAULT_TRD = 450;                    // 未知/缺失页切换时长（§7）
const STEP_FADE_MS = 140;                   // 同页切步淡入（契约要求 ≤160ms）
const UPLOAD_ERR = '上传中断，请重试';       // §4.2 规定的失败原因（页面据此判断「重新上传」）

/* ---- v1.2「原样播放」+ 续播（契约 §11.1/§11.3/§11.4；2026-11-10 增量） ---- */
const MODE_VIDEO = 'video';                 // 原样播放（manifest.video）
const MODE_STEP = 'step';                   // 分步浏览（图片 + step + 热点）
const V_RATES = [1, 1.25, 1.5, 2];          // 倍速循环 1× → 1.25× → 1.5× → 2×（§11.3.2）
const V_START_TIMEOUT_MS = 5000;            // 直连 5s 内未起播 → wx.downloadFile（§11.4）
const V_CTRL_HIDE_MS = 3000;                // 原样播放控制条 3s 自动隐藏（§11.3.2）
const RESUME_TTL_MS = 7 * 24 * 3600 * 1000; // 「继续」徽标 7 天有效（§11.3.4）
const RESUME_MIN_SEC = 5;                   // 视频位置 >5s 才算有进度（§11.3.4）
const RESUME_END_RATIO = 0.95;              // 视频 <95% 才算未到末尾（§11.3.4）
const RESUME_MAX = 100;                     // 本机最多记 100 个 deck，防存储膨胀
const RESUME_KEY = 'zq_ppt_resume_v1';      // 本机续播表 {deckId:{mode,page,step,idx,t,at,dur,pt,n}}
const MODE_KEY = 'zq_ppt_mode_v1';          // 本机模式偏好 {deckId:'video'|'step'}（设备偏好，不进 UD 同步）
const V_STAGE = { direct: 'direct', download: 'download', temp: 'temp', step: 'step' };
const PAGE_SIZE = 100;                      // 列表 limit=100（§4.4）
const LIST_SELECT = 'select=id,title,owner_sid,owner_name,status,progress,error,slide_count,step_count,'
  + 'aspect,cover_url,source_name,source_size,created_at,converted_at,client'
  + '&deleted=eq.false&order=created_at.desc&limit=' + PAGE_SIZE;
// 列表标签用「派生字段」轻查询（§12.4.1：有 files.compat →「兼容版」/ files.pdf →「PDF」；
// 不拉整份 manifest——只取 manifest->files 这一小段 JSON，避免触发 §4.4「列表禁止带 manifest」）
const FILES_SELECT = 'select=id,manifest->files&deleted=eq.false';
// 播放/下载详情：单 deck 清单 + 详情页需要的轻字段（§4.5 + §12；新增字段追加在尾部，保持旧断言兼容）
const MANIFEST_SELECT = 'select=manifest,title,slide_count,step_count,aspect,cover_url,source_name,'
  + 'source_key,converted_at,source_size,owner_sid,owner_name,status,created_at,progress,error';
// 下载中心（§12.2/§12.4）：manifest v2 的文件种类/展示文案/打开方式
const FILE_KINDS = ['compat', 'pdf', 'source'];
const FILE_LABELS = { compat: '兼容版 PPTX', pdf: 'PDF', source: '原始文件' };
const FILES_STORAGE_KEY = 'zq_ppt_files_v1';   // 列表标签本机缓存 {deckId:{compat:bool,pdf:bool,at}}
const FILES_CACHE_MAX = 200;
const DOWNLOAD_OPEN_TYPES = ['pptx', 'ppt', 'pdf', 'doc', 'docx', 'xls', 'xlsx']; // wx.openDocument 支持的 fileType

/* ============================================================
 * A. 小工具（纯函数）
 * ============================================================ */
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
function isNum(v) { const n = Number(v); return isFinite(n); }
function numOr(v, dft) { const n = Number(v); return isFinite(n) ? n : dft; }
function strOf(v) { return v == null ? '' : String(v); }

// 绝对地址：http(s):// 或 data: 直接用；否则拼 base（契约 §5 URL 解析规则，三端一致）
function isAbsUrl(u) { return /^(https?:|data:)/i.test(strOf(u)); }
function joinUrl(base, p) {
  const path = strOf(p);
  if (!path) return '';
  if (isAbsUrl(path)) return path;
  const b = strOf(base);
  if (!b) return path;
  return (b.charAt(b.length - 1) === '/' ? b : b + '/') + path.replace(/^\/+/, '');
}
// manifest 的 base/src 也允许写相对路径（转换机正常写绝对地址，这里容错）
function resolveUrl(base, p) { return joinUrl(base, p); }

/* ---- PPT 在线媒体 ECS 缓存映射（2026-11-18 迁移优化；与网页 pptEcsUrl/resolveMediaUrl 同口径） ----
 * OSS 香港 bucket 的 /ppt/** 媒体 → ECS /pptfiles 缓存（网页实测命中 6-11MB/s，OSS 首访 35s）。
 * - 仅映射 host = tool-furina-fun.oss-cn-hongkong.aliyuncs.com 且 pathname 以 /ppt/ 开头的 http(s) 地址；
 *   data:/file:/本地临时路径/其它域名/非 /ppt 路径 → 原样返回（避免误伤外链）；
 * - base 缺省 = cloud-config.webBase + '/pptfiles'；devtools/备案前可设 cloud-config.pptEcs.base 覆盖；
 * - enabled:false → 全部原样（回滚 OSS 直链）。
 * 纯函数（可单测）；编码路径与 ?query 原样保留（Caddy 解码后由缓存服务按 OSS pathname 命中）。 */
const PPT_OSS_HOST = 'tool-furina-fun.oss-cn-hongkong.aliyuncs.com';
function pptEcsBase() {
  const o = CFG.pptEcs || {};
  if (o.enabled === false) return '';
  const custom = strOf(o.base).trim();
  if (custom) return custom.replace(/\/+$/, '');
  const web = strOf(CFG.webBase).trim();
  return web ? web.replace(/\/+$/, '') + '/pptfiles' : '';
}
function pptEcsUrl(u) {
  const s = strOf(u);
  if (!/^https?:\/\//i.test(s)) return s;
  const m = s.match(/^https?:\/\/([^\/?#]+)([^?#]*)(\?[^#]*)?/i);
  if (!m) return s;
  if (m[1].toLowerCase() !== PPT_OSS_HOST) return s;
  const path = m[2] || '';
  if (path.indexOf('/ppt/') !== 0) return s;
  const base = pptEcsBase();
  if (!base) return s;
  return base + path + (m[3] || '');
}
// base + 相对引用 → 绝对 → ECS 映射（manifest 媒体统一走这里）
function mediaUrlOf(base, p) { return pptEcsUrl(joinUrl(base, p)); }

// 文件名 → 去目录、去扩展名（默认标题；≤80 字）
function baseNameOf(name) {
  const s = strOf(name).split(/[\\/]/).pop() || '';
  return s.replace(/\.[^./\\]+$/, '');
}
function extOf(name) {
  const m = strOf(name).match(/\.([A-Za-z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}
function trimTitle(t, fallback) {
  const s = strOf(t).trim();
  if (s) return s.slice(0, TITLE_MAX);
  const f = baseNameOf(strOf(fallback)).trim();
  return (f || '未命名演示').slice(0, TITLE_MAX);
}
function fmtSize(bytes) {
  const n = Math.max(0, numOr(bytes, 0));
  if (n < 1024) return n + 'B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + 'KB';
  return (n / 1024 / 1024).toFixed(1) + 'MB';
}
function fmtWhen(ms) {
  const t = numOr(ms, 0);
  if (!t) return '';
  const d = new Date(t);
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
// 媒体时长 → "m:ss"（视频热点角标「视频 0:12」DESIGN §4.7）
function fmtDur(sec) {
  const s = Math.max(0, Math.round(numOr(sec, 0)));
  return Math.floor(s / 60) + ':' + pad2(s % 60);
}

/* ============================================================
 * B. deckId / 文件校验 / 分片几何（纯函数；RLS 建行字段见 §4.1）
 * ============================================================ */
const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
function randAlnum(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALNUM.charAt(Math.floor(Math.random() * ALNUM.length));
  return s;
}
// 客户端生成 deckId：'d' + base36(ts) + 6 位随机小写字母数字（契约 §3.1）
function deckId(at) { return 'd' + (numOr(at, Date.now())).toString(36) + randAlnum(6); }

function chunkCount(size) {
  const n = Math.max(0, Math.round(numOr(size, 0)));
  return n <= 0 ? 0 : Math.ceil(n / CHUNK_SIZE);
}
function chunkRange(size, idx) {
  const total = Math.max(0, Math.round(numOr(size, 0)));
  const i = Math.max(0, Math.round(numOr(idx, 0)));
  const offset = i * CHUNK_SIZE;
  return { offset: offset, length: Math.max(0, Math.min(CHUNK_SIZE, total - offset)) };
}
// 选文件后的校验：只收 .ppt/.pptx、≤64MiB、size>0
function validateFile(file) {
  const f = file || {};
  const name = strOf(f.name);
  const size = Math.round(numOr(f.size, 0));
  const ext = extOf(name);
  if (!name) return { ok: false, reason: '文件名无效' };
  if (EXTS.indexOf(ext) < 0) return { ok: false, reason: '只支持 .ppt / .pptx 文件' };
  if (size <= 0) return { ok: false, reason: '文件为空' };
  if (size > MAX_SOURCE_SIZE) return { ok: false, reason: '文件超过 64MB，转换机无法处理' };
  return { ok: true, name: name, size: size, ext: ext };
}
// 选文件结果 → 规范化文件描述（页面 wx.chooseMessageFile 的 tempFile）
function fileOf(tempFile) {
  const f = tempFile || {};
  const loc = strOf(f.path || f.tempFilePath);
  const file = { path: loc, name: strOf(f.name) || (loc.split(/[\\/]/).pop() || ''), size: Math.round(numOr(f.size, 0)) };
  const v = validateFile(file);
  file.ok = v.ok;
  file.reason = v.reason || '';
  return file;
}
// 建行数据（契约 §4.1；owner_sid 必须=自己，RLS 校验）——纯函数便于单测断言字段
function deckRow(opts) {
  const o = opts || {};
  const now = numOr(o.now, Date.now());
  const size = Math.max(0, Math.round(numOr(o.sourceSize, 0)));
  const srcName = strOf(o.sourceName).slice(0, 200);
  return {
    id: strOf(o.deckId),
    title: trimTitle(o.title, srcName),
    owner_sid: strOf(o.sid),
    owner_name: strOf(o.ownerName),
    client: CLIENT,
    status: 'uploading',
    source_name: srcName,
    source_size: size,
    chunk_count: chunkCount(size),
    created_at: now,
    updated_at: now,
    deleted: false
  };
}
function uploadPct(done, total) {
  const t = Math.max(0, Math.round(numOr(total, 0)));
  if (!t) return 0;
  return clamp(Math.round(Math.round(numOr(done, 0)) / t * 100), 0, 100);
}

/* ============================================================
 * C. manifest v1 归一化 + URL 解析（纯函数；契约 §5）
 * ============================================================ */
function normTransition(tr) {
  const t = strOf(tr).toLowerCase();
  return TRANSITIONS.indexOf(t) >= 0 ? t : 'fade';
}
function normTrd(v) {
  const n = numOr(v, 0);
  if (n <= 0) return DEFAULT_TRD;
  return clamp(Math.round(n), 120, 2000);
}
// 媒体条目（热点）：坐标 0..1；k 只认 'v'/'a'（未知按视频）
// 注意：归一化后仍保留原始 s，并把全局媒体表的 url/dur/w/h 合并进来（见 normManifest）
function normMedia(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = strOf(raw.s);
  if (!s) return null;
  return {
    s: s,
    k: strOf(raw.k) === 'a' ? 'a' : 'v',
    x: clamp(numOr(raw.x, 0), 0, 1),
    y: clamp(numOr(raw.y, 0), 0, 1),
    w: clamp(numOr(raw.w, 1), 0, 1),
    h: clamp(numOr(raw.h, 1), 0, 1)
  };
}
// 全局媒体表条目：{s,k,w,h,dur}（不放坐标；坐标在 steps[].media 里）
function normMediaRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = strOf(raw.s);
  if (!s) return null;
  return { s: s, k: strOf(raw.k) === 'a' ? 'a' : 'v', w: numOr(raw.w, 0), h: numOr(raw.h, 0), dur: numOr(raw.dur, 0) };
}
function normStep(raw, base) {
  if (!raw || typeof raw !== 'object') return null;
  const img = strOf(raw.img);
  if (!img) return null;
  const media = (Array.isArray(raw.media) ? raw.media : []).map(normMedia).filter(Boolean);
  return { img: img, url: mediaUrlOf(base, img), media: media };
}
function normSlide(raw, base) {
  if (!raw || typeof raw !== 'object') return null;
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).map(function (s) { return normStep(s, base); }).filter(Boolean);
  if (!steps.length) return null;   // 至少 1 个 step（契约 §5）
  const thumb = strOf(raw.thumb);
  return {
    tr: normTransition(raw.tr),
    trd: normTrd(raw.trd),
    notes: strOf(raw.notes).slice(0, NOTES_MAX),
    thumb: thumb,
    thumbUrl: thumb ? mediaUrlOf(base, thumb) : steps[0].url,   // 缩略图缺省用第一步 img（§5）
    steps: steps
  };
}
// 归一化播放/下载清单（v1 旧 deck 与 v2 compat deck 都收）：
//   * v1：slides 必需（旧分步/视频 deck）；
//   * v2（§12.2）：compat 模式 slides 可为空数组，只要 files 存在即合法；两者都无 → 还没转换完成 → null；
//   * 未知字段忽略、坏数据容错，缺失字段用默认值（不白屏）。
function normManifest(raw) {
  let m = raw;
  if (typeof m === 'string') { try { m = JSON.parse(m); } catch (e) { m = null; } }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const base = strOf(m.base);
  const files = normFiles(m.files, base);
  const compat = normCompat(m.compat);
  const video = normVideo(m.video, base);
  const hasFiles = !!(files.compat || files.pdf || files.source);
  const mediaFiles = normMediaFiles(m.media_files, base);   // §12.8 视频/音频单独下载
  const slides = (Array.isArray(m.slides) ? m.slides : []).map(function (s) { return normSlide(s, base); }).filter(Boolean);
  // v1 旧 deck 可能只有 video（无分步图）→ 仍可在线预览；v2.3 可能只有 media_files；都没有 → 还没转换完成
  if (!slides.length && !hasFiles && !video && !mediaFiles.length) return null;
  // 全局媒体表：按 s 索引；缺 w/h/dur 用 0
  const media = (Array.isArray(m.media) ? m.media : []).map(normMediaRow).filter(Boolean);
  const mediaMap = {};
  media.forEach(function (x) { mediaMap[x.s] = x; });
  // 把全局媒体的 URL / 时长合并到各 step 的热点上（同一 s 可被多处引用）
  slides.forEach(function (sl) {
    sl.steps.forEach(function (st) {
      st.media.forEach(function (h) {
        const g = mediaMap[h.s] || null;
        h.url = mediaUrlOf(base, h.s);
        h.dur = g ? g.dur : 0;
        h.mw = g ? g.w : 0;
        h.mh = g ? g.h : 0;
      });
    });
  });
  return {
    v: Math.max(1, Math.round(numOr(m.v, hasFiles ? 2 : 1))),
    base: base,
    src: mediaUrlOf(base, m.src),
    w: clamp(Math.round(numOr(m.w, 1600)), 320, 4096),
    h: clamp(Math.round(numOr(m.h, 900)), 180, 4096),
    slides: slides,
    media: media,
    video: video,                        // v1.2 可选原样播放视频（缺失 → null，回退分步；§11.1）
    files: files,                        // §12.2 下载文件（旧 deck 全 null）
    compat: compat,                      // §12.2 兼容提示
    media_files: mediaFiles,             // §12.8 视频/音频单独下载（无则 []）
    hasFiles: hasFiles,
    hasMediaFiles: mediaFiles.length > 0,
    stepTotal: flatStepsOf(slides).length
  };
}
function stepCountOf(slide) { return (slide && Array.isArray(slide.steps)) ? slide.steps.length : 0; }

/* ============================================================
 * C2. manifest v2 下载文件 / 兼容提示 / 详情视图 / 列表标签（契约 §12）
 * ============================================================ */
// 单个下载文件（§12.2 files.<kind>；s 相对 base，size/sha256/name/ext/pages 容错）
function normFileRow(raw, base, kind) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = strOf(raw.s).trim();
  if (!s) return null;
  const size = Math.max(0, Math.round(numOr(raw.size, 0)));
  const ext = strOf(raw.ext).toLowerCase();
  return {
    kind: strOf(kind),
    s: s,
    url: mediaUrlOf(base, s),
    size: size,
    sizeText: size > 0 ? fmtSize(size) : '',
    sha256: strOf(raw.sha256),
    ext: ext,
    pages: Math.max(0, Math.round(numOr(raw.pages, 0))),
    name: strOf(raw.name)
  };
}
function normFiles(raw, base) {
  const out = { compat: null, pdf: null, source: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  FILE_KINDS.forEach(function (k) { out[k] = normFileRow(raw[k], base, k); });
  return out;
}
// §12.8 视频/音频单独下载：manifest.media_files 单项（s 相对 base；kind video/audio；dur/w/h/slides/size/sha256/name）
function normMediaFile(raw, base) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = strOf(raw.s).trim();
  if (!s) return null;
  const kind = strOf(raw.kind) === 'audio' ? 'audio' : 'video';
  const size = Math.max(0, Math.round(numOr(raw.size, 0)));
  const dur = Math.max(0, numOr(raw.dur, 0));
  const slides = (Array.isArray(raw.slides) ? raw.slides : [])
    .map(function (x) { return Math.round(numOr(x, 0)); })
    .filter(function (x) { return x > 0; })
    .slice(0, 20);
  const name = strOf(raw.name) || (s.split('/').pop() || '');
  const ext = extOf(name) || extOf(s) || (kind === 'audio' ? 'm4a' : 'mp4');
  return {
    kind: kind,
    s: s,
    url: mediaUrlOf(base, s),
    name: name,
    size: size,
    sizeText: size > 0 ? fmtSize(size) : '',
    sha256: strOf(raw.sha256),
    dur: dur,
    durText: dur > 0 ? fmtDur(dur) : '',
    w: Math.max(0, Math.round(numOr(raw.w, 0))),
    h: Math.max(0, Math.round(numOr(raw.h, 0))),
    slides: slides,
    src: strOf(raw.src),
    ext: ext
  };
}
// media_files 数组（契约 §12.8 上限 ≤20 个文件 / 单文件 ≤200MiB；客户端只做容错与上限保护）
function normMediaFiles(raw, base) {
  return (Array.isArray(raw) ? raw : [])
    .map(function (x) { return normMediaFile(x, base); })
    .filter(Boolean)
    .slice(0, 20);
}
// §12.8 客户端行数据（供 pages/pptdl 渲染 + 单测）：
//   [{key,no,kind,label:'视频1 · 第 7 页',pageText,specText:'2:30 · 1024×576',sizeText,metaText,name,url,ext,...}]
//   序号按类型分别从 1 开始（视频1/视频2/音频1…）；同名媒体多页 → 「第 7、12 页」；文件名用 f.name。
function mediaRows(manifest) {
  const m = manifest || {};
  const list = (Array.isArray(m.media_files) ? m.media_files : []).filter(Boolean);
  let vNo = 0, aNo = 0;
  return list.map(function (f, i) {
    const isVideo = strOf(f.kind) !== 'audio';
    const no = isVideo ? (++vNo) : (++aNo);
    const kindLabel = isVideo ? '视频' : '音频';
    const pages = Array.isArray(f.slides) ? f.slides : [];
    const pageText = pages.length ? ('第 ' + pages.slice(0, 3).join('、') + (pages.length > 3 ? '…' : '') + ' 页') : '';
    const spec = [];
    if (f.durText) spec.push(f.durText);
    if (isVideo && f.w > 0 && f.h > 0) spec.push(f.w + '×' + f.h);
    const specText = spec.join(' · ');
    const metaParts = [];
    if (specText) metaParts.push(specText);
    if (f.sizeText) metaParts.push(f.sizeText);
    return {
      key: 'media' + (i + 1),
      index: i,
      no: no,
      kind: isVideo ? 'video' : 'audio',
      kindLabel: kindLabel,
      isVideo: isVideo,
      isAudio: !isVideo,
      label: kindLabel + no + (pageText ? ' · ' + pageText : ''),
      pageText: pageText,
      slides: pages,
      dur: numOr(f.dur, 0),
      durText: strOf(f.durText),
      resText: (isVideo && f.w > 0 && f.h > 0) ? (f.w + '×' + f.h) : '',
      specText: specText,
      size: numOr(f.size, 0),
      sizeText: strOf(f.sizeText),
      metaText: metaParts.join(' · '),
      name: strOf(f.name),
      url: strOf(f.url),
      ext: strOf(f.ext),
      sha256: strOf(f.sha256),
      media: true
    };
  });
}
// 兼容提示（§12.2 compat）：warnings 中文短句逐条展示；fonts_embedded/converted_from 仅数据
function normCompat(raw) {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const warnings = (Array.isArray(o.warnings) ? o.warnings : [])
    .map(function (w) { return strOf(w).trim(); })
    .filter(Boolean)
    .slice(0, 20);
  return {
    warnings: warnings,
    fontsEmbedded: Math.max(0, Math.round(numOr(o.fonts_embedded, 0))),
    convertedFrom: strOf(o.converted_from)
  };
}
// 安全下载文件名：去路径/非法字符、截断 120 字、确保扩展名（§12.2 name 为建议文件名）
function safeFileName(name, fallbackTitle, ext) {
  const e = strOf(ext).toLowerCase().replace(/[^a-z0-9]/g, '') || 'pptx';
  let base = strOf(name).trim().split(/[\\/]/).pop() || '';
  const cur = extOf(base);
  base = base.replace(/\.[A-Za-z0-9]+$/, '');   // 去原扩展名，统一用 e
  base = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim();
  if (!base) base = strOf(fallbackTitle).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim();
  if (!base) base = '演示文件';
  base = base.slice(0, 120);
  return base + '.' + e;
}
// 文件可用的打开方式（wx.openDocument fileType；未知按 ext 兜底）
function openTypeOf(ext) {
  const e = strOf(ext).toLowerCase();
  if (e === 'pdf') return 'pdf';
  if (e === 'ppt') return 'ppt';
  if (e === 'pptx') return 'pptx';
  return DOWNLOAD_OPEN_TYPES.indexOf(e) >= 0 ? e : 'pptx';
}
// 下载行（§12.4.1）：兼容版 PPTX / PDF（页数）/ 原始文件，显示大小；旧 deck 无 files 时给原始文件行（若有 src）
// opts: {title, deck}
function fileRows(manifest, opts) {
  const o = opts || {};
  const m = manifest || {};
  const files = m.files || {};
  const title = strOf(o.title);
  const rows = [];
  FILE_KINDS.forEach(function (k) {
    const f = files[k];
    if (!f || !f.url) return;
    const ext = f.ext || (k === 'pdf' ? 'pdf' : (extOf(f.name) || 'pptx'));
    const label = FILE_LABELS[k] + (k === 'pdf' && f.pages > 0 ? ' · ' + f.pages + ' 页' : '');
    rows.push({
      key: k,
      label: label,
      url: f.url,
      size: f.size,
      sizeText: f.sizeText,
      name: safeFileName(f.name, title, ext),
      ext: ext,
      openType: openTypeOf(ext),
      sha256: f.sha256,
      legacy: false
    });
  });
  // 旧 deck（无 files）：manifest.src 仍可下载原件（§12.6 旧 deck 仍可下载原始）
  if (!rows.length && m.src) {
    const ext = extOf(m.src) || 'pptx';
    rows.push({
      key: 'source',
      label: FILE_LABELS.source,
      url: m.src,
      size: 0,
      sizeText: '',
      name: safeFileName('', title, ext),
      ext: ext,
      openType: openTypeOf(ext),
      sha256: '',
      legacy: true
    });
  }
  return rows;
}
// 下载详情页视图（§12.4.1 / §12.4.3）：文件行 + 兼容提示 + 旧 deck 提示 + 在线预览入口 + 状态
// opts: {mine, admin}（重新处理按钮仅本人/管理员可见，否则 RLS 会拒）
function downloadDetailView(manifest, deck, opts) {
  const d = deck || {};
  const o = opts || {};
  const m = manifest || null;
  const files = (m && m.files) || { compat: null, pdf: null, source: null };
  const compat = (m && m.compat) || { warnings: [], fontsEmbedded: 0, convertedFrom: '' };
  const title = strOf(d.title) || '演示';
  const rows = m ? fileRows(m, { title: title }) : [];
  const media = mediaRows(m);                      // §12.8 视频/音频单独下载分组
  const mediaVideos = media.filter(function (x) { return x.isVideo; }).length;
  const mediaAudios = media.length - mediaVideos;
  const slides = (m && Array.isArray(m.slides)) ? m.slides.length : 0;
  const canPreview = !!(m && (slides > 0 || m.video));
  const status = strOf(d.status) || 'ready';
  const pages = Math.round(numOr(d.slide_count, slides));
  const owner = strOf(d.owner_name) || '同学';
  const sizeOf = function (k) { return files[k] ? files[k].size : 0; };
  const totalSize = Math.max(sizeOf('compat'), sizeOf('pdf'), sizeOf('source')) || numOr(d.source_size, 0);
  const metaParts = [];
  if (pages > 0) metaParts.push(pages + ' 页');
  if (totalSize > 0) metaParts.push(fmtSize(totalSize));
  metaParts.push(owner);
  return {
    hasManifest: !!m,
    title: title,
    owner: owner,
    meta: metaParts.join(' · '),
    // 封面 cover_url 也走 ECS /pptfiles 缓存（2026-11-18 P4；详情页与列表/播放器同 helper）
    cover: pptEcsUrl(strOf(d.cover_url)),
    statusKey: status,
    statusText: statusTextOf(status, d),
    isReady: status === 'ready' && !!m,
    rows: rows,
    mediaRows: media,                    // §12.8 仅 media_files 非空
    hasMedia: media.length > 0,
    mediaCount: media.length,
    mediaVideos: mediaVideos,
    mediaAudios: mediaAudios,
    hasCompat: !!files.compat,
    hasPdf: !!files.pdf,
    hasSource: !!files.source,
    missingCompat: !!m && !files.compat,
    legacy: !!m && !files.compat && !files.pdf,   // 旧 deck：兼容版未生成（§12.4.3）
    warnings: compat.warnings,
    hasWarnings: compat.warnings.length > 0,
    fontsEmbedded: compat.fontsEmbedded,
    convertedFrom: compat.convertedFrom,
    canPreview: canPreview,
    allowRetry: !!(o.mine || o.admin),   // 「重新处理」仅本人/管理员（RLS 限制）
    sourceName: strOf(d.source_name),
    convertedAt: numOr(d.converted_at, 0)
  };
}
// 状态文案（详情页用；沿用 §8.1 短文案）
function statusTextOf(status, deck) {
  const d = deck || {};
  const s = strOf(status);
  if (s === 'ready') return '';
  if (s === 'uploading') return '上传中';
  if (s === 'queued') return '排队转换';
  if (s === 'processing') return '转换中 ' + clamp(Math.round(numOr(d.progress, 0)), 0, 100) + '%';
  if (s === 'failed') return '转换失败';
  return '处理中';
}
// 列表标签（§12.4.1）：有 files.compat →「兼容版」，files.pdf →「PDF」
function tagsOf(files) {
  const f = files || {};
  return { tagCompat: !!f.compat, tagPdf: !!f.pdf };
}
// ---- 本机文件标签缓存（列表标签；打开详情/轻查询后写入，离线/JSON-path 不可用时兜底）----
let _filesCache = null;
function filesCacheRead() {
  if (_filesCache) return _filesCache;
  let map = {};
  try {
    let v = wx.getStorageSync(FILES_STORAGE_KEY);
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = null; } }
    if (v && typeof v === 'object' && !Array.isArray(v)) map = v;
  } catch (e) { map = {}; }
  _filesCache = map;
  return map;
}
function filesCacheWrite(map) {
  _filesCache = map;
  try { wx.setStorageSync(FILES_STORAGE_KEY, map); } catch (e) { /* ignore */ }
}
// 记录某 deck 的 files 信息（详情页拿到 manifest 后调用）
function rememberFiles(deckIdIn, files) {
  const id = strOf(deckIdIn);
  if (!id) return;
  const f = files || {};
  const map = filesCacheRead();
  map[id] = { compat: !!f.compat, pdf: !!f.pdf, at: Date.now() };
  const keys = Object.keys(map);
  if (keys.length > FILES_CACHE_MAX) {
    keys.sort(function (a, b) { return numOr(map[a].at, 0) - numOr(map[b].at, 0); });
    while (keys.length > FILES_CACHE_MAX) delete map[keys.shift()];
  }
  filesCacheWrite(map);
}
// 本机标签缓存视图 {deckId:{compat,pdf}}
function filesMap() {
  const map = filesCacheRead();
  const out = {};
  Object.keys(map).forEach(function (id) {
    const v = map[id] || {};
    out[id] = { compat: !!v.compat, pdf: !!v.pdf, at: numOr(v.at, 0) };
  });
  return out;
}
// 批量轻查询 files（§12.4.1 标签；只取 manifest->files 派生字段，不拉整份清单）：
//   成功 → {ok:true, map:{id:{compat,pdf}}}；失败/云不可用 → {ok:false, map: 本机缓存}（不报错、不阻塞列表）
function filesOfDecks(ids) {
  const list = (Array.isArray(ids) ? ids : []).map(function (x) { return strOf(x); }).filter(Boolean);
  const cached = filesMap();
  if (!list.length || !cloud.isEnabled()) return Promise.resolve({ ok: false, map: cached });
  const q = FILES_SELECT + '&id=in.(' + list.map(function (id) { return encodeURIComponent(id); }).join(',') + ')';
  return cloud.cbGet(tblDecks(), q)
    .then(function (rows) {
      const map = filesMap();
      (Array.isArray(rows) ? rows : []).forEach(function (row) {
        if (!row || !row.id) return;
        const f = (row.files && typeof row.files === 'object') ? row.files : {};
        map[strOf(row.id)] = { compat: !!f.compat, pdf: !!f.pdf, at: Date.now() };
      });
      // 只保留轻量字段回写（不缓存整对象）
      const store = {};
      Object.keys(map).forEach(function (id) { store[id] = { compat: !!map[id].compat, pdf: !!map[id].pdf, at: numOr(map[id].at, 0) }; });
      filesCacheWrite(store);
      return { ok: true, map: map };
    })
    .catch(function () { return { ok: false, map: filesMap() }; });
}

/* ============================================================
 * D. step 序列 / 页码换算 / 进度 / 热点矩形（纯函数；契约 §5/§8.1）
 * ============================================================ */
// 扁平 step 序列：[{p, s, img, url, media, slide}]；播放器所有「上一步/下一步」都基于它
function flatStepsOf(slides) {
  const out = [];
  (Array.isArray(slides) ? slides : []).forEach(function (sl, p) {
    (sl && Array.isArray(sl.steps) ? sl.steps : []).forEach(function (st, s) {
      out.push({ p: p, s: s, img: st.img, url: st.url, media: st.media || [], slide: sl });
    });
  });
  return out;
}
function flatSteps(manifest) {
  if (!manifest || !Array.isArray(manifest.slides)) return [];
  return flatStepsOf(manifest.slides);
}
// (页,步) → 扁平下标；找不到返回 -1
function posOf(manifest, p, s) {
  const flat = flatSteps(manifest);
  for (let i = 0; i < flat.length; i++) if (flat[i].p === p && flat[i].s === s) return i;
  return -1;
}
// 前进/后退 delta 步：越界返回 -1（播放器据此判断是否到边界）
function advance(flat, idx, delta) {
  if (!Array.isArray(flat) || !flat.length) return -1;
  const j = Math.round(numOr(idx, 0)) + Math.round(numOr(delta, 1));
  return (j >= 0 && j < flat.length) ? j : -1;
}
// 某页第一步的扁平下标（缩略图跳页用）
function pageStart(manifest, p) {
  const flat = flatSteps(manifest);
  for (let i = 0; i < flat.length; i++) if (flat[i].p === p) return i;
  return -1;
}
function progressPct(idx, total) {
  const t = Math.max(0, Math.round(numOr(total, 0)));
  if (!t) return 0;
  return clamp(Math.round((Math.round(numOr(idx, -1)) + 1) / t * 1000) / 10, 0, 100);
}
// 控制条文案「3/12 · 2/3」（页/步；单步页只显示页）
function posText(p, s, pageTotal, stepTotal) {
  const pt = Math.max(1, Math.round(numOr(pageTotal, 1)));
  const st = Math.max(1, Math.round(numOr(stepTotal, 1)));
  const pp = clamp(Math.round(numOr(p, 0)) + 1, 1, pt);
  const ss = clamp(Math.round(numOr(s, 0)) + 1, 1, st);
  return st > 1 ? (pp + '/' + pt + ' · ' + ss + '/' + st) : (pp + '/' + pt);
}
// 播放器当前帧视图（wxml 直接绑定的字段；不依赖 wx）
function viewAt(manifest, i) {
  const flat = flatSteps(manifest);
  if (!flat.length) return null;
  const idx = clamp(Math.round(numOr(i, 0)), 0, flat.length - 1);
  const it = flat[idx];
  const pageTotal = manifest.slides.length;
  const stepTotal = stepCountOf(it.slide);
  // 页内步点（DESIGN §4.4：仅当前页 step≥2 时显示；当前白、其余 .35）
  const dots = [];
  if (stepTotal >= 2) {
    for (let k = 0; k < stepTotal; k++) dots.push({ on: k === it.s, k: k });
  }
  return {
    idx: idx,
    page: it.p + 1,
    step: it.s + 1,
    pageTotal: pageTotal,
    stepTotal: flat.length,
    posText: posText(it.p, it.s, pageTotal, stepTotal),
    progressPct: progressPct(idx, flat.length),
    img: it.url,
    notes: it.slide.notes || '',
    hasNotes: !!it.slide.notes,
    tr: it.slide.tr,
    trd: it.slide.trd,
    hotspots: it.media || [],
    thumbUrl: it.slide.thumbUrl,
    stepInPage: stepTotal,
    stepNoInPage: it.s + 1,
    dots: dots,
    showDots: dots.length > 0,
    pageText: (it.p + 1) + ' / ' + pageTotal
  };
}
// 图片 letterbox 适配矩形（在 winW×winH 的舞台内居中 contain；返回 px）
function fitRect(winW, winH, mw, mh) {
  const W = Math.max(1, numOr(winW, 390));
  const H = Math.max(1, numOr(winH, 844));
  const mW = Math.max(1, numOr(mw, 1600));
  const mH = Math.max(1, numOr(mh, 900));
  const ar = mW / mH, wr = W / H;
  let w, h;
  if (wr > ar) { h = H; w = h * ar; } else { w = W; h = w / ar; }
  return { left: Math.round((W - w) / 2), top: Math.round((H - h) / 2), width: Math.round(w), height: Math.round(h) };
}
// 热点 → 屏幕 px 矩形（相对幻灯片整页 0..1 归一化坐标，按图片实际渲染区域换算）
function hotRects(mediaList, rect) {
  const r = rect || fitRect(390, 844, 1600, 900);
  return (Array.isArray(mediaList) ? mediaList : []).map(function (m) {
    const x = clamp(numOr(m.x, 0), 0, 1);
    const y = clamp(numOr(m.y, 0), 0, 1);
    const w = clamp(numOr(m.w, 1), 0, 1);
    const h = clamp(numOr(m.h, 1), 0, 1);
    return {
      s: strOf(m.s), k: (m.k === 'a' ? 'a' : 'v'), url: strOf(m.url),
      dur: numOr(m.dur, 0),
      left: Math.round(r.left + x * r.width),
      top: Math.round(r.top + y * r.height),
      width: Math.max(28, Math.round(w * r.width)),
      height: Math.max(28, Math.round(h * r.height))
    };
  });
}
// 播放器热点圆钮（DESIGN §4.7）：热点矩形中心一个圆（视频 48px ▶ / 音频 32px 小喇叭）
// 返回 [{s,k,url,left,top,size,badge,fail}]；left/top 为圆的最左上 px（相对舞台）
function hotButtons(mediaList, rect, opts) {
  const o = opts || {};
  const size = clamp(Math.round(numOr(o.size, 48)), 32, 80);
  const failMap = o.failMap || {};
  return (Array.isArray(mediaList) ? mediaList : []).map(function (m) {
    const one = hotRects([m], rect)[0];
    const sz = one.k === 'a' ? 32 : size;          // 音频不占画面：降级成 32px 小喇叭
    const cx = one.left + one.width / 2;
    const cy = one.top + one.height / 2;
    return {
      s: one.s, k: one.k, url: one.url,
      left: Math.round(cx - sz / 2),
      top: Math.round(cy - sz / 2),
      size: sz,
      badge: one.k === 'a' ? '音频' : ('视频 ' + fmtDur(one.dur)),
      fail: !!failMap[one.s]
    };
  });
}
// 预加载：当前步后 2 张 img（最高优先级；契约 §8.1）
function preloadList(manifest, idx, n) {
  const flat = flatSteps(manifest);
  const out = [];
  const start = Math.round(numOr(idx, 0)) + 1;
  const cnt = n == null ? 2 : Math.max(0, Math.round(numOr(n, 2)));
  for (let i = start; i < flat.length && out.length < cnt; i++) out.push(flat[i].url);
  return out;
}
// 预加载计划（DESIGN §5.1 / §3.2：预加载并发 ≤6；先当前步后 2 张，再相邻页缩略图）
// 返回 { steps: [url...], thumbs: [url...] }
function preloadPlan(manifest, idx) {
  const flat = flatSteps(manifest);
  const i = clamp(Math.round(numOr(idx, 0)), 0, Math.max(0, flat.length - 1));
  const steps = [];
  for (let k = i + 1; k < flat.length && steps.length < 2; k++) steps.push(flat[k].url);
  const thumbs = [];
  const curPage = flat.length ? flat[i].p : 0;
  const pages = (manifest && manifest.slides) || [];
  for (let p = curPage + 1; p < pages.length && thumbs.length < 2; p++) {
    if (pages[p] && pages[p].thumbUrl) thumbs.push(pages[p].thumbUrl);
  }
  return { steps: steps, thumbs: thumbs };
}
// 缩略图抽屉数据：[{p, pageNo, url, text, steps, stepArr}]；steps>1 时抽屉在缩略图下显示步指示
function thumbList(manifest) {
  if (!manifest || !Array.isArray(manifest.slides)) return [];
  return manifest.slides.map(function (sl, i) {
    const n = stepCountOf(sl);
    const arr = [];
    for (let k = 0; k < n; k++) arr.push(k + 1);
    return {
      p: i, pageNo: i + 1, url: sl.thumbUrl, text: String(i + 1),
      steps: n, stepArr: arr, current: false
    };
  });
}

/* ============================================================
 * D2. manifest.video 归一化 / 章节 seek / 模式选择 / 降级链 / 续播（纯函数，契约 §11）
 * ============================================================ */
// 章节刻度（进度条上的点）：t 必须落在 0..dur，按百分比定位
function videoTicksOf(chapters, dur) {
  const d = numOr(dur, 0);
  return (Array.isArray(chapters) ? chapters : []).map(function (c) {
    const t = Math.max(0, numOr(c.t, 0));
    return { i: Math.round(numOr(c.i, 0)), t: t, pct: d > 0 ? clamp(Math.round(t / d * 1000) / 10, 0, 100) : 0 };
  });
}
// manifest.video（契约 §11.1）：缺失/坏数据 → null（= 仅分步模式，旧客户端忽略）；未知字段忽略
// 容错：s 必填；w/h/dur 缺省；chapters 只保留合法项，按 t 排序、同页去重、t 单调不减
function normVideo(raw, base) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = (typeof raw.s === 'string') ? raw.s.trim() : '';
  if (!s) return null;
  const dur = Math.max(0, numOr(raw.dur, 0));
  const tmp = [];
  (Array.isArray(raw.chapters) ? raw.chapters : []).forEach(function (c) {
    if (!c || typeof c !== 'object') return;
    const i = Math.round(numOr(c.i, -1));
    const t = numOr(c.t, -1);
    if (i < 0 || !isFinite(t) || t < 0) return;
    tmp.push({ i: i, t: Math.round(t * 100) / 100 });
  });
  tmp.sort(function (a, b) { return a.t - b.t || a.i - b.i; });
  const chapters = [];
  const seen = {};
  let lastT = -1;
  tmp.forEach(function (c) {
    if (seen[c.i]) return;                 // 同一页只保留第一个时间点
    seen[c.i] = true;
    if (c.t < lastT) c.t = lastT;          // 强制单调不减
    lastT = c.t;
    chapters.push({ i: c.i, t: c.t });
  });
  return {
    s: s,
    url: mediaUrlOf(base, s),
    w: clamp(Math.round(numOr(raw.w, 1280)), 1, 8192),
    h: clamp(Math.round(numOr(raw.h, 720)), 1, 8192),
    dur: dur,
    chapters: chapters,
    q: strOf(raw.q),
    ticks: videoTicksOf(chapters, dur)
  };
}
// 视频时间 mm:ss（控制条「mm:ss / mm:ss」；§11.3.2）
function fmtVideoClock(sec) {
  const s = Math.max(0, Math.floor(numOr(sec, 0)));
  const m = Math.floor(s / 60);
  return (m < 10 ? '0' : '') + m + ':' + pad2(s % 60);
}
function videoTimeText(t, dur) { return fmtVideoClock(t) + ' / ' + fmtVideoClock(dur); }
function videoPct(t, dur) {
  const d = numOr(dur, 0);
  if (d <= 0) return 0;
  return clamp(Math.round(numOr(t, 0) / d * 1000) / 10, 0, 100);
}
// 当前播放时间落在第几个章节（返回 chapters 数组下标；早于第一个章节 → -1）
function videoChapterAt(video, t) {
  const ch = (video && Array.isArray(video.chapters)) ? video.chapters : [];
  const tt = numOr(t, 0);
  let idx = -1;
  for (let i = 0; i < ch.length; i++) {
    if (ch[i].t <= tt + 0.05) idx = i;
    else break;
  }
  return idx;
}
// 当前时间对应页码（slides 下标 0-based；无章节 → -1）
function videoPageOf(video, t) {
  const at = videoChapterAt(video, t);
  const ch = (video && Array.isArray(video.chapters)) ? video.chapters : [];
  return at < 0 ? -1 : ch[at].i;
}
// 章节 seek 目标（§11.3.2：seek 到 chapters[i].t + 0.05，clamp [0, dur-0.05]；找不到页 → -1）
function videoSeekTarget(video, page) {
  const p = Math.round(numOr(page, -1));
  if (p < 0) return -1;
  const ch = (video && Array.isArray(video.chapters)) ? video.chapters : [];
  let t = -1;
  for (let i = 0; i < ch.length; i++) {
    if (ch[i].i === p) { t = ch[i].t; break; }
  }
  if (t < 0) return -1;
  const target = t + 0.05;
  const dur = numOr(video && video.dur, 0);
  return dur > 0 ? clamp(target, 0, Math.max(0, dur - 0.05)) : Math.max(0, target);
}
// 上一页/下一页（按章节，不是 ±10s；§11.3.2）：返回 {page,t,index}；到边界 → null
function videoPrevNext(video, t, dir) {
  const ch = (video && Array.isArray(video.chapters)) ? video.chapters : [];
  if (!ch.length) return null;
  const at = videoChapterAt(video, t);
  const j = at + (Math.round(numOr(dir, 1)) >= 0 ? 1 : -1);
  if (j < 0 || j >= ch.length) return null;
  return { page: ch[j].i, t: Math.max(0, ch[j].t + 0.05), index: j };
}
// 默认模式（§11.3.1）：无 video → 分步；用户设备偏好优先；弱网(2g/3g/none) → 分步；
// wifi/4g/5g/unknown（无法判断时按网络良好，失败再降级）→ 原样
function chooseMode(opts) {
  const o = opts || {};
  if (!o.hasVideo) return MODE_STEP;
  const pref = strOf(o.pref);
  if (pref === MODE_VIDEO || pref === MODE_STEP) return pref;
  const nt = strOf(o.networkType).toLowerCase();
  if (nt === '2g' || nt === '3g' || nt === 'none') return MODE_STEP;
  return MODE_VIDEO;
}
// 降级链状态机（§11.4）：direct → (error/timeout) → download → (ok) → temp → (error) → step
// 事件：direct-error|direct-timeout|download-ok|download-fail|temp-error|play-ok|reset
// 返回 {stage, action, toast}；action = play-direct|download|play-temp|fallback-step|ok|none
function videoStageNext(stage, event) {
  const st = strOf(stage) || V_STAGE.direct;
  const ev = strOf(event);
  if (ev === 'reset') return { stage: V_STAGE.direct, action: 'play-direct', toast: '' };
  if (ev === 'play-ok') return { stage: st, action: 'ok', toast: '' };
  if (st === V_STAGE.direct) {
    if (ev === 'direct-error' || ev === 'direct-timeout') {
      return { stage: V_STAGE.download, action: 'download', toast: '' };
    }
    return { stage: st, action: 'none', toast: '' };
  }
  if (st === V_STAGE.download) {
    if (ev === 'download-ok') return { stage: V_STAGE.temp, action: 'play-temp', toast: '' };
    if (ev === 'download-fail') {
      return { stage: V_STAGE.step, action: 'fallback-step', toast: '网络不佳，已切换分步浏览', hint: '下载失败 · 需配置 OSS 域名' };
    }
    return { stage: st, action: 'none', toast: '' };
  }
  if (st === V_STAGE.temp) {
    if (ev === 'temp-error') {
      return { stage: V_STAGE.step, action: 'fallback-step', toast: '网络不佳，已切换分步浏览', hint: '' };
    }
    return { stage: st, action: 'none', toast: '' };
  }
  return { stage: V_STAGE.step, action: 'none', toast: '' };
}
// 下载进度（§11.4 降级链显示进度）：total 未知 → -1（显示「下载中…」）
function downloadPct(loaded, total) {
  const t = numOr(total, 0);
  if (t <= 0) return -1;
  return clamp(Math.round(numOr(loaded, 0) / t * 100), 0, 100);
}
function downloadText(pct) {
  const p = Math.round(numOr(pct, -1));
  return p < 0 ? '下载中…' : ('下载 ' + p + '%');
}
// 倍速（§11.3.2：1× / 1.25× / 1.5× / 2× 循环）
function nextRate(rate) {
  const r = numOr(rate, 1);
  for (let i = 0; i < V_RATES.length; i++) if (V_RATES[i] === r) return V_RATES[(i + 1) % V_RATES.length];
  return V_RATES[0];
}
function rateText(rate) {
  const r = numOr(rate, 1);
  return (r === Math.round(r) ? String(r) : String(r)) + '×';
}
// 续播记录（§11.3.4）：{mode,page,step,idx,t,at,dur,pt,n}（page/idx 0-based）
function normResume(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {
    mode: strOf(raw.mode) === MODE_VIDEO ? MODE_VIDEO : MODE_STEP,
    page: Math.max(0, Math.round(numOr(raw.page, 0))),
    step: Math.max(0, Math.round(numOr(raw.step, 0))),
    idx: Math.max(0, Math.round(numOr(raw.idx, 0))),
    t: Math.max(0, numOr(raw.t, 0)),
    at: Math.max(0, Math.round(numOr(raw.at, 0))),
    dur: Math.max(0, numOr(raw.dur, 0)),
    pt: Math.max(0, Math.round(numOr(raw.pt, 0))),
    n: Math.max(0, Math.round(numOr(raw.n, 0)))
  };
}
// 7 天内 + 未到末尾（视频 >5s 且 <95%；分步 idx>0 且非末步）→ 可续播/显示「继续」徽标
function resumeValid(saved, now) {
  const r = normResume(saved);
  if (!r || !r.at) return false;
  const t = numOr(now, Date.now());
  if (t - r.at > RESUME_TTL_MS || r.at > t + 60e3) return false;
  if (r.mode === MODE_VIDEO) {
    if (r.t <= RESUME_MIN_SEC) return false;
    if (r.dur > 0 && r.t >= r.dur * RESUME_END_RATIO) return false;
    return true;
  }
  if (r.idx <= 0) return false;
  if (r.n > 0 && r.idx >= r.n - 1) return false;
  return true;
}
function resumeText(saved, now) {
  if (!resumeValid(saved, now)) return '';
  const r = normResume(saved);
  if (r.mode === MODE_VIDEO) return '续播 ' + fmtVideoClock(r.t);
  return '续播 ' + (r.page + 1) + (r.pt > 0 ? '/' + r.pt : '');
}
// ---- 本机存储（wx storage；不进 userdata 云同步） ----
function readStorageMap(key) {
  try {
    let v = wx.getStorageSync(key);
    if (!v) return {};
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { return {}; } }
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  } catch (e) { return {}; }
}
function writeStorageMap(key, map) {
  try { wx.setStorageSync(key, map); return true; } catch (e) { return false; }
}
// 续播表：读取时清理 7 天外记录（列表页一次调用即可）
function resumeAll(now) {
  const map = readStorageMap(RESUME_KEY);
  const t = numOr(now, Date.now());
  const out = {};
  let dirty = false;
  Object.keys(map).forEach(function (id) {
    const r = normResume(map[id]);
    if (!r || !r.at || t - r.at > RESUME_TTL_MS) { delete map[id]; dirty = true; return; }
    out[id] = r;
  });
  if (dirty) writeStorageMap(RESUME_KEY, map);
  return out;
}
function resumeOf(deckIdIn, now) {
  const id = strOf(deckIdIn);
  if (!id) return null;
  return resumeAll(now)[id] || null;
}
function saveResume(deckIdIn, rec) {
  const id = strOf(deckIdIn);
  const r = normResume(rec);
  if (!id || !r) return null;
  r.at = r.at || Date.now();
  const map = readStorageMap(RESUME_KEY);
  map[id] = r;
  const keys = Object.keys(map);
  if (keys.length > RESUME_MAX) {
    keys.sort(function (a, b) { return numOr(map[a].at, 0) - numOr(map[b].at, 0); });
    while (keys.length > RESUME_MAX) delete map[keys.shift()];
  }
  writeStorageMap(RESUME_KEY, map);
  return r;
}
function clearResume(deckIdIn) {
  const id = strOf(deckIdIn);
  if (!id) return;
  const map = readStorageMap(RESUME_KEY);
  if (id in map) { delete map[id]; writeStorageMap(RESUME_KEY, map); }
}
function modeOf(deckIdIn) {
  const id = strOf(deckIdIn);
  if (!id) return '';
  const map = readStorageMap(MODE_KEY);
  const m = strOf(map[id]);
  return (m === MODE_VIDEO || m === MODE_STEP) ? m : '';
}
function saveMode(deckIdIn, mode) {
  const id = strOf(deckIdIn);
  const m = strOf(mode);
  if (!id || (m !== MODE_VIDEO && m !== MODE_STEP)) return '';
  const map = readStorageMap(MODE_KEY);
  map[id] = m;
  writeStorageMap(MODE_KEY, map);
  return m;
}

/* ============================================================
 * E. 列表展示 / 状态文案（契约 §4.4 / §8.1）
 * ============================================================ */
function isMine(deck, sid) {
  const d = deck || {};
  const s = strOf(sid);
  return !!s && strOf(d.owner_sid) === s;
}
// 状态视图：{key, pill, cls, sub, playable, deletable, retryable, show}
// opts: {sid, admin, hb:{known,online}, up:{deckId,pct}}  （up = 本机正在上传的进度）
function statusView(deck, opts) {
  const d = deck || {};
  const o = opts || {};
  const mine = isMine(d, o.sid);
  const admin = !!o.admin;
  const status = strOf(d.status) || 'uploading';
  const up = o.up && o.up.deckId && o.up.deckId === d.id ? o.up : null;
  const hb = o.hb || { known: false, online: false };
  let key = status, pill = '', cls = 'neutral', sub = '', playable = false;
  let deletable = mine || admin, retryable = false, show = true;
  if (status === 'uploading') {
    if (up) {
      const pct = uploadPct(up.done, up.total);
      pill = '上传中 ' + pct + '%';
      cls = 'primary';
      sub = up.total ? (up.done + ' / ' + up.total + ' 片 · ' + fmtSize(d.source_size)) : '';
    } else if (mine) {
      pill = '上传中';
      cls = 'primary';
    } else {
      show = false;   // 别人的上传中不显示（契约 §4.4）
    }
  } else if (status === 'queued') {
    pill = '排队转换';
    cls = 'tertiary';
    sub = (hb.known && !hb.online) ? '转换机离线 · 排队中' : '';
    deletable = mine || admin;
  } else if (status === 'processing') {
    pill = '转换中 ' + clamp(Math.round(numOr(d.progress, 0)), 0, 100) + '%';
    cls = 'primary';
  } else if (status === 'ready') {
    pill = '';                       // DESIGN §4.1：ready 不显示胶囊（只显示页数），减少噪音
    cls = 'ok';
    playable = true;
  } else if (status === 'failed') {
    if (isUploadInterrupted(d.error)) { pill = '上传中断'; }   // DESIGN §4.2：上传失败胶囊写「上传中断」
    else pill = '转换失败';
    cls = 'error';
    sub = strOf(d.error) || '转换失败，可重试';
    retryable = mine || admin;
  } else {
    pill = '未知状态';
    cls = 'neutral';
  }
  return { key: key, pill: pill, cls: cls, sub: sub, playable: playable, deletable: deletable, retryable: retryable, show: show, mine: mine };
}
// 列表卡片视图（wxml 直接绑定；DESIGN §4.1：封面 128×72 + 标题单行 + 元信息「38 页 · 陈子麒」）
function deckView(deck, opts) {
  const d = deck || {};
  const o = opts || {};
  const st = statusView(d, o);
  const mine = isMine(d, o.sid);
  const pages = Math.round(numOr(d.slide_count, 0));
  const meta = pages > 0 ? (pages + ' 页') : (numOr(d.source_size, 0) > 0 ? fmtSize(d.source_size) : '');
  const owner = strOf(d.owner_name) || '同学';
  const ownerText = mine ? (owner + '（我）') : owner;
  const up = o.up && o.up.deckId && o.up.deckId === d.id ? o.up : null;
  const saved = (o.resumeMap && o.resumeMap[strOf(d.id)]) || null;   // 本机续播记录（§11.3.4；播放器预览用）
  const f = (o.filesMap && o.filesMap[strOf(d.id)]) || null;         // 文件标签（§12.4.1）
  const tg = tagsOf(f);
  return {
    id: strOf(d.id),
    title: strOf(d.title) || trimTitle('', d.source_name),
    owner: owner,
    ownerIsMe: mine,
    mine: mine,
    // 封面 cover_url 也走 ECS /pptfiles 缓存（2026-11-18 P4：列表/详情/播放器首帧同口径；data:/外域/空原样）
    cover: pptEcsUrl(strOf(d.cover_url)),
    hasCover: !!strOf(d.cover_url),
    meta: meta + (meta ? ' · ' : '') + ownerText,
    when: fmtWhen(d.created_at),
    statusKey: st.key,
    pill: st.pill,
    hasPill: !!st.pill,
    pillCls: st.cls,
    sub: st.sub,
    hasSub: !!st.sub,
    playable: st.playable,
    deletable: st.deletable,
    retryable: st.retryable,
    show: st.show,
    upPct: up ? uploadPct(up.done, up.total) : 0,
    uploading: st.key === 'uploading' && !!up,
    // v1.2 列表便捷（§11.3.4）：7 天内且未到末尾 → 卡片「继续」小徽标（新下载中心不再展示，保留字段兼容）
    resume: saved,
    resumeShow: resumeBadge(saved, o.now),
    resumeText: resumeText(saved, o.now),
    // §12.4.1 下载中心列表小标签：「兼容版」「PDF」
    tagCompat: tg.tagCompat,
    tagPdf: tg.tagPdf,
    hasTag: !!(tg.tagCompat || tg.tagPdf)
  };
}
// 列表卡片「继续」徽标（§11.3.4：7 天内有效、未到末尾）
function resumeBadge(saved, now) { return resumeValid(saved, now); }
// 排序：本人在传/转换中的置顶，其余 created_at desc（契约 §4.4）
function sortDecks(list, sid) {
  const arr = (Array.isArray(list) ? list.slice() : []);
  arr.sort(function (a, b) {
    const am = isMine(a, sid) && ['uploading', 'queued', 'processing'].indexOf(strOf(a.status)) >= 0;
    const bm = isMine(b, sid) && ['uploading', 'queued', 'processing'].indexOf(strOf(b.status)) >= 0;
    if (am !== bm) return am ? -1 : 1;
    return numOr(b.created_at, 0) - numOr(a.created_at, 0);
  });
  return arr;
}
// 过滤 + 排序 + 视图（列表页一次调用）
function listView(list, opts) {
  const o = opts || {};
  const rows = sortDecks(list, o.sid)
    .map(function (d) { return deckView(d, o); })
    .filter(function (v) { return v.show; });
  return rows;
}
// 转换机心跳视图：seen_at/updated_at 超过 180s → 离线（契约 §3.4）
function hbView(row, now) {
  const t = numOr(now, Date.now());
  if (!row) return { known: false, online: false, offline: false, queued: 0, seenText: '', text: '' };
  let body = row.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  body = body || {};
  const seen = numOr(body.seen_at, 0) || numOr(row.updated_at, 0) || 0;
  const online = !!body.online && seen > 0 && (t - seen) <= HB_OFFLINE_MS;
  return {
    known: true,
    online: online,
    offline: !online,
    queued: Math.max(0, Math.round(numOr(body.queued, 0))),
    seenText: fmtWhen(seen),
    version: strOf(body.version),
    host: strOf(body.host),
    text: online ? '转换机在线' : '转换机离线 · 任务排队中'
  };
}
// 上传失败原因是否属于「上传中断」（重试需重新选文件上传全部分片，契约 §4.2）
function isUploadInterrupted(errorText) { return strOf(errorText).indexOf('上传中断') >= 0; }
function retryMode(deck) { return isUploadInterrupted(deck && deck.error) ? 'reupload' : 'queue'; }

/* ============================================================
 * F. 错误文案（云端 → 中文；页面直接展示，不抛异常）
 * ============================================================ */
function reasonOf(e) {
  if (!e) return '操作失败，请稍后重试';
  if (typeof e === 'string') return reasonOf(new Error(e));
  const m = String((e && (e.message || e.errMsg)) || e || '');
  if (!m) return '操作失败，请稍后重试';
  if (m === 'identity-required') return '身份已过期，请重新进入';
  if (m === 'cloud-disabled') return '云服务未开启';
  if (m.indexOf('http401') === 0 || m.indexOf('http403') === 0) return '身份已过期，请重新进入';
  if (m.indexOf('http413') === 0) return '上传内容过大，请压缩后再试';
  if (m.indexOf('http404') === 0) return '演示不存在或已删除';
  if (/^http5/.test(m)) return '服务暂时不可用，请稍后重试';
  if (/^http4/.test(m)) return '请求被拒绝（' + m + '），请稍后重试';
  return '网络不可用，请检查网络后重试';
}

/* ============================================================
 * G. 云端接口（契约 §4；全部走 utils/cloud.js 统一通道）
 * ============================================================ */
function T(key, dft) {
  const t = (cloud.CONFIG && cloud.CONFIG.tables) || {};
  return strOf(t[key]) || dft;
}
function tblDecks() { return T('pptDecks', 'ppt_decks'); }
function tblChunks() { return T('pptChunks', 'ppt_upload_chunks'); }
function tblAssets() { return T('siteAssets', 'site_assets'); }

// §4.1 建 deck：POST /ppt_decks（Prefer: return=representation）
function createDeck(opts) {
  const o = opts || {};
  const sid = strOf(o.sid || cloud.currentSid());
  if (!sid) return Promise.resolve({ ok: false, reason: '身份已过期，请重新进入' });
  if (!cloud.isEnabled()) return Promise.resolve({ ok: false, reason: '云服务未开启' });
  const row = deckRow({ deckId: o.deckId || deckId(), title: o.title, sourceName: o.sourceName, sourceSize: o.sourceSize, sid: sid, ownerName: o.ownerName || cloud.currentName() });
  if (!row.id) row.id = deckId();
  return cloud.cbPost(tblDecks(), row, { Prefer: 'return=representation' })
    .then(function () { return { ok: true, deckId: row.id, row: row, chunkCount: row.chunk_count }; })
    .catch(function (e) { return { ok: false, reason: reasonOf(e), deckId: row.id }; });
}
// §4.2 上传单分片（upsert；1 片/请求）；base64 已就绪
function sendChunk(opts) {
  const o = opts || {};
  const row = {
    deck_id: strOf(o.deckId),
    owner_sid: strOf(o.ownerSid || cloud.currentSid()),
    idx: Math.max(0, Math.round(numOr(o.idx, 0))),
    data: strOf(o.base64),
    ts: Date.now()
  };
  return cloud.cbPost(tblChunks(), row, { Prefer: 'resolution=merge-duplicates,return=minimal' }, { timeout: 60000 });
}
// 从本地临时文件按 offset/length 读一段并转 base64（512KiB/片）。
// ⚠️ 基础库 3.x 起 `fs.openSync(path, 'r')` 的旧签名已不可用（实测 3.17.4 报
//    "Cannot create property 'filePath' on string ..."；新签名是 openSync({filePath,flag})），
//    因此这里优先用 `readFile({filePath, position, length})`（2.10.0+ 支持分段），
//    失败再按「对象签名 → 旧字符串签名」回退 `openSync/read`；最后兜底整文件读取后自己切片。
function pickChunkBuffer(data, offset, length) {
  const total = data ? (data.byteLength || data.length || 0) : 0;
  if (!total) return null;
  // readFile 已按 position/length 返回：长度正好等于本片
  if (total === length) return data;
  // 旧基础库忽略 position/length（返回整文件）→ 自己切片
  if (total >= offset + length) {
    try {
      if (typeof data.slice === 'function') return data.slice(offset, offset + length);
    } catch (e) { /* fall through */ }
    try {
      const src = new Uint8Array(data);
      const out = new Uint8Array(length);
      out.set(src.subarray(offset, offset + length));
      return out.buffer;
    } catch (e) { return null; }
  }
  return null;
}
function readChunkBase64(path, offset, length) {
  return new Promise(function (resolve, reject) {
    let fs = null;
    try { fs = wx.getFileSystemManager(); } catch (e) { reject(new Error('file-fs')); return; }
    let settled = false;
    const done = function (buf) {
      if (settled || !buf) return;
      settled = true;
      try { resolve(wx.arrayBufferToBase64(buf)); } catch (e) { reject(new Error('file-base64')); }
    };
    const failWith = function () { if (!settled) { settled = true; reject(new Error('file-read')); } };
    const tryOpenRead = function () {
      if (settled) return;
      const finishRead = function (fd) {
        const buf = new ArrayBuffer(length);
        try {
          fs.read({
            fd: fd, arrayBuffer: buf, offset: 0, length: length, position: offset,
            success: function () { try { fs.closeSync && fs.closeSync(fd); } catch (e) { } done(buf); },
            fail: function () { try { fs.closeSync && fs.closeSync(fd); } catch (e) { } failWith(); }
          });
        } catch (e) {
          try { fs.closeSync && fs.closeSync(fd); } catch (e2) { }
          failWith();
        }
      };
      let fd = null;
      try { fd = fs.openSync({ filePath: path, flag: 'r' }); } catch (e1) {
        try { fd = fs.openSync(path, 'r'); } catch (e2) { return failWith(); }
      }
      if (fd === null || fd === undefined) return failWith();
      finishRead(fd);
    };
    // 1) 首选 readFile + position/length（新基础库稳定；老基础库会返回整文件，由 pickChunkBuffer 切片）
    if (typeof fs.readFile === 'function') {
      try {
        fs.readFile({
          filePath: path, position: offset, length: length,
          success: function (r) {
            const picked = pickChunkBuffer(r && r.data, offset, length);
            if (picked) done(picked); else tryOpenRead();
          },
          fail: function () { tryOpenRead(); }
        });
        return;
      } catch (e) { /* fall through */ }
    }
    tryOpenRead();
  });
}

// 并发任务池（纯逻辑，可注入 run/sleep；Node 单测覆盖）：
//   total 个任务、并发 ≤ concurrency、每个任务失败重试 retry 次（退避 backoff）、
//   isCancelled() 为 true 时停止派发并把在途任务结果丢弃 → resolve {ok:false, cancelled:true}
function runPool(opts) {
  const o = opts || {};
  const total = Math.max(0, Math.round(numOr(o.total, 0)));
  const concurrency = clamp(Math.round(numOr(o.concurrency, UPLOAD_CONCURRENCY)), 1, 8);
  const retry = Math.max(0, Math.round(numOr(o.retry, UPLOAD_RETRY)));
  const backoff = (Array.isArray(o.backoff) && o.backoff.length) ? o.backoff : RETRY_BACKOFF;
  const run = (typeof o.run === 'function') ? o.run : function () { return Promise.resolve(); };
  const isCancelled = (typeof o.isCancelled === 'function') ? o.isCancelled : function () { return false; };
  const onProgress = (typeof o.onProgress === 'function') ? o.onProgress : function () {};
  const sleep = (typeof o.sleep === 'function') ? o.sleep : function (ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  };
  return new Promise(function (resolve) {
    let next = 0, active = 0, done = 0, settled = false, cancelled = false;
    const finish = function (ok, error) {
      if (settled) return;
      settled = true;
      resolve({ ok: !!ok, done: done, total: total, cancelled: cancelled, error: error || null });
    };
    const launch = function () {
      if (settled) return;
      if (isCancelled()) { cancelled = true; finish(false, new Error('cancelled')); return; }
      while (next < total && active < concurrency && !settled) {
        const idx = next++;
        active += 1;
        worker(idx);
      }
      if (done >= total) finish(true);
    };
    const worker = function (idx) {
      let attempt = 0;
      const attemptRun = function () {
        if (settled) return;
        if (isCancelled()) { cancelled = true; active -= 1; finish(false, new Error('cancelled')); return; }
        Promise.resolve().then(function () { return run(idx); }).then(function () {
          if (settled) return;
          done += 1; active -= 1;
          onProgress(done, total);
          launch();
        }, function (err) {
          if (settled) return;
          attempt += 1;
          if (attempt > retry) { active -= 1; finish(false, err || new Error('chunk-failed')); return; }
          const wait = numOr(backoff[Math.min(attempt - 1, backoff.length - 1)], 400);
          sleep(wait).then(function () {
            if (settled) return;
            attemptRun();
          });
        });
      };
      attemptRun();
    };
    if (!total) { finish(true); return; }
    launch();
  });
}
// 分片上传主体：读文件 → base64 → 发云端；进度/取消/重试全在 runPool
// opts: {deckId, ownerSid, size, path, readChunk?, send?, concurrency?, onProgress?(done,total), isCancelled?}
function uploadChunks(opts) {
  const o = opts || {};
  const total = chunkCount(o.size);
  const readChunk = (typeof o.readChunk === 'function') ? o.readChunk : readChunkBase64;
  const send = (typeof o.send === 'function') ? o.send : sendChunk;
  const ownerSid = strOf(o.ownerSid || cloud.currentSid());
  return runPool({
    total: total,
    concurrency: o.concurrency,
    retry: o.retry,
    backoff: o.backoff,
    sleep: o.sleep,
    isCancelled: o.isCancelled,
    onProgress: o.onProgress,
    run: function (idx) {
      const r = chunkRange(o.size, idx);
      return Promise.resolve()
        .then(function () { return readChunk(o.path, r.offset, r.length); })
        .then(function (b64) { return send({ deckId: o.deckId, ownerSid: ownerSid, idx: idx, base64: b64 }); });
    }
  });
}
// §4.3 提交转换（PATCH status=queued）
function submitDeck(deckIdIn, size, chunks) {
  const id = strOf(deckIdIn);
  if (!id) return Promise.resolve({ ok: false, reason: '演示不存在' });
  return patchDeck(id, { status: 'queued', chunk_count: Math.max(0, Math.round(numOr(chunks, 0))), source_size: Math.max(0, Math.round(numOr(size, 0))), progress: 0, error: '' });
}
// §4.4 列表（轻字段，禁止带 manifest）
function listDecks() {
  if (!cloud.isEnabled()) return Promise.resolve({ ok: false, list: [], reason: '云服务未开启' });
  return cloud.cbGet(tblDecks(), LIST_SELECT)
    .then(function (list) { return { ok: true, list: Array.isArray(list) ? list : [] }; })
    .catch(function (e) { return { ok: false, list: [], reason: reasonOf(e) }; });
}
// §4.5 播放前取清单
function getManifest(deckIdIn) {
  const id = strOf(deckIdIn);
  if (!id) return Promise.resolve({ ok: false, reason: '演示不存在', deck: null, manifest: null });
  if (!cloud.isEnabled()) return Promise.resolve({ ok: false, reason: '云服务未开启', deck: null, manifest: null });
  const q = MANIFEST_SELECT + '&id=eq.' + encodeURIComponent(id);
  return cloud.cbGet(tblDecks(), q)
    .then(function (list) {
      const row = (Array.isArray(list) ? list[0] : null) || null;
      if (!row) return { ok: false, reason: '演示不存在或已删除', deck: null, manifest: null };
      const manifest = normManifest(row.manifest);
      if (!manifest) return { ok: false, reason: '还没转换完成', deck: row, manifest: null };
      // §12.4.1：记录文件标签，回到列表时即使轻查询失败也能显示「兼容版/PDF」
      if (manifest.hasFiles || manifest.video) rememberFiles(id, manifest.files);
      return { ok: true, reason: '', deck: row, manifest: manifest, files: manifest.files || null };
    })
    .catch(function (e) { return { ok: false, reason: reasonOf(e), deck: null, manifest: null }; });
}
// PATCH 任意字段（§4.3/§4.6；cloud.patchByUpsert 兼容不支持 PATCH 的基础库）
function patchDeck(deckIdIn, obj) {
  const id = strOf(deckIdIn);
  if (!id) return Promise.resolve({ ok: false, reason: '演示不存在' });
  const patch = Object.assign({ updated_at: Date.now() }, obj || {});
  return cloud.cbPatch(tblDecks(), id, patch)
    .then(function () { return { ok: true, reason: '' }; })
    .catch(function (e) { return { ok: false, reason: reasonOf(e) }; });
}
// §4.6 软删除（本人/管理员）
function softDelete(deckIdIn) { return patchDeck(deckIdIn, { deleted: true }); }
// §4.6 失败重试（转换失败 → 重新排队；上传中断 → 页面应重新选文件上传全部分片，见 retryMode）
function retryDeck(deckIdIn) { return patchDeck(deckIdIn, { status: 'queued', progress: 0, error: '' }); }
// 上传失败落状态（§4.2）；同时清理已写入的分片（2026-11-09 Lead 要求：避免数据库残留）
function markUploadFailed(deckIdIn, reason) {
  const id = strOf(deckIdIn);
  if (!id) return Promise.resolve({ ok: false });
  return Promise.all([
    cleanupChunks(id),
    patchDeck(id, { status: 'failed', progress: 0, error: strOf(reason || UPLOAD_ERR).slice(0, 300) })
  ]).then(function (r) { return r[1]; });
}
// 取消上传：停止后清理分片 + 软删（§8.1「取消即软删」；分片 DELETE 策略允许本人）
function cancelUpload(deckIdIn) {
  const id = strOf(deckIdIn);
  if (!id) return Promise.resolve({ ok: false });
  return cleanupChunks(id).then(function () { return softDelete(id); });
}
// 分片清理（best effort；转换机也会删）
function cleanupChunks(deckIdIn) {
  const id = strOf(deckIdIn);
  if (!id || !cloud.isEnabled()) return Promise.resolve({ ok: false });
  return cloud.cbDelete(tblChunks(), 'deck_id=eq.' + encodeURIComponent(id))
    .then(function () { return { ok: true }; })
    .catch(function () { return { ok: false }; });
}
// §3.4 转换机心跳（读 site_assets id='ppt_agent'，随列表同一轮拉取 §4.7）
function heartbeat() {
  if (!cloud.isEnabled()) return Promise.resolve({ ok: false, row: null, hb: hbView(null, Date.now()), reason: '云服务未开启' });
  const q = 'select=body,updated_at&id=eq.' + encodeURIComponent(HEARTBEAT_ID);
  return cloud.cbGet(tblAssets(), q)
    .then(function (list) {
      const row = (Array.isArray(list) ? list[0] : null) || null;
      return { ok: true, row: row, hb: hbView(row, Date.now()), reason: '' };
    })
    .catch(function (e) { return { ok: false, row: null, hb: hbView(null, Date.now()), reason: reasonOf(e) }; });
}
// §4.7 一轮轮询：列表 + 心跳（同一轮；页面可见时 10s）
function pollRound() {
  return Promise.all([listDecks(), heartbeat()]).then(function (r) {
    const l = r[0] || {}, h = r[1] || {};
    return { ok: !!l.ok, list: l.list || [], hb: h.hb || hbView(null, Date.now()), hbOk: !!h.ok, reason: l.reason || '' };
  });
}

/* ============================================================
 * H. 下载原件（§8.1 控制条「下载原件」；manifest.src 非空才可用）
 * ============================================================ */
// 用系统能力打开 OSS 上的原件：wx.downloadFile → wx.openDocument（可保存/转发）
// 注意 OSS 域名需加入小程序 downloadFile 合法域名（交付说明风险项）。
function openSourceUrl(url) {
  const u = strOf(url);
  if (!u) return Promise.resolve({ ok: false, reason: '该演示未保留原件' });
  return new Promise(function (resolve) {
    let done = false;
    const fin = function (v) { if (done) return; done = true; resolve(v); };
    const hide = function () { try { wx.hideLoading(); } catch (e) { /* ignore */ } };
    try {
      wx.showLoading({ title: '下载中原件较大', mask: true });
      wx.downloadFile({
        url: u,
        success: function (res) {
          hide();
          if (!res || res.statusCode !== 200 || !res.tempFilePath) { fin({ ok: false, reason: '原件下载失败' }); return; }
          try {
            wx.openDocument({
              filePath: res.tempFilePath,
              showMenu: true,
              success: function () { fin({ ok: true, reason: '' }); },
              fail: function () { fin({ ok: false, reason: '无法打开原件' }); }
            });
          } catch (e) { fin({ ok: false, reason: '无法打开原件' }); }
        },
        fail: function () { hide(); fin({ ok: false, reason: '原件下载失败，请检查网络' }); }
      });
    } catch (e) { hide(); fin({ ok: false, reason: '原件下载失败' }); }
  });
}
function openSource(deckIdIn) {
  return getManifest(deckIdIn).then(function (r) {
    if (!r.ok || !r.manifest) return { ok: false, reason: r.reason || '还没转换完成' };
    return openSourceUrl(r.manifest.src);
  });
}

module.exports = {
  // 常量
  CHUNK_SIZE: CHUNK_SIZE, MAX_SOURCE_SIZE: MAX_SOURCE_SIZE, MAX_CHUNKS: MAX_CHUNKS,
  UPLOAD_CONCURRENCY: UPLOAD_CONCURRENCY, UPLOAD_RETRY: UPLOAD_RETRY, RETRY_BACKOFF: RETRY_BACKOFF,
  HB_OFFLINE_MS: HB_OFFLINE_MS, HEARTBEAT_ID: HEARTBEAT_ID, CLIENT: CLIENT, EXTS: EXTS,
  TITLE_MAX: TITLE_MAX, TRANSITIONS: TRANSITIONS, DEFAULT_TRD: DEFAULT_TRD, STEP_FADE_MS: STEP_FADE_MS,
  UPLOAD_ERR: UPLOAD_ERR, LIST_SELECT: LIST_SELECT,
  // v2.0 下载中心（契约 §12）
  FILES_SELECT: FILES_SELECT, MANIFEST_SELECT: MANIFEST_SELECT,
  FILE_KINDS: FILE_KINDS, FILE_LABELS: FILE_LABELS, FILES_STORAGE_KEY: FILES_STORAGE_KEY,
  DOWNLOAD_OPEN_TYPES: DOWNLOAD_OPEN_TYPES,
  // v1.2 原样播放 + 续播（契约 §11）
  MODE_VIDEO: MODE_VIDEO, MODE_STEP: MODE_STEP, V_RATES: V_RATES,
  V_START_TIMEOUT_MS: V_START_TIMEOUT_MS, V_CTRL_HIDE_MS: V_CTRL_HIDE_MS,
  RESUME_TTL_MS: RESUME_TTL_MS, RESUME_MIN_SEC: RESUME_MIN_SEC, RESUME_END_RATIO: RESUME_END_RATIO,
  RESUME_KEY: RESUME_KEY, MODE_KEY: MODE_KEY, V_STAGE: V_STAGE,
  // A/B 纯工具
  clamp: clamp, isAbsUrl: isAbsUrl, joinUrl: joinUrl, resolveUrl: resolveUrl,
  // PPT 在线媒体 ECS /pptfiles 映射（2026-11-18）
  PPT_OSS_HOST: PPT_OSS_HOST, pptEcsBase: pptEcsBase, pptEcsUrl: pptEcsUrl, mediaUrlOf: mediaUrlOf,
  baseNameOf: baseNameOf, extOf: extOf, trimTitle: trimTitle, fmtSize: fmtSize, fmtWhen: fmtWhen, fmtDur: fmtDur,
  deckId: deckId, chunkCount: chunkCount, chunkRange: chunkRange, validateFile: validateFile,
  fileOf: fileOf, deckRow: deckRow, uploadPct: uploadPct,
  // C manifest
  normTransition: normTransition, normTrd: normTrd, normMedia: normMedia, normMediaRow: normMediaRow,
  normStep: normStep, normSlide: normSlide, normManifest: normManifest, stepCountOf: stepCountOf,
  // C2 下载中心：manifest v2 文件 / 兼容提示 / 详情视图 / 标签（契约 §12）
  normFileRow: normFileRow, normFiles: normFiles, normCompat: normCompat,
  safeFileName: safeFileName, openTypeOf: openTypeOf, fileRows: fileRows,
  // §12.8 视频/音频单独下载
  normMediaFile: normMediaFile, normMediaFiles: normMediaFiles, mediaRows: mediaRows,
  downloadDetailView: downloadDetailView, statusTextOf: statusTextOf, tagsOf: tagsOf,
  rememberFiles: rememberFiles, filesMap: filesMap, filesOfDecks: filesOfDecks,
  // D step 序列
  flatSteps: flatSteps, posOf: posOf, advance: advance, pageStart: pageStart,
  progressPct: progressPct, posText: posText, viewAt: viewAt, fitRect: fitRect, hotRects: hotRects,
  hotButtons: hotButtons,
  preloadList: preloadList, preloadPlan: preloadPlan, thumbList: thumbList,
  // D2 原样播放视频 / 章节 / 模式 / 降级链 / 续播（契约 §11）
  normVideo: normVideo, videoTicksOf: videoTicksOf, fmtVideoClock: fmtVideoClock,
  videoTimeText: videoTimeText, videoPct: videoPct, videoChapterAt: videoChapterAt,
  videoPageOf: videoPageOf, videoSeekTarget: videoSeekTarget, videoPrevNext: videoPrevNext,
  chooseMode: chooseMode, videoStageNext: videoStageNext, downloadPct: downloadPct,
  downloadText: downloadText, nextRate: nextRate, rateText: rateText,
  normResume: normResume, resumeValid: resumeValid, resumeBadge: resumeBadge, resumeText: resumeText,
  resumeAll: resumeAll, resumeOf: resumeOf, saveResume: saveResume, clearResume: clearResume,
  modeOf: modeOf, saveMode: saveMode,
  // E 状态/列表
  isMine: isMine, statusView: statusView, deckView: deckView, sortDecks: sortDecks,
  listView: listView, hbView: hbView, isUploadInterrupted: isUploadInterrupted, retryMode: retryMode,
  // F 错误
  reasonOf: reasonOf,
  // G 云端接口
  createDeck: createDeck, sendChunk: sendChunk, readChunkBase64: readChunkBase64, pickChunkBuffer: pickChunkBuffer,
  runPool: runPool, uploadChunks: uploadChunks, submitDeck: submitDeck, listDecks: listDecks,
  getManifest: getManifest, patchDeck: patchDeck, softDelete: softDelete, retryDeck: retryDeck,
  markUploadFailed: markUploadFailed, cancelUpload: cancelUpload, cleanupChunks: cleanupChunks,
  heartbeat: heartbeat, pollRound: pollRound, openSource: openSource, openSourceUrl: openSourceUrl
};
