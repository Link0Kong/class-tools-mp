/* nt_archive_preview.js —— 通知页压缩包 archive 附件 390 宽截图/断言
 *
 * 前置：cli.bat auto --project <项目> --port 9433 --auto-port 9420 --trust-project
 * 用法：node nt_archive_preview.js
 * 产出：_shots_nt_attach/
 *   01_nt_archive_card.png（卡片头部）
 *   02_nt_archive_rows.png（压缩包 5 行清单）
 *   result.json
 *
 * 说明：真实 group JSON 来自 `_nt_fixtures/nt_archive_group.json`（源：briefdesk board-data
 * g_qqfile_8b01d25799，仅测试夹具）；mock 身份与 wx.request，不接触真实云端。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const OUT = path.join(__dirname, '_shots_nt_attach');
fs.mkdirSync(OUT, { recursive: true });
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '_nt_fixtures', 'nt_archive_group.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const consoleIssues = [];
function check(name, ok, detail) {
  results.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 700) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}
async function shot(mp, name) {
  const p = path.join(OUT, name + '.png');
  try {
    await mp.evaluate(() => {
      try {
        const fsm = wx.getFileSystemManager();
        const root = wx.env.USER_DATA_PATH;
        const clean = function (d) {
          try {
            fsm.readdirSync(d).forEach(function (n) {
              const q = d + '/' + n;
              try { if (fsm.statSync(q).isDirectory()) clean(q); else fsm.unlinkSync(q); } catch (e2) { /* ignore */ }
            });
          } catch (e3) { /* ignore */ }
        };
        clean(root);
      } catch (e4) { /* ignore */ }
    });
    await sleep(80);
  } catch (e0) { /* ignore */ }
  try { await mp.screenshot({ path: p }); console.log('SHOT  ' + p); return p; } catch (e) {
    for (let i = 0; i < 2; i++) {
      try { await sleep(800); await mp.screenshot({ path: p }); console.log('SHOT  ' + p + ' (retry)'); return p; } catch (e2) { /* next */ }
    }
    console.log('SHOT-FAIL ' + name + ' :: ' + e.message); return '';
  }
}
async function pageData(mp) {
  return mp.evaluate((gid) => {
    const ps = getCurrentPages(); const pg = ps[ps.length - 1];
    if (!pg) return null;
    const cards = (pg.data.cards || []).concat(pg.data.expiredCards || [], pg.data.infoCards || [], pg.data.longtermCards || []);
    const card = cards.filter(function (c) { return c.id === gid; })[0] || null;
    const it = card && (card.items || []).filter(function (x) { return x.kind === 'file'; })[0];
    return JSON.parse(JSON.stringify({
      path: pg.route || '', state: pg.data.state, cards: cards.length,
      card: card ? { id: card.id, expanded: card.expanded, title: card.title } : null,
      file: it ? {
        name: it.name, meta: it.meta, pending: it.pending, archiveOk: it.archiveOk,
        archiveCount: it.archiveCount, archiveSummary: it.archiveSummary,
        archiveFiles: (it.archiveFiles || []).map(function (f) { return { name: f.name, size: f.size, extText: f.extText, hasUrl: f.hasUrl }; })
      } : null
    }));
  }, fixture.id);
}
async function rects(mp, selector) {
  return mp.evaluate((sel) => new Promise((resolve) => {
    const q = wx.createSelectorQuery();
    q.selectAll(sel).boundingClientRect();
    q.exec((res) => resolve((res && res[0]) || []));
  }), selector);
}
async function scrollToArchive(mp) {
  return mp.evaluate(() => new Promise((resolve) => {
    const q = wx.createSelectorQuery();
    q.select('.nt-archive').boundingClientRect();
    q.selectViewport().scrollOffset();
    q.exec((res) => {
      const r = (res && res[0]) || {};
      const s = (res && res[1]) || {};
      const top = Math.max(0, (s.scrollTop || 0) + (r.top || 0) - 120);
      wx.pageScrollTo({ scrollTop: top, duration: 0 });
      setTimeout(() => resolve({ top: top, rect: r }), 300);
    });
  }));
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  mp.on('console', (msg) => {
    if (msg && msg.type === 'error') consoleIssues.push(String(msg.args || msg.text || '').slice(0, 300));
  });
  try {
    // 1) mock 身份 + notices 全量/签名 + 其它空表
    await mp.evaluate((g) => {
      try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
      wx.setStorageSync('zq_class_identity', JSON.stringify({
        token: 'tok-nt-archive-preview', sid: '3260799999', name: '测试账号',
        role: '副团支书', badge: '班委', is_admin: true, ts: Date.now()
      }));
      const PREFIX = '[[CLASS_NOTICE_V1]]';
      const row = {
        id: 'auto_g_qqfile_8b01d25799', ts: Date.now(), hidden: false, archived: false,
        override_json: null, edited_at: 0, edited_by: '',
        body: PREFIX + JSON.stringify(g)
      };
      // 模拟「缓存旧 body」：首次整表返回无 archive 的旧 group；单条 id=eq 返回完整 archive
      const stale = JSON.parse(JSON.stringify(g));
      delete stale.items[0].archive;
      delete stale.items[0].archiveOk;
      stale.items[0].note = '压缩包';
      const staleRow = Object.assign({}, row, { body: PREFIX + JSON.stringify(stale) });
      globalThis.__ntDbg = { groupOk: !!g, gid: g && g.id, bodyLen: String(row.body || '').length, items: (g && g.items || []).length };
      const lite = { id: row.id, ts: row.ts, hidden: false, edited_at: 0 };
      globalThis.__ntReqs = [];
      wx.request = function (o) {
        const u = String((o && o.url) || '');
        globalThis.__ntReqs.push(String((o && o.method) || 'GET') + ' ' + u);
        let data = [];
        if (u.indexOf('/notices?') >= 0) {
          if (u.indexOf('id=eq.') >= 0) data = [row];                                  // 单条刷新：完整 body
          else if (u.indexOf('select=*') >= 0) data = [staleRow];                       // 整表：旧缓存 body
          else data = [lite];
        }
        const ok = function () { try { o.success && o.success({ statusCode: 200, data: data }); } catch (e) { /* ignore */ } };
        setTimeout(ok, 20);
      };
    }, fixture);

    await mp.reLaunch('/pages/nt/nt');
    await sleep(1800);
    let d = await pageData(mp);
    check('通知页打开：预防艾滋病通知卡片可见', d && d.path === 'pages/nt/nt' && d.card && d.card.title.indexOf('预防艾滋病') >= 0, JSON.stringify(d && { state: d.state, card: d.card, cards: d.cards }));
    const s1 = await shot(mp, '01_nt_archive_card');
    check('附件 item：archiveOk + 5 文件（3 可预览 / 2 仅清单）+ 不待获取', d && d.file && d.file.archiveOk === true &&
      d.file.archiveCount === 5 && d.file.archiveFiles.length === 5 &&
      d.file.archiveFiles.filter((f) => f.hasUrl).length === 3 &&
      d.file.archiveFiles.filter((f) => !f.hasUrl).length === 2 &&
      d.file.pending === false, JSON.stringify(d && d.file));
    check('外层 meta 保留「压缩包 · 已识别 5 个文件」', d && d.file && /压缩包 · 已识别 5 个文件/.test(d.file.meta), d && d.file && d.file.meta);

    // 2) 滚到压缩包清单并截图/测行
    await scrollToArchive(mp);
    const rows = await rects(mp, '.nt-archive-row');
    const names = await rects(mp, '.nt-archive-name');
    const acts = await rects(mp, '.nt-archive-act');
    check('压缩包 5 行清单渲染（默认展开、无横向溢出）', rows.length === 5 && rows.every((r) => r.right <= 390.5 && r.left >= 0 && r.width > 0) &&
      names.length === 5 && acts.length === 5 && rows.every((r) => r.height >= 40), JSON.stringify(rows.map((r) => ({ l: r.left, r: r.right, t: r.top, h: r.height }))));
    const s2 = await shot(mp, '02_nt_archive_rows');

    // 3) 内部预览：点击第 1 个可预览文件 → writeDataUri → openDocument(showMenu:true)
    const op = await mp.evaluate(() => new Promise((resolve) => {
      let opened = null, loading = '';
      wx.showLoading = function (o) { loading = o && o.title; };
      wx.hideLoading = function () { loading = ''; };
      wx.openDocument = function (o) { opened = { filePath: o.filePath, showMenu: !!o.showMenu, fail: false }; if (o.success) o.success(); };
      wx.getFileSystemManager = function () { return { writeFile: function (o) { if (o.success) o.success({}); } }; };
      const pg = getCurrentPages()[getCurrentPages().length - 1];
      const card = (pg.data.cards || []).concat(pg.data.expiredCards || [], pg.data.infoCards || [], pg.data.longtermCards || []).filter(function (c) {
        return (c.items || []).some(function (x) { return x.kind === 'file' && x.archiveOk; });
      })[0];
      const gid = card && card.id;
      pg.previewArchiveFile({ currentTarget: { dataset: { gid: gid, i: 0, ai: 0 } } });
      setTimeout(() => resolve({ opened: opened, loading: loading }), 400);
    }));
    check('内部文件预览：data URI 写临时文件 + openDocument(showMenu:true)', op && op.opened &&
      /nt_\d+_[\w]+\.xlsx$/.test(op.opened.filePath || '') && op.opened.showMenu === true, JSON.stringify(op));

    const info = await mp.evaluate(() => { try { return wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) { return {}; } });
    const report = {
      at: new Date().toISOString(), windowWidth: info.windowWidth || 0,
      fixture: { source: 'briefdesk/data/board-data.json g_qqfile_8b01d25799', files: 5, previewable: 3 },
      checks: results, consoleErrors: consoleIssues,
      screenshots: [s1, s2].filter(Boolean)
    };
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2), 'utf8');
    const failed = results.filter((r) => !r.ok).length;
    console.log('\n==== nt archive preview: ' + (results.length - failed) + ' PASS / ' + failed + ' FAIL / ' + consoleIssues.length + ' console error；windowWidth=' + report.windowWidth + ' ====');
    process.exitCode = failed ? 2 : 0;
  } finally {
    try { await mp.disconnect(); } catch (e) { /* ignore */ }
  }
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
