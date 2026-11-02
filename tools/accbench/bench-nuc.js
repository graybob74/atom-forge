'use strict';
/* Share of the run spent in nuclear and particle-physics events, per setup as it runs (sources on): node bench-nuc.js <preset> [frames] */
const { load } = require('../../tests/load.js');
const [key, fArg] = process.argv.slice(2); const F = +(fArg || 300);
const X = load('all', { seed: 12 }); const { W } = X;
X.PRESETS[key].build(); X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned; W.slowmo = false;
const names = ['nuclearEncounter', 'neutronHit', 'fission', 'tryFusion', 'hadronHit', 'nuclearAnnihilation', 'photoNuclear', 'decayStep', 'moveExos', 'decayExo', 'nuclearScatter', 'coulombScatter', 'beamHit'];
const T = {}, C = {}; let depth = 0;
for (const n of names) {
  if (typeof X[n] !== 'function') continue;
  const f = X[n]; T[n] = 0; C[n] = 0;
  X[n] = function (...a) { if (depth) return f.apply(this, a); depth++; const t = performance.now(); try { return f.apply(this, a); } finally { T[n] += performance.now() - t; C[n]++; depth--; } };
}
for (let f = 0; f < 30; f++) X.simFrame(1 / 60, 1e9);
for (const n in T) { T[n] = 0; C[n] = 0; }
const t0 = performance.now(); let steps = 0;
for (let f = 0; f < F; f++) steps += X.simFrame(1 / 60, 1e9).steps;
const tot = performance.now() - t0, nuc = Object.values(T).reduce((s, v) => s + v, 0);
const top = Object.entries(T).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / tot).toFixed(1)}% (${C[k]} calls, ${(1000 * v / C[k]).toFixed(0)} µs each)`);
console.log(JSON.stringify({ key, frames: F, steps, msFrame: +(tot / F).toFixed(2), nuclearPct: +(100 * nuc / tot).toFixed(1), top }));
