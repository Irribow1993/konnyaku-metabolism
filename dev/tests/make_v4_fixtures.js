/* 0.2.3 のコードで、実際の 0.2.3（v4）セーブデータを作る（0.3 への移行テスト用の資料）。
 *   node tests/make_v4_fixtures.js <0.2.3 の metabolism フォルダ>
 * 0.2.3 の経済シミュレーター（自動プレイ）で 12 分・25 分・45 分遊んだ状態をそのまま保存する。 */
'use strict';
const fs = require('fs'), path = require('path');
const dir = path.resolve(process.argv[2]);
for (const f of ['data.js', 'glossary.js', 'sim.js', 'aggregate.js']) require(path.join(dir, 'js', f));
const { play } = require(path.join(dir, 'tools/economy.js'));
const S = globalThis.MB.Sim, out = {};
for (const [name, min] of [['early12min', 12], ['analysis25min', 25], ['allIdentified45min', 45]]) {
  const { g } = play(min);
  out[name] = JSON.parse(S.serialize(g));
}
const s = S.createState(); out.fresh = JSON.parse(S.serialize(s));
fs.writeFileSync(path.join(__dirname, 'fixtures/v4_saves.json'), JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(20), 'v' + v.saveVersion, 'RP', v.rp.toFixed(1), 'nadsalv', v.levels.nadsalv, 'cultures', v.totals.cultures,
  'identified', Object.keys(v.knowledge.identified).length, 'analysis', Object.keys(v.knowledge.analysis).length, 'nad_low', v.milestones.nad_low != null, 'log', v.log.length);
