'use strict';
/* Prototype of a continuous bond-order chemistry (the "continuous bond orders" plan, step 1). Not used by the game.
   usage: node tools/bo-proto.js [molecule keys …]

   Every pair of atoms has a bond order n, a real number, worked out from where the atoms are rather than stored:
     - each atom has a valence V (capacity(): from its electrons, so ions change it), shared among its partners;
     - the order a pair can reach is N = min(V_a − (what a's other partners use), V_b − (b's), 3);
     - how much of that it has is how deep it sits in its Morse well: n = N · w(r), w = 1 inside the bond length,
       falling to 0 as the pair separates (w is the Morse attraction, −E/D);
     - the pair's energy is that of a bond of order n, −D(n), from the same tables the game uses (bondEnergy,
       bondLength, morseA), interpolated between whole orders (below 1: D₁·n^p, the length stretched as Pauling's
       r₁ − c·ln N); inside the bond length, the Morse wall of a bond of order N on top. For a fixed N it is the
       Morse curve of that bond; the valence the pair takes is the valence its partners give up.
   The orders are found self-consistently (each atom's partners share its valence), so benzene comes out at 1.5 per
   ring bond and CO₂ at 2 without being told. Plus a soft core repulsion between all pairs, and the game's VSEPR angle
   terms on partners with n > 0.5. Forces by numerical differentiation (small molecules only). */
const { load } = require('../tests/load.js');
const X = load('all', { seed: 1 });
const { W } = X;

const ITER = 40, MODEL = process.env.BO_MODEL || 'A', EPS = +(process.env.BO_EPS || 0.12);
const pairCache = new Map();
function pp(a, b) {
  const key = a.el.Z < b.el.Z ? a.el.Z * 128 + b.el.Z : b.el.Z * 128 + a.el.Z;
  let v = pairCache.get(key);
  if (!v) {
    const r = [1, 2, 3].map(o => X.bondLength(a.el, b.el, o)), D = [1, 2, 3].map(o => X.bondEnergy(a.el, b.el, o)), al = [1, 2, 3].map(o => X.morseA(a.el, b.el, o));
    const t = X.BONDS[X.bondKey(a.el, b.el)], measured2 = !!(t && t.l && t.l[1]);
    const c = Math.min(0.4, Math.max(0.2, (r[0] - r[1]) / Math.LN2));
    // model B: Pauling's constant, from the single and double bond lengths where both are measured, else from the
    // single bond's stiffness (the curvature of −D·n(r)^p at r₁ then matches the Morse curve's 2Dα²)
    const cB = measured2 ? Math.min(0.45, Math.max(0.2, (r[0] - r[1]) / Math.LN2)) : Math.sqrt(P_LOW / 2) / al[0];
    v = { r, D, al, c, cB, sig: 0.62 * r[0] };
    pairCache.set(key, v);
  }
  return v;
}
const lerp3 = (arr, N) => { const i = Math.min(1, Math.floor(N - 1)), f = N - 1 - i; return arr[i] + (arr[i + 1] - arr[i]) * Math.min(1, f); };
const N_MIN = +(process.env.BO_NMIN || 0.5), W_FAST = +(process.env.BO_WF || 1.5); // (w falls off W_FAST times faster than the Morse curve: an order is a near thing)
const P_LOW = +(process.env.BO_P || 1.1); // below a single bond, D₁·n^p (BEBO's exponent; p > 1 gives exchange reactions a barrier)
function Dof(P, n) { if (n <= 0) return 0; if (n < 1) return P.D[0] * Math.pow(n, P_LOW); return lerp3(P.D, n); }
function paramsAt(P, N) {
  if (N <= 1e-9) return [0, P.r[0] + 3, P.al[0]];
  if (N < 1) return [P.D[0] * Math.pow(N, P_LOW), P.r[0] - P.c * Math.log(Math.max(N, N_MIN)), P.al[0]]; // (stretched as Pauling's rule, to half a bond at most: a sliver of spare valence must not make a long bond between neighbours' neighbours)
  return [lerp3(P.D, N), lerp3(P.r, N), lerp3(P.al, N)];
}
const morse = (r, D, r0, al) => { const e = Math.exp(-al * (r - r0)); return D * ((1 - e) * (1 - e) - 1); };
const wOf = (r, r0, al) => { if (r <= r0) return 1; const e = Math.exp(-W_FAST * al * (r - r0)); return 2 * e - e * e; };

/* Model B (BEBO-like): the order follows the distance everywhere, Pauling's n = exp((r₁ − r)/c), tapered to nothing
   past r₁ + 0.9 … 1.3 Å, and is capped by the valence left (smoothly, over EPS of an order). */
function rawB(q) {
  const d = q.r - q.P.r[0]; let n = Math.exp(-d / q.P.cB);
  if (d > 0.9) n *= d >= 1.3 ? 0 : 0.5 * (1 + Math.cos(Math.PI * (d - 0.9) / 0.4));
  return n;
}
function capB(x, N) { if (N <= 0) return 0; const e = Math.min(EPS, N / 2); if (x <= N - e) return x; if (x >= N + e) return N; return N - (N + e - x) * (N + e - x) / (4 * e); }
/* The orders of every pair of a set of atoms at positions xy (Float64Array 2n). Returns { pairs, n, N } */
function orders(atoms, xy) {
  const na = atoms.length, pairs = [];
  for (let i = 0; i < na; i++) for (let j = i + 1; j < na; j++) {
    const dx = xy[2 * j] - xy[2 * i], dy = xy[2 * j + 1] - xy[2 * i + 1], r = Math.hypot(dx, dy);
    if (r < 3.2) pairs.push({ i, j, r, P: pp(atoms[i], atoms[j]), n: 0, N: 0 });
  }
  if (MODEL === 'B') { // over-coordination correction (as ReaxFF's f4/f5): an atom whose partners would add up to more than its
    // valence loses its weak partners first (a neighbour's neighbour, 1.5 Å off in a crowded 2-D molecule), not its bonds
    const sum = new Float64Array(na); for (const q of pairs) { q.raw = rawB(q); sum[q.i] += q.raw; sum[q.j] += q.raw; }
    const Vb = atoms.map(p => X.capacity(p)), K = 20;
    const f = (o, dl) => 1 / (1 + Math.exp(-K * (4 * o * o - dl) + 3));
    for (const q of pairs) q.raw *= f(q.raw, sum[q.i] - Vb[q.i]) * f(q.raw, sum[q.j] - Vb[q.j]);
  }
  const V = atoms.map(p => X.capacity(p)), VH = atoms.map(p => X.hyperCap(p)), S = new Float64Array(na); // (an expanded octet, as the game allows it, toward F, O, Cl …: en ≥ 3)
  const Vof = (i, j) => (atoms[j].el.en >= 3.0 ? VH[i] : V[i]);
  for (let it = 0; it < ITER; it++) {
    S.fill(0); for (const q of pairs) { S[q.i] += q.n; S[q.j] += q.n; }
    for (const q of pairs) {
      const Ai = Vof(q.i, q.j) - (S[q.i] - q.n), Aj = Vof(q.j, q.i) - (S[q.j] - q.n);
      q.N = Math.max(0, Math.min(Ai, Aj, 3));
      let nn;
      if (MODEL === 'B') nn = capB(q.raw, q.N);
      else { const [, r0, al] = paramsAt(q.P, q.N); nn = q.N * wOf(q.r, r0, al); }
      q.n = it === 0 ? nn : 0.5 * q.n + 0.5 * nn;
    }
  }
  return pairs;
}
function energy(atoms, xy, detail) {
  const pairs = orders(atoms, xy);
  let Eb = 0, Ec = 0, Ea = 0;
  for (const q of pairs) {
    const [D, r0, al] = paramsAt(q.P, q.N);
    // the bond's energy is that of its order, −D(n), n = N·w(r); inside its length, the Morse wall on top
    if (q.n > 0) Eb -= Dof(q.P, q.n);
    if (MODEL === 'B') { // the wall starts where the order reaches its cap
      if (q.N > 0) { const e = Math.min(EPS, q.N / 2), rw = q.P.r[0] - q.P.cB * Math.log(q.N + e); if (q.r < rw) { const f = 1 - Math.exp(-al * (q.r - rw)); Eb += D * f * f; } }
    } else if (D > 0 && q.r < r0) { const e = 1 - Math.exp(-al * (q.r - r0)); Eb += D * e * e; }
    const s = q.P.sig / q.r; Ec += 0.05 * Math.pow(s, 12);
  }
  // VSEPR angles on the partners each atom holds with n > 0.5
  const nb = atoms.map(() => []);
  for (const q of pairs) if (q.n > 0.5) { nb[q.i].push([q.j, q.n]); nb[q.j].push([q.i, q.n]); }
  for (let c = 0; c < atoms.length; c++) {
    const p = atoms[c], L = nb[c], n = L.length;
    if (n < 2 || n > 6 || !p.el || p.el.dblock) continue;
    let sum = 0; for (const [, o] of L) sum += o;
    const lp = Math.max(0, Math.round((p.val - sum) / 2)), per = X.periodOf(p.el.Z), allH = L.every(([k]) => atoms[k].Z === 1);
    const ang = L.map(([k]) => Math.atan2(xy[2 * k + 1] - xy[2 * c + 1], xy[2 * k] - xy[2 * c])).sort((u, v) => u - v);
    const gaps = []; for (let k = 0; k < n; k++) gaps.push(k === n - 1 ? ang[0] + 2 * Math.PI - ang[k] : ang[k + 1] - ang[k]);
    const tg = X.angleTargetsRaw(n, lp, per, allH).slice().sort((u, v) => u - v), gs = gaps.slice().sort((u, v) => u - v);
    for (let k = 0; k < n; k++) Ea += 0.5 * X.ANGLE_K * (gs[k] - tg[k]) ** 2;
  }
  const E = Eb + Ec + Ea;
  return detail ? { E, Eb, Ec, Ea, pairs } : E;
}
function grad(atoms, xy) {
  const g = new Float64Array(xy.length), h = 1e-5;
  for (let k = 0; k < xy.length; k++) { const v = xy[k]; xy[k] = v + h; const e1 = energy(atoms, xy); xy[k] = v - h; const e0 = energy(atoms, xy); xy[k] = v; g[k] = (e1 - e0) / (2 * h); }
  return g;
}
function relax(atoms, xy, steps = 3000) { // FIRE
  const v = new Float64Array(xy.length); let dt = 0.02, a = 0.1, np = 0; const m = atoms.map(p => p.m);
  for (let s = 0; s < steps; s++) {
    const g = grad(atoms, xy); let P = 0, fn = 0, vn = 0;
    for (let k = 0; k < xy.length; k++) { P -= g[k] * v[k]; fn += g[k] * g[k]; vn += v[k] * v[k]; }
    if (Math.sqrt(fn) < 1e-4) break;
    if (P > 0) { const f = Math.sqrt(vn / (fn || 1)); for (let k = 0; k < xy.length; k++) v[k] = (1 - a) * v[k] - a * g[k] * f; if (++np > 5) { dt = Math.min(dt * 1.1, 0.1); a *= 0.99; } }
    else { v.fill(0); dt *= 0.5; a = 0.1; np = 0; }
    for (let k = 0; k < xy.length; k++) { v[k] -= dt * g[k] / m[k >> 1]; xy[k] += dt * v[k]; }
  }
  return xy;
}
function buildMol(key) {
  const M = X.MOLECULE_LIB.find(m => m.k === key); if (!M) return null;
  X.clearWorld();
  const atoms = M.a.map(([sym, x, y, q]) => X.addAtom(sym, x, y, { charge: q || 0 }));
  for (const [i, j, o] of M.b) X.addBond(atoms[i], atoms[j], o); // (the game's own bonds: for the comparison only)
  for (const p of atoms) X.refresh(p);
  const classic = M.b.map(([i, j, o]) => ({ i, j, o, r: X.bondLength(atoms[i].el, atoms[j].el, o), D: X.bondEnergy(atoms[i].el, atoms[j].el, o) }));
  for (const bd of W.bonds.slice()) X.removeBond(bd);
  for (const p of atoms) X.refresh(p);
  const xy = new Float64Array(atoms.length * 2); atoms.forEach((p, k) => { xy[2 * k] = p.x; xy[2 * k + 1] = p.y; });
  return { M, atoms, xy, classic };
}
module.exports = { orders, energy, grad, relax, buildMol, X };

if (require.main === module) {
  const keys = process.argv.slice(2).length ? process.argv.slice(2) : ['H2', 'O2', 'N2', 'CO', 'H2O', 'NH3', 'CH4', 'C2H6', 'C2H4', 'C2H2', 'CO2', 'HCN', 'benzene', 'CH3OH', 'H2O2', 'SiH4', 'H2S', 'PCl3', 'SF6'];
  for (const key of keys) {
    const B = buildMol(key); if (!B) { console.log(key, 'not in the library'); continue; }
    relax(B.atoms, B.xy);
    const d = energy(B.atoms, B.xy, true);
    const sym = (k) => B.atoms[k].el.sym + (k + 1);
    const got = d.pairs.filter(q => q.n > 0.25).map(q => `${sym(q.i)}–${sym(q.j)} n ${q.n.toFixed(2)} ${q.r.toFixed(3)} Å`);
    const want = B.classic.map(c => `${sym(c.i)}–${sym(c.j)} ${c.o} ${c.r.toFixed(3)} Å`);
    const Dcl = B.classic.reduce((s, c) => s + c.D, 0);
    console.log(`\n${key}: atomization ${(-d.Eb).toFixed(2)} eV (classic bonds ${Dcl.toFixed(2)} eV), core ${d.Ec.toFixed(3)}, angles ${d.Ea.toFixed(3)}`);
    console.log('  bond orders: ' + got.join(', '));
    console.log('  classic:     ' + want.join(', '));
  }
}
