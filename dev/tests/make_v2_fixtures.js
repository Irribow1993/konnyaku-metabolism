/* 承認済み 0.2 のコードで、実際の 0.2（v2）セーブデータを作る（移行テスト用の資料）。
 *   node tests/make_v2_fixtures.js <承認済み 0.2 の js フォルダ> */
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path');
const dir = process.argv[2];
const ctx = { console, Date, Math, JSON, Float64Array, Array, Object }; ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['data.js', 'sim.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx);
const S = ctx.MB.Sim, out = {};
const run = (s, sec) => { for (let i = 0; i < sec; i++) S.step(s, 1); };
let s = S.createState(); S.addGlucose(s, 200); s.levels.glut = 2; run(s, 200); out.midPlay = JSON.parse(S.serialize(s));
s = S.createState(); S.addGlucose(s, 500); run(s, 400); s.rp += 200; S.buy(s, 'nadsalv'); S.buy(s, 'nadsalv'); run(s, 60); out.afterNadBuys = JSON.parse(S.serialize(s));
s = S.createState(); s.totals.pyrProduced = 600; s.rp = 2000; S.buy(s, 'micro'); S.buy(s, 'enz_pfk'); S.buy(s, 'enz_hk'); S.addGlucose(s, 100); run(s, 120); out.microUnlocked = JSON.parse(S.serialize(s));
fs.writeFileSync(path.join(__dirname, 'fixtures/v2_saves.json'), JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(14), 'v' + v.saveVersion, 'RP', v.rp.toFixed(1), 'nadsalv', v.levels.nadsalv, 'cell' in v ? 'cell有' : 'cell無');
