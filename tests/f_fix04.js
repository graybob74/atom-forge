'use strict';
/* The check for 1.27 bug 4 (PERF-NOTES, "1.27: bug 4 (fast positrons)"), run by t_features (one line) or alone:
   node tests/f_fix04.js [--node] [part …]. A positron stepped with the atoms (flat under 1 keV, 3-D under 25 keV) that
   touched an atom annihilated into 2γ at once whatever its energy, and one in flight never annihilated with the atoms it
   passed. Now one with the energy to ionize meets atoms as an electron does, and in flight it annihilates at Heitler's
   rate (annFlight: boosted 2γ, or above √s = 211 MeV e⁺e⁻'s other channels through eeEvent). Every part fails on v145.
   No part needs the page. (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const go = (X, n) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };

/* A 5 keV positron in 3-D water ionizes the water before it annihilates (v145: at its first touch, 0–1 ionizations). */
PARTS.contact = async (page, check, say) => {
  const r = [];
  for (const seed of [10, 11]) {
    const X = load('all', { seed }), W = X.W; X.PRESETS.water3d.build(); W.T = 0; W.gamma = 0; W.decayOn = false; X.forcesNoEvents(); W.fSpawn = W.spawned;
    for (const p of W.parts) { p.vx = p.vy = p.vz = 0; }
    const L = X.addLepton(X.POS, 0, 0.3, 0, 0, 0.2); X.setMotion(L, 5000, 1, 0, 0, 0, 0); X.forcesNoEvents(); W.fSpawn = W.spawned;
    const i0 = W.count.ionize || 0, a0 = W.count.annih || 0;
    for (let s = 0; s < 400 && !(W.count.annih > a0); s++) go(X, 1);
    r.push({ ion: (W.count.ionize || 0) - i0, ann: (W.count.annih || 0) - a0 });
  }
  check(r.every(q => q.ion >= 20), `1.27 bug 4: a 5 keV positron in 3-D water ionizes it (${r.map(q => q.ion).join(', ')} ionizations) before it annihilates`, 'fix04 contact: ' + JSON.stringify(r));
};

/* annFlight on a water molecule: 1 MeV and 1 GeV give two γ carrying the positron's momentum forward, 1 PeV (√s 32 GeV)
   μ pairs and hadrons too; the books exact; flat and 3-D. */
PARTS.flight = async (page, check, say) => {
  const r = {}; let worst = 0, fwd = 1;
  for (const d3 of [false, true]) for (const KE of [1e6, 1e9, 1e15]) {
    const X = load('all', { seed: 4 }), W = X.W, tally = {};
    for (let k = 0; k < (KE > 1e12 ? 200 : 20); k++) {
      X.PRESETS.empty.build(); if (d3) X.world3d(30); W.T = 0; W.gamma = 0; W.decayOn = false;
      X.addMolecule('H2O', 0, 0, 0, 0); for (const p of W.parts) { p.vx = p.vy = p.vz = 0; }
      const L = X.addLepton(X.POS, -0.3, 0.2, 0, 0, 0); X.setMotion(L, KE, 1, 0, 0, 0, 0); X.forcesNoEvents();
      const B = () => X.totalEnergy().total - W.ledger.nuc, E0 = B(), x0 = W.exo.length, r0 = W.rays.length;
      X.annFlight(L, W.parts[0]); X.forcesNoEvents();
      worst = Math.max(worst, Math.abs(B() - E0) / KE);
      const sp = W.exo.slice(x0).map(o => o.sp).join(' '), rays = W.rays.slice(r0);
      const key = /mu/.test(sp) ? 'mumu' : /pi|K|rho|omega|D|B/.test(sp) ? 'had' : 'gg';
      tally[key] = (tally[key] || 0) + 1;
      if (key === 'gg' && KE < 1e12) { const px = rays.reduce((a, q) => a + q.E * (q.x1 - q.x0) / (Math.hypot(q.x1 - q.x0, q.y1 - q.y0) || 1), 0), E = rays.reduce((a, q) => a + q.E, 0); fwd = Math.min(fwd, px / E); }
    }
    r[(d3 ? '3d ' : '') + KE.toExponential(0)] = tally;
  }
  const hi = [r['1e+15'], r['3d 1e+15']];
  check(worst < 1e-9 && fwd > 0.4 && r['1e+6'].gg === 20 && r['3d 1e+9'].gg === 20 && hi.every(t => t.mumu > 0 && t.had > 0 && t.gg > 100),
    `1.27 bug 4: positrons annihilating in flight on water: 2γ forward at 1 MeV and 1 GeV (momentum share ≥ ${fwd.toFixed(2)}), at 1 PeV also μ pairs and hadrons (${JSON.stringify(r['1e+15'])} flat); books to ${worst.toExponential(0)} of its energy`,
    'fix04 flight: ' + JSON.stringify({ r, worst, fwd }));
};

/* The rate: a 1 MeV positron through 3-D water, the chance summed over its passes per eV it lost, against n_e·σ/S for
   water (Heitler's σ, ESTAR's 1.862 MeV cm²/g); and over its range from 1 MeV the share annihilating in flight, 3–4.5%
   (the integral of heitlerPdE down to 1 keV). */
PARTS.rate = async (page, check, say) => {
  const X = load('all', { seed: 31 }), W = X.W;
  X.PRESETS.water3d.build(); W.T = 0; W.gamma = 0; W.decayOn = false; W.wall = 'wrap'; X.forcesNoEvents(); W.fSpawn = W.spawned;
  let lam = 0, dEs = 0; const f = X.heitlerPdE; X.heitlerPdE = function (K, dE, Z) { lam += f(K, dE, Z); dEs += dE; return 0; };
  for (let k = 0; k < 3; k++) { const L = X.addLepton(X.POS, 0, 0.3, 0, 0, 0.2); const u = X.rndDir(); X.setMotion(L, 1e6, u[0], u[1], 0, 0, u[2]); }
  X.forcesNoEvents(); W.fSpawn = W.spawned; go(X, 150);
  const per = lam / dEs, want = 0.3343e24 * X.heitlerSig(1e6) * 1e-16 / 1.862e6;
  let I = 0; for (let K = 1e6; K > 1e3; K -= 500) I += 500 * (f(K, 1, 8) * 8 + f(K, 1, 1) * 2) / 10; // (water's electrons: O's eight and two H)
  const frac = 1 - Math.exp(-I);
  check(dEs > 0 && Math.abs(per / want - 1) < 0.1 && frac > 0.03 && frac < 0.045, `1.27 bug 4: in flight a positron's chance to annihilate goes with the energy it loses (${per.toExponential(2)} per eV in 3-D water, n_e·σ/S ${want.toExponential(2)}); from 1 MeV ${(100 * frac).toFixed(1)}% annihilate in flight`, 'fix04 rate: ' + JSON.stringify({ per, want, frac, dEs }));
};

module.exports = async function ffix04(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (fix04 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `fix04 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  const args = process.argv.slice(2), noPage = args.includes('--node');
  let browser = null, page = null, errors = [];
  if (!noPage && Object.values(PARTS).some(f => f.page)) { const { openPage } = require('./browser'); ({ browser, page, errors } = await openPage({ settle: 800 })); }
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(page, check, say, null, args.filter(a => a !== '--node'));
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  if (browser) await browser.close();
  console.log(fails ? `${fails} failure(s)` : '1.27 bug 4 (fast positrons) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
