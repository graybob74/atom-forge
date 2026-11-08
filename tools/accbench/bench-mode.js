'use strict';
/* The Experimental settings' costs in the flat game and in the 3-D lab (1.25: Settings by mode). One run:
     node tools/accbench/bench-mode.js <scenario> <variant> [steps]
   scenarios (flat / 3-D): water / water3 (liquid water: the setups), brine / brine3, waterE / waterE3 (liquid water with 40
   molecules ionized: free electrons), eNe / eNe3 (40 neon atoms and 40 free electrons), al / al3 (a flat Al patch of 769 atoms / an Al ball of 767), cu / cu3 (Cu, 955 / 767),
   zundel / zundel3 (H3O+ and five waters, 19 atoms), mol3 (the molecules in space). freeE: free electrons at the start
   and the end of the timed steps.
   variants: base, dt2, dt4 (longest step 0.2, 0.1 fs), rc9, rc12, qeq10, qeq1, pd10, pd1 (induced charges with polarizability by direction, 1.27), pi8, pi16, pi32 (contracted), pi8f, pi16f,
   pi32f (every bead), bo1 (from the positions), bo2 (quantum), wave, metal (many-body).
   Prints one JSON line: ms a step, the mean step, ms a simulated fs (the cost tags compare this one). As bench-acc.js:
   one thread, the bath off after settling, events on. */
const { load } = require('../../tests/load.js');
const [scen, variant, nArg] = process.argv.slice(2);
const X = load('all', { seed: +(process.env.SEED || 12) }); const { W } = X;
X.setMaxParts(12000);
const ball = (sym, a, R, d3) => { // (as tests/f_125m.js patch)
  X.baseWorld(R * 6, R * 6, 300, 0.05); if (d3) X.world3d(R * 6);
  if (!d3) { const n = Math.ceil(R / a) + 1; for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) { const x = (i + 0.5 * (j & 1)) * a, y = j * a * Math.sqrt(3) / 2; if (x * x + y * y <= R * R) X.addAtom(sym, x, y); } }
  else { const c = a * Math.SQRT2, B = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]], n = Math.ceil(R / c) + 1; for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) for (const b of B) { const x = (i + b[0]) * c, y = (j + b[1]) * c, z = (k + b[2]) * c; if (x * x + y * y + z * z <= R * R) X.addAtom(sym, x, y, { z }); } }
};
const zundel = (d3) => { X.baseWorld(24, 24, 300, 0.05); if (d3) X.world3d(24); X.addMolecule('H3Op', 0, 0, 0, 300, 0);
  [[3, 0, 0], [-1.5, 2.6, 0.5], [-1.5, -2.6, -0.5], [0, 0, 3], [3, 3, -2]].forEach(([x, y, z], k) => X.addMolecule('H2O', x, y, k, 300, d3 ? z : 0)); };
let POST = null;
const eNe = (d3) => { X.baseWorld(d3 ? 24 : 60, d3 ? 24 : 60, 300, 0.05); if (d3) X.world3d(24); // (40 neon atoms; 40 free electrons put in after the warm-up: neon keeps none)
  for (let i = 0; i < 40; i++) X.addAtom('Ne', (X.rnd() - 0.5) * (d3 ? 20 : 54), (X.rnd() - 0.5) * (d3 ? 20 : 54), d3 ? { z: (X.rnd() - 0.5) * 20 } : {});
  POST = () => { for (let i = 0; i < 40; i++) X.spawnSpec({ kind: 'e' }, (X.rnd() - 0.5) * (d3 ? 20 : 54), (X.rnd() - 0.5) * (d3 ? 20 : 54), 300, d3 ? (X.rnd() - 0.5) * 20 : 0); }; };
const ionize = () => { X.settleOverlaps(); const Os = W.parts.filter(p => p.Z === 8); for (let i = 0; i < 40 && i < Os.length; i++) X.userIonize(Os[i]); };
const SC = {
  water: () => X.PRESETS.water.build(), water3: () => X.PRESETS.water3d.build(),
  brine: () => X.PRESETS.brine.build(), brine3: () => X.PRESETS.brine3d.build(),
  waterE: () => { X.PRESETS.water.build(); POST = ionize; }, waterE3: () => { X.PRESETS.water3d.build(); POST = ionize; }, // (ionized after the warm-up: in 3-D the electrons are caught again within ~30 steps)
  al: () => ball('Al', 2.86, 22.5, false), al3: () => ball('Al', 2.86, 15.6, true),
  cu: () => ball('Cu', 2.56, 22.6, false), cu3: () => ball('Cu', 2.56, 14, true),
  eNe: () => eNe(false), eNe3: () => eNe(true),
  zundel: () => zundel(false), zundel3: () => zundel(true), mol3: () => X.PRESETS.mol3d.build(),
};
if (!SC[scen]) throw new Error('scenario? ' + Object.keys(SC).join(' '));
SC[scen]();
X.settleOverlaps();
const v = variant || 'base';
const set = { dt2: () => { X.DT_MAX = 0.02; }, dt4: () => { X.DT_MAX = 0.01; }, rc9: () => X.setCutoff(9), rc12: () => X.setCutoff(12), qeq10: () => { X.QEQ.every = 10; }, qeq1: () => { X.QEQ.every = 1; }, pd10: () => { X.QEQ.every = 10; X.pdOn(1); }, pd1: () => { X.QEQ.every = 1; X.pdOn(1); },
  bo1: () => X.boSet(1), bo2: () => X.boSet(2), wave: () => X.waveSet(true), metal: () => X.mbSet(1) };
const m = v.match(/^pi(\d+)(f?)$/);
if (m) { X.PI.rpc = !m[2]; X.piSet(+m[1]); } else if (set[v]) set[v](); else if (v !== 'base') throw new Error('variant? ' + v);
W.decayOn = true; W.sources.length = 0; W.slowmo = false; X.forcesNoEvents(); W.fSpawn = W.spawned;
const run = (n) => { let adv = 0; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); adv += X.step(W.dt); } return adv; };
run(20); W.gamma = 0; run(10);
if (POST) { POST(); X.forcesNoEvents(); W.fSpawn = W.spawned; }
const N = +(nArg || 100), e0 = W.nE, t0 = performance.now(), adv = run(N), ms = performance.now() - t0, fs = adv * X.PHYS.TU_S * 1e15;
console.log(JSON.stringify({ scen, variant: v, d3: !!W.d3, parts: W.parts.filter(p => !p.dead).length, freeE: [e0, W.nE], steps: N, msStep: +(ms / N).toFixed(3), dtMean: +(adv / N).toFixed(5), msPerFs: +(ms / fs).toFixed(3) }));
