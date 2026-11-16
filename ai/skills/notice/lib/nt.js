// ai/skills/notice/lib/nt.js —— 班级通知数据层
//
// 数据来源（与主包 pages/nt/nt.js 完全一致）：
//   * 云端 public.notices 表：archived=false 的行；每个自动通知组的一行 = body 前缀 '[[CLASS_NOTICE_V1]]' + <组 JSON>
//   * 手动发布的通知行（body 为纯文本）——AI 侧同样支持，包装成单条文本通知
//   * 整表约 2MB（98% 是图片/附件 data URI）→ 解析后立刻剥离 image src / file url，只留名称、大小、类型；
//     解析结果缓存在 AI 专用键 zqa1_nt_cache_v1（含 id/ts 时间戳），5 分钟内复用，避免重复拉整表。
//
// 状态口径（逐字节对齐 utils/notice.js → ai/common/fmt.js noticeStatusOf）：
//   1) 真实截止 deadline（有 extensions 时取最后一次延期）→ 只按真实截止判断；
//      expireAt 只是「自动归档」兜底，绝不当截止时间展示；
//   2) 无截止但有 eventAt → 活动结束（archiveAt || eventAt）才算过期；
//   3) 都没有 → 只作知悉，显示「无时间」，不算过期。
//   alert 组即使过了真实截止也不算过期（仍留在待处理，提示「有新名单」）。
//   已处理 = marks kind='ntdone'（store.ntDone 镜像，与网页端互通）；置顶 = marks kind='nt'（store.ntPin）。
const rest = require('../../../common/rest.js');
const local = require('../../../common/local.js');
const auth = require('../../../common/auth.js');
const fmt = require('../../../common/fmt.js');

const PREFIX = '[[CLASS_NOTICE_V1]]';
const FULL_Q = 'select=*&order=ts.asc,id.asc&archived=eq.false';
const CACHE_KEY = 'nt_cache_v1';
const CACHE_TTL = 5 * 60 * 1000;
const SEG_ORDER = ['时间', '地点', '对象', '内容', '报名', '截止', '要求', '联系方式', '补充'];
const MAX_POINTS = 6;
const MAX_RAW = 3;
const MAX_RAW_CHARS = 500;
const MAX_FILES = 4;
const MAX_ITEMS = 20;

// ---------------------------------------------------------------- 文本清洗（对齐主包 cleanText/splitText）
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
function truncate(s, n) { return fmt.truncate(String(s == null ? '' : s), n); }
function joinBrief(lines, max) { return truncate((lines || []).slice(0, max || 2).join(' / '), 200); }

// ---------------------------------------------------------------- 条目解析 / 剥离大字段
function fileExt(name) { const m = String(name || '').match(/\.([a-z0-9]+)$/i); return m ? m[1].toLowerCase() : ''; }
function fileTypeText(name) {
  const ext = fileExt(name);
  if (ext === 'pdf') return 'PDF';
  if (ext === 'xls' || ext === 'xlsx') return 'XLS';
  if (ext === 'doc' || ext === 'docx') return 'DOC';
  if (ext === 'ppt' || ext === 'pptx') return 'PPT';
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'gif' || ext === 'webp') return '图片';
  if (ext === 'zip' || ext === 'rar' || ext === '7z') return '压缩包';
  return ext ? ext.toUpperCase() : '文件';
}
function sizeTextOf(v) {
  if (typeof v === 'string' && v.trim()) return truncate(v.trim(), 16);
  const n = Number(v) || 0;
  if (!n) return '';
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + 'MB';
  return Math.max(1, Math.round(n / 1024)) + 'KB';
}
function hostOf(url) {
  const m = String(url || '').match(/^https?:\/\/([^/]+)/i);
  return m ? truncate(m[1], 40) : '';
}
// 只保留展示需要的轻量字段：绝不保留 data URI / base64 / 原始 url
function stripItem(it) {
  if (!it || typeof it !== 'object') return null;
  const kind = String(it.kind || '');
  if (kind === 'text' || kind === 'follow') {
    return {
      kind: kind,
      text: truncate(cleanText(it.text), 2000),
      time: String(it.time || ''),
      fromName: truncate(it.fromName || it.from || '', 20),
      fromRole: truncate(it.fromRole || it.fromBadge || '', 20),
      fromBadge: truncate(it.fromBadge || '', 20)
    };
  }
  if (kind === 'img') return { kind: 'img', caption: truncate(it.caption || '', 40), ocr: !!it.ocr, time: String(it.time || '') };
  if (kind === 'file') {
    return { kind: 'file', name: truncate(it.name || it.text || '文件', 60), size: sizeTextOf(it.size), note: truncate(it.note || '', 40), time: String(it.time || ''), hasUrl: !!(it.url || it.src) };
  }
  if (kind === 'form') {
    return {
      kind: 'form', name: truncate(it.realTitle || it.name || '收集表', 60), close: truncate(it.close || '', 16),
      note: truncate(it.note || '', 40), time: String(it.time || ''), hasUrl: !!(it.realUrl || it.url)
    };
  }
  if (kind === 'link' || kind === 'mini' || kind === 'article') {
    const url = it.realUrl || it.url || '';
    return {
      kind: kind, name: truncate(it.name || it.title || (kind === 'article' ? '公众号文章' : (kind === 'mini' ? '小程序' : '链接')), 60),
      title: truncate(it.title || '', 60), account: truncate(it.account || '', 30), note: truncate(it.note || '', 40),
      host: hostOf(url), hasUrl: !!url, time: String(it.time || '')
    };
  }
  if (kind === 'merged') {
    const messages = (Array.isArray(it.messages) ? it.messages : []).slice(0, 8).map(function (m) {
      return {
        fromName: truncate((m && (m.fromName || m.from)) || '', 20),
        fromBadge: truncate((m && (m.fromRole || m.fromBadge)) || '', 20),
        time: String((m && m.time) || ''),
        text: truncate(cleanText(m && m.text), 300)
      };
    });
    return { kind: 'merged', title: truncate(it.title || '聊天记录', 60), count: Number(it.count) || messages.length, messages: messages, time: String(it.time || '') };
  }
  return { kind: kind || 'unknown' };
}
function stripGroup(g) {
  if (!g || typeof g !== 'object' || !g.id) return null;
  return {
    id: String(g.id),
    title: truncate(g.title || '班级通知', 80),
    cat: truncate(g.cat || '通知', 20),
    source: truncate(g.source || '', 60),
    group: truncate(g.group || '', 60),
    senderName: truncate(g.senderName || '', 20),
    senderRole: truncate(g.senderRole || '', 20),
    senderBadge: truncate(g.senderBadge || '', 20),
    aiSummary: truncate(g.aiSummary || '', 600),
    aiPoints: (Array.isArray(g.aiPoints) ? g.aiPoints : []).slice(0, MAX_POINTS).map(function (p) { return truncate(p, 80); }),
    aiSegments: (Array.isArray(g.aiSegments) ? g.aiSegments : []).map(function (s) {
      return { type: truncate((s && s.type) || '', 10), text: truncate((s && s.text) || '', 200) };
    }),
    deadline: g.deadline || '',
    extensions: Array.isArray(g.extensions) ? g.extensions.slice(-3).map(function (x) {
      return { deadline: (x && x.deadline) || '', reason: truncate((x && (x.reason || x.note)) || '', 60) };
    }) : [],
    expireAt: g.expireAt || '',
    eventAt: g.eventAt || '',
    timeLabel: truncate(g.timeLabel || '', 40),
    actionable: g.actionable !== false,
    alert: !!g.alert,
    ocr: !!g.ocr,
    createdAt: g.createdAt || '',
    manual: !!g.manual,
    _ts: Number(g._ts) || 0,
    items: (Array.isArray(g.items) ? g.items : []).map(stripItem).filter(Boolean)
  };
}
function manualGroup(row) {
  const ts = Number(row && row.ts) || 0;
  return stripGroup({
    id: String((row && row.id) || ('manual_' + ts)),
    title: truncate((row && row.title) || '班级通知', 80),
    cat: '通知',
    source: '班级通知',
    senderName: truncate((row && row.author) || '', 20),
    aiSummary: '',
    items: [{ kind: 'text', text: (row && row.body) || '', time: ts ? fmt.fmtDateTime(ts) : '', fromName: (row && row.author) || '' }],
    manual: true,
    _ts: ts
  });
}
function isAutoRow(row) { return !!(row && String(row.body || '').indexOf(PREFIX) === 0); }

// 整表行 → 通知组（自动通知 + 手动通知；坏 JSON 单行跳过，不影响其它通知）
function parseRows(rows) {
  const out = [];
  const seen = {};
  (Array.isArray(rows) ? rows : []).forEach(function (row) {
    if (!row || typeof row !== 'object') return;
    if (isAutoRow(row)) {
      let g = null;
      try { g = JSON.parse(String(row.body).slice(PREFIX.length)); } catch (e) { g = null; }
      if (!g || !g.id) return;
      g._ts = Number(row.ts) || Number(g.createdAt) || 0;
      const item = stripGroup(g);
      if (!item || seen[item.id]) return;
      seen[item.id] = 1;
      out.push(item);
      return;
    }
    if (!String(row.body || '').trim()) return;       // 空正文/系统行跳过
    const item = manualGroup(row);
    if (!item || seen[item.id]) return;
    seen[item.id] = 1;
    out.push(item);
  });
  return out;
}

// ---------------------------------------------------------------- 缓存 / 拉取
function readCache() {
  const c = local.getAgentCache(CACHE_KEY);
  return (c && Array.isArray(c.groups)) ? c : null;
}
function writeCache(groups) {
  return local.setAgentCache(CACHE_KEY, { at: Date.now(), groups: groups });
}
function offlineGroups() {
  const c = readCache();
  if (c && c.groups.length) return { groups: c.groups, offline: true, source: 'cache' };
  // 本机 store.notices 只有手动通知（自动通知组在主包的分块缓存里，AI 侧不读，避免依赖内部格式）
  const rows = local.readStore().notices || [];
  const groups = parseRows(rows.filter(function (r) { return r && !isAutoRow(r); }));
  return { groups: groups, offline: true, source: 'local' };
}
function load() {
  if (!rest.isConfigured() || local.getCloudOff()) return Promise.resolve(offlineGroups());
  const c = readCache();
  if (c && c.groups.length && Date.now() - (Number(c.at) || 0) < CACHE_TTL) {
    return Promise.resolve({ groups: c.groups, offline: false, source: 'cache' });
  }
  return rest.get(rest.CONFIG.tables.notices, FULL_Q).then(function (rows) {
    const groups = parseRows(rows);
    if (groups.length) writeCache(groups);
    return { groups: groups, offline: false, source: 'cloud' };
  }).catch(function (e) {
    const fb = offlineGroups();
    fb.error = (e && e.code) || 'network';
    return fb;
  });
}
function offlineEmpty(res) { return !!(res && res.offline && (!res.groups || !res.groups.length)); }

// ---------------------------------------------------------------- 状态 / 展示模型
function marks() { return local.getMarksLocal(); }
function decorate(g, m) {
  const mk = m || marks();
  const st = fmt.noticeStatusOf(g);
  return {
    g: g,
    st: st,
    done: !!(mk.ntDone && mk.ntDone[g.id]),
    pinned: !!(mk.ntPin && mk.ntPin[g.id]),
    deadline: fmt.noticeDeadlineOf(g),
    actionable: g.actionable !== false
  };
}
function deadlineTextOf(g) {
  const d = fmt.noticeDeadlineOf(g);
  return d ? fmt.fmtDateTime(d) : '';
}
function eventTextOf(g) {
  const e = fmt.noticeEventAtOf(g);
  if (e) return fmt.fmtDateTime(e);
  return fmt.noticeTimeLabelOf(g) || '';
}
function firstTextOf(g) {
  const arr = (g.items || []).filter(function (it) { return it && (it.kind === 'text' || it.kind === 'follow'); });
  if (!arr.length) return '';
  return splitText(arr[0].text).slice(0, 2).join(' ');
}
function summaryOf(g) {
  if (g.aiSummary) return truncate(g.aiSummary, 120);
  return truncate(firstTextOf(g), 120);
}
function titleOf(g) { return truncate(g.title || '班级通知', 60); }
function filesOf(g, max) {
  return (g.items || []).filter(function (it) { return it && it.kind === 'file'; }).slice(0, max || MAX_FILES).map(function (it) {
    return { name: truncate(it.name || '附件', 60), size: it.size || '', type: fileTypeText(it.name), hasUrl: !!it.hasUrl };
  });
}
function imageCountOf(g) {
  return (g.items || []).filter(function (it) { return it && it.kind === 'img'; }).length;
}
function composeOf(g) {
  const count = { file: 0, img: 0, form: 0, link: 0, mini: 0, article: 0, merged: 0, text: 0 };
  (g.items || []).forEach(function (it) { if (it && count[it.kind] != null) count[it.kind] += 1; });
  return count;
}
function timeTextOf(g) {
  const ts = Number(g._ts) || Date.parse(g.createdAt || '') || 0;
  return ts ? fmt.fmtDate(ts) : '';
}

// 列表项（listNotices / getNoticeBriefing 的 next 复用部分字段）
function cardOf(g) {
  const d = decorate(g);
  const c = composeOf(g);
  return {
    id: g.id,
    title: titleOf(g),
    category: g.cat || '通知',
    statusText: d.done ? '已处理' : d.st.label,
    statusKey: d.st.key,
    expired: !!d.st.expired,
    done: d.done,
    pinned: d.pinned,
    alert: !!g.alert,
    deadlineText: deadlineTextOf(g),
    eventText: eventTextOf(g),
    summary: summaryOf(g),
    files: filesOf(g),
    images: c.img,
    source: g.source || '',
    timeText: timeTextOf(g),
    manual: !!g.manual
  };
}

// 字段拆分（对齐 nt 页 compactSegs：类型归一到 9 类，最多 6 项，同类最多合并 2 段）
function fieldsOf(g) {
  const map = {};
  (g.aiSegments || []).forEach(function (s) {
    if (!s || !s.text) return;
    let type = String(s.type || '内容').replace('联系', '联系方式');
    if (SEG_ORDER.indexOf(type) < 0) type = '补充';
    if (!map[type]) map[type] = [];
    const txt = truncate(s.text, 120);
    if (txt && map[type].length < 2 && map[type].indexOf(txt) < 0) map[type].push(txt);
  });
  const out = {};
  let n = 0;
  SEG_ORDER.forEach(function (type) {
    if (n >= 6) return;
    if (map[type] && map[type].length) { out[type] = map[type].join('；'); n += 1; }
  });
  return out;
}
function pointsOf(g) {
  const list = (g.aiPoints || []).slice(0, MAX_POINTS).map(function (p) { return truncate(p, 80); }).filter(Boolean);
  return list;
}
function senderOf(g) {
  return {
    name: g.senderName || '',
    role: g.senderRole || g.senderBadge || '',
    badge: g.senderBadge || '',
    source: g.source || '',
    group: g.group || ''
  };
}
function ocrOf(g) {
  const flagged = !!g.ocr || (g.items || []).some(function (it) { return it && it.ocr; });
  const count = (g.items || []).filter(function (it) { return it && it.ocr; }).length;
  return { flagged: flagged, count: count };
}
function rawOf(g) {
  const texts = (g.items || []).filter(function (it) { return it && (it.kind === 'text' || it.kind === 'follow'); });
  const textsOut = texts.slice(0, MAX_RAW);
  const list = textsOut.map(function (it, i) {
    return {
      label: it.kind === 'follow' ? '补充通知' : (i === 0 ? '原始消息' : '补充通知'),
      fromName: it.fromName || '',
      fromBadge: it.fromRole || it.fromBadge || '',
      time: it.time || '',
      text: truncate(splitText(it.text).join('\n'), MAX_RAW_CHARS)
    };
  });
  return { list: list, total: texts.length };
}
// 详情条目（文件/表单/链接/小程序/公众号/合并转发；图片只给数量）
function detailItemsOf(g) {
  const out = [];
  (g.items || []).forEach(function (it) {
    if (out.length >= MAX_ITEMS) return;
    if (!it || !it.kind || it.kind === 'img' || it.kind === 'text' || it.kind === 'follow') return;
    if (it.kind === 'file') {
      out.push({ kind: 'file', name: it.name, size: it.size || '', type: fileTypeText(it.name), note: it.note || '', time: it.time || '', hasUrl: !!it.hasUrl });
      return;
    }
    if (it.kind === 'form') {
      const closeTs = parseClose(it.close);
      const closed = closeTs ? Date.now() > closeTs : false;
      out.push({ kind: 'form', name: it.name || '收集表', statusText: closed ? '已截止' : '报名中', closed: closed, closeText: it.close || '', note: it.note || '', time: it.time || '', hasUrl: !!it.hasUrl });
      return;
    }
    if (it.kind === 'link' || it.kind === 'mini' || it.kind === 'article') {
      out.push({ kind: it.kind, name: it.name || it.title || '链接', host: it.host || '', account: it.account || '', note: it.note || '', time: it.time || '', hasUrl: !!it.hasUrl });
      return;
    }
    if (it.kind === 'merged') {
      out.push({ kind: 'merged', title: it.title || '聊天记录', count: it.count || (it.messages || []).length, time: it.time || '', messages: (it.messages || []).slice(0, 6) });
    }
  });
  return { list: out, total: out.length, truncated: out.length >= MAX_ITEMS };
}
function parseClose(s) {
  const m = String(s || '').match(/^(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const now = new Date();
  return new Date(now.getFullYear(), +m[1] - 1, +m[2], +(m[3] || 23), +(m[4] || 59), 0, 0).getTime();
}

// 详情模型（getNoticeDetail）
function detailOf(g) {
  const d = decorate(g);
  const items = detailItemsOf(g);
  const raw = rawOf(g);
  const ocr = ocrOf(g);
  const files = filesOf(g, 10);
  return {
    id: g.id,
    title: titleOf(g),
    category: g.cat || '通知',
    statusText: d.done ? '已处理' : d.st.label,
    statusKey: d.st.key,
    expired: !!d.st.expired,
    done: d.done,
    pinned: d.pinned,
    alert: !!g.alert,
    actionable: d.actionable,
    deadlineText: deadlineTextOf(g),
    eventText: eventTextOf(g),
    summary: truncate(g.aiSummary || '', 600),
    points: pointsOf(g),
    fields: fieldsOf(g),
    items: items.list,
    itemsTotal: items.total,
    raw: raw.list,
    rawTotal: raw.total,
    sender: senderOf(g),
    ocr: ocr,
    files: files,
    images: imageCountOf(g),
    source: g.source || '',
    timeText: timeTextOf(g),
    manual: !!g.manual
  };
}

// ---------------------------------------------------------------- 过滤 / 排序
function filterGroups(groups, opts) {
  opts = opts || {};
  const status = opts.status || 'pending';
  const category = String(opts.category || '').trim();
  const keyword = String(opts.keyword || '').trim().toLowerCase();
  const m = marks();
  const list = [];
  (groups || []).forEach(function (g) {
    if (!g || !g.id) return;
    const d = decorate(g, m);
    if (status === 'pending') {
      if (d.st.expired || !d.actionable || d.done) return;
    } else if (status === 'expired') {
      if (!d.st.expired) return;
    } else if (status === 'done') {
      if (!d.done) return;
    }
    if (category && String(g.cat || '') !== category) return;
    if (keyword) {
      const blob = [g.title, g.aiSummary, (g.aiPoints || []).join(' '), (g.items || []).map(function (it) { return it.text || it.name || ''; }).join(' '), g.source]
        .join(' ').toLowerCase();
      if (blob.indexOf(keyword) < 0) return;
    }
    list.push({ g: g, d: d });
  });
  if (status === 'pending') {
    list.sort(function (a, b) {
      const aa = a.g.alert ? 1 : 0, ba = b.g.alert ? 1 : 0;
      if (aa !== ba) return ba - aa;
      const ta = a.d.deadline, tb = b.d.deadline;
      if (ta == null && tb == null) return (Number(b.g._ts) || 0) - (Number(a.g._ts) || 0);
      if (ta == null) return 1;
      if (tb == null) return -1;
      return ta - tb;
    });
  } else {
    list.sort(function (a, b) { return (Number(b.g._ts) || 0) - (Number(a.g._ts) || 0); });
  }
  return list;
}
function findGroup(groups, id) {
  const want = String(id == null ? '' : id).trim();
  if (!want) return null;
  for (let i = 0; i < (groups || []).length; i++) {
    if (groups[i] && String(groups[i].id) === want) return groups[i];
  }
  return null;
}
// 简报统计（只算自动+手动全部通知；已处理不计入待处理）
function briefingOf(groups) {
  const done = local.getMarksLocal().ntDone || {};
  const stat = fmt.noticeStatOf(groups || [], done);
  const next = fmt.noticeMostUrgent(groups || [], done);
  let nextCard = null;
  if (next) {
    const d = decorate(next);
    nextCard = {
      id: next.id,
      title: titleOf(next),
      statusText: d.st.label,
      deadlineText: deadlineTextOf(next)
    };
  }
  const total = (groups || []).length;
  const doneCount = (groups || []).filter(function (g) { return !!(done && done[g.id]); }).length;
  return { pending: stat.pending, urgent24h: stat.urgent, week: stat.week, expired: stat.expired, total: total, done: doneCount, next: nextCard };
}

module.exports = {
  PREFIX: PREFIX, FULL_Q: FULL_Q, CACHE_KEY: CACHE_KEY, SEG_ORDER: SEG_ORDER,
  cleanText: cleanText, splitText: splitText, truncate: truncate, fileTypeText: fileTypeText, sizeTextOf: sizeTextOf,
  stripItem: stripItem, stripGroup: stripGroup, parseRows: parseRows, isAutoRow: isAutoRow,
  load: load, offlineEmpty: offlineEmpty,
  decorate: decorate, cardOf: cardOf, detailOf: detailOf, detailItemsOf: detailItemsOf,
  fieldsOf: fieldsOf, pointsOf: pointsOf, senderOf: senderOf, ocrOf: ocrOf, rawOf: rawOf,
  filesOf: filesOf, imageCountOf: imageCountOf, summaryOf: summaryOf, deadlineTextOf: deadlineTextOf, eventTextOf: eventTextOf,
  filterGroups: filterGroups, findGroup: findGroup, briefingOf: briefingOf, marks: marks
};
