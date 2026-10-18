'use strict';
/* ------------------------------------------------------------------ orbitals (for display)
   The bound electrons' wavefunctions, computed for the Orbitals view and the inspector. Each occupied subshell n,l
   is a hydrogen-like orbital, which has the right number of radial nodes and the right angular shape. Its effective
   nuclear charge comes from Slater's screening rules, and its size from Slater's orbital: the hydrogen-like radius is
   matched to ⟨r⟩ = n*(2n* + 1)·a₀ / 2Z_eff, with Slater's effective quantum number n* (3.7, 4.0, 4.2 for n = 4, 5, 6),
   so heavy atoms are not drawn far too large. A partly filled subshell fills its real orbitals by Hund's rule, each
   singly before any pair up. Which real orbitals (pₓ, p_y or p_z …) is a free choice for a free atom; the order here
   shows each subshell's own shape in the chamber's plane: one p electron is a pₓ dumbbell, two are pₓ + p_z (still a
   dumbbell in the plane), three fill all three (round). The chamber shows each atom's electron density in a slice
   through its nucleus, in the chamber's own plane. These pictures follow the atom's live configuration, but nothing
   in the motion depends on them. */
const A0_ANG = 0.529177;                                     // Bohr radius, Å
const ORB_COL = ['#58c4ff', '#ffb04a', '#6ff0a0', '#ff78d2']; // s, p, d, f
const ORB_K = 0.45;   // display: opacity 1 − exp(−(ρ / (ORB_K · valence peak))²), so a cloud's edge is crisp
const PI4 = 4 * Math.PI;
/* In-plane (z = 0) angular densities |Y|² of the real orbitals of each l, in filling order, as functions of
   c = cos φ and s = sin φ. Out-of-plane orbitals (p_z, d_xz, d_yz, …) have no density in the plane. */
const ORB_ANG = [
  [() => 1 / PI4],
  [(c) => 3 / PI4 * c * c, () => 0, (c, s) => 3 / PI4 * s * s],                                   // pₓ, p_z, p_y
  [(c, s) => 15 / PI4 * c * c * s * s, () => 0, () => 0, () => 5 / (4 * PI4), (c, s) => 15 / (4 * PI4) * (c * c - s * s) ** 2], // d_xy, d_xz, d_yz, d_z², d_x²−y²
  [(c, s) => 35 / (8 * PI4) * c * c * (c * c - 3 * s * s) ** 2, () => 0, () => 0, () => 0,        // f_x(x²−3y²), f_z³, f_z(x²−y²), f_xyz,
    (c) => 21 / (8 * PI4) * c * c, (c, s) => 21 / (8 * PI4) * s * s, (c, s) => 35 / (8 * PI4) * s * s * (3 * c * c - s * s) ** 2], // f_xz², f_yz², f_y(3x²−y²)
];

/* R(r)² of a hydrogen-like orbital n,l with charge zs, normalised so that ∫R²r²dr = 1, tabulated in r (Å). */
function orbRadial(n, l, zs) {
  const rMean = A0_ANG * (3 * n * n - l * (l + 1)) / (2 * zs);
  const rEnd = 5 * rMean + 3 * A0_ANG / zs, M = 1024, dr = rEnd / M, tab = new Float64Array(M + 2);
  const kk = n - l - 1, al = 2 * l + 1;
  let norm = 0;
  for (let k = 0; k <= M; k++) {
    const r = k * dr, rho = 2 * zs * r / (n * A0_ANG);
    let L0 = 1, L1 = 1 + al - rho, L = kk === 0 ? 1 : L1; // generalised Laguerre polynomial L_kk^al(rho)
    for (let j = 1; j < kk; j++) { const L2 = ((2 * j + 1 + al - rho) * L1 - (j + al) * L0) / (j + 1); L0 = L1; L1 = L2; L = L2; }
    const R = (l ? Math.pow(rho, l) : 1) * Math.exp(-rho / 2) * L;
    tab[k] = R * R;
    norm += (k === 0 || k === M ? 0.5 : 1) * tab[k] * r * r * dr;
  }
  for (let k = 0; k <= M; k++) tab[k] /= norm;
  // the outermost lobe (beyond the last radial node), which holds most of the electron: its peak sets the display scale
  let lobe = 0, k = M;
  for (; k >= 0; k--) { if (tab[k] > lobe) lobe = tab[k]; else if (tab[k] < 1e-3 * lobe) break; }
  // the density's envelope from outside in, for whole atoms: a real atom's density never dips to zero between its
  // shells (inner lobes of the outer orbitals fill in there), which single-charge hydrogen-like orbitals miss
  const env = new Float64Array(M + 2);
  for (let j = M, m = 0; j >= 0; j--) { if (tab[j] > m) m = tab[j]; env[j] = m; }
  return { tab, env, dr, M, rEnd, rMean, lobe, rNode: Math.max(0, k) * dr };
}
function orbR2(sub, r, t) {
  const u = r / sub.dr;
  if (u >= sub.M) return 0;
  const k = u | 0, f = u - k;
  return t[k] + (t[k + 1] - t[k]) * f;
}
/* Angular density of a subshell in the plane: Σ occupancy × |Y|² over its real orbitals. */
function orbAng(sub, c, s) {
  const A = ORB_ANG[sub.l];
  let a = 0;
  for (let m = 0; m < sub.occ.length; m++) if (sub.occ[m]) a += sub.occ[m] * A[m](c, s);
  return a;
}
/* Peak in-plane density of a subshell's outermost lobe (the angular forms here are all symmetric under φ → −φ and
   φ → π − φ, so a quarter turn is sampled). */
function orbPeak(sub) {
  let angMax = 0;
  for (let j = 0; j <= 24; j++) { const ph = j * Math.PI / 48; angMax = Math.max(angMax, orbAng(sub, Math.cos(ph), Math.sin(ph))); }
  sub.angMax = angMax;
  return sub.lobe * angMax;
}
const _orbSets = new Map();
/* Orbitals of a species with nuclear charge Z and ne bound electrons: [{n, l, c, zeff, occ, rMean, …}], the density
   used as the display reference (the outermost subshell's peak), and the radius out to which the cloud is drawn. */
/* Radial densities from the atom solver (solver.js), once it has been run for a species: they replace the
   Slater-rule orbitals in the pictures, so the Orbitals view then draws that atom from a real calculation. */
const _scfSets = new Map();
function orbitalsFromSolver(res) {
  const subs = [];
  for (const o of res.orbitals) {
    if (!o.P) return null;
    // R² on an even grid in r (Å), from P = r·R on the solver's log grid: ∫R²r²dr = 1
    const rEnd = Math.max(0.3, 6 * o.rMean), M = 1024, dr = rEnd / M, tab = new Float64Array(M + 2);
    const r = res.r, n = r.length;
    let j = 0;
    for (let k = 0; k <= M; k++) {
      const x = k * dr;
      while (j < n - 2 && r[j + 1] < x) j++;
      if (x <= r[0]) { tab[k] = (o.P[0] / r[0]) ** 2; continue; }
      const f = (x - r[j]) / (r[j + 1] - r[j]), P = o.P[j] + (o.P[j + 1] - o.P[j]) * f;
      tab[k] = (P / x) ** 2; // (normalised below)
    }
    let norm = 0;
    for (let k = 0; k <= M; k++) norm += (k === 0 || k === M ? 0.5 : 1) * tab[k] * (k * dr) ** 2 * dr;
    for (let k = 0; k <= M; k++) tab[k] /= norm;
    let lobe = 0, kk = M;
    for (; kk >= 0; kk--) { if (tab[kk] > lobe) lobe = tab[kk]; else if (tab[kk] < 1e-3 * lobe) break; }
    const env = new Float64Array(M + 2);
    for (let q = M, m = 0; q >= 0; q--) { if (tab[q] > m) m = tab[q]; env[q] = m; }
    const nOrb = 2 * o.l + 1, occ = new Float64Array(nOrb);
    for (let q = 0; q < o.c; q++) occ[q % nOrb]++;
    const sub = { n: o.n, l: o.l, c: o.c, zeff: NaN, zs: NaN, occ, tab, env, dr, M, rEnd, rMean: o.rMean, lobe, rNode: Math.max(0, kk) * dr, solved: true };
    sub.peak = orbPeak(sub);
    subs.push(sub);
  }
  return orbAssemble(res.Z, res.ne, subs);
}
function useSolverOrbitals(res) {
  const O = orbitalsFromSolver(res);
  if (!O) return false;
  O.solved = true;
  _scfSets.set(res.Z * 512 + res.ne, O);
  _orbSets.delete(res.Z * 512 + res.ne);
  return true;
}
function orbitalSet(Z, ne) {
  const key = Z * 512 + ne;
  let O = _scfSets.get(key) || _orbSets.get(key);
  if (O) return O;
  const cfg = electronConfig(Z, ne), subs = [];
  for (const s of cfg) {
    const zeff = Math.max(0.3, Z - slaterS(cfg, s)), ns = NSTAR[s.n] || 4.3;
    const zs = zeff * (3 * s.n * s.n - s.l * (s.l + 1)) / ((2 * ns + 1) * ns);
    const nOrb = 2 * s.l + 1, occ = new Float64Array(nOrb);
    for (let k = 0; k < s.c; k++) occ[k % nOrb]++; // Hund: one in each before any pairs
    const sub = Object.assign({ n: s.n, l: s.l, c: s.c, zeff, zs, occ }, orbRadial(s.n, s.l, zs));
    sub.peak = orbPeak(sub);
    subs.push(sub);
  }
  O = orbAssemble(Z, ne, subs);
  if (_orbSets.size > 600) _orbSets.clear();
  _orbSets.set(key, O);
  return O;
}
function orbAssemble(Z, ne, subs) {
  // display scale: the densest of the outermost subshells (the valence shell: all within 15% of the largest radius)
  let rOut = 0, ref = 0;
  for (const s of subs) rOut = Math.max(rOut, s.rMean);
  for (const s of subs) if (s.rMean >= 0.85 * rOut) ref = Math.max(ref, s.peak);
  if (!(ref > 0)) ref = 1;
  // drawn out to where the cloud is 1% opaque; its visible edge, where it is 10% opaque, places labels
  const edge = (f) => { let r = 0.1; for (const s of subs) for (let k = s.M; k > 0; k -= 2) if (s.tab[k] * s.angMax > f * ref) { r = Math.max(r, k * s.dr); break; } return r; };
  const rmax = Math.max(0.3, edge(0.1 * ORB_K)), rvis = edge(0.325 * ORB_K);
  return { Z, ne, subs, ref, rmax, rvis };
}
function orbRGB(hex) { const v = parseInt(hex.slice(1), 16); return [v >> 16, (v >> 8) & 255, v & 255]; }
const ORB_RGB = ORB_COL.map(orbRGB);
/* Pixels (RGBA, not premultiplied) of the in-plane density over ±half Å around the nucleus, N × N: the whole atom
   (only undefined), or one subshell with its radial nodes. Opacity rises with density, scaled to the outermost lobe
   of the valence subshell (the core is a bright point); colour shows which subshell (s, p, d or f) holds most of it.
   Every in-plane density here is symmetric under x → −x and y → −y, so one quadrant is computed and mirrored. */
function orbitalPixels(O, N, only, half) {
  const one = only !== undefined, subs = one ? [O.subs[only]] : O.subs;
  if (half === undefined) half = one ? orbSubRadius(O.subs[only]) : O.rmax;
  const px = new Uint8ClampedArray(N * N * 4), h = 2 * half / N, ns = subs.length, d = new Float64Array(ns);
  const inv = 1 / (ORB_K * (one ? subs[0].peak : O.ref)), H = Math.ceil(N / 2);
  for (let j = 0; j < H; j++) {
    const y = (N / 2 - j - 0.5) * h;
    for (let i = 0; i < H; i++) {
      const x = (i + 0.5 - N / 2) * h, r = Math.sqrt(x * x + y * y);
      const c = r > 0 ? x / r : 1, s = r > 0 ? y / r : 0;
      let tot = 0, w = 0;
      for (let k = 0; k < ns; k++) {
        const sub = subs[k], v = orbR2(sub, r, one ? sub.tab : sub.env);
        d[k] = v > 0 ? v * orbAng(sub, c, s) : 0; tot += d[k]; w += d[k] * d[k];
      }
      if (!(tot > 0)) continue;
      let cr = 0, cg = 0, cb = 0;
      for (let k = 0; k < ns; k++) { if (!d[k]) continue; const f = d[k] * d[k] / w, rgb = ORB_RGB[subs[k].l]; cr += f * rgb[0]; cg += f * rgb[1]; cb += f * rgb[2]; }
      const q = tot * inv, al = 255 * (1 - Math.exp(-q * q));
      for (const o of [(j * N + i) * 4, (j * N + N - 1 - i) * 4, ((N - 1 - j) * N + i) * 4, ((N - 1 - j) * N + N - 1 - i) * 4]) {
        px[o] = cr; px[o + 1] = cg; px[o + 2] = cb; px[o + 3] = al;
      }
    }
  }
  return px;
}
/* Radius holding one subshell's own picture (out to where it is 1% opaque). */
function orbSubRadius(s) {
  for (let k = s.M; k > 0; k -= 2) if (s.tab[k] * s.angMax > 0.1 * ORB_K * s.peak) return k * s.dr;
  return s.rMean * 2;
}

