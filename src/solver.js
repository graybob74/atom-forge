'use strict';
/* ------------------------------------------------------------------ atom solver (Inspect tab)
   A real quantum calculation of one atom's or ion's electrons, run on request: the self-consistent field of
   Hartree–Fock–Slater theory (Slater's Xα exchange) with Latter's correction of the potential's tail, as in
   Herman and Skillman's tables of every element. Each electron moves in the field of the nucleus and the
   average charge of all the others; the radial Schrödinger equation is solved numerically for every occupied
   subshell (Numerov's method on a logarithmic grid, eigenvalues by node counting and the cusp at the matching
   point), the charge density rebuilt from the orbitals found, the potential from that density, and round again
   until nothing changes. Non-relativistic and spherically averaged (no spin polarisation): heavy atoms' inner
   shells come out too shallow, and gold's 6s too large, as relativity is left out. Atomic units inside. */
const HARTREE_EV = 27.211386, BOHR_A = 0.529177;
let XALPHA = 1.0; // Slater's exchange parameter: his original 1, as in Herman and Skillman's tables (2/3 is Kohn–Sham's);
// with Latter's tail it puts the outermost orbital energies closest to measured ionization energies

/* Logarithmic grid r = e^x / Z (bohr), x from −8 in steps of dx, out to rmax bohr. */
function scfGrid(Z, rmax) {
  const dx = 0.008, x0 = -8, n = Math.ceil((Math.log(Z * rmax) - x0) / dx) + 1;
  const r = new Float64Array(n), r2 = new Float64Array(n), sr = new Float64Array(n);
  for (let i = 0; i < n; i++) { r[i] = Math.exp(x0 + i * dx) / Z; r2[i] = r[i] * r[i]; sr[i] = Math.sqrt(r[i]); }
  return { r, r2, sr, n, dx, ddx12: dx * dx / 12 };
}
/* One eigenstate (n, l) in the potential V (hartree) on grid g: returns { e, P } with P(r) = r·R(r),
   ∫P²dr = 1, or null. Giannozzi's scheme: bisection on the node count, then perturbative corrections from the
   derivative's cusp where the outward and inward solutions are joined. */
function scfOrbital(g, V, n, l, eGuess) {
  const N = g.n, r = g.r, r2 = g.r2, dx = g.dx, ddx12 = g.ddx12, lh2 = (l + 0.5) * (l + 0.5);
  const f = new Float64Array(N), y = new Float64Array(N);
  let elw = Infinity, eup = V[N - 1];
  for (let i = 0; i < N; i++) { const v = V[i] + lh2 / (2 * r2[i]); if (v < elw) elw = v; }
  if (!(eup > elw)) return null;
  let e = eGuess !== undefined && eGuess > elw && eGuess < eup ? eGuess : 0.5 * (elw + eup);
  const nodes = n - l - 1;
  for (let it = 0; it < 200; it++) {
    // f = 1 − dx²/12·g, g = 2r²(V − e) + (l + ½)²; the classically allowed region has g < 0
    let icl = -1;
    for (let i = 0; i < N; i++) f[i] = 1 - ddx12 * (2 * r2[i] * (V[i] - e) + lh2);
    if (f[N - 1] > 1) { eup = e; e = 0.5 * (elw + eup); continue; } // allowed out to the grid's end: e too high
    for (let i = N - 1; i > 0; i--) if ((f[i] - 1) * (f[i - 1] - 1) < 0) { icl = i; break; } // the outer turning point
    if (icl < 2 || icl > N - 3) { elw = e; e = 0.5 * (elw + eup); continue; } // nowhere allowed: e too low
    // outward, from the nucleus (P ~ r^(l+1), so y = P/√r ~ r^(l+½))
    y[0] = Math.pow(r[0], l + 0.5); y[1] = Math.pow(r[1], l + 0.5);
    let ncross = 0;
    for (let i = 1; i < icl; i++) {
      y[i + 1] = ((12 - 10 * f[i]) * y[i] - f[i - 1] * y[i - 1]) / f[i + 1];
      if (y[i] * y[i + 1] < 0) ncross++;
    }
    const fac = y[icl];
    if (ncross !== nodes) {
      if (ncross > nodes) eup = e; else elw = e;
      e = 0.5 * (eup + elw);
      if (eup - elw < 1e-13 * Math.max(1, Math.abs(e))) return null;
      continue;
    }
    // inward, from where the solution is negligible
    y[N - 1] = dx; y[N - 2] = (12 - 10 * f[N - 1]) * y[N - 1] / f[N - 2];
    for (let i = N - 2; i > icl; i--) {
      y[i - 1] = ((12 - 10 * f[i]) * y[i] - f[i + 1] * y[i + 1]) / f[i - 1];
      if (Math.abs(y[i - 1]) > 1e10) { // rescale to keep the numbers finite
        for (let j = i - 1; j < N; j++) y[j] *= 1e-10;
      }
    }
    const sc = fac / y[icl];
    for (let i = icl; i < N; i++) y[i] *= sc;
    let norm = 0;
    for (let i = 0; i < N; i++) norm += y[i] * y[i] * r2[i] * dx;
    norm = Math.sqrt(norm);
    for (let i = 0; i < N; i++) y[i] /= norm;
    // the cusp in the derivative where the two solutions meet gives the energy correction
    const ycusp = (y[icl - 1] * f[icl - 1] + y[icl + 1] * f[icl + 1] + 10 * f[icl] * y[icl]) / 12;
    const dfcusp = f[icl] * (y[icl] / ycusp - 1);
    const de = 0.5 * dfcusp / ddx12 * ycusp * ycusp * dx; // (½: the equation is 2(V − e), in hartree)
    const tol = 1e-10 * Math.max(1, Math.abs(e)); // (relative for deep states: roundoff)
    const done = Math.abs(de) < tol || eup - elw < tol;
    if (de > 0) elw = e; else if (de < 0) eup = e;
    let en = e + de;
    if (!(en < eup && en > elw)) en = 0.5 * (elw + eup); // a correction beyond the bracket: bisect instead
    if (!done) e = en;
    if (done) {
      const P = new Float64Array(N);
      for (let i = 0; i < N; i++) P[i] = y[i] * g.sr[i];
      return { e, P };
    }
  }
  return null;
}
/* Thomas–Fermi screening (Tietz's fit) as the first guess. */
function tfPhi(x) {
  const s = Math.sqrt(x);
  return 1 / (1 + 0.02747 * s + 1.243 * x - 0.1486 * x * s + 0.2302 * x * x + 0.007298 * x * x * s + 0.006944 * x * x * x);
}
/* The self-consistent atom: Z protons, ne electrons in the configuration electronConfig gives (or occ, a list
   of { n, l, c }). Returns { ok, Z, ne, orbitals: [{ n, l, c, e (eV), rMean (Å), rPeak (Å), P }], r (Å), iters, ms }. */
function solveAtom(Z, ne, occ) {
  const t0 = Date.now();
  const cfg = (occ || electronConfig(Z, ne)).filter(s => s.c > 0).map(s => ({ n: s.n, l: s.l, c: s.c }));
  const nel = cfg.reduce((s, o) => s + o.c, 0), ion = Z - nel;
  const g = scfGrid(Z, ion < 0 ? 90 : 60), N = g.n, r = g.r, dx = g.dx;
  // Latter: far out, an electron sees the nucleus less the other electrons, so the potential never rises above
  // −(Z − N + 1)/r; with less than one electron in the outermost subshell, only that fraction is its own
  let top = cfg[0];
  for (const o of cfg) if (o.n > top.n || (o.n === top.n && o.l > top.l)) top = o;
  const tail = Z - nel + Math.min(1, top.c);
  let V = new Float64Array(N);
  const b = 0.8853 * Math.pow(Z, -1 / 3);
  for (let i = 0; i < N; i++) V[i] = Math.min(-Z * tfPhi(r[i] / b) / r[i], -tail / r[i]);
  const u = new Float64Array(N), Vn = new Float64Array(N), Q = new Float64Array(N), out = new Float64Array(N);
  const guess = new Map();
  let iters = 0, ok = false, dV = 1, dVprev = Infinity, mix = 0.25;
  for (iters = 1; iters <= 160; iters++) {
    u.fill(0);
    for (const o of cfg) {
      const res = scfOrbital(g, V, o.n, o.l, guess.get(o.n * 10 + o.l));
      if (!res) { o.fail = true; continue; }
      o.fail = false; o.e = res.e; o.P = res.P; guess.set(o.n * 10 + o.l, res.e);
      for (let i = 0; i < N; i++) u[i] += o.c * res.P[i] * res.P[i];
    }
    if (cfg.some(o => o.fail)) break;
    // Hartree potential: Q(r)/r + ∫_r^∞ u/r' dr' (integrals in x: dr = r dx)
    let q = 0;
    for (let i = 0; i < N; i++) { const w = (i === 0 ? 0.5 : 1) * u[i] * r[i] * dx; q += w; Q[i] = q - 0.5 * u[i] * r[i] * dx; }
    let o2 = 0;
    for (let i = N - 1; i >= 0; i--) { out[i] = o2 + 0.5 * u[i] * dx; o2 += u[i] * dx; }
    dV = 0;
    for (let i = 0; i < N; i++) {
      const rho = u[i] / (4 * Math.PI * g.r2[i]);
      const vx = -1.5 * XALPHA * Math.cbrt(3 * rho / Math.PI);
      let v = -Z / r[i] + Q[i] / r[i] + out[i] + vx;
      if (v > -tail / r[i]) v = -tail / r[i];
      Vn[i] = v;
      const d = Math.abs(v - V[i]) * r[i];
      if (d > dV) dV = d;
    }
    // mix in the new potential, more cautiously whenever the change grew (charge sloshing between 3d and 4s …)
    mix = dV > dVprev ? Math.max(0.04, mix * 0.5) : Math.min(0.5, mix * 1.15);
    dVprev = dV;
    for (let i = 0; i < N; i++) V[i] = (1 - mix) * V[i] + mix * Vn[i];
    if (dV < 1e-6) { ok = true; break; }
  }
  const orbitals = cfg.map(o => {
    if (!o.P) return { n: o.n, l: o.l, c: o.c, e: NaN, rMean: NaN, rPeak: NaN, P: null };
    let rm = 0, pk = 0, pr = 0;
    for (let i = 0; i < N; i++) { const w = o.P[i] * o.P[i] * r[i] * dx; rm += w * r[i]; if (o.P[i] * o.P[i] > pk) { pk = o.P[i] * o.P[i]; pr = r[i]; } }
    return { n: o.n, l: o.l, c: o.c, e: o.e * HARTREE_EV, rMean: rm * BOHR_A, rPeak: pr * BOHR_A, P: o.P };
  });
  const rA = new Float64Array(N); for (let i = 0; i < N; i++) rA[i] = r[i] * BOHR_A;
  return { ok, Z, ne: nel, orbitals, r: rA, dx, iters, dV, ms: Date.now() - t0 };
}
if (typeof module !== 'undefined') module.exports = { solveAtom, scfOrbital, scfGrid };
