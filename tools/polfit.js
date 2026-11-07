'use strict';
/* Polarizability by direction (1.27, src/pold.js): fits the bond polarizabilities PD_BOND [α∥, α⊥] (Å³) to measured
   molecules, with the game's own 3-D geometries (the library's molecules in the 3-D lab). A molecule's tensor in the game
   is exactly the sum over its bonds of α∥ ûû + α⊥(1 − ûû), so the fit is linear least squares.
     node tools/polfit.js          # the fit, its table (paste into PD_BOND), and each molecule against its reference
   Targets: static electronic polarizabilities (Å³). mean: ᾱ; ax: along the molecule's axis (linear molecules) or out of
   the ring's plane (benzene); 'src' says where each number is from. Bonds with only a mean to fit keep a fixed
   ratio α∥/α⊥ (RATIO). */
const { load } = require('../tests/load');
const REF = [
  { m: 'H2', mean: 0.79, d: 0.29, src: 'mean CRC; Δα 0.288 (Raman, OSTI 5555353)' },
  { m: 'N2', mean: 1.74, d: 0.69, src: 'mean Landolt-Börnstein; Δα 0.691 (Raman, OSTI 5555353)' },
  { m: 'O2', mean: 1.58, d: 1.08, src: 'mean; Δα 1.080 (Raman, OSTI 5555353)' },
  { m: 'CO', mean: 1.95, d: 0.53, src: 'mean; Δα 0.525 (Raman, OSTI 5555353)' },
  { m: 'CO2', mean: 2.63, d: 2.0, src: 'electronic mean 2.63 (static 2.91 has the bending vibration in it); Δα ~2.0 (Kerr effect; from memory)' },
  { m: 'H2O', mean: 1.47, src: 'Hohm 2013 / CRC; nearly isotropic (1.53/1.47/1.42, from memory)' },
  { m: 'CH4', mean: 2.60, src: 'MOPAC table (experimental)' },
  { m: 'C2H6', mean: 4.47, src: 'MOPAC table (experimental)' },
  { m: 'C2H4', mean: 4.25, src: 'MOPAC table (experimental)' },
  { m: 'C2H2', mean: 3.33, src: 'MOPAC table (experimental)' },
  { m: 'benzene', mean: 10.33, ax: 6.62, src: 'mean MOPAC table (experimental); out of plane 44.66 a.u. (CCSD, arXiv 2103.05063)' },
  { m: 'CH3Cl', mean: 4.53, src: 'MOPAC table (experimental)' },
  { m: 'HCl', mean: 2.63, src: 'tabulated (studyguides compilation of standard values)' },
  { m: 'HF', mean: 0.80, src: 'tabulated (studyguides compilation of standard values)' },
  { m: 'NH3', mean: 2.2, src: 'CRC ~2.1–2.26 (from memory)' },
  { m: 'CH3OH', mean: 3.29, src: 'CRC (from memory)' },
];
const RATIO = { '1-6:1': 1.36, '1-8:1': 1, default: 2 }; // (C–H Denbigh's 0.79/0.58; O–H isotropic, as water is; others 2 : 1)
const X = load('all', { seed: 1 }), W = X.W; X.PRESETS.d3empty.build(); X.world3d(40); W.gamma = 0; W.T = 0;
const mols = [];
for (const r of REF) {
  const at = X.addMolecule(r.m, 0, 0, 0, 0, 0);
  const bonds = new Set(); for (const p of at) for (const b of p.bonds) bonds.add(b);
  const list = [...bonds].map(b => { const k = X.pdBondKey(b.a, b.b, b); let dx = b.b.x - b.a.x, dy = b.b.y - b.a.y, dz = b.b.z - b.a.z; const l = Math.hypot(dx, dy, dz); return { k, u: [dx / l, dy / l, dz / l] }; });
  // the axis: a linear molecule's line, or the normal of a flat one
  let ax = null;
  if (r.d !== undefined || r.ax !== undefined) {
    const c = at.reduce((s, p) => [s[0] + p.x / at.length, s[1] + p.y / at.length, s[2] + p.z / at.length], [0, 0, 0]);
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const p of at) { const v = [p.x - c[0], p.y - c[1], p.z - c[2]]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += v[i] * v[j]; }
    const pow = (M, sh) => { let v = [0.3, 0.5, 0.8]; for (let it = 0; it < 500; it++) { const w = [0, 1, 2].map(i => sh * v[i] + M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]); const n = Math.hypot(...w); v = w.map(x => x / n); } return v; };
    const tr = M[0][0] + M[1][1] + M[2][2];
    ax = r.d !== undefined ? pow(M, 0) : pow(M.map((row, i) => row.map((x, j) => -x + (i === j ? 0 : 0))), tr); // (largest spread for a line; smallest for a plane: the normal)
  }
  mols.push({ r, at, list, ax });
  for (const p of at) p.dead = true;
}
// parameters: per bond type either [a∥, a⊥] free (a type in some molecule with an anisotropy to fit, and seen in at most
// that molecule plus others) or one mean with the ratio
const types = [...new Set(mols.flatMap(m => m.list.map(b => b.k)))];
const free = new Set(); for (const m of mols) if (m.r.d !== undefined || m.r.ax !== undefined) { const ks = new Set(m.list.map(b => b.k)); for (const k of ks) if (!RATIO[k]) free.add(k); }
const P = []; for (const k of types) { if (free.has(k)) P.push([k, 'par'], [k, 'perp']); else P.push([k, 'mean']); }
function contrib(m, pi) { // the molecule's [mean, axial] for unit parameter pi
  const [k, kind] = P[pi]; let tr = 0, axv = 0;
  for (const b of m.list) {
    if (b.k !== k) continue;
    let ap, ae; if (kind === 'par') { ap = 1; ae = 0; } else if (kind === 'perp') { ap = 0; ae = 1; } else { const q = RATIO[k] || RATIO.default; ap = 3 * q / (q + 2); ae = 3 / (q + 2); }
    tr += ap + 2 * ae;
    if (m.ax) { const c = b.u[0] * m.ax[0] + b.u[1] * m.ax[1] + b.u[2] * m.ax[2]; axv += ae + (ap - ae) * c * c; }
  }
  return [tr / 3, axv];
}
const rows = [], rhs = [], tag = [];
for (const m of mols) {
  rows.push(P.map((_, i) => contrib(m, i)[0])); rhs.push(m.r.mean); tag.push(m.r.m + ' mean');
  if (m.r.d !== undefined) { rows.push(P.map((_, i) => { const [mn, a] = contrib(m, i); const perp = (3 * mn - a) / 2; return a - perp; })); rhs.push(m.r.d); tag.push(m.r.m + ' Δα'); }
  if (m.r.ax !== undefined) { rows.push(P.map((_, i) => contrib(m, i)[1])); rhs.push(m.r.ax); tag.push(m.r.m + ' out of plane'); }
}
// least squares (normal equations; tiny Tikhonov so a type seen only through sums stays defined)
const n = P.length, A = Array.from({ length: n }, () => new Float64Array(n + 1));
for (let r = 0; r < rows.length; r++) for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i][j] += rows[r][i] * rows[r][j]; A[i][n] += rows[r][i] * rhs[r]; }
for (let i = 0; i < n; i++) A[i][i] += 1e-9;
for (let c = 0; c < n; c++) { let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r; [A[c], A[piv]] = [A[piv], A[c]]; for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; } }
const x = A.map((row, i) => row[n] / row[i]);
const table = {};
for (let i = 0; i < n; i++) { const [k, kind] = P[i]; table[k] = table[k] || [0, 0]; if (kind === 'par') table[k][0] = x[i]; else if (kind === 'perp') table[k][1] = x[i]; else { const q = RATIO[k] || RATIO.default; table[k] = [3 * x[i] * q / (q + 2), 3 * x[i] / (q + 2)]; } }
console.log('PD_BOND = {', Object.entries(table).map(([k, v]) => `'${k}': [${v[0].toFixed(3)}, ${v[1].toFixed(3)}]`).join(', '), '}');
console.log('\nfit against reference (Å³):');
for (let r = 0; r < rows.length; r++) { const f = rows[r].reduce((s, a, i) => s + a * x[i], 0); console.log(`  ${tag[r].padEnd(22)} ${f.toFixed(2).padStart(6)}  ref ${rhs[r].toFixed(2)}`); }
// the fallback (atomic polarizabilities) against the fit, for the single bonds
console.log('\nfallback (PD_F · atomic) against the fitted means:');
for (const [k, v] of Object.entries(table)) { const [zz] = k.split(':'), [za, zb] = zz.split('-').map(Number); const m = (v[0] + 2 * v[1]) / 3; console.log(`  ${k.padEnd(8)} fitted mean ${m.toFixed(3)}`); }
for (const m of mols) console.log('  src', m.r.m + ':', m.r.src);
module.exports = { table };
