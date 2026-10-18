'use strict';
/* Atom Forge benchmark. node tools/bench.js [repo-root] [scenario|all] [steps]
   Scenarios: water12k (12,000 atoms of H2O, 560x360 Å, 300 K, performance mode), waterion (Liquid water preset + 40 ionized
   molecules = 40 free electrons), flashbyte (Flash memory: one byte). Deterministic (seeded): 60 warm-up steps, then N timed
   steps. Reports ms per step, the steps a 10 ms frame budget (performance mode) affords, and the simulation speed that gives
   against the target (W.simPerFrame tu per frame). */
const path = require('path');
const args = process.argv.slice(2);
const root = args.find(a => /[\/\\]|^\.\.?$/.test(a) && !/^(water12k|waterion|flashbyte|all|\d+)$/.test(a)) ? path.resolve(args.find(a => /[\/\\]|^\.\.?$/.test(a))) : path.join(__dirname, '..');
const which = args.find(a => /^(water12k|waterion|flashbyte|all)$/.test(a)) || 'all';
const N = +(args.find(a => /^\d+$/.test(a)) || 200);
const { load } = require(path.join(root, 'tests', 'load.js'));

function mk(seed) {
  const X = load('all', { seed });
  X.setMaxParts(12000);
  return X;
}
function water12k(X) {
  const { W } = X;
  X.baseWorld(560, 360, 300, 0.05);
  const nx = 80, ny = 50, dx = 560 / nx, dy = 360 / ny;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    if (W.parts.length + 3 > 12000) break;
    X.addMolecule('H2O', -280 + (i + 0.5) * dx + (X.rnd() - 0.5) * 0.4, -180 + (j + 0.5) * dy + (X.rnd() - 0.5) * 0.4, X.rnd() * 6, 300);
  }
  X.settleOverlaps();
}
function waterion(X) {
  const { W } = X;
  X.PRESETS.water.build(); X.settleOverlaps();
  const Os = W.parts.filter(p => p.Z === 8);
  for (let i = 0; i < 40 && i < Os.length; i++) X.userIonize(Os[i]);
}
function flashbyte(X) { X.PRESETS.flashbyte.build(); X.settleOverlaps(); }
const SCEN = { water12k, waterion, flashbyte };

function steps(X, n) {
  const { W } = X;
  let adv = 0;
  for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); adv += X.step(W.dt); }
  return adv;
}
function run(name) {
  const X = mk(12);
  const { W } = X;
  SCEN[name](X);
  W.decayOn = false;
  const n = W.parts.filter(p => !p.dead).length, nE0 = W.nE;
  steps(X, 60); // warm-up: JIT, first force build
  const t0 = performance.now();
  const adv = steps(X, N);
  const ms = (performance.now() - t0) / N, dtMean = adv / N;
  const spf = Math.max(1, Math.floor(10 / ms)), speed = Math.min(100, 100 * spf * dtMean / W.simPerFrame);
  const out = { scenario: name, particles: n, freeE: nE0 + '→' + W.nE, msPerStep: +ms.toFixed(3), dtMean: +dtMean.toFixed(5),
    stepsPer10ms: spf, simSpeedPct: +speed.toFixed(1) };
  console.log(JSON.stringify(out));
  return out;
}
const names = which === 'all' ? Object.keys(SCEN) : [which];
for (const nm of names) run(nm);
