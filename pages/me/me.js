// pages/me/me.js —— 我的（身份 / 我的数据 / 云同步 / 数据与隐私 / 帮助）
// v12 / 1.3.2：信息架构重做——工作台只保留「今日课程 + 待办 + 4 个常用工具」，
// 身份、个人数据、同步、隐私与帮助集中到本页；不再出现旧的 6 项全站统计与重复隐私长文。
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');
const identity = require('../../utils/identity.js');
const cloud = require('../../utils/cloud.js');
const version = require('../../utils/version.js');
const flow = require('../../utils/flow.js');
const share = require('../../utils/share.js');
const agent = require('../../utils/agent.js');
const scrollmem = require('../../utils/scrollmem.js');
const compliance = require('../../utils/compliance.js');
const appearance = require('../../utils/appearance.js');

Page({
  data: {
    state: 'loading',          // loading | data | error | empty
    errorText: '',
    identity: null,
    remoteReady: false,
    versionText: version.text(), // 需求 1：底部版本号（唯一来源 utils/version.js）
    icpBeian: compliance.ICP_BEIAN, // 小程序备案号（我的页底部展示，点击复制）
    syncing: false,
    syncText: '',
    pending: 0,
    // 2026-11-15 外观：跟随系统 / 浅色 / 深色（本机偏好，不同步账号；与安卓「我的 → 外观」同语义）
    appearanceMode: appearance.getMode(),
    appearanceOptions: appearance.MODES,
    // 我的数据（个人维度四项）：待交作业 / 已完成作业 / 抽签记录 / 体测记录
    stat: { hwOpen: 0, hwDone: 0, draw: 0, fit: 0 }
  },

  // 点击外观选项：落本机偏好 → 同步原生外壳（导航栏/窗口/tabBar）+ 当前及后台页面 CSS 变量
  pickAppearance(e) {
    const k = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.k) || '');
    if (!k || (appearance.MODE_KEYS.indexOf(k) < 0)) return;
    const mode = appearance.setMode(k);
    appearance.applyChrome();
    appearance.notifyPages();
    this.setData({ appearanceMode: mode });
    util.toast(mode === 'system' ? '已跟随系统' : (mode === 'dark' ? '已切换深色' : '已切换浅色'));
  },


  // 点击备案号复制（微信不允许小程序直接打开工信部外链；复制后可到浏览器核验）
  copyIcp() {
    const txt = String(this.data.icpBeian || '');
    if (!txt) return;
    wx.setClipboardData({ data: txt });
  },

  onLoad(options) {
    scrollmem.attach(this);
    options = options || {};
    this._agent = agent.pick(this);            // AI 页面接力（wx.onAgentHandoff），只消费一次
    this._agentQ = agent.pickQuery(options);   // 备用：handoff query 随页面参数传入
    this._first = true;
  },
  onShow() {
    share.enable();
    scrollmem.restore(this);
    if (!identity.ensure()) return;
    try { store.reload(); } catch (e) { /* ignore */ }
    // 外观偏好只存本机：回到本页时按最新值重绘选中态（例如从系统深色切回、或清缓存后）
    this.setData({ appearanceMode: appearance.getMode() });
    this.applyAgentHandoff();
    if (this._first) {
      this._first = false;
      this.setData({ state: 'loading' });
      this._t = setTimeout(() => { this._t = null; this.refresh(); }, 140);
    } else {
      this.refresh();
    }
  },
  onHide() {
    scrollmem.save(this); if (this._t) { clearTimeout(this._t); this._t = null; } },
  onUnload() {
    scrollmem.save(this); if (this._t) { clearTimeout(this._t); this._t = null; } },
  onPullDownRefresh() {
    this.refresh();
    if (cloud.isEnabled()) this.sync(false);
    wx.stopPullDownRefresh();
  },
  onCloudSync() { this.refresh(); },

  // —— AI 页面接力：我的页无定位参数；接力进入时先按本机数据渲染（不阻塞、不弹窗）——
  applyAgentHandoff() {
    if (this._agentApplied) return false;
    this._agentApplied = true;
    const h = this._agent;
    if (!h && !this._agentQ) return false;
    this.refresh();
    return true;
  },

  // 读取本机数据 + 计算「我的数据」四项个人指标
  // 待交 = 未完成且未被自己隐藏；已完成 = hwDone 命中（无 id 的旧行看 h.done）；抽签 = 最近一次抽签结果数；体测 = 本机体测记录数（最多 2）。
  refresh() {
    try {
      const id = identity.get();
      if (!id) {
        this.setData({ state: 'empty', errorText: '' });
        return;
      }
      const d = store.get();
      const homework = d.homework || [];
      const hwDone = d.hwDone || {};
      const hwHide = d.hwHide || {};
      let done = 0;
      let todo = 0;
      homework.forEach((h) => {
        const isDone = h.id ? !!hwDone[h.id] : !!h.done;
        const isHidden = h.id ? !!hwHide[h.id] : false;
        if (isDone) done += 1;
        else if (!isHidden) todo += 1;
      });
      const fl = flow.getFlow() || {};
      const draw = (fl.draw && fl.draw.result) ? fl.draw.result.length : 0;
      this.setData({
        state: 'data',
        errorText: '',
        identity: {
          name: id.name,
          role: id.role || '',
          badge: util.showBadge(id.badge, id.role),
          isAdmin: !!id.is_admin
        },
        remoteReady: cloud.isEnabled(),
        versionText: version.text(),
        syncText: cloud.syncText(),
        pending: cloud.pendCount() + (cloud.udStatus().udPend ? 1 : 0),
        stat: {
          hwOpen: todo,
          hwDone: done,
          draw: draw,
          fit: (d.fitRecs || []).length
        }
      });
    } catch (e) {
      this.setData({ state: 'error', errorText: '读取失败：' + ((e && e.message) || e) });
    }
  },

  // ---------------------- 同步 ----------------------
  // v19：udSync 语义已改为「拉取→合并→应用→必要时推送」，不再有 conflict 弹窗（契约 §3.3/§5.2）。
  // 同步结果由 cloudPull 汇总返回；手动同步只提示「已同步 / 原因」，具体数据在「数据与隐私」页。
  sync(manual) {
    if (!cloud.isEnabled()) {
      if (manual) util.toast('未连接云端');
      return;
    }
    if (!identity.has()) { identity.goIdentity(); return; }
    if (cloud.udOff()) {
      if (manual) util.toast('云同步已关闭（可在「数据与隐私」开启）');
      this.refresh();
      return;
    }
    this.setData({ syncing: true });
    cloud.cloudPull(!!manual)
      .then((r) => {
        this.setData({ syncing: false });
        if (!manual) { this.refresh(); return; }
        const ud = r && r.ud;
        const ok = !!(r && !r.off && (!ud || ud.ok));
        // 「清除云端」抑制期内只拉不推：如实提示，避免用户以为云端副本又写回了
        if (cloud.udHold && cloud.udHold()) util.toast('云端副本已清除，修改设置后会重新同步');
        else util.toast(ok ? '已同步' : ((ud && ud.reason) || '同步失败'));
        this.refresh();
      })
      .catch(() => {
        this.setData({ syncing: false });
        if (manual) util.toast('网络不可用，已保留本机数据');
        this.refresh();
      });
  },
  doSync() { this.sync(true); },

  // ---------------------- 身份 ----------------------
  doLogout() {
    wx.showModal({
      title: '退出身份',
      content: '退出后需重新输入姓名 + 学号验证；本机数据保留，班级名单缓存会清空。',
      confirmText: '退出',
      confirmColor: '#B87870',
      success: (r) => {
        if (!r.confirm) return;
        identity.logout();
      }
    });
  },
  goIdentity() { identity.goIdentity(); },

  // ---------------------- 数据 ----------------------
  goData() { wx.navigateTo({ url: '/pages/data/data' }); },
  clearData() {
    wx.showModal({
      title: '清空数据',
      content: '清空课表缓存 / 作业 / 通知 / 名单 / 体测 / 工作流，不可撤销。身份保留；云端副本不受影响。',
      confirmText: '清空',
      confirmColor: '#B87870',
      success: (r) => {
        if (!r.confirm) return;
        store.reset();
        try { wx.removeStorageSync('zq_flow'); } catch (e) { /* ignore */ }
        try { cloud.cache.clearAll(); } catch (e) { /* 缓存清理失败不影响清空本机数据 */ }
        cloud.ensureMembers(true);
        wx.showToast({ title: '已清空本机数据', icon: 'none' });
        this.refresh();
      }
    });
  },

  // ---------------------- 帮助（入口从「工具」页迁来） ----------------------
  goFeedback() { wx.navigateTo({ url: '/pages/fb/fb' }); },
  goHelp() { wx.navigateTo({ url: '/pages/ug/ug' }); },
  onPageScroll(e) { scrollmem.onScroll(this, e); },
  onShareAppMessage() {
    return share.message({
      title: '班级工具｜课表 · 作业 · 通知 · 抽签',
      path: '/pages/me/me',
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '班级工具｜课表 · 作业 · 通知 · 抽签',
      imageUrl: '/images/share/default.png'
    });
  }
});
