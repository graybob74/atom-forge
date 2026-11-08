'use strict';
/* The check for 1.27 bug 14 (PERF-NOTES, "1.27: bug 14 (AsCl₅)"), run by t_features (one line) or alone:
   node tests/f_fix14.js [--node] [part …]. With bond orders from the positions, AsCl₅'s chlorines (2.46 Å apart in the
   flat world) bonded to each other (orders 0.41, 0.76 eV a bond deeper than stored): the crowding rule held a ligand pair
   back only when the bonds to the common atom were 0.4–0.8 eV stronger, and As–Cl beats Cl–Cl by 0.46. Now the gap
   counts as a share of the pair's own bond (5–15%). The part fails on v145. No part needs the page.
   (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const relaxed = (X, its) => { const W = X.W, S = X.S; for (let it = 0; it < its; it++) { X.forcesNoEvents(); let fm = 0; for (const p of W.parts) fm = Math.max(fm, Math.hypot(S.fx[p.i], S.fy[p.i], W.d3 ? S.fz[p.i] : 0)); if (fm < 1e-4) break; const st = Math.min(0.002, 0.02 / fm); for (const p of W.parts) { p.x += st * S.fx[p.i]; p.y += st * S.fy[p.i]; if (W.d3) p.z += st * S.fz[p.i]; } X.gridTouch(); } return X.totalEnergy().pe; };
function star(c, l, n, d3) {
  const X = load('all', { seed: 1 }), W = X.W; X.PRESETS.empty.build(); X.setBox(40, 40); if (d3) X.world3d(40); W.T = 0; W.gamma = 0;
  const C = X.addAtom(c, 0, 0, { T: 0 }), L = X.bondLength(C.el, X.ELEMENTS[X.SYM2Z[l]], 1);
  for (let i = 0; i < n; i++) { const t = 2 * Math.PI * i / n + 0.1, ph = d3 ? (i % 2 ? 0.5 : -0.5) : 0; X.addBond(C, X.addAtom(l, L * Math.cos(t) * Math.cos(ph), L * Math.sin(t) * Math.cos(ph), { T: 0, z: L * Math.sin(ph) }), 1); }
  X.forcesNoEvents(); const E0 = relaxed(X, 3000); X.boSet(1); X.forcesNoEvents(); const E1 = relaxed(X, 3000);
  let xx = 0; for (let k = 0; k < X.BO.np; k++) { const q = X.boPairQ(k); if (q.a !== C && q.b !== C) xx = Math.max(xx, q.n); }
  return { ll: +xx.toFixed(3), dE: +((E1 - E0) / n).toFixed(3) };
}
/* AsCl₅, PCl₅, SbCl₅ and SF₆ in the flat world with bond orders, relaxed: no ligand–ligand order, and each bond within
   0.05 eV of the stored one. */
PARTS.crowd = async (page, check, say) => {
  const r = { AsCl5: star('As', 'Cl', 5), PCl5: star('P', 'Cl', 5), SbCl5: star('Sb', 'Cl', 5), SF6: star('S', 'F', 6) };
  check(Object.values(r).every(q => q.ll < 0.05 && Math.abs(q.dE) < 0.05), `1.27 bug 14: crowded molecules keep their ligands apart with bond orders (largest ligand–ligand order: AsCl₅ ${r.AsCl5.ll}, PCl₅ ${r.PCl5.ll}, SbCl₅ ${r.SbCl5.ll}, SF₆ ${r.SF6.ll}; AsCl₅'s energy ${r.AsCl5.dE} eV a bond from the stored)`, 'fix14 crowd: ' + JSON.stringify(r));
};
module.exports = async function ffix14(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (fix14 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `fix14 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 bug 14 (AsCl₅) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
