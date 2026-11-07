'use strict';
/* The checks for 1.27 bug 18 (3-D positron runs broke the energy books; PERF-NOTES "1.27: bug 18"), run by t_features
   (one line) or alone: node tests/f_fix18.js [--node] [part …]. Each part fails on v157 and passes after. No part needs
   the page. (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};

/* A bond judged too strong to break goes back as itself: a new bond lost the old one's Eq (holeEq), 0.3 eV here. */
PARTS.putback = async (page, check) => {
  const X = load('all', { seed: 1 }), W = X.W; X.PRESETS.empty.build(); W.gamma = 0;
  X.addMolecule('H2O', 0, 0, 0, 1); for (const p of W.parts) { p.vx = 0; p.vy = 0; } X.forcesNoEvents();
  const bd = W.bonds[0]; bd.Eq = 0.3; bd.eqA = bd.a; bd.eqQ = bd.a.q;
  const H = bd.a.Z === 1 ? bd.a : bd.b, O = X.other(bd, H), dx = H.x - O.x, dy = H.y - O.y, r = Math.hypot(dx, dy);
  H.vx += 0.5 * dx / r; H.vy += 0.5 * dy / r; // (moving apart, far too slowly to break)
  const e0 = X.totalEnergy().total; X.evBreak(bd, r);
  const res = { same: W.bonds.includes(bd), dE: +(X.totalEnergy().total - e0).toFixed(4) };
  check(res.same && Math.abs(res.dE) < 1e-6, `1.27 bug 18: a bond that holds is put back as itself (its hole energy kept), books ${res.dE} eV`, 'fix18 putback: ' + JSON.stringify(res));
};

/* separate: a bare nucleus has no core; nothing is pushed into a third atom's core. An H⁺ beside its O–H: no push. */
PARTS.separate = async (page, check) => {
  const X = load('all', { seed: 1 }), W = X.W; X.PRESETS.empty.build(); X.setBox(22, 22); X.world3d(22); W.gamma = 0;
  X.addMolecule('H2O', 0, 0, 0, 1, 0); X.forcesNoEvents();
  const bd = W.bonds[0], H = bd.a.Z === 1 ? bd.a : bd.b, O = X.other(bd, H);
  X.removeBond(bd); H.ne = 0; X.refresh(H);
  const o0 = [O.x, O.y, O.z]; X.separate(H, O);
  const moved = +Math.hypot(O.x - o0[0], O.y - o0[1], O.z - o0[2]).toFixed(3), want = Math.max(0, 0.85 * 0.5 * (H.ljR + O.ljR) - Math.hypot(O.x - H.x, O.y - H.y, O.z - H.z) - 0);
  check(H.ljR === 0 && moved < 0.6, `1.27 bug 18: an H⁺ left by an annihilation pushes its O–H out of the force field's own core only (${moved} Å; it was taken as 2 Å wide, 1.4 Å)`, 'fix18 separate: ' + JSON.stringify({ moved, ljR: H.ljR, want }));
};

/* f_124's positrons in 3-D water (seed 8): the books over each positron's life. v157: 42.11 eV. */
PARTS.pos = async (page, check) => {
  const out = [];
  for (const seed of [8, 6]) {
    const X = load('all', { seed }), W = X.W; X.PRESETS.water3d.build(); W.gamma = 0;
    const books = () => X.totalEnergy().total - W.ledger.nuc;
    const go = (n) => { for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };
    go(10); let worst = 0, n = 0;
    for (let k = 0; k < 5; k++) { const p = X.addLepton(X.POS, -10, -5 + 2 * k, 0, 0, -4 + 2 * k, 0); X.setMotion(p, 200, 1, 0.05, 0, 0, 0.02); X.forcesNoEvents(); W.fSpawn = W.spawned; const b = books(); let s = 0; while (!p.dead && s < 3000) { go(1); s++; } if (p.dead) { n++; worst = Math.max(worst, Math.abs(books() - b)); } }
    out.push({ seed, n, worst: +worst.toFixed(3) });
  }
  check(out.every(o => o.n >= 4 && o.worst < 0.5), `1.27 bug 18: 200 eV positrons in 3-D water keep the books, worst ${out.map(o => o.worst + ' eV (seed ' + o.seed + ')').join(', ')}`, 'fix18 pos: ' + JSON.stringify(out));
};

module.exports = async function ffix18(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (fix18 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `fix18 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  const args = process.argv.slice(2);
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(null, check, say, null, args.filter(a => a !== '--node'));
  console.log(fails ? `${fails} failure(s)` : '1.27 bug 18 (3-D positron books) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
