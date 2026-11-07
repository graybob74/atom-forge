'use strict';
/* The checks for 1.27's realistic particles, parts 5 and 6 (PERF-NOTES, "1.27: realistic particles 5 and 6"), run by
   t_features (one line) or alone: node tests/f_rp5.js [--node] [part …]. Each part fails on v141 (there are no switches
   there) and passes here. Parts that need the page are skipped with --node.
   (page: the t_features page; check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;
const fresh = (X, d3) => { const W = X.W; X.PRESETS[d3 ? 'd3empty' : 'empty'].build(); W.T = 0; W.gamma = 0; W.decayOn = false; W.wall = 'reflect'; };
const clear = (X) => { const W = X.W; for (const p of W.parts) X.kill(p); W.parts = []; W.exo = []; W.rays = []; X.forcesNoEvents(); };
const h = (s) => { let a = 0x811c9dc5; for (let i = 0; i < s.length; i++) { a ^= s.charCodeAt(i); a = Math.imul(a, 0x01000193); } return (a >>> 0).toString(16).padStart(8, '0'); };

/* With both switches off every setup is as before, bit for bit: the fingerprints (tools/fingerprint.js: seed 7, 300
   steps) of the setups with resonances, collisions, neutrons and decays, and of water flat and in 3-D, equal v141's; a
   placed ρ⁰ has the table's mass, and ⁶⁰Co's decay gives no γ line. */
// (1.27 bug 2: pionbeam, hyperfactory and annihilation re-fingerprinted, switches off: molecules give electrons at their measured ionization energies, from their hole atom)
// (1.27 bug 3: fusion, nif, pionbeam, annihilation and sns re-fingerprinted, switches off: close passes between nuclei turned at nuclear distances)
// (1.27 bug 4: sns re-fingerprinted, switches off: fast positrons ionize and scatter as electrons do, annihilating in flight at Heitler's rate)
// (1.27 bug 7: photonuc, sns and hyperfactory re-fingerprinted, switches off: X-rays of 10–100 keV meet atoms by their Compton and photoelectric cross sections; Compton's mₑc² exact)
// (1.27 bug 15: pionbeam and photonuc re-fingerprinted, switches off: events in the electrons' short steps search a grid rebuilt after they moved)
const FP_V141 = { pionbeam: 'a57d419b a3728514', rhic: 'fb7e8382 a9f2ee3a', linac: '7c6eb010 2b70ae2c', chain: '4b24bd95 a9f2ee3a', photonuc: '9bdf9dd1 49d4aec0', annihilation: '792e52ec 54cc0e75', isolde: '510ea801 d3061743', sns: '93ccd94e 72c69cea', useries: '0f6ae8fd a9f2ee3a', water: 'cac1ac32 a9f2ee3a', water3d: '7a2e7f5c a9f2ee3a' };
PARTS.off = async (page, check) => {
  const bad = [];
  for (const k of Object.keys(FP_V141)) {
    const X = load('all', { seed: 7 }), W = X.W, P = X.PRESETS[k];
    if (X.RP.res !== false || X.RP.nuc !== false) bad.push('switches start ' + JSON.stringify(X.RP));
    P.build(); if (X.ultraHold) X.ultraHold(); if (X.mode3dSync) try { X.mode3dSync(); } catch (e) { /* (no page) */ }
    X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned;
    for (let i = 0; i < 300; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
    const parts = W.parts.filter(p => !p.dead).map(p => [p.k, p.Z, p.N, p.ne, p.x, p.y, p.z || 0, p.vx, p.vy, p.vz || 0, p.KE || 0].join(',')).join(';');
    const exo = W.exo.filter(o => !o.dead).map(o => [o.sp, o.x, o.y, o.KE].join(',')).join(';');
    const got = h(parts + '|' + exo + '|' + W.bonds.length) + ' ' + h(JSON.stringify(W.ledger));
    if (got !== FP_V141[k]) bad.push(`${k} ${got} (v141 ${FP_V141[k]})`);
  }
  const X = load('all', { seed: 3 }), W = X.W; fresh(X, false);
  const rho = X.addExo('rho0', 0, 0, 0.03, 1, 0, X.resPlaceMass('rho0'));
  const c = X.addAtom('Co', 0, 0); c.N = 33; X.refresh(c); c.vx = c.vy = 0; X.forcesNoEvents();
  X.doDecay(c); const lines = W.rays.filter(r => !r.nu && (Math.abs(r.E - 1173228) < 2000 || Math.abs(r.E - 1332492) < 2000)).length;
  check(!bad.length && rho.m === 775.26 && lines === 0, `1.27 realistic particles 5 and 6: both switches off leave every setup as in v141 (fingerprints of ${Object.keys(FP_V141).join(', ')}); a placed ρ⁰ has the table's 775.26 MeV, ⁶⁰Co gives no γ lines`, 'rp5 off: ' + JSON.stringify({ bad, m: rho.m, lines }));
};
/* Resonance widths: ρ⁰ masses from the relativistic Breit–Wigner, 149 MeV wide at half height (PDG Γ 149.1), none below
   two pions (279 MeV); Δ⁺⁺ none below p + π⁺ (1,077.8 MeV); placed, a ρ⁰ lives ħ/Γ (Ultra-realistic: on the clock), and
   decays from its own mass with its books exact, flat and 3-D. */
PARTS.widths = async (page, check) => {
  const X = load('all', { seed: 3 }); X.RP.res = true;
  const ms = []; for (let i = 0; i < 40000; i++) ms.push(X.bwMassRel('rho0'));
  const H = new Float64Array(1000); for (const m of ms) H[Math.floor(m / 2)]++;
  const S = (i) => { let t = 0; for (let k = -5; k <= 5; k++) t += H[i + k] || 0; return t / 11; };
  let pk = 0, ip = 0; for (let i = 10; i < 990; i++) if (S(i) > pk) { pk = S(i); ip = i; }
  let lo = ip, hi = ip; while (S(lo) > pk / 2) lo--; while (S(hi) > pk / 2) hi++;
  const fwhm = (hi - lo) * 2, mmin = Math.min(...ms);
  let dmin = Infinity; for (let i = 0; i < 4000; i++) dmin = Math.min(dmin, X.bwMassRel('Dpp'));
  const r = { fwhm, peak: ip * 2 + 1, mmin: +mmin.toFixed(1), dmin: +dmin.toFixed(1) };
  for (const d3 of [false, true]) { // (placed at rest, Ultra-realistic: their mean life on the clock; each decay's books)
    const Y = load('all', { seed: 4 }), W = Y.W; Y.RP.res = true; fresh(Y, d3); W.ultra = true; W.decayOn = true; W.warp = 1;
    const tau = Y.XP.rho0.tau, dt = tau / Y.PHYS.TU_S / 10, os = [];
    for (let i = 0; i < 400; i++) os.push(Y.addExo('rho0', 0, 0, 0.03, 1, 0, Y.resPlaceMass('rho0'), 0, 0));
    let sum = 0, n = 0, worst = 0;
    for (let s = 0; s < 200; s++) { const a = os.filter(o => !o.dead).length, E0 = books(Y); Y.step(dt); const now = os.filter(o => !o.dead).length; sum += (a - now) * (s + 0.5); n += a - now; worst = Math.max(worst, Math.abs(books(Y) - E0)); }
    r[d3 ? 'd3' : 'flat'] = { life: +(sum / n / 10).toFixed(3), n, spread: +(Math.max(...os.map(o => o.m)) - Math.min(...os.map(o => o.m))).toFixed(0), books: +worst.toExponential(1) };
  }
  const ok = (v) => v.n === 400 && Math.abs(v.life - 1) < 3 / Math.sqrt(400) + 0.05 && v.spread > 300 && v.books < 1e-3;
  check(Math.abs(fwhm - 149) < 12 && Math.abs(r.peak - 775) < 20 && mmin >= 279.1 && dmin >= 1077.8 && ok(r.flat) && ok(r.d3),
    `1.27 realistic particles 5: ρ⁰ masses ${r.fwhm} MeV wide at half height (Γ 149.1), peak ${r.peak} MeV, none below ${r.mmin} MeV (two pions); Δ⁺⁺ from ${r.dmin} MeV; placed ρ⁰ live ${r.flat.life}/${r.d3.life} of ħ/Γ (flat/3-D), books within ${Math.max(r.flat.books, r.d3.books)} eV`, 'rp5 widths: ' + JSON.stringify(r));
};
/* Heavy flavour: proton–proton collisions (nnInelastic) at √s = 200 GeV and 7 TeV make charm hadrons at the measured
   share σ(cc̄)/σ_inel (1.4% and 11.6%), and at 7 TeV now and then bottom; below the threshold (5 GeV) none; the collider's
   list shows them; books exact (to 10⁻¹² of √s), flat and 3-D. */
PARTS.heavy = async (page, check) => {
  const C = new Set(['Dc0', 'Dcb0', 'Dc+', 'Dc-', 'Ds+', 'Ds-', 'Lc+', 'Lcb-', 'Jpsi']), B = new Set(['B+', 'B-', 'B0', 'Bb0', 'Bs0', 'Bsb0', 'Lb0', 'Lbb0', 'Ups']);
  const r = {};
  for (const [d3, rs, n] of [[false, 200e3, 1500], [false, 7e6, 500], [true, 7e6, 300], [false, 4e3, 300]]) {
    const X = load('all', { seed: 3 }), W = X.W; X.RP.res = true; fresh(X, d3); W.collider = { made: {} };
    let cc = 0, bb = 0, worst = 0, ev = 0;
    for (let k = 0; k < n; k++) {
      clear(X);
      const a = X.addNuc(1, 0, 0, -0.01, 0, 0, 0, false), b = X.addNuc(1, 0, 0, 0.01, 0, 0, 0, false), K = (rs / 2 - 938.272) * 1e6;
      X.setMotion(a, K, 1, 0); X.setMotion(b, K, -1, 0); X.forcesNoEvents();
      const E0 = books(X), P = X.add4(X.p4of(a, true), X.p4of(b, true));
      if (!X.nnInelastic(a, b, 0, 0, P, X.mass4(P))) continue;
      ev++;
      const sp = W.exo.filter(o => !o.dead).map(o => o.sp);
      if (sp.some(s => C.has(s))) cc++; if (sp.some(s => B.has(s))) bb++;
      worst = Math.max(worst, Math.abs(books(X) - E0) / (rs * 1e6));
    }
    const f = X.hfShare(rs / 1e3), made = Object.keys(W.collider.made).filter(l => /D|Λc|B|J\/ψ|Υ/.test(l));
    r[(d3 ? '3d' : 'flat') + rs / 1e3] = { ev, cc: +(cc / ev).toFixed(4), want: +f.cc.toFixed(4), sig: +Math.sqrt(f.cc * (1 - f.cc) / ev).toFixed(4), bb, books: +worst.toExponential(1), made: made.slice(0, 6).join(' ') };
    W.collider = null;
  }
  const near = (v) => Math.abs(v.cc - v.want) < 3 * v.sig + 0.002 && v.books < 1e-12;
  check(near(r.flat200) && near(r.flat7000) && near(r['3d7000']) && r.flat4.cc === 0 && /D/.test(r.flat7000.made),
    `1.27 realistic particles 5: pp collisions make charm at the measured share: ${r.flat200.cc} at 200 GeV (σ(cc̄)/σ_inel ${r.flat200.want}), ${r.flat7000.cc} at 7 TeV (${r.flat7000.want}; 3-D ${r['3d7000'].cc}), bottom in ${r.flat7000.bb} of ${r.flat7000.ev}; none at 4 GeV; the collider lists ${r.flat7000.made}; books to ${Math.max(r.flat7000.books, r['3d7000'].books)} of √s`, 'rp5 heavy: ' + JSON.stringify(r));
};
/* Spin: measured spins and moments (¹H ½ 2.793 μN, ²H 1 0.857, ¹³C ½ 0.702, ¹⁴N 1 0.404, ¹⁷O 5/2 −1.894, ¹⁹F ½ 2.629,
   ³¹P ½ 1.132, the neutron ½ −1.913; ¹²C 0); after an NMR pulse the protons of water inside a placed magnet (1.5 T) and
   in the Lab's field (3-D, 2 T) precess and the signal reads 42.58 MHz per tesla (42.577 measured). */
PARTS.spin = async (page, check) => {
  const X = load('all', { seed: 5 }); X.RP.nuc = true;
  const want = { '1_0': [0.5, 2.793], '1_1': [1, 0.857], '6_7': [0.5, 0.702], '7_7': [1, 0.404], '8_9': [2.5, -1.894], '9_10': [0.5, 2.629], '15_16': [0.5, 1.132], '0_1': [0.5, -1.913], '6_6': [0, 0] };
  const bad = Object.entries(want).filter(([k, [I, mu]]) => { const s = X.nucSpin(...k.split('_').map(Number)); return !s || s.I !== I || Math.abs(s.mu - mu) > 0.001; }).map(([k]) => k);
  const r = {};
  for (const d3 of [false, true]) {
    const Y = load('all', { seed: 5 }), W = Y.W; Y.RP.nuc = true; Y.PRESETS[d3 ? 'water3d' : 'water'].build(); Y.settleOverlaps(); Y.forcesNoEvents(); W.fSpawn = W.spawned;
    if (d3) { W.Bz = 2; W.Bax3 = 'z'; } else W.magnets.push({ x: 0, y: 0, R: 200, B: 1.5 });
    const E0 = Y.totalEnergy().total, G = Y.nmrPulse(1, 0);
    for (let i = 0; i < 150; i++) { if (W.fSpawn !== W.spawned) { Y.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = Y.chooseDt(); Y.step(W.dt); }
    const q = Y.nmrRead();
    r[d3 ? 'd3' : 'flat'] = { n: G.n0, perT: +(q.f / 1e6 / q.B).toFixed(4), B: +q.B.toFixed(3), amp: +q.amp.toFixed(4), t: q.t };
  }
  const ok = (v) => v.n > 100 && Math.abs(v.perT - 42.577) < 0.01 && v.amp > 0.99;
  check(!bad.length && ok(r.flat) && ok(r.d3), `1.27 realistic particles 6: nuclear spins and moments as measured (¹H ½ 2.793 μN … the neutron ½ −1.913); after an NMR pulse ${r.flat.n} protons in a 1.5 T magnet precess at ${r.flat.perT} MHz/T (3-D, ${r.d3.n} in the Lab's 2 T: ${r.d3.perT}; 42.577 measured)`, 'rp5 spin: ' + JSON.stringify({ bad, r }));
};
/* γ lines: ⁶⁰Co β⁻ gives 1,173 and 1,332 keV in every decay; ¹³⁷Cs feeds the isomer ¹³⁷ᵐBa (94%), which waits and then
   gives 662 keV (or its K conversion electron, 624 keV, about 1 in 10); a thermal neutron caught by hydrogen gives one
   γ of 2,223 keV; ¹⁰B(n,α) the 478 keV line of ⁷Li (94%); ¹⁴N's capture the 10.83 MeV line now and then; ¹¹³Cd's
   the 558 keV line in about 3 of 4. Books of every event exact, flat and 3-D. */
PARTS.lines = async (page, check) => {
  const r = {}; let worst = 0;
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 5 }), W = X.W; X.RP.nuc = true; fresh(X, d3);
    const one = (sym, N) => { clear(X); const c = X.addAtom(sym, 0, 0); c.N = N; X.refresh(c); c.vx = c.vy = c.vz = 0; X.forcesNoEvents(); W.fSpawn = W.spawned; return c; };
    const gam = () => W.rays.filter(q => !q.nu).map(q => q.E / 1e3);
    let co = 0; for (let k = 0; k < 40; k++) { const c = one('Co', 33), E0 = books(X); X.doDecay(c); worst = Math.max(worst, Math.abs(books(X) - E0)); const g = gam(); if (g.some(e => Math.abs(e - 1173.23) < 0.1) && g.some(e => Math.abs(e - 1332.49) < 0.1)) co++; }
    let iso = 0, g662 = 0, e624 = 0; for (let k = 0; k < 60; k++) {
      const c = one('Cs', 82); let E0 = books(X); X.doDecay(c); worst = Math.max(worst, Math.abs(books(X) - E0)); if (!c.iso) continue; iso++;
      const n0 = W.parts.length; E0 = books(X); X.isoStep(c, 1e5); worst = Math.max(worst, Math.abs(books(X) - E0));
      if (gam().some(e => Math.abs(e - 661.65) < 0.1)) g662++; if (W.parts.slice(n0).some(p => p.k === X.ELEC && Math.abs(X.keOf(p) / 1e3 - 624.2) < 0.2)) e624++;
    }
    const cap = (sym, N, n) => { const Es = []; for (let k = 0; k < n; k++) { const c = one(sym, N), nn = X.addNuc(0, 1, 0, -0.3, 0, 0, 0, false, 0); nn.vx = 0.22; nn.vy = nn.vz = 0; X.forcesNoEvents(); W.rays = []; for (let t = 0; t < 300 && !nn.dead; t++) { const E0 = books(X); X.neutronHit(nn, c, 0, 0.35); if (nn.dead) { worst = Math.max(worst, Math.abs(books(X) - E0)); Es.push(gam()); } else { nn.x = -0.3; nn.y = 0; nn.vx = 0.22; nn.vy = nn.vz = 0; c.x = c.y = 0; c.vx = c.vy = c.vz = 0; } } } return Es; };
    const H = cap('H', 0, 30), Bo = cap('B', 5, 30), N14 = cap('N', 7, 500), Cd = cap('Cd', 65, 40);
    r[d3 ? 'd3' : 'flat'] = { co, iso, g662, e624, H: H.filter(g => g.length === 1 && Math.abs(g[0] - 2223.2) < 0.2).length + '/' + H.length, B: Bo.filter(g => g.some(e => Math.abs(e - 477.6) < 0.1)).length + '/' + Bo.length,
      N: N14.filter(g => g.some(e => Math.abs(e - 10828.8) < 2)).length + '/' + N14.filter(g => g.length).length, Cd: Cd.filter(g => g.some(e => Math.abs(e - 558.46) < 0.05)).length + '/' + Cd.length };
  }
  const frac = (s) => { const [a, b] = s.split('/').map(Number); return b ? a / b : 0; };
  const ok = (v) => v.co === 40 && v.iso >= 48 && v.g662 + v.e624 === v.iso && v.e624 >= 1 && v.g662 > 0.8 * v.iso && frac(v.H) === 1 && frac(v.B) > 0.8 && frac(v.N) > 0 && frac(v.Cd) > 0.6;
  check(ok(r.flat) && ok(r.d3) && worst < 1e-3, `1.27 realistic particles 6: ⁶⁰Co gives 1,173 + 1,332 keV (${r.flat.co}/40); ¹³⁷Cs → ¹³⁷ᵐBa (${r.flat.iso}/60) → 662 keV γ ${r.flat.g662}, conversion e⁻ 624 keV ${r.flat.e624}; capture on H one 2,223 keV γ (${r.flat.H}), ¹⁰B(n,α) 478 keV (${r.flat.B}), ¹⁴N 10.83 MeV (${r.flat.N}), ¹¹³Cd 558 keV (${r.flat.Cd}); 3-D alike; books within ${worst.toExponential(1)} eV`, 'rp5 lines: ' + JSON.stringify({ r, worst }));
};
/* Neutron cross sections at true size (Ultra-realistic): thermal neutrons through random impact parameters around one
   nucleus are absorbed per unit area (3-D) or width (flat, a 1.2 Å slab) in proportion to the measured σ_abs: ¹⁰B
   3,837 b and ¹¹³Cd 20,600 b against ¹H's 0.333 b (ratios 11,500 and 61,300 at 0.0244 eV); and the shares: ²³⁵U fission
   585 of 699 b thermal, ²³⁸U's capture share at its 6.67 eV resonance far above that at 1 eV. */
PARTS.neutrons = async (page, check) => {
  const r = {};
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 9 }), W = X.W; X.RP.nuc = true; fresh(X, d3); W.ultra = true;
    const per = {};
    for (const [Z, N, n] of [[1, 0, 20000], [5, 5, 1500], [48, 65, 1500]]) {
      let abs = 0; const sg = X.nxsSigma(Z, N, 0.5 * X.PHYS.MN * 0.22 * 0.22), Bm = 1.5 * (d3 ? Math.sqrt(sg * 1e-8 / Math.PI) : sg * 1e-8 / 2.4);
      for (let k = 0; k < n; k++) {
        for (const p of W.parts) X.kill(p); W.parts = [];
        const c = X.addNuc(Z, N, 0, 0, 0, 0, 0, false, 0); c.vx = c.vy = c.vz = 0;
        let b1 = 0, b2 = 0; if (d3) { const rr = Bm * Math.sqrt(X.rnd()), th = 2 * Math.PI * X.rnd(); b1 = rr * Math.cos(th); b2 = rr * Math.sin(th); } else b1 = Bm * (2 * X.rnd() - 1);
        const nn = X.addNuc(0, 1, 0, -0.5, b1, 0, 0, false, b2); nn.vx = 0.22; nn.vy = nn.vz = 0; X.forcesNoEvents();
        X.moveNeutron(nn, 5, 1, 0, 0); if (nn.dead) abs++;
      }
      per[Z + '_' + N] = { abs, a: abs / n * (d3 ? Math.PI * Bm * Bm : 2 * Bm) };
    }
    r[d3 ? 'd3' : 'flat'] = { B: Math.round(per['5_5'].a / per['1_0'].a), Cd: Math.round(per['48_65'].a / per['1_0'].a), H: per['1_0'].abs };
  }
  const X = load('all', { seed: 1 }), E = 0.5 * X.PHYS.MN * 0.22 * 0.22, sa = (Z, N) => { const o = X.nxsAt(X.NXS[Z + '_' + N], E); return o.c + o.a; };
  const wantB = sa(5, 5) / sa(1, 0), wantCd = sa(48, 65) / sa(1, 0);
  const u5 = X.nxsShares(92, 143, 0.0253, X.NEUTRON_X['92_143']), u8a = X.nxsShares(92, 146, 6.674, X.NEUTRON_X['92_146']).pc, u8b = X.nxsShares(92, 146, 1, X.NEUTRON_X['92_146']).pc;
  const near = (v, w, n) => Math.abs(v / w - 1) < 3 / Math.sqrt(n) + 0.05;
  check(near(r.flat.B, wantB, r.flat.H) && near(r.flat.Cd, wantCd, r.flat.H) && near(r.d3.B, wantB, r.d3.H) && near(r.d3.Cd, wantCd, r.d3.H) && Math.abs(u5.pf - 585.1 / 698.8) < 0.01 && u8a > 0.95 && u8b < 0.3,
    `1.27 realistic particles 6: at true size thermal neutrons are absorbed by ¹⁰B ${r.flat.B} and ¹¹³Cd ${r.flat.Cd} times as readily as by ¹H (3-D ${r.d3.B}, ${r.d3.Cd}; measured ${Math.round(wantB)}, ${Math.round(wantCd)}); ²³⁵U fissions in ${u5.pf.toFixed(3)} of thermal meetings; ²³⁸U captures in ${u8a.toFixed(3)} at 6.67 eV, ${u8b.toFixed(3)} at 1 eV`, 'rp5 neutrons: ' + JSON.stringify({ r, wantB, wantCd, u5, u8a, u8b }));
};
/* Books with the switches on, in running boxes (each event wrapped: the books just before and after it): water with
   ¹⁰B, ¹¹³Cd, ¹⁴N, ⁶⁰Co and ¹³⁷Cs atoms and thermal neutrons, decay sped up, flat and 3-D (captures, (n,α), decays,
   isomers); and a pion beam's resonances drawn with their widths. */
PARTS.books = async (page, check) => {
  const r = {};
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 6 }), W = X.W; X.RP.nuc = true; X.RP.res = true;
    X.PRESETS[d3 ? 'water3d' : 'water'].build(); X.settleOverlaps(); W.gamma = 0;
    const hw = W.box.w / 2 - 3, hh = W.box.h / 2 - 3, hd = d3 ? W.box.d / 2 - 3 : 0;
    const atoms = [];
    for (const [sym, N] of [['B', 5], ['B', 5], ['Cd', 65], ['N', 7], ['Co', 33], ['Cs', 82], ['Cs', 82]]) { const c = X.addAtom(sym, (X.rnd() * 2 - 1) * hw, (X.rnd() * 2 - 1) * hh, d3 ? { z: (X.rnd() * 2 - 1) * hd } : undefined); c.N = N; X.refresh(c); atoms.push(c); }
    for (let i = 0; i < 40; i++) { const u = X.rnd() * 2 * Math.PI; const n = X.addNuc(0, 1, 0, (X.rnd() * 2 - 1) * hw, (X.rnd() * 2 - 1) * hh, 0, 0, false, d3 ? (X.rnd() * 2 - 1) * hd : 0); n.vx = 0.3 * Math.cos(u); n.vy = 0.3 * Math.sin(u); if (d3) n.vz = 0; }
    X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned; W.decayOn = true; W.warp = 1e9;
    let worst = 0, nev = 0;
    for (const f of ['neutronHit', 'doDecay', 'isoStep']) { const g = X[f]; X[f] = function (...a) { const E0 = books(X); const out = g.apply(this, a); const d = Math.abs(books(X) - E0); if (d > 1e-9 || out) { nev++; worst = Math.max(worst, d); } return out; }; }
    for (let i = 0; i < 300; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); if (i % 20 === 0) X.decayStep(W.dt * X.PHYS.TU_S * W.warp); }
    r[d3 ? 'd3' : 'flat'] = { events: nev, worst: +worst.toExponential(1), log: W.log.filter(l => /γ|Isomeric/.test(l.text)).length };
  }
  check(r.flat.events > 5 && r.d3.events > 5 && r.flat.worst < 1e-3 && r.d3.worst < 1e-3, `1.27 realistic particles 6: books exact with the switches on in running water with neutrons, ¹⁰B, ¹¹³Cd, ¹⁴N, ⁶⁰Co and ¹³⁷Cs (flat ${r.flat.events} events, worst ${r.flat.worst} eV; 3-D ${r.d3.events}, ${r.d3.worst} eV)`, 'rp5 books: ' + JSON.stringify(r));
};
/* The Settings rows (page): two more compact lines in Realistic particles, after Exotic atoms, with their cost tags,
   switches and side-pane descriptions; they set RP.res and RP.nuc and are saved, and are off again at start (SET_EXP);
   Inspect shows a proton's spin with the switch on, its Larmor frequency in a field, and the NMR button reads 42.58 MHz/T;
   off, none of it. */
PARTS.page = async (page, check) => {
  const r = await page.evaluate(() => {
    document.querySelectorAll('.modal').forEach(m => { m.hidden = true; });
    loadPreset('empty'); openSettings('exp');
    const pane = document.querySelector('section[data-stab="exp"]'), lines = [...pane.querySelectorAll('.rpl')], ids = lines.map(l => (l.querySelector('[id]') || {}).id);
    const o = { ids: ids.join(','), tags: lines.map(l => !!l.querySelector('.cost-k')).every(Boolean), h: lines.map(l => Math.round(l.getBoundingClientRect().height)) };
    o.sw = ['setRpRes', 'setRpNuc'].every(id => $(id).getAttribute('role') === 'switch');
    setPrevShow('setRpNuc', null); o.pane = $('setPrevT').textContent;
    $('setRpRes').click(); $('setRpNuc').click(); o.on = [SET.rpRes, RP.res, SET.rpNuc, RP.nuc].join(); const sv = JSON.parse(store('settings')); o.saved = [sv.rpRes, sv.rpNuc].join();
    o.exp = SET_EXP.includes('rpRes') && SET_EXP.includes('rpNuc');
    hideModal('setModal');
    loadPreset('water'); setRunning(false); W.Bz = 1;
    const h = W.parts.find(p => p.Z === 1 && !p.dead); R.sel = h; showTab('inspect', true); renderInspect();
    o.ins = $('tp-inspect').textContent; const b = $('tp-inspect').querySelector('[data-act="nmr"]'); o.btn = !!b; if (b) b.click();
    for (let i = 0; i < 50; i++) { W.dt = chooseDt(); step(W.dt); }
    renderInspect(); o.ins2 = $('tp-inspect').textContent;
    setSetting('rpRes', false); setSetting('rpNuc', false); renderInspect(); o.off = $('tp-inspect').textContent; o.btnOff = !!$('tp-inspect').querySelector('[data-act="nmr"]');
    W.Bz = 0; return o;
  });
  const sp = /Nuclear spinI = ½, magnetic moment \+2\.793 μN \(γ\/2π = 42\.58 MHz\/T\)/.test(r.ins), lar = /Larmor precession42\.58 MHz in 1(\.0+)? T: one turn in 23\.5 ns/.test(r.ins), nmr = /NMR signal\d+ nuclei.*turning at 42\.57\d* MHz \(42\.57\d* MHz per tesla/.test(r.ins2);
  const ids = r.ids.split(','), iR = ids.indexOf('setRpRes'), iN = ids.indexOf('setRpNuc'); // (the other parts' lines sit beside these, 1.27)
  const ok = ids.slice(0, 3).join() === 'setUltra,segWave,setRpExo' && iR > 2 && iN === iR + 1 && r.tags && r.sw && r.h[iR] < 34 && r.h[iN] < 34 && r.pane === 'Nuclear spin, γ lines and neutron cross sections' && r.on === 'true,true,true,true' && r.saved === 'true,true' && r.exp && sp && lar && r.btn && nmr && !/Nuclear spin/.test(r.off) && !r.btnOff;
  check(ok, `1.27 Settings: Realistic particles has the lines ${r.ids} (${r.h.join('/')} px), cost tags and switches; on, Inspect shows a proton's spin, its Larmor frequency in 1 T, and the NMR pulse reads 42.58 MHz/T; off, none of it`, 'rp5 page: ' + JSON.stringify(Object.assign({}, r, { ins: r.ins.slice(0, 600), ins2: (r.ins2.match(/NMR signal[^]{0,160}/) || [''])[0], off: r.off.slice(0, 100), sp, lar, nmr })));
};
PARTS.page.page = true;
module.exports = async function frp5(page, check, say, openPage, only) {
  if (!openPage) openPage = require('./browser').openPage;
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (rp5 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `rp5 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 realistic particles 5 and 6 checks passed');
  process.exitCode = fails ? 1 : 0;
})();
