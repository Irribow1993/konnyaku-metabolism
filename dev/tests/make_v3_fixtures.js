/* 0.2.1 のコードで、実際の 0.2.1（v3）セーブデータを作る（移行テスト用の資料）。
 *   node tests/make_v3_fixtures.js <0.2.1 の js フォルダ> */
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path');
const dir = process.argv[2];
const ctx = { console, Date, Math, JSON, Float64Array, Array, Object }; ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['data.js', 'sim.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx);
const S = ctx.MB.Sim, out = {};
const run = (s, sec) => { for (let i = 0; i < sec; i++) S.step(s, 1); };
let s = S.createState(); S.addGlucose(s, 200); s.levels.glut = 2; run(s, 200); out.beforeMicro = JSON.parse(S.serialize(s));
s = S.createState(); s.totals.pyrProduced = 600; s.rp = 3000; S.buy(s, 'micro');
for (const e of ['enz_hk', 'enz_pk', 'enz_pfk', 'enz_hk']) S.buy(s, e);       // HK は Lv2 まで（v3 では順番の制約なし）
S.addGlucose(s, 100); run(s, 120); out.someEnzymes = JSON.parse(S.serialize(s));
s = S.createState(); s.totals.pyrProduced = 600; s.rp = 1e5; S.buy(s, 'micro');
for (const id of ['hk','pgi','pfk','aldo','tpi','gapdh','pgk','pgam','eno','pk']) S.buy(s, 'enz_' + id);
S.buy(s, 'nadsalv'); S.addGlucose(s, 100); run(s, 60); out.allEnzymes = JSON.parse(S.serialize(s));
fs.writeFileSync(path.join(__dirname, 'fixtures/v3_saves.json'), JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(14), 'v' + v.saveVersion, 'RP', v.rp.toFixed(1), 'nadsalv', v.levels.nadsalv, 'enz', Object.entries(v.levels).filter(([k,x])=>/^enz_/.test(k)&&x).map(([k,x])=>k.slice(4)+x).join(','), 'cell' in v ? 'cell有' : 'cell無');
