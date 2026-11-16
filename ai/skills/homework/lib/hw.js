// ai/skills/homework/lib/hw.js —— 作业数据层（云端 homework 表 + 本机 store.homework 离线兜底）
//
// 口径来源（必须与主包一致）：
//   * 截止时间：utils/util.js hwDue（date + time，time 缺省 00:00）→ ai/common/fmt.js hwDue
//   * 截止提示：utils/util.js dueInfo → fmt.hwDueInfo（「还剩 N 天 / 已过期 N 小时 / 无截止日期」）
//   * 自动清除：utils/util.js hwExpired = 截止后 3 个完整天；cloud.pruneHomework 会把过期项从本机移除并归档云端。
//     AI 侧只做「不展示」，不做删除/归档（避免 AI 对话里静默改云端数据，归档由主包下次打开作业板时完成）。
//   * 完成状态：marks kind='hw'（store.hwDone 镜像）；无 id 的老行退回行内 done 字段。
//   * 隐藏：store.hwHide[id]=true（主包「非本人删除」只隐藏自己视图）——AI 列表同样不展示。
//   * 附件：只输出名称/大小/类型，绝不输出 data URI。
const rest = require('../../../common/rest.js');
const local = require('../../../common/local.js');
const auth = require('../../../common/auth.js');
const fmt = require('../../../common/fmt.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');

const HW_QUERY = 'select=*&order=ts.asc&archived=eq.false';
const LOCAL_KEEP_MS = 5 * 60 * 1000;   // 主包 hwPull 的同款合并窗口：刚发布但云端还没返回的本机行
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

// ---------------------------------------------------------------- 附件（对齐 pages/hw/hw.js parseAtt 的类型/大小口径）
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf', txt: 'text/plain', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip'
};
function extOf(name) { const m = String(name || '').match(/\.([a-z0-9]+)$/i); return m ? m[1].toLowerCase() : ''; }
function mimeOf(name) { return MIME[extOf(name)] || 'application/octet-stream'; }
function isImg(t) { return /^image\//.test(String(t || '')); }
function fmtSize(n) {
  n = Number(n) || 0;
  return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB';
}
// attachments 列：JSON 字符串或数组。
//   主包写入格式：{ n:名称, t:mime, s:字节, d:base64 }；也兼容 { name, type, size }。
// 只回名称/大小/类型，绝不回 d。
function parseAttachments(s) {
  if (!s) return [];
  let a = s;
  if (typeof s === 'string') { try { a = JSON.parse(s); } catch (e) { return []; } }
  if (!Array.isArray(a)) return [];
  return a.filter(function (x) { return x && (x.n || x.name); }).map(function (x) {
    const name = String(x.n || x.name);
    let type = String(x.t || x.type || '');
    if (type && type.indexOf('/') < 0) type = MIME[type.toLowerCase()] || mimeOf(name);
    if (!type) type = mimeOf(name);
    const rawSize = (x.s != null) ? x.s : x.size;
    let size = Number(rawSize);
    let sizeText;
    if (!isFinite(size) || size <= 0) { size = 0; sizeText = (typeof rawSize === 'string' && rawSize.trim()) ? String(rawSize).trim() : '未知大小'; }
    else sizeText = fmtSize(size);
    return { name: name, size: size, sizeText: sizeText, type: type, isImage: isImg(type) };
  });
}

// ---------------------------------------------------------------- 状态 / 合并
function localRows() {
  const d = local.readStore();
  return (d.homework || []).filter(function (h) { return h && typeof h === 'object'; }).slice();
}
function hiddenMap() {
  const d = local.readStore();
  return (d.hwHide && typeof d.hwHide === 'object') ? d.hwHide : {};
}
function marks() { return local.getMarksLocal(); }
function isHidden(h) { return !!(h && h.id && hiddenMap()[h.id]); }
function isDone(h, m) {
  const mk = m || marks();
  if (h && h.id) return !!(mk.hwDone && mk.hwDone[h.id]);
  return !!(h && h.done);
}
function rowKey(h) {
  if (h && h.id) return String(h.id);
  return 'local_' + String((h && h.ts) || 0);
}
// 云端行 + 本机未上云的老行/刚发布行（对齐 cloud.hwPull 合并规则）
function mergeCloud(cloudRows) {
  const rows = (Array.isArray(cloudRows) ? cloudRows : []).filter(function (r) { return r && typeof r === 'object'; }).slice();
  const seen = {};
  rows.forEach(function (r) { if (r.id) seen[String(r.id)] = 1; });
  const now = Date.now();
  localRows().forEach(function (p) {
    if (!p.id) { rows.push(p); return; }                    // 老版本本机行（无云端 id）
    if (seen[String(p.id)]) return;
    if (p._pending || (p.ts && now - p.ts < LOCAL_KEEP_MS)) rows.push(p);
  });
  return rows;
}

// 拉取：云优先，失败/未配置/云同步关闭 → 本机缓存（离线兜底）
function load() {
  if (!rest.isConfigured() || local.getCloudOff()) {
    return Promise.resolve({ rows: localRows(), offline: true, source: 'local' });
  }
  return rest.get(rest.CONFIG.tables.homework, HW_QUERY).then(function (rows) {
    return { rows: mergeCloud(rows), offline: false, source: 'cloud' };
  }).catch(function (e) {
    return { rows: localRows(), offline: true, source: 'local', error: (e && e.code) || 'network' };
  });
}
function offlineEmpty(res) { return !!(res && res.offline && (!res.rows || !res.rows.length)); }

// 单行 → 展示模型（raw 保留原对象，不改云端行）
function decorate(h) {
  const done = isDone(h);
  const due = fmt.hwDue(h);
  const info = fmt.hwDueInfo(h);
  const overdue = !done && due != null && due <= Date.now();
  return {
    raw: h,
    id: rowKey(h),
    cloudId: h && h.id ? String(h.id) : '',
    due: due,
    done: done,
    hidden: isHidden(h),
    purged: fmt.hwExpired(h),        // 截止后 3 个完整天：作业板已自动清除，AI 不再展示
    overdue: overdue,
    status: done ? 'done' : (overdue ? 'overdue' : 'pending'),
    dueInfo: info
  };
}
function truncate(s, n) { return fmt.truncate(String(s == null ? '' : s), n); }
function canDelete(h) {
  if (!h) return false;
  if (auth.isAdmin()) return true;
  const sid = auth.sid();
  if (!sid) return !h.id;
  if (h.owner) return String(h.owner) === sid;
  if (h.author) return String(h.author) === sid;
  return !h.id;
}

// 列表项（structuredContent.items 元素）
function cardOf(d) {
  const h = d.raw;
  const atts = parseAttachments(h.attachments);
  return {
    id: d.id,
    subject: truncate(String(h.subject || '').trim(), 40),
    content120: truncate(String(h.content || '').trim(), 120),
    dueText: d.dueInfo.txt,
    leftText: d.dueInfo.left == null ? '' : fmt.leftText(d.dueInfo.left),
    date: String(h.date || ''),
    time: String(h.time || ''),
    done: d.done,
    status: d.status,
    author: truncate(String(h.author || ''), 20),
    attachmentCount: atts.length,
    createdText: h.ts ? fmt.fmtDateTime(Number(h.ts)) : ''
  };
}
// 详情（getHomeworkDetail）
function detailOf(d) {
  const h = d.raw;
  return Object.assign(cardOf(d), {
    content: String(h.content || '').trim(),
    due: String(h.due || ''),
    dueDateText: h.date ? (String(h.date) + (h.time ? ' ' + String(h.time) : ' 00:00')) : '',
    attachments: parseAttachments(h.attachments),
    pending: !!(h._pending),                 // 本机已保存、云端尚未确认
    canDelete: canDelete(h)
  });
}

// 过滤：status=pending/all/done/overdue；subject/keyword 模糊；隐藏项永不展示
function listItems(rows, opts) {
  opts = opts || {};
  const status = opts.status || 'pending';
  const subject = String(opts.subject || '').trim().toLowerCase();
  const keyword = String(opts.keyword || '').trim().toLowerCase();
  const out = [];
  (rows || []).forEach(function (h) {
    const d = decorate(h);
    if (d.hidden || d.purged) return;
    if (status === 'pending' && d.status !== 'pending') return;
    if (status === 'overdue' && d.status !== 'overdue') return;
    if (status === 'done' && !d.done) return;
    const subj = String(h.subject || '').toLowerCase();
    if (subject && subj.indexOf(subject) < 0) return;
    if (keyword) {
      const blob = (subj + ' ' + String(h.content || '') + ' ' + String(h.author || '')).toLowerCase();
      if (blob.indexOf(keyword) < 0) return;
    }
    out.push(d);
  });
  out.sort(function (a, b) {
    const rank = function (d) { return d.status === 'done' ? 2 : (d.status === 'overdue' ? 1 : 0); };
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.status === 'done') return (Number(b.raw.ts) || 0) - (Number(a.raw.ts) || 0);
    if (a.due == null && b.due == null) return 0;
    if (a.due == null) return 1;
    if (b.due == null) return -1;
    return a.due - b.due;
  });
  return out;
}

// 汇总：pending=待交（含已过截止但仍未到三天清除期的），overdue 是其中子集，done=已完成
function summary(rows) {
  let pending = 0, done = 0, overdue = 0;
  const open = [];
  (rows || []).forEach(function (h) {
    const d = decorate(h);
    if (d.hidden || d.purged) return;
    if (d.done) { done += 1; return; }
    pending += 1;
    if (d.overdue) overdue += 1;
    if (d.due != null) open.push(d);
  });
  open.sort(function (a, b) { return a.due - b.due; });
  const next = open.length ? {
    id: open[0].id,
    subject: truncate(String(open[0].raw.subject || '').trim(), 40),
    leftText: open[0].dueInfo.left == null ? '' : fmt.leftText(open[0].dueInfo.left)
  } : null;
  return { pending: pending, done: done, overdue: overdue, next: next };
}

// ---------------------------------------------------------------- 写操作
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
// 云端行（列与 cloud.hwRow 完全一致；不带 _pending 等本机字段）
function cloudRow(h) {
  return {
    id: String(h.id),
    subject: String(h.subject || ''),
    content: String(h.content || ''),
    due: String(h.due || ''),
    date: String(h.date || ''),
    time: String(h.time || ''),
    author: String(h.author || ''),
    owner: String(h.owner || ''),
    attachments: String(h.attachments || ''),
    done: false,
    archived: false,
    ts: Number(h.ts) || Date.now()
  };
}
// 先写本机（作业板立即可见）；返回本机行
function saveLocal(h) {
  local.patchStore(function (d) {
    d.homework = (d.homework || []).filter(function (x) { return !(x && x.id === h.id); });
    d.homework.push(h);
    return d;
  });
  return h;
}
function clearPending(id) {
  local.patchStore(function (d) {
    (d.homework || []).forEach(function (x) { if (x && x.id === id) x._pending = false; });
    return d;
  });
}
function removeLocal(id) {
  return local.patchStore(function (d) {
    d.homework = (d.homework || []).filter(function (x) { return !(x && String(x.id) === String(id)); });
    return d;
  });
}

// 发布：confirmed=true 才执行；云端成功=所有人可见；失败=本机 pending 行，主包 cloudPull 自动补发
function publish(input) {
  const subject = String(input.subject == null ? '' : input.subject).trim();
  const content = String(input.content == null ? '' : input.content).trim();
  if (!content) return Promise.resolve(result.invalid('缺少作业内容 content。请先让用户说明要发布的作业内容，再重试。'));
  if (subject.length > 40) return Promise.resolve(result.invalid('科目 subject 过长（最多 40 字），请精简后重试。'));
  if (content.length > 2000) return Promise.resolve(result.invalid('作业内容过长（最多 2000 字），请精简后重试。'));

  const dueDate = String(input.dueDate == null ? '' : input.dueDate).trim();
  const dueTime = String(input.dueTime == null ? '' : input.dueTime).trim();
  if (dueTime && !dueDate) return Promise.resolve(result.invalid('传了 dueTime 就必须同时传 dueDate（格式 YYYY-MM-DD）。'));
  let dueTs = null;
  if (dueDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !fmt.parseDate(dueDate)) {
      return Promise.resolve(result.invalid('dueDate 格式不正确，应为 YYYY-MM-DD（例如 2026-11-08）。'));
    }
    if (dueTime) {
      const m = dueTime.match(/^(\d{1,2}):(\d{2})$/);
      if (!m || +m[1] > 23 || +m[2] > 59) {
        return Promise.resolve(result.invalid('dueTime 格式不正确，应为 HH:mm（例如 18:00）。'));
      }
    }
    const dh = fmt.hwDue({ date: dueDate, time: dueTime });
    dueTs = dh;
    if (dueTs != null && dueTs <= Date.now()) {
      return Promise.resolve(result.invalid('截止时间已经过去（' + dueDate + (dueTime ? ' ' + dueTime : '') + '）。请改到未来时间，或不传 dueDate 表示无截止日期。'));
    }
  }
  const row = {
    id: genId(),
    subject: subject,
    content: content,
    due: dueDate ? (dueDate + (dueTime ? ' ' + dueTime : '')) : '',
    date: dueDate,
    time: dueDate ? dueTime : '',
    author: auth.name(),
    owner: auth.sid(),
    attachments: '',
    done: false,
    archived: false,
    ts: Date.now(),
    _pending: true
  };
  saveLocal(row);
  const isLocalOnly = !rest.isConfigured() || local.getCloudOff();
  if (isLocalOnly) {
    return Promise.resolve(result.ok(
      '已把' + labelOf(row) + '保存到本机。当前云同步未开启或未配置，联网开启后会自动补发；其他同学暂时看不到。请告诉用户这一点。',
      {
        pagePath: handoff.PAGES.hw + '?tab=pending',
        title: '作业板',
        ok: true, homeworkId: row.id, subject: subject, dueText: dueTextOf(row), pending: true
      },
      { handoff: handoff.handoffTo('hw', { tab: 'pending', id: row.id }),
        _meta: { cardData: { title: '已发布作业（本机）', items: [cardOf(decorate(row))], total: 1, offHint: true } } }
    ));
  }
  return rest.post(rest.CONFIG.tables.homework, [cloudRow(row)]).then(function () {
    clearPending(row.id);
    return result.ok(
      '已发布' + labelOf(row) + '，全班同学都能在作业板看到。请展示作业卡片，并提示同学注意截止时间。',
      {
        pagePath: handoff.PAGES.hw + '?tab=pending',
        title: '作业板',
        ok: true, homeworkId: row.id, subject: subject, dueText: dueTextOf(row), pending: false
      },
      { handoff: handoff.handoffTo('hw', { tab: 'pending', id: row.id }),
        _meta: { cardData: { title: '已发布作业', items: [cardOf(decorate(row))], total: 1 } } }
    );
  }).catch(function (e) {
    // 本机已保存，交给主包 cloudPull 的 flushPending 自动补发（离线兜底，不重复创建）
    return result.ok(
      '已把' + labelOf(row) + '保存到本机，但云端同步失败（网络异常）。联网后会自动补发，其他同学暂时看不到；请先不要重复发布。',
      {
        pagePath: handoff.PAGES.hw + '?tab=pending',
        title: '作业板',
        ok: true, homeworkId: row.id, subject: subject, dueText: dueTextOf(row), pending: true,
        pendingReason: (e && e.code) || 'network'
      },
      { handoff: handoff.handoffTo('hw', { tab: 'pending', id: row.id }),
        _meta: { cardData: { title: '已发布作业（待同步）', items: [cardOf(decorate(row))], total: 1, offHint: true } } }
    );
  });
}
function labelOf(h) {
  const d = decorate(h);
  const subject = String(h.subject || '').trim();
  return (subject ? '【' + subject + '】' : '') + '作业' + (d.dueInfo && d.dueInfo.txt ? '（' + d.dueInfo.txt + '）' : '');
}
function dueTextOf(h) { return decorate(h).dueInfo.txt; }

// 删除：本人或管理员；非本人非管理员 → 权限不足。云端先归档成功再删本机，避免「本地没了云端还在」
function remove(id) {
  return load().then(function (res) {
    const target = (res.rows || []).filter(function (h) { return rowKey(h) === String(id); })[0] || null;
    if (!target) {
      return result.invalid('没有找到 homeworkId=' + id + ' 的作业。请先调用 listHomework 获取有效 id，不要编造。');
    }
    if (!canDelete(target)) {
      return result.fail('这条作业不是你发布的，只有发布者本人或管理员可以删除。可以改为把它从自己的列表隐藏（在作业板长按/左滑操作），不要重复尝试删除。', 'permission-denied');
    }
    const subject = String(target.subject || '').trim();
    const title = (subject ? '【' + subject + '】' : '') + '作业';
    const localOnly = !target.id || target._pending || !rest.isConfigured() || local.getCloudOff();
    if (localOnly) {
      removeLocal(id);
      return result.ok('已删除本机的' + title + '。请在作业板确认它已消失。', {
        pagePath: handoff.PAGES.hw + '?tab=all', title: '作业板', ok: true, homeworkId: String(id), deleted: true
      }, {
        handoff: handoff.handoffTo('hw', { tab: 'all' }),
        _meta: { cardData: { title: '作业已删除', items: [], emptyText: '已从本机删除（尚未上云，云端无这条作业）' } }
      });
    }
    const cloudId = String(target.id);
    return rest.byId(rest.CONFIG.tables.homework, cloudId).then(function (row) {
      if (!row) throw rest.makeErr('http4xx', '云端行不存在');
      row.archived = true;
      return rest.upsert(rest.CONFIG.tables.homework, [row]);
    }).then(function () {
      removeLocal(id);
      return result.ok('已删除' + title + '，全班同学都不再看到它。请勿重复删除。', {
        pagePath: handoff.PAGES.hw + '?tab=all', title: '作业板', ok: true, homeworkId: cloudId, deleted: true
      }, {
        handoff: handoff.handoffTo('hw', { tab: 'all' }),
        _meta: { cardData: { title: '作业已删除', items: [], emptyText: '已删除，全班同学都不再看到它' } }
      });
    }).catch(function (e) {
      return result.fail('删除未完成：云端没有响应（' + ((e && e.code) || 'network') + '）。本机数据仍保留，请稍后重试。', (e && e.code) || 'network');
    });
  });
}

// 完成标记：云端 marks（先写本机）；无 id 的老行只写行内 done
function setDone(id, done) {
  return load().then(function (res) {
    const target = (res.rows || []).filter(function (h) { return rowKey(h) === String(id); })[0] || null;
    if (!target) {
      return result.invalid('没有找到 homeworkId=' + id + ' 的作业。请先调用 listHomework 获取有效 id，不要编造。');
    }
    const msg = done ? '已完成' : '未完成';
    if (!target.id) {
      local.patchStore(function (d) {
        (d.homework || []).forEach(function (x) { if (x && rowKey(x) === String(id)) x.done = !!done; });
        return d;
      });
      return result.ok('已把本机这条作业标记为' + msg + '（它还没同步到云端，先在作业板确认）。', {
        pagePath: handoff.PAGES.hw + (done ? '?tab=done' : '?tab=pending'),
        title: '作业板', ok: true, homeworkId: String(id), done: !!done, subject: String(target.subject || ''), pending: true
      }, { handoff: handoff.handoffTo('hw', { tab: done ? 'done' : 'pending', id: String(id) }) });
    }
    const subject = String(target.subject || '').trim();
    const title = (subject ? '【' + subject + '】' : '') + '作业';
    return require('../../../common/marks.js').setMark('hw', String(target.id), !!done).then(function (r) {
      const synced = !!(r && r.ok);
      const text = synced
        ? ('已把' + title + '标记为' + msg + '，作业板和网页端的勾选状态已同步。')
        : ('已在本机把' + title + '标记为' + msg + '；云端暂时没同步成功，联网后会自动补发。');
      return result.ok(text, {
        pagePath: handoff.PAGES.hw + (done ? '?tab=done' : '?tab=pending'),
        title: '作业板', ok: true, homeworkId: String(target.id), done: !!done, subject: subject, pending: !synced
      }, { handoff: handoff.handoffTo('hw', { tab: done ? 'done' : 'pending', id: String(target.id) }),
        _meta: { cardData: { title: '作业状态', items: [cardOf(decorate(target))], total: 1 } } });
    });
  });
}

module.exports = {
  MAX_LIMIT: MAX_LIMIT, DEFAULT_LIMIT: DEFAULT_LIMIT,
  MIME: MIME, extOf: extOf, mimeOf: mimeOf, fmtSize: fmtSize, parseAttachments: parseAttachments,
  load: load, offlineEmpty: offlineEmpty, localRows: localRows,
  decorate: decorate, cardOf: cardOf, detailOf: detailOf, listItems: listItems, summary: summary,
  publish: publish, remove: remove, setDone: setDone, canDelete: canDelete, rowKey: rowKey,
  truncate: truncate, labelOf: labelOf
};
