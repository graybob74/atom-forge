'use strict';
/* The 1.26 check for copper ions (the owner: "fix cu ions"; item 1 of the "Bugs on record"), run by t_features (one
   line) or alone: node tests/f_cu126.js [part …] (parts: lump, still). Node harness only. Each fails before the fix.
   (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
/* a flat triangular lump (127 atoms) or a 3-D fcc ball (141) of sym at its pair spacing r_m, at T */
function lump(X, sym, d3, T) {
  X.baseWorld(80, 80, T, 0.05); if (d3) X.world3d(80);
  const pr = X.addAtom(sym, 0, 0), a = pr.mR; X.kill(pr);
  if (!d3) { const R = 6.02 * a; for (let j = -8; j <= 8; j++) for (let i = -8; i <= 8; i++) { const x = (i + 0.5 * (j & 1)) * a, y = j * a * Math.sqrt(3) / 2; if (x * x + y * y <= R * R) X.addAtom(sym, x, y, { T }); } }
  else { const c = a * Math.SQRT2, B = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]], R = 2.95 * a; for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) for (let k = -4; k <= 4; k++) for (const b of B) { const x = (i + b[0]) * c, y = (j + b[1]) * c, z = (k + b[2]) * c; if (x * x + y * y + z * z <= R * R) X.addAtom(sym, x, y, { z, T }); } }
  X.computeForces(); return X.W.parts.filter(p => !p.dead);
}

/* 1. A copper lump with the normal pair metals keeps neutral: two metal atoms inside a metal make no Cu⁺Cu⁻ pair (the
   conduction electrons would screen it). Before: 72 of 127 flat atoms ions after 0.2 ps at 300 K (118 after 2 ps), 124
   of 141 in 3-D after 0.12 ps. Nickel the same. */
PARTS.lump = async (page, check) => {
  const out = {};
  for (const [sym, d3, n] of [['Cu', false, 1250], ['Cu', true, 600], ['Ni', false, 1250]]) {
    const X = load('all', { seed: 7 }), P = lump(X, sym, d3, 300);
    for (let s = 0; s < n; s++) X.step(0.04);
    out[sym + (d3 ? ' 3-D' : ' flat')] = { atoms: P.length, ions: P.filter(q => !q.dead && q.q).length };
  }
  check(Object.values(out).every(o => o.ions === 0),
    `1.26 copper ions: metal lumps at 300 K keep neutral with the pair model (${Object.entries(out).map(([k, o]) => `${k}: ${o.ions} ions of ${o.atoms}`).join(', ')})`,
    '1.26 copper ions lump: ' + JSON.stringify(out));
};

/* 2. What still trades electrons: lone metal atoms (a vapour: K + Cu → K⁺ + Cu⁻, as in the flame setup), a metal with
   chlorine (a Na lump among Cl atoms makes Na⁺Cl⁻), a charge already in a metal moving on (Cu⁺ next to the lump) */
PARTS.still = async (page, check) => {
  const X = load('all', { seed: 7 }), out = {};
  X.baseWorld(40, 40, 300, 0); const k = X.addAtom('K', 0, 0), cu = X.addAtom('Cu', 3.0, 0); X.computeForces();
  out.vapour = X.ionPairInMetal(k, cu, 3.0);
  const P = lump(X, 'Cu', false, 300), a = P[60], b = P.find(p => p !== a && Math.hypot(p.x - a.x, p.y - a.y) < 3), r = Math.hypot(a.x - b.x, a.y - b.y);
  out.inMetal = X.ionPairInMetal(a, b, r);
  a.ne--; X.refresh(a); out.cationGives = X.ionPairInMetal(b, a, r); // (Cu + Cu⁺ → Cu⁺ + Cu: no new charge)
  const Y = load('all', { seed: 7 }); Y.baseWorld(70, 70, 600, 0.05); // (a flat Na lump of 61 atoms among 16 Cl atoms)
  const an = 3.718; for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) { const x = (i + 0.5 * (j & 1)) * an, y = j * an * Math.sqrt(3) / 2; if (x * x + y * y <= (4.02 * an) ** 2) Y.addAtom('Na', x, y, { T: 600 }); }
  for (let i = 0; i < 16; i++) { const t = 2 * Math.PI * i / 16; Y.addAtom('Cl', (4.02 * an + 6) * Math.cos(t), (4.02 * an + 6) * Math.sin(t), { T: 600 }); }
  Y.settleOverlaps(); Y.forcesNoEvents(); for (let s = 0; s < 2500; s++) Y.step(0.04);
  out.naIons = Y.W.parts.filter(p => !p.dead && p.el && p.el.sym === 'Na' && p.q > 0).length;
  check(!out.vapour && out.inMetal && !out.cationGives && out.naIons >= 2,
    `1.26 copper ions: lone K and Cu atoms still trade an electron, two Cu atoms in a lump do not, Cu⁺ in a lump still takes one; a Na lump among Cl atoms still makes salt (${out.naIons} Na⁺ in 1 ps)`,
    '1.26 copper ions still: ' + JSON.stringify(out));
};

module.exports = async function fcu126(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.26 copper ions ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(null, check, say, null, process.argv.slice(2));
  console.log(fails ? `${fails} failure(s)` : '1.26 copper ion checks passed');
  process.exitCode = fails ? 1 : 0;
})();
