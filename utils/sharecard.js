'use strict';
// utils/sharecard.js —— 微信分享卡（5:4）绘制 + 纯数据视图
//
// 背景（2026-11-19 用户需求）：分享卡片应显示具体内容，不能总是品牌图/泛标题。
// 约束：
//   * 不用未公开 API；只用 canvas 2d + wx.canvasToTempFilePath；
//   * 页面 onShareAppMessage 必须同步返回，所以这里只做「提前生成、失败回退静态图」：
//     页面在结果渲染后异步调 render()，成功后把临时文件路径交给分享；未生成/失败时用 images/share/*.png。
//   * 绘制的文字全部来自页面已渲染的数据（抽签结果序号 / 投票标题与选项 / 通知标题与摘要），
//     不读学号、宿舍号等隐私字段；投票卡固定不画结果（百分比/票数），避免微信卡片直接预览投票结果。
//   * 画布固定 500×400（5:4），导出 1000×800；用基础 fillRect / fillText / arcTo，兼容真机与单测假 canvas。

const W = 500;
const H = 400;

const COLOR = {
  bg: '#F7F8F8',
  card: '#FFFFFF',
  ink: '#23302E',
  ink2: '#526460',
  ink3: '#8A9A96',
  line: '#E1E7E5',
  teal: '#4E9082',
  tealSoft: '#E8F1EE',
  sand: '#B98F63'
};

const FONT = 'sans-serif';
const FALLBACK = {
  draw: '/images/share/draw.png',
  vote: '/images/share/default.png',
  notice: '/images/share/nt.png',
  group: '/images/share/draw.png',
  sum: '/images/share/default.png',
  hw: '/images/share/hw.png',
  fit: '/images/share/ft.png',
  tt: '/images/share/tt.png',
  roster: '/images/share/bz.png',
  fttable: '/images/share/ft.png'
};

function txt(v) { return v == null ? '' : String(v); }
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

// 文本宽度（canvas 必须有 measureText；异常时按字符估算，保证绘制不中断）
function widthOf(g, text, font) {
  try {
    if (font) g.font = font;
    const m = g.measureText(txt(text));
    if (m && isFinite(Number(m.width))) return Number(m.width);
  } catch (e) { /* 降级 */ }
  return txt(text).length * 10;
}

// 按字符换行（中文逐字，英文/数字按字符也不会溢出）；返回最多 maxLines 行，末行加省略号
function wrapLines(g, text, maxWidth, maxLines, font) {
  const s = txt(text).replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const lines = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    const next = cur + ch;
    if (cur && widthOf(g, next, font) > maxWidth) {
      lines.push(cur);
      cur = ch;
      if (lines.length >= maxLines) break;
    } else {
      cur = next;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (!lines.length) return [];
  if (lines.length === maxLines) {
    // 还有剩余内容：末行截断到 maxWidth 内并补省略号
    let rest = '';
    for (let i = lines.join('').length; i < s.length; i++) rest += s.charAt(i);
    if (rest) {
      let last = lines[maxLines - 1];
      while (last && widthOf(g, last + '…', font) > maxWidth) last = last.slice(0, -1);
      lines[maxLines - 1] = (last || '') + '…';
    }
  }
  return lines;
}

// 单行截断（chips 名称等）
function clipText(g, text, maxWidth, font) {
  let s = txt(text);
  if (widthOf(g, s, font) <= maxWidth) return s;
  while (s.length > 1 && widthOf(g, s + '…', font) > maxWidth) s = s.slice(0, -1);
  return s + '…';
}

function roundRect(g, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!g.beginPath || !g.moveTo || !g.arcTo) { g.fillRect(x, y, w, h); return; }
  g.beginPath();
  if (g.lineTo && g.closePath) {
    g.moveTo(x + rr, y);
    g.lineTo(x + w - rr, y);
    g.arcTo(x + w, y, x + w, y + rr, rr);
    g.lineTo(x + w, y + h - rr);
    g.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    g.lineTo(x + rr, y + h);
    g.arcTo(x, y + h, x, y + h - rr, rr);
    g.lineTo(x, y + rr);
    g.arcTo(x, y, x + rr, y, rr);
    g.closePath();
  } else {
    g.rect(x, y, w, h);
  }
  g.fill();
}

function base(g) {
  g.fillStyle = COLOR.bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = COLOR.teal;
  g.fillRect(0, 0, W, 8);
}

function brand(g, right) {
  const x = 28;
  const y = 30;
  const dots = [COLOR.teal, '#6E8CA8', COLOR.sand];
  for (let i = 0; i < 3; i++) {
    g.fillStyle = dots[i];
    if (g.beginPath && g.arc) {
      g.beginPath();
      g.arc(x + i * 13, y, 4, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillRect(x + i * 13 - 4, y - 4, 8, 8);
    }
  }
  g.font = '600 12px ' + FONT;
  g.fillStyle = COLOR.ink2;
  g.fillText('班级工具', x + 42, y + 4);
  if (right) {
    g.font = '600 12px ' + FONT;
    g.fillStyle = COLOR.ink3;
    const rw = widthOf(g, right);
    g.fillText(right, W - 28 - rw, y + 4);
  }
}

function footer(g, left, right) {
  g.fillStyle = COLOR.line;
  g.fillRect(28, 350, W - 56, 1);
  g.font = '11px ' + FONT;
  g.fillStyle = COLOR.ink3;
  g.fillText(clipText(g, left, 260, '11px ' + FONT), 28, 374);
  if (right) {
    g.fillStyle = COLOR.ink3;
    const rw = widthOf(g, right, '11px ' + FONT);
    g.fillText(right, W - 28 - rw, 374);
  }
}

function pill(g, x, y, text, fg, bg) {
  g.font = '600 12px ' + FONT;
  const w = widthOf(g, text) + 20;
  g.fillStyle = bg;
  roundRect(g, x, y, w, 24, 12);
  g.fillStyle = fg;
  g.fillText(text, x + 10, y + 16);
  return w;
}

/* ------------------------------------------------------------------ 视图（纯数据，可单测） */

function buildDrawView(opt) {
  const o = opt || {};
  const cfg = o.cfg || {};
  const rows = (Array.isArray(o.rows) ? o.rows : []).map(function (r) {
    return { n: r && r.n != null ? r.n : '', nm: txt(r && r.nm) };
  });
  const parts = [];
  if (cfg.range) parts.push('范围 ' + cfg.range);
  if (cfg.count) parts.push('抽 ' + cfg.count + ' 个');
  if (cfg.dup) parts.push(cfg.dup === '是' ? '可重复' : '不重复');
  if (cfg.sel && cfg.sel !== '0') parts.push('名单 ' + cfg.sel + ' 人');
  const proof = o.proofReady && o.proofId ? txt(o.proofId) : '';
  return {
    kind: 'draw',
    title: '抽签结果',
    count: rows.length,
    subtitle: parts.join(' · '),
    rows: rows,
    proof: proof,
    time: txt(o.time)
  };
}

// 投票分享卡（2026-11-20；信息增强）：标题 / 状态 / 时限 / 发起人 / 说明 / 规则 / 4 个选项。
// **固定不画百分比/票数/总票数**：微信卡片在聊天里直接可见，结果只能点开详情查看。
function buildVoteView(opt) {
  const o = opt || {};
  const d = o.detail || {};
  const row = o.row || {};
  const options = (Array.isArray(d.options) ? d.options : []).slice(0, 4).map(function (x) {
    return { text: txt(x && x.text) };
  });
  const tags = (Array.isArray(d.tags) ? d.tags : []).map(function (t) {
    return txt(t && typeof t === 'object' ? t.text : t);
  }).filter(Boolean).slice(0, 3);
  return {
    kind: 'vote',
    title: txt(d.title || row.title || '投票'),
    status: txt(d.statusText || row.statusText),
    modeText: txt(d.modeText || row.modeText),
    ownerText: txt(d.ownerText || (d.owner ? ('发起人 ' + d.owner) : '')),
    deadlineText: txt(d.deadlineText || ''),
    desc: txt(d.desc || ''),
    tags: tags,
    hint: '结果请打开投票页查看',
    resultsMasked: true,
    options: options,
    time: txt(o.time)
  };
}

// 通知分享卡（2026-11-20；信息增强）：标题 / 分类 / 状态 / 摘要 / 2–3 条要点 /
// 时间·地点·截止等字段 / 来源与发布者 / 附件图片数量。
// 不放大段附件原文、图片本身、学号；分享由用户主动触发。
function buildNoticeView(opt) {
  const o = opt || {};
  const c = o.card || {};
  const points = (Array.isArray(c.points) ? c.points : []).filter(Boolean).slice(0, 3).map(txt);
  const priority = ['时间', '地点', '截止', '对象', '报名'];
  const fields = [];
  (Array.isArray(c.segs) ? c.segs : []).forEach(function (sg) {
    if (!sg || !sg.text) return;
    const k = txt(sg.type || '');
    if (priority.indexOf(k) < 0) return;
    if (fields.length >= 2) return;
    fields.push({ k: k, v: txt(sg.text) });
  });
  const compose = (Array.isArray(c.compose) ? c.compose : []).map(function (x) {
    return x && x.n ? (x.n + txt(x.label)) : '';
  }).filter(Boolean).join(' · ');
  const sender = [txt(c.senderName), txt(c.senderRole)].filter(Boolean).join(' · ');
  return {
    kind: 'notice',
    title: txt(c.title || '班级通知'),
    cat: txt(c.cat || '通知'),
    status: txt(c.statusLabel || ''),
    summary: txt(c.summary || ''),
    points: points,
    fields: fields,
    compose: compose,
    sender: sender,
    source: txt(c.source || ''),
    time: txt(o.time)
  };
}

// 通用 5:4 信息卡（分组 / 结果单 / 作业 / 体测 / 课表 / 名单 / 国标表）。
// opt = {title, badge, subtitle, stats:[{k,v}], lines:[{label,text}], note, footer, time}
function infoView(o) {
  o = o || {};
  return {
    kind: 'info',
    title: txt(o.title || '班级工具'),
    badge: txt(o.badge || ''),
    subtitle: txt(o.subtitle || ''),
    stats: (Array.isArray(o.stats) ? o.stats : []).filter(function (s) { return s && s.v != null && String(s.v) !== ''; })
      .slice(0, 3).map(function (s) { return { k: txt(s.k), v: txt(s.v) }; }),
    lines: (Array.isArray(o.lines) ? o.lines : []).filter(function (x) { return x && (x.label || x.text); })
      .slice(0, 6).map(function (x) { return { label: txt(x.label), text: txt(x.text) }; }),
    note: txt(o.note || ''),
    footer: txt(o.footer || ''),
    time: txt(o.time)
  };
}

function buildGroupView(opt) {
  const o = opt || {};
  const cfg = o.cfg || {};
  const groups = (Array.isArray(o.groups) ? o.groups : []).map(function (g) {
    return (g && Array.isArray(g.members) ? g.members : []);
  });
  const total = groups.reduce(function (n, m) { return n + m.length; }, 0);
  const lines = groups.slice(0, 6).map(function (members, i) {
    return {
      label: '第 ' + (i + 1) + ' 组（' + members.length + '）',
      text: members.map(function (m) { return (m && m.n != null ? String(m.n) + ' ' : '') + txt(m && m.nm); }).join('、')
    };
  });
  return infoView({
    title: '分组结果', badge: '分组',
    subtitle: [cfg.mode, groups.length + ' 组', total + ' 人'].filter(Boolean).join(' · '),
    stats: [{ k: '组数', v: groups.length }, { k: '人数', v: total || cfg.total || '' }, { k: '方式', v: cfg.mode || '' }],
    lines: lines,
    note: groups.length > 6 ? ('另有 ' + (groups.length - 6) + ' 组未在卡片展示') : '',
    footer: cfg.source ? ('成员来源 ' + cfg.source) : '班级工具 · 分组结果',
    time: o.time
  });
}

function buildSumView(opt) {
  const o = opt || {};
  const blocks = Array.isArray(o.blocks) ? o.blocks : [];
  let drawN = 0, groupN = 0;
  blocks.forEach(function (b) {
    if (String(b && b.label || '').indexOf('抽签结果') === 0) drawN = (b.items || []).length;
    if (String(b && b.label || '').indexOf('第 ') === 0) groupN += 1;
  });
  const lines = blocks.slice(0, 6).map(function (b) {
    return {
      label: txt(b && b.label),
      text: (b && b.items || []).map(function (it) { return (it.n != null && it.n !== '' ? it.n + ' ' : '') + txt(it.nm); }).join('、')
    };
  });
  return infoView({
    title: '抽签分组结果单', badge: '结果单', subtitle: o.sub || '',
    stats: [{ k: '抽签', v: drawN || '' }, { k: '分组', v: groupN || '' }, { k: '汇总块', v: blocks.length || '' }],
    lines: lines,
    note: blocks.length > 6 ? ('另有 ' + (blocks.length - 6) + ' 个汇总块') : '',
    footer: '班级工具 · 结果单',
    time: o.time
  });
}

function buildHwView(opt) {
  const o = opt || {};
  const open = Array.isArray(o.open) ? o.open : [];
  const done = Array.isArray(o.done) ? o.done : [];
  const lines = [];
  open.slice(0, 6).forEach(function (h) {
    const subj = h && h.subject ? ('[' + h.subject + '] ') : '';
    const due = h && h.dueInfo && h.dueInfo.txt ? (' · ' + h.dueInfo.txt) : '';
    lines.push({ label: txt(h && h.subject) || '作业', text: subj + txt(h && h.content) + due });
  });
  if (!lines.length) {
    done.slice(0, 6).forEach(function (h) {
      lines.push({ label: txt(h && h.subject) || '作业', text: '✓ ' + txt(h && h.content) });
    });
  }
  return infoView({
    title: '班级作业板', badge: '作业',
    subtitle: o.nick ? ('@' + o.nick) : '未完成 ' + open.length + ' 条 · 已完成 ' + done.length + ' 条',
    stats: [{ k: '未完成', v: open.length }, { k: '已完成', v: done.length }],
    lines: lines,
    note: open.length > 6 ? ('另有 ' + (open.length - 6) + ' 条未完成作业') : '',
    footer: o.nick ? ('署名 ' + o.nick) : '班级工具 · 作业板',
    time: o.time
  });
}

function buildFitView(opt) {
  const o = opt || {};
  const res = o.res || {};
  const rows = Array.isArray(res.rows) ? res.rows : [];
  const lines = rows.slice(0, 6).map(function (r) {
    const score = r && r.s != null ? (r.s + ' 分') : '缺项';
    return {
      label: txt(r && r.n),
      text: txt(r && r.v) + ' → ' + score + (r && r.p ? ('（+' + r.p + '）') : '')
    };
  });
  return infoView({
    title: '体测成绩', badge: '体测',
    subtitle: (o.sex === 'f' ? '女' : '男') + ' · ' + (o.grade === '34' ? '大三大四' : '大一大二'),
    stats: [{ k: '总评', v: res.totalText || '' }, { k: '等级', v: res.grade || '' }, { k: '加分', v: res.plus != null ? res.plus : '' }],
    lines: lines,
    note: rows.length > 6 ? ('另有 ' + (rows.length - 6) + ' 项未在卡片展示') : (res.miss ? ('缺项 ' + res.miss + ' 项') : ''),
    footer: '班级工具 · 体测算分',
    time: o.time
  });
}

function buildTtView(opt) {
  const o = opt || {};
  const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const courses = (Array.isArray(o.courses) ? o.courses : []).slice().sort(function (a, b) {
    return (Number(a.day) - Number(b.day)) || (Number(a.start) - Number(b.start));
  });
  const lines = courses.slice(0, 6).map(function (c) {
    return {
      label: DAYS[Number(c.day)] || '课程',
      text: '第' + c.start + '-' + c.end + '节 ' + txt(c.name) +
        (c.room ? (' · ' + c.room) : '') + (c.teacher ? (' · ' + c.teacher) : '')
    };
  });
  return infoView({
    title: o.wk ? ('第 ' + o.wk + ' 周课表') : '课程表', badge: '课表',
    subtitle: o.weekRange || '',
    stats: [{ k: '周次', v: o.wk ? ('第 ' + o.wk + ' 周') : '全部' }, { k: '课程', v: courses.length }],
    lines: lines,
    note: courses.length > 6 ? ('另有 ' + (courses.length - 6) + ' 门课未在卡片展示') : '',
    footer: o.term ? ('开学 ' + o.term) : '班级工具 · 课表',
    time: o.time
  });
}

function buildRosterView(opt) {
  const o = opt || {};
  const LABEL = { committee: '班委', league: '团员', all: '全班' };
  const tab = LABEL[o.tab] ? o.tab : 'committee';
  const list = Array.isArray(o.list) ? o.list : [];
  const counts = o.counts || {};
  const lines = list.slice(0, 6).map(function (m) {
    return {
      label: m && m.seat ? ('座 ' + m.seat) : '成员',
      text: txt(m && m.name) + (m && m.role ? (' · ' + m.role) : '')
    };
  });
  return infoView({
    title: '班级名单 · ' + LABEL[tab], badge: '名单',
    subtitle: '仅姓名与座号 · 不含学号',
    stats: [
      { k: '班委', v: counts.committee != null ? counts.committee : '' },
      { k: '团员', v: counts.leagueText != null ? counts.leagueText : (counts.league != null ? counts.league : '') },
      { k: '全班', v: counts.all != null ? counts.all : '' }
    ],
    lines: lines,
    note: list.length > 6 ? ('另有 ' + (list.length - 6) + ' 人未在卡片展示') : '',
    footer: '班级工具 · 名单',
    time: o.time
  });
}

function buildFttableView(opt) {
  const o = opt || {};
  const rows = Array.isArray(o.rows) ? o.rows : [];
  const lines = rows.slice(0, 6).map(function (r) {
    const vals = Array.isArray(r && r.vals) ? r.vals : [];
    return {
      label: txt(r && r.n),
      text: (txt(r && r.u) || '') + ' · 100 分 ' + (vals[0] != null ? vals[0] : '—') +
        ' / 60 分 ' + (vals[14] != null ? vals[14] : (vals[vals.length - 1] != null ? vals[vals.length - 1] : '—'))
    };
  });
  return infoView({
    title: '国标体测评分表', badge: '国标',
    subtitle: '《国家学生体质健康标准（2014 年修订）》大学组',
    stats: [{ k: '性别', v: o.sex === 'f' ? '女' : '男' }, { k: '年级', v: o.grade === '34' ? '大三/大四' : '大一/大二' }, { k: '项目', v: rows.length }],
    lines: lines,
    footer: '班级工具 · 体测国标',
    time: o.time
  });
}

// 去掉时间后的签名：同一结果不重复画
function signature(view) {
  try {
    return JSON.stringify(Object.assign({}, view || {}, { time: '' }));
  } catch (e) { return ''; }
}

/* ------------------------------------------------------------------ 绘制 */

function drawDraw(g, v) {
  base(g);
  brand(g, '抽签');
  const count = Math.max(0, num(v.count));
  g.font = '700 36px ' + FONT;
  g.fillStyle = COLOR.ink;
  g.fillText('抽签结果', 28, 92);
  g.font = '700 15px ' + FONT;
  g.fillStyle = COLOR.teal;
  const badge = count ? (count + ' 个') : '—';
  const bw = widthOf(g, badge, '700 15px ' + FONT) + 26;
  g.fillStyle = COLOR.tealSoft;
  roundRect(g, W - 28 - bw, 68, bw, 30, 15);
  g.fillStyle = COLOR.teal;
  g.fillText(badge, W - 28 - bw + 13, 88);

  g.font = '14px ' + FONT;
  g.fillStyle = COLOR.ink2;
  g.fillText(clipText(g, v.subtitle || '抽号 · 分组 · 结果单', W - 56, '14px ' + FONT), 28, 118);

  const rows = v.rows || [];
  if (!rows.length) {
    g.font = '16px ' + FONT;
    g.fillStyle = COLOR.ink3;
    g.fillText('还没有抽签结果', 28, 180);
  } else {
    const cols = 4;
    const gap = 10;
    const cw = (W - 56 - gap * (cols - 1)) / cols;
    const ch = 46;
    const max = cols * 3;
    const list = rows.slice(0, max - (rows.length > max ? 1 : 0));
    for (let i = 0; i < list.length; i++) {
      const cx = 28 + (i % cols) * (cw + gap);
      const cy = 142 + Math.floor(i / cols) * (ch + 10);
      g.fillStyle = COLOR.card;
      roundRect(g, cx, cy, cw, ch, 10);
      g.strokeStyle = COLOR.line;
      if (g.strokeRect) { g.lineWidth = 1; g.strokeRect(cx, cy, cw, ch); }
      const n = txt(list[i].n);
      g.font = '700 18px ' + FONT;
      g.fillStyle = COLOR.teal;
      g.fillText(clipText(g, n, cw - 16, '700 18px ' + FONT), cx + 9, cy + 21);
      const nm = txt(list[i].nm);
      if (nm) {
        g.font = '10px ' + FONT;
        g.fillStyle = COLOR.ink2;
        g.fillText(clipText(g, nm, cw - 16, '10px ' + FONT), cx + 9, cy + 37);
      }
    }
    if (rows.length > max) {
      const extra = rows.length - list.length;
      const idx = list.length;
      const cx = 28 + (idx % cols) * (cw + gap);
      const cy = 142 + Math.floor(idx / cols) * (ch + 10);
      g.fillStyle = COLOR.tealSoft;
      roundRect(g, cx, cy, cw, ch, 10);
      g.font = '600 13px ' + FONT;
      g.fillStyle = COLOR.teal;
      g.fillText('+' + extra, cx + 9, cy + 28);
    }
  }
  footer(g, v.proof ? ('存证 ' + v.proof) : '未存证 · 打开抽签页', v.time);
}

// 投票卡：展示标题 / 状态 / 时限 / 发起人 / 说明 / 规则 / 选项，但**不展示任何结果**
// （百分比、票数、总票数都不画；结果只能点开投票页查看）。
function drawVote(g, v) {
  base(g);
  brand(g, '投票');
  let y = 74;
  g.fillStyle = COLOR.ink;
  g.font = '700 28px ' + FONT;
  const titleLines = wrapLines(g, v.title || '投票', W - 56, 2, '700 28px ' + FONT);
  titleLines.forEach(function (line) {
    g.fillText(line, 28, y);
    y += 34;
  });
  if (!titleLines.length) y = 78;

  const statusParts = [];
  if (v.status) statusParts.push(v.status);
  if (v.modeText) statusParts.push(v.modeText);
  pill(g, 28, y - 2, statusParts.join(' · ') || '进行中', COLOR.teal, COLOR.tealSoft);
  y += 32;

  const meta = [v.ownerText, v.deadlineText].concat(v.tags || []).filter(Boolean).join(' · ');
  if (meta) {
    g.font = '12px ' + FONT;
    g.fillStyle = COLOR.ink3;
    g.fillText(clipText(g, meta, W - 56, '12px ' + FONT), 28, y + 2);
    y += 20;
  }

  if (v.desc) {
    g.font = '13px ' + FONT;
    g.fillStyle = COLOR.ink2;
    const dLines = wrapLines(g, v.desc, W - 56, 2, '13px ' + FONT);
    dLines.forEach(function (line) {
      g.fillText(line, 28, y + 2);
      y += 19;
    });
    y += 4;
  }

  const opts = v.options || [];
  if (!opts.length) {
    g.font = '14px ' + FONT;
    g.fillStyle = COLOR.ink2;
    g.fillText(clipText(g, '打开投票页查看选项并参与投票', W - 56, '14px ' + FONT), 28, y + 14);
  } else {
    // 2×2 选项卡：只写选项文字，不出现结果条 / 百分比 / 票数
    const cols = 2;
    const gap = 12;
    const cw = (W - 56 - gap) / cols;
    const ch = Math.max(34, Math.min(44, Math.floor((338 - y - 8) / 2)));
    opts.forEach(function (o2, i) {
      const cx = 28 + (i % cols) * (cw + gap);
      const cy = y + Math.floor(i / cols) * (ch + 8);
      g.fillStyle = COLOR.card;
      roundRect(g, cx, cy, cw, ch, 10);
      g.strokeStyle = COLOR.line;
      if (g.strokeRect) { g.lineWidth = 1; g.strokeRect(cx, cy, cw, ch); }
      g.font = '700 11px ' + FONT;
      g.fillStyle = COLOR.teal;
      g.fillText(String(i + 1), cx + 10, cy + ch / 2 + 4);
      g.font = '600 13px ' + FONT;
      g.fillStyle = COLOR.ink;
      g.fillText(clipText(g, o2.text, cw - 34, '600 13px ' + FONT), cx + 24, cy + ch / 2 + 4);
    });
  }
  footer(g, v.hint || '结果请打开投票页查看', v.time);
}

// 通知卡：标题 / 分类 / 状态 / 摘要 / 要点 / 时间地点等字段 / 来源 / 发布者 / 附件数量；
// 不放附件原文、图片本体与学号。
function drawNotice(g, v) {
  base(g);
  brand(g, '通知');
  let y = 74;
  g.fillStyle = COLOR.ink;
  g.font = '700 28px ' + FONT;
  const titleLines = wrapLines(g, v.title || '班级通知', W - 56, 2, '700 28px ' + FONT);
  titleLines.forEach(function (line) {
    g.fillText(line, 28, y);
    y += 34;
  });
  y += 2;

  let px = 28;
  if (v.cat) px += pill(g, px, y, v.cat, COLOR.teal, COLOR.tealSoft) + 8;
  if (v.status) {
    const room = W - 28 - px;
    if (room > 48) {
      const st = clipText(g, v.status, room - 20, '600 12px ' + FONT);
      pill(g, px, y, st, COLOR.ink2, '#EFF2F1');
    }
  }
  y += 32;

  if (v.summary) {
    g.font = '15px ' + FONT;
    g.fillStyle = COLOR.ink2;
    const lines = wrapLines(g, v.summary, W - 56, 2, '15px ' + FONT);
    lines.forEach(function (line) {
      g.fillText(line, 28, y + 4);
      y += 21;
    });
    y += 4;
  }

  (v.fields || []).slice(0, 2).forEach(function (f) {
    g.font = '600 10px ' + FONT;
    g.fillStyle = COLOR.teal;
    g.fillText(clipText(g, f.k, 40, '600 10px ' + FONT), 28, y + 13);
    g.font = '12px ' + FONT;
    g.fillStyle = COLOR.ink;
    g.fillText(clipText(g, f.v, W - 28 - 72, '12px ' + FONT), 72, y + 13);
    y += 19;
  });
  if ((v.fields || []).length) y += 4;

  const points = (v.points || []).filter(Boolean).slice(0, y > 300 ? 1 : 2);
  if (points.length) {
    g.font = '12px ' + FONT;
    g.fillStyle = COLOR.ink2;
    points.forEach(function (p) {
      g.fillText(clipText(g, '· ' + p, W - 56, '12px ' + FONT), 28, y + 3);
      y += 18;
    });
  }

  const meta = [v.sender ? ('发布 ' + v.sender) : '', v.compose || ''].filter(Boolean).join(' · ');
  if (meta) {
    g.font = '10.5px ' + FONT;
    g.fillStyle = COLOR.ink3;
    g.fillText(clipText(g, meta, W - 56, '10.5px ' + FONT), 28, Math.min(338, y + 12));
  }
  footer(g, v.source ? ('来源 ' + v.source) : '班级工具 · 通知', v.time);
}

// 通用信息卡：用于分组 / 结果单 / 作业 / 体测 / 课表 / 名单 / 国标表。
// 结构：标题 + 副标题 + 最多 3 个统计块 + 最多 6 行「标签 + 文本」+ 备注 + 页脚。
function drawInfo(g, v) {
  base(g);
  brand(g, v.badge || '分享');
  let y = 74;
  g.fillStyle = COLOR.ink;
  g.font = '700 28px ' + FONT;
  const titleLines = wrapLines(g, v.title || '班级工具', W - 56, 2, '700 28px ' + FONT);
  titleLines.forEach(function (line) {
    g.fillText(line, 28, y);
    y += 34;
  });
  if (!titleLines.length) y = 78;

  if (v.subtitle) {
    g.font = '13px ' + FONT;
    g.fillStyle = COLOR.ink2;
    g.fillText(clipText(g, v.subtitle, W - 56, '13px ' + FONT), 28, y + 2);
    y += 21;
  }

  const stats = (v.stats || []).slice(0, 3);
  if (stats.length) {
    const gap = 8;
    const cw = (W - 56 - gap * (stats.length - 1)) / stats.length;
    const ch = 46;
    stats.forEach(function (s, i) {
      const x = 28 + i * (cw + gap);
      g.fillStyle = COLOR.tealSoft;
      roundRect(g, x, y, cw, ch, 10);
      g.font = '700 20px ' + FONT;
      g.fillStyle = COLOR.teal;
      g.fillText(clipText(g, s.v, cw - 16, '700 20px ' + FONT), x + 8, y + 24);
      g.font = '10px ' + FONT;
      g.fillStyle = COLOR.ink2;
      g.fillText(clipText(g, s.k, cw - 16, '10px ' + FONT), x + 8, y + 38);
    });
    y += ch + 10;
  }

  const maxRows = Math.max(0, Math.min(6, Math.floor((336 - y) / 26)));
  (v.lines || []).slice(0, maxRows).forEach(function (line) {
    if (line.label) {
      g.font = '600 10px ' + FONT;
      g.fillStyle = COLOR.teal;
      g.fillText(clipText(g, line.label, 84, '600 10px ' + FONT), 28, y + 15);
    }
    const tx = line.label ? 118 : 28;
    g.font = '13px ' + FONT;
    g.fillStyle = COLOR.ink;
    g.fillText(clipText(g, line.text, W - 28 - tx, '13px ' + FONT), tx, y + 15);
    y += 26;
  });

  const note = v.note || '打开小程序查看完整内容';
  if (y < 330) {
    g.font = '10.5px ' + FONT;
    g.fillStyle = COLOR.ink3;
    g.fillText(clipText(g, note, W - 56, '10.5px ' + FONT), 28, 336);
  } else {
    g.font = '10.5px ' + FONT;
    g.fillStyle = COLOR.ink3;
    g.fillText(clipText(g, note, W - 56, '10.5px ' + FONT), 28, Math.min(338, y + 12));
  }
  footer(g, v.footer || '班级工具', v.time);
}

/** 绘制到 canvas（导出由 render 负责）；单测可直接调 draw 验证文字 */
function draw(g, view) {
  if (!g || !view) return false;
  if (view.kind === 'draw') drawDraw(g, view);
  else if (view.kind === 'vote') drawVote(g, view);
  else if (view.kind === 'notice') drawNotice(g, view);
  else if (view.kind === 'info') drawInfo(g, view);
  else return false;
  return true;
}

/* ------------------------------------------------------------------ 生成临时图片 */

function devicePixelRatio() {
  try {
    if (wx.getWindowInfo) return Math.min(2, Math.max(1, Number(wx.getWindowInfo().pixelRatio) || 2));
    if (wx.getSystemInfoSync) return Math.min(2, Math.max(1, Number(wx.getSystemInfoSync().pixelRatio) || 2));
  } catch (e) { /* 默认 2 */ }
  return 2;
}

/**
 * 把视图画到页面里的 <canvas type="2d" id="..."> 并导出 1000×800 JPG。
 * resolve(tempFilePath | null)；任何异常/节点不存在都 resolve(null)，页面继续用静态图。
 */
function render(page, canvasId, view) {
  return new Promise(function (resolve) {
    let done = false;
    let timer = null;
    const finish = function (p) {
      if (done) return;
      done = true;
      if (timer) { clearTimeout(timer); timer = null; }
      resolve(p || null);
    };
    // 兜底：节点查询在极端情况（页面已卸载/渲染层异常）可能不回调，不能让分享弹层一直停在「生成中」。
    timer = setTimeout(function () { finish(null); }, 2500);
    try {
      if (!view || !canvasId || !wx || typeof wx.createSelectorQuery !== 'function') return finish(null);
      if (typeof wx.canvasToTempFilePath !== 'function') return finish(null);
      const q = wx.createSelectorQuery().in(page || {});
      q.select('#' + canvasId).fields({ node: true, size: true }).exec(function (res) {
        try {
          const item = res && res[0];
          const node = item && item.node;
          if (!node || typeof node.getContext !== 'function') return finish(null);
          const dpr = devicePixelRatio();
          node.width = Math.round(W * dpr);
          node.height = Math.round(H * dpr);
          const g = node.getContext('2d');
          if (!g) return finish(null);
          if (g.setTransform) g.setTransform(1, 0, 0, 1, 0, 0);
          if (g.scale) g.scale(dpr, dpr);
          g.clearRect && g.clearRect(0, 0, W, H);
          draw(g, view);
          // 等一帧再导出，避免部分基础库 canvas 指令尚未提交
          setTimeout(function () {
            try {
              wx.canvasToTempFilePath({
                canvas: node,
                destWidth: 1000, destHeight: 800,
                fileType: 'jpg', quality: 0.92,
                success: function (r) { finish(r && r.tempFilePath); },
                fail: function () { finish(null); }
              });
            } catch (e) { finish(null); }
          }, 30);
        } catch (e) { finish(null); }
      });
    } catch (e) { finish(null); }
  });
}

module.exports = {
  W: W,
  H: H,
  FALLBACK: FALLBACK,
  COLOR: COLOR,
  wrapLines: wrapLines,
  buildDrawView: buildDrawView,
  buildVoteView: buildVoteView,
  buildNoticeView: buildNoticeView,
  buildGroupView: buildGroupView,
  buildSumView: buildSumView,
  buildHwView: buildHwView,
  buildFitView: buildFitView,
  buildTtView: buildTtView,
  buildRosterView: buildRosterView,
  buildFttableView: buildFttableView,
  infoView: infoView,
  signature: signature,
  draw: draw,
  render: render
};
