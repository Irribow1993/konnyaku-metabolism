/* =========================================================================
 * METABOLISM — sim.js（Prototype 0.4）
 * シミュレーション層。DOM を一切参照しない（Node でもそのまま動く）。
 *
 * 1 刻みの処理（それぞれ独立した関数。GPT 審査 0.2 実装前 必須修正1・2）
 *   ① solveImplicit   … 後退オイラー法（陰的解法）で、刻みの終わりの状態での反応速度を求める
 *   ② limitByAvailability … 物質量の非負性の保証。足りない物質を消費する反応だけを縮める
 *   ③ checkEquilibrium … 可逆反応が平衡を行き過ぎていないかの検査。行き過ぎたら刻みを半分にしてやり直す
 *   ④ 反応の進行量（extent）× 化学量論で状態を更新（保存則が構造的に守られる）
 * ========================================================================= */
(function (root) {
  'use strict';
  const MB = (root.MB = root.MB || {});

  const SAVE_VERSION = 6;
  const H_REALTIME = 0.1;        // 通常の刻み（秒）
  const H_OFFLINE = 1.0;         // 不在時進行の刻み（秒）
  const MAX_HALVING = 8;         // 刻みを半分にする回数の上限
  const ECON = MB.ECONOMY;
  const MANUAL_GLC = ECON.manualGlc;
  const FLUX_SMOOTH = 0.85;      // 表示用の速度平滑化（計算結果には影響しない）
  const OFFLINE_CAP = 2 * 3600;
  const EQ_TOL = 1e-3;           // 平衡の行き過ぎ判定の相対許容幅

  /* ---------------- 定義の前処理 ---------------- */
  const SP = MB.SPECIES;
  const FREE = Object.keys(SP).filter(id => SP[id].pool === 'free');
  const IDX = {}; FREE.forEach((id, i) => { IDX[id] = i; });
  const NS = FREE.length;
  const R = {}; MB.REACTIONS.forEach(r => { R[r.id] = r; });
  const COMPUTED = MB.REACTIONS.filter(r => r.computed);
  const NR = COMPUTED.length;
  const U = {}; MB.UPGRADES.forEach(u => { U[u.id] = u; });

  /* 化学量論行列（free 種のみ）: NM[r] = [[speciesIndex, coef], ...] */
  const NM = COMPUTED.map(r => Object.entries(r.stoich).filter(([s]) => SP[s].pool === 'free').map(([s, c]) => [IDX[s], c]));

  /* ---------------- 単位系と平衡定数 ---------------- */
  function kGame(r) {
    if (!r.thermo || !r.thermo.reversible) return null;
    // 0.4 MCT：乳酸と H⁺ の共輸送。[乳酸]外/[乳酸]内 ＝ [H⁺]内/[H⁺]外 ＝ 10^(pH外 − pH内)（pH 一定）
    if (r.thermo.keq === 'mct') return Math.pow(10, MB.ENVIRONMENT.pHout - MB.ENVIRONMENT.pHin);
    const K = Math.exp(-r.thermo.dG0 / MB.UNITS.RT_kJ);          // 教科書の K′eq
    const M_per_u = MB.UNITS.mM_per_u * 1e-3;
    switch (r.thermo.keqDim) {
      case 'M': return K / M_per_u;                               // M → u
      case 'perM_pi': return K * (MB.UNITS.pi_mM * 1e-3);         // Pᵢ（一定）を繰り込み無次元に
      default: return K;
    }
  }
  const KG = {}; COMPUTED.forEach(r => { KG[r.id] = kGame(r); });

  /* 質量作用比 Q（free 種のみ。buffered 種は K_game に繰り込み済み） */
  function massActionRatio(r, get) {
    let num = 1, den = 1;
    for (const [s, c] of Object.entries(r.stoich)) {
      if (SP[s].pool !== 'free') continue;
      const v = Math.max(0, get(s));
      if (c > 0) num *= Math.pow(v, c); else den *= Math.pow(v, -c);
    }
    return den > 0 ? num / den : Infinity;
  }

  /* ---------------- 状態 ---------------- */
  function freshAmounts() {
    const a = {};
    for (const id of FREE) a[id] = SP[id].initial || 0;
    return a;
  }
  function createState() {
    const levels = {};
    MB.UPGRADES.forEach(u => { levels[u.id] = 0; });
    return {
      saveVersion: SAVE_VERSION, dataVersion: MB.DATA_VERSION,
      t: 0, amounts: freshAmounts(), levels, rp: 0,
      totals: { pyrProduced: 0, glcSupplied: 0, glcConsumed: 0, atpHydrolyzed: 0, nadAdded: 0, rpEarned: 0, cultures: 0,
                extent: {} },               // 反応ごとの累積進行量（将来のエネルギー層の土台）
      cell: { nadBought: 0, startedAt: 0 },   // 現在の細胞だけの記録（新しい細胞で初期化）
      knowledge: { analysis: {}, identified: {}, regen: freshRegen(), balance: freshBalance() },   // 解析の知識（新しい細胞でも保持）
      switches: {},                                  // 0.3：比較実験のための一時停止（例：ldhOff）。保存する
      events: [],                                    // 画面への通知（保存しない）
      extAdded: {}, flux: {}, limit: {}, milestones: {}, log: [],
      diag: { halvings: 0, eqViolations: 0, newtonFail: 0 },
      lastSaved: Date.now()
    };
  }

  /* NAD⁺ を補充せずに解糖系を維持している区間の記録（0.3 SELF-SUSTAINING） */
  function freshRegen() { return { since: null, pyrAt: 0, best: 0, refillsAfter: 0 }; }
  /* 乳酸の生成と排出がつり合っている区間の記録（0.4 LACTATE BALANCE） */
  function freshBalance() { return { since: null, best: 0 }; }

  /* ---------------- 研究による Vmax ---------------- */
  function vmax(state, r) {
    // gate：その酵素を同定するまで反応しない（0.3 LDH）。比較実験で一時停止しているときも 0
    if (r.gate && (((state.levels[r.gate] || 0) < 1) || (state.switches && state.switches[r.id + 'Off']))) return 0;
    let v = r.vmaxBase || 0;
    for (const u of MB.UPGRADES) {
      const e = u.effect;
      if (e.type !== 'vmax' || !e.reactions.includes(r.id)) continue;
      const lv = Math.max(0, (state.levels[u.id] || 0) - (e.offset || 0));
      if (e.mode === 'add') v += e.perLevel * lv; else v *= 1 + e.perLevel * lv;
    }
    return v;
  }

  /* ---------------- 反応速度 ---------------- */
  // get(s) で物質量を読む。返り値は u/秒（可逆反応は負＝逆向き）
  function rate(r, Vm, get) {
    const k = r.kinetics;
    if (k.type === 'zero') return Vm;
    if (k.type === 'mm') {
      let v = Vm;
      for (const [s, Km] of Object.entries(k.km)) { const S = Math.max(0, get(s)); v *= S / (Km + S); }
      for (const g of r.regulation || []) {
        if (g.kind === 'inhibition') { const E = Math.max(0, get(g.effector)); v *= g.ki / (g.ki + E); }
      }
      return v;
    }
    // 可逆・飽和型（熱力学的に矛盾しない形）
    let fwd = 1, prodKs = 1, prodP = 1, dS = 1, dP = 1;
    for (const [s, Ks] of Object.entries(k.ks)) { const S = Math.max(0, get(s)); fwd *= S / Ks; prodKs *= Ks; dS *= 1 + S / Ks; }
    for (const [p, Kp] of Object.entries(k.kp)) { const P = Math.max(0, get(p)); prodP *= P; dP *= 1 + P / Kp; }
    const num = fwd - prodP / (prodKs * KG[r.id]);
    return Vm * num / (dS + dP - 1);
  }

  function rates(state, x, vms) {
    const get = s => x[IDX[s]];
    const v = new Float64Array(NR);
    for (let j = 0; j < NR; j++) v[j] = rate(COMPUTED[j], vms[j], get);
    return v;
  }

  /* ---------------- ① 陰的解法（後退オイラー＋ニュートン法） ---------------- */
  function solveLinear(A, b) {          // ガウスの消去法（部分ピボット）
    const n = b.length;
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-300) return null;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for (let r = c + 1; r < n; r++) {
        const f = A[r][c] / A[c][c];
        if (f === 0) continue;
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const x = new Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = b[r];
      for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
      x[r] = s / A[r][r];
    }
    return x;
  }
  function addN(x0, v, h) {             // x0 + h·N·v
    const x = Float64Array.from(x0);
    for (let j = 0; j < NR; j++) for (const [i, c] of NM[j]) x[i] += h * c * v[j];
    return x;
  }
  function solveImplicit(state, x0, vms, h) {
    let x = addN(x0, rates(state, x0, vms), h);
    for (let i = 0; i < NS; i++) if (x[i] < 0) x[i] = 0;
    for (let it = 0; it < 40; it++) {
      const v = rates(state, x, vms);
      const g = addN(x0, v, h);
      const F = new Array(NS);
      let conv = true;
      // 収束判定は物質ごと（ごく微量の物質 ― 例：1,3-BPG ― の精度も保つため）
      for (let i = 0; i < NS; i++) { F[i] = x[i] - g[i]; if (Math.abs(F[i]) > 1e-15 + 1e-10 * Math.abs(x[i])) conv = false; }
      if (conv) return { x, v };
      // ヤコビ行列 J = I − h·N·∂v/∂x（数値微分）
      const J = []; for (let i = 0; i < NS; i++) { J.push(new Array(NS).fill(0)); J[i][i] = 1; }
      for (let k = 0; k < NS; k++) {
        const d = Math.max(1e-10, Math.abs(x[k]) * 1e-7);
        const xp = Float64Array.from(x); xp[k] += d;
        const vp = rates(state, xp, vms);
        for (let j = 0; j < NR; j++) {
          const dv = (vp[j] - v[j]) / d;
          if (dv === 0) continue;
          for (const [i, c] of NM[j]) J[i][k] -= h * c * dv;
        }
      }
      const dx = solveLinear(J, F.map(f => -f));
      if (!dx) return null;
      // 物質量が負にならない範囲で進める（減衰ニュートン）
      let lam = 1;
      for (let i = 0; i < NS; i++) if (x[i] + dx[i] < 0) lam = Math.min(lam, 0.9 * x[i] / -dx[i]);
      if (lam < 1e-12) lam = 1;            // 0 に張り付いている成分は射影で処理
      for (let i = 0; i < NS; i++) { x[i] += lam * dx[i]; if (x[i] < 0) x[i] = 0; }
    }
    return null;                            // 収束せず → 刻みを半分に
  }

  /* ---------------- ② 非負性の保証（反応ごと） ---------------- */
  // 刻みの間に「消費量 > 刻み初めの量 + 同じ刻みでの生成量」となる物質があれば、
  // その物質を消費している反応だけを縮める。無関係な反応は縮めない。
  function limitByAvailability(x0, xi) {
    const scaled = new Float64Array(NR).fill(1);
    for (let iter = 0; iter < 50; iter++) {
      const prod = new Float64Array(NS), cons = new Float64Array(NS);
      for (let j = 0; j < NR; j++) for (const [i, c] of NM[j]) {
        const d = c * xi[j];
        if (d >= 0) prod[i] += d; else cons[i] -= d;
      }
      const f = new Float64Array(NS).fill(1);
      let any = false;
      for (let i = 0; i < NS; i++) {
        if (cons[i] > 0 && x0[i] + prod[i] - cons[i] < -1e-12) {
          f[i] = Math.max(0, (x0[i] + prod[i]) / cons[i]); any = true;
        }
      }
      if (!any) return scaled;
      for (let j = 0; j < NR; j++) {
        let phi = 1;
        for (const [i, c] of NM[j]) if (c * xi[j] < 0) phi = Math.min(phi, f[i]);
        if (phi < 1) { xi[j] *= phi; scaled[j] *= phi; }
      }
    }
    return scaled;
  }

  /* ---------------- ③ 平衡の行き過ぎ検査（可逆反応） ---------------- */
  function checkEquilibrium(xNew, xi) {
    const get = s => xNew[IDX[s]];
    const bad = [];
    for (let j = 0; j < NR; j++) {
      const r = COMPUTED[j], K = KG[r.id];
      if (K == null || Math.abs(xi[j]) < 1e-12) continue;
      const Q = massActionRatio(r, get);
      if (xi[j] > 0 && Q > K * (1 + EQ_TOL)) bad.push(r.id);
      if (xi[j] < 0 && Q < K / (1 + EQ_TOL)) bad.push(r.id);
    }
    return bad;
  }

  /* ---------------- 1 刻み ---------------- */
  function vmaxList(state) { return COMPUTED.map(r => vmax(state, r)); }
  function toVec(state) { return Float64Array.from(FREE.map(id => state.amounts[id] || 0)); }

  function tryStep(state, x0, vms, h, depth) {
    const sol = solveImplicit(state, x0, vms, h);
    if (!sol) {
      state.diag.newtonFail++;
      if (depth < MAX_HALVING) return halve(state, x0, vms, h, depth);
      return null;
    }
    const xi = Array.from(sol.v, v => v * h);                // 進行量
    limitByAvailability(x0, xi);                             // ②
    const xNew = addN(x0, xi.map(e => e / h), h);            // ④（進行量から更新）
    for (let i = 0; i < NS; i++) if (xNew[i] < 0) xNew[i] = 0;   // 丸め誤差（〜1e-12）のみ
    const bad = checkEquilibrium(xNew, xi);                  // ③
    if (bad.length) {
      if (depth < MAX_HALVING) return halve(state, x0, vms, h, depth);
      state.diag.eqViolations++;
    }
    return { x: xNew, xi };
  }
  function halve(state, x0, vms, h, depth) {
    state.diag.halvings++;
    const a = tryStep(state, x0, vms, h / 2, depth + 1);
    if (!a) return null;
    const b = tryStep(state, a.x, vms, h / 2, depth + 1);
    if (!b) return null;
    return { x: b.x, xi: a.xi.map((e, j) => e + b.xi[j]) };
  }

  function step(state, dt, opts) {
    const H = (opts && opts.h) || H_REALTIME;
    const vms = vmaxList(state);
    const acc = new Float64Array(NR);
    let remain = dt;
    while (remain > 1e-9) {
      const h = Math.min(H, remain);
      const x0 = toVec(state);
      const res = tryStep(state, x0, vms, h, 0);
      if (res) {
        FREE.forEach((id, i) => { state.amounts[id] = res.x[i]; });
        res.xi.forEach((e, j) => { acc[j] += e; });
      }
      remain -= h;
    }
    state.t += dt;
    book(state, acc, dt);
    checkMilestones(state);
    return state;
  }

  /* 累計・研究ポイント・表示用の速度 */
  function book(state, acc, dt) {
    const ext = state.totals.extent;
    COMPUTED.forEach((r, j) => {
      const e = acc[j];
      ext[r.id] = (ext[r.id] || 0) + e;
      if (r.id === 'pk') state.totals.pyrProduced += e;
      if (r.id === 'hk') state.totals.glcConsumed += e;
      if (r.id === 'glut') state.totals.glcSupplied += e;
      if (r.id === 'atpase') state.totals.atpHydrolyzed += e;
      if (r.id === ECON.rpSource) { state.rp += e * ECON.rpPerExtent; state.totals.rpEarned += e * ECON.rpPerExtent; }
      const inst = dt > 0 ? e / dt : 0;
      const prev = state.flux[r.id] || 0;
      state.flux[r.id] = dt >= 1 ? inst : prev * FLUX_SMOOTH + inst * (1 - FLUX_SMOOTH);
    });
    for (const r of COMPUTED) state.limit[r.id] = describeLimit(state, r);
    updateAnalysis(state, acc);
    updateRegen(state);
    updateBalance(state);
  }

  /* LACTATE BALANCE：MCT が働いている間、排出（MCT の正味）が生成（LDH の正味）の ±tol 以内の区間を数える。記録のみ */
  function updateBalance(state) {
    const g = state.knowledge.balance, B = MB.LAC_BALANCE;
    const prod = state.flux.ldh || 0, exp = state.flux.mct || 0;
    const ok = identified(state, 'mct') && !(state.switches && state.switches.mctOff) && prod >= B.minRate && Math.abs(exp - prod) <= B.tol * prod;
    if (!ok) { g.since = null; return; }
    if (g.since == null) g.since = state.t;
    g.best = Math.max(g.best, state.t - g.since);
  }

  /* SELF-SUSTAINING の区間：LDH が働いている間、最後の補充（または新しい細胞）からの時間とピルビン酸の量を数える。
   * 物質量には触れない（記録のみ）。 */
  function updateRegen(state) {
    const g = state.knowledge.regen;
    if (!identified(state, 'ldh') || (state.switches && state.switches.ldhOff)) { g.since = null; return; }
    if (g.since == null) { g.since = state.t; g.pyrAt = state.totals.pyrProduced; return; }
    if (state.totals.pyrProduced - g.pyrAt >= MB.SELF_SUSTAIN.minPyr) g.best = Math.max(g.best, state.t - g.since);
  }
  function regenStatus(state) {
    const g = state.knowledge.regen;
    if (g.since == null) return null;
    return { seconds: state.t - g.since, pyr: state.totals.pyrProduced - g.pyrAt, best: g.best, refillsAfter: g.refillsAfter };
  }

  /* ---------------- 解析による同定（計算エンジンの外。物質量には触れない） ---------------- */
  const AN = MB.ANALYSIS;
  const JDX = {}; COMPUTED.forEach((r, j) => { JDX[r.id] = j; });
  /* 同定の記録に使う研究の id：反応の gate（LDH は enz_ldh、MCT は tr_mct）、なければ 'enz_' + id */
  function levelKey(id) { return (R[id] && R[id].gate) || 'enz_' + id; }
  function identified(state, id) { return (state.levels[levelKey(id)] || 0) >= 1; }
  function stageOf(id) { for (const side of AN.sides) { const k = side.indexOf(id); if (k >= 0) return k; } return -1; }
  /* 同定に必要な解析量と即時同定の基準額。両端の酵素は段階から、分岐の酵素（0.3 LDH）は branches から */
  function specOf(id) { const b = AN.branches && AN.branches[id]; return b || AN.stages[stageOf(id)]; }
  /* 解析中の酵素：内部の解析を研究済みで、各側の「まだ同定されていない最初の酵素」 */
  function analyzing(state) {
    if ((state.levels.micro || 0) < 1) return [];
    const out = [];
    for (const side of AN.sides) { const id = side.find(e => !identified(state, e)); if (id) out.push(id); }
    for (const [id, b] of Object.entries(AN.branches || {}))
      if ((state.levels[b.after] || 0) >= 1 && !identified(state, id)) out.push(id);
    return out;
  }
  function analysisProgress(state, id) {
    const need = specOf(id).need;
    return Math.min(1, ((state.knowledge.analysis[id] || 0)) / need);
  }
  function identify(state, id, how) {
    state.levels[levelKey(id)] = Math.max(1, state.levels[levelKey(id)] || 0);
    state.knowledge.identified[id] = state.t;
    state.knowledge.analysis[id] = specOf(id).need;
    const r = R[id];
    state.log.unshift({ t: state.t, text: `${r.protein === 'transporter' ? '輸送体 ' : ''}${r.name}（${r.abbr}）を同定した。${MB.ENZYME_TEXT ? MB.ENZYME_TEXT[id] : ''}` + (how === 'rp' ? '（研究ポイントで解析を完了）' : '') });
    if (state.log.length > 40) state.log.length = 40;
    state.events.push({ type: 'identified', id, how });
    checkMilestones(state);
  }
  function updateAnalysis(state, acc) {
    for (const id of analyzing(state)) {
      const r = R[id], b = AN.branches && AN.branches[id];
      // 分岐の酵素は「基質が流れてきた量」（source 反応の正味の進行量）で解析する。負の刻みは 0
      const inc = b ? Math.max(0, acc[JDX[b.source]]) / b.per : Math.max(0, acc[JDX[id]]) / AN.perGlucose[r.phase];
      state.knowledge.analysis[id] = (state.knowledge.analysis[id] || 0) + inc;
      if (analysisProgress(state, id) >= 1) identify(state, id, 'flux');
    }
  }

  /* 律速要因の説明（表示用） */
  function describeLimit(state, r) {
    const get = s => state.amounts[s] || 0;
    const k = r.kinetics;
    if (k.type === 'mm') {
      let worst = null, wv = 1;
      for (const [s, Km] of Object.entries(k.km)) { const S = get(s), f = S / (Km + S); if (f < wv) { wv = f; worst = s; } }
      let reg = 1;
      for (const g of r.regulation || []) if (g.kind === 'inhibition') reg *= g.ki / (g.ki + get(g.effector));
      if (worst && wv < 0.05) return { kind: 'depleted', species: worst };
      if (reg < 0.5 && reg < wv) return { kind: 'regulated', effector: r.regulation[0].effector, factor: reg };
      if (worst && wv < 0.5) return { kind: 'substrate', species: worst, sat: wv };
      return { kind: 'enzyme' };
    }
    if (k.type === 'rev') {
      const Q = massActionRatio(r, get), K = KG[r.id];
      const ratio = Q / K;                        // 1 に近いほど平衡に近い
      return { kind: 'equilibrium', ratio };
    }
    return { kind: 'enzyme' };
  }

  /* ---------------- 表示用の補助 ---------------- */
  function netRates(state) {
    const net = {};
    for (const r of COMPUTED) {
      const f = state.flux[r.id] || 0;
      for (const [s, c] of Object.entries(r.stoich)) if (SP[s].pool === 'free') net[s] = (net[s] || 0) + c * f;
    }
    return net;
  }
  function conservation(state) {
    const g = {};
    for (const id of FREE) { const c = SP[id].conserved; if (c) g[c] = (g[c] || 0) + state.amounts[id]; }
    return g;
  }
  function expectedConservation(state) {
    const g = {};
    for (const id of FREE) { const c = SP[id].conserved; if (c) g[c] = (g[c] || 0) + (SP[id].initial || 0) + (state.extAdded[id] || 0); }
    return g;
  }
  /* 系の外へ出た炭素（細胞の周りから運び去られた乳酸。0.4）。炭素の収支：供給 ＝ 在庫 ＋ 系の外へ出た分 */
  function carbonOut(state) { return 3 * (state.totals.extent.lac_clear || 0); }
  function carbon(state) {
    let C = 0;
    for (const id of FREE) C += (SP[id].carbon || 0) * state.amounts[id];
    return C;
  }

  /* ---------------- プレイヤー操作 ---------------- */
  function addGlucose(state, n) {
    const amt = n == null ? MANUAL_GLC : n;
    state.amounts.glc += amt; state.totals.glcSupplied += amt;
    return amt;
  }
  function upgradeCost(state, id) {
    const u = U[id];
    const lv = u.perCell ? ((state.cell && state.cell.nadBought) || 0) : (state.levels[id] || 0);
    if (u.enzyme && lv === 0) {                     // 即時同定：基準額 × 残りの割合（解析が進むほど安い）
      const st = specOf(u.enzyme);
      return Math.max(1, Math.ceil(st.cost * (1 - analysisProgress(state, u.enzyme))));
    }
    return Math.ceil(u.costBase * Math.pow(u.costGrowth, lv));
  }
  function isAvailable(state, id) {
    const u = U[id];
    if (u.requires && !u.requires.test(state)) return false;
    if (u.enzyme && !identified(state, u.enzyme)) return analyzing(state).includes(u.enzyme);   // 解析中の酵素だけ即時同定できる
    return true;
  }
  function canBuy(state, id) {
    const u = U[id];
    return isAvailable(state, id) && (state.levels[id] || 0) < u.maxLevel && state.rp >= upgradeCost(state, id);
  }
  function buy(state, id) {
    if (!canBuy(state, id)) return false;
    const u = U[id];
    state.rp -= upgradeCost(state, id);
    if (u.enzyme && !identified(state, u.enzyme)) { identify(state, u.enzyme, 'rp'); return true; }
    state.levels[id] = (state.levels[id] || 0) + 1;          // perCell の研究では累計回数（統計）
    if (u.perCell) state.cell.nadBought = (state.cell.nadBought || 0) + 1;
    if (u.id === 'nadsalv') {                       // 外部からの補充：SELF-SUSTAINING の区間はここで途切れる
      const g = state.knowledge.regen;
      if (identified(state, 'ldh')) g.refillsAfter++;
      g.since = null;
    }
    if (u.effect.type === 'add') {
      state.amounts[u.effect.species] += u.effect.amount;
      state.extAdded[u.effect.species] = (state.extAdded[u.effect.species] || 0) + u.effect.amount;
      if (u.effect.species === 'nad') state.totals.nadAdded += u.effect.amount;
    }
    checkMilestones(state);
    return true;
  }
  function newCulture(state) {
    // 細胞の外（環境）の物質は、新しい細胞にしても残る（0.4）
    const env = {}; for (const id of FREE) if (SP[id].environment) env[id] = state.amounts[id] || 0;
    state.amounts = Object.assign(freshAmounts(), env);
    state.totals.cultures = (state.totals.cultures || 0) + 1;
    state.flux = {}; state.limit = {}; state.extAdded = {};
    state.cell = { nadBought: 0, startedAt: state.t };
    state.knowledge.regen.since = null;             // 新しい細胞では NAD⁺ が初期量に戻るため、区間を数え直す
    state.log.unshift({ t: state.t, text: '新しい細胞で再開した。研究・研究ポイント・酵素の解析は保持。NAD⁺ 補充の価格は初期値に戻った。' +
      (identified(state, 'ldh') ? '乳酸デヒドロゲナーゼ（LDH）も、そのまま働く。' : '') +
      (identified(state, 'mct') && (env.lacOut || 0) > 1 ? '細胞の外に残っている乳酸は、新しい細胞でもそのまま（MCT の正味の輸送方向は細胞内外の乳酸濃度と H⁺ 勾配で決まるので、はじめは外から中へ入ることがある）。' : '') });
    state.knowledge.balance.since = null;
  }

  /* 見込みの計算：state を複製して seconds 秒先まで計算し、ピルビン酸の生成速度（最後の 2 秒の平均）を返す。
   * 元の state には一切触れない。研究の効果を「研究しなかった場合」と比べるために使う。 */
  function forecast(state, seconds, mutate) {
    const c = JSON.parse(JSON.stringify(state));
    c.events = []; c.log = []; c.milestones = Object.assign({}, c.milestones);
    if (mutate) mutate(c);
    const sec = Math.max(3, Math.round(seconds));
    for (let i = 0; i < sec - 2; i++) step(c, 1);
    const e0 = c.totals.extent[ECON.rpSource] || 0;
    step(c, 1); step(c, 1);
    return ((c.totals.extent[ECON.rpSource] || 0) - e0) / 2;
  }
  /* 研究 id を買った場合と買わなかった場合を、同じ状態から seconds 秒先まで計算して比べる */
  function compareUpgrade(state, id, seconds) {
    const without = forecast(state, seconds);
    const withUp = forecast(state, seconds, c => { const lv = c.levels[id] || 0; c.levels[id] = lv + 1; });
    return { without, with: withUp };
  }

  /* 比較実験：LDH を一時停止する／戻す（0.3）。研究や知識は変えない */
  function setSwitch(state, key, on) {
    state.switches = state.switches || {};
    if (on) state.switches[key] = true; else delete state.switches[key];
    if (key === 'ldhOff') state.knowledge.regen.since = null;
    if (key === 'mctOff') state.knowledge.balance.since = null;
  }

  /* 記録タブへの一言（表示層から使う。物質量には触れない） */
  function addNote(state, text) {
    state.log.unshift({ t: state.t, text });
    if (state.log.length > 40) state.log.length = 40;
  }

  /* ---------------- マイルストーン ---------------- */
  function checkMilestones(state) {
    for (const m of MB.MILESTONES) {
      if (state.milestones[m.id] != null) continue;
      if (m.test(state)) {
        state.milestones[m.id] = state.t;
        state.log.unshift({ t: state.t, text: m.text });
        if (state.log.length > 40) state.log.length = 40;
      }
    }
  }

  /* ---------------- セーブ／ロード ---------------- */
  function serialize(state) {
    state.lastSaved = Date.now();
    return JSON.stringify({
      saveVersion: SAVE_VERSION, dataVersion: MB.DATA_VERSION,
      t: state.t, amounts: state.amounts, levels: state.levels, rp: state.rp,
      totals: state.totals, extAdded: state.extAdded, cell: state.cell, knowledge: state.knowledge, switches: state.switches || {}, milestones: state.milestones, log: state.log,
      lastSaved: state.lastSaved
    });
  }

  /* 版ごとの移行。0.1（v1）→ 0.2（v2）：三炭糖リン酸 TP を GAP・DHAP に分ける。
   * 分配は 0.2 モデル自身の TPI 平衡（K_game）に従う（GPT 審査 Q1：M1 承認）。
   * 実測の濃度比を再現する意図ではない。アルドラーゼの逆反応は移行後の通常計算に任せる。 */
  const MIGRATIONS = {
    2: s => {
      const a = s.amounts || {};
      const tp = Math.max(0, +a.tp || 0), K = KG.tpi;
      a.gap = tp * K / (1 + K);
      a.dhap = tp - a.gap;
      delete a.tp;
      s.amounts = a;
      s.totals = s.totals || {};
      s.totals.extent = s.totals.extent || {};
      s.saveVersion = 2;
      // GPT 審査 0.2 Q1：移行後の再分配を、0.2 モデルへの移行結果として記録で説明する
      if (tp > 0) {
        s.log = Array.isArray(s.log) ? s.log : [];
        s.log.unshift({ t: +s.t || 0, text: '0.2 への移行：三炭糖リン酸を GAP と DHAP に分けた。0.2 ではアルドラーゼが可逆反応として計算されるため、直後に一部が F1,6BP に戻る（0.2 モデルへの移行による物質の再分配。炭素の総量は変わらない）。' });
      }
      return s;
    },
    3: s => {
      // 0.2.1：NAD⁺ 補充の価格を細胞ごとに。移行時点では現在の細胞の購入回数を 0 とする
      s.cell = { nadBought: 0, startedAt: +s.t || 0 };
      s.saveVersion = 3;
      return s;
    },
    4: s => {
      // 0.2.2：解析による同定。v3 で解放済み（Lv1 以上）の酵素は同定済みとして引き継ぐ（進捗を失わない）
      const identified = {}, analysis = {};
      for (const id of MB.MICRO_IDS) if (((s.levels || {})['enz_' + id] || 0) >= 1) {
        identified[id] = +s.t || 0; analysis[id] = AN.stages[stageOf(id)].need;
      }
      s.knowledge = { analysis, identified };
      s.saveVersion = 4;
      return s;
    },
    5: s => {
      // 0.3：乳酸・LDH・NAD⁺ の再生。既存の値には触れず、新しい項目にだけ初期値を入れる
      //  乳酸の量 0（deserialize が既定値で補う）、enz_ldh・nadregen は Lv0、SELF-SUSTAINING の記録は空、比較実験の停止なし。
      //  条件の判定に使う「NAD⁺ 不足の経験（記録 nad_low）」「補充の累計回数（levels.nadsalv）」は 0.2.3 の記録をそのまま使う。
      s.knowledge = s.knowledge || { analysis: {}, identified: {} };
      s.knowledge.regen = freshRegen();
      s.switches = {};
      s.saveVersion = 5;
      return s;
    },
    6: s => {
      // 0.4：MCT・細胞外の乳酸。既存の値には触れない。細胞外の乳酸 0（deserialize の既定値）、tr_mct・lacexit は Lv0、
      //  つり合いの記録は空。0.3 で溜まっていた細胞内の乳酸はそのまま（MCT を得たあとに外へ出ていく）
      s.knowledge = s.knowledge || { analysis: {}, identified: {} };
      s.knowledge.balance = freshBalance();
      s.saveVersion = 6;
      return s;
    }
  };
  function migrate(s) {
    let v = s.saveVersion || 1;
    while (v < SAVE_VERSION) { v++; if (MIGRATIONS[v]) s = MIGRATIONS[v](s); }
    return s;
  }
  /* v0.1.2：読み込む内容は信用しない（書き出した文字列の貼り付けにも使うため）。
   *  知っている項目だけを、型と範囲を確かめてから写す。__proto__ などのキーは写さない（Object.assign を使わない）。
   *  正しいセーブの値は、これまでと1ビットも変わらない。 */
  const NUM_MAX = 1e15;                                   // 物質量・研究ポイント・累計の上限（これを超える値は壊れたデータとみなす）
  const MAX_LOG = 40, MAX_TEXT = 1000, MAX_MILESTONES = 100;
  const isNum = v => typeof v === 'number' && isFinite(v) && Math.abs(v) <= NUM_MAX;
  const own = (o, k) => o != null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  const SAFE_KEY = /^[a-z0-9_]{1,40}$/;
  const PROTEIN_IDS = [...MB.MICRO_IDS, 'ldh', 'mct'];
  function copyNums(src, keys, dst) {                   // keys にある項目のうち、数値のものだけを写す（元の並び順のまま）
    dst = dst || {};
    if (!src || typeof src !== 'object') return dst;
    const allow = new Set(keys);
    for (const k of Object.keys(src)) if (allow.has(k) && isNum(src[k])) dst[k] = src[k];
    return dst;
  }
  function copyNumOrNull(src, dst) {                    // dst が持っている項目だけ、数値か null を写す
    for (const k of Object.keys(dst)) if (own(src, k) && (src[k] === null || isNum(src[k]))) dst[k] = src[k];
    return dst;
  }
  function deserialize(json) {
    let s;
    try { s = JSON.parse(json); } catch (e) { return null; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    try { s = migrate(s); } catch (e) { return null; }   // 壊れたデータで移行が失敗しても、例外を外に出さない
    if (!s || typeof s !== 'object') return null;
    const base = createState();
    const am = own(s, 'amounts') ? s.amounts : null;
    for (const id of FREE) if (own(am, id) && isFinite(+am[id]) && Math.abs(+am[id]) <= NUM_MAX) base.amounts[id] = Math.max(0, +am[id]);
    const lv = own(s, 'levels') ? s.levels : null;
    for (const id in base.levels) if (own(lv, id) && isFinite(+lv[id]) && Math.abs(+lv[id]) <= NUM_MAX) base.levels[id] = +lv[id];
    const to = own(s, 'totals') ? s.totals : null;
    copyNums(to, Object.keys(base.totals).filter(k => k !== 'extent'), base.totals);
    base.totals.extent = copyNums(own(to, 'extent') ? to.extent : null, Object.keys(R));
    base.extAdded = copyNums(own(s, 'extAdded') ? s.extAdded : null, Object.keys(SP));
    if (own(s, 'cell') && s.cell && typeof s.cell === 'object') base.cell = { nadBought: isNum(+s.cell.nadBought) ? +s.cell.nadBought || 0 : 0, startedAt: isNum(+s.cell.startedAt) ? +s.cell.startedAt || 0 : 0 };
    const kn = own(s, 'knowledge') ? s.knowledge : null;
    if (kn && typeof kn === 'object') base.knowledge = {
      analysis: copyNums(own(kn, 'analysis') ? kn.analysis : null, PROTEIN_IDS),
      identified: copyNums(own(kn, 'identified') ? kn.identified : null, PROTEIN_IDS),
      regen: copyNumOrNull(own(kn, 'regen') ? kn.regen : null, freshRegen()),
      balance: copyNumOrNull(own(kn, 'balance') ? kn.balance : null, freshBalance()) };
    base.switches = {};
    if (own(s, 'switches')) for (const k of ['ldhOff', 'mctOff']) if (own(s.switches, k) && s.switches[k] === true) base.switches[k] = true;
    base.milestones = {};
    const ms = own(s, 'milestones') ? s.milestones : null;
    if (ms && typeof ms === 'object') for (const k of Object.keys(ms).slice(0, MAX_MILESTONES)) if (SAFE_KEY.test(k) && isNum(ms[k])) base.milestones[k] = ms[k];
    base.log = [];
    if (own(s, 'log') && Array.isArray(s.log)) for (const l of s.log) {
      if (base.log.length >= MAX_LOG) break;
      if (l && typeof l === 'object' && isNum(l.t) && typeof l.text === 'string') base.log.push({ t: l.t, text: l.text.slice(0, MAX_TEXT) });
    }
    base.rp = isNum(+s.rp) ? +s.rp || 0 : 0; base.t = isNum(+s.t) ? +s.t || 0 : 0;
    base.lastSaved = isNum(s.lastSaved) && s.lastSaved ? s.lastSaved : Date.now();
    return base;
  }

  /* v0.1.2：読み込んだ state 全体のつじつま（外から貼り付けたセーブを受け入れる前に確かめる）。
   *  個々の値の型・範囲は deserialize が確かめる。ここでは値どうしの関係を見る。返り値は問題の一覧（空なら問題なし）。
   *  ゲームの計算で起こりうる状態はすべて通る（v1〜v6 の全フィクスチャと、長時間の計算で確認）。 */
  function checkIntegrity(state) {
    const bad = [], tol = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
    const cons = conservation(state), exp = expectedConservation(state);
    if (!tol(cons.adenylate, exp.adenylate)) bad.push(`ATP＋ADP の合計（${cons.adenylate}）が、あるべき量（${exp.adenylate}）と合わない`);
    if (!tol(cons.nicotinamide, exp.nicotinamide)) bad.push(`NAD⁺＋NADH の合計（${cons.nicotinamide}）が、あるべき量（${exp.nicotinamide}）と合わない`);
    for (const id in state.extAdded) if (!(SP[id] && SP[id].conserved) || state.extAdded[id] < 0) bad.push(`外から加えた物質の記録（${id}）が正しくない`);
    for (const u of MB.UPGRADES) {
      const lv = state.levels[u.id] || 0;
      if (!Number.isInteger(lv) || lv < 0 || lv > u.maxLevel) bad.push(`研究「${u.id}」の Lv（${lv}）が 0〜${u.maxLevel} の整数でない`);
    }
    const t = state.t;
    if (!(t >= 0)) bad.push('経過時間が負');
    if (!(state.rp >= 0)) bad.push('研究ポイントが負');
    for (const [k, v] of Object.entries(state.totals)) if (k !== 'extent' && !(v >= 0)) bad.push(`累計「${k}」が負`);
    if (!Number.isInteger(state.totals.cultures || 0)) bad.push('細胞の数が整数でない');
    const nb = state.cell.nadBought || 0;
    if (!Number.isInteger(nb) || nb < 0 || nb > (state.levels.nadsalv || 0)) bad.push('この細胞での NAD⁺ 補充の回数が、累計の回数と合わない');
    if (state.cell.startedAt > t + 1e-6 || state.cell.startedAt < 0) bad.push('いまの細胞を始めた時刻が、経過時間の外にある');
    for (const [k, v] of Object.entries(state.milestones)) if (v < 0 || v > t + 1e-6) bad.push(`記録「${k}」の時刻が、経過時間の外にある`);
    const kn = state.knowledge;
    for (const [id, v] of Object.entries(kn.identified)) if (v < 0 || v > t + 1e-6) bad.push(`「${id}」を同定した時刻が、経過時間の外にある`);
    for (const [id, v] of Object.entries(kn.analysis)) if (v < 0) bad.push(`「${id}」の解析の進み具合が負`);
    for (const g of [kn.regen, kn.balance]) if (g.since != null && (g.since < 0 || g.since > t + 1e-6)) bad.push('記録中の区間の始まりが、経過時間の外にある');
    return bad;
  }

  function catchUp(state, now) {
    const elapsed = Math.min(OFFLINE_CAP, Math.max(0, (now - state.lastSaved) / 1000));
    if (elapsed < 5) return 0;
    step(state, elapsed, { h: H_OFFLINE });
    return elapsed;
  }

  MB.Sim = {
    SAVE_VERSION, ECON, MANUAL_GLC, FREE, COMPUTED_IDS: COMPUTED.map(r => r.id),
    createState, step, vmax, kGame: id => KG[id], massActionRatio: (id, state) => massActionRatio(R[id], s => state.amounts[s] || 0),
    netRates, conservation, expectedConservation, carbon, carbonOut, levelKey,
    balanceStatus: state => { const g = state.knowledge.balance; return g.since == null ? null : { seconds: state.t - g.since, best: g.best }; },
    addGlucose, upgradeCost, isAvailable, canBuy, buy, newCulture, addNote, forecast, compareUpgrade, setSwitch, regenStatus,
    analyzing, analysisProgress, stageOf, specOf, isIdentified: identified,
    serialize, deserialize, migrate, catchUp, checkIntegrity,
    reaction: id => R[id], upgrade: id => U[id],
    // テスト用（内部の部品を個別に検証するため）
    _internal: { solveImplicit, limitByAvailability, checkEquilibrium, rates, toVec, vmaxList, IDX, NM, COMPUTED }
  };
})(typeof window !== 'undefined' ? window : globalThis);
