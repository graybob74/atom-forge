'use strict';
/* Continuous bond orders, step 6 (1.13): model E of tools/bo-proto2.js with analytic forces. The same energy, worked
   out once with its gradient by the chain rule backwards (pair energies and angle terms → orders → the valence levels
   → the capped raw orders → distances), instead of 2 × (2N) energy evaluations for numerical forces.
   node tools/bo-fast.js [check|dyn|cost]  */
const P2 = require('./bo-proto2.js'), { X } = require('./bo-proto.js');
const EPS = +(process.env.BO_EPS || 0.1), P_LOW = +(process.env.BO_P || 1.1), EPS_S = +(process.env.BO_ES || 0.03);
const TAPER_A = 0.15, TAPER_B = 0.35;
// the smooth pieces and their slopes
const sp = (x) => x <= -EPS_S ? 0 : x >= EPS_S ? x : (x + EPS_S) * (x + EPS_S) / (4 * EPS_S);
const spD = (x) => x <= -EPS_S ? 0 : x >= EPS_S ? 1 : (x + EPS_S) / (2 * EPS_S);
const hS = (d) => d < EPS_S ? 0.5 * d * (1 - d / EPS_S) * (1 - d / EPS_S) : 0;
const hSD = (d) => d < EPS_S ? 0.5 * (1 - d / EPS_S) * (1 - d / EPS_S) - d * (1 - d / EPS_S) / EPS_S : 0;
// sminC(a, b) and its slopes [∂/∂a, ∂/∂b]
function sminC2(a, b) { const d = Math.abs(a - b), h = hS(d), g = hSD(d); return a <= b ? [a + h, 1 - g, g] : [b + h, g, 1 - g]; }
const smin = (a, b) => { const h = Math.max(EPS - Math.abs(a - b), 0) / EPS; return Math.min(a, b) - h * h * EPS / 4; };
function taper2(n) { if (n >= TAPER_B) return [n, 1]; if (n <= TAPER_A) return [0, 0]; const w = TAPER_B - TAPER_A, t = (n - TAPER_A) / w, s = t * t * (3 - 2 * t); return [n * s, s + n * 6 * t * (1 - t) / w]; }
function raw2(r, P) { // [n⁰, dn⁰/dr]
  const d = r - P.r[0], beta = P.al[0] * P.al[0];
  let n, dn;
  if (d > 0) { n = Math.exp(-beta * d * d); dn = -2 * beta * d * n; } else { n = Math.exp(-d / P.c); dn = -n / P.c; }
  if (d > 0.9) { if (d >= 1.3) return [0, 0]; const u = Math.PI * (d - 0.9) / 0.4, f = 0.5 * (1 + Math.cos(u)), fd = -0.5 * Math.sin(u) * Math.PI / 0.4; dn = dn * f + n * fd; n *= f; }
  return n >= 3.5 ? [3.5, 0] : [n, dn];
}
function Dof2(P, n) { if (n <= 0) return [0, 0]; if (n < 1) return [P.D[0] * Math.pow(n, P_LOW), P.D[0] * P_LOW * Math.pow(n, P_LOW - 1)]; const i = Math.min(1, Math.floor(n - 1)), f = n - 1 - i; return f >= 1 ? [P.D[i + 1], 0] : [P.D[i] + (P.D[i + 1] - P.D[i]) * f, P.D[i + 1] - P.D[i]]; }
function rOf2(P, n) { return n > 0.05 ? [P.r[0] - P.c * Math.log(n), -P.c / n] : [P.r[0] - P.c * Math.log(0.05), 0]; }
function alOf2(P, n) { if (n <= 1) return [P.al[0], 0]; if (n >= 3) return [P.al[2], 0]; const f = Math.floor(n), s = P.al[Math.ceil(n) - 1] - P.al[f - 1]; return [P.al[f - 1] + s * (n - f), f === Math.ceil(n) ? 0 : s]; }
const sstep2 = (x) => x <= 0 ? [0, 0] : x >= 1 ? [1, 0] : [x * x * (3 - 2 * x), 6 * x * (1 - x)];
/* the valence level of one atom: L* with Σ sp(c − L*) = V, by bisection; returns L* (its slopes come from the weights sp′(c − L*)) */
function level(cs, V) {
  let lo = -V - 1, hi = 4; for (const v of cs) hi = Math.max(hi, v + 1);
  for (let it = 0; it < 60; it++) { const mid = 0.5 * (lo + hi); let t = 0; for (const v of cs) t += sp(v - mid); if (t - V > 0) lo = mid; else hi = mid; }
  return 0.5 * (lo + hi);
}
/* atoms: game particles (for their elements and valences); xy: positions; g: the gradient, filled in. Returns the energy. */
function energyGrad(atoms, xy, g, detail) {
  const na = atoms.length;
  g.fill(0);
  const V = atoms.map(p => X.capacity(p)), VH = atoms.map(p => X.hyperCap(p)), EN3 = atoms.map(p => p.el.en >= 3.0);
  const pairs = [];
  for (let i = 0; i < na; i++) for (let j = i + 1; j < na; j++) {
    const dx = xy[2 * j] - xy[2 * i], dy = xy[2 * j + 1] - xy[2 * i + 1], r = Math.hypot(dx, dy), P = P2.pp(atoms[i], atoms[j]);
    if (r < P.r[0] + 1.3) {
      const [n0, dn0] = raw2(r, P), [ne, dne] = taper2(n0);
      pairs.push({ i, j, r, ux: dx / r, uy: dy / r, P, ne, dne: dne * dn0, ci: 0, cj: 0, dci: 0, dcj: 0, a: 0, b: 0, n: 0, gn: 0, gr: 0, gci: 0, gcj: 0 });
    }
  }
  const by = atoms.map(() => []); pairs.forEach(q => { by[q.i].push(q); by[q.j].push(q); });
  // caps: each partner's demand capped by what that partner can give at all
  for (const q of pairs) {
    const Ci = Math.min(EN3[q.i] ? VH[q.j] : V[q.j], 3), Cj = Math.min(EN3[q.j] ? VH[q.i] : V[q.i], 3); // (atom i's view: capped by partner j's valence, hypervalent if i is electronegative)
    const a = sminC2(q.ne, Ci), b = sminC2(q.ne, Cj); q.ci = a[0]; q.dci = a[1]; q.cj = b[0]; q.dcj = b[1];
  }
  const Ls = new Float64Array(na), Lv = new Float64Array(na), Vi = new Float64Array(na);
  for (let i = 0; i < na; i++) {
    const L = by[i]; if (!L.length) continue;
    const hyp = L.some(q => EN3[q.i === i ? q.j : q.i]); Vi[i] = hyp ? VH[i] : V[i];
    Ls[i] = level(L.map(q => q.i === i ? q.ci : q.cj), Vi[i]); Lv[i] = sp(Ls[i]);
  }
  const sn = []; // [∂n/∂a, ∂n/∂b, sp'(a-arg), sp'(b-arg)]
  for (const q of pairs) {
    const xa = q.ci - Lv[q.i], xb = q.cj - Lv[q.j], a = sp(xa), b = sp(xb), m = sminC2(a, b);
    q.n = Math.max(0, m[0]); sn.push([m[1], m[2], spD(xa), spD(xb)]);
  }
  // energies: pair Morse curves of the order, a soft core, the angle terms
  let Eb = 0, Ec = 0, Ea = 0;
  for (const q of pairs) {
    const N = q.n, P = q.P;
    if (N > 1e-6) {
      const [D, dD] = Dof2(P, N), [r0, dr0] = rOf2(P, N), [al, dal] = alOf2(P, N);
      const x = q.r - r0, ex = Math.exp(-al * x), e = 1 - ex, d = q.r - P.r[0];
      let fc = 1, dfc = 0; if (d > 0.9) { if (d >= 1.3) fc = 0; else { const u = Math.PI * (d - 0.9) / 0.4; fc = 0.5 * (1 + Math.cos(u)); dfc = -0.5 * Math.sin(u) * Math.PI / 0.4; } }
      const M = D * (e * e - 1), dMdr = D * 2 * e * ex * al, dMdr0 = -dMdr, dMdal = D * 2 * e * ex * x, dMdD = e * e - 1;
      Eb += fc * M;
      q.gr += fc * dMdr + dfc * M;
      q.gn += fc * (dMdD * dD + dMdr0 * dr0 + dMdal * dal);
    }
    const s12 = Math.pow(P.sig / q.r, 12); Ec += 0.05 * s12; q.gr += -12 * 0.05 * s12 / q.r;
  }
  // angles (as model E: partners from n > 0.4, the weakest blended in from 0.4 to 0.7, lone pairs blended between
  // whole numbers)
  const nb = atoms.map(() => []);
  for (const q of pairs) if (q.n > 0.4) { nb[q.i].push([q.j, q]); nb[q.j].push([q.i, q]); }
  const gang = new Float64Array(na); // (scratch: dE/d(angle of partner k) for the current centre)
  const angE = (c, L, wgt) => { // energy of centre c with partner list L; adds wgt·gradient; returns [E, dE/dΣn]
    const p = atoms[c], n = L.length; if (n < 2 || n > 6) return [0, 0];
    let sum = 0; for (const [, q] of L) sum += q.n;
    const lpr0 = (p.val - sum) / 2, lpr = Math.max(0, lpr0), l0 = Math.floor(lpr), f = lpr - l0, dfds = lpr0 > 0 ? -0.5 : 0;
    const per = X.periodOf(p.el.Z), allH = L.every(([k]) => atoms[k].Z === 1);
    const angs = L.map(([k]) => ({ k, a: Math.atan2(xy[2 * k + 1] - xy[2 * c + 1], xy[2 * k] - xy[2 * c]) })).sort((u, v) => u.a - v.a);
    const gaps = []; for (let k = 0; k < n; k++) gaps.push({ v: k === n - 1 ? angs[0].a + 2 * Math.PI - angs[k].a : angs[k + 1].a - angs[k].a, hi: k === n - 1 ? 0 : k + 1, lo: k });
    const gs = gaps.slice().sort((u, v) => u.v - v.v);
    const e = (lp, w) => { const tg = X.angleTargetsRaw(n, lp, per, allH).slice().sort((u, v) => u - v); let t = 0; for (let k = 0; k < n; k++) { const dv = gs[k].v - tg[k]; t += 0.5 * X.ANGLE_K * dv * dv; if (w) { const gk = w * X.ANGLE_K * dv; gang[angs[gs[k].hi].k] += gk; gang[angs[gs[k].lo].k] -= gk; } } return t; };
    let E, dEds;
    for (const [k] of L) gang[k] = 0;
    if (f > 1e-9) { const e0 = e(l0, wgt * (1 - f)), e1 = e(l0 + 1, wgt * f); E = (1 - f) * e0 + f * e1; dEds = (e1 - e0) * dfds; } else { E = e(l0, wgt); dEds = 0; }
    // angle slopes → positions
    for (const [k] of L) {
      const dx = xy[2 * k] - xy[2 * c], dy = xy[2 * k + 1] - xy[2 * c + 1], r2 = dx * dx + dy * dy, ga = gang[k];
      g[2 * k] += ga * -dy / r2; g[2 * k + 1] += ga * dx / r2; g[2 * c] -= ga * -dy / r2; g[2 * c + 1] -= ga * dx / r2;
    }
    return [E, dEds];
  };
  for (let c = 0; c < na; c++) {
    const p = atoms[c], L = nb[c];
    if (L.length < 2 || !p.el || p.el.dblock) continue;
    let wk = 0; for (let k = 1; k < L.length; k++) if (L[k][1].n < L[wk][1].n) wk = k;
    const [sw, dsw] = sstep2((L[wk][1].n - 0.4) / 0.3), Lm = L.filter((_, k) => k !== wk);
    // (each term's gradient is taken with its weight; the weights' own slopes go to the orders)
    const [eA, dA] = angE(c, L, sw), [eB, dB] = angE(c, Lm, 1 - sw);
    Ea += sw * eA + (1 - sw) * eB;
    for (const [, q] of L) q.gn += sw * dA;
    for (const [, q] of Lm) q.gn += (1 - sw) * dB;
    L[wk][1].gn += (eA - eB) * dsw / 0.3;
  }
  // back through the orders: n = sminC(sp(cᵢ − Lᵢ), sp(cⱼ − Lⱼ)), Lᵢ = sp(L*ᵢ), Σₖ sp(cₖ − L*ᵢ) = Vᵢ
  const gL = new Float64Array(na);
  pairs.forEach((q, k) => {
    if (q.n <= 0) return;
    const [na_, nb_, sa, sb] = sn[k], ga = q.gn * na_ * sa, gb = q.gn * nb_ * sb;
    q.gci += ga; gL[q.i] -= ga; q.gcj += gb; gL[q.j] -= gb;
  });
  for (let i = 0; i < na; i++) {
    if (!gL[i] || !by[i].length) continue;
    const gs = gL[i] * spD(Ls[i]); let W = 0;
    const w = by[i].map(q => { const v = spD((q.i === i ? q.ci : q.cj) - Ls[i]); W += v; return v; });
    if (W <= 0) continue;
    by[i].forEach((q, k) => { if (q.i === i) q.gci += gs * w[k] / W; else q.gcj += gs * w[k] / W; });
  }
  for (const q of pairs) {
    q.gr += (q.gci * q.dci + q.gcj * q.dcj) * q.dne;
    const fx = q.gr * q.ux, fy = q.gr * q.uy;
    g[2 * q.j] += fx; g[2 * q.j + 1] += fy; g[2 * q.i] -= fx; g[2 * q.i + 1] -= fy;
  }
  const E = Eb + Ec + Ea;
  return detail ? { E, Eb, Ec, Ea, pairs } : E;
}
module.exports = { energyGrad };
if (require.main === module) {
  const what = process.argv[2] || 'check', B1 = require('./bo-proto.js');
  if (what === 'check') {
    for (const key of ['H2O', 'CH4', 'C2H4', 'benzene', 'CH3OH', 'HCN', 'H2O2', 'CO2']) {
      const B = B1.buildMol(key); P2.relax(B.atoms, B.xy, 300);
      let seed = 5; for (let k = 0; k < B.xy.length; k++) B.xy[k] += 0.08 * (((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5); // (off the minimum)
      const g = new Float64Array(B.xy.length), E = energyGrad(B.atoms, B.xy, g), E0 = P2.energy(B.atoms, B.xy), gn = P2.grad(B.atoms, B.xy);
      let worst = 0, big = 0; for (let k = 0; k < g.length; k++) { worst = Math.max(worst, Math.abs(g[k] - gn[k])); big = Math.max(big, Math.abs(gn[k])); }
      console.log(`${key.padEnd(8)} energy ${E.toFixed(6)} (prototype ${E0.toFixed(6)}); force difference ${worst.toExponential(2)} eV/Å of ${big.toFixed(3)}`);
    }
  }
}
