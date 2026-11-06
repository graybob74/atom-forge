'use strict';
/* The 1.26 checks for the many-body metals' oxides, hydrides, alloys and directional bonding (Settings → Experimental →
   Metals → Many-body; src/bometal.js), run by t_features (its "1.26 (metals)" block) or alone: node tests/f_126m.js
   [part …] (parts: oxide, surface, forces, books, alloy, bcc, bccmd, dirforces, page). Each fails on 1.25 (cc8a0fd); bcc, bccmd, dirforces and page's body-centred words on bbf3c16 (before directional bonding). The physics parts run in the Node
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
      X.addAtom('Cl', -8.1, -4.7, { charge: -1 });
    });
    const xs = P.filter(p => p.Z === 8 || p.Z === 1 || p.Z === 17);
    out[d3 ? '3-D' : '2-D'] = { err: +slopeErr(X, [...xs.filter(p => X.mbIsX(p.i) || p.Z === 17), ...P.slice(0, 6)], d3).toExponential(1), partners: X.MBO.nx, half: xs.some(p => X.mbIsX(p.i) && X.mbW(p.i) === 0.5) };
  }
  X.mbSet(0);
  check(out['2-D'].err < 1e-6 && out['3-D'].err < 1e-6 && out['2-D'].partners >= 6 && out['2-D'].half,
    `1.26 metals: forces are the energy's slopes with O and H on the metal and a Cl⁻ ion near it (worst ${out['2-D'].err} eV/Å flat, ${out['3-D'].err} in 3-D; ${out['2-D'].partners} partners, the OH radical's O at half weight)`,
    '1.26 metals forces: ' + JSON.stringify(out));
};
/* ---- 4. the books: localPE's many-body part stays exact with partners and ions (a partner, a member and an ion moved; O₂
   split on the metal as mbEvents does it); an ion's image pull is there (Na⁺ over a 3-D Cu patch) */
PARTS.books = async (page, check) => {
  const X = load('all', { seed: 3 }); X.mbSet(1);
  const out = {};
  let o2 = null, na = null, ox = null;
  const P = patch(X, 'Cu', 2.5, 7, true, 0.2, () => { o2 = X.addMolecule('O2', 0, 0, 0, 0, 7.2); na = X.addAtom('F', 0, 1.2, { charge: -1, z: -7.6 }); ox = X.addAtom('O', 7.4, 0, { z: 0.6 }); });
  const tot = () => { X.gridTouch(); const e = X.totalEnergy(); return e.pe + e.internal; };
  for (const [k, p] of [['partner', ox], ['member', P[10]], ['ion', na]]) { const s = new Set([p]); const l0 = X.localPE(s), e0 = tot(); p.x += 0.3; p.y -= 0.2; p.z += 0.1; X.gridTouch(); out[k] = Math.abs((X.localPE(s) - l0) - (tot() - e0)); }
  // O₂ split near the patch, the pieces moved toward it (the event's trial, done by hand)
  const s = X.setOf(X.molecule(o2[0])), l0 = X.localPE(s), e0 = tot();
  X.removeBond(o2[0].bonds[0]); o2[0].x -= 1.2; o2[1].x += 1.2; o2[0].z -= 1.2; o2[1].z -= 1.2; X.gridTouch();
  out.split = Math.abs((X.localPE(X.closeSet(s)) - l0) - (tot() - e0)); out.gain = +((X.localPE(s) - l0)).toFixed(2);
  out.image = +X.mbImgLocal(new Set([na])).toFixed(3);
  X.mbSet(0);
  check(out.partner < 1e-9 && out.member < 1e-9 && out.ion < 1e-9 && out.split < 1e-9 && out.image < -0.1,
    `1.26 metals: the event books stay exact with O, H and ions on the metal (a partner moved ${out.partner.toExponential(0)}, a member ${out.member.toExponential(0)}, an ion ${out.ion.toExponential(0)}, O₂ split ${out.split.toExponential(0)} eV off the total's change); F⁻ next to the metal feels its image (${out.image} eV)`,
    '1.26 metals books: ' + JSON.stringify(out));
};
/* ---- 6. alloys: strongly bound pairs have constants of their own, fitted to one compound each (NiAl, Cu₃Au …); the
   other compound of the pair comes out (Ni₃Al, CuAu), Al dissolves in Ni with a large heat, Cu₃Au is lower ordered than
   at random (1.25: Al in Ni +0.15 eV, the mixed constants) */
PARTS.alloy = async (page, check) => {
  const F = require('../tools/mbfit.js'), X = F.X; X.mbSet(1);
  const out = {};
  for (const c of F.ALCHECK) {
    const pa = X.mbParam(X.SYM2Z[c[0]]), pb = X.mbParam(X.SYM2Z[c[1]]);
    let best = Infinity; for (let s = 0.96; s <= 1.04; s += 0.004) best = Math.min(best, F.energy(c, s).E);
    out[c[0] + c[2] + c[1]] = { dHf: +((best + c[2] * pa.Ec + c[3] * pb.Ec) * KJ).toFixed(1), meas: c[4] };
  }
  // one Al atom in a periodic Ni crystal (3-D, 108 sites, unrelaxed) against bulk Ni and bulk Al
  const fcc = (sym, a, n, sub) => { const cc = a * Math.SQRT2, L = n * cc; X.baseWorld(L, L, 1, 0); X.W.gamma = 0; X.world3d(L); X.W.wall = 'wrap'; const B = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]]; let k = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let l = 0; l < n; l++) for (const b of B) X.addAtom(sub(k++, i + b[0], j + b[1], l + b[2]) || sym, (i + b[0] + 0.25) * cc - L / 2, (j + b[1] + 0.25) * cc - L / 2, { z: (l + b[2] + 0.25) * cc - L / 2 }); X.gridTouch(); X.vlInvalidate(); X.computeForces(); return X.totalEnergy().pe; };
  const ni = X.mbParam(28), al = X.mbParam(13), E0 = fcc('Ni', ni.r0, 3, () => 0), E1 = fcc('Ni', ni.r0, 3, (k) => k === 13 ? 'Al' : 0);
  out.AlInNi = +(E1 - E0 * 107 / 108 + al.Ec).toFixed(2);
  // Cu₃Au: L1₂ against one fixed random arrangement of the same atoms, both at a = 2.651 Å (unrelaxed)
  const perm = []; for (let k = 0; k < 108; k++) perm.push(k < 27 ? 'Au' : 'Cu'); for (let k = 107, g = 12345; k > 0; k--) { g = (g * 1103515245 + 12345) % 2147483648; const j = g % (k + 1); [perm[k], perm[j]] = [perm[j], perm[k]]; }
  const eo = fcc('Cu', 2.651, 3, (k, x, y, z) => (x % 1 === 0 && y % 1 === 0 && z % 1 === 0) ? 'Au' : 0), er = fcc('Cu', 2.651, 3, (k) => perm[k]);
  out.ordering = +((eo - er) / 108).toFixed(3);
  X.mbSet(0);
  const ok = (o) => Math.abs(o.dHf / o.meas - 1) < 0.1;
  check(ok(out.Ni3Al) && ok(out.Cu1Au) && out.AlInNi < -1 && out.ordering < -0.01,
    `1.26 metals: alloys with constants of their own (fitted on NiAl, Cu₃Au, NiTi, FeAl, CuZn, TiAl): Ni₃Al ${out.Ni3Al.dHf} kJ/mol (measured −165.2), CuAu ${out.Cu1Au.dHf} (−18.2), an Al atom in Ni ${out.AlInNi} eV (unrelaxed; 1.25: +0.15), Cu₃Au ordered ${-out.ordering} eV an atom below random`,
    '1.26 metals alloy: ' + JSON.stringify(out));
};
/* ---- 7. directional bonding (bcc metals): periodic 3-D crystals built in the game; bcc has the measured cohesive energy
   at the measured spacing with no force on scaling, fcc and hcp (each at its best spacing) lie above it, the vacancy costs
   about what it does (1.25: W, Fe, Mo, Cr, Na fitted on a close-packed crystal, so fcc lay below bcc) */
function lattice(X, sym, kind, a, n, opts = {}) { // (bcc, fcc: cubic cells n³; hcp: orthorhombic a × a√3 × c cells, n × n/2 × n/2)
  const hcp = kind === 'hcp', c = a * (opts.ca || Math.sqrt(8 / 3));
  const B = kind === 'bcc' ? [[0, 0, 0], [0.5, 0.5, 0.5]] : kind === 'fcc' ? [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]] : [[0, 0, 0], [0.5, 0.5, 0], [0.5, 1 / 6, 0.5], [0, 2 / 3, 0.5]];
  const C = hcp ? [a, a * Math.sqrt(3), c] : [a, a, a], N = hcp ? [n, Math.max(2, n >> 1), Math.max(2, n >> 1)] : [n, n, n], Lb = C.map((l, k) => l * N[k]);
  X.baseWorld(Lb[0], Lb[1], 1, 0); X.W.gamma = 0; X.world3d(Lb[2]); X.W.wall = 'wrap';
  let k = 0;
  for (let i = 0; i < N[0]; i++) for (let j = 0; j < N[1]; j++) for (let l = 0; l < N[2]; l++) for (const b of B) { if (k++ === opts.skip) continue; X.addAtom(opts.sub ? opts.sub(k - 1) || sym : sym, (i + b[0] + 0.25) * C[0] - Lb[0] / 2, (j + b[1] + 0.25) * C[1] - Lb[1] / 2, { z: (l + b[2] + 0.25) * C[2] - Lb[2] / 2 }); }
  X.gridTouch(); X.vlInvalidate(); X.computeForces(); return { E: X.totalEnergy().pe, n: X.W.parts.filter(p => !p.dead).length };
}
const BCC_REF = { W: [8.90, 3.165, 3.67, 0.48], Mo: [6.82, 3.147, 3.0, 0.42], Cr: [4.10, 2.885, 2.0, 0.40], Fe: [4.28, 2.866, 1.6, 0.10], Na: [1.113, 4.225, 0.42, 0.003] }; // ([Ec eV, bcc a Å, vacancy eV, fcc − bcc eV], from memory: PERF-NOTES 1.26)
PARTS.bcc = async (page, check) => {
  const X = load('all', { seed: 3 }); X.mbSet(1);
  const out = {};
  for (const [sym, [Ec, a0, Ev, dF]] of Object.entries(BCC_REF)) {
    const a = Math.abs(2 * X.mbParam(X.SYM2Z[sym]).r0 / Math.sqrt(3) / a0 - 1) < 0.002 ? 2 * X.mbParam(X.SYM2Z[sym]).r0 / Math.sqrt(3) : a0; // (the fitted spacing, when it is the measured one to 0.2%)
    const per = (kind, s, n) => { const r = lattice(X, sym, kind, kind === 'bcc' ? a * s : kind === 'fcc' ? Math.cbrt(2) * a * s : a * Math.cbrt(Math.SQRT2 / 2) * s, n); return r.E / r.n; };
    const eb = per('bcc', 1, 4), h = 1e-4, slope = (per('bcc', 1 + h, 4) - per('bcc', 1 - h, 4)) / (2 * h);
    let ef = Infinity, eh = Infinity; for (let s = 0.97; s <= 1.035; s += 0.0125) { ef = Math.min(ef, per('fcc', s, 3)); eh = Math.min(eh, per('hcp', s, 4)); }
    const ev = lattice(X, sym, 'bcc', a, 4, { skip: 37 }).E - 127 * eb;
    out[sym] = { Ec: +(-eb).toFixed(3), slope: +slope.toExponential(0), fcc: +(ef - eb).toFixed(3), hcp: +(eh - eb).toFixed(3), Ev: +ev.toFixed(2) };
    out[sym].ok = Math.abs(eb + Ec) < 0.003 && Math.abs(slope) < 2e-3 && ef - eb > 0.6 * dF && eh - eb > 0.6 * dF && Math.abs(ev / Ev - 1) < 0.15;
  }
  X.mbSet(0);
  check(Object.values(out).every(o => o.ok),
    `1.26 metals: directional bonding: W, Mo, Cr, Fe, Na are bcc at their measured spacing and cohesive energy, fcc and hcp above it (W +${out.W.fcc}/+${out.W.hcp} eV an atom, measured about 0.48; Mo +${out.Mo.fcc}/+${out.Mo.hcp}; Cr +${out.Cr.fcc}/+${out.Cr.hcp}; Fe +${out.Fe.fcc}/+${out.Fe.hcp}, about 0.1; Na +${out.Na.fcc}/+${out.Na.hcp}); vacancies W ${out.W.Ev}, Mo ${out.Mo.Ev}, Cr ${out.Cr.Ev}, Fe ${out.Fe.Ev}, Na ${out.Na.Ev} eV (unrelaxed)`,
    '1.26 metals bcc: ' + JSON.stringify(out));
};
/* ---- 8. directional bonding in motion: a tungsten ball (3-D, free) started fcc turns bcc at 600 K within a picosecond, and
   one started bcc stays bcc at 300 K (atoms inside with 14 neighbours within 1.3 r₀, bcc's 8 + 6, against fcc's 12) */
PARTS.bccmd = async (page, check) => {
  const X = load('all', { seed: 7 });
  const out = {};
  for (const [start, T] of [['fcc', 600], ['bcc', 300]]) {
    X.mbSet(1); const r0 = X.mbParam(74).r0, R = 8, a = start === 'bcc' ? 2 * r0 / Math.sqrt(3) : r0 * 1.03 * Math.SQRT2, B = start === 'bcc' ? [[0, 0, 0], [0.5, 0.5, 0.5]] : [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]];
    X.baseWorld(64, 64, T, 0.05); X.world3d(64);
    const n = Math.ceil(R / a) + 1; for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) for (const b of B) { const x = (i + b[0]) * a, y = (j + b[1]) * a, z = (k + b[2]) * a; if (x * x + y * y + z * z <= R * R) X.addAtom('W', x, y, { z }); }
    const P = X.W.parts.filter(p => !p.dead); for (const p of P) { const v = X.thermalV(p.m, T); p.vx = v[0]; p.vy = v[1]; p.vz = v[2] || 0; }
    X.computeForces(); const t0 = X.W.t; while ((X.W.t - t0) * X.PHYS.TU_S * 1e12 < 1) { X.W.dt = X.chooseDt(); X.step(X.W.dt); }
    let inner = 0, n14 = 0, n12 = 0; const cx = P.reduce((s, p) => s + p.x, 0) / P.length, cy = P.reduce((s, p) => s + p.y, 0) / P.length, cz = P.reduce((s, p) => s + p.z, 0) / P.length;
    for (const p of P) { if (Math.hypot(p.x - cx, p.y - cy, p.z - cz) > R - 3) continue; inner++; let c = 0; for (const o of P) if (o !== p && Math.hypot(o.x - p.x, o.y - p.y, o.z - p.z) < 1.3 * r0) c++; if (c === 14) n14++; else if (c === 12) n12++; }
    out[start] = { inner, bcc: n14, closePacked: n12 };
    X.mbSet(0);
  }
  check(out.fcc.bcc > out.fcc.closePacked && out.fcc.closePacked <= 0.2 * out.fcc.inner && out.bcc.bcc >= 0.6 * out.bcc.inner,
    `1.26 metals: a free tungsten ball started fcc turns bcc at 600 K (after 1 ps ${out.fcc.bcc} of its ${out.fcc.inner} inner atoms with bcc's 14 neighbours, ${out.fcc.closePacked} with fcc's 12); started bcc at 300 K it stays (${out.bcc.bcc} of ${out.bcc.inner})`,
    '1.26 metals bccmd: ' + JSON.stringify(out));
};
/* ---- 9. directional bonding's forces are the energy's slopes (2-D, 3-D; W with Fe and Cu, an O atom on the metal) and
   localPE stays exact (an atom, a pair, an edge atom moved) */
PARTS.dirforces = async (page, check) => {
  const X = load('all', { seed: 3 }); X.mbSet(1);
  const out = {};
  for (const d3 of [false, true]) {
    X.baseWorld(60, 60, 300, 0); X.W.gamma = 0; if (d3) X.world3d(60);
    const r0 = X.mbParam(74).r0, a = 2 * r0 / Math.sqrt(3);
    if (d3) { for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) for (let k = -3; k <= 3; k++) for (const b of [[0, 0, 0], [0.5, 0.5, 0.5]]) { const x = (i + b[0]) * a, y = (j + b[1]) * a, z = (k + b[2]) * a; if (x * x + y * y + z * z < 49) X.addAtom((i + j + k) % 5 === 0 ? 'Fe' : (i - j) % 7 === 0 ? 'Cu' : 'W', x + 0.3 * (X.rnd() - 0.5), y + 0.3 * (X.rnd() - 0.5), { z: z + 0.3 * (X.rnd() - 0.5) }); } }
    else for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) { const x = (i + 0.5 * (j & 1)) * r0, y = j * r0 * 0.75; if (x * x + y * y < 64) X.addAtom((i + j) % 4 === 0 ? 'Cu' : (i - j) % 5 === 0 ? 'Fe' : 'W', x + 0.3 * (X.rnd() - 0.5), y + 0.3 * (X.rnd() - 0.5)); }
    X.addAtom('O', 8.6, 0.3, d3 ? { z: 0.2 } : {});
    const P = X.W.parts.filter(p => !p.dead); for (const p of P) { p.vx = p.vy = p.vz = 0; }
    X.computeForces();
    const err = slopeErr(X, P.filter((p, k) => k % 3 === 0 || p.Z === 8), d3);
    const tot = () => { X.gridTouch(); const e = X.totalEnergy(); return e.pe + e.internal; };
    let books = 0;
    for (const set of [[P[7]], [P[3], P[4]], [P[P.length - 2]]]) { const s = new Set(set); const l0 = X.localPE(s), e0 = tot(); for (const p of set) { p.x += 0.25; p.y -= 0.15; if (d3) p.z += 0.1; } X.gridTouch(); books = Math.max(books, Math.abs((X.localPE(s) - l0) - (tot() - e0))); }
    out[d3 ? '3-D' : '2-D'] = { err: +err.toExponential(1), books: +books.toExponential(1), dirPairs: X.MBO.nd };
  }
  X.mbSet(0);
  check(['2-D', '3-D'].every(k => out[k].err < 1e-6 && out[k].books < 1e-8 && out[k].dirPairs > 50),
    `1.26 metals: directional bonding's forces are the energy's slopes (worst ${out['2-D'].err} eV/Å flat, ${out['3-D'].err} in 3-D; W with Fe, Cu and an O atom) and the event books stay exact (${Math.max(out['2-D'].books, out['3-D'].books).toExponential(0)} eV)`,
    '1.26 metals dirforces: ' + JSON.stringify(out));
};
/* ---- 5. the page: the setting's words in both modes and Help say what it now covers */
PARTS.page = async (page, check) => {
  const r = await page.evaluate(() => {
    const d2 = (SDESC.segMetal || [])[1] || '', d3 = (SDESC3.segMetal || [])[1] || '';
    const help = (document.body.innerHTML.match(/<li><b>Metallic bonding<\/b>[^]*?<\/li>/) || [''])[0];
    const note = (document.querySelector('#segMetal') && document.querySelector('#segMetal').closest('.srow').nextElementSibling || {}).textContent || '';
    const bcc = (t) => /body-centred/i.test(t), tag2 = ((COSTS.segMetal || (() => ({ o: {} })))().o[1] || [])[1] || '', tag3 = ((COSTS3.segMetal || (() => ({ o: {} })))().o[1] || [])[1] || '';
    return { d2: /oxid/i.test(d2) && bcc(d2), d3: /oxid/i.test(d3) && bcc(d3), help: /oxid/i.test(help) && /alloy/i.test(help) && bcc(help), note: /oxid/i.test(note) && bcc(note), tags: /1\.26/.test(tag2) && /1\.26/.test(tag3) };
  });
  check(r.d2 && r.d3 && r.help && r.note && r.tags, '1.26 metals: Settings (flat and 3-D words, the note, both cost tags) and Help describe oxides and hydrides and the body-centred metals\u2019 directional bonding', '1.26 metals page: ' + JSON.stringify(r));
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
