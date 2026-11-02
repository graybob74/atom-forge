'use strict';
/* What charge equilibration (QEq) would cost: one solve of the charges of every atom by conjugate gradients over the
   pairs within 6 Å (Coulomb shielded as 14.4/√(r² + 0.5) eV·Å, the atoms' hardness on the diagonal). node bench-qeq.js <scenario> */
const { load } = require('../../tests/load.js');
const X = load('all', { seed: 12 }); const { W } = X; X.setMaxParts(12000);
const scen = process.argv[2] || 'water';
if (scen === 'water4k') { X.baseWorld(300, 200, 300, 0.05); const nx = 60, ny = 22; for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) X.addMolecule('H2O', -150 + (i + 0.5) * 300 / nx, -100 + (j + 0.5) * 200 / ny, X.rnd() * 6, 300); }
else if (scen === 'water12k') { X.baseWorld(560, 360, 300, 0.05); for (let i = 0; i < 80; i++) for (let j = 0; j < 50; j++) X.addMolecule('H2O', -280 + (i + 0.5) * 7, -180 + (j + 0.5) * 7.2, X.rnd() * 6, 300); }
else X.PRESETS[scen].build();
X.settleOverlaps();
const A = W.parts.filter(p => !p.dead && p.k === X.NUC && p.ne > 0), n = A.length;
const t0 = performance.now();
// pairs (grid)
const cell = 6, grid = new Map(), key = (i, j) => i * 100003 + j;
A.forEach((p, k) => { const g = key(Math.floor(p.x / cell), Math.floor(p.y / cell)); (grid.get(g) || grid.set(g, []).get(g)).push(k); });
const I = [], J = [], V = [];
A.forEach((p, k) => { const gi = Math.floor(p.x / cell), gj = Math.floor(p.y / cell); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const m of grid.get(key(gi + a, gj + b)) || []) { if (m <= k) continue; const q = A[m], r2 = (p.x - q.x) ** 2 + (p.y - q.y) ** 2; if (r2 < 36) { I.push(k); J.push(m); V.push(14.4 / Math.sqrt(r2 + 0.5)); } } });
const tPairs = performance.now() - t0;
const diag = A.map(p => 2 * ((p.el.ie1 || 10) - (p.el.ea || 0)) / 2 + 2), chi = A.map(p => p.el.en || 2.5);
const mul = (x, y) => { for (let k = 0; k < n; k++) y[k] = diag[k] * x[k]; for (let e = 0; e < I.length; e++) { y[I[e]] += V[e] * x[J[e]]; y[J[e]] += V[e] * x[I[e]]; } };
const cg = (b, x, it) => { const r = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n); mul(x, Ap); for (let k = 0; k < n; k++) { r[k] = b[k] - Ap[k]; p[k] = r[k]; } let rr = r.reduce((s, v) => s + v * v, 0); for (let i = 0; i < it; i++) { mul(p, Ap); const a = rr / p.reduce((s, v, k) => s + v * Ap[k], 0); for (let k = 0; k < n; k++) { x[k] += a * p[k]; r[k] -= a * Ap[k]; } const r2 = r.reduce((s, v) => s + v * v, 0); for (let k = 0; k < n; k++) p[k] = r[k] + r2 / rr * p[k]; rr = r2; } return Math.sqrt(rr); };
const b = Float64Array.from(chi, v => -v), x = new Float64Array(n);
cg(b, x, 5); // warm-up
const t1 = performance.now(); let res = 0; const REP = 10; for (let r = 0; r < REP; r++) { x.fill(0); res = cg(b, x, 15); }
const tSolve = (performance.now() - t1) / REP;
const t2 = performance.now(); for (let r = 0; r < REP; r++) cg(b, x, 3); const tWarm = (performance.now() - t2) / REP;
console.log(JSON.stringify({ scen, atoms: n, pairs: I.length, msPairs: +tPairs.toFixed(2), msSolveCold15: +tSolve.toFixed(2), msSolveWarm3: +tWarm.toFixed(2), residual: +res.toExponential(1) }));
