'use strict';
// Runs every geometry of tools/xtb-ref/geoms.json and geoms2.json through gfn2.js and compares with tblite's GFN2-xTB
// numbers in ref2.json (total energy with the self-consistent D4, Mulliken charges, gradient), then a finite-difference
// self-check of the analytic gradient (the port's own energy, h = 1e-4 Å, x y z) on three 3-D geometries.
// Usage: node tools/xtb/check-gfn2.js [--time]
const path = require('path');
const { gfn2Energy } = require('./gfn2.js');
const geoms = [...require(path.join(__dirname, '../xtb-ref/geoms.json')), ...require(path.join(__dirname, '../xtb-ref/geoms2.json'))];
const refs = require(path.join(__dirname, '../xtb-ref/ref2.json'));
const TOL_E = 1e-4, TOL_Q = 1e-4, TOL_G = 1e-4;
let worstE = 0, worstQ = 0, worstG = 0, fails = 0;
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('geometry', 22), pad('|dE| eV', 11), pad('max|dq|', 11), pad('max|dg| eV/Å', 13), pad('iter', 5), 'ms (E+g)');
for (const g of geoms) {
  const r = refs.find(x => x.name === g.name);
  if (!r || r.error) { console.log(pad(g.name, 22), 'no reference', r && r.error || ''); fails++; continue; }
  const t0 = process.hrtime.bigint();
  const o = gfn2Energy(g.Z, g.xyz, g.charge || 0, g.uhf || 0, { grad: true, accuracy: 0.01 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const dE = Math.abs(o.E - r.E);
  let dq = 0, dg = 0;
  for (let i = 0; i < g.Z.length; i++) { dq = Math.max(dq, Math.abs(o.q[i] - r.q[i])); for (let c = 0; c < 3; c++) dg = Math.max(dg, Math.abs(o.g[i][c] - r.grad[i][c])); }
  const bad = !(dE < TOL_E && dq < TOL_Q && dg < TOL_G) || !o.converged;
  if (bad) fails++;
  worstE = Math.max(worstE, dE); worstQ = Math.max(worstQ, dq); worstG = Math.max(worstG, dg);
  console.log(pad(g.name, 22), pad(dE.toExponential(2), 11), pad(dq.toExponential(2), 11), pad(dg.toExponential(2), 13), pad(o.iterations, 5), ms.toFixed(1) + (o.converged ? '' : '  NOT CONVERGED') + (bad ? '  FAIL' : ''));
}
console.log(`\n${geoms.length} geometries: ${geoms.length - fails} pass, ${fails} fail; worst |dE| ${worstE.toExponential(2)} eV,` +
  ` worst max|dq| ${worstQ.toExponential(2)}, worst max|dg| ${worstG.toExponential(2)} eV/Å (tolerance ${TOL_E} eV, ${TOL_Q} e, ${TOL_G} eV/Å)`);
const TOL_FD = 2e-6;
const fdGeoms = ['H2SO2~', 'SO2~3', 'H3O+(H2O)~3', 'CH3Br~3'].map(n => geoms.find(x => x.name === n)).filter(Boolean);
fdGeoms.unshift({ name: 'H2SO2 (S d shells)', Z: [16, 8, 8, 1, 1], charge: 0, uhf: 0, xyz: [[0, 0, 0], [1.45, 0.1, 0], [-0.7, 1.25, 0.1], [0.2, -0.9, 1.1], [-0.3, -1.0, -1.05]] });
console.log('\nfinite-difference self-check (accuracy 1e-6, h = 1e-4 Å)');
let fdFails = 0;
for (const g of fdGeoms) {
  const opts = { accuracy: 1e-6 }, E = x => gfn2Energy(g.Z, x, g.charge || 0, g.uhf || 0, opts).E;
  const o = gfn2Energy(g.Z, g.xyz, g.charge || 0, g.uhf || 0, { ...opts, grad: true });
  const h = 1e-4; let d1 = 0;
  for (let i = 0; i < g.Z.length; i++) for (let c = 0; c < 3; c++) {
    const at = s => { const x = g.xyz.map(p => p.slice()); x[i][c] += s; return E(x); };
    d1 = Math.max(d1, Math.abs((at(h) - at(-h)) / (2 * h) - o.g[i][c]));
  }
  const bad = !(d1 < TOL_FD) || !o.converged; if (bad) fdFails++;
  console.log(pad(g.name, 22), d1.toExponential(2) + (bad ? '  FAIL' : ''));
}
console.log(`finite differences: ${fdGeoms.length - fdFails} pass, ${fdFails} fail (tolerance ${TOL_FD} eV/Å)`);
process.exitCode = fails || fdFails ? 1 : 0;
