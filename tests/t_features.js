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
    loadPreset('empty'); W.box.w = W.box.tw = 120; W.box.h = W.box.th = 60; for (let i = 0; i < 12; i++) for (let j = 0; j < 6; j++) addAtom('Ar', -55 + i * 9.5, -25 + j * 9.5);
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
        const tf = getComputedStyle(document.querySelector('.mm-card')).transform; out.depth = MMP.still || (R.cx !== cx0 && +$('mainMenu').style.getPropertyValue('--mx') < -0.5 && tf.startsWith('matrix3d')); }
      document.querySelector('[data-mm="setups"]').click(); out.list = $('mmList').querySelectorAll('button').length;
      document.querySelector('[data-mmp="water"]').click(); await wait(300);
      out.water = !UI.menu && UI.preset === 'water' && getComputedStyle(document.querySelector('.panel')).display !== 'none';
      placeSpec({ kind: 'atom', Z: 11, A: 23 }, 0, 0, 1); const n = W.parts.filter(p => !p.dead).length;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await wait(100); out.esc = !$('escModal').hidden && !UI.running;
      document.querySelector('[data-esc="menu"]').click(); await wait(300); out.back = UI.menu && !$('mmContinue').hidden;
      document.querySelector('[data-mm="continue"]').click(); await wait(300);
      out.cont = !UI.menu && W.parts.filter(p => !p.dead).length === n && UI.preset === 'water';
      return out;
    });
    check(r19.menu && r19.depth && r19.hidden && r19.list > 20 && r19.water && r19.esc && r19.back && r19.cont,
      `menus: the main menu at start over a running setup, its layers following the mouse in depth; ${r19.list} setups to pick from; Esc pauses with its menu; Main menu, then Continue, puts the same ${'chamber'} back`, 'menus: ' + JSON.stringify(r19));
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
    W.simPerFrame = base; W.slow = { t0: W.rt - 0.01, on: true, f: 1 }; const a = slowFactor(1 / 60) * W.simPerFrame;
    W.simPerFrame = base / 16; W.slow = { t0: W.rt - 0.01, on: true, f: 1 }; const b = slowFactor(1 / 60) * W.simPerFrame;
    W.simPerFrame = base; W.slow = null;
    out.ratio = a / b;
    return out;
  });
  check(r31.wait && r31.gap >= 0 && r31.gap < 1e-9 && Math.abs(r31.ratio - 16) < 0.5,
    `0.91: light leaves the prism when its path inside has been crossed (gap ${r31.gap}); automatic slow motion at 1/16× runs ${r31.ratio && r31.ratio.toFixed(1)} times slower than at 1×`, '0.91: ' + JSON.stringify(r31));
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
    loadPreset('empty'); setRunning(false); W.T = 300; W.gamma = 0.05;
    for (let i = 0; i < 6; i++) addMolecule('CO', -10 + i * 4, -6, 0, 300); for (let i = 0; i < 6; i++) addMolecule('O2', -10 + i * 4, 6, 0, 300);
    forcesNoEvents(); W.fSpawn = W.spawned; for (let k = 0; k < 20; k++) { run(300); housekeeping(); }
    out.cold = W.bonds.filter(b => b.order === 3).length;
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
    for (let i = 0; i < 25; i++) stepSpeed(-1); out.spd = $('speedVal').textContent; out.slowestOff = $('bSlower').disabled;
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
    for (let i = 0; i < 25; i++) stepSpeed(-1); out.spd = $('speedVal').textContent;
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
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  say(`  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  await browser.close();
  console.log(fails ? `${fails} feature failure(s)` : 'feature checks passed');
  process.exitCode = fails ? 1 : 0;
})();
