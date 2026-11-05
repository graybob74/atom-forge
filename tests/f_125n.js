'use strict';
/* The 1.25 checks for the nuclear side of the particles in 3-D, run by t_features (its "1.25 (nuclear 3-D)" block) or
   alone: node tests/f_125n.js [--node] [part …] (parts: capture, reactions, plasma). Each part fails on 1.24.0. (page: the t_features page;
   check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const go = (X, n, dt) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = dt || X.chooseDt(); X.step(W.dt); } };
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;
/* A small insulated 3-D water box (64 molecules, 18 Å, open walls), settled. */
function water3(X, n = 64) {
  const W = X.W; X.PRESETS.empty.build(); X.setBox(18, 18); X.world3d(18); W.wall = 'open'; W.gamma = 0.05;
  for (let i = 0; i < n; i++) X.addMolecule('H2O', -6 + (i % 4) * 4, -6 + ((i / 4 | 0) % 4) * 4, i, 300, -6 + (i / 16 | 0) * 4);
  go(X, 60); W.gamma = 0; X.forcesNoEvents(); W.fSpawn = W.spawned;
}

/* ---- 1. captures at rest and nuclear hits in 3-D (stage 1): a stopped π⁻, K⁻, μ⁻ is caught in 3-D water as in the flat
   game (1.24: it was left at rest to decay); events exact in energy and in three-vector momentum; a nuclear star
   isotropic and not flat; hadrons in flight meet nuclei; muonic hydrogen fuses (μCF) and muonium forms in depth;
   decays share 3-D phase space (μ → e ν ν: ⟨E_e⟩ = m_μ/3, the flat phase space's m_μ/4) */
PARTS.capture = async (page, check, say) => {
  const pg = page ? await page.evaluate(() => { loadPreset('d3empty'); setRunning(false); return ['muP', 'muD', 'Mu', 'muHe', 'pi-'].map(sp => spec3dOK({ kind: 'exo', sp })).concat([spec3dOK({ kind: 'exo', sp: hypSpecies(6, 6) })]); }) : [true];
  // stepped: slow negative hadrons and muons next to oxygen are caught (decay off: nothing else ends them)
  const stepped = (() => { const X = load('all', { seed: 11 }), W = X.W; water3(X); W.decayOn = false;
    const Os = W.parts.filter(p => p.Z === 8), sps = ['pi-', 'K-', 'mu-', 'Sig-', 'mu+'], got = {};
    sps.forEach((sp, k) => { for (let r = 0; r < 4; r++) { const a = Os[(k * 4 + r) * 3]; X.addExo(sp, a.x + 0.4, a.y, 1500, 1, 0, undefined, a.z, 0); } });
    const n0 = W.log.length; go(X, 12);
    const txt = W.log.slice(n0).map(l => l.text).join('\n');
    for (const [sp, re] of [['pi-', /π⁻ caught by/g], ['K-', /K⁻ \+ /g], ['mu-', /Muonic atom: μ⁻ caught/g], ['Sig-', /Σ⁻ caught by/g], ['mu+', /Muonium: μ⁺ took/g]]) got[sp] = (txt.match(re) || []).length;
    const ev = W.events.filter(e => e.kind === 'capture'), deep = ev.filter(e => Math.abs(e.z) > 0.5).length;
    return { got, ev: ev.length, deep, muAtoms: (W.muAtoms || []).filter(p => !p.dead).length, muZ: (W.muAtoms || []).some(p => !p.dead && Math.abs(p.z) > 0.5) }; })();
  // events between steps: books, three-vector momentum, isotropy, flatness of the stars (π⁻ at rest on oxygen, 40 of them)
  const star = (() => { const X = load('all', { seed: 12, patch: (s) => s.replace('function exoEvent(o, tgs, items, moms, x, y, kind, text, sub', 'function exoEvent(o, tgs, items, moms, x, y, kind, text, sub, ...zz) { if (globalThis.EVH125) EVH125(o, tgs, items, moms); return exoEvent_(o, tgs, items, moms, x, y, kind, text, sub, ...zz); }\nfunction exoEvent_(o, tgs, items, moms, x, y, kind, text, sub') }), W = X.W;
    water3(X); let dp = 0, worst = 0, n = 0; const dirs = [], trip = [];
    globalThis.EVH125 = (o, tgs, items, moms) => {
      let P = X.exoP4(o); for (const t of tgs) if (t.k === X.NUC) P = X.add4(P, X.p4of(t, true));
      let Q = [0, 0, 0, 0], sp = 0; const hv = [];
      items.forEach((it, i) => { if (it.t === 'e') return; const m = moms[i]; Q = X.add4(Q, m); const p = Math.hypot(m[1], m[2], m[3]); sp += p; if (it.t !== 'g' && it.t !== 'v' && p > 1) { hv.push([m[1] / p, m[2] / p, m[3] / p]); dirs.push(hv[hv.length - 1]); } });
      dp = Math.max(dp, Math.hypot(P[1] - Q[1], P[2] - Q[2], P[3] - Q[3]) / Math.max(1, sp));
      if (hv.length >= 4) { const [a, b, c] = hv; trip.push(Math.abs((a[1] * b[2] - a[2] * b[1]) * c[0] + (a[2] * b[0] - a[0] * b[2]) * c[1] + (a[0] * b[1] - a[1] * b[0]) * c[2])); }
    };
    for (let r = 0; r < 40; r++) { const tgs = W.parts.filter(p => !p.dead && p.Z === 8 && p.ne >= 6); const a = tgs[(r * 5) % tgs.length]; const o = X.addExo('pi-', a.x + 0.3, a.y, 1000, 1, 0, undefined, a.z, 0); const b0 = books(X); if (X.hStop(o)) n++; worst = Math.max(worst, Math.abs(books(X) - b0)); if (r % 5 === 4) { X.forcesNoEvents(); W.fSpawn = W.spawned; } }
    globalThis.EVH125 = null;
    const m = (f) => dirs.reduce((s, c) => s + f(c), 0) / dirs.length;
    return { n, books: worst, dp, prods: dirs.length, mean: Math.max(...[0, 1, 2].map(i => Math.abs(m(c => c[i])))), sq: [0, 1, 2].map(i => +m(c => c[i] * c[i]).toFixed(3)), flat: +(trip.reduce((s, v) => s + v, 0) / Math.max(1, trip.length)).toFixed(3), ntrip: trip.length }; })();
  // hadrons in flight meet nuclei in depth: 300 MeV π⁺ through the water box
  const hits = (() => { const X = load('all', { seed: 13 }), W = X.W; water3(X); W.decayOn = false;
    for (let k = 0; k < 30; k++) { const u = X.rdir(); X.addExo('pi+', -u[0] * 8, -u[1] * 8, 3e8, u[0], u[1], undefined, -u[2] * 8, u[2]); }
    go(X, 40); let flat = -1; try { flat = X.PS3.flat; } catch (e) { /* 1.24: no PS3 */ } return { nreact: W.count.nreact || 0, flat }; })();
  // muon-catalysed fusion in 3-D: μ⁻ stopped in a D–T gas (60 D, 60 T atoms, 3-D), decay sped up
  const mucf = (() => { const X = load('all', { seed: 14 }), W = X.W; X.PRESETS.empty.build(); X.setBox(16, 16); X.world3d(16); W.gamma = 0.05;
    for (let i = 0; i < 125; i++) X.addAtom('H', -6 + (i % 5) * 3, -6 + ((i / 5 | 0) % 5) * 3, { A: i % 2 ? 3 : 2, z: -6 + (i / 25 | 0) * 3, T: 30 });
    go(X, 20); W.decayOn = true; W.warp = 1e6;
    for (let k = 0; k < 4; k++) { const a = W.parts[k * 7]; X.addExo('mu-', a.x + 0.3, a.y, 1500, 1, 0, undefined, a.z, 0); }
    go(X, 400); return { fusion: W.count.fusion, muAtoms: W.exo.filter(o => !o.dead && /^mu[PDT]$/.test(o.sp)).length }; })();
  // 3-D phase space: three massless bodies sharing 1 GeV are spread evenly over the Dalitz plot, so m₁₂² < M²/4 for 7/16 of
  // them (0.4375); the flat game's phase space (and 1.24's, turned into a random plane) is even in m₁₂: 1/2
  const ps = (() => { const X = load('all', { seed: 15 }); X.PRESETS.d3empty.build(); let lo = 0; const N = 4000;
    for (let k = 0; k < N; k++) { const v = X.phaseSpace(1000, [0, 0, 0]), E = v[0][0] + v[1][0], px = v[0][1] + v[1][1], py = v[0][2] + v[1][2], pz = (v[0][3] || 0) + (v[1][3] || 0); if (E * E - px * px - py * py - pz * pz < 250000) lo++; }
    return { frac: +(lo / N).toFixed(3) }; })();
  say('  1.25 captures and hits in 3-D: ' + JSON.stringify({ pg, stepped, star, hits, mucf, ps }));
  const g = stepped.got;
  check(pg.every(Boolean) && g['pi-'] >= 3 && g['K-'] >= 3 && g['mu-'] >= 3 && g['Sig-'] >= 3 && g['mu+'] >= 1 && stepped.deep > 0 && stepped.muZ &&
    star.n === 40 && star.books < 1e-3 && star.dp < 1e-12 && star.mean < 0.08 && star.sq.every(v => Math.abs(v - 1 / 3) < 0.07) && star.flat > 0.2 &&
    hits.nreact >= 1 && hits.flat === 0 && mucf.fusion >= 1 && Math.abs(ps.frac - 0.4375) < 0.03,
    `1.25: captures at rest in 3-D water: π⁻ ${g['pi-']}, K⁻ ${g['K-']}, μ⁻ ${g['mu-']}, Σ⁻ ${g['Sig-']} of 4 each caught, ${g['mu+']} μ⁺ made muonium (an atom in depth); events at their depth; 40 π⁻ stars: books ${star.books.toExponential(1)} eV, momentum kept to ${star.dp.toExponential(1)} in x, y and z, ${star.prods} prongs isotropic (⟨u²⟩ ${star.sq.join(', ')}), not flat (|u₁·u₂×u₃| ${star.flat}; a flat star 0); 300 MeV π⁺ through water: ${hits.nreact} nuclear reactions; μCF in a 3-D D–T gas: ${mucf.fusion} fusions; three bodies over 3-D phase space: m₁₂² < M²/4 for ${ps.frac} of them (even over the Dalitz plot 0.4375; flat 0.5)`,
    '1.25 captures in 3-D: ' + JSON.stringify({ pg, stepped, star, hits, mucf, ps }));
};

/* ---- 2. nuclear reactions in 3-D (stage 2): radioactive decay, fission, fusion, fast nuclei meeting nuclei, the giant
   dipole resonance, in depth with exact books (1.24: a decay or fission put its products down at z = 0 and turned them in
   the plane; nothing fused or reacted) */
PARTS.reactions = async (page, check, say) => {
  const box = (X) => { const W = X.W; X.PRESETS.empty.build(); X.setBox(30, 30); X.world3d(30); W.wall = 'open'; W.gamma = 0; };
  const clear = (X) => { for (const q of X.W.parts) q.dead = true; X.forcesNoEvents(); };
  const iso = (dirs) => { const m = (f) => dirs.reduce((s, c) => s + f(c), 0) / Math.max(1, dirs.length); return { mean: Math.max(...[0, 1, 2].map(i => Math.abs(m(c => c[i])))), sq: [0, 1, 2].map(i => +m(c => c[i] * c[i]).toFixed(3)) }; };
  const unit = (q) => { const v = Math.hypot(q.vx, q.vy, q.vz); return [q.vx / v, q.vy / v, q.vz / v]; };
  // α decay (²¹⁰Po) and β decay (¹⁴C), one atom at a time, at rest
  const dec = (() => { const X = load('all', { seed: 21 }), W = X.W; box(X); let ba = 0, bb = 0, dp = 0, depth = 0; const dirs = [];
    for (let k = 0; k < 200; k++) { const p = X.addAtom('Po', 0, 0, { A: 210, T: 0 }); p.vx = p.vy = p.vz = 0; const n0 = W.parts.length; X.forcesNoEvents(); W.fSpawn = W.spawned; const b0 = books(X); X.doDecay(p); ba = Math.max(ba, Math.abs(books(X) - b0));
      const a = W.parts.slice(n0).find(q => q.Z === 2 && q.N === 2 && !q.dead); if (a) { dirs.push(unit(a)); const P = [0, 1, 2].map(i => a.m * [a.vx, a.vy, a.vz][i] + p.m * [p.vx, p.vy, p.vz][i]); dp = Math.max(dp, Math.hypot(...P) / (a.m * Math.hypot(a.vx, a.vy, a.vz))); if (Math.abs(a.z) > 0.05) depth++; } clear(X); }
    for (let k = 0; k < 100; k++) { const p = X.addAtom('C', 0, 0, { A: 14, T: 0 }); p.vx = p.vy = p.vz = 0; X.forcesNoEvents(); W.fSpawn = W.spawned; const b0 = books(X); X.doDecay(p); bb = Math.max(bb, Math.abs(books(X) - b0)); clear(X); }
    return { alpha: dirs.length, ba, bb, dp: +dp.toExponential(1), depth, ...iso(dirs) }; })();
  // fission of ²³⁵U by a thermal neutron; D + T fusion at 120 keV
  const fis = (() => { const X = load('all', { seed: 22 }), W = X.W; box(X); let worst = 0, back = 0; const nd = [];
    for (let k = 0; k < 40; k++) { const T = X.addAtom('U', 0, 0, { A: 235, T: 0 }); T.vx = T.vy = T.vz = 0; const nn = X.addNuc(0, 1, 0, -0.3, 0, 0, 0, false, 0); nn.vx = 0.02; nn.vy = nn.vz = 0; const n0 = W.parts.length; X.forcesNoEvents(); W.fSpawn = W.spawned; const b0 = books(X); X.fission(T, nn, 0.025); worst = Math.max(worst, Math.abs(books(X) - b0));
      const made = W.parts.slice(n0).filter(q => !q.dead), fr = made.filter(q => q.Z > 20); if (fr.length === 2) { const a = unit(fr[0]), b = unit(fr[1]); back += a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; } for (const q of made) if (q.Z === 0) nd.push(unit(q)); clear(X); }
    let fused = 0, fb = 0; const fd = [];
    for (let k = 0; k < 4000 && fused < 40; k++) { const d = X.addNuc(1, 1, 0, -0.1, 0, 0, 0, false, 0), t = X.addNuc(1, 2, 0, 0.1, 0, 0, 0, false, 0.05), u = X.rdir(); X.setMotion(d, 1.2e5, u[0], u[1], 0, 0, u[2]); const n0 = W.parts.length; X.forcesNoEvents(); W.fSpawn = W.spawned; const b0 = books(X);
      if (X.tryFusion(d, t, 0.001)) { fused++; fb = Math.max(fb, Math.abs(books(X) - b0)); const n = W.parts.slice(n0).find(q => q.Z === 0 && !q.dead); if (n) fd.push(unit(n)); } clear(X); }
    return { books: worst, back: +(back / 40).toFixed(4), neutrons: nd.length, nIso: iso(nd), fused, fb, fIso: iso(fd) }; })();
  // 50 MeV protons aimed at carbon atoms (a 3-D lattice, 125 atoms): spallation and other reactions; a 13.5 MeV γ on lead
  const fast = (() => { const X = load('all', { seed: 23 }), W = X.W; box(X); for (let i = 0; i < 125; i++) X.addAtom('C', -6 + (i % 5) * 3, -6 + ((i / 5 | 0) % 5) * 3, { z: -6 + (i / 25 | 0) * 3, T: 300 });
    go(X, 20); for (let k = 0; k < 40; k++) { const p = X.addNuc(1, 0, 0, -12, -6 + (k % 5) * 3 + 0.1, 0, 0, false, -6 + (k / 5 | 0) % 5 * 3 + 0.1); X.setMotion(p, 5e7, 1, 0, 0, 0, 0); }
    X.forcesNoEvents(); W.fSpawn = W.spawned; const b0 = books(X); go(X, 30); return { reactions: W.count.nreact || 0, books: +(books(X) - b0).toFixed(2) }; })();
  const gdr = (() => { const X = load('all', { seed: 24 }), W = X.W; box(X); let n = 0, worst = 0, deep = 0;
    for (let k = 0; k < 30; k++) { const p = X.addAtom('Pb', 0, 0, { A: 208, z: 3, T: 0 }); p.vx = p.vy = p.vz = 0; X.forcesNoEvents(); W.fSpawn = W.spawned; const n0 = W.parts.length, b0 = books(X); if (X.photoNuclear(p, 1.35e7, 1, 0, 0)) { n++; worst = Math.max(worst, Math.abs(books(X) - b0 - 1.35e7)); if (W.parts.slice(n0).some(q => q.Z === 0 && Math.abs(q.vz) > 1e-3)) deep++; } clear(X); }
    return { n, worst, deep }; })();
  say('  1.25 nuclear reactions in 3-D: ' + JSON.stringify({ dec, fis, fast, gdr }));
  check(dec.alpha === 200 && dec.ba < 1e-3 && dec.bb < 1e-3 && dec.dp < 0.01 && dec.mean < 0.12 && dec.sq.every(v => Math.abs(v - 1 / 3) < 0.07) && dec.depth > 120 &&
    fis.books < 1e-3 && fis.back < -0.999 && fis.neutrons > 80 && fis.nIso.sq.every(v => Math.abs(v - 1 / 3) < 0.07) && fis.fused === 40 && fis.fb < 1e-3 && fast.reactions >= 5 && Math.abs(fast.books) < 20 && gdr.n >= 20 && gdr.worst < 0.1 && gdr.deep >= 10,
    `1.25: nuclear reactions in 3-D: α decay of ²¹⁰Po (200): books ${dec.ba.toExponential(1)} eV, α against the daughter's recoil to ${dec.dp} (the shaken-off electrons), α directions isotropic (⟨u²⟩ ${dec.sq.join(', ')}); β decay of ¹⁴C: books ${dec.bb.toExponential(1)} eV; ²³⁵U fission (40): books ${fis.books.toExponential(1)} eV, fragments back to back (cos ${fis.back}), ${fis.neutrons} neutrons isotropic (⟨u²⟩ ${fis.nIso.sq.join(', ')}); D + T at 120 keV: ${fis.fused} fusions, books ${fis.fb.toExponential(1)} eV; 50 MeV protons on carbon: ${fast.reactions} reactions, books ${fast.books} eV; 13.5 MeV γ on ²⁰⁸Pb: ${gdr.n} of 30 photonuclear, books ${gdr.worst.toExponential(1)} eV`,
    '1.25 reactions in 3-D: ' + JSON.stringify({ dec, fis, fast, gdr }));
};

/* ---- 3. the quark–gluon plasma in 3-D (stage 4): a ²⁰⁸Pb at 200 GeV a nucleon meeting a lead atom in depth melts the
   overlap into a plasma that freezes out into hadrons flying in three directions (1.24: no nuclear reactions in 3-D) */
PARTS.plasma = async (page, check, say) => {
  const r = (() => { const X = load('all', { seed: 31 }), W = X.W; X.PRESETS.empty.build(); X.setBox(40, 40); X.world3d(40); W.wall = 'open'; W.gamma = 0;
    let out = null;
    for (let k = 0; k < 20 && !out; k++) {
      for (const q of W.parts) q.dead = true; W.exo.length = 0; W.qgp = []; X.forcesNoEvents();
      const tg = X.addAtom('Pb', 0, 0, { A: 208, z: 2.5, T: 0 }); tg.vx = tg.vy = tg.vz = 0;
      const p = X.addNuc(82, 126, 0, -0.5, 0.0005, 0, 0, false, 2.5); X.setMotion(p, 208 * 200e9, 1, 0, 0, 0, 0);
      X.forcesNoEvents(); W.fSpawn = W.spawned; const b0 = books(X), t0 = Date.now();
      X.nuclearEncounter(p, tg, 0.05, tg.x, tg.y, tg.z);
      if (W.qgp.length) { const ex = W.exo.filter(o => !o.dead), m2 = (f) => ex.reduce((s, o) => s + f(o) ** 2, 0) / ex.length;
        out = { tries: k + 1, books: books(X) - b0, ms: Date.now() - t0, hadrons: W.qgp[0].n, z: W.qgp[0].z, exo: ex.length, uy2: +m2(o => o.uy).toFixed(4), uz2: +m2(o => o.uz).toFixed(4) }; }
    }
    return out || { none: true }; })();
  say('  1.25 plasma in 3-D: ' + JSON.stringify(r));
  check(!r.none && Math.abs(r.books) < 0.5 && r.hadrons > 500 && r.z === 2.5 && r.exo > 300 && r.uz2 > 0.005 && Math.abs(r.uy2 - r.uz2) < 0.4 * r.uy2,
    `1.25: quark–gluon plasma in 3-D: ²⁰⁸Pb at 200 GeV a nucleon on lead → a plasma at the target's depth freezing into ${r.hadrons} hadrons (${r.exo} unstable ones in flight), round the beam in both directions across it (⟨u_y²⟩ ${r.uy2}, ⟨u_z²⟩ ${r.uz2}), books ${r.books !== undefined ? r.books.toExponential(1) : '?'} eV, ${r.ms} ms`, '1.25 plasma in 3-D: ' + JSON.stringify(r));
};

module.exports = async function f125n(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.25 (nuclear 3-D) ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  const args = process.argv.slice(2), noPage = args.includes('--node');
  let browser = null, page = null, errors = [];
  if (!noPage) { const { openPage } = require('./browser'); ({ browser, page, errors } = await openPage({ settle: 800 })); }
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(page, check, say, null, args.filter(a => a !== '--node'));
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  if (browser) await browser.close();
  console.log(fails ? `${fails} failure(s)` : '1.25 (nuclear 3-D) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
