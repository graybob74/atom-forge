'use strict';
/* The checks for 1.27's W and Z bosons (PERF-NOTES, "1.27: W and Z bosons (electroweak)"), run by t_features (one line)
   or alone: node tests/f_ew.js [--node] [part …]. Every part but fp fails on v145 (no W or Z there); fp shows the setups
   that stay below the threshold unchanged, bit for bit. Parts that need the page are skipped with --node.
   (page: the t_features page; check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;
const chg = (X) => { const W = X.W; let q = (W.ledger.qOut || 0) + (W.ledger.qWall || 0); for (const p of W.parts) if (!p.dead) q += p.q; for (const o of W.exo) if (!o.dead) q += o.q; return Math.round(q * 1e6) / 1e6; }; // (the charge, kept and gone)
const fresh = (X, d3) => { const W = X.W; X.PRESETS[d3 ? 'd3empty' : 'empty'].build(); W.T = 0; W.gamma = 0; W.decayOn = false; W.wall = 'open'; W.collider = { made: {} }; };
const clear = (X) => { const W = X.W; for (const p of W.parts) X.kill(p); W.parts = []; W.exo = []; W.rays = []; X.forcesNoEvents(); };
const h = (s) => { let a = 0x811c9dc5; for (let i = 0; i < s.length; i++) { a ^= s.charCodeAt(i); a = Math.imul(a, 0x01000193); } return (a >>> 0).toString(16).padStart(8, '0'); };
const sig3 = (n, k) => 3 * Math.sqrt(Math.max(1, n * k * (1 - k))); // (three standard deviations of a count of n at odds k)
/* An electron and a positron head-on at √s = rs (GeV), met at once (eeEvent); then anything made decays (moveExos). */
function eePair(X, rs, d3) {
  clear(X);
  const e = X.addLepton(X.ELEC, -0.01, 0), p = X.addLepton(X.POS, 0.01, 0), K = rs / 2 * 1e9 - 0.51099895e6;
  if (d3) { X.setMotion(e, K, 0.6, 0, 0, 0, 0.8); X.setMotion(p, K, -0.6, 0, 0, 0, -0.8); } else { X.setMotion(e, K, 1, 0); X.setMotion(p, K, -1, 0); }
  X.forcesNoEvents();
  const E0 = books(X);
  X.eeEvent(e, p, 0, 0);
  const made = X.W.exo.filter(o => !o.dead).map(o => o.sp), E1 = books(X);
  X.moveExos(1e-9);
  return { made, d: Math.max(Math.abs(E1 - E0), Math.abs(books(X) - E0)) / (rs * 1e9) };
}

/* Below their thresholds nothing changes: the fingerprints (tools/fingerprint.js: seed 7, 300 steps) of the setups with
   collisions, beams, decays and annihilation, and of water flat and in 3-D, equal v145's (all 59 were compared when this
   was built: none changed; RHIC's gold at 200 GeV per nucleon pair draws for a W or Z in its plasma, but no fireball forms
   within 300 steps). */
// (1.27 bug 2: pionbeam, hyperfactory and annihilation re-fingerprinted, switches off: molecules give electrons at their measured ionization energies, from their hole atom)
// (1.27 bug 3: fusion, nif, pionbeam, annihilation and sns re-fingerprinted, switches off: close passes between nuclei turned at nuclear distances)
// (1.27 bug 4: sns re-fingerprinted, switches off: fast positrons ionize and scatter as electrons do, annihilating in flight at Heitler's rate)
// (1.27 bug 7: photonuc, sns and hyperfactory re-fingerprinted, switches off: X-rays of 10–100 keV meet atoms by their Compton and photoelectric cross sections; Compton's mₑc² exact)
// (1.27 bug 15: pionbeam and photonuc re-fingerprinted, switches off: events in the electrons' short steps search a grid rebuilt after they moved)
const FP_V145 = { rhic: 'fb7e8382 a9f2ee3a', ring: 'bdaf576a a9f2ee3a', linac: '7c6eb010 2b70ae2c', dafne: '793dfacd 43026f16', annihilation: 'e4757e0e 969a7381', pionbeam: '44ace447 453510b1', photonuc: '4a48e008 9aa817a9', hyperfactory: '18051e94 0fac2f8d', antihydrogen: '4020342f 328d44f9', chain: '4b24bd95 a9f2ee3a', isolde: '510ea801 d3061743', sns: '25bd9c41 f9d613c8', water: 'cac1ac32 a9f2ee3a', water3d: '7a2e7f5c a9f2ee3a' };
PARTS.fp = async (page, check) => {
  const bad = [];
  for (const k of Object.keys(FP_V145)) {
    const X = load('all', { seed: 7 }), W = X.W, P = X.PRESETS[k];
    P.build(); if (X.ultraHold) X.ultraHold(); if (X.mode3dSync) try { X.mode3dSync(); } catch (e) { /* (no page) */ }
    X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned;
    for (let i = 0; i < 300; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
    const parts = W.parts.filter(p => !p.dead).map(p => [p.k, p.Z, p.N, p.ne, p.x, p.y, p.z || 0, p.vx, p.vy, p.vz || 0, p.KE || 0].join(',')).join(';');
    const exo = W.exo.filter(o => !o.dead).map(o => [o.sp, o.x, o.y, o.KE].join(',')).join(';');
    const got = h(parts + '|' + exo + '|' + W.bonds.length) + ' ' + h(JSON.stringify(W.ledger));
    if (got !== FP_V145[k]) bad.push(`${k} ${got} (v145 ${FP_V145[k]})`);
  }
  check(!bad.length, `1.27 W and Z: every setup below their thresholds as in v145 (fingerprints of ${Object.keys(FP_V145).join(', ')})`, 'ew fp: ' + JSON.stringify(bad));
};
/* The Z peak in e⁺e⁻: σ(hadrons) 41.5 nb and σ(μμ) 2.00 nb at 91.19 GeV (Born), its Breit–Wigner shape at 88 and 94 GeV,
   and the share of collisions that make a Z at each (eeEvent, against its own cross sections); A_FB(μμ) from the γ–Z
   interference negative below the peak, +0.016 on it, positive above, and drawn so (3-D). */
PARTS.peak = async (page, check) => {
  const X = load('all', { seed: 3 }); fresh(X, false);
  const r = {};
  const tot = (g) => { const s = g * g, H = X.hadronParts(s), e = X.ewEE(s); return { Z: e.Z, all: X.sigGG(s, 0) + X.sigLL(s, X.XP['mu-'].m / 1000) + X.sigLL(s, X.XP['tau-'].m / 1000) + H.rho + H.omega + H.phi + H.cont + H.cc + H.bb + e.Z + e.WW + e.ZZ }; };
  const pk = X.ewEE(91.1876 ** 2);
  r.had = +(pk.Z * 0.69911).toFixed(2); r.mm = +(pk.Z * 0.033662).toFixed(3);
  r.r88 = +(X.ewEE(88 * 88).Z / pk.Z).toFixed(3); r.r94 = +(X.ewEE(94 * 94).Z / pk.Z).toFixed(3);
  let ok = Math.abs(r.had - 41.5) < 0.1 && Math.abs(r.mm - 2.0) < 0.01 && Math.abs(r.r88 - 0.130) < 0.003 && Math.abs(r.r94 - 0.167) < 0.003;
  for (const g of [88, 91.1876, 94]) {
    const n = 250, T = tot(g), k = T.Z / T.all; let z = 0;
    for (let i = 0; i < n; i++) if (eePair(X, g, false).made.includes('Z0')) z++;
    r['z' + g] = `${z}/${n} (expected ${(n * k).toFixed(0)})`;
    if (Math.abs(z - n * k) > sig3(n, k) + 1) ok = false;
  }
  r.afb = [88, 91.1876, 94].map(g => +X.ewAfb(g * g, -1, -0.5).toFixed(3));
  ok = ok && r.afb[0] < -0.2 && Math.abs(r.afb[1] - 0.0163) < 0.002 && r.afb[2] > 0.2;
  const Y = load('all', { seed: 4 }); fresh(Y, true);
  const A = Y.ewAfb(94 * 94, -1, -0.5), f = Y.ewAng(A); let F = 0; const n = 20000;
  for (let i = 0; i < n; i++) if (Y.ewDir([1, 0, 0], f)[0] > 0) F++;
  r.afbDrawn = +((2 * F - n) / n).toFixed(3);
  ok = ok && Math.abs(r.afbDrawn - A) < 3 / Math.sqrt(n);
  check(ok, `1.27 W and Z: the Z peak σ(hadrons) ${r.had} nb, σ(μμ) ${r.mm} nb at 91.19 GeV, ${r.r88} and ${r.r94} of it at 88 and 94 GeV; Zs made ${r.z88}, ${r['z91.1876']}, ${r.z94}; A_FB(μμ) ${r.afb.join(', ')} (drawn at 94 GeV in 3-D: ${r.afbDrawn})`, 'ew peak: ' + JSON.stringify(r));
};
/* The branching fractions (100,000 decays each, hadronic ones only counted): Z → hadrons : μμ 20.77, invisible 20.0%,
   each charged lepton 3.37%; W → each ℓν 10.6–11.4%, hadrons 67.4%. Hadronic decays make hadrons, two jets, with
   charm and bottom at their shares. */
PARTS.branch = async (page, check) => {
  const X = load('all', { seed: 5 }); fresh(X, false);
  const hz = X.hadronize; let nh = 0; X.hadronize = () => { nh++; return null; };
  const cnt = (sp, n) => { const c = {}; nh = 0; for (let i = 0; i < n; i++) { const f = X.ewFinal(sp, X.XP[sp].m, null, 0); const k = f ? f.items.map(it => X.labelOf(it)).join(' ') : 'had'; c[k] = (c[k] || 0) + 1; } return c; };
  const n = 100000, z = cnt('Z0', n), w = cnt('W+', n);
  X.hadronize = hz;
  const inv = (z['νₑ ν̄ₑ'] || 0) + (z['νμ ν̄μ'] || 0) + (z['ντ ν̄τ'] || 0);
  const r = { hadmm: +(z.had / z['μ⁻ μ⁺']).toFixed(2), inv: +(inv / n).toFixed(4), ee: +(z['e⁻ e⁺'] / n).toFixed(4), tt: +(z['τ⁻ τ⁺'] / n).toFixed(4), Wen: +(w['e⁺ νₑ'] / n).toFixed(4), Wmn: +(w['μ⁺ νμ'] / n).toFixed(4), Wtn: +(w['τ⁺ ντ'] / n).toFixed(4), Whad: +(w.had / n).toFixed(4) };
  // real hadronic decays: hadrons in two jets, books exact; bottom and charm among them
  let nb = 0, nc = 0, nmin = 1e9, nmax = 0, mis = 0; const B = /^(B|Bb|Bs|Bsb|Lb|Lbb)/, C = /^(Dc|Ds|Lc)/;
  for (let i = 0; i < 300; i++) {
    const f = X.ewFinal('Z0', 91187.6, null, 0); if (!f || !f.qq) continue;
    nmin = Math.min(nmin, f.items.length); nmax = Math.max(nmax, f.items.length);
    let E = 0, px = 0, py = 0; for (const v of f.vs) { E += v[0]; px += v[1]; py += v[2]; } mis = Math.max(mis, Math.abs(E - 91187.6), Math.hypot(px, py));
    if (f.items.some(it => it.t === 'x' && B.test(it.sp))) nb++; else if (f.items.some(it => it.t === 'x' && C.test(it.sp))) nc++;
  }
  r.jets = { hadrons: `${nmin}–${nmax}`, b: nb, c: nc, mis: +mis.toExponential(1) };
  const ok = Math.abs(r.hadmm - 20.77) < 1.0 && Math.abs(r.inv - 0.2) < 0.004 && Math.abs(r.ee - 0.0336) < 0.0018 && Math.abs(r.tt - 0.0337) < 0.0018 && Math.abs(r.Wen - 0.1071) < 0.003 && Math.abs(r.Wtn - 0.1138) < 0.003 && Math.abs(r.Whad - 0.6741 / 1.0013) < 0.005 && nmin >= 4 && nb > 20 && nc > 15 && mis < 1e-6;
  check(ok, `1.27 W and Z: Z → hadrons : μμ ${r.hadmm} (20.77), invisible ${r.inv}, e⁺e⁻ ${r.ee}, τ⁺τ⁻ ${r.tt}; W⁺ → eν ${r.Wen}, μν ${r.Wmn}, τν ${r.Wtn}, hadrons ${r.Whad}; Z → hadrons: ${r.jets.hadrons} hadrons, bottom in ${nb} and charm in ${nc} of ~210, momenta exact`, 'ew branch: ' + JSON.stringify(r));
};
/* The weak force's handedness: a W⁺'s ℓ⁺ along its spin as (1 + cos θ)², a W⁻'s ℓ⁻ against it (3-D: (F − B)/(F + B) ±0.75;
   flat, in the plane, ±0.849). */
PARTS.vma = async (page, check) => {
  const r = {};
  for (const d3 of [true, false]) {
    const X = load('all', { seed: 6 }); fresh(X, d3); X.EW_HAD['W+'] = [];
    for (const sp of ['W+', 'W-']) {
      let F = 0, n = 0; const ax = d3 ? [0, 0, 1] : [0, 1];
      for (let i = 0; i < 6000; i++) { const f = X.ewFinal(sp, X.XP[sp].m, ax, 0); if (!f) continue; const v = f.vs[0]; n++; if ((d3 ? v[3] : v[2]) > 0) F++; }
      r[(d3 ? '3d' : 'flat') + sp] = +((2 * F - n) / n).toFixed(3);
    }
  }
  const ok = Math.abs(r['3dW+'] - 0.75) < 0.03 && Math.abs(r['3dW-'] + 0.75) < 0.03 && Math.abs(r['flatW+'] - 0.849) < 0.03 && Math.abs(r['flatW-'] + 0.849) < 0.03;
  check(ok, `1.27 W and Z: V − A, a W⁺'s ℓ⁺ along its spin ${r['3dW+']}, a W⁻'s ℓ⁻ ${r['3dW-']} (3-D, ±0.75), ${r['flatW+']}/${r['flatW-']} flat (±0.849)`, 'ew vma: ' + JSON.stringify(r));
};
/* W pairs in e⁺e⁻: none at 150 GeV (below 2M_W = 160.7), at 200 GeV in their share of the cross section (17.0 pb); Z pairs
   none at 175 GeV. */
PARTS.ww = async (page, check) => {
  const X = load('all', { seed: 7 }); fresh(X, false);
  const r = {}; let ok = true;
  for (const [g, n] of [[150, 300], [175, 300], [200, 500]]) {
    let w = 0, zz = 0;
    for (let i = 0; i < n; i++) { const m = eePair(X, g, false).made; if (m.includes('W+') && m.includes('W-')) w++; if (m.filter(s => s === 'Z0').length === 2) zz++; }
    const s = g * g, H = X.hadronParts(s), e = X.ewEE(s), all = X.sigGG(s, 0) + X.sigLL(s, X.XP['mu-'].m / 1000) + X.sigLL(s, X.XP['tau-'].m / 1000) + H.rho + H.omega + H.phi + H.cont + H.cc + H.bb + e.Z + e.WW + e.ZZ, k = e.WW / all;
    r[g] = { WW: w, expect: +(n * k).toFixed(1), ZZ: zz, pb: +(e.WW * 1000).toFixed(1) };
    if (g < 160.7 ? w !== 0 : Math.abs(w - n * k) > sig3(n, k) + 1) ok = false;
    if (g < 182.4 && zz) ok = false;
  }
  check(ok, `1.27 W and Z: e⁺e⁻ → W⁺W⁻ none of 300 at 150 GeV, none at 175 GeV ZZ; at 200 GeV (σ ${r[200].pb} pb) ${r[200].WW} of 500 (expected ${r[200].expect})`, 'ew ww: ' + JSON.stringify(r));
};
/* Masses: drawn from the relativistic Breit–Wigner, Z 2.50 GeV wide at half height (Γ 2.4952), W 2.09 (Γ 2.085), peaks at
   91.19 and 80.37 GeV, all within M ± 10Γ. */
PARTS.widths = async (page, check) => {
  const X = load('all', { seed: 8 }); const r = {}; let ok = true;
  for (const sp of ['Z0', 'W+']) {
    const d = X.XP[sp], ms = []; for (let i = 0; i < 40000; i++) ms.push(X.bwMassRel(sp));
    const bin = 50, H = new Float64Array(2000), o = d.m - 50000; for (const m of ms) H[Math.floor((m - o) / bin)]++;
    const S = (i) => { let t = 0; for (let k = -3; k <= 3; k++) t += H[i + k] || 0; return t / 7; };
    let pk = 0, ip = 0; for (let i = 5; i < 1995; i++) if (S(i) > pk) { pk = S(i); ip = i; }
    let lo = ip, hi = ip; while (S(lo) > pk / 2) lo--; while (S(hi) > pk / 2) hi++;
    r[sp] = { fwhm: (hi - lo) * bin, peak: o + ip * bin + bin / 2, lo: +(Math.min(...ms) / 1000).toFixed(2), hi: +(Math.max(...ms) / 1000).toFixed(2) };
    if (Math.abs(r[sp].fwhm - d.w) > 0.08 * d.w || Math.abs(r[sp].peak - d.m) > 150 || Math.min(...ms) < d.m - 10 * d.w - 1e-6 || Math.max(...ms) > d.m + 10 * d.w + 1e-6) ok = false;
  }
  check(ok, `1.27 W and Z: masses from their widths, Z ${r.Z0.fwhm} MeV at half height (Γ 2,495) about ${(r.Z0.peak / 1000).toFixed(2)} GeV within ${r.Z0.lo}–${r.Z0.hi}, W ${r['W+'].fwhm} MeV (Γ 2,085) about ${(r['W+'].peak / 1000).toFixed(2)} GeV`, 'ew widths: ' + JSON.stringify(r));
};
/* Hadron collisions: p̄p at 1.96 TeV (nnbarEvent) makes Ws and Zs at σ·B 2.75 and 0.256 nb against σ_inel 60.8 mb (with
   RP.ewX = 10⁵ for the test: 4.2% and 1.25% of collisions; at real rates one in 2.4 million and 8 million); pp at 7 TeV
   (nnInelastic) in 3-D; none at 60 GeV (below the threshold, no draw). */
PARTS.hadron = async (page, check) => {
  const r = {}; let ok = true;
  for (const [kind, rs, n, d3] of [['pbar', 1960, 1500, false], ['pp', 7000, 400, true], ['pp', 60, 300, false]]) {
    const X = load('all', { seed: 9 }), W = X.W; fresh(X, d3); X.RP.ewX = 1e5;
    let w = 0, z = 0, ev = 0, worst = 0, qbad = 0;
    for (let k = 0; k < n; k++) {
      clear(X);
      const a = X.addNuc(1, 0, 0, -0.01, 0, 0, 0, kind === 'pbar'), b = X.addNuc(1, 0, 0, 0.01, 0, 0, 0, false), K = (rs / 2 * 1000 - 938.272) * 1e6;
      if (d3) { X.setMotion(a, K, 0, 0.6, 0, 0, 0.8); X.setMotion(b, K, 0, -0.6, 0, 0, -0.8); } else { X.setMotion(a, K, 1, 0); X.setMotion(b, K, -1, 0); }
      X.forcesNoEvents();
      const E0 = books(X), Q0 = chg(X), P = X.add4(X.p4of(a, true), X.p4of(b, true));
      const t = kind === 'pbar' ? X.nnbarEvent(a, b, 0, 0) : X.nnInelastic(a, b, 0, 0, P, X.mass4(P));
      if (!t) continue;
      ev++;
      const sp = W.exo.filter(o => !o.dead).map(o => o.sp);
      if (sp.includes('W+') || sp.includes('W-')) w++; if (sp.includes('Z0')) z++;
      X.moveExos(1e-9);
      worst = Math.max(worst, Math.abs(books(X) - E0) / (rs * 1e9));
      if (chg(X) !== Q0) qbad++;
    }
    const g = rs, T = X.EW_PP[kind], inel = X.hfLog(X.HF_INEL, Math.max(5, g)) * 1e6, kW = X.ewSigPP(T.W, g, 82.3, T.n) / 0.1086 / inel * 1e5, kZ = X.ewSigPP(T.Z, g, 93.1, T.n) / 0.033658 / inel * 1e5;
    r[kind + rs] = { ev, W: w, eW: +(ev * kW).toFixed(1), Z: z, eZ: +(ev * kZ).toFixed(1), real: rs > 100 ? `1 in ${(1e5 / (kW + kZ) / 1e6).toFixed(1)}M` : '', books: +worst.toExponential(1), qbad, made: JSON.stringify(Object.keys(W.collider.made).filter(l => /W|Z/.test(l))) };
    if (rs < 100) { if (w + z) ok = false; } else if (Math.abs(w - ev * kW) > sig3(ev, kW) + 1 || Math.abs(z - ev * kZ) > sig3(ev, kZ) + 1 || worst > 1e-12 || qbad || ev < n * 0.9) ok = false;
  }
  check(ok, `1.27 W and Z: p̄p at 1.96 TeV (×10⁵) W in ${r.pbar1960.W} of ${r.pbar1960.ev} (expected ${r.pbar1960.eW}), Z in ${r.pbar1960.Z} (${r.pbar1960.eZ}), at real rates ${r.pbar1960.real}; pp 7 TeV (3-D) W ${r.pp7000.W} (${r.pp7000.eW}), Z ${r.pp7000.Z} (${r.pp7000.eZ}); none at 60 GeV; books within ${Math.max(r.pbar1960.books, r.pp7000.books)} of √s, charge kept`, 'ew hadron: ' + JSON.stringify(r));
};
/* A nuclear fireball (central Pb + Pb at 2.76 TeV a nucleon pair, the plasma) makes a W or Z by its binary collisions
   (about 1,100 here: at real rates one central collision in about 2,000; RP.ewX = 10³ for the test), books exact. */
PARTS.fireball = async (page, check) => {
  const r = {};
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 4 }), W = X.W; fresh(X, d3); X.RP.ewX = 1e3;
    let ev = 0, ws = 0, worst = 0, qbad = 0;
    for (let k = 0; k < 6; k++) {
      clear(X);
      const a = X.addNuc(82, 126, 0, -0.01, 0, 0, 0, false), b = X.addNuc(82, 126, 0, 0.01, 0, 0, 0, false), K = 208 * 2.76e12 / 2;
      X.setMotion(a, K, 1, 0); X.setMotion(b, K, -1, 0); X.forcesNoEvents();
      const E0 = books(X), Q0 = chg(X);
      if (!X.nuclearEncounter(a, b, 0.05, 0, 0, 0)) continue;
      ev++; if (W.exo.some(o => !o.dead && X.XP[o.sp].ew)) ws++;
      if (chg(X) !== Q0) qbad++; // (the event's charge; after moveExos the plasma's hundreds of products meeting the fragments change the count on v145 too: not this part's)
      X.moveExos(1e-9);
      worst = Math.max(worst, Math.abs(books(X) - E0) / (208 * 2.76e12));
    }
    r[d3 ? 'd3' : 'flat'] = { ev, ws, books: +worst.toExponential(1), qbad };
  }
  check(r.flat.ws >= 1 && r.d3.ws >= 1 && r.flat.ev >= 5 && r.d3.ev >= 5 && r.flat.books < 1e-12 && r.d3.books < 1e-12 && !r.flat.qbad && !r.d3.qbad, `1.27 W and Z: central Pb + Pb at 2.76 TeV (×10³) makes a W or Z in ${r.flat.ws} of ${r.flat.ev} plasmas (3-D ${r.d3.ws} of ${r.d3.ev}), books within ${Math.max(r.flat.books, r.d3.books)}, charge kept`, 'ew fireball: ' + JSON.stringify(r));
};
/* The books, flat and 3-D: e⁺e⁻ at the Z peak and at 200 GeV (Z, W pairs, their decays), placed W and Z at rest. */
PARTS.books = async (page, check) => {
  const r = {};
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 10 }), W = X.W; fresh(X, d3);
    let worst = 0, n = 0;
    for (const g of [91.1876, 200]) for (let i = 0; i < 60; i++) { const q = eePair(X, g, d3); worst = Math.max(worst, q.d); n++; }
    for (const sp of ['W+', 'W-', 'Z0']) for (let i = 0; i < 20; i++) {
      clear(X); const o = X.addExo(sp, 0, 0, 1e9 * (i % 3), 1, 0, X.resPlaceMass(sp), 0, d3 ? 0.3 : 0);
      const E1 = books(X); X.moveExos(1e-9); worst = Math.max(worst, Math.abs(books(X) - E1) / (o.m * 1e6 + o.KE)); n++;
      if (!o.dead) worst = 1;
    }
    r[d3 ? 'd3' : 'flat'] = { n, worst: +worst.toExponential(1), flat3: d3 ? X.PS3.flat : 0 };
  }
  check(r.flat.worst < 1e-12 && r.d3.worst < 1e-12, `1.27 W and Z: books exact, flat ${r.flat.n} events within ${r.flat.worst} of their energy, 3-D ${r.d3.n} within ${r.d3.worst}`, 'ew books: ' + JSON.stringify(r));
};
/* The setup: CERN LEP at 45.6 GeV a beam makes Zs (the collider's list counts them) and their products. */
PARTS.setup = async (page, check) => {
  const X = load('all', { seed: 7 }), W = X.W; X.PRESETS.lep.build();
  for (let i = 0; i < 3000; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
  const m = W.collider.made || {}, r = { hits: W.collider.hits, Z: m['Z⁰'] || 0, mu: m['μ⁻'] || 0, pi: (m['π⁺'] || 0) + (m['π⁻'] || 0), last: String(W.collider.last).slice(0, 80) };
  check(r.Z >= 20 && r.Z >= 0.8 * r.hits && r.pi > 200, `1.27 W and Z: the LEP setup makes ${r.Z} Zs in ${r.hits} collisions (3,000 steps), ${r.pi} charged pions among their products`, 'ew setup: ' + JSON.stringify(r));
};
/* The page: the palette's W and Z, Inspect of a Z (its name, decays, nothing inside), the LEP setup's list, Help. */
PARTS.page = async (page, check) => {
  const r = await page.evaluate(() => {
    document.querySelectorAll('.modal').forEach(m => { m.hidden = true; });
    loadPreset('empty'); setRunning(false);
    const o = addExo('Z0', 0, 0, 0, 1, 0, resPlaceMass('Z0'));
    R.selX = { kind: 'exo', o }; showTab('inspect', true); renderInspect();
    const out = { ins: $('tp-inspect').textContent, cat: PCATS.some(([n, l]) => n === 'Bosons' && l.length >= 3) /* (1.27 feature 25: 'W, Z and Higgs bosons', four) */, m: o.m };
    loadPreset('lep'); setRunning(true);
    for (let i = 0; i < 2500; i++) { W.dt = chooseDt(); step(W.dt); }
    setRunning(false); showTab('data', true); renderData();
    out.made = JSON.stringify(W.collider.made || {}); out.data = $('dMadeSec').textContent;
    out.help = [...document.querySelectorAll('section.card')].map(s => s.textContent).join(' ');
    return out;
  });
  const ok = /Z⁰ boson/.test(r.ins) && /hadrons/.test(r.ins) && /Nothing: the W and Z are fundamental/.test(r.ins) && r.cat && /Z⁰/.test(r.made) && /Z boson|Z⁰/.test(r.data) && /Electroweak/.test(r.help) && /Higgs/.test(r.help);
  check(ok, `1.27 W and Z: the palette lists W⁺, W⁻, Z⁰; Inspect shows a placed Z (${(r.m / 1000).toFixed(2)} GeV, its decays, nothing inside); the LEP setup's list counts Zs; Help has the electroweak line`, 'ew page: ' + JSON.stringify({ ins: r.ins.slice(0, 300) + ' … ' + r.ins.slice(-400), cat: r.cat, made: r.made.slice(0, 200), data: /Z/.test(r.data), help: /Electroweak/.test(r.help) }));
};
PARTS.page.page = true;
module.exports = async function few(page, check, say, openPage, only) {
  if (!openPage) openPage = require('./browser').openPage;
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (ew ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `ew ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  const args = process.argv.slice(2), noPage = args.includes('--node');
  let browser = null, page = null, errors = [];
  if (!noPage) { const { openPage } = require('./browser'); ({ browser, page, errors } = await openPage({ settle: 800 })); }
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(page, check, say, null, args.filter(a => a !== '--node'));
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  if (browser) await browser.close();
  console.log(fails ? `${fails} failure(s)` : '1.27 W and Z boson checks passed');
  process.exitCode = fails ? 1 : 0;
})();
