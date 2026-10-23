/* 表示文言の検査： node dev/tests/text_lint.js（v0.1.0 公開版）
 * GPT 審査（UI改修r1）の必須修正が後戻りしないよう、画面に出る文言を機械的に確認する。 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..', 'public');
require(path.join(root, 'js/data.js'));
require(path.join(root, 'js/glossary.js'));
require(path.join(root, 'js/sim.js'));
const MB = globalThis.MB;

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fail++; };

/* 画面に出るテキストを集める */
const texts = [];
for (const [k, t] of Object.entries(MB.GLOSSARY)) texts.push([`GLOSSARY.${k}`, t.title + ' ' + t.short + ' ' + t.body]);
for (const g of MB.GOALS) texts.push(['GOALS', g.text + ' ' + (typeof g.hint === 'function' ? g.hint(MB.Sim.createState()) : (g.hint || ''))]);
for (const c of [...MB.NADREGEN_CONDITIONS, ...MB.LACEXIT_CONDITIONS]) texts.push(['CONDITIONS', c.text]);
for (const m of MB.MILESTONES) texts.push([`MILESTONES.${m.id}`, m.text]);
for (const [k, u] of Object.entries(MB.UPGRADE_TEXT)) texts.push([`UPGRADE_TEXT.${k}`, u.name + ' ' + u.line]);
for (const u of MB.UPGRADES) texts.push([`UPGRADES.${u.id}`, (u.desc || '') + ' ' + ((u.requires && u.requires.text) || '')]);
texts.push(['index.html(event)', '']);
for (const [k, t] of Object.entries(MB.ENZYME_TEXT)) texts.push([`ENZYME_TEXT.${k}`, t]);
for (const r of MB.REACTIONS) texts.push([`REACTIONS.${r.id}`, JSON.stringify([r.regulation || [], r.notImplemented || []])]);
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
texts.push(['ui.js', ui], ['index.html', html]);

console.log('[1] 審査で修正を求められた表現が残っていない');
const banned = [
  ['充電', '必須修正1：ATP ゲージは「ATP の割合」（比喩としての「充電済みの電池」は解説カードのみ可）'],
  ['見つかっていない', '必須修正4：「まだ解放されていない（未実装）」に統一'],
  ['未解明', '必須修正4：「未解放」に統一'],
  ['取り戻せます', '必須修正8：補充で再開できると断定しない'],
  ['渋滞', '必須修正6：「処理待ち（ゲーム上の処理能力制限）」に変更'],
  ['処理待ち', '0.2 審査 Q3：S9（処理待ち）を廃止'],
  ['ATP が使われるたびに', '0.2.1：研究ポイントの出どころをピルビン酸の生成量に変更（A3）'],
  ['見つけた', '0.2.2 審査 §1：「発見」ではなく「同定」を基本表現にする'],
  ['観察中', '0.2.2 審査 §1：「解析中」を使う'],
  ['内部を観察', '0.2.2 審査 §1：「解糖系の内部を解析する」に統一'],
  ['未解放の酵素', '0.2.2：酵素は「解析中／解析待ち」で表す'],
  ['回/秒', '必須修正7：回収期の速さの単位を明確に'],
  ['グルコース換算）', '0.2.3：速さは「グルコース ○/秒」「ピルビン酸 ○/秒」と物質名で表示（換算をやめた）'],
  ['途中の物質', '0.2.3：「中間体」に統一'],
  ['1分子 → 2分子に割る', '0.2.3：常時表示から外し、用語カードで説明']
];
for (const [w, why] of banned) {
  const hits = texts.filter(([where, t]) => {
    if (w === '充電' && where === 'GLOSSARY.atp') return false;    // 比喩として残すことは承認済み
    return t.includes(w);
  }).map(([where]) => where);
  ok(hits.length === 0, `「${w}」なし ― ${why}${hits.length ? '　→ 残存: ' + hits.join(', ') : ''}`);
}

console.log('[2] 審査で追加を求められた説明が入っている');
const G = MB.GLOSSARY;
ok(/アデニル酸エネルギーチャージ/.test(G.atp.body) && /アデニル酸エネルギーチャージ/.test(html), '必須修正1：ATP の割合とエネルギーチャージの違い（用語カード＋詳細タブ）');
ok(/加水分解/.test(G.atp.body) && /自由エネルギー/.test(G.atp.body) && /共役/.test(G.atp.body), '必須修正2：ATP 加水分解を自由エネルギー変化・共役で説明');
ok(/ヒドリド/.test(G.nad.body) && /H⁺/.test(G.nad.body), '必須修正3：NAD⁺ のヒドリド移動とプロトン放出');
ok(/GAP.*1分子あたり/.test(G.pay.body), '必須修正5：回収期の ATP 生成を GAP 1分子あたりで明記');
ok(/TPI|イソメラーゼ/.test(G.tp.body) && /異性化/.test(G.tp.body), '必須修正5：DHAP → GAP の異性化を説明');
ok(!G.inhib, '0.2 審査 Q3：「処理待ち」の用語カードを削除（S9 廃止）');
ok(/`グルコース \$\{fmt2\(f\)\} \/秒`/.test(ui) && /`ピルビン酸 \$\{fmt2\(state\.flux\.pk/.test(ui) && /ピルビン酸 ○\/秒/.test(G.pay.body), '必須修正7（0.2.3 で表記変更）：回収期の速さは「ピルビン酸 ○/秒」と物質名で明示し、用語カードで準備期との関係を説明');
ok(/GAP（グリセルアルデヒド3-リン酸）1分子あたり/.test(G.pay.body) && /ATP などの個数は、グルコース1個あたり/.test(ui), '必須修正5・7：GAP 1分子あたりの説明（用語カード）と、個数がグルコース1個あたりである注記（図）は維持');
ok(/三炭糖リン酸もその一つ/.test(G.mid.body), '0.2.3：用語カード「中間体」（三炭糖リン酸も中間体であることを明記）');
ok(/研究の効果（/.test(ui) && /研究しなかった場合/.test(ui) && /compareUpgrade/.test(ui) && /×/.test(ui), '0.2.3：研究の効果を倍率と「研究しなかった場合」との比較で知らせる');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
ok(['#23262b', '#8fa6bf', '#c2a46a', '#c0564f', '#9aa1a9'].every(c => css.includes(c)) && !/radial-gradient/.test(css), '0.2.3：配色を「薬歴」の色（チャコール・青灰・くすんだ金・くすんだ赤）にそろえ、ぼやけの原因（背景の光のグラデーション）を除いた');
ok(!/fonts\.googleapis/.test(html), '外部フォントを読み込まない（薬歴と同じ端末の標準フォント）');
ok(/場合があります|とは限りません|可能性があります/.test(ui), '必須修正8：停止時の説明が断定形でない');

console.log('[2b] Prototype 0.2 の審査で求められた説明');
ok(/このゲームのモデル/.test(ui) && !/全停止を防ぐ/.test(ui + JSON.stringify(G)), '0.2 必須修正4：NAD⁺ 枯渇後の ATP 枯渇を「このゲームのモデルでの挙動」として説明');
ok(/グルコキナーゼ/.test(G.hkreg.body) && /グルコキナーゼ/.test(JSON.stringify(MB.REACTIONS.find(r => r.id === 'hk').regulation)), '0.2 Q4：HK のアイソザイムの違い（グルコキナーゼ）を注記');
ok(/−2\.8/.test(ui) && /\+1\.7/.test(ui), '0.2 Q5：エノラーゼの ΔG°′ の採用値と文献値の相違を表示');
ok(/1 u = 0\.1 mM/.test(G.kgame.body) && /1 u ＝ 0\.1 mM/.test(html), '0.2 必須修正3：単位系（1 u = 0.1 mM・名目）を用語カードと詳細タブに明記');
ok(/平衡そのもの/.test(G.rev.body) && /速さだけ/.test(G.rev.body), '可逆反応のカード：研究は平衡を変えず速さだけを変える');
ok(MB.MICRO_IDS.every(id => MB.ENZYME_TEXT[id]), '10酵素すべてに説明文がある');
ok(/state を書き換えない|state に触れない/.test(ui), '表示の切り替えが state を変えないことをコードに明記');

ok(/買うたびに上がる/.test(G.cellloop.body) && /最初の状態に戻る/.test(G.cellloop.body) && /買うたびに上がり/.test(MB.UPGRADE_TEXT.nadsalv.line), '0.2 審査 §2：NAD⁺ 補充の価格が細胞ごとであることを説明');
// v0.2.0：PFK-1 の調節を実装したため、0.2 審査 Q2 の「調節を省略したこのモデルでの挙動」という断りは不要になった。代わりに調節の説明があることを確かめる
ok(!/PFK-1 の調節を省略/.test(ui) && /PFK-1 が解糖系の流れを絞っています/.test(ui) && /ATP による PFK-1 の抑制/.test(JSON.stringify(MB.GLOSSARY)), '0.2 審査 Q2 → v0.2.0：ATP 満タン時の説明は「PFK-1 の調節を省略」ではなく、実装した調節（PFK-1 が流れを絞る）で説明する');
ok(/ピルビン酸の生成量/.test(G.rp.body), '研究ポイントの出どころ（ピルビン酸の生成量）を用語カードで説明');

ok(/解析順序はゲーム上の表現です。実際の酵素の発見史、反応速度、律速性を表すものではありません。/.test(G.analysis.body), '0.2.2 審査 §2：解析順序に科学的意味がないことを明記');
ok(/実際に反応した分子の数や酵素が働いた回数ではない/.test(G.analysis.body) && /正味の流れと前向き・後ろ向きの反応の総量は一致しない/.test(G.analysis.body), '0.2.2 審査 §3：解析進捗は「代謝 flux から算出したゲーム上の値」と説明');
ok(/を同定した/.test(fs.readFileSync(path.join(root, 'js/sim.js'), 'utf8')) && /ENZYME IDENTIFIED/.test(ui), '0.2.2 審査 §1：「○○を同定した」「ENZYME IDENTIFIED」');
ok(/解析中/.test(ui) && /解析待ち/.test(ui), '内部表示・研究タブで「解析中」「解析待ち」を表示');

console.log('[2c] Prototype 0.3（乳酸デヒドロゲナーゼ・NAD⁺ の再生・嫌気的条件）');
const all = texts.map(t => t[1]).join('\n');
const shown = texts.filter(([w]) => !/^REACTIONS/.test(w)).map(t => t[1]).join('\n');
ok(!/NAD⁺ ?を(新しく)?(作る|つくる|生産|生成する)|NAD⁺ の(生産|生成)/.test(shown), '§3：「NAD⁺ を作る／生産する」と書かない（「再生する」）');
ok(/再生/.test(G.nadregen.body) && /使い捨て/.test(G.nadregen.body) && /使い捨て/.test(G.nad.body), '§9：NAD⁺ は使い捨てではなく、NADH から戻せば解糖系を続けられる');
ok(/NAD⁺が不足すると|NAD⁺ が不足すると/.test(G.nadregen.body) && /NADH を再び NAD⁺ へ戻す反応があれば、解糖系を続けることができる/.test(G.nadregen.body), '§9：研究開始時の文（指示書の例文）');
ok(/唯一の方法ではない/.test(G.nadregen.body) && /電子伝達系/.test(G.nadregen.body) && /シャトル/.test(G.nadregen.body), '§9：乳酸の生成を「NAD⁺ を再生する唯一の方法」と説明しない（酸素・ミトコンドリア・シャトル系に言及）');
ok(/ATP を追加でつくることではなく/.test(G.nadregen.body) && /ATP はできない/.test(MB.ENZYME_TEXT.ldh) && /ATP はできない/.test(html), '§3：乳酸の生成を ATP の追加生産経路として扱わない');
ok(/このゲームでは、酸素を利用したミトコンドリアでのNADH再酸化を利用できない条件としてモデル化しています。/.test(G.anaerobic.body), '追加前提：嫌気的条件の用語カードの補足文（指示どおりの文）');
ok(/ANAEROBIC/.test(html) && /data-term="anaerobic"/.test(html), '追加前提：ENVIRONMENT ANAEROBIC の表示があり、用語カードにつながる');
ok(!/酸素がない(と|ときに?)乳酸|酸素がないときだけ(起こる|つくられる)|無酸素だから/.test(shown.replace(/乳酸の生成は、酸素がないときだけ起こるものではありません/g, '')), '追加前提：「酸素がないと乳酸がつくられる」「乳酸発酵は酸素がないときだけ」と説明しない');
ok(/酸素がある細胞でも乳酸はつくられます/.test(G.anaerobic.body), '追加前提：乳酸の生成は酸素存在下でも起こり得ることを明記');
ok(/Pyruvate \+ NADH \+ H⁺ ⇄ Lactate \+ NAD⁺/.test(html) && /H⁺ は一定/.test(ui), '§4：正式な式（H⁺ を含む）を表示し、計算上の簡略化を説明');
ok(/ENZYME IDENTIFIED/.test(html) && /LACTATE DEHYDROGENASE/.test(html) && /乳酸デヒドロゲナーゼ/.test(html) && /NADH を NAD⁺ へ戻す経路が見つかった。/.test(html), '§10：LDH 同定の強調演出（ENZYME IDENTIFIED・英名・和名・式・一文）');
ok(/SELF-SUSTAINING/.test(MB.MILESTONES.map(m => m.text).join()) && !/完全な自己維持|自給自足/.test(all), '§11：SELF-SUSTAINING。過大な表現を使わない');
ok(/救済措置/.test(MB.UPGRADE_TEXT.nadsalv.line) && /救済措置/.test(G.anaerobic.body), '追加前提：NAD⁺ 補充を「外部からの救済措置」と位置づける');
ok(/乳酸の生成だけではない/.test(MB.GOALS[MB.GOALS.length - 1].text) && !/最終解決|根本的に解決した/.test(all), '§19：0.3 を NAD⁺ 問題の最終解決と表現しない（次の疑問へつなぐ）');
ok(/出口.*まだ実装していない|まだ実装していない/.test(G.lac.body) && /コリ回路/.test(G.lac.body), '§6：乳酸の出口は未実装であることを明記');
ok(MB.ENZYME_TEXT.ldh && MB.UPGRADE_TEXT.nadregen, 'LDH の説明文・「NAD⁺ の再生」の表示名');
ok(/ゲーム上の表現/.test(G.analysis.body), '§13：解析進捗はゲーム上の抽象化（既存の説明を維持）');

console.log('[2d] Prototype 0.4（MCT・細胞の外）');
{
  const all4 = texts.map(t => t[1]).join('\n');
  const M = G.mct.body;
  ok(/H⁺ といっしょに 1:1/.test(M) && /共輸送/.test(M) && /電気的に中性/.test(M), '§3：MCT は乳酸と H⁺ を共輸送（1:1・電気的に中性）');
  ok(/双方向性/.test(M) && /正味の輸送方向は、細胞内外の乳酸濃度と H⁺ 勾配によって決まり/.test(M) && /中へ運ばれる/.test(M), '§3：MCT は双方向。正味の輸送方向は乳酸濃度と H⁺ 勾配で決まる（0.4.1 修正 A）');
  ok(!/乳酸の濃度差に従って|濃度差に従って/.test(texts.map(t => t[1]).join('\n')), '0.4.1 修正 A：「（乳酸の）濃度差に従って運ばれる」という説明が残っていない');
  ok([M, ui, html, MB.ENZYME_TEXT.mct].every(t => !/濃度差（積）に従って|濃度差に従ってどちら向き/.test(t)) && /H⁺ 勾配/.test(MB.ENZYME_TEXT.mct) && /H⁺ 勾配/.test(ui) && /H⁺ 勾配/.test(html), '0.4.1 修正 A：用語カード・酵素の説明・MCT のカード・演出のすべてで「乳酸濃度と H⁺ 勾配」');
  ok(/MCT4 は解糖活性の高い細胞で乳酸の排出に関与することが多いが、輸送自体は双方向性である/.test(M) && /MCT4 は解糖活性の高い細胞で乳酸の排出に関与することが多いが、輸送自体は双方向性である/.test(ui) && !/乳酸を外へ出す役割をもつ MCT4|解糖が盛んな細胞で乳酸を外へ出す/.test(M + ui), '0.4.1 修正 B：MCT4 を排出専用と誤解させない');
  ok(/ゲーム独自の単位/.test(G.unit.body) && /実際の細胞内の濃度/.test(G.unit.body) && /ゲーム独自の単位で、実際の細胞内の乳酸濃度を表すものではありません/.test(html) && /実際の細胞内の乳酸濃度を表すものではない/.test(G.lac.body) && /実際の乳酸濃度を表すものではない/.test(G.extracellular.body) && /ゲーム独自の単位/.test(html), '0.4.1 修正 C：u はゲーム独自の単位で、実際の乳酸濃度ではない（用語カード「単位 u」・乳酸・細胞外・乳酸の出入り欄・詳細タブ）');
  ok(MB.LACEXIT.amount === 1500, '0.4.1 修正 C：発見条件の数値（1,500 u）は変更しない');
  ok(/ATP を直接使うポンプではない/.test(M) && /ATP は使わない/.test(MB.ENZYME_TEXT.mct), '§3：MCT は ATP を直接使うポンプではない');
  ok(!/外へだけ|一方向にしか|常に外へ|外向きにしか/.test(texts.filter(([w]) => w !== 'GLOSSARY.irrev').map(t => t[1]).join('\n')), '§3：MCT が常に一方向へ運ぶかのような表現がない（不可逆反応のカードの「ほぼ一方向にしか進まない反応」は対象外）');
  ok(!/毒性|有害|毒/.test(all4), '§3：乳酸の蓄積を毒性と同一視しない（「毒」「有害」を使わない）');
  ok(/それだけで細胞が壊れたり解糖系が止まったりするわけではない/.test(G.lac.body) && /質量作用/.test(G.lac.body), '§3：蓄積しても直ちに停止ではない。実際に起こるのは LDH の質量作用だけ');
  ok(/MCT4 を参考/.test(M) && /MCT1/.test(M) && /低酸素で発現が増える/.test(M), '§7-1：アイソフォーム（MCT4 を参考、MCT1 との違い）を用語カードに明記');
  ok(/酸性に傾くのを防ぐ一因/.test(M) && /pH を一定とみなしている/.test(M), 'H⁺ の排出の意味（pH）と、この版では pH を一定とみなすことを明記');
  ok(/物質そのものは変えずに/.test(G.transporter.body) && /酵素/.test(G.transporter.body), '§8：LDH（酵素）と MCT（輸送体）を区別する用語カード');
  ok(/最小限のモデル/.test(G.extracellular.body) && /体積は細胞の中と同じ/.test(G.extracellular.body) && /行き先は、まだ実装していない/.test(G.extracellular.body) && /今後のアップデートで解放予定/.test(G.extracellular.body), '§5・§6：細胞の外は予告と最小限のモデル。簡略化を明記');
  for (const t of ['TRANSPORT SYSTEM UNLOCKED', '細胞外への道が開かれた。', '乳酸とH⁺を細胞膜の外へ運ぶ輸送経路が成立した。', '細胞内で完結していた代謝は、外部環境との物質交換へと広がっていく。', 'EXTRACELLULAR SPACE', '細胞外環境・細胞間代謝', '今後のアップデートで解放予定'])
    if (!html.includes(t)) ok(false, '演出の文が足りない：' + t);
  ok(true, '§5：MCT 獲得の演出（提案書の表示文案どおり7要素）');
  ok(/EXTRACELLULAR/.test(html) && /id="extra"/.test(html) && /EXTRACELLULAR/.test(ui), '§5：細胞タブと全体図に EXTRACELLULAR の領域');
  ok(/LACTATE BALANCE/.test(MB.MILESTONES.map(m => m.text).join()), '§4.4：乳酸の生成と排出のつり合いのマイルストーン');
  ok(/嫌気的条件/.test(G.anaerobic.title + G.anaerobic.body) && MB.ENVIRONMENT.id === 'anaerobic' && !MB.ENVIRONMENT.mitochondria, '§8：嫌気的条件は変更しない');
}

console.log('[2e] v0.1.0 公開版（v0.2.0 で版を更新）');
{
  const pub = path.join(__dirname, '..', '..', 'public');
  const shownTexts = texts.filter(([w]) => !/^REACTIONS/.test(w) && w !== 'ui.js' && w !== 'index.html').map(t => t[1]).join('\n');
  const htmlBody = html.replace(/<!--[\s\S]*?-->/g, '');
  ok(!/Prototype|プロトタイプ/.test(shownTexts) && !/Prototype/.test(htmlBody), '画面に出る文言に「Prototype」が残っていない（開発中の版の呼び名）');
  ok(/id="ver">v0\.2\.2</.test(html) && /id="about-ver">v0\.2\.2</.test(html) && /const VERSION = 'v0\.2\.2'/.test(ui) && /<title>METABOLISM — 代謝のインクリメンタルゲーム<\/title>/.test(html), 'タイトルとバージョン v0.2.2');
  ok(G.howto && G.simplify && G.saveinfo && /data-term="howto"/.test(html) && /btn-help/.test(html) && /openTerm\('howto'\)/.test(ui), '遊び方・このゲームの単純化・保存についての説明があり、「?」ボタンと詳細タブから開ける');
  ok(/量の単位 u はゲーム独自の単位/.test(G.simplify.body) && /嫌気的条件/.test(G.simplify.body) && /解析・同定/.test(G.simplify.body) && /ゲーム上の仕組み/.test(G.simplify.body), '単純化の注記：単位・嫌気的条件・解析と同定・ゲーム上の仕組み');
  ok(/if \(DEBUG\) window\.__METABOLISM_DEBUG__/.test(ui) && !/^\s*window\.__METABOLISM_DEBUG__/m.test(ui) && /if \(DEBUG\) \{ \$\('dbg-line'\)/.test(ui), '開発者向けの窓口（state の公開）と計算の健全性の表示は ?debug のときだけ');
  const all = ['index.html', 'css/style.css', 'js/data.js', 'js/glossary.js', 'js/sim.js', 'js/savecode.js', 'js/aggregate.js', 'js/ui.js'].map(f => fs.readFileSync(path.join(pub, f), 'utf8')).join('\n');
  // v0.2.2：<head> の canonical と og の項目にある自サイトの住所（共有プレビュー用。読み込みも通信もしない）だけは数えない。
  //  それ以外の場所・それ以外の住所は、これまでどおり外部の URL として失敗させる
  const selfMeta = /<link rel="canonical" href="https:\/\/konnyaku-metabolism\.pages\.dev\/[^"]*">|<meta property="og:[a-z:_]+" content="https:\/\/konnyaku-metabolism\.pages\.dev\/[^"]*">/g;
  const allNoCredits = all.replace(/<head>[\s\S]*?<\/head>/, h => h.replace(selfMeta, '')).replace(/<dl class="credits"[\s\S]*?<\/dl>/, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!fs.existsSync(path.join(pub, 'og-image.jpg')) && !fs.existsSync(path.join(pub, 'favicon.svg')) && /og:image" content="https:\/\/konnyaku-metabolism\.pages\.dev\/ogp\.png"/.test(html), 'v0.2.2：共有プレビューの画像は ogp.png だけ。使われていない og-image.jpg・favicon.svg が public/ に残っていない');
  ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(allNoCredits) && !/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|import\(|document\.cookie/.test(all), '外部への通信・外部の URL・Cookie を使わない（SVG の名前空間 URI と、作者・ライセンス欄のリンク・コメントを除く）');
  const links = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>/g)];
  ok(links.length === 3 && links.every(m => /target="_blank"/.test(m[0]) && /rel="noopener/.test(m[0])) && links.map(m => m[1]).join() === 'https://note.com/irribow1993,LICENSE.txt,https://creativecommons.org/licenses/by-nc-sa/4.0/deed.ja',
    'リンクは作者・ライセンス欄の3つだけ（note・LICENSE.txt・CC BY-NC-SA 4.0）。新しいタブで開き、noopener 付き。クリックするまで読み込まれない');
  ok(/GNU General Public License v3\.0/.test(html) && /CC BY-NC-SA 4\.0/.test(html) && /こんにゃくお爺さん/.test(html) && fs.existsSync(path.join(pub, 'LICENSE.txt')) && /GNU GENERAL PUBLIC LICENSE/.test(fs.readFileSync(path.join(pub, 'LICENSE.txt'), 'utf8')), 'サイト上に作者・ライセンス（GPL-3.0 の全文 LICENSE.txt、解説文は CC BY-NC-SA 4.0）を表示');
  ok(/CC BY-NC-SA 4\.0/.test(fs.readFileSync(path.join(pub, 'js/glossary.js'), 'utf8').slice(0, 800)), 'glossary.js の先頭に、解説文のライセンス（CC BY-NC-SA 4.0）の表示');
  ok(!/\beval\(|new Function\(/.test(all) && !/<script>(?!\s*<\/script>)/.test(html) && !/ on[a-z]+="/.test(html), 'eval・インラインのスクリプト・インラインのイベント属性がない（CSP の script-src \'self\' で動く）');
  const hdr = fs.readFileSync(path.join(pub, '_headers'), 'utf8');
  ok(/Content-Security-Policy: default-src 'none'; script-src 'self'/.test(hdr) && /connect-src 'none'/.test(hdr) && /frame-ancestors 'none'/.test(hdr), 'Cloudflare Pages の _headers に CSP（自サイトのみ・通信なし・埋め込み禁止）');
  ok((ui.match(/localStorage\.(getItem|setItem|removeItem)\('?([A-Z_]+)/g) || []).every(x => /SAVE_KEY|VIEW_KEY|INTRO_KEY|BACKUP_KEY/.test(x)), 'localStorage に保存するのは、セーブ・表示の切り替え・初回の案内・読み込む前のセーブ（v0.1.2）の4つだけ');
}

console.log('[2f] v0.1.1：フォント');
{
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css/style.css'), 'utf8');
  const last = css.slice(css.indexOf('v0.1.1：フォントをそろえる'));
  ok(/font-variant-numeric: tabular-nums/.test(last) && ['#flow .lac-enz', '#flow .ex-l', '.env', '.ev-en', '.rg-k', '#flow .s-rate', '.upg button'].every(sel => last.includes(sel)) && /font-family: var\(--sans\)/.test(last),
    '英字のラベル（LDH・MCT・EXTRACELLULAR・ANAEROBIC など）と日本語まじりの表示は本文のフォント。数字は等幅の数字（tabular-nums）');
  ok(/x: 286, y: 412, class: 'lac-enz mct-l'/.test(ui) && /#flow \.lac-enz\.mct-l \{ text-anchor: start; \}/.test(css), '全体図の「MCT」の文字を左寄せにして、矢印の線の右に置いた（中央寄せで線に重なっていた）');
}


console.log('[2g] v0.1.2：セーブの書き出し・読み込み、第1章 完');
{
  const pub = path.join(__dirname, '..', '..', 'public');
  const sc = fs.readFileSync(path.join(pub, 'js/savecode.js'), 'utf8');
  ok(/<script src="js\/sim\.js"><\/script>\n<script src="js\/savecode\.js"><\/script>/.test(html), 'savecode.js は sim.js の直後に読み込む（自サイトのファイル。CSP はそのまま）');
  ok(!/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|innerHTML|eval\(/.test(sc), 'savecode.js は通信も innerHTML も使わない');
  ok(/BACKUP_KEY = 'metabolism\.save\.backup'/.test(ui) && /if \(replacing\) return;/.test(ui), '読み込む前のセーブを1件残す。差し替えのあとは古い state で保存しない');
  ok(/lastSaved = Date\.now\(\);\s+\/\/ 書き出してからの時間で留守中の進行が起きないようにする/.test(ui), '読み込んだセーブでは留守中の進行を起こさない');
  const last = MB.GOALS[MB.GOALS.length - 1];
  const card = html.slice(html.indexOf('id="event-ch1"'), html.indexOf('<script src="js/data.js">'));
  ok(last.final && /^第1章 完/.test(last.text) && /CHAPTER 1 COMPLETE/.test(card) && /第1章 解糖系と発酵 完/.test(card), '第1章 完の画面と、最後の目標（次の章の予告）');
  const teaser = [last.hint, card, (ui.match(/const CH1_NOTE = '([^']+)'/) || [])[1]].join('\n');
  ok(/酸素があっても(、)?乳酸はつくられ得る/.test(teaser) && !/酸素があれば乳酸は|酸素がないと乳酸|酸素がないときだけ/.test(teaser), '次の章の予告は「酸素があっても乳酸はつくられ得る」と矛盾しない');
  ok(/詳細タブの「書き出す」/.test(G.saveinfo.body) && /読み込む前に戻す/.test(G.saveinfo.body) && /自動では共有されません/.test(G.saveinfo.body), '「保存について」に書き出し・読み込みの説明');
}

console.log('[3] 参照の整合性');
const termRefs = new Set();
for (const re of [/data-term="([a-z]+)"/g, /term: '([a-z]+)'/g, /'data-term', '([a-z]+)'/g, /openTerm\('([a-z]+)'\)/g, /pipe\('\w+', \d+, \d+, '[^']+', '([a-z]+)'/g])
  for (const m of (ui + html).matchAll(re)) termRefs.add(m[1]);
const missing = [...termRefs].filter(k => !G[k]);
ok(missing.length === 0, `用語カードの参照先がすべて存在（${[...termRefs].join(', ')}）${missing.length ? ' → 不足: ' + missing : ''}`);
const badUp = MB.GOALS.filter(g => g.upgrade && !MB.UPGRADES.some(u => u.id === g.upgrade));
ok(badUp.length === 0, '目標が参照する研究 id がすべて存在');
ok(MB.UPGRADES.every(u => MB.UPGRADE_TEXT[u.id] || (u.enzyme && MB.ENZYME_TEXT[u.enzyme])), 'すべての研究にやさしい表示名がある（酵素は酵素の説明文）');

console.log(fail ? `\n${fail} 件失敗` : '\nすべて成功');
process.exit(fail ? 1 : 0);
