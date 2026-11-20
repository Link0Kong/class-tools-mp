/* nt_share_check.js —— 2026-11-20 通知卡片分享回归
 *
 * 覆盖：
 *   · 通知卡片底栏「分享」→ 弹层打开、5:4 预览图由 canvas 生成（临时文件、非静态封面）；
 *   · 弹层含「图片分享」「微信卡片分享」两个选项；微信卡片按钮宽度与弹层一致；
 *   · 微信卡片分享：title=班级通知｜<标题>、path=/pages/nt/nt?gid=<id>、imageUrl=刚生成的预览图；
 *   · 分享图失败时有静态兜底（纯逻辑由 share_legal_unit.js 覆盖）；
 *   · 投票分享视图不包含结果（resultsMasked；纯逻辑由 share_legal_unit.js 覆盖）。
 *
 * 前置：开发者工具 `cli.bat auto --project <项目> --auto-port 9420 --trust-project`
 * 用法：node nt_share_check.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const automator = require('miniprogram-automator');

const OUT = path.join(__dirname, '_shots', 'nt_share');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const consoleIssues = [];

function check(name, ok, detail) {
  checks.push({ name: name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 400) });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' :: ' + detail : ''));
}

const CARD = {
  id: 'auto_share_demo', domId: 'c_auto_share_demo',
  title: '关于本周五下午举行主题班会的通知',
  cat: '班级事务', catCls: 'qt', source: 'QQ 群「2024级3班」', sourceKind: 'qq',
  senderName: '陈玉霞', pubBadge: '班长',
  statusLabel: '11月21日（周五）14:00', statusCls: 'future',
  summary: '本周五下午第三节课后在 A301 教室举行主题班会，请全班同学准时参加。',
  points: ['带好笔记本', '提前十分钟到教室'],
  timeLabel: '班会 11-21 14:00',
  hasRaw: true, hasDetail: true, expanded: true, closing: false,
  quotes: [], segs: [], items: [], imgs: [], imgCount: 0,
  compose: [{ n: 1, label: '条通知' }],
  done: false, recurring: false, isOcc: false, isInfo: false, expired: false,
  canDone: true, canRemind: true, reminded: false, remindLabel: '提醒',
  admin: false, updated: false, hidden: false, isOcr: false,
  moreText: '1 项详情', filesCount: 0, nextText: ''
};

async function ev(mp, fn, arg, tries) {
  let last = null;
  for (let i = 0; i < (tries || 4); i++) {
    try { return await mp.evaluate(fn, arg); } catch (e) { last = e; await sleep(1000); }
  }
  throw last;
}
async function routeOfPage(mp) {
  try {
    return await ev(mp, () => {
      const pages = getCurrentPages();
      const pg = pages[pages.length - 1];
      return pg ? pg.route : '';
    }, null, 2);
  } catch (e) { return ''; }
}
async function shot(mp, name) {
  for (let i = 0; i < 3; i++) {
    try { await mp.screenshot({ path: path.join(OUT, name + '.png') }); return true; } catch (e) { await sleep(1200); }
  }
  return false;
}

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
  mp.on('exception', (e) => consoleIssues.push('exception: ' + JSON.stringify(e).slice(0, 400)));
  mp.on('console', (e) => { if (e && e.type === 'error') consoleIssues.push('error: ' + (e.args || []).map(String).join(' ').slice(0, 400)); });
  await sleep(1500);

  /* ---------- 0. 测试身份（3260799999）---------- */
  const login = await ev(mp, () => new Promise((resolve) => {
    try {
      const identity = require('utils/identity.js');
      identity.login('3260799999', '测试账号').then((r) => resolve(!!(r && r.ok))).catch(() => resolve(false));
    } catch (e) { resolve(false); }
    setTimeout(() => resolve(false), 12000);
  }), null, 1);
  check('测试身份验证', login === true, 'identity.login ok=' + login);

  await ev(mp, () => { wx.reLaunch({ url: '/pages/nt/nt' }); });
  for (let i = 0; i < 24; i++) {
    if ((await routeOfPage(mp)) === 'pages/nt/nt') break;
    await sleep(500);
  }
  await sleep(1500);
  check('通知页打开', (await routeOfPage(mp)) === 'pages/nt/nt', await routeOfPage(mp));

  /* ---------- 1. 注入一张固定卡片并点「分享」---------- */
  const opened = await ev(mp, (card) => {
    const pages = getCurrentPages();
    const pg = pages[pages.length - 1];
    pg._raw = [{ id: card.id }];
    pg._all = [];
    pg.data.cards = [card];
    if (typeof pg.openShare !== 'function') return { err: 'no-openShare' };
    pg.openShare({ currentTarget: { dataset: { gid: card.id } } });
    return { ok: true, title: pg.data.shareTitle, sheet: pg.data.shareSheet };
  }, CARD, 2);
  check('点「分享」打开弹层', !!(opened && opened.ok && opened.sheet), JSON.stringify(opened));

  let state = null;
  for (let i = 0; i < 25; i++) {
    state = await ev(mp, () => {
      const pg = getCurrentPages()[getCurrentPages().length - 1];
      return {
        sheet: pg.data.shareSheet, gid: pg.data.shareGid, title: pg.data.shareTitle,
        busy: pg.data.shareBusy, img: pg.data.shareImg, poster: pg.data.sharePoster, hint: pg.data.shareHint
      };
    }, null, 2);
    if (state && state.busy === false) break;
    await sleep(300);
  }
  check('预览图生成完成（非生成中）', !!(state && state.busy === false), JSON.stringify(state));
  check('5:4 卡片封面是 canvas 临时文件', !!(state && /^https?:\/\/tmp\//.test(state.img)), state && state.img);
  check('完整长图是 canvas 临时文件', !!(state && /^https?:\/\/tmp\//.test(state.poster)), state && state.poster);
  check('弹层标题=通知标题', !!(state && state.title === CARD.title), state && state.title);

  let stat = null;
  if (state && state.img) {
    stat = await ev(mp, (p) => new Promise((resolve) => {
      wx.getFileSystemManager().stat({
        path: p,
        success: (r) => resolve({ ok: true, size: r.stats.size }),
        fail: (e) => resolve({ ok: false, err: String(e && e.errMsg || e) })
      });
    }), state.img, 2);
  }
  check('卡片封面文件有效（> 10KB）', !!(stat && stat.ok && stat.size > 10000), JSON.stringify(stat));

  let pstat = null;
  if (state && state.poster) {
    pstat = await ev(mp, (p) => new Promise((resolve) => {
      wx.getFileSystemManager().stat({
        path: p,
        success: (r) => resolve({ ok: true, size: r.stats.size }),
        fail: (e) => resolve({ ok: false, err: String(e && e.errMsg || e) })
      });
    }), state.poster, 2);
  }
  check('完整长图文件有效（> 20KB）', !!(pstat && pstat.ok && pstat.size > 20000), JSON.stringify(pstat));

  const msg = await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    return pg.onShareAppMessage({ from: 'button' });
  }, null, 2);
  check('微信卡片标题=班级通知｜<标题>', !!(msg && msg.title === ('班级通知｜' + CARD.title)), msg && msg.title);
  check('微信卡片深链带 gid', !!(msg && msg.path === '/pages/nt/nt?gid=' + CARD.id), msg && msg.path);
  check('微信卡片封面=本次 5:4 卡片', !!(msg && msg.imageUrl === state.img), msg && msg.imageUrl);

  check('分享弹层截图', await shot(mp, 'share_sheet'), path.join(OUT, 'share_sheet.png'));

  /* ---------- 2. 投票分享视图不含结果（渲染一张，供人工核对）---------- */
  const vote = await ev(mp, () => new Promise((resolve) => {
    const sc = require('utils/sharecard.js');
    const view = sc.buildVoteView({
      detail: {
        title: '周三班会时间投票', statusText: '进行中', modeText: '限时', total: 12,
        ownerText: '发起人 测试账号', deadlineText: '截止 11-21 18:00',
        desc: '请选择方便参加的时间，地点在 A301 教室。',
        tags: [{ text: '匿名' }, { text: '投票后可见' }],
        options: [
          { text: '周三 18:00', showBar: true, pct: 50, count: 6 },
          { text: '周三 19:00', showBar: true, pct: 33, count: 4 },
          { text: '周四 18:00', showBar: true, pct: 17, count: 2 },
          { text: '周四 19:00', showBar: true, pct: 0, count: 0 }
        ]
      },
      time: '2026-11-20 12:30'
    });
    resolve({
      masked: view.resultsMasked, hasPct: Object.prototype.hasOwnProperty.call(view.options[0], 'pct'),
      owner: view.ownerText, desc: view.desc, tags: view.tags.length, options: view.options
    });
  }), null, 2);
  check('投票分享视图含发起人/说明/规则且无百分比', !!(vote && vote.masked === true && vote.hasPct === false && vote.owner && vote.desc && vote.tags === 2), JSON.stringify(vote));

  await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    const sc = require('utils/sharecard.js');
    const flow = require('utils/shareflow.js');
    const view = sc.buildVoteView({
      detail: {
        title: '周三班会时间投票', statusText: '进行中', modeText: '限时', total: 12,
        ownerText: '发起人 测试账号', deadlineText: '截止 11-21 18:00',
        desc: '请选择方便参加的时间，地点在 A301 教室。',
        tags: [{ text: '匿名' }, { text: '投票后可见' }],
        options: [
          { text: '周三 18:00', showBar: true, pct: 50, count: 6 },
          { text: '周三 19:00', showBar: true, pct: 33, count: 4 },
          { text: '周四 18:00', showBar: true, pct: 17, count: 2 },
          { text: '周四 19:00', showBar: true, pct: 0, count: 0 }
        ]
      },
      time: '2026-11-20 12:30'
    });
    return flow.renderCard(pg, 'shareCanvas', view).then((p) => {
      pg.setData({ shareImg: p, shareTitle: '周三班会时间投票', shareBusy: false, shareHint: '' });
      return true;
    });
  }, null, 2);
  await sleep(1200);
  check('投票分享卡截图', await shot(mp, 'vote_card'), path.join(OUT, 'vote_card.png'));

  await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    if (pg && typeof pg.closeShare === 'function') pg.closeShare();
    return true;
  }, null, 1);
  const closed = await ev(mp, () => {
    const pg = getCurrentPages()[getCurrentPages().length - 1];
    return { sheet: pg.data.shareSheet, gid: pg.data.shareGid };
  }, null, 1);
  check('关闭弹层后状态复位', !!(closed && !closed.sheet && !closed.gid), JSON.stringify(closed));

  check('无 console error / exception', consoleIssues.length === 0, JSON.stringify(consoleIssues.slice(0, 5)));

  const pass = checks.filter((c) => c.ok).length;
  const fail = checks.length - pass;
  fs.writeFileSync(path.join(__dirname, 'nt_share_result.json'), JSON.stringify({ pass: pass, fail: fail, checks: checks, consoleIssues: consoleIssues }, null, 2));
  console.log('\n================ ' + pass + ' passed, ' + fail + ' failed ================');
  process.exitCode = fail ? 2 : 0;
  process.exit(fail ? 2 : 0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
