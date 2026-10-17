/* METABOLISM 0.3 自動プレイの記録（調整・報告用の道具。ゲームには含まれない）
 *   node tools/autoplay_03.js [分] [方針 wait|cheap] [出力 JSON]
 * tools/economy.js と同じプレイヤーの方針で遊び、LDH 獲得前後の指標と、毎秒の物質量・速度を記録する。 */
'use strict';
const path = require('path'), fs = require('fs');
const { play } = require('./economy.js');
const MB = globalThis.MB, S = MB.Sim;
const minutes = +process.argv[2] || 80, policy = process.argv[3] || 'wait', out = process.argv[4];
const series = [];
let firstLow = null, firstStall = null;
const r = play(minutes, { identify: policy, onTick: (t, g) => {
  const a = g.amounts, fr = a.nad / (a.nad + a.nadh);
  if (firstLow == null && g.milestones.nad_low != null) firstLow = t;
  if (firstStall == null && fr < 0.15 && t > 5) firstStall = t;
  series.push({ t, nad: a.nad, nadh: a.nadh, pyr: a.pyr, lac: a.lac, atp: a.atp,
    gapdh: g.flux.gapdh || 0, pk: g.flux.pk || 0, ldh: g.flux.ldh || 0, hk: g.flux.hk || 0 });
} });
const T = (r.idents.find(x => x[1] === 'ldh') || [null])[0];
const refills = r.buys.filter(b => b[1] === 'nadsalv').map(b => b[0]);
const cells = r.cells.map(c => c.end);
const regenT = (r.buys.find(b => b[1] === 'nadregen') || [null])[0];
const gly10 = r.idents.filter(x => MB.MICRO_IDS.includes(x[1]));
const win = (a, b) => series.filter(x => x.t >= a && x.t < b);
const mean = (arr, k) => arr.length ? arr.reduce((s, x) => s + x[k], 0) / arr.length : null;
const pre = win(T - 600, T), post = win(T + 60, T + 660);
const res = {
  policy, minutes,
  before: {
    firstNadLow: firstLow, firstStallBelow15pct: firstStall, firstRefill: refills[0] ?? null,
    all10Identified: gly10.length === 10 ? gly10[9][0] : null,
    nadregenUnlocked: regenT, ldhIdentified: T, ldhHow: (r.idents.find(x => x[1] === 'ldh') || [])[2] || null,
    refills: refills.filter(t => t < T).length, cells: cells.filter(t => t < T).length,
    refillsPer10min: refills.filter(t => t < T).length / (T / 600), cellsPer10min: cells.filter(t => t < T).length / (T / 600)
  },
  after: {
    refills: refills.filter(t => t >= T).length, cells: cells.filter(t => t >= T).length,
    refillsPer10min: refills.filter(t => t >= T).length / ((minutes * 60 - T) / 600),
    cellsPer10min: cells.filter(t => t >= T).length / ((minutes * 60 - T) / 600),
    selfSustaining: r.marks.self_sustaining ?? null
  },
  window10min: {
    before: { nadFrac: mean(pre.map(x => ({ v: x.nad / (x.nad + x.nadh) })), 'v'), pk: mean(pre, 'pk'), gapdh: mean(pre, 'gapdh'), ldh: mean(pre, 'ldh'), lacRate: 0 },
    after: { nadFrac: mean(post.map(x => ({ v: x.nad / (x.nad + x.nadh) })), 'v'), pk: mean(post, 'pk'), gapdh: mean(post, 'gapdh'), ldh: mean(post, 'ldh'),
             lacRate: post.length > 1 ? (post[post.length - 1].lac - post[0].lac) / (post[post.length - 1].t - post[0].t) : null }
  },
  pyrProducedTotal: r.g.totals.pyrProduced,
  refillTimes: refills, cellTimes: cells, series
};
if (out) fs.writeFileSync(out, JSON.stringify(res));
const f = s => s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
console.log(`方針 ${policy}：最初の NAD⁺ 不足 ${f(firstLow)}／最初の補充 ${f(refills[0])}／10酵素 ${f(res.before.all10Identified)}／NAD⁺ の再生 ${f(regenT)}／LDH ${f(T)}`);
console.log(`  補充 前 ${res.before.refills}（${res.before.refillsPer10min.toFixed(2)}/10分）→ 後 ${res.after.refills}（${res.after.refillsPer10min.toFixed(2)}/10分）／細胞 前 ${res.before.cells} → 後 ${res.after.cells}／SELF-SUSTAINING ${f(res.after.selfSustaining)}`);
const w = res.window10min;
console.log(`  直前10分 平均：NAD⁺ ${(w.before.nadFrac * 100).toFixed(0)}%・PK ${w.before.pk.toFixed(2)}/秒・LDH ${w.before.ldh.toFixed(2)}`);
console.log(`  直後10分 平均：NAD⁺ ${(w.after.nadFrac * 100).toFixed(0)}%・PK ${w.after.pk.toFixed(2)}/秒・GAPDH ${w.after.gapdh.toFixed(2)}・LDH ${w.after.ldh.toFixed(2)}・乳酸 +${w.after.lacRate.toFixed(2)}/秒`);
