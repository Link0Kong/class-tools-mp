// utils/canvas.js —— 统一导图出口（Canvas 2D）· 导出卡 v2「清爽分享卡」
// 版式规格：web/tools/tests/export_card_v2_spec.md（1.5.1，与网页端 exportCard() 逐像素同版式）
//   760 逻辑宽 / DPR2；主卡内缩 22、圆角 22、柔和投影；左上 primary→primary2 渐变装饰条 + 三色圆点品牌行；
//   标题 / 副标题 / 分隔线；参数配置双列 tinted 面板（实测宽度自动判断两列/单列）；区块标题方块；
//   内容块三种：text（兼容 string / rich runs / mono）/ chips / groups；页脚生成时间 + 唯一编号 + 品牌三色点；
//   斜向平铺水印裁剪在主卡内（alpha 0.03、700 15px），页面底色上不会被切一半。
// 与网页版的差异：网页用 document.createElement('canvas') + toBlob 直接下载；
// 小程序改用 <canvas type="2d"> + wx.canvasToTempFilePath + wx.saveImageToPhotosAlbum（含授权失败分支）；
// 色板用规格 §1 的小程序暖色板，品牌 / 水印文字 = 班级工具站。
const util = require('./util.js');

const W = 760;        // 画布逻辑宽度（与网页端一致）
const PAD = 22;       // 主卡内缩 M（v2；内容盒 X = 50 / RX = 710）
const DPR = 2;        // 像素比（与网页端一致）
const BRAND = '班级工具站';   // 网页端此处为 tool.furina.fun，小程序改用产品名
const WATERMARK = '班级工具站'; // 斜向水印文字
// 小程序暖色板（规格 §1）
const PAL = {
  bgTop: '#F2EDE2', bgBottom: '#F4F0E6', card: '#FFFFFF', border: '#E7DED0',
  ink: '#303A35', ink2: '#5C6860', ink3: '#8B948B',
  primary: '#5E8F87', primary2: '#7D9EBB', sand: '#C6A475',
  panel: '#F7F3EA', panelBorder: '#E9E2D4',
  chipBg: '#FFFFFF', chipBorder: '#E7DED0', groupBg: '#FBF8F1',
  shadow: 'rgba(48,58,53,0.13)', watermark: '#303A35'
};

function fontOf(w, s) {
  return w + ' ' + s + 'px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
}

// 与浏览器 ctx 同名的文本换行实现（硬换行 + 逐字兜底 + 行首标点禁则）
function wrap(g, text, maxw) {
  text = String(text == null ? '' : text);
  const out = [];
  /* 行首禁则：换行点落在收尾标点上时，把上一字一起带到下一行，避免「，」单独起行 */
  const CLOSE = /[，。、；：！？）】》」』”’%,.!?:;)\]]/;
  function pushCh(cur, ch) {
    if (g.measureText(cur + ch).width > maxw && cur !== '') {
      if (CLOSE.test(ch) && cur.length > 1) {
        const last = cur.slice(-1);
        if (g.measureText(last + ch).width <= maxw) { out.push(cur.slice(0, -1)); return last + ch; }
      }
      out.push(cur); return ch;
    }
    return cur + ch;
  }
  text.split('\n').forEach(function (para) {
    let cur = '';
    const toks = para.split(' ');
    for (let t = 0; t < toks.length; t++) {
      const tok = toks[t];
      if (t > 0) cur = pushCh(cur, ' ');
      if (g.measureText(tok).width <= maxw) {
        if (cur !== '' && g.measureText(cur + tok).width > maxw) { out.push(cur); cur = tok; }
        else cur += tok;
      } else {
        for (let i = 0; i < tok.length; i++) cur = pushCh(cur, tok[i]);
      }
    }
    out.push(cur);
  });
  return out;
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// opt = { title, sub, config:[[k,v]], blocks:[{label,lines:[string|runs],mono?}|{label,chips:[{n,nm}]}|{label,groups:[[{n,nm}]]}], foot, rec, qr, qrNote, qrTitle, qrCap }
// 2026-11-12 抽签存证（契约 web/draw/CONTRACT.md §6）：qrTitle/qrCap 为可选覆盖（默认「剔除重抽记录」+ 原说明），
// 仅传入 qr 时绘制二维码；其它导出（分组/课表/作业/体测/结果单）不传这两个字段，版式不变。
// 返回画布逻辑高度 H（canvas.width/height 已在内部按 DPR 放大）。
function drawCard(g, canvas, opt) {
  opt = opt || {};
  const P = PAL;
  const M = PAD, X = 50, RX = W - 50, CW = RX - X, R = 22;
  const cfg = opt.config || [];
  const rawBlocks = opt.blocks || [];

  function setFont(w, s) { g.font = fontOf(w, s); }
  function tw(t) { return g.measureText(String(t)).width; }
  function ellip(t, maxw) {
    if (tw(t) <= maxw) return t;
    let s = String(t);
    while (s.length > 1 && tw(s + '…') > maxw) s = s.slice(0, -1);
    return s + '…';
  }
  function fitTitle(t) {
    let s = 30; setFont(800, s);
    while (s > 22 && tw(t) > CW) { s -= 1; setFont(800, s); }
    return { text: ellip(t, CW), size: s };
  }
  function fitSub(t) {
    let s = 13; setFont(500, s);
    while (s > 11 && tw(t) > CW) { s -= 0.5; setFont(500, s); }
    return { text: ellip(t, CW), size: s };
  }
  function wrapRuns(runs, maxw, fontForRun) {
    const out = [];
    let cur = [], w = 0;
    runs.forEach(function (r) {
      g.font = fontForRun(r);
      const rw = tw(r.t);
      if (w + rw > maxw && cur.length) {
        if (r.glue) {
          const p = cur.pop();
          g.font = fontForRun(p);
          const pw = tw(p.t);
          if (cur.length) out.push(cur);
          cur = [p, r]; w = pw + rw;
        } else { out.push(cur); cur = [r]; w = rw; }
      } else { cur.push(r); w += rw; }
    });
    if (cur.length) out.push(cur);
    return out;
  }
  function fontFor(b, r) {
    let s, wt;
    if (r && r.dim) { s = 11.5; wt = 600; }
    else if (r && r.strong) { s = b.mono ? 20 : 14; wt = 800; }
    else { s = b.mono ? 20 : 14; wt = b.mono ? 800 : 400; }
    return fontOf(wt, s);
  }
  function colorFor(b, r) {
    if (r && r.dim) return P.ink3;
    if (b.mono) return P.primary;
    if (r && r.strong) return P.ink;
    return P.ink2;
  }

  /* ---------- 头部 ---------- */
  const title = fitTitle(String(opt.title || ''));
  const sub = fitSub(String(opt.sub || ''));
  const CARD_TOP = M, headerBase = CARD_TOP + 34, titleBase = CARD_TOP + 70,
    subBase = CARD_TOP + 94, dividerY = CARD_TOP + 118;

  /* ---------- 参数配置（双列 tinted 面板，实测宽度自动判断列数） ---------- */
  const CFG = (function () {
    const pad = 14, lineH = 21, GAP = 6, colGap = 20;
    const rows = cfg.map(function (kv) {
      return { k: String(kv[0] == null ? '' : kv[0]), v: String(kv[1] == null ? '' : kv[1]) };
    });
    let two = rows.length > 1, maxLabelW = 0;
    rows.forEach(function (r) {
      setFont(500, 12.5);
      const lw = tw(r.k + '：');
      if (lw > maxLabelW) maxLabelW = lw;
      if (lw > 104) two = false;
      setFont(600, 14);
      if (tw(r.v) > 190) two = false;
    });
    /* 单列时长标签不再被 104px 硬折行：按实测标签宽给列（上限 186） */
    const LW = two ? 104 : Math.min(186, Math.max(110, Math.ceil(maxLabelW) + 6));
    const colW = two ? (CW - pad * 2 - colGap) / 2 : (CW - pad * 2);
    const valW = colW - LW - GAP;
    rows.forEach(function (r) {
      setFont(500, 12.5); r.k = wrap(g, r.k + '：', LW);
      setFont(600, 14); r.v = wrap(g, r.v, valW);
      r.h = Math.max(r.k.length, r.v.length) * lineH + 3;
    });
    let h = pad * 2;
    if (two) {
      for (let i = 0; i < rows.length; i += 2) h += Math.max(rows[i].h, rows[i + 1] ? rows[i + 1].h : 0);
    } else {
      rows.forEach(function (r) { h += r.h; });
    }
    return { rows: rows, two: two, pad: pad, lineH: lineH, LW: LW, GAP: GAP,
      colW: colW, colGap: colGap, height: h };
  })();
  CFG.labelBase = dividerY + 26;
  CFG.top = CFG.labelBase + 12;

  /* ---------- 内容块预排版 ---------- */
  const blocks = rawBlocks.map(function (b) {
    if (b.chips) {
      const hChip = 30, padX = 11, gap = 7, rowGap = 7, rows = [];
      let cur = [], curW = 0;
      (b.chips || []).forEach(function (ch) {
        const n = String(ch && ch.n != null ? ch.n : '');
        const nm = ch && ch.nm ? String(ch.nm) : '';
        setFont(800, 13.5); const nw = tw(n);
        setFont(500, 12); const mw = nm ? 5 + tw(nm) : 0;
        let w = padX * 2 + nw + mw;
        if (w > CW) w = CW;
        if (curW > 0 && curW + gap + w > CW) { rows.push(cur); cur = []; curW = 0; }
        curW += (cur.length ? gap : 0) + w;
        cur.push({ n: n, nm: nm, w: w, nw: nw });
      });
      if (cur.length) rows.push(cur);
      return { kind: 'chips', label: String(b.label || ''), rows: rows, hChip: hChip,
        padX: padX, gap: gap, rowGap: rowGap,
        height: Math.max(0, rows.length * (hChip + rowGap) - rowGap) + 4 };
    }
    if (b.groups) {
      const gapG = 14, colW = (CW - gapG) / 2, padG = 12, innerW = colW - padG * 2,
        lineHG = 21, padXG = 10;
      const groups = (b.groups || []).map(function (members, gi) {
        const rows = [];
        let cur = [], curW = 0;
        (members || []).forEach(function (m) {
          const n = (m && m.n != null) ? String(m.n) : '';
          const nm = (m && m.nm) ? String(m.nm) : '';
          setFont(600, 11.5); const nw = n ? tw(n) : 0;
          setFont(700, 13.5); const mw = nm ? (n ? 3 : 0) + tw(nm) : 0;
          let w = nw + mw;
          if (w > innerW) w = innerW;
          if (curW > 0 && curW + padXG + w > innerW) { rows.push(cur); cur = []; curW = 0; }
          curW += (cur.length ? padXG : 0) + w;
          cur.push({ n: n, nm: nm, nw: nw, mw: mw });
        });
        if (cur.length) rows.push(cur);
        return { idx: gi + 1, rows: rows, h: 34 + rows.length * lineHG + 10 };
      });
      const rowH = [];
      let total = 0;
      for (let i = 0; i < groups.length; i += 2) {
        const hh = Math.max(groups[i].h, groups[i + 1] ? groups[i + 1].h : 0);
        rowH.push(hh); total += hh;
      }
      total += gapG * Math.max(0, rowH.length - 1);
      return { kind: 'groups', label: String(b.label || ''), groups: groups, rowH: rowH,
        gap: gapG, colW: colW, pad: padG, lineH: lineHG, padX: padXG,
        height: total + 4 };
    }
    /* 文本块（兼容 string / rich runs / mono） */
    const mono = !!b.mono, lineH = mono ? 30 : 24, lines = [];
    (b.lines || []).forEach(function (t) {
      if (typeof t === 'string') {
        setFont(mono ? 800 : 400, mono ? 20 : 14);
        wrap(g, String(t), CW).forEach(function (x) {
          lines.push([{ t: x, font: fontOf(mono ? 800 : 400, mono ? 20 : 14), color: mono ? P.primary : P.ink2 }]);
        });
      } else {
        wrapRuns(t, CW, function (r) { return fontFor(b, r); }).forEach(function (row) {
          lines.push(row.map(function (r) {
            return { t: String(r.t), font: fontFor(b, r), color: colorFor(b, r) };
          }));
        });
      }
    });
    return { kind: 'text', label: String(b.label || ''), lines: lines, lineH: lineH,
      height: lines.length * lineH + 4 };
  });

  /* ---------- 二维码（可选，仅抽签类导出支持） ---------- */
  let QR = null;
  if (opt.qr) {
    try {
      const qm = require('./qr.js').qrGen(String(opt.qr));
      if (qm) {
        const qMod = qm.n < 37 ? 4 : 3, quiet = 4 * qMod;
        const qBox = qm.n * qMod + quiet * 2, plate = qBox + 12;
        const boxH = plate + 20;
        setFont(500, 12);
        const capW = CW - plate - 40;
        const cap = wrap(g, opt.qrCap || '扫码查看本次剔除与补抽的完整记录', capW > 120 ? capW : 120);
        const notes = (opt.qrNote || []).slice(0, 3).map(function (s) {
          setFont(500, 12);
          return ellip(String(s), capW > 120 ? capW : 120);
        });
        QR = { qm: qm, mod: qMod, quiet: quiet, qBox: qBox, plate: plate, boxH: boxH,
          cap: cap, notes: notes, height: boxH + 4 };
      }
    } catch (e) { QR = null; }
  }

  /* ---------- 计算总高（高度自适应，无空底） ---------- */
  let y = CFG.top + CFG.height;
  blocks.forEach(function (b, i) {
    y += (i === 0 ? 30 : 26);
    b.labelBase = y;
    b.top = y + 14;
    y = b.top + b.height;
  });
  let contentBottom = y;
  if (QR) { QR.top = contentBottom + 20; contentBottom = QR.top + QR.height; }
  const footerDividerY = contentBottom + 26;
  const H = footerDividerY + 70 + M;

  /* ---------- 定尺寸并绘制（自绘前重置变换/透明度，兼容重复导出） ---------- */
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.scale(DPR, DPR);
  g.globalAlpha = 1;
  g.textAlign = 'left';

  /* ---------- 背景 + 主卡 ---------- */
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, P.bgTop); bg.addColorStop(1, P.bgBottom);
  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  g.save();
  g.shadowColor = P.shadow; g.shadowBlur = 26; g.shadowOffsetY = 8;
  rr(g, M, M, W - M * 2, H - M * 2, R);
  g.fillStyle = P.card; g.fill();
  g.restore();
  g.strokeStyle = P.border; g.lineWidth = 1;
  rr(g, M, M, W - M * 2, H - M * 2, R); g.stroke();

  /* 左上装饰条（primary → primary2 竖向渐变） */
  const barGrad = g.createLinearGradient(0, M + 28, 0, M + 68);
  barGrad.addColorStop(0, P.primary); barGrad.addColorStop(1, P.primary2);
  rr(g, M + 14, M + 28, 4, 40, 2); g.fillStyle = barGrad; g.fill();

  /* 水印：先裁剪到主卡圆角路径，再斜向平铺（页面底色上不会出现切半的字） */
  g.save();
  rr(g, M, M, W - M * 2, H - M * 2, R);
  g.clip();
  g.globalAlpha = 0.03;
  g.fillStyle = P.watermark;
  g.font = fontOf(700, 15);
  g.textAlign = 'center';
  g.translate(W / 2, H / 2);
  g.rotate(-20 * Math.PI / 180);
  for (let wy = -H; wy <= H; wy += 140) {
    for (let wx = -W; wx <= W; wx += 300) { g.fillText(WATERMARK, wx, wy); }
  }
  g.restore();
  g.textAlign = 'left';

  /* ---------- 头部：三色圆点 + 品牌 / 标题 / 副标题 / 分隔线 ---------- */
  function dot(cx, cy, r, color) {
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = color; g.fill();
  }
  dot(X + 3.5, headerBase - 4, 3, P.primary);
  dot(X + 13.5, headerBase - 4, 3, P.primary2);
  dot(X + 23.5, headerBase - 4, 3, P.sand);
  setFont(800, 11); g.fillStyle = P.ink3;
  g.fillText(BRAND, X + 34, headerBase);
  setFont(800, title.size); g.fillStyle = P.ink;
  g.fillText(title.text, X, titleBase);
  setFont(500, sub.size); g.fillStyle = P.ink3;
  g.fillText(sub.text, X, subBase);
  g.strokeStyle = P.border; g.lineWidth = 1;
  g.beginPath(); g.moveTo(X, dividerY); g.lineTo(RX, dividerY); g.stroke();

  /* ---------- 区块标题：5×5 圆角方块 + 文字 ---------- */
  function sectionLabel(text, base) {
    rr(g, X, base - 11, 5, 5, 1.5); g.fillStyle = P.primary; g.fill();
    setFont(800, 12.5); g.fillStyle = P.primary;
    g.fillText(text, X + 13, base);
  }

  /* ---------- 参数配置面板 ---------- */
  sectionLabel('参数配置', CFG.labelBase);
  rr(g, X, CFG.top, CW, CFG.height, 14);
  g.fillStyle = P.panel; g.fill();
  g.strokeStyle = P.panelBorder; g.lineWidth = 1;
  rr(g, X, CFG.top, CW, CFG.height, 14); g.stroke();
  (function () {
    const pad = CFG.pad, lineH = CFG.lineH;
    let y0 = CFG.top + pad;
    function cell(r, cx, rowTop) {
      setFont(500, 12.5); g.fillStyle = P.ink3;
      r.k.forEach(function (t, k) { g.fillText(t, cx, rowTop + lineH - 4 + k * lineH); });
      setFont(600, 14); g.fillStyle = P.ink2;
      r.v.forEach(function (t, k) { g.fillText(t, cx + CFG.LW + CFG.GAP, rowTop + lineH - 4 + k * lineH); });
    }
    if (CFG.two) {
      for (let i = 0; i < CFG.rows.length; i += 2) {
        const a = CFG.rows[i], b = CFG.rows[i + 1];
        const rh = Math.max(a.h, b ? b.h : 0);
        cell(a, X + pad, y0);
        if (b) cell(b, X + pad + CFG.colW + CFG.colGap, y0);
        y0 += rh;
      }
    } else {
      CFG.rows.forEach(function (r) { cell(r, X + pad, y0); y0 += r.h; });
    }
  })();

  /* ---------- 内容块（text / chips / groups） ---------- */
  blocks.forEach(function (b) {
    sectionLabel(b.label, b.labelBase);
    if (b.kind === 'chips') {
      b.rows.forEach(function (row, ri) {
        const yy = b.top + ri * (b.hChip + b.rowGap);
        let xx = X;
        row.forEach(function (ch, ci) {
          if (ci > 0) xx += b.gap;
          rr(g, xx, yy, ch.w, b.hChip, b.hChip / 2);
          g.fillStyle = P.chipBg; g.fill();
          g.strokeStyle = P.chipBorder; g.lineWidth = 1;
          rr(g, xx, yy, ch.w, b.hChip, b.hChip / 2); g.stroke();
          setFont(800, 13.5); g.fillStyle = P.primary;
          g.fillText(ch.n, xx + b.padX, yy + 20);
          if (ch.nm) {
            setFont(500, 12); g.fillStyle = P.ink2;
            g.fillText(ch.nm, xx + b.padX + ch.nw + 5, yy + 20);
          }
          xx += ch.w;
        });
      });
    } else if (b.kind === 'groups') {
      const rowTops = [];
      let yy0 = b.top;
      b.rowH.forEach(function (h) { rowTops.push(yy0); yy0 += h + b.gap; });
      b.groups.forEach(function (gp, i) {
        const col = i % 2, row = Math.floor(i / 2);
        const px = X + col * (b.colW + b.gap), py = rowTops[row], ph = b.rowH[row];
        rr(g, px, py, b.colW, ph, 14);
        g.fillStyle = P.groupBg; g.fill();
        g.strokeStyle = P.panelBorder; g.lineWidth = 1;
        rr(g, px, py, b.colW, ph, 14); g.stroke();
        setFont(800, 12.5); g.fillStyle = P.ink;
        g.fillText('第 ' + gp.idx + ' 组', px + b.pad, py + 20);
        setFont(500, 10.5); g.fillStyle = P.ink3; g.textAlign = 'right';
        g.fillText(gp.rows.reduce(function (a, r) { return a + r.length; }, 0) + ' 人', px + b.colW - b.pad, py + 20);
        g.textAlign = 'left';
        let my = py + 34;
        gp.rows.forEach(function (row) {
          let mx = px + b.pad;
          row.forEach(function (m, mi) {
            if (mi > 0) mx += b.padX;
            if (m.n) {
              setFont(600, 11.5); g.fillStyle = P.ink3;
              g.fillText(m.n, mx, my + 15);
            }
            if (m.nm) {
              setFont(700, 13.5); g.fillStyle = P.ink;
              g.fillText(m.nm, mx + m.nw + (m.n ? 3 : 0), my + 15);
            }
            mx += m.nw + m.mw;
          });
          my += b.lineH;
        });
      });
    } else {
      let ty = b.top;
      b.lines.forEach(function (line) {
        let tx = X;
        line.forEach(function (r) {
          g.font = r.font; g.fillStyle = r.color;
          g.fillText(r.t, tx, ty + 15);
          tx += g.measureText(r.t).width;
        });
        ty += b.lineH;
      });
    }
  });

  /* ---------- 二维码面板（可选） ---------- */
  if (QR) {
    rr(g, X, QR.top, CW, QR.boxH, 14);
    g.fillStyle = P.panel; g.fill();
    g.strokeStyle = P.panelBorder; g.lineWidth = 1;
    rr(g, X, QR.top, CW, QR.boxH, 14); g.stroke();
    const plateX = RX - 10 - QR.plate, plateY = QR.top + 10;
    rr(g, plateX, plateY, QR.plate, QR.plate, 10);
    g.fillStyle = P.chipBg; g.fill();
    g.strokeStyle = P.chipBorder; g.lineWidth = 1;
    rr(g, plateX, plateY, QR.plate, QR.plate, 10); g.stroke();
    const qx = plateX + 6 + QR.quiet, qy = plateY + 6 + QR.quiet;
    g.fillStyle = P.ink;
    for (let r2 = 0; r2 < QR.qm.n; r2++) {
      for (let c2 = 0; c2 < QR.qm.n; c2++) {
        if (QR.qm.m[r2][c2]) g.fillRect(qx + c2 * QR.mod, qy + r2 * QR.mod, QR.mod, QR.mod);
      }
    }
    setFont(800, 12.5); g.fillStyle = P.primary;
    g.fillText(opt.qrTitle || '剔除重抽记录', X + 18, QR.top + 28);
    setFont(500, 12); g.fillStyle = P.ink2;
    QR.notes.forEach(function (t, i) { g.fillText(t, X + 18, QR.top + 52 + i * 18); });
    setFont(500, 11); g.fillStyle = P.ink3;
    g.fillText(QR.cap.join(''), X + 18, QR.top + QR.boxH - 14);
  }

  /* ---------- 页脚：生成时间 + 编号 / 品牌三色点 ---------- */
  g.strokeStyle = P.border; g.lineWidth = 1;
  g.beginPath(); g.moveTo(X, footerDividerY); g.lineTo(RX, footerDividerY); g.stroke();
  setFont(500, 11.5); g.fillStyle = P.ink3;
  g.fillText(String(opt.foot || ''), X, footerDividerY + 24);
  setFont(500, 11); g.fillStyle = P.ink3;
  g.fillText('编号 ' + String(opt.rec || ''), X, footerDividerY + 44);
  (function () {
    setFont(800, 11.5);
    const brandW = tw(BRAND);
    const startX = RX - (21 + 5 + brandW);
    dot(startX + 2.5, footerDividerY + 20, 2.5, P.primary);
    dot(startX + 10.5, footerDividerY + 20, 2.5, P.primary2);
    dot(startX + 18.5, footerDividerY + 20, 2.5, P.sand);
    setFont(800, 11.5); g.fillStyle = P.primary;
    g.fillText(BRAND, startX + 26, footerDividerY + 24);
  })();

  return H;
}

// 生成图片临时路径
function exportCard(page, selector, opt) {
  return new Promise(function (resolve, reject) {
    const q = wx.createSelectorQuery().in(page);
    q.select(selector).fields({ node: true, size: true }).exec(function (res) {
      const node = res && res[0] && res[0].node;
      if (!node) { reject(new Error('canvas 节点未找到：' + selector)); return; }
      let H;
      try {
        const g = node.getContext('2d');
        H = drawCard(g, node, opt);
        wx.canvasToTempFilePath({
          canvas: node,
          x: 0, y: 0,
          width: W * DPR, height: H * DPR,
          destWidth: W * DPR, destHeight: H * DPR,
          fileType: 'png',
          success: function (r) { resolve(r.tempFilePath); },
          fail: function (e) { reject(e || new Error('canvasToTempFilePath 失败')); }
        });
      } catch (e) { reject(e); }
    });
  });
}

// 保存到相册（含授权失败 / 拒绝 / 取消分支）
function saveToAlbum(filePath) {
  return new Promise(function (resolve) {
    function doSave() {
      wx.saveImageToPhotosAlbum({
        filePath: filePath,
        success: function () { resolve({ ok: true }); },
        fail: function (err) {
          const msg = (err && err.errMsg) || '';
          if (msg.indexOf('cancel') >= 0) { resolve({ ok: false, cancelled: true, err: err }); return; }
          resolve({ ok: false, needAuth: true, err: err });
        }
      });
    }
    wx.getSetting({
      success: function (r) {
        const s = r && r.authSetting ? r.authSetting['scope.writePhotosAlbum'] : undefined;
        if (s === false) {
          wx.showModal({
            title: '需要相册权限',
            content: '导出图片需要「保存到相册」权限，去设置里打开即可。',
            confirmText: '去设置',
            success: function (m) {
              if (!m.confirm) { resolve({ ok: false, needAuth: true, refused: true }); return; }
              wx.openSetting({
                success: function (o) {
                  if (o && o.authSetting && o.authSetting['scope.writePhotosAlbum']) doSave();
                  else resolve({ ok: false, needAuth: true, refused: true });
                },
                fail: function () { resolve({ ok: false, needAuth: true, refused: true }); }
              });
            },
            fail: function () { resolve({ ok: false, needAuth: true, refused: true }); }
          });
        } else { doSave(); }
      },
      fail: function () { doSave(); }
    });
  });
}

// 一步到位：画图 -> 存相册 -> 反馈
function exportAndSave(page, selector, opt) {
  return exportCard(page, selector, opt).then(function (filePath) {
    return saveToAlbum(filePath).then(function (r) { return { filePath: filePath, save: r }; });
  }).then(function (r) {
    if (r.save.ok) util.toast('已保存到相册');
    else if (r.save.cancelled) util.toast('已取消保存');
    else if (r.save.needAuth) util.toast('未获得相册权限，图片未保存');
    else util.toast('保存失败');
    return r;
  }).catch(function (e) {
    util.toast('导出失败：' + (e && e.message ? e.message : e));
    return { error: e };
  });
}

module.exports = {
  W: W, PAD: PAD, DPR: DPR, fontOf: fontOf, wrap: wrap, rr: rr,
  drawCard: drawCard, exportCard: exportCard, saveToAlbum: saveToAlbum, exportAndSave: exportAndSave
};
