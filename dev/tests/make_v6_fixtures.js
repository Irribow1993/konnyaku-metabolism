/* 0.4 のコードで、実際の 0.4（v6）セーブデータを作る（0.4.1 の互換テスト用の資料）。
 *   node tests/make_v6_fixtures.js <0.4 の metabolism フォルダ> */
'use strict';
const fs = require('fs'), path = require('path');
const dir = path.resolve(process.argv[2]);
for (const f of ['data.js', 'glossary.js', 'sim.js', 'aggregate.js']) require(path.join(dir, 'js', f));
const { play } = require(path.join(dir, 'tools/economy.js'));
const S = globalThis.MB.Sim, out = {};
for (const [name, min] of [['mctAnalyzing50min', 50], ['afterMct65min', 65]]) out[name] = JSON.parse(S.serialize(play(min).g));
{ const { g } = play(70); S.newCulture(g); S.setSwitch(g, 'mctOff', true); out.newCellMctPaused70min = JSON.parse(S.serialize(g)); }
fs.writeFileSync(path.join(__dirname, 'fixtures/v6_saves.json'), JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(22), 'v' + v.saveVersion, 'lac', v.amounts.lac.toFixed(0), 'lacOut', v.amounts.lacOut.toFixed(0), 'tr_mct', v.levels.tr_mct, 'switches', JSON.stringify(v.switches), 'balance', JSON.stringify(v.knowledge.balance));
