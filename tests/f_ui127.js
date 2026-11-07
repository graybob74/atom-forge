'use strict';
/* The owner's two control requests after 1.26 (2026-11-06): with the measure tool, a right-click on a measured particle
   stops measuring it; Shift + wheel sets the radius of a tool that has one (Push/Pull, Heat, Spark, Magnet, Erase).
   Run by t_features (one line) or alone: node tests/f_ui127.js. Real mouse input in the headless page. */
const PARTS = {};
const where = (page, i) => page.evaluate((i) => { // (the screen point of W.parts[i], in the page's pixels)
  const p = W.parts[i], r = $('cv').getBoundingClientRect(); let x, y;
  if (W.d3) { const o = [0, 0, 0]; proj3(p.x, p.y, p.z, o); x = o[0]; y = o[1]; } else { x = w2sx(p.x); y = w2sy(p.y); }
  return [r.left + x * r.width / R.w, r.top + y * r.height / R.h];
}, i);

PARTS.measure = async (page, check, say) => {
  const out = {};
  for (const d3 of [false, true]) {
    await page.evaluate((d3) => { document.querySelectorAll('.modal').forEach(m => { m.hidden = true; }); loadPreset(d3 ? 'd3empty' : 'empty'); setRunning(false);
      if (d3) { addAtom('Ar', -4, 0, { z: 0, T: 0 }); addAtom('Ar', 4, 0, { z: 0, T: 0 }); addAtom('Ar', 0, 4, { z: 0, T: 0 }); } else { addAtom('Ar', -4, 0, { T: 0 }); addAtom('Ar', 4, 0, { T: 0 }); addAtom('Ar', 0, 4, { T: 0 }); }
      setTool('measure'); if (R.measure) R.measure.length = 0; closeQuickMenu(); }, d3);
    await new Promise(r => setTimeout(r, 300));
    const [a, b, c] = [await where(page, 0), await where(page, 1), await where(page, 2)];
    await page.mouse.click(a[0], a[1]); await page.mouse.click(b[0], b[1]);
    const before = await page.evaluate(() => [R.measure.length, $('toolOpts') ? $('toolOpts').textContent : ''].join('|'));
    await page.mouse.click(b[0], b[1], { button: 'right' }); await new Promise(r => setTimeout(r, 80));
    const after = await page.evaluate(() => ({ n: R.measure.length, left: R.measure[0] === W.parts[0], menu: !$('qmenu').hidden }));
    await page.mouse.click(c[0], c[1], { button: 'right' }); await new Promise(r => setTimeout(r, 80)); // (not measured: the quick menu, as before)
    const other = await page.evaluate(() => { const r = { n: R.measure.length, menu: !$('qmenu').hidden }; closeQuickMenu(); return r; });
    out[d3 ? 'd3' : 'flat'] = { before, after, other };
  }
  say('  (after 1.26) measure: ' + JSON.stringify(out));
  const ok = ['flat', 'd3'].every(k => out[k].before.startsWith('2|') && out[k].after.n === 1 && out[k].after.left && !out[k].after.menu && out[k].other.n === 1 && out[k].other.menu);
  check(ok, 'after 1.26: the measure tool: a right-click on one of two measured atoms stops measuring it (flat and 3-D), no menu; a right-click on another atom still opens the quick menu', 'measure: ' + JSON.stringify(out));
};

PARTS.wheel = async (page, check, say) => {
  const out = {};
  for (const d3 of [false, true]) {
    await page.evaluate((d3) => { document.querySelectorAll('.modal').forEach(m => { m.hidden = true; }); loadPreset(d3 ? 'd3empty' : 'empty'); setRunning(false); setTool('heat'); OPT.heat.R = 8; buildToolOpts(); }, d3);
    const box = await page.evaluate(() => { const r = $('cv').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await page.mouse.move(box[0], box[1]);
    const zoom0 = await page.evaluate(() => W.d3 ? cam3Get().d || JSON.stringify(cam3Get()) : R.s);
    await page.keyboard.down('Shift'); await page.mouse.wheel(0, -100); await page.mouse.wheel(0, -100); await page.keyboard.up('Shift');
    const up = await page.evaluate(() => ({ R: OPT.heat.R, slider: +$('oR').value, shown: $('oRV').textContent }));
    await page.keyboard.down('Shift'); for (let k = 0; k < 6; k++) await page.mouse.wheel(0, 100); await page.keyboard.up('Shift');
    const down = await page.evaluate(() => OPT.heat.R);
    const zoom1 = await page.evaluate(() => W.d3 ? cam3Get().d || JSON.stringify(cam3Get()) : R.s);
    await page.mouse.wheel(0, -100); // (no Shift: zoom as before)
    const zoom2 = await page.evaluate(() => W.d3 ? cam3Get().d || JSON.stringify(cam3Get()) : R.s);
    let plane = null;
    if (d3) { // (the Place tool: Shift + wheel still moves the placing plane)
      await page.evaluate(() => { setTool('place'); buildToolOpts(); });
      const p0 = await page.evaluate(() => P3.off); await page.keyboard.down('Shift'); await page.mouse.wheel(0, -100); await page.keyboard.up('Shift');
      plane = { p0, p1: await page.evaluate(() => P3.off) };
    }
    out[d3 ? 'd3' : 'flat'] = { up, down, zoomKept: zoom1 === zoom0, zoomed: zoom2 !== zoom1, plane };
  }
  say('  (after 1.26) Shift + wheel: ' + JSON.stringify(out));
  const ok = ['flat', 'd3'].every(k => out[k].up.R > 8 && out[k].up.slider > 0 && /Å/.test(out[k].up.shown) && out[k].down < out[k].up.R && out[k].zoomKept && out[k].zoomed) && out.d3.plane && out.d3.plane.p1 !== out.d3.plane.p0;
  check(ok, `after 1.26: Shift + wheel sets the Heat tool's radius (8 → ${out.flat.up.R} Å up two notches, ${out.flat.down} Å down six; the slider follows), in 3-D too (${out.d3.up.R} Å), without zooming; the wheel alone still zooms; in 3-D the Place tool's Shift + wheel still moves the placing plane`, 'wheel: ' + JSON.stringify(out));
};

module.exports = async function fui127(page, check, say) {
  for (const [k, f] of Object.entries(PARTS)) { try { await f(page, check, say); } catch (e) { check(false, '', `after 1.26 ${k}: ${e.message.split('\n')[0]}`); } }
};
if (require.main === module) (async () => {
  const { openPage } = require('./browser'); const { browser, page, errors } = await openPage({ settle: 800 });
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(page, check, say);
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  await browser.close();
  console.log(fails ? `${fails} failure(s)` : 'control checks (after 1.26) passed');
  process.exitCode = fails ? 1 : 0;
})();
