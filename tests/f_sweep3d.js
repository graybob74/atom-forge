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

/* 5. Data → Wall pressure in 3-D used the flat formula: the push on all six faces over the perimeter of one (N/m), against
   an ideal gas over the area of one face, so its "vs ideal gas" Z meant nothing (helium at 300 K: Z 1.33, "0.037 N/m").
   Now force per area of the six faces in pascals, against N·k·T over the volume: helium about 0.9 (the soft walls'
   inset; the flat game's helium the same), 6 MPa. */
PARTS.pressure = async (page, check, say) => {
  const X = fresh(4), W = X.W; X.baseWorld(40, 40, 300, 0.05); X.world3d(40);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) for (let k = 0; k < 3; k++) X.addAtom('He', -15 + 6 * i, -15 + 6 * j, { z: -12 + 12 * k, T: 300 });
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  let T = 0, n = 0; for (let s = 0; s < 20000; s++) { go(X, 1); if (s > 500 && s % 20 === 0) { const t = X.measure().T; T += t; n++; X.wallPressure(0, t); } }
  const r = X.wallPressure(0, T / n), u = X.pUnit ? X.pUnit() : 'N/m';
  check(r && r.Z > 0.6 && r.Z < 1.15 && u === 'Pa' && r.P > 3e6 && r.P < 1e7, `3-D sweep 5: Data's wall pressure in 3-D: helium at ${Math.round(T / n)} K pushes ${(r.P / 1e6).toFixed(2)} M${u}, Z = ${r.Z.toFixed(2)} ± ${r.zErr.toFixed(2)}`, '3-D sweep pressure: ' + JSON.stringify({ r, u }));
};

/* 6. The Physics tab in the 3-D lab began "atoms move in a two-dimensional chamber" and said nothing of what differs in
   3-D. Now the sentence follows the mode, and a card "In the 3-D lab" says what is three-dimensional, which flat
   corrections are still on and what is not in 3-D yet; the flat game's tab is as before. */
PARTS.physText = async (page, check, say) => {
  const r = await page.evaluate(async () => {
    const vis = () => { showTab('physics', true); const t = $('tp-physics'); return [...t.querySelectorAll('p, h4')].filter(e => e.getClientRects().length).map(e => e.innerText).join(' | '); };
    loadPreset('mol3d'); setRunning(false); await new Promise(r => setTimeout(r, 50)); const d3 = vis();
    loadPreset('water'); setRunning(false); await new Promise(r => setTimeout(r, 50)); const d2 = vis(); showTab('lab', true);
    return { d3: { flat: /two-dimensional chamber/.test(d3), box: /three-dimensional box/.test(d3), card: /In the 3-D lab/.test(d3) }, d2: { flat: /two-dimensional chamber/.test(d2), card: /In the 3-D lab \|/.test(d2) } };
  });
  check(!r.d3.flat && r.d3.box && r.d3.card && r.d2.flat && !r.d2.card, `3-D sweep 6: the Physics tab says "three-dimensional box" and has its "In the 3-D lab" card in 3-D, the flat text in the flat game`, '3-D sweep physText: ' + JSON.stringify(r));
};
PARTS.physText.page = true;

/* 7. The tour (Esc menu → Tour) in the 3-D lab told the flat game's controls: "drag with the right button to move
   around" (in 3-D it turns the view), the Objects tool, S and E for Spark and Erase (they fly the camera there), "a
   chain reaction, a collider" among the setups. Now its first, second and fifth cards have 3-D words in 3-D. */
PARTS.tour3d = async (page, check, say) => {
  const r = await page.evaluate(() => {
    const texts = () => { tourStart(); const out = []; for (let i = 0; i < TOUR.length; i++) { TS.i = i; tourShow(); out.push($('tourText').textContent); } tourEnd(); return out; };
    loadPreset('mol3d'); setRunning(false); const d3 = texts(); loadPreset('water'); setRunning(false); const d2 = texts();
    return { d3first: d3[0], d3tools: d3[1], flatFirst: d2[0] };
  });
  check(/turn the view/.test(r.d3first) && /Spark is Z/.test(r.d3tools) && /move around/.test(r.flatFirst) && !/turn the view/.test(r.flatFirst),
    `3-D sweep 7: the tour in 3-D says how to turn, move and fly the camera and that Spark and Erase are Z and X there; the flat game's tour unchanged`, '3-D sweep tour3d: ' + JSON.stringify(r));
};
PARTS.tour3d.page = true;

/* 8. The chamber's scale bar was drawn behind the main menu (the axis marker is not), and at 1280 × 720 it ran under the
   3-D menu's note at the bottom left. Now neither is drawn while the menu is open. */
PARTS.menuScale = async (page, check, say) => {
  const r = await page.evaluate(() => {
    loadPreset('mol3d'); setRunning(false); showMainMenu();
    const texts = [], C = CanvasRenderingContext2D.prototype, keep = C.fillText;
    C.fillText = function (t) { texts.push(String(t)); return keep.apply(this, arguments); };
    try { render(1); } finally { C.fillText = keep; }
    hideMainMenu(); return texts.filter(t => /^\d[\d.,]* (fm|pm|Å|nm|µm)$/.test(t));
  });
  check(r.length === 0, `3-D sweep 8: no scale bar drawn behind the main menu`, '3-D sweep menuScale: ' + JSON.stringify(r));
};
PARTS.menuScale.page = true;

/* 9. A laser left on in 3-D (Light → Leave on) was not drawn (no housing, no beam), and Erase over it left it on (the 3-D
   Erase took particles and magnets only; its note says "Erase removes it"). Now its beam and housing are drawn
   (drawLasers3) and Erase's cone takes it. */
PARTS.laser3d = async (page, check, say) => {
  const a = await page.evaluate(() => { loadPreset('mol3d'); setRunning(false); W.lasers.length = 0; setTool('light'); OPT.light.mount = true; buildToolOpts();
    const p = W.parts.find(q => !q.dead && q.Z === 6), o = [0, 0, 0]; cam3Update(); proj3(p.x, p.y, p.z, o); const r = $('cv').getBoundingClientRect(); return { x: r.left + o[0], y: r.top + o[1] }; });
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up(); await page.waitForTimeout(50);
  const r = await page.evaluate(() => { const o = { lasers: W.lasers.length }; let n = 0; const keep = photonColor; photonColor = function () { n++; return keep.apply(this, arguments); }; try { render(1); } finally { photonColor = keep; } o.drawn = n; OPT.light.mount = false; setTool('erase'); return o; });
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
  r.afterErase = await page.evaluate(() => { const n = W.lasers.length; W.lasers.length = 0; setTool('inspect'); return n; });
  check(r.lasers === 1 && r.drawn > 0 && r.afterErase === 0, `3-D sweep 9: a laser left on in 3-D is drawn and Erase over its housing turns it off`, '3-D sweep laser3d: ' + JSON.stringify(r));
};
PARTS.laser3d.page = true;

/* 10. The 3-D event captions had their first line only: no second line (a decay's "2.2 µs mean life", a capture's
   "μ⁻ + p → n + ν inside the nucleus") and no decay close-up, so Lab → View → Decay close-ups did nothing in 3-D. Now
   drawn as in the flat view: an α decay of ²¹²Po in the 3-D box shows its sub-line and its nucleus's close-up. */
PARTS.events3d = async (page, check, say) => {
  const r = await page.evaluate(() => {
    loadPreset('d3empty'); setRunning(false); R.view.decayCards = true; W.warp = 1e8;
    const p = addAtom('Po', 0, 0, { A: 212, z: 0 }); forcesNoEvents(); W.fSpawn = W.spawned;
    for (let i = 0; i < 200 && !W.events.some(e => e.nuc); i++) simFrame(1 / 60, 50);
    const e = W.events.find(e => e.nuc); if (!e) return { none: true };
    e.t0 = 1; let ins = 0, sub = 0; const keep = drawDecayInset, C = CanvasRenderingContext2D.prototype, ft = C.fillText;
    drawDecayInset = function () { ins++; return keep.apply(this, arguments); }; C.fillText = function (t) { if (t === e.sub) sub++; return ft.apply(this, arguments); };
    try { render(2); } finally { drawDecayInset = keep; C.fillText = ft; }
    W.warp = 1; return { text: e.text, sub: e.sub, subDrawn: sub, insets: ins };
  });
  check(r.insets > 0 && (!r.sub || r.subDrawn > 0), `3-D sweep 10: a decay's caption in 3-D has its close-up and second line ("${r.text}", "${r.sub}")`, '3-D sweep events3d: ' + JSON.stringify(r));
};
PARTS.events3d.page = true;

/* 11. Settings audit: General → Setup tips turned off hid the setup's tip, but turned back on left it hidden until the
   next setup was loaded. Now the current setup's tip shows again at once. */
PARTS.tipsBack = async (page, check, say) => {
  const r = await page.evaluate(() => {
    loadPreset('mol3d'); setRunning(false); openSettings('gen'); const c = $('setTips');
    c.checked = false; c.dispatchEvent(new Event('change')); const off = $('hint').hidden;
    c.checked = true; c.dispatchEvent(new Event('change')); const on = $('hint').hidden; hideModal('setModal');
    return { hiddenWhenOff: off, hiddenWhenOn: on };
  });
  check(r.hiddenWhenOff && !r.hiddenWhenOn, `3-D sweep 11 (settings): Setup tips off hides the tip, on shows it again at once`, '3-D sweep tipsBack: ' + JSON.stringify(r));
};
PARTS.tipsBack.page = true;

/* 12. Moving a selection (Select tool, drag on it) and deleting it (Delete, the options bar) could not be undone (Ctrl+Z
   took back the step before), in both modes; Help says Ctrl+Z undoes. Now each is marked for undo as the tools are. */
PARTS.selUndo = async (page, check, say) => {
  const out = {};
  for (const k of ['mol3d', 'water']) {
    const a = await page.evaluate((k) => { loadPreset(k); setRunning(false); setTool('select'); UNDO.back.length = 0; UNDO.fwd.length = 0;
      const p = W.parts.find(q => !q.dead && q.Z === 8 && Math.abs(q.x) < 8 && Math.abs(q.y) < 8) || W.parts.find(q => !q.dead && q.Z === 8), o = [0, 0, 0];
      if (W.d3) { cam3Update(); proj3(p.x, p.y, p.z, o); } else { o[0] = w2sx(p.x); o[1] = w2sy(p.y); } const r = $('cv').getBoundingClientRect();
      return { x: r.left + o[0], y: r.top + o[1] }; }, k);
    const sum = () => page.evaluate(() => +W.parts.filter(p => !p.dead).reduce((s, p) => s + p.x + 2 * p.y + 3 * (p.z || 0), 0).toFixed(3));
    const s0 = await sum();
    await page.mouse.move(a.x - 25, a.y - 25); await page.mouse.down(); await page.mouse.move(a.x + 25, a.y + 25, { steps: 4 }); await page.mouse.up();
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(a.x + 80, a.y, { steps: 5 }); await page.mouse.up();
    const s1 = await sum(); await page.keyboard.press('Control+z'); await page.waitForTimeout(150); const s2 = await sum();
    const n0 = await page.evaluate(() => { selectAll(); const n = W.parts.filter(p => !p.dead).length; deleteSelection(); return n; });
    await page.keyboard.press('Control+z'); await page.waitForTimeout(150);
    out[k] = { moved: Math.abs(s1 - s0) > 0.5, back: Math.abs(s2 - s0) < 0.01, n0, nBack: await page.evaluate(() => { setTool('inspect'); return W.parts.filter(p => !p.dead).length; }) };
  }
  const ok = Object.values(out).every(o => o.moved && o.back && o.nBack === o.n0);
  check(ok, `3-D sweep 12: Ctrl+Z takes back moving and deleting a selection (3-D and flat)`, '3-D sweep selUndo: ' + JSON.stringify(out));
};
PARTS.selUndo.page = true;

/* 13. Lab → Record video drew each canvas layer whole into the frame; the WebGL layer (the atoms and bonds, in 3-D and in
   the flat game) reaches 64 px past the chamber on each side, so in the video the atoms were shrunk toward the middle,
   off their labels, rings and the box's front edges by up to ~40 px near the edges. Now each layer's part over the
   chamber is drawn. A carbon atom put 150 px from the left edge: its colour where it is in the frame, before the
   background there. */
PARTS.recAlign = async (page, check, say) => {
  const r = await page.evaluate(() => {
    loadPreset('d3empty'); setRunning(false); setSetting('gl', 'gl');
    cam3Fit(); const P = s2w3(150, R.h / 2), p = addAtom('C', P[0], P[1], { z: P[2] }); cam3Update();
    const o = [0, 0, 0]; proj3(p.x, p.y, p.z, o);
    const keep = { run: UI.running }; UI.running = true; REC.last = -1e9; REC.pend = 0; REC.frames = REC.frames || []; const n0 = REC.frames.length;
    render(1); recCapture(); UI.running = keep.run; REC.frames.length = n0; REC.pend = 0; recShow && recShow();
    const cv = REC.cv, k = cv.width / $('cv').width * R.dpr, d = cv.getContext('2d').getImageData(Math.round(o[0] * k), Math.round(o[1] * k), 1, 1).data;
    return { gl: R.gl, at: [Math.round(o[0]), Math.round(o[1])], rgb: [d[0], d[1], d[2]] };
  });
  const lum = r.rgb[0] + r.rgb[1] + r.rgb[2];
  check(!r.gl || lum > 150, `3-D sweep 13: a recorded frame has the atom where it is drawn (pixel at ${r.at}: rgb ${r.rgb})`, '3-D sweep recAlign: ' + JSON.stringify(r));
};
PARTS.recAlign.page = true;

/* 14. The gallery's picture of a world (galThumb) took the layers the same way, after the frame was shown, when the
   WebGL layer's frame is gone: the atoms were missing or misplaced in the picture. Now it draws a frame and takes each
   layer's part over the chamber. */
PARTS.galThumb = async (page, check, say) => {
  const r = await page.evaluate(async () => {
    loadPreset('d3empty'); setRunning(false); setSetting('gl', 'gl'); cam3Fit();
    const P = s2w3(150, R.h / 2), p = addAtom('C', P[0], P[1], { z: P[2] }); await new Promise(r => setTimeout(r, 120));
    const o = [0, 0, 0]; cam3Update(); proj3(p.x, p.y, p.z, o);
    const url = galThumb(), img = new Image(); await new Promise(r => { img.onload = r; img.src = url; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const k = img.width / R.w, d = g.getImageData(Math.round(o[0] * k), Math.round(o[1] * k), 1, 1).data;
    return { gl: R.gl, rgb: [d[0], d[1], d[2]] };
  });
  check(!r.gl || r.rgb[0] + r.rgb[1] + r.rgb[2] > 150, `3-D sweep 14: the gallery's picture has the atom where it is drawn (rgb ${r.rgb})`, '3-D sweep galThumb: ' + JSON.stringify(r));
};
PARTS.galThumb.page = true;

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
