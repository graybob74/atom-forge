'use strict';
/* Quantum bonds (GFN1/GFN2-xTB, Experimental → Bond orders → Quantum) timed and fingerprinted, for item 54 (1.28.3):
   a hydronium and five waters (19 atoms, flat or 3-D) and a 40-atom box, N steps from seed 7; ms a step, the xTB
   calls, SCC iterations and their time, and a fingerprint of the run (positions after N steps, and the energy of the
   last step's quantum calculation to 1e-9 eV) to compare two trees.
     node tools/xqbench.js [scenario …] [--n N] [--gfn 1|2] [--js]  scenarios: z19 z19_3d w40 */
const { load } = require('../tests/load.js');
const args = process.argv.slice(2), ni = args.indexOf('--n'), gi = args.indexOf('--gfn');
const N = ni >= 0 ? +args[ni + 1] : 40, GFN = gi >= 0 ? +args[gi + 1] : 1, JS = args.includes('--js'); // (--js: the JavaScript's linear algebra, not the module's)
const scen = args.filter((a, i) => !a.startsWith('--') && (ni < 0 || i !== ni + 1) && (gi < 0 || i !== gi + 1));
const SC = {
  z19: (X, d3) => { X.baseWorld(24, 24, 300, 0.05); if (d3) X.world3d(24); X.addMolecule('H3Op', 0, 0, 0, 300, 0);
    [[3, 0, 0], [-1.5, 2.6, 0.5], [-1.5, -2.6, -0.5], [0, 0, 3], [3, 3, -2]].forEach(([x, y, z], k) => X.addMolecule('H2O', x, y, k, 300, d3 ? z : 0)); },
  w40: (X) => { X.baseWorld(30, 30, 300, 0.05); let k = 0; for (let i = 0; i < 4; i++) for (let j = 0; j < 4 && k < 13; j++, k++) X.addMolecule('H2O', -9 + 6 * i, -9 + 6 * j, k, 300, 0); X.addAtom('O', 12, 12, {}); },
};
for (const k of (scen.length ? scen : ['z19', 'z19_3d', 'w40'])) {
  const X = load('all', { seed: 7 }), W = X.W, d3 = k.endsWith('_3d');
  if (JS) X.XQW.on = false;
  SC[k.replace('_3d', '')](X, d3); X.settleOverlaps(); X.boSet(2); if (GFN === 2) X.XQ.method = 2;
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  const c0 = X.XQ.calls, it0 = X.XQ.it, ms0 = X.XQ.ms, t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  let h = 0; for (const p of W.parts) if (!p.dead) h = (h * 31 + Math.round(p.x * 1e6) + 7 * Math.round(p.y * 1e6) + 13 * Math.round((p.z || 0) * 1e6)) % 2147483647;
  const calls = X.XQ.calls - c0, its = X.XQ.it - it0;
  console.log(`${k.padEnd(7)} ${JS ? 'JS  ' : 'wasm'} GFN${GFN} ${String(W.parts.filter(p => p.bom && !p.dead).length).padStart(3)} atoms: ${(ms / N).toFixed(2)} ms a step; ${calls} xTB calls, ${(its / Math.max(1, calls)).toFixed(1)} SCC iterations each, ${((X.XQ.ms - ms0) / Math.max(1, calls)).toFixed(2)} ms each; fingerprint ${h} E ${X.BO.E.toFixed(9)} t ${W.t.toFixed(6)}`);
}
