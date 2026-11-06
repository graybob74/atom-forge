'use strict';
/* The checks for 1.27's realistic particles, part 7 (PERF-NOTES, "1.27: realistic particles 7 (photon polarization,
   Klein–Nishina)"), run by t_features (one line) or alone: node tests/f_rp7.js [--node] [part …]. Each part fails on
   v145 (there is no switch there) and passes here. Parts that need the page are skipped with --node.
   (page: the t_features page; check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;
const fresh = (X, d3) => { const W = X.W; X.PRESETS[d3 ? 'd3empty' : 'empty'].build(); W.T = 0; W.gamma = 0; W.decayOn = false; W.wall = 'reflect'; };
const h = (s) => { let a = 0x811c9dc5; for (let i = 0; i < s.length; i++) { a ^= s.charCodeAt(i); a = Math.imul(a, 0x01000193); } return (a >>> 0).toString(16).padStart(8, '0'); };
const ME = 510998.95;
/* Klein–Nishina, summed over the outgoing polarization: r²(r + 1/r − 2(ε·n̂)²), r = E′/E. */
const kn = (k, ct, en2) => { const r = 1 / (1 + k * (1 - ct)); return r * r * (r + 1 / r - 2 * en2); };
const chi2 = (H, ex) => { const N = H.reduce((a, b) => a + b, 0), T = ex.reduce((a, b) => a + b, 0); let c = 0; for (let i = 0; i < H.length; i++) { const e = ex[i] / T * N; c += (H[i] - e) ** 2 / e; } return c; };

/* Switch off, every setup as before, bit for bit: the fingerprints (tools/fingerprint.js: seed 7, 300 steps) of the
   setups with γ rays, annihilation, light and optics, and of water flat and in 3-D, equal v145's; with it off a γ ray's
   Compton angles are as before (cos θ even: as many back as forward at 5 MeV) and its photons carry no polarization. */
const FP_V145 = { annihilation: '2e53fdee 720a4c6e', pet: 'a5248bff a9f2ee3a', prism: '4ffe98af a9f2ee3a', photonuc: 'a03a2d7b 77a2e23f', water: 'cac1ac32 a9f2ee3a', water3d: '7a2e7f5c a9f2ee3a' };
PARTS.off = async (page, check) => {
  const bad = [], keys = Object.keys(FP_V145).filter(k => FP_V145[k]);
  for (const k of keys) {
    const X = load('all', { seed: 7 }), W = X.W, P = X.PRESETS[k];
    if (!P) { bad.push(k + ' missing'); continue; }
    if (X.RP.pol !== false) bad.push('switch starts ' + X.RP.pol);
    P.build(); if (X.ultraHold) X.ultraHold(); if (X.mode3dSync) try { X.mode3dSync(); } catch (e) { /* (no page) */ }
    X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned;
    for (let i = 0; i < 300; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
    const parts = W.parts.filter(p => !p.dead).map(p => [p.k, p.Z, p.N, p.ne, p.x, p.y, p.z || 0, p.vx, p.vy, p.vz || 0, p.KE || 0].join(',')).join(';');
    const exo = W.exo.filter(o => !o.dead).map(o => [o.sp, o.x, o.y, o.KE].join(',')).join(';');
    const got = h(parts + '|' + exo + '|' + W.bonds.length) + ' ' + h(JSON.stringify(W.ledger));
    if (got !== FP_V145[k]) bad.push(`${k} ${got} (v145 ${FP_V145[k]})`);
  }
  const X = load('all', { seed: 3 }), W = X.W; fresh(X, false);
  let back = 0, pol = 0; const n = 400;
  for (let i = 0; i < n; i++) { const c = X.addAtom('C', 0, 0); c.vx = c.vy = 0; X.forcesNoEvents(); W.rays = []; X.compton(c, 5e6, 1, 0); const r = W.rays.find(q => !q.nu && q.E > 1e5); if (r && r.x1 - r.x0 < 0) back++; if (W.rays.some(q => q.pol)) pol++; for (const p of W.parts) X.kill(p); W.parts = []; }
  check(!bad.length && back > 0.4 * n && back < 0.6 * n && pol === 0, `1.27 realistic particles 7: the switch off leaves every setup as in v145 (fingerprints of ${keys.join(', ')}); a 5 MeV γ's Compton photon goes back ${back} times in ${n} (cos θ even, as before), no photon carries a polarization`, 'rp7 off: ' + JSON.stringify({ bad, back, pol }));
};
/* Klein–Nishina's angles: 60,000 scatterings of unpolarized photons at 10 keV, 511 keV and 5 MeV, binned in cos θ
   (3-D) and in θ round the circle (flat), against the formula (χ², 19 degrees of freedom); E′ = E/(1 + κ(1 − cos θ))
   exactly in full Compton events on carbon, flat and 3-D, with the event's books exact; the electron leaves along the
   momentum the photon gave it. */
PARTS.angles = async (page, check) => {
  const r = {};
  for (const d3 of [true, false]) {
    const X = load('all', { seed: 11 }), W = X.W; X.RP.pol = true; fresh(X, d3);
    for (const E of [1e4, 511e3, 5e6]) {
      const k = E / ME, NB = 20, H = new Float64Array(NB), N = 60000;
      for (let i = 0; i < N; i++) { const s = X.knScatter(E, 1, 0, 0, null); H[Math.min(NB - 1, Math.floor((d3 ? (s[1] + 1) / 2 : (Math.atan2(s[2], s[1]) + Math.PI) / (2 * Math.PI)) * NB))]++; }
      const ex = []; for (let b = 0; b < NB; b++) { let s = 0; for (let j = 0; j < 100; j++) { const x = (b + (j + 0.5) / 100) / NB, ct = d3 ? 2 * x - 1 : Math.cos(2 * Math.PI * x - Math.PI); s += kn(k, ct, (1 - ct * ct) / 2); } ex.push(s); }
      r[(d3 ? '3d ' : 'flat ') + E / 1e3] = +chi2(H, ex).toFixed(1);
    }
    let worstE = 0, worstB = 0, worstQ = 0, n = 0;
    for (let i = 0; i < 60; i++) {
      const c = X.addAtom('C', 0, 0); c.vx = c.vy = c.vz = 0; X.forcesNoEvents(); W.rays = []; const n0 = W.parts.length;
      const E = [2e5, 511e3, 5e6][i % 3], E0 = books(X) + E, esc0 = W.ledger.escaped; // (+ E: the photon itself is not in the books until it leaves or is taken)
      if (d3) X.compton3(c, E, 1, 0, 0, null); else X.compton(c, E, 1, 0, null);
      const g = W.rays.find(q => !q.nu); if (!g) continue;
      const L = Math.hypot(g.x1 - g.x0, g.y1 - g.y0, (g.z1 || 0) - (g.z0 || 0)), ct = (g.x1 - g.x0) / L;
      worstE = Math.max(worstE, Math.abs(g.E - E / (1 + E / ME * (1 - ct))) / E);
      const e = W.parts.slice(n0).find(p => p.k === X.ELEC);
      if (e) { const v = Math.hypot(e.vx, e.vy, e.vz || 0), qx = E - g.E * ct, qy = -g.E * (g.y1 - g.y0) / L, qz = -g.E * ((g.z1 || 0) - (g.z0 || 0)) / L, q = Math.hypot(qx, qy, qz); worstQ = Math.max(worstQ, 1 - (e.vx * qx + e.vy * qy + (e.vz || 0) * qz) / (v * q)); }
      worstB = Math.max(worstB, Math.abs(books(X) - E0)); n++;
      for (const p of W.parts) X.kill(p); W.parts = []; W.ledger.escaped = esc0;
    }
    r[d3 ? 'd3' : 'flat'] = { n, dE: +worstE.toExponential(1), books: +worstB.toExponential(1), dir: +worstQ.toExponential(1) };
  }
  const chis = Object.keys(r).filter(k => / /.test(k)).map(k => r[k]);
  const ok = chis.every(c => c < 45) && ['flat', 'd3'].every(k => r[k].n >= 55 && r[k].dE < 1e-9 && r[k].books < 1e-6 && r[k].dir < 1e-3);
  check(ok, `1.27 realistic particles 7: Compton angles against Klein–Nishina (χ² over 19 bins, 60,000 each: 3-D ${r['3d 10']}, ${r['3d 511']}, ${r['3d 5000']}; flat ${r['flat 10']}, ${r['flat 511']}, ${r['flat 5000']} at 10 keV, 511 keV, 5 MeV); E′ exact to ${Math.max(r.flat.dE, r.d3.dE)}, the electron along the momentum given, books within ${Math.max(r.flat.books, r.d3.books)} eV`, 'rp7 angles: ' + JSON.stringify(r));
};
/* The polarization's mark on Compton scattering. 3-D, 511 keV, polarized along y: in the band 80–100°, the azimuth φ from
   the polarization against the formula (χ², 11 dof), and the count at 90° to it over the count along it against
   the formula's integral over the same bins (4.4 here, in 15° wedges); unpolarized: φ even (χ² against flat). Flat, 100 keV: a photon polarized
   across the plane scatters into it more often than one polarized in it (the rate rayInteract draws: A − 2cos²ψ·B over
   A − B) and the in-plane one hardly at 90°; the counts near 90° per photon met against the formula. And the new
   polarization: at low energy (Thomson) the scattered photon's polarization is the incoming one's part across its new
   path (ε₁) in nearly every case, never along its path. */
PARTS.asym = async (page, check) => {
  const r = {};
  { const X = load('all', { seed: 12 }), W = X.W; X.RP.pol = true; fresh(X, true);
    const E = 511e3, k = E / ME, NB = 12, Hp = new Float64Array(NB), Hu = new Float64Array(NB), N = 150000;
    let at90 = 0, at0 = 0;
    for (const [H, pol] of [[Hp, [0, 1, 0]], [Hu, null]]) for (let i = 0; i < N; i++) {
      const s = X.knScatter(E, 1, 0, 0, pol); if (Math.abs(s[1]) > Math.cos(80 * Math.PI / 180)) continue;
      const ph = Math.atan2(s[3], s[2]), b = Math.min(NB - 1, Math.floor((ph + Math.PI) / (2 * Math.PI) * NB)); H[b]++;
      if (pol) { const a = Math.abs(Math.cos(ph)); if (a < Math.sin(15 * Math.PI / 180)) at90++; else if (a > Math.cos(15 * Math.PI / 180)) at0++; }
    }
    const ex = [], exU = new Array(NB).fill(1); let e90 = 0, e0 = 0;
    for (let b = 0; b < NB; b++) { let s = 0; for (let j = 0; j < 40; j++) for (let m = 0; m < 40; m++) { const ph = -Math.PI + 2 * Math.PI * (b + (j + 0.5) / 40) / NB, ct = Math.cos(80 * Math.PI / 180) * (2 * (m + 0.5) / 40 - 1); s += kn(k, ct, (1 - ct * ct) * Math.cos(ph) ** 2); } ex.push(s); }
    for (let j = 0; j < 400; j++) for (let m = 0; m < 400; m++) { const ph = 2 * Math.PI * (j + 0.5) / 400, ct = Math.cos(80 * Math.PI / 180) * (2 * (m + 0.5) / 400 - 1), a = Math.abs(Math.cos(ph)), f = kn(k, ct, (1 - ct * ct) * Math.cos(ph) ** 2); if (a < Math.sin(15 * Math.PI / 180)) e90 += f; else if (a > Math.cos(15 * Math.PI / 180)) e0 += f; }
    r.d3 = { chiP: +chi2(Hp, ex).toFixed(1), chiU: +chi2(Hu, exU).toFixed(1), ratio: +(at90 / at0).toFixed(3), expect: +(e90 / e0).toFixed(3), n: at90 + at0 };
  }
  { const X = load('all', { seed: 13 }), W = X.W; X.RP.pol = true; fresh(X, false);
    const E = 1e5, k = E / ME, c = X.addAtom('C', 3, 0); c.vx = c.vy = 0; X.forcesNoEvents();
    const N = 40000, met = {}, band = {};
    for (const [nm, pol] of [['in', [0, -1, 0]], ['across', [0, 0, 1]]]) {
      let hit = 0, b90 = 0;
      for (let i = 0; i < N; i++) { const hh = X.rayInteract(-10, 0, 1, 0, E, null, pol); if (!hh) continue; hit++; const s = X.knScatter(E, 1, 0, 0, pol), th = Math.abs(Math.atan2(s[2], s[1])); if (Math.abs(th - Math.PI / 2) < 10 * Math.PI / 180) b90++; }
      met[nm] = hit; band[nm] = b90;
    }
    let A = 0, B = 0, f90 = { in: 0, across: 0 }, tot = { in: 0, across: 0 };
    for (let i = 0; i < 3600; i++) { const th = 2 * Math.PI * (i + 0.5) / 3600, ct = Math.cos(th), rr = 1 / (1 + k * (1 - ct)); A += rr ** 3 + rr; B += rr * rr * Math.sin(th) ** 2;
      for (const [nm, c2] of [['in', 1], ['across', 0]]) { const f = kn(k, ct, Math.sin(th) ** 2 * c2); tot[nm] += f; if (Math.abs(Math.abs(th - Math.PI) - Math.PI / 2) < 10 * Math.PI / 180) f90[nm] += f; } }
    const pBase = 0.012 * 6; // (the game's chance at a carbon atom met, unpolarized)
    r.flat = { metIn: met.in, metAcross: met.across, expIn: Math.round(N * pBase * (A - 2 * B) / (A - B)), expAcross: Math.round(N * pBase * A / (A - B)), b90In: band.in, b90Across: band.across,
      expB90In: +(met.in * f90.in / tot.in).toFixed(1), expB90Across: +(met.across * f90.across / tot.across).toFixed(1) };
  }
  { const X = load('all', { seed: 14 }), W = X.W; X.RP.pol = true; fresh(X, true);
    let e1 = 0, along = 0; const N = 4000;
    for (let i = 0; i < N; i++) { const s = X.knScatter(100, 1, 0, 0, [0, 1, 0]), n = [s[1], s[2], s[3]], e = s[4]; const ea = X.polAcross([0, 1, 0], ...n); if (ea && Math.abs(e[0] * ea[0] + e[1] * ea[1] + e[2] * ea[2]) > 0.999) e1++; if (Math.abs(e[0] * n[0] + e[1] * n[1] + e[2] * n[2]) > 1e-9) along++; }
    r.newPol = { e1: e1 / N, along };
  }
  const f = r.flat, sd = (n) => 3.5 * Math.sqrt(Math.max(n, 1));
  const ok = r.d3.chiP < 35 && r.d3.chiU < 35 && Math.abs(r.d3.ratio - r.d3.expect) < 0.12 * r.d3.expect && r.d3.expect > 2
    && Math.abs(f.metIn - f.expIn) < sd(f.expIn) && Math.abs(f.metAcross - f.expAcross) < sd(f.expAcross) && f.metAcross > 1.6 * f.metIn
    && Math.abs(f.b90In - f.expB90In) < sd(f.expB90In) + 2 && Math.abs(f.b90Across - f.expB90Across) < sd(f.expB90Across) && r.newPol.e1 > 0.999 && r.newPol.along === 0;
  check(ok, `1.27 realistic particles 7: polarized Compton scattering: 3-D at 511 keV, 80–100°, ${r.d3.ratio} times as many at 90° to the polarization as along it (formula ${r.d3.expect}; φ χ² ${r.d3.chiP}, unpolarized even χ² ${r.d3.chiU}, 11 dof); flat at 100 keV, of 40,000 photons met ${f.metAcross} scatter polarized across the plane, ${f.metIn} in it (formula ${f.expAcross}, ${f.expIn}), near 90° ${f.b90Across} and ${f.b90In} (${f.expB90Across}, ${f.expB90In}); the new polarization the old one's part across its path (${r.newPol.e1} at 100 eV)`, 'rp7 asym: ' + JSON.stringify(r));
};
/* Sources: e⁺e⁻ annihilation (twoGamma: free pairs, walls, atoms) and para-positronium give two γ polarized at right
   angles, each at right angles to its own path, each alone unpolarized (its angle even: χ² against flat); light from an
   atom carries none (unpolarized); the Light tool's laser carries the one chosen. */
PARTS.sources = async (page, check) => {
  const r = {};
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 15 }), W = X.W; X.RP.pol = true; X.RP.ps = true; fresh(X, d3);
    let worst = 0, perp = 0; const NB = 12, H = new Float64Array(NB), N = 3000;
    for (let i = 0; i < N; i++) {
      W.rays = []; X.twoGamma(0, 0); const [a, b] = W.rays.filter(q => !q.nu);
      if (!a || !a.pol || !b || !b.pol) continue;
      const dir = (q) => { const L = Math.hypot(q.x1 - q.x0, q.y1 - q.y0, (q.z1 || 0) - (q.z0 || 0)); return [(q.x1 - q.x0) / L, (q.y1 - q.y0) / L, ((q.z1 || 0) - (q.z0 || 0)) / L]; };
      const da = dir(a), db = dir(b), dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
      worst = Math.max(worst, Math.abs(dot(a.pol, b.pol)), Math.abs(dot(a.pol, da)), Math.abs(dot(b.pol, db))); perp++;
      // (its angle round its own path, from a fixed reference across it)
      let ang;
      if (!d3) { const [c, s] = X.polPS(a.pol, da[0], da[1]); ang = Math.atan2(s, c); }
      else { const ref = X.polAcross([0, 0, 1], ...da) || X.polAcross([1, 0, 0], ...da), w = [da[1] * ref[2] - da[2] * ref[1], da[2] * ref[0] - da[0] * ref[2], da[0] * ref[1] - da[1] * ref[0]]; ang = Math.atan2(dot(a.pol, w), dot(a.pol, ref)); }
      ang = ((ang % Math.PI) + Math.PI) % Math.PI; H[Math.min(NB - 1, Math.floor(ang / Math.PI * NB))]++;
    }
    let ps = 0, psW = 0;
    for (let i = 0; i < 200; i++) { W.rays = []; const o = X.addExo('pPs', 0, 0, 0, 1, 0, undefined, 0, 0); X.psDecay(o, false); const g = W.rays.filter(q => !q.nu); if (g.length === 2 && g[0].pol && g[1].pol) { ps++; psW = Math.max(psW, Math.abs(g[0].pol[0] * g[1].pol[0] + g[0].pol[1] * g[1].pol[1] + g[0].pol[2] * g[1].pol[2])); } }
    W.rays = []; const at = X.addAtom('Na', 0, 0); X.emitPhoton(0, 0, 2.1, 1, 0, { src: at });
    const atomPol = W.rays.some(q => q.pol);
    W.rays = []; X.emitPhoton(-5, 0, 2.1, 1, 0, X.lightPol({}, 's', 1, 0, 0));
    const las = W.rays[0] && W.rays[0].pol;
    r[d3 ? 'd3' : 'flat'] = { perp, worst: +worst.toExponential(1), chi: +chi2(H, new Array(NB).fill(1)).toFixed(1), ps, psW: +psW.toExponential(1), atomPol, laser: las ? las.map(v => +v.toFixed(3)).join(',') : '' };
  }
  const ok = ['flat', 'd3'].every(k => r[k].perp === 3000 && r[k].worst < 1e-9 && r[k].chi < 35 && r[k].ps === 200 && r[k].psW < 1e-9 && !r[k].atomPol) && r.flat.laser === '0,0,1' && r.d3.laser === '0,0,1';
  check(ok, `1.27 realistic particles 7: annihilation pairs polarized at right angles (3,000 pairs and 200 para-Ps flat and 3-D, worst dot ${Math.max(r.flat.worst, r.d3.worst, r.flat.psW, r.d3.psW)}), each alone unpolarized (χ² of its angle ${r.flat.chi}, ${r.d3.chi}, 11 dof); an atom's light unpolarized; a laser across the plane (flat) or horizontal (3-D) along ${r.flat.laser} and ${r.d3.laser}`, 'rp7 sources: ' + JSON.stringify(r));
};
/* The pair's correlation (3-D, the Wu–Shaknov arrangement): both 511 keV photons of 300,000 annihilations Compton
   scattered (knScatter), each at 72–92°; coincidences with their scattering planes within 15° of perpendicular over
   those within 15° of parallel. A definite perpendicular pair a time (the classical picture) gives 1.565 with these
   windows (the formula averaged over them); the quantum state would give 2.577 (said in the notes, not made). */
PARTS.pairs = async (page, check) => {
  const X = load('all', { seed: 21 }), W = X.W; X.RP.pol = true; fresh(X, true);
  let perp = 0, par = 0; const N = 300000, lo = Math.cos(92 * Math.PI / 180), hi = Math.cos(72 * Math.PI / 180);
  for (let i = 0; i < N; i++) {
    const P = X.polPair([1, 0, 0], [-1, 0, 0]), a = X.knScatter(ME, 1, 0, 0, P[0]), b = X.knScatter(ME, -1, 0, 0, P[1]);
    if (a[1] < lo || a[1] > hi || -b[1] < lo || -b[1] > hi) continue;
    let d = Math.abs(Math.atan2(a[3], a[2]) - Math.atan2(b[3], b[2])) % Math.PI; if (d > Math.PI / 2) d = Math.PI - d;
    if (d > 75 * Math.PI / 180) perp++; else if (d < 15 * Math.PI / 180) par++;
  }
  const ratio = perp / par, sig = ratio * Math.sqrt(1 / perp + 1 / par);
  check(Math.abs(ratio - 1.565) < 3 * sig, `1.27 realistic particles 7: annihilation pairs Compton scattered at 72–92°: perpendicular over parallel coincidences ${ratio.toFixed(3)} ± ${sig.toFixed(3)} (${perp}/${par}; a definite perpendicular pair gives 1.565, the quantum state 2.577)`, 'rp7 pairs: ' + JSON.stringify({ perp, par, ratio }));
};
/* The optics (flat): an unpolarized beam on a prism face at Brewster's angle (tan θ_B = n) reflects only light polarized
   across the plane, at R = r_s²/2 (Fresnel); light polarized in the plane passes without reflecting there; at normal
   incidence 5.3% of each reflect ((n − 1)/(n + 1))². Two polarizers: an unpolarized beam passes the first one in two
   times, then the second at 0°, 30°, 60°, 90° to it as cos² (Malus). A mirror keeps light polarized across the plane
   across it. Books: every photon is either absorbed (escaped) or goes on: the ledger's escaped grows by exactly what
   left the beam. */
PARTS.optics = async (page, check) => {
  const r = {};
  const X = load('all', { seed: 16 }), W = X.W; X.RP.pol = true; fresh(X, false); W.box.w = 200; W.box.h = 200;
  const E = X.PHYS.HC / 589, n = X.PRISM_N(589), thB = Math.atan(n);
  // (a prism face as the piece x0..x1 along the y axis; the beam comes from the left (the face's left normal points left, the glass to the right)
  const shoot = (th, pol, N) => { // count reflected photons and their polarizations (dot with ẑ)
    W.objs.length = 0; X.objAdd('prism', 0, 20, 0, -20); let refl = 0, sOnly = 0;
    const ux = Math.cos(th), uy = Math.sin(th);
    for (let i = 0; i < N; i++) { W.rays = []; X.emitPhoton(-20 * ux, -20 * uy, E, ux, uy, pol ? { pol } : undefined);
      const rr = W.rays.filter(q => Math.abs(q.x0) < 1e-6 && Math.abs(q.y0) < 1e-6 && q.x1 < q.x0); // (a ray leaving the face back to the left from where the beam met it)
      if (rr.length) { refl++; if (rr[0].pol && Math.abs(rr[0].pol[2]) > 0.999) sOnly++; } }
    return { refl, sOnly };
  };
  const N = 4000, B = shoot(thB, null, N), Bp = shoot(thB, [Math.sin(thB), -Math.cos(thB), 0], N), N0 = shoot(0.001, null, N);
  const c = Math.cos(thB), ct = Math.sqrt(1 - (Math.sin(thB) / n) ** 2), rs = (c - n * ct) / (c + n * ct), R0 = ((n - 1) / (n + 1)) ** 2;
  r.brewster = { thB: +(thB * 180 / Math.PI).toFixed(1), refl: B.refl, sOnly: B.sOnly, expect: Math.round(N * rs * rs / 2), pRefl: Bp.refl, normal: N0.refl, expectNormal: Math.round(N * R0) };
  // two polarizers across a beam along +x: the first in the plane (0°), the second at α
  const mal = {};
  for (const a of [0, 30, 60, 90]) { W.objs.length = 0; X.objAdd('polarizer', 0, -10, 0, 10, { pa: 0 }); X.objAdd('polarizer', 10, -10, 10, 10, { pa: a });
    const sc = X.objAdd('screen', 20, -10, 20, 10); let got = 0; const M = 4000;
    for (let i = 0; i < M; i++) X.emitPhoton(-20, (X.rnd() - 0.5) * 4, E, 1, 0);
    got = sc.hits.light; mal[a] = +(got / (M / 2)).toFixed(3); }
  r.malus = mal;
  // a mirror at 45°: light polarized across the plane stays across it; in the plane, stays in it
  W.objs.length = 0; X.objAdd('mirror', -5, -5, 5, 5); W.rays = []; X.emitPhoton(-20, 0, E, 1, 0, { pol: [0, 0, 1] }); const m1 = W.rays[W.rays.length - 1].pol;
  W.rays = []; X.emitPhoton(-20, 0, E, 1, 0, { pol: [0, -1, 0] }); const m2 = W.rays[W.rays.length - 1], L2 = Math.hypot(m2.x1 - m2.x0, m2.y1 - m2.y0), m2c = X.polPS(m2.pol, (m2.x1 - m2.x0) / L2, (m2.y1 - m2.y0) / L2);
  r.mirror = { across: Math.abs(m1[2]).toFixed(6), inPlane: Math.abs(m2c[0]).toFixed(6) };
  // books: photons into two polarizers, each absorbed or out of the box: escaped grows by exactly their energy
  W.objs.length = 0; X.objAdd('polarizer', 0, -10, 0, 10, { pa: 0 }); X.objAdd('polarizer', 10, -10, 10, 10, { pa: 45 });
  const esc0 = W.ledger.escaped, K = 500; for (let i = 0; i < K; i++) X.emitPhoton(-20, 0, E, 1, 0); r.books = +Math.abs(W.ledger.escaped - esc0 - K * E).toExponential(1);
  const sd = (x) => 3.5 * Math.sqrt(Math.max(1, x));
  const b = r.brewster, ok = Math.abs(b.thB - 58.1) < 0.6 && Math.abs(b.refl - b.expect) < sd(b.expect) && b.sOnly === b.refl && b.pRefl === 0 && Math.abs(b.normal - b.expectNormal) < sd(b.expectNormal)
    && [0, 30, 60, 90].every(a => Math.abs(mal[a] - Math.cos(a * Math.PI / 180) ** 2) < 0.06) && r.mirror.across === '1.000000' && r.mirror.inPlane === '1.000000' && r.books < 1e-9;
  check(ok, `1.27 realistic particles 7: a prism face at Brewster's angle (${b.thB}°) reflects ${b.refl} of ${N} unpolarized photons (Fresnel ${b.expect}), all polarized across the plane, none of ${N} polarized in it; straight on ${b.normal} (${b.expectNormal}); two polarizers pass ${[0, 30, 60, 90].map(a => mal[a]).join(', ')} of the first's light at 0°, 30°, 60°, 90° (cos²: 1, 0.75, 0.25, 0); a mirror keeps across and in-plane polarization; books within ${r.books} eV`, 'rp7 optics: ' + JSON.stringify(r));
};
/* Books with the switch on. (a) Exact: Compton events on a lone water molecule's O and H, flat and 3-D, 200 each at
   0.3–4 MeV, the books before and after each with the photon's own energy added (it is in the books only once it
   leaves or is taken). Found, not changed (the same with the switch off): in the flat game ejectElectron books 100–200
   eV wrong for an electron set free with 0.7–1.3 keV, launched past radThreshold (1 keV) into radiation flight with the
   potential energy its launch counted on (PERF-NOTES); such events are counted apart ("known"; Klein–Nishina's forward
   scattering makes them a little more often). (b) A running box of liquid water with γ rays fired in, every Compton event
   wrapped, on and off: in a box the ionized water's own limit (CLAUDE.md) gives events of 0.5–2.5 eV either way; on must
   be no worse than off by more than that. */
PARTS.books = async (page, check) => {
  const r = {};
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 17 }), W = X.W; X.RP.pol = true; fresh(X, d3);
    let worst = 0, n = 0, known = 0;
    for (let i = 0; i < 200; i++) {
      for (const p of W.parts) X.kill(p); W.parts = []; W.rays = [];
      const w = X.addMolecule('H2O', 0, 0, 0, 0); for (const p of W.parts) { p.vx = p.vy = p.vz = 0; } X.forcesNoEvents();
      const at = w[i % 3], E = [3e5, 662e3, 1.33e6, 4e6][i % 4], E0 = books(X) + E, n0 = W.parts.length, u = X.rnd() * 2 * Math.PI;
      if (d3) X.compton3(at, E, Math.cos(u), Math.sin(u), 0, null); else X.compton(at, E, Math.cos(u), Math.sin(u), null);
      const d = Math.abs(books(X) - E0); n++;
      if (d > 1e-4 && !d3 && W.parts.slice(n0).some(e => e.k === X.ELEC && e.rad && e.KE < 1500)) known++; else worst = Math.max(worst, d);
    }
    r[d3 ? 'd3' : 'flat'] = { n, worst: +worst.toExponential(1), known };
  }
  for (const on of [false, true]) {
    const X = load('all', { seed: 17 }), W = X.W; X.RP.pol = on;
    X.PRESETS.water.build(); X.settleOverlaps(); W.gamma = 0; X.forcesNoEvents(); W.fSpawn = W.spawned;
    let worst = 0, nev = 0, known = 0;
    const g = X.compton; X.compton = function (...a) { const E0 = books(X) + a[1], n0 = W.parts.length; const out = g.apply(this, a); const d = Math.abs(books(X) - E0); nev++;
      if (d > 1e-4 && W.parts.slice(n0).some(e => e.k === X.ELEC && e.rad && e.KE < 1500)) known++; else worst = Math.max(worst, d); return out; };
    for (let i = 0; i < 60; i++) {
      if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; }
      if (i % 3 === 0) for (let j = 0; j < 15; j++) { const u = X.rnd() * 2 * Math.PI, E = [3e5, 662e3, 1.33e6, 4e6][j % 4]; X.emitPhoton(0, 0, E, Math.cos(u), Math.sin(u)); }
      W.dt = X.chooseDt(); X.step(W.dt);
    }
    r[on ? 'boxOn' : 'boxOff'] = { events: nev, worst: +worst.toFixed(2), known };
  }
  check(r.flat.n === 200 && r.d3.n === 200 && r.flat.worst < 1e-5 && r.d3.worst < 1e-5 && r.boxOn.events > 20 && r.boxOn.worst < r.boxOff.worst + 2.5,
    `1.27 realistic particles 7: books with the switch on: 200 Compton events on water's O and H flat and 3-D exact to ${Math.max(r.flat.worst, r.d3.worst)} eV (flat ${r.flat.known} with ejectElectron's known 1 keV slip, the same off); γ rays into running liquid water, worst event on ${r.boxOn.worst} eV, off ${r.boxOff.worst} eV (${r.boxOn.events} and ${r.boxOff.events} events: the ionized water's own limit)`, 'rp7 books: ' + JSON.stringify(r));
};
/* The Settings row (page): one more compact line in Realistic particles, after Nuclear spin …, with its cost tag, switch
   and side-pane description; it sets RP.pol, is saved, and is off again at start (SET_EXP). With it on the Light tool
   offers its polarization and the Objects tool a polarizer, and Inspect shows a laser photon's polarization; off, none. */
PARTS.page = async (page, check) => {
  const r = await page.evaluate(() => {
    document.querySelectorAll('.modal').forEach(m => { m.hidden = true; });
    loadPreset('empty'); openSettings('exp');
    const pane = document.querySelector('section[data-stab="exp"]'), lines = [...pane.querySelectorAll('.rpl')], ids = lines.map(l => (l.querySelector('[id]') || {}).id);
    const o = { ids: ids.join(','), tags: lines.map(l => !!l.querySelector('.cost-k')).every(Boolean), h: lines.map(l => Math.round(l.getBoundingClientRect().height)) };
    o.sw = $('setRpPol').getAttribute('role') === 'switch';
    setPrevShow('setRpPol', null); o.pane = $('setPrevT').textContent;
    o.start = [SET.rpPol, RP.pol].join();
    $('setRpPol').click(); o.on = [SET.rpPol, RP.pol].join(); o.saved = String(JSON.parse(store('settings')).rpPol);
    o.exp = SET_EXP.includes('rpPol');
    hideModal('setModal');
    setTool('light'); o.lightOpt = !!document.querySelector('[data-g="pol"]');
    setTool('objects'); o.objOpt = [...document.querySelectorAll('[data-g="kind"] [data-v]')].map(b => b.dataset.v).includes('polarizer');
    setRunning(false); W.rays = []; W.flights = [];
    emitPhoton(-10, 0, lightE(), 1, 0, lightPol({ travel: true }, 'p', 1, 0));
    R.sel = null; R.selX = { kind: 'flight', o: W.flights[0] }; showTab('inspect', true); renderInspect(); o.ins = $('tp-inspect').textContent;
    setSetting('rpPol', false); renderInspect(); o.off = $('tp-inspect').textContent;
    setTool('light'); o.lightOff = !!document.querySelector('[data-g="pol"]');
    R.selX = null; W.flights = []; setTool('inspect'); return o;
  });
  const ids = r.ids.split(','), iN = ids.indexOf('setRpNuc'), iP = ids.indexOf('setRpPol');
  const ok = ids.slice(0, 3).join() === 'setUltra,segWave,setRpExo' && iP === iN + 1 && r.tags && r.sw && r.h[iP] < 34 && r.pane === 'Photon polarization' && r.start === 'false,false' && r.on === 'true,true' && r.saved === 'true' && r.exp
    && r.lightOpt && r.objOpt && /Polarizationlinear, in the plane/.test(r.ins) && !/Polarization/.test(r.off) && !r.lightOff;
  check(ok, `1.27 Settings: Realistic particles ends ${ids.slice(-2).join(', ')} (${r.h[iP]} px), with its cost tag and switch; on, the Light tool offers polarization, the Objects tool a polarizer, Inspect shows "linear, in the plane"; off, none of it`, 'rp7 page: ' + JSON.stringify(Object.assign({}, r, { ins: (r.ins.match(/Polarization[^]{0,80}/) || [r.ins.slice(0, 200)])[0], off: r.off.slice(0, 100) })));
};
PARTS.page.page = true;
module.exports = async function frp7(page, check, say, openPage, only) {
  if (!openPage) openPage = require('./browser').openPage;
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (rp7 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `rp7 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 realistic particles 7 checks passed');
  process.exitCode = fails ? 1 : 0;
})();
