'use strict';
/* The 3-D view (stage 2), in headless Chromium: the preview setup makes a 3-D world and draws it with WebGL and with
   Canvas 2D (the two frames alike); the camera turns, pans and zooms from the mouse, the keys and two fingers, and the
   projection is a true perspective (checked against a camera built here from first principles); picking takes the
   atom under the pointer nearest the camera; a placed atom lands under the pointer; saving is refused; a 2-D setup
   afterwards draws exactly as before. Also prints the drawing's cost in 3-D against 2-D for the same atoms.
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
(async () => {
  const t0 = Date.now();
  const { browser, page, errors } = await openPage({ settle: 800 });
  await page.addStyleTag({ content: '#fpsBadge, #hint, #tooloptsHS { visibility: hidden !important; }' }); // (a frame rate and a note that change between shots)
  const clip = await page.evaluate(() => { const b = document.getElementById('cv').getBoundingClientRect(); return { x: b.left, y: b.top, width: Math.floor(b.width), height: Math.floor(b.height) }; });
  const shot = () => page.screenshot({ clip });

  // a 2-D world's frame, to compare with after the 3-D one
  const flat = await page.evaluate(() => { R.view.hbonds = false; loadPreset('water'); const d = worldToJSON(); worldFromJSON(d); setRunning(false); fitView(); GL.on = true; render(W.rt); R.view.hbonds = true; return { d, s: R.s }; }); // (hydrogen bonds off: their dashes move with the clock)
  const flatPng = await shot();

  // the preview setup: a 3-D world, drawn by both paths
  const pre = await page.evaluate(() => {
    const opt = [...document.querySelectorAll('#preset option')].find(o => o.value === 'mol3d');
    loadPreset('mol3d'); setRunning(false); GL.on = true; GL.slots = GL.segs = GL.balls = 0; render(W.rt);
    const f = (Z, nb) => W.parts.filter(p => p.Z === Z && p.bonds.length === nb).length;
    return { listed: opt ? opt.textContent : null, d3: W.d3, depth: W.box.d, n: W.parts.length, bonds: W.bonds.length, gl: R.gl, slots: GL.slots, segs: GL.segs, CH4: f(6, 4), NH3: f(7, 3), H2O: f(8, 2), allZ: W.parts.every(p => Number.isFinite(p.z)), zSpread: Math.max(...W.parts.map(p => p.z)) - Math.min(...W.parts.map(p => p.z)) };
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

  // placing: an atom put down lands under the pointer, on the middle plane, finite
  await page.evaluate(() => { R.cam3.yaw = 0.9; R.cam3.pitch = -0.5; setTool('place'); UI.spec = { kind: 'atom', Z: 6 }; OPT.place.count = 1; render(W.rt); });
  const n0 = await page.evaluate(() => W.parts.length);
  const tx = clip.x + clip.width * 0.42, ty = clip.y + clip.height * 0.55;
  await page.mouse.click(tx, ty); await page.waitForTimeout(100);
  const placed = await page.evaluate(([n0, px, py]) => { const p = W.parts[W.parts.length - 1], o = [0, 0, 0]; proj3(p.x, p.y, p.z, o); return { n: W.parts.length - n0, Z: p.Z, xyz: [p.x, p.y, p.z], off: Math.hypot(o[0] - px, o[1] - py) }; }, [n0, tx - clip.x, ty - clip.y]);
  console.log(`  placed ${placed.n} (Z ${placed.Z}) at (${placed.xyz.map(v => v.toFixed(2)).join(', ')}), ${placed.off.toFixed(2)} px from the click`);
  check(placed.n >= 1 && placed.xyz.every(Number.isFinite) && Math.abs(placed.xyz[2]) < 0.5 && placed.off < 3, 'a placed atom lands under the pointer on the middle plane (finite)', placed);

  // saving is refused with a note; undo keeps nothing; the autosave keeps the setup's name
  const save = await page.evaluate(() => { const n = W.log.length; saveWorld(); const msg = W.log.length > n ? W.log[W.log.length - 1].text : ''; return { msg, undo: undoOK() }; });
  check(/3-D/.test(save.msg) && !save.undo, `saving a 3-D world is refused ("${save.msg}"), undo and rewind keep nothing`, save);

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

  const errs = errors.filter(e => !/warning/.test(e));
  check(errs.length === 0, 'no page errors', errs.slice(0, 3));
  await browser.close();
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  console.log(fails ? `${fails} 3-D failure(s)` : '3-D checks passed');
  process.exitCode = fails ? 1 : 0;
})();
