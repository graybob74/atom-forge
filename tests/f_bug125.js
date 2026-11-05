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
  check(r.us < 30 && r.same && r.hits > 30, `bug fix 9: a path search among ${r.atoms} atoms in 3-D takes ${r.us} µs (the grid's cells), the same ${r.hits} atoms found as over every atom`, 'bugfix segGrid: ' + JSON.stringify(r));
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
