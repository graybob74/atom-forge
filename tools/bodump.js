// A memory image for kernel/examples/bocheck.rs (1.18): node tools/bodump.js <out.bin> [setup: gallery | water | brine | …]
// The state just before a JavaScript bond orders pass, laid out as the page lays it out, and that pass's results.
const fs = require('fs');
const X = require(require('path').join(__dirname, '..', 'tests', 'load.js')).load('all', { seed: 3 }), W = X.W;
const setup = process.argv[3] || 'gallery';
if (setup === 'gallery') { X.PRESETS.gallery.build(); X.addMolecule('H3Op', 0, 0, 0, 300); X.addMolecule('SF6', 8, 0, 0, 300); for (const p of W.parts) if (p.k !== X.NUC) X.kill(p); X.settleOverlaps(); }
else { X.PRESETS[setup].build(); for (const p of W.parts) if (p.k !== X.NUC) X.kill(p); }
X.boSet(true); X.forcesNoEvents(); W.fSpawn = W.spawned;
for (let i = 0; i < 40; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
X.forcesNoEvents();
const BF = X.BF, BFW = X.BFW, S = X.S, VL = X.VL, WK = X.WK;
if (process.env.FRAC) W.parts.filter(p => p.bom && p.Z > 1).forEach((p, i) => { p._dq = ((i * 0.37) % 0.6) - 0.3; }); // (moving charge: counts off the whole)
if (!X.bfWasmInit()) throw new Error('no wasm memory');
const nm = X.bfMembers(); X.bfScratch(nm); X.bfSupRoom(4 * VL.np + 16); X.bfTypesAll(); X.bfGrow(VL.np + 1, nm);
const P = BFW.par; P.fill(0);
P[3] = W.wall === 'wrap' ? 1 : 0; P[4] = W.box.w; P[5] = W.box.h; P[6] = W.box.w / 2; P[7] = W.box.h / 2; P[13] = VL.np; P[11] = BF.pcapN; P[1] = nm; P[2] = 1; P[12] = X.BF_SUP1 ? 0 : 0;
if (!X.bfDescFill()) throw new Error('desc');
S.fx.fill(0); S.fy.fill(0);
P[12] = 4 * VL.np + 16;
const image = Buffer.from(new Uint8Array(WK.mem.buffer, 0, WK.top));  // (a copy)
// the JavaScript pass on the same state
const E = X.boPassJS(true), n = BF.np, hi = S.hi;
const fx = Float64Array.from(S.fx.subarray(0, hi)), fy = Float64Array.from(S.fy.subarray(0, hi)), pn = Float64Array.from(BF.pn.subarray(0, n)), mq = Float64Array.from(BF.mq.subarray(0, nm)); const gq = Float64Array.from(BF.mgq.subarray(0, nm));
BF.mphi.fill(0, 0, nm); X.bfPhiOthers(); const po = Float64Array.from(BF.mphi.subarray(0, nm));
const hdr = Buffer.alloc(64); hdr.write('AFB1', 0); hdr.writeUInt32LE(64, 4); hdr.writeUInt32LE(image.length, 8); hdr.writeUInt32LE(BFW.desc.byteOffset, 12); hdr.writeUInt32LE(P.byteOffset, 16);
hdr.writeUInt32LE(nm, 20); hdr.writeUInt32LE(n, 24); hdr.writeUInt32LE(hi, 28); hdr.writeDoubleLE(E - BF.eI, 32); // (the internal energies off the whole counts are added by the JavaScript)
const parts = [hdr, Buffer.from(fx.buffer), Buffer.from(fy.buffer), Buffer.from(pn.buffer), Buffer.from(mq.buffer), Buffer.from(po.buffer), Buffer.from(gq.buffer)];
let len = parts.reduce((a, b) => a + b.length, 0); const pad = Buffer.alloc((8 - len % 8) % 8); parts.push(pad, image);
fs.writeFileSync(process.argv[2], Buffer.concat(parts));
console.log(JSON.stringify({ setup, nm, n, hi, E, img: image.length, others: po.some(v => v !== 0) }));
