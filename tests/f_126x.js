'use strict';
/* The 1.26 checks for spin-polarized quantum bonds and the SCC's handling of radicals (Settings → Experimental → Bond
   orders → Quantum, Spins: Paired normal, Polarized a choice; tools/xtb/spin.js), run by t_features (its "1.26 (xTB)"
   line) or alone: node tests/f_126x.js [part …] (parts: port, base, game, pull, conv, chem, af, af2, page). Each fails on v131
   (no spin polarization, GFN2's unsettled radicals). The physics parts run in the Node harness (deterministic); page
   in the t_features page. (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const H = (W) => { const f = new Float64Array(1), u = new Uint32Array(f.buffer); let h = 2166136261 >>> 0; for (const p of W.parts) { if (p.dead) continue; for (const v of [p.x, p.y, p.z || 0, p.vx, p.vy, p.vz || 0]) { f[0] = v; h = Math.imul(h ^ u[0], 16777619) >>> 0; h = Math.imul(h ^ u[1], 16777619) >>> 0; } } return h.toString(16); };

/* ---- 1. the port against tblite's own spin-polarized GFN1-xTB and GFN2-xTB (tools/xtb-ref/ref3.json, made on the
   runner: 28 atoms, radicals, triplets and stretched bonds, 3-D, both methods), and the forces against the energy's
   slopes (fixed spin and the game's shared Fermi level) */
PARTS.port = async (page, check) => {
  const X = load('all', { seed: 1 }), G = require('../tools/xtb-ref/geoms3.json'), R = require('../tools/xtb-ref/ref3.json');
  let dE = 0, dg = 0, dq = 0, n = 0;
  for (const g of G) for (const m of ['GFN1-xTB', 'GFN2-xTB']) {
    const r = R.find(x => x.name === g.name && x.method === m); if (!r || r.error) continue;
    const o = (m === 'GFN1-xTB' ? X.XTB.gfn1Energy : X.XTB.gfn2Energy)(g.Z, g.xyz, g.charge || 0, g.uhf || 0, { spin: 1, grad: true, accuracy: 0.01 }); n++;
    if (m === 'GFN1-xTB') { const d = X.XTB.d3Disp(g.Z, g.xyz, { grad: true }); o.E += d.E; o.g = o.g.map((v, i) => v.map((x, c) => x + d.g[i][c])); }
    dE = Math.max(dE, Math.abs(o.E - r.E));
    for (let i = 0; i < g.Z.length; i++) { dq = Math.max(dq, Math.abs(o.q[i] - r.q[i])); for (let c = 0; c < 3; c++) dg = Math.max(dg, Math.abs(o.g[i][c] - r.grad[i][c])); }
  }
  let fd = 0;
  for (const [f, free] of [[X.XTB.gfn1Energy, false], [X.XTB.gfn2Energy, true]]) {
    const g = G.find(x => x.name === 'HCO'), opts = { spin: 1, accuracy: 1e-6, spinFree: free }, E = (x) => f(g.Z, x, 0, free ? 0 : 1, opts).E;
    if (free) opts.m0 = f(g.Z, g.xyz, 0, 1, { spin: 1, accuracy: 1e-6 }).msh;
    const o = f(g.Z, g.xyz, 0, free ? 0 : 1, { ...opts, grad: true });
    for (let i = 0; i < g.Z.length; i++) for (let c = 0; c < 3; c++) { const at = (s) => { const x = g.xyz.map(p => p.slice()); x[i][c] += s; return E(x); }; fd = Math.max(fd, Math.abs((at(1e-4) - at(-1e-4)) / 2e-4 - o.g[i][c])); }
  }
  const out = { n, dE: +dE.toExponential(1), dg: +dg.toExponential(1), dq: +dq.toExponential(1), fd: +fd.toExponential(1) };
  check(n === 56 && dE < 1e-8 && dg < 2e-6 && dq < 1e-7 && fd < 2e-6,
    `1.26 spins: the port matches tblite's spin-polarized GFN1/GFN2-xTB on ${n} calculations (energies to ${out.dE} eV, forces ${out.dg} eV/Å, charges ${out.dq} e); forces are the energy's slopes to ${out.fd} eV/Å`, '1.26 spins port: ' + JSON.stringify(out));
};

/* ---- 2. spins paired (normal): GFN1 runs v131's bit for bit (f_126q's hashes), GFN2 too where every step settles (a
   hydronium and three waters, 150 steps, flat and 3-D: v131's hashes) */
PARTS.base = async (page, check) => {
  const runs = {};
  for (const m of [1, 2]) for (const d3 of [false, true]) {
    const X = load('all', { seed: 3 }), W = X.W;
    if (d3) { X.PRESETS.empty.build(); X.setBox(20, 20); X.world3d(20); }
    X.addMolecule('H3Op', 0, 0, 0, 300); for (let k = 0; k < 3; k++) { const a = 2 * Math.PI * k / 3; X.addMolecule('H2O', 2.8 * Math.cos(a), 2.8 * Math.sin(a), a + Math.PI / 2 + 0.3 * k, 300); }
    for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
    X.settleOverlaps(); X.boQmMethod(m); X.boSet(2); X.forcesNoEvents();
    for (let i = 0; i < 150; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
    runs['g' + m + (d3 ? 'd3' : 'flat')] = H(W); runs.spin = X.XQ.spin;
  }
  check(runs.spin === 0 && runs.g1flat === '301f4d45' && runs.g1d3 === 'a17a18e6' && runs.g2flat === '8c0524e4' && runs.g2d3 === 'd1ca3cf',
    `1.26 spins: paired (normal), GFN1-xTB and GFN2-xTB run v131's bit for bit (GFN1 ${runs.g1flat}/${runs.g1d3}, GFN2 ${runs.g2flat}/${runs.g2d3})`, '1.26 spins base: ' + JSON.stringify(runs));
};

/* ---- 3. polarized in the game: O2 (a triplet: the probe finds it and the switch is paid to the bath) with waters and
   a Na+ outside, forces the energy's slopes flat; 3-D in x, y and z; insulated runs keep their energy; switching the
   spins with members in is paid to the bath exactly */
PARTS.game = async (page, check) => {
  const out = {};
  for (const meth of [1, 2]) {
    const o = out['g' + meth] = {};
    { const X = load('all', { seed: 5 }), W = X.W;
      X.addMolecule('O2', 0, 0, 0, 0); X.addMolecule('H2O', 2.9, 0.3, 2.8, 0); X.addMolecule('H2O', -1.5, 2.7, 1, 0); X.addAtom('Na', -3, -2.5, { charge: 1, T: 0 });
      for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
      X.boQmMethod(meth); X.boQmSpin(1); X.boSet(2); X.forcesNoEvents(); W.T = 300; for (let i = 0; i < 30; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
      o.members = W.parts.filter(p => p.bom && !p.dead).length; o.flips = X.XQ.flips;
      { const L = X.XQ.ids.lay, q = X.XQ.qsh; let m = 0; for (let k = L.nsh; k < 2 * L.nsh; k++) m += Math.abs(q[k]); o.mag = +m.toFixed(2); } // (O2's two unpaired electrons: by the probe's switch or a start with each atom's spins)
      const all = W.parts.filter(p => !p.dead && p.k === X.NUC); X.forcesNoEvents(); const F = all.map(p => [X.S.fx[p.i], X.S.fy[p.i]]); let worst = 0; const E = () => X.totalEnergy().pe;
      all.forEach((p, u) => { for (const c of [0, 1]) { const A = c ? 'y' : 'x', x0 = p[A]; p[A] = x0 + 1e-4; X.gridTouch(); const e1 = E(); p[A] = x0 - 1e-4; X.gridTouch(); const e2 = E(); p[A] = x0; X.gridTouch(); worst = Math.max(worst, Math.abs(-(e1 - e2) / 2e-4 - F[u][c])); } });
      o.dF2 = +worst.toExponential(1);
      W.gamma = 0; const tot = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc, E0 = tot(), b0 = W.ledger.bath;
      X.boQmSpin(0); const n0 = W.parts.filter(p => p.bom && !p.dead).length; X.boQmSpin(1); X.forcesNoEvents();
      o.swap = [n0, +Math.abs(tot() - E0).toExponential(0), +(W.ledger.bath - b0).toFixed(2)];
      const f0 = X.XQ.fails, E1 = tot(); for (let i = 0; i < 200; i++) { W.dt = X.chooseDt(); X.step(W.dt); } o.drift2 = +(tot() - E1).toExponential(1); o.fails2 = X.XQ.fails - f0; }
    { const X = load('all', { seed: 3 }), W = X.W; X.PRESETS.empty.build(); X.setBox(24, 24); X.world3d(24); W.gamma = 0.05;
      ['O2', 'H2O', 'H2O', 'CH4', 'H2O'].forEach((m, k) => X.addMolecule(m, -6 + (k % 3) * 6, -3 + (k / 3 | 0) * 6, k, 300, k % 2 ? 2 : -2));
      X.forcesNoEvents(); X.boQmMethod(meth); X.boQmSpin(1); X.boSet(2); for (let i = 0; i < 30; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
      const all = W.parts.filter(p => !p.dead && p.k === X.NUC); o.members3 = W.parts.filter(p => p.bom && !p.dead).length;
      X.forcesNoEvents(); const F = all.map(p => [X.S.fx[p.i], X.S.fy[p.i], X.S.fz[p.i]]); const worst = [0, 0, 0]; const E = () => X.totalEnergy().pe;
      all.forEach((p, u) => { for (const c of [0, 1, 2]) { const A = 'xyz'[c], x0 = p[A]; p[A] = x0 + 1e-4; X.gridTouch(); const e1 = E(); p[A] = x0 - 1e-4; X.gridTouch(); const e2 = E(); p[A] = x0; X.gridTouch(); worst[c] = Math.max(worst[c], Math.abs(-(e1 - e2) / 2e-4 - F[u][c])); } });
      o.dF3 = worst.map(v => +v.toExponential(1));
      W.gamma = 0; const tot = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc, E0 = tot(), f0 = X.XQ.fails;
      for (let i = 0; i < 150; i++) { W.dt = X.chooseDt(); X.step(W.dt); } o.drift3 = +(tot() - E0).toExponential(1); o.fails3 = X.XQ.fails - f0; }
  }
  const ok = (o) => o.members === 8 && o.mag > 1.5 && o.dF2 < 2e-5 && o.swap[0] === 8 && o.swap[1] < 1e-6 && Math.abs(o.drift2) < 0.005 && !o.fails2 && o.members3 === 16 && Math.max(...o.dF3) < 2e-5 && Math.abs(o.drift3) < 0.001 && !o.fails3;
  check(ok(out.g1) && ok(out.g2),
    `1.26 spins in the game: O₂ a triplet (unpaired |m| ${out.g1.mag} / ${out.g2.mag}); forces the energy's slopes flat (an ion outside) GFN1 ${out.g1.dF2}, GFN2 ${out.g2.dF2} eV/Å, 3-D x/y/z ${out.g1.dF3.join('/')} and ${out.g2.dF3.join('/')}; insulated ${out.g1.drift2} / ${out.g2.drift2} eV over 200 steps flat, ${out.g1.drift3} / ${out.g2.drift3} over 150 in 3-D, none unsettled; switching the spins with 8 members in paid to the bath, the books closed to ${out.g1.swap[1]} / ${out.g2.swap[1]} eV`,
    '1.26 spins game: ' + JSON.stringify(out));
};

/* ---- 4. a bond pulled apart: H2's atoms given 4 eV each, insulated, beside a water. Paired, the separating atoms
   leave the electrons unsettled (eV jumps); polarized, the probe turns the stretched bond into two spins once (the drop
   to the bath) and every step settles */
PARTS.pull = async (page, check) => {
  const out = {};
  for (const meth of [1, 2]) for (const spin of [0, 1]) {
    const X = load('all', { seed: 3 }), W = X.W;
    X.addMolecule('H2', 0, 0, 0, 0); X.addMolecule('H2O', 5, 0, 0, 0);
    for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
    X.boQmMethod(meth); X.boQmSpin(spin); X.boSet(2); X.forcesNoEvents(); W.gamma = 0;
    const hs = W.parts.filter(p => p.Z === 1 && !p.dead).slice(0, 2), v = Math.sqrt(2 * 4.0 / hs[0].m);
    const dx = hs[1].x - hs[0].x, dy = hs[1].y - hs[0].y, d = Math.hypot(dx, dy); hs[0].vx = -v * dx / d; hs[0].vy = -v * dy / d; hs[1].vx = v * dx / d; hs[1].vy = v * dy / d;
    X.forcesNoEvents();
    const tot = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc, f0 = X.XQ.fails, fl0 = X.XQ.flips; let prev = tot(), worst = 0;
    for (let i = 0; i < 300; i++) { W.dt = X.chooseDt(); X.step(W.dt); const e = tot(); if (i > 5) worst = Math.max(worst, Math.abs(e - prev)); prev = e; }
    out['g' + meth + (spin ? 's' : 'p')] = { fails: X.XQ.fails - f0, flips: X.XQ.flips - fl0, worst: +worst.toExponential(1), r: +Math.hypot(hs[1].x - hs[0].x, hs[1].y - hs[0].y).toFixed(1) };
  }
  const s1 = out.g1s, s2 = out.g2s;
  check(s1.fails === 0 && s2.fails === 0 && s1.flips === 1 && s2.flips === 1 && s1.worst < 0.02 && s2.worst < 0.02 && s1.r > 5 && s2.r > 5 && (out.g1p.fails > 0 || out.g1p.worst > 0.5),
    `1.26 spins: H₂ pulled apart polarized, the stretched bond turns into two spins once and every step settles (largest step-to-step change of the books GFN1 ${s1.worst}, GFN2 ${s2.worst} eV, the fast atoms' own); paired, GFN1 ${out.g1p.fails} unsettled with jumps to ${out.g1p.worst} eV, GFN2 ${out.g2p.fails} / ${out.g2p.worst}`, '1.26 spins pull: ' + JSON.stringify(out));
};

/* ---- 5. GFN2's SCC with radicals (spins paired): O3, NO, O2, H2O2 and two H2 at 1,500 K, 300 steps; v131 left 29
   calculations unsettled, now none (a changed cluster starts from its members' last state, a cold or unsettled start
   gets 120 iterations, no straight-line start through an unsettled step, a measurement from the step's own state, and a
   mixer whose residual runs away starts its history again) */
PARTS.conv = async (page, check) => {
  const X = load('all', { seed: 3 }), W = X.W;
  ['O3', 'NO', 'O2', 'H2O2', 'H2', 'H2'].forEach((m, k) => { const a = 2 * Math.PI * k / 6; X.addMolecule(m, 3.2 * Math.cos(a), 3.2 * Math.sin(a), a, 1500); });
  for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
  X.settleOverlaps(); X.boQmMethod(2); X.boSet(2); X.forcesNoEvents(); W.T = 1500;
  for (let i = 0; i < 300; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
  const out = { fails: X.XQ.fails, members: W.parts.filter(p => p.bom && !p.dead).length, it: +(X.XQ.it / X.XQ.calls).toFixed(1) };
  check(out.fails === 0 && out.members === 15,
    `1.26 GFN2 with radicals (paired): O₃, NO, O₂, H₂O₂ and two H₂ at 1,500 K, 300 steps: ${out.fails} unsettled (v131: 29), ${out.it} iterations a step`, '1.26 conv: ' + JSON.stringify(out));
};

/* ---- 6. what spin polarization changes, single points (W4-11 geometries rounded): N2 and O2 into atoms, H + H2's
   saddle, ozone losing an O; closed shells (water) the same as paired */
PARTS.chem = async (page, check) => {
  const X = load('all', { seed: 1 }), XTB = X.XTB;
  const e = (m, s, Z, x, u) => { const r = (m === 1 ? XTB.gfn1Energy : XTB.gfn2Energy)(Z, x, 0, u, { accuracy: 0.01, ...(s ? { spin: 1 } : {}) }); return r.E + (m === 1 ? XTB.d3Disp(Z, x, {}).E : 0); };
  const U = { 1: 1, 7: 3, 8: 2 }, at = (m, s, z) => e(m, s, [z], [[0, 0, 0]], s ? U[z] : 0);
  const out = {};
  for (const m of [1, 2]) for (const s of [0, 1]) {
    const k = 'g' + m + (s ? 's' : 'p');
    const n2 = 2 * at(m, s, 7) - e(m, s, [7, 7], [[0, 0, 0], [1.098, 0, 0]], 0), o2 = 2 * at(m, s, 8) - e(m, s, [8, 8], [[0, 0, 0], [1.208, 0, 0]], s ? 2 : 0);
    const h3 = e(m, s, [1, 1, 1], [[-0.98, 0, 0], [0, 0, 0], [0.98, 0, 0]], 1) - e(m, s, [1, 1], [[0, 0, 0], [0.741, 0, 0]], 0) - at(m, s, 1);
    const o3x = [[0, 0, 0], [1.0827, 0.6620, 0], [-1.0827, 0.6620, 0]], o3 = e(m, s, [8, 8], [[0, 0, 0], [1.208, 0, 0]], s ? 2 : 0) + at(m, s, 8) - e(m, s, [8, 8, 8], o3x, 0);
    const w = e(m, s, [8, 1, 1], [[0, 0, 0], [0.958, 0, 0], [-0.24, 0.927, 0]], 0);
    out[k] = { n2: +n2.toFixed(2), o2: +o2.toFixed(2), h3: +h3.toFixed(2), o3: +o3.toFixed(2), w };
  }
  const same = Math.abs(out.g1s.w - out.g1p.w) < 1e-9 && Math.abs(out.g2s.w - out.g2p.w) < 1e-9;
  for (const k in out) delete out[k].w;
  check(out.g1p.n2 - out.g1s.n2 > 6 && out.g2p.n2 - out.g2s.n2 > 6 && out.g2p.h3 < -0.3 && out.g2s.h3 > -0.1 && out.g1s.o3 < out.g1p.o3 - 1.5 && out.g2s.o3 < out.g2p.o3 - 1.5 && same,
    `1.26 spins (single points, paired → polarized): N₂ into atoms GFN1 ${out.g1p.n2} → ${out.g1s.n2} eV, GFN2 ${out.g2p.n2} → ${out.g2s.n2} (measured 9.91); O₂ ${out.g1p.o2} → ${out.g1s.o2}, ${out.g2p.o2} → ${out.g2s.o2} (5.24); H + H₂ at 0.98 Å ${out.g1p.h3} → ${out.g1s.h3}, ${out.g2p.h3} → ${out.g2s.h3} (saddle 0.42); O₃ → O₂ + O ${out.g1p.o3} → ${out.g1s.o3}, ${out.g2p.o3} → ${out.g2s.o3} (1.15); water unchanged`,
    '1.26 spins chem: ' + JSON.stringify(out));
};

/* ---- 7. Atom Forge xTB (XQ.method 3, built and measured but not offered in Settings: see PERF-NOTES): its parameters
   as fitted (single points: N2, O2, ozone); in 3-D (O2, three waters, methane) the forces are the energy's slopes in x,
   y, z and an insulated run keeps its energy; a molecule with another element (H2S) keeps stored bonds */
PARTS.af = async (page, check) => {
  const X0 = load('all', { seed: 1 }), XTB = X0.XTB, AF = XTB.AF;
  const e = (Z, x, u) => XTB.gfn1Energy(Z, x, 0, u, { accuracy: 0.01, spin: AF.ws, par: AF.par }).E + XTB.d3Disp(Z, x, {}).E;
  const at = { 7: e([7], [[0, 0, 0]], 3), 8: e([8], [[0, 0, 0]], 2) }, w = (x) => e([8, 1, 1], x, 0);
  const o3x = [[0, 0, 0], [1.0827, 0.6620, 0], [-1.0827, 0.6620, 0]];
  const sp = { af: AF.base, n2: +(2 * at[7] - e([7, 7], [[0, 0, 0], [1.098, 0, 0]], 0)).toFixed(2), o2: +(2 * at[8] - e([8, 8], [[0, 0, 0], [1.208, 0, 0]], 2)).toFixed(2),
    o3: +(e([8, 8], [[0, 0, 0], [1.208, 0, 0]], 2) + at[8] - e([8, 8, 8], o3x, 0)).toFixed(2) };
  const out = { sp };
  { const X = load('all', { seed: 5 }), W = X.W; X.addMolecule('H2O', 0, 0, 0, 0); X.addMolecule('H2S', 3, 0.5, 1, 0); for (const p of W.parts) if (p.k !== X.NUC) X.kill(p); // (another element: stored bonds)
    X.boQmMethod(3); X.boSet(2); X.forcesNoEvents(); for (let i = 0; i < 5; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
    out.sStored = W.parts.some(p => p.Z === 16 && !p.dead && !p.bom && p.bonds.length === 2) && W.parts.filter(p => p.bom && !p.dead).length === 3; }
  { const X = load('all', { seed: 3 }), W = X.W; X.PRESETS.empty.build(); X.setBox(24, 24); X.world3d(24); W.gamma = 0.05;
    ['O2', 'H2O', 'H2O', 'CH4', 'H2O'].forEach((m, k) => X.addMolecule(m, -6 + (k % 3) * 6, -3 + (k / 3 | 0) * 6, k, 300, k % 2 ? 2 : -2));
    X.forcesNoEvents(); X.boQmMethod(3); X.boSet(2); for (let i = 0; i < 30; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
    const all = W.parts.filter(p => !p.dead && p.k === X.NUC); out.members3 = W.parts.filter(p => p.bom && !p.dead).length;
    X.forcesNoEvents(); const F = all.map(p => [X.S.fx[p.i], X.S.fy[p.i], X.S.fz[p.i]]); const worst = [0, 0, 0]; const E = () => X.totalEnergy().pe;
    all.forEach((p, u) => { for (const c of [0, 1, 2]) { const A = 'xyz'[c], x0 = p[A]; p[A] = x0 + 1e-4; X.gridTouch(); const e1 = E(); p[A] = x0 - 1e-4; X.gridTouch(); const e2 = E(); p[A] = x0; X.gridTouch(); worst[c] = Math.max(worst[c], Math.abs(-(e1 - e2) / 2e-4 - F[u][c])); } });
    out.dF3 = worst.map(v => +v.toExponential(1));
    W.gamma = 0; const tot = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc, E0 = tot(), f0 = X.XQ.fails;
    for (let i = 0; i < 150; i++) { W.dt = X.chooseDt(); X.step(W.dt); } out.drift3 = +(tot() - E0).toExponential(1); out.fails3 = X.XQ.fails - f0; }
  check(sp.af === 1 && Math.abs(sp.n2 - 9.91) < 1 && Math.abs(sp.o3 - 1.15) < 1 && out.sStored && out.members3 === 16 && Math.max(...out.dF3) < 1e-5 && Math.abs(out.drift3) < 0.001 && !out.fails3,
    `1.26 Atom Forge xTB (built, not offered: see the notes): N₂ into atoms ${sp.n2} eV (measured 9.91), O₂ ${sp.o2} (5.24), O₃ → O₂ + O ${sp.o3} (1.15); in 3-D the forces are the energy's slopes x/y/z ${out.dF3.join('/')} eV/Å, insulated ${out.drift3} eV over 150 steps, none unsettled; H₂S keeps stored bonds`,
    '1.26 Atom Forge xTB: ' + JSON.stringify(out));
};

/* ---- 7b. GFN2 (Atom Forge fit), the second GFN2 refit (XQ.method 4, built and measured but not offered in Settings:
   see PERF-NOTES "### 1.26: GFN2 refit (second attempt)"): GFN2's electrostatics, its water-setting parameters and the
   published spin constants kept (the data says which); single points against GFN2 polarized: H + H2's symmetric stretch
   (GFN2 binds H3), hexazine against three N2 (GFN2 holds it below), the water dimer kept; in the game the world that
   sank the first refit (O2, two waters, methane) settles and keeps its books, 3-D slopes x/y/z and books, switching from
   GFN2 with members in paid to the bath, and a molecule with another element (H2S) keeps stored bonds */
PARTS.af2 = async (page, check) => {
  const X0 = load('all', { seed: 1 }), XTB = X0.XTB, A = XTB.AF2;
  if (!A) { check(false, '', '1.26 GFN2 (Atom Forge fit): no XTB.AF2'); return; }
  const fz = A.frozen || [], e = (Z, x, u, fit) => XTB.gfn2Energy(Z, x, 0, u, { accuracy: 0.01, ...(fit ? { spin: A.ws, par: A.par } : { spin: 1 }) }).E;
  const sp = {};
  for (const fit of [0, 1]) {
    const k = fit ? 'fit' : 'gfn2s', h = e([1], [[0, 0, 0]], 1, fit), h2 = e([1, 1], [[0, 0, 0], [0.741, 0, 0]], 0, fit);
    let h3 = Infinity; for (let d = 0.85; d <= 1.25; d += 0.01) h3 = Math.min(h3, e([1, 1, 1], [[-d, 0, 0], [0, 0, 0], [d, 0, 0]], 1, fit) - h2 - h);
    const ring = []; for (let i = 0; i < 6; i++) { const t = i * Math.PI / 3; ring.push([1.30 * Math.cos(t), 1.30 * Math.sin(t), 0]); }
    const n6 = 3 * e([7, 7], [[0, 0, 0], [1.098, 0, 0]], 0, fit) - e([7, 7, 7, 7, 7, 7], ring, 0, fit);
    const w = [[-0.016407, -0.004232, -0.026564], [0.932609, -0.015512, -0.021573], [-0.219148, 0.9304, 0.013764], [2.906574, -0.013315, -0.021413], [3.250023, 0.46496, 0.781445], [3.224885, 0.467848, -0.779684]];
    const w2 = e([8, 1, 1], w.slice(0, 3), 0, fit) + e([8, 1, 1], w.slice(3), 0, fit) - e([8, 1, 1, 8, 1, 1], w, 0, fit);
    sp[k] = { h3: +h3.toFixed(3), n6: +n6.toFixed(2), w2: +w2.toFixed(3) }; // (n6: three N2 less the ring, negative when the ring lies above)
  }
  const out = { sp, frozen: fz.length };
  { const X = load('all', { seed: 5 }), W = X.W; X.addMolecule('H2O', 0, 0, 0, 0); X.addMolecule('H2S', 3, 0.5, 1, 0); for (const p of W.parts) if (p.k !== X.NUC) X.kill(p); // (another element: stored bonds)
    X.boQmMethod(4); X.boSet(2); X.forcesNoEvents(); for (let i = 0; i < 5; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
    out.sStored = W.parts.some(p => p.Z === 16 && !p.dead && !p.bom && p.bonds.length === 2) && W.parts.filter(p => p.bom && !p.dead).length === 3; }
  { const X = load('all', { seed: 5 }), W = X.W, tot = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc; // (the first refit's failure: its calculations did not settle here and the books ended 220 eV off)
    X.addMolecule('O2', 0, 0, 0, 0); X.addMolecule('H2O', 2.9, 0.3, 2.8, 0); X.addMolecule('H2O', -1.5, 2.7, 1, 0); X.addMolecule('CH4', -3.5, -2.5, 0, 0);
    for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
    X.boQmSpin(1); X.boQmMethod(2); X.boSet(2); X.forcesNoEvents(); W.T = 300; for (let i = 0; i < 10; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
    W.gamma = 0; const E0 = tot(), b0 = W.ledger.bath; X.boQmMethod(4); X.forcesNoEvents(); out.swap = [W.parts.filter(p => p.bom && !p.dead).length, +Math.abs(tot() - E0).toExponential(0), +(W.ledger.bath - b0).toFixed(2)];
    W.gamma = 0.05; for (let i = 0; i < 20; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
    W.gamma = 0; const f0 = X.XQ.fails, E1 = tot(); for (let i = 0; i < 200; i++) { W.dt = X.chooseDt(); X.step(W.dt); } out.drift2 = +(tot() - E1).toExponential(1); out.fails2 = X.XQ.fails; }
  { const X = load('all', { seed: 3 }), W = X.W; X.PRESETS.empty.build(); X.setBox(24, 24); X.world3d(24); W.gamma = 0.05;
    ['O2', 'H2O', 'H2O', 'CH4', 'H2O'].forEach((m, k) => X.addMolecule(m, -6 + (k % 3) * 6, -3 + (k / 3 | 0) * 6, k, 300, k % 2 ? 2 : -2));
    X.forcesNoEvents(); X.boQmMethod(4); X.boSet(2); for (let i = 0; i < 30; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
    const all = W.parts.filter(p => !p.dead && p.k === X.NUC); out.members3 = W.parts.filter(p => p.bom && !p.dead).length;
    X.forcesNoEvents(); const F = all.map(p => [X.S.fx[p.i], X.S.fy[p.i], X.S.fz[p.i]]); const worst = [0, 0, 0]; const E = () => X.totalEnergy().pe;
    all.forEach((p, u) => { for (const c of [0, 1, 2]) { const Ax = 'xyz'[c], x0 = p[Ax]; p[Ax] = x0 + 1e-4; X.gridTouch(); const e1 = E(); p[Ax] = x0 - 1e-4; X.gridTouch(); const e2 = E(); p[Ax] = x0; X.gridTouch(); worst[c] = Math.max(worst[c], Math.abs(-(e1 - e2) / 2e-4 - F[u][c])); } });
    out.dF3 = worst.map(v => +v.toExponential(1));
    W.gamma = 0; const tot = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc, E0 = tot(); out.fails3 = X.XQ.fails;
    for (let i = 0; i < 150; i++) { W.dt = X.chooseDt(); X.step(W.dt); } out.drift3 = +(tot() - E0).toExponential(1); out.fails3 = X.XQ.fails; }
  const s = sp.fit, g = sp.gfn2s;
  check(A.base === 2 && A.ws === 1 && ['hub:*', 'pair:8-8', 'wspin'].every(k => fz.includes(k)) && s.h3 > 0.15 && g.h3 < 0.05 && s.n6 < -5 && g.n6 > 0 && Math.abs(s.w2 - g.w2) < 0.02 && out.sStored &&
    out.swap[0] === 13 && out.swap[1] < 1e-6 && !out.fails2 && Math.abs(out.drift2) < 0.001 && out.members3 === 16 && Math.max(...out.dF3) < 2e-5 && Math.abs(out.drift3) < 0.001 && !out.fails3,
    `1.26 GFN2 (Atom Forge fit) (built, not offered: see the notes): GFN2's electrostatics, water-setting parameters and spin constants kept (${fz.length} frozen); H + H₂'s symmetric stretch ${s.h3} eV above H₂ + H (GFN2 polarized ${g.h3}, measured 0.42); flat hexazine ${-s.n6} eV above three N₂ (GFN2 ${-g.n6}); the water dimer ${s.w2} eV (GFN2 ${g.w2}); O₂, two waters and methane settle (none unsettled, insulated ${out.drift2} eV over 200 steps; switching from GFN2 with ${out.swap[0]} members paid to the bath, books closed to ${out.swap[1]} eV); 3-D slopes x/y/z ${out.dF3.join('/')} eV/Å, insulated ${out.drift3} eV over 150 steps; H₂S keeps stored bonds`,
    '1.26 GFN2 (Atom Forge fit): ' + JSON.stringify(out));
};

/* ---- 8. the page: Experimental → Spins (Paired at start, Polarized a choice with its cost and the realistic tag), the
   choice reaching the engine (O2 and a water: the triplet found), the Speed test's line, the side pane, Help */
PARTS.page = async (page, check) => {
  const r = await page.evaluate(async () => {
    const out = { def: SET_DEF.xqs, set: SET.xqs, sp0: XQ.spin, row: !!$('segXqs'), exp: SET_EXP.includes('xqs') };
    loadPreset('empty'); setRunning(false); addMolecule('O2', 0, 0, 0, 0); addMolecule('H2O', 2.8, 0.3, 2.8, 0);
    setSetting('bo', 2); syncCosts(); const b1 = $('segXqs').querySelector('button[data-v="1"]');
    out.cost = (b1.querySelector('.oc') || {}).textContent; out.real = (b1.querySelector('.rl') || {}).textContent;
    const f0 = XQ.flips; setSetting('xqs', 1); out.sp1 = XQ.spin; for (let f = 0; f < 5; f++) { W.dt = chooseDt(); step(W.dt); } out.n = W.parts.filter(p => p.bom && !p.dead).length; out.flips = XQ.flips - f0;
    out.sum = expSummary();
    openSettings('exp'); setPrevShow('segXqs', null); out.pane = $('setPrevD').textContent; hideModal('setModal');
    out.help = /Spins → Polarized/.test(document.body.innerHTML);
    loadPreset('d3empty'); setRunning(false); addMolecule('O2', 0, 0, 0, 0); addMolecule('H2O', 2.8, 0.3, 2.8, 0); for (let f = 0; f < 3; f++) { W.dt = chooseDt(); step(W.dt); } out.n3 = W.parts.filter(p => p.bom && !p.dead).length; out.sp3 = XQ.spin;
    setSetting('xqs', 0); setSetting('bo', 0); out.back = [XQ.spin, BO.on]; loadPreset('empty');
    return out;
  });
  check(r.def === 0 && r.set === 0 && r.sp0 === 0 && r.row && r.exp && /×1\.2/.test(r.cost) && /realistic/.test(r.real) && r.sp1 === 1 && r.n === 5 && r.flips >= 1 && /polarized spins/.test(r.sum) && /triplet/.test(r.pane) && r.help && r.n3 === 5 && r.sp3 === 1 && r.back[0] === 0 && !r.back[1],
    `1.26 spins: Settings → Experimental → Spins (Paired at start; Polarized realistic, tagged ${r.cost}); chosen, O₂ and a water run polarized (the triplet found), in 3-D too; the Speed test's line, the side pane and Help say so`, '1.26 spins page: ' + JSON.stringify(r));
};

module.exports = async function f126x(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (k === 'page' && !page) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.26 xTB ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  const only = process.argv.slice(2);
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  let browser = null, page = null, errors = [];
  if (!only.length || only.includes('page')) { const { openPage } = require('./browser'); ({ browser, page, errors } = await openPage({ settle: 800 })); }
  await module.exports(page, check, say, null, only);
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  if (browser) await browser.close();
  console.log(fails ? `${fails} failure(s)` : '1.26 xTB checks passed');
  process.exitCode = fails ? 1 : 0;
})();
