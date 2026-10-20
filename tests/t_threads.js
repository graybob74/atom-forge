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
  check(r.same.m === 0, 'two threads twice: forces identical to the bit', r.same);
  check(r.spans.outside === 0 && r.spans.cover < 1, `the workers' force buffers are zero outside the intervals they report (summed over ${(100 * r.spans.cover).toFixed(0)}% of the slots)`, r.spans);
  check(r.vs1.m <= 1e-9 * Math.max(1, r.vs1.scale), 'two threads vs one: forces equal to rounding', r.vs1);
  check(r.vl.same && r.vl.threaded, `the neighbour list built on two threads is the one-thread list, pair for pair (${r.vl.np} pairs; ${r.vl.ms2} ms vs ${r.vl.ms1} ms)`, r.vl);
  check(r.bath.same, 'the heat bath on two threads gives the one-thread velocities to the bit', r.bath);
  check(r.ex.same && r.ex.counts[1] > 0, `the exclusion marks from the arrays, on two threads and one, equal the marks from the Sets (${r.ex.counts.join('/')} pairs free/excluded/same molecule)`, r.ex);
  check(r.evSame, 'two threads vs one: the same events queued, in the same order');
  check(Math.abs(r.drift) < 3, 'energy conserved over 40 steps on two threads (eV)', r.drift);
  say(`force pass: ${r.ms1.toFixed(2)} ms on one thread, ${r.ms2.toFixed(2)} ms on two`);
  // the Settings benchmark runs through its three worlds and reports
  await page.evaluate(() => { openSettings(); benchStart(); });
  await page.waitForFunction(() => !BENCH.busy, null, { timeout: 120000 }).catch(() => {});
  const bench = await page.evaluate(() => ({ busy: BENCH.busy, rows: BENCH.rows, text: document.getElementById('setBenchOut').textContent, preset: UI.preset, note: document.getElementById('setThreads').textContent }));
  say('benchmark:', bench.rows.join('\n           '));
  say('threads note:', bench.note);
  check(!bench.busy && bench.rows.length === 4 && /threads/.test(bench.rows[0]) && /room for \d+ fps/.test(bench.rows[1]), 'the in-app benchmark ran its four worlds', bench);
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
