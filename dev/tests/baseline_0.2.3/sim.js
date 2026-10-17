/* =========================================================================
 * METABOLISM — sim.js（Prototype 0.2）
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

  const SAVE_VERSION = 4;
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
      knowledge: { analysis: {}, identified: {} },   // 解析の知識（新しい細胞でも保持）
      events: [],                                    // 画面への通知（保存しない）
      extAdded: {}, flux: {}, limit: {}, milestones: {}, log: [],
      diag: { halvings: 0, eqViolations: 0, newtonFail: 0 },
      lastSaved: Date.now()
    };
  }

  /* ---------------- 研究による Vmax ---------------- */
  function vmax(state, r) {
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
  }

  /* ---------------- 解析による同定（計算エンジンの外。物質量には触れない） ---------------- */
  const AN = MB.ANALYSIS;
  const JDX = {}; COMPUTED.forEach((r, j) => { JDX[r.id] = j; });
  function identified(state, id) { return (state.levels['enz_' + id] || 0) >= 1; }
  function stageOf(id) { for (const side of AN.sides) { const k = side.indexOf(id); if (k >= 0) return k; } return -1; }
  /* 解析中の酵素：内部の解析を研究済みで、各側の「まだ同定されていない最初の酵素」 */
  function analyzing(state) {
    if ((state.levels.micro || 0) < 1) return [];
    const out = [];
    for (const side of AN.sides) { const id = side.find(e => !identified(state, e)); if (id) out.push(id); }
    return out;
  }
  function analysisProgress(state, id) {
    const need = AN.stages[stageOf(id)].need;
    return Math.min(1, ((state.knowledge.analysis[id] || 0)) / need);
  }
  function identify(state, id, how) {
    state.levels['enz_' + id] = Math.max(1, state.levels['enz_' + id] || 0);
    state.knowledge.identified[id] = state.t;
    state.knowledge.analysis[id] = AN.stages[stageOf(id)].need;
    const r = R[id];
    state.log.unshift({ t: state.t, text: `${r.name}（${r.abbr}）を同定した。${MB.ENZYME_TEXT ? MB.ENZYME_TEXT[id] : ''}` + (how === 'rp' ? '（研究ポイントで解析を完了）' : '') });
    if (state.log.length > 40) state.log.length = 40;
    state.events.push({ type: 'identified', id, how });
    checkMilestones(state);
  }
  function updateAnalysis(state, acc) {
    for (const id of analyzing(state)) {
      const r = R[id], inc = Math.max(0, acc[JDX[id]]) / AN.perGlucose[r.phase];   // 負の刻みは 0
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
      const st = AN.stages[stageOf(u.enzyme)];
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
    if (u.effect.type === 'add') {
      state.amounts[u.effect.species] += u.effect.amount;
      state.extAdded[u.effect.species] = (state.extAdded[u.effect.species] || 0) + u.effect.amount;
      if (u.effect.species === 'nad') state.totals.nadAdded += u.effect.amount;
    }
    checkMilestones(state);
    return true;
  }
  function newCulture(state) {
    state.amounts = freshAmounts();
    state.totals.cultures = (state.totals.cultures || 0) + 1;
    state.flux = {}; state.limit = {}; state.extAdded = {};
    state.cell = { nadBought: 0, startedAt: state.t };
    state.log.unshift({ t: state.t, text: '新しい細胞で再開した。研究・研究ポイント・酵素の解析は保持。NAD⁺ 補充の価格は初期値に戻った。' });
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
      totals: state.totals, extAdded: state.extAdded, cell: state.cell, knowledge: state.knowledge, milestones: state.milestones, log: state.log,
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
    }
  };
  function migrate(s) {
    let v = s.saveVersion || 1;
    while (v < SAVE_VERSION) { v++; if (MIGRATIONS[v]) s = MIGRATIONS[v](s); }
    return s;
  }
  function deserialize(json) {
    let s;
    try { s = JSON.parse(json); } catch (e) { return null; }
    if (!s || typeof s !== 'object') return null;
    s = migrate(s);
    const base = createState();
    for (const id of FREE) if (s.amounts && isFinite(+s.amounts[id])) base.amounts[id] = Math.max(0, +s.amounts[id]);
    for (const id in base.levels) if (s.levels && isFinite(+s.levels[id])) base.levels[id] = +s.levels[id];
    Object.assign(base.totals, s.totals || {});
    base.totals.extent = Object.assign({}, (s.totals && s.totals.extent) || {});
    base.extAdded = s.extAdded || {};
    if (s.cell) base.cell = { nadBought: +s.cell.nadBought || 0, startedAt: +s.cell.startedAt || 0 };
    if (s.knowledge) base.knowledge = { analysis: Object.assign({}, s.knowledge.analysis), identified: Object.assign({}, s.knowledge.identified) };
    base.milestones = s.milestones || {};
    base.log = Array.isArray(s.log) ? s.log : [];
    base.rp = +s.rp || 0; base.t = +s.t || 0;
    base.lastSaved = s.lastSaved || Date.now();
    return base;
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
    netRates, conservation, expectedConservation, carbon,
    addGlucose, upgradeCost, isAvailable, canBuy, buy, newCulture, addNote, forecast, compareUpgrade,
    analyzing, analysisProgress, stageOf, isIdentified: identified,
    serialize, deserialize, migrate, catchUp,
    reaction: id => R[id], upgrade: id => U[id],
    // テスト用（内部の部品を個別に検証するため）
    _internal: { solveImplicit, limitByAvailability, checkEquilibrium, rates, toVec, vmaxList, IDX, NM, COMPUTED }
  };
})(typeof window !== 'undefined' ? window : globalThis);
