'use strict';
// GFN2-xTB (Bannwarth, Ehlert, Grimme, J. Chem. Theory Comput. 15, 1652 (2019)): energy, charges and analytic gradient,
// in plain JavaScript (1.26).
//
// A port of the reference implementation tblite (LGPL-3.0-or-later): src/tblite/xtb/gfn2.f90 (the parameters and
// what each term is), xtb/h0.f90 (the Hamiltonian and its gradient), integral/native/integrals.f90 (overlap, dipole
// and quadrupole integrals), coulomb/charge/effective.f90 (second order, arithmetic mean of the shell hardnesses),
// coulomb/thirdorder.f90 (shell-resolved third order), coulomb/multipole.f90 (the anisotropic electrostatics: atomic
// dipoles and quadrupoles, damped, with their exchange-correlation kernels), repulsion/effective.f90, scf/ (the
// potentials in the Hamiltonian, the mixer over charges, dipoles and quadrupoles), xtb/singlepoint.f90; with mctc-lib's
// double-exponential coordination number; the self-consistent D4 dispersion in d4.js. Units inside: Bohr and Hartree.
// Tables: gfn2-data.js (written by gfn2-gen.js from gfn2.f90); the STO-nG expansions, radii and electronegativities are
// gfn1.js's (the same tblite / mctc-lib tables).
//
// gfn2Energy(Z, xyz, charge = 0, uhf = 0, opts) -> { E, q, qsh, guess, iterations, converged, g, bonds, ... }
//   as gfn1Energy, but E (eV) includes the D4 dispersion (it is part of the self-consistency). opts: { accuracy, kt,
//   grad, bonds, maxIter, vext (Hartree per unit charge at each atom: an outside potential, E_ext = sum q_A v_A),
//   qsh0 (a start: shell charges, or the whole state of an earlier call, out.guess) }.
// Not ported: periodic systems, solvation, spin polarization (restricted open shell as tblite does it).

const G1 = require('./gfn1.js')._shared;
const D2 = require('./gfn2-data.js');
const D4 = require('./d4.js');
const SPIN = require('./spin.js');                    // (spin polarization, 1.26)
const { T, DTRAFO, CART, symEig, choleskyInverse, Broyden, fermiFilling, entropyTerm, integralCutoff, KT_DEFAULT, EVTOAU, AATOAU, MAX_ITER, MIX_DAMP, ECONV, PCONV, MAX_CUTOFF, DFACT, TOP } = G1;
const AUTOEV = 27.211386245988, BOHR = 0.529177210903;
const num = x => +x;
const GP = Object.fromEntries(Object.entries(D2.G).map(([k, v]) => [k, +v]));
const KDIAG = [1.85, 2.23, 2.23];
const kshell = (k, l) => ((k === 2 && (l === 0 || l === 1)) || (l === 2 && (k === 0 || k === 1))) ? 2.0 : (KDIAG[l] + KDIAG[k]) / 2;
const SH3 = [1.0, 0.5, 0.25];                 // shell-resolved third order: s, p, d
const CN_KA = 10.0, CN_KB = 20.0, CN_SHIFT = 2.0, CN_CUTOFF = 25.0, REP_CUTOFF = 25.0;
const MPSCALE = [1, 2, 1, 2, 2, 1];           // quadrupole components xx xy yy xz yz zz: the off-diagonal ones twice

// ---- STO-nG, expansion "gfn2" (basis/slater.f90: the 4sp/5sp shared-exponent sets are GFN1's only) ----
function slaterToGauss2(ng, n, l, zeta) {
  if ((n > 5 || n <= l) && !(n === 6 && ng === 6)) throw new Error('STO-nG: principal quantum number not supported');
  const ityp = l === 0 ? n : l === 1 ? 4 + n : l === 2 ? 7 + n : l === 3 ? 9 + n : 10 + n;
  const z2 = zeta * zeta;
  let a, c;
  const tab = (A, C, K) => { a = []; c = []; for (let k = 0; k < K; k++) { a.push(num(A[(ityp - 1) * K + k]) * z2); c.push(num(C[(ityp - 1) * K + k])); } };
  if (ng === 1) { a = [num(T.pAlpha1[ityp - 1]) * z2]; c = [1]; }
  else if (ng === 2) tab(T.pAlpha2, T.pCoeff2, 2);
  else if (ng === 3) tab(T.pAlpha3, T.pCoeff3, 3);
  else if (ng === 4) tab(T.pAlpha4, T.pCoeff4, 4);
  else if (ng === 5) tab(T.pAlpha5, T.pCoeff5, 5);
  else if (ng === 6) {
    if (n === 6) {
      if (l === 0) { a = T.pAlpha6s.map(x => num(x) * z2); c = T.pCoeff6s.map(num); }
      else if (l === 1) { a = T.pAlpha6p.map(x => num(x) * z2); c = T.pCoeff6p.map(num); }
      else throw new Error('STO-6G: 6d not supported');
    } else tab(T.pAlpha6, T.pCoeff6, 6);
  } else throw new Error('STO-nG: ng must be 1..6');
  for (let k = 0; k < ng; k++) c[k] = c[k] * Math.pow(TOP * a[k], 0.75) * Math.pow(Math.sqrt(4 * a[k]), l) / Math.sqrt(DFACT[l]);
  return { l, alpha: Float64Array.from(a), coeff: Float64Array.from(c) };
}

// ---- multipole integrals over contracted Gaussians ----
// For a shell on atom i (bra) and one on atom j (ket), vec = R_i - R_j: the overlap, the dipole and the Cartesian
// second moments about R_i, <i|(r - R_i)^p|j> for the ten powers p below, and with grad their slopes in R_i (the
// orbital and the origin moving together). Spherical blocks nI x nJ, row-major, in BLK[c] (c = power) and DBLK[m][c].
const PX = [0, 1, 0, 0, 2, 1, 0, 1, 0, 0], PY = [0, 0, 1, 0, 0, 1, 2, 0, 1, 0], PZ = [0, 0, 0, 1, 0, 0, 0, 1, 1, 2];
const CXa = CART.map(l => Int32Array.from(l, c => c[0])), CYa = CART.map(l => Int32Array.from(l, c => c[1])), CZa = CART.map(l => Int32Array.from(l, c => c[2]));
const MS = 8;                                         // stride of the 1D moment tables (powers up to 5 on i, 2 on j)
const T1 = [new Float64Array(MS * MS), new Float64Array(MS * MS), new Float64Array(MS * MS)];
const D1 = [new Float64Array(MS * MS), new Float64Array(MS * MS), new Float64Array(MS * MS)];
const CB = Array.from({ length: 40 }, () => new Float64Array(36));   // Cartesian accumulators: 10 values, 30 slopes
const BLK = Array.from({ length: 10 }, () => new Float64Array(25)), DBLK = [0, 1, 2].map(() => Array.from({ length: 10 }, () => new Float64Array(25)));
const TMP = new Float64Array(36);
function mom1d(li, lj, rpi, rpj, h, t) {             // as gfn1.js moments1d, stride MS
  t[0] = 1;
  if (li >= 1) { t[MS] = rpi; for (let i = 1; i < li; i++) t[(i + 1) * MS] = rpi * t[i * MS] + i * h * t[(i - 1) * MS]; }
  if (lj >= 1) {
    t[1] = rpj;
    for (let i = 1; i <= li; i++) t[i * MS + 1] = rpj * t[i * MS] + i * h * t[(i - 1) * MS];
    for (let j = 1; j < lj; j++) {
      t[j + 1] = rpj * t[j] + j * h * t[j - 1];
      for (let i = 1; i <= li; i++) t[i * MS + j + 1] = rpj * t[i * MS + j] + h * (i * t[(i - 1) * MS + j] + j * t[i * MS + j - 1]);
    }
  }
}
function toSph(li, lj, src, dst) {                   // Cartesian nci x ncj -> spherical (d functions only change)
  const nci = CART[li].length, ncj = CART[lj].length;
  let m = src, ncol = ncj;
  if (lj === 2) {
    for (let a = 0; a < nci; a++) for (let s = 0; s < 5; s++) { let v = 0; for (let c = 0; c < 6; c++) v += DTRAFO[c][s] * m[a * 6 + c]; TMP[a * 5 + s] = v; }
    m = TMP; ncol = 5;
  }
  if (li === 2) {
    for (let s = 0; s < 5; s++) for (let b = 0; b < ncol; b++) { let v = 0; for (let c = 0; c < 6; c++) v += DTRAFO[c][s] * m[c * ncol + b]; dst[s * ncol + b] = v; }
    return;
  }
  const n = nci * ncol; for (let k = 0; k < n; k++) dst[k] = m[k];
}
function shellBlocks(ci, cj, v0, v1, v2, r2, intcut, grad) {
  const li = ci.l, lj = cj.l, xI = CXa[li], yI = CYa[li], zI = CZa[li], xJ = CXa[lj], yJ = CYa[lj], zJ = CZa[lj];
  const nI = xI.length, nJ = xJ.length, nn = nI * nJ, ncomp = grad ? 40 : 10, LI = li + 2 + (grad ? 1 : 0);
  for (let c = 0; c < ncomp; c++) CB[c].fill(0, 0, nn);
  const [TX, TY, TZ] = T1, [DX, DY, DZ] = D1;
  for (let p = 0; p < ci.alpha.length; p++) {
    const ai = ci.alpha[p], a2 = 2 * ai;
    for (let q = 0; q < cj.alpha.length; q++) {
      const aj = cj.alpha[q], oab = 1 / (ai + aj), est = ai * aj * r2 * oab;
      if (est > intcut) continue;
      const cc = ci.coeff[p] * cj.coeff[q] * Math.exp(-est) * Math.sqrt(Math.PI * oab) ** 3, h = 0.5 * oab;
      mom1d(LI, lj, -v0 * aj * oab, v0 * ai * oab, h, TX);
      mom1d(LI, lj, -v1 * aj * oab, v1 * ai * oab, h, TY);
      mom1d(LI, lj, -v2 * aj * oab, v2 * ai * oab, h, TZ);
      if (grad) for (let k = 0; k < 3; k++) {
        const t = T1[k], d = D1[k];
        for (let a = 0; a <= li + 2; a++) for (let b = 0; b <= lj; b++) d[a * MS + b] = a2 * t[(a + 1) * MS + b] - (a ? a * t[(a - 1) * MS + b] : 0);
      }
      for (let a = 0; a < nI; a++) {
        const ax = xI[a], ay = yI[a], az = zI[a];
        for (let b = 0; b < nJ; b++) {
          const bx = xJ[b], by = yJ[b], bz = zJ[b], ab = a * nJ + b;
          for (let c = 0; c < 10; c++) {
            const ix = (ax + PX[c]) * MS + bx, iy = (ay + PY[c]) * MS + by, iz = (az + PZ[c]) * MS + bz;
            const tx = TX[ix], ty = TY[iy], tz = TZ[iz];
            CB[c][ab] += cc * tx * ty * tz;
            if (grad) { CB[10 + c][ab] += cc * DX[ix] * ty * tz; CB[20 + c][ab] += cc * tx * DY[iy] * tz; CB[30 + c][ab] += cc * tx * ty * DZ[iz]; }
          }
        }
      }
    }
  }
  for (let c = 0; c < 10; c++) toSph(li, lj, CB[c], BLK[c]);
  if (grad) for (let m = 0; m < 3; m++) for (let c = 0; c < 10; c++) toSph(li, lj, CB[10 + 10 * m + c], DBLK[m][c]);
}
// traceless quadrupole (tblite's): 1.5 * second moment, less half the trace on the diagonal
function traceless(q, out, o) {
  const tr = 0.5 * (q[0] + q[2] + q[5]);
  out[o] = 1.5 * q[0] - tr; out[o + 1] = 1.5 * q[1]; out[o + 2] = 1.5 * q[2] - tr;
  out[o + 3] = 1.5 * q[3]; out[o + 4] = 1.5 * q[4]; out[o + 5] = 1.5 * q[5] - tr;
}

// ---- per-element parameters, built once ----
const elemCache = new Map();
function element(z) {
  let e = elemCache.get(z);
  if (e) return e;
  if (!(z >= 1 && z <= 86)) throw new Error('GFN2-xTB: element Z=' + z + ' not supported (1..86)');
  const nsh = num(D2.nshell[z - 1]), shells = [];
  for (let ish = 0; ish < nsh; ish++) {
    const k = (z - 1) * 3 + ish, l = num(D2.ang_shell[k]), kl = (z - 1) * 3 + l;
    shells.push({
      l, zeta: num(D2.slater_exponent[k]),
      cg: slaterToGauss2(num(D2.number_of_primitives[k]), num(D2.principal_quantum_number[k]), l, num(D2.slater_exponent[k])),
      level: num(D2.p_selfenergy[k]) * EVTOAU, kcn: num(D2.p_kcn[kl]) * EVTOAU, shpoly: num(D2.p_shpoly[kl]) * 0.01,
      refocc: num(D2.reference_occ[kl]), hubbard: num(D2.hubbard_parameter[z - 1]) * (1.0 + num(D2.shell_hubbard[kl])),
      gam3: num(D2.p_hubbard_derivs[z - 1]) * 0.1 * SH3[l],
    });
  }
  e = {
    z, shells, nao: shells.reduce((n, s) => n + 2 * s.l + 1, 0),
    repAlpha: num(D2.rep_alpha[z - 1]), repZeff: num(D2.rep_zeff[z - 1]),
    rcov: 4.0 / 3.0 * num(T.covalent_rad_2009[z - 1]) * AATOAU, rad: num(T.atomic_rad[z - 1]) * AATOAU, en: num(T.pauling_en[z - 1]),
    dk: num(D2.p_dkernel[z - 1]) * 0.01, qk: num(D2.p_qkernel[z - 1]) * 0.01, vcn: num(D2.p_vcn[z - 1]), mprad: num(D2.p_rad[z - 1]),
    minAlpha: Math.min(...shells.map(s => Math.min(...s.cg.alpha))),
  };
  // onsite blocks (vec = 0): S, dipole and traceless quadrupole about the atom, for every ordered shell pair a, b
  e.onsite = [];
  for (let a = 0; a < nsh; a++) for (let b = 0; b < nsh; b++) {
    shellBlocks(shells[a].cg, shells[b].cg, 0, 0, 0, 0, 25, false);
    const nn = (2 * shells[a].l + 1) * (2 * shells[b].l + 1), blk = { s: new Float64Array(nn), d: new Float64Array(3 * nn), q: new Float64Array(6 * nn) };
    const q6 = new Float64Array(6);
    for (let k = 0; k < nn; k++) {
      blk.s[k] = BLK[0][k]; for (let c = 0; c < 3; c++) blk.d[3 * k + c] = BLK[1 + c][k];
      for (let c = 0; c < 6; c++) q6[c] = BLK[4 + c][k]; traceless(q6, blk.q, 6 * k);
    }
    e.onsite[a * nsh + b] = blk;
  }
  elemCache.set(z, e);
  return e;
}
// a parameter set over the base (opts.par, 1.26; as gfn1.js elementP: dlev, kcn, shp, hub, g3 (each shell's third
// order), ra, rz per element, the pair H0 scaling per "zi-zj")
const parElem = new Map();
function elementP(z, par) {
  if (!par) return element(z);
  const key = par.id + ':' + z;
  let e = parElem.get(key);
  if (e) return e;
  if (parElem.size > 256) { parElem.clear(); for (const k of hscaleCache.keys()) if (k >= 16384) hscaleCache.delete(k); }
  const b = element(z), o = (par.el && par.el[z]) || {};
  e = Object.assign({}, b, { par, pk: (par.id % 1e6) + 1 });
  e.shells = b.shells.map((sh, k) => Object.assign({}, sh, {
    level: sh.level + (o.dlev ? (o.dlev[k] || 0) * EVTOAU : 0), kcn: sh.kcn * (1 + (o.kcn ? o.kcn[k] || 0 : 0)),
    shpoly: sh.shpoly + (o.shp ? (o.shp[k] || 0) * 0.01 : 0), hubbard: sh.hubbard * (1 + (o.hub || 0)), gam3: sh.gam3 * (1 + (o.g3 || 0)) }));
  e.repAlpha = b.repAlpha * (1 + (o.ra || 0)); e.repZeff = b.repZeff * (1 + (o.rz || 0));
  parElem.set(key, e);
  return e;
}
const pairScale = (ei, ej) => { const P = ei.par && ei.par.pair; if (!P) return 1; const a = Math.min(ei.z, ej.z), b = Math.max(ei.z, ej.z); return 1 + (P[a + '-' + b] || 0); };
const hscaleCache = new Map();
function hscaleTable(ei, ej) {                        // get_hscale: zij (Slater exponents) x kshell x (1 + enscale dEN^2)
  const key = ei.z * 128 + ej.z + (ei.pk ? ei.pk * 16384 : 0);
  let t = hscaleCache.get(key);
  if (t) return t;
  t = new Float64Array(ei.shells.length * ej.shells.length);
  const den = (ei.en - ej.en) ** 2;
  for (let a = 0; a < ei.shells.length; a++) for (let b = 0; b < ej.shells.length; b++) {
    const zi = ei.shells[a].zeta, zj = ej.shells[b].zeta;
    const zij = Math.pow(2 * Math.sqrt(zi * zj) / (zi + zj), GP.wexp);
    t[a * ej.shells.length + b] = zij * kshell(ej.shells[b].l, ei.shells[a].l) * (1.0 + GP.enscale * den) * (ei.par ? pairScale(ei, ej) : 1);
  }
  hscaleCache.set(key, t);
  return t;
}

// ---- the calculation ----
function gfn2Energy(Z, xyzA, charge = 0, uhf = 0, opts = {}) {
  const nat = Z.length;
  const kt = opts.kt !== undefined ? opts.kt : KT_DEFAULT;
  const acc = opts.accuracy !== undefined ? opts.accuracy : 1.0;
  const intcut = integralCutoff(acc), grad = !!opts.grad;
  const X = new Float64Array(3 * nat);
  for (let i = 0; i < nat; i++) { const p = xyzA[i]; X[3 * i] = p[0] * AATOAU; X[3 * i + 1] = p[1] * AATOAU; X[3 * i + 2] = p[2] * AATOAU; }
  const el = opts.par ? Z.map(z => elementP(z, opts.par)) : Z.map(element);

  // basis layout
  const shAt = [], shOf = [], shAo = [], shN = [], atSh = [], atAo = [];
  let nsh = 0, nao = 0;
  for (let i = 0; i < nat; i++) {
    atSh.push(nsh); atAo.push(nao);
    el[i].shells.forEach((s, k) => { shAt.push(i); shOf.push(k); shAo.push(nao); shN.push(2 * s.l + 1); nao += 2 * s.l + 1; nsh++; });
  }
  atSh.push(nsh); atAo.push(nao);
  const aoAt = new Int32Array(nao), aoSh = new Int32Array(nao);
  for (let s = 0; s < nsh; s++) for (let k = 0; k < shN[s]; k++) { aoAt[shAo[s] + k] = shAt[s]; aoSh[shAo[s] + k] = s; }

  // occupation
  const n0sh = new Float64Array(nsh), n0at = new Float64Array(nat);
  for (let s = 0; s < nsh; s++) { n0sh[s] = el[shAt[s]].shells[shOf[s]].refocc; n0at[shAt[s]] += n0sh[s]; }
  const nocc = n0at.reduce((a, b) => a + b, 0) - charge;
  let nuhf;
  if (uhf % 2 === Math.round(nocc) % 2) nuhf = uhf;
  else if (uhf !== 0) throw new Error('number of electrons and unpaired electrons do not match');
  else nuhf = Math.round(nocc) % 2;
  const diff = Math.min(nuhf, nocc), ntmp = nocc - diff, nel = [ntmp / 2 + diff, ntmp / 2];
  const dist2 = (i, j) => (X[3 * i] - X[3 * j]) ** 2 + (X[3 * i + 1] - X[3 * j + 1]) ** 2 + (X[3 * i + 2] - X[3 * j + 2]) ** 2;

  // repulsion (exponent 1 between H/He pairs, 1.5 otherwise)
  let erep = 0;
  const repK = (i, j) => (Z[i] > 2 || Z[j] > 2) ? GP.rep_kexp : GP.rep_kexp_light;
  for (let i = 0; i < nat; i++) for (let j = 0; j < i; j++) {
    const r2 = dist2(i, j);
    if (r2 > REP_CUTOFF ** 2 || r2 < 1e-12) continue;
    const r = Math.sqrt(r2);
    erep += el[i].repZeff * el[j].repZeff * Math.exp(-Math.sqrt(el[i].repAlpha * el[j].repAlpha) * Math.pow(r, repK(i, j))) / Math.pow(r, GP.rep_rexp);
  }

  // coordination numbers (double exponential: mctc-lib's "dexp", for the levels and the multipole radii)
  const cn = new Float64Array(nat), cnd = grad ? new Float64Array(nat * nat) : null;
  for (let i = 0; i < nat; i++) for (let j = 0; j < i; j++) {
    const r2 = dist2(i, j);
    if (r2 > CN_CUTOFF ** 2 || r2 < 1e-12) continue;
    const r = Math.sqrt(r2), rc = el[i].rcov + el[j].rcov;
    const ea = Math.exp(-CN_KA * (rc / r - 1.0)), eb = Math.exp(-CN_KB * ((rc + CN_SHIFT) / r - 1.0));
    const ca = 1.0 / (1.0 + ea), cb = 1.0 / (1.0 + eb), c = ca * cb;
    cn[i] += c; cn[j] += c;
    if (grad) {
      const da = (-CN_KA * rc * ea) / (r2 * (ea + 1.0) ** 2), db = (-CN_KB * (rc + CN_SHIFT) * eb) / (r2 * (eb + 1.0) ** 2);
      cnd[i * nat + j] = cnd[j * nat + i] = (da * cb + ca * db) / r;  // d count / dr / r
    }
  }
  const selfE = new Float64Array(nsh);
  for (let s = 0; s < nsh; s++) { const p = el[shAt[s]].shells[shOf[s]]; selfE[s] = p.level - p.kcn * cn[shAt[s]]; }

  // multipole radii (get_mrad) and the damped multipole kernels of every atom pair
  const mrad = new Float64Array(nat), dmrdcn = new Float64Array(nat);
  for (let i = 0; i < nat; i++) {
    const e = el[i], arg = cn[i] - e.vcn - GP.mp_shift, t1 = Math.exp(-GP.mp_kexp * arg), t2 = (GP.mp_rmax - e.mprad) / (1.0 + t1);
    mrad[i] = e.mprad + t2; dmrdcn[i] = t2 * GP.mp_kexp * t1 / (1.0 + t1); // (tblite keeps the opposite sign here and in its dE/drad)
  }
  // per ordered pair a != b, v = R_b - R_a: h3 = f3 / r^3, h5 = f5 / r^5 (f: 1 / (1 + 6 (rho / r)^k), rho the mean radius)
  const H3 = new Float64Array(nat * nat), H5 = new Float64Array(nat * nat);
  for (let a = 0; a < nat; a++) for (let b = 0; b < a; b++) {
    const r = Math.sqrt(dist2(a, b)), g1 = 1 / r, g3 = g1 * g1 * g1, g5 = g3 * g1 * g1, rr = 0.5 * (mrad[a] + mrad[b]) * g1;
    H3[a * nat + b] = H3[b * nat + a] = g3 / (1.0 + 6.0 * Math.pow(rr, GP.mp_dmp3));
    H5[a * nat + b] = H5[b * nat + a] = g5 / (1.0 + 6.0 * Math.pow(rr, GP.mp_dmp5));
  }

  // integrals: S, H0, and the dipole and traceless quadrupole about each column's atom, DC[k][col * nao + row] =
  // <row| (r - R_atom(col))_k |col>, QC likewise (xx xy yy xz yz zz)
  const S = new Float64Array(nao * nao), H0 = new Float64Array(nao * nao);
  const DC = [0, 1, 2].map(() => new Float64Array(nao * nao)), QC = [0, 1, 2, 3, 4, 5].map(() => new Float64Array(nao * nao));
  let minAlpha = Infinity; for (const e of el) minAlpha = Math.min(minAlpha, e.minAlpha);
  const cutoff = Math.min(Math.sqrt(2 * intcut / minAlpha), MAX_CUTOFF);
  const q6 = new Float64Array(6), qt = new Float64Array(6);
  for (let i = 0; i < nat; i++) {
    const ei = el[i], nshi = ei.shells.length;
    for (let a = atSh[i]; a < atSh[i + 1]; a++) for (let b = atSh[i]; b < atSh[i + 1]; b++) {
      const blk = ei.onsite[shOf[a] * nshi + shOf[b]], hij = 0.5 * (selfE[a] + selfE[b]), na = shN[a], nb = shN[b];
      for (let x = 0; x < na; x++) for (let y = 0; y < nb; y++) {
        const mu = shAo[a] + x, nu = shAo[b] + y, k = x * nb + y;    // <mu|O|nu>, both on i
        S[mu * nao + nu] = blk.s[k]; H0[mu * nao + nu] = blk.s[k] * hij;
        for (let c = 0; c < 3; c++) DC[c][nu * nao + mu] = blk.d[3 * k + c];
        for (let c = 0; c < 6; c++) QC[c][nu * nao + mu] = blk.q[6 * k + c];
      }
    }
    for (let j = 0; j < i; j++) {
      const ej = el[j], nshj = ej.shells.length;
      const v0 = X[3 * i] - X[3 * j], v1 = X[3 * i + 1] - X[3 * j + 1], v2 = X[3 * i + 2] - X[3 * j + 2];
      const r2 = v0 * v0 + v1 * v1 + v2 * v2;
      if (r2 < Number.EPSILON || r2 > cutoff * cutoff) continue;
      const rr = Math.sqrt(Math.sqrt(r2) / (ei.rad + ej.rad)), hsT = hscaleTable(ei, ej);
      for (let a = atSh[i]; a < atSh[i + 1]; a++) {
        const pa = ei.shells[shOf[a]];
        for (let b = atSh[j]; b < atSh[j + 1]; b++) {
          const pb = ej.shells[shOf[b]];
          shellBlocks(pa.cg, pb.cg, v0, v1, v2, r2, intcut, false);
          const hij = 0.5 * (selfE[a] + selfE[b]) * hsT[shOf[a] * nshj + shOf[b]] * (1 + pa.shpoly * rr) * (1 + pb.shpoly * rr);
          const na = shN[a], nb = shN[b];
          for (let x = 0; x < na; x++) for (let y = 0; y < nb; y++) {
            const mu = shAo[a] + x, nu = shAo[b] + y, k = x * nb + y, sv = BLK[0][k];
            S[mu * nao + nu] = sv; S[nu * nao + mu] = sv; H0[mu * nao + nu] = sv * hij; H0[nu * nao + mu] = sv * hij;
            const d0 = BLK[1][k], d1 = BLK[2][k], d2 = BLK[3][k];
            // about R_i (mu's atom): column mu; about R_j: shifted by v = R_i - R_j, column nu
            DC[0][mu * nao + nu] = d0; DC[1][mu * nao + nu] = d1; DC[2][mu * nao + nu] = d2;
            DC[0][nu * nao + mu] = d0 + v0 * sv; DC[1][nu * nao + mu] = d1 + v1 * sv; DC[2][nu * nao + mu] = d2 + v2 * sv;
            for (let c = 0; c < 6; c++) q6[c] = BLK[4 + c][k];
            traceless(q6, qt, 0); for (let c = 0; c < 6; c++) QC[c][mu * nao + nu] = qt[c];
            q6[0] += 2 * v0 * d0 + v0 * v0 * sv; q6[1] += v0 * d1 + v1 * d0 + v0 * v1 * sv; q6[2] += 2 * v1 * d1 + v1 * v1 * sv;
            q6[3] += v0 * d2 + v2 * d0 + v0 * v2 * sv; q6[4] += v1 * d2 + v2 * d1 + v1 * v2 * sv; q6[5] += 2 * v2 * d2 + v2 * v2 * sv;
            traceless(q6, qt, 0); for (let c = 0; c < 6; c++) QC[c][nu * nao + mu] = qt[c];
          }
        }
      }
    }
  }

  // second order: shell pairs, gamma = 1 / sqrt(R^2 + eta^-2), eta the arithmetic mean of the two shells' hardness
  const J = new Float64Array(nsh * nsh), gm2 = new Float64Array(nsh * nsh), gam3 = new Float64Array(nsh);
  for (let a = 0; a < nsh; a++) {
    gam3[a] = el[shAt[a]].shells[shOf[a]].gam3;
    for (let b = 0; b <= a; b++) {
      const gam = 0.5 * (el[shAt[a]].shells[shOf[a]].hubbard + el[shAt[b]].shells[shOf[b]].hubbard);
      let v = gam;
      if (shAt[a] !== shAt[b]) { const e2 = Math.pow(gam, -GP.gexp); gm2[a * nsh + b] = e2; v = 1 / Math.pow(dist2(shAt[a], shAt[b]) + e2, 0.5); }
      J[a * nsh + b] = v; J[b * nsh + a] = v;
    }
  }
  // dispersion: D4, its coordination numbers and pair factors; the three-body part with neutral charges
  const disp = D4.d4Setup(Z, X, grad);
  const gd = grad ? new Float64Array(3 * nat) : null, dEdcnD = grad ? new Float64Array(nat) : null;
  const edisp3 = D4.d4Three(disp, gd, dEdcnD);

  // the SCC
  const Li = choleskyInverse(S, nao), LiT = new Float64Array(nao * nao);
  for (let m = 0; m < nao; m++) for (let k = m; k < nao; k++) LiT[m * nao + k] = Li[k * nao + m];
  const H1 = new Float64Array(nao * nao), W = new Float64Array(nao * nao), P = new Float64Array(nao * nao), A = new Float64Array(nao * nao), Ct = new Float64Array(nao * nao);
  const ndim = nsh + 9 * nat, R2 = Math.SQRT2;
  let qsh = new Float64Array(nsh), dp = new Float64Array(3 * nat), qp = new Float64Array(6 * nat);
  for (let s = 0; s < nsh; s++) qsh[s] = (n0sh[s] / n0at[shAt[s]]) * (charge / nat);
  if (opts.qsh0 && opts.qsh0.length === nsh) for (let s = 0; s < nsh; s++) qsh[s] = opts.qsh0[s];
  if (opts.qsh0 && opts.qsh0.length === ndim) {
    for (let s = 0; s < nsh; s++) qsh[s] = opts.qsh0[s];
    for (let k = 0; k < 3 * nat; k++) dp[k] = opts.qsh0[nsh + k];
    for (let k = 0; k < 6 * nat; k++) qp[k] = opts.qsh0[nsh + 3 * nat + k];
  }
  const pack = (q, d, t, out) => { out.set(q, 0); out.set(d, nsh); for (let k = 0; k < 6 * nat; k++) out[nsh + 3 * nat + k] = t[k] * (MPSCALE[k % 6] === 2 ? R2 : 1); return out; };
  const unpack = (v) => { for (let s = 0; s < nsh; s++) qsh[s] = v[s]; for (let k = 0; k < 3 * nat; k++) dp[k] = v[nsh + k]; for (let k = 0; k < 6 * nat; k++) qp[k] = v[nsh + 3 * nat + k] / (MPSCALE[k % 6] === 2 ? R2 : 1); };
  const vext = opts.vext || null;
  const qatOf = q => { const r = new Float64Array(nat); for (let s = 0; s < nsh; s++) r[shAt[s]] += q[s]; return r; };
  let qat = qatOf(qsh);
  const maxIter = opts.maxIter > 0 ? Math.min(MAX_ITER, opts.maxIter) : MAX_ITER;
  const sp = !!opts.spin;                              // (spin polarization, 1.26: two channels, spinSCC below)
  // (opts.anneal {kt0, hold, cycles}: the electrons start hotter and cool to kt, as tblite's newer annealing: kt0 for the
  // first `hold` iterations, then down in a straight line over `cycles`; settled only at kt. Atom Forge xTB's SCC aid, 1.26)
  const AN = opts.anneal || null;
  const ktAt = (it) => !AN ? kt : it < AN.hold ? AN.kt0 : it < AN.hold + AN.cycles ? AN.kt0 + (it - AN.hold + 1) / AN.cycles * (kt - AN.kt0) : kt;
  const mixer = new Broyden(sp ? 2 * ndim : ndim, opts.mix && opts.mix.memory || maxIter, opts.mix && opts.mix.damp || MIX_DAMP, opts.mix || null), mv = new Float64Array(ndim);
  const vsh = new Float64Array(nsh), vat = new Float64Array(nat), vao = new Float64Array(nao), vdp = new Float64Array(3 * nat), vqp = new Float64Array(6 * nat);
  const wq = new Float64Array(nao * nao);
  let iscf = 0, converged = false, eelec = 0, eext = 0, emo = null, focc = null, parts = null;
  // the multipole energy with moments q, dp, qp (get_energy: charge-dipole, half dipole-dipole, charge-quadrupole, kernels)
  const aesEnergy = (q, d, t) => {
    let e = 0;
    for (let a = 0; a < nat; a++) {
      const ax = X[3 * a], ay = X[3 * a + 1], az = X[3 * a + 2], da = 3 * a, ta = 6 * a;
      for (let b = 0; b < nat; b++) {
        if (a === b) continue;
        const x = X[3 * b] - ax, y = X[3 * b + 1] - ay, z = X[3 * b + 2] - az, h3 = H3[a * nat + b], h5 = H5[a * nat + b], db = 3 * b;
        e += q[b] * h3 * (d[da] * x + d[da + 1] * y + d[da + 2] * z);
        const r2 = x * x + y * y + z * z, mv_ = d[da] * x + d[da + 1] * y + d[da + 2] * z, mw = d[db] * x + d[db + 1] * y + d[db + 2] * z;
        e += 0.5 * h5 * ((d[da] * d[db] + d[da + 1] * d[db + 1] + d[da + 2] * d[db + 2]) * r2 - 3 * mv_ * mw);
        e += q[b] * h5 * (t[ta] * x * x + 2 * t[ta + 1] * x * y + t[ta + 2] * y * y + 2 * t[ta + 3] * x * z + 2 * t[ta + 4] * y * z + t[ta + 5] * z * z);
      }
      const e_ = el[a];
      e += e_.dk * (d[da] ** 2 + d[da + 1] ** 2 + d[da + 2] ** 2);
      e += e_.qk * (t[ta] ** 2 + 2 * t[ta + 1] ** 2 + t[ta + 2] ** 2 + 2 * t[ta + 3] ** 2 + 2 * t[ta + 4] ** 2 + t[ta + 5] ** 2);
    }
    return e;
  };
  // the potentials from the input charges and moments (the charge channel): vsh, vat, vdp, vqp, then vao, and wq,
  // the multipole part of H1 (as the loop below)
  const chargePotentials = () => {
    for (let a = 0; a < nsh; a++) { let v = 0; for (let b = 0; b < nsh; b++) v += J[a * nsh + b] * qsh[b]; vsh[a] = v + qsh[a] * qsh[a] * gam3[a]; }
    vat.fill(0); vdp.fill(0); vqp.fill(0);
    for (let a = 0; a < nat; a++) {
      const ax = X[3 * a], ay = X[3 * a + 1], az = X[3 * a + 2], da = 3 * a, ta = 6 * a;
      for (let b = 0; b < nat; b++) {
        if (a === b) continue;
        const x = X[3 * b] - ax, y = X[3 * b + 1] - ay, z = X[3 * b + 2] - az, h3 = H3[a * nat + b], h5 = H5[a * nat + b], db = 3 * b, tb = 6 * b;
        vat[a] += -h3 * (dp[db] * x + dp[db + 1] * y + dp[db + 2] * z)
          + h5 * (qp[tb] * x * x + 2 * qp[tb + 1] * x * y + qp[tb + 2] * y * y + 2 * qp[tb + 3] * x * z + 2 * qp[tb + 4] * y * z + qp[tb + 5] * z * z);
        const r2 = x * x + y * y + z * z, mw = dp[db] * x + dp[db + 1] * y + dp[db + 2] * z;
        vdp[da] += qat[b] * h3 * x + h5 * (dp[db] * r2 - 3 * x * mw);
        vdp[da + 1] += qat[b] * h3 * y + h5 * (dp[db + 1] * r2 - 3 * y * mw);
        vdp[da + 2] += qat[b] * h3 * z + h5 * (dp[db + 2] * r2 - 3 * z * mw);
        const qb = qat[b] * h5;
        vqp[ta] += qb * x * x; vqp[ta + 1] += qb * 2 * x * y; vqp[ta + 2] += qb * y * y;
        vqp[ta + 3] += qb * 2 * x * z; vqp[ta + 4] += qb * 2 * y * z; vqp[ta + 5] += qb * z * z;
      }
      const e = el[a];
      for (let c = 0; c < 3; c++) vdp[da + c] += 2 * e.dk * dp[da + c];
      for (let c = 0; c < 6; c++) vqp[ta + c] += 2 * e.qk * qp[ta + c] * MPSCALE[c];
      if (vext) vat[a] += vext[a];
    }
    D4.d4Potential(disp, qat, vat);
    for (let m = 0; m < nao; m++) vao[m] = vsh[aoSh[m]] + vat[aoAt[m]];
    for (let n = 0; n < nao; n++) {
      const B = aoAt[n], o = n * nao, d0 = vdp[3 * B], d1 = vdp[3 * B + 1], d2 = vdp[3 * B + 2];
      const t0 = vqp[6 * B], t1 = vqp[6 * B + 1], t2 = vqp[6 * B + 2], t3 = vqp[6 * B + 3], t4 = vqp[6 * B + 4], t5 = vqp[6 * B + 5];
      for (let m = 0; m < nao; m++) wq[o + m] = DC[0][o + m] * d0 + DC[1][o + m] * d1 + DC[2][o + m] * d2
        + QC[0][o + m] * t0 + QC[1][o + m] * t1 + QC[2][o + m] * t2 + QC[3][o + m] * t3 + QC[4][o + m] * t4 + QC[5][o + m] * t5;
    }
  };
  // Mulliken populations of a density: per shell (P S), dipoles and quadrupoles per atom (P D, P Q), into qn/dn/tn
  // (negative: electrons), and the band energy sum H0 P
  const populations = (P, qn, dn, tn) => {
    let eband = 0;
    for (let n = 0; n < nao; n++) {
      const o = n * nao, B = aoAt[n];
      let ps = 0, s0 = 0, s1 = 0, s2 = 0, u0 = 0, u1 = 0, u2 = 0, u3 = 0, u4 = 0, u5 = 0;
      for (let m = 0; m < nao; m++) {
        const p = P[o + m];
        ps += p * S[o + m]; eband += H0[o + m] * p;
        s0 += p * DC[0][o + m]; s1 += p * DC[1][o + m]; s2 += p * DC[2][o + m];
        u0 += p * QC[0][o + m]; u1 += p * QC[1][o + m]; u2 += p * QC[2][o + m]; u3 += p * QC[3][o + m]; u4 += p * QC[4][o + m]; u5 += p * QC[5][o + m];
      }
      qn[aoSh[n]] -= ps;
      dn[3 * B] -= s0; dn[3 * B + 1] -= s1; dn[3 * B + 2] -= s2;
      tn[6 * B] -= u0; tn[6 * B + 1] -= u1; tn[6 * B + 2] -= u2; tn[6 * B + 3] -= u3; tn[6 * B + 4] -= u4; tn[6 * B + 5] -= u5;
    }
    return eband;
  };
  // the SCC with spin polarization (1.26; tblite with a spin-polarization container, nspin = 2): the state is the
  // charge channel (shell charges, atomic dipoles and quadrupoles) and the magnetization channel (the same moments of
  // N_beta - N_alpha), mixed as one vector in tblite's order [q, m, dp, dp_m, qp, qp_m]; only the shell
  // magnetizations act (the on-site spin term), H_alpha = H_c + H_m and H_beta = H_c - H_m, H_m = -1/2 S (v_m + v_m)
  let SPN = null, out_probe = null;
  function spinSCC() {
    const w = SPIN.spinTable(Z, i => el[i].shells, atSh, shAt, nsh, opts.spin === true ? 1 : +opts.spin);
    let msh = new Float64Array(nsh), dm = new Float64Array(3 * nat), tm = new Float64Array(6 * nat);
    const g0 = opts.qsh0;
    if (g0 && g0.length === 2 * ndim) {
      for (let s = 0; s < nsh; s++) { qsh[s] = g0[s]; msh[s] = g0[nsh + s]; }
      for (let k = 0; k < 3 * nat; k++) { dp[k] = g0[2 * nsh + k]; dm[k] = g0[2 * nsh + 3 * nat + k]; }
      for (let k = 0; k < 6 * nat; k++) { qp[k] = g0[2 * nsh + 6 * nat + k]; tm[k] = g0[2 * nsh + 12 * nat + k]; }
    } else if (opts.m0 && opts.m0.length === nsh) msh = Float64Array.from(opts.m0);
    qat = qatOf(qsh);
    const N2 = 2 * ndim, vec = new Float64Array(N2);
    const packS = (q, m, d, dM, t, tM, out) => {
      out.set(q, 0); out.set(m, nsh); out.set(d, 2 * nsh); out.set(dM, 2 * nsh + 3 * nat);
      const o1 = 2 * nsh + 6 * nat, o2 = o1 + 6 * nat;
      for (let k = 0; k < 6 * nat; k++) { const f = MPSCALE[k % 6] === 2 ? R2 : 1; out[o1 + k] = t[k] * f; out[o2 + k] = tM[k] * f; }
      return out;
    };
    const unpackS = (v) => {
      for (let s = 0; s < nsh; s++) { qsh[s] = v[s]; msh[s] = v[nsh + s]; }
      for (let k = 0; k < 3 * nat; k++) { dp[k] = v[2 * nsh + k]; dm[k] = v[2 * nsh + 3 * nat + k]; }
      const o1 = 2 * nsh + 6 * nat, o2 = o1 + 6 * nat;
      for (let k = 0; k < 6 * nat; k++) { const f = MPSCALE[k % 6] === 2 ? R2 : 1; qp[k] = v[o1 + k] / f; tm[k] = v[o2 + k] / f; }
    };
    const vm = new Float64Array(nsh), vaoM = new Float64Array(nao), Ha = new Float64Array(nao * nao), Hb = new Float64Array(nao * nao);
    const Wa = new Float64Array(nao * nao), Wb = new Float64Array(nao * nao), Aa = new Float64Array(nao * nao), Ab = new Float64Array(nao * nao);
    const Pa = new Float64Array(nao * nao), Pb = new Float64Array(nao * nao), Pm = new Float64Array(nao * nao);
    let ea = null, eb = null, fa = null, fb = null, espin = 0, probing = false;
    const PR = opts.probe && opts.spinFree ? { v: opts.probe.length === nsh ? opts.probe : SPIN.defaultProbe(shAt, nsh) } : null;
    while (!converged && iscf < maxIter) {
      const elast = eelec;
      if (iscf > 0) { mixer.next(); unpackS(mixer.q); qat = qatOf(qsh); }
      iscf++;
      chargePotentials();
      // (the stability probe, 1.26: with no magnetization at all, the potential of a tiny one along PR.v, and how much
      // the electrons answer along it; the state itself stays unpolarized)
      probing = !!PR && msh.every(v => v === 0);
      if (probing) { const mp = new Float64Array(nsh); for (let s = 0; s < nsh; s++) mp[s] = SPIN.PROBE_EPS * PR.v[s]; SPIN.spinPot(w, atSh, shAt, nsh, mp, vm); }
      else SPIN.spinPot(w, atSh, shAt, nsh, msh, vm);
      for (let m = 0; m < nao; m++) vaoM[m] = vm[aoSh[m]];
      for (let m = 0; m < nao; m++) for (let n = 0; n < nao; n++) {
        const k = m * nao + n, hc = H0[k] - 0.5 * S[k] * (vao[m] + vao[n]) - 0.5 * (wq[n * nao + m] + wq[k]), hm = -0.5 * S[k] * (vaoM[m] + vaoM[n]);
        Ha[k] = hc + hm; Hb[k] = hc - hm;
      }
      mixer.set(packS(qsh, msh, dp, dm, qp, tm, vec));
      ea = SPIN.solveChannel(symEig, Ha, Li, nao, Wa, Aa); eb = SPIN.solveChannel(symEig, Hb, Li, nao, Wb, Ab);
      const ktn = ktAt(iscf - 1);
      if (opts.spinFree) [fa, fb] = SPIN.fermiShared(fermiFilling, nocc, ktn, ea, eb);
      else { fa = fermiFilling(nel[0], ktn, ea); fb = fermiFilling(nel[1], ktn, eb); }
      SPIN.channelDensity(Wa, Aa, LiT, fa, nao, Ct, Pa); SPIN.channelDensity(Wb, Ab, LiT, fb, nao, Ct, Pb);
      for (let k = 0; k < nao * nao; k++) { P[k] = Pa[k] + Pb[k]; Pm[k] = Pa[k] - Pb[k]; }
      const qn = new Float64Array(nsh), dn = new Float64Array(3 * nat), tn = new Float64Array(6 * nat);
      const mn = new Float64Array(nsh), dmn = new Float64Array(3 * nat), tmn = new Float64Array(6 * nat);
      const eband = populations(P, qn, dn, tn);
      populations(Pm, mn, dmn, tmn);                  // (-(alpha - beta): N_beta - N_alpha, tblite's sign)
      for (let s = 0; s < nsh; s++) qn[s] += n0sh[s];
      if (probing) { out_probe = SPIN.probeResult(PR.v, Float64Array.from(mn)); PR.v = out_probe.v; // (a power iteration: each iteration turns the pattern toward the most unstable one)
        mn.fill(0); dmn.fill(0); tmn.fill(0); }
      qsh = qn; dp = dn; qp = tn; qat = qatOf(qsh); msh = mn; dm = dmn; tm = tmn;
      mixer.diff(packS(qsh, msh, dp, dm, qp, tm, new Float64Array(N2)));
      let e2 = 0;
      for (let a = 0; a < nsh; a++) { let v = 0; for (let b = 0; b < nsh; b++) v += J[a * nsh + b] * qsh[b]; e2 += 0.5 * v * qsh[a]; }
      let e3 = 0; for (let a = 0; a < nsh; a++) e3 += qsh[a] ** 3 * gam3[a] / 3;
      const eaes = aesEnergy(qat, dp, qp), ed2 = D4.d4Energy2(disp, qat);
      let ex = 0; if (vext) for (let i = 0; i < nat; i++) ex += qat[i] * vext[i];
      espin = SPIN.spinPot(w, atSh, shAt, nsh, msh, new Float64Array(nsh));
      const ts = entropyTerm(fa, ktn) + entropyTerm(fb, ktn);
      eelec = eband + e2 + e3 + eaes + ed2 + espin + ts + ex; eext = ex;
      parts = { eband, e2, e3, eaes, ed2, espin, ts };
      converged = Math.abs(eelec - elast) < ECONV * acc && mixer.error() < PCONV * acc && ktn <= kt;
      if (opts.verbose) console.log(iscf, (eelec + erep + edisp3).toFixed(10), (eelec - elast).toExponential(3), mixer.error().toExponential(3));
    }
    emo = ea; focc = fa;
    if (!probing) out_probe = null;
    return { msh, dm, tm, vaoM, Pa, Pb, Pm, Wa, Wb, ea, eb, fa, fb, espin };
  }
  if (sp) SPN = spinSCC();
  if (!sp) while (!converged && iscf < maxIter) {
    const elast = eelec;
    if (iscf > 0) { mixer.next(); unpack(mixer.q); qat = qatOf(qsh); }
    iscf++;
    // potentials from the input moments
    for (let a = 0; a < nsh; a++) { let v = 0; for (let b = 0; b < nsh; b++) v += J[a * nsh + b] * qsh[b]; vsh[a] = v + qsh[a] * qsh[a] * gam3[a]; }
    vat.fill(0); vdp.fill(0); vqp.fill(0);
    for (let a = 0; a < nat; a++) {
      const ax = X[3 * a], ay = X[3 * a + 1], az = X[3 * a + 2], da = 3 * a, ta = 6 * a;
      for (let b = 0; b < nat; b++) {
        if (a === b) continue;
        const x = X[3 * b] - ax, y = X[3 * b + 1] - ay, z = X[3 * b + 2] - az, h3 = H3[a * nat + b], h5 = H5[a * nat + b], db = 3 * b, tb = 6 * b;
        // the charge on a meets b's dipole and quadrupole (v from b to a is -v)
        vat[a] += -h3 * (dp[db] * x + dp[db + 1] * y + dp[db + 2] * z)
          + h5 * (qp[tb] * x * x + 2 * qp[tb + 1] * x * y + qp[tb + 2] * y * y + 2 * qp[tb + 3] * x * z + 2 * qp[tb + 4] * y * z + qp[tb + 5] * z * z);
        // a's dipole meets b's charge and dipole; a's quadrupole meets b's charge
        const r2 = x * x + y * y + z * z, mw = dp[db] * x + dp[db + 1] * y + dp[db + 2] * z;
        vdp[da] += qat[b] * h3 * x + h5 * (dp[db] * r2 - 3 * x * mw);
        vdp[da + 1] += qat[b] * h3 * y + h5 * (dp[db + 1] * r2 - 3 * y * mw);
        vdp[da + 2] += qat[b] * h3 * z + h5 * (dp[db + 2] * r2 - 3 * z * mw);
        const qb = qat[b] * h5;
        vqp[ta] += qb * x * x; vqp[ta + 1] += qb * 2 * x * y; vqp[ta + 2] += qb * y * y;
        vqp[ta + 3] += qb * 2 * x * z; vqp[ta + 4] += qb * 2 * y * z; vqp[ta + 5] += qb * z * z;
      }
      const e = el[a];
      for (let c = 0; c < 3; c++) vdp[da + c] += 2 * e.dk * dp[da + c];
      for (let c = 0; c < 6; c++) vqp[ta + c] += 2 * e.qk * qp[ta + c] * MPSCALE[c];
      if (vext) vat[a] += vext[a];
    }
    D4.d4Potential(disp, qat, vat);
    for (let m = 0; m < nao; m++) vao[m] = vsh[aoSh[m]] + vat[aoAt[m]];
    // H1 = H0 - 1/2 S (v_m + v_n) - 1/2 (D_mn . vdp(n's atom) + D_nm . vdp(m's atom)) - 1/2 (the same with Q)
    for (let n = 0; n < nao; n++) {
      const B = aoAt[n], o = n * nao, d0 = vdp[3 * B], d1 = vdp[3 * B + 1], d2 = vdp[3 * B + 2];
      const t0 = vqp[6 * B], t1 = vqp[6 * B + 1], t2 = vqp[6 * B + 2], t3 = vqp[6 * B + 3], t4 = vqp[6 * B + 4], t5 = vqp[6 * B + 5];
      for (let m = 0; m < nao; m++) wq[o + m] = DC[0][o + m] * d0 + DC[1][o + m] * d1 + DC[2][o + m] * d2
        + QC[0][o + m] * t0 + QC[1][o + m] * t1 + QC[2][o + m] * t2 + QC[3][o + m] * t3 + QC[4][o + m] * t4 + QC[5][o + m] * t5;
    }
    for (let m = 0; m < nao; m++) for (let n = 0; n < nao; n++)
      H1[m * nao + n] = H0[m * nao + n] - 0.5 * S[m * nao + n] * (vao[m] + vao[n]) - 0.5 * (wq[n * nao + m] + wq[m * nao + n]);
    mixer.set(pack(qsh, dp, qp, mv));
    // solve H1 C = S C e (as gfn1.js)
    for (let m = 0; m < nao; m++) {
      const wm = m * nao;
      for (let n = 0; n <= m; n++) { const hn = n * nao; let v = 0; for (let k = 0; k <= m; k++) v += Li[wm + k] * H1[hn + k]; W[wm + n] = v; }
    }
    for (let m = 0; m < nao; m++) for (let n = 0; n <= m; n++) {
      let v = 0; for (let k = 0; k <= n; k++) v += W[m * nao + k] * Li[n * nao + k];
      A[m * nao + n] = v; A[n * nao + m] = v;
    }
    emo = symEig(A, nao, true);
    const ktn = AN ? ktAt(iscf - 1) : kt;
    const fa = fermiFilling(nel[0], ktn, emo), fb = fermiFilling(nel[1], ktn, emo);
    focc = new Float64Array(nao);
    for (let k = 0; k < nao; k++) focc[k] = fa[k] + fb[k];
    const C = W;
    let ncol = 0; for (let k = 0; k < nao; k++) if (focc[k] !== 0) ncol = k + 1;
    for (let m = 0; m < nao; m++) {
      const cm = m * nao;
      for (let n = 0; n < ncol; n++) { const yn = n * nao; let v = 0; for (let k = m; k < nao; k++) v += LiT[cm + k] * A[yn + k]; C[cm + n] = v; }
      for (let n = ncol; n < nao; n++) C[cm + n] = 0;
    }
    const ts = entropyTerm(fa, ktn) + entropyTerm(fb, ktn);
    {
      let nk = 0; for (let k = 0; k < nao; k++) if (focc[k] > 1e-15) nk = k + 1;
      const Cf = Ct;
      for (let m = 0; m < nao; m++) for (let k = 0; k < nk; k++) Cf[m * nao + k] = focc[k] > 1e-15 ? C[m * nao + k] * focc[k] : 0;
      for (let m = 0; m < nao; m++) {
        const pm = m * nao;
        for (let n = m; n < nao; n++) { const cn_ = n * nao; let v = 0; for (let k = 0; k < nk; k++) v += Cf[pm + k] * C[cn_ + k]; P[pm + n] = v; P[cn_ + m] = v; }
      }
    }
    // output moments: Mulliken shell charges, atomic dipoles and quadrupoles; band energy
    const qn = new Float64Array(nsh), dn = new Float64Array(3 * nat), tn = new Float64Array(6 * nat);
    let eband = 0;
    for (let n = 0; n < nao; n++) {
      const o = n * nao, B = aoAt[n];
      let ps = 0, s0 = 0, s1 = 0, s2 = 0, u0 = 0, u1 = 0, u2 = 0, u3 = 0, u4 = 0, u5 = 0;
      for (let m = 0; m < nao; m++) {
        const p = P[o + m];
        ps += p * S[o + m]; eband += H0[o + m] * p;
        s0 += p * DC[0][o + m]; s1 += p * DC[1][o + m]; s2 += p * DC[2][o + m];
        u0 += p * QC[0][o + m]; u1 += p * QC[1][o + m]; u2 += p * QC[2][o + m]; u3 += p * QC[3][o + m]; u4 += p * QC[4][o + m]; u5 += p * QC[5][o + m];
      }
      qn[aoSh[n]] -= ps;
      dn[3 * B] -= s0; dn[3 * B + 1] -= s1; dn[3 * B + 2] -= s2;
      tn[6 * B] -= u0; tn[6 * B + 1] -= u1; tn[6 * B + 2] -= u2; tn[6 * B + 3] -= u3; tn[6 * B + 4] -= u4; tn[6 * B + 5] -= u5;
    }
    for (let s = 0; s < nsh; s++) qn[s] += n0sh[s];
    qsh = qn; dp = dn; qp = tn; qat = qatOf(qsh);
    mixer.diff(pack(qsh, dp, qp, new Float64Array(ndim)));
    // energy with the output moments
    let e2 = 0;
    for (let a = 0; a < nsh; a++) { let v = 0; for (let b = 0; b < nsh; b++) v += J[a * nsh + b] * qsh[b]; e2 += 0.5 * v * qsh[a]; }
    let e3 = 0; for (let a = 0; a < nsh; a++) e3 += qsh[a] ** 3 * gam3[a] / 3;
    const eaes = aesEnergy(qat, dp, qp), ed2 = D4.d4Energy2(disp, qat);
    let ex = 0; if (vext) for (let i = 0; i < nat; i++) ex += qat[i] * vext[i];
    eelec = eband + e2 + e3 + eaes + ed2 + ts + ex; eext = ex;
    parts = { eband, e2, e3, eaes, ed2, ts };
    converged = Math.abs(eelec - elast) < ECONV * acc && mixer.error() < PCONV * acc && ktn <= kt;
    if (opts.verbose) console.log(iscf, (eelec + erep + edisp3).toFixed(10), (eelec - elast).toExponential(3), mixer.error().toExponential(3));
  }
  const Eh = erep + eelec + edisp3;
  const out = {
    E: Eh * AUTOEV, q: Array.from(qat), iterations: iscf, converged,
    qsh: Array.from(qsh), guess: [...qsh, ...dp, ...qp], dp: Array.from(dp), qp: Array.from(qp), // (guess: the whole state, a start for the next call)
    cn: Array.from(cn), Erep: erep * AUTOEV, Eelec: eelec * AUTOEV, Edisp: (parts.ed2 + edisp3) * AUTOEV, Eext: eext * AUTOEV,
    emo: Array.from(emo, x => x * AUTOEV), focc: Array.from(focc),
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v * AUTOEV])),
  };
  if (SPN) {                                          // (spin polarization, 1.26; spin: N_alpha - N_beta per atom)
    const m = SPN.msh, mat = new Float64Array(nat);
    for (let s = 0; s < nsh; s++) mat[shAt[s]] -= m[s];
    Object.assign(out, { probe: out_probe, msh: Array.from(m), spin: Array.from(mat), guess: [...qsh, ...m, ...dp, ...SPN.dm, ...qp, ...SPN.tm], Espin: SPN.espin * AUTOEV,
      emoB: Array.from(SPN.eb, x => x * AUTOEV), foccB: Array.from(SPN.fb), nAlpha: SPN.fa.reduce((a, b) => a + b, 0), nBeta: SPN.fb.reduce((a, b) => a + b, 0) });
  }
  if (opts.bonds && SPN) out.bonds = SPIN.mayerSpin(SPN.Pa, SPN.Pb, S, aoAt, nat, nao);
  else if (opts.bonds) {                                   // Mayer bond orders, as gfn1.js
    const B = new Float64Array(nat * nat);
    for (let m = 0; m < nao; m++) for (let n = 0; n < m; n++) {
      const a = aoAt[m], b = aoAt[n]; if (a === b) continue;
      const rm = m * nao, rn = n * nao;
      let pmn = 0, pnm = 0;
      for (let k = 0; k < nao; k++) { pmn += P[rm + k] * S[rn + k]; pnm += P[rn + k] * S[rm + k]; }
      const v = pmn * pnm; B[a * nat + b] += v; B[b * nat + a] += v;
    }
    out.bonds = B;
  }

  // ---- analytic gradient (as tblite's singlepoint: the explicit terms with the output moments, and through the
  // integrals the density, the energy-weighted density and the last iteration's potentials) ----
  if (grad) {
    const g = gd;                                     // starts with the three-body dispersion's
    const dEdcn = new Float64Array(nat);              // through the GFN coordination numbers (levels, multipole radii)
    const C = W;
    const Wd = new Float64Array(nao * nao), ck = new Float64Array(nao);
    if (SPN) { SPIN.addWDensity(SPN.Wa, SPN.fa, SPN.ea, nao, Wd); SPIN.addWDensity(SPN.Wb, SPN.fb, SPN.eb, nao, Wd); } // (both channels, 1.26)
    for (let k = 0; k < (SPN ? 0 : nao); k++) {
      const fe = focc[k] * emo[k];
      if (fe === 0) continue;
      for (let m = 0; m < nao; m++) ck[m] = C[m * nao + k];
      for (let m = 1; m < nao; m++) { const cm = ck[m] * fe; if (cm === 0) continue; const wm = m * nao; for (let n = 0; n < m; n++) Wd[wm + n] += cm * ck[n]; }
    }
    const addPair = (i, j, f0, f1, f2) => { g[3 * i] += f0; g[3 * j] -= f0; g[3 * i + 1] += f1; g[3 * j + 1] -= f1; g[3 * i + 2] += f2; g[3 * j + 2] -= f2; };
    // repulsion
    for (let i = 0; i < nat; i++) for (let j = 0; j < i; j++) {
      const v0 = X[3 * i] - X[3 * j], v1 = X[3 * i + 1] - X[3 * j + 1], v2 = X[3 * i + 2] - X[3 * j + 2], r2 = v0 * v0 + v1 * v1 + v2 * v2;
      if (r2 > REP_CUTOFF ** 2 || r2 < 1e-12) continue;
      const r = Math.sqrt(r2), a = Math.sqrt(el[i].repAlpha * el[j].repAlpha), k = repK(i, j);
      const e = el[i].repZeff * el[j].repZeff * Math.exp(-a * Math.pow(r, k)) / Math.pow(r, GP.rep_rexp);
      const f = -e * (a * k * Math.pow(r, k - 1) + GP.rep_rexp / r) / r;
      addPair(i, j, f * v0, f * v1, f * v2);
    }
    // second order with the output shell charges
    for (let a = 0; a < nsh; a++) for (let b = 0; b < a; b++) {
      const i = shAt[a], j = shAt[b]; if (i === j) continue;
      const v0 = X[3 * i] - X[3 * j], v1 = X[3 * i + 1] - X[3 * j + 1], v2 = X[3 * i + 2] - X[3 * j + 2];
      const f = -qsh[a] * qsh[b] * Math.pow(v0 * v0 + v1 * v1 + v2 * v2 + gm2[a * nsh + b], -1.5);
      addPair(i, j, f * v0, f * v1, f * v2);
    }
    // anisotropic electrostatics with the output moments: each pair once, v = R_b - R_a; and through the radii
    const dEdrad = new Float64Array(nat);
    for (let a = 0; a < nat; a++) for (let b = 0; b < a; b++) {
      const x = X[3 * b] - X[3 * a], y = X[3 * b + 1] - X[3 * a + 1], z = X[3 * b + 2] - X[3 * a + 2];
      const r2 = x * x + y * y + z * z, r = Math.sqrt(r2), rho = 0.5 * (mrad[a] + mrad[b]);
      const u3 = Math.pow(rho / r, GP.mp_dmp3), u5 = Math.pow(rho / r, GP.mp_dmp5), f3 = 1 / (1 + 6 * u3), f5 = 1 / (1 + 6 * u5);
      const h3 = f3 / (r2 * r), h5 = f5 / (r2 * r2 * r);
      // dh/dr and dh/drho
      const df3r = 6 * GP.mp_dmp3 * f3 * f3 * u3 / r, df5r = 6 * GP.mp_dmp5 * f5 * f5 * u5 / r;
      const dh3r = df3r / (r2 * r) - 3 * h3 / r, dh5r = df5r / (r2 * r2 * r) - 5 * h5 / r;
      const dh3p = -6 * GP.mp_dmp3 * f3 * f3 * u3 / rho / (r2 * r), dh5p = -6 * GP.mp_dmp5 * f5 * f5 * u5 / rho / (r2 * r2 * r);
      const da = 3 * a, db = 3 * b, ta = 6 * a, tb = 6 * b, qa = qat[a], qb = qat[b];
      const mav = dp[da] * x + dp[da + 1] * y + dp[da + 2] * z, mbv = dp[db] * x + dp[db + 1] * y + dp[db + 2] * z;
      const mab = dp[da] * dp[db] + dp[da + 1] * dp[db + 1] + dp[da + 2] * dp[db + 2];
      const Tv = (t, o) => [t[o] * x + t[o + 1] * y + t[o + 3] * z, t[o + 1] * x + t[o + 2] * y + t[o + 4] * z, t[o + 3] * x + t[o + 4] * y + t[o + 5] * z];
      const TA = Tv(qp, ta), TB = Tv(qp, tb), tav = TA[0] * x + TA[1] * y + TA[2] * z, tbv = TB[0] * x + TB[1] * y + TB[2] * z;
      const Eqd = qb * mav - qa * mbv, Edd = mab * r2 - 3 * mav * mbv, Eqq = qb * tav + qa * tbv;
      const radial = (Eqd * dh3r + (Edd + Eqq) * dh5r) / r;
      const gv = [0, 0, 0], vv = [x, y, z];
      for (let c = 0; c < 3; c++) {
        gv[c] = (qb * dp[da + c] - qa * dp[db + c]) * h3
          + (2 * mab * vv[c] - 3 * (mbv * dp[da + c] + mav * dp[db + c])) * h5
          + 2 * (qb * TA[c] + qa * TB[c]) * h5 + radial * vv[c];
      }
      addPair(b, a, gv[0], gv[1], gv[2]);
      const dEdrho = Eqd * dh3p + (Edd + Eqq) * dh5p;
      dEdrad[a] += 0.5 * dEdrho; dEdrad[b] += 0.5 * dEdrho;
    }
    for (let i = 0; i < nat; i++) dEdcn[i] += dEdrad[i] * dmrdcn[i];
    // dispersion, two-body with the output charges (the three-body part is in g already)
    D4.d4Gradient2(disp, qat, g, dEdcnD);
    D4.d4CnGrad(disp, dEdcnD, g);
    // the Hamiltonian and the integrals: for each atom pair, the derivative of
    //   sum P H0 - sum Wd S - 1/2 sum P S (v_m + v_n) - sum P (D . vdp + Q . vqp)
    const vq6 = new Float64Array(6), dq6 = new Float64Array(6);
    for (let i = 0; i < nat; i++) {
      const ei = el[i];
      for (let j = 0; j < i; j++) {
        const ej = el[j], nshj = ej.shells.length;
        const v0 = X[3 * i] - X[3 * j], v1 = X[3 * i + 1] - X[3 * j + 1], v2 = X[3 * i + 2] - X[3 * j + 2], vv = [v0, v1, v2];
        const r2 = v0 * v0 + v1 * v1 + v2 * v2;
        if (r2 < Number.EPSILON || r2 > cutoff * cutoff) continue;
        const rr = Math.sqrt(Math.sqrt(r2) / (ei.rad + ej.rad)), hsT = hscaleTable(ei, ej);
        const vdi = [vdp[3 * i], vdp[3 * i + 1], vdp[3 * i + 2]], vdj = [vdp[3 * j], vdp[3 * j + 1], vdp[3 * j + 2]];
        const vqi = vqp.subarray(6 * i, 6 * i + 6), vqj = vqp.subarray(6 * j, 6 * j + 6);
        let dG0 = 0, dG1 = 0, dG2 = 0, dcni = 0, dcnj = 0;
        for (let a = atSh[i]; a < atSh[i + 1]; a++) {
          const pa = ei.shells[shOf[a]];
          for (let b = atSh[j]; b < atSh[j + 1]; b++) {
            const pb = ej.shells[shOf[b]], hsc = hsT[shOf[a] * nshj + shOf[b]];
            shellBlocks(pa.cg, pb.cg, v0, v1, v2, r2, intcut, true);
            const polyi = 1 + pa.shpoly * rr, polyj = 1 + pb.shpoly * rr, hs = hsc * polyi * polyj, hij = 0.5 * (selfE[a] + selfE[b]) * hs;
            const dpolyH = 0.5 * (selfE[a] + selfE[b]) * hsc * (polyi * pb.shpoly + polyj * pa.shpoly) * 0.5 * rr / r2;
            const na = shN[a], nb = shN[b];
            let ps = 0;
            for (let x = 0; x < na; x++) {
              const mu = shAo[a] + x;
              for (let y = 0; y < nb; y++) {
                const nu = shAo[b] + y, k = x * nb + y, idx = mu * nao + nu, p = P[idx], sv = BLK[0][k];
                let sval = 2 * p * hij - 2 * Wd[idx] - p * (vao[mu] + vao[nu]);
                if (SPN) sval -= SPN.Pm[idx] * (SPN.vaoM[mu] + SPN.vaoM[nu]); // (the magnetization's potential, 1.26)
                const t = 2 * p * sv * dpolyH;
                ps += p * sv;
                const di = [BLK[1][k], BLK[2][k], BLK[3][k]];
                const dG = [0, 0, 0];
                for (let m = 0; m < 3; m++) {
                  const DB = DBLK[m], ds = DB[0][k];
                  // the dipole about R_i and about R_j (shifted by v; v moves with R_i)
                  let e = 0;
                  for (let c = 0; c < 3; c++) {
                    const ddi = DB[1 + c][k], ddj = ddi + vv[c] * ds + (c === m ? sv : 0);
                    e += ddi * vdi[c] + ddj * vdj[c];
                  }
                  // quadrupoles: Cartesian slopes about R_i, shifted to R_j, both made traceless
                  for (let c = 0; c < 6; c++) dq6[c] = DB[4 + c][k];
                  traceless(dq6, vq6, 0); for (let c = 0; c < 6; c++) e += vq6[c] * vqi[c];
                  const dd0 = DB[1][k], dd1 = DB[2][k], dd2 = DB[3][k], dd = [dd0, dd1, dd2];
                  // d/dR_i,m of q + v_k d_l + v_l d_k + v_k v_l s (components xx xy yy xz yz zz)
                  const KL = [[0, 0], [0, 1], [1, 1], [0, 2], [1, 2], [2, 2]];
                  for (let c = 0; c < 6; c++) {
                    const [kk, ll] = KL[c];
                    dq6[c] = DB[4 + c][k] + vv[kk] * dd[ll] + vv[ll] * dd[kk] + (kk === m ? di[ll] : 0) + (ll === m ? di[kk] : 0)
                      + vv[kk] * vv[ll] * ds + ((kk === m ? vv[ll] : 0) + (ll === m ? vv[kk] : 0)) * sv;
                  }
                  traceless(dq6, vq6, 0); for (let c = 0; c < 6; c++) e += vq6[c] * vqj[c];
                  dG[m] = sval * ds - p * e;
                }
                dG0 += dG[0] + t * v0; dG1 += dG[1] + t * v1; dG2 += dG[2] + t * v2;
              }
            }
            dcni -= pa.kcn * hs * ps; dcnj -= pb.kcn * hs * ps;
          }
        }
        dEdcn[i] += dcni; dEdcn[j] += dcnj;
        addPair(i, j, dG0, dG1, dG2);
      }
      // onsite blocks: H0 = S (selfE_a + selfE_b) / 2 depends on CN_i
      for (let a = atSh[i]; a < atSh[i + 1]; a++) {
        const ka = ei.shells[shOf[a]].kcn;
        for (let x = 0; x < shN[a]; x++) { const mu = shAo[a] + x; for (let n = atAo[i]; n < atAo[i + 1]; n++) dEdcn[i] -= ka * P[mu * nao + n] * S[mu * nao + n]; }
      }
    }
    // the GFN coordination numbers' chain rule (levels and multipole radii)
    for (let i = 0; i < nat; i++) for (let j = 0; j < i; j++) {
      const c = cnd[i * nat + j]; if (!c) continue;
      const f = (dEdcn[i] + dEdcn[j]) * c;
      addPair(i, j, f * (X[3 * i] - X[3 * j]), f * (X[3 * i + 1] - X[3 * j + 1]), f * (X[3 * i + 2] - X[3 * j + 2]));
    }
    const conv = AUTOEV * AATOAU;
    out.g = [];
    for (let i = 0; i < nat; i++) out.g.push([g[3 * i] * conv, g[3 * i + 1] * conv, g[3 * i + 2] * conv]);
  }
  return out;
}

function nAO(z) { return element(z).nao; }
function nShell(z) { return element(z).shells.length; }
module.exports = { gfn2Energy, nAO, nShell, BOHR, AUTOEV, _internal: { element, shellBlocks, BLK, DBLK, hscaleTable } };
