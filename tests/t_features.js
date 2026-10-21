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
  check(r11.first === 'duu' && r11.note && /pion/.test(r11.msg) && r11.back === [...r11.after.toLowerCase()].sort().join('') && r11.lep && r11.same && /In the chamber: p → /.test(r11.msg), `inside a proton: u u d; pulling a u out made ${r11.msg.match(/as a ([^,.]+)/)[1]}, leaving ${r11.after}, in the chamber too (${r11.world}); a muon has no quarks`, 'quark view: ' + JSON.stringify(r11));
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
    let st = null, xs = [];
    for (let f = 0; f < 9000 && xs.length < 5; f++) { // (a jet of only π⁰ and η is gone, as photons, within its frame, and two or three hadrons show no axis: wait for one with five or more still flying)
      simFrame(1 / 60, 30); const ss = W.strings || [], s1 = ss[ss.length - 1];
      if (s1 && s1 !== st) { st = s1; xs = W.exo.filter(o => !o.dead && o.born >= st.t0 - 1e-9); }
    }
    out.jet = st ? { n: xs.length, cos: xs.reduce((t, o) => t + Math.abs(o.ux * st.ax + o.uy * st.ay), 0) / Math.max(1, xs.length) } : null;
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
  check(s.shown && s.n > 50 && s.ne === s.n && s.onLine === s.n && s.cleared === 0 && s.goneOnClear,
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
  // 0.54: Grab keeps up with the mouse in real time (Strong), Gentle is the spring alone; the speed buttons reach 1/256×
  const r16 = await page.evaluate(() => {
    const out = {};
    for (const st of ['gentle', 'strong']) {
      loadPreset('water'); setRunning(false); W.simPerFrame = 0.02; UI.adv = 0.02;
      const p = W.parts.find(q => q.k === NUC && q.Z === 8), g = W.grab = { p, x: p.x + 20, y: p.y, s: st, mol: molecule(p) };
      for (let f = 0; f < 30; f++) { simFrame(1 / 60, 30); UI.running = true; grabTick(1 / 60); UI.running = false; }
      out[st] = Math.hypot(g.x - p.x, g.y - p.y); W.grab = null;
    }
    loadPreset('water'); setRunning(false);
    const h = W.parts.find(q => q.k === NUC && q.Z === 1 && q.bonds.length), o = other(h.bonds[0], h);
    W.grab = { p: h, x: h.x + 2.5 * (h.x - o.x), y: h.y + 2.5 * (h.y - o.y), s: 'strong', mol: null };
    for (let f = 0; f < 20; f++) { simFrame(1 / 60, 30); grabTick(1 / 60); }
    out.torn = !h.bonds.some(b => other(b, h) === o); W.grab = null;
    for (let i = 0; i < 12; i++) stepSpeed(-1);
    out.min = UI.baseSpf / W.simPerFrame;
    for (let i = 0; i < 12; i++) stepSpeed(1);
    return out;
  });
  check(r16.gentle > 15 && r16.strong < 0.5 * r16.gentle && r16.torn && Math.abs(r16.min - 256) < 1e-6,
    `grab: with time slowed 75×, Strong carries a water molecule through the liquid toward a cursor 20 Å off (gap ${r16.strong.toFixed(1)} Å after half a second; Gentle still ${r16.gentle.toFixed(0)} Å behind); a hydrogen carried off tears its O–H bond; the speed buttons go down to 1/${Math.round(r16.min)}×`, 'grab/speed: ' + JSON.stringify(r16));
  // 0.54: nothing about speed tied to the frame rate: a second of watching at 30, 60, 144 or 240 fps advances the same time
  const r17 = await page.evaluate(() => {
    const run = (pre, fps, budget) => { loadPreset(pre); setRunning(true); const t0 = W.t, c0 = W.chipT || 0; for (let f = 0; f < fps / 2; f++) simFrame(1 / fps, budget); setRunning(false); return [W.t - t0, (W.chipT || 0) - c0]; };
    const out = {};
    for (const fps of [30, 60, 144, 240]) { out['w' + fps] = run('water', fps, 1e9)[0]; out['c' + fps] = run('ringosc', fps, 0.01)[1]; } // (chips: with the physics cut short every frame, as in a crowded box)
    return out;
  });
  { const w = [30, 60, 144, 240].map(f => r17['w' + f]), c = [30, 60, 144, 240].map(f => r17['c' + f]), sp = (a) => Math.max(...a) / Math.min(...a);
    check(sp(w) < 1.001 && sp(c) < 1.05, `frame rate: half a second of watching at 30, 60, 144 and 240 fps advances the same simulated time (spread ${((sp(w) - 1) * 100).toFixed(2)}%), and the chips' clock with it when the physics falls behind (${((sp(c) - 1) * 100).toFixed(1)}%)`, 'frame rate: ' + JSON.stringify(r17)); }
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  say(`  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  await browser.close();
  console.log(fails ? `${fails} feature failure(s)` : 'feature checks passed');
  process.exitCode = fails ? 1 : 0;
})();
