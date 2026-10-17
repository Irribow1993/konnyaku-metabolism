/* METABOLISM 経済シミュレーター（調整用の道具。ゲームには含まれない）
 *   node tools/economy.js [分] [--json]
 * 人間らしい単純な方針で自動プレイし、目標の到達時刻と「購入の間隔」の推移を測る。
 * 方針（プレイヤーモデル）：
 *   - 輸送体が Lv2 になるまでは、グルコースが少なければ 3 秒に 1 回手で投与する
 *   - NAD⁺ が 10% を切ったら、補充が「元が取れる」価格（≦ 補充量 × RP/Pyr × 0.9）なら補充する
 *   - 補充が割高、または ATP が尽きて止まったら、新しい細胞で再開する
 *   - 「次の目標」が研究を指していれば優先して貯める。それ以外は、買える研究のうち最も安いものを買う
 *   - 酵素の即時同定（opts.identify）：'wait' は払わず待つ。'cheap' は残り費用が手持ちの 25% 以下なら払う
 *     （既定）。'goal' は目標が酵素の同定のとき、買えればすぐ払う
 */
'use strict';
const path = require('path');
for (const f of ['data.js', 'glossary.js', 'sim.js', 'aggregate.js']) require(path.join(__dirname, '../../public/js', f));
const MB = globalThis.MB, S = MB.Sim, A = MB.Aggregate;

function play(minutes, opts = {}) {
  const g = S.createState();
  const T = minutes * 60, H = opts.h || 0.5;
  const buys = [], cells = [], marks = {}, idents = [];
  let cellStart = 0, lastTap = -99, peak = 0;
  const nadValue = 100 * MB.ECONOMY.rpPerExtent * 0.9;
  for (let t = 0; t < T; t++) {
    const a = g.amounts, nadFrac = a.nad / (a.nad + a.nadh);
    if ((g.levels.glut || 0) < 2 && a.glc < 15 && t - lastTap >= 3) { S.addGlucose(g); lastTap = t; }
    const m = A.macro(g);
    peak = Math.max(peak, m.rates.pay);
    // 「回収期が遅くなっています」が出て、最盛期の 1/3 未満まで落ちたら細胞を替える（opts.slowReset）
    const tooSlow = opts.slowReset !== false && nadFrac < 0.15 && m.rates.pay < peak / 3 && t - cellStart > 30;
    const stalledAtp = a.atp < 0.5 && m.rates.prep < 0.005 && a.glc > 1;
    const nadCost = S.upgradeCost(g, 'nadsalv');
    let acted = false;
    if (tooSlow) { cells.push({ end: t, dur: t - cellStart }); S.newCulture(g); cellStart = t; peak = 0; acted = true; }
    else if (nadFrac < 0.1) {
      if (nadCost <= nadValue && !stalledAtp) {
        if (S.canBuy(g, 'nadsalv')) { S.buy(g, 'nadsalv'); buys.push([t, 'nadsalv']); acted = true; }
      } else if (m.rates.pay < 0.01 || stalledAtp) {
        cells.push({ end: t, dur: t - cellStart, pyr: 0 }); S.newCulture(g); cellStart = t; peak = 0; acted = true;
      }
    } else if (stalledAtp) { cells.push({ end: t, dur: t - cellStart }); S.newCulture(g); cellStart = t; peak = 0; acted = true; }
    if (!acted) {
      const reserve = nadFrac < 0.3 && nadCost <= nadValue ? nadCost : 0;
      // 画面の「次の目標」が研究を指していれば、それを優先して貯める（実際のプレイヤーの行動に近づける）
      const goal = MB.GOALS.find(x => !x.done(g));
      const idPolicy = opts.identify || 'cheap';
      let want = null;
      // 即時同定（解析中の酵素のみ買える）
      const idCand = S.analyzing(g).map(id => S.levelKey(id)).filter(u => S.canBuy(g, u));
      const idPick = idCand.find(u => idPolicy === 'goal' && goal && /同定/.test(goal.text)
                                   || idPolicy !== 'wait' && S.upgradeCost(g, u) <= 0.25 * g.rp);
      if (idPick) { buys.push([t, idPick, 'identify']); S.buy(g, idPick); }
      if (goal && goal.upgrade && S.isAvailable(g, goal.upgrade)) want = [goal.upgrade];
      let pick = null;
      if (want && want.length) {
        const w = want.sort((x, y) => S.upgradeCost(g, x) - S.upgradeCost(g, y))[0];
        if (S.canBuy(g, w)) pick = w;
        else {                                           // 目標の研究が遠すぎなければ、そのために貯める
          const cheap = MB.UPGRADES.filter(u => u.id !== 'nadsalv' && !(u.enzyme && !S.isIdentified(g, u.enzyme)) && S.canBuy(g, u.id) && S.upgradeCost(g, u.id) < 0.15 * S.upgradeCost(g, w));
          if (cheap.length) pick = cheap.sort((x, y) => S.upgradeCost(g, x.id) - S.upgradeCost(g, y.id))[0].id;
        }
      } else {
        const cand = MB.UPGRADES.filter(u => u.id !== 'nadsalv' && !(u.enzyme && (!S.isIdentified(g, u.enzyme) || opts.noEnzUp)) && S.canBuy(g, u.id) && g.rp - S.upgradeCost(g, u.id) >= reserve)
          .sort((x, y) => S.upgradeCost(g, x.id) - S.upgradeCost(g, y.id));
        if (cand.length) pick = cand[0].id;
      }
      if (pick) { buys.push([t, pick]); S.buy(g, pick); }
    }
    S.step(g, 1, { h: H });
    if (opts.onTick) opts.onTick(t, g);
    for (const e of g.events) if (e.type === 'identified') idents.push([t, e.id, e.how]);
    g.events.length = 0;
    for (const id of Object.keys(g.milestones)) if (!(id in marks)) marks[id] = t;
    MB.GOALS.forEach((goal, i) => { const k = 'goal' + i; if (!(k in marks) && goal.done(g)) marks[k] = t; });
  }
  return { g, buys, cells, marks, idents };
}

function report(minutes, opts = {}) {
  const { g, buys, cells, marks, idents } = play(minutes, opts);
  const f = s => s == null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  console.log(`■ 方針：即時同定 = ${opts.identify || 'cheap'}`);
  console.log('■ 目標の到達時刻');
  MB.GOALS.forEach((goal, i) => console.log(`   ${f(marks['goal' + i]).padStart(6)}  ${goal.text}`));
  console.log('■ 酵素の同定（時刻・方法）');
  console.log('   ' + idents.map(([t, id, how]) => `${MB.Sim.reaction(id).abbr} ${f(t)}${how === 'rp' ? '（RP）' : ''}`).join(' → '));
  const res = buys.filter(b => b[1] !== 'nadsalv' && b[2] !== 'identify');
  const enzUp = res.filter(b => /^enz_/.test(b[1]));
  console.log('■ 10分ごと：研究の購入（うち酵素の強化）／即時同定／解析による同定／NAD⁺ 補充／新しい細胞');
  for (let w = 0; w < minutes; w += 10) {
    const inW = x => x[0] >= w * 60 && x[0] < (w + 10) * 60;
    console.log(`   ${String(w).padStart(3)}〜${String(w + 10).padStart(3)}分：研究 ${String(res.filter(inW).length).padStart(2)}（${enzUp.filter(inW).length}）／即時 ${buys.filter(b => b[2] === 'identify').filter(inW).length}／解析 ${idents.filter(x => x[2] === 'flux').filter(inW).length}／補充 ${buys.filter(b => b[1] === 'nadsalv').filter(inW).length}／細胞 ${cells.filter(c => c.end >= w * 60 && c.end < (w + 10) * 60).length}`);
  }
  // 次の「意味のある出来事」（研究の購入・即時同定・解析による同定）までの最長の待ち
  const ev = [...res.map(b => b[0]), ...buys.filter(b => b[2] === 'identify').map(b => b[0]), ...idents.map(x => x[0])].sort((a, b) => a - b);
  let gap = 0, gapAt = 0; for (let i = 1; i < ev.length; i++) if (ev[i] - ev[i - 1] > gap) { gap = ev[i] - ev[i - 1]; gapAt = ev[i - 1]; }
  console.log(`■ 次の意味のある出来事までの最長の待ち：${f(gap)}（${f(gapAt)} から）`);
  console.log(`■ 細胞 ${cells.length} 回：` + cells.slice(0, 12).map(c => f(c.dur)).join(' → ') + (cells.length > 12 ? ' …' : ''));
  console.log(`■ ${minutes} 分後：Pyr 累計 ${g.totals.pyrProduced.toFixed(0)}`);
  console.log('   研究：' + Object.entries(g.levels).filter(([k, v]) => v && k !== 'nadsalv').map(([k, v]) => `${k}:${v}`).join(' '));
  return { g, buys, cells, marks, idents, gap };
}

if (require.main === module) report(+process.argv[2] || 60, { identify: process.argv[3] });
module.exports = { play, report };
