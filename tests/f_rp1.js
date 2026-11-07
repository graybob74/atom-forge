'use strict';
/* The checks for 1.27's realistic particles, part 1 (PERF-NOTES, "1.27: realistic particles 1 (exotic atoms) and the
   Settings section"), run by t_features (one line) or alone: node tests/f_rp1.js [--node] [part …]. Each part fails on
   v136 (there is no switch there) and passes here. Parts that need the page are skipped with --node.
   (page: the t_features page; check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const go = (X, n, dt) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = dt ? Math.min(dt, X.chooseDt()) : X.chooseDt(); X.step(W.dt); } };
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;
const fresh = (X, d3) => { const W = X.W; X.PRESETS[d3 ? 'd3empty' : 'empty'].build(); W.T = 0; W.gamma = 0; W.decayOn = false; W.wall = 'reflect'; };
const clear = (X) => { const W = X.W; for (const p of W.parts) X.kill(p); W.parts = []; W.exo = []; W.muBound = []; X.forcesNoEvents(); };

/* With the switch off every setup is as before, bit for bit: the fingerprints (tools/fingerprint.js: seed 7, 300 steps,
   every particle's state and the books) of the setups with muons, pions, kaons and antiprotons, and of water flat and
   in 3-D, equal v136's; and a slow muon is still caught at 2 keV as 0.51 has it (no orbit, no Michel, electrons
   seeing the whole nucleus). */
// (1.27 bug 2: pionbeam, hyperfactory and annihilation re-fingerprinted, switches off: molecules give electrons at their measured ionization energies, from their hole atom)
// (1.27 bug 3: fusion, nif, pionbeam, annihilation and sns re-fingerprinted, switches off: close passes between nuclei turned at nuclear distances)
// (1.27 bug 7: photonuc, sns and hyperfactory re-fingerprinted, switches off: X-rays of 10–100 keV meet atoms by their Compton and photoelectric cross sections; Compton's mₑc² exact)
// (1.27 bug 15: pionbeam and photonuc re-fingerprinted, switches off: events in the electrons' short steps search a grid rebuilt after they moved)
const FP_V136 = { mucf: '26a0e3c4 f1b8b3c8', pionbeam: 'a57d419b a3728514', muonium: '3492138b 4aad8d19', hyperfactory: '39713093 15b24835', annihilation: '792e52ec 54cc0e75', water: 'cac1ac32 a9f2ee3a', water3d: '7a2e7f5c a9f2ee3a' };
PARTS.off = async (page, check, say) => {
  const h = (s) => { let a = 0x811c9dc5; for (let i = 0; i < s.length; i++) { a ^= s.charCodeAt(i); a = Math.imul(a, 0x01000193); } return (a >>> 0).toString(16).padStart(8, '0'); };
  const bad = [];
  for (const k of Object.keys(FP_V136)) {
    const X = load('all', { seed: 7 }), W = X.W, P = X.PRESETS[k];
    if (X.RP.exo !== false) bad.push('RP.exo starts ' + X.RP.exo);
    P.build(); if (X.ultraHold) X.ultraHold(); if (X.mode3dSync) try { X.mode3dSync(); } catch (e) { /* (no page) */ }
    X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned;
    for (let i = 0; i < 300; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
    const parts = W.parts.filter(p => !p.dead).map(p => [p.k, p.Z, p.N, p.ne, p.x, p.y, p.z || 0, p.vx, p.vy, p.vz || 0, p.KE || 0].join(',')).join(';');
    const exo = W.exo.filter(o => !o.dead).map(o => [o.sp, o.x, o.y, o.KE].join(',')).join(';');
    const got = h(parts + '|' + exo + '|' + W.bonds.length) + ' ' + h(JSON.stringify(W.ledger));
    if (got !== FP_V136[k]) bad.push(`${k} ${got} (v136 ${FP_V136[k]})`);
  }
  const X = load('all', { seed: 3 }), W = X.W; fresh(X, false);
  const c = X.addAtom('C', 0, 0); c.vx = c.vy = 0; X.forcesNoEvents(); W.fSpawn = W.spawned;
  X.addExo('mu-', 0.5, 0.3, 1500, -1, 0); go(X, 1, 0.002);
  const old = !!c.muB && !c.muB.zx && Math.abs(c.muB.Eb - X.MU_EB(6) * 1e6) < 1e-6 && c.q === 0 && c.el.sym === 'C';
  check(!bad.length && old, `1.27 realistic particles: the Exotic atoms switch off leaves every setup as in v136 (fingerprints of ${Object.keys(FP_V136).join(', ')}), and a slow muon is caught at 2 keV as before`, 'rp1 off: ' + JSON.stringify({ bad, old }));
};

/* The capture and the cascade's lines: a slow μ⁻ beside carbon, lead and hydrogen, flat and 3-D. Measured 2p → 1s: muonic
   carbon 75.25 keV, muonic lead 5.96/5.78 MeV (5.90 at their 2 : 1 mean; a point nucleus would give 14.2), μp 1.898 keV;
   the books exact through the capture (Auger electrons and X-rays equal the binding gained). */
PARTS.lines = async (page, check, say) => {
  const r = {}; let worst = 0;
  for (const d3 of [false, true]) for (const el of ['C', 'Pb', 'H']) {
    const X = load('all', { seed: 3 }), W = X.W; X.RP.exo = true; fresh(X, d3);
    const c = el === 'H' ? X.addMolecule('H2', 0, 0, 0, 0)[0] : X.addAtom(el, 0, 0); for (const p of W.parts) { p.vx = p.vy = p.vz = 0; }
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    const o = X.addExo('mu-', c.x + 0.5, c.y + 0.3, 20, -1, 0, undefined, c.z || 0, 0), E0 = books(X), r0 = W.rays.length;
    go(X, 1, 0.002);
    worst = Math.max(worst, Math.abs(books(X) - E0));
    const top = W.rays.slice(r0).map(q => q.E).sort((a, b) => b - a)[0] || 0;
    r[(d3 ? '3d' : 'flat') + el] = { caught: o.dead, Ka: +(top / 1e3).toFixed(3), muB: el === 'H' ? W.exo.some(q => !q.dead && q.sp === 'muP') : !!(c.muB && c.muB.zx && c.muB.n0 === 14) };
  }
  const ok = (k, want, tol) => r[k].caught && r[k].muB && Math.abs(r[k].Ka - want) < tol;
  const all = ['flat', '3d'].every(m => ok(m + 'C', 75.25, 0.1) && ok(m + 'Pb', 5901, 2) && ok(m + 'H', 1.898, 0.005));
  check(all && worst < 1e-4, `1.27 realistic particles: a slow μ⁻ is caught into n = 14 and cascades, its 2p → 1s line muonic carbon ${r.flatC.Ka} keV (75.25 measured), muonic lead ${r.flatPb.Ka} keV (5,963/5,778), μp ${r.flatH.Ka} keV (1.898), flat and 3-D; books within ${worst.toExponential(1)} eV`, 'rp1 lines: ' + JSON.stringify({ r, worst }));
};

/* Its end: a muonic atom's mean life and capture share in carbon, aluminium and lead (Suzuki, Measday & Roalsvig 1987:
   2,026, 864 and 75.4 ns; capture 8%, 61%, 97%), 120 lone atoms each, flat and 3-D; and the decay electron's Michel
   spectrum (mean 0.70 of its end point, 37 MeV for a free muon). */
PARTS.life = async (page, check, say) => {
  const r = {};
  for (const [el, Z] of [['C', 6], ['Al', 13], ['Pb', 82]]) for (const d3 of [false, true]) {
    const X = load('all', { seed: 11 }), W = X.W; X.RP.exo = true; fresh(X, d3);
    let sum = 0, n = 0, cap = 0, lc = 0, ld = 0;
    for (let k = 0; k < 120; k++) {
      W.decayOn = false;
      const c = X.addAtom(el, 0, 0); c.vx = c.vy = c.vz = 0; X.forcesNoEvents(); W.fSpawn = W.spawned;
      X.xaCatch(X.addExo('mu-', c.x + 0.5, c.y + 0.3, 20, -1, 0, undefined, c.z || 0, 0), c);
      [lc, ld] = X.muRates(Z, c.N); W.decayOn = true; W.warp = 1 / (lc + ld) / (20 * 0.01 * X.PHYS.TU_S); // (a mean life in 20 steps)
      let s = 0; for (; s < 400 && c.muB && !c.dead; s++) { W.dt = 0.01; X.step(0.01); }
      if (!c.muB || c.dead) { sum += s - 0.5; n++; if (c.dead) cap++; }
      clear(X);
    }
    r[el + (d3 ? '3' : '')] = { tau: +(sum / n / 20).toFixed(3), cap: +(cap / n).toFixed(2), want: +(lc / (lc + ld)).toFixed(2), n };
  }
  const X = load('all', { seed: 5 }); let sE = 0; const N = 2000;
  for (let k = 0; k < N; k++) sE += X.xaMichel(X.MU_M - 0.1)[0][0];
  const eMean = sE / N, sig = 3 / Math.sqrt(120);
  const okL = Object.values(r).every(v => v.n === 120 && Math.abs(v.tau - 1) < sig && Math.abs(v.cap - v.want) < 3 * Math.sqrt(v.want * (1 - v.want) / 120) + 0.02);
  check(okL && Math.abs(eMean - 36.9) < 0.8, `1.27 realistic particles: muonic atoms live as measured (C ${r.C.tau}, Al ${r.Al.tau}, Pb ${r.Pb.tau} mean lives, ±${sig.toFixed(2)}; captured ${r.C.cap}/${r.Al.cap}/${r.Pb.cap}, measured ${r.C.want}/${r.Al.want}/${r.Pb.want}; 3-D alike); the decay electron's Michel spectrum, mean ${eMean.toFixed(1)} MeV (36.9)`, 'rp1 life: ' + JSON.stringify({ r, eMean }));
};

/* Pions and kaons: a slow π⁻ in carbon cascades to 1s (pionic carbon 2p → 1s 99 keV, Bohr's) and is absorbed, the nucleus
   breaking up (a star: at least three pieces); in hydrogen π⁻p → π⁰n or γn, the Panofsky ratio 1.5 (300 tries); a K⁻ in
   carbon cascades to 2p (kaonic carbon 3d → 2p 62.9 keV) and makes a Λ (or a hypernucleus). Books exact, flat and 3-D. */
PARTS.hadrons = async (page, check, say) => {
  const r = { star: 0, starN: 0, piKa: 0, kKa: 0, lam: 0, worst: 0, pi0: 0, g: 0 };
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 5 }), W = X.W; X.RP.exo = true;
    for (let k = 0; k < 8; k++) for (const sp of ['pi-', 'K-']) {
      fresh(X, d3); const c = X.addAtom('C', 0, 0); c.vx = c.vy = c.vz = 0; X.forcesNoEvents(); W.fSpawn = W.spawned;
      X.addExo(sp, 0.5, 0.3, 20, -1, 0, undefined, 0, 0); const E0 = books(X), r0 = W.rays.length; go(X, 1, 0.002);
      r.worst = Math.max(r.worst, Math.abs(books(X) - E0));
      const Es = W.rays.slice(r0).map(q => q.E / 1e3);
      if (sp === 'pi-') { const pieces = W.parts.filter(p => !p.dead && p.k === X.NUC).length; r.starN++; if (pieces >= 3) r.star++; if (Es.some(e => Math.abs(e - 99.1) < 0.2)) r.piKa++; }
      else { if (Es.some(e => Math.abs(e - 62.9) < 0.2)) r.kKa++; if (W.exo.some(o => !o.dead && (o.sp === 'Lam' || o.sp === 'Sig+' || o.sp === 'Sig-' || XP_hyp(X, o.sp)))) r.lam++; } // (a Σ too since features 23, 1.27: Σπ two times in three, the Σ often turned into a Λ)
    }
    for (let k = 0; k < 150; k++) {
      fresh(X, d3); const h = X.addAtom('H', 0, 0); h.vx = h.vy = h.vz = 0; X.forcesNoEvents(); W.fSpawn = W.spawned;
      X.addExo('pi-', 0.5, 0.3, 20, -1, 0, undefined, 0, 0); const E0 = books(X), l0 = W.log.length; go(X, 1, 0.002);
      r.worst = Math.max(r.worst, Math.abs(books(X) - E0));
      const t = W.log.slice(l0).map(l => l.text).join(' ');
      if (/π⁻p → π⁰n/.test(t)) r.pi0++; else if (/π⁻p → nγ/.test(t)) r.g++;
    }
  }
  const P = r.pi0 / Math.max(1, r.g);
  check(r.star >= 0.8 * r.starN && r.piKa === 16 && r.kKa === 16 && r.lam === 16 && r.pi0 + r.g === 300 && Math.abs(P - 1.5) < 0.45 && r.worst < 1e-3,
    `1.27 realistic particles: π⁻ in carbon cascades (99.1 keV 2p → 1s, ${r.piKa}/16) and makes a star (${r.star} of ${r.starN} in three or more pieces); π⁻p → π⁰n : γn = ${P.toFixed(2)} (Panofsky 1.5, 300 tries); K⁻ in carbon cascades (62.9 keV 3d → 2p) and makes a Λ, a Σ or a hypernucleus (${r.lam}/16); books within ${r.worst.toExponential(1)} eV`, 'rp1 hadrons: ' + JSON.stringify(r));
};
const XP_hyp = (X, sp) => !!(X.XP[sp] && X.XP[sp].hyp);

/* Muonic hydrogen passes through atoms and hands its muon to a heavier one beside it: μp + O (water) → muonic oxygen + p,
   into n = 7, cascading to 1s (muonic oxygen 2p → 1s 133.5 keV); the proton flies off with the difference. Flat and 3-D,
   books exact. */
PARTS.transfer = async (page, check, say) => {
  const r = {};
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 4 }), W = X.W; X.RP.exo = true; fresh(X, d3); W.decayOn = true; W.warp = 1e4;
    const w = X.addMolecule('H2O', 0, 0, 0, 0); for (const p of W.parts) { p.vx = p.vy = p.vz = 0; }
    const O = w.find(p => p.Z === 8); X.forcesNoEvents(); W.fSpawn = W.spawned;
    const o = X.addExo('muP', O.x - 3, O.y + 0.2, 0.5, 1, 0, undefined, O.z || 0, 0);
    const E0 = books(X), r0 = W.rays.length; let s = 0, through = 0;
    for (; s < 3000 && !o.dead; s++) { go(X, 1, 0.005); if (!o.dead) for (const p of w) if (Math.hypot(o.x - p.x, o.y - p.y, (o.z || 0) - (p.z || 0)) < 0.6) through++; }
    const p = W.parts.find(q => !q.dead && q.Z === 1 && q.ne === 0 && !w.includes(q));
    r[d3 ? 'd3' : 'flat'] = { moved: !!(O.muB && O.muB.zx && O.muB.from === 'μp'), n0: O.muB ? O.muB.n0 : 0, Ka: W.rays.slice(r0).some(q => Math.abs(q.E - 133530) < 1), proton: p ? +X.keOf(p).toFixed(0) : 0, books: +(books(X) - E0).toExponential(1), steps: s, through };
  }
  const ok = (v) => v.moved && v.n0 === 7 && v.Ka && v.proton > 100 && Math.abs(v.books) < 1e-3;
  check(ok(r.flat) && ok(r.d3), `1.27 realistic particles: μp beside water hands its muon to the oxygen (into n = ${r.flat.n0}, the 133.5 keV line), the proton off with ${r.flat.proton} eV; flat and 3-D, books within ${Math.max(Math.abs(r.flat.books), Math.abs(r.d3.books))} eV`, 'rp1 transfer: ' + JSON.stringify(r));
};

/* An antiproton (the flat game): slow beside hydrogen it forms protonium, cascades (3d → 2p 1.735 keV, the L line) and
   annihilates from 2p; beside carbon an antiprotonic atom. Books exact. */
PARTS.pbar = async (page, check, say) => {
  const r = {};
  for (const el of ['H', 'C']) {
    const X = load('all', { seed: 4 }), W = X.W; X.RP.exo = true; fresh(X, false);
    const h = X.addAtom(el, 0, 0); h.vx = h.vy = 0; const pb = X.addNuc(1, 0, 0, -2, 0, 0, 0, true); pb.vx = 0.5; pb.vy = 0;
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    const E0 = books(X), r0 = W.rays.length, l0 = W.log.length; let s = 0;
    for (; s < 2000 && !pb.dead; s++) go(X, 1, 0.005);
    const t = W.log.slice(l0).map(l => l.text).join(' ');
    r[el] = { gone: pb.dead, L: W.rays.slice(r0).some(q => Math.abs(q.E - 1735) < 2), text: el === 'H' ? /Protonium \(p̄p\)/.test(t) : /Antiprotonic carbon/.test(t), mesons: /π/.test(t), books: +(books(X) - E0).toExponential(1) };
  }
  check(r.H.gone && r.H.L && r.H.text && r.H.mesons && r.C.gone && r.C.text && Math.abs(r.H.books) < 1e-3 && Math.abs(r.C.books) < 1e-3, `1.27 realistic particles: a slow p̄ beside hydrogen makes protonium, which cascades (its 1.735 keV L line) and annihilates into pions; beside carbon an antiprotonic atom; books within ${Math.max(Math.abs(r.H.books), Math.abs(r.C.books))} eV`, 'rp1 pbar: ' + JSON.stringify(r));
};

/* Chemistry: a muonic carbon's electrons see Z − 1, so it is to the outside a boron atom (valence 3, capacity 3, boron's
   ionization energy 8.30 eV, its mass carbon's and the muon's), named μC; with the muon gone (decay in orbit) it is carbon
   again, its books exact through both. */
PARTS.chem = async (page, check, say) => {
  const X = load('all', { seed: 4 }), W = X.W; X.RP.exo = true; fresh(X, false);
  const c = X.addAtom('C', 0, 0); c.vx = c.vy = 0; X.forcesNoEvents(); W.fSpawn = W.spawned;
  X.xaCatch(X.addExo('mu-', 0.5, 0.3, 20, -1, 0), c);
  for (const p of W.parts.slice()) if (p.k === X.ELEC) X.kill(p);
  c.ne = 5; X.refresh(c); X.forcesNoEvents(); W.fSpawn = W.spawned;
  const r = { el: c.el.sym, val: c.val, cap: c.cap, q: c.q, ie: +X.ionizationCost(c).toFixed(2), lab: X.speciesLabel(c), m: +(c.m - 12.0).toFixed(3) };
  const E0 = books(X); W.decayOn = true; W.warp = 1e12; let s = 0; for (; s < 400 && c.muB; s++) { W.dt = 0.01; X.step(0.01); }
  r.after = c.dead ? 'captured' : `${c.el.sym} q ${c.q} cap ${c.cap}`; r.books = +(books(X) - E0).toExponential(1);
  check(r.el === 'B' && r.val === 3 && r.cap === 3 && r.q === 0 && r.ie === 8.3 && r.lab === 'μC' && r.m > 0.1 && (r.after === 'captured' || /^C q 1 cap/.test(r.after)) && Math.abs(r.books) < 1,
    `1.27 realistic particles: muonic carbon is to the outside boron (valence ${r.val}, ionization ${r.ie} eV, charge ${r.q}, named ${r.lab}, ${r.m} u over carbon-12); after its muon decays: ${r.after}; books ${r.books} eV`, 'rp1 chem: ' + JSON.stringify(r));
};

/* A muon fired at 1.5 keV into liquid water (insulated): it slows by ionizing until it is caught (below 30 eV), by
   oxygen or hydrogen; in 3-D the books keep within an eV over the run (the flat game's ionized water is the known limit of
   a few eV a picosecond). */
PARTS.flow = async (page, check, say) => {
  const r = {};
  for (const [k, seed] of [['water3d', 1], ['water3d', 2], ['water', 1]]) {
    const X = load('all', { seed }), W = X.W; X.RP.exo = true;
    X.PRESETS[k].build(); if (X.ultraHold) X.ultraHold(); X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned; W.gamma = 0;
    const o = X.addExo('mu-', -W.box.w / 2 + 2, 0.3, 1500, 1, 0, undefined, 0, 0), E0 = books(X), l0 = W.log.length;
    let s = 0; for (; s < 600 && !o.dead; s++) go(X, 1);
    const t = W.log.slice(l0).map(l => l.text).find(x => /^Muonic atom/.test(x)) || '';
    r[k + seed] = { caught: !!t, KE: +o.KE.toFixed(1), books: +(books(X) - E0).toFixed(3), steps: s };
  }
  check(Object.values(r).every(v => v.caught && v.KE < 30) && Math.abs(r.water3d1.books) < 1 && Math.abs(r.water3d2.books) < 1, `1.27 realistic particles: a 1.5 keV muon in liquid water slows to its capture below 30 eV (flat and 3-D); 3-D books ${r.water3d1.books}, ${r.water3d2.books} eV over the run`, 'rp1 flow: ' + JSON.stringify(r));
};

/* The Settings section (page): Experimental ends with the heading "Realistic particles" and one compact line a part, in
   order Ultra-realistic mode, Electrons as waves, Exotic atoms, each with its cost tag; pointing at a line shows its
   description in the side pane; Ultra-realistic and Electrons as waves still set what they set (their ids, saved values
   and the start-at-normal rule kept); the 3-D lab's note names exotic atoms; at phone width the lines fit. */
PARTS.layout = async (page, check, say, openPage) => {
  const r = await page.evaluate(() => {
    document.querySelectorAll('.modal').forEach(m => { m.hidden = true; });
    loadPreset('empty'); openSettings('exp');
    const pane = document.querySelector('section[data-stab="exp"]'), hs = [...pane.querySelectorAll('h3')], last = hs[hs.length - 1];
    const lines = [...pane.querySelectorAll('.rpl')], ids = lines.map(l => (l.querySelector('[id]') || {}).id);
    const after = []; for (let n = last.nextElementSibling; n; n = n.nextElementSibling) if (n.matches('.rpl')) after.push(n);
    const o = { head: last.textContent, ids, inSection: after.length === lines.length, tags: lines.map(l => !!l.querySelector('.cost-k')), h: lines.map(l => Math.round(l.getBoundingClientRect().height)) };
    o.sw = ['setUltra', 'setRpExo'].map(id => $(id).getAttribute('role') === 'switch');
    setPrevShow('setRpExo', null); o.pane = $('setPrevT').textContent + ' | ' + $('setPrevD').textContent.slice(0, 60);
    $('setUltra').click(); o.ultra = [SET.ultra, W.ultra]; $('setUltra').click(); o.ultra.push(SET.ultra, W.ultra);
    $('segWave').querySelector('[data-v="1"]').click(); o.wave = [SET.wave]; $('segWave').querySelector('[data-v="0"]').click(); o.wave.push(SET.wave);
    $('setRpExo').click(); o.rp = [SET.rpExo, RP.exo]; o.saved = JSON.parse(store('settings')).rpExo; $('setRpExo').click(); o.rp.push(SET.rpExo, RP.exo);
    o.exp = SET_EXP.includes('rpExo') && SET_EXP.includes('ultra') && SET_EXP.includes('wave');
    o.note3 = /exotic atoms/.test($('set3dNote').textContent);
    return o;
  });
  const { browser, page: ph } = await openPage({ viewport: { width: 390, height: 844 }, settle: 600 });
  const narrow = await ph.evaluate(() => { document.querySelectorAll('.modal').forEach(m => { m.hidden = true; }); openSettings('exp'); return [...document.querySelectorAll('#setModal .rpl')].map(l => l.scrollWidth <= l.clientWidth + 1 && l.getBoundingClientRect().right <= innerWidth); });
  await browser.close();
  const ok = r.head === 'Realistic particles' && r.ids.slice(0, 3).join() === 'setUltra,segWave,setRpExo' /* (the later parts' lines follow, 1.27) */ && r.inSection && r.tags.every(Boolean) && r.sw.every(Boolean) && /^Exotic atoms \| A slow μ⁻/.test(r.pane)
    && r.ultra.join() === 'true,true,false,false' && r.wave.join() === '1,0' && r.rp.join() === 'true,true,false,false' && r.saved === true && r.exp && r.note3 && narrow.every(Boolean) && r.h[0] < 34 && r.h[2] < 34;
  check(ok, `1.27 Settings: Experimental → "${r.head}" with one compact line a part (${r.ids.join(', ')}; ${r.h.join('/')} px high), cost tags, switches, the side pane on hover; Ultra-realistic and Electrons as waves still work; fits at phone width`, 'rp1 layout: ' + JSON.stringify({ r, narrow }));
};
PARTS.layout.page = true;

/* A muonic atom made with the switch is a real atom of the box (page, flat and 3-D): Inspect tells its state (n, the lines,
   its mean life, the chemistry), a click with Select picks it, copy and paste, a save read back and an undo keep what it is
   (Z − 1 to the outside, its binding and lines), and a click with Erase takes it. */
PARTS.store = async (page, check, say) => {
  const out = {};
  for (const d3 of [false, true]) {
    const pos = await page.evaluate((d3) => {
      document.querySelectorAll('.modal').forEach(m => { m.hidden = true; });
      setSetting('rpExo', true); loadPreset(d3 ? 'd3empty' : 'empty'); setRunning(false); W.decayOn = false;
      const c = addAtom('C', 2, 1, d3 ? { z: 0 } : undefined); c.vx = c.vy = c.vz = 0; forcesNoEvents(); W.fSpawn = W.spawned;
      xaCatch(addExo('mu-', c.x + 0.4, c.y + 0.2, 20, -1, 0, undefined, c.z, 0), c);
      if (!d3) fitView();
      const cv = $('cv').getBoundingClientRect(), v = [0, 0, 0];
      if (d3) { cam3Update(); proj3(c.x, c.y, c.z, v); } else { v[0] = w2sx(c.x); v[1] = w2sy(c.y); }
      setTool('select'); clearSelection(); window.__c = c;
      return { x: cv.left + v[0], y: cv.top + v[1] };
    }, d3);
    await page.mouse.click(pos.x, pos.y); await page.waitForTimeout(80);
    const a = await page.evaluate(() => {
      const c = window.__c, sig = () => W.parts.filter(p => !p.dead && p.muB).map(p => `${p.Z}:${p.muB.zx}:${p.muB.Eb.toFixed(3)}:${(p.muB.lines || []).length}:${p.el.sym}:${p.q}`).join(' ');
      const o = { picked: R.msel.has(c), s0: sig() };
      R.sel = c; showTab('inspect', true); renderInspect(); const t = $('tp-inspect').textContent; o.inspect = /muonic atom: a μ⁻ in its 1s orbit \(n = 1\)/.test(t) && /Cascade/.test(t) && /75\.3 keV \(2→1\)/.test(t) && /boron/.test(t);
      copySelection(); pasteClip(-4, -3, 0); o.pasted = sig();
      worldFromJSON(JSON.parse(JSON.stringify(worldToJSON()))); o.saved = sig();
      undoMark('Place'); addAtom('H', 6, -5); undoStep(-1); o.undo = sig();
      return o;
    });
    const e = await page.evaluate((d3) => {
      const c = W.parts.find(p => !p.dead && p.muB && p.x > 0); const cv = $('cv').getBoundingClientRect(), v = [0, 0, 0];
      if (d3) { cam3Update(); proj3(c.x, c.y, c.z, v); } else { v[0] = w2sx(c.x); v[1] = w2sy(c.y); }
      setTool('erase'); window.__n = W.parts.filter(p => !p.dead && p.muB).length; return { x: cv.left + v[0], y: cv.top + v[1] };
    }, d3);
    await page.mouse.click(e.x, e.y); await page.waitForTimeout(120);
    a.erased = await page.evaluate(() => window.__n - W.parts.filter(p => !p.dead && p.muB).length);
    out[d3 ? 'd3' : 'flat'] = a;
  }
  await page.evaluate(() => { setSetting('rpExo', false); setTool('inspect'); });
  const ok = (v) => v.picked && v.inspect && v.s0 && v.pasted === v.s0 + ' ' + v.s0 && v.saved === v.pasted && v.undo === v.pasted && v.erased >= 1;
  check(ok(out.flat) && ok(out.d3), `1.27 realistic particles: a muonic carbon is a real atom (Select picks it, Inspect tells its orbit, lines and chemistry, copy, save and undo keep it, Erase takes it), flat and 3-D`, 'rp1 store: ' + JSON.stringify(out));
};
PARTS.store.page = true;

module.exports = async function frp1(page, check, say, openPage, only) {
  if (!openPage) openPage = require('./browser').openPage;
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (rp1 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `rp1 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 realistic particles 1 checks passed');
  process.exitCode = fails ? 1 : 0;
})();
