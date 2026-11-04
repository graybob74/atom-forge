'use strict';
// Grimme's D3 dispersion with Becke-Johnson (rational) damping: energy and analytic gradient, in plain JavaScript.
//
// A port of simple-dftd3 (s-dftd3, LGPL-3.0-or-later): src/dftd3/model.f90 (reference weights, C6 interpolation),
// ncoord.f90 + mctc-lib's exponential coordination number, damping/rational.f90 (the two-body term). Same units
// inside as s-dftd3: Bohr and Hartree. Input in Å, output in eV and eV/Å. Molecules only (no periodic cells), no
// three-body (ATM) term. Tables: d3-data.js (elements 1..86), written by d3-gen.js from the Fortran sources.
//
// d3Disp(Z, xyz, opts) -> { E, g, cn }
//   Z: atomic numbers; xyz: [[x, y, z], ...] in Å.
//   E: dispersion energy in eV; g: [[dE/dx, dE/dy, dE/dz], ...] in eV/Å; cn: D3 coordination numbers.
//   opts: { s6, s8, a1, a2 (Bohr), s9, cutoff (Bohr, two-body), cnCutoff (Bohr), grad (default true) };
//   defaults are GFN1-xTB's: s6 = 1, s8 = 2.4, a1 = 0.63, a2 = 5.0, s9 = 0, and s-dftd3's cutoffs 60 and 40 Bohr.

const D = require('./d3-data.js');

// CODATA 2018, as tblite/s-dftd3 and tools/xtb-ref/ref.py use them.
const BOHR = 0.529177210903, EH = 27.211386245988;
const KCN = 16.0, WF = 4.0; // steepness of the CN counting function; width of the Gaussian reference weights
const GFN1 = { s6: 1.0, s8: 2.4, a1: 0.63, a2: 5.0, s9: 0.0, cutoff: 60.0, cnCutoff: 40.0 };

// Per-element constants in atomic units, and where each element pair's C6 block starts in D.c6.
const RCOV = D.rcov.map(r => 4.0 / 3.0 * r / BOHR);
const R4R2 = D.r4r2.map((v, i) => Math.sqrt(0.5 * (v * Math.sqrt(i + 1))));
const PAIR = []; // PAIR[zi][zj] (zi >= zj, 1-based) -> offset into D.c6
for (let zi = 1, off = 0; zi <= D.maxZ; zi++) {
  PAIR[zi] = [];
  for (let zj = 1; zj <= zi; zj++) { PAIR[zi][zj] = off; off += D.nref[zi - 1] * D.nref[zj - 1]; }
}

function d3Disp(Z, xyz, opts) {
  const p = Object.assign({}, GFN1, opts || {});
  if (p.s9 !== 0) throw new Error('d3Disp: the three-body term (s9 != 0) is not implemented');
  const wantGrad = p.grad !== false;
  const n = Z.length;
  for (const z of Z) if (!(z >= 1 && z <= D.maxZ)) throw new Error('d3Disp: no D3 data for Z = ' + z);
  const X = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) X[3 * i + k] = xyz[i][k] / BOHR;

  // 1. Coordination numbers: a smooth count of neighbours, 1 / (1 + exp(-16 (Rcov_ij / r - 1))).
  const cn = new Float64Array(n), cnc2 = p.cnCutoff * p.cnCutoff;
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) {
    const dx = X[3 * i] - X[3 * j], dy = X[3 * i + 1] - X[3 * j + 1], dz = X[3 * i + 2] - X[3 * j + 2];
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 > cnc2 || r2 < 1e-12) continue;
    const r = Math.sqrt(r2), rc = RCOV[Z[i] - 1] + RCOV[Z[j] - 1];
    const c = 1.0 / (1.0 + Math.exp(-KCN * (rc / r - 1.0)));
    cn[i] += c; cn[j] += c;
  }

  // 2. Gaussian weights of each atom's reference systems by how close their CN is to the atom's, and d(weight)/dCN.
  const gw = [], dgw = [];
  for (let i = 0; i < n; i++) {
    const rc = D.refcn[Z[i] - 1], m = rc.length, w = new Float64Array(m), dw = new Float64Array(m);
    let dmin = Infinity;
    for (let r = 0; r < m; r++) { const d = rc[r] - cn[i]; dmin = Math.min(dmin, d * d); }
    let norm = 0;
    for (let r = 0; r < m; r++) { const d = rc[r] - cn[i]; w[r] = Math.exp(-WF * (d * d - dmin)); norm += w[r]; }
    let mean = 0;
    for (let r = 0; r < m; r++) { w[r] /= norm; mean += w[r] * 2 * WF * (rc[r] - cn[i]); }
    for (let r = 0; r < m; r++) dw[r] = w[r] * (2 * WF * (rc[r] - cn[i]) - mean);
    gw.push(w); dgw.push(dw);
  }

  // 3. Pair energy with the interpolated C6 and C8 = 3 C6 sqrt(Qi Qj) (Q from <r4>/<r2>), BJ-damped:
  //    E = -sum C6 (s6 / (r^6 + R0^6) + s8 * 3 Qi Qj / (r^8 + R0^8)),  R0 = a1 sqrt(3 Qi Qj) + a2.
  let E = 0;
  const G = new Float64Array(3 * n), dEdcn = new Float64Array(n), cut2 = p.cutoff * p.cutoff;
  for (let i = 0; i < n; i++) {
    const zi = Z[i];
    for (let j = 0; j < i; j++) {
      const dx = X[3 * i] - X[3 * j], dy = X[3 * i + 1] - X[3 * j + 1], dz = X[3 * i + 2] - X[3 * j + 2];
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 > cut2 || r2 < 2.220446049250313e-16) continue;
      // C6 of the pair and its derivatives with respect to each atom's CN.
      const zj = Z[j], big = zi >= zj, za = big ? zi : zj, zb = big ? zj : zi;
      const wa = big ? gw[i] : gw[j], wb = big ? gw[j] : gw[i], da = big ? dgw[i] : dgw[j], db = big ? dgw[j] : dgw[i];
      const na = wa.length, nb = wb.length, off = PAIR[za][zb];
      let c6 = 0, dc6a = 0, dc6b = 0;
      for (let b = 0; b < nb; b++) for (let a = 0; a < na; a++) {
        const c = D.c6[off + a + na * b];
        c6 += wa[a] * wb[b] * c; dc6a += da[a] * wb[b] * c; dc6b += wa[a] * db[b] * c;
      }
      const dc6i = big ? dc6a : dc6b, dc6j = big ? dc6b : dc6a;
      const rr = 3 * R4R2[zi - 1] * R4R2[zj - 1], r0 = p.a1 * Math.sqrt(rr) + p.a2;
      const r06 = r0 * r0 * r0 * r0 * r0 * r0, r08 = r06 * r0 * r0;
      const r4 = r2 * r2, t6 = 1 / (r4 * r2 + r06), t8 = 1 / (r4 * r4 + r08);
      const ed = p.s6 * t6 + p.s8 * rr * t8; // energy per unit C6 (with the sign flipped)
      E -= c6 * ed;
      if (!wantGrad) continue;
      // (1/r) d(ed)/dr, so that the Cartesian gradient is that times the separation vector.
      const gd = p.s6 * (-6 * r4 * t6 * t6) + p.s8 * rr * (-8 * r4 * r2 * t8 * t8);
      const f = -c6 * gd;
      G[3 * i] += f * dx; G[3 * i + 1] += f * dy; G[3 * i + 2] += f * dz;
      G[3 * j] -= f * dx; G[3 * j + 1] -= f * dy; G[3 * j + 2] -= f * dz;
      dEdcn[i] -= dc6i * ed; dEdcn[j] -= dc6j * ed;
    }
  }

  // 4. The energy also moves through the CNs: chain rule through the counting function.
  if (wantGrad) for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) {
    const dx = X[3 * i] - X[3 * j], dy = X[3 * i + 1] - X[3 * j + 1], dz = X[3 * i + 2] - X[3 * j + 2];
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 > cnc2 || r2 < 1e-12) continue;
    const r = Math.sqrt(r2), rc = RCOV[Z[i] - 1] + RCOV[Z[j] - 1];
    const c = 1.0 / (1.0 + Math.exp(-KCN * (rc / r - 1.0)));
    const f = -c * (1 - c) * KCN * rc / r2 / r * (dEdcn[i] + dEdcn[j]);
    G[3 * i] += f * dx; G[3 * i + 1] += f * dy; G[3 * i + 2] += f * dz;
    G[3 * j] -= f * dx; G[3 * j + 1] -= f * dy; G[3 * j + 2] -= f * dz;
  }

  const g = [], s = EH / BOHR;
  for (let i = 0; i < n; i++) g.push([G[3 * i] * s, G[3 * i + 1] * s, G[3 * i + 2] * s]);
  return { E: E * EH, g, cn: Array.from(cn) };
}

module.exports = { d3Disp, GFN1_D3: GFN1 };
