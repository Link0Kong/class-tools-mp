// pages/data/data.js —— 数据与隐私（v19 / 1.4.6：同步范围扩大后的统一入口）
//
// 内容严格按 CONTRACT §5.5：
//   身份摘要（姓名 + 角色，无学号）/ 云同步开关 / 同步范围清单 / 本机数据概览 /
//   云端数据状态（上次同步、待补发）/ 立即同步 / 导出我的数据 / 清除云端我的数据 /
//   清除本机数据（保身份）/ 隐私说明。
// 本次「用户改动内容全量同步」的口径：作业完成 / 通知已处理 / 通知置顶 / 工具栏顺序 / 体测录入 /
//   抽签参数 / 分组与名单 / 点名名单与到·假 / 隐藏项 / 课表偏好 / 通知提醒偏好 / 昵称
//   —— 可在网页与小程序同一账号下互通；身份 token 与班级名单缓存仍只在本机。
// 纯逻辑在 utils/privacy.js（可单测）；网络动作在 utils/cloud.js（setCloudOff / udClearCloud）。
const store = require('../../utils/store.js');
const util = require('../../utils/util.js');
const identity = require('../../utils/identity.js');
const cloud = require('../../utils/cloud.js');
const privacy = require('../../utils/privacy.js');
const share = require('../../utils/share.js');
const scrollmem = require('../../utils/scrollmem.js');

function fmtAt(ts) {
  if (!ts) return '尚未同步';
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return '尚未同步';
  return util.pad(d.getMonth() + 1) + '-' + util.pad(d.getDate()) + ' ' + util.pad(d.getHours()) + ':' + util.pad(d.getMinutes());
}
// 小程序版本号（开发版为空 → 显示「开发版」；不显示任何账号信息）
function appVersion() {
  try {
    if (!wx.getAccountInfoSync) return '';
    const a = wx.getAccountInfoSync();
    const v = a && a.miniProgram && a.miniProgram.version;
    return v ? String(v) : '开发版';
  } catch (e) { return ''; }
}
function storageInfo() {
  try {
    const i = wx.getStorageInfoSync();
    return { keys: (i && i.keys) ? i.keys.length : 0, kb: Math.round(((i && i.currentSize) || 0)) };
  } catch (e) { return { keys: 0, kb: 0 }; }
}
function blankCounts() {
  return { homework: 0, notices: 0, hwDone: 0, ntPin: 0, ntDone: 0, rosterSel: 0, groupSel: 0, rollSel: 0, fitRecs: 0, pending: 0 };
}

Page({
  data: {
    state: 'loading',           // loading | ready | error
    errorText: '',
    identity: null,             // {name, role, badge, isAdmin}（无学号）
    version: '',
    th: { primary: '#5E8F87' },
    cloudReady: false,
    cloudOff: false,
    hold: false,                 // 「清除云端」抑制期：不自动回推，等用户显式修改
    syncing: false,
    clearing: false,
    syncText: '',
    lastSyncText: '尚未同步',
    pendCount: 0,
    storage: { keys: 0, kb: 0 },
    counts: blankCounts(),
    scope: privacy.SCOPE
  },

  onLoad() {
    scrollmem.attach(this);
    this.setData({ th: util.nativeTheme() });
    if (wx.onThemeChange) {
      this._onTheme = () => { this.setData({ th: util.nativeTheme() }); };
      wx.onThemeChange(this._onTheme);
    }
  },
  onShow() {
    share.enable();
    scrollmem.restore(this);
    if (!identity.ensure()) return;
    try { store.reload(); } catch (e) { /* ignore */ }
    this.refresh();
  },
  onUnload() {
    scrollmem.save(this);
    if (this._onTheme && wx.offThemeChange) { wx.offThemeChange(this._onTheme); this._onTheme = null; }
  },
  onPullDownRefresh() {
    this.refresh();
    wx.stopPullDownRefresh();
    if (cloud.isReadyForSync()) this.doSync();
  },
  onCloudSync() { this.refresh(); },

  refresh() {
    try {
      const id = identity.get();
      const d = store.get();
      const st = cloud.udStatus();
      this.setData({
        state: 'ready',
        errorText: '',
        identity: id ? {
          name: id.name,
          role: id.role || '',
          badge: util.showBadge(id.badge, id.role),
          isAdmin: !!id.is_admin
        } : null,
        version: appVersion(),
        cloudReady: cloud.isEnabled(),
        cloudOff: !!d.cloudOff,
        hold: !!st.hold,
        syncText: cloud.syncText(),
        lastSyncText: fmtAt(st.at),
        pendCount: st.pend,
        storage: storageInfo(),
        counts: privacy.countsOf(d)
      });
    } catch (e) {
      this.setData({ state: 'error', errorText: '读取失败：' + ((e && e.message) || e) });
    }
  },

  // ---------------------- 云同步开关 ----------------------
  toggleCloud(e) {
    const on = !!(e && e.detail && e.detail.value);
    if (on === !this.data.cloudOff) return;          // 状态没变（switch 回弹保护）
    this.setData({ syncing: true });
    cloud.setCloudOff(!on).then((r) => {
      this.setData({ syncing: false });
      if (on) util.toast((r && r.ok) ? '已开启云同步' : ((r && r.reason) || '开启失败，稍后重试'));
      else util.toast('已切换为仅本机');
      this.refresh();
    }).catch(() => {
      this.setData({ syncing: false });
      util.toast('网络不可用，稍后重试');
      this.refresh();
    });
  },

  // ---------------------- 立即同步（force） ----------------------
  doSync() {
    if (!cloud.isReadyForSync()) {
      util.toast(cloud.isEnabled() ? '云同步已关闭，先打开开关' : '未连接云端');
      return;
    }
    if (this.data.syncing) return;
    this.setData({ syncing: true });
    cloud.cloudPull(true).then((r) => {
      this.setData({ syncing: false });
      const ud = r && r.ud;
      const ok = !!(r && !r.off && (!ud || ud.ok));
      if (cloud.udHold && cloud.udHold()) util.toast('云端副本已清除，修改设置后会重新同步');
      else util.toast(ok ? '已同步' : ((ud && ud.reason) || '同步失败'));
      this.refresh();
    }).catch(() => {
      this.setData({ syncing: false });
      util.toast('网络不可用，已保留本机数据');
      this.refresh();
    });
  },

  // ---------------------- 导出我的数据（JSON → 剪贴板；不含 token / 名单原文 / 学号） ----------------------
  exportData() {
    try {
      const json = privacy.exportJson(store.get(), identity.get());
      wx.setClipboardData({
        data: json,
        success: () => util.toast('已复制导出 JSON（' + Math.max(1, Math.round(json.length / 1024)) + ' KB）'),
        fail: () => util.toast('复制失败，请稍后重试')
      });
    } catch (e) {
      util.toast('导出失败：' + ((e && e.message) || e));
    }
  },

  // ---------------------- 清除云端我的数据（覆盖为空 / 置否 / 归档；RLS 无 DELETE） ----------------------
  clearCloud() {
    if (this.data.clearing) return;
    wx.showModal({
      title: '清除云端我的数据',
      content: '个人数据覆盖为空、勾选全部置否、体测记录归档。访问统计与反馈无法删除。本机保留的内容不会自动恢复；之后再次修改设置时会重新同步。',
      confirmText: '清除云端',
      confirmColor: '#B87870',
      success: (r) => {
        if (!r.confirm) return;
        this.setData({ clearing: true });
        cloud.udClearCloud().then((res) => {
          this.setData({ clearing: false });
          if (res && res.ok) {
            util.toast('已清除云端（marks ' + res.marks + ' 条 / 体测 ' + res.fitrecs + ' 条）· 修改设置时会重新同步');
          } else {
            util.toast((res && res.reason) || '清除失败，稍后重试');
          }
          this.refresh();
        }).catch(() => {
          this.setData({ clearing: false });
          util.toast('网络不可用，稍后重试');
          this.refresh();
        });
      }
    });
  },

  // ---------------------- 清除本机数据（保身份；云端副本不动） ----------------------
  clearLocal() {
    wx.showModal({
      title: '清除本机数据',
      content: '清空课表缓存 / 作业 / 通知 / 名单 / 体测 / 工作流与同步缓存；身份保留。云端数据不受影响。',
      confirmText: '清空本机',
      confirmColor: '#B87870',
      success: (r) => {
        if (!r.confirm) return;
        store.reset();
        try { wx.removeStorageSync('zq_flow'); } catch (e) { /* ignore */ }
        try { cloud.cache.clearAll(); } catch (e) { /* 缓存清理失败不影响清空本机数据 */ }
        cloud.ensureMembers(true);
        util.toast('已清空本机数据');
        this.refresh();
      }
    });
  },

  goFeedback() { wx.navigateTo({ url: '/pages/fb/fb' }); },

  onPageScroll(e) { scrollmem.onScroll(this, e); },
  onHide() { scrollmem.save(this); },
  onShareAppMessage() {
    return share.message({
      title: '班级工具｜数据与隐私',
      path: '/pages/data/data',
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '班级工具｜数据与隐私',
      imageUrl: '/images/share/default.png'
    });
  }
});
