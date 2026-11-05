'use strict';
/* Dumps a 3-D world's force-kernel inputs and the JavaScript 3-D kernels' outputs for kernel/examples/check3.rs:
     node tools/k3dump.js <scenario> <out.bin> [steps]
   scenario: a 3-D preset key (water3d, brine3d, combustion3d, mol3d, hydrogen3d …), combustion3d-spark (H₂ + O₂ after a
   spark: radicals, bond and reaction candidates), mix3d (molecules with every 3-D angle mode, metals, bare nuclei,
   antimatter, ions; walls, not periodic). The image is the WebAssembly memory itself (in Node every store array, list
   and the descriptor live in it): the check runs the Rust kernel on a copy and compares with the JavaScript's results. */
const fs = require('fs'), path = require('path');
const { load } = require(path.join(__dirname, '..', 'tests', 'load.js'));
const [scen, out, stepsArg] = process.argv.slice(2);
if (!scen || !out) { console.error('usage: k3dump.js <scenario> <out.bin> [steps]'); process.exit(2); }
const X = load('all', { seed: 12 });
const { W, S, VL, BD, AC, AC3, WK } = X;
if (!WK.on || !WK.ready) { console.error('the module is not ready: ' + WK.note); process.exit(2); }
if (scen === 'mix3d') {
  X.baseWorld(30, 30, 300, 0.05); X.world3d(30);
  const mols = ['benzene', 'C2H4', 'CO2', 'SF6', 'PCl5', 'XeF4', 'ClF3', 'SF4', 'BrF5', 'BF3', 'CH4', 'NH3', 'H2O', 'H2O', 'NaOH', 'FeCl3'];
  mols.forEach((k, n) => X.addMolecule(k, -10 + (n % 4) * 6.5, -10 + Math.floor(n / 4) * 6.5, X.rnd() * 6, 300, (n % 2 ? -1 : 1) * 6));
  for (let k = 0; k < 6; k++) X.addAtom('Na', -3 + (k % 3) * 3.1, 12, { z: -12 + Math.floor(k / 3) * 3.1 }); // (a metal cluster)
  for (let k = 0; k < 4; k++) X.addAtom('Cu', 8 + (k % 2) * 2.6, 12, { z: 8 + Math.floor(k / 2) * 2.6 });
  for (let k = 0; k < 3; k++) X.addAtom('H', 12, -12 + 3 * k, { bare: true, z: 2 * k }); // (bare protons)
  X.addAtom('He', -12, -12, { bare: true, z: 0 }); // (an alpha particle)
  X.addAtom('H', -12, 12, { anti: true, z: -2 }); X.addAtom('H', -11, 12, { anti: true, z: 2 }); // (antihydrogen)
  X.addAtom('Cl', 0, -13, { charge: -1, z: 0 }); X.addAtom('Na', 2.5, -13, { charge: 1, z: 0 });
  X.settleOverlaps();
} else {
  const key = scen === 'combustion3d-spark' ? 'combustion3d' : scen;
  if (!X.PRESETS[key] || !X.PRESETS[key].d3) { console.error('no 3-D preset', key); process.exit(2); }
  X.PRESETS[key].build(); X.settleOverlaps();
}
W.decayOn = false;
const run = (n) => { for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };
run(+(stepsArg || 30));
if (scen === 'combustion3d-spark') { X.spark(0, 0, 6, 150, 0); X.spark(8, -8, 6, 150, 8); run(60); }
X.forcesNoEvents(); X.bondArrays(); X.angleCentres3();
const n = S.hi, np = VL.np, nb = BD.n, na = AC.n, nt = AC3.nt;
const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = W.box.d, hw = bw / 2, hh = bh / 2, hd = bd / 2, step = W.step;
// the JavaScript kernels' result
const fx = new Float64Array(n), fy = new Float64Array(n), fz = new Float64Array(n), CQ = new Int32Array(9 * (np + nb) + 64);
X._kStiff = 0;
let nc = X.pairKernel3(VL.pi, VL.pj, VL.ex, 0, np, fx, fy, fz, CQ, 0, wrap, bw, bh, bd, hw, hh, hd, step);
nc = X.bondKernel3(0, nb, fx, fy, fz, CQ, nc, wrap, bw, bh, bd, hw, hh, hd);
X.angleKernel3(0, na, 0, nt, fx, fy, fz, wrap, bw, bh, bd);
const ks = X._kStiff;
// the outputs for the Rust kernel, zeroed, in the module's memory; then the descriptor
const ofx = X.shArray(Float64Array, n), ofy = X.shArray(Float64Array, n), ofz = X.shArray(Float64Array, n), ocq = X.shArray(Int32Array, CQ.length);
X.wasmDesc(); X.wasmDesc3();
const top = WK.top, mem = Buffer.from(WK.mem.buffer, 0, top);
const hdr = Buffer.alloc(160);
hdr.write('AFK3', 0); const u = (o, v) => hdr.writeUInt32LE(v, o), d = (o, v) => hdr.writeDoubleLE(v, o);
u(4, 160); u(8, top); u(12, n); u(16, np); u(20, nb); u(24, na); u(28, nt); u(32, wrap ? 1 : 0); u(36, WK.desc.byteOffset); u(40, ofx.byteOffset); u(44, ofy.byteOffset); u(48, ofz.byteOffset); u(52, ocq.byteOffset); u(56, nc);
d(64, bw); d(72, bh); d(80, bd); d(88, hw); d(96, hh); d(104, hd); d(112, step); d(120, ks);
const exp = Buffer.concat([Buffer.from(fx.buffer), Buffer.from(fy.buffer), Buffer.from(fz.buffer), Buffer.from(CQ.buffer, 0, 4 * nc)]);
const pad = Buffer.alloc((8 - ((hdr.length + exp.length) % 8)) % 8);
fs.writeFileSync(out, Buffer.concat([hdr, exp, pad, mem]));
const modes = [0, 0, 0, 0, 0]; for (let c = 0; c < na; c++) modes[AC3.mode[c]]++; let flat = 0; for (let c = 0; c < na; c++) flat += AC3.flat[c];
const kinds = {}; for (let k = 0; k < nc; k += 3) kinds[CQ[k]] = (kinds[CQ[k]] || 0) + 1;
console.log(JSON.stringify({ scenario: scen, slots: n, pairs: np, bonds: nb, centres: na, modes, flat, dihedrals: nt, candidates: kinds, kstiff: ks, wrap, MB: +(top / 1048576).toFixed(1) }));
