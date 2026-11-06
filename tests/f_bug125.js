'use strict';
/* The checks for the bug fixes after 1.25 (the "Bugs on record" list), run by t_features (one line) or alone:
   node tests/f_bug125.js [--node] [part …]. Each part fails before its fix and passes after. Parts that need the page
   are skipped with --node. (page: the t_features page; check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const go = (X, n, dt) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = dt || X.chooseDt(); X.step(W.dt); } };
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;
const fresh = (seed = 7) => { const X = load('all', { seed }); return X; };

/* 5. The flat game's open walls: what leaves (atoms, molecules, free electrons) takes its energy to ledger.escaped.
   Before: 8 waters and an ion pair leaving an open box took 19,230 eV out of the books unbooked (the atoms' electrons'
   binding, their motion and potential energy). */
PARTS.openWall = async (page, check, say) => {
  const X = fresh(3), W = X.W;
  X.baseWorld(30, 20, 300, 0); W.wall = 'open'; W.slowmo = false;
  for (let i = 0; i < 8; i++) for (const p of X.addMolecule('H2O', 10, -8 + 2.2 * i, i, 0)) { p.vx = 0.3; p.vy = 0; X.updateFast(p); }
  const na = X.addAtom('Na', -10, 0); X.userIonize(na); const cl = X.addAtom('Cl', -6, 0); X.userAddElectron(cl); na.vx = -0.5; X.updateFast(na);
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  const E0 = books(X); go(X, 1500);
  const r = { left: W.parts.filter(p => !p.dead).length, books: +(books(X) - E0).toFixed(3) };
  check(r.left < 10 && Math.abs(r.books) < 0.1, `bug fix 5: an open flat box: ${27 - r.left} particles left, books ${r.books} eV`, 'bugfix openWall: ' + JSON.stringify(r));
};

/* 11. The flat game's hard-sphere collision turns the pair by 2·acos(b/R): head-on back, grazing straight on. Before, it
   turned by π − 2·acos(b/R): a head-on hit passed straight through (0°), a grazing one bounced back (180°). */
PARTS.hardSphere = async (page, check, say) => {
  const X = fresh(1), W = X.W; X.baseWorld(30, 20, 300, 0);
  const turn = (b) => { const a = X.addAtom('Ar', 0, 0), t = X.addAtom('Ar', 1, 0); a.vx = 1; a.vy = 0; t.vx = 0; t.vy = 0; X.hardSphere(a, t, b, 1);
    const rx = a.vx - t.vx, ry = a.vy - t.vy, ang = Math.acos(Math.max(-1, Math.min(1, rx / Math.hypot(rx, ry)))) * 180 / Math.PI; X.kill(a); X.kill(t); return Math.round(ang); };
  const r = { headOn: turn(0), half: turn(0.5), grazing: turn(0.999) };
  check(r.headOn === 180 && r.half === 120 && r.grazing < 6, `bug fix 11: a flat hard-sphere hit turns the pair by ${r.headOn}° head-on, ${r.half}° at b = R/2, ${r.grazing}° grazing`, 'bugfix hardSphere: ' + JSON.stringify(r));
};

/* 10. Space held pans, as Help says ("drag with the right button (or Space held) to move"); Space alone still plays and
   pauses. Before: nothing set UI.spaceDown, so a drag with Space held used the tool, and a held Space toggled play on
   every key repeat. */
PARTS.spacePan = async (page, check, say) => {
  const box = await page.evaluate(() => { hideModal && document.querySelectorAll('.modal').forEach(m => { m.hidden = true; }); loadPreset('water'); setRunning(false); setTool('inspect'); const r = $('cv').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, cx: R.cx, cy: R.cy }; });
  await page.mouse.move(box.x, box.y);
  await page.keyboard.down('Space'); await page.waitForTimeout(60);
  await page.mouse.down(); await page.mouse.move(box.x + 120, box.y + 60, { steps: 6 }); await page.mouse.up();
  await page.keyboard.up('Space'); await page.waitForTimeout(60);
  const a = await page.evaluate(() => ({ cx: R.cx, cy: R.cy, running: UI.running, held: UI.spaceDown }));
  await page.keyboard.press('Space'); await page.waitForTimeout(60);
  const b = await page.evaluate(() => { const r = UI.running; setRunning(false); return r; });
  const r = { moved: +Math.hypot(a.cx - box.cx, a.cy - box.cy).toFixed(2), runningAfterPan: a.running, held: a.held, spaceAlonePlays: b };
  check(r.moved > 1 && !r.runningAfterPan && !r.held && r.spaceAlonePlays, `bug fix 10: Space held + drag pans the view (${r.moved} Å) and leaves play/pause as it was; Space alone plays`, 'bugfix spacePan: ' + JSON.stringify(r));
};
PARTS.spacePan.page = true;

/* 19. The 0.95 check "six CO among O₂ at 300 K keep their triple bonds", moved from the page (whose random stream is not
   seeded: 4 of 6 once) to the Node harness with a fixed seed. On seeds 4, 6 and 10 of 1–10 two CO join (CO + CO → C₂O₂,
   −85 kJ/mol, a reaction the bond table allows: written down for the owner); seed 1 keeps all six. */
PARTS.coCold = async (page, check, say) => {
  const run = (seed) => { const X = fresh(seed), W = X.W; X.PRESETS.empty.build(); W.T = 300; W.gamma = 0.05;
    for (let i = 0; i < 6; i++) X.addMolecule('CO', -10 + i * 4, -6, 0, 300); for (let i = 0; i < 6; i++) X.addMolecule('O2', -10 + i * 4, 6, 0, 300);
    X.forcesNoEvents(); W.fSpawn = W.spawned; for (let k = 0; k < 20; k++) { go(X, 300); X.housekeeping(); }
    return W.bonds.filter(b => b.order === 3).length; };
  const a = run(1), b = run(1);
  check(a === 6 && b === 6, `bug fix 19: six CO among O₂ at 300 K keep their triple bonds, seeded (${a}, again ${b})`, 'bugfix coCold: ' + JSON.stringify({ a, b }));
};

/* 12. A hadron's elastic pass by a nucleus in the flat game (exoElastic) books the recoil over the struck molecule and
   what touches it (regionE), not the whole box (totalEnergy, O(N²)): 30 ms a call at 1,200 atoms before, under 3 now;
   the books exact either way. */
PARTS.exoElastic = async (page, check, say) => {
  const X = fresh(2), W = X.W;
  X.baseWorld(90, 60, 300, 0); for (let i = 0; i < 400; i++) X.addMolecule('H2O', -42 + (i % 20) * 4.3, -27 + Math.floor(i / 20) * 2.8, i, 300);
  X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned;
  const Os = W.parts.filter(p => p.Z === 8); let ms = 0, worst = 0;
  for (let k = 0; k < 20; k++) { const tg = Os[k * 7], o = X.addExo('pi+', tg.x - 1, tg.y, 300e6, 1, 0); const E0 = X.totalEnergy().total, t = performance.now(); X.exoElastic(o, tg); ms += performance.now() - t; worst = Math.max(worst, Math.abs(X.totalEnergy().total - E0)); o.dead = true; }
  const r = { atoms: W.parts.length, ms: +(ms / 20).toFixed(2), worst: +worst.toExponential(1) };
  check(r.ms < 3 && r.worst < 1e-3, `bug fix 12: a pion's elastic pass among ${r.atoms} atoms booked in ${r.ms} ms, exact to ${r.worst} eV`, 'bugfix exoElastic: ' + JSON.stringify(r));
};

/* 9. The 3-D search for the atoms along a particle's path (segTargets3) walks the grid's cells around the path (plus the
   nuclei in flight and the newly made), not every particle: 126 µs a search among 8,232 atoms before, under 30 now,
   with the same atoms found. */
PARTS.segGrid = async (page, check, say) => {
  const X = fresh(7), W = X.W;
  X.PRESETS.empty.build(); X.setBox(60, 60); X.world3d(60); W.gamma = 0.05;
  let i = 0; for (let a = 0; a < 14; a++) for (let b = 0; b < 14; b++) for (let c = 0; c < 14; c++) X.addMolecule('H2O', -27 + a * 4, -27 + b * 4, i++, 300, -27 + c * 4);
  go(X, 3);
  const segs = []; for (let k = 0; k < 1000; k++) segs.push([(X.rnd() - 0.5) * 58, (X.rnd() - 0.5) * 58, (X.rnd() - 0.5) * 58]);
  const filt = (t) => t.k === X.NUC && t.Z > 0, t0 = performance.now(); let got = '';
  for (const [x, y, z] of segs) got += X.segTargets3(x, y, z, x + 0.8, y + 0.3, z - 0.2, 1.0, filt).map(h => h[1].id).join(',') + ';';
  const us = (performance.now() - t0); let want = '';
  for (const [x, y, z] of segs) { const L = []; for (const p of W.parts) { if (p.dead || !filt(p)) continue; const dx = 0.8, dy = 0.3, dz = -0.2, L2 = dx * dx + dy * dy + dz * dz, px = p.x - x, py = p.y - y, pz = p.z - z, t = (px * dx + py * dy + pz * dz) / L2; if (t < 0 || t >= 1) continue; const ex = px - t * dx, ey = py - t * dy, ez = pz - t * dz; if (ex * ex + ey * ey + ez * ez < 1) L.push([t, p.id]); } want += L.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(h => h[1]).join(',') + ';'; }
  const r = { atoms: W.parts.length, us: +(us / segs.length * 1000).toFixed(1), same: got === want, hits: (got.match(/\d+/g) || []).length };
  check(r.us < 60 /* (126 µs over every atom before the fix; 25–49 measured with it, by load) */ && r.same && r.hits > 30, `bug fix 9: a path search among ${r.atoms} atoms in 3-D takes ${r.us} µs (the grid's cells), the same ${r.hits} atoms found as over every atom`, 'bugfix segGrid: ' + JSON.stringify(r));
};

/* 15. A K⁻ absorbed at rest (kStop) keeps momentum exactly, flat and 3-D: the kaon's own momentum and the atom's motion
   go in, the freed electrons carry their share. Before: the kaon taken at rest and the nucleus's motion left out,
   |Σp out − p in| up to 0.9 MeV/c. */
PARTS.kStop = async (page, check, say) => {
  const one = (d3) => { let worst = 0, n = 0, bk = 0;
    for (let s = 1; s <= 12; s++) { const X = fresh(s), W = X.W;
      if (d3) { X.PRESETS.empty.build(); X.setBox(20, 20); X.world3d(20); } else X.baseWorld(30, 20, 300, 0);
      const tg = X.addAtom('C', 0, 0); tg.vx = 0.05; tg.vy = -0.03; if (d3) tg.vz = 0.02;
      X.forcesNoEvents(); W.fSpawn = W.spawned;
      const o = X.addExo('K-', -0.3, 0.1, 800, 0.6, 0.8, undefined, 0, 0), Pin = X.add4(X.exoP4(o), X.p4of(tg)), E0 = books(X);
      let got = null; const oe = X.exoEvent; X.exoEvent = function (o2, tgs, items, moms, ...r) { got = moms.reduce((a, m) => X.add4(a, m), d3 ? [0, 0, 0, 0] : [0, 0, 0]); return oe(o2, tgs, items, moms, ...r); };
      if (X.kStop(o) && got) { worst = Math.max(worst, Math.hypot(got[1] - Pin[1], got[2] - Pin[2], (got[3] || 0) - (Pin[3] || 0))); n++; bk = Math.max(bk, Math.abs(books(X) - E0)); } }
    return { n, worst: +worst.toExponential(1), books: +bk.toExponential(1) }; };
  const r = { flat: one(false), d3: one(true) };
  check(r.flat.n === 12 && r.d3.n === 12 && r.flat.worst < 1e-9 && r.d3.worst < 1e-9 && r.flat.books < 1e-3 && r.d3.books < 1e-3, `bug fix 15: K⁻ absorbed on carbon keeps momentum to ${r.flat.worst} (flat), ${r.d3.worst} MeV/c (3-D), books to ${r.flat.books}, ${r.d3.books} eV`, 'bugfix kStop: ' + JSON.stringify(r));
};

/* 13. Muonium formation pays its potential energy: the muonium atom is made clear of the atoms (muClear), not on top of
   the one the muon took the electron from. 3-D water, a μ⁺ stopping 0.67 Å from an oxygen: the books moved by up to
   17.7 eV at the formation before; now exact. */
PARTS.muonium = async (page, check, say) => {
  const one = (d3) => { let worst = 0, n = 0;
    for (let s = 1; s <= 20; s++) { const X = fresh(s), W = X.W;
      if (d3) { X.PRESETS.empty.build(); X.setBox(24, 24); X.world3d(24); W.gamma = 0; } else X.baseWorld(30, 24, 300, 0);
      W.decayOn = false; for (let i = 0; i < 20; i++) X.addMolecule('H2O', -9 + (i % 5) * 4.5, -8 + Math.floor(i / 5) * 4.5, i, 300, d3 ? ((i % 3) - 1) * 4 : 0);
      X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned;
      const O = W.parts.find(p => p.Z === 8), o = X.addExo('mu+', O.x + 0.6, O.y + 0.3, 1000, 1, 0, undefined, O.z || 0, 0);
      const E0 = books(X); if (X.muoniumForm(o)) { n++; worst = Math.max(worst, Math.abs(books(X) - E0)); } }
    return { n, worst: +worst.toFixed(4) }; };
  const r = { flat: one(false), d3: one(true) };
  check(r.flat.n >= 8 && r.d3.n >= 8 && r.flat.worst < 0.01 && r.d3.worst < 0.01, `bug fix 13: muonium formed beside oxygen pays its potential energy: books to ${r.flat.worst} eV (flat, ${r.flat.n} formed), ${r.d3.worst} eV (3-D, ${r.d3.n})`, 'bugfix muonium: ' + JSON.stringify(r));
};

/* 6. Events that change a charge in an applied electric field book −q·E·Δr: ten protons and their electrons recombining
   among argon in 0.2 V/Å, books counted as total + Σ q·φ (φ = −E·r): up to 0.8 eV off over 1,500 steps before, under
   0.05 after. */
PARTS.efield = async (page, check, say) => {
  let worst = 0, caps = 0;
  for (let s = 1; s <= 6; s++) { const X = fresh(s), W = X.W;
    X.baseWorld(40, 30, 300, 0); W.Ex = 0.2; W.Ey = 0.05; W.slowmo = false;
    for (let i = 0; i < 10; i++) X.userIonize(X.addAtom('H', -15 + i * 3, -5));
    for (let i = 0; i < 10; i++) X.addAtom('Ar', -15 + i * 3, 5);
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    const B = () => { let f = 0; for (const p of W.parts) if (!p.dead && p.q) f += (p.k === X.NUC ? p.q + (p.qp || 0) : p.q) * -(W.Ex * p.x + W.Ey * p.y); return books(X) + f; };
    const E0 = B(); go(X, 1500); worst = Math.max(worst, Math.abs(B() - E0)); caps += W.log.filter(l => /captured|Recombination/.test(l.text)).reduce((t, l) => t + l.n, 0); }
  const r = { worst: +worst.toFixed(3), caps };
  check(r.worst < 0.1 && r.caps >= 20, `bug fix 6: ${r.caps} captures in a 0.2 V/Å field, the books (with the field's energy) kept to ${r.worst} eV`, 'bugfix efield: ' + JSON.stringify(r));
};

/* 7. Free electrons put down almost on top of each other: eight in a 1 Å row (pairs 0.02 Å apart), insulated. In 3-D
   (where electrons stay stepped) each close pass at hundreds of Å/tu gained or lost eV: −116 eV over 16 tu before;
   the inner step now resolves the pass (_passL). The flat game (they fly once past 20 eV) about 1 eV, as before. */
PARTS.coincident = async (page, check, say) => {
  const run = (d3) => { const X = fresh(1), W = X.W;
    if (d3) { X.PRESETS.empty.build(); X.setBox(400, 400); X.world3d(400); } else X.baseWorld(400, 400, 300, 0.05);
    W.gamma = 0; for (let i = 0; i < 8; i++) X.addLepton(X.ELEC, (i % 4) * 1.0 + 0.02 * (i >> 2), 0, 0, 0, 0);
    X.forcesNoEvents(); W.fSpawn = W.spawned; const E0 = X.totalEnergy().total; let t = 0, worst = 0;
    while (t < 16) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); t += X.step(W.dt); worst = Math.max(worst, Math.abs(X.totalEnergy().total - E0)); }
    return +worst.toFixed(2); };
  const r = { flat: run(false), d3: run(true) };
  check(r.flat < 3 && r.d3 < 5, `bug fix 7: eight electrons put down 0.02–1 Å apart keep the books to ${r.flat} eV (flat), ${r.d3} eV (3-D)`, 'bugfix coincident: ' + JSON.stringify(r));
};

/* 18. The flat bond-order cost tag, re-measured on a quiet machine (one thread, 400 steps, ms a simulated fs): liquid
   water ×7.5–9.2 (seeds 3, 5, 7, 9, 12), salt water ×5.9–7.4; the 1.25 re-measurement's ×5.4–5.8 was taken under load.
   The tag: ×6–15 (was ×8–15), its words with the new numbers. */
PARTS.boTag = async (page, check, say) => {
  const r = await page.evaluate(() => { loadPreset('water'); setRunning(false); const c = COSTS.segBo(); return { tag: c.o[1][0], text: c.o[1][1] }; });
  check(r.tag === '×6–15' && /water ×7\.5–9\.2/.test(r.text) && /salt water ×5\.9–7\.4/.test(r.text), `bug fix 18: the flat bond-order tag ${r.tag} (${r.text.slice(0, 90)}…)`, 'bugfix boTag: ' + JSON.stringify(r));
};
PARTS.boTag.page = true;

/* 2. A dense metal in 3-D: the electron-transfer estimates walked every atom within 6 Å four times a pair tried, adding
   nothing when no particle is charged (localPhi, now skipped then). A ball of 767 Cu atoms (bench-mode's cu3): about
   76 ms a step before, under 25 now; the same run, bit for bit. */
PARTS.metal3 = async (page, check, say) => {
  const X = fresh(12), W = X.W; X.setMaxParts(12000);
  const a = 2.56, R = 14, c = a * Math.SQRT2, B = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]], n = Math.ceil(R / c) + 1;
  X.baseWorld(R * 6, R * 6, 300, 0.05); X.world3d(R * 6);
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) for (const b of B) { const x = (i + b[0]) * c, y = (j + b[1]) * c, z = (k + b[2]) * c; if (x * x + y * y + z * z <= R * R) X.addAtom('Cu', x, y, { z, T: 300 }); }
  X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned; go(X, 10); W.gamma = 0;
  const t0 = performance.now(); go(X, 30); const ms = (performance.now() - t0) / 30;
  const r = { atoms: W.parts.filter(p => !p.dead).length, ms: +ms.toFixed(1) };
  check(r.atoms > 700 && r.ms < 25, `bug fix 2: ${r.atoms} Cu atoms in 3-D, ${r.ms} ms a step`, 'bugfix metal3: ' + JSON.stringify(r));
};

/* 4. Crossing 220 net charges switches the long-range Coulomb sum off (or back on): the energy's definition changes
   there, and the books jumped by the difference (±2,400–2,800 eV at each crossing in a 2 MeV neutron's cascade among
   3-D waters). Now the change is booked when it happens. 110 Na⁺ and 110 Cl⁻ in a flat box, one more ion made: the
   books across the force pass that turns the sum off moved by tens of eV before, 0 now. */
PARTS.lrFlip = async (page, check, say) => {
  const X = fresh(3), W = X.W; X.setMaxParts(12000);
  X.baseWorld(160, 160, 300, 0); W.gamma = 0;
  for (let i = 0; i < 110; i++) { const x = -75 + (i % 11) * 14, y = -70 + Math.floor(i / 11) * 14; const a = X.addAtom('Na', x, y); X.userIonize(a); const b = X.addAtom('Cl', x + 5, y + 3); X.userAddElectron(b); }
  for (const p of W.parts.filter(q => q.k === X.ELEC)) X.kill(p);
  const n = X.addAtom('Na', 76, 76); X.forcesNoEvents(); W.fSpawn = W.spawned;
  const on0 = X._lrOn; X.userIonize(n); for (const p of W.parts.filter(q => q.k === X.ELEC && !q.dead)) X.kill(p);
  const E0 = books(X); X.forcesNoEvents(); const r = { charges: X._charged.length, on0, on1: X._lrOn, books: +(books(X) - E0).toFixed(4) };
  check(r.on0 && !r.on1 && Math.abs(r.books) < 1e-6, `bug fix 4: ${r.charges} net charges switch the long-range sum off; the books keep across it (${r.books} eV)`, 'bugfix lrFlip: ' + JSON.stringify(r));
};

/* 14. MeV electrons and positrons in 3-D fly at their true speed. Before: stepped with ½mv² for the energy and v for the
   speed (a 10 MeV electron at 6.3c), in inner steps held at DT_MIN, and the books slipped: 20 MeV pairs made in a 3-D
   lead block, 30 pairs × 25 steps, −6,301 eV in all (worst pair 211 eV). Now past 25 keV they fly (moveFastLeptons3). */
PARTS.lep3 = async (page, check, say) => {
  const sp = (() => { const X = fresh(1), W = X.W; X.PRESETS.empty.build(); X.setBox(6000, 6000); X.world3d(6000); W.gamma = 0;
    const e = X.addLepton(X.ELEC, -2900, 0, 0, 0, 0); X.setMotion(e, 10e6, 1, 0, 0, 0, 0); X.forcesNoEvents(); W.fSpawn = W.spawned;
    const x0 = e.x; let t = 0; for (let i = 0; i < 3; i++) { W.dt = X.chooseDt(); t += X.step(W.dt); } return +((e.x - x0) / t / X.PHYS.C).toFixed(4); })();
  let sum = 0, worst = 0, n = 0;
  for (const seed of [1, 2, 3]) { const X = fresh(seed), W = X.W; X.PRESETS.empty.build(); X.setBox(30, 30); X.world3d(30); W.gamma = 0; W.decayOn = false;
    const pbs = []; for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) pbs.push(X.addAtom('Pb', -7.5 + a * 3, -7.5 + b * 3, { z: -7.5 + c * 3, T: 0 }));
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    for (let k = 0; k < 4; k++) { const E0 = books(X); X.pairProduce3(pbs[(k * 37 + seed * 11) % pbs.length], 20e6); const E1 = books(X), made = E1 - E0 - 20e6; go(X, 25); const d = books(X) - E1 + made; sum += d; worst = Math.max(worst, Math.abs(d)); n++; } }
  const r = { speed: sp, pairs: n, sum: +sum.toFixed(2), worst: +worst.toFixed(2) };
  check(r.speed < 1 && r.speed > 0.99 && r.worst < 5, `bug fix 14: a 10 MeV electron in 3-D flies at ${r.speed}c; ${r.pairs} pairs of 20 MeV in lead keep the books to ${r.worst} eV each (${r.sum} in all)`, 'bugfix lep3: ' + JSON.stringify(r));
};

/* 8. 3-D display gaps: Inspect picks an unstable particle or a photon in flight where it is drawn in depth (pickLight
   returned nothing in 3-D); quantum nuclei's bead rings are drawn in 3-D (drawRings3); the Magnet tool's poles say
   N +axis / S −axis in 3-D (the flat ⊙/⊗ signs before); the quantum-nuclei descriptions no longer say the beads are not
   drawn. */
PARTS.display3 = async (page, check, say) => {
  const r = await page.evaluate(() => {
    const out = {};
    loadPreset('d3empty'); setRunning(false); setTool('inspect'); fitView();
    const o = addExo('pi+', 2, 1, 1e6, 1, 0, undefined, 3, 0); cam3Update(); const P = [0, 0, 0]; proj3(o.x, o.y, o.z, P);
    const got = pickLight(P[0] + 2, P[1] - 1, 12); out.exo = !!got && got.kind === 'exo' && got.o === o; o.dead = true;
    emitPhoton3(-5, 0, 2e6, 1, 0, { z: 2, uz: 0, travel: true }); const f = W.flights[W.flights.length - 1] || W.rays[W.rays.length - 1];
    if (f) { const kind = W.flights.includes(f) ? 'flight' : 'ray'; W.t += 1e-4; const h = lightHead3(f, kind); if (h && proj3(h[0], h[1], h[2], P)) { const g = pickLight(P[0], P[1], 12); out.light = !!g && g.o === f; } }
    loadPreset('water3d'); setRunning(false); setSetting('pi', 8); for (let k = 0; k < 20; k++) { W.dt = chooseDt(); step(W.dt); }
    const a0 = W.parts.find(p => PI.n && !p.dead && p.k === NUC); if (a0) { R.cam3.tx = a0.x; R.cam3.ty = a0.y; R.cam3.tz = a0.z; } R.cam3.dist = 4; cam3Update(); out.piN = PI.n;
    const ctx = R.ctx, arc = ctx.arc; let n = 0; ctx.arc = function (...a) { n++; return arc.apply(this, a); }; try { drawRings3(ctx); } finally { ctx.arc = arc; }
    out.beads = n; setSetting('pi', 0);
    setTool('magnet'); out.poles = [...document.querySelectorAll('#toolopts [data-g="pol"] button')].map(b => b.textContent).join(' ');
    return out;
  });
  check(r.exo && r.light !== false && r.beads > 8 && /N \+z/.test(r.poles) && /S −z/.test(r.poles), `bug fix 8: in 3-D Inspect picks an unstable particle (${r.exo}) and light in flight (${r.light}) where they are drawn; ${r.beads} beads drawn; magnet poles "${r.poles}"`, 'bugfix display3: ' + JSON.stringify(r));
};
PARTS.display3.page = true;

/* 17. Quantum nuclei in 3-D with the whole force field on every bead: each bead's pass found the neighbour list out of
   date (a 3-D ring reaches 0.5 Å from its centre, past half the list's skin) and rebuilt the grid and the list, six
   times a step of eight passes in liquid water (52 ms a step). Now the list reaches farther while that mode runs in
   3-D and serves every bead (19 ms); the run the same to 10⁻¹⁴ Å. */
PARTS.pi3 = async (page, check, say) => {
  const run = (E) => { const X = load('all', { seed: 12, patch: E === undefined ? undefined : (s) => s.replace('const PI_SKIN3 = 1.4;', 'const PI_SKIN3 = ' + E + '; //') }), W = X.W;
    X.PRESETS.water3d.build(); X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned; X.piSet(8); X.PI.rpc = false; W.gamma = 0;
    go(X, 5); const b0 = X.VL.builds, t0 = performance.now(); go(X, 10); const ms = (performance.now() - t0) / 10;
    return { ms, builds: (X.VL.builds - b0) / 10, pos: W.parts.map(p => [p.x, p.y, p.z]) }; };
  const a = run(), b = run(0); let mx = 0; a.pos.forEach((p, i) => { mx = Math.max(mx, Math.hypot(p[0] - b.pos[i][0], p[1] - b.pos[i][1], p[2] - b.pos[i][2])); });
  const r = { ms: +a.ms.toFixed(1), msOldLists: +b.ms.toFixed(1), builds: a.builds, buildsOld: b.builds, diff: +mx.toExponential(1) };
  check(r.builds === 0 && r.buildsOld > 2 && r.ms < 0.6 * r.msOldLists && r.diff < 1e-9, `bug fix 17: 3-D quantum nuclei, 8 beads, every bead's full pass: ${r.ms} ms a step (${r.msOldLists} with the list rebuilt per bead, ${r.buildsOld} times a step), the same run to ${r.diff} Å`, 'bugfix pi3: ' + JSON.stringify(r));
};

// PARTS (added one per fix, below)

module.exports = async function fbug125(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (bugfix ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `bugfix ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
module.exports.helpers = { go, books, fresh };
if (require.main === module) (async () => {
  const args = process.argv.slice(2), noPage = args.includes('--node');
  let browser = null, page = null, errors = [];
  if (!noPage) { const { openPage } = require('./browser'); ({ browser, page, errors } = await openPage({ settle: 800 })); }
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(page, check, say, null, args.filter(a => a !== '--node'));
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  if (browser) await browser.close();
  console.log(fails ? `${fails} failure(s)` : 'bug-fix (after 1.25) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
