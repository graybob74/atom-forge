'use strict';
/* Accuracy-versus-speed benchmark. node bench-acc.js <scenario> <variant> [steps]
   variants: base (WebAssembly kernel), js (JavaScript kernels), dt2 (max step 0.02 tu), dt4 (0.01 tu), rc9 (cutoff 9 Å, JS),
   rc12 (12 Å, JS). Prints one JSON line: ms per step, mean step, ms per simulated fs, insulated energy drift, profile. */
const { load } = require('../../tests/load.js');
const [scen, variant, nArg] = process.argv.slice(2);
const N = +(nArg || 200);
const patches = {
  dt2: (s) => s.replace('const DT_MAX = 0.04, DT_MIN', 'const DT_MAX = 0.02, DT_MIN'),
  dt4: (s) => s.replace('const DT_MAX = 0.04, DT_MIN', 'const DT_MAX = 0.01, DT_MIN'),
  rc9: (s) => s.replace('const RC = 6, RC2 = RC * RC;', 'const RC = 9, RC2 = RC * RC;'),
  rc12: (s) => s.replace('const RC = 6, RC2 = RC * RC;', 'const RC = 12, RC2 = RC * RC;'),
};
const opts = { seed: +(process.env.SEED || 12) };
if (patches[variant]) opts.patch = patches[variant];
if (variant === 'js' || variant === 'rc9' || variant === 'rc12') opts.wasm = false;
const X = load('all', opts); const { W } = X;
X.setMaxParts(12000);
const SC = {
  water() { X.PRESETS.water.build(); },
  water4k() { X.baseWorld(300, 200, 300, 0.05); const nx = 60, ny = 22; for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) X.addMolecule('H2O', -150 + (i + 0.5) * 300 / nx + (X.rnd() - 0.5) * 0.4, -100 + (j + 0.5) * 200 / ny + (X.rnd() - 0.5) * 0.4, X.rnd() * 6, 300); },
  waterion() { X.PRESETS.water.build(); X.settleOverlaps(); const Os = W.parts.filter(p => p.Z === 8); for (let i = 0; i < 40 && i < Os.length; i++) X.userIonize(Os[i]); },
  salt() { X.PRESETS.brine.build(); },
  combustion() { X.PRESETS.combustion.build(); },
  plasma() { X.PRESETS.ch_plasma.build(); },
  nif() { X.PRESETS.nif.build(); },
};
SC[scen]();
X.settleOverlaps();
W.decayOn = true; W.gamma = 0; W.sources.length = 0; W.slowmo = false; X.forcesNoEvents(); W.fSpawn = W.spawned;
const run = (n) => { let adv = 0; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); adv += X.step(W.dt); } return adv; };
run(30);
const tot = () => X.totalEnergy().total - W.ledger.nuc;
const E0 = tot();
X.profReset(); X.PROF.on = true;
const t0 = performance.now();
const adv = run(N);
const ms = performance.now() - t0;
X.PROF.on = false;
const E1 = tot(), P = X.PROF, fs = adv * X.PHYS.TU_S * 1e15;
const prof = { forces: P.forces, kernels: P.kernels, bath: P.bath, integ: P.integ };
X.RP_NAMES.forEach((k, i) => { prof[k] = P.rp[i]; });
for (const k in prof) prof[k] = +(100 * prof[k] / P.total).toFixed(1);
console.log(JSON.stringify({ scen, variant, parts: W.parts.filter(p => !p.dead).length, freeE: W.nE, steps: N, msStep: +(ms / N).toFixed(3), dtMean: +(adv / N).toFixed(5),
  msPerFs: +(ms / fs).toFixed(3), simFs: +fs.toFixed(1), drift: +(E1 - E0).toFixed(3), driftPerPs: +((E1 - E0) / (fs / 1000)).toFixed(2), pct: prof }));
