'use strict';
/* 1.34.3 (the owner, 2026-11-15: "can you do a wasm pass for every major slowdown setting? also, how is nucleons inside
   nuclei 1x performance?", and "electron shells in particle view just follow the camera, fix that. Also in 3d particle
   view its only 3d if you're up close"). The module's passes give the JavaScript's numbers; the particle view's orbits
   stay fixed in space far from the camera. Run by t_features or alone: node tests/f_1343.js [part …] */
const path = require('path');
const { load } = require(path.join(__dirname, 'load.js'));
const PARTS = {};
/* Gravity, full-range charges and three-body dispersion: the module's energy and forces the JavaScript's, and faster. */
PARTS.forces = async (page, check) => {
  for (const preset of ['water', 'water3d']) for (const [k, c] of [['gravity', { grav: 1, gk: 30 }], ['full-range charges', { lrq: true }], ['three-body dispersion', { disp: true }]]) {
    const X = load('all', { seed: 1 }); X.PRESETS[preset].build(); X.W.decayOn = false; X.xfSet(c); X.forcesNoEvents();
    const n = X.S.fx.length, F = [0, 1].map(() => [new Float64Array(n), new Float64Array(n), new Float64Array(n)]), U = [], ms = [];
    for (const w of [0, 1]) {
      X.XFW.use = !!w; const c0 = X.XFW.calls; U[w] = X.xfEnergy(); X.xfForces(...F[w]);
      if (w && X.XFW.calls === c0) U[w] = NaN; // (the module must have run)
      const t0 = process.hrtime.bigint(); for (let i = 0; i < 5; i++) X.xfForces(new Float64Array(n), new Float64Array(n), new Float64Array(n)); ms[w] = Number(process.hrtime.bigint() - t0) / 5e6;
    }
    let df = 0, fm = 0; for (let a = 0; a < 3; a++) for (let i = 0; i < n; i++) { df = Math.max(df, Math.abs(F[0][a][i] - F[1][a][i])); fm = Math.max(fm, Math.abs(F[0][a][i])); }
    check(Math.abs(U[1] - U[0]) <= 1e-12 * Math.max(1, Math.abs(U[0])) && df <= 1e-12 * Math.max(1, fm), `1.34.3 ${k} in the module, ${preset === 'water' ? 'flat' : '3-D'} liquid water: energy ${U[1].toPrecision(10)} eV as the JavaScript's, forces to ${df.toExponential(1)} eV/Å; ${ms[0].toFixed(2)} → ${ms[1].toFixed(2)} ms a pass`, `1.34.3 ${k} ${preset}: ` + JSON.stringify({ U, df, fm }));
  }
};
/* Polarizability by direction: the dipoles' gathering and solve in the module, the run the JavaScript's to the bit. */
PARTS.dipoles = async (page, check) => {
  const h = [], ms = [], calls = [];
  for (const w of [0, 1]) {
    const X = load('all', { seed: 1 }); X.XFW.use = !!w; X.PRESETS.water3d.build(); X.W.decayOn = false; X.QEQ.every = 1; X.pdOn(1); X.forcesNoEvents();
    for (let i = 0; i < 4; i++) X.step(0.02);
    const t0 = process.hrtime.bigint(); for (let i = 0; i < 16; i++) X.step(0.02); ms[w] = Number(process.hrtime.bigint() - t0) / 16e6;
    let s = 0; for (const p of X.W.parts) s += p.x * 1.1 + p.y * 1.3 + (p.z || 0) * 1.7 + (p.dmx || 0) + (p.dmy || 0); h[w] = s; calls[w] = X.XFW.calls;
  }
  check(h[0] === h[1] && calls[1] > 30 && calls[0] === 0, `1.34.3 induced dipoles (polarizability by direction) in 3-D liquid water: the module's run the JavaScript's to the bit over 20 steps; ${ms[0].toFixed(1)} → ${ms[1].toFixed(1)} ms a step`, '1.34.3 dipoles: ' + JSON.stringify({ h, calls, ms }));
};
/* Nucleons inside nuclei: the module's lowest arrangement of ¹²C as the JavaScript's, and a collision's time. */
PARTS.nucleons = async (page, check) => {
  const B = [], tc = [];
  for (const w of [0, 1]) {
    const X = load('all', { seed: 9 }); X.XFW.use = !!w; X.PRESETS.empty.build(); X.W.decayOn = false; X.xfSet({ nucl: true });
    B[w] = -X.xnGround(6, 6).U; X.xnGround(2, 2); let t = 0;
    for (let k = 0; k < 4; k++) { const a = X.addAtom('He', -1, 0, { A: 4, charge: 2 }), b = X.addAtom('C', 1, 0, { A: 12, charge: 6 }); X.setMotion(a, 30 * 4e6, 1, 0);
      const Pa = X.p4of(a, true), P = X.add4(Pa, X.p4of(b, true)), M = X.mass4(P), t0 = Date.now(); X.xnCollide(a, b, Pa, P, M, 0.5 + 0.6 * k, false, [], []); t += Date.now() - t0; X.W.parts.forEach(p => { p.dead = true; }); X.PRESETS.empty.build(); }
    tc[w] = t / 4;
  }
  check(Math.abs(B[0] - B[1]) < 0.05, `1.34.3 nucleons inside nuclei in the module: ¹²C's lowest arrangement bound by ${B[1].toFixed(2)} MeV (the JavaScript's ${B[0].toFixed(2)}); a collision ${tc[0].toFixed(1)} → ${tc[1].toFixed(1)} ms`, '1.34.3 nucleons: ' + JSON.stringify({ B, tc }));
};
/* The particle view in 3-D far from the camera: an atom's electrons keep their orbits fixed in space (turning the camera
   moves them on the screen), as near it. 1.34.2 drew the flat picture there, whose electrons circle in the screen's plane. */
PARTS.orbits = async (page, check) => {
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ settle: 800 }); page = own.page; }
  const r = await page.evaluate(() => { try {
    setSetting('gl', '2d'); loadPreset('water3d'); setRunning(false); R.view.bohr = 'nuc'; W.at = 0.37;
    cam3Fit(); cam3Update(); const p = W.parts.find(q => q.k === NUC && q.Z === 8 && q.ne > 0);
    const ds = window.drawSprite;
    const pos = (yaw) => {
      R.cam3.yaw = yaw; cam3Update(); const A = [0, 0, 0]; proj3(p.x, p.y, p.z, A); const out = [];
      const ctx = { drawImage() {}, save() {}, restore() {}, set globalCompositeOperation(v) {}, get globalCompositeOperation() { return 'source-over'; }, beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, fillText() {}, measureText() { return { width: 0 }; } };
      window.drawSprite = (sp, x, y) => out.push([+(x - A[0]).toFixed(2), +(y - A[1]).toFixed(2)]);
      let nr = 0; try { const s0 = R.s; R.s = C3.F / A[2]; nr = nucleonR(); R.s = s0; drawDet3(ctx, p, A[0], A[1], A[2], 6, atomColor(p), W.rt, 'nuc'); } finally { window.drawSprite = ds; } return { out, nr };
    };
    const a = pos(0.3), b = pos(1.4);
    return { nr: a.nr, n: a.out.length, a: a.out.slice(0, 4), b: b.out.slice(0, 4), moved: JSON.stringify(a.out) !== JSON.stringify(b.out) };
  } catch (e) { return { err: e.message }; } });
  check(!r.err && r.n >= 5 && r.nr < 2.5 && r.moved, `1.34.3 the particle view in 3-D, an oxygen atom far off (nucleons ${r.nr && r.nr.toFixed(2)} px): its ${r.n} pictures (electrons and nucleus) move on the screen as the camera turns (orbits fixed in space)`, '1.34.3 orbits: ' + JSON.stringify(r));
  await page.evaluate(() => { setSetting('gl', 'gl'); R.view.bohr = 'auto'; });
  if (own) await own.browser.close();
};
/* The particle search (top left, "/") finds elements and isotopes, and an element found shows three common isotopes to
   pick on hover. 1.34.2 found no element. */
PARTS.search = async (page, check) => {
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ settle: 800 }); page = own.page; }
  const r = await page.evaluate(async () => { try {
    const raf = () => new Promise(res => requestAnimationFrame(res)), out = {};
    loadPreset('empty'); await raf();
    const fb = document.querySelector('#palette [data-find]'); fb.click(); await raf();
    const q = $('pfQ'), type = async (v) => { q.value = v; q.dispatchEvent(new Event('input')); await raf(); return [...document.querySelectorAll('#pfR .pm-i')].map(b => b.querySelector('b').textContent); };
    out.gold = (await type('gold'))[0]; out.c14 = (await type('C-14'))[0]; out.u92 = (await type('92'))[0];
    await type('carbon'); const row = document.querySelector('#pfR .pm-i.el'); out.chips = row ? [...row.querySelectorAll('.pf-iso')].map(c => c.textContent) : [];
    const c14 = row && [...row.querySelectorAll('.pf-iso')].find(c => c.dataset.a === '14'); if (c14) c14.click(); await raf();
    out.spec = UI.spec && { Z: UI.spec.Z, A: UI.spec.A }; out.closed = $('pmenu').hidden;
    return out;
  } catch (e) { return { err: e.message }; } });
  check(!r.err && r.gold === 'Au' && r.c14 === '¹⁴C' && r.u92 === 'U' && r.chips.join(' ') === '¹²C ¹³C ¹⁴C' && r.spec && r.spec.Z === 6 && r.spec.A === 14 && r.closed, `1.34.3 the particle search finds elements ("gold" ${r.gold}, "C-14" ${r.c14}, "92" ${r.u92}); carbon's row offers ${(r.chips || []).join(', ')}, and ¹⁴C picked from it is what the Place tool takes`, '1.34.3 search: ' + JSON.stringify(r));
  if (own) await own.browser.close();
};
module.exports = async function f1343(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check); } catch (e) { check(false, '', `1.34.3 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
if (require.main === module) (async () => {
  let fails = 0; const check = (ok, good, bad) => { if (ok) console.log('  ' + good); else { fails++; console.log('FAIL ' + bad); } };
  await module.exports(null, check, null, null, process.argv.slice(2));
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})();
