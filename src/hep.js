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
  Mu: { lab: 'Mu', m: 105.6584 + 0.51099895 - 13.54e-6, q: 0, tau: 2.1970e-6, col: [150, 225, 255], cc: 'Mu', muonium: true, dec: [[1, ['e+', 'nu', 'numub', 'e-']]] }, // (muonium, μ⁺e⁻: a light hydrogen; its muon decays, the electron goes free)
  'pi+': { lab: 'π⁺', m: 139.5704, q: 1, tau: 2.6033e-8, col: [255, 160, 70], cc: 'pi-', dec: [[0.99988, ['mu+', 'nu']], [0.00012, ['e+', 'nu']]] },
  'pi-': { lab: 'π⁻', m: 139.5704, q: -1, tau: 2.6033e-8, col: [255, 160, 70], cc: 'pi+', dec: [[0.99988, ['mu-', 'nub']], [0.00012, ['e-', 'nub']]] },
  pi0: { lab: 'π⁰', m: 134.9768, q: 0, tau: 8.43e-17, col: [255, 214, 160], cc: 'pi0', dec: [[0.98823, ['g', 'g']], [0.01174, ['e+', 'e-', 'g']]] },
  'K+': { lab: 'K⁺', m: 493.677, q: 1, tau: 1.2380e-8, col: [245, 232, 90], cc: 'K-', dec: [[0.6356, ['mu+', 'nu']], [0.2067, ['pi+', 'pi0']], [0.0558, ['pi+', 'pi+', 'pi-']], [0.0507, ['pi0', 'e+', 'nu']], [0.0335, ['pi0', 'mu+', 'nu']], [0.0176, ['pi+', 'pi0', 'pi0']]] },
  K0S: { lab: 'K⁰s', m: 497.611, q: 0, tau: 8.954e-11, col: [232, 222, 150], cc: 'K0S', dec: [[0.692, ['pi+', 'pi-']], [0.307, ['pi0', 'pi0']]] },
  K0L: { lab: 'K⁰ʟ', m: 497.611, q: 0, tau: 5.116e-8, col: [232, 222, 150], cc: 'K0L', dec: [[0.2028, ['pi+', 'e-', 'nub']], [0.2028, ['pi-', 'e+', 'nu']], [0.1352, ['pi+', 'mu-', 'nub']], [0.1352, ['pi-', 'mu+', 'nu']], [0.1952, ['pi0', 'pi0', 'pi0']], [0.1254, ['pi+', 'pi-', 'pi0']]] },
  eta: { lab: 'η', m: 547.862, q: 0, tau: 5.02e-19, col: [255, 185, 225], cc: 'eta', dec: [[0.3936, ['g', 'g']], [0.3257, ['pi0', 'pi0', 'pi0']], [0.2292, ['pi+', 'pi-', 'pi0']], [0.0422, ['pi+', 'pi-', 'g']]] },
  Lam: { lab: 'Λ', m: 1115.683, q: 0, B: 1, tau: 2.617e-10, col: [195, 160, 255], cc: 'Lamb', dec: [[0.639, ['p', 'pi-']], [0.358, ['n', 'pi0']]] }, // (PDG 2024's mean life; it had the older 2.632×10⁻¹⁰ s, 1.26)
  // the other light baryons with strange quarks (made when a quark is pulled out by hand, in the Inspect tab's quark view)
  'Sig+': { lab: 'Σ⁺', m: 1189.37, q: 1, B: 1, tau: 8.018e-11, col: [215, 150, 255], cc: 'Sigb-', dec: [[0.5157, ['p', 'pi0']], [0.4831, ['n', 'pi+']]] },
  'Sig-': { lab: 'Σ⁻', m: 1197.449, q: -1, B: 1, tau: 1.479e-10, col: [215, 150, 255], cc: 'Sigb+', dec: [[0.99848, ['n', 'pi-']]] },
  Xi0: { lab: 'Ξ⁰', m: 1314.86, q: 0, B: 1, tau: 2.90e-10, col: [180, 140, 255], cc: 'Xib0', dec: [[0.99524, ['Lam', 'pi0']]] },
  'Xi-': { lab: 'Ξ⁻', m: 1321.71, q: -1, B: 1, tau: 1.639e-10, col: [180, 140, 255], cc: 'Xib+', dec: [[0.99887, ['Lam', 'pi-']]] },
  'Omg-': { lab: 'Ω⁻', m: 1672.45, q: -1, B: 1, tau: 8.21e-11, col: [160, 125, 255], cc: 'Omgb+', dec: [[0.678, ['Lam', 'K-']], [0.236, ['Xi0', 'pi-']], [0.086, ['Xi-', 'pi0']]] },
  // short-lived resonances (mean life ħ/Γ, about 10⁻²³ s: they decay where they are made, as their products are all that
  // is ever seen of them; made in collisions by hadronize's strings and the plasma (resonate), or placed by hand)
  rho0: { lab: 'ρ⁰', m: 775.26, w: 149.1, q: 0, tau: 4.41e-24, col: [255, 140, 120], cc: 'rho0', res: true, dec: [[1, ['pi+', 'pi-']]] },
  'rho+': { lab: 'ρ⁺', m: 775.11, w: 149.1, q: 1, tau: 4.41e-24, col: [255, 140, 120], cc: 'rho-', res: true, dec: [[1, ['pi+', 'pi0']]] },
  omega: { lab: 'ω', m: 782.66, w: 8.68, q: 0, tau: 7.58e-23, col: [255, 170, 140], cc: 'omega', res: true, dec: [[0.893, ['pi+', 'pi-', 'pi0']], [0.084, ['pi0', 'g']], [0.0153, ['pi+', 'pi-']]] },
  phi: { lab: 'φ', m: 1019.461, w: 4.249, q: 0, tau: 1.549e-22, col: [240, 230, 140], cc: 'phi', res: true, dec: [[0.492, ['K+', 'K-']], [0.17, ['K0L', 'K0S']], [0.17, ['K0S', 'K0L']], [0.153, ['pi+', 'pi-', 'pi0']], [0.013, ['eta', 'g']]] },
  'Ks+': { lab: 'K*⁺', m: 891.67, w: 51.4, q: 1, tau: 1.28e-23, col: [245, 220, 110], cc: 'Ks-', res: true, dec: [[1 / 3, ['K0S', 'pi+']], [1 / 3, ['K0L', 'pi+']], [1 / 3, ['K+', 'pi0']]] },
  Ks0: { lab: 'K*⁰', m: 895.55, w: 47.3, q: 0, tau: 1.39e-23, col: [245, 220, 110], cc: 'Ksb0', res: true, dec: [[2 / 3, ['K+', 'pi-']], [1 / 6, ['K0S', 'pi0']], [1 / 6, ['K0L', 'pi0']]] },
  Dpp: { lab: 'Δ⁺⁺', m: 1232, w: 117, q: 2, B: 1, tau: 5.63e-24, col: [210, 150, 255], cc: 'Dbmm', res: true, dec: [[1, ['p', 'pi+']]] },
  Dp: { lab: 'Δ⁺', m: 1232, w: 117, q: 1, B: 1, tau: 5.63e-24, col: [210, 150, 255], cc: 'Dbm', res: true, dec: [[2 / 3, ['p', 'pi0']], [1 / 3, ['n', 'pi+']]] },
  D0: { lab: 'Δ⁰', m: 1232, w: 117, q: 0, B: 1, tau: 5.63e-24, col: [210, 150, 255], cc: 'Db0', res: true, dec: [[2 / 3, ['n', 'pi0']], [1 / 3, ['p', 'pi-']]] },
  Dm: { lab: 'Δ⁻', m: 1232, w: 117, q: -1, B: 1, tau: 5.63e-24, col: [210, 150, 255], cc: 'Dbp', res: true, dec: [[1, ['n', 'pi-']]] },
  // charm and bottom mesons (1.15, from the honest approximations: c and b quarks were made into light hadrons). Mean
  // lives and masses PDG 2024; their main decays, the rest of each total shared out over them in proportion (inclusive
  // rates; the many small channels left out). heavy: they fly through nuclei (their strong hits are not modelled).
  Dc0: { lab: 'D⁰', m: 1864.84, q: 0, tau: 4.103e-13, col: [120, 230, 255], cc: 'Dcb0', heavy: true, dec: [[0.0395, ['K-', 'pi+']], [0.144, ['K-', 'pi+', 'pi0']], [0.0822, ['K-', 'pi+', 'pi+', 'pi-']], [0.0549, ['K0S', 'pi+', 'pi-']], [0.0549, ['K0L', 'pi+', 'pi-']], [0.0353, ['K-', 'e+', 'nu']], [0.0341, ['K-', 'mu+', 'nu']], [0.0149, ['pi+', 'pi-', 'pi0']], [0.0124, ['K0S', 'pi0']], [0.0124, ['K0L', 'pi0']], [0.0041, ['K+', 'K-']]] },
  'Dc+': { lab: 'D⁺', m: 1869.66, q: 1, tau: 1.033e-12, col: [120, 230, 255], cc: 'Dc-', heavy: true, dec: [[0.0938, ['K-', 'pi+', 'pi+']], [0.0625, ['K-', 'pi+', 'pi+', 'pi0']], [0.0736, ['K0S', 'pi+', 'pi0']], [0.0736, ['K0L', 'pi+', 'pi0']], [0.0156, ['K0S', 'pi+']], [0.0146, ['K0L', 'pi+']], [0.0436, ['K0S', 'e+', 'nu']], [0.0436, ['K0L', 'e+', 'nu']], [0.0438, ['K0S', 'mu+', 'nu']], [0.0438, ['K0L', 'mu+', 'nu']], [0.0327, ['pi+', 'pi+', 'pi-']]] },
  'Ds+': { lab: 'D⁺s', m: 1968.35, q: 1, tau: 5.04e-13, col: [140, 210, 255], cc: 'Ds-', heavy: true, dec: [[0.045, ['phi', 'pi+']], [0.054, ['K+', 'K-', 'pi+']], [0.0145, ['K0S', 'K+']], [0.0145, ['K0L', 'K+']], [0.017, ['eta', 'pi+']], [0.0239, ['phi', 'e+', 'nu']], [0.0548, ['tau+', 'nutau']], [0.0055, ['mu+', 'numu']], [0.108, ['pi+', 'pi+', 'pi-', 'pi0']]] },
  'B+': { lab: 'B⁺', m: 5279.34, q: 1, tau: 1.638e-12, col: [255, 200, 120], cc: 'B-', heavy: true, dec: [[0.11, ['Dcb0', 'e+', 'nu']], [0.11, ['Dcb0', 'mu+', 'nu']], [0.03, ['Dcb0', 'tau+', 'nutau']], [0.05, ['Dcb0', 'pi+']], [0.25, ['Dcb0', 'pi+', 'pi0']], [0.25, ['Dcb0', 'pi+', 'pi+', 'pi-']], [0.1, ['Dc-', 'pi+', 'pi+']], [0.08, ['Dcb0', 'Ds+']]] },
  B0: { lab: 'B⁰', m: 5279.65, q: 0, tau: 1.517e-12, col: [255, 200, 120], cc: 'Bb0', heavy: true, dec: [[0.105, ['Dc-', 'e+', 'nu']], [0.105, ['Dc-', 'mu+', 'nu']], [0.03, ['Dc-', 'tau+', 'nutau']], [0.05, ['Dc-', 'pi+']], [0.25, ['Dc-', 'pi+', 'pi0']], [0.25, ['Dc-', 'pi+', 'pi+', 'pi-']], [0.1, ['Dcb0', 'pi+', 'pi-']], [0.08, ['Dc-', 'Ds+']]] },
  'tau-': { lab: 'τ⁻', m: 1776.86, q: -1, tau: 2.903e-13, col: [255, 115, 150], cc: 'tau+', dec: [[0.1782, ['e-', 'nub', 'nu']], [0.1739, ['mu-', 'nub', 'nu']], [0.1082, ['pi-', 'nu']], [0.2549, ['pi-', 'pi0', 'nu']], [0.0926, ['pi-', 'pi0', 'pi0', 'nu']], [0.0899, ['pi-', 'pi-', 'pi+', 'nu']], [0.0455, ['pi-', 'pi-', 'pi+', 'pi0', 'nu']], [0.0104, ['pi-', 'pi0', 'pi0', 'pi0', 'nu']], [0.0070, ['K-', 'nu']]] },
};
function conjTok(t) { return XP[t] ? XP[t].cc : ({ 'e-': 'e+', 'e+': 'e-', nu: 'nub', nub: 'nu', numu: 'numub', numub: 'numu', nutau: 'nutaub', nutaub: 'nutau', p: 'pbar', pbar: 'p', n: 'nbar', nbar: 'n' })[t] || t; }
for (const [k, of, lab] of [['K-', 'K+', 'K⁻'], ['Lamb', 'Lam', 'Λ̄'], ['tau+', 'tau-', 'τ⁺'], ['Sigb-', 'Sig+', 'Σ̄⁻'], ['Sigb+', 'Sig-', 'Σ̄⁺'], ['Xib0', 'Xi0', 'Ξ̄⁰'], ['Xib+', 'Xi-', 'Ξ̄⁺'], ['Omgb+', 'Omg-', 'Ω̄⁺'], ['rho-', 'rho+', 'ρ⁻'], ['Ks-', 'Ks+', 'K*⁻'], ['Ksb0', 'Ks0', 'K̄*⁰'], ['Dbmm', 'Dpp', 'Δ̄⁻⁻'], ['Dbm', 'Dp', 'Δ̄⁻'], ['Db0', 'D0', 'Δ̄⁰'], ['Dbp', 'Dm', 'Δ̄⁺'], ['Dcb0', 'Dc0', 'D̄⁰'], ['Dc-', 'Dc+', 'D⁻'], ['Ds-', 'Ds+', 'D⁻s'], ['B-', 'B+', 'B⁻'], ['Bb0', 'B0', 'B̄⁰']]) { // the antiparticles: every charge reversed, decays mirrored
  const s = XP[of];
  XP[k] = Object.assign({}, s, { lab, q: -s.q, B: s.B ? -s.B : 0, cc: of, dec: s.dec.map(([b, ps]) => [b, ps.map(conjTok)]) });
}
/* Neutrinos keep their flavour (labels only: they leave the box untouched): a muon's decay gives a muon neutrino and an
   electron antineutrino, a pion's the neutrino of the muon or electron it makes, a tau's a tau neutrino with the rest;
   nuclei (β decay, capture) the electron's. 'nu', 'nub' are the electron's; 'numu', 'numub', 'nutau', 'nutaub'. */
for (const [k, d] of Object.entries(XP)) {
  const lep = /^tau/.test(k) ? 'tau' : /^mu[+-]$/.test(k) ? 'mu' : null;
  d.dec = d.dec.map(([b, ps]) => {
    const fl = ps.includes('mu-') || ps.includes('mu+') ? 'mu' : 'e';
    let own = false; // (a lepton decaying: one neutrino is its own flavour, of its own lepton number)
    return [b, ps.map(t => {
      if (t !== 'nu' && t !== 'nub') return t;
      const anti = t === 'nub';
      if (lep && !own && anti === (d.q > 0)) { own = true; return lep === 'mu' ? (anti ? 'numub' : 'numu') : (anti ? 'nutaub' : 'nutau'); }
      if (!lep && fl === 'mu') return anti ? 'numub' : 'numu';
      if (lep === 'tau' && fl === 'mu') return anti ? 'numub' : 'numu';
      return t;
    })];
  });
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
  return tok === 'g' ? { t: 'g' } : { t: 'v', anti: /b$/.test(tok), fl: /tau/.test(tok) ? 'tau' : /mu/.test(tok) ? 'mu' : 'e' };
}
function massOf(it) { return it.t === 'x' ? (it.m || XP[it.sp].m) : it.t === 'A' ? nucMeV(it.Z, it.N) : it.t === 'e' ? PHYS.MEC2 : 0; }
function conjItem(it) {
  return it.t === 'x' ? { t: 'x', sp: XP[it.sp].cc } : it.t === 'A' ? { t: 'A', Z: it.Z, N: it.N, anti: !it.anti } : it.t === 'e' ? { t: 'e', q: -it.q } : it.t === 'v' ? { t: 'v', anti: !it.anti } : it;
}
function labelOf(it) {
  if (it.t === 'x') return XP[it.sp].lab;
  if (it.t === 'e') return it.q < 0 ? 'e⁻' : 'e⁺';
  if (it.t === 'g') return 'γ';
  if (it.t === 'v') return nuLab(it.anti, it.fl);
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
/* ln Γ(x) for whole and half-whole x ≥ ½ (the 3-D Fermi weights, 1.25). */
function lnGamma(x) { if (Math.abs(x - Math.round(x)) < 1e-9) return lnFact(Math.round(x) - 1); let r = 0.5 * Math.log(Math.PI); for (let y = 0.5; y < x - 1e-9; y += 1) r += Math.log(y); return r; }

/* ---- four-momenta [E, px, py] (MeV); in a 3-D world [E, px, py, pz] (1.25): every helper below takes either, by its
   length, so an event works out the same in both (in the flat world the arithmetic and the random draws are exactly
   those of before 1.25). */
function p4of(p, bare) { // bare: a nucleus without its electrons (they ride along and are handed back after)
  const mf = restE(p) / MEV, m = bare && p.k === NUC ? nucMeV(p.Z, p.N) : mf, K = keOf(p) / MEV * (m / mf);
  const pm = Math.sqrt(Math.max(0, K * (K + 2 * m)));
  if (W.d3) { // (3-D, 1.25: along its velocity in depth)
    let ux = 1, uy = 0, uz = 0;
    if (p.rad) { ux = p.ux; uy = p.uy; uz = p.uz || 0; } else { const v = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz); if (v > 0) { ux = p.vx / v; uy = p.vy / v; uz = p.vz / v; } }
    return [m + K, pm * ux, pm * uy, pm * uz];
  }
  let ux = 1, uy = 0;
  if (p.rad) { ux = p.ux; uy = p.uy; } else { const v = Math.hypot(p.vx, p.vy); if (v > 0) { ux = p.vx / v; uy = p.vy / v; } }
  return [m + K, pm * ux, pm * uy];
}
const add4 = (a, b) => (a.length > 3 ? [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]] : [a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
const mass4 = (v) => (v.length > 3 ? Math.sqrt(Math.max(0, v[0] * v[0] - v[1] * v[1] - v[2] * v[2] - v[3] * v[3])) : Math.sqrt(Math.max(0, v[0] * v[0] - v[1] * v[1] - v[2] * v[2])));
const toLab = (v, bx, by, bz, g) => (v.length > 3 ? boost3(v[0], v[1], v[2], v[3], -bx, -by, -bz, g) : boost(v[0], v[1], v[2], -bx, -by, g)); // from a frame moving at (bx, by[, bz]) (units of c) to the lab (g: its Lorentz factor, when known exactly, 1.26)
const toRest = (v, bx, by, bz) => (v.length > 3 ? boost3(v[0], v[1], v[2], v[3], bx, by, bz) : boost(v[0], v[1], v[2], bx, by)); // and back
const vel4 = (P) => (P.length > 3 ? [P[1] / P[0], P[2] / P[0], P[3] / P[0]] : [P[1] / P[0], P[2] / P[0]]); // (the velocity of a four-momentum's frame: toLab(v, ...vel4(P)))
const pmag = (v) => (v.length > 3 ? Math.sqrt(v[1] * v[1] + v[2] * v[2] + v[3] * v[3]) : Math.hypot(v[1], v[2])); // (a four-momentum's |p|)
const unit3 = (v) => { if (v.length < 4) return null; const L = pmag(v) || 1; return [v[1] / L, v[2] / L, v[3] / L]; }; // (3-D: its direction, for jetMomenta's opts.ax3)
let _evZ3 = 0; // (3-D: the depth of the nuclear encounter being worked out, for finishReaction, 1.25)
const neg4 = (E, P) => (P.length > 3 ? [E, -P[1], -P[2], -P[3]] : [E, -P[1], -P[2]]); // (energy E, momentum −P's)
/* A random direction: in the plane from one draw, on the sphere from two in 3-D (1.25). A new array. */
function rdir() { if (W.d3) { const u = rndDir(); return [u[0], u[1], u[2]]; } const th = rnd() * 2 * Math.PI; return [Math.cos(th), Math.sin(th)]; }
const turn2 = (ux, uy, a) => [ux * Math.cos(a) - uy * Math.sin(a), ux * Math.sin(a) + uy * Math.cos(a)];
/* A direction u (2 or 3 numbers) turned by the angle a: in the plane, a turn; in 3-D, about an axis across it at a random
   azimuth (one draw, turn3). */
function turnU(u, a) { if (u.length > 2) { const t = turn3(u[0], u[1], u[2], Math.abs(a)); return [t[0], t[1], t[2]]; } return turn2(u[0], u[1], a); }
function breakupQ(M, m1, m2) { const s = M * M, a = s - (m1 + m2) * (m1 + m2), b = s - (m1 - m2) * (m1 - m2); return a > 0 && b > 0 ? Math.sqrt(a * b) / (2 * M) : 0; }
/* Two bodies flying apart along ±(ux, uy[, uz]) in the rest frame of mass M. */
function twoBody(M, m1, m2, ux, uy, uz) {
  const q = breakupQ(M, m1, m2);
  if (uz !== undefined) return [[Math.sqrt(m1 * m1 + q * q), q * ux, q * uy, q * uz], [Math.sqrt(m2 * m2 + q * q), -q * ux, -q * uy, -q * uz]]; // (3-D, 1.25)
  return [[Math.sqrt(m1 * m1 + q * q), q * ux, q * uy], [Math.sqrt(m2 * m2 + q * q), -q * ux, -q * uy]];
}
/* n bodies of masses ms sharing the rest energy M, their momenta drawn uniformly over relativistic phase space. In
   two dimensions the two-body phase space is the same for every split (π/2M), so drawing the intermediate masses
   uniformly (sorted uniform numbers, as in James's GENBOD) gives the invariant phase space with no weights.
   Returns [E, px, py] for each in the rest frame, or null if M is too small. In a 3-D world phaseSpace3. */
function phaseSpace(M, ms) {
  if (W.d3) return phaseSpace3(M, ms);
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
/* (3-D, 1.25) The same in three dimensions: GENBOD proper. There the two-body phase space grows with the momentum the two
   share (πq/M), so the uniform intermediate masses are weighted by the product of the breakup momenta, Πq, and kept by
   rejection against its largest possible value (James's bound: each q at the most its masses allow). Directions on the
   sphere. Exact for two bodies (no draw is rejected); the acceptance falls with the number of bodies (measured: see
   PERF-NOTES 1.25), and after PS3_TRIES tries the last draw is kept (its momenta still add up exactly; only its weight
   is off). Returns [E, px, py, pz] for each in the rest frame, or null if M is too small. */
const PS3_TRIES = 3000, PS3 = { calls: 0, tries: 0, capped: 0, flat: 0 };
function phaseSpace3(M, ms) {
  const n = ms.length;
  if (!n) return [];
  if (n === 1) return [[M, 0, 0, 0]];
  let sum = 0; for (const m of ms) sum += m;
  const T = M - sum;
  if (!(T >= 0)) return null;
  PS3.calls++;
  let wmax = 1, emax = T + ms[0], emin = 0;
  for (let k = 1; k < n; k++) { emin += ms[k - 1]; emax += ms[k]; wmax *= breakupQ(emax, emin, ms[k]); }
  const Mk = new Array(n), r = new Array(Math.max(0, n - 2));
  for (let tries = 0; ; tries++) {
    for (let i = 0; i < n - 2; i++) r[i] = rnd();
    if (n > 3) r.sort((a, b) => a - b);
    let acc = 0;
    for (let k = 0; k < n; k++) { acc += ms[k]; Mk[k] = k === 0 ? ms[0] : k === n - 1 ? M : acc + T * r[k - 1]; }
    if (n === 2) break;
    let w = 1; for (let k = 1; k < n; k++) w *= breakupQ(Mk[k], Mk[k - 1], ms[k]);
    PS3.tries++;
    if (rnd() * wmax <= w) break;
    if (tries >= PS3_TRIES) { PS3.capped++; break; }
  }
  const v = [];
  for (let k = 1; k < n; k++) {
    const q = breakupQ(Mk[k], Mk[k - 1], ms[k]), u = rdir(), Es = Math.sqrt(Mk[k - 1] * Mk[k - 1] + q * q);
    if (k === 1) v.push([Es, q * u[0], q * u[1], q * u[2]]);
    else { const bx = q * u[0] / Es, by = q * u[1] / Es, bz = q * u[2] / Es; for (let i = 0; i < k; i++) v[i] = toLab(v[i], bx, by, bz); }
    v.push([Math.sqrt(ms[k] * ms[k] + q * q), -q * u[0], -q * u[1], -q * u[2]]);
  }
  return v;
}


/* ---- hypernuclei. A Λ (u d s) inside a nucleus is not kept out by the Pauli principle (no other particle there is
   one), so it sinks to the lowest orbit and is bound: a hypernucleus, written ᴬΛX (A counting the Λ). Bound by
   B_Λ: 0.13 MeV in the hypertriton ³ΛH, 11.7 MeV in ¹³ΛC, toward 30 MeV in heavy nuclei (measured values up to A = 16,
   then a fit, 30.5 − 120/A^⅔ MeV). It lives about as long as a free Λ (0.2–0.26 ns) and dies one of two ways: as a
   free Λ would, Λ → p π⁻ or n π⁰ (mesonic: blocked more and more in heavier nuclei, where the slots the nucleon would
   need are taken), or by meeting a nucleon, Λp → np or Λn → nn (non-mesonic, about two to one), 176 MeV going to the
   two nucleons, which usually break the nucleus. Made here when a Λ comes out of a nucleus too slowly to leave it
   (a quark pulled out by hand; a stopped K⁻ absorbed, K⁻p → Λπ⁰, K⁻n → Λπ⁻), or placed by hand. They are particles in
   flight (W.exo), bare nuclei with the Λ. */
const LAM_M = 1115.683, HYP_B = { 3: 0.13, 4: 2.3, 5: 3.12, 6: 4.2, 7: 5.6, 8: 6.8, 9: 6.71, 10: 9.1, 11: 10.2, 12: 11.37, 13: 11.69, 14: 12.2, 15: 12.6, 16: 12.9 };
const hypB = (A) => (HYP_B[A] !== undefined ? HYP_B[A] : Math.max(0, 30.5 - 120 / Math.pow(A, 2 / 3))); // A: the hypernucleus's, with the Λ
const hypDepth = (A) => 4 + 24 * (1 - 1 / Math.cbrt(Math.max(1, A - 1))); // the Λ's well (MeV): a slower Λ stays
function hypSpecies(Z, N) { // the core (Z, N) with a Λ: its XP entry, made when first needed
  if (Z < 1 || Z > Z_MAX || Z + N < 2) return null;
  const k = `hy${Z}_${N}`; if (XP[k]) return k;
  const A = Z + N + 1, B = hypB(A); if (!(B > 0)) return null;
  XP[k] = { lab: sup(A) + 'Λ' + ELEMENTS[Z].sym, m: nucMeV(Z, N) + LAM_M - B, q: Z, B: A, tau: A === 3 ? 2.4e-10 : 2.3e-10, col: [200, 150, 255], cc: k, hyp: true, Z, N, BL: B, dec: [[1, ['g']]] };
  return k;
}
const hypMesonic = (A) => (A <= 4 ? 0.85 : A <= 12 ? 0.3 : A <= 40 ? 0.08 : 0.02); // (Pauli blocking of the nucleon from Λ → Nπ)
/* (1.25) The nearest atom within R of a stopped particle o that skip() does not rule out: in the plane, or in 3-D. */
function stopTarget(o, skip, R = 4) {
  let tg = null, bd = R * R;
  if (W.d3) { nearby(o.x, o.y, R, (p, dx, dy, r2) => { if (skip(p)) return; if (r2 < bd) { bd = r2; tg = p; } }, o.z); return tg; }
  nearby(o.x, o.y, R, (p) => { if (skip(p)) return; const d = (p.x - o.x) ** 2 + (p.y - o.y) ** 2; if (d < bd) { bd = d; tg = p; } });
  return tg;
}
/* (1.25) An unstable particle's velocity in units of c, [bx, by] or in 3-D [bx, by, bz]. */
function exoBeta(o) { const b = o.v / PHYS.C; return W.d3 ? [b * o.ux, b * o.uy, b * o.uz] : [b * o.ux, b * o.uy]; }
/* The residual nucleus of an event as items: a nucleon, a light nucleus broken up as it can, or a heavier one cooling. */
function residualInto(Z, N, Ms, P, anti, items, moms) {
  const A = Z + N; if (A < 1) return;
  if (A === 1) { items.push({ t: 'A', Z, N, anti }); moms.push(P); return; }
  if (Z === 0 || A <= 16) { if (!fermiInto(Z, N, Ms, P, anti, items, moms)) gammaOut(Z, N, Ms, P, anti, items, moms); }
  else compoundDecay(Z, N, Ms, P, anti, items, moms, 0);
}
function hypDecay(o) {
  const d = XP[o.sp], Z = d.Z, N = d.N, A = Z + N + 1, fm = hypMesonic(A);
  const ch = [[fm * 0.64, Z + 1, N, ['pi-'], 'mesonic: Λ → p π⁻ inside'], [fm * 0.36, Z, N + 1, ['pi0'], 'mesonic: Λ → n π⁰ inside']];
  if (Z >= 1) ch.push([(1 - fm) * 2 / 3, Z - 1, N, ['p', 'n'], 'non-mesonic: Λp → np']);
  if (N >= 1) ch.push([(1 - fm) / 3, Z, N - 1, ['n', 'n'], 'non-mesonic: Λn → nn']);
  const [bx, by, bz] = exoBeta(o);
  for (let tries = 0; tries < 8; tries++) {
    const [, Zr, Nr, others, how] = pickBr(ch.map(c => [c[0], c])), Ar = Zr + Nr, oth = others.map(item);
    const Ex = Ar >= 2 ? 6 * rnd() : 0, mres = Ar ? nucMeV(Zr, Nr) + Ex : 0;
    const vs = phaseSpace(d.m, Ar ? [mres, ...oth.map(massOf)] : oth.map(massOf)); if (!vs) continue;
    const items = [], moms = []; let j = 0;
    if (Ar) residualInto(Zr, Nr, mres, toLab(vs[j++], bx, by, bz, o.gam), false, items, moms); // (o.gam: its γ itself, 1.26)
    for (const it of oth) { items.push(it); moms.push(toLab(vs[j++], bx, by, bz, o.gam)); }
    const S = nucBegin([]); o.dead = true;
    const made = spawnItems(items, moms, o.x, o.y, o.z);
    closeEvent(S, made, o.x, o.y, o.KE + o.m * MEV, o.m * MEV);
    const txt = `${d.lab} → ${summarize(items)}`; o.fate = `decayed: ${txt}`; W.count.decay++;
    nucEvent('pdecay', o.x, o.y, `Hypernucleus decay: ${txt}`, [{ x: o.x, y: o.y, k: 'x', rd: 0.15, lbl: d.lab }], how, undefined, o.z); // (at its depth in 3-D, as its flash: 1.26 sweep)
    log('nuc', `Hypernucleus decay: ${txt} (${how})`); flash(o.x, o.y, d.col, 3.5, 0.4, o.z); tally(items, [d.lab], txt);
    return;
  }
  exoLeaves(o);
}
/* A Λ (rest-frame 4-momentum PL) and the nucleus left (Zr, Nr, mass mres, 4-momentum Pr) in one event: if the Λ is
   too slow to leave (its kinetic energy against the nucleus under the well's depth), they are one hypernucleus,
   whatever energy is over leaving as a γ ray. Pushes the items (in the frame given, boosted by bx, by) and returns
   true; false if the Λ goes free. */
function hypCatch(Zr, Nr, mres, Pr, PL, bx, by, items, moms, bz = 0) { // (bz: 3-D, 1.25)
  const sp = hypSpecies(Zr, Nr); if (!sp) return false;
  const P = add4(Pr, PL), M = mass4(P), Krel = M - mres - LAM_M, A = Zr + Nr + 1;
  if (!(Krel < hypDepth(A)) || rnd() < 0.8) return false; // (most of those still slip out — made near the surface, or knocked on by another nucleon: per stopped K⁻ a few percent stay, as measured)
  const mh = XP[sp].m; if (!(M > mh)) return false;
  const u = rdir(), [vh, vg] = twoBody(M, mh, 0, ...u), cx = P[1] / P[0], cy = P[2] / P[0], cz = (P[3] || 0) / P[0];
  items.push({ t: 'x', sp }); moms.push(toLab(toLab(vh, cx, cy, cz), bx, by, bz));
  if (vg[0] > 1e-6) { items.push({ t: 'g' }); moms.push(toLab(toLab(vg, cx, cy, cz), bx, by, bz)); }
  return true;
}
/* A K⁻ slowed to a few keV: caught by an atom, it cascades down and is absorbed by the nucleus, K⁻p → Λπ⁰ or
   K⁻n → Λπ⁻ on one of its nucleons (the rest of the nucleus a spectator); the Λ, at about 30 MeV, may stay (hypCatch). */
function kStop(o, tgIn) { // (tgIn: as hStop, 1.27)
  const tg = tgIn || stopTarget(o, (p) => p.dead || p.k !== NUC || p.Z < 1 || p.anti || p.mu);
  if (!tg) return false;
  // the struck nucleon moves inside the nucleus (Fermi motion, up to about 250 MeV/c; none in a lone proton), and the rest
  // recoils against it: that is what leaves some Λ slow enough to stay. (Bug fix 15 after 1.25: with the kaon's own
  // momentum and the atom's motion, struckNucleon's spectator model in the atom's frame; the kaon was taken at rest and
  // the nucleus's motion left out, momentum kept only to 0.9 MeV/c. The same random draws, in the same order.)
  const { onP, Zr, Nr, mres, PN, Pres } = struckNucleon(tg);
  const Pe = add4(exoP4(o), PN), me = mass4(Pe), pi = onP ? 'pi0' : 'pi-', ex = Pe[1] / Pe[0], ey = Pe[2] / Pe[0], ez = (Pe[3] || 0) / Pe[0];
  if (!(me > LAM_M + XP[pi].m)) return false;
  const u = rdir(), [vL0, vp0] = twoBody(me, LAM_M, XP[pi].m, ...u), vL = toLab(vL0, ex, ey, ez), vp = toLab(vp0, ex, ey, ez);
  const items = [], moms = [], x = tg.x, y = tg.y, el = hitLabel(tg);
  items.push(item(pi)); moms.push(vp);
  let hyp = false;
  if (Zr + Nr >= 2) hyp = hypCatch(Zr, Nr, mres, Pres, vL, 0, 0, items, moms);
  if (!hyp) { items.push(item('Lam')); moms.push(vL); if (Zr + Nr) residualInto(Zr, Nr, mres, Pres, false, items, moms); }
  const e0 = moms.length;
  for (let i = 0; i < tg.ne; i++) { items.push(item('e-')); moms.push(randDir4(PHYS.MEC2, 5 / MEV)); }
  if (tg.ne) { // (the freed electrons carry, between them, the momentum they had riding on the atom: the nucleus's share is in PN, Pres)
    const Pa = p4of(tg), Pb = p4of(tg, true), n = tg.ne, d = Pa.length;
    for (let c = 1; c < d; c++) { let k = 0; for (let i = e0; i < moms.length; i++) k += moms[i][c]; const sh = (Pa[c] - Pb[c] - k) / n; for (let i = e0; i < moms.length; i++) moms[i][c] += sh; }
    for (let i = e0; i < moms.length; i++) { let p2 = 0; for (let c = 1; c < d; c++) p2 += moms[i][c] * moms[i][c]; moms[i][0] = Math.sqrt(PHYS.MEC2 * PHYS.MEC2 + p2); }
  }
  const txt = `K⁻ + ${el} → ${summarize(items.filter(it => it.t !== 'e'))}`;
  exoEvent(o, [tg], items, moms, x, y, 'capture', txt, hyp ? 'kaon absorbed: the Λ stayed, a hypernucleus' : `kaon absorbed: K⁻${onP ? 'p → Λπ⁰' : 'n → Λπ⁻'}`, tg.z);
  return true;
}

/* ---- Unstable hadrons and nuclei (0.62). A hadron in flight that passes within a nucleus's reach (where the nucleus
   is drawn, as for nucleons) meets it: in the outer part of the reach it scatters elastically (diffraction, at the
   angle ħ/(pR)), nearer in it meets one nucleon (Fermi motion as in kStop; the rest a spectator, a little excited):
   a pion is absorbed on a nucleon pair below about 300 MeV half the time (π⁺ pn → pp …: the nucleus takes ~140 MeV
   and boils off nucleons), otherwise it and the nucleon hadronize (πN → πN, charge exchange included, and more
   pions with energy); K⁻ (and the K̄⁰ in a K⁰L) exchange strangeness (K̄N → Λπ); K⁺ and K⁰ scatter off it, swapping
   charge sometimes (K⁺n → K⁰p); a hyperon knocks the nucleon out (YN → YN; Σ N → Λ N a third of the time); an
   antibaryon annihilates with it into pions and the kaons its antistrange quarks need. A Λ left slow may stay
   (hypCatch). Hypernuclei only scatter. Energy, momentum, charge, baryon number and strangeness are kept. */
const HIT_INEL = 0.6; // (inelastic share of a hadron–nucleus cross-section, about 0.6 for pions and kaons alike)
function strongExo(sp) { const d = XP[sp]; return !!d && !d.res && !d.atom && !d.stuck && !d.heavy && (d.hyp || (typeof Q_CONTENT !== 'undefined' && !!Q_CONTENT[sp])); }
function exoP4(o) { const m = o.m, K = o.KE / MEV, p = Math.sqrt(Math.max(0, K * (K + 2 * m))); return W.d3 ? [m + K, p * o.ux, p * o.uy, p * o.uz] : [m + K, p * o.ux, p * o.uy]; } // (3-D: with its depth, 1.25)
/* One nucleon of tg struck, with its Fermi motion; onP forced or by chance. */
function struckNucleon(tg, onP) {
  const Z = tg.Z, N = tg.N; if (onP === undefined) onP = rnd() < Z / (Z + N);
  if (onP ? Z < 1 : N < 1) onP = !onP;
  const Zr = Z - (onP ? 1 : 0), Nr = N - (onP ? 0 : 1), mres = Zr + Nr ? nucMeV(Zr, Nr) : 0, mN = nucMeV(Z, N) - mres;
  const kF = Zr + Nr ? 250 * Math.sqrt(rnd()) : 0, f = rdir(), T = p4of(tg, true), bx = T[1] / T[0], by = T[2] / T[0], bz = (T[3] || 0) / T[0];
  // the spectator model: the rest of the nucleus is on its mass shell with −k, the struck nucleon takes what is left of
  // the nucleus's mass (bound, a little off shell), so the two add up to the nucleus exactly
  const Er = Math.sqrt(mres * mres + kF * kF), Pres = toLab([Er, ...f.map(c => -kF * c)], bx, by, bz), PN = toLab([mres + mN - Er, ...f.map(c => kF * c)], bx, by, bz);
  return { onP, Zr, Nr, mres, mN, PN, Pres };
}
/* The items of an encounter, spread over the invariant mass of what came in (Pin), and the residual nucleus (excited
   by Ex MeV) as its own items. Returns false if they don't fit. */
function exoOut(outs, Pin, sN, Ex, items, moms) {
  const Ar = sN.Zr + sN.Nr, M = mass4(Pin), ms = outs.map(massOf), Mres = Ar ? sN.mres + (Ar > 1 ? Ex : 0) : 0; // (a lone nucleon left over cannot be excited)
  if (Mres) ms.push(Mres);
  if (!(M > ms.reduce((t, m) => t + m, 0) + 0.01)) return false;
  const vs = phaseSpace(M, ms); if (!vs) return false;
  const bx = Pin[1] / Pin[0], by = Pin[2] / Pin[0], bz = (Pin[3] || 0) / Pin[0], g = Pin[0] / M; // (g: the frame's γ as E/M, so the products add up to Pin exactly: from 1 − β² a 100 TeV hadron's hit kept ~10⁻⁹ of its energy unsettled, 0.1–0.2 MeV, 1.26)
  outs.forEach((it, i) => { items.push(it); moms.push(toLab(vs[i], bx, by, bz, g)); });
  if (Mres) residualInto(sN.Zr, sN.Nr, Mres, toLab(vs[vs.length - 1], bx, by, bz, g), false, items, moms);
  return true;
}
/* What was hit, for captions: the nucleus, and the molecule it is in when it is in one (¹⁶O in H₂O). */
function hitLabel(tg) { const m = tg.bonds && tg.bonds.length ? speciesLabel(tg) : ''; const n = tg.ne ? nucSymA(tg.Z, tg.N, tg.anti) : speciesLabel(tg); return m && m !== n ? `${n} in ${m}` : n; }
/* The struck atom's electrons stay with what is left of it (the heaviest nucleus made), as in a real atom whose
   nucleus reacts, up to its new charge; any over go free. */
function keepElectrons(items, moms, ne) {
  let h = null; for (const it of items) if (it.t === 'A' && !it.anti && it.Z > 0 && (!h || it.Z + it.N > h.Z + h.N)) h = it;
  const keep = h ? Math.min(ne, h.Z) : 0; if (h) h.ne = keep; // (at most neutral: an extra electron would need an affinity the new element may lack)
  for (let i = keep; i < ne; i++) { items.push(item('e-')); moms.push(randDir4(PHYS.MEC2, 5 / MEV)); }
}
function hadronHit(o, tg, u) {
  const d = XP[o.sp];
  if (u > Math.sqrt(HIT_INEL) || d.hyp || tg.Z + tg.N < 1) return exoElastic(o, tg);
  const con = Q_CONTENT[o.sp], qs = [...con], nS = qs.filter(c => c === 's').length - qs.filter(c => c === 'S').length; // (s quarks less s̄ antiquarks: minus the strangeness)
  const baryon = qs.length === 3, anti = baryon && qs[0] === qs[0].toUpperCase(), Po = exoP4(o);
  const items = [], moms = [], x = tg.x, y = tg.y, el = hitLabel(tg), Tq = o.KE / MEV;
  let txt = '', sub = '', ok = false;
  for (let tries = 0; tries < 4 && !ok; tries++) {
    items.length = 0; moms.length = 0;
    const sN = struckNucleon(tg), Nq = sN.onP ? 1 : 0, Pin = add4(add4(Po, sN.PN), sN.Pres);
    const Ex = 5 + 25 * rnd(); // (the spectator nucleus: a hole and a little heat)
    if (!baryon && (o.sp === 'pi+' || o.sp === 'pi-' || o.sp === 'pi0') && Tq < 300 && rnd() < 0.5 && tg.Z + tg.N >= 2) { // absorption on a pair
      const s2 = struckNucleon({ Z: sN.Zr, N: sN.Nr, x: tg.x, y: tg.y, vx: tg.vx, vy: tg.vy, vz: tg.vz, k: NUC, m: tg.m, ne: 0, rad: tg.rad, KE: tg.KE, sp: tg.sp, ux: tg.ux, uy: tg.uy, uz: tg.uz }); // (vz, uz: 3-D, 1.25)
      const q = o.q + Nq + (s2.onP ? 1 : 0); if (q < 0 || q > 2) continue;
      const outs = q === 2 ? ['p', 'p'] : q === 1 ? ['p', 'n'] : ['n', 'n'];
      if (!exoOut(outs.map(item), Pin, s2, Ex + 10, items, moms)) continue;
      txt = `${o.lab} absorbed by ${el}`; sub = `on a nucleon pair → ${outs.join('')}: the pion's mass heats the nucleus`; ok = true; break;
    }
    let outs;
    if (anti) { // annihilation: mesons, with a kaon for each antistrange quark
      const nK = -nS, ks = []; let mk = 0, qk = 0;
      for (let i = 0; i < nK; i++) { const pk = rnd() < 0.5; ks.push(item(pk ? 'K+' : rnd() < 0.5 ? 'K0S' : 'K0L')); mk += 495; qk += pk ? 1 : 0; }
      const M = mass4(add4(Po, sN.PN)), rest = hadronize(M - mk - 30, 0, o.q + Nq - qk, { minMeson: true });
      if (!rest) continue; outs = ks.concat(rest);
      txt = `${o.lab} + ${el}: annihilation`; sub = `on a ${sN.onP ? 'proton' : 'neutron'} → ${summarize(outs)}`;
    } else if (baryon) { // hyperon: knocks the nucleon out, or converts (Σ N → Λ N)
      let y1 = o.sp, n1 = sN.onP ? 'p' : 'n';
      if ((o.sp === 'Sig-' || o.sp === 'Sig+') && rnd() < 1 / 3) { const q = o.q + Nq; if (q === 0 || q === 1) { y1 = 'Lam'; n1 = q === 1 ? 'p' : 'n'; } }
      outs = [item(y1), item(n1)];
      txt = `${o.lab} + ${el}`; sub = y1 === o.sp ? `knocks out a ${sN.onP ? 'proton' : 'neutron'}` : `Σ N → Λ N: the Σ turns into a Λ`;
    } else if (nS > 0 || (o.sp === 'K0L' && rnd() < 0.5)) { // K̄ (an s quark): strangeness exchange, K̄N → Λπ (K⁰L is half K̄⁰)
      const q = (o.sp === 'K-' ? -1 : 0) + Nq; if (q < -1 || q > 1) continue;
      outs = [item('Lam'), item(q === 1 ? 'pi+' : q === -1 ? 'pi-' : 'pi0')];
      txt = `${o.lab} + ${el}`; sub = 'strangeness exchange: K̄N → Λπ';
    } else if (nS < 0 || o.sp === 'K0L' || o.sp === 'K0S') { // K (an s̄ antiquark): scatters off the nucleon, charge exchange possible
      const q = o.q + Nq, swap = rnd() < 0.3 && (q === 1);
      const kOut = swap ? (o.q ? (rnd() < 0.5 ? 'K0S' : 'K0L') : 'K+') : o.sp, nOut = swap ? (o.q ? 'p' : 'n') : (sN.onP ? 'p' : 'n');
      outs = [item(kOut), item(nOut)];
      txt = `${o.lab} + ${el}`; sub = swap ? 'charge exchange' : `knocks out a ${sN.onP ? 'proton' : 'neutron'}`;
    } else { // pions, η: hadronize with the nucleon
      const M = mass4(add4(Po, sN.PN)), h = hadronize(M - 5, 1, o.q + Nq, {}); if (!h) continue;
      outs = h; txt = `${o.lab} + ${el}`; sub = `${o.lab}${sN.onP ? 'p' : 'n'} → ${summarize(h)}`;
    }
    if (!exoOut(outs, Pin, sN, Ex, items, moms)) continue;
    // a Λ slow in the nucleus may stay
    const iL = items.findIndex(it => it.t === 'x' && it.sp === 'Lam');
    if (iL >= 0 && sN.Zr + sN.Nr >= 2) {
      const ri = items.findIndex((it, k) => k > iL && it.t === 'A' && it.Z === sN.Zr && it.N === sN.Nr);
      if (ri >= 0) { const its = [], ms = []; if (hypCatch(sN.Zr, sN.Nr, massOf(items[ri]), moms[ri], moms[iL], 0, 0, its, ms)) { items.splice(ri, 1); moms.splice(ri, 1); items.splice(iL, 1, ...its); moms.splice(iL, 1, ...ms); sub += '; the Λ stayed: a hypernucleus'; } }
    }
    ok = true;
  }
  if (!ok) return exoElastic(o, tg);
  keepElectrons(items, moms, tg.ne);
  exoEvent(o, [tg], items, moms, x, y, 'reaction', txt, sub, tg.z);
  W.count.nreact = (W.count.nreact || 0) + 1;
  return true;
}
/* Diffraction off the nucleus as a whole: the hadron turns by about ħ/(pR); the nucleus takes the momentum, and the
   energy it gets (keV at most) comes out of the hadron's, exactly. */
function exoElastic(o, tg) {
  const K = o.KE / MEV, p = Math.sqrt(Math.max(0, K * (K + 2 * o.m))); if (!(p > 0)) return false;
  const R = 1.2 * Math.cbrt(Math.max(1, tg.Z + tg.N)) + 1.2, th = gauss() * 197.327 / (p * R);
  if (W.d3) return exoElastic3(o, tg, p, th);
  const [nx, ny] = turn2(o.ux, o.uy, th), qx = p * (o.ux - nx), qy = p * (o.uy - ny); // (MeV/c given to the nucleus)
  const T = new Set(molecule(tg)), Ebefore = regionE(T); // (the books: whatever the kick does to the nucleus and its surroundings is paid by the hadron; measured over its molecule and what it touches, not the whole box: bug fix 12 after 1.25)
  const K0 = keOf(tg), Pt = p4of(tg), mt = restE(tg) / MEV, px = Pt[1] + qx, py = Pt[2] + qy, pm = Math.hypot(px, py); // (relativistic: the nucleus may itself be fast)
  if ((Math.sqrt(mt * mt + pm * pm) - mt) * MEV - K0 >= o.KE - 1) { exoElasticCM(o, tg, th, T, Ebefore); return false; } // (the hadron can't pay that recoil: a nucleus flying into it. Its energy was floored at 1 eV and the rest made from nothing, +47 MeV for a 4 MeV π⁻ meeting a 650 MeV proton; in their own frame instead, exactly, 1.26)
  setMotion(tg, (Math.sqrt(mt * mt + pm * pm) - mt) * MEV, pm > 0 ? px / pm : 1, pm > 0 ? py / pm : 0);
  const dK = keOf(tg) - K0;
  if (dK > 20 && tg.bonds.length) for (const bd of tg.bonds.slice()) removeBond(bd);
  if (dK > 10) tg.nucProd = true; // (sent flying by a nuclear event: slow motion for nuclear events, when off, does not follow it)
  o.ux = nx; o.uy = ny;
  const paid = regionE(T) - Ebefore; // (the nucleus's recoil, bonds it broke, forces it now flies too fast to feel)
  o.KE = Math.max(1, o.KE - paid); exoSpeed(o);
  o.hitId = tg.id;
  return false;
}
/* (3-D, 1.25) The same with the depth: the hadron turned by th about an axis across its path at a random azimuth. */
function exoElastic3(o, tg, p, th) {
  const n = turn3(o.ux, o.uy, o.uz, Math.abs(th)), nx = n[0], ny = n[1], nz = n[2], qx = p * (o.ux - nx), qy = p * (o.uy - ny), qz = p * (o.uz - nz);
  const K0 = keOf(tg), Pt = p4of(tg), mt = restE(tg) / MEV, px = Pt[1] + qx, py = Pt[2] + qy, pz = Pt[3] + qz, pm = Math.sqrt(px * px + py * py + pz * pz), K1 = (Math.sqrt(mt * mt + pm * pm) - mt) * MEV;
  if (K1 - K0 >= o.KE - 1) { exoElasticCM(o, tg, th); return false; } // (the hadron can't pay that recoil (a nucleus flying into it): its energy was floored at 1 eV and the rest made from nothing, +31–55 MeV a hit in a 1 TeV α's cascade; in their own frame instead, exactly, 1.26)
  // (the books, without measuring the whole box's energy (tens of ms at a thousand atoms): the nucleus is given exactly K1;
  // its bonds stay, to stretch or break in the steps that follow, unless it goes into flight, where switchMode breaks them
  // and pays for them from its motion; the hadron pays K1 − K0)
  setMotion(tg, K1, pm > 0 ? px / pm : 1, pm > 0 ? py / pm : 0, 0, 0, pm > 0 ? pz / pm : 0);
  if (K1 - K0 > 10) tg.nucProd = true;
  o.ux = nx; o.uy = ny; o.uz = nz;
  o.KE = Math.max(1, o.KE - (K1 - K0)); exoSpeed(o);
  o.hitId = tg.id;
  return false;
}
/* (1.26) The elastic turn in the pair's own frame, exactly (energy and momentum): for a hadron too slow to pay the lab
   recipe's recoil, i.e. a nucleus in flight running into it. The hadron's momentum there is turned by th (flat: in the
   plane; 3-D: about an axis across it at a random azimuth); both boosted back. Flat: the nucleus's surroundings (T, its
   energy Ebefore) measured as exoElastic does, any change of potential energy (bonds, flight) paid by the hadron. */
function exoElasticCM(o, tg, th, T, Ebefore) {
  const Po = exoP4(o), Pt = p4of(tg), P = add4(Po, Pt), M = mass4(P), b = vel4(P), A = toRest(Po, ...b), pc = pmag(A), mt = restE(tg) / MEV;
  const u0 = A.length > 3 ? [A[1] / pc, A[2] / pc, A[3] / pc] : [A[1] / pc, A[2] / pc], u = turnU(u0, th);
  const Ao = toLab([A[0], ...u.map(c => pc * c)], ...b), At = toLab([M - A[0], ...u.map(c => -pc * c)], ...b), na = pmag(Ao) || 1, nt = pmag(At) || 1;
  setMotion(tg, Math.max(0, At[0] - mt) * MEV, At[1] / nt, At[2] / nt, 0, 0, At.length > 3 ? At[3] / nt : 0);
  if (keOf(tg) > 10 + Pt[0] * MEV - mt * MEV) tg.nucProd = true;
  o.ux = Ao[1] / na; o.uy = Ao[2] / na; if (Ao.length > 3) o.uz = Ao[3] / na;
  const K0 = o.KE;
  o.KE = Math.max(0, Ao[0] - o.m) * MEV;
  if (T) { if (tg.bonds.length && tg.rad) for (const bd of tg.bonds.slice()) removeBond(bd); o.KE = Math.max(1, K0 - (regionE(T) - Ebefore)); } // (flat: what the nucleus and its surroundings gained, potential energy included, from the hadron)
  exoSpeed(o);
  o.hitId = tg.id;
}
/* A γ ray above about 8 MeV absorbed by a nucleus as a whole (the giant dipole resonance: the protons swing against the
   neutrons), which then boils off a neutron (or two, or a proton) as any hot nucleus does. Cross-section a Lorentzian
   at E₀ = 31.2 A^-1/3 + 20.6 A^-1/6 MeV, 5 MeV wide, holding the classical dipole sum 60 NZ/A mb·MeV. Its electrons
   stay with what is left of it (keepElectrons). */
function gdrSigma(Z, N, E) { // mb, E in MeV
  const A = Z + N; if (A < 2) return 0;
  const E0 = 31.2 * Math.pow(A, -1 / 3) + 20.6 * Math.pow(A, -1 / 6), G = 5, s0 = 60 * Z * N / A * 2 / (Math.PI * G);
  const r = (E * E - E0 * E0) / (E * G); return s0 / (1 + r * r);
}
function photoNuclear(p, E, ux, uy, uz = 0) { // (uz: 3-D, 1.25)
  if (p.dead || p.k !== NUC || p.anti || p.mu || W.parts.length > MAX_PARTS - 50) return false;
  const Eg = E / MEV, P = add4(p4of(p, true), W.d3 ? [Eg, Eg * ux, Eg * uy, Eg * uz] : [Eg, Eg * ux, Eg * uy]), Ms = mass4(P), items = [], moms = [];
  compoundDecay(p.Z, p.N, Ms, P, false, items, moms, 0);
  if (!items.some(it => it.t === 'A' && it.Z + it.N === 1)) return false; // (below its threshold: no nucleon free)
  const x = p.x, y = p.y, z = p.z, el = hitLabel(p), gh = [ghostOf(p)];
  keepElectrons(items, moms, p.ne);
  const S = nucBegin([p]); kill(p);
  const made = spawnItems(items, moms, x, y, z);
  closeEvent(S, made, x, y, E, 0);
  const txt = `Photonuclear: γ (${fmtE(E)}) + ${el} → ${summarize(items.filter(it => it.t !== 'e'))}`;
  W.count.nreact = (W.count.nreact || 0) + 1;
  nucEvent('reaction', x, y, txt, gh, 'giant dipole resonance: the γ shakes protons against neutrons; the hot nucleus boils off a nucleon', undefined, z);
  log('nuc', txt);
  return true;
}
/* A stopped negative hadron, caught by an atom like a muon and absorbed by its nucleus: a π⁻ on a nucleon pair (on
   hydrogen π⁻p → π⁰n or γn, the Panofsky ratio 1.5; on a deuteron π⁻d → nn); Σ⁻p → Λn, Ξ⁻p → ΛΛ, Ω⁻p → Ξ⁰Λ, the Λ
   perhaps staying (hypCatch). Returns true if it was caught. */
function hStop(o, tgIn) { // (tgIn: the atom whose orbit it fell through, the realistic-particle switch, 1.27)
  const tg = tgIn || stopTarget(o, (p) => p.dead || p.k !== NUC || p.Z < 1 || p.anti || p.muB || p.mu);
  if (!tg) return false;
  const el = hitLabel(tg), x = tg.x, y = tg.y, items = [], moms = [], Po = exoP4(o);
  let txt = '', sub = '';
  for (let tries = 0; tries < 4 && !txt; tries++) {
    items.length = 0; moms.length = 0;
    if (o.sp === 'pi-') {
      if (tg.Z === 1 && tg.N === 0) { const g = rnd() < 0.4; const sN = { Zr: 0, Nr: 0 }; if (!exoOut([item('n'), item(g ? 'g' : 'pi0')], add4(Po, p4of(tg, true)), sN, 0, items, moms)) continue; sub = g ? 'π⁻p → nγ' : 'π⁻p → π⁰n (charge exchange)'; }
      else if (tg.Z === 1 && tg.N === 1) { if (!exoOut([item('n'), item('n')], add4(Po, p4of(tg, true)), { Zr: 0, Nr: 0 }, 0, items, moms)) continue; sub = 'π⁻d → nn'; }
      else {
        const s1 = struckNucleon(tg, true), s2 = struckNucleon({ Z: s1.Zr, N: s1.Nr, k: NUC, vx: tg.vx, vy: tg.vy, vz: tg.vz, rad: tg.rad, KE: tg.KE, ux: tg.ux, uy: tg.uy, uz: tg.uz, ne: 0, m: tg.m }), q = 1 + (s2.onP ? 1 : 0) - 1;
        const outs = q === 1 ? ['p', 'n'] : ['n', 'n'];
        if (!exoOut(outs.map(item), add4(Po, p4of(tg, true)), s2, 15 + 25 * rnd(), items, moms)) continue;
        sub = `absorbed on a nucleon pair → ${outs.join('')}: 140 MeV breaks the nucleus up`;
      }
    } else {
      const sN = struckNucleon(tg, true), Pin = add4(add4(Po, sN.PN), sN.Pres);
      const outs = o.sp === 'Sig-' ? ['Lam', 'n'] : o.sp === 'Xi-' ? ['Lam', 'Lam'] : ['Xi0', 'Lam'];
      if (!exoOut(outs.map(item), Pin, sN, 2 + 8 * rnd(), items, moms)) continue;
      sub = `${o.lab}p → ${summarize(outs.map(item))}`;
      const iL = items.findIndex(it => it.t === 'x' && it.sp === 'Lam'), ri = items.findIndex(it => it.t === 'A' && it.Z === sN.Zr && it.N === sN.Nr && sN.Zr + sN.Nr >= 2);
      if (iL >= 0 && ri >= 0) { const its = [], ms = []; if (hypCatch(sN.Zr, sN.Nr, massOf(items[ri]), moms[ri], moms[iL], 0, 0, its, ms)) { items.splice(ri, 1); moms.splice(ri, 1); items.splice(iL, 1, ...its); moms.splice(iL, 1, ...ms); sub += ': the Λ stayed, a hypernucleus'; } }
    }
    txt = `${o.lab} caught by ${el}`;
  }
  if (!txt) return false;
  keepElectrons(items, moms, tg.ne);
  exoEvent(o, [tg], items, moms, x, y, 'capture', txt, sub, tg.z);
  return true;
}
const H_STOP = new Set(['pi-', 'Sig-', 'Xi-', 'Omg-']);
/* A μ⁺ slowed to a few keV picks up an electron from an atom it passes about 60% of the time, as in gases and insulators
   (not in a metal, whose free electrons screen it): muonium, a hydrogen atom with a muon for its proton, 13.5 eV bound
   (the binding leaves as light). The atom is left an ion. Tried once per muon. Returns true if it formed. */
function muoniumForm(o) {
  const tg = stopTarget(o, (p) => p.dead || p.k !== NUC || p.Z < 1 || p.anti || p.ne < 1 || p.isMetal);
  if (!tg) return false;
  o.muTried = true;
  if (rnd() > 0.6) return false;
  const ie = ionizationCost(tg), give = ie + 0.05;
  if (!(o.KE > give + 1)) return false;
  o.KE -= give; exoSpeed(o);
  const el = speciesLabel(tg), e = ejectElectron(tg, 0.05);
  if (!e) { o.KE += give; exoSpeed(o); return false; }
  muClear(o); // (bug fix 13 after 1.25: where the muonium atom will be, clear of the atoms: put where the muon stopped, beside the atom it robbed, its potential energy there (tens of eV) was more than the event could pay)
  const Pt = add4(exoP4(o), p4of(e)), M = mass4(Pt), vs = phaseSpace(M, [XP.Mu.m, 0]);
  if (!vs) return false;
  const bx = Pt[1] / Pt[0], by = Pt[2] / Pt[0], bz = (Pt[3] || 0) / Pt[0];
  const made = exoEvent(o, [e], [item('Mu'), item('g')], vs.map(v => toLab(v, bx, by, bz)), o.x, o.y, 'capture', `Muonium: μ⁺ took an electron from ${el}`, 'μ⁺e⁻, a hydrogen atom 1/9 the mass, 13.5 eV bound', o.z);
  if (o.spin && made.ps[0]) made.ps[0].spin = o.spin.slice(); // (the muon keeps its spin, 1.27)
  return true;
}

/* The nearest spot to the muon at which a hydrogen-sized atom sits clear of every atom (85% of their contact distance,
   as separate() keeps fragments): the muon (an exo, with no potential energy in the books) is moved there before the
   muonium atom is made in its place. */
function muClear(o) {
  const rH = 0.6, need = (p) => (p.k !== NUC ? 0 : p.ne > 0 ? 0.85 * (rH + 0.5 * p.ljR) : 0.6);
  const ok = (x, y, z) => { let fine = true; nearby(x, y, 4, (p, dx, dy, r2) => { if (p.dead || p.k !== NUC || p.Z === 0) return; const n = need(p); if (r2 < n * n) { fine = false; return false; } }, z); return fine; };
  const z0 = o.z || 0;
  if (ok(o.x, o.y, z0)) return;
  const hw = W.box.w / 2 - 0.5, hh = W.box.h / 2 - 0.5, hd = W.d3 ? W.box.d / 2 - 0.5 : 0;
  for (let k = 1; k < 1500; k++) {
    const r = 0.1 * Math.cbrt(k) * (W.d3 ? 3 : 2), th = k * 2.39996, c = W.d3 ? 1 - 2 * ((k * 0.618034) % 1) : 0, sn = Math.sqrt(1 - c * c);
    const x = o.x + r * sn * Math.cos(th), y = o.y + r * sn * Math.sin(th), z = z0 + r * c;
    if (Math.abs(x) > hw || Math.abs(y) > hh || (W.d3 && Math.abs(z) > hd)) continue;
    if (ok(x, y, z)) { o.x = x; o.y = y; if (W.d3) o.z = z; return; }
  }
}
/* Muonium as an atom (1.12). Muonium is a hydrogen atom whose nucleus is a μ⁺: Bohr's radius and 13.5 eV binding, as H
   (the reduced mass differs by 0.4%), but 0.1134 u, a ninth of H's mass. It was an exo flying on a straight line, so it
   passed through atoms; now it is an H atom in MD with p.mu set: its mass is the muon's (refresh), it is named Mu, and it
   collides, bonds and reacts by the ordinary chemistry (Mu + Cl₂ → MuCl + Cl), lighter and so faster at a given
   temperature. Its nuclear side is the muon's: no fusion, strong interactions or muon capture on it (guards on p.mu).
   The muon decays (2.197 µs, on the nuclear clock): muoniumTick. */
function addMuonium(x, y, KE, ux, uy, ne = 1, z = 0, uz = 0) { // (z, uz: 3-D, 1.25)
  const p = addNuc(1, 0, ne, x, y, 0, 0, false, z); p.mu = true; refresh(p);
  setMotion(p, KE, ux, uy, 0, 0, uz);
  (W.muAtoms || (W.muAtoms = [])).push(p);
  if (RP.mu) { muSpinInit(p, KE >= 1 ? [ux, uy, uz] : null); p.eSpin = rnd() < 0.5 ? 1 : -1; } // (its muon's spin and its electron's, along the field or against it, 1.27)
  return p;
}
/* The muon of a muonium atom (or of μ⁺ bare, or bonded in MuCl …) decays: μ⁺ → e⁺ νₑ ν̄μ; the electrons it held go
   free, a molecule it was in is left a radical. The books close as for any nuclear event: what the products and the
   changed molecule do not carry, the neutrinos take. */
function muoniumTick(dt) {
  const clock = W.decayOn ? dt * PHYS.TU_S * W.warp : 0, L = W.muAtoms;
  for (let i = L.length - 1; i >= 0; i--) {
    const p = L[i];
    if (!p || p.dead || !p.mu) { L.splice(i, 1); continue; }
    if (p.spin && RP.mu) muSpinTurn(p, clock); // (μSR: its muon's spin precesses, 1.27)
    if (!(clock > 0) || rnd() >= 1 - Math.exp(-clock / XP['mu+'].tau)) continue;
    L.splice(i, 1);
    const x = p.x, y = p.y, z = p.z, lbl = speciesLabel(p), ne = p.ne, [vx, vy] = velOf(p), partners = p.bonds.map(bd => other(bd, p));
    const S = nucBegin([p]), gh = [ghostOf(p)];
    kill(p); relink(partners.filter(q => !q.dead));
    const items = ['e+', 'nu', 'numub'].map(item), bx = vx / PHYS.C, by = vy / PHYS.C, bz = W.d3 ? p.vz / PHYS.C : 0; // (bz: 3-D, 1.25)
    const vs = p.spin && RP.mu ? muSpinDecay(p.spin) : phaseSpace(MU_M, items.map(massOf)), moms = vs.map(v => toLab(v, bx, by, bz)); // (μSR: the positron along the muon's spin, the Michel spectrum, 1.27)
    for (let k = 0; k < ne; k++) { items.push(item('e-')); moms.push(randDir4(PHYS.MEC2, (1 + rnd()) / MEV)); }
    const made = spawnItems(items, moms, x, y, z);
    closeEvent(S, made, x, y, 0, 0);
    W.count.decay++;
    const txt = `μ⁺ → ${summarize(items.slice(0, 3))}${ne ? ', its electron set free' : ''}`;
    nucEvent('decay', x, y, `${lbl}: ${txt}`, gh, '2.2 µs mean life');
    log('nuc', `Decay: the muon in ${lbl} → e⁺ + νₑ + ν̄μ${ne ? '; its electron goes free' : ''}`);
    tally(items, [lbl], `Decay: ${lbl} → ${summarize(items)}`);
  }
}

/* ---- resonances in hadronization. Most hadrons out of a string or a cooling plasma are born as short-lived
   resonances (ρ, ω, φ, K*, Δ) that decay at once into the pions, kaons and nucleons seen. resonate() takes the list
   hadronize or the plasma made and joins some of its members into the resonance they would have come from — a π⁺
   and a π⁻ into a ρ⁰, three pions into an ω, a K and a π into a K*, K⁺K⁻ into a φ, a nucleon and a π into a Δ —
   each with a mass drawn from its Breit–Wigner shape (truncated: above what it decays to, below m + 3Γ). The
   charges stay, the count of each kind stays on average, and the momenta are made for the new list (fewer, heavier
   items); the resonances then decay where they are (moveExos), and their products are what the old list had. About
   half of the pions of a jet come from resonances, as in e⁺e⁻ data (vector-to-pseudoscalar ratio about 0.5). */
const RES_P = { rho: 0.42, omega: 0.12, ks: 0.4, phi: 0.12, delta: 0.3 };
function bwMass(sp) {
  const d = XP[sp], lo = Math.max(d.m - 3 * d.w, Math.min(...d.dec.map(([, ps]) => ps.reduce((t, x) => t + massOf(item(x)), 0))) + 2), hi = d.m + 3 * d.w;
  for (let k = 0; k < 40; k++) { const m = d.m + d.w / 2 * Math.tan(Math.PI * (rnd() - 0.5)); if (m > lo && m < hi) return m; }
  return clamp(d.m, lo, hi);
}
function resonate(items, M) {
  const tag = (it) => (it.t === 'x' ? it.sp : it.t === 'A' && it.Z + it.N === 1 ? (it.anti ? (it.Z ? 'pbar' : 'nbar') : (it.Z ? 'p' : 'n')) : null);
  const idx = items.map((it, i) => i).sort(() => rnd() - 0.5), used = new Set(), out = [];
  let mass = items.reduce((t, it) => t + massOf(it), 0);
  const take = (want, not) => { for (const j of idx) if (!used.has(j) && j !== not && want.includes(tag(items[j]))) return j; return -1; };
  const join = (sp, js, anti) => { // (the resonance replaces its products if the energy allows it)
    const s2 = anti ? XP[sp].cc : sp, m = bwMass(s2), dm = m - js.reduce((t, j) => t + massOf(items[j]), 0);
    if (mass + dm > 0.85 * M) return false;
    for (const j of js) used.add(j); mass += dm; out.push({ t: 'x', sp: s2, m }); return true;
  };
  for (const i of idx) {
    if (used.has(i)) continue;
    const t = tag(items[i]); if (!t) continue;
    used.add(i); let ok = false;
    if (t === 'pi+' || t === 'pi-' || t === 'pi0') {
      const u = rnd();
      if (u < RES_P.omega) { const oth = ['pi+', 'pi-', 'pi0'].filter(x => x !== t), x1 = take([oth[0]], i); if (x1 >= 0) { used.add(x1); const x2 = take([oth[1]], i); used.delete(x1); if (x2 >= 0) ok = join('omega', [i, x1, x2]); } }
      else if (u < RES_P.omega + RES_P.rho) {
        const want = t === 'pi0' ? ['pi+', 'pi-'] : ['pi0', t === 'pi+' ? 'pi-' : 'pi+'], j = take(want, i);
        if (j >= 0) { const o2 = tag(items[j]), q = (t === 'pi+') + (o2 === 'pi+') - (t === 'pi-') - (o2 === 'pi-'); ok = join(q > 0 ? 'rho+' : q < 0 ? 'rho-' : 'rho0', [i, j]); }
      }
    } else if (t === 'K+' || t === 'K-') {
      const u = rnd();
      if (u < RES_P.phi && t === 'K+') { const j = take(['K-'], i); if (j >= 0) ok = join('phi', [i, j]); }
      else if (u < RES_P.phi + RES_P.ks) { const j = take(['pi0', t === 'K+' ? 'pi-' : 'pi+'], i); if (j >= 0) ok = tag(items[j]) === 'pi0' ? join(t === 'K+' ? 'Ks+' : 'Ks-', [i, j]) : join(t === 'K+' ? 'Ks0' : 'Ksb0', [i, j]); }
    } else if (t === 'K0S' || t === 'K0L') {
      if (rnd() < RES_P.ks) { const j = take(['pi+', 'pi-', 'pi0'], i); if (j >= 0) { const o2 = tag(items[j]); ok = o2 === 'pi+' ? join('Ks+', [i, j]) : o2 === 'pi-' ? join('Ks-', [i, j]) : join(rnd() < 0.5 ? 'Ks0' : 'Ksb0', [i, j]); } }
    } else if (t === 'p' || t === 'n' || t === 'pbar' || t === 'nbar') {
      if (rnd() < RES_P.delta) {
        const anti = t === 'pbar' || t === 'nbar', base = anti ? (t === 'pbar' ? 'p' : 'n') : t, sgn = (x) => (anti ? ({ 'pi+': 'pi-', 'pi-': 'pi+', pi0: 'pi0' })[x] : x);
        const j = take(['pi0', 'pi+', 'pi-'].map(sgn), i);
        if (j >= 0) { const pq = ({ 'pi+': 1, 'pi-': -1, pi0: 0 })[sgn(tag(items[j]))], q = (base === 'p' ? 1 : 0) + pq; ok = join(q === 2 ? 'Dpp' : q === 1 ? 'Dp' : q === 0 ? 'D0' : 'Dm', [i, j], anti); }
      }
    }
    if (!ok) used.delete(i);
  }
  const rest = items.filter((it, i) => !used.has(i));
  return out.length ? rest.concat(out) : items;
}
/* Pair masses (Data tab): every π⁺π⁻, K⁺K⁻ and K±π∓ pair from one collision (decay products count with the
   collision that made their parent), their invariant mass from their energies and momenta at birth — where the
   resonances show as bumps over the background of pairs that are not from one (ρ at 775 MeV, K* at 892, φ at 1019),
   as they were first found. */
let _evTag = 0;
const PAIRS = { ev: new Map(), h: { pipi: new Float64Array(200), KK: new Float64Array(200), Kpi: new Float64Array(200) }, ls: { pipi: new Float64Array(200), KK: new Float64Array(200), Kpi: new Float64Array(200) }, n: 0, BIN: 10 }; // (ls: like-sign pairs, π⁺π⁺ and π⁻π⁻: no resonance makes them, so they trace the background, which subtracting them takes away)
function pairNote(o) {
  if (!o.ev || !(o.sp === 'pi+' || o.sp === 'pi-' || o.sp === 'K+' || o.sp === 'K-')) return;
  const K = o.KE / MEV, p = Math.sqrt(K * (K + 2 * o.m)), v = [o.m + K, p * o.ux, p * o.uy, o.sp];
  let L = PAIRS.ev.get(o.ev); if (!L) { L = []; PAIRS.ev.set(o.ev, L); if (PAIRS.ev.size > 400) PAIRS.ev.delete(PAIRS.ev.keys().next().value); }
  const q = (s) => (s.endsWith('+') ? 1 : -1), kind = (s) => s[0];
  for (const w of L) {
    const like = q(w[3]) === q(v[3]);
    const key = kind(w[3]) === 'p' && kind(v[3]) === 'p' ? 'pipi' : kind(w[3]) === 'K' && kind(v[3]) === 'K' ? 'KK' : 'Kpi';
    const E = w[0] + v[0], px = w[1] + v[1], py = w[2] + v[2], m = Math.sqrt(Math.max(0, E * E - px * px - py * py)), b = Math.floor(m / PAIRS.BIN);
    if (b < 200) { if (like) PAIRS.ls[key][b]++; else { PAIRS.h[key][b]++; PAIRS.n++; } }
  }
  L.push(v);
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
  if (W.d3) return jetMomenta3(items, M, opts.ax3 || [ax, ay, 0], opts); // (3-D, 1.25)
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
    else pt[i] = 350 * (opts.ptScale || 1) * gauss() / Math.SQRT2 * 1.2; // (ptScale: resonances among them, whose decays add their own)
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
/* (3-D, 1.25) The same along the axis a (a unit 3-vector): each hadron's transverse momentum has a direction round the
   axis too (a string's: two Gaussian components of the flat game's width; a plasma's: the flat thermal size at a random
   azimuth). Returns [E, px, py, pz] for each item, or null. */
function jetMomenta3(items, M, a, opts) {
  const n = items.length, ms = items.map(massOf);
  let msum = 0; for (const m of ms) msum += m;
  if (!(msum < M - 1)) return null;
  if (n < 3) return phaseSpace(M, ms);
  const L = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1, ux = a[0] / L, uy = a[1] / L, uz = a[2] / L;
  let hx = 1, hy = 0, hz = 0; if (Math.abs(ux) > 0.9) { hx = 0; hy = 1; } // (a helper axis not along a)
  let e1x = uy * hz - uz * hy, e1y = uz * hx - ux * hz, e1z = ux * hy - uy * hx; const l1 = Math.sqrt(e1x * e1x + e1y * e1y + e1z * e1z); e1x /= l1; e1y /= l1; e1z /= l1;
  const e2x = uy * e1z - uz * e1y, e2y = uz * e1x - ux * e1z, e2z = ux * e1y - uy * e1x;
  const r = new Array(n), t1 = new Array(n), t2 = new Array(n);
  const order = []; for (let i = 0; i < n; i++) order.push(i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  if (opts.lead) { const Ld = order.filter(i => opts.lead(items[i])), rest = order.filter(i => !opts.lead(items[i])); order.length = 0; const left = [], right = []; Ld.forEach((i, k) => (k % 2 ? right : left).push(i)); order.push(...left, ...rest, ...right.reverse()); }
  order.forEach((i, rank) => { r[i] = opts.thermal ? gauss() : 2 * (rank + 0.5) / n - 1 + 0.35 * gauss() / n; });
  for (let i = 0; i < n; i++) {
    if (opts.thermal) { const Te = 160 + 140 * ms[i] / 1000; const mt = ms[i] - Te * Math.log(Math.max(1e-12, rnd() * rnd())) / 1.5, pt = Math.sqrt(Math.max(0, mt * mt - ms[i] * ms[i])), ph = rnd() * 2 * Math.PI; t1[i] = pt * Math.cos(ph); t2[i] = pt * Math.sin(ph); }
    else { const w = 350 * (opts.ptScale || 1) / Math.SQRT2 * 1.2; t1[i] = w * gauss(); t2[i] = w * gauss(); }
  }
  let mts = ms.map((m, i) => Math.sqrt(m * m + t1[i] * t1[i] + t2[i] * t2[i])), base = mts.reduce((s, b) => s + b, 0);
  if (base >= M) { const k = Math.sqrt(Math.max(0, (M - msum) / (base - msum))) * 0.9; for (let i = 0; i < n; i++) { t1[i] *= k; t2[i] *= k; } mts = ms.map((m, i) => Math.sqrt(m * m + t1[i] * t1[i] + t2[i] * t2[i])); }
  const Esum = (Y) => { let s = 0; for (let i = 0; i < n; i++) s += mts[i] * Math.cosh(Y * r[i]); return s; };
  let lo = 0, hi = 1; while (Esum(hi) < M && hi < 60) hi *= 2;
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (Esum(mid) < M) lo = mid; else hi = mid; }
  const Y = (lo + hi) / 2;
  const p = r.map((ri, i) => { const pl = mts[i] * Math.sinh(Y * ri); return [pl * ux + t1[i] * e1x + t2[i] * e2x, pl * uy + t1[i] * e1y + t2[i] * e2y, pl * uz + t1[i] * e1z + t2[i] * e2z]; });
  let sx = 0, sy = 0, sz = 0; for (const v of p) { sx += v[0]; sy += v[1]; sz += v[2]; }
  for (const v of p) { v[0] -= sx / n; v[1] -= sy / n; v[2] -= sz / n; }
  const Ef = (xi) => { let s = 0; for (let i = 0; i < n; i++) s += Math.sqrt(ms[i] * ms[i] + xi * xi * (p[i][0] * p[i][0] + p[i][1] * p[i][1] + p[i][2] * p[i][2])); return s; };
  lo = 0; hi = 2; while (Ef(hi) < M && hi < 1e6) hi *= 2;
  for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (Ef(mid) < M) lo = mid; else hi = mid; }
  const xi = (lo + hi) / 2;
  return p.map((v, i) => { const px = v[0] * xi, py = v[1] * xi, pz = v[2] * xi; return [Math.sqrt(ms[i] * ms[i] + px * px + py * py + pz * pz), px, py, pz]; });
}
const isBaryonItem = (it) => it.t === 'A' || !!(it.t === 'x' && XP[it.sp].B);
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
function addQGP(x, y, n, sNN) { (W.qgp || (W.qgp = [])).push({ x, y, z: W.d3 ? _evZ3 : 0, n, sNN, t0: W.rt }); if (W.qgp.length > 6) W.qgp.shift(); } // (z: 3-D, 1.25)


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
/* (1.26) Rates of a muon bound in a heavier atom (s⁻¹): [nuclear capture, decay in orbit]. The capture rate was
   32·Z_eff⁴ with no dependence on the neutrons, which lets lead capture 3.3 times too fast (mean life 23 ns against a
   measured 75.4) and aluminium 25% too slowly. Now the mean lives measured for the natural elements (Suzuki, Measday &
   Roalsvig, Phys. Rev. C 35, 2212, 1987: MU_TAU, ns) hold where measured, and the Goulard–Primakoff form (Z_eff⁴ with the
   neutron excess, the fit of that paper: 261 s⁻¹, −0.040, −0.26, 3.24) carries them to the other elements and isotopes,
   scaled to the measured ones beside them. The decay in orbit is the free muon's slowed by the Huff factor (about
   1 − 2.2×10⁻⁵ Z²: 0.85 in lead). */
const MU_TAU = { 6: 2026.3, 7: 1906.8, 8: 1795.4, 9: 1463.5, 11: 1204.0, 12: 1067.2, 13: 864.0, 14: 756.0, 15: 611.2, 16: 554.6, 19: 435.2, 20: 332.7, 22: 329.3, 23: 284.5, 26: 206.0, 28: 156.6, 29: 163.5, 30: 159.4, 40: 110.4, 82: 75.4 };
const muHuff = (Z) => 1 - 2.2e-5 * Z * Z;
function muGP(Z, A) { return Math.max(0, muZeff(Z) ** 4 * 261 * (1 - 0.040 * A / (2 * Z) + 0.26 * (A - 2 * Z) / (2 * Z) - 3.24 * ((A - Z) / (2 * A) + (A - 2 * Z) / (8 * A * Z)))); }
const _muRatio = Object.keys(MU_TAU).map(Number).map(Z => [Z, (1e9 / MU_TAU[Z] - muHuff(Z) / XP['mu-'].tau) / muGP(Z, Math.round(ELEMENTS[Z].mass))]); // (measured over the form, at each measured element)
function muRates(Z, N) {
  const R = _muRatio; let r = R[R.length - 1][1];
  if (Z <= R[0][0]) r = R[0][1]; else for (let i = 1; i < R.length; i++) if (Z <= R[i][0]) { const [z0, r0] = R[i - 1], [z1, r1] = R[i]; r = r0 + (r1 - r0) * (Z - z0) / (z1 - z0); break; }
  return [r * muGP(Z, Z + N), muHuff(Z) / XP['mu-'].tau];
}
for (const [k, N, lab] of [['muP', 0, 'μp'], ['muD', 1, 'μd'], ['muT', 2, 'μt']]) { // muonic hydrogen: neutral, decaying as its muon does
  const tok = ['p', 'd', 't'][N], mN = nucMeV(1, N), Eb = 13.6057e-6 * (MU_M * mN / (MU_M + mN)) / 0.51099895; // (Bohr's 13.6 eV with the muon's reduced mass: 2.53 keV for μp)
  XP[k] = { lab, m: nucMeV(1, N) + MU_M - Eb, Eb, q: 0, tau: 2.1970e-6, col: [150, 255, 230], cc: k, atom: true, N, dec: [[1, [tok, 'e-', 'nub', 'numu']]] };
}
XP.muHe = { lab: '(μα)⁺', m: nucMeV(2, 2) + MU_M - MU_EB(2), q: 1, tau: 2.1970e-6, col: [255, 225, 150], cc: 'muHe', stuck: true, dec: [[1, ['a', 'e-', 'nub', 'numu']]] };
/* Ionization along a charged exo's step (x0, y0) → its position now; it loses the energy given away. */
function exoIonize(o, x0, y0) {
  const beta2 = Math.max(1e-8, (o.v / PHYS.C) ** 2), z2 = o.q * o.q;
  const hits = segTargets(x0, y0, o.x, o.y, 1.0, (t) => t.k === NUC && t.Z > 0 && t.ne > 0);
  let lost = 0;
  const cpm = RP.cpm, sl = cpm ? Math.hypot(o.x - x0, o.y - y0) : 0; // (charged particles in matter, 1.27)
  if (cpm) cpmSeg(o, o.KE, o.m * MEV, Math.abs(o.q), 0, o.ux, o.uy, 0, sl, (x0 + o.x) / 2, (y0 + o.y) / 2, 0, 1.0, false);
  for (const [t, tg, b] of hits) {
    if (tg.dead || tg.ne <= 0) continue;
    if (cpm) { CPM.K = o.KE; lost += cpmAtom(tg, b, 0.0047 * z2 * tg.ne / beta2 / (1 + (b / 0.4) * (b / 0.4)), x0 + (o.x - x0) * t, y0 + (o.y - y0) * t, 0); o.KE = CPM.K; if (W.nucWin) for (const m of molecule(tg)) m.nucProd = true; if (o.KE <= 1) break; continue; }
    const w = 1 / (1 + (b / 0.4) * (b / 0.4));
    const dE = Math.min(0.3 * o.KE, 0.0047 * z2 * tg.ne / beta2 * w);
    if (dE < 0.01) continue;
    o.KE -= dE; lost += dE;
    if (W.nucWin) for (const m of molecule(tg)) m.nucProd = true; // (knocked loose by a nuclear event's products: slow motion for nuclear events, when off, does not follow the pieces)
    const ie = ionizationCost(tg), nx = -o.uy * (rnd() < 0.5 ? 1 : -1), ny = o.ux * (nx === -o.uy ? 1 : -1);
    if (dE > ie && freeElectronCount() < MAX_FREE_E && W.parts.length < MAX_PARTS) { if (ejectElectron(tg, dE - ie, nx, ny)) W.count.ionize++; else dumpHeat(dE, tg, tg); }
    else { const vn = tg.vx * nx + tg.vy * ny, a = -vn + Math.sqrt(vn * vn + 2 * dE * tg.im); tg.vx += nx * a; tg.vy += ny * a; updateFast(tg); } // (exactly dE, as fastStop3: 0.7·√(2dE/m) gave about half, 1.26)
    if (o.KE <= 1) break;
  }
  if (cpm && o.KE > 1) { CPM.K = o.KE; lost += cpmCkv(x0, y0, 0, sl); o.KE = CPM.K; } // (Cherenkov light, 1.27)
  if (lost > 0) { o.KE = Math.max(0.5, o.KE); exoSpeed(o); }
}
/* Multiple Coulomb scattering (1.15, from the Physics tab's honest approximations: unstable particles flew straight
   between their hits on nuclei). Each nucleus a charged exo passes within 1 Å turns it by the small-angle Rutherford
   angle θ = 2k·z·Z / (b·pv), with the atom's electrons screening the charge (Thomas–Fermi: × e^(−b/a), a = 0.885 a₀ Z^−⅓;
   a bare nucleus unscreened), toward it for opposite charges and away for like ones; at most 0.3 rad from one pass (a
   closer one is a hit, exoHits). The nucleus takes the sideways momentum and its recoil energy comes out of the exo's:
   the books stay exact. Summed over a foil this gives the Highland width of multiple scattering. */
function exoScatter(o, x0, y0) {
  const hits = segTargets(x0, y0, o.x, o.y, 1.0, (t) => t.k === NUC && t.Z > 0 && !t.dead);
  if (!hits.length) return;
  const mc2 = o.m * MEV, E = o.KE + mc2, pc = Math.sqrt(Math.max(0, o.KE * (o.KE + 2 * mc2))), pv = pc * pc / E; // (eV)
  if (!(pv > 0)) return;
  const list = hits.slice();
  for (const [, tg, b0] of list) {
    if (tg.dead) continue;
    const b = Math.max(b0, 0.01), Zs = tg.Z, a = tg.ne > 0 ? 0.885 * 0.529177 / Math.cbrt(Zs) : Infinity;
    let th = 2 * PHYS.KE * Math.abs(o.q) * Zs / (b * pv) * (a === Infinity ? 1 : Math.exp(-b / a));
    if (!(th > 1e-7)) continue;
    th = Math.min(th, 0.3);
    // the side the nucleus is on (relative to the path), and the sense: like charges push away
    const sx = tg.x - x0, sy = tg.y - y0, side = Math.sign(sx * -o.uy + sy * o.ux) || 1, q = (tg.anti ? -1 : 1) * Math.sign(o.q);
    const turn = (q < 0 ? 1 : -1) * side * th; // (the nucleus's field, screened or not: an opposite charge is pulled toward it, a like one pushed away)
    const c = Math.cos(turn), s_ = Math.sin(turn), ux = o.ux * c - o.uy * s_, uy = o.ux * s_ + o.uy * c;
    // momentum handed to the nucleus (u·Å/tu), its recoil energy taken from the exo
    const pU = pc / (PHYS.AMU_MEV * MEV) * PHYS.C, dpx = pU * (o.ux - ux), dpy = pU * (o.uy - uy);
    const vx = tg.vx + dpx / tg.m, vy = tg.vy + dpy / tg.m, dK = 0.5 * tg.m * (vx * vx + vy * vy - tg.vx * tg.vx - tg.vy * tg.vy);
    if (!(dK < o.KE - 1)) continue;
    tg.vx = vx; tg.vy = vy; if (typeof updateFast === 'function') updateFast(tg);
    o.ux = ux; o.uy = uy; o.KE -= dK;
  }
  exoSpeed(o);
}
/* An event between an exo and the atoms in W.parts it involves (tgs): the exo and they go, items come out with
   momenta moms (MeV, lab), the books close exactly (what is left over goes to the photons among them, or to the
   products' motion). The targets' electrons come out free (items 'e-' added by the caller). */
let _exoEvItems = null; // (what the last exoEvent made: a collider's tally, 1.15)
function exoEvent(o, tgs, items, moms, x, y, kind, text, sub, z = 0) { // (z: where in depth, 3-D, 1.25)
  _exoEvItems = items;
  const S = nucBegin(tgs), gh = tgs.map(ghostOf);
  for (const t of tgs) kill(t);
  o.dead = true; o.fate = o.fate || text;
  const made = spawnItems(items, moms, x, y, z);
  closeEvent(S, made, x, y, o.KE + o.m * MEV, o.m * MEV);
  if (kind) { nucEvent(kind, x, y, text, gh, sub, undefined, z); log('nuc', `${text}${sub ? ` (${sub})` : ''}`); }
  return made;
}
const randDir4 = (m, K) => { const u = rdir(), p = Math.sqrt(Math.max(0, K * (K + 2 * m))); return [m + K, ...u.map(c => p * c)]; }; // (3-D: on the sphere, 1.25)
/* A free μ⁻ slowed to a few keV: caught by the nearest atom within 4 Å. Returns true if it was. */
function muStop(o) {
  const tg = stopTarget(o, (p) => p.dead || p.k !== NUC || p.Z < 1 || p.anti || p.muB || p.mu);
  if (!tg) return false;
  const x = tg.x, y = tg.y, z = tg.z, el = speciesLabel(tg);
  if (tg.Z === 1 && tg.N <= 2) { // muonic hydrogen: the atom's electron goes free, X-rays carry off the binding
    const sp = ['muP', 'muD', 'muT'][tg.N], kT = PHYS.KB * Math.max(W.T, 20);
    const items = [item(sp), item('g'), item('g')], moms = [randDir4(XP[sp].m, 1.5 * kT / MEV), [1, ...rdir()], [1, ...rdir()]];
    for (let i = 0; i < tg.ne; i++) { items.push(item('e-')); moms.push(randDir4(PHYS.MEC2, 2 / MEV)); }
    const made = exoEvent(o, [tg], items, moms, x, y, 'capture', `Muonic atom: μ⁻ caught by ${el} → ${XP[sp].lab}`, `X-rays carry off ${fmtE(XP[sp].Eb * MEV)}: its orbit is 207 times closer than an electron’s`, z);
    const nx = made.xs[0]; if (nx) nx.cyc = o.cyc || 0;
    return true;
  }
  // a heavier atom keeps it bound
  const Eb = MU_EB(tg.Z) * MEV, S = nucBegin([tg]); // (tg: its mass now holds the muon's (atomMass), so its motion, the same speed, carries ½m_μv² more; the X-rays pay it, 1.26)
  o.dead = true; o.fate = `caught by ${el}: a muonic atom`;
  tg.muB = { m: MU_M * MEV - Eb, Eb }; tg.m = atomMass(tg); tg.im = 1 / tg.m;
  (W.muBound || (W.muBound = [])).push(tg);
  const made = { ps: [], xs: [], rays: [[item('g'), 1, ...rdir()], [item('g'), 1, ...rdir()]], lost: 0 };
  if (W.d3) made.z3 = z; // (3-D: the X-rays from its depth, 1.25)
  closeEvent(S, made, x, y, o.KE + Eb, Eb); // (the binding energy and the muon's motion leave as X-rays; the rest of its mass stays bound)
  nucEvent('capture', x, y, `Muonic atom: μ⁻ caught by ${el}`, [], `muonic X-rays, ${fmtE(Eb)} in all`, undefined, z);
  log('nuc', `Muonic atom: μ⁻ caught by ${el}; it falls to an orbit 207× closer, giving off ${fmtE(Eb)} of X-rays`);
  return true;
}
/* Muonic hydrogen meets hydrogen isotopes: the muon moves to the heavier one, or the pair fuses (dμt, dμd, tμt).
   clock: nuclear seconds this step. Returns true if o is gone. */
function muAtomTick(o, clock) {
  const N0 = XP[o.sp].N, best = stopTarget(o, (p) => p.dead || p.k !== NUC || p.Z !== 1 || p.anti || p.N > 2 || p.mu, 2.5);
  if (!best) return false;
  const N1 = best.N, P = (rate) => rnd() < 1 - Math.exp(-rate * clock);
  const x = best.x, y = best.y, z = best.z, bl = speciesLabel(best);
  const P4 = add4(W.d3 ? exoP4(o) : [o.m + o.KE / MEV, ...(() => { const p = Math.sqrt(Math.max(0, o.KE / MEV * (o.KE / MEV + 2 * o.m))); return [p * o.ux, p * o.uy]; })()], p4of(best)), bx = P4[1] / P4[0], by = P4[2] / P4[0], bz = (P4[3] || 0) / P4[0], M = mass4(P4);
  const els = (n) => { const it = [], mo = []; for (let i = 0; i < n; i++) { it.push(item('e-')); mo.push(toLab(randDir4(PHYS.MEC2, 3 / MEV), bx, by, bz)); } return [it, mo]; };
  // transfer to a heavier isotope: μp + d → μd + p, μp/μd + t → μt + …
  if (N1 > N0 && P(N0 === 0 ? MU_RATES.tr_pd : MU_RATES.tr_dt)) {
    const sp = ['muP', 'muD', 'muT'][N1], [ei, em] = els(best.ne);
    const items = [item(sp), item(['p', 'd', 't'][N0])].concat(ei), vs = twoBody(M - ei.length * PHYS.MEC2 - 1e-9, XP[sp].m, massOf(items[1]), ...rdir());
    if (!vs) return false;
    const moms = vs.map(v => toLab(v, bx, by, bz)).concat(em);
    const made = exoEvent(o, [best], items, moms, x, y, null, `the muon moved to ${bl}`, undefined, z);
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
  let Pf = W.d3 ? [0, 0, 0, 0] : [0, 0, 0]; for (const v of fixedM) Pf = add4(Pf, v);
  const em0 = ei.map(() => randDir4(PHYS.MEC2, 3 / MEV)); for (const v of em0) Pf = add4(Pf, v);
  const Prem = neg4(M - Pf[0], Pf), Mr = mass4(Prem), rx = Prem[1] / Prem[0], ry = Prem[2] / Prem[0], rz = (Prem[3] || 0) / Prem[0];
  const vs = phaseSpace(Mr, nucs.map(massOf));
  if (!vs) return false;
  const items = nucs.concat(fixed, ei), moms = vs.map(v => toLab(toLab(v, rx, ry, rz), bx, by, bz)).concat(fixedM.map(v => toLab(v, bx, by, bz)), em0.map(v => toLab(v, bx, by, bz)));
  const cyc = (o.cyc || 0) + 1, outTxt = summarize(nucs.concat(fixed));
  const made = exoEvent(o, [best], items, moms, x, y, 'fusion', `Muon-catalysed fusion: ${ch.lab} → ${outTxt}`, `${fmtE((M - nucs.concat(fixed, ei).reduce((t, it) => t + massOf(it), 0)) * MEV)} released; this muon’s fusion no. ${cyc}${stick ? ': it stuck to the helium nucleus, and the chain ends' : ''}`, z);
  W.count.fusion++;
  for (const x2 of made.xs) if (x2.sp === 'mu-') x2.cyc = cyc;
  return true;
}
/* Muonic hydrogen scattering elastically off hydrogen nuclei (1.12). Neutral and 200 times smaller than an atom, it
   passes through electron clouds, but a proton, deuteron or triton it comes close to throws it aside: in hydrogen
   that is how it slows to the gas's temperature. Measured: μp + p 1.49×10⁻²⁰ cm² (singlet μp), μd + d 8.0×10⁻²⁰ cm²
   (Bertin et al., Nuovo Cimento A 72, 225, 1982); μt: no measured value found, μd's is used. True reach √(σ/π): 0.0069 Å
   for μp, 0.016 Å for μd, used in the ultra-realistic mode; in normal play the reach is R_NN (0.35 Å), the reach of every
   neutral projectile meeting a nucleus here (neutrons, nucReach), 51 and 22 times the true one. Isotropic in the centre
   of mass (s-wave, as below about 1 eV), momentum and kinetic energy exactly kept (non-relativistic: eV energies). */
const MU_SCAT = { muP: 1.49e-20, muD: 8.0e-20, muT: 8.0e-20 }; // cm²
function muScatReach(sp) { return W.ultra ? Math.sqrt(MU_SCAT[sp] * 1e16 / Math.PI) : R_NN; }
function muAtomScatter(o, x0, y0, z0) {
  if (W.d3) return muAtomScatter3(o, x0, y0, z0);
  if (o.dead || (o.x === x0 && o.y === y0) || !MU_SCAT[o.sp]) return false;
  const R = muScatReach(o.sp), hits = segTargets(x0, y0, o.x, o.y, Math.max(R, 0.4), (t) => t.k === NUC && t.Z === 1 && !t.anti && !t.mu && !t.rad);
  for (const [, tg, b] of hits) {
    if (tg.dead || b >= R) continue;
    if (o.hitId === tg.id) continue; // (one pass, one encounter)
    o.hitId = tg.id;
    const mo = o.m / PHYS.AMU_MEV, mt = tg.m, M = mo + mt, v = Math.sqrt(2 * o.KE / mo);
    const avx = v * o.ux, avy = v * o.uy, Vx = (mo * avx + mt * tg.vx) / M, Vy = (mo * avy + mt * tg.vy) / M;
    const rx = avx - tg.vx, ry = avy - tg.vy, w = Math.hypot(rx, ry), [cx, cy] = rdir();
    const ox = Vx + cx * w * mt / M, oy = Vy + cy * w * mt / M; // (the relative speed kept, its direction new)
    setVel(tg, Vx - cx * w * mo / M, Vy - cy * w * mo / M); // (setVel: past its threshold into radiation flight at its true speed; a muonic hydrogen fired at 1 PeV threw a proton at 933c, 1.26)
    const vo = Math.hypot(ox, oy);
    o.KE = 0.5 * mo * vo * vo; if (vo > 0) { o.ux = ox / vo; o.uy = oy / vo; } exoSpeed(o);
    W.count.muScat = (W.count.muScat || 0) + 1;
    return true;
  }
  if (o.hitId && !hits.some(h => h[1].id === o.hitId)) o.hitId = 0;
  return false;
}
/* (3-D, 1.25) The same along a path in depth, isotropic on the sphere. */
function muAtomScatter3(o, x0, y0, z0) {
  if (o.dead || (o.x === x0 && o.y === y0 && o.z === z0) || !MU_SCAT[o.sp]) return false;
  const R = muScatReach(o.sp), hits = segTargets3(x0, y0, z0, o.x, o.y, o.z, Math.max(R, 0.4), (t) => t.k === NUC && t.Z === 1 && !t.anti && !t.mu && !t.rad);
  for (const [, tg, b] of hits) {
    if (tg.dead || b >= R) continue;
    if (o.hitId === tg.id) continue;
    o.hitId = tg.id;
    const mo = o.m / PHYS.AMU_MEV, mt = tg.m, M = mo + mt, v = Math.sqrt(2 * o.KE / mo);
    const avx = v * o.ux, avy = v * o.uy, avz = v * o.uz, Vx = (mo * avx + mt * tg.vx) / M, Vy = (mo * avy + mt * tg.vy) / M, Vz = (mo * avz + mt * tg.vz) / M;
    const rx = avx - tg.vx, ry = avy - tg.vy, rz = avz - tg.vz, w = Math.sqrt(rx * rx + ry * ry + rz * rz), c = rdir();
    const ox = Vx + c[0] * w * mt / M, oy = Vy + c[1] * w * mt / M, oz = Vz + c[2] * w * mt / M;
    tg.vx = Vx - c[0] * w * mo / M; tg.vy = Vy - c[1] * w * mo / M; tg.vz = Vz - c[2] * w * mo / M; updateFast(tg);
    const vo = Math.sqrt(ox * ox + oy * oy + oz * oz);
    o.KE = 0.5 * mo * vo * vo; if (vo > 0) { o.ux = ox / vo; o.uy = oy / vo; o.uz = oz / vo; } exoSpeed(o);
    W.count.muScat = (W.count.muScat || 0) + 1;
    return true;
  }
  if (o.hitId && !hits.some(h => h[1].id === o.hitId)) o.hitId = 0;
  return false;
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
    const [lc, ld] = muRates(p.Z, p.N); // (measured mean lives, 1.26)
    if (rnd() >= 1 - Math.exp(-(lc + ld) * clock)) continue;
    W.muBound.splice(i, 1); // (p.muB cleared below, once its event has begun with the muon in the atom's mass, 1.26)
    const x = p.x, y = p.y, z = p.z, el = speciesLabel(p), mm = B.m / MEV;
    const Z = p.Z, N = p.N, Ms = nucMeV(Z - 1, N + 1) + 8 + 12 * rnd(), Min = nucMeV(Z, N) + mm;
    const canCapture = !nuclideInfo(Z - 1, N + 1).unbound && Ms < Min;
    if (!canCapture || rnd() < ld / (lc + ld)) { // decay in orbit
      const items = ['e-', 'nub', 'numu'].map(item), vs = B.zx ? xaMichel(mm) : phaseSpace(mm, items.map(massOf)); // (an exotic atom of the realistic-particle switch: the electron with the Michel spectrum, 1.27)
      const S = nucBegin([p]); p.muB = null; p.m = atomMass(p); p.im = 1 / p.m; // (the atom, the muon gone from its mass: its motion's ½m_μv² goes to the neutrinos, 1.26)
      if (B.zx) { refresh(p); enforceValence(p, null); relink([p]); } // (its electrons see the whole nuclear charge again, inside the event's books, 1.27)
      const made = spawnItems(items, vs, x, y, z);
      closeEvent(S, made, x, y, B.m, B.m); W.count.decay++;
      log('nuc', `Decay in orbit: the muon in ${el} → e⁻ + ν̄ + ν`); nucEvent('decay', x, y, `μ⁻ in ${el} decays → e⁻ ν̄ ν`, [], '2.2 µs mean life', undefined, z);
      continue;
    }
    // nuclear capture: μ⁻ + p → n + ν; the nucleus, one charge down and hot, cools
    const v = twoBody(Min, Ms, 0, ...rdir()), items = [item('numu')], moms = [v[1]];
    compoundDecay(Z - 1, N + 1, Ms, v[0], false, items, moms, 0);
    const ne = p.ne, S = nucBegin([p]), gh = [ghostOf(p)];
    p.muB = null; kill(p);
    const made = spawnItems(items, moms, x, y, z);
    let left = ne; for (const q of made.ps.filter(q => q.k === NUC && q.Z > 0).sort((a, b) => b.Z - a.Z)) { if (left <= 0) break; const k = Math.min(left, q.Z); q.ne = k; left -= k; refresh(q); }
    for (let k = 0; k < left && W.parts.length < MAX_PARTS; k++) { const u = rdir(), ex = u[0], ey = u[1], ez = u[2] || 0; const e = addLepton(ELEC, x + 0.3 * ex, y + 0.3 * ey, 0, 0, z + 0.3 * ez); setMotion(e, 2 + 5 * rnd(), ex, ey, 0, 0, ez); made.ps.push(e); } // (ez: 3-D, 1.25)
    closeEvent(S, made, x, y, B.m, B.m);
    const txt = `μ⁻ + ${el} → ${summarize(items)}`;
    nucEvent('capture', x, y, `Muon capture: ${txt}`, gh, `μ⁻ + p → n + ν inside the nucleus`, undefined, z); log('nuc', `Muon capture by the nucleus: ${txt}`);
    tally(items, ['μ⁻', el], txt);
  }
}

/* ---- Realistic particles 1: exotic atoms as real atoms (1.27, Experimental: Settings → Experimental → Realistic
   particles → Exotic atoms; approved by the owner, 2026-11-05). Off (RP.exo false), nothing here runs and every setup is
   as before, bit for bit. On:
   - Capture (xaStep, xaTarget). A μ⁻, π⁻ or K⁻ slowed in matter is no longer caught at 2 keV but goes on slowing by
     ionizing (exoIonize) until its kinetic energy is about that of the atoms' outer electrons (XA_CAP, 30 eV), and is
     then caught by an atom within 1.5 Å, each with a chance in proportion to its Z (Fermi and Teller's Z law, Phys. Rev.
     72, 399, 1947). It takes the place of an electron, which leaves with the particle's energy and its binding in the
     first orbit (n₀ = √(m* / mₑ), m* the reduced mass: 14 for a muon, 16 for a pion, 30 for a kaon or an antiproton).
   - The cascade (xaCascade). It falls through the circular orbits n → n − 1, each giving off its energy as an Auger
     electron while the atom has electrons to give and the radiative rate is below XA_AUG (the upper cascade), else as an
     X-ray (the lower one): radiative rate of the hydrogen-like 2p → 1s, 6.27×10⁸ s⁻¹ × Z⁴ m* / mₑ, scaled as n⁻⁵ up the
     circular orbits (Bethe and Salpeter). Levels from Bohr's formula with the reduced mass; a muon's 1s from the measured
     2p → 1s line (XA_KA: the nucleus's size lowers it, muonic lead 5.90 MeV against a point nucleus's 14.2 MeV). The
     cascade takes about 10⁻¹³ s: at once here. Its books are exact: the X-rays carry their line energies exactly, the
     electrons set free take what is left (xaClose).
   - Its end: a muon stays in its 1s orbit and decays (the Michel spectrum, xaMichel) or is captured by the nucleus, at
     the measured rates (muBoundTick, MU_TAU); a pion or kaon is absorbed from its last orbit (XA_NABS) by the existing
     absorption (hStop: the star, or π⁻p → π⁰n / γn; kStop: Λ or Σ and pions, now and then a hypernucleus); an
     antiproton annihilates (engine.js nuclearAnnihilation, the flat game only: antimatter is not in 3-D).
   - To the outside a muonic atom is an atom of charge Z − 1 (p.muB.zx: engine.js zChem): its electrons see the nucleus
     and the muon together, so muonic carbon takes boron's table entries (valence, bond energies and lengths, size,
     electronegativity, ionization energies). Muonic hydrogen (μp, μd, μt) stays an unstable particle in W.exo, neutral
     and 200 times smaller than an atom, so it passes through atoms; next to a heavier atom its muon moves over to it
     (xaTransfer, μp + Z → μZ + p), at the measured rate.
   The atom is an ordinary atom of the store with p.muB (as since 0.51), so Select, Erase, Inspect, copy, saves and undo
   take it; muB carries what it is (sp), its orbit (n), the lines given off and the Auger electrons. */
const RP = { exo: false }; // (the realistic-particle switches, set from Settings: ui.js applySettings)
const XA_SPS = new Set(['mu-', 'pi-', 'K-']), XA_CAP = 30, XA_R = 1.5, XA_AUG = 1e12, XA_QMAX = 2, XA_ME = 0.51099895;
const xaMass = (sp) => (sp === 'pbar' ? PHYS.MP * PHYS.AMU_MEV : XP[sp].m);
const XA_NAME = { 'mu-': 'Muonic', 'pi-': 'Pionic', 'K-': 'Kaonic', pbar: 'Antiprotonic' }, XA_LAB = { 'mu-': 'μ⁻', 'pi-': 'π⁻', 'K-': 'K⁻', pbar: 'p̄' };
function xaMred(sp, Z, N) { const m = xaMass(sp), M = nucMeV(Z, N); return m * M / (m + M); }
function xaBohr(sp, Z, N, n) { return PHYS.RY * (xaMred(sp, Z, N) / XA_ME) * Z * Z / (n * n); } // (eV)
/* Muonic 2p → 1s lines measured (keV; the 2p fine-structure pair at its 2 : 1 mean, lead 5,962.8 and 5,778.1): C, O, Al,
   Si, Ca, Fe, Pb, from the muonic X-ray compilations (Engfer et al., At. Data Nucl. Data Tables 14, 509, 1974; Fricke
   et al., 60, 177, 1995), values as I know them (no network here: worth a check). Between them the ratio to Bohr's value
   is interpolated in Z; hydrogen's line is Bohr's (1.898 keV for μp). */
const XA_KA = [[6, 12, 75.25], [8, 16, 133.53], [13, 27, 346.8], [14, 28, 400.2], [20, 40, 783.9], [26, 56, 1255], [82, 208, 5901]];
const _xaKr = [[1, 1]].concat(XA_KA.map(([Z, A, k]) => [Z, k * 1e3 / (0.75 * xaBohr('mu-', Z, A - Z, 1))]));
function xaKaRatio(Z) {
  const R = _xaKr; if (Z <= 1) return 1;
  for (let i = 1; i < R.length; i++) if (Z <= R[i][0]) { const [z0, r0] = R[i - 1], [z1, r1] = R[i]; return r0 + (r1 - r0) * (Z - z0) / (z1 - z0); }
  const [z0, r0] = R[R.length - 2], [z1, r1] = R[R.length - 1]; return Math.max(0.3, r1 + (r1 - r0) * (Z - z1) / (z1 - z0));
}
/* An orbit's binding (eV): Bohr's with the reduced mass; a muon's 1s from the measured 2p → 1s line above 2p's. */
function xaLevel(sp, Z, N, n) { return sp === 'mu-' && n === 1 ? xaBohr(sp, Z, N, 2) + 0.75 * xaKaRatio(Z) * xaBohr(sp, Z, N, 1) : xaBohr(sp, Z, N, n); }
const xaN0 = (sp, Z, N) => Math.max(2, Math.round(Math.sqrt(xaMred(sp, Z, N) / XA_ME)));
/* The orbit a hadron is absorbed from: where the strong interaction overtakes the X-rays, rounded from the last lines
   measured in pionic, kaonic and antiprotonic atoms (Batty, Friedman and Gal, Phys. Rep. 287, 385, 1997; protonium
   annihilates from 2p 99 times in 100, its 2p width 38 meV against 0.4 meV for the 2p → 1s X-ray). */
const XA_NABS = { 'mu-': () => 1, 'pi-': (Z) => (Z <= 11 ? 1 : Z <= 35 ? 2 : Z <= 83 ? 3 : 4), 'K-': (Z) => (Z === 1 ? 1 : Z <= 8 ? 2 : Z <= 20 ? 3 : Z <= 40 ? 4 : Z <= 60 ? 5 : Z <= 75 ? 6 : 7), pbar: (Z) => (Z === 1 ? 2 : Z <= 8 ? 3 : Z <= 20 ? 4 : Z <= 40 ? 6 : Z <= 60 ? 8 : 9) };
/* The atom that catches a slow negative particle: one within XA_R, by Z (Fermi–Teller), in a fixed order. */
function xaTarget(o) {
  const c = []; let wsum = 0;
  const skip = (p) => p.dead || p.k !== NUC || p.Z < 1 || p.anti || p.muB || p.mu || p.rad;
  const take = (p, r2) => { if (skip(p) || !(r2 < XA_R * XA_R)) return; c.push(p); wsum += p.Z; };
  if (W.d3) nearby(o.x, o.y, XA_R, (p, dx, dy, r2) => take(p, r2), o.z); else nearby(o.x, o.y, XA_R, (p) => take(p, (p.x - o.x) ** 2 + (p.y - o.y) ** 2));
  if (!c.length) return null;
  c.sort((a, b) => a.id - b.id);
  let u = rnd() * wsum; for (const p of c) { u -= p.Z; if (u < 0) return p; }
  return c[c.length - 1];
}
/* moveExos: a μ⁻, π⁻ or K⁻ with the switch on. Returns true if it was caught (or, a hadron whose atom formed, absorbed). */
function xaStep(o) {
  if (o.xaDone) return o.sp === 'K-' ? kStop(o) : o.sp === 'pi-' ? hStop(o) : false; // (its atom made, its absorption failed once: tried again as before)
  if (!(o.KE < XA_CAP)) return false;
  const tg = xaTarget(o);
  return tg ? xaCatch(o, tg) : false;
}
/* The cascade from orbit n0 down to n1 in the atom tg (already in an event's books): the capture's own electron first (the
   particle's energy K0 and its binding in n0), then each n → n − 1. Electrons set free go to eOut; returns the X-ray lines
   ({ E eV, a: from n, b: to n; a = 0 the capture itself }) and the count of Auger electrons. The atom is left at most
   XA_QMAX positive: in a liquid or solid its holes fill from its neighbours within femtoseconds, which the game does not
   follow, so past that the upper cascade radiates. */
function xaCascade(tg, sp, Z, N, n0, n1, K0, eOut, noCap, debt = 0) { // (debt: what the atom's electrons lost in binding when the muon came inside them, eV: paid from the upper cascade first)
  const mr = xaMred(sp, Z, N), lines = [];
  let aug = 0;
  const pay = (e) => { const t = Math.min(debt, e); debt -= t; return e - t; };
  const rad = (n) => 6.268e8 * Z ** 4 * (mr / XA_ME) * Math.pow(2 / n, 5);
  const auger = (dE) => {
    if (tg.dead || tg.ne <= 0 || tg.q + 1 > XA_QMAX) return false;
    const c = ionizationCost(tg); if (!(dE > c + 0.05)) return false;
    const e = ejectElectron(tg, dE - c); if (!e) return false;
    eOut.push(e); aug++; return true;
  };
  if (!noCap) { const Ec = pay(K0 + xaLevel(sp, Z, N, n0)); if (Ec > 0 && !auger(Ec)) lines.push({ E: Ec, a: 0, b: n0 }); }
  for (let n = n0; n > n1; n--) { const dE = pay(xaLevel(sp, Z, N, n - 1) - xaLevel(sp, Z, N, n)); if (!(dE > 0) || (rad(n) < XA_AUG && auger(dE))) continue; lines.push({ E: dE, a: n, b: n - 1 }); }
  return { lines, aug };
}
/* Close an exotic atom's books as closeEvent does, with the X-ray lines at their own energies: what the books leave beyond
   them goes to the recipients (the Auger electrons; after a muon transfer, the proton and the atom), or, with none, to
   one more soft photon (lines.rest). Then the lines are sent off. */
function xaClose(S, made, x, y, z, Ein, mIn, lines, recips) {
  if (made.lost) W.ledger.escaped += made.lost;
  let mX = 0, EX = 0; for (const o of made.xs) { mX += o.m * MEV; EX += o.m * MEV + o.KE; }
  const Qm = nucMassLoss(S); W.ledger.nuc += Qm + mIn - mX;
  const Qrel = Qm - EX + Ein;
  let X = 0; for (const l of lines) X += l.E;
  const tol = 1e-9 * Math.max(1, X), rs = (recips || []).filter(q => q && !q.dead);
  let left = nucLeft(S, Qrel) - X;
  for (let k = 0; k < 4 && Math.abs(left) > tol && rs.length; k++) {
    if (rs.length > 1) shareKE(rs, left);
    else { const q = rs[0], K = keOf(q); if (!(K > 0) || !(K + left > 0)) break; if (q.rad) { q.KE = K + left; radSpeed(q); q.vx = q.sp * q.ux; q.vy = q.sp * q.uy; } else { const f = Math.sqrt((K + left) / K); if (W.d3) { q.vx *= f; q.vy *= f; q.vz *= f; updateFast(q); } else setVel(q, q.vx * f, q.vy * f); } }
    left = nucLeft(S, Qrel) - X;
  }
  if (left < -tol) { for (const l of lines.slice().sort((a, b) => a.E - b.E)) { const t = Math.min(l.E, -left); l.E -= t; left += t; if (left >= 0) break; } } // (more given than there was: the softest lines give it back)
  if (left > tol) lines.push({ E: left, a: -1, b: -1, rest: true });
  for (const l of lines) { if (!(l.E > 0)) continue; const u = rdir(); if (W.d3) emitPhoton(x, y, l.E, u[0], u[1], { z, uz: u[2] }); else emitPhoton(x, y, l.E, u[0], u[1]); }
}
const xaLines = (L, k = 3) => L.filter(l => l.a > 0 && !l.rest).sort((a, b) => b.E - a.E).slice(0, k).map(l => `${fmtE(l.E)} (${l.a}→${l.b})`).join(', ');
/* A slow μ⁻, π⁻ or K⁻ caught by tg. */
function xaCatch(o, tg) {
  const sp = o.sp, Z = tg.Z, N = tg.N, x = tg.x, y = tg.y, z = tg.z, el = speciesLabel(tg);
  if (sp === 'mu-' && Z === 1 && N <= 2) return xaCatchH(o, tg);
  const n0 = xaN0(sp, Z, N), n1 = XA_NABS[sp](Z), B1 = xaLevel(sp, Z, N, n1), K0 = o.KE;
  const S = nucBegin([tg]);
  let R = 0;
  if (sp === 'mu-') { // (the muon stays: the atom's mass holds it, its electrons see Z − 1)
    o.dead = true; o.fate = `caught by ${el}: a muonic atom`;
    const I0 = internalE(tg);
    tg.muB = { m: MU_M * MEV - B1, Eb: B1, sp, n: 1, zx: 1, n0 }; tg.m = atomMass(tg); tg.im = 1 / tg.m;
    refresh(tg); enforceValence(tg, null); relink([tg]);
    R = Math.max(0, internalE(tg) - I0); // (its electrons less bound by the screened charge: paid by the upper cascade)
    (W.muBound || (W.muBound = [])).push(tg);
  }
  const made = { ps: [], xs: [], rays: [], lost: 0 };
  const cas = xaCascade(tg, sp, Z, N, n0, n1, K0, made.ps, false, R);
  xaClose(S, made, x, y, z, K0 + B1, B1, cas.lines, made.ps);
  W.count.xatom = (W.count.xatom || 0) + 1;
  const name = XA_NAME[sp], sub = `cascade n = ${n0} → ${n1}: X-rays ${xaLines(cas.lines) || 'none'}${cas.aug ? `; ${cas.aug} Auger electron${cas.aug > 1 ? 's' : ''}` : ''}`;
  nucEvent('capture', x, y, `${name} atom: ${XA_LAB[sp]} caught by ${el}`, [], sub, undefined, z);
  log('nuc', `${name} atom: ${XA_LAB[sp]} caught by ${el} into orbit n = ${n0}; ${sub}`);
  if (sp === 'mu-') { tg.muB.lines = cas.lines.filter(l => l.a > 0 && !l.rest).map(l => [+l.E.toPrecision(6), l.a, l.b]); tg.muB.aug = cas.aug; return true; }
  // a pion or kaon: absorbed by the nucleus from orbit n1, its binding there already given off (its mass is less by it)
  o.KE = 0; o.m -= B1 / MEV; exoSpeed(o); o.xaDone = tg.id; o.x = x; o.y = y; if (W.d3) o.z = z;
  if (!(sp === 'K-' ? kStop(o, tg) : hStop(o, tg))) return true; // (no consistent outcome this time: it waits, at rest, and is tried again)
  return true;
}
/* A μ⁻ caught by hydrogen: muonic hydrogen (μp, μd, μt; W.exo as before), its cascade's lines given off (the atom's one
   electron leaves at the capture, so the rest is X-rays: 2p → 1s 1.898 keV for μp). */
function xaCatchH(o, tg) {
  const sp = ['muP', 'muD', 'muT'][tg.N], N = tg.N, x = tg.x, y = tg.y, z = tg.z, el = speciesLabel(tg), n0 = xaN0('mu-', 1, N), kT = PHYS.KB * Math.max(W.T, 20);
  const S = nucBegin([tg]), es = [];
  const cas = xaCascade(tg, 'mu-', 1, N, n0, 1, o.KE, es);
  kill(tg); o.dead = true; o.fate = `caught by ${el}: ${XP[sp].lab}`;
  const made = spawnItems([item(sp)], [randDir4(XP[sp].m, 1.5 * kT / MEV)], x, y, z);
  for (const e of es) made.ps.push(e);
  if (made.xs[0]) { made.xs[0].cyc = o.cyc || 0; made.xs[0].xaL = cas.lines.filter(l => l.a > 0).map(l => [+l.E.toPrecision(6), l.a, l.b]); }
  xaClose(S, made, x, y, z, o.KE + o.m * MEV, o.m * MEV, cas.lines, es.length ? es : made.xs.length ? [] : made.ps);
  W.count.xatom = (W.count.xatom || 0) + 1;
  const sub = `cascade n = ${n0} → 1: X-rays ${xaLines(cas.lines)}`;
  nucEvent('capture', x, y, `Muonic atom: μ⁻ caught by ${el} → ${XP[sp].lab}`, [], sub, undefined, z);
  log('nuc', `Muonic atom: μ⁻ caught by ${el} → ${XP[sp].lab}; ${sub}`);
  return true;
}
/* Muonic hydrogen next to a heavier atom (within 2.5 Å, as muAtomTick takes a neighbour in liquid hydrogen): its muon moves
   over, μp + Z → μZ + p, into the orbit of μZ just bound more deeply than μp's 1s, and cascades down there; the proton
   and the atom fly apart with the difference. Rates at liquid hydrogen's density (s⁻¹): nitrogen 3.4×10¹⁰ and oxygen
   8.5×10¹⁰, measured with thermal μp in hydrogen gas mixtures at PSI (late 1990s; values as I know them); other elements
   scaled from oxygen's as Z (Gershtein's estimate, up to 1.5×10¹¹), helium's very slow (about 10⁸). */
const XA_TR = { 2: 1e8, 7: 3.4e10, 8: 8.5e10 };
const xaTrRate = (Z) => XA_TR[Z] || Math.min(1.5e11, 8.5e10 * Z / 8);
function xaTransfer(o, clock) {
  const tg = stopTarget(o, (p) => p.dead || p.k !== NUC || p.Z < 2 || p.anti || p.muB || p.mu, 2.5);
  if (!tg || !(rnd() < 1 - Math.exp(-xaTrRate(tg.Z) * clock))) return false;
  const Z = tg.Z, N = tg.N, Nh = XP[o.sp].N, Bh = XP[o.sp].Eb * MEV, x = tg.x, y = tg.y, z = tg.z, el = speciesLabel(tg), hl = XP[o.sp].lab;
  const B1 = xaLevel('mu-', Z, N, 1), P = exoP4(o), mN = nucMeV(1, Nh), pp = pmag(P);
  const S = nucBegin([tg]), I0 = internalE(tg);
  o.dead = true; o.fate = `its muon moved to ${el}`;
  tg.muB = { m: MU_M * MEV - B1, Eb: B1, sp: 'mu-', n: 1, zx: 1, n0: 1, from: hl }; tg.m = atomMass(tg); tg.im = 1 / tg.m;
  refresh(tg); enforceValence(tg, null); relink([tg]);
  const R = Math.max(0, internalE(tg) - I0); // (its electrons less bound once the muon is inside them)
  let nt = 1; for (let n = 1; n < 80 && xaLevel('mu-', Z, N, n) > Bh + R; n++) nt = n; // (the highest orbit the transfer can reach and still pay for that)
  tg.muB.n0 = nt;
  (W.muBound || (W.muBound = [])).push(tg);
  muClear(o); // (where the bare nucleus will be, clear of the atoms, as for muonium)
  const made = spawnItems([{ t: 'A', Z: 1, N: Nh, anti: false }], [[Math.sqrt(mN * mN + pp * pp), ...P.slice(1)]], o.x, o.y, o.z || 0); // (the bare nucleus left, with the muonic hydrogen's momentum)
  const es = [], cas = xaCascade(tg, 'mu-', Z, N, nt, 1, 0, es, true);
  const Ein = o.KE + o.m * MEV - tg.muB.m, rec = made.ps.length ? [made.ps[0], tg] : es;
  xaClose(S, { ps: made.ps.concat(es), xs: [], rays: [], lost: made.lost }, x, y, z, Ein, Ein - o.KE, cas.lines, rec);
  tg.muB.lines = cas.lines.filter(l => l.a > 0 && !l.rest).map(l => [+l.E.toPrecision(6), l.a, l.b]); tg.muB.aug = cas.aug;
  W.count.xatom = (W.count.xatom || 0) + 1; W.count.muXfer = (W.count.muXfer || 0) + 1;
  const sub = `into n = ${nt}, cascade to 1s: X-rays ${xaLines(cas.lines)}`;
  nucEvent('capture', x, y, `Muon transfer: ${hl} + ${el} → μ${ELEMENTS[Z].sym} + ${['p', 'd', 't'][Nh]}`, [{ x: o.x, y: o.y, k: 'x', rd: 0.15, lbl: hl }], sub, undefined, z);
  log('nuc', `Muon transfer: ${hl} + ${el} → muonic ${ELEMENTS[Z].name.toLowerCase()} + ${['p', 'd', 't'][Nh]}; ${sub}`);
  return true;
}
/* A bound muon's decay in orbit with the electron's Michel spectrum (x²(3 − 2x), x = E/E_max) in the muon's frame, the
   two neutrinos sharing the rest isotropically in their own frame: four-momenta [e, ν̄, ν] in the atom's frame (mm: the
   bound muon's mass, MeV, so the end point is lowered by its binding, as for a bound muon). The spectrum's distortion
   by the nucleus's field (heavy atoms) is left out. */
function xaMichel(mm) {
  const me = XA_ME, Wm = (mm * mm + me * me) / (2 * mm), x0 = me / Wm;
  let x = 1; for (let k = 0; k < 200; k++) { const t = x0 + (1 - x0) * rnd(); if (rnd() < t * t * (3 - 2 * t)) { x = t; break; } }
  const Ee = x * Wm, pe = Math.sqrt(Math.max(0, Ee * Ee - me * me)), u = rdir();
  const e = W.d3 ? [Ee, pe * u[0], pe * u[1], pe * u[2]] : [Ee, pe * u[0], pe * u[1]], R = neg4(mm - Ee, e), M = mass4(R);
  const vv = twoBody(M, 0, 0, ...rdir()), b = vel4(R);
  return [e, toLab(vv[0], ...b), toLab(vv[1], ...b)];
}
/* Inspect's words for an exotic atom's state (ui.js). */
function xaInfo(p) {
  const B = p.muB; if (!B) return null;
  const [lc, ld] = muRates(p.Z, p.N), tau = 1 / (lc + ld);
  return { name: 'muonic', n: B.n || 1, Eb: B.Eb, tau, cap: lc / (lc + ld), lines: B.lines || null, aug: B.aug || 0, zx: !!B.zx, n0: B.n0 || 0, from: B.from || '' };
}

/* ---- Realistic particles 2: positronium (1.27, Experimental: Settings → Experimental → Realistic particles →
   Positronium; approved by the owner, 2026-11-05). Off (RP.ps false), no positronium is made and every setup is as
   before, bit for bit. On:
   - Forming (psFromAtom, psFromFree). A positron takes an electron and becomes positronium, Ps (e⁺e⁻, bound by 6.803 eV,
     half hydrogen's, its orbit twice hydrogen's). From an atom or molecule it touches (evLepton) in the Ore gap: its
     energy E between I − 6.8 eV and I, I the electron's binding there (ionizationCost: 13.6 eV for H, 12.6 for water,
     3.6 for Cl⁻). Below I − 6.8 Ps can't form (the pair would be bound less than the electron was); above I ionization
     competes; outside the gap the positron annihilates on contact as before. From a free electron (the two within
     0.3 Å, evAnnihFree): a pair with less than 6.8 eV of its own energy to spare forms Ps, a photon taking the
     difference (the spur: the electrons a positron's own track set free); faster pairs annihilate as before. Either
     way the books are exact (nucBegin, closeEvent): Ps gets what is left.
   - Spin. Para-Ps (the singlet, 1 in 4) lives 125.14 ps (7990.9 µs⁻¹, Al-Ramadhan & Gidley, PRL 72, 1632, 1994) and
     gives 2 γ of 511 keV back to back; ortho-Ps (the triplet, 3 in 4) lives 142.05 ns in vacuum (7.0404 µs⁻¹,
     Vallery, Zitzewitz & Gidley, PRL 90, 203402, 2003) and gives 3 γ sharing 1,022 keV in a plane, their energies
     drawn from the Ore–Powell matrix element (Phys. Rev. 75, 1696, 1949), each continuous up to 511 keV (psDecay).
   - In matter (psMatter). Pick-off: o-Ps's positron annihilates (2 γ) with an electron of the molecules around it, at
     a rate in proportion to the electron density within 5 Å, scaled so liquid water gives water's measured o-Ps life,
     1.80 ns (positron annihilation lifetime spectroscopy at room temperature); the flat game's water is its own
     reference (0.85 e/Å² measured in the water setup), the 3-D one real water's 0.334 e/Å³. Spin conversion: O₂, whose
     two unpaired electrons exchange spin with the Ps's, turns o-Ps into p-Ps (and back, three times as often, by the
     states' counts) at n·σ·v, σ = 1.5×10⁻¹⁹ cm² (the thermal o-Ps–O₂ conversion cross section measured in O₂ gas, as I
     know it: no network here, worth a check); its local density is counted as the electrons are.
   - What it can't make real: Ps passes through atoms (in nature its electron's repulsion holds it in a bubble about
     3 Å across; the pick-off rate stands for that), keeps the energy it was made with (no thermalizing collisions),
     reacts with nothing (no PsH, no oxidation by O₂; other radicals don't convert it), and has one mass for both spin
     states (they differ by 0.84 meV). At the game's timescale 142 ns is forever: an o-Ps in vacuum outlives any
     run unless decay is sped up (Lab → Decay speed); 125 ps is about 12,300 tu.
   Ps is an unstable particle in W.exo (pPs, oPs), so Select, Erase, Inspect, saves and undo take it as they take a muon. */
const PS_B = PHYS.RY / 2, PS_M = 2 * PHYS.ME * PHYS.AMU_MEV - PS_B / MEV; // (binding eV: μ = mₑ/2; mass MeV)
const PS_TAU_W = 1.80e-9, PS_R = 5, PS_RHO = { 2: 0.85, 3: 0.334 }, PS_SIGC = 1.5e-19, PS_NW = 3.34e22; // (o-Ps in water s; sampling radius Å; water's electron density; σ cm²; water molecules cm⁻³)
const PS_LPO = 1 / PS_TAU_W - 1 / 1.4205e-7; // (the pick-off rate in water, s⁻¹)
RP.ps = false; RP.mu = false; // (Experimental → Realistic particles: positronium, muonium as hydrogen; ui.js applySettings)
XP.pPs = { lab: 'p-Ps', m: PS_M, q: 0, tau: 1.2514e-10, col: [255, 170, 235], cc: 'pPs', ps: true, dec: [[1, ['g', 'g']]] };
XP.oPs = { lab: 'o-Ps', m: PS_M, q: 0, tau: 1.4205e-7, col: [235, 140, 255], cc: 'oPs', ps: true, dec: [[1, ['g', 'g', 'g']]] };
/* A new Ps at (x, y, z) moving along (ux, uy, uz), para 1 in 4. Its energy comes from closeEvent. */
function psMake(x, y, z, ux, uy, uz) {
  const sp = rnd() < 0.25 ? 'pPs' : 'oPs';
  return W.d3 ? addExo(sp, x, y, 0, ux, uy, undefined, z, uz) : addExo(sp, x, y, 0, ux, uy);
}
const psDir = (px, py, pz) => { const L = Math.hypot(px, py, W.d3 ? pz : 0); return L > 0 ? [px / L, py / L, W.d3 ? pz / L : 0] : (() => { const u = rdir(); return [u[0], u[1], u[2] || 0]; })(); };
/* A positron (or an electron at antimatter) touching atom A with Erel of motion: Ps in the Ore gap. True if made. */
function psFromAtom(L, A, Erel) {
  if (L.dead || A.dead || A.ne <= 0 || A.muB) return false;
  const I = ionizationCost(A), Eas = Erel + pairPE(L, A); // (its energy apart from the pull between them: at an ion the contact energy holds the well's depth)
  if (!(Eas > I - PS_B) || !(Eas < I)) return false;
  // (on trial: the electron taken, the positron's charge off, measured; the remainder is what Ps would carry)
  const set = setOf(molecule(A)), T = new Set(set); T.add(L);
  const E0 = regionE(T), sn = snapshot(set), q0 = L.q;
  A.ne--; refresh(A); enforceValence(A, null); relink([A]); L.q = 0;
  const avail = E0 - regionE(set) - PS_M * MEV; // (what Ps would carry: all before, less what stays and its rest energy)
  L.q = q0; restoreSnap(sn);
  if (!(avail > 0.01)) return false;
  const x = L.x, y = L.y, z = L.z || 0, who = speciesLabel(A), u = psDir(L.m * L.vx + PHYS.ME * A.vx, L.m * L.vy + PHYS.ME * A.vy, L.m * (L.vz || 0) + PHYS.ME * (A.vz || 0));
  const S = nucBegin([L, A]);
  kill(L); A.ne--; refresh(A); enforceValence(A, null); relink([A]);
  const o = psMake(x, y, z, u[0], u[1], u[2]);
  closeEvent(S, { ps: [], xs: [o], rays: [], lost: 0 }, x, y, 0, 0);
  psNote(o, `${L.k === POS ? 'e⁺' : 'e⁻'} + ${who} → ${o.lab} + ${speciesLabel(A)}`, `in the Ore gap (${fmtE(I - PS_B)}–${fmtE(I)}): it took an electron bound by ${fmtE(I)}`, z);
  return true;
}
/* A free positron and electron within 0.3 Å: Ps if they have less than its binding to spare; a photon takes the rest. */
function psFromFree(a, b) {
  if (a.dead || b.dead) return false;
  const T = new Set([a, b]), M = a.m + b.m, px = a.m * a.vx + b.m * b.vx, py = a.m * a.vy + b.m * b.vy, pz = a.m * (a.vz || 0) + b.m * (b.vz || 0);
  if (a.rad || b.rad) return false;
  const Kcm = 0.5 * (px * px + py * py + (W.d3 ? pz * pz : 0)) / M, Eg = regionE(T) - PS_M * MEV - Kcm;
  if (!(Eg > 0.01 && Eg < 2 * PS_B)) return false;
  const x = 0.5 * (a.x + b.x), y = 0.5 * (a.y + b.y), z = 0.5 * ((a.z || 0) + (b.z || 0)), u = psDir(px, py, pz);
  const S = nucBegin([a, b]);
  kill(a); kill(b);
  const o = psMake(x, y, z, u[0], u[1], u[2]), d = rdir();
  o.KE = Kcm; exoSpeed(o);
  const made = { ps: [], xs: [o], rays: [[item('g'), 1, d[0], d[1], d[2] || 0]], lost: 0 };
  if (W.d3) made.z3 = z;
  closeEvent(S, made, x, y, 0, 0);
  psNote(o, `e⁺ + e⁻ → ${o.lab} + γ`, `a free electron caught: the photon carries ${fmtE(Eg)}`, z);
  return true;
}
function psNote(o, txt, sub, z) {
  W.count.react++;
  nucEvent('capture', o.x, o.y, `Positronium: ${txt}`, [], sub, undefined, z);
  log('nuc', `Positronium: ${txt} (${o.sp === 'pPs' ? 'para, spins opposite: 2γ in 125 ps' : 'ortho, spins parallel: 3γ in 142 ns in vacuum, sooner in matter'})`);
}
/* What surrounds a Ps: electrons and O₂ molecules within PS_R, as densities against liquid water's. */
function psEnv(o) {
  let ne = 0, nO2 = 0;
  nearby(o.x, o.y, PS_R, (p) => {
    if (p.k === NUC) { if (p.Z > 0) ne += p.ne; if (p.Z === 8 && !p.muB && p.q === 0 && p.bonds.length === 1) { const q = other(p.bonds[0], p); if (q.Z === 8 && q.bonds.length === 1 && !q.muB && q.q === 0) nO2 += 0.5; } }
    else if (p.k === ELEC) ne++;
  }, o.z);
  const V = W.d3 ? 4 / 3 * Math.PI * PS_R ** 3 : Math.PI * PS_R * PS_R, ref = PS_RHO[W.d3 ? 3 : 2];
  return { e: ne / V / ref, o2: nO2 / V / (ref / 10) }; // (electron density over water's; O₂ number density over water's molecules)
}
/* Its rates here (s⁻¹, in its own time): pick-off, and spin conversion away from its state. */
function psRates(o, cached) {
  let env = cached && o.psE && Math.abs(o.x - o.psE.x) + Math.abs(o.y - o.psE.y) + Math.abs((o.z || 0) - o.psE.z) < 1 && W.step - o.psE.s < 8 ? o.psE : null; // (its surroundings looked at again once it has moved an ångström, or every 8 steps: the look costs ~25 µs in 3-D)
  if (!env) { env = psEnv(o); if (cached) { env.x = o.x; env.y = o.y; env.z = o.z || 0; env.s = W.step; o.psE = env; } }
  const v = o.v * 1e-8 / PHYS.TU_S, conv = env.o2 * PS_NW * PS_SIGC * v;
  return { po: PS_LPO * env.e, conv: o.sp === 'oPs' ? conv : 3 * conv, env };
}
/* Each step of a Ps (clock: lab seconds of the decay clock): pick-off or conversion. True if it is gone. */
function psMatter(o, clock) {
  const r = psRates(o, true), lt = r.po + r.conv, dt = clock / o.gam;
  if (!(lt > 0) || !(rnd() < 1 - Math.exp(-lt * dt))) return false;
  if (rnd() * lt < r.conv) { // (spin exchange with O₂: the other state; same mass, nothing to book)
    const was = o.lab; o.sp = o.sp === 'oPs' ? 'pPs' : 'oPs'; o.lab = XP[o.sp].lab; o.trk.c = XP[o.sp].col;
    log('nuc', `Positronium: ${was} → ${o.lab}, its spin turned by an O₂ molecule's unpaired electrons`);
    return false;
  }
  psDecay(o, true);
  return true;
}
/* Ps annihilating: para (or pick-off) 2 γ back to back in its frame, ortho 3 γ in a plane (Ore–Powell); boosted by its
   motion; the books close exactly (closeEvent: the photons share what the Ps carried). */
function psDecay(o, pick) {
  const M = o.m, n = pick || o.sp === 'pPs' ? 2 : 3, vs = [];
  if (n === 2) { const u = rdir(); vs.push(...twoBody(M, 0, 0, ...u)); }
  else {
    let x1 = 1, x2 = 0.5;
    for (let k = 0; k < 400; k++) {
      const a = rnd(), b = rnd(); if (a + b < 1) continue;
      const c = 2 - a - b, w = ((1 - a) / (b * c)) ** 2 + ((1 - b) / (a * c)) ** 2 + ((1 - c) / (a * b)) ** 2;
      if (rnd() * 2 < w) { x1 = a; x2 = b; break; }
    }
    const E1 = x1 * M / 2, E2 = x2 * M / 2, E3 = M - E1 - E2, c12 = clamp((E3 * E3 - E1 * E1 - E2 * E2) / (2 * E1 * E2), -1, 1), s12 = Math.sqrt(1 - c12 * c12) * (rnd() < 0.5 ? 1 : -1);
    const p = [[E1, 0], [E2 * c12, E2 * s12]]; p.push([-p[0][0] - p[1][0], -p[0][1] - p[1][1]]);
    const Es = [E1, E2, E3];
    if (W.d3) { // (the decay plane at random: a random normal, and a turn within the plane)
      const nrm = rndDir(), t = Math.abs(nrm[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      let e1 = [t[1] * nrm[2] - t[2] * nrm[1], t[2] * nrm[0] - t[0] * nrm[2], t[0] * nrm[1] - t[1] * nrm[0]]; const L1 = Math.hypot(...e1); e1 = e1.map(v => v / L1);
      const e2 = [nrm[1] * e1[2] - nrm[2] * e1[1], nrm[2] * e1[0] - nrm[0] * e1[2], nrm[0] * e1[1] - nrm[1] * e1[0]], th = 2 * Math.PI * rnd(), c = Math.cos(th), s = Math.sin(th);
      for (let i = 0; i < 3; i++) { const a = p[i][0] * c - p[i][1] * s, b = p[i][0] * s + p[i][1] * c; vs.push([Es[i], a * e1[0] + b * e2[0], a * e1[1] + b * e2[1], a * e1[2] + b * e2[2]]); }
    } else { const th = 2 * Math.PI * rnd(), c = Math.cos(th), s = Math.sin(th); for (let i = 0; i < 3; i++) vs.push([Es[i], p[i][0] * c - p[i][1] * s, p[i][0] * s + p[i][1] * c]); }
  }
  const b = o.v / PHYS.C, bx = b * o.ux, by = b * o.uy, bz = W.d3 ? b * o.uz : 0;
  const made = { ps: [], xs: [], rays: [], lost: 0 };
  for (const v of vs) { const L = toLab(v, bx, by, bz, o.gam), pm = pmag(L) || 1; made.rays.push(W.d3 ? [item('g'), L[0] * MEV, L[1] / pm, L[2] / pm, L[3] / pm] : [item('g'), L[0] * MEV, L[1] / pm, L[2] / pm]); }
  if (W.d3) made.z3 = o.z;
  const S = nucBegin([]);
  o.dead = true;
  closeEvent(S, made, o.x, o.y, o.KE + o.m * MEV, o.m * MEV);
  W.count.annih++;
  const txt = pick ? `${o.lab} pick-off: its positron meets an electron of the molecules around it → 2γ` : o.sp === 'pPs' ? 'p-Ps → 2γ (511 keV each, back to back)' : `o-Ps → 3γ (${made.rays.map(r => fmtE(r[1])).join(', ')})`;
  o.fate = txt;
  flash(o.x, o.y, [255, 255, 255], 3, 0.4, W.d3 ? o.z : undefined);
  nucEvent('annih', o.x, o.y, `Positronium: ${txt}`, [{ x: o.x, y: o.y, k: 'x', rd: 0.12, lbl: o.lab }], pick ? 'in matter o-Ps lives nanoseconds, not 142 ns' : o.sp === 'pPs' ? 'mean life 125 ps' : 'mean life 142 ns in vacuum', undefined, W.d3 ? o.z : 0);
  log('nuc', `Positronium: ${txt}`);
}
/* Inspect's words for a Ps (ui.js): its state and its expected life here. */
function psInfo(o) {
  const r = psRates(o), own = 1 / XP[o.sp].tau, life = 1 / (own + r.po + r.conv);
  return { para: o.sp === 'pPs', Eb: PS_B, size: 2 * 0.529177, life, po: r.po, conv: r.conv, rho: r.env.e };
}

/* ---- Realistic particles 4: muonium as the lightest hydrogen isotope, and μSR (1.27, Experimental: Settings →
   Experimental → Realistic particles → Muonium as hydrogen; approved by the owner, 2026-11-05). Off (RP.mu false), as
   before, bit for bit. Muonium (μ⁺e⁻) has been an H atom in MD with the muon's mass since 1.12 (0.11398 u: the muon,
   0.113429 u, and its electron), bonding by hydrogen's force field (Mu + Cl₂ → MuCl + Cl). On:
   - Its binding is hydrogen's with the reduced mass, 13.540 eV (H 13.598: Rydberg × m_red/mₑ, 0.995187 against
     0.999456), in its internal energy and ionization cost (engine.js internalE, ionizationCost: MU_IONF). Its chemistry
     stays hydrogen's force field, with its own mass, which gives the isotope effects (Mu–X vibrates about 2.9 times
     faster than H–X; with Quantum nuclei its rings spread as its mass asks: zero-point energy about 3× hydrogen's).
   - The muon's spin (o.spin, p.spin: a unit vector). A μ⁺ fired or made by a decay has its spin against its flight
     (π⁺ → μ⁺ν: the muon is born fully polarized backward, as a surface-muon beam is); one placed at rest has it across
     the field (+x; in 3-D across the field's axis), as a polarized beam stopped in a sample has for transverse-field
     μSR. It precesses about the magnetic field on the decay clock (proper time): a free μ⁺, or one in a molecule
     (diamagnetic: MuH, MuCl, MuOH), at γ_μ/2π = 135.5388 MHz/T. Muonium keeps its electron's spin (o.eSpin, along the
     field or against it, 1 in 2 when it forms): with it along the field its muon turns at ν₁₂ and against it at ν₃₄ of
     the Breit–Rabi levels (hyperfine ν₀ = 4,463.302 MHz; at low field ν₁₂ → 1.3945 MHz/G, the triplet's precession;
     ν₃₄ → ν₀, which averages the other half out, as in nature, where that half oscillates at ν₀ instead of turning).
   - Its decay: the positron's energy and direction from the Michel distribution with the muon's polarization,
     x²[(3 − 2x) + (2x − 1)·cos θ] (θ from the spin; on average 1 + cos θ / 3), the two neutrinos sharing the rest; in
     the flat game the in-plane angle has that law (what a detector ring in the plane sees). So a ring of detectors
     around a muon sample in a field sees the precession.
   - What it can't make real: muonium in a radical (a muonated radical's hyperfine coupling) precesses here as a
     diamagnetic muon; the electron spin of a muonium that bonds and frees itself again is the one it formed with;
     spin relaxation (nuclear dipoles, collisions) is left out; the muon's chemical shift (ppm) too. */
const MU_GM = 135.5388e6, MU_GE = 28024.951e6, MU_NU0 = 4463.302e6; // (Hz/T, Hz/T, Hz: CODATA 2018)
const MU_IONF = (1 + PHYS.ME / (1.007825 - PHYS.ME)) / (1 + PHYS.ME / (XP['mu+'].m / PHYS.AMU_MEV)); // (Mu's binding over H's: 0.995729)
/* The spin a μ⁺ is given when it is made (u: its direction of flight, or null at rest). */
function muSpinInit(o, u) {
  if (u && Math.hypot(u[0], u[1], u[2] || 0) > 0) { const L = Math.hypot(u[0], u[1], W.d3 ? u[2] || 0 : 0); o.spin = [-u[0] / L, -u[1] / L, W.d3 ? -(u[2] || 0) / L : 0]; }
  else o.spin = W.d3 && W.Bax3 === 'x' ? [0, 1, 0] : [1, 0, 0];
}
/* The muon's precession rate (Hz, signed: positive turns it right-handed about the field's axis) in a field B (T). */
function muRate(p, B) {
  const free = p.k === NUC ? !(p.ne === 1 && !p.bonds.length) : true;
  if (free) return -MU_GM * B;
  const b = Math.abs(B), x = b * (MU_GE + MU_GM) / MU_NU0, nm = (MU_GE - MU_GM) * b / 2, r = Math.sqrt(1 + x * x) * MU_NU0 / 2, sg = B < 0 ? -1 : 1;
  return (p.eSpin > 0 ? MU_NU0 / 2 + nm - r : -(MU_NU0 / 2 - nm + r)) * sg;
}
/* Turn its spin over dt seconds of its own time. */
function muSpinTurn(p, dt) {
  if (!p.spin || !(dt > 0)) return;
  const B = W.d3 ? Bfield3(p.x, p.y, p.z || 0) : Bfield(p.x, p.y, null), f = muRate(p, B);
  if (!f) return;
  const a = 2 * Math.PI * f * dt, c = Math.cos(a), s = Math.sin(a), ax = W.d3 ? W.Bax3 || 'z' : 'z', s0 = p.spin;
  const [i, j] = ax === 'x' ? [1, 2] : ax === 'y' ? [2, 0] : [0, 1], u = s0[i], v = s0[j];
  s0[i] = u * c - v * s; s0[j] = u * s + v * c;
}
/* The decay at rest of a μ⁺ with spin s: [e⁺, νₑ, ν̄μ] four-momenta (MeV) in its rest frame. */
function muSpinDecay(s) {
  const mm = MU_M, me = XA_ME, Wm = (mm * mm + me * me) / (2 * mm), x0 = me / Wm;
  let x = 1; for (let k = 0; k < 200; k++) { const t = x0 + (1 - x0) * rnd(); if (rnd() < t * t * (3 - 2 * t)) { x = t; break; } }
  const P = Math.min(1, Math.hypot(s[0], s[1], W.d3 ? s[2] : 0)), a = P * (2 * x - 1) / (3 - 2 * x);
  let dir;
  if (W.d3) {
    let c = 0; for (let k = 0; k < 200; k++) { c = 2 * rnd() - 1; if (rnd() * (1 + Math.abs(a)) < 1 + a * c) break; }
    const sh = P > 0 ? s.map(v => v / Math.hypot(s[0], s[1], s[2])) : [0, 0, 1], t = Math.abs(sh[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let e1 = [t[1] * sh[2] - t[2] * sh[1], t[2] * sh[0] - t[0] * sh[2], t[0] * sh[1] - t[1] * sh[0]]; const L = Math.hypot(...e1); e1 = e1.map(v => v / L);
    const e2 = [sh[1] * e1[2] - sh[2] * e1[1], sh[2] * e1[0] - sh[0] * e1[2], sh[0] * e1[1] - sh[1] * e1[0]], ph = 2 * Math.PI * rnd(), sn = Math.sqrt(1 - c * c);
    dir = [0, 1, 2].map(i => c * sh[i] + sn * (Math.cos(ph) * e1[i] + Math.sin(ph) * e2[i]));
  } else {
    let ph = 0; for (let k = 0; k < 200; k++) { ph = 2 * Math.PI * rnd(); if (rnd() * (1 + Math.abs(a)) < 1 + a * Math.cos(ph)) break; }
    const s0 = P > 0 ? Math.atan2(s[1], s[0]) : 0; dir = [Math.cos(s0 + ph), Math.sin(s0 + ph)];
  }
  const Ee = x * Wm, pe = Math.sqrt(Math.max(0, Ee * Ee - me * me));
  const e = W.d3 ? [Ee, pe * dir[0], pe * dir[1], pe * dir[2]] : [Ee, pe * dir[0], pe * dir[1]], R = neg4(mm - Ee, e), M = mass4(R);
  const vv = twoBody(M, 0, 0, ...rdir()), b = vel4(R);
  return [e, toLab(vv[0], ...b), toLab(vv[1], ...b)];
}
/* A μ⁺ in W.exo with a spin decays (decayExo, decayExo3): as they do, with the positron from muSpinDecay. */
function muExoDecay(o) {
  const items = XP['mu+'].dec[0][1].map(item), b = o.v / PHYS.C, bx = b * o.ux, by = b * o.uy, bz = W.d3 ? b * o.uz : 0;
  const vs = muSpinDecay(o.spin), S = nucBegin([]);
  o.dead = true;
  const keepTag = _evTag; _evTag = o.ev;
  const made = spawnItems(items, vs.map(v => toLab(v, bx, by, bz, o.gam)), o.x, o.y, o.z || 0);
  _evTag = keepTag;
  closeEvent(S, made, o.x, o.y, o.KE + o.m * MEV, o.m * MEV);
  W.count.decay++;
  const txt = `μ⁺ → ${summarize(items)}`; o.fate = `decayed: ${txt}`;
  flash(o.x, o.y, XP['mu+'].col, 3.5, 0.35, W.d3 ? o.z : undefined);
  tally(items, [], `Decay in flight: ${txt}`);
  nucEvent('pdecay', o.x, o.y, `Decay: ${txt}, the e⁺ along the muon's spin`, [{ x: o.x, y: o.y, k: 'x', rd: 0.12, lbl: o.lab }], `mean life ${fmtTime(XP['mu+'].tau)}${boostTag()}`, undefined, W.d3 ? o.z : 0);
  log('nuc', `Decay: ${txt} (the positron comes out preferentially along the muon's spin)`);
}
/* The switch (ui.js applySettings): with muonium in the box its binding changes (13.598 ↔ 13.540 eV); the difference is
   booked to the heat bath, as the other Experimental models do. Its spins are given when it is made, not here. */
function rpMuSet(on) {
  on = !!on; if (RP.mu === on) return;
  const L = (W.muAtoms || []).filter(p => p && !p.dead && p.mu);
  let E0 = 0; for (const p of L) E0 += internalE(p);
  RP.mu = on;
  let E1 = 0; for (const p of L) E1 += internalE(p);
  if (L.length) { W.ledger.bath += E0 - E1; W.fSpawn = -1; }
}
/* Inspect's words for a muon's spin (ui.js): its direction and its precession here. */
function muSpinInfo(p) {
  if (!p.spin) return null;
  const B = W.d3 ? Bfield3(p.x, p.y, p.z || 0) : Bfield(p.x, p.y, null), f = muRate(p, B), s = p.spin;
  return { s: s.slice(), B, f, free: p.k !== NUC || !(p.ne === 1 && !p.bonds.length), eSpin: p.eSpin || 0 };
}

/* ---- Realistic particles 3: charged particles in matter (1.27; Settings → Experimental → Realistic particles → Charged
   particles in matter: SET.rpCpm → RP.cpm). Off, nothing here runs (one flag test where a fast charged particle passes
   an atom, and where a γ ray meets one). On:
   - Mean loss: Bethe's (PDG eq. 34.5) with each element's mean excitation energy I (NIST/ICRU 37 and 49) and the
     density effect's high-energy form from the electron density along the path (ħω_p = 28.816 √(ρ⟨Z/A⟩) eV); e± by
     Rohrlich and Carlson's formula (ICRU 37). The game's own per-atom loss (0.0047·z²·nₑ/β² weighted by the pass) stands
     where it is larger (slow ions, below Bethe's validity: its calibration there is kept); above, it is scaled up to
     Bethe's (the relativistic rise the game's form lacked: a minimum-ionizing electron lost 1/4 of the real 2 MeV/cm in
     the flat game's water, 1/12 in 3-D). The flat game's liquid water (0.85 e/Å²) stands for real water (0.334 e/Å³):
     CPM_LAM converts its areal densities to volume ones, as positronium's pick-off does.
   - Straggling and δ-rays: of that mean, the share in close collisions (energy transfer T above T_c = max(10 eV, the
     atom's ionization energy) up to T_max) is drawn collision by collision: a Poisson number for each atom passed, T
     from the free-electron (Rutherford) spectrum 1/T² (heavy particles × (1 − β²T/T_max), spin ½), each knocking out an
     electron with T less its binding, at cos θ = (T/p_δ)(E + mₑ)/p (the δ-ray, which flies and ionizes in turn). The
     rest (distant collisions) is given as before. So the loss over a thin layer has Landau's long tail.
   - Bremsstrahlung (e±): at each atom passed, photons with the spectrum (4/3 − 4/3 y + y²)/k (y = k/E, Tsai's complete
     screening, ∝ 1/k), at the rate that makes the radiation length X₀ (PDG eq. 34.26, Tsai's L_rad, L'_rad and the
     Coulomb correction f(Z): lead 6.37 g/cm², water 36.08), below a few tens of MeV scaled down by the unscreened
     cross section's ratio (Heitler's φ_rad: 16/3 slow, 4 ln 2γ − 4/3 relativistic), from k_min = max(100 eV, 10⁻³ T).
   - Cherenkov light: on a path through liquid water (n = 1.333) or silica glass (1.458), faster than c/n, photons of
     300–600 nm at the Frank–Tamm rate 369.8 z²(1 − 1/β²n²) per eV per cm (water at β → 1: 334 a cm), on the cone
     cos θ = 1/βn.
   - γ rays (≥ 100 keV): Compton scattering at the Klein–Nishina total cross section and pair production at the
     Bethe–Heitler one (Maximon's near-threshold and high-energy forms, screening and the Coulomb correction; and the
     triplet in the atom's electrons above 2.04 MeV), against each other as measured, both scaled by the game's light
     (an atom's electrons are met as at the game's Compton odds at 1 MeV: 0.012 an electron within 0.6 Å, about 10⁷
     times nature's, so that light does something in a nanometre). The pair shares the energy by Bethe–Heitler's
     distribution (screened) and flies forward within ~mₑc²/E, not back to back in a random direction.
   What the box can't make real, and how the game handles it: radiation lengths are centimetres (water 36 cm, lead
   0.56 cm), so a 10 nm box holds 10⁻⁶–10⁻⁸ of one: at nature's rates a fast electron almost never radiates there, and
   Cherenkov light (≈ 3×10⁻⁶ photons an ångström) is one photon in thousands of crossings; showers can't develop in the
   box; the γ rays, e± and photons made leave it (counted as escaped). RP.cpmX scales the rare processes (bremsstrahlung
   and Cherenkov light) as the decay speed-up scales decays; it is 1 (nature) except in the checks. */
RP.cpm = false; RP.cpmX = 1;
const CPM_RE = 2.8179403262e-5, CPM_AL = 1 / 137.035999084; // classical electron radius (Å), fine-structure constant
const CPM_K = 2 * Math.PI * CPM_RE * CPM_RE * ME_C2; // 2π r_e² mₑc² = 2.5496×10⁻³ eV·Å² (ξ = CPM_K z² nₑ x / β²)
const CPM_AR2 = CPM_AL * CPM_RE * CPM_RE; // α r_e² = 5.795×10⁻¹² Å² (5.795 mb)
const CPM_LAM = 2.545; // Å: the flat game's water, 0.85 e/Å², stands for real water's 0.334 e/Å³
/* Mean excitation energies (eV): NIST (ICRU 37 and 49) for the elements as I remember them (to be checked); others from
   the usual fit (12Z + 7 below Z = 13, 9.76Z + 58.8 Z^−0.19 above). */
const CPM_I = { 1: 19.2, 2: 41.8, 3: 40, 4: 63.7, 5: 76, 6: 78, 7: 82, 8: 95, 9: 115, 10: 137, 11: 149, 12: 156, 13: 166, 14: 173, 15: 173, 16: 180, 17: 174, 18: 188, 19: 190, 20: 191, 26: 286, 29: 322, 47: 470, 74: 727, 79: 790, 82: 823, 92: 890 };
function cpmI(Z) { return CPM_I[Z] || (Z < 13 ? 12 * Z + 7 : 9.76 * Z + 58.8 * Math.pow(Z, -0.19)); }
/* Tsai's radiation logarithms and the Coulomb correction (PDG eq. 34.26–34.27): [L_rad, L'_rad, f(Z)]. */
const _cpmZ = [];
function cpmZ(Z) {
  let c = _cpmZ[Z]; if (c) return c;
  const a2 = (CPM_AL * Z) ** 2, f = a2 * (1 / (1 + a2) + 0.20206 - 0.0369 * a2 + 0.0083 * a2 * a2 - 0.002 * a2 * a2 * a2);
  const T = { 1: [5.31, 6.144], 2: [4.79, 5.621], 3: [4.74, 5.805], 4: [4.71, 5.924] }[Z];
  c = _cpmZ[Z] = T ? [T[0], T[1], f] : [Math.log(184.15 / Math.cbrt(Z)), Math.log(1194 / Math.cbrt(Z * Z)), f];
  return c;
}
/* An atom's share of 1/X₀ (Å²): 1/X₀ = n · cpmSigX, n atoms a volume; nₑ its electrons (an ion radiates on its nucleus
   with Z², on its electrons with nₑ). */
function cpmSigX(Z, ne) { const c = cpmZ(Z); return 4 * CPM_AR2 * (Z * Z * (c[0] - c[2]) + ne * c[1]); }
/* X₀ in g/cm² of an element (for the checks and Inspect): A / (N_A σ). */
function cpmX0(Z) { return ELEMENTS[Z].mass / (6.02214076e23 * cpmSigX(Z, Z) * 1e-16); }
/* Klein–Nishina total cross section for one electron (Å²); k = E/mₑc². */
function cpmKN(E) {
  const k = E / ME_C2, l = Math.log(1 + 2 * k);
  return 2 * Math.PI * CPM_RE * CPM_RE * ((1 + k) / (k * k) * (2 * (1 + k) / (1 + 2 * k) - l / k) + l / (2 * k) - (1 + 3 * k) / ((1 + 2 * k) * (1 + 2 * k)));
}
const CPM_KN1 = cpmKN(1e6); // (0.2112 b: the game's light is scaled to its Compton odds at 1 MeV)
/* Pair production in the field of a nucleus, Born (Maximon 1968) in units of α r_e² Z²: near threshold (k < 4) and the
   high-energy series above; k = E/mₑc². */
function cpmPairBorn(k) {
  if (k <= 2) return 0;
  if (k < 4) { const e = (2 * k - 4) / (2 + k + 2 * Math.sqrt(2 * k)), r = (k - 2) / k; return 2 * Math.PI / 3 * r * r * r * (1 + e / 2 + 23 / 40 * e * e + 11 / 60 * e ** 3 + 29 / 960 * e ** 4); }
  const L = Math.log(2 * k), q = (2 / k) ** 2;
  return 28 / 9 * L - 218 / 27 + q * (6 * L - 3.5 + 2 / 3 * L ** 3 - L * L - Math.PI * Math.PI / 3 * L + 2 * 1.2020569 + Math.PI * Math.PI / 6) - q * q * (3 / 16 * L + 1 / 8) - q * q * q * (29 / 2304 * L - 77 / 13824);
}
/* Pair cross sections (Å²) on an atom of charge Z with nₑ electrons at photon energy E: [nuclear field, electrons'
   field (triplet)]. The nuclear: Maximon's Born value less the Coulomb correction (Davies, Bethe and Maximon: (28/9) f(Z)
   at high energy, brought in over 2–100 MeV in ln k, as it grows there), at most Tsai's complete-screening value
   (28/9)(L_rad − f) − 2/27. The triplet: from 4mₑc², the nuclear Born value for Z = 1 less 3.23 (the high-energy
   difference of the two, (28/9) ln 2k − 218/27 against − 11.3: Borsellino), at most (28/9) L'_rad − 2/27, an electron. */
function cpmPairSig(Z, ne, E) {
  const k = E / ME_C2; if (k <= 2) return [0, 0];
  const c = cpmZ(Z), b = cpmPairBorn(k), ramp = clamp(Math.log(k / 4) / Math.log(50), 0, 1);
  const nuc = Math.max(0, Math.min(b - 28 / 9 * c[2] * ramp, 28 / 9 * (c[0] - c[2]) - 2 / 27)) * Z * Z * CPM_AR2;
  const tri = k > 4 ? Math.max(0, Math.min(b - 3.23, 28 / 9 * c[1] - 2 / 27)) * ne * CPM_AR2 : 0;
  return [nuc, tri];
}
/* The projectile of the path being worked (set by cpmSeg, read by cpmAtom). */
const CPM = { K: 0, mc2: 0, z: 1, e: 0, b2: 0, bg: 0, g: 1, Tmax: 0, Lg: 1, A: 1, rho: 0, ux: 1, uy: 0, uz: 0, d3: false, n: 0 };
/* The path of a particle of kinetic energy K, rest energy mc2 (eV), charge z, e = −1 an electron, +1 a positron, 0 heavy,
   along (ux, uy, uz), its length len and its middle (xm, ym, zm); R the reach within which it meets atoms. */
function cpmSeg(o, K, mc2, z, e, ux, uy, uz, len, xm, ym, zm, R, d3) {
  const C = CPM, g = 1 + K / mc2, b2 = Math.max(1e-10, 1 - 1 / (g * g));
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1; // (its way as a unit vector: the pushes and the photons' cones are measured from it)
  C.K = K; C.mc2 = mc2; C.z = z; C.e = e; C.g = g; C.b2 = b2; C.bg = Math.sqrt(b2) * g; C.ux = ux / ul; C.uy = uy / ul; C.uz = uz / ul; C.d3 = d3;
  C.Tmax = e < 0 ? K / 2 : e > 0 ? K : 2 * ME_C2 * b2 * g * g / (1 + 2 * g * ME_C2 / mc2 + (ME_C2 / mc2) ** 2);
  C.A = d3 ? Math.PI * R * R : 2 * R * CPM_LAM; // (the cross-section of the tube of atoms counted as passed, Å²; flat: its width times CPM_LAM)
  C.Lg = 0.0047 * (d3 ? Math.PI * 0.16 * Math.log(1 + R * R / 0.16) : 0.8 * Math.atan(R / 0.4) * CPM_LAM) / CPM_K; // (the game's form as a Bethe logarithm: 4.5 flat, 1.8 in 3-D for R = 1 Å)
  const E = cpmEnv(o, xm, ym, zm, d3); C.rho = E.rho; C.n = E.n;
}
/* What surrounds the path's middle, within 4 Å (looked at again once the particle has moved 2 Å): the electron density
   (e/Å³; the flat game's over CPM_LAM), and the refractive index if it is a dense transparent medium by what it is made
   of (molecules the track ionized are still water): liquid water 1.333, silica glass 1.458 (at 589 nm; dispersion left
   out), at least 40% of liquid water's atom density (0.1 atoms/Å³); else 0 (no Cherenkov light: metals, organic
   liquids, gases). */
const CPM_ENV_R = 4;
function cpmEnv(o, x, y, z, d3) {
  const e = o.cpmE;
  if (e && Math.abs(x - e.x) + Math.abs(y - e.y) + Math.abs(z - e.z) < 2 && e.s === W.step) return e;
  let na = 0, ne = 0, nh = 0, no = 0, ns = 0;
  nearby(x, y, CPM_ENV_R, (a) => { if (a.dead || a.k !== NUC || a.Z === 0) return; na++; ne += Math.max(0, a.ne); if (a.Z === 1) nh++; else if (a.Z === 8) no++; else if (a.Z === 14) ns++; }, z);
  const V = d3 ? 4 / 3 * Math.PI * CPM_ENV_R ** 3 : Math.PI * CPM_ENV_R * CPM_ENV_R * CPM_LAM;
  let n = 0;
  if (na / V > 0.04) {
    if (nh + no > 0.9 * na && nh > no && ns < 0.05 * na) n = 1.333;
    else if (ns + no > 0.9 * na && ns > 0.2 * (ns + no)) n = 1.458;
  }
  const r = { x, y, z, s: W.step, rho: ne / V, n };
  if (o) o.cpmE = r;
  return r;
}
/* Bethe's logarithm for an atom of mean excitation I (with the density effect), the bracket of dE/dx = K z² nₑ/β² · L. */
function cpmL(I) {
  const C = CPM, hw = 28.816 * Math.sqrt(1.66054 * C.rho);
  const d = hw > 0 ? Math.max(0, 2 * Math.log(C.bg) + 2 * Math.log(hw / I) - 1) : 0;
  if (C.e === 0) return Math.log(2 * ME_C2 * C.bg * C.bg * C.Tmax / (I * I)) - 2 * C.b2 - d;
  const t = C.K / ME_C2, t2 = t + 2;
  const F = C.e < 0 ? 1 - C.b2 + (t * t / 8 - (2 * t + 1) * Math.LN2) / ((t + 1) * (t + 1)) : 2 * Math.LN2 - C.b2 / 12 * (23 + 14 / t2 + 10 / (t2 * t2) + 4 / (t2 * t2 * t2));
  return Math.log(t * t * t2 / (2 * (I / ME_C2) ** 2)) + F - d;
}
/* (x, y, z) turned from u by θ at azimuth φ (3-D), or by ±θ in the plane (flat: φ < π one way): into _cpmU. */
const _cpmU = [0, 0, 0];
function cpmTurn(ux, uy, uz, th, ph) {
  const c = Math.cos(th), s = Math.sin(th);
  if (!CPM.d3) { const sg = ph < Math.PI ? 1 : -1; _cpmU[0] = ux * c - sg * uy * s; _cpmU[1] = sg * ux * s + uy * c; _cpmU[2] = 0; return _cpmU; }
  let ax = 0, ay = 0; if (Math.abs(ux) < 0.9) ax = 1; else ay = 1;
  let e1x = uy * 0 - uz * ay, e1y = uz * ax - ux * 0, e1z = ux * ay - uy * ax; const l1 = Math.hypot(e1x, e1y, e1z); e1x /= l1; e1y /= l1; e1z /= l1;
  const e2x = uy * e1z - uz * e1y, e2y = uz * e1x - ux * e1z, e2z = ux * e1y - uy * e1x, cp = Math.cos(ph), sp = Math.sin(ph);
  _cpmU[0] = c * ux + s * (cp * e1x + sp * e2x); _cpmU[1] = c * uy + s * (cp * e1y + sp * e2y); _cpmU[2] = c * uz + s * (cp * e1z + sp * e2z);
  return _cpmU;
}
function cpmPoisson(nu) { if (!(nu > 0)) return 0; if (nu > 30) return Math.max(0, Math.round(nu + Math.sqrt(nu) * gauss())); let k = 0, p = rnd(); const L = Math.exp(-nu); while (p > L) { k++; p *= rnd(); } return k; }
/* One atom passed at impact parameter b, where the game's own loss would be dEg (uncapped), at (x, y, z): the mean loss
   (Bethe's or the game's, the larger), split into the distant collisions (given as before: an electron set free square to
   the path, or a push) and the close ones (δ-rays, drawn); bremsstrahlung for e±. Takes it all from CPM.K; returns the
   energy taken. */
function cpmAtom(tg, b, dEg, x, y, z) {
  const C = CPM, K0 = C.K;
  if (C.e !== 0 && C.K > 2e3) cpmBrems(tg, x, y, z);
  if (tg.ne <= 0 || tg.dead || tg.rad || tg.fast || C.K <= 1) return K0 - C.K; // (an atom itself in flight is not ionized here, as 3-D's fastStop3 leaves it: in radiation flight its energy is its stored KE, which a push on its velocity would miss, and a ballistic one carries no potential energy for the new ion's pull)
  const L = cpmL(cpmI(tg.Z)), dEm = dEg * Math.max(1, L / C.Lg);
  const ie0 = ionizationCost(tg), Tc = Math.max(10, ie0 + 1), Tm = Math.min(C.Tmax, C.K - 1);
  let f = 0, mT = 0;
  if (Tm > Tc * 1.0001) {
    const lr = Math.log(Tm / Tc), H = lr - (C.e === 0 ? C.b2 * (Tm - Tc) / C.Tmax : 0); // (∫ T dN and ∫ dN over T_c … T_m of (1/T²)(1 − β²T/T_max))
    f = clamp(H / Math.max(L, C.Lg, H + 0.5), 0, 0.95); mT = H / (1 / Tc - 1 / Tm - (C.e === 0 ? C.b2 * lr / C.Tmax : 0));
  }
  const soft = Math.min(0.3 * C.K, (1 - f) * dEm);
  if (soft >= 0.01) { // (the distant collisions, as the game gives them)
    C.K -= soft;
    const n = C.d3 ? turn3(C.ux, C.uy, C.uz, Math.PI / 2) : null, nx = n ? n[0] : -C.uy * (rnd() < 0.5 ? 1 : -1), ny = n ? n[1] : (nx === -C.uy ? C.ux : -C.ux), nz = n ? n[2] : 0;
    if (soft > ie0 && freeElectronCount() < MAX_FREE_E && W.parts.length < MAX_PARTS) { if (ejectElectron(tg, soft - ie0, nx, ny, undefined, undefined, nz)) W.count.ionize++; else dumpHeat(soft, tg, tg); }
    else { const vn = tg.vx * nx + tg.vy * ny + (C.d3 ? tg.vz * nz : 0), a = -vn + Math.sqrt(vn * vn + 2 * soft * tg.im); tg.vx += nx * a; tg.vy += ny * a; if (C.d3) tg.vz += nz * a; updateFast(tg); }
  }
  if (f > 0 && mT > 0) { // (the close collisions: a Poisson number, each a δ-ray)
    let n = cpmPoisson(f * dEm / mT);
    const Et = C.K + C.mc2, p = Math.sqrt(C.K * (C.K + 2 * C.mc2));
    while (n-- > 0 && tg.ne > 0 && !tg.dead) {
      let T = Tc;
      for (let k = 0; k < 20; k++) { T = Tc * Tm / (Tm - rnd() * (Tm - Tc)); if (C.e !== 0 || rnd() < 1 - C.b2 * T / C.Tmax) break; }
      const ie = ionizationCost(tg);
      if (!(T < C.K - 1) || T <= ie || freeElectronCount() >= MAX_FREE_E || W.parts.length >= MAX_PARTS) continue;
      const ct = Math.min(1, T / Math.sqrt(T * (T + 2 * ME_C2)) * (Et + ME_C2) / p), u = cpmTurn(C.ux, C.uy, C.uz, Math.acos(ct), rnd() * 2 * Math.PI);
      C.K -= T;
      if (ejectElectron(tg, T - ie, u[0], u[1], undefined, undefined, u[2])) { W.count.ionize++; W.count.cpmDelta = (W.count.cpmDelta || 0) + 1; } else dumpHeat(T, tg, tg);
    }
  }
  return K0 - C.K;
}
/* Bremsstrahlung at one atom passed (the tube's cross-section C.A): a photon with the chance σ_X · s · F / A, F the
   spectrum's integral from k_min to T; its energy from (4/3 − 4/3 y + y²)/y; within ~1/γ of the electron's way. */
function cpmBrems(tg, x, y, z) {
  const C = CPM, T = C.K, E = T + ME_C2, kmin = Math.max(100, 1e-3 * T);
  if (!(T > kmin * 1.01)) return;
  const y0 = kmin / E, y1 = T / E, F = 4 / 3 * Math.log(y1 / y0) - 4 / 3 * (y1 - y0) + (y1 * y1 - y0 * y0) / 2;
  const c = cpmZ(tg.Z), s = Math.min(1, Math.max(16 / 3, 4 * Math.log(2 * C.g) - 4 / 3) / (4 * c[0] + 2 / 9));
  if (!(rnd() < RP.cpmX * cpmSigX(tg.Z, Math.max(0, tg.ne)) * s * F / C.A)) return;
  let yk = y0;
  for (let i = 0; i < 50; i++) { yk = y0 * Math.pow(y1 / y0, rnd()); if (rnd() < 1 - yk + 0.75 * yk * yk) break; }
  const k = Math.min(T - 1, yk * E), u = cpmTurn(C.ux, C.uy, C.uz, Math.abs(gauss()) / C.g, rnd() * 2 * Math.PI);
  C.K -= k; W.count.cpmBrems = (W.count.cpmBrems || 0) + 1;
  emitPhoton(x, y, k, u[0], u[1], C.d3 ? { src: tg, uz: u[2], z } : { src: tg });
}
/* Cherenkov light along the path just worked (length len from (x0, y0, z0)): in water or glass and faster than c/n, a
   Poisson number of photons of 300–600 nm (2.066–4.133 eV, flat in energy) on the cone cos θ = 1/βn. Returns the energy
   taken from CPM.K. */
const CPM_CK0 = PHYS.HC / 600, CPM_CK1 = PHYS.HC / 300;
function cpmCkv(x0, y0, z0, len) {
  const C = CPM; if (!C.n || !(len > 0)) return 0;
  const bn = Math.sqrt(C.b2) * C.n; if (!(bn > 1)) return 0;
  let n = cpmPoisson(RP.cpmX * 369.81 * C.z * C.z * (1 - 1 / (bn * bn)) * (CPM_CK1 - CPM_CK0) * len * 1e-8);
  const th = Math.acos(1 / bn), K0 = C.K;
  while (n-- > 0) {
    const k = CPM_CK0 + rnd() * (CPM_CK1 - CPM_CK0), s = rnd() * len, u = cpmTurn(C.ux, C.uy, C.uz, th, rnd() * 2 * Math.PI);
    if (!(k < C.K - 1)) break;
    C.K -= k; W.count.cpmCkv = (W.count.cpmCkv || 0) + 1;
    emitPhoton(x0 + C.ux * s, y0 + C.uy * s, k, u[0], u[1], C.d3 ? { uz: u[2], z: z0 + C.uz * s } : undefined);
  }
  return K0 - C.K;
}
/* A γ ray (E ≥ 100 keV) at atom p, with the switch on: what it does there by the measured cross sections, scaled as the
   game's light (CPM_KN1). 0 nothing, 1 a pair (nuclear field), 2 a triplet, 3 Compton scattering. The giant dipole
   resonance is tried before, as before. */
function cpmGamma(p, E) {
  if (E > 2 * ME_C2) {
    const s = cpmPairSig(p.Z, Math.max(0, p.ne), E), P = 0.012 * (s[0] + s[1]) / CPM_KN1;
    if (P > 0 && rnd() < P) return rnd() * (s[0] + s[1]) < s[0] ? 1 : 2;
  }
  if (p.ne > 0 && rnd() < 0.012 * p.ne * cpmKN(E) / CPM_KN1) return 3;
  return 0;
}
/* The pair's energy share: ε, the electron's fraction of E (Bethe–Heitler with screening, sampled as Geant4's
   G4BetheHeitlerModel does from Butcher and Messel's screening functions; uniform below 2 MeV). */
function cpmShare(Z, E) {
  const e0 = ME_C2 / E;
  if (E < 2e6) return e0 + (0.5 - e0) * rnd();
  const z3 = Math.cbrt(Z), FZ = 8 * (Math.log(Z) / 3 + (E > 5e7 ? cpmZ(Z)[2] : 0)), sf = 136 * e0 / z3;
  const S1 = (d) => d > 1 ? 42.24 - 8.368 * Math.log(d + 0.952) : 42.392 - d * (7.796 - 1.961 * d), S2 = (d) => d > 1 ? 42.24 - 8.368 * Math.log(d + 0.952) : 41.405 - d * (5.828 - 0.8945 * d);
  const smax = Math.exp((42.24 - FZ) / 8.368) - 0.952, smin = Math.min(4 * sf, smax), e1 = 0.5 - 0.5 * Math.sqrt(Math.max(0, 1 - smin / smax));
  const emin = Math.max(e0, e1), er = 0.5 - emin, F10 = S1(smin) - FZ, F20 = S2(smin) - FZ, N1 = Math.max(F10 * er * er, 0), N2 = Math.max(1.5 * F20, 0);
  let eps = 0.5;
  for (let i = 0; i < 100; i++) {
    let g;
    if (N1 / (N1 + N2) > rnd()) { eps = 0.5 - er * Math.cbrt(rnd()); g = (S1(sf / (eps * (1 - eps))) - FZ) / F10; }
    else { eps = emin + er * rnd(); g = (S2(sf / (eps * (1 - eps))) - FZ) / F20; }
    if (g >= rnd()) break;
  }
  return rnd() < 0.5 ? eps : 1 - eps;
}
/* The angle of a pair member of total energy Et from the photon's way (Urban's form of Tsai's distribution, Geant4). */
function cpmPairTh(Et) { const u = -Math.log(rnd() * rnd()) / (rnd() < 0.25 ? 0.625 : 1.875); return Math.min(Math.PI, u * ME_C2 / Et); }
/* A pair made by a γ ray of energy E going (ux, uy, uz) at atom p (trip: in an electron's field, the triplet, which sets
   that electron free too). Flat and 3-D; the books as pairProduce's / pairProduce3's: the pair's kinetic energy is
   exactly E − 2mₑc² (less the triplet electron's share, given it by ejectElectron with its binding). */
function cpmPair(p, E, ux, uy, uz, trip) {
  if (W.parts.length > MAX_PARTS || p.dead) return;
  CPM.d3 = !!W.d3;
  let avail = E - 2 * ME_C2, Te = 0;
  if (trip && p.ne > 0) { // (the recoil electron: 1/T² from 1 keV to a third of what is left; its direction as a free electron's struck by the photon)
    const hi = avail / 3, lo = Math.min(1e3, hi / 2); Te = lo * hi / (hi - rnd() * (hi - lo));
    if (!(Te - ionizationCost(p) > 0.05) || freeElectronCount() >= MAX_FREE_E) Te = 0; else avail -= Te;
  }
  const eps = cpmShare(p.Z, E), Tm = Math.max(1, (eps * E - ME_C2) / (E - 2 * ME_C2) * avail), Tp = Math.max(1, avail - Tm);
  const ph = rnd() * 2 * Math.PI, a = cpmTurn(ux, uy, uz || 0, cpmPairTh(Tm + ME_C2), ph), ex = a[0], ey = a[1], ez = a[2];
  const b = cpmTurn(ux, uy, uz || 0, cpmPairTh(Tp + ME_C2), (ph + Math.PI) % (2 * Math.PI)), px = b[0], py = b[1], pz = b[2];
  const o = cpmTurn(ux, uy, uz || 0, Math.PI / 2, ph), ox = o[0], oy = o[1], oz = o[2]; // (the two start 0.4 Å apart across the photon's way)
  const S = nucBegin([]); // (the books as pairProduce3's, flat too: a slow member (Bethe–Heitler gives one most of the energy now and then) is stepped with its potential energy beside the nucleus, which settleKE pays exactly)
  const e = addLepton(ELEC, p.x + 0.2 * ox, p.y + 0.2 * oy, 0, 0, (p.z || 0) + 0.2 * oz); setMotion(e, Tm, ex, ey, 0, 0, ez);
  const ps = addLepton(POS, p.x - 0.2 * ox, p.y - 0.2 * oy, 0, 0, (p.z || 0) - 0.2 * oz); setMotion(ps, Tp, px, py, 0, 0, pz);
  W.ledger.nuc -= 2 * ME_C2;
  settleKE(S, avail, [e, ps]);
  if (Te > 0) {
    const ct = Math.min(1, Te / Math.sqrt(Te * (Te + 2 * ME_C2)) * (E + ME_C2) / E), u = cpmTurn(ux, uy, uz || 0, Math.acos(ct), rnd() * 2 * Math.PI);
    if (ejectElectron(p, Te - ionizationCost(p), u[0], u[1], undefined, undefined, u[2])) W.count.ionize++; else dumpHeat(Te, p, p);
  }
  W.count.cpmPair = (W.count.cpmPair || 0) + 1;
  const what = Te > 0 ? 'e⁻ + e⁺ + e⁻ (triplet: in an electron’s field)' : 'e⁻ + e⁺';
  log('nuc', `Pair production: γ (${fmtE(E)}) → ${what} near ${speciesLabel(p)}: ${fmtE(Tm)} and ${fmtE(Tp)}, forward`);
  nucEvent('pair', p.x, p.y, `Pair production: γ → ${what}`, [], `${fmtE(E)} γ ray`, undefined, W.d3 ? p.z : undefined);
}

/* ---- making the products, and the books */
const MAX_EXO = 1500;
/* Products at (x, y): items with their lab four-momenta. Nuclei, nucleons and leptons join W.parts, unstable particles
   W.exo; photons and neutrinos wait in made.rays to be sent off last with what the books leave them. */
function spawnItems(items, moms, x, y, z = 0) {
  if (W.d3) return spawnItems3(items, moms, x, y, z); // (3-D: four-momenta with pz, at the depth z, 1.25)
  const made = { ps: [], xs: [], rays: [], lost: 0 };
  for (let i = 0; i < items.length; i++) {
    const it = items[i], P = moms[i], m = massOf(it), pm = Math.hypot(P[1], P[2]);
    let ux, uy;
    if (pm > 1e-12) { ux = P[1] / pm; uy = P[2] / pm; } else [ux, uy] = rdir();
    const K = Math.max(0, P[0] - m) * MEV, ox = x + ux * 0.08, oy = y + uy * 0.08;
    if (it.t === 'g' || it.t === 'v') { made.rays.push([it, P[0] * MEV, ux, uy]); continue; }
    if (it.t === 'x' ? W.exo.length >= MAX_EXO : W.parts.length >= MAX_PARTS) { made.lost += P[0] * MEV; continue; } // (no room: carried off, as if it had left)
    if (it.Z > Z_MAX) { made.lost += P[0] * MEV; continue; } // (a last guard: nothing past the last element is made)
    if (it.t === 'x' && it.sp === 'Mu') { const q = addMuonium(ox, oy, K, ux, uy); made.ps.push(q); continue; } // (1.12: muonium is an atom, in MD)
    if (it.t === 'x') { const o = addExo(it.sp, ox, oy, K, ux, uy, it.m); made.xs.push(o); pairNote(o); continue; }
    const q = it.t === 'e' ? addLepton(it.q < 0 ? ELEC : POS, ox, oy) : addNuc(it.Z, it.N, it.ne || 0, ox, oy, 0, 0, it.anti); // (ne: electrons it keeps, keepElectrons)
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
    if (made.z3 !== undefined) { // (3-D: along their directions in depth, 1.24)
      for (const [it, E, ux, uy, uz] of made.rays) { if (it.t === 'g') emitPhoton(x, y, E * f, ux, uy, { z: made.z3, uz }); else emitNeutrino(x, y, E * f, ux, uy, !!it.anti, undefined, it.fl || 'e', made.z3, uz); }
      if (!(Er > 0) && left > 0) emitPhoton(x, y, left, undefined, undefined, { z: made.z3 });
    } else {
    for (const [it, E, ux, uy] of made.rays) { if (it.t === 'g') emitPhoton(x, y, E * f, ux, uy); else emitNeutrino(x, y, E * f, ux, uy, !!it.anti, undefined, it.fl || 'e'); }
    if (!(Er > 0) && left > 0) emitPhoton(x, y, left);
    }
  } else if (Math.abs(left) > Math.min(1e-7 * Math.max(1, Math.abs(Qrel)), Math.max(0.01, 1e-15 * Math.abs(Qrel)))) settleRest(S, Qrel, made, left); // (past 100 keV the remainder is settled down to 0.01 eV (or the books' own rounding): 10⁻⁷ of a 100 TeV hit left 0.1–0.2 MeV unsettled, from boosts at γ in the hundreds; below, as before, 1.26)
}
function settleRest(S, Qrel, made, left) {
  if (made.ps.length) for (let k = 0; k < 3 && Math.abs(left) > 1e-6; k++) { shareKE(made.ps, left); left = nucLeft(S, Qrel); }
  for (let k = 0; k < 3 && Math.abs(left) > 1e-6 && made.ps.length; k++) { // (shareKE moves energy only between the products, about their centre of mass: one product alone (a hit whose other products are unstable, or a nucleon from a nucleon–nucleon pass) kept the remainder, up to 0.25 MeV a hit in a 1 PeV event's debris; the fastest product takes it itself, 1.26)
    let q = null; for (const p of made.ps) if (!p.dead && (!q || keOf(p) > keOf(q))) q = p;
    const K = q ? keOf(q) : 0; if (!(K > 0) || !(K + left > 0)) break;
    if (q.rad) { q.KE = K + left; radSpeed(q); q.vx = q.sp * q.ux; q.vy = q.sp * q.uy; } else { const f = Math.sqrt((K + left) / K); if (W.d3) { q.vx *= f; q.vy *= f; q.vz *= f; updateFast(q); } else setVel(q, q.vx * f, q.vy * f); } // (flat: setVel, into radiation flight past its threshold)
    left = nucLeft(S, Qrel);
  }
  if (Math.abs(left) > 1e-6 && !made.ps.length && !made.xs.length && made.lost > 0) { W.ledger.escaped += left; return 0; } // (every product carried off (antinucleons in 3-D, no room): they take the remainder with them, 1.26)
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
function addExo(sp, x, y, KE, ux, uy, m, z = 0, uz = 0) { // (z, uz: 3-D, 1.24)
  const d = XP[sp];
  const o = { id: W.nextId++, sp, lab: d.lab, m: m || d.m, ev: _evTag, q: d.q, x, y, ux, uy, KE: Math.max(0, KE), gam: 1, v: 0, born: W.rt, bx0: x, by0: y, dead: false, trk: null };
  if (W.d3) { const L = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1; o.ux = ux / L; o.uy = uy / L; o.uz = uz / L; o.z = z; o.bz0 = z; }
  exoSpeed(o);
  o.trk = { pts: [x, y], ts: [W.rt], tt: [W.t], c: d.col, w: d.q ? 1.4 : 1.1, t0: W.rt, upd: W.rt, dash: !d.q };
  if (W.d3) o.trk.pz = [z];
  keepTrack(o.trk);
  W.exo.push(o);
  if (sp === 'mu+' && RP.mu) muSpinInit(o, KE >= 1 ? [o.ux, o.uy, o.uz || 0] : null); // (Muonium as hydrogen: its spin, for μSR, 1.27)
  return o;
}
function exoSpeed(o) { const g = 1 + o.KE / (o.m * MEV); o.gam = g; o.v = PHYS.C * Math.sqrt(Math.max(0, 1 - 1 / (g * g))); }
/* Lab › Time › "Let the shortest-lived show" (W.minShow 1 or 2): a particle that would decay before it is seen (a
   resonance within a proton's width, a π⁰ or Σ⁰ within nanometres) is held until it has flown a few ångströms or a
   moment of watching has passed, whichever comes first; then it decays as it would have. Its products, and so every
   tally, are the same; only where the decay happens moves, and that is shown while it is on. */
const MIN_SHOW = [null, { d: 2, t: 0.4 }, { d: 6, t: 1.2 }];
function exoHeld(o) {
  const m = MIN_SHOW[W.minShow | 0];
  return !!m && W.rt - o.born < m.t && Math.hypot(o.x - o.bx0, o.y - o.by0) < m.d;
}
function moveExos(dt, id0) {
  if (W.d3) return moveExos3(dt, id0); // (3-D, 1.24)
  if (W.muBound && W.muBound.length) muBoundTick(dt);
  if (W.muAtoms && W.muAtoms.length) muoniumTick(dt);
  for (let i = 0; i < W.exo.length; i++) { const o = W.exo[i]; if (!o.dead && XP[o.sp].res && !W.ultra && !deepSlow()) { if (exoHeld(o)) o.wait = true; else decayExo(o); } } // (resonances: gone within a proton's width, whatever the decay clock)
  const n0 = W.exo.length;
  if (!n0) return 0;
  let nXb = 0;
  const clock = W.decayOn ? dt * PHYS.TU_S * W.warp : 0, hw = W.box.w / 2, hh = W.box.h / 2; // (proper seconds per lab second: 1/γ)
  for (let i = 0; i < n0; i++) {
    const o = W.exo[i];
    if (o.dead || (id0 !== undefined && o.id >= id0)) continue; // (born this step: it flies from the next one, which slow motion and the step chooser have shortened for it)
    let h = dt, dec = false;
    if (clock > 0) {
      const tl = XP[o.sp].tau * o.gam, P = 1 - Math.exp(-clock / tl);
      if (rnd() < P) { dec = true; h = dt * Math.min(1, -Math.log(1 - rnd() * P) * tl / clock); } // when in the step it goes
    }
    const d = XP[o.sp], x0 = o.x, y0 = o.y;
    if (dec && exoHeld(o)) { dec = false; h = dt; o.wait = true; } // (held to be seen: it flies the whole step, and may decay in a later one)
    if (o.xb) { moveExoBeam(o, h); nXb++; } else flyExo(o, h);
    if (W.objs.length && !o.xb && objExo(o, x0, y0)) continue; // (placed objects: props.js)
    if (o.wait && (o.x < -hw || o.x > hw || o.y < -hh || o.y > hh)) { o.x = clamp(o.x, -hw, hw); o.y = clamp(o.y, -hh, hh); dec = true; } // (one held back that reaches the wall decays there: it would have inside)
    if (d.res && !dec && !W.ultra && !deepSlow()) continue; // (a held resonance: only flies) (ultra-realistic: resonances fly and decay on the clock, with their own mean lives, ħ/Γ)
    if (o.x < -hw || o.x > hw || o.y < -hh || o.y > hh) {
      const kept = d.atom || d.hyp || d.muonium || d.ps || ((o.sp === 'mu-' || o.sp === 'mu+' || o.sp === 'K-' || H_STOP.has(o.sp)) && o.KE < 2 * MU_STOP);
      if (kept && W.wall === 'wrap') { if (Math.abs(o.x) > hw) o.x -= Math.sign(o.x) * 2 * hw; if (Math.abs(o.y) > hh) o.y -= Math.sign(o.y) * 2 * hh; } // (a periodic box: across, as atoms go (the trail is drawn across the edge as theirs is); muonic hydrogen left the box there, its energy escaped, 1.26 bug fix)
      else if (!(kept && W.wall === 'reflect')) { exoLeaves(o); continue; } // (a slow muon would stop in the wall's matter: kept in instead)
      else if (Math.abs(o.x) > hw) { o.x = Math.sign(o.x) * (2 * hw - Math.abs(o.x)); o.ux = -o.ux; } // (muonic hydrogen, slow and neutral, bounces off the walls as atoms do)
      if (Math.abs(o.y) > hh) { o.y = Math.sign(o.y) * (2 * hh - Math.abs(o.y)); o.uy = -o.uy; }
    }
    if (d.ps && !dec && clock > 0 && psMatter(o, clock)) continue; // (positronium in matter: pick-off, spin conversion, 1.27)
    if (o.spin && RP.mu) muSpinTurn(o, clock * h / dt / o.gam); // (μSR: the μ⁺'s spin precesses, in its own time, up to its decay, 1.27)
    if (dec) { if (d.hyp) hypDecay(o); else decayExo(o); continue; }
    if (o.xb) { if (o.caught && !inDetector(W.collider || {}, o.x, o.y)) { o.fate = 'stopped in the detector'; exoLeaves(o, 'qObj'); } continue; } // (a beam's: in the ring's vacuum; thrown out of the beam, the detector stops it)
    const xa = RP.exo && XA_SPS.has(o.sp);
    if (xa) { if (xaStep(o)) continue; } // (the realistic-particle switch: caught at tens of eV into an orbit, 1.27)
    else {
    if (o.sp === 'mu-' && o.KE < MU_STOP && muStop(o)) continue;
    if (o.sp === 'K-' && o.KE < MU_STOP && kStop(o)) continue;
    if (H_STOP.has(o.sp) && o.KE < MU_STOP && hStop(o)) continue;
    }
    if (o.sp === 'mu+' && o.KE < MU_STOP && !o.muTried && muoniumForm(o)) continue;
    if (d.strong === undefined) d.strong = strongExo(o.sp);
    if (d.strong && !(xa && o.KE < MU_STOP) && exoHits(o, x0, y0)) continue; // (slowing on below 2 keV to its capture, 1.27: no nuclear hits at the enlarged reach, 0.35 Å, which would end most pions and kaons on the way; at the nucleus's true size a slow one meets a nucleus in flight about once in 10⁹)
    if (d.atom) muAtomScatter(o, x0, y0);
    if (d.atom && clock > 0) muAtomTick(o, clock);
    if (RP.exo && d.atom && !o.dead && clock > 0) xaTransfer(o, clock); // (its muon to a heavier atom beside it, 1.27)
  }
  if (W.step % 8 === 0 || W.exo.length > MAX_EXO) { let j = 0; for (const o of W.exo) if (!o.dead) W.exo[j++] = o; W.exo.length = j; }
  return nXb;
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
  exoTrack(o);
  if (o.q && o.v > 0) exoIonize(o, x0, y0); // (charged: it ionizes what it passes, and slows)
  if (o.q && o.v > 0 && !o.dead) exoScatter(o, x0, y0); // (and is turned a little by every nucleus it passes, 1.15)
}
function exoTrack(o) {
  const t = o.trk, n = t.pts.length;
  if (t.pz) { if (Math.abs(t.pts[n - 2] - o.x) + Math.abs(t.pts[n - 1] - o.y) + Math.abs(t.pz[t.pz.length - 1] - o.z) > 0.4) { t.pts.push(o.x, o.y); t.pz.push(o.z); if (t.ts) { t.ts.push(W.rt); t.tt.push(W.t); } if (t.pts.length > 800) trkThin(t); } t.upd = W.rt; return; } // (3-D, 1.24)
  if (Math.abs(t.pts[n - 2] - o.x) + Math.abs(t.pts[n - 1] - o.y) > 0.4) { t.pts.push(o.x, o.y); if (t.ts) { t.ts.push(W.rt); t.tt.push(W.t); } if (t.pts.length > 800) trkThin(t); }
  t.upd = W.rt;
}
/* ---- 3-D (1.24; the owner: "the rest of the particles in 3-D, like pions and such"). Unstable particles (pions, kaons,
   muons, hyperons …) fly in depth (o.z, o.uz): straight, or turned about the magnetic field's axis (B3U, as the flat
   flight turns them about z); they ionize the atoms they pass and are scattered by their nuclei along a line in 3-D
   (exoIonize3, exoScatter3, the flat game's rules); they leave through the six faces, and decay in flight or at rest.
   Since 1.25 every event works on four-momenta [E, px, py, pz] in a 3-D world (the helpers at the top of this file take
   either length): a decay's products from 3-D phase space (phaseSpace3, GENBOD with its weights; 1.24 turned the flat
   phase space's plane to a random orientation), boosted to the lab (boost3), so energy and momentum are kept exactly in
   three directions and a decay at rest is isotropic. The nuclear side as in the flat game (1.25): a stopped μ⁻ makes a
   muonic atom (muonic hydrogen flies, scatters, moves to heavier isotopes and fuses; in a heavier atom it decays in orbit
   or is captured by the nucleus), a stopped K⁻, π⁻, Σ⁻, Ξ⁻ or Ω⁻ is absorbed by a nucleus (a nuclear star, sometimes a
   hypernucleus), a slow μ⁺ may take an electron (muonium, an atom in MD), and strongly interacting particles meet the
   nuclei on their path (hadronHit, exoHits3). */
const B3U = { x: ['uy', 'uz'], y: ['uz', 'ux'], z: ['ux', 'uy'] };
function boost3(E, px, py, pz, bx, by, bz, g0) { // (g0: as boost's, 1.26)
  const b2 = bx * bx + by * by + bz * bz;
  if (!(b2 > 1e-30)) return [E, px, py, pz];
  const g = g0 && b2 > 0.9999 ? g0 : 1 / Math.sqrt(1 - b2), bp = bx * px + by * py + bz * pz, k = ((g - 1) * bp / b2 - g * E);
  return [g * (E - bp), px + k * bx, py + k * by, pz + k * bz];
}
/* spawnItems with four-momenta [E, px, py, pz] at (x, y, z). */
function spawnItems3(items, moms, x, y, z) {
  const made = { ps: [], xs: [], rays: [], lost: 0, z3: z };
  for (let i = 0; i < items.length; i++) {
    const it = items[i], P = moms[i], m = massOf(it);
    if (P.length < 4) { PS3.flat++; P[3] = 0; } // (a flat four-momentum reaching the 3-D world: a path not yet in 3-D; counted for the tests, 1.25)
    const pm = Math.sqrt(P[1] * P[1] + P[2] * P[2] + P[3] * P[3]);
    let ux, uy, uz;
    if (pm > 1e-12) { ux = P[1] / pm; uy = P[2] / pm; uz = P[3] / pm; } else { const u = rndDir(); ux = u[0]; uy = u[1]; uz = u[2]; }
    const K = Math.max(0, P[0] - m) * MEV, ox = x + ux * 0.08, oy = y + uy * 0.08, oz = z + uz * 0.08;
    if (it.t === 'g' || it.t === 'v') { made.rays.push([it, P[0] * MEV, ux, uy, uz]); continue; }
    if (it.t === 'x' ? W.exo.length >= MAX_EXO : W.parts.length >= MAX_PARTS) { made.lost += P[0] * MEV; continue; }
    if (it.Z > Z_MAX) { made.lost += P[0] * MEV; continue; }
    if (it.t === 'A' && it.anti) { made.lost += P[0] * MEV; chargeTo(-it.Z); continue; } // (antinucleons and antinuclei: antimatter is not in 3-D yet, its annihilation flat-only; made in a collision there, they leave the books as escaped energy, as particles leaving the box do, 1.25)
    if (it.t === 'x' && it.sp === 'Mu') { const q = addMuonium(ox, oy, K, ux, uy, 1, oz, uz); made.ps.push(q); continue; } // (muonium: an atom in MD, in depth, 1.25)
    if (it.t === 'x') { const o = addExo(it.sp, ox, oy, K, ux, uy, it.m, oz, uz); made.xs.push(o); pairNote(o); continue; }
    const q = it.t === 'e' ? addLepton(it.q < 0 ? ELEC : POS, ox, oy, 0, 0, oz) : addNuc(it.Z, it.N, it.ne || 0, ox, oy, 0, 0, it.anti, oz);
    setMotion(q, K, ux, uy, 0, 0, uz);
    if (!q.trk && K > 2000) startTrack(q);
    made.ps.push(q);
  }
  return made;
}
function decayExo3(o) {
  if (XP[o.sp].ps) { psDecay(o); return; } // (positronium, 1.27)
  if (o.spin && RP.mu && o.sp === 'mu+') { muExoDecay(o); return; } // (μSR, 1.27)
  const d = XP[o.sp], toks = pickBr(d.dec), items = toks.map(item), ms = items.map(massOf);
  const vs = phaseSpace(o.m, ms); // (3-D phase space, 1.25; 1.24 turned the flat one's plane at random)
  if (!vs) { exoLeaves(o); return; }
  const b = o.v / PHYS.C, bx = b * o.ux, by = b * o.uy, bz = b * o.uz;
  const S = nucBegin([]);
  o.dead = true;
  const keepTag = _evTag; _evTag = o.ev;
  const made = spawnItems3(items, vs.map(v => boost3(v[0], v[1], v[2], v[3], -bx, -by, -bz, o.gam)), o.x, o.y, o.z); // (its γ itself: from 1 − β² it kept ~10⁻⁶ of itself at γ ≈ 10⁵, the products of a PeV event's debris 0.1–0.9 MeV off over their decays, 1.26)
  _evTag = keepTag;
  closeEvent(S, made, o.x, o.y, o.KE + o.m * MEV, o.m * MEV);
  W.count.decay++;
  const txt = `${o.lab} → ${summarize(items)}`, life = d.tau * o.gam;
  o.fate = `decayed: ${txt}`;
  flash(o.x, o.y, d.col, EXO_QUIET.has(o.sp) ? 2 : 3.5, 0.35, o.z);
  tally(items, [], `Decay in flight: ${txt}`);
  if (!EXO_QUIET.has(o.sp)) {
    nucEvent('pdecay', o.x, o.y, `Decay in flight: ${txt}`, [{ x: o.x, y: o.y, k: 'x', rd: 0.12, lbl: o.lab }], `mean life ${fmtTime(d.tau)}, ${fmtTime(life)} at its speed${boostTag()}`);
    log('nuc', `Decay in flight: ${txt} (mean life ${fmtTime(d.tau)}, γ = ${fmtNum(o.gam, 3)})`);
  } else log('nuc', `Decay: ${txt}`);
}
function flyExo3(o, h) {
  const mu = o.m / PHYS.AMU_MEV, x0 = o.x, y0 = o.y, z0 = o.z, P = B3U[W.Bax3] || B3U.z, a = P[0], c = P[1];
  let rem = h;
  for (let k = 0; k < 64 && rem > 1e-15; k++) {
    let s = rem, om = 0;
    if (o.q) { const B = Bfield3(o.x, o.y, o.z); if (B) { om = o.q * B * PHYS.LOR / (o.gam * mu); if (Math.abs(om) * s > 0.2) s = 0.2 / Math.abs(om); } }
    if (om) [o[a], o[c]] = turn2(o[a], o[c], -om * s / 2);
    o.x += o.ux * o.v * s; o.y += o.uy * o.v * s; o.z += o.uz * o.v * s;
    if (om) [o[a], o[c]] = turn2(o[a], o[c], -om * s / 2);
    rem -= s;
  }
  exoTrack(o);
  if (o.q && o.v > 0) exoIonize3(o, x0, y0, z0);
  if (o.q && o.v > 0 && !o.dead) exoScatter3(o, x0, y0, z0);
}
/* The atoms within R of the segment (x0, y0, z0) → (x1, y1, z1), nearest the start first: [t, atom, distance]. */
const _hits3 = [];
function segTargets3(x0, y0, z0, x1, y1, z1, R, filter) {
  _hits3.length = 0;
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L2 = dx * dx + dy * dy + dz * dz;
  if (!(L2 > 0)) return _hits3;
  const lo = [Math.min(x0, x1) - R, Math.min(y0, y1) - R, Math.min(z0, z1) - R], hi = [Math.max(x0, x1) + R, Math.max(y0, y1) + R, Math.max(z0, z1) + R];
  const test = (p) => {
    if (p.dead || p.x < lo[0] || p.x > hi[0] || p.y < lo[1] || p.y > hi[1] || p.z < lo[2] || p.z > hi[2] || !filter(p)) return;
    const px = p.x - x0, py = p.y - y0, pz = p.z - z0, t = (px * dx + py * dy + pz * dz) / L2;
    if (t < 0 || t >= 1) return;
    const ex = px - t * dx, ey = py - t * dy, ez = pz - t * dz, b2 = ex * ex + ey * ey + ez * ez;
    if (b2 < R * R) _hits3.push([t, p, Math.sqrt(b2)]);
  };
  // (bug fix 9 after 1.25: the cells the segment's box covers, not every particle; plus what the grid does not hold:
  // nuclei flying fast or in radiation flight since the lists were made, and particles made since)
  gridEnsure();
  if (G.n <= 32 || !(G.cd > 0) || _flagGen !== _flagGenForces) for (const p of W.parts) test(p);
  else {
    const m = SKIN_F, cx = (v) => Math.floor((v + G.hx) / G.cw), cy = (v) => Math.floor((v + G.hy) / G.ch), cz = (v) => Math.floor((v + G.hz) / G.cd), L = G.list;
    gridWalk3(cx(lo[0] - m), cy(lo[1] - m), cx(hi[0] + m), cy(hi[1] + m), cz(lo[2] - m), cz(hi[2] + m), (i) => { test(L[i]); });
    for (const p of _fastNuc) test(p);
    for (const p of _radNuc) test(p);
    for (const p of _late) test(p);
    if (_hits3.length > 1) { const seen = new Set(); let j = 0; for (const h of _hits3) if (!seen.has(h[1])) { seen.add(h[1]); _hits3[j++] = h; } _hits3.length = j; }
  }
  if (_hits3.length > 1) _hits3.sort((a, b) => a[0] - b[0] || a[1].id - b[1].id);
  return _hits3;
}
/* (1.25) The nuclei along a particle's path this step, found once and shared by its ionization, scattering and nuclear
   hits (the three asked the same question of every atom: ~20 µs each at a thousand atoms); each takes those its filter
   keeps. Positions do not change between the three, and no nucleus is made between them. */
const _seg3 = { o: null, step: -1, k: '', hits: [] };
function segFor3(o, x0, y0, z0, filter) {
  const k = `${x0},${y0},${z0},${o.x},${o.y},${o.z}`;
  if (_seg3.o !== o || _seg3.step !== W.step || _seg3.k !== k) { _seg3.o = o; _seg3.step = W.step; _seg3.k = k; _seg3.hits = segTargets3(x0, y0, z0, o.x, o.y, o.z, 1.0, (t) => t.k === NUC && t.Z > 0).slice(); }
  return _seg3.hits.filter(h => !h[1].dead && filter(h[1]));
}
function exoIonize3(o, x0, y0, z0) {
  const beta2 = Math.max(1e-8, (o.v / PHYS.C) ** 2), z2 = o.q * o.q;
  const hits = segFor3(o, x0, y0, z0, (t) => t.ne > 0);
  let lost = 0;
  const cpm = RP.cpm, sl = cpm ? Math.hypot(o.x - x0, o.y - y0, o.z - z0) : 0; // (charged particles in matter, 1.27)
  if (cpm) cpmSeg(o, o.KE, o.m * MEV, Math.abs(o.q), 0, o.ux, o.uy, o.uz, sl, (x0 + o.x) / 2, (y0 + o.y) / 2, (z0 + o.z) / 2, 1.0, true);
  for (const [t, tg, b] of hits) {
    if (tg.dead || tg.ne <= 0) continue;
    if (cpm) { CPM.K = o.KE; lost += cpmAtom(tg, b, 0.0047 * z2 * tg.ne / beta2 / (1 + (b / 0.4) * (b / 0.4)), x0 + (o.x - x0) * t, y0 + (o.y - y0) * t, z0 + (o.z - z0) * t); o.KE = CPM.K; if (W.nucWin) for (const m of molecule(tg)) m.nucProd = true; if (o.KE <= 1) break; continue; }
    const w = 1 / (1 + (b / 0.4) * (b / 0.4));
    const dE = Math.min(0.3 * o.KE, 0.0047 * z2 * tg.ne / beta2 * w);
    if (dE < 0.01) continue;
    o.KE -= dE; lost += dE;
    if (W.nucWin) for (const m of molecule(tg)) m.nucProd = true;
    const ie = ionizationCost(tg), n = turn3(o.ux, o.uy, o.uz, Math.PI / 2), nx = n[0], ny = n[1], nz = n[2]; // (square to the path, at a random azimuth)
    if (dE > ie && freeElectronCount() < MAX_FREE_E && W.parts.length < MAX_PARTS) { if (ejectElectron(tg, dE - ie, nx, ny, undefined, undefined, nz)) W.count.ionize++; else dumpHeat(dE, tg, tg); }
    else { const vn = tg.vx * nx + tg.vy * ny + tg.vz * nz, a = -vn + Math.sqrt(vn * vn + 2 * dE * tg.im); tg.vx += nx * a; tg.vy += ny * a; tg.vz += nz * a; updateFast(tg); } // (exactly dE, as fastStop3: 0.7·√(2dE/m) gave about half, 1.26)
    if (o.KE <= 1) break;
  }
  if (cpm && o.KE > 1) { CPM.K = o.KE; lost += cpmCkv(x0, y0, z0, sl); o.KE = CPM.K; } // (Cherenkov light, 1.27)
  if (lost > 0) { o.KE = Math.max(0.5, o.KE); exoSpeed(o); }
}
function exoScatter3(o, x0, y0, z0) {
  const hits = segFor3(o, x0, y0, z0, () => true);
  if (!hits.length) return;
  const mc2 = o.m * MEV, E = o.KE + mc2, pc = Math.sqrt(Math.max(0, o.KE * (o.KE + 2 * mc2))), pv = pc * pc / E;
  if (!(pv > 0)) return;
  for (const [, tg, b0] of hits) {
    if (tg.dead) continue;
    const b = Math.max(b0, 0.01), Zs = tg.Z, a = tg.ne > 0 ? 0.885 * 0.529177 / Math.cbrt(Zs) : Infinity;
    let th = 2 * PHYS.KE * Math.abs(o.q) * Zs / (b * pv) * (a === Infinity ? 1 : Math.exp(-b / a));
    if (!(th > 1e-7)) continue;
    th = Math.min(th, 0.3);
    const sx = tg.x - x0, sy = tg.y - y0, sz = tg.z - z0, sp = sx * o.ux + sy * o.uy + sz * o.uz; // (toward the nucleus, square to the path)
    let nx = sx - sp * o.ux, ny = sy - sp * o.uy, nz = sz - sp * o.uz; const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nl < 1e-9) continue; nx /= nl; ny /= nl; nz /= nl;
    const q = (tg.anti ? -1 : 1) * Math.sign(o.q), sg = q < 0 ? 1 : -1, c = Math.cos(th), s_ = Math.sin(th); // (an opposite charge pulled toward it, a like one pushed away)
    const ux = o.ux * c + sg * nx * s_, uy = o.uy * c + sg * ny * s_, uz = o.uz * c + sg * nz * s_;
    const pU = pc / (PHYS.AMU_MEV * MEV) * PHYS.C, dpx = pU * (o.ux - ux), dpy = pU * (o.uy - uy), dpz = pU * (o.uz - uz);
    const vx = tg.vx + dpx / tg.m, vy = tg.vy + dpy / tg.m, vz = tg.vz + dpz / tg.m, dK = 0.5 * tg.m * (vx * vx + vy * vy + vz * vz - tg.vx * tg.vx - tg.vy * tg.vy - tg.vz * tg.vz);
    if (!(dK < o.KE - 1)) continue;
    tg.vx = vx; tg.vy = vy; tg.vz = vz; updateFast(tg);
    o.ux = ux; o.uy = uy; o.uz = uz; o.KE -= dK;
  }
  exoSpeed(o);
}
function moveExos3(dt, id0) {
  if (W.muBound && W.muBound.length) muBoundTick(dt); // (muonic atoms and muonium in 3-D, 1.25)
  if (W.muAtoms && W.muAtoms.length) muoniumTick(dt);
  for (let i = 0; i < W.exo.length; i++) { const o = W.exo[i]; if (!o.dead && XP[o.sp].res && !W.ultra && !deepSlow()) { if (exoHeld(o)) o.wait = true; else decayExo3(o); } }
  const n0 = W.exo.length;
  if (!n0) return 0;
  const clock = W.decayOn ? dt * PHYS.TU_S * W.warp : 0, H = [W.box.w / 2, W.box.h / 2, W.box.d / 2];
  const out = (o) => Math.abs(o.x) > H[0] || Math.abs(o.y) > H[1] || Math.abs(o.z) > H[2];
  for (let i = 0; i < n0; i++) {
    const o = W.exo[i];
    if (o.dead || (id0 !== undefined && o.id >= id0)) continue;
    let h = dt, dec = false;
    if (clock > 0) { const tl = XP[o.sp].tau * o.gam, P = 1 - Math.exp(-clock / tl); if (rnd() < P) { dec = true; h = dt * Math.min(1, -Math.log(1 - rnd() * P) * tl / clock); } }
    const d = XP[o.sp];
    if (dec && exoHeld(o)) { dec = false; h = dt; o.wait = true; }
    if (o.stop) h = 0; // (at rest: it waits for its decay)
    const x0 = o.x, y0 = o.y, z0 = o.z;
    if (h > 0) flyExo3(o, h);
    if (o.wait && out(o)) { o.x = clamp(o.x, -H[0], H[0]); o.y = clamp(o.y, -H[1], H[1]); o.z = clamp(o.z, -H[2], H[2]); dec = true; }
    if (d.res && !dec && !W.ultra && !deepSlow()) continue;
    if (out(o)) {
      const kept = d.atom || d.hyp || d.ps || ((o.sp === 'mu-' || o.sp === 'mu+' || o.sp === 'K-' || H_STOP.has(o.sp)) && o.KE < 2 * MU_STOP);
      if (kept && W.wall === 'wrap') { for (const [k, h] of [['x', H[0]], ['y', H[1]], ['z', H[2]]]) if (Math.abs(o[k]) > h) o[k] -= Math.sign(o[k]) * 2 * h; } // (a periodic box: across, as atoms go, 1.26 bug fix)
      else if (!(kept && W.wall === 'reflect')) { exoLeaves(o); continue; } // (as in the flat game: slow muons and muonic hydrogen kept in, 1.25)
      else if (Math.abs(o.x) > H[0]) { o.x = Math.sign(o.x) * (2 * H[0] - Math.abs(o.x)); o.ux = -o.ux; }
      if (Math.abs(o.y) > H[1]) { o.y = Math.sign(o.y) * (2 * H[1] - Math.abs(o.y)); o.uy = -o.uy; }
      if (Math.abs(o.z) > H[2]) { o.z = Math.sign(o.z) * (2 * H[2] - Math.abs(o.z)); o.uz = -o.uz; }
    }
    if (d.ps && !dec && clock > 0 && psMatter(o, clock)) continue; // (1.27)
    if (o.spin && RP.mu) muSpinTurn(o, clock * (o.stop ? 1 : h / dt) / o.gam); // (1.27)
    if (dec) { if (d.hyp) hypDecay(o); else decayExo3(o); continue; }
    // captures at rest and nuclear hits, as in the flat game (1.25): a stopped μ⁻ makes a muonic atom, K⁻ and π⁻, Σ⁻, Ξ⁻, Ω⁻ are
    // absorbed by a nucleus, a μ⁺ may take an electron (muonium); strongly interacting ones meet the nuclei on their path
    const xa = RP.exo && XA_SPS.has(o.sp);
    if (xa) { if (xaStep(o)) continue; } // (the realistic-particle switch, 1.27)
    else {
    if (o.sp === 'mu-' && o.KE < MU_STOP && muStop(o)) continue;
    if (o.sp === 'K-' && o.KE < MU_STOP && kStop(o)) continue;
    if (H_STOP.has(o.sp) && o.KE < MU_STOP && hStop(o)) continue;
    }
    if (o.sp === 'mu+' && o.KE < MU_STOP && !o.muTried && muoniumForm(o)) continue;
    if (d.strong === undefined) d.strong = strongExo(o.sp);
    if (d.strong && !(xa && o.KE < MU_STOP) && exoHits3(o, x0, y0, z0)) continue; // (1.27: as in the flat game)
    if (d.atom) muAtomScatter3(o, x0, y0, z0);
    if (d.atom && clock > 0 && muAtomTick(o, clock)) continue;
    if (RP.exo && d.atom && !o.dead && clock > 0 && xaTransfer(o, clock)) continue; // (1.27)
    if (!o.stop && o.KE < MU_STOP && o.q && !xa) { // (with the switch: it slows on to its capture, 1.27) // (slowed in matter to a couple of keV and not caught: at rest here, its last keV given to the atoms about it as heat)
      const near = segTargets3(o.x - 1, o.y, o.z, o.x + 1, o.y, o.z, 3, (t) => t.k === NUC && t.Z > 0 && !t.dead)[0];
      if (near) { dumpHeat(o.KE, near[1], near[1]); o.KE = 0; exoSpeed(o); o.stop = true; }
    }
  }
  if (W.step % 8 === 0 || W.exo.length > MAX_EXO) { let j = 0; for (const o of W.exo) if (!o.dead) W.exo[j++] = o; W.exo.length = j; }
  return 0;
}
/* ---- unstable particles as a collider's beams (1.15). Every charged particle that lives long enough to be steered can be
   a beam: muons and τ leptons, charged pions and kaons, the charged hyperons (Σ⁺, Σ⁻, Ξ⁻, Ω⁻), charmed and bottom mesons
   (D⁺, D⁺s, B⁺) and all their antiparticles. They stay in W.exo (so they decay on their own clocks, time dilated:
   a 1 GeV muon goes round some 10¹¹ times first, a τ a few thousand), and fly through the ring's magnets and cavities
   on the same leapfrog path as the beams of W.parts (radPath: engine.js), radiating as charges do (γ⁴: a muon 207⁴
   times less than an electron of the same energy). Marked xb; their speed is o.v, their mass o.m in MeV. */
function xbMark(o) { o.xb = true; o.rad = true; o.evId = 0; o.ox = o.x; o.oy = o.y; }
function moveExoBeam(o, h) {
  o.ox = o.x; o.oy = o.y;
  radPath(o, h, o.q, o.m / PHYS.AMU_MEV);
  o.x = _rp[0]; o.y = _rp[1];
  exoTrack(o);
}
const xbLab = (p) => (p.xb ? p.lab : speciesLabel(p));
const xbIn = (p) => { const t = xbTok(p); return t ? labelOf(item(t)) : xbLab(p); }; // (as the tally names it)
const xbGhost = (p) => (p.xb ? { x: p.x, y: p.y, k: 'x', rd: 0.12, lbl: p.lab } : ghostOf(p));
const xbLepton = (p) => (p.xb ? !Q_CONTENT[p.sp] : p.k !== NUC);
function xbTok(p) { // a beam particle as a product token (null: a nucleus heavier than a nucleon, or an ion)
  if (p.xb) return p.sp;
  if (p.k === ELEC) return 'e-';
  if (p.k === POS) return 'e+';
  return p.Z + p.N === 1 && !p.ne ? (p.Z ? (p.anti ? 'pbar' : 'p') : (p.anti ? 'nbar' : 'n')) : null;
}
/* Close the books of a collision of two beam particles, either of them in W.exo: products from items with their lab
   four-momenta. */
function xbClose(a, b, items, moms, x, y, txt) {
  const parts = [a, b].filter(p => !p.xb), xs = [a, b].filter(p => p.xb);
  const S = nucBegin(parts);
  for (const p of parts) kill(p);
  let Ein = 0, mIn = 0;
  for (const o of xs) { Ein += o.KE + o.m * MEV; mIn += o.m * MEV; o.dead = true; o.fate = `collided: ${txt}`; }
  const made = spawnItems(items, moms, x, y);
  closeEvent(S, made, x, y, Ein, mIn);
  return made;
}
/* Two beam particles meet in the detector, one or both of them unstable (beamHit hands them over). A lepton and its
   antilepton annihilate as e⁺e⁻ do (eeEvent: two γ rays, lepton pairs, hadrons, by their cross sections); a hadron
   and its antihadron annihilate into mesons; a hadron meets a nucleus as it would in matter (hadronHit: knocks out
   nucleons, strangeness exchange, absorption); two other hadrons, above the threshold, come through as leading
   particles with new hadrons made between them (inelastic as often as proton–proton collisions are at the same energy
   above their masses: about 80% of close passes at high energy). Anything else scatters off the other's charge. */
function xbHit(C, a, b, d, x, y, ex, ey) {
  const hit = (txt) => { C.hits = (C.hits || 0) + 1; C.last = txt; };
  const la = xbLab(a), lb = xbLab(b), ta = xbTok(a), tb = xbTok(b), R = rBeam(a, b), u = d / R;
  const lepA = xbLepton(a), lepB = xbLepton(b);
  if (ta && tb && conjTok(ta) === tb) {
    if (lepA) { eeEvent(a, b, x, y); return; } // (counts itself)
    const t = xbAnnihilate(a, b, x, y); if (t) { hit(t); return; }
  } else if (!lepA && !lepB && u < Math.sqrt(HIT_INEL)) {
    const o = a.xb ? a : b, tg = o === a ? b : a;
    if (!tg.xb && tg.k === NUC && !tg.anti && strongExo(o.sp)) { // (on a proton or a nucleus: as in matter)
      const s0 = W.logSeq; _exoEvItems = null;
      hadronHit(o, tg, u);
      if (o.dead || tg.dead) {
        const txt = W.logSeq !== s0 && W.log.length ? W.log[W.log.length - 1].text : `${la} + ${lb}`;
        if (_exoEvItems) tally(_exoEvItems, [xbIn(a), xbIn(b)], txt);
        hit(txt); return;
      }
    } else if (ta && tb) { const t = xbInelastic(a, b, x, y); if (t) { hit(t); return; } }
  }
  if (a.dead || b.dead) return;
  const th = nuclearScatter(a, b, d, ex, ey, R);
  if (th !== null && th > 0.0175) {
    hit(`${la} + ${lb} scattered: ${(th * 180 / Math.PI).toFixed(0)}° in their own frame`);
    if (C.kind === 'ring') { a.caught = b.caught = true; a.beam = b.beam = null; }
  }
}
/* A hadron and its antihadron (π⁺π⁻, K⁺K⁻, Σ⁺Σ̄⁻, D⁺D⁻, B⁺B⁻ …): every quark meets its antiquark, so what comes out
   carries no charge, strangeness, charm or baryon number: mesons, as from a proton and an antiproton (and above a few
   GeV, as two jets). Returns the caption, or null. */
function xbAnnihilate(a, b, x, y) {
  const P = add4(p4of(a), p4of(b)), M = mass4(P);
  const its = M > 2500 ? hadronize(M, 0, 0, {}) : mesonState(M, 0);
  if (!its) return null;
  let items = its.map(item), moms = null;
  const bx = P[1] / P[0], by = P[2] / P[0], bz = (P[3] || 0) / P[0];
  if (M > 5000 && items.length >= 3) {
    const A = toRest(p4of(a), bx, by, bz), L = Math.hypot(A[1], A[2]) || 1, ri = resonate(items, M), vs = jetMomenta(ri, M, A[1] / L, A[2] / L, { ptScale: 0.7 });
    if (vs) { items = ri; moms = vs; addString(x, y, A[1] / L, A[2] / L, items.length); }
  }
  if (!moms) moms = phaseSpace(M, items.map(massOf));
  if (!moms) return null;
  const la = xbLab(a), lb = xbLab(b), txt = `${la} + ${lb} → ${summarize(items)}`, sub = `annihilation, √s = ${fmtE(M * MEV)}`, gh = [xbGhost(a), xbGhost(b)];
  xbClose(a, b, items, moms.map(v => toLab(v, bx, by, bz)), x, y, txt);
  W.count.annih++;
  nucEvent('annih', x, y, txt, gh, sub); log('nuc', `Annihilation: ${txt} (${sub})`);
  flash(x, y, [255, 230, 180], 6, 0.6);
  tally(items, [xbIn(a), xbIn(b)], txt);
  return `${txt}, ${sub}`;
}
/* Two hadrons that are not each other's antiparticles, above the threshold: both come through (leading particles,
   keeping every quantum number they carried in) and the energy between them makes new hadrons (pions, kaon pairs, η …;
   above 5 GeV along strings stretched between the two). Inelastic as often as proton–proton collisions are at the same
   energy above the two masses (σ_inel/σ_tot, measured). Returns the caption, or null (they scatter instead). */
function xbInelastic(a, b, x, y) {
  const P = add4(p4of(a), p4of(b)), M = mass4(P), ia = item(xbTok(a)), ib = item(xbTok(b)), m0 = massOf(ia) + massOf(ib), Ex = M - m0;
  if (Ex < 160) return null;
  const Meq = 2 * 938.9 + Ex; // (proton–proton at the same energy above their masses)
  if (rnd() > nnTable(NN_INEL, Meq) / nnTable(NN_TOT, Meq)) return null;
  const h = hadronize(Ex, 0, 0, {});
  if (!h || !h.length) return null;
  ia.lead = ib.lead = true;
  let items = [ia, ib].concat(h), moms = null;
  const bx = P[1] / P[0], by = P[2] / P[0], bz = (P[3] || 0) / P[0], A = toRest(p4of(a), bx, by, bz), L = Math.hypot(A[1], A[2]) || 1;
  if (M > 5000 && items.length >= 3) { const ri = resonate(items, M), vs = jetMomenta(ri, M, A[1] / L, A[2] / L, { lead: (it) => !!it.lead, ptScale: 0.7 }); if (vs) { items = ri; moms = vs; addString(x, y, A[1] / L, A[2] / L, items.length); } }
  if (!moms) moms = items.length >= 3 ? jetMomenta(items, M, A[1] / L, A[2] / L, { lead: (it) => !!it.lead }) : phaseSpace(M, items.map(massOf));
  if (!moms) return null;
  const la = xbLab(a), lb = xbLab(b), txt = `${la} + ${lb} → ${summarize(items)}`, sub = `√s = ${fmtE(M * MEV)}: both come through, new hadrons between them`, gh = [xbGhost(a), xbGhost(b)];
  xbClose(a, b, items, moms.map(v => toLab(v, bx, by, bz)), x, y, txt);
  nucEvent('prod', x, y, txt, gh, sub); log('nuc', `Collision: ${txt} (${sub})`);
  flash(x, y, [255, 230, 180], 6, 0.6);
  tally(items, [xbIn(a), xbIn(b)], txt);
  return `${txt}, ${sub}`;
}
/* A strongly interacting particle's path this step against the nuclei it passes (where they are drawn): the first it
   comes within reach of, it meets (hadronHit). Returns true if it is gone. */
function exoHits(o, x0, y0) {
  if (o.dead || (o.x === x0 && o.y === y0)) return false;
  const hits = segTargets(x0, y0, o.x, o.y, 1.0, (t) => t.k === NUC && t.Z > 0 && !t.anti && !t.mu);
  for (const [, tg, b] of hits) {
    if (tg.dead || (o.ev && o.ev === tg.evId)) continue; // (made in the same event: it has already left that nucleus)
    const R = W.ultra ? (trueRfm(tg) + 0.7 + 2) * FM : Math.max(R_FUS, nucDrawR(tg) + 0.05); // (ultra: the nucleus and a meson at their true sizes)
    if (b >= R) continue;
    if (o.hitId === tg.id) continue; // (one pass, one encounter)
    o.hitId = tg.id;
    if (hadronHit(o, tg, b / R)) return true;
    if (o.dead) return true;
  }
  return false;
}
/* (3-D, 1.25) exoHits along a path in depth. */
function exoHits3(o, x0, y0, z0) {
  if (o.dead || (o.x === x0 && o.y === y0 && o.z === z0)) return false;
  const hits = segFor3(o, x0, y0, z0, (t) => !t.anti && !t.mu);
  for (const [, tg, b] of hits) {
    if (tg.dead || (o.ev && o.ev === tg.evId)) continue;
    const R = W.ultra ? (trueRfm(tg) + 0.7 + 2) * FM : Math.max(R_FUS, nucDrawR(tg) + 0.05);
    if (b >= R) continue;
    if (o.hitId === tg.id) continue;
    o.hitId = tg.id;
    if (hadronHit(o, tg, b / R)) return true;
    if (o.dead) return true;
  }
  return false;
}
function exoLeaves(o, where) { // its energy, mass included, leaves the books (it decays out there, into radiation)
  W.ledger.escaped += o.KE + o.m * MEV; W.ledger.nuc += o.m * MEV; chargeTo(XP[o.sp].q, where);
  o.dead = true; o.fate = o.fate || 'left the chamber';
}
const EXO_QUIET = new Set(['pi0', 'eta', 'rho0', 'rho+', 'rho-', 'omega', 'phi', 'Ks+', 'Ks-', 'Ks0', 'Ksb0', 'Dpp', 'Dp', 'D0', 'Dm', 'Dbmm', 'Dbm', 'Db0', 'Dbp']); // decays too common and too quick to caption each one
function decayExo(o) {
  if (XP[o.sp].ps) { psDecay(o); return; } // (positronium, 1.27)
  if (o.spin && RP.mu && o.sp === 'mu+') { muExoDecay(o); return; } // (μSR, 1.27)
  const d = XP[o.sp], toks = pickBr(d.dec), items = toks.map(item), ms = items.map(massOf);
  const vs = phaseSpace(o.m, ms);
  if (!vs) { exoLeaves(o); return; }
  const bx = o.v / PHYS.C * o.ux, by = o.v / PHYS.C * o.uy;
  const S = nucBegin([]);
  o.dead = true;
  const keepTag = _evTag; _evTag = o.ev; // (its products belong to the collision that made it: the pair masses pair them with the rest)
  const made = spawnItems(items, vs.map(v => toLab(v, bx, by, 0, o.gam)), o.x, o.y); // (its γ itself, as decayExo3, 1.26)
  _evTag = keepTag;
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
function sigGG(s, mf) { const me = mf || PHYS.MEC2 / 1000; return 2 * Math.PI * ALPHA * ALPHA / s * Math.max(0.1, Math.log(s / (me * me)) - 1) * GEV2NB; }
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
  out.cont = sigPt(s) * 2.2 * sm((W2 - 1.05) / 0.55);
  out.cc = W2 > 3.75 ? sigPt(s) * 1.4 : 0; out.bb = W2 > 10.6 ? sigPt(s) * 0.35 : 0; // (charm and bottom pairs: their own channels since 1.15)
  return out;
}
function eeEvent(a, b, x, y) {
  const Pa = p4of(a), Pb = p4of(b), P = add4(Pa, Pb), M = mass4(P), s = M * M / 1e6;
  const H = hadronParts(s), xb = a.xb || b.xb, ml = restE(a) / MEV / 1000; // (a muon and an antimuon, or a τ pair, in a collider's beams: 1.15)
  const neg = (p) => (p.xb ? p.q < 0 : p.k === ELEC), Pneg = neg(a) ? Pa : Pb;
  const ch = pickBr([[sigGG(s, xb ? ml : 0), 'gg'], [xb ? sigLL(s, PHYS.MEC2 / 1000) : 0, 'ee'], [sigLL(s, XP['mu-'].m / 1000), 'mm'], [sigLL(s, XP['tau-'].m / 1000), 'tt'], [H.rho, 'rho'], [H.omega, 'omega'], [H.phi, 'phi'], [H.cont, 'cont'], [H.cc, 'cc'], [H.bb, 'bb']]);
  let toks = null, ang = null;
  if (ch === 'mm') { toks = ['mu-', 'mu+']; ang = (c) => (1 + c * c) / 2; }
  else if (ch === 'ee') { toks = ['e-', 'e+']; ang = (c) => (1 + c * c) / 2; }
  else if (ch === 'tt') { toks = ['tau-', 'tau+']; ang = (c) => (1 + c * c) / 2; }
  else if (ch === 'rho') { toks = ['pi+', 'pi-']; ang = (c) => 1 - c * c; }
  else if (ch === 'omega') toks = pickBr([[0.893, ['pi+', 'pi-', 'pi0']], [0.084, ['pi0', 'g']], [0.015, ['pi+', 'pi-']]]);
  else if (ch === 'phi') toks = pickBr([[0.492, ['K+', 'K-']], [0.34, ['K0L', 'K0S']], [0.154, ['pi+', 'pi-', 'pi0']], [0.013, ['eta', 'g']]]);
  else if (ch === 'cont') toks = hadronize(M, 0, 0, {});
  else if (ch === 'cc' || ch === 'bb') { // a heavy quark pair: two charm (or bottom) mesons, back to back, with light hadrons from what energy is left
    const pair = ch === 'cc' ? pickBr([[0.44, ['Dc0', 'Dcb0']], [0.36, ['Dc+', 'Dc-']], [0.2, ['Ds+', 'Ds-']]]) : pickBr([[0.5, ['B+', 'B-']], [0.5, ['B0', 'Bb0']]]);
    const mp = XP[pair[0]].m + XP[pair[1]].m, rest = M - mp;
    toks = rest > 400 ? pair.concat(hadronize(rest - 100, 0, 0, {}) || []) : pair;
  }
  let items = toks ? toks.map(item) : null;
  if (!items || items.reduce((t, it) => t + massOf(it), 0) >= M - 0.01) { // two γ rays
    if (!xb) { annihilateInFlight(a, b, x, y); return; }
    items = [item('g'), item('g')]; ang = null;
  }
  const bx = P[1] / P[0], by = P[2] / P[0], bz = (P[3] || 0) / P[0];
  let vs;
  let jet = null;
  if ((ch === 'cont' || ch === 'cc' || ch === 'bb') && M > 2500 && items.length >= 3) { // above a few GeV: two jets back to back, at 1 + cos²θ to the beams (spin-½ quarks)
    const e = toRest(Pneg, bx, by, bz), en = Math.hypot(e[1], e[2]) || 1;
    let th = 0; for (let k = 0; k < 60; k++) { th = rnd() * 2 * Math.PI; if (rnd() < (1 + Math.cos(th) ** 2) / 2) break; }
    jet = turn2(e[1] / en, e[2] / en, th);
  }
  if (jet) { const ri = resonate(items, M), v2 = jetMomenta(ri, M, jet[0], jet[1], { ptScale: 0.7 }); if (v2) { items = ri; vs = v2; } else vs = jetMomenta(items, M, jet[0], jet[1]); } // (born partly as resonances)
  if (jet && vs) addString(x, y, jet[0], jet[1], items.length);
  else if (ang && items.length === 2) { // a pair: the angle to the beams as for a photon (1 + cos²θ) or a ρ (sin²θ)
    const e = toRest(Pneg, bx, by, bz), en = Math.hypot(e[1], e[2]) || 1;
    let th = 0; for (let k = 0; k < 60; k++) { th = rnd() * 2 * Math.PI; if (rnd() < ang(Math.cos(th))) break; }
    const [ux, uy] = turn2(e[1] / en, e[2] / en, th);
    vs = twoBody(M, massOf(items[0]), massOf(items[1]), ux, uy);
  } else vs = phaseSpace(M, items.map(massOf));
  const ins = neg(a) ? [xbLab(a), xbLab(b)] : [xbLab(b), xbLab(a)];
  const txt = `${ins[0]} + ${ins[1]} → ${summarize(items)}`, sub = `√s = ${fmtE(M * MEV)}`;
  const gh = [xbGhost(a), xbGhost(b)];
  xbClose(a, b, items, vs.map(v => toLab(v, bx, by, bz)), x, y, txt);
  W.count.annih++;
  nucEvent('prod', x, y, txt, gh, sub);
  log('nuc', `Annihilation in flight: ${txt} (${sub})`);
  flash(x, y, [255, 230, 180], 6, 0.6);
  tally(items, [xbIn(a), xbIn(b)], txt);
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
    const bx = P[1] / P[0], by = P[2] / P[0], bz = (P[3] || 0) / P[0], A = toRest(p4of(a, true), bx, by, bz), L = Math.hypot(A[1], A[2]) || 1;
    const ri = resonate(items, M), vs = jetMomenta(ri, M, A[1] / L, A[2] / L, { lead: isBaryonItem, ptScale: 0.7, ax3: unit3(A) }); if (vs) items = ri;
    if (vs) { addString(x, y, A[1] / L, A[2] / L, items.length); return finishReaction(a, b, items, vs.map(v => toLab(v, bx, by, bz)), x, y, 'prod', `√s = ${fmtE(M * MEV)}: strings along the beams`); }
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
const DIFF_SHARE = 0.35; // (of the nucleus–nucleus passes that could react above 25 MeV a nucleon, the share that diffracts instead: the outermost)
function nuclearEncounter(a, b, u, x, y, z) {
  _evZ3 = z === undefined ? b.z || 0 : z; // (3-D: where in depth its products start, 1.25)
  if (a.mu || b.mu) return false; // (muonium's nucleus is a muon: it feels no strong force, 1.12)
  if (a.dead || b.dead || a.k !== NUC || b.k !== NUC || opp(a, b)) return null;
  if (W.parts.length > MAX_PARTS - 400) return null; // (no room left for products)
  const A1 = a.Z + a.N, A2 = b.Z + b.N, Z1 = a.Z, Z2 = b.Z, anti = !!a.anti;
  const Pa = p4of(a, true), Pb = p4of(b, true), P = add4(Pa, Pb), M = mass4(P), Ecm = M - nucMeV(Z1, a.N) - nucMeV(Z2, b.N);
  if (!(Ecm > 0.001)) return null;
  const bx = P[1] / P[0], by = P[2] / P[0], bz = (P[3] || 0) / P[0], As = toRest(Pa, bx, by, bz), Bs0 = toRest(Pb, bx, by, bz)[0], ps = pmag(As);
  if (!(ps > 0)) return null;
  const vrel = ps / As[0] + ps / Bs0, K = Z1 * Z2 ? 1.44 * Z1 * Z2 / (ps * vrel) : 0;
  const Rc = 1.2 * (Math.cbrt(A1) + Math.cbrt(A2)), bTop = W.ultra ? ultraReach(a, b) / FM : Math.max(Rc, HIT_COUL * K), b3 = bTop * (W.ultra || W.d3 ? clamp(u, 0, 1) : Math.sqrt(clamp(u, 0, 1))); // (ultra: the pass's own distance) (the flat game's passes, spread along a line, are spread over the nucleus's disc by the square root; a 3-D pass's distance is spread over that disc already, so it is taken as it is: with the root, a 3-D hit came out off centre, b³ uniform instead of b², 1.26 bug fix)
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
  if (eps > 25 && (W.ultra && !W.d3 ? b3 / Math.min(bg, bTop) : (b3 / Math.min(bg, bTop)) ** 2) > 1 - DIFF_SHARE) return diffract(a, b, ps, RB); // (the outer 35% of the passes that reach here diffract, as the two-nucleon passes do outside their inelastic core; it was a 35% draw at any distance, so a head-on 1 PeV α on α passed through one time in three, turned by 10⁻⁹ rad, 1.26 bug fix)
  const items = [], moms = [];
  let kind = 'reaction', sub;
  let dtFused = false, slow = false;
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
    _qgpLast = null; _incLast = null;
    const one = A1 === 1 ? a : A2 === 1 ? b : null, many = one === a ? b : a;
    const inc = INC_ON && !W.d3 && !anti && one && many.Z + many.N > 16 && eps >= 40 && eps < 10000 && cascadeInto(one, many, one === a ? Pa : Pb, one === a ? Pb : Pa, b3, items, moms); // (Experimental: the intranuclear cascade)
    if (inc === 'pass') return null;
    if (!inc && !fragmentInto(a, b, Pa, Pb, b3, anti, items, moms)) { if (A <= 16 || eps >= 40) return null; slow = true; } // (between 15 and 40 MeV a nucleon, a fireball with no consistent outcome (too little energy for its spectators' excitation) is the slow side's compound nucleus or exchange below; it was nothing, so a head-on α on gold at 100 MeV passed through one time in three, 1.26 bug fix)
    else {
      sub = `${Math.min(A1, A2) === 1 ? 'spallation' : 'fragmentation'}, ${fmtE(eps * MEV)} per nucleon` + (_incLast ? `: a cascade of ${_incLast.coll} collisions, ${_incLast.out} out fast, ${fmtE(_incLast.Ex * MEV)} left to boil off` : '');
      if (_qgpLast) { const g = _qgpLast; kind = 'qgp'; sub = `quark–gluon plasma: ${g.Bp} nucleons melted at √s_NN = ${fmtE(g.sNN * MEV)}, froze out into ${g.n.toLocaleString('en-US')} hadrons`; addQGP(x, y, g.n, g.sNN); }
    }
  } else slow = true;
  if (slow) {
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
  if (W.d3) { elasticTurn3(a, b, th); return; }
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
/* (3-D, 1.25) The same with the depth: the relative momentum turned by th about an axis across it, at a random azimuth. */
function elasticTurn3(a, b, th) {
  const S = nucBegin([a, b]);
  const ma = restE(a) / MEV, mb = restE(b) / MEV, Pa = p4of(a), Pb = p4of(b), E = Pa[0] + Pb[0], bx = (Pa[1] + Pb[1]) / E, by = (Pa[2] + Pb[2]) / E, bz = (Pa[3] + Pb[3]) / E;
  const As = toRest(Pa, bx, by, bz), Bs = toRest(Pb, bx, by, bz), q = turn3(As[1], As[2], As[3], Math.abs(th)), qx = q[0], qy = q[1], qz = q[2];
  for (const [p, V, m] of [[a, toLab([As[0], qx, qy, qz], bx, by, bz), ma], [b, toLab([Bs[0], -qx, -qy, -qz], bx, by, bz), mb]]) {
    const pm = Math.sqrt(V[1] * V[1] + V[2] * V[2] + V[3] * V[3]) || 1, K = Math.max(1e-6, (V[0] - m) * MEV);
    if (p.bonds.length && K > 20) for (const bd of p.bonds.slice()) removeBond(bd);
    setMotion(p, K, V[1] / pm, V[2] / pm, 0, 0, V[3] / pm);
  }
  settleKE(S, 0, [a, b]);
}
/* Kinematics in hand (items, moms): the reactants go, the products come, the books close, the event is shown. */
function doReaction(a, b, items, P, M, x, y, kind, sub) {
  const vs = phaseSpace(M, items.map(massOf));
  if (!vs) return null;
  const bx = P[1] / P[0], by = P[2] / P[0], bz = (P[3] || 0) / P[0];
  return finishReaction(a, b, items, vs.map(v => toLab(v, bx, by, bz)), x, y, kind, sub);
}
function finishReaction(a, b, items, moms, x, y, kind, sub) {
  const gh = [ghostOf(a), ghostOf(b)], ins = [partLabel(a), partLabel(b)], ne = a.ne + b.ne, anti = !!a.anti;
  const partners = [];
  for (const n of [a, b]) for (const bd of n.bonds) partners.push(other(bd, n));
  const S = nucBegin([a, b]);
  // (the chain-reaction map, 1.11: a neutron from a fission that scatters or knocks out neutrons passes its family on to
  // the neutrons that come out, and is not counted as ended)
  const nIn = [a, b].find(q => q.k === NUC && q.Z === 0 && !q.anti && q.kFis !== undefined), nOut = nIn && items.some(it => it.Z === 0 && it.N === 1 && !it.anti);
  const fk = nIn ? nIn.kFis : undefined, fg = nIn ? nIn.kGen : undefined; if (nOut) nIn.kFis = undefined;
  kill(a); kill(b);
  const z = W.d3 ? _evZ3 : 0; // (3-D, 1.25)
  const made = spawnItems(items, moms, x, y, z);
  if (nOut) for (const q of made.ps) if (q.k === NUC && q.Z === 0 && !q.anti) { q.kFis = fk; if (fg !== undefined) q.kGen = fg; }
  if (ne > 0) { // the atoms' electrons (positrons, for antimatter) stay with the new nuclei, heaviest first; any over go free
    let left = ne;
    for (const q of made.ps.filter(q => q.k === NUC && q.Z > 0).sort((p, q) => q.Z - p.Z)) { if (left <= 0) break; const k = Math.min(left, q.Z); q.ne = k; left -= k; refresh(q); }
    for (let i = 0; i < left && W.parts.length < MAX_PARTS; i++) { const [ux, uy, uz = 0] = rdir(); const e = addLepton(anti ? POS : ELEC, x + 0.3 * ux, y + 0.3 * uy, 0, 0, z + 0.3 * uz); setMotion(e, 2 + 8 * rnd(), ux, uy, 0, 0, uz); made.ps.push(e); } // (uz: 3-D, 1.25)
  }
  relink(partners.filter(q => !q.dead));
  closeEvent(S, made, x, y);
  const outs = items.filter(it => it.t !== 'g' && it.t !== 'v').map(labelOf).sort();
  const same = outs.length === 2 && outs.join() === ins.slice().sort().join(); // the same two nuclei came out
  if (same) { kind = 'reaction'; sub = items.some(it => it.t === 'g') ? 'nuclear inelastic scattering: one was left excited and gave off γ rays' : 'nuclear elastic scattering'; }
  const txt = `${ins[0]} + ${ins[1]} → ${summarize(items)}`;
  nucEvent(kind, x, y, txt, gh, sub, undefined, z);
  log('nuc', `${txt}${sub ? ` (${sub})` : ''}`);
  flash(x, y, [255, 225, 170], same ? 1.5 : 6, same ? 0.35 : 0.7, z); // (a scattering only a small mark)
  W.count.nreact++;
  tally(items, ins, txt);
  return txt;
}

/* ---- a quark pulled out by hand (the Inspect tab's quark view). The flux tube between it and the rest stretches at
   about 1 GeV per fm until, about a fermi out, it snaps: its energy (RIP_E, put in by the hand, like the Spark tool's)
   makes a quark–antiquark pair. The pulled quark leaves with one of them as a meson; the other takes its place, so the
   hadron left can be another one (a proton becomes a neutron when a u is pulled and the pair is d d̄). In the chamber:
   a nucleon in a nucleus changes in place, the nucleus left with a hole (some MeV of excitation) that it sheds as it
   can (evaporation, break-up, γ rays); a hyperon (Λ, Σ, Ξ, Ω) does not stay but flies off; a Δ decays at once to a
   nucleon and a pion. All of it with exact masses and momenta, in the hadron's own frame. */
const RIP_E = 900; // MeV
const RIP_B = { duu: ['p'], ddu: ['n'], uuu: ['p', 'pi+'], ddd: ['n', 'pi-'], dsu: ['Lam'], suu: ['Sig+'], dds: ['Sig-'], ssu: ['Xi0'], dss: ['Xi-'], sss: ['Omg-'] };
function ripTokens(content) { // quark content (capitals: antiquarks) → what it comes out as
  const qs = [...content], up = (c) => c === c.toUpperCase();
  if (qs.length === 3) { const t = RIP_B[qs.map(c => c.toLowerCase()).sort().join('')]; return t ? (up(qs[0]) ? t.map(conjTok) : t.slice()) : null; }
  const q = qs.find(c => !up(c)), a = qs.find(up);
  if (qs.length !== 2 || !q || !a) return null;
  const k = q + a;
  return [k === 'uU' || k === 'dD' ? 'pi0' : k === 'sS' ? 'eta' : k === 'uD' ? 'pi+' : k === 'dU' ? 'pi-' : k === 'uS' ? 'K+' : k === 'sU' ? 'K-' : rnd() < 0.5 ? 'K0S' : 'K0L'];
}
const RIP_NUC = { p: 1, n: 1, pbar: 1, nbar: 1 };
/* tg: { p, which } a nucleon ('p' or 'n') of a nucleus or atom in W.parts, or { o } an unstable hadron in flight.
   rest, meson: the quark contents left and pulled away. Returns { txt, sel, selX } or null if it cannot happen. */
function quarkRip(tg, rest, meson) {
  const R1 = ripTokens(rest), M1 = ripTokens(meson);
  if (!R1 || !M1) return null;
  const items = [], moms = [];
  if (tg.o) {
    const o = tg.o;
    if (o.dead || !XP[o.sp] || W.exo.indexOf(o) < 0) return null;
    const toks = [...R1, ...M1], its = toks.map(item), K = o.KE / MEV, pm = Math.sqrt(Math.max(0, K * (K + 2 * o.m))), E = o.m + K;
    const Ms = o.m + RIP_E, vs = phaseSpace(Ms, its.map(massOf));
    if (!vs) return null;
    const bx = pm * o.ux / E, by = pm * o.uy / E, bz = W.d3 ? pm * o.uz / E : 0; // (bz: 3-D, 1.25)
    its.forEach((it, i) => { items.push(it); moms.push(toLab(vs[i], bx, by, bz)); });
    const x = o.x, y = o.y, txt = `${o.lab} → ${summarize(items)}`, S = nucBegin([]);
    o.dead = true; o.fate = 'pulled apart by hand: ' + txt;
    const made = spawnItems(items, moms, x, y, o.z);
    closeEvent(S, made, x, y, (Ms * E / o.m) * MEV, o.m * MEV);
    return ripDone(x, y, txt, [o.lab], items, made, R1[0], o.z);
  }
  const p = tg.p;
  if (!p || p.dead || p.k !== NUC || p.Z + p.N < 1) return null;
  const anti = !!p.anti, pulledP = tg.which === 'p';
  let Z = p.Z - (pulledP ? 1 : 0), N = p.N - (pulledP ? 0 : 1);
  if (Z < 0 || N < 0) return null;
  const fly = M1.slice();
  if (RIP_NUC[R1[0]]) { if (R1[0] === 'p' || R1[0] === 'pbar') Z++; else N++; fly.push(...R1.slice(1)); } else fly.push(...R1);
  const A = Z + N, Ex = A >= 2 ? 15 * rnd() : 0, mres = A ? nucMeV(Z, N) + Ex : 0;
  const P = p4of(p, true), m0 = nucMeV(p.Z, p.N), Ms = m0 + RIP_E, fits = fly.map(item);
  const vs = phaseSpace(Ms, A ? [mres, ...fits.map(massOf)] : fits.map(massOf));
  if (!vs) return null;
  const bx = P[1] / P[0], by = P[2] / P[0], bz = (P[3] || 0) / P[0];
  let j = 0;
  const li = fits.findIndex(it => it.t === 'x' && it.sp === 'Lam'); // (a Λ too slow to leave the nucleus stays in it: a hypernucleus)
  if (A >= 2 && li >= 0 && !anti && hypCatch(Z, N, mres, vs[0], vs[li + 1], bx, by, items, moms, bz)) {
    fits.forEach((it, k) => { if (k !== li) { items.push(it); moms.push(toLab(vs[k + 1], bx, by, bz)); } });
  } else {
    if (A) residualInto(Z, N, mres, toLab(vs[j++], bx, by, bz), anti, items, moms);
    for (const it of fits) { items.push(it); moms.push(toLab(vs[j++], bx, by, bz)); }
  }
  const x = p.x, y = p.y, z = p.z, gh = [ghostOf(p)], ins = [partLabel(p)], ne = p.ne, partners = [];
  for (const bd of p.bonds) partners.push(other(bd, p));
  const txt = `${ins[0]} → ${summarize(items)}`, S = nucBegin([p]);
  kill(p);
  const made = spawnItems(items, moms, x, y, z); // (z: 3-D, 1.25)
  if (ne > 0) { // its electrons stay with the nuclei left, heaviest first; any over go free
    let left = ne;
    for (const q of made.ps.filter(q => q.k === NUC && q.Z > 0).sort((a, b) => b.Z - a.Z)) { if (left <= 0) break; const k = Math.min(left, q.Z); q.ne = k; left -= k; refresh(q); }
    for (let i = 0; i < left && W.parts.length < MAX_PARTS; i++) { const [ux, uy, uz = 0] = rdir(); const e = addLepton(anti ? POS : ELEC, x + 0.3 * ux, y + 0.3 * uy, 0, 0, z + 0.3 * uz); setMotion(e, 2 + 8 * rnd(), ux, uy, 0, 0, uz); made.ps.push(e); } // (uz: 3-D, 1.25)
  }
  relink(partners.filter(q => !q.dead));
  closeEvent(S, made, x, y, (Ms - m0) * (P[0] / m0) * MEV, 0);
  nucEvent('reaction', x, y, txt, gh, 'a quark pulled out by hand', undefined, z);
  return ripDone(x, y, txt, ins, items, made, RIP_NUC[R1[0]] ? null : R1[0], z);
}
function ripDone(x, y, txt, ins, items, made, hyp, z = 0) { // (z: the event's caption and flash at its depth in 3-D; they were put at z = 0, 1.26 sweep)
  log('nuc', `${txt} (a quark pulled out by hand)`);
  flash(x, y, [255, 200, 160], 4, 0.6, z);
  W.count.nreact++;
  tally(items, ins, txt);
  const xo = hyp ? made.xs.find(o => o.sp === hyp) : null;
  const nucs = made.ps.filter(q => q.k === NUC).sort((a, b) => (b.Z + b.N) - (a.Z + a.N));
  return { txt, selX: xo ? { kind: 'exo', o: xo } : null, sel: xo ? null : nucs[0] || null };
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
    const Mr = mr + (U - eps), u = rdir(), [v1, v2] = twoBody(Ms, mx, Mr, ...u), bx = P[1] / P[0], by = P[2] / P[0], bz = (P[3] || 0) / P[0];
    items.push({ t: 'A', Z: z, N: n, anti }); moms.push(toLab(v1, bx, by, bz));
    P = toLab(v2, bx, by, bz); Ms = Mr; Z -= z; N -= n;
  }
  gammaOut(Z, N, Ms, P, anti, items, moms);
}
/* The residue: what is left of its excitation leaves as a few γ rays. */
function gammaOut(Z, N, Ms, P, anti, items, moms) {
  const mgs = nucMeV(Z, N);
  for (let k = 1; Ms - mgs > 1e-4 && k <= 3; k++) {
    const Es = Ms - mgs, Mi = k < 3 && Es > 3 ? mgs + Es * (0.3 + 0.4 * rnd()) : mgs;
    const u = rdir(), [vg, vr] = twoBody(Ms, 0, Mi, ...u), bx = P[1] / P[0], by = P[2] / P[0], bz = (P[3] || 0) / P[0];
    items.push({ t: 'g' }); moms.push(toLab(vg, bx, by, bz));
    P = toLab(vr, bx, by, bz); Ms = Mi;
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
    const u = rdir(), [v1, v2] = twoBody(Ms, m1 + E1, m2 + Ex - E1, ...u), bx = P[1] / P[0], by = P[2] / P[0], bz = (P[3] || 0) / P[0];
    compoundDecay(Z1, N1, m1 + E1, toLab(v1, bx, by, bz), anti, items, moms, depth + 1);
    compoundDecay(Z2, N2, m2 + Ex - E1, toLab(v2, bx, by, bz), anti, items, moms, depth + 1);
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
    let lg = 0, sm = 0, lm = 0; const cnt = {};
    for (const i of list) { const [fz, fn, g] = FBF[i], m = nucMeV(fz, fn); lg += Math.log(g) + Math.log(m); sm += m; lm += Math.log(m); cnt[i] = (cnt[i] || 0) + 1; }
    for (const c of Object.values(cnt)) lg -= lnFact(c);
    return { list, lg, sm, lm, n: list.length }; // (lm: Σ ln m alone, for the 3-D weights, 1.25)
  });
  _fbCache.set(key, out);
  return out;
}
function fermiInto(Z, N, Ms, P, anti, items, moms, keep) { // keep(pt): which ways apart are allowed (all, if not given)
  const A = Z + N, R = 1.4 * Math.cbrt(A), c0 = Math.log(2 * Math.PI * R * R / (4 * Math.PI * Math.PI * 197.327 * 197.327) * 2 * Math.PI);
  const opts = [];
  if (W.d3) { // (3-D, 1.25: Fermi's weights in three dimensions, (V/(2πħ)³)^(n−1)·(2π)^(3(n−1)/2)/Γ(3(n−1)/2)·Πg/G·(Πm/M)^(3/2)·E^((3n−5)/2), V the volume of a ball of radius 1.4·A^⅓ fm, doubled)
    const c3 = Math.log(2 * 4 / 3 * Math.PI * R * R * R / Math.pow(2 * Math.PI * 197.327, 3) * Math.pow(2 * Math.PI, 1.5));
    for (const pt of fermiParts(Z, N)) { const E = Ms - pt.sm, n = pt.n; if (E > 0 && (!keep || keep(pt))) opts.push([(n - 1) * c3 + (pt.lg - pt.lm) + 1.5 * (pt.lm - Math.log(Ms)) - lnGamma(1.5 * (n - 1)) + (1.5 * n - 2.5) * Math.log(E), pt]); }
  } else
  for (const pt of fermiParts(Z, N)) { const E = Ms - pt.sm; if (E > 0 && (!keep || keep(pt))) opts.push([(pt.n - 1) * c0 + pt.lg - Math.log(Ms) - lnFact(Math.max(0, pt.n - 2)) + (pt.n - 2) * Math.log(E), pt]); }
  if (!opts.length) return false;
  const top = Math.max(...opts.map(o => o[0])), pt = pickBr(opts.map(([l, p]) => [Math.exp(l - top), p]));
  const its = pt.list.map(i => ({ t: 'A', Z: FBF[i][0], N: FBF[i][1], anti })), vs = phaseSpace(Ms, its.map(massOf));
  if (!vs) return false;
  const bx = P[1] / P[0], by = P[2] / P[0], bz = (P[3] || 0) / P[0];
  its.forEach((it, i) => { items.push(it); moms.push(toLab(vs[i], bx, by, bz)); });
  return true;
}
/* Deep-inelastic collisions and quasi-fission: the touching nuclei exchange nucleons (a few, or towards equal masses
   when they stay together long enough), their motion is damped, and they part again, hot, near the Coulomb energy
   of the two touching fragments. */
function binaryInto(a, b, M, P, Pa, anti, items, moms, Ecm, VB, quasi) {
  const Z1 = a.Z, A1 = a.Z + a.N, ZT = a.Z + b.Z, NT = a.N + b.N, AT = ZT + NT;
  const bx = P[1] / P[0], by = P[2] / P[0], bz = (P[3] || 0) / P[0], d = toRest(Pa, bx, by, bz), dn = pmag(d) || 1;
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
    const u = turnU(d.slice(1).map(c => c / dn), (rnd() - 0.5) * (quasi ? 2.4 : 0.9)); // (3-D: turned about an axis across it, 1.25)
    const [v1, v2] = twoBody(M, mf + Ef, mg + Ex - Ef, ...u);
    compoundDecay(Zf, Nf, mf + Ef, toLab(v1, bx, by, bz), anti, items, moms, 0);
    compoundDecay(Zg, Ng, mg + Ex - Ef, toLab(v2, bx, by, bz), anti, items, moms, 0);
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
      s.Ps = W.d3 ? s.P.map(c => c * k) : [s.P[0] * k, s.P[1] * k, s.P[2] * k]; // (3-D: four components, 1.25)
      F = W.d3 ? F.map((c, i) => c - s.Ps[i]) : [F[0] - s.Ps[0], F[1] - s.Ps[1], F[2] - s.Ps[2]];
    }
    if (!(F[0] > 0)) continue;
    const MF = mass4(F), epsP = (MF - Bp * 938.9) / Bp;
    if (!(epsP > 0)) continue;
    const fx = F[1] / F[0], fy = F[2] / F[0], fz = (F[3] || 0) / F[0], Ab = toRest(Pa, fx, fy, fz), Lb = Math.hypot(Ab[1], Ab[2]) || 1, bax = Ab[1] / Lb, bay = Ab[2] / Lb, ax3 = unit3(Ab); // (the beams' axis, in the fireball's frame; ax3: in 3-D, 1.25)
    let fb, vs;
    if (epsP >= QGP.eps && Bp >= QGP.minA) { // the overlap melts into a quark–gluon plasma, which freezes out into hadrons
      const sNN = 2 * (epsP + 938.9), q = qgpHadrons(MF, Bp, Qp, sNN);
      if (!q) continue;
      fb = anti ? q.items.map(conjItem) : q.items;
      { const ri = fb.length <= 4000 ? resonate(fb, MF) : fb, v2 = jetMomenta(ri, MF, bax, bay, { thermal: true, ax3 }); if (v2) { fb = ri; vs = v2; } else vs = jetMomenta(fb, MF, bax, bay, { thermal: true, ax3 }); }
      if (!vs) continue;
      for (let i = fb.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [fb[i], fb[j]] = [fb[j], fb[i]]; [vs[i], vs[j]] = [vs[j], vs[i]]; } // (shuffled: if not all fit in the chamber, those that do are a fair sample)
      _qgpLast = { n: q.items.length, sNN, muB: q.muB, Bp }; // (the hadrons it froze into: resonances counted as what they become)
    } else {
      fb = hadronize(MF, anti ? -Bp : Bp, anti ? -Qp : Qp, { pFrac: Qp / Bp, clusters: epsP });
      if (!fb) continue;
      vs = null;
      if (epsP > 2000 && fb.length >= 3) { const ri = resonate(fb, MF), v2 = jetMomenta(ri, MF, bax, bay, { lead: isBaryonItem, ptScale: 0.7, ax3 }); if (v2) { fb = ri; vs = v2; } } // (high energy: along the beams, as strings stretch)
      if (!vs) vs = phaseSpace(MF, fb.map(massOf));
      if (!vs) continue;
    }
    fb.forEach((it, i) => { items.push(it); moms.push(toLab(vs[i], fx, fy, fz)); });
    for (const s of sd) if (s.Ps) compoundDecay(s.Zs, s.Ns, s.Ms, s.Ps, anti, items, moms, 0);
    return true;
  }
  return false;
}

/* ---- the intranuclear cascade (Settings → Experimental, 1.08): a nucleon striking a nucleus (A > 16) at 40 MeV to
   10 GeV a nucleon is followed collision by collision through it, instead of the participant fireball above. In the
   nucleus's own frame its nucleons sit at random in a disc of radius 1.2·A^⅓ fm (the world is flat) and move with
   Fermi momenta up to 260 MeV/c. A fast particle meets the first nucleon whose distance from its path is inside
   ρ₀σ/2n (n the nucleons per fm² of the flat nucleus, ρ₀ = 0.16 fm⁻³: so the mean free path is nuclear matter's,
   1/(ρ₀σ), about 1.5 fm, and not the much shorter one of nucleons packed into a disc) (σ the nucleon–nucleon cross section at their energy: the measured tables above 290 MeV, 25 + 4500·(1/T −
   1/290) mb below, about the mean of pp and np); the pair scatters (elastic, forward-peaked when fast) or, with the
   inelastic share of σ and energy enough, makes a pion; an outcome that would put a nucleon inside the Fermi sea is
   forbidden (Pauli blocking) and the particle flies on. Struck nucleons cascade in turn. A nucleon reaching the
   surface leaves if it has more than 45 MeV (the depth of the well it climbs out of, given up; the projectile gained
   it falling in), and stays otherwise;
   pions leave. What is left is the residual nucleus, with exactly the energy and momentum that did not leave: its
   excitation is what the cascade deposited, and it cools as any (compoundDecay: neutrons, protons, α, fission).
   Returns 'pass' if it goes through without meeting a nucleon (twice running: nothing happens), false (the fireball
   model is used) if no consistent outcome turns up in a few tries. */
let INC_ON = false;
const INC_PF = 260, INC_U = 45, INC_MN = 938.9;
function incSigma(sqs) { // mb: nucleon–nucleon total, by the pair's invariant mass
  const T = Math.max(1, (sqs * sqs - 4 * INC_MN * INC_MN) / (2 * INC_MN));
  return T >= 290 ? nnTable(NN_TOT, sqs) : 25 + 4500 * (1 / T - 1 / 290);
}
function cascadeInto(proj, targ, Pp, Pt, b3, items, moms) {
  const Zt = targ.Z, Nt = targ.N, At = Zt + Nt, R = 1.2 * Math.cbrt(At), Ptot = add4(Pp, Pt);
  const tx = Pt[1] / Pt[0], ty = Pt[2] / Pt[0], tz = (Pt[3] || 0) / Pt[0], P0 = toRest(Pp, tx, ty, tz), p0 = Math.hypot(P0[1], P0[2]);
  if (!(p0 > 0)) return false;
  const cu = P0[1] / p0, su = P0[2] / p0; // (the cascade is worked out with the projectile along +x, then turned back)
  const back = (E, kx, ky) => toLab([E, kx * cu - ky * su, kx * su + ky * cu], tx, ty, tz);
  let passed = 0;
  for (let att = 0; att < 6; att++) {
    const nx = new Float64Array(At), ny = new Float64Array(At), kx = new Float64Array(At), ky = new Float64Array(At), isP = new Uint8Array(At), hit = new Uint8Array(At);
    for (let i = 0; i < At; i++) {
      const r = R * Math.sqrt(rnd()), t = 2 * Math.PI * rnd(), k = INC_PF * Math.sqrt(rnd()), s = 2 * Math.PI * rnd();
      nx[i] = r * Math.cos(t); ny[i] = r * Math.sin(t); kx[i] = k * Math.cos(s); ky[i] = k * Math.sin(s); isP[i] = i < Zt ? 1 : 0;
    }
    // the moving particles: [x, y, kx, ky, m, kind ('N' or a pion), charge, last nucleon met]
    const T0 = Math.hypot(INC_MN, p0) - INC_MN + INC_U, pIn = Math.sqrt(T0 * (T0 + 2 * INC_MN)); // (falling into the well it gains its depth, as it gives it up again leaving)
    const mv = [{ x: -R - 0.5, y: (rnd() < 0.5 ? -1 : 1) * Math.min(b3, R), kx: pIn, ky: 0, m: INC_MN, nuc: true, q: proj.Z, last: -1 }];
    const out = []; let nColl = 0, ok = true;
    const rMfp = 0.16 / 10 / (2 * At / (Math.PI * R * R)); // (a nucleon is met within σ·rMfp of the path: the mean free path of nuclear matter, 1/(ρ₀σ), ρ₀ = 0.16 fm⁻³, in a nucleus laid flat)
    while (mv.length && ok) {
      const c = mv.pop(), kk = Math.hypot(c.kx, c.ky);
      if (!(kk > 0)) { if (c.nuc) continue; ok = false; break; }
      const ux = c.kx / kk, uy = c.ky / kk, E1 = Math.hypot(c.m, kk);
      // the surface ahead
      const bq = c.x * ux + c.y * uy, cq = c.x * c.x + c.y * c.y - R * R, disc = bq * bq - cq, sExit = disc > 0 ? -bq + Math.sqrt(disc) : 0;
      let best = -1, bs = sExit, sig = 0;
      if (c.nuc && nColl < 400) for (let j = 0; j < At; j++) {
        if (hit[j] || j === c.last) continue;
        const rx = nx[j] - c.x, ry = ny[j] - c.y, s = rx * ux + ry * uy; if (s <= 0 || s >= bs) continue;
        const d = Math.abs(rx * uy - ry * ux), E2 = Math.hypot(INC_MN, kx[j], ky[j]), sqs = mass4([E1 + E2, c.kx + kx[j], c.ky + ky[j]]), sg = incSigma(sqs);
        if (d < sg * rMfp) { best = j; bs = s; sig = sg; }
      }
      if (best < 0) { // at the surface: out, or caught
        if (!c.nuc) { out.push(c); continue; }
        const T = E1 - c.m;
        if (T > INC_U) { const k2 = Math.sqrt(Math.max(0, (T - INC_U) * (T - INC_U + 2 * c.m))); out.push({ ...c, kx: ux * k2, ky: uy * k2 }); }
        continue; // (too slow to climb out: it stays, and its energy heats the residual nucleus)
      }
      const j = best, cx = c.x + ux * bs, cy = c.y + uy * bs, E2 = Math.hypot(INC_MN, kx[j], ky[j]);
      const Pp2 = [E1 + E2, c.kx + kx[j], c.ky + ky[j]], sqs = mass4(Pp2), bx = Pp2[1] / Pp2[0], by = Pp2[2] / Pp2[0], bz = (Pp2[3] || 0) / Pp2[0];
      const A1 = toRest([E1, c.kx, c.ky], bx, by, bz), pcm = Math.hypot(A1[1], A1[2]);
      let fin; // [[m, kx, ky (frame of the nucleus), nucleon?, charge]]
      const qTot = c.q + isP[j];
      if (rnd() < nnTable(NN_INEL, sqs) / sig && sqs > 2 * INC_MN + 140) { // a pion made
        const opts = [-1, 0, 1].filter(qp => qTot - qp >= 0 && qTot - qp <= 2), qp = opts[Math.floor(rnd() * opts.length)], mp = qp ? 139.57 : 134.98;
        const vs = phaseSpace(sqs, [INC_MN, INC_MN, mp]); if (!vs) { c.x = cx; c.y = cy; c.last = j; mv.push(c); continue; }
        const nP = qTot - qp, q1 = nP >= 1 ? 1 : 0, q2 = nP - q1;
        fin = vs.map((v, i) => { const L = toLab(v, bx, by, bz); return [i < 2 ? INC_MN : mp, L[1], L[2], i < 2, i === 0 ? q1 : i === 1 ? q2 : qp]; });
      } else { // elastic: isotropic when slow, forward when fast (diffraction off a nucleon, about 1 fm)
        const th = pcm < 300 ? 2 * Math.PI * rnd() : gauss() * 197.327 / (pcm * 1.0), cs = Math.cos(th), sn = Math.sin(th);
        const qx = A1[1] * cs - A1[2] * sn, qy = A1[1] * sn + A1[2] * cs, ea = Math.hypot(c.m, pcm), eb = Math.hypot(INC_MN, pcm);
        const L1 = toLab([ea, qx, qy], bx, by, bz), L2 = toLab([eb, -qx, -qy], bx, by, bz);
        fin = [[c.m, L1[1], L1[2], c.nuc, c.q], [INC_MN, L2[1], L2[2], true, isP[j]]];
      }
      if (fin.some(f => f[3] && Math.hypot(f[1], f[2]) < INC_PF)) { c.x = cx; c.y = cy; c.last = j; mv.push(c); continue; } // (Pauli: blocked; it flies on from there)
      hit[j] = 1; nColl++;
      for (const [m, fx, fy, nuc, q] of fin) mv.push({ x: cx, y: cy, kx: fx, ky: fy, m, nuc, q, last: j });
    }
    if (!nColl) { if (++passed >= 2) return 'pass'; continue; } // (it went through without meeting a nucleon: nuclear matter is not opaque)
    if (!ok) continue;
    // what left, in the lab; the residual takes exactly the rest
    let Zr = Zt + proj.Z, Ar = At + 1, Pr = Ptot.slice(); const its = [], ms = [];
    for (const o of out) {
      const E = Math.hypot(o.m, o.kx, o.ky), L = back(E, o.kx, o.ky);
      its.push(o.nuc ? { t: 'A', Z: o.q, N: 1 - o.q, anti: false } : item(o.q > 0 ? 'pi+' : o.q < 0 ? 'pi-' : 'pi0')); ms.push(L);
      Pr = [Pr[0] - L[0], Pr[1] - L[1], Pr[2] - L[2]]; Zr -= o.q; if (o.nuc) Ar--;
    }
    const Nr = Ar - Zr;
    if (Ar < 1 || Zr < 0 || Nr < 0 || !(Pr[0] > 0)) continue;
    const Mr = mass4(Pr), Ex = Mr - nucMeV(Zr, Nr);
    if (!(Ex >= 0) || Ex > 15 * Ar + 50) continue; // (no consistent residual: draw again)
    for (let i = 0; i < its.length; i++) { items.push(its[i]); moms.push(ms[i]); }
    residualInto(Zr, Nr, Mr, Pr, false, items, moms);
    _incLast = { coll: nColl, out: its.length, Ex, Zr, Ar };
    return true;
  }
  return false;
}
let _incLast = null;
/* ---- reach. A nucleus is hit where it is drawn: the nucleus view draws it with every nucleon 0.045 Å across (the
   nuclear scale enlarged, as everything nuclear here), so its radius is 0.045·r(A), r(A) the packed cluster's radius
   in nucleon radii; a pass inside the sum of two radii (and never less than the reaches set for light nuclei) is a
   nuclear encounter, mapped onto real impact parameters as above. */
function nucDrawR(p) { if (p.k !== NUC) return 0; const A = p.Z + p.N; return 0.045 * (A <= 1 ? 1.12 : Math.sqrt((A - 0.5) / 0.82) + 1.12); }
function nucReach(a, b) { return W.ultra ? ultraReach(a, b) : Math.max(a.Z === 0 || b.Z === 0 ? R_NN : R_FUS, nucDrawR(a) + nucDrawR(b)); }
/* ---- the ultra-realistic mode (W.ultra, 1.03): nothing enlarged. A nucleus is 1.2·A^⅓ fm across in radius (1 fm =
   10⁻⁵ Å), and a pass meets it at its true distance: inside the two radii and the reach of the strong force (2 fm),
   and, for a neutron, its wavelength ƛ = ħ/p as well (4.55 fm/√(E/MeV): 0.29 Å for a thermal neutron, which is why
   slow neutrons are caught so much more readily than fast ones). Passes are mapped onto impact parameters one to one
   (nuclearEncounter), not stretched over the enlarged reach. */
const FM = 1e-5; // Å per fm
function trueRfm(p) { if (p.k !== NUC) return 0; const A = p.Z + p.N; return A <= 1 ? 0.88 : 1.2 * Math.cbrt(A); }
function relKE(a, b) { const ka = keOf(a), kb = keOf(b), ma = bMu(a), mb = bMu(b); return (ka * mb + kb * ma) / (ma + mb); } // eV, about: their relative motion's energy
function ultraReach(a, b) {
  let R = trueRfm(a) + trueRfm(b) + 2;
  if (a.Z === 0 || b.Z === 0) R += 4.55 / Math.sqrt(Math.max(1e-3, relKE(a, b)) * 1e-6);
  return R * FM;
}
