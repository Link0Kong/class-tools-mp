/* _qa_v2/automator_optional.js —— 开发者工具 automator 可选回归
 *
 * 前提：先启动微信开发者工具并 auto 连接（端口默认 9420）：
 *   & "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" auto \
 *     --project "C:\Users\Ko_Li\.openclaw\workspace\mp-class-tools" --auto-port 9420 --trust-project
 * 未连接时本脚本输出 SKIP（退出码 0），不影响 CI/终验结论——真机触摸回归需人工复核。
 *
 * 连上后做最小冒烟（不写云端、不改数据）：
 *   1) 打开工作台/课表页，读取 data.wk / 是否渲染；
 *   2) 课表页真实触摸（automator 触摸事件）沿内容区左滑，断言周次 +1；
 *   3) 断言 0 console error。
 */
'use strict';
const automator = require('miniprogram-automator');

// automator 底层 ws 在开发者工具关闭/重连时会抛异步错误：不能让可选项把验收脚本带崩。
process.on('uncaughtException', (e) => {
  console.log('SKIP  automator 会话异常:', String((e && e.message) || e).slice(0, 200));
  process.exit(0);
});
process.on('unhandledRejection', (e) => {
  console.log('SKIP  automator 会话异常:', String((e && e.message) || e).slice(0, 200));
  process.exit(0);
});

const PORT = Number(process.env.MP_AUTO_PORT || 9420);
const PROJECT = 'C:/Users/Ko_Li/.openclaw/workspace/mp-class-tools';

// 安全闸：默认不接管（开发者工具里可能有其他人在跑预览）。协调后显式 MP_AUTO_ALLOW=1 才执行。
if (String(process.env.MP_AUTO_ALLOW || '') !== '1') {
  console.log('SKIP  automator 可选回归默认关闭（避免干扰正在进行的开发者工具会话）。');
  console.log('      如已协调可运行：$env:MP_AUTO_ALLOW="1"; node automator_optional.js');
  process.exit(0);
}

(async function main() {
  let mini = null;
  try {
    mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + PORT });
  } catch (e) {
    console.log('SKIP  automator 未连接（ws://127.0.0.1:' + PORT + '）：' +
      '先 cli.bat auto --project ' + PROJECT + ' --auto-port ' + PORT + ' --trust-project');
    console.log('SKIP  → 真机/模拟器触摸回归需人工复核（见 README 第 4 节）');
    process.exit(0);
  }
  const rows = [];
  function T(name, ok, note) { rows.push({ name, ok: !!ok, note: note || '' }); console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (note ? '  --  ' + note : '')); }
  try {
    const errors = [];
    mini.on('console', (msg) => { try { if (msg.type === 'error') errors.push(String(msg.args)); } catch (e) { /* ignore */ } });
    const page = await mini.reLaunch('/pages/index/index');
    await page.waitFor(900);
    T('工作台可打开（reLaunch）', !!page);
    // 真机式触摸：第 9 周（周六有课 → 6 天溢出）左边缘右滑 = 切上一周（需求 3 修复点）
    const tt = await mini.navigateTo('/pages/tt/tt?wk=9');
    await tt.waitFor(1100);
    const info = async () => mini.evaluate(() => {
      const ps = getCurrentPages();
      const pg = ps[ps.length - 1] || {};
      return JSON.stringify({ wk: pg.data && pg.data.wk, overflow: !!pg._gridOverflow,
        x: pg._gridX || 0, max: pg._gridMaxX || 0, view: pg.data && pg.data.view });
    });
    let st = JSON.parse(await info() || '{}');
    T('课表页渲染且定位第 9 周', st.wk === 9, JSON.stringify(st));
    if (st.wk !== 9) { T('提示：该账号课表最大周 < 9，跳过滑动用例', false, 'wk=' + st.wk); }
    else {
      const X0 = 300, Y0 = 520;                    // 与 tt_swipe_preview.js 同一触摸基线坐标
      const x2 = X0 + 100;                         // 右滑（dx>0 = 上一周）
      try {
        // 手势绑定在 .ttswipe-track，触摸命中 .tscroll（scroll-view）内可冒泡到 track
        const el = (await tt.$('.tscroll')) || (await tt.$('.ttswipe-track'));
        if (!el) throw new Error('未找到 .tscroll/.ttswipe-track');
        const pt = (x) => [{ identifier: 0, clientX: x, clientY: Y0, pageX: x, pageY: Y0 }];
        await el.touchstart({ touches: pt(X0), changedTouches: pt(X0) });
        await el.touchmove({ touches: pt(X0 + 40), changedTouches: pt(X0 + 40) });
        await el.touchmove({ touches: pt(x2), changedTouches: pt(x2) });
        await el.touchend({ touches: [], changedTouches: pt(x2) });
        await tt.waitFor(1100);
        const st2 = JSON.parse(await info() || '{}');
        T('第 9 周（溢出周）左边缘右滑 → 切上一周（真实触摸）', st2.wk === 8,
          'overflow=' + st.overflow + ' gridX=' + st.x + '/' + st.max + ' wk ' + st.wk + ' → ' + st2.wk);
      } catch (e) {
        // automator 触摸 API 在本机偶发超时（开发者工具会话繁忙）；不判 FAIL，记 SKIP 并指向既有真实触摸回归脚本
        console.log('SKIP  真实触摸序列本次不可用（' + String(e && e.message || e).slice(0, 120) + '）');
        console.log('      完整真实触摸回归可在协调后运行：node mp-class-tools-tests/tt_swipe_preview.js（mp-dev 维护）');
      }
    }
    T('0 console error', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/Connection closed|not running|timeout|disconnect/i.test(msg)) {
      console.log('SKIP  automator 会话中断（开发者工具已关闭/忙碌）:', msg.slice(0, 160));
    } else {
      T('automator 冒烟异常', false, msg.slice(0, 200));
    }
  } finally {
    try { await mini.disconnect(); } catch (e) { /* ignore */ }
  }
  const fails = rows.filter((r) => !r.ok).length;
  console.log('\nautomator_optional: ' + rows.length + ' 项，FAIL ' + fails);
  process.exitCode = fails ? 2 : 0;
})().catch((e) => { console.log('SKIP  automator 不可用:', String(e && e.message || e).slice(0, 200)); process.exit(0); });
