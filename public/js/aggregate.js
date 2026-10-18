/* =========================================================================
 * METABOLISM — aggregate.js（Prototype 0.4）
 * マクロ表示用の集計。state を読むだけで、書き換えない。
 * 計算（sim.js）とは独立しており、表示の切り替えは state に影響しない。
 * ========================================================================= */
(function (root) {
  'use strict';
  const MB = (root.MB = root.MB || {});
  const SP = MB.SPECIES;

  /* マクロの各項目 = 対応するミクロの物質の合計（分子数） */
  function pools(state) {
    const g = {};
    for (const id of Object.keys(MB.GROUPS)) g[id] = 0;
    for (const [id, sp] of Object.entries(SP)) {
      if (sp.pool !== 'free' || !sp.group) continue;
      g[sp.group] += state.amounts[id] || 0;
    }
    return g;
  }

  /* マクロの速度（すべてグルコース1分子あたり＝グルコース換算）
   *  準備期 = HK の速度（グルコースが取り込まれる入口）
   *  回収期 = PK の速度 ÷ 2（ピルビン酸が出る出口。グルコース1分子からピルビン酸2分子） */
  function rates(state) {
    const f = state.flux;
    return {
      prep: f.hk || 0,
      pay: (f.pk || 0) / 2,
      glut: f.glut || 0,
      work: f.atpase || 0
    };
  }

  /* 各段の「止まり方」の要約（表示用） */
  function stageLimit(state, stage) {
    const L = state.limit || {};
    if (stage === 'prep') {
      for (const id of ['hk', 'pfk']) {
        const l = L[id];
        if (l && l.kind === 'depleted' && l.species === 'atp') return { kind: 'stopped', reason: 'atp', at: id };
      }
      // v0.2.0：PFK-1 が ATP で抑えられているときは、それを先に示す（HK の抑制は、その結果 G6P が増えたため）
      const pfk = L.pfk;
      if (pfk && pfk.kind === 'regulated') return { kind: 'regulated', at: 'pfk', factor: pfk.factor };
      const hk = L.hk;
      if (hk && hk.kind === 'regulated') return { kind: 'regulated', at: 'hk', factor: hk.factor };
      if (hk && hk.kind === 'depleted' && hk.species === 'glc') return { kind: 'waiting' };
      return { kind: 'running' };
    }
    // 回収期：NAD⁺ が尽きたか、NADH が溜まって GAPDH が平衡に近いか
    const a = state.amounts, tN = a.nad + a.nadh;
    const nadFrac = tN > 0 ? a.nad / tN : 0;
    if (nadFrac < 0.02) return { kind: 'stopped', reason: 'nad' };
    const pk = L.pk;
    if (pk && pk.kind === 'depleted' && pk.species === 'adp') return { kind: 'stopped', reason: 'adp' };
    if (nadFrac < 0.15) return { kind: 'slowing', reason: 'nadh' };
    return { kind: 'running' };
  }

  function macro(state) {
    const p = pools(state);
    return {
      pools: p,
      rates: rates(state),
      prep: stageLimit(state, 'prep'),
      pay: stageLimit(state, 'pay'),
      carbon: 6 * (p.glc + p.prepMid) + 3 * (p.tp + p.payMid + p.pyr + p.lac + p.lacOut)
    };
  }

  MB.Aggregate = { pools, rates, stageLimit, macro };
})(typeof window !== 'undefined' ? window : globalThis);
