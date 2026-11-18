/* nt_preview.js —— 小程序「班级通知」全功能回归（对齐网页端通知页）
 *
 * 覆盖：
 *   · 简报 4 统计 + 最近 3 条待处理；筛选（待处理/已过期/全部 + 分类）
 *   · 未过期默认展开、已过期默认收起；已过期区块默认折叠、可展开
 *   · 卡片：分类/OCR/状态/发布者/来源/AI 摘要/要点/字段拆分/原文摘录/组成
 *   · 附件以文件卡展示（预览/下载）、图片网格（预览）、表单/链接/小程序/公众号行
 *   · 标记已处理、收起/展开、原始消息弹层
 *
 * 前置：开发者工具 `cli.bat auto --project <项目> --auto-port 9420 --trust-project`
 * 用法：node nt_preview.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const OUT = path.join(__dirname, '_shots', 'nt');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const consoleIssues = [];

function check(name, ok, detail) {
  checks.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 400) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}
async function curPage(mp) { try { return await mp.currentPage(); } catch (e) { return null; } }
async function curPath(mp) { const p = await curPage(mp); return p ? p.path : ''; }
async function waitPath(mp, expect, timeout) {
  const end = Date.now() + (timeout || 9000);
  while (Date.now() < end) { if ((await curPath(mp)) === expect) return true; await sleep(200); }
  return false;
}
async function ev(mp, fn, arg, tries) {
  let last = null;
  const n = tries || 3;
  for (let i = 0; i < n; i++) {
    try { return await mp.evaluate(fn, arg); } catch (e) { last = e; await sleep(1200); }
  }
  throw last;
}
async function shot(mp, name, wait) {
  await sleep(wait == null ? 400 : wait);
  await mp.screenshot({ path: path.join(OUT, name + '.png') });
  console.log('SHOT  ' + name);
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  mp.on('exception', (e) => consoleIssues.push('exception: ' + JSON.stringify(e).slice(0, 400)));
  mp.on('console', (e) => { if (e && e.type === 'error') consoleIssues.push('error: ' + (e.args || []).map(String).join(' ').slice(0, 400)); });
  await sleep(1500);

  /* ---------- 0. 身份验证 ---------- */
  await ev(mp, () => {
    try { wx.clearStorageSync(); } catch (e) {}
    try { require('utils/store.js').reset(); } catch (e) {}
    try { require('utils/flow.js').clearFlow(); } catch (e) {}
  });
  let p = await mp.reLaunch('/pages/identity/identity');
  await waitPath(mp, 'pages/identity/identity', 9000);
  await sleep(800);
  p = await curPage(mp);
  const inputs = p ? await p.$$('input') : [];
  if (inputs.length >= 2) {
    await inputs[0].input('测试账号'); await sleep(150);
    await inputs[1].input('3260799999'); await sleep(250);
  }
  await ev(mp, () => { const ps = getCurrentPages(); const pg = ps[ps.length - 1]; if (pg && pg.submit) pg.submit(); });
  for (let i = 0; i < 30; i++) { await sleep(300); if ((await curPath(mp)) === 'pages/index/index') break; }
  await sleep(700);
  check('身份验证后进入工作台', (await curPath(mp)) === 'pages/index/index', await curPath(mp));

  /* ---------- 1. 打开通知页 ---------- */
  p = await mp.navigateTo('/pages/nt/nt');
  await waitPath(mp, 'pages/nt/nt', 9000);
  for (let i = 0; i < 20; i++) {
    await sleep(400);
    const st = await ev(mp, () => { const pg = getCurrentPages()[getCurrentPages().length - 1]; return pg.data.state; });
    if (st === 'ready') break;
  }
  // 冷启动首次整表拉取可能先拿到空（失败被静默成 []）→ 最多等 12s，仍为空则主动再拉一次
  for (let i = 0; i < 12; i++) {
    const n = await ev(mp, () => { const pg = getCurrentPages()[getCurrentPages().length - 1]; return (pg.data.cards || []).length; });
    if (n > 0) break;
    if (i === 5) {
      await ev(mp, () => { const pg = getCurrentPages()[getCurrentPages().length - 1]; return pg.pull(true); });
    }
    await sleep(1000);
  }
  await sleep(1600);
  const d = await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    return {
      state: pg.data.state,
      cards: pg.data.cards,
      expiredCards: pg.data.expiredCards,
      expiredCount: pg.data.expiredCount,
      showExpired: pg.data.showExpired,
      stats: pg.data.stats,
      cardKey: pg.data.cardKey,
      infoCards: pg.data.infoCards,
      infoCount: pg.data.infoCount,
      showInfo: pg.data.showInfo,
      longtermCards: pg.data.longtermCards,
      longtermCount: pg.data.longtermCount,
      briefNext: pg.data.briefNext,
      filter: pg.data.filter,
      cats: pg.data.cats
    };
  });
  check('通知页已渲染', d.state === 'ready', d.state);
  check('顶部 5 卡统计（待处理/24h/7天/长期/最新发布）', !!(d.stats && d.stats.pending > 0 && d.stats.expired >= 0 &&
    typeof d.stats.urgent === 'number' && typeof d.stats.week === 'number' &&
    typeof d.stats.longterm === 'number' && typeof d.stats.latestText === 'string'), JSON.stringify(d.stats));
  const dcards = await p.$$('.nt-dcard');
  check('顶部 5 张数据卡渲染（可点）', !!(dcards && dcards.length === 5), '数据卡=' + (dcards && dcards.length));
  check('长期通知卡 = 进行中的长期安排条数', d.stats.longterm === (d.longtermCards || []).length,
    'stats.longterm=' + d.stats.longterm + ' longtermCards=' + (d.longtermCards || []).length);
  check('资料 / 无时间栏（默认展开）', d.infoCount > 0 ? (d.showInfo === true && !!d.infoCards && d.infoCards.length === d.infoCount) : true,
    'infoCount=' + d.infoCount + ' showInfo=' + d.showInfo);
  const occCards = (d.cards || []).filter((c) => c.isOcc);
  check('期次卡状态胶囊格式（本次 M月D日（周X）HH:MM）',
    occCards.every((c) => /^本次 \d{1,2}月\d{1,2}日（[^）]+）\d\d:\d\d$/.test(c.statusLabel)),
    JSON.stringify(occCards.map((c) => c.statusLabel)));
  const mainIds = (d.cards || []).map((c) => c.id);
  check('主列表不含资料 / 长期定义卡',
    !(d.cards || []).some((c) => c.isInfo) &&
    !(d.cards || []).some((c) => (d.infoCards || []).some((x) => x.id === c.id)) &&
    !(d.cards || []).some((c) => (d.longtermCards || []).some((x) => x.id === c.id && !c.isOcc)),
    'cards=' + mainIds.length);
  // 5 卡点击筛选 / 再点取消（契约 §2.1）
  const tapCard = async (k) => ev(mp, (kk) => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    pg.pickCard({ currentTarget: { dataset: { k: kk } } });
    return { filter: pg.data.filter, cardKey: pg.data.cardKey, n: (pg.data.cards || []).length };
  }, k);
  let cardTap = await tapCard('pending');
  check('点「待处理」卡 → 筛选待处理 + 激活态', cardTap.filter === 'active' && cardTap.cardKey === 'pending', JSON.stringify(cardTap));
  cardTap = await tapCard('pending');
  check('再点已激活卡 → 恢复「全部」', cardTap.filter === 'all' && cardTap.cardKey === '', JSON.stringify(cardTap));
  cardTap = await tapCard('longterm');
  check('点「长期通知」卡 → 长期安排清单视图', cardTap.filter === 'longterm' && cardTap.cardKey === 'longterm', JSON.stringify(cardTap));
  cardTap = await tapCard('latest');
  check('点「最新发布」卡 → 按发布时间倒序视图', cardTap.filter === 'latest' && cardTap.cardKey === 'latest', JSON.stringify(cardTap));
  await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    pg.pickFilter({ currentTarget: { dataset: { f: 'active' } } });
  });
  await sleep(400);
  check('最近待处理列有数据（≤3）', d.briefNext.length > 0 && d.briefNext.length <= 3, JSON.stringify(d.briefNext.map((x) => x.title)));
  check('分类筛选包含多个分类', d.cats.length >= 3, d.cats.join(' / '));
  const expandedActive = d.cards.filter((c) => c.expanded).length;
  check('未过期通知默认全部展开', expandedActive === d.cards.length && d.cards.length > 0, expandedActive + '/' + d.cards.length);
  check('已过期通知默认全部收起', d.expiredCount > 0 && d.expiredCards.every((c) => !c.expanded), d.expiredCount + ' 组，展开=' + d.expiredCards.filter((c) => c.expanded).length);
  check('已过期区块默认折叠', d.showExpired === false, String(d.showExpired));
  const allItems = [];
  d.cards.concat(d.expiredCards || [], d.infoCards || []).forEach((c) => (c.items || []).forEach((it) => allItems.push(it.kind)));
  const allCards = d.cards.concat(d.expiredCards || [], d.infoCards || []);
  const files = allCards.filter((c) => c.filesCount > 0).length;
  const imgs = allCards.filter((c) => c.imgCount > 0).length;
  check('附件以文件卡展示（不是一行文字）', files >= 1 && allItems.filter((k) => k === 'file').length >= 1, '文件卡=' + allItems.filter((k) => k === 'file').length + '，卡片=' + files);
  check('图片卡存在', imgs >= 1, '含图卡片=' + imgs);
  check('表单/链接/公众号行至少各有一处（小程序行有则一并校验）', ['form', 'link', 'article'].every((k) => allItems.indexOf(k) >= 0), JSON.stringify(Array.from(new Set(allItems))));
  check('AI 摘要 + 要点 + 字段拆分', allCards.some((c) => c.summary) && allCards.some((c) => c.points.length) && allCards.some((c) => c.segs.length), '');
  await shot(mp, '01-top', 300);

  /* ---------- 2. 图片懒加载（展开卡片）---------- */
  let imgGid = '';
  for (const c of d.cards) { if (c.imgCount) { imgGid = c.id; break; } }
  if (imgGid) {
    await ev(mp, (gid) => {
      const pg = getCurrentPages()[getCurrentPages().length - 1];
      return pg.ensureImgs(gid);
    }, imgGid);
    let loaded = false;
    for (let i = 0; i < 12; i++) {
      await sleep(500);
      loaded = await ev(mp, (gid) => {
        const pg = getCurrentPages()[getCurrentPages().length - 1];
        const card = pg.data.cards.filter((x) => x.id === gid)[0];
        return !!(card && card.imgs && card.imgs.length);
      }, imgGid);
      if (loaded) break;
    }
    check('图片自动转为本地文件并渲染', loaded, imgGid);
  } else {
    check('图片自动转为本地文件并渲染', false, '没有图片卡');
  }

  /* ---------- 3. 收起 / 展开 ---------- */
  const firstId = (d.cards[0] || {}).id || '';
  if (!firstId) {
    check('主列表有数据（真实云端）', false, 'cards=0（真实云端整表拉取失败/为空）');
  }
  await ev(mp, (gid) => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    pg.toggleDetail({ currentTarget: { dataset: { gid: gid } } });
  }, firstId);
  await sleep(400);
  const folded = await ev(mp, (gid) => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    const card = pg.data.cards.filter((x) => x.id === gid)[0];
    return card && card.expanded;
  }, firstId);
  check('点「收起」后卡片折叠', folded === false, String(folded));
  await ev(mp, (gid) => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    pg.toggleDetail({ currentTarget: { dataset: { gid: gid } } });
  }, firstId);
  await sleep(300);

  /* ---------- 4. 标记已处理 ---------- */
  const beforePending = d.stats.pending;
  await ev(mp, (gid) => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    pg.toggleDone({ currentTarget: { dataset: { gid: gid } } });
  }, firstId);
  await sleep(500);
  const afterDone = await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    return { pending: pg.data.stats.pending, firstDone: (pg.data.cards[0] || {}).done, n: pg.data.cards.length };
  });
  check('标记已处理后状态与计数更新', afterDone.pending === beforePending - 1, JSON.stringify({ before: beforePending, after: afterDone.pending }));
  await ev(mp, (gid) => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    pg.toggleDone({ currentTarget: { dataset: { gid: gid } } });
  }, firstId);
  await sleep(400);
  check('取消已处理后计数恢复', !!(await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    return pg.data.stats.pending;
  }) === beforePending), '');

  /* ---------- 5. 原始消息 ---------- */
  let rawGid = '';
  for (const c of d.cards) { if (c.hasRaw) { rawGid = c.id; break; } }
  if (rawGid) {
    await ev(mp, (gid) => {
      const pg = getCurrentPages()[getCurrentPages().length - 1];
      pg.openRaw({ currentTarget: { dataset: { gid: gid } } });
    }, rawGid);
    await sleep(500);
    const raw = await ev(mp, () => {
      const pg = getCurrentPages()[getCurrentPages().length - 1];
      return { sheet: pg.data.rawSheet, blocks: (pg.data.rawBlocks || []).length, meta: pg.data.rawMeta };
    });
    check('原始消息弹层可打开且有分段', raw.sheet === true && raw.blocks > 0, JSON.stringify(raw));
    await shot(mp, '02-raw-sheet', 300);
    await ev(mp, () => {
      const pg = getCurrentPages()[getCurrentPages().length - 1];
      pg.closeRaw();
    });
    await sleep(300);
  } else {
    check('原始消息弹层可打开且有分段', false, '没有 hasRaw 卡片');
  }

  /* ---------- 6. 已过期筛选 / 区块展开 ---------- */
  await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    pg.toggleExpired();
  });
  await sleep(600);
  const exp = await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    return { showExpired: pg.data.showExpired, expiredCards: (pg.data.expiredCards || []).length, allFolded: (pg.data.expiredCards || []).every((c) => !c.expanded) };
  });
  check('已过期区块可展开且卡片仍默认收起', exp.showExpired === true && exp.expiredCards > 0 && exp.allFolded, JSON.stringify(exp));
  await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    pg.toggleExpired();
  });
  await sleep(300);
  await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    pg.pickFilter({ currentTarget: { dataset: { f: 'expired' } } });
  });
  await sleep(600);
  const expFilter = await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    return {
      filter: pg.data.filter,
      n: pg.data.cards.length,
      allExpired: (pg.data.cards || []).every((c) => c.expired),
      wrap: pg.data.showExpiredWrap
    };
  });
  check('「已过期」筛选只显示过期通知', expFilter.filter === 'expired' && expFilter.n > 0 && expFilter.allExpired && expFilter.wrap === false, JSON.stringify(expFilter));
  await shot(mp, '03-expired-filter', 300);
  await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    pg.pickFilter({ currentTarget: { dataset: { f: 'active' } } });
  });
  await sleep(500);

  /* ---------- 7. 滚动到附件卡 / 收集表截图 ---------- */
  let fileGid = '';
  for (const c of d.cards) { if (c.filesCount) { fileGid = c.id; break; } }
  if (fileGid) {
    await ev(mp, (gid) => {
      const pg = getCurrentPages()[getCurrentPages().length - 1];
      pg._expanded[gid] = true;
      pg.patchCard(gid, { expanded: true });
      return new Promise((resolve) => {
        setTimeout(() => {
          const domId = 'c_' + String(gid).replace(/[^A-Za-z0-9_-]/g, '_');
          const q = wx.createSelectorQuery();
          q.select('#card-' + domId + ' .nt-file').boundingClientRect();
          q.selectViewport().scrollOffset();
          q.exec(function (res) {
            const rect = (res && res[0]) || null;
            const scrollTop = (res && res[1] && res[1].scrollTop) || 0;
            const top = rect ? (rect.top + scrollTop - 160) : 800;
            wx.pageScrollTo({ scrollTop: Math.max(0, top), duration: 0 });
            setTimeout(resolve, 220);
          });
        }, 400);
      });
    }, fileGid);
    await shot(mp, '04-file-card', 700);
  }

  // 收集表行（表单位于已过期通知里：切到已过期筛选并展开第一张含表单卡片）
  await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    pg.pickFilter({ currentTarget: { dataset: { f: 'expired' } } });
  });
  await sleep(600);
  const formGid = await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    const card = (pg.data.cards || []).filter((c) => (c.items || []).some((it) => it.kind === 'form'))[0];
    if (!card) return '';
    pg._expanded[card.id] = true;
    pg.patchCard(card.id, { expanded: true });
    return card.id;
  });
  if (formGid) {
    await ev(mp, (gid) => {
      return new Promise((resolve) => {
        setTimeout(() => {
          const domId = 'c_' + String(gid).replace(/[^A-Za-z0-9_-]/g, '_');
          const q = wx.createSelectorQuery();
          q.select('#card-' + domId + ' .nt-item--form').boundingClientRect();
          q.selectViewport().scrollOffset();
          q.exec(function (res) {
            const rect = (res && res[0]) || null;
            const scrollTop = (res && res[1] && res[1].scrollTop) || 0;
            const top = rect ? (rect.top + scrollTop - 160) : 600;
            wx.pageScrollTo({ scrollTop: Math.max(0, top), duration: 0 });
            setTimeout(resolve, 220);
          });
        }, 400);
      });
    }, formGid);
    await shot(mp, '05-form-row', 700);
  }
  await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    pg.pickFilter({ currentTarget: { dataset: { f: 'active' } } });
  });
  await sleep(400);

  /* ---------- 8. 收尾 ---------- */
  await ev(mp, () => {
    try { wx.clearStorageSync(); } catch (e) {}
    try { require('utils/store.js').reset(); } catch (e) {}
  });

  const pass = checks.filter((c) => c.ok).length;
  const fail = checks.length - pass;
  fs.writeFileSync(path.join(__dirname, 'nt-result.json'), JSON.stringify({
    at: new Date().toISOString(), pass: pass, fail: fail, checks: checks, consoleIssues: consoleIssues
  }, null, 2), 'utf8');
  console.log('\n============ ' + pass + ' passed, ' + fail + ' failed ============');
  console.log('console errors/exceptions =', consoleIssues.length);
  if (consoleIssues.length) console.log(JSON.stringify(consoleIssues.slice(0, 8), null, 2));
  await mp.disconnect();
  process.exit(fail || consoleIssues.length ? 2 : 0);
})().catch((e) => { console.error('NT PREVIEW FATAL', e); process.exit(1); });
