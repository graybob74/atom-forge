'use strict';
/* 1.36 (the owner, 2026-11-18: "i'd say 3d accelerator is next, can you start that?"): the collider in the 3-D lab.
   Stage 1: the ring and the linear collider built in a 3-D world, their zones in the middle plane (z = 0) with the field
   of the magnets there (Bfield3), the beams in radiation flight in that plane, meeting in the detector; the setups in
   the 3-D lab's list, the ring drawn. Run by t_features or alone: node tests/f_136.js [part …] */
const path = require('path');
const { load } = require(path.join(__dirname, 'load.js'));
const PARTS = {};
function collider(preset, frames, seed = 3) {
  const X = load('all', { seed }), W = X.W; X.PRESETS[preset].build(); X.settleOverlaps(); W.baseSpf = W.simPerFrame;
  W.slowHold = false; W.hold = null; // (not held to the beams' pace in slow motion: the run covers the ramp in a few hundred frames)
  const C = W.collider; let maxZ = 0, rad = 0, n = 0, top = 0;
  for (let f = 0; f < frames; f++) {
    X.simFrame(1 / 60, 1e9); if (C.hits >= 60) break;
    for (const p of W.parts) if (!p.dead && p.beam) { n++; if (p.rad) rad++; maxZ = Math.max(maxZ, Math.abs(p.z || 0)); top = Math.max(top, p.KE || 0); }
  }
  return { X, W, C, maxZ, radFrac: n ? rad / n : 0, top };
}
PARTS.ring = async (page, check) => {
  const r = collider('ring3d', 1500);
  check(r.W.d3 && r.radFrac === 1 && r.maxZ === 0 && r.C.hits >= 60 && r.top > 1.9e6, `1.36 the 3-D ring collider: its beams fly in the middle plane (all in radiation flight, z = 0), reach ${r.X.fmtE(r.top)} and collide ${r.C.hits} times (last: ${r.C.last})`,
    `1.36 3-D ring: d3 ${r.W.d3}, in flight ${r.radFrac}, max |z| ${r.maxZ}, top ${r.top}, hits ${r.C.hits}`);
};
PARTS.linac = async (page, check) => {
  const r = collider('linac3d', 400);
  check(r.W.d3 && r.radFrac === 1 && r.C.hits >= 20 && /γγ/.test(r.C.last), `1.36 the 3-D linear collider: ${r.C.hits} collisions at the collision point (${r.C.last})`, `1.36 3-D linac: in flight ${r.radFrac}, hits ${r.C.hits}, ${r.C.last}`);
};
/* The magnets act only in their slab about the middle plane: a beam particle 10 Å above it feels no bending field. */
PARTS.slab = async (page, check) => {
  const X = load('all', { seed: 3 }); X.PRESETS.ring3d.build(); for (let f = 0; f < 30; f++) X.simFrame(1 / 60, 1e9);
  const z = X.W.zones.find(q => q.kind === 'dipole' && q.ring), a = (z.amid !== undefined ? z.amid : 0), r = 0.5 * (z.r0 + z.r1), x = z.cx + r * Math.cos(a), y = z.cy + r * Math.sin(a);
  const p = { z: 0, beam: z.beam || true, injKick: null }, want = X.zonesB(x, y, p), b0 = X.Bfield3(x, y, 0, p), b1 = X.Bfield3(x, y, 10, p);
  check(want !== 0 && Math.abs(b0 - want) < 1e-9 * Math.abs(want) && b1 === 0, `1.36 a ring magnet in 3-D: ${X.fmtTesla(Math.abs(b0))} in the middle plane, none 10 Å above it`, `1.36 slab: B ${b0} at z 0 (want ${want}), ${b1} at z 10`);
};
PARTS.page = async (page, check) => {
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ viewport: { width: 1360, height: 860 }, settle: 800 }); page = own.page; }
  await page.evaluate(() => { loadPreset('ring3d'); setRunning(true); }); await page.waitForTimeout(1500);
  const r = await page.evaluate(() => { const c = $('cv'); return { d3: W.d3, panel: !$('gCollider').hidden, listed: [...$('preset').options].some(o => o.value === 'ring3d' && o.parentElement.label === '3-D lab (preview)'), beams: W.parts.filter(p => !p.dead && p.beam && p.rad).length, c: !!c }; });
  check(r.d3 && r.panel && r.listed && r.beams > 0, `1.36 the 3-D lab lists the ring collider; it opens with the collider panel and ${r.beams} beam particles in flight`, `1.36 page: ${JSON.stringify(r)}`);
  if (own) { if (own.errors.length) check(false, '', '1.36 page errors: ' + own.errors.join(' | ')); await own.browser.close(); }
};
module.exports = async function f136(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check); } catch (e) { check(false, '', `1.36 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
if (require.main === module) (async () => {
  let fails = 0; const check = (ok, good, bad) => { if (ok) console.log('  ' + good); else { fails++; console.log('FAIL ' + bad); } };
  await module.exports(null, check, null, null, process.argv.slice(2));
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})();
