/* METABOLISM v0.1.2 検証：セーブの書き出し・読み込み  node dev/tests/savecode_tests.js
 * C1   代謝の計算が v0.1.1 とビット単位で同じ（v0.1.2 は計算を変えない）
 *      v0.2.0：v0.2.0 のコードに v0.1.2 のパラメータを与えたもの（legacy_sim.js）で比べる
 * C2   v1〜v6 のセーブの読み込み結果が v0.1.1 と同じ（読み込みの確かめを強めても、正しいセーブは1ビットも変わらない）
 *      v0.2.0：v7 への移行で変わる版の番号と glcReturned（0）を除いて比べる
 * C3   書き出し → 読み込みの往復で内容が変わらない
 * C4   壊れた文字列・別の文字列・新しい版などを断る（例外を出さない）
 * C5   中身を信用しない：型・範囲・件数・__proto__ などのキー・HTML を含む文字列
 * C6   第1章 完（目標と記録） */
'use strict';
const path = require('path'), fs = require('fs'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..', 'public');
for (const f of ['data.js', 'glossary.js', 'sim.js', 'savecode.js']) require(path.join(ROOT, 'js', f));
const MB = globalThis.MB, S = MB.Sim, SC = MB.SaveCode;

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fail++; };
const noTime = (k, v) => k === 'lastSaved' ? 0 : v;
const norm = json => JSON.stringify(JSON.parse(json), noTime);
const fixtures = [];
for (let v = 1; v <= 6; v++) {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `v${v}_saves.json`), 'utf8'));
  for (const [name, save] of Object.entries(fx)) fixtures.push([`v${v} ${name}`, typeof save === 'string' ? save : JSON.stringify(save)]);
}
// v0.1.1 の data.js・sim.js（比較専用の写し）
const ctx = { console, Date, Math, JSON, Float64Array, Array, Object }; ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['data.js', 'sim.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, 'baseline_0.1.1', f), 'utf8'), ctx);
const B = ctx.MB.Sim;
const LM = require('./legacy_sim.js')(), L = LM.Sim;
/* v0.2.0：v7 に移行して保存した内容を、v6 の形に戻す（版の番号を戻し、glcReturned が 0 なら除く） */
const toV6 = json => { const o = JSON.parse(json); if (o.totals.glcReturned !== 0) return 'glcReturned ≠ 0';
  delete o.totals.glcReturned; o.saveVersion = 6; o.dataVersion = 6; return JSON.stringify(o); };
const enc = obj => { const b = btoa(String.fromCharCode(...new TextEncoder().encode(typeof obj === 'string' ? obj : JSON.stringify(obj)))); return SC.PREFIX + b + ':' + SC.crc32(b); };

console.log('[C1] 代謝の計算は v0.1.1 と同じ');
{
  const mk = (Sx, M) => { const x = Sx.createState(); x.levels.micro = 1; M.MICRO_IDS.forEach(i => { x.levels['enz_' + i] = 6; });
    Object.assign(x.levels, { glut: 10, prep: 8, pay: 8, work: 7, nadregen: 1, enz_ldh: 5, lacexit: 1, tr_mct: 3 }); x.rp = 1e6; return x; };
  const a = mk(B, ctx.MB), b = mk(L, LM);
  for (let t = 0; t < 7200; t++) for (const [Sx, x] of [[B, a], [L, b]]) {
    if (t === 2000) Sx.newCulture(x); if (t === 3000) Sx.buy(x, 'nadsalv');
    if (t === 4000) Sx.setSwitch(x, 'mctOff', true); if (t === 4600) Sx.setSwitch(x, 'mctOff', false);
    Sx.step(x, 1);
  }
  const bt = Object.assign({}, b.totals); delete bt.glcReturned;
  ok(Object.keys(a.amounts).every(k => a.amounts[k] === b.amounts[k]) && JSON.stringify(a.totals) === JSON.stringify(bt) && a.rp === b.rp,
    '2 時間（新しい細胞・補充・MCT の停止と再開を含む）：全物質・累計・RP がビット単位で一致（v0.2.0 のコード＋v0.1.2 のパラメータ）');
  const c = B.createState(), d = L.createState(); B.addGlucose(c, 50); L.addGlucose(d, 50);
  B.catchUp(c, c.lastSaved + 7200e3); L.catchUp(d, d.lastSaved + 7200e3);
  ok(Object.keys(c.amounts).every(k => c.amounts[k] === d.amounts[k]), '留守中の進行（2 時間）もビット単位で一致');
  ok(B.SAVE_VERSION === 6 && S.SAVE_VERSION === 7 && MB.DATA_VERSION === 7, `セーブの版 v6 → v${S.SAVE_VERSION}、データの版 6 → ${MB.DATA_VERSION}（v0.2.0）`);
}

console.log('[C2] v1〜v6 のセーブの読み込み結果が v0.1.1 と同じ（v7 で増えた項目を除く）');
for (const [name, json] of fixtures) {
  const x = B.deserialize(json), y = S.deserialize(json);
  ok(x && y && norm(B.serialize(x)) === norm(toV6(S.serialize(y))), `${name.padEnd(26)} 読み込み → 保存の結果が v0.1.1 と一致（版の番号と glcReturned 0 を除く）`);
}

console.log('[C3] 書き出し → 読み込みの往復');
{
  const cases = fixtures.map(([n, j]) => [n, S.deserialize(j)]);
  const p = S.createState(); S.addGlucose(p, 30); for (let i = 0; i < 300; i++) S.step(p, 1);
  S.addNote(p, '日本語と記号 ⁺ ⇄ <b>&amp;</b> を含む記録'); cases.push(['遊んだ直後の state', p]);
  for (const [name, st] of cases) {
    const before = S.serialize(st), code = SC.encode(st), r = SC.decode(code);
    ok(r.ok && norm(S.serialize(r.state)) === norm(before) && /^METABOLISM1:[A-Za-z0-9+/=]+:[0-9a-f]{8}$/.test(code),
      `${name.padEnd(26)} 往復で内容が同じ（${code.length.toLocaleString()} 文字）`);
  }
  const code = SC.encode(p);
  const wrapped = '  \n' + code.replace(/(.{60})/g, '$1\n ') + '\n\t';
  ok(SC.decode(wrapped).ok, '途中に改行・空白が入っても読める（メールなどで折り返された場合）');
}

console.log('[C4] 読めない文字列を断る（例外を出さない）');
{
  const good = SC.encode(S.createState()), body = good.slice(SC.PREFIX.length, good.lastIndexOf(':'));
  const flip = good.slice(0, 20) + (good[20] === 'A' ? 'B' : 'A') + good.slice(21);
  const cases = [
    ['空', ''], ['空白だけ', '   \n '], ['文字列でない', 12345], ['別の文字列', 'hello world'],
    ['先頭の印が違う', 'METABOLISM2:' + body + ':' + SC.crc32(body)], ['確認用の数字がない', SC.PREFIX + body],
    ['途中で欠けた', good.slice(0, good.length - 30)], ['1文字変わった', flip],
    ['Base64 に使えない文字', SC.PREFIX + body.slice(0, 10) + '*' + body.slice(11) + ':00000000'],
    ['UTF-8 でない', (() => { const b = btoa('\xff\xfe\xfd'); return SC.PREFIX + b + ':' + SC.crc32(b); })()],
    ['JSON でない', enc('not json')], ['配列', enc([1, 2, 3])], ['null', enc('null')],
    ['版がない', enc({ t: 1 })], ['版が文字列', enc({ saveVersion: '6' })], ['版が 0', enc({ saveVersion: 0 })],
    ['新しい版', enc({ saveVersion: S.SAVE_VERSION + 1, t: 1 })],
    ['長すぎる', SC.PREFIX + 'A'.repeat(SC.MAX_CHARS)],
    ['移行が失敗する中身', enc({ saveVersion: 5, knowledge: 'x' })] ];
  for (const [name, text] of cases) {
    let r, threw = false;
    try { r = SC.decode(text); } catch (e) { threw = true; }
    ok(!threw && r && r.ok === false && typeof r.error === 'string' && r.error.length > 0, `${name.padEnd(16)} → 断る：${threw ? '例外' : r.error}`);
  }
  ok(S.deserialize('{"saveVersion":5,"knowledge":"x"}') === null, '保存領域の壊れたデータでも Sim.deserialize は例外を出さず null を返す');
}

console.log('[C5] 中身を信用しない（項目・型・範囲：Sim.deserialize）');
{
  const base = JSON.parse(S.serialize(S.createState()));
  const raw = o => JSON.stringify(Object.assign({}, base, o));
  // __proto__ は JSON.parse で「自分のキー」になる。Object.assign で写すとプロトタイプが書き換わる
  const evil = raw({}).slice(0, -1) + ',"levels":{"__proto__":{"polluted":1},"glut":2},"totals":{"__proto__":{"polluted":1},"pyrProduced":5},' +
    '"knowledge":{"analysis":{"__proto__":{"polluted":1},"hk":3},"identified":{"constructor":{"prototype":{"polluted":1}}},"regen":{"__proto__":{"polluted":1}},"balance":{}},' +
    '"milestones":{"__proto__":{"polluted":1},"first_pyr":1},"extAdded":{"__proto__":{"polluted":1}},"switches":{"__proto__":{"polluted":1},"ldhOff":true},"cell":{"__proto__":{"polluted":1},"nadBought":1}}';
  const des = j => { const x = S.deserialize(j); return x ? { ok: true, state: x } : { ok: false }; };   // 型・範囲の確かめ（Sim.deserialize）だけを試す
  const r = des(evil);
  const protos = r.ok && [r.state, r.state.levels, r.state.totals, r.state.totals.extent, r.state.knowledge.analysis, r.state.knowledge.identified,
    r.state.knowledge.regen, r.state.milestones, r.state.extAdded, r.state.switches, r.state.cell].every(o => Object.getPrototypeOf(o) === Object.prototype);
  ok(r.ok && protos && ({}).polluted === undefined && r.state.levels.polluted === undefined && r.state.milestones.polluted === undefined,
    '__proto__・constructor のキー：プロトタイプは変わらず、余分な項目も入らない');
  ok(r.ok && r.state.levels.glut === 2 && r.state.totals.pyrProduced === 5 && r.state.knowledge.analysis.hk === 3 && r.state.milestones.first_pyr === 1 && r.state.switches.ldhOff === true,
    '同じ中の正しい項目は読み込まれる');

  const bad = des((raw({
    amounts: { glc: 'abc', atp: -5, nad: 'Infinity', adp: 1e300, pyr: '12', nadh: null, junk: 99 },
    levels: { glut: 'x', prep: 1e300, pay: 3, junk: 9 }, rp: 'lots', t: -Infinity,
    totals: { pyrProduced: 'x', glcSupplied: 1e300, extent: { pk: 4, bogus: 1, hk: 'x' }, junk: 1 },
    extAdded: { nad: 100, nope: 5 }, cell: { nadBought: 'x', startedAt: 7 },
    knowledge: { analysis: { hk: 'x', pk: 9, zzz: 1 }, identified: { hk: 5, zzz: 1 }, regen: { since: 'x', best: 3, extra: 1 }, balance: { since: null, best: 'x' } },
    switches: { ldhOff: 'yes', mctOff: true, other: true },
    milestones: { first_pyr: 10, 'bad key!': 1, nad_low: 'x', ['k'.repeat(41)]: 1 },
    log: [{ t: 1, text: '<img src=x onerror=alert(1)>' }, { t: 'x', text: 'a' }, { t: 2, text: 5 }, 'str', null, { t: 3, text: 'あ'.repeat(5000) },
      ...Array.from({ length: 100 }, (_, i) => ({ t: i, text: 'n' + i }))] })));
  const st = bad.ok && bad.state, a = st && st.amounts;
  ok(bad.ok, '型の違う値が混ざっていても、読める項目だけで読み込む');
  ok(st && a.glc === 0 && a.atp === 0 && a.nad === 200 && a.adp === 20 && a.pyr === 12 && a.nadh === 0 && !('junk' in a),
    '物質量：文字・無限大・大きすぎる値は初期値、負の値と null は 0（v0.1.1 と同じ）、知らない物質は入らない');
  ok(st && st.levels.glut === 0 && st.levels.prep === 0 && st.levels.pay === 3 && !('junk' in st.levels) && st.rp === 0 && st.t === 0,
    '研究の Lv・研究ポイント・時間も同じ規則');
  ok(st && st.totals.pyrProduced === 0 && st.totals.glcSupplied === 0 && JSON.stringify(st.totals.extent) === '{"pk":4}' && !('junk' in st.totals)
    && JSON.stringify(st.extAdded) === '{"nad":100}' && st.cell.nadBought === 0 && st.cell.startedAt === 7,
    '累計・反応ごとの進行量・外から加えた量：知っている項目の数値だけ');
  ok(st && JSON.stringify(st.knowledge.analysis) === '{"pk":9}' && JSON.stringify(st.knowledge.identified) === '{"hk":5}'
    && st.knowledge.regen.since === null && st.knowledge.regen.best === 3 && !('extra' in st.knowledge.regen) && st.knowledge.balance.best === 0,
    '解析の知識：知っている酵素・輸送体の数値だけ');
  ok(st && JSON.stringify(st.switches) === '{"mctOff":true}', '一時停止：ldhOff・mctOff の true だけ');
  ok(st && JSON.stringify(st.milestones) === '{"first_pyr":10}', '記録の達成時刻：英小文字・数字・_ の 40 字以内のキーで、数値のものだけ');
  ok(st && st.log.length === 40 && st.log[0].text === '<img src=x onerror=alert(1)>' && st.log.every(l => typeof l.t === 'number' && typeof l.text === 'string')
    && st.log[1].text.length === 1000, '記録の文：40 件まで、1 件 1,000 字まで、時刻と文字列の組だけ（HTML は文字のまま。表示では esc() を通す）');
  const ui = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
  ok(/\$\('log'\)\.innerHTML = [\s\S]{0,120}esc\(l\.text\)/.test(ui) && /fmtTime\(l\.t\)/.test(ui), '記録タブは文を esc() で表示し、時刻は数値として書式化している');
  const ioPart = ui.slice(ui.indexOf('/* ---------- v0.1.2：第1章 完'), ui.indexOf('/* ---------- 操作 ---------- */'));
  ok(ioPart.length > 0 && !/innerHTML/.test(ioPart), '書き出し・読み込み・第1章 完の表示は innerHTML を使わない（textContent のみ）');
}


console.log('[C5b] 中身を信用しない（値どうしのつじつま：Sim.checkIntegrity。外からの読み込みでは、合わなければ断る）');
{
  for (const [name, json] of fixtures) {
    const st = S.deserialize(json), b0 = S.checkIntegrity(st);
    for (let i = 0; i < 300; i++) S.step(st, 1);
    if (b0.length || S.checkIntegrity(st).length) ok(false, `${name}：正しいセーブなのに問題あり ${JSON.stringify(b0)}`);
  }
  ok(true, `v1〜v6 の全フィクスチャ（${fixtures.length} 件）は、読み込み直後も 300 秒計算したあとも問題なし`);
  const { play } = require(path.join(__dirname, '..', 'tools', 'economy.js'));
  const g = play(30).g;
  ok(S.checkIntegrity(g).length === 0 && SC.decode(SC.encode(g)).ok, '自動プレイ 30 分（細胞の入れ替え・補充・研究を含む）のあとも問題なし。書き出し → 読み込みも通る');
  const good = JSON.parse(S.serialize(S.deserialize(fixtures[fixtures.length - 1][1])));
  const cases = [
    ['ATP＋ADP が合わない', d => { d.amounts.atp += 50; }, 'ATP＋ADP'],
    ['NAD⁺＋NADH が合わない', d => { d.amounts.nad = 5000; }, 'NAD⁺＋NADH'],
    ['補充の記録だけ増やした', d => { d.extAdded.nad = (d.extAdded.nad || 0) + 100; }, 'NAD⁺＋NADH'],
    ['研究の Lv が上限を超える', d => { d.levels.glut = 31; }, 'glut'],
    ['研究の Lv が小数', d => { d.levels.prep = 2.5; }, 'prep'],
    ['研究の Lv が負', d => { d.levels.pay = -1; }, 'pay'],
    ['研究ポイントが負', d => { d.rp = -10; }, '研究ポイント'],
    ['経過時間が負', d => { d.t = -5; }, '経過時間'],
    ['記録の時刻が未来', d => { d.milestones.first_pyr = d.t + 1000; }, 'first_pyr'],
    ['同定の時刻が未来', d => { d.knowledge.identified.hk = d.t + 1000; }, 'hk'],
    ['補充の回数が累計より多い', d => { d.cell.nadBought = d.levels.nadsalv + 1; }, '補充'],
    ['細胞を始めた時刻が未来', d => { d.cell.startedAt = d.t + 10; }, '細胞を始めた'],
    ['累計が負', d => { d.totals.pyrProduced = -1; }, 'pyrProduced'],
    ['解析の進み具合が負', d => { d.knowledge.analysis.hk = -3; }, 'hk'],
    ['保存量でない物質を外から加えた記録', d => { d.extAdded.glc = 5; }, 'glc'] ];
  for (const [label, mut, word] of cases) {
    const d = JSON.parse(JSON.stringify(good)); mut(d);
    const r = SC.decode(enc(d));
    ok(!r.ok && r.error.includes('つじつま') && r.problems.some(p => p.includes(word)), `${label.padEnd(14)} → 断る：${r.ok ? '（通ってしまった）' : r.problems[0]}`);
  }
}

console.log('[C6] 第1章 完');
{
  const last = MB.GOALS[MB.GOALS.length - 1], prev = MB.GOALS[MB.GOALS.length - 2];
  ok(last.final === true && last.done({}) === false, '最後の目標は次の章の予告（終わらない・進み具合のバーなし）');
  const s = S.createState(); s.milestones.lac_balance = 100;
  ok(prev.done(s) === true && MB.MILESTONES.some(m => m.id === 'lac_balance'), '第1章 完の条件 ＝ LACTATE BALANCE の達成（記録 lac_balance）');
  s.milestones.chapter1_clear = 120;
  const back = S.deserialize(S.serialize(s));
  ok(back.milestones.chapter1_clear === 120 && back.milestones.lac_balance === 100, '第1章 完を出した記録はセーブに残る（セーブの版は上げない）');
  const text = [last.text, last.hint, fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/<div class="event ev-ch"[\s\S]*?<\/div>\n<\/div>/)[0]].join('\n');
  ok(/酸素があっても(、)?乳酸はつくられ得る/.test(text) && !/酸素があれば乳酸は(つくられない|できない)|酸素がないと乳酸/.test(text),
    '次の章の予告：「酸素があっても乳酸はつくられ得る」と書き、反対の意味の表現がない');
}

console.log(fail ? `\n${fail} 件失敗` : '\nすべて成功');
process.exit(fail ? 1 : 0);
