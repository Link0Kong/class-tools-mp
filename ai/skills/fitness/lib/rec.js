// ai/skills/fitness/lib/rec.js —— 体测表单 / 历史记录（对齐 pages/ft/ft.js 与 utils/cloud.js fitPush/fitPull/fitDelete）
const local = require('../../../common/local.js');
const auth = require('../../../common/auth.js');
const rest = require('../../../common/rest.js');
const config = require('../../../common/config.js');
const fmt = require('../../../common/fmt.js');
const fit = require('./fit.js');

const FIT_KEYS = ['h', 'w', 'vc', 'r50', 'sit', 'jump', 'pull', 'durM', 'durS'];
const ITEM_KEYS = ['bmi', 'vc', 'r50', 'sit', 'jump', 'pull', 'dur'];

function sval(v) { return String(v == null ? '' : v).trim(); }

// 记录时间文案（pages/ft recDate：MM-DD HH:mm）
function recDate(ts) {
  const d = new Date(ts || 0);
  return fmt.pad(d.getMonth() + 1) + '-' + fmt.pad(d.getDate()) + ' ' + fmt.pad(d.getHours()) + ':' + fmt.pad(d.getMinutes());
}
function recName(r) {
  return (r && r.name) ? String(r.name) : ('体测 ' + recDate(r && r.ts));
}
// 成绩明细（pages/ft recDetail 逐字节）
function recDetail(f) {
  f = f || {};
  const p = [];
  if (f.h) p.push('身高 ' + f.h + 'cm');
  if (f.w) p.push('体重 ' + f.w + 'kg');
  if (f.vc) p.push('肺活量 ' + f.vc + 'mL');
  if (f.r50) p.push('50米 ' + f.r50 + 's');
  if (f.sit) p.push('坐位 ' + f.sit + 'cm');
  if (f.jump) p.push('跳远 ' + f.jump + 'cm');
  if (f.pull) p.push((f.sex === 'f' ? '仰卧 ' : '引体 ') + f.pull + '次');
  if (f.durM || f.durS) p.push('长跑 ' + (f.durM || '0') + "'" + fmt.pad(f.durS || 0) + '"');
  return p.join(' · ') || '（无成绩明细）';
}
function recDetailOf(r) { return recDetail(Object.assign({ sex: r && r.sex }, (r && r.fields) || {})); }

// 旧记录的非空项都和新数据一致（新数据只是多填了项）→ 可合并（pages/ft fitSubset 逐字节）
function fitSubset(oldF, newF) {
  oldF = oldF || {}; newF = newF || {};
  let any = false;
  for (let i = 0; i < FIT_KEYS.length; i++) {
    const k = FIT_KEYS[i], ov = sval(oldF[k]), nv = sval(newF[k]);
    if (ov) {
      any = true;
      if (nv !== ov) return false;
    }
  }
  return any;
}
function findMergeIndex(list, fields, sex, gr) {
  for (let i = 0; i < (list || []).length; i++) {
    const r = list[i];
    if ((r.sex || 'm') !== sex || (r.gr || '12') !== gr) continue;
    if (fitSubset(r.fields || {}, fields)) return i;
  }
  return -1;
}

// ---------------------------------------------------------------- 入参 → 页面表单（字段名与 pages/ft 表单一致）
// 数字清洗：pages/ft cleanNumber 逐字节
function cleanNumber(v, dec, allowNeg) {
  v = String(v == null ? '' : v).replace(/[^\d.\-]/g, '');
  if (!allowNeg) v = v.replace(/-/g, '');
  else {
    const neg = v.charAt(0) === '-';
    v = v.replace(/-/g, '');
    if (neg) v = '-' + v;
  }
  const dot = v.indexOf('.');
  if (dot >= 0) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
  if (dec === 0) v = v.replace(/\..*$/, '');
  else if (dot >= 0) v = v.split('.')[0] + '.' + v.split('.')[1].slice(0, dec);
  return v;
}
function numField(v, dec, allowNeg, label) {
  if (v == null || v === '') return { v: '' };
  const res = cleanNumber(v, dec, allowNeg);
  if (res === '' || res === '-' || !isFinite(Number(res))) {
    return { err: label + '需为数字，例如 ' + (dec === 0 ? '175' : '175.5') + '；不填则不传该字段。' };
  }
  return { v: res };
}
// 长跑：接受秒数（250）或「分'秒」/「分:秒」/「4 分 10 秒」文本
function parseRun(v, label) {
  if (v == null || v === '') return { durM: '', durS: '' };
  let total = null;
  if (typeof v === 'number') {
    if (!isFinite(v) || v <= 0) return { err: label + '需为正数（秒）或「分\'秒」文本。' };
    total = v;
  } else {
    const s = String(v).trim();
    if (!s) return { durM: '', durS: '' };
    if (/^\d+(\.\d+)?$/.test(s)) total = +s;
    else {
      const m = s.match(/^(\d+)\s*['′:：分]\s*(\d+(?:\.\d+)?)\s*(?:["″秒]|'')?$/);
      if (m) total = (+m[1]) * 60 + (+m[2]);
      else return { err: label + '格式不正确：可传秒数（如 250）或「分\'秒」（如 4\'10"）。' };
    }
  }
  if (!(total > 0)) return { err: label + '需大于 0。' };
  let mm = Math.floor(total / 60), ss = Math.round(total - mm * 60);
  if (ss >= 60) { mm += 1; ss -= 60; }
  return { durM: String(mm), durS: String(ss) };
}

function pickDefined(a, b) { return a !== undefined && a !== null ? a : b; }

// 解析并校验 calculateFitness / saveFitnessRecord 的入参；返回 { form } 或 { err }
function buildForm(args) {
  args = args || {};
  const sex = args.sex === 'f' ? 'f' : (args.sex === 'm' ? 'm' : null);
  if (!sex) return { err: 'sex 需为 m（男）或 f（女）。' };
  const gradeRaw = String(args.grade == null ? '' : args.grade);
  const grade = gradeRaw === '12' ? '12' : (gradeRaw === '34' ? '34' : null);
  if (!grade) return { err: 'grade 需为 12（大一 / 大二）或 34（大三 / 大四）。' };

  const form = { sex: sex, grade: grade, h: '', w: '', vc: '', r50: '', sit: '', jump: '', pull: '', durM: '', durS: '' };
  const specs = [
    ['height', 'h', 1, false, '身高'],
    ['weight', 'w', 1, false, '体重'],
    ['vitalCapacity', 'vc', 0, false, '肺活量'],
    ['run50', 'r50', 2, false, '50 米跑'],
    ['sitReach', 'sit', 1, true, '坐位体前屈'],
    ['standingJump', 'jump', 0, false, '立定跳远']
  ];
  for (let i = 0; i < specs.length; i++) {
    const argKey = specs[i][0], formKey = specs[i][1], dec = specs[i][2], neg = specs[i][3], label = specs[i][4];
    if (args[argKey] === undefined || args[argKey] === null || args[argKey] === '') continue;
    const r = numField(args[argKey], dec, neg, label);
    if (r.err) return { err: r.err };
    form[formKey] = r.v;
  }

  // 引体向上（男）/ 1 分钟仰卧起坐（女）：按性别取对应字段，另一字段作为兜底
  const pullRaw = sex === 'm' ? pickDefined(args.pullUp, args.sitUp) : pickDefined(args.sitUp, args.pullUp);
  if (pullRaw !== undefined && pullRaw !== null && pullRaw !== '') {
    const r = numField(pullRaw, 0, false, sex === 'm' ? '引体向上' : '1 分钟仰卧起坐');
    if (r.err) return { err: r.err };
    form.pull = r.v;
  }

  // 长跑：男生 run1000、女生 run800
  const runRaw = sex === 'm' ? pickDefined(args.run1000, args.run800) : pickDefined(args.run800, args.run1000);
  if (runRaw !== undefined && runRaw !== null && runRaw !== '') {
    const r = parseRun(runRaw, sex === 'm' ? '1000 米跑' : '800 米跑');
    if (r.err) return { err: r.err };
    form.durM = r.durM;
    form.durS = r.durS;
  }

  const any = FIT_KEYS.some(function (k) { return sval(form[k]) !== ''; });
  if (!any) {
    return { err: '至少需要填写一项成绩（身高、体重、肺活量、50 米跑、坐位体前屈、立定跳远、引体/仰卧起坐、长跑之一）。' };
  }
  return { form: form };
}

// 结果行 → 结构化评分（score=标准分，bonus=加分，total=总分，level=等级）
function levelOf(s) {
  if (s == null) return '';
  return s >= 90 ? '优秀' : (s >= 80 ? '良好' : (s >= 60 ? '及格' : '不及格'));
}
function calcData(r) {
  const items = (r.rows || []).map(function (row, i) {
    return {
      key: ITEM_KEYS[i] || ('item' + i),
      label: row.n,
      value: row.v,
      unit: row.sub,
      weight: row.wt,
      score: row.s,
      bonus: row.p || 0,
      level: levelOf(row.s)
    };
  });
  const bmiRow = (r.rows || [])[0];
  const bmi = (bmiRow && bmiRow.s != null) ? Number(bmiRow.v) : null;
  return {
    score: r.std,
    bonus: r.plus,
    total: r.total,
    totalText: r.totalText,
    level: r.grade,
    bmi: bmi,
    bmiText: (bmiRow && bmiRow.v !== '—') ? String(bmiRow.v) : '',
    miss: r.miss,
    wtDone: r.wtDone,
    items: items
  };
}

// ---------------------------------------------------------------- 历史记录（本机 fitRecs，≤2 条）
function getRecs() { return (local.getFitRecs() || []).slice(0, 2); }
function setRecs(list) { local.setFitRecs((list || []).slice(0, 2)); return getRecs(); }
function findRec(id) {
  if (id == null || id === '') return null;
  const list = getRecs();
  for (let i = 0; i < list.length; i++) {
    if (String(list[i] && list[i].id) === String(id)) return list[i];
  }
  return null;
}
function findRecIndex(id) {
  const list = getRecs();
  for (let i = 0; i < list.length; i++) if (String(list[i] && list[i].id) === String(id)) return i;
  return -1;
}
function formFromRec(r) {
  const f = (r && r.fields) || {};
  return {
    sex: (r && r.sex === 'f') ? 'f' : 'm',
    grade: (r && r.gr === '34') ? '34' : '12',
    h: f.h || '', w: f.w || '', vc: f.vc || '', r50: f.r50 || '', sit: f.sit || '',
    jump: f.jump || '', pull: f.pull || '', durM: f.durM || '', durS: f.durS || ''
  };
}
function recItem(r) {
  return {
    recordId: r && r.id != null ? String(r.id) : '',
    name: recName(r),
    dateText: recDate(r && r.ts),
    ts: (r && r.ts) || 0,
    sex: (r && r.sex === 'f') ? 'f' : 'm',
    sexText: (r && r.sex === 'f') ? '女' : '男',
    grade: (r && r.gr === '34') ? '34' : '12',
    gradeText: (r && r.gr === '34') ? '大三大四' : '大一大二',
    total: r && r.total != null ? Number(r.total) : null,
    level: (r && r.grade) ? String(r.grade) : '',
    detail: recDetailOf(r)
  };
}

// 记录 id：utils/cloud.js cbId 同源
function cbId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// ---------------------------------------------------------------- 云端 fitrecs（utils/cloud.js fitPush / fitDelete 同源）
function cloudOn() { return auth.hasIdentity() && rest.isConfigured(); }
function fitRow(rec) {
  return {
    id: rec.id,
    acc: auth.sid(),
    data: JSON.stringify({
      id: rec.id, ts: rec.ts, n: rec.name || '',
      sex: rec.sex, gr: rec.gr, fields: rec.fields, total: rec.total, grade: rec.grade
    }),
    arch: false,
    ts: rec.ts || Date.now()
  };
}
function fitPush(rec) {
  if (!cloudOn() || !rec) return Promise.resolve(false);
  return rest.upsert(config.tables.fitrecs, [fitRow(rec)])
    .then(function () { rec._sync = false; return true; })
    .catch(function () { rec._sync = true; return false; });
}
// 软删：与 utils/cloud.js cbPatch（读整行 + 幂等 upsert）等价，置 arch=true
function fitDelete(id) {
  if (!cloudOn() || !id) return Promise.resolve(false);
  return rest.byId(config.tables.fitrecs, id).then(function (row) {
    if (!row) return false;
    return rest.upsert(config.tables.fitrecs, [Object.assign({}, row, { arch: true })]).then(function () { return true; });
  }).catch(function () { return false; });
}

module.exports = {
  FIT_KEYS: FIT_KEYS,
  recDate: recDate, recName: recName, recDetail: recDetail, recDetailOf: recDetailOf,
  fitSubset: fitSubset, findMergeIndex: findMergeIndex,
  cleanNumber: cleanNumber, numField: numField, parseRun: parseRun, buildForm: buildForm,
  levelOf: levelOf, calcData: calcData,
  getRecs: getRecs, setRecs: setRecs, findRec: findRec, findRecIndex: findRecIndex,
  formFromRec: formFromRec, recItem: recItem,
  cbId: cbId, cloudOn: cloudOn, fitRow: fitRow, fitPush: fitPush, fitDelete: fitDelete
};
