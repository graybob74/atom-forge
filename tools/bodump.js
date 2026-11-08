// A memory image for kernel/examples/bocheck.rs (1.18): node tools/bodump.js <out.bin> [setup: gallery | water | brine | heavy | water3d | mol3d | org3 | mix3 | …]
// The state just before a JavaScript bond orders pass, laid out as the page lays it out, and that pass's results.
const fs = require('fs');
const X = require(require('path').join(__dirname, '..', 'tests', 'load.js')).load('all', { seed: 3 }), W = X.W;
const setup = process.argv[3] || 'gallery';
if (setup === 'gallery') { X.PRESETS.gallery.build(); X.addMolecule('H3Op', 0, 0, 0, 300); X.addMolecule('SF6', 8, 0, 0, 300); for (const p of W.parts) if (p.k !== X.NUC) X.kill(p); X.settleOverlaps(); }
else if (setup === 'heavy') { // (1.25: SbCl₃ with a Cl–Sb–Cl angle of 150°, its two ends 4.5 Å apart, past the old fixed 1-3 reach of 4.4 Å; GeCl₄, SnH₄, H₂Te)
  X.PRESETS.empty.build(); X.setBox(40, 30);
  for (const [c, l, n, x0] of [['Sb', 'Cl', 3, -12], ['Ge', 'Cl', 4, -3], ['Sn', 'H', 4, 6], ['Te', 'H', 2, 13]]) { const C = X.addAtom(c, x0, 0, { T: 300 }), L = X.bondLength(C.el, X.ELEMENTS[X.SYM2Z[l]], 1); for (let i = 0; i < n; i++) { const t = 2 * Math.PI * i / n; X.addBond(C, X.addAtom(l, x0 + L * Math.cos(t), L * Math.sin(t), { T: 300 }), 1); } }
}
else if (setup === 'org3') { // (1.26: 3-D, organic molecules: single bonds' twist, double bonds, the 3-D angles)
  X.baseWorld(30, 30, 300, 0.05); X.world3d(30);
  ['butane', 'ethanol', 'propene', 'acetaldehyde', 'H2O2', 'methylamine', 'benzene', 'CO2'].forEach((k, i) => X.addMolecule(k, -10 + 7 * (i % 4), i < 4 ? -6 : 6, X.rnd() * 6, 300, i % 2 ? 5 : -5)); X.settleOverlaps();
} else if (setup === 'mix3') { // (1.26: 3-D, every angle mode: trigonal bipyramid, octahedron, square planar, linear, H₃O⁺, SbCl₃)
  X.baseWorld(30, 30, 300, 0.05); X.world3d(30);
  ['SF6', 'PCl5', 'XeF4', 'SF4', 'ClF3', 'BrF5', 'CO2', 'H3Op', 'H2O', 'NH3', 'C2H4', 'SbCl3'].forEach((k, i) => X.addMolecule(k, -10 + 6.5 * (i % 4), -9 + 7 * Math.floor(i / 4), X.rnd() * 6, 300, (i % 3 - 1) * 7)); X.settleOverlaps();
}
else { X.PRESETS[setup].build(); for (const p of W.parts) if (p.k !== X.NUC) X.kill(p); }
X.boSet(true); X.forcesNoEvents(); W.fSpawn = W.spawned;
for (let i = 0; i < 40; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
if (setup === 'heavy') { const sb = W.parts.find(p => p.Z === 51), cl = W.parts.filter(p => p.Z === 17).slice(0, 3); [0, 150, 255].forEach((d, i) => { cl[i].x = sb.x + 2.33 * Math.cos(d * Math.PI / 180); cl[i].y = sb.y + 2.33 * Math.sin(d * Math.PI / 180); }); X.gridTouch(); }
X.forcesNoEvents();
const BF = X.BF, BFW = X.BFW, S = X.S, VL = X.VL, WK = X.WK;
if (process.env.FRAC) W.parts.filter(p => p.bom && p.Z > 1).forEach((p, i) => { p._dq = ((i * 0.37) % 0.6) - 0.3; }); // (moving charge: counts off the whole)
if (!X.bfWasmInit()) throw new Error('no wasm memory');
const nm = X.bfMembers(); X.bfScratch(nm); X.bfSupRoom(4 * VL.np + 16); X.bfTypesAll(); X.bfGrow(VL.np + 1, nm);
const P = BFW.par; P.fill(0);
P[3] = W.wall === 'wrap' ? 1 : 0; P[4] = W.box.w; P[5] = W.box.h; P[6] = W.box.w / 2; P[7] = W.box.h / 2; P[13] = VL.np; P[11] = BF.pcapN; P[1] = nm; P[2] = 1; P[12] = X.BF_SUP1 ? 0 : 0;
const d3 = !!W.d3; if (d3) { P[16] = 1; P[17] = W.box.d; P[18] = W.box.d / 2; P[19] = X.TOR1_F0; BF.puz = X.bfArr(Float64Array, BF.pcapN); } // (3-D, 1.26)
if (!X.bfDescFill()) throw new Error('desc');
S.fx.fill(0); S.fy.fill(0); if (d3) S.fz.fill(0);
P[12] = 4 * VL.np + 16; P[15] = BF.r13; // (the 1-3 reach, 1.25)
const image = Buffer.from(new Uint8Array(WK.mem.buffer, 0, WK.top));  // (a copy)
// the JavaScript pass on the same state
const E = X.boPassJS(true), n = BF.np, hi = S.hi;
const fx = Float64Array.from(S.fx.subarray(0, hi)), fy = Float64Array.from(S.fy.subarray(0, hi)), fz = d3 ? Float64Array.from(S.fz.subarray(0, hi)) : null, pn = Float64Array.from(BF.pn.subarray(0, n)), mq = Float64Array.from(BF.mq.subarray(0, nm)); const gq = Float64Array.from(BF.mgq.subarray(0, nm));
BF.mphi.fill(0, 0, nm); X.bfPhiOthers(); const po = Float64Array.from(BF.mphi.subarray(0, nm));
const hdr = Buffer.alloc(64); hdr.write('AFB1', 0); hdr.writeUInt32LE(64, 4); hdr.writeUInt32LE(image.length, 8); hdr.writeUInt32LE(BFW.desc.byteOffset, 12); hdr.writeUInt32LE(P.byteOffset, 16);
hdr.writeUInt32LE(nm, 20); hdr.writeUInt32LE(n, 24); hdr.writeUInt32LE(hi, 28); hdr.writeDoubleLE(E - BF.eI, 32); // (the internal energies off the whole counts are added by the JavaScript)
hdr.writeUInt32LE(d3 ? 1 : 0, 40); // (3-D: the z forces follow the ∂E/∂ν's, 1.26)
const parts = [hdr, Buffer.from(fx.buffer), Buffer.from(fy.buffer), Buffer.from(pn.buffer), Buffer.from(mq.buffer), Buffer.from(po.buffer), Buffer.from(gq.buffer)].concat(d3 ? [Buffer.from(fz.buffer)] : []);
let len = parts.reduce((a, b) => a + b.length, 0); const pad = Buffer.alloc((8 - len % 8) % 8); parts.push(pad, image);
fs.writeFileSync(process.argv[2], Buffer.concat(parts));
console.log(JSON.stringify({ setup, d3, nm, n, hi, E, img: image.length, others: po.some(v => v !== 0) }));
