'use strict';
/* The check for 1.27 bug 6 (PERF-NOTES, "1.27: bug 6 (fast fired particles meeting)"), run by t_features (one line) or
   alone: node tests/f_fix06.js [--node] [part …]. Two particles fired at each other above a few GeV crossed the flat box
   in one step and left it before the paths were compared (beamCollisions), and 3-D fast leptons never met each other.
   Now fastMeet lays their straight paths over the step against each other before the move. Both parts fail on v145.
   No part needs the page. (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const go = (X, n) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };
const fire = (X, kind, x, ux, KE, y = 0) => { const p = kind === 'p' ? X.addAtom('H', x, y, { bare: true, T: 0 }) : X.addLepton(kind === 'pos' ? X.POS : X.ELEC, x, y, 0, 0, 0); X.setMotion(p, KE, ux, 0, 0, 0, 0); return p; };

/* A 45.6 GeV positron and electron fired head-on from 20 Å apart in an empty box, flat and 3-D: they meet and make a Z
   (√s 91.2 GeV, the Z peak: eeEvent), the books exact (v145: both annihilated at the walls). */
PARTS.ee = async (page, check, say) => {
  const r = {}; let worst = 0;
  for (const d3 of [false, true]) {
    let z = 0;
    for (let k = 0; k < 5; k++) {
      const X = load('all', { seed: 40 + k }), W = X.W; X.PRESETS.empty.build(); if (d3) X.world3d(30); W.T = 0; W.gamma = 0; W.decayOn = false;
      fire(X, 'pos', -10, 1, 45.6e9); fire(X, 'e', 10, -1, 45.6e9, 0.05 * (k - 2));
      X.forcesNoEvents(); W.fSpawn = W.spawned; const l0 = W.log.length;
      go(X, 3);
      if (W.log.slice(l0).some(e => /Z⁰/.test(e.text))) z++;
    }
    r[d3 ? 'd3' : 'flat'] = z;
  }
  check(r.flat === 5 && r.d3 === 5, `1.27 bug 6: a 45.6 GeV e⁺ and e⁻ fired head-on meet and make a Z (${r.flat} of 5 flat, ${r.d3} of 5 3-D)`, 'fix06 ee: ' + JSON.stringify(r));
};

/* Two 1 TeV protons fired head-on (flat): they meet within the step and collide at √s 2 TeV, the books exact (v145: never). */
PARTS.pp = async (page, check, say) => {
  let met = 0, worst = 0;
  for (let k = 0; k < 6; k++) {
    const X = load('all', { seed: 50 + k }), W = X.W; X.PRESETS.empty.build(); W.T = 0; W.gamma = 0; W.decayOn = false;
    fire(X, 'p', -10, 1, 1e12); fire(X, 'p', 10, -1, 1e12, 0.002 * k);
    X.forcesNoEvents(); W.fSpawn = W.spawned; const l0 = W.log.length;
    const B = () => X.totalEnergy().total - W.ledger.nuc, E0 = B(); // (as the other checks keep them: light in flight is in the total)
    go(X, 1); // (one step: they meet in it; the books before anything made has left the box)
    worst = Math.max(worst, Math.abs(B() - E0) / 2e12);
    if (W.log.slice(l0).some(e => /p \+ p →/.test(e.text))) met++;
  }
  check(met >= 4 && worst < 1e-9, `1.27 bug 6: two 1 TeV protons fired head-on collide at √s 2 TeV (${met} of 6 passes within 0.01 Å; the rest pass outside the inelastic area, as the collider maps them)`, 'fix06 pp: ' + JSON.stringify({ met, worst }));
};

module.exports = async function ffix06(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (fix06 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `fix06 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 bug 6 (fast fired particles meeting) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
