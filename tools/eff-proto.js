'use strict';
/* Electrons as waves: a prototype outside the game (1.12 planning). The electron force field of Su & Goddard (eFF,
   PRL 99, 185003, 2007): each electron a spherical Gaussian wave packet with a centre, a size s and a spin, moving
   classically (its size too, with mass 3/4 mₑ). Energies in Hartree atomic units (bohr, hartree, mₑ = ħ = 1):
     kinetic   3/(2s²) per electron
     e–nucleus −Z/r · erf(√2 r / s)
     e–e       1/r · erf(√2 r / √(sᵢ² + sⱼ²))
     n–n       ZᵢZⱼ/r
     Pauli     same spin  [S²/(1−S²) + (1−ρ) S²/(1+S²)] ΔT;  opposite spin  −ρ S²/(1+S²) ΔT,  ρ = −0.2
               S = (2/(s̄ᵢ/s̄ⱼ + s̄ⱼ/s̄ᵢ))^(3/2) exp(−r̄²/(s̄ᵢ² + s̄ⱼ²)),
               ΔT = 3/2 (1/s̄ᵢ² + 1/s̄ⱼ²) − 2 (3(s̄ᵢ² + s̄ⱼ²) − 2r̄²)/(s̄ᵢ² + s̄ⱼ²)²,  r̄ = 1.125 r, s̄ = 0.9 s.
   Everything lies in the plane (as in the game: 3-D physics in a flat box), the packets are 3-D.
   node tools/eff-proto.js [atoms|dyn|plasma|cost] */
const HA = 27.211386, BOHR = 0.529177;
/* erf to double precision: its series below 3, the continued fraction for erfc above. */
function erf(x) {
  const ax = Math.abs(x);
  if (ax < 3) { let s = ax, t = ax, x2 = ax * ax; for (let n = 1; n < 80; n++) { t *= -x2 / n; const d = t / (2 * n + 1); s += d; if (Math.abs(d) < 1e-17 * Math.abs(s)) break; } s *= 2 / Math.sqrt(Math.PI); return x < 0 ? -s : s; }
  // erfc(x) = exp(−x²)/√π · 1/(x + 1/2/(x + 1/(x + 3/2/(x + …)))) by Lentz
  let f = ax, C = ax, D = 0; const tiny = 1e-300;
  for (let n = 1; n < 200; n++) { const an = n / 2; D = ax + an * D; D = Math.abs(D) < tiny ? tiny : D; C = ax + an / C; C = Math.abs(C) < tiny ? tiny : C; D = 1 / D; const dl = C * D; f *= dl; if (Math.abs(dl - 1) < 1e-16) break; }
  const ec = Math.exp(-ax * ax) / Math.sqrt(Math.PI) / f;
  return x < 0 ? ec - 1 : 1 - ec;
}
const TWO_SQRTPI = 2 / Math.sqrt(Math.PI), RHO = -0.2;
/* f(r) = erf(a r)/r and its derivatives in r and a (a → 0 safe) */
function erfOver(r, a) {
  if (r < 1e-8) return [TWO_SQRTPI * a, 0, TWO_SQRTPI];
  const e = erf(a * r), g = Math.exp(-a * a * r * r);
  return [e / r, (TWO_SQRTPI * a * g * r - e) / (r * r), TWO_SQRTPI * g];
}
/* The Pauli energy of a pair at distance r (bohr) with sizes si, sj; derivatives by central differences (a prototype). */
function pauliE(r, si, sj, same) {
  const rb = 1.125 * r, a = 0.9 * si, b = 0.9 * sj, a2 = a * a, b2 = b * b, sum = a2 + b2;
  const S = Math.pow(2 / (a / b + b / a), 1.5) * Math.exp(-rb * rb / sum), S2 = S * S;
  const dT = 1.5 * (1 / a2 + 1 / b2) - 2 * (3 * sum - 2 * rb * rb) / (sum * sum);
  return same ? (S2 / (1 - S2) + (1 - RHO) * S2 / (1 + S2)) * dT : -RHO * S2 / (1 + S2) * dT;
}
function pauliD(r, si, sj, same) {
  const h = 1e-6, f = (x, y, z) => pauliE(x, y, z, same);
  return [f(r, si, sj), (f(r + h, si, sj) - f(r - h, si, sj)) / (2 * h), (f(r, si + h, sj) - f(r, si - h, sj)) / (2 * h), (f(r, si, sj + h) - f(r, si, sj - h)) / (2 * h)];
}
/* A system: nuclei { x, y, Z, m (mₑ) } and electrons { x, y, s, spin }; energy and its gradient. */
function energy(sys, grad) {
  const N = sys.nuc, E = sys.el; let U = 0;
  if (grad) { for (const n of N) { n.gx = 0; n.gy = 0; } for (const e of E) { e.gx = 0; e.gy = 0; e.gs = 0; } }
  for (const e of E) { U += 1.5 / (e.s * e.s); if (grad) e.gs += -3 / (e.s * e.s * e.s); }
  for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
    const a = N[i], b = N[j], dx = b.x - a.x, dy = b.y - a.y, r = Math.hypot(dx, dy), v = a.Z * b.Z / r; U += v;
    if (grad) { const dr = -v / r; a.gx -= dr * dx / r; a.gy -= dr * dy / r; b.gx += dr * dx / r; b.gy += dr * dy / r; }
  }
  for (const n of N) for (const e of E) {
    const dx = e.x - n.x, dy = e.y - n.y, r = Math.hypot(dx, dy), a = Math.SQRT2 / e.s, [f, fr, fa] = erfOver(r, a);
    U += -n.Z * f;
    if (grad) { const dr = -n.Z * fr; if (r > 1e-8) { e.gx += dr * dx / r; e.gy += dr * dy / r; n.gx -= dr * dx / r; n.gy -= dr * dy / r; } e.gs += -n.Z * fa * (-Math.SQRT2 / (e.s * e.s)); }
  }
  for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
    const p = E[i], q = E[j], dx = q.x - p.x, dy = q.y - p.y, r = Math.hypot(dx, dy), sg = Math.sqrt(p.s * p.s + q.s * q.s), a = Math.SQRT2 / sg, [f, fr, fa] = erfOver(r, a);
    const [P, Pr, Pi, Pj] = pauliD(r, p.s, q.s, p.spin === q.spin);
    U += f + P;
    if (grad) {
      const dr = fr + Pr; if (r > 1e-8) { p.gx -= dr * dx / r; p.gy -= dr * dy / r; q.gx += dr * dx / r; q.gy += dr * dy / r; }
      const das = -Math.SQRT2 / (sg * sg * sg); p.gs += fa * das * p.s + Pi; q.gs += fa * das * q.s + Pj;
    }
  }
  return U;
}
/* The ground state by FIRE (fast inertial relaxation) on every centre and size. */
function relax(sys, fixNuc, steps = 20000) {
  const vars = [];
  for (const n of sys.nuc) if (!fixNuc) vars.push([n, 'x', 'gx'], [n, 'y', 'gy']);
  for (const e of sys.el) vars.push([e, 'x', 'gx'], [e, 'y', 'gy'], [e, 's', 'gs']);
  const v = new Float64Array(vars.length); let dt = 0.02, a = 0.1, np = 0, U = 0;
  for (let it = 0; it < steps; it++) {
    U = energy(sys, true);
    let P = 0, fn = 0, vn = 0, gmax = 0;
    for (let k = 0; k < vars.length; k++) { const F = -vars[k][0][vars[k][2]]; P += F * v[k]; fn += F * F; vn += v[k] * v[k]; gmax = Math.max(gmax, Math.abs(F)); }
    if (gmax < 1e-7) break;
    fn = Math.sqrt(fn); vn = Math.sqrt(vn);
    for (let k = 0; k < vars.length; k++) { const F = -vars[k][0][vars[k][2]]; v[k] = (1 - a) * v[k] + a * vn * F / (fn || 1); }
    if (P > 0) { if (++np > 5) { dt = Math.min(dt * 1.1, 0.2); a *= 0.99; } } else { np = 0; dt *= 0.5; a = 0.1; v.fill(0); }
    for (let k = 0; k < vars.length; k++) { v[k] += -vars[k][0][vars[k][2]] * dt; const o = vars[k][0]; o[vars[k][1]] += v[k] * dt; if (vars[k][1] === 's' && o.s < 0.05) o.s = 0.05; }
  }
  return U;
}
const el = (x, y, s, spin) => ({ x, y, s, spin });
function atoms() {
  const out = [];
  const H = { nuc: [{ x: 0, y: 0, Z: 1 }], el: [el(0.1, 0, 1.5, 1)] };
  out.push(['H atom', relax(H, true), -0.5, `s = ${H.el[0].s.toFixed(3)} bohr`]);
  const He = { nuc: [{ x: 0, y: 0, Z: 2 }], el: [el(0.1, 0, 1, 1), el(-0.1, 0, 1, -1)] };
  out.push(['He atom', relax(He, true), -2.9037, `s = ${He.el[0].s.toFixed(3)}`]);
  const H2 = { nuc: [{ x: -0.7, y: 0, Z: 1 }, { x: 0.7, y: 0, Z: 1 }], el: [el(0, 0.1, 1.5, 1), el(0, -0.1, 1.5, -1)] };
  const eH2 = relax(H2, false); out.push(['H₂ molecule', eH2, -1.1745, `bond ${(Math.hypot(H2.nuc[1].x - H2.nuc[0].x, H2.nuc[1].y - H2.nuc[0].y) * BOHR).toFixed(3)} Å (real 0.741)`]);
  const Li = { nuc: [{ x: 0, y: 0, Z: 3 }], el: [el(0.05, 0, 0.6, 1), el(-0.05, 0, 0.6, -1), el(2.5, 0.3, 3, 1)] };
  out.push(['Li atom', relax(Li, true), -7.478, `core s ${Li.el[0].s.toFixed(3)}, valence s ${Li.el[2].s.toFixed(3)} at ${Math.hypot(Li.el[2].x, Li.el[2].y).toFixed(2)} bohr`]);
  const H3 = { nuc: [{ x: 0, y: 0, Z: 1 }], el: [el(0.1, 0, 1.5, 1), el(-0.1, 0.1, 1.5, 1)] }; // two same-spin electrons on one proton: Pauli keeps them apart
  out.push(['H⁻ with both spins the same (no bound state wanted)', relax(H3, true), NaN, `electrons ${Math.hypot(H3.el[0].x - H3.el[1].x, H3.el[0].y - H3.el[1].y).toFixed(1)} bohr apart`]);
  for (const [n, E, ex, note] of out) console.log(`${n.padEnd(52)} eFF ${(E).toFixed(4)} Ha (${(E * HA).toFixed(2)} eV)  exact ${isNaN(ex) ? '—' : ex.toFixed(4)}  ${note}`);
}
/* Dynamics: velocity Verlet on centres and sizes (size mass 3/4 mₑ); energy conservation for a hot hydrogen plasma. */
function dyn() {
  const sys = { nuc: [], el: [] }, L = 30; let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 24; k++) { const x = (rnd() - 0.5) * L, y = (rnd() - 0.5) * L; sys.nuc.push({ x, y, Z: 1, m: 1836.15, vx: 0, vy: 0 }); sys.el.push(Object.assign(el(x + 0.3, y, 1.6, k % 2 ? 1 : -1), { vx: (rnd() - 0.5) * 0.4, vy: (rnd() - 0.5) * 0.4, vs: 0 })); }
  const ke = () => sys.nuc.reduce((t, n) => t + 0.5 * n.m * (n.vx ** 2 + n.vy ** 2), 0) + sys.el.reduce((t, e) => t + 0.5 * (e.vx ** 2 + e.vy ** 2) + 0.5 * 0.75 * e.vs ** 2, 0);
  for (const dt of [0.02, 0.01, 0.005]) {
    const S = JSON.parse(JSON.stringify(sys)); const keS = () => S.nuc.reduce((t, n) => t + 0.5 * n.m * (n.vx ** 2 + n.vy ** 2), 0) + S.el.reduce((t, e) => t + 0.5 * (e.vx ** 2 + e.vy ** 2) + 0.5 * 0.75 * e.vs ** 2, 0);
    let U = energy(S, true); const E0 = U + keS(); let worst = 0; const T = 200, n = Math.round(T / dt);
    const t0 = Date.now();
    for (let i = 0; i < n; i++) {
      for (const p of S.nuc) { p.vx -= 0.5 * dt * p.gx / p.m; p.vy -= 0.5 * dt * p.gy / p.m; p.x += dt * p.vx; p.y += dt * p.vy; }
      for (const e of S.el) { e.vx -= 0.5 * dt * e.gx; e.vy -= 0.5 * dt * e.gy; e.vs -= 0.5 * dt * e.gs / 0.75; e.x += dt * e.vx; e.y += dt * e.vy; e.s += dt * e.vs; }
      U = energy(S, true);
      for (const p of S.nuc) { p.vx -= 0.5 * dt * p.gx / p.m; p.vy -= 0.5 * dt * p.gy / p.m; }
      for (const e of S.el) { e.vx -= 0.5 * dt * e.gx; e.vy -= 0.5 * dt * e.gy; e.vs -= 0.5 * dt * e.gs / 0.75; }
      worst = Math.max(worst, Math.abs(U + keS() - E0));
    }
    const sMean = S.el.reduce((t, e) => t + e.s, 0) / S.el.length;
    console.log(`dt ${dt} a.u. (${(dt * 0.02419).toFixed(5)} fs): ${n} steps, energy kept to ${(worst * HA).toFixed(4)} eV of ${(E0 * HA).toFixed(1)} eV; mean size ${(sMean * BOHR).toFixed(2)} Å; ${((Date.now() - t0) / n).toFixed(3)} ms a step`);
  }
}
/* What an electron pair costs in time here, against the game's point-electron pair (a soft Coulomb). */
function cost() {
  const n = 2e6; let t = performance.now(), acc = 0;
  for (let k = 0; k < n; k++) { const r = 0.5 + (k % 1000) * 0.01, s2 = r * r + 0.04; acc += 1 / Math.sqrt(s2) + r / (s2 * Math.sqrt(s2)); }
  const tPoint = (performance.now() - t) / n * 1e6;
  t = performance.now();
  for (let k = 0; k < n / 10; k++) { const r = 0.5 + (k % 1000) * 0.01; acc += erfOver(r, 0.8)[0] + pauliD(r, 1.2, 1.5, k & 1)[0]; }
  const tWave = (performance.now() - t) / (n / 10) * 1e6;
  console.log(`a pair: point electrons ${tPoint.toFixed(1)} ns, wave packets (erf series, Pauli by differences) ${tWave.toFixed(0)} ns: ×${(tWave / tPoint).toFixed(0)} (${acc > 0 ? 'ok' : ''})`);
}
const what = process.argv[2] || 'atoms';
({ atoms, dyn, cost })[what]();
