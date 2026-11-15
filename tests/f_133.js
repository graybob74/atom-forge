'use strict';
/* The checks for 1.33.0 (the owner, 2026-11-14: "the 3d molecule builder isn't 3d"; the far-face grid in a big 3-D box).
   Run by t_features (one line) or alone: node tests/f_133.js. Each fails on 1.32.0. */
module.exports = async function f133(page, check) {
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ settle: 800 }); page = own.page; }
  await page.setViewportSize({ width: 1400, height: 900 });
  const r = await page.evaluate(async () => { try {
    const raf = () => new Promise(res => requestAnimationFrame(res)), sleep = (ms) => new Promise(res => setTimeout(res, ms)), out = {};
    const ang = (A, B, C) => { const u = [A.x - B.x, A.y - B.y, (A.z || 0) - (B.z || 0)], v = [C.x - B.x, C.y - B.y, (C.z || 0) - (B.z || 0)]; return Math.acos((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / Math.hypot(...u) / Math.hypot(...v)) * 180 / Math.PI; };
    // the builder in the 3-D lab: a chain drawn in space, hydrogens round each carbon, settled and kept in 3-D
    loadPreset('d3empty'); await raf(); openMolBuilder(); await sleep(60); mbClear(); MB.undo.length = 0;
    out.title = $('bldTitle').textContent;
    for (const el of ['C', 'C', 'C', 'O']) mbTapChip({ t: 'el', el });
    out.drawn = { ang: ang(MB.atoms[0], MB.atoms[1], MB.atoms[2]), zr: Math.max(...MB.atoms.map(a => a.z)) - Math.min(...MB.atoms.map(a => a.z)) };
    const mol = mbAssemble(), c0 = mol.atoms[0], hs = mol.bonds.filter(b => b[0] === 0 && mol.atoms[b[1]].el === 'H').map(b => mol.atoms[b[1]]);
    out.hAng = hs.length === 3 ? ang(hs[0], c0, hs[1]) : 0;
    mbTidy(); out.tidy = ang(MB.atoms[0], MB.atoms[1], MB.atoms[2]);
    const t0 = MB.R.slice(); const cv = $('bldCv').getBoundingClientRect();
    out.turnDrag = [cv.left + 30, cv.top + cv.height - 60];
    $('bldName').value = 'f133 propanol'; mbBuild(); await sleep(80);
    const M = Object.values(MOLECULES).find(m => m.name === 'f133 propanol');
    out.mol = M ? { mode: M.mode, n: M.atoms.length, zr: Math.max(...M.z) - Math.min(...M.z) } : null;
    out.saved = JSON.parse(store('mymols') || '[]').some(m => m.n === 'f133 propanol' && Array.isArray(m.z) && m.z.length === m.a.length);
    if (M) { const ats = addMolecule(M.key, 0, 0, 0, 0, 0); out.placed = Math.max(...ats.map(p => p.z)) - Math.min(...ats.map(p => p.z)); myMolRemove(M.key); }
    out.t0 = t0;
    // the far faces' grid in a 20 000 Å box, close in
    loadPreset('d3empty'); W.box.w = W.box.h = W.box.d = W.box.tw = W.box.th = W.box.td = 20000; R.view.grid = true; R.cam3.dist = 30; R.cam3.tx = R.cam3.ty = R.cam3.tz = 0; cam3Update();
    for (let i = 0; i < 4; i++) await raf();
    const c = $('cv'), t2 = document.createElement('canvas'); t2.width = c.width; t2.height = c.height; const x = t2.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height); layersInto(x, c.width, c.height);
    const d = x.getImageData(0, 0, c.width, c.height).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]; out.grid = sum / (d.length / 4) / 3;
    return out;
  } catch (e) { return { err: e.message + ' ' + (e.stack || '').split('\n')[1] }; } });
  if (r.err) { check(false, '', '1.33 page: ' + r.err); if (own) await own.browser.close(); return; }
  // a drag on empty space turns the view
  await page.mouse.move(r.turnDrag[0], r.turnDrag[1]); await page.evaluate(() => { openMolBuilder(); mbTapChip({ t: 'el', el: 'C' }); });
  const cvr = await page.evaluate(() => { const b = $('bldCv').getBoundingClientRect(); return [b.left + 40, b.top + b.height / 2]; });
  const R0 = await page.evaluate(() => MB.R.slice());
  await page.mouse.move(cvr[0], cvr[1]); await page.mouse.down(); await page.mouse.move(cvr[0] + 60, cvr[1] + 20, { steps: 4 }); await page.mouse.up();
  const R1 = await page.evaluate(() => { const o = MB.R.slice(); mbClear(); $('bldClose').click(); return o; });
  const turned = R0.some((v, i) => Math.abs(v - R1[i]) > 0.05);
  if (own) await own.browser.close();
  check(/3-D/.test(r.title) && Math.abs(r.drawn.ang - 109.5) < 4 && r.drawn.zr > 0.5 && Math.abs(r.hAng - 109.5) < 4 && turned,
    `1.33 the molecule builder in the 3-D lab works in space: a drawn chain bends at ${r.drawn.ang.toFixed(1)}° with ${r.drawn.zr.toFixed(2)} Å of depth, a CH₃'s hydrogens ${r.hAng.toFixed(1)}° apart; dragging empty space turns it`, '1.33 builder 3-D: ' + JSON.stringify({ r, turned }));
  check(r.mol && r.mol.mode === '3d' && r.mol.zr > 1 && r.saved && r.placed > 1 && Math.abs(r.tidy - 112) < 6,
    `1.33 Tidy and Build settle it in 3-D (C–C–C ${r.tidy.toFixed(1)}°); it is kept with its depths (${r.mol && r.mol.zr.toFixed(2)} Å), in the 3-D library, and put down as built`, '1.33 build 3-D: ' + JSON.stringify(r));
  check(r.grid < 40, `1.33 the far faces' grid in a 20 000 Å box seen close in stays faint (mean brightness ${r.grid.toFixed(1)}; 87 in 1.32)`, '1.33 grid: ' + r.grid);
};
if (require.main === module) (async () => {
  let fails = 0; const check = (ok, good, bad) => { if (ok) console.log('  ' + good); else { fails++; console.log('FAIL ' + bad); } };
  await module.exports(null, check);
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})();
