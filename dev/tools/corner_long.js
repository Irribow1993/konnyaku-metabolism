/* METABOLISM v0.2.0：極端な条件での長時間試験（公開前確認3。調整用の道具。ゲームには含まれない）
 *   node dev/tools/corner_long.js [時間 = 24]
 * 準備期・回収期 Lv25、全酵素 Lv15、GLUT Lv30、細胞の仕事 Lv0（PFK-1 の抑制が下限に近づく条件）を通常の刻み（0.1 秒）で計算し、
 * 2 時間ごとの G6P・F6P・F1,6BP・細胞内グルコースと、その間の増え方を出す。収束するかを、増え方が等比的に減っているかで見る。 */
'use strict';
const path = require('path');
for (const f of ['data.js', 'glossary.js', 'sim.js']) require(path.join(__dirname, '../../public/js', f));
const MB = globalThis.MB, S = MB.Sim;
const H = +process.argv[2] || 24;
const x = S.createState(); x.levels.micro = 1;
[...MB.MICRO_IDS, 'ldh'].forEach(i => { x.levels['enz_' + i] = 15; });
Object.assign(x.levels, { glut: 30, prep: 25, pay: 25, work: 0, nadregen: 1, lacexit: 1, tr_mct: 5 });
const C0 = S.carbon(x) + S.carbonOut(x), g0 = x.totals.glcSupplied;
let prev = null; const rows = [];
for (let h = 0; h <= H; h++) {
  const a = x.amounts, f = x.flux;
  if (h % 2 === 0) {
    const r = { h, glc: a.glc, g6p: a.g6p, f6p: a.f6p, f16bp: a.f16bp, atp: a.atp, glut: f.glut || 0, pfk: f.pfk || 0, A: f.atpase || 0, R: S.regulationFactors('pfk', x)[0].factor };
    r.dg6p = prev ? (r.g6p - prev.g6p) / 7200 : null;
    rows.push(r); prev = r;
    console.log(`${String(h).padStart(3)} 時間：Glc ${a.glc.toFixed(3)}・G6P ${a.g6p.toFixed(2)}・F6P ${a.f6p.toFixed(2)}・F1,6BP ${a.f16bp.toFixed(3)}・ATP ${a.atp.toFixed(2)}｜GLUT ${r.glut.toFixed(4)}・PFK-1 ${r.pfk.toFixed(4)}・ATP の消費/2 ${(r.A / 2).toFixed(4)}・PFK-1 の係数 ×${r.R.toFixed(4)}` + (r.dg6p != null ? `｜G6P の増え方 ${r.dg6p.toExponential(2)} /秒` : ''));
  }
  if (h < H) for (let i = 0; i < 3600; i++) S.step(x, 1);
}
const ok = Math.abs(S.carbon(x) + S.carbonOut(x) - (C0 + 6 * (x.totals.glcSupplied - g0))) < 1e-6 * (S.carbon(x) + 1);
const ratios = rows.slice(2).map((r, i) => r.dg6p / rows[i + 1].dg6p);
console.log(`G6P の増え方の比（2 時間ごと）：${ratios.map(v => v.toFixed(2)).join(' ')}`);
console.log(`炭素の収支 ${ok ? '一致' : '不一致'}・平衡の行き過ぎ ${x.diag.eqViolations}・解法の失敗 ${x.diag.newtonFail}`);
