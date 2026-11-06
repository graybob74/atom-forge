'use strict';
// Method variants for the 1.26 comparisons and fits: { base: 1|2, spin: bool, par: parameter set or null }.
// E(v, Z, xyz, charge, uhf) in eV (GFN1 with its D3), grad optional; Elow: the game's lowest state (shared Fermi level,
// probe, seeded reruns); opt: BFGS geometry optimization with optional restraints.
const ROOT = process.env.AFROOT || require('path').join(__dirname, '..', '..');
const G1 = require(ROOT + '/tools/xtb/gfn1.js'), G2 = require(ROOT + '/tools/xtb/gfn2.js'), D3 = require(ROOT + '/tools/xtb/d3.js');
const SPIN = require(ROOT + '/tools/xtb/spin.js');
const ACC = 0.01;
function E(v, Z, xyz, charge = 0, uhf = 0, grad = false, extra = {}) {
  const f = v.base === 1 ? G1.gfn1Energy : G2.gfn2Energy;
  const o = { accuracy: ACC, grad, maxIter: 250, ...(v.spin ? { spin: v.spin === true ? 1 : v.spin } : {}), ...(v.par ? { par: v.par } : {}), ...extra };
  const r = f(Z, xyz, charge, uhf, o);
  if (v.base === 1 && !v.noD3) { const d = D3.d3Disp(Z, xyz, { grad }); r.E += d.E; if (grad) r.g = r.g.map((g, i) => g.map((x, c) => x + d.g[i][c])); }
  return r;
}
// the lowest state the game would find: unpolarized start with the probe, a seeded rerun if unstable, and a few more
// seeds (Hund's spins on each atom, alternating and all alike); spin off: the plain calculation (uhf parity)
function Elow(v, Z, xyz, charge = 0, grad = false) {
  if (!v.spin) return E(v, Z, xyz, charge, 0, grad);
  const base = { spinFree: true };
  let best = E(v, Z, xyz, charge, 0, grad, { ...base, probe: true });
  const nsh = best.msh.length, tryG = (g) => { const r = E(v, Z, xyz, charge, 0, grad, { ...base, qsh0: g }); if (r.converged && (!best.converged || r.E < best.E - 1e-9)) best = r; };
  if (best.probe && best.probe.lam > 1.02) { const g = best.guess.slice(), pv = best.probe.v, mx = Math.max(...pv.map(Math.abs)); for (let s = 0; s < nsh; s++) g[nsh + s] = 0.5 * pv[s] / mx; tryG(g); }
  const shAt = []; Z.forEach((z, i) => { const k = (v.base === 1 ? G1 : G2).nShell(z); for (let s = 0; s < k; s++) shAt.push(i); });
  for (const alt of [true, false]) { const m0 = new Array(nsh).fill(0); for (let i = 0; i < Z.length; i++) { const last = shAt.lastIndexOf(i); m0[last] = -(alt && i % 2 ? -1 : 1) * SPIN.atomUnpaired(Z[i]); } const r = E(v, Z, xyz, charge, 0, grad, { ...base, m0 }); if (r.converged && r.E < best.E - 1e-9) best = r; }
  return best;
}
const ATOM_UHF = { 1: 1, 6: 2, 7: 3, 8: 2, 9: 1, 16: 2, 17: 1 };
const atomCache = new Map();
// a free atom: spin on, Hund's spin; spin off, as the game takes it (uhf 0, Fermi smearing) unless asked
function Eatom(v, z, uhfOff = 0) { const k = JSON.stringify([v.base, !!v.spin, v.par ? v.par.id : 0, z, uhfOff]); if (!atomCache.has(k)) atomCache.set(k, E(v, [z], [[0, 0, 0]], 0, v.spin ? ATOM_UHF[z] : uhfOff).E); return atomCache.get(k); }

// ---- geometry: BFGS with an inverse Hessian, restraints {type:'angle', i, j, k, deg, kf} (eV/rad²) or {type:'dist', i, j, r, kf}
function restraint(xyz, rs, g) {
  let e = 0;
  for (const r of rs) {
    if (r.type === 'dist') { const d = [0, 1, 2].map(c => xyz[r.i][c] - xyz[r.j][c]), R = Math.hypot(...d), f = r.kf * (R - r.r); e += 0.5 * r.kf * (R - r.r) ** 2; for (let c = 0; c < 3; c++) { g[r.i][c] += f * d[c] / R; g[r.j][c] -= f * d[c] / R; } }
    else if (r.type === 'angle') {
      const a = xyz[r.i], b = xyz[r.j], c = xyz[r.k], u = a.map((x, q) => x - b[q]), w = c.map((x, q) => x - b[q]);
      const nu = Math.hypot(...u), nw = Math.hypot(...w), cs = Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / nu / nw)), th = Math.acos(cs), t0 = r.deg * Math.PI / 180;
      e += 0.5 * r.kf * (th - t0) ** 2;
      const dth = r.kf * (th - t0), sn = Math.max(Math.sqrt(1 - cs * cs), 1e-8);
      for (let q = 0; q < 3; q++) {
        const dcu = (w[q] / nw - cs * u[q] / nu) / nu, dcw = (u[q] / nu - cs * w[q] / nw) / nw;
        g[r.i][q] += dth * (-dcu / sn); g[r.k][q] += dth * (-dcw / sn); g[r.j][q] += dth * ((dcu + dcw) / sn);
      }
    }
  }
  return e;
}
function opt(fn, xyz0, { rs = [], maxSteps = 200, gtol = 2e-3, fixed = null } = {}) {
  const n = xyz0.length, N = 3 * n;
  let x = xyz0.flat(), H = null;
  const ev = (xf) => { const xyz = []; for (let i = 0; i < n; i++) xyz.push([xf[3 * i], xf[3 * i + 1], xf[3 * i + 2]]); const r = fn(xyz); const g = r.g.map(a => a.slice()); const er = restraint(xyz, rs, g); const gf = g.flat(); if (fixed) for (const i of fixed) for (let c = 0; c < 3; c++) gf[3 * i + c] = 0; return { E: r.E + er, Epure: r.E, g: gf, r }; };
  let cur = ev(x);
  H = Array.from({ length: N }, (_, i) => { const row = new Float64Array(N); row[i] = 1 / 30; return row; }); // (eV/Å² ~ 30 for bonds)
  for (let step = 0; step < maxSteps; step++) {
    const gmax = Math.max(...cur.g.map(Math.abs)); if (gmax < gtol) break;
    const p = new Float64Array(N); for (let i = 0; i < N; i++) { let s = 0; for (let j = 0; j < N; j++) s -= H[i][j] * cur.g[j]; p[i] = s; }
    let pm = Math.max(...p.map(Math.abs)); const sc = pm > 0.2 ? 0.2 / pm : 1; for (let i = 0; i < N; i++) p[i] *= sc;
    let a = 1, nx, nw;
    for (let t = 0; t < 12; t++) { nx = x.map((v, i) => v + a * p[i]); nw = ev(nx); if (nw.E <= cur.E + 1e-4 * a * p.reduce((s, v, i) => s + v * cur.g[i], 0)) break; a *= 0.5; }
    const sv = nx.map((v, i) => v - x[i]), yv = nw.g.map((v, i) => v - cur.g[i]), sy = sv.reduce((s, v, i) => s + v * yv[i], 0);
    if (sy > 1e-10) { // BFGS inverse update
      const Hy = new Float64Array(N); for (let i = 0; i < N; i++) { let s = 0; for (let j = 0; j < N; j++) s += H[i][j] * yv[j]; Hy[i] = s; }
      const yHy = yv.reduce((s, v, i) => s + v * Hy[i], 0);
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) H[i][j] += ((sy + yHy) * sv[i] * sv[j]) / (sy * sy) - (Hy[i] * sv[j] + sv[i] * Hy[j]) / sy;
    }
    x = nx; cur = nw;
  }
  const xyz = []; for (let i = 0; i < n; i++) xyz.push([x[3 * i], x[3 * i + 1], x[3 * i + 2]]);
  return { xyz, E: cur.Epure, Er: cur.E, gmax: Math.max(...cur.g.map(Math.abs)), r: cur.r };
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const angle = (a, b, c) => { const u = a.map((v, k) => v - b[k]), w = c.map((v, k) => v - b[k]); return Math.acos((u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / Math.hypot(...u) / Math.hypot(...w)) * 180 / Math.PI; };
module.exports = { E, Elow, Eatom, opt, dist, angle, ATOM_UHF, G1, G2, D3, SPIN };
