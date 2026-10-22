'use strict';
/* Dumps a world's force-kernel inputs and the JS kernels' outputs for kernel/examples/check.rs:
     node tools/kdump.js <scenario> <out.bin> [steps]
   scenario: water12k | a preset key (water, flashbyte, plasma, antih …). The image is laid out as the page lays the
   store out in WebAssembly memory (8-aligned arrays, a descriptor of byte offsets: kernel/src/lib.rs D_*). */
const fs = require('fs'), path = require('path');
const { load } = require(path.join(__dirname, '..', 'tests', 'load.js'));
const [scen, out, stepsArg] = process.argv.slice(2);
if (!scen || !out) { console.error('usage: kdump.js <scenario> <out.bin> [steps]'); process.exit(2); }
const X = load('all', { seed: 12 });
const { W, S, VL, BD, AC } = X;
X.setMaxParts(12000);
if (scen === 'water12k') {
  X.baseWorld(560, 360, 300, 0.05);
  const nx = 80, ny = 50, dx = 560 / nx, dy = 360 / ny;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { if (W.parts.length + 3 > 12000) break; X.addMolecule('H2O', -280 + (i + 0.5) * dx + (X.rnd() - 0.5) * 0.4, -180 + (j + 0.5) * dy + (X.rnd() - 0.5) * 0.4, X.rnd() * 6, 300); }
  X.settleOverlaps();
} else if (scen === 'waterion') {
  X.PRESETS.water.build(); X.settleOverlaps();
  const Os = W.parts.filter(p => p.Z === 8); for (let i = 0; i < 40 && i < Os.length; i++) X.userIonize(Os[i]);
} else if (scen === 'saltwater') { // (a salt crystal in water: the ions' pull on the water, K_IW)
  X.PRESETS.empty.build(); W.box.w = W.box.tw = 52; W.box.h = W.box.th = 52; W.wall = 'wrap'; W.T = 300; W.gamma = 0.05;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { const p = (i + j) % 2 === 0 ? X.addNuc(11, 12, 10, (i - 2.5) * 2.82, (j - 2.5) * 2.82, 0, 0, false) : X.addNuc(17, 18, 18, (i - 2.5) * 2.82, (j - 2.5) * 2.82, 0, 0, false); X.refresh(p); }
  let w = 0; for (let t = 0; t < 20000 && w < 230; t++) { const x = (X.rnd() - 0.5) * 50, y = (X.rnd() - 0.5) * 50; if (Math.abs(x) < 10.5 && Math.abs(y) < 10.5) continue; if (X.spawnClear({ kind: 'mol', mol: 'H2O' }, x, y, 300).length) w++; }
  X.settleOverlaps();
} else { if (!X.PRESETS[scen]) { console.error('no preset', scen); process.exit(2); } X.PRESETS[scen].build(); X.settleOverlaps(); }
W.decayOn = false;
const nSteps = +(stepsArg || 30);
for (let i = 0; i < nSteps; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
// a force pass's inputs as computeForces leaves them: rebuild the grid/lists the way computeForces does, then run the kernels alone
X.forcesNoEvents(); // (lists current)
X.bondArrays(); X.angleCentres();
const n = S.hi, np = VL.np, nb = BD.n, na = AC.n;
const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2, step = W.step;
// JS kernels' result
const fx = new Float64Array(n), fy = new Float64Array(n), CQ = new Int32Array(9 * (np + nb) + 64);
X._kStiff = 0;
let nc = X.pairKernel(VL.pi, VL.pj, VL.ex, 0, np, fx, fy, CQ, 0, wrap, bw, bh, hw, hh, step);
nc = X.bondKernel(0, nb, fx, fy, CQ, nc, wrap, bw, bh, hw, hh);
X.angleKernel(0, na, fx, fy, wrap, bw, bh, hw, hh);
const ks = X._kStiff;
// the memory image
const F64 = ['x', 'y', 'vx', 'vy', 'm', 'im', 'q', 'qp', 'ljR', 'ljS', 'ionR', 'elrc', 'mR', 'mD'], I16 = ['Z', 'ne', 'cap', 'used', 'lp'], U8 = ['ionic', 'isMetal', 'anti', 'xferD', 'xferA', 'metal'], I32 = ['mol', 'id'];
const parts = []; let top = 1024;
const put = (arr, len) => { const bytes = len * arr.BYTES_PER_ELEMENT; const off = top; top += (bytes + 7) & ~7; parts.push([off, arr, len]); return off; };
const desc = new Int32Array(40);
let k = 0;
for (const f of F64) desc[k++] = put(S[f], n);
for (const f of I16) desc[k++] = put(S[f], n);
for (const f of U8) desc[k++] = put(S[f], n);
for (const f of I32) desc[k++] = put(S[f], n);
desc[k++] = put(VL.pi, np); desc[k++] = put(VL.pj, np); desc[k++] = put(VL.ex, np);
for (const f of ['a', 'b', 'r0', 'al', 'D', 'rb']) desc[k++] = put(BD[f], nb);
desc[k++] = put(AC.c, na); desc[k++] = put(AC.nb, na * 6); desc[k++] = put(AC.cnt, na); desc[k++] = put(AC.tg, na * 6);
const descOff = put(desc, 40);
const fxoOff = put(new Float64Array(n), n), fyoOff = put(new Float64Array(n), n), cqOff = put(new Int32Array(CQ.length), CQ.length), ksOff = put(new Float64Array(1), 1);
const mem = Buffer.alloc(top);
for (const [off, arr, len] of parts) Buffer.from(arr.buffer, arr.byteOffset, len * arr.BYTES_PER_ELEMENT).copy(mem, off);
// the file: header, expected outputs, image
const hdr = Buffer.alloc(104);
hdr.write('AFK1', 0); const u = (o, v) => hdr.writeUInt32LE(v, o), d = (o, v) => hdr.writeDoubleLE(v, o);
u(4, 104); u(8, top); u(12, n); u(16, np); u(20, nb); u(24, na); u(28, wrap ? 1 : 0); u(32, descOff); u(36, fxoOff); u(40, fyoOff); u(44, cqOff); u(48, ksOff); u(52, nc);
d(56, bw); d(64, bh); d(72, hw); d(80, hh); d(88, step); d(96, ks);
const exp = Buffer.concat([Buffer.from(fx.buffer), Buffer.from(fy.buffer), Buffer.from(CQ.buffer, 0, 4 * nc)]);
const pad = Buffer.alloc((8 - ((hdr.length + exp.length) % 8)) % 8);
fs.writeFileSync(out, Buffer.concat([hdr, exp, pad, mem]));
console.log(JSON.stringify({ scenario: scen, slots: n, pairs: np, bonds: nb, centres: na, candidates: nc / 3, kstiff: ks, bytes: top }));
