'use strict';
/* Continuous bond orders, step 2 (1.12 planning): a closed-form bond order, so the energy is a plain smooth function
   of the positions (no self-consistent solve: step 1's model B lost energy because its iterated orders were not
   converged, and model A's split of a shared valence was not fixed by the geometry, so H + H₂ had no barrier).
     raw order      n⁰ = exp((r₁ − r)/c), Pauling's rule (c from the single and double bond lengths), tapered to 0
                    between r₁ + 0.9 and r₁ + 1.3 Å
     valence left   for atom i seen from its partner j: Aᵢⱼ = Vᵢ − Σ_{k≠j} nᵢₖ
     order          n = smin(n⁰, Aᵢⱼ, Aⱼᵢ, 3) (a smooth minimum, softness EPS), two passes: the first with nᵢₖ = n⁰ᵢₖ,
                    the second with the first pass's orders (a fixed, finite composition: still closed form)
     pair energy    a Morse curve of the order: depth D(n) (D₁·n^p below a single bond, the game's tables between whole
                    orders), length r(n) = r₁ − c·ln n, stiffness of the nearest whole order; plus a soft core
     angles         the game's VSEPR terms on partners with n > 0.5, weighted smoothly by the order
   Forces by numerical differentiation (a prototype). node tools/bo-proto2.js [mols|hhh|dyn|cost] */
const B1 = require('./bo-proto.js'), { X } = B1;
const EPS = +(process.env.BO_EPS || 0.1), P_LOW = +(process.env.BO_P || 1.1);
const cache = new Map();
function pp(a, b) {
  const key = a.el.Z < b.el.Z ? a.el.Z * 128 + b.el.Z : b.el.Z * 128 + a.el.Z; let v = cache.get(key);
  if (!v) {
    const r = [1, 2, 3].map(o => X.bondLength(a.el, b.el, o)), D = [1, 2, 3].map(o => X.bondEnergy(a.el, b.el, o)), al = [1, 2, 3].map(o => X.morseA(a.el, b.el, o));
    const t = X.BONDS[X.bondKey(a.el, b.el)], two = !!(t && t.l && t.l[1]);
    const c = two ? Math.min(0.45, Math.max(0.2, (r[0] - r[1]) / Math.LN2)) : Math.sqrt(P_LOW / 2) / al[0];
    v = { r, D, al, c, sig: 0.62 * r[0] }; cache.set(key, v);
  }
  return v;
}
const smin = (a, b) => { const h = Math.max(EPS - Math.abs(a - b), 0) / EPS; return Math.min(a, b) - h * h * EPS / 4; }; // (quadratic smooth minimum)
const MODEL = process.env.BO_MODEL || 'E', BETA_K = +(process.env.BO_BK || 1);
/* (model E) past its single-bond length a raw order falls as a Gaussian, exp(−β d²), β = α₁² (a Morse well's own
   curvature: flat at the bond's length, so a stretched single bond frees its valence only as fast as it costs
   energy); shorter, Pauling's exp(−d/c) toward the double and triple bonds. */
const betaOf = (P) => BETA_K * P.al[0] * P.al[0];
function raw(r, P) {
  const d = r - P.r[0]; let n = MODEL === 'E' && d > 0 ? Math.exp(-betaOf(P) * d * d) : Math.exp(-d / P.c);
  if (d > 0.9) n *= d >= 1.3 ? 0 : 0.5 * (1 + Math.cos(Math.PI * (d - 0.9) / 0.4)); return Math.min(n, 3.5);
}
function Dof(P, n) { if (n <= 0) return 0; if (n < 1) return P.D[0] * Math.pow(n, P_LOW); const i = Math.min(1, Math.floor(n - 1)), f = Math.min(1, n - 1 - i); return P.D[i] + (P.D[i + 1] - P.D[i]) * f; }
function rOf(P, n) { return P.r[0] - P.c * Math.log(Math.max(n, 0.05)); } // (Pauling's length for every order: smooth through 1; the Gaussian's inverse had an infinite slope there)
function alOf(P, n) { return n <= 1 ? P.al[0] : n >= 3 ? P.al[2] : P.al[Math.floor(n) - 1] + (P.al[Math.ceil(n) - 1] - P.al[Math.floor(n) - 1]) * (n - Math.floor(n)); }
/* Step 3 (model C): no passes. Weak partners first fade out (a 1-3 neighbour 1.5 Å off in a crowded flat molecule is no
   partner: the raw order is tapered from 0.35 down to nothing at 0.15); then each atom whose partners ask for more than
   its valence takes the same amount L off every partner, floored at zero (the projection onto its valence: weakest
   first to go, and benzene's 1.62 + 1.62 + 1 comes down to 1.5 + 1.5 + 1 by itself); a pair's order is the smaller of
   its two atoms' answers (a smooth minimum). Closed form, continuous. */
const TAPER_A = +(process.env.BO_TA || 0.15), TAPER_B = +(process.env.BO_TB || 0.35);
function taper(n) { if (n >= TAPER_B) return n; if (n <= TAPER_A) return 0; const t = (n - TAPER_A) / (TAPER_B - TAPER_A); return n * t * t * (3 - 2 * t); }
const EPS_S = +(process.env.BO_ES || 0.03);
/* a smooth minimum that leaves two equal values as they are (within EPS_S of the true minimum elsewhere) */
const sminC = (a, b) => { const d = Math.abs(a - b); return Math.min(a, b) + (d < EPS_S ? 0.5 * d * (1 - d / EPS_S) * (1 - d / EPS_S) : 0); }; // (C¹; exact for equal values and for values EPS_S apart)
/* a ramp max(0, x) rounded over ±EPS_S (C¹) */
const sp = (x) => x <= -EPS_S ? 0 : x >= EPS_S ? x : (x + EPS_S) * (x + EPS_S) / (4 * EPS_S);
function levelL(vals, V) { // the level L with Σ sp(v − L) = V, then rounded to L ≥ 0 (sp again): smooth in every value, partners of order 0 included
  let lo = -V - 1, hi = 4; for (const v of vals) hi = Math.max(hi, v + 1);
  const f = (L) => { let t = 0; for (const v of vals) t += sp(v - L); return t - V; };
  for (let it = 0; it < 80; it++) { const mid = 0.5 * (lo + hi); if (f(mid) > 0) lo = mid; else hi = mid; }
  return sp(0.5 * (lo + hi));
}
function orders(atoms, xy) {
  const na = atoms.length, pairs = [];
  for (let i = 0; i < na; i++) for (let j = i + 1; j < na; j++) {
    const r = Math.hypot(xy[2 * j] - xy[2 * i], xy[2 * j + 1] - xy[2 * i + 1]), P = pp(atoms[i], atoms[j]);
    if (r < P.r[0] + 1.3) { const n0 = raw(r, P); pairs.push({ i, j, r, P, n0, ne: taper(n0), n: 0 }); }
  }
  const V = atoms.map(p => X.capacity(p)), VH = atoms.map(p => X.hyperCap(p));
  const by = atoms.map(() => []); pairs.forEach(q => { by[q.i].push(q); by[q.j].push(q); });
  // (each partner's demand first capped by what that partner can give at all, its own valence: compressing one O–H must
  // not take order from the other)
  const capOf = (q, i) => { const o = q.i === i ? q.j : q.i; return sminC(q.ne, Math.min(atoms[i].el.en >= 3.0 ? VH[o] : V[o], 3)); };
  const Lof = by.map((list, i) => { const hyp = list.some(q => atoms[q.i === i ? q.j : q.i].el.en >= 3.0); return levelL(list.map(q => capOf(q, i)), hyp ? VH[i] : V[i]); });
  for (const q of pairs) q.n = Math.max(0, sminC(sp(capOf(q, q.i) - Lof[q.i]), sp(capOf(q, q.j) - Lof[q.j]))); // (a hard minimum: a smooth one takes EPS/4 off two equal answers, the usual case)
  // (model D) the order a pair may hold is what each atom's valence leaves after its other partners (their projected
  // orders), so its own distance comes only from its Morse curve: N = min(Vᵢ − Σ_{k≠j} n'ᵢₖ, Vⱼ − Σ_{k≠i} n'ⱼₖ, 3)
  const S = new Float64Array(na); for (const q of pairs) { S[q.i] += q.n; S[q.j] += q.n; }
  for (const q of pairs) {
    const hi = atoms[q.j].el.en >= 3.0, hj = atoms[q.i].el.en >= 3.0;
    q.N = Math.max(0, smin(smin((hi ? VH[q.i] : V[q.i]) - (S[q.i] - q.n), (hj ? VH[q.j] : V[q.j]) - (S[q.j] - q.n)), 3));
  }
  return pairs;
}
function energy(atoms, xy, detail) {
  const pairs = orders(atoms, xy); let Eb = 0, Ec = 0, Ea = 0;
  for (const q of pairs) {
    const N = MODEL === 'D' ? q.N : q.n;
    if (N > 1e-6) { const D = Dof(q.P, N), r0 = rOf(q.P, MODEL === 'D' ? Math.max(N, 1) : N), al = alOf(q.P, N), e = 1 - Math.exp(-al * (q.r - r0)), d = q.r - q.P.r[0], fc = d <= 0.9 ? 1 : d >= 1.3 ? 0 : 0.5 * (1 + Math.cos(Math.PI * (d - 0.9) / 0.4)); Eb += fc * D * (e * e - 1); }
    Ec += 0.05 * Math.pow(q.P.sig / q.r, 12);
  }
  // VSEPR angles, made continuous (step 3): partners from n > 0.4, the weakest blended in as its order goes from 0.4 to
  // 0.7, and the lone pairs (valence left over, /2) blended between the two whole numbers either side
  const nb = atoms.map(() => []);
  for (const q of pairs) if (q.n > 0.4) { nb[q.i].push([q.j, q.n]); nb[q.j].push([q.i, q.n]); }
  const sstep = (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  const angE = (c, L) => {
    const p = atoms[c], n = L.length; if (n < 2 || n > 6) return 0;
    let sum = 0; for (const [, o] of L) sum += o;
    const lpr = Math.max(0, (p.val - sum) / 2), l0 = Math.floor(lpr), f = lpr - l0, per = X.periodOf(p.el.Z), allH = L.every(([k]) => atoms[k].Z === 1);
    const ang = L.map(([k]) => Math.atan2(xy[2 * k + 1] - xy[2 * c + 1], xy[2 * k] - xy[2 * c])).sort((u, v) => u - v);
    const gaps = []; for (let k = 0; k < n; k++) gaps.push(k === n - 1 ? ang[0] + 2 * Math.PI - ang[k] : ang[k + 1] - ang[k]);
    const gs = gaps.slice().sort((u, v) => u - v);
    const e = (lp) => { const tg = X.angleTargetsRaw(n, lp, per, allH).slice().sort((u, v) => u - v); let t = 0; for (let k = 0; k < n; k++) t += 0.5 * X.ANGLE_K * (gs[k] - tg[k]) ** 2; return t; };
    return f > 1e-9 ? (1 - f) * e(l0) + f * e(l0 + 1) : e(l0);
  };
  for (let c = 0; c < atoms.length; c++) {
    const p = atoms[c], L = nb[c];
    if (L.length < 2 || !p.el || p.el.dblock) continue;
    let wk = 0; for (let k = 1; k < L.length; k++) if (L[k][1] < L[wk][1]) wk = k;
    const sw = sstep((L[wk][1] - 0.4) / 0.3);
    Ea += sw * angE(c, L) + (1 - sw) * angE(c, L.filter((_, k) => k !== wk));
  }
  const E = Eb + Ec + Ea;
  return detail ? { E, Eb, Ec, Ea, pairs } : E;
}
function grad(atoms, xy) { const g = new Float64Array(xy.length), h = 1e-6; for (let k = 0; k < xy.length; k++) { const v = xy[k]; xy[k] = v + h; const a = energy(atoms, xy); xy[k] = v - h; const b = energy(atoms, xy); xy[k] = v; g[k] = (a - b) / (2 * h); } return g; }
function relax(atoms, xy, steps = 4000) {
  const v = new Float64Array(xy.length); let dt = 0.02, a = 0.1, np = 0; const m = atoms.map(p => p.m);
  for (let s = 0; s < steps; s++) {
    const g = grad(atoms, xy); let P = 0, fn = 0, vn = 0;
    for (let k = 0; k < xy.length; k++) { P -= g[k] * v[k]; fn += g[k] * g[k]; vn += v[k] * v[k]; }
    if (Math.sqrt(fn) < 1e-4) break;
    if (P > 0) { const f = Math.sqrt(vn / (fn || 1)); for (let k = 0; k < xy.length; k++) v[k] = (1 - a) * v[k] - a * g[k] * f; if (++np > 5) { dt = Math.min(dt * 1.1, 0.1); a *= 0.99; } }
    else { v.fill(0); dt *= 0.5; a = 0.1; np = 0; }
    for (let k = 0; k < xy.length; k++) { v[k] -= dt * g[k] / m[k >> 1]; xy[k] += dt * v[k]; }
  }
}
function mols() {
  const keys = process.argv.slice(3).length ? process.argv.slice(3) : ['H2', 'O2', 'N2', 'CO', 'H2O', 'NH3', 'CH4', 'C2H6', 'C2H4', 'C2H2', 'CO2', 'HCN', 'benzene', 'CH3OH', 'H2O2'];
  let worst = 0;
  for (const key of keys) {
    const B = B1.buildMol(key); if (!B) { console.log(key, 'not in the library'); continue; }
    relax(B.atoms, B.xy); const d = energy(B.atoms, B.xy, true);
    const sym = (k) => B.atoms[k].el.sym + (k + 1), Dcl = B.classic.reduce((t, c) => t + c.D, 0);
    const got = d.pairs.filter(q => q.n > 0.25).map(q => `${sym(q.i)}–${sym(q.j)} ${q.n.toFixed(2)} ${q.r.toFixed(3)}`);
    worst = Math.max(worst, Math.abs(-d.Eb - Dcl) / B.classic.length);
    console.log(`${key.padEnd(8)} atomization ${(-d.Eb).toFixed(2)} eV (game ${Dcl.toFixed(2)}), angles ${d.Ea.toFixed(3)} | ${got.join(', ')}`);
  }
  console.log(`worst difference per bond against the game's bonds: ${worst.toFixed(3)} eV`);
}
/* H + H₂ → H₂ + H, collinear: the energy along the symmetric stretch and the minimum-energy path (measured barrier 0.42 eV) */
function hhh() {
  X.clearWorld(); const atoms = [0, 1, 2].map(k => X.addAtom('H', k * 3, 0)); for (const p of atoms) X.refresh(p);
  const E = (r1, r2) => energy(atoms, Float64Array.from([0, 0, r1, 0, r1 + r2, 0]));
  const far = E(0.741, 6);
  let best = Infinity, rs = 0; for (let r = 0.75; r <= 1.3; r += 0.005) { const e = E(r, r); if (e < best) { best = e; rs = r; } }
  // a well at the symmetric point means H₃ is bound: compare its energy with the walls either side along the antisymmetric stretch
  const dW = E(rs + 0.06, rs - 0.06) - E(rs, rs);
  console.log(`H₂ + H far apart ${far.toFixed(3)} eV; symmetric H–H–H lowest at ${rs.toFixed(3)} Å: ${(best - far).toFixed(3)} eV above (measured barrier 0.42 eV at 0.93 Å); antisymmetric stretch there: ${dW > 0 ? 'a well (H₃ bound: wrong)' : 'a saddle (right)'} (${dW.toFixed(4)} eV)`);
}
/* Energy kept in dynamics: hot water and methane together, velocity Verlet with these forces */
function dyn() {
  X.clearWorld(); const atoms = [], xy0 = [];
  const add = (key, ox, oy) => { const M = X.MOLECULE_LIB.find(m => m.k === key); for (const [sym, x, y] of M.a) { atoms.push(X.addAtom(sym, ox + x, oy + y)); xy0.push(ox + x, oy + y); } };
  add('H2O', 0, 0); add('CH4', 3.2, 0.4); add('H2', -1.5, 3);
  for (const p of atoms) X.refresh(p);
  const xy = Float64Array.from(xy0); relax(atoms, xy, 400);
  const m = atoms.map(p => p.m), v = new Float64Array(xy.length); let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let k = 0; k < v.length; k++) v[k] = rnd() * Math.sqrt(2 * (+process.env.BO_HEAT || 0.25) / m[k >> 1]); // (hot: about 0.25 eV a degree)
  const KE = () => { let t = 0; for (let k = 0; k < v.length; k++) t += 0.5 * m[k >> 1] * v[k] * v[k]; return t; };
  for (const dt of [0.02, 0.01]) {
    const x = Float64Array.from(xy), w = Float64Array.from(v); let g = grad(atoms, x);
    const E0 = energy(atoms, x) + w.reduce((t, vv, k) => t + 0.5 * m[k >> 1] * vv * vv, 0); let worst = 0;
    for (let s = 0; s < 1500; s++) {
      for (let k = 0; k < x.length; k++) { w[k] -= 0.5 * dt * g[k] / m[k >> 1]; x[k] += dt * w[k]; }
      g = grad(atoms, x); for (let k = 0; k < x.length; k++) w[k] -= 0.5 * dt * g[k] / m[k >> 1];
      const E = energy(atoms, x) + w.reduce((t, vv, k) => t + 0.5 * m[k >> 1] * vv * vv, 0); worst = Math.max(worst, Math.abs(E - E0));
    }
    console.log(`dt ${dt} tu (${(dt * 10.18).toFixed(2)} fs), 1,500 steps: energy kept to ${worst.toFixed(4)} eV`);
  }
  void KE;
}
module.exports = { energy, orders, grad, relax, pp };
if (require.main === module) { const what = process.argv[2] || 'mols'; ({ mols, hhh, dyn })[what](); }
