'use strict';
/* The checks for 1.27's realistic particles, part 3 (PERF-NOTES, "1.27: realistic particles 3 (charged particles in
   matter)"), run by t_features (one line) or alone: node tests/f_rp3.js [--node] [part …]. Each part fails on v142
   (there is no switch there) and passes here. Parts that need the page are skipped with --node.
   (page: the t_features page; check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;
const fresh = (X, d3) => { const W = X.W; X.PRESETS[d3 ? 'd3empty' : 'empty'].build(); W.T = 0; W.gamma = 0; W.decayOn = false; W.wall = 'reflect'; };
const ME = 510998.95;
/* A flat (or 3-D) lattice of element `sym`, spacing a (Å), filling |x| < hx, |y| < hy (|z| < hz): atoms held still. */
const lattice = (X, sym, a, hx, hy, hz) => {
  const L = [];
  for (let x = -hx; x <= hx; x += a) for (let y = -hy; y <= hy; y += a) for (let z = hz ? -hz : 0; z <= (hz || 0); z += a) { const p = X.addAtom(sym, x, y, z); p.vx = p.vy = 0; if (X.W.d3) p.vz = 0; L.push(p); }
  return L;
};
/* Fire a fast particle straight along +x from (x0, y, z) and move it alone (moveRad flat, its own mover in 3-D) in
   1 Å steps until it passes x1 or stops. */
const fly = (X, p, x1) => {
  for (let s = 0; s < 4000 && !p.dead && p.x < x1; s++) {
    if (X.W.d3) { const v = Math.hypot(p.vx, p.vy, p.vz), g = 1 + 0.5 * p.m * v * v / (ME * 1), vr = X.PHYS.C * Math.sqrt(Math.max(1e-12, 1 - 1 / (g * g))); if (p.k === X.NUC) { p.ox = p.x; p.oy = p.y; p.oz = p.z; p.x += p.vx / v; p.y += p.vy / v; p.z += p.vz / v; X.fastEncounters3(p); } else X.moveFastLeptons3(1 / vr, Infinity); }
    else X.moveRad(p, 1 / p.sp);
  }
};

/* With the switch off every setup is as before, bit for bit: the fingerprints (tools/fingerprint.js: seed 7, 300 steps,
   every particle's state and the books) of the setups with fast charged particles and γ rays, flat and in 3-D, equal
   v142's (all 59 setups were compared when this was built); the switch starts off. */
// (1.27 bug 2: pionbeam, hyperfactory and annihilation re-fingerprinted, switches off: molecules give electrons at their measured ionization energies, from their hole atom)
// (1.27 bug 3: fusion, nif, pionbeam, annihilation and sns re-fingerprinted, switches off: close passes between nuclei turned at nuclear distances)
// (1.27 bug 7: photonuc, sns and hyperfactory re-fingerprinted, switches off: X-rays of 10–100 keV meet atoms by their Compton and photoelectric cross sections; Compton's mₑc² exact)
const FP_V142 = { cloud: 'ca71f6d9 39571114', photonuc: '9bdf9dd1 49d4aec0', pet: 'a5248bff a9f2ee3a', pionbeam: 'a57d419b a3728514', crt: 'd45bbde7 a1d454f5', linac: '7c6eb010 2b70ae2c', water: 'cac1ac32 a9f2ee3a', water3d: '7a2e7f5c a9f2ee3a', seu: '1bf27d95 a9f2ee3a' };
PARTS.off = async (page, check) => {
  const h = (s) => { let a = 0x811c9dc5; for (let i = 0; i < s.length; i++) { a ^= s.charCodeAt(i); a = Math.imul(a, 0x01000193); } return (a >>> 0).toString(16).padStart(8, '0'); };
  const bad = [];
  for (const k of Object.keys(FP_V142)) {
    const X = load('all', { seed: 7 }), W = X.W, P = X.PRESETS[k];
    if (X.RP.cpm !== false) bad.push('RP.cpm starts ' + X.RP.cpm);
    P.build(); if (X.ultraHold) X.ultraHold(); if (X.mode3dSync) try { X.mode3dSync(); } catch (e) { /* (no page) */ }
    X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned;
    for (let i = 0; i < 300; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
    const parts = W.parts.filter(p => !p.dead).map(p => [p.k, p.Z, p.N, p.ne, p.x, p.y, p.z || 0, p.vx, p.vy, p.vz || 0, p.KE || 0].join(',')).join(';');
    const exo = W.exo.filter(o => !o.dead).map(o => [o.sp, o.x, o.y, o.KE].join(',')).join(';');
    const got = h(parts + '|' + exo + '|' + W.bonds.length) + ' ' + h(JSON.stringify(W.ledger));
    if (got !== FP_V142[k]) bad.push(`${k} ${got} (v142 ${FP_V142[k]})`);
  }
  check(!bad.length, `1.27 realistic particles: Charged particles in matter starts off and, off, leaves every setup as in v142 (fingerprints of ${Object.keys(FP_V142).join(', ')})`, 'rp3 off: ' + JSON.stringify(bad));
};

/* Straggling: 5 MeV α across 16 Å of the flat game's water, 432 tracks. On, the loss has Landau's shape: its most
   probable value within 35% of Landau's ξ[ln(2mc²β²γ²ξ/I²) + 0.2 − β²], its full width at half maximum 3–7 ξ (Landau
   4.02 ξ), and the long tail of hard collisions (the 90th percentile over 3 times the median). Off, the loss came
   from where each track passed the atoms only (90th percentile under 2.5 times the median). */
const PATCH_ST = (s) => s.replace('function cpmAtom(tg, b, dEg, x, y, z) {', 'function cpmAtom(tg, b, dEg, x, y, z) { const S = globalThis.__st, inL = S && Math.abs(x) < S.h; const m = inL && tg.ne > 0 ? dEg * Math.max(1, cpmL(cpmI(tg.Z)) / CPM.Lg) / Math.max(cpmL(cpmI(tg.Z)), CPM.Lg) : 0; const r = cpmAtom0(tg, b, dEg, x, y, z); if (inL) { S.d += r; S.xi += m; } return r; }\nfunction cpmAtom0(tg, b, dEg, x, y, z) {')
  .replace('    let dE = Math.min(0.3 * p.KE, 0.0047 * zeff * zeff * tg.ne / beta2 * w);', '    let dE = Math.min(0.3 * p.KE, 0.0047 * zeff * zeff * tg.ne / beta2 * w); if (globalThis.__st && Math.abs(x0 + (x1 - x0) * t) < globalThis.__st.h && dE >= 0.01) globalThis.__st.d += dE;');
const straggle = (on) => {
  const res = [], xis = [];
  for (let b = 0; b < 12; b++) {
    const X = load('all', { seed: 10 + b, patch: PATCH_ST }), W = X.W; X.PRESETS.water.build(); X.RP.cpm = on; W.T = 0; W.gamma = 0;
    X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned;
    const hw = W.box.w / 2, hh = W.box.h / 2;
    for (let k = 0; k < 36; k++) {
      const y = (X.rnd() - 0.5) * hh, th = (X.rnd() - 0.5) * 0.6, p = X.addNuc(2, 2, 0, -hw * 0.9, y); X.setMotion(p, 5e6, Math.cos(th), Math.sin(th), 0, 0, 0); // (at random heights and slants: the water's structure sampled)
      globalThis.__st = { d: 0, xi: 0, h: 8 };
      fly(X, p, hw * 0.6);
      res.push(globalThis.__st.d); xis.push(globalThis.__st.xi);
      if (!p.dead) X.kill(p);
    }
  }
  globalThis.__st = null;
  res.sort((a, b) => a - b);
  const n = res.length, mean = res.reduce((a, b) => a + b) / n, xi = xis.reduce((a, b) => a + b) / n, hi = res[Math.floor(n * 0.98)], nb = 30, bw = hi / nb, h = new Array(nb).fill(0);
  for (const v of res) { const i = Math.floor(v / bw); if (i >= 0 && i < nb) h[i]++; }
  const sm = h.map((v, i) => (h[i - 1] || 0) * 0.25 + v * 0.5 + (h[i + 1] || 0) * 0.25); let im = 0; for (let i = 0; i < nb; i++) if (sm[i] > sm[im]) im = i;
  let a = im, c = im; while (a > 0 && sm[a] > sm[im] / 2) a--; while (c < nb - 1 && sm[c] > sm[im] / 2) c++;
  return { mean: +mean.toFixed(1), median: +res[n >> 1].toFixed(1), mp: +((im + 0.5) * bw).toFixed(1), fwhm: +((c - a) * bw).toFixed(1), xi: +xi.toFixed(1), p90: +res[Math.floor(n * 0.9)].toFixed(1), max: Math.round(res[n - 1]) };
};
PARTS.straggle = async (page, check) => {
  const on = straggle(true), off = straggle(false);
  const g = 1 + 5e6 / 3727.38e6, b2 = 1 - 1 / (g * g), mpL = on.xi * (Math.log(2 * ME * b2 * g * g * on.xi / (75 * 75)) + 0.2 - b2);
  const ok = Math.abs(on.mp / mpL - 1) < 0.35 && on.fwhm / on.xi > 3 && on.fwhm / on.xi < 7 && on.p90 > 3 * on.median && off.p90 < 2.5 * off.median;
  check(ok, `1.27 straggling: 5 MeV α across 16 Å of water: most probable loss ${on.mp} eV (Landau ${mpL.toFixed(1)}), full width ${(on.fwhm / on.xi).toFixed(2)} ξ (Landau 4.02; ξ = ${on.xi} eV), mean ${on.mean} eV, a long tail (90th percentile ${on.p90} eV, ${(on.p90 / on.median).toFixed(1)}× the median; largest ${on.max} eV); off ${(off.p90 / off.median).toFixed(1)}×`, 'rp3 straggle: ' + JSON.stringify({ on, off, mpL }));
};

/* δ-rays: the close collisions' energies T (drawn at an oxygen atom, made fresh each time) reach T_max and no further
   (100 MeV protons 229.2 keV, 1 MeV electrons T/2 = 500 keV), with the spectrum 1/T² (× (1 − β²T/T_max)): the share
   above T_max/100 and the mean as that law gives; each knocks out an electron with T less its binding, at
   cos θ = (T/p_δ)(E + mₑ)/p. In the flat game's water, 5 MeV α make δ-rays up to their T_max of 2.74 keV. */
const PATCH_DL = (s) => s.replace('      const ie = ionizationCost(tg);\n      if (!(T < C.K - 1)', '      if (globalThis.__dl) globalThis.__dl.push(T);\n      const ie = ionizationCost(tg);\n      if (!(T < C.K - 1)').replace('      C.K -= T;\n      if (ejectElectron(tg, T - ie,', '      if (globalThis.__da) globalThis.__da.push([T, ct]);\n      C.K -= T;\n      if (ejectElectron(tg, T - ie,');
PARTS.delta = async (page, check) => {
  const r = {};
  for (const [lab, z, mc2, K, e] of [['p', 1, 938.272e6, 1e8, 0], ['e', 1, ME, 1e6, -1]]) {
    const X = load('all', { seed: 4, patch: PATCH_DL }), W = X.W; fresh(X, false); X.RP.cpm = true;
    const A = X.addAtom('O', 0, 0); A.vx = A.vy = 0; globalThis.__dl = []; globalThis.__da = [];
    let Tmax = 0, eKE = 0, eN = 0;
    for (let i = 0; i < 3000; i++) {
      X.cpmSeg({}, K, mc2, z, e, 1, 0, 0, 10, 0, 0, 0, 1.0, false); Tmax = X.CPM.Tmax;
      const n0 = W.parts.length; X.cpmAtom(A, 0.3, 2000, 0, 0, 0);
      for (let j = n0; j < W.parts.length; j++) { const q = W.parts[j]; if (q.k === X.ELEC) { eKE = Math.max(eKE, q.rad ? q.KE : 0.5 * q.m * (q.vx * q.vx + q.vy * q.vy)); eN++; } X.kill(q); }
      W.parts = W.parts.filter(q => !q.dead); A.ne = 8; X.refresh(A); A.vx = A.vy = 0;
    }
    const T = globalThis.__dl, n = T.length, Tc = Math.max(10, X.ionizationCost(A) + 1), b2 = 1 - 1 / (1 + K / mc2) ** 2, sp = e === 0 ? b2 : 0;
    const law = (lo, hi) => (1 / lo - 1 / hi) - sp * Math.log(hi / lo) / Tmax, lawT = (lo, hi) => Math.log(hi / lo) - sp * (hi - lo) / Tmax;
    const top = T.filter(t => t > Tmax / 100).length / n, topL = law(Tmax / 100, Tmax) / law(Tc, Tmax);
    const ang = globalThis.__da.filter(v => v[0] > 1e3).map(v => Math.abs(v[1] - Math.min(1, v[0] / Math.sqrt(v[0] * (v[0] + 2 * ME)) * (K + mc2 + ME) / Math.sqrt(K * (K + 2 * mc2)))));
    r[lab] = { n, Tmax: +Tmax.toFixed(0), max: +Math.max(...T).toFixed(0), top: +top.toExponential(2), topLaw: +topL.toExponential(2), mean: +(T.reduce((a, b) => a + b) / n).toFixed(1), meanLaw: +(lawT(Tc, Tmax) / law(Tc, Tmax)).toFixed(1), eKE: Math.round(eKE), eN, ang: ang.length ? Math.max(...ang) : 0 };
    globalThis.__dl = globalThis.__da = null;
  }
  { // in the flat game's water: 5 MeV α
    const X = load('all', { seed: 6 }), W = X.W; X.PRESETS.water.build(); X.RP.cpm = true; W.T = 0; W.gamma = 0; X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned;
    const hw = W.box.w / 2, hh = W.box.h / 2, n0 = W.parts.length; let mx = 0, n1 = 0;
    for (let k = 0; k < 100; k++) { const p = X.addNuc(2, 2, 0, -hw * 0.9, (X.rnd() - 0.5) * hh); X.setMotion(p, 5e6, 1, 0, 0, 0, 0); fly(X, p, hw * 0.8); if (!p.dead) X.kill(p); }
    for (let j = n0; j < W.parts.length; j++) { const q = W.parts[j]; if (q.k === X.ELEC && !q.dead) { const E = q.rad ? q.KE : 0.5 * q.m * (q.vx * q.vx + q.vy * q.vy); mx = Math.max(mx, E); if (E > 500) n1++; } }
    r.water = { maxE: Math.round(mx), over500: n1 };
  }
  const okp = (v, frac) => v.n > 20000 && v.max <= v.Tmax && v.max > frac * v.Tmax && Math.abs(v.top / v.topLaw - 1) < 0.2 && Math.abs(v.mean / v.meanLaw - 1) < 0.15 && v.eKE < v.Tmax && v.ang < 2e-3;
  const ok = okp(r.p, 0.5) && okp(r.e, 0.3) && r.water.maxE < 2740 && r.water.over500 > 0;
  check(ok, `1.27 δ-rays: 100 MeV protons' close collisions up to ${r.p.max} eV (T_max ${r.p.Tmax}), 1 MeV electrons' up to ${r.e.max} (T/2), with the 1/T² spectrum (share above T_max/100 ${r.p.top} against ${r.p.topLaw}; mean ${r.p.mean} against ${r.p.meanLaw} eV) and the δ-ray's angle; 5 MeV α in water set ${r.water.over500} electrons over 500 eV free, the fastest ${r.water.maxE} eV (T_max 2,740)`, 'rp3 delta: ' + JSON.stringify(r));
};

/* Cherenkov light: with the rare processes sped up 10⁴× (RP.cpmX, as decay speed-up), a 1 GeV electron in the flat game's
   water gives photons on the cone cos θ = 1/βn (41.4°), at the Frank–Tamm number 369.8 (1 − 1/β²n²) per eV per cm over
   300–600 nm; a 300 keV electron (β 0.78) at 14.8°; a 3 GeV proton (β 0.97) at 39.4°; in silica glass at 46.7°; none
   below threshold (β < 1/n: electrons of 150 keV, protons of 300 MeV), none in lead or in a sparse vapour. In 3-D the
   same cone in water. */
const PATCH_CK = (s) => s.replace("    C.K -= k; W.count.cpmCkv = (W.count.cpmCkv || 0) + 1;", "    if (globalThis.__ck) globalThis.__ck.push([u[0] * C.ux + u[1] * C.uy + u[2] * C.uz, k]);\n    C.K -= k; W.count.cpmCkv = (W.count.cpmCkv || 0) + 1;");
const ckRun = (setup, kind, KE, n, d3) => {
  const X = load('all', { seed: 5, patch: PATCH_CK }), W = X.W; X.RP.cpm = true; X.RP.cpmX = 1e4;
  if (typeof setup === 'string') X.PRESETS[setup].build(); else { fresh(X, d3); setup(X); }
  W.T = 0; W.gamma = 0; X.forcesNoEvents(); W.fSpawn = W.spawned;
  const hw = W.box.w / 2, hh = W.box.h / 2, hd = d3 ? W.box.d / 2 : 0; globalThis.__ck = []; let L = 0;
  const x1 = setup === 'water' || setup === 'water3d' ? hw * 0.85 : 14, x0 = -x1, ys = setup === 'water' || setup === 'water3d' ? hh * 0.8 : 8;
  for (let k = 0; k < n; k++) {
    const y = (X.rnd() - 0.5) * ys, z = d3 ? (X.rnd() - 0.5) * hd : 0;
    const p = kind === 'p' ? X.addNuc(1, 0, 0, x0, y, 0, 0, false, z) : X.addLepton(X.ELEC, x0, y, 0, 0, z, 0); X.setMotion(p, KE, 1, 0, 0, 0, 0);
    const xs = p.x; fly(X, p, x1); L += p.x - xs; if (!p.dead) X.kill(p);
  }
  const c = globalThis.__ck; globalThis.__ck = null;
  return { n: c.length, cos: c.length ? +(c.reduce((a, v) => a + v[0], 0) / c.length).toFixed(4) : null, spread: c.length ? +(Math.max(...c.map(v => v[0])) - Math.min(...c.map(v => v[0]))).toFixed(6) : 0, perA: c.length / L, eMin: c.length ? Math.min(...c.map(v => v[1])) : 0, eMax: c.length ? Math.max(...c.map(v => v[1])) : 0 };
};
const glass = (X) => { for (let x = -16; x <= 16; x += 5) for (let y = -10; y <= 10; y += 3.5) { const S = X.addAtom('Si', x, y), O1 = X.addAtom('O', x - 1.55, y), O2 = X.addAtom('O', x + 1.55, y); X.addBond(S, O1, 2); X.addBond(S, O2, 2); for (const q of [S, O1, O2]) { q.vx = q.vy = 0; } } };
const vapour = (X) => { for (let x = -16; x <= 16; x += 8) for (let y = -10; y <= 10; y += 8) X.addMolecule('H2O', x, y); }; // (a dense vapour: 8 Å apart, a fifth of the liquid's density)
PARTS.ckv = async (page, check) => {
  const r = {}, ft = (b, n) => 1e4 * 369.81 * (1 - 1 / (b * b * n * n)) * (1239.84 / 300 - 1239.84 / 600) * 1e-8, beta = (K, m) => Math.sqrt(1 - 1 / (1 + K / m) ** 2);
  r.w = ckRun('water', 'e', 1e9, 100); r.w.ft = ft(1, 1.333);
  r.e300 = ckRun('water', 'e', 3e5, 100); r.p3 = ckRun('water', 'p', 3e9, 60);
  r.e150 = ckRun('water', 'e', 1.5e5, 60).n; r.p300 = ckRun('water', 'p', 3e8, 60).n;
  r.g = ckRun(glass, 'e', 1e9, 100);
  r.pb = ckRun((X) => lattice(X, 'Pb', 3.45, 16, 10), 'e', 1e9, 60).n; r.vap = ckRun(vapour, 'e', 1e9, 60).n;
  r.w3 = ckRun('water3d', 'e', 1e9, 60, true);
  const th = (c) => +(Math.acos(c) * 180 / Math.PI).toFixed(2), want = (b, n) => +(Math.acos(1 / (b * n)) * 180 / Math.PI).toFixed(2);
  r.ang = { w: [th(r.w.cos), want(1, 1.333)], e300: [th(r.e300.cos), want(beta(3e5, ME), 1.333)], p3: [th(r.p3.cos), want(beta(3e9, 938.272e6), 1.333)], g: [th(r.g.cos), want(1, 1.458)], w3: [th(r.w3.cos), want(1, 1.333)] };
  const close = (a) => Math.abs(a[0] - a[1]) < 0.3; // (a 300 keV electron slows as it goes, its cone narrowing)
  const ok = Object.values(r.ang).every(close) && r.w.n > 60 && Math.abs(r.w.perA / r.w.ft - 1) < 0.3 && r.w.spread < 1e-3 && r.e300.n > 3 && r.p3.n > 10 && r.g.n > 20 && r.w3.n > 30 && r.w3.spread < 1e-6
    && r.e150 === 0 && r.p300 === 0 && r.pb === 0 && r.vap === 0 && r.w.eMin >= 1239.84 / 600 && r.w.eMax <= 1239.84 / 300;
  check(ok, `1.27 Cherenkov light: in water a 1 GeV electron's photons at ${r.ang.w[0]}° (cos θ = 1/βn: ${r.ang.w[1]}°), ${(r.w.perA / 1e4 * 1e8).toFixed(0)} a cm (Frank–Tamm ${(r.w.ft / 1e4 * 1e8).toFixed(0)}, 300–600 nm), 300 keV electrons ${r.ang.e300[0]}° (${r.ang.e300[1]}), 3 GeV protons ${r.ang.p3[0]}° (${r.ang.p3[1]}); silica glass ${r.ang.g[0]}° (${r.ang.g[1]}); 3-D water ${r.ang.w3[0]}°; none below threshold (150 keV e⁻, 300 MeV p), in lead or in vapour`, 'rp3 ckv: ' + JSON.stringify(r));
};

/* Bremsstrahlung: 1 GeV electrons through a flat lattice of lead (3.45 Å apart: 0.084 atoms/Å², real lead's density in
   the flat game's measure) and through the flat game's water, with the rare processes sped up (RP.cpmX): the number
   of photons per length (their spectrum's integral over 1/X₀) gives the radiation length, in g/cm² at the density the lattice stands for: lead 6.37, water
   36.08 (PDG); the photons' spectrum is (4/3 − 4/3 y + y²)/k (y = k/E: 36.5%, 35.3% and 28.2% of them in the three
   decades from 10⁻³ to 1); the critical energy (Rossi: the collision loss over a radiation length equals E) from the
   same functions: water 78.3 MeV, lead 7.43 MeV (PDG) within 10%. */
const PATCH_BR = (s) => s.replace("  C.K -= k; W.count.cpmBrems = (W.count.cpmBrems || 0) + 1;", "  if (globalThis.__br) globalThis.__br.push(k / E);\n  C.K -= k; W.count.cpmBrems = (W.count.cpmBrems || 0) + 1;");
PARTS.brems = async (page, check) => {
  const r = {};
  for (const [lab, X0pdg, cx] of [['Pb', 6.37, 3e5], ['water', 36.08, 1e7]]) {
    const X = load('all', { seed: 8, patch: PATCH_BR }), W = X.W; X.RP.cpm = true; X.RP.cpmX = cx;
    let hx = 14, hy = 10;
    if (lab === 'Pb') { fresh(X, false); lattice(X, 'Pb', 3.45, hx, hy); } else { X.PRESETS.water.build(); W.T = 0; W.gamma = 0; hx = W.box.w / 2 * 0.85; hy = W.box.h / 2 * 0.85; }
    X.forcesNoEvents(); globalThis.__br = []; let L = 0;
    const A = [...W.parts].filter(p => p.k === X.NUC);
    const rho = (lab === 'Pb' ? 207.2 / (3.45 * 3.45) : 18.015 / (3.4 * 3.4)) / 2.545 * 1e24 / 6.02214076e23; // (g/cm³: the lattice's (the water setup's molecules are 3.4 Å apart) flat measure over CPM_LAM)
    for (let k = 0; k < 600; k++) {
      const y = (X.rnd() - 0.5) * 1.4 * hy, p = X.addLepton(X.ELEC, -hx, y, 0, 0, 0, 0); X.setMotion(p, 1e9, 1, 0, 0, 0, 0);
      fly(X, p, hx); L += Math.min(p.x, hx) + hx; if (!p.dead) X.kill(p);
      for (const q of W.parts) if (q.k !== X.NUC) X.kill(q); W.parts = W.parts.filter(q => !q.dead);
      for (const q of A) if (q.ne !== q.Z) { q.ne = q.Z; X.refresh(q); }
    }
    const ys = globalThis.__br, y1 = 1e9 / (1e9 + ME), y0 = 1e-3 * y1, F = 4 / 3 * Math.log(y1 / y0) - 4 / 3 * (y1 - y0) + (y1 * y1 - y0 * y0) / 2, X0 = cx * L * F / ys.length * 1e-8 * rho, dec = [0, 0, 0]; // (from the number of photons: the spectrum's integral F over the count, ±1/√N)
    for (const v of ys) { const i = Math.floor(Math.log10(v) + 3); if (i >= 0 && i < 3) dec[i]++; }
    r[lab] = { n: ys.length, X0: +X0.toFixed(2), X0pdg, rho: +rho.toFixed(2), dec: dec.map(v => +(v / ys.length).toFixed(3)) };
    globalThis.__br = null;
  }
  { // the critical energy from the functions the game uses (Bethe for electrons with the density effect; 1/X₀ with the low-energy factor)
    const X = load('all', { seed: 1 }), C = X.CPM;
    const ec = (ne3, atoms, I) => { for (let E = 1e6; E < 1e9; E *= 1.002) { C.K = E; C.mc2 = ME; C.e = -1; const g = 1 + E / ME; C.g = g; C.b2 = 1 - 1 / g / g; C.bg = Math.sqrt(C.b2) * g; C.Tmax = E / 2; C.rho = ne3; let inv = 0; for (const [Z, n] of atoms) inv += n * X.cpmSigX(Z, Z); if (X.CPM_K * ne3 * X.cpmL(I) / C.b2 / inv < E) return E / 1e6; } };
    const nPb = 11.35 / 207.2 * 0.602214;
    r.ec = { water: +ec(0.3343, [[8, 0.03343], [1, 0.06686]], 75).toFixed(1), lead: +ec(82 * nPb, [[82, nPb]], 823).toFixed(2) };
  }
  const law = [3.058, 2.955, 2.365].map(v => v / 8.378), okd = (d) => d.every((v, i) => Math.abs(v - law[i]) < 0.07);
  const ok = r.Pb.n > 200 && r.water.n > 200 && Math.abs(r.Pb.X0 / 6.37 - 1) < 0.15 && Math.abs(r.water.X0 / 36.08 - 1) < 0.15 && okd(r.Pb.dec) && okd(r.water.dec) && Math.abs(r.ec.water / 78.33 - 1) < 0.1 && Math.abs(r.ec.lead / 7.43 - 1) < 0.1;
  check(ok, `1.27 bremsstrahlung: 1 GeV electrons radiate as a radiation length of ${r.Pb.X0} g/cm² in lead (PDG 6.37) and ${r.water.X0} in water (36.08), ${r.Pb.n} and ${r.water.n} photons with the 1/k spectrum (by decade of k/E ${r.Pb.dec.join(' ')}; Tsai ${law.map(v => v.toFixed(3)).join(' ')}); the critical energy ${r.ec.water} MeV in water (78.33), ${r.ec.lead} MeV in lead (7.43)`, 'rp3 brems: ' + JSON.stringify(r));
};

/* Pair production: none below 1.022 MeV (2,000 γ rays of 1.0 MeV at a lead atom), some at 2 MeV; at 10 MeV a lead atom
   makes pairs 89 times as often as a water molecule (the cross sections: Bethe–Heitler with screening and the Coulomb
   correction, plus the triplet; XCOM as I remember it about 90, Z² alone 102), with Compton scattering beside it at
   the Klein–Nishina rate; the pair flies forward and shares the energy unequally (Bethe–Heitler), and gets exactly
   E − 2mₑc² (flat and 3-D, with the triplet's electron and its binding). */
PARTS.pair = async (page, check) => {
  const r = {};
  { const X = load('all', { seed: 3 }), W = X.W; fresh(X, false); X.RP.cpm = true; const A = X.addAtom('Pb', 0, 0); X.forcesNoEvents();
    const cnt = (E, n) => { let c = 0; for (let i = 0; i < n; i++) { const n0 = W.parts.length; X.emitPhoton(-5, 0, E, 1, 0); if (W.parts.slice(n0).some(p => p.k === X.POS)) c++; for (const p of W.parts.slice(n0)) X.kill(p); W.parts = W.parts.filter(p => !p.dead); A.ne = 82; X.refresh(A); A.vx = A.vy = 0; } return c; };
    r.below = cnt(1.0e6, 2000) + cnt(1.02e6, 2000); r.at2 = cnt(2e6, 2000); }
  { const X = load('all', { seed: 4 }), W = X.W; fresh(X, false); X.RP.cpm = true; const at = { Pb: X.addAtom('Pb', 0, 0), O: X.addAtom('O', 10, 0), H: X.addAtom('H', -10, 0) };
    const f = {}, fc = {}; for (const [k, a] of Object.entries(at)) { const n = k === 'Pb' ? 20000 : 300000; let c = 0, cc = 0; for (let i = 0; i < n; i++) { const v = X.cpmGamma(a, 1e7); if (v === 1 || v === 2) c++; else if (v === 3) cc++; } f[k] = c / n; fc[k] = cc / n; }
    const sPb = X.cpmPairSig(82, 82, 1e7), sO = X.cpmPairSig(8, 8, 1e7), sH = X.cpmPairSig(1, 1, 1e7);
    r.ratio = +(f.Pb / (f.O + 2 * f.H)).toFixed(1); r.sigRatio = +((sPb[0] + sPb[1]) / (sO[0] + sO[1] + 2 * (sH[0] + sH[1]))).toFixed(1);
    r.barn = { Pb: +((sPb[0] + sPb[1]) * 1e8).toFixed(2), water: +((sO[0] + sO[1] + 2 * (sH[0] + sH[1])) * 1e8).toFixed(3) };
    r.compton = +(fc.O / (1 - f.O) / (0.012 * 8 * X.cpmKN(1e7) / X.cpmKN(1e6))).toFixed(3); }
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 2 }), W = X.W; fresh(X, d3); X.RP.cpm = true;
    let A = X.addAtom('Pb', 0, 0, 0); A.vx = A.vy = 0; if (d3) A.vz = 0; X.forcesNoEvents();
    const fresh82 = () => { if (A.dead) { for (const p of W.parts) if (!p.dead) X.kill(p); W.parts = W.parts.filter(p => !p.dead); A = X.addAtom('Pb', 0, 0, 0); } }; // (1.27 bug 11: the giant dipole resonance, on part 3's footing, now takes the lead nucleus in about 1 shot in 200 at 10 MeV: a new one)
    let n = 0, worst = 0, fw = 0, uneq = 0, trip = 0; const E = 1e7, th = [];
    for (let i = 0; i < 400; i++) {
      const b0 = books(X), n0 = W.parts.length;
      X.emitPhoton(-5, (X.rnd() - 0.5) * 0.4, E, 1, 0, d3 ? { z: 0, uz: 0 } : undefined);
      const made = W.parts.slice(n0), ps = made.find(p => p.k === X.POS);
      if (ps) {
        n++; worst = Math.max(worst, Math.abs(books(X) - b0 - E)); if (made.filter(p => p.k === X.ELEC).length > 1) trip++;
        const e = made.find(p => p.k === X.ELEC), K = (p) => p.rad ? p.KE : 0.5 * p.m * (p.vx ** 2 + p.vy ** 2 + (p.vz || 0) ** 2), ux = (p) => p.rad ? p.ux : p.vx / Math.hypot(p.vx, p.vy, p.vz || 0);
        th.push(Math.acos(Math.min(1, ux(ps)))); if (Math.abs(K(e) - K(ps)) > 0.2 * (E - 2 * ME)) uneq++;
      }
      for (const p of made) X.kill(p); W.parts = W.parts.filter(p => !p.dead); fresh82(); A.ne = 82; X.refresh(A); A.vx = A.vy = 0; if (d3) A.vz = 0; X.forcesNoEvents();
    }
    for (let i = 0; i < 20; i++) { // (the triplet, made directly: 0.2% of lead's pairs at 10 MeV)
      const b0 = books(X), n0 = W.parts.length; X.cpmPair(A, 5e7, 1, 0, 0, true);
      if (W.parts.slice(n0).filter(p => p.k === X.ELEC).length === 2) trip++;
      worst = Math.max(worst, Math.abs(books(X) - b0 - 5e7));
      for (const p of W.parts.slice(n0)) X.kill(p); W.parts = W.parts.filter(p => !p.dead); A.ne = 82; X.refresh(A); A.vx = A.vy = 0; if (d3) A.vz = 0; X.forcesNoEvents();
    }
    th.sort((a, b) => a - b);
    r[d3 ? 'd3' : 'flat'] = { n, books: +worst.toExponential(1), thMed: +th[th.length >> 1].toFixed(3), uneq: +(uneq / n).toFixed(2), trip };
  }
  const okk = (v) => v.n > 150 && v.trip >= 15 && v.books < 1e-5 && v.thMed < 0.25 && v.uneq > 0.3;
  const ok = r.below === 0 && r.at2 > 0 && Math.abs(r.ratio / r.sigRatio - 1) < 0.1 && r.sigRatio > 80 && r.sigRatio < 100 && Math.abs(r.compton - 1) < 0.1 && okk(r.flat) && okk(r.d3);
  check(ok, `1.27 pair production: none of 4,000 γ rays under 1.022 MeV at lead, ${r.at2} of 2,000 at 2 MeV; at 10 MeV lead (${r.barn.Pb} b) against water (${r.barn.water} b) ${r.ratio}× (cross sections ${r.sigRatio}×), Compton at Klein–Nishina's rate (${r.compton}); the pair forward (median ${r.flat.thMed} rad flat, ${r.d3.thMed} in 3-D), shared unequally (${r.flat.uneq} of pairs more than 20% apart), books to ${Math.max(r.flat.books, r.d3.books)} eV (triplets ${r.flat.trip}, ${r.d3.trip})`, 'rp3 pair: ' + JSON.stringify(r));
};

/* The books: the fast particles moved through matter one 0.2 Å tick at a time, the rest of the world held between whole
   steps (so that the energy is measured where it is exact), with δ-rays, bremsstrahlung, pairs (the showers' further
   pairs too) and Cherenkov light: 1 GeV electrons into lead (the rare processes sped up 10⁶×), 1 GeV electrons, 5 MeV α
   and 500 MeV muons into water (10⁴×). In 3-D every tick (moveFastLeptons3, fastEncounters3 for the α, exoIonize3)
   keeps the total energy exactly. In the flat game each event of this part keeps it exactly (the energy an atom takes,
   with its δ-rays and photons, against what the particle lost; each pair; each Cherenkov photon), less what the flat
   game's ejectElectron itself misses beside ions and electrons in a crowded, ionized lattice, which it misses the same
   way with the switch off (PERF-NOTES: found, not changed; its worst here is reported). */
const PATCH_BK = (s) => s.replace('function ejectElectron(p, KE, ux, uy, budget, tunnel, uz = 0) {', 'function ejectElectron(p, KE, ux, uy, budget, tunnel, uz = 0) { const G = globalThis.__bk; if (!G || budget !== undefined) return ejectElectron0(p, KE, ux, uy, budget, tunnel, uz); const ie = ionizationCost(p), b0 = totalEnergy().total - W.ledger.nuc; const r = ejectElectron0(p, KE, ux, uy, budget, tunnel, uz); if (r) { const d = totalEnergy().total - W.ledger.nuc - b0 - KE - ie; G.ej += d; G.ejW = Math.max(G.ejW, Math.abs(d)); } return r; }\nfunction ejectElectron0(p, KE, ux, uy, budget, tunnel, uz = 0) {').replace('function cpmAtom(tg, b, dEg, x, y, z) {', 'function cpmAtom(tg, b, dEg, x, y, z) { const G = globalThis.__bk; if (!G) return cpmAtom0(tg, b, dEg, x, y, z); const b0 = totalEnergy().total - W.ledger.nuc, K0 = CPM.K, e0 = G.ej; const r = cpmAtom0(tg, b, dEg, x, y, z); if (r > 0) { G.n++; G.worst = Math.max(G.worst, Math.abs(totalEnergy().total - W.ledger.nuc - b0 - (K0 - CPM.K) - (G.ej - e0))); } return r; }\nfunction cpmAtom0(tg, b, dEg, x, y, z) {')
  .replace('function cpmCkv(x0, y0, z0, len) {', 'function cpmCkv(x0, y0, z0, len) { const G = globalThis.__bk; if (!G) return cpmCkv0(x0, y0, z0, len); const b0 = totalEnergy().total - W.ledger.nuc, K0 = CPM.K, e0 = G.ej; const r = cpmCkv0(x0, y0, z0, len); if (r > 0) { G.n++; G.worst = Math.max(G.worst, Math.abs(totalEnergy().total - W.ledger.nuc - b0 - (K0 - CPM.K) - (G.ej - e0))); } return r; }\nfunction cpmCkv0(x0, y0, z0, len) {')
  .replace('function cpmPair(p, E, ux, uy, uz, trip) {', 'function cpmPair(p, E, ux, uy, uz, trip) { const G = globalThis.__bk; if (!G) return cpmPair0(p, E, ux, uy, uz, trip); const b0 = totalEnergy().total - W.ledger.nuc, e0 = G.ej; const r = cpmPair0(p, E, ux, uy, uz, trip); G.n++; G.worst = Math.max(G.worst, Math.abs(totalEnergy().total - W.ledger.nuc - b0 - E - (G.ej - e0))); return r; }\nfunction cpmPair0(p, E, ux, uy, uz, trip) {');
PARTS.books = async (page, check) => {
  const r = {};
  for (const d3 of [false, true]) for (const mat of ['Pb', 'water']) {
    const X = load('all', { seed: 3, patch: d3 ? undefined : PATCH_BK }), W = X.W; X.RP.cpm = true; X.RP.cpmX = mat === 'Pb' ? 1e6 : 1e4;
    if (mat === 'Pb') { fresh(X, d3); lattice(X, 'Pb', 3.45, 12, 9, d3 ? 6 : 0); } else { X.PRESETS[d3 ? 'water3d' : 'water'].build(); W.T = 0; W.gamma = 0; W.decayOn = false; }
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    const hw = W.box.w / 2, hh = W.box.h / 2, hd = d3 ? W.box.d / 2 : 0;
    for (let k = 0; k < 8; k++) { const e = X.addLepton(X.ELEC, -hw + 1, (X.rnd() - 0.5) * hh, 0, 0, d3 ? (X.rnd() - 0.5) * hd : 0, 0); const u = d3 ? [0.98, 0.15, 0.13] : [0.98, 0.15, 0], ul = Math.hypot(...u); X.setMotion(e, 1e9, u[0] / ul, u[1] / ul, 0, 0, u[2] / ul); } // (slanted: not along the lattice's rows)
    if (mat === 'water') for (let k = 0; k < 4; k++) { const a = X.addNuc(2, 2, 0, -hw + 1, (X.rnd() - 0.5) * hh, 0, 0, false, d3 ? (X.rnd() - 0.5) * hd : 0); X.setMotion(a, 5e6, 0.995, 0.0999, 0, 0, 0); X.addExo('mu-', -hw + 1, (X.rnd() - 0.5) * hh, 5e8, 0.995, 0.0999, undefined, d3 ? (X.rnd() - 0.5) * hd : 0, 0); }
    const C = () => (W.count.cpmBrems || 0) + (W.count.cpmPair || 0) + (W.count.cpmDelta || 0) + (W.count.cpmCkv || 0);
    let ev = 0, worst = 0, ejW = 0; globalThis.__bk = d3 ? null : { n: 0, worst: 0, ej: 0, ejW: 0 };
    for (let tick = 0; tick < 300; tick++) {
      const b0 = books(X), c0 = C();
      if (d3) {
        X.moveFastLeptons3(0.2 / X.PHYS.C, Infinity);
        for (const p of W.parts.slice()) if (!p.dead && p.k === X.NUC && p.Z === 2 && p.N === 2 && p.fast) { const v = Math.hypot(p.vx, p.vy, p.vz); if (!(v > 0)) continue; p.ox = p.x; p.oy = p.y; p.oz = p.z; p.x += 0.2 * p.vx / v; p.y += 0.2 * p.vy / v; p.z += 0.2 * p.vz / v; X.fastEncounters3(p); }
      } else for (const p of W.parts.slice()) if (!p.dead && p.rad) X.moveRad(p, 0.2 / p.sp);
      for (const o of W.exo.slice()) if (!o.dead && o.q && o.v > 0) { const x0 = o.x, y0 = o.y, z0 = o.z || 0, h = 0.2; o.x += o.ux * h; o.y += o.uy * h; if (d3) { o.z += o.uz * h; X.exoIonize3(o, x0, y0, z0); } else X.exoIonize(o, x0, y0); }
      const c1 = C(); if (c1 > c0) { ev += c1 - c0; if (d3) worst = Math.max(worst, Math.abs(books(X) - b0)); }
    }
    if (!d3) { ev = Math.min(ev, globalThis.__bk.n); worst = globalThis.__bk.worst; ejW = globalThis.__bk.ejW; }
    globalThis.__bk = null;
    r[(d3 ? '3' : '') + mat] = { ev, worst: +worst.toExponential(1), ejW: +ejW.toFixed(2), brems: W.count.cpmBrems || 0, pairs: W.count.cpmPair || 0, delta: W.count.cpmDelta || 0, ckv: W.count.cpmCkv || 0 };
  }
  const ok = Object.values(r).every(v => v.ev >= 15 && v.worst < 1e-3) /* (≥ 15 events each: flat water made 20 after the 1.26 ejectElectron fixes, 21+ before) */ && r.Pb.brems > 5 && r.Pb.pairs > 0 && r['3Pb'].brems > 5 && r['3Pb'].pairs > 0 && r.water.ckv > 0 && r['3water'].ckv > 0 && r.water.delta > 0 && r['3water'].delta > 0;
  check(ok, `1.27 charged particles in matter: the books exact with δ-rays, bremsstrahlung, pairs and Cherenkov light (worst ${Math.max(...Object.values(r).map(v => v.worst)).toExponential(0)} eV; flat lead ${r.Pb.brems} photons, ${r.Pb.pairs} pairs; 3-D lead ${r['3Pb'].brems}, ${r['3Pb'].pairs}; water flat and 3-D ${r.water.delta} and ${r['3water'].delta} δ-rays, ${r.water.ckv} and ${r['3water'].ckv} Cherenkov photons; the flat ejectElectron's own residue beside ions, as off, up to ${Math.max(r.Pb.ejW, r.water.ejW)} eV)`, 'rp3 books: ' + JSON.stringify(r));
};

/* The Settings section (page): the line follows Muonium as hydrogen, with its switch, cost tag and "realistic when on";
   pointing at it shows its description (flat and 3-D); it sets RP.cpm, is saved, and is off again at start. */
PARTS.layout = async (page, check) => {
  const r = await page.evaluate(() => {
    document.querySelectorAll('.modal').forEach(m => { m.hidden = true; });
    loadPreset('empty'); openSettings('exp');
    const pane = document.querySelector('section[data-stab="exp"]'), lines = [...pane.querySelectorAll('.rpl')], ids = lines.map(l => (l.querySelector('[id]') || {}).id);
    const i = ids.indexOf('setRpCpm'), L = lines[i];
    const o = { ids, i, tag: L ? !!L.querySelector('.cost-k') : false, real: L ? !!L.querySelector('.rlb') : false, h: L ? Math.round(L.getBoundingClientRect().height) : 0 };
    setPrevShow('setRpCpm', null); o.pane = $('setPrevT').textContent + ' | ' + $('setPrevD').textContent.slice(0, 50);
    $('setRpCpm').click(); o.on = [SET.rpCpm, RP.cpm, JSON.parse(store('settings')).rpCpm]; $('setRpCpm').click(); o.on.push(SET.rpCpm, RP.cpm);
    o.exp = SET_EXP.includes('rpCpm') && EXP_SET.setRpCpm === 'rpCpm';
    hideModal('setModal'); loadPreset('d3empty'); openSettings('exp'); setPrevShow('setRpCpm', null); o.pane3 = $('setPrevD').textContent; o.cost3 = (COSTS3.setRpCpm() || {}).on[0]; hideModal('setModal'); loadPreset('empty');
    return o;
  });
  const ok = r.i > r.ids.indexOf('setRpMu') && r.ids.indexOf('setRpMu') >= 0 && r.tag && r.real && r.h < 34 && /^Charged particles in matter \| A fast charged particle crossing matter/.test(r.pane)
    && /In 3-D the same in all three directions/.test(r.pane3) && r.cost3 === '×1–1.5' && r.on.join() === 'true,true,true,false,false' && r.exp;
  check(ok, `1.27 Settings: Realistic particles has Charged particles in matter after Muonium as hydrogen (${r.h} px high), with its cost tag, "realistic when on" and side-pane texts flat and 3-D; it sets RP.cpm, is saved and is off at start`, 'rp3 layout: ' + JSON.stringify(Object.assign({}, r, { pane3: r.pane3.slice(0, 60) })));
};
PARTS.layout.page = true;

module.exports = async function frp3(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (rp3 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `rp3 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 realistic particles 3 checks passed');
  process.exitCode = fails ? 1 : 0;
})();
