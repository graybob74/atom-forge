'use strict';
/* The checks for the 1.26 bug fixes "energy books with fast electrons, decay data" (PERF-NOTES, 1.26: "bug fixes (energy
   books with fast electrons, decay data)"), run by t_features (one line) or alone: node tests/f_bug126e.js [--node]
   [part …]. Each part fails before its fix (e237efe) and passes after. No part needs the page. (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const go = (X, n) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;
const UX = 0.98 / Math.hypot(0.98, 0.15), UY = 0.15 / Math.hypot(0.98, 0.15);

/* Flat game, ejectElectron among the ions and free electrons a fast electron leaves: eight 1 GeV electrons' passes
   through a lead block, and through water (with 5 MeV α and 500 MeV μ⁻ beside). It paid the electron the pull of an ion
   in flight (which carries no potential energy), let an electron launched past the radiation threshold by the charges
   around it keep their pull in radiation flight, and left out the electron's share of a moving ion's motion: up to
   48.7 eV (lead) and 39 eV (water) a freed electron before; now exact. */
PARTS.eject = async (page, check, say) => {
  const r = {};
  const patch = (s) => s.replace('function ejectElectron(p, KE, ux, uy, budget, tunnel, uz = 0) {', 'function ejectElectron(p, KE, ux, uy, budget, tunnel, uz = 0) { const G = globalThis.__bug126e, ie = ionizationCost(p), b0 = totalEnergy().total - W.ledger.nuc; const r = ejectElectron0(p, KE, ux, uy, budget, tunnel, uz); if (r && budget === undefined) { G.n++; G.w = Math.max(G.w, Math.abs(totalEnergy().total - W.ledger.nuc - b0 - KE - ie)); } return r; }\nfunction ejectElectron0(p, KE, ux, uy, budget, tunnel, uz = 0) {');
  for (const mat of ['Pb', 'water']) {
    const G = globalThis.__bug126e = { n: 0, w: 0 };
    const X = load('all', { seed: 3, patch }), W = X.W;
    if (mat === 'Pb') { X.PRESETS.empty.build(); for (let x = -12; x <= 12; x += 3.45) for (let y = -9; y <= 9; y += 3.45) { const p = X.addAtom('Pb', x, y); p.vx = p.vy = 0; } } else X.PRESETS.water.build();
    W.T = 0; W.gamma = 0; W.decayOn = false; X.forcesNoEvents();
    const hw = W.box.w / 2, hh = W.box.h / 2;
    for (let k = 0; k < 8; k++) { const e = X.addLepton(X.ELEC, -hw + 1, (X.rnd() - 0.5) * hh, 0, 0, 0, 0); X.setMotion(e, 1e9, UX, UY, 0, 0, 0); }
    if (mat === 'water') for (let k = 0; k < 4; k++) { const a = X.addNuc(2, 2, 0, -hw + 1, (X.rnd() - 0.5) * hh, 0, 0, false, 0); X.setMotion(a, 5e6, 0.995, 0.0999, 0, 0, 0); X.addExo('mu-', -hw + 1, (X.rnd() - 0.5) * hh, 5e8, 0.995, 0.0999, undefined, 0, 0); }
    for (let tick = 0; tick < 300; tick++) {
      for (const p of W.parts.slice()) if (!p.dead && p.rad) X.moveRad(p, 0.2 / p.sp);
      for (const o of W.exo.slice()) if (!o.dead && o.q && o.v > 0) { const x0 = o.x, y0 = o.y; o.x += o.ux * 0.2; o.y += o.uy * 0.2; X.exoIonize(o, x0, y0); }
    }
    r[mat] = { n: G.n, worst: +G.w.toFixed(4) };
  }
  check(r.Pb.n > 20 && r.water.n > 20 && r.Pb.worst < 0.01 && r.water.worst < 0.01, `1.26 bug fixes: electrons set free by fast electrons beside ions and free electrons are booked exactly (flat; lead ${r.Pb.n} freed, worst ${r.Pb.worst} eV; water ${r.water.n}, worst ${r.water.worst} eV; before 48.7 and 39 eV)`, 'bug126e eject: ' + JSON.stringify(r));
};

/* Flat game, an electron freed with just under the radiation threshold (1 keV) at infinity: the ion's pull put its launch
   energy over it, and radiation flight, which carries no potential energy, kept the pull (water, 40 atoms each at 950,
   980 and 999 eV: 92–101 eV made before; found by the 1.27 photon-polarization session too, 100–200 eV). */
PARTS.nearThreshold = async (page, check, say) => {
  const r = {};
  for (const KE of [950, 980, 999]) {
    const X = load('all', { seed: 3 }), W = X.W; X.PRESETS.water.build(); W.T = 0; W.gamma = 0; W.decayOn = false; X.forcesNoEvents(); W.fSpawn = W.spawned;
    const B = () => books(X) + W.ledger.bath;
    let worst = 0, rad = 0;
    for (const p of W.parts.filter(q => q.el && q.ne > 0).slice(0, 40)) { const ie = X.ionizationCost(p), E0 = B(), e = X.ejectElectron(p, KE); if (!e) continue; if (e.rad) rad++; worst = Math.max(worst, Math.abs(B() - E0 - KE - ie)); }
    r[KE] = { rad, worst: +worst.toFixed(4) };
  }
  check(Object.values(r).every(q => q.worst < 1e-3) && Object.values(r).reduce((a, q) => a + q.rad, 0) > 20, `1.26 bug fixes: an electron freed just under 1 keV into radiation flight takes its energy at infinity (water: ${Object.entries(r).map(([k, q]) => k + ' eV, ' + q.rad + ' in flight, worst ' + q.worst + ' eV').join('; ')}; before 92–101 eV)`, 'bug126e nearThreshold: ' + JSON.stringify(r));
};

/* Flat game, a lattice of O and Pb, half its atoms ionized up to three times, insulated, 200 steps: a free electron that
   was in flight at the last force pass and was stepped again was missing from the list of net charges summed beyond the
   cutoff, so each later mode switch and ionization measured its energy 1–2 eV wrong (13–15 eV over the 200 steps,
   6.9 eV in one step before; now a few tenths, the ionized-plasma limit). */
PARTS.plasma = async (page, check, say) => {
  const r = [];
  for (const seed of [3, 7]) {
    const X = load('all', { seed }), W = X.W;
    X.PRESETS.empty.build(); W.T = 0; W.gamma = 0; W.wall = 'reflect'; W.decayOn = false;
    for (let x = -12; x <= 12; x += 3.45) for (let y = -9; y <= 9; y += 3.45) { const p = X.addAtom(x > 0 ? 'Pb' : 'O', x, y); p.vx = p.vy = 0; }
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    for (const p of W.parts.slice()) if (p.el && X.rnd() < 0.5) for (let k = 0; k < 3; k++) X.ejectElectron(p, 2 + 20 * X.rnd());
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    let b = books(X), worst = 0; const b0 = b;
    for (let s = 0; s < 200; s++) { go(X, 1); const c = books(X); worst = Math.max(worst, Math.abs(c - b)); b = c; }
    r.push({ seed, drift: +(b - b0).toFixed(3), worstStep: +worst.toFixed(3) });
  }
  check(r.every(q => Math.abs(q.drift) < 2 && q.worstStep < 1), `1.26 bug fixes: an ionized O/Pb lattice keeps its books over 200 steps (flat, insulated: ${r.map(q => q.drift + ' eV, worst step ' + q.worstStep).join('; ')}; before 13–15 eV, 5–7 eV steps)`, 'bug126e plasma: ' + JSON.stringify(r));
};

/* Flat game, an atom in radiation flight stopped in a closed wall while it was still in the neighbour grid: it was
   listed with the newcomers as well, so localPE and phiE counted it twice until the next force pass (a Pb⁺'s pull 1.5 Å
   away: 12.0 V for 6.0). */
PARTS.wallTwice = async (page, check, say) => {
  const X = load('all', { seed: 2 }), W = X.W;
  X.PRESETS.empty.build(); W.T = 0; W.gamma = 0; W.wall = 'reflect'; W.decayOn = false;
  const hw = W.box.w / 2, A = X.addAtom('Pb', hw - 3, 0, { charge: 1 }), B = X.addAtom('Pb', hw - 6, 0); A.vx = A.vy = B.vx = B.vy = 0;
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  X.setVel(A, 30, 0); // into radiation flight, toward the wall
  let k = 0; while (A.rad && k++ < 50) X.moveRad(A, 0.02);
  const x = A.x - 1.5, y = A.y, phi = X.phiE(x, y, null); A.dead = true; const phi0 = X.phiE(x, y, null); A.dead = false;
  const r2 = (A.x - x) ** 2 + (A.y - y) ** 2, one = X.PHYS.KE * A.q * (1 / Math.sqrt(r2 + A.sEN) - X.csh(A, { k: X.ELEC }, A.sEN));
  const r = { stopped: !A.rad && !A.dead, pull: +(phi - phi0).toFixed(4), once: +one.toFixed(4) };
  check(r.stopped && Math.abs(r.pull - r.once) < 1e-6, `1.26 bug fixes: an atom stopped in the wall is counted once by the events' energy sums until the next force pass (its pull ${r.pull} V, once ${r.once} V)`, 'bug126e wallTwice: ' + JSON.stringify(r));
};

/* ejectElectron at the particle cap put the electron's energy in the bath and returned no electron; its callers then
   released the same energy as heat too (photoionization: the 50 eV counted twice). */
PARTS.cap = async (page, check, say) => {
  const X = load('all', { seed: 2 }), W = X.W;
  X.PRESETS.empty.build(); W.T = 0; W.gamma = 0; W.decayOn = false;
  const A = X.addAtom('O', 0, 0), C = X.addAtom('Ar', 3, 0); A.vx = A.vy = C.vx = C.vy = 0;
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  const old = X.MAX_PARTS; X.setMaxParts(W.parts.length); // at the particle cap
  const B = () => books(X) + W.ledger.bath, r = {};
  try {
    { const E0 = B(), e = X.ejectElectron(A, 50); r.eject = { freed: !!e, books: +(B() - E0).toFixed(4) }; }
    { const ie = X.ionizationCost(A), E0 = B(); X.photoIonize(A, 50, ie); r.photo = +(B() - E0 - 50 - ie).toFixed(4); }
  } finally { X.setMaxParts(old); }
  check(!r.eject.freed && r.eject.books === 0 && Math.abs(r.photo) < 1e-6, `1.26 bug fixes: at the particle cap an electron not set free leaves its energy with the caller, counted once (photoionization's 50 eV: ${r.photo} eV over)`, 'bug126e cap: ' + JSON.stringify(r));
};

/* Flat game, a fast particle passing an atom that is itself in radiation flight (knocked into flight since the last force
   pass): the ionizing push went into its velocity, which its next flight step overwrites from its stored energy, and the
   dE the passing particle lost left the books (20 keV electrons 0.8–0.95 Å from a flying Pb: −0.86 and −1.04 eV). Now its
   stored energy takes it. */
PARTS.radPush = async (page, check, say) => {
  const r = [];
  for (const [k, y] of [0.8, 0.9, 0.95].entries()) {
    const X = load('all', { seed: 7 + k }), W = X.W;
    X.PRESETS.empty.build(); W.T = 0; W.gamma = 0; W.wall = 'reflect'; W.decayOn = false;
    const A = X.addAtom('Pb', 0, 0); A.vx = A.vy = 0;
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    const e = X.addLepton(X.ELEC, -3, y, 0, 0, 0, 0); X.setMotion(e, 2e4, 1, 0, 0, 0, 0, 0);
    X.setVel(A, 0, 12); // knocked into radiation flight since the last force pass (still in the grid)
    const B = () => books(X) + W.ledger.bath, E0 = B(), ke0 = e.KE;
    X.moveRad(e, 6 / e.sp);
    r.push({ y, rad: A.rad, gave: +(ke0 - e.KE).toFixed(4), books: +(B() - E0).toFixed(5) });
  }
  check(r.every(q => q.rad) && r.some(q => q.gave > 0.3) && r.every(q => Math.abs(q.books) < 1e-3), `1.26 bug fixes: an atom in radiation flight pushed by a passing fast electron takes the energy it loses (${r.map(q => q.gave + ' eV, books ' + q.books).join('; ')})`, 'bug126e radPush: ' + JSON.stringify(r));
};

/* Decay data: ¹⁹⁸Au (not in the table) was given 14% electron capture by the estimate for unlisted nuclides; it is β⁻
   only (Q 1.372 MeV, 2.694 d). ²²Na decayed by β⁺ only; it is 90.3% β⁺ and 9.7% electron capture (2.6018 y). */
PARTS.decay = async (page, check, say) => {
  const X = load('all', { seed: 1 });
  const au = X.nuclideInfo(79, 119), na = X.nuclideInfo(11, 11);
  const m = (inf) => Object.fromEntries(inf.modes.map(q => [q.mode, +q.br.toFixed(3)]));
  const r = { Au198: { t12d: +(au.t12 / 86400).toFixed(3), modes: m(au), est: au.estimated }, Na22: { t12y: +(na.t12 / X.PHYS.YEAR).toFixed(4), modes: m(na) } };
  check(!au.estimated && au.modes.length === 1 && au.modes[0].mode === 'b-' && Math.abs(au.modes[0].Q - 1.3724) < 1e-4 && Math.abs(r.Au198.t12d - 2.694) < 0.01
    && r.Na22.modes['b+'] === 0.903 && r.Na22.modes.ec === 0.097 && Math.abs(r.Na22.t12y - 2.6018) < 1e-4,
    `1.26 bug fixes: ¹⁹⁸Au decays by β⁻ only (${r.Au198.t12d} d), ²²Na by β⁺ ${r.Na22.modes['b+']} and electron capture ${r.Na22.modes.ec}`, 'bug126e decay: ' + JSON.stringify(r));
};

/* The speed shown (the owner, 2026-11-06: "a hydrogen atom travelling 328% of c" after a 1 PeV α in 3-D). A fast
   particle in 3-D keeps its energy as ½mv² and is moved at the relativistic speed of it, so the stored v passes c;
   Inspect showed that v. Now shownSpeed: from the energy, relativistically. A 5 GeV proton and a 50 MeV electron made
   fast in 3-D, a thermal atom, and a flat radiation-flight proton: each under c and at the speed of its energy. */
PARTS.speed = async (page, check, say) => {
  const X = load('all', { seed: 2 }), W = X.W; X.PRESETS.d3empty.build();
  const C = X.PHYS.C, rel = (KE, m) => { const g = 1 + KE / (m * X.AMU_EV); return C * Math.sqrt(1 - 1 / (g * g)); };
  const p = X.addNuc(1, 0, 0, 0, 0, 0, 0, false, 0); X.setMotion(p, 5e9, 1, 0, 0, 0, 0);
  const e = X.addLepton(X.ELEC, 2, 2, 0, 0, 0, 0); X.setMotion(e, 5e7, 0, 1, 0, 0, 0);
  const h = X.addAtom('H', -5, 3, { z: 1 }); h.vx = 0.01; h.vy = -0.02; h.vz = 0.005;
  const stored = Math.hypot(p.vx, p.vy, p.vz) / C, sp = X.shownSpeed(p) / C, se = X.shownSpeed(e) / C, want = rel(5e9, p.m) / C;
  const sh = X.shownSpeed(h), nh = Math.hypot(h.vx, h.vy, h.vz);
  const ok = p.fast && !p.rad && stored > 1 && Math.abs(sp - want) < 1e-12 && sp < 1 && se < 1 && se > 0.99 && Math.abs(sh / nh - 1) < 1e-6; /* (c² and the u-to-eV constant agree to 4×10⁻⁸ in these units) */
  check(ok, `1.26 bug fix (the speed shown): a 5 GeV proton in 3-D shows ${(sp * 100).toFixed(2)}% of c (its stored ½mv² speed ${(stored * 100).toFixed(0)}%), a 50 MeV electron ${(se * 100).toFixed(4)}%, a thermal hydrogen its own speed`, 'bug126e speed: ' + JSON.stringify({ fast: p.fast, rad: p.rad, stored, sp, want, se, sh, nh }));
};

module.exports = async function fbug126e(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (bug126e ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `bug126e ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.26 bug fixes (energy books with fast electrons, decay data) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
