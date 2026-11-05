'use strict';
// Spin polarization for GFN1-xTB and GFN2-xTB (1.26): the published spin-polarized GFN-xTB (Neugebauer, Bädorf,
// Ehlert, Hansen and Grimme, J. Comput. Chem. 44, 2120 (2023)), ported from tblite (LGPL-3.0-or-later:
// src/tblite/spin.f90, data/spin.f90, wavefunction/spin.f90, scf/diag.f90, scf/potential.f90 and the spin channels
// of the singlepoint and its gradient). Used by gfn1.js and gfn2.js when opts.spin is set.
//
// As tblite: the electrons are two channels (alpha and beta), each with its own Hamiltonian and orbitals; the state is
// the shell charges q and the shell magnetizations m (tblite's sign: m = N_beta - N_alpha), mixed together; the energy
// gains E_spin = 1/2 sum over atoms, sum over that atom's shells s, s' of W_ss' m_s m_s' (W from the table: ss, sp, pp,
// sd, pd, dd per element, times opts.spin as tblite's scaling factor), whose potential v_s = sum W_ss' m_s' enters the
// alpha Hamiltonian as -1/2 S (v_mu + v_nu) and the beta one with the opposite sign. A fixed number of unpaired
// electrons (uhf) fills each channel to its own count, each with its own Fermi level (tblite). With opts.spinFree the
// two channels share one Fermi level and the count of each settles itself (Atom Forge's choice for the game, where a
// cluster can hold several radicals: each takes its own spin); the energy is then the same functional at whatever
// counts it settles to.
const SD = require('./spin-data.js');
const LIDX = [[0, 1, 3], [1, 2, 4], [3, 4, 5]];            // ss sp sd / sp pp pd / sd pd dd
const wll = (z, li, lj) => +SD.W[(z - 1) * 6 + LIDX[li][lj]];

// the spin constants of a calculation: for each shell a, its atom's shells b (first shell atSh, count) and W_ab
function spinTable(Z, shellsOf, atSh, shAt, nsh, scale) {
  const w = new Float64Array(nsh * nsh);
  for (let a = 0; a < nsh; a++) {
    const i = shAt[a], sh = shellsOf(i), la = sh[a - atSh[i]].l;
    for (let b = atSh[i]; b < atSh[i + 1]; b++) w[a * nsh + b] = scale * wll(Z[i], sh[b - atSh[i]].l, la);
  }
  return w;
}
// v_a = sum_b W_ab m_b (same atom only), and E = 1/2 sum m_a v_a
function spinPot(w, atSh, shAt, nsh, m, v) {
  let e = 0;
  for (let a = 0; a < nsh; a++) {
    const i = shAt[a]; let s = 0;
    for (let b = atSh[i]; b < atSh[i + 1]; b++) s += w[a * nsh + b] * m[b];
    v[a] = s; e += 0.5 * m[a] * s;
  }
  return e;
}

// one Fermi level for both channels: the 2 nao spin orbitals filled with nel electrons (fermiFilling on the merged,
// sorted list), handed back as alpha and beta occupations
function fermiShared(fermiFilling, nel, kt, ea, eb) {
  const n = ea.length, idx = new Int32Array(2 * n), e = new Float64Array(2 * n);
  for (let k = 0; k < 2 * n; k++) idx[k] = k;
  const val = k => k < n ? ea[k] : eb[k - n];
  idx.sort((x, y) => val(x) - val(y) || x - y);
  for (let k = 0; k < 2 * n; k++) e[k] = val(idx[k]);
  const f = fermiFilling(nel, kt, e), fa = new Float64Array(n), fb = new Float64Array(n);
  for (let k = 0; k < 2 * n; k++) { const j = idx[k]; if (j < n) fa[j] = f[k]; else fb[j - n] = f[k]; }
  return [fa, fb];
}

// the generalized eigenproblem of one channel, as gfn1.js does it: A = Li H Li^T (W = Li H on the way), A's
// eigenvectors as rows; returns the eigenvalues
function solveChannel(symEig, H1, Li, nao, W, A) {
  for (let m = 0; m < nao; m++) {
    const wm = m * nao;
    for (let n = 0; n <= m; n++) { const hn = n * nao; let v = 0; for (let k = 0; k <= m; k++) v += Li[wm + k] * H1[hn + k]; W[wm + n] = v; }
  }
  for (let m = 0; m < nao; m++) for (let n = 0; n <= m; n++) {
    let v = 0; for (let k = 0; k <= n; k++) v += W[m * nao + k] * Li[n * nao + k];
    A[m * nao + n] = v; A[n * nao + m] = v;
  }
  return symEig(A, nao, true);
}
// C = Li^T Y into W (columns of orbitals holding anything), then P = sum_k f_k C_k C_k^T (Cf scratch)
function channelDensity(W, A, LiT, f, nao, Cf, P) {
  let ncol = 0; for (let k = 0; k < nao; k++) if (f[k] !== 0) ncol = k + 1;
  for (let m = 0; m < nao; m++) {
    const cm = m * nao;
    for (let n = 0; n < ncol; n++) { const yn = n * nao; let v = 0; for (let k = m; k < nao; k++) v += LiT[cm + k] * A[yn + k]; W[cm + n] = v; }
    for (let n = ncol; n < nao; n++) W[cm + n] = 0;
  }
  let nk = 0; for (let k = 0; k < nao; k++) if (f[k] > 1e-15) nk = k + 1;
  for (let m = 0; m < nao; m++) for (let k = 0; k < nk; k++) Cf[m * nao + k] = f[k] > 1e-15 ? W[m * nao + k] * f[k] : 0;
  for (let m = 0; m < nao; m++) {
    const pm = m * nao;
    for (let n = m; n < nao; n++) { const cn = n * nao; let v = 0; for (let k = 0; k < nk; k++) v += Cf[pm + k] * W[cn + k]; P[pm + n] = v; P[cn + m] = v; }
  }
}
// the energy-weighted density of one channel, lower triangle (mu > nu), added into Wd
function addWDensity(C, f, e, nao, Wd) {
  const ck = new Float64Array(nao);
  for (let k = 0; k < nao; k++) {
    const fe = f[k] * e[k];
    if (fe === 0) continue;
    for (let m = 0; m < nao; m++) ck[m] = C[m * nao + k];
    for (let m = 1; m < nao; m++) { const cm = ck[m] * fe; if (cm === 0) continue; const wm = m * nao; for (let n = 0; n < m; n++) Wd[wm + n] += cm * ck[n]; }
  }
}
// Mayer bond orders of an open shell: 2 sum over the channels of (P_s S)_mn (P_s S)_nm (a closed shell's (PS)(PS))
function mayerSpin(Pa, Pb, S, aoAt, nat, nao) {
  const B = new Float64Array(nat * nat);
  for (const P of [Pa, Pb]) for (let m = 0; m < nao; m++) for (let n = 0; n < m; n++) {
    const a = aoAt[m], b = aoAt[n]; if (a === b) continue;
    const rm = m * nao, rn = n * nao;
    let pmn = 0, pnm = 0;
    for (let k = 0; k < nao; k++) { pmn += P[rm + k] * S[rn + k]; pnm += P[rn + k] * S[rm + k]; }
    const v = 2 * pmn * pnm; B[a * nat + b] += v; B[b * nat + a] += v;
  }
  return B;
}
// a free atom's unpaired electrons in its ground state (Hund), for a magnetization seed: from its valence count
function atomUnpaired(z) {
  const v = [0, 1, 0, 1, 0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 2, 1, 0];
  return z < v.length ? v[z] : 0;
}
module.exports = { spinTable, spinPot, fermiShared, solveChannel, channelDensity, addWDensity, mayerSpin, atomUnpaired, wll };
