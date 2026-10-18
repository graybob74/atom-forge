'use strict';
/* The three benchmark scenarios in the real page in headless Chromium: node tools/bench-page.js [repo-root] [steps]
   Builds each scenario in the page's own engine (its globals), pauses the frame loop, times N steps directly (ms per step),
   then times whole frames as the page runs them (simFrame with the 10 ms budget + render) for ~3 s. */
const path = require('path');
const args = process.argv.slice(2);
const root = args.find(a => /[\/\\]|^\.\.?$/.test(a)) ? path.resolve(args.find(a => /[\/\\]|^\.\.?$/.test(a))) : path.join(__dirname, '..');
const N = +(args.find(a => /^\d+$/.test(a)) || 200);
const { openPage } = require(path.join(root, 'tests', 'browser.js'));
(async () => {
  const { browser, page, errors } = await openPage({ settle: 800 });
  const out = await page.evaluate(async (N) => {
    const seeded = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
    const scen = {
      water12k() { baseWorld(560, 360, 300, 0.05); const nx = 80, ny = 50, dx = 560 / nx, dy = 360 / ny;
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { if (W.parts.length + 3 > 12000) break; addMolecule('H2O', -280 + (i + 0.5) * dx + (Math.random() - 0.5) * 0.4, -180 + (j + 0.5) * dy + (Math.random() - 0.5) * 0.4, Math.random() * 6, 300); }
        settleOverlaps(); },
      waterion() { PRESETS.water.build(); settleOverlaps(); const Os = W.parts.filter(p => p.Z === 8); for (let i = 0; i < 40; i++) userIonize(Os[i]); },
      flashbyte() { PRESETS.flashbyte.build(); settleOverlaps(); },
    };
    const res = {};
    setRunning(false);
    setSetting('perf', true); // performance mode: 12,000 particles, standard resolution, no glows, 10 ms budget
    for (const name of Object.keys(scen)) {
      Math.random = seeded(12);
      scen[name]();
      W.decayOn = false;
      fitView();
      const n = W.parts.filter(p => !p.dead).length;
      const steps = (k) => { let adv = 0; for (let i = 0; i < k; i++) { if (W.fSpawn !== W.spawned) { forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = chooseDt(); adv += step(W.dt); } return adv; };
      steps(60);
      let t0 = performance.now(); const adv = steps(N); const msStep = (performance.now() - t0) / N, dtMean = adv / N;
      // whole frames as the page runs them: simulation within its budget, then the drawing
      let frames = 0, simMs = 0, drawMs = 0, stepsRun = 0, simAdv = 0, target = 0;
      t0 = performance.now();
      while (performance.now() - t0 < 3000) {
        const a = performance.now(); const r = simFrame(1 / 60, UI.budget); const b = performance.now(); render(W.rt); const c = performance.now();
        simMs += b - a; drawMs += c - b; frames++; stepsRun += r.steps; simAdv += r.simAdv; target += r.target;
      }
      res[name] = { particles: n, freeE: W.nE, msPerStep: +msStep.toFixed(3), dtMean: +dtMean.toFixed(5), stepsPerFrame: +(stepsRun / frames).toFixed(2),
        simMsPerFrame: +(simMs / frames).toFixed(1), drawMsPerFrame: +(drawMs / frames).toFixed(1), simSpeedPct: +(100 * simAdv / target).toFixed(1) };
    }
    return res;
  }, N);
  for (const k of Object.keys(out)) console.log(k, JSON.stringify(out[k]));
  if (errors.length) console.log('page errors:', errors.slice(0, 5).join('\n'));
  await browser.close();
})();
