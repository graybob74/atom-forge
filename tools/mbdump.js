'use strict';
/* A memory image for kernel/examples/mbcheck.rs (1.26): the many-body metals' pass (bometal.js mbPass) just before the
   module's part (af_mb), and the JavaScript pass's results on the same state.
     node tools/mbdump.js <out.bin> <al | al3 | cu3 | alloy3 | wrap3>
   al: a flat Al patch; al3, cu3: 3-D balls; alloy3: a Cu–Ag–Au ball; wrap3: Cu in a periodic 3-D box. */
const fs = require('fs'), path = require('path');
const { load } = require(path.join(__dirname, '..', 'tests', 'load.js'));
const [out, scen] = process.argv.slice(2);
const X = load('all', { seed: 4 }), W = X.W, S = X.S, WK = X.WK;
if (!WK.on || !WK.ready) { console.error('the module is not ready: ' + WK.note); process.exit(2); }
const ball = (syms, a, R, d3, wrap) => {
  X.baseWorld(wrap ? 4 * R : R * 6, wrap ? 4 * R : R * 6, 300, 0.05); if (d3) X.world3d(wrap ? 4 * R : R * 6); if (wrap) W.wall = 'wrap';
  let n = 0;
  if (!d3) { const m = Math.ceil(R / a) + 1; for (let j = -m; j <= m; j++) for (let i = -m; i <= m; i++) { const x = (i + 0.5 * (j & 1)) * a, y = j * a * Math.sqrt(3) / 2; if (x * x + y * y <= R * R) X.addAtom(syms[n++ % syms.length], x, y); } }
  else { const c = a * Math.SQRT2, B = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]], m = Math.ceil(R / c) + 1; for (let i = -m; i <= m; i++) for (let j = -m; j <= m; j++) for (let k = -m; k <= m; k++) for (const b of B) { const x = (i + b[0]) * c, y = (j + b[1]) * c, z = (k + b[2]) * c; if (x * x + y * y + z * z <= R * R) X.addAtom(syms[n++ % syms.length], x, y, { z }); } }
};
({ al: () => ball(['Al'], 2.86, 22.5, false), al3: () => ball(['Al'], 2.86, 15.6, true), cu3: () => ball(['Cu'], 2.56, 12, true), alloy3: () => ball(['Cu', 'Ag', 'Au'], 2.7, 11, true), wrap3: () => ball(['Cu'], 2.56, 9, true, true) })[scen]();
X.settleOverlaps(); X.mbSet(1);
for (let i = 0; i < 30; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
X.forcesNoEvents();
const hi = S.hi, fx0 = Float64Array.from(S.fx.subarray(0, hi)), fy0 = Float64Array.from(S.fy.subarray(0, hi)), fz0 = Float64Array.from(S.fz.subarray(0, hi));
X.MBO.useWasm = false; X._stiff = 0; const E = X.mbPass(true), st = X._stiff, npJS = X.MBO.np;
const fx1 = Float64Array.from(S.fx.subarray(0, hi)), fy1 = Float64Array.from(S.fy.subarray(0, hi)), fz1 = Float64Array.from(S.fz.subarray(0, hi));
S.fx.set(fx0); S.fy.set(fy0); S.fz.set(fz0);
let image = null, toff = 0, poff = 0;
const ex = WK.ex; WK.ex = Object.assign({}, ex, { af_mb: (t, p) => { toff = t; poff = p; image = Buffer.from(new Uint8Array(WK.mem.buffer, 0, WK.top)); new Float64Array(WK.mem.buffer, p, 24)[20] = 0; } });
X.MBO.useWasm = true; X.mbPass(true); WK.ex = ex;
if (!image) { console.error('mbWasm did not call the module'); process.exit(1); }
const hdr = Buffer.alloc(64); hdr.write('AFMB', 0); hdr.writeUInt32LE(64, 4); hdr.writeUInt32LE(image.length, 8); hdr.writeUInt32LE(toff, 12); hdr.writeUInt32LE(poff, 16); hdr.writeUInt32LE(hi, 20);
hdr.writeDoubleLE(E, 24); hdr.writeDoubleLE(st, 32); hdr.writeUInt32LE(npJS, 40);
const parts = [hdr, Buffer.from(fx1.buffer), Buffer.from(fy1.buffer), Buffer.from(fz1.buffer)];
const len = parts.reduce((a, b) => a + b.length, 0); parts.push(Buffer.alloc((8 - len % 8) % 8), image);
fs.writeFileSync(out, Buffer.concat(parts));
console.log(JSON.stringify({ scen, members: X.MBO.n, pairs: npJS, E, stiff: st, MB: +(image.length / 1048576).toFixed(1) }));
