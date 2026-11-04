// The geometries for the GFN1-xTB references: the game's molecules (flat, as the game has them, z = 0) and each
// distorted a little (seeded), a few 3-D ones, an ion pair and H + H₂; node tools/xtb-ref/mkgeoms.js > tools/xtb-ref/geoms.json
const { load } = require('../../tests/load.js');
const X = load('all', { seed: 1 });
let s = 12345; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
const out = [];
const keys = ['H2', 'H2O', 'NH3', 'CH4', 'HF', 'C2H6', 'C2H4', 'C2H2', 'N2', 'CO2', 'HCN', 'CH2O', 'CH3OH', 'benzene', 'H3Op', 'OHm', 'NH4p', 'H2O2', 'O2', 'CO', 'F2', 'formicacid', 'glycine', 'urea', 'pyridine'];
for (const k of keys) {
  const m = X.MOLECULES[k]; if (!m) continue;
  const Z = m.atoms.map(a => X.ELEMENTS.findIndex(e => e && e.sym === a[0])), q = m.atoms.reduce((t, a) => t + (a[3] || 0), 0);
  if (Z.some(z => z > 18)) continue;
  const ne = Z.reduce((t, z) => t + z, 0) - q, uhf = (k === 'O2') ? 2 : ne % 2;
  const xyz = m.atoms.map(a => [a[1], a[2], 0]);
  out.push({ name: k, Z, xyz, charge: q, uhf });
  out.push({ name: k + '~', Z, xyz: xyz.map(([x, y]) => [x + 0.08 * rnd(), y + 0.08 * rnd(), 0]), charge: q, uhf });
}
out.push({ name: 'H2O-3d', Z: [8, 1, 1], xyz: [[0, 0, 0], [0, 0.757, 0.587], [0, -0.757, 0.587]], charge: 0, uhf: 0 });
out.push({ name: 'CH4-3d', Z: [6, 1, 1, 1, 1], xyz: [[0, 0, 0], [0.629, 0.629, 0.629], [-0.629, -0.629, 0.629], [-0.629, 0.629, -0.629], [0.629, -0.629, -0.629]], charge: 0, uhf: 0 });
for (const R of [2.4, 2.5, 2.6, 2.7]) for (const x of [0.97, 1.05, 1.15, R / 2]) // (a proton between two waters, flat)
  out.push({ name: `H5O2+ R${R} x${x.toFixed(3)}`, Z: [8, 1, 1, 1, 8, 1, 1], xyz: [[0, 0, 0], [-0.4, 0.88, 0], [-0.4, -0.88, 0], [x, 0, 0], [R, 0, 0], [R + 0.4, 0.88, 0], [R + 0.4, -0.88, 0]], charge: 1, uhf: 0 });
for (const d of [0.8, 0.93, 1.1]) out.push({ name: `H3 ${d}`, Z: [1, 1, 1], xyz: [[-d, 0, 0], [0, 0, 0], [d, 0, 0]], charge: 0, uhf: 1 });
out.push({ name: 'H', Z: [1], xyz: [[0, 0, 0]], charge: 0, uhf: 1 });
console.log(JSON.stringify(out));
