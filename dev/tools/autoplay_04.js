/* METABOLISM 0.4 自動プレイの記録（調整・報告用。ゲームには含まれない）
 *   node tools/autoplay_04.js [分] [方針 wait|cheap] [出力 JSON]
 * tools/economy.js と同じ方針で遊び、MCT 獲得前後の乳酸（細胞内・細胞外）・速さ・NAD⁺ を毎秒記録する。 */
'use strict';
const fs = require('fs');
const { play } = require('./economy.js');
const MB = globalThis.MB, S = MB.Sim;
const minutes = +process.argv[2] || 90, policy = process.argv[3] || 'wait', out = process.argv[4];
const series = []; let accum = null;
const r = play(minutes, { identify: policy, onTick: (t, g) => {
  if (accum == null && g.milestones.lac_accum != null) accum = t;
  const a = g.amounts;
  series.push({ t, lac: a.lac, lacOut: a.lacOut, nadFrac: a.nad / (a.nad + a.nadh), ldh: g.flux.ldh || 0, mct: g.flux.mct || 0, clr: g.flux.lac_clear || 0,
    pk: g.flux.pk || 0, ldhQK: S.massActionRatio('ldh', g) / S.kGame('ldh'), exported: g.totals.extent.mct || 0 });
} });
const id = k => (r.idents.find(x => x[1] === k) || [null])[0];
const T = id('mct'), L = id('ldh');
const at = t => series.find(x => x.t === t) || series[series.length - 1];
const win = (a, b) => series.filter(x => x.t >= a && x.t < b);
const mean = (arr, k) => arr.reduce((s, x) => s + x[k], 0) / Math.max(1, arr.length);
const pre = win(T - 300, T), post = win(T + 900, T + 1200);
const res = {
  policy, minutes, ldhIdentified: L, lacAccumObserved: accum, lacexitResearched: (r.buys.find(b => b[1] === 'lacexit') || [null])[0], mctIdentified: T,
  mctHow: (r.idents.find(x => x[1] === 'mct') || [])[2] || null, balance: r.marks.lac_balance ?? null,
  lacAtMct: at(T).lac, lacAfter5min: at(T + 300).lac, lacAfter10min: at(T + 600).lac, lacAfter20min: at(T + 1200).lac,
  before5min: { lac: mean(pre, 'lac'), ldh: mean(pre, 'ldh'), pk: mean(pre, 'pk'), nadFrac: mean(pre, 'nadFrac'), ldhQK: mean(pre, 'ldhQK') },
  after15to20min: { lac: mean(post, 'lac'), lacOut: mean(post, 'lacOut'), ldh: mean(post, 'ldh'), mct: mean(post, 'mct'), clr: mean(post, 'clr'), pk: mean(post, 'pk'), nadFrac: mean(post, 'nadFrac'), ldhQK: mean(post, 'ldhQK') },
  refillsAfterLdh: r.buys.filter(b => b[1] === 'nadsalv' && b[0] >= L).length, cellsAfterLdh: r.cells.filter(c => c.end >= L).length,
  mctLevel: r.g.levels.tr_mct, exportedTotal: r.g.totals.extent.mct, clearedTotal: r.g.totals.extent.lac_clear,
  series
};
if (out) fs.writeFileSync(out, JSON.stringify(res));
const f = s => s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
console.log(`方針 ${policy}：LDH ${f(L)} → 乳酸の観察 ${f(accum)} → 乳酸の行き先 ${f(res.lacexitResearched)} → MCT ${f(T)}（${res.mctHow}）→ つり合い ${f(res.balance)}`);
console.log(`  細胞内の乳酸：MCT 時 ${res.lacAtMct.toFixed(0)} → 5分後 ${res.lacAfter5min.toFixed(0)} → 10分後 ${res.lacAfter10min.toFixed(0)} → 20分後 ${res.lacAfter20min.toFixed(0)}`);
const b = res.before5min, a = res.after15to20min;
console.log(`  直前5分：生成 ${b.ldh.toFixed(2)}/秒・PK ${b.pk.toFixed(2)}・NAD⁺ ${(b.nadFrac * 100).toFixed(1)}%・LDH Q/K ${b.ldhQK.toFixed(3)}`);
console.log(`  15〜20分後：生成 ${a.ldh.toFixed(2)}・排出 ${a.mct.toFixed(2)}・運び去り ${a.clr.toFixed(2)}/秒・細胞外 ${a.lacOut.toFixed(0)}・PK ${a.pk.toFixed(2)}・NAD⁺ ${(a.nadFrac * 100).toFixed(1)}%・LDH Q/K ${a.ldhQK.toFixed(3)}`);
console.log(`  LDH 後の補充 ${res.refillsAfterLdh} 回・細胞 ${res.cellsAfterLdh} 回／MCT Lv${res.mctLevel}`);
