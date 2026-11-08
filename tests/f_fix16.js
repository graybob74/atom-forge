'use strict';
/* The check for 1.27 bug 16 (PERF-NOTES, "1.27: bug 16 (display and text)"), run by t_features (one line) or alone:
   node tests/f_fix16.js [--node] [part …]. (a) The Lab's Particles readout counted atoms, nuclei and leptons only.
   (b) The narrator called a reaction with a heat of a few meV endothermic. (c) In 3-D the photon channel's lepton pairs
   were drawn in the plane. (d) 3-D event captions drew no ghost rings, and muonium's decay caption sat at the middle
   depth. Every part fails on v145. Parts readout, narrator and ghosts need the page. (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};

/* (c) 3-D, e⁺e⁻ at 10 GeV a beam, 300 collisions: the μ⁺μ⁻ pairs go out over the sphere (v145: every one in the plane). */
PARTS.pairs3d = async (page, check, say) => {
  const X = load('all', { seed: 4 }), W = X.W; X.PRESETS.d3empty.build(); W.decayOn = false; let n = 0, flat = 0, zs = 0;
  for (let k = 0; k < 300; k++) {
    const a = X.addLepton(X.POS, -0.05, 0, 0, 0, 0), b = X.addLepton(X.ELEC, 0.05, 0, 0, 0, 0); X.setMotion(a, 5e9, 1, 0, 0, 0, 0); X.setMotion(b, 5e9, -1, 0, 0, 0, 0);
    const x0 = W.exo.length; X.eeEvent(a, b, 0, 0);
    const mus = W.exo.slice(x0).filter(o => o.sp === 'mu-' || o.sp === 'mu+'); if (mus.length === 2) { n++; const uz = Math.abs(mus[0].uz || 0); zs += uz; if (uz < 1e-9) flat++; }
    for (const o of W.exo) o.dead = true;
  }
  check(n > 3 && flat === 0 && zs / n > 0.3, `1.27 bug 16c: in 3-D the photon channel's μ⁺μ⁻ go out over the sphere (${n} pairs, ${flat} in the plane, mean |u_z| ${(zs / Math.max(1, n)).toFixed(2)}; 1/2 over a sphere)`, 'fix16 pairs3d: ' + JSON.stringify({ n, flat, zs }));
};

/* (a) Twelve unstable particles beside five atoms: the readout says 17, and its tooltip says what it counts. */
PARTS.readout = async (page, check, say) => {
  const r = await page.evaluate(() => { document.querySelectorAll('.modal').forEach(m => { m.hidden = true; }); loadPreset('empty'); setRunning(false); W.decayOn = false;
    for (let i = 0; i < 5; i++) addAtom('He', -6 + 3 * i, 0); for (let i = 0; i < 12; i++) addExo(i % 2 ? 'mu-' : 'pi+', -8 + 1.4 * i, 4, 0.01, 1, 0);
    updateReadouts(); const out = { n: $('roN').textContent, title: $('roN').parentElement.title || '' }; loadPreset('water'); setRunning(false); return out; });
  check(r.n === '17' && /unstable/.test(r.title), `1.27 bug 16a: the Particles readout counts unstable particles too (${r.n} for 5 atoms and 12 muons and pions; tooltip: "${r.title.slice(0, 60)}…")`, 'fix16 readout: ' + JSON.stringify(r));
};
PARTS.readout.page = true;

/* (b) H + H₂ → H₂ + H at +0 kJ/mol: the narrator says thermoneutral (v145: endothermic). */
PARTS.narrator = async (page, check, say) => {
  const t = await page.evaluate(() => { const was = SET.narr; setSetting('narr', true); NARR.until = 0; NARR.last.clear(); log('chem', 'Reaction: H + H₂ → H₂ + H  (ΔH +0 kJ/mol)'); UI.vis = (UI.vis || 0) + 100; narrTick(); const s = $('narr').textContent; $('narr').hidden = true; setSetting('narr', was); return s; });
  check(/thermoneutral/.test(t) && !/endothermic/.test(t), `1.27 bug 16b: the narrator calls a near-zero heat thermoneutral`, 'fix16 narrator: ' + t);
};
PARTS.narrator.page = true;

/* (d) 3-D: a ²¹²Po α decay draws its ghost ring (dashed) at the nucleus's depth, and muonium's decay caption is at the
   muonium's depth (−7 Å), not the middle (v145: no ring, depth 0). */
PARTS.ghosts = async (page, check, say) => {
  const r = await page.evaluate(() => { loadPreset('d3empty'); setRunning(false); W.events.length = 0; let rings = 0; const keep = CanvasRenderingContext2D.prototype.setLineDash;
    CanvasRenderingContext2D.prototype.setLineDash = function (a) { if (a && a.length === 2 && a[0] === 3) rings++; return keep.apply(this, arguments); };
    try { const p = addAtom('Po', 2, 1, { A: 212, z: 6 }); W.decayOn = true; doDecay3(p); render(W.rt + 0.3); } finally { CanvasRenderingContext2D.prototype.setLineDash = keep; }
    const ev = W.events[W.events.length - 1]; addMuonium(-3, 2, 0.03, 1, 0, 1, -7, 0); W.warp = 1e12; muoniumTick(1); const e2 = W.events[W.events.length - 1];
    const out = { rings, ghostZ: ev && ev.ghosts[0] ? ev.ghosts[0].z : null, muZ: e2 && /μ⁺ →/.test(e2.text) ? e2.z : null }; loadPreset('water'); setRunning(false); return out; });
  check(r.rings >= 1 && r.ghostZ === 6 && r.muZ === -7, `1.27 bug 16d: 3-D captions draw the ghost of what vanished (${r.rings} dashed ring at depth ${r.ghostZ}); muonium's decay caption at its depth (${r.muZ})`, 'fix16 ghosts: ' + JSON.stringify(r));
};
PARTS.ghosts.page = true;

module.exports = async function ffix16(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (fix16 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `fix16 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  const args = process.argv.slice(2), noPage = args.includes('--node');
  let browser = null, page = null, errors = [];
  if (!noPage && Object.values(PARTS).some(f => f.page)) { const { openPage } = require('./browser'); ({ browser, page, errors } = await openPage({ settle: 800 })); }
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(page, check, say, null, args.filter(a => a !== '--node'));
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  if (browser) await browser.close();
  console.log(fails ? `${fails} failure(s)` : '1.27 bug 16 (display and text) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
