'use strict';
/* The 1.26 checks for the WebAssembly speed-ups (kernel/src/vl.rs, d3.rs tors1, bo.rs's 3-D pass, mb.rs, qeq.rs; the
   JavaScript stays the reference), run by t_features (its "1.26 (speed)" block) or alone:
     node tests/f_126w.js [part …]   (parts: vl, tors1, bo3, mb, qeq, grow, page)
   Each part fails on 1.25.0 (no such export, no wasmIn). Node harness, one thread, deterministic; page: the same paths in
   the headless page (its module compiled in the background, the plain memory without isolation). (check(ok, good, bad)) */
const { load } = require('./load');
const PARTS = {};
const steps = (X, n) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };
const hash = (X) => { let h = 0n; const M = (1n << 61n) - 1n, b = new BigInt64Array(1), f = new Float64Array(b.buffer); for (const p of X.W.parts) { if (p.dead) continue; for (const v of [p.x, p.y, p.z || 0, p.vx, p.vy, p.vz || 0, p.q, p.qp || 0]) { f[0] = v; h = (h * 1000003n + (b[0] & M)) % M; } } return h.toString(16); };
const has = (X, f) => !!(X.WK.ready && X.WK.ex && typeof X.WK.ex[f] === 'function');
const organic = (X) => { X.baseWorld(30, 30, 300, 0.05); X.world3d(30); ['butane', 'ethanol', 'propene', 'acetaldehyde', 'H2O2', 'methylamine', 'benzene', 'CO2', 'SF6', 'PCl5', 'XeF4', 'H3Op'].forEach((k, i) => X.addMolecule(k, -10 + 7 * (i % 4), -9 + 7 * Math.floor(i / 4), X.rnd() * 6, 300, i % 2 ? 5 : -5)); X.settleOverlaps(); };
const metal = (X, sym, a, R, d3) => { X.baseWorld(R * 6, R * 6, 300, 0.05); if (d3) X.world3d(R * 6);
  if (!d3) { const n = Math.ceil(R / a) + 1; for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) { const x = (i + 0.5 * (j & 1)) * a, y = j * a * Math.sqrt(3) / 2; if (x * x + y * y <= R * R) X.addAtom(sym, x, y); } }
  else { const c = a * Math.SQRT2, B = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]], n = Math.ceil(R / c) + 1; for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) for (const b of B) { const x = (i + b[0]) * c, y = (j + b[1]) * c, z = (k + b[2]) * c; if (x * x + y * y + z * z <= R * R) X.addAtom(sym, x, y, { z }); } }
  X.settleOverlaps(); };
const forces = (X) => ['fx', 'fy', 'fz'].map(k => Float64Array.from(X.S[k].subarray(0, X.S.hi)));
const fdiff = (a, b) => { let d = 0, m = 0; for (let k = 0; k < 3; k++) for (let i = 0; i < a[k].length; i++) { d = Math.max(d, Math.abs(a[k][i] - b[k][i])); m = Math.max(m, Math.abs(a[k][i])); } return { d, m }; };
const maxdx = (A, B) => { let d = 0; A.W.parts.forEach((p, i) => { const q = B.W.parts[i]; d = Math.max(d, Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs((p.z || 0) - (q.z || 0))); }); return d; };

/* ---- 1. the neighbour list's walk in the module (af_vl, af_vl3): the JavaScript's list pair for pair (whole, and in the
   three stretches the workers build), and whole runs the same to the bit with it and without */
PARTS.vl = async (page, check) => {
  const out = { lists: [], runs: [] }; let ok = true;
  for (const pre of ['water', 'brine', 'water3d', 'brine3d']) {
    const X = load('all', { seed: 7 }), { W, S, G } = X;
    if (!has(X, 'af_vl3')) { ok = false; out.lists.push(pre + ': no af_vl3'); continue; }
    X.PRESETS[pre].build(); steps(X, 10); X.forcesNoEvents(); X.gridEnsure(); G.RL2 = X.RL2;
    const d3 = !!W.d3, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = W.box.d, hw = bw / 2, hh = bh / 2, hd = bd / 2, cap = 256 * X._nmd + 4096;
    const a = [X.shArray(Int32Array, cap), X.shArray(Int32Array, cap)], b = [X.shArray(Int32Array, cap), X.shArray(Int32Array, cap)];
    const walk = (w, arr, p0, p1, base, c) => d3 ? X.vlPairs3W(w, X.WK.ex, p0, p1, arr[0], arr[1], base, c, G, X._mdI, S.k, wrap, bw, bh, bd, hw, hh, hd) : X.vlPairsW(w, X.WK.ex, p0, p1, arr[0], arr[1], base, c, G, X._mdI, S.k, wrap, bw, bh, hw, hh);
    const end = d3 ? Infinity : G.nocc, n = walk(false, a, 0, end, 0, cap), m = walk(true, b, 0, end, 0, cap);
    let same = n === m && n > 0; for (let k = 0; same && k < n; k++) if (a[0][k] !== b[0][k] || a[1][k] !== b[1][k]) same = false;
    const cut = d3 ? [0, Math.floor(G.n / 3), Math.floor(2 * G.n / 3), Infinity] : [0, Math.floor(G.nocc / 3), Math.floor(2 * G.nocc / 3), G.nocc], per = Math.floor(cap / 3); let k = 0, s3 = true;
    for (let w = 0; w < 3; w++) { const c = walk(true, b, cut[w], cut[w + 1], w * per, per); if (c < 0) { s3 = false; break; } for (let u = 0; u < c; u++, k++) if (b[0][w * per + u] !== a[0][k] || b[1][w * per + u] !== a[1][k]) s3 = false; }
    s3 = s3 && k === n;
    out.lists.push(`${pre} ${n} pairs ${same && s3 ? 'same' : 'DIFFERENT'}`); ok = ok && same && s3;
  }
  for (const pre of ['water', 'combustion', 'water3d', 'hydrogen3d']) {
    const run = (w) => { const X = load('all', { seed: 7 }); X.VL.useWasm = w; X.PRESETS[pre].build(); X.W.decayOn = false; steps(X, 60); return { h: hash(X), calls: X.WK.vlCalls }; };
    const a = run(false), b = run(true);
    out.runs.push(`${pre} ${a.h === b.h ? 'same' : 'DIFFERENT'} (${b.calls} module walks)`); ok = ok && a.h === b.h && b.calls > 0 && a.calls === 0;
  }
  check(ok, `1.26 the neighbour list in WebAssembly: the JavaScript's list pair for pair (${out.lists.join(', ')}; whole and in three stretches); 60-step runs to the bit (${out.runs.join(', ')})`, '1.26 vl: ' + JSON.stringify(out));
};
/* ---- 2. the single bonds' twist in the module (af_tors1): the forces to the bit, runs to the bit */
PARTS.tors1 = async (page, check) => {
  const r = {};
  const mk = (w) => { const X = load('all', { seed: 5 }); organic(X); X.AC3.useWasm = w; X.forcesNoEvents(); return X; };
  const A = mk(false), B = mk(true);
  r.has = has(B, 'af_tors1'); r.dihedrals = B.AC3.ns; r.bitsF = forces(A).every((a, k) => a.every((v, i) => v === forces(B)[k][i]));
  steps(A, 100); steps(B, 100); r.run = hash(A) === hash(B); r.calls = B.WK.t1Calls; r.callsJS = A.WK.t1Calls;
  check(r.has && r.dihedrals > 20 && r.bitsF && r.run && r.calls > 100 && r.callsJS === 0,
    `1.26 the single bonds' twist in WebAssembly: ${r.dihedrals} dihedrals, forces to the bit, a 100-step run to the bit (${r.calls} module passes)`, '1.26 tors1: ' + JSON.stringify(r));
};
/* ---- 3. continuous bond orders in 3-D in the module (bo.rs): the energy, forces and orders of one pass against the
   JavaScript pass (1e-9 of the energy, 1e-10 of the largest force), short runs together; and faster */
PARTS.bo3 = async (page, check) => {
  const r = { cases: [] }; let ok = true;
  for (const scen of ['water3d', 'organic']) {
    const mk = (w) => { const X = load('all', { seed: 9 }); if (scen === 'organic') organic(X); else X.PRESETS[scen].build(); X.BF.useWasm = w; X.boSet(1); X.forcesNoEvents(); return X; };
    const A = mk(false), B = mk(true), c0 = B.BFW.calls || 0;
    const fd = fdiff(forces(A), forces(B)), dE = Math.abs(A.BO.E - B.BO.E);
    const n = scen === 'water3d' ? 6 : 60; steps(A, n); steps(B, n);
    const dx = maxdx(A, B), calls = (B.BFW.calls || 0) - c0;
    const good = B.BFW.has3 && calls > n && dE <= 1e-9 * Math.abs(A.BO.E) && fd.d <= 1e-10 * fd.m && dx < 1e-9 && (A.BFW.calls || 0) === 0;
    r.cases.push(`${scen}: ΔE ${dE.toExponential(1)} eV, forces ${fd.d.toExponential(1)} (largest ${fd.m.toFixed(1)}) eV/Å, ${n} steps ${dx.toExponential(1)} Å apart, ${calls} module passes`); ok = ok && good;
  }
  { // the speed: the molecules in space with bond orders, the two passes interleaved (expected ×3–3.5; asked ×1.5)
    const mk = (w) => { const X = load('all', { seed: 9 }); X.PRESETS.mol3d.build(); X.BF.useWasm = w; X.boSet(1); X.forcesNoEvents(); steps(X, 5); return X; };
    const A = mk(false), B = mk(true); let ta = 0, tb = 0;
    for (let k = 0; k < 3; k++) { let t = performance.now(); steps(A, 20); ta += performance.now() - t; t = performance.now(); steps(B, 20); tb += performance.now() - t; }
    r.speed = +(ta / tb).toFixed(2); ok = ok && r.speed >= 1.5;
  }
  check(ok, `1.26 continuous bond orders in 3-D in WebAssembly: ${r.cases.join('; ')}; the molecules in space ×${r.speed} faster a step`, '1.26 bo3: ' + JSON.stringify(r));
};
/* ---- 4. bond orders for metals in the module (af_mb): one pass's energy and forces against the JavaScript's (1e-12),
   runs together, flat and 3-D */
PARTS.mb = async (page, check) => {
  const r = { cases: [] }; let ok = true;
  for (const [name, sym, a, R, d3] of [['flat Al', 'Al', 2.86, 14, false], ['3-D Al ball', 'Al', 2.86, 10, true], ['3-D Cu ball', 'Cu', 2.56, 8, true]]) {
    const mk = (w) => { const X = load('all', { seed: 9 }); metal(X, sym, a, R, d3); X.mbSet(1); X.MBO.useWasm = w; X.forcesNoEvents(); return X; };
    const A = mk(false), B = mk(true), c0 = B.MBW.calls;
    const fd = fdiff(forces(A), forces(B)), dE = Math.abs(A.MBO.E - B.MBO.E);
    steps(A, 30); steps(B, 30); const dx = maxdx(A, B), calls = B.MBW.calls - c0;
    const good = calls > 30 && A.MBW.calls === 0 && B.MBO.n > 50 && dE <= 1e-12 * Math.abs(A.MBO.E) && fd.d <= 1e-12 * Math.max(1, fd.m) && dx < 1e-9;
    r.cases.push(`${name} (${B.MBO.n} members): ΔE ${dE.toExponential(1)} eV, forces ${fd.d.toExponential(1)} eV/Å, 30 steps ${dx.toExponential(1)} Å apart`); ok = ok && good;
  }
  check(ok, `1.26 bond orders for metals in WebAssembly: ${r.cases.join('; ')}`, '1.26 mb: ' + JSON.stringify(r));
};
/* ---- 5. induced charges' pairs in the module (af_qeq): runs to the bit, flat and 3-D */
PARTS.qeq = async (page, check) => {
  const r = []; let ok = true;
  for (const [pre, n] of [['water', 60], ['brine', 20], ['water3d', 12]]) {
    const run = (w) => { const X = load('all', { seed: 9 }); X.PRESETS[pre].build(); X.QEQ.every = 1; X.QB.useWasm = w; steps(X, n); return { h: hash(X), calls: X.QB.calls, n: X.QEQ.n }; };
    const a = run(false), b = run(true);
    r.push(`${pre} ${a.h === b.h ? 'same' : 'DIFFERENT'} (${b.calls} module passes, ${b.n} updates)`); ok = ok && a.h === b.h && b.calls >= n && a.calls === 0 && b.n === a.n;
  }
  check(ok, `1.26 induced charges' pairs in WebAssembly: every-step updates to the bit (${r.join(', ')})`, '1.26 qeq: ' + JSON.stringify(r));
};
/* ---- 5a. after the module's memory grows (a shared memory hands out a new buffer object; the views made before keep the
   old one): the flat bond orders and the free electrons' kernel still run in the module (on 1.25 they went to the
   JavaScript for good, and the bond orders' scratch arrays were made again at every pass), the run the same to the bit */
PARTS.grow = async (page, check) => {
  const run = (grow) => {
    const X = load('all', { seed: 3 }), W = X.W; X.PRESETS.water.build(); W.decayOn = false; X.boSet(1);
    for (let k = 0; k < 6; k++) X.spawnSpec({ kind: 'e' }, -20 + 8 * k, 12, 300);
    if (grow) X.wasmArray(Float64Array, 3e6); // (24 MB: past the 16 MB the memory starts with)
    const g0 = X.WK.grows, b0 = X.BFW.calls || 0, f0 = X.WK.fastCalls, top0 = X.WK.top; steps(X, 30);
    return { h: hash(X), grew: X.WK.grows - g0 + (grow ? 1 : 0), bo: (X.BFW.calls || 0) - b0, fast: X.WK.fastCalls - f0, mb: +((X.WK.top - top0) / 1048576).toFixed(2), inMem: (() => { try { return X.wasmIn(X.S.x, X.VL.pi); } catch (e) { return null; } })() }; // (null: no wasmIn, 1.25)
  };
  const a = run(false), b = run(true);
  check(b.grew > 0 && b.inMem && b.bo >= 30 && b.fast > 0 && b.fast === a.fast && a.h === b.h && b.mb < 1,
    `1.26 after the memory grows: the bond orders' passes (${b.bo}) and the free electrons' kernel (${b.fast} calls) stay in the module, nothing reallocated (${b.mb} MB more in 30 steps), the run the same to the bit`, '1.26 grow: ' + JSON.stringify({ a, b }));
};
/* ---- 6. the page: the paths taken in the headless page's own module (the 3-D bond orders, the list's walk) */
PARTS.page = async (page, check) => {
  const r = await page.evaluate(async () => {
    for (let k = 0; k < 100 && !WK.ready; k++) await new Promise(res => setTimeout(res, 50)); // (the module compiles in the background)
    const out = { ready: WK.ready, plain: WK.plain, note: WK.note };
    const v0 = WK.vlCalls; loadPreset('mol3d'); setRunning(false); setSetting('bo', 1); const b0 = BFW.calls || 0;
    for (let f = 0; f < 10; f++) { W.dt = chooseDt(); step(W.dt); }
    out.vl = WK.vlCalls - v0; out.bo = (BFW.calls || 0) - b0; out.has3 = BFW.has3; out.members = BF.nm;
    setSetting('bo', 0); loadPreset('empty');
    return out;
  });
  check(r.ready && r.has3 && r.bo >= 10 && r.vl >= 1 && r.members > 50, `1.26 the page: its module (${r.plain ? 'plain memory' : 'shared memory'}) runs the 3-D bond orders (${r.bo} passes, ${r.members} members) and builds the list (${r.vl})`, '1.26 page: ' + JSON.stringify(r));
};

module.exports = async function f126w(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (k === 'page' && !page) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.26 speed ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  const only = process.argv.slice(2);
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  let browser = null, page = null, errors = [];
  if (!only.length || only.includes('page')) { const { openPage } = require('./browser'); ({ browser, page, errors } = await openPage({ settle: 800 })); }
  await module.exports(page, check, say, null, only);
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  if (browser) await browser.close();
  console.log(fails ? `${fails} failure(s)` : '1.26 speed checks passed');
  process.exitCode = fails ? 1 : 0;
})();
