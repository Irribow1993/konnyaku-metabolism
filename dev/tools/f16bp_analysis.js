/* METABOLISM：F1,6BP が溜まり続ける原因の分析（v0.2.0 の前提作業。調整用の道具。ゲームには含まれない）
 *   node dev/tools/f16bp_analysis.js [--json]
 * 現行モデル（v0.1.2 の計算 ＝ v0.1.1 と同じ）を、実際のセーブ（fixtures/v6_saves.json）から長時間進め、
 *   - PFK-1 の流入量・アルドラーゼの正味の流出量・PK の流束・ATP/ADP 比
 *   - 各反応の「能力」（いまの物質量で、その反応が出せる最大の速さ）と、平衡からの距離 Q/K
 * を記録する。さらに、1か所だけ条件を変えた比較実験（反事実）で、どの反応が蓄積の主因かを確かめる。
 * 計算の中身は変えない（比較実験は複製した state と一時的なデータの変更で行い、必ず元に戻す）。 */
'use strict';
const path = require('path'), fs = require('fs');
for (const f of ['data.js', 'glossary.js', 'sim.js']) require(path.join(__dirname, '../../public/js', f));
const MB = globalThis.MB, S = MB.Sim;
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, '../tests/fixtures/v6_saves.json'), 'utf8'));
const R = id => MB.REACTIONS.find(r => r.id === id);
const load = name => { const s = S.deserialize(JSON.stringify(FX[name])); s.lastSaved = Date.now(); return s; };
const clone = s => S.deserialize(S.serialize(s));
const QK = (s, id) => S.massActionRatio(id, s) / S.kGame(id);

/* その反応の、いまの物質量での「能力」：Vmax × 基質の飽和度（mm）／可逆反応は生成物を 0 とした前向きの最大（rev）。
 * 実際の速さ ÷ 能力 ＝ どれだけ能力を使い切っているか（1 に近いほど、その酵素の量そのものが上限） */
function capacity(s, id) {
  const r = R(id), k = r.kinetics, Vm = S.vmax(s, r), a = x => Math.max(0, s.amounts[x] || 0);
  if (k.type === 'zero') return Vm;
  if (k.type === 'mm') { let v = Vm; for (const [x, Km] of Object.entries(k.km)) v *= a(x) / (Km + a(x));
    for (const g of r.regulation || []) if (g.kind === 'inhibition') v *= g.ki / (g.ki + a(g.effector)); return v; }
  let fwd = 1, dS = 1; for (const [x, Ks] of Object.entries(k.ks)) { fwd *= a(x) / Ks; dS *= 1 + a(x) / Ks; }
  return Vm * fwd / dS;
}
const IDS = ['glut', 'hk', 'pfk', 'aldo', 'tpi', 'gapdh', 'pgk', 'pk', 'ldh', 'atpase'];
function snap(s) {
  const a = s.amounts, f = s.flux, o = { t: s.t };
  for (const k of ['glc', 'g6p', 'f6p', 'f16bp', 'dhap', 'gap', 'bpg13', 'pg3', 'pep', 'pyr', 'atp', 'adp', 'nad', 'nadh', 'lac']) o[k] = a[k];
  o.atpFrac = a.atp / (a.atp + a.adp);
  for (const id of IDS) { o['J_' + id] = f[id] || 0; o['cap_' + id] = capacity(s, id); }
  o.dF16BP = (f.pfk || 0) - (f.aldo || 0);                         // F1,6BP の増え方 ＝ PFK-1 の流入 − アルドラーゼの正味の流出
  o.QK_aldo = QK(s, 'aldo'); o.QK_gapdh = QK(s, 'gapdh'); o.QK_tpi = QK(s, 'tpi'); o.QK_pgk = QK(s, 'pgk');
  o.atpMake = (f.pgk || 0) + (f.pk || 0);                          // ATP をつくる：PGK・PK
  o.atpUse = (f.hk || 0) + (f.pfk || 0) + (f.atpase || 0);          // ATP を使う：HK・PFK-1・細胞の仕事
  return o;
}
function runSeries(s, seconds, every, mod) {
  const out = [snap(s)];
  for (let t = 1; t <= seconds; t++) { if (mod) mod(s, t); S.step(s, 1); if (t % every === 0) out.push(snap(s)); }
  return out;
}
const withData = (change, fn) => {                                      // データを一時的に変えて試す（必ず元に戻す）
  const keep = JSON.stringify(MB.REACTIONS.map(r => [r.vmaxBase, r.kinetics]));
  try { change(); return fn(); } finally { JSON.parse(keep).forEach(([v, k], i) => { MB.REACTIONS[i].vmaxBase = v; MB.REACTIONS[i].kinetics = k; }); }
};

const res = { series: {}, experiments: [] };
// 1) 時系列：実際のセーブから 6 時間（新しい細胞にした直後の細胞からも）
for (const name of ['mctAnalyzing50min', 'afterMct65min', 'newCellMctPaused70min']) {
  const s = load(name); if (name === 'newCellMctPaused70min') S.setSwitch(s, 'mctOff', false);
  res.series[name] = runSeries(s, 6 * 3600, 600);
}
// 2) 比較実験：afterMct65min を 1 時間進めた状態から、1か所だけ変えてさらに 2 時間
const start = (() => { const s = load('afterMct65min'); for (let t = 0; t < 3600; t++) S.step(s, 1); return s; })();
const EXPS = [
  ['基準（変更なし）', () => {}],
  ['ATP の消費（細胞の仕事）の Vmax ×2', () => { R('atpase').vmaxBase *= 2; }],
  ['ATP の消費の Vmax ×4', () => { R('atpase').vmaxBase *= 4; }],
  ['PK の Vmax ×2（F1,6BP による活性化の上限に相当）', () => { R('pk').vmaxBase *= 2; }],
  ['アルドラーゼの Vmax ×2', () => { R('aldo').vmaxBase *= 2; }],
  ['回収期 5 酵素の Vmax ×2', () => { for (const id of ['gapdh', 'pgk', 'pgam', 'eno', 'pk']) R(id).vmaxBase *= 2; }],
  ['PFK-1 の Vmax ×0.5', () => { R('pfk').vmaxBase *= 0.5; }],
  ['グルコースの取り込み（GLUT）×0.5', () => {}]                    // GLUT は研究の Lv で決まるので、下で Lv を半分にする
];
for (const [label, change] of EXPS) {
  const s = clone(start);
  if (label.startsWith('グルコースの取り込み')) s.levels.glut = Math.round(s.levels.glut / 2);
  const ser = withData(change, () => runSeries(s, 7200, 600));
  const a = ser[0], b = ser[ser.length - 1];
  res.experiments.push({ label, f16bp0: a.f16bp, f16bp: b.f16bp, dF16BP: b.dF16BP, atpFrac: b.atpFrac, J_pfk: b.J_pfk, J_aldo: b.J_aldo, J_pk: b.J_pk,
    cap_pfk: b.cap_pfk, atpMake: b.atpMake, atpUse: b.atpUse, cap_aldo: b.cap_aldo, use_aldo: b.J_aldo / b.cap_aldo, QK_aldo: b.QK_aldo, dhap: b.dhap, gap: b.gap, adp: b.adp, J_atpase: b.J_atpase, cap_atpase: b.cap_atpase });
}

if (process.argv.includes('--json')) { console.log(JSON.stringify(res)); process.exit(0); }
const f1 = x => x.toFixed(1), f2 = x => x.toFixed(2), f3 = x => x.toFixed(3);
for (const [name, ser] of Object.entries(res.series)) {
  console.log(`\n■ ${name}（${ser.length - 1} 点・10 分ごと）`);
  console.log('  時間  F16BP   DHAP   GAP  ATP/ADP  J_glut  J_pfk  J_aldo  dF16BP  aldo使用率  Q/K(aldo)  J_pk   ADP');
  for (const o of ser.filter((_, i) => i % 6 === 0 || i === ser.length - 1)) {
    console.log(`  ${(o.t / 60).toFixed(0).padStart(4)}分 ${f1(o.f16bp).padStart(7)} ${f1(o.dhap).padStart(6)} ${f2(o.gap).padStart(5)} ${f1(o.atp)}/${f2(o.adp)} ${f3(o.J_glut).padStart(6)} ${f3(o.J_pfk).padStart(6)} ${f3(o.J_aldo).padStart(7)} ${f3(o.dF16BP).padStart(7)} ${f3(o.J_aldo / o.cap_aldo).padStart(9)} ${f3(o.QK_aldo).padStart(10)} ${f3(o.J_pk).padStart(6)} ${f2(o.adp)}`);
  }
}
console.log('\n■ 比較実験（afterMct65min を 1 時間進めた状態から、1か所だけ変えて 2 時間）');
for (const e of res.experiments) console.log(`  ${e.label.padEnd(34)} F16BP ${f1(e.f16bp0)} → ${f1(e.f16bp).padStart(7)}（${e.dF16BP >= 0 ? '+' : ''}${f3(e.dF16BP)}/秒）  ATP割合 ${f3(e.atpFrac)}  J_pfk ${f3(e.J_pfk)}（能力 ${f3(e.cap_pfk)}）  J_aldo ${f3(e.J_aldo)}（能力の ${(100 * e.use_aldo).toFixed(0)}%）  Q/K ${f3(e.QK_aldo)}  J_pk ${f3(e.J_pk)}  ATP消費 ${f3(e.J_atpase)}/${f3(e.cap_atpase)}  ATP収支 ${f3(e.atpMake)}−${f3(e.atpUse)}`);
