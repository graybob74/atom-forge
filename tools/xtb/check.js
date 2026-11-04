'use strict';
// Runs every geometry of tools/xtb-ref/geoms.json through gfn1.js and compares with tblite's numbers in ref.json:
// |dE| against E - Edisp (gfn1.js has no D3 dispersion), the largest Mulliken charge difference, and the largest
// gradient component difference against grad - gdisp (eV/Å). Then a finite-difference self-check of the analytic
// gradient against the port's own energy on three geometries (one with d shells).
// Usage: node tools/xtb/check.js [--time]
const path = require('path');
const { gfn1Energy } = require('./gfn1.js');
const geoms = require(path.join(__dirname, '../xtb-ref/geoms.json'));
const refs = require(path.join(__dirname, '../xtb-ref/ref.json'));

const TOL_E = 1e-4, TOL_Q = 1e-4, TOL_G = 1e-5;
let worstE = 0, worstQ = 0, worstG = 0, fails = 0;
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('geometry', 22), pad('|dE| eV', 11), pad('max|dq|', 11), pad('max|dg| eV/Å', 13), pad('iter', 5), 'ms (E+g)');
for (let k = 0; k < geoms.length; k++) {
  const g = geoms[k], r = refs.find(x => x.name === g.name);
  if (!r || r.error) { console.log(pad(g.name, 22), 'no reference', r && r.error || ''); fails++; continue; }
  const t0 = process.hrtime.bigint();
  const o = gfn1Energy(g.Z, g.xyz, g.charge || 0, g.uhf || 0, { grad: true });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const dE = Math.abs(o.E - (r.E - r.Edisp));
  let dq = 0, dg = 0;
  for (let i = 0; i < g.Z.length; i++) {
    dq = Math.max(dq, Math.abs(o.q[i] - r.q[i]));
    // tblite's total gradient minus its D3(BJ) part = the electronic + repulsion gradient the port computes
    for (let c = 0; c < 3; c++) dg = Math.max(dg, Math.abs(o.g[i][c] - (r.grad[i][c] - r.gdisp[i][c])));
  }
  const bad = !(dE < TOL_E && dq < TOL_Q && dg < TOL_G) || !o.converged;
  if (bad) fails++;
  worstE = Math.max(worstE, dE); worstQ = Math.max(worstQ, dq); worstG = Math.max(worstG, dg);
  console.log(pad(g.name, 22), pad(dE.toExponential(2), 11), pad(dq.toExponential(2), 11), pad(dg.toExponential(2), 13),
    pad(o.iterations, 5), ms.toFixed(1) + (o.converged ? '' : '  NOT CONVERGED') + (bad ? '  FAIL' : ''));
}
console.log(`\n${geoms.length} geometries: ${geoms.length - fails} pass, ${fails} fail; worst |dE| ${worstE.toExponential(2)} eV,` +
  ` worst max|dq| ${worstQ.toExponential(2)}, worst max|dg| ${worstG.toExponential(2)} eV/Å` +
  ` (tolerance ${TOL_E} eV, ${TOL_Q} e, ${TOL_G} eV/Å)`);

// Finite-difference self-check: central differences of the port's own energy, h = 1e-4 Å, against the analytic g.
// The SCC is converged tightly here (accuracy 1e-6) so the energies are smooth enough to difference; the leftover
// difference is the h^2 truncation error of the central difference (it scales as h^2: ~4x larger at h = 2e-4).
// The Richardson column (4 energies per coordinate, h and 2h) removes that term.
const TOL_FD = 2e-6;
const fdGeoms = [
  geoms.find(x => x.name === 'H2O2~'),
  geoms.find(x => x.name === 'H5O2+ R2.5 x1.250'),
  // not in the reference set: sulfur brings d shells into the overlap derivatives
  { name: 'H2SO2 (S d shells)', Z: [16, 8, 8, 1, 1], charge: 0, uhf: 0,
    xyz: [[0, 0, 0], [1.45, 0.1, 0], [-0.7, 1.25, 0.1], [0.2, -0.9, 1.1], [-0.3, -1.0, -1.05]] },
];
console.log('\nfinite-difference self-check (accuracy 1e-6, h = 1e-4 Å)');
console.log(pad('geometry', 22), pad('max|g - FD| eV/Å', 18), 'with Richardson');
let fdFails = 0;
for (const g of fdGeoms) {
  const opts = { accuracy: 1e-6 };
  const E = x => gfn1Energy(g.Z, x, g.charge || 0, g.uhf || 0, opts).E;
  const o = gfn1Energy(g.Z, g.xyz, g.charge || 0, g.uhf || 0, { ...opts, grad: true });
  const h = 1e-4;
  let d1 = 0, d2 = 0;
  for (let i = 0; i < g.Z.length; i++) for (let c = 0; c < 3; c++) {
    const at = s => { const x = g.xyz.map(p => p.slice()); x[i][c] += s; return E(x); };
    const fd1 = (at(h) - at(-h)) / (2 * h), fd2 = (at(2 * h) - at(-2 * h)) / (4 * h);
    d1 = Math.max(d1, Math.abs(fd1 - o.g[i][c]));
    d2 = Math.max(d2, Math.abs((4 * fd1 - fd2) / 3 - o.g[i][c]));
  }
  const bad = !(d1 < TOL_FD) || !o.converged;
  if (bad) fdFails++;
  console.log(pad(g.name, 22), pad(d1.toExponential(2), 18), d2.toExponential(2) + (bad ? '  FAIL' : ''));
}
console.log(`finite differences: ${fdGeoms.length - fdFails} pass, ${fdFails} fail (tolerance ${TOL_FD} eV/Å)`);

if (process.argv.includes('--time')) {
  // steady-state timing (after warm-up) for two sizes, energy alone and energy + gradient
  console.log('');
  for (const name of ['benzene', 'H5O2+ R2.5 x1.050']) {
    const g = geoms.find(x => x.name === name);
    const run = opts => {
      for (let i = 0; i < 20; i++) gfn1Energy(g.Z, g.xyz, g.charge, g.uhf, opts);
      const n = 200, t0 = process.hrtime.bigint();
      for (let i = 0; i < n; i++) gfn1Energy(g.Z, g.xyz, g.charge, g.uhf, opts);
      return Number(process.hrtime.bigint() - t0) / 1e6 / n;
    };
    const tE = run({}), tG = run({ grad: true });
    console.log(`timing ${name}: ${tE.toFixed(2)} ms per energy, ${tG.toFixed(2)} ms per energy + gradient` +
      ` (gradient adds ${(tG - tE).toFixed(2)} ms, x${(tG / tE).toFixed(2)})`);
  }
}
process.exitCode = fails || fdFails ? 1 : 0;
