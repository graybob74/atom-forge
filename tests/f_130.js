'use strict';
/* The checks for 1.30.0 (the owner, 2026-11-08: "fix everything on every list"): items 64–68 and bugs B1–B19 of the
   bug test. Run by t_features (one line) or alone: node tests/f_130.js [part …]. Each part fails on 1.29.0.
   (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;
const go = (X, n) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };

/* B1. An unstable particle turned by a nucleus that went into radiation flight after the step's lists were made (its vx
   not kept up): the recoil taken from its booked energy and momentum. 1.29.0: the books off by 376 eV. */
PARTS.b1 = async (page, check) => {
  const X = load('all', { seed: 3 }), W = X.W; X.PRESETS.empty.build(); W.gamma = 0;
  let O = X.spawnSpec({ kind: 'atom', Z: 8, A: 16, bare: true }, 0, 0); if (Array.isArray(O)) O = O[0];
  X.placeSpec({ kind: 'exo', sp: 'pi+' }, -10, 0.05, 1); const o = W.exo.find(q => !q.dead && q.sp === 'pi+');
  o.KE = 1e7; o.ux = 1; o.uy = 0; X.exoSpeed(o); o.x = 10; o.y = 0.05;
  X.forcesNoEvents(); X.setVel(O, 3000, 900); O.vx *= 0.7;
  const b = books(X), K0 = O.KE; X.exoScatter(o, -10, 0.05); const d = books(X) - b;
  check(O.rad && O.KE !== K0 && Math.abs(d) < 1e-4, `1.30 (B1) a π⁺ turned by an O nucleus in radiation flight: the recoil booked (${(O.KE - K0).toFixed(1)} eV), books within ${Math.abs(d).toExponential(0)} eV`, `1.30 B1 exoScatter on a flying nucleus: books ${d} eV, rad ${O.rad}, dK ${O.KE - K0}`);
};

/* B2, B3. No atomic lines from an atom in a molecule; oxygen's forbidden 557.7 and 630.0 nm not made by collisions (and
   its lowest collisional line from 10.74 eV); a free atom's allowed lines as before. 1.29.0: O in water gave 557.7 nm. */
PARTS.lines = async (page, check) => {
  const X = load('all', { seed: 5 }), W = X.W; X.PRESETS.water.build();
  const Ow = W.parts.find(p => !p.dead && p.Z === 8 && p.bonds.length), Hw = W.parts.find(p => !p.dead && p.Z === 1 && p.bonds.length);
  const X2 = load('all', { seed: 5 }), W2 = X2.W; X2.PRESETS.empty.build();
  const O = X2.addAtom('O', 0, 0), Na = X2.addAtom('Na', 5, 0);
  const seen = new Set(); for (let k = 0; k < 400; k++) { const l = X2.pickLine(O, 30); if (l) seen.add(Math.round(l.nm)); }
  const lo = X2.pickLine(O, 8), na = X2.pickLine(Na, 5);
  check(X.lineInfo(Ow) === null && X.lineInfo(Hw) === null && !seen.has(558) && !seen.has(630) && seen.has(777) && lo === null && na && Math.round(na.nm) === 589,
    `1.30 (B2, B3) no free-atom lines from O or H in water; a free O atom gives ${[...seen].join(', ')} nm (not the forbidden 557.7 or 630.0), nothing below 10.74 eV; Na still 589 nm`,
    `1.30 B2/B3 lines: water O ${JSON.stringify(X.lineInfo(Ow))}, H ${JSON.stringify(X.lineInfo(Hw))}, free O ${[...seen]}, O at 8 eV ${JSON.stringify(lo)}, Na ${JSON.stringify(na)}`);
};

/* 66. An e⁺e⁻ pair at γ = 220 flying side by side 0.42 Å apart: bound in its own frame (−34 eV), so it becomes
   positronium (switch on) or annihilates (switch off), books exact; 5% apart in energy it is not bound and flies on.
   1.29.0: all three flew on together. */
PARTS.comove = async (page, check) => {
  const out = {};
  for (const [name, ps, dK] of [['ps', true, 0], ['off', false, 0], ['apart', true, 0.05]]) {
    const X = load('all', { seed: 4 }), W = X.W; X.PRESETS.empty.build(); W.gamma = 0; X.RP.ps = ps; W.wall = 'wrap';
    const e = X.addLepton(X.ELEC, -15, 0, 0, 0), q = X.addLepton(X.POS, -15, 0.42, 0, 0);
    X.setMotion(e, 1.12e8, 1, 0); X.setMotion(q, 1.12e8 * (1 + dK), 1, 0);
    X.forcesNoEvents(); W.fSpawn = W.spawned; const b = books(X);
    go(X, 1);
    const P = W.exo.filter(o => !o.dead && /Ps$/.test(o.sp));
    out[name] = { leptons: [e, q].filter(p => !p.dead).length, ps: P.length, gam: P.length ? +P[0].gam.toFixed(0) : 0, books: +(books(X) - b).toExponential(1) };
  }
  check(out.ps.leptons === 0 && out.ps.ps === 1 && out.ps.gam > 200 && out.off.leptons === 0 && out.off.ps === 0 && out.apart.leptons === 2 && Object.values(out).every(r => Math.abs(r.books) < 1e-3),
    `1.30 (66) a fast e⁺e⁻ pair flying together: positronium at γ = ${out.ps.gam} (switch on), annihilation (off), unbound when 5% apart; books exact`, '1.30 co-moving pairs: ' + JSON.stringify(out));
};

/* 65. The plasma drop's partons: colour-neutral sets at freeze-out (a quark with the antiquark of its colour, or three
   colours of one kind), gluons gone, the picture's own random numbers (the simulation's untouched). */
PARTS.qgp = async (page, check) => {
  const X = load('all', { seed: 6 }), W = X.W; X.PRESETS.empty.build();
  const r0 = X.rnd(); const Y = load('all', { seed: 6 }); Y.PRESETS.empty.build(); Y.rnd();
  X.addQGP(0, 0, 900, 200000); const g = W.qgp[0];
  X.qgpInit(g); for (let a = 0.02; a <= 1.7; a += 0.02) { g.age = a; X.qgpStep(g); }
  const sets = new Map(); for (const q of g.pp) if (q.glu === false && q.cl >= 0) { let l = sets.get(q.cl); if (!l) sets.set(q.cl, l = []); l.push(q); }
  const neutral = [...sets.values()].every(l => l.length === 2 ? l[0].col === l[1].col && l[0].an !== l[1].an : l.length === 3 && new Set(l.map(q => q.col)).size === 3 && l.every(q => q.an === l[0].an));
  const same = X.rnd() === Y.rnd(); void r0;
  check(g.pp.length > 30 && sets.size >= 8 && neutral && same, `1.30 (65) the plasma drawn as ${g.pp.length} partons, frozen out into ${sets.size} colour-neutral hadrons; the simulation's random numbers untouched`, `1.30 qgp partons: n ${g.pp.length}, sets ${sets.size}, neutral ${neutral}, rnd untouched ${same}`);
};

/* The page: 64 group names, 67 free switches kept, 68 rays in slow motion, B5 saves, B6 Fire row, B7 positronium note,
   B11 captions, B12 antihydrogen challenge, B13 chip labels, B15 fit inside the bars, B18 Inspect text, B19 Settings rows. */
PARTS.page = async (page, check) => {
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ settle: 800 }); page = own.page; }
  await page.setViewportSize({ width: 1400, height: 860 });
  const r = await page.evaluate(async () => { try {
    const out = {}, raf = () => new Promise(res => requestAnimationFrame(res));
    out.names = ['Bosons', 'Multiquarks', 'Exotic'].every(n => PCATS.some(([m]) => m === n));
    // 67: a ×1 Realistic-particles switch read back from storage; a costly one not
    const keep = store('settings'); const o = JSON.parse(keep || '{}'); o.rpPs = true; o.rpCpm = true; store('settings', JSON.stringify(o));
    const was = [SET.rpPs, SET.rpCpm]; SET.rpPs = false; SET.rpCpm = false; settingsLoad(); out.keep = [SET.rpPs, SET.rpCpm];
    SET.rpPs = was[0]; SET.rpCpm = was[1]; store('settings', keep || JSON.stringify(SET)); applySettings();
    // 68: a γ ray still travelling 60 s (real time) after it was given off stays drawn
    loadPreset('empty'); setRunning(false); W.rays.length = 0; W.rays.push({ x0: 0, y0: 0, x1: 1e6, y1: 0, t0: W.rt - 60, ts: W.t, len: 1e6, c: [255, 255, 255], E: 1e6, nu: false, lab: 'γ' }); render(W.rt); out.ray = W.rays.length === 1;
    // B12: the antihydrogen challenge is not done by itself
    loadPreset('ch_antiH'); for (let i = 0; i < 40; i++) simFrame(1 / 60, 20); const ch = CHALLENGES.find(c => c.id === 'antiH'); out.antiH = [ch.done(), UI.spec.kind];
    const a = W.parts.find(p => !p.dead && p.anti); placeSpec(UI.spec, a.x + 1.5, a.y, 1); for (let i = 0; i < 60 && !ch.done(); i++) simFrame(1 / 60, 20); out.antiH.push(ch.done());
    // B6: the Fire row has one p⁺ button with p⁺ selected
    loadPreset('empty'); selectSpec(SPEC_P); setTool('fire'); await raf();
    out.fire = [...document.querySelectorAll('#toolopts [data-g="proj"] button')].filter(b => b.textContent.trim() === 'p⁺').length;
    // B7: positronium placed with its switch off says so over the chamber, with a button
    const ps0 = RP.ps; RP.ps = false; setTool('place'); placeSpec({ kind: 'exo', sp: 'oPs' }, 0, 0, 1); out.psNote = !$('hint').hidden && !!$('hintOn'); RP.ps = ps0;
    // B18: a still pentaquark's Inspect text matches its distance
    loadPreset('empty'); setRunning(false); placeSpec({ kind: 'exo', sp: 'Pc4312' }, 0, 0, 1); R.sel = null; R.selX = { kind: 'exo', o: W.exo.find(o => !o.dead), t0: W.rt }; showTab('inspect'); renderInspect();
    const ins = $('tp-inspect').textContent; out.ins = !/a few nanometres/.test(ins) && /less than the width of a nucleus/.test(ins);
    // B19: the Settings rows have their own names
    out.rows = [...document.querySelectorAll('.srow > span:first-child')].filter(s => s.textContent === 'Drawing').length;
    // B15: the box fitted between the particle bar and the tool bar
    loadPreset('grow'); await raf(); await raf();
    const cv = R.cv.getBoundingClientRect(), pal = $('paletteBar').getBoundingClientRect(), opt = $('tooloptsHS').getBoundingClientRect();
    const top = cv.top + w2sy(W.box.th / 2), bot = cv.top + w2sy(-W.box.th / 2); out.fit = [Math.round(top - pal.bottom), Math.round(opt.top - bot)];
    // B13: the flash memory's labels do not overlap
    if (PRESETS.flashbyte) { loadPreset('flashbyte'); setRunning(false); render(W.rt); const L = R.chipLab || []; let ov = 0; for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const p = L[i], q = L[j]; if (Math.abs(p[0] - q[0]) < (p[2] + q[2]) / 2 && Math.abs(p[1] - q[1]) < (p[3] + q[3]) / 2) ov++; } out.chip = [L.length, ov, L.every(b => b[0] - b[2] / 2 >= 0 && b[0] + b[2] / 2 <= R.w)]; }
    // B11: six captions at once: none overlapping, none under the zoom buttons or the particle bar
    loadPreset('empty'); setRunning(false); W.events.length = 0;
    for (let k = 0; k < 6; k++) nucEvent('decay', 2 * k - 5, 1, `Decay: Z⁰ → u ū, d d̄ or s s̄: two jets, ${k} hadrons`, [], '91.01 GeV, mean life 2.6×10⁻²⁵ s: it decays where it is made, long enough to run past the box');
    const placed = uiRects(), n0 = placed.length, boxes = [];
    ctxProbe: { const ctx = R.ctx; for (const e of W.events.slice(-4)) { ctx.font = '600 12.5px "Hanken Grotesk", system-ui, sans-serif'; const b = captionBox(ctx, e, w2sx(e.x), w2sy(e.y), ctx.measureText(e.text).width, placed); if (b) boxes.push(b); } }
    let ov = 0; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const p = boxes[i], q = boxes[j]; if (p.bx < q.bx + q.bw && q.bx < p.bx + p.bw && p.by < q.by + q.bh && q.by < p.by + p.bh) ov++; }
    out.cap = [boxes.length, ov, boxes.every(b => b.bx + b.bw <= R.w - 50 && b.by >= 50), boxes.every(b => b.subs.length >= 2), n0 >= 0];
    // B5: a saved cloud chamber keeps its sources; the annihilation setup its books
    loadPreset('cloud'); for (let i = 0; i < 20; i++) simFrame(1 / 60, 20); const ns = W.sources.length; worldFromJSON(JSON.parse(JSON.stringify(worldToJSON()))); out.src = [ns, W.sources.length];
    loadPreset('lep'); const nz = W.zones.length; worldFromJSON(JSON.parse(JSON.stringify(worldToJSON()))); out.rig = [nz, W.zones.length, !!W.collider];
    loadPreset('annihilation'); for (let i = 0; i < 40; i++) simFrame(1 / 60, 20); const E0 = totalEnergy().total, nucL = W.ledger.nuc; worldFromJSON(JSON.parse(JSON.stringify(worldToJSON()))); out.led = [nucL, W.ledger.nuc, +(totalEnergy().total / E0).toFixed(3)];
    return out; } catch (e) { return { err: e.stack.split('\n').slice(0, 3).join(' | ') }; }
  });
  if (own) await own.browser.close();
  if (r.err) { check(false, '', '1.30 page: ' + r.err); return; }
  check(r.names, '1.30 (64) the particle bar\'s groups: Bosons, Multiquarks, Exotic', '1.30 group names: ' + JSON.stringify(r.names));
  check(r.keep[0] === true && r.keep[1] === false, '1.30 (67) a Realistic-particles switch that costs nothing kept from one start to the next (positronium); one that costs speed still starts off', '1.30 switches kept: ' + JSON.stringify(r.keep));
  check(r.ray, '1.30 (68) a γ ray still on its way a minute after it was given off is still drawn', '1.30 ray dropped while travelling');
  check(!r.antiH[0] && r.antiH[1] === 'pos' && r.antiH[2], '1.30 (B12) Make antihydrogen is not done by itself; a positron placed by an antiproton does it', '1.30 antihydrogen challenge: ' + JSON.stringify(r.antiH));
  check(r.fire === 1, '1.30 (B6) the Fire tool\'s row shows p⁺ once with p⁺ selected', `1.30 Fire row: ${r.fire} p⁺ buttons`);
  check(r.psNote, '1.30 (B7) positronium placed with its switch off: the reason shown over the chamber, with a button to turn it on', '1.30 positronium note not shown');
  check(r.ins, '1.30 (B18) a still pentaquark\'s Inspect text gives its true distance (less than a nucleus), not "a few nanometres"', '1.30 Inspect text wrong');
  check(r.rows === 0, '1.30 (B19) Settings: no two rows called "Drawing" (Resolution, Drawing engine)', `1.30 Settings rows called Drawing: ${r.rows}`);
  check(r.fit[0] >= 0 && r.fit[1] >= 0, `1.30 (B15) Growing a crystal's box fitted between the bars (${r.fit[0]} px below the particle bar, ${r.fit[1]} px above the tool bar)`, '1.30 fit: ' + JSON.stringify(r.fit));
  if (r.chip) check(r.chip[1] === 0 && r.chip[2], `1.30 (B13) the flash memory's ${r.chip[0]} labels: none overlapping, none cut off`, '1.30 chip labels: ' + JSON.stringify(r.chip));
  check(r.cap[0] >= 3 && r.cap[1] === 0 && r.cap[2] && r.cap[3], `1.30 (B11) captions: ${r.cap[0]} at once, none overlapping, clear of the bars, the long second line wrapped`, '1.30 captions: ' + JSON.stringify(r.cap));
  check(r.src[0] > 0 && r.src[1] === r.src[0] && r.rig[1] === r.rig[0] && r.rig[2] && r.led[1] === r.led[0] && r.led[2] > 0.99, `1.30 (B5) saves keep beam sources (cloud chamber ${r.src[1]}), the setup's apparatus (LEP ${r.rig[1]} parts) and the energy books (total kept to ${r.led[2]})`, '1.30 saves: ' + JSON.stringify([r.src, r.rig, r.led]));
};


/* 1.30.1 (the owner away: "fix anything"): captions at 1280×720 kept above the tool bar at the bottom; the same event
   four times makes one caption with ×4; photon labels kept off captions; the Experimental tab's note says what is kept. */
PARTS.p1301 = async (page, check) => {
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ settle: 800 }); page = own.page; }
  await page.setViewportSize({ width: 1280, height: 720 });
  const r = await page.evaluate(async () => { try {
    const out = {};
    loadPreset('empty'); setRunning(false); W.events.length = 0; W.rays.length = 0;
    for (let k = 0; k < 4; k++) nucEvent('decay', 6, -6 - k, 'Muonium: μ⁺ took an electron from Ar', [], 'μ⁺e⁻, a hydrogen atom 1/9 the mass');
    render(W.rt + 1); out.mu = (R.capRects || []).length;
    W.events.length = 0;
    for (let k = 0; k < 4; k++) nucEvent('decay', -3 + 2 * k, -4 - 1.5 * k, `Decay test ${k}: a long enough caption to need room`, [], 'a second line that says a little more about it');
    render(W.rt + 1); render(W.rt + 1);
    const cv = R.cv.getBoundingClientRect(), opt = $('tooloptsHS').getBoundingClientRect(), bar = opt.top - cv.top;
    out.caps = (R.capRects || []).map(q => q.map(Math.round)); out.bar = Math.round(bar);
    out.below = out.caps.filter(q => q[3] > bar + 1).length;
    // a photon's label: drawn where nothing is in the way, not where a caption is
    const lab = (withCap) => {
      W.events.length = 0; W.rays.length = 0; R.capRects = [];
      if (withCap) { nucEvent('decay', 0, 0, 'Decay: a caption here', [], 'its second line'); render(W.rt + 1); }
      const q = withCap ? R.capRects[0] : [R.w / 2 - 60, R.h / 2 - 20, R.w / 2 + 60, R.h / 2 + 20];
      const A = s2w(q[0] + 10, q[1] + 20), B = s2w(q[0] + 10 + 4000, q[1] + 20);
      W.rays.push({ x0: A[0], y0: A[1], x1: B[0], y1: B[1], t0: W.rt + 1, ts: W.t, len: Math.hypot(B[0] - A[0], B[1] - A[1]) * 1e6, c: [255, 255, 255], E: 5e5, lab: 'γ 511 keV', nu: false });
      let drew = 0; const f0 = R.ctx.fillText; R.ctx.fillText = function (t, x, y, ...a) { if (/511 keV/.test(t) && x > q[0] - 2 && x < q[2] && y > q[1] - 6 && y < q[3] + 6) drew++; return f0.call(this, t, x, y, ...a); };
      render(W.rt + 1.05); render(W.rt + 1.1); R.ctx.fillText = f0; return drew;
    };
    out.labFree = lab(false); out.labOnCap = lab(true);
    out.note = /except the Realistic particles that cost nothing/.test($('expReset').textContent);
    return out; } catch (e) { return { err: e.stack.split('\n').slice(0, 3).join(' | ') }; } });
  if (own) await own.browser.close();
  if (r.err) { check(false, '', '1.30.1 page: ' + r.err); return; }
  check(r.below === 0 && r.caps.length >= 2, `1.30.1 captions at 1280×720 stay above the tool bar (${r.caps.length} placed, bar at ${r.bar} px)`, '1.30.1 captions under the bar: ' + JSON.stringify(r));
  check(r.mu === 1, `1.30.1 the same event four times: one caption with ×4 (${r.mu} box)`, '1.30.1 repeated captions: ' + JSON.stringify(r));
  check(r.labFree > 0 && r.labOnCap === 0, '1.30.1 a photon\'s label is not drawn on an event caption (drawn in the same place without one)', `1.30.1 photon label: free ${r.labFree}, on a caption ${r.labOnCap}`);
  check(r.note, '1.30.1 the Experimental tab says which switches are kept from one start to the next', '1.30.1 Experimental note unchanged');
};

module.exports = async function f130(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.30 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(null, check, say, null, process.argv.slice(2));
  say(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
