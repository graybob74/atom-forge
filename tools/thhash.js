'use strict';
/* A fingerprint of a threaded run, to show that a change to the threads leaves the simulation the same to the bit:
   the 12,000-atom water world (t_threads's), stepped on the isolated page with 2, 3 and 5 threads, then a hash of every
   position and velocity, the bath's ledger, the clock and the list rebuilds. Run it before and after the change and
   compare the lines; the hash for a given thread count must not move. (The forces' sum depends on the thread count, so
   the counts differ from each other; that is as it always was.)
   node tools/thhash.js [steps] */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tests/deps').dep('playwright');
const { pageFile } = require('../tests/browser');
const STEPS = +(process.argv[2] || 80);
const BUILD = `(() => { baseWorld(560, 360, 300, 0.05); const nx = 80, ny = 50, dx = 560 / nx, dy = 360 / ny;
  let a = 12 >>> 0; const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { if (W.parts.length + 3 > 12000) break; addMolecule('H2O', -280 + (i + 0.5) * dx + (rnd() - 0.5) * 0.4, -180 + (j + 0.5) * dy + (rnd() - 0.5) * 0.4, rnd() * 6, 300); }
  settleOverlaps(); W.decayOn = false; })()`;
(async () => {
  const file = pageFile();
  const server = http.createServer((req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch(require('../tests/deps').launchOpts({ headless: true }));
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }));
  // the engine takes Math.random when the page loads, so the seeded one goes in before the page's script; a fresh page
  // for each thread count starts every run from the same seed
  await ctx.addInitScript(() => { let a = 99; Math.random = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
  for (const th of [2, 3, 5]) {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror:', e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/atom-forge.html`); await page.waitForTimeout(600);
    await page.evaluate((th) => { setRunning(false); setSetting('maxParts', 12000); setSetting('res', 'standard'); setSetting('effects', false); threadsSet(th - 1); }, th);
    await page.evaluate(BUILD);
    await page.waitForFunction((th) => { forcesNoEvents(); return TH.state === 'on' && TH.used === th; }, th, { timeout: 20000 }).catch(() => {});
    const r = await page.evaluate((STEPS) => {
      PROF.on = true; profReset(); VL.builds = 0;
      for (let i = 0; i < STEPS; i++) { if (W.fSpawn !== W.spawned) { forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = chooseDt(); step(W.dt); }
      PROF.on = false;
      let h = 0x811c9dc5; const eat = (f) => { const u = new Uint32Array(f.buffer, f.byteOffset, 2 * S.hi); for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193); } };
      for (const a of [S.x, S.y, S.vx, S.vy]) eat(a);
      const m = measure();
      return { used: TH.used, hash: (h >>> 0).toString(16).padStart(8, '0'), bath: W.ledger.bath, t: W.t, builds: VL.builds, T: m.T, calls: Object.fromEntries(Object.entries(TH_PH).map(([k, a]) => [k, a[2]])) };
    }, STEPS);
    console.log(`${th} threads: hash ${r.hash} bath ${r.bath} t ${r.t} builds ${r.builds} T ${r.T.toFixed(3)} used ${r.used} calls ${JSON.stringify(r.calls)}`);
    await page.close();
  }
  await browser.close(); server.close();
})();
