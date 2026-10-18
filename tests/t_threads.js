'use strict';
/* The worker threads, in headless Chromium on a page served with the cross-origin isolation headers (as the desktop app
   serves it): the pair forces on two threads must equal the one-thread forces to rounding and queue the same events, run
   twice must give the same forces to the bit, and the physics must conserve energy as before; the plain file:// page
   (not isolated) must fall back to one thread. Also times the force pass on one and two threads.
   node tests/t_threads.js */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const { pageFile } = require('./browser');
let fails = 0;
const say = (...a) => console.log(...a);
const check = (ok, label, detail) => { if (!ok) { fails++; say('FAIL', label, detail === undefined ? '' : detail); } };
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
  const url = `http://127.0.0.1:${server.address().port}/atom-forge.html`;
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('error: ' + m.text()); });
  await page.goto(url); await page.waitForTimeout(600);
  const iso = await page.evaluate(() => ({ iso: crossOriginIsolated, avail: threadsAvailable(), shared: SHARED_OK, hc: navigator.hardwareConcurrency }));
  say('isolated page:', JSON.stringify(iso));
  check(iso.iso && iso.avail && iso.shared, 'page is cross-origin isolated with shared memory', iso);
  // one worker (the test machine may have two cores only), on the big water world
  await page.evaluate(() => { setRunning(false); setSetting('perf', true); setSetting('threads', '2'); });
  await page.evaluate(BUILD);
  await page.waitForFunction(() => { forcesNoEvents(); return TH.state === 'on' && TH.used === 2; }, null, { timeout: 15000 }).catch(() => {});
  const st = await page.evaluate(() => ({ state: TH.state, n: TH.n, used: TH.used, np: VL.np, note: TH.note }));
  say('threads:', JSON.stringify(st));
  check(st.state === 'on' && st.used === 2, 'two threads computed the pair forces', st);
  const r = await page.evaluate(() => {
    const n = S.hi, copy = () => [Float64Array.from(S.fx.subarray(0, n)), Float64Array.from(S.fy.subarray(0, n))];
    const diff = (A, B) => { let m = 0, scale = 0; for (let i = 0; i < n; i++) { m = Math.max(m, Math.abs(A[0][i] - B[0][i]), Math.abs(A[1][i] - B[1][i])); scale = Math.max(scale, Math.abs(A[0][i]), Math.abs(A[1][i])); } return { m, scale }; };
    const evs = () => W.evq.map(e => e.type + ':' + (e.a && e.a.id) + ':' + (e.b && e.b.id)).join(' ');
    // forces: two threads twice (identical), then one thread (rounding apart); the events queued must agree exactly
    computeForces(); const F2a = copy(), ev2 = evs(); W.evq.length = 0;
    computeForces(); const F2b = copy(); W.evq.length = 0;
    const minPairs = TH.minPairs; TH.minPairs = 1e9;
    computeForces(); const F1 = copy(), ev1 = evs(); W.evq.length = 0;
    TH.minPairs = minPairs;
    // timing of the force pass, one and two threads
    const time = (k) => { let best = 1e9; for (let r = 0; r < 3; r++) { const t0 = performance.now(); for (let i = 0; i < k; i++) forcesNoEvents(); best = Math.min(best, (performance.now() - t0) / k); } return best; };
    const ms2 = time(20); TH.minPairs = 1e9; const ms1 = time(20); TH.minPairs = minPairs;
    // the physics: energy over 40 steps on two threads
    W.gamma = 0; forcesNoEvents(); W.fSpawn = W.spawned;
    const tot = () => totalEnergy().total - W.ledger.nuc, E0 = tot();
    for (let i = 0; i < 40; i++) { W.dt = chooseDt(); step(W.dt); }
    return { same: diff(F2a, F2b), vs1: diff(F2a, F1), ev2n: ev2.split(' ').length, evSame: ev1 === ev2, ms1, ms2, drift: tot() - E0, used: TH.used, nEv: W.evq.length };
  });
  say('forces:', JSON.stringify(r));
  check(r.same.m === 0, 'two threads twice: forces identical to the bit', r.same);
  check(r.vs1.m <= 1e-9 * Math.max(1, r.vs1.scale), 'two threads vs one: forces equal to rounding', r.vs1);
  check(r.evSame, 'two threads vs one: the same events queued, in the same order');
  check(Math.abs(r.drift) < 3, 'energy conserved over 40 steps on two threads (eV)', r.drift);
  say(`force pass: ${r.ms1.toFixed(2)} ms on one thread, ${r.ms2.toFixed(2)} ms on two`);
  // the Settings benchmark runs through its three worlds and reports
  await page.evaluate(() => { openSettings(); benchStart(); });
  await page.waitForFunction(() => !BENCH.busy, null, { timeout: 120000 }).catch(() => {});
  const bench = await page.evaluate(() => ({ busy: BENCH.busy, rows: BENCH.rows, text: document.getElementById('setBenchOut').textContent, preset: UI.preset, note: document.getElementById('setThreads').textContent }));
  say('benchmark:', bench.rows.join('\n           '));
  say('threads note:', bench.note);
  check(!bench.busy && bench.rows.length === 3 && /threads/.test(bench.rows[0]), 'the in-app benchmark ran its three worlds', bench);
  check(errors.length === 0, 'no page errors', errors.slice(0, 3).join('\n'));
  await ctx.close();
  // the plain page (file://, not isolated) falls back to one thread
  const ctx2 = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  await ctx2.route(/fonts\.(googleapis|gstatic)\.com/, (q) => q.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const p2 = await ctx2.newPage(); const err2 = [];
  p2.on('pageerror', (e) => err2.push('pageerror: ' + (e.stack || e.message)));
  await p2.goto('file://' + file); await p2.waitForTimeout(600);
  const fb = await p2.evaluate(() => { setSetting('threads', '4'); forcesNoEvents(); return { iso: crossOriginIsolated, avail: threadsAvailable(), n: TH.n, state: TH.state, t: W.t, note: document.getElementById('setThreads').textContent }; });
  say('plain page:', JSON.stringify(fb));
  check(!fb.iso && !fb.avail && fb.n === 0 && err2.length === 0, 'plain page runs on one thread without errors', err2.slice(0, 2).join('\n'));
  await browser.close(); server.close();
  say(fails ? `${fails} thread failure(s)` : 'thread checks passed');
  process.exitCode = fails ? 1 : 0;
})();
