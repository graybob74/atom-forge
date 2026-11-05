'use strict';
// DFT-D4 dispersion as GFN2-xTB uses it (self-consistent: the two-body C6 depend on the atoms' charges), in plain
// JavaScript, for gfn2.js. A port of dftd4 (LGPL-3.0-or-later): src/dftd4/model/d4.f90 (reference weights, the
// charge scaling zeta, C6 from Casimir-Polder integration), reference.f90 (set_refalpha_gfn2, set_refgw), damping/
// rational.f90 and damping/atm.f90 (the two-body rational damping and the three-body Axilrod-Teller-Muto term), and
// mctc-lib's D4 coordination number (erf counting with an electronegativity factor); and of tblite's
// src/tblite/disp/d4.f90 (which parts are self-consistent: the two-body energy and its potential dE/dq use the
// Mulliken charges, the three-body term uses charge-neutral C6; cutoffs 50 Bohr two-body, 25 three-body, 30 CN).
// Units inside: Bohr and Hartree. Tables: d4-data.js (written by d4-gen.js from the Fortran sources).
//
// d4Setup(Z, X) -> ctx for one geometry (X: Bohr, flat x y z); then
//   d4Energy2(ctx, q)            two-body energy (Hartree) with charges q
//   d4Potential(ctx, q, vat)     adds dE2/dq_i to vat
//   d4Gradient2(ctx, q, g, dEdcn) adds the two-body gradient at fixed q (Hartree/Bohr) and dE2/dCN
//   d4Three(ctx, g, dEdcn)       three-body energy (returned) and, with g, its gradient and dE3/dCN
//   d4CnGrad(ctx, dEdcn, g)      the coordination numbers' chain rule
// GFN2-xTB's parameters: s6 1, s8 2.7, a1 0.52, a2 5.0 Bohr, s9 5, alp 16; ga 3, gc 2, wf 6.

const D = require('./d4-data.js');
const BOHR = 0.529177210903;
const GA = 3.0, GC = 2.0, WF = 6.0, MREF = 7;
const P = { s6: 1.0, s8: 2.7, a1: 0.52, a2: 5.0, s9: 5.0, alp: 16.0 };
const CUT2 = 50.0, CUT3 = 25.0, CUTCN = 30.0;
const KCN = 7.5, K4 = 4.10451, K5 = 19.08857, K6 = 2 * Math.pow(11.28174, 2.0);
const SQRTPI = Math.sqrt(Math.PI), THOPI = 3.0 / Math.PI;
const num = x => +x;

// trapezoidal weights of the 23 imaginary frequencies (model/utils.f90 trapzd)
const FREQ = [0.000001, 0.050000, 0.100000, 0.200000, 0.300000, 0.400000, 0.500000, 0.600000, 0.700000, 0.800000,
  0.900000, 1.000000, 1.200000, 1.400000, 1.600000, 1.800000, 2.000000, 2.500000, 3.000000, 4.000000, 5.000000,
  7.500000, 10.00000];
const TW = new Float64Array(23);
TW[0] = 0.5 * (FREQ[1] - FREQ[0]);
for (let k = 1; k < 22; k++) TW[k] = 0.5 * ((FREQ[k] - FREQ[k - 1]) + (FREQ[k + 1] - FREQ[k]));
TW[22] = 0.5 * (FREQ[22] - FREQ[21]);

function zeta(a, c, qref, qmod) {
  if (qmod < 0.0) return Math.exp(a);
  return Math.exp(a * (1.0 - Math.exp(c * (1.0 - qref / qmod))));
}
function dzeta(a, c, qref, qmod) {
  if (qmod < 0.0) return 0.0;
  return -a * c * Math.exp(c * (1.0 - qref / qmod)) * zeta(a, c, qref, qmod) * qref / (qmod * qmod);
}

const elemCache = new Map();
function element(z) {
  let e = elemCache.get(z);
  if (e) return e;
  if (!(z >= 1 && z <= D.maxZ)) throw new Error('D4: no data for Z = ' + z);
  const nref = num(D.refn[z - 1]);
  e = { z, nref, cn: new Float64Array(nref), q: new Float64Array(nref), ngw: new Int32Array(nref), alpha: new Float64Array(nref * 23),
    zeff: num(D.zeff[z - 1]), eta: num(D.eta[z - 1]), en: num(D.en[z - 1]),
    rcov: 4.0 / 3.0 * num(D.covrad[z - 1]) / BOHR, r4r2: Math.sqrt(0.5 * (num(D.r4r2[z - 1]) * Math.sqrt(z))) };
  for (let r = 0; r < nref; r++) { e.cn[r] = num(D.refcovcn[(z - 1) * MREF + r]); e.q[r] = num(D.refq[(z - 1) * MREF + r]); }
  // number of Gaussian weights per reference (set_refgw): references with the same rounded CN get more
  const cnc = new Int32Array(20); cnc[0] = 1;
  const icn = r => Math.min(Math.round(num(D.refcn[(z - 1) * MREF + r])), 19);
  for (let r = 0; r < nref; r++) cnc[icn(r)]++;
  for (let r = 0; r < nref; r++) { const c = cnc[icn(r)]; e.ngw[r] = c * (c + 1) / 2; }
  // reference polarizabilities (set_refalpha_gfn2): the secondary system's hydrogens taken off, scaled
  for (let r = 0; r < nref; r++) {
    const is = num(D.refsys[(z - 1) * MREF + r]);
    if (Math.abs(is) < 1e-12) continue;
    const iz = num(D.zeff[is - 1]), sc = num(D.sscale[is - 1]), zt = zeta(GA, num(D.eta[is - 1]) * GC, iz, num(D.refh[(z - 1) * MREF + r]) + iz);
    const asc = num(D.ascale[(z - 1) * MREF + r]), hc = num(D.hcount[(z - 1) * MREF + r]);
    for (let k = 0; k < 23; k++) {
      const aiw = sc * num(D.secaiw[(is - 1) * 23 + k]) * zt;
      e.alpha[r * 23 + k] = Math.max(asc * (num(D.alphaiw[((z - 1) * MREF + r) * 23 + k]) - hc * aiw), 0.0);
    }
  }
  elemCache.set(z, e);
  return e;
}
// reference C6 of an element pair: c6[ri * nrefj + rj]
const c6Cache = new Map();
function refC6(ei, ej) {
  const key = ei.z * 128 + ej.z;
  let t = c6Cache.get(key);
  if (t) return t;
  t = new Float64Array(ei.nref * ej.nref);
  for (let a = 0; a < ei.nref; a++) for (let b = 0; b < ej.nref; b++) {
    let s = 0; for (let k = 0; k < 23; k++) s += ei.alpha[a * 23 + k] * ej.alpha[b * 23 + k] * TW[k];
    t[a * ej.nref + b] = THOPI * s;
  }
  c6Cache.set(key, t);
  return t;
}

// coordination numbers (erf counting x electronegativity factor) and, for the gradient, every pair's dCN/dr
function d4Setup(Z, X, grad) {
  const n = Z.length, el = Z.map(element);
  const cn = new Float64Array(n), cnd = grad ? new Float64Array(n * n) : null;   // cnd[i*n+j] = d count_ij / dr / r
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) {
    const dx = X[3 * i] - X[3 * j], dy = X[3 * i + 1] - X[3 * j + 1], dz = X[3 * i + 2] - X[3 * j + 2];
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 > CUTCN * CUTCN || r2 < 1e-12) continue;
    const r = Math.sqrt(r2), rc = el[i].rcov + el[j].rcov;
    const den = K4 * Math.exp(-Math.pow(Math.abs(el[i].en - el[j].en) + K5, 2.0) / K6);
    const c = den * 0.5 * (1.0 + erf(-KCN * (r - rc) / rc));
    cn[i] += c; cn[j] += c;
    if (grad) { const ex = KCN * (r - rc) / rc; cnd[i * n + j] = cnd[j * n + i] = den * (-(KCN * Math.exp(-ex * ex)) / (SQRTPI * rc)) / r; }
  }
  // two-body pair factors e_ij = -(s6 t6 + s8 rr t8) and, for the gradient, de_ij/dr / r
  const e2 = new Float64Array(n * n), de2 = grad ? new Float64Array(n * n) : null;
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) {
    const dx = X[3 * i] - X[3 * j], dy = X[3 * i + 1] - X[3 * j + 1], dz = X[3 * i + 2] - X[3 * j + 2];
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 > CUT2 * CUT2 || r2 < 2.220446049250313e-16) continue;
    const rrij = 3 * el[i].r4r2 * el[j].r4r2, r0 = P.a1 * Math.sqrt(rrij) + P.a2;
    const r06 = Math.pow(r0, 6), r08 = Math.pow(r0, 8), r6 = r2 * r2 * r2, r8 = r6 * r2;
    const t6 = 1.0 / (r6 + r06), t8 = 1.0 / (r8 + r08);
    e2[i * n + j] = e2[j * n + i] = -(P.s6 * t6 + P.s8 * rrij * t8);
    if (grad) de2[i * n + j] = de2[j * n + i] = (P.s6 * 6 * r2 * r2 * t6 * t6 + P.s8 * rrij * 8 * r6 * t8 * t8); // d e/dr / r
  }
  return { n, el, X, cn, cnd, e2, de2 };
}
// reference weights with the charges q (weight_references): gw[i*7+r], and their slopes in q and CN
function weights(ctx, q, dq, dcn) {
  const { n, el, cn } = ctx, gw = new Float64Array(n * MREF), gq = dq ? new Float64Array(n * MREF) : null, gc = dcn ? new Float64Array(n * MREF) : null;
  const epsNorm = Math.sqrt(2.2250738585072014e-308);
  for (let i = 0; i < n; i++) {
    const e = el[i], zi = e.zeff, gi = e.eta * GC, qi = q ? q[i] : 0.0;
    let norm = 0, dnorm = 0;
    for (let r = 0; r < e.nref; r++) for (let k = 1; k <= e.ngw[r]; k++) { const wf = k * WF, w = Math.exp(-wf * (cn[i] - e.cn[r]) ** 2); norm += w; dnorm += 2 * wf * (e.cn[r] - cn[i]) * w; }
    norm = Math.abs(norm) > epsNorm ? 1.0 / norm : 0.0;
    let maxcn = -Infinity; for (let r = 0; r < e.nref; r++) maxcn = Math.max(maxcn, e.cn[r]);
    for (let r = 0; r < e.nref; r++) {
      let expw = 0, expd = 0;
      for (let k = 1; k <= e.ngw[r]; k++) { const wf = k * WF, w = Math.exp(-wf * (cn[i] - e.cn[r]) ** 2); expw += w; expd += 2 * wf * (e.cn[r] - cn[i]) * w; }
      let gwk = expw * norm;
      if (!Number.isFinite(gwk) || norm === 0.0) gwk = Math.abs(maxcn - e.cn[r]) < 1e-12 ? 1.0 : 0.0;
      const z = zeta(GA, gi, e.q[r] + zi, qi + zi);
      gw[i * MREF + r] = gwk * z;
      if (gq) gq[i * MREF + r] = gwk * dzeta(GA, gi, e.q[r] + zi, qi + zi);
      if (gc) { let dg = norm * (expd - expw * dnorm * norm); if (!Number.isFinite(dg) || norm === 0.0) dg = 0.0; gc[i * MREF + r] = dg * z; }
    }
  }
  return { gw, gq, gc };
}
// C6_ij = sum gw_i C6ref gw_j (and the same with one side's slope)
function pairC6(ctx, i, j, wi, wj) {
  const ei = ctx.el[i], ej = ctx.el[j], t = refC6(ei, ej);
  let s = 0;
  for (let a = 0; a < ei.nref; a++) { const w = wi[i * MREF + a]; if (w === 0) continue; let v = 0; for (let b = 0; b < ej.nref; b++) v += t[a * ej.nref + b] * wj[j * MREF + b]; s += w * v; }
  return s;
}
function d4Energy2(ctx, q) {
  const { n, e2 } = ctx, { gw } = weights(ctx, q, false, false);
  let E = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) { const e = e2[i * n + j]; if (e) E += e * pairC6(ctx, i, j, gw, gw); }
  return E;
}
function d4Potential(ctx, q, vat) {
  const { n, e2 } = ctx, { gw, gq } = weights(ctx, q, true, false);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { if (i === j) continue; const e = e2[i * n + j]; if (e) vat[i] += e * pairC6(ctx, i, j, gq, gw); }
}
function d4Gradient2(ctx, q, g, dEdcn) {
  const { n, X, e2, de2 } = ctx, { gw, gc } = weights(ctx, q, false, true);
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) {
    const e = e2[i * n + j]; if (!e) continue;
    const c6 = pairC6(ctx, i, j, gw, gw);
    dEdcn[i] += e * pairC6(ctx, i, j, gc, gw);
    dEdcn[j] += e * pairC6(ctx, j, i, gc, gw);
    const f = c6 * de2[i * n + j];                    // dE/dr / r = C6 * d e/dr / r
    for (let k = 0; k < 3; k++) { const v = (X[3 * i + k] - X[3 * j + k]) * f; g[3 * i + k] += v; g[3 * j + k] -= v; }
  }
}
// three-body (ATM) with charge-neutral C6 (get_atm_dispersion_derivs); returns the energy
function d4Three(ctx, g, dEdcn) {
  const { n, el, X } = ctx, grad = !!g, { gw, gc } = weights(ctx, null, false, grad);
  const C6 = new Float64Array(n * n), DC = grad ? new Float64Array(n * n) : null;  // DC[i*n+j] = dC6_ij / dCN_i
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    C6[i * n + j] = C6[j * n + i] = pairC6(ctx, i, j, gw, gw);
    if (grad) { DC[i * n + j] = pairC6(ctx, i, j, gc, gw); DC[j * n + i] = pairC6(ctx, j, i, gc, gw); }
  }
  const cut2 = CUT3 * CUT3, alp3 = P.alp / 3.0, eps = 2.220446049250313e-16;
  let E = 0;
  const vij = [0, 0, 0], vik = [0, 0, 0], vjk = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      const c6ij = C6[j * n + i], r0ij = P.a1 * Math.sqrt(3 * el[j].r4r2 * el[i].r4r2) + P.a2;
      for (let k = 0; k < 3; k++) vij[k] = X[3 * j + k] - X[3 * i + k];
      const r2ij = vij[0] * vij[0] + vij[1] * vij[1] + vij[2] * vij[2];
      if (r2ij > cut2 || r2ij < eps) continue;
      for (let kk = 0; kk < j; kk++) {
        const c6ik = C6[kk * n + i], c6jk = C6[kk * n + j];
        const c9 = -P.s9 * Math.sqrt(Math.abs(c6ij * c6ik * c6jk));
        const r0ik = P.a1 * Math.sqrt(3 * el[kk].r4r2 * el[i].r4r2) + P.a2, r0jk = P.a1 * Math.sqrt(3 * el[kk].r4r2 * el[j].r4r2) + P.a2;
        const r0 = r0ij * r0ik * r0jk;
        for (let k = 0; k < 3; k++) vik[k] = X[3 * kk + k] - X[3 * i + k];
        const r2ik = vik[0] * vik[0] + vik[1] * vik[1] + vik[2] * vik[2];
        if (r2ik > cut2 || r2ik < eps) continue;
        for (let k = 0; k < 3; k++) vjk[k] = vik[k] - vij[k];
        const r2jk = vjk[0] * vjk[0] + vjk[1] * vjk[1] + vjk[2] * vjk[2];
        if (r2jk > cut2 || r2jk < eps) continue;
        const r2 = r2ij * r2ik * r2jk, r1 = Math.sqrt(r2), r3 = r2 * r1, r5 = r3 * r2;
        const fdmp = 1.0 / (1.0 + 6.0 * Math.pow(r0 / r1, alp3));
        const ang = 0.375 * (r2ij + r2jk - r2ik) * (r2ij - r2jk + r2ik) * (-r2ij + r2jk + r2ik) / r5 + 1.0 / r3;
        const dE0 = ang * fdmp * c9;
        E -= dE0;
        if (!grad) continue;
        const dfdmp = -2.0 * P.alp * Math.pow(r0 / r1, alp3) * fdmp * fdmp;
        let dang = -0.375 * (r2ij ** 3 + r2ij ** 2 * (r2jk + r2ik) + r2ij * (3.0 * r2jk ** 2 + 2.0 * r2jk * r2ik + 3.0 * r2ik ** 2) - 5.0 * (r2jk - r2ik) ** 2 * (r2jk + r2ik)) / r5;
        const fij = c9 * (-dang * fdmp + ang * dfdmp) / r2ij;
        dang = -0.375 * (r2ik ** 3 + r2ik ** 2 * (r2jk + r2ij) + r2ik * (3.0 * r2jk ** 2 + 2.0 * r2jk * r2ij + 3.0 * r2ij ** 2) - 5.0 * (r2jk - r2ij) ** 2 * (r2jk + r2ij)) / r5;
        const fik = c9 * (-dang * fdmp + ang * dfdmp) / r2ik;
        dang = -0.375 * (r2jk ** 3 + r2jk ** 2 * (r2ik + r2ij) + r2jk * (3.0 * r2ik ** 2 + 2.0 * r2ik * r2ij + 3.0 * r2ij ** 2) - 5.0 * (r2ik - r2ij) ** 2 * (r2ik + r2ij)) / r5;
        const fjk = c9 * (-dang * fdmp + ang * dfdmp) / r2jk;
        for (let k = 0; k < 3; k++) {
          const gij = fij * vij[k], gik = fik * vik[k], gjk = fjk * vjk[k];
          g[3 * i + k] -= gij + gik; g[3 * j + k] += gij - gjk; g[3 * kk + k] += gik + gjk;
        }
        dEdcn[i] -= dE0 * 0.5 * (DC[i * n + j] / c6ij + DC[i * n + kk] / c6ik);
        dEdcn[j] -= dE0 * 0.5 * (DC[j * n + i] / c6ij + DC[j * n + kk] / c6jk);
        dEdcn[kk] -= dE0 * 0.5 * (DC[kk * n + i] / c6ik + DC[kk * n + j] / c6jk);
      }
    }
  }
  return E;
}
function d4CnGrad(ctx, dEdcn, g) {
  const { n, X, cnd } = ctx;
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) {
    const c = cnd[i * n + j]; if (!c) continue;
    const f = (dEdcn[i] + dEdcn[j]) * c;
    for (let k = 0; k < 3; k++) { const v = (X[3 * i + k] - X[3 * j + k]) * f; g[3 * i + k] += v; g[3 * j + k] -= v; }
  }
}

// erf to double precision (W. J. Cody's rational Chebyshev approximations, as in most libm implementations)
function erf(x) {
  const ax = Math.abs(x);
  if (ax < 0.5) {
    const t = x * x;
    const p = [3.16112374387056560e00, 1.13864154151050156e02, 3.77485237685302021e02, 3.20937758913846947e03, 1.85777706184603153e-1];
    const q = [2.36012909523441209e01, 2.44024637934444173e02, 1.28261652607737228e03, 2.84423683343917062e03];
    let num = p[4] * t, den = t;
    for (let k = 0; k < 3; k++) { num = (num + p[k]) * t; den = (den + q[k]) * t; }
    return x * (num + p[3]) / (den + q[3]);
  }
  return x > 0 ? 1 - erfcPos(ax) : erfcPos(ax) - 1;
}
function erfcPos(x) {
  let r;
  if (x <= 4.0) {
    const c = [5.64188496988670089e-1, 8.88314979438837594e00, 6.61191906371416295e01, 2.98635138197400131e02, 8.81952221241769090e02, 1.71204761263407058e03, 2.05107837782607147e03, 1.23033935479799725e03, 2.15311535474403846e-8];
    const d = [1.57449261107098347e01, 1.17693950891312499e02, 5.37181101862009858e02, 1.62138957456669019e03, 3.29079923573345963e03, 4.36261909014324716e03, 3.43936767414372164e03, 1.23033935480374942e03];
    let num = c[8] * x, den = x;
    for (let k = 0; k < 7; k++) { num = (num + c[k]) * x; den = (den + d[k]) * x; }
    r = (num + c[7]) / (den + d[7]);
  } else {
    const p = [3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1, 1.60837851487422766e-2, 6.58749161529837803e-4, 1.63153871373020978e-2];
    const q = [2.56852019228982242e00, 1.87295284992346725e00, 5.27905102951428412e-1, 6.05183413124413191e-2, 2.33520497626869185e-3];
    const z = 1 / (x * x);
    let num = p[5] * z, den = z;
    for (let k = 0; k < 4; k++) { num = (num + p[k]) * z; den = (den + q[k]) * z; }
    r = z * (num + p[4]) / (den + q[4]);
    r = (1 / Math.sqrt(Math.PI) - r) / x;
  }
  const xs = Math.trunc(x * 16) / 16, del = (x - xs) * (x + xs);
  return Math.exp(-xs * xs) * Math.exp(-del) * r;
}

module.exports = { d4Setup, d4Energy2, d4Potential, d4Gradient2, d4Three, d4CnGrad, D4_PARAM: P, _internal: { element, refC6, weights, erf } };
