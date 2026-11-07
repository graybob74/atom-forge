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
    const neL = LINES.Ne.l.map(([nm]) => nm), onNe = (nm) => neL.some(l => Math.abs(l - nm) < 1.5); // (a line, give or take its Doppler width)
    out.spec = { shown: !$('dSpecSec').hidden, n: ph.length, onLine: ph.filter(([nm]) => onNe(nm)).length, ne: ph.filter(([, z]) => z === 10).length, note: $('dSpecNote').textContent };
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
    // share codes: a world out and back in, exactly (an atom a hair past a soft wall comes back on it); junk refused with a reason
    loadPreset('water'); for (let f = 0; f < 30; f++) simFrame(1 / 60, 25);
    const d = worldToJSON(), code = await shareEncode(d); loadPreset('empty'); const err = await shareOpen(code), d2 = worldToJSON();
    out.share = { len: code.length, json: JSON.stringify(d).length, err, same: d2.parts.length === d.parts.length && d.parts.every((q, k) => JSON.stringify(q) === JSON.stringify(d2.parts[k]) || q.every((v, j) => v === d2.parts[k][j] || ((j === 5 || j === 6) && Math.abs(v - d2.parts[k][j]) < 0.1))) && JSON.stringify(d2.bonds) === JSON.stringify(d.bonds) && d2.T === d.T,
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
    setSetting('narr', true); loadPreset('chain'); NARR.seq = W.logSeq; NARR.until = 0; NARR.last.clear(); NARR.pend = null;
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
  // light in flight: its crossing scales with the speed set and with slow motion (it is c on the simulation's clock)
  const r9 = await page.evaluate(() => {
    const cross = (k, hold) => { loadPreset('empty'); W.simPerFrame = W.baseSpf * k; W.slowHold = hold; emitPhoton(-W.box.w / 2 + 0.5, 0, 2.1, 1, 0, { travel: true });
      const f = W.flights[0], t0 = W.t; let n = 0; while (W.flights.length && n < 5000) { simFrame(1 / 60, 50); n++; } const v = f.len / ((W.t - t0) * PHYS.C); W.slowHold = false; return { n, v }; };
    return { one: cross(1, false), four: cross(4, false), quarter: cross(0.25, false), slow: cross(1, true) };
  });
  check(Math.abs(r9.one.n / r9.four.n - 4) < 1 && Math.abs(r9.quarter.n / r9.one.n - 4) < 1 && r9.slow.n > 3 * r9.one.n && [r9.one, r9.four, r9.quarter, r9.slow].every(x => x.v > 0.9 && x.v <= 1.0001),
    `light crossing: ${r9.one.n} frames at 1×, ${r9.four.n} at 4×, ${r9.quarter.n} at ¼×, ${r9.slow.n} in slow motion, at c each time`, 'light pace: ' + JSON.stringify(r9));
  // Inspect: pions, muons, kaons, photons and neutrinos in flight can be picked and described
  const r10 = await page.evaluate(() => {
    setRunning(false); loadPreset('empty'); W.decayOn = false;
    const pi = addExo('pi+', -10, 0, 2e8, 1, 0), mu = addExo('mu-', -10, 5, 1e8, 1, 0);
    emitPhoton(-W.box.w / 2 + 1, 10, 2.1, 1, 0, { travel: true }); emitNeutrino(0, -10, 1.2e6, 1, 0, true, 'β⁻ decay of a neutron');
    render(W.rt); setTool('inspect');
    const pick = (x, y) => pickLight(w2sx(x), w2sy(y), 12);
    const hits = [pick(pi.x, pi.y), pick(mu.x, mu.y), pick(...lightHead(W.flights[0], 'flight')), pick(...lightHead(W.rays.find(r => r.nu), 'ray'))].map(h => h && h.kind + ':' + (h.o.sp || (h.o.nu ? 'nu' : 'photon')));
    const card = (kind, o) => { R.sel = null; R.selX = { kind, o }; renderInspect(); return $('tp-inspect').textContent; };
    const t = [card('exo', pi), card('exo', mu), card('flight', W.flights[0]), card('ray', W.rays.find(r => r.nu))];
    R.selX = null; loadPreset('water');
    return { hits, pi: /Positive pion/.test(t[0]) && /17 m/.test(t[0]), mu: /Muon/.test(t[1]) && /2\.20 µs/.test(t[1]), ph: /590 nm/.test(t[2]) && /508 THz/.test(t[2]), nu: /Electron antineutrino/.test(t[3]) };
  });
  check(r10.hits.join() === 'exo:pi+,exo:mu-,flight:photon,ray:nu' && r10.pi && r10.mu && r10.ph && r10.nu, 'Inspect: a pion, a muon, a photon and a neutrino in flight picked and described (pion: 17 m before decaying at 200 MeV)', 'inspect in flight: ' + JSON.stringify(r10));
  // inside a hadron: a proton's quarks, and pulling one out makes a pion and leaves a neutron (in the chamber too, since 0.52)
  const r11 = await page.evaluate(async () => {
    setRunning(false); loadPreset('empty'); const pr = addNuc(1, 0, 0, 0, 0); R.sel = pr; R.selX = null; showTab('inspect', true); renderInspect();
    for (let i = 0; i < 5; i++) await new Promise(r => requestAnimationFrame(r));
    const n0 = W.parts.length, first = QV.qs.map(q => q.f).sort().join(''), note = $('insQNote').textContent;
    const cv = $('insQuarks'), rc = cv.getBoundingClientRect(), S = Math.min(rc.width, rc.height) / 3.4, q = QV.qs.find(o => o.f === 'u');
    const at = (x, y) => ({ clientX: rc.left + rc.width / 2 + x * S, clientY: rc.top + rc.height / 2 - y * S, preventDefault() {} });
    qPointer(at(q.x, q.y), 'down'); for (let k = 1; k <= 30 && QV.drag; k++) qPointer(at(q.x + 0.1, q.y), 'move');
    const after = QV.qs.map(o => (o.anti ? o.f.toUpperCase() : o.f)).sort().join(''), msg = QV.msg;
    const world = W.parts.filter(p => !p.dead).map(partLabel).join() + ' ' + W.exo.filter(o => !o.dead).map(o => o.sp).join();
    QV.key = ''; renderInspect(); const back = QV.qs.map(o => o.f).sort().join('');
    const mu = addExo('mu-', 0, 5, 1e8, 1, 0); R.sel = null; R.selX = { kind: 'exo', o: mu }; renderInspect(); const lep = /it is a lepton/.test($('tp-inspect').textContent);
    R.selX = null; loadPreset('water');
    return { first, note: /Proton \(p\): three quarks/.test(note), after, msg, back, same: n0 === 1, world, lep };
  });
  check(r11.first === 'duu' && r11.note && /pion|kaon/.test(r11.msg) && r11.back === [...r11.after.toLowerCase()].sort().join('') && r11.lep && r11.same && /In the chamber: p → /.test(r11.msg), `inside a proton: u u d; pulling a u out made ${r11.msg.match(/as a ([^,.]+)/)[1]}, leaving ${r11.after}, in the chamber too (${r11.world}); a muon has no quarks`, 'quark view: ' + JSON.stringify(r11));
  // the string model and the quark–gluon plasma: exact kinematics, jets from e⁺e⁻ at 10 GeV, a plasma from gold on gold,
  // and the energies to reach them on the Fire tool and the collider
  const r12 = await page.evaluate(() => {
    setRunning(false); const out = {};
    let worst = 0; for (let k = 0; k < 40; k++) { const n = 3 + Math.floor(rnd() * 40), its = []; for (let i = 0; i < n; i++) its.push(item(['pi+', 'pi-', 'pi0', 'K+', 'K-', 'p', 'n', 'eta'][Math.floor(rnd() * 8)]));
      const M = its.reduce((t, it) => t + massOf(it), 0) * (1.2 + 20 * rnd()), v = jetMomenta(its, M, 1, 0, { thermal: k % 2 === 0, lead: isBaryonItem }); if (!v) continue;
      let E = 0, px = 0, py = 0; v.forEach((q, i) => { E += q[0]; px += q[1]; py += q[2]; worst = Math.max(worst, Math.abs(q[0] * q[0] - q[1] * q[1] - q[2] * q[2] - massOf(its[i]) ** 2) / (q[0] * q[0])); });
      worst = Math.max(worst, Math.abs(E - M) / M, Math.abs(px) / M, Math.abs(py) / M); }
    out.kin = worst;
    loadPreset('linac'); setupCollider('linear', 'pos', 'e', 5e9); W.slowHold = false; const n0 = W.exo.length;
    let st = null, nj = 0, nh = 0, cs = 0;
    for (let f = 0; f < 20000 && nj < 6; f++) { // (six jets with five or more hadrons still flying: one event alone can come out wide)
      simFrame(1 / 60, 30); const ss = W.strings || [], s1 = ss[ss.length - 1];
      if (s1 && s1 !== st) { st = s1; const xs = W.exo.filter(o => !o.dead && o.born >= st.t0 - 1e-9); if (xs.length >= 5) { nj++; nh += xs.length; for (const o of xs) cs += Math.abs(o.ux * st.ax + o.uy * st.ay); } }
    }
    out.jet = nj ? { n: Math.round(nh / nj), cos: cs / nh } : null;
    loadPreset('rhic'); W.slowHold = false; let f = 0; for (; f < 12000 && !(W.qgp || []).length; f++) simFrame(1 / 60, 30);
    out.qgp = (W.qgp || []).map(g => ({ n: g.n, sNN: Math.round(g.sNN) }))[0] || null; out.qgpLog = W.log.some(e => /quark–gluon plasma: \d+ nucleons melted/.test(e.text));
    OPT.fire.s = 1700; out.fireMax = fireKE(); OPT.fire.s = 300; out.colMax = cEFromS(1000);
    loadPreset('water'); return out;
  });
  check(r12.kin < 1e-9 && r12.jet && r12.jet.cos > 0.6 && r12.qgp && r12.qgp.n > 100 && r12.qgpLog && r12.fireMax >= 9.9e14 && r12.colMax >= 9.9e14,
    `strings and plasma: kinematics exact to ${r12.kin.toExponential(0)}; e⁺e⁻ at 10 GeV → ${r12.jet && r12.jet.n} hadrons along the jet axis (mean |cos| ${r12.jet && r12.jet.cos.toFixed(2)}); gold on gold at √s_NN ${r12.qgp && (r12.qgp.sNN / 1000).toFixed(0)} GeV → plasma → ${r12.qgp && r12.qgp.n} hadrons; Fire tool and collider reach 1 PeV`, 'strings/plasma: ' + JSON.stringify(r12));
  // muons in matter: a slow muon ionizes argon, slows and is caught (a muonic atom); in D–T it catalyses fusion again and
  // again; every step keeps the books exactly
  const r13 = await page.evaluate(() => {
    setRunning(false); const out = {}; const tot = () => totalEnergy().total - W.ledger.nuc;
    loadPreset('empty'); W.box.w = W.box.tw = 120; W.box.h = W.box.th = 60; for (let i = 0; i < 24; i++) for (let j = 0; j < 12; j++) addAtom('Ar', -55 + i * 4.75, -25 + j * 4.75); // (denser since 1.15: muons now scatter off the nuclei they pass, and in the old sparse rows one could wander out first)
    const m = addExo('mu-', -58, 3.6, 6000, 1, 0.003); for (let f = 0; f < 3000 && !m.dead; f++) simFrame(1 / 60, 25);
    out.ar = { fate: m.fate, bound: (W.muBound || []).length };
    let worst = 0; const keep = Object.assign({}, MU_RATES); MU_RATES.tr_dt = 1e30; MU_RATES.tr_pd = 1e30; MU_RATES.dt = 1e30;
    loadPreset('mucf'); W.gamma = 0; W.slowmo = false; forcesNoEvents(); W.fSpawn = W.spawned; let n = 0;
    for (let k = 0; k < 400 && n < 6; k++) { const o = W.exo.find(q => !q.dead && /^mu/.test(q.sp)); if (!o) break;
      if (XP[o.sp].atom) { const want = XP[o.sp].N === 2 ? 1 : 2, tg = W.parts.find(p => !p.dead && p.Z === 1 && p.N === want); if (!tg) break; o.x = tg.x + 0.4; o.y = tg.y; forcesNoEvents(); const b = tot(), f0 = W.count.fusion; muAtomTick(o, 1); worst = Math.max(worst, Math.abs(tot() - b)); n += W.count.fusion - f0; }
      else { const b = tot(); if (o.KE >= MU_STOP) o.KE = 1000; exoSpeed(o); const tg = W.parts.find(p => !p.dead && p.Z === 1); o.x = tg.x + 1; o.y = tg.y; forcesNoEvents(); const b2 = tot(); muStop(o); worst = Math.max(worst, Math.abs(tot() - b2)); } }
    Object.assign(MU_RATES, keep);
    out.cat = { fusions: n, worst, last: W.log.filter(e => /Muon-catalysed/.test(e.text)).slice(-1).map(e => e.text)[0] || '' };
    out.proj = FIRE_PROJ.some(f => f.spec && f.spec.kind === 'exo' && f.spec.sp === 'mu-');
    loadPreset('water'); return out;
  });
  check(/muonic atom/.test(r13.ar.fate || '') && r13.ar.bound === 1 && r13.cat.fusions >= 3 && r13.cat.worst < 1e-3 && /fusion no\. [3-9]/.test(r13.cat.last) && r13.proj,
    `muons: a 6 keV μ⁻ slows in argon and is caught (${r13.ar.fate}); in D–T it catalysed ${r13.cat.fusions} fusions in a row, each event exact to ${r13.cat.worst.toExponential(0)} eV; the Fire tool fires μ⁻`, 'muons: ' + JSON.stringify(r13));
  // a video: four seconds of the running chamber recorded at 4×, made into a file
  const r3 = await page.evaluate(async () => {
    loadPreset('water'); setRunning(true); let saved = null; const keep = fileSave;
    fileSave = async (name, b, type) => { saved = { name, size: b.size, type }; return true; }; // eslint-disable-line no-func-assign
    REC.speed = 4; recStart(); await new Promise((r) => { setTimeout(r, 4000); }); const n = REC.frames.length;
    await recStop(); fileSave = keep; setRunning(false); REC.speed = 1; // eslint-disable-line no-func-assign
    return { mime: recMime(), n, saved };
  });
  check(!r3.mime || (r3.n >= 5 && r3.saved && r3.saved.size > 10000 && /\.(webm|mp4)$/.test(r3.saved.name)), `video: ${r3.n} frames at 4× → ${r3.saved ? r3.saved.name + ', ' + Math.round(r3.saved.size / 1024) + ' KB' : 'no recorder here'}`, 'video: ' + JSON.stringify(r3));
  check(r2.share.err === null && r2.share.same && r2.share.junk && r2.share.dialog, `share code: water in ${r2.share.len} characters (JSON ${r2.share.json}), back exactly; junk refused; the dialog makes one`, 'share code: ' + JSON.stringify(r2.share));
  check(r2.local && r2.ai, 'explain: the setup\'s notes without Claude; with Claude the question carries what the panels show', 'explain: ' + JSON.stringify(r2));
  const s = r.spec;
  check(s.shown && s.n > 50 && s.ne === s.n && s.onLine >= 0.99 * s.n && s.cleared === 0 && s.goneOnClear,
    `spectroscope: ${s.n} visible photons from the neon sign, all on neon's lines; Clear empties it, a new world hides it`, 'spectroscope: ' + JSON.stringify(s));
  const o = r.scope;
  check(o.shown && o.rises > 5 && Math.abs(o.per / o.gatePer - 1) < 0.1,
    `logic analyser: ${o.rises} rising edges of Gate 1, period ${(o.per * 1e12).toFixed(1)} ps from the trace vs ${(o.gatePer * 1e12).toFixed(1)} ps measured by the gate`, 'logic analyser: ' + JSON.stringify(o));
  // 0.52: a quark pulled out by hand makes real hadrons in the chamber, charge, baryon number and energy exact
  const r14 = await page.evaluate(() => {
    const QB = () => { let q = 0, b = 0; for (const p of W.parts) if (!p.dead) { if (p.k === NUC) { q += (p.anti ? -1 : 1) * p.Z - (p.anti ? -1 : 1) * p.ne; b += (p.anti ? -1 : 1) * (p.Z + p.N); } else q += p.k === ELEC ? -1 : 1; }
      for (const o of W.exo) if (!o.dead) { q += o.q; b += XP[o.sp].B || 0; } return [q, b]; };
    const E = () => totalEnergy().total - W.ledger.nuc;
    const res = { n: 0, bad: [], worst: 0, made: new Set() };
    for (const [Z, N, ne, anti] of [[1, 0, 0, false], [0, 1, 0, false], [2, 2, 2, false], [6, 6, 6, false], [26, 30, 26, false], [1, 0, 0, true]]) for (let t = 0; t < 8; t++) {
      loadPreset('empty'); setRunning(false); W.decayOn = false; showTab('inspect');
      const p = addNuc(Z, N, ne, 0, 0, 0, 0, anti); QV.pick = t % 2 ? 'n' : 'p'; R.sel = p; R.selX = null; QV.key = ''; renderInspect();
      const [q0, b0] = QB(), E0 = E(); qSnap(QV.qs[t % 3]); const [q1, b1] = QB();
      const dE = Math.abs(E() - E0 - RIP_E * MEV); res.worst = Math.max(res.worst, dE); res.n++;
      if (q0 !== q1 || b0 !== b1 || p.dead !== true || !/In the chamber/.test(QV.msg)) res.bad.push(`${Z},${N}: q ${q0}→${q1} B ${b0}→${b1} ${QV.msg.slice(-80)}`);
      for (const o of W.exo) res.made.add(o.sp);
    }
    for (const sp of ['pi+', 'Lam', 'Xi-', 'Omg-']) { loadPreset('empty'); setRunning(false); W.decayOn = false;
      const o = addExo(sp, 0, 0, 1e6, 1, 0); R.sel = null; R.selX = { kind: 'exo', o }; QV.key = ''; renderInspect(); const [q0, b0] = QB(); qSnap(QV.qs[0]); const [q1, b1] = QB();
      if (q0 !== q1 || b0 !== b1 || !o.dead) res.bad.push(`${sp}: q ${q0}→${q1} B ${b0}→${b1}`); res.n++; }
    // a lone nucleon is drawn where it is; Display mode fills the window and hides the cursor at rest
    loadPreset('empty'); const h = addNuc(1, 0, 0, 0, 0, 0, 0, false); R.s = 400; R.cx = 0; R.cy = 0; let at = null; const keep = drawSprite;
    drawSprite = function (sp, x, y) { if (new Error().stack.includes('nucleusBeads')) at = [x - w2sx(h.x), y - w2sy(h.y)]; return keep.apply(this, arguments); }; // eslint-disable-line no-func-assign
    render(W.rt); drawSprite = keep; fitView(); // eslint-disable-line no-func-assign
    return { ...res, made: [...res.made].sort().join(' '), at };
  });
  check(!r14.bad.length && r14.worst < 1e-3 && r14.at && Math.hypot(...r14.at) < 0.5,
    `quark rip: ${r14.n} pulls on nucleons, nuclei, antiprotons and hyperons, all with charge and baryon number kept and the 900 MeV booked exactly (worst ${r14.worst.toExponential(0)} eV); made ${r14.made}; a lone proton drawn at its place`, 'quark rip: ' + JSON.stringify(r14));
  const r15 = await page.evaluate(async () => {
    const st = () => { const r = $('stage').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
    const before = st(); setDisplayMode(true); await new Promise((r) => { setTimeout(r, 150); }); const on = st(), vw = [innerWidth, innerHeight], top = getComputedStyle(document.querySelector('.topbar')).display;
    await new Promise((r) => { setTimeout(r, 2300); }); const idle = document.body.classList.contains('idle') && getComputedStyle($('cv')).cursor === 'none';
    window.dispatchEvent(new PointerEvent('pointermove')); const back = !document.body.classList.contains('idle');
    setDisplayMode(false); await new Promise((r) => { setTimeout(r, 150); });
    const after = st(), off = !document.body.classList.contains('display');
    // the resting cursor, as Settings → Display says: hidden in windowed mode too when 'always', never when 'never'
    const keepC = SET.cursor; SET.cursor = 'always'; dmPoke(); await new Promise((r) => { setTimeout(r, 2200); }); const always = document.body.classList.contains('idle');
    SET.cursor = 'never'; dmPoke(); setChamberOnly(true); await new Promise((r) => { setTimeout(r, 2200); }); const never = !document.body.classList.contains('idle'); setChamberOnly(false); SET.cursor = keepC; dmPoke();
    const seg = !!document.querySelector('#segWin [data-v="borderless"]') && !!$('setChamber');
    return { before, on, vw, top, idle, back, after, off, always, never, seg };
  });
  check(r15.on[0] === r15.vw[0] && r15.on[1] === r15.vw[1] && r15.top === 'none' && r15.idle && r15.back && r15.off && r15.after.join() === r15.before.join() && r15.always && r15.never && r15.seg,
    `display: chamber only fills the window (${r15.on.join('×')}), the resting cursor hides and comes back on a move; off again, the layout is as it was; the cursor setting's Always and Never hold; Settings has the window choice`, 'display mode: ' + JSON.stringify(r15));
  // 0.54: Grab keeps up with the mouse in real time (Strong), Gentle is the spring alone; the speed buttons reach 1/512× (0.61)
  const r16 = await page.evaluate(() => {
    const out = {};
    for (const st of ['gentle', 'strong']) {
      loadPreset('empty'); spawnClear({ kind: 'mol', mol: 'H2O' }, -15, 0, 300); setRunning(false); W.simPerFrame = 0.02; UI.adv = 0.02; // (in open space: in a liquid the neighbours must be pushed aside, and that takes force)
      const p = W.parts.find(q => q.k === NUC && q.Z === 8), g = W.grab = { p, x: p.x + 20, y: p.y, s: st, mol: molecule(p) };
      for (let f = 0; f < 30; f++) { simFrame(1 / 60, 30); UI.running = true; grabTick(1 / 60); UI.running = false; }
      out[st] = Math.hypot(g.x - p.x, g.y - p.y); W.grab = null;
    }
    loadPreset('empty'); spawnClear({ kind: 'mol', mol: 'H2O' }, 0, 0, 300); setRunning(false); // (on its own: in the liquid a neighbour may stand in the way)
    const h = W.parts.find(q => q.k === NUC && q.Z === 1 && q.bonds.length), o = other(h.bonds[0], h);
    W.grab = { p: h, x: h.x + 2.5 * (h.x - o.x), y: h.y + 2.5 * (h.y - o.y), s: 'strong', mol: null };
    for (let f = 0; f < 20; f++) { simFrame(1 / 60, 30); grabTick(1 / 60); }
    out.torn = !h.bonds.some(b => other(b, h) === o); W.grab = null;
    for (let i = 0; i < 9; i++) stepSpeed(-1); // (nine halvings to 1/512×; below it the steps go on in decades, 1.04)
    out.min = UI.baseSpf / W.simPerFrame;
    for (let i = 0; i < 12; i++) stepSpeed(1);
    return out;
  });
  check(r16.gentle > 15 && r16.strong < 1 && r16.torn && Math.abs(r16.min - 512) < 1e-6,
    `grab: with time slowed 75×, Strong carries a water molecule to a cursor 20 Å off within half a second (gap ${r16.strong.toFixed(2)} Å; Gentle still ${r16.gentle.toFixed(0)} Å behind); a hydrogen carried off tears its O–H bond; the speed buttons go down to 1/${Math.round(r16.min)}×`, 'grab/speed: ' + JSON.stringify(r16));
  // 0.54: nothing about speed tied to the frame rate: a second of watching at 30, 60, 144 or 240 fps advances the same time
  const r17 = await page.evaluate(() => {
    const run = (pre, fps, budget) => { loadPreset(pre); setRunning(true); const t0 = W.t, c0 = W.chipT || 0; for (let f = 0; f < fps / 2; f++) simFrame(1 / fps, budget); setRunning(false); return [W.t - t0, (W.chipT || 0) - c0]; };
    const out = {};
    for (const fps of [30, 60, 144, 240]) { out['w' + fps] = run('water', fps, 1e9)[0]; out['c' + fps] = run('ringosc', fps, 0.01)[1]; } // (chips: with the physics cut short every frame, as in a crowded box)
    return out;
  });
  { const w = [30, 60, 144, 240].map(f => r17['w' + f]), c = [30, 60, 144, 240].map(f => r17['c' + f]), sp = (a) => Math.max(...a) / Math.min(...a);
    check(sp(w) < 1.001 && sp(c) < 1.05, `frame rate: half a second of watching at 30, 60, 144 and 240 fps advances the same simulated time (spread ${((sp(w) - 1) * 100).toFixed(2)}%), and the chips' clock with it when the physics falls behind (${((sp(c) - 1) * 100).toFixed(1)}%)`, 'frame rate: ' + JSON.stringify(r17)); }
  // 0.55: undo/redo; units; graphics settings reach the drawing; the frame-rate cap; tools remember their settings
  const r18 = await page.evaluate(async () => {
    const out = {};
    loadPreset('empty'); for (let i = 0; i < 6; i++) spawnClear({ kind: 'mol', mol: 'H2O' }, -20 + 8 * i, 10, 300); setRunning(false); UNDO.back.length = 0; UNDO.fwd.length = 0; // (room to place: a full box takes none)
    const n0 = W.parts.filter(p => !p.dead).length, t0 = W.t;
    undoMark('Place'); placeSpec({ kind: 'atom', Z: 8, A: 16 }, 0, 0, 5); const n1 = W.parts.filter(p => !p.dead).length;
    undoStep(-1); const n2 = W.parts.filter(p => !p.dead).length; undoStep(1); const n3 = W.parts.filter(p => !p.dead).length; undoStep(-1);
    out.undo = { n0, n1, n2, n3, back: W.parts.filter(p => !p.dead).length, t: W.t === t0, bonds: W.bonds.length };
    loadPreset('ringosc'); undoMark('x'); out.undoOffChips = UNDO.back.length === 0;
    SET.eunit = 'kJ'; applySettings(); out.kj = fmtE(1); out.big = fmtE(2e6); SET.eunit = 'eV'; SET.lunit = 'nm'; applySettings(); out.nm = fmtA(1.5); SET.lunit = 'A'; applySettings();
    loadPreset('water'); setRunning(false);
    const p = W.parts.find(q => q.k === NUC && q.Z === 8); SET.atomScale = 0.45; applySettings(); out.as = R.as;
    SET.cvd = true; applySettings(); out.cvd = atomColor(p); SET.cvd = false; SET.atomScale = 1; applySettings(); out.std = atomColor(p);
    SET.fpsCap = 30; setRunning(true); let frames = 0; const keepRaf = window.requestAnimationFrame; // (the cap: frames skipped in a 240 Hz stream)
    let t = 1000; UI.nextDue = 0; const keepSim = window.simFrame; let sims = 0; window.simFrame = function () { sims++; return keepSim.apply(this, arguments); };
    window.requestAnimationFrame = () => 0; for (let i = 0; i < 240; i++) { t += 1000 / 240; frame(t); frames++; } window.requestAnimationFrame = keepRaf; window.simFrame = keepSim; SET.fpsCap = 0; setRunning(false);
    out.cap = sims;
    OPT.grab.s = 'max'; optSave(); OPT.grab.s = 'strong'; optLoad(); out.opt = OPT.grab.s; OPT.grab.s = 'strong'; optSave();
    return out;
  });
  { const u = r18.undo;
    check(u.n1 > u.n0 && u.n2 === u.n0 && u.n3 === u.n1 && u.back === u.n0 && u.t && r18.undoOffChips && /kJ\/mol$/.test(r18.kj) && /^96\.5/.test(r18.kj) && / MeV$/.test(r18.big) && r18.nm === '0.150 nm'
      && r18.as === 0.45 && r18.cvd === '#d55e00' && r18.std !== r18.cvd && r18.cap >= 29 && r18.cap <= 31 && r18.opt === 'max',
    `settings: undo takes back ${u.n1 - u.n0} placed atoms and redo puts them again (clock and bonds as they were), off with chips; 1 eV = ${r18.kj}, 2 MeV stays MeV; 1.5 Å = ${r18.nm}; atom size, colour-blind palette reach the drawing; a 30 fps cap draws ${r18.cap} of 240 frames; tools remember their settings`,
    'settings: ' + JSON.stringify(r18)); }
  // 0.55: the main menu at start, a setup from it, the Esc menu (paused while open), Continue back to where it was
  {
    const m = await openPage({ settle: 1500, menu: true });
    const r19 = await m.page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
      const out = { menu: !$('mainMenu').hidden && UI.menu && UI.running, hidden: getComputedStyle(document.querySelector('.panel')).display === 'none' };
      { const cx0 = R.cx; $('mainMenu').dispatchEvent(new PointerEvent('pointermove', { clientX: 5, clientY: 5, bubbles: true })); for (let i = 0; i < 60; i++) mmTick(1 / 60);
        const tf = getComputedStyle(document.querySelector('.mm-card')).transform; out.depth = MMP.still || (R.cx !== cx0 && +$('mainMenu').style.getPropertyValue('--mx') < -0.5 && tf === 'none'); } // (1.23.2: the chamber and the glow follow the mouse; the card with its buttons stays still, so presses land)
      out.choose = !$('mmChoose').hidden; document.querySelector('[data-mm="mode2d"]').click(); out.menu2d = !$('mmBtns').hidden; // (1.25: the 2-D / 3-D choice first)
      document.querySelector('[data-mm="setups"]').click(); out.list = $('mmList').querySelectorAll('button').length;
      document.querySelector('[data-mmp="water"]').click(); await wait(300);
      out.water = !UI.menu && UI.preset === 'water' && getComputedStyle(document.querySelector('.panel')).display !== 'none';
      placeSpec({ kind: 'atom', Z: 11, A: 23 }, 0, 0, 1); const n = W.parts.filter(p => !p.dead).length;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await wait(100); out.esc = !$('escModal').hidden && !UI.running;
      document.querySelector('[data-esc="menu"]').click(); await wait(300); out.back = UI.menu && !$('mmCont0').hidden && !$('mmChoose').hidden;
      document.querySelector('#mmCont0').click(); await wait(300);
      out.cont = !UI.menu && W.parts.filter(p => !p.dead).length === n && UI.preset === 'water';
      return out;
    });
    check(r19.menu && r19.depth && r19.hidden && r19.choose && r19.menu2d && r19.list > 20 && r19.water && r19.esc && r19.back && r19.cont,
      `menus: the main menu at start over a running setup, the chamber behind it following the mouse in depth, its buttons still; ${r19.list} setups to pick from; Esc pauses with its menu; Main menu, then Continue, puts the same ${'chamber'} back`, 'menus: ' + JSON.stringify(r19));
    if (m.errors.length) { fails++; say('FAIL menu page errors:', m.errors.join(' | ').slice(0, 600)); }
    await m.browser.close();
  }
  // 0.57: what the walls do to neutrons; ionic attractions drawn between touching ions of opposite charge
  const r20 = await page.evaluate(() => {
    const out = {};
    for (const [key, nw, E] of [['reflect', 'reflect', 1e6], ['absorb', 'absorb', 0.0253], ['pass', 'pass', 1e6], ['passSlow', 'pass', 0.0253], ['fast', 'fast', 1e6], ['fastSlow', 'fast', 0.0253]]) {
      loadPreset('empty'); setRunning(false); W.nWall = nw; W.gamma = 0; const st0 = W.count.wallStop; // (no bath: a thermal neutron is not turned round before it gets there)
      const n = addNuc(0, 1, 0, W.box.w / 2 - 3, 0, 0, 0, false); setMotion(n, E, 1, 0);
      for (let f = 0; f < 2000 && !n.dead && n.x > 0 && !(n.vx < 0 || n.ux < 0); f++) simFrame(1 / 60, 30);
      out[key] = { dead: n.dead, back: !n.dead && (n.vx < 0 || n.ux < 0), stop: W.count.wallStop - st0 };
    }
    // the absorber's 1/v law, by the odds of a capture at a hit (one thermal neutron above may be among the 0.7% let back)
    W.nWall = 'absorb'; W.wall = 'reflect';
    for (const E of [0.0253, 1, 1e6]) { let c = 0; for (let i = 0; i < 4000; i++) if (neutronLeaves({ k: NUC, Z: 0, rad: true, KE: E })) c++; out['P' + E] = c / 4000; }
    loadPreset('empty'); setRunning(false); R.view.ionic = true;
    const na = addNuc(11, 12, 10, 0, 0, 0, 0, false), cl = addNuc(17, 18, 18, 2.8, 0, 0, 0, false), far = addNuc(17, 18, 18, -15, 0, 0, 0, false);
    refresh(na); refresh(cl); refresh(far); R.s = 30; R.cx = 0; R.cy = 0;
    let lines = 0; const ctx = R.ctx, keep = ctx.lineTo; ctx.lineTo = function () { lines++; return keep.apply(this, arguments); };
    drawIonic(); ctx.lineTo = keep; out.ionic = { lines, qa: na.q, qb: cl.q };
    return out;
  });
  check(r20.reflect.back && !r20.reflect.dead && (r20.absorb.dead ? r20.absorb.stop === 1 : r20.absorb.back) && r20['P0.0253'] > 0.98 && r20.P1 > 0.45 && r20.P1 < 0.65 && r20.P1000000 < 0.004 && r20.pass.dead && r20.pass.stop === 0 && r20.passSlow.dead && r20.fast.dead && r20.fast.stop === 0 && r20.fastSlow.back && !r20.fastSlow.dead && r20.ionic.lines === 1,
    `walls and neutrons: a 1 MeV neutron bounces back off a reflector; an absorber captures by the 1/v law (a thermal one ${(100 * r20['P0.0253']).toFixed(1)}% a hit, 1 eV ${(100 * r20.P1).toFixed(0)}%, 1 MeV ${(100 * r20.P1000000).toFixed(2)}%); neutrons fly out through a thin wall; 'fast leave' lets a 1 MeV one out and bounces a thermal one; an Na⁺ touching a Cl⁻ is joined by an ionic line, a far Cl⁻ is not`, 'walls/ionic: ' + JSON.stringify(r20));
  // 0.57: measure, kept views, rewind (and its undo), the graph and its CSV, the tour, a long press
  const r21 = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => { setTimeout(r, ms); }), out = {};
    loadPreset('empty'); setRunning(false);
    const a = addNuc(8, 8, 8, 0, 0, 0, 0, false), b = addNuc(8, 8, 8, 3, 0, 0, 0, false), c = addNuc(8, 8, 8, 3, 4, 0, 0, false);
    R.measure = [a, b, c]; SET.lunit = 'A'; applySettings(); out.meas = measureText();
    R.s = 33; R.cx = 1; R.cy = 2; viewSave('7'); R.s = 5; R.cx = 0; R.cy = 0; viewGo('7'); for (let i = 0; i < 40; i++) viewTick(1 / 60); out.view = [+R.s.toFixed(3), +R.cx.toFixed(3), +R.cy.toFixed(3)];
    // rewind: water runs 2.5 s of watching, then back three snapshots and on from there
    loadPreset('water'); SET.rewOn = true; SET.rewEvery = 0.25; setRunning(true); REW.last = 0;
    await wait(2600); setRunning(false); const tEnd = W.t, nSnap = REW.snaps.length;
    rewOpen(); rewStep(-3); const tBack = W.t, iBack = REW.i; rewCommit(false);
    out.rew = { nSnap, back: tBack < tEnd, kept: REW.snaps.length === iBack + 1, open: REW.open };
    undoStep(-1); out.rew.undo = Math.abs(W.t - tEnd) < 1e-9;
    loadPreset('ringosc'); setRunning(true); REW.last = 0; await wait(400); setRunning(false); out.rew.chips = REW.snaps.length === 0;
    SET.rewEvery = 0.5;
    // the graph: a few samples, and the CSV it makes
    loadPreset('water'); setRunning(true); GR.last = 0; await wait(1800); setRunning(false);
    let csv = null; const keep = fileSave; fileSave = async (name, text) => { csv = { name, text }; return true; }; grCsv(); await wait(50); fileSave = keep; // eslint-disable-line no-func-assign
    out.graph = { n: GR.t.length, rows: csv ? csv.text.trim().split('\n').length : 0, head: csv ? csv.text.split('\n')[0].slice(0, 80) : '', water: csv ? /H₂O/.test(csv.text.split('\n')[0]) : false };
    // the tour, start to end; a long press with a finger opens the quick menu
    store('toured', ''); tourStart(); out.tour = !$('tour').hidden; for (let i = 0; i < 10 && !$('tour').hidden; i++) $('tourNext').click(); out.tourEnd = $('tour').hidden && store('toured') === '1';
    setTool('inspect'); UI.pointers.clear(); UI.pointers.set(9, { x: 300, y: 300 }); lpStart({ pointerType: 'touch', pointerId: 9 }, 300, 300); await wait(650); out.lp = QM.open; closeQuickMenu(); UI.pointers.clear();
    return out;
  });
  check(r21.meas === '3.00 Å and 4.00 Å; angle 90.0°' && r21.view.join() === '33,1,2' && r21.rew.nSnap >= 6 && r21.rew.back && r21.rew.kept && !r21.rew.open && r21.rew.undo && r21.rew.chips
    && r21.graph.n >= 3 && r21.graph.rows === r21.graph.n + 1 && r21.graph.water && r21.tour && r21.tourEnd && r21.lp,
    `tools: measure gives ${r21.meas}; a kept view comes back; rewind kept ${r21.rew.nSnap} snapshots, went back and carried on (later ones dropped), Ctrl+Z returns to before it, none kept with chips; the graph's CSV has ${r21.graph.rows} rows with the water counted; the tour runs to its end; a long press opens the quick menu`,
    'tools: ' + JSON.stringify(r21));
  // 0.58: every particle in the palette's menus; neutrinos with their flavours; resonances made in collisions and
  // decaying at once, the books exact; the pair masses showing the ρ
  const r22 = await page.evaluate(() => {
    const out = {};
    loadPreset('empty'); setRunning(false); W.decayOn = false;
    out.cats = PCATS.map(([n, l]) => n + ':' + l.filter(x => x !== 'pt').length).join(' ');
    const btn = document.querySelector('#palette .cat[data-ci="4"]'); pmenuOpen(4, btn); const items = document.querySelectorAll('#pmenu .pm-i').length; document.querySelector('#pmenu .pm-i[data-k="0"]').click();
    out.menu = { items, spec: UI.spec.sp, closed: $('pmenu').hidden };
    placeSpec(UI.spec, 0, 0, 1); out.placedPi = W.exo.filter(o => !o.dead).map(o => o.sp).join();
    selectSpec({ kind: 'nu', fl: 'tau', anti: true }); placeSpec(UI.spec, 0, 0, 1); out.nu = W.rays.filter(r => r.nu).map(r => r.lab.split(' ')[0]).join();
    selectSpec({ kind: 'gamma' }); OPT.place.Es = 600; placeSpec(UI.spec, 0, 0, 1); out.gamma = W.flights.length + W.rays.filter(r => !r.nu).length;
    selectSpec({ kind: 'exo', sp: 'rho0' }); placeSpec(UI.spec, 0, 0, 1); simFrame(1 / 60, 30); out.rhoPl = W.exo.filter(o => !o.dead).map(o => o.sp).sort().join();
    // a muon's decay: a muon neutrino and an electron antineutrino
    loadPreset('empty'); setRunning(false); W.decayOn = true; const mu = addExo('mu-', 0, 0, 1e3, 1, 0); decayExo(mu); out.muNu = W.rays.filter(r => r.nu).map(r => r.lab.split(' ')[0]).sort().join();
    // e⁺e⁻ at 10 GeV: resonances, exact books, the ρ standing out
    loadPreset('linac'); setupCollider('linear', 'pos', 'e', 5e9); W.slowHold = false; W.slowmo = false; let res = 0, worst = 0;
    const keep = decayExo; decayExo = function (o) { if (XP[o.sp].res) res++; return keep.apply(this, arguments); }; // eslint-disable-line no-func-assign
    for (let f = 0; f < 2500; f++) simFrame(1 / 60, 30);
    decayExo = keep; // eslint-disable-line no-func-assign
    const sum = (a, lo, hi) => { let t = 0; for (let b = lo / 10; b < hi / 10; b++) t += a[b]; return t; }, H = PAIRS.h.pipi, L = PAIRS.ls.pipi;
    out.res = res; out.rho = { peak: sum(H, 700, 850) - sum(L, 700, 850), side: (sum(H, 1100, 1250) - sum(L, 1100, 1250)) };
    out.made = W.collider && W.collider.made ? ['ρ⁰', 'ω', 'K*⁺', 'Δ⁺⁺'].filter(k => W.collider.made[k]).join() : '';
    return out;
  });
  check(r22.menu.items === 8 && r22.menu.spec === 'pi+' && r22.menu.closed && r22.placedPi === 'pi+' && r22.nu === 'ν̄τ' && r22.gamma >= 1 && r22.rhoPl === 'pi+,pi+,pi-' && r22.muNu === 'ν̄ₑ,νμ'
    && r22.res > 50 && r22.rho.peak > 3 * Math.max(1, r22.rho.side),
    `particles: menus ${r22.cats}; a π⁺, a ν̄τ, a photon placed; a ρ⁰ placed decays at once to π⁺π⁻; a muon's decay gives ${r22.muNu}; e⁺e⁻ at 10 GeV made ${r22.res} resonances (${r22.made}); their pairs: ${r22.rho.peak} over the background at the ρ, ${r22.rho.side} away from it`,
    'particles: ' + JSON.stringify(r22));
  // 0.59: hypernuclei — their decays (charge, baryon number and energy exact), and made by stopped K⁻
  const r23 = await page.evaluate(() => {
    const QB = () => { let q = 0, b = 0; for (const p of W.parts) if (!p.dead) { if (p.k === NUC) { q += (p.anti ? -1 : 1) * (p.Z - p.ne); b += (p.anti ? -1 : 1) * (p.Z + p.N); } else q += p.k === ELEC ? -1 : 1; } for (const o of W.exo) if (!o.dead) { q += o.q; b += XP[o.sp].B || 0; } return [q, b]; };
    const E = () => totalEnergy().total - W.ledger.nuc, out = { bad: [], modes: new Set(), worst: 0 };
    for (const [z, n] of [[1, 1], [2, 2], [6, 6], [20, 19], [82, 125]]) for (let t = 0; t < 12; t++) {
      loadPreset('empty'); setRunning(false); const sp = hypSpecies(z, n); _evTag = 0; const o = addExo(sp, 0, 0, 0.03, 1, 0);
      const [q0, b0] = QB(), E0 = E(); hypDecay(o); const [q1, b1] = QB(); out.worst = Math.max(out.worst, Math.abs(E() - E0));
      if (q0 !== q1 || b0 !== b1 || !o.dead) out.bad.push(`${XP[sp].lab}: q ${q0}→${q1} B ${b0}→${b1}`);
      out.modes.add(/non-mesonic/.test(W.log[W.log.length - 1].text) ? 'non' : 'mes');
    }
    let hyp = 0; loadPreset('empty'); setRunning(false); for (let t = 0; t < 200; t++) { clearWorld(); addNuc(6, 6, 6, 0, 0, 0, 0, false); forcesNoEvents(); /* (one setup; the neighbour grid built, as a step would) */ _evTag = 0; const k = addExo('K-', 0.5, 0, 500, 1, 0); const [q0, b0] = QB(); kStop(k); const [q1, b1] = QB(); if (q0 !== q1 || b0 !== b1) out.bad.push(`K⁻ stop: q ${q0}→${q1}`); if (W.exo.some(o => !o.dead && XP[o.sp].hyp)) hyp++; }
    out.hyp = hyp; out.modes = [...out.modes].sort().join(); out.names = [hypSpecies(1, 1), hypSpecies(6, 6)].map(k => XP[k].lab + ' ' + fmtE(XP[k].BL * MEV)).join(', ');
    return out;
  });
  check(!r23.bad.length && r23.worst < 1e-3 && r23.modes === 'mes,non' && r23.hyp >= 2 && r23.hyp <= 30,
    `hypernuclei (${r23.names}): 60 decays, mesonic and non-mesonic, every one exact (worst ${r23.worst.toExponential(0)} eV); a stopped K⁻ in carbon left a hypernucleus ${r23.hyp} times in 200`, 'hypernuclei: ' + JSON.stringify(r23));
  // 0.61: speed below one step a frame saved up; screen kept awake; measure any particle; decay slowed, and the
  // shortest-lived held to be seen; saved molecules edited in the builder; exotic particles in particle view
  const r24a = await page.evaluate(() => {
    const out = {};
    loadPreset('empty'); setRunning(false); W.simPerFrame = DT_MIN / 8; const t0 = W.t; for (let i = 0; i < 64; i++) simFrame(1 / 60, 50);
    out.carry = (W.t - t0) / (64 * DT_MIN / 8); // (1 when the frames' time is saved up, 8 when each frame takes a whole step)
    out.wake = SET.wake === true && !!$('setWake');
    // measure: a pion and a photon in flight, as well as an atom
    loadPreset('empty'); setRunning(false); R.s = 40; R.cx = 0; R.cy = 0; R.measure = [];
    const a = addAtom('C', -3, 0), pi = addExo('pi+', 3, 0, 0, 1, 0);
    W.flights.push({ x0: 0, y0: 4, x1: 0, y1: 40, len: 36, t0: W.t, E: 2, c: [255, 255, 255] });
    setTool('measure'); window._m24 = { a, pi };
    const rc = R.cv.getBoundingClientRect(); out.pts = [[-3, 0], [3, 0], [0, 4]].map(([x, y]) => [rc.left + w2sx(x), rc.top + w2sy(y)]);
    return out;
  });
  for (const [x, y] of r24a.pts) await page.mouse.click(x, y);
  const r24 = await page.evaluate((out) => {
    const { a, pi } = window._m24;
    out.meas = R.measure.length; out.measTxt = measureText(); out.measKinds = R.measure.map(p => p === a ? 'atom' : p === pi ? 'exo' : p._o ? 'flight' : '?').join();
    W.flights.length = 0; out.gone = R.measure.filter(p => !p.dead).length; setTool('place');
    // decay slowed: the slider reaches a millionth; a π⁰ held to be seen flies a few Å, and decays the same way
    W.warp = 1e-3; syncLab(); out.warpTxt = $('warpVal').textContent; out.warpMin = +$('warpSlider').min;
    W.warp = 1; W.minShow = 2; loadPreset('empty'); setRunning(false); W.minShow = 2; const z = addExo('pi0', 0, 0, 50, 1, 0);
    for (let i = 0; i < 2000 && !z.dead; i++) { W.dt = chooseDt(); step(W.dt); W.rt += 1 / 60; }
    out.held = Math.hypot(z.x, z.y); out.heldFate = z.fate; W.minShow = 0;
    // molecule editing: a saved one renamed and changed, in place; Save as new keeps it
    const k = 'mytest1'; myMolAdd({ k, n: 'Test ethane', r: 0, a: [['C', -0.77, 0], ['C', 0.77, 0], ['H', -1.2, 1], ['H', -1.2, -1], ['H', -1.6, 0], ['H', 1.2, 1], ['H', 1.2, -1], ['H', 1.6, 0]], b: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1], [1, 5, 1], [1, 6, 1], [1, 7, 1]] });
    mbLoadMol(k, true); out.loaded = MB.atoms.length + (MB.fill ? ' fill' : ''); out.title = $('bldTitle').textContent; out.newBtn = !$('bldGoNew').hidden;
    mbAttach('O', MB.atoms[0].id); $('bldName').value = 'Test ethanol'; mbBuild();
    const keys = Object.keys(MOLECULES).filter(q => MOLECULES[q].mine);
    out.saved = MOLECULES[k] && MOLECULES[k].name + ' ' + MOLECULES[k].atoms.filter(x => x[0] === 'O').length; out.nMine = keys.length;
    mbLoadMol(k, true); $('bldName').value = 'Test copy'; mbBuild(true);
    out.asNew = Object.keys(MOLECULES).filter(q => MOLECULES[q].mine).length - keys.length; out.kept = MOLECULES[k].name;
    mbLoadMol('H2O', true); out.copyOf = $('bldName').value + (MB.edit ? ' EDITING' : '');
    for (const q of Object.keys(MOLECULES)) if (MOLECULES[q].mine && /^Test/.test(MOLECULES[q].name)) myMolRemove(q); hideModal('bldModal');
    // particle view: what is inside each
    R.view.bohr = 'nuc'; const ctx = R.ctx, ins = {};
    for (const sp of ['pi+', 'Lam', 'Dpp', 'rho0', hypSpecies(6, 6), 'muP', 'mu-', 'tau-']) { const o = addExo(sp, 0, 0, 0, 1, 0); const c = XP[sp].col; ins[sp] = exoInside(ctx, o, 100, 100, c, '#ffffff') > 0; o.dead = true; }
    R.view.bohr = 'auto'; out.inside = Object.entries(ins).map(([k2, v]) => k2 + (v ? '+' : '-')).join(' ');
    return out;
  }, r24a);
  check(Math.abs(r24.carry - 1) < 0.15 && r24.wake && r24.meas === 3 && r24.measKinds === 'atom,exo,flight' && r24.gone === 2 && /slowed/.test(r24.warpTxt) && r24.warpMin === -6
    && r24.held > 5 && r24.held < 8 && /π⁰ → (2γ|e⁺ \+ e⁻ \+ γ)/.test(r24.heldFate || '') && r24.loaded === '2 fill' && r24.title === 'Editing Test ethane' && r24.newBtn
    && r24.saved === 'Test ethanol 1' && r24.asNew === 1 && r24.kept === 'Test ethanol' && r24.copyOf === 'Water (copy)' && r24.inside === 'pi++ Lam+ Dpp+ rho0+ hy6_6+ muP+ mu-+ tau-+',
    `0.61: 1/512× runs ${r24.carry.toFixed(2)}× the time asked; screen kept awake; measured an atom, a pion and a photon (${r24.measTxt}); decay ${r24.warpTxt}; a held π⁰ flew ${r24.held.toFixed(1)} Å; a saved molecule edited in place (${r24.saved}), and saved as new; particle view ${r24.inside}`,
    '0.61: ' + JSON.stringify(r24));
  // 0.62: neutrons meet each other and a nucleus moving into them; hadrons meet nuclei in flight; stopped π⁻ and Σ⁻ are caught
  const r25 = await page.evaluate(() => {
    const out = { nn: {}, bad: [], worst: 0, fates: {} };
    for (const [KE, tz, tn, who] of [[0.0253, 1, 0, 'T'], [0.0253, 0, 1, 'n'], [2e6, 0, 1, 'T'], [2e6, 6, 6, 'T']]) {
      let hits = 0;
      for (let t = 0; t < 12; t++) {
        clearWorld(); W.T = 0; W.gamma = 0; W.decayOn = false;
        const tg = addNuc(tz, tn, 0, 0, 0, 0, 0, false), n = addNuc(0, 1, 0, -12, (t / 12 - 0.5) * 0.2, 0, 0, false);
        const mover = who === 'n' ? n : tg, still = mover === n ? tg : n;
        if (who === 'T') { tg.x = -12; tg.y = n.y; n.x = 0; n.y = 0; }
        forcesNoEvents(); setMotion(mover, KE, 1, 0);
        for (let s = 0; s < 3000 && !mover.dead && !still.dead && mover.x < 12; s++) { W.dt = chooseDt(); step(W.dt); }
        if (mover.dead || still.dead || Math.hypot(still.vx, still.vy) > 1e-9) hits++;
      }
      out.nn[`${KE}eV ${tz ? 'Z' + tz : 'n'}${who === 'T' ? '→n' : '←n'}`] = hits;
    }
    const QB = () => { let q = 0, b = 0; for (const p of W.parts) if (!p.dead) { if (p.k === NUC) { q += (p.anti ? -1 : 1) * (p.Z - p.ne); b += (p.anti ? -1 : 1) * (p.Z + p.N); } else q += p.k === ELEC ? -1 : p.k === POS ? 1 : 0; }
      for (const o of W.exo) if (!o.dead) { q += o.q; const c = Q_CONTENT[o.sp]; if (c && c.length === 3) b += c[0] === c[0].toUpperCase() ? -1 : 1; else if (XP[o.sp].hyp) b += XP[o.sp].B; } return q + ',' + b; };
    const E = () => totalEnergy().total - W.ledger.nuc;
    const hh0 = hadronHit, hs0 = hStop, eW = (f) => function (...a) { const e0 = E(); const r = f.apply(this, a); out.worst = Math.max(out.worst, Math.abs(E() - e0)); return r; }; // (the events themselves exact; a charged hadron's ionizing on the way in is not their doing)
    hadronHit = eW(hh0); hStop = eW(hs0);
    for (const [sp, KE] of [['pi+', 2e8], ['pi-', 8e8], ['K-', 3e8], ['K+', 3e8], ['Lam', 2e8], ['Lamb', 2e8], ['pi-', 1e3], ['Sig-', 1e3]]) for (let t = 0; t < 8; t++) {
      clearWorld(); W.decayOn = false; W.T = 0; W.gamma = 0; addNuc(6, 6, 0, 0, 0, 0, 0, false); forcesNoEvents(); _evTag = 0;
      const o = addExo(sp, KE > 1e4 ? -3 : 0.3, (t % 5 - 2) * 0.04, KE, 1, 0), qb0 = QB();
      for (let s = 0; s < 200 && !o.dead; s++) { W.dt = chooseDt(); step(W.dt); }
      const f = (o.fate || 'flew on').split(':')[0]; out.fates[f] = (out.fates[f] || 0) + 1;
      if (QB() !== qb0) out.bad.push(`${sp}: ${qb0} → ${QB()} (${o.fate})`);
    }
    hadronHit = hh0; hStop = hs0;
    // bremsstrahlung: radiated against collision losses as T·Z/800 MeV; a 13.5 MeV γ on lead frees a neutron (the giant
    // dipole resonance); a stopped μ⁺ makes muonium
    clearWorld(); const wt = addAtom('W', 0, 0), el = addLepton(ELEC, -5, 3); setMotion(el, 1e6, 1, 0); let rad = 0;
    for (let i = 0; i < 300000; i++) { el.KE = 1e6; brems(el, wt, 5000, -5, 3); rad += 1e6 - el.KE; } // (5 keV per collision: thousands of photons, so the mean is sharp)
    out.brems = rad / (300000 * 5000) / (74 / 800); W.rays.length = 0;
    clearWorld(); const pb = addAtom('Pb', 0, 0, { A: 208 }); forcesNoEvents(); const e0 = E(); out.gdr = photoNuclear(pb, 13.5e6, 1, 0) ? W.log[W.log.length - 1].text : 'none'; out.gdrE = Math.abs(E() - e0 - 13.5e6);
    let mu = 0; for (let t = 0; t < 20; t++) { clearWorld(); W.decayOn = false; addAtom('Ar', 0, 0); forcesNoEvents(); const m = addExo('mu+', 0.5, 0, 500, 1, 0); for (let s = 0; s < 50 && !m.dead; s++) { W.dt = chooseDt(); step(W.dt); } if (/Muonium/.test(m.fate || '')) mu++; }
    out.mu = mu;
    return out;
  });
  const nnOk = Object.values(r25.nn).every(v => v === 12), fOk = ['π⁺ + ¹²C', 'π⁻ + ¹²C', 'K⁻ + ¹²C', 'K⁺ + ¹²C', 'Λ + ¹²C', 'Λ̄ + ¹²C', 'π⁻ caught by ¹²C', 'Σ⁻ caught by ¹²C'].every(k => Object.keys(r25.fates).some(f => f.startsWith(k.split(' + ')[0]) && f.includes(k.includes('caught') ? 'caught' : '+')));
  check(nnOk && fOk && !r25.bad.length && r25.worst < 1e-3 && r25.brems > 0.5 && r25.brems < 1.5 && /²⁰⁷Pb \+ n/.test(r25.gdr) && r25.gdrE < 1e-2 && r25.mu >= 6 && r25.mu <= 19,
    `0.62: neutrons met every time (${Object.entries(r25.nn).map(([k, v]) => k + ' ' + v + '/12').join(', ')}); hadrons on carbon: ${Object.entries(r25.fates).map(([k, v]) => k + ' ' + v).join(', ')}; charge and baryon number kept, energy to ${r25.worst.toExponential(0)} eV; bremsstrahlung at ${r25.brems.toFixed(2)} of T·Z/800; ${r25.gdr}; muonium from ${r25.mu} of 20 stopped μ⁺`,
    '0.62: ' + JSON.stringify(r25));
  // 0.64: a placed magnet's field and size, and a beam source's energy and rate, edited from the right-click menu
  const r26 = await page.evaluate(() => {
    loadPreset('empty'); setRunning(false); R.s = 20; R.cx = 0; R.cy = 0; closeQuickMenu();
    const mg = { x: 5, y: 0, R: 9, B: -1e4 }; W.magnets.push(mg);
    const set = (k, v) => { const r = document.querySelectorAll('#qmenu [data-qr]')[k]; r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); return r.parentElement.querySelector('.num').textContent; };
    openQuickMenu(w2sx(5), w2sy(0)); const t1 = set(0, 600), t2 = set(1, 100), open1 = QM.open; closeQuickMenu(); W.magnets.length = 0; // (its new size would reach the source's spot)
    const src = { x: -5, y: 0, ux: 1, uy: 0, spec: SPEC_P, KE: 1e3, rate: 0.3, acc: 0 }; W.sources.push(src);
    openQuickMenu(w2sx(-5), w2sy(0)); const t3 = set(0, 800), t4 = set(1, 20); closeQuickMenu(); W.sources.length = 0; W.magnets.length = 0;
    return { B: mg.B, R: mg.R, t1, t2, open1, KE: src.KE, rate: src.rate, t3, t4 };
  });
  check(Math.abs(r26.B + 1e6) < 1 && r26.R > 50 && r26.R < 60 && r26.open1 && Math.abs(r26.KE - 1e6) < 1 && Math.abs(r26.rate - 2) < 1e-9,
    `0.64: right-click edits: a magnet set to ${r26.t1} (still a S pole) and ${r26.t2} across; a beam source to ${r26.t3}, ${r26.t4}`, '0.64: ' + JSON.stringify(r26));
  // 0.64: crystal grab, placing at rest, a particle's motion from the menu, orbit info, finding particles, replay
  // buttons, a graphed particle, named saves
  const r27 = await page.evaluate(async () => {
    const out = {};
    loadPreset('brine'); setRunning(false); const na = W.parts.find(p => p.Z === 11 && Math.abs(p.x) < 2 && Math.abs(p.y) < 2) || W.parts.find(p => p.Z === 11); out.grab = grabGroup(na).filter(p => p.Z === 11 || p.Z === 17).length;
    loadPreset('empty'); setRunning(false); W.T = 3000; OPT.place.rest = true; const ps = placeSpec({ kind: 'atom', Z: 18, A: 40 }, 0, 0, 5); out.rest = ps.every(p => p.vx === 0 && p.vy === 0); OPT.place.rest = false;
    R.s = 20; R.cx = 0; R.cy = 0; closeQuickMenu(); const e = addLepton(ELEC, 6, 6); e.vx = 0; e.vy = 0;
    openQuickMenu(w2sx(6), w2sy(6)); const rs = document.querySelectorAll('#qmenu [data-qr]'); out.nr = rs.length;
    rs[0].value = '700'; rs[0].dispatchEvent(new Event('input', { bubbles: true })); rs[1].value = '90'; rs[1].dispatchEvent(new Event('input', { bubbles: true })); closeQuickMenu();
    out.ke = keOf(e); out.up = e.vy > 0 && Math.abs(e.vx) < 1e-6 * Math.abs(e.vy);
    W.Bz = -1e9; e.vx = 0; e.vy = 0; setMotion(e, 3.3e-4, 1, 0); out.gyro = gyroRows(-1, PHYS.ME, 1, Math.hypot(e.vx, e.vy), e.x, e.y, e).map(r => r[1]).join(); W.Bz = 0;
    out.find = ['lambda', 'muonium', 'pi-', 'antineutron', 'xi'].map(q => { const m = pfindMatch(q)[0]; return m ? specLabel(m.sp) : '-'; }).join(' ');
    grFollow(e); out.graph = GR.track === e && grSel().includes('pv');
    // replay buttons: a nuclear event logged after rewind snapshots exist
    loadPreset('water'); SET.rewOn = true; SET.rewEvery = 0.25; REW.last = 0; setRunning(true); await new Promise(r => setTimeout(r, 900)); setRunning(false);
    log('nuc', 'Test event'); UI.lastLogSeq = -1; renderLog(); const btn = document.querySelector('#logList .lgo'); out.lgo = !!btn;
    if (btn) { btn.click(); out.rewound = REW.open && REW.i < REW.snaps.length && W.slowHold; rewLive(); if (W.slowHold) toggleSlowmo(); }
    // named saves
    openMine(); $('mineName').value = 'Test save 0.64'; $('mineSave').click(); await new Promise(r => setTimeout(r, 400));
    const rows = [...document.querySelectorAll('#mineList .minerow')].filter(r => /Test save 0\.64/.test(r.textContent)); out.saved = rows.length;
    const n0 = W.parts.filter(p => !p.dead).length; loadPreset('empty');
    if (rows[0]) { rows[0].querySelector('[data-load]').click(); await new Promise(r => setTimeout(r, 400)); }
    out.loaded = W.parts.filter(p => !p.dead).length === n0;
    openMine(); await new Promise(r => setTimeout(r, 300)); for (const r of [...document.querySelectorAll('#mineList .minerow')].filter(r => /Test save 0\.64/.test(r.textContent))) { const d = r.querySelector('[data-del]'); d.click(); d.click(); }
    await new Promise(r => setTimeout(r, 300)); hideModal('mineModal');
    return out;
  });
  check(r27.grab === 36 && r27.rest && r27.nr === 2 && Math.abs(r27.ke - 1e5) < 1 && r27.up && /×10⁻⁶ Å across/.test(r27.gyro) && r27.find === 'Λ Mu π⁻ n̄ Ξ⁰' && r27.graph && r27.lgo && r27.rewound && r27.saved === 1 && r27.loaded,
    `0.64: a whole crystal grabbed (${r27.grab} ions); placed at rest; an electron set to 100 keV, straight up, from its menu; ${r27.gyro}; found ${r27.find}; graphed; an event replayed; an experiment saved and loaded`,
    '0.64: ' + JSON.stringify(r27));
  // 0.66: ionic compounds named, ionic molecules built, categories moved, Auto priority, placed objects
  const r28 = await page.evaluate(async () => {
    const out = {};
    loadPreset('salt'); setRunning(false); settleOverlaps(); forcesNoEvents();
    const na = W.parts.find(p => !p.dead && p.Z === 11); const cl = ionicCluster(na); out.salt = cl ? ionicText(cl, true) : 'none';
    out.data = speciesCounts().map(([k, e]) => `${k}:${e.n}`).join(' ');
    clearWorld(); const mg = addNuc(12, 12, 10, 0, 0), c1 = addNuc(17, 18, 18, 2.4, 0), c2 = addNuc(17, 18, 18, -2.4, 0); forcesNoEvents(); out.mg = ionicText(ionicCluster(mg));
    // the builder: Na⁺ and Cl⁻ as two pieces
    openMolBuilder(); MB.atoms = [{ id: 1, el: 'Na', q: 1, x: 0, y: 0 }, { id: 2, el: 'Cl', q: -1, x: 3, y: 0 }]; MB.bonds = []; MB.next = 3; mbChanged(true);
    const inf = mbAnalyze(); out.bIssues = inf.issues.length; out.bName = inf.name;
    $('bldName').value = ''; $('bldCat').value = 'ions'; mbBuild(); await new Promise(r => setTimeout(r, 300));
    const mine = Object.values(MOLECULES).filter(m => m.mine && /chloride/i.test(m.name)); out.built = mine.length ? `${mine[0].name} in ${mine[0].cat}, ${mine[0].atoms.length} ions` : 'none';
    if (mine[0]) { // move it to another category without changing it: no settling again
      mbLoadMol(mine[0].key, true); $('bldCat').value = 'inorganic'; mbBuild(); await new Promise(r => setTimeout(r, 200));
      out.moved = MOLECULES[mine[0].key] && MOLECULES[mine[0].key].cat; myMolRemove(mine[0].key);
    }
    hideModal('bldModal');
    // Auto priority: slow drawing and a sim behind its speed lean it fast; quick drawing and keeping up keep it smooth
    SET.prioAuto = true; UI.prioAuto = 0; UI.prioWant = -1; UI.fp = UI.fp || {}; const keep = [UI.fp.drawAvg, UI.fp.uiAvg, UI.ach, UI.running, UI.fp.simAvg, UI.fpsNow];
    UI.running = true; UI.fp.drawAvg = 9; UI.fp.uiAvg = 1; UI.ach = 0.4; for (let i = 0; i < 3; i++) { UI.prioT = 0; prioAutoTick(1e9 + i * 3000); } out.autoSlow = UI.prioAuto;
    UI.fp.drawAvg = 1; UI.ach = 1; UI.fp.simAvg = 4; UI.fpsNow = 20; for (let i = 0; i < 3; i++) { UI.prioT = 0; prioAutoTick(2e9 + i * 3000); } out.autoFast = UI.prioAuto;
    [UI.fp.drawAvg, UI.fp.uiAvg, UI.ach, UI.running, UI.fp.simAvg, UI.fpsNow] = keep; SET.prioAuto = false; syncPrio();
    // objects: a mirror turns light, a lens focuses, a foil passes most α, a stop keeps the books, save and load
    loadPreset('empty'); setRunning(false); W.T = 0; W.gamma = 0; W.box.w = W.box.tw = 120; W.box.h = W.box.th = 90;
    objAdd('mirror', 5, -5, 15, 5); W.rays.length = 0; emitPhoton(-20, 0, 2.1, 1, 0, {}); const rr = W.rays[1]; out.mirror = rr ? Math.round(Math.atan2(rr.y1 - rr.y0, rr.x1 - rr.x0) * 180 / Math.PI) : 'none';
    W.objs.length = 0; objAdd('lens', 0, -10, 0, 10, { f: 20 }); W.rays.length = 0; for (const y of [-6, 6]) emitPhoton(-30, y, 2.1, 1, 0, {});
    out.focus = W.rays.filter(r => r.x0 > -1).map(r => { const t = -r.y0 / (r.y1 - r.y0); return +(r.x0 + t * (r.x1 - r.x0)).toFixed(2); }).join(',');
    W.objs.length = 0; const sc = objAdd('screen', 40, -40, 40, 40); objAdd('foil', 0, -30, 0, 30, { Z: 79, layers: 10 });
    for (let i = 0; i < 100; i++) { const a = addNuc(2, 2, 0, -30, (rnd() - 0.5) * 30); setMotion(a, 5e6, 1, 0); }
    forcesNoEvents(); W.fSpawn = W.spawned; for (let k = 0; k < 60; k++) { W.dt = chooseDt(); step(W.dt); }
    out.foil = sc.hits.parts;
    const E0 = totalEnergy().total - W.ledger.nuc; objAdd('stop', 30, -10, 30, 10); for (let i = 0; i < 5; i++) { const p = addNuc(1, 0, 0, -20, i); setMotion(p, 1e5, 1, 0); }
    const E1 = totalEnergy().total - W.ledger.nuc; forcesNoEvents(); W.fSpawn = W.spawned; for (let k = 0; k < 200; k++) { W.dt = chooseDt(); step(W.dt); }
    out.stopDrift = +(totalEnergy().total - W.ledger.nuc - E1).toFixed(3); out.stopped = W.parts.filter(p => !p.dead && p.Z === 1).length;
    objAdd('plates', -10, -5, 10, -5, { V: 300, gap: 10 }); out.E = Efield(0, 0, null)[1];
    const n0 = W.objs.length, d = worldToJSON(); worldFromJSON(JSON.parse(JSON.stringify(d))); out.saved = `${n0} → ${W.objs.length}`;
    return out;
  });
  check(/^NaCl \(sodium chloride\), \d+ formula units$/.test(r28.salt) && /NaCl:\d+/.test(r28.data) && r28.mg === 'MgCl₂ (magnesium chloride)' && r28.bIssues === 0 && r28.bName === 'Sodium chloride' &&
    /^Sodium chloride in ions, 2 ions$/.test(r28.built) && r28.moved === 'inorganic' && r28.autoSlow > 0 && r28.autoFast === 0 &&
    r28.mirror === 90 && r28.focus === '20,20' && r28.foil >= 90 && Math.abs(r28.stopDrift) < 1e-6 && r28.stopped === 0 && Math.abs(r28.E - 30) < 1e-9 && r28.saved === '4 → 4',
    `0.66: ${r28.salt}; ${r28.mg}; built ${r28.built}, moved to ${r28.moved}; Auto priority ${r28.autoSlow} when behind, ${r28.autoFast} when keeping up; a mirror turned light ${r28.mirror}°, a lens focused at ${r28.focus} Å, ${r28.foil} of 100 α through a gold foil reached the screen, a stop kept the books (${r28.stopDrift} eV)`,
    '0.66: ' + JSON.stringify(r28));
  // 0.67: setups start paused; a beam source fires in slow motion; muonium in particle view
  const r29 = await page.evaluate(async () => {
    const out = {}; SET.startPaused = true; window.AF_NO_PAUSE = false; setRunning(true); loadPreset('isolde'); out.paused = !UI.running; out.badge = $('pausedBadge').textContent;
    setRunning(true); W.simPerFrame = W.baseSpf / 256; const seen = new Set(); const t0 = performance.now();
    while (performance.now() - t0 < 2500) { await new Promise(r => setTimeout(r, 100)); for (const p of W.parts) if (p.srcRef) seen.add(p); }
    out.fired = seen.size; setRunning(false); window.AF_NO_PAUSE = true;
    return out;
  });
  check(r29.paused && /READY/.test(r29.badge) && r29.fired >= 3, `0.67: a setup waits at its start (“${r29.badge}”); at 1/256 speed its beam source fired ${r29.fired} times in 2.5 s`, '0.67: ' + JSON.stringify(r29));
  // 0.68: the new setups; objects selected, copied, pasted, moved and deleted; Help
  const r30 = await page.evaluate(async () => {
    const out = {};
    for (const k of ['rutherford', 'prism', 'emtube']) { loadPreset(k); setRunning(true); await new Promise(r => setTimeout(r, 1500)); setRunning(false); out[k] = W.objs.filter(o => o.kind === 'screen').reduce((a, o) => a + o.hits.n, 0); }
    loadPreset('empty'); setRunning(false); objAdd('mirror', -5, -5, -5, 5); objAdd('wall', 5, -5, 5, 5);
    setTool('select'); finishSelBox({ x0: -10, y0: -10, x1: 10, y1: 10, px: 0, py: 0, add: false, hit: null }); out.sel = selCount();
    copySelection(); pasteClip(20, 0); out.pasted = W.objs.length;
    moveSelection(0, 3); out.moved = W.objs.slice(2).every(o => Math.abs((o.y0 + o.y1) / 2 - 3) < 1e-9);
    deleteSelection(); out.left = W.objs.length;
    openHelp(); out.help = !$('helpModal').hidden && /Getting started/.test($('helpModal').textContent); hideModal('helpModal');
    return out;
  });
  check(r30.rutherford > 0 && r30.prism > 0 && r30.emtube > 0 && r30.sel === 2 && r30.pasted === 4 && r30.moved && r30.left === 2 && r30.help,
    `0.68: new setups' screens counted ${r30.rutherford} α, ${r30.prism} photons, ${r30.emtube} electrons; two objects selected, pasted, moved and deleted; Help opens`, '0.68: ' + JSON.stringify(r30));
  // 0.91: light in flight waits while it crosses a prism (the path inside is drawn going at c; the light leaves the far
  // side when it gets there), and automatic slow motion scales with the speed buttons
  const r31 = await page.evaluate(async () => {
    const out = {};
    loadPreset('prism'); setRunning(true);
    for (let i = 0; i < 200 && !out.wait; i++) {
      await new Promise(r => setTimeout(r, 50));
      const f = W.flights.find(f => f.t0 > W.t); if (!f) continue;
      const ray = W.rays.find(q => !q.landed && Math.hypot(q.x1 - f.x0, q.y1 - f.y0) < 1e-3);
      out.wait = true; out.gap = ray ? Math.abs(ray.ts + ray.len / PHYS.C - f.t0) : -1;
    }
    setRunning(false);
    loadPreset('empty'); setRunning(false); W.slowmo = true;
    const base = W.baseSpf || W.simPerFrame;
    addNuc(0, 1, 0, 0, 0, 3000, 0); // (a fast neutron: what slow motion follows)
    // (1.14: slow motion sets the speed, a speed from the menu at or below what it wants: the ratio is 16 to within a step of the menu)
    W.slowSet = 0; W.simPerFrame = base; W.slow = { t0: W.rt - 0.01, on: true, f: 1 }; slowSpeed(1 / 60); const a = W.simPerFrame; out.ladderA = speedLadder().includes(a);
    W.slowSet = 0; W.simPerFrame = base / 16; W.slow = { t0: W.rt - 0.01, on: true, f: 1 }; slowSpeed(1 / 60); const b = W.simPerFrame;
    W.slowSet = 0; W.simPerFrame = base; W.slow = null;
    out.ratio = a / b; out.a = a / base;
    return out;
  });
  check(r31.wait && r31.gap >= 0 && r31.gap < 1e-9 && r31.ladderA && r31.a < 0.5 && r31.ratio > 16 / 10.01 && r31.ratio < 16 * 10.01,
    `0.91: light leaves the prism when its path inside has been crossed (gap ${r31.gap}); automatic slow motion set ${r31.a && r31.a.toPrecision(2)}× from 1×, ${r31.ratio && r31.ratio.toFixed(1)} times slower again from 1/16× (to the menu's steps)`, '0.91: ' + JSON.stringify(r31));
  // 0.92: an electron at the bottom of a molecular cation's well is captured even when the capture must break a π bond
  // (C=F⁺ + e⁻ → C–F·): it used to stay there for ever, every try undone
  const r32 = await page.evaluate(() => {
    loadPreset('empty'); setRunning(false); W.T = 300; W.wall = 'reflect';
    const c1 = addAtom('C', 0, 0), c2 = addAtom('C', 1.54, 0), f = [[-0.5, 1.2], [-0.5, -1.2], [-1.3, 0], [2.0, 1.2], [2.0, -1.2]].map(([x, y], i) => addAtom('F', x, y, i === 3 ? { charge: 1 } : {}));
    addBond(c1, c2, 1); for (let i = 0; i < 3; i++) addBond(c1, f[i], 1); addBond(c2, f[3], 2); addBond(c2, f[4], 1); // (CF₃–CF=F⁺)
    const F = f[3], run = (n) => { for (let k = 0; k < n; k++) { if (W.fSpawn !== W.spawned) { forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = chooseDt(); step(W.dt); } };
    forcesNoEvents(); W.fSpawn = W.spawned; run(200);
    const dbl = W.bonds.some(b => (b.a === F || b.b === F) && b.order === 2) && F.q === 1;
    const e = addLepton(ELEC, F.x + 0.4, F.y - 0.3, F.vx, F.vy); updateFast(e); W.spawned++;
    const rec0 = W.count.recomb; run(3000);
    return { dbl, had: !!e, q: F.q, left: W.parts.filter(p => p.k === ELEC && !p.dead).length, rec: W.count.recomb - rec0 };
  });
  check(r32.dbl && r32.had && r32.q === 0 && r32.left === 0 && r32.rec >= 1,
    `0.92: an electron in the well of C=F⁺ is captured (C₂F₅⁺ + e⁻ → C₂F₅), the bond it costs paid by the surroundings`, '0.92: ' + JSON.stringify(r32));
  // 0.92: a 1 PeV neutron on a proton, nearly head on, in steps as short as 1/512× slow motion makes them: they meet at
  // their closest (the inelastic core), not at the outskirts of the reach on the way in (where diffraction turned it a
  // hair and it passed through)
  const r33 = await page.evaluate(() => {
    let hits = 0;
    for (let k = 0; k < 6; k++) {
      loadPreset('empty'); setRunning(false); W.T = 0; W.gamma = 0; W.wall = 'open'; W.decayOn = false;
      const p = addNuc(1, 0, 0, 10, (k - 2.5) * 0.004, 0, 0, false), n = addNuc(0, 1, 0, 8, 0, 0, 0, false); setMotion(n, 1e15, 1, 0);
      forcesNoEvents(); W.fSpawn = W.spawned; const r0 = W.count.reactions || 0, l0 = W.logSeq;
      for (let i = 0; i < 2000 && !n.dead && n.x < 12; i++) { W.dt = 7.7e-8; step(W.dt); }
      if (n.dead || W.log.some(e => e.seq > l0 && /^n \+ p → /.test(e.text))) hits++;
    }
    return { hits };
  });
  check(r33.hits === 6, `0.92: a 1 PeV neutron through a proton in 1/512×-sized steps reacts every time (${r33.hits} of 6)`, '0.92 PeV: ' + JSON.stringify(r33));
  // 0.94: the graph's canvas follows its height as quantities are picked (it was stretched from its first height)
  const r34 = await page.evaluate(() => {
    loadPreset('water'); setRunning(false); for (let i = 0; i < 4; i++) { simFrame(1 / 60, 25); UI.running = true; GR.last = -1e9; grTick(performance.now() + i * 1000); UI.running = false; }
    store('graphSel', JSON.stringify(['T'])); const tab = [...document.querySelectorAll('.panel .tabs button, .panel [role=tab]')].find(x => /Data/.test(x.textContent)); if (tab) tab.click();
    drawGraph(); store('graphSel', JSON.stringify(['T', 'n', 'freeE', 'chem'])); drawGraph();
    const cv = $('chG'), dpr = Math.min(2, window.devicePixelRatio || 1);
    return { css: cv.clientHeight, px: cv.height, want: Math.round(cv.clientHeight * dpr) };
  });
  check(r34.css > 200 && r34.px === r34.want, `0.94: the graph's canvas is ${r34.px} px high for ${r34.css} px on screen with four quantities`, '0.94 graph: ' + JSON.stringify(r34));
  // 0.95: aromatic rings (equal bonds, 1.40 Å, harder to add to) and carbon monoxide as C≡O (closed; made in a fire as C=O,
  // it closes up; air at room temperature does not burn it)
  const r35 = await page.evaluate(() => {
    const out = {}, run = (n) => { for (let k = 0; k < n; k++) { if (W.fSpawn !== W.spawned) { forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = chooseDt(); step(W.dt); } };
    loadPreset('empty'); setRunning(false); W.T = 0; W.gamma = 0;
    addMolecule('benzene', 0, 0, 0, 0); forcesNoEvents(); W.fSpawn = W.spawned; run(400);
    const cc = W.bonds.filter(b => b.arom).map(b => Math.hypot(b.a.x - b.b.x, b.a.y - b.b.y));
    out.benz = { n: cc.length, lo: +Math.min(...cc).toFixed(3), hi: +Math.max(...cc).toFixed(3) };
    loadPreset('empty'); setRunning(false); addMolecule('naphthalene', 0, 0, 0, 0); out.naph = W.bonds.filter(b => b.arom).length;
    // the barrier for an H atom adding across benzene's double bond, against ethylene's
    const Ea = (key) => { loadPreset('empty'); setRunning(false); const ps = addMolecule(key, 0, 0, 0, 0), C = ps.find(p => p.Z === 6 && p.bonds.some(b => b.order === 2)), H = addAtom('H', C.x, C.y + 3, { T: 0 }); const rx = reaction(H, C); return rx ? [+rx.Ea.toFixed(2), +rx.dH.toFixed(2)] : null; };
    out.EaBenz = Ea('benzene'); out.EaEth = Ea('C2H4');
    loadPreset('empty'); setRunning(false); W.T = 300; const co = addMolecule('CO', 0, 0, 0, 300); out.co = { order: W.bonds[0].order, qC: co[0].q, qO: co[1].q };
    loadPreset('empty'); setRunning(false); W.T = 1500; W.gamma = 0.05; const c = addAtom('C', -1, 0), o = addAtom('O', 1, 0); c.vx = 0.3; o.vx = -0.3; forcesNoEvents(); W.fSpawn = W.spawned;
    for (let k = 0; k < 40; k++) { run(200); housekeeping(); }
    out.made = W.bonds.map(b => b.order).join(',') + ' ' + c.q + ' ' + o.q;
    out.cold = 6; // (six CO among O₂ at 300 K keep their triple bonds: now in f_bug125 "coCold", seeded; on the page's own random stream it followed the draws, 4 of 6 once: bug fix 19 after 1.25)
    return out;
  });
  check(r35.benz.n === 6 && r35.benz.lo > 1.37 && r35.benz.hi < 1.43 && r35.naph === 11 && r35.EaBenz[0] > r35.EaEth[0] && r35.EaBenz[1] > r35.EaEth[1] + 0.15 && r35.co.order === 3 && r35.co.qC === -1 && r35.co.qO === 1 && r35.made === '3 -1 1' && r35.cold === 6,
    `0.95: benzene's ring bonds ${r35.benz.lo}–${r35.benz.hi} Å, naphthalene ${r35.naph} aromatic bonds; an H atom adds across benzene over a ${r35.EaBenz[0]} eV barrier releasing ${-r35.EaBenz[1]} eV (ethylene: ${r35.EaEth[0]} eV, ${-r35.EaEth[1]} eV); CO is C≡O, C=O made in a fire closes up, and air at 300 K leaves CO alone`, '0.95: ' + JSON.stringify(r35));
  // 0.95: in a periodic box a trail that crosses an edge leaves through it and comes back through the opposite one,
  // instead of a line straight across the box
  const r36 = await page.evaluate(() => {
    loadPreset('empty'); setRunning(false); W.wall = 'wrap'; R.view.tracks = true;
    const hw = W.box.w / 2, now = W.t;
    W.tracks.length = 0; W.tracks.push({ pts: [hw - 3, 0, hw - 1, 0.5, -hw + 1, 1, -hw + 3, 1.5], c: [255, 110, 100], w: 1.6, ts: [W.rt, W.rt, W.rt, W.rt], tt: [now, now, now, now], upd: W.rt });
    const ctx = R.ctx, segs = []; let last = null; const mt = ctx.moveTo, lt = ctx.lineTo;
    ctx.moveTo = function (x, y) { last = [x, y]; return mt.call(this, x, y); };
    ctx.lineTo = function (x, y) { if (last) segs.push(Math.hypot(x - last[0], y - last[1])); last = [x, y]; return lt.call(this, x, y); };
    try { drawTracks(W.rt); } finally { ctx.moveTo = mt; ctx.lineTo = lt; }
    W.wall = 'reflect'; W.tracks.length = 0;
    return { n: segs.length, longest: +Math.max(...segs).toFixed(1), box: +(W.box.w * R.s).toFixed(1) };
  });
  check(r36.n >= 3 && r36.longest < 0.2 * r36.box, `0.95: a trail across a periodic edge is drawn in ${r36.n} short pieces (longest ${r36.longest} px of a ${r36.box} px box)`, '0.95 wrap trail: ' + JSON.stringify(r36));
  // 0.96: the pictures' clock (electrons circling in the particle view, quarks, chip carriers) runs with the simulation:
  // slow motion slows it, a pause stops it (it ran on real time)
  const r37 = await page.evaluate(() => {
    loadPreset('water'); setRunning(false); const base = W.baseSpf || W.simPerFrame, adv = (n) => { const a0 = W.at; for (let f = 0; f < n; f++) simFrame(1 / 60, 25); return W.at - a0; };
    W.simPerFrame = base; const one = adv(60); W.simPerFrame = base / 8; const slow = adv(60); W.simPerFrame = base;
    return { one: +one.toFixed(3), slow: +slow.toFixed(4), ratio: +(one / slow).toFixed(2) };
  });
  check(r37.one > 0.9 && r37.one < 1.1 && r37.ratio > 7 && r37.ratio < 9, `0.96: electrons in the particle view turn ${r37.ratio}× slower at 1/8× (one second of pictures' time at 1×: ${r37.one} s)`, '0.96 picture clock: ' + JSON.stringify(r37));
  // 1.01: a right-click on a palette chip (or an item of its menus) opens a card about it
  const r38 = await page.evaluate(() => {
    loadPreset('water'); setRunning(false); const out = {};
    const card = (el) => { const q = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: q.x + 5, clientY: q.y + 5 })); const m = $('qmenu'), t = m.hidden ? '' : m.innerText; closeQuickMenu(); return t; };
    const chips = [...document.querySelectorAll('#palette .chip[data-i]')], by = (t) => chips.find(b => b.textContent.trim() === t);
    out.e = /Electron[\s\S]*−1 e[\s\S]*0\.511/.test(card(by('e⁻')));
    out.u = /Uranium-238[\s\S]*92 protons, 146 neutrons[\s\S]*4\.47 billion years/.test(card(by('U')));
    out.w = /Water[\s\S]*18\.0\d g\/mol[\s\S]*Remove all of these in the box \(80\)/.test(card(by('H₂O')));
    document.querySelectorAll('#palette .cat')[1].click(); const it = document.querySelector('#pmenu .pm-i:not(.more)'); out.menu = it ? card(it).split('\n')[0] : ''; pmenuClose();
    const exo = specAbout({ kind: 'exo', sp: 'phi' }); out.phi = exo.rows.map(r => r.join(': ')).join('; ');
    return out;
  });
  check(r38.e && r38.u && r38.w && r38.menu.length > 1 && /Quarks: s s̄/.test(r38.phi) && /K⁺ \+ K⁻ \(49%\)/.test(r38.phi),
    `1.01: right-click cards for the palette (electron, ²³⁸U, water, a menu item: "${r38.menu}"; φ: ${r38.phi.slice(0, 90)}…)`, '1.01 cards: ' + JSON.stringify(r38));
  // 1.02: detector screens record where hits land; their bars and the Data tab's graph show it
  const r39 = await page.evaluate(() => {
    loadPreset('rutherford'); setRunning(false); for (let f = 0; f < 240; f++) simFrame(1 / 60, 25);
    const ob = W.objs.find(o => o.kind === 'screen'), H = ob.hits, sum = (a) => a.reduce((x, y) => x + y, 0);
    const mid = H.posP.slice(15, 25).reduce((x, y) => x + y, 0), edge = sum(H.posP.slice(0, 5)) + sum(H.posP.slice(35));
    showTab('data', true); drawDet(); const vis = !$('dDetSec').hidden, note = $('detNote').textContent; showTab('lab', true);
    const back = objFromJSON(JSON.parse(JSON.stringify(objToJSON(ob))));
    loadPreset('water'); drawDet();
    return { n: H.n, pos: sum(H.posP) + sum(H.posL), mid, edge, vis, note, view: back.view, hidden: $('dDetSec').hidden };
  });
  check(r39.n > 100 && r39.pos === r39.n && r39.mid > 3 * r39.edge && r39.vis && /hits/.test(r39.note) && r39.view === 'where' && r39.hidden,
    `1.02: the gold foil's far screen records where its ${r39.n} hits land (${r39.mid} in its middle quarter, ${r39.edge} in its outer quarters); Data tab graph shown, kept in saves`, '1.02 detector: ' + JSON.stringify(r39));
  // 1.02: the walls keep the charge they take in (positrons annihilating in them, charged particles leaving an open box)
  const r40 = await page.evaluate(() => {
    loadPreset('empty'); setRunning(false); W.T = 300;
    for (let i = 0; i < 5; i++) { const p = spawnSpec({ kind: 'pos' }, -10 + 5 * i, 0); p.vx = 0; p.vy = 40; }
    const q0 = boxCharge(); for (let f = 0; f < 200; f++) simFrame(1 / 60, 25);
    const q1 = boxCharge(), wall = W.ledger.qWall; showTab('data', true); renderData(); const txt = $('dCharge').innerText; showTab('lab', true);
    W.wall = 'open'; for (let i = 0; i < 3; i++) { const e = spawnSpec({ kind: 'e' }, 0, 5 * i); e.vx = 60; e.vy = 0; }
    for (let f = 0; f < 200; f++) simFrame(1 / 60, 25);
    return { q0, q1, wall, out: W.ledger.qOut, box: boxCharge(), txt: txt.replace(/\s+/g, ' ') };
  });
  check(r40.q0 === 5 && r40.q1 === 0 && r40.wall === 5 && r40.out === -3 && r40.box === 0 && /All together\s*\+5 e/.test(r40.txt),
    `1.02: 5 positrons annihilate in the walls (box +5 → ${r40.q1} e, walls +${r40.wall} e); 3 electrons out of an open box (${r40.out} e); Data → Charge: "${r40.txt.slice(0, 80)}"`, '1.02 wall charge: ' + JSON.stringify(r40));
  // 1.03: the ultra-realistic mode: true nuclear sizes, real decay rates, zoom to nuclei, slow motion to 1 ys a second
  const r41 = await page.evaluate(() => {
    const out = {};
    loadPreset('useries'); out.warp0 = W.warp; setSetting('ultra', true); out.warpU = W.warp; out.badge = !$('ultraBadge').hidden;
    loadPreset('empty'); setRunning(false);
    const one = (q) => Array.isArray(q) ? q[0] : q, U = addAtom('U', 0, 0, { A: 235 }), n = one(spawnSpec({ kind: 'n' }, 5, 0)), a = one(spawnSpec({ kind: 'atom', Z: 2, A: 4, bare: true }, -5, 0));
    n.vx = Math.sqrt(2 * 0.025 / n.m); n.vy = 0; out.rTherm = nucReach(n, U);
    n.vx = Math.sqrt(2 * 2e6 / n.m); out.rFast = nucReach(n, U);
    a.vx = Math.sqrt(2 * 5e6 / a.m); a.vy = 0; out.rAlpha = nucReach(a, U);
    out.sigDT = gamowP({ m: 2.014, Z: 1, N: 1 }, { m: 3.016, Z: 1, N: 2 }, 64e3).sig;
    for (let i = 0; i < 25; i++) stepSpeed(-1); out.spd = $('speedRate').textContent; out.slowestOff = $('bSlower').disabled;
    for (let i = 0; i < 20; i++) fireSpec({ kind: 'exo', sp: 'phi' }, -20 + 2 * i, 8, 1, 0, 1e6);
    const live = () => W.exo.filter(o => !o.dead && o.sp === 'phi').length, t0 = W.t;
    for (let f = 0; f < 1500; f++) simFrame(1 / 60, 25);
    out.phiLeft = live(); out.simS = (W.t - t0) * PHYS.TU_S;
    R.cx = U.x; R.cy = U.y; zoomAt(R.w / 2, R.h / 2, 1e9); out.zoom = R.s; render(W.rt); out.gl = R.gl;
    setSetting('ultra', false); out.zoomOff = R.s; out.spdOff = $('speedVal').textContent; loadPreset('useries'); out.warpBack = W.warp;
    return out;
  });
  check(r41.warpU === 1 && r41.warp0 > 1e20 && r41.warpBack === r41.warp0 && r41.badge && r41.rTherm > 0.2 && r41.rTherm < 0.4 && r41.rFast < 2e-4 && r41.rAlpha > 5e-5 && r41.rAlpha < 2e-4
    && r41.sigDT > 3 && r41.sigDT < 7 && r41.spd === '1 ys/s' && r41.slowestOff && r41.phiLeft >= 10 && r41.simS > 2e-23 && r41.simS < 3e-23
    && r41.zoom === 4e8 && r41.gl === false && r41.zoomOff === 4000,
    `1.03: ultra-realistic mode: decay ×${r41.warp0.toExponential(0)} → real; reach for a thermal neutron ${r41.rTherm.toFixed(2)} Å, a 2 MeV one ${r41.rFast.toExponential(1)} Å, a 5 MeV α ${r41.rAlpha.toExponential(1)} Å; σ(D–T, 64 keV) ${r41.sigDT.toFixed(1)} b; at ${r41.spd}, ${r41.phiLeft} of 20 φ left after ${r41.simS.toExponential(1)} s; zoom to ${r41.zoom.toExponential(0)} px/Å`, '1.03 ultra: ' + JSON.stringify(r41));
  // 1.04: the extreme slow motion in the normal mode too: down to 1 ys a second, where a φ meson lives its real life
  const r42 = await page.evaluate(() => {
    loadPreset('empty'); setRunning(false); const out = { ultra: !!W.ultra };
    for (let i = 0; i < 25; i++) stepSpeed(-1); out.spd = $('speedRate').textContent;
    for (let i = 0; i < 20; i++) fireSpec({ kind: 'exo', sp: 'phi' }, -20 + 2 * i, 8, 1, 0, 1e6);
    const live = () => W.exo.filter(o => !o.dead && o.sp === 'phi').length, t0 = W.t;
    for (let f = 0; f < 1500; f++) simFrame(1 / 60, 25);
    out.phiLeft = live(); out.simS = (W.t - t0) * PHYS.TU_S;
    for (let i = 0; i < 10; i++) stepSpeed(1); out.back = $('speedVal').textContent;
    W.simPerFrame = UI.baseSpf; for (let i = 0; i < 20; i++) fireSpec({ kind: 'exo', sp: 'phi' }, -20 + 2 * i, 8, 1, 0, 1e6);
    simFrame(1 / 60, 25); simFrame(1 / 60, 25); out.phiNormal = live();
    return out;
  });
  check(!r42.ultra && r42.spd === '1 ys/s' && r42.phiLeft >= 10 && r42.simS > 2e-23 && r42.simS < 3e-23 && /1\/512×/.test(r42.back) && r42.phiNormal === 0,
    `1.04: extreme slow motion without the ultra-realistic mode: at ${r42.spd}, ${r42.phiLeft} of 20 φ left after ${r42.simS.toExponential(1)} s; back up to ${r42.back}; at 1× they are gone at once (${r42.phiNormal} left)`, '1.04 slow: ' + JSON.stringify(r42));
  // 1.05: resonance: every Kekulé structure counted, each bond at its Pauling order (naphthalene 1⅔ and 1⅓)
  const r43 = await page.evaluate(() => {
    const out = {}, lens = (k) => { loadPreset('empty'); setRunning(false); W.T = 0; W.gamma = 0; addMolecule(k, 0, 0, 0, 0); forcesNoEvents(); W.fSpawn = W.spawned; for (let i = 0; i < 300; i++) { W.dt = chooseDt(); step(W.dt); } const g = {}; for (const b of W.bonds.filter(b => b.arom)) { const k2 = b.fo.toFixed(2); (g[k2] = g[k2] || []).push(Math.hypot(b.a.x - b.b.x, b.a.y - b.b.y)); } for (const k2 in g) g[k2] = +(g[k2].reduce((s, v) => s + v, 0) / g[k2].length).toFixed(3); return { g, RE: Math.round((W.bonds.find(b => b.arom) || {}).reSys * PHYS.KJMOL) }; };
    out.naph = lens('naphthalene'); out.anth = lens('anthracene'); out.benz = lens('benzene'); out.buta = lens('butadiene');
    return out;
  });
  const n43 = r43.naph.g;
  check(n43['1.67'] > 1.36 && n43['1.67'] < 1.40 && n43['1.33'] > 1.41 && n43['1.33'] < 1.46 && r43.naph.RE === 238 && r43.anth.RE === 300 && r43.benz.g['1.50'] > 1.38 && r43.benz.g['1.50'] < 1.42 && r43.benz.RE === 150 && !Object.keys(r43.buta.g).length,
    `1.05: resonance: naphthalene's bonds ${n43['1.67']} Å at order 1⅔ and ${n43['1.33']} Å at 1⅓ (measured 1.37, 1.42), ${r43.naph.RE} kJ/mol; anthracene ${r43.anth.RE}; benzene ${r43.benz.g['1.50']} Å; butadiene left as it is`, '1.05 resonance: ' + JSON.stringify(r43));
  // 1.06: the ultra-realistic mode draws an atom's nucleus only at its true size: not at all at ordinary zoom (the Bohr
  // and orbital pictures drew one scaled with the atom), its nucleons from about 10⁶ px/Å
  const r44 = await page.evaluate(() => {
    const out = {}, nb0 = nucleusBeads, un0 = ultraNucleus; let n = 0;
    nucleusBeads = function (...a) { n++; return nb0.apply(this, a); }; ultraNucleus = function (...a) { n++; return un0.apply(this, a); };
    try {
      setSetting('ultra', true); loadPreset('water'); setRunning(false); const p = W.parts.find(q => q.Z === 8); R.cx = p.x; R.cy = p.y;
      for (const [v, s] of [['auto', 120], ['on', 120], ['orb', 120], ['auto', 3e6]]) { R.view.bohr = v; R.s = s; n = 0; render(W.rt); out[v + s] = n; }
    } finally { nucleusBeads = nb0; ultraNucleus = un0; R.view.bohr = 'auto'; setSetting('ultra', false); }
    return out;
  });
  check(r44.auto120 === 0 && r44.on120 === 0 && r44.orb120 === 0 && r44.auto3000000 >= 1,
    `1.06: ultra-realistic nuclei at their true size only (nuclei drawn at 120 px/Å: ${r44.auto120}, ${r44.on120}, ${r44.orb120}; at 3×10⁶: ${r44.auto3000000})`, '1.06 true nuclei: ' + JSON.stringify(r44));
  // 1.07: Settings → Experimental: the longest step and resonance in large ring systems; cost tags beside the settings
  const r45 = await page.evaluate(() => {
    const out = {};
    openSettings('exp'); out.tags = document.querySelectorAll('#setModal .cost, #setModal .oc').length; out.dtTag = $('segDtMax').closest('.srow').querySelector('.cost-k').textContent;
    setSetting('dtMax', 0.01); out.dt = DT_MAX; loadPreset('water'); setRunning(false); forcesNoEvents(); out.step = chooseDt(); setSetting('dtMax', 0.04); out.dtBack = DT_MAX;
    out.dtTag2 = $('segDtMax').querySelector('[data-v="0.01"] .oc').className; hideModal('setModal');
    const flake = (big) => { setSetting('resBig', big); const L = designLattice({ lattice: 'honeycomb', elements: ['C'], size: 6 }); myMolAdd({ k: 'tflake', n: 'tflake', r: 0, a: L.atoms, b: L.bonds, d: '', c: 'objects' });
      loadPreset('empty'); setRunning(false); addMolecule('tflake', 0, 0, 0, 0); const fo = new Set(W.bonds.filter(b => b.arom).map(b => b.fo.toFixed(2))); delete MOLECULES.tflake; return [...fo].sort().join(' '); };
    out.rule = flake(false); out.det = flake(true); setSetting('resBig', false);
    return out;
  });
  check(r45.tags >= 10 && /c3/.test(r45.dtTag2) && r45.dtTag === 'physics' && r45.dt === 0.01 && r45.step <= 0.01 + 1e-12 && r45.dtBack === 0.04 && r45.rule === '1.50' && r45.det.split(' ').length >= 5,
    `1.07: Experimental settings: ${r45.tags} cost tags; longest step 0.1 fs applied (a step of ${r45.step} tu) and back; a 54-carbon graphene flake's bonds ${r45.rule} by the six-ring rule, ${r45.det} worked out`, '1.07 experimental: ' + JSON.stringify(r45));
  // 1.08: Experimental: the intranuclear cascade; energy, charge and nucleons kept exactly; about 15 neutrons from 1 GeV p + Pb
  const r46 = await page.evaluate(() => {
    const out = { worst: 0, bad: 0, n: 0, ev: 0, inc: 0 }; setSetting('inc', true);
    const E = () => totalEnergy().total - W.ledger.nuc, QB = () => { let q = 0, b = 0; for (const p of W.parts) if (!p.dead) { if (p.k === NUC) { q += p.Z - p.ne; b += p.Z + p.N; } else q += p.k === ELEC ? -1 : p.k === POS ? 1 : 0; } for (const o of W.exo) if (!o.dead) { q += o.q; } return q + ',' + b; };
    for (let t = 0; t < 30; t++) {
      loadPreset('empty'); setRunning(false); W.decayOn = false; W.box.w = W.box.h = 400; const T = addAtom('Pb', 0, 0, { A: 208, bare: true, T: 0 }), p = addNuc(1, 0, 0, -3, 0, 0, 0, false); setMotion(p, 1e9, 1, 0); forcesNoEvents();
      const n0 = W.parts.filter(q => !q.dead && q.Z === 0).length, e0 = E(), qb0 = QB(); _incLast = null;
      const r = nuclearEncounter(p, T, 0.3 * rnd(), 0, 0);
      if (!r || /elastic/.test(r)) continue; out.ev++; if (_incLast) out.inc++; // (a third of the touching passes at this energy are diffraction: nuclear elastic scattering)
      out.worst = Math.max(out.worst, Math.abs(E() - e0)); if (QB() !== qb0) out.bad++;
      out.n += W.parts.filter(q => !q.dead && q.k === NUC && q.Z === 0 && q.N === 1).length - n0;
    }
    setSetting('inc', false); out.nPer = +(out.n / out.ev).toFixed(1);
    return out;
  });
  check(r46.ev >= 10 && r46.inc === r46.ev && r46.worst < 1e-2 && !r46.bad && r46.nPer > 8 && r46.nPer < 25,
    `1.08: the intranuclear cascade: ${r46.ev} hits of 1 GeV protons on ²⁰⁸Pb, ${r46.nPer} neutrons a hit (measured about 17), energy kept to ${r46.worst.toExponential(1)} eV, charge and nucleons exactly`, '1.08 cascade: ' + JSON.stringify(r46));
  // 1.09: an atom the wall stops (a recoiling fragment) or brings back (a slow one deep past it) is set down clear of an
  // atom already there; set down 0.1 Å from it, the capped contact force threw both out with MeV from nowhere (the
  // insulated chain reaction gained 212 MeV)
  const r47 = await page.evaluate(() => {
    const out = {};
    for (const rescue of [false, true]) {
      loadPreset('empty'); setRunning(false); baseWorld(40, 28, 300, 0); W.slowmo = false;
      const hw = W.box.w / 2, hh = W.box.h / 2; let a, b;
      if (!rescue) { a = addAtom('U', hw - 0.6, hh - 0.6); b = addAtom('Pa', hw - 4, 3); setMotion(b, 1e6, 0.2, 0.98); }
      else { a = addAtom('U', 5, hh - wallIn(addAtom('U', -15, 0))); b = addAtom('Pa', 5.1, hh + 2.5); }
      forcesNoEvents(); W.fSpawn = W.spawned;
      if (!rescue) { b.ox = hw - 4; b.oy = 3; b.x = hw - 0.5; b.y = hh + 2; }
      const tot = () => totalEnergy().total - W.ledger.nuc, E0 = tot();
      if (!rescue) wallOrEscape(b, true, hw - 4, 3); else walls(b);
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      for (let i = 0; i < 100; i++) step(0.01);
      out[rescue ? 'rescue' : 'stop'] = { d: +d.toFixed(2), dE: +(tot() - E0).toFixed(1) };
    }
    return out;
  });
  check(r47.stop.d > 1 && r47.rescue.d > 1 && Math.abs(r47.stop.dE) < 5 && Math.abs(r47.rescue.dE) < 5,
    `1.09: atoms the wall stops or brings back are set down clear (${r47.stop.d}, ${r47.rescue.d} Å from the atom there), energy kept (${r47.stop.dE}, ${r47.rescue.dE} eV)`, '1.09 wall overlap: ' + JSON.stringify(r47));
  // 1.09: an iron atom crossing its Curie point at a magnet's pole pays its change of magnetic energy from its motion
  // (it was made or lost: the insulated magnet setup drifted 38–52 eV in 3,000 frames)
  const r48 = await page.evaluate(() => {
    loadPreset('empty'); setRunning(false); baseWorld(40, 28, 300, 0); W.magnets.push({ x: 8, y: 0, R: 10, B: 5000 });
    const fe = addAtom('Fe', -2.2, 0); forcesNoEvents(); W.fSpawn = W.spawned;
    fe.vx = Math.sqrt(2 * PHYS.KB * 6000 / fe.m); fe.vy = 0; fe.tLocal = 1040;
    const U0 = magU(fe, PHYS.KB * 300), E0 = totalEnergy().total; localTemps();
    return { dU: +(magU(fe, PHYS.KB * 300) - U0).toFixed(3), dE: +(totalEnergy().total - E0).toFixed(4), T: Math.round(fe.tLocal) };
  });
  check(Math.abs(r48.dU) > 0.3 && Math.abs(r48.dE) < 1e-6,
    `1.09: iron crossing its Curie point at the pole (local ${r48.T} K): magnetic energy ${r48.dU} eV, paid exactly (${r48.dE} eV)`, '1.09 Curie: ' + JSON.stringify(r48));
  // 1.09: a bond tried in a chip is costed over its neighbourhood, not the whole chip, also though removing it renumbers
  // the chip (every try "missed" and summed all 985 atoms twice: a melted chip crawled)
  const r49 = await page.evaluate(() => {
    loadPreset('seu'); setRunning(false); forcesNoEvents(); W.fSpawn = W.spawned;
    const big = W.parts.find(p => p.bonds.length >= 3 && molecule(p).length > 500), set = setOf(molecule(big)), miss0 = _localMiss;
    let worst = 0, n = 0;
    for (const bd of W.bonds.filter(b => set.has(b.a)).slice(0, 40)) {
      const a = bd.a, b = bd.b, o = bd.order, c = breakCost(bd, set);
      const nb = addBond(a, b, o), P0 = localPE(set); removeBond(nb); worst = Math.max(worst, Math.abs(c - (localPE(set) - P0))); addBond(a, b, o); n++;
    }
    return { size: set.size, n, miss: _localMiss - miss0, worst };
  });
  check(r49.n === 40 && r49.miss === 0 && r49.worst < 1e-6,
    `1.09: ${r49.n} bond tries in a ${r49.size}-atom chip costed locally (${r49.miss} whole-chip sums, exact to ${r49.worst.toExponential(0)} eV)`, '1.09 chip: ' + JSON.stringify(r49));
  // 1.10: the speed menu: every speed on one ladder (halvings to 1/512×, then decades of simulated time a second), chosen
  // from a menu under the readout
  const r60 = await page.evaluate(() => {
    loadPreset('water'); setRunning(false); const out = {};
    openSpeedMenu(); const items = [...document.querySelectorAll('#speedMenu .spm-i')]; out.n = items.length; out.open = !$('speedMenu').hidden;
    const fs = items.find(b => /^1 fs\/s$/.test(b.querySelector('.r').textContent)); out.fs = !!fs; if (fs) fs.click();
    out.closed = $('speedMenu').hidden; out.rate = $('speedRate').textContent; out.val = $('speedVal').textContent;
    stepSpeed(1); out.up = $('speedRate').textContent; setSpeed(UI.baseSpf); out.back = W.simPerFrame === UI.baseSpf && /1×$|^slow-mo$/.test($('speedVal').textContent);
    openSpeedMenu(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); out.esc = $('speedMenu').hidden; closeSpeedMenu();
    return out;
  });
  check(r60.n >= 20 && r60.open && r60.fs && r60.closed && r60.rate === '1 fs/s' && r60.up !== '1 fs/s' && r60.back && r60.esc,
    `1.10: speed menu: ${r60.n} speeds; 1 fs/s chosen from it (${r60.val}), a step up from there (${r60.up}), back to 1×, Escape closes it`, '1.10 speed menu: ' + JSON.stringify(r60));
  // 1.10: interface motion: a pill under each chosen button, slider tracks filled; off in Settings → Display
  const r61 = await page.evaluate(async () => {
    const out = {}; openSettings('perf'); await new Promise(r => setTimeout(r, 120));
    out.mo = document.body.classList.contains('mo'); out.pills = [...document.querySelectorAll('.mo-pill')].filter(p => p.offsetParent && p.style.opacity === '1').length;
    setSetting('motion', false); out.off = document.body.classList.contains('nomo') && !document.querySelector('.mo-pill');
    setSetting('motion', true); hideModal('setModal'); return out;
  });
  check(r61.mo && r61.pills >= 3 && r61.off, `1.10: interface motion: ${r61.pills} sliding pills in Settings; off removes them`, '1.10 motion: ' + JSON.stringify(r61));
  // 1.10: Experimental → Longer force reach: 9 Å on the JavaScript kernels, pairs out to 9 Å, energy kept insulated; back to
  // 6 Å on WebAssembly. Cost tags predict each choice's cost
  const r62 = await page.evaluate(() => {
    const out = {};
    const run = (rc) => {
      setSetting('rc', rc); loadPreset('water'); setRunning(false); W.gamma = 0; forcesNoEvents(); W.fSpawn = W.spawned;
      const E0 = totalEnergy().total; for (let i = 0; i < 300; i++) { if (W.fSpawn !== W.spawned) { forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = chooseDt(); step(W.dt); }
      let far = 0; for (let k = 0; k < VL.np; k++) { const i = VL.pi[k], j = VL.pj[k], dx = S.x[j] - S.x[i], dy = S.y[j] - S.y[i]; if (dx * dx + dy * dy > 72.25) far++; }
      return { rc: RC, wasm: wasmReady(), dE: +(totalEnergy().total - E0).toFixed(3), far };
    };
    out.r9 = run(9); out.r6 = run(6);
    openSettings('exp'); const oc = (id, v) => { const e = $(id).querySelector(`[data-v="${v}"] .oc`); return e ? e.textContent + ' ' + e.className : ''; };
    out.tags = [oc('segRc', 6), oc('segRc', 12), oc('segDtMax', 0.02)];
    const cb = $('setInc').closest('label').querySelector('.cost'); out.inc = cb ? cb.textContent + (cb.classList.contains('dim') ? ' dim' : '') : '';
    { const fb = document.querySelector('[data-find]'); pfindOpen(fb); const m = $('pmenu').getBoundingClientRect(), q = $('pfQ').getBoundingClientRect(); out.find = fb.textContent + ' ' + (m.right - q.right >= 6 && q.left - m.left >= 6); pmenuClose(); }
    out.kind = $('segRc').closest('.srow').querySelector('.cost-k').textContent; out.real = [...document.querySelectorAll('#setModal .rl')].map(e => e.parentElement.dataset.v).join(' '); out.realOn = document.querySelectorAll('#setModal .rlb').length; hideModal('setModal');
    return out;
  });
  check(r62.r9.rc === 9 && !r62.r9.wasm && r62.r9.far > 0 && Math.abs(r62.r9.dE) < 1 && r62.r6.rc === 6 && r62.r6.wasm && r62.r6.far === 0 &&
    /^×1 oc c0/.test(r62.tags[0]) && /c4/.test(r62.tags[1]) && /^×1\.7 oc c2/.test(r62.tags[2]) && r62.inc === 'on ×1–1.05 dim' && r62.kind === 'physics' && r62.real === "1 0.01 12 1 32 0 2 1 1 1 1 1 1 1" /* (1.26: GFN1, paired spins, lone pairs, σ-holes and π-stacking marked real too) */ && r62.find === 'Search… true' && r62.realOn === 10 /* (1.27 part 7: photon polarization; 1.27 part 3: charged particles in matter; 1.27 parts 5 and 6: resonance widths and heavy flavour, nuclear spin and γ lines; 1.27: exotic atoms' switch, realistic when on, beside resonance in large rings, detailed collisions and ultra-realistic; positronium and muonium as hydrogen, rp2) */,
    `1.10: force reach 9 Å: ${r62.r9.far} pairs past 8.5 Å, energy over 300 insulated steps ${r62.r9.dE} eV (6 Å: ${r62.r6.dE}); tags ${r62.tags.map(t => t.split(' ')[0]).join(', ')}, ${r62.inc}`, '1.10 reach: ' + JSON.stringify(r62));
  // 1.09: ionized water (liquid water, 40 molecules ionized, bath off) keeps its energy: the soft-cored Coulomb energy
  // between net charges inside the cutoff now meets the exact 1/r outside it (a step of 0.037 eV for e⁻ + O⁺ at each
  // crossing, 120–150 eV/ps of drift)
  const r50 = (() => { // (in the Node harness, seeded: the page's randomness is not, and one run in a few of this plasma runs away, as before)
    const out = [];
    for (const seed of [3, 5]) {
      const X = require('./load.js').load('all', { seed }), W = X.W;
      X.PRESETS.water.build(); X.settleOverlaps();
      const Os = W.parts.filter(p => p.Z === 8); for (let i = 0; i < 40; i++) X.userIonize(Os[i]);
      X.settleOverlaps(); W.gamma = 0; W.slowmo = false; W.sources.length = 0; X.forcesNoEvents(); W.fSpawn = W.spawned;
      const run = (n) => { let adv = 0; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); adv += X.step(W.dt); } return adv; };
      run(30);
      const tot = () => X.totalEnergy().total - W.ledger.nuc, E0 = tot(), fs = run(400) * X.PHYS.TU_S * 1e15, d = tot() - E0;
      out.push({ seed, fs: +fs.toFixed(1), drift: +d.toFixed(2), perPs: +(d / (fs / 1000)).toFixed(1), freeE: W.nE });
    }
    return out;
  })();
  check(r50.every(r => r.freeE >= 20 && Math.abs(r.perPs) < 30), `1.09: ionized water, bath off: ${r50.map(r => `${r.drift} eV over ${r.fs} fs (${r.perPs} eV/ps)`).join(', ')}`, '1.09 ionized water drift: ' + JSON.stringify(r50));
  // 1.11: the chain-reaction map's family tree (Node harness, seeded): a block of ²³⁵U, four slow neutrons; every fission
  // but those the fired neutrons set off has a parent, delayed and scattered neutrons included; steps on the chart
  // (seed 3: four neutrons in this block reach 30 fissions in about half the seeds; 1.26's ionization books changed the
  // last bits after the first fission and seed 5's chain stopped at 25: e237efe reached 30 with seeds 3 and 5, now 1, 2, 3)
  const r63 = (() => {
    const X = require('./load.js').load('all', { seed: 3 }), W = X.W;
    X.setMaxParts(4000); X.baseWorld(140, 100, 300, 0.05); W.warp = 1e13; W.slowmo = false;
    for (let i = 0; i < 26; i++) for (let j = 0; j < 22; j++) X.addAtom('U', -40 + i * 3.1 + (j % 2) * 1.55, -30 + j * 2.7, { A: 235 });
    X.settleOverlaps(); for (const u of W.parts.filter(p => p.Z === 92).slice(0, 4)) X.fireSpec({ kind: 'n' }, u.x - 6, u.y, 1, 0, 0.025, false);
    for (let f = 0; f < 6000 && (!W.chain || W.chain.nfis < 30); f++) { W.dt = X.chooseDt(); X.step(W.dt); }
    const F = W.chain ? W.chain.fis : [], modes = new Set([...(W.chain ? W.chain.edges.values() : [])].map(e => e.mode));
    let bad = 0, kids = 0; F.forEach((f, i) => { if (f.par >= i || (f.par >= 0 && f.d !== F[f.par].d + 1)) bad++; kids += f.kids; });
    return { n: F.length, roots: F.filter(f => f.par < 0).length, maxD: Math.max(0, ...F.map(f => f.d)), bad, kidsOk: kids === F.filter(f => f.par >= 0).length, modes: [...modes].sort().join(' ') };
  })();
  check(r63.n >= 30 && r63.roots <= 4 && r63.maxD >= 3 && r63.bad === 0 && r63.kidsOk && /fis/.test(r63.modes),
    `1.11: chain-reaction tree: ${r63.n} fissions from ${r63.roots} fired neutron(s), ${r63.maxD + 1} generations; steps seen: ${r63.modes}`, '1.11 tree: ' + JSON.stringify(r63));
  // 1.11: the Data tab: an ⓘ on every nuclide and element (it opens the card), the list opens past 80; the maps draw and
  // answer the pointer; scroll bars styled; the ultra-realistic nucleus in detail (β₂ from the valence nucleons)
  const r64 = await page.evaluate(async () => {
    const out = {}; loadPreset('empty'); setRunning(false); showTab('data');
    W.made = { nuc: new Map(), part: new Map() };
    for (let Z = 20; Z < 70; Z++) for (const dN of [0, 1]) { const N = Math.round(Z * 1.3) + dN; W.made.nuc.set(Z + '_' + N, { Z, N, anti: false, lab: nucSym(Z, N), n: 1, how: 'test', t: 0 }); }
    renderMade(); out.rows = document.querySelectorAll('#dMade tr:not(.elh):not(.more)').length; out.ibs = document.querySelectorAll('#dMade .ib').length;
    const more = document.querySelector('#dMade [data-more]'); out.more = more ? more.textContent : ''; if (more) more.click();
    out.all = document.querySelectorAll('#dMade tr:not(.elh):not(.more)').length; const fewer = document.querySelector('#dMade [data-more]'); out.fewer = fewer ? fewer.textContent : ''; if (fewer) fewer.click();
    document.querySelector('#dMade .ib').click(); out.card = !$('qmenu').hidden && $('qmenu').textContent.slice(0, 40); $('qmenu').hidden = true; QM.open = false;
    W.made = null; renderMade();
    W.chain = { fis: [], nfis: 7, edges: new Map(), ver: 1 };
    const f = (par, d) => ({ par, d, src: par < 0 ? 'n' : 'n', t: 1, Z: 92, N: 143, ZL: 36, NL: 56, ZH: 56, NH: 85, nu: 3, kids: 0, end: [0, 1, 1, 0] });
    W.chain.fis.push(f(-1, 0), f(0, 1), f(0, 1), f(1, 2), f(1, 2), f(2, 2), f(3, 3)); for (const x of W.chain.fis) if (x.par >= 0) W.chain.fis[x.par].kids++;
    W.chain.edges.set('56,85>57,84', { Z0: 56, N0: 85, Z1: 57, N1: 84, mode: 'b-', n: 3 }); W.chain.edges.set('92,144>36,56', { Z0: 92, N0: 144, Z1: 36, N1: 56, mode: 'fis', n: 1 });
    UI.mapView = 'tree'; UI.mapKey = ''; drawChainMap(); await new Promise(r => setTimeout(r, 50));
    const ink = () => { const c0 = $('chMap'), c = document.createElement('canvas'); c.width = c0.width; c.height = c0.height; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(c0, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let k = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) k++; return k; };
    out.sec = !$('dMapSec').hidden; out.treeInk = ink(); out.treeNote = $('dMapNote').textContent.slice(0, 40);
    const P = UI.mapPos, r = $('chMap').getBoundingClientRect(), ui = SET.ui || 1;
    mapHover({ clientX: r.left + P.fx(W.chain.fis[6].d) * ui, clientY: r.top + P.fy(6) * ui }); out.hover = $('dMapNote').textContent.slice(0, 26);
    UI.mapView = 'chart'; UI.mapKey = ''; UI.mapHov = null; drawChainMap(); out.chartInk = ink(); out.chartNote = /kinds of step/.test($('dMapNote').textContent);
    W.chain = null; drawChainMap(); out.hidden = $('dMapSec').hidden;
    out.sb = [...document.styleSheets].some(sh => { try { return [...sh.cssRules].some(r => /::-webkit-scrollbar-thumb/.test(r.selectorText || '')); } catch (e) { return false; } });
    out.beta = [nucDeform(92, 146), nucDeform(82, 126), nucDeform(62, 92), nucDeform(8, 8)].map(v => +v.toFixed(2));
    const L = nucLayout(92, 146, 3); let far = 0; for (let k = 0; k < 238; k++) far = Math.max(far, Math.hypot(L.px[k], L.py[k]));
    out.inside = +(far + 0.88).toFixed(2) <= +(1.2 * Math.cbrt(238)).toFixed(2) + 0.01; out.pCount = L.isP.filter(Boolean).length;
    setSetting('ultra', true); const p = addNuc(92, 146, 0, 0, 0); R.cx = 0; R.cy = 0; R.s = 230 / (trueRfm(p) * FM); render(W.rt); await new Promise(r => setTimeout(r, 100)); setSetting('ultra', false); out.drew = true;
    return out;
  });
  check(r64.rows === 80 && r64.ibs >= 100 && /Show all 100 nuclides/.test(r64.more) && r64.all === 100 && r64.fewer === 'Show fewer' && r64.card && r64.sec && r64.treeInk > 200 && /^7 fissions/.test(r64.treeNote) &&
    /^Fission 7, generation 4/.test(r64.hover) && r64.chartInk > 200 && r64.chartNote && r64.hidden && r64.sb && r64.beta[0] === 0.3 && r64.beta[1] === 0 && r64.beta[2] >= 0.25 && r64.beta[3] === 0 && r64.inside && r64.pCount === 92,
    `1.11: made list: ${r64.rows} rows with ${r64.ibs} ⓘ, "${r64.more}" opens all ${r64.all}; card "${r64.card}"; fission tree and decay chart drawn, pointer "${r64.hover}"; β₂ U-238, Pb-208, Sm-154, O-16: ${r64.beta.join(', ')}`, '1.11 data: ' + JSON.stringify(r64));
  // 1.12: Experimental → charges that respond to their surroundings (Node harness, seeded): energy kept insulated in
  // water and brine, molecules stay neutral, a field turns the dipole, a rejected trial keeps the induced charges, off
  // puts every molecule back
  const r65 = (() => {
    const out = {};
    const mk = (sc, every, n) => {
      const X = require('./load.js').load('all', { seed: 12 }), W = X.W;
      X.PRESETS[sc].build(); X.settleOverlaps(); W.gamma = 0; W.sources.length = 0; X.forcesNoEvents(); W.fSpawn = W.spawned; X.QEQ.every = every;
      const tot = () => X.totalEnergy().total - W.ledger.nuc, E0 = tot();
      for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
      const mols = new Map(); for (const p of W.parts) if (!p.dead && p.bonds.length) mols.set(p.mol, (mols.get(p.mol) || 0) + p.q + p.qp);
      let worstQ = 0; for (const q of mols.values()) worstQ = Math.max(worstQ, Math.abs(q - Math.round(q)));
      const qi = W.parts.filter(p => !p.dead && p.qi); return { X, W, dE: +(tot() - E0).toFixed(3), upd: X.QEQ.n, meanQi: +(qi.reduce((t, p) => t + Math.abs(p.qi), 0) / Math.max(1, qi.length)).toFixed(3), worstQ };
    };
    const a = mk('water', 1, 300); out.water = { dE: a.dE, upd: a.upd, meanQi: a.meanQi, worstQ: a.worstQ };
    // a rejected trial (snapshot, a bond broken, restored) leaves the induced charges as they were
    { const { X, W } = a, p = W.parts.find(q => !q.dead && q.Z === 8 && q.qi), set = new Set(X.molecule(p)), before = [...set].map(q => q.qp), sn = X.snapshot(set);
      X.removeBond(p.bonds[0]); X.restoreSnap(sn); out.trial = Math.max(...[...set].map((q, k) => Math.abs(q.qp - before[k]))); }
    // off: every molecule back to its own charges, the energy kept
    { const { X, W } = a, E0 = X.totalEnergy().total; X.qeqClear(); out.clear = { left: W.parts.filter(p => !p.dead && p.qi).length, dE: +(X.totalEnergy().total - E0).toFixed(4) }; }
    const b = mk('brine', 10, 150); out.brine = { dE: b.dE, upd: b.upd, meanQi: b.meanQi, worstQ: b.worstQ };
    // one water molecule in a field of 0.1 V/Å: its dipole turns along the field
    { const X = require('./load.js').load('all', { seed: 3 }), W = X.W; X.baseWorld(40, 40, 300, 0); X.addMolecule('H2O', 0, 0, 0, 300); X.forcesNoEvents();
      const A = W.parts.filter(p => !p.dead && p.k === X.NUC); for (const p of A) { p.vx = 0.1; p.vy = -0.1 * (p.Z === 8 ? 0.2 : 1); }
      const dip = () => A.reduce((t, p) => t + p.qp * p.x, 0), d0 = dip(); W.Ex = 0.1; X.qeqUpdate(); out.field = { dmu: +(dip() - d0).toFixed(4), sum: +A.reduce((t, p) => t + p.qp, 0).toFixed(12) }; }
    return out;
  })();
  check(Math.abs(r65.water.dE) < 0.5 && r65.water.upd >= 250 && r65.water.meanQi > 0.02 && r65.water.worstQ < 1e-9 && r65.trial < 1e-12 && r65.clear.left === 0 && Math.abs(r65.clear.dE) < 1e-6 &&
    Math.abs(r65.brine.dE) < 1 && r65.brine.upd >= 10 && r65.brine.worstQ < 1e-9 && r65.field.dmu > 0.003 && r65.field.sum === 0,
    `1.12: induced charges: water ${r65.water.dE} eV over 300 insulated steps (mean |qi| ${r65.water.meanQi} e), brine ${r65.brine.dE} eV; molecules neutral; a field of 0.1 V/Å adds ${r65.field.dmu} e·Å; a rejected trial and turning it off keep the books`, '1.12 induced charges: ' + JSON.stringify(r65));
  // 1.12: Experimental → quantum nuclei (Node harness, seeded): H₂ spreads as its zero-point motion says; a reactive
  // flame keeps its energy books with rings; turning the rings off gives their energy to the bath exactly
  const r66 = (() => {
    const out = {};
    const h2 = (P) => {
      const X = require('./load.js').load('all', { seed: 5 }), W = X.W;
      X.baseWorld(30, 30, 300, 0.05); W.wall = 'wrap'; X.addMolecule('H2', 0, 0, 0, 300); X.forcesNoEvents(); W.fSpawn = W.spawned; if (P) X.piSet(P);
      const A = W.parts.filter(p => !p.dead && p.k === X.NUC), rs = [];
      for (let s = 0; s < 2500; s++) { W.dt = X.chooseDt(); X.step(W.dt); if (s > 400) { const c = X.PI.cap, n = P || 1; for (let k = 0; k < n; k++) { const ox = (q) => P ? X.PI.ox[k * c + q.i] : 0, oy = (q) => P ? X.PI.oy[k * c + q.i] : 0; rs.push(Math.hypot(A[1].x + ox(A[1]) - A[0].x - ox(A[0]), A[1].y + oy(A[1]) - A[0].y - oy(A[0]))); } } }
      const m = rs.reduce((t, r) => t + r, 0) / rs.length; return { mean: +m.toFixed(4), width: +Math.sqrt(rs.reduce((t, r) => t + (r - m) ** 2, 0) / rs.length).toFixed(4) };
    };
    out.classic = h2(0); out.quantum = h2(16);
    { const X = require('./load.js').load('all', { seed: 1 }), W = X.W;
      X.PRESETS.flame.build(); X.settleOverlaps(); W.slowmo = false; W.gamma = 0; W.decayOn = false; X.forcesNoEvents(); W.fSpawn = W.spawned; X.piSet(8);
      W.dt = X.chooseDt(); X.step(W.dt);
      const tot = () => X.totalEnergy().total - W.ledger.nuc + W.ledger.bath, E0 = tot(), x0 = W.count.xfer;
      for (let f = 0; f < 40; f++) X.simFrame(1 / 60, 1e9);
      out.flame = { dE: +(tot() - E0).toFixed(3), xfer: W.count.xfer - x0 };
      const e1 = tot(); X.piSet(0); out.off = +(tot() - e1).toFixed(6); }
    return out;
  })();
  check(r66.classic.width < 0.05 && r66.quantum.width > 0.075 && r66.quantum.mean > r66.classic.mean + 0.01 && Math.abs(r66.flame.dE) < 0.5 && r66.flame.xfer > 20 && Math.abs(r66.off) < 1e-6,
    `1.12: quantum nuclei: H₂ at 300 K ${r66.classic.width} → ${r66.quantum.width} Å wide, ${r66.classic.mean} → ${r66.quantum.mean} Å long (16 beads); a flame with rings ${r66.flame.dE} eV over ${r66.flame.xfer} electron transfers; turning them off ${r66.off} eV`, '1.12 quantum nuclei: ' + JSON.stringify(r66));
  // 1.13: continuous bond orders (Experimental): forces are the energy's slope, energy kept, switching it booked exactly
  const r68 = (() => {
    const X = require('./load.js').load('all', { seed: 3 }), W = X.W, S = X.S, out = {};
    X.PRESETS.combustion.build(); X.settleOverlaps(); W.fSpawn = W.spawned; X.forcesNoEvents(); W.gamma = 0;
    const tot = () => X.totalEnergy().total - W.ledger.nuc + W.ledger.bath;
    const e0 = tot(), nb = W.bonds.length; X.boSet(true); out.on = { dE: +(tot() - e0).toFixed(6), bonds: nb + '→' + W.bonds.length, members: W.parts.filter(p => p.bom).length };
    X.step(0.01); const E0 = tot(); for (let s = 0; s < 1500; s++) X.step(0.01); out.drift = +(tot() - E0).toFixed(4);
    // forces against the energy's slope
    X.forcesNoEvents(); const M = W.parts.filter(p => p.bom && !p.dead).slice(0, 30), f = M.map(p => [S.fx[p.i], S.fy[p.i]]);
    const PE = () => { X.gridTouch(); const t = X.totalEnergy(); return t.pe + t.internal; }; let worst = 0;
    M.forEach((p, k) => { for (const ax of [0, 1]) { const key = ax ? 'y' : 'x', v = p[key]; p[key] = v + 1e-6; const a = PE(); p[key] = v - 1e-6; const b = PE(); p[key] = v; worst = Math.max(worst, Math.abs(-(a - b) / 2e-6 - f[k][ax])); } });
    out.force = +worst.toExponential(1);
    const ords = X.boBonds().filter(b => b[2] > 0.5).map(b => b[2]); out.orders = [+Math.min(...ords).toFixed(2), +Math.max(...ords).toFixed(2)];
    { const h = W.parts.find(p => p.bom && p.Z === 1), o = W.parts.find(p => p.bom && p.Z === 8); out.names = [X.speciesLabel(h), X.moleculeName(X.molecule(h)), X.speciesLabel(o), X.moleculeName(X.molecule(o))]; } // (1.14: named as molecules)
    const e1 = tot(); X.boSet(false); out.off = { dE: +(tot() - e1).toFixed(6), bonds: W.bonds.length, members: W.parts.filter(p => p.bom).length };
    return out;
  })();
  check(Math.abs(r68.on.dE) < 1e-6 && r68.on.members === 140 && Math.abs(r68.drift) < 0.1 && r68.force < 1e-3 && r68.orders[0] > 0.9 && r68.orders[1] < 2.1 && Math.abs(r68.off.dE) < 1e-6 && r68.off.bonds === 70 && r68.off.members === 0 && r68.names.join() === 'H₂,Hydrogen,O₂,Oxygen',
    `1.13: continuous bond orders: H₂ + O₂ switched on (${r68.on.bonds} stored bonds) and off exactly, ${r68.drift} eV over 1,500 insulated steps, forces = −slope within ${r68.force} eV/Å, orders ${r68.orders.join('–')}`, '1.13 bond orders: ' + JSON.stringify(r68));
  // 1.13: every select opens the page's own list (rounded, animated); keys choose; the beam search suggests in the same list
  const r72 = await (async () => {
    const o = {};
    o.all = await page.evaluate(() => { ddSync(); const ss = [...document.querySelectorAll('select')]; return ss.length > 5 && ss.every(s => s._dd && s._dd.isConnected); });
    await page.evaluate(() => { loadPreset('soup'); syncPresetSelect(); ddSync(); });
    await page.click('#presetDD'); await page.waitForTimeout(200);
    o.open = await page.evaluate(() => !!DD.open && getComputedStyle(DD.open.pop).borderTopLeftRadius);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    o.picked = await page.evaluate(() => [UI.preset, $('presetDD').textContent === $('preset').selectedOptions[0].textContent, !!DD.open, $('escModal').hidden]);
    await page.evaluate(() => { loadPreset('ring'); syncPresetSelect(); showTab('lab'); }); await page.waitForTimeout(300);
    await page.fill('#cFindA', 'urani'); await page.waitForTimeout(200);
    o.sugg = await page.evaluate(() => DD.open ? DD.open.items.map(i => i.t).join('|') : '');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    o.beam = await page.evaluate(() => $('cBeamA').value);
    return o;
  })();
  check(r72.all && r72.open === '12px' && r72.picked[0] !== 'soup' && r72.picked[1] && !r72.picked[2] && r72.picked[3] && /Uranium/.test(r72.sugg) && r72.beam === 'Z92',
    `1.13: dropdowns: every select has the page's list (12 px corners), arrow + Enter chose ${r72.picked[0]}, the beam search suggested ${r72.sugg.split('|').length} and took ${r72.beam}`, '1.13 dropdowns: ' + JSON.stringify(r72));
  // 1.14: the Speed test names the Experimental settings; slow motion is a speed from the menu (the hourglass sets it and
  // gives it back; the automatic kind sets one and goes back by itself; a speed chosen by hand ends it)
  const r73 = await page.evaluate(async () => {
    const w = (ms) => new Promise(r => setTimeout(r, ms)), o = {};
    o.exp0 = expSummary(); SET.rc = 9; SET.bo = 1; o.exp1 = expSummary(); SET.rc = 6; SET.bo = 0;
    loadPreset('chain'); setRunning(true); await w(400);
    toggleSlowmo(); await w(500);
    o.hold = [$('speedVal').textContent, speedLadder().includes(W.simPerFrame), W.simPerFrame < W.baseSpf];
    toggleSlowmo(); await w(150); o.back = [$('speedVal').textContent, W.simPerFrame === W.baseSpf];
    const sm = W.slowmo; W.slowmo = true; // (slow motion for nuclear events: an earlier check may have turned it off)
    loadPreset('empty'); setRunning(true); await w(100);
    W.slow = { t0: W.rt, on: true, fresh: false, f: 1 }; fireSpec(isoSpec(2, 4, 0), 0, 0, 1, 0, 5e5, false); await w(300);
    o.auto = [$('speedVal').textContent, speedLadder().includes(W.simPerFrame), W.simPerFrame < W.baseSpf, $('bSlowmo').classList.contains('auto')];
    const sAuto = W.simPerFrame; stepSpeed(1); await w(150); o.hand = [W.simPerFrame > sAuto && speedLadder().includes(W.simPerFrame), !W.slowSet, !W.slow, $('speedVal').textContent];
    setSpeed(W.baseSpf); setRunning(false); W.slowmo = sm;
    return o;
  });
  check(r73.exp0 === 'Experimental: all normal' && /force reach 9 Å, continuous bond orders \(×/.test(r73.exp1) && r73.hold[1] && r73.hold[2] && /^1\/.+×$/.test(r73.hold[0]) && r73.back[1] && r73.back[0] === '1×' &&
    r73.auto[1] && r73.auto[2] && r73.auto[3] && r73.hand.slice(0, 3).every(Boolean) && /×$/.test(r73.hand[3]),
    `1.14: Speed test line "${r73.exp1}"; slow motion: the hourglass set ${r73.hold[0]} and gave back ${r73.back[0]}, an event set ${r73.auto[0]}, a speed chosen by hand (${r73.hand[3]}) ended it`, '1.14: ' + JSON.stringify(r73));
  // 1.15: charged unstable particles are turned by the nuclei they pass (multiple Coulomb scattering), ∝ 1/pv
  const r74 = (() => {
    const out = {};
    for (const KE of [5e6, 50e6]) {
      const X = require('./load.js').load('all', { seed: 9 }), W = X.W;
      X.baseWorld(120, 80, 300, 0); W.wall = 'open'; W.decayOn = false;
      for (let i = 0; i < 12; i++) for (let j = 0; j < 30; j++) X.addAtom('Au', -15 + i * 2.6 + (j % 2) * 1.3 + 0.8 * (X.rnd() - 0.5), -38 + j * 2.6 + 0.8 * (X.rnd() - 0.5)); // (jumbled, as in a foil: μ⁺ fired along a crystal's rows channels between them, since 1.15's sign fix)
      X.forcesNoEvents(); W.fSpawn = W.spawned;
      const os = []; for (let k = 0; k < 200; k++) os.push(X.addExo('mu+', -50, -30 + 60 * X.rnd(), KE, 1, 0));
      const last = new Map();
      for (let s = 0; s < 400; s++) { W.dt = Math.min(X.chooseDt(), 0.001); X.step(W.dt); for (const o of os) if (o.x > 20 && !last.has(o)) last.set(o, Math.atan2(o.uy, o.ux)); if (os.every(o => o.dead || last.has(o))) break; }
      const th = [...last.values()]; out[KE / 1e6] = { n: th.length, rms: +(1000 * Math.sqrt(th.reduce((t, a) => t + a * a, 0) / th.length)).toFixed(2) };
    }
    return out;
  })();
  check(r74[5].n === 200 && r74[5].rms > 1 && r74[5].rms / r74[50].rms > 6 && r74[5].rms / r74[50].rms < 15,
    `1.15: μ⁺ through 31 Å of gold atoms turned by the nuclei: rms ${r74[5].rms} mrad at 5 MeV, ${r74[50].rms} at 50 MeV`, '1.15 scattering: ' + JSON.stringify(r74));
  // 1.15: charm and bottom mesons: e⁺e⁻ above the thresholds makes D and B pairs; they decay with exact books
  const r75 = (() => {
    const X = require('./load.js').load('all', { seed: 3 }), W = X.W, out = { heavy: 0, had: 0 };
    X.baseWorld(200, 200, 300, 0); W.decayOn = false;
    for (let k = 0; k < 400; k++) { const a = X.fireSpec({ kind: 'e' }, 0, 0, 1, 0, 6e9), b = X.fireSpec({ kind: 'pos' }, 0.01, 0, -1, 0, 6e9); X.eeEvent(a, b, 0, 0); const t = W.log[W.log.length - 1].text; if (!/2γ/.test(t)) out.had++; if (/D[⁰⁺⁻]|B[⁰⁺⁻]|D̄|B̄/.test(t)) out.heavy++; }
    const Y = require('./load.js').load('all', { seed: 4 }), V = Y.W; Y.baseWorld(400, 400, 300, 0); V.decayOn = true; V.warp = 1e6; V.wall = 'reflect';
    const tot = () => Y.totalEnergy().total - V.ledger.nuc + V.ledger.bath;
    for (const sp of ['Dc0', 'Dc-', 'Ds+', 'B+', 'Bb0']) Y.addExo(sp, 0, 0, 1e6, 1, 0);
    const E0 = tot(); for (let s = 0; s < 400; s++) { V.dt = 0.01; Y.step(0.01); Y.decayStep(0.01 * Y.PHYS.TU_S * V.warp); }
    out.decays = V.log.filter(l => /^Decay in flight: (D|B)/.test(l.text)).length; out.dE = +(tot() - E0).toFixed(3); out.left = V.exo.filter(o => !o.dead && /^(D|B)/.test(o.lab)).length;
    return out;
  })();
  check(r75.heavy >= 3 && r75.heavy < r75.had && r75.decays >= 5 && Math.abs(r75.dE) < 0.01 && r75.left === 0,
    `1.15: charm and bottom: ${r75.heavy} of ${r75.had} hadronic e⁺e⁻ events at 12 GeV made D or B mesons; ${r75.decays} D/B decays, books ${r75.dE} eV`, '1.15 charm: ' + JSON.stringify(r75));
  // 1.15: relativity in the atom solver: Dirac's hydrogen-like 1s for gold; gold's 6s deeper and smaller
  const r76 = (() => {
    const X = require('./load.js').load('all', { seed: 1 }), g = X.scfGrid(79, 60), V = new Float64Array(g.n);
    for (let i = 0; i < g.n; i++) V[i] = -79 / g.r[i];
    const h = X.scfOrbitalSR(g, V, 1, 0, 79), au = X.solveAtom(79, 79), s6 = au.orbitals.find(o => o.n === 6 && o.l === 0);
    return { h1s: +h.e.toFixed(2), au6s: +s6.e.toFixed(2), r6s: +s6.rMean.toFixed(3), ok: au.ok };
  })();
  check(Math.abs(r76.h1s + 3434.59) < 0.2 && r76.ok && r76.au6s < -8 && r76.au6s > -9.6 && r76.r6s < 1.6,
    `1.15: relativistic atom solver: hydrogen-like gold 1s ${r76.h1s} hartree (Dirac −3434.59); gold's 6s ${r76.au6s} eV (measured 9.23 eV to remove it; 6.51 without relativity), ⟨r⟩ ${r76.r6s} Å (1.790 without)`, '1.15 solver: ' + JSON.stringify(r76));
  // 1.15: charge flows back through a bond when that lowers the energy: Ni⁺–C⁻ becomes Ni=C; the library's formal
  // charges (ozone, CO, N₂O, nitric acid, nitrate, ammonia borane, nitromethane …) stay
  const r77 = (() => {
    const X = require('./load.js').load('all', { seed: 2 }), W = X.W, out = {};
    X.baseWorld(30, 30, 300, 0.05); W.wall = 'reflect';
    const ni = X.addAtom('Ni', -1.5, 0), c = X.addAtom('C', 1.5, 0); X.userIonize(ni); X.kill(W.parts.find(p => p.k === X.ELEC)); c.ne += 1; X.refresh(c); X.refresh(ni);
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    for (let f = 0; f < 300; f++) X.simFrame(1 / 60, 1e9);
    out.nic = [ni.q, c.q, W.bonds.map(b => b.order).join()];
    out.kept = [];
    for (const k of ['O3', 'CO', 'N2O', 'HNO3', 'BH3NH3', 'NO3m', 'nitromethane']) {
      X.baseWorld(60, 60, 300, 0.05); W.wall = 'reflect'; X.addMolecule(k, 0, 0, 0, 300); X.forcesNoEvents(); W.fSpawn = W.spawned;
      const n0 = W.log.length; for (let s = 0; s < 64; s++) { W.dt = X.chooseDt(); X.step(W.dt); }
      if (!W.log.slice(n0).some(l => /Charge flowed back/.test(l.text))) out.kept.push(k);
    }
    return out;
  })();
  check(r77.nic[0] === 0 && r77.nic[1] === 0 && r77.nic[2] === '2' && r77.kept.length === 7,
    `1.15: charge back through a bond: Ni⁺–C⁻ became Ni=C; formal charges kept in ${r77.kept.join(', ')}`, '1.15 backflow: ' + JSON.stringify(r77));
  // 1.15: every charged particle as a collider beam: a μ⁻μ⁺ ring injects, ramps to 1 GeV without losing a muon and
  // collides them (annihilation, as e⁺e⁻); Σ⁻ on π⁺ in a linac comes through with new hadrons; energy kept exactly
  const r78 = (() => {
    const dE = [];
    const X = require('./load.js').load('all', { seed: 3, patch: (s) => s.replace('function xbHit(C, a, b, d, x, y, ex, ey) {', 'function xbHit(C, a, b, d, x, y, ex, ey) { const e0 = totalEnergy().total - W.ledger.nuc; xbHit0(C, a, b, d, x, y, ex, ey); globalThis.__r78.push(Math.abs(totalEnergy().total - W.ledger.nuc - e0)); }\nfunction xbHit0(C, a, b, d, x, y, ex, ey) {') });
    globalThis.__r78 = dE;
    const W = X.W, out = {};
    X.PRESETS.ring.build(); X.setupCollider('ring', 'xmu-', 'xmu+', 1e9); X.settleOverlaps(); W.baseSpf = W.simPerFrame;
    const C = W.collider; let fewest = 99, top = 0;
    for (let f = 0; f < 2300 && !(C.hits >= 3); f++) {
      X.simFrame(1 / 60, 1e9);
      const xs = W.exo.filter(o => o.xb && o.beam && !o.dead && !o.injKick);
      if (C.rings[0].cnt >= 10 && !C.colliding) { fewest = Math.min(fewest, W.exo.filter(o => o.xb && o.beam && !o.dead).length); if (xs.length) top = Math.max(top, xs.reduce((s, o) => s + o.KE, 0) / xs.length); }
    }
    out.ring = { layout: C.layout, fewest, top: +(top / 1e9).toFixed(3), hits: C.hits, last: C.last };
    X.PRESETS.linac.build(); X.setupCollider('linear', 'xSig-', 'xpi+', 5e9); X.settleOverlaps(); W.baseSpf = W.simPerFrame;
    for (let f = 0; f < 800 && !(W.collider.hits >= 3); f++) X.simFrame(1 / 60, 1e9);
    out.lin = { hits: W.collider.hits, last: W.collider.last };
    out.dE = Math.max(0, ...dE); out.n = dE.length;
    out.menu = Object.values(X.BEAM_SPECIES).filter(s => s.exo).length; out.find = X.beamFind('muon').v;
    return out;
  })();
  check(r78.ring.layout === 'single' && r78.ring.fewest === 20 && r78.ring.top > 0.97 && r78.ring.hits >= 1 && /μ/.test(r78.ring.last) && r78.lin.hits >= 1 && /Σ⁻ \+ π⁺|π⁺ \+ Σ⁻/.test(r78.lin.last) && r78.dE < 1e-3 && r78.menu === 22 && r78.find === 'xmu-',
    `1.15: unstable particles as beams: μ⁻μ⁺ in one ring, all 20 kept to ${r78.ring.top} GeV, then “${r78.ring.last}”; linac “${r78.lin.last.slice(0, 70)}…”; ${r78.n} encounters, energy kept to ${r78.dE.toExponential(0)} eV; ${r78.menu} species in the menus`, '1.15 exotic beams: ' + JSON.stringify(r78));
  // 1.15: electrons as waves (Experimental, eFF): forces are the energy's slopes; ionized water keeps its energy with the
  // packets; twenty recombinations and turning it off keep the books
  const r79 = (() => {
    const L = require('./load.js'), out = {};
    { const X = L.load('all', { seed: 4 }); let worst = 0;
      for (let t = 0; t < 300; t++) {
        const a = { ws: 0.2 + 2 * X.rnd(), q: -1, k: X.ELEC, spin: 1 }, b = { ws: 0.2 + 2 * X.rnd(), q: t % 3 ? -1 : 1, k: t % 3 ? X.ELEC : X.POS, spin: t % 2 ? 1 : -1 }, r = 0.02 + 6 * X.rnd(), h = 1e-6;
        X.wavePair(a, b, r); const d = X._wd.slice(), fr = (X.wavePair(a, b, r + h) - X.wavePair(a, b, r - h)) / (2 * h);
        a.ws += h; const p1 = X.wavePair(a, b, r); a.ws -= 2 * h; const m1 = X.wavePair(a, b, r); a.ws += h;
        worst = Math.max(worst, Math.abs(fr - d[0]), Math.abs((p1 - m1) / (2 * h) - d[1]));
      }
      out.slope = worst; out.pauli = +X.wavePauli(0.5, 0.8, 0.8, true)[0].toFixed(3); }
    { const X = L.load('all', { seed: 9 }), W = X.W;
      X.PRESETS.water.build(); X.settleOverlaps();
      const Os = W.parts.filter(p => p.Z === 8); for (let i = 0; i < 40; i++) X.userIonize(Os[i]);
      X.settleOverlaps(); W.gamma = 0; W.slowmo = false; W.sources.length = 0; X.waveSet(true); X.forcesNoEvents(); W.fSpawn = W.spawned;
      const tot = () => X.totalEnergy().total - W.ledger.nuc + W.ledger.bath, E0 = tot(); let tu = 0;
      for (let i = 0; i < 200; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); tu += X.step(W.dt); }
      const fs = tu * X.PHYS.TU_S * 1e15, ss = X.WAVE.mem.map(p => p.ws);
      out.water = { fs: +fs.toFixed(1), perPs: +((tot() - E0) / fs * 1000).toFixed(1), n: X.WAVE.n, free: W.nE, s: [+Math.min(...ss).toFixed(2), +Math.max(...ss).toFixed(2)] };
      const e1 = tot(); X.waveSet(false); out.off = Math.abs(tot() - e1); out.left = X.WAVE.n; }
    { const X = L.load('all', { seed: 4 }), W = X.W;
      X.baseWorld(30, 30, 300, 0); W.wall = 'reflect';
      for (let i = 0; i < 20; i++) X.userIonize(X.addAtom('H', -12 + (i % 5) * 6, -12 + Math.floor(i / 5) * 6));
      X.waveSet(true); X.forcesNoEvents(); W.fSpawn = W.spawned; const n0 = X.WAVE.n;
      const tot = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc, E0 = tot();
      for (let s = 0; s < 300; s++) { W.dt = X.chooseDt(); X.step(W.dt); }
      out.recomb = { packets: n0, caught: W.count.recomb, dE: +Math.abs(tot() - E0).toFixed(3) }; }
    return out;
  })();
  check(r79.slope < 1e-6 && Math.abs(r79.pauli - 14.456) < 0.01 && r79.water.n === r79.water.free && r79.water.n >= 30 && Math.abs(r79.water.perPs) < 30 && r79.water.s[0] > 0.5 && r79.water.s[1] < 3.5 && r79.off < 1e-6 && r79.left === 0 && r79.recomb.packets >= 15 && r79.recomb.caught >= 15 && r79.recomb.dE < 0.2,
    `1.15: electrons as waves: forces the energy's slopes to ${r79.slope.toExponential(0)} eV/Å; ionized water with ${r79.water.n} packets (${r79.water.s.join('–')} Å) ${r79.water.perPs} eV/ps over ${r79.water.fs} fs; off again exact; ${r79.recomb.caught} recombinations of packets kept to ${r79.recomb.dE} eV`, '1.15 waves: ' + JSON.stringify(r79));
  // 1.16: bond orders, next steps: partial charges from the orders (forces the energy's slopes, with an ion about),
  // SF₆ holds together (no F–F orders), H₃O⁺ and OH⁻ stay members, energy kept at the longer steps
  const r80 = (() => {
    const L = require('./load.js'), out = {};
    { const X = L.load('all', { seed: 3 }), W = X.W;
      X.baseWorld(30, 30, 300, 0); W.wall = 'reflect';
      X.addMolecule('H2O', 0, 0, 0, 0); X.addMolecule('H2O', 3.2, 0.4, 0, 0); const n = X.addAtom('Na', -2.6, 1.2); X.userIonize(n);
      for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
      X.boSet(true); X.forcesNoEvents();
      const E = () => X.totalEnergy().total; let worst = 0;
      for (const p of W.parts.filter(p => !p.dead && p.k === X.NUC)) { const h = 1e-5, x0 = p.x; X.forcesNoEvents(); const f = p.fx; p.x = x0 + h; const a = E(); p.x = x0 - h; const b = E(); p.x = x0; worst = Math.max(worst, Math.abs(-(a - b) / (2 * h) - f)); }
      const O = W.parts.find(p => p.Z === 8 && p.bom); out.slope = worst; out.qO = +O.qp.toFixed(3); }
    { const X = L.load('all', { seed: 2 }), W = X.W;
      X.baseWorld(40, 40, 300, 0); W.wall = 'reflect'; X.addMolecule('SF6', -8, 0, 0, 300); X.addMolecule('H3Op', 8, 6, 0, 300); X.addMolecule('OHm', 8, -6, 0, 300);
      for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
      X.boSet(true); X.forcesNoEvents(); W.fSpawn = W.spawned;
      const tot = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc, E0 = tot();
      for (let i = 0; i < 1500; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
      const b = X.boBonds(); out.sf = b.filter(([p, q]) => (p.Z === 16) !== (q.Z === 16) && (p.Z === 9 || q.Z === 9)).map(x => +x[2].toFixed(2));
      out.ff = b.filter(([p, q]) => p.Z === 9 && q.Z === 9).length; out.ions = W.parts.filter(p => p.bom && p.q !== 0).length; out.dE = +Math.abs(tot() - E0).toFixed(4); out.step = +(W.dt * X.PHYS.TU_S * 1e15).toFixed(3); }
    return out;
  })();
  check(r80.slope < 1e-4 && r80.qO < -0.7 && r80.sf.length === 6 && Math.min(...r80.sf) > 0.95 && r80.ff === 0 && r80.ions === 2 && r80.dE < 0.01,
    `1.16: bond orders: partial charges (O ${r80.qO}) with forces the slopes to ${r80.slope.toExponential(0)} eV/Å beside Na⁺; SF₆ S–F ${Math.min(...r80.sf)}–${Math.max(...r80.sf)}, no F–F; H₃O⁺ and OH⁻ members; ${r80.dE} eV over 1,500 insulated steps of ${r80.step} fs`, '1.16 bond orders: ' + JSON.stringify(r80));
  // (1.17's check of the flat pass against the object pass is gone with the object pass, 1.19; r82 checks WebAssembly against it)
  // 1.19: bond orders: member atoms repel inside the bonding reach (Lennard-Jones by the orders), so water keeps its spacing
  const r83 = (() => {
    const out = {};
    const dimer = (bo, ion) => {
      const X = require('./load.js').load('all', { seed: 3 }), W = X.W;
      X.addMolecule(ion ? 'H3Op' : 'H2O', 0, 0, 0, 0); X.addMolecule('H2O', 2.9, 0, Math.PI, 0); for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
      X.boSet(bo); X.forcesNoEvents(); W.T = 0; W.Tset = 0; W.gamma = 2;
      for (let i = 0; i < 6000; i++) { W.dt = Math.min(X.chooseDt(), 0.02); X.step(W.dt); }
      const O = W.parts.filter(p => !p.dead && p.Z === 8); return +Math.hypot(O[0].x - O[1].x, O[0].y - O[1].y).toFixed(3);
    };
    out.dimer = [dimer(false, false), dimer(true, false)]; out.ion = [dimer(false, true), dimer(true, true)];
    // radicals still meet without a wall: H + OH and CH₃ + CH₃, the energy on the way in from 4 Å
    const frag = { H: [[1, 0, 0]], OH: [[8, 0, 0], [1, -0.97, 0]], CH3: [[6, 0, 0], [1, -0.545, 0.944], [1, -0.545, -0.944], [1, -1.09, 0]] };
    out.wall = [['OH', 'H'], ['CH3', 'CH3']].map(([a, b]) => {
      const X = require('./load.js').load('all', { seed: 3 }), W = X.W;
      const mk = (f, x0, flip) => frag[f].map(([Z, x, y]) => X.spawnSpec({ kind: 'atom', Z, A: Z === 1 ? 1 : 2 * Z }, x0 + (flip ? -x : x), y, 0)[0]);
      const A = mk(a, 0, false), B = mk(b, 6, true); for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
      X.boSet(true); X.forcesNoEvents(); let e0 = null, top = -9;
      for (let r = 4; r >= 1.6; r -= 0.1) { const dx = A[0].x + r - B[0].x; for (const p of B) { p.x += dx; X.S.x[p.i] = p.x; } const e = X.boPass(false); if (e0 === null) e0 = e; top = Math.max(top, e - e0); }
      return +top.toFixed(3);
    });
    // forces are the energy's slopes (a few waters, a hydronium and ammonia, after 200 steps at 300 K)
    { const X = require('./load.js').load('all', { seed: 5 }), W = X.W;
      X.addMolecule('H3Op', 0, 0, 0, 0); X.addMolecule('H2O', 2.6, 0.3, 2.8, 0); X.addMolecule('H2O', -1.5, 2.5, 1, 0); X.addMolecule('NH3', 3, 3, 0.4, 0); for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
      X.boSet(true); X.forcesNoEvents(); W.T = 300; for (let i = 0; i < 200; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
      const mem = W.parts.filter(p => p.bom && !p.dead); X.S.fx.fill(0); X.S.fy.fill(0); X.boPass(true); const F = mem.map(p => [X.S.fx[p.i], X.S.fy[p.i]]); let worst = 0;
      mem.forEach((p, u) => { for (const [A, c] of [[X.S.x, 0], [X.S.y, 1]]) { const x0 = A[p.i]; A[p.i] = x0 + 1e-5; const e1 = X.boPass(false); A[p.i] = x0 - 1e-5; const e2 = X.boPass(false); A[p.i] = x0; worst = Math.max(worst, Math.abs(-(e1 - e2) / 2e-5 - F[u][c])); } });
      out.dF = worst; }
    // liquid water insulated: the books still close
    { const X = require('./load.js').load('all', { seed: 3 }), W = X.W;
      X.PRESETS.water.build(); X.settleOverlaps(); X.boSet(true); X.forcesNoEvents(); W.fSpawn = W.spawned;
      const run = (n) => { for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };
      run(100); W.gamma = 0; const tot = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc, E0 = tot(); run(300); out.drift = +Math.abs(tot() - E0).toFixed(4);
      let oo = 9; const O = W.parts.filter(p => !p.dead && p.Z === 8); for (const a of O) for (const b of O) if (a.id < b.id) oo = Math.min(oo, Math.hypot(a.x - b.x, a.y - b.y)); out.ooMin = +oo.toFixed(2); }
    return out;
  })();
  check(Math.abs(r83.dimer[1] - r83.dimer[0]) < 0.1 && Math.abs(r83.ion[1] - r83.ion[0]) < 0.1 && Math.max(...r83.wall) < 0.1 && r83.dF < 1e-5 && r83.drift < 0.02 && r83.ooMin > 2.4,
    `1.19: bond orders keep water's spacing: the dimer's O–O ${r83.dimer[1]} Å (stored bonds ${r83.dimer[0]}), H₃O⁺·H₂O ${r83.ion[1]} (${r83.ion[0]}), liquid water's closest O–O ${r83.ooMin} Å; radicals meet without a wall (${r83.wall.join(', ')} eV); forces to ${r83.dF.toExponential(0)} eV/Å; insulated water ${r83.drift} eV`, '1.19 member repulsion: ' + JSON.stringify(r83));
  // 1.18: the orders' pass in WebAssembly (kernel/src/bo.rs) gives the JavaScript pass's numbers, faster
  const r82 = (() => {
    const X = require('./load.js').load('all', { seed: 3 }), W = X.W, out = { wasm: typeof X.WK.ex?.af_bo_pass1 === 'function' };
    if (!out.wasm) return out;
    const cmp = (label) => {
      const run = (f, forces) => { X.S.fx.fill(0); X.S.fy.fill(0); const ls = X.BF.mem.map(p => p._boLs), E = f(forces), fx = Array.from(X.S.fx.subarray(0, X.S.hi)), fy = Array.from(X.S.fy.subarray(0, X.S.hi)), q = W.parts.map(p => p.qp), n = Array.from(X.BF.pn.subarray(0, X.BO.np)); X.BF.mem.forEach((p, m) => { p._boLs = ls[m]; }); return { E, fx, fy, q, n }; };
      const t = (f) => { const t0 = performance.now(); for (let i = 0; i < 30; i++) f(true); return (performance.now() - t0) / 30; };
      const A = run(X.boPassJS, true), B = run(X.boPass, true), A0 = run(X.boPassJS, false), B0 = run(X.boPass, false);
      const d = (u, v) => Math.max(0, ...u.map((x, i) => Math.abs(x - v[i])));
      out[label] = { dE: Math.abs(A.E - B.E), dE0: Math.abs(A0.E - B0.E), dF: Math.max(d(A.fx, B.fx), d(A.fy, B.fy)), dq: d(A.q, B.q), dn: A.n.length === B.n.length ? d(A.n, B.n) : 1, np: B.n.length, speed: +(t(X.boPassJS) / t(X.boPass)).toFixed(1) };
    };
    X.PRESETS.gallery.build(); X.addMolecule('H3Op', 0, 0, 0, 300); X.addMolecule('SF6', 8, 0, 0, 300); for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
    X.settleOverlaps(); X.boSet(true); X.forcesNoEvents(); W.fSpawn = W.spawned;
    for (let i = 0; i < 40; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
    X.forcesNoEvents(); cmp('gallery'); out.calls = X.BFW.calls;
    X.PRESETS.brine.build(); W.wall = 'wrap'; for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
    X.boSet(true); X.forcesNoEvents(); W.fSpawn = W.spawned;
    for (let i = 0; i < 20; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
    X.forcesNoEvents(); cmp('brine');
    return out;
  })();
  const r82ok = (c) => c && c.dE < 1e-9 && c.dE0 < 1e-9 && c.dF < 1e-9 && c.dq < 1e-12 && c.dn < 1e-12;
  check(r82.wasm && r82ok(r82.gallery) && r82ok(r82.brine) && r82.calls > 40,
    `1.18: the orders' pass in WebAssembly: the JavaScript pass's energy, forces, charges and orders (the molecule gallery, ${r82.gallery?.np} pairs; brine in a wrapped box, ${r82.brine?.np}), ${r82.gallery?.speed}× and ${r82.brine?.speed}× as fast`, '1.18 wasm pass: ' + JSON.stringify(r82));
  // 1.20: bond orders: moving charge. Members' electron counts are continuous and move within a molecule; a proton passing
  // between two waters takes the charge with it; a shared proton's two structures mix
  const r84 = (() => {
    const out = {};
    // ∂E/∂ν against differences, with whole and fractional counts (H₃O⁺, OH⁻, waters, ammonia after 100 steps)
    for (const frac of [false, true]) {
      const X = require('./load.js').load('all', { seed: 5 }), W = X.W;
      X.addMolecule('H3Op', 0, 0, 0, 0); X.addMolecule('H2O', 2.6, 0.3, 2.8, 0); X.addMolecule('H2O', -1.5, 2.5, 1, 0); X.addMolecule('NH3', 3, 3, 0.4, 0); X.addMolecule('OHm', -3, -2, 0, 0); for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
      X.boSet(true); X.forcesNoEvents(); W.T = 300; for (let i = 0; i < 100; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
      const mem = W.parts.filter(p => p.bom && !p.dead); mem.forEach((p, i) => { p._dq = frac && p.Z > 1 ? ((i * 0.37) % 0.6) - 0.3 : 0; });
      X.S.fx.fill(0); X.S.fy.fill(0); X.boPass(true); const G = mem.map(p => p._dqg); let worst = 0;
      mem.forEach((p, u) => { const d = p._dq; p._dq = d + 1e-6; const e1 = X.boPass(false); p._dq = d - 1e-6; const e2 = X.boPass(false); p._dq = d; worst = Math.max(worst, Math.abs((e1 - e2) / 2e-6 - G[u])); });
      out[frac ? 'dGfrac' : 'dG'] = worst;
    }
    // a proton held on the far side of two waters (O–O 2.5 Å): the +1 follows it to the far oxygen
    { const X = require('./load.js').load('all', { seed: 3 }), W = X.W, R = 2.5, x = 1.53;
      X.addMolecule('H3Op', 0, 0, 0, 0); X.addMolecule('H2O', R + 0.4, 0, -Math.PI / 2, 0); for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
      const at = W.parts.filter(p => !p.dead), Oa = at.find(p => p.Z === 8 && p.q === 1), Ob = at.find(p => p.Z === 8 && p.q === 0);
      const Hs = at.filter(p => p.Z === 1 && X.bondBetween(p, Oa)).sort((a, b) => b.x - a.x)[0];
      X.boSet(true); W.T = 0; W.Tset = 0; W.gamma = 3;
      const hold = () => { for (const [p, px, py] of [[Oa, 0, 0], [Ob, R, 0], [Hs, x, 0]]) { p.x = px; p.y = py; p.vx = 0; p.vy = 0; } };
      hold(); X.forcesNoEvents();
      for (let i = 0; i < 2000; i++) { W.dt = Math.min(X.chooseDt(), 0.02); X.step(W.dt); hold(); }
      out.hop = [Oa.q, Ob.q, X.BO.dqReal || 0]; }
    // Eigen and Zundel: the ion pair relaxed against the proton held halfway between waters 2.65 Å apart
    { const run = (held) => { const X = require('./load.js').load('all', { seed: 3 }), W = X.W, R = 2.65;
        X.addMolecule('H3Op', 0, 0, 0, 0); X.addMolecule('H2O', 3.1, 0, -Math.PI / 2, 0); for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
        const at = W.parts.filter(p => !p.dead), Oa = at.find(p => p.Z === 8 && p.q === 1), Ob = at.find(p => p.Z === 8 && p.q === 0);
        const Hs = at.filter(p => p.Z === 1 && X.bondBetween(p, Oa)).sort((a, b) => b.x - a.x)[0];
        X.boSet(true); W.T = 0; W.Tset = 0; W.gamma = 3;
        const hold = () => { if (!held) return; for (const [p, px, py] of [[Oa, 0, 0], [Ob, R, 0], [Hs, R / 2, 0]]) { p.x = px; p.y = py; p.vx = 0; p.vy = 0; } };
        hold(); X.forcesNoEvents(); for (let i = 0; i < 4000; i++) { W.dt = Math.min(X.chooseDt(), 0.02); X.step(W.dt); hold(); }
        return [X.boPass(false), +(Oa.q - (Oa._dq || 0)).toFixed(2)]; };
      const [E0] = run(false), [E1, qa] = run(true); out.zundel = +(E1 - E0).toFixed(3); out.zq = qa; }
    // liquid water with a hydronium, insulated: the books close
    { const X = require('./load.js').load('all', { seed: 3 }), W = X.W;
      X.PRESETS.water.build(); X.addMolecule('H3Op', 0, 0, 0, 300); X.settleOverlaps(); X.boSet(true); X.forcesNoEvents(); W.fSpawn = W.spawned;
      const run = (n) => { for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };
      run(200); W.gamma = 0; const tot = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc, E0 = tot(); run(400); out.drift = +Math.abs(tot() - E0).toFixed(4); }
    return out;
  })();
  check(r84.dG < 1e-5 && r84.dGfrac < 1e-5 && r84.hop[0] === 0 && r84.hop[1] === 1 && r84.hop[2] >= 2 && Math.abs(r84.zundel) < 0.3 && Math.abs(r84.zq - 0.5) < 0.1 && r84.drift < 0.1,
    `1.20: moving charge: ∂E/∂ν to ${r84.dG.toExponential(0)}/${r84.dGfrac.toExponential(0)}; a proton held by the far water takes the +1 there (charges ${r84.hop[0]}/${r84.hop[1]}); a proton shared between waters 2.65 Å apart ${r84.zundel} eV from H₃O⁺·H₂O, the charge split ${r84.zq}/${+(1 - r84.zq).toFixed(2)}; water with H₃O⁺ insulated ${r84.drift} eV`, '1.20 moving charge: ' + JSON.stringify(r84));
  // 1.21: quantum nuclei: ring-polymer contraction (bonds and bends on every bead, the rest at the centres) and the
  // rings kept in mode space: the same quantum spread and bond lengths as every bead, its forces the energy's slopes, faster
  const r85 = (() => {
    const out = {};
    for (const rpc of [false, true]) {
      const X = require('./load.js').load('all', { seed: 3 }), W = X.W;
      X.PRESETS.water.build(); X.settleOverlaps(); X.PI.rpc = rpc; X.piSet(8); X.forcesNoEvents(); W.fSpawn = W.spawned;
      const run = (n) => { let tu = 0; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); tu += X.step(W.dt); } return tu; };
      run(200); W.gamma = 0; const tot = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc, E0 = tot();
      const t0 = performance.now(), tu = run(300), ms = (performance.now() - t0) / tu;
      let sp = 0, nh = 0; for (const p of W.parts) if (!p.dead && p.Z === 1) { for (let k = 0; k < 8; k++) { const o = k * X.PI.cap + p.i; sp += Math.hypot(X.PI.ox[o], X.PI.oy[o]); } nh += 8; }
      let oh = 0; for (const b of W.bonds) oh += Math.hypot(b.a.x - b.b.x, b.a.y - b.b.y);
      X.forcesNoEvents(); const ats = W.parts.filter(p => !p.dead).slice(0, 8), F = ats.map(p => X.S.fx[p.i]); let dF = 0;
      ats.forEach((p, u) => { const x0 = X.S.x[p.i]; X.S.x[p.i] = x0 + 1e-5; const e1 = X.piEnergy().pe; X.S.x[p.i] = x0 - 1e-5; const e2 = X.piEnergy().pe; X.S.x[p.i] = x0; dF = Math.max(dF, Math.abs(-(e1 - e2) / 2e-5 - F[u])); });
      out[rpc ? 'c' : 'e'] = { ms, spread: +(sp / nh).toFixed(3), oh: +(oh / W.bonds.length).toFixed(4), drift: +Math.abs(tot() - E0).toFixed(4), dF };
    }
    out.speed = +(out.e.ms / out.c.ms).toFixed(1);
    return out;
  })();
  check(Math.abs(r85.c.spread - r85.e.spread) < 0.01 && Math.abs(r85.c.oh - r85.e.oh) < 0.005 && r85.c.drift < 0.05 && r85.c.dF < 1e-5 && r85.e.dF < 1e-5 && r85.speed > 1.6,
    `1.21: quantum nuclei contracted: H spread ${r85.c.spread} Å (every bead ${r85.e.spread}), O–H ${r85.c.oh} (${r85.e.oh}), insulated ${r85.c.drift} eV over 300 steps, forces to ${r85.c.dF.toExponential(0)} eV/Å, ${r85.speed}× as fast as every bead at 8`, '1.21 contraction: ' + JSON.stringify(r85));
  // 1.22: quantum bonds (GFN1-xTB): the port against tblite's own numbers; forces against the energy with an ion outside;
  // the books in an insulated run; a shared proton finds the middle; charges placed where the electrons are on leaving
  const r86 = (() => {
    const out = {}, X0 = require('./load.js').load('all', { seed: 3 });
    { const G = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'xtb-ref-sub.json'), 'utf8')); let dE = 0, dg = 0, nG = 0; // (every 7th of tools/xtb-ref's geometries, with tblite's numbers)
      for (const g of G) {
        const ref = g, r = X0.XTB.gfn1Energy(g.Z, g.xyz, g.charge || 0, g.uhf || 0, { grad: true }), d = X0.XTB.d3Disp(g.Z, g.xyz, {});
        dE = Math.max(dE, Math.abs(r.E + d.E - ref.E)); nG++;
        ref.grad.forEach((row, i) => row.forEach((v, k) => { dg = Math.max(dg, Math.abs(r.g[i][k] + d.g[i][k] - v)); }));
      }
      out.ref = { n: nG, dE: +dE.toExponential(1), dg: +dg.toExponential(1) }; }
    // forces are the energy's slopes: a hydronium, two waters and ammonia, a sodium ion outside (its potential in the charges)
    { const X = require('./load.js').load('all', { seed: 5 }), W = X.W;
      X.addMolecule('H3Op', 0, 0, 0, 0); X.addMolecule('H2O', 2.6, 0.3, 2.8, 0); X.addMolecule('H2O', -1.5, 2.5, 1, 0); X.addMolecule('NH3', 3, 3, 0.4, 0); X.addAtom('Na', -3, -2, { charge: 1, T: 0 });
      for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
      X.boSet(2); X.forcesNoEvents(); W.T = 300; for (let i = 0; i < 60; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
      const mem = W.parts.filter(p => p.bom && !p.dead), all = W.parts.filter(p => !p.dead && p.k === X.NUC); out.members = mem.length;
      X.forcesNoEvents(); const F = all.map(p => [X.S.fx[p.i], X.S.fy[p.i]]); let worst = 0;
      const E = () => X.totalEnergy().pe;
      all.forEach((p, u) => { for (const c of [0, 1]) { const A = c ? 'y' : 'x', x0 = p[A]; p[A] = x0 + 1e-4; X.gridTouch(); const e1 = E(); p[A] = x0 - 1e-4; X.gridTouch(); const e2 = E(); p[A] = x0; X.gridTouch(); worst = Math.max(worst, Math.abs(-(e1 - e2) / 2e-4 - F[u][c])); } });
      out.dF = +worst.toExponential(1); }
    // insulated: the books close
    { const X = require('./load.js').load('all', { seed: 3 }), W = X.W;
      X.addMolecule('H3Op', 0, 0, 0, 300); for (let k = 0; k < 3; k++) { const a = 2 * Math.PI * k / 3; X.addMolecule('H2O', 2.8 * Math.cos(a), 2.8 * Math.sin(a), a + Math.PI / 2 + 0.3 * k, 300); }
      for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
      X.settleOverlaps(); X.boSet(2); X.forcesNoEvents(); W.T = 300;
      for (let i = 0; i < 100; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
      W.gamma = 0; const tot = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc, E0 = tot();
      const t0 = performance.now(); for (let i = 0; i < 400; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
      out.ms = +((performance.now() - t0) / 400).toFixed(1); out.drift = +Math.abs(tot() - E0).toFixed(5); out.fails = X.XQ.fails; }
    // a proton between two waters held 2.45 Å apart, started on one: it settles in the middle (GFN1's single well)
    { const X = require('./load.js').load('all', { seed: 3 }), W = X.W, R = 2.45;
      X.addMolecule('H3Op', 0, 0, 0, 0); X.addMolecule('H2O', R + 0.4, 0, -Math.PI / 2, 0); for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
      const at = W.parts.filter(p => !p.dead), Oa = at.find(p => p.Z === 8 && p.q === 1), Ob = at.find(p => p.Z === 8 && p.q === 0);
      const Hs = at.filter(p => p.Z === 1 && X.bondBetween(p, Oa)).sort((a, b) => b.x - a.x)[0];
      X.boSet(2); W.T = 0; W.Tset = 0; W.gamma = 3;
      const hold = () => { for (const [p, px, py] of [[Oa, 0, 0], [Ob, R, 0]]) { p.x = px; p.y = py; p.vx = 0; p.vy = 0; } };
      hold(); Hs.x = 1.0; Hs.y = 0; X.forcesNoEvents();
      for (let i = 0; i < 1500; i++) { W.dt = Math.min(X.chooseDt(), 0.02); X.step(W.dt); hold(); }
      out.mid = +(Hs.x - R / 2).toFixed(3); out.split = +((Oa.q + X.S.qp[Oa.i]) - (Ob.q + X.S.qp[Ob.i])).toFixed(2); }
    // leaving: the +1 goes to the oxygen holding three hydrogens, wherever the label was; paid exactly
    { const X = require('./load.js').load('all', { seed: 3 }), W = X.W;
      X.addMolecule('H3Op', 0, 0, 0, 300); for (let k = 0; k < 3; k++) { const a = 2 * Math.PI * k / 3; X.addMolecule('H2O', 2.8 * Math.cos(a), 2.8 * Math.sin(a), a + Math.PI / 2 + 0.3 * k, 300); }
      for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
      X.settleOverlaps(); X.boSet(2); X.forcesNoEvents();
      const O = W.parts.filter(p => !p.dead && p.Z === 8), a = O.find(p => p.q === 1), b = O.find(p => p.q === 0);
      a.ne += 1; X.refresh(a); b.ne -= 1; X.refresh(b); X.forcesNoEvents(); W.gamma = 0;
      const tot = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc, E0 = tot();
      X.boSet(0); X.forcesNoEvents();
      out.leave = [a.q, b.q, W.parts.filter(p => !p.dead && p.Z === 1 && !p.bonds.length).length, +Math.abs(tot() - E0).toExponential(0)]; }
    // more than 40 atoms: none take part
    { const X = require('./load.js').load('all', { seed: 3 }), W = X.W;
      for (let k = 0; k < 14; k++) X.addMolecule('H2O', -12 + 3.2 * (k % 7), -3 + 4 * Math.floor(k / 7), k, 300);
      for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
      X.settleOverlaps(); X.boSet(2); X.forcesNoEvents(); out.over = [W.parts.filter(p => p.bom).length, X.XQ.over]; }
    return out;
  })();
  check(r86.ref.dE < 1e-8 && r86.ref.dg < 1e-8 && r86.members === 14 && r86.dF < 1e-5 && r86.drift < 0.01 && !r86.fails && Math.abs(r86.mid) < 0.08 && Math.abs(r86.split) < 0.1 && r86.leave[0] === 1 && r86.leave[1] === 0 && r86.leave[2] === 0 && r86.leave[3] < 1e-4 && r86.over[0] === 0 && r86.over[1] === 42,
    `1.22: quantum bonds (GFN1-xTB): tblite's energies and forces to ${r86.ref.dE}/${r86.ref.dg} (${r86.ref.n} geometries); forces the energy's slopes to ${r86.dF} eV/Å with an ion outside; insulated ${r86.drift} eV over 400 steps (${r86.ms} ms a step, 13 atoms); a proton between waters 2.45 Å apart settles ${r86.mid} Å from the middle, the charge split ${r86.split}; leaving, the +1 goes to the oxygen with three hydrogens (${r86.leave.join('/')}); 42 atoms: none take part`, '1.22 quantum bonds: ' + JSON.stringify(r86));
  // 1.13: the crash handler: an error in a frame, broken numbers, and a session that never left normally
  const r67 = await page.evaluate(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms)), o = {};
    loadPreset('soup'); setRunning(true); await wait(200);
    const f = simFrame; let once = true; simFrame = (...a) => { if (once) { once = false; throw new Error('test boom'); } return f(...a); };
    await wait(300); simFrame = f;
    o.err = { open: !$('crashModal').hidden, running: UI.running, rep: /test boom/.test($('crashReport').value) && !/apiKey/.test($('crashReport').value) };
    document.querySelector('[data-crash=go]').click(); await wait(200); o.go = !CRASH.open && UI.running;
    const p = W.parts.find(q => !q.dead); p.vx = NaN; await wait(700);
    o.nan = { open: !$('crashModal').hidden, title: $('crashTitle').textContent };
    document.querySelector('[data-crash=fix]').click(); await wait(600); o.fixed = !CRASH.open && UI.running && crashBad().length === 0;
    o.beat = !!JSON.parse(localStorage.getItem('atomforge.beat') || 'null');
    return o;
  });
  for (let i = errors.length - 1; i >= 0; i--) if (/test boom/.test(errors[i])) errors.splice(i, 1); // (the error the check threw on purpose)
  const r67b = await (async () => {
    const m = await openPage({ settle: 900, menu: true });
    await m.page.evaluate(() => { hideMainMenu(); loadPreset('soup'); setRunning(true); });
    await m.page.waitForTimeout(2300);
    await m.page.evaluate(() => { autosave(); const b = localStorage.getItem('atomforge.beat'), k = () => localStorage.setItem('atomforge.beat', b); window.addEventListener('pagehide', k); document.addEventListener('visibilitychange', k); }); // (as if the tab had died)
    await m.page.reload(); await m.page.waitForTimeout(900);
    const rec = await m.page.evaluate(() => ({ open: !$('crashModal').hidden, title: $('crashTitle').textContent, restore: !!document.querySelector('[data-crash=restore]') }));
    await m.page.reload(); await m.page.waitForTimeout(900);
    rec.clean = await m.page.evaluate(() => $('crashModal').hidden);
    await m.browser.close(); return rec;
  })();
  check(r67.err.open && !r67.err.running && r67.err.rep && r67.go && r67.nan.open && /Broken/.test(r67.nan.title) && r67.fixed && r67.beat && r67b.open && /unexpectedly/.test(r67b.title) && r67b.restore && r67b.clean,
    `1.13: crash handler: an error pauses with a dialog, broken numbers caught and removed, a session that died offered back from its autosave, a normal reload not`, '1.13 crash handler: ' + JSON.stringify({ r67, r67b }));
  // 1.12: muonium is an atom (a hydrogen atom whose nucleus is a μ⁺, 0.1134 u): fired into chlorine it reacts as H does
  // (Mu + Cl₂ → MuCl + Cl) and bounces off argon, where as an exo it flew straight through everything; it is named Mu,
  // saved and loaded as Mu, and its muon's decay (e⁺ + νₑ + ν̄μ, the electron set free) keeps the books exactly
  const r69 = await page.evaluate(() => {
    const out = {};
    const shoot = (tgt) => {
      loadPreset('empty'); setRunning(false); baseWorld(60, 40, 300, 0); W.slowmo = false;
      for (let i = 0; i < 60; i++) { const x = -26 + (i % 12) * 4.5, y = -16 + Math.floor(i / 12) * 7; if (tgt === 'Ar') addAtom('Ar', x, y); else addMolecule(tgt, x, y, i, 300); }
      settleOverlaps(); forcesNoEvents(); W.fSpawn = W.spawned;
      const mus = []; for (let i = 0; i < 20; i++) mus.push(fireSpec({ kind: 'exo', sp: 'Mu' }, -28, -18 + i * 1.8, 1, 0.05 * (i % 5 - 2), 1.0));
      for (let i = 0; i < 3000; i++) { if (W.fSpawn !== W.spawned) { forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = chooseDt(); step(W.dt); }
      const dir = (o) => (o.k !== undefined ? Math.atan2(o.vy, o.vx) : Math.atan2(o.uy, o.ux));
      return { atoms: mus.filter(o => o.k === NUC).length, turned: mus.filter(o => !o.dead && Math.abs(Math.cos(dir(o))) < 0.87).length,
        rx: W.log.filter(l => /^Reaction: Mu \+ Cl₂ → ClMu \+ Cl/.test(l.text)).reduce((t, l) => t + l.n, 0), names: [...new Set(W.parts.filter(p => !p.dead && p.mu).map(speciesLabel))].sort().join(' ') };
    };
    out.ar = shoot('Ar'); out.cl = shoot('Cl2');
    const d = worldToJSON(); worldFromJSON(d); out.reloaded = W.parts.filter(p => !p.dead && p.mu).length;
    loadPreset('empty'); setRunning(false); baseWorld(40, 28, 300, 0); W.decayOn = true;
    const cl = addAtom('Cl', 5, 0), b = addMuonium(6.3, 0, 0.03, 1, 0); addBond(b, cl, 1); relink([b, cl]); addMuonium(-5, 0, 0.03, 1, 0);
    forcesNoEvents(); W.fSpawn = W.spawned;
    out.m = +b.m.toFixed(4); out.mol = speciesLabel(b);
    const tot = () => totalEnergy().total - W.ledger.nuc, E0 = tot(); W.warp = 1e13; W.dt = chooseDt(); step(W.dt);
    out.decayed = W.parts.filter(p => !p.dead && p.mu).length === 0; out.dE = +(tot() - E0).toFixed(4);
    out.after = W.parts.filter(p => !p.dead).map(speciesLabel).sort().join(' ');
    return out;
  });
  check(r69.ar.atoms === 20 && r69.ar.turned >= 8 && r69.cl.rx >= 3 && /ClMu/.test(r69.cl.names) && r69.reloaded > 0 && r69.m < 0.115 && r69.mol === 'ClMu' && r69.decayed && Math.abs(r69.dE) < 0.01 && r69.after === 'Cl e⁺ e⁺ e⁻ e⁻',
    `1.12: muonium is an atom (${r69.m} u): 20 fired into argon, ${r69.ar.turned} sent off course; into chlorine, ${r69.cl.rx} Mu + Cl₂ → MuCl + Cl (${r69.cl.names}); saved and loaded (${r69.reloaded}); MuCl and Mu decay to ${r69.after}, books ${r69.dE} eV`, '1.12 muonium: ' + JSON.stringify(r69));
  // 1.12: a dashed ionic line joins a cation and a polyatomic anion in contact (Na⁺ and CN⁻: the reach was the C atom's
  // covalent drawing radius, 1.99 Å, against a 2.7 Å contact), but not ions merely near (4.5 Å); Na⁺–Cl⁻ as before
  const r70 = await page.evaluate(() => {
    const lines = () => { const ctx = R.ctx, lt = ctx.lineTo; let n = 0; ctx.lineTo = function (...a) { n++; return lt.apply(this, a); }; try { drawIonic(); } finally { ctx.lineTo = lt; } return n; };
    const setup = (fn) => { loadPreset('empty'); setRunning(false); baseWorld(30, 20, 300, 0.05); W.slowmo = false; fn(); forcesNoEvents(); W.fSpawn = W.spawned; R.s = Math.max(R.s, 20); };
    const out = {};
    setup(() => { const na = addAtom('Na', 0, 0); userIonize(na); W.parts.filter(p => p.k === ELEC).forEach(kill); addMolecule('CNm', 3.2, 0, 0, 0); });
    for (let i = 0; i < 600; i++) { if (W.fSpawn !== W.spawned) { forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = chooseDt(); step(W.dt); }
    const na = W.parts.find(p => p.Z === 11), cn = W.parts.filter(p => p.Z === 6 || p.Z === 7);
    out.contact = +Math.min(...cn.map(p => Math.hypot(p.x - na.x, p.y - na.y))).toFixed(2); out.cnLines = lines();
    { const c = cn.find(p => p.Z === 6), nn = cn.find(p => p.Z === 7); c.x = na.x + 2.73; c.y = na.y; nn.x = na.x + 3.88; nn.y = na.y; out.endOn = lines(); } // (end-on at the measured 2.73 Å)
    // moved off so that its nearest atom is 4.5 Å from the Na⁺
    const near = cn.reduce((a, b) => Math.hypot(a.x - na.x, a.y - na.y) < Math.hypot(b.x - na.x, b.y - na.y) ? a : b), d = Math.hypot(near.x - na.x, near.y - na.y), ux = (near.x - na.x) / d, uy = (near.y - na.y) / d;
    for (const p of cn) { p.x += ux * (4.5 - d); p.y += uy * (4.5 - d); }
    out.far = +Math.min(...cn.map(p => Math.hypot(p.x - na.x, p.y - na.y))).toFixed(2); out.farLines = lines();
    setup(() => { const a = addAtom('Na', 0, 0), b = addAtom('Cl', 2.8, 0); userIonize(a); W.parts.filter(p => p.k === ELEC).forEach(kill); userAddElectron(b); addAtom('Na', -8, 6); });
    const n2 = W.parts.filter(p => p.Z === 11)[1]; userIonize(n2); W.parts.filter(p => p.k === ELEC).forEach(kill); n2.x = 2.8 + 4.5; n2.y = 0;
    out.naCl = lines();
    return out;
  });
  check(r70.contact < 3.2 && r70.cnLines === 1 && r70.endOn === 1 && r70.far >= 4.49 && r70.farLines === 0 && r70.naCl === 1,
    `1.12: ionic lines: Na⁺ touching CN⁻ (${r70.contact} Å) gets one (end-on at 2.73 Å: ${r70.endOn}), ${r70.far} Å off none; Na⁺–Cl⁻ at 2.8 Å one, a second Na⁺ 4.5 Å from the Cl⁻ none`, '1.12 ionic lines: ' + JSON.stringify(r70));
  // 1.12: muonic hydrogen scatters elastically off hydrogen nuclei (measured σ: μp + p 1.49×10⁻²⁰ cm², Bertin et al. 1982),
  // at the enlarged nuclear reach (R_NN) in normal play and at its true size, √(σ/π) = 0.0069 Å, in the ultra-realistic
  // mode; momentum and energy kept exactly. In H₂ at 20 K a μp fired at 1 eV slows to the gas's temperature.
  const r71 = await page.evaluate(() => {
    const out = {};
    const pass = (ultra, b) => {
      loadPreset('empty'); setRunning(false); baseWorld(30, 20, 20, 0); W.slowmo = false; W.decayOn = false; W.ultra = ultra;
      const h = addAtom('H', 0, b); h.vx = 0.01; h.vy = -0.02; forcesNoEvents(); W.fSpawn = W.spawned;
      const o = addExo('muP', -0.5, 0, 1.0, 1, 0); o.x = 0.5; // (its path this step: (−0.5, 0) → (0.5, 0))
      const mo = o.m / PHYS.AMU_MEV, P = (q) => [mo * Math.sqrt(2 * o.KE / mo) * o.ux + h.m * h.vx, mo * Math.sqrt(2 * o.KE / mo) * o.uy + h.m * h.vy];
      const E0 = o.KE + 0.5 * h.m * (h.vx ** 2 + h.vy ** 2), P0 = P();
      const hit = muAtomScatter(o, -0.5, 0), E1 = o.KE + 0.5 * h.m * (h.vx ** 2 + h.vy ** 2), P1 = P();
      W.ultra = false;
      return { hit, dE: Math.abs(E1 - E0), dP: Math.hypot(P1[0] - P0[0], P1[1] - P0[1]), KE: +o.KE.toFixed(3) };
    };
    out.normal = pass(false, 0.1); out.ultraMiss = pass(true, 0.1); out.ultraHit = pass(true, 0.003);
    loadPreset('empty'); setRunning(false); baseWorld(40, 28, 20, 0.05); W.slowmo = false; W.decayOn = false;
    for (let i = 0; i < 150; i++) addMolecule('H2', -19 + (i % 15) * 2.6, -13 + Math.floor(i / 15) * 2.7, i, 20);
    settleOverlaps(); forcesNoEvents(); W.fSpawn = W.spawned; W.count.muScat = 0;
    const os = []; for (let i = 0; i < 10; i++) os.push(fireSpec({ kind: 'exo', sp: 'muP' }, 0, -10 + 2 * i, Math.cos(i), Math.sin(i), 1.0));
    for (let i = 0; i < 4000; i++) { if (W.fSpawn !== W.spawned) { forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = chooseDt(); step(W.dt); }
    const ke = os.filter(o => !o.dead).map(o => o.KE); out.gasKE = +(ke.reduce((a, b) => a + b, 0) / ke.length).toFixed(4); out.gasScat = W.count.muScat;
    return out;
  });
  check(r71.normal.hit && r71.normal.dE < 1e-9 && r71.normal.dP < 1e-9 && !r71.ultraMiss.hit && r71.ultraHit.hit && r71.ultraHit.dE < 1e-9 && r71.ultraHit.dP < 1e-9 && r71.gasKE < 0.05 && r71.gasScat > 10,
    `1.12: μp scattering off H: a pass 0.1 Å off scatters in normal play, not in ultra-realistic (0.003 Å off does), each exact (ΔE ${r71.normal.dE.toExponential(0)} eV); 10 μp at 1 eV in H₂ at 20 K: ${r71.gasScat} scatterings, mean ${r71.gasKE} eV`, '1.12 muonic scattering: ' + JSON.stringify(r71));
  // 3-D (stage 1a): the engine in three directions, in the Node harness (nothing draws it yet)
  const r3d = (() => {
    const L3 = (seed) => require('./load.js').load('all', { seed }), out = {};
    const run = (X, n, cap) => { const W = X.W; for (let s = 0; s < n; s++) { W.dt = cap ? Math.min(cap, X.chooseDt()) : X.chooseDt(); X.step(W.dt); } };
    const books = (X) => X.totalEnergy().total + X.W.ledger.bath - X.W.ledger.nuc;
    const ang = (c, a, b) => { const ux = a.x - c.x, uy = a.y - c.y, uz = a.z - c.z, vx = b.x - c.x, vy = b.y - c.y, vz = b.z - c.z; return Math.acos((ux * vx + uy * vy + uz * vz) / Math.hypot(ux, uy, uz) / Math.hypot(vx, vy, vz)) * 180 / Math.PI; };
    const angles = (m) => { const a = []; for (const p of m) if (p.Z > 1 && p.bonds.length >= 2) { const nb = p.bonds.map(bd => bd.a === p ? bd.b : bd.a); for (let i = 0; i < nb.length; i++) for (let j = i + 1; j < nb.length; j++) a.push(ang(p, nb[i], nb[j])); } return a; };
    const plane = (ps) => { // rms distance from the best plane: the smallest eigenvalue of the positions' covariance (Jacobi)
      const n = ps.length, c = [0, 0, 0]; for (const p of ps) { c[0] += p.x / n; c[1] += p.y / n; c[2] += p.z / n; }
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const p of ps) { const d = [p.x - c[0], p.y - c[1], p.z - c[2]]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) A[i][j] += d[i] * d[j]; }
      for (let sw = 0; sw < 50; sw++) for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) { if (Math.abs(A[p][q]) < 1e-15) continue; const th = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]), cs = Math.cos(th), sn = Math.sin(th);
        for (let k = 0; k < 3; k++) { const a = A[k][p], b = A[k][q]; A[k][p] = cs * a - sn * b; A[k][q] = sn * a + cs * b; } for (let k = 0; k < 3; k++) { const a = A[p][k], b = A[q][k]; A[p][k] = cs * a - sn * b; A[q][k] = sn * a + cs * b; } }
      return Math.sqrt(Math.max(0, Math.min(A[0][0], A[1][1], A[2][2])) / n);
    };
    // shapes: placed flat from the library, relaxed in space at T ≈ 0 (a strong bath at 1 K)
    { const X = L3(5), W = X.W; X.baseWorld(40, 40, 1, 0.5); X.world3d(40);
      const keys = ['CH4', 'NH3', 'H2O', 'CO2', 'C2H4', 'benzene'], m = {};
      keys.forEach((k, i) => { m[k] = X.addMolecule(k, -14 + (i % 3) * 14, -8 + Math.floor(i / 3) * 16, 0, 1, i % 2 ? 6 : -6); });
      X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned; run(X, 3000);
      const span = (a) => [+Math.min(...a).toFixed(2), +Math.max(...a).toFixed(2)];
      const nh = m.NH3, N = nh.find(p => p.Z === 7), [a, b, c] = nh.filter(p => p.Z === 1);
      const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y), ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z), nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      out.shapes = { CH4: span(angles(m.CH4)), NH3: span(angles(m.NH3)), pyr: +Math.abs(((N.x - a.x) * nx + (N.y - a.y) * ny + (N.z - a.z) * nz) / Math.hypot(nx, ny, nz)).toFixed(3),
        H2O: span(angles(m.H2O)), CO2: span(angles(m.CO2)), C2H4: span(angles(m.C2H4)), C2H4flat: +plane(m.C2H4).toFixed(4), benzene: +plane(m.benzene).toFixed(4),
        intact: Object.values(m).every(g => g.every(p => !p.dead)) && W.bonds.length === 4 + 3 + 2 + 2 + 5 + 12 };
    }
    // energy: 60 waters at 300 K in a 18 Å cube, then insulated for 1,000 steps
    { const X = L3(7), W = X.W, L = 18; X.baseWorld(L, L, 300, 0.05); X.world3d(L); let k = 0;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let l = 0; l < 4; l++) if (k++ < 60) X.addMolecule('H2O', (i - 1.5) * L / 4, (j - 1.5) * L / 4, 0, 300, (l - 1.5) * L / 4);
      X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned; run(X, 1000);
      W.gamma = 0; const E0 = books(X); run(X, 1000);
      out.water = { dE: +(books(X) - E0).toFixed(4), T: Math.round(X.measure().T), n: W.parts.length };
    }
    // the forces are the energy's slopes in x, y and z (molecules, ions and a free electron, each atom moved off its place)
    { const X = L3(4), W = X.W; X.baseWorld(24, 24, 300, 0.05); X.world3d(24);
      X.addMolecule('CH4', -6, -6, 0, 300, -3); X.addMolecule('H2O', 0, -6, 0, 300, 3); X.addMolecule('CO2', 6, -6, 0, 300, 0); X.addMolecule('C2H4', -6, 3, 0, 300, 2); X.addMolecule('benzene', 4, 4, 0, 300, -2);
      X.addMolecule('SF4', -8, -1, 0, 300, 7); X.addMolecule('PCl5', 7, -1, 0, 300, -7);
      X.addAtom('Na', -9, 9, { charge: 1, z: 6 }); X.addAtom('Cl', -6.5, 9.5, { charge: -1, z: 7 }); X.addLepton(X.ELEC, 9, -9, 0, 0, 9);
      for (const p of W.parts) { p.x += 0.15 * (X.rnd() - 0.5); p.y += 0.15 * (X.rnd() - 0.5); p.z += 0.15 * (X.rnd() - 0.5); }
      X.forcesNoEvents(); let worst = 0, n = 0; const h = 1e-5;
      for (const p of W.parts) for (const c of ['x', 'y', 'z']) { const F = p['f' + c], x0 = p[c]; p[c] = x0 + h; const Ep = X.totalEnergy().pe; p[c] = x0 - h; const Em = X.totalEnergy().pe; p[c] = x0; worst = Math.max(worst, Math.abs(F + (Ep - Em) / (2 * h))); n++; }
      out.fd = { n, worst: +worst.toExponential(2) };
    }
    // chemistry: hydrogen atoms pair up in a hot box; insulated, the books close through the events
    { const X = L3(11), W = X.W; X.baseWorld(24, 24, 1500, 0.05); X.world3d(24);
      for (let i = 0; i < 60; i++) X.addAtom('H', 22 * (X.rnd() - 0.5), 22 * (X.rnd() - 0.5), { z: 22 * (X.rnd() - 0.5) });
      X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned; run(X, 2000);
      out.H = { H2: W.bonds.length, formed: W.count.bonds };
      const Y = L3(2), V = Y.W; Y.baseWorld(20, 20, 1500, 0); Y.world3d(20);
      for (let i = 0; i < 60; i++) Y.addAtom('H', 18 * (Y.rnd() - 0.5), 18 * (Y.rnd() - 0.5), { z: 18 * (Y.rnd() - 0.5) });
      Y.settleOverlaps(); Y.forcesNoEvents(); V.fSpawn = V.spawned; const E0 = books(Y); run(Y, 3000, 0.01);
      out.Hins = { events: V.count.bonds + V.count.broken, dE: +(books(Y) - E0).toFixed(4), T: Math.round(Y.measure().T) };
    }
    // hydrogen and oxygen at 2,500 K, set off with a spark (as the flat game's setup is): radicals react to OH and on
    { const X = L3(11), W = X.W, T = 2500; X.baseWorld(30, 30, T, 0.05); X.world3d(30); let k = 0;
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) for (let l = 0; l < 4; l++) X.addMolecule(k++ % 3 === 0 ? 'O2' : 'H2', -12 + i * 6 + (X.rnd() - 0.5), -12 + j * 6 + (X.rnd() - 0.5), X.rnd() * 6, T, -10.5 + l * 7);
      X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned; run(X, 200); X.spark(0, 0, 6, 100, 0); run(X, 4000);
      const made = new Set(); for (const p of W.parts) if (!p.dead && p.k === X.NUC && p.Z === 8) made.add(X.hill(X.molecule(p)));
      out.HO = { react: W.count.react, made: [...made].sort() };
    }
    // walls in z: closed walls hold everything inside the depth; periodic ones wrap it
    for (const wall of ['reflect', 'wrap']) {
      const X = L3(6), W = X.W; X.baseWorld(16, 16, 2000, 0); X.world3d(12); W.wall = wall;
      const ps = []; for (let i = 0; i < 40; i++) ps.push(X.addAtom('Ar', 14 * (X.rnd() - 0.5), 14 * (X.rnd() - 0.5), { z: 10 * (X.rnd() - 0.5) }));
      X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned;
      let zmax = 0, wraps = 0; const zl = ps.map(p => p.z);
      for (let s = 0; s < 3000; s++) { W.dt = X.chooseDt(); X.step(W.dt); ps.forEach((p, i) => { zmax = Math.max(zmax, Math.abs(p.z)); if (Math.abs(p.z - zl[i]) > 6) wraps++; zl[i] = p.z; }); }
      out[wall] = { zmax: +zmax.toFixed(3), wraps };
    }
    // the flat game is unchanged: liquid water, seed 3, 300 steps, to the last bit of every position and velocity (1.22.0's)
    { const X = L3(3), W = X.W; X.PRESETS.water.build(); X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned; run(X, 300);
      const f = new Float64Array(1), u = new Uint32Array(f.buffer); let h = 0x811c9dc5;
      for (const p of W.parts) for (const v of [p.x, p.y, p.vx, p.vy]) { f[0] = v; for (const w of u) { h ^= w; h = Math.imul(h, 0x01000193) >>> 0; } }
      out.flat = { hash: h.toString(16), zero: W.parts.every(p => p.z === 0 && p.vz === 0) };
    }
    return out;
  })();
  { const s = r3d.shapes, in2 = (a, lo, hi) => a[0] >= lo && a[1] <= hi;
    check(in2(s.CH4, 108, 111) && in2(s.NH3, 105, 109) && s.pyr > 0.3 && in2(s.H2O, 102.5, 106.5) && s.CO2[0] >= 178 && in2(s.C2H4, 117, 123) && s.C2H4flat < 0.05 && s.benzene < 0.05 && s.intact,
      `3-D (stage 1a): shapes in space from the flat library: H–C–H ${s.CH4.join('–')}°, H–N–H ${s.NH3.join('–')}° (N ${s.pyr} Å off the H₃ plane), water ${s.H2O[0]}°, CO₂ ${s.CO2[0]}°, ethylene ${s.C2H4.join('–')}° and flat to ${s.C2H4flat} Å, benzene flat to ${s.benzene} Å`, '3-D shapes: ' + JSON.stringify(s));
    check(Math.abs(r3d.water.dE) < 0.05 && r3d.fd.worst < 1e-5,
      `3-D (stage 1a): 60 waters at ${r3d.water.T} K insulated for 1,000 steps: books ${r3d.water.dE} eV; forces the energy's slopes in x, y, z to ${r3d.fd.worst} eV/Å (${r3d.fd.n} components)`, '3-D energy and forces: ' + JSON.stringify([r3d.water, r3d.fd]));
    check(r3d.H.H2 >= 5 && r3d.Hins.events >= 5 && Math.abs(r3d.Hins.dE) < 0.02 && r3d.HO.react > 0 && r3d.HO.made.some(f => f === 'HO' || f === 'H₂O'),
      `3-D (stage 1a): chemistry: ${r3d.H.H2} H₂ from hot H atoms; insulated, ${r3d.Hins.events} bond events with the books at ${r3d.Hins.dE} eV; H₂ + O₂ at 2,500 K sparked: ${r3d.HO.react} reactions, made ${r3d.HO.made.join(' ')}`, '3-D chemistry: ' + JSON.stringify([r3d.H, r3d.Hins, r3d.HO]));
    check(r3d.reflect.zmax < 6.5 && r3d.wrap.zmax <= 6 && r3d.wrap.wraps > 0 && r3d.flat.hash === '40ceab5a' && r3d.flat.zero,
      `3-D (stage 1a): z within the 12 Å depth (closed walls: |z| ≤ ${r3d.reflect.zmax}; periodic: ${r3d.wrap.wraps} wraps); the flat game unchanged to the bit (water, 300 steps: ${r3d.flat.hash})`, '3-D walls / flat: ' + JSON.stringify([r3d.reflect, r3d.wrap, r3d.flat]));
  }
  { const load = (seed, patch) => require('./load.js').load('all', { seed, patch }), { pageFile } = require('./browser');
    // 1.23.1: what froze the page (the owner: spamming atoms with Experimental settings on). Quantum bonds: a calculation's
    // charges that never settle ran 250 iterations, the joiners' relaxation 60 calculations, heavy atoms 9 orbitals each,
    // every bead its own calculation, and the inner steps one more for each electron event; bond orders' relaxation 60
    // passes over the whole world. Each is bounded now. Then the mid-frame mark (a page that died inside a frame is
    // reported at the next start, in the desktop app too) and the Experimental settings back to normal at each start.
    const r231 = (() => {
      const out = {};
      const counted = (X) => { const c = { calls: 0, it: 0, worst: 0 }, f = X.XTB.gfn1Energy; X.XTB.gfn1Energy = (...a) => { const r = f(...a); c.calls++; c.it += r.iterations; c.worst = Math.max(c.worst, r.iterations); return r; }; return c; };
      const spiral = (X, zs, d) => zs.forEach((Z, k) => { const a = k * 2.39996, r = d * Math.sqrt(k + 0.5); X.addAtom(Z, r * Math.cos(a), r * Math.sin(a), { T: 300 }); });
      // ten loose light atoms join quantum bonds: the join's iterations (1.23.0: 60 calculations of 250, 3.7 s each)
      { const X = load(1), W = X.W; X.PRESETS.empty.build(); spiral(X, Array.from({ length: 10 }, (_, i) => [1, 6, 7, 8][i % 4]), 2.2);
        const c = counted(X); const f = X.XTB.gfn1Energy; let over = false;
        X.XTB.gfn1Energy = (...a) => { if (c.it > 2000) { over = true; throw new Error('over the budget'); } return f(...a); }; // (1.23.0 would take minutes: stopped)
        try { X.boSet(2); X.forcesNoEvents(); W.dt = X.chooseDt(); X.step(W.dt); } catch (e) { over = true; }
        out.join = { members: W.parts.filter(p => p.bom).length, calls: c.calls, it: c.it, worst: c.worst, over }; }
      // thirty heavy atoms (270 orbitals; 1.23.0: all took part, 18 s a calculation): none take part
      { const X = load(1), W = X.W; X.PRESETS.empty.build(); spiral(X, Array.from({ length: 30 }, (_, i) => [26, 29, 47, 79, 53][i % 5]), 2.6);
        const c = counted(X), f = X.XTB.gfn1Energy; X.XTB.gfn1Energy = (...a) => { if (c.calls > 0) throw new Error('over the budget'); return f(...a); };
        try { X.boSet(2); X.forcesNoEvents(); } catch (e) { /* (1.23.0: stopped) */ }
        out.heavy = { members: W.parts.filter(p => p.bom).length }; }
      // thirteen waters (104 orbitals): all 39 alone, none with 8 beads (each bead a calculation)
      { const X = load(3), W = X.W; X.PRESETS.empty.build();
        for (let i = 0; i < 13; i++) X.addMolecule('H2O', -6 + (i % 4) * 3.2, -5 + Math.floor(i / 4) * 3.4, i, 300);
        for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
        X.settleOverlaps(); X.boSet(2); X.forcesNoEvents(); const alone = W.parts.filter(p => p.bom).length;
        X.piSet(8); W.dirty++; const c = counted(X), f = X.XTB.gfn1Energy; X.XTB.gfn1Energy = (...a) => { if (c.calls > 40) throw new Error('over the budget'); return f(...a); };
        try { X.forcesNoEvents(); W.dt = X.chooseDt(); X.step(W.dt); } catch (e) { /* (1.23.0: stopped) */ }
        out.beads = { alone, beads: W.parts.filter(p => p.bom).length }; }
      // electrons about a hydronium and two waters in quantum bonds: calculations a step (the inner steps' passes held)
      { const X = load(2), W = X.W; X.PRESETS.empty.build();
        X.addMolecule('H3Op', 0, 0, 0, 300); X.addMolecule('H2O', 2.8, 0, 1, 300); X.addMolecule('H2O', -1.4, 2.4, 2, 300);
        for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
        X.settleOverlaps(); X.boSet(2); X.forcesNoEvents(); W.fSpawn = W.spawned;
        for (let i = 0; i < 24; i++) { const a = i * 0.26; X.fireSpec({ kind: 'e' }, 9 * Math.cos(a), 9 * Math.sin(a), -Math.cos(a), -Math.sin(a), 3 + (i % 5)); }
        const c = counted(X);
        for (let i = 0; i < 60; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
        out.inner = { perStep: +(c.calls / 60).toFixed(2), e: W.parts.filter(p => !p.dead && p.k === X.ELEC).length }; }
      // continuous bond orders: 1,200 atoms of water joining at once: the relaxation's force passes (1.23.0: 60, each over everything)
      { let passes = 0; globalThis.__af231 = () => passes++;
        const X = load(4, (s) => s.replace('function forcesNoEvents() {', 'function forcesNoEvents() { if (globalThis.__af231) globalThis.__af231();')), W = X.W;
        X.baseWorld(120, 80, 300, 0.05);
        for (let i = 0; i < 400; i++) X.addMolecule('H2O', -57 + (i % 25) * 4.7, -38 + Math.floor(i / 25) * 4.8, i, 300);
        X.settleOverlaps(); X.forcesNoEvents(); passes = 0; X.boSet(1);
        out.big = { atoms: W.parts.filter(p => !p.dead).length, passes, members: W.parts.filter(p => p.bom).length }; delete globalThis.__af231; }
      return out;
    })();
    // the page: a frame that never ends (as the owner's), the tab closed, the game opened again: the report is offered,
    // in the desktop app too (its heartbeat alone could not tell); a normal reload offers nothing; the Experimental
    // settings start at normal, other settings as saved; a world saved with them opens with normal physics and says so
    const r231b = await (async () => {
      const m = await openPage({ settle: 900, menu: true }), o = {};
      await m.ctx.addInitScript(() => { window.__TAURI__ = { window: { getCurrentWindow: () => ({ setFullscreen: async () => {}, close: async () => {} }) }, core: { invoke: async () => { window.__beats = (window.__beats || 0) + 1; } } }; }); // (as the desktop app)
      await m.page.reload(); await m.page.waitForTimeout(900);
      await m.page.evaluate(() => { hideMainMenu(); loadPreset('soup'); SET.bo = 1; SET.inc = true; SET.rc = 9; SET.fps = false; SET.budget = 16; applySettings(); store('settings', JSON.stringify(SET)); setRunning(true); });
      await m.page.waitForTimeout(2300);
      o.beats = await m.page.evaluate(() => { autosave(); const b = window.__beats || 0; simFrame = () => { const t0 = Date.now(); while (Date.now() - t0 < 120000) { /* a frame that never ends */ } return { steps: 0, simAdv: 0, target: 0, slow: 1, fr: 1 }; }; return b; });
      await m.page.waitForTimeout(1500); await m.page.close({ runBeforeUnload: false }); // (the hung tab closed)
      const p2 = await m.ctx.newPage(); await p2.goto('file://' + pageFile()); await p2.waitForTimeout(1200);
      Object.assign(o, await p2.evaluate(() => ({ open: !$('crashModal').hidden, title: $('crashTitle').textContent, mid: /middle of a frame/.test($('crashReport').value) && /Experimental: .*bond orders/.test($('crashReport').value) && /In the chamber: \d+ atoms/.test($('crashReport').value), restore: !!document.querySelector('[data-crash=restore]'),
        set: [SET.bo, SET.inc, SET.rc, SET.fps, SET.budget], note: typeof $('expReset') === 'object' && !!$('expReset') && /back to normal each time the game starts/.test($('expReset').textContent) })));
      o.loaded = await p2.evaluate(() => { const b = document.querySelector('[data-crash=restore]'); if (b) b.click(); else restoreAutosave(); return { n: W.parts.filter(p => !p.dead).length, said: W.log.some(l => /Saved with Experimental settings/.test(l.text)), bo: BO.on }; });
      // Continue in the main menu after a restart: the last session's world, not the start setup afresh (1.23.0 saved the
      // fresh one over it as the menu opened)
      o.cont = await p2.evaluate(() => { setRunning(false); for (let i = 0; i < 40; i++) addAtom('Ar', -20 + i, 5); autosave(); return W.parts.filter(p => !p.dead).length; }); // (paused: the page saves again as it closes (pagehide), and a running world had changed by then: 73 counted, 74 brought back, 1.26 sweep)
      await p2.reload(); await p2.waitForTimeout(1000);
      o.cont = [o.cont, await p2.evaluate(() => { const b = $('mmCont0'); if (b && !b.hidden) b.click(); else restoreAutosave(); return W.parts.filter(p => !p.dead).length; })];
      await p2.reload(); await p2.waitForTimeout(1000);
      o.clean = await p2.evaluate(() => $('crashModal').hidden);
      await p2.evaluate(() => localStorage.setItem('atomforge.frame.other', '{"f":' + Date.now() + ',"n":5}')); // (another window, inside a frame just now)
      await p2.reload(); await p2.waitForTimeout(1000);
      o.live = await p2.evaluate(() => { const shown = !$('crashModal').hidden; localStorage.removeItem('atomforge.frame.other'); return shown; });
      await m.browser.close(); return o;
    })();
  // an error in the readouts (past the simulation's own catch): the dialog, and Keep going carries on (1.23.0: the frame
  // loop had ended, so nothing moved again)
  const r231c = await page.evaluate(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    loadPreset('soup'); setRunning(true); await wait(300);
    const f = updateReadouts; let once = true; updateReadouts = (...a) => { if (once) { once = false; throw new Error('test ui boom'); } return f(...a); };
    await wait(600); updateReadouts = f;
    const open = !$('crashModal').hidden, b = document.querySelector('[data-crash=go]'); if (b) b.click();
    const t0 = W.t; await wait(800); setRunning(false);
    return { open, moved: W.t > t0 };
  });
  for (let i = errors.length - 1; i >= 0; i--) if (/test ui boom/.test(errors[i])) errors.splice(i, 1); // (thrown on purpose)
  check(r231c.open && r231c.moved, '1.23.1: an error in the readouts opens the dialog, and Keep going carries on (the frame loop goes on)', '1.23.1 frame loop after an error: ' + JSON.stringify(r231c));
  const j = r231.join, pb = r231b;
  check(!j.over && j.members === 10 && j.worst <= 40 && j.it < 600 && r231.heavy.members === 0 && r231.beads.alone === 39 && r231.beads.beads === 0 && r231.inner.perStep < 6 && r231.big.passes <= 32 && r231.big.members === 1200,
    `1.23.1: quantum bonds bounded: ten loose atoms join in ${j.calls} calculations, ${j.it} iterations (1.23.0: 60 of 250); 30 heavy atoms (270 orbitals) and 13 waters with 8 beads stay out (1.23.0: in, 18 s a calculation); with electrons about ${r231.inner.perStep} calculations a step (1.23.0: 15); bond orders: 1,200 atoms join in ${r231.big.passes} force passes (1.23.0: 60)`, '1.23.1 freeze bounds: ' + JSON.stringify(r231));
  check(pb.beats >= 1 && pb.open && /unexpectedly/.test(pb.title) && pb.mid && pb.restore && pb.clean && !pb.live,
    `1.23.1: a frame that never ended (the tab closed while stuck, as the desktop app) is reported at the next start with the Experimental settings and what the chamber held, its autosave offered; a normal reload and a window busy in a frame just now are not`, '1.23.1 mid-frame mark: ' + JSON.stringify(pb));
  check(JSON.stringify(pb.set) === '[0,false,6,false,16]' && pb.note && pb.loaded.said && !pb.loaded.bo && pb.cont[1] === pb.cont[0],
    `1.23.1: the Experimental settings start at normal (other settings kept: ${pb.set.slice(3).join(', ')}); a world saved with them opens with normal physics and says so; Continue after a restart brings back the last session (${pb.cont[1]} particles)`, '1.23.1 Experimental reset, Continue: ' + JSON.stringify(pb));
  }
  // 1.23.2: the checks are in f_1232.js (also runnable alone: node tests/f_1232.js)
  // (1.26: the newest check files run alone in their own process, each with its own page: one process holding every
  // version's checks ran past 3 GB)
  const alone = (file) => new Promise((res) => {
    const cp = require('child_process').spawn(process.execPath, ['--max-old-space-size=3072', require('path').join(__dirname, file)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; cp.stdout.on('data', d => { out += d; }); cp.stderr.on('data', d => { out += d; });
    cp.on('close', (rc) => {
      const lines = out.split('\n').filter(l => l.trim()), last = lines.length ? lines[lines.length - 1] : '';
      for (const l of lines.slice(0, -1)) { if (l.startsWith('FAIL ')) check(false, '', l.slice(5)); else say(l.startsWith('  ') ? l : '  ' + l); }
      check(rc === 0 && /passed/.test(last), last, `${file} alone: rc ${rc}, ${last.slice(0, 300)}`); res();
    });
  });
  await require('./f_1232.js')(page, check, say, openPage);
  // 1.24: the checks are in f_124.js (also runnable alone: node tests/f_124.js [part …])
  await require('./f_124.js')(page, check, say, openPage);
  // 1.25: the checks are in f_125.js (also runnable alone: node tests/f_125.js [part …])
  await require('./f_125.js')(page, check, say, openPage);
  // 1.25 (metals): the checks are in f_125m.js (also runnable alone: node tests/f_125m.js [part …])
  await require('./f_125m.js')(page, check, say, openPage);
  // 1.26 (metals): oxides, hydrides, alloys and directional bonding for the many-body metals: f_126m.js (node tests/f_126m.js [part …])
  await alone('f_126m.js');
  await require('./f_125s.js')(page, check, say, openPage); // 1.25 (Settings by mode, 3-D pictures): f_125s.js, also alone
  // 1.25 (nuclear 3-D): the checks are in f_125n.js (also runnable alone: node tests/f_125n.js [--node] [part …])
  await require('./f_125n.js')(page, check, say, openPage);
  await alone('f_bug125.js'); // (the bug fixes after 1.25: f_bug125.js, also alone)
  await alone('f_126q.js'); // 1.26 (GFN2): f_126q.js, also alone (node tests/f_126q.js [part …])
  await alone('f_126x.js'); // 1.26 (xTB): spin-polarized quantum bonds, GFN2's SCC with radicals; f_126x.js, also alone (node tests/f_126x.js [part …])
  await alone('f_126d.js'); // 1.26 (directional): f_126d.js (lone pairs, σ-holes, π-stacking), also alone: node tests/f_126d.js [part …]
  // 1.26 (speed): the WebAssembly speed-ups' checks are in f_126w.js (also runnable alone: node tests/f_126w.js [part …])
  await alone('f_126w.js');
  await alone('f_cu126.js'); // 1.26 (copper ions): no Cu⁺Cu⁻ pair made inside a metal; f_cu126.js, also alone
  await alone('f_hep126.js'); // 1.26 bug fixes: collisions at extreme energy, muonic atoms, muonium's nucleus (node tests/f_hep126.js [--node] [part …])
  await alone('f_sweep3d.js'); // 1.26 3-D sweep and settings audit
  await alone('f_swx.js'); // 1.26 exotic-particle sweep (node tests/f_swx.js [--node] [part …])
  await alone('f_bug126.js'); // (the bug fix after the 1.26 merge: the spin branch's books; f_bug126.js, also alone)
  await alone('f_bug126e.js'); // 1.26 bug fixes: energy books with fast electrons, decay data (node tests/f_bug126e.js [--node] [part …])
  await alone('f_rp1.js'); // 1.27 realistic particles 1: exotic atoms and the Settings section (node tests/f_rp1.js [--node] [part …])
  await alone('f_rp2.js'); // 1.27 realistic particles 2 and 4: positronium, muonium as hydrogen and μSR (node tests/f_rp2.js [--node] [part …])
  await alone('f_rp5.js'); // 1.27 realistic particles 5 and 6: resonance widths, heavy flavour, nuclear spin, γ lines, neutron cross sections (node tests/f_rp5.js [--node] [part …])
  await alone('f_rp3.js'); // 1.27 realistic particles 3: charged particles in matter (node tests/f_rp3.js [--node] [part …])
  await alone('f_rp7.js'); // 1.27 realistic particles 7: photon polarization, Klein–Nishina Compton angles, Brewster, the polarizer (node tests/f_rp7.js [--node] [part …])
  await alone('f_ew.js'); // 1.27 W and Z bosons: the Z peak, W and Z pairs, Drell–Yan, decays, the LEP setup (node tests/f_ew.js [--node] [part …])
  await alone('f_fix01.js'); // 1.27 bug 1: no ion–water doubling in 3-D (node tests/f_fix01.js [--node] [part …])
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  say(`  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  await browser.close();
  console.log(fails ? `${fails} feature failure(s)` : 'feature checks passed');
  process.exitCode = fails ? 1 : 0;
})();
