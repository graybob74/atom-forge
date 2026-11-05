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

/* ---- 3. magnets and fields in 3-D: the Lab's B and E (with ±z) and B's axis, the Magnet tool placing a ball; an electron
   circles exactly about each axis; a magnet's pull is the slope of its energy in x, y and z; the books with B and E */
PARTS.fields = async (page, check, say) => {
  const ui = await page.evaluate(async () => {
    loadPreset('mol3d'); setRunning(false); showTab('lab', true); cam3Fit();
    const dis = ['bSlider', 'eSlider', 'bMagClear'].filter(id => $(id).disabled);
    document.querySelector('#segBdir button[data-v="x"]').click(); document.querySelector('#segEdir button[data-v="z"]').click();
    const e = $('eSlider'); e.value = 20; e.dispatchEvent(new Event('input'));
    setTool('magnet'); return { dis, ax: W.Bax3, Ez: W.Ez, Ex: W.Ex, tool: UI.tool, vis: getComputedStyle($('segBdir')).display !== 'none' };
  });
  await page.mouse.move(560, 520); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(80);
  const mg = await page.evaluate(() => { const m = W.magnets[0]; return m ? { z: Number.isFinite(m.z), n: W.magnets.length } : null; });
  const flat = await page.evaluate(() => { loadPreset('empty'); return { vis: getComputedStyle($('segBdir')).display !== 'none', dis: $('bSlider').disabled }; });
  const gy = ['x', 'y', 'z'].map(ax => { // an electron in 2,000 T along each axis
    const X = load('all', { seed: 1 }), W = X.W; X.PRESETS.d3empty.build(); W.gamma = 0; W.Bz = 2000; W.Bax3 = ax;
    const e = X.addLepton(X.ELEC, 0, 0, 0, 0, 0); X.forcesNoEvents(); W.fSpawn = W.spawned; e.vx = 0.36; e.vy = 0.288; e.vz = 0.384;
    const u = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[ax], vpar = e.vx * u[0] + e.vy * u[1] + e.vz * u[2], vperp = Math.sqrt(0.36 - vpar * vpar), rth = vperp / Math.abs(e.q * W.Bz * X.PHYS.LOR * e.im);
    const ia = { x: [1, 2], y: [2, 0], z: [0, 1] }[ax], ip = { x: 0, y: 1, z: 2 }[ax], pts = [], p0 = [e.x, e.y, e.z][ip], t0 = W.t;
    for (let i = 0; i < 300; i++) { W.dt = X.chooseDt(); X.step(W.dt); pts.push([e.x, e.y, e.z]); }
    const ext = (k) => Math.max(...pts.map(p => p[k])) - Math.min(...pts.map(p => p[k]));
    return { ax, ratio: +(Math.max(ext(ia[0]), ext(ia[1])) / (2 * rth)).toFixed(4), along: +((pts[299][ip] - p0) / (vpar * (W.t - t0))).toFixed(5) };
  });
  const sl = ['Fe', 'Ar'].map(el => { // a magnet's pull against the slope of its energy
    const X = load('all', { seed: 3 }), W = X.W; X.PRESETS.d3empty.build(); W.Bax3 = 'x';
    const p = X.addAtom(el, 4.1, 1.3, { z: -2.2, T: 300 }); p.tLocal = 300; W.magnets.push({ x: 0, y: 0, z: 0, R: 3, B: 2e4 }); X.forcesNoEvents();
    const f = [p.fx, p.fy, p.fz], h = 1e-5; let err = 0, mag = 0;
    ['x', 'y', 'z'].forEach((k, j) => { const v = p[k]; p[k] = v + h; const a = X.totalEnergy().pe; p[k] = v - h; const b = X.totalEnergy().pe; p[k] = v; const g = -(a - b) / (2 * h); err = Math.max(err, Math.abs(g - f[j])); mag = Math.max(mag, Math.abs(f[j])); });
    return { el, rel: +(err / mag).toExponential(1), towards: f[0] * -4.1 + f[1] * -1.3 + f[2] * 2.2 > 0 };
  });
  const bk = [[0, 0], [300, 0.05]].map(([B, E]) => { // eight electrons, insulated, 1,500 steps: the books (with the field's potential energy −qE·r)
    const X = load('all', { seed: 2 }), W = X.W; X.PRESETS.empty.build(); X.setBox(30, 30); X.world3d(30); W.gamma = 0; W.Bz = B; W.Bax3 = 'y'; W.Ez = E;
    for (let i = 0; i < 8; i++) { const e = X.addLepton(X.ELEC, -9 + (i % 4) * 6, 9 - 4 * Math.floor(i / 4), (i % 3) * 6 - 5, 0, 0); e.vx = 20 * Math.cos(i); e.vy = 12 * Math.sin(i); e.vz = 16 * Math.sin(i); }
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    const tot = () => { let u = 0; for (const p of W.parts) if (!p.dead) u -= p.q * W.Ez * p.z; return X.totalEnergy().total + u; };
    const e0 = tot(); for (let i = 0; i < 1500; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
    return { B, E, books: +(tot() - e0).toFixed(3) };
  });
  say('  3-D fields: ' + JSON.stringify({ ui, mg, flat, gy, sl, bk }));
  check(!ui.dis.length && ui.ax === 'x' && ui.Ez === 0.2 && ui.Ex === 0 && ui.tool === 'magnet' && ui.vis && mg && mg.z && !flat.vis && !flat.dis && gy.every(g => Math.abs(g.ratio - 1) < 1e-3 && Math.abs(g.along - 1) < 1e-4) && sl.every(s => s.rel < 1e-5) && sl[0].towards && !sl[1].towards && bk.every(b => Math.abs(b.books) < 1.5),
    `1.24: fields in 3-D: B, E (+z) and B's axis set from the Lab (they were disabled), the Magnet tool puts a ball in depth; an electron circles at m·v⊥/qB about each axis (${gy.map(g => g.ax + ' ' + g.ratio).join(', ')}) and drifts along it exactly; a magnet's pull is the slope of its energy (${sl.map(s => s.el + ' ' + s.rel).join(', ')}), iron pulled in, argon pushed out; eight electrons insulated, books ${bk.map(b => b.books).join(' / ')} eV without / with B and E`, '1.24 fields: ' + JSON.stringify({ ui, mg, flat, gy, sl, bk }));
};

/* ---- 4. light in 3-D: the Light tool shines from the camera at an atom (photons with depth, absorbed in 3-D); the books
   against the light put in (IR, UV, a γ ray's Compton electron exact at its event) */
PARTS.light = async (page, check, say) => {
  const pg = await page.evaluate(async () => {
    loadPreset('d3empty'); for (let i = 0; i < 27; i++) addAtom('Na', -8 + (i % 3) * 8, -8 + ((i / 3 | 0) % 3) * 8, { z: -8 + (i / 9 | 0) * 8 }); setRunning(true); cam3Fit(); $('hint').hidden = true;
    setTool('light'); OPT.light.s = 200.86; OPT.light.rate = 200; OPT.light.mount = false; buildToolOpts(); cam3Update();
    const r = R.cv.getBoundingClientRect(), o = [0, 0, 0], p = W.parts.find(q => q.Z === 11 && Math.abs(q.x) < 1 && Math.abs(q.y) < 1 && Math.abs(q.z) < 1); proj3(p.x, p.y, p.z, o);
    return { tool: UI.tool, at: [o[0] + r.left, o[1] + r.top], id: p.id, ph0: W.count.photons };
  });
  await page.mouse.move(pg.at[0], pg.at[1]); await page.mouse.down(); await page.waitForTimeout(900);
  const fl = await page.evaluate((id) => { cam3Update(); const p = W.parts.find(q => q.id === id), f = W.flights.concat([]).filter(f => f.z0 !== undefined), deep = f.filter(f => Math.abs(f.z0) > 1).length;
    const toward = f.filter(f => { const dx = f.x1 - f.x0, dy = f.y1 - f.y0, dz = f.z1 - f.z0, L = Math.hypot(dx, dy, dz); return L > 0 && Math.hypot(p.x - (f.x0 + dx * ((p.x - f.x0) * dx + (p.y - f.y0) * dy + (p.z - f.z0) * dz) / (L * L)), p.y - (f.y0 + dy * ((p.x - f.x0) * dx + (p.y - f.y0) * dy + (p.z - f.z0) * dz) / (L * L)), p.z - (f.z0 + dz * ((p.x - f.x0) * dx + (p.y - f.y0) * dy + (p.z - f.z0) * dz) / (L * L))) < 1.5; }).length;
    return { n: f.length, deep, toward, ph: W.count.photons, ion: W.count.ionize }; }, pg.id);
  await page.mouse.up(); await page.evaluate(() => setRunning(false));
  const bk = [['water', 0.124], ['water', 20], ['Na', 2.104], ['water', 1e6]].map(([what, E]) => {
    const X = load('all', { seed: 4 }), W = X.W; X.PRESETS.empty.build(); X.setBox(24, 24); X.world3d(24); W.gamma = 0;
    let k = 0; if (what === 'water') { for (let i = 0; i < 64; i++) X.addMolecule('H2O', -9 + (i % 4) * 5.5, -9 + (i >> 2 & 3) * 5.5, k++, 300, -9 + (i >> 4) * 5.5); } else for (let i = 0; i < 125; i++) X.addAtom('Na', -9 + (i % 5) * 4.5, -9 + ((i / 5 | 0) % 5) * 4.5, { z: -9 + (i / 25 | 0) * 4.5, T: 300 });
    const go = (n) => { for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };
    X.forcesNoEvents(); W.fSpawn = W.spawned; go(50);
    const e0 = X.totalEnergy().total, c0 = W.count.photons, i0 = W.count.ionize; let Ein = 0, ev = 0;
    for (let i = 0; i < 40; i++) { const t = 2 * Math.PI * i / 40, b0 = X.totalEnergy().total - e0 - Ein; X.emitPhoton(-11.9, 4 * Math.sin(3 * t), E, 1, 0.05 * Math.sin(t), { z: 4 * Math.cos(5 * t), uz: 0.05 * Math.cos(t) }); Ein += E; X.forcesNoEvents(); W.fSpawn = W.spawned; ev = Math.max(ev, Math.abs(X.totalEnergy().total - e0 - Ein - b0)); go(10); }
    go(100);
    return { what, E, books: +(X.totalEnergy().total - e0 - Ein).toFixed(3), event: +ev.toFixed(4), photons: W.count.photons - c0, ionize: W.count.ionize - i0 };
  });
  say('  3-D light: ' + JSON.stringify({ pg, fl, bk }));
  check(pg.tool === 'light' && fl.n > 20 && fl.deep > 0.5 * fl.n && fl.toward > 0.8 * fl.n && fl.ion > 0 && bk.every(b => Math.abs(b.books) < 0.3) && bk[3].event < 1e-3 && bk[1].ionize > 0 && bk[2].photons > 40,
    `1.24: light in 3-D: the Light tool held on a sodium atom sends ${fl.n} photons in flight, in depth, ${fl.toward} of them on the line to it from the camera, and ionizes (${fl.ion}); books against the light put in: ${bk.map(b => `${b.what} ${b.E} eV ${b.books}`).join(', ')} eV; a 1 MeV γ's Compton events exact (worst ${bk[3].event} eV: before the fix in ejectElectron, 10–16 eV each)`, '1.24 light: ' + JSON.stringify({ pg, fl, bk }));
};

/* ---- 5. unstable particles in 3-D: placed and fired in depth; decays at rest isotropic with the right momentum, in flight
   keeping momentum in three directions; muons and pions through water, positrons annihilating: the books */
PARTS.hep = async (page, check, say) => {
  const pg = await page.evaluate(() => {
    loadPreset('d3empty'); setRunning(false); cam3Fit();
    const ok = ['pi+', 'K-', 'mu-', 'Lam'].map(sp => spec3dOK({ kind: 'exo', sp })), nu = spec3dOK({ kind: 'nu' }), pos = spec3dOK({ kind: 'pos' }), mu = spec3dOK({ kind: 'exo', sp: 'muP' });
    placeSpec({ kind: 'exo', sp: 'pi+' }, 1, 2, 1, 5); const o = W.exo[W.exo.length - 1];
    fireSpec({ kind: 'exo', sp: 'mu+' }, -10, 0, 1, 0, 1e8, false, -3, 0.5); const m = W.exo[W.exo.length - 1];
    render(W.rt);
    return { ok, nu, pos, mu, z: o ? o.z : null, mz: m ? +m.uz.toFixed(3) : null, menu: pcats().some(([, l]) => l.some(s => s.kind === 'exo')) };
  });
  const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;
  const rest = (() => { const X = load('all', { seed: 5 }), W = X.W; X.PRESETS.d3empty.build(); W.gamma = 0; const cs = [], ps = []; let bk = 0;
    for (let k = 0; k < 300; k++) { const o = X.addExo('pi+', 0, 0, 1e-6, 1, 0, undefined, 0, 0), b0 = books(X); X.decayExo3(o); const mu = W.exo.filter(e => !e.dead && e.sp === 'mu+').pop(); bk = Math.max(bk, Math.abs(books(X) - b0)); ps.push(Math.sqrt(mu.KE / 1e6 * (mu.KE / 1e6 + 2 * mu.m))); cs.push([mu.ux, mu.uy, mu.uz]); mu.dead = true; }
    const m = (f) => cs.reduce((a, c) => a + f(c), 0) / cs.length;
    return { p: +Math.min(...ps).toFixed(3), p1: +Math.max(...ps).toFixed(3), mean: Math.max(...[0, 1, 2].map(i => Math.abs(m(c => c[i])))), sq: [0, 1, 2].map(i => +m(c => c[i] ** 2).toFixed(3)), books: bk }; })();
  const fly = (() => { const X = load('all', { seed: 6 }), W = X.W; X.PRESETS.d3empty.build(); let worst = 0, n = 0;
    while (n < 40) { const o = X.addExo('K+', 0, 0, 500e6, 0.6, 0.48, undefined, 0, 0.64), P = Math.sqrt(500 * (500 + 2 * o.m)), ex0 = W.exo.length, r0 = W.rays.length, pa0 = W.parts.length; X.decayExo3(o);
      if (W.parts.length > pa0) { for (const e of W.exo) e.dead = true; continue; } // (decays with an electron or positron: momentum in W.parts, not summed here)
      const s = [0, 0, 0]; for (const e of W.exo.slice(ex0)) { const p = Math.sqrt(e.KE / 1e6 * (e.KE / 1e6 + 2 * e.m)); s[0] += p * e.ux; s[1] += p * e.uy; s[2] += p * e.uz; e.dead = true; }
      for (const r of W.rays.slice(r0)) { const L = r.len || 1, E = r.E / 1e6; s[0] += E * (r.x1 - r.x0) / L; s[1] += E * (r.y1 - r.y0) / L; s[2] += E * (r.z1 - r.z0) / L; }
      worst = Math.max(worst, Math.hypot(s[0] - P * 0.6, s[1] - P * 0.48, s[2] - P * 0.64) / P); n++; }
    return { n, worst }; })();
  const water = ['mu-', 'pi+'].map(sp => { const X = load('all', { seed: 7 }), W = X.W; X.PRESETS.water3d.build(); W.gamma = 0; W.decayOn = true; W.warp = 1e7;
    const go = (n) => { for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };
    go(10); for (let k = 0; k < 10; k++) X.addExo(sp, -10.5, -6 + 1.2 * k, sp === 'mu-' ? 2e7 : 5e7, 1, 0.1 * Math.sin(k), undefined, -5 + k, 0.1 * Math.cos(k));
    const b1 = books(X); go(200); return { sp, books: +(books(X) - b1).toFixed(3), left: W.exo.filter(o => !o.dead).length }; });
  const pos = (() => { const X = load('all', { seed: 8 }), W = X.W; X.PRESETS.water3d.build(); W.gamma = 0; const go = (n) => { for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };
    go(10); let worst = 0, n = 0, zs = 0;
    for (let k = 0; k < 5; k++) { const p = X.addLepton(X.POS, -10, -5 + 2 * k, 0, 0, -4 + 2 * k, 0); X.setMotion(p, 200, 1, 0.05, 0, 0, 0.02); X.forcesNoEvents(); W.fSpawn = W.spawned; const b = books(X), r0 = W.rays.length; let s = 0; while (!p.dead && s < 3000) { go(1); s++; } if (p.dead) { n++; worst = Math.max(worst, Math.abs(books(X) - b)); for (const r of W.rays.slice(r0)) if (r.z0 !== undefined && Math.abs(r.z0) > 0.5) zs++; } }
    return { n, worst: +worst.toFixed(3), zs }; })();
  say('  3-D particles: ' + JSON.stringify({ pg, rest, fly, water, pos }));
  check(pg.ok.every(Boolean) && pg.nu && pg.pos && !pg.mu && pg.menu && pg.z === 5 && pg.mz === 0.447 && rest.p === 29.792 && rest.p1 === 29.792 && rest.mean < 0.1 && rest.sq.every(v => Math.abs(v - 1 / 3) < 0.05) && rest.books < 1e-4 && fly.n === 40 && fly.worst < 1e-9 && water.every(w => Math.abs(w.books) < 3) && pos.n >= 4 && pos.worst < 0.5 && pos.zs > 0,
    `1.24: unstable particles in 3-D: pions, kaons, muons, hyperons, neutrinos and positrons in the 3-D menus, placed and fired in depth; π⁺ at rest → μ⁺ at ${rest.p} MeV/c every time, isotropic (⟨u²⟩ ${rest.sq.join(', ')}), books ${rest.books.toExponential(1)} eV; K⁺ at 500 MeV decaying in flight keeps its momentum to ${fly.worst.toExponential(1)} in x, y and z; muons and pions through water: books ${water.map(w => w.sp + ' ' + w.books).join(', ')} eV; positrons annihilating in water: worst ${pos.worst} eV, their γ rays at their depth`, '1.24 particles: ' + JSON.stringify({ pg, rest, fly, water, pos }));
};

/* ---- 6. the Experimental settings in 3-D: induced charges, quantum nuclei, quantum bonds, electrons as waves and the
   ultra-realistic mode on in a 3-D world (their controls enabled; continuous bond orders too since 1.25), each with
   its insulated books */
PARTS.exp = async (page, check, say) => {
  const ui = await page.evaluate(() => {
    loadPreset('water3d'); setRunning(false);
    const en = (sel) => [...document.querySelectorAll(sel)].map(b => !b.disabled);
    const r = { qeq: en('#segQeq button'), pi: en('#segPi button'), rpc: en('#segPiRpc button'), wave: en('#segWave button'), bo: en('#segBo button'), ultra: !$('setUltra').disabled, note: /from the positions/i.test($('set3dNote').textContent) && !/induced charges, quantum nuclei, continuous/.test($('set3dNote').textContent) };
    loadPreset('empty'); r.flat = en('#segBo button'); return r;
  });
  const go = (X, n) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };
  const ins = (X) => { X.W.gamma = 0; X.forcesNoEvents(); X.W.fSpawn = X.W.spawned; return X.totalEnergy().total; };
  const qeq = (() => { const X = load('all', { seed: 3 }), W = X.W; X.PRESETS.water3d.build(); X.QEQ.every = 1; go(X, 100); const e0 = ins(X); go(X, 200); let qi = 0, c = 0; for (const p of W.parts) if (!p.dead && p.qi) { qi += Math.abs(p.qi); c++; } return { books: +(X.totalEnergy().total - e0).toFixed(3), n: X.QEQ.n, qi: +(qi / Math.max(1, c)).toFixed(3) }; })();
  const pi = (() => { const X = load('all', { seed: 4 }), W = X.W; X.PRESETS.empty.build(); X.setBox(22, 22); X.world3d(22); W.gamma = 0.05; let k = 0; for (let i = 0; i < 27; i++) X.addMolecule('H2O', -6 + (i % 3) * 6, -6 + ((i / 3 | 0) % 3) * 6, k++, 300, -6 + (i / 9 | 0) * 6); X.forcesNoEvents(); X.piSet(8); go(X, 200);
    const e0 = ins(X); go(X, 300); let rz = 0, c = 0; for (const p of W.parts) if (!p.dead && p.Z === 1) { let s = 0; for (let b = 0; b < 8; b++) s += X.PI.oz[b * X.PI.cap + p.i] ** 2; rz += Math.sqrt(s / 8); c++; } return { books: +(X.totalEnergy().total - e0).toFixed(4), rz: +(rz / c).toFixed(3), beads: X.PI.P }; })();
  const qm = (() => { const X = load('all', { seed: 3 }), W = X.W; X.PRESETS.empty.build(); X.setBox(24, 24); X.world3d(24); W.gamma = 0.05; ['H2O', 'H2O', 'H2O', 'NH3', 'CH4'].forEach((m, k) => X.addMolecule(m, -6 + (k % 3) * 6, -3 + (k / 3 | 0) * 6, k, 300, k % 2 ? 2 : -2)); X.forcesNoEvents(); X.boSet(2); go(X, 60);
    X.forcesNoEvents(); const p = W.parts.find(q => q.bom && q.Z === 8), f = [p.fx, p.fy, p.fz], h = 1e-4; let err = 0; ['x', 'y', 'z'].forEach((k, j) => { const v = p[k]; p[k] = v + h; const a = X.totalEnergy().pe; p[k] = v - h; const b = X.totalEnergy().pe; p[k] = v; err = Math.max(err, Math.abs(-(a - b) / (2 * h) - f[j])); });
    const e0 = ins(X); go(X, 200); return { mem: W.parts.filter(q => q.bom).length, slope: +err.toExponential(1), fz: Math.abs(f[2]) > 1e-4, books: +(X.totalEnergy().total - e0).toFixed(4), fails: X.XQ.fails }; })();
  const wave = (() => { const X = load('all', { seed: 2 }), W = X.W; X.PRESETS.empty.build(); X.setBox(30, 30); X.world3d(30); W.gamma = 0;
    for (let i = 0; i < 6; i++) X.addAtom('Na', -10 + (i % 3) * 10, -6 + (i / 3 | 0) * 12, { z: i % 2 ? 5 : -5, charge: 1, T: 300 });
    for (let i = 0; i < 12; i++) { const e = X.addLepton(X.ELEC, -11 + (i % 4) * 7, -9 + (i / 4 | 0) * 8, (i % 3) * 7 - 7, 0, 0); e.vx = 3 * Math.cos(i); e.vy = 3 * Math.sin(i); e.vz = 2 * Math.cos(2 * i); }
    X.waveSet(true); X.forcesNoEvents(); W.fSpawn = W.spawned; const e0 = X.totalEnergy().total, b0 = W.ledger.bath; go(X, 1000);
    return { packets: X.WAVE.mem.filter(p => p.wm && !p.dead).length, books: +(X.totalEnergy().total - e0 + (W.ledger.bath - b0)).toFixed(4) }; })();
  say('  3-D Experimental: ' + JSON.stringify({ ui, qeq, pi, qm, wave }));
  const all = (a) => a.every(Boolean);
  check(all(ui.qeq) && all(ui.pi) && all(ui.rpc) && all(ui.wave) && ui.bo[0] && ui.bo[1] && ui.bo[2] && ui.ultra && ui.note && all(ui.flat) && qeq.n >= 200 && qeq.qi > 0.03 && Math.abs(qeq.books) < 0.5 && pi.beads === 8 && pi.rz > 0.03 && Math.abs(pi.books) < 0.1 && qm.mem >= 10 && qm.slope < 1e-5 && qm.fz && Math.abs(qm.books) < 0.05 && qm.fails === 0 && wave.packets >= 4 && Math.abs(wave.books) < 0.3,
    `1.24: Experimental settings in 3-D (bond orders "From the positions" too since 1.25): induced charges in liquid water, ${qeq.n} updates, ⟨|qi|⟩ ${qeq.qi} e, books ${qeq.books} eV over 200 steps; quantum nuclei, 8 beads, hydrogen rings ${pi.rz} Å deep in z, books ${pi.books} eV; quantum bonds, ${qm.mem} members, force = slope to ${qm.slope} eV/Å in x, y and z, books ${qm.books} eV; electrons as waves, ${wave.packets} packets, books ${wave.books} eV`, '1.24 Experimental: ' + JSON.stringify({ ui, qeq, pi, qm, wave }));
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
