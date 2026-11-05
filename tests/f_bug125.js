'use strict';
/* The checks for the bug fixes after 1.25 (the "Bugs on record" list), run by t_features (one line) or alone:
   node tests/f_bug125.js [--node] [part …]. Each part fails before its fix and passes after. Parts that need the page
   are skipped with --node. (page: the t_features page; check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const go = (X, n, dt) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = dt || X.chooseDt(); X.step(W.dt); } };
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;
const fresh = (seed = 7) => { const X = load('all', { seed }); return X; };

/* 5. The flat game's open walls: what leaves (atoms, molecules, free electrons) takes its energy to ledger.escaped.
   Before: 8 waters and an ion pair leaving an open box took 19,230 eV out of the books unbooked (the atoms' electrons'
   binding, their motion and potential energy). */
PARTS.openWall = async (page, check, say) => {
  const X = fresh(3), W = X.W;
  X.baseWorld(30, 20, 300, 0); W.wall = 'open'; W.slowmo = false;
  for (let i = 0; i < 8; i++) for (const p of X.addMolecule('H2O', 10, -8 + 2.2 * i, i, 0)) { p.vx = 0.3; p.vy = 0; X.updateFast(p); }
  const na = X.addAtom('Na', -10, 0); X.userIonize(na); const cl = X.addAtom('Cl', -6, 0); X.userAddElectron(cl); na.vx = -0.5; X.updateFast(na);
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  const E0 = books(X); go(X, 1500);
  const r = { left: W.parts.filter(p => !p.dead).length, books: +(books(X) - E0).toFixed(3) };
  check(r.left < 10 && Math.abs(r.books) < 0.1, `bug fix 5: an open flat box: ${27 - r.left} particles left, books ${r.books} eV`, 'bugfix openWall: ' + JSON.stringify(r));
};

/* 11. The flat game's hard-sphere collision turns the pair by 2·acos(b/R): head-on back, grazing straight on. Before, it
   turned by π − 2·acos(b/R): a head-on hit passed straight through (0°), a grazing one bounced back (180°). */
PARTS.hardSphere = async (page, check, say) => {
  const X = fresh(1), W = X.W; X.baseWorld(30, 20, 300, 0);
  const turn = (b) => { const a = X.addAtom('Ar', 0, 0), t = X.addAtom('Ar', 1, 0); a.vx = 1; a.vy = 0; t.vx = 0; t.vy = 0; X.hardSphere(a, t, b, 1);
    const rx = a.vx - t.vx, ry = a.vy - t.vy, ang = Math.acos(Math.max(-1, Math.min(1, rx / Math.hypot(rx, ry)))) * 180 / Math.PI; X.kill(a); X.kill(t); return Math.round(ang); };
  const r = { headOn: turn(0), half: turn(0.5), grazing: turn(0.999) };
  check(r.headOn === 180 && r.half === 120 && r.grazing < 6, `bug fix 11: a flat hard-sphere hit turns the pair by ${r.headOn}° head-on, ${r.half}° at b = R/2, ${r.grazing}° grazing`, 'bugfix hardSphere: ' + JSON.stringify(r));
};

// PARTS (added one per fix, below)

module.exports = async function fbug125(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (bugfix ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `bugfix ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
module.exports.helpers = { go, books, fresh };
if (require.main === module) (async () => {
  const args = process.argv.slice(2), noPage = args.includes('--node');
  let browser = null, page = null, errors = [];
  if (!noPage) { const { openPage } = require('./browser'); ({ browser, page, errors } = await openPage({ settle: 800 })); }
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(page, check, say, null, args.filter(a => a !== '--node'));
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  if (browser) await browser.close();
  console.log(fails ? `${fails} failure(s)` : 'bug-fix (after 1.25) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
