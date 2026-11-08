'use strict';
/* Dumps a world's neighbour-list inputs (the grid, the MD list, the kinds) and its single-bond dihedrals, with the
   JavaScript's results (vlPairs / vlPairs3's list; tors1K's forces), for kernel/examples/vlcheck.rs (1.26):
     node tools/vldump.js <scenario> <out.bin> [steps]
   scenario: a preset key, flat or 3-D (water, brine, water3d, brine3d, mol3d …), or org3 (64 organic molecules in a
   44 Å cube: single-bond dihedrals). The image is the WebAssembly memory itself; the check runs the Rust on a copy. */
const fs = require('fs'), path = require('path');
const { load } = require(path.join(__dirname, '..', 'tests', 'load.js'));
const [scen, out, stepsArg] = process.argv.slice(2);
if (!scen || !out) { console.error('usage: vldump.js <scenario> <out.bin> [steps]'); process.exit(2); }
const X = load('all', { seed: 12 });
const { W, S, VL, G, AC3, WK } = X;
if (!WK.on || !WK.ready) { console.error('the module is not ready: ' + WK.note); process.exit(2); }
if (scen === 'org3') {
  X.baseWorld(44, 44, 300, 0.05); X.world3d(44);
  const keys = ['butane', 'ethanol', 'propane', 'CH3OH', 'H2O2', 'acetaldehyde', 'propene', 'methylamine']; let k = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let l = 0; l < 4; l++) X.addMolecule(keys[k++ % keys.length], (i + 0.5) * 11 - 22, (j + 0.5) * 11 - 22, X.rnd() * 6.28, 300, (l + 0.5) * 11 - 22);
  X.settleOverlaps();
} else { X.PRESETS[scen].build(); X.settleOverlaps(); }
W.decayOn = false;
const run = (n) => { for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };
run(+(stepsArg || 30));
X.forcesNoEvents(); X.gridEnsure(); G.RL2 = X.RL2;
const d3 = !!W.d3, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = d3 ? W.box.d : 0, hw = bw / 2, hh = bh / 2, hd = bd / 2;
// the JavaScript's list
const cap = 256 * X._nmd + 4096, epi = X.shArray(Int32Array, cap), epj = X.shArray(Int32Array, cap);
const np = d3 ? X.vlPairs3(0, Infinity, epi, epj, 0, cap, G, X._mdI, S.k, wrap, bw, bh, bd, hw, hh, hd) : X.vlPairs(0, G.nocc, epi, epj, 0, cap, G, X._mdI, S.k, wrap, bw, bh, hw, hh);
const opi = X.shArray(Int32Array, cap), opj = X.shArray(Int32Array, cap);
// the single bonds' dihedrals (3-D): tors1K's forces into zeroed arrays
const n = S.hi, ns = d3 ? AC3.ns : 0, efx = new Float64Array(n), efy = new Float64Array(n), efz = new Float64Array(n);
if (ns) { X.kb3FromW(); const sq = AC3.sq, sk = AC3.sk; for (let t = 0; t < ns; t++) X.tors1K(sq[4 * t], sq[4 * t + 1], sq[4 * t + 2], sq[4 * t + 3], sk[4 * t], sk[4 * t + 1], sk[4 * t + 2], sk[4 * t + 3], efx, efy, efz); }
const ofx = X.shArray(Float64Array, n), ofy = X.shArray(Float64Array, n), ofz = X.shArray(Float64Array, n);
X.wasmDesc(); if (d3) X.wasmDesc3();
const top = WK.top, mem = Buffer.from(WK.mem.buffer, 0, top);
const H = 256, hdr = Buffer.alloc(H); hdr.write('AFVL', 0);
const u = (o, v) => hdr.writeUInt32LE(v >>> 0, o), d = (o, v) => hdr.writeDoubleLE(v, o);
u(4, H); u(8, top); u(12, d3 ? 1 : 0); u(16, np); u(20, cap); u(24, n); u(28, ns);
const off = [G.keys, G.head, G.next, G.px, G.py, d3 ? G.pz : G.px, G.occ, X._mdI, S.k, opi, opj].map(a => a.byteOffset);
off.forEach((v, k) => u(32 + 4 * k, v));
[G.cols, G.rows, d3 ? G.lay : 1, G.wrap ? 1 : 0, G.mask, G.shift, G.nocc].forEach((v, k) => u(76 + 4 * k, v));
[G.RL2, wrap ? 1 : 0, bw, bh, bd, hw, hh, hd].forEach((v, k) => d(104 + 8 * k, v));
u(168, WK.desc.byteOffset); u(172, ns ? AC3.sq.byteOffset : 0); u(176, ns ? AC3.sk.byteOffset : 0); u(180, ofx.byteOffset); u(184, ofy.byteOffset); u(188, ofz.byteOffset); d(192, X.TOR1_F0);
const exp = Buffer.concat([Buffer.from(epi.buffer, epi.byteOffset, 4 * np), Buffer.from(epj.buffer, epj.byteOffset, 4 * np), Buffer.from(efx.buffer), Buffer.from(efy.buffer), Buffer.from(efz.buffer)]);
const pad = Buffer.alloc((8 - ((H + exp.length) % 8)) % 8);
fs.writeFileSync(out, Buffer.concat([hdr, exp, pad, mem]));
console.log(JSON.stringify({ scenario: scen, d3, md: X._nmd, pairs: np, cells: G.nocc, dihedrals1: ns, MB: +(top / 1048576).toFixed(1) }));
