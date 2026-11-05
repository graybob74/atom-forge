'use strict';
/* Chaos stress test in the headless page (1.23.1): spams atoms, molecules, U-235/Pu-239, neutrons, electrons, ions,
   sparks and heat at random places, changes the speed (deep slow motion to fast), with Experimental settings on in
   several combinations, and times every frame. A frame over the limit is reported with where its time went; a page that
   does not answer for HANG s is a hang: the main thread is paused through the DevTools protocol and its stack printed.

   usage: node tools/stress.js [--secs 120] [--combo name,name|all] [--seed 1] [--limit 1000] [--hang 10] [--cap 4000] [--prof]
   (node build.js first). Exit code 1 if any frame went over the limit or the page hung. */
const path = require('path'), fs = require('fs');
const { openPage, pageFile } = require(path.join(__dirname, '..', 'tests', 'browser.js'));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PROF = process.argv.includes('--prof'), SECS = +arg('secs', 120), SEED = +arg('seed', 1), LIMIT = +arg('limit', 1000), HANG = +arg('hang', 10) * 1000, CAP = +arg('cap', 4000);
const COMBOS = {
  plain: {},
  bo: { bo: 1, inc: true, qeq: 10, rc: 9 },
  quantum: { bo: 2, pi: 8 },
  waves: { wave: 1, inc: true, dtMax: 0.01 },
  beads: { pi: 16, bo: 1, qeq: 1 },
  all: { bo: 1, pi: 8, wave: 1, qeq: 10, rc: 12, inc: true, dtMax: 0.02, resBig: true },
  qwave: { bo: 2, wave: 1, inc: true, rc: 9 },
  ultra: { ultra: true, inc: true, wave: 1 },
};
const which = arg('combo', 'all') === 'all' && !process.argv.includes('--combo') ? Object.keys(COMBOS) : arg('combo', 'plain').split(',');

// the page's script lines → source file and line (build.js marks each file "/* ---- f ---- */")
const pageLines = fs.readFileSync(pageFile(), 'utf8').split('\n');
const marks = []; pageLines.forEach((l, i) => { const m = /^\/\* ---- ([\w.]+) ---- \*\/$/.exec(l); if (m) marks.push([i, m[1]]); });
function where(line) { let f = '?', at = 0; for (const [i, n] of marks) if (i <= line) { f = n; at = i; } return `${f}:${line - at}`; }

function mulberry(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* one batch of chaos, made in Node (seeded) and done in the page */
function chaos(r) {
  const acts = [], pick = (a) => a[Math.floor(r() * a.length)];
  const n = 1 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const u = r(), x = r() - 0.5, y = r() - 0.5;
    if (u < 0.35) acts.push(['place', { kind: 'atom', Z: 1 + Math.floor(r() * 94) }, x, y, 1 + Math.floor(r() * 12)]);
    else if (u < 0.45) acts.push(['place', pick([{ kind: 'atom', Z: 92, A: 235 }, { kind: 'atom', Z: 94, A: 239 }]), x, y, 1 + Math.floor(r() * 8)]);
    else if (u < 0.52) acts.push(['place', { kind: 'n' }, x, y, 1 + Math.floor(r() * 10)]);
    else if (u < 0.57) acts.push(['fire', { kind: 'n' }, x, y, r() * 6.283, pick([0.025, 1e3, 1e6, 1.4e7])]);
    else if (u < 0.65) acts.push(['place', { kind: 'mol', mol: pick(['H2O', 'O2', 'H2', 'CH4', 'NH3', 'CO2', 'benzene', 'N2', 'HCl', 'ethanol', 'NaCl', 'H2O2', 'SF6', 'H3Op', 'OHm']) }, x, y, 1 + Math.floor(r() * 10)]);
    else if (u < 0.70) acts.push(['place', pick([{ kind: 'e' }, { kind: 'pos' }, { kind: 'atom', Z: 1, A: 1, bare: true }, { kind: 'atom', Z: 2, A: 4, bare: true }]), x, y, 1 + Math.floor(r() * 10)]);
    else if (u < 0.75) acts.push(['place', { kind: 'atom', Z: pick([11, 17, 8, 26, 29, 79]), charge: pick([-1, 1, 2, 3]) }, x, y, 1 + Math.floor(r() * 6)]);
    else if (u < 0.80) acts.push(['spark', x, y, 2 + r() * 8, pick([5, 50, 500, 5e3])]);
    else if (u < 0.86) acts.push(['heat', x, y, 3 + r() * 10, pick([0, 1500, 6000, 3e4, 1e6])]);
    else if (u < 0.90) acts.push(['speed', pick([1e-7, 1e-4, 0.01, 0.1, 1, 1, 1, 4, 16])]);
    else if (u < 0.92) acts.push(['place', { kind: 'exo', sp: pick(['mu-', 'pi+', 'pi-', 'K+', 'Mu']) }, x, y, 1 + Math.floor(r() * 3)]);
    else if (u < 0.94) acts.push(['erase', x, y, 4 + r() * 10]);
  }
  return acts;
}
function doChaos(acts, cap) { // (in the page)
  const out = [], bw = W.box.w, bh = W.box.h;
  for (const a of acts) {
    try {
      const n = W.parts.length - (typeof _nDead === 'number' ? _nDead : 0);
      if (a[0] === 'place') { if (n < cap) placeSpec(a[1], a[2] * (bw - 4), a[3] * (bh - 4), a[4]); }
      else if (a[0] === 'fire') { if (n < cap) fireSpec(a[1], a[2] * (bw - 4), a[3] * (bh - 4), Math.cos(a[4]), Math.sin(a[4]), a[5]); }
      else if (a[0] === 'spark') spark(a[1] * bw, a[2] * bh, a[3], a[4]);
      else if (a[0] === 'heat') W.tool = a[4] ? { type: 'heat', active: true, x: a[1] * bw, y: a[2] * bh, R: a[3], T: a[4] } : null;
      else if (a[0] === 'speed') setSpeed((UI.baseSpf || W.baseSpf || 1.5) * a[1]);
      else if (a[0] === 'erase') eraseAt(a[1] * bw, a[2] * bh, a[3]);
    } catch (e) { out.push(a[0] + ': ' + e.message); }
  }
  return out;
}

/* a CPU profile's functions by inclusive time (a function counted once per sample however deep it recurs) */
function hot(profile, top = 18) {
  const byId = new Map(profile.nodes.map(n => [n.id, n])), parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const incl = new Map(), dts = profile.timeDeltas; let total = 0;
  profile.samples.forEach((id, k) => {
    const dt = dts[k + 1] !== undefined ? dts[k + 1] / 1000 : 1; total += dt; const seen = new Set();
    for (let x = id; x !== undefined; x = parent.get(x)) { const n = byId.get(x), f = n.callFrame, key = `${f.functionName || '(anon)'} ${f.url ? where(f.lineNumber) : ''}`; if (!seen.has(key)) { seen.add(key); incl.set(key, (incl.get(key) || 0) + dt); } }
  });
  return [...incl].filter(([k]) => !/^\((root|program|idle|anon)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => `${k} ${Math.round(v)}`).join(' | ') + ` (of ${Math.round(total)} ms)`;
}
async function stack(cdp) { // pause the main thread and read where it is
  const paused = new Promise((ok) => cdp.once('Debugger.paused', ok));
  await cdp.send('Debugger.pause');
  const ev = await Promise.race([paused, new Promise((ok) => setTimeout(() => ok(null), 5000))]);
  if (!ev) return ['(could not pause)'];
  const fr = ev.callFrames.slice(0, 14).map(f => `${f.functionName || '(anon)'} ${where(f.location.lineNumber)}`);
  await cdp.send('Debugger.resume');
  return fr;
}

async function runCombo(name, set) {
  const r = mulberry(SEED * 7919 + name.length * 131 + name.charCodeAt(0));
  const { browser, page, errors } = await openPage({ settle: 800 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Debugger.enable');
  if (PROF) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start'); }
  await page.addScriptTag({ content: 'window.doChaos = ' + doChaos.toString() });
  await page.evaluate(([set]) => {
    loadPreset('empty');
    Object.assign(SET, set); applySettings();
    window.__st = { worst: 0, long: [], n: 0, last: performance.now(), spf: [] };
    const tick = (t) => { const s = window.__st, g = t - s.last; s.last = t; s.n++; if (g > s.worst) s.worst = g; if (g > 400) s.long.push([Math.round(g), W.parts.length, W.simPerFrame, W.dt]); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const sf = window.simFrame; // (where a slow frame's time went)
    window.simFrame = function (a, b) { const t0 = performance.now(), res = sf(a, b), d = performance.now() - t0; if (d > 300) window.__st.long.push(['sim', Math.round(d), res.steps, W.dt]); return res; };
  }, [set]);
  const t0 = Date.now(); let ticks = 0, hangs = [], worst = 0, longs = [], maxN = 0, lastInfo = '';
  while (Date.now() - t0 < SECS * 1000) {
    const acts = chaos(r);
    const ev = page.evaluate(([acts, cap]) => { const e = doChaos(acts, cap); const s = window.__st, o = { worst: s.worst, long: s.long, n: W.parts.filter(p => !p.dead).length, frames: s.n, t: W.t, dt: W.dt, spf: W.simPerFrame, e, crash: CRASH.open ? $('crashTitle').textContent : '' }; s.worst = 0; s.long = []; s.n = 0; return o; }, [acts, CAP]);
    const ts = Date.now();
    const res = await Promise.race([ev, new Promise((ok) => setTimeout(() => ok(null), HANG))]);
    if (!res) {
      const st = [];
      for (let k = 0; k < 3; k++) { st.push(await stack(cdp)); await new Promise(ok => setTimeout(ok, 700)); }
      const back = await Promise.race([ev.then(() => true, () => true), new Promise((ok) => setTimeout(() => ok(false), 60000))]);
      hangs.push({ at: Math.round((ts - t0) / 1000), info: lastInfo, stacks: st, recovered: back ? Math.round((Date.now() - ts) / 1000) + ' s' : 'no (over 70 s)' });
      console.log(`  [${name}] HANG at ${Math.round((ts - t0) / 1000)} s (${lastInfo}); recovered: ${hangs[hangs.length - 1].recovered}\n    ` + st.map(s => s.join(' < ')).join('\n    '));
      if (!back) break;
      continue;
    }
    ticks++; worst = Math.max(worst, res.worst); maxN = Math.max(maxN, res.n);
    lastInfo = `${res.n} particles, t ${res.t.toFixed(1)} tu, dt ${(+res.dt).toExponential(2)}, spf ${(+res.spf).toExponential(2)}`;
    let slow = false;
    for (const l of res.long) { longs.push(l); if (l[0] !== 'sim' ? l[0] > LIMIT : l[1] > LIMIT) { slow = true; console.log(`  [${name}] long frame ${JSON.stringify(l)} (${lastInfo})`); } }
    if (PROF && (slow || ticks % 15 === 0)) { const { profile } = await cdp.send('Profiler.stop'); if (slow) console.log('    where: ' + hot(profile)); await cdp.send('Profiler.start'); }
    if (res.crash) { console.log(`  [${name}] crash dialog: ${res.crash}`); await page.evaluate(() => crashClose(true)); }
    if (res.e.length) console.log(`  [${name}] errors: ${res.e.slice(0, 3).join('; ')}`);
    await new Promise(ok => setTimeout(ok, 150));
  }
  const over = longs.filter(l => (l[0] === 'sim' ? l[1] : l[0]) > LIMIT).length;
  console.log(`${name.padEnd(8)} ${JSON.stringify(set)}: ${ticks} batches, up to ${maxN} particles, worst frame ${Math.round(worst)} ms, ${over} frames over ${LIMIT} ms, ${hangs.length} hangs` + (errors.length ? `, page errors: ${errors.slice(0, 2).join(' | ').slice(0, 300)}` : ''));
  await browser.close().catch(() => {});
  return { name, over, hangs: hangs.length, worst };
}

(async () => {
  let bad = 0;
  for (const name of which) { const res = await runCombo(name, COMBOS[name] || JSON.parse(name)); if (res.over || res.hangs) bad++; }
  console.log(bad ? `${bad} combination(s) had slow frames or hangs` : 'no frame over the limit, no hangs');
  process.exit(bad ? 1 : 0);
})();
