// utils/roster.js —— 班级名单（class_members）座号选择 / 派生文本 / 旧数据迁移（v15 / 1.3.4）
//
// 唯一的名单来源：utils/cloud.js 拉取的 class_members → store.classMembers（70 人，座号升序）。
// 三处名单只保存「座号数组」（不再支持自定义名单文本）：
//   store.rosterSel    抽签 · 参与名单
//   store.group.sel    分组 · 班级名单成员
//   store.rollSel      点名名单
// 同时写派生文本，兼容旧渲染/旧算法（页面不再手工编辑这些文本）：
//   store.roster      "座号 姓名\n…"（util.rosterMap 解析，抽签/结果单名字用）
//   store.group.names "姓名\n…"（分组派生）
//   store.rollNames   "座号 姓名\n…"（点名 renders 解析用，parseNames 会去掉座号）
//
// 迁移（v1.3.3 及以前 → 1.3.4）：
//   旧自定义名单文本按「姓名与 classMembers 精确匹配」转成座号，匹配不到的人丢弃；
//   点名旧 rollSt 以「旧下标 → 姓名 → 新下标（按座号升序）」保留同一个人 到/假 状态；
//   迁移成功置 store.selVer = 1，之后不再重跑；classMembers 为空时返回 false，等名单同步后重试。
const store = require('./store.js');

const SEL_VER = 1;

function normSeats(list) { return store.normSeats(list); }

// classMembers 清洗：seat 正整数 + name 非空 + 按座号升序 + 座号去重
function members() {
  const raw = store.get().classMembers;
  const out = [], seen = {};
  (Array.isArray(raw) ? raw : []).forEach(function (m) {
    if (!m || typeof m !== 'object') return;
    const seat = Number(m.seat);
    const name = String(m.name == null ? '' : m.name).trim();
    if (!isFinite(seat) || !Number.isInteger(seat) || seat < 1 || !name || seen[seat]) return;
    seen[seat] = true;
    out.push({
      seat: seat,
      sid: String(m.sid == null ? '' : m.sid),
      name: name,
      role: String(m.role == null ? '' : m.role),
      badge: String(m.badge == null ? '' : m.badge),
      is_admin: !!m.is_admin
    });
  });
  out.sort(function (a, b) { return a.seat - b.seat; });
  return out;
}

function mapOf(list) {
  const map = {};
  (list || []).forEach(function (m) { map[m.seat] = m; });
  return map;
}

// 座号 → 成员对象（保留班级名单里的顺序/信息；未知座号丢弃）
function pickedOf(seats) {
  const map = mapOf(members());
  const out = [];
  normSeats(seats).forEach(function (s) { if (map[s]) out.push(map[s]); });
  return out;
}
function pickedSeats(seats) { return pickedOf(seats).map(function (m) { return m.seat; }); }

// "座号 姓名" 多行文本（供 util.rosterMap 解析）
function textOf(seats) {
  return pickedOf(seats).map(function (m) { return m.seat + ' ' + m.name; }).join('\n');
}
// 仅姓名多行文本（分组派生）
function namesTextOf(seats) {
  return pickedOf(seats).map(function (m) { return m.name; }).join('\n');
}

function selOf(mode) {
  const d = store.get();
  if (mode === 'group') return normSeats(d.group && d.group.sel);
  if (mode === 'roll') return normSeats(d.rollSel);
  return normSeats(d.rosterSel);
}
function selNamesOf(mode) {
  return pickedOf(selOf(mode)).map(function (m) { return m.name; });
}

// 页面摘要：{ count, chips:[{seat,name}], more }
function summary(mode, max) {
  const picked = pickedOf(selOf(mode));
  const n = Math.max(1, +max || 8);
  return {
    count: picked.length,
    chips: picked.slice(0, n).map(function (m) { return { seat: m.seat, name: m.name }; }),
    more: Math.max(0, picked.length - n)
  };
}

function parseNames(text) {
  const out = [];
  String(text == null ? '' : text).split(/\r?\n/).forEach(function (line) {
    const s = String(line).trim();
    if (!s) return;
    const m = s.match(/^\d+\s*[.,、:：\-]?\s*(.+)$/);
    const n = (m ? m[1] : s).trim();
    if (n) out.push(n);
  });
  return out;
}
function parseGroupNames(text) {
  return String(text == null ? '' : text).split(/[\n,，、;；\t]+/)
    .map(function (s) { return String(s).trim(); })
    .filter(Boolean);
}

// 旧 rollSt（下标 → 到/假）按姓名转成 { 姓名: 状态 }，供重排后找回同一个人
function rollStatusByName(oldNames, oldSt) {
  const byName = {};
  (oldNames || []).forEach(function (nm, i) {
    const s = (oldSt || {})[i];
    if (s && !byName[nm]) byName[nm] = s;
  });
  return byName;
}

// 点名写派生：rollNames = "座号 姓名"；rollSt 按姓名从旧名单迁移（选择变化时不丢 到/假）
function writeRoll(d, seats) {
  const status = rollStatusByName(parseNames(d.rollNames), d.rollSt || {});
  const picked = pickedOf(seats);
  d.rollSel = picked.map(function (m) { return m.seat; });
  d.rollNames = picked.map(function (m) { return m.seat + ' ' + m.name; }).join('\n');
  const st = {};
  picked.forEach(function (m, i) { if (status[m.name]) st[i] = status[m.name]; });
  d.rollSt = st;
  return d.rollSel;
}

// 设置某个模式的选择（座号数组，未知座号会按 classMembers 过滤）并写派生字段
function setSel(mode, seats) {
  const d = store.get();
  const list = pickedSeats(seats);
  if (mode === 'group') {
    d.group = d.group || {};
    d.group.sel = list;
    d.group.names = namesTextOf(list);
  } else if (mode === 'roll') {
    writeRoll(d, list);
  } else {
    d.rosterSel = list;
    d.roster = textOf(list);
  }
  store.save();
  return list;
}

// 点名：选择名单 / 沿用抽签名单统一入口
function rollSet(seats) { return setSel('roll', seats); }

// 抽签池过滤：seats 为空 = 不限（只抽序号）；否则只保留所选座号
function poolFilter(pool, seats) {
  const sel = normSeats(seats);
  const base = (pool || []).slice();
  if (!sel.length) return base;
  const set = {};
  sel.forEach(function (s) { set[s] = true; });
  return base.filter(function (n) { return !!set[n]; });
}

// 旧文本名单 → 座号：逐行/逐项取姓名，与 classMembers 精确匹配；匹配不到丢弃
function seatsFromNames(names) {
  const byName = {};
  members().forEach(function (m) { if (!byName[m.name]) byName[m.name] = m.seat; });
  const out = [];
  (names || []).forEach(function (nm) {
    const s = byName[nm];
    if (s && out.indexOf(s) < 0) out.push(s);
  });
  return normSeats(out);
}

// 迁移：旧自定义名单文本 → 座号；幂等；classMembers 为空返回 false（等下次重试）
function migrate(force) {
  const d = store.get();
  if (!force && Number(d.selVer) >= SEL_VER) return true;
  if (!members().length) return false;

  const oldRollNames = parseNames(d.rollNames);

  // 抽签：旧 roster（"1 张三" / "张三" 逐行）→ 座号
  if (!normSeats(d.rosterSel).length && d.roster) {
    d.rosterSel = seatsFromNames(parseNames(d.roster));
  }
  // 分组：旧 group.names（换行/逗号分隔姓名）→ 座号；旧 source 'paste' 归一为 'pick'
  if (d.group && !normSeats(d.group.sel).length && d.group.names) {
    d.group.sel = seatsFromNames(parseGroupNames(d.group.names));
  }
  if (d.group && d.group.source === 'paste') d.group.source = 'pick';
  // 点名：旧 rollNames → 座号
  if (!normSeats(d.rollSel).length && d.rollNames) {
    d.rollSel = seatsFromNames(oldRollNames);
  }

  d.selVer = SEL_VER;
  // 重新生成派生文本（匹配不到的人被丢弃，文本收敛到班级名单）
  d.group = d.group || {};
  d.rosterSel = pickedSeats(d.rosterSel);
  d.roster = textOf(d.rosterSel);
  d.group.sel = pickedSeats(d.group.sel);
  d.group.names = namesTextOf(d.group.sel);
  // 点名：用旧 rollSt（按姓名）重建新下标状态
  const status = rollStatusByName(oldRollNames, d.rollSt || {});
  const rollPicked = pickedOf(d.rollSel);
  d.rollSel = rollPicked.map(function (m) { return m.seat; });
  d.rollNames = rollPicked.map(function (m) { return m.seat + ' ' + m.name; }).join('\n');
  const st = {};
  rollPicked.forEach(function (m, i) { if (status[m.name]) st[i] = status[m.name]; });
  d.rollSt = st;

  store.save();
  return true;
}

// ---------------------------------------------------------------- 2026-11-11 名单快捷预设（需求 8）
// 抽签/分组/点名名单选择器 + 投票「指定成员」共用「全班 / 班委 / 团员」基础集合：
//   * 点击预设只替换当前选择为基础集合，之后仍可逐个点气泡增删；
//   * 座号数组数据格式不变（只存 classMembers 里的座号；团员来自 class_league 缓存，过滤到班级名单内）；
//   * 团员名单走 utils/cloud.js leaguePull（6h TTL + 本机缓存 store.classLeague），离线时返回空数组。
const QUICK_KINDS = ['all', 'committee', 'league'];
const QUICK_LABELS = { all: '全班', committee: '班委', league: '团员' };

// 班委座号：role 或 badge 非空（与 committee 页/网页口径一致）
function committeeSeats() {
  return members().filter(function (m) { return !!(m.role || m.badge); }).map(function (m) { return m.seat; });
}
// 团员座号：store.classLeague 缓存 ∩ 班级名单（座号升序）
function leagueSeats() {
  const known = {};
  members().forEach(function (m) { known[m.seat] = true; });
  return normSeats((store.get().classLeague || []).map(function (x) { return x && x.seat; })
    .filter(function (s) { return !!known[s]; }));
}
// 预设基础集合（kind: all | committee | league）；未知 kind → 当前选择（由调用方处理）
function quickSeats(kind) {
  if (kind === 'all') return members().map(function (m) { return m.seat; });
  if (kind === 'committee') return committeeSeats();
  if (kind === 'league') return leagueSeats();
  return [];
}

// ---------------------------------------------------------------- 名单页三分类视图（pages/committee）
// 与网页「名单」工具（班委 / 团员 / 全班，web/AGENTS.md §33）同口径：
//   * 班委 tab：role/badge 非空；管理员「管理」时显示全班以便设置职务，按职务权重排序；
//   * 团员 tab：class_league 缓存 ∩ 班级名单（座号升序），行上显示团员 pill；
//   * 全班 tab：全部成员按座号升序，仅姓名与座号。
// opts: { members, league, leagueLoaded, leagueErr, edit }
// 返回 { rows, counts:{committee,league,leagueText,all}, note, emptyText }
const ROLE_RANK = {
  '班长': 1, '副班长': 2, '团支部书记': 3, '副团支部书记': 4, '学习委员': 5,
  '生活委员': 6, '纪律委员': 7, '文娱委员': 8, '劳动委员': 9, '体育委员': 10,
  '心理委员': 11, '组织委员': 12, '宣传委员': 13, '廉政监督员': 14
};

function listView(kind, opts) {
  const o = opts || {};
  const all = Array.isArray(o.members) ? o.members : members();
  const league = Array.isArray(o.league) ? o.league : [];
  const loaded = !!o.leagueLoaded;
  const edit = !!o.edit;
  const bySeat = {};
  all.forEach(function (m) { bySeat[m.seat] = m; });
  let rows = [];
  if (kind === 'league') {
    rows = (loaded ? league : []).map(function (x) {
      const seat = Math.round(Number(x && x.seat));
      const m = bySeat[seat] || {};
      return {
        key: 'lg-' + seat, seat: seat, name: String((x && x.name) || m.name || ''),
        role: m.role || '', badge: m.badge || '', isAdmin: !!m.is_admin,
        sid: m.sid || '', showLeague: true
      };
    });
  } else if (kind === 'all') {
    rows = all.slice().sort(function (a, b) { return a.seat - b.seat; }).map(function (m) {
      return { key: m.sid || String(m.seat), seat: m.seat, name: m.name, role: m.role, badge: m.badge || '', isAdmin: !!m.is_admin, sid: m.sid || '', showLeague: false };
    });
  } else {
    rows = (edit ? all.slice() : all.filter(function (m) { return !!(m.role || m.badge); }))
      .sort(function (a, b) {
        return ((ROLE_RANK[a.role] || 99) - (ROLE_RANK[b.role] || 99)) || ((+a.seat || 0) - (+b.seat || 0));
      })
      .map(function (m) {
        return { key: m.sid || String(m.seat), seat: m.seat, name: m.name, role: m.role, badge: m.badge || '', isAdmin: !!m.is_admin, sid: m.sid || '', showLeague: false };
      });
  }
  const committeeCount = all.filter(function (m) { return !!(m.role || m.badge); }).length;
  const counts = {
    committee: committeeCount,
    league: loaded ? league.length : 0,
    leagueText: loaded ? String(league.length) : '',
    all: all.length
  };
  let note = '仅显示姓名与座号；班委职务可在「管理」中设置';
  if (kind === 'all') note = '全班 ' + counts.all + ' 人 · 仅姓名与座号';
  else if (kind === 'league') note = '团员名单来自班级团员库' + (o.leagueErr ? ('（' + o.leagueErr + '）') : '');
  let emptyText = '暂无班委身份信息';
  if (kind === 'league') emptyText = loaded ? '暂无团员名单' : '团员名单加载中…';
  else if (kind === 'all') emptyText = '暂无名单';
  return { rows: rows, counts: counts, note: note, emptyText: emptyText };
}

module.exports = {
  SEL_VER, QUICK_KINDS, QUICK_LABELS,
  normSeats,
  members, pickedOf, pickedSeats, selOf, selNamesOf,
  textOf, namesTextOf, summary,
  setSel, rollSet, poolFilter,
  committeeSeats, leagueSeats, quickSeats,
  ROLE_RANK, listView,
  migrate, parseNames, parseGroupNames
};
