'use strict';
/* The 1.26 checks for the many-body metals' oxides, hydrides, alloys and directional bonding (Settings → Experimental →
   Metals → Many-body; src/bometal.js), run by t_features (its "1.26 (metals)" block) or alone: node tests/f_126m.js
   [part …] (parts: oxide, surface, forces, books, page). Each fails on 1.25 (cc8a0fd). The physics parts run in the Node
   harness (deterministic); page in the t_features page. (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const KJ = 96.485;
/* a flat triangular patch (2-D) or an fcc ball (3-D) of sym at nearest-neighbour distance a, radius R, at rest */
function patch(X, sym, a, R, d3, jit = 0, extra) {
  X.baseWorld(R * 6, R * 6, 300, 0); X.W.gamma = 0;
  if (d3) X.world3d(R * 6);
  if (!d3) { const n = Math.ceil(R / a) + 1; for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) { const x = (i + 0.5 * (j & 1)) * a, y = j * a * Math.sqrt(3) / 2; if (x * x + y * y <= R * R) X.addAtom(sym, x + jit * (X.rnd() - 0.5), y + jit * (X.rnd() - 0.5)); } }
  else { const c = a * Math.SQRT2, B = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]], n = Math.ceil(R / c) + 1; for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) for (const b of B) { const x = (i + b[0]) * c, y = (j + b[1]) * c, z = (k + b[2]) * c; if (x * x + y * y + z * z <= R * R) X.addAtom(sym, x + jit * (X.rnd() - 0.5), y + jit * (X.rnd() - 0.5), { z: z + jit * (X.rnd() - 0.5) }); } }
  if (extra) extra();
  const P = X.W.parts.filter(p => !p.dead); for (const p of P) { p.vx = p.vy = p.vz = 0; }
  X.computeForces(); return P;
}
/* worst |force − (−slope)| over the atoms qs (central differences of the total) */
function slopeErr(X, qs, d3) {
  let worst = 0;
  for (const q of qs) for (const c of d3 ? ['x', 'y', 'z'] : ['x', 'y']) {
    const h = 1e-5, x0 = q[c]; q[c] = x0 + h; X.gridTouch(); const ep = X.totalEnergy().pe; q[c] = x0 - h; X.gridTouch(); const em = X.totalEnergy().pe; q[c] = x0; X.gridTouch();
    worst = Math.max(worst, Math.abs(-(ep - em) / (2 * h) - q['f' + c]));
  }
  X.computeForces(); return worst;
}
/* ---- 1. oxides and hydrides: each fitted compound's crystal (3-D, built by tools/mbfit.js) has its measured heat of
   formation at its measured spacing, with no force on scaling; the same constants in hematite (a check, not fitted) */
PARTS.oxide = async (page, check) => {
  const F = require('../tools/mbfit.js'), X = F.X; X.mbSet(1);
  const out = {};
  for (const [name, M, Xs] of [['Cu₂O', 'Cu', 'O'], ['Al₂O₃', 'Al', 'O'], ['FeO', 'Fe', 'O'], ['NaH', 'Na', 'H'], ['MgH₂', 'Mg', 'H']]) {
    const c = F.OX.find(o => o[0] === M && o[1] === Xs);
    const Ec = X.mbParam(X.SYM2Z[c[0]]).Ec, ref = c[2] * -Ec + c[3] * F.X2[c[1]], h = 0.003, e0 = F.energy(c, 1).E, ep = F.energy(c, 1 + h).E, em = F.energy(c, 1 - h).E;
    out[name] = { dHf: +((e0 - ref) * KJ).toFixed(1), meas: c[4], slope: +((ep - em) / (2 * h)).toExponential(1) };
    out[name].ok = Math.abs(out[name].dHf - c[4]) < 1 && Math.abs((ep - em) / (2 * h)) < 1e-3;
  }
  const hem = F.CHECK[0], Ec = X.mbParam(26).Ec; let best = Infinity; for (let s = 0.96; s <= 1.12; s += 0.01) best = Math.min(best, F.energy(hem, s).E);
  out.hematite = +((best - (2 * -Ec + 3 * F.X2.O)) * KJ).toFixed(0);
  X.mbSet(0);
  check(Object.values(out).slice(0, 5).every(o => o.ok) && out.hematite < -400,
    `1.26 metals: oxides and hydrides from the many-body metals: Cu₂O ${out['Cu₂O'].dHf} kJ/mol (measured −168.6), Al₂O₃ ${out['Al₂O₃'].dHf} (−1675.7), FeO ${out.FeO.dHf} (−272.0), NaH ${out.NaH.dHf} (−56.3), MgH₂ ${out['MgH₂'].dHf} (−75.3), each at its measured spacing; hematite from FeO's constants ${out.hematite} (measured −824)`,
    '1.26 metals oxide: ' + JSON.stringify(out));
};
/* ---- 2. a flat copper patch in O₂, O and H at 1,500 K, insulated: O₂ splits on the metal, the O atoms stay bound to it,
   the energy is kept (1.25: no O bonds to the many-body metal, nothing splits) */
PARTS.surface = async (page, check) => {
  const X = load('all', { seed: 7 }); X.mbSet(1);
  const R = 9, a = X.mbParam(29).r0 * 0.96;
  X.baseWorld(R * 5, R * 5, 300, 0); X.W.gamma = 0;
  const n = Math.ceil(R / a) + 1; for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) { const x = (i + 0.5 * (j & 1)) * a, y = j * a * Math.sqrt(3) / 2; if (x * x + y * y <= R * R) X.addAtom('Cu', x, y); }
  const free = (x, y) => X.W.parts.every(p => (p.x - x) ** 2 + (p.y - y) ** 2 > 12);
  for (const [k, cnt] of [['O2', 14], ['O', 4], ['H', 6], ['H2', 4]]) for (let i = 0; i < cnt; i++) {
    let t, r, tries = 0; do { t = X.rnd() * 2 * Math.PI; r = R + 3.5 + 7 * X.rnd(); } while (!free(r * Math.cos(t), r * Math.sin(t)) && ++tries < 200);
    if (k.length === 1) X.addAtom(k, r * Math.cos(t), r * Math.sin(t)); else X.addMolecule(k, r * Math.cos(t), r * Math.sin(t), X.rnd() * 6, 0, 0);
  }
  for (const p of X.W.parts) { const v = X.thermalV(p.m, 1500); p.vx = v[0]; p.vy = v[1]; }
  X.computeForces(); const E0 = X.totalEnergy().total;
  for (let s = 0; s < 6000; s++) X.step(0.04);
  const P = X.W.parts.filter(p => !p.dead), cu = P.filter(p => p.Z === 29);
  const bound = P.filter(p => p.Z === 8 && X.mbIsX(p.i) && cu.some(c => Math.hypot(c.x - p.x, c.y - p.y) < 2.6)).length;
  const out = { drift: +(X.totalEnergy().total - E0).toFixed(4), split: X.W.log.filter(l => /^On the metal: O₂/.test(l.text)).length, bound, members: X.MBO.n, partners: X.MBO.nx, ions: P.filter(p => p.q).length };
  check(Math.abs(out.drift) < 0.1 && out.split >= 1 && out.bound >= 2 && out.ions === 0,
    `1.26 metals: a flat Cu patch in O₂, O and H at 1,500 K: O₂ split on the metal ${out.split} times, ${out.bound} O atoms bound to it (${out.partners} O and H atoms on the many-body model), insulated 6,000 steps of 0.4 fs: ${out.drift} eV`,
    '1.26 metals surface: ' + JSON.stringify(out));
};
/* ---- 3. forces are the energy's slopes with O and H partners (an O atom, an OH radical at half weight, H atoms) and an
   ion near the metal (its image's pull), flat and in 3-D */
PARTS.forces = async (page, check) => {
  const X = load('all', { seed: 3 }); X.mbSet(1);
  const out = {};
  for (const d3 of [false, true]) {
    const P = patch(X, 'Cu', 2.5, 7, d3, 0.3, () => {
      for (let k = 0; k < 6; k++) { const t = k * Math.PI / 3, r = 7.6 + 0.3 * X.rnd(); X.addAtom(k % 2 ? 'O' : 'H', r * Math.cos(t), r * Math.sin(t), d3 ? { z: 0.5 * (X.rnd() - 0.5) } : {}); }
      const o = X.addAtom('O', 0, 8.6), h = X.addAtom('H', 0.6, 9.3); X.addBond(o, h, 1); X.addAtom('O', 1.0, 0.3, d3 ? { z: 1.4 } : {});
      X.addAtom('Na', -8.1, -4.7, { charge: 1 });
    });
    const xs = P.filter(p => p.Z === 8 || p.Z === 1 || p.Z === 11);
    out[d3 ? '3-D' : '2-D'] = { err: +slopeErr(X, [...xs.filter(p => X.mbIsX(p.i) || p.Z === 11), ...P.slice(0, 6)], d3).toExponential(1), partners: X.MBO.nx, half: xs.some(p => X.mbIsX(p.i) && X.mbW(p.i) === 0.5) };
  }
  X.mbSet(0);
  check(out['2-D'].err < 1e-6 && out['3-D'].err < 1e-6 && out['2-D'].partners >= 6 && out['2-D'].half,
    `1.26 metals: forces are the energy's slopes with O and H on the metal and an Na⁺ ion near it (worst ${out['2-D'].err} eV/Å flat, ${out['3-D'].err} in 3-D; ${out['2-D'].partners} partners, the OH radical's O at half weight)`,
    '1.26 metals forces: ' + JSON.stringify(out));
};
/* ---- 4. the books: localPE's many-body part stays exact with partners and ions (a partner, a member and an ion moved; O₂
   split on the metal as mbEvents does it); an ion's image pull is there (Na⁺ over a 3-D Cu patch) */
PARTS.books = async (page, check) => {
  const X = load('all', { seed: 3 }); X.mbSet(1);
  const out = {};
  let o2 = null, na = null, ox = null;
  const P = patch(X, 'Cu', 2.5, 7, true, 0.2, () => { o2 = X.addMolecule('O2', 0, 0, 0, 0, 7.2); na = X.addAtom('Na', 0, 1.2, { charge: 1, z: -7.6 }); ox = X.addAtom('O', 7.4, 0, { z: 0.6 }); });
  const tot = () => { X.gridTouch(); const e = X.totalEnergy(); return e.pe + e.internal; };
  for (const [k, p] of [['partner', ox], ['member', P[10]], ['ion', na]]) { const s = new Set([p]); const l0 = X.localPE(s), e0 = tot(); p.x += 0.3; p.y -= 0.2; p.z += 0.1; X.gridTouch(); out[k] = Math.abs((X.localPE(s) - l0) - (tot() - e0)); }
  // O₂ split near the patch, the pieces moved toward it (the event's trial, done by hand)
  const s = X.setOf(X.molecule(o2[0])), l0 = X.localPE(s), e0 = tot();
  X.removeBond(o2[0].bonds[0]); o2[0].x -= 1.2; o2[1].x += 1.2; o2[0].z -= 1.2; o2[1].z -= 1.2; X.gridTouch();
  out.split = Math.abs((X.localPE(X.closeSet(s)) - l0) - (tot() - e0)); out.gain = +((X.localPE(s) - l0)).toFixed(2);
  out.image = +X.mbImgLocal(new Set([na])).toFixed(3);
  X.mbSet(0);
  check(out.partner < 1e-9 && out.member < 1e-9 && out.ion < 1e-9 && out.split < 1e-9 && out.image < -0.1,
    `1.26 metals: the event books stay exact with O, H and ions on the metal (a partner moved ${out.partner.toExponential(0)}, a member ${out.member.toExponential(0)}, an ion ${out.ion.toExponential(0)}, O₂ split ${out.split.toExponential(0)} eV off the total's change); Na⁺ next to the metal feels its image (${out.image} eV)`,
    '1.26 metals books: ' + JSON.stringify(out));
};
/* ---- 5. the page: the setting's words in both modes and Help say what it now covers */
PARTS.page = async (page, check) => {
  const r = await page.evaluate(() => {
    const d2 = (SDESC.segMetal || [])[1] || '', d3 = (SDESC3.segMetal || [])[1] || '';
    const help = (document.body.innerHTML.match(/<li><b>Metallic bonding<\/b>[^]*?<\/li>/) || [''])[0];
    const note = (document.querySelector('#segMetal') && document.querySelector('#segMetal').closest('.srow').nextElementSibling || {}).textContent || '';
    return { d2: /oxid/i.test(d2), d3: /oxid/i.test(d3), help: /oxid/i.test(help) && /alloy/i.test(help), note: /oxid/i.test(note) };
  });
  check(r.d2 && r.d3 && r.help && r.note, '1.26 metals: Settings (flat and 3-D words, the note) and Help describe oxides and hydrides with the many-body metals', '1.26 metals page: ' + JSON.stringify(r));
};

module.exports = async function f126m(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (k === 'page' && !page) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.26 metals ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  const only = process.argv.slice(2);
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  let browser = null, page = null, errors = [];
  if (!only.length || only.includes('page')) { const { openPage } = require('./browser'); ({ browser, page, errors } = await openPage({ settle: 800 })); }
  await module.exports(page, check, say, null, only);
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  if (browser) await browser.close();
  console.log(fails ? `${fails} failure(s)` : '1.26 metals checks passed');
  process.exitCode = fails ? 1 : 0;
})();
