/* v0.2.0：v0.2.0 の data.js・sim.js を別の環境で読み、v0.1.2 のパラメータ
 *   （PFK-1・PK の調節なし、GLUT は定速の 0 次、細胞の仕事 +40%/Lv）
 * に戻したものを返す。以前の版のコード（dev/tests/baseline_*）とビット単位で比べるのに使う。
 * 一致すれば、v0.2.0 で計算が変わったのはこの3つのモデルの変更だけで、解法・保存・解析などのコードは変わっていない。 */
'use strict';
const path = require('path'), fs = require('fs'), vm = require('vm');
const JS = path.join(__dirname, '..', '..', 'public', 'js');
module.exports = function legacySim() {
  const ctx = { console, Date, Math, JSON, Float64Array, Array, Object }; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(JS, 'data.js'), 'utf8'), ctx);
  vm.runInContext(`(() => { const R = id => MB.REACTIONS.find(r => r.id === id);
    delete R('pfk').regulation; delete R('pk').regulation;
    Object.assign(R('glut'), { stoich: { glc: +1 }, kinetics: { type: 'zero' } }); delete R('glut').thermo;
    MB.UPGRADES.find(u => u.id === 'work').effect.perLevel = 0.40; })()`, ctx);
  vm.runInContext(fs.readFileSync(path.join(JS, 'sim.js'), 'utf8'), ctx);
  return ctx.MB;
};
