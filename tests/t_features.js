'use strict';
/* The features added from 0.45 on, in the real page: each one does what it says on a preset made for it. */
const { openPage } = require('./browser');
(async () => {
  const { browser, page, errors } = await openPage({ settle: 800 });
  let fails = 0; const say = (...a) => console.log(...a); const t0 = Date.now();
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  const r = await page.evaluate(() => {
    setRunning(false); const out = {};
    // the spectroscope: a neon sign's light is neon's own lines
    loadPreset('neon'); W.slowmo = false; for (let f = 0; f < 300; f++) simFrame(1 / 60, 25);
    document.querySelector('[data-tab="data"]').click(); updatePanel(); drawSpec();
    const ph = specPhotons().filter(([nm]) => nm >= 380 && nm <= 780);
    const ne = new Set(LINES.Ne.l.map(([nm]) => Math.round(nm)));
    out.spec = { shown: !$('dSpecSec').hidden, n: ph.length, onLine: ph.filter(([nm]) => ne.has(Math.round(nm))).length, ne: ph.filter(([, z]) => z === 10).length, note: $('dSpecNote').textContent };
    $('bSpecClear').click(); out.spec.cleared = specPhotons().length;
    loadPreset('empty'); updatePanel(); drawSpec(); out.spec.goneOnClear = $('dSpecSec').hidden;
    // the logic analyser: a ring oscillator's three outputs, each a square wave at the period the gates measure
    loadPreset('ringosc'); W.slowmo = false; document.querySelector('[data-tab="lab"]').click();
    for (let f = 0; f < 400; f++) simFrame(1 / 60, 25);
    updatePanel(); drawScope();
    const g = W.chips[0], sc = g.scope, n = Math.min(sc.n, SCOPE_N); let rises = [], prev = null;
    for (let j = n - 1; j >= 0; j--) { const k = (sc.n - 1 - j) % SCOPE_N, hi = sc.v[1][k] > 0.5 * CHIP.VDD; if (prev === false && hi) rises.push(sc.t[k]); prev = hi; }
    const per = rises.length > 2 ? (rises[rises.length - 1] - rises[0]) / (rises.length - 1) : 0;
    out.scope = { shown: !$('gScope').hidden, lanes: W.chips.length, per, gatePer: g.per, rises: rises.length, note: $('dScopeNote').textContent };
    return out;
  });
  const r2 = await page.evaluate(async () => {
    setRunning(false); const out = {};
    // share codes: a world out and back in, exactly; junk refused with a reason
    loadPreset('water'); for (let f = 0; f < 30; f++) simFrame(1 / 60, 25);
    const d = worldToJSON(), code = await shareEncode(d); loadPreset('empty'); const err = await shareOpen(code), d2 = worldToJSON();
    out.share = { len: code.length, json: JSON.stringify(d).length, err, same: JSON.stringify(d2.parts) === JSON.stringify(d.parts) && JSON.stringify(d2.bonds) === JSON.stringify(d.bonds) && d2.T === d.T,
      junk: [await shareOpen('hello'), await shareOpen('AF1:abc')].every(e => typeof e === 'string') };
    $('bShare').click(); for (let i = 0; i < 50 && !$('shareOut').value; i++) await new Promise(r => setTimeout(r, 50));
    out.share.dialog = !$('shareModal').hidden && $('shareOut').value.startsWith('AF1:'); $('shareClose').click();
    // explain: without Claude the setup's notes; with Claude, what the panels show goes in the question
    loadPreset('neon'); for (let f = 0; f < 60; f++) simFrame(1 / 60, 25); document.querySelector('[data-tab="data"]').click(); updatePanel();
    const keep = AI.sample; AI.sample = null; await explainRun(); out.local = $('dExplain').textContent.startsWith('Neon gas');
    let got = ''; const fake = async (p, o) => { got = p; o.onText({ text: 'Neon', delta: 'Neon' }); return { text: 'Neon glows.', truncated: false }; }; fake.json = async () => ({});
    AI.sample = fake; await explainRun(); out.ai = $('dExplain').textContent === 'Neon glows.' && /Neon discharge/.test(got) && /Ionizations: \d/.test(got) && got.length < 20000;
    AI.sample = keep; explainSync();
    // glowing walls: Planck's law (mean photon energy 2.701 kT), off unless asked for, kept by save and load
    let sx = 0; const NX = 200000; for (let i = 0; i < NX; i++) sx += planckX(); out.planck = sx / NX;
    loadPreset('water'); out.offByDefault = !W.glow;
    loadPreset('oven'); W.slowmo = false; for (let f = 0; f < 600; f++) simFrame(1 / 60, 25);
    const wall = specPhotons().filter(q => q[1] === -1); let e = 0; for (const [nm] of wall) e += PHYS.HC / nm;
    out.oven = { n: wall.length, meanX: e / wall.length / (PHYS.KB * W.T) };
    const j = JSON.parse(JSON.stringify(worldToJSON())); loadPreset('water'); worldFromJSON(j); out.oven.kept = W.glow === true;
    W.wall = 'wrap'; const n0 = W.spec ? W.spec.total : 0; for (let f = 0; f < 60; f++) simFrame(1 / 60, 25); out.oven.wrapNone = (W.spec ? W.spec.total : 0) === n0;
    return out;
  });
  check(Math.abs(r2.planck / 2.7012 - 1) < 0.01 && r2.offByDefault && r2.oven.n > 300 && Math.abs(r2.oven.meanX / 2.7012 - 1) < 0.12 && r2.oven.kept && r2.oven.wrapNone,
    `glowing walls: Planck sampling mean ${r2.planck.toFixed(3)} kT (2.701); the oven's ${r2.oven.n} wall photons average ${r2.oven.meanX.toFixed(2)} kT; off by default, kept by save/load, none without walls`, 'glowing walls: ' + JSON.stringify(r2));
  // a video: four seconds of the running chamber recorded at 4×, made into a file
  const r3 = await page.evaluate(async () => {
    loadPreset('water'); setRunning(true); let saved = null; const keep = fileSave;
    fileSave = async (name, b, type) => { saved = { name, size: b.size, type }; return true; }; // eslint-disable-line no-func-assign
    REC.speed = 4; recStart(); await new Promise((r) => { setTimeout(r, 4000); }); const n = REC.frames.length;
    await recStop(); fileSave = keep; setRunning(false); REC.speed = 1; // eslint-disable-line no-func-assign
    return { mime: recMime(), n, saved };
  });
  check(!r3.mime || (r3.n >= 8 && r3.saved && r3.saved.size > 10000 && /\.(webm|mp4)$/.test(r3.saved.name)), `video: ${r3.n} frames at 4× → ${r3.saved ? r3.saved.name + ', ' + Math.round(r3.saved.size / 1024) + ' KB' : 'no recorder here'}`, 'video: ' + JSON.stringify(r3));
  check(r2.share.err === null && r2.share.same && r2.share.junk && r2.share.dialog, `share code: water in ${r2.share.len} characters (JSON ${r2.share.json}), back exactly; junk refused; the dialog makes one`, 'share code: ' + JSON.stringify(r2.share));
  check(r2.local && r2.ai, 'explain: the setup\'s notes without Claude; with Claude the question carries what the panels show', 'explain: ' + JSON.stringify(r2));
  const s = r.spec;
  check(s.shown && s.n > 50 && s.ne === s.n && s.onLine === s.n && s.cleared === 0 && s.goneOnClear,
    `spectroscope: ${s.n} visible photons from the neon sign, all on neon's lines; Clear empties it, a new world hides it`, 'spectroscope: ' + JSON.stringify(s));
  const o = r.scope;
  check(o.shown && o.rises > 5 && Math.abs(o.per / o.gatePer - 1) < 0.1,
    `logic analyser: ${o.rises} rising edges of Gate 1, period ${(o.per * 1e12).toFixed(1)} ps from the trace vs ${(o.gatePer * 1e12).toFixed(1)} ps measured by the gate`, 'logic analyser: ' + JSON.stringify(o));
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  say(`  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  await browser.close();
  console.log(fails ? `${fails} feature failure(s)` : 'feature checks passed');
  process.exitCode = fails ? 1 : 0;
})();
