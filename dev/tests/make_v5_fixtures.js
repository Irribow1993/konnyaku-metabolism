/* 0.3 のコードで、実際の 0.3（v5）セーブデータを作る（0.4 への移行テスト用の資料）。
 *   node tests/make_v5_fixtures.js <0.3 の metabolism フォルダ>
 * 0.3 の経済シミュレーター（自動プレイ）で 30 分（LDH 前）・45 分（LDH 直後）・75 分（乳酸が大量に蓄積）遊んだ状態を保存する。 */
'use strict';
const fs = require('fs'), path = require('path');
const dir = path.resolve(process.argv[2]);
for (const f of ['data.js', 'glossary.js', 'sim.js', 'aggregate.js']) require(path.join(dir, 'js', f));
const { play } = require(path.join(dir, 'tools/economy.js'));
const S = globalThis.MB.Sim, out = {};
for (const [name, min] of [['beforeLdh30min', 30], ['afterLdh45min', 45], ['lactate75min', 75]]) {
  const { g } = play(min);
  out[name] = JSON.parse(S.serialize(g));
}
{ // LDH を一時停止したまま保存したデータ
  const { g } = play(50); S.setSwitch(g, 'ldhOff', true); out.ldhPaused50min = JSON.parse(S.serialize(g));
}
fs.writeFileSync(path.join(__dirname, 'fixtures/v5_saves.json'), JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(16), 'v' + v.saveVersion, 'RP', v.rp.toFixed(0), 'lac', v.amounts.lac.toFixed(0), 'ldh', v.levels.enz_ldh, 'nadsalv', v.levels.nadsalv,
  'regen', JSON.stringify(v.knowledge.regen), 'switches', JSON.stringify(v.switches), 'selfsus', v.milestones.self_sustaining);
