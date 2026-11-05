'use strict';
/* The 1.24 checks (the rest of the 3-D lab), run by t_features (its "1.24" block) or alone: node tests/f_124.js [part …]
   (parts: place, box, fields, light, hep, exp). Each part fails on 1.23.2. (page: the t_features page; check(ok, good,
   bad); say(...)) */
const path = require('path');
const { load } = require('./load');
const PARTS = {};
/* ---- 1. placing and firing in 3-D: the placing plane (Shift + wheel, the Depth slider), placing against an atom's near
   side, the ghost and the grid drawn, firing from the camera straight at an atom */
PARTS.place = async (page, check, say) => {
  await page.evaluate(() => { loadPreset('mol3d'); setRunning(false); setTool('place'); selectSpec({ kind: 'atom', Z: 6, A: 12 }); cam3Fit(); $('hint').hidden = true; P3.off = 0; render(W.rt); });
  const at = await page.evaluate(() => { cam3Update(); const r = R.cv.getBoundingClientRect(), o = [0, 0, 0]; let best = null, bz = Infinity; for (const p of W.parts) if (!p.dead && p.Z === 8 && proj3(p.x, p.y, p.z, o) && o[2] < bz && pick3(o[0], o[1], 0) === p) { bz = o[2]; best = { x: o[0] + r.left, y: o[1] + r.top, id: p.id }; } return best; });
  await page.mouse.move(at.x, at.y); await page.waitForTimeout(120);
  const hov = await page.evaluate(() => { const o = R.overlay && R.overlay.place3; return o ? { at: o.at ? o.at.id : 0 } : null; });
  await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(80);
  const pl = await page.evaluate((id) => {
    const a = W.parts.find(p => p.id === id), c = W.parts[W.parts.length - 1]; cam3Update();
    const d = Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z), ex = C3.ex - a.x, ey = C3.ey - a.y, ez = C3.ez - a.z, el = Math.hypot(ex, ey, ez);
    return { Z: c.Z, d: +d.toFixed(2), toward: +(((c.x - a.x) * ex + (c.y - a.y) * ey + (c.z - a.z) * ez) / (d * el)).toFixed(2) };
  }, at.id);
  // the plane: Shift + wheel down moves it nearer, the Depth slider follows; empty space puts the item on it
  await page.mouse.move(780, 430); await page.waitForTimeout(80);
  const p0 = await page.evaluate(() => ({ off: P3.off, poly: plane3Poly(plane3Pt()).length, ghost: !!(R.overlay && R.overlay.place3 && !R.overlay.place3.at) }));
  await page.keyboard.down('Shift'); for (let k = 0; k < 3; k++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(40); } await page.keyboard.up('Shift');
  const p1 = await page.evaluate(() => ({ off: +P3.off.toFixed(2), slider: +$('oPD').value, text: $('oPDV').textContent, cam: R.cam3.dist }));
  const n0 = await page.evaluate(() => W.parts.length);
  await page.mouse.move(781, 431); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(80);
  const onPl = await page.evaluate(() => { const c = W.parts[W.parts.length - 1], P = plane3Pt(); cam3Update(); return { n: W.parts.length, dev: +Math.abs((c.x - P[0]) * C3.fx + (c.y - P[1]) * C3.fy + (c.z - P[2]) * C3.fz).toFixed(2) }; });
  check(hov && hov.at === at.id && pl.Z === 6 && pl.toward > 0.3 && pl.d > 1.5 && pl.d < 4.5 && p0.poly >= 3 && p0.ghost && p1.off < -1 && p1.slider < 0 && /nearer/.test(p1.text) && onPl.n === n0 + 1 && onPl.dev < 1.0,
    `1.24: 3-D placing: over an O atom the ghost goes against it and a click puts the C ${pl.d} Å from it on the side facing the camera (cos ${pl.toward}); Shift + wheel moved the placing plane ${p1.off} Å (the Depth slider at ${p1.slider}, "${p1.text}") and a click in empty space puts the atom on it (${onPl.dev} Å off the plane, before spreading)`, '1.24 placing: ' + JSON.stringify({ hov, pl, p0, p1, onPl }));
  // Fire: a click on an atom shoots from where the line of sight enters the box straight at it
  await page.evaluate(() => { setTool('fire'); OPT.fire.proj = 'e'; OPT.fire.s = 700; buildToolOpts(); });
  const tg = await page.evaluate(() => { cam3Update(); const r = R.cv.getBoundingClientRect(), o = [0, 0, 0]; for (const p of W.parts) if (!p.dead && p.Z === 7 && proj3(p.x, p.y, p.z, o) && pick3(o[0], o[1], 0) === p) return { x: o[0] + r.left, y: o[1] + r.top, id: p.id }; return null; });
  await page.mouse.move(tg.x, tg.y); await page.waitForTimeout(80);
  const aim = await page.evaluate(() => { const o = R.overlay && R.overlay.fire3; return o ? { at: o.at ? o.at.id : 0, text: o.text } : null; });
  const ne = await page.evaluate(() => W.parts.filter(p => p.k === ELEC).length);
  await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(80);
  const fr = await page.evaluate(([id, ne]) => {
    const es = W.parts.filter(p => p.k === ELEC && !p.dead), e = es[es.length - 1], a = W.parts.find(p => p.id === id); if (!e || es.length !== ne + 1) return { n: es.length };
    const v = Math.hypot(e.vx, e.vy, e.vz), dx = a.x - e.x, dy = a.y - e.y, dz = a.z - e.z, d = Math.hypot(dx, dy, dz), H = [W.box.w / 2, W.box.h / 2, W.box.d / 2];
    const face = Math.max(Math.abs(e.x) / H[0], Math.abs(e.y) / H[1], Math.abs(e.z) / H[2]);
    return { n: es.length, cos: +((e.vx * dx + e.vy * dy + e.vz * dz) / (v * d)).toFixed(4), face: +face.toFixed(3), ke: Math.round(0.5 * e.m * v * v) };
  }, [tg.id, ne]);
  check(aim && aim.at === tg.id && fr.cos > 0.9999 && fr.face > 0.9 && fr.face < 1.0,
    `1.24: Fire in 3-D: a click on an N atom fires an electron (${fr.ke} eV) from where the camera's line of sight enters the box (${fr.face} of the way to a face) straight at it (cos ${fr.cos}); the aim shows a crosshair and a ring on the atom`, '1.24 firing: ' + JSON.stringify({ aim, fr }));
};

/* ---- 2. the box size in 3-D: the Lab's slider scales width, height and depth; shrinking is a piston on all six faces
   (an insulated gas heats by the piston's work, the books exact against it), growing a free expansion */
PARTS.box = async (page, check, say) => {
  const ui = await page.evaluate(async () => {
    loadPreset('mol3d'); setRunning(false); showTab('lab', true);
    const el = $('boxSlider'), dis = el.disabled; el.value = sFromBox(20); el.dispatchEvent(new Event('input'));
    const td = W.box.td; for (let i = 0; i < 400; i++) { if (W.fSpawn !== W.spawned) { forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = chooseDt(); step(W.dt); }
    return { dis, td: +td.toFixed(2), box: [W.box.w, W.box.h, W.box.d].map(v => +v.toFixed(2)), txt: $('boxH').textContent, note: !$('box3dNote').hidden && !/Not in 3-D/.test($('box3dNote').textContent) };
  });
  const run = (to) => { // 64 argon atoms in a 30 Å cube, insulated; the walls' work measured as the soft walls' energy jumps when they move
    const X = load('all', { seed: 1, patch: (s) => s.replace(/function moveWalls3\(dt\) \{/, 'function moveWalls3(dt) { const a = _wpe(); moveWalls3_(dt); WORK += _wpe() - a; }\nfunction moveWalls3_(dt) {') + '\nlet WORK = 0; function _wpe() { let u = 0; for (const p of W.parts) if (!p.dead && p.k === NUC && !p.fast && !p.rad && p.Z > 0) u += wallPE(p); return u; }' });
    const W = X.W; X.PRESETS.empty.build(); X.setBox(30, 30); X.world3d(30); W.gamma = 0;
    for (let i = 0; i < 64; i++) X.addAtom('Ar', (i % 4) * 6 - 9, (Math.floor(i / 4) % 4) * 6 - 9, { z: Math.floor(i / 16) * 6 - 9, T: 300 });
    const go = (n) => { for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };
    go(200); const E1 = X.totalEnergy().total, T1 = X.measure().T; X.WORK = 0;
    W.box.tw = W.box.th = W.box.td = to; go(600); // (24 tu: the walls are there by 8 tu)
    const dE = X.totalEnergy().total - E1;
    return { to, box: +W.box.d.toFixed(2), T: [Math.round(T1), Math.round(X.measure().T)], dE: +dE.toFixed(3), work: +X.WORK.toFixed(3), books: +(dE - X.WORK).toFixed(3) };
  };
  const sq = run(20), gr = run(40);
  say('  3-D box: ' + JSON.stringify({ ui, sq, gr }));
  check(!ui.dis && ui.td === 20 && ui.box.every(v => Math.abs(v - 20) < 0.01) && /20 × 20/.test(ui.txt) && ui.note && sq.box === 20 && sq.T[1] > 2 * sq.T[0] && sq.work > 2 && Math.abs(sq.books) < 0.02 * sq.work && gr.box === 40 && Math.abs(gr.dE) < 0.05 && gr.work === 0,
    `1.24: box size in 3-D: the slider sets 20 × 20 × 20 Å (it was disabled); an insulated argon gas squeezed 30 → 20 Å heats ${sq.T[0]} → ${sq.T[1]} K by the piston's ${sq.work} eV (books ${sq.books} eV against it); grown to 40 Å, a free expansion (books ${gr.dE} eV)`, '1.24 box: ' + JSON.stringify({ ui, sq, gr }));
};

module.exports = async function f124(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.24 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  const { openPage } = require('./browser');
  const { browser, page, errors } = await openPage({ settle: 800 });
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(page, check, say, openPage, process.argv.slice(2));
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  await browser.close();
  console.log(fails ? `${fails} failure(s)` : '1.24 checks passed');
  process.exitCode = fails ? 1 : 0;
})();
