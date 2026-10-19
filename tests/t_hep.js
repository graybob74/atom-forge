'use strict';
/* Particle physics in collisions (hep.js): phase space keeps energy and momentum; an electron and a positron
   annihilate into the channels their energy allows; nucleons make pions, deuterons, kaons and antiprotons above
   their thresholds; matter and antimatter annihilate into mesons; nuclei that touch above their Coulomb barrier make
   new nuclei (compound nucleus, fragmentation, spallation, fission); every event keeps energy to the eV; unstable
   particles decay in flight with time-dilated lives; fast nuclei no longer pass through a plasma's ions; electrons
   crossing a nucleus are turned; neutrons above 20 MeV fly at their relativistic speed; the colliders tally what
   they make. Node only.
   node tests/t_hep.js */
const { load } = require('./load');
let fails = 0;
const bad = (m) => { fails++; console.log('FAIL', m); };
const info = (m) => console.log('  ' + m);
const inv = (X) => X.totalEnergy().total - X.W.ledger.nuc;

// 1. phase space: every body on its mass shell, energy and momentum summing to the parent's
{
  const X = load(undefined, { seed: 1 });
  let worst = 0;
  for (let k = 0; k < 3000; k++) {
    const n = 2 + Math.floor(Math.random() * 14), ms = [];
    for (let i = 0; i < n; i++) ms.push([0, 0, 0.511, 105.66, 139.57, 938.27, 3727.4][Math.floor(Math.random() * 7)]);
    const M = ms.reduce((s, m) => s + m, 0) + Math.random() * 4000 + 1e-3, v = X.phaseSpace(M, ms);
    let E = 0, px = 0, py = 0;
    v.forEach((q, i) => { E += q[0]; px += q[1]; py += q[2]; worst = Math.max(worst, Math.abs(q[0] * q[0] - q[1] * q[1] - q[2] * q[2] - ms[i] * ms[i]) / (q[0] * q[0] + 1)); });
    worst = Math.max(worst, Math.abs(E - M) / M, Math.hypot(px, py) / M);
  }
  info(`phase space: 3000 decays into 2–15 bodies (photons among them), worst relative error ${worst.toExponential(1)}`);
  if (!(worst < 1e-9)) bad(`phase space off by ${worst}`);
}

// 2. collisions forced at a pass distance, many times: what comes out, and the energy books (to the eV)
function trials(seed, mk, call, N) {
  const X = load(undefined, { seed });
  const { W } = X;
  const out = new Map(); let worst = 0, products = 0;
  for (let k = 0; k < N; k++) {
    X.clearWorld(); W.box.w = W.box.tw = 4000; W.box.h = W.box.th = 4000; W.wall = 'open'; W.T = 0; W.gamma = 0; W.warp = 1; W.decayOn = true;
    const [a, b] = mk(X);
    X.forcesNoEvents();
    const E0 = inv(X), n0 = W.parts.length;
    const r = call(X, a, b);
    worst = Math.max(worst, Math.abs(inv(X) - E0));
    products = Math.max(products, W.parts.length - n0 + W.exo.length);
    const txt = typeof r === 'string' ? r : W.log.length ? W.log[W.log.length - 1].text : '';
    out.set(txt, (out.get(txt) || 0) + 1);
  }
  const all = [...out.entries()], has = (re) => all.filter(([t]) => re.test(t)).reduce((s, [, n]) => s + n, 0);
  return { worst, has, products, top: all.sort((p, q) => q[1] - p[1]).slice(0, 3).map(([t, n]) => `${n}× ${t.replace(/^.*?→ /, '→ ').slice(0, 60)}`).join(' | ') };
}
const fireB = (X, Z, A, KE, x, ux, anti) => X.fireSpec({ kind: 'atom', Z, A, bare: true, anti: !!anti }, x, 0, ux, 0, KE);
const ee = (E) => (X) => [X.fireSpec({ kind: 'pos' }, -1, 0, 1, 0, E), X.fireSpec({ kind: 'e' }, 1, 0, -1, 0, E)];
const eeCall = (X, a, b) => { X.eeEvent(a, b, 0, 0); };
const enc = (u) => (X, a, b) => X.nuclearEncounter(a, b, typeof u === 'function' ? u() : u, 0, 0);
const cases = [
  ['e⁺e⁻ at 150 MeV each', 1, ee(1.5e8), eeCall, 400, (r) => [r.has(/μ⁻ \+ μ⁺/) >= 6 && r.has(/μ⁻ \+ μ⁺/) <= 50, 'muon pairs among the annihilations (≈5%)'], (r) => [r.has(/2γ/) > 300, 'mostly two γ rays']],
  ['e⁺e⁻ at 509 MeV each (the φ)', 2, ee(5.092e8), eeCall, 200, (r) => [r.has(/K⁺ \+ K⁻/) >= 40, 'kaon pairs from the φ'], (r) => [r.has(/K⁰/) >= 15, 'neutral kaons too']],
  ['p + p at 100 MeV each, dead on', 3, (X) => [fireB(X, 1, 1, 1e8, -1, 1), fireB(X, 1, 1, 1e8, 1, -1)], enc(0.001), 200, (r) => [r.has(/→ d \+ π⁺/) >= 30, 'p p → d π⁺ (deuterium made)'], (r) => [r.has(/π/) === 200, 'a pion every time']],
  ['p + p at 2 GeV each, dead on', 4, (X) => [fireB(X, 1, 1, 2e9, -1, 1), fireB(X, 1, 1, 2e9, 1, -1)], enc(0.001), 400, (r) => [r.has(/p̄/) >= 2, 'antiprotons'], (r) => [r.has(/K|Λ/) >= 4, 'kaons and Λ']],
  ['p + p̄ at 5 MeV each', 5, (X) => [fireB(X, 1, 1, 5e6, -1, 1), fireB(X, 1, 1, 5e6, 1, -1, true)], (X, a, b) => X.nnbarEvent(a, b, 0, 0), 200, (r) => [r.has(/π/) >= 150, 'pions'], (r) => [r.has(/n \+ n̄/) >= 5, 'charge exchange p p̄ → n n̄']],
  ['¹²C + ¹²C at 30 MeV each, dead on', 6, (X) => [fireB(X, 6, 12, 3e7, -1, 1), fireB(X, 6, 12, 3e7, 1, -1)], enc(0.01), 100, (r) => [r.has(/(Ne|Na|O|N|B|Mg)/) >= 80, 'new elements (O, Ne, Na …)']],
  ['⁵⁶Fe + ⁵⁶Fe at 100 MeV each, dead on', 7, (X) => [fireB(X, 26, 56, 1e8, -2, 1), fireB(X, 26, 56, 1e8, 2, -1)], enc(0.0001), 40, (r) => [r.has(/(Pd|Rh|Ru|Ag|Cd|Tc|Mo|In|Sn)/) >= 30, 'compound-nucleus residues near Z = 45']],
  ['¹⁹⁷Au + ¹⁹⁷Au at 10 GeV each', 8, (X) => [fireB(X, 79, 197, 1e10, -3, 1), fireB(X, 79, 197, 1e10, 3, -1)], enc(() => Math.random() * 0.3), 12, (r) => [r.products >= 80, 'a spray of fragments (fragmentation)']],
  ['n at 2 GeV + ²³⁸U at rest', 9, (X) => [X.fireSpec({ kind: 'n' }, -1, 0, 1, 0, 2e9), X.addAtom('U', 1, 0, { A: 238 })], (X, a, b) => { const sp = a.sp / X.PHYS.C; const r = X.neutronHit(a, b, 0.2, 0.9); return (sp < 1 ? '' : 'SUPERLUMINAL ') + (r ? (X.W.log.length ? X.W.log[X.W.log.length - 1].text : 'diffraction') : 'nothing'); }, 40, (r) => [r.has(/SUPERLUMINAL/) === 0, 'slower than light'], (r) => [r.has(/spallation/) >= 12, 'spallation (with fission)']],
];
for (const [name, seed, mk, call, N, ...checks] of cases) {
  const r = trials(seed, mk, call, N);
  info(`${name}: ${N} collisions, energy kept to ${r.worst.toFixed(4)} eV; ${r.top}`);
  if (!(r.worst < 0.01)) bad(`${name}: energy off by ${r.worst.toFixed(4)} eV`);
  for (const c of checks) { const [ok, what] = c(r); if (!ok) bad(`${name}: expected ${what}`); }
}

// 3. no tunnelling: deuterons at 0.3c fired through the D–T plasma react with its ions (they used to pass straight through)
{
  const X = load('all', { seed: 3 });
  const { W } = X;
  X.PRESETS.fusion.build();
  for (let k = 0; k < 6; k++) X.fireSpec({ kind: 'atom', Z: 1, A: 2, bare: true }, -29, -15 + 6 * k, 1, 0, 9e7);
  X.settleOverlaps(); W.baseSpf = W.simPerFrame;
  const n0 = W.log.length;
  for (let f = 0; f < 120; f++) X.simFrame(1 / 60, 1e9);
  const hits = W.log.slice(n0).filter(l => /breakup|elastic|→ .*(p|n|d|t)/.test(l.text) && !/^Fusion: ²H \+ ³H → ⁴He \+ n/.test(l.text)).length;
  info(`90 MeV deuterons through the D–T plasma: ${hits} nuclear encounters with its ions`);
  if (hits < 3) bad(`fast deuterons tunnelled through the plasma (${hits} encounters)`);
}

// 4. a fast electron crossing a uranium nucleus is turned by its charge (at 2 MeV, right round); one passing outside is not
{
  const X = load('all', { seed: 3 });
  const { W } = X;
  X.clearWorld(); W.box.w = W.box.tw = 200; W.box.h = W.box.th = 200; W.wall = 'open'; W.T = 0; W.gamma = 0; W.simPerFrame = 0.0004;
  X.addNuc(92, 146, 0, 0, 0);
  const inside = X.fireSpec({ kind: 'e' }, -6, 0.4, 1, 0, 2e6), outside = X.fireSpec({ kind: 'e' }, -6, 1.2, 1, 0, 2e6);
  for (let f = 0; f < 30; f++) X.simFrame(1 / 60, 1e9);
  const ang = (e) => Math.abs(Math.atan2(e.uy, e.ux) * 180 / Math.PI);
  info(`2 MeV electrons and a ²³⁸U nucleus (drawn 0.82 Å across): one crossing it turned ${ang(inside).toFixed(0)}°, one passing 1.2 Å off ${ang(outside).toFixed(1)}°`);
  if (!(ang(inside) > 90)) bad(`an electron crossing the nucleus turned only ${ang(inside).toFixed(1)}°`);
  if (ang(outside) > 0.5) bad('an electron passing outside the nucleus was turned');
}

// 5. decays in flight: at real rates a π⁰ decays within nanometres and the rest fly out; sped up, π → μ → e
for (const warp of [1, 1e11]) {
  const X = load(undefined, { seed: 4 });
  const { W } = X;
  X.clearWorld(); W.box.w = W.box.tw = 3000; W.box.h = W.box.th = 3000; W.wall = 'open'; W.T = 0; W.gamma = 0; W.warp = warp; W.decayOn = true;
  const E0 = inv(X);
  for (const sp of ['pi0', 'pi+', 'mu-', 'K+', 'Lam']) X.addExo(sp, 0, 0, 3e8, 1, 0);
  X.W.ledger.nuc -= ['pi0', 'pi+', 'mu-', 'K+', 'Lam'].reduce((s, sp) => s + X.XP[sp].m * 1e6, 0); // (made from nothing here: book their rest mass)
  const E1 = inv(X), seen = new Set();
  let worst = 0;
  for (let f = 0; f < 400; f++) { X.simFrame(1 / 60, 1e9); worst = Math.max(worst, Math.abs(inv(X) - E1)); for (const l of W.log) { const m = /Decay(?: in flight)?: (\S+) →/.exec(l.text); if (m) seen.add(m[1]); } }
  info(`decays at ${warp === 1 ? 'real rates' : 'rates sped up ×10¹¹'}: ${[...seen].join(' ') || 'none'} decayed; energy kept to ${worst.toFixed(4)} eV (added ${X.fmtE(E1 - E0)})`);
  if (!(worst < 0.01)) bad(`decays in flight: energy off by ${worst} eV`);
  if (warp === 1 && (!seen.has('π⁰') || seen.has('π⁺') || seen.has('μ⁻'))) bad('at real rates only the π⁰ should decay in the chamber');
  if (warp > 1 && !(seen.has('π⁺') && seen.has('μ⁻') && seen.has('μ⁺') && seen.has('K⁺') && seen.has('Λ'))) bad(`sped up, π⁺ → μ⁺ → e⁺, μ⁻, K⁺ and Λ should decay (saw ${[...seen].join(' ')})`);
}

// 6. the colliders make new particles and nuclei, and tally them
for (const [a, b, E, want, frames] of [['p', 'p', 3e8, /π/, 1500], ['c12', 'c12', 3e7, /(O|Ne|Na|Mg|N|B)$/, 1500], ['pos', 'e', 5.092e8, /K/, 1500]]) {
  const X = load('all', { seed: 3 });
  const { W } = X;
  X.PRESETS.linac.build(); X.setupCollider('linear', a, b, E);
  X.settleOverlaps(); W.baseSpf = W.simPerFrame;
  let f = 0;
  for (; f < frames && !Object.keys(W.collider.made || {}).some(k => want.test(k)); f++) X.simFrame(1 / 60, 1e9);
  const made = Object.entries(W.collider.made || {}).map(([k, n]) => `${k}×${n}`).join(' ');
  info(`linear collider ${a} + ${b} at ${X.fmtE(E)} each: after ${f} frames made ${made || 'nothing'} (${W.collider.hits} collisions)`);
  if (!Object.keys(W.collider.made || {}).some(k => want.test(k))) bad(`linear collider ${a} + ${b}: nothing matching ${want} made`);
}
// 7. D–T fusion follows its measured cross section above 150 keV (and is as it was below): about 25 times rarer at
//    4.8 MeV than at the D + T collider's 144 keV, also where touching nuclei break up (0.046 c each)
{
  const X = load(undefined, { seed: 11 });
  const { W } = X;
  X.clearWorld();
  const d = X.addNuc(1, 1, 0, 0, 0), t = X.addNuc(1, 2, 0, 1, 0), EG = 979.15 * d.m * t.m / (d.m + t.m);
  const old = (E) => Math.min(0.9, 5 * (100 / E) * Math.exp(-Math.sqrt(EG / E))), P = (E) => X.gamowP(d, t, E * 1000).P;
  const same = [10, 30, 64, 144].every(E => Math.abs(P(E) / old(E) - 1) < 1e-9), r = P(144) / P(4760);
  info(`D–T fusion chance per pass: ${[10, 64, 144, 300, 1000, 4760].map(E => `${E} keV ${P(E).toExponential(2)}`).join(', ')}; 144 keV over 4.8 MeV ${r.toFixed(0)}× (σ: ${(X.sigmaDT(144) / X.sigmaDT(4760)).toFixed(0)}×); σ peak ${(X.sigmaDT(64) / 1000).toFixed(2)} b at 64 keV`);
  if (!same) bad('D–T fusion changed at or below 144 keV');
  if (!(r > 18 && r < 35)) bad(`D–T fusion at 4.8 MeV should be ~25× rarer than at 144 keV, is ${r.toFixed(1)}×`);
  if (!(Math.abs(X.sigmaDT(64) - 5060) < 120)) bad(`the D–T cross section should peak near 5.0 b at 64 keV: ${X.sigmaDT(64).toFixed(0)} mb`);
  const r1 = trials(12, (X) => [fireB(X, 1, 2, 1.986e6, -1, 1), fireB(X, 1, 3, 2.975e6, 1, -1)], enc(() => Math.random()), 800);
  const fus = r1.has(/→ α \+ n/), el = r1.has(/→ t \+ d|→ d \+ t/);
  info(`d + t at 0.046 c each (800 passes): ${fus} ⁴He + n, ${el} nuclear elastic, top ${r1.top}; books to ${r1.worst.toExponential(1)} eV`);
  if (!(fus <= 20)) bad(`⁴He + n should come from about 1 pass in 100 at 0.046 c, came from ${fus} of 800`);
  if (!(el > 400)) bad(`nuclear elastic scattering should lead at 0.046 c: ${el} of 800`);
  if (!(r1.worst < 0.01)) bad(`d + t breakups off the books by ${r1.worst} eV`);
}
// nothing past element 120: no isotope of it β⁻-decays (there is no element 121 here), and a compound of two
// oganesson nuclei splits at once instead of becoming a nucleus with 236 protons
{
  const X = load('all', { seed: 8 });
  let beta = 0;
  for (let N = 0; N <= X.nbMaxN(120); N++) if ((X.nuclideInfo(120, N).modes || []).some(m => m.mode === 'b-')) beta++;
  const items = [], moms = [], Ms = X.nucMeV(236, 476) + 80;
  X.compoundDecay(236, 476, Ms, [Ms, 0, 0], false, items, moms, 0);
  const nucs = items.filter(it => it.t !== 'g' && it.t !== 'v' && it.Z !== undefined), maxZ = Math.max(...nucs.map(it => it.Z));
  info(`a hot compound of two ³⁵⁶Og nuclei (Z 236, A 712) splits into ${nucs.length} nuclei and neutrons, the heaviest Z ${maxZ}; isotopes of element 120 that β⁻-decay: ${beta}`);
  if (beta) bad(`${beta} isotopes of element 120 β⁻-decay, into an element that does not exist here`);
  if (!(maxZ <= 120)) bad(`a Z 236 compound left a nucleus with Z ${maxZ}`);
}
// elements 119 and 120, never made but predicted, can exist when a collision makes them: an atom of ²⁹⁶Ubn is an
// alkaline earth atom, [Og] 8s², and it α-decays (predicted half-life about 1 µs) into ²⁹²Og; both stay off the
// periodic table and the menus
{
  const X = load('all', { seed: 8 });
  const { W } = X;
  X.clearWorld(); W.box.w = W.box.tw = 60; W.box.h = W.box.th = 60; W.T = 300; W.gamma = 0.05; W.decayOn = true; W.warp = 1e8;
  const a = X.addAtom(120, 0, 0, { A: 296 }), u = X.addAtom(119, 8, 0, { A: 295 });
  const cfg = X.configString(120, 120), cfgU = X.configString(119, 119), cat = a.el.cat, sym = a.el.sym;
  for (let f = 0; f < 120 && !a.dead && a.Z === 120; f++) X.simFrame(1 / 60, 30);
  const after = (W.log.find(l => /²⁹⁶Ubn/.test(l.text) && /α/.test(l.text)) || { text: 'no decay' }).text;
  const menu = X.ELEMENTS.slice(1, X.Z_TABLE + 1).length;
  info(`element 120 (${sym}, ${cfg}, ${X.CAT_NAMES[cat]}) and 119 (${cfgU}); its decay: ${after}; ${menu} elements on the table, ${X.Z_MAX} possible`);
  if (sym !== 'Ubn' || cfg !== '[Og] 8s²' || cfgU !== '[Og] 8s¹' || cat !== 'ae' || !/²⁹²Og/.test(after) || X.Z_MAX !== 120 || menu !== 118) bad(`elements 119–120: ${JSON.stringify({ sym, cfg, cfgU, cat, after, zmax: X.Z_MAX, menu })}`);
}
// pions from an annihilation at rest can be watched: with slow motion on they take dozens of frames to leave even a
// 40 Å box (they used to be born and gone within one step)
{
  const X = load('all', { seed: 7 }); const { W } = X;
  X.PRESETS.empty.build(); W.slowmo = true; W.baseSpf = W.simPerFrame;
  X.addNuc(1, 0, 1, -3, 0, 0.004, 0); X.addNuc(1, 0, 1, 3, 0, -0.004, 0, true); W.dirty++;
  let inFlight = 0, made = false, minSlow = 1;
  for (let f = 0; f < 400; f++) {
    const r = X.simFrame(1 / 60, 1e9);
    const live = W.exo.filter(o => !o.dead).length;
    if (live) { inFlight++; made = true; minSlow = Math.min(minSlow, r.slow); }
    if (made && !live) break;
  }
  const ev = W.events.map(e => e.text).find(t => /p̄ \+ p/.test(t)) || '';
  if (!/π/.test(ev) || inFlight < 20 || minSlow > 0.01) bad(`pions from "${ev}" were in flight for ${inFlight} frames (slow motion down to ${minSlow.toExponential(1)})`);
  else console.log(`  ${ev}: the pions cross the ${W.box.w} Å box over ${inFlight} frames in slow motion`);
}
console.log(fails ? `${fails} particle-physics failure(s)` : 'particle-physics checks passed');
process.exitCode = fails ? 1 : 0;
