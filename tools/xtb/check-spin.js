'use strict';
// Spin-polarized GFN1-xTB and GFN2-xTB (1.26): every geometry of tools/xtb-ref/geoms3.json through gfn1.js (+ d3.js)
// and gfn2.js with opts.spin, against tblite's numbers in ref3.json (its spin-polarization container, scale 1: total
// energy, Mulliken charges, gradient), then a finite-difference self-check of the analytic gradient (h = 1e-4 and 5e-5 Å, Richardson; x y z)
// with a fixed spin count and with the shared Fermi level the game uses (opts.spinFree).
// Usage: node tools/xtb/check-spin.js
const path = require('path');
const { gfn1Energy } = require('./gfn1.js'), { d3Disp } = require('./d3.js'), { gfn2Energy } = require('./gfn2.js');
const geoms = require(path.join(__dirname, '../xtb-ref/geoms3.json'));
let refs = []; try { refs = require(path.join(__dirname, '../xtb-ref/ref3.json')); } catch (e) { console.log('no ref3.json yet (the xTB references workflow writes it)'); }
const TOL_E = 1e-6, TOL_Q = 1e-6, TOL_G = 1e-5;
const run = (m, g, opts) => {
  const o = (m === 'GFN1-xTB' ? gfn1Energy : gfn2Energy)(g.Z, g.xyz, g.charge || 0, opts.spinFree ? 0 : g.uhf || 0, { spin: 1, accuracy: 0.01, grad: true, ...opts });
  if (m === 'GFN1-xTB') { const d = d3Disp(g.Z, g.xyz, { grad: true }); o.E += d.E; o.g = o.g.map((r, i) => r.map((v, c) => v + d.g[i][c])); }
  return o;
};
const pad = (s, n) => String(s).padEnd(n);
let fails = 0, worst = [0, 0, 0], n = 0;
for (const g of geoms) for (const m of ['GFN1-xTB', 'GFN2-xTB']) {
  const r = refs.find(x => x.name === g.name && x.method === m);
  if (!r || r.error) { if (refs.length) { console.log(pad(g.name, 12), m, 'no reference', r && r.error || ''); fails++; } continue; }
  const o = run(m, g, {});
  const dE = Math.abs(o.E - r.E); let dq = 0, dg = 0;
  for (let i = 0; i < g.Z.length; i++) { dq = Math.max(dq, Math.abs(o.q[i] - r.q[i])); for (let c = 0; c < 3; c++) dg = Math.max(dg, Math.abs(o.g[i][c] - r.grad[i][c])); }
  const bad = !(dE < TOL_E && dq < TOL_Q && dg < TOL_G) || !o.converged; if (bad) fails++; n++;
  worst = [Math.max(worst[0], dE), Math.max(worst[1], dq), Math.max(worst[2], dg)];
  console.log(pad(g.name, 12), pad(m, 9), 'dE', pad(dE.toExponential(1), 8), 'dq', pad(dq.toExponential(1), 8), 'dg', pad(dg.toExponential(1), 8), 'it', o.iterations, bad ? 'FAIL' : '');
}
if (n) console.log(`\n${n} calculations against tblite: ${fails} fail; worst |dE| ${worst[0].toExponential(2)} eV, max|dq| ${worst[1].toExponential(2)}, max|dg| ${worst[2].toExponential(2)} eV/Å`);
console.log('\nfinite differences (accuracy 1e-6, h = 1e-4 Å and 5e-5 Å, Richardson)');
let fdFails = 0;
for (const name of ['NH2', 'O3 t', 'HCO', 'SO t', 'N6 q']) for (const m of ['GFN1-xTB', 'GFN2-xTB']) for (const free of [false, true]) {
  const g = geoms.find(x => x.name === name), opts = { accuracy: 1e-6, spinFree: free };
  if (free) opts.m0 = run(m, g, { accuracy: 1e-6 }).msh;
  const o = run(m, g, opts), E = x => run(m, { ...g, xyz: x }, opts).E, h = 1e-4;
  let d = 0;
  for (let i = 0; i < g.Z.length; i++) for (let c = 0; c < 3; c++) {
    const at = s => { const x = g.xyz.map(p => p.slice()); x[i][c] += s; return E(x); };
    const d1 = (at(h) - at(-h)) / (2 * h), d2 = (at(h / 2) - at(-h / 2)) / h;   // (Richardson: N6's near-degenerate orbitals curve E sharply)
    d = Math.max(d, Math.abs((4 * d2 - d1) / 3 - o.g[i][c]));
  }
  const bad = !(d < 2e-6) || !o.converged; if (bad) fdFails++;
  console.log(pad(name, 12), pad(m, 9), free ? 'shared Fermi level' : 'fixed spin        ', d.toExponential(2), bad ? 'FAIL' : '');
}
process.exitCode = fails || fdFails ? 1 : 0;
