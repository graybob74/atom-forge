'use strict';
/* The 3-D view (stage 2), in headless Chromium: the preview setup makes a 3-D world and draws it with WebGL and with
   Canvas 2D (the two frames alike); the camera turns, pans and zooms from the mouse, the keys and two fingers, and the
   projection is a true perspective (checked against a camera built here from first principles); picking takes the
   atom under the pointer nearest the camera; a placed atom lands under the pointer; saving is refused; a 2-D setup
   afterwards draws exactly as before. Also prints the drawing's cost in 3-D against 2-D for the same atoms.
   Stage 3 (the 3-D lab as a mode): the main menu's 3-D lab lists and starts the 3-D setups; each builds and runs 200
   steps; Place, Grab, Select, Measure, Erase, Heat, Spark and Fire work in depth; what is not in 3-D yet is disabled;
   a 3-D world saves and loads (z to 1e-9), shares, undoes and carries on; an old flat save opens; Leave 3-D goes back.
   node tests/t_3d.js */
const path = require('path'), fs = require('fs');
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { openPage, pageFile } = require(path.join(__dirname, 'browser.js'));
let fails = 0;
const check = (ok, what, detail) => { if (ok) console.log('  ' + what); else { fails++; console.log('FAIL ' + what + (detail !== undefined ? ': ' + JSON.stringify(detail) : '')); } };
/* A screenshot measured in the page: the share of pixels brighter than the chamber's background, and (given a second
   one) the mean absolute difference and the share of pixels off by more than 24. */
async function measure(page, a, b) {
  return page.evaluate(async ([a, b]) => {
    const load = (s) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = 'data:image/png;base64,' + s; });
    const px = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height).data; };
    const A = await load(a), pa = px(A), n = A.width * A.height; let lit = 0;
    for (let i = 0; i < n * 4; i += 4) if (pa[i] + pa[i + 1] + pa[i + 2] > 240) lit++;
    const out = { lit: lit / n };
    if (b) { const pb = px(await load(b)); let sum = 0, off = 0; for (let i = 0; i < n * 4; i += 4) { let m = 0; for (let c = 0; c < 3; c++) { const d = Math.abs(pa[i + c] - pb[i + c]); sum += d; if (d > m) m = d; } if (m > 24) off++; } out.mean = sum / (n * 3); out.off = off / n; }
    return out;
  }, [a.toString('base64'), b ? b.toString('base64') : null]);
}
/* ---- Lit balls (1.24): the atoms are spheres lit by a light fixed in the world. One O atom close up, drawn with WebGL
   and with Canvas 2D; turning the camera 90° about the vertical moves its highlight across the ball, to where the light
   (turned into the view) puts it: the brightest spot is where the sphere's normal is halfway between the light and the
   eye. Labels off, so the symbol is not the brightest thing. */
async function litBalls(page, clip, shot) {
  // the brightest spot on the ball (the centroid of its pixels within 6 of the largest r+g+b), in CSS px of the chamber
  const brightest = (png, v) => page.evaluate(async ([s, cx, cy, r]) => {
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + s; });
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, im.width, im.height).data, k = im.width / document.getElementById('cv').getBoundingClientRect().width;
    const on = (j) => Math.hypot(((j % im.width) + 0.5) / k - cx, (Math.floor(j / im.width) + 0.5) / k - cy) < 0.95 * r;
    let m = 0; for (let i = 0; i < d.length; i += 4) if (on(i / 4)) m = Math.max(m, d[i] + d[i + 1] + d[i + 2]);
    let sx = 0, sy = 0, n = 0; for (let i = 0; i < d.length; i += 4) if (on(i / 4) && d[i] + d[i + 1] + d[i + 2] >= m - 6) { const j = i / 4; sx += j % im.width; sy += Math.floor(j / im.width); n++; }
    return { x: (sx / n + 0.5) / k, y: (sy / n + 0.5) / k, sum: m };
  }, [png.toString('base64'), v.cx, v.cy, v.r]);
  await page.mouse.move(1, 1); // (no hover ring)
  const out = {};
  for (const gl of [true, false]) for (const turn of [0, 1]) {
    const v = await page.evaluate(([gl, turn]) => {
      baseWorld(30, 30, 300, 0); world3d(30); setRunning(false); R.view.labels = false; R.hover = null;
      const a = addAtom('O', 0, 0, { z: 0, T: 0 }); Object.assign(R.cam3, { yaw: 0.6 + turn * Math.PI / 2, pitch: 0.3, dist: 7, tx: 0, ty: 0, tz: 0 });
      GL.on = gl; render(W.rt);
      const o = [0, 0, 0]; proj3(a.x, a.y, a.z, o); const r = _pv[4 * a.i + 3];
      const L = C3.L, hl = Math.hypot(L[0], L[1], L[2] + 1); // (Blinn–Phong: the brightest normal is halfway between the light and the eye)
      return { gl: R.gl, cx: o[0], cy: o[1], r, ex: o[0] + r * L[0] / hl, ey: o[1] - r * L[1] / hl, L: [...L] };
    }, [gl, turn]);
    const b = await brightest(await shot(), v);
    v.bx = b.x; v.by = b.y; v.off = Math.hypot(b.x - v.ex, b.y - v.ey) / v.r; // (from where the light puts it, in radii)
    out[(gl ? 'gl' : 'c2d') + turn] = v;
  }
  await page.evaluate(() => { R.view.labels = true; GL.on = true; });
  const moved = (k) => Math.hypot((out[k + 1].bx - out[k + 1].cx) - (out[k + 0].bx - out[k + 0].cx), (out[k + 1].by - out[k + 1].cy) - (out[k + 0].by - out[k + 0].cy)) / out[k + 0].r;
  const f = (v) => `(${((v.bx - v.cx) / v.r).toFixed(2)}, ${((v.by - v.cy) / v.r).toFixed(2)})`;
  console.log(`  lit balls: an O atom ${out.gl0.r.toFixed(0)} px across its radius; the highlight, in radii from the centre: WebGL ${f(out.gl0)} → ${f(out.gl1)} turned 90°, Canvas 2D ${f(out.c2d0)} → ${f(out.c2d1)}; it moved ${moved('gl').toFixed(2)} and ${moved('c2d').toFixed(2)} radii; off where the light puts it by at most ${Math.max(...Object.values(out).map(v => v.off)).toFixed(3)} radii`);
  check(out.gl0.gl && !out.c2d0.gl && out.gl0.r > 40 && moved('gl') > 0.25 && moved('c2d') > 0.25 && Object.values(out).every(v => v.off < 0.08),
    'the atoms are lit by a light fixed in the world: turning the view 90° moves the highlight across the ball to where the light puts it (WebGL and Canvas 2D)', out);
}

/* ---- Stage 3: the 3-D lab as a mode, the tools in depth, the overlays, saving. */
// the depth of a world point along the camera's view (its distance from the plane through the eye square to the view)
const DEPTH = `(x, y, z) => { cam3Update(); return (x - C3.ex) * C3.fx + (y - C3.ey) * C3.fy + (z - C3.ez) * C3.fz; }`;
async function stage3(page, clip, errors) {
  const px = (fx, fy) => [clip.x + clip.width * fx, clip.y + clip.height * fy];
  const drag = async (a, b, steps = 8, opts = {}) => { await page.mouse.move(a[0], a[1]); await page.mouse.down(opts); for (let i = 1; i <= steps; i++) await page.mouse.move(a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps); await page.mouse.up(opts); await page.waitForTimeout(60); };

  // every 3-D setup builds and runs 200 steps in the page, finite, without errors; the setup list shows the 3-D ones
  const runs = await page.evaluate(() => {
    const out = {};
    for (const [k, P] of Object.entries(PRESETS)) {
      if (!P.d3) continue;
      loadPreset(k); setRunning(false); render(W.rt);
      const n0 = W.parts.length, t0 = performance.now();
      for (let i = 0; i < 200; i++) { if (W.fSpawn !== W.spawned) { forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = chooseDt(); step(W.dt); }
      const ms = (performance.now() - t0) / 200; render(W.rt);
      const opts = [...document.querySelectorAll('#preset option')].map(o => o.value).filter(v => v !== '__mine');
      out[k] = { d3: W.d3, n0, n: W.parts.filter(p => !p.dead).length, ok: W.parts.every(p => p.dead || [p.x, p.y, p.z, p.vx, p.vy, p.vz].every(Number.isFinite)), inBox: W.parts.every(p => p.dead || Math.abs(p.z) <= W.box.d / 2 + 1),
        T: Math.round(measure().T), ms: +ms.toFixed(2), listAll3d: opts.length >= 5 && opts.every(v => PRESETS[v] && PRESETS[v].d3), leave: !$('tag3d').hidden && !$('bLeave3d') };
    }
    return out;
  });
  const rk = Object.keys(runs);
  console.log('  3-D setups, 200 steps each in the page: ' + rk.map(k => `${k} ${runs[k].n0} atoms ${runs[k].ms} ms/step ${runs[k].T} K`).join('; '));
  check(rk.length >= 5 && rk.every(k => runs[k].d3 && runs[k].ok && runs[k].inBox && runs[k].listAll3d && runs[k].leave) && rk.filter(k => runs[k].n0 >= 500).every(k => runs[k].n0 <= 1500) && errors.length === 0,
    `every 3-D setup (${rk.length}) builds and runs 200 steps, finite and inside its box; the setup list shows only 3-D setups, with the Preview label (no Leave button: 1.23.2) beside it`, runs);

  // Place: on the plane through the camera's target square to the view, under the pointer; over an atom, at its depth
  const pl = await page.evaluate((DEPTH) => {
    const depth = (0, eval)(DEPTH);
    loadPreset('d3empty'); setRunning(false); R.cam3.yaw = 0.9; R.cam3.pitch = -0.5; R.cam3.tx = 2; R.cam3.ty = -1; R.cam3.tz = 3; setTool('place'); UI.spec = { kind: 'atom', Z: 6, A: 12 }; OPT.place.count = 1; render(W.rt);
    const far = addAtom('Ar', -6, 4, { z: -8, T: 0 }); render(W.rt); const o = [0, 0, 0]; proj3(far.x, far.y, far.z, o);
    return { tgt: depth(R.cam3.tx, R.cam3.ty, R.cam3.tz), far: [o[0], o[1]], farD: depth(far.x, far.y, far.z) };
  }, DEPTH);
  const n0 = await page.evaluate(() => W.parts.length);
  const tp = px(0.42, 0.55);
  await page.mouse.click(tp[0], tp[1]); await page.waitForTimeout(80);
  await page.mouse.click(clip.x + pl.far[0], clip.y + pl.far[1]); await page.waitForTimeout(80);
  const placed = await page.evaluate(([DEPTH, n0, sx, sy]) => {
    const depth = (0, eval)(DEPTH), a = W.parts[n0], b = W.parts[n0 + 1], o = [0, 0, 0]; proj3(a.x, a.y, a.z, o);
    return { n: W.parts.length - n0, Z: [a.Z, b && b.Z], off: Math.hypot(o[0] - sx, o[1] - sy), dA: depth(a.x, a.y, a.z), dB: b ? depth(b.x, b.y, b.z) : null, zB: b ? b.z : null, sep: b ? Math.hypot(b.x + 6, b.y - 4, b.z + 8) : null };
  }, [DEPTH, n0, tp[0] - clip.x, tp[1] - clip.y]);
  console.log(`  Place: at ${placed.off.toFixed(2)} px from the click, ${placed.dA.toFixed(3)} Å deep (the target plane ${pl.tgt.toFixed(3)}); clicked on an Ar ${pl.farD.toFixed(2)} Å deep: the C went ${placed.dB.toFixed(2)} Å deep, ${placed.sep.toFixed(2)} Å from it`);
  check(placed.n === 2 && placed.off < 2 && Math.abs(placed.dA - pl.tgt) < 0.01 && Math.abs(placed.dB - pl.farD) < 4 && placed.sep < 4.5 && placed.sep > 1, 'Place: a click puts the atom under the pointer on the target plane; a click on an atom puts it beside that atom, at its depth', [pl, placed]);

  // Grab: with the view turned a quarter (looking along −x), a drag across the screen moves the atom in z
  const g0 = await page.evaluate(() => {
    baseWorld(30, 30, 300, 0.05); world3d(30); mode3dSync(); setRunning(false); R.cam3.yaw = Math.PI / 2; R.cam3.pitch = 0; R.cam3.tx = R.cam3.ty = R.cam3.tz = 0; R.cam3.dist = 60; setTool('grab'); OPT.grab.mol = true;
    const p = addAtom('Ar', 0, 0, { z: 0, T: 0 }); p.vx = p.vy = p.vz = 0; render(W.rt); const o = [0, 0, 0]; proj3(0, 0, 0, o); return { at: [o[0], o[1]], id: p.id, s: R.s };
  });
  await drag([clip.x + g0.at[0], clip.y + g0.at[1]], [clip.x + g0.at[0] + 90, clip.y + g0.at[1]], 9);
  const g1 = await page.evaluate((id) => { const p = W.parts.find(q => q.id === id); return [p.x, p.y, p.z]; }, g0.id);
  // and running, the grab spring pulls it toward a point in depth (the engine's force in z)
  const g2 = await page.evaluate((id) => { const p = W.parts.find(q => q.id === id); const z0 = p.z; W.grab = { p, x: p.x, y: p.y, z: p.z + 5, s: 'strong' }; for (let i = 0; i < 300; i++) { W.dt = chooseDt(); step(W.dt); } const r = { z0, z1: p.z, x: p.x }; W.grab = null; return r; }, g0.id);
  console.log(`  Grab (paused), view along −x, dragged 90 px right: Ar moved to (${g1.map(v => v.toFixed(2)).join(', ')}) (expected z ≈ ${(-90 / g0.s).toFixed(2)}); running, pulled 5 Å deeper: z ${g2.z0.toFixed(2)} → ${g2.z1.toFixed(2)}`);
  check(Math.abs(g1[2] + 90 / g0.s) < 0.5 && Math.abs(g1[0]) < 0.3 && Math.abs(g1[1]) < 0.3 && g2.z1 - g2.z0 > 3, 'Grab: a drag across the turned view moves the atom in z; the grab spring acts in z', [g0, g1, g2]);

  // Select box: the atoms whose centres are drawn inside the rectangle
  await page.evaluate(() => { loadPreset('mol3d'); setRunning(false); setTool('select'); OPT.select.whole = false; clearSelection(); render(W.rt); });
  const a = px(0.35, 0.3), b = px(0.6, 0.65);
  await drag(a, b, 8);
  const sel = await page.evaluate(([x0, y0, x1, y1]) => { const o = [0, 0, 0], want = W.parts.filter(p => !p.dead && proj3(p.x, p.y, p.z, o) && o[0] >= x0 && o[0] <= x1 && o[1] >= y0 && o[1] <= y1); return { want: want.length, got: R.msel.size, same: want.every(p => R.msel.has(p)) }; }, [a[0] - clip.x, a[1] - clip.y, b[0] - clip.x, b[1] - clip.y]);
  check(sel.want > 3 && sel.got === sel.want && sel.same, `Select: a box catches the ${sel.got} atoms drawn inside it (${sel.want} expected)`, sel);

  // Measure: two atoms 8 Å apart, mostly in depth, and the angle at a third (in space, not on the screen)
  const ms = await page.evaluate(() => {
    baseWorld(30, 30, 300, 0); world3d(30); mode3dSync(); setRunning(false); R.cam3.yaw = 0.3; R.cam3.pitch = 0.2; R.cam3.tx = R.cam3.ty = R.cam3.tz = 0; R.cam3.dist = 50; setTool('measure');
    const P = [addAtom('Ar', 1, 0, { z: -4, T: 0 }), addAtom('Ar', 0, 0, { z: 4, T: 0 }), addAtom('Ar', 6, 0, { z: 4, T: 0 })]; render(W.rt);
    return P.map(p => { const o = [0, 0, 0]; proj3(p.x, p.y, p.z, o); return [o[0], o[1]]; });
  });
  for (const [x, y] of ms) { await page.mouse.click(clip.x + x, clip.y + y); await page.waitForTimeout(40); }
  const mr = await page.evaluate(() => { const m = R.measure || []; render(W.rt); return { n: m.length, d: m.length >= 2 ? measureDist(m[0], m[1]) : null, ang: m.length >= 3 ? measureAngle(m[0], m[1], m[2]) : null, screen: m.length >= 2 ? (() => { const o = [0, 0, 0], q = [0, 0, 0]; proj3(m[0].x, m[0].y, m[0].z, o); proj3(m[1].x, m[1].y, m[1].z, q); return Math.hypot(o[0] - q[0], o[1] - q[1]) / R.s; })() : null }; });
  const want = Math.hypot(1, 8), wantAng = Math.acos(1 / Math.hypot(1, 8)) * 180 / Math.PI; // (at (0, 0, 4): to (1, 0, −4) and to (6, 0, 4))
  console.log(`  Measure: ${mr.d && mr.d.toFixed(3)} Å (in space ${want.toFixed(3)}; on the screen it looks ${mr.screen && mr.screen.toFixed(2)} Å), angle ${mr.ang && mr.ang.toFixed(2)}° (${wantAng.toFixed(2)}° expected)`);
  check(mr.n === 3 && Math.abs(mr.d - want) < 0.05 && Math.abs(mr.ang - wantAng) < 0.5, 'Measure: the distance and the angle in space', mr);

  // Erase and Heat: what is drawn under the brush, all the way through; Spark and Fire at the pointer's point in depth
  const eh = await page.evaluate(() => {
    loadPreset('water3d'); setRunning(false); render(W.rt);
    const cx = R.w / 2, cy = R.h / 2, Rb = OPT.erase.R = 3, rpx = Rb * R.s, o = [0, 0, 0];
    const under = W.parts.filter(p => !p.dead && proj3(p.x, p.y, p.z, o) && Math.hypot(o[0] - cx, o[1] - cy) < rpx * 0.9).length; // (well inside the brush: the cone and the drawn circle agree at the target plane)
    const n = eraseHere3(cx, cy);
    // heat: the cone through the middle of the view, 30 steps at 3,000 K, against the atoms outside it
    loadPreset('water3d'); setRunning(false); UI.calm = null; W.gamma = 0.05; render(W.rt);
    const cone = toolCone3(cx, cy, 6); W.tool = { type: 'heat', active: true, x: 0, y: 0, z: 0, R: 6, T: 3000, cone };
    const inside = W.parts.filter(p => inTool3(W.tool, p.x, p.y, p.z));
    for (let i = 0; i < 60; i++) { W.dt = chooseDt(); step(W.dt); }
    W.tool = null;
    const ke = (ps) => ps.reduce((s, p) => s + 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz), 0) / ps.length / (1.5 * PHYS.KB);
    const outside = W.parts.filter(p => !inside.includes(p));
    return { under, erased: n, nIn: inside.length, Tin: Math.round(ke(inside)), Tout: Math.round(ke(outside)), zSpan: Math.max(...inside.map(p => p.z)) - Math.min(...inside.map(p => p.z)) };
  });
  console.log(`  Erase: ${eh.erased} removed under a 3 Å brush (${eh.under} drawn well inside it); Heat: the ${eh.nIn} atoms under a 6 Å brush (through ${eh.zSpan.toFixed(1)} Å of depth) ${eh.Tin} K, the rest ${eh.Tout} K`);
  check(eh.erased >= eh.under && eh.erased > 0 && eh.erased < eh.under * 2 + 10 && eh.Tin > 2 * eh.Tout && eh.zSpan > 10, 'Erase and Heat act on what is drawn under the brush, all the way through the box', eh);
  const sf = await page.evaluate(() => {
    loadPreset('combustion3d'); setRunning(false); render(W.rt);
    const p = W.parts.find(q => !q.dead && Math.abs(q.z) > 6), o = [0, 0, 0]; proj3(p.x, p.y, p.z, o);
    const [x, y, z] = ptr3(o[0], o[1]); W.flashes.length = 0; setTool('spark'); return { at: [o[0], o[1]], pz: p.z, z, n0: W.flashes.length };
  });
  await page.mouse.click(clip.x + sf.at[0], clip.y + sf.at[1]); await page.waitForTimeout(60);
  const sp = await page.evaluate(() => { const f = W.flashes[W.flashes.length - 1]; return f ? { z: f.z, msg: W.log[W.log.length - 1].text } : null; });
  await page.evaluate(() => { baseWorld(30, 30, 300, 0.05); world3d(30); mode3dSync(); setRunning(false); R.cam3.yaw = Math.PI / 2; R.cam3.pitch = 0; R.cam3.tx = R.cam3.ty = R.cam3.tz = 0; R.cam3.dist = 60; setTool('fire'); OPT.fire.proj = 'e'; OPT.fire.s = 300; buildToolOpts(); render(W.rt); });
  await drag(px(0.5, 0.5), px(0.6, 0.5), 6);
  const fr = await page.evaluate(() => { const e = W.parts.find(p => p.k === ELEC); return e ? { v: [e.vx, e.vy, e.vz], KE: 0.5 * e.m * (e.vx * e.vx + e.vy * e.vy + e.vz * e.vz) } : null; });
  console.log(`  Spark on an atom at z ${sf.z.toFixed(2)}: flash at z ${sp && sp.z.toFixed(2)} ("${sp && sp.msg}"); Fire, view along −x, aimed right: electron velocity (${fr && fr.v.map(v => v.toFixed(2)).join(', ')}) Å/tu, ${fr && fr.KE.toFixed(1)} eV`);
  check(sp && Math.abs(sp.z - sf.z) < 1e-6 && Math.abs(sf.z) > 1 && fr && fr.v[2] < -0.9 * Math.hypot(...fr.v) && Math.abs(fr.KE - 10) < 0.5, 'Spark acts at the atom under the pointer, in depth; Fire aims in the plane facing the view (a drag right with the view along −x fires toward −z)', [sf, sp, fr]);

  // what is not in 3-D yet is disabled, with a note
  const dis = await page.evaluate(() => {
    const t = (id) => { const b = document.querySelector(`.tool[data-tool="${id}"]`); return { no3d: b.classList.contains('no3d'), aria: b.getAttribute('aria-disabled'), title: b.title }; };
    setTool('inspect'); setTool('objects'); const still = UI.tool;
    const pal = [...document.querySelectorAll('#palette .chip')].map(b => b.textContent.trim());
    return { magnet: t('magnet'), objects: t('objects'), light: t('light'), place: t('place'), still, bSlider: $('bSlider').disabled, boxSlider: $('boxSlider').disabled, bo: [...$('segBo').querySelectorAll('button')].map(b => b.disabled).join(), pi: [...$('segPi').querySelectorAll('button')].some(b => b.disabled),
      wave: [...$('segWave').querySelectorAll('button')].some(b => b.disabled), qeq: [...$('segQeq').querySelectorAll('button')].some(b => b.disabled), ultra: $('setUltra').disabled, notes: ['fields3dNote', 'set3dNote', 'box3dNote'].every(id => !$(id).hidden),
      gamma: pal.some(x => /^γ/.test(x) || /Light ▾/.test(x)), antiP: pal.some(x => x === 'p̄'), pbarOK: spec3dOK({ kind: 'pbar' }), molOK: spec3dOK({ kind: 'mol', mol: 'H2O' }) };
  });
  console.log(`  not in 3-D yet: Objects ${dis.objects.title}; pressing Objects leaves the tool ${dis.still}; Magnet ${dis.magnet.no3d}, Light ${dis.light.no3d} (1.24: in 3-D)`);
  check(dis.objects.no3d && dis.objects.aria === 'true' && /Not in 3-D yet/.test(dis.objects.title) && !dis.magnet.no3d && !dis.light.no3d && !dis.place.no3d && dis.still === 'inspect' && !dis.bSlider && !dis.boxSlider && dis.bo === 'false,true,false' && !dis.pi && !dis.wave && !dis.qeq && !dis.ultra && dis.notes && dis.gamma && !dis.antiP && !dis.pbarOK && dis.molOK,
    'what does not work in 3-D yet is disabled with "Not in 3-D yet": Objects, bond orders from the positions, antimatter in the particle bar; Magnet, Light, fields, the box size, light and the rest of the Experimental tab work (1.24)', dis);

  // saving: a 3-D world round-trips through the save format (z and vz to 1e-9), through a share code, undo and the autosave
  const sv = await page.evaluate(async () => {
    loadPreset('mol3d'); setRunning(false); for (let i = 0; i < 30; i++) { W.dt = chooseDt(); step(W.dt); }
    R.cam3.yaw = 1.1; R.cam3.dist = 44;
    const before = W.parts.filter(p => !p.dead).map(p => [p.x, p.y, p.z, p.vz]), nb = W.bonds.length, cam = { ...R.cam3 };
    const d = JSON.parse(JSON.stringify(worldToJSON()));
    const r = worldFromJSON(d), after = W.parts.map(p => [p.x, p.y, p.z, p.vz]);
    let dz = 0, dvz = 0, dxy = 0; before.forEach((b, i) => { dz = Math.max(dz, Math.abs(b[2] - after[i][2])); dvz = Math.max(dvz, Math.abs(b[3] - after[i][3])); dxy = Math.max(dxy, Math.abs(b[0] - after[i][0]), Math.abs(b[1] - after[i][1])); });
    const share = await shareDecode(await shareEncode(worldToJSON())); const shareOK = !!share && share.v === 2 && share.d3 && share.d3.z.length === share.parts.length;
    // undo: place a molecule, undo it, still 3-D
    const n0 = W.parts.length; undoMark('Place'); placeSpec({ kind: 'mol', mol: 'CH4' }, 0, 0, 1, 8); const n1 = W.parts.length; undoStep(-1);
    const undo = { n0, n1, n2: W.parts.filter(p => !p.dead).length, d3: W.d3, zs: W.parts.some(p => Math.abs(p.z) > 1) };
    // autosave and Continue: the camera too
    SET.autosave = true; R.cam3.yaw = 0.77; autosave(); loadPreset('empty'); const cont = restoreAutosave();
    return { r, v: d.v, depth: d.d3 && d.d3.depth, n: before.length, nb, nb2: W.bonds.length, dz, dvz, dxy, shareOK, undo, cont, d3: W.d3, yaw: R.cam3.yaw, preset: UI.preset, undoOK: undoOK() };
  });
  console.log(`  save: version ${sv.v}, depth ${sv.depth} Å, ${sv.n} particles, z back to ${sv.dz.toExponential(1)} Å, vz to ${sv.dvz.toExponential(1)}, x and y to ${sv.dxy.toExponential(1)}; share code ${sv.shareOK}; undo ${sv.undo.n0} → ${sv.undo.n1} → ${sv.undo.n2}; Continue: 3-D ${sv.d3}, camera yaw ${sv.yaw}`);
  check(sv.v === 2 && sv.depth === 30 && sv.r.n === sv.n && sv.nb2 === sv.nb && sv.dz < 1e-9 && sv.dvz < 1e-9 && sv.dxy < 1e-6 && sv.shareOK && sv.undoOK && sv.undo.n1 === sv.undo.n0 + 5 && sv.undo.n2 === sv.undo.n0 && sv.undo.d3 && sv.undo.zs && sv.cont && sv.d3 && sv.yaw === 0.77 && sv.preset === 'mol3d',
    'a 3-D world saves and loads (z and vz to 1e-9), shares, undoes and carries on from the autosave with its camera', sv);
  // an old flat save (0.64.0's fixture) still opens, flat
  const old = await page.evaluate((txt) => { const all = JSON.parse(txt), e = all.water || Object.values(all)[0], w = e.d || e; const r = worldFromJSON(w); return { r: typeof r === 'string' ? r : r.n, d3: W.d3, depth: W.box.d, z0: W.parts.every(p => p.z === 0), list: !!document.querySelector('#preset option[value="water"]') }; }, require('fs').readFileSync(path.join(__dirname, 'fixtures', 'worlds-0.64.0.json'), 'utf8'));
  check(typeof old.r === 'number' && old.r > 0 && !old.d3 && old.depth === 0 && old.z0 && old.list, `an old flat save (0.64.0) opens flat (${old.r} particles), with the flat setup list`, old);

  // Out of 3-D through the main menu (the Leave button went in 1.23.2): 2-D, then a flat setup; the flat game back (its setups, its tools)
  await page.evaluate(() => { loadPreset('water'); loadPreset('combustion3d'); showMainMenu(); });
  await page.waitForTimeout(150);
  await page.evaluate(() => $('mmMode2d').click()); await page.waitForTimeout(150); // (the menu's buttons move as it comes in: clicked from the page)
  await page.evaluate(() => { mmSetups(); }); await page.waitForTimeout(100);
  await page.evaluate(() => document.querySelector('#mmList [data-mmp="water"]').click()); await page.waitForTimeout(250);
  const lv = await page.evaluate(() => ({ d3: W.d3, preset: UI.preset, hidden: $('tag3d').hidden && !$('bLeave3d'), magnet: document.querySelector('.tool[data-tool="magnet"]').classList.contains('no3d'), bSlider: $('bSlider').disabled, has2d: !!document.querySelector('#preset option[value="soup"]'), has3d: !!document.querySelector('#preset option[value="water3d"]'), bo: [...$('segBo').querySelectorAll('button')].some(b => b.disabled) }));
  check(!lv.d3 && lv.preset === 'water' && lv.hidden && !lv.magnet && !lv.bSlider && lv.has2d && !lv.has3d && !lv.bo, `out of 3-D by the main menu (2-D, then ${lv.preset}): the flat list and every tool, no Preview label`, lv);
}

/* The main menu: it opens on the choice of 2-D or 3-D; 3-D leads to the 3-D lab's menu, which lists the 3-D setups
   (only) and starts one; 2-D leads to the flat game's menu, whose setup list keeps the flat ones (and has no 3-D entry). */
async function menu3d() {
  const { browser, page, errors } = await openPage({ menu: true, settle: 900 });
  const r0 = await page.evaluate(() => { const b = $('mmMode3d'); return { menu: UI.menu, choose: !$('mmChoose').hidden, shown: !!b && b.offsetParent !== null, text: b ? b.textContent.trim() : '' }; });
  await page.evaluate(() => $('mmMode3d').click()); await page.waitForTimeout(300);
  const list = await page.evaluate(() => [...document.querySelectorAll('#mmList3 [data-mmp]')].map(b => b.dataset.mmp)), all3d = await page.evaluate((l) => l.every(k => PRESETS[k] && PRESETS[k].d3), list);
  await page.evaluate(() => document.querySelector('#mmList3 [data-mmp="water3d"]').click()); await page.waitForTimeout(400);
  const r1 = await page.evaluate(() => ({ menu: UI.menu, d3: W.d3, preset: UI.preset, opts: [...document.querySelectorAll('#preset option')].map(o => o.value).filter(v => v !== '__mine'), label: document.querySelector('#preset optgroup:last-child').label }));
  await page.evaluate(() => showMainMenu()); await page.waitForTimeout(300);
  await page.evaluate(() => mmAction('mode2d')); await page.waitForTimeout(200);
  const no3d = await page.evaluate(() => ![...document.querySelectorAll('#mmBtns .btn')].some(b => /3-D lab/.test(b.textContent) && b.offsetParent !== null));
  await page.evaluate(() => mmAction('setups')); await page.waitForTimeout(200);
  const flat = await page.evaluate(() => { const list = [...document.querySelectorAll('#mmList [data-mmp]')].map(b => b.dataset.mmp); return { d3: W.d3, list, any3d: list.some(k => PRESETS[k].d3) }; });
  await browser.close();
  console.log(`  main menu: "${r0.text}"; the 3-D menu lists ${list.join(', ')}; chose Liquid water: 3-D ${r1.d3}, setup list "${r1.label}" (${r1.opts.length})`);
  check(r0.menu && r0.choose && r0.shown && /3-D/.test(r0.text) && /Preview/i.test(r0.text) && list.length === 6 && all3d && !r1.menu && r1.d3 && r1.preset === 'water3d' && r1.opts.length === list.length && /preview/i.test(r1.label)
    && no3d && !flat.d3 && flat.list.length > 20 && !flat.any3d && errors.length === 0, 'the main menu offers 3-D (Preview), whose menu lists and starts the six 3-D setups; the 2-D menu has no 3-D entry and its list keeps the flat ones', { r0, list, r1, no3d, flat: flat.list.length, errors });
}

(async () => {
  const t0 = Date.now();
  await menu3d();
  const { browser, page, errors } = await openPage({ settle: 800 });
  await page.addStyleTag({ content: '#fpsBadge, #hint, #tooloptsHS, #paletteBar { visibility: hidden !important; }' }); // (a frame rate and a note that change between shots; the particle bar over the chamber, whose scroll can sit a pixel apart after the main menu (1.23.2: t_3d leaves 3-D through it): the drawing is what is compared)
  const clip = await page.evaluate(() => { const b = document.getElementById('cv').getBoundingClientRect(); return { x: b.left, y: b.top, width: Math.floor(b.width), height: Math.floor(b.height) }; });
  const shot = () => page.screenshot({ clip });

  // a 2-D world's frame, to compare with after the 3-D one
  const flat = await page.evaluate(() => { R.view.hbonds = false; loadPreset('water'); const d = worldToJSON(); worldFromJSON(d); setRunning(false); fitView(); GL.on = true; render(W.rt); R.view.hbonds = true; return { d, s: R.s }; }); // (hydrogen bonds off: their dashes move with the clock)
  const flatPng = await shot();

  // the preview setup: a 3-D world, drawn by both paths
  const pre = await page.evaluate(() => {
    loadPreset('mol3d'); setRunning(false);
    const opt = [...document.querySelectorAll('#preset option')].find(o => o.value === 'mol3d'); GL.on = true; GL.slots = GL.segs = GL.balls = 0; render(W.rt);
    const f = (Z, nb) => W.parts.filter(p => p.Z === Z && p.bonds.length === nb).length;
    return { listed: opt ? opt.parentElement.label + ': ' + opt.textContent : null, d3: W.d3, depth: W.box.d, n: W.parts.length, bonds: W.bonds.length, gl: R.gl, slots: GL.slots, segs: GL.segs, CH4: f(6, 4), NH3: f(7, 3), H2O: f(8, 2), allZ: W.parts.every(p => Number.isFinite(p.z)), zSpread: Math.max(...W.parts.map(p => p.z)) - Math.min(...W.parts.map(p => p.z)) };
  });
  check(pre.listed && /3-D.*preview/i.test(pre.listed) && pre.d3 && pre.depth === 30 && pre.CH4 === 3 && pre.NH3 === 3 && pre.H2O >= 4 && pre.allZ && pre.zSpread > 10,
    `the preview setup is in the list ("${pre.listed}") and makes a 3-D world: ${pre.n} particles, ${pre.bonds} bonds, depth ${pre.depth} Å, z spread ${pre.zSpread.toFixed(1)} Å`, pre);
  check(pre.gl && pre.slots >= pre.n && pre.segs >= pre.bonds, `the WebGL layer draws it (${pre.slots} slots, ${pre.segs} half-bond lanes)`, pre);
  const glPng = await shot();
  const c2d = await page.evaluate(() => { GL.on = false; render(W.rt); return { gl: R.gl, glShown: GL.cv.style.visibility !== 'hidden' }; });
  const c2dPng = await shot();
  await page.evaluate(() => { GL.on = true; render(W.rt); });
  const mGL = await measure(page, glPng), mC = await measure(page, c2dPng, glPng);
  console.log(`  lit pixels: WebGL ${(100 * mGL.lit).toFixed(2)}%, Canvas 2D ${(100 * mC.lit).toFixed(2)}%; the two frames differ by ${mC.mean.toFixed(3)} on average, ${(100 * mC.off).toFixed(2)}% of pixels by > 24`);
  check(mGL.lit > 0.01 && mC.lit > 0.01 && !c2d.gl && !c2d.glShown, 'both paths draw the chamber (WebGL, and Canvas 2D with the layer hidden)', [mGL, mC, c2d]);
  check(mC.mean < 2 && mC.off < 0.03, 'the WebGL and Canvas 2D frames agree', mC);

  // the camera: a right-drag turns it; the projection is a true perspective
  const persp = `(o) => { // a camera from first principles: eye on the sphere round the target, look-at basis by cross products
    const c = R.cam3, cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nz = (a) => { const l = Math.hypot(...a); return a.map(v => v / l); };
    const eye = [c.tx + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), c.ty + c.dist * Math.sin(c.pitch), c.tz + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw)];
    const f = nz([c.tx - eye[0], c.ty - eye[1], c.tz - eye[2]]), r = nz(cr(f, [0, 1, 0])), u = cr(r, f), d = [o.x - eye[0], o.y - eye[1], o.z - eye[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], F = R.h / 2 / Math.tan(c.fov / 2), z = dot(d, f);
    return [R.w / 2 + F * dot(d, r) / z, R.h / 2 - F * dot(d, u) / z]; }`;
  const before = await page.evaluate((persp) => { const ref = (0, eval)(persp); fitView(); render(W.rt); const p = W.parts.find(q => q.Z === 7), o = [0, 0, 0]; proj3(p.x, p.y, p.z, o); return { yaw: R.cam3.yaw, pitch: R.cam3.pitch, at: [o[0], o[1]], ref: ref(p), id: p.id }; }, persp);
  const cx = clip.x + clip.width / 2, cy = clip.y + clip.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down({ button: 'right' });
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 12, cy + i * 4);
  await page.mouse.up({ button: 'right' }); await page.waitForTimeout(100);
  const after = await page.evaluate(([persp, id]) => { const ref = (0, eval)(persp); render(W.rt); const p = W.parts.find(q => q.id === id), o = [0, 0, 0]; proj3(p.x, p.y, p.z, o); return { yaw: R.cam3.yaw, pitch: R.cam3.pitch, at: [o[0], o[1]], ref: ref(p), menu: !$('qmenu').hidden }; }, [persp, before.id]);
  const moved = Math.hypot(after.at[0] - before.at[0], after.at[1] - before.at[1]), err = Math.max(Math.hypot(before.at[0] - before.ref[0], before.at[1] - before.ref[1]), Math.hypot(after.at[0] - after.ref[0], after.at[1] - after.ref[1]));
  console.log(`  right-drag 120 px across, 40 down: yaw ${before.yaw.toFixed(3)} → ${after.yaw.toFixed(3)}, pitch ${before.pitch.toFixed(3)} → ${after.pitch.toFixed(3)}; an N atom moved ${moved.toFixed(1)} px on the screen; projection within ${err.toExponential(1)} px of a camera built from first principles`);
  check(Math.abs(after.yaw - before.yaw + 0.96) < 0.02 && after.pitch > before.pitch && moved > 5 && err < 0.01 && !after.menu, 'a right-drag orbits the camera (no quick menu), and atoms move on the screen as a perspective camera says', [before, after]);
  const more = await page.evaluate(() => { const c = R.cam3, s0 = { yaw: c.yaw, dist: c.dist, t: [c.tx, c.ty, c.tz] }; return s0; });
  await page.mouse.move(cx, cy); await page.keyboard.down('Alt'); await page.mouse.down(); await page.mouse.move(cx - 50, cy, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Alt');
  const altYaw = await page.evaluate(() => R.cam3.yaw);
  await page.keyboard.down('Shift'); await page.mouse.down({ button: 'right' }); await page.mouse.move(cx + 60, cy + 30, { steps: 5 }); await page.mouse.up({ button: 'right' }); await page.keyboard.up('Shift');
  const panT = await page.evaluate(() => [R.cam3.tx, R.cam3.ty, R.cam3.tz]);
  await page.mouse.move(cx, cy); await page.mouse.wheel(0, -300); await page.waitForTimeout(100);
  const wheelD = await page.evaluate(() => R.cam3.dist);
  await page.keyboard.press('ArrowLeft'); const arrowYaw = await page.evaluate(() => R.cam3.yaw);
  await page.keyboard.press('0'); const fit = await page.evaluate(() => ({ yaw: R.cam3.yaw, pitch: R.cam3.pitch, t: [R.cam3.tx, R.cam3.ty, R.cam3.tz], dist: R.cam3.dist }));
  const panned = Math.hypot(panT[0] - more.t[0], panT[1] - more.t[1], panT[2] - more.t[2]);
  console.log(`  Alt+drag: yaw ${more.yaw.toFixed(3)} → ${altYaw.toFixed(3)}; Shift+right-drag: target moved ${panned.toFixed(2)} Å; wheel: distance ${more.dist.toFixed(1)} → ${wheelD.toFixed(1)} Å; ←: yaw ${arrowYaw.toFixed(3)}; 0: yaw ${fit.yaw}, distance ${fit.dist.toFixed(1)} Å`);
  check(altYaw > more.yaw + 0.3 && panned > 1 && wheelD < more.dist * 0.8 && Math.abs(arrowYaw - altYaw - 0.096) < 1e-6 && fit.yaw === 0.6 && fit.pitch === 0.4 && fit.t.every(v => v === 0),
    'Alt+drag orbits, Shift+right-drag pans, the wheel zooms, the arrow keys orbit, 0 fits the box again', { more, altYaw, panT, wheelD, arrowYaw, fit });

  // picking: the atom under the pointer; of two on one line of sight, the nearer one; the mouse's click and hover too
  const pick = await page.evaluate(() => {
    baseWorld(30, 30, 300, 0); world3d(30); fitView(); setRunning(false);
    const far = addAtom('Ar', 0, 0, { z: 0, T: 0 }), C = R.cam3; cam3Update();
    const k = 6 / C.dist, near = addAtom('Kr', (C3.ex - C.tx) * k, (C3.ey - C.ty) * k, { z: (C3.ez - C.tz) * k, T: 0 }); // (6 Å nearer the camera, on the line of sight)
    const side = addAtom('Ne', 8, -6, { z: 5, T: 0 });
    render(W.rt);
    const o = [0, 0, 0]; proj3(far.x, far.y, far.z, o); const pf = [o[0], o[1]]; proj3(near.x, near.y, near.z, o); const pn = [o[0], o[1]]; proj3(side.x, side.y, side.z, o); const ps = [o[0], o[1]];
    return { pf, pn, ps, line: Math.hypot(pf[0] - pn[0], pf[1] - pn[1]), atCentre: pickAt(pf[0], pf[1]) === near, side: pickAt(ps[0], ps[1]) === side, ids: [far.id, near.id, side.id] };
  });
  await page.evaluate(() => setTool('inspect'));
  await page.mouse.click(clip.x + pick.pf[0], clip.y + pick.pf[1]); await page.mouse.move(clip.x + pick.pf[0] + 1, clip.y + pick.pf[1]); await page.waitForTimeout(100);
  const clicked = await page.evaluate(() => ({ sel: R.sel && R.sel.id, hover: R.hover && R.hover.id }));
  const pick2 = await page.evaluate(([fid, nid]) => { const near = W.parts.find(p => p.id === nid), far = W.parts.find(p => p.id === fid); kill(near); render(W.rt); const o = [0, 0, 0]; proj3(far.x, far.y, far.z, o); return pickAt(o[0], o[1]) === far; }, pick.ids);
  console.log(`  two atoms ${pick.line.toFixed(2)} px apart on the screen, 6 Å apart in depth: picked the nearer (${pick.atCentre}); clicked: ${clicked.sel === pick.ids[1] ? 'the nearer' : clicked.sel}; with it gone, the farther (${pick2}); an atom off to the side (${pick.side})`);
  check(pick.line < 0.01 && pick.atCentre && pick.side && pick2 && clicked.sel === pick.ids[1] && clicked.hover === pick.ids[1], 'picking takes the atom under the pointer nearest the camera (pickAt, Inspect click, hover)', [pick, clicked, pick2]);

  await litBalls(page, clip, shot);

  await stage3(page, clip, errors);

  // the drawing's cost in 3-D against 2-D, for the same molecules (JavaScript time; headless software GL)
  const cost = await page.evaluate(() => {
    const out = {}, time = (f) => { f(); const t0 = performance.now(); for (let i = 0; i < 8; i++) f(); return +((performance.now() - t0) / 8).toFixed(2); };
    for (const d3 of [false, true]) {
      baseWorld(150, 100, 300, 0.05); if (d3) world3d(40);
      for (let i = 0; i < 30; i++) for (let j = 0; j < 20; j++) addMolecule('H2O', -72 + i * 4.9, -47 + j * 4.9, (i * 7 + j) % 6, 300, d3 ? ((i + j) % 4 - 1.5) * 8 : 0); // (the same 600 molecules; in 3-D spread over four depths)
      setRunning(false); fitView();
      GL.on = true; const gl = time(() => render(W.rt)); GL.on = false; const c2 = time(() => render(W.rt)); GL.on = true;
      out[d3 ? 'd3' : 'flat'] = { n: W.parts.length, gl, c2d: c2 };
    }
    return out;
  });
  console.log(`  drawing ${cost.flat.n} atoms (waters): 2-D ${cost.flat.gl} ms with WebGL, ${cost.flat.c2d} ms Canvas 2D; 3-D ${cost.d3.gl} ms with WebGL, ${cost.d3.c2d} ms Canvas 2D (${cost.d3.n} atoms)`);
  check(cost.d3.n === cost.flat.n && cost.d3.gl < cost.d3.c2d, 'the 3-D view costs less with the WebGL layer than without', cost);

  // two fingers: pinch zooms, a two-finger drag turns (each gesture on a fresh page: headless Chromium now and then
  // delivers no events at all for a second touch gesture soon after a first)
  {
    const tb = await chromium.launch({ headless: true });
    const tctx = await tb.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await tctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await tctx.addInitScript(() => { window.AF_NO_MENU = true; window.AF_NO_PAUSE = true; });
    const terr = [];
    const gesture = async (step) => {
      const tp = await tctx.newPage(); tp.on('pageerror', e => terr.push(e.message));
      await tp.goto('file://' + pageFile()); await tp.waitForTimeout(800);
      await tp.evaluate(() => { loadPreset('mol3d'); setRunning(false); setTool('inspect'); });
      const b = await tp.$eval('#cv', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
      const cdp = await tctx.newCDPSession(tp), mx = b.x + b.w / 2, my = b.y + b.h / 2;
      const touch = async (type, pts) => { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) }); await tp.waitForTimeout(30); }; // (as a hand would: events a frame or two apart)
      const c0 = await tp.evaluate(() => ({ dist: R.cam3.dist, yaw: R.cam3.yaw }));
      await touch('touchStart', [[mx - 40, my], [mx + 40, my]]);
      for (let i = 1; i <= 6; i++) await touch('touchMove', step(mx, my, i));
      await touch('touchEnd', []); await tp.waitForTimeout(200);
      const c1 = await tp.evaluate(() => ({ dist: R.cam3.dist, yaw: R.cam3.yaw }));
      await tp.close();
      return [c0, c1];
    };
    const [p0, p1] = await gesture((mx, my, i) => [[mx - 40 - i * 15, my], [mx + 40 + i * 15, my]]);
    const [d0, d1] = await gesture((mx, my, i) => [[mx - 40 + i * 12, my], [mx + 40 + i * 12, my]]);
    console.log(`  touch: pinch out: distance ${p0.dist.toFixed(1)} → ${p1.dist.toFixed(1)} Å, yaw ${p0.yaw.toFixed(3)} → ${p1.yaw.toFixed(3)}; two-finger drag: yaw ${d0.yaw.toFixed(3)} → ${d1.yaw.toFixed(3)}, distance ${d0.dist.toFixed(1)} → ${d1.dist.toFixed(1)} Å`);
    check(p1.dist < p0.dist * 0.6 && Math.abs(p1.yaw - p0.yaw) < 0.01 && d1.yaw < d0.yaw - 0.3 && Math.abs(d1.dist - d0.dist) < 0.5 && !terr.length, 'two fingers: a pinch zooms, a two-finger drag orbits', { p0, p1, d0, d1, terr });
    await tb.close();
  }

  // back to 2-D: the same world draws the same frame as before the 3-D one
  await page.mouse.move(1, 1); // (no hover ring: the pointer off the chamber, as for the first frame)
  const back = await page.evaluate((d) => { R.hover = null; R.view.hbonds = false; worldFromJSON(d); setRunning(false); fitView(); GL.on = true; render(W.rt); R.view.hbonds = true; return { d3: W.d3, depth: W.box.d, s: R.s, allZ0: W.parts.every(p => p.z === 0) }; }, flat.d);
  const backPng = await shot();
  const mb = await measure(page, backPng, flatPng);
  console.log(`  back in 2-D: the water frame against the one before the 3-D world: mean difference ${mb.mean.toFixed(4)}, ${(100 * mb.off).toFixed(3)}% of pixels off by > 24`);
  check(!back.d3 && back.depth === 0 && back.allZ0 && Math.abs(back.s - flat.s) < 1e-9 && mb.mean === 0 && mb.off === 0, 'a 2-D world afterwards is flat and draws as before', [back, mb]);
  const ld = await page.evaluate(() => { loadPreset('mol3d'); loadPreset('empty'); return W.d3; });
  check(ld === false, 'choosing another setup makes the world flat again');

  // 1.23.1+: ionic contacts and hydrogen bonds hidden behind nearer atoms (they were drawn over every atom): an ion pair
  // with an argon atom in front of part of its contact; no drawn point of the line lies on the argon or on either
  // ion (their balls are in front of the line there), and the line still shows between them
  const occ = await page.evaluate(() => {
    loadPreset('d3empty'); setRunning(false);
    // (the view square to the pair: the line keeps one depth, so wherever it crosses an ion's disc it is inside the ball)
    const na = addAtom('Na', -1.7, 0, { charge: 1, z: 0, T: 0 }), cl = addAtom('Cl', 1.7, 0, { charge: -1, z: 0, T: 0 }), ar = addAtom('Ar', 0, 0.45, { z: 3, T: 0 });
    Object.assign(R.cam3, { tx: 0, ty: 0, tz: 0, yaw: 0, pitch: 0, dist: 12 }); cam3Update();
    R.view.ionic = true; render(W.rt);
    const pts = [], rec = { save() {}, restore() {}, beginPath() {}, stroke() {}, setLineDash() {}, moveTo(x, y) { pts.push([x, y]); }, lineTo(x, y) { pts.push([x, y]); } };
    _occ3.built = false; drawIonic3(rec);
    const V = _pv, on = (p) => pts.filter(([x, y]) => Math.hypot(x - V[4 * p.i], y - V[4 * p.i + 1]) < 0.95 * V[4 * p.i + 3]).length;
    return { ionic: [na.ionic, cl.ionic], pts: pts.length, onNa: on(na), onCl: on(cl), onAr: on(ar), rAr: +V[4 * ar.i + 3].toFixed(1) };
  });
  check(occ.pts > 4 && occ.onNa === 0 && occ.onCl === 0 && occ.onAr === 0, `3-D ionic contact drawn only where no ball is in front (${occ.pts} points; on Na⁺ ${occ.onNa}, Cl⁻ ${occ.onCl}, the argon in front ${occ.onAr})`, occ);

  const errs = errors.filter(e => !/warning/.test(e));
  check(errs.length === 0, 'no page errors', errs.slice(0, 3));
  await browser.close();
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  console.log(fails ? `${fails} 3-D failure(s)` : '3-D checks passed');
  process.exitCode = fails ? 1 : 0;
})();
