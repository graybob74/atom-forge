'use strict';
// Checks d3.js against s-dftd3's numbers in tools/xtb-ref/ref.json (Edisp in eV, gdisp in eV/Å), and the analytic
// gradient against central finite differences of the energy.  Usage: node tools/xtb/check-d3.js
const path = require('path');
const { d3Disp } = require('./d3.js');
const geoms = require(path.join(__dirname, '../xtb-ref/geoms.json'));
const refs = require(path.join(__dirname, '../xtb-ref/ref.json'));
const TOL = 1e-6;
const byName = new Map(refs.map(r => [r.name, r]));

// 1. Against the reference.
const rows = [];
let n = 0, missing = 0, t = 0;
for (const geo of geoms) {
  const ref = byName.get(geo.name);
  if (!ref || ref.Edisp === undefined) { missing++; continue; }
  const t0 = process.hrtime.bigint();
  const r = d3Disp(geo.Z, geo.xyz);
  t += Number(process.hrtime.bigint() - t0) / 1e6;
  let dg = 0;
  for (let i = 0; i < geo.Z.length; i++) for (let k = 0; k < 3; k++) dg = Math.max(dg, Math.abs(r.g[i][k] - ref.gdisp[i][k]));
  rows.push({ name: geo.name, nat: geo.Z.length, E: r.E, dE: Math.abs(r.E - ref.Edisp), dg });
  n++;
}
const show = (key, label) => {
  console.log('worst ' + label + ':');
  for (const w of [...rows].sort((a, b) => b[key] - a[key]).slice(0, 5))
    console.log('  ' + w.name.padEnd(16) + ' nat ' + String(w.nat).padStart(3) + '  Edisp ' + w.E.toExponential(6).padStart(14) + ' eV  ' + label + ' ' + w[key].toExponential(2));
};
show('dE', '|dE| (eV)');
show('dg', '|dg| (eV/A)');
const maxE = Math.max(...rows.map(r => r.dE)), maxG = Math.max(...rows.map(r => r.dg));

// 2. Finite-difference check of the analytic gradient (central differences, h = 1e-4 Å).
const h = 1e-4;
let maxFD = 0, fdWorst = '';
for (const geo of geoms) {
  const g = d3Disp(geo.Z, geo.xyz).g;
  for (let i = 0; i < geo.Z.length; i++) for (let k = 0; k < 3; k++) {
    const xp = geo.xyz.map(a => a.slice()), xm = geo.xyz.map(a => a.slice());
    xp[i][k] += h; xm[i][k] -= h;
    const fd = (d3Disp(geo.Z, xp, { grad: false }).E - d3Disp(geo.Z, xm, { grad: false }).E) / (2 * h);
    const d = Math.abs(fd - g[i][k]);
    if (d > maxFD) { maxFD = d; fdWorst = geo.name + ' atom ' + i + ' ' + 'xyz'[k]; }
  }
}

const okRef = maxE < TOL && maxG < TOL, okFD = maxFD < 1e-7;
console.log('\nsummary: ' + n + ' geometries compared' + (missing ? ', ' + missing + ' without reference' : '') +
  '; max |dE| ' + maxE.toExponential(2) + ' eV, max |dg| ' + maxG.toExponential(2) + ' eV/A (tolerance ' + TOL + ') -> ' + (okRef ? 'PASS' : 'FAIL'));
console.log('finite differences (h = ' + h + ' A): max |analytic - numeric| ' + maxFD.toExponential(2) + ' eV/A (' + fdWorst + ') -> ' + (okFD ? 'PASS' : 'FAIL'));
console.log('time: ' + t.toFixed(1) + ' ms for all ' + n + ' energy+gradient calls (first call included)');
process.exit(okRef && okFD && !missing ? 0 : 1);
