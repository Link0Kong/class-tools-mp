// utils/scrollmem.js —— 页面滚动位置记忆（需求 2：重进 / 下拉刷新 / 切换后恢复）
//
// 设计目标（plan §5）：
//   * 通用：页面 onLoad 调 attach()，onShow 调 restore()，onHide/onUnload 调 save()，
//     onPageScroll 里调 onScroll()；不需要每个页面自己写计时器/查节点；
//   * 不阻塞渲染：restore() 只登记一个延时任务，等页面数据态（data.state）渲染完成后才瞬时滚回；
//   * 不与用户滚动打架：等待期间用户只要自己滚动（onPageScroll 触发）就取消恢复；恢复本身
//     duration=0、不做动画，不会和惯性滚动叠在一起；
//   * tab 页切回：小程序原生保留 tab 页实例与滚动位置，本模块只在「页面实例重建」（onLoad 后
//     第一次 onShow）时恢复内存里上一次的位置；同一实例的后续 onShow 不恢复（避免和用户较劲）。
//
// 内部 scroll-view（课表横向周表 / 国标表横向表）用 svSave/svGet：页面自己把位置写进
// scroll-view 的 scroll-left 初值，恢复时同样只做一次（页面实例重建时）。
//
// 只存在内存里（模块级），不写 storage：小程序进程重启后位置无意义，也不需要跨设备同步。
const _mem = {};       // route -> y（页面纵向滚动位置）
const _sv = {};        // route|key -> { left, top }（内部 scroll-view 位置）

function routeOf(page) {
  try { return String((page && (page.route || page.__route)) || ''); } catch (e) { return ''; }
}
function keyOf(page) { return routeOf(page) || 'unknown'; }

function state(page) {
  if (!page) return { y: 0, saved: 0, first: true, timer: null, cancel: false, got: false };
  if (!page._sm) {
    page._sm = {
      y: 0,                    // 当前实例已记录的位置（onPageScroll 更新）
      saved: Number(_mem[keyOf(page)]) || 0,  // 上次实例保存的位置（恢复目标）
      first: true,             // 本实例是否还没走过 onShow（只恢复一次）
      timer: null,             // 恢复等待定时器
      cancel: false,           // 用户已自己滚动 / 页面手动跳转 → 取消恢复
      got: false               // 是否收到过 onPageScroll
    };
  }
  return page._sm;
}

// onLoad 调用：建立本实例的状态（幂等）
function attach(page) { return state(page); }

// onPageScroll 调用：只记录，不 setData；若恢复任务还没执行 → 取消（用户已自己滚动）
function onScroll(page, e) {
  const st = state(page);
  const y = Math.max(0, Math.round(Number(e && e.scrollTop) || 0));
  st.y = y;
  st.got = true;
  if (st.timer) { st.cancel = true; clearTimeout(st.timer); st.timer = null; }
}

// 页面有主动定位动作（如跳到某条通知 / 某条作业）时调用，避免与恢复冲突
function cancel(page) {
  const st = state(page);
  st.cancel = true;
  if (st.timer) { clearTimeout(st.timer); st.timer = null; }
}

// onHide / onUnload 调用：保存当前位置；同时取消尚未执行的恢复任务（离开页面后不再滚）
function save(page) {
  const st = state(page);
  if (!page || !routeOf(page)) return;
  if (st.timer) { clearTimeout(st.timer); st.timer = null; }
  st.cancel = true;
  if (st.got || st.y > 0) {
    _mem[routeOf(page)] = st.y;
    // 收尾：本实例继续保留状态；下次实例重建时从 _mem 读
    st.saved = st.y;
  }
}

// 页面是否已经渲染出数据（data.state 为 loading / syncing 时继续等）
function readyOf(page) {
  const d = (page && page.data) || {};
  const s = d.state;
  if (s === undefined || s === null) return true;
  return s !== 'loading' && s !== 'syncing';
}

// onShow 调用：页面实例重建后的第一次 onShow 才恢复
function restore(page, opts) {
  const st = state(page);
  opts = opts || {};
  if (!st.first) return false;          // 同一实例后续 onShow：原生位置已保留，不恢复
  st.first = false;
  const y = Math.round(Number(st.saved) || 0);
  if (!y || y < 8) return false;
  st.cancel = false;
  const gap = Math.max(40, opts.gap == null ? 80 : opts.gap);
  const maxTry = Math.max(1, Math.round((opts.timeout == null ? 2000 : opts.timeout) / gap));
  let tries = 0;
  const tick = function () {
    st.timer = null;
    if (st.cancel) return;
    // 页面已被 reLaunch / 切换走（如身份失效回身份页）→ 不再恢复，避免滚错页面
    try {
      if (typeof getCurrentPages === 'function') {
        const pages = getCurrentPages();
        const cur = pages[pages.length - 1];
        if (cur && page.route && cur.route && cur.route !== page.route) return;
      }
    } catch (e) { /* 忽略 */ }
    if (!readyOf(page) && tries < maxTry) { tries += 1; st.timer = setTimeout(tick, gap); return; }
    if (st.cancel) return;
    try {
      wx.pageScrollTo({ scrollTop: y, duration: 0 });
    } catch (e) { /* 旧基础库不支持时静默放弃 */ }
    if (opts.onDone) { try { opts.onDone(); } catch (e) { /* ignore */ } }
  };
  if (st.timer) clearTimeout(st.timer);
  st.timer = setTimeout(tick, opts.delay == null ? 0 : opts.delay);
  return true;
}

// ---------------------------------------------------------------- 内部 scroll-view（横向）
function svKey(page, key) { return keyOf(page) + '|' + String(key || ''); }
function svSave(page, key, detail) {
  detail = detail || {};
  _sv[svKey(page, key)] = { left: Number(detail.scrollLeft) || 0, top: Number(detail.scrollTop) || 0 };
}
function svGet(page, key) { return _sv[svKey(page, key)] || null; }
function svClear(page, key) { delete _sv[svKey(page, key)]; }

// 测试 / 调试用：清空内存表
function resetAll() {
  Object.keys(_mem).forEach(function (k) { delete _mem[k]; });
  Object.keys(_sv).forEach(function (k) { delete _sv[k]; });
}

function memOf(route) { return Number(_mem[route]) || 0; }

module.exports = {
  attach: attach, onScroll: onScroll, save: save, restore: restore, cancel: cancel,
  svSave: svSave, svGet: svGet, svClear: svClear, resetAll: resetAll, memOf: memOf
};
