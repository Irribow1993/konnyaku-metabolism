/* =========================================================================
 * METABOLISM — data.js（Prototype 0.4 ／ v0.2.0：PFK-1・PK の調節、GLUT の可逆輸送）
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

  MB.DATA_VERSION = 7;

  /* 細胞の環境（0.3）
   *  ANAEROBIC ＝ この Prototype では、酸素を利用したミトコンドリアでの NADH 再酸化を利用できない条件としてモデル化する。
   *  「酸素がないと乳酸がつくられる」という意味ではない（乳酸の生成は酸素があっても起こり得る）。
   *  将来、ミトコンドリア（ピルビン酸の酸化 → TCA 回路 → 電子伝達系）を解放するときは、
   *  ここを 'aerobic' 等に切り替え、同じ NAD⁺ 問題の別の解決方法として追加する。 */
  MB.ENVIRONMENT = { id: 'anaerobic', label: 'ANAEROBIC', name: '嫌気的条件',
    mitochondria: false,
    // 0.4：pH は一定とみなす（細胞内・細胞外の pH の変化はモデル化しない）。MCT の輸送の平衡の計算にだけ使う。
    //  典型的な値：細胞質 7.2、細胞外液 7.4（教科書的な値。ゲームでは固定）
    pHin: 7.2, pHout: 7.4 };

  /* 区画（0.4）。物質の compartment が指す。将来 'mito'（ミトコンドリア）や他の細胞を加える場所。
   *  ext は「細胞のすぐ外」の1区画だけ（最小限のモデル）。細胞内と同じ体積とみなし、量の比 ＝ 濃度の比とする（簡略化 S13）。 */
  MB.COMPARTMENTS = {
    cyt: { name: '細胞質', label: 'INTRACELLULAR' },
    ext: { name: '細胞のすぐ外', label: 'EXTRACELLULAR', minimal: true }
  };

  /* ゲーム経済（すべてゲーム上の抽象化。科学的な値ではない）
   *  研究ポイント（RP）は、解糖系を最後まで通った量 ＝ ピルビン酸の生成量から得る（A3、0.2.1 で変更）。
   *  0.2 までは「細胞の仕事」が ATP を加水分解した量から得ていたが、細胞が速く回るほど 1 細胞あたりの
   *  RP が減る（強化するほど次の目標が遠くなる）ため変更した。 */
  MB.ECONOMY = {
    rpSource: 'pk',          // この反応の進行量に比例して RP が入る
    rpPerExtent: 1.0,        // ピルビン酸 1 u あたりの RP
    manualGlc: 10            // 手動投与 1 回あたりのグルコース
  };

  /* v0.2.0：グルコース輸送体（GLUT）。促進拡散（ATP を使わない、濃度差に従う双方向の輸送）
   *  細胞の外のグルコースは一定のリザーバーとみなす（血糖のように、つねに補われる。簡略化 S16）。
   *  速度：対称な輸送体の式  J ＝ Vmax ×（G外 − G内）/（Km ＋ G外 ＋ G内）
   *        G外 は一定なので、J ＝ Jmax ×（1 − G内/G外）/（1 ＋ G内/(Km ＋ G外)）と書ける。
   *        Jmax ＝ Vmax × G外/(Km ＋ G外) ＝「最大輸送能力」（細胞の中のグルコースが 0 のときの取り込みの速さ）。研究はこれを上げる。
   *  平衡：G内 ＝ G外 で正味 0。G内 ＞ G外 なら外へ出る（手で入れたグルコースが多すぎるときなど）。
   *  値：G外 50 u（名目 5 mM。空腹時の血糖値の目安）、Km 20 u（名目 2 mM。GLUT1 を参考にしたゲーム値） */
  MB.GLUT = { glcOut: 50, km: 20 };

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
    // 0.3：乳酸。出口（細胞外への輸送 MCT・他組織での利用・コリ回路・肝臓での糖新生）は未実装で、細胞内に蓄積する。
    // exits は将来の出口反応の id を入れる場所（0.3 では空）。
    lac:   { name: '乳酸',                         abbr: 'Lac',     pool: 'free', initial: 0,   carbon: 3, group: 'lac',
             exits: ['mct'], futureExits: ['他の細胞による取り込み（MCT1 など）', '乳酸シャトル', 'コリ回路（肝臓での糖新生）'] },
    // 0.4：細胞のすぐ外の乳酸。新しい細胞にしても残る（環境は細胞と別のもの）
    // v0.2.0：細胞の外のグルコース（一定のリザーバー。量を追跡しない）
    glcOut: { name: 'グルコース（細胞外）',        abbr: 'Glc(外)', pool: 'buffered', compartment: 'ext' },
    lacOut: { name: '乳酸（細胞外）',              abbr: 'Lac(外)', pool: 'free', initial: 0,   carbon: 3, group: 'lacOut', compartment: 'ext', environment: true },
    pi:    { name: '無機リン酸',                   abbr: 'Pᵢ',      pool: 'buffered' },
    h2o:   { name: '水',                           abbr: 'H₂O',     pool: 'buffered' },
    h:     { name: 'プロトン',                     abbr: 'H⁺',      pool: 'buffered' },
    hOut:  { name: 'プロトン（細胞外）',           abbr: 'H⁺(外)',  pool: 'buffered', compartment: 'ext' }
  };

  /* マクロ表示の集計グループ（aggregate.js が使う。計算には使わない） */
  MB.GROUPS = {
    glc:     { name: 'グルコース' },
    prepMid: { name: '準備期の中間体' },
    tp:      { name: '三炭糖リン酸' },
    payMid:  { name: '回収期の中間体' },
    pyr:     { name: 'ピルビン酸' },
    lac:     { name: '乳酸' },
    lacOut:  { name: '細胞外の乳酸' }
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
    // v0.2.0：定速（0次）から、濃度差に従う可逆・飽和型の輸送に変更（MB.GLUT）。vmax() の値は「最大輸送能力」Jmax。
    //  可逆の飽和型の式で、Ks なし・Kp（グルコース）＝ Km ＋ G外・K ＝ G外 とすると、上の式と一致する。
    { id: 'glut', name: 'グルコース取り込み', computed: true, kind: 'supply', source: 'external', protein: 'glut',
      stoich: { glcOut: -1, glc: +1 },
      thermo: { reversible: true, keq: 'glut' },
      kinetics: { type: 'rev', ks: {}, kp: { glc: MB.GLUT.km + MB.GLUT.glcOut } }, vmaxBase: 0,
      simplifications: ['S6', 'S16'] },

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
      // v0.2.0：ATP によるアロステリック阻害と、ADP による阻害の解除。
      //  係数 ＝ 1 / (1 ＋ ((ATP/Ki) / (1 ＋ ADP/Ka))^n)。ATP が多く ADP が少ない（エネルギーが足りている）ほど PFK-1 が遅くなる。
      //  基質としての ATP（Km 8）とは別の、調節部位への結合。Ki・Ka・n はゲーム値（v0.2.0 で調整）：
      //   始めの細胞（ATP 80・ADP 20）では ×0.93 とほとんど抑えず、ATP がほぼ満タン（ADP 0）では ×0.0016 まで抑える。
      //   下限を十分小さくしないと、準備期の酵素を最大まで増やして細胞の仕事が弱いとき、抑えきれずに F1,6BP が溜まる（dev/tests/v020_tests.js V1）
      regulation: [{ kind: 'atpInhibition', effector: 'atp', antagonist: 'adp', ki: 20, ka: 3, n: 4, real: true,
        note: 'ATP による阻害（アロステリック）。ATP は基質でもあるが、多いと調節部位にも結合して PFK-1 を遅くする。ADP（実際の細胞では主に AMP）が増えると阻害が解ける。細胞が ATP を使う速さに合わせて、解糖系に入る量が決まる。Ki・Ka はゲーム値。' }],
      notImplemented: ['AMP による活性化（このモデルに AMP はない。ADP で代表させている）', 'フルクトース2,6-ビスリン酸による活性化', 'クエン酸による阻害', 'H⁺ による阻害'] },
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
      // v0.2.0：F1,6BP によるフィードフォワード活性化。係数 ＝ 1 ＋ α × F1,6BP / (Ka ＋ F1,6BP)（最大 2 倍）。α・Ka はゲーム値。
      //  このモデルでは PK は ADP 待ちで進んでいることが多く、活性化しても流れはほとんど変わらない（docs/ANALYSIS_F16BP_v0.1.2.md）。
      regulation: [{ kind: 'activation', effector: 'f16bp', alpha: 1, ka: 20, real: true,
        note: 'F1,6BP による活性化（フィードフォワード）。準備期の産物 F1,6BP が増えると、回収期の最後の PK が速くなる（最大 2 倍）。ただし ADP が足りないと、PK を速めても流れは増えない。α・Ka はゲーム値。' }],
      notImplemented: ['ATP・アラニンによる阻害', '肝臓型のリン酸化による不活性化'] },

    /* ===== 0.3 乳酸デヒドロゲナーゼ（LDH） =====
     *  正式な式：Pyruvate + NADH + H⁺ ⇄ Lactate + NAD⁺
     *  このモデルでは H⁺ を一定とみなす（buffered）ため、計算上は Pyruvate + NADH ⇄ Lactate + NAD⁺（簡略化 S10）。
     *  ΔG°′ = −25.1 kJ/mol（pH 7・25 ℃ の教科書値。H⁺ の寄与は ΔG°′ に含まれる）→ K_game は無次元（2基質⇄2生成物）。
     *  Vmax・Ks・Kp はゲーム上の値。乳酸の Kp を大きくして、乳酸の蓄積による生成物阻害を弱くしている（乳酸の出口が未実装のため）。
     *  gate: この研究（Lv1 ＝ 同定）を持つまで反応速度を 0 にする。ATP は生じない。 */
    { id: 'ldh', branch: 'pyr', phase: 'ferm', name: '乳酸デヒドロゲナーゼ', abbr: 'LDH', nameEn: 'LACTATE DEHYDROGENASE', computed: true,
      gate: 'enz_ldh',
      stoich: { pyr: -1, nadh: -1, h: -1, lac: +1, nad: +1 },
      thermo: { reversible: true, dG0: -25.1, keqDim: 'none' },
      kinetics: { type: 'rev', ks: { pyr: 1, nadh: 2 }, kp: { lac: 5000, nad: 500 } }, vmaxBase: 6,
      simplifications: ['S10', 'S11', 'S12'],
      notImplemented: ['アイソザイム（LDH-A／LDH-B の違い）', '細胞内 pH の変化', '乳酸の細胞外への輸送（MCT）'] },

    /* ===== 0.4 MCT（モノカルボン酸輸送体）：乳酸と H⁺ の共輸送 =====
     *  乳酸⁻ + H⁺（細胞内） ⇄ 乳酸⁻ + H⁺（細胞外）。電荷は打ち消し合う（電気的に中性）ので、膜電位には左右されない。
     *  正味の輸送方向は、細胞内外の乳酸濃度と H⁺ 勾配（両者の積）で決まり、どちら向きにも運ぶ。ATP を使うポンプではない。
     *  MCT4 は解糖活性の高い細胞で乳酸の排出に関与することが多いが、輸送自体は双方向性。
     *  平衡：[乳酸]外 / [乳酸]内 ＝ [H⁺]内 / [H⁺]外 ＝ 10^(pH外 − pH内)（pH 一定とみなす → K = 10^0.2 ≈ 1.58）。
     *  速度：対称な可逆の飽和型。Km（乳酸）＝ 250 u（名目 25 mM）は MCT4 の低い親和性（文献でおよそ 20〜30 mM）を参考にしたゲーム値。
     *        Vmax はゲーム値。isoform: 'MCT4-like'（ゲーム内の名前は「MCT」とし、アイソフォームは用語カードで説明） */
    { id: 'mct', branch: 'lac', phase: 'transport', kind: 'transport', protein: 'transporter', name: 'モノカルボン酸輸送体', abbr: 'MCT',
      nameEn: 'MONOCARBOXYLATE TRANSPORTER', isoform: 'MCT4-like', computed: true, gate: 'tr_mct',
      stoich: { lac: -1, h: -1, lacOut: +1, hOut: +1 },
      thermo: { reversible: true, keq: 'mct', keqNote: 'pH' },
      kinetics: { type: 'rev', ks: { lac: 250 }, kp: { lacOut: 250 } }, vmaxBase: 30,
      simplifications: ['S13', 'S14', 'S15'],
      notImplemented: ['細胞内・細胞外の pH の変化', 'アイソフォーム（MCT1〜4）の違い', '補助タンパク質（CD147 など）', '阻害薬'] },
    /* 細胞のすぐ外から乳酸が運び去られる（拡散・血流などの抽象化 A11）。行き先は未実装（将来：他の細胞・コリ回路）。
     *  1次に近い速さ（Km を大きくとった飽和型）。細胞外の乳酸があるときだけ進む。 */
    { id: 'lac_clear', kind: 'boundary', name: '細胞の周りから運び去られる乳酸', abbr: '流出', computed: true,
      stoich: { lacOut: -1 }, thermo: { reversible: false },
      kinetics: { type: 'mm', km: { lacOut: 5000 } }, vmaxBase: 100, simplifications: ['A11'] },

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
    { id: 'glut', name: 'グルコース輸送体の発現', desc: 'グルコースを細胞の外から自動で取り込む。最大輸送能力（細胞の中が空のときの速さ）が Lv ごとに +0.4 u/秒。細胞の中のグルコースが増えると、実際に入る速さは下がる。',
      costBase: 8, costGrowth: 1.45, maxLevel: 30,
      effect: { type: 'vmax', reactions: ['glut'], perLevel: 0.4, mode: 'add' } },
    { id: 'prep', name: '準備期の酵素の発現', desc: '準備期の5酵素の最大速度 +50%（Lv あたり）。',
      costBase: 15, costGrowth: 1.4, maxLevel: 25,
      effect: { type: 'vmax', reactions: PREP, perLevel: 0.5, mode: 'mul' } },
    { id: 'pay', name: '回収期の酵素の発現', desc: '回収期の5酵素の最大速度 +50%（Lv あたり）。',
      costBase: 15, costGrowth: 1.4, maxLevel: 25,
      effect: { type: 'vmax', reactions: PAY, perLevel: 0.5, mode: 'mul' } },
    // v0.2.0：+40% → +80%。PFK-1 の調節で解糖系の流れが ATP の消費に合うようになり、研究ポイント（ピルビン酸）の入り方が
    //  ATP の消費の速さで決まるようになったため（ゲーム経済の調整。dev/tools/economy.js で MCT まで約50分を確認）
    { id: 'work', name: '細胞活動の活性化', desc: 'ATP 消費速度 +80%（Lv あたり）。',
      costBase: 12, costGrowth: 1.45, maxLevel: 25,
      effect: { type: 'vmax', reactions: ['atpase'], perLevel: 0.80, mode: 'mul' } },
    { id: 'nadsalv', name: 'NAD⁺ の追加合成（抽象化）', desc: '新たな NAD⁺ 分子を 100 u 加える。',
      // 価格は「現在の細胞での購入回数」で上がり、新しい細胞で初期価格に戻る（初期のプレステージの流れ）。
      // levels.nadsalv は累計の購入回数（統計）として保持する。
      costBase: 20, costGrowth: 1.6, maxLevel: 999, consumable: true, perCell: true, abstraction: 'A1',
      effect: { type: 'add', species: 'nad', amount: 100 } },
    { id: 'micro', name: '解糖系の内部を解析する', desc: '解糖系を10の酵素反応に分けて見られるようになり、酵素の解析が始まる。',
      costBase: 80, costGrowth: 1, maxLevel: 1,
      requires: { test: s => s.totals.pyrProduced >= 500, text: 'ピルビン酸を累計 500 つくると研究できる' },
      effect: { type: 'unlock', view: 'micro' } },
    // 0.3：NAD⁺ の再生。答え（LDH）を見る前に、問題（NAD⁺ 不足と補充）を経験していることを条件にする。
    { id: 'nadregen', name: 'NAD⁺ の再生', desc: 'NADH を NAD⁺ に戻す反応を探す。ピルビン酸の行き先の解析が始まる。',
      costBase: 300, costGrowth: 1, maxLevel: 1,
      requires: { test: s => MB.NADREGEN_CONDITIONS.every(c => c.test(s)), text: null, list: 'NADREGEN_CONDITIONS' },
      effect: { type: 'unlock', analysis: 'ldh' } },
    // 0.4：乳酸の行き先。乳酸がたまり続けていることを観察してから
    { id: 'lacexit', name: '乳酸の行き先', desc: '細胞の中にたまる乳酸が、細胞膜を越えられるかを調べる。膜の輸送の解析が始まる。',
      costBase: 600, costGrowth: 1, maxLevel: 1,
      requires: { test: s => MB.LACEXIT_CONDITIONS.every(c => c.test(s)), text: null, list: 'LACEXIT_CONDITIONS' },
      effect: { type: 'unlock', analysis: 'mct' } }
  ];

  /* 乳酸の行き先の研究ができる条件（0.4）：量だけでなく、LDH が働いて乳酸が増え続けていること（記録 lac_accum） */
  MB.LACEXIT = { amount: 1500, rate: 0.5 };
  MB.LACEXIT_CONDITIONS = [
    { id: 'ldh', text: '乳酸デヒドロゲナーゼ（LDH）を同定する', test: s => (s.levels.enz_ldh || 0) >= 1 },
    { id: 'accum', text: '細胞の中に乳酸がたまり続けているのを観察する（乳酸 1,500 u 以上で、なお増えている）',
      test: s => s.milestones && s.milestones.lac_accum != null }
  ];

  /* NAD⁺ の再生の研究ができる条件（研究タブにそのまま一覧で表示する） */
  MB.NADREGEN_CONDITIONS = [
    { id: 'gly', text: '解糖系の10の酵素をすべて同定する',
      test: s => MB.MICRO_IDS.every(id => (s.levels['enz_' + id] || 0) >= 1) },
    { id: 'low', text: 'NAD⁺ の不足（回収期の停滞）を経験する',
      test: s => s.milestones && s.milestones.nad_low != null },
    { id: 'refill', text: 'NAD⁺ を一度でも補充する',
      test: s => (s.levels.nadsalv || 0) >= 1 }
  ];
  // 酵素ごとの研究：Lv1 ＝「同定」（解析が 100% に達するか、RP で即時同定）。Lv2 以降で最大速度 +50%/Lv
  /* 酵素・輸送体の研究（enzyme は対象のタンパク質の反応 id。研究の id は反応の gate、なければ 'enz_' + id） */
  for (const id of [...MB.MICRO_IDS, 'ldh', 'mct']) {
    const isTr = id === 'mct';
    MB.UPGRADES.push({
      id: isTr ? 'tr_mct' : 'enz_' + id, enzyme: id, protein: isTr ? 'transporter' : 'enzyme', name: null, desc: null,
      costBase: 25, costGrowth: 1.45, maxLevel: isTr ? 5 : 15,   // MCT の強化は RP を増やさない（細胞内の乳酸の落ち着く量を下げるだけ）ので上限を低くする
      requires: id === 'mct'
        ? { test: s => (s.levels.lacexit || 0) >= 1, text: '「乳酸の行き先」の研究が必要' }
        : id === 'ldh'
        ? { test: s => (s.levels.nadregen || 0) >= 1, text: '「NAD⁺ の再生」の研究が必要' }
        : { test: s => (s.levels.micro || 0) >= 1, text: '「解糖系の内部を解析する」の研究が必要' },
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
    perGlucose: { prep: 1, pay: 2 },      // グルコース1分子あたり、その酵素の反応が何回進むか
    /* 0.3：分岐の酵素（両端からの解析とは別枠）。
     *  LDH は同定するまで反応しない（gate）ため、自分の進行量では解析が進まない。
     *  そこで「基質（ピルビン酸）がどれだけ流れてきたか」＝ source 反応の正味の進行量で解析する。
     *  per: source の進行量を何で割ってグルコース換算にするか（PK はグルコース1分子あたり2回）。
     *  after: 解析中になる研究。 */
    branches: {
      ldh: { after: 'nadregen', source: 'pk', per: 2, need: 300, cost: 150 },
      // 0.4：MCT も同定するまで運ばないので、乳酸がどれだけつくられたか（LDH の正味の進行量）で解析する
      mct: { after: 'lacexit', source: 'ldh', per: 2, need: 400, cost: 220 }
    }
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
      text: '10の酵素をすべて同定した。解糖系の全体像が見えた。' },
    { id: 'nadregen', test: s => (s.levels.nadregen || 0) >= 1,
      text: 'NAD⁺ の再生の研究を始めた。NAD⁺ は使い捨てではなく、NADH を NAD⁺ に戻せれば解糖系を続けられる。ピルビン酸の行き先の解析が始まった。' },
    // SELF-SUSTAINING：LDH 獲得後、NAD⁺ を外部から補充せずに解糖系を維持した（sim.js が knowledge.regen を更新）
    { id: 'self_sustaining', test: s => s.knowledge && s.knowledge.regen && s.knowledge.regen.best >= MB.SELF_SUSTAIN.seconds,
      text: 'SELF-SUSTAINING ― NAD⁺ を外部から補充せずに、5分間解糖系を維持した。NAD⁺ は NADH との間を循環している。' }
  ];
  /* 0.4 乳酸の観察と、出入りのつり合い */
  MB.MILESTONES.push(
    { id: 'lac_accum', test: s => (s.levels.enz_ldh || 0) >= 1 && s.amounts.lac >= MB.LACEXIT.amount && (s.flux.ldh || 0) >= MB.LACEXIT.rate && !(s.switches && s.switches.ldhOff),
      text: '乳酸が細胞の中にたまり続けている。乳酸は、細胞の外へ出ていけないのだろうか？（研究タブ「乳酸の行き先」）' },
    { id: 'lac_balance', test: s => s.knowledge && s.knowledge.balance && s.knowledge.balance.best >= MB.LAC_BALANCE.seconds,
      text: 'LACTATE BALANCE ― 乳酸の生成（LDH）と細胞外への排出（MCT）がつり合った。細胞の中の乳酸は、ほぼ一定に保たれている。' }
  );
  /* つり合いの判定：MCT 同定後、排出の速さが生成の速さの ±tol 以内、かつ生成が minRate 以上の状態が seconds 秒続く */
  MB.LAC_BALANCE = { seconds: 60, tol: 0.05, minRate: 0.5 };

  /* SELF-SUSTAINING の判定：LDH 同定後、補充なしで seconds 秒、かつその間にピルビン酸を minPyr 以上つくる */
  MB.SELF_SUSTAIN = { seconds: 300, minPyr: 200 };
})(typeof window !== 'undefined' ? window : globalThis);
