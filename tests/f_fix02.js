'use strict';
/* The check for 1.27 bug 2 (PERF-NOTES, "1.27: bug 2 (water's ionization energy)"), run by t_features (one line) or alone:
   node tests/f_fix02.js [--node] [part …]. An electron taken from a molecule cost the hit atom's own ionization energy
   plus every bond its charge could not keep: water 13.62 eV at the oxygen and 18.40 at a hydrogen (measured 12.62). Now
   it comes from the molecule's hole atom (holeAtom), and molecules with a measured value (MOL_IE) rise by exactly that
   (holeEq). Every part fails on v145. No part needs the page. (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const go = (X, n, dt) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = dt || X.chooseDt(); X.step(W.dt); } };
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc + X.W.ledger.bath;
const one = (mol, d3, seed = 1) => {
  const X = load('all', { seed }), W = X.W; X.PRESETS.empty.build(); if (d3) X.world3d(30); W.T = 0; W.gamma = 0; W.decayOn = false;
  X.addMolecule(mol, 0, 0, 0, 0); for (const p of W.parts) { p.vx = p.vy = p.vz = 0; }
  X.forcesNoEvents(); W.fSpawn = W.spawned; return X;
};

/* The cost at every atom of a molecule is the measured first ionization energy (NIST Chemistry WebBook). */
PARTS.cost = async (page, check, say) => {
  const want = { H2O: 12.62, NH3: 10.07, CH4: 12.61, CO2: 13.78, O2: 12.07, N2: 15.58, CO: 14.01, C2H6: 11.52, benzene: 9.24 }, r = {};
  let ok = true;
  for (const [m, v] of Object.entries(want)) {
    const X = one(m, false), c = [...new Set(X.W.parts.filter(p => p.ne > 0).map(p => +X.ionizationCost(p).toFixed(2)))];
    r[m] = c.join('/'); if (!(c.length === 1 && Math.abs(c[0] - v) < 0.005)) ok = false;
  }
  check(ok, `1.27 bug 2: a molecule gives an electron at its measured energy wherever it is hit (water ${r.H2O} eV, NH₃ ${r.NH3}, CH₄ ${r.CH4}, benzene ${r.benzene} …)`, 'fix02 cost: ' + JSON.stringify(r));
};

/* The books: an electron taken from water (at the oxygen, at a hydrogen), flat and 3-D, leaves with what it was given
   beyond 12.62 eV, the books exact; and the electron captured back gives 12.62 eV again (as light). */
PARTS.books = async (page, check, say) => {
  const r = []; let ok = true;
  for (const d3 of [false, true]) for (const k of [0, 1]) {
    const X = one('H2O', d3), W = X.W, p = W.parts[k], E0 = books(X), ic = X.ionizationCost(p);
    const e = X.ejectElectron(p, 5); X.forcesNoEvents();
    const d = books(X) - E0 - ic - 5, O = W.parts[0];
    // the electron's energy far away: its motion, less the ion's pull where it is
    X.kill(e); X.forcesNoEvents();
    const L = X.addLepton(X.ELEC, O.x + 0.3, O.y + 0.2, 0, 0, d3 ? 0.1 : 0); L.vx = L.vy = L.vz = 0; X.forcesNoEvents();
    const B0 = books(X), r0 = W.rays.length; X.capture(L, O, -1); X.forcesNoEvents();
    const dc = books(X) - B0, back = O.q === 0;
    r.push({ d3, at: X.elSym(p), ic: +ic.toFixed(2), books: +d.toFixed(6), capture: +dc.toFixed(6), back, light: W.rays.length > r0 });
    if (!(Math.abs(ic - 12.62) < 1e-9 && Math.abs(d) < 1e-6 && Math.abs(dc) < 1e-6 && back)) ok = false;
  }
  check(ok, `1.27 bug 2: water ionized at O or H (flat and 3-D) costs 12.62 eV exactly, and an electron caught back is booked exactly`, 'fix02 books: ' + JSON.stringify(r));
};

/* Positronium's window at water (Settings → Realistic particles → Positronium): the Ore gap is I − 6.8 to I, I = 12.62:
   a 6.2 eV positron forms Ps (v145: below 13.62 − 6.80 at the oxygen, below 11.6 at a hydrogen), a 13.0 eV one does not
   (v145 formed Ps at the oxygen, 13.0 < 13.62). */
PARTS.ps = async (page, check, say) => {
  const r = {};
  for (const d3 of [false, true]) for (const E of [6.2, 13.0]) {
    let n = 0;
    for (const seed of [1, 2, 3]) {
      const X = load('all', { seed }), W = X.W; X.RP.ps = true; X.PRESETS.empty.build(); if (d3) X.world3d(30); W.T = 0; W.gamma = 0; W.decayOn = false;
      X.addMolecule('H2O', 0, 0, 0, 0); for (const p of W.parts) { p.vx = p.vy = p.vz = 0; }
      const L = X.addLepton(X.POS, -4, 0.1, Math.sqrt(2 * E / X.PHYS.ME), 0, 0, 0); X.forcesNoEvents(); W.fSpawn = W.spawned;
      for (let s = 0; s < 400 && !L.dead; s++) go(X, 1, 0.002);
      if (W.exo.some(o => !o.dead && (o.sp === 'oPs' || o.sp === 'pPs'))) n++;
    }
    r[(d3 ? '3d ' : '') + E] = n;
  }
  check(r['6.2'] === 3 && r['3d 6.2'] === 3 && r['13'] === 0 && r['3d 13'] === 0, `1.27 bug 2: positronium forms at water in its Ore gap 5.8–12.6 eV (6.2 eV: ${r['6.2']} of 3 flat, ${r['3d 6.2']} 3-D; 13.0 eV: none)`, 'fix02 ps: ' + JSON.stringify(r));
};

module.exports = async function ffix02(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (fix02 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `fix02 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 bug 2 (water\'s ionization energy) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
