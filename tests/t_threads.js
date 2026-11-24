'use strict';
/* The worker threads, in headless Chromium on a page served with the cross-origin isolation headers (as the desktop app
   serves it): the pair forces on two threads must equal the one-thread forces to rounding and queue the same events, run
   twice must give the same forces to the bit, and the physics must conserve energy as before; the plain file:// page
   (not isolated) must fall back to one thread. Also times the force pass on one and two threads.
   node tests/t_threads.js */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('./deps').dep('playwright'); // (the repository's node_modules on a PC, the preinstalled tools here)
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
  const browser = await chromium.launch(require('./deps').launchOpts({ headless: true }));
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
  await page.evaluate(() => { setRunning(false); setSetting('maxParts', 12000); setSetting('res', 'standard'); setSetting('effects', false); setSetting('threads', '2'); });
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
    // each worker's buffer is zero outside the intervals it reported (so summing only within them is the full sum)
    let outside = 0, cover = 0; const SP = 4 * TH.n + 32;
    for (let w = 0; w < TH.n; w++) { const o = SP + 4 * w, a = TH.prm; for (let q = 0; q < TH.fx[w].length; q++) { const inI = (q >= a[o] && q < a[o + 1]) || (q >= a[o + 2] && q < a[o + 3]); if (inI) cover++; else if (TH.fx[w][q] !== 0 || TH.fy[w][q] !== 0) outside++; } }
    const spans = { outside, cover: +(cover / (TH.n * n)).toFixed(3) };
    computeForces(); const F2b = copy(); W.evq.length = 0;
    const minPairs = TH.minPairs; TH.minPairs = 1e9;
    computeForces(); const F1 = copy(), ev1 = evs(); W.evq.length = 0;
    TH.minPairs = minPairs;
    // the neighbour list built on two threads is the one-thread list pair for pair; the bath on two threads gives the
    // one-thread velocities to the bit (counter-based noise)
    forcesNoEvents(); for (let k = 0; k < 50 && !threadsReady(); k++) { const t = performance.now(); while (performance.now() - t < 20) { /* (the workers bind to the grid's arrays) */ } }
    forcesNoEvents(); buildGrid(_mdI, _nmd);
    const builds2 = TH.vlBuilds || 0;
    let tv2 = performance.now(); vlBuild(); tv2 = performance.now() - tv2; const P2 = [VL.np, Int32Array.from(VL.pi.subarray(0, VL.np)), Int32Array.from(VL.pj.subarray(0, VL.np))];
    const keepVl = vlBuildAll; vlBuildAll = () => -1;
    let tv1 = performance.now(); vlBuild(); tv1 = performance.now() - tv1; vlBuildAll = keepVl;
    const vlSame = P2[0] === VL.np && P2[1].every((v, i) => v === VL.pi[i]) && P2[2].every((v, i) => v === VL.pj[i]);
    // the exclusion marks: on two threads from the arrays, on one thread from the arrays, and from the Sets: all the same
    VL.exTopo = -1; vlExclusions(); const EX2 = Uint8Array.from(VL.ex.subarray(0, VL.np));
    const keepEx = exAll; exAll = () => false; VL.exTopo = -1; vlExclusions(); const EX1 = Uint8Array.from(VL.ex.subarray(0, VL.np));
    const okWas = _exlOk; _exlOk = false; VL.exTopo = -1; vlExclusions(); const EXS = Uint8Array.from(VL.ex.subarray(0, VL.np)); _exlOk = okWas; exAll = keepEx;
    const exSame = EX2.every((v, q) => v === EX1[q] && v === EXS[q]), exCounts = [0, 0, 0]; for (const v of EXS) exCounts[v]++;
    const V0 = [Float64Array.from(S.vx.subarray(0, n)), Float64Array.from(S.vy.subarray(0, n))], FR0 = Uint8Array.from(S.fresh.subarray(0, n)); // (fresh flags: the bath clears them)
    W.gamma = 0.05; outerB(W.dt || 0.01); const VB2 = [Float64Array.from(S.vx.subarray(0, n)), Float64Array.from(S.vy.subarray(0, n))], need2 = _wallNeed;
    S.vx.set(V0[0]); S.vy.set(V0[1]); S.fresh.set(FR0); const keepBath = bathAll; bathAll = () => -1; outerB(W.dt || 0.01); bathAll = keepBath;
    const bathSame = VB2[0].every((v, i) => v === S.vx[i]) && VB2[1].every((v, i) => v === S.vy[i]) && need2 === _wallNeed && need2 >= 0;
    S.vx.set(V0[0]); S.vy.set(V0[1]);
    // timing of the force pass, one and two threads
    const time = (k) => { let best = 1e9; for (let r = 0; r < 3; r++) { const t0 = performance.now(); for (let i = 0; i < k; i++) forcesNoEvents(); best = Math.min(best, (performance.now() - t0) / k); } return best; };
    const ms2 = time(20); TH.minPairs = 1e9; const ms1 = time(20); TH.minPairs = minPairs;
    // the physics: energy over 40 steps on two threads
    W.gamma = 0; forcesNoEvents(); W.fSpawn = W.spawned;
    const tot = () => totalEnergy().total - W.ledger.nuc, E0 = tot();
    for (let i = 0; i < 40; i++) { W.dt = chooseDt(); step(W.dt); }
    return { same: diff(F2a, F2b), vs1: diff(F2a, F1), ev2n: ev2.split(' ').length, evSame: ev1 === ev2, ms1, ms2, drift: tot() - E0, used: TH.used, nEv: W.evq.length,
      vl: { same: vlSame, np: P2[0], ms2: +tv2.toFixed(2), ms1: +tv1.toFixed(2), threaded: (TH.vlBuilds || 0) > builds2, note: TH.vlNote, nocc: G.nocc, cap: VL.pi.length }, bath: { same: bathSame, need: need2 }, spans, ex: { same: exSame, counts: exCounts } };
  });
  say('forces:', JSON.stringify(r));
  // the WebAssembly kernel: ready in the page (the module compiles in the background), on the worker too, and the
  // forces on two threads with it agree with the JavaScript kernels on two threads to rounding
  const hasWasm = fs.existsSync(path.join(__dirname, '..', 'src', 'wasm', 'kernel.wasm'));
  await page.waitForFunction(() => WK.ready || !WK.on, null, { timeout: 15000 }).catch(() => {});
  const wk = await page.evaluate(() => {
    const n = S.hi, copy = () => [Float64Array.from(S.fx.subarray(0, n)), Float64Array.from(S.fy.subarray(0, n))];
    const diff = (A, B) => { let m = 0, scale = 0; for (let i = 0; i < n; i++) { m = Math.max(m, Math.abs(A[0][i] - B[0][i]), Math.abs(A[1][i] - B[1][i])); scale = Math.max(scale, Math.abs(A[0][i]), Math.abs(A[1][i])); } return { m, scale }; };
    const evs = () => W.evq.map(e => e.type + ':' + (e.a && e.a.id) + ':' + (e.b && e.b.id)).join(' ');
    WK.use = true; computeForces(); const Fw = copy(), evw = evs(); W.evq.length = 0; const usedW = TH.used;
    WK.use = false; computeForces(); const Fj = copy(), evj = evs(); W.evq.length = 0; const usedJ = TH.used;
    WK.use = true;
    return { on: WK.on, ready: WK.ready, note: WK.note, workers: TH.wasmOn.slice(0, TH.n), usedW, usedJ, vs: diff(Fw, Fj), evSame: evw === evj, grows: WK.grows, mb: +(WK.top / 1048576).toFixed(1) };
  });
  say('wasm:', JSON.stringify(wk));
  if (hasWasm) {
    check(wk.on && wk.ready, 'the WebAssembly kernel is ready in the isolated page', wk.note);
    check(wk.workers.length === 1 && wk.workers[0] === true, 'the worker runs the WebAssembly kernel too', wk.workers);
    check(wk.usedW === 2 && wk.usedJ === 2 && wk.vs.m <= 1e-9 * Math.max(1, wk.vs.scale) && wk.evSame, 'WebAssembly and JavaScript kernels on two threads: forces equal to rounding, same events', wk);
  } else say('(no src/wasm/kernel.wasm: the WebAssembly checks are skipped)');
  // the force pass trusting the threaded integrator (forces cleared, the list's largest move) runs bit for bit as without
  const it = await page.evaluate(() => {
    const seeded = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
    const run = (use) => {
      const rr = Math.random; Math.random = seeded(5); _intUse = use;
      baseWorld(300, 200, 300, 0.05); for (let i = 0; i < 40; i++) for (let j = 0; j < 30; j++) addMolecule('H2O', -150 + (i + 0.5) * 7.5, -100 + (j + 0.5) * 6.6, Math.random() * 6, 0);
      for (const p of W.parts) { p.vx = (Math.random() - 0.5) * 0.4; p.vy = (Math.random() - 0.5) * 0.4; } // (seeded: the engine's own random source is not)
      W.bathSeed = 777; // (each new world draws a new noise stream: the same for both runs)
      forcesNoEvents(); W.fSpawn = W.spawned; const b0 = VL.builds;
      for (let k = 0; k < 120; k++) { if (W.fSpawn !== W.spawned) { forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = chooseDt(); step(W.dt); }
      let h = 0; for (const p of W.parts) if (!p.dead) h += p.x * 1.1 + p.y * 1.3 + p.vx * 7 + p.vy * 11;
      Math.random = rr; _intUse = true; return { h, builds: VL.builds - b0, used: TH.used };
    };
    const a = run(true), b = run(false); return { a, b, same: a.h === b.h && a.builds === b.builds };
  });
  check(it.same && it.a.used === 2 && it.a.builds > 3, `the force pass taking the threaded integrator's cleared forces and list check: 120 steps bit for bit as without (${it.a.builds} list rebuilds)`, it);
  check(r.same.m === 0, 'two threads twice: forces identical to the bit', r.same);
  check(r.spans.outside === 0 && r.spans.cover < 1, `the workers' force buffers are zero outside the intervals they report (summed over ${(100 * r.spans.cover).toFixed(0)}% of the slots)`, r.spans);
  check(r.vs1.m <= 1e-9 * Math.max(1, r.vs1.scale), 'two threads vs one: forces equal to rounding', r.vs1);
  check(r.vl.same && r.vl.threaded, `the neighbour list built on two threads is the one-thread list, pair for pair (${r.vl.np} pairs; ${r.vl.ms2} ms vs ${r.vl.ms1} ms)`, r.vl);
  check(r.bath.same, 'the heat bath on two threads gives the one-thread velocities to the bit', r.bath);
  check(r.ex.same && r.ex.counts[1] > 0, `the exclusion marks from the arrays, on two threads and one, equal the marks from the Sets (${r.ex.counts.join('/')} pairs free/excluded/same molecule)`, r.ex);
  check(r.evSame, 'two threads vs one: the same events queued, in the same order');
  check(Math.abs(r.drift) < 3, 'energy conserved over 40 steps on two threads (eV)', r.drift);
  say(`force pass: ${r.ms1.toFixed(2)} ms on one thread, ${r.ms2.toFixed(2)} ms on two`);
  // 1.10: a longer force reach (Experimental): the workers are started again with the new cutoff (on the JavaScript kernels
  // until 1.28, when the WebAssembly one had 6 Å built in; in it since); two threads give the one-thread forces, and the pairs reach 9 Å
  await page.evaluate(() => { setSetting('rc', 9); });
  await page.waitForFunction(() => { forcesNoEvents(); return TH.state === 'on' && TH.used === 2; }, null, { timeout: 15000 }).catch(() => {});
  const rc = await page.evaluate(() => {
    const n = S.hi, copy = () => [Float64Array.from(S.fx.subarray(0, n)), Float64Array.from(S.fy.subarray(0, n))];
    computeForces(); const F2 = copy(); W.evq.length = 0; const used = TH.used;
    const minPairs = TH.minPairs; TH.minPairs = 1e9; computeForces(); const F1 = copy(); W.evq.length = 0; TH.minPairs = minPairs;
    let m = 0, scale = 0; for (let i = 0; i < n; i++) { m = Math.max(m, Math.abs(F2[0][i] - F1[0][i]), Math.abs(F2[1][i] - F1[1][i])); scale = Math.max(scale, Math.abs(F1[0][i])); }
    let far = 0; for (let k = 0; k < VL.np; k++) { const i = VL.pi[k], j = VL.pj[k], dx = S.x[j] - S.x[i], dy = S.y[j] - S.y[i]; if (dx * dx + dy * dy > 64) far++; }
    const out = { rc: RC, used, wasm: wasmReady(), workersWasm: TH.wasmOn.some(Boolean), m, scale, far, rcMod: wasmRcOk(), rc2: WK.ex && WK.ex.af_rc2 ? WK.ex.af_rc2() : 36 };
    setSetting('rc', 6); out.back = RC; out.wasmBack = wasmReady(); return out;
  });
  check(rc.rc === 9 && rc.used === 2 && rc.wasm === rc.rcMod && rc.workersWasm === rc.rcMod && (!rc.rcMod || rc.rc2 === 81) && rc.m <= 1e-9 * Math.max(1, rc.scale) && rc.far > 0 && rc.back === 6 && rc.wasmBack,
    `force reach 9 Å: two threads (${rc.rcMod ? 'WebAssembly, since 1.28' : 'JavaScript'}) vs one, forces equal to rounding; ${rc.far} pairs beyond 8 Å; back to 6 Å on WebAssembly`, rc);
  await page.waitForFunction(() => { forcesNoEvents(); return TH.state === 'on' && TH.used === 2; }, null, { timeout: 15000 }).catch(() => {}); // (the workers started again at 6 Å: bound before the benchmark)
  // the Settings benchmark runs through its three worlds and reports
  await page.evaluate(() => { openSettings(); benchStart(); });
  // 1.39.1: the benchmark's own mode. While it runs: Settings closed, the toolbar and panels gone, the bar with its
  // clock, Pause and Stop over the chamber; a key or the wheel over the chamber does nothing.
  const mode = await page.evaluate(() => { const vis = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && e.getClientRects().length > 0; };
    const s0 = R.s; document.getElementById('cv').dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
    const run0 = UI.running; window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
    return { cls: document.body.classList.contains('bench'), bar: vis('benchBar'), veil: vis('benchVeil'), set: vis('setModal'), topbar: document.querySelector('.topbar').getClientRects().length, panel: document.querySelector('.panel').getClientRects().length, menu: UI.menu && vis('mainMenu'), clock: document.getElementById('benchClock').textContent, pause: document.getElementById('benchPause').textContent, stop: document.getElementById('benchStop').textContent, zoomed: R.s !== s0, ran: UI.running !== run0 }; });
  await page.waitForFunction(() => !BENCH.busy, null, { timeout: 400000 }).catch(() => {}); // (seven worlds since 1.39.1)
  const bench = await page.evaluate(() => ({ busy: BENCH.busy, rows: BENCH.rows.slice(), text: document.getElementById('setBenchOut').textContent, preset: UI.preset, note: document.getElementById('setThreads').textContent }));
  { const end = await page.evaluate(async () => { const vis = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && e.getClientRects().length > 0; };
      const o = { cls: document.body.classList.contains('bench'), bar: vis('benchBar'), menu: UI.menu ? vis('mainMenu') : true, modal: vis('benchModal'), title: document.getElementById('benchTitle').textContent, took: document.getElementById('benchTook').textContent, text: document.getElementById('benchText').value, rows: BENCH.rows.length, setCopy: !document.getElementById('setBenchCopy').hidden };
      let copied = null; const real = navigator.clipboard && navigator.clipboard.writeText; try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { copied = t; return Promise.resolve(); } }, configurable: true }); } catch (e) { /* (left as it is) */ }
      document.getElementById('benchCopy').click(); await new Promise((r) => setTimeout(r, 50));
      o.note = document.getElementById('benchNote').textContent; o.copied = copied === null ? null : copied === o.text;
      document.getElementById('benchClose').click(); o.closed = !vis('benchModal');
      return o; });
    say('benchmark mode:', JSON.stringify(mode), '| end:', JSON.stringify({ ...end, text: end.text.length + ' chars' }));
    check(mode.cls && mode.bar && mode.veil && !mode.set && !mode.topbar && !mode.panel && !mode.menu && /^\d+:\d\d$/.test(mode.clock) && mode.pause === 'Pause' && mode.stop === 'Stop' && !mode.zoomed && !mode.ran
      && !end.cls && !end.bar && end.menu && end.modal && end.title === 'Benchmark results' && /^took \d+ min \d+ s$/.test(end.took) && end.rows === 8 && end.text.split('\n\n').length === 9 && /^Settings: up to/.test(end.text) && end.setCopy
      && end.note === 'Copied.' && end.copied !== false && end.closed,
      '1.39.1: the benchmark runs in its own mode (Settings and the panels away, a bar with a clock, Pause and Stop; the chamber takes no keys or wheel), then the lab comes back and the results open in a window whose Copy button copies them, a world to a paragraph', { mode, end: { ...end, text: end.text.slice(0, 200) } }); }
  // Pause holds the benchmark at its next break and the clock with it; Resume goes on; Stop ends it at the next break
  // with what was measured, and the setup that was open comes back
  { const pre = await page.evaluate(() => { if (UI.menu) { window.AF_NO_MENU = true; hideMainMenu(); } const p = UI.preset, top0 = document.querySelector('.topbar').getClientRects().length; benchStart(); const top1 = document.querySelector('.topbar').getClientRects().length; document.getElementById('benchPause').click(); return { preset: p, label: document.getElementById('benchPause').textContent, top0, top1 }; });
    await page.waitForFunction(() => BENCH.paused, null, { timeout: 20000 }).catch(() => {});
    const held = await page.evaluate(async () => { const c0 = document.getElementById('benchClock').textContent, t0 = benchTime(); await new Promise((r) => setTimeout(r, 1300));
      const o = { paused: BENCH.paused, label: document.getElementById('benchPause').textContent, what: document.getElementById('benchWhat').textContent, same: document.getElementById('benchClock').textContent === c0 && benchTime() === t0, rows: BENCH.rows.length };
      document.getElementById('benchPause').click(); o.after = document.getElementById('benchPause').textContent; await new Promise((r) => setTimeout(r, 300)); /* (the first world is being measured by now) */ window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); o.stop = document.getElementById('benchStop').textContent; return o; });
    await page.waitForFunction(() => !BENCH.busy, null, { timeout: 120000 }).catch(() => {});
    const fin = await page.evaluate(() => { const o = { top: document.querySelector('.topbar').getClientRects().length, busy: BENCH.busy, rows: BENCH.rows.length, stopped: BENCH.stopped, title: document.getElementById('benchTitle').textContent, text: document.getElementById('benchText').value, out: document.getElementById('setBenchOut').textContent, preset: UI.preset, cls: document.body.classList.contains('bench') }; document.getElementById('benchClose').click(); return o; });
    say('pause and stop:', JSON.stringify(pre), JSON.stringify(held), JSON.stringify({ ...fin, text: fin.text.slice(-60), out: fin.out.slice(-60) }));
    check(pre.label === 'Pausing…' && pre.top0 > 0 && pre.top1 === 0 && fin.top > 0 && held.paused && held.label === 'Resume' && held.what === 'paused' && held.same && held.rows === 0 && held.after === 'Pause' && held.stop === 'Stopping…'
      && !fin.busy && fin.stopped && fin.rows >= 1 && fin.rows < 8 && fin.title === 'Benchmark stopped' && /\(stopped after 1 of 7 worlds\)$/.test(fin.text) && /stopped after 1 of 7 worlds$/.test(fin.out) && fin.preset === pre.preset && !fin.cls,
      '1.39.1: Pause holds the benchmark and its clock at the next break, Resume goes on, and Stop (or Esc) ends it there with the worlds measured so far and the setup that was open back', { pre, held, fin: { ...fin, text: fin.text.slice(-80), out: fin.out.slice(-80) } }); }
  say('benchmark:', bench.rows.join('\n           '));
  say('threads note:', bench.note);
  check(!bench.busy && bench.rows.length === 8 && /threads/.test(bench.rows[0]) && /20,000-atom goal/.test(bench.rows[1]) && /room for \d+ fps/.test(bench.rows[2]), 'the in-app benchmark ran its seven worlds and judged the 20,000-atom goal', bench);
  // 1.39.1: three more worlds (collision products and free electrons, flat and in 3-D; water in 3-D), and the zoom check
  // on the first water world and the two crowds: real frames, drawing only, at the full view and zoomed in, with the
  // time between frames, the drawing script and the graphics card's share. The crowds' rows name the unstable
  // particles' flight and count the free electrons' pair-list rebuilds; the page draws its own frames again afterwards.
  { const r = bench.rows, zoomRe = /view, drawing only: full view ([\d.]+) ms between frames \(slowest \d+\), drawing script ([\d.]+)(, graphics card [\d.]+)?; zoomed in \((60 px\/Å|camera at 6% of its distance)\) ([\d.]+) ms between frames/;
    const z0 = zoomRe.exec(r[0] || ''), z5 = zoomRe.exec(r[5] || ''), z6 = zoomRe.exec(r[6] || '');
    const after = await page.evaluate(() => ({ own: BENCH.own, d3: W.d3, drawn: (() => { const c0 = GL.calls; render(W.rt || 0); return GL.ok && GL.on ? GL.calls !== c0 || GL.calls > 0 : true; })() }));
    say('zoom check:', [z0, z5, z6].map((z) => z ? `${z[1]} → ${z[5]} ms (${z[4]})` : 'missing').join('; '));
    check(z0 && z5 && z6 && z0[4] === '60 px/Å' && z6[4] === 'camera at 6% of its distance' && +z5[1] > 0 && +z5[5] > 0 && !zoomRe.test(r[2]) && !zoomRe.test(r[7])
      && /^Collision products and free electrons, flat/.test(r[5]) && /^Collision products and free electrons in 3-D/.test(r[6]) && /atoms of water in 3-D/.test(r[7])
      && /unstable particles' flight [\d.]+/.test(r[5]) && /unstable particles' flight [\d.]+/.test(r[6]) && /rebuilds of the free electrons' pair list/.test(r[5]) && /kernels [\d.]+/.test(r[7])
      && !after.own && !after.d3 && after.drawn,
      '1.39.1: the benchmark runs a crowd of collision products and free electrons (flat and 3-D) and water in 3-D, and times real frames at the full view and zoomed in on three of its worlds', { rows: r.slice(5).map((x) => x.slice(0, 300)), after }); }
  // 1.39.1: the benchmark's per-thread line. Each worker times its own share of every threaded phase and notes when it
  // picked the order up; the row gives, per phase, the main thread's share, the phase's length, the workers' work and
  // start (fastest/middle/slowest) and every worker's work. A worker's work fits inside the phase the main thread timed.
  { const row = bench.rows[0] || '', ph = {};
    for (const m of row.matchAll(/(\w+) own (\d+), phase (\d+), work (\d+)\/(\d+)\/(\d+), start (-?\d+)\/(-?\d+)\/(-?\d+) \(worst (-?\d+)\) \[([\d ]+)\]/g)) ph[m[1]] = { own: +m[2], phase: +m[3], slowest: +m[6], start: +m[8], list: m[11].split(' ').map(Number) };
    const names = Object.keys(ph), ok = (k) => ph[k] && ph[k].list.length === 1 && ph[k].slowest > 0 && ph[k].slowest <= 1.3 * ph[k].phase + 60 && ph[k].start > -200 && ph[k].start < ph[k].phase + 200;
    say('per thread:', names.map((k) => `${k} own ${ph[k].own} phase ${ph[k].phase} work ${ph[k].slowest} start ${ph[k].start}`).join('; '));
    check(/per thread, µs a call/.test(row) && ok('pairs') && ok('sum') && ok('integ') && ok('bath') && names.every(ok),
      '1.39.1: the benchmark lists each thread\'s own time per phase (pairs, sum, integration, bath, timestep), inside the phase the main thread timed', { ph }); }
  // 1.39.1: the per-slot phases are shared by pieces (thNext). Whatever the order the threads ask in, every piece is
  // handed out exactly once and none twice; a thread starts on its own run and only then takes from the others; and the
  // benchmark says how many pieces changed hands. (That the simulation is the same to the bit as before the change is
  // tools/thhash.js's fingerprint, run on both builds: PERF-NOTES 1.39.1.)
  { const sh = await page.evaluate(() => {
      const out = [];
      for (const hi of [2000, 12000, 12001, 127, 128 * 3]) for (let trial = 0; trial < 6; trial++) {
        const n = TH.n, ctrl = TH.ctrl, ch = thShares(hi, trial > 3), nc = Math.ceil(hi / ch), seen = new Uint8Array(nc), st = [], first = [], took = new Int32Array(n + 1); // (the last two trials: the light phases' two pieces a thread)
        const own = []; for (let t = 0; t <= n; t++) { own.push([ctrl[thCtrl(t, 0)], ctrl[thCtrl(t, 1)]]); st.push(new Int32Array(2)); first.push(-1); }
        let a = 7 + 31 * trial + hi, live = n + 1, twice = 0, wrongFirst = 0; const done = new Uint8Array(n + 1);
        while (live) { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; const me = trial === 0 ? 0 : trial === 1 ? n : a % (n + 1); let t = me; while (done[t]) t = (t + 1) % (n + 1); // (trial 0: one thread takes everything; 1: the main thread does; then mixed)
          const c = thNext(ctrl, n, t, st[t]);
          if (c < 0) { done[t] = 1; live--; continue; }
          if (seen[c]) twice++; seen[c] = 1; took[t]++;
          if (first[t] < 0) { first[t] = c; if (own[t][0] < own[t][1] && !(c >= own[t][0] && c < own[t][1]) && !seenAll(seen, own[t])) wrongFirst++; } }
        let missed = 0; for (let c = 0; c < nc; c++) if (!seen[c]) missed++;
        out.push({ hi, trial, nc, twice, missed, wrongFirst, last: own[n][1], cover: own.every((o, t) => o[0] === (t ? own[t - 1][1] : 0)) });
      }
      function seenAll(seen, o) { for (let c = o[0]; c < o[1]; c++) if (!seen[c]) return false; return true; }
      return out;
    });
    const bad = sh.filter((r) => r.twice || r.missed || r.wrongFirst || r.last !== r.nc || !r.cover);
    const took = (bench.rows[0] || '').match(/[\d.]+ of \d+ pieces changed hands/g) || [];
    const starts = (bench.rows[0] || '').match(/\] starts \[-?\d+( -?\d+)*\]/g) || [];
    say('pieces:', `${sh.length} share-outs checked;`, took.join('; '));
    check(sh.length === 30 && !bad.length && took.length === 4 && starts.length === 5, '1.39.1: shared by pieces, every piece is handed out exactly once in any order, own run first; the benchmark counts the pieces that changed hands (sum, integration, bath, timestep) and lists each worker\'s start', { bad, took, starts }); }
  // 3-D (stage 4): the 3-D pair, bond, angle and dihedral forces shared over two threads give the one-thread forces to
  // rounding, the same events in the same order, and the same forces to the bit when run twice; each worker's buffers (z
  // too) are zero outside the intervals it reports; energy is kept over 40 insulated steps; and with af_forces3 (when the
  // module has it: skipped with a note before CI rebuilds it) the WebAssembly kernels on both threads equal the JavaScript
  // 3-D kernels to rounding. Liquid water (70,000 pairs), salt in water (ions, electron-transfer candidates), and the
  // molecules setup with the pass forced onto both threads (flat centres, dihedrals).
  await page.evaluate(() => { setRunning(false); setSetting('threads', '2'); loadPreset('water3d'); setRunning(false); });
  await page.waitForFunction(() => { forcesNoEvents(); return TH.state === 'on' && TH.used === 2; }, null, { timeout: 15000 }).catch(() => {});
  const r3 = await page.evaluate(async () => {
    const out = {};
    for (const key of ['water3d', 'brine3d', 'mol3d']) {
      loadPreset(key); setRunning(false); W.gamma = 0.05;
      const minPairs = TH.minPairs; if (key === 'mol3d') TH.minPairs = 10;
      for (let k = 0; k < 30; k++) { if (W.fSpawn !== W.spawned) { forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = chooseDt(); step(W.dt); }
      // (the workers acknowledge a new world's memory on their own time: wait for them, up to 15 s, so the measurement is
      // not taken while they are still 'starting'; a synchronous run could catch them before, the old 'not ready' flake)
      for (const t0 = performance.now(); !threadsReady() && performance.now() - t0 < 15000;) await new Promise(r => setTimeout(r, 20));
      const n = S.hi, copy = () => [Float64Array.from(S.fx.subarray(0, n)), Float64Array.from(S.fy.subarray(0, n)), Float64Array.from(S.fz.subarray(0, n))];
      const diff = (A, B) => { let m = 0, scale = 0; for (let a = 0; a < 3; a++) for (let i = 0; i < n; i++) { m = Math.max(m, Math.abs(A[a][i] - B[a][i])); scale = Math.max(scale, Math.abs(A[a][i])); } return { m, scale }; };
      const evs = () => W.evq.map(e => e.type + ':' + (e.a && e.a.id) + ':' + (e.b && e.b.id)).join(' ');
      W.evq.length = 0;
      computeForces(); const A = copy(), evA = evs(), used = TH.used; W.evq.length = 0;
      let outside = 0; const SP = 4 * TH.n + 32;
      for (let w = 0; w < TH.n; w++) { const o = SP + 4 * w, a = TH.prm; for (let q = 0; q < TH.fx[w].length; q++) { const inI = (q >= a[o] && q < a[o + 1]) || (q >= a[o + 2] && q < a[o + 3]); if (!inI && (TH.fx[w][q] !== 0 || TH.fy[w][q] !== 0 || TH.fz[w][q] !== 0)) outside++; } }
      computeForces(); const B = copy(); W.evq.length = 0;
      TH.minPairs = 1e9; computeForces(); const C = copy(), evC = evs(); W.evq.length = 0; TH.minPairs = key === 'mol3d' ? 10 : minPairs;
      let wk = { has3: WK.has3, note: WK.note3 };
      if (WK.has3) {
        WK.use = true; const c3 = WK.calls3; computeForces(); const Fw = copy(), evw = evs(); W.evq.length = 0; const usedW = TH.used, calls = WK.calls3 - c3;
        WK.use = false; computeForces(); const Fj = copy(), evj = evs(); W.evq.length = 0; WK.use = true;
        wk = Object.assign(wk, { usedW, calls, workers: TH.wasmOn.slice(0, TH.n), vs: diff(Fw, Fj), evSame: evw === evj });
      }
      // the 3-D neighbour list built on two threads is the one-thread list, pair for pair
      forcesNoEvents(); buildGrid(_mdI, _nmd);
      const vb0 = TH.vlBuilds || 0; vlBuild(); const L2 = [VL.np, Int32Array.from(VL.pi.subarray(0, VL.np)), Int32Array.from(VL.pj.subarray(0, VL.np))], vlThreaded = (TH.vlBuilds || 0) > vb0, vlNote = TH.vlNote;
      const keepVl = vlBuildAll3; vlBuildAll3 = () => -1; vlBuild(); vlBuildAll3 = keepVl;
      const vlSame = L2[0] === VL.np && L2[1].every((v, i) => v === VL.pi[i]) && L2[2].every((v, i) => v === VL.pj[i]);
      vlExclusions();
      // energy over 40 insulated steps on two threads
      W.gamma = 0; forcesNoEvents(); W.fSpawn = W.spawned;
      const tot = () => totalEnergy().total - W.ledger.nuc, E0 = tot();
      for (let k = 0; k < 40; k++) { W.dt = chooseDt(); step(W.dt); }
      const drift = tot() - E0, usedRun = TH.used;
      TH.minPairs = minPairs;
      out[key] = { n, np: VL.np, centres: AC.n, dihedrals: AC3.nt, used, usedRun, same: diff(A, B), vs1: diff(A, C), evN: evA ? evA.split(' ').length : 0, evSame: evA === evC, outside, drift: +drift.toFixed(4), wk, vl: { same: vlSame, threaded: vlThreaded, note: vlNote, np: L2[0] } };
    }
    return out;
  });
  for (const [key, v] of Object.entries(r3)) {
    say(`3-D ${key}:`, JSON.stringify(v));
    check(v.used === 2 && v.usedRun === 2, `3-D ${key}: the force pass ran on two threads`, v);
    check(v.same.m === 0, `3-D ${key}: two threads twice, forces identical to the bit`, v.same);
    check(v.vs1.m <= 1e-9 * Math.max(1, v.vs1.scale), `3-D ${key}: two threads vs one, forces equal to rounding (${v.np} pairs, ${v.centres} centres, ${v.dihedrals} dihedrals)`, v.vs1);
    check(v.evSame, `3-D ${key}: two threads vs one, the same ${v.evN} events in the same order`);
    check(v.outside === 0, `3-D ${key}: the workers' force buffers (x, y and z) are zero outside the intervals they report`, v.outside);
    check(v.vl.same && v.vl.threaded, `3-D ${key}: the neighbour list built on two threads is the one-thread list, pair for pair (${v.vl.np} pairs)`, v.vl);
    check(Math.abs(v.drift) < 3, `3-D ${key}: energy kept over 40 insulated steps on two threads (${v.drift} eV)`, v.drift);
    if (v.wk.has3) check(v.wk.usedW === 2 && v.wk.calls > 0 && v.wk.workers[0] === true && v.wk.vs.m <= 1e-9 * Math.max(1, v.wk.vs.scale) && v.wk.evSame,
      `3-D ${key}: af_forces3 on both threads equals the JavaScript 3-D kernels to rounding, the same events`, v.wk);
    else say(`  (3-D ${key}: the WebAssembly 3-D check is skipped: ${v.wk.note}; it runs once CI has rebuilt kernel.wasm)`);
  }
  // 1.13: up to 32 threads (a 16-core processor's two per core): 31 workers give the one-thread forces to rounding
  await page.evaluate(() => { setRunning(false); setSetting('threads', '32'); TH.minPairs = 100; });
  await page.evaluate(BUILD);
  await page.waitForFunction(() => { forcesNoEvents(); return TH.state === 'on' && TH.used === 32; }, null, { timeout: 150000 }).catch(() => {});
  const t32 = await page.evaluate(() => {
    const n = S.hi, copy = () => [Float64Array.from(S.fx.subarray(0, n)), Float64Array.from(S.fy.subarray(0, n))];
    computeForces(); const A = copy(), used = TH.used; W.evq.length = 0;
    TH.minPairs = 1e9; computeForces(); const B = copy(); W.evq.length = 0; TH.minPairs = 1500;
    let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(A[0][i] - B[0][i]), Math.abs(A[1][i] - B[1][i]));
    setSetting('threads', 'auto'); return { used, n: TH.n, diff: m };
  });
  say('32 threads:', JSON.stringify(t32));
  check(t32.used === 32 && t32.diff < 1e-9, '1.13: 32 threads give the one-thread forces', t32);
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
  // without shared memory the page gets the kernels from the plain module on an ordinary memory (when the build has it)
  const fbw = await p2.evaluate(async () => { const t0 = performance.now(); while (!WK.ready && WK.on && performance.now() - t0 < 5000) await new Promise(r => setTimeout(r, 30)); loadPreset('water'); setRunning(false); forcesNoEvents(); return { on: WK.on, ready: WK.ready, plain: WK.plain, note: WK.note, calls: WK.calls, mb: WK.mem ? WK.mem.buffer.byteLength >> 20 : 0, hasPlain: typeof KERNEL_PLAIN_WASM_B64 === 'string' && !!KERNEL_PLAIN_WASM_B64 }; });
  say('plain page kernel:', JSON.stringify(fbw));
  if (fbw.hasPlain) check(fbw.on && fbw.ready && fbw.plain && fbw.calls > 0 && fbw.mb === 128, 'plain page (no shared memory) runs the kernels from the plain module', fbw);
  else check(!fbw.on && !fbw.ready, 'plain page (no shared memory, no plain module) keeps the JavaScript kernels', fbw);
  await browser.close(); server.close();
  say(fails ? `${fails} thread failure(s)` : 'thread checks passed');
  process.exitCode = fails ? 1 : 0;
})();
