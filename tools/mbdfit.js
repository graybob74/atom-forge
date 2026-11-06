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
  const { p, q, r0, t } = pr, be = pr.be || 2 * q; let V = 0, R = 0, Ra = 0; const e = [], n = [];
  for (const v of vecs) { const r = Math.hypot(...v), s = sw(r, ON * r0, OFF * r0); if (!s) continue; V += 0.5 * Math.exp(-p * (r / r0 - 1)) * s; R += Math.exp(-2 * q * (r / r0 - 1)) * s; const ee = Math.exp(-be * (r / r0 - 1)) * s; Ra += ee; e.push(ee); n.push(v.map(x => x / r)); }
  let G = 0; const self = +(process.env.SELF || 1);
  for (let j = 0; j < e.length; j++) { if (self) { let g = 0; for (const l of LS) g += t[l]; G += e[j] * e[j] * g; } for (let k = j + 1; k < e.length; k++) { const c = n[j][0] * n[k][0] + n[j][1] * n[k][1] + n[j][2] * n[k][2]; let g = 0; for (const l of LS) g += t[l] * PL[l](c); G += 2 * e[j] * e[k] * g; } }
  const Gm = Ra > 0 ? G / (Ra * Ra) : 0, X = R * (1 + Gm);
  return { V, B: Math.sqrt(Math.max(0, X) + K * K) - K, G: Gm };
}
const Es = (vecs, pr) => { const s = site(vecs, pr); return pr.A * s.V - pr.xi * s.B; };
function Estr(kind, a, ca, pr) { const st = STRUCT[kind](a, ca); let e = 0; for (let s = 0; s < st.basis.length; s++) e += Es(siteVecs(st, s, OFF * pr.r0 * 1.01), pr); return e / st.basis.length; }
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
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--table')) table();
  else for (const el of args.length ? args : Object.keys(D)) report(el, fitEl(el));
}
module.exports = { D, FITS, site, Es, Estr, relax, props, resid, fitEl, report, table };
