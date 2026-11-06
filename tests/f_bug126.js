'use strict';
/* The checks for the bug fixes after the 1.26 merge, run by t_features (one line: alone('f_bug126.js')) or alone:
   node tests/f_bug126.js [part …]. Each part fails before its fix and passes after. Node only.
   (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};

/* The hot radical mixture of the GFN2 refit session: O₃, NO, O₂, H₂O₂ and two H₂ at 1,500 K, quantum bonds with Polarized
   spins, 100 steps with the bath, then 400 insulated. The books (total + bath) step by step: jumps over 1 meV, the worst,
   and how often a step's answer came from a fresh start or the atoms' spins (detours) and from the probe (flips). */
function mixture(meth, seed, d3, steps = 400) {
  const X = load('all', { seed }), W = X.W, T = 1500;
  if (d3) { X.PRESETS.empty.build(); X.setBox(16, 16); X.world3d(16); }
  ['O3', 'NO', 'O2', 'H2O2', 'H2', 'H2'].forEach((m, k) => { const a = 2 * Math.PI * k / 6; X.addMolecule(m, 3.2 * Math.cos(a), 3.2 * Math.sin(a), a, T); });
  for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
  X.settleOverlaps(); X.boQmMethod(meth); X.boQmSpin(1); X.boSet(2); X.forcesNoEvents(); W.T = T;
  const st = () => { W.dt = X.chooseDt(); X.step(W.dt); };
  for (let i = 0; i < 100; i++) st();
  W.gamma = 0; const tot = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc;
  let prev = tot(), jumps = 0, worst = 0; const d0 = X.XQ.detours || 0, f0 = X.XQ.flips;
  for (let i = 0; i < steps; i++) { st(); const e = tot(); if (Math.abs(e - prev) > 1e-3) jumps++; if (Math.abs(e - prev) > Math.abs(worst)) worst = e - prev; prev = e; }
  return { jumps, worst: +worst.toExponential(1), detours: (X.XQ.detours || 0) - d0, flips: X.XQ.flips - f0 };
}

/* 1. A polarized step that does not settle and restarts fresh lands paired; the probe's switch back was paid to the bath
   as a real switch, so the books jumped by the paired branch's excess: GFN2, flat, seed 6, +0.32 eV at the 10th
   insulated step. Now the step books its jump from the last settled step's energy carried along its slope. */
PARTS.seed6 = async (check, say) => {
  const r = mixture(2, 6, false);
  check(r.jumps === 0 && Math.abs(r.worst) < 1e-3 && r.detours >= 1, `bug fix after 1.26 (spin branch): GFN2 polarized, the hot mixture, seed 6: ${r.detours} fresh start(s) booked, no jump over 1 meV (worst ${r.worst} eV)`, 'bugfix126 seed6: ' + JSON.stringify(r));
};

/* 2. The hot mixture's four seeds, flat and 3-D, GFN1 and GFN2: no jump over 1 meV (before: GFN1 flat seeds 5 and 7,
   0.27 and 0.32 eV; GFN2 flat seed 6, 0.32; GFN2 3-D seed 7, 0.093). The probe's real switches still paid as before. */
PARTS.mixture = async (check, say) => {
  const rows = [];
  for (const meth of [1, 2]) for (const d3 of [false, true]) for (const seed of [3, 5, 6, 7]) rows.push({ meth, d3, seed, ...mixture(meth, seed, d3) });
  const bad = rows.filter(r => r.jumps || Math.abs(r.worst) >= 1e-3), worst = Math.max(...rows.map(r => Math.abs(r.worst)));
  check(!bad.length, `bug fix after 1.26 (spin branch): 16 runs of the hot mixture (GFN1, GFN2; flat, 3-D; seeds 3, 5, 6, 7) keep their books step by step (worst ${worst.toExponential(1)} eV; ${rows.reduce((t, r) => t + r.detours, 0)} fresh starts booked, ${rows.reduce((t, r) => t + r.flips, 0)} switches by the probe)`, 'bugfix126 mixture: ' + JSON.stringify(bad));
};

module.exports = async function fbug126(check, say, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(check, say); } catch (e) { check(false, '', `bugfix126 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(check, say, process.argv.slice(2));
  console.log(fails ? `${fails} failure(s)` : 'bug-fix (after the 1.26 merge) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
