'use strict';
/* The check for 1.27 bug 15 (PERF-NOTES, "1.27: bug 15 (three bookkeeping leaks)"), run by t_features (one line) or alone:
   node tests/f_fix15.js [--node] [part …]. (a) Unstable particles that found no room after a big collision were carried
   off with their energy but not their charge. (b) Events in the electrons' own short steps measured the energy with a
   grid built before the electrons moved: a fast electron beside an ion was missed (+10 eV once). (c) A 100 keV electron
   through 3-D water: no event leaks; what drifts is the step size's integration error (the part says so). Parts plasma
   and delta fail on v145; c100 passes on both. No part needs the page. (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const go = (X, n, dt) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = dt || X.chooseDt(); X.step(W.dt); } };

/* (a) A central Pb + Pb collision at 2.76 TeV a nucleon pair, then 60 steps: the count of charge (particles, unstable
   particles, charge at the walls, on objects and gone out) stays 164, flat and 3-D (v145: 227–242 flat). */
PARTS.plasma = async (page, check, say) => {
  const r = {};
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 1 }), W = X.W; X.PRESETS.empty.build(); X.setBox(200, 200); if (d3) X.world3d(200); W.T = 0; W.gamma = 0;
    const a = X.addAtom('Pb', -0.5, 0, { bare: true, T: 0 }), b = X.addAtom('Pb', 0.5, 0, { bare: true, T: 0 });
    X.setMotion(a, 1.38e12 * 208, 1, 0, 0, 0, 0); X.setMotion(b, 1.38e12 * 208, -1, 0, 0, 0, 0); X.forcesNoEvents(); W.fSpawn = W.spawned;
    const Q = () => { let q = 0; for (const p of W.parts) if (!p.dead) q += p.k === X.NUC ? (p.anti ? -1 : 1) * (p.Z - p.ne) : p.q; for (const o of W.exo) if (!o.dead) q += o.q || 0; return q + W.ledger.qWall + W.ledger.qObj + W.ledger.qOut; };
    X.nuclearEncounter(a, b, 0, 0, 0, 0); const q1 = Q();
    for (let s = 0; s < 60; s++) go(X, 1);
    r[d3 ? 'd3' : 'flat'] = [q1, Q()];
  }
  check(r.flat[0] === 164 && r.flat[1] === 164 && r.d3[1] === 164, `1.27 bug 15a: after a central Pb + Pb collision the charge stays counted (${r.flat[1]} flat, ${r.d3[1]} 3-D of 164)`, 'fix15 plasma: ' + JSON.stringify(r));
};

/* (b) A Δ⁻ placed in Molecules in space, insulated, 300 steps (seed 3: its π⁻ and the electrons it frees ionize the
   molecules): the books move by under 3 eV (v145 +11.4, an impact ionization of C⁺ by a 137 eV electron the grid search
   missed). */
PARTS.delta = async (page, check, say) => {
  const X = load('all', { seed: 3 }), W = X.W; X.PRESETS.mol3d.build(); X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned;
  W.gamma = 0; go(X, 5);
  const B = () => X.totalEnergy().total - W.ledger.nuc;
  const u = X.rndDir(); X.addExo('Dm', 1, 1, 0.03, u[0], u[1], X.resPlaceMass('Dm'), 0.5, u[2]); X.forcesNoEvents(); W.fSpawn = W.spawned;
  const E0 = B(); go(X, 300); const d = B() - E0;
  check(Math.abs(d) < 3, `1.27 bug 15b: a Δ⁻ placed in 3-D molecules: the books move ${d.toFixed(2)} eV over 300 steps`, 'fix15 delta: ' + d.toFixed(3));
};

/* (c) A 100 keV electron through 3-D water, insulated, 400 steps: the events keep the books (wrapped one by one, between
   steps), and what drifts goes with the step (DT_MAX 0.04 tu against 0.01: integration, not an event). */
PARTS.c100 = async (page, check, say) => {
  const run = (dtm) => {
    const X = load('all', { seed: 7 }), W = X.W; X.PRESETS.water3d.build(); X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned;
    go(X, 50); W.gamma = 0; X.DT_MAX = dtm;
    const B = () => X.totalEnergy().total - W.ledger.nuc; let ev = 0;
    for (const n of ['processEvents', 'moveFastLeptons']) { const f = X[n]; X[n] = function (...a) { const e0 = B(); const r = f.apply(this, a); ev = Math.max(ev, Math.abs(B() - e0)); return r; }; }
    const hw = W.box.w / 2, e = X.addLepton(X.ELEC, -hw + 0.5, 0.3, 0, 0, 0.2); X.setMotion(e, 1e5, 1, 0.05, 0, 0, 0.03); X.forcesNoEvents(); W.fSpawn = W.spawned;
    const E0 = B(); go(X, 400); return { drift: B() - E0, ev };
  };
  const a = run(0.04), b = run(0.01);
  check(a.ev < 1e-3 && b.ev < 1e-3 && Math.abs(b.drift) < Math.abs(a.drift) / 4, `1.27 bug 15c: a 100 keV electron through 3-D water: every event exact (worst ${a.ev.toExponential(0)} eV); the drift goes with the step (${a.drift.toFixed(2)} eV at 0.04 tu, ${b.drift.toFixed(2)} at 0.01)`, 'fix15 c100: ' + JSON.stringify({ a, b }));
};

module.exports = async function ffix15(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (fix15 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `fix15 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 bug 15 (three bookkeeping leaks) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
