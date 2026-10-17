/* =========================================================================
 * METABOLISM — data.js（Prototype 0.2）
 * 代謝物・反応・研究の「定義データ」。ロジックは含まない。
 *
 * ■ 単位系（GPT 審査 0.2 実装前 必須修正3）
 *   物質量：ゲーム内の量「u」。名目上 1 u = 0.1 mM（細胞内濃度）と定義する。
 *           ※この対応は平衡定数の単位をそろえるための名目値。ゲーム内の量そのものは
 *             実際の細胞内濃度を再現していない（例：NAD⁺ の総量は実際よりずっと多い）。
 *   時間  ：秒（ゲーム内時間）
 *   平衡  ：教科書の ΔG°′（pH 7, 25 ℃）から K′eq を計算し、上の単位で K_game に換算する。
 *           Pᵢ・H⁺・H₂O は一定とみなし、K_game に繰り込む（Pᵢ = 1 mM, pH 7, 水の活量 1）。
 *   速度  ：Vmax・Km・Ki はすべてゲーム固有のパラメータ（実測値ではない）。
 * ========================================================================= */
(function (root) {
  'use strict';
  const MB = (root.MB = root.MB || {});

  MB.DATA_VERSION = 4;

  /* ゲーム経済（すべてゲーム上の抽象化。科学的な値ではない）
   *  研究ポイント（RP）は、解糖系を最後まで通った量 ＝ ピルビン酸の生成量から得る（A3、0.2.1 で変更）。
   *  0.2 までは「細胞の仕事」が ATP を加水分解した量から得ていたが、細胞が速く回るほど 1 細胞あたりの
   *  RP が減る（強化するほど次の目標が遠くなる）ため変更した。 */
  MB.ECONOMY = {
    rpSource: 'pk',          // この反応の進行量に比例して RP が入る
    rpPerExtent: 1.0,        // ピルビン酸 1 u あたりの RP
    manualGlc: 10            // 手動投与 1 回あたりのグルコース
  };

  MB.UNITS = {
    mM_per_u: 0.1,          // 1 u = 0.1 mM（名目）
    pi_mM: 1.0,             // 一定とみなす無機リン酸濃度（名目）
    RT_kJ: 2.479            // 25 ℃
  };

  /* ---------------------------------------------------------------------
   * 代謝物
   *  pool: 'free' = 量を追跡 ／ 'buffered' = 一定とみなす
   *  carbon: 炭素数（収支検算用）
   *  group: マクロ表示での集計先
   * ------------------------------------------------------------------- */
  MB.SPECIES = {
    glc:   { name: 'グルコース',                   abbr: 'Glc',     pool: 'free', initial: 0,   carbon: 6, group: 'glc' },
    g6p:   { name: 'グルコース6-リン酸',           abbr: 'G6P',     pool: 'free', initial: 0,   carbon: 6, group: 'prepMid' },
    f6p:   { name: 'フルクトース6-リン酸',         abbr: 'F6P',     pool: 'free', initial: 0,   carbon: 6, group: 'prepMid' },
    f16bp: { name: 'フルクトース1,6-ビスリン酸',   abbr: 'F1,6BP',  pool: 'free', initial: 0,   carbon: 6, group: 'prepMid' },
    dhap:  { name: 'ジヒドロキシアセトンリン酸',   abbr: 'DHAP',    pool: 'free', initial: 0,   carbon: 3, group: 'tp' },
    gap:   { name: 'グリセルアルデヒド3-リン酸',   abbr: 'GAP',     pool: 'free', initial: 0,   carbon: 3, group: 'tp' },
    bpg13: { name: '1,3-ビスホスホグリセリン酸',   abbr: '1,3-BPG', pool: 'free', initial: 0,   carbon: 3, group: 'payMid' },
    pg3:   { name: '3-ホスホグリセリン酸',         abbr: '3PG',     pool: 'free', initial: 0,   carbon: 3, group: 'payMid' },
    pg2:   { name: '2-ホスホグリセリン酸',         abbr: '2PG',     pool: 'free', initial: 0,   carbon: 3, group: 'payMid' },
    pep:   { name: 'ホスホエノールピルビン酸',     abbr: 'PEP',     pool: 'free', initial: 0,   carbon: 3, group: 'payMid' },
    pyr:   { name: 'ピルビン酸',                   abbr: 'Pyr',     pool: 'free', initial: 0,   carbon: 3, group: 'pyr' },
    atp:   { name: 'ATP',                          abbr: 'ATP',     pool: 'free', initial: 80,  conserved: 'adenylate' },
    adp:   { name: 'ADP',                          abbr: 'ADP',     pool: 'free', initial: 20,  conserved: 'adenylate' },
    nad:   { name: 'NAD⁺',                         abbr: 'NAD⁺',    pool: 'free', initial: 200, conserved: 'nicotinamide' },
    nadh:  { name: 'NADH',                         abbr: 'NADH',    pool: 'free', initial: 0,   conserved: 'nicotinamide' },
    pi:    { name: '無機リン酸',                   abbr: 'Pᵢ',      pool: 'buffered' },
    h2o:   { name: '水',                           abbr: 'H₂O',     pool: 'buffered' },
    h:     { name: 'プロトン',                     abbr: 'H⁺',      pool: 'buffered' }
  };

  /* マクロ表示の集計グループ（aggregate.js が使う。計算には使わない） */
  MB.GROUPS = {
    glc:     { name: 'グルコース' },
    prepMid: { name: '準備期の中間体' },
    tp:      { name: '三炭糖リン酸' },
    payMid:  { name: '回収期の中間体' },
    pyr:     { name: 'ピルビン酸' }
  };

  /* ---------------------------------------------------------------------
   * 反応
   *  computed: true  = シミュレーションで計算する
   *            false = 定義のみ（マクロの見出し。二重計算を構造的に防ぐ）
   *  thermo  : 可逆性と ΔG°′。K_game は sim.js が UNITS から計算する。
   *            keqDim: 'none' | 'M'（アルドラーゼ） | 'perM_pi'（GAPDH：Pᵢ を含む M⁻¹）
   *  kinetics: 'zero'（定速） | 'mm'（不可逆・飽和型） | 'rev'（可逆・飽和型）
   *  regulation: 実在の調節（実装したもののみ）。 notImplemented: 実在するが未実装の調節
   *  energy  : 将来のエネルギー層用（0.2 では未使用）。§ docs 参照
   * ------------------------------------------------------------------- */
  MB.REACTIONS = [
    // 細胞外からの入力。将来「食事 → 消化 → 吸収 → 血糖 → GLUT」に置き換えられるよう、
    // 供給はこの1反応に閉じ込めてある（kind: 'supply', source: 'external'）。
    { id: 'glut', name: 'グルコース取り込み', computed: true, kind: 'supply', source: 'external',
      stoich: { glc: +1 }, kinetics: { type: 'zero' }, vmaxBase: 0,
      simplifications: ['S6'] },

    // ===== 解糖系 ミクロ10反応（計算の主体） =====
    { id: 'hk', step: 1, phase: 'prep', name: 'ヘキソキナーゼ', abbr: 'HK', computed: true,
      stoich: { glc: -1, atp: -1, g6p: +1, adp: +1, h: +1 },
      thermo: { reversible: false, dG0: -16.7 },
      kinetics: { type: 'mm', km: { glc: 10, atp: 8 } }, vmaxBase: 0.7,
      regulation: [{ kind: 'inhibition', effector: 'g6p', ki: 5, real: true,
        note: 'G6P による阻害（HK I〜III）。肝臓のグルコキナーゼ（HK IV）は G6P で阻害されず、調節タンパク質（GKRP）で制御される。0.2 ではアイソザイムを区別しない。Ki はゲーム値。' }],
      notImplemented: [] },
    { id: 'pgi', step: 2, phase: 'prep', name: 'グルコース6-リン酸イソメラーゼ', abbr: 'PGI', computed: true,
      stoich: { g6p: -1, f6p: +1 },
      thermo: { reversible: true, dG0: 1.7, keqDim: 'none' },
      kinetics: { type: 'rev', ks: { g6p: 5 }, kp: { f6p: 5 } }, vmaxBase: 20 },
    { id: 'pfk', step: 3, phase: 'prep', name: 'ホスホフルクトキナーゼ-1', abbr: 'PFK-1', computed: true,
      stoich: { f6p: -1, atp: -1, f16bp: +1, adp: +1, h: +1 },
      thermo: { reversible: false, dG0: -14.2 },
      kinetics: { type: 'mm', km: { f6p: 2, atp: 8 } }, vmaxBase: 0.9,
      notImplemented: ['ATP による阻害', 'AMP・ADP による活性化', 'フルクトース2,6-ビスリン酸による活性化', 'クエン酸による阻害', 'H⁺ による阻害'] },
    { id: 'aldo', step: 4, phase: 'prep', name: 'アルドラーゼ', abbr: 'ALDO', computed: true,
      stoich: { f16bp: -1, dhap: +1, gap: +1 },
      thermo: { reversible: true, dG0: 23.8, keqDim: 'M' },
      kinetics: { type: 'rev', ks: { f16bp: 2 }, kp: { dhap: 5, gap: 5 } }, vmaxBase: 20 },
    { id: 'tpi', step: 5, phase: 'prep', name: 'トリオースリン酸イソメラーゼ', abbr: 'TPI', computed: true,
      stoich: { dhap: -1, gap: +1 },
      thermo: { reversible: true, dG0: 7.5, keqDim: 'none' },
      kinetics: { type: 'rev', ks: { dhap: 5 }, kp: { gap: 5 } }, vmaxBase: 100 },
    { id: 'gapdh', step: 6, phase: 'pay', name: 'GAP デヒドロゲナーゼ', abbr: 'GAPDH', computed: true,
      stoich: { gap: -1, nad: -1, pi: -1, bpg13: +1, nadh: +1, h: +1 },
      thermo: { reversible: true, dG0: 6.3, keqDim: 'perM_pi' },
      kinetics: { type: 'rev', ks: { gap: 1, nad: 15 }, kp: { bpg13: 0.001, nadh: 15 } }, vmaxBase: 30 },
    { id: 'pgk', step: 7, phase: 'pay', name: 'ホスホグリセリン酸キナーゼ', abbr: 'PGK', computed: true,
      stoich: { bpg13: -1, adp: -1, pg3: +1, atp: +1 },
      thermo: { reversible: true, dG0: -18.5, keqDim: 'none' },
      kinetics: { type: 'rev', ks: { bpg13: 0.001, adp: 5 }, kp: { pg3: 5, atp: 10 } }, vmaxBase: 30 },
    { id: 'pgam', step: 8, phase: 'pay', name: 'ホスホグリセリン酸ムターゼ', abbr: 'PGAM', computed: true,
      stoich: { pg3: -1, pg2: +1 },
      thermo: { reversible: true, dG0: 4.4, keqDim: 'none' },
      kinetics: { type: 'rev', ks: { pg3: 5 }, kp: { pg2: 5 } }, vmaxBase: 50 },
    { id: 'eno', step: 9, phase: 'pay', name: 'エノラーゼ', abbr: 'ENO', computed: true,
      stoich: { pg2: -1, pep: +1, h2o: +1 },
      // ΔG°′ は教材基準値 +1.7 kJ/mol を暫定採用（GPT 審査 Q5）。
      // 文献により +1.7〜+7.5 と記載が分かれ、2020 年の実験研究では −2.8 ± 0.2 kJ/mol（GPT 提示）。
      thermo: { reversible: true, dG0: 1.7, keqDim: 'none', dG0Note: 'enolase' },
      kinetics: { type: 'rev', ks: { pg2: 5 }, kp: { pep: 5 } }, vmaxBase: 50 },
    { id: 'pk', step: 10, phase: 'pay', name: 'ピルビン酸キナーゼ', abbr: 'PK', computed: true,
      stoich: { pep: -1, adp: -1, h: -1, pyr: +1, atp: +1 },
      thermo: { reversible: false, dG0: -31.4 },
      kinetics: { type: 'mm', km: { pep: 0.05, adp: 8 } }, vmaxBase: 4,
      notImplemented: ['F1,6BP による活性化（フィードフォワード）', 'ATP・アラニンによる阻害', '肝臓型のリン酸化による不活性化'] },

    { id: 'atpase', name: '細胞の仕事（ATP の加水分解）', computed: true, kind: 'sink',
      stoich: { atp: -1, h2o: -1, adp: +1, pi: +1, h: +1 },
      thermo: { reversible: false },
      kinetics: { type: 'mm', km: { atp: 25 } }, vmaxBase: 0.8,
      simplifications: ['S7', 'S8'] },

    // ===== マクロの見出し（計算しない） =====
    { id: 'gly_prep', name: '解糖系 準備期', computed: false, macroOf: ['hk', 'pgi', 'pfk', 'aldo', 'tpi'],
      stoich: { glc: -1, atp: -2, adp: +2, gap: +2, h: +2 } },
    { id: 'gly_pay', name: '解糖系 回収期', computed: false, macroOf: ['gapdh', 'pgk', 'pgam', 'eno', 'pk'],
      stoich: { gap: -1, nad: -1, pi: -1, adp: -2, nadh: +1, atp: +2, pyr: +1, h2o: +1 } }
  ];

  MB.MICRO_IDS = ['hk', 'pgi', 'pfk', 'aldo', 'tpi', 'gapdh', 'pgk', 'pgam', 'eno', 'pk'];

  /* ---------------------------------------------------------------------
   * 研究
   *  effect.type:
   *    'vmax'   : 対象反応の Vmax を変える（reactions: 複数可）。平衡（K_game）は変えない
   *    'add'    : 物質を外部から加える
   *    'unlock' : 表示の解放（計算には影響しない）
   *  requires : 研究できる条件（表示用の説明つき）
   * ------------------------------------------------------------------- */
  const PREP = ['hk', 'pgi', 'pfk', 'aldo', 'tpi'], PAY = ['gapdh', 'pgk', 'pgam', 'eno', 'pk'];
  MB.UPGRADES = [
    { id: 'glut', name: 'グルコース輸送体の発現', desc: 'グルコースを自動で取り込む。Lv ごとに +0.4 u/秒。',
      costBase: 8, costGrowth: 1.45, maxLevel: 30,
      effect: { type: 'vmax', reactions: ['glut'], perLevel: 0.4, mode: 'add' } },
    { id: 'prep', name: '準備期の酵素の発現', desc: '準備期の5酵素の最大速度 +50%（Lv あたり）。',
      costBase: 15, costGrowth: 1.4, maxLevel: 25,
      effect: { type: 'vmax', reactions: PREP, perLevel: 0.5, mode: 'mul' } },
    { id: 'pay', name: '回収期の酵素の発現', desc: '回収期の5酵素の最大速度 +50%（Lv あたり）。',
      costBase: 15, costGrowth: 1.4, maxLevel: 25,
      effect: { type: 'vmax', reactions: PAY, perLevel: 0.5, mode: 'mul' } },
    { id: 'work', name: '細胞活動の活性化', desc: 'ATP 消費速度 +40%（Lv あたり）。',
      costBase: 12, costGrowth: 1.45, maxLevel: 25,
      effect: { type: 'vmax', reactions: ['atpase'], perLevel: 0.40, mode: 'mul' } },
    { id: 'nadsalv', name: 'NAD⁺ の追加合成（抽象化）', desc: '新たな NAD⁺ 分子を 100 u 加える。',
      // 価格は「現在の細胞での購入回数」で上がり、新しい細胞で初期価格に戻る（初期のプレステージの流れ）。
      // levels.nadsalv は累計の購入回数（統計）として保持する。
      costBase: 20, costGrowth: 1.6, maxLevel: 999, consumable: true, perCell: true, abstraction: 'A1',
      effect: { type: 'add', species: 'nad', amount: 100 } },
    { id: 'micro', name: '解糖系の内部を解析する', desc: '解糖系を10の酵素反応に分けて見られるようになり、酵素の解析が始まる。',
      costBase: 80, costGrowth: 1, maxLevel: 1,
      requires: { test: s => s.totals.pyrProduced >= 500, text: 'ピルビン酸を累計 500 つくると研究できる' },
      effect: { type: 'unlock', view: 'micro' } }
  ];
  // 酵素ごとの研究：Lv1 ＝「同定」（解析が 100% に達するか、RP で即時同定）。Lv2 以降で最大速度 +50%/Lv
  for (const id of MB.MICRO_IDS) {
    MB.UPGRADES.push({
      id: 'enz_' + id, enzyme: id, name: null, desc: null,
      costBase: 25, costGrowth: 1.45, maxLevel: 15,
      requires: { test: s => (s.levels.micro || 0) >= 1, text: '「解糖系の内部を解析する」の研究が必要' },
      effect: { type: 'vmax', reactions: [id], perLevel: 0.5, mode: 'mul', offset: 1 }
    });
  }

  /* ---------------------------------------------------------------------
   * 解析による酵素の同定（0.2.2。ゲーム上の抽象化 A6）
   *  内部の解析を研究すると、両端（グルコース側・ピルビン酸側）から内側へ、
   *  各側の「まだ同定されていない最初の酵素」が解析中になる。
   *  解析進捗 ＝ 解析中になってからの正味の進行量（グルコース換算。負の刻みは 0）。
   *  これは代謝の流れから算出したゲーム上の値で、実際に反応した分子の数ではない。
   *  解析の順序はゲーム上の表現で、酵素の発見史・反応速度・律速性を表さない。
   *  need: 同定に必要な解析量（グルコース換算） ／ cost: 即時同定の基準額（RP。残りの割合を掛ける）
   * ------------------------------------------------------------------- */
  MB.ANALYSIS = {
    sides: [['hk', 'pgi', 'pfk', 'aldo', 'tpi'], ['pk', 'eno', 'pgam', 'pgk', 'gapdh']],
    stages: [
      { need: 80,  cost: 30 },
      { need: 120, cost: 45 },
      { need: 170, cost: 65 },
      { need: 230, cost: 90 },
      { need: 300, cost: 120 }
    ],
    perGlucose: { prep: 1, pay: 2 }       // グルコース1分子あたり、その酵素の反応が何回進むか
  };

  /* マイルストーン（記録タブ） */
  MB.MILESTONES = [
    { id: 'first_pyr', test: s => s.totals.pyrProduced >= 1, text: '初めてピルビン酸を検出した。' },
    { id: 'nad_low', test: s => s.amounts.nad < 20 && s.totals.pyrProduced > 0,
      text: 'NAD⁺ が減少している。NADH を NAD⁺ に戻す経路は、まだ解放されていない。' },
    { id: 'atp_trap', test: s => s.amounts.atp < 2 && s.amounts.glc > 5,
      text: 'ATP が尽き、準備期が始動できない。解糖系は最初に ATP を「投資」する経路だ。' },
    { id: 'pyr_100', test: s => s.totals.pyrProduced >= 100, text: 'ピルビン酸 100 u。ピルビン酸の行き先は、まだ解放されていない。' },
    { id: 'pyr_500', test: s => s.totals.pyrProduced >= 500,
      text: 'ピルビン酸 500 u。解糖系の内部（10段階の酵素反応）を解析する研究ができるようになった。' },
    { id: 'pyr_1000', test: s => s.totals.pyrProduced >= 1000, text: 'ピルビン酸 1,000 u。' },
    { id: 'micro', test: s => (s.levels.micro || 0) >= 1,
      text: '解糖系の内部の解析を始めた。代謝を回すと解析データが貯まり、酵素が1つずつ同定される。' },
    { id: 'enz_all', test: s => MB.MICRO_IDS.every(id => (s.levels['enz_' + id] || 0) >= 1),
      text: '10の酵素をすべて同定した。解糖系の全体像が見えた。' }
  ];
})(typeof window !== 'undefined' ? window : globalThis);
