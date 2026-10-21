'use strict';
/* ------------------------------------------------------------------ particle physics
   What collisions make when they are hard enough: new particles (muons, pions, kaons, η, Λ and τ, flying through
   the chamber until they decay or leave it; nucleons, antinucleons and light nuclei) and new nuclei. In this file
   masses, energies and momenta are MeV (c = 1); kinetic energies handed to particles are eV, as everywhere else.
   Every event shares out its energy and momentum over relativistic two-dimensional phase space, so both are kept
   exactly, and its books (nucBegin, nucLeft) close to the last eV: rest mass made or destroyed goes through
   W.ledger.nuc. */

const MEV = 1e6;
const M_P = PHYS.MP * PHYS.AMU_MEV, M_N = PHYS.MN * PHYS.AMU_MEV;
function nucMeV(Z, N) { return Z <= 0 ? N * M_N : (Z * PHYS.MP + N * PHYS.MN) * PHYS.AMU_MEV - bindingE(Z, N); } // a bare nucleus, as p.m has it

/* The unstable particles (PDG 2024): mass (MeV), charge, mean life (s), baryon number, colour, antiparticle, and
   decays as [branching fraction, products]. Products: 'p' 'n' 'pbar' 'nbar' 'e-' 'e+' 'g' (a photon) 'nu' 'nub' or
   another particle here. */
const XP = {
  'mu-': { lab: 'μ⁻', m: 105.6584, q: -1, tau: 2.1970e-6, col: [110, 245, 200], cc: 'mu+', dec: [[1, ['e-', 'nub', 'nu']]] },
  'mu+': { lab: 'μ⁺', m: 105.6584, q: 1, tau: 2.1970e-6, col: [110, 245, 200], cc: 'mu-', dec: [[1, ['e+', 'nu', 'nub']]] },
  'pi+': { lab: 'π⁺', m: 139.5704, q: 1, tau: 2.6033e-8, col: [255, 160, 70], cc: 'pi-', dec: [[0.99988, ['mu+', 'nu']], [0.00012, ['e+', 'nu']]] },
  'pi-': { lab: 'π⁻', m: 139.5704, q: -1, tau: 2.6033e-8, col: [255, 160, 70], cc: 'pi+', dec: [[0.99988, ['mu-', 'nub']], [0.00012, ['e-', 'nub']]] },
  pi0: { lab: 'π⁰', m: 134.9768, q: 0, tau: 8.43e-17, col: [255, 214, 160], cc: 'pi0', dec: [[0.98823, ['g', 'g']], [0.01174, ['e+', 'e-', 'g']]] },
  'K+': { lab: 'K⁺', m: 493.677, q: 1, tau: 1.2380e-8, col: [245, 232, 90], cc: 'K-', dec: [[0.6356, ['mu+', 'nu']], [0.2067, ['pi+', 'pi0']], [0.0558, ['pi+', 'pi+', 'pi-']], [0.0507, ['pi0', 'e+', 'nu']], [0.0335, ['pi0', 'mu+', 'nu']], [0.0176, ['pi+', 'pi0', 'pi0']]] },
  K0S: { lab: 'K⁰s', m: 497.611, q: 0, tau: 8.954e-11, col: [232, 222, 150], cc: 'K0S', dec: [[0.692, ['pi+', 'pi-']], [0.307, ['pi0', 'pi0']]] },
  K0L: { lab: 'K⁰ʟ', m: 497.611, q: 0, tau: 5.116e-8, col: [232, 222, 150], cc: 'K0L', dec: [[0.2028, ['pi+', 'e-', 'nub']], [0.2028, ['pi-', 'e+', 'nu']], [0.1352, ['pi+', 'mu-', 'nub']], [0.1352, ['pi-', 'mu+', 'nu']], [0.1952, ['pi0', 'pi0', 'pi0']], [0.1254, ['pi+', 'pi-', 'pi0']]] },
  eta: { lab: 'η', m: 547.862, q: 0, tau: 5.02e-19, col: [255, 185, 225], cc: 'eta', dec: [[0.3936, ['g', 'g']], [0.3257, ['pi0', 'pi0', 'pi0']], [0.2292, ['pi+', 'pi-', 'pi0']], [0.0422, ['pi+', 'pi-', 'g']]] },
  Lam: { lab: 'Λ', m: 1115.683, q: 0, B: 1, tau: 2.632e-10, col: [195, 160, 255], cc: 'Lamb', dec: [[0.639, ['p', 'pi-']], [0.358, ['n', 'pi0']]] },
  'tau-': { lab: 'τ⁻', m: 1776.86, q: -1, tau: 2.903e-13, col: [255, 115, 150], cc: 'tau+', dec: [[0.1782, ['e-', 'nub', 'nu']], [0.1739, ['mu-', 'nub', 'nu']], [0.1082, ['pi-', 'nu']], [0.2549, ['pi-', 'pi0', 'nu']], [0.0926, ['pi-', 'pi0', 'pi0', 'nu']], [0.0899, ['pi-', 'pi-', 'pi+', 'nu']], [0.0455, ['pi-', 'pi-', 'pi+', 'pi0', 'nu']], [0.0104, ['pi-', 'pi0', 'pi0', 'pi0', 'nu']], [0.0070, ['K-', 'nu']]] },
};
function conjTok(t) { return XP[t] ? XP[t].cc : ({ 'e-': 'e+', 'e+': 'e-', nu: 'nub', nub: 'nu', p: 'pbar', pbar: 'p', n: 'nbar', nbar: 'n' })[t] || t; }
for (const [k, of, lab] of [['K-', 'K+', 'K⁻'], ['Lamb', 'Lam', 'Λ̄'], ['tau+', 'tau-', 'τ⁺']]) { // the antiparticles: every charge reversed, decays mirrored
  const s = XP[of];
  XP[k] = Object.assign({}, s, { lab, q: -s.q, B: s.B ? -s.B : 0, cc: of, dec: s.dec.map(([b, ps]) => [b, ps.map(conjTok)]) });
}

/* ---- final-state items: { t: 'x', sp } an unstable particle, { t: 'A', Z, N, anti } a nucleus or nucleon,
   { t: 'e', q } an electron or positron, { t: 'g' } a photon, { t: 'v', anti } a neutrino */
const NUCTOK = { p: [1, 0, 0], n: [0, 1, 0], pbar: [1, 0, 1], nbar: [0, 1, 1], d: [1, 1, 0], t: [1, 2, 0], h: [2, 1, 0], a: [2, 2, 0] };
function item(tok) {
  if (typeof tok !== 'string') return tok;
  if (XP[tok]) return { t: 'x', sp: tok };
  const nt = NUCTOK[tok];
  if (nt) return { t: 'A', Z: nt[0], N: nt[1], anti: !!nt[2] };
  if (tok === 'e-' || tok === 'e+') return { t: 'e', q: tok === 'e-' ? -1 : 1 };
  return tok === 'g' ? { t: 'g' } : { t: 'v', anti: tok === 'nub' };
}
function massOf(it) { return it.t === 'x' ? XP[it.sp].m : it.t === 'A' ? nucMeV(it.Z, it.N) : it.t === 'e' ? PHYS.MEC2 : 0; }
function conjItem(it) {
  return it.t === 'x' ? { t: 'x', sp: XP[it.sp].cc } : it.t === 'A' ? { t: 'A', Z: it.Z, N: it.N, anti: !it.anti } : it.t === 'e' ? { t: 'e', q: -it.q } : it.t === 'v' ? { t: 'v', anti: !it.anti } : it;
}
function labelOf(it) {
  if (it.t === 'x') return XP[it.sp].lab;
  if (it.t === 'e') return it.q < 0 ? 'e⁻' : 'e⁺';
  if (it.t === 'g') return 'γ';
  if (it.t === 'v') return it.anti ? 'ν̄' : 'ν';
  const { Z, N, anti } = it;
  if (Z === 1 && N === 0) return anti ? 'p̄' : 'p';
  if (Z === 0 && N === 1) return anti ? 'n̄' : 'n';
  if (!anti && Z === 2 && N === 2) return 'α';
  if (!anti && Z === 1 && N === 1) return 'd';
  if (!anti && Z === 1 && N === 2) return 't';
  return nucSymA(Z, N, anti);
}
function partLabel(p) { return p.k === ELEC ? 'e⁻' : p.k === POS ? 'e⁺' : labelOf({ t: 'A', Z: p.Z, N: p.N, anti: !!p.anti }); }
function sortKey(it) {
  if (it.t === 'A') { const A = it.Z + it.N; return (it.anti ? 2000 : 0) + (A > 4 ? -A : 1000 - 10 * A - it.Z); }
  return it.t === 'x' ? 3000 + XP[it.sp].m / 10 : it.t === 'e' ? 4000 : it.t === 'g' ? 5000 : 6000;
}
/* "²³Na + 2p + 3π⁰ + γ": heavy nuclei first, then light ones, antimatter, mesons, leptons, photons, neutrinos. */
function summarize(items) {
  const cnt = new Map();
  for (const it of items) { const l = labelOf(it), e = cnt.get(l) || { n: 0, k: sortKey(it) }; e.n++; cnt.set(l, e); }
  const parts = [...cnt.entries()].sort((a, b) => a[1].k - b[1].k).map(([l, e]) => (e.n > 1 ? e.n : '') + l);
  return parts.length > 9 ? parts.slice(0, 8).join(' + ') + ' + …' : parts.join(' + ');
}
function pickBr(list) { // [[weight, value], …]
  let tot = 0; for (const c of list) tot += Math.max(0, c[0]);
  let u = rnd() * tot;
  for (const c of list) { u -= Math.max(0, c[0]); if (u < 0) return c[1]; }
  return list[list.length - 1][1];
}
function poisson(m) {
  if (m > 30) return Math.max(0, Math.round(m + Math.sqrt(m) * gauss()));
  const L = Math.exp(-m); let k = 0, p = 1;
  do { k++; p *= rnd(); } while (p > L);
  return k - 1;
}
const _lnF = [0];
function lnFact(n) { for (let k = _lnF.length; k <= n; k++) _lnF[k] = _lnF[k - 1] + Math.log(k); return _lnF[n]; }

/* ---- four-momenta [E, px, py] (MeV) */
function p4of(p, bare) { // bare: a nucleus without its electrons (they ride along and are handed back after)
  const mf = restE(p) / MEV, m = bare && p.k === NUC ? nucMeV(p.Z, p.N) : mf, K = keOf(p) / MEV * (m / mf);
  const pm = Math.sqrt(Math.max(0, K * (K + 2 * m)));
  let ux = 1, uy = 0;
  if (p.rad) { ux = p.ux; uy = p.uy; } else { const v = Math.hypot(p.vx, p.vy); if (v > 0) { ux = p.vx / v; uy = p.vy / v; } }
  return [m + K, pm * ux, pm * uy];
}
const add4 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mass4 = (v) => Math.sqrt(Math.max(0, v[0] * v[0] - v[1] * v[1] - v[2] * v[2]));
const toLab = (v, bx, by) => boost(v[0], v[1], v[2], -bx, -by); // from a frame moving at (bx, by) (units of c) to the lab
const toRest = (v, bx, by) => boost(v[0], v[1], v[2], bx, by); // and back
function rdir() { const th = rnd() * 2 * Math.PI; return [Math.cos(th), Math.sin(th)]; }
const turn2 = (ux, uy, a) => [ux * Math.cos(a) - uy * Math.sin(a), ux * Math.sin(a) + uy * Math.cos(a)];
function breakupQ(M, m1, m2) { const s = M * M, a = s - (m1 + m2) * (m1 + m2), b = s - (m1 - m2) * (m1 - m2); return a > 0 && b > 0 ? Math.sqrt(a * b) / (2 * M) : 0; }
/* Two bodies flying apart along ±(ux, uy) in the rest frame of mass M. */
function twoBody(M, m1, m2, ux, uy) { const q = breakupQ(M, m1, m2); return [[Math.sqrt(m1 * m1 + q * q), q * ux, q * uy], [Math.sqrt(m2 * m2 + q * q), -q * ux, -q * uy]]; }
/* n bodies of masses ms sharing the rest energy M, their momenta drawn uniformly over relativistic phase space. In
   two dimensions the two-body phase space is the same for every split (π/2M), so drawing the intermediate masses
   uniformly (sorted uniform numbers, as in James's GENBOD) gives the invariant phase space with no weights.
   Returns [E, px, py] for each in the rest frame, or null if M is too small. */
function phaseSpace(M, ms) {
  const n = ms.length;
  if (!n) return [];
  if (n === 1) return [[M, 0, 0]];
  let sum = 0; for (const m of ms) sum += m;
  const T = M - sum;
  if (!(T >= 0)) return null;
  const r = []; for (let i = 0; i < n - 2; i++) r.push(rnd()); r.sort((a, b) => a - b);
  const Mk = new Array(n); let acc = 0;
  for (let k = 0; k < n; k++) { acc += ms[k]; Mk[k] = k === 0 ? ms[0] : k === n - 1 ? M : acc + T * r[k - 1]; }
  const v = [];
  for (let k = 1; k < n; k++) { // the first k bodies (mass Mk[k−1]) and body k fly apart in the rest frame of the first k + 1
    const q = breakupQ(Mk[k], Mk[k - 1], ms[k]), [ux, uy] = rdir(), Es = Math.sqrt(Mk[k - 1] * Mk[k - 1] + q * q);
    if (k === 1) v.push([Es, q * ux, q * uy]); // (the first body on its own: given its momentum directly, as it may be massless)
    else { const bx = q * ux / Es, by = q * uy / Es; for (let i = 0; i < k; i++) v[i] = toLab(v[i], bx, by); }
    v.push([Math.sqrt(ms[k] * ms[k] + q * q), -q * ux, -q * uy]);
  }
  return v;
}


/* ---- jets: the string model (as in Lund / Pythia, simplified). In a hard collision a quark and an antiquark (or a
   quark and a diquark) fly apart joined by a colour string; it breaks again and again into quark–antiquark pairs, and
   the pieces are hadrons laid out in order along the string: evenly in rapidity (a plateau) along its axis, each with
   a transverse momentum of about 0.35 GeV. Leading particles (a collision's baryons) sit at the two ends. The
   plateau's width is set by the energy, and the momenta are then made to add up exactly: zero total momentum and the
   whole energy M (MeV) in the rest frame. Returns [E, px, py] for each item, or null.
   opts.thermal: a quark–gluon plasma freezing out instead: rapidities spread as a Gaussian (a fluid expanding along
   the beams), transverse momenta thermal at about 156 MeV, blue-shifted by the flow (heavier particles faster). */
function jetMomenta(items, M, ax, ay, opts = {}) {
  const n = items.length, ms = items.map(massOf);
  let msum = 0; for (const m of ms) msum += m;
  if (!(msum < M - 1)) return null;
  if (n < 3) return phaseSpace(M, ms);
  const r = new Array(n), pt = new Array(n);
  const order = []; for (let i = 0; i < n; i++) order.push(i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  if (opts.lead) { // leading particles to the ends, alternately
    const L = order.filter(i => opts.lead(items[i])), rest = order.filter(i => !opts.lead(items[i]));
    order.length = 0; const left = [], right = []; L.forEach((i, k) => (k % 2 ? right : left).push(i));
    order.push(...left, ...rest, ...right.reverse());
  }
  order.forEach((i, rank) => { r[i] = opts.thermal ? gauss() : 2 * (rank + 0.5) / n - 1 + 0.35 * gauss() / n; });
  for (let i = 0; i < n; i++) {
    if (opts.thermal) { const Te = 160 + 140 * ms[i] / 1000; let mt = ms[i] - Te * Math.log(Math.max(1e-12, rnd() * rnd())) / 1.5; pt[i] = Math.sqrt(Math.max(0, mt * mt - ms[i] * ms[i])) * (rnd() < 0.5 ? -1 : 1); }
    else pt[i] = 350 * gauss() / Math.SQRT2 * 1.2;
  }
  let mts = ms.map((m, i) => Math.hypot(m, pt[i])), base = mts.reduce((a, b) => a + b, 0);
  if (base >= M) { const k = Math.sqrt(Math.max(0, (M - msum) / (base - msum))) * 0.9; for (let i = 0; i < n; i++) pt[i] *= k; mts = ms.map((m, i) => Math.hypot(m, pt[i])); }
  const Esum = (Y) => { let s = 0; for (let i = 0; i < n; i++) s += mts[i] * Math.cosh(Y * r[i]); return s; };
  let lo = 0, hi = 1; while (Esum(hi) < M && hi < 60) hi *= 2;
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (Esum(mid) < M) lo = mid; else hi = mid; }
  const Y = (lo + hi) / 2, nx = -ay, ny = ax;
  const p = r.map((ri, i) => { const pl = mts[i] * Math.sinh(Y * ri); return [pl * ax + pt[i] * nx, pl * ay + pt[i] * ny]; });
  let sx = 0, sy = 0; for (const v of p) { sx += v[0]; sy += v[1]; }
  for (const v of p) { v[0] -= sx / n; v[1] -= sy / n; } // (no total momentum)
  const Ef = (xi) => { let s = 0; for (let i = 0; i < n; i++) s += Math.sqrt(ms[i] * ms[i] + xi * xi * (p[i][0] * p[i][0] + p[i][1] * p[i][1])); return s; };
  lo = 0; hi = 2; while (Ef(hi) < M && hi < 1e6) hi *= 2;
  for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (Ef(mid) < M) lo = mid; else hi = mid; }
  const xi = (lo + hi) / 2;
  return p.map((v, i) => { const px = v[0] * xi, py = v[1] * xi; return [Math.sqrt(ms[i] * ms[i] + px * px + py * py), px, py]; });
}
const isBaryonItem = (it) => it.t === 'A' || it.sp === 'Lam' || it.sp === 'Lamb';
/* A string drawn as it breaks (W.strings, render.js drawStrings): at (x, y) along (ax, ay), in real time. */
function addString(x, y, ax, ay, n) { (W.strings || (W.strings = [])).push({ x, y, ax, ay, n: Math.min(14, Math.max(3, n)), t0: W.rt }); if (W.strings.length > 12) W.strings.shift(); }

/* ---- quark–gluon plasma. Where nuclei overlap with more than about 3 GeV per nucleon of motion in their own frame
   (√s_NN ≳ 8 GeV, where experiments first see it), protons and neutrons melt into free quarks and gluons. The drop
   expands and cools in about 10⁻²³ s and at 156 MeV (1.8 trillion K) freezes back into hadrons in the proportions
   of a gas in thermal equilibrium at that temperature (the statistical hadronization model that fits RHIC and LHC
   yields): mostly pions, about one in eight a kaon, antibaryons suppressed by e^(−μ_B/T) where the net baryons of the
   collision remain (μ_B from Cleymans et al.'s fit, 1.31 GeV / (1 + 0.273 √s_NN/GeV)). The number of hadrons follows
   from the energy, spread in rapidity as Landau's expanding fluid (σ² = ln(√s_NN / 2m_p)). */
const QGP = { T: 156, eps: 3000, minA: 30, MAX: 3000 };
function qgpHadrons(MF, Bp, Qp, sNN) {
  const T = QGP.T, muB = 1308 / (1 + 0.273 * sNN / 1000), sig2 = Math.max(0.3, Math.log(sNN / (2 * 938.27)));
  let N = Math.round(MF / (560 * Math.exp(sig2 / 2)));
  N = clamp(N, Bp + 2, QGP.MAX);
  for (let tries = 0; tries < 20; tries++) {
    const fx = [], fixed = [];
    const pairs = Math.round(Math.max(0, (N - Bp) * 0.045 * Math.exp(-muB / T) + 0.5 * gauss() * Math.sqrt(N * 0.045 * Math.exp(-muB / T) + 0.01)));
    const nB = Bp + pairs;
    for (let i = 0; i < nB; i++) { if (rnd() < 0.12) { fixed.push('Lam'); fx.push({ k: 'Kp', q: rnd() < 0.5 ? 1 : 0 }); } else fx.push({ k: 'N', q: rnd() < 0.5 ? 1 : 0 }); }
    for (let i = 0; i < pairs; i++) { if (rnd() < 0.12) { fixed.push('Lamb'); fx.push({ k: 'Km', q: rnd() < 0.5 ? -1 : 0 }); } else fx.push({ k: 'Nb', q: rnd() < 0.5 ? -1 : 0 }); }
    let left = N - fx.length - fixed.length;
    const kPairs = Math.round(Math.max(0, left) * 0.065);
    for (let i = 0; i < kPairs; i++) fx.push({ k: 'Kp', q: rnd() < 0.5 ? 1 : 0 }, { k: 'Km', q: rnd() < 0.5 ? -1 : 0 });
    left -= 2 * kPairs;
    const nEta = Math.round(Math.max(0, left) * 0.03); for (let i = 0; i < nEta; i++) fixed.push('eta');
    left -= nEta;
    for (let i = 0; i < left; i++) { const u = rnd(); fx.push({ k: 'pi', q: u < 1 / 3 ? -1 : u < 2 / 3 ? 0 : 1 }); }
    if (!repairCharge(fx, Qp)) continue;
    const out = fixed.map(item).concat(fx.map(f => item(flexTok(f))));
    if (out.reduce((t, it) => t + massOf(it), 0) >= MF * 0.95) { N = Math.max(Bp + 2, Math.round(N * 0.8)); continue; }
    return { items: out, muB, sig: Math.sqrt(sig2) };
  }
  return null;
}
function addQGP(x, y, n, sNN) { (W.qgp || (W.qgp = [])).push({ x, y, n, sNN, t0: W.rt }); if (W.qgp.length > 6) W.qgp.shift(); }


/* ---- muons in matter. A charged unstable particle in flight (muon, pion, kaon) ionizes the atoms it passes as any
   fast charge does (Bethe: about z²·n_e/β² for each, closest passes most), so it slows down. A negative muon slowed to
   a few keV is caught by an atom and falls, giving off X-rays, to an orbit 207 times closer than an electron's (it is
   207 times heavier): a muonic atom.
   - On hydrogen it makes muonic hydrogen (μp, μd, μt): neutral and 200 times smaller than an atom, it slips between
     molecules. Its muon moves to a heavier isotope it meets (the orbit there is deeper: μp → μd → μt), and μt
     meeting a deuteron forms the molecule dμt, in which d and t are held so close that they fuse within a picosecond:
     d + t → ⁴He + n + 17.6 MeV. The muon is usually set free (about 10 keV) to do it again: muon-catalysed fusion,
     ~100 fusions per muon in real liquid D–T, until it decays (2.2 µs) or sticks to an α (0.85% of the time).
     d d and t t fuse too, much more slowly (³He + n or t + p; ⁴He + 2n), the muon sticking more often.
   - On a heavier atom it stays bound, and either decays (2.2 µs) or is captured by the nucleus, μ⁻ + p → n + ν, at a
     rate that grows as Z_eff⁴ (about 32·Z_eff⁴ per second; in heavy atoms capture wins in well under a µs); the nucleus,
     one charge down and some 15 MeV hot, boils off a neutron or two. (Its electrons are left as they were: in a real
     muonic atom they see one charge fewer.)
   These steps, like decay, run on the nuclear clock (Lab → Decay speed). Rates: in liquid hydrogen (where a muonic atom
   always has a neighbour); here they apply when one is within 2.5 Å. */
const MU_M = 105.6584, MU_STOP = 2000, MU_RATES = { tr_pd: 1.5e10, tr_dt: 2.8e8, dt: 1.0e8, dd: 5e6, tt: 2e6 };
const MU_EB = (Z) => 2.531e-3 * Z * Z / (1 + (Z / 105) ** 2); // 1s binding (MeV), point Coulomb with a reduced mass, eased for the nucleus's size
const MU_ZEFF = [[1, 1], [6, 5.7], [10, 8.9], [20, 16], [26, 19.6], [40, 25], [50, 28], [82, 34], [100, 36]];
function muZeff(Z) { for (let i = 1; i < MU_ZEFF.length; i++) if (Z <= MU_ZEFF[i][0]) { const [z0, e0] = MU_ZEFF[i - 1], [z1, e1] = MU_ZEFF[i]; return e0 + (e1 - e0) * (Z - z0) / (z1 - z0); } return 36; }
for (const [k, N, lab] of [['muP', 0, 'μp'], ['muD', 1, 'μd'], ['muT', 2, 'μt']]) { // muonic hydrogen: neutral, decaying as its muon does
  const tok = ['p', 'd', 't'][N], mN = nucMeV(1, N), Eb = 13.6057e-6 * (MU_M * mN / (MU_M + mN)) / 0.51099895; // (Bohr's 13.6 eV with the muon's reduced mass: 2.53 keV for μp)
  XP[k] = { lab, m: nucMeV(1, N) + MU_M - Eb, Eb, q: 0, tau: 2.1970e-6, col: [150, 255, 230], cc: k, atom: true, N, dec: [[1, [tok, 'e-', 'nub', 'nu']]] };
}
XP.muHe = { lab: '(μα)⁺', m: nucMeV(2, 2) + MU_M - MU_EB(2), q: 1, tau: 2.1970e-6, col: [255, 225, 150], cc: 'muHe', stuck: true, dec: [[1, ['a', 'e-', 'nub', 'nu']]] };
/* Ionization along a charged exo's step (x0, y0) → its position now; it loses the energy given away. */
function exoIonize(o, x0, y0) {
  const beta2 = Math.max(1e-8, (o.v / PHYS.C) ** 2), z2 = o.q * o.q;
  const hits = segTargets(x0, y0, o.x, o.y, 1.0, (t) => t.k === NUC && t.Z > 0 && t.ne > 0);
  let lost = 0;
  for (const [, tg, b] of hits) {
    if (tg.dead || tg.ne <= 0) continue;
    const w = 1 / (1 + (b / 0.4) * (b / 0.4));
    const dE = Math.min(0.3 * o.KE, 0.0047 * z2 * tg.ne / beta2 * w);
    if (dE < 0.01) continue;
    o.KE -= dE; lost += dE;
    const ie = ionizationCost(tg), nx = -o.uy * (rnd() < 0.5 ? 1 : -1), ny = o.ux * (nx === -o.uy ? 1 : -1);
    if (dE > ie && freeElectronCount() < MAX_FREE_E && W.parts.length < MAX_PARTS) { if (ejectElectron(tg, dE - ie, nx, ny)) W.count.ionize++; else dumpHeat(dE, tg, tg); }
    else { const dv = Math.sqrt(2 * dE * tg.im); tg.vx += nx * dv * 0.7; tg.vy += ny * dv * 0.7; updateFast(tg); }
    if (o.KE <= 1) break;
  }
  if (lost > 0) { o.KE = Math.max(0.5, o.KE); exoSpeed(o); }
}
/* An event between an exo and the atoms in W.parts it involves (tgs): the exo and they go, items come out with
   momenta moms (MeV, lab), the books close exactly (what is left over goes to the photons among them, or to the
   products' motion). The targets' electrons come out free (items 'e-' added by the caller). */
function exoEvent(o, tgs, items, moms, x, y, kind, text, sub) {
  const S = nucBegin(tgs), gh = tgs.map(ghostOf);
  for (const t of tgs) kill(t);
  o.dead = true; o.fate = o.fate || text;
  const made = spawnItems(items, moms, x, y);
  closeEvent(S, made, x, y, o.KE + o.m * MEV, o.m * MEV);
  if (kind) { nucEvent(kind, x, y, text, gh, sub); log('nuc', `${text}${sub ? ` (${sub})` : ''}`); }
  return made;
}
const randDir4 = (m, K) => { const [ux, uy] = rdir(), p = Math.sqrt(Math.max(0, K * (K + 2 * m))); return [m + K, p * ux, p * uy]; };
/* A free μ⁻ slowed to a few keV: caught by the nearest atom within 4 Å. Returns true if it was. */
function muStop(o) {
  let tg = null, bd = 16;
  nearby(o.x, o.y, 4, (p) => { if (p.dead || p.k !== NUC || p.Z < 1 || p.anti || p.muB) return; const d = (p.x - o.x) ** 2 + (p.y - o.y) ** 2; if (d < bd) { bd = d; tg = p; } });
  if (!tg) return false;
  const x = tg.x, y = tg.y, el = speciesLabel(tg);
  if (tg.Z === 1 && tg.N <= 2) { // muonic hydrogen: the atom's electron goes free, X-rays carry off the binding
    const sp = ['muP', 'muD', 'muT'][tg.N], kT = PHYS.KB * Math.max(W.T, 20);
    const items = [item(sp), item('g'), item('g')], moms = [randDir4(XP[sp].m, 1.5 * kT / MEV), [1, ...rdir()], [1, ...rdir()]];
    for (let i = 0; i < tg.ne; i++) { items.push(item('e-')); moms.push(randDir4(PHYS.MEC2, 2 / MEV)); }
    const made = exoEvent(o, [tg], items, moms, x, y, 'capture', `Muonic atom: μ⁻ caught by ${el} → ${XP[sp].lab}`, `X-rays carry off ${fmtE(XP[sp].Eb * MEV)}: its orbit is 207 times closer than an electron’s`);
    const nx = made.xs[0]; if (nx) nx.cyc = o.cyc || 0;
    return true;
  }
  // a heavier atom keeps it bound
  const Eb = MU_EB(tg.Z) * MEV, S = nucBegin([]);
  o.dead = true; o.fate = `caught by ${el}: a muonic atom`;
  tg.muB = { m: MU_M * MEV - Eb, Eb };
  (W.muBound || (W.muBound = [])).push(tg);
  const made = { ps: [], xs: [], rays: [[item('g'), 1, ...rdir()], [item('g'), 1, ...rdir()]], lost: 0 };
  closeEvent(S, made, x, y, o.KE + Eb, Eb); // (the binding energy and the muon's motion leave as X-rays; the rest of its mass stays bound)
  nucEvent('capture', x, y, `Muonic atom: μ⁻ caught by ${el}`, [], `muonic X-rays, ${fmtE(Eb)} in all`);
  log('nuc', `Muonic atom: μ⁻ caught by ${el}; it falls to an orbit 207× closer, giving off ${fmtE(Eb)} of X-rays`);
  return true;
}
/* Muonic hydrogen meets hydrogen isotopes: the muon moves to the heavier one, or the pair fuses (dμt, dμd, tμt).
   clock: nuclear seconds this step. Returns true if o is gone. */
function muAtomTick(o, clock) {
  const N0 = XP[o.sp].N; let best = null, bd = 6.25;
  nearby(o.x, o.y, 2.5, (p) => { if (p.dead || p.k !== NUC || p.Z !== 1 || p.anti || p.N > 2) return; const d = (p.x - o.x) ** 2 + (p.y - o.y) ** 2; if (d < bd) { bd = d; best = p; } });
  if (!best) return false;
  const N1 = best.N, P = (rate) => rnd() < 1 - Math.exp(-rate * clock);
  const x = best.x, y = best.y, bl = speciesLabel(best);
  const P4 = add4([o.m + o.KE / MEV, ...(() => { const p = Math.sqrt(Math.max(0, o.KE / MEV * (o.KE / MEV + 2 * o.m))); return [p * o.ux, p * o.uy]; })()], p4of(best)), bx = P4[1] / P4[0], by = P4[2] / P4[0], M = mass4(P4);
  const els = (n) => { const it = [], mo = []; for (let i = 0; i < n; i++) { it.push(item('e-')); mo.push(toLab(randDir4(PHYS.MEC2, 3 / MEV), bx, by)); } return [it, mo]; };
  // transfer to a heavier isotope: μp + d → μd + p, μp/μd + t → μt + …
  if (N1 > N0 && P(N0 === 0 ? MU_RATES.tr_pd : MU_RATES.tr_dt)) {
    const sp = ['muP', 'muD', 'muT'][N1], [ei, em] = els(best.ne);
    const items = [item(sp), item(['p', 'd', 't'][N0])].concat(ei), vs = twoBody(M - ei.length * PHYS.MEC2 - 1e-9, XP[sp].m, massOf(items[1]), ...rdir());
    if (!vs) return false;
    const moms = vs.map(v => toLab(v, bx, by)).concat(em);
    const made = exoEvent(o, [best], items, moms, x, y, null, `the muon moved to ${bl}`);
    if (made.xs[0]) made.xs[0].cyc = o.cyc || 0;
    log('nuc', `Muon transfer: ${XP[o.sp].lab} + ${bl} → ${XP[sp].lab} + ${['p', 'd', 't'][N0]} (the heavier nucleus holds it deeper)`);
    return true;
  }
  // fusion in the muonic molecule
  const pair = [N0, N1].sort().join('');
  const ch = pair === '12' ? { rate: MU_RATES.dt, out: [['a', 'n']], stick: 0.0085, lab: 'dμt' } : pair === '11' ? { rate: MU_RATES.dd, out: [['h', 'n'], ['t', 'p']], stick: 0.12, lab: 'dμd' } : pair === '22' ? { rate: MU_RATES.tt, out: [['a', 'n', 'n']], stick: 0.14, lab: 'tμt' } : null;
  if (!ch || !P(ch.rate)) return false;
  const toks = ch.out[Math.floor(rnd() * ch.out.length)], stick = rnd() < (toks[0] === 't' ? 0.01 : ch.stick);
  const nucs = toks.map(item), [ei] = els(best.ne);
  // the muon (free, about 10 keV, or stuck to the α / ³He as it forms) and the electrons first; the nuclei share the rest
  let fixed, fixedM;
  if (stick && (toks[0] === 'a' || toks[0] === 'h')) { nucs[0] = item('muHe'); fixed = []; fixedM = []; } else { fixed = [item('mu-')]; fixedM = [randDir4(MU_M, (0.5 + rnd()) / 1000)]; } // (set free with about 10 keV, it slows within a micrometre of liquid D–T, far beyond this chamber's few nanometres: here it leaves slow, to be caught again nearby)
  let Pf = [0, 0, 0]; for (const v of fixedM) Pf = add4(Pf, v);
  const em0 = ei.map(() => randDir4(PHYS.MEC2, 3 / MEV)); for (const v of em0) Pf = add4(Pf, v);
  const Prem = [M - Pf[0], -Pf[1], -Pf[2]], Mr = mass4(Prem), rx = Prem[1] / Prem[0], ry = Prem[2] / Prem[0];
  const vs = phaseSpace(Mr, nucs.map(massOf));
  if (!vs) return false;
  const items = nucs.concat(fixed, ei), moms = vs.map(v => toLab(toLab(v, rx, ry), bx, by)).concat(fixedM.map(v => toLab(v, bx, by)), em0.map(v => toLab(v, bx, by)));
  const cyc = (o.cyc || 0) + 1, outTxt = summarize(nucs.concat(fixed));
  const made = exoEvent(o, [best], items, moms, x, y, 'fusion', `Muon-catalysed fusion: ${ch.lab} → ${outTxt}`, `${fmtE((M - nucs.concat(fixed, ei).reduce((t, it) => t + massOf(it), 0)) * MEV)} released; this muon’s fusion no. ${cyc}${stick ? ': it stuck to the helium nucleus, and the chain ends' : ''}`);
  W.count.fusion++;
  for (const x2 of made.xs) if (x2.sp === 'mu-') x2.cyc = cyc;
  return true;
}
/* Muons bound in heavier atoms: decay in orbit, or capture by the nucleus (μ⁻ + p → n + ν). */
function muBoundTick(dt) {
  const clock = W.decayOn ? dt * PHYS.TU_S * W.warp : 0;
  for (let i = W.muBound.length - 1; i >= 0; i--) {
    const p = W.muBound[i], B = p.muB;
    if (!B || p.dead || p.Z < 2) { // (its atom gone in some other event: the muon's remaining mass leaves with it)
      if (B) { W.ledger.escaped += B.m; W.ledger.nuc += B.m; } if (!p.dead && p.Z < 2) p.muB = null;
      W.muBound.splice(i, 1); continue;
    }
    if (!(clock > 0)) continue;
    const lc = 32 * muZeff(p.Z) ** 4, ld = 1 / 2.197e-6;
    if (rnd() >= 1 - Math.exp(-(lc + ld) * clock)) continue;
    W.muBound.splice(i, 1); p.muB = null;
    const x = p.x, y = p.y, el = speciesLabel(p), mm = B.m / MEV;
    const Z = p.Z, N = p.N, Ms = nucMeV(Z - 1, N + 1) + 8 + 12 * rnd(), Min = nucMeV(Z, N) + mm;
    const canCapture = !nuclideInfo(Z - 1, N + 1).unbound && Ms < Min;
    if (!canCapture || rnd() < ld / (lc + ld)) { // decay in orbit
      const items = ['e-', 'nub', 'nu'].map(item), vs = phaseSpace(mm, items.map(massOf));
      const S = nucBegin([]), made = spawnItems(items, vs, x, y);
      closeEvent(S, made, x, y, B.m, B.m); W.count.decay++;
      log('nuc', `Decay in orbit: the muon in ${el} → e⁻ + ν̄ + ν`); nucEvent('decay', x, y, `μ⁻ in ${el} decays → e⁻ ν̄ ν`, [], '2.2 µs mean life');
      continue;
    }
    // nuclear capture: μ⁻ + p → n + ν; the nucleus, one charge down and hot, cools
    const [ux, uy] = rdir(), v = twoBody(Min, Ms, 0, ux, uy), items = [item('nu')], moms = [v[1]];
    compoundDecay(Z - 1, N + 1, Ms, v[0], false, items, moms, 0);
    const ne = p.ne, S = nucBegin([p]), gh = [ghostOf(p)];
    kill(p);
    const made = spawnItems(items, moms, x, y);
    let left = ne; for (const q of made.ps.filter(q => q.k === NUC && q.Z > 0).sort((a, b) => b.Z - a.Z)) { if (left <= 0) break; const k = Math.min(left, q.Z); q.ne = k; left -= k; refresh(q); }
    for (let k = 0; k < left && W.parts.length < MAX_PARTS; k++) { const [ex, ey] = rdir(); const e = addLepton(ELEC, x + 0.3 * ex, y + 0.3 * ey); setMotion(e, 2 + 5 * rnd(), ex, ey); made.ps.push(e); }
    closeEvent(S, made, x, y, B.m, B.m);
    const txt = `μ⁻ + ${el} → ${summarize(items)}`;
    nucEvent('capture', x, y, `Muon capture: ${txt}`, gh, `μ⁻ + p → n + ν inside the nucleus`); log('nuc', `Muon capture by the nucleus: ${txt}`);
    tally(items, ['μ⁻', el], txt);
  }
}

/* ---- making the products, and the books */
const MAX_EXO = 1500;
/* Products at (x, y): items with their lab four-momenta. Nuclei, nucleons and leptons join W.parts, unstable particles
   W.exo; photons and neutrinos wait in made.rays to be sent off last with what the books leave them. */
function spawnItems(items, moms, x, y) {
  const made = { ps: [], xs: [], rays: [], lost: 0 };
  for (let i = 0; i < items.length; i++) {
    const it = items[i], P = moms[i], m = massOf(it), pm = Math.hypot(P[1], P[2]);
    let ux, uy;
    if (pm > 1e-12) { ux = P[1] / pm; uy = P[2] / pm; } else [ux, uy] = rdir();
    const K = Math.max(0, P[0] - m) * MEV, ox = x + ux * 0.08, oy = y + uy * 0.08;
    if (it.t === 'g' || it.t === 'v') { made.rays.push([it, P[0] * MEV, ux, uy]); continue; }
    if (it.t === 'x' ? W.exo.length >= MAX_EXO : W.parts.length >= MAX_PARTS) { made.lost += P[0] * MEV; continue; } // (no room: carried off, as if it had left)
    if (it.Z > Z_MAX) { made.lost += P[0] * MEV; continue; } // (a last guard: nothing past the last element is made)
    if (it.t === 'x') { made.xs.push(addExo(it.sp, ox, oy, K, ux, uy)); continue; }
    const q = it.t === 'e' ? addLepton(it.q < 0 ? ELEC : POS, ox, oy) : addNuc(it.Z, it.N, 0, ox, oy, 0, 0, it.anti);
    setMotion(q, K, ux, uy);
    if (!q.trk && K > 2000) startTrack(q);
    made.ps.push(q);
  }
  return made;
}
/* Close an event's books. S: from nucBegin, before anything changed (the W.parts that went in); Ein, mIn: the energy
   and rest mass (eV) of what came in from outside W.parts (a decaying unstable particle). Photons and neutrinos get
   exactly the energy left over, shared in proportion to their own; with none, the products' motion takes it. */
function closeEvent(S, made, x, y, Ein = 0, mIn = 0) {
  if (made.lost) W.ledger.escaped += made.lost;
  let mX = 0, EX = 0;
  for (const o of made.xs) { mX += o.m * MEV; EX += o.m * MEV + o.KE; }
  const Qm = nucMassLoss(S);
  W.ledger.nuc += Qm + mIn - mX;
  const Qrel = Qm - EX + Ein;
  let left = nucLeft(S, Qrel);
  if (made.rays.length) {
    if (left < 0) left = settleRest(S, Qrel, made, left);
    let Er = 0; for (const r of made.rays) Er += r[1];
    const f = Er > 0 ? Math.max(0, left) / Er : 0;
    for (const [it, E, ux, uy] of made.rays) { if (it.t === 'g') emitPhoton(x, y, E * f, ux, uy); else emitNeutrino(x, y, E * f, ux, uy, !!it.anti); }
    if (!(Er > 0) && left > 0) emitPhoton(x, y, left);
  } else if (Math.abs(left) > 1e-7 * Math.max(1, Math.abs(Qrel))) settleRest(S, Qrel, made, left);
}
function settleRest(S, Qrel, made, left) {
  if (made.ps.length) for (let k = 0; k < 3 && Math.abs(left) > 1e-6; k++) { shareKE(made.ps, left); left = nucLeft(S, Qrel); }
  if (Math.abs(left) > 1e-6 && made.xs.length) { // the unstable particles take the rest, in proportion to their motion
    let K = 0; for (const o of made.xs) K += o.KE;
    let given = 0;
    for (const o of made.xs) { const k0 = o.KE; o.KE = Math.max(0, o.KE + left * (K > 0 ? o.KE / K : 1 / made.xs.length)); given += o.KE - k0; exoSpeed(o); }
    left -= given;
  }
  return left;
}
/* What a collision made, for the collider's tally (products less what went in). */
function tally(items, ins, how) {
  noteMade(items, ins, how || summarize(items)); // (the Data tab's list, in any preset)
  const C = W.collider; if (!C) return;
  const m = C.made || (C.made = {}), sub = {};
  for (const l of ins) sub[l] = (sub[l] || 0) + 1;
  for (const it of items) {
    if (it.t === 'g' || it.t === 'v') continue;
    const l = labelOf(it);
    if (sub[l] > 0) { sub[l]--; continue; }
    m[l] = (m[l] || 0) + 1;
  }
}

/* ---- unstable particles in flight: W.exo. They fly at their true speed, curve in magnetic fields, and decay with
   their mean life stretched by time dilation (γτ), on the same clock as radioactive decay (W.warp speeds both). A
   π⁰ lives 8.4×10⁻¹⁷ s, about 25 nm of flight: it decays in the chamber; charged pions, kaons and muons live
   nanoseconds to microseconds and leave it, as in a real detector, unless decay is sped up. */
function addExo(sp, x, y, KE, ux, uy) {
  const d = XP[sp];
  const o = { id: W.nextId++, sp, lab: d.lab, m: d.m, q: d.q, x, y, ux, uy, KE: Math.max(0, KE), gam: 1, v: 0, born: W.rt, dead: false, trk: null };
  exoSpeed(o);
  o.trk = { pts: [x, y], ts: [W.rt], tt: [W.t], c: d.col, w: d.q ? 1.4 : 1.1, t0: W.rt, upd: W.rt, dash: !d.q };
  keepTrack(o.trk);
  W.exo.push(o);
  return o;
}
function exoSpeed(o) { const g = 1 + o.KE / (o.m * MEV); o.gam = g; o.v = PHYS.C * Math.sqrt(Math.max(0, 1 - 1 / (g * g))); }
function moveExos(dt, id0) {
  if (W.muBound && W.muBound.length) muBoundTick(dt);
  const n0 = W.exo.length;
  if (!n0) return;
  const clock = W.decayOn ? dt * PHYS.TU_S * W.warp : 0, hw = W.box.w / 2, hh = W.box.h / 2; // (proper seconds per lab second: 1/γ)
  for (let i = 0; i < n0; i++) {
    const o = W.exo[i];
    if (o.dead || (id0 !== undefined && o.id >= id0)) continue; // (born this step: it flies from the next one, which slow motion and the step chooser have shortened for it)
    let h = dt, dec = false;
    if (clock > 0) {
      const tl = XP[o.sp].tau * o.gam, P = 1 - Math.exp(-clock / tl);
      if (rnd() < P) { dec = true; h = dt * Math.min(1, -Math.log(1 - rnd() * P) * tl / clock); } // when in the step it goes
    }
    const d = XP[o.sp];
    flyExo(o, h);
    if (o.x < -hw || o.x > hw || o.y < -hh || o.y > hh) {
      if (!((d.atom || (o.sp === 'mu-' && o.KE < 2 * MU_STOP)) && W.wall === 'reflect')) { exoLeaves(o); continue; } // (a slow muon would stop in the wall's matter: kept in instead)
      if (Math.abs(o.x) > hw) { o.x = Math.sign(o.x) * (2 * hw - Math.abs(o.x)); o.ux = -o.ux; } // (muonic hydrogen, slow and neutral, bounces off the walls as atoms do)
      if (Math.abs(o.y) > hh) { o.y = Math.sign(o.y) * (2 * hh - Math.abs(o.y)); o.uy = -o.uy; }
    }
    if (dec) { decayExo(o); continue; }
    if (o.sp === 'mu-' && o.KE < MU_STOP && muStop(o)) continue;
    if (d.atom && clock > 0) muAtomTick(o, clock);
  }
  if (W.step % 8 === 0 || W.exo.length > MAX_EXO) { let j = 0; for (const o of W.exo) if (!o.dead) W.exo[j++] = o; W.exo.length = j; }
}
function flyExo(o, h) {
  const mu = o.m / PHYS.AMU_MEV, x0 = o.x, y0 = o.y;
  let rem = h;
  for (let k = 0; k < 64 && rem > 1e-15; k++) {
    let s = rem, om = 0;
    if (o.q) { const B = Bfield(o.x, o.y, null); if (B) { om = o.q * B * PHYS.LOR / (o.gam * mu); if (Math.abs(om) * s > 0.2) s = 0.2 / Math.abs(om); } }
    if (om) [o.ux, o.uy] = turn2(o.ux, o.uy, -om * s / 2);
    o.x += o.ux * o.v * s; o.y += o.uy * o.v * s;
    if (om) [o.ux, o.uy] = turn2(o.ux, o.uy, -om * s / 2);
    rem -= s;
  }
  const t = o.trk, n = t.pts.length;
  if (Math.abs(t.pts[n - 2] - o.x) + Math.abs(t.pts[n - 1] - o.y) > 0.4) { t.pts.push(o.x, o.y); if (t.ts) { t.ts.push(W.rt); t.tt.push(W.t); } if (t.pts.length > 800) trkThin(t); }
  t.upd = W.rt;
  if (o.q && o.v > 0) exoIonize(o, x0, y0); // (charged: it ionizes what it passes, and slows)
}
function exoLeaves(o) { // its energy, mass included, leaves the books (it decays out there, into radiation)
  W.ledger.escaped += o.KE + o.m * MEV; W.ledger.nuc += o.m * MEV;
  o.dead = true; o.fate = o.fate || 'left the chamber';
}
const EXO_QUIET = new Set(['pi0', 'eta']); // decays too common and too quick to caption each one
function decayExo(o) {
  const d = XP[o.sp], toks = pickBr(d.dec), items = toks.map(item), ms = items.map(massOf);
  const vs = phaseSpace(o.m, ms);
  if (!vs) { exoLeaves(o); return; }
  const bx = o.v / PHYS.C * o.ux, by = o.v / PHYS.C * o.uy;
  const S = nucBegin([]);
  o.dead = true;
  const made = spawnItems(items, vs.map(v => toLab(v, bx, by)), o.x, o.y);
  closeEvent(S, made, o.x, o.y, o.KE + o.m * MEV, o.m * MEV);
  W.count.decay++;
  const txt = `${o.lab} → ${summarize(items)}`, life = d.tau * o.gam;
  o.fate = `decayed: ${txt}`;
  flash(o.x, o.y, d.col, EXO_QUIET.has(o.sp) ? 2 : 3.5, 0.35);
  tally(items, [], `Decay in flight: ${txt}`);
  if (!EXO_QUIET.has(o.sp)) {
    nucEvent('pdecay', o.x, o.y, `Decay in flight: ${txt}`, [{ x: o.x, y: o.y, k: 'x', rd: 0.12, lbl: o.lab }], `mean life ${fmtTime(d.tau)}, ${fmtTime(life)} at its speed${boostTag()}`);
    log('nuc', `Decay in flight: ${txt} (mean life ${fmtTime(d.tau)}, γ = ${fmtNum(o.gam, 3)})`);
  } else log('nuc', `Decay: ${txt}`);
}

/* ---- electron + positron. They annihilate into whatever the energy of their centre of mass, √s, allows, in
   proportion to the cross sections: two photons (2πα²/s·[ln(s/m²) − 1]), muon pairs above 211 MeV and τ pairs above
   3.55 GeV (4πα²/3s·β(3 − β²)/2), and hadrons: the ρ (π⁺π⁻), ω (π⁺π⁻π⁰) and φ (mostly kaon pairs) resonances, then
   R ≈ 2.2 times the muon-pair cross section above about 1.1 GeV (3.6 above the charm threshold; charm and bottom
   are shared out as light hadrons here). */
const ALPHA = 1 / 137.035999, GEV2NB = 389379.4;
function sigPt(s) { return 4 * Math.PI * ALPHA * ALPHA / (3 * s) * GEV2NB; } // s in GeV², σ in nb
function sigGG(s) { const me = PHYS.MEC2 / 1000; return 2 * Math.PI * ALPHA * ALPHA / s * Math.max(0.1, Math.log(s / (me * me)) - 1) * GEV2NB; }
function sigLL(s, m) { const b2 = 1 - 4 * m * m / s; if (!(b2 > 0)) return 0; return sigPt(s) * Math.sqrt(b2) * (3 - b2) / 2; }
function bwPeak(s, m, G, peak) { const m2 = m * m; return peak * m2 * G * G / ((s - m2) * (s - m2) + m2 * G * G); }
function hadronParts(s) {
  const W2 = Math.sqrt(s), mpi = 0.13957, out = { rho: 0, omega: 0, phi: 0, cont: 0 };
  if (s > 4 * mpi * mpi) { // the pion form factor: a ρ with an energy-dependent width
    const mr = 0.77526, b = Math.sqrt(1 - 4 * mpi * mpi / s), br = Math.sqrt(1 - 4 * mpi * mpi / (mr * mr)), G = 0.1491 * (mr / W2) * (b / br) ** 3;
    out.rho = sigPt(s) * 0.25 * b * b * b * mr ** 4 / ((s - mr * mr) ** 2 + mr * mr * G * G);
  }
  if (W2 > 0.42) out.omega = bwPeak(s, 0.78266, 0.00868, 1770);
  if (W2 > 0.99) out.phi = bwPeak(s, 1.019461, 0.004249, 4198);
  const sm = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  out.cont = sigPt(s) * (2.2 * sm((W2 - 1.05) / 0.55) + (W2 > 3.75 ? 1.4 : 0) + (W2 > 10.6 ? 0.35 : 0));
  return out;
}
function eeEvent(a, b, x, y) {
  const Pa = p4of(a), Pb = p4of(b), P = add4(Pa, Pb), M = mass4(P), s = M * M / 1e6;
  const H = hadronParts(s);
  const ch = pickBr([[sigGG(s), 'gg'], [sigLL(s, XP['mu-'].m / 1000), 'mm'], [sigLL(s, XP['tau-'].m / 1000), 'tt'], [H.rho, 'rho'], [H.omega, 'omega'], [H.phi, 'phi'], [H.cont, 'cont']]);
  let toks = null, ang = null;
  if (ch === 'mm') { toks = ['mu-', 'mu+']; ang = (c) => (1 + c * c) / 2; }
  else if (ch === 'tt') { toks = ['tau-', 'tau+']; ang = (c) => (1 + c * c) / 2; }
  else if (ch === 'rho') { toks = ['pi+', 'pi-']; ang = (c) => 1 - c * c; }
  else if (ch === 'omega') toks = pickBr([[0.893, ['pi+', 'pi-', 'pi0']], [0.084, ['pi0', 'g']], [0.015, ['pi+', 'pi-']]]);
  else if (ch === 'phi') toks = pickBr([[0.492, ['K+', 'K-']], [0.34, ['K0L', 'K0S']], [0.154, ['pi+', 'pi-', 'pi0']], [0.013, ['eta', 'g']]]);
  else if (ch === 'cont') toks = hadronize(M, 0, 0, {});
  const items = toks ? toks.map(item) : null;
  if (!items || items.reduce((t, it) => t + massOf(it), 0) >= M - 0.01) { annihilateInFlight(a, b, x, y); return; } // two γ rays
  const bx = P[1] / P[0], by = P[2] / P[0];
  let vs;
  let jet = null;
  if (ch === 'cont' && M > 2500 && items.length >= 3) { // above a few GeV: two jets back to back, at 1 + cos²θ to the beams (spin-½ quarks)
    const e = toRest(a.k === ELEC ? Pa : Pb, bx, by), en = Math.hypot(e[1], e[2]) || 1;
    let th = 0; for (let k = 0; k < 60; k++) { th = rnd() * 2 * Math.PI; if (rnd() < (1 + Math.cos(th) ** 2) / 2) break; }
    jet = turn2(e[1] / en, e[2] / en, th);
  }
  if (jet) vs = jetMomenta(items, M, jet[0], jet[1]);
  if (jet && vs) addString(x, y, jet[0], jet[1], items.length);
  else if (ang && items.length === 2) { // a pair: the angle to the beams as for a photon (1 + cos²θ) or a ρ (sin²θ)
    const e = toRest(a.k === ELEC ? Pa : Pb, bx, by), en = Math.hypot(e[1], e[2]) || 1;
    let th = 0; for (let k = 0; k < 60; k++) { th = rnd() * 2 * Math.PI; if (rnd() < ang(Math.cos(th))) break; }
    const [ux, uy] = turn2(e[1] / en, e[2] / en, th);
    vs = twoBody(M, massOf(items[0]), massOf(items[1]), ux, uy);
  } else vs = phaseSpace(M, items.map(massOf));
  const gh = [ghostOf(a), ghostOf(b)];
  const S = nucBegin([a, b]);
  kill(a); kill(b);
  const made = spawnItems(items, vs.map(v => toLab(v, bx, by)), x, y);
  closeEvent(S, made, x, y);
  W.count.annih++;
  const txt = `e⁻ + e⁺ → ${summarize(items)}`, sub = `√s = ${fmtE(M * MEV)}`;
  nucEvent('prod', x, y, txt, gh, sub);
  log('nuc', `Annihilation in flight: ${txt} (${sub})`);
  flash(x, y, [255, 230, 180], 6, 0.6);
  tally(items, ['e⁻', 'e⁺'], txt);
  if (W.collider) { W.collider.hits = (W.collider.hits || 0) + 1; W.collider.last = `${txt}, ${sub}`; }
}

/* ---- hadrons from a fireball. Charges are settled by moving single particles one step (π⁻ → π⁰ → π⁺, n → p, …) */
const QSET = { N: [0, 1], Nb: [-1, 0], pi: [-1, 0, 1], Kp: [0, 1], Km: [-1, 0] };
function flexTok(f) {
  if (f.k === 'N') return f.q ? 'p' : 'n';
  if (f.k === 'Nb') return f.q ? 'pbar' : 'nbar';
  if (f.k === 'pi') return f.q > 0 ? 'pi+' : f.q < 0 ? 'pi-' : 'pi0';
  if (f.q) return f.k === 'Kp' ? 'K+' : 'K-';
  return rnd() < 0.5 ? 'K0S' : 'K0L'; // a neutral kaon is seen as the short- or the long-lived one
}
function repairCharge(fx, Q) {
  let D = Q; for (const f of fx) D -= f.q;
  for (let g = 0; D !== 0 && g < 2000; g++) {
    const s = Math.sign(D), c = fx.filter(f => QSET[f.k].includes(f.q + s));
    if (!c.length) return false;
    c[Math.floor(rnd() * c.length)].q += s; D -= s;
  }
  return D === 0;
}
/* A fireball of invariant mass M (MeV), baryon number B and charge Q (no strangeness) turned into hadrons: B nucleons
   (now and then one of them a Λ, with a kaon), pions, now and then a kaon pair, an η or a nucleon–antinucleon pair,
   as the energy allows. Pions: a Poisson number, about 1 + 2.3·(E/GeV)^0.6 for the energy E left over (half of it
   where baryons lead), close to what e⁺e⁻ and proton–proton collisions give; in a nuclear fireball (opts.clusters:
   its energy per nucleon, MeV) about 0.65 per participant per GeV above 60 MeV, as heavy-ion collisions give, and
   its nucleons partly coalesce into d, t, ³He and α. Returns items, or null. */
function hadronize(M, B, Q, opts = {}) {
  if (B < 0) { const r = hadronize(M, -B, -Q, opts); return r && r.map(conjItem); }
  const mN = 938.9, nuc = opts.clusters !== undefined;
  for (let tries = 0; tries < 30; tries++) {
    const fx = [], fixed = [];
    let mass = 0;
    const pP = opts.pFrac !== undefined ? opts.pFrac : B > 0 ? clamp(Q / B, 0, 1) : 0.5;
    for (let i = 0; i < B; i++) { fx.push({ k: 'N', q: rnd() < pP ? 1 : 0 }); mass += mN; }
    const free = () => M - mass, sc = (e0, e1) => clamp((free() - e0) / e1, 0, 1);
    const xs = nuc ? 0.15 : 1; // (strangeness and pairs are rare in a nuclear fireball's many soft collisions)
    if (B > 0 && free() > 177 + 494 + 50 && rnd() < 0.07 * xs * sc(700, 1500)) { fx.splice(fx.findIndex(f => f.k === 'N'), 1); fixed.push('Lam'); fx.push({ k: 'Kp', q: rnd() < 0.5 ? 1 : 0 }); mass += 177 + 495; }
    if (free() > 2 * 495 + 50 && rnd() < 0.12 * xs * sc(1000, 1500)) { fx.push({ k: 'Kp', q: rnd() < 0.5 ? 1 : 0 }, { k: 'Km', q: rnd() < 0.5 ? -1 : 0 }); mass += 990; }
    if (free() > 2 * mN + 60 && rnd() < 0.05 * xs * sc(1900, 3000)) { fx.push({ k: 'N', q: rnd() < 0.5 ? 1 : 0 }, { k: 'Nb', q: rnd() < 0.5 ? -1 : 0 }); mass += 2 * mN; }
    if (free() > 548 + 40 && rnd() < 0.06 * xs * sc(600, 1000)) { fixed.push('eta'); mass += 548; }
    const mean = nuc ? B * 0.65 * Math.max(0, opts.clusters - 60) / 1000 : 1 + 2.3 * Math.pow(Math.max(0, free()) * (B > 0 ? 0.5 : 1) / 1000, 0.6);
    const mesons = fx.filter(f => f.k === 'Kp' || f.k === 'Km').length + fixed.filter(t => t === 'eta').length;
    const nMin = Math.max(opts.minMeson && !mesons ? 1 : 0, fx.length + fixed.length < 2 ? 2 - fx.length - fixed.length : 0);
    let n = Math.max(poisson(mean), nMin);
    const roomFor = (k) => mass + k * 138 <= M - 3 * Math.sqrt(k + fx.length + fixed.length + 1);
    while (n > nMin && !roomFor(n)) n--;
    if (!roomFor(n) && !(n === 0 && mass < M - 1)) continue;
    for (let i = 0; i < n; i++) { const r = rnd(); fx.push({ k: 'pi', q: r < 1 / 3 ? -1 : r < 2 / 3 ? 0 : 1 }); }
    if (!repairCharge(fx, Q)) continue;
    const out = fixed.map(item);
    for (const f of fx) out.push(item(flexTok(f)));
    if (nuc) coalesce(out, opts.clusters);
    if (out.length < 2 || out.reduce((t, it) => t + massOf(it), 0) >= M - 0.5) continue;
    return out;
  }
  return null;
}
/* Nucleons of a nuclear fireball bind into light nuclei, more of them the cooler it is. */
function coalesce(out, eps) {
  const f = clamp(1.15 - eps / 45, 0.05, 0.85);
  const at = (Z, N) => out.findIndex(it => it.t === 'A' && !it.anti && it.Z === Z && it.N === N);
  let np = 0, nn = 0;
  for (const it of out) if (it.t === 'A' && !it.anti && it.Z + it.N === 1) { if (it.Z) np++; else nn++; }
  const tries = np + nn;
  for (let g = 0; g < tries; g++) {
    if (rnd() > f * 0.5) continue;
    const r = rnd();
    const mk = r < 0.35 && np >= 2 && nn >= 2 ? [2, 2] : r < 0.55 && np >= 1 && nn >= 2 ? [1, 2] : r < 0.7 && np >= 2 && nn >= 1 ? [2, 1] : np >= 1 && nn >= 1 ? [1, 1] : null;
    if (!mk) break;
    for (let i = 0; i < mk[0]; i++) out.splice(at(1, 0), 1);
    for (let i = 0; i < mk[1]; i++) out.splice(at(0, 1), 1);
    np -= mk[0]; nn -= mk[1];
    out.push({ t: 'A', Z: mk[0], N: mk[1], anti: false });
  }
}
/* Mesons from a nucleon and an antinucleon annihilating (invariant mass M, net charge Q): about five pions at rest
   (38% of them neutral), a few more at higher energy; 6% of the time a kaon pair; now and then an η. */
function mesonState(M, Q) {
  for (let tries = 0; tries < 40; tries++) {
    const fx = [], fixed = [];
    let mass = 0;
    if (M > 2 * 495 + 80 && rnd() < 0.06) { fx.push({ k: 'Kp', q: rnd() < 0.5 ? 1 : 0 }, { k: 'Km', q: rnd() < 0.5 ? -1 : 0 }); mass += 990; }
    if (M > 548 + 300 && rnd() < 0.04) { fixed.push('eta'); mass += 548; }
    const nMin = Math.max(Math.abs(Q), 2 - fx.length - fixed.length, 0);
    const n = clamp(Math.round(5.0 * Math.pow(M / 1877, 0.3) - (mass > 0 ? 1.8 : 0) + gauss()), nMin, Math.floor((M - mass - 20) / 138));
    if (n < nMin) continue;
    for (let i = 0; i < n; i++) fx.push({ k: 'pi', q: rnd() < 0.38 ? 0 : rnd() < 0.5 ? 1 : -1 });
    if (!repairCharge(fx, Q)) continue;
    const out = fixed.map(item).concat(fx.map(f => item(flexTok(f))));
    if (out.length >= 2 && out.reduce((t, it) => t + massOf(it), 0) < M - 1) return out;
  }
  return null;
}
/* Mesons from a nucleon–antinucleon annihilation inside a nucleus or at the wall, carrying E (eV) in all (what the
   books gave), the pair moving at (vx, vy) (Å/tu), net charge Q. */
function mesonBurst(x, y, E, vx, vy, Q) {
  const bx = vx / PHYS.C, by = vy / PHYS.C, g = 1 / Math.sqrt(Math.max(1e-12, 1 - bx * bx - by * by)), M = E / MEV / g;
  const toks = mesonState(M, Q) || mesonState(M, 0);
  if (!toks) { emitPhoton(x, y, E / 2); emitPhoton(x, y, E / 2); return []; }
  const items = toks.map(item), vs = phaseSpace(M, items.map(massOf));
  const S = nucBegin([]);
  const made = spawnItems(items, vs.map(v => toLab(v, bx, by)), x, y);
  closeEvent(S, made, x, y, E, 0);
  flash(x, y, [215, 175, 255], 7, 0.7);
  return items;
}
/* A nucleon meets an antinucleon (bare, in flight): they annihilate into mesons, or, above its threshold, now and
   then exchange charge instead (p p̄ → n n̄), or make a Λ Λ̄ pair. Exact relativistic kinematics. */
function nnbarEvent(a, b, x, y) {
  const P = add4(p4of(a, true), p4of(b, true)), M = mass4(P);
  const Q = (a.anti ? -a.Z : a.Z) + (b.anti ? -b.Z : b.Z);
  let toks = null;
  if (Q === 0 && a.Z + b.Z === 2 && M > 2 * M_N + 0.5 && rnd() < 0.1 * Math.exp(-(M - 1877) / 1500)) toks = ['n', 'nbar'];
  else if (Q === 0 && M > 2 * XP.Lam.m + 30 && rnd() < 0.015) toks = ['Lam', 'Lamb'];
  if (!toks) toks = mesonState(M, Q);
  if (!toks) return null;
  W.count.annih++;
  return doReaction(a, b, toks.map(item), P, M, x, y, 'annih', `${fmtE(M * MEV)} in their own frame`);
}

/* ---- nucleon + nucleon above the pion threshold. Inelastic cross section (mb) against the beam energy a fixed-target
   machine would need (T_lab, GeV): measured proton–proton values. */
const NN_INEL = [[0.29, 0], [0.35, 0.6], [0.4, 1.5], [0.5, 3.5], [0.6, 7], [0.8, 16], [1, 21], [1.5, 24.5], [2, 26], [3, 28], [5, 29.5], [10, 30.5], [30, 31], [100, 32]];
const NN_TOT = [[0.29, 25], [0.5, 25], [0.8, 40], [1, 47], [2, 47], [3, 44], [5, 42], [10, 40], [30, 39], [100, 39]];
function nnTable(tab, M) {
  const m = 938.9, T = Math.max(1e-4, (M * M - 4 * m * m) / (2 * m) / 1000);
  if (T <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) if (T <= tab[i][0]) { const [t0, v0] = tab[i - 1], [t1, v1] = tab[i]; return v0 + Math.log(T / t0) / Math.log(t1 / t0) * (v1 - v0); }
  return tab[tab.length - 1][1];
}
/* Just above the threshold one pion is made: p p → d π⁺ (most likely at first), p p π⁰, p n π⁺ (through the Δ
   resonance); higher up, the fireball's statistical decay (hadronize): more pions, kaons with a Λ or in pairs,
   η, and above 3.75 GeV antiprotons. */
function nnInelastic(a, b, x, y, P, M) {
  const anti = !!a.anti, Q = a.Z + b.Z, Ex = M - nucMeV(a.Z, a.N) - nucMeV(b.Z, b.N);
  if (Ex < 140) return null;
  let toks = null;
  if (Ex < 290 || rnd() > clamp((Ex - 290) / 500, 0, 0.85)) {
    const D = 0.15 + 3.5 * clamp((Ex - 200) / 350, 0, 1), dw = 2.0 * Math.exp(-Ex / 250); // (measured: d π⁺ leads below ~400 MeV, the Δ (p n π⁺) above)
    const C = Q === 2 ? [[dw, ['d', 'pi+']], [0.5, ['p', 'p', 'pi0']], [D, ['p', 'n', 'pi+']]]
      : Q === 1 ? [[dw * 0.6, ['d', 'pi0']], [0.35, ['p', 'p', 'pi-']], [0.35, ['n', 'n', 'pi+']], [D * 0.7, ['p', 'n', 'pi0']]]
        : [[dw, ['d', 'pi-']], [0.5, ['n', 'n', 'pi0']], [D, ['p', 'n', 'pi-']]];
    const ok = C.filter(([, ts]) => ts.map(item).reduce((t, it) => t + massOf(it), 0) < M - 0.5);
    if (ok.length) toks = pickBr(ok);
  }
  let items = toks ? toks.map(item) : hadronize(M, 2, Q, { pFrac: Q / 2, minMeson: 1 });
  if (!items) return null;
  if (anti) items = items.map(conjItem);
  if (!toks && M > 5000 && items.length >= 3) { // high energy: strings stretched along the beams, the two baryons leading
    const bx = P[1] / P[0], by = P[2] / P[0], A = toRest(p4of(a, true), bx, by), L = Math.hypot(A[1], A[2]) || 1;
    const vs = jetMomenta(items, M, A[1] / L, A[2] / L, { lead: isBaryonItem });
    if (vs) { addString(x, y, A[1] / L, A[2] / L, items.length); return finishReaction(a, b, items, vs.map(v => toLab(v, bx, by)), x, y, 'prod', `√s = ${fmtE(M * MEV)}: strings along the beams`); }
  }
  return doReaction(a, b, items, P, M, x, y, 'prod', `√s = ${fmtE(M * MEV)}`);
}

/* ---- nuclei meet. A pass within reach (u: its distance as a fraction of the reach) is mapped onto real impact
   parameters b as an area, b = R√u, out to R = max(the nuclei's contact distance, 30·K), K being half their distance
   of closest approach (so where their charges dominate, the edge of the reach scatters by about 4°). Below the
   Coulomb barrier they don't touch (they may tunnel: tryFusion). Above it, a pass with b inside the grazing distance
   b_g = R_B·√(1 − V_B/E) touches, and they react:
     light systems (A ≤ 16): the compound system breaks up statistically into nucleons and light nuclei (Fermi breakup)
     a nucleon or light nucleus on a nucleus, or two nuclei with energy to spare below ~15 MeV per nucleon: complete
       fusion, then the compound nucleus cools (compoundDecay); heavy pairs (Z₁Z₂ above ~1,700) mostly re-separate
       before they fuse (quasi-fission), and glancing passes exchange nucleons and part again (deep-inelastic)
     above ~25–40 MeV per nucleon: the overlapping parts (participants) form a fireball that bursts into nucleons,
       light nuclei and, with energy enough, pions; the rest of each nucleus (a spectator) flies on, hot, and
       evaporates (abrasion–ablation; for a nucleon on a nucleus, spallation)
   and at high energy about a third of touching passes are diffraction (nuclear elastic scattering at a small angle).
   Returns a caption if something happened (the nuclei may survive it: diffraction), else null. */
const HIT_COUL = 30;
function nuclearEncounter(a, b, u, x, y) {
  if (a.dead || b.dead || a.k !== NUC || b.k !== NUC || opp(a, b)) return null;
  if (W.parts.length > MAX_PARTS - 400) return null; // (no room left for products)
  const A1 = a.Z + a.N, A2 = b.Z + b.N, Z1 = a.Z, Z2 = b.Z, anti = !!a.anti;
  const Pa = p4of(a, true), Pb = p4of(b, true), P = add4(Pa, Pb), M = mass4(P), Ecm = M - nucMeV(Z1, a.N) - nucMeV(Z2, b.N);
  if (!(Ecm > 0.001)) return null;
  const bx = P[1] / P[0], by = P[2] / P[0], As = toRest(Pa, bx, by), Bs0 = toRest(Pb, bx, by)[0], ps = Math.hypot(As[1], As[2]);
  if (!(ps > 0)) return null;
  const vrel = ps / As[0] + ps / Bs0, K = Z1 * Z2 ? 1.44 * Z1 * Z2 / (ps * vrel) : 0;
  const Rc = 1.2 * (Math.cbrt(A1) + Math.cbrt(A2)), b3 = Math.max(Rc, HIT_COUL * K) * Math.sqrt(clamp(u, 0, 1));
  if (A1 === 1 && A2 === 1) { // two nucleons: inelastic inside √(σ_inel/π), diffraction out to √(σ_tot/π)
    if (b3 < Math.sqrt(nnTable(NN_INEL, M) / (10 * Math.PI))) return nnInelastic(a, b, x, y, P, M);
    if (Ecm > 20 && b3 < Math.sqrt(nnTable(NN_TOT, M) / (10 * Math.PI))) return diffract(a, b, ps, 1.6);
    return null;
  }
  const RB = Rc + 1.6, VB = 1.44 * Z1 * Z2 / RB;
  if (Ecm <= VB) return null;
  const A = A1 + A2;
  if (A <= 16 && Ecm < 4 && Z1 * Z2 > 0) return null; // light nuclei near their barrier: the known fusion reactions (tryFusion)
  const bg = RB * Math.sqrt(1 - VB / Ecm);
  if (b3 >= bg) return null;
  const eps = Ecm * A / (A1 * A2); // relative kinetic energy per nucleon
  if (eps > 25 && rnd() < 0.35) return diffract(a, b, ps, RB);
  const items = [], moms = [];
  let kind = 'reaction', sub;
  let dtFused = false;
  if (A <= 16 && eps < 150) {
    // D–T keeps its measured fusion cross section here too (gamowP): ⁴He + n as often as that gives, and otherwise
    // only the other ways apart (rather than ⁴He + n as often as phase space alone would make it, many times too often)
    let keep = null;
    if (fusionKey(a, b) === '1_1+1_2') {
      const key = (fr) => fr.map(([z, n]) => z + '_' + n).sort().join('+'), fus = new Set(fusionChannels(a, b).map(c => key(c.prods)));
      dtFused = rnd() < gamowP(a, b, Ecm * MEV).P;
      keep = (pt) => fus.has(key(pt.list.map(i => FBF[i]))) === dtFused;
    }
    if (!fermiInto(Z1 + Z2, a.N + b.N, M, P, anti, items, moms, keep)) return null;
    if (dtFused) { kind = 'fusion'; sub = `fusion at ${fmtE(Ecm * MEV)} in their own frame`; } else sub = `breakup at ${fmtE(Ecm * MEV)} in their own frame`;
  } else if (A <= 16 || eps >= 40 || (eps >= 15 && rnd() < (eps - 15) / 25)) {
    _qgpLast = null;
    if (!fragmentInto(a, b, Pa, Pb, b3, anti, items, moms)) return null;
    sub = `${Math.min(A1, A2) === 1 ? 'spallation' : 'fragmentation'}, ${fmtE(eps * MEV)} per nucleon`;
    if (_qgpLast) { const g = _qgpLast; kind = 'qgp'; sub = `quark–gluon plasma: ${g.Bp} nucleons melted at √s_NN = ${fmtE(g.sNN * MEV)}, froze out into ${g.n.toLocaleString('en-US')} hadrons`; addQGP(x, y, g.n, g.sNN); }
  } else {
    const ZZ = Z1 * Z2, light = Math.min(A1, A2) <= 4, pCN = light ? 1 : 1 / (1 + Math.exp((ZZ - 1700) / 120));
    if ((light || b3 < 0.75 * bg) && rnd() < pCN) {
      const Zc = Z1 + Z2, Nc = a.N + b.N;
      compoundDecay(Zc, Nc, M, P, anti, items, moms, 0);
      kind = 'fusion'; sub = `compound nucleus ${nucSymA(Zc, Nc, anti)}* at ${fmtE((M - nucMeV(Zc, Nc)) * MEV)} excitation`;
    } else {
      if (!binaryInto(a, b, M, P, Pa, anti, items, moms, Ecm, VB, ZZ > 1200)) return null;
      sub = ZZ > 1200 ? 'quasi-fission: they part before fusing' : 'deep-inelastic: nucleons exchanged';
    }
  }
  const out = finishReaction(a, b, items, moms, x, y, kind, sub);
  if (dtFused) W.count.fusion++;
  return out;
}
/* Diffraction: nuclear elastic scattering at about λ/R (ħc/(p·R)). */
function diffract(a, b, ps, R) {
  const th = gauss() * 197.327 / (ps * R), la = partLabel(a), lb = partLabel(b);
  elasticTurn(a, b, th);
  return `${la} + ${lb}: nuclear elastic scattering, ${Math.abs(th * 180 / Math.PI).toFixed(1)}°`;
}
/* Turn two particles' relative momentum by th in their own frame (exact relativistic kinematics; energy and momentum
   kept, the books settled for any bond broken). */
function elasticTurn(a, b, th) {
  const S = nucBegin([a, b]);
  const ma = restE(a) / MEV, mb = restE(b) / MEV, Pa = p4of(a), Pb = p4of(b), E = Pa[0] + Pb[0], bx = (Pa[1] + Pb[1]) / E, by = (Pa[2] + Pb[2]) / E;
  const As = toRest(Pa, bx, by), Bs = toRest(Pb, bx, by), [qx, qy] = turn2(As[1], As[2], th);
  for (const [p, V, m] of [[a, toLab([As[0], qx, qy], bx, by), ma], [b, toLab([Bs[0], -qx, -qy], bx, by), mb]]) {
    const pm = Math.hypot(V[1], V[2]) || 1, K = Math.max(1e-6, (V[0] - m) * MEV);
    if (p.bonds.length && K > 20) for (const bd of p.bonds.slice()) removeBond(bd);
    setMotion(p, K, V[1] / pm, V[2] / pm);
  }
  settleKE(S, 0, [a, b]);
}
/* Kinematics in hand (items, moms): the reactants go, the products come, the books close, the event is shown. */
function doReaction(a, b, items, P, M, x, y, kind, sub) {
  const vs = phaseSpace(M, items.map(massOf));
  if (!vs) return null;
  const bx = P[1] / P[0], by = P[2] / P[0];
  return finishReaction(a, b, items, vs.map(v => toLab(v, bx, by)), x, y, kind, sub);
}
function finishReaction(a, b, items, moms, x, y, kind, sub) {
  const gh = [ghostOf(a), ghostOf(b)], ins = [partLabel(a), partLabel(b)], ne = a.ne + b.ne, anti = !!a.anti;
  const partners = [];
  for (const n of [a, b]) for (const bd of n.bonds) partners.push(other(bd, n));
  const S = nucBegin([a, b]);
  kill(a); kill(b);
  const made = spawnItems(items, moms, x, y);
  if (ne > 0) { // the atoms' electrons (positrons, for antimatter) stay with the new nuclei, heaviest first; any over go free
    let left = ne;
    for (const q of made.ps.filter(q => q.k === NUC && q.Z > 0).sort((p, q) => q.Z - p.Z)) { if (left <= 0) break; const k = Math.min(left, q.Z); q.ne = k; left -= k; refresh(q); }
    for (let i = 0; i < left && W.parts.length < MAX_PARTS; i++) { const [ux, uy] = rdir(); const e = addLepton(anti ? POS : ELEC, x + 0.3 * ux, y + 0.3 * uy); setMotion(e, 2 + 8 * rnd(), ux, uy); made.ps.push(e); }
  }
  relink(partners.filter(q => !q.dead));
  closeEvent(S, made, x, y);
  const outs = items.filter(it => it.t !== 'g' && it.t !== 'v').map(labelOf).sort();
  const same = outs.length === 2 && outs.join() === ins.slice().sort().join(); // the same two nuclei came out
  if (same) { kind = 'reaction'; sub = items.some(it => it.t === 'g') ? 'nuclear inelastic scattering: one was left excited and gave off γ rays' : 'nuclear elastic scattering'; }
  const txt = `${ins[0]} + ${ins[1]} → ${summarize(items)}`;
  nucEvent(kind, x, y, txt, gh, sub);
  log('nuc', `${txt}${sub ? ` (${sub})` : ''}`);
  flash(x, y, [255, 225, 170], same ? 1.5 : 6, same ? 0.35 : 0.7); // (a scattering only a small mark)
  W.count.nreact++;
  tally(items, ins, txt);
  return txt;
}

/* ---- a hot nucleus cools. Statistical model (Weisskopf for particles, Bohr–Wheeler for fission), level density
   a = A/8 MeV⁻¹: each channel's weight goes as g·μ·A^⅔·T²·e^(2√(aU)), U being the residue's excitation at most
   (the excitation, less the separation energy and the Coulomb barrier), T = √(U/a); d, t and ³He form less readily
   (suppressed). The particle takes a kinetic energy from the evaporation spectrum ε·e^(−ε/T); the last of the
   excitation leaves as γ rays. Exact masses throughout: every step is a two-body decay of the excited nucleus. */
const EVAP = [[0, 1, 2, 1], [1, 0, 2, 1], [2, 2, 1, 1], [1, 1, 3, 0.06], [1, 2, 2, 0.02], [2, 1, 2, 0.02]]; // Z, N, spin states, suppression
function fissionBarrier(Z, A) { // liquid drop (Myers and Swiatecki), with the shell corrections that hold actinides and superheavies together
  const I = (A - 2 * Z) / A, k = 1 - 1.7826 * I * I, x = Z * Z / A / (50.883 * k), Es = 17.9439 * k * Math.pow(A, 2 / 3);
  const f = x >= 1 ? 0 : x > 2 / 3 ? 0.83 * (1 - x) ** 3 : 0.38 * (0.75 - x);
  return Z >= 88 ? Math.max(Es * f, Z <= 100 ? 6 : 5.5) : Es * f;
}
function compoundDecay(Z, N, Ms, P, anti, items, moms, depth) {
  for (let step = 0; step < 160; step++) {
    const A = Z + N;
    if (Z < 1 || A < 2) break;
    if (Z > Z_MAX && fissionInto(Z, N, Ms, P, anti, items, moms, depth)) return; // past the last element nothing holds together: it splits at once
    const mgs = nucMeV(Z, N), Es = Ms - mgs;
    if (Es < 1e-4) break;
    if (A <= 16) { if (fermiInto(Z, N, Ms, P, anti, items, moms)) return; break; }
    const lw = [], ch = [];
    for (const [z, n, g, f] of EVAP) {
      const Zr = Z - z, Nr = N - n, Ar = Zr + Nr;
      if (Zr < 1 || Nr < 0 || Ar < 2) continue;
      const mx = nucMeV(z, n), mr = nucMeV(Zr, Nr), V = z ? 0.85 * 1.44 * z * Zr / (1.5 * (Math.cbrt(Ar) + Math.cbrt(z + n))) : 0, U = Ms - mx - mr - V;
      if (!(U > 0.01)) continue;
      const ar = Ar / 8;
      lw.push(Math.log(g * f * (z + n) * Math.pow(Ar, 2 / 3) * U / ar) + 2 * Math.sqrt(ar * U)); ch.push([z, n, mx, mr, U, ar]);
    }
    if (Z >= 70 && depth < 1) {
      const Uf = Es - fissionBarrier(Z, A), af = 1.05 * A / 8, s2 = Uf > 0 ? 2 * Math.sqrt(af * Uf) : 0;
      if (s2 > 1) { lw.push(Math.log(10 / (2 * af) * (s2 - 1)) + s2); ch.push('f'); }
    }
    if (!ch.length) break;
    const top = Math.max(...lw);
    const c = pickBr(lw.map((l, i) => [Math.exp(l - top), ch[i]]));
    if (c === 'f') { if (fissionInto(Z, N, Ms, P, anti, items, moms, depth)) return; break; }
    const [z, n, mx, mr, U, ar] = c, T = Math.sqrt(U / ar);
    let eps = -1;
    for (let t = 0; t < 30 && !(eps >= 0 && eps <= U); t++) eps = -T * Math.log(Math.max(1e-300, rnd() * rnd()));
    if (!(eps >= 0 && eps <= U)) eps = U * rnd();
    const Mr = mr + (U - eps), [ux, uy] = rdir(), [v1, v2] = twoBody(Ms, mx, Mr, ux, uy), bx = P[1] / P[0], by = P[2] / P[0];
    items.push({ t: 'A', Z: z, N: n, anti }); moms.push(toLab(v1, bx, by));
    P = toLab(v2, bx, by); Ms = Mr; Z -= z; N -= n;
  }
  gammaOut(Z, N, Ms, P, anti, items, moms);
}
/* The residue: what is left of its excitation leaves as a few γ rays. */
function gammaOut(Z, N, Ms, P, anti, items, moms) {
  const mgs = nucMeV(Z, N);
  for (let k = 1; Ms - mgs > 1e-4 && k <= 3; k++) {
    const Es = Ms - mgs, Mi = k < 3 && Es > 3 ? mgs + Es * (0.3 + 0.4 * rnd()) : mgs;
    const [ux, uy] = rdir(), [vg, vr] = twoBody(Ms, 0, Mi, ux, uy), bx = P[1] / P[0], by = P[2] / P[0];
    items.push({ t: 'g' }); moms.push(toLab(vg, bx, by));
    P = toLab(vr, bx, by); Ms = Mi;
  }
  items.push({ t: 'A', Z, N, anti }); moms.push(P);
}
/* Fission of a hot nucleus: asymmetric for actinides with little excitation, symmetric otherwise; the fragments' total
   kinetic energy from Viola's systematics (0.1189 Z²/A^⅓ + 7.3 MeV); the rest of the energy heats them, and they
   cool in turn (prompt neutrons). */
function fissionInto(Z, N, Ms, P, anti, items, moms, depth) {
  const A = Z + N, Es = Ms - nucMeV(Z, N);
  for (let t = 0; t < 12; t++) {
    const A1 = clamp(Math.round(Z >= 88 && Es < 18 ? FISSION.light * A / 236 + gauss() * FISSION.sigma : A / 2 + gauss() * 0.065 * A), 20, A - 20);
    const Z1 = clamp(Math.round(Z * A1 / A + gauss() * 0.6), 8, Z - 8), N1 = A1 - Z1, Z2 = Z - Z1, N2 = A - A1 - Z2;
    if (N1 < 0 || N2 < 0) continue;
    const m1 = nucMeV(Z1, N1), m2 = nucMeV(Z2, N2), avail = Ms - m1 - m2;
    if (!(avail > 1)) continue;
    const TKE = Math.min(0.1189 * Z * Z / Math.cbrt(A) + 7.3, 0.9 * avail), Ex = avail - TKE, E1 = Ex * A1 / A;
    const [ux, uy] = rdir(), [v1, v2] = twoBody(Ms, m1 + E1, m2 + Ex - E1, ux, uy), bx = P[1] / P[0], by = P[2] / P[0];
    compoundDecay(Z1, N1, m1 + E1, toLab(v1, bx, by), anti, items, moms, depth + 1);
    compoundDecay(Z2, N2, m2 + Ex - E1, toLab(v2, bx, by), anti, items, moms, depth + 1);
    return true;
  }
  return false;
}
/* Light systems break up all at once into nucleons and light nuclei (Fermi's model): each way of splitting (Z, N) into
   the bound light nuclei below is weighed by its phase space in two dimensions, (S/(2πħ)²)^(n−1)·(2π)^(n−1)/Γ(n−1)·
   Πg/G·(Πm/M)·E^(n−2) for n fragments with kinetic energy E, spin states g and G the permutations of identical ones,
   S the area of a disc of radius 1.4·A^⅓ fm, doubled. */
const FBF = [[0, 1, 2], [1, 0, 2], [1, 1, 3], [1, 2, 2], [2, 1, 2], [2, 2, 1], [3, 3, 3], [3, 4, 4], [4, 3, 4], [4, 5, 4], [5, 5, 7], [5, 6, 4], [6, 6, 1], [6, 7, 2], [7, 7, 3], [7, 8, 2], [8, 8, 1]];
const _fbCache = new Map();
function fermiParts(Z, N) {
  const key = Z * 100 + N;
  let out = _fbCache.get(key);
  if (out) return out;
  const lists = [];
  const rec = (z, n, start, list) => {
    if (!z && !n) { if (list.length >= 2) lists.push(list.slice()); return; }
    if (list.length >= 7 || lists.length > 6000) return;
    for (let i = start; i < FBF.length; i++) { const [fz, fn] = FBF[i]; if (fz <= z && fn <= n) { list.push(i); rec(z - fz, n - fn, i, list); list.pop(); } }
  };
  rec(Z, N, 0, []);
  out = lists.map(list => {
    let lg = 0, sm = 0; const cnt = {};
    for (const i of list) { const [fz, fn, g] = FBF[i], m = nucMeV(fz, fn); lg += Math.log(g) + Math.log(m); sm += m; cnt[i] = (cnt[i] || 0) + 1; }
    for (const c of Object.values(cnt)) lg -= lnFact(c);
    return { list, lg, sm, n: list.length };
  });
  _fbCache.set(key, out);
  return out;
}
function fermiInto(Z, N, Ms, P, anti, items, moms, keep) { // keep(pt): which ways apart are allowed (all, if not given)
  const A = Z + N, R = 1.4 * Math.cbrt(A), c0 = Math.log(2 * Math.PI * R * R / (4 * Math.PI * Math.PI * 197.327 * 197.327) * 2 * Math.PI);
  const opts = [];
  for (const pt of fermiParts(Z, N)) { const E = Ms - pt.sm; if (E > 0 && (!keep || keep(pt))) opts.push([(pt.n - 1) * c0 + pt.lg - Math.log(Ms) - lnFact(Math.max(0, pt.n - 2)) + (pt.n - 2) * Math.log(E), pt]); }
  if (!opts.length) return false;
  const top = Math.max(...opts.map(o => o[0])), pt = pickBr(opts.map(([l, p]) => [Math.exp(l - top), p]));
  const its = pt.list.map(i => ({ t: 'A', Z: FBF[i][0], N: FBF[i][1], anti })), vs = phaseSpace(Ms, its.map(massOf));
  if (!vs) return false;
  const bx = P[1] / P[0], by = P[2] / P[0];
  its.forEach((it, i) => { items.push(it); moms.push(toLab(vs[i], bx, by)); });
  return true;
}
/* Deep-inelastic collisions and quasi-fission: the touching nuclei exchange nucleons (a few, or towards equal masses
   when they stay together long enough), their motion is damped, and they part again, hot, near the Coulomb energy
   of the two touching fragments. */
function binaryInto(a, b, M, P, Pa, anti, items, moms, Ecm, VB, quasi) {
  const Z1 = a.Z, A1 = a.Z + a.N, ZT = a.Z + b.Z, NT = a.N + b.N, AT = ZT + NT;
  const bx = P[1] / P[0], by = P[2] / P[0], d = toRest(Pa, bx, by), dn = Math.hypot(d[1], d[2]) || 1;
  for (let t = 0; t < 12; t++) {
    const kap = quasi ? 0.3 + 0.7 * rnd() : 0.3 * rnd();
    const Af = clamp(Math.round(A1 + kap * (AT / 2 - A1) + gauss() * Math.sqrt(1 + kap * AT / 15)), 4, AT - 4);
    const Zf = clamp(Math.round(Z1 + (Af - A1) * ZT / AT + gauss() * 0.7), 2, ZT - 2), Nf = Af - Zf, Zg = ZT - Zf, Ng = NT - Nf;
    if (Nf < 0 || Ng < 0 || Nf > 2 * Zf + 6 || Ng > 2 * Zg + 6 || Zf > Nf + 3 || Zg > Ng + 3 || Zf > Z_MAX || Zg > Z_MAX) continue;
    const mf = nucMeV(Zf, Nf), mg = nucMeV(Zg, Ng), avail = M - mf - mg;
    if (!(avail > 0.5)) continue;
    const Vc = 1.44 * Zf * Zg / (1.2 * (Math.cbrt(Af) + Math.cbrt(AT - Af)) + 2);
    const TKE = Math.min(0.95 * avail, quasi ? Vc * (0.85 + 0.25 * rnd()) : Vc + Math.max(0, Ecm - VB) * (0.15 + 0.6 * rnd()));
    const Ex = avail - TKE, Ef = Ex * Af / AT;
    const [ux, uy] = turn2(d[1] / dn, d[2] / dn, (rnd() - 0.5) * (quasi ? 2.4 : 0.9));
    const [v1, v2] = twoBody(M, mf + Ef, mg + Ex - Ef, ux, uy);
    compoundDecay(Zf, Nf, mf + Ef, toLab(v1, bx, by), anti, items, moms, 0);
    compoundDecay(Zg, Ng, mg + Ex - Ef, toLab(v2, bx, by), anti, items, moms, 0);
    return true;
  }
  return false;
}
/* The fraction of disc 1 (radius R1) inside disc 2 (radius R2) at centre distance d: the overlap of two nuclei seen
   along the beam. */
function lensFrac(R1, R2, d) {
  if (d >= R1 + R2) return 0;
  if (d <= Math.abs(R1 - R2)) return R1 <= R2 ? 1 : R2 * R2 / (R1 * R1);
  const a1 = Math.acos(clamp((d * d + R1 * R1 - R2 * R2) / (2 * d * R1), -1, 1)), a2 = Math.acos(clamp((d * d + R2 * R2 - R1 * R1) / (2 * d * R2), -1, 1));
  const area = R1 * R1 * a1 + R2 * R2 * a2 - 0.5 * Math.sqrt(Math.max(0, (-d + R1 + R2) * (d + R1 - R2) * (d - R1 + R2) * (d + R1 + R2)));
  return area / (Math.PI * R1 * R1);
}
/* Participants and spectators. The part of each nucleus that overlaps the other (a nucleon: all of it, striking a
   column of the other about 0.35 per fm long) forms a fireball with all the energy of the collision but what the
   spectators carry on with at their nucleus's speed, heated by 13–30 MeV per nucleon torn away. */
let _qgpLast = null; // (the last plasma made: for the caption)
function fragmentInto(a, b, Pa, Pb, b3, anti, items, moms) {
  const sd = [a, b].map((p, i) => ({ Z: p.Z, N: p.N, A: p.Z + p.N, P: i ? Pb : Pa, R: 1.2 * Math.cbrt(p.Z + p.N) }));
  for (const [s, o] of [[sd[0], sd[1]], [sd[1], sd[0]]]) {
    if (s.A === 1) s.ap = 1;
    else if (o.A === 1) s.ap = clamp(Math.round(1 + 0.35 * 2 * Math.sqrt(Math.max(0, s.R * s.R - b3 * b3)) + 0.7 * gauss()), 1, s.A);
    else { const f = lensFrac(s.R, o.R, b3); s.ap = clamp(Math.round(s.A * f + gauss() * Math.sqrt(s.A * f * (1 - f) + 0.25)), 1, s.A); }
    s.zp = s.ap === s.A ? s.Z : clamp(Math.round(s.Z * s.ap / s.A + gauss() * Math.sqrt(0.25 * s.ap)), Math.max(0, s.ap - s.N), Math.min(s.Z, s.ap));
    s.Zs = s.Z - s.zp; s.Ns = s.N - (s.ap - s.zp);
    if (s.Zs < 1 && s.Ns > 0) { s.ap = s.A; s.zp = s.Z; s.Zs = 0; s.Ns = 0; } // (no protons left to hold the rest together: it all takes part)
  }
  const Bp = sd[0].ap + sd[1].ap, Qp = sd[0].zp + sd[1].zp;
  for (let att = 0; att < 4; att++) {
    let F = add4(Pa, Pb);
    for (const s of sd) {
      s.Ps = null;
      if (s.Zs + s.Ns < 1) continue;
      s.Ex = s.Zs + s.Ns >= 2 ? Math.min(s.ap * (13 + 17 * rnd()), 8 * (s.Zs + s.Ns)) * Math.pow(0.4, att) : 0;
      s.Ms = nucMeV(s.Zs, s.Ns) + s.Ex;
      const k = s.Ms / mass4(s.P);
      s.Ps = [s.P[0] * k, s.P[1] * k, s.P[2] * k];
      F = [F[0] - s.Ps[0], F[1] - s.Ps[1], F[2] - s.Ps[2]];
    }
    if (!(F[0] > 0)) continue;
    const MF = mass4(F), epsP = (MF - Bp * 938.9) / Bp;
    if (!(epsP > 0)) continue;
    const fx = F[1] / F[0], fy = F[2] / F[0], Ab = toRest(Pa, fx, fy), Lb = Math.hypot(Ab[1], Ab[2]) || 1, bax = Ab[1] / Lb, bay = Ab[2] / Lb; // (the beams' axis, in the fireball's frame)
    let fb, vs;
    if (epsP >= QGP.eps && Bp >= QGP.minA) { // the overlap melts into a quark–gluon plasma, which freezes out into hadrons
      const sNN = 2 * (epsP + 938.9), q = qgpHadrons(MF, Bp, Qp, sNN);
      if (!q) continue;
      fb = anti ? q.items.map(conjItem) : q.items; vs = jetMomenta(fb, MF, bax, bay, { thermal: true });
      if (!vs) continue;
      for (let i = fb.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [fb[i], fb[j]] = [fb[j], fb[i]]; [vs[i], vs[j]] = [vs[j], vs[i]]; } // (shuffled: if not all fit in the chamber, those that do are a fair sample)
      _qgpLast = { n: fb.length, sNN, muB: q.muB, Bp };
    } else {
      fb = hadronize(MF, anti ? -Bp : Bp, anti ? -Qp : Qp, { pFrac: Qp / Bp, clusters: epsP });
      if (!fb) continue;
      vs = epsP > 2000 && fb.length >= 3 ? jetMomenta(fb, MF, bax, bay, { lead: isBaryonItem }) : null; // (high energy: along the beams, as strings stretch)
      if (!vs) vs = phaseSpace(MF, fb.map(massOf));
      if (!vs) continue;
    }
    fb.forEach((it, i) => { items.push(it); moms.push(toLab(vs[i], fx, fy)); });
    for (const s of sd) if (s.Ps) compoundDecay(s.Zs, s.Ns, s.Ms, s.Ps, anti, items, moms, 0);
    return true;
  }
  return false;
}

/* ---- reach. A nucleus is hit where it is drawn: the nucleus view draws it with every nucleon 0.045 Å across (the
   nuclear scale enlarged, as everything nuclear here), so its radius is 0.045·r(A), r(A) the packed cluster's radius
   in nucleon radii; a pass inside the sum of two radii (and never less than the reaches set for light nuclei) is a
   nuclear encounter, mapped onto real impact parameters as above. */
function nucDrawR(p) { if (p.k !== NUC) return 0; const A = p.Z + p.N; return 0.045 * (A <= 1 ? 1.12 : Math.sqrt((A - 0.5) / 0.82) + 1.12); }
function nucReach(a, b) { return Math.max(a.Z === 0 || b.Z === 0 ? R_NN : R_FUS, nucDrawR(a) + nucDrawR(b)); }
