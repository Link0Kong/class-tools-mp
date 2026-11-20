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
  group: '/images/share/draw.png'
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

// 投票分享卡（2026-11-20）：只放标题 / 状态 / 选项文字，**不画百分比与票数**。
// 微信卡片在聊天里直接可见，若把结果画进封面，未打开小程序就能看到投票结果（结果隐藏/截止后可见也会被绕过）；
// 因此分享卡固定遮住结果（detail.resultsHidden 不再影响绘制），结果只能点开投票详情页查看。
function buildVoteView(opt) {
  const o = opt || {};
  const d = o.detail || {};
  const row = o.row || {};
  const options = (Array.isArray(d.options) ? d.options : []).slice(0, 4).map(function (x) {
    return { text: txt(x && x.text) };
  });
  return {
    kind: 'vote',
    title: txt(d.title || row.title || '投票'),
    status: txt(d.statusText || row.statusText),
    modeText: txt(d.modeText || row.modeText),
    hint: '结果请打开投票页查看',
    resultsMasked: true,
    options: options,
    time: txt(o.time)
  };
}

// 通知分享卡（2026-11-20）：通知工具每张卡片的分享预览图。
// 只放卡片上已公开的展示字段（标题 / 分类 / 状态 / AI 摘要 / 要点 / 来源 / 时间），
// 不带附件原文、图片、学号、收件人等隐私内容。
function buildNoticeView(opt) {
  const o = opt || {};
  const c = o.card || {};
  const points = (Array.isArray(c.points) ? c.points : []).slice(0, 2).map(txt);
  return {
    kind: 'notice',
    title: txt(c.title || '班级通知'),
    cat: txt(c.cat || '通知'),
    status: txt(c.statusLabel || ''),
    summary: txt(c.summary || ''),
    points: points,
    source: txt(c.source || ''),
    time: txt(o.time)
  };
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

// 投票卡：只展示标题 / 状态 / 选项，不展示任何结果（百分比、票数、总票数都不画）。
function drawVote(g, v) {
  base(g);
  brand(g, '投票');
  const titleLines = wrapLines(g, v.title || '投票', W - 56, 2, '700 28px ' + FONT);
  let y = 78;
  g.fillStyle = COLOR.ink;
  g.font = '700 28px ' + FONT;
  titleLines.forEach(function (line) {
    g.fillText(line, 28, y);
    y += 36;
  });
  if (!titleLines.length) y = 78;

  const statusParts = [];
  if (v.status) statusParts.push(v.status);
  if (v.modeText) statusParts.push(v.modeText);
  pill(g, 28, y - 4, statusParts.join(' · ') || '进行中', COLOR.teal, COLOR.tealSoft);
  y += 36;

  g.font = '12px ' + FONT;
  g.fillStyle = COLOR.ink3;
  g.fillText(clipText(g, v.hint || '结果请打开投票页查看', W - 56, '12px ' + FONT), 28, y + 4);
  y += 28;

  const opts = v.options || [];
  if (!opts.length) {
    g.font = '15px ' + FONT;
    g.fillStyle = COLOR.ink2;
    g.fillText(clipText(g, v.modeText || '点击卡片查看投票详情', W - 56, '15px ' + FONT), 28, y + 12);
  } else {
    // 2×2 选项卡：只写选项文字，不出现结果条 / 百分比 / 票数
    const cols = 2;
    const gap = 12;
    const cw = (W - 56 - gap) / cols;
    const ch = 44;
    opts.forEach(function (o2, i) {
      const cx = 28 + (i % cols) * (cw + gap);
      const cy = y + Math.floor(i / cols) * (ch + 10);
      g.fillStyle = COLOR.card;
      roundRect(g, cx, cy, cw, ch, 10);
      g.strokeStyle = COLOR.line;
      if (g.strokeRect) { g.lineWidth = 1; g.strokeRect(cx, cy, cw, ch); }
      g.font = '600 14px ' + FONT;
      g.fillStyle = COLOR.ink;
      g.fillText(clipText(g, o2.text, cw - 20, '600 14px ' + FONT), cx + 10, cy + 27);
    });
  }
  footer(g, '班级工具 · 投票', v.time);
}

// 通知卡：标题 / 分类 / 状态 / AI 摘要 / 要点 / 来源；不放附件原文和收件人信息。
function drawNotice(g, v) {
  base(g);
  brand(g, '通知');
  let y = 78;
  g.fillStyle = COLOR.ink;
  g.font = '700 28px ' + FONT;
  const titleLines = wrapLines(g, v.title || '班级通知', W - 56, 3, '700 28px ' + FONT);
  titleLines.forEach(function (line) {
    g.fillText(line, 28, y);
    y += 36;
  });
  y += 4;

  // 分类 + 状态胶囊（状态可能带期次时间，超宽时截断）
  let px = 28;
  if (v.cat) px += pill(g, px, y, v.cat, COLOR.teal, COLOR.tealSoft) + 8;
  if (v.status) {
    const room = W - 28 - px;
    if (room > 48) {
      const st = clipText(g, v.status, room - 20, '600 12px ' + FONT);
      pill(g, px, y, st, COLOR.ink2, '#EFF2F1');
    }
  }
  y += 38;

  if (v.summary) {
    g.font = '15px ' + FONT;
    g.fillStyle = COLOR.ink2;
    const lines = wrapLines(g, v.summary, W - 56, 2, '15px ' + FONT);
    lines.forEach(function (line) {
      g.fillText(line, 28, y);
      y += 23;
    });
    y += 4;
  }

  const points = (v.points || []).filter(Boolean).slice(0, y > 250 ? 1 : 2);
  if (points.length) {
    g.font = '13px ' + FONT;
    g.fillStyle = COLOR.ink2;
    points.forEach(function (p) {
      g.fillText(clipText(g, '· ' + p, W - 56, '13px ' + FONT), 28, y);
      y += 21;
    });
  }

  footer(g, v.source ? ('来源 ' + v.source) : '班级工具 · 通知', v.time);
}

/** 绘制到 canvas（导出由 render 负责）；单测可直接调 draw 验证文字 */
function draw(g, view) {
  if (!g || !view) return false;
  if (view.kind === 'draw') drawDraw(g, view);
  else if (view.kind === 'vote') drawVote(g, view);
  else if (view.kind === 'notice') drawNotice(g, view);
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
  signature: signature,
  draw: draw,
  render: render
};
