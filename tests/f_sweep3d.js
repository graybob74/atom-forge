'use strict';
/* The checks for the 1.26 3-D sweep and settings audit (the owner: "there are MANY bugs so please do a general bug search
   in 3d mode … and make sure every change actually applies correctly"), run by t_features (one line) or alone:
   node tests/f_sweep3d.js [--node] [part …]. Each part fails before its fix and passes after. Parts that need the page
   are skipped with --node. (page: the t_features page; check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const go = (X, n, dt) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = dt || X.chooseDt(); X.step(W.dt); } };
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;
const fresh = (seed = 7) => load('all', { seed });

/* 1. The particle view in 3-D (the owner: "the particle view doesn't work in 3d"): V, the view menu and Lab → View's
   Atom detail now draw every nucleus's nucleons and the electrons, as in the flat game, and shells and orbitals too.
   Before: the 3-D view drew its lit balls whatever was chosen (drawNucView, drawBohr, orbitals never called). */
PARTS.pview = async (page, check, say) => {
  const r = await page.evaluate(() => {
    hideModal && document.querySelectorAll('.modal').forEach(m => { m.hidden = true; }); loadPreset('mol3d'); setRunning(false);
    const n = { nuc: 0, bohr: 0, orb: 0, pair: 0 }, hasBP = typeof bondPair === 'function', keep = { drawNucView, drawBohr, drawOrbitalAtom, bondPair: hasBP ? bondPair : null };
    drawNucView = function () { n.nuc++; return keep.drawNucView.apply(this, arguments); }; drawBohr = function () { n.bohr++; return keep.drawBohr.apply(this, arguments); };
    drawOrbitalAtom = function () { n.orb++; return keep.drawOrbitalAtom.apply(this, arguments); }; if (hasBP) bondPair = function () { n.pair++; return keep.bondPair.apply(this, arguments); };
    const out = { atoms: W.parts.filter(p => !p.dead && p.ne > 0).length, bonds: W.bonds.length };
    try {
      setAtomView('nuc'); render(1); out.nuc = n.nuc; out.pairs = n.pair;
      R.cam3.dist = 8; setAtomView('on'); render(1); out.shells = n.bohr; cam3Fit();
      setAtomView('orb'); render(1); out.orb = n.orb;
    } finally { drawNucView = keep.drawNucView; drawBohr = keep.drawBohr; drawOrbitalAtom = keep.drawOrbitalAtom; if (hasBP) bondPair = keep.bondPair; setAtomView('auto'); }
    return out;
  });
  check(r.nuc >= 0.9 * r.atoms && r.pairs >= 0.9 * r.bonds && r.shells > 0 && r.orb >= 0.9 * r.atoms,
    `3-D sweep 1: the particle view in 3-D draws ${r.nuc} of ${r.atoms} atoms as nucleons and electrons and ${r.pairs} of ${r.bonds} bonds as shared electrons; shells (${r.shells} close up) and orbitals (${r.orb}) drawn too`, '3-D sweep pview: ' + JSON.stringify(r));
};
PARTS.pview.page = true;

/* 2. The ultra-realistic mode in 3-D (the owner: "ultra realistic mode doesn't work in 3d"): its rates and true-size hits
   already applied; the picture did not (the camera stopped at 0.5 Å, every particle drawn enlarged). Now the camera comes
   in to 2 fm and nuclei are drawn at their true size (ultraNucleus), and back to 0.5 Å when it is turned off. In the
   engine, slow neutrons through a 3-D uranium lattice meet nothing at true size and many nuclei enlarged. */
PARTS.ultra3d = async (page, check, say) => {
  const r = await page.evaluate(() => {
    loadPreset('mol3d'); setRunning(false); setSetting('ultra', true);
    const c = W.parts.find(p => p.Z === 6), out = {}; let n = 0; const keep = ultraNucleus;
    R.follow = null; R.cam3.tx = c.x; R.cam3.ty = c.y; R.cam3.tz = c.z; for (let i = 0; i < 200; i++) cam3Zoom(1.25);
    out.dist = R.cam3.dist; out.s = R.s;
    ultraNucleus = function () { n++; return keep.apply(this, arguments); };
    try { render(1); } finally { ultraNucleus = keep; }
    out.nuclei = n; setSetting('ultra', false); out.distOff = R.cam3.dist; cam3Fit();
    return out;
  });
  check(r.dist <= 2.1e-5 && r.nuclei > 0 && r.distOff === 0.5,
    `3-D sweep 2: ultra-realistic in 3-D: the camera comes in to ${r.dist} Å (${Math.round(r.s * 1e-5)} px a fm) and draws nuclei at their true size (${r.nuclei}); back to 0.5 Å when turned off`, '3-D sweep ultra3d: ' + JSON.stringify(r));
};
PARTS.ultra3d.page = true;

/* 3. Fire in 3-D held electrons and positrons below 950 eV (0.95 × the flat game's radiation-flight threshold: 3-D had no
   flight for them then), though since bug fix 14 after 1.25 a lepton past 25 keV flies in 3-D; its note also still
   said atoms stop at 1.9 keV and neutrons can't be fired (both work since 1.25). A click fired at an atom with the
   energy set to 1 MeV: an electron of 950 eV before, 1 MeV now. And "Not in 3-D yet" inside a sentence read "not in 3-d
   yet" (toLowerCase on the whole phrase): the note, and the log lines for tools and particles refused in 3-D. */
PARTS.fireLep = async (page, check, say) => {
  const r = await page.evaluate(async () => {
    loadPreset('mol3d'); setRunning(false); setTool('fire'); OPT.fire.proj = 'e'; OPT.fire.s = 800; buildToolOpts();
    await new Promise(r => setTimeout(r, 50));
    const p = W.parts.find(q => !q.dead && q.Z === 8), o = [0, 0, 0]; cam3Update(); proj3(p.x, p.y, p.z, o);
    const b = $('cv').getBoundingClientRect(); return { x: b.left + o[0], y: b.top + o[1], note: ($('oFireNote') || {}).textContent || '' };
  });
  await page.mouse.click(r.x, r.y); await page.waitForTimeout(100);
  const e = await page.evaluate(() => { const l = W.parts.filter(q => !q.dead && q.k === ELEC).pop(); setTool('inspect'); return l ? Math.round(keOf(l)) : null; });
  check(e > 9e5 && !/950 eV|up to/.test(r.note) && /not in 3-D yet/.test(r.note),
    `3-D sweep 3: Fire in 3-D sends an electron at the energy set (${e} eV for 1 MeV); its note: "${r.note.replace(/^.*In 3-D: /, 'In 3-D: ')}"`, '3-D sweep fireLep: ' + JSON.stringify({ e, note: r.note }));
};
PARTS.fireLep.page = true;

/* 4. The quick menu's "Magnet here" (right-click on empty space) stayed greyed "Not in 3-D yet" in the 3-D lab, though
   magnets work there since 1.24 (the Magnet tool puts a ball at the placing point). Now it puts one at the point. */
PARTS.qmMagnet = async (page, check, say) => {
  await page.evaluate(() => { loadPreset('mol3d'); setRunning(false); setTool('inspect'); W.magnets.length = 0; });
  const b = await page.evaluate(() => { const r = $('cv').getBoundingClientRect(); return { x: r.left + r.width * 0.7, y: r.top + r.height * 0.75 }; });
  await page.mouse.click(b.x, b.y, { button: 'right' }); await page.waitForTimeout(200);
  const r = await page.evaluate(() => { const bt = [...document.querySelectorAll('#qmenu .qmi')].find(e => /Magnet here/.test(e.textContent)); const o = { found: !!bt, off: bt ? bt.disabled : null }; if (bt && !bt.disabled) bt.click(); o.magnets = W.magnets.length; o.z = W.magnets[0] ? Number.isFinite(W.magnets[0].z) : false; closeQuickMenu(); W.magnets.length = 0; return o; });
  check(r.found && !r.off && r.magnets === 1 && r.z, `3-D sweep 4: the quick menu's "Magnet here" puts a magnet ball in the 3-D lab`, '3-D sweep qmMagnet: ' + JSON.stringify(r));
};
PARTS.qmMagnet.page = true;

module.exports = async function fsweep3d(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (3-D sweep ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `3-D sweep ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '3-D sweep (1.26) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
