'use strict';
/* Fits the many-body metals' cross constants for O and H partners (1.26; src/bometal.js, MBX_FIT) and, with --alloys,
   the metal pairs' (MBA_FIT). node tools/mbfit.js [--write] [--only Cu,Al] [--alloys]
   Each reference compound is built as its crystal in a periodic 3-D box in the game itself (tests/load.js), unrelaxed, and
   its energy read with everything the game has there (metal–metal pairs, the partners' Lennard-Jones, the switches).
   Unknowns A, ξ, p (q = MBX_T·p); conditions at the measured geometry: no force on uniform scaling, the measured heat of
   formation (from the bulk metal at its cohesive energy and the game's O₂ / H₂), the measured bulk modulus (where none is
   known, p is kept at 9). Reference values (CRC Handbook / NBS tables for ΔHf°, Wyckoff for structures; bulk moduli from
   the literature as recalled: the web was not reachable from this session, so the values are standard ones from memory,
   worth a check against the books). --write puts the table into src/bometal.js between its markers. */
const fs = require('fs'), path = require('path');
const { load } = require('../tests/load');
const X = load('all', { seed: 1 });
const KJ = 96.485;
const s3 = Math.sqrt(3);
/* structures: lattice (orthorhombic box a, b, c), basis [element role 'M' | 'X', fx, fy, fz]; ortho supercells for the hexagonal ones */
const ST = {
  rocksalt: (a) => ({ L: [a, a, a], B: [...fccB('M', 0, 0, 0), ...fccB('X', 0.5, 0, 0)] }),
  fluorite: (a) => ({ L: [a, a, a], B: [...fccB('M', 0, 0, 0), ...tetB('X')] }),
  antifluorite: (a) => ({ L: [a, a, a], B: [...fccB('X', 0, 0, 0), ...tetB('M')] }),
  cuprite: (a) => ({ L: [a, a, a], B: [['X', 0, 0, 0], ['X', 0.5, 0.5, 0.5], ['M', 0.25, 0.25, 0.25], ['M', 0.75, 0.75, 0.25], ['M', 0.75, 0.25, 0.75], ['M', 0.25, 0.75, 0.75]] }),
  B2: (a) => ({ L: [a, a, a], B: [['M', 0, 0, 0], ['X', 0.5, 0.5, 0.5]] }), // (CsCl: NiAl, alloys below: M the first metal, X the second)
  L12: (a) => ({ L: [a, a, a], B: [['M', 0.5, 0.5, 0], ['M', 0.5, 0, 0.5], ['M', 0, 0.5, 0.5], ['X', 0, 0, 0]] }), // (Cu₃Au)
  L10: (a, c) => ({ L: [a / Math.SQRT2, a / Math.SQRT2, c], B: [['M', 0, 0, 0], ['X', 0.5, 0.5, 0.5]] }), // (CuAu: the primitive tetragonal cell)
  fccA: (a) => ({ L: [a, a, a], B: fccB('M', 0, 0, 0) }),
  rerevo3: (a) => ({ L: [a, a, a], B: [['M', 0, 0, 0], ['X', 0.5, 0, 0], ['X', 0, 0.5, 0], ['X', 0, 0, 0.5]] }), // (ReO₃ type: AlH₃ simplified, 6:2)
  rutile: (a, c, u) => ({ L: [a, a, c], B: [['M', 0, 0, 0], ['M', 0.5, 0.5, 0.5], ['X', u, u, 0], ['X', 1 - u, 1 - u, 0], ['X', 0.5 + u, 0.5 - u, 0.5], ['X', 0.5 - u, 0.5 + u, 0.5]] }),
  wurtzite: (a, c, u) => hexOrtho(a, c, [['M', 1 / 3, 2 / 3, 0], ['M', 2 / 3, 1 / 3, 0.5], ['X', 1 / 3, 2 / 3, u], ['X', 2 / 3, 1 / 3, 0.5 + u]]),
  corundum: (a, c, z, x) => { // R-3c, hexagonal axes: M 12c (0,0,z), X 18e (x,0,¼), with the R centring
    const B = [], cen = [[0, 0, 0], [2 / 3, 1 / 3, 1 / 3], [1 / 3, 2 / 3, 2 / 3]];
    for (const [cx, cy, cz] of cen) {
      for (const zz of [z, 0.5 - z, -z, 0.5 + z]) B.push(['M', cx, cy, cz + zz]);
      for (const [fx, fy, fz] of [[x, 0, 0.25], [0, x, 0.25], [-x, -x, 0.25], [-x, 0, 0.75], [0, -x, 0.75], [x, x, 0.75]]) B.push(['X', cx + fx, cy + fy, cz + fz]);
    }
    return hexOrtho(a, c, B);
  },
};
function fccB(r, ox, oy, oz) { return [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]].map(([x, y, z]) => [r, x + ox, y + oy, z + oz]); }
function tetB(r) { const B = []; for (const x of [0.25, 0.75]) for (const y of [0.25, 0.75]) for (const z of [0.25, 0.75]) B.push([r, x, y, z]); return B; }
/* a hexagonal cell (a, c; basis in hexagonal fractions) as an orthorhombic one a × a√3 × c with twice the atoms */
function hexOrtho(a, c, hb) {
  const B = [], seen = new Set();
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (const [r, fx, fy, fz] of hb) {
    const x = (fx + i) * a - (fy + j) * a / 2, y = (fy + j) * a * s3 / 2, z = fz * c;
    const u = ((x / a) % 1 + 1) % 1, v = ((y / (a * s3)) % 1 + 1) % 1, w = ((z / c) % 1 + 1) % 1;
    const key = [u, v, w].map(t => Math.round(t * 1e6) % 1000000).join(',');
    if (seen.has(key)) continue; seen.add(key); B.push([r, u, v, w]);
  }
  return { L: [a, a * s3, c], B };
}
/* reference compounds: [metal, partner, formula metals a, partners b, ΔHf° kJ/mol, bulk modulus GPa (0: not known), structure, params…] */
const OX = [
  ['Cu', 'O', 2, 1, -168.6, 112, 'cuprite', 4.2696],
  ['Ag', 'O', 2, 1, -31.1, 70, 'cuprite', 4.72],
  ['Al', 'O', 2, 3, -1675.7, 252, 'corundum', 4.759, 12.991, 0.3523, 0.3064],
  ['Cr', 'O', 2, 3, -1139.7, 238, 'corundum', 4.959, 13.594, 0.3475, 0.3060],
  ['Fe', 'O', 1, 1, -272.0, 180, 'rocksalt', 4.307],
  ['Co', 'O', 1, 1, -237.9, 180, 'rocksalt', 4.26],
  ['Ni', 'O', 1, 1, -239.7, 200, 'rocksalt', 4.177],
  ['Mn', 'O', 1, 1, -385.2, 150, 'rocksalt', 4.445],
  ['Mg', 'O', 1, 1, -601.6, 160, 'rocksalt', 4.212],
  ['Ca', 'O', 1, 1, -634.9, 112, 'rocksalt', 4.811],
  ['Sr', 'O', 1, 1, -592.0, 91, 'rocksalt', 5.16],
  ['Ba', 'O', 1, 1, -548.0, 69, 'rocksalt', 5.52],
  ['Li', 'O', 2, 1, -597.9, 82, 'antifluorite', 4.611],
  ['Na', 'O', 2, 1, -414.2, 60, 'antifluorite', 5.55],
  ['K', 'O', 2, 1, -361.5, 0, 'antifluorite', 6.436],
  ['Be', 'O', 1, 1, -609.4, 212, 'wurtzite', 2.698, 4.379, 0.378],
  ['Zn', 'O', 1, 1, -350.5, 143, 'wurtzite', 3.250, 5.207, 0.382],
  ['Ti', 'O', 1, 2, -944.0, 211, 'rutile', 4.594, 2.959, 0.305],
  ['Sn', 'O', 1, 2, -577.6, 205, 'rutile', 4.737, 3.186, 0.307],
  ['Zr', 'O', 1, 2, -1100.6, 0, 'fluorite', 5.09],
  ['Ce', 'O', 1, 2, -1088.7, 230, 'fluorite', 5.411],
  ['U', 'O', 1, 2, -1085.0, 207, 'fluorite', 5.470],
  ['Li', 'H', 1, 1, -90.5, 33, 'rocksalt', 4.083],
  ['Na', 'H', 1, 1, -56.3, 19, 'rocksalt', 4.88],
  ['K', 'H', 1, 1, -57.7, 16, 'rocksalt', 5.70],
  ['Mg', 'H', 1, 2, -75.3, 45, 'rutile', 4.517, 3.021, 0.304],
  ['Ti', 'H', 1, 2, -144.3, 0, 'fluorite', 4.454],
  ['Zr', 'H', 1, 2, -169.0, 0, 'fluorite', 4.78],
  ['Pd', 'H', 1, 1, -19.0, 0, 'rocksalt', 4.03],
  ['Cu', 'H', 1, 1, 27.5, 0, 'wurtzite', 2.893, 4.614, 0.375],
  ['Al', 'H', 1, 3, -46.0, 0, 'rerevo3', 3.44],
];
/* alloys (1.26): [metal a, metal b, atoms a, atoms b, ΔHf° kJ/mol of formula, 0, structure, lattice …]: the pair's own A and ξ
   (p, q the two metals' means, r₀ the compound's a–b distance) fitted to the heat of formation at the measured lattice */
const AL = [
  ['Ni', 'Al', 1, 1, -117.6, 0, 'B2', 2.887], // (NiAl: −58.8 kJ/mol of atoms)
  ['Ti', 'Ni', 1, 1, -68.0, 0, 'B2', 3.015], // (NiTi: −34)
  ['Fe', 'Al', 1, 1, -56.0, 0, 'B2', 2.909], // (FeAl: −28)
  ['Cu', 'Zn', 1, 1, -24.6, 0, 'B2', 2.95], // (β-brass: −12.3)
  ['Cu', 'Au', 3, 1, -28.4, 0, 'L12', 3.749], // (Cu₃Au: −7.1)
  ['Ti', 'Al', 1, 1, -75.2, 0, 'L10', 3.997 * Math.SQRT2 / Math.SQRT2, 4.062], // (TiAl: −37.6)
];
const ALCHECK = [
  ['Ni', 'Al', 3, 1, -165.2, 0, 'L12', 3.567, 'Ni₃Al (−41.3 kJ/mol of atoms)'],
  ['Cu', 'Au', 1, 1, -18.2, 0, 'L10', 3.96, 3.67, 'CuAu (−9.1 kJ/mol of atoms)'],
];
function fitAlloy(cmp) {
  const [Ma, Mb, na, nb, dH] = cmp, Za = X.SYM2Z[Ma], Zb = X.SYM2Z[Mb], key = Math.min(Za, Zb) * 128 + Math.max(Za, Zb);
  const pa = X.mbParam(Za), pb = X.mbParam(Zb), target = dH / KJ - na * pa.Ec - nb * pb.Ec;
  delete X.MBA_FIT[key]; X.MBO.pp.clear();
  const r0 = nearestMX(cmp), p = 0.5 * (pa.p + pb.p), q = 0.5 * (pa.q + pb.q), h = 0.003;
  const set = (A, xi) => { X.MBA_FIT[key] = [A, xi, p, q, r0]; X.MBO.pp.clear(); X.MB_RMAX = 0; };
  const EE = (A, xi) => { set(A, xi); const e0 = energy(cmp, 1), ep = energy(cmp, 1 + h).E, em = energy(cmp, 1 - h).E; return { E: e0.E, d1: (ep - em) / (2 * h) }; };
  const atXi = (xi) => { const a0 = EE(0, xi), a1 = EE(1, xi), A = -a0.d1 / (a1.d1 - a0.d1); return { A, xi, E: a0.E + A * (a1.E - a0.E) }; };
  let x0 = Math.log(Math.sqrt(pa.xi * pb.xi)), x1 = x0 + 0.1, f0 = atXi(Math.exp(x0)), f1 = atXi(Math.exp(x1));
  for (let it = 0; it < 30 && Math.abs(f1.E - target) > 1e-7; it++) { let x2 = x1 - (f1.E - target) * (x1 - x0) / (f1.E - f0.E); if (!isFinite(x2)) break; x2 = Math.max(x1 - 0.5, Math.min(x1 + 0.5, x2)); x0 = x1; f0 = f1; x1 = x2; f1 = atXi(Math.exp(x1)); }
  const v = [f1.A, f1.xi, p, q, r0]; set(v[0], v[1]);
  const chk = EE(v[0], v[1]);
  return { key, v, cmp, dHf: (chk.E + na * pa.Ec + nb * pb.Ec) * KJ, slope: chk.d1, mixA: 2 * Math.sqrt(pa.A * pb.A), mixXi: pa.xi * pb.xi };
}
/* checks only (not fitted): the same constants in another compound */
const CHECK = [
  ['Fe', 'O', 2, 3, -824.2, 0, 'corundum', 5.035, 13.747, 0.3553, 0.3059, 'Fe₂O₃ (hematite)'],
  ['Cu', 'O', 1, 1, -157.3, 0, 'rocksalt', 4.18, 'CuO (as rocksalt; real tenorite, Cu–O 1.95 Å)'],
];
function build(cmp, s = 1) {
  const [M, Xs, , , , , st, ...pr] = cmp;
  const g = ST[st](...pr.filter(v => typeof v === 'number'));
  const n = g.L.map(l => Math.max(1, Math.ceil(12.5 / l))); // (each side past twice the game's pair reach, 6 Å)
  const L = g.L.map((l, k) => l * n[k] * s);
  X.baseWorld(L[0], L[1], 1, 0); X.W.gamma = 0; X.world3d(L[2]); X.W.wall = 'wrap';
  let nm = 0;
  for (let i = 0; i < n[0]; i++) for (let j = 0; j < n[1]; j++) for (let k = 0; k < n[2]; k++) for (const [r, fx, fy, fz] of g.B) {
    const x = ((i + fx) / n[0] % 1) * L[0] - L[0] / 2, y = ((j + fy) / n[1] % 1) * L[1] - L[1] / 2, z = ((k + fz) / n[2] % 1) * L[2] - L[2] / 2;
    X.addAtom(r === 'M' ? M : Xs, x + 1e-9, y + 1e-9, { z: z + 1e-9 }); if (r === 'M') nm++;
  }
  return { nm, V: g.L[0] * g.L[1] * g.L[2] * n[0] * n[1] * n[2] * s * s * s };
}
const elOf = (s) => X.ELEMENTS[X.SYM2Z[s]];
function pe() { X.gridTouch(); X.vlInvalidate(); X.computeForces(); return X.totalEnergy().pe; }
function energy(cmp, s) { const b = build(cmp, s); return { E: pe() / (b.nm / cmp[2]), V: b.V / (b.nm / cmp[2]), nm: b.nm }; } // (per formula unit)
function nearestMX(cmp) { // the shortest metal–partner (or, for an alloy, a–b) distance in the built crystal
  build(cmp, 1); const P = X.W.parts.filter(p => !p.dead); let best = Infinity; const Zb = X.SYM2Z[cmp[1]];
  for (const a of P) if (a.Z !== Zb) for (const b of P) if (b.Z === Zb) { const [dx, dy, dz] = X.minImg(b.x - a.x, b.y - a.y, b.z - a.z); best = Math.min(best, Math.hypot(dx, dy, dz)); }
  return best;
}
function meanMX(cmp, r0) { // the mean metal–partner distance of the first shell (within 1.15 of the shortest)
  build(cmp, 1); const P = X.W.parts.filter(p => !p.dead); let s = 0, n = 0;
  for (const a of P) if (a.Z !== 1 && a.Z !== 8) for (const b of P) if (b.Z === 1 || b.Z === 8) { const [dx, dy, dz] = X.minImg(b.x - a.x, b.y - a.y, b.z - a.z), r = Math.hypot(dx, dy, dz); if (r < 1.15 * r0) { s += r; n++; } }
  return { r: s / n, z: n };
}
const X2 = { O: -X.bondEnergy(elOf('O'), elOf('O'), 2) / 2, H: -X.bondEnergy(elOf('H'), elOf('H'), 1) / 2 }; // (the game's O₂ and H₂, per atom)
/* a (111) slab of the metal (4 layers, periodic in x and y), the partner atom over its fcc hollow at the best height: its
   binding against the free atom (eV, negative bound) */
const ADS = { 'Cu-O': -4.8, 'Ag-O': -3.6, 'Ni-O': -5.5, 'Al-O': -7.4, 'Cu-H': -2.4, 'Pd-H': -2.9 }; // (checks: DFT values for the close-packed faces, from memory, ±0.3 eV)
function adsorb(M, Xs, scan) {
  const d = X.mbParam(X.SYM2Z[M]).r0, h = d * Math.sqrt(2 / 3), nx = 4, ny = 2, nl = 4, Lx = nx * d, Ly = ny * d * s3;
  X.baseWorld(Lx, Ly, 1, 0); X.W.gamma = 0; X.world3d(40); X.W.wall = 'wrap';
  const sh = [[0, 0], [d / 2, d * s3 / 6], [d, d * s3 / 3]];
  for (let l = 0; l < nl; l++) for (let i = 0; i < nx; i++) for (let j = 0; j < 2 * ny; j++) {
    const x = (i + 0.5 * (j & 1)) * d + sh[l % 3][0], y = j * d * s3 / 2 + sh[l % 3][1];
    X.addAtom(M, ((x % Lx) + Lx) % Lx - Lx / 2, ((y % Ly) + Ly) % Ly - Ly / 2, { z: l * h - (nl - 1) * h });
  }
  const E0 = pe(), [hx, hy] = sh[nl % 3], o = X.addAtom(Xs, hx - Lx / 2, hy - Ly / 2, { z: 1.5 });
  let best = Infinity, zb = 0;
  for (let z = scan ? -0.6 : 0; z < 3; z += 0.05) { o.z = z; const e = pe() - E0; if (e < best) { best = e; zb = z; } }
  for (let dz = 0.025; dz > 0.002; dz /= 2) for (const z of [zb - dz, zb + dz]) { o.z = z; const e = pe() - E0; if (e < best) { best = e; zb = z; } }
  return { E: best, z: zb };
}
function setFit(key, v) { X.MBX_FIT[key] = v; X.MBO.pp.clear(); X.MBO.xp.clear(); X.MB_RMAX = 0; }
function fitOne(cmp, tq, kq = 1) {
  const [M, Xs, a, b, dH, Bg] = cmp, Zm = X.SYM2Z[M], Zx = X.SYM2Z[Xs], key = Zm * 128 + Zx;
  const Ec = X.mbParam(Zm).Ec, target = (dH / KJ) + a * -Ec + b * X2[Xs];
  const r0 = nearestMX(cmp), sh = meanMX(cmp, r0), rm = sh.r; // (r₀ at the first shell's mean: corundum's two distances, 1.86 and 1.97 Å)
  const t = tq || X.MBX_T, h = 0.003;
  const EE = (A, xi, p) => { setFit(key, [A, xi * kq, xi / kq, p, t * p, rm]); const e0 = energy(cmp, 1), ep = energy(cmp, 1 + h).E, em = energy(cmp, 1 - h).E; return { E: e0.E, d1: (ep - em) / (2 * h), d2: (ep - 2 * e0.E + em) / (h * h), V: e0.V }; };
  // the energy is linear in A: for a given ξ and p, A from no force, then E and E'' follow
  const atXi = (xi, p) => { const r0_ = EE(0, xi, p), r1 = EE(1, xi, p), A = -r0_.d1 / (r1.d1 - r0_.d1); return { A, xi, E: r0_.E + A * (r1.E - r0_.E), d1: 0, d2: r0_.d2 + A * (r1.d2 - r0_.d2), V: r0_.V }; };
  // ξ for the energy, by the secant in log ξ (the energy falls as ξ grows)
  const solveAX = (p) => {
    let x0 = Math.log(2), x1 = Math.log(4), f0 = atXi(Math.exp(x0), p), f1 = atXi(Math.exp(x1), p);
    for (let it = 0; it < 30 && Math.abs(f1.E - target) > 1e-7; it++) {
      let x2 = x1 - (f1.E - target) * (x1 - x0) / (f1.E - f0.E);
      if (!isFinite(x2)) break;
      x2 = Math.max(x1 - 1, Math.min(x1 + 1, x2));
      x0 = x1; f0 = f1; x1 = x2; f1 = atXi(Math.exp(x1), p);
    }
    return { A: f1.A, xi: f1.xi, r: f1 };
  };
  let p = 9, best = solveAX(p);
  if (Bg > 0) { // p from the bulk modulus: E'' = 9·V·B (the secant in p, kept to 3–20)
    const want = 9 * best.r.V * Bg / 160.2177;
    let p0 = 9, g0 = best.r.d2 - want, p1 = 12, b1 = solveAX(p1), g1 = b1.r.d2 - want;
    for (let it = 0; it < 15 && Math.abs(g1) > 1e-4 * want; it++) {
      let p2 = p1 - g1 * (p1 - p0) / (g1 - g0);
      if (!isFinite(p2)) break;
      p2 = Math.max(3, Math.min(20, p2));
      if (p2 === p1) break;
      p0 = p1; g0 = g1; p1 = p2; b1 = solveAX(p1); g1 = b1.r.d2 - want;
    }
    p = p1; best = b1;
  }
  const v = [best.A, best.xi * kq, best.xi / kq, p, t * p, rm];
  setFit(key, v);
  const r = EE(best.A, best.xi, p); setFit(key, v);
  return { key, v, cmp, rm, z: sh.z, dHf: (r.E - (a * -Ec + b * X2[Xs])) * KJ, B: r.d2 / (9 * r.V) * 160.2177, slope: r.d1 / rm };
}
/* --write with --only (1.26): the table's other lines kept, the refitted ones replaced in place */
function mergeLines(table, lines, keys) {
  if (!only) return lines;
  const old = table.split('\n').slice(1, -1), byKey = new Map(keys.map((k, i) => [String(k), lines[i]]));
  return old.map(l => { const m = l.match(/^\s*(\d+):/); return m && byKey.has(m[1]) ? byKey.get(m[1]) : l; });
}
if (require.main !== module) module.exports = { X, OX, CHECK, AL, ALCHECK, ADS, build, energy, nearestMX, meanMX, setFit, fitOne, fitAlloy, adsorb, X2 };
const args = process.argv.slice(2), only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const out = [];
X.mbSet(1);
const doAl = args.includes('--alloys'), alOut = [];
if (require.main === module && doAl) for (const c of AL) {
  if (only && !only.includes(c[0] + c[1])) continue;
  const f = fitAlloy(c); alOut.push(f);
  console.log(`${c[0]}–${c[1]} ${c[6]}: A ${f.v[0].toFixed(4)} (mixed ${f.mixA.toFixed(4)}) ξ ${f.v[1].toFixed(4)} (mixed ${f.mixXi.toFixed(4)}) p ${f.v[2].toFixed(3)} q ${f.v[3].toFixed(3)} r0 ${f.v[4].toFixed(4)} | ΔHf ${f.dHf.toFixed(2)} (${c[4]}) slope ${f.slope.toExponential(1)}`);
}
if (require.main === module && !doAl) for (const c of OX) {
  if (only && !only.includes(c[0])) continue;
  const t0 = Date.now(), ref = ADS[c[0] + '-' + c[1]];
  let f = fitOne(c), ad = adsorb(c[0], c[1]), k = 1;
  if (ref !== undefined && args.includes('--kappa')) { // (tried: κ, the metal's ξ over the partner's, for the binding on the surface; kept to 0.25–4 it ran to the ends for Cu (4) and Al (0.25) and changed Cu's binding by 0.02 eV: not used, κ = 1)
    let x0 = 0, g0 = ad.E - ref, x1 = Math.log(1.5), f1 = fitOne(c, 0, Math.exp(x1)), a1 = adsorb(c[0], c[1]), g1 = a1.E - ref;
    for (let it = 0; it < 12 && Math.abs(g1) > 0.01; it++) {
      let x2 = x1 - g1 * (x1 - x0) / (g1 - g0); if (!isFinite(x2)) break;
      x2 = Math.max(Math.log(0.25), Math.min(Math.log(4), x2)); if (x2 === x1) break;
      x0 = x1; g0 = g1; x1 = x2; f1 = fitOne(c, 0, Math.exp(x1)); a1 = adsorb(c[0], c[1]); g1 = a1.E - ref;
    }
    f = f1; ad = a1; k = Math.exp(x1);
  }
  f.ads = ad; f.k = k; out.push(f);
  console.log(`${c[0]}–${c[1]} ${c[6]}: A ${f.v[0].toFixed(4)} ξm ${f.v[1].toFixed(4)} ξx ${f.v[2].toFixed(4)} p ${f.v[3].toFixed(3)} q ${f.v[4].toFixed(3)} r0 ${f.v[5].toFixed(4)} | ΔHf ${f.dHf.toFixed(1)} (${c[4]}) B ${f.B.toFixed(0)} (${c[5] || '—'}) slope ${f.slope.toExponential(1)} | on (111) ${ad.E.toFixed(2)} eV at ${ad.z.toFixed(2)} Å (${ref === undefined ? '—' : ref}) κ ${k.toFixed(3)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
if (require.main === module) for (const c of CHECK) {
  const Zm = X.SYM2Z[c[0]], Ec = X.mbParam(Zm).Ec;
  if (only && !only.includes(c[0])) continue;
  let best = Infinity, sb = 1; for (let s = 0.9; s <= 1.12; s += 0.005) { const e = energy(c, s).E; if (e < best) { best = e; sb = s; } }
  console.log(`check ${c[c.length - 1]}: ΔHf ${((best - (c[2] * -Ec + c[3] * X2[c[1]])) * KJ).toFixed(1)} kJ/mol (measured ${c[4]}), lattice ×${sb.toFixed(3)} of measured`);
}
if (require.main === module && doAl) for (const c of ALCHECK) {
  const pa = X.mbParam(X.SYM2Z[c[0]]), pb = X.mbParam(X.SYM2Z[c[1]]);
  let best = Infinity, sb = 1; for (let s = 0.94; s <= 1.06; s += 0.002) { const e = energy(c, s).E; if (e < best) { best = e; sb = s; } }
  console.log(`check ${c[c.length - 1]}: ΔHf ${((best + c[2] * pa.Ec + c[3] * pb.Ec) * KJ).toFixed(1)} kJ/mol of formula (measured ${c[4]}), lattice ×${sb.toFixed(3)}`);
}
if (args.includes('--write') && doAl) {
  const f = path.join(__dirname, '..', 'src', 'bometal.js');
  let s = fs.readFileSync(f, 'utf8');
  const lines = alOut.map(o => `  ${o.key}: [${o.v.map(x => +x.toPrecision(6)).join(', ')}], // ${o.cmp[0]}–${o.cmp[1]}: ${o.cmp[2] > 1 ? o.cmp[0] + o.cmp[2] + o.cmp[1] : o.cmp[0] + o.cmp[1]} (${o.cmp[6]}), ΔHf ${o.cmp[4]} kJ/mol`);
  s = s.replace(/const MBA_FIT = \{[^]*?\n\};|const MBA_FIT = \{\};/, (m) => 'const MBA_FIT = {\n' + mergeLines(m, lines, alOut.map(o => o.key)).join('\n') + '\n};');
  fs.writeFileSync(f, s); console.log('written', alOut.length);
} else if (args.includes('--write')) {
  const f = path.join(__dirname, '..', 'src', 'bometal.js');
  let s = fs.readFileSync(f, 'utf8');
  const lines = out.map(o => `  ${o.key}: [${o.v.map(x => +x.toPrecision(6)).join(', ')}], // ${o.cmp[0]}–${o.cmp[1]}: ${o.cmp[6]}, ΔHf ${o.cmp[4]} kJ/mol, B ${o.cmp[5] || '—'} GPa, r₀ ${o.rm.toFixed(3)} Å${ADS[o.cmp[0] + '-' + o.cmp[1]] !== undefined ? ', on (111) ' + ADS[o.cmp[0] + '-' + o.cmp[1]] + ' eV' : ''}`);
  s = s.replace(/const MBX_FIT = \{[^]*?\n\};|const MBX_FIT = \{\};/, (m) => 'const MBX_FIT = {\n' + mergeLines(m, lines, out.map(o => o.key)).join('\n') + '\n};');
  fs.writeFileSync(f, s);
  console.log('written', out.length);
}
