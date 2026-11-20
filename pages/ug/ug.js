// pages/ug/ug.js —— 使用说明（v2.0.0 卡片化重构：一屏一张卡 + 分类 chips + 总览 + 上下张）
//
// 结构（契约 2026-11-12「使用说明卡片化重构」§1/§2/§4）：
//   * 19 张卡片，一屏一张；swiper 横向跟手、首尾 clamp 不循环；
//   * 卡面：hero 场景图（WXSS view 形状，11 类 scene，不新增图片资源）+ 标题 + 一句话作用 + 3 条步骤 + 1 条提示；
//   * 顶部：分类胶囊 + 页码 + 「总览」按钮；分类 chips 点按跳到该分类首卡；
//   * 底部：上一张 / 页码 / 下一张（首尾禁用态）；
//   * 总览：遮罩弹层按分类分组列出全部 19 张卡，点条目关闭并跳卡；
//   * swiper 高度由 selector query 实测卡片最大高度后 setData（clamp 屏幕可用高度），不写死避免截断。
//
// 保留：top-app-bar / share.enable / onShareAppMessage / onShareTimeline /
//       agent handoff（SECTION_MAP → 卡片 index，不再依赖 #ug-<key> 锚点）/ scrollmem / 版本 2.0.0。
const identity = require('../../utils/identity.js');
const share = require('../../utils/share.js');
const agent = require('../../utils/agent.js');
const scrollmem = require('../../utils/scrollmem.js');
const version = require('../../utils/version.js');

// 分类（顺序即 chips 顺序）
const CATS = [
  { key: 'start', name: '入门' },
  { key: 'study', name: '学习' },
  { key: 'life', name: '生活' },
  { key: 'team', name: '协作' },
  { key: 'more', name: '更多' }
];

// 19 张卡（顺序即轮播顺序，契约 §4.2）；文案按 §0 硬规则：标题 ≤8 字、作用 ≤20 字、步骤 ≤24 字、提示 ≤30 字。
const CARDS = [
  {
    id: 'id', cat: 'start', icon: '🛡',
    title: '身份核验', sub: '姓名 + 学号进门，只显示姓名与角色',
    steps: ['首次打开先填姓名和学号', '通过班级名单校验后进入', '换设备重新验证即可同步'],
    tip: '名单与身份只存本机，退出身份即清除',
    scene: 'shield', tone: 'blue'
  },
  {
    id: 'home', cat: 'start', icon: '🏠',
    title: '工作台', sub: '今天要做什么，一页看完',
    steps: ['看今日课程和下一节课', '看待交作业与未处理通知', '关注的宿舍电费卡也在这一页'],
    tip: '只显示今天的事，全部功能在「工具」',
    scene: 'grid', tone: 'mint'
  },
  {
    id: 'draw', cat: 'study', icon: '🎲',
    title: '抽签分组', sub: '抽号 → 分组 → 结果单，可分享',
    steps: ['设范围、个数与参与名单', '结果可左滑剔除或补抽', '分组后结果单可复制、分享卡片或长图'],
    tip: '点「重置」清空本轮抽签与分组结果',
    scene: 'picks', tone: 'sand'
  },
  {
    id: 'roster', cat: 'study', icon: '👥',
    title: '参与名单', sub: '从班级名单点选，只从名单里抽',
    steps: ['点「选择名单」打开班级名单', '逐个点选，也可一键全选', '点「确定」后只从名单里抽'],
    tip: '名单不支持自定义输入，只来自班级名单',
    scene: 'people', tone: 'mint'
  },
  {
    id: 'bz', cat: 'study', icon: '🏅',
    title: '班级名单', sub: '班委、团员、全班三份名单',
    steps: ['点顶部切换班委 / 团员 / 全班', '班委名字旁有职务气泡与徽章', '管理员可在班委页点「管理」设职务'],
    tip: '所有已验证身份的同学都能查看',
    scene: 'people', tone: 'blue'
  },
  {
    id: 'tt', cat: 'study', icon: '📅',
    title: '课表', sub: '周 / 日视图，看下一节课',
    steps: ['左右箭头切换周次', '周 / 日视图一键切换', '点课程看教室、时间与教师'],
    tip: '课表来自教务，个人课表需登录教务',
    scene: 'grid', tone: 'mint'
  },
  {
    id: 'hw', cat: 'study', icon: '📝',
    title: '作业板', sub: '截止倒计时，勾完成并同步',
    steps: ['未完成 / 已完成两个分段切换', '勾「完成」后按账号同步', '验证身份后可发布作业与附件'],
    tip: '删除后全员看不到，隐藏只影响自己',
    scene: 'list', tone: 'sand'
  },
  {
    id: 'nt', cat: 'study', icon: '📢',
    title: '通知与附件', sub: '简报、附件、原始消息都在',
    steps: ['通知按时间排列，点开看简报', '附件图片与压缩包可预览下载', '可给通知设置微信提醒'],
    tip: '微信 / QQ / 同文通知会跨源合并',
    scene: 'list', tone: 'rose'
  },
  {
    id: 'ft', cat: 'study', icon: '📏',
    title: '体测', sub: '七项实时算分，存两条历史',
    steps: ['选性别与年级，填任意一项', '实时出单项分，全部填完出总分', '历史最多两条，可回填改名'],
    tip: '长跑按「分 : 秒」填写',
    scene: 'chart', tone: 'sand'
  },
  {
    id: 'roll', cat: 'study', icon: '🙋',
    title: '点名', sub: '叫到一个勾一个，已处理沉底',
    steps: ['选名单或沿用抽签名单', '点「到 / 假」记录状态', '已处理自动沉底，再点可撤销'],
    tip: '名单与记录按账号同步，可重置本轮',
    scene: 'people', tone: 'violet'
  },
  {
    id: 'power', cat: 'life', icon: '⚡',
    title: '宿舍电费', sub: '关注宿舍看余额和趋势',
    steps: ['点「关注宿舍」按楼栋选房间', '看余额、免费额度与电价', '点或拖动趋势看采样点'],
    tip: '13 / 16 号楼日更，不提供 24h 趋势',
    scene: 'chart', tone: 'blue'
  },
  {
    id: 'water', cat: 'life', icon: '💧',
    title: '水量抄表', sub: '每月抄表，自动对比算水费',
    steps: ['选 4 / 6 人间，填每月读数', '自动和上次对比算用量', '超出定额按 3.03 元/吨算'],
    tip: '每月 2 吨/人免费，水费从电费扣',
    scene: 'droplet', tone: 'blue'
  },
  {
    id: 'vote', cat: 'team', icon: '🗳',
    title: '投票', sub: '限时快投或跨天投票，实时结果',
    steps: ['选限时 5–120 分钟或指定截止', '标题与 2–20 个选项可加配图', '设单选多选、匿名与可见范围'],
    tip: '一人一票按账号去重，结果实时可见',
    scene: 'ballot', tone: 'mint'
  },
  {
    id: 'ppt', cat: 'team', icon: '📽',
    title: '演示', sub: '上传 PPT，自动转换后可下载',
    steps: ['先把 .pptx 发到微信聊天', '回本页从聊天选择并上传', '下载兼容版、PDF 或原始文件'],
    tip: '兼容包不改变 PPT 内容，可在线预览',
    scene: 'slides', tone: 'blue'
  },
  {
    id: 'file', cat: 'team', icon: '☁',
    title: '文件传输', sub: '同账号云空间，文件保留 3 天',
    steps: ['打开本页即可看到同账号文件', '上传自动分片，可看进度或取消', '可单独删除或一键清空'],
    tip: '单文件不限大小，自上传起保留 3 天',
    scene: 'transfer', tone: 'mint'
  },
  {
    id: 'screencast', cat: 'team', icon: '🖥',
    title: '大屏互联', sub: '大屏和手机同账号互传与遥控',
    steps: ['先在电脑浏览器打开大屏', '手机打开本页连接同一大屏', '可传文件、发文字或遥控大屏'],
    tip: '仅同账号设备互见，关闭后即断开',
    scene: 'transfer', tone: 'blue'
  },
  {
    id: 'all', cat: 'more', icon: '▦',
    title: '工具与排序', sub: '全部工具可长按排序，首页 4 个自选',
    steps: ['长按工具拖动调整全部顺序', '点「编辑首页」勾选首页快捷', '最多 4 个，点「完成」退出'],
    tip: '工具顺序与首页勾选随账号同步',
    scene: 'grid', tone: 'sand'
  },
  {
    id: 'data', cat: 'more', icon: '🔒',
    title: '数据与隐私', sub: '同步哪些数据、清除或导出都在这里',
    steps: ['查看云同步状态并立即同步', '可关闭云同步，恢复后自动补推', '可导出我的数据或清除云端/本机'],
    tip: '身份与名单缓存只存本机，可随时清除',
    scene: 'shield', tone: 'violet'
  },
  {
    id: 'fb', cat: 'more', icon: '✉',
    title: '反馈建议', sub: '问题与建议发给管理员',
    steps: ['写下问题或建议后提交', '管理员可看到并标记已处理', '在本页查看自己的反馈记录'],
    tip: '反馈不会公开你的学号',
    scene: 'list', tone: 'sand'
  }
];

// AI 接力 section → 本页卡片 id（getUsageGuide 的 section 与卡片标题不同，这里做映射）
const SECTION_MAP = {
  identity: 'id', id: 'id',
  home: 'home', index: 'home', workspace: 'home', features: 'home', share: 'home',
  draw: 'draw', lottery: 'draw', group: 'draw',
  roster: 'roster', names: 'roster',
  hw: 'hw', homework: 'hw',
  nt: 'nt', notice: 'nt', ntattach: 'nt',
  tt: 'tt', timetable: 'tt',
  ft: 'ft', fitness: 'ft',
  roll: 'roll', rollcall: 'roll',
  power: 'power', powercard: 'home',
  water: 'water',
  vote: 'vote',
  ppt: 'ppt', deck: 'ppt',
  file: 'file', cloudspace: 'file', transfer: 'file',
  screencast: 'screencast', cast: 'screencast', stage: 'screencast',
  bz: 'bz', committee: 'bz', league: 'bz',
  all: 'all', tools: 'all', order: 'all',
  data: 'data', sync: 'data', privacy: 'data',
  fb: 'fb', feedback: 'fb'
};

function winInfo() {
  try {
    if (wx.getWindowInfo) {
      const w = wx.getWindowInfo();
      return { w: Number(w.windowWidth) || 375, h: Number(w.windowHeight) || 667 };
    }
  } catch (e) { /* ignore */ }
  try {
    const s = wx.getSystemInfoSync();
    return { w: Number(s.windowWidth) || 375, h: Number(s.windowHeight) || 667 };
  } catch (e) { /* ignore */ }
  return { w: 375, h: 667 };
}

// 总览分组：同一份 CARDS 数据渲染，禁止另维护一份文案
function buildOvGroups() {
  return CATS.map(function (cat) {
    const list = [];
    CARDS.forEach(function (c, i) {
      if (c.cat !== cat.key) return;
      list.push({ idx: i, id: c.id, title: c.title, sub: c.sub, icon: c.icon, tone: c.tone });
    });
    return { key: cat.key, name: cat.name, cards: list };
  }).filter(function (g) { return g.cards.length > 0; });
}

function catOf(key) {
  for (let i = 0; i < CATS.length; i++) if (CATS[i].key === key) return CATS[i];
  return CATS[0];
}

Page({
  data: {
    cards: CARDS,
    cats: CATS,
    ovGroups: buildOvGroups(),
    cur: 0,
    curCat: CATS[0].key,
    catName: CATS[0].name,
    swiperH: 420,
    cardH: 0,          // >0 = 卡片撑满一屏（高度实测后写入）；0 = 内容自适应
    ov: false,
    scrolled: false,
    versionText: '班级工具 v' + version.VERSION
  },

  onLoad(options) {
    scrollmem.attach(this);
    options = options || {};
    this._agent = agent.pick(this);            // AI 页面接力（wx.onAgentHandoff），只消费一次
    this._agentQ = agent.pickQuery(options);   // 备用：handoff query 随页面参数传入
    const win = winInfo();
    // 首帧先给一个按屏幕高度估算的占位高度，onReady 后再用 selector query 实测替换
    this.setData({ swiperH: Math.max(280, Math.min(640, Math.round((win.h || 667) - 330))) });
  },

  onReady() { this._measure(0); },

  onShow() {
    share.enable();
    scrollmem.restore(this);
    identity.ensure();
    this.applyAgentHandoff();
  },

  onResize() { this._measure(0, true); },   // 横竖屏 / 窗口变化重新量一次（允许缩小）

  onPageScroll(e) {
    scrollmem.onScroll(this, e);
    const y = e.scrollTop;
    // 64/20 双阈值 + 单次提交，避免标题栏收缩后高度变化把 scrollTop 推回阈值附近来回抽动
    const next = y > 64 ? true : (y < 20 ? false : this.data.scrolled);
    if (next !== this.data.scrolled && !this._scBusy) {
      this._scBusy = true;
      this.setData({ scrolled: next }, () => { this._scBusy = false; });
    }
  },
  onHide() { scrollmem.save(this); },
  onUnload() { scrollmem.save(this); },

  // ---------------------------------------------------------------- 卡片导航
  _applyCur(idx) {
    const c = CARDS[idx];
    if (!c) return;
    const cat = catOf(c.cat);
    if (idx === this.data.cur && cat.key === this.data.curCat) return;
    this.setData({ cur: idx, curCat: cat.key, catName: cat.name });
    this._measure(0);                     // 只在需要时向上长高（不会缩小，避免量高循环）
  },
  onSwipe(e) {
    const to = Number(e && e.detail ? e.detail.current : -1);
    if (!(to >= 0) || to === this.data.cur) return;
    this._applyCur(to);
  },
  prev() { if (this.data.cur > 0) this._applyCur(this.data.cur - 1); },
  next() { if (this.data.cur < CARDS.length - 1) this._applyCur(this.data.cur + 1); },
  jumpCat(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const key = String(ds.cat || '');
    for (let i = 0; i < CARDS.length; i++) {
      if (CARDS[i].cat === key) { this._applyCur(i); return; }
    }
  },
  jumpTo(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const idx = Number(ds.idx);
    if (!(idx >= 0) || !CARDS[idx]) return;
    this.setData({ ov: false });
    this._applyCur(idx);
  },

  // ---------------------------------------------------------------- 总览弹层
  openOv() { this.setData({ ov: true }); },
  closeOv() { this.setData({ ov: false }); },
  noop() { /* 遮罩内点击 / 滚动穿透拦截 */ },

  // ---------------------------------------------------------------- 高度测量
  // 卡片内容高度由文案决定（窄屏步骤可能换行），写死会截断：先实测所有 .ug-card 的最大高度，
  // 再 clamp 到「窗口高度 − swiper 顶部 − 底部操作栏 − 安全间距」，超出时卡片内部 scroll-view 滚动。
  _measure(retry, force) {
    const that = this;
    if (this._measuring) return;
    this._measuring = true;
    const q = this.createSelectorQuery();
    q.selectAll('.ug-card').boundingClientRect();
    q.select('.ug-swiper').boundingClientRect();
    q.select('.ug-foot').boundingClientRect();
    q.exec(function (res) {
      that._measuring = false;
      const cards = (res && res[0]) || [];
      let maxH = 0;
      cards.forEach(function (r) { if (r && r.height > maxH) maxH = r.height; });
      if (!maxH) {                                   // 首次渲染未完成，稍后重试
        if ((retry || 0) < 6) setTimeout(function () { that._measure((retry || 0) + 1, force); }, 90);
        return;
      }
      const win = winInfo();
      const sw = (res && res[1]) || null;
      const ft = (res && res[2]) || null;
      const top = sw && sw.top > 0 ? sw.top : 0;
      const footH = ft && ft.height > 0 ? ft.height : 56;
      const avail = Math.max(240, Math.floor((win.h || 667) - top - footH - 16));
      const nat = Math.ceil(maxH) + 4;
      // 一屏一张卡：内容能装下时把卡片撑到可利用高度的 ~90%（不留大片空白），装不下则保持内容高度 + 卡内滚动
      const target = Math.min(avail, Math.max(nat, Math.round(avail * 0.9)));
      const fill = target >= nat + 2;
      const cur = Number(that.data.swiperH) || 0;
      const next = (force || !that._measured) ? target : Math.max(cur, target);
      that._measured = true;
      const patch = {};
      if (Math.abs(next - cur) > 1) patch.swiperH = next;
      const wantCard = fill ? next - 6 : 0;      // 卡片比 swiper 矮 6px，留出描边呼吸感
      if (Math.abs(wantCard - (Number(that.data.cardH) || 0)) > 1) patch.cardH = wantCard;
      if (Object.keys(patch).length) that.setData(patch);
    });
  },

  // ---------------------------------------------------------------- AI 页面接力
  // 只定位到对应卡片（setData cur），不再依赖 #ug-<key> 锚点滚动；同一 handoff 只消费一次。
  applyAgentHandoff() {
    if (this._agentApplied) return false;
    this._agentApplied = true;
    const h = this._agent;
    const p = (h && h.payload) || {};
    const q = Object.assign({}, this._agentQ || {}, (h && h.query) || {});
    if (!h && !this._agentQ) return false;
    const raw = String(q.section || p.section || '');
    const key = SECTION_MAP[raw] || raw;
    this._hoSection = key;
    for (let i = 0; i < CARDS.length; i++) {
      if (CARDS[i].id !== key) continue;
      scrollmem.cancel(this);
      const cat = catOf(CARDS[i].cat);
      this.setData({ cur: i, curCat: cat.key, catName: cat.name });
      return true;
    }
    return true;
  },

  onShareAppMessage() {
    return share.message({
      title: '班级工具｜使用说明',
      path: '/pages/ug/ug',
      imageUrl: '/images/share/default.png'
    });
  },
  onShareTimeline() {
    return share.timeline({
      title: '班级工具｜使用说明',
      imageUrl: '/images/share/default.png'
    });
  }
});
