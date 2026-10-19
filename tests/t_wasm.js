'use strict';
/* The WebAssembly force kernel against the JavaScript one (Node, one thread):
   1. on frozen states of several worlds, the two kernels give the same forces to rounding, the same candidates in the
      same order and the same stiffness;
   2. whole runs with and without the module agree closely over 30 steps and queue the same events (the two kernels'
      exp() differ in the last bit now and then, which chaos amplifies: identical runs are not to be expected for long);
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
// 1b. the plain module (an ordinary memory, for pages without shared memory): the same kernels, the same forces to the bit
//     as the shared build on a frozen 12,000-atom world, the store on its memory, no growth ever; and an arena that fills
//     hands over to the JavaScript kernels without a crash
if (fs.existsSync(path.join(ROOT, 'src', 'wasm', 'kernel-plain.wasm'))) {
  const A = load('all', { seed: 7 }), B = load('all', { seed: 7, wasm: 'plain' });
  if (!B.WK.on || !B.WK.plain || !B.WK.ready) fail('the plain module is not in use: ' + JSON.stringify({ on: B.WK.on, plain: B.WK.plain, ready: B.WK.ready, note: B.WK.note }));
  else {
    build(A, 'water12k'); build(B, 'water12k');
    A.forcesNoEvents(); B.forcesNoEvents();
    const n = Math.min(A.S.hi, B.S.hi); let maxd = 0;
    for (let i = 0; i < n; i++) maxd = Math.max(maxd, Math.abs(A.S.fx[i] - B.S.fx[i]), Math.abs(A.S.fy[i] - B.S.fy[i]));
    console.log(`plain module: ${B.WK.mem.buffer.byteLength >> 20} MB memory, ${B.WK.allocs} allocations, ${(B.WK.top / 1048576).toFixed(1)} MB used, grew ${B.WK.grows} times; forces vs the shared build: max difference ${maxd.toExponential(2)}`);
    if (maxd !== 0) fail('plain module: forces differ from the shared build by ' + maxd);
    if (B.WK.grows !== 0 || B.WK.mem.buffer.byteLength !== B.WK.PLAIN_PAGES * 65536) fail('the plain memory grew or is not its full size');
    if (B.S.x.buffer !== B.WK.mem.buffer) fail('plain module: store not on its memory');
    // the arena fills: the kernels are given up, the views stay valid, the simulation goes on
    B.WK.top = B.WK.mem.buffer.byteLength - 64;
    const big = B.shArray(Float64Array, 4096);
    const E0 = B.totalEnergy().total; steps(B, 5); const E1 = B.totalEnergy().total;
    console.log(`  arena filled: kernel ${B.WK.on ? 'still on' : 'given up'} (${B.WK.note}), a new array of ${big.length} plain, ${B.S.x.length} store slots still readable, energy ${E0.toFixed(3)} → ${E1.toFixed(3)} eV over 5 steps`);
    if (B.WK.on || B.WK.ready || B.WK.use) fail('the kernel was not given up when the plain memory filled');
    if (big.length !== 4096 || !Number.isFinite(E1) || Math.abs(E1 - E0) > 0.01 * Math.abs(E0)) fail('the simulation did not go on cleanly after the plain memory filled');
  }
} else console.log('plain module: skipped (no src/wasm/kernel-plain.wasm)');
// 2. whole runs with and without the module
for (const scen of ['waterion', 'flashbyte', 'combustion']) {
  const A = load('all', { seed: 7 }), B = load('all', { seed: 7, wasm: false });
  if (B.WK.on) fail('module in use when asked not to');
  build(A, scen); build(B, scen);
  steps(A, 30); steps(B, 30); // (free electrons amplify the last-bit differences of exp() about tenfold every three steps: 30 steps keeps them below 1e-5 Å)
  const n = Math.min(A.S.hi, B.S.hi); let maxd = 0;
  for (let i = 0; i < n; i++) { if (A.S.dead[i] || B.S.dead[i]) continue; maxd = Math.max(maxd, Math.abs(A.S.x[i] - B.S.x[i]), Math.abs(A.S.y[i] - B.S.y[i])); }
  const ca = JSON.stringify(A.W.count), cb = JSON.stringify(B.W.count);
  const ea = A.totalEnergy().total, eb = B.totalEnergy().total;
  console.log(`${scen}, 30 steps with and without the module: positions within ${maxd.toExponential(2)} Å, events ${ca === cb ? 'same' : 'DIFFERENT'}, energy ${ea.toFixed(6)} vs ${eb.toFixed(6)} eV`);
  if (maxd > 1e-4) fail(scen + ': runs diverged by ' + maxd); // (where the amplification lands after 30 steps depends on the trajectory: a few times 1e-5 Å either way)
  if (ca !== cb) fail(scen + ': events differ ' + ca + ' vs ' + cb);
  if (Math.abs(ea - eb) > 1e-6 * Math.max(1, Math.abs(ea))) fail(scen + ': energies differ');
}
if (fails) { console.log(fails + ' wasm failure(s)'); process.exit(1); }
console.log('wasm checks passed');
