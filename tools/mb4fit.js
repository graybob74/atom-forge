'use strict';
/* Fits the close-packed metals' band-shape constant C (1.27, feature 20; src/bometal.js MB4_C, mb4Pass):
   node tools/mb4fit.js [Cu Al …] [--write]
   For each metal with reference data (tools/mbdfit.js D_CP: SGTE lattice stabilities and DFT as recalled, ±0.05 eV and
   more), C is solved so that the relaxed bcc crystal lies its measured ΔE above the close-packed one (fcc, or ideal hcp,
   1.25's reference: the term leaves both exactly as they were), in the game itself (tests/load.js; periodic 3-D crystals,
   E₄ is linear in C, so each volume is measured once). Also reported: the Bain path (body-centred tetragonal, c/a 1 → √2,
   each relaxed in volume) and the simple cube above the close-packed crystal, and the 1.25 copper liquid's rise
   (tools/mbliquid.json at the metal's spacing): what C costs the melting. --write puts the table into bometal.js. */
const fs = require('fs'), path = require('path');
const { load } = require('../tests/load');
const X = load('all', { seed: 1 }); X.mbSet(1);
const D_CP = (() => { const src = fs.readFileSync(path.join(__dirname, 'mbdfit.js'), 'utf8'); const m = src.match(/const D_CP = \{[\s\S]*?\n\};/); return eval('(' + m[0].replace(/^const D_CP = /, '').replace(/;$/, '') + ')'); })();
function crystal(Z, cell, basis, n) { // (energy per atom and E₄ per atom at C = 1, Z's C set to 1 for the measurement)
  const L = cell.map(v => v * n);
  X.baseWorld(L[0], L[1], 1, 0); X.W.gamma = 0; X.world3d(L[2]); X.W.wall = 'wrap';
  const sym = X.ELEMENTS[Z].sym;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let l = 0; l < n; l++) for (const b of basis) X.addAtom(sym, (i + b[0] + 0.25) * cell[0] - L[0] / 2, (j + b[1] + 0.25) * cell[1] - L[1] / 2, { z: (l + b[2] + 0.25) * cell[2] - L[2] / 2 });
  X.gridTouch(); X.vlInvalidate();
  const N = X.W.parts.filter(p => !p.dead).length, pe = X.totalEnergy().pe;
  return [(pe - X.MBO.e4) / N, X.MBO.e4 / N];
}
const BCT = (V, ca) => { const a = Math.cbrt(2 * V / ca); return [[a, a, ca * a], [[0, 0, 0], [0.5, 0.5, 0.5]]]; };
const SC = (V) => { const a = Math.cbrt(V); return [[a, a, a], [[0, 0, 0]]]; };
const VS = []; for (let k = -8; k <= 8; k++) VS.push(1 + 0.01 * k);
function scan(Z, mk, n) { const C0 = X.MB4_C[Z]; X.MB4_C[Z] = 1; const r0 = X.mbParam(Z).r0, vat = r0 ** 3 / Math.SQRT2; const out = VS.map(v => { const [cell, basis] = mk(v * vat); return crystal(Z, cell, basis, n); }); if (C0 === undefined) delete X.MB4_C[Z]; else X.MB4_C[Z] = C0; return out; }
const at = (S, C) => { // (the minimum over volume of E₀ + C·G: the grid's best point refined by a parabola)
  let k = 0, best = Infinity; S.forEach(([e, g], i) => { const v = e + C * g; if (v < best) { best = v; k = i; } });
  if (k === 0 || k === S.length - 1) return best;
  const [a, b, c] = [S[k - 1], S[k], S[k + 1]].map(([e, g]) => e + C * g), den = a - 2 * b + c;
  return den > 0 ? b - (a - c) * (a - c) / (8 * den) : best;
};
function liquid(Z, C) {
  const L = JSON.parse(fs.readFileSync(path.join(__dirname, 'mbliquid.json'), 'utf8')), r0 = X.mbParam(Z).r0, sym = X.ELEMENTS[Z].sym, C0 = X.MB4_C[Z];
  let e = 0, e4 = 0, n = 0;
  X.MB4_C[Z] = C;
  for (const sn of L.snaps) {
    const Lb = L.L * r0; X.baseWorld(Lb, Lb, 1, 0); X.W.gamma = 0; X.world3d(Lb); X.W.wall = 'wrap';
    for (const p of sn) X.addAtom(sym, p[0] * r0, p[1] * r0, { z: p[2] * r0 });
    X.gridTouch(); X.vlInvalidate(); e += X.totalEnergy().pe; e4 += X.MBO.e4; n += sn.length;
  }
  if (C0 === undefined) delete X.MB4_C[Z]; else X.MB4_C[Z] = C0;
  return [e / n, e4 / n];
}
function fit(sym) {
  const d = D_CP[sym], Z = d[0], Ec = d[3], target = d[9];
  const B = scan(Z, (V) => BCT(V, 1), 6);
  let lo = 0, hi = 20; const f = (C) => at(B, C) + Ec - target;
  if (f(0) >= 0) hi = 0; else for (let it = 0; it < 60; it++) { const m = 0.5 * (lo + hi); if (f(m) > 0) hi = m; else lo = m; }
  const C = +(0.5 * (lo + hi)).toFixed(4);
  const bain = [1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35].map(ca => +(at(scan(Z, (V) => BCT(V, ca), 6), C) + Ec).toFixed(3));
  const sc = +(at(scan(Z, SC, 7), C) + Ec).toFixed(3), b125 = +(at(B, 0) + Ec).toFixed(3);
  const [l0] = liquid(Z, 0), [l1, l4] = liquid(Z, C);
  return { sym, Z, C, bcc125: b125, bcc: +(at(B, C) + Ec).toFixed(4), target, bainMin: Math.min(...bain), bain, sc, liq125: +(l0 + Ec).toFixed(4), liq: +(l1 + Ec).toFixed(4), liqRise: +(l1 - l0).toFixed(4) };
}
const args = process.argv.slice(2), els = args.filter(a => !a.startsWith('--'));
const list = els.length ? els : Object.keys(D_CP);
const rows = [];
for (const s of list) { const r = fit(s); rows.push(r); console.log(JSON.stringify(r)); }
if (args.includes('--write')) {
  const p = path.join(__dirname, '..', 'src', 'bometal.js'); let src = fs.readFileSync(p, 'utf8');
  const m = src.match(/const MB4_C = \{[^\n]*\};/); if (!m) throw new Error('MB4_C not found');
  const old = eval('(' + m[0].replace(/^const MB4_C = /, '').replace(/;.*$/, '') + ')');
  for (const r of rows) old[r.Z] = r.C;
  const body = Object.keys(old).map(Number).sort((a, b) => a - b).map(z => `${z}: ${old[z]}`).join(', ');
  src = src.replace(m[0], `const MB4_C = { ${body} }; // (C by Z, eV: node tools/mb4fit.js --write; each metal's bcc its measured ΔE above its close-packed crystal, relaxed)`);
  fs.writeFileSync(p, src); console.log('written', rows.length);
}
