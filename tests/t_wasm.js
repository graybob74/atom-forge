'use strict';
/* The WebAssembly force kernel against the JavaScript one (Node, one thread):
   1. on frozen states of several worlds, the two kernels give the same forces to rounding, the same candidates in the
      same order and the same stiffness;
   2. whole runs with and without the module agree closely over a few dozen steps and queue the same events;
   3. the memory arena: the store, lists and queues live in the module's memory, it grows when a big world needs it,
      and nothing breaks when it does. Skipped (with a note) when src/wasm/kernel.wasm is not there. */
const fs = require('fs'), path = require('path');
const { load } = require('./load.js');
const ROOT = path.join(__dirname, '..');
if (!fs.existsSync(path.join(ROOT, 'src', 'wasm', 'kernel.wasm'))) { console.log('wasm checks skipped: no src/wasm/kernel.wasm'); process.exit(0); }
let fails = 0;
const fail = (m) => { fails++; console.log('FAIL', m); };
const steps = (X, n) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };
function build(X, scen) {
  const W = X.W;
  X.setMaxParts(12000);
  if (scen === 'water12k') {
    X.baseWorld(560, 360, 300, 0.05);
    for (let i = 0; i < 80; i++) for (let j = 0; j < 50; j++) { if (W.parts.length + 3 > 12000) break; X.addMolecule('H2O', -280 + (i + 0.5) * 7 + (X.rnd() - 0.5) * 0.4, -180 + (j + 0.5) * 7.2 + (X.rnd() - 0.5) * 0.4, X.rnd() * 6, 300); }
    X.settleOverlaps();
  } else if (scen === 'waterion') { X.PRESETS.water.build(); X.settleOverlaps(); const Os = W.parts.filter(p => p.Z === 8); for (let i = 0; i < 40 && i < Os.length; i++) X.userIonize(Os[i]); }
  else { X.PRESETS[scen].build(); X.settleOverlaps(); }
  W.decayOn = false;
}
// 1. kernels on frozen states
{
  const X = load('all', { seed: 12 });
  const { WK } = X;
  if (!WK.on || !WK.ready) fail('module not ready: ' + WK.note);
  for (const scen of ['waterion', 'flashbyte', 'salt', 'combustion', 'antihydrogen', 'soup', 'water12k']) {
    X.clearWorld(); build(X, scen); steps(X, 25);
    X.forcesNoEvents(); X.bondArrays(); X.angleCentres();
    const { W, S, VL, BD, AC } = X, n = S.hi, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h;
    const fx1 = X.shArray(Float64Array, n), fy1 = X.shArray(Float64Array, n), cq1 = X.shArray(Int32Array, 9 * (VL.np + BD.n) + 64);
    const fx2 = X.shArray(Float64Array, n), fy2 = X.shArray(Float64Array, n), cq2 = X.shArray(Int32Array, cq1.length);
    X._kStiff = 0;
    let nc1 = X.pairKernel(VL.pi, VL.pj, VL.ex, 0, VL.np, fx1, fy1, cq1, 0, wrap, bw, bh, bw / 2, bh / 2, W.step);
    nc1 = X.bondKernel(0, BD.n, fx1, fy1, cq1, nc1, wrap, bw, bh, bw / 2, bh / 2);
    X.angleKernel(0, AC.n, fx1, fy1, wrap, bw, bh, bw / 2, bh / 2);
    const ks1 = X._kStiff; X._kStiff = 0;
    X.wasmDesc();
    const nc2 = X.wasmForces(0, VL.np, 0, BD.n, 0, AC.n, fx2, fy2, cq2, wrap, bw, bh, bw / 2, bh / 2, W.step);
    const ks2 = X._kStiff;
    let maxrel = 0;
    for (let i = 0; i < n; i++) { const sc = Math.max(Math.abs(fx1[i]), Math.abs(fy1[i]), 1e-6); maxrel = Math.max(maxrel, Math.abs(fx1[i] - fx2[i]) / sc, Math.abs(fy1[i] - fy2[i]) / sc); }
    let same = nc1 === nc2; for (let k = 0; same && k < nc1; k++) same = cq1[k] === cq2[k];
    const ksOk = Math.abs(ks1 - ks2) <= 1e-9 * Math.max(ks1, 1e-300);
    console.log(`${scen}: ${n} slots, ${VL.np} pairs, ${BD.n} bonds, ${AC.n} centres: max rel force difference ${maxrel.toExponential(2)}, ${nc1 / 3} candidates ${same ? 'same' : 'DIFFERENT'}, stiffness ${ksOk ? 'same' : 'DIFFERENT'}`);
    if (maxrel > 1e-10) fail(scen + ': forces differ by ' + maxrel);
    if (!same) fail(scen + ': candidates differ');
    if (!ksOk) fail(scen + ': stiffness differs ' + ks1 + ' vs ' + ks2);
    if (scen === 'water12k' && WK.grows === 0) fail('the memory never grew for 12,000 atoms');
    if (scen === 'water12k' && S.x.buffer !== WK.mem.buffer && S.x.buffer.byteLength > WK.mem.buffer.byteLength) fail('store not on the module memory');
  }
  console.log(`arena: ${WK.allocs} allocations, ${WK.grows} growths, ${(WK.top / 1048576).toFixed(1)} MB used, ${WK.calls} kernel calls`);
}
// 2. whole runs with and without the module
for (const scen of ['waterion', 'flashbyte', 'combustion']) {
  const A = load('all', { seed: 7 }), B = load('all', { seed: 7, wasm: false });
  if (B.WK.on) fail('module in use when asked not to');
  build(A, scen); build(B, scen);
  steps(A, 40); steps(B, 40);
  const n = Math.min(A.S.hi, B.S.hi); let maxd = 0;
  for (let i = 0; i < n; i++) { if (A.S.dead[i] || B.S.dead[i]) continue; maxd = Math.max(maxd, Math.abs(A.S.x[i] - B.S.x[i]), Math.abs(A.S.y[i] - B.S.y[i])); }
  const ca = JSON.stringify(A.W.count), cb = JSON.stringify(B.W.count);
  const ea = A.energyReport ? A.energyReport().total : 0, eb = B.energyReport ? B.energyReport().total : 0;
  console.log(`${scen}, 40 steps with and without the module: positions within ${maxd.toExponential(2)} Å, events ${ca === cb ? 'same' : 'DIFFERENT'}, energy ${ea.toFixed(6)} vs ${eb.toFixed(6)} eV`);
  if (maxd > 1e-6) fail(scen + ': runs diverged by ' + maxd);
  if (ca !== cb) fail(scen + ': events differ ' + ca + ' vs ' + cb);
  if (Math.abs(ea - eb) > 1e-6 * Math.max(1, Math.abs(ea))) fail(scen + ': energies differ');
}
if (fails) { console.log(fails + ' wasm failure(s)'); process.exit(1); }
console.log('wasm checks passed');
