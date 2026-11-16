// ai/skills/account/apis/exportMyData.js —— 导出我的数据（原子接口）
//
// 与主包 utils/privacy.js buildExport 同口径：只含用户自己改动/同步范围的数据 + 身份摘要（姓名/角色），
// 不含 token、学号、完整班级名单（classMembers/classRoster）、派生名单文本（rollNames/group.names/roster）。
// jsonText 上限 8KB（字节）：超限时先压成紧凑 JSON，再剪裁 marks 条目，最后才丢弃可选字段。
const auth = require('../../../common/auth.js');
const local = require('../../../common/local.js');
const fmt = require('../../../common/fmt.js');
const result = require('../../../common/result.js');
const handoff = require('../../../common/handoff.js');
const v6 = require('../lib/v6.js');

const MAX_BYTES = 8192;

function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
function byteLen(s) {
  const str = String(s || '');
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i += 1; }
    else n += 3;
  }
  return n;
}
function pruneMarks(m, keep) {
  const out = {};
  Object.keys(m || {}).forEach(function (k, i) { if (i < keep) out[k] = !!m[k]; });
  return out;
}
function topN(obj, n) {
  const out = {};
  Object.keys(obj || {}).slice(0, n).forEach(function (k) { out[k] = obj[k]; });
  return out;
}

function buildExport(d, id) {
  const fitRecs = (d.fitRecs || []).slice(0, 2).map(function (r) {
    return {
      ts: Number(r.ts) || 0,
      name: String(r.name || ''),
      sex: r.sex === 'f' ? 'f' : 'm',
      gr: r.gr === '34' ? '34' : '12',
      total: r.total == null ? null : Number(r.total),
      grade: String(r.grade || '')
    };
  });
  return {
    schema: 'class-tools-userdata',
    v: v6.VERSION,
    exportedAt: new Date().toISOString(),
    who: { name: id.name, role: id.role || '', badge: id.badge || '', admin: !!id.is_admin },
    sync: {
      homeTools: (d.homeTools || []).slice(0, 8),
      fit: clone(d.fit || {}),
      draw: clone(d.draw || {}),
      group: {
        source: String((d.group && d.group.source) || ''),
        mode: String((d.group && d.group.mode) || ''),
        n: Number(d.group && d.group.n) || 0,
        shuffle: !!(d.group && d.group.shuffle),
        sel: ((d.group && d.group.sel) || []).slice()
      },
      roster: { rosterSel: (d.rosterSel || []).slice(), rollSel: (d.rollSel || []).slice(), rollSt: topN(d.rollSt, 100) },
      hide: { hwHide: topN(d.hwHide, 100), ntHide: topN(d.ntHide, 100) },
      tt: { termStart: String(d.termStart || '') },
      prefs: { hwRemind: topN(d.hwRemind, 50), ntSub: !!d.ntSub, ntSubAt: Number(d.ntSubAt) || 0 },
      marks: { hwDone: topN(d.hwDone, 100), ntPin: topN(d.ntPin, 100), ntDone: topN(d.ntDone, 100) }
    },
    fitRecs: fitRecs
  };
}

function fitText(obj) {
  let text = JSON.stringify(obj, null, 2);
  if (byteLen(text) <= MAX_BYTES) return text;
  text = JSON.stringify(obj);
  if (byteLen(text) <= MAX_BYTES) return text;
  // 剪裁：marks 每类保留 40/20/10/0 条，逐级尝试
  const levels = [40, 20, 10, 0];
  for (let i = 0; i < levels.length; i++) {
    const copy = clone(obj);
    copy.sync.marks.hwDone = pruneMarks(copy.sync.marks.hwDone, levels[i]);
    copy.sync.marks.ntPin = pruneMarks(copy.sync.marks.ntPin, levels[i]);
    copy.sync.marks.ntDone = pruneMarks(copy.sync.marks.ntDone, levels[i]);
    copy.sync.hide.hwHide = topN(copy.sync.hide.hwHide, levels[i]);
    copy.sync.hide.ntHide = topN(copy.sync.hide.ntHide, levels[i]);
    text = JSON.stringify(copy);
    if (byteLen(text) <= MAX_BYTES) return text;
  }
  // 最后兜底：只留摘要字段
  const minimal = {
    schema: obj.schema, v: obj.v, exportedAt: obj.exportedAt, who: obj.who,
    note: '数据量较大，完整内容请在「数据与隐私」页导出'
  };
  return JSON.stringify(minimal);
}

module.exports = function exportMyData() {
  const id = auth.getIdentity();
  if (!id) return result.identityFail();

  const d = local.readStore();
  const data = buildExport(d, id);
  const jsonText = fitText(data);
  const bytes = byteLen(jsonText);
  const summary = {
    homework: (d.homework || []).length,
    notices: (d.notices || []).length,
    hwDone: Object.keys(d.hwDone || {}).filter(function (k) { return !!d.hwDone[k]; }).length,
    ntDone: Object.keys(d.ntDone || {}).filter(function (k) { return !!d.ntDone[k]; }).length,
    fitRecs: (d.fitRecs || []).length,
    bytes: bytes
  };
  const s = {
    summary: summary,
    jsonText: jsonText,
    pagePath: handoff.PAGES.data,
    pageTitle: '数据与隐私'
  };
  const text = '已生成导出 JSON（约 ' + Math.max(1, Math.round(bytes / 1024)) + ' KB）：包含你的同步范围数据与身份摘要（姓名/角色），' +
    '不含身份凭证、学号和班级名单原文。可以把 jsonText 交给用户自行保存。';
  return result.ok(text, s, {
    _meta: { cardData: { summary: summary } },
    handoff: handoff.handoffTo('data', '', { tab: 'export' })
  });
};
