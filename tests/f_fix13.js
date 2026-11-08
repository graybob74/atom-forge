'use strict';
/* The check for 1.27 bug 13 (PERF-NOTES, "1.27: bug 13 (alkali aurides)"), run by t_features (one line) or alone:
   node tests/f_fix13.js [--node] [part …]. The 1.26 copper fix (no ion pair made between two metal atoms inside a metal)
   also kept caesium and rubidium from giving gold its electron in a mixed lump. Now metalSalt lets a pair whose electron
   costs under 2 eV to move (ionization energy less electron affinity) become ions there. The part fails on v145.
   No part needs the page. (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
/* An alternating A–B lattice at the pair's metal spacing (flat square, or 3-D CsCl type), 300 K, n steps: its ions. */
function mix(A, B, d3, n) {
  const X = load('all', { seed: 7 }), W = X.W; X.baseWorld(80, 80, 300, 0.05); if (d3) X.world3d(80);
  const pa = X.addAtom(A, 0, 0), pb = X.addAtom(B, 0, 0), a = 0.5 * (pa.mR + pb.mR); X.kill(pa); X.kill(pb);
  const P = [];
  if (!d3) { for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) P.push(X.addAtom((i + j) & 1 ? A : B, i * a, j * a)); }
  else { const c = 2 * a / Math.sqrt(3); for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) { P.push(X.addAtom(A, i * c, j * c, { z: k * c })); if (i < 2 && j < 2 && k < 2) P.push(X.addAtom(B, (i + 0.5) * c, (j + 0.5) * c, { z: (k + 0.5) * c })); } }
  X.computeForces(); W.fSpawn = W.spawned;
  for (let s = 0; s < n; s++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
  const L = P.filter(p => !p.dead);
  return { atoms: L.length, cat: L.filter(p => p.el.sym === A && p.q > 0).length, an: L.filter(p => p.el.sym === B && p.q < 0).length, other: L.filter(p => p.q !== 0).length };
}
/* Cs–Au and Rb–Au make A⁺Au⁻ pairs (flat and 3-D); Cs–Cu (2.65 eV) and K–Au (2.03 eV) stay metals. */
PARTS.aurides = async (page, check, say) => {
  const r = { csau: mix('Cs', 'Au', false, 800), csau3: mix('Cs', 'Au', true, 400), rbau: mix('Rb', 'Au', false, 800), cscu: mix('Cs', 'Cu', false, 800), kau: mix('K', 'Au', false, 800) };
  check(r.csau.cat > 20 && r.csau.an === r.csau.cat && r.csau3.cat > 30 && r.rbau.cat > 20 && r.cscu.other === 0 && r.kau.other === 0,
    `1.27 bug 13: in a mixed metal lump caesium and rubidium give gold an electron (Cs⁺Au⁻ ${r.csau.cat} pairs of 41 flat, ${r.csau3.cat} in 3-D; Rb⁺Au⁻ ${r.rbau.cat}); Cs–Cu and K–Au stay metals (${r.cscu.other}, ${r.kau.other} ions)`, 'fix13 aurides: ' + JSON.stringify(r));
};
module.exports = async function ffix13(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (fix13 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `fix13 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 bug 13 (alkali aurides) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
