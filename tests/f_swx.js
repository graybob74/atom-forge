'use strict';
/* The checks for the 1.26 exotic-particle sweep (PERF-NOTES, 1.26: "exotic-particle sweep"), run by t_features (one
   line) or alone: node tests/f_swx.js [--node] [part …]. Each part fails before its fix and passes after. Parts that
   need the page are skipped with --node. (page: the t_features page; check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const go = (X, n, dt) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = dt ? Math.min(dt, X.chooseDt()) : X.chooseDt(); X.step(W.dt); } };
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;

/* Flat game, a fast charged particle crossing atoms: (1) Mott scattering (nuclearScatter) sent a stepped atom into flight
   with its bonds and potential energy left out of the books; (2) an ionizing pass below the ionization cost pushed the
   atom by 0.7·√(2dE/m), about half of the dE taken from the projectile. A 20 MeV electron through the H nucleus of a
   water molecule: +4.8 and −6.5 eV a pass before; a muon decay's positron off a bare μ⁺ beside another −17.6 eV. */
PARTS.flatKicks = async (page, check, say) => {
  const X = load('all', { seed: 3 }), W = X.W, r = { water: 0, mu: 0, flew: 0 };
  for (const tgt of ['water', 'mu']) for (let k = 0; k < 10; k++) {
    X.PRESETS.empty.build(); W.T = 0; W.gamma = 0; W.wall = 'reflect';
    let h;
    if (tgt === 'water') h = X.addMolecule('H2O', 0, 0, 0, 0).find(p => p.Z === 1);
    else { h = X.addMuonium(0, 0, 0, 1, 0, 0); X.addMuonium(0.6, 0.5, 0, 1, 0, 0); }
    for (const p of W.parts) { p.vx = p.vy = 0; }
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    X.fireSpec({ kind: 'e' }, h.x - 3, h.y + (k % 5) * 0.0004, 1, 0, 2e7);
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    const E0 = books(X); go(X, 6, 0.02);
    r[tgt] = Math.max(r[tgt], Math.abs(books(X) - E0)); if (h.rad || h.dead) r.flew++;
  }
  r.water = +r.water.toFixed(3); r.mu = +r.mu.toFixed(3);
  check(r.water < 0.1 && r.mu < 0.1 && r.flew >= 10, `1.26 sweep: a 20 MeV electron crossing a nucleus (flat): the struck atom sent flying pays its bonds and potential energy, ionizing pushes give exactly what is lost (books within ${Math.max(r.water, r.mu)} eV a pass, H of water and bare μ⁺)`, 'swx flatKicks: ' + JSON.stringify(r));
};

/* dumpHeat(E, a, a) (one atom, no third body within 6 Å, insulated): kickPair(a, a) takes nothing, and E left the books.
   In 3-D a charged unstable particle slowed below 2 keV and not caught gives its last keV to the atom beside it this
   way: a 1 keV ¹³ΛC beside a lone carbon atom, −1,000 eV before. */
PARTS.loneHeat = async (page, check, say) => {
  const r = {};
  for (const d3 of [true, false]) {
    const X = load('all', { seed: 2 }), W = X.W; X.PRESETS[d3 ? 'd3empty' : 'empty'].build(); W.T = 0; W.gamma = 0; W.decayOn = false;
    const c = X.addAtom('C', 0, 0); c.vx = c.vy = c.vz = 0;
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    let dE;
    if (d3) { X.addExo(X.hypSpecies(6, 6), 0, 1.5, 1000, 0, 1, undefined, 0, 0); const E0 = books(X); go(X, 3, 1e-4); dE = books(X) - E0; }
    else { const E0 = books(X); W.ledger.chem += 0; X.dumpHeat(5, c, c); dE = books(X) - E0 - 5; } // (flat: the call itself, 5 eV handed in from outside)
    r[d3 ? 'd3' : 'flat'] = +dE.toFixed(4);
  }
  check(Math.abs(r.d3) < 1e-3 && Math.abs(r.flat) < 1e-6, `1.26 sweep: heat with no partner to share it (one atom, insulated) stays in the books (3-D: a 1 keV hypernucleus stopping beside a lone atom ${r.d3} eV; flat ${r.flat} eV)`, 'swx loneHeat: ' + JSON.stringify(r));
};

module.exports = async function fswx(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (swx ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `swx ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.26 exotic-particle sweep checks passed');
  process.exitCode = fails ? 1 : 0;
})();
