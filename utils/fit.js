// utils/fit.js —— 大学生体测（国标）计算
// 表数据逐行取自原站 index.html（FTS/FTB/FTP/FTBMI/FTFIELDS），未做改动。
var FTS=[100,95,90,85,80,78,76,74,72,70,68,66,64,62,60,50,40,30,20,10];
/* 每项四列与 FTS 一一对应：m12 男大一大二 / m34 男大三大四 / f12 女大一大二 / f34 女大三大四 */
var FTB={
  vc:{hi:true,
    m12:[5040,4920,4800,4550,4300,4180,4060,3940,3820,3700,3580,3460,3340,3220,3100,2940,2780,2620,2460,2300],
    m34:[5140,5020,4900,4650,4400,4280,4160,4040,3920,3800,3680,3560,3440,3320,3200,3030,2860,2690,2520,2350],
    f12:[3400,3350,3300,3150,3000,2900,2800,2700,2600,2500,2400,2300,2200,2100,2000,1960,1920,1880,1840,1800],
    f34:[3450,3400,3350,3200,3050,2950,2850,2750,2650,2550,2450,2350,2250,2150,2050,2010,1970,1930,1890,1850]},
  r50:{
    m12:[6.7,6.8,6.9,7.0,7.1,7.3,7.5,7.7,7.9,8.1,8.3,8.5,8.7,8.9,9.1,9.3,9.5,9.7,9.9,10.1],
    m34:[6.6,6.7,6.8,6.9,7.0,7.2,7.4,7.6,7.8,8.0,8.2,8.4,8.6,8.8,9.0,9.2,9.4,9.6,9.8,10.0],
    f12:[7.5,7.6,7.7,8.0,8.3,8.5,8.7,8.9,9.1,9.3,9.5,9.7,9.9,10.1,10.3,10.5,10.7,10.9,11.1,11.3],
    f34:[7.4,7.5,7.6,7.9,8.2,8.4,8.6,8.8,9.0,9.2,9.4,9.6,9.8,10.0,10.2,10.4,10.6,10.8,11.0,11.2]},
  sit:{hi:true,
    m12:[24.9,23.1,21.3,19.5,17.7,16.3,14.9,13.5,12.1,10.7,9.3,7.9,6.5,5.1,3.7,2.7,1.7,0.7,-0.3,-1.3],
    m34:[25.1,23.3,21.5,19.9,18.2,16.8,15.4,14.0,12.6,11.2,9.8,8.4,7.0,5.6,4.2,3.2,2.2,1.2,0.2,-0.8],
    f12:[25.8,24.0,22.2,20.6,19.0,17.7,16.4,15.1,13.8,12.5,11.2,9.9,8.6,7.3,6.0,5.2,4.4,3.6,2.8,2.0],
    f34:[26.3,24.4,22.4,21.0,19.5,18.2,16.9,15.6,14.3,13.0,11.7,10.4,9.1,7.8,6.5,5.7,4.9,4.1,3.3,2.5]},
  jump:{hi:true,
    m12:[273,268,263,256,248,244,240,236,232,228,224,220,216,212,208,203,198,193,188,183],
    m34:[275,270,265,258,250,246,242,238,234,230,226,222,218,214,210,205,200,195,190,185],
    f12:[207,201,195,188,181,178,175,172,169,166,163,160,157,154,151,146,141,136,131,126],
    f34:[208,202,196,189,182,179,176,173,170,167,164,161,158,155,152,147,142,137,132,127]},
  pull:{hi:true,
    m12:[19,18,17,16,15,15,14,14,13,13,12,12,11,11,10,9,8,7,6,5],
    m34:[20,19,18,17,16,16,15,15,14,14,13,13,12,12,11,10,9,8,7,6]},
  sup:{hi:true,
    f12:[56,54,52,49,46,44,42,40,38,36,34,32,30,28,26,24,22,20,18,16],
    f34:[57,55,53,50,47,45,43,41,39,37,35,33,31,29,27,25,23,21,19,17]},
  dur:{
    m12:[197,202,207,214,222,227,232,237,242,247,252,257,262,267,272,292,312,332,352,372],
    m34:[195,200,205,212,220,225,230,235,240,245,250,255,260,265,270,290,310,330,350,370],
    f12:[198,204,210,217,224,229,234,239,244,249,254,259,264,269,274,284,294,304,314,324],
    f34:[196,202,208,215,222,227,232,237,242,247,252,257,262,267,272,282,292,302,312,322]}
};
/* 加分表 [超出量, 加分]：引体向上 / 仰卧起坐为高优指标，1000 米 / 800 米跑为低优指标 */
var FTP={
  pull:[[10,10],[9,9],[8,8],[7,7],[6,6],[5,5],[4,4],[3,3],[2,2],[1,1]],
  sup:[[13,10],[12,9],[11,8],[10,7],[9,6],[8,5],[7,4],[6,3],[4,2],[2,1]],
  durM:[[35,10],[32,9],[29,8],[26,7],[23,6],[20,5],[16,4],[12,3],[8,2],[4,1]],
  durF:[[50,10],[45,9],[40,8],[35,7],[30,6],[25,5],[20,4],[15,3],[10,2],[5,1]]
};
var FTBMI={m:[17.9,23.9],f:[17.2,23.9]};
var FTRANGE={
  h:[100,250], w:[25,200], vc:[500,8000], r50:[3,15],
  sit:[-20,40], jump:[50,350], pull:[0,100]
};
var FTFIELDS=[["fH","h"],["fW","w"],["fVc","vc"],["fR50","r50"],["fSit","sit"],["fJump","jump"],["fPull","pull"],["fDurM","durM"],["fDurS","durS"]];

// ---- 计算逻辑（对齐原站 ftCol / ftPick / ftScore / ftPlus / ftNum / ftSec / ftMS / ftCalc）----
function ftCol(sex, gr) { return (sex === 'f' ? 'f' : 'm') + (gr === '34' ? '34' : '12'); }
function ftPick(t, sex, gr) { return t[ftCol(sex, gr)]; }

function ftScore(t, v, sex, gr) {
  const a = ftPick(t, sex, gr);
  if (!a || v == null) return null;
  for (let i = 0; i < a.length; i++) { if (t.hi ? (v >= a[i]) : (v <= a[i])) return FTS[i]; }
  return 0;
}
function ftPlus(tab, gap) {
  if (!tab || !(gap > 0)) return 0;
  for (let i = 0; i < tab.length; i++) { if (gap >= tab[i][0]) return tab[i][1]; }
  return 0;
}
function ftNum(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return null;
  const v = +s;
  return isFinite(v) ? v : null;
}
function ftSec(m, s) {
  const a = ftNum(m), b = ftNum(s);
  if (a == null && b == null) return null;
  return (a || 0) * 60 + (b || 0);
}
function ftValid(key, v) {
  if (v == null) return null;
  /* 长跑只要求 > 0 秒：之前下限 120 秒会把女生 800 米 1'5x"、只填了秒的输入判成
     缺项（行里显示 —、总分不变）。0:00 仍然无效，避免 0 秒拿满分。 */
  if (key === 'dur') return v > 0 ? v : null;
  const r = FTRANGE[key];
  if (!r) return v;
  return (v >= r[0] && v <= r[1]) ? v : null;
}
function ftMS(x) {
  if (x == null) return '—';
  let m = Math.floor(x / 60), s = Math.round(x - m * 60);
  if (s >= 60) { m += 1; s -= 60; }
  return m + "'" + (s < 10 ? '0' : '') + s + '"';
}

// 返回 { rows, std, plus, total, grade, miss, wtDone, sex, gr }
function ftCalc(f) {
  f = f || {};
  const sex = (f.sex === 'f') ? 'f' : 'm';
  const gr = (f.grade === '34') ? '34' : '12';
  const rows = [];
  let std = 0, plus = 0, miss = 0;
  function add(o) {
    rows.push(o);
    if (o.s == null) { miss += 1; } else { std += o.s * o.wt / 100; plus += (o.p || 0); }
  }
  function item(name, unit, wt, raw, val, tab, ptab, gapOf, key) {
    val = ftValid(key, val);
    const s = ftScore(tab, val, sex, gr);
    const p = (s == null || !gapOf) ? 0 : ftPlus(ptab, gapOf(val));
    add({ n: name, sub: unit, wt: wt, v: (raw === '' || raw == null) ? '—' : raw, s: s, p: p });
  }
  const h = ftValid('h', ftNum(f.h)), w = ftValid('w', ftNum(f.w));
  let bmi = null, bs = null;
  if (h > 0 && w > 0) {
    bmi = Math.round(w / ((h / 100) * (h / 100)) * 10) / 10;
    const r = FTBMI[sex];
    bs = bmi < r[0] ? { s: 80, t: '低体重' } : (bmi <= r[1] ? { s: 100, t: '正常' } : (bmi <= 27.9 ? { s: 80, t: '超重' } : { s: 60, t: '肥胖' }));
  }
  add({ n: '体重指数', sub: bs ? ('BMI · ' + bs.t) : 'BMI', wt: 15, v: bs ? bmi.toFixed(1) : '—', s: bs ? bs.s : null, p: 0 });
  item('肺活量', 'mL', 15, f.vc, ftNum(f.vc), FTB.vc, null, null, 'vc');
  item('50 米跑', '秒', 20, f.r50, ftNum(f.r50), FTB.r50, null, null, 'r50');
  item('坐位体前屈', 'cm', 10, f.sit, ftNum(f.sit), FTB.sit, null, null, 'sit');
  item('立定跳远', 'cm', 10, f.jump, ftNum(f.jump), FTB.jump, null, null, 'jump');
  if (sex === 'm') {
    item('引体向上', '次', 10, f.pull, ftNum(f.pull), FTB.pull, FTP.pull, function (v) { return v - ftPick(FTB.pull, sex, gr)[0]; }, 'pull');
  } else {
    item('1 分钟仰卧起坐', '次', 10, f.pull, ftNum(f.pull), FTB.sup, FTP.sup, function (v) { return v - ftPick(FTB.sup, sex, gr)[0]; }, 'pull');
  }
  const du = ftValid('dur', ftSec(f.durM, f.durS));
  const duRaw = (ftNum(f.durM) == null && ftNum(f.durS) == null) ? '' : ftMS(ftSec(f.durM, f.durS));
  item(sex === 'm' ? '1000 米跑' : '800 米跑', '分·秒', 20, duRaw, du, FTB.dur, (sex === 'm' ? FTP.durM : FTP.durF), function (v) { return ftPick(FTB.dur, sex, gr)[0] - v; }, 'dur');
  let wtDone = 0;
  rows.forEach(function (o) { if (o.s != null) wtDone += o.wt; });
  std = Math.round(std * 10) / 10;
  plus = Math.round(plus * 10) / 10;
  const total = Math.round((std + plus) * 10) / 10;
  const grade = total >= 90 ? '优秀' : (total >= 80 ? '良好' : (total >= 60 ? '及格' : '不及格'));
  return { rows: rows, std: std, plus: plus, total: total, totalText: total.toFixed(1), grade: grade, miss: miss, wtDone: wtDone, sex: sex, gr: gr };
}

module.exports = {
  FTS: FTS, FTB: FTB, FTP: FTP, FTBMI: FTBMI, FTRANGE: FTRANGE, FTFIELDS: FTFIELDS,
  ftCol: ftCol, ftPick: ftPick, ftScore: ftScore, ftPlus: ftPlus, ftValid: ftValid,
  ftNum: ftNum, ftSec: ftSec, ftMS: ftMS, ftCalc: ftCalc
};
