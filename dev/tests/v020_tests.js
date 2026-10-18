/* METABOLISM v0.2.0 検証：PFK-1・PK の調節と GLUT の可逆輸送  node dev/tests/v020_tests.js [--quick]
 * GPT 審査（v0.2.0 の実装方針）で求められた4条件と、セーブの互換。
 *   V1  長時間の安定性：6 時間で F1,6BP・G6P・F6P・細胞内のグルコースが溜まり続けない（v0.1.2 で溜まっていたセーブを含む）
 *   V2  ATP の需要への応答：細胞の仕事を増やす・減らすと、解糖系の流れ（PFK-1）がそれに合わせて変わる
 *   V3  保存則・非負性・数値の安定性（GLUT の逆向きの輸送を含む）
 *   V4  ゲーム経済：MCT の獲得まで約50分（自動プレイ。tools/economy.js の方針）
 *   V5  セーブの互換：v1〜v6 を v7 に移行して読める。v0.1.2 は v7 のセーブを「新しい版」として断る
 *   V6  GLUT：式・平衡・最大輸送能力（研究の効果）と実際の流束の区別
 *   V7  調節：係数の範囲、平衡（K_game）を変えない、PK の活性化だけでは F1,6BP の蓄積は解消しない（分析資料の確認）
 * --quick を付けると V1 の 6 時間を 2 時間にする（開発中の確認用。審査の結果は 6 時間で出す） */
'use strict';
const path = require('path'), fs = require('fs'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..', 'public');
for (const f of ['data.js', 'glossary.js', 'sim.js', 'aggregate.js', 'savecode.js']) require(path.join(ROOT, 'js', f));
const MB = globalThis.MB, S = MB.Sim, SC = MB.SaveCode;
const QUICK = process.argv.includes('--quick');
const HOURS = QUICK ? 2 : 6;

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fail++; };
const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));
const f2 = x => x.toFixed(2), f3 = x => x.toFixed(3);
const R = id => MB.REACTIONS.find(r => r.id === id);
const run = (s, sec, h) => { for (let i = 0; i < sec; i++) S.step(s, 1, h ? { h } : undefined); return s; };
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v6_saves.json'), 'utf8'));
const load = name => S.deserialize(JSON.stringify(FX[name]));
const carbonOk = (s, C0, g0) => near(S.carbon(s) + S.carbonOut(s), C0 + 6 * (s.totals.glcSupplied - g0), 1e-9);
const budget = s => ({ C: S.carbon(s) + S.carbonOut(s), g: s.totals.glcSupplied });
const late = (lv) => {                                  // 後半の細胞（LDH・MCT あり）
  const x = S.createState(); x.levels.micro = 1; MB.MICRO_IDS.forEach(i => { x.levels['enz_' + i] = 6; });
  Object.assign(x.levels, { glut: 10, prep: 8, pay: 8, work: 7, nadregen: 1, enz_ldh: 5, lacexit: 1, tr_mct: 3 }, lv || {}); return x;
};
const SPEC = ['glc', 'g6p', 'f6p', 'f16bp', 'dhap', 'gap'];
const t0 = Date.now();

/* ---------- V1 長時間の安定性 ---------- */
console.log(`[V1] 長時間の安定性（${HOURS} 時間。最後の 1 時間の増え方と、途中の最大値）`);
{
  const cases = [
    ['afterMct65min（v0.1.2 で F1,6BP 1,742 が溜まっていたセーブ）', load('afterMct65min')],
    ['mctAnalyzing50min', load('mctAnalyzing50min')],
    ['後半の細胞（GLUT Lv10・準備期 Lv8・細胞の仕事 Lv7）', late()],
    ['最も厳しい条件（頭打ちに向かう遅い変化を許す）：準備期・回収期 Lv25、全酵素 Lv15、GLUT Lv30、細胞の仕事 Lv0', late({ glut: 30, prep: 25, pay: 25, work: 0, tr_mct: 5, ...Object.fromEntries([...MB.MICRO_IDS, 'ldh'].map(i => ['enz_' + i, 15])) })],
    ['細胞の仕事がいちばん強い：細胞の仕事 Lv25', late({ work: 25 })]
  ];
  for (const [name, s] of cases) {
    const b0 = budget(s), f0 = s.amounts.f16bp, max = {}; SPEC.forEach(k => { max[k] = 0; });
    let minAmt = Infinity, nan = 0, at1 = null, h1 = null;
    for (let t = 0; t < HOURS * 3600; t++) {
      S.step(s, 1);
      if (t % 30) continue;
      for (const v of Object.values(s.amounts)) { if (!isFinite(v)) nan++; minAmt = Math.min(minAmt, v); }
      SPEC.forEach(k => { max[k] = Math.max(max[k], s.amounts[k]); });
      if (t === 3600) h1 = Object.fromEntries(SPEC.map(k => [k, s.amounts[k]]));
      if (t === (HOURS - 1) * 3600) at1 = Object.fromEntries(SPEC.map(k => [k, s.amounts[k]]));
    }
    const slope = Object.fromEntries(SPEC.map(k => [k, (s.amounts[k] - at1[k]) / 3600]));
    // 最も厳しい条件では、PFK-1 の抑制が下限に近く、上流（G6P・F6P）が頭打ちに向かってゆっくり近づく。最初の 1 時間の 2% 未満に減速していればよい
    const corner = /最も厳しい/.test(name), first = Object.fromEntries(SPEC.map(k => [k, h1[k] / 3600]));
    const flat = SPEC.every(k => Math.abs(slope[k]) < 1e-4 || corner && Math.abs(slope[k]) < 0.02 * Math.abs(first[k]));
    const a = s.amounts, fl = s.flux;
    console.log(`    ${name}`);
    console.log(`      ${HOURS} 時間後：Glc ${f2(a.glc)}・G6P ${f2(a.g6p)}・F6P ${f2(a.f6p)}・F1,6BP ${f2(a.f16bp)}（はじめ ${f2(f0)}）・DHAP ${f2(a.dhap)}・ATP/ADP ${f2(a.atp)}/${f2(a.adp)}`);
    console.log(`      流束：GLUT ${f3(fl.glut)}・PFK-1 ${f3(fl.pfk)}・アルドラーゼ ${f3(fl.aldo)}（F1,6BP/秒）・PK ${f3(fl.pk)}（三炭糖/秒）・細胞の仕事 ${f3(fl.atpase)}・PFK-1 の係数 ×${S.regulationFactors('pfk', s)[0].factor.toFixed(3)}`);
    ok(flat, `最後の 1 時間の増え方がすべて ±0.0001 u/秒 未満${corner ? '（または最初の 1 時間の増え方の 2% 未満に減速）' : ''}（最大 ${Math.max(...SPEC.map(k => Math.abs(slope[k]))).toExponential(1)}）。途中の最大：Glc ${f2(max.glc)}・G6P ${f2(max.g6p)}・F6P ${f2(max.f6p)}・F1,6BP ${f2(max.f16bp)}`);
    ok(max.glc <= MB.GLUT.glcOut + 1e-6, `細胞内のグルコースは細胞外（${MB.GLUT.glcOut} u）を超えない（${f2(max.glc)}）`);
    ok(near(fl.pfk, fl.aldo, 1e-3) && near(fl.pk, 2 * fl.aldo, 1e-3) && near(fl.glut, fl.hk, corner ? 1e-2 : 1e-3), '定常：GLUT ＝ HK、PFK-1 ＝ アルドラーゼ（F1,6BP/秒）、PK ＝ 2 × アルドラーゼ（三炭糖/秒）');
    ok(nan === 0 && minAmt >= 0 && carbonOk(s, b0.C, b0.g) && s.diag.eqViolations === 0 && s.diag.newtonFail === 0 && !S.checkIntegrity(s).length,
      `NaN なし・負の物質量なし（最小 ${minAmt.toExponential(1)}）・炭素の収支・平衡の行き過ぎ 0・解法の失敗 0・セーブのつじつま`);
  }
  // MCT を一時停止した比較実験：乳酸が細胞内に溜まり続け（設計どおり）、NADH が増えて回収期が進みにくくなるため、三炭糖と F1,6BP もゆっくり増える。
  //  原因は ADP ではなく NAD⁺ の側（質量作用）。MCT を再開すると戻る
  {
    const p = load('newCellMctPaused70min'); run(p, 3600);
    const l0 = p.amounts.lac, q0 = p.amounts.f16bp, n0 = p.amounts.nad / (p.amounts.nad + p.amounts.nadh); run(p, 3600);
    const dl = (p.amounts.lac - l0) / 3600, dq = (p.amounts.f16bp - q0) / 3600, n1 = p.amounts.nad / (p.amounts.nad + p.amounts.nadh);
    console.log(`    MCT 一時停止中（newCellMctPaused70min）：1〜2 時間で 乳酸 ${f2(l0)} → ${f2(p.amounts.lac)}（＋${f3(dl)}/秒）・F1,6BP ${f2(q0)} → ${f2(p.amounts.f16bp)}（＋${f3(dq)}/秒）・NAD⁺ の割合 ${n0.toFixed(3)} → ${n1.toFixed(3)}・ATP/ADP ${f2(p.amounts.atp)}/${f2(p.amounts.adp)}`);
    ok(dl > 0 && n1 < n0 && dq < 0.1 * dl, 'MCT を止めている間は、乳酸が溜まり（設計どおり）NAD⁺ の割合が下がる。F1,6BP の増え方は乳酸の 1/10 未満で、ADP 不足（v0.1.2）ではなく NADH の増加による');
    const q1 = p.amounts.f16bp; S.setSwitch(p, 'mctOff', false); run(p, 3600);
    const q2 = p.amounts.f16bp; run(p, 600);
    ok(p.amounts.f16bp < 0.2 * q1 && Math.abs(p.amounts.f16bp - q2) / 600 < 1e-3, `MCT を再開すると、1 時間で F1,6BP は ${f2(q1)} → ${f2(q2)} に戻り、落ち着く`);
  }
  // 溜まっていた F1,6BP がどれくらいで減るか（v0.1.2 のセーブを v0.2.0 で読み込んだとき）
  const s = load('afterMct65min'); let t = 0;
  while (s.amounts.f16bp > 10 && t < 7200) { S.step(s, 1); t++; }
  ok(s.amounts.f16bp <= 10, `v0.1.2 で溜まった F1,6BP（1,742）は、読み込み後 ${Math.floor(t / 60)} 分で 10 u 未満に減る`);
}

/* ---------- V2 ATP の需要への応答 ---------- */
console.log('[V2] ATP の需要への応答（細胞の仕事の Lv を段階的に変える）');
{
  const s = late({ work: 2 }); run(s, 1800);
  const rows = [];
  for (const w of [2, 5, 8, 11, 8, 5, 2]) {
    s.levels.work = w;
    let t = 0, prev = Infinity;
    for (; t < 3600; t += 10) { run(s, 10); const d = Math.abs(s.flux.pfk - s.flux.atpase / 2); if (d < 1e-3 * s.flux.atpase && Math.abs(prev - s.flux.pfk) < 1e-5) break; prev = s.flux.pfk; }
    run(s, 300);
    rows.push({ w, A: s.flux.atpase, pfk: s.flux.pfk, pk: s.flux.pk, atp: s.amounts.atp / 100, R: S.regulationFactors('pfk', s)[0].factor, f16: s.amounts.f16bp, glc: s.amounts.glc, settle: t });
  }
  for (const r of rows) console.log(`    細胞の仕事 Lv${String(r.w).padStart(2)}：ATP の消費 ${f3(r.A)}・PFK-1 ${f3(r.pfk)}（＝消費の ${(r.pfk / r.A).toFixed(3)} 倍）・PK ${f3(r.pk)}・ATP の割合 ${r.atp.toFixed(3)}・PFK-1 の係数 ×${r.R.toFixed(3)}・F1,6BP ${f2(r.f16)}・Glc ${f2(r.glc)}・落ち着くまで ${r.settle} 秒`);
  ok(rows.every(r => near(r.pfk, r.A / 2, 2e-3) && near(r.pk, r.A, 2e-3)), 'どの Lv でも、PFK-1 の流れ ＝ ATP の消費 ÷ 2、PK ＝ ATP の消費（グルコース1分子で正味 ATP 2）');
  ok(rows.slice(0, 4).every((r, i, a) => i === 0 || r.pfk > a[i - 1].pfk) && rows.slice(3).every((r, i, a) => i === 0 || r.pfk < a[i - 1].pfk), '細胞の仕事を増やすと流れが増え、減らすと減る（上り・下りとも単調）');
  ok(rows.slice(0, 4).every((r, i, a) => i === 0 || r.R > a[i - 1].R), '需要が増えると PFK-1 の抑制が弱まる（係数が大きくなる）');
  ok(near(rows[0].pfk, rows[6].pfk, 1e-4) && near(rows[1].pfk, rows[5].pfk, 1e-4) && near(rows[2].pfk, rows[4].pfk, 1e-4), '同じ Lv に戻すと同じ流れに戻る（履歴に依存しない。相対差 0.01% 未満）');
  ok(rows.every(r => r.atp > 0.85 && r.f16 < 50 && r.settle < 3600), `ATP の割合は 0.85 以上を保ち、F1,6BP は 50 u 未満、1 時間以内に落ち着く（最大 ${Math.max(...rows.map(r => r.settle))} 秒）`);
  // 需要が取り込みの上限を超えると（GLUT Lv2・細胞の仕事 Lv6）、ATP が下がって PFK-1 の抑制が解け、GLUT の取り込みが流れを決める
  const u = late({ work: 6, glut: 2 }); run(u, 3600);
  const Jmax = S.vmax(u, R('glut')), Ru = S.regulationFactors('pfk', u)[0].factor;
  ok(u.flux.glut > 0.9 * Jmax && near(u.flux.pfk, u.flux.glut, 1e-3) && u.amounts.glc < 5 && Ru > 0.99 && u.amounts.atp > 1,
    `需要が取り込みの上限を超えると、ATP は ${f2(u.amounts.atp)} に下がり PFK-1 の抑制は解け（×${Ru.toFixed(3)}）、細胞内のグルコースは少なく（${f2(u.amounts.glc)}）、流れは GLUT の最大輸送能力 ${f2(Jmax)} 近く（${f3(u.flux.glut)}）で決まる`);
}

/* ---------- V3 保存則・非負性・数値の安定性 ---------- */
console.log('[V3] 保存則・非負性・数値の安定性');
{
  // GLUT の逆向き：細胞の中にグルコースを外より多く入れる
  const s = S.createState(); s.levels.glut = 5; S.addGlucose(s, 500);
  const b0 = budget(s); let minAmt = Infinity, back = 0;
  for (let t = 0; t < 1800; t++) { S.step(s, 1); if ((s.flux.glut || 0) < 0) back++; for (const v of Object.values(s.amounts)) minAmt = Math.min(minAmt, v); }
  ok(back > 0 && s.totals.glcReturned > 0, `細胞の中のグルコースが外（50）より多いと、GLUT は外へ運ぶ（外へ戻った累計 ${f2(s.totals.glcReturned)}）`);
  ok(carbonOk(s, b0.C, b0.g), `炭素：6 ×（入った ${f2(s.totals.glcSupplied)}）＝ 在庫 ${f2(S.carbon(s))} ＋ 系の外へ出た分 ${f2(S.carbonOut(s))}（外へ戻ったグルコース 6 × ${f2(s.totals.glcReturned)} を含む）`);
  ok(near(s.totals.glcSupplied - s.totals.glcReturned, 500 + s.totals.extent.glut, 1e-9), '入った累計 − 外へ戻った累計 ＝ 手で入れた分 ＋ GLUT の正味の進行量');
  const c = S.conservation(s);
  ok(near(c.adenylate, 100, 1e-9) && near(c.nicotinamide, 200, 1e-9) && minAmt >= 0 && s.diag.eqViolations === 0 && s.diag.newtonFail === 0,
    `ATP＋ADP ${c.adenylate.toFixed(9)}・NAD⁺＋NADH ${c.nicotinamide.toFixed(9)}・負の物質量なし・平衡の行き過ぎ 0（刻みの半分化 ${s.diag.halvings} 回）`);
  // v0.2.0 公開前確認2：glcSupplied と glcReturned が正味の輸送を二重に数えないこと。
  //  1 秒ごとに：GLUT の正味の進行量 e は、正なら glcSupplied だけ、負なら glcReturned だけに入る（両方には入らない）。
  //  向きが何度も入れ替わる条件（50 付近へのグルコースの投与を繰り返す）と、刻み 1 秒（不在時と同じ）でも確かめる
  for (const h of [undefined, 1.0]) {
    const z = late({ glut: 6, work: 3 }); let both = 0, miss = 0, flips = 0, lastSign = 0, cBad = 0;
    const zb = budget(z);
    for (let t = 0; t < 3600; t++) {
      let manual = 0;
      if (t % 120 === 0) { manual = 60; S.addGlucose(z, manual); }             // 外（50）より多くなるように入れる → しばらく外へ戻る
      const s0 = z.totals.glcSupplied, r0 = z.totals.glcReturned, e0 = z.totals.extent.glut || 0;
      S.step(z, 1, h ? { h } : undefined);
      const dS = z.totals.glcSupplied - s0, dR = z.totals.glcReturned - r0, e = (z.totals.extent.glut || 0) - e0;
      if (dS > 0 && dR > 0) both++;
      if (!near(dS - dR, e, 1e-12) || dS < 0 || dR < 0) miss++;
      const sg = Math.sign(e); if (sg && lastSign && sg !== lastSign) flips++; if (sg) lastSign = sg;
      if (!carbonOk(z, zb.C, zb.g)) cBad++;
    }
    const tot = z.totals;
    ok(both === 0 && miss === 0 && flips >= 20 && cBad === 0 && near(tot.glcSupplied - tot.glcReturned, 60 * 30 + tot.extent.glut, 1e-9),
      `刻み ${h || 0.1} 秒：GLUT の向きが ${flips} 回入れ替わる条件で、1 秒ごとの正味の進行量は glcSupplied か glcReturned の一方だけに入り（両方 ${both} 回・不一致 ${miss} 回）、` +
      `入った ${f2(tot.glcSupplied)} − 戻った ${f2(tot.glcReturned)} ＝ 手で入れた 1800 ＋ GLUT の正味 ${f2(tot.extent.glut)}。毎秒の炭素の収支も合う`);
  }
  // 不在時進行（刻み 1 秒）、細胞を何度も替える、補充
  const o = late(); o.rp = 1e6; const ob = budget(o); let bad = 0;
  for (let k = 0; k < 3; k++) {
    o.lastSaved = Date.now() - 3 * 3600e3; S.catchUp(o, Date.now());
    if (!carbonOk(o, ob.C, ob.g)) bad++;
    S.buy(o, 'nadsalv'); S.addGlucose(o, 200); run(o, 600);
  }
  ok(bad === 0 && carbonOk(o, ob.C, ob.g) && near(S.conservation(o).adenylate, S.expectedConservation(o).adenylate, 1e-9) && near(S.conservation(o).nicotinamide, S.expectedConservation(o).nicotinamide, 1e-9) && !S.checkIntegrity(o).length,
    '不在時進行（2 時間 × 3 回）・NAD⁺ 補充・手での投与を重ねても、炭素・ATP＋ADP・NAD⁺＋NADH の収支とセーブのつじつまが合う');
  // 刻みの大きさによる差
  const mk = () => { const x = late(); return x; };
  const p = run(mk(), 1200, 0.1), q = run(mk(), 1200, 1.0);
  const d = Math.abs(p.totals.pyrProduced - q.totals.pyrProduced) / p.totals.pyrProduced;
  ok(d < 0.02 && q.diag.eqViolations === 0, `刻み 1 秒（不在時）と 0.1 秒の差 ${(d * 100).toFixed(2)}%（20 分のピルビン酸 ${f2(p.totals.pyrProduced)} / ${f2(q.totals.pyrProduced)}）`);
  // 新しい細胞では細胞内のグルコースは 0 から（細胞外は一定のリザーバーなので細胞をまたいで残る量はない）
  const n = load('afterMct65min'); S.newCulture(n);
  ok(n.amounts.glc === 0 && n.amounts.f16bp === 0, '新しい細胞では、細胞内のグルコース・F1,6BP は 0 から始まる');
}

/* ---------- V4 ゲーム経済 ---------- */
console.log('[V4] ゲーム経済（自動プレイ 90 分。v0.1.2 の値は同じ方針での実測）');
{
  const { play } = require(path.join(__dirname, '..', 'tools', 'economy.js'));
  const f = s => s == null ? '—' : `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
  const OLD = { cheap: { all: 31 * 60 + 49, ldh: 39 * 60 + 1, mct: 49 * 60 + 13, bal: 57 * 60 + 34 } };
  for (const pol of ['cheap', 'wait']) {
    const r = play(90, { identify: pol });
    const id = k => (r.idents.find(x => x[1] === k) || [null])[0];
    const all = r.marks['goal' + MB.GOALS.findIndex(g => /すべて同定/.test(g.text))];
    const ev = [...r.buys.map(b => b[0]), ...r.idents.map(x => x[0])].sort((a, b) => a - b);
    let gap = 0; for (let i = 1; i < ev.length; i++) gap = Math.max(gap, ev[i] - ev[i - 1]);
    const o = OLD[pol];
    console.log(`    ${pol === 'cheap' ? '安ければ払う' : '待つだけ    '}：10酵素 ${f(all)}${o ? `（v0.1.2 ${f(o.all)}）` : ''} → LDH ${f(id('ldh'))}${o ? `（${f(o.ldh)}）` : ''} → MCT ${f(id('mct'))}${o ? `（${f(o.mct)}）` : ''} → つり合い ${f(r.marks.lac_balance)}${o ? `（${f(o.bal)}）` : ''}・最長の待ち ${f(gap)}・細胞 ${r.cells.length} 回`);
    ok(id('mct') != null && id('mct') >= 45 * 60 && id('mct') <= 60 * 60, `${pol}：MCT の同定は 45〜60 分（約50分）`);
    ok(r.marks.lac_balance != null && r.marks.lac_balance <= 75 * 60, `${pol}：LACTATE BALANCE（第1章 完）に 75 分以内に到達`);
    ok(gap <= 6 * 60, `${pol}：次の研究・同定までの最長の待ちが 6 分以内`);
  }
}

/* ---------- V5 セーブの互換 ---------- */
console.log('[V5] セーブの互換（v1〜v6 → v7）');
{
  let all = 0, okN = 0;
  for (let v = 1; v <= 6; v++) {
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `v${v}_saves.json`), 'utf8'));
    for (const [name, save] of Object.entries(fx)) {
      all++;
      const s = S.deserialize(typeof save === 'string' ? save : JSON.stringify(save));
      const before = JSON.stringify(s.amounts), b0 = budget(s);
      const good = s && s.saveVersion === 7 && s.totals.glcReturned === 0 && !S.checkIntegrity(s).length;
      run(s, 600);
      const code = SC.encode(s), r = SC.decode(code);
      if (good && carbonOk(s, b0.C, b0.g) && !S.checkIntegrity(s).length && r.ok && r.state.saveVersion === 7 && before) okN++;
      else ok(false, `v${v} ${name}`);
    }
  }
  ok(okN === all, `v1〜v6 の全 ${all} 件：v7 に移行して読める（glcReturned 0、つじつまの確認を通る）。600 秒計算しても炭素の収支が合い、書き出し → 読み込みもできる`);
  // v0.1.2 のコードは v7 のセーブを断る（古い版で新しい版のセーブを壊さない）
  const ctx = { console, Date, Math, JSON, Float64Array, Uint32Array, Uint8Array, Array, Object, TextEncoder, TextDecoder, btoa, atob }; ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of ['data.js', 'sim.js', 'savecode.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, 'baseline_0.1.2', f), 'utf8'), ctx);
  const old = ctx.MB.SaveCode.decode(SC.encode(late()));
  ok(!old.ok && /新しい版/.test(old.error), `v0.1.2 で v0.2.0 の書き出しを読み込むと断る（「${old.error}」）`);
  const oldCode = ctx.MB.SaveCode.encode(ctx.MB.Sim.createState()), nw = SC.decode(oldCode);
  ok(nw.ok && nw.state.saveVersion === 7, 'v0.1.2 で書き出した文字列は、v0.2.0 で読み込める');
}

/* ---------- V6 GLUT ---------- */
console.log('[V6] GLUT：式・平衡・最大輸送能力と実際の流束');
{
  const G = MB.GLUT, s = S.createState(); s.levels.glut = 5;
  const Jmax = S.vmax(s, R('glut'));
  ok(near(Jmax, 2.0, 1e-12), `研究で上がるのは最大輸送能力：Lv5 で ${Jmax}（Lv ごとに +0.4）`);
  const I = S._internal, rate = gi => { const x = I.toVec(s); x[I.IDX.glc] = gi; return I.rates(s, x, I.vmaxList(s))[S.COMPUTED_IDS.indexOf('glut')]; };
  const sym = gi => { const V = Jmax * (G.km + G.glcOut) / G.glcOut; return V * (G.glcOut - gi) / (G.km + G.glcOut + gi); };
  ok([0, 5, 20, 50, 80, 300].every(gi => near(rate(gi), sym(gi), 1e-12)), '速さは対称な輸送体の式 Vmax ×（G外 − G内）/（Km ＋ G外 ＋ G内）と一致（G内 0・5・20・50・80・300）');
  ok(near(rate(0), Jmax, 1e-12) && rate(50) === 0 && rate(80) < 0, `G内 0 で最大輸送能力 ${f3(rate(0))}、G内 ＝ G外 で 0、G内 ＞ G外 で外向き（G内 80 で ${f3(rate(80))}）`);
  ok(rate(20) < Jmax && rate(40) < rate(20), `実際の流束は細胞内のグルコースが増えると下がる（G内 20 で ${f3(rate(20))}、40 で ${f3(rate(40))}）`);
  // HK を止めると、細胞内のグルコースは外と同じ 50 に近づいて止まる（平衡）
  const keep = R('hk').vmaxBase; R('hk').vmaxBase = 0;
  try { const e = S.createState(); e.levels.glut = 3; run(e, 3600); ok(Math.abs(e.amounts.glc - G.glcOut) < 1e-3 && Math.abs(e.flux.glut) < 1e-4, `HK を止めると G内 は ${f3(e.amounts.glc)} で止まる（＝ G外 ${G.glcOut}）`); }
  finally { R('hk').vmaxBase = keep; }
  // 研究の表示：最大輸送能力と、いま入っている速さ（ui.js の文言）
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
  ok(/'最大輸送能力 '/.test(ui) && /いま入っている速さ/.test(ui) && /最大輸送能力/.test(MB.UPGRADE_TEXT.glut.line) && /最大輸送能力/.test(R('glut') && MB.UPGRADES.find(u => u.id === 'glut').desc), '研究タブ・詳細タブ・説明で「最大輸送能力」と「いま入っている速さ」を分けて書く');
}

/* ---------- V7 調節 ---------- */
console.log('[V7] 調節：係数の範囲、平衡を変えない、PK の活性化だけでは解消しない');
{
  const s = S.createState(); let okR = true;
  for (const atp of [0, 10, 50, 80, 95, 100]) for (const adp of [0, 1, 5, 20, 100 - atp]) {
    s.amounts.atp = atp; s.amounts.adp = adp; s.amounts.f16bp = atp * 3;
    const p = S.regulationFactors('pfk', s)[0].factor, k = S.regulationFactors('pk', s)[0].factor;
    if (!(p > 0 && p <= 1 && k >= 1 && k <= 2)) okR = false;
  }
  ok(okR, 'PFK-1 の係数は 0〜1（抑制）、PK の係数は 1〜2（活性化）');
  const at = (atp, adp) => { s.amounts.atp = atp; s.amounts.adp = adp; return S.regulationFactors('pfk', s)[0].factor; };
  console.log(`    PFK-1 の係数：ATP/ADP 80/20 ×${at(80, 20).toFixed(3)}・90/10 ×${at(90, 10).toFixed(3)}・95/5 ×${at(95, 5).toFixed(3)}・99/1 ×${at(99, 1).toFixed(3)}・100/0 ×${at(100, 0).toFixed(4)}`);
  ok(at(80, 20) > 0.9 && at(99, 1) < 0.1 && at(100, 0) < 0.005, '始めの細胞（ATP 80・ADP 20）ではほとんど抑えない。ATP がほぼ満タンのときは強く抑える（ADP 0 で 0.5% 未満）');
  ok(S.COMPUTED_IDS.every(id => { const r = R(id); return !r.regulation || r.regulation.every(g => g.real) && (id === 'pfk' || id === 'pk' || id === 'hk'); }), '調節があるのは HK・PFK-1・PK の3つだけで、すべて実在の調節');
  // 分析資料の確認：PK の活性化だけ（PFK-1 の調節なし・GLUT 定速）では、F1,6BP は溜まり続ける
  const L = require('./legacy_sim.js')();
  const LR = id => L.REACTIONS.find(r => r.id === id);
  LR('pk').regulation = R('pk').regulation;
  const x = L.Sim.deserialize(JSON.stringify(FX.afterMct65min)); for (let i = 0; i < 1800; i++) L.Sim.step(x, 1);
  const f0 = x.amounts.f16bp; for (let i = 0; i < 1800; i++) L.Sim.step(x, 1);
  const rate = (x.amounts.f16bp - f0) / 1800;
  ok(rate > 1, `PK の F1,6BP による活性化だけを入れても、F1,6BP は ＋${f3(rate)} F1,6BP/秒 で溜まり続ける（v0.1.2 の分析 ＋1.32 と同じ。PK は ADP 待ち）`);
}

console.log(`\n（計算 ${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
console.log(fail ? `${fail} 件失敗` : 'すべて成功');
process.exit(fail ? 1 : 0);
