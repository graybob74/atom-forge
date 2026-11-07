'use strict';
/* The checks for 1.27's realistic particles, parts 2 and 4 (PERF-NOTES, "1.27: realistic particles 2 and 4 (positronium,
   muonium as hydrogen, μSR)"), run by t_features (one line) or alone: node tests/f_rp2.js [--node] [part …]. Each part
   fails on v141 (there are no switches there) and passes here. Parts that need the page are skipped with --node.
   (page: the t_features page; check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const go = (X, n, dt) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = dt ? Math.min(dt, X.chooseDt()) : X.chooseDt(); X.step(W.dt); } };
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;
const fresh = (X, d3) => { const W = X.W; X.PRESETS[d3 ? 'd3empty' : 'empty'].build(); W.T = 0; W.gamma = 0; W.decayOn = false; W.wall = 'reflect'; };
const isPs = (X, o) => !o.dead && !!X.XP[o.sp].ps;

/* With the switches off every setup is as before, bit for bit (tools/fingerprint.js: seed 7, 300 steps; all 59 setups
   were compared when this was built; here the ones with positrons and muons, and water flat and 3-D, against v141), both
   switches start off, a 10 eV positron at hydrogen still annihilates and muonium is still bound by hydrogen's 13.598 eV. */
// (1.27 bug 2: pionbeam, hyperfactory and annihilation re-fingerprinted, switches off: molecules give electrons at their measured ionization energies, from their hole atom)
const FP_V141 = { annihilation: '792e52ec 54cc0e75', muonium: '3492138b 4aad8d19', pet: 'a5248bff a9f2ee3a', pionbeam: 'a57d419b a3728514', antihydrogen: 'fcbb2bdd ea7b2fcc', water: 'cac1ac32 a9f2ee3a', water3d: '7a2e7f5c a9f2ee3a' };
PARTS.off = async (page, check) => {
  const h = (s) => { let a = 0x811c9dc5; for (let i = 0; i < s.length; i++) { a ^= s.charCodeAt(i); a = Math.imul(a, 0x01000193); } return (a >>> 0).toString(16).padStart(8, '0'); };
  const bad = [];
  for (const k of Object.keys(FP_V141)) {
    const X = load('all', { seed: 7 }), W = X.W, P = X.PRESETS[k];
    if (X.RP.ps !== false || X.RP.mu !== false) bad.push('switches start ' + X.RP.ps + ' ' + X.RP.mu);
    P.build(); if (X.ultraHold) X.ultraHold(); if (X.mode3dSync) try { X.mode3dSync(); } catch (e) { /* (no page) */ }
    X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned;
    for (let i = 0; i < 300; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
    const parts = W.parts.filter(p => !p.dead).map(p => [p.k, p.Z, p.N, p.ne, p.x, p.y, p.z || 0, p.vx, p.vy, p.vz || 0, p.KE || 0].join(',')).join(';');
    const exo = W.exo.filter(o => !o.dead).map(o => [o.sp, o.x, o.y, o.KE].join(',')).join(';');
    const got = h(parts + '|' + exo + '|' + W.bonds.length) + ' ' + h(JSON.stringify(W.ledger));
    if (got !== FP_V141[k]) bad.push(`${k} ${got} (v141 ${FP_V141[k]})`);
  }
  const X = load('all', { seed: 3 }), W = X.W; fresh(X, false);
  X.addAtom('H', 0, 0); for (const p of W.parts) { p.vx = p.vy = 0; }
  const L = X.addLepton(X.POS, -4, 0.15, Math.sqrt(2 * 10 / X.PHYS.ME), 0); X.forcesNoEvents(); W.fSpawn = W.spawned;
  for (let s = 0; s < 400 && !L.dead; s++) go(X, 1, 0.002);
  const mu = X.addMuonium(5, 5, 0, 1, 0), old = W.count.annih === 1 && !W.exo.some(o => isPs(X, o)) && X.ionizationCost(mu) === 13.598 && !mu.spin;
  check(!bad.length && old, `1.27 realistic particles: Positronium and Muonium-as-hydrogen off leave every setup as in v141 (fingerprints of ${Object.keys(FP_V141).join(', ')}), a 10 eV positron at H annihilates, muonium is bound by 13.598 eV`, 'rp2 off: ' + JSON.stringify({ bad, old }));
};

/* Forming: a positron touching hydrogen forms Ps in the Ore gap (10 eV: yes; 2 eV, below 13.6 − 6.8: no, it annihilates),
   at Cl⁻ (bound by 3.6 eV) at 3 eV; a slow free pair (1 eV) binds with a photon, a fast one (30 eV) annihilates. Flat and
   3-D, the books the same as with the switch off (the pair's approach is the same; the event itself exact). */
PARTS.form = async (page, check) => {
  const r = {}; let worst = 0;
  const one = (d3, tgt, E, on, seed) => {
    const X = load('all', { seed }), W = X.W; X.RP.ps = on; fresh(X, d3);
    if (tgt === 'e') X.addLepton(X.ELEC, 0, 0, 0, 0, 0, 0); else if (tgt === 'Cl-') { const A = X.addAtom('Cl', 0, 0); A.ne++; X.refresh(A); } else X.addAtom('H', 0, 0);
    for (const p of W.parts) { p.vx = p.vy = p.vz = 0; }
    const L = X.addLepton(X.POS, -4, 0.15, Math.sqrt(2 * E / X.PHYS.ME), 0, 0, 0); X.forcesNoEvents(); W.fSpawn = W.spawned;
    const E0 = books(X), r0 = W.rays.length;
    for (let s = 0; s < 400 && !L.dead; s++) go(X, 1, 0.002);
    go(X, 5, 0.002);
    const ps = W.exo.find(o => isPs(X, o));
    return { ps: !!ps, KE: ps ? +ps.KE.toFixed(2) : 0, rays: W.rays.slice(r0).map(q => q.E), books: books(X) - E0 };
  };
  for (const d3 of [false, true]) for (const [tgt, E, want] of [['H', 10, 1], ['H', 2, 0], ['Cl-', 3, 1], ['e', 1, 1], ['e', 30, 0]]) {
    const a = one(d3, tgt, E, true, 2), b = one(d3, tgt, E, false, 2);
    worst = Math.max(worst, Math.abs(a.books - b.books));
    r[`${d3 ? '3' : ''}${tgt}${E}`] = a.ps === !!want && (want ? !a.rays.some(e => e > 5e5) : a.rays.some(e => e > 5e5)) ? 1 : 0;
    if (tgt === 'H' && E === 10 && !d3) r.KEH = a.KE; // (10 + 6.80 − 13.60 = 3.2 eV, nearly all to the light Ps)
  }
  const ok = Object.entries(r).filter(([k]) => k !== 'KEH').every(([, v]) => v === 1) && Math.abs(r.KEH - 3.2) < 0.15 && worst < 1e-6;
  check(ok, `1.27 positronium: a positron forms Ps at H in the Ore gap (10 eV: Ps with ${r.KEH} eV; 2 eV: annihilates), at Cl⁻ (3 eV), with a slow free electron (1 eV, a photon takes the rest; 30 eV annihilates), flat and 3-D; books as with the switch off to ${worst.toExponential(1)} eV`, 'rp2 form: ' + JSON.stringify({ r, worst }));
};

/* Spin: para 1 in 4 (400 formed); p-Ps lives 125 ps (MLE over 300, decay sped up 100×) and gives 2 back-to-back γ of 511
   keV; o-Ps gives 3 γ in a plane totalling the Ps's energy exactly, each up to 511 keV, with the Ore–Powell spectrum
   (the photons' spectrum against the matrix element's, which is close to plain phase space's). Flat and 3-D. */
PARTS.decay = async (page, check) => {
  const r = {};
  { const X = load('all', { seed: 9 }), W = X.W; X.RP.ps = true; fresh(X, false); let para = 0; for (let i = 0; i < 400; i++) { const o = X.psMake(0, 0, 0, 1, 0, 0); if (o.sp === 'pPs') para++; o.dead = true; } r.para = para / 400; }
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 2 }), W = X.W; X.RP.ps = true; fresh(X, d3); W.decayOn = true; W.warp = 100;
    const os = []; for (let i = 0; i < 300; i++) os.push(X.addExo('pPs', (X.rnd() - 0.5) * 20, (X.rnd() - 0.5) * 20, 0, 1, 0, undefined, 0, 0));
    const E0 = books(X); let t = 0, sum = 0, n = 0, b2b = 0, e511 = 0; const alive = new Set(os), dt = 0.05;
    for (let s = 0; s < 3000 && alive.size; s++) {
      W.rays = []; W.dt = dt; X.step(dt); t += dt;
      for (const o of [...alive]) if (o.dead) { alive.delete(o); sum += t - dt / 2; n++; }
      const g = W.rays; for (let i = 0; i + 1 < g.length; i += 2) { const a = g[i], b = g[i + 1], la = Math.hypot(a.x1 - a.x0, a.y1 - a.y0, (a.z1 || 0) - (a.z0 || 0)), lb = Math.hypot(b.x1 - b.x0, b.y1 - b.y0, (b.z1 || 0) - (b.z0 || 0)); const c = ((a.x1 - a.x0) * (b.x1 - b.x0) + (a.y1 - a.y0) * (b.y1 - b.y0) + ((a.z1 || 0) - (a.z0 || 0)) * ((b.z1 || 0) - (b.z0 || 0))) / (la * lb); if (c < -0.9999) b2b++; if (Math.abs(a.E - 510998.95 + 3.4) < 0.01 && Math.abs(b.E - a.E) < 0.01) e511++; }
    }
    const tau = (sum + alive.size * t) / n * X.PHYS.TU_S * W.warp * 1e12; // (ps; the censored exponential's MLE)
    r[d3 ? 'p3' : 'p'] = { tau: +tau.toFixed(1), n, b2b, e511, books: +(books(X) - E0).toExponential(1) };
    const Y = load('all', { seed: 3 }), V = Y.W; Y.RP.ps = true; fresh(Y, d3);
    let hi = 0, tot = 0, sumBad = 0, over = 0, flat = 0; const hm = new Array(10).fill(0);
    for (let i = 0; i < 600; i++) {
      const o = Y.addExo('oPs', 0, 0, 0, 1, 0, undefined, 0, 0), Ein = o.KE + o.m * 1e6; V.rays = []; const b0 = books(Y); Y.psDecay(o);
      const g = V.rays; if (g.length !== 3) { sumBad++; continue; }
      if (Math.abs(g.reduce((s, q) => s + q.E, 0) - Ein) > 1e-3 || Math.abs(books(Y) - b0) > 1e-6) sumBad++;
      for (const q of g) { tot++; if (q.E > 0.9 * 510998.95) hi++; if (q.E > 510998.95) over++; hm[Math.min(9, Math.floor(q.E / 51099.895))]++; }
      if (d3) { const v = g.map(q => [q.x1 - q.x0, q.y1 - q.y0, q.z1 - q.z0]), nx = v[0][1] * v[1][2] - v[0][2] * v[1][1], ny = v[0][2] * v[1][0] - v[0][0] * v[1][2], nz = v[0][0] * v[1][1] - v[0][1] * v[1][0], L = Math.hypot(nx, ny, nz) * Math.hypot(...v[2]); if (Math.abs(nx * v[2][0] + ny * v[2][1] + nz * v[2][2]) / L < 1e-3) flat++; } else flat++;
    }
    // the Ore–Powell share above x = 0.9, from its matrix element over the Dalitz triangle
    let wa = 0, wh = 0; const G = 400, hw = new Array(10).fill(0);
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) { const a = (i + 0.5) / G, b = (j + 0.5) / G, c = 2 - a - b; if (a + b < 1) continue; const w = ((1 - a) / (b * c)) ** 2 + ((1 - b) / (a * c)) ** 2 + ((1 - c) / (a * b)) ** 2; wa += w; if (a > 0.9) wh += w; hw[Math.min(9, Math.floor(a * 10))] += w; }
    let chi = 0; for (let k = 0; k < 10; k++) { const e = tot * hw[k] / wa; chi += (hm[k] - e) ** 2 / e; } // (the photons' spectrum against Ore–Powell's, 10 bins: 9 degrees of freedom)
    r[d3 ? 'o3' : 'o'] = { hi: +(hi / tot).toFixed(3), want: +(wh / wa).toFixed(3), chi: +chi.toFixed(1), sumBad, over, plane: flat };
  }
  const okP = (v) => Math.abs(v.tau - 125.14) < 3 * 125 / Math.sqrt(v.n) && v.b2b >= v.n - 2 && v.e511 >= v.n - 2 && Math.abs(v.books) < 1e-4;
  const okO = (v) => v.sumBad === 0 && v.over === 0 && v.plane === 600 && Math.abs(v.hi - v.want) < 0.04 && v.chi < 27.9; // (χ² at the 0.1% level)
  check(Math.abs(r.para - 0.25) < 3 * Math.sqrt(0.25 * 0.75 / 400) && okP(r.p) && okP(r.p3) && okO(r.o) && okO(r.o3),
    `1.27 positronium: para ${r.para} of those formed (1 in 4); p-Ps lives ${r.p.tau} ps flat, ${r.p3.tau} ps 3-D (125.14), 2 γ back to back of 511 keV; o-Ps 3 γ in a plane totalling its energy exactly, each under 511 keV, ${r.o.hi}/${r.o3.hi} above 460 keV (Ore–Powell ${r.o.want}), the spectrum Ore–Powell's (χ² ${r.o.chi}/${r.o3.chi}, 9 bins of freedom)`, 'rp2 decay: ' + JSON.stringify(r));
};

/* In matter: the pick-off life over 600 points inside liquid water, flat (its middle) and 3-D, is water's 1.8 ns (3-D: the
   game's water is 5% less dense than real, 1.9); 40 o-Ps flying in flat water with decay sped up 10⁵× die by pick-off in
   about that (MLE), while in an empty box they keep their 142 ns; among O₂ molecules o-Ps turns into p-Ps at n·σ·v. */
PARTS.matter = async (page, check) => {
  const r = {};
  for (const k of ['water', 'water3d']) {
    const X = load('all', { seed: 4 }), W = X.W; X.RP.ps = true;
    X.PRESETS[k].build(); X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned; W.gamma = 0;
    const o = X.addExo('oPs', 0, 0, 0.04, 1, 0, undefined, 0, 0); let s = 0; const m = W.d3 ? 0 : 6;
    for (let t = 0; t < 600; t++) { o.x = (X.rnd() - 0.5) * (W.box.w - 2 * m); o.y = (X.rnd() - 0.5) * (W.box.h - 2 * m); if (W.d3) o.z = (X.rnd() - 0.5) * W.box.d; s += X.psRates(o).po; }
    r[k] = +(1e9 / (s / 600)).toFixed(2);
    if (W.d3) continue;
    o.dead = true; W.decayOn = true; W.warp = 1e5;
    const os = []; for (let i = 0; i < 40; i++) { const u = X.rdir(); os.push(X.addExo('oPs', (X.rnd() - 0.5) * (W.box.w - 12), (X.rnd() - 0.5) * (W.box.h - 12), 0.04, u[0], u[1])); }
    let t = 0, sum = 0, n = 0; const alive = new Set(os);
    for (let st = 0; st < 1200 && alive.size > 4; st++) { go(X, 1); t += W.dt; for (const q of [...alive]) if (q.dead) { alive.delete(q); sum += t; n++; } }
    r.live = +((sum + alive.size * t) / n * X.PHYS.TU_S * W.warp * 1e9).toFixed(2); r.n = n;
    r.pick = os.filter(q => q.dead && /pick-off/.test(q.fate || '')).length;
  }
  { const X = load('all', { seed: 4 }), W = X.W; X.RP.ps = true; fresh(X, false); W.decayOn = true; W.warp = 1e4;
    const os = []; for (let i = 0; i < 40; i++) { const u = X.rdir(); os.push(X.addExo('oPs', (X.rnd() - 0.5) * 30, (X.rnd() - 0.5) * 30, 0.04, u[0], u[1])); }
    go(X, 400, 0.05); r.vac = os.filter(o => o.dead).length; } // (o-Ps's own 142 ns, 14 ps sped up: about 1 in 70 over these 20 tu)
  { const X = load('all', { seed: 5 }), W = X.W; X.RP.ps = true; fresh(X, false);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) X.addMolecule('O2', -12 + 4.5 * i, -12 + 4.5 * j, 0, 0);
    for (const p of W.parts) { p.vx = p.vy = 0; } X.forcesNoEvents(); W.fSpawn = W.spawned;
    const o = X.addExo('oPs', 0.5, 0.3, 1, 1, 0), R1 = X.psRates(o), v = o.v * 1e-8 / X.PHYS.TU_S;
    r.conv = +R1.conv.toExponential(2); r.want = +(R1.env.o2 * 3.34e22 * 1.5e-19 * v).toExponential(2);
    W.decayOn = true; W.warp = 1e6; let turned = false; for (let s = 0; s < 300 && !o.dead && !turned; s++) { go(X, 1, 0.02); turned = o.sp === 'pPs'; } r.turned = turned; }
  const ok = Math.abs(r.water - 1.8) < 0.18 && Math.abs(r.water3d - 1.9) < 0.15 && r.live > 1 && r.live < 3.5 && r.n >= 30 /* (33 of 40 within the run after the 1.26 energy fixes changed the water's last bits, 36 before) */ && r.pick >= 0.8 * r.n && r.vac <= 4 && r.conv > 0 && Math.abs(r.conv / r.want - 1) < 1e-9 && r.turned;
  check(ok, `1.27 positronium: in water o-Ps's pick-off life is ${r.water} ns flat, ${r.water3d} ns 3-D (1.8 measured); flying in flat water ${r.live} ns (${r.pick} of ${r.n} by pick-off), in vacuum ${r.vac} of 40 gone in the same time; O₂ turns o-Ps to p-Ps (${r.conv} s⁻¹ there)`, 'rp2 matter: ' + JSON.stringify(r));
};

/* Muonium as hydrogen: its mass 0.11398 u (the muon 0.113429 u and its electron), bound by 13.540 eV with the switch
   (13.598 off; turning it on with muonium in the box books the change to the bath exactly); it bonds as H (Mu + Cl₂ →
   MuCl + Cl), and Mu–Cl vibrates 2.94 times faster than H–Cl (√ of the reduced masses' ratio), flat and 3-D. */
PARTS.mu = async (page, check) => {
  const r = {};
  { const X = load('all', { seed: 1 }), W = X.W; fresh(X, false); const m = X.addMuonium(0, 0, 0, 1, 0); m.vx = m.vy = 0;
    X.forcesNoEvents(); r.m = +m.m.toFixed(5); r.off = X.ionizationCost(m); const b0 = books(X) + W.ledger.bath; X.rpMuSet(true); r.on = +X.ionizationCost(m).toFixed(3); r.toggle = +(books(X) + W.ledger.bath - b0).toExponential(1); r.dE = +(books(X) - b0).toFixed(4); X.rpMuSet(false); }
  let made = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const X = load('all', { seed }), W = X.W; fresh(X, false); X.rpMuSet(true); W.T = 300;
    const c = X.addMolecule('Cl2', 0, 0, 0, 0); for (const p of W.parts) { p.vx = p.vy = 0; }
    const m = X.addMuonium(-3, 0.2 * seed - 0.6, 0, 1, 0); m.vx = Math.sqrt(2 * 1 / m.m); m.vy = 0; X.forcesNoEvents(); W.fSpawn = W.spawned;
    for (let s = 0; s < 1500; s++) go(X, 1, 0.005);
    if (m.bonds.length && m.bonds.some(bd => X.other(bd, m).Z === 17) && c.some(p => p.bonds.length === 0)) made++;
  }
  r.MuCl = made;
  for (const d3 of [false, true]) {
    const per = {};
    for (const iso of ['H', 'Mu']) {
      const X = load('all', { seed: 1 }), W = X.W; fresh(X, d3); X.rpMuSet(true);
      const ms = X.addMolecule('HCl', 0, 0, 0, 0), cl = ms.find(p => p.Z === 17), h = ms.find(p => p.Z === 1);
      if (iso === 'Mu') { h.mu = true; X.refresh(h); (W.muAtoms || (W.muAtoms = [])).push(h); }
      for (const p of W.parts) { p.vx = p.vy = p.vz = 0; }
      h.x = cl.x + 1.40; h.y = cl.y; h.z = cl.z; X.forcesNoEvents(); W.fSpawn = W.spawned;
      const rs = []; for (let s = 0; s < 6000; s++) { W.dt = 0.0005; X.step(0.0005); rs.push(Math.hypot(h.x - cl.x, h.y - cl.y, h.z - cl.z)); }
      const mean = rs.reduce((a, b) => a + b) / rs.length, cr = []; for (let i = 1; i < rs.length; i++) if (rs[i - 1] < mean && rs[i] >= mean) cr.push(i);
      per[iso] = (cr[cr.length - 1] - cr[0]) / (cr.length - 1);
    }
    r[d3 ? 'ratio3' : 'ratio'] = +(per.H / per.Mu).toFixed(3);
  }
  const ok = Math.abs(r.m - 0.11398) < 2e-5 && r.off === 13.598 && Math.abs(r.on - 13.540) < 0.002 && Math.abs(r.toggle) < 1e-9 && Math.abs(r.dE - 0.058) < 0.002 && r.MuCl >= 2 && Math.abs(r.ratio - 2.936) < 0.03 && Math.abs(r.ratio3 - 2.936) < 0.03;
  check(ok, `1.27 muonium as hydrogen: ${r.m} u, bound by ${r.on} eV (H 13.598; switching books ${r.dE} eV to the bath exactly), bonds as H (Mu + Cl₂ → MuCl + Cl in ${r.MuCl} of 6), Mu–Cl vibrates ${r.ratio}× (3-D ${r.ratio3}×) faster than H–Cl (2.936)`, 'rp2 mu: ' + JSON.stringify(r));
};

/* μSR: a μ⁺ at rest in 0.01 T turns at 135.54 MHz/T (its spin's angle against 2πγB·t); muonium's triplet at 1.3945 MHz/G
   at 1 G; the decay positron's asymmetry 1/3 (12,000 decays sampled, flat in the plane and 3-D); and a ring of detectors:
   400 μ⁺ at rest in 100 G, their positrons' directions and decay times alone give back the precession frequency (1.355 MHz).
   Books exact through the decays with spin (μ⁺ and muonium, flat and 3-D). */
PARTS.musr = async (page, check) => {
  const r = {}, wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 5 }), W = X.W; fresh(X, d3); X.rpMuSet(true); W.decayOn = true; W.Bz = 0.01; W.warp = 1e3;
    const o = X.addExo('mu+', 0, 0, 0, 1, 0, undefined, 0, 0); let T = 0;
    for (let s = 0; s < 200; s++) { W.dt = 0.05; X.step(0.05); T += 0.05 * X.PHYS.TU_S * W.warp; }
    r[d3 ? 'free3' : 'free'] = +(Math.abs(wrap(Math.atan2(o.spin[1], o.spin[0]) + 2 * Math.PI * 135.5388e6 * 0.01 * T))).toExponential(1);
    const Y = load('all', { seed: 5 }); Y.RP.mu = true; Y.W.d3 = d3; const m = { k: Y.NUC, ne: 1, bonds: [], eSpin: 1 };
    r[d3 ? 'tri3' : 'tri'] = +(Y.muRate(m, 1e-4) / 1e6).toFixed(4); // (MHz at 1 G)
    let c = 0; const N = 12000; for (let i = 0; i < N; i++) { const v = Y.muSpinDecay([1, 0, 0]), p = Math.hypot(v[0][1], v[0][2], d3 ? v[0][3] : 0); c += v[0][1] / p; }
    r[d3 ? 'A3' : 'A'] = +((d3 ? 3 : 2) * c / N).toFixed(3);
  }
  { // the detector ring
    const X = load('all', { seed: 6 }), W = X.W; fresh(X, false); X.rpMuSet(true); W.decayOn = true; W.Bz = 0.01;
    const dt = 0.05; W.warp = 2.197e-6 / (100 * dt * X.PHYS.TU_S);
    const hits = [], E0 = books(X);
    for (let k = 0; k < 4; k++) {
      const born = W.t, mus = []; for (let i = 0; i < 100; i++) mus.push(X.addExo('mu+', (X.rnd() - 0.5) * 20, (X.rnd() - 0.5) * 20, 0, 1, 0));
      const seen = new Set(W.parts);
      for (let s = 0; s < 700; s++) {
        W.dt = dt; X.step(dt);
        for (const p of W.parts) if (!seen.has(p)) { seen.add(p); if (p.k === X.POS) { const ux = p.rad ? p.ux : p.vx, uy = p.rad ? p.uy : p.vy; hits.push([(W.t - born) * X.PHYS.TU_S * W.warp, Math.atan2(uy, ux)]); } }
      }
    }
    r.ringBooks = +(books(X) - E0).toExponential(1);
    let best = 0, bf = 0; for (let f = 0.2e6; f <= 3e6; f += 0.005e6) { let cs = 0, sn = 0; for (const [t, ph] of hits) { cs += Math.cos(ph + 2 * Math.PI * f * t); sn += Math.sin(ph + 2 * Math.PI * f * t); } const a = Math.hypot(cs, sn); if (a > best) { best = a; bf = f; } }
    r.ring = +(bf / 1e6).toFixed(3); r.hits = hits.length; r.ringA = +(2 * best / hits.length).toFixed(2);
  }
  for (const d3 of [false, true]) { // the books of muonium's decays with spin: each decay step exact (what follows, the fast electrons and positrons among the rest, drifts by about an eV over 200 steps, as with the switch off)
    globalThis.__muD = [];
    const X = load('all', { seed: 8, patch: (src) => src.replace('function muoniumTick(dt) {', 'function muoniumTick(dt) { const b0 = totalEnergy().total - W.ledger.nuc; try { return muTick0(dt); } finally { globalThis.__muD.push(totalEnergy().total - W.ledger.nuc - b0); } }\nfunction muTick0(dt) {') }), W = X.W; fresh(X, d3); X.rpMuSet(true); W.Bz = 0.001;
    for (let i = 0; i < 30; i++) { const m = X.addMuonium((i % 6) * 5 - 12, Math.floor(i / 6) * 5 - 12, 0, 1, 0, 1, 0, 0); m.vx = m.vy = m.vz = 0; }
    X.forcesNoEvents(); W.fSpawn = W.spawned; W.decayOn = true; W.warp = 2.197e-6 / (40 * 0.02 * X.PHYS.TU_S); const E0 = books(X);
    go(X, 200, 0.02); r[d3 ? 'muB3' : 'muB'] = +Math.max(...globalThis.__muD.map(Math.abs)).toExponential(1); r[d3 ? 'drift3' : 'drift'] = +(books(X) - E0).toFixed(2); r[d3 ? 'left3' : 'left'] = W.parts.filter(p => !p.dead && p.mu).length;
  }
  const ok = r.free < 1e-6 && r.free3 < 1e-6 && Math.abs(r.tri - 1.3945) < 0.001 && Math.abs(r.tri3 - 1.3945) < 0.001 && Math.abs(r.A - 1 / 3) < 0.025 && Math.abs(r.A3 - 1 / 3) < 0.03
    && Math.abs(r.ring - 1.3554) < 0.07 && r.hits > 350 && Math.abs(r.ringBooks) < 1e-3 && Math.abs(r.muB) < 1e-3 && Math.abs(r.muB3) < 1e-3 && r.left < 15 && r.left3 < 15;
  check(ok, `1.27 μSR: a μ⁺'s spin precesses at 135.54 MHz/T (off by ${r.free} rad over 0.1 ns), muonium's triplet ${r.tri} MHz/G (1.3945); decay positrons' asymmetry ${r.A} flat, ${r.A3} 3-D (1/3); a detector ring round 400 muons in 100 G finds ${r.ring} MHz (1.355) from ${r.hits} positrons; books of μ⁺ and muonium decays within ${Math.max(Math.abs(r.ringBooks), Math.abs(r.muB), Math.abs(r.muB3)).toExponential(0)} eV`, 'rp2 musr: ' + JSON.stringify(r));
};

/* The Settings section (page): the two lines follow Exotic atoms, each with its switch and cost tag; pointing at one shows
   its description; each sets what it says and is saved, and both are off again at start. */
PARTS.layout = async (page, check) => {
  const r = await page.evaluate(() => {
    document.querySelectorAll('.modal').forEach(m => { m.hidden = true; });
    loadPreset('empty'); openSettings('exp');
    const pane = document.querySelector('section[data-stab="exp"]'), lines = [...pane.querySelectorAll('.rpl')], ids = lines.map(l => (l.querySelector('[id]') || {}).id);
    const o = { ids, tags: lines.map(l => !!l.querySelector('.cost-k')), h: lines.map(l => Math.round(l.getBoundingClientRect().height)) };
    setPrevShow('setRpPs', null); o.pane = $('setPrevT').textContent + ' | ' + $('setPrevD').textContent.slice(0, 40);
    setPrevShow('setRpMu', null); o.pane2 = $('setPrevT').textContent + ' | ' + $('setPrevD').textContent.slice(0, 40);
    $('setRpPs').click(); o.ps = [SET.rpPs, RP.ps, JSON.parse(store('settings')).rpPs]; $('setRpPs').click(); o.ps.push(SET.rpPs, RP.ps);
    $('setRpMu').click(); o.mu = [SET.rpMu, RP.mu]; $('setRpMu').click(); o.mu.push(SET.rpMu, RP.mu);
    o.exp = SET_EXP.includes('rpPs') && SET_EXP.includes('rpMu');
    return o;
  });
  const i = r.ids.indexOf('setRpExo'), ok = i >= 0 && r.ids[i + 1] === 'setRpPs' && r.ids[i + 2] === 'setRpMu' && r.tags.every(Boolean) && r.h[i + 1] < 34 && r.h[i + 2] < 34
    && /^Positronium \| A slow positron/.test(r.pane) && /^Muonium as hydrogen \| Muonium/.test(r.pane2) && r.ps.join() === 'true,true,true,false,false' && r.mu.join() === 'true,true,false,false' && r.exp;
  check(ok, `1.27 Settings: Realistic particles has Positronium and Muonium as hydrogen after Exotic atoms (${r.h.slice(i + 1, i + 3).join('/')} px high), with cost tags and side-pane texts; they set RP.ps and RP.mu, and are off at start`, 'rp2 layout: ' + JSON.stringify(r));
};
PARTS.layout.page = true;

/* Ps and muonium are things of the box (page, flat and 3-D): Inspect tells a Ps's state, binding and life there and a
   muon's spin and precession; a click with Select picks each; a save read back and an undo keep them (Ps's state, the
   spins); a click with Erase takes them. */
PARTS.store = async (page, check) => {
  const out = {};
  for (const d3 of [false, true]) {
    const pos = await page.evaluate((d3) => {
      document.querySelectorAll('.modal').forEach(m => { m.hidden = true; });
      setSetting('rpPs', true); setSetting('rpMu', true); loadPreset(d3 ? 'd3empty' : 'empty'); setRunning(false); W.decayOn = false; W.Bz = 0.01;
      const o = addExo('oPs', -3, 1, 0, 1, 0, undefined, 0, 0), m = addMuonium(3, -1, 0, 1, 0, 1, 0, 0); m.vx = m.vy = m.vz = 0; m.spin = [0, 1, 0];
      forcesNoEvents(); W.fSpawn = W.spawned; if (!d3) fitView();
      const cv = $('cv').getBoundingClientRect(), at = (x, y, z) => { const v = [0, 0, 0]; if (d3) { cam3Update(); proj3(x, y, z, v); } else { v[0] = w2sx(x); v[1] = w2sy(y); } return { x: cv.left + v[0], y: cv.top + v[1] }; };
      setTool('select'); clearSelection(); window.__o = o; window.__m = m;
      return { o: at(o.x, o.y, o.z || 0), m: at(m.x, m.y, m.z || 0) };
    }, d3);
    await page.mouse.click(pos.o.x, pos.o.y); await page.waitForTimeout(80);
    const a = await page.evaluate(() => { const o = { pickO: R.msel.has(window.__o) }; clearSelection(); return o; });
    await page.mouse.click(pos.m.x, pos.m.y); await page.waitForTimeout(80);
    Object.assign(a, await page.evaluate(() => {
      const sig = () => W.exo.filter(o => !o.dead && XP[o.sp].ps).map(o => o.sp).join() + '|' + W.parts.filter(p => !p.dead && p.mu).map(p => `${p.spin.map(v => v.toFixed(3))}:${p.eSpin}`).join(' ');
      const o = { pickM: R.msel.has(window.__m), s0: sig() };
      R.sel = null; R.selX = { kind: 'exo', o: window.__o }; showTab('inspect', true); renderInspect(); let t = $('tp-inspect').textContent;
      o.insPs = /ortho-positronium/.test(t) && /6\.80 eV/.test(t) && /Expected life here/.test(t);
      R.selX = null; R.sel = window.__m; renderInspect(); t = $('tp-inspect').textContent;
      o.insMu = /Muon spin/.test(t) && /Precession/.test(t) && /MHz/.test(t);
      worldFromJSON(JSON.parse(JSON.stringify(worldToJSON()))); o.saved = sig();
      undoMark('Place'); addAtom('H', 6, -5); undoStep(-1); o.undo = sig();
      return o;
    }));
    const e = await page.evaluate((d3) => {
      const o = W.exo.find(q => !q.dead && XP[q.sp].ps), cv = $('cv').getBoundingClientRect(), v = [0, 0, 0];
      if (d3) { cam3Update(); proj3(o.x, o.y, o.z, v); } else { v[0] = w2sx(o.x); v[1] = w2sy(o.y); }
      setTool('erase'); return { x: cv.left + v[0], y: cv.top + v[1] };
    }, d3);
    await page.mouse.click(e.x, e.y); await page.waitForTimeout(120);
    a.erased = await page.evaluate(() => !W.exo.some(q => !q.dead && XP[q.sp].ps));
    out[d3 ? 'd3' : 'flat'] = a;
  }
  await page.evaluate(() => { setSetting('rpPs', false); setSetting('rpMu', false); setTool('inspect'); W.Bz = 0; });
  const ok = (v) => v.pickO && v.pickM && v.insPs && v.insMu && /^oPs\|0\.000,1\.000,0\.000:-?1$/.test(v.s0) && v.saved === v.s0 && v.undo === v.s0 && v.erased;
  check(ok(out.flat) && ok(out.d3), '1.27 realistic particles: positronium and muonium are things of the box (Select picks them, Inspect tells Ps\'s state and life and the muon\'s spin and precession, save and undo keep them with their spins, Erase takes Ps), flat and 3-D', 'rp2 store: ' + JSON.stringify(out));
};
PARTS.store.page = true;

module.exports = async function frp2(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (rp2 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `rp2 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 realistic particles 2 and 4 checks passed');
  process.exitCode = fails ? 1 : 0;
})();
