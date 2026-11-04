'use strict';
// Runs every geometry of tools/xtb-ref/geoms.json through gfn1.js and compares with tblite's numbers in ref.json:
// |dE| against E - Edisp (gfn1.js has no D3 dispersion) and the largest Mulliken charge difference.
// Usage: node tools/xtb/check.js [--time]
const path = require('path');
const { gfn1Energy } = require('./gfn1.js');
const geoms = require(path.join(__dirname, '../xtb-ref/geoms.json'));
const refs = require(path.join(__dirname, '../xtb-ref/ref.json'));

const TOL_E = 1e-4, TOL_Q = 1e-4;
let worstE = 0, worstQ = 0, fails = 0;
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('geometry', 22), pad('|dE| eV', 11), pad('max|dq|', 11), pad('iter', 5), 'ms');
for (let k = 0; k < geoms.length; k++) {
  const g = geoms[k], r = refs.find(x => x.name === g.name);
  if (!r || r.error) { console.log(pad(g.name, 22), 'no reference', r && r.error || ''); fails++; continue; }
  const t0 = process.hrtime.bigint();
  const o = gfn1Energy(g.Z, g.xyz, g.charge || 0, g.uhf || 0);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const dE = Math.abs(o.E - (r.E - r.Edisp));
  let dq = 0;
  for (let i = 0; i < g.Z.length; i++) dq = Math.max(dq, Math.abs(o.q[i] - r.q[i]));
  const bad = !(dE < TOL_E && dq < TOL_Q) || !o.converged;
  if (bad) fails++;
  worstE = Math.max(worstE, dE); worstQ = Math.max(worstQ, dq);
  console.log(pad(g.name, 22), pad(dE.toExponential(2), 11), pad(dq.toExponential(2), 11), pad(o.iterations, 5),
    ms.toFixed(1) + (o.converged ? '' : '  NOT CONVERGED') + (bad ? '  FAIL' : ''));
}
console.log(`\n${geoms.length} geometries: ${geoms.length - fails} pass, ${fails} fail; worst |dE| ${worstE.toExponential(2)} eV,` +
  ` worst max|dq| ${worstQ.toExponential(2)} (tolerance ${TOL_E} eV, ${TOL_Q} e)`);

if (process.argv.includes('--time')) {
  // steady-state timing (after warm-up) for two sizes
  for (const name of ['benzene', 'H5O2+ R2.5 x1.050']) {
    const g = geoms.find(x => x.name === name);
    for (let i = 0; i < 20; i++) gfn1Energy(g.Z, g.xyz, g.charge, g.uhf);
    const n = 200, t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) gfn1Energy(g.Z, g.xyz, g.charge, g.uhf);
    console.log(`timing ${name}: ${(Number(process.hrtime.bigint() - t0) / 1e6 / n).toFixed(2)} ms per energy`);
  }
}
process.exitCode = fails ? 1 : 0;
