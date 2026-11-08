'use strict';
/* A memory image for kernel/examples/qeqcheck.rs (1.26): induced charges' pairs (engine.js qeqUpdate) just before the
   module's part (af_qeq), and the JavaScript loop's list on the same state.
     node tools/qeqdump.js <out.bin> <preset: water | brine | water3d | brine3d | combustion3d …> */
const fs = require('fs'), path = require('path');
const { load } = require(path.join(__dirname, '..', 'tests', 'load.js'));
const [out, pre] = process.argv.slice(2);
const X = load('all', { seed: 6 }), W = X.W, S = X.S, WK = X.WK, VL = X.VL, QB = X.QB;
if (!WK.on || !WK.ready) { console.error('the module is not ready: ' + WK.note); process.exit(2); }
X.PRESETS[pre].build(); X.QEQ.every = 1;
for (let i = 0; i < 30; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
X.forcesNoEvents();
// the molecules qeqUpdate would update, marked as it marks them
const mols = new Map();
for (const p of W.parts) { if (p.dead || p.k !== X.NUC || p.Z === 0 || p.ne === 0 || p.fast || p.rad || !p.bonds.length || p.anti) continue; let m = mols.get(p.mol); if (!m) mols.set(p.mol, m = []); m.push(p); }
if (QB.mark.length < S.size) QB.mark = X.shArray(Uint8Array, S.size * 2);
QB.mark.fill(0); for (const m of mols.values()) if (m.length >= 2 && m.length <= X.QEQ.maxMol) for (const p of m) QB.mark[p.i] = 1;
// the JavaScript's loop (qeqUpdate's, as written there)
const exp = [];
{ const mark = QB.mark, X_ = S.x, Y = S.y, Zp = S.z, OBJ = S.obj, d3 = W.d3, pi = VL.pi, pj = VL.pj, K = S.k, Zs = S.Z, DEAD = S.dead, FAST = S.fast, RAD = S.rad, MOL = S.mol, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2, Q = S.q, QP = S.qp;
  for (let k = 0, n = VL.np; k < n; k++) {
    const i = pi[k], j = pj[k]; if (!mark[i] && !mark[j]) continue;
    if (K[i] !== X.NUC || K[j] !== X.NUC || Zs[i] === 0 || Zs[j] === 0 || DEAD[i] || DEAD[j] || FAST[i] || FAST[j] || RAD[i] || RAD[j]) continue;
    let dx = X_[j] - X_[i], dy = Y[j] - Y[i], dz = d3 ? Zp[j] - Zp[i] : 0;
    if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (d3) { const bd = W.box.d; if (dz > bd / 2) dz -= bd; else if (dz < -bd / 2) dz += bd; } }
    const r2 = d3 ? dx * dx + dy * dy + dz * dz : dx * dx + dy * dy; if (r2 >= X.RC2) continue;
    const a = OBJ[i], b = OBJ[j];
    if (MOL[i] !== 0 && MOL[i] === MOL[j] && a.excl && a.excl.has(b.id)) continue;
    const c = X.qeqC(a, b, r2); if (c) exp.push([i, j, c, (Q[i] + QP[i]) * (Q[j] + QP[j])]);
  } }
let image = null, toff = 0, poff = 0;
const ex = WK.ex; WK.ex = Object.assign({}, ex, { af_qeq: (t, p) => { toff = t; poff = p; image = Buffer.from(new Uint8Array(WK.mem.buffer, 0, WK.top)); new Float64Array(WK.mem.buffer, p, 16)[14] = 0; } });
X.qeqPairsWasm(); WK.ex = ex;
if (!image) { console.error('qeqPairsWasm did not call the module'); process.exit(1); }
const hdr = Buffer.alloc(32); hdr.write('AFQE', 0); hdr.writeUInt32LE(32, 4); hdr.writeUInt32LE(image.length, 8); hdr.writeUInt32LE(toff, 12); hdr.writeUInt32LE(poff, 16); hdr.writeUInt32LE(exp.length, 20);
const e = Buffer.alloc(24 * exp.length); exp.forEach(([i, j, c, q0], k) => { e.writeInt32LE(i, 24 * k); e.writeInt32LE(j, 24 * k + 4); e.writeDoubleLE(c, 24 * k + 8); e.writeDoubleLE(q0, 24 * k + 16); });
fs.writeFileSync(out, Buffer.concat([hdr, e, image]));
console.log(JSON.stringify({ pre, d3: !!W.d3, listPairs: VL.np, pairs: exp.length, lr: X._lrOn, MB: +(image.length / 1048576).toFixed(1) }));
