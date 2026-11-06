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
const FP_V142 = { cloud: 'ca71f6d9 39571114', photonuc: 'a03a2d7b 77a2e23f', pet: 'a5248bff a9f2ee3a', pionbeam: 'dfa065aa 24cb114d', crt: 'd45bbde7 a1d454f5', linac: '7c6eb010 2b70ae2c', water: 'cac1ac32 a9f2ee3a', water3d: '7a2e7f5c a9f2ee3a', seu: '1bf27d95 a9f2ee3a' };
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
      X.cpmSeg({}, K, mc2, z, e, 1, 0, 0, 10, [[0.5, A, 0.3]], 1.0, false); Tmax = X.CPM.Tmax;
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
