'use strict';
/* 1.34.2 (the owner, 2026-11-15: "is every exotic particle rendered in 3d, or is it just a 2d disc that faces the camera?",
   then "do that for 1.34.2"): in the 3-D lab an unstable particle is a shaded ball at its depth, smaller farther away, and
   an atom in front of it covers it, on the WebGL layer and on Canvas 2D. Fails on 1.34.1 (a dot of fixed size drawn over
   everything). Run by t_features or alone: node tests/f_1342.js */
module.exports = async function f1342(page, check) {
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ viewport: { width: 900, height: 600 }, settle: 800 }); page = own.page; }
  const shotPixel = async (x, y) => { // (the page as shown, all its canvases: a screenshot, read back in the page)
    const png = (await page.screenshot({ type: 'png' })).toString('base64');
    return page.evaluate(async ([s, x, y]) => { const im = new Image(); await new Promise(r => { im.onload = r; im.src = 'data:image/png;base64,' + s; }); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return Array.from(g.getImageData(Math.round(x * im.width / innerWidth), Math.round(y * im.width / innerWidth), 1, 1).data.slice(0, 3)); }, [png, x, y]);
  };
  await page.evaluate(() => setChamberOnly(true)); await page.waitForTimeout(300);
  for (const gl of ['gl', '2d']) {
    const r = await page.evaluate(async (gl) => { try {
      setSetting('gl', gl); loadPreset('d3empty'); setRunning(false); W.decayOn = false; R.view.labels = true; render(W.rt);
      cam3Fit(); R.cam3.dist *= 0.15; cam3Update();
      const a = addExo('pi+', 0, 0, 1e6, 1, 0, undefined, 4, 0), b = addExo('pi+', 0, 3, 1e6, 1, 0, undefined, -8, 0);
      render(W.rt); const ba = exoBalls3(), ra = ba.find(e => e.o === a), rb = ba.find(e => e.o === b);
      a.dead = b.dead = true;
      const ar = addAtom('Ar', 2, -1, { z: 0 }); ar.vx = ar.vy = ar.vz = 0;
      const dx = ar.x - C3.ex, dy = ar.y - C3.ey, dz = ar.z - C3.ez, L = Math.hypot(dx, dy, dz);
      const k = addExo('K+', ar.x + 4 * dx / L, ar.y + 4 * dy / L, 1e6, 1, 0, undefined, ar.z + 4 * dz / L, 0);
      const P = [0, 0, 0]; proj3(k.x, k.y, k.z, P); render(W.rt);
      const rc = R.cv.getBoundingClientRect();
      return { gl: R.gl, ra: ra && ra.r, rb: rb && rb.r, x: rc.left + P[0], y: rc.top + P[1], kc: XP['K+'].col };
    } catch (e) { return { err: e.message }; } }, gl);
    if (!r.err) {
      await page.waitForTimeout(150); await page.evaluate(() => render(W.rt)); if (process.env.SHOT) await page.screenshot({ path: '/tmp/bt/t_' + gl + '.png' }); r.behind = await shotPixel(r.x, r.y);
      await page.evaluate(() => { for (const p of W.parts) if (p.el && p.el.sym === 'Ar') p.dead = true; render(W.rt); }); await page.waitForTimeout(150); await page.evaluate(() => render(W.rt));
      r.open = await shotPixel(r.x, r.y);
      const near = (c, t) => Math.abs(c[0] - t[0]) + Math.abs(c[1] - t[1]) + Math.abs(c[2] - t[2]);
      r.covered = near(r.behind, r.kc) > near(r.open, r.kc) + 60;
    }
    check(!r.err && r.ra > r.rb * 1.3 && r.covered, `1.34.2 3-D (${gl === 'gl' ? 'WebGL' : 'Canvas 2D'}): an unstable particle is a ball at its depth (a π⁺ 12 Å nearer has a radius of ${r.ra && r.ra.toFixed(1)} px, the farther ${r.rb && r.rb.toFixed(1)}), and an argon atom in front of a K⁺ covers it (its place shows ${JSON.stringify(r.behind)}, the K⁺ alone ${JSON.stringify(r.open)})`, '1.34.2 ' + gl + ': ' + JSON.stringify(r));
  }
  await page.evaluate(() => { setSetting('gl', 'gl'); setChamberOnly(false); });
  if (own) await own.browser.close();
};
if (require.main === module) (async () => {
  let fails = 0; const check = (ok, good, bad) => { if (ok) console.log('  ' + good); else { fails++; console.log('FAIL ' + bad); } };
  await module.exports(null, check);
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})();
