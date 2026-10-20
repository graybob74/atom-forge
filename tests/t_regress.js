'use strict';
/* Regressions found by the 0.44 bug hunt, run in the real page (the hot cases are too slow for the Node harness):
   1. a bond stretched far past where it can hold, with a heat bath, breaks (the bath paying what the pair cannot) instead
      of hanging on by its angle terms (which also made a melted chip re-check its whole crystal every step);
   2. a plasma whose bath is turned down cools where it is: nothing is declared radiation at once and stopped by the walls;
   3. save and load keep particles in radiation flight (with their energy), and a strong field and a fine Motion setting. */
const { openPage } = require('./browser');
(async () => {
  const { browser, page, errors } = await openPage({ settle: 800 });
  let fails = 0; const say = (...a) => console.log(...a); const t0 = Date.now();
  const r = await page.evaluate(() => {
    setRunning(false); const out = {};
    loadPreset('ringosc'); setBathT(3e4); W.gamma = 0.5; W.slowmo = false; let worst = 0;
    for (let f = 0; f < 300; f++) { simFrame(1 / 60, 25); for (const bd of W.bonds) worst = Math.max(worst, Math.hypot(bd.a.x - bd.b.x, bd.a.y - bd.b.y) / Math.min(2.5 * bd.r0, 6)); }
    out.stretch = worst;
    loadPreset('water'); setBathT(1e9); W.gamma = 0.5; W.slowmo = false;
    const nuc = () => W.parts.filter(p => !p.dead && p.k === NUC && p.Z > 0).length, n0 = nuc();
    for (let f = 0; f < 250; f++) simFrame(1 / 60, 25);
    const n1 = nuc(); setBathT(1); for (let f = 0; f < 250; f++) simFrame(1 / 60, 25);
    out.cool = { n0, n1, n2: nuc(), T: measure().T };
    loadPreset('chain'); W.slowmo = false;
    for (let k = 0; k < 3; k++) fireSpec({ kind: 'n' }, -40, (k - 1) * 8, 1, 0, 0.025, false);
    for (let f = 0; f < 60; f++) simFrame(1 / 60, 25);
    fireSpec(isoSpec(2, 4, 0), 0, 0, 1, 0, 5e6, false); fireSpec({ kind: 'e' }, 0, 5, 0, 1, 2e5, false); // (in radiation flight for certain: a 5 MeV α and a 200 keV electron)
    const rad = W.parts.filter(p => !p.dead && p.rad).length;
    UI.E = 20; applyE(); W.simPerFrame = 5e-4;
    const before = W.parts.filter(p => !p.dead && !p.beam && !p.caught), ke = before.filter(p => p.rad).reduce((s, p) => s + p.KE, 0);
    const j = JSON.parse(JSON.stringify(worldToJSON())); worldFromJSON(j);
    const after = W.parts.filter(p => !p.dead), ke2 = after.filter(p => p.rad).reduce((s, p) => s + p.KE, 0);
    out.save = { n: before.length, n2: after.length, rad, ke, ke2, E: UI.E, spf: W.simPerFrame };
    // neutrinos in "Made here"; near-light speeds never read as c or more
    loadPreset('pet'); setRunning(false); W.slowmo = false;
    for (let f = 0; f < 900 && !(W.made && W.made.nu); f++) simFrame(1 / 60, 25);
    renderMade(); out.nu = { rec: W.made && W.made.nu ? [...W.made.nu.values()].map(r => [r.lab, r.n, r.E > 0]) : null, row: [...document.querySelectorAll('#dMade tr')].some(r => /Neutrinos/.test(r.textContent)) };
    out.speed = fmtSpeed(299792458 * (1 - 1.3e-7) / PHYS.V_MS);
    // trails last the set time of watching, whatever the speed (thinned, not cut, when long)
    out.trail = [];
    for (const spd of [1, 8]) { setSetting('trail', 1.5); setSetting('trailClock', 'real'); loadPreset('ring'); W.slowmo = false; W.simPerFrame = UI.baseSpf * spd;
      for (let f = 0; f < 240; f++) { simFrame(1 / 60, 25); if (f % 3 === 0) render(W.rt); }
      let short = 0, n = 0, over = 0; for (const t of W.tracks) if (t.ts && t.ts.length > 1) { n++; const span = t.ts[t.ts.length - 1] - t.ts[0], want = t.ts[t.ts.length - 1] - Math.max(t.t0, W.rt - 1.5); let gap = 0; for (let i = 1; i < t.ts.length; i++) gap = Math.max(gap, t.ts[i] - t.ts[i - 1]); short = Math.max(short, want - span - gap); over = Math.max(over, span - 1.5); } // (short: beyond a point's spacing; a long trail's older half is thinned, so the point the trimming takes off can be a few spacings long)
      out.trail.push({ n, short: +short.toFixed(3), over: +over.toFixed(3) }); }
    setSetting('trail', SET_DEF.trail);
    return out;
  });
  if (!(r.stretch < 1.6)) { fails++; say('FAIL a bond hangs on far past where it can hold:', r.stretch); }
  else say(`  a ring oscillator at 30,000 K: the most stretched bond at ${r.stretch.toFixed(2)} of its holding length`);
  if (!(r.cool.n1 === r.cool.n0 && r.cool.n2 === r.cool.n0 && r.cool.T < 1e8)) { fails++; say('FAIL turning the bath down lost nuclei to the walls:', JSON.stringify(r.cool)); }
  else say(`  water at a billion K, then the bath at 1 K: ${r.cool.n0} nuclei kept, cooling (${r.cool.T.toExponential(1)} K)`);
  const sv = r.save;
  if (!(sv.n2 === sv.n && sv.rad > 0 && Math.abs(sv.ke2 - sv.ke) <= 1e-6 * sv.ke + 1 && Math.abs(sv.E - 20) < 1e-9 && Math.abs(sv.spf - 5e-4) < 1e-12)) { fails++; say('FAIL save and load:', JSON.stringify(sv)); }
  else say(`  save and load: ${sv.n} particles, ${sv.rad} in radiation flight (${(sv.ke / 1e6).toFixed(1)} MeV) kept; a 20 V/Å field and a fine Motion setting kept`);
  if (!(r.nu.rec && r.nu.rec.length && r.nu.row)) { fails++; say('FAIL neutrinos not in Made here:', JSON.stringify(r.nu)); }
  else say(`  neutrinos in Made here: ${r.nu.rec.map(x => x[0] + ' ×' + x[1]).join(', ')}`);
  if (!(/^299,792\.4\d* km\/s \(99\.99998\d*% of c\)$/.test(r.speed))) { fails++; say('FAIL a near-light speed reads:', r.speed); }
  else say(`  a 1 GeV electron's speed reads ${r.speed}`);
  if (!(r.trail.every(x => x.n > 0 && x.short < 0.6 && x.over < 0.1))) { fails++; say('FAIL trail spans (s of watching):', JSON.stringify(r.trail)); }
  else say(`  trails set to 1.5 s keep the last 1.5 s (or all) of each path at normal and 8× speed: ${JSON.stringify(r.trail)}`);
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  say(`  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  await browser.close();
  console.log(fails ? `${fails} regression failure(s)` : 'regression checks passed');
  process.exitCode = fails ? 1 : 0;
})();
