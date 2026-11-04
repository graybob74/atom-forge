'use strict';
/* Prototype of quantum chemistry for bonds (the planned list's "Quantum chemistry for bonds", step 1; findings in PERF-NOTES). Not used by the game.
   usage: node tools/tb-proto.js [molecule keys …]      (TB_SCC=0 turns the charge self-consistency off)

   A self-consistent tight-binding model (the DFTB2 form) in the game's flat world:
     - a minimal valence basis: H 1s; B, C, N, O, F 2s 2px 2py 2pz (pz stands out of the plane: the π system);
     - on-site energies: Harrison's atomic term values; hoppings between atoms by Slater–Koster from Harrison's universal
       two-centre values η·ħ²/(m·d²) (ssσ, spσ, ppσ, ppπ), faded out between 1.4 and 1.8 single-bond lengths;
     - the bands filled with the molecule's electrons (Fermi smearing, kT 0.05 eV, so radicals and stretched bonds are
       smooth); Mulliken charges, and the charges' own energy U·Δq²/2 and Klopman–Ohno γ between atoms, made self-
       consistent (DFTB2, second order);
     - a repulsive pair term A·(r₀/r)⁴ for each element pair, A fitted so that a reference molecule's bonds of that pair
       sit at the game's bond length (bondLength).
   Energies relative to free atoms (each atom's own levels filled with its electrons, the same model); forces by central
   differences (small molecules only). It reports, per molecule: the relaxed bond lengths against the game's tables, the
   atomization energy against the sum of the game's bond energies, Mulliken charges; then the H + H₂ exchange barrier. */
const { load } = require('../tests/load.js');
const X = load('all', { seed: 1 });
const { W } = X;

const SCC = process.env.TB_SCC !== '0', KT = 0.05, HB = 7.62; // eV; ħ²/m in eV·Å²
const ETA = { sss: -1.40, sps: 1.84, pps: 3.24, ppp: -0.81 }; // Harrison (Froyen–Harrison) universal values
const ONSITE = process.env.TB_HARRISON ? { 1: [-13.61], 5: [-10.59, -5.71], 6: [-19.38, -11.07], 7: [-26.22, -13.84], 8: [-34.02, -16.77], 9: [-42.79, -19.87] }
  : { 1: [-6.49], 5: [-9.5, -3.7], 6: [-13.74, -5.43], 7: [-18.55, -7.24], 8: [-23.9, -9.04], 9: [-30.0, -11.3] }; // (atomic DFT (PBE) levels, as DFTB's, which put C above H in electronegativity; TB_HARRISON=1: Harrison's term values)
const HUB = { 1: 11.42, 5: 8.3, 6: 9.92, 7: 11.73, 8: 13.48, 9: 15.0 }; // (DFTB's Hubbard values) // eV: the charges' self-energy U (about IE − EA)
const VAL = { 1: 1, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7 };
const norb = (Z) => (Z === 1 ? 1 : 4);
const r1 = (za, zb) => X.bondLength(X.ELEMENTS[za], X.ELEMENTS[zb], 1);
const fade = (r, r0) => { const a = 1.4 * r0, b = 1.8 * r0; if (r <= a) return [1, 0]; if (r >= b) return [0, 0]; const t = (r - a) / (b - a); return [1 - t * t * (3 - 2 * t), -6 * t * (1 - t) / (b - a)]; };
const REP = new Map(); // (element pair → { s, A, c }: the hoppings' scale, the repulsion's size and decay)
const BDEC = 2.0; // Å⁻¹: the hoppings' decay past the bond length (V ∝ e^(−BDEC·(d − r₀)), Harrison's 1/d² at r₀)
const pkey = (a, b) => (a < b ? a * 128 + b : b * 128 + a);

/* symmetric eigenproblem: cyclic Jacobi (n ≤ ~100) */
function eigh(A, n) {
  const a = Float64Array.from(A), V = new Float64Array(n * n); for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0; for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q] * a[p * n + q];
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      const apq = a[p * n + q]; if (Math.abs(apq) < 1e-15) continue;
      const th = (a[q * n + q] - a[p * n + p]) / (2 * apq), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = a[k * n + p], akq = a[k * n + q]; a[k * n + p] = c * akp - s * akq; a[k * n + q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = a[p * n + k], aqk = a[q * n + k]; a[p * n + k] = c * apk - s * aqk; a[q * n + k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = V[k * n + p], vkq = V[k * n + q]; V[k * n + p] = c * vkp - s * vkq; V[k * n + q] = s * vkp + c * vkq; }
    }
  }
  const e = []; for (let i = 0; i < n; i++) e.push(a[i * n + i]);
  return { e, V };
}
/* Fermi occupations for N electrons (2 per level), and the electronic free energy's entropy term */
function fill(e, N) {
  let lo = Math.min(...e) - 10, hi = Math.max(...e) + 10;
  const occ = (mu) => e.map(x => 2 / (1 + Math.exp(Math.min(500, (x - mu) / KT))));
  for (let it = 0; it < 200; it++) { const mu = 0.5 * (lo + hi), s = occ(mu).reduce((u, v) => u + v, 0); if (s > N) hi = mu; else lo = mu; }
  const f = occ(0.5 * (lo + hi)); let TS = 0;
  for (const fi of f) { const p = fi / 2; if (p > 1e-12 && p < 1 - 1e-12) TS += -2 * KT * (p * Math.log(p) + (1 - p) * Math.log(1 - p)); }
  return { f, TS };
}
/* The energy of atoms [{Z, x, y}] with net charge Q */
function energy(atoms, Q = 0, info) {
  const n = atoms.length, off = []; let N = 0, M = 0;
  for (const a of atoms) { off.push(M); M += norb(a.Z); N += VAL[a.Z]; }
  N -= Q;
  const H0 = new Float64Array(M * M);
  for (let i = 0; i < n; i++) { const a = atoms[i], o = off[i], on = ONSITE[a.Z]; H0[o * M + o] = on[0]; for (let k = 1; k < norb(a.Z); k++) H0[(o + k) * M + o + k] = on[1]; }
  let Erep = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = atoms[i], b = atoms[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), r0 = r1(a.Z, b.Z), [fc] = fade(d, r0);
    if (fc <= 0) continue;
    const P = REP.get(pkey(a.Z, b.Z)) || { s: 1, A: 0, c: 3 }; Erep += P.A * Math.exp(-P.c * (d - r0)) * fc;
    const l = dx / d, m = dy / d, v = (eta) => eta * P.s * HB / (r0 * r0) * Math.exp(-BDEC * (d - r0)) * fc;
    const Vss = v(ETA.sss), Vsp = v(ETA.sps), Vps = v(ETA.pps), Vpp = v(ETA.ppp);
    // Slater–Koster blocks, direction a → b (l, m, n = 0)
    const oa = off[i], ob = off[j], na = norb(a.Z), nb = norb(b.Z);
    const set = (p, q, val) => { H0[p * M + q] = val; H0[q * M + p] = val; };
    set(oa, ob, Vss);
    if (nb === 4) { set(oa, ob + 1, l * Vsp); set(oa, ob + 2, m * Vsp); }
    if (na === 4) { set(oa + 1, ob, -l * Vsp); set(oa + 2, ob, -m * Vsp); }
    if (na === 4 && nb === 4) {
      set(oa + 1, ob + 1, l * l * Vps + (1 - l * l) * Vpp); set(oa + 2, ob + 2, m * m * Vps + (1 - m * m) * Vpp);
      set(oa + 1, ob + 2, l * m * (Vps - Vpp)); set(oa + 2, ob + 1, l * m * (Vps - Vpp)); set(oa + 3, ob + 3, Vpp);
    }
  }
  // γ (Klopman–Ohno) and the self-consistent charges
  const g = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) { g[i * n + i] = HUB[atoms[i].Z]; continue; }
    const d = Math.hypot(atoms[j].x - atoms[i].x, atoms[j].y - atoms[i].y), u = 2 / (1 / HUB[atoms[i].Z] + 1 / HUB[atoms[j].Z]), a0 = 14.4 / u;
    g[i * n + j] = 14.4 / Math.sqrt(d * d + a0 * a0);
  }
  let dq = new Float64Array(n), res = null;
  for (let it = 0; it < (SCC ? 200 : 1); it++) {
    const Hm = Float64Array.from(H0);
    if (SCC) for (let i = 0; i < n; i++) { let sh = 0; for (let j = 0; j < n; j++) sh += g[i * n + j] * dq[j]; for (let k = 0; k < norb(atoms[i].Z); k++) Hm[(off[i] + k) * M + off[i] + k] += sh; }
    const { e, V } = eigh(Hm, M), { f, TS } = fill(e, N);
    const pop = new Float64Array(n);
    for (let s = 0; s < M; s++) { if (f[s] < 1e-14) continue; for (let i = 0; i < n; i++) for (let k = 0; k < norb(atoms[i].Z); k++) { const c = V[(off[i] + k) * M + s]; pop[i] += f[s] * c * c; } }
    const nq = new Float64Array(n); for (let i = 0; i < n; i++) nq[i] = pop[i] - VAL[atoms[i].Z]; // (electrons more than neutral: Δq as an electron count)
    let Eband = 0; for (let s = 0; s < M; s++) Eband += f[s] * e[s];
    let Ecc = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) Ecc += 0.5 * g[i * n + j] * nq[i] * nq[j];
    let Esh = 0; for (let i = 0; i < n; i++) { let sh = 0; for (let j = 0; j < n; j++) sh += g[i * n + j] * dq[j]; Esh += sh * nq[i]; }
    res = { E: Eband - Esh + Ecc - TS + Erep, q: Array.from(nq, v => -v), Erep, e };
    let dmax = 0; for (let i = 0; i < n; i++) dmax = Math.max(dmax, Math.abs(nq[i] - dq[i]));
    if (!SCC || dmax < 1e-8) break;
    for (let i = 0; i < n; i++) dq[i] = dq[i] + 0.3 * (nq[i] - dq[i]);
  }
  return res;
}
const atomE = new Map();
function freeAtom(Z) { if (!atomE.has(Z)) atomE.set(Z, energy([{ Z, x: 0, y: 0 }]).E); return atomE.get(Z); }
/* relax by steepest descent with numerical forces */
function relax(atoms, Q, steps = 400) {
  const h = 1e-4; let step = 0.02, E = energy(atoms, Q).E;
  for (let it = 0; it < steps; it++) {
    const gr = atoms.map(a => { const g = []; for (const k of ['x', 'y']) { const v = a[k]; a[k] = v + h; const e1 = energy(atoms, Q).E; a[k] = v - h; const e2 = energy(atoms, Q).E; a[k] = v; g.push((e1 - e2) / (2 * h)); } return g; });
    const gn = Math.sqrt(gr.reduce((s, g) => s + g[0] * g[0] + g[1] * g[1], 0)); if (gn < 1e-3) break;
    const old = atoms.map(a => [a.x, a.y]);
    for (;;) { atoms.forEach((a, i) => { a.x = old[i][0] - step * gr[i][0] / gn; a.y = old[i][1] - step * gr[i][1] / gn; }); const e = energy(atoms, Q).E; if (e < E) { E = e; step *= 1.2; break; } step *= 0.5; if (step < 1e-6) { atoms.forEach((a, i) => { a.x = old[i][0]; a.y = old[i][1]; }); return E; } }
  }
  return E;
}
function molAtoms(key) {
  const mol = X.MOLECULES[key]; if (!mol) throw new Error('no molecule ' + key);
  const at = mol.atoms.map(([s, x, y]) => ({ Z: X.ELEMENTS.findIndex(e => e && e.sym === s), x, y }));
  return { at, bonds: (mol.bonds || []).map(([i, j, o]) => [i, j, o || 1]), Q: mol.atoms.reduce((s, a) => s + (a[3] || 0), 0) };
}
/* fit each element pair on a reference molecule (its bonds of that pair breathing together; the pairs fitted before it
   fixed): the hoppings' scale s so that the atomization energy is the game's (the sum of its bond energies), and the
   repulsion A·e^(−c·(d − r₀)) so that the bonds sit at the game's length r₀ with the game's stiffness 2·D·α² */
const REF = [['H2', 1, 1], ['CH4', 6, 1], ['NH3', 7, 1], ['H2O', 8, 1], ['HF', 9, 1], ['C2H6', 6, 6], ['N2H4', 7, 7], ['H2O2', 8, 8], ['F2', 9, 9], ['CH3OH', 6, 8], ['methylamine', 6, 7], ['CH3F', 6, 9], ['NH2OH', 7, 8]];
function fitPair(key, za, zb) {
  let m; try { m = molAtoms(key); } catch (e) { return null; }
  const at = m.at, prs = m.bonds.filter(([i, j]) => pkey(at[i].Z, at[j].Z) === pkey(za, zb)); if (!prs.length) return null;
  const ea = X.ELEMENTS[za], eb = X.ELEMENTS[zb], r0 = r1(za, zb), D = X.bondEnergy(ea, eb, 1), al = X.morseA(ea, eb, 1), kb = 2 * D * al * al, nb = prs.length;
  for (const [i, j] of prs) { const a = at[i], b = at[j], d = Math.hypot(b.x - a.x, b.y - a.y); b.x = a.x + (b.x - a.x) * r0 / d; b.y = a.y + (b.y - a.y) * r0 / d; }
  let Dtot = 0; for (const [i, j, o] of m.bonds) Dtot += X.bondEnergy(X.ELEMENTS[at[i].Z], X.ELEMENTS[at[j].Z], Math.round(o) || 1);
  const Efree = at.reduce((s0, a) => s0 + freeAtom(a.Z), 0);
  const Eat = (sc) => { const c = at.map(a => ({ ...a })); for (const [i, j] of prs) { const a = c[i], b = c[j]; b.x = a.x + (at[j].x - at[i].x) * sc; b.y = a.y + (at[j].y - at[i].y) * sc; } return energy(c, m.Q).E; };
  const solve = (sv) => { // (for a hopping scale sv: the repulsion from the slope and curvature; returns the atomization energy)
    REP.set(pkey(za, zb), { s: sv, A: 0, c: 3 });
    const h = 2e-3, e0 = Eat(1), ep = Eat(1 + h), em = Eat(1 - h), d1 = (ep - em) / (2 * h * r0) / nb, d2 = (ep - 2 * e0 + em) / (h * h * r0 * r0) / nb;
    // repulsion per bond φ = A e^(−c x): φ′ = −c·A = −d1, φ″ = c²·A = kb − d2  →  c = (kb − d2)/d1, A = d1/c
    let c = (kb - d2) / d1; if (!(c > 1.5 && c < 8)) c = Math.min(8, Math.max(1.5, isFinite(c) && c > 0 ? c : 3)); // (the stiffness where it can be had; the length always)
    const A = d1 / c;
    REP.set(pkey(za, zb), { s: sv, A, c });
    return Efree - Eat(1);
  };
  let lo = 0.02, hi = 6, flo = solve(lo) - Dtot, fhi = solve(hi) - Dtot;
  for (let it = 0; it < 40 && flo * fhi < 0; it++) { const mid = 0.5 * (lo + hi), f = solve(mid) - Dtot; if (f * flo < 0) { hi = mid; fhi = f; } else { lo = mid; flo = f; } }
  if (flo * fhi >= 0) { solve(1); return { fail: true, P: REP.get(pkey(za, zb)) }; }
  return REP.get(pkey(za, zb));
}
for (const [k, za, zb] of REF) { const P = fitPair(k, za, zb); if (P) console.log(`fit ${X.ELEMENTS[za].sym}–${X.ELEMENTS[zb].sym} on ${k}: ${P.fail ? 'NO FIT, ' : ''}s ${(P.P || P).s.toFixed(3)}, A ${(P.P || P).A.toFixed(3)} eV, c ${(P.P || P).c.toFixed(2)}/Å`); }
const keys = process.argv.slice(2).length ? process.argv.slice(2) : ['H2', 'H2O', 'NH3', 'CH4', 'C2H6', 'C2H4', 'C2H2', 'CO2', 'HCN', 'N2', 'O2', 'CH2O', 'benzene', 'H3Op', 'OHm'];
for (const key of keys) {
  let m; try { m = molAtoms(key); } catch (e) { console.log(key + ': not in the library'); continue; }
  const at = m.at; if (at.some(a => !VAL[a.Z])) { console.log(key + ': an element the prototype lacks'); continue; }
  const E = relax(at, m.Q), Eat = at.reduce((s, a) => s + freeAtom(a.Z), 0), r = energy(at, m.Q);
  let Dgame = 0; for (const [i, j, o] of m.bonds) Dgame += X.bondEnergy(X.ELEMENTS[at[i].Z], X.ELEMENTS[at[j].Z], Math.round(o) || 1);
  const bl = m.bonds.map(([i, j, o]) => `${X.ELEMENTS[at[i].Z].sym}${'-=#'[Math.max(0, Math.min(2, Math.round(o) - 1))]}${X.ELEMENTS[at[j].Z].sym} ${Math.hypot(at[j].x - at[i].x, at[j].y - at[i].y).toFixed(3)} (${X.bondLength(X.ELEMENTS[at[i].Z], X.ELEMENTS[at[j].Z], Math.round(o) || 1).toFixed(3)})`);
  console.log(`${key}: atomization ${(Eat - E).toFixed(2)} eV (game ${Dgame.toFixed(2)}) | ${[...new Set(bl)].join(', ')} | q ${r.q.map(v => v.toFixed(2)).join(' ')}`);
}
// H + H₂ → H₂ + H, collinear: the barrier
{ const line = (s) => energy([{ Z: 1, x: -s, y: 0 }, { Z: 1, x: 0, y: 0 }, { Z: 1, x: s, y: 0 }]).E;
  let best = Infinity, sb = 0; for (let s = 0.8; s <= 1.2; s += 0.005) { const e = line(s); if (e < best) { best = e; sb = s; } }
  const h2 = [{ Z: 1, x: 0, y: 0 }, { Z: 1, x: 0.74, y: 0 }]; const E2 = relax(h2, 0) + freeAtom(1);
  console.log(`H + H₂: symmetric H₃ at ${sb.toFixed(3)} Å is ${(best - E2).toFixed(3)} eV above H₂ + H (measured 0.42 eV at 0.93 Å)`); }
