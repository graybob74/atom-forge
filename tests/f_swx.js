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

/* The debris of a 1 PeV event (α on α at rest, head on), over 300 steps: decays in flight boosted with γ from 1 − β²
   (at γ ≈ 10⁵ it keeps ~10⁻⁶ of itself), and hits whose remainder (10⁻⁷ of 100 TeV) was left unsettled or sat on a single
   product: 0.1–0.9 MeV off before (10 PeV: 27–94 MeV); now the books' own rounding, a few eV. */
PARTS.pevBooks = async (page, check, say) => {
  const r = [];
  for (const d3 of [false, true]) for (const seed of [1, 2]) {
    const X = load('all', { seed }), W = X.W;
    X.PRESETS[d3 ? 'd3empty' : 'empty'].build(); W.T = 0; W.gamma = 0; W.wall = 'reflect'; W.decayOn = true;
    X.addNuc(2, 2, 0, 0, 0); const p = X.addNuc(2, 2, 0, -3, 0); X.setMotion(p, 1e15, 1, 0, 0, 0, 0, 0);
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    const E0 = books(X); go(X, 300); r.push(+(books(X) - E0).toFixed(1));
  }
  check(r.every(v => Math.abs(v) < 100), `1.26 sweep: a 1 PeV α on α, its debris's books over 300 steps within ${Math.max(...r.map(Math.abs))} eV (flat and 3-D; before 0.1–0.9 MeV)`, 'swx pevBooks: ' + JSON.stringify(r));
};

/* A hadron's elastic turn off a nucleus (exoElastic): the nucleus takes the momentum given in the lab, its recoil energy
   paid by the hadron, floored at 1 eV; a slow hadron meeting a fast nucleus (a cascade's) could not pay, and the rest was
   made from nothing (a 4 MeV π⁻ and a 650 MeV proton: +47 MeV). Now such a turn is made in their own frame, exactly. */
PARTS.elasticCM = async (page, check, say) => {
  const r = {};
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 4 }), W = X.W; X.PRESETS[d3 ? 'd3empty' : 'empty'].build(); W.T = 0; W.gamma = 0; W.decayOn = false;
    let worst = 0;
    for (let k = 0; k < 8; k++) {
      const tg = X.addNuc(1, 0, 0, 2, 0); X.setMotion(tg, 6.5e8, 1, 0, 0, 0, 0, 0);
      const o = X.addExo('pi-', 0, 0, 4e6, 1, 0, undefined, 0, 0);
      X.forcesNoEvents(); W.fSpawn = W.spawned;
      const E0 = books(X); for (let j = 0; j < 4 * k; j++) X.rnd(); X.exoElastic(o, tg); worst = Math.max(worst, Math.abs(books(X) - E0));
      X.kill(tg); o.dead = true; W.exo.length = 0;
    }
    r[d3 ? 'd3' : 'flat'] = +worst.toExponential(1);
  }
  check(r.flat < 1e-3 && r.d3 < 1e-3, `1.26 sweep: a slow π⁻ turned off a fast proton keeps the books (flat ${r.flat} eV, 3-D ${r.d3} eV; before up to tens of MeV)`, 'swx elasticCM: ' + JSON.stringify(r));
};

/* 3-D neutrons in flight moved at ½mv²'s speed (1 PeV: 1,460c); now at the relativistic speed for that energy, as a
   nucleus in flight (bug fix A of 1.26), the books unchanged. */
PARTS.neutron3 = async (page, check, say) => {
  const X = load('all', { seed: 1 }), W = X.W; X.PRESETS.d3empty.build(); W.T = 0; W.gamma = 0; W.wall = 'open';
  const r = {};
  for (const KE of [1e6, 1e9, 1e15]) {
    const n = X.addNuc(0, 1, 0, -10, 0, 0, 0, false, 0); X.setMotion(n, KE, 0.6, 0, 0, 0, 0.8, 0);
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    const x0 = n.x, z0 = n.z, E0 = books(X), dt = 1e-5; X.step(dt);
    r[KE] = { c: +(Math.hypot(n.x - x0, n.z - z0) / dt / X.PHYS.C).toFixed(6), books: +(books(X) - E0).toExponential(1) };
    X.kill(n);
  }
  const want = (KE) => { const g = 1 + KE / (X.PHYS.MN * X.PHYS.AMU_MEV * 1e6); return Math.sqrt(1 - 1 / (g * g)); };
  check(Object.entries(r).every(([KE, v]) => Math.abs(v.c - want(+KE)) < 1e-4 && Math.abs(v.books) < 1e-3 * (+KE) * 1e-9 + 1e-6), `1.26 sweep: a 3-D neutron flies at its true speed (1 MeV ${r[1e6].c}c, 1 GeV ${r[1e9].c}c, 1 PeV ${r[1e15].c}c)`, 'swx neutron3: ' + JSON.stringify(r));
};

/* Flat game, an atom knocked into radiation flight by a nucleus passing (nuclearCollision) or an elastic hit (setVel):
   the push √(2T/m) on an atom already moving gave it more or less than the T taken from the projectile, bonds broke
   for free, and an atom sent into flight kept its bonds and potential energy out of the books. A 1 MeV α through a
   row of molecules and atoms: +46 to +66 eV before; an H of a water molecule sent off at 50 keV: +4.8 eV over what it
   was given. */
PARTS.flatRecoil = async (page, check, say) => {
  const r = { alpha: [], setVel: 0 };
  for (const seed of [1, 2, 3]) {
    const X = load('all', { seed }), W = X.W;
    X.PRESETS.empty.build(); W.T = 0; W.gamma = 0; W.wall = 'reflect'; W.decayOn = true;
    X.addMolecule('H2O', -2, 0, 0, 0); X.addMolecule('H2O', 2, 0.3, 0, 0); X.addAtom('C', 5, -0.2); X.addAtom('Pb', 8, 0.1); X.addAtom('H', 11, 0); X.addMolecule('H2O', 14, -0.2, 0, 0);
    for (const p of W.parts) { p.vx = p.vy = 0; }
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    X.fireSpec(X.SPEC_ALPHA, -12, 0.02, 1, 0, 1e6);
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    const E0 = books(X); go(X, 80); r.alpha.push(+(books(X) - E0).toFixed(2));
  }
  { const X = load('all', { seed: 2 }), W = X.W; X.PRESETS.empty.build(); W.T = 0; W.gamma = 0;
    const h = X.addMolecule('H2O', 0, 0, 0, 0).find(p => p.Z === 1); for (const p of W.parts) { p.vx = p.vy = 0; }
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    const E0 = books(X), v = Math.sqrt(2 * 5e4 / h.m); X.setVel(h, v, 0); r.setVel = +(books(X) - E0 - 5e4).toFixed(4); r.flew = !!h.rad && !h.bonds.length; }
  check(r.alpha.every(v => Math.abs(v) < 3) && Math.abs(r.setVel) < 1e-3 && r.flew, `1.26 sweep: atoms knocked into flight in the flat game keep the books (a 1 MeV α through molecules ${r.alpha.join(', ')} eV; an H sent off at 50 keV ${r.setVel} eV over what it was given)`, 'swx flatRecoil: ' + JSON.stringify(r));
};

/* Faster than light: muonic hydrogen fired at 1 PeV threw the proton it scattered off at 933c (muAtomScatter set the
   velocity by hand, non-relativistically, with no flight); a remainder settled on one light product (an electron) by
   scaling its velocity did the same (1.26's settleRest, before this fix). Now through setVel (flat) or flight at the
   true speed (3-D). */
PARTS.muFast = async (page, check, say) => {
  const r = {};
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 5 }), W = X.W;
    X.PRESETS[d3 ? 'd3empty' : 'empty'].build(); W.T = 0; W.gamma = 0; W.wall = 'reflect'; W.decayOn = true;
    X.addMolecule('H2O', -2, 0, 0, 0); X.addMolecule('H2O', 2, 0.3, 0, 0); X.addAtom('C', 5, -0.2); X.addAtom('Pb', 8, 0.1); X.addAtom('H', 11, 0); X.addMolecule('H2O', 14, -0.2, 0, 0);
    for (const p of W.parts) { p.vx = p.vy = 0; if (d3) p.vz = 0; }
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    X.fireSpec({ kind: 'exo', sp: 'muP' }, -12, 0.02, 1, 0, 1e15, false, d3 ? 0.01 : 0, 0);
    let worst = 0;
    for (let i = 0; i < 80; i++) { go(X, 1); for (const q of W.parts) if (!q.dead) worst = Math.max(worst, X.speedNow(q) / X.PHYS.C); }
    r[d3 ? 'd3' : 'flat'] = +worst.toFixed(4);
  }
  check(r.flat <= 1 && r.d3 <= 1, `1.26 sweep: muonic hydrogen fired at 1 PeV: nothing it hits moves faster than light (fastest ${r.flat}c flat, ${r.d3}c 3-D)`, 'swx muFast: ' + JSON.stringify(r));
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
