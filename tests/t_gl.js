'use strict';
/* The WebGL layer of the renderer (gl.js) against the Canvas 2D drawing, in headless Chromium: for several worlds the
   two frames agree pixel for pixel but for edge anti-aliasing (the same balls, glows and bonds), the layer draws the
   things it should, the Drawing setting switches it, a zoomed-in (Bohr) view and the other view modes draw without
   errors, and the layer is far cheaper to drive. */
const path = require('path'), fs = require('fs');
const { openPage } = require(path.join(__dirname, 'browser.js'));
let fails = 0;
const check = (ok, what, detail) => { if (ok) console.log('  ' + what); else { fails++; console.log('FAIL ' + what + (detail !== undefined ? ': ' + JSON.stringify(detail) : '')); } };
/* Two screenshots compared in the page itself (decoded into canvases): the mean absolute difference and the share of
   pixels off by more than 24 in some channel. */
async function diffPng(page, a, b) {
  return page.evaluate(async ([a, b]) => {
    const load = (b64) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = 'data:image/png;base64,' + b64; });
    const [A, B] = await Promise.all([load(a), load(b)]);
    const px = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height).data; };
    const pa = px(A), pb = px(B), n = A.width * A.height; let sum = 0, off = 0;
    for (let i = 0; i < n * 4; i += 4) { let m = 0; for (let c = 0; c < 3; c++) { const d = Math.abs(pa[i + c] - pb[i + c]); sum += d; if (d > m) m = d; } if (m > 24) off++; }
    return { mean: sum / (n * 3), offShare: off / n, w: A.width, h: A.height };
  }, [a.toString('base64'), b.toString('base64')]);
}
(async () => {
  const { browser, page, errors } = await openPage({ settle: 800 });
  const info = await page.evaluate(() => ({ ok: GL.ok, note: GL.note, on: GL.on, setting: SET.gl }));
  console.log('gl:', JSON.stringify(info));
  check(info.ok && info.on, 'WebGL 2 layer available and on', info);
  const dir = path.join(__dirname, '.tmp'); fs.mkdirSync(dir, { recursive: true });
  const clip = await page.evaluate(() => { const b = document.getElementById('cv').getBoundingClientRect(); return { x: b.left, y: b.top, width: Math.floor(b.width), height: Math.floor(b.height) }; });
  for (const preset of ['water', 'flashbyte', 'salt', 'flame', 'antihydrogen']) {
    const counts = await page.evaluate((preset) => { loadPreset(preset); setRunning(false); fitView(); GL.balls = GL.glows = GL.segs = 0; GL.on = true; render(W.rt); return { balls: GL.balls, glows: GL.glows, segs: GL.segs, parts: W.parts.length, bonds: W.bonds.length }; }, preset);
    const fa = path.join(dir, `gl_${preset}.png`), fb = path.join(dir, `c2d_${preset}.png`);
    await page.screenshot({ path: fa, clip });
    await page.evaluate(() => { GL.on = false; render(W.rt); });
    await page.screenshot({ path: fb, clip });
    await page.evaluate(() => { GL.on = true; });
    const d = await diffPng(page, fs.readFileSync(fa), fs.readFileSync(fb));
    console.log(`  ${preset}: ${counts.balls} balls, ${counts.glows} glows, ${counts.segs} segments on the layer (${counts.parts} particles, ${counts.bonds} bonds); mean difference ${d.mean.toFixed(3)}, ${(100 * d.offShare).toFixed(2)}% of pixels off by > 24`);
    check(d.mean < 1.5 && d.offShare < 0.05, `${preset}: WebGL and Canvas 2D frames agree`, d);
    check(counts.balls >= counts.parts * 0.5 && (counts.bonds === 0 || counts.segs >= counts.bonds), `${preset}: the layer draws the balls and bonds`, counts);
  }
  // the other views and a zoomed-in Bohr view draw with the layer on, without errors
  const views = await page.evaluate(() => {
    loadPreset('water'); setRunning(false); fitView(); const out = {};
    for (const bohr of ['auto', 'on', 'nuc', 'orb']) { R.view.bohr = bohr; render(W.rt); out[bohr] = GL.balls; }
    R.view.bohr = 'auto'; R.s = 60; render(W.rt); out.zoomed = true; fitView();
    for (const color of ['charge', 'heat', 'element']) { R.view.color = color; render(W.rt); }
    setSetting('gl', '2d'); render(W.rt); out.offBySetting = !GL.on && !R.gl; setSetting('gl', 'gl'); render(W.rt); out.onBySetting = GL.on && R.gl;
    return out;
  });
  console.log('views:', JSON.stringify(views));
  check(views.offBySetting && views.onBySetting, 'the Drawing setting switches the layer off and on');
  // cost: the 12,000-atom world drawn with the layer and without, JavaScript time only
  const cost = await page.evaluate(() => {
    setSetting('perf', true); baseWorld(560, 360, 300, 0.05); const nx = 80, ny = 50, dx = 560 / nx, dy = 360 / ny;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { if (W.parts.length + 3 > 12000) break; addMolecule('H2O', -280 + (i + 0.5) * dx + (Math.random() - 0.5) * 0.4, -180 + (j + 0.5) * dy + (Math.random() - 0.5) * 0.4, Math.random() * 6, 300); }
    settleOverlaps(); fitView(); setRunning(false);
    const time = (f) => { f(); const t0 = performance.now(); for (let i = 0; i < 5; i++) f(); return (performance.now() - t0) / 5; };
    GL.on = true; const gl = time(() => render(W.rt)); GL.on = false; const c2d = time(() => render(W.rt)); GL.on = true;
    return { parts: W.parts.length, gl: +gl.toFixed(1), c2d: +c2d.toFixed(1) };
  });
  console.log('12,000 atoms, a frame\'s drawing: ' + JSON.stringify(cost));
  check(cost.gl < cost.c2d / 3, 'the layer costs less than a third of Canvas 2D to drive (JavaScript time)', cost);
  const errs = errors.filter(e => !/warning/.test(e));
  check(errs.length === 0, 'no page errors', errs.slice(0, 3));
  await browser.close();
  console.log(fails ? `${fails} gl failure(s)` : 'gl checks passed');
  process.exitCode = fails ? 1 : 0;
})();
