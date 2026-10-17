/* =========================================================================
 * METABOLISM — ui.js（v0.1.0 公開版）
 * 表示層。state を読んで描画し、操作を Sim の関数呼び出しに変換するだけ。
 * 全体表示は MB.Aggregate（集計のみ）、内部表示は state をそのまま読む。
 * どちらの表示も state を書き換えない。
 * ========================================================================= */
(function () {
  'use strict';
  const MB = window.MB, S = MB.Sim, A = MB.Aggregate, G = MB.GLOSSARY, UT = MB.UPGRADE_TEXT;
  const SAVE_KEY = 'metabolism.save.v1';      // 保存場所の名前（0.1 と共通。中身の版は saveVersion で管理）
  const VIEW_KEY = 'metabolism.view';
  const INTRO_KEY = 'metabolism.intro';       // v0.1.0：初回の「遊び方」を出したかどうか
  const VERSION = 'v0.1.1';
  // 開発者向けの機能（画面テスト用の state の窓口、計算の健全性の表示）は ?debug のときだけ有効にする
  const DEBUG = /(^|[?&])debug(=|&|$)/.test(location.search.slice(1));
  const TICK_MS = 100;
  const NS = 'http://www.w3.org/2000/svg';
  const $ = id => document.getElementById(id);
  const SP = MB.SPECIES;
  const R = id => S.reaction(id);

  /* ---------- 書式 ---------- */
  function fmt(x) {
    if (!isFinite(x)) return '—';
    const a = Math.abs(x);
    if (a >= 1e6) return (x / 1e6).toFixed(1) + 'M';
    if (a >= 1e4) return (x / 1e3).toFixed(1) + 'k';
    if (a >= 10) return Math.round(x).toLocaleString('ja-JP');
    if (a >= 0.05) return x.toFixed(1);
    if (a >= 0.0005) return x.toFixed(3);
    return a > 0 ? '微量' : '0';
  }
  function fmt2(x) {
    if (!isFinite(x)) return '—';
    const a = Math.abs(x);
    if (a >= 1e4) return Math.round(x).toLocaleString('ja-JP');
    if (a >= 100) return x.toFixed(1);
    if (a >= 0.01 || a === 0) return x.toFixed(2);
    return x.toExponential(1);
  }
  const signed = x => (Math.abs(x) < 0.005 ? '±0' : (x > 0 ? '+' : '') + fmt2(x));
  function fmtTime(sec) {
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    const p = n => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
  }
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- 保存 ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) { const s = S.deserialize(raw); if (s) return s; }
    } catch (e) { /* 保存できない環境ではメモリ上のみ */ }
    return S.createState();
  }
  function save(silent) {
    try { localStorage.setItem(SAVE_KEY, S.serialize(state)); if (!silent) toast('保存しました'); }
    catch (e) { if (!silent) toast('この環境では保存できません'); }
  }
  let toastTimer = null;
  /* 通知：文の長さに応じて表示時間を延ばす（1文字あたり約0.1秒、2.5〜12秒）。タップで閉じる。
   * 研究の効果など長い通知は、記録タブにも同じ内容が残る。 */
  function toast(msg) {
    const el = $('toast'); el.textContent = msg; el.classList.add('show'); el.classList.toggle('long', msg.length > 30);
    const ms = Math.min(12000, Math.max(2500, 1500 + msg.length * 100));
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }
  $('toast').addEventListener('click', () => { clearTimeout(toastTimer); $('toast').classList.remove('show'); });

  let state = load();
  const caught = S.catchUp(state, Date.now());
  if (caught > 0) setTimeout(() => toast(`留守のあいだの ${fmtTime(caught)} を進めました`), 400);

  /* ---------- 説明カード（下から出るシート） ---------- */
  function openSheet(title, html) {
    $('sheet-title').textContent = title;
    $('sheet-body').innerHTML = html;
    $('sheet').hidden = false; $('sheet-bg').hidden = false;
  }
  function openTerm(key) {
    const t = G[key]; if (!t) return;
    openSheet(t.title, esc(t.body));
  }
  function closeSheet() { $('sheet').hidden = true; $('sheet-bg').hidden = true; }
  $('sheet-close').addEventListener('click', closeSheet);
  $('sheet-bg').addEventListener('click', closeSheet);
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-term]');
    if (t) { e.stopPropagation(); e.preventDefault(); openTerm(t.getAttribute('data-term')); return; }
    const z = e.target.closest('[data-enzyme]');
    if (z) { e.stopPropagation(); e.preventDefault(); openEnzyme(z.getAttribute('data-enzyme')); }
  }, true);

  function equation(r) {
    const L = [], Rt = [];
    for (const [s, c] of Object.entries(r.stoich)) {
      const t = (Math.abs(c) === 1 ? '' : Math.abs(c) + ' ') + SP[s].abbr;
      (c < 0 ? L : Rt).push(t);
    }
    return `${L.join(' + ')} ${r.thermo && r.thermo.reversible ? '⇌' : '→'} ${Rt.join(' + ')}`;
  }
  function openEnzyme(id) {
    const r = R(id), lv = state.levels[S.levelKey(id)] || 0;
    if (lv < 1) return;
    const K = S.kGame(id);
    if (r.protein === 'transporter') { openTransporter(id, r, lv, K); return; }
    const rows = [
      ['はたらき', MB.ENZYME_TEXT[id]],
      ['反応式', equation(r)],
      ['向き', r.thermo.reversible ? '可逆（細胞の中では平衡に近い状態で働く）' : '不可逆（細胞の中ではほぼ一方向）'],
      ['ΔG°′（教科書値）', `${r.thermo.dG0 > 0 ? '+' : ''}${r.thermo.dG0} kJ/mol` + (r.thermo.dG0Note === 'enolase' ? '\n教材基準値 +1.7 を暫定採用。文献により +1.7〜+7.5 と記載が分かれ、2020 年の実験研究では −2.8 ± 0.2 kJ/mol と報告されている。' : '')],
    ];
    if (id === 'ldh') {
      rows.push(['この版での扱い（簡略化）', 'H⁺ は一定とみなすため、計算上は Pyruvate + NADH ⇄ Lactate + NAD⁺ として扱う（H⁺ の寄与は ΔG°′ に含まれる）。\n平衡は乳酸側に大きく偏るが、細胞内 pH・乳酸の輸送・細胞外の乳酸濃度はまだモデル化していないため、実際の細胞の LDH 平衡を再現するものではない。\n乳酸は細胞の中に溜まる（出口は未実装）。溜まるほど逆向きの力がかかり、LDH は少しずつ進みにくくなる。']);
      rows.push(['NAD⁺ の収支', 'LDH は NADH 1 個を NAD⁺ 1 個に戻すだけで、NAD⁺ と NADH の合計は変わらない（新しくつくるのではなく再生）。']);
    }
    if (K != null) rows.push(['ゲーム内の平衡定数 K_game', `${K.toPrecision(3)}` + (r.thermo.keqDim === 'M' ? ' u（1 u = 0.1 mM で換算）' : r.thermo.keqDim === 'perM_pi' ? '（無機リン酸 1 mM を繰り込み）' : '') + `\n現在の Q / K_game = ${fmt2(S.massActionRatio(id, state) / K)}（1 に近いほど平衡に近い）`]);
    if (r.regulation && r.regulation.length) rows.push(['調節（実装済み・実在）', r.regulation.map(g => g.note).join('\n')]);
    if (r.notImplemented && r.notImplemented.length) rows.push(['実在するが、この版では省略している調節', r.notImplemented.join('、')]);
    rows.push(['研究', `Lv ${lv}（最大速度 ${fmt2(S.vmax(state, r))} u/秒）`]);
    openSheet(`${r.step ? r.step + '. ' : ''}${r.name}（${r.abbr}）`, '<dl>' + rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') + '</dl>');
  }

  /* 輸送体（0.4 MCT）のカード：酵素とは別の書き方（反応式ではなく輸送の式、ΔG°′ ではなく輸送の平衡） */
  function openTransporter(id, r, lv, K) {
    const E = MB.ENVIRONMENT, f = state.flux[id] || 0;
    const rows = [
      ['分類', '輸送体（輸送タンパク質）。酵素ではない：物質を別の物質に変えず、細胞膜の内と外のあいだで運ぶ'],
      ['はたらき', MB.ENZYME_TEXT[id]],
      ['輸送の式', '乳酸⁻ + H⁺（細胞の中） ⇄ 乳酸⁻ + H⁺（細胞の外）\n乳酸と H⁺ を 1:1 で一緒に運ぶ（共輸送）。電荷は打ち消し合う（電気的に中性）'],
      ['向き', '双方向。正味の輸送方向は、細胞内外の乳酸濃度と H⁺ 勾配によって決まり、外へも中へも運ぶ。ATP は使わない\nいまの正味の向き：' + (Math.abs(f) < 0.005 ? 'ほぼ 0' : f > 0 ? `外へ ${fmt2(f)} /秒` : `中へ ${fmt2(-f)} /秒（細胞の外のほうが多い）`)],
      ['輸送の平衡（この版での扱い）', `[乳酸]外 / [乳酸]内 ＝ [H⁺]内 / [H⁺]外 ＝ 10^(pH外 − pH内)\npH は細胞内 ${E.pHin}・細胞外 ${E.pHout} で一定とみなす → K = ${K.toPrecision(3)}\n細胞の外の体積は細胞の中と同じとみなす（量の比 ＝ 濃度の比）\n現在の Q / K = ${fmt2(S.massActionRatio(id, state) / K)}（1 未満なら外向き、1 を超えると中向き）`],
      ['アイソフォーム', 'MCT1〜MCT4 などがある。このゲームの数値は MCT4 を参考にしている。MCT4 は解糖活性の高い細胞で乳酸の排出に関与することが多いが、輸送自体は双方向性である（乳酸への親和性が低く、多くを運べる。低酸素で発現が増える）\nKm（乳酸）250 u・Vmax はゲーム上の値（u はゲーム独自の単位で、実際の乳酸濃度ではない）\nMCT1 は親和性が高く、乳酸を取り込む細胞で多く働くことが多い（まだ扱わない）'],
      ['実在するが、この版では省略しているもの', r.notImplemented.join('、')],
      ['研究', `Lv ${lv}（最大速度 ${fmt2(S.vmax(state, r))} u/秒）`]
    ];
    openSheet(`輸送体：${r.name}（${r.abbr}）`, '<dl>' + rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') + '</dl>');
  }

  /* ---------- タブ ---------- */
  let tab = 'cell', seenLog = state.log.length;
  let view = (() => { try { return localStorage.getItem(VIEW_KEY) || 'macro'; } catch (e) { return 'macro'; } })();
  function showTab(name) {
    tab = name;
    for (const id of ['cell', 'research', 'log', 'detail']) $('tab-' + id).hidden = id !== name;
    document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    $('feed').hidden = name !== 'cell';
    if (name === 'log') seenLog = state.log.length;
    window.scrollTo(0, 0);
    render(0);
  }
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

  /* 表示の切り替え：見る場所を変えるだけで、state には触れない */
  function setView(v) {
    view = v;
    try { localStorage.setItem(VIEW_KEY, v); } catch (e) {}
    render(0);
  }
  document.querySelectorAll('#viewswitch [data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

  /* ---------- 全体表示（流れ図） ---------- */
  const flowEls = {};
  function el(tag, attrs, parent, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function buildFlow() {
    const svg = $('flow');
    svg.setAttribute('viewBox', '0 0 320 414');
    const X = 105, W = 150, H = 56;
    const node = (key, y, name, opts = {}) => {
      const g = el('g', { class: 'node lit' + (opts.tap ? ' tap' : '') }, svg);
      el('rect', { x: X - W / 2, y, width: W, height: H, rx: 8 }, g);
      el('text', { x: X, y: y + 20, class: 'n-name' }, g, name);
      flowEls[key] = el('text', { x: X, y: y + 45, class: 'n-val' }, g, '0');
      if (opts.term) g.setAttribute('data-term', opts.term);
      return g;
    };
    const pipe = (key, y1, y2, label, term, chips) => {
      el('line', { x1: X, y1, x2: X, y2: y2 - 8, class: 'pipe' }, svg);
      const fl = el('line', { x1: X, y1, x2: X, y2: y2 - 8, class: 'flow off' }, svg);
      const hd = el('path', { d: `M${X - 7},${y2 - 10} L${X + 7},${y2 - 10} L${X},${y2} Z`, class: 'head off' }, svg);
      const lx = X + 22;
      el('text', { x: lx, y: y1 + 22, class: 's-name term-hit', 'data-term': term }, svg, label + ' ⓘ');
      const rt = el('text', { x: lx, y: y1 + 38, class: 's-rate' }, svg, '');
      chips.forEach((c, i) => el('text', { x: lx, y: y1 + 54 + i * 15, class: c[0] }, svg, c[1]));
      const mid = el('text', { x: lx, y: y1 + 54 + chips.length * 15, class: 's-rate term-hit', 'data-term': 'mid' }, svg, '');
      flowEls[key] = { fl, hd, rt, mid, off: 0 };
    };
    const glc = node('glc', 6, 'グルコース（タップ）', { tap: true });
    glc.addEventListener('click', feed);
    pipe('prep', 62, 164, '準備期', 'prep', [['chip-atp', 'ATP 2個を投資']]);
    node('tp', 164, '三炭糖リン酸 ⓘ', { term: 'tp' });
    pipe('pay', 220, 330, '回収期', 'pay', [['chip-atp', 'ATP 4個を回収'], ['chip-nad', 'NAD⁺ 2個 → NADH']]);
    node('pyr', 330, 'ピルビン酸 ⓘ', { term: 'pyr' });
    // ピルビン酸の行き先（0.3：未解放 → 解析中 → 乳酸）
    const ul = el('line', { x1: X + W / 2, y1: 358, x2: 238, y2: 358, class: 'unknown-line' }, svg);
    const lab = el('text', { x: 209, y: 351, class: 'lac-enz' }, svg, '');
    const lab2 = el('text', { x: 209, y: 373, class: 'lac-co' }, svg, '');
    const u = el('g', { class: 'unknown' }, svg);
    el('rect', { x: 238, y: 336, width: 76, height: 44, rx: 6 }, u);
    const u1 = el('text', { x: 276, y: 354 }, u, '？');
    const u2 = el('text', { x: 276, y: 371 }, u, '未解放');
    flowEls.dest = { line: ul, g: u, t1: u1, t2: u2, lab, lab2, mode: '' };
    el('text', { x: 6, y: 404, class: 'note', 'text-anchor': 'start' }, svg, '※ ATP などの個数は、グルコース1個あたり');
    // 0.4：細胞膜と細胞の外（MCT を同定すると現れる。操作はできない）
    const ex = el('g', { class: 'exzone', visibility: 'hidden' }, svg);
    el('line', { x1: 150, y1: 434, x2: 318, y2: 434, class: 'mem' }, ex);
    el('line', { x1: 150, y1: 439, x2: 318, y2: 439, class: 'mem' }, ex);
    el('text', { x: 152, y: 429, class: 'mem-l' }, ex, '細胞膜');
    el('line', { x1: 276, y1: 382, x2: 276, y2: 462, class: 'pipe' }, ex);
    const efl = el('line', { x1: 276, y1: 382, x2: 276, y2: 462, class: 'flow lacflow' }, ex);
    const ehd = el('path', { d: 'M269,460 L283,460 L276,470 Z', class: 'head lachead' }, ex);
    el('text', { x: 286, y: 412, class: 'lac-enz mct-l' }, ex, 'MCT');   // v0.1.1：CSS の中央寄せで矢印の線（x=276）に重なっていたので、左寄せ（.mct-l）にして線の右に置く
    const elab = el('text', { x: 152, y: 458, class: 'ex-l' }, ex, 'EXTRACELLULAR');
    elab.setAttribute('data-term', 'extracellular');
    const eval_ = el('text', { x: 152, y: 474, class: 'ex-v', 'text-anchor': 'start' }, ex, '');
    flowEls.ex = { g: ex, fl: efl, hd: ehd, v: eval_, off: 0, on: false };
  }
  function feed() {
    const n = S.addGlucose(state);
    if (view === 'macro' || !(state.levels.micro >= 1)) {
      const t = el('text', { x: 105, y: 40, class: 'pop' }, $('flow'), '+' + n);
      requestAnimationFrame(() => { t.style.transform = 'translateY(-26px)'; t.style.opacity = '0'; });
      setTimeout(() => t.remove(), 900);
    }
    render(0);
  }
  $('btn-glc').addEventListener('click', feed);

  function renderFlow(dt, m) {
    flowEls.glc.textContent = fmt(m.pools.glc);
    flowEls.tp.textContent = fmt(m.pools.tp);
    flowEls.pyr.textContent = fmt(m.pools.pyr);
    for (const key of ['prep', 'pay']) {
      const f = m.rates[key], e = flowEls[key], st = m[key];
      const stopped = st.kind === 'stopped';
      const cls = stopped ? 'stop' : f > 0.005 ? '' : 'off';
      e.fl.setAttribute('class', 'flow ' + cls);
      e.hd.setAttribute('class', 'head ' + cls);
      // 速さは、実際に出入りする物質で表示する（準備期：取り込まれるグルコース、回収期：できるピルビン酸）
      const shown = key === 'prep' ? `グルコース ${fmt2(f)} /秒` : `ピルビン酸 ${fmt2(state.flux.pk || 0)} /秒`;
      e.rt.textContent = stopped ? '停止中' : f > 0.005 ? shown : '待機中';
      const midAmt = key === 'prep' ? m.pools.prepMid : m.pools.payMid;
      e.mid.textContent = `中間体 ${fmt(midAmt)} ⓘ`;
      if (f > 0.005) { e.off -= Math.min(6, 2 + f * 3) * dt * 6; e.fl.style.strokeDashoffset = e.off; }
    }
    renderDest();
    renderExFlow(dt);
  }
  function renderExFlow(dt) {
    const e = flowEls.ex, on = S.isIdentified(state, 'mct');
    if (on !== e.on) {
      e.on = on;
      e.g.setAttribute('visibility', on ? 'visible' : 'hidden');
      $('flow').setAttribute('viewBox', on ? '0 0 320 484' : '0 0 320 414');
    }
    if (!on) return;
    const f = state.flux.mct || 0, off = state.switches && state.switches.mctOff;
    const cls = off ? 'stop' : Math.abs(f) > 0.005 ? '' : 'off';
    e.fl.setAttribute('class', 'flow lacflow ' + cls); e.hd.setAttribute('class', 'head lachead ' + cls + (f < -0.005 ? ' rev' : ''));
    if (Math.abs(f) > 0.005) { e.off -= Math.sign(f) * Math.min(6, 2 + Math.abs(f)) * dt * 6; e.fl.style.strokeDashoffset = e.off; }
    e.v.textContent = `乳酸 ${fmt(state.amounts.lacOut)}`;
  }
  function renderDest() {
    const d = flowEls.dest, ided = S.isIdentified(state, 'ldh'), anz = S.analyzing(state).includes('ldh');
    const mode = ided ? 'lac' : anz ? 'anz' : 'locked';
    if (mode !== d.mode) {
      d.mode = mode;
      d.g.setAttribute('class', mode === 'lac' ? 'dest lac' : mode === 'anz' ? 'unknown anz' : 'unknown');
      d.line.setAttribute('class', mode === 'lac' ? 'lac-line' : 'unknown-line');
      if (mode === 'lac') d.g.setAttribute('data-term', 'lac'); else d.g.removeAttribute('data-term');
      d.lab.textContent = mode === 'lac' ? 'LDH' : '';
    }
    if (mode === 'lac') {
      const off = state.switches && state.switches.ldhOff;
      d.t1.textContent = '乳酸 ⓘ'; d.t2.textContent = fmt(state.amounts.lac);
      d.lab2.textContent = off ? '停止中' : 'NAD⁺ 再生';
      d.lab2.setAttribute('class', off ? 'lac-co off' : 'lac-co');
    } else if (mode === 'anz') {
      d.t1.textContent = '？'; d.t2.textContent = `解析中 ${Math.floor(S.analysisProgress(state, 'ldh') * 100)}%`; d.lab2.textContent = '';
    } else { d.t1.textContent = '？'; d.t2.textContent = '未解放'; d.lab2.textContent = ''; }
  }

  /* ---------- 内部表示（10の酵素） ---------- */
  const CHAIN = [
    { met: ['glc'] }, { enz: 'hk' }, { met: ['g6p'] }, { enz: 'pgi' }, { met: ['f6p'] }, { enz: 'pfk' },
    { met: ['f16bp'] }, { enz: 'aldo' }, { met: ['dhap', 'gap'] }, { enz: 'tpi' }, { enz: 'gapdh' },
    { met: ['bpg13'] }, { enz: 'pgk' }, { met: ['pg3'] }, { enz: 'pgam' }, { met: ['pg2'] }, { enz: 'eno' },
    { met: ['pep'] }, { enz: 'pk' }, { met: ['pyr'] },
    { enz: 'ldh', branch: true, after: 'nadregen' }, { met: ['lac'], branch: true, after: 'nadregen' },      // 0.3：ピルビン酸からの分岐
    { enz: 'mct', branch: true, after: 'lacexit', tr: true }, { met: ['lacOut'], branch: true, after: 'lacexit', ext: true }   // 0.4：細胞膜を越える
  ];
  const termOf = id => id === 'lacOut' ? 'extracellular' : id;
  const COFACTOR = {
    hk: [['co-atp', 'ATP → ADP']], pfk: [['co-atp', 'ATP → ADP']], gapdh: [['co-nad', 'NAD⁺ → NADH']],
    pgk: [['co-atp', 'ADP → ATP']], pk: [['co-atp', 'ADP → ATP']], tpi: [['', 'DHAP → GAP']],
    ldh: [['co-nad', 'NADH → NAD⁺（再生）']],
    mct: [['co-tr', '乳酸 + H⁺ を細胞膜の向こうへ']]
  };
  const chainEls = [];
  function buildChain() {
    const ol = $('chain');
    CHAIN.forEach((c, i) => {
      const li = document.createElement('li');
      if (c.met) {
        li.className = 'met' + (c.met.length > 1 ? ' pair' : '') + (c.branch ? ' branch' : '') + (c.ext ? ' ext' : '');
        li.innerHTML = c.met.map(id => `<span><span class="nm" data-term="${termOf(id)}">${SP[id].abbr}</span> <span class="v"></span></span>`).join('');
      } else {
        li.className = 'enz' + (c.branch ? ' branch' : '') + (c.tr ? ' tr' : '');
        li.innerHTML = `<div class="row1"><span class="no">${R(c.enz).step || (c.tr ? '膜' : '分岐')}</span><span class="en"></span><span class="bd"></span><span class="rate"></span></div>` +
          `<div class="row2"></div><div class="st"></div>`;
      }
      ol.appendChild(li);
      chainEls.push({ c, li });
    });
  }
  const unlocked = id => S.isIdentified(state, id);
  function enzymeState(id) {
    const r = R(id), l = state.limit[id] || {}, a = state.amounts;
    if ((id === 'ldh' || id === 'mct') && state.switches && state.switches[id + 'Off']) return ['warn', '一時停止中（比較のため）'];
    if (id === 'mct') {
      const f = state.flux.mct || 0, q = l.ratio;
      const qs = isFinite(q) ? `Q/K = ${q < 0.01 ? q.toExponential(1) : q.toFixed(2)}` : '';
      return ['eq', Math.abs(f) < 0.005 ? `正味の輸送ほぼなし ${qs}` : f > 0 ? `細胞の外へ（排出） ${qs}` : `細胞の中へ（取り込み） ${qs}`];
    }
    if (r.thermo.reversible) {
      const q = l.ratio;
      if (id === 'gapdh' && a.nad / (a.nad + a.nadh) < 0.02) return ['warn', 'NAD⁺ がほぼない'];
      if (!isFinite(q)) return ['', ''];
      if (q > 0.999 && q < 1.001) return ['eq', `平衡（正味の流れほぼなし） Q/K = ${q.toFixed(3)}`];
      if (q < 1) return ['eq', `前向き・平衡に近い Q/K = ${q < 0.01 ? q.toExponential(1) : q.toFixed(3)}`];
      return ['eq', `逆向き Q/K = ${q.toFixed(2)}`];
    }
    if (l.kind === 'depleted') return ['warn', `${SP[l.species].abbr} 不足で停止`];
    if (l.kind === 'regulated') return ['reg', `G6P による抑制（速さ ${Math.round(l.factor * 100)}%）`];
    if (l.kind === 'substrate') return ['', `${SP[l.species].abbr} が足りない（飽和度 ${Math.round(l.sat * 100)}%）`];
    return ['', '酵素量が上限（研究で速くできる）'];
  }
  function renderChain() {
    for (const { c, li } of chainEls) {
      if (c.branch) {                       // 分岐（LDH・乳酸／MCT・細胞外の乳酸）は、それぞれの研究をするまで出さない
        li.hidden = !((state.levels[c.after] || 0) >= 1);
        if (li.hidden) continue;
      }
      if (c.met) {
        const vis = c.met.map(id => id === 'glc' || id === 'pyr' || CHAIN.some((x, j) => x.enz && unlocked(x.enz) && Math.abs(j - CHAIN.indexOf(c)) === 1) || (id === 'gap' && unlocked('gapdh')) || (id === 'dhap' && unlocked('tpi')) || (id === 'gap' && unlocked('tpi')));
        li.classList.toggle('hidden', !vis.some(Boolean));
        li.querySelectorAll('.v').forEach((v, k) => { v.textContent = vis[k] ? fmt(state.amounts[c.met[k]]) : '？'; });
        li.querySelectorAll('.nm').forEach((n, k) => { n.textContent = vis[k] ? SP[c.met[k]].abbr : '？？？'; if (vis[k]) n.setAttribute('data-term', termOf(c.met[k])); else n.removeAttribute('data-term'); });
        continue;
      }
      const id = c.enz, r = R(id), on = unlocked(id);
      li.classList.toggle('on', on); li.classList.toggle('locked', !on);
      if (on) li.setAttribute('data-enzyme', id); else li.removeAttribute('data-enzyme');
      const anz = !on && S.analyzing(state).includes(id);
      li.classList.toggle('analyzing', anz);
      li.querySelector('.en').textContent = on ? `${r.name}（${r.abbr}）` : anz ? `${r.protein === 'transporter' ? '輸送体 ' : ''}？？？　解析中 ${Math.floor(S.analysisProgress(state, id) * 100)}%` : '？？？';
      li.querySelector('.bd').innerHTML = on
        ? r.protein === 'transporter' ? '<span class="badge-tr">輸送体</span> <span class="badge-rev">双方向</span>'
        : (r.thermo.reversible ? '<span class="badge-rev">可逆</span>' : '<span class="badge-irrev">不可逆</span>') + (r.regulation ? ' <span class="badge-reg">調節</span>' : '')
        : '';
      li.querySelector('.rate').textContent = on ? `${fmt2(state.flux[id] || 0)} u/秒` : '';
      li.querySelector('.row2').innerHTML = on ? (COFACTOR[id] || []).map(([cl, t]) => `<span class="${cl}">${t}</span>`).join(' ')
        : anz ? `<span class="anz"><i style="width:${S.analysisProgress(state, id) * 100}%"></i></span>` + (id === 'ldh' ? '<span class="anz-note">ピルビン酸の行き先を解析中</span>' : id === 'mct' ? '<span class="anz-note">乳酸が細胞膜を越えられるかを解析中</span>' : '') : '隣の酵素が同定されると解析が始まる';
      const [cls, txt] = on ? enzymeState(id) : ['', ''];
      const st = li.querySelector('.st'); st.className = 'st ' + cls; st.textContent = txt;
      li.classList.toggle('stop', on && cls === 'warn');
    }
  }

  /* ---------- ゲージ ---------- */
  function renderGauges() {
    const a = state.amounts;
    const tA = a.atp + a.adp, tN = a.nad + a.nadh;
    $('g-atp').style.width = (tA ? a.atp / tA * 100 : 0) + '%';
    $('g-nad').style.width = (tN ? a.nad / tN * 100 : 0) + '%';
    $('g-atp-v').textContent = tA ? 'ATP の割合 ' + Math.round(a.atp / tA * 100) + '%' : '';
    $('g-nad-v').textContent = tN ? 'NAD⁺ の割合 ' + Math.round(a.nad / tN * 100) + '%' : '';
    $('g-atp-n').textContent = fmt(a.atp); $('g-adp-n').textContent = fmt(a.adp);
    $('g-nad-n').textContent = fmt(a.nad); $('g-nadh-n').textContent = fmt(a.nadh);
    $('earn-rate').textContent = fmt2((state.flux[S.ECON.rpSource] || 0) * S.ECON.rpPerExtent);
    renderRegen();
    renderLac();
  }
  /* 乳酸の出入りと細胞の外（0.4）。LDH を同定すると現れ、MCT を同定すると排出と EXTRACELLULAR が加わる */
  function renderLac() {
    const on = S.isIdentified(state, 'ldh');
    $('lacpanel').hidden = !on; if (!on) return;
    const mct = S.isIdentified(state, 'mct'), off = !!(state.switches && state.switches.mctOff);
    const make = state.flux.ldh || 0, ex = state.flux.mct || 0, e = state.totals.extent;
    $('lp-in').textContent = fmt(state.amounts.lac);
    $('lp-make').textContent = fmt2(make);
    document.querySelectorAll('#lacpanel .mct-only').forEach(x => { x.hidden = !mct; });
    $('extra').hidden = !mct; $('lp-off').hidden = !(mct && off);
    $('legend-tr').hidden = !mct;
    if (mct) {
      $('lp-exp-k').textContent = ex < -0.005 ? '取り込み（MCT）' : '排出（MCT）';
      $('lp-exp').textContent = fmt2(Math.abs(ex));
      $('lp-cum').textContent = fmt(Math.max(0, e.mct || 0));
      $('ex-lac').textContent = fmt(state.amounts.lacOut);
      $('ex-gone').textContent = fmt(e.lac_clear || 0);
      const dots = $('mb-dots');
      dots.className = 'mb-dots' + (off || Math.abs(ex) < 0.01 ? ' still' : ex < 0 ? ' in' : '');
      dots.style.setProperty('--dur', (Math.max(0.6, Math.min(4, 6 / Math.max(0.5, Math.abs(ex))))).toFixed(2) + 's');
    }
    const b = S.balanceStatus(state);
    $('lp-hint').textContent = !mct
      ? (state.amounts.lac >= 100 ? '乳酸の出口（細胞膜の輸送）は、まだ解放されていない。細胞の中にたまり続けている' : '')
      : off ? 'MCT を止めているので、乳酸はふたたび細胞の中にたまっていく'
      : ex < -0.005 ? 'いまは MCT が乳酸を中へ運んでいる。正味の向きは細胞内外の乳酸濃度と H⁺ 勾配で決まり、MCT は両方向に運ぶ'
      : b ? `生成と排出がつり合っている（${fmtTime(b.seconds)}）` : (make > 0 && ex > make * 1.05 ? 'たまっていた乳酸が外へ出ていき、細胞の中の乳酸が減っている' : '');
  }

  /* NAD⁺ の循環（0.3）：GAPDH の正味の速さ（NAD⁺ → NADH）と LDH の正味の速さ（NADH → NAD⁺）を並べる */
  function renderRegen() {
    const on = S.isIdentified(state, 'ldh');
    $('regen').hidden = !on; if (!on) return;
    const off = !!(state.switches && state.switches.ldhOff);
    $('rg-use').textContent = fmt2(state.flux.gapdh || 0);
    $('rg-back').textContent = fmt2(state.flux.ldh || 0);
    $('rg-off').hidden = !off;
    $('regen').classList.toggle('off', off);
    const g = S.regenStatus(state);
    $('rg-time').textContent = g ? fmtTime(g.seconds) : '—';
    $('rg-refill').textContent = state.knowledge.regen.refillsAfter;
  }

  /* ---------- 状態のひとこと ---------- */
  function payMaterial(m) {          // 回収期に回せる物質（炭素3個の単位）
    return 2 * state.amounts.f16bp + m.pools.tp + m.pools.payMid;
  }
  function diagnose(m) {
    const a = state.amounts, tN = a.nad + a.nadh, nadFrac = tN ? a.nad / tN : 0;
    if (a.atp < 0.5 && a.glc > 1 && m.rates.prep < 0.005)
      return { lv: 'bad', stall: 'atp', text: 'ATP が尽きて準備期が止まりました' };
    if (m.pay.kind === 'stopped' && m.pay.reason === 'nad' && payMaterial(m) > 1)
      return { lv: 'bad', stall: 'nad', text: 'NAD⁺ がほぼ尽きて回収期が止まりました' };
    if (m.pay.kind === 'slowing')
      return { lv: 'caution', stall: 'slow', text: `NADH が溜まり、回収期が遅くなっています（NAD⁺ の割合 ${Math.round(nadFrac * 100)}%）ⓘ`, term: 'nadh' };
    if (a.atp < 10 && m.rates.prep > 0)
      return { lv: 'caution', text: 'ATP が減っています。細胞の仕事に使いすぎかもしれません' };
    if (m.prep.kind === 'regulated' && m.prep.factor < 0.5)
      return { lv: 'caution', text: 'G6P が溜まり、ヘキソキナーゼが抑えられています（実在の調節）ⓘ', term: 'hkreg' };
    if (a.adp < 3 && a.atp > 90 && payMaterial(m) > 20)
      return { lv: 'caution', text: 'ATP がほぼ満タンで、回収期が ADP 不足で進みにくく、中間体が溜まっています（PFK-1 の調節を省略したこのモデルでの挙動）ⓘ', term: 'reg' };
    if (a.glc < 1 && (state.levels.glut || 0) === 0)
      return { lv: 'idle', text: state.totals.glcSupplied ? 'グルコースが空です。下のボタンで追加しましょう' : '下のボタンでグルコースを入れてみましょう' };
    const regen = S.isIdentified(state, 'ldh') && !(state.switches && state.switches.ldhOff) && (state.flux.ldh || 0) > 0.01;
    if (a.glc < 1) return { lv: 'good', text: 'グルコースの取り込みが追いつかないほど順調です' };
    const exporting = S.isIdentified(state, 'mct') && !(state.switches && state.switches.mctOff) && (state.flux.mct || 0) > 0.01;
    if (regen && exporting) return { lv: 'good', text: 'NAD⁺ を再生し、乳酸を細胞の外へ運びながら回っています ⓘ', term: 'lacbal' };
    if (regen && !S.isIdentified(state, 'mct') && a.lac >= 1000) return { lv: 'good', text: 'NAD⁺ を再生しながら回っています。乳酸は細胞の中にたまり続けています ⓘ', term: 'lac' };
    if (regen) return { lv: 'good', text: 'NAD⁺ を再生しながら、順調に回っています ⓘ', term: 'nadcycle' };
    return { lv: 'good', text: '順調に回っています' };
  }
  /* 停止時の説明：補充で必ず再開できるとは断定しない。ATP 枯渇は「このゲームのモデルでの挙動」として説明する */
  /* NADH を NAD⁺ に戻す経路の状況（0.3）。嫌気的条件：酸素を利用した再酸化はこの細胞ではまだ使えない */
  function regenSituation() {
    if (S.isIdentified(state, 'ldh')) {
      if (state.switches && state.switches.ldhOff) return 'いまは比較のために乳酸デヒドロゲナーゼ（LDH）を一時停止しているため、NADH が NAD⁺ に戻りません。研究タブで LDH を再開できます。';
      if ((state.flux.ldh || 0) > 1.05 * Math.max(0, state.flux.gapdh || 0)) return '乳酸デヒドロゲナーゼ（LDH）が NADH を NAD⁺ に戻しはじめています。NAD⁺ が戻るまで、少し様子を見てみましょう。';
      return '乳酸デヒドロゲナーゼ（LDH）が NADH を NAD⁺ に戻していますが、再生が追いついていません。LDH を強化すると、再生が速くなる場合があります。';
    }
    if (S.analyzing(state).includes('ldh')) return 'この細胞は嫌気的条件で、酸素を利用した NADH の再酸化は使えません。NADH を NAD⁺ に戻す経路は、ピルビン酸の行き先として解析中です。';
    return 'この細胞は嫌気的条件で、酸素を利用した NADH の再酸化は使えません。NADH を NAD⁺ に戻す経路は、まだ解放されていません。';
  }
  function stallMessage(kind, m) {
    const a = state.amounts, tN = a.nad + a.nadh, nadFrac = tN ? a.nad / tN : 0;
    if (kind === 'slow') {
      return 'NADH が溜まり、GAP デヒドロゲナーゼの反応が平衡に近づいたため、回収期が遅くなっています（質量作用による）。' + regenSituation() +
        '\nNAD⁺ を補充すると少し速さが戻る場合がありますが、補充の価格はこの細胞で買うたびに上がります。新しい細胞にすると、研究と研究ポイントはそのままで、NAD⁺ も補充の価格も最初の状態に戻ります。';
    }
    if (kind === 'nad') {
      return 'NAD⁺ がほぼすべて NADH になり、回収期が止まりました。' + regenSituation() +
        (a.atp < 0.5
          ? '\nATP も尽きているため、NAD⁺ を補充して回収期が動いても、準備期まで再開できるとは限りません。'
          : '\nこのゲームのモデルでは、回収期が止まっても準備期と細胞の仕事は ATP を使い続けるため、このままでは ATP も尽きていきます。NAD⁺ を補充すると、回収期が再び動く場合があります。');
    }
    if (payMaterial(m) >= 1 && a.adp >= 1) {
      return 'ATP がすべて ADP になり、準備期の「投資」ができません（このゲームのモデルでの挙動）。' +
        (nadFrac >= 0.02
          ? '\nまだ回収期に回せる物質が残っているので、回収期が進めば ATP が少し戻る可能性があります。'
          : '\n回収期に回せる物質は残っていますが、NAD⁺ もほとんどないため回収期も止まっています。NAD⁺ を補充すると、回収期が動いて ATP が戻る場合があります。ただし、準備期が再開できるかは ATP の戻り具合によります。');
    }
    return 'ATP がすべて ADP になり、準備期の「投資」ができません。回収期に回せる物質も残っていないため、この細胞は再開できません。新しい細胞で再開してください。';
  }
  function renderStatus(d, m) {
    const st = $('status');
    st.className = 'status ' + d.lv;
    $('status-text').textContent = d.text;
    if (d.term) st.setAttribute('data-term', d.term); else st.removeAttribute('data-term');
    st.classList.toggle('term', !!d.term);
    const box = $('stall');
    box.hidden = !d.stall;
    box.classList.toggle('soft', d.stall === 'slow');
    if (d.stall) {
      $('stall-text').textContent = stallMessage(d.stall, m);
      const b = $('btn-stall-nad');
      b.hidden = d.stall === 'atp' && payMaterial(m) < 1;      // 補充しても回収期に回すものがない
      b.textContent = `NAD⁺ を補充（${S.upgradeCost(state, 'nadsalv').toLocaleString('ja-JP')} RP・この細胞で ${(state.cell.nadBought || 0) + 1} 回目）`;
      b.disabled = !S.canBuy(state, 'nadsalv');
    }
  }

  /* ---------- 次の目標 ---------- */
  function renderGoal() {
    const g = MB.GOALS.find(g => !g.done(state)) || MB.GOALS[MB.GOALS.length - 1];
    $('goal-text').textContent = g.text;
    $('goal-hint').textContent = typeof g.hint === 'function' ? g.hint(state) : (g.hint || '');
    let p = 0;
    if (g.upgrade) p = S.isAvailable(state, g.upgrade) ? state.rp / S.upgradeCost(state, g.upgrade) : 0;
    else if (g.progress) p = g.progress(state);
    $('goal-bar').style.width = Math.max(0, Math.min(1, p)) * 100 + '%';
  }

  /* ---------- 研究 ---------- */
  const upgEls = {};
  function upgText(u) {
    if (u.enzyme) { const r = R(u.enzyme); return { name: `${r.step ? r.step + '. ' : ''}${r.name}（${r.abbr}）`, line: MB.ENZYME_TEXT[u.enzyme] }; }
    return UT[u.id] || { name: u.name, line: u.desc };
  }
  function buildUpgrades() {
    for (const u of MB.UPGRADES) {
      const t = upgText(u);
      const box = u.id === 'lacexit' || u.enzyme === 'mct' ? $('upgrades-tr') : u.id === 'nadregen' || u.enzyme === 'ldh' ? $('upgrades-regen') : u.enzyme ? $('upgrades-enz') : u.id === 'micro' ? $('upgrades-obs') : $('upgrades');
      const d = document.createElement('div'); d.className = 'upg';
      d.innerHTML =
        `<div class="upg-head"><span class="upg-name">${esc(t.name)}${u.abstraction ? '<span class="upg-tag">ゲーム上の抽象化</span>' : ''}</span><span class="upg-lv"></span></div>` +
        `<div class="upg-line">${esc(t.line)}</div><div class="upg-req" hidden></div><div class="upg-change"></div>` +
        `<button type="button"><i class="fill"></i><span></span></button>` +
        (u.enzyme === 'ldh' || u.enzyme === 'mct' ? '<button type="button" class="ldh-toggle" hidden></button>' : '');
      const btn = d.querySelector('button');
      const tog = d.querySelector('.ldh-toggle');
      if (tog) tog.addEventListener('click', () => {
        const key = u.enzyme + 'Off', off = !(state.switches && state.switches[key]);
        S.setSwitch(state, key, off);
        const msg = u.enzyme === 'mct'
          ? (off ? '輸送体 MCT を一時停止しました。細胞の中の乳酸がどう変わるか、細胞タブで比べてみましょう' : '輸送体 MCT を再開しました')
          : (off ? '乳酸デヒドロゲナーゼ（LDH）を一時停止しました。NAD⁺ がどう変わるか、細胞タブで比べてみましょう' : '乳酸デヒドロゲナーゼ（LDH）を再開しました');
        S.addNote(state, msg); toast(msg); save(true); render(0);
      });
      btn.addEventListener('click', () => {
        const wasIdentified = !u.enzyme || S.isIdentified(state, u.enzyme);
        if (!S.canBuy(state, u.id)) return;
        const cmp = wasIdentified && u.effect.type === 'vmax' && u.enzyme !== 'ldh' && u.enzyme !== 'mct' ? S.compareUpgrade(state, u.id, EFFECT_SEC) : null;
        if (!S.buy(state, u.id)) return;
        if (cmp) { reportEffect(u, cmp); render(0); save(true); return; }
        save(true);
        if (u.id === 'micro') { toast('解糖系の内部の解析を始めました。代謝を回すと酵素が同定されます'); }
        else if (u.id === 'nadregen') { openTerm('nadregen'); $('sheet-title').textContent = '研究開始：NAD⁺ の再生'; }
        else if (u.id === 'lacexit') { openTerm('lacexit'); $('sheet-title').textContent = '研究開始：乳酸の行き先'; }
        else if (u.enzyme && state.levels[u.id] === 1) { /* 同定の通知は events から出す */ }
        else toast(`${t.name}：研究完了`);
        render(0);
      });
      box.appendChild(d);
      upgEls[u.id] = { root: d, tog, lv: d.querySelector('.upg-lv'), ch: d.querySelector('.upg-change'), req: d.querySelector('.upg-req'),
                       nm: d.querySelector('.upg-name'), line: d.querySelector('.upg-line'),
                       btn, label: btn.querySelector('span'), fill: btn.querySelector('.fill') };
    }
  }
  function renderUpgrades() {
    const microOn = (state.levels.micro || 0) >= 1;
    $('now-glc').textContent = fmt2(state.flux.hk || 0);
    $('now-pyr').textContent = fmt2(state.flux.pk || 0);
    $('now-rp').textContent = fmt2((state.flux[S.ECON.rpSource] || 0) * S.ECON.rpPerExtent);
    $('enz-head').hidden = !microOn;
    const regenOn = MB.MICRO_IDS.every(id => S.isIdentified(state, id)) || (state.levels.nadregen || 0) >= 1;
    $('regen-head').hidden = !regenOn;
    const trOn = S.isIdentified(state, 'ldh');
    $('tr-head').hidden = !trOn;
    for (const u of MB.UPGRADES) {
      const e = upgEls[u.id], lv = state.levels[u.id] || 0, t = UT[u.id] || {};
      if (u.id === 'nadregen') { e.root.hidden = !regenOn; if (!regenOn) continue; }
      if (u.id === 'lacexit') { e.root.hidden = !trOn; if (!trOn) continue; }
      if (u.enzyme) {
        const isLdh = u.enzyme === 'ldh', isTr = u.protein === 'transporter';
        const show = isTr ? (state.levels.lacexit || 0) >= 1 : isLdh ? (state.levels.nadregen || 0) >= 1 : microOn;
        e.root.hidden = !show; if (!show) continue;
        const r = R(u.enzyme), ided = S.isIdentified(state, u.enzyme), anz = S.analyzing(state).includes(u.enzyme);
        const no = r.step ? r.step + '. ' : isTr ? '輸送体 ' : '';
        e.nm.textContent = ided ? `${no}${r.name}（${r.abbr}）` : anz ? `${no}？？？（解析中）` : `${no}？？？（解析待ち）`;
        e.line.textContent = ided ? MB.ENZYME_TEXT[u.enzyme] : anz
          ? `解析中 ${Math.floor(S.analysisProgress(state, u.enzyme) * 100)}%。` + (isLdh ? 'ピルビン酸がつくられるほど、その行き先の解析が進む。' : isTr ? '乳酸がつくられるほど、膜の輸送の解析が進む。' : '細胞を回すと解析が進む。') + '研究ポイントで今すぐ同定することもできる（解析が進むほど安い）。'
          : '隣の酵素が同定されると、解析が始まる。';
        if (e.tog) {
          e.tog.hidden = !ided;
          const off = !!(state.switches && state.switches[u.enzyme + 'Off']);
          e.tog.textContent = off ? `${R(u.enzyme).abbr} を再開する` : `${R(u.enzyme).abbr} を一時停止して比べる`;
          e.tog.classList.toggle('off', off);
        }
        e.root.classList.toggle('waiting', !ided && !anz);
      }
      const avail = S.isAvailable(state, u.id);
      const cost = S.upgradeCost(state, u.id), maxed = lv >= u.maxLevel, can = S.canBuy(state, u.id);
      const waitingEnz = u.enzyme && !S.isIdentified(state, u.enzyme) && !S.analyzing(state).includes(u.enzyme);
      e.req.hidden = avail || waitingEnz;
      if (!avail && !waitingEnz) {
        if (u.requires.list) e.req.innerHTML = '🔒 研究できる条件<ul class="conds">' + MB[u.requires.list].map(c => `<li class="${c.test(state) ? 'done' : ''}">${c.test(state) ? '✓' : '・'} ${esc(c.text)}</li>`).join('') + '</ul>';
        else e.req.textContent = '🔒 ' + u.requires.text;
      }
      e.root.classList.toggle('locked', !avail);
      e.lv.textContent = u.perCell ? `この細胞で ${state.cell.nadBought || 0} 回（累計 ${lv} 回）` : u.consumable ? (lv ? `補充 ${lv} 回` : '') : u.id === 'micro' || u.id === 'nadregen' || u.id === 'lacexit' ? (lv ? '研究済み' : '') : u.enzyme && lv === 0 ? '' : u.enzyme && lv === 1 ? '同定済み' : `Lv ${lv}`;
      if (u.effect.type === 'vmax') {
        if (u.enzyme && lv === 0) e.ch.innerHTML = waitingEnz ? '' : `<span class="anz"><i style="width:${S.analysisProgress(state, u.enzyme) * 100}%"></i></span>`;
        else e.ch.innerHTML = maxed ? '最大レベル' : effectText(u, lv);
      } else if (u.effect.type === 'add') {
        e.ch.innerHTML = `NAD⁺ ${fmt(state.amounts.nad)}<span class="arrow">→</span>${fmt(state.amounts.nad + u.effect.amount)}`;
      } else e.ch.textContent = '';
      e.btn.disabled = maxed || !can;
      const verb = u.enzyme && lv === 0 ? '今すぐ同定する' : '研究する';
      e.label.textContent = maxed ? '完了' : waitingEnz ? '解析待ち' : !avail ? '条件を満たしていません' : can ? `${verb}　${cost.toLocaleString('ja-JP')} RP` : `あと ${Math.ceil(cost - state.rp).toLocaleString('ja-JP')} RP`;
      e.fill.style.width = maxed || !avail ? '0' : Math.min(100, state.rp / cost * 100) + '%';
      e.root.classList.toggle('ready', can && !maxed);
    }
  }
  /* 研究の効果を、プレイヤーにわかる言葉と倍率で書く */
  function effectText(u, lv) {
    const ef = u.effect, a = ef.offset || 0;
    const mul = l => 1 + ef.perLevel * Math.max(0, l - a);
    const arrow = (x, y, unit) => `${x}<span class="arrow">→</span>${y}${unit}`;
    if (ef.mode === 'add') return 'グルコースの自動取り込み ' + arrow(fmt2(ef.perLevel * lv), fmt2(ef.perLevel * (lv + 1)), ' 個/秒');
    const m = arrow('×' + mul(lv).toFixed(1), '×' + mul(lv + 1).toFixed(1), '');
    if (u.id === 'prep') return `準備期の5つの酵素の速さ ${m}`;
    if (u.id === 'pay') return `回収期の5つの酵素の速さ ${m}`;
    if (u.id === 'work') return `細胞の仕事（ATP を使う速さ） ${m}`;
    if (u.enzyme === 'mct') return `MCT の速さ ${m}（細胞の中の乳酸が落ち着く量が下がる。研究ポイントは増えない）`;
    if (u.enzyme) return `${R(u.enzyme).abbr} の速さ ${m}（最初の状態との比）`;
    return m;
  }

  /* 研究の効果：買った瞬間の細胞の状態から「研究した場合」と「研究しなかった場合」を
   * 裏で10秒先まで計算し、その差を知らせる。細胞の立ち上がりや NADH の蓄積といった
   * 自然な変化は両方に同じだけ入るので、研究そのものの効果だけが取り出せる。 */
  const EFFECT_SEC = 10;
  function reportEffect(u, cmp) {
    const name = upgText(u).name, a = state.amounts, tN = a.nad + a.nadh;
    const w = cmp.with, wo = cmp.without;
    let msg;
    if (w < 0.01 && wo < 0.01) msg = `研究の効果（${name}）：いまは流れが止まっているため、すぐには効果が出ません。`;
    else {
      const head = `研究の効果（${name}）：${EFFECT_SEC}秒後のピルビン酸 ${fmt2(w)} /秒（研究しなかった場合 ${fmt2(wo)} /秒`;
      const pct = wo > 0.01 ? (w / wo - 1) * 100 : 100;
      if (pct >= 3) msg = `${head} → +${Math.round(pct)}%）`;
      else {
        const why = a.glc < 1 ? 'グルコースの供給が追いついていないようです'
          : tN && a.nad / tN < 0.15 ? 'NADH が溜まって回収期が遅くなっているようです'
          : a.atp < 10 ? 'ATP が足りていないようです'
          : 'ほかの場所がボトルネックになっているようです';
        msg = `${head}）。速さはほとんど変わりません。${why}`;
      }
    }
    toast(msg); S.addNote(state, msg);
  }

  function anyUseful() {
    return MB.UPGRADES.some(u => S.canBuy(state, u.id) && (u.id !== 'nadsalv' || state.amounts.nad < 40));
  }

  /* ---------- 記録 ---------- */
  let logKey = '';
  function renderLog() {
    const k = state.log.length + ':' + (state.log[0] ? state.log[0].t : '');
    if (k === logKey) return;
    logKey = k;
    $('log').innerHTML = state.log.length
      ? state.log.map(l => `<li><time>${fmtTime(l.t)}</time>${esc(l.text)}</li>`).join('')
      : '<li class="empty">まだ記録はありません。細胞を動かすと、気づいたことがここに残ります。</li>';
  }

  /* ---------- 詳細（研究者モード） ---------- */
  const resCells = {};
  function buildDetail() {
    const body = $('res-body');
    for (const id of S.FREE) {
      const r = document.createElement('tr');
      r.innerHTML = `<td>${SP[id].abbr}<small>${SP[id].name}</small></td><td class="n"></td><td class="d"></td>`;
      body.appendChild(r);
      resCells[id] = { n: r.children[1], d: r.children[2] };
    }
    const lines = [];
    for (const id of S.COMPUTED_IDS) {
      const r = R(id), k = r.kinetics;
      lines.push(`■ ${r.step ? r.step + '. ' : ''}${r.name}` + (r.gate ? '（同定するまで反応しない）' : ''), `  ${equation(r)}` + (r.id === 'ldh' ? '（計算では H⁺ を一定とみなす）' : ''));
      if (r.thermo && r.thermo.keq === 'mct') lines.push(`  輸送の平衡 K = 10^(pH外 − pH内) = ${S.kGame(id).toPrecision(3)}（[乳酸]外/[乳酸]内。pH 一定。電気的に中性）`);
      if (r.thermo && r.thermo.dG0 != null) lines.push(`  ΔG°′ ${r.thermo.dG0} kJ/mol` + (S.kGame(id) != null ? ` → K_game ${S.kGame(id).toPrecision(3)}${r.thermo.keqDim === 'M' ? ' u' : ''}` : '（不可逆として扱う）'));
      if (k.type === 'mm') lines.push(`  速度式: Vmax${Object.entries(k.km).map(([s, v]) => ` × ${SP[s].abbr}/(${v}+${SP[s].abbr})`).join('')}` + (r.regulation || []).map(g => ` × ${g.ki}/(${g.ki}+${SP[g.effector].abbr})［実在の調節］`).join(''));
      else if (k.type === 'rev') lines.push(`  速度式: 可逆の飽和型（Q = K_game で正味 0）Ks ${JSON.stringify(k.ks)} Kp ${JSON.stringify(k.kp)}`);
      else lines.push('  速度式: 定速供給');
      lines.push('');
    }
    lines.push('Vmax・Km・Ki はゲーム上の値。1 u = 0.1 mM（名目）。Pᵢ・H⁺・H₂O は一定。');
    $('defs').textContent = lines.join('\n');
    $('terms').innerHTML = Object.entries(G).map(([k, t]) => `<button type="button" data-term="${k}">${esc(t.short)}</button>`).join('');
  }
  function renderDetail() {
    const net = S.netRates(state), a = state.amounts;
    for (const id in resCells) {
      resCells[id].n.textContent = fmt2(a[id] || 0);
      const d = net[id] || 0, c = resCells[id].d;
      c.textContent = signed(d) + '/秒';
      c.className = 'd' + (d > 0.005 ? ' pos' : d < -0.005 ? ' neg' : '');
    }
    const cons = S.conservation(state), exp = S.expectedConservation(state);
    const chk = (label, v, e) => {
      const ok = Math.abs(v - e) < 1e-6 * Math.max(1, e);
      return `<span class="${ok ? 'ok' : 'ng'}">${ok ? '✓' : '✗'}</span> ${label} = ${fmt2(v)}（期待値 ${fmt2(e)}）`;
    };
    const Cexp = 6 * state.totals.glcSupplied - 3 * 0;
    $('check').innerHTML =
      chk('ATP + ADP', cons.adenylate, exp.adenylate) + '<br>' +
      chk('NAD⁺ + NADH', cons.nicotinamide, exp.nicotinamide) + '<br>' +
      `炭素 = ${fmt2(S.carbon(state))}（炭素をもつ全${S.FREE.filter(id => SP[id].carbon).length}物質の炭素数 × 量の合計）` + '<br>' +
      (state.totals.extent.lac_clear ? `細胞の周りから運び去られた乳酸の炭素 = ${fmt2(S.carbonOut(state))}（系の外へ出た分）<br>` : '') +
      (state.extAdded.nad ? `NAD⁺ の外部からの補充：この細胞で ${fmt2(state.extAdded.nad)}（期待値に含む）` : 'この細胞では NAD⁺ の外部からの補充なし') + '<br>' +
      '';
    if (DEBUG) { $('dbg-line').hidden = false; $('dbg-line').textContent = `計算の健全性：平衡の行き過ぎ ${state.diag.eqViolations} 件／刻みの半分化 ${state.diag.halvings} 回／解法の失敗 ${state.diag.newtonFail} 件`; }
    $('hud-t').textContent = fmtTime(state.t);
  }

  /* ---------- 全体の描画 ---------- */
  function render(dt) {
    $('hud-rp').textContent = fmt(state.rp);
    renderGoal();
    const m = A.macro(state);
    $('badge').hidden = !anyUseful() || tab === 'research';
    $('badge-log').hidden = state.log.length <= seenLog || tab === 'log';
    if (tab === 'log') seenLog = state.log.length;
    if (tab === 'cell') {
      const microOn = (state.levels.micro || 0) >= 1;
      const v = microOn ? view : 'macro';
      $('viewswitch').hidden = !microOn;
      document.querySelectorAll('#viewswitch [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
      $('view-macro').hidden = v !== 'macro';
      $('view-micro').hidden = v !== 'micro';
      const d = diagnose(m);
      renderStatus(d, m);
      if (v === 'macro') renderFlow(dt, m); else renderChain();
      renderGauges();
    } else if (tab === 'research') renderUpgrades();
    else if (tab === 'log') renderLog();
    else renderDetail();
  }

  /* ---------- 0.3：LDH の同定（いちばん大きな出来事） ----------
   * 文章で「解決した」と言うだけでなく、閉じたあと細胞タブで NAD⁺ の数値が実際に戻っていくのを見せる。 */
  function showLdhEvent() {
    closeSheet();
    $('event').hidden = false;
    S.addNote(state, 'NADH を NAD⁺ へ戻す経路が見つかった。ピルビン酸が乳酸に変わるとき、NADH が NAD⁺ に戻る（乳酸デヒドロゲナーゼ）。');
  }
  $('ev-go').addEventListener('click', () => {
    $('event').hidden = true;
    showTab('cell');
    const g = document.querySelector('.gauge:nth-child(2)');
    g.classList.add('pulse'); $('regen').classList.add('pulse');
    setTimeout(() => { try { document.querySelector('.gauges').scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) {} }, 50);
    setTimeout(() => { g.classList.remove('pulse'); $('regen').classList.remove('pulse'); }, 6000);
  });

  /* ---------- 0.4：MCT の同定（細胞外への道） ---------- */
  function showMctEvent() {
    closeSheet();
    $('event-mct').hidden = false;
    S.addNote(state, '細胞外への道が開かれた。乳酸と H⁺ を細胞膜の外へ運ぶ輸送経路（MCT）が成立した。EXTRACELLULAR（細胞外環境・細胞間代謝）は今後のアップデートで解放予定。');
  }
  $('ev-go-mct').addEventListener('click', () => {
    $('event-mct').hidden = true;
    showTab('cell');
    const p = $('lacpanel');
    p.classList.add('pulse'); setTimeout(() => p.classList.remove('pulse'), 6000);
    setTimeout(() => { try { p.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }, 50);
  });

  /* ---------- 操作 ---------- */
  const culture = () => { S.newCulture(state); save(true); render(0); toast('新しい細胞で再開しました（研究はそのまま。NAD⁺ 補充の価格も元に戻りました' + (S.isIdentified(state, 'mct') ? '。細胞の外の乳酸は残っています' : '') + '）'); };
  $('btn-culture').addEventListener('click', culture);
  $('btn-stall-nad').addEventListener('click', () => { if (S.buy(state, 'nadsalv')) { save(true); render(0); toast('NAD⁺ を補充しました'); } });
  $('btn-culture2').addEventListener('click', () => {
    if (confirm('細胞の中身を最初の状態に戻して、新しい細胞で再開しますか？（研究と研究ポイントは残ります）')) { culture(); showTab('cell'); }
  });
  $('btn-save').addEventListener('click', () => save(false));
  $('btn-wipe').addEventListener('click', () => {
    if (!confirm('研究も含めて、すべて最初からやり直しますか？')) return;
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    state = S.createState(); seenLog = 0; logKey = ''; showTab('cell'); toast('最初からになりました');
  });

  /* ---------- ループ ---------- */
  buildFlow(); buildChain(); buildUpgrades(); buildDetail(); showTab('cell');
  let last = performance.now(), sinceSave = 0;
  setInterval(() => {
    const now = performance.now();
    const dt = Math.min(1, (now - last) / 1000); last = now;
    S.step(state, dt);
    while (state.events.length) {
      const ev = state.events.shift();
      if (ev.type === 'identified') {
        const r = R(ev.id);
        if (ev.id === 'ldh') showLdhEvent(); else if (ev.id === 'mct') showMctEvent(); else toast(`ENZYME IDENTIFIED ― ${r.name}（${r.abbr}）を同定した`);
        save(true);
      }
    }
    render(dt);
    sinceSave += dt;
    if (sinceSave > 10) { save(true); sinceSave = 0; }
  }, TICK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save(true);
    else { const c = S.catchUp(state, Date.now()); last = performance.now(); if (c > 0) toast(`留守のあいだの ${fmtTime(c)} を進めました`); }
  });
  window.addEventListener('pagehide', () => save(true));

  // 画面操作テスト用：state を外から読めるようにする（?debug のときだけ。公開画面では作らない）
  if (DEBUG) window.__METABOLISM_DEBUG__ = { get state() { return state; } };

  /* v0.1.0：遊び方（初回は自動で開く）と「?」ボタン */
  $('btn-help').addEventListener('click', () => openTerm('howto'));
  (() => {
    let seen = false;
    try { seen = !!localStorage.getItem(INTRO_KEY) || !!localStorage.getItem(SAVE_KEY); } catch (e) { seen = false; }
    if (!seen && !DEBUG) {
      setTimeout(() => openTerm('howto'), 300);
      try { localStorage.setItem(INTRO_KEY, '1'); } catch (e) {}
    }
  })();
})();
