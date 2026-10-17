/* 0.1 基準版のコードで、実際の 0.1 セーブデータを作る（移行テスト用の資料）。
 *   node tests/make_v1_fixtures.js <0.1 基準版の js フォルダ>
 * 生成物 tests/fixtures/v1_saves.json は固定資料としてリポジトリに含める。 */
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path');
const dir = process.argv[2];
const ctx = { console, Date, Math, JSON }; ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['data.js', 'sim.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx);
const S = ctx.MB.Sim;
const out = {};
const run = (s, sec) => { for (let i = 0; i < sec; i++) S.step(s, 1); };

let s = S.createState(); out.fresh = JSON.parse(S.serialize(s));
s = S.createState(); S.addGlucose(s, 200); s.levels.glut = 2; run(s, 120); out.midPlay = JSON.parse(S.serialize(s));
s = S.createState(); S.addGlucose(s, 500); run(s, 900); out.nadStall = JSON.parse(S.serialize(s));
s = S.createState(); S.addGlucose(s, 500); run(s, 600); s.rp += 100; S.buy(s, 'nadsalv'); S.buy(s, 'pay'); run(s, 60); out.afterPurchase = JSON.parse(S.serialize(s));
s = S.createState(); S.addGlucose(s, 300); run(s, 300); S.newCulture(s); S.addGlucose(s, 50); run(s, 30); out.afterNewCulture = JSON.parse(S.serialize(s));

fs.writeFileSync(path.join(__dirname, 'fixtures/v1_saves.json'), JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(16), 'v' + v.saveVersion, 'TP', (+v.amounts.tp).toFixed(2), 'RP', v.rp.toFixed(1), 'levels', JSON.stringify(v.levels));
