'use strict';
/* Fits the many-body metals' directional (angular) constants for the bcc metals (1.26; src/bometal.js, MBD_FIT):
   node tools/mbdfit.js [W Mo …]                  fit (Nelder–Mead from a few starts; ~15 min a metal on one core)
   START='p,q,t2,t4,t6,β;…' node tools/mbdfit.js W   from given starts (a few minutes)
   node tools/mbdfit.js --table                      MBD_FIT rows from the fitted vectors in FITS below
   The model as bometal.js has it, on lattice sums of one atom's neighbours (no game needed; the game's energies agree to
   1e-4 eV an atom): Eᵢ = ½A·Σe^(−p x)s − ξ(√(R(1+Γ) + k²) − k), R = Σe^(−2q x)s, Γ = Σ_l t_l Σ_jk a_j a_k P_l(cos θ_jk)/(Σa)²,
   a = e^(−β x)s, x = r/r₀ − 1, s the switch (1.25–1.45 r₀). A and ξ are solved for the cohesive energy at zero pressure; p,
   q, t₂, t₄, t₆, β are fitted to the bulk modulus, C′ = (C₁₁ − C₁₂)/2, C₄₄, the vacancy energy (unrelaxed), fcc − bcc and
   hcp − bcc at bcc's volume, with the simple cube, simple hexagonal and diamond lattices kept above bcc and t's negative
   part kept to −0.8 (so ρ(1 + Γ) stays positive). Reference values (D below): Kittel's cohesive energies and spacings,
   room-temperature elastic constants (Simmons and Wang), Ehrhart's vacancy energies, structural energy differences from
   DFT and CALPHAD as recalled: the web was not reachable from this session, so they are from memory, worth a check. */
// Lattice sums for the directional many-body model (prototype, standalone).
// E_i = ½Σ_j A e^{-p(r/r0-1)} s(r) − ξ(√(Σ_j e^{-2q(r/r0-1)} s(r) + k²) − k) + Σ_{j<k} u_j u_k g(c_jk),
// u = e^{-γ(r/r0-1)} s(r), g(c) = Σ_l b_l P_l(c)
const P = [
  () => 1, (c) => c, (c) => 1.5 * c * c - 0.5, (c) => 0.5 * (5 * c ** 3 - 3 * c),
  (c) => (35 * c ** 4 - 30 * c * c + 3) / 8, (c) => (63 * c ** 5 - 70 * c ** 3 + 15 * c) / 8,
  (c) => (231 * c ** 6 - 315 * c ** 4 + 105 * c * c - 5) / 16,
];
const K = 0.02;
function sw(r, on, off) { if (r <= on) return 1; if (r >= off) return 0; const t = (r - on) / (off - on); return 1 - t * t * t * (10 - t * (15 - 6 * t)); }
// lattices: return neighbour vectors of one atom within rc (in units of r0 = nearest neighbour of bcc at a given scale)
function latVecs(kind, nn, rc, ca) {
  let basis, cell;
  if (kind === 'bcc') { const a = nn * 2 / Math.sqrt(3); cell = [[a, 0, 0], [0, a, 0], [0, 0, a]]; basis = [[0, 0, 0], [0.5, 0.5, 0.5]]; }
  else if (kind === 'fcc') { const a = nn * Math.SQRT2; cell = [[a, 0, 0], [0, a, 0], [0, 0, a]]; basis = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]]; }
  else if (kind === 'sc') { cell = [[nn, 0, 0], [0, nn, 0], [0, 0, nn]]; basis = [[0, 0, 0]]; }
  else if (kind === 'hcp') { const a = nn, c = a * (ca || Math.sqrt(8 / 3)); cell = [[a, 0, 0], [-a / 2, a * Math.sqrt(3) / 2, 0], [0, 0, c]]; basis = [[0, 0, 0], [1 / 3, 2 / 3, 0.5]]; }
  else if (kind === 'sq2') { cell = [[nn, 0, 0], [0, nn, 0], [0, 0, 1e3]]; basis = [[0, 0, 0]]; } // flat square
  else if (kind === 'tri2') { cell = [[nn, 0, 0], [nn / 2, nn * Math.sqrt(3) / 2, 0], [0, 0, 1e3]]; basis = [[0, 0, 0]]; }
  else if (kind === 'rect2') { cell = [[nn * 2 / Math.sqrt(3), 0, 0], [0, nn * 2 * Math.SQRT2 / Math.sqrt(3), 0], [0, 0, 1e3]]; basis = [[0, 0, 0], [0.5, 0.5, 0]]; } // bcc (110) plane
  const out = [], n = 4;
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) for (const b of basis) {
    const f = [i + b[0], j + b[1], k + b[2]];
    const v = [0, 1, 2].map(d => f[0] * cell[0][d] + f[1] * cell[1][d] + f[2] * cell[2][d]);
    const r = Math.hypot(...v); if (r > 1e-9 && r < rc) out.push(v);
  }
  return out;
}
// one atom's energy pieces from its neighbour vectors: { V: Σ½e^{-p..}s, R: Σ e^{-2q..}s, G: [Σ_{j<k} u u P_l] }
function pieces(vecs, pr) {
  const { p, q, g, r0, on, off } = pr;
  let V = 0, R = 0; const u = [], n = [];
  for (const v of vecs) {
    const r = Math.hypot(...v), s = sw(r, on * r0, off * r0); if (!s) continue;
    V += 0.5 * Math.exp(-p * (r / r0 - 1)) * s; R += Math.exp(-2 * q * (r / r0 - 1)) * s;
    u.push(Math.exp(-g * (r / r0 - 1)) * s); n.push(v.map(x => x / r));
  }
  const G = [0, 0, 0, 0, 0, 0, 0];
  for (let j = 0; j < u.length; j++) for (let k = j + 1; k < u.length; k++) {
    const c = n[j][0] * n[k][0] + n[j][1] * n[k][1] + n[j][2] * n[k][2], w = u[j] * u[k];
    for (let l = 0; l <= 6; l++) G[l] += w * P[l](c);
  }
  return { V, R, G };
}
function Eof(pc, c) { // c: {A, xi, b: [b0..b6]}
  let e = c.A * pc.V - c.xi * (Math.sqrt(pc.R + K * K) - K);
  for (let l = 0; l <= 6; l++) if (c.b[l]) e += c.b[l] * pc.G[l];
  return e;
}
function strain(vecs, F) { return vecs.map(v => [0, 1, 2].map(d => F[d][0] * v[0] + F[d][1] * v[1] + F[d][2] * v[2])); }
// general structures: cell (rows), basis (fractions); energy per atom = mean over sites (needs the coefficient object c and params pr)
const S3 = Math.sqrt(3);
const STRUCT = {
  bcc: (a) => ({ cell: [[a, 0, 0], [0, a, 0], [0, 0, a]], basis: [[0, 0, 0], [0.5, 0.5, 0.5]] }),
  fcc: (a) => ({ cell: [[a, 0, 0], [0, a, 0], [0, 0, a]], basis: [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]] }),
  hcp: (a, ca) => ({ cell: [[a, 0, 0], [-a / 2, a * S3 / 2, 0], [0, 0, a * ca]], basis: [[0, 0, 0], [1 / 3, 2 / 3, 0.5]] }),
  sc: (a) => ({ cell: [[a, 0, 0], [0, a, 0], [0, 0, a]], basis: [[0, 0, 0]] }),
  sh: (a, ca) => ({ cell: [[a, 0, 0], [-a / 2, a * S3 / 2, 0], [0, 0, a * ca]], basis: [[0, 0, 0]] }),
  dia: (a) => ({ cell: [[a, 0, 0], [0, a, 0], [0, 0, a]], basis: [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5], [0.25, 0.25, 0.25], [0.75, 0.75, 0.25], [0.75, 0.25, 0.75], [0.25, 0.75, 0.75]] }),
  A15: (a) => ({ cell: [[a, 0, 0], [0, a, 0], [0, 0, a]], basis: [[0, 0, 0], [0.5, 0.5, 0.5], [0.25, 0, 0.5], [0.75, 0, 0.5], [0.5, 0.25, 0], [0.5, 0.75, 0], [0, 0.5, 0.25], [0, 0.5, 0.75]] }),
  bct: (a, ca) => ({ cell: [[a, 0, 0], [0, a, 0], [0, 0, a * ca]], basis: [[0, 0, 0], [0.5, 0.5, 0.5]] }), // Bain path: ca 1 bcc, √2 fcc
  sq2: (a) => ({ cell: [[a, 0, 0], [0, a, 0], [0, 0, 1e3]], basis: [[0, 0, 0]], flat: 1 }),
  tri2: (a) => ({ cell: [[a, 0, 0], [a / 2, a * S3 / 2, 0], [0, 0, 1e3]], basis: [[0, 0, 0]], flat: 1 }),
  hon2: (a) => ({ cell: [[a * S3, 0, 0], [a * S3 / 2, a * 1.5, 0], [0, 0, 1e3]], basis: [[0, 0, 0], [1 / 3, 1 / 3, 0]], flat: 1 }),
  rect2: (a, ca) => ({ cell: [[a, 0, 0], [0, a * ca, 0], [0, 0, 1e3]], basis: [[0, 0, 0], [0.5, 0.5, 0]], flat: 1 }), // centred rectangular (ca √2: bcc (110))
};
function siteVecs(st, s, rc) {
  const { cell, basis } = st, o = basis[s], out = [];
  const n = cell.map(v => Math.ceil(rc / Math.hypot(...v)) + 1);
  for (let i = -n[0]; i <= n[0]; i++) for (let j = -n[1]; j <= n[1]; j++) for (let k = -(st.flat ? 0 : n[2]); k <= (st.flat ? 0 : n[2]); k++) for (const b of basis) {
    const f = [i + b[0] - o[0], j + b[1] - o[1], k + b[2] - o[2]];
    const v = [0, 1, 2].map(d => f[0] * cell[0][d] + f[1] * cell[1][d] + f[2] * cell[2][d]);
    const r = Math.hypot(...v); if (r > 1e-9 && r < rc) out.push(v);
  }
  return out;
}
const vol = (cell) => { const [a, b, c] = cell; return Math.abs(a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])); };
function Estruct(kind, a, ca, pr, c) {
  const st = STRUCT[kind](a, ca); let e = 0;
  for (let s = 0; s < st.basis.length; s++) e += Eof(pieces(siteVecs(st, s, pr.off * pr.r0 * 1.01), pr), c);
  return { E: e / st.basis.length, V: vol(st.cell) / st.basis.length, flat: st.flat };
}
// relaxed: minimize over a (golden), and over ca if given a range
function golden(f, lo, hi, it = 50) { let a = lo, b = hi; const g = (Math.sqrt(5) - 1) / 2; let x1 = b - g * (b - a), x2 = a + g * (b - a), f1 = f(x1), f2 = f(x2); for (let k = 0; k < it; k++) { if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = b - g * (b - a); f1 = f(x1); } else { a = x1; x1 = x2; f1 = f2; x2 = a + g * (b - a); f2 = f(x2); } } return f1 < f2 ? { x: x1, f: f1 } : { x: x2, f: f2 }; }
function relax(kind, a0, pr, c, ca, caRange) {
  const ea = (ca_) => golden((a) => Estruct(kind, a, ca_, pr, c).E, a0 * 0.85, a0 * 1.15);
  if (!caRange) { const r = ea(ca); return { E: r.f, a: r.x, ca }; }
  const rc = golden((x) => ea(x).f, caRange[0], caRange[1], 30); const r = ea(rc.x); return { E: r.f, a: r.x, ca: rc.x };
}

function nm(f, x0, step, it = 400) {
  let S = x0.map((_, i) => x0.map((v, j) => v + (i === j ? step[j] : 0))); S.unshift(x0.slice());
  let F = S.map(f);
  for (let k = 0; k < it; k++) {
    const o = F.map((v, i) => i).sort((a, b) => F[a] - F[b]); S = o.map(i => S[i]); F = o.map(i => F[i]);
    const n = x0.length, c = x0.map((_, j) => S.slice(0, n).reduce((s, v) => s + v[j], 0) / n);
    const at = (t) => c.map((v, j) => v + t * (S[n][j] - v));
    const xr = at(-1), fr = f(xr);
    if (fr < F[0]) { const xe = at(-2), fe = f(xe); if (fe < fr) { S[n] = xe; F[n] = fe; } else { S[n] = xr; F[n] = fr; } }
    else if (fr < F[n - 1]) { S[n] = xr; F[n] = fr; }
    else { const xc = at(0.5), fc = f(xc); if (fc < F[n]) { S[n] = xc; F[n] = fc; } else { for (let i = 1; i <= n; i++) { S[i] = S[i].map((v, j) => S[0][j] + 0.5 * (v - S[0][j])); F[i] = f(S[i]); } } }
  }
  return { x: S[0], f: F[0] };
}

// directional model, normalized (MEAM-like): E_i = ½AΣe^{-p x}s − ξ(√(R(1+Γ)+K²) − K), R = Σ e_j, e = e^{-2q x}s,
// Γ = Σ_{j≠k} e_j e_k g(c_jk) / R², g = Σ t_l P_l.  node fit2.js [Fe W …]
const GPA = 160.2177;
const D = { // [r0 (bcc nn, Å), Ec, C11, C12, C44 (GPa), Ev, ΔE fcc−bcc, ΔE hcp−bcc] (from memory; flagged)
  Fe: [2.482, 4.28, 231, 135, 116, 1.6, 0.10, 0.08],
  W: [2.741, 8.90, 522, 204, 161, 3.67, 0.48, 0.42],
  Mo: [2.725, 6.82, 464, 158, 109, 3.0, 0.42, 0.43],
  Cr: [2.498, 4.10, 340, 59, 99, 2.0, 0.40, 0.37],
  Na: [3.659, 1.113, 7.3, 6.2, 4.2, 0.42, 0.003, 0.003],
  V: [2.622, 5.31, 228, 119, 43, 2.1, 0.24, 0.25],
  Nb: [2.858, 7.57, 246, 134, 29, 2.65, 0.33, 0.30],
  Ta: [2.860, 8.10, 266, 158, 87, 2.9, 0.24, 0.27],
};
const ON = +(process.env.ON || 1.25), OFF = +(process.env.OFF || 1.45), LS = (process.env.LS || '2,4,6').split(',').map(Number);
const PL = P, BIG = new Map();
// one site's energy pieces: { V, band(ξ=1) } for params pr {p, q, r0, t[]}
function site(vecs, pr) {
  const { p, q, r0, t } = pr, be = pr.be !== undefined ? pr.be : 2 * q, on = pr.on || ON, off = pr.off || OFF; let V = 0, R = 0, Ra = 0; const e = [], n = []; // (pr.on, pr.off: the close-packed metals' switch, 1.15–1.35, 1.26)
  for (const v of vecs) { const r = Math.hypot(...v), s = sw(r, on * r0, off * r0); if (!s) continue; V += 0.5 * Math.exp(-p * (r / r0 - 1)) * s; R += Math.exp(-2 * q * (r / r0 - 1)) * s; const ee = Math.exp(-be * (r / r0 - 1)) * s; Ra += ee; e.push(ee); n.push(v.map(x => x / r)); }
  let G = 0; const self = +(process.env.SELF || 1);
  for (let j = 0; j < e.length; j++) { if (self) { let g = 0; for (const l of LS) g += t[l]; G += e[j] * e[j] * g; } for (let k = j + 1; k < e.length; k++) { const c = n[j][0] * n[k][0] + n[j][1] * n[k][1] + n[j][2] * n[k][2]; let g = 0; for (const l of LS) g += t[l] * PL[l](c); G += 2 * e[j] * e[k] * g; } }
  const Gm = Ra > 0 ? G / (Ra * Ra) : 0, X = R * (1 + Gm);
  return { V, B: Math.sqrt(Math.max(0, X) + K * K) - K, G: Gm };
}
const Es = (vecs, pr) => { const s = site(vecs, pr); return pr.A * s.V - pr.xi * s.B; };
const VC = new Map(); // (neighbour vectors at a = 1 by structure, c/a and site, sorted by length: scaled for each a)
function siteVecsC(kind, a, ca, s, rc) {
  const key = kind + ':' + ca + ':' + s, ru = rc / a; let c = VC.get(key);
  if (!c || c.r < ru) { const st = STRUCT[kind](1, ca), r = ru * 1.5; c = { r, v: siteVecs(st, s, r).map(v => [v, Math.hypot(...v)]).sort((x, y) => x[1] - y[1]) }; VC.set(key, c); }
  const out = []; for (const [v, r] of c.v) { if (r >= ru) break; out.push([v[0] * a, v[1] * a, v[2] * a]); }
  return out;
}
function Estr(kind, a, ca, pr) { const nb = STRUCT[kind](1, ca).basis.length; let e = 0; for (let s = 0; s < nb; s++) e += Es(siteVecsC(kind, a, ca, s, (pr.off || OFF) * pr.r0 * 1.01), pr); return e / nb; }
function relax(kind, a0, pr, ca, rng) {
  const ea = (c) => golden((a) => Estr(kind, a, c, pr), a0 * 0.8, a0 * 1.2);
  if (!rng) { const r = ea(ca); return { E: r.f, a: r.x, ca }; }
  const rc = golden((x) => ea(x).f, rng[0], rng[1], 30); const r = ea(rc.x); return { E: r.f, a: r.x, ca: rc.x };
}
const ID = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], diag = (a, b, c) => [[a, 0, 0], [0, b, 0], [0, 0, c]];
// everything about the bcc crystal for params pr (A and ξ solved for Ec and zero pressure)
function props(d, pr) {
  const [r0] = d, vb = latVecs('bcc', r0, OFF * r0 * 1.3), Om = (2 * r0 / Math.sqrt(3)) ** 3 / 2, h = 0.004;
  const at = (F) => site(strain(vb, F), pr);
  const hP = 1e-5, s0 = at(ID), sp = at(diag(1 + hP, 1 + hP, 1 + hP)), sm = at(diag(1 - hP, 1 - hP, 1 - hP));
  // A·V − ξ·B = −Ec, A·V' − ξ·B' = 0
  const dV = (sp.V - sm.V) / (2 * hP), dB = (sp.B - sm.B) / (2 * hP), det = s0.V * (-dB) - (-s0.B) * dV;
  const A = (d[1] * dB) / det, xi = (d[1] * dV) / det;
  const P = { ...pr, A, xi }, E = (s) => P.A * s.V - P.xi * s.B;
  const e0 = E(s0), d2 = (F1, F2) => (E(at(F1)) - 2 * e0 + E(at(F2))) / (h * h);
  const B = d2(diag(1 + h, 1 + h, 1 + h), diag(1 - h, 1 - h, 1 - h)) / (9 * Om) * GPA;
  const Cp = d2(diag(1 + h, 1 - h, 1), diag(1 - h, 1 + h, 1)) / (4 * Om) * GPA;
  const C44 = d2([[1, h / 2, 0], [h / 2, 1, 0], [0, 0, 1]], [[1, -h / 2, 0], [-h / 2, 1, 0], [0, 0, 1]]) / Om * GPA;
  let ev = 0;
  const vbig = BIG.get(r0) || BIG.set(r0, latVecs('bcc', r0, 2.2 * OFF * r0)).get(r0);
  for (const v of vb) { const r = Math.hypot(...v); if (r > OFF * r0) continue; const nb = vbig.map(u => [u[0] - v[0], u[1] - v[1], u[2] - v[2]]).filter(u => { const q = Math.hypot(...u); return q > 1e-6 && q < OFF * r0 * 1.01; }); nb.push([-v[0], -v[1], -v[2]]); ev += Es(nb.filter(u => Math.hypot(u[0] + v[0], u[1] + v[1], u[2] + v[2]) > 1e-6), P) - Es(nb, P); }
  const ab = 2 * r0 / Math.sqrt(3), V0 = ab ** 3 / 2;
  const fcc = Estr('fcc', Math.cbrt(4 * V0), 0, P) - e0, hcp = Estr('hcp', Math.cbrt(2 * V0 / (Math.sqrt(3) / 2 * 1.633)), 1.633, P) - e0;
  return { P, e0, B, Cp, C44, C11: B + 4 * Cp / 3, C12: B - 2 * Cp / 3, Ev: ev, fcc, hcp, G: s0.G };
}
function resid(d, pr) {
  const o = props(d, pr), [, , C11, C12, C44, Ev, dF, dH] = d, Bt = (C11 + 2 * C12) / 3, Cp = (C11 - C12) / 2;
  const r = [(o.B - Bt) / (0.03 * Bt), (o.Cp - Cp) / Math.max(0.1 * Cp, 0.02 * Bt), (o.C44 - C44) / (0.1 * C44), (o.Ev - Ev) / (0.05 * Ev), (o.fcc - dF) / Math.max(Math.min(0.01, 0.0015 * d[1]), 0.1 * dF), (o.hcp - dH) / Math.max(Math.min(0.01, 0.0015 * d[1]), 0.15 * dH) * (o.hcp > dH ? +(process.env.HUP || 1) : 1)];
  if (process.env.OPEN !== '0') { // open structures kept above bcc (inequalities, fractions of Ec): sc, simple hexagonal, diamond
    const ab = 2 * d[0] / Math.sqrt(3), V0 = ab ** 3 / 2, Ec = d[1];
    for (const [k, a0, ca, lim] of [['sc', Math.cbrt(V0), 0, 0.12], ['sh', Math.cbrt(V0 / (Math.sqrt(3) / 2)), 0.95, 0.08], ['dia', Math.cbrt(8 * V0), 0, 0.2]]) {
      const e = golden((a) => Estr(k, a, ca, o.P), a0 * 0.85, a0 * 1.15, 25).f - o.e0, short = lim * Ec - e;
      if (short > 0) r.push(short / (0.02 * Ec));
    }
  }
  return { o, f: r.reduce((s, x) => s + x * x, 0) };
}
function fitEl(el) {
  const d = D[el];
  const nl = LS.length, mk = (v) => { const t = [0, 0, 0, 0, 0, 0, 0]; LS.forEach((l, i) => t[l] = v[2 + i]); return { p: v[0], q: v[1], r0: d[0], t, be: v[2 + nl] }; };
  const f = (v) => { if (v[0] < 2 || v[1] < 0.5 || v[1] > 0.9 * v[0] || v[0] > 25 || v[2 + nl] < 0 || v[2 + nl] > 40 || LS.reduce((s, l, i) => s + Math.max(0, -v[2 + i]), 0) > +(process.env.TMAX || 0.8)) return 1e9; const r = resid(d, mk(v)); return isFinite(r.f) && r.o.P.A > 0 && r.o.P.xi > 0 ? r.f : 1e9; };
  let best = null;
  if (process.env.START) { for (const st of process.env.START.split(';')) { const v0 = st.split(',').map(Number); let o = nm(f, v0, [0.5, 0.2, ...LS.map(() => 0.03), 2], 500); o = nm(f, o.x, [0.2, 0.1, ...LS.map(() => 0.01), 1], 300); if (!best || o.f < best.f) best = o; } return { d, pr: mk(best.x), f: best.f, v: best.x }; }
  for (const s0 of [[8, 2.5], [6, 1.5], [10, 3], [12, 4], [4, 2]]) for (const ts of [0.05, -0.05]) { for (const b0 of [6, 15, 30]) { const v0 = [...s0, ...LS.map(() => ts), b0]; const o = nm(f, v0, [1, 0.4, ...LS.map(() => 0.05), 3], 400); if (!best || o.f < best.f) best = o; } continue; const o = 0; if (!best || o.f < best.f) best = o; }
  return { d, pr: mk(best.x), f: best.f, v: best.x };
}
function report(el, fr) {
  const { d, pr } = fr, o = props(d, pr), P = o.P, r0 = d[0], ab = 2 * r0 / Math.sqrt(3), V0 = ab ** 3 / 2;
  console.log('START=' + fr.v.map(x => +x.toFixed(5)).join(','));
  console.log(`${el}: p ${pr.p.toFixed(3)} q ${pr.q.toFixed(3)} t ${LS.map(l => 't' + l + ' ' + pr.t[l].toFixed(4)).join(' ')} A ${P.A.toFixed(5)} ξ ${P.xi.toFixed(5)} β ${pr.be.toFixed(2)} res ${fr.f.toFixed(3)}`);
  console.log(`  B ${o.B.toFixed(1)}/${((d[2] + 2 * d[3]) / 3).toFixed(1)} C11 ${o.C11.toFixed(1)}/${d[2]} C12 ${o.C12.toFixed(1)}/${d[3]} C44 ${o.C44.toFixed(1)}/${d[4]} Ev ${o.Ev.toFixed(3)}/${d[5]} fcc ${o.fcc.toFixed(3)}/${d[6]} hcp ${o.hcp.toFixed(3)}/${d[7]} Γbcc ${o.G.toFixed(3)}`);
  const eb = relax('bcc', ab, P), out = { bcc: eb.E.toFixed(3) + ' a' + eb.a.toFixed(4) };
  for (const [k, a0, ca, rng] of [['fcc', Math.cbrt(4 * V0)], ['hcp', Math.cbrt(2 * V0 / (Math.sqrt(3) / 2 * 1.633)), 1.633, [1.45, 1.85]], ['sc', Math.cbrt(V0)], ['sh', Math.cbrt(V0 / (Math.sqrt(3) / 2)), 1, [0.8, 1.3]], ['A15', Math.cbrt(8 * V0)], ['dia', Math.cbrt(8 * V0)]]) {
    const e = relax(k, a0, P, ca, rng); out[k] = (e.E - eb.E).toFixed(3) + (rng ? ' ca' + e.ca.toFixed(3) : '');
  }
  const bain = []; for (const ca of [0.8, 0.9, 1.1, 1.2, 1.3, Math.SQRT2, 1.5, 1.6]) { const a = Math.cbrt(2 * V0 / ca); bain.push(ca.toFixed(2) + ':' + (Estr('bct', a, ca, P) - Estr('bcc', ab, 1, P)).toFixed(3)); }
  const et = relax('tri2', r0, P), f2 = {}; for (const [k, a0, ca, rng] of [['sq2', r0], ['hon2', r0], ['rect2', r0 * 1.1, 1.414, [1.0, 2.2]]]) { const e = relax(k, a0, P, ca, rng); f2[k] = (e.E - et.E).toFixed(3) + (rng ? ' ca' + e.ca.toFixed(2) : '') + ' a' + e.a.toFixed(2); }
  console.log('  relaxed vs bcc', JSON.stringify(out));
  console.log('  Bain', bain.join(' '));
  console.log('  flat vs triangular (' + et.E.toFixed(3) + ' a' + et.a.toFixed(3) + ')', JSON.stringify(f2));
}
const FITS = { // [p, q, t₂, t₄, t₆, β] (the fitted vectors behind MBD_FIT)
  W: [12.295, 2.412, -0.5619, 0.4646, 0.1463, 16.29], Mo: [13.84198, 2.31727, -0.78626, 0.65948, 0.29366, 15.86723],
  Cr: [14.38009, 1.65794, -0.8, 0.6024, 0.40844, 21.29475], V: [10.36218, 2.07833, -0.25916, 0.22191, 0.2277, 16.83132],
  Fe: [9.23, 2.538, 0, -0.8, 0.2924, 0.92], Na: [7.61014, 1.597, -0.8, 1.23522, 0.13797, 0.34077],
  Nb: [9.36011, 2.29999, -0.1938, 0.17705, 0.18753, 17.76515], Ta: [9.47029, 2.42206, -0.1992, 0.14467, 0.14714, 15.61891],
};
const SYM = { Fe: 26, W: 74, Mo: 42, Cr: 24, Na: 11, V: 23, Nb: 41, Ta: 73 };
function table() {
  for (const [el, v] of Object.entries(FITS)) {
    const d = D[el], pr = { p: v[0], q: v[1], r0: d[0], t: [0, 0, v[2], 0, v[3], 0, v[4]], be: v[5] }, o = props(d, pr);
    const row = [o.P.A / 2, o.P.xi, v[0], v[1], d[0], v[5], v[2], v[3], v[4]];
    console.log(`  ${SYM[el]}: [${row.map(x => +x.toPrecision(7)).join(', ')}], // ${el}: bcc a ${(2 * d[0] / Math.sqrt(3)).toFixed(4)} Å; B ${o.B.toFixed(0)}, C11 ${o.C11.toFixed(0)}, C12 ${o.C12.toFixed(0)}, C44 ${o.C44.toFixed(0)} GPa (measured ${d[2]}, ${d[3]}, ${d[4]}); vacancy ${o.Ev.toFixed(2)} eV (${d[5]}); fcc +${o.fcc.toFixed(3)}, hcp +${o.hcp.toFixed(3)} eV (${d[6]}, ${d[7]})`);
  }
}
/* ---- the close-packed metals (1.26, item 4): the same angular term with constants of their own, fitted on their own crystal
   (fcc, or hcp at the ideal c/a for the hcp metals: 1.25's reference, 12 equal neighbours) with 1.25's switch (1.15–1.35 r₀),
   so that the close-packed structure is the lowest. In that crystal Γ does not change when it is scaled evenly, so the
   cohesive energy, spacing and bulk modulus stay 1.25's exactly (A, ξ solved for Ec at zero pressure, p for B); q/p, t₂,
   t₄, t₆, β are fitted to the vacancy energy (unrelaxed), C′ and C₄₄ (C₆₆ and C₄₄ for hcp, unrelaxed), the other
   close-packed structure's and bcc's energies above it (each at its best spacing), the (111) or (0001) surface energy
   (weakly), the relaxed c/a (hcp, weakly), with the simple cube, simple hexagonal, diamond lattices and the flat world's
   square, honeycomb and centred rectangular sheets kept above the crystal and the triangular sheet.
   node tools/mbdfit.js --cp [Cu Al …]   fit (a minute or two a metal)        --cp1 Cu   1.25's numbers (no angles)
   node tools/mbdfit.js --cptable         MBD_FIT rows from CPFITS below
   Reference values (D_CP): Ec, r₀, B, Ev are 1.25's MB_DATA (Kittel, Ehrhart); elastic constants (Simmons and Wang, room
   temperature), structural energy differences (SGTE lattice stabilities and DFT, as recalled), surface energies (Tyson and
   Miller's liquid-extrapolated means): from memory (the web was not reachable from this session), worth a check. */
const CP_ON = 1.15, CP_OFF = 1.35; // (1.25's switch)
const D_CP = { // [Z, structure, r₀ Å, Ec eV, B GPa, Ev eV (0: 0.33 Ec), C11, C12, C44 GPa (hcp: C11, C12, C44), ΔE bcc − ref, ΔE other close-packed − ref eV, surface J/m², c/a (hcp)]
  Cu: [29, 'fcc', 2.56, 3.49, 137.0, 1.28, 168.4, 121.4, 75.4, 0.04, 0.006, 1.79],
  Ag: [47, 'fcc', 2.89, 2.95, 100.7, 1.11, 124.0, 93.4, 46.1, 0.03, 0.003, 1.25],
  Au: [79, 'fcc', 2.88, 3.81, 173.2, 0.93, 192.3, 163.1, 42.0, 0.04, 0.003, 1.50],
  Al: [13, 'fcc', 2.86, 3.39, 72.2, 0.67, 108.2, 61.3, 28.5, 0.09, 0.03, 1.14],
  Ni: [28, 'fcc', 2.49, 4.44, 186.0, 1.79, 246.5, 147.3, 124.7, 0.08, 0.02, 2.38],
  Pd: [46, 'fcc', 2.75, 3.89, 180.8, 1.5, 227.1, 176.0, 71.7, 0.10, 0.03, 2.00],
  Pt: [78, 'fcc', 2.77, 5.84, 278.3, 1.35, 346.7, 250.7, 76.5, 0.10, 0.05, 2.49],
  Pb: [82, 'fcc', 3.50, 2.03, 43.0, 0.58, 49.5, 42.3, 14.9, 0.025, 0.004, 0.60],
  Rh: [45, 'fcc', 2.69, 5.75, 270.4, 1.71, 413, 194, 184, 0.30, 0.06, 2.66],
  Ir: [77, 'fcc', 2.71, 6.94, 355, 1.97, 580, 242, 256, 0.40, 0.10, 3.00],
  Ca: [20, 'fcc', 3.95, 1.84, 15.2, 0, 22.8, 16.0, 14.0, 0.015, 0.005, 0.50],
  Sr: [38, 'fcc', 4.30, 1.72, 11.6, 0, 14.7, 9.9, 9.9, 0.006, 0.003, 0.41],
  Mg: [12, 'hcp', 3.20, 1.51, 35.4, 0.79, 59.7, 26.2, 16.4, 0.03, 0.015, 0.76, 1.624],
  Zn: [30, 'hcp', 2.66, 1.35, 59.8, 0.54, 163.7, 36.4, 38.8, 0.03, 0.02, 0.99, 1.633], // (c/a 1.856 measured: its out-of-plane neighbours are 9% farther; the model's reference is ideal hcp, as 1.25's)
  Cd: [48, 'hcp', 2.98, 1.16, 46.7, 0.46, 114.5, 39.5, 19.85, 0.025, 0.015, 0.76, 1.633], // (c/a 1.886, as Zn)
  Be: [4, 'hcp', 2.23, 3.32, 100.3, 1.0, 292, 27, 162, 0.07, 0.06, 1.63, 1.568],
  Ti: [22, 'hcp', 2.89, 4.85, 105.1, 1.55, 160, 90, 46.5, 0.10, 0.06, 1.99, 1.587],
  Zr: [40, 'hcp', 3.17, 6.25, 83.3, 1.7, 143.4, 72.8, 32.0, 0.08, 0.04, 2.00, 1.593],
  Hf: [72, 'hcp', 3.13, 6.44, 109, 0, 181, 77, 55.7, 0.15, 0.10, 2.19, 1.581],
  Co: [27, 'hcp', 2.50, 4.39, 191.4, 1.34, 307, 165, 75.5, 0.10, 0.02, 2.52, 1.623],
  Sc: [21, 'hcp', 3.25, 3.90, 43.5, 0, 99.3, 39.7, 27.7, 0.06, 0.04, 1.28, 1.594],
  Y: [39, 'hcp', 3.55, 4.37, 36.6, 0, 77.9, 29.2, 24.3, 0.10, 0.03, 1.13, 1.571],
  Ru: [44, 'hcp', 2.65, 6.74, 320.8, 0, 563, 188, 181, 0.50, 0.13, 3.04, 1.582],
  Os: [76, 'hcp', 2.68, 8.17, 418, 0, 765, 229, 270, 0.60, 0.15, 3.44, 1.579],
  Re: [75, 'hcp', 2.74, 8.03, 372, 0, 616, 273, 161, 0.30, 0.10, 3.63, 1.615],
};
const SQ3 = Math.sqrt(3), CA0 = Math.sqrt(8 / 3);
function cp125t(d) { // (1.25's q/p, closed form from Ev/Ec on 12 neighbours, as bometal.js mbParam: for --cp1)
  const k2 = K * K, S = Math.sqrt(12 + k2), S11 = Math.sqrt(11 + k2), ratio = (t) => 12 * (S - S11 - t / S) / (S - K - 12 * t / S), target = (d[5] || 0.33 * d[3]) / d[3];
  let lo = 0.15, hi = 0.45; if (ratio(lo) <= target) hi = lo; else if (ratio(hi) >= target) lo = hi; else for (let it = 0; it < 60; it++) { const m = 0.5 * (lo + hi); if (ratio(m) > target) lo = m; else hi = m; }
  return 0.5 * (lo + hi);
}
const cpRef = (d) => d[1] === 'fcc' ? { kind: 'fcc', a: d[2] * Math.SQRT2, ca: 0 } : { kind: 'hcp', a: d[2], ca: CA0 };
const cpVol = (d) => d[2] ** 3 / Math.SQRT2;
// a cluster of lattice points around site s (origin there) and the neighbour vectors of the site and of each of its neighbours
function cluster(kind, a, ca, s, rc) { const st = STRUCT[kind](a, ca); return siteVecs(st, s, rc); }
function cpProps(d, v) { // v: [q/p, t₂, t₄, t₆, β]; p from B, A and ξ from Ec at zero pressure (as props)
  const r0 = d[2], Ec = d[3], Bt = d[4], ref = cpRef(d), Om = cpVol(d), rc = CP_OFF * r0 * 1.01;
  const vecs = cluster(ref.kind, ref.a, ref.ca, 0, rc);
  const mk = (p) => ({ p, q: v[0] * p, r0, t: [0, 0, v[1], 0, v[2], 0, v[3]], be: v[4], on: CP_ON, off: CP_OFF });
  const solveAX = (pr) => {
    const at = (F) => site(strain(vecs, F), pr), hP = 1e-5, s0 = at(ID), sp = at(diag(1 + hP, 1 + hP, 1 + hP)), sm = at(diag(1 - hP, 1 - hP, 1 - hP));
    const dV = (sp.V - sm.V) / (2 * hP), dB = (sp.B - sm.B) / (2 * hP), det = s0.V * (-dB) - (-s0.B) * dV;
    const P = { ...pr, A: (Ec * dB) / det, xi: (Ec * dV) / det }, E = (s) => P.A * s.V - P.xi * s.B, h = 0.004, e0 = E(s0);
    return { P, e0, at, E, B: (E(at(diag(1 + h, 1 + h, 1 + h))) - 2 * e0 + E(at(diag(1 - h, 1 - h, 1 - h)))) / (h * h) / (9 * Om) * GPA };
  };
  // p for the bulk modulus (the secant in p; B grows with p)
  let p0 = 8, f0 = solveAX(mk(p0)), p1 = 11, f1 = solveAX(mk(p1));
  for (let it = 0; it < 30 && Math.abs(f1.B / Bt - 1) > 1e-7; it++) { let p2 = p1 - (f1.B - Bt) * (p1 - p0) / (f1.B - f0.B); if (!isFinite(p2)) break; p2 = Math.max(1, Math.min(40, p2)); if (p2 === p1) break; p0 = p1; f0 = f1; p1 = p2; f1 = solveAX(mk(p1)); }
  const { P, e0, at, E, B } = f1, h = 0.004, d2 = (F1, F2) => (E(at(F1)) - 2 * e0 + E(at(F2))) / (h * h);
  const o = { P, e0, B, G: at(ID).G };
  if (ref.kind === 'fcc') { o.Cp = d2(diag(1 + h, 1 - h, 1), diag(1 - h, 1 + h, 1)) / (4 * Om) * GPA; o.C44 = d2([[1, h / 2, 0], [h / 2, 1, 0], [0, 0, 1]], [[1, -h / 2, 0], [-h / 2, 1, 0], [0, 0, 1]]) / Om * GPA; }
  else { o.Cp = d2([[1, h / 2, 0], [h / 2, 1, 0], [0, 0, 1]], [[1, -h / 2, 0], [-h / 2, 1, 0], [0, 0, 1]]) / Om * GPA; o.C44 = d2([[1, 0, 0], [0, 1, h / 2], [0, h / 2, 1]], [[1, 0, 0], [0, 1, -h / 2], [0, -h / 2, 1]]) / Om * GPA; } // (hcp: Cp holds C₆₆ = (C₁₁ − C₁₂)/2; unrelaxed)
  o.C11 = B + 4 * o.Cp / 3; o.C12 = B - 2 * o.Cp / 3;
  // the vacancy (unrelaxed): each neighbour's energy without the centre, less with it
  const big = cluster(ref.kind, ref.a, ref.ca, 0, 2.2 * rc); let ev = 0;
  for (const u of vecs) { const nb = big.map(w => [w[0] - u[0], w[1] - u[1], w[2] - u[2]]).filter(w => { const q = Math.hypot(...w); return q > 1e-6 && q < rc; }); nb.push([-u[0], -u[1], -u[2]]); ev += Es(nb.filter(w => Math.hypot(w[0] + u[0], w[1] + u[1], w[2] + u[2]) > 1e-6), P) - Es(nb, P); }
  o.Ev = ev;
  return o;
}
// a structure's energy per atom relaxed in a (and c/a in a range), against the reference crystal's
function cpRelax(kind, Vat, P, ca, rng, it) {
  const a0 = kind === 'bcc' || kind === 'bct' ? Math.cbrt(2 * Vat) : kind === 'fcc' || kind === 'dia' ? Math.cbrt((kind === 'dia' ? 8 : 4) * Vat) : kind === 'sc' ? Math.cbrt(Vat) : kind === 'hcp' ? Math.cbrt(2 * Vat / (SQ3 / 2 * (ca || CA0))) : kind === 'sh' ? Math.cbrt(Vat / (SQ3 / 2 * ca)) : Math.sqrt(Vat);
  const ea = (c) => { // (a coarse scan first: with the arms' own switch the energy against spacing can have two minima, 1.26)
    let bx = a0, bf = Infinity; for (let k = 0; k <= 14; k++) { const a = a0 * (0.85 + 0.35 * k / 14), e = Estr(kind, a, c, P); if (e < bf) { bf = e; bx = a; } }
    return golden((a) => Estr(kind, a, c, P), bx - 0.025 * a0, bx + 0.025 * a0, it || 40);
  };
  if (!rng) { const r = ea(ca); return { E: r.f, a: r.x, ca }; }
  const rc = golden((x) => ea(x).f, rng[0], rng[1], 25); const r = ea(rc.x); return { E: r.f, a: r.x, ca: rc.x };
}
// the surface energy (unrelaxed), J/m²: (111) for fcc, (0001) for hcp; also (100) for fcc
function cpSurface(d, P, face) {
  const ref = cpRef(d), r0 = d[2], rc = CP_OFF * r0 * 1.01, st = STRUCT[ref.kind](ref.a, ref.ca);
  const n = face === '100' ? [1, 0, 0] : ref.kind === 'fcc' ? [1 / SQ3, 1 / SQ3, 1 / SQ3] : [0, 0, 1];
  const pts = siteVecs(st, 0, 4 * rc); pts.push([0, 0, 0]);
  const H = pts.filter(u => u[0] * n[0] + u[1] * n[1] + u[2] * n[2] <= 1e-6), depth = (u) => -(u[0] * n[0] + u[1] * n[1] + u[2] * n[2]);
  const layers = [...new Set(H.map(u => +depth(u).toFixed(5)))].sort((x, y) => x - y).filter(z => z < rc * 1.2);
  const lat = (u) => { const z = depth(u); return Math.hypot(u[0] + z * n[0], u[1] + z * n[1], u[2] + z * n[2]); };
  const e0 = Es(siteVecs(st, 0, rc), P); let sum = 0;
  for (const z of layers) {
    const c = H.filter(u => Math.abs(depth(u) - z) < 1e-4).sort((x, y) => lat(x) - lat(y))[0];
    const nb = H.map(w => [w[0] - c[0], w[1] - c[1], w[2] - c[2]]).filter(w => { const q = Math.hypot(...w); return q > 1e-6 && q < rc; });
    sum += Es(nb, P) - e0;
  }
  const area = face === '100' ? d[2] * d[2] : SQ3 / 2 * d[2] * d[2]; // (an atom's share of the face)
  return sum / area * 16.02177;
}
function cpAll(d, v, full) {
  const o = cpProps(d, v), P = o.P, Vat = cpVol(d), ref = cpRef(d), Ec = d[3];
  const eref = d[1] === 'fcc' ? o.e0 : o.e0; // (the reference crystal is at zero pressure by construction)
  o.bcc = cpRelax('bcc', Vat, P, 0, null, full ? 50 : 30).E - eref;
  o.other = d[1] === 'fcc' ? cpRelax('hcp', Vat, P, CA0, full ? [1.45, 1.85] : null, full ? 50 : 30).E - eref : cpRelax('fcc', Vat, P, 0, null, full ? 50 : 30).E - eref;
  if (d[1] === 'hcp') { const h = 0.01, Va = Vat, E = (c) => Estr('hcp', Math.cbrt(2 * Va / (SQ3 / 2 * c)), c, P), em = E(CA0 - h), e0 = E(CA0), ep = E(CA0 + h); o.caPred = CA0 - ((ep - em) / (2 * h)) / ((ep - 2 * e0 + em) / (h * h)); o.caCurv = (ep - 2 * e0 + em) / (h * h); }
  o.surf = cpSurface(d, P);
  if (d[1] === 'fcc') o.bain = [1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3].map(ca => [ca, cpRelax('bct', Vat, P, ca, null, full ? 40 : 20).E - eref]); // (the Bain path, bcc to fcc, each at its best volume)
  o.open = {}; for (const [k, ca, lim] of [['sc', 0, 0.1], ['sh', 0.95, 0.07], ['dia', 0, 0.2]]) o.open[k] = [cpRelax(k, Vat, P, ca, null, full ? 50 : 22).E - eref, lim * Ec];
  const r0 = d[2];
  const flat = (k, ca, rng) => { const ea = (c) => golden((a) => Estr(k, a, c, P), r0 * 0.8, r0 * 1.25, full ? 50 : 25); if (!rng) return ea(ca).f; return golden((x) => ea(x).f, rng[0], rng[1], full ? 30 : 15).f; };
  o.tri = golden((a) => Estr('tri2', a, 0, P), r0 * 0.8, r0 * 1.1, full ? 50 : 25).f;
  o.flat = { sq2: flat('sq2', 0) - o.tri, hon2: flat('hon2', 0) - o.tri, rect2: flat('rect2', 1.414, [1.0, 2.2]) - o.tri };
  return o;
}
function cpResid(d, v, o, o125) {
  const [, kind, , Ec, Bt, Ev0, C11, C12, C44, dB, dO, gs, ca] = d, Ev = Ev0 || 0.33 * Ec, Cp = (C11 - C12) / 2;
  const r = [(o.Ev - Ev) / (0.03 * Ev), (o.C44 - C44) / (0.1 * C44), (o.Cp - Cp) / Math.max((+process.env.CPW || 1) * Cp, 0.03 * Bt),
    (o.bcc - dB) / Math.max(0.006, 0.15 * dB), (o.other - dO) / Math.max(0.004, 0.3 * dO), (o.surf - gs) / (0.3 * gs)];
  if (o125) { // (at least as good as 1.25: the vacancy, C₄₄ and the surface no farther from the measured values than 1.25's, to a little)
    const worse = (x, x0, ref, tol) => Math.max(0, Math.abs(x - ref) - Math.abs(x0 - ref) - tol);
    r.push(worse(o.Ev, o125.Ev, Ev, 0.01 * Ev) / (0.005 * Ev), worse(o.C44, o125.C44, C44, 0.01 * C44) / (0.01 * C44), worse(o.surf, o125.surf, gs, 0.01 * gs) / (0.01 * gs));
  }
  if (kind === 'hcp') r.push((o.caPred - ca) / 0.03);
  if (o.bain) for (let k = 0; k < o.bain.length; k++) { // (the Bain path: kept above a rise from fcc to bcc (no body-centred tetragonal lattice on the way below it), and downhill all the way from bcc, so bcc is unstable as for these metals)
    const [c, e] = o.bain[k], x = (Math.SQRT2 - c) / (Math.SQRT2 - 1), lb = 0.35 * dB * x * (2 - x); if (e < lb) r.push((lb - e) / (0.003 + 0.05 * dB));
    const up = k ? e - o.bain[k - 1][1] : 0; if (up > 0) r.push(up / (+process.env.UPW || 0.03));
  }
  for (const [e, lim] of Object.values(o.open)) if (e < lim) r.push((lim - e) / (0.02 * Ec));
  for (const [k, e] of Object.entries(o.flat)) { const lim = k === 'rect2' ? -0.001 * Ec : 0.03 * Ec; if (e < lim) r.push((lim - e) / (0.01 * Ec)); } // (the centred rectangular sheet holds the triangular one at c/a √3: kept from going below it)
  return r.reduce((s, x) => s + x * x, 0);
}
function cpFit(el, starts) {
  const d = D_CP[el], o125 = cpAll(d, [cp125t(d), 0, 0, 0, 0]);
  const f = (v) => { if (v[0] < 0.1 || v[0] > 0.6 || v[4] < 0 || v[4] > 40 || [v[1], v[2], v[3]].reduce((s, t) => s + Math.max(0, -t), 0) > 0.8 || Math.max(...[v[1], v[2], v[3]].map(Math.abs)) > 3) return 1e9; try { const o = cpAll(d, v); return o.P.A > 0 && o.P.xi > 0 && isFinite(o.Ev) ? cpResid(d, v, o, o125) : 1e9; } catch (e) { return 1e9; } };
  let best = null;
  for (const v0 of starts || (d[1] === 'fcc' ? [[0.24, 0.3, -0.4, 0.14, 12], [0.25, 0, -0.25, 0.1, 16], [0.3, -0.3, -0.6, 0.2, 9]] : [[0.2, 0, -0.3, -0.1, 12], [0.25, 0.2, -0.5, -0.05, 8], [0.3, -0.2, -0.2, -0.2, 16]])) {
    let o = nm(f, v0, [0.03, 0.1, 0.1, 0.1, 2], +(process.env.NIT || 250)); o = nm(f, o.x, [0.01, 0.03, 0.03, 0.03, 0.5], 150);
    if (!best || o.f < best.f) best = o;
  }
  return { el, d, v: best.x, f: best.f };
}
function cpReport(el, v) {
  const d = D_CP[el], o = cpAll(d, v, true), Ev = d[5] || 0.33 * d[3], s100 = d[1] === 'fcc' ? cpSurface(d, o.P, '100') : 0;
  let caR = '';
  if (d[1] === 'hcp') { const r = cpRelax('hcp', cpVol(d), o.P, CA0, [1.45, 1.85], 50); caR = ` c/a ${r.ca.toFixed(3)} (${d[12]}) ΔE ${(r.E - o.e0).toFixed(4)}`; }
  const bain = []; if (d[1] === 'fcc') for (const ca of [1, 1.1, 1.2, 1.3, 1.35, 1.38, Math.SQRT2, 1.45, 1.5, 1.6]) bain.push(ca.toFixed(2) + ':' + (Estr('bct', Math.cbrt(2 * cpVol(d) / ca), ca, o.P) - o.e0).toFixed(3));
  const P = o.P;
  console.log(`${el} (${d[1]}): START=${v.map(x => +x.toFixed(5)).join(',')} p ${P.p.toFixed(3)} q ${P.q.toFixed(3)} A ${(P.A / 2).toFixed(5)} ξ ${P.xi.toFixed(5)} Γ ${o.G.toFixed(4)}`);
  console.log(`  B ${o.B.toFixed(1)}/${d[4]} C11 ${o.C11.toFixed(0)}/${d[6]} C12 ${o.C12.toFixed(0)}/${d[7]} C44 ${o.C44.toFixed(1)}/${d[8]} ${d[1] === 'hcp' ? 'C66' : 'C′'} ${o.Cp.toFixed(1)}/${((d[6] - d[7]) / 2).toFixed(1)} Ev ${o.Ev.toFixed(3)}/${Ev.toFixed(2)} | bcc−ref ${o.bcc.toFixed(4)}/${d[9]} ${d[1] === 'fcc' ? 'hcp' : 'fcc'}−ref ${o.other.toFixed(4)}/${d[10]} | surface ${o.surf.toFixed(2)}/${d[11]}${s100 ? ' (100) ' + s100.toFixed(2) : ''} J/m²${caR}`);
  if (o.bain) console.log('  relaxed Bain ' + o.bain.map(([c, e]) => c.toFixed(2) + ':' + e.toFixed(4)).join(' '));
  console.log(`  open ${Object.entries(o.open).map(([k, [e]]) => k + ' ' + e.toFixed(3)).join(' ')} | flat tri ${o.tri.toFixed(3)} ${Object.entries(o.flat).map(([k, e]) => k + ' +' + e.toFixed(3)).join(' ')}${bain.length ? ' | Bain ' + bain.join(' ') : ''}`);
  return o;
}
const CPFITS = { // [q/p, t₂, t₄, t₆, β] (the fitted vectors behind the close-packed rows of MBD_FIT)
  Cu: [0.22647, 0.28837, -0.39752, 0.13884, 12.83529],
  Ag: [0.20968, 0.3043, -0.262, 0.08909, 13.1278],
  Au: [0.34698, 0.18259, -0.07996, 0.0323, 13.31702],
  Al: [0.39712, 0.08386, -0.35602, 0.20208, 14.99651],
  Ni: [0.18701, 0.23749, -0.52196, 0.2252, 13.87276],
  Pd: [0.18579, 0.46606, -0.42042, 0.24915, 13.09974],
  Pt: [0.36225, 0.11978, -0.22546, 0.17947, 13.03258],
  Pb: [0.31285, 0.19373, -0.15426, 0.06567, 12.2851],
  Rh: [0.32316, -0.03411, -0.4932, 0.28247, 17.20312],
  Ir: [0.33922, -0.12925, -0.47953, 0.32039, 18.91186],
  Ca: [0.29528, -0.06768, -0.4166, 0.15505, 11.24055],
  Sr: [0.29602, -0.0944, -0.34872, 0.12167, 10.85512],
  Mg: [0.1, -0.07543, -0.25134, -0.18107, 12.29158],
  Zn: [0.25045, -0.54583, -0.07572, -0.17845, 17.45234],
  Cd: [0.25489, -0.60332, -0.02025, -0.17643, 12.84966],
  Be: [0.35591, -0.50923, -0.18184, -0.10893, 18.10131],
  Ti: [0.31895, -0.06635, -0.34284, -0.08151, 10.45595],
  Zr: [0.34404, 0.05407, -0.20527, -0.03645, 14.55652],
  Hf: [0.32948, -0.30101, -0.40696, -0.09203, 9.71401],
  Co: [0.30701, 0.16587, -0.29789, 0.02125, 14.01691],
  Sc: [0.31638, -0.17648, -0.38891, -0.04039, 10.979],
  Y: [0.29259, 0.14978, -0.42484, 0.01522, 13.93068],
  Ru: [0.32882, -0.06068, -0.68724, -0.05208, 12.05112],
  Os: [0.32845, -0.22817, -0.49052, -0.0813, 15.61631],
  Re: [0.32877, -0.37183, -0.36985, -0.05832, 10.82363],
};
function cpTable() {
  for (const [el, v] of Object.entries(CPFITS)) {
    const d = D_CP[el], o = cpAll(d, v, true), row = [o.P.A / 2, o.P.xi, o.P.p, o.P.q, d[2], v[4], v[1], v[2], v[3]];
    console.log(`  ${d[0]}: [${row.map((x, k) => +x.toPrecision(k < 4 ? 10 : 7)).join(', ')}, 1], // ${el}: ${d[1]} r₀ ${d[2]} Å; B ${o.B.toFixed(0)}, ${d[1] === 'fcc' ? `C11 ${o.C11.toFixed(0)}, C12 ${o.C12.toFixed(0)}, C44 ${o.C44.toFixed(0)} GPa (measured ${d[6]}, ${d[7]}, ${d[8]})` : `C44 ${o.C44.toFixed(0)}, C66 ${o.Cp.toFixed(0)} GPa (measured ${d[8]}, ${((d[6] - d[7]) / 2).toFixed(0)})`}; vacancy ${o.Ev.toFixed(2)} eV (${d[5] || '—'}); bcc +${o.bcc.toFixed(3)}, ${d[1] === 'fcc' ? 'hcp' : 'fcc'} +${o.other.toFixed(3)} eV (${d[9]}, ${d[10]}); surface ${o.surf.toFixed(2)} J/m² (${d[11]})`);
  }
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--table')) table();
  else if (args.includes('--cptable')) cpTable();
  else if (args.includes('--cp1')) for (const el of args.filter(a => !a.startsWith('--'))) cpReport(el, [cp125t(D_CP[el]), 0, 0, 0, 2]);
  else if (args.includes('--cp')) for (const el of args.filter(a => !a.startsWith('--')).length ? args.filter(a => !a.startsWith('--')) : Object.keys(D_CP)) { const t0 = Date.now(), r = cpFit(el, process.env.START ? process.env.START.split(';').map(x => x.split(',').map(Number)) : null); console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s, residual ${r.f.toFixed(3)})`); cpReport(el, r.v); }
  else for (const el of args.length ? args : Object.keys(D)) report(el, fitEl(el));
}
module.exports = { D_CP, CPFITS, cpProps, cpAll, cpResid, cpFit, cpReport, cpSurface, cpRelax, D, FITS, site, Es, Estr, relax, props, resid, fitEl, report, table };
