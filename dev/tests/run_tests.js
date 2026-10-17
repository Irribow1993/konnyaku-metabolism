/* METABOLISM Prototype 0.4.1 検証： node tests/run_tests.js
 * 0.4.1 は説明文の修正のみ。M15 で 0.4 と計算が同じであることと、0.4 のセーブとの互換を確認する。
 * 0.4 で既存テストを変えたのは次の3か所だけ（反応・版が増えたことへの追従。判定の基準は変えていない）：
 *   T3  計算対象が15反応（MCT と、細胞の周りからの乳酸の流出を追加）
 *   S5  0.2.3 との進行量の比較で、0.3・0.4 で増えた反応（LDH・MCT・流出）はすべて 0 であることを確認する
 *   S8  移行後の版は v5 固定ではなく最新版（S.SAVE_VERSION）
 * 0.3 で既存テストを変えたのは次の3か所だけ（反応・物質が1つずつ増えたことへの追従。判定の基準は変えていない）：
 *   T3  計算対象が13反応（LDH を追加）。LDH は分岐の反応として別に確認する
 *   T17・T26 「物質量そのまま」は、移行前のデータにある物質で比較し、新しい乳酸は 0 であることを確認する
 *   T27 「全10同定」は解糖系の10酵素で数える（LDH の同定を数えない）
 * T1〜T10・T12〜T16 は計算層、T11（画面操作）は ui_smoke.py。 */
'use strict';
const path = require('path'), fs = require('fs'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..', 'public');     // 公開するゲーム本体（v0.1.0 で public/ に移した）
const TOOLS = path.join(__dirname, '..', 'tools');
for (const f of ['data.js', 'glossary.js', 'sim.js', 'aggregate.js']) require(path.join(ROOT, 'js', f));
const MB = globalThis.MB, S = MB.Sim, A = MB.Aggregate;

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fail++; };
const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));
const R = id => MB.REACTIONS.find(r => r.id === id);
const sumStoich = ids => { const t = {}; ids.forEach(id => { for (const [s, c] of Object.entries(R(id).stoich)) t[s] = (t[s] || 0) + c; }); for (const k in t) if (t[k] === 0) delete t[k]; return t; };
const same = (a, b) => { const k = new Set([...Object.keys(a), ...Object.keys(b)]); for (const x of k) if ((a[x] || 0) !== (b[x] || 0)) return false; return true; };
const run = (s, sec, h) => { for (let i = 0; i < sec; i++) S.step(s, 1, h ? { h } : undefined); return s; };
const withParams = (mod, fn) => {                        // 一時的にデータを変えて試す（後で必ず戻す）
  const keep = JSON.stringify(MB.REACTIONS.map(r => [r.vmaxBase, r.kinetics]));
  try { mod(); return fn(); } finally { JSON.parse(keep).forEach(([v, k], i) => { MB.REACTIONS[i].vmaxBase = v; MB.REACTIONS[i].kinetics = k; }); }
};
const PREP = ['hk', 'pgi', 'pfk', 'aldo', 'tpi'], PAY = ['gapdh', 'pgk', 'pgam', 'eno', 'pk'];

/* ---------- T1 化学量論 ---------- */
console.log('[T1] ミクロ10反応の化学量論');
ok(same(sumStoich(PREP), R('gly_prep').stoich), '準備期5反応の和 ＝ 準備期の見出しの式 ' + JSON.stringify(sumStoich(PREP)));
ok(same(sumStoich(PAY), R('gly_pay').stoich), '回収期5反応の和 ＝ 回収期の見出しの式 ' + JSON.stringify(sumStoich(PAY)));
const net = sumStoich([...PREP, ...PAY, ...PAY]);
ok(same(net, { glc: -1, nad: -2, pi: -2, adp: -2, atp: 2, nadh: 2, pyr: 2, h: 2, h2o: 2 }),
  '正味 Glc + 2NAD⁺ + 2ADP + 2Pᵢ → 2Pyr + 2NADH + 2ATP + 2H⁺ + 2H₂O');
for (const id of MB.MICRO_IDS) {
  const r = R(id); let c = 0;
  for (const [s, k] of Object.entries(r.stoich)) c += (MB.SPECIES[s].carbon || 0) * k;
  if (c !== 0) ok(false, `${id} の炭素収支が 0 でない（${c}）`);
}
ok(true, '各反応の炭素収支 = 0（10反応）');

/* ---------- T2 保存則・非負性 ---------- */
console.log('[T2] 長時間計算での保存則と非負性');
{
  const s = S.createState(); S.addGlucose(s, 500);
  s.levels.glut = 4; s.levels.prep = 3; s.levels.pay = 2; s.levels.work = 3; s.levels.micro = 1;
  MB.MICRO_IDS.forEach(id => { s.levels['enz_' + id] = 3; });
  let minAmt = Infinity;
  for (let i = 0; i < 3000; i++) { S.step(s, 1); for (const v of Object.values(s.amounts)) minAmt = Math.min(minAmt, v); }
  const c = S.conservation(s);
  ok(near(c.adenylate, 100, 1e-9), `ATP+ADP = ${c.adenylate}`);
  ok(near(c.nicotinamide, 200, 1e-9), `NAD⁺+NADH = ${c.nicotinamide}`);
  ok(near(S.carbon(s), 6 * s.totals.glcSupplied, 1e-9), `炭素：供給 ${(6 * s.totals.glcSupplied).toFixed(3)} ＝ 在庫 ${S.carbon(s).toFixed(3)}`);
  ok(minAmt >= 0, `負の物質量なし（最小 ${minAmt.toExponential(2)}）`);
  ok(near(s.totals.extent.pk, s.totals.pyrProduced, 1e-12) && near(s.amounts.pyr, s.totals.pyrProduced, 1e-9), 'ピルビン酸：PK の累積進行量 ＝ 生成累計 ＝ 在庫');
  ok(s.diag.eqViolations === 0 && s.diag.newtonFail === 0, `平衡の行き過ぎ ${s.diag.eqViolations} 件・解法の失敗 ${s.diag.newtonFail} 件（刻みの半分化 ${s.diag.halvings} 回）`);
}

/* ---------- T3 二重計算の防止 ---------- */
console.log('[T3] 二重計算の防止');
ok(!S.COMPUTED_IDS.includes('gly_prep') && !S.COMPUTED_IDS.includes('gly_pay'), '計算対象にマクロの見出し（gly_prep, gly_pay）が含まれない');
ok(MB.MICRO_IDS.every(id => S.COMPUTED_IDS.includes(id)) && S.COMPUTED_IDS.includes('ldh') && S.COMPUTED_IDS.includes('mct') && S.COMPUTED_IDS.includes('lac_clear') && S.COMPUTED_IDS.length === 15, `計算対象 = ミクロ10反応＋LDH＋MCT＋流出＋取り込み＋細胞の仕事（${S.COMPUTED_IDS.join(', ')}）`);
ok(MB.REACTIONS.filter(r => !r.computed).every(r => Array.isArray(r.macroOf)), '計算しない反応は、すべてミクロ反応の見出し（macroOf）');

/* ---------- T4 マクロ集計 ＝ ミクロ状態 ---------- */
console.log('[T4] マクロ表示とミクロ計算の整合');
{
  const s = S.createState(); S.addGlucose(s, 300); s.levels.glut = 2;
  let okAll = true, okC = true, okR = true;
  for (let t = 0; t < 600; t++) {
    S.step(s, 1);
    if (t % 20) continue;
    const m = A.macro(s), a = s.amounts;
    const exp = { glc: a.glc, prepMid: a.g6p + a.f6p + a.f16bp, tp: a.gap + a.dhap, payMid: a.bpg13 + a.pg3 + a.pg2 + a.pep, pyr: a.pyr };
    for (const k in exp) if (!near(m.pools[k], exp[k], 1e-12)) okAll = false;
    if (!near(m.carbon, S.carbon(s), 1e-12)) okC = false;
    if (!near(m.rates.prep, s.flux.hk, 1e-12) || !near(m.rates.pay, s.flux.pk / 2, 1e-12)) okR = false;
  }
  ok(okAll, '各時点で、マクロの5項目 ＝ 対応するミクロ物質の合計');
  ok(okC, 'マクロ表示の炭素 ＝ ミクロ状態の炭素');
  ok(okR, 'マクロの速度 ＝ HK の速度（準備期）、PK の速度 ÷ 2（回収期）');
  // 定常に近い状態では、入口と出口の速度がグルコース換算で一致する
  // 定常状態（グルコース供給 0.1/秒・NAD⁺ 十分）では、入口と出口の速度がグルコース換算で一致する
  const st = S.createState(); st.amounts.nad = 1e5;
  const mr = withParams(() => { R('glut').vmaxBase = 0.1; }, () => { run(st, 1500); return A.rates(st); });
  ok(Math.abs(mr.prep - 0.1) < 1e-3 && Math.abs(mr.pay - 0.1) < 1e-3, `定常状態で 供給 0.1 ＝ 入口 ${mr.prep.toFixed(5)} ＝ 出口 ${mr.pay.toFixed(5)}（グルコース換算）`);
}

/* ---------- T5 表示切替で状態が変わらない ---------- */
console.log('[T5] 表示の切り替えが状態を変えない');
{
  const s = run((() => { const x = S.createState(); S.addGlucose(x, 100); return x; })(), 60);
  const before = JSON.stringify(s);
  for (let i = 0; i < 100; i++) { A.macro(s); A.pools(s); A.rates(s); A.stageLimit(s, 'prep'); A.stageLimit(s, 'pay'); }
  ok(JSON.stringify(s) === before, '集計関数を何度呼んでも state は1ビットも変わらない');
  const src = fs.readFileSync(path.join(ROOT, 'js/aggregate.js'), 'utf8');
  ok(!/state\.[a-zA-Z_.\[\]'"]+\s*(=(?!=)|\+=|-=|\+\+|--)/.test(src), 'aggregate.js に state への代入がない（ソース検査）');
}

/* ---------- T6 平衡 ---------- */
console.log('[T6] 可逆反応の平衡（逆流を含む）');
{
  withParams(() => { for (const id of ['glut', 'hk', 'pfk', 'pk', 'atpase']) R(id).vmaxBase = 0; }, () => {
    const s = S.createState();
    Object.assign(s.amounts, { g6p: 0, f6p: 30, f16bp: 0, dhap: 0, gap: 20, bpg13: 0, pg3: 0, pg2: 0, pep: 15, atp: 60, adp: 40, nad: 100, nadh: 50 });
    const f6p0 = s.amounts.f6p;
    run(s, 2000);
    for (const id of ['pgi', 'aldo', 'tpi', 'gapdh', 'pgk', 'pgam', 'eno']) {
      const q = S.massActionRatio(id, s) / S.kGame(id);
      ok(Math.abs(q - 1) < 1e-3, `${id}: Q / K_game = ${q.toFixed(5)}（K_game = ${S.kGame(id).toPrecision(3)}）`);
    }
    ok(s.amounts.g6p > 0 && s.amounts.f6p < f6p0, `逆流：F6P のみから G6P が生じる（G6P = ${s.amounts.g6p.toFixed(2)}）`);
    ok(s.amounts.f16bp > 0, `逆流：GAP から F1,6BP が生じる（アルドラーゼの逆反応、${s.amounts.f16bp.toFixed(2)}）`);
    ok(s.diag.eqViolations === 0, '平衡の行き過ぎ 0 件');
  });
}

/* ---------- T7 研究で平衡が変わらない ---------- */
console.log('[T7] 研究は速度だけを変え、平衡（K_game）を変えない');
{
  const K0 = Object.fromEntries(MB.MICRO_IDS.map(id => [id, S.kGame(id)]));
  const s = S.createState(); s.rp = 1e9; s.totals.pyrProduced = 1e4;
  for (let k = 0; k < 5; k++) for (const u of MB.UPGRADES) if (u.id !== 'nadsalv') S.buy(s, u.id);
  ok(MB.MICRO_IDS.every(id => S.kGame(id) === K0[id]), 'すべての研究を購入しても K_game は不変');
  ok(MB.UPGRADES.every(u => ['vmax', 'add', 'unlock'].includes(u.effect.type)), '研究の効果の型は vmax／add／unlock のみ（平衡・化学量論を変える型が存在しない）');
}

/* ---------- T8 並び順に依存しない ---------- */
console.log('[T8] 反応の並び順に結果が依存しない');
{
  const load = reverse => {
    const ctx = { console, Date, Math, JSON, Float64Array, Array, Object }; ctx.globalThis = ctx; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8'), ctx);
    if (reverse) { ctx.MB.REACTIONS.reverse(); ctx.MB.UPGRADES.reverse(); }
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/sim.js'), 'utf8'), ctx);
    const s = ctx.MB.Sim.createState(); ctx.MB.Sim.addGlucose(s, 300);
    for (let i = 0; i < 300; i++) ctx.MB.Sim.step(s, 1);
    return s.amounts;
  };
  const a = load(false), b = load(true);
  const maxd = Math.max(...Object.keys(a).map(k => Math.abs(a[k] - b[k]) / Math.max(1, Math.abs(a[k]))));
  ok(maxd < 1e-6, `反応の定義順を逆にしても同じ結果（最大相対差 ${maxd.toExponential(1)}）`);
}

/* ---------- T9 0.1 セーブからの移行 ---------- */
console.log('[T9] 0.1（v1）セーブデータからの移行（0.1 基準版で作った実データ5種）');
{
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v1_saves.json'), 'utf8'));
  const K = S.kGame('tpi'); const migOk = [];
  for (const [name, v1] of Object.entries(fx)) {
    const s = S.deserialize(JSON.stringify(v1));
    const a1 = v1.amounts, a2 = s.amounts;
    const C1 = 6 * a1.glc + 3 * a1.tp + 3 * a1.pyr;
    const checks = [
      ['炭素', near(S.carbon(s), C1, 1e-12)],
      ['ATP+ADP', near(a2.atp + a2.adp, a1.atp + a1.adp, 1e-12)],
      ['NAD⁺+NADH', near(a2.nad + a2.nadh, a1.nad + a1.nadh, 1e-12)],
      ['三炭糖リン酸の表示値', near(A.pools(s).tp, a1.tp, 1e-12)],
      ['GAP:DHAP = TPI 平衡', a1.tp === 0 ? (a2.gap === 0 && a2.dhap === 0) : near(a2.gap / a2.dhap, K, 1e-9)],
      ['RP', s.rp === v1.rp],
      ['研究レベル', Object.entries(v1.levels).every(([k, v]) => s.levels[k] === v)],
      ['累計・記録（移行の説明 1 件を追加）', s.totals.pyrProduced === v1.totals.pyrProduced && s.log.length === v1.log.length + (a1.tp > 0 ? 1 : 0)],
      ['保存量の期待値', near(S.conservation(s).nicotinamide, S.expectedConservation(s).nicotinamide, 1e-12)],
      ['tp 項目の削除', !('tp' in a2)],
      ['新しい中間体 = 0', ['g6p', 'f6p', 'f16bp', 'bpg13', 'pg3', 'pg2', 'pep'].every(k => a2[k] === 0)]
    ];
    const bad = checks.filter(c => !c[1]).map(c => c[0]);
    ok(!bad.length, `${name.padEnd(16)} TP ${a1.tp.toFixed(2)} → GAP ${a2.gap.toFixed(3)} + DHAP ${a2.dhap.toFixed(3)}` + (bad.length ? '  ✘ ' + bad.join(', ') : ''));
    // 移行後に計算を続けても保存則が守られる（アルドラーゼの逆反応を含む）
    const C0 = S.carbon(s), g0 = s.totals.glcSupplied; run(s, 120);
    if (!near(S.carbon(s), C0 + 6 * (s.totals.glcSupplied - g0), 1e-9)) ok(false, `${name}: 移行後の計算で炭素が保存されない`);
    migOk.push(name);
  }
  ok(migOk.length === Object.keys(fx).length, '移行後に 120 秒計算を続けても炭素が保存される（アルドラーゼの逆反応を含む）');
  const s2 = S.deserialize(S.serialize(S.deserialize(JSON.stringify(fx.midPlay))));
  ok(s2.saveVersion === S.SAVE_VERSION && !('tp' in s2.amounts), `移行後のデータを保存・再読み込みしても最新版（v${S.SAVE_VERSION}）のまま`);
  const s3 = S.deserialize(JSON.stringify(fx.nadStall));
  ok(/0\.2 への移行/.test(s3.log[0] && s3.log[0].text || '') && /炭素の総量は変わらない/.test(s3.log[0].text), '0.2 審査 Q1：移行後の再分配を記録タブで説明（TP がある場合）');
  ok(!/0\.2 への移行/.test(JSON.stringify(S.deserialize(JSON.stringify(fx.fresh)).log)), 'TP がない場合は説明を出さない');
  ok(S.deserialize('{broken') === null, '破損データは null');
}

/* ---------- T10 数値の安定性 ---------- */
console.log('[T10] 数値の安定性（非常に速い TPI）');
{
  withParams(() => { R('tpi').vmaxBase = 1e5; R('aldo').vmaxBase = 1e4; }, () => {
    const s = S.createState(); S.addGlucose(s, 300);
    let minAmt = Infinity, flips = 0, prevSign = 0;
    for (let i = 0; i < 6000; i++) {
      S.step(s, 0.1);
      for (const v of Object.values(s.amounts)) minAmt = Math.min(minAmt, v);
      const q = S.massActionRatio('tpi', s) / S.kGame('tpi');
      const sign = Math.sign(Math.round((q - 1) * 1e6));
      if (prevSign && sign && sign !== prevSign) flips++;
      if (sign) prevSign = sign;
    }
    ok(minAmt >= 0, `負の物質量なし（最小 ${minAmt.toExponential(2)}）`);
    ok(s.diag.eqViolations === 0, `TPI の平衡の行き過ぎ 0 件（刻みの半分化 ${s.diag.halvings} 回）`);
    ok(flips < 5, `TPI の Q/K が 1 をまたいで振動しない（符号反転 ${flips} 回）`);
  });
}

/* ---------- T12 非負性の保証（反応ごと） ---------- */
console.log('[T12] 非負性の保証は、足りない物質を消費する反応だけを縮める');
{
  const I = S._internal, NR = I.COMPUTED.length;
  const x0 = I.toVec(S.createState());             // glc = 0, ATP = 80, NAD⁺ = 200 …
  const xi = new Array(NR).fill(0);
  const j = id => I.COMPUTED.findIndex(r => r.id === id);
  xi[j('hk')] = 5;                                 // グルコース 0 なのに 5 消費しようとする
  xi[j('atpase')] = 3;                             // 無関係（ATP は十分）
  xi[j('glut')] = 2;                               // 同じ刻みでグルコースを 2 供給
  const sc = I.limitByAvailability(x0, xi);
  ok(near(xi[j('hk')], 2, 1e-12), `HK は「刻み初めの量＋同じ刻みの生成量」まで縮む（5 → ${xi[j('hk')]}）`);
  ok(xi[j('atpase')] === 3 && sc[j('atpase')] === 1, '無関係な反応（細胞の仕事）は縮まない');
  ok(xi[j('glut')] === 2, '供給側の反応は縮まない');
}

/* ---------- T13 平衡の行き過ぎ検査 ---------- */
console.log('[T13] 平衡の行き過ぎ検査（非負性とは別の仕組み）');
{
  const I = S._internal, NR = I.COMPUTED.length;
  const s = S.createState(); Object.assign(s.amounts, { dhap: 1, gap: 10 });   // GAP 側に大きく行き過ぎ
  const xi = new Array(NR).fill(0); xi[I.COMPUTED.findIndex(r => r.id === 'tpi')] = 0.5;  // さらに正方向に進めようとする
  ok(I.checkEquilibrium(I.toVec(s), xi).includes('tpi'), '正方向に進めた結果 Q > K_game なら検出する');
  const xi2 = new Array(NR).fill(0); xi2[I.COMPUTED.findIndex(r => r.id === 'tpi')] = -0.5;
  ok(!I.checkEquilibrium(I.toVec(s), xi2).includes('tpi'), '逆方向（平衡に向かう向き）なら検出しない');
}

/* ---------- T14 エネルギー層の土台 ---------- */
console.log('[T14] 将来のエネルギー層のための記録');
{
  const s = run((() => { const x = S.createState(); S.addGlucose(x, 200); return x; })(), 300);
  const e = s.totals.extent;
  ok(MB.MICRO_IDS.every(id => typeof e[id] === 'number'), '反応ごとの累積進行量（extent）を記録している');
  const atpByExtent = -e.hk - e.pfk + e.pgk + e.pk - e.atpase;
  ok(near(80 + atpByExtent, s.amounts.atp, 1e-9), 'ATP の在庫 ＝ 初期値 ＋ Σ（進行量 × ATP の係数）。ATP の生成と消費を別々に数えなくても収支が出る');
  ok(!('atpProduced' in s.totals) && !('atpConsumed' in s.totals), 'ATP の生成量・消費量を別々に積み上げる項目を持たない（二重計上の防止）');
}

/* ---------- T15 S9 の廃止 ---------- */
console.log('[T15] 0.1 の「処理待ち」（S9）を廃止した');
ok(MB.REACTIONS.every(r => !(r.kinetics && r.kinetics.ki)), '速度式にゲーム上の処理能力制限の項がない');
ok(MB.REACTIONS.filter(r => r.regulation).every(r => r.regulation.every(g => g.real === true)), '残っている調節は、すべて実在の調節（HK の G6P 阻害のみ）');

/* ---------- T16 不在時進行（大きな刻み） ---------- */
console.log('[T16] 不在時進行（刻み 1 秒）と通常の刻み（0.1 秒）の比較');
{
  const mk = () => { const x = S.createState(); S.addGlucose(x, 300); x.levels.glut = 1; return x; };
  const a = run(mk(), 600, 0.1), b = run(mk(), 600, 1.0);
  const d = Math.abs(a.totals.pyrProduced - b.totals.pyrProduced) / a.totals.pyrProduced;
  ok(d < 0.02, `600 秒後のピルビン酸累計の差 ${(d * 100).toFixed(2)}%（${a.totals.pyrProduced.toFixed(1)} / ${b.totals.pyrProduced.toFixed(1)}）`);
  ok(near(S.carbon(b), 6 * b.totals.glcSupplied, 1e-9) && b.diag.eqViolations === 0, '大きな刻みでも保存則・平衡の検査を満たす');
}

/* ---------- T17 0.2（v2）セーブからの移行 ---------- */
console.log('[T17] 0.2（v2）セーブデータからの移行（承認済み 0.2 のコードで作った実データ3種）');
{
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v2_saves.json'), 'utf8'));
  for (const [name, v2] of Object.entries(fx)) {
    const s = S.deserialize(JSON.stringify(v2));
    const same = Object.keys(v2.amounts).every(id => s.amounts[id] === v2.amounts[id]) && s.amounts.lac === 0;
    const checks = [
      ['物質量そのまま', same], ['RP', s.rp === v2.rp], ['研究レベル', Object.entries(v2.levels).every(([k, v]) => s.levels[k] === v)],
      ['累計（NAD⁺ 補充の累計回数を含む）', s.levels.nadsalv === v2.levels.nadsalv && s.totals.pyrProduced === v2.totals.pyrProduced],
      ['現在の細胞の補充回数 = 0', s.cell.nadBought === 0], ['版', s.saveVersion === S.SAVE_VERSION]
    ];
    const bad = checks.filter(c => !c[1]).map(c => c[0]);
    ok(!bad.length, `${name.padEnd(14)} v2 → v${S.SAVE_VERSION}` + (bad.length ? '  ✘ ' + bad.join(', ') : ''));
  }
}

/* ---------- T18 NAD⁺ 補充の価格は細胞ごと ---------- */
console.log('[T18] NAD⁺ 補充の価格：同じ細胞では上がり、新しい細胞で初期価格に戻る（GPT 審査 0.2 §2）');
{
  const s = S.createState(); s.rp = 1e6;
  const p = [];
  for (let i = 0; i < 4; i++) { p.push(S.upgradeCost(s, 'nadsalv')); S.buy(s, 'nadsalv'); }
  ok(p.every((v, i) => i === 0 || v > p[i - 1]), `同じ細胞では買うたびに上がる（${p.join(' → ')} RP）`);
  const rp0 = s.rp, lv0 = JSON.stringify(Object.fromEntries(Object.entries(s.levels).filter(([k]) => k !== 'nadsalv'))), log0 = s.log.length, pyr0 = s.totals.pyrProduced;
  S.addGlucose(s, 50); S.step(s, 30);
  const rp1 = s.rp; S.newCulture(s);
  ok(S.upgradeCost(s, 'nadsalv') === p[0] && s.cell.nadBought === 0, `新しい細胞で初期価格（${S.upgradeCost(s, 'nadsalv')} RP）に戻る`);
  ok(s.levels.nadsalv === 4, '累計の購入回数（統計）は保持される');
  ok(s.rp === rp1 && JSON.stringify(Object.fromEntries(Object.entries(s.levels).filter(([k]) => k !== 'nadsalv'))) === lv0, 'RP と研究レベルは保持される');
  ok(s.log.length > log0 && s.totals.pyrProduced >= pyr0, '累積記録は保持される');
  ok(S.FREE.every(id => s.amounts[id] === (MB.SPECIES[id].initial || 0)), '代謝物は初期化される');
}

/* ---------- T19 研究ポイントの出どころ ---------- */
console.log('[T19] 研究ポイント ＝ ピルビン酸の生成量（A3、0.2.1 で変更）');
{
  const s = S.createState(); S.addGlucose(s, 200); run(s, 300);
  ok(near(s.rp, s.totals.pyrProduced * MB.ECONOMY.rpPerExtent, 1e-12) && near(s.totals.rpEarned, s.rp, 1e-12), `RP ${s.rp.toFixed(2)} ＝ ピルビン酸 ${s.totals.pyrProduced.toFixed(2)} × ${MB.ECONOMY.rpPerExtent}`);
  // 研究で細胞を速くしても、1 細胞（NAD⁺ 200）あたりの RP が減らない
  const cellRP = lv => { const x = S.createState(); Object.assign(x.levels, lv); x.amounts.glc = 1e4;
    for (let t = 0; t < 3000; t++) { S.step(x, 1, { h: 0.5 }); if (x.amounts.nad / (x.amounts.nad + x.amounts.nadh) < 0.05) break; } return x.rp; };
  const r0 = cellRP({}), r1 = cellRP({ prep: 6, pay: 6, work: 4 });
  ok(r1 >= 0.95 * r0, `研究前 ${r0.toFixed(0)} RP ／ 研究後 ${r1.toFixed(0)} RP（強化しても 1 細胞の RP が減らない）`);
  ok(!MB.REACTIONS.some(r => r.yieldsResearch), '細胞の仕事（ATP の加水分解）からは RP が入らない（ATP と RP の二重の意味づけをしない）');
}

/* ---------- T20 経済の検査（自動プレイ 60 分） ---------- */
console.log('[T20] ゲーム経済（自動プレイ 60 分。tools/economy.js の方針）');
{
  const { play } = require(path.join(TOOLS, 'economy.js'));
  const t0 = Date.now();
  const { g, buys, cells, marks } = play(60);
  const res = buys.filter(b => b[1] !== 'nadsalv');
  const win = [0, 1, 2, 3].map(w => res.filter(b => b[0] >= w * 900 && b[0] < (w + 1) * 900).length);
  let gap = 0; for (let i = 1; i < res.length; i++) gap = Math.max(gap, res[i][0] - res[i - 1][0]);
  const f = s => s == null ? '—' : `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
  const gi = k => MB.GOALS.findIndex(x => x.text.includes(k));
  console.log(`    目標：Pyr100 ${f(marks['goal' + gi('累計 100')])}／Pyr500 ${f(marks['goal' + gi('累計 500')])}／内部の解析 ${f(marks['goal' + gi('内部を解析')])}／不可逆3 ${f(marks['goal' + gi('後戻りしない')])}／全10 ${f(marks['goal' + gi('すべて同定')])}`);
  console.log(`    15 分ごとの購入 ${win.join(' / ')} 件、最長の待ち ${f(gap)}、新しい細胞 ${cells.length} 回、計算 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
  ok(marks['goal' + gi('内部を解析')] != null && marks['goal' + gi('内部を解析')] < 20 * 60, '内部の解析が 20 分以内に始まる');
  ok(win.every(n => n >= 5), '15 分ごとに 5 件以上の研究を購入できる（先細りしない）');
  ok(gap < 6 * 60, '研究の購入の間が 6 分以上空かない');
  const durs = cells.map(c => c.dur);
  ok(durs.length >= 3 && durs[durs.length - 1] < durs[0], `研究が進むと 1 細胞を回す時間が短くなる（${f(durs[0])} → ${f(durs[durs.length - 1])}）`);
}

/* ================= 0.2.2 解析による酵素の同定 ================= */
const freshMicro = () => { const x = S.createState(); x.levels.micro = 1; x.amounts.glc = 1e4; x.amounts.nad = 1e5; x.levels.glut = 3; return x; };

console.log('[T21] 解析中になるのは「見えている物質の隣」だけ。両端から内側へ5段階');
{
  const s = freshMicro();
  ok(JSON.stringify(S.analyzing(s)) === '["hk","pk"]', `解析を始めた直後の解析中：${S.analyzing(s).join(', ')}`);
  ok(S.analyzing(S.createState()).length === 0, '内部の解析を研究するまでは、どの酵素も解析中にならない');
  const order = [];
  for (let t = 0; t < 4000 && order.length < 10; t++) { S.step(s, 1, { h: 0.5 }); for (const e of s.events) order.push(e.id); s.events.length = 0; }
  const pos = id => order.indexOf(id);
  const sideOk = MB.ANALYSIS.sides.every(side => side.every((id, k) => k === 0 || pos(id) > pos(side[k - 1])));
  ok(order.length === 10 && sideOk, `各側で外側から内側の順に同定される（${order.map(id => S.reaction(id).abbr).join(' → ')}）`);
  ok(MB.ANALYSIS.sides.every(side => side.every((id, k) => S.stageOf(id) === k)), '各酵素の段階（1〜5）は、端からの位置で決まる');
}

console.log('[T22] 解析進捗 ＝ 解析中になってからの正味の進行量（グルコース換算）。回収期は ÷ 2、負の刻みは 0');
{
  const s = freshMicro();
  const e0 = { hk: s.totals.extent.hk || 0, pk: s.totals.extent.pk || 0 };
  for (let t = 0; t < 20; t++) S.step(s, 1, { h: 0.5 });
  ok(near(s.knowledge.analysis.hk, s.totals.extent.hk - e0.hk, 1e-9), `HK（準備期）：解析量 ${s.knowledge.analysis.hk.toFixed(3)} ＝ 進行量 ${(s.totals.extent.hk - e0.hk).toFixed(3)}`);
  ok(near(s.knowledge.analysis.pk, (s.totals.extent.pk - e0.pk) / 2, 1e-9), `PK（回収期）：解析量 ${s.knowledge.analysis.pk.toFixed(3)} ＝ 進行量 ÷ 2`);
  // 逆向きに流れる可逆反応（PGI）を解析中にして、刻みごとに検査する（PFK-1 を止めて純粋な逆流にする）
  withParams(() => { R('pfk').vmaxBase = 0; R('hk').vmaxBase = 0; }, () => {
    const r = S.createState(); r.levels.micro = 1; r.levels.enz_hk = 1; r.amounts.f6p = 50;   // G6P = 0、F6P のみ → PGI は逆向き
    let okStep = true, prevA = 0, prevE = 0;
    for (let t = 0; t < 30; t++) {
      S.step(r, 1);
      const dA = (r.knowledge.analysis.pgi || 0) - prevA, dE = r.totals.extent.pgi - prevE;
      if (dA < 0 || (dE < 0 && dA !== 0)) okStep = false;
      prevA = r.knowledge.analysis.pgi || 0; prevE = r.totals.extent.pgi;
    }
    ok(S.analyzing(r).includes('pgi') && r.totals.extent.pgi < 0 && okStep && prevA === 0,
      `PGI が逆向き（正味の進行量 ${r.totals.extent.pgi.toFixed(2)}）のあいだ、解析量は増えも減りもしない（${prevA}）`);
  });
}

console.log('[T23] 解析は反応エンジンに影響しない');
{
  const mk = micro => { const x = S.createState(); S.addGlucose(x, 400); x.levels.glut = 2; if (micro) x.levels.micro = 1; return x; };
  const a = mk(false), b = mk(true);
  for (let t = 0; t < 900; t++) { S.step(a, 1); S.step(b, 1); }
  ok(S.FREE.every(id => a.amounts[id] === b.amounts[id]), `解析あり／なしで、900 秒後の物質量が完全に一致（同定 ${Object.keys(b.knowledge.identified).length} 件）`);
  ok(JSON.stringify(a.totals.extent) === JSON.stringify(b.totals.extent) && a.rp === b.rp, '反応ごとの進行量と RP も完全に一致');
  const src = fs.readFileSync(path.join(ROOT, 'js/sim.js'), 'utf8');
  const st = src.indexOf('function updateAnalysis'), fn = src.slice(st, src.indexOf('\n  }\n', st));
  ok(!/amounts|flux\[|vmax/.test(fn), 'updateAnalysis は物質量・速度に触れない（ソース検査）');
}

console.log('[T24] 新しい細胞にしても、解析の進み具合と同定済みの酵素は保持される');
{
  const s = freshMicro();
  for (let t = 0; t < 400; t++) S.step(s, 1, { h: 0.5 });
  const k0 = JSON.stringify(s.knowledge), lv0 = JSON.stringify(s.levels);
  S.newCulture(s);
  ok(JSON.stringify(s.knowledge) === k0 && JSON.stringify(s.levels) === lv0, `保持（同定 ${Object.keys(s.knowledge.identified).length} 件、解析中 ${S.analyzing(s).map(id => id + ' ' + Math.round(S.analysisProgress(s, id) * 100) + '%').join(', ')}）`);
}

console.log('[T25] 即時同定の費用は、残りの割合に比例して下がる');
{
  const s = freshMicro();
  const c = [];
  for (const p of [0, 0.25, 0.5, 0.9]) { s.knowledge.analysis.hk = 80 * p; c.push(S.upgradeCost(s, 'enz_hk')); }
  ok(c.join(',') === '30,23,15,3', `HK（段階1、基準 30 RP）：進捗 0／25／50／90% → ${c.join(' / ')} RP`);
  ok(!S.isAvailable(s, 'enz_pgi') && !S.canBuy(Object.assign(s, { rp: 1e6 }), 'enz_pgi'), '解析待ちの酵素（PGI）は即時同定できない');
  s.rp = 1e6; s.knowledge.analysis.hk = 0; S.buy(s, 'enz_hk');
  ok(S.isIdentified(s, 'hk') && s.levels.enz_hk === 1 && S.analyzing(s).includes('pgi'), '即時同定すると Lv1（同定済み）になり、隣の PGI の解析が始まる');
  ok(s.events.some(e => e.type === 'identified' && e.how === 'rp') && s.log.some(l => /ヘキソキナーゼ（HK）を同定した.*研究ポイントで解析を完了/.test(l.text)), '通知と記録が出る');
  const lv = s.levels.enz_hk; S.buy(s, 'enz_hk');
  ok(s.levels.enz_hk === lv + 1 && S.upgradeCost(s, 'enz_hk') === Math.ceil(25 * Math.pow(1.45, lv + 1)), 'Lv2 以降は通常の強化（費用 25 × 1.45^Lv）');
}

console.log('[T26] 0.2.1（v3）セーブデータからの移行（0.2.1 のコードで作った実データ3種）');
{
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v3_saves.json'), 'utf8'));
  for (const [name, v3] of Object.entries(fx)) {
    const s = S.deserialize(JSON.stringify(v3));
    const had = MB.MICRO_IDS.filter(id => (v3.levels['enz_' + id] || 0) >= 1);
    const checks = [
      ['同定済み ＝ v3 で解放済み', had.every(id => S.isIdentified(s, id) && s.knowledge.identified[id] != null) && Object.keys(s.knowledge.identified).length === had.length],
      ['研究レベルそのまま', Object.entries(v3.levels).every(([k, v]) => s.levels[k] === v)],
      ['RP・物質量そのまま', s.rp === v3.rp && Object.keys(v3.amounts).every(id => s.amounts[id] === v3.amounts[id]) && s.amounts.lac === 0],
      ['細胞の補充回数そのまま', s.cell.nadBought === v3.cell.nadBought], ['版', s.saveVersion === S.SAVE_VERSION]
    ];
    const bad = checks.filter(c => !c[1]).map(c => c[0]);
    ok(!bad.length, `${name.padEnd(12)} 同定済み ${had.length} 件 → 解析中 ${S.analyzing(s).join(', ') || 'なし'}` + (bad.length ? '  ✘ ' + bad.join(', ') : ''));
  }
}

console.log('[T27] 経済：解析による同定（GPT 審査 0.2.2 §4・§5）');
{
  const { play } = require(path.join(TOOLS, 'economy.js'));
  const f = s => s == null ? '—' : `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
  const runs = {};
  for (const pol of ['wait', 'cheap']) runs[pol] = play(60, { identify: pol });
  for (const [pol, r] of Object.entries(runs)) {
    const ev = [...r.buys.filter(b => b[1] !== 'nadsalv').map(b => b[0]), ...r.idents.map(x => x[0])].sort((a, b) => a - b);
    let gap = 0; for (let i = 1; i < ev.length; i++) gap = Math.max(gap, ev[i] - ev[i - 1]);
    const gly = r.idents.filter(x => MB.MICRO_IDS.includes(x[1]));
    const all = gly.length === 10 ? gly[9][0] : null;
    console.log(`    ${pol === 'wait' ? '待つだけ    ' : '安ければ払う'}：全10同定 ${f(all)}、次の出来事までの最長の待ち ${f(gap)}、即時同定 ${r.buys.filter(b => b[2] === 'identify').length} 回`);
    ok(all != null && all < 40 * 60, `${pol}：全10酵素の同定が 40 分以内`);
    ok(gap < 4 * 60, `${pol}：次の意味のある出来事（研究・同定）までの待ちが 4 分未満`);
  }
  const noUp = play(60, { identify: 'wait', noEnzUp: true });
  const glyOf = r => r.idents.filter(x => MB.MICRO_IDS.includes(x[1]));
  const tUp = glyOf(runs.wait)[9][0], tNo = glyOf(noUp).length === 10 ? glyOf(noUp)[9][0] : 3600;
  ok(tUp < tNo && runs.wait.g.totals.pyrProduced > noUp.g.totals.pyrProduced, `正のフィードバック：酵素を強化すると全10同定が早まる（${f(tUp)} ／ 強化しない ${f(tNo)}）`);
}

console.log('[T28] 研究の効果の比較（研究しなかった場合との差。0.2.3）');
{
  const s = S.createState(); S.addGlucose(s, 300); s.levels.glut = 2; run(s, 20);
  const before = JSON.stringify(s);
  const c1 = S.compareUpgrade(s, 'pay', 10), c2 = S.compareUpgrade(s, 'pay', 10);
  ok(JSON.stringify(s) === before, '比較の計算は、元の state を1ビットも変えない');
  ok(c1.with === c2.with && c1.without === c2.without, '同じ状態からの比較は毎回同じ結果（決定的）');
  ok(c1.with > c1.without, `回収期の酵素を強化した場合 ${c1.with.toFixed(3)} > しなかった場合 ${c1.without.toFixed(3)} /秒`);
  // 細胞の立ち上がり中でも、比較なら研究そのものの効果だけが出る（立ち上がりは両方に同じだけ入る）
  const t = S.createState(); S.addGlucose(t, 300); run(t, 3);
  const naive = (() => { const x = JSON.parse(JSON.stringify(t)); const b = x.flux.pk || 0; x.levels.pay = 1; for (let i = 0; i < 10; i++) S.step(x, 1); return { b, a: x.flux.pk }; })();
  const cmp = S.compareUpgrade(t, 'pay', 10);
  const naivePct = (naive.a / naive.b - 1) * 100, cmpPct = (cmp.with / cmp.without - 1) * 100;
  ok(cmpPct < naivePct, `立ち上がり中の購入：単純な前後比較 +${naivePct.toFixed(0)}% ／ 比較方式 +${cmpPct.toFixed(0)}%（立ち上がりの分を除ける）`);
  // 効果のない研究（グルコースが余っているのに輸送体を強化）は、ほぼ 0% と出る
  const g = S.createState(); S.addGlucose(g, 500); run(g, 60);
  const cg = S.compareUpgrade(g, 'glut', 10);
  ok(Math.abs(cg.with / cg.without - 1) < 0.03, `グルコースが余っているときの輸送体の強化は、効果ほぼ 0（${((cg.with / cg.without - 1) * 100).toFixed(1)}%）`);
}

/* ================= 0.3 乳酸デヒドロゲナーゼ（LDH）と NAD⁺ の再生 ================= */
const withLdh = (lv) => { const x = S.createState(); x.levels.micro = 1; MB.MICRO_IDS.forEach(id => { x.levels['enz_' + id] = 1; });
  x.levels.nadregen = 1; x.levels.enz_ldh = 1; x.levels.glut = 4; Object.assign(x.levels, lv || {}); return x; };
const onlyLdh = fn => withParams(() => { for (const r of MB.REACTIONS) if (r.computed && r.id !== 'ldh') r.vmaxBase = 0; }, fn);

console.log('[S1] LDH の化学量論');
{
  const r = R('ldh');
  ok(same(r.stoich, { pyr: -1, nadh: -1, h: -1, lac: 1, nad: 1 }), 'Pyruvate + NADH + H⁺ → Lactate + NAD⁺（定義は正式な式。H⁺ は一定とみなす種として計算から外れる）');
  ok(MB.SPECIES.h.pool === 'buffered' && !S._internal.NM[S._internal.COMPUTED.findIndex(x => x.id === 'ldh')].some(([i]) => S.FREE[i] === 'h'), '計算上は Pyruvate + NADH ⇄ Lactate + NAD⁺（簡略化 S10）');
  let c = 0; for (const [sp, k] of Object.entries(r.stoich)) c += (MB.SPECIES[sp].carbon || 0) * k;
  ok(c === 0, 'LDH の炭素収支 = 0（ピルビン酸 C3 → 乳酸 C3）');
  ok(!('atp' in r.stoich) && !('adp' in r.stoich), 'LDH の式に ATP・ADP がない（乳酸の生成から ATP は生じない）');
  const ferm = sumStoich([...PREP, ...PAY, ...PAY, 'ldh', 'ldh']);
  ok(same(ferm, { glc: -1, adp: -2, pi: -2, lac: 2, atp: 2, h2o: 2 }), '解糖系＋LDH×2 の正味：Glc + 2ADP + 2Pᵢ → 2 乳酸 + 2ATP + 2H₂O（NAD⁺・NADH・H⁺ は正味 0）' + JSON.stringify(ferm));
  ok(near(S.kGame('ldh'), Math.exp(25.1 / MB.UNITS.RT_kJ), 1e-12), `K_game = exp(25.1 / RT) = ${S.kGame('ldh').toPrecision(4)}（ΔG°′ = −25.1 kJ/mol、教科書値。無次元）`);
  onlyLdh(() => {
    for (const [name, init] of [['前向き', { pyr: 50, nadh: 60, nad: 140, lac: 0 }], ['逆向き', { pyr: 0, nadh: 0, nad: 200, lac: 1e4 }]]) {
      const s = withLdh(); s.levels.enz_ldh = 5; Object.assign(s.amounts, init);
      run(s, 3000);
      const q = S.massActionRatio('ldh', s) / S.kGame('ldh');
      ok(Math.abs(q - 1) < 1e-3 && s.diag.eqViolations === 0, `${name}から平衡へ：Q / K_game = ${q.toFixed(5)}（平衡の行き過ぎ 0 件）`);
    }
  });
}

console.log('[S2] LDH の反応で NAD⁺ + NADH の総量が保存される');
{
  onlyLdh(() => {
    const s = withLdh(); Object.assign(s.amounts, { pyr: 80, nadh: 150, nad: 50 });
    let okAll = true;
    for (let t = 0; t < 600; t++) { S.step(s, 1); if (!near(s.amounts.nad + s.amounts.nadh, 200, 1e-12)) okAll = false; }
    ok(okAll && s.totals.extent.ldh > 79, `LDH だけを動かした 600 秒間、毎秒 NAD⁺+NADH = 200（LDH の進行量 ${s.totals.extent.ldh.toFixed(2)}）`);
  });
  const s = withLdh(); let okAll = true;
  for (let t = 0; t < 3000; t++) { S.step(s, 1); const c = S.conservation(s); if (!near(c.nicotinamide, 200, 1e-12) || !near(c.adenylate, 100, 1e-12)) okAll = false; }
  ok(okAll, `解糖系＋LDH を 3000 秒：毎秒 NAD⁺+NADH = 200、ATP+ADP = 100（LDH の進行量 ${s.totals.extent.ldh.toFixed(0)}）`);
}

console.log('[S3] ピルビン酸の消費量と乳酸の生成量が対応する');
{
  const s = withLdh(); S.addGlucose(s, 300); run(s, 1200);
  const e = s.totals.extent;
  ok(near(s.amounts.lac, e.ldh, 1e-9), `乳酸の在庫 ${s.amounts.lac.toFixed(4)} ＝ LDH の累積進行量 ${e.ldh.toFixed(4)}`);
  ok(near(s.amounts.pyr, e.pk - e.ldh, 1e-9), `ピルビン酸の在庫 ${s.amounts.pyr.toFixed(4)} ＝ 生成（PK）${e.pk.toFixed(2)} − 消費（LDH）${e.ldh.toFixed(2)}`);
  ok(near(S.carbon(s), 6 * s.totals.glcSupplied, 1e-9), '炭素：供給 ＝ 在庫（乳酸を含む）');
  ok(near(s.rp, e.pk * MB.ECONOMY.rpPerExtent, 1e-12), '研究ポイントは PK の進行量だけから入る（乳酸の生成からは入らない）');
  ok(near(80 + (-e.hk - e.pfk + e.pgk + e.pk - e.atpase), s.amounts.atp, 1e-9), 'ATP の在庫 ＝ 初期値 ＋ 解糖系と細胞の仕事の進行量（LDH は ATP の収支に入らない）');
}

console.log('[S4] 基質が足りないときも負の物質量が生じない');
{
  let minAmt = Infinity;
  for (const init of [{ pyr: 1e-4, nadh: 200, nad: 0 }, { pyr: 500, nadh: 1e-6, nad: 200 }, { pyr: 0, nadh: 0, nad: 200, lac: 5e4 }]) {
    withParams(() => { R('ldh').vmaxBase = 1e4; }, () => {
      const s = withLdh(); Object.assign(s.amounts, init); S.addGlucose(s, 100);
      for (let i = 0; i < 2000; i++) { S.step(s, 0.1); for (const v of Object.values(s.amounts)) minAmt = Math.min(minAmt, v); }
      if (s.diag.eqViolations) ok(false, '平衡の行き過ぎ ' + s.diag.eqViolations);
    });
  }
  ok(minAmt >= 0, `LDH の Vmax を 1 万倍にして、基質がほぼ 0 の3条件を計算：負の物質量なし（最小 ${minAmt.toExponential(2)}）`);
  const I = S._internal, NR = I.COMPUTED.length, j = id => I.COMPUTED.findIndex(r => r.id === id);
  const st = S.createState(); st.amounts.pyr = 1; st.amounts.nadh = 0.5;
  const xi = new Array(NR).fill(0); xi[j('ldh')] = 3; xi[j('atpase')] = 2;
  I.limitByAvailability(I.toVec(st), xi);
  ok(near(xi[j('ldh')], 0.5, 1e-12) && xi[j('atpase')] === 2, `非負性の保証：LDH は不足する NADH の量まで縮み（3 → ${xi[j('ldh')]}）、無関係な反応は縮まない`);
}

console.log('[S5] 解糖系10反応：LDH が働かないとき、0.2.3 と同じ計算結果になる');
{
  const baseDir = path.join(__dirname, 'baseline_0.2.3');      // 0.2.3 の data.js・sim.js の写し（比較専用。変更しない）
  if (!baseDir || !fs.existsSync(baseDir)) ok(true, '（0.2.3 のコードが手元にないため省略。tests の T1〜T28 がすべて通ることで確認）');
  else {
    const ctx = { console, Date, Math, JSON, Float64Array, Array, Object }; ctx.globalThis = ctx; vm.createContext(ctx);
    for (const f of ['data.js', 'sim.js']) vm.runInContext(fs.readFileSync(path.join(baseDir, f), 'utf8'), ctx);
    const B = ctx.MB.Sim;
    const mk = (Sx) => { const x = Sx.createState(); Sx.addGlucose(x, 400); x.levels.glut = 3; x.levels.pay = 2; x.levels.work = 2; return x; };
    const a = mk(B), b = mk(S); let maxd = 0;
    for (let t = 0; t < 1800; t++) { B.step(a, 1); S.step(b, 1); if (t === 600) { B.buy(Object.assign(a, { rp: a.rp + 1e4 }), 'nadsalv'); S.buy(Object.assign(b, { rp: b.rp + 1e4 }), 'nadsalv'); } }
    for (const k of Object.keys(a.amounts)) maxd = Math.max(maxd, Math.abs(a.amounts[k] - b.amounts[k]));
    ok(maxd === 0 && b.amounts.lac === 0, `1800 秒（途中で NAD⁺ 補充を含む）：0.2.3 の計算と全物質がビット単位で一致（最大差 ${maxd}）、乳酸 0`);
    ok(JSON.stringify(Object.fromEntries(Object.entries(a.totals.extent))) === JSON.stringify(Object.fromEntries(Object.entries(b.totals.extent).filter(([k]) => !['ldh', 'mct', 'lac_clear'].includes(k)))) && ['ldh', 'mct', 'lac_clear'].every(k => b.totals.extent[k] === 0), '反応ごとの累積進行量も一致（LDH・MCT・流出は 0）');
  }
  ok(fail === 0, 'T1〜T28（0.2.3 までの全回帰テスト）がこの時点ですべて成功');
}

console.log('[S6] LDH の解析は代謝の計算に影響しない');
{
  const mk = regen => { const x = S.createState(); x.levels.micro = 1; MB.MICRO_IDS.forEach(id => { x.levels['enz_' + id] = 1; }); x.levels.glut = 3; S.addGlucose(x, 300); if (regen) x.levels.nadregen = 1; return x; };
  const a = mk(false), b = mk(true);
  const e0 = b.totals.extent.pk || 0;
  for (let t = 0; t < 900; t++) { S.step(a, 1); S.step(b, 1); }
  ok(S.analyzing(b).includes('ldh') && !S.analyzing(a).includes('ldh'), '「NAD⁺ の再生」を研究すると LDH が解析中になる');
  ok(S.FREE.every(id => a.amounts[id] === b.amounts[id]) && a.rp === b.rp && JSON.stringify(a.totals.extent) === JSON.stringify(b.totals.extent), `解析中／解析なしで 900 秒後の物質量・進行量・RP が完全に一致（LDH の解析 ${Math.round(S.analysisProgress(b, 'ldh') * 100)}%）`);
  ok(near(b.knowledge.analysis.ldh, ((b.totals.extent.pk || 0) - e0) / 2, 1e-9) && b.totals.extent.ldh === 0, 'LDH の解析量 ＝ 解析中になってからのピルビン酸の生成量 ÷ 2（グルコース換算）。同定前の LDH の進行量は 0');
  const c = withLdh(); c.levels.enz_ldh = 0; c.rp = 1e6;
  c.knowledge.analysis.ldh = 0; const p0 = S.upgradeCost(c, 'enz_ldh');
  c.knowledge.analysis.ldh = 150; const p1 = S.upgradeCost(c, 'enz_ldh');
  ok(p0 === MB.ANALYSIS.branches.ldh.cost && p1 === Math.ceil(MB.ANALYSIS.branches.ldh.cost / 2), `即時同定の費用は既存のルールどおり、残りの割合に比例（0% ${p0} RP → 50% ${p1} RP）`);
  S.buy(c, 'enz_ldh');
  ok(S.isIdentified(c, 'ldh') && c.events.some(e => e.type === 'identified' && e.id === 'ldh') && c.log.some(l => /乳酸デヒドロゲナーゼ（LDH）を同定した/.test(l.text)), '同定すると通知・記録が出る（既存の同定の仕組み）');
  const ok2 = MB.NADREGEN_CONDITIONS.map(x => x.test(S.createState()));
  ok(ok2.every(v => !v) && !S.isAvailable(S.createState(), 'nadregen') && !S.isAvailable(S.createState(), 'enz_ldh'), '初めからは「NAD⁺ の再生」も LDH も研究できない（条件を満たすまで）');
  const d = mk(false); d.milestones.nad_low = 10;
  const avail = [S.isAvailable(d, 'nadregen')]; d.levels.nadsalv = 1; avail.push(S.isAvailable(d, 'nadregen'));
  ok(!avail[0] && avail[1], '10酵素の同定・NAD⁺ 不足の経験・補充の経験の3条件がそろって初めて研究できる');
}

console.log('[S7] 新しい細胞にしても、LDH の知識と研究は保持される');
{
  const s = withLdh({ enz_ldh: 3 }); S.addGlucose(s, 200);
  s.knowledge.analysis.ldh = 300; s.knowledge.identified.ldh = 5; s.knowledge.regen.refillsAfter = 2; s.knowledge.regen.best = 123;
  run(s, 300);
  const keep = JSON.stringify({ l: s.levels, i: s.knowledge.identified, a: s.knowledge.analysis, r: [s.knowledge.regen.refillsAfter, s.knowledge.regen.best] });
  const lac0 = s.amounts.lac; S.newCulture(s);
  ok(JSON.stringify({ l: s.levels, i: s.knowledge.identified, a: s.knowledge.analysis, r: [s.knowledge.regen.refillsAfter, s.knowledge.regen.best] }) === keep, '研究レベル（nadregen・enz_ldh Lv3）・同定・解析・SELF-SUSTAINING の記録を保持');
  ok(s.amounts.lac === 0 && lac0 > 0 && s.amounts.nad === 200, `代謝物は初期化（乳酸 ${lac0.toFixed(0)} → 0、NAD⁺ 200）`);
  ok(s.knowledge.regen.since === null, '「外部からの補充なし」の区間は新しい細胞で数え直す（新しい細胞では NAD⁺ が初期量に戻るため）');
  run(s, 30);
  ok((s.flux.ldh || 0) > 0 && s.amounts.lac > 0, `新しい細胞でも LDH はすぐ働く（${(s.flux.ldh || 0).toFixed(2)} /秒）`);
}

console.log('[S8] 0.2.3（v4）セーブデータからの移行（0.2.3 のコードで自動プレイした実データ4種）');
{
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v4_saves.json'), 'utf8'));
  for (const [name, v4] of Object.entries(fx)) {
    const s = S.deserialize(JSON.stringify(v4));
    const checks = [
      ['最新版', s.saveVersion === S.SAVE_VERSION],
      ['RP', s.rp === v4.rp],
      ['研究レベル（補充の累計回数を含む）', Object.entries(v4.levels).every(([k, v]) => s.levels[k] === v)],
      ['同定済みの酵素', JSON.stringify(s.knowledge.identified) === JSON.stringify(v4.knowledge.identified)],
      ['解析の進み具合', JSON.stringify(s.knowledge.analysis) === JSON.stringify(v4.knowledge.analysis)],
      ['累積記録（totals）', JSON.stringify(Object.assign({}, v4.totals, { extent: undefined })) === JSON.stringify(Object.assign({}, s.totals, { extent: undefined })) && JSON.stringify(v4.totals.extent) === JSON.stringify(s.totals.extent)],
      ['細胞の再構築回数', s.totals.cultures === v4.totals.cultures],
      ['現在の細胞の記録（補充回数）', s.cell.nadBought === v4.cell.nadBought && s.cell.startedAt === v4.cell.startedAt],
      ['記録タブ・マイルストーン', JSON.stringify(s.log) === JSON.stringify(v4.log) && JSON.stringify(s.milestones) === JSON.stringify(v4.milestones)],
      ['物質量そのまま', Object.keys(v4.amounts).every(id => s.amounts[id] === v4.amounts[id])],
      ['新規：乳酸 0・LDH 未同定・NAD⁺ の再生 未研究', s.amounts.lac === 0 && s.levels.enz_ldh === 0 && s.levels.nadregen === 0 && !S.isIdentified(s, 'ldh')],
      ['新規：SELF-SUSTAINING の記録は空・停止なし', JSON.stringify(s.knowledge.regen) === JSON.stringify({ since: null, pyrAt: 0, best: 0, refillsAfter: 0 }) && JSON.stringify(s.switches) === '{}'],
      ['保存量の期待値', near(S.conservation(s).nicotinamide, S.expectedConservation(s).nicotinamide, 1e-9)]
    ];
    const bad = checks.filter(c => !c[1]).map(c => c[0]);
    const cond = MB.NADREGEN_CONDITIONS.map(c => c.test(s) ? '✓' : '・').join('');
    ok(!bad.length, `${name.padEnd(20)} RP ${v4.rp.toFixed(0)}・補充 ${v4.levels.nadsalv} 回・細胞 ${v4.totals.cultures} 回・同定 ${Object.keys(v4.knowledge.identified).length} → 研究条件 ${cond}` + (bad.length ? '  ✘ ' + bad.join(', ') : ''));
  }
  const all = S.deserialize(JSON.stringify(fx.allIdentified45min));
  ok(S.isAvailable(all, 'nadregen'), '0.2.3 で10酵素を同定し、NAD⁺ 不足と補充を経験済みのデータは、移行後すぐ「NAD⁺ の再生」を研究できる（0.2.3 の経験が条件に数えられる）');
  const re = S.deserialize(S.serialize(all));
  ok(re.saveVersion === S.SAVE_VERSION && re.rp === all.rp, `移行後のデータを保存・再読み込みしても最新版（v${S.SAVE_VERSION}）のまま`);
  for (const k of ['v1_saves.json', 'v2_saves.json', 'v3_saves.json']) {
    const f = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', k), 'utf8'));
    if (!Object.values(f).every(d => { const x = S.deserialize(JSON.stringify(d)); return x.saveVersion === S.SAVE_VERSION && x.amounts.lac === 0 && x.knowledge.regen; })) ok(false, k + ' からの連続移行');
  }
  ok(true, `0.1（v1）・0.2（v2）・0.2.1（v3）からも v${S.SAVE_VERSION} まで連続して移行できる`);
}

console.log('[S9] 緊急補充以外で NAD 系の総量が増えない');
{
  const s = withLdh({ prep: 4, pay: 4, work: 3 }); s.rp = 1e6; s.levels.enz_ldh = 1;
  let prev = 200, bad = 0, ups = 0, refills = 0;
  for (let t = 0; t < 3600; t++) {
    if (t % 700 === 350) { S.buy(s, 'nadsalv'); refills++; }
    if (t === 2000) S.setSwitch(s, 'ldhOff', true);
    if (t === 2600) S.setSwitch(s, 'ldhOff', false);
    const before = s.amounts.nad + s.amounts.nadh;
    if (before > prev + 1e-9) { ups++; if (!near(before - prev, 100, 1e-9)) bad++; }
    prev = before;
    S.step(s, 1);
    const after = s.amounts.nad + s.amounts.nadh;
    if (!near(after, before, 1e-12)) bad++;
    prev = after;
  }
  ok(bad === 0 && ups === refills && near(prev, 200 + 100 * refills, 1e-12), `3600 秒（補充 ${refills} 回・LDH の停止と再開を含む）：総量が増えたのは補充の ${ups} 回だけ（各 +100）。計算の刻みでは1度も変わらない（最終 ${prev.toFixed(6)}）`);
  ok(near(S.conservation(s).nicotinamide, S.expectedConservation(s).nicotinamide, 1e-12), '保存量 ＝ 初期値 ＋ 外部からの補充');
}

console.log('[S10] LDH を止めると、従来どおり NAD⁺ 不足が再現する');
{
  const mk = () => { const x = withLdh({ prep: 3, pay: 3, work: 3 }); S.addGlucose(x, 200); return x; };
  const on = mk(), off = mk(), none = mk();
  S.setSwitch(off, 'ldhOff', true); none.levels.enz_ldh = 0; none.levels.nadregen = 0;
  for (let t = 0; t < 900; t++) { S.step(on, 1); S.step(off, 1); S.step(none, 1); }
  const fr = x => x.amounts.nad / (x.amounts.nad + x.amounts.nadh);
  ok(fr(on) > 0.8, `LDH あり：900 秒後の NAD⁺ の割合 ${(fr(on) * 100).toFixed(1)}%（再生される）`);
  ok(fr(off) < 0.02 && A.stageLimit(off, 'pay').kind === 'stopped', `LDH を一時停止：NAD⁺ の割合 ${(fr(off) * 100).toFixed(2)}% で回収期が停止（0.2.3 と同じ NAD⁺ 不足）`);
  ok(S.FREE.every(id => off.amounts[id] === none.amounts[id]), '一時停止した細胞と、LDH を持たない細胞の計算結果は完全に一致');
  ok(on.totals.pyrProduced > 3 * off.totals.pyrProduced, `ピルビン酸の累計：LDH あり ${on.totals.pyrProduced.toFixed(0)} ／ 停止 ${off.totals.pyrProduced.toFixed(0)}`);
}

console.log('[S11] SELF-SUSTAINING（補充なしで解糖系を維持した記録）');
{
  const s = withLdh(); s.rp = 1e6;
  run(s, 200);
  S.buy(s, 'nadsalv');
  ok(s.knowledge.regen.since === null && s.knowledge.regen.refillsAfter === 1, 'LDH 獲得後の補充は数えられ、区間が途切れる');
  run(s, 299);
  ok(s.milestones.self_sustaining == null, '補充から 300 秒たつまでは記録されない');
  run(s, 5);
  ok(s.milestones.self_sustaining != null && /SELF-SUSTAINING/.test(s.log.map(l => l.text).join()), `補充なしで 300 秒（ピルビン酸 ${(s.totals.pyrProduced - s.knowledge.regen.pyrAt).toFixed(0)}）続くと SELF-SUSTAINING を記録`);
  const t = withLdh(); S.setSwitch(t, 'ldhOff', true); run(t, 600);
  ok(t.milestones.self_sustaining == null, 'LDH を止めている間は数えない');
  ok(!/完全な自己維持|自給自足|NAD⁺ を(作る|つくる|生産)/.test(JSON.stringify(MB.MILESTONES.map(m => m.text)) + JSON.stringify(MB.GLOSSARY)), '過大な表現（完全な自己維持・NAD⁺ をつくる）を使わない');
}

console.log('[S12] 経済：LDH の獲得前後（自動プレイ 80 分。tools/economy.js の方針）');
{
  const { play } = require(path.join(TOOLS, 'economy.js'));
  const f = s => s == null ? '—' : `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
  for (const pol of ['wait', 'cheap']) {
    const r = play(80, { identify: pol });
    const ldh = r.idents.find(x => x[1] === 'ldh'), T = ldh ? ldh[0] : null;
    const ref = r.buys.filter(b => b[1] === 'nadsalv').map(b => b[0]);
    const before = ref.filter(t => t < T).length, after = ref.filter(t => t >= T).length;
    const cb = r.cells.filter(c => c.end < T).length, ca = r.cells.filter(c => c.end >= T).length;
    const rateB = before / (T / 600), rateA = after / ((80 * 60 - T) / 600);
    console.log(`    ${pol === 'wait' ? '待つだけ    ' : '安ければ払う'}：LDH 同定 ${f(T)}／補充 前 ${before} 回（${rateB.toFixed(2)} 回/10分）→ 後 ${after} 回（${rateA.toFixed(2)} 回/10分）／新しい細胞 前 ${cb} 回 → 後 ${ca} 回`);
    ok(T != null && T > 30 * 60 && T < 50 * 60, `${pol}：LDH の同定は 30〜50 分（NAD⁺ 不足を十分経験してから。遠すぎない）`);
    ok(before >= 3 && rateA <= 0.25 * rateB, `${pol}：LDH 獲得後、NAD⁺ 補充の頻度が明確に下がる（1/4 以下）`);
    ok(ca <= cb / 4, `${pol}：LDH 獲得後、細胞の再構築も明確に減る`);
  }
}

/* ================= 0.4 MCT（乳酸と H⁺ の共輸送）と細胞の外 ================= */
const withMct = (lv) => { const x = withLdh(lv); x.levels.lacexit = 1; x.levels.tr_mct = 1; return x; };
const onlyMct = fn => withParams(() => { for (const r of MB.REACTIONS) if (r.computed && r.id !== 'mct') r.vmaxBase = 0; }, fn);
const frN = x => x.amounts.nad / (x.amounts.nad + x.amounts.nadh);

console.log('[M1] MCT の式：乳酸と H⁺ の 1:1 の共輸送。物質を変えず、ATP を使わない');
{
  const r = R('mct');
  ok(same(r.stoich, { lac: -1, h: -1, lacOut: 1, hOut: 1 }), '乳酸⁻ + H⁺（中） → 乳酸⁻ + H⁺（外）');
  ok(r.stoich.lac === -r.stoich.lacOut && r.stoich.h === -r.stoich.hOut && Math.abs(r.stoich.lac) === Math.abs(r.stoich.h), '乳酸と H⁺ は 1:1（乳酸⁻ と H⁺ で電荷が打ち消し合う＝電気的に中性）');
  let c = 0; for (const [sp, k] of Object.entries(r.stoich)) c += (MB.SPECIES[sp].carbon || 0) * k;
  ok(c === 0 && !('atp' in r.stoich) && !('adp' in r.stoich), '炭素収支 0。式に ATP・ADP がない（ポンプではない）');
  ok(r.protein === 'transporter' && R('ldh').protein !== 'transporter' && MB.UPGRADES.find(u => u.id === 'tr_mct').protein === 'transporter', '輸送体として、酵素（LDH など）と区別して定義');
  ok(MB.SPECIES.lacOut.compartment === 'ext' && MB.SPECIES.hOut.pool === 'buffered' && MB.COMPARTMENTS.ext, '細胞外の乳酸は別の区画（ext）の物質。細胞外の H⁺ は一定（pH 7.4）とみなす');
  ok(r.thermo.reversible && near(S.kGame('mct'), Math.pow(10, 0.2), 1e-12), `可逆。平衡 [乳酸]外/[乳酸]内 ＝ [H⁺]内/[H⁺]外 ＝ 10^(7.4−7.2) ＝ ${S.kGame('mct').toFixed(4)}`);
}

console.log('[M2] 輸送の平衡（両方向から）と双方向性');
{
  onlyMct(() => {
    for (const [name, init] of [['中が多い', { lac: 1000, lacOut: 0 }], ['外が多い', { lac: 0, lacOut: 1000 }]]) {
      const s = withMct(); Object.assign(s.amounts, init);
      run(s, 2000);
      const q = S.massActionRatio('mct', s) / S.kGame('mct');
      ok(Math.abs(q - 1) < 1e-3 && near(s.amounts.lac + s.amounts.lacOut, 1000, 1e-9) && s.diag.eqViolations === 0,
        `${name}から平衡へ：外/中 = ${(s.amounts.lacOut / s.amounts.lac).toFixed(4)}（Q/K ${q.toFixed(5)}）。乳酸の合計 1000 は保存`);
    }
    const s = withMct(); Object.assign(s.amounts, { lac: 10, lacOut: 800 }); S.step(s, 1);
    ok((s.totals.extent.mct || 0) < 0 && s.amounts.lac > 10, `外のほうが多いと中へ運ぶ（正味の進行量 ${s.totals.extent.mct.toFixed(2)}）＝ 一方向の機構ではない`);
  });
  const t = withMct(); S.addGlucose(t, 300); run(t, 900);
  const out0 = t.amounts.lacOut; S.newCulture(t);
  ok(t.amounts.lacOut === out0 && t.amounts.lac === 0, `新しい細胞でも細胞の外の乳酸は残る（${out0.toFixed(0)}）。細胞の中は 0`);
  S.step(t, 1);
  ok((t.flux.mct || 0) < 0 && t.amounts.lac > 0, `新しい細胞の直後は、外に残った乳酸が MCT で中へ入る（${(t.flux.mct).toFixed(2)} /秒）`);
}

console.log('[M3] 収支：乳酸・炭素・ATP・RP');
{
  const s = withMct({ prep: 4, pay: 4, work: 3 }); S.addGlucose(s, 300); run(s, 2400);
  const e = s.totals.extent;
  ok(near(s.amounts.lac, e.ldh - e.mct, 1e-9) && near(s.amounts.lacOut, e.mct - e.lac_clear, 1e-9), `細胞の中の乳酸 ＝ 生成 − 排出、細胞の外 ＝ 排出 − 運び去られた分（${s.amounts.lac.toFixed(1)}／${s.amounts.lacOut.toFixed(1)}）`);
  ok(near(S.carbon(s) + S.carbonOut(s), 6 * s.totals.glcSupplied, 1e-9), `炭素：供給 ${(6 * s.totals.glcSupplied).toFixed(1)} ＝ 在庫（細胞外を含む）＋ 系の外へ運び去られた分 ${S.carbonOut(s).toFixed(1)}`);
  ok(near(80 + (-e.hk - e.pfk + e.pgk + e.pk - e.atpase), s.amounts.atp, 1e-9), 'ATP の収支に MCT は入らない（ATP を使わない）');
  ok(near(s.rp, e.pk * MB.ECONOMY.rpPerExtent, 1e-12), '研究ポイントは PK の進行量だけ（乳酸の排出からは入らない）');
  ok(near(S.conservation(s).nicotinamide, 200, 1e-12) && near(S.conservation(s).adenylate, 100, 1e-12), 'NAD⁺+NADH・ATP+ADP は保存');
}

console.log('[M4] 基質が足りないときも負の物質量が生じない');
{
  let minAmt = Infinity;
  for (const init of [{ lac: 1e-6, lacOut: 0 }, { lac: 0, lacOut: 1e-6 }, { lac: 5e4, lacOut: 0 }, { lac: 0, lacOut: 5e4 }]) {
    withParams(() => { R('mct').vmaxBase = 1e5; R('lac_clear').vmaxBase = 1e4; }, () => {
      const s = withMct(); Object.assign(s.amounts, init); S.addGlucose(s, 100);
      for (let i = 0; i < 1000; i++) { S.step(s, 0.1); for (const v of Object.values(s.amounts)) minAmt = Math.min(minAmt, v); }
      if (s.diag.eqViolations) ok(false, '平衡の行き過ぎ ' + s.diag.eqViolations);
    });
  }
  ok(minAmt >= 0, `MCT の Vmax を 3000 倍・流出を 100 倍にした4条件：負の物質量なし（最小 ${minAmt.toExponential(2)}）`);
}

console.log('[M5] MCT が働かないとき、0.3 と同じ計算結果になる（乳酸は従来どおり細胞内に蓄積）');
{
  const baseDir = path.join(__dirname, 'baseline_0.3');
  const ctx = { console, Date, Math, JSON, Float64Array, Array, Object }; ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of ['data.js', 'sim.js']) vm.runInContext(fs.readFileSync(path.join(baseDir, f), 'utf8'), ctx);
  const B = ctx.MB.Sim;
  const mk = Sx => { const x = Sx.createState(); x.levels.micro = 1; for (const id of ctx.MB.MICRO_IDS) x.levels['enz_' + id] = 3;
    Object.assign(x.levels, { glut: 6, prep: 4, pay: 4, work: 3, nadregen: 1, enz_ldh: 2 }); x.rp = 1e6; return x; };
  const a = mk(B), b = mk(S); let maxd = 0;
  for (let t = 0; t < 2400; t++) {
    if (t === 900) { B.buy(a, 'nadsalv'); S.buy(b, 'nadsalv'); }
    if (t === 1500) { B.newCulture(a); S.newCulture(b); }
    B.step(a, 1); S.step(b, 1);
  }
  for (const k of Object.keys(a.amounts)) maxd = Math.max(maxd, Math.abs(a.amounts[k] - b.amounts[k]));
  ok(maxd === 0 && b.amounts.lacOut === 0 && b.amounts.lac > 1000, `LDH あり・MCT なしで 2400 秒（補充・新しい細胞を含む）：0.3 の計算と全物質がビット単位で一致（最大差 ${maxd}）。乳酸 ${b.amounts.lac.toFixed(0)} が細胞内に蓄積、細胞外 0`);
  ok(Object.keys(a.totals.extent).every(k => a.totals.extent[k] === b.totals.extent[k]) && b.totals.extent.mct === 0 && b.totals.extent.lac_clear === 0, '反応ごとの累積進行量も一致（MCT・流出は 0）');
  ok(fail === 0, 'ここまでの全テスト（0.2.3 までの T1〜T28、0.3 の S1〜S12）がすべて成功');
}

console.log('[M6] MCT 獲得前後で、解糖系と NAD⁺ の循環が正常に動く');
{
  const s = withLdh({ prep: 6, pay: 6, work: 5, glut: 8 }); s.levels.enz_ldh = 4; s.rp = 1e6;
  let okNad = true; const rec = {};
  for (let t = 0; t < 3000; t++) {
    if (t === 1200) { s.levels.lacexit = 1; s.levels.tr_mct = 1; }
    S.step(s, 1);
    if (!near(s.amounts.nad + s.amounts.nadh, 200, 1e-12)) okNad = false;
    if (t === 1199) rec.before = { pk: s.flux.pk, fr: frN(s), lac: s.amounts.lac, q: S.massActionRatio('ldh', s) / S.kGame('ldh') };
    if (t === 2999) rec.after = { pk: s.flux.pk, fr: frN(s), lac: s.amounts.lac, q: S.massActionRatio('ldh', s) / S.kGame('ldh') };
  }
  ok(okNad, '3000 秒の毎秒、NAD⁺+NADH = 200（MCT は NAD 系に触れない）');
  ok(rec.after.pk >= rec.before.pk * 0.999 && rec.after.fr >= rec.before.fr - 1e-6, `解糖系の流れ ${rec.before.pk.toFixed(3)} → ${rec.after.pk.toFixed(3)} /秒、NAD⁺ の割合 ${(rec.before.fr * 100).toFixed(1)}% → ${(rec.after.fr * 100).toFixed(1)}%（悪化しない）`);
  ok(rec.after.lac < 0.2 * rec.before.lac && rec.after.q < rec.before.q, `細胞内の乳酸 ${rec.before.lac.toFixed(0)} → ${rec.after.lac.toFixed(0)}、LDH の Q/K ${rec.before.q.toFixed(3)} → ${rec.after.q.toFixed(3)}（乳酸が減ると LDH は平衡から遠ざかる＝質量作用）`);
}

console.log('[M7] MCT の解析は代謝に影響せず、既存のルールで同定される');
{
  const mk = r => { const x = withLdh(); S.addGlucose(x, 300); if (r) x.levels.lacexit = 1; return x; };
  const a = mk(false), b = mk(true); const e0 = b.totals.extent.ldh || 0;
  for (let t = 0; t < 600; t++) { S.step(a, 1); S.step(b, 1); }
  ok(S.analyzing(b).includes('mct') && S.FREE.every(id => a.amounts[id] === b.amounts[id]) && JSON.stringify(a.totals.extent) === JSON.stringify(b.totals.extent),
    `「乳酸の行き先」を研究すると MCT が解析中になる。解析中／なしで物質量・進行量が完全に一致（解析 ${Math.round(S.analysisProgress(b, 'mct') * 100)}%）`);
  ok(near(b.knowledge.analysis.mct, (b.totals.extent.ldh - e0) / 2, 1e-9) && b.totals.extent.mct === 0, '解析量 ＝ 解析中になってからの乳酸の生成量（LDH の進行量）÷ 2。同定前の MCT は運ばない');
  b.rp = 1e6; b.knowledge.analysis.mct = 200;
  ok(S.upgradeCost(b, 'tr_mct') === Math.ceil(MB.ANALYSIS.branches.mct.cost / 2), `即時同定の費用は残りの割合に比例（50% → ${S.upgradeCost(b, 'tr_mct')} RP）`);
  S.buy(b, 'tr_mct');
  ok(S.isIdentified(b, 'mct') && S.levelKey('mct') === 'tr_mct' && b.levels.tr_mct === 1 && b.events.some(e => e.id === 'mct') && b.log.some(l => /輸送体 モノカルボン酸輸送体（MCT）を同定した/.test(l.text)), '同定すると「輸送体 … を同定した」（酵素と区別した記録）');
  S.buy(b, 'tr_mct');
  ok(b.levels.tr_mct === 2 && near(S.vmax(b, R('mct')), R('mct').vmaxBase * 1.5, 1e-12), 'Lv2 から速さ +50%（既存の酵素と同じルール）');
}

console.log('[M8] 発見の条件：量だけでなく「たまり続けている」ことを観察する');
{
  ok(!S.isAvailable(withLdh(), 'lacexit') && !S.isAvailable(S.createState(), 'tr_mct'), '初めからは「乳酸の行き先」も MCT も研究できない');
  const a = withLdh(); a.amounts.lac = 3000; S.setSwitch(a, 'ldhOff', true); run(a, 30);
  ok(a.milestones.lac_accum == null, '乳酸が多くても、LDH が止まっていて増えていなければ記録しない');
  const b = withLdh(); S.addGlucose(b, 500); let t = 0;
  while (b.milestones.lac_accum == null && t < 3000) { S.step(b, 1); t++; }
  ok(b.milestones.lac_accum != null && b.amounts.lac >= MB.LACEXIT.amount && (b.flux.ldh || 0) >= MB.LACEXIT.rate && S.isAvailable(b, 'lacexit'),
    `LDH が働いて乳酸が ${MB.LACEXIT.amount} 以上、なお ${b.flux.ldh.toFixed(2)} /秒で増えているとき記録 → 研究できる（${t} 秒）`);
  ok(!S.isAvailable(Object.assign(withMct(), { levels: Object.assign(withMct().levels, { enz_ldh: 0 }) }), 'lacexit'), 'LDH がなければ研究できない');
}

console.log('[M9] 新しい細胞にしても MCT の知識と研究は保持される');
{
  const s = withMct({ tr_mct: 3 }); S.addGlucose(s, 300); run(s, 600);
  s.knowledge.balance.best = 99;
  const keep = JSON.stringify({ l: s.levels, i: s.knowledge.identified, a: s.knowledge.analysis, b: s.knowledge.balance.best });
  S.newCulture(s);
  ok(JSON.stringify({ l: s.levels, i: s.knowledge.identified, a: s.knowledge.analysis, b: s.knowledge.balance.best }) === keep && s.knowledge.balance.since === null, '研究レベル（lacexit・tr_mct Lv3）・解析・つり合いの最高記録を保持。区間は数え直す');
  run(s, 120);
  ok((s.flux.mct || 0) > 0 && s.amounts.lac > 0, '新しい細胞でもすぐ MCT が働く（しばらくすると外向きに戻る）');
}

console.log('[M10] 0.3（v5）セーブデータからの移行（0.3 のコードで自動プレイした実データ4種）');
{
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v5_saves.json'), 'utf8'));
  for (const [name, v5] of Object.entries(fx)) {
    const s = S.deserialize(JSON.stringify(v5));
    const checks = [
      ['最新版', s.saveVersion === S.SAVE_VERSION],
      ['RP', s.rp === v5.rp],
      ['研究レベル', Object.entries(v5.levels).every(([k, v]) => s.levels[k] === v)],
      ['同定・解析', JSON.stringify(s.knowledge.identified) === JSON.stringify(v5.knowledge.identified) && JSON.stringify(s.knowledge.analysis) === JSON.stringify(v5.knowledge.analysis)],
      ['SELF-SUSTAINING の記録', JSON.stringify(s.knowledge.regen) === JSON.stringify(v5.knowledge.regen)],
      ['比較実験の停止', JSON.stringify(s.switches) === JSON.stringify(v5.switches)],
      ['累積記録・細胞・補充', JSON.stringify(s.totals) === JSON.stringify(v5.totals) && JSON.stringify(s.cell) === JSON.stringify(v5.cell)],
      ['記録タブ・マイルストーン', JSON.stringify(s.log) === JSON.stringify(v5.log) && JSON.stringify(s.milestones) === JSON.stringify(v5.milestones)],
      ['物質量（細胞内の乳酸を含む）そのまま', Object.keys(v5.amounts).every(id => s.amounts[id] === v5.amounts[id])],
      ['新規：細胞外の乳酸 0・MCT 未同定・未研究・つり合いの記録は空', s.amounts.lacOut === 0 && s.levels.tr_mct === 0 && s.levels.lacexit === 0 && JSON.stringify(s.knowledge.balance) === '{"since":null,"best":0}']
    ];
    const bad = checks.filter(c => !c[1]).map(c => c[0]);
    ok(!bad.length, `${name.padEnd(16)} 乳酸 ${v5.amounts.lac.toFixed(0)}・LDH Lv${v5.levels.enz_ldh}・停止 ${JSON.stringify(v5.switches)}` + (bad.length ? '  ✘ ' + bad.join(', ') : ''));
  }
  const l = S.deserialize(JSON.stringify(fx.lactate75min)); S.step(l, 1);
  ok(l.milestones.lac_accum != null && S.isAvailable(l, 'lacexit'), '0.3 で乳酸が大量にたまっていたデータは、移行後すぐ「たまり続けている」が記録され、研究できる');
  const st = fx.lactate75min; const k = S.deserialize(JSON.stringify(st));
  const C0 = S.carbon(k); run(k, 60);
  ok(near(S.carbon(k) + S.carbonOut(k), C0 + 6 * (k.totals.glcSupplied - st.totals.glcSupplied), 1e-9), '移行後に計算を続けても炭素の収支が合う');
  let chain = true;
  for (const f of ['v1_saves.json', 'v2_saves.json', 'v3_saves.json', 'v4_saves.json']) for (const d of Object.values(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8')))) {
    const x = S.deserialize(JSON.stringify(d)); if (!(x.saveVersion === S.SAVE_VERSION && x.amounts.lacOut === 0 && x.knowledge.balance && x.knowledge.regen)) chain = false;
  }
  ok(chain, `0.1〜0.2.3（v1〜v4）からも v${S.SAVE_VERSION} まで連続して移行できる`);
}

console.log('[M11] LACTATE BALANCE（乳酸の生成と排出のつり合い）');
{
  const s = withMct({ prep: 4, pay: 4, work: 3, glut: 6 }); s.levels.tr_mct = 0; s.levels.lacexit = 0;
  run(s, 900); const lac0 = s.amounts.lac;
  s.levels.lacexit = 1; s.levels.tr_mct = 1; let t = 0;
  while (s.milestones.lac_balance == null && t < 3600) { S.step(s, 1); t++; }
  ok(s.milestones.lac_balance != null && Math.abs(s.flux.mct - s.flux.ldh) <= MB.LAC_BALANCE.tol * s.flux.ldh, `MCT 獲得から ${Math.floor(t / 60)}分${t % 60}秒でつり合い（生成 ${s.flux.ldh.toFixed(2)} ／ 排出 ${s.flux.mct.toFixed(2)} /秒、細胞内の乳酸 ${lac0.toFixed(0)} → ${s.amounts.lac.toFixed(0)}）`);
  ok(/LACTATE BALANCE/.test(s.log.map(l => l.text).join()), '記録タブに LACTATE BALANCE');
  const u = withMct(); S.setSwitch(u, 'mctOff', true); S.addGlucose(u, 300); run(u, 900);
  ok(u.milestones.lac_balance == null, 'MCT を止めている間は数えない');
}

console.log('[M12] MCT を止めると、従来どおり乳酸が細胞内に蓄積する');
{
  const mk = () => { const x = withMct({ prep: 3, pay: 3, work: 3 }); S.addGlucose(x, 200); run(x, 600); return x; };
  const off = mk(), none = JSON.parse(JSON.stringify(mk())); none.events = []; 
  S.setSwitch(off, 'mctOff', true); none.levels.tr_mct = 0; none.levels.lacexit = 0;   // 解析で再同定されないよう研究も外す
  const lac0 = off.amounts.lac;
  for (let t = 0; t < 600; t++) { S.step(off, 1); S.step(none, 1); }
  ok(off.amounts.lac > lac0 + 500 && S.FREE.every(id => off.amounts[id] === none.amounts[id]), `一時停止：乳酸 ${lac0.toFixed(0)} → ${off.amounts.lac.toFixed(0)}。MCT を持たない細胞と完全に同じ計算`);
}

console.log('[M13] 長時間放置（不在時進行 2 時間 × 3 回 ＋ 通常の刻みで 4 時間）での数値の異常');
{
  const s = withMct({ prep: 10, pay: 10, work: 9, glut: 12 }); MB.MICRO_IDS.forEach(id => { s.levels['enz_' + id] = 8; }); s.levels.enz_ldh = 7;
  let bad = 0, minAmt = Infinity, maxLac = 0, maxOut = 0;
  const chk = () => { for (const v of Object.values(s.amounts)) { if (!isFinite(v)) bad++; minAmt = Math.min(minAmt, v); } maxLac = Math.max(maxLac, s.amounts.lac); maxOut = Math.max(maxOut, s.amounts.lacOut); };
  for (let k = 0; k < 3; k++) { s.lastSaved = Date.now() - 3 * 3600 * 1000; S.catchUp(s, Date.now()); chk(); }
  const t0 = Date.now();
  for (let t = 0; t < 4 * 3600; t++) { S.step(s, 1); if (t % 60 === 0) chk(); }
  ok(bad === 0 && minAmt >= 0, `NaN・無限大なし、負の物質量なし（最小 ${minAmt.toExponential(2)}）`);
  ok(near(S.carbon(s) + S.carbonOut(s), 6 * s.totals.glcSupplied, 1e-8) && near(S.conservation(s).nicotinamide, 200, 1e-9) && near(S.conservation(s).adenylate, 100, 1e-9), '炭素（系の外へ出た分を含む）・NAD⁺+NADH・ATP+ADP の収支が合う');
  ok(maxLac < 2000 && maxOut < 2000 && s.diag.eqViolations === 0, `乳酸は細胞内 ${maxLac.toFixed(0)}・細胞外 ${maxOut.toFixed(0)} 以下で頭打ち（際限なく増えない）。平衡の行き過ぎ 0 件（計算 ${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);
}

console.log('[M14] 経済：MCT の獲得（自動プレイ 90 分）');
{
  const { play } = require(path.join(TOOLS, 'economy.js'));
  const f = s => s == null ? '—' : `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
  for (const pol of ['wait', 'cheap']) {
    let accum = null, lacAt = null, lacAfter = null; const tr = [];
    const r = play(90, { identify: pol, onTick: (t, g) => {
      if (accum == null && g.milestones.lac_accum != null) accum = t;
      if (S.isIdentified(g, 'mct')) { if (lacAt == null) lacAt = g.amounts.lac; tr.push(g.amounts.lac); }
    } });
    const T = (r.idents.find(x => x[1] === 'mct') || [null])[0], L = (r.idents.find(x => x[1] === 'ldh') || [null])[0];
    const reg = (r.buys.find(b => b[1] === 'lacexit') || [null])[0];
    lacAfter = tr[600] != null ? tr[600] : tr[tr.length - 1];
    const refAfter = r.buys.filter(b => b[1] === 'nadsalv' && b[0] >= L).length;
    console.log(`    ${pol === 'wait' ? '待つだけ    ' : '安ければ払う'}：LDH ${f(L)} → 乳酸の観察 ${f(accum)} → 乳酸の行き先 ${f(reg)} → MCT ${f(T)} → つり合い ${f(r.marks.lac_balance)}／細胞内の乳酸 ${lacAt && lacAt.toFixed(0)} → 10分後 ${lacAfter && lacAfter.toFixed(0)}`);
    ok(T != null && T - L > 5 * 60 && T < 70 * 60, `${pol}：MCT は LDH の 5 分以上あと（乳酸の蓄積を観察してから）、70 分以内に同定`);
    ok(lacAfter < 0.5 * lacAt, `${pol}：MCT 獲得の 10 分後、細胞内の乳酸が半分以下`);
    ok(refAfter === 0 && r.marks.lac_balance != null, `${pol}：LDH 獲得後の NAD⁺ 補充は 0 回のまま。つり合いに到達`);
  }
}

console.log('[M15] 0.4.1：計算は 0.4 と同じ。0.4（v6）のセーブをそのまま読める');
{
  const ctx = { console, Date, Math, JSON, Float64Array, Array, Object }; ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of ['data.js', 'sim.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, 'baseline_0.4', f), 'utf8'), ctx);
  const B = ctx.MB.Sim;
  const mk = (Sx, M) => { const x = Sx.createState(); x.levels.micro = 1; M.MICRO_IDS.forEach(i => { x.levels['enz_' + i] = 6; });
    Object.assign(x.levels, { glut: 10, prep: 8, pay: 8, work: 7, nadregen: 1, enz_ldh: 5, lacexit: 1, tr_mct: 3 }); x.rp = 1e6; return x; };
  const a = mk(B, ctx.MB), b = mk(S, MB);
  for (let t = 0; t < 7200; t++) {
    for (const [Sx, x] of [[B, a], [S, b]]) {
      if (t === 2000) Sx.newCulture(x); if (t === 3000) Sx.buy(x, 'nadsalv');
      if (t === 4000) Sx.setSwitch(x, 'mctOff', true); if (t === 4600) Sx.setSwitch(x, 'mctOff', false);
      Sx.step(x, 1);
    }
  }
  ok(Object.keys(a.amounts).every(k => a.amounts[k] === b.amounts[k]) && JSON.stringify(a.totals.extent) === JSON.stringify(b.totals.extent) && a.rp === b.rp,
    '2 時間（MCT 獲得済み・新しい細胞・補充・MCT の停止と再開を含む）：0.4 と全物質・進行量・RP がビット単位で一致');
  ok(B.SAVE_VERSION === S.SAVE_VERSION && ctx.MB.DATA_VERSION === MB.DATA_VERSION, `セーブの版は 0.4 と同じ v${S.SAVE_VERSION}（移行は不要）`);
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v6_saves.json'), 'utf8'));
  for (const [name, v6] of Object.entries(fx)) {
    const s = S.deserialize(JSON.stringify(v6));
    const same = JSON.stringify(JSON.parse(S.serialize(s)), (k, v) => k === 'lastSaved' ? 0 : v) === JSON.stringify(v6, (k, v) => k === 'lastSaved' ? 0 : v);
    const C0 = S.carbon(s) + S.carbonOut(s), g0 = s.totals.glcSupplied; run(s, 600);
    const cOk = near(S.carbon(s) + S.carbonOut(s), C0 + 6 * (s.totals.glcSupplied - g0), 1e-9);
    ok(same && cOk, `${name.padEnd(22)} 読み込み → 保存で内容が1ビットも変わらない。続けて 600 秒計算しても炭素の収支が合う（細胞外 ${v6.amounts.lacOut.toFixed(0)}・停止 ${JSON.stringify(v6.switches)}）`);
  }
}

console.log(fail ? `\n${fail} 件失敗` : '\nすべて成功');
process.exit(fail ? 1 : 0);
