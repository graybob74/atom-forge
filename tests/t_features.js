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
    if (!out.share.same) { const i = d.parts.findIndex((q, k) => JSON.stringify(q) !== JSON.stringify(d2.parts[k])); out.share.diff = [i, d.parts[i], d2.parts[i], d.parts.length, d2.parts.length, d.bonds.length, d2.bonds.length, d.T, d2.T]; }
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
  // Ask Claude for a setup (Claude stood in for): a recipe with a mistake is sent back once, the fixed one is built
  const r4 = await page.evaluate(async () => {
    setRunning(false); let calls = 0; const keep = AI.sample;
    const good = { name: 'Salt', note: 'Sodium meets chlorine.', box: { w: 70, h: 50 }, T: 600, bath: 'normal', items: [{ what: 'atom', el: 'Na', count: 12, region: 'left' }, { what: 'molecule', key: 'Cl2', count: 6, region: 'right' }, { what: 'lattice', lattice: 'ionic', elements: ['Na', 'Cl'], size: 4, x: 0, y: 15 }, { what: 'shoot', kind: 'alpha', energy_eV: 5e6, from: 'left', count: 2 }] };
    const bad = JSON.parse(JSON.stringify(good)); bad.items[1].key = 'chlorine-gas';
    const fake = async () => ({ text: '' }); fake.json = async (p) => { calls++; return calls === 1 ? bad : /could not be built: "chlorine-gas" is not a library molecule key/.test(p) ? good : null; };
    AI.sample = fake; $('askText').value = 'salt'; await askRun(); setRunning(false);
    const n = (f) => W.parts.filter(p => !p.dead && f(p)).length;
    const out = { calls, preset: UI.preset, Na: n(p => p.Z === 11), Cl: n(p => p.Z === 17), He: n(p => p.Z === 2), T: W.T, too: askBuild({ items: [{ what: 'molecule', key: 'H2O', count: 2000 }] }, true) };
    AI.sample = keep; aiSync(); loadPreset('water');
    return out;
  });
  check(r4.calls === 2 && r4.preset === 'ai' && r4.Na === 20 && r4.Cl === 20 && r4.He === 2 && r4.T === 600 && /at most/.test(r4.too), 'Ask Claude for a setup: a bad key sent back with the reason, the fixed recipe built (20 Na, 20 Cl, 2 α fired, 600 K); too big refused', 'ask setup: ' + JSON.stringify(r4));
  // challenges: done when done (and remembered), and a hand-wired ring of three gates ticks
  const r5 = await page.evaluate(() => {
    setRunning(false); const out = {}; CH.done.clear();
    out.list = document.querySelectorAll('#preset optgroup[label="Challenges"] option').length;
    loadPreset('ch_water'); for (let f = 0; f < 10; f++) simFrame(1 / 60, 25); challengeTick(); out.notYet = !CH.won;
    out.sparks = 0;
    for (const [x, y] of [[0, 0], [-15, 8], [15, -8], [-20, -10], [20, 10], [0, 15], [0, -15], [-25, 0]]) { if (CH.won) break; spark(x, y, 8, sparkE()); out.sparks++; for (let f = 0; f < 240 && !CH.won; f++) { simFrame(1 / 60, 25); if (f % 20 === 0) challengeTick(); } }
    out.water = CH.won;
    loadPreset('ch_ring'); document.querySelector('[data-tab="lab"]').click(); updateChips();
    const sel = () => [...document.querySelectorAll('#chipPanel select[data-k="wire"]')];
    [[0, 2], [1, 0], [2, 1]].forEach(([i, j]) => { const s2 = sel()[i]; s2.value = String(W.chips[j].id); s2.dispatchEvent(new Event('change', { bubbles: true })); });
    for (let f = 0; f < 300; f++) simFrame(1 / 60, 25); challengeTick(); out.ring = CH.won; out.labels = W.chips.map(c => c.label).join(',');
    loadPreset('ch_split'); for (const u of W.parts.filter(p => p.Z === 92)) fireSpec({ kind: 'n' }, -28, u.y, 1, 0, 0.025, false);
    for (let f = 0; f < 4000 && !CH.won; f++) { simFrame(1 / 60, 25); if (f % 20 === 0) challengeTick(); } out.split = CH.won;
    out.kept = store('challenges'); out.tick = $('preset').querySelector('option[value="ch_water"]').textContent;
    CH.done.clear(); store('challenges', ''); loadPreset('water');
    return out;
  });
  check(r5.list >= 10 && r5.notYet && r5.water && r5.ring && r5.split && /water/.test(r5.kept) && r5.tick.startsWith('✓') && r5.labels === 'Gate 1,Gate 2,Gate 3',
    `challenges: ${r5.list} in the setup list; water after ${r5.sparks} spark(s), a hand-wired ring of three gates ticks, a neutron splits U-235; remembered (${r5.kept})`, 'challenges: ' + JSON.stringify(r5));
  // chain reaction: k and where the neutrons went; gallery; a laser on sodium; a slow bath change; the crystal grows
  const r6 = await page.evaluate(async () => {
    setRunning(false); const out = {};
    loadPreset('chain'); W.slowmo = false; for (const u of W.parts.filter(p => p.Z === 92).slice(0, 3)) fireSpec({ kind: 'n' }, u.x - 6, u.y, 1, 0, 0.025, false);
    for (let f = 0; f < 4000 && !(W.kc && W.kc.ends > 40 && W.count.fission > 5); f++) simFrame(1 / 60, 25); // (frames are time-budgeted: a loaded machine needs more of them)
    document.querySelector('[data-tab="data"]').click(); updatePanel();
    let sum = 0; for (let i = 0; i < Math.min(W.kc.n, KC_N); i++) sum += W.kc.v[i];
    out.k = { shown: !$('dChainSec').hidden, text: $('dChainK').textContent, fis: W.count.fission, ends: W.kc.ends, gen: W.kc.gen, born: W.kc.born, sumNu: sum };
    try { localStorage.removeItem('atomforge.gallery'); } catch (e) { /* (none) */ }
    loadPreset('water'); render(W.rt); $('galName').value = 'T'; await galSave(); loadPreset('empty');
    const code = galGet('g.' + galIndex()[0].id); out.gal = { n: galIndex().length, img: galIndex()[0].img.length > 500, err: await shareOpen(code), parts: W.parts.filter(p => !p.dead).length };
    galDel('g.' + galIndex()[0].id); store('gallery', '[]');
    baseWorld(90, 56, 300, 0.05); for (let x = -30; x <= 30; x += 6) addAtom('Na', x, 0, { T: 1 }); OPT.light.s = 132.33; W.lasers.push({ x0: -40, y0: 0, ux: 1, uy: 0, E: lightE(), rate: 80, acc: 0 });
    UI.running = true; for (let f = 0; f < 300; f++) { simFrame(1 / 60, 25); toolTick(1 / 60); } UI.running = false;
    out.laser = { na: specPhotons().filter(q => q[1] === 11).length, lam: wavelengthText(lightE()).lam };
    loadPreset('grow'); W.ramp.dur = 5; UI.running = true; const Ts = []; for (let f = 0; f < 330; f++) { simFrame(1 / 60, 25); toolTick(1 / 60); if (f % 60 === 0) Ts.push(Math.round(W.T)); } UI.running = false;
    out.ramp = { Ts, end: W.T, gone: W.ramp === null };
    return out;
  });
  const k6 = r6.k;
  check(k6.shown && k6.fis > 5 && k6.ends > 20 && k6.gen >= 2 && /^k ≈ \d\.\d\d/.test(k6.text), `chain reaction: ${k6.text} after ${k6.fis} fissions, ${k6.ends} neutron ends, generation ${k6.gen}`, 'chain: ' + JSON.stringify(k6));
  check(r6.gal.n === 1 && r6.gal.img && r6.gal.err === null && r6.gal.parts === 240, 'gallery: kept with a picture, opened again (240 particles)', 'gallery: ' + JSON.stringify(r6.gal));
  check(r6.laser.lam === '589 nm' && r6.laser.na > 50, `laser at ${r6.laser.lam} on sodium vapour: ${r6.laser.na} photons scattered by Na (resonance)`, 'laser: ' + JSON.stringify(r6.laser));
  check(r6.ramp.gone && r6.ramp.end === 40 && r6.ramp.Ts[0] > 140 && r6.ramp.Ts.every((t, i) => !i || t < r6.ramp.Ts[i - 1]), `bath ramp: ${r6.ramp.Ts.join(' → ')} → 40 K`, 'ramp: ' + JSON.stringify(r6.ramp));
  // the cloud chamber draws droplet tracks; the narrator explains a fission
  const r7 = await page.evaluate(() => {
    setRunning(false); const out = {};
    loadPreset('cloud'); UI.running = true; for (let f = 0; f < 600 && W.tracks.length < 4; f++) { simFrame(1 / 60, 25); toolTick(1 / 60); if (f % 4 === 0) render(W.rt); } UI.running = false; render(W.rt);
    out.cloud = { tracks: W.tracks.length, cloud: W.cloud, kinds: [...new Set(W.tracks.map(t => t.w))].length };
    setSetting('narr', true); loadPreset('chain'); NARR.seq = W.logSeq; NARR.until = 0; NARR.last.clear();
    for (const u of W.parts.filter(p => p.Z === 92).slice(0, 3)) fireSpec({ kind: 'n' }, u.x - 6, u.y, 1, 0, 0.025, false);
    let txt = ''; for (let f = 0; f < 4000 && !/Fission|Neutron capture/.test(txt); f++) { simFrame(1 / 60, 25); UI.vis += 1 / 60; if (f % 10 === 0) { narrTick(); if (!$('narr').hidden) txt = $('narr').textContent; } }
    out.narr = txt.slice(0, 80); setSetting('narr', false); updateReadouts(); out.off = $('narr').hidden;
    loadPreset('water'); return out;
  });
  check(r7.cloud.tracks >= 4 && r7.cloud.cloud, `cloud chamber: ${r7.cloud.tracks} droplet tracks`, 'cloud: ' + JSON.stringify(r7.cloud));
  check(/^(Fission\. A neutron made|Neutron capture\.)/.test(r7.narr) && r7.off, `narrator: “${r7.narr} …”`, 'narrator: ' + JSON.stringify(r7));
  // wall pressure: argon gas in a box pushes on the walls as an ideal gas would (Z ≈ 1)
  const r8 = await page.evaluate(() => {
    setRunning(false); baseWorld(80, 80, 1000, 0.05); scatter(120, 80, 80, (x, y) => addAtom('Ar', x, y), 4); // (hot enough that no droplets form) settleOverlaps(); document.querySelector('[data-tab="data"]').click();
    let pr = null; for (let f = 0; f < 6000; f++) { simFrame(1 / 60, 25); if (f % 30 === 0) { updatePanel(); pr = wallPressure(0, measure().T); if (pr && pr.ok && f > 1200) break; } }
    const tile = [...document.querySelectorAll('#dTiles .tile')].map(t => t.textContent).join(' | ');
    loadPreset('water'); return { Z: pr && pr.Z, err: pr && pr.zErr, ok: pr && pr.ok, tile };
  });
  check(r8.ok && Math.abs(r8.Z - 1) < 0.35 && /Wall pressure/.test(r8.tile), `wall pressure: argon gas at 1,000 K, Z = ${r8.Z && r8.Z.toFixed(2)} ± ${r8.err && r8.err.toFixed(2)} (ideal gas: 1)`, 'pressure: ' + JSON.stringify(r8));
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
