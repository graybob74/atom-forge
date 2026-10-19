'use strict';
/* Accelerators: the linear collider delivers its set energy to the collision point; the rings (one shared ring for
   a particle and its antiparticle, a ring each otherwise) capture their beams with the RF and ramp them to full
   energy without losing any, the bunches following the RF program, keep them apart until then, and collide them;
   the beam–beam kick follows its formula; close passes scatter with energy and momentum kept; electric fields bend
   fast particles; an electron on a circle
   loses the synchrotron energy per turn that Larmor's formula predicts; energy readouts switch units at each
   factor of 1000; slow motion on demand holds the fastest particle to ~2% of the box per frame. Node only.
   node tests/t_collider.js */
const { load } = require('./load');
let fails = 0;
const bad = (m) => { fails++; console.log('FAIL', m); };
const info = (m) => console.log('  ' + m);

// 1. energy units
{
  const X = load('all');
  const cases = [[0.05, '50.0 meV'], [999, '999 eV'], [1500, '1.50 keV'], [2.5e6, '2.50 MeV'], [1000e6, '1.00 GeV'], [1.88e9, '1.88 GeV'], [6.8e12, '6.80 TeV'], [-3e9, '-3.00 GeV'], [999.7, '1.00 keV'], [999.4e3, '999 keV'], [0, '0 eV']];
  for (const [v, want] of cases) { const got = X.fmtE(v); if (got !== want) bad(`fmtE(${v}) = ${got}, expected ${want}`); }
  info(`energy units: ${cases.map(([v]) => X.fmtE(v)).join(', ')}`);
  // thousands to trillions are written out, never as powers of ten (those only for the tiny and the vast)
  const big = [1234, 12345, 999999, 4.5e6, 3e8, 6e9, 6e13].map(x => `${X.fmtNum(x)} / ${X.fmtFactor(x)}`), tiny = [X.fmtNum(5e-4), X.fmtFactor(3e28)];
  info(`big numbers: ${big.join(', ')}; tiny and vast: ${tiny.join(', ')}`);
  if (big.some(t => /e[+-]|×10/.test(t))) bad(`big numbers in powers of ten: ${big.join(', ')}`);
  if (!tiny.every(t => /×10/.test(t))) bad(`tiny and vast numbers should keep powers of ten: ${tiny.join(', ')}`);
}

// 2. linear collider: each beam reaches the collision point with the set energy, and they collide (an electron and
//    a proton, which can only scatter, as well)
for (const [a, b, E, E2] of [['pos', 'e', 1e6], ['p', 'pbar', 1e6], ['d', 't', 2e5], ['e', 'p', 1e6], ['p', 'pbar', 1e6, 3e6]]) {
  const X = load('all', { seed: 3 });
  const { W } = X;
  X.PRESETS.linac.build(); X.setupCollider('linear', a, b, E, E2);
  X.settleOverlaps(); W.baseSpf = W.simPerFrame;
  const atIP = { a: [], b: [] };
  for (let f = 0; f < (E2 ? 600 : 1500); f++) {
    X.simFrame(1 / 60, 1e9);
    for (const p of W.parts) if (p.beam && !p.dead && p.rad && Math.abs(p.x) < 2 && !p._ip) { p._ip = 1; atIP[p.beam].push(p.KE); }
  }
  const mean = (v) => v.reduce((x, y) => x + y, 0) / Math.max(1, v.length), m = mean(atIP.a), m2 = mean(atIP.b);
  info(`linear ${a} + ${b} at ${X.fmtE(E)}${E2 ? ' and ' + X.fmtE(E2) : ''}: ${atIP.a.length} of beam 1 reached the collision point with ${X.fmtE(m)} on average${E2 ? `, beam 2 with ${X.fmtE(m2)}` : ''}; ${W.collider.hits} collisions (last: ${W.collider.last})`);
  if (!atIP.a.length || Math.abs(m / E - 1) > 0.03) bad(`linear ${a} + ${b}: mean energy at the collision point ${X.fmtE(m)}, set ${X.fmtE(E)}`);
  if (E2 && (!atIP.b.length || Math.abs(m2 / E2 - 1) > 0.03)) bad(`linear ${a} + ${b}: beam 2 reached the collision point with ${X.fmtE(m2)}, set ${X.fmtE(E2)}`);
  if (!(W.collider.hits > 0)) bad(`linear ${a} + ${b}: no collisions`);
}

// 2b. the beam menu's nuclei, light to actinide: bare-nucleus masses as measured (atomic masses less the electrons),
//     and a calcium-48 beam meeting a californium-249 beam (the pair that made oganesson) arrives with its set
//     energy and collides
{
  const X = load('all', { seed: 5 });
  const atomic = { li6: 6.0151229, be9: 9.0121831, n14: 14.0030740, ne20: 19.9924402, ca48: 47.9525228, ni64: 63.9279668, kr84: 83.9114977,
    xe129: 128.9047809, bi209: 208.9803991, th232: 232.0380558, pu244: 244.0642053, cm248: 248.0723499, cf249: 249.0748539 };
  let worst = 0;
  for (const [k, m] of Object.entries(atomic)) {
    if (!X.BEAM_SPECIES[k]) { bad(`no ${k} in the beam menu`); continue; }
    const I = X.beamInfo(k), d = I.m - (m - I.Z * X.PHYS.ME);
    worst = Math.max(worst, Math.abs(d));
    if (Math.abs(d) > 0.02) bad(`${k}: mass ${I.m.toFixed(4)} u, measured ${(m - I.Z * X.PHYS.ME).toFixed(4)} u`);
  }
  const groups = [...new Set(Object.values(X.BEAM_SPECIES).map(s => s.g))];
  info(`beam menu: ${Object.keys(X.BEAM_SPECIES).length} species in ${groups.length} groups (${groups.join(', ')}); nuclear masses within ${(worst * 931494).toFixed(0)} keV`);
  const { W } = X;
  X.PRESETS.linac.build(); X.setupCollider('linear', 'ca48', 'cf249', 2.5e8);
  X.settleOverlaps(); W.baseSpf = W.simPerFrame;
  const atIP = [];
  for (let f = 0; f < 1500; f++) {
    X.simFrame(1 / 60, 1e9);
    for (const p of W.parts) if (p.beam === 'a' && !p.dead && Math.abs(p.x) < 2 && !p._ip) { p._ip = 1; atIP.push(p.KE); }
  }
  const m = atIP.reduce((x, y) => x + y, 0) / Math.max(1, atIP.length);
  info(`linear ⁴⁸Ca + ²⁴⁹Cf at 250 MeV each: ${atIP.length} calcium nuclei reached the collision point with ${X.fmtE(m)} on average; ${W.collider.hits} collisions (last: ${W.collider.last})`);
  if (!atIP.length || Math.abs(m / 2.5e8 - 1) > 0.03) bad(`⁴⁸Ca + ²⁴⁹Cf: mean energy at the collision point ${X.fmtE(m)}, set 250 MeV`);
  if (!(W.collider.hits > 0)) bad('⁴⁸Ca + ²⁴⁹Cf: no collisions');
}

// 2c. any element, any isotope: every isotope offered holds together, the default is one of them, and a beam of an
//     isotope never measured (oganesson-356, its half-life estimated) meets californium-249 and makes new nuclei,
//     each listed (W.made) with how many and the reaction that first made it
{
  const X = load('all', { seed: 4 });
  const { W } = X;
  let offered = 0, badIso = 0;
  for (let Z = 1; Z <= 118; Z++) {
    const As = X.beamIsotopes(Z); offered += As.length;
    for (const A of As) if (X.nuclideInfo(Z, A - Z).unbound) badIso++;
    if (!As.length || !As.includes(X.defaultBeamA(Z))) bad(`element ${Z}: isotopes ${As.join(',')}, default ${X.defaultBeamA(Z)}`);
  }
  if (badIso) bad(`${badIso} unbound isotopes offered as beams`);
  const k = X.beamKey(118, 356), k2 = X.beamKey(98, 249), I = X.beamInfo(k);
  if (X.beamKey(20, 48) !== 'ca48' || X.beamKey(1, 2) !== 'd' || X.beamKey(2, 4) !== 'a') bad('popular beams should keep their own entries');
  X.PRESETS.linac.build(); X.setupCollider('linear', k, k2, 2e9);
  X.settleOverlaps(); W.baseSpf = W.simPerFrame;
  for (let f = 0; f < 1800; f++) { X.simFrame(1 / 60, 30); if (f >= 899 && W.made && W.made.nuc.size) break; } // (a second chance when a loaded machine cuts frames short)
  const nuc = W.made ? [...W.made.nuc.values()].filter(r => r.Z > 0) : [];
  const ok = nuc.length && nuc.every(r => r.n > 0 && / → /.test(r.how)) && W.made.nuc.size;
  info(`any isotope: ${offered} isotopes of 118 elements offered; ${I.lab} (${I.m.toFixed(2)} u) on ²⁴⁹Cf at 2 GeV each: ${W.collider.hits} collisions, ${nuc.length} kinds of nuclei made (heaviest ${nuc.length ? nuc.sort((a, b) => b.Z - a.Z)[0].lab : '—'})`);
  if (!ok) bad(`³⁵⁶Og + ²⁴⁹Cf: nothing listed as made (${W.collider.hits} collisions)`);
}

// 3. rings: a particle and its antiparticle share one ring, any other pair gets a ring each. Injected trains are
//    captured by the RF and ramped to full energy without losses, the bunch's mean energy following the RF program
//    (synchronous energy) and the magnets the beam's momentum; they are kept apart until then, and collide.
for (const [a, b, E, layout] of [['pos', 'e', 2e6, 'single'], ['p', 'pbar', 2e6, 'single'], ['p', 'pbar', 2e7, 'single'], ['d', 't', 6e4, 'double'], ['p', 'au197', 2e7, 'double'], ['e', 'e', 2e6, 'double']]) {
  const X = load('all', { seed: 3 });
  const { W } = X;
  X.PRESETS.ring.build(); X.setupCollider('ring', a, b, E);
  X.settleOverlaps(); W.baseSpf = W.simPerFrame;
  const C = W.collider, Ea = C.EA || E, Eb = C.EB || E;
  let meanA = 0, meanB = 0, lostRamp = 0, colAt = -1, fieldErr = 0, near = Infinity, follow = 0, spread = 0;
  const hist = [];
  const f0 = W.count.fusion;
  const seen = new Set();
  for (let f = 0; f < 1500; f++) {
    X.simFrame(1 / 60, 1e9);
    if (C.colliding && colAt < 0) colAt = f;
    const alive = new Set(), sum = { a: [0, 0], b: [0, 0] };
    for (const p of W.parts) {
      if (!p.beam || p.dead) continue;
      alive.add(p); seen.add(p);
      if (!p.injKick && sum[p.beam]) { sum[p.beam][0] += p.KE; sum[p.beam][1]++; }
    }
    if (!C.colliding) {
      for (const p of seen) if (!alive.has(p) && !p._counted) { p._counted = 1; if (!W.collider.hits) lostRamp++; }
      if (sum.a[1]) meanA = Math.max(meanA, sum.a[0] / sum.a[1]);
      if (sum.b[1]) meanB = Math.max(meanB, sum.b[0] / sum.b[1]);
      // the two beams pass no closer than this while they are kept apart (where they cross), on their way to the first collisions
      const A = W.parts.filter(p => p.beam === 'a' && !p.dead), B = W.parts.filter(p => p.beam === 'b' && !p.dead);
      if (colAt < 0) for (const p of A) for (const q of B) { const d = Math.hypot(p.x - q.x, p.y - q.y); if (d < near) near = d; }
      // the bunch follows the RF program: its mean energy, averaged over a turn (it gains at the cavities, the
      // program rises smoothly), stays near the synchronous energy, and its spread is bounded
      for (const [gi, g] of C.rings.entries()) {
        if (!g.running || !(g.cnt >= g.N)) continue;
        const ks = W.parts.filter(p => p.beam && !p.dead && !p.injKick && (!g.beam || p.beam === g.beam) && (g.beam || p.beam === 'a')).map(p => p.KE / g.Es - 1);
        if (ks.length < 3) continue;
        const m = ks.reduce((x, y) => x + y, 0) / ks.length, sd = Math.sqrt(ks.reduce((x, y) => x + (y - m) ** 2, 0) / ks.length);
        const h = (hist[gi] = hist[gi] || []), gam = 1 + g.Es / (g.m * X.AMU_EV), Trev = g.circ / (X.PHYS.C * Math.sqrt(1 - 1 / (gam * gam)));
        h.push([W.t, m]); while (h.length && h[0][0] < W.t - Trev) h.shift();
        if (W.t - (h.t0 = h.t0 || W.t) > 2 * Trev) follow = Math.max(follow, Math.abs(h.reduce((x, y) => x + y[1], 0) / h.length));
        spread = Math.max(spread, sd);
      }
    }
    for (const g of C.rings) { // the bending field follows the momentum, B = p/(qρ) (× the separation's extra while apart)
      let s = 0, n = 0;
      for (const p of W.parts) if (p.rad && !p.dead && p.beam && !p.injKick && (!g.beam || p.beam === g.beam)) { s += p.gam * (p.k === X.NUC ? p.m : X.PHYS.ME) * p.sp / Math.abs(p.k === X.NUC ? (p.Z - p.ne) || p.Z : 1); n++; }
      if (n > 2 && g.running && !C.colliding) fieldErr = Math.max(fieldErr, Math.abs(Math.abs(g.dip[0].B) * X.PHYS.LOR * g.rho / (s / n * (1 + g.sepB * g.sep)) - 1));
    }
  }
  info(`ring ${a} + ${b} at ${X.fmtE(Ea)}/${X.fmtE(Eb)} (${C.layout}): bunches' mean energy up to ${X.fmtE(meanA)}/${X.fmtE(meanB)}, within ${(100 * follow).toFixed(1)}% of the RF program (spread ≤ ${(100 * spread).toFixed(1)}%), ${lostRamp} lost on the way, beams no closer than ${near.toFixed(1)} Å while apart, colliding from frame ${colAt}, ${C.hits} collisions${W.count.fusion > f0 ? `, ${W.count.fusion - f0} fusions` : ''}`);
  if (C.layout !== layout) bad(`ring ${a} + ${b}: ${C.layout} layout, expected ${layout}`);
  if (colAt < 0 || meanA < 0.9 * Ea) bad(`ring ${a} + ${b}: never brought into collision (beam 1 reached ${X.fmtE(meanA)})`);
  if (meanA > 1.04 * Ea || meanB > 1.04 * Eb) bad(`ring ${a} + ${b}: overshot its energy (${X.fmtE(meanA)}, ${X.fmtE(meanB)})`);
  if (follow > 0.06) bad(`ring ${a} + ${b}: the bunch strayed ${(100 * follow).toFixed(1)}% from the synchronous energy`);
  if (lostRamp) bad(`ring ${a} + ${b}: ${lostRamp} beam particles lost while being sped up`);
  if (near < 1.0) bad(`ring ${a} + ${b}: the beams passed within ${near.toFixed(2)} Å while they were to be kept apart`);
  if (!(C.hits > 0)) bad(`ring ${a} + ${b}: no collisions`);
  if (a === 'd' && !(W.count.fusion > f0)) bad('ring d + t: no fusions');
  if (fieldErr > 0.15) bad(`ring ${a} + ${b}: field off p/(qρ) by ${(100 * fieldErr).toFixed(0)}%`);
  const note = X.scaleNote(C);
  if (!/LHC/.test(note) || !/T\b/.test(note)) bad(`ring ${a} + ${b}: real-world scale note missing: ${note}`);
}

// 3a. off-phase particles are lost: a proton put on the bunch's orbit and energy but half an RF wavelength behind
//     it (outside the RF bucket) falls behind the ramp and is lost, while the bunch is kept
{
  const X = load('all', { seed: 3 });
  const { W } = X;
  X.PRESETS.ring.build(); X.setupCollider('ring', 'p', 'pbar', 2e6);
  X.settleOverlaps(); W.baseSpf = W.simPerFrame;
  const C = W.collider; C.auto = false;
  let rec = null, late = null, n0 = 0;
  for (let f = 0; f < 800 && !C.colliding; f++) {
    X.simFrame(1 / 60, 1e9);
    const g = C.rings[0];
    if (!rec && g.running && g.cnt >= g.N) { // where the bunch's first particle is now; the stray goes there half a wavelength later
      const ref = W.parts.find(p => p.beam === 'a' && !p.dead && !p.injKick);
      if (ref) rec = { x: ref.x, y: ref.y, ux: ref.ux, uy: ref.uy, KE: ref.KE, t: W.t + C.circ / g.h / 2 / ref.sp };
    } else if (rec && !late && W.t >= rec.t) {
      late = X.fireSpec(X.beamInfo('p').spec, rec.x, rec.y, rec.ux, rec.uy, rec.KE); late.beam = 'a';
      n0 = W.parts.filter(p => p.beam === 'a' && !p.dead && p !== late).length;
    }
  }
  const kept = W.parts.filter(p => p.beam === 'a' && !p.dead && p !== late).length;
  info(`a proton half an RF wavelength behind its bunch: ${late ? (late.dead ? 'lost before full energy' : `still there at ${X.fmtE(late.KE)} (bunch ${X.fmtE(C.rings[0].Es)})`) : 'not placed'}; ${kept} of the bunch's ${n0} kept`);
  if (!late || !late.dead) bad('a particle outside the RF bucket was not lost');
  if (kept < n0) bad(`the bunch lost ${n0 - kept} particles`);
}

// 3a'. a particle and its antiparticle at different energies need a ring each; their bunches, at different speeds,
//      meet in the detector only now and then, but they do. Kept apart, beams go round at full energy without
//      colliding; let together (auto), they collide.
{
  const X = load('all', { seed: 3 });
  const { W } = X;
  X.PRESETS.ring.build(); X.setupCollider('ring', 'p', 'pbar', 2e6, 5e6);
  X.settleOverlaps(); W.baseSpf = W.simPerFrame;
  const C = W.collider; C.auto = false;
  let topA = 0, topB = 0, f = 0;
  for (; f < 1400 && !(C.hits > 0); f++) {
    X.simFrame(1 / 60, 1e9);
    if (!C.colliding) for (const [k, g] of [['a', C.rings[0]], ['b', C.rings[1]]]) { const ps = W.parts.filter(p => p.beam === k && !p.dead && !p.injKick); if (ps.length) { const m = ps.reduce((s, p) => s + p.KE, 0) / ps.length; if (k === 'a') topA = Math.max(topA, m); else topB = Math.max(topB, m); } }
  }
  info(`ring p + p̄ at 2 MeV and 5 MeV: ${C.layout} layout, bunches up to ${X.fmtE(topA)} and ${X.fmtE(topB)}, first collision at frame ${C.hits ? f : '—'} (${C.last.slice(0, 50)})`);
  if (C.layout !== 'double') bad(`p + p̄ at different energies: ${C.layout} layout, expected a ring each`);
  if (topA < 0.9 * 2e6 || topB < 0.9 * 5e6 || topA > 1.06 * 2e6 || topB > 1.06 * 5e6) bad(`p + p̄ at different energies: bunches reached ${X.fmtE(topA)} and ${X.fmtE(topB)}`);
  if (!(C.hits > 0)) bad('p + p̄ at different energies: no collisions');
}
{
  const X = load('all', { seed: 3 });
  const { W } = X;
  X.PRESETS.ring.build(); X.setupCollider('ring', 'p', 'pbar', 2e6);
  X.settleOverlaps(); W.baseSpf = W.simPerFrame;
  const C = W.collider; C.auto = false; C.sepMode = 'apart';
  for (let f = 0; f < 850; f++) X.simFrame(1 / 60, 1e9);
  const g = C.rings[0], n = W.parts.filter(p => p.beam && !p.dead).length, hitsApart = C.hits, sepApart = g.sep;
  C.sepMode = 'auto';
  let f = 0; for (; f < 400 && !(C.hits > 0); f++) X.simFrame(1 / 60, 1e9);
  info(`kept apart: ${n} beam particles going round at ${X.fmtE(g.Es)} (${g.ramping ? 'still speeding up' : 'full energy'}), separation ${sepApart.toFixed(2)}, ${hitsApart} collisions; let together, the first collision came ${C.hits ? f + ' frames later' : 'never'}`);
  if (sepApart < 0.99) bad(`beams kept apart ran at separation ${sepApart.toFixed(2)}`);
  if (hitsApart) bad(`beams kept apart collided ${hitsApart} times`);
  if (g.ramping || n < 20) bad(`beams kept apart: ${n} of 20 at ${X.fmtE(g.Es)}`);
  if (!(C.hits > 0)) bad('beams let together never collided');
}

// 3b. beam–beam kick: a charge passing another at distance b turns by Δp/p = 2k·q₁q₂(1 + β₁β₂)·g(b)/(v_rel·p), where
//     g(b) = (1 − e^(−b²/2σ²))/b is a point charge's 1/b spread over a smooth bunch
{
  const X = load('all', { seed: 1 });
  const { W } = X;
  X.clearWorld(); W.box.w = W.box.tw = 200; W.box.h = W.box.th = 200;
  const KE = 2e6, A = X.beamInfo('pos'), B = X.beamInfo('e');
  const a = X.fireSpec(A.spec, 0, 0, 1, 0, KE), b = X.fireSpec(B.spec, 0, 1.5, -1, 0, KE);
  const C = { bbN: 1000, bunch: 10 }, d = 1.5;
  X.beamBeam(C, a, b, 0, 1.5, d);
  const pc = Math.sqrt(KE * KE + 2 * KE * X.ME_C2), beta = pc / (KE + X.ME_C2), v = beta * X.PHYS.C;
  const want = 2 * X.PHYS.KE * 1 * (1 + beta * beta) * (1 - Math.exp(-d * d / (2 * X.BB_SIG ** 2))) / d / (2 * v) * (C.bbN / C.bunch) / (pc / X.PHYS.C), got = Math.atan2(a.uy, a.ux);
  info(`beam–beam: a 2 MeV positron passing an electron bunch 1.5 Å away turns ${(got * 1e3).toFixed(2)} mrad toward it (formula ${(want * 1e3).toFixed(2)} mrad)`);
  if (!(got > 0) || Math.abs(got / want - 1) > 0.02) bad(`beam–beam kick ${got.toExponential(3)}, expected ${want.toExponential(3)} toward the other bunch`);
}

// 3c. close passes scatter elastically: energy and momentum are kept exactly (relativistic kinematics)
{
  const X = load('all', { seed: 1 });
  const { W } = X;
  X.clearWorld(); W.box.w = W.box.tw = 200; W.box.h = W.box.th = 200;
  let worst = 0;
  for (const [ka, kb, Ea, Eb, ang] of [['p', 'p', 2e6, 2e6, Math.PI], ['d', 't', 3e5, 3e5, Math.PI], ['e', 'p', 2e6, 3e9, Math.PI], ['p', 'au197', 2e7, 4e9, 2.5]]) {
    const A = X.beamInfo(ka), B = X.beamInfo(kb);
    const a = X.fireSpec(A.spec, 0, 0, 1, 0, Ea), b = X.fireSpec(B.spec, 5, 0.3, Math.cos(ang), Math.sin(ang), Eb);
    const P = (q) => { const m = X.restE(q), E = m + X.keOf(q), p = Math.sqrt(E * E - m * m); return [E, p * q.ux, p * q.uy]; };
    const sum = () => [P(a), P(b)].reduce((s, v) => s.map((x, i) => x + v[i]), [0, 0, 0]);
    const s0 = sum(); X.nuclearScatter(a, b, 0.3, 0, 0.3, X.R_BEAM); const s1 = sum();
    worst = Math.max(worst, ...s0.map((x, i) => Math.abs(s1[i] - x) / s0[0]));
    X.kill(a); X.kill(b);
  }
  info(`elastic scattering keeps energy and momentum to ${worst.toExponential(1)} of the total energy`);
  if (worst > 1e-9) bad(`elastic scattering changes energy or momentum by ${worst.toExponential(2)}`);
}

// 3d. an electric field across a fast particle's path bends it: θ = qE·L / (p·v)
{
  const X = load('all', { seed: 1 });
  const { W, PHYS } = X;
  X.clearWorld(); W.box.w = W.box.tw = 400; W.box.h = W.box.th = 400; W.gamma = 0; W.wall = 'open'; W.Ey = 5;
  const KE = 1e6, p = X.fireSpec({ kind: 'atom', Z: 1, A: 1, bare: true }, -150, 0, 1, 0, KE);
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  while (p.x < 150 && !p.dead) X.step(Math.min(X.chooseDt(), 0.5 / p.sp));
  const th = Math.atan2(p.uy, p.ux), m = p.m * X.AMU_EV, pc = Math.sqrt(KE * KE + 2 * KE * m), beta = pc / (KE + m), want = W.Ey * 300 / (pc * beta);
  info(`a 1 MeV proton across 5 V/Å over 300 Å turns ${(th * 1e3).toFixed(3)} mrad (qEL/pv = ${(want * 1e3).toFixed(3)} mrad)`);
  if (Math.abs(th / want - 1) > 0.05) bad(`electric deflection ${th.toExponential(3)} rad, expected ${want.toExponential(3)}`);
}

// 3e. trails: past the cap, beam particles' trails go first, so the spray from a big collision outlasts the next bunch
{
  const X = load('all', { seed: 9 });
  const { W } = X;
  W.tracks.length = 0;
  for (let i = 0; i < 300; i++) X.keepTrack({ pts: [0, 0], c: [255, 0, 0], w: 1, t0: 0, upd: 0, beam: false });
  for (let i = 0; i < 1000; i++) X.keepTrack({ pts: [0, 0], c: [0, 0, 255], w: 1, t0: 0, upd: 0, beam: true });
  const spray = W.tracks.filter(t => !t.beam).length;
  info(`trails: ${spray} of 300 collision trails kept while 1000 beam particles came through (${W.tracks.length} trails, cap ${X.TRACK_MAX})`);
  if (spray !== 300 || W.tracks.length > X.TRACK_MAX) bad(`trails: ${spray} of 300 collision trails kept, ${W.tracks.length} in all`);
}

// 3f. flashes mark events without piling up into glaring clouds: twenty events in one spot within a frame leave two
//     flashes there, while one elsewhere still gets its own
{
  const X = load('all', { seed: 3 });
  const { W } = X;
  W.flashes.length = 0;
  for (let i = 0; i < 20; i++) X.flash(0.5 * Math.random(), 0.5 * Math.random(), [255, 225, 170], 6, 0.7);
  X.flash(40, 0, [255, 225, 170], 6, 0.7);
  info(`flashes: 21 events (20 in one spot) leave ${W.flashes.length} flashes`);
  if (W.flashes.length !== 3) bad(`flashes: 21 events (20 in one spot) left ${W.flashes.length} flashes, expected 3`);
}

// 4. synchrotron radiation: energy lost per turn by an electron on a circle, (4π/3)(ke²/R)γ⁴β³
for (const KE of [2e6, 5e6]) { // (losses well under 1% a turn, so the formula for a steady orbit applies)
  const X = load('all', { seed: 1 });
  const { W, PHYS } = X;
  X.clearWorld(); W.box.w = W.box.tw = 160; W.box.h = W.box.th = 160; W.gamma = 0; W.wall = 'open';
  const R = 50, pc = Math.sqrt(KE * KE + 2 * KE * X.ME_C2);
  W.zones.push({ kind: 'dipole', ring: true, cx: 0, cy: 0, r0: R - 7, r1: R + 7, R0: R, n: 0, B: pc / PHYS.C / (PHYS.LOR * R) }); // (an electron going +x at the bottom curves up into the circle)
  const e = X.fireSpec({ kind: 'e' }, 0, -R, 1, 0, KE);
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  const g = 1 + KE / X.ME_C2, b = Math.sqrt(1 - 1 / (g * g)), T = 2 * Math.PI * R / (b * PHYS.C);
  let t = 0, rmin = 1e9, rmax = 0;
  while (t < T) { const dt = Math.min(X.chooseDt(), T - t); X.step(dt); t += dt; const r = Math.hypot(e.x, e.y); rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); }
  const lost = KE - e.KE + (e.srad || 0), want = 4 * Math.PI / 3 * PHYS.KE / R * g ** 4 * b ** 3;
  info(`synchrotron loss at ${X.fmtE(KE)}: ${X.fmtE(lost)} per turn (formula ${X.fmtE(want)}); orbit ${rmin.toFixed(1)}–${rmax.toFixed(1)} Å`);
  if (e.dead || !e.rad) bad(`synchrotron test: the electron was lost`);
  else if (Math.abs(lost / want - 1) > 0.05) bad(`synchrotron loss ${X.fmtE(lost)} per turn, formula ${X.fmtE(want)}`);
}

// 5. slow motion on demand: the fastest particle moves about 2% of the box per frame
{
  const X = load('all', { seed: 2 });
  const { W } = X;
  X.PRESETS.empty.build(); W.box.w = W.box.tw = 400; W.box.h = W.box.th = 300; W.wall = 'reflect';
  const p = X.fireSpec({ kind: 'atom', Z: 2, A: 4, bare: true }, -150, 0, 1, 0, 2e5);
  X.settleOverlaps(); W.baseSpf = W.simPerFrame; W.slowHold = true; W.hold = null;
  const xs = [];
  for (let f = 0; f < 20; f++) { X.simFrame(1 / 60, 1e9); xs.push(p.x); }
  const per = (xs[19] - xs[9]) / 10, want = 0.02 * 300;
  info(`slow motion: a 200 keV α particle moves ${per.toFixed(2)} Å per frame (2% of the box: ${want.toFixed(1)} Å)`);
  if (Math.abs(per / want - 1) > 0.1) bad(`slow motion: ${per.toFixed(2)} Å per frame, expected ${want.toFixed(1)}`);
  W.slowHold = false; W.hold = null;
  const x0 = p.x, ux0 = p.ux; X.simFrame(1 / 60, 1e9);
  const bounced = p.ux * ux0 < 0; // (closed walls reflect it: reaching the wall within the frame is fast enough)
  if (Math.abs(p.x - x0) < 5 * want && !p.dead && !bounced) bad(`slow motion off: the α particle still crawls (${(p.x - x0).toFixed(2)} Å in a frame)`);
}
// 5b. slow motion on demand with slow motion for nuclear events off: an annihilation does not slow time further
//     (what it sends flying, and what that knocks loose, is left out); with it on, time slows down for them
{
  const fs = {};
  for (const nuc of [false, true]) {
    const X = load('all', { seed: 7 });
    const { W } = X;
    X.PRESETS.annihilation.build(); X.settleOverlaps(); W.baseSpf = W.simPerFrame;
    W.slowHold = true; W.hold = null; W.slowmo = nuc;
    let before = 1, after = 1, ev = -1;
    for (let f = 0; f < 200 && !(ev >= 0 && f > ev + 30); f++) { const r = X.simFrame(1 / 60, 1e9); if (ev < 0 && W.events.length) ev = f; if (ev < 0) before = r.slow; else after = Math.min(after, r.slow); }
    fs[nuc] = [before, after, ev];
  }
  info(`slow motion on demand: an annihilation took it from ${fs.false[0].toExponential(2)} to ${fs.false[1].toExponential(2)} with nuclear slow motion off, to ${fs.true[1].toExponential(2)} with it on`);
  if (fs.false[2] < 0 || fs.true[2] < 0) bad('slow-motion test: no annihilation happened');
  else {
    if (fs.false[1] < 0.5 * fs.false[0]) bad(`nuclear slow motion off, yet time slowed ${(fs.false[0] / fs.false[1]).toFixed(1)}× more after an annihilation`);
    if (!(fs.true[1] < 0.1 * fs.true[0])) bad('nuclear slow motion on, yet time did not slow for the annihilation');
  }
}
// 4. the real labs: CERN ISOLDE's protons shatter uranium into rare isotopes (fission fragments among them); Oak Ridge
//    SNS's protons knock neutrons out of mercury; Livermore NIF's capsule fuses; Frascati DAΦNE makes φ mesons, seen
//    as kaon pairs (K⁺K⁻ the commonest outcome)
for (const [key, frames] of [['isolde', 420], ['sns', 420], ['nif', 480], ['dafne', 700]]) {
  const X = load('all', { seed: 6 });
  const { W } = X;
  X.PRESETS[key].build(); X.settleOverlaps(); W.baseSpf = W.simPerFrame;
  if (key === 'nif') W.simPerFrame = 1.5; // (its slow motion is for watching; the physics is the same at full speed)
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) X.simFrame(1 / 60, 30);
  const nuc = W.made ? [...W.made.nuc.values()] : [], part = W.made ? [...W.made.part.values()] : [];
  const n = (lab) => { const r = nuc.find(x => x.lab === lab) || part.find(x => x.lab === lab); return r ? r.n : 0; };
  const heavy = nuc.filter(r => r.Z > 2 && !r.anti), frag = heavy.filter(r => r.Z >= 30 && r.Z <= 62);
  const top = part.slice().sort((a, b) => b.n - a.n)[0];
  info(`${X.PRESETS[key].name}: ${heavy.length} kinds of nuclei (${frag.length} fission-fragment-like), ${n('n')} neutrons, ${W.count.fusion} fusions, particles ${part.map(r => `${r.lab}×${r.n}`).join(' ') || 'none'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const ok = key === 'isolde' ? heavy.length >= 15 && frag.length >= 3 && n('n') >= 20
    : key === 'sns' ? n('n') >= 30 && heavy.length >= 3
    : key === 'nif' ? W.count.fusion >= 1 && n('α') >= 1 && n('n') >= 1
    : n('K⁺') >= 10 && top && top.lab === 'K⁺' || (top && top.lab === 'K⁻' && n('K⁺') === top.n);
  if (!ok) bad(`${key}: not what the lab makes`);
}
console.log(fails ? `${fails} collider failure(s)` : 'collider checks passed');
process.exitCode = fails ? 1 : 0;
