// pages/nt/nt.js —— 班级通知（对齐网页端通知页：简报 / 筛选 / 未过期自动展开 / 文件与图片时间线）
//
// 网页端（briefdesk build_notice_board.py）能力对照：
//   · 简报：待处理 / 24h 截止 / 7 天内 / 已过期 + 最近 3 条待处理（点击跳转）
//   · 筛选：待处理 / 已过期 / 全部 + 分类；已过期默认折叠成独立区块
//   · 卡片：分类 / OCR / 状态 / 原始消息；AI 摘要 + 要点；6 项字段拆分
//   · 时间线（未过期默认展开，已过期默认收起）：文件（预览/下载）、表单（打开）、
//     图片（预览）、链接 / 小程序 / 公众号（复制链接打开）、原文摘录
//   · 标记已处理（持久化到 store.ntDone + 云端 marks kind='ntdone'，与网页端互通）+ 收起/展开
const util = require('../../utils/util.js');
const cloud = require('../../utils/cloud.js');
const identity = require('../../utils/identity.js');
const notice = require('../../utils/notice.js');
const notify = require('../../utils/notify.js');
const share = require('../../utils/share.js');
const sharecard = require('../../utils/sharecard.js');
const shareflow = require('../../utils/shareflow.js');
const store = require('../../utils/store.js');
const scrollmem = require('../../utils/scrollmem.js');

const CAT_CLS = { '教务': 'jw', '团务': 'tw', '考试': 'ks', '缴费': 'jf', '活动': 'hd', '班级事务': 'qt' };
// 2026-11-09 用户需求：分类由 AI 按近期通知动态增删。未命中固定色映射时用稳定 hash 取色，
// 与网页端 catClass() 同口径（同一分类名在两端颜色一致），不新增样式类。
const CAT_PALETTE = ['jw', 'tw', 'ks', 'jf', 'hd', 'qt'];
function catCls(name) {
  const s = String(name || '');
  if (CAT_CLS[s]) return CAT_CLS[s];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CAT_PALETTE[h % CAT_PALETTE.length];
}
const SEG_ORDER = ['时间', '地点', '对象', '内容', '报名', '截止', '要求', '联系方式', '补充'];
const SEG_CLS = {
  '时间': 'time', '地点': 'place', '对象': 'who', '内容': 'info', '报名': 'join',
  '截止': 'due', '要求': 'rule', '联系方式': 'contact', '补充': 'supp'
};
const FILE_KIND = { pdf: 'PDF', xls: 'XLS', xlsx: 'XLS', doc: 'DOC', docx: 'DOC', ppt: 'PPT', pptx: 'PPT' };
const MAX_QUOTE_LINES = 2;
// 2026-11-17：通知列表默认展开全部未过期卡；lite 列表的图片要按 id 拉完整 body。
// 只自动拉前 2 张有图片的卡（视口内常见数量），其余显示「点击加载」占位——避免一次进页并发拉
// 十几条完整 body（每条数百 KB、内存回到 10MB+），也避免弱网下同时打满请求。
const AUTO_IMG_CARDS = 2;

function pad(n) { return n < 10 ? '0' + n : '' + n; }
// 已处理状态的真源：store.ntDone（= marks kind='ntdone' 的本机缓存；网页端与小程序的共同状态）
function doneMap() {
  try { return Object.assign({}, store.get().ntDone || {}); } catch (e) { return {}; }
}
// 通知提醒本机缓存（store.ntRemind；不同步到 userdata/web，openid 维度只在云端）
function remindMap() {
  try {
    const raw = store.get().ntRemind || {};
    const out = {};
    Object.keys(raw).forEach(function (k) {
      const v = raw[k];
      if (v && v.fireAt) out[k] = { ref: String(v.ref || k), fireAt: Number(v.fireAt) || 0, label: String(v.label || ''), ts: Number(v.ts) || 0 };
    });
    return out;
  } catch (e) { return {}; }
}
function fmtRemind(ts) {   // 卡片胶囊用：11-06 08:00
  const d = new Date(ts);
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
// 简报「最近截止」行：与卡片状态 chip 同口径（契约 §2.3）——「<时间> <动作>」/「无时间」/ alert 例外文案
function briefMetaOf(g, now) { return notice.statusOf(g, now).label; }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
const MIN_AHEAD = 60000;              // 提醒至少晚于现在 60s（契约 §1.3）
const REMIND_GRACE = 10 * 60000;      // fireAt 已过 10 分钟且云端无记录 → 清理本机项
function cleanText(s) {
  return String(s || '')
    .replace(/@(所有人|全体成员|全体同学|全体|大家)\s*/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/^[，,。；;、\s]+/, '')
    .trim();
}
function splitText(s) {
  s = cleanText(s);
  if (!s) return [];
  const out = [];
  s.split(/\n+/).forEach(function (line) {
    line = line.trim();
    if (!line) return;
    if (line.length <= 110) { out.push(line); return; }
    const parts = line.match(/[^。！？；!?;]+[。！？；!?;]?/g) || [line];
    let buf = '';
    parts.forEach(function (p) {
      if ((buf + p).length > 95) { if (buf) out.push(buf.trim()); buf = p; } else buf += p;
    });
    if (buf.trim()) out.push(buf.trim());
  });
  return out;
}
function srcKind(source) {
  const s = String(source || '');
  if (s.indexOf('QQ') >= 0) return 'qq';
  if (s.indexOf('微信') >= 0) return 'wx';
  return 'doc';
}
// 需求 7：从通知来源里取「群名」（原始 source 形如「QQ 群「某班级群」」→ 某班级群；无则原样）
function groupNameOf(g) {
  const raw = String((g && (g.group || g.source)) || '').trim();
  if (!raw) return '班级群';
  const m = raw.match(/QQ\s*群[\s「『"']*([^」』"')）]+)/);
  if (m && m[1] && m[1].trim()) return m[1].trim();
  return raw;
}
function fileExt(name) {
  const m = String(name || '').match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
}
function fileKindOf(name) {
  const ext = fileExt(name);
  if (ext === 'pdf') return { kind: 'pdf', text: 'PDF' };
  if (ext === 'xls' || ext === 'xlsx') return { kind: 'xls', text: 'XLS' };
  if (ext === 'doc' || ext === 'docx') return { kind: 'doc', text: 'DOC' };
  if (ext === 'ppt' || ext === 'pptx') return { kind: 'ppt', text: 'PPT' };
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'gif') return { kind: 'img', text: '图片' };
  return { kind: 'file', text: '文件' };
}
function dataUriMime(src) {
  const m = String(src || '').match(/^data:([^;,]+)[;,]/);
  return m ? m[1] : '';
}
// 附件是否图片：data URI 看 MIME；外置 URL 没有 MIME（dataUriMime 为空）→ 退化为文件名后缀判断，
// 保证图片类文件在 URL 形态下仍走 previewImage 而不是 openDocument（openDocument 不支持图片）。
function isImageFileOf(name, mime) {
  if (/^image\//.test(String(mime || ''))) return true;
  return /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(String(name || ''));
}
function dataUriBytes(src) {
  const m = String(src || '').match(/^data:[^;]+;base64,(.*)$/);
  return m ? Math.round(m[1].length * 0.75) : 0;
}
function sizeText(bytes) {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}
// 附件外置（2026-11-10 迁移第 2 步，三端同步）：云端通知 body 里的附件由 base64 data URI
// 改为签名 HTTPS URL，形如 https://tool.furina.fun/att/<id>?exp=<unix>&sig=<hex64>
// （备案期调试可能是 http://<ip>/att/...）。代码只按协议判断，不写死域名；
// GET 直出原文件字节、无需任何鉴权头；旧 data URI 数据必须继续可用（向后兼容）。
function isHttpUrl(src) { return /^https?:\/\//i.test(String(src || '')); }
// 文件大小文案：URL 形态没有 base64 可估字节（dataUriBytes(url) 只会得到 0），不能显示「0 B」——
// 优先用数据管线给的 it.size（人类可读字符串，如「82 KB」），没有就留空（meta 兜底「附件」）；
// 旧 data URI 仍按 base64 长度估算，且 it.size 存在时与改造前一致地优先用 it.size。
function fileSizeText(it) {
  const item = it || {};
  const src = String(item.url || item.src || '');
  const given = String(item.size || '');
  if (isHttpUrl(src)) return given;
  return given || sizeText(dataUriBytes(src));
}
function parseClose(s) {
  const m = String(s || '').match(/^(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const now = new Date();
  return new Date(now.getFullYear(), +m[1] - 1, +m[2], +(m[3] || 23), +(m[4] || 59), 0, 0).getTime();
}
function compactSegs(aiSegments) {
  const map = {};
  (aiSegments || []).forEach(function (s) {
    if (!s || !s.text) return;
    let type = String(s.type || '内容').replace('联系', '联系方式');
    if (SEG_ORDER.indexOf(type) < 0) type = '补充';
    if (!map[type]) map[type] = [];
    const txt = String(s.text).trim();
    if (txt && map[type].length < 2 && map[type].indexOf(txt) < 0) map[type].push(txt);
  });
  const out = [];
  SEG_ORDER.forEach(function (type) {
    if (map[type] && map[type].length) out.push({ type: type, cls: SEG_CLS[type] || 'info', text: map[type].join('；') });
  });
  return out.slice(0, 6);
}
function composeOf(items) {
  const count = {};
  (items || []).forEach(function (it) { if (it && it.kind) count[it.kind] = (count[it.kind] || 0) + 1; });
  const defs = [
    ['text', '条通知'], ['file', '个附件'], ['img', '张图片'], ['form', '个收集表'],
    ['link', '个链接'], ['mini', '个小程序'], ['article', '篇文章'], ['follow', '条补充']
  ];
  const out = [];
  defs.forEach(function (d) { if (count[d[0]]) out.push({ n: count[d[0]], label: d[1] }); });
  return out;
}

// 原始 group -> 卡片数据（只放轻量字段；附件/图片本体留在 _raw，按需转换临时文件）
// v2.0.0：先套用管理员编辑覆盖（cloud 解析 override_json 后挂在 g._override），再映射；
// 2026-11-14 契约：显示层统一时间格式（M月D日（相对周））+ 长期安排 until 结束判定 + 最新发布时间。
function mapGroup(rawG, nowTs) {
  const now = (nowTs == null || isNaN(Number(nowTs))) ? Date.now() : Number(nowTs);
  const g = notice.applyOverride(rawG);
  const st = notice.statusOf(g, now);
  const rec = notice.recurOf(g);
  const ended = !!rec && notice.isRecurEnded(g, now);
  // 契约 §3：相对日期替换锚点 = 同一卡片第一条 item 的 time（发送时刻），整卡一致；
  // 之后统一把 MM-DD / M月D日 / ISO 日期格式化为 `M月D日（相对周）`（按渲染时 now 计算）。
  const anchor = notice.anchorOf(g);
  const abs = function (s) { return notice.fmtDisplayDates(s, anchor, now); };
  const items = [];
  const quotes = [];
  const textItems = (g.items || []).filter(function (x) { return x.kind === 'text' || x.kind === 'follow'; });
  let textPos = 0;
  (g.items || []).forEach(function (it, i) {
    if (!it || !it.kind) return;
    const kind = it.kind;
    if (kind === 'text' || kind === 'follow') {
      const lines = splitText(it.text);
      const shown = lines.slice(0, MAX_QUOTE_LINES).join('\n');
      const pos = textPos++;
      quotes.push({
        key: 'q' + i,
        i: i,
        label: it.label || (kind === 'follow' ? '补充通知' : (pos === 0 ? '原始消息' : '补充通知')),
        fromName: String(it.fromName || it.from || '').trim(),
        fromBadge: String(it.fromRole || it.fromBadge || '').trim(),
        time: it.time || '',
        text: abs(shown),
        truncated: lines.length > MAX_QUOTE_LINES
      });
      return;
    }
    if (kind === 'img') return;   // 图片统一在 imgs 区展示
    if (kind === 'file') {
      const fk = fileKindOf(it.name || '');
      // 2026-11-17：lite 列表里 data URI 被服务端置空 + lazy=true；仍显示可点（hasUrl），
      // 点开时按 id 拉单行完整 body（附件本身不丢，离线时列表仍可读）。
      const lazy = !!it.lazy;
      const hasUrl = !!(it.url || it.src || lazy);
      const ar = notice.archiveInfo(it);                 // 压缩包内部文件清单（仅元数据，不含 data URI）
      const archiveFiles = ar.files.map(function (f) {
        const fk2 = fileKindOf(f.name);
        return {
          name: f.name, extKind: fk2.kind, extText: fk2.text,
          // 外置后包内文件同样可能只有 URL：用数据管线给的 size，没有就留空（不显示 0 B）
          size: f.size || '', hasUrl: f.hasUrl, lazy: !!f.lazy
        };
      });
      items.push({
        key: 'file' + i, kind: 'file', i: i,
        name: it.name || it.text || '文件',
        extKind: fk.kind, extText: fk.text,
        // URL / data URI 两种形态统一走 fileSizeText：URL 不再用 dataUriBytes 得 0 B
        meta: [fileSizeText(it), it.note || ''].filter(Boolean).join(' · ') || '附件',
        hasUrl: hasUrl,
        lazy: lazy,
        // 需求 7：无 url 且无可用 archive 才「待获取」；压缩包已识别（archiveOk）时展示包内清单
        pending: !hasUrl && !ar.ok,
        archiveOk: ar.ok,
        archiveCount: ar.count,
        archiveSummary: ar.summary,
        archiveFiles: archiveFiles,
        time: it.time || ''
      });
      return;
    }
    if (kind === 'form') {
      const closeTs = parseClose(it.close);
      const closed = closeTs ? Date.now() > closeTs : false;
      items.push({
        key: 'form' + i, kind: 'form', i: i,
        name: it.realTitle || it.name || '收集表',
        statusText: closed ? '已截止' : '报名中',
        closed: closed,
        closeText: it.close || '',
        note: it.note || '',
        hasUrl: !!(it.realUrl || it.url),
        time: it.time || ''
      });
      return;
    }
    if (kind === 'link' || kind === 'mini' || kind === 'article') {
      const url = it.realUrl || it.url || '';
      items.push({
        key: kind + i, kind: kind, i: i,
        name: it.name || it.title || (kind === 'article' ? '公众号文章' : (kind === 'mini' ? '小程序' : '链接')),
        title: it.title || '',
        account: it.account || '',
        note: it.note || '',
        host: (String(url).match(/^https?:\/\/([^/]+)/) || [])[1] || '',
        hasUrl: !!url,
        time: it.time || ''
      });
      return;
    }
    if (kind === 'merged') {
      const msgs = (it.messages || []).slice(0, 8).map(function (m, mi) {
        return {
          key: 'm' + i + '_' + mi,
          fromName: String(m.fromName || m.from || '').trim(),
          fromBadge: String(m.fromRole || m.fromBadge || '').trim(),
          time: m.time || '',
          text: abs(splitText(m.text).join('\n'))
        };
      });
      items.push({
        key: 'merged' + i, kind: 'merged', i: i,
        name: it.title || '聊天记录',
        count: it.count || (it.messages || []).length,
        messages: msgs,
        time: it.time || ''
      });
    }
  });

  // 2026-11-17：lite 列表的图片 src 为空但 lazy=true；先保留占位（imgCount>0），
  // 展开/预览时 ensureImgs 按 id 拉完整 body 后再转本地文件。
  const imgs = (g.items || []).filter(function (x) { return x.kind === 'img' && (x.src || x.lazy); })
    .map(function (x, i) { return { caption: x.caption || '', ocr: !!x.ocr, i: i, lazy: !!x.lazy }; });

  const senderName = String(g.senderName || '').trim();
  const senderRole = String(g.senderRole || '').trim();
  const senderBadge = String(g.senderBadge || '').trim();
  // 需求 7：「待获取」文件提示里要显示通知来源群名（优先 group，其次从 source 解析）
  const groupName = groupNameOf(g);
  const hasRaw = textItems.length > 0;
  const compose = composeOf(g.items);
  const filesCount = items.filter(function (x) { return x.kind === 'file'; }).length;
  const hasReport = items.filter(function (x) { return x.kind === 'form'; }).length;
  const hasDetail = !!(compactSegs(g.aiSegments).length || items.length || imgs.length || (hasRaw && !g.aiSummary));

  let more = [];
  if (items.length) more.push(items.length + ' 项详情');
  if (filesCount) more.push(filesCount + ' 个附件');
  if (imgs.length) more.push(imgs.length + ' 张图片');
  if (hasReport) more.push(hasReport + ' 个收集表');

  return {
    id: g.id || ('auto_' + Math.random().toString(36).slice(2)),
    title: abs(g.title || '班级通知'),
    cat: g.cat || '通知',
    catCls: catCls(g.cat || '通知'),
    source: g.source || '',
    sourceKind: srcKind(g.source),
    groupName: groupName,
    senderName: senderName,
    senderRole: senderRole,
    senderBadge: senderBadge,
    pubBadge: senderRole || senderBadge,
    isOcr: !!g.ocr || (g.items || []).some(function (x) { return x.ocr; }),
    // 契约 2026-11-14 §3：状态胶囊里的绝对日期统一为 M月D日（相对周）（倒计时类不含日期 token，保持不变）
    statusLabel: notice.fmtDatesCn(st.label, now),
    statusCls: st.cls,
    expired: st.expired,
    timeLabel: notice.timeLabelOf(g),
    summary: abs(g.aiSummary || ''),
    points: (g.aiPoints || []).slice(0, 3).map(abs),
    segs: compactSegs(g.aiSegments).map(function (sg) { return { type: sg.type, cls: sg.cls, text: abs(sg.text) }; }),
    items: items,
    quotes: g.aiSummary ? [] : quotes.slice(0, 2),
    hasRaw: hasRaw,
    hasDetail: hasDetail,
    compose: compose,
    filesCount: filesCount,
    imgCount: imgs.length,
    moreText: more.join(' · '),
    expanded: st.expired ? false : true,
    closing: false,             // 需求 13：收起时先播高度动画，动画结束后再移除
    done: false,
    // 需求 9：长期安排（recurrence）——徽标 + label + 本地计算的「下次」时间；不判过期、不参与待处理
    // 契约 2026-11-14 §1.1：until 已过 → 归已过期区（recurEnded=true，不再产生期次）
    recurring: !!rec && !ended,
    recurLabel: rec ? notice.recurLabelOf(g) : '',
    nextText: (rec && !ended) ? notice.nextTextOf(g) : '',
    // 契约 §2.2：长期清单「下次 M月D日（周X）HH:MM」（until 已结束 → 空）
    nextCnText: (rec && !ended) ? notice.nextCnTextOf(g, now) : '',
    // 期次卡由 applyFilter 从定义卡派生（isOcc=true，id=期次 key）；定义卡本身 isOcc=false
    isOcc: false,
    isInfo: false,
    recurEnded: ended,
    // 契约 2026-11-18 §1/§5：发布时间戳（publishedAt 优先，旧缓存回退 items 最新消息 / updatedAt），
    // 用于「最新发布」倒序与发布卡状态 chip
    pubTs: notice.publishedTsOf(g, now),
    // 需求 12：管理员软删除（hidden）/ 被管理员编辑过（override 或补充通知更新）
    hidden: !!(rawG && rawG._hidden),
    updated: !!(g.updatedAt || (rawG && rawG._editedAt)),
    admin: false,               // 由页面 applyFilter 按当前身份补
    canDone: !st.expired && !rec,
    // 提醒（未过期才可设置；本机已设时显示胶囊「提醒 11-06 08:00」）
    deadlineTs: notice.deadlineOf(g),
    canRemind: !st.expired && !rec,
    reminded: false,
    remindText: '',
    remindLabel: '提醒',
    imgs: []
  };
}

// 卡片 DOM id：期次 key 含 `@` / `:`（CSS 选择器非法）→ 统一转成安全 token（普通 gid 也走同一函数，保持一致）
function domIdOf(ref) { return 'c_' + String(ref == null ? '' : ref).replace(/[^A-Za-z0-9_-]/g, '_'); }

// 契约 2026-11-14 §2.1：顶部 5 张数据卡 → 对应筛选视图（再点已激活卡恢复「全部」）
const CARD_FILTERS = { pending: 'active', urgent: 'urgent', week: 'week', longterm: 'longterm', latest: 'latest' };
// 所有可用的列表视图（chips + 顶部卡 + 已过期/已隐藏）
const FILTERS = ['all', 'active', 'urgent', 'week', 'expired', 'hidden', 'longterm', 'latest'];
// 期次卡（§2.3）：复用长期安排定义卡的完整内容，头部加「长期安排」徽标、状态=本次 M月D日（周X）HH:MM；
// id = 期次 key（<gid>@occ:<YYYYMMDD>），「本次已处理」写 marks kind='ntdone' ref=期次 key。
function occCardOf(base, occ) {
  return Object.assign({}, base, {
    id: occ.key,
    isOcc: true,
    isInfo: false,
    recurring: false,
    recurLabel: '',
    nextText: '',
    nextCnText: '',
    recurEnded: false,
    statusLabel: occ.label,
    statusCls: 'recurring',
    done: false,
    canDone: false,
    canRemind: false,
    expanded: true,
    expired: false
  });
}
// 「待处理」口径（§2.4）：未过期、非长期定义、非资料/无时间、未已处理、actionable!==false 且有主显示时间；
// days = 窗口天数（24h 卡用 1、7 天卡用 7）。
function isPendingNormal(go, card, doneMap, now, days) {
  const st = notice.statusOf(go, now);
  if (st.expired) return false;
  if (notice.isLongterm(go, now)) return false;
  if (notice.isActionable(go) === false) return false;
  if (doneMap[card && card.id]) return false;
  if (!notice.hasTimeAnchor(go)) return false;
  const ts = notice.whenOf(go, now);
  if (ts == null || ts < now) return false;
  return ts - now <= days * 86400000;
}

function writeDataUri(src, name) {
  return new Promise(function (resolve, reject) {
    const m = String(src || '').match(/^data:([^;]+);base64,(.+)$/);
    if (!m) { reject(new Error('bad-data-uri')); return; }
    const raw = String(m[2] || '');
    // 安全：data URI 体积上限 10MB（base64 字符数），避免云数据异常/恶意大包拖垮内存与文件系统
    if (raw.length > 10 * 1024 * 1024) { reject(new Error('file-too-large')); return; }
    const extM = String(name || '').match(/\.([a-z0-9]{1,8})$/i);
    const mimeExt = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'application/pdf': 'pdf' };
    const ext = extM ? extM[1].toLowerCase() : (mimeExt[m[1]] || 'bin');
    const file = wx.env.USER_DATA_PATH + '/nt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.' + ext;
    wx.getFileSystemManager().writeFile({
      filePath: file, data: m[2], encoding: 'base64',
      success: function () { resolve(file); },
      fail: reject
    });
  });
}

// 附件取本地临时路径（附件外置 2026-11-10）：
//   * data URI → writeDataUri 落盘（旧数据流程完全不变）；
//   * http(s) 签名 URL → wx.downloadFile → tempFilePath（GET 直出字节，无需鉴权头）；
//   * 其它形态（理论不会出现）→ 当作已是可用本地路径，直接返回。
// 注意：downloadFile 的 tempFilePath 不保证带原扩展名（签名 URL 路径是 /att/<hash>，没有后缀），
// 因此 openDocument 时统一用 fileType 兜底（见 openDocTypeOf），否则微信按扩展名判断会打不开。
// 失败一律 reject，由 previewFile/downloadFile 的 catch toast，不让页面崩。
function remoteTempOf(url) {
  return new Promise(function (resolve, reject) {
    wx.downloadFile({
      url: url,
      success: function (res) {
        // 签名过期/被拒（403）等非 200 一律失败，避免把错误页当附件打开
        if (!res || res.statusCode !== 200) { reject(new Error('http' + ((res && res.statusCode) || 0))); return; }
        if (!res.tempFilePath) { reject(new Error('no-temp-file')); return; }
        resolve(res.tempFilePath);
      },
      fail: function (err) { reject(new Error((err && err.errMsg) || 'download-fail')); }
    });
  });
}
function tempPathOf(url, name) {
  const s = String(url || '');
  if (!s) return Promise.reject(new Error('no-url'));
  if (s.indexOf('data:') === 0) return writeDataUri(s, name);
  if (isHttpUrl(s)) return remoteTempOf(s);
  return Promise.resolve(s);
}
// openDocument 支持的类型（微信默认按扩展名判断；无扩展名时必须显式传 fileType）
const OPEN_DOC_TYPES = { pdf: 'pdf', doc: 'doc', docx: 'docx', xls: 'xls', xlsx: 'xlsx', ppt: 'ppt', pptx: 'pptx' };
function openDocTypeOf(name) { return OPEN_DOC_TYPES[fileExt(name)] || ''; }
// 统一打开文档：data URI 落盘后的路径（带后缀）与 URL 下载后的临时路径（可能无后缀）都兼容
function openFileDoc(opts) {
  const o = { filePath: opts.filePath, showMenu: !!opts.showMenu };
  const ft = openDocTypeOf(opts.name);
  if (ft) o.fileType = ft;
  if (opts.success) o.success = opts.success;
  if (opts.fail) o.fail = opts.fail;
  try { wx.openDocument(o); } catch (e) { if (o.fail) o.fail(e); }
}

Page({
  data: {
    state: 'loading',
    errorText: '',
    syncText: '',
    briefDate: '',
    cloudEnabled: false,
    // 兼容旧字段（旧回归脚本/工具读取 autoList；新代码以 cards / expiredCards 为准）
    autoList: [],
    cards: [],
    expiredCards: [],
    expiredCount: 0,
    showExpired: false,
    // 契约 2026-11-14 §2：列表分区 = 主列表（含期次卡）→「资料 / 无时间」栏（默认展开）→ 已过期区；
    // longtermCards 为「长期通知」筛选的长期安排清单（进行中的 recurrence 定义卡，无已处理按钮）。
    longtermCards: [],
    longtermCount: 0,
    infoCards: [],
    infoCount: 0,
    showInfo: true,
    showExpiredWrap: true,
    // §2.1 顶部 5 张可点数据卡；cardKey = 当前激活的卡（'' = 无）
    stats: { pending: 0, urgent: 0, week: 0, expired: 0, longterm: 0, latest: 0, latestText: '—' },
    cardKey: '',
    emptyTitle: '没有待处理通知',
    emptyText: '换个筛选看看',
    briefNext: [],
    cats: ['全部'],
    filter: 'active',
    cat: '全部',
    listCount: 0,
    isAdmin: false,
    hasHidden: 0,
    // 需求 12：管理员编辑弹层（title/cat/summary/deadline/eventAt/timeLabel）
    editSheet: false,
    editGid: '',
    editTitle: '',
    editCat: '',
    editSummary: '',
    editDeadline: '',
    editEventAt: '',
    editTimeLabel: '',
    rawSheet: false,
    rawTitle: '',
    rawMeta: '',
    rawBlocks: [],
    // 卡片分享（2026-11-20）：预览图 + 图片分享 / 微信卡片分享两个选项
    shareSheet: false,
    shareGid: '',
    shareTitle: '',
    shareImg: '',
    sharePoster: '',
    shareBusy: false,
    shareHint: '',
    // 自定义提醒弹层（bottom-sheet + date/time picker，交互照搬 hw 页）
    remindSheet: false,
    remindForGid: '',
    remindForTitle: '',
    remindDate: '',
    remindClock: '',
    remindStart: '',
    remindEnd: '',
    remindHint: ''
  },
  onLoad(options) {
    scrollmem.attach(this);
    this._dead = false;
    this._raw = [];
    this._all = [];
    this._expanded = {};
    this._done = doneMap();
    this._remind = remindMap();
    this._imgs = {};
    this._loadingImgs = {};
    this._shareCache = {};
    this._first = true;
    this._lastPull = 0;
    this._remindAt = 0;
    this._remindPulling = false;
    // 从订阅消息点进来：pages/nt/nt?gid=<通知组 id> → 数据 ready 后切「全部」并定位该卡（只定位一次）
    this._pendingGid = '';
    if (options && options.gid) {
      const gidRaw = String(options.gid);
      this._pendingGid = gidRaw;
      // 小程序一般已解码 query；只有仍含 %XX 时再解一次（避免把正常 id 二次解码）
      if (gidRaw.indexOf('%') >= 0) {
        try { this._pendingGid = decodeURIComponent(gidRaw); } catch (e) { this._pendingGid = gidRaw; }
      }
    }
    // AI 页面接力：pages/nt/nt?filter=pending|expired|done|all（notice 技能 handoff 用；只执行一次）
    this._pendingFilter = '';
    if (options && options.filter) {
      const f = String(options.filter);
      this._pendingFilter = f === 'pending' ? 'active' : (f === 'expired' ? 'expired' : (f === 'all' || f === 'done' ? 'all' : ''));
    }
  },
  onShow() {
    share.enable();
    scrollmem.restore(this);
    if (!identity.ensure()) return;
    try { store.reload(); } catch (e) { /* ignore */ }
    this._done = doneMap();
    this._remind = remindMap();
    this.setData({ cloudEnabled: cloud.isEnabled(), isAdmin: identity.isAdmin() });
    // 需求 16：进页强制拉一次 marks（绕过 2min TTL）——通知「已处理」跨端状态立即生效
    cloud.marksPull(true).catch(function () { /* 离线保留本机状态 */ });
    this.pull();
  },
  onPullDownRefresh() {
    cloud.marksPull(true).catch(function () { /* 离线保留本机状态 */ });
    this.pull(true);
    wx.stopPullDownRefresh();
  },
  onCloudSync() { this._done = doneMap(); this._remind = remindMap(); this.pull(true); },
  refresh() { this.pull(true); },

  pull(force) {
    // 提醒列表核对（云端 active ↔ 本机缓存）：离线/未部署时静默失败，不阻塞通知拉取
    if (typeof this.syncReminders === 'function') this.syncReminders();
    if (!cloud.isEnabled()) {
      this.setData({ state: 'ready', syncText: '离线' });
      return;
    }
    const onlyLocal = !!(cloud.udOff && cloud.udOff());
    if (!force && this._lastPull && Date.now() - this._lastPull < 60000 && this._all.length) {
      this._done = doneMap();
      this._remind = remindMap();
      this.applyFilter();
      if (typeof this.jumpPendingGid === 'function') this.jumpPendingGid();
      if (typeof this.jumpPendingFilter === 'function') this.jumpPendingFilter();
      return;
    }
    const hasCards = this.data.cards.length > 0;
    this.setData({
      state: hasCards ? this.data.state : 'loading',
      // 弱网下已有缓存时不要显示「同步中」把内容遮住：先展示旧列表，刷新完成后再更新文案。
      syncText: onlyLocal ? '仅本机' : (hasCards ? '缓存 · 上次同步' : '同步中')
    });
    // 需求 12：管理员需要拿到 hidden=true 的行（供「已隐藏」筛选恢复）；非管理员由 cloud 过滤掉
    const isAdmin = identity.isAdmin();
    cloud.ntAutoPull(force, isAdmin).then((groups) => {
      this._raw = groups || [];
      this._all = this._raw.map(function (raw) { return mapGroup(raw); });
      this._lastPull = Date.now();
      // pull 不会自动重读 store：这里显式同步已处理映射（云端 marks 可能刚更新，见契约 §5.3）
      this._done = doneMap();
      this._remind = remindMap();
      const cats = ['全部'];
      this._all.forEach(function (g) { if (g.cat && !g.expired && cats.indexOf(g.cat) < 0) cats.push(g.cat); });
      // 分类下所有通知都已过期 → 不单独展示该分类（与网页 2026-11-09 同口径）
      // AI 动态分类：刷新后当前选中分类可能已消失（近期无该类通知）→ 回「全部」，避免列表空白。
      let curCat = this.data.cat || '全部';
      if (curCat !== '全部' && cats.indexOf(curCat) < 0) curCat = '全部';
      const hiddenN = this._all.filter(function (c) { return c.hidden; }).length;
      const now = new Date();
      // 2026-11-18：弱网/无网时明确显示「离线 · 显示上次同步」，不再误报「云端已同步」。
      const ns = (typeof cloud.netState === 'function' ? cloud.netState() : null) || {};
      const offline = !!ns.offline;
      const stale = !!(groups && groups._stale && groups.length);
      const syncText = onlyLocal ? '仅本机'
        : (offline ? ((groups && groups.length) ? '离线 · 显示上次同步' : '离线 · 无缓存')
          : (stale ? '缓存 · 上次同步' : '云端已同步'));
      this.setData({
        state: 'ready',
        isAdmin: isAdmin,
        hasHidden: hiddenN,
        cat: curCat,
        syncText: syncText,
        briefDate: (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日 ' + pad(now.getHours()) + ':' + pad(now.getMinutes()),
        cats: cats
      }, () => {
        this.applyFilter();
        if (typeof this.jumpPendingGid === 'function') this.jumpPendingGid();
        if (typeof this.jumpPendingFilter === 'function') this.jumpPendingFilter();
      });
    }).catch((e) => {
      // 已有缓存卡片时保留列表（断网不能把上次内容清空），只更新状态文案。
      const keep = this.data.cards.length > 0;
      this.setData({
        state: keep ? 'ready' : 'error',
        errorText: String(e && e.message || e),
        syncText: keep ? '离线 · 显示上次同步' : '同步失败'
      });
    });
  },

  // 视图：按分类/筛选/已处理/展开状态重组（契约 2026-11-14 §2）
  // 分区：主列表（含期次卡）→「资料 / 无时间」栏（默认展开）→ 已过期区；
  // 筛选：chips（全部/待处理/已截止/已隐藏）+ 顶部 5 卡（待处理/24h/7天/长期通知/最新发布），两者互斥。
  applyFilter() {
    const that = this;
    const now = Date.now();
    const isAdmin = !!this.data.isAdmin;
    let filter = String(this.data.filter || 'active');
    if (filter === 'hidden' && !isAdmin) filter = 'active';
    if (FILTERS.indexOf(filter) < 0) filter = 'active';
    let cardKey = String(this.data.cardKey || '');
    if (cardKey && CARD_FILTERS[cardKey] !== filter) cardKey = '';
    const cat = this.data.cat || '全部';
    const rawAll = this._raw || [];
    const all = this._all || [];
    const doneMap = this._done || {};

    // 契约 §2.4 统计口径（utils/notice.statOf 单一真源；与顶部 5 卡 / 工作台同口径）
    const stats = notice.statOf(rawAll, doneMap, now);
    const briefNext = (typeof this._briefNextOf === 'function') ? this._briefNextOf(now) : [];

    const viewOf = function (entry) {
      const card = entry.card;
      const occ = entry.occ || null;
      const g = that._rawById(card.id) || {};
      const userFold = that._expanded[card.id];
      if (occ) {
        // 期次卡：默认展开；状态胶囊 = 本次 M月D日（周X）HH:MM；操作 = 本次已处理（模板按 isOcc 渲染）
        return Object.assign({}, card, {
          id: card.id,
          domId: domIdOf(card.id),
          expanded: userFold === undefined ? true : !!userFold,
          closing: false,
          done: !!doneMap[card.id],
          statusLabel: card.statusLabel,
          statusCls: card.statusCls || 'recurring',
          canDone: false,
          canRemind: false,
          reminded: false,
          remindText: '',
          remindLabel: '提醒',
          nextText: '',
          admin: isAdmin,
          imgs: that._imgs[card.id] || []
        });
      }
      const expanded = userFold === undefined ? !card.expired : !!userFold;
      const done = !!doneMap[card.id];
      // 提醒状态每次重绘都从本机缓存即时计算（设置/取消/核对后无需重建整卡）
      const rmd = (that._remind || {})[card.id];
      const reminded = !!(rmd && rmd.fireAt && rmd.fireAt > now - REMIND_GRACE);
      return Object.assign({}, card, {
        domId: domIdOf(card.id),
        expanded: expanded,
        closing: false,
        done: done,
        statusLabel: done ? '已处理' : card.statusLabel,
        statusCls: done ? 'active' : card.statusCls,
        deadlineTs: notice.deadlineOf(g),
        canDone: !card.expired && !card.recurring,
        canRemind: !card.expired && !card.recurring,
        reminded: reminded,
        remindText: reminded ? fmtRemind(rmd.fireAt) : '',
        remindLabel: reminded ? ('提醒 ' + fmtRemind(rmd.fireAt)) : '提醒',
        nextText: card.recurring ? notice.nextTextOf(notice.applyOverride(g)) : '',
        admin: isAdmin,
        imgs: that._imgs[card.id] || []
      });
    };

    // 数据源顺序收集（「同档同时间」时保持数据源顺序，排序兜底用 idx）
    let mainEntries = [], expiredList = [], infoEntries = [], longtermEntries = [], latestEntries = [];
    all.forEach(function (card, idx) {
      const raw = rawAll[idx];
      if (!card || !raw) return;
      const hidden = !!card.hidden || !!raw._hidden;
      if (filter === 'hidden') {                       // 已隐藏：仅管理员；只列 hidden=true
        if (hidden) mainEntries.push({ card: card, raw: notice.applyOverride(raw), idx: idx });
        return;
      }
      if (hidden) return;                              // 需求 12：非「已隐藏」筛选不显示软删除通知
      const go = notice.applyOverride(raw);
      if (cat !== '全部' && card.cat !== cat) return;  // 分类筛选对所有视图生效
      const st = notice.statusOf(go, now);
      const subtype = notice.longtermSubtypeOf(go, now);
      const recActive = subtype === 'recur';
      const occ = recActive ? notice.occOf(go, now) : null;
      // 分区数据（wxml 按筛选展示；分类筛选已生效）
      if (recActive) longtermEntries.push({ card: card, raw: go, idx: idx, occ: occ });
      else if (subtype === 'info') infoEntries.push({ card: card, raw: go, idx: idx });

      if (filter === 'latest') { latestEntries.push({ card: card, raw: go, idx: idx }); return; }
      if (filter === 'longterm') return;               // 长期清单只由 longtermEntries 渲染
      if (filter === 'expired') {
        if (st.expired) mainEntries.push({ card: card, raw: go, idx: idx, expiredView: true });
        return;
      }
      if (st.expired) {                                // 已过期区（含「长期安排已结束」）
        expiredList.push({ card: card, raw: go, idx: idx });
        return;
      }
      if (recActive) {
        // 契约 §1.3：窗口内、未被标记已处理的期次 → 作为普通卡片进主列表（按 next 参与排序）
        if (!occ || doneMap[occ.key]) return;
        if (filter === 'urgent' || filter === 'week') {
          if (!notice.isActionable(go)) return;
        } else if (filter !== 'all' && filter !== 'active') {
          return;
        }
        mainEntries.push({ card: occCardOf(card, occ), raw: go, idx: idx, occ: occ });
        return;
      }
      if (subtype === 'info') return;                  // 资料 / 无时间：不参与主列表任何筛选
      // —— 普通通知 ——
      const isDone = !!doneMap[card.id];
      if (filter === 'active') { if (!isDone) mainEntries.push({ card: card, raw: go, idx: idx }); return; }
      if (filter === 'urgent' || filter === 'week') {
        if (isPendingNormal(go, card, doneMap, now, filter === 'week' ? 7 : 1)) mainEntries.push({ card: card, raw: go, idx: idx });
        return;
      }
      mainEntries.push({ card: card, raw: go, idx: idx });   // all（含已处理，排序置后）
    });

    // 主列表排序：期次按 next 参与（相当于「今天/24h 内」档），其余按网页同口径（含已处理置后）
    if (filter === 'all' || filter === 'active' || filter === 'urgent' || filter === 'week') {
      mainEntries.sort(function (a, b) {
        return notice.mainEntryCompare({ g: a.raw, occ: a.occ }, { g: b.raw, occ: b.occ }, doneMap, now) || (a.idx - b.idx);
      });
    }
    // 长期清单：进行中的长期安排按下次发生时间升序（算不出下次最后），同序按数据源顺序
    longtermEntries.sort(function (a, b) {
      return notice.longtermCompare(a.raw, b.raw, now) || (a.idx - b.idx);
    });
    // 最新发布：按发布时间倒序（无发布时间最后），同序按数据源顺序
    latestEntries.sort(function (a, b) {
      const ta = a.card.pubTs, tb = b.card.pubTs;
      const va = ta == null ? -Infinity : ta, vb = tb == null ? -Infinity : tb;
      if (va !== vb) return vb - va;
      return a.idx - b.idx;
    });

    const active = mainEntries.map(viewOf);
    const longtermCards = longtermEntries.map(viewOf);
    const infoCards = infoEntries.map(viewOf);
    // 已过期区只在「全部/待处理/24h/7天」出现（保持现有折叠状态）
    const showExpiredWrap = filter === 'all' || filter === 'active' || filter === 'urgent' || filter === 'week';
    const expiredCards = (filter === 'expired' || filter === 'hidden' || filter === 'longterm' || filter === 'latest')
      ? [] : expiredList.map(viewOf);
    const showExpired = filter === 'expired' ? true : (filter === 'hidden' ? false : this.data.showExpired);
    const latestCards = filter === 'latest' ? latestEntries.map(viewOf) : [];

    const emptyOf = function () {
      if (filter === 'expired') return { title: '没有已过期通知', text: '换个筛选看看' };
      if (filter === 'hidden') return { title: '没有已隐藏通知', text: '删除的通知会出现在这里，可恢复' };
      if (filter === 'longterm') return { title: '暂无长期安排', text: '长期安排到期后会自动归入已过期' };
      if (filter === 'latest') return { title: '暂无通知', text: '下拉刷新试试' };
      if (filter === 'urgent') return { title: '24 小时内没有待处理', text: '看看全部或 7 天内' };
      if (filter === 'week') return { title: '7 天内没有待处理', text: '看看全部待处理' };
      if (filter === 'all') return { title: '暂无通知', text: '下拉刷新试试' };
      return { title: '没有待处理通知', text: '换个筛选看看' };
    };
    const empt = emptyOf();
    const viewCards = filter === 'latest' ? latestCards : active;
    const listCount = filter === 'longterm' ? longtermCards.length : viewCards.length;

    this.setData({
      filter: filter,
      cardKey: cardKey,
      // 兼容旧字段：当前筛选下的主列表（已过期筛选时即过期列表）
      autoList: viewCards,
      cards: viewCards,
      longtermCards: longtermCards,
      longtermCount: longtermEntries.length,
      infoCards: infoCards,
      infoCount: infoEntries.length,
      expiredCards: expiredCards,
      expiredCount: expiredList.length,
      showExpiredWrap: showExpiredWrap,
      showExpired: showExpired,
      stats: stats,
      briefNext: briefNext,
      hasHidden: isAdmin ? all.filter(function (c) { return c.hidden; }).length : 0,
      listCount: listCount,
      emptyTitle: empt.title,
      emptyText: empt.text
    });

    // 自动展开的卡片：按需把图片转成本地临时文件（避免 base64 塞进 setData）。
    // 2026-11-17：只自动拉前 AUTO_IMG_CARDS 张「有图片」的卡（不是前 N 张卡），保证列表里能看到图；
    // 纯文件卡等用户点附件才拉完整 body；用户手动展开的卡不受限制。
    let autoImgs = 0;
    const loadDetail = function (c, idx) {
      if (!c.expanded) return;
      const userExpanded = !!(that._expanded && that._expanded[c.id]);
      if (c.imgCount && (autoImgs < AUTO_IMG_CARDS || userExpanded)) {
        autoImgs++;
        that.ensureImgs(c.id);
      }
      // 缓存里旧 body 可能没有 archive（数据管线后补、ts 签名未变）：展开时按需刷新单条 body
      if (!(idx >= AUTO_IMG_CARDS && !userExpanded) &&
        typeof that._needsGroupBody === 'function' && that._needsGroupBody(that._rawById(c.id))) that.refreshGroupBody(c.id);
    };
    active.forEach(loadDetail);
    // 资料 / 无时间栏默认展开 → 同样按需加载图片 / 补 body
    if (filter === 'all' && this.data.showInfo) infoCards.forEach(loadDetail);
  },
  // 该组是否有需要拉完整 body 的内容：
  //   a) lite 列表里被置空的图片（展开时要显示）——文件不自动拉，点开才拉，省流量；
  //   b) 旧缓存里「无 url、也无 archive」的文件（数据管线后补 archive、ts 未变）。
  _needsGroupBody(g) {
    if (!g) return false;
    if (this._bodyTried && this._bodyTried[g.id]) return false;
    return (g.items || []).some(function (it) {
      if (!it) return false;
      if (it.kind === 'img' && it.lazy) return true;
      return it.kind === 'file' && !it.url && !it.src && !notice.archiveInfo(it).ok;
    });
  },
  // 按 id 拉单条完整 body（data URI 在内存里用，不回写持久缓存）；并发去重。
  // manual=true（用户点附件/图片）允许重试；自动路径用 _bodyTried 负缓存，防止「文件确实未获取」
  // 的卡片每次 applyFilter 都重新拉同一行（2026-11-17 实测死循环 84 次/页）。
  refreshGroupBody(gid, manual) {
    this._bodyPending = this._bodyPending || {};
    this._bodyTried = this._bodyTried || {};
    this._bodyFailAt = this._bodyFailAt || {};
    if (!manual && this._bodyTried[gid]) return Promise.resolve(this._rawById(gid));
    if (!manual && this._bodyFailAt[gid] && Date.now() - this._bodyFailAt[gid] < 10000) {
      return Promise.reject(new Error('body-cooldown'));
    }
    if (this._bodyPending[gid]) return this._bodyPending[gid];
    const p = cloud.ntGroupFull(gid).then((g) => {
      if (!g) throw new Error('no-body');
      this._bodyTried[gid] = true;
      delete this._bodyFailAt[gid];
      const i = (this._raw || []).findIndex(function (x) { return x.id === gid; });
      if (i < 0) return g;
      this._raw[i] = g;
      this._all = this._raw.map(function (raw) { return mapGroup(raw); });
      this.applyFilter();
      return g;
    }).catch((e) => {
      this._bodyFailAt[gid] = Date.now();
      throw e;
    }).then((g) => {
      delete this._bodyPending[gid];
      return g;
    }, (e) => {
      delete this._bodyPending[gid];
      throw e;
    });
    this._bodyPending[gid] = p;
    return p;
  },

  _rawById(id) {
    for (let i = 0; i < this._raw.length; i++) if (this._raw[i].id === id) return this._raw[i];
    // 契约 2026-11-14 §1.3：期次卡 id = `<gid>@occ:<YYYYMMDD>` → 回退到原长期安排组（展开/原文/图片/已处理都用它）
    if (notice.isOccRef(id)) {
      const gid = notice.baseGidOfRef(id);
      for (let i = 0; i < this._raw.length; i++) if (this._raw[i].id === gid) return this._raw[i];
    }
    return null;
  },
  // 兼容旧方法名（单测/旧代码用）
  findRaw(id) { return this._rawById(id); },
  _cardById(id) {
    for (let i = 0; i < this.data.cards.length; i++) if (this.data.cards[i].id === id) return this.data.cards[i];
    const exp = this.data.expiredCards || [];
    for (let i = 0; i < exp.length; i++) if (exp[i].id === id) return exp[i];
    // 契约 2026-11-14 §2：「资料 / 无时间」栏 + 长期清单同样要能按 id 定位（展开/图片/已处理等交互）
    const inf = this.data.infoCards || [];
    for (let i = 0; i < inf.length; i++) if (inf[i].id === id) return inf[i];
    const lt = this.data.longtermCards || [];
    for (let i = 0; i < lt.length; i++) if (lt[i].id === id) return lt[i];
    return null;
  },

  // 图片：data URI -> 本地临时文件（按卡片懒加载，只转一次，避免 base64 进 setData）；
  // 附件外置后的 http(s) URL 直接交给 <image src>（网络图片无需落盘，previewImage 也支持网络图）。
  // 发布前需在微信公众平台把附件域名加入 downloadFile 合法域名（<image>/previewImage 网络图同受该校验）。
  ensureImgs(gid) {
    if (this._imgs[gid] || this._loadingImgs[gid]) return Promise.resolve(this._imgs[gid] || []);
    const g = this._rawById(gid);
    if (!g) return Promise.resolve([]);
    const all = (g.items || []).filter(function (x) { return x.kind === 'img' && (x.src || x.lazy); });
    if (!all.length) { this._imgs[gid] = []; return Promise.resolve([]); }
    // lite 列表的图片 data URI 已置空：先拉单条完整 body，再走原有落盘流程（只拉一次，按卡片懒加载）
    if (all.some(function (x) { return !x.src && x.lazy; })) {
      if (this._bodyTried && this._bodyTried[gid]) { this._imgs[gid] = []; return Promise.resolve([]); }
      this._loadingImgs[gid] = true;
      return this.refreshGroupBody(gid).then(() => {
        this._loadingImgs[gid] = false;
        return this.ensureImgs(gid);
      }).catch((e) => {
        this._loadingImgs[gid] = false;
        return [];
      });
    }
    const list = all.slice(0, 9);
    this._loadingImgs[gid] = true;
    return Promise.all(list.map(function (it) {
      const src = String(it.src || '');
      if (src.indexOf('data:') === 0) return writeDataUri(src, 'img.jpg').catch(function () { return ''; });
      return Promise.resolve(src);
    })).then((paths) => {
      const imgs = [];
      paths.forEach(function (p, i) {
        if (p) imgs.push({ path: p, caption: list[i].caption || ('图片 ' + (i + 1)) });
      });
      this._imgs[gid] = imgs;
      this._loadingImgs[gid] = false;
      this.patchCard(gid, { imgs: imgs });
      return imgs;
    }).catch(() => {
      this._loadingImgs[gid] = false;
      return [];
    });
  },
  patchCard(gid, patch) {
    const lists = [
      ['cards', this.data.cards || []],
      ['expiredCards', this.data.expiredCards || []],
      ['infoCards', this.data.infoCards || []],          // 契约 2026-11-14 §2：「资料 / 无时间」栏
      ['longtermCards', this.data.longtermCards || []]   // 契约 2026-11-14 §2：长期安排清单
    ];
    const p = {};
    let hit = false;
    lists.forEach(function (pair) {
      pair[1].forEach(function (c, i) {
        if (c.id !== gid) return;
        Object.keys(patch).forEach(function (k) { p[pair[0] + '[' + i + '].' + k] = patch[k]; });
        hit = true;
      });
    });
    if (hit) this.setData(p);
  },

  pickFilter(e) {
    const f = e.currentTarget.dataset.f;
    if (f === 'hidden' && !this.data.isAdmin) return;
    // chips 与顶部 5 卡互斥：选 chip 时取消顶部卡激活态
    this.setData({ filter: f, cardKey: '' }, () => this.applyFilter());
  },
  // 契约 2026-11-14 §2.1：点顶部数据卡 → 筛选到该口径；再点已激活卡 → 恢复「全部」
  pickCard(e) {
    const k = String((e.currentTarget.dataset && e.currentTarget.dataset.k) || '');
    if (!k || CARD_FILTERS[k] == null) return;
    if (this.data.cardKey === k) {
      this.setData({ filter: 'all', cardKey: '' }, () => this.applyFilter());
      return;
    }
    this.setData({ filter: CARD_FILTERS[k], cardKey: k }, () => this.applyFilter());
  },
  pickCat(e) { this.setData({ cat: e.currentTarget.dataset.c }, () => this.applyFilter()); },
  toggleExpired() { this.setData({ showExpired: !this.data.showExpired }, () => this.applyFilter()); },
  // 契约 2026-11-14 §2.2：「资料 / 无时间」栏常驻显示、默认展开，可点折叠（会话内状态，不落盘）
  toggleInfo() {
    if (this.data.filter !== 'all') return;             // 只在「全部」视图出现
    this.setData({ showInfo: !this.data.showInfo }, () => this.applyFilter());
  },
  toggleDetail(e) {
    const gid = e.currentTarget.dataset.gid;
    const card = this._cardById(gid);
    if (!card) return;
    const next = !card.expanded;
    this._expanded[gid] = next;
    this._foldTimers = this._foldTimers || {};
    if (this._foldTimers[gid]) { clearTimeout(this._foldTimers[gid]); delete this._foldTimers[gid]; }
    if (!next) {
      // 需求 13：收起 → 先播 .26s 高度过渡（内容保持挂载），动画结束后再移除，避免瞬间消失
      this.patchCard(gid, { expanded: false, closing: true });
      this._foldTimers[gid] = setTimeout(() => {
        delete this._foldTimers[gid];
        this.patchCard(gid, { closing: false });
      }, 280);
    } else {
      this.patchCard(gid, { expanded: true, closing: false });
      if (card.imgCount) this.ensureImgs(gid);
      // 展开时按需拉一次完整 body（补 archive 附件清单；缓存旧 body 也能自愈）
      if (typeof this._needsGroupBody === 'function' && this._needsGroupBody(this._rawById(gid))) this.refreshGroupBody(gid);
    }
  },
  // 契约 2026-11-14 §2.5：普通通知 ref=组 id；期次 ref=<gid>@occ:<YYYYMMDD>；共用 marks kind='ntdone'。
  // 期次处理后该期卡片立即消失（下一期不受影响）；长期安排定义卡不提供「已处理」。
  toggleDone(e) {
    const gid = e.currentTarget.dataset.gid;
    const raw = this._rawById(gid);
    if (!raw) return;
    const isOcc = notice.isOccRef(gid);
    if (!isOcc) {
      // 已过期 / 长期安排定义卡不显示标记按钮，这里兜底
      const st = notice.statusOf(raw);
      if (st.expired || notice.recurOf(raw)) return;
    }
    // 1) 本机立即生效并落库（store.ntDone，与 marks 同一份状态）
    const val = !this._done[gid];
    this._done[gid] = val;
    util.toast(isOcc ? (val ? '本期已处理' : '已恢复本期') : (val ? '已标记为已处理' : '已恢复为待处理'));
    // 2) 重算统计 + 简报，并整列表重绘（期次已处理 → 该期立即消失；普通已处理在待处理筛选消失、在全部置后）
    const stats = notice.statOf(this._raw || [], this._done, Date.now());
    const brief = (typeof this._briefNextOf === 'function') ? this._briefNextOf() : [];
    this.setData({ stats: stats, briefNext: brief }, () => this.applyFilter());
    // 3) 写云端 marks kind='ntdone'（失败进待补发队列；云同步关闭时同样入队，恢复后补发）
    try {
      cloud.setMark('ntdone', gid, val).then((ok) => {
        if (!ok && cloud.isEnabled()) util.toast('同步失败，稍后自动重试');
      });
    } catch (err) { /* 本机已生效，云端失败不影响 UI */ }
  },
  // 简报「最近待处理」：与 applyFilter 同一口径（§2.4：期次计入、资料/长期定义/已处理不计），供局部更新复用
  _briefNextOf(nowArg) {
    const doneMap = this._done || {};
    const now = (nowArg == null || isNaN(Number(nowArg))) ? Date.now() : Number(nowArg);
    const list = [];
    (this._raw || []).forEach((raw, idx) => {
      if (!raw || raw._hidden) return;
      const go = notice.applyOverride(raw);
      if (notice.statusOf(go, now).expired) return;
      if (notice.isActionable(go) === false) return;
      const card = (this._all || [])[idx];
      const rec = notice.recurOf(go);
      if (rec) {
        const occ = notice.isRecurEnded(go, now) ? null : notice.occOf(go, now);
        if (!occ || doneMap[occ.key]) return;
        list.push({
          id: occ.key,
          ts: occ.next,
          title: card ? card.title : notice.fmtDisplayDates(go.title || '班级通知', notice.anchorOf(go), now),
          meta: occ.label,
          alert: !!go.alert
        });
        return;
      }
      if (notice.isLongterm(go, now)) return;
      if (doneMap[card ? card.id : go.id]) return;
      // 契约 2026-11-18 §5：发布卡（无真实锚点但有发布时间）也属待处理；主显示时间为空 → 排最后
      if (!notice.hasTimeAnchor(go) && notice.publishedTsOf(go, now) == null) return;
      list.push({
        id: card ? card.id : go.id,
        ts: notice.whenOf(go, now),
        title: card ? card.title : notice.fmtDisplayDates(go.title || '班级通知', notice.anchorOf(go), now),
        meta: notice.fmtDatesCn(notice.statusOf(go, now).label, now),
        alert: !!go.alert
      });
    });
    list.sort(function (a, b) {
      const aa = a.alert ? 1 : 0, ba = b.alert ? 1 : 0;
      if (aa !== ba) return ba - aa;
      if (a.ts == null && b.ts == null) return 0;
      if (a.ts == null) return 1;
      if (b.ts == null) return -1;
      return a.ts - b.ts;
    });
    return list.slice(0, 3).map(function (x) { return { id: x.id, title: x.title, meta: x.meta, alert: x.alert }; });
  },

  // ============================================================ 管理员编辑 / 删除 / 恢复（需求 12）
  // 云端契约（plan §3）：PATCH notices?id=eq.auto_<gid>，写 override_json / hidden / edited_at / edited_by；
  // 编辑字段白名单 title/cat/summary/deadline/eventAt/timeLabel（aiSummary/expireAt 保留云端原值）。
  openEdit(e) {
    const gid = e.currentTarget.dataset.gid;
    const raw = this._rawById(gid);
    if (!raw) return;
    if (!this.data.isAdmin) { util.toast('仅管理员可编辑'); return; }
    const g = notice.applyOverride(raw);
    this.setData({
      editSheet: true,
      editGid: gid,
      editTitle: String(g.title || ''),
      editCat: String(g.cat || ''),
      editSummary: String(g.aiSummary || g.summary || ''),
      editDeadline: String(g.deadline || ''),
      editEventAt: String(g.eventAt || ''),
      editTimeLabel: String(g.timeLabel || '')
    });
  },
  closeEdit() { this.setData({ editSheet: false }); },
  onEditField(e) {
    const k = String((e.currentTarget.dataset && e.currentTarget.dataset.k) || '');
    if (!k) return;
    const patch = {};
    patch['edit' + k.charAt(0).toUpperCase() + k.slice(1)] = String((e.detail && e.detail.value) || '');
    this.setData(patch);
  },
  saveEdit() {
    const gid = String(this.data.editGid || '');
    if (!gid) return;
    const raw = this._rawById(gid);
    if (!raw) { util.toast('通知已更新，请重试'); return; }
    // 空字符串 = 清空该字段的覆盖（回落到云端原值）；保留已有 override 的其它字段
    const patch = Object.assign({}, raw._override || {});
    const fields = {
      title: this.data.editTitle,
      cat: this.data.editCat,
      summary: this.data.editSummary,
      deadline: this.data.editDeadline,
      eventAt: this.data.editEventAt,
      timeLabel: this.data.editTimeLabel
    };
    Object.keys(fields).forEach(function (k) {
      const v = String(fields[k] == null ? '' : fields[k]).trim();
      patch[k] = v === '' ? null : v;
    });
    this.setData({ editSheet: false });
    cloud.ntAdminEdit(gid, patch).then((ok) => {
      if (!ok) { util.toast('保存失败，请稍后重试'); return; }
      raw._override = Object.assign({}, patch);
      raw._editedAt = Date.now();
      raw._editedBy = identity.sid();
      this._all = (this._raw || []).map(mapGroup);
      this.applyFilter();
      util.toast('已保存（所有人可见）');
    }).catch(() => util.toast('保存失败，请稍后重试'));
  },
  adminDelete(e) {
    const gid = e.currentTarget.dataset.gid;
    if (!this.data.isAdmin) return;
    wx.showModal({
      title: '删除通知',
      content: '删除后所有人看不到这条通知（软删除，可在「已隐藏」恢复）。',
      confirmText: '删除',
      confirmColor: '#B87870',
      success: (r) => {
        if (!r.confirm) return;
        cloud.ntAdminHide(gid, true).then((ok) => {
          if (!ok) { util.toast('删除失败，请稍后重试'); return; }
          const raw = this._rawById(gid);
          if (raw) raw._hidden = true;
          this._all = (this._raw || []).map(mapGroup);
          this.applyFilter();
          util.toast('已删除（可在「已隐藏」恢复）');
        }).catch(() => util.toast('删除失败，请稍后重试'));
      }
    });
  },
  adminRestore(e) {
    const gid = e.currentTarget.dataset.gid;
    if (!this.data.isAdmin) return;
    cloud.ntAdminHide(gid, false).then((ok) => {
      if (!ok) { util.toast('恢复失败，请稍后重试'); return; }
      const raw = this._rawById(gid);
      if (raw) raw._hidden = false;
      this._all = (this._raw || []).map(mapGroup);
      this.applyFilter();
      util.toast('已恢复通知');
    }).catch(() => util.toast('恢复失败，请稍后重试'));
  },

  jumpTo(e) {
    scrollmem.cancel(this);
    const gid = e.currentTarget.dataset.gid;
    const card = this._cardById(gid);
    if (!card) return;
    this._expanded[gid] = true;
    this.patchCard(gid, { expanded: true });
    if (card.imgCount) this.ensureImgs(gid);
    setTimeout(() => {
      const q = wx.createSelectorQuery();
      q.select('#card-' + domIdOf(gid)).boundingClientRect();
      q.selectViewport().scrollOffset();
      q.exec(function (res) {
        if (res && res[0]) {
          const top = res[0].top + ((res[1] && res[1].scrollTop) || 0) - 120;
          wx.pageScrollTo({ scrollTop: Math.max(0, top), duration: 260 });
        }
      });
    }, 260);
  },

  // ============================================================ 通知提醒（v20 / 1.4.7）
  // 契约 _notify_task/CONTRACT.md §1：本机缓存 store.ntRemind（不同步到 userdata/web）；
  // 授权 wx.requestSubscribeMessage 只在用户点击链里发生；发送由云函数 notify 定时器完成。

  // 与云端核对提醒（页面加载 / 下拉刷新 / onCloudSync）：云端有→补本机；本机过期且云端无→清；
  // 失败静默（离线仍按本机缓存展示）。30s 内不重复请求。
  syncReminders() {
    if (!identity.has()) return;
    if (!wx.cloud || !wx.cloud.callFunction) return;
    if (this._remindPulling) return;
    const now = Date.now();
    if (this._remindAt && now - this._remindAt < 30000) return;
    this._remindPulling = true;
    notify.listReminders('ntremind').then((rows) => {
      this._remindPulling = false;
      this._remindAt = Date.now();
      this.applyReminderRows(rows || []);
    }).catch(() => { this._remindPulling = false; /* 静默：离线/云函数未部署时保留本机缓存 */ });
  },
  applyReminderRows(rows) {
    const now = Date.now();
    const cloudMap = {};
    (rows || []).forEach(function (r) {
      if (!r || !r.ref || r.kind === 'hw') return;
      const ref = String(r.ref);
      const fireAt = Number(r.fireAt) || 0;
      if (!fireAt) return;
      cloudMap[ref] = { ref: ref, fireAt: fireAt, label: String(r.label || ''), ts: Number(r.createdAt) || now };
    });
    const d = store.get();
    const local = (d.ntRemind && typeof d.ntRemind === 'object') ? d.ntRemind : {};
    let changed = false;
    // 云端有、本机无（或时间/文案不一致）→ 以云端为准补到本机（跨设备/重装后仍能看到提醒）
    Object.keys(cloudMap).forEach(function (ref) {
      const c = cloudMap[ref];
      const l = local[ref];
      if (!l || Math.abs((Number(l.fireAt) || 0) - c.fireAt) > 1000 || String(l.label || '') !== c.label) {
        local[ref] = c; changed = true;
      }
    });
    // 本机有、云端无：fireAt 已过 10 分钟 → 视为已发送/已取消，清掉；未到点保留（断网/列表失败不误删）
    Object.keys(local).forEach(function (ref) {
      if (cloudMap[ref]) return;
      const fireAt = Number(local[ref] && local[ref].fireAt) || 0;
      if (fireAt && fireAt < now - REMIND_GRACE) { delete local[ref]; changed = true; }
    });
    if (changed) {
      d.ntRemind = local;
      store.save();
      this._remind = remindMap();
      this.applyFilter();
    }
  },
  setLocalRemind(gid, fireAt, label) {
    const d = store.get();
    d.ntRemind = d.ntRemind || {};
    d.ntRemind[gid] = { ref: gid, fireAt: fireAt, label: label || '', ts: Date.now() };
    store.save();
    this._remind = remindMap();
    this.applyFilter();
  },
  delLocalRemind(gid) {
    const d = store.get();
    if (d.ntRemind && d.ntRemind[gid]) { delete d.ntRemind[gid]; store.save(); }
    this._remind = remindMap();
    this.applyFilter();
  },
  remindErrToast(err) {
    const m = String((err && err.message) || err || '');
    if (m === 'denied') util.toast('未授权提醒');
    else if (m === 'unsupported') util.toast('当前微信版本不支持订阅消息');
    else if (m === 'too-many') util.toast('提醒数量已满');
    else if (m === 'time-passed' || m === 'bad-fire-at' || m === 'missing-ref') util.toast('提醒时间无效');
    else util.toast('提醒服务不可用');
  },

  // 2026-11-18：手动提醒的基准时间——**活动报名开始时间优先**，其次截止。
  // 报名开始已过（<= now+60s）或没有报名窗口时回退截止；都没有 → null（下方走 20:00 兜底）。
  remindBaseOf(raw) {
    const min = Date.now() + MIN_AHEAD;
    const su = notice.signupOf(raw);
    if (su.start != null && su.start > min) {
      return { ts: su.start, action: '报名开始', kind: 'signup' };
    }
    const due = notice.deadlineOf(raw);
    if (due != null) return { ts: due, action: '截止', kind: 'deadline' };
    return null;
  },

  // 快捷提醒项（契约 §1.3 + 2026-11-18）：活动有报名开始 → 以报名开始为基准
  // （报名开始前 1 天 / 2 小时 / 30 分钟 / 报名开始时）；否则有截止 → 截止前 1 天 / 2 小时 / 30 分钟；
  // 都没有 → 今天 20:00 / 明天 20:00（已过的项被过滤即顺延）。
  remindOptionsFor(raw) {
    const min = Date.now() + MIN_AHEAD;
    const base = this.remindBaseOf(raw);
    const opts = [];
    if (base && base.kind === 'signup') {
      [['报名开始前 1 天', 86400000], ['报名开始前 2 小时', 7200000], ['报名开始前 30 分钟', 1800000], ['报名开始时', 0]].forEach(function (d) {
        const at = base.ts - d[1];
        if (at > min) opts.push({ label: d[0], at: at });
      });
    } else if (base) {
      [['截止前 1 天', 86400000], ['截止前 2 小时', 7200000], ['截止前 30 分钟', 1800000]].forEach(function (d) {
        const at = base.ts - d[1];
        if (at > min) opts.push({ label: d[0], at: at });
      });
    } else {
      // 今天 20:00 / 明天 20:00；已过则顺延到下一个 20:00（始终给 2 个未来项：今天→明天→后天）
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      const base20 = midnight.getTime() + 20 * 3600000;   // 今天 20:00
      const names = ['今天', '明天', '后天'];
      for (let i = 0; i < 3 && opts.length < 2; i++) {
        const at = base20 + i * 86400000;
        if (at <= min) continue;
        opts.push({ label: names[i] + ' 20:00', at: at });
      }
    }
    return opts;
  },

  // 卡片底部按钮：未设 → 快捷选项；已设 → 修改/取消动作面板。
  // 只传卡片自己的 data-gid，回调里重新从 _raw/_all 查卡片（列表可能因刷新变化）。
  onRemindTap(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const gid = String(ds.gid || '');
    if (!gid) return;
    const raw = this._rawById(gid);
    if (!raw) return;
    if (notice.statusOf(raw).expired) { util.toast('通知已过期'); return; }
    const local = (this._remind || {})[gid];
    if (local && local.fireAt && local.fireAt > Date.now() - REMIND_GRACE) {
      wx.showActionSheet({
        itemList: ['修改提醒', '取消提醒'],
        success: (r) => {
          if (!r) return;
          if (r.tapIndex === 0) this.chooseRemindTime(gid);
          else if (r.tapIndex === 1) this.cancelRemind(gid);
        }
      });
      return;
    }
    this.chooseRemindTime(gid);
  },
  chooseRemindTime(gid) {
    const raw = this._rawById(gid);
    if (!raw) return;
    if (notice.statusOf(raw).expired) { util.toast('通知已过期'); return; }
    const opts = this.remindOptionsFor(raw);
    const itemList = opts.map(function (o) { return o.label; });
    itemList.push('自定义…');
    wx.showActionSheet({
      itemList: itemList,
      success: (r) => {
        if (!r || r.tapIndex < 0 || r.tapIndex >= itemList.length) return;
        if (r.tapIndex >= opts.length) { this.openCustomRemind(gid); return; }
        const o = opts[r.tapIndex];
        if (!o) return;
        this.doRemind(gid, o.at, o.label);
      }
    });
  },

  // 授权 + 写云端 + 写本机；ask() 必须由本次点击同步触发（subscribeNoticeReminder 第一步即 ask）。
  doRemind(gid, fireAt, label) {
    const raw = this._rawById(gid);
    if (!raw) { util.toast('通知已更新，请重试'); return; }
    const now = Date.now();
    if (notice.statusOf(raw).expired) { util.toast('通知已过期'); return; }
    const due = notice.deadlineOf(raw);
    if (!fireAt || fireAt <= now + MIN_AHEAD) { util.toast('提醒需晚于现在 1 分钟'); return; }
    if (due != null && fireAt > due) { util.toast('提醒不能晚于截止'); return; }
    const base = this.remindBaseOf(raw);
    notify.subscribeNoticeReminder({
      id: gid,
      title: raw.title || '班级通知',
      baseTs: base ? base.ts : 0,
      deadline: due != null ? due : raw.deadline,
      // 新模板「地点」：取通知原文的地点段落（utils/notify.placeOf；缺失时云函数回落「班级工具」）
      aiSegments: raw.aiSegments
    }, fireAt, label || '').then(() => {
      this.setLocalRemind(gid, fireAt, label || '');
      util.toast('已设置提醒');
    }).catch((err) => { this.remindErrToast(err); });
  },
  cancelRemind(gid) {
    const ref = String(gid || '');
    if (!ref) return;
    notify.cancelReminder(ref, 'ntremind').then(() => {
      this.delLocalRemind(ref);
      util.toast('已取消提醒');
    }).catch(() => util.toast('提醒服务不可用'));
  },

  // 自定义提醒弹层（bottom-sheet + date/time picker，交互照搬 hw 页）
  openCustomRemind(gid) {
    const raw = this._rawById(gid);
    if (!raw) return;
    if (notice.statusOf(raw).expired) { util.toast('通知已过期'); return; }
    const now = Date.now(), min = now + MIN_AHEAD;
    const due = notice.deadlineOf(raw);
    const base = this.remindBaseOf(raw);
    let suggest;
    if (base && base.kind === 'signup') {
      // 默认提前 2 小时；报名开始太近时退到最近可用时间
      suggest = base.ts - 7200000;
      if (suggest <= min) suggest = min + 60000;
      if (due != null && suggest > due - 60000) suggest = due - 60000;
      if (suggest > base.ts) suggest = base.ts - 60000;
      if (suggest <= min) { util.toast('距离报名开始太近，无法设置'); return; }
    } else if (base) {
      if (base.ts <= min) { util.toast('距离截止太近，无法设置'); return; }
      suggest = base.ts - 7200000;                   // 默认提前 2 小时
      if (suggest <= min) suggest = min + 60000;
      if (suggest > base.ts) suggest = base.ts - 60000;
      if (suggest <= min) { util.toast('距离截止太近，无法设置'); return; }
    } else {
      const t20 = new Date();
      t20.setHours(20, 0, 0, 0);
      suggest = t20.getTime() > min ? t20.getTime() : t20.getTime() + 86400000;
      if (suggest <= min) suggest = min + 3600000;
    }
    const sd = new Date(suggest);
    const startDate = ymd(new Date(now));
    const cap = due != null ? due : (base ? base.ts : null);
    const endDate = cap != null ? ymd(new Date(cap)) : ymd(new Date(now + 30 * 86400000));
    const baseText = base ? (base.action + ' ' + ymd(new Date(base.ts)) + ' ' + hhmm(new Date(base.ts))) : '';
    const hint = baseText
      ? (baseText + ' · 提醒需晚于现在 1 分钟' + (due != null ? '且不晚于截止' : ''))
      : '提醒需晚于现在至少 1 分钟（30 天内）';
    this.setData({
      remindSheet: true,
      remindForGid: gid,
      remindForTitle: String(raw.title || '班级通知'),
      remindDate: ymd(sd),
      remindClock: hhmm(sd),
      remindStart: startDate,
      remindEnd: endDate < startDate ? startDate : endDate,
      remindHint: hint
    });
  },
  closeRemind() { this.setData({ remindSheet: false }); },
  onRemindDate(e) { this.setData({ remindDate: e.detail.value }); },
  onRemindClock(e) { this.setData({ remindClock: e.detail.value }); },
  confirmRemind() {
    const gid = String(this.data.remindForGid || '');
    const date = this.data.remindDate, clock = this.data.remindClock;
    // 先关弹层；以下校验 + doRemind 全是同步调用（requestSubscribeMessage 仍在本点击链里）
    this.setData({ remindSheet: false });
    if (!gid) return;
    const raw = this._rawById(gid);
    if (!raw) { util.toast('通知已更新，请重试'); return; }
    if (!date || !clock) { util.toast('选择提醒日期和时间'); return; }
    const d = util.toDate(date);
    if (!d) { util.toast('提醒日期无效'); return; }
    const hm = String(clock).split(':');
    d.setHours(Number(hm[0]) || 0, Number(hm[1]) || 0, 0, 0);
    const fireAt = d.getTime();
    const now = Date.now();
    const due = notice.deadlineOf(raw);
    if (fireAt <= now + MIN_AHEAD) { util.toast('提醒需晚于现在 1 分钟'); return; }
    if (due != null && fireAt > due) { util.toast('提醒不能晚于截止'); return; }
    this.doRemind(gid, fireAt, '自定义');
  },

  // 从订阅消息进入：数据 ready 后切「全部」→ 展开 → 滚动定位（只执行一次，找不到静默）
  jumpPendingGid() {
    const gid = this._pendingGid;
    if (!gid) return;
    const card = this._cardById(gid);
    if (!card) return;                       // 数据未就绪 / 该通知不在列表：留到下次 pull 再试
    this._pendingGid = '';
    this._expanded[gid] = true;              // applyFilter 会按 _expanded 展开该卡
    // 契约 2026-11-14 §2：资料栏默认展开；已过期区默认折叠。定位前先切到「全部」并展开对应分区，
    // 否则 #card-<gid> 未挂载。
    const inInfo = (this.data.infoCards || []).some(function (c) { return c.id === gid; });
    const needAll = this.data.filter !== 'all';
    const needExp = !!card.expired && !this.data.showExpired;
    const needInfo = inInfo && !this.data.showInfo;
    const jump = () => {
      this.applyFilter();
      wx.nextTick(() => { this._scrollToCard(gid); });
    };
    if (needAll || needExp || needInfo) {
      const patch = {};
      if (needAll) { patch.filter = 'all'; patch.cardKey = ''; }
      if (needExp) patch.showExpired = true;
      if (needInfo) patch.showInfo = true;
      this.setData(patch, jump);
    } else {
      jump();
    }
  },
  _scrollToCard(gid) {
    scrollmem.cancel(this);
    const q = wx.createSelectorQuery();
    q.select('#card-' + domIdOf(gid)).boundingClientRect();
    q.selectViewport().scrollOffset();
    q.exec(function (res) {
      if (res && res[0]) {
        const top = res[0].top + ((res[1] && res[1].scrollTop) || 0) - 120;
        wx.pageScrollTo({ scrollTop: Math.max(0, top), duration: 260 });
      }
    });
  },

  // 原始消息（网页端「原始消息」弹层：来源 + 发送人职位 + 分段正文）
  openRaw(e) {
    const g = this._rawById(e.currentTarget.dataset.gid);
    if (!g) return;
    const texts = (g.items || []).filter(function (it) { return it.kind === 'text' || it.kind === 'follow'; });
    // 契约 §3：原始消息弹层同样按「整卡第一条 item 的 time」替换相对日期，并统一 M月D日（相对周）
    const anchor = notice.anchorOf(g);
    const now = Date.now();
    const blocks = texts.map(function (it, i) {
      return {
        type: it.kind === 'follow' ? '补充通知' : (i === 0 ? '原始消息' : '补充通知'),
        fromName: String(it.fromName || it.from || '').trim(),
        fromBadge: String(it.fromRole || it.fromBadge || '').trim(),
        time: it.time || '',
        text: notice.fmtDisplayDates(splitText(it.text).join('\n'), anchor, now)
      };
    });
    if (!blocks.length) blocks.push({ type: '原始消息', fromName: '', fromBadge: '', time: '', text: '这条通知没有可展开的原文。' });
    this.setData({
      rawSheet: true,
      rawTitle: notice.fmtDisplayDates(g.title || '原始消息', anchor, now),
      rawMeta: g.source || g.group || '班级通知',
      rawBlocks: blocks
    });
  },
  closeRaw() { this.setData({ rawSheet: false }); },

  // 文件：预览 / 下载（data URI 写临时文件；http(s) 签名 URL 先 downloadFile；失败 reject 由调用方 toast）
  // 2026-11-17：lite 列表的 url 为空 + lazy=true → 先按 id 拉完整 body，再取 url（不缩减附件功能）。
  _filePathOf(gid, i) {
    const itemOf = () => {
      const g = this._rawById(gid);
      return g && (g.items || [])[i];
    };
    const first = itemOf();
    if (!first) return Promise.reject(new Error('no-item'));
    const ready = (first.url || first.src)
      ? Promise.resolve(first)
      : (first.lazy ? this.refreshGroupBody(gid, true).then(itemOf) : Promise.reject(new Error('no-url')));
    return ready.then((it) => {
      if (!it) throw new Error('no-item');
      const url = it.url || it.src || '';
      if (!url) throw new Error('no-url');
      return tempPathOf(url, it.name || 'file.bin');
    });
  },
  // 压缩包内文件路径：同 _filePathOf（data URI / http(s) URL 两种形态都支持；lazy 时先拉 body）
  _archivePathOf(gid, i, ai) {
    const fileOf = () => {
      const g = this._rawById(gid);
      const it = g && (g.items || [])[i];
      const a = it && it.archive;
      return a && (a.files || [])[ai];
    };
    const first = fileOf();
    if (!first) return Promise.reject(new Error('no-archive-file'));
    const ready = (first.url || first.src)
      ? Promise.resolve(first)
      : (first.lazy ? this.refreshGroupBody(gid, true).then(fileOf) : Promise.reject(new Error('no-url')));
    return ready.then((f) => {
      if (!f) throw new Error('no-archive-file');
      const url = f.url || f.src || '';
      if (!url) throw new Error('no-url');
      return tempPathOf(url, f.name || 'file.bin');
    });
  },
  // 压缩包内部文件预览（仅清单/大文件不可点；防重复点击）
  previewArchiveFile(e) {
    const gid = e.currentTarget.dataset.gid, i = Number(e.currentTarget.dataset.i);
    const ai = Number(e.currentTarget.dataset.ai);
    const g = this._rawById(gid);
    const it = g && (g.items || [])[i];
    const a = it && it.archive;
    const f = a && (a.files || [])[ai];
    if (!f) return;
    if (!f.url && !f.src && !f.lazy) { util.toast('仅清单，无法预览'); return; }
    if (this._archOpening) return;
    this._archOpening = true;
    wx.showLoading({ title: '打开中', mask: true });
    this._archivePathOf(gid, i, ai).then((path) => {
      wx.hideLoading();
      if (isImageFileOf(f.name, dataUriMime(f.url || f.src))) {
        wx.previewImage({ urls: [path], current: path });
        return;
      }
      openFileDoc({
        filePath: path, name: f.name, showMenu: true,
        fail: function () { util.toast('打开失败'); }
      });
    }).catch(() => {
      wx.hideLoading();
      util.toast('打开失败');
    }).then(() => { this._archOpening = false; }, () => { this._archOpening = false; });
  },
  // 附件行点击：有 url → 预览；压缩包已识别 → 不弹「待获取」；否则走待获取说明
  fileTap(e) {
    const gid = e.currentTarget.dataset.gid, i = Number(e.currentTarget.dataset.i);
    const g = this._rawById(gid);
    const it = g && (g.items || [])[i];
    if (!it) return;
    if (it.url || it.src || it.lazy) { this.previewFile(e); return; }
    if (notice.archiveInfo(it).ok) return;
    this.filePending(e);
  },
  // 需求 7：QQ 文件「暂未获取」——提示去来源群查看，并提供复制群名按钮（下载后云端填 url 即自动可预览/下载）
  filePending(e) {
    const gid = e.currentTarget.dataset.gid;
    const i = Number(e.currentTarget.dataset.i);
    const raw = this._rawById(gid);
    const it = raw && (raw.items || [])[i];
    // 已有 url 或 lazy（lite 列表，点开可拉完整 body）或压缩包已识别（archiveOk）不弹「待获取」
    if (!it || it.url || it.src || it.lazy || notice.archiveInfo(it).ok) return;
    const group = groupNameOf(raw);
    const name = (it && (it.name || it.text)) || '该文件';
    wx.showModal({
      title: '文件暂未获取',
      content: '「' + name + '」暂未获取。请前往 QQ 群「' + group + '」查看；下载后会自动上线。',
      confirmText: '复制群名',
      cancelText: '知道了',
      confirmColor: '#5E8F87',
      success: (r) => {
        if (!r || !r.confirm) return;
        wx.setClipboardData({
          data: group,
          success: () => util.toast('群名已复制'),
          fail: () => util.toast('复制失败，请手动记录群名')
        });
      }
    });
  },
  previewFile(e) {
    const gid = e.currentTarget.dataset.gid, i = Number(e.currentTarget.dataset.i);
    const g = this._rawById(gid);
    const it = g && (g.items || [])[i];
    if (!it) return;
    if (!it.url && !it.src && !it.lazy) { util.toast('该附件没有可打开的地址'); return; }
    wx.showLoading({ title: '打开中', mask: true });
    this._filePathOf(gid, i).then((path) => {
      wx.hideLoading();
      // URL 形态 dataUriMime 为空，图片判定走文件名后缀（file item 的 name 由数据管线保证）
      if (isImageFileOf(it.name, dataUriMime(it.url || it.src))) {
        wx.previewImage({ urls: [path], current: path });
        return;
      }
      openFileDoc({
        filePath: path, name: it.name, showMenu: false,
        fail: function () { util.toast('该文件暂不支持预览，可尝试下载'); }
      });
    }).catch((e) => {
      wx.hideLoading();
      const msg = String((e && e.message) || '');
      if (msg === 'file-too-large') util.toast('文件过大，无法预览');
      else if (/^http|download-fail|no-temp-file/.test(msg)) util.toast('附件下载失败，请稍后重试');
      else util.toast('文件打开失败');
    });
  },
  downloadFile(e) {
    const gid = e.currentTarget.dataset.gid, i = Number(e.currentTarget.dataset.i);
    const g = this._rawById(gid);
    const it = g && (g.items || [])[i];
    wx.showLoading({ title: '准备文件', mask: true });
    this._filePathOf(gid, i).then((path) => {
      wx.hideLoading();
      openFileDoc({
        filePath: path, name: it && it.name, showMenu: true,
        success: function () { util.toast('可在右上角菜单保存 / 转发'); },
        fail: function () { util.toast('该文件暂不支持打开'); }
      });
    }).catch(() => { wx.hideLoading(); util.toast('下载失败'); });
  },

  // 图片占位点击加载（前 AUTO_IMG_CARDS 张有图片的卡自动加载；其余不自动拉完整 body）
  loadImgs(e) {
    const gid = e.currentTarget.dataset.gid;
    if (!gid) return;
    wx.showLoading({ title: '加载中', mask: true });
    this.ensureImgs(gid).then((imgs) => {
      wx.hideLoading();
      if (!imgs || !imgs.length) util.toast('图片加载失败');
    }).catch(() => { wx.hideLoading(); util.toast('图片加载失败'); });
  },
  // 图片预览（全部图片）
  previewImgs(e) {
    const gid = e.currentTarget.dataset.gid;
    const done = (imgs) => {
      if (!imgs || !imgs.length) { util.toast('图片加载失败'); return; }
      wx.previewImage({ urls: imgs.map(function (x) { return x.path; }), current: imgs[0].path });
    };
    if (this._imgs[gid]) { done(this._imgs[gid]); return; }
    wx.showLoading({ title: '加载中', mask: true });
    this.ensureImgs(gid).then((imgs) => { wx.hideLoading(); done(imgs); }).catch(() => { wx.hideLoading(); util.toast('图片加载失败'); });
  },

  // 链接 / 表单 / 小程序 / 公众号：复制链接（小程序内不能直接跳外部网页）
  openUrlItem(e) {
    const gid = e.currentTarget.dataset.gid, i = Number(e.currentTarget.dataset.i);
    const g = this._rawById(gid);
    const it = g && (g.items || [])[i];
    const url = it && (it.realUrl || it.url || it.src || '');
    if (!url) { util.toast('没有可打开的链接'); return; }
    wx.setClipboardData({
      data: url,
      success: function () { util.toast('链接已复制，可在浏览器 / 微信中打开'); }
    });
  },
  copyLink(e) { this.openUrlItem(e); },

  // ============================================================ 卡片分享（2026-11-20）
  // 用户需求：通知卡片支持分享；点「分享」弹层先给预览图，再选「图片分享」或「微信卡片分享」。
  //   * 分享弹层：5:4 微信卡片封面 + 完整长图（标题/摘要/要点/时间地点/原文摘录/来源）双预览。
  //   * 图片分享：wx.showShareImageMenu（发送给朋友 / 保存到相册）；旧基础库降级保存相册。
  //   * 微信卡片分享：原生 button open-type=share；标题=通知标题，path=本页 ?gid=<id>，封面=5:4 预览图。
  openShare(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const gid = String(ds.gid || '');
    if (!gid) return;
    const card = this._cardById(gid);
    if (!card) { util.toast('通知已更新，请刷新后重试'); return; }
    this.setData({
      shareSheet: true,
      shareGid: gid,
      shareTitle: String(card.title || '班级通知'),
      shareImg: '',
      sharePoster: '',
      shareBusy: true,
      shareHint: ''
    }, () => this._makeNoticeShare(gid));
  },
  closeShare() {
    this.setData({ shareSheet: false, shareGid: '', shareImg: '', sharePoster: '', shareBusy: false, shareHint: '' });
  },
  _noticePosterOpt(card) {
    const blocks = [];
    if (card.summary) blocks.push({ label: 'AI 摘要', lines: [card.summary] });
    if ((card.points || []).length) blocks.push({ label: '要点', lines: card.points.slice(0, 3) });
    const fields = (card.segs || []).slice(0, 5).map(function (sg) { return sg.type + '：' + sg.text; });
    if (fields.length) blocks.push({ label: '关键信息', lines: fields });
    if ((card.quotes || []).length) {
      blocks.push({ label: '原文摘录', lines: card.quotes.slice(0, 2).map(function (q) { return q.text; }) });
    }
    const compose = (card.compose || []).map(function (x) { return x.n + x.label; }).join(' · ');
    if (compose) blocks.push({ label: '内容组成', lines: [compose] });
    return {
      title: card.title || '班级通知',
      sub: [card.cat, card.statusLabel].filter(Boolean).join(' · '),
      config: [
        ['来源', card.source || '班级通知'],
        ['发布者', [card.senderName, card.senderRole].filter(Boolean).join(' · ') || '—'],
        ['时间', card.timeLabel || '—'],
        ['内容组成', compose || '无']
      ],
      blocks: blocks,
      foot: '生成时间 ' + util.timeStr(),
      rec: util.recId('NT')
    };
  },
  _makeNoticeShare(gid) {
    const card = this._cardById(gid);
    if (!card) {
      this.setData({ shareBusy: false, shareHint: '通知已更新，请关闭后重试' });
      return;
    }
    const view = sharecard.buildNoticeView({ card: card, time: util.timeStr() });
    const sig = sharecard.signature(view);
    const cache = (this._shareCache || {})[gid];
    if (cache && cache.sig === sig && cache.img && cache.poster) {
      this._applyShare(gid, cache.img, cache.poster, '');
      return;
    }
    const posterOpt = this._noticePosterOpt(card);
    const self = this;
    Promise.all([
      shareflow.renderCard(this, 'shareCanvas', view),
      shareflow.renderPoster(this, 'card', posterOpt)
    ]).then(function (res) {
      if (self._dead || self.data.shareGid !== gid || !self.data.shareSheet) return;
      const img = res[0] || '';
      const poster = res[1] || '';
      if (img) self._shareCache[gid] = { sig: sig, img: img, poster: poster };
      let hint = '';
      if (!img && !poster) hint = '预览图生成失败，请关闭后重试';
      else if (!img) hint = '卡片封面生成失败，微信卡片将使用默认封面';
      else if (!poster) hint = '长图生成失败，图片分享将发送 5:4 分享图';
      self._applyShare(gid, img || sharecard.FALLBACK.notice, poster, hint);
    }, function () {
      self._applyShare(gid, sharecard.FALLBACK.notice, '', '预览图生成失败，已使用默认封面');
    });
  },
  _applyShare(gid, img, poster, hint) {
    if (this._dead || this.data.shareGid !== gid) return;
    this.setData({ shareImg: img || '', sharePoster: poster || '', shareBusy: false, shareHint: hint || '' });
  },
  // 分享回调用：优先本次弹层里生成好的图；静态回退图不当作可分享图（showShareImageMenu 只接受本地临时文件）。
  _shareImgOf(gid) {
    const isTemp = function (p) { return !!p && String(p).indexOf('/images/') !== 0; };
    if (this.data.shareGid === gid && isTemp(this.data.shareImg)) return this.data.shareImg;
    const cache = (this._shareCache || {})[gid];
    return cache && isTemp(cache.img) ? cache.img : '';
  },
  shareAsImage() {
    if (this.data.shareBusy) { util.toast('预览图生成中，请稍候'); return; }
    shareflow.showImage(this.data.sharePoster || this.data.shareImg);
  },

  onPageScroll(e) { scrollmem.onScroll(this, e); },
  onHide() { scrollmem.save(this); this._clearFoldTimers(); },
  onUnload() { this._dead = true; scrollmem.save(this); this._clearFoldTimers(); },
  // 需求 13：清理展开/收起动画的延时定时器（避免页面隐藏后 setData 抖动）
  _clearFoldTimers() {
    const t = this._foldTimers || {};
    Object.keys(t).forEach(function (k) { clearTimeout(t[k]); });
    this._foldTimers = {};
  },
  // 卡片分享走「分享」弹层里的 open-type=share 按钮（e.from === 'button'）：
  // 用当前弹层选中的卡片生成标题 / 深链 / 封面；右上角菜单仍按原逻辑分享本页。
  onShareAppMessage(e) {
    const gid = (this.data.shareSheet && this.data.shareGid) ? String(this.data.shareGid) : '';
    if (gid) {
      const card = this._cardById(gid);
      return share.message({
        title: card ? ('班级通知｜' + card.title) : '班级通知',
        path: '/pages/nt/nt',
        query: 'gid=' + encodeURIComponent(gid),
        imageUrl: this._shareImgOf(gid) || '/images/share/nt.png'
      });
    }
    const first = (this.data.cards || [])[0];
    return share.message({
      title: first ? ('班级通知｜' + first.title) : '班级通知｜简报 · 附件 · 原始消息',
      path: '/pages/nt/nt',
      imageUrl: '/images/share/nt.png'
    });
  },
  onShareTimeline() {
    const gid = String(this.data.shareGid || '');
    if (gid) {
      const card = this._cardById(gid);
      return share.timeline({
        title: card ? ('班级通知｜' + card.title) : '班级通知',
        query: gid ? ('gid=' + encodeURIComponent(gid)) : '',
        imageUrl: this._shareImgOf(gid) || '/images/share/nt.png'
      });
    }
    const first = (this.data.cards || [])[0];
    return share.timeline({
      title: first ? ('班级通知｜' + first.title) : '班级通知｜简报 · 附件 · 原始消息',
      imageUrl: '/images/share/nt.png'
    });
  }
});


