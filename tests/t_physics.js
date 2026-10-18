'use strict';
/* Physics against measured values: the heat bath holds a gas at its set temperature; small molecules relax to
   their measured bond lengths and angles; tabulated bond energies; hydrogen's Balmer lines; a cyclotron orbit's
   radius and the E×B drift in crossed fields; a very large box stays cheap and keeps its energy. Node only. */
const { load } = require('./load');
let fails = 0;
const bad = (m) => { fails++; console.log('FAIL', m); };
const info = (m) => console.log('  ' + m);

// 1. thermostat: argon at 300 K and 3000 K
for (const T of [300, 3000]) {
  const X = load(undefined, { seed: 5 });
  const { W } = X;
  X.clearWorld(); W.box.w = W.box.tw = 80; W.box.h = W.box.th = 60; W.T = T; W.gamma = 0.5;
  for (let i = 0; i < 10; i++) for (let j = 0; j < 8; j++) X.addAtom('Ar', -36 + i * 8, -28 + j * 8, { T: 10 });
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  let sum = 0, n = 0;
  for (let f = 0; f < 900; f++) { X.simFrame(1 / 60, 40); if (f >= 450) { sum += X.measure().T; n++; } }
  const Tm = sum / n;
  info(`argon held at ${T} K: measured ${Tm.toFixed(0)} K`);
  if (Math.abs(Tm / T - 1) > 0.08) bad(`heat bath at ${T} K holds argon at ${Tm.toFixed(0)} K`);
}

// 2. molecules: bond lengths and angles after relaxing at 5 K
{
  const REF = { // key: [[a, b, length Å], …], [[a, centre, b, angle °]]
    H2: { b: [['H', 'H', 0.741]] }, N2: { b: [['N', 'N', 1.098]] }, O2: { b: [['O', 'O', 1.208]] }, HCl: { b: [['H', 'Cl', 1.275]] },
    H2O: { b: [['O', 'H', 0.958]], a: [['H', 'O', 'H', 104.5]] }, CO2: { b: [['C', 'O', 1.162]], a: [['O', 'C', 'O', 180]], tol: 0.05 }, // (one C=O length for all: a carbonyl's 1.21 Å; CO₂'s cumulated bonds are 4% shorter)
    NH3: { b: [['N', 'H', 1.012]] }, CH4: { b: [['C', 'H', 1.087]] }, HCN: { b: [['C', 'N', 1.153], ['C', 'H', 1.066]], a: [['H', 'C', 'N', 180]] },
    C2H2: { b: [['C', 'C', 1.203]] }, C2H4: { b: [['C', 'C', 1.339]] }, C2H6: { b: [['C', 'C', 1.535]] },
  };
  for (const [key, ref] of Object.entries(REF)) {
    const X = load(undefined, { seed: 2 });
    const { W } = X;
    const M = X.MOLECULES[key];
    if (!M) { bad(`no library molecule ${key}`); continue; }
    X.clearWorld(); W.box.w = W.box.tw = 30; W.box.h = W.box.th = 30; W.T = 5; W.gamma = 1;
    const atoms = X.addMolecule(key, 0, 0, 0.3, 5);
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    const acc = new Map();
    for (let f = 0; f < 400; f++) {
      X.simFrame(1 / 60, 40);
      if (f < 200) continue;
      for (const [s1, s2, L] of ref.b || []) {
        for (const bd of W.bonds) {
          const a = bd.a.el.sym, b = bd.b.el.sym;
          if (!((a === s1 && b === s2) || (a === s2 && b === s1))) continue;
          const k = `${s1}–${s2}`, d = Math.hypot(bd.a.x - bd.b.x, bd.a.y - bd.b.y), v = acc.get(k) || [0, 0, L];
          acc.set(k, [v[0] + d, v[1] + 1, L]);
        }
      }
      for (const [s1, sc, s2, A] of ref.a || []) {
        for (const c of atoms) {
          if (c.dead || c.el.sym !== sc || c.bonds.length !== 2) continue;
          const [o1, o2] = c.bonds.map(bd => (bd.a === c ? bd.b : bd.a));
          const ok = (o1.el.sym === s1 && o2.el.sym === s2) || (o1.el.sym === s2 && o2.el.sym === s1);
          if (!ok) continue;
          const a1 = Math.atan2(o1.y - c.y, o1.x - c.x), a2 = Math.atan2(o2.y - c.y, o2.x - c.x);
          let ang = Math.abs(a1 - a2) * 180 / Math.PI; if (ang > 180) ang = 360 - ang;
          const k = `${s1}–${sc}–${s2}`, v = acc.get(k) || [0, 0, A];
          acc.set(k, [v[0] + ang, v[1] + 1, A]);
        }
      }
    }
    const parts = [];
    for (const [k, [s, n, r]] of acc) {
      const m = s / n, isAng = k.split('–').length === 3;
      parts.push(`${k} ${m.toFixed(isAng ? 1 : 3)}${isAng ? '°' : ' Å'} (measured ${r}${isAng ? '°' : ''})`);
      if (isAng ? Math.abs(m - r) > 6 : Math.abs(m / r - 1) > (ref.tol || 0.03)) bad(`${key}: ${k} ${m.toFixed(3)} vs measured ${r}`);
    }
    if (!acc.size) bad(`${key}: no bonds found after relaxing`);
    info(`${key}: ${parts.join(', ')}`);
  }
}

// 3. bond energies (kJ/mol): the tables against measured bond enthalpies
{
  const X = load();
  const E = (a, b, o) => X.bondEnergy(X.ELEMENTS[X.SYM2Z[a]], X.ELEMENTS[X.SYM2Z[b]], o) * X.PHYS.KJMOL;
  const REF = [['H', 'H', 1, 436], ['O', 'O', 2, 498], ['N', 'N', 3, 945], ['C', 'H', 1, 413], ['O', 'H', 1, 463], ['H', 'Cl', 1, 431], ['C', 'C', 1, 348], ['C', 'O', 2, 799], ['H', 'F', 1, 567], ['C', 'N', 3, 891]];
  for (const [a, b, o, r] of REF) {
    const v = E(a, b, o);
    if (Math.abs(v / r - 1) > 0.06) bad(`${a}–${b} order ${o}: ${v.toFixed(0)} kJ/mol (measured ${r})`);
  }
  info(`${REF.length} bond energies within 6% of measured values`);
}

// 4. hydrogen's Balmer lines (vacuum wavelengths, nm), as the light from recombination and excitation
{
  const X = load(undefined, { seed: 1 });
  const { W } = X;
  X.clearWorld();
  const H = X.addAtom('H', 0, 0);
  const lines = new Map();
  for (let i = 0; i < 400; i++) { const ln = X.pickLine(H, 100); if (ln) lines.set(Math.round(ln.nm * 10) / 10, true); }
  const got = [...lines.keys()].sort((a, b) => b - a);
  const REF = [656.47, 486.27, 434.17, 410.29];
  REF.forEach((r, i) => { if (!(Math.abs(got[i] - r) < 0.2)) bad(`Balmer line ${i + 1}: ${got[i]} nm (measured ${r} nm in vacuum)`); });
  info(`Balmer lines ${got.join(', ')} nm`);
}

// 5. a cyclotron orbit and the E×B drift
{
  const X = load(undefined, { seed: 1 });
  const { W, PHYS } = X;
  X.clearWorld(); W.gamma = 0; W.T = 300; W.wall = 'reflect'; W.box.w = W.box.tw = 200; W.box.h = W.box.th = 200;
  W.Bz = 5000;
  const e = X.addLepton(X.ELEC, 0, 0); X.setMotion(e, 5, 1, 0);
  const v0 = Math.hypot(e.vx, e.vy), r0 = e.m * v0 / (Math.abs(e.q) * W.Bz * PHYS.LOR);
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  const xs = [], ys = [];
  for (let i = 0; i < 400; i++) { X.step(X.chooseDt()); xs.push(e.x); ys.push(e.y); }
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const rs = xs.map((x, i) => Math.hypot(x - cx, ys[i] - cy));
  if (Math.abs(Math.max(...rs) / r0 - 1) > 0.01 || Math.abs(Math.min(...rs) / r0 - 1) > 0.01) bad(`cyclotron radius ${Math.min(...rs).toFixed(3)}–${Math.max(...rs).toFixed(3)} Å, expected ${r0.toFixed(3)}`);
  info(`cyclotron radius ${(rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(3)} Å (theory ${r0.toFixed(3)} Å)`);
  // crossed fields: the guiding centre drifts at E/B
  X.clearWorld(); W.gamma = 0; W.Bz = 20000; W.Ex = 0.5; W.Ey = 0; W.box.w = W.box.tw = 400; W.box.h = W.box.th = 400;
  const e2 = X.addLepton(X.ELEC, 0, 0); X.setMotion(e2, 1, 0, 1);
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  let t = 0; const y0 = e2.y;
  while (t < 3) { const dt = X.chooseDt(); X.step(dt); t += dt; } // (75 Å of drift, well inside the box)
  const vd = (e2.y - y0) / t, vth = W.Ex / (W.Bz * PHYS.LOR); // the guiding centre drifts along E×B at E/B
  if (Math.abs(Math.abs(vd) / vth - 1) > 0.05) bad(`E×B drift ${Math.abs(vd).toExponential(3)} Å/tu, theory ${vth.toExponential(3)}`);
  info(`E×B drift ${Math.abs(vd).toExponential(3)} Å/tu (theory E/B = ${vth.toExponential(3)})`);
}
// 6. a very large box: the grid stays bounded (cells never narrower than the cutoff, never more than CELL_CAP), a
//    liquid in it keeps its energy, and the walls close back in through the empty space at once
{
  const X = load('all', { seed: 5 });
  const { W } = X;
  X.PRESETS.water.build(); X.settleOverlaps(); W.baseSpf = W.simPerFrame; W.gamma = 0;
  const w0 = W.box.w, h0 = W.box.h;
  W.box.tw = 20000; W.box.th = 20000 * h0 / w0;
  const E0 = X.totalEnergy().total, t0 = Date.now();
  for (let f = 0; f < 40; f++) X.simFrame(1 / 60, 1e9);
  const ms = (Date.now() - t0) / 40, E1 = X.totalEnergy().total, cells = X.G.cols * X.G.rows;
  info(`water in a 20,000 Å box: ${X.G.cols}×${X.G.rows} cells of ${X.G.cw.toFixed(1)} Å, ${ms.toFixed(1)} ms a frame, energy ${E0.toFixed(2)} → ${E1.toFixed(2)} eV`);
  if (W.box.w !== 20000) bad(`the box grew to ${W.box.w} Å, not at once to 20,000 Å`);
  if (cells > X.CELL_CAP || X.G.cw < X.RC || X.G.ch < X.RC) bad(`grid ${X.G.cols}×${X.G.rows} of ${X.G.cw.toFixed(2)} Å cells breaks its bounds`);
  if (!Number.isFinite(E1) || Math.abs(E1 - E0) > 0.002 * Math.abs(E0)) bad(`energy in the large box drifted ${E0.toFixed(2)} → ${E1.toFixed(2)} eV`);
  W.box.tw = w0; W.box.th = h0;
  for (let f = 0; f < 10; f++) X.simFrame(1 / 60, 1e9);
  info(`  shrunk back: ${W.box.w.toFixed(1)} × ${W.box.h.toFixed(1)} Å after 10 frames (asked ${w0.toFixed(0)} × ${h0.toFixed(0)})`);
  if (W.box.w > w0 + 0.5 || W.box.h > h0 + 0.5) bad(`the walls took too long to come back in (${W.box.w.toFixed(1)} Å)`);
}
// atoms put down past a wall land just inside it, as they are: a carbon atom 12 Å past the wall used to be driven
// back in with the wall's stored energy (2 keV) and stripped bare
{
  const X = load('all', { seed: 9 });
  const { W } = X;
  X.PRESETS.empty.build(); W.wall = 'reflect'; W.T = 300;
  const hw = W.box.w / 2, hh = W.box.h / 2;
  const ps = X.placeSpec({ kind: 'atom', Z: 6, A: 12 }, hw + 12, 3, 1).concat(X.placeSpec({ kind: 'atom', Z: 26, A: 56 }, -hw - 30, -hh - 8, 1), X.placeSpec({ kind: 'mol', mol: 'benzene' }, hw + 4, 0, 1));
  const inside = ps.every(p => Math.abs(p.x) <= hw && Math.abs(p.y) <= hh);
  for (let f = 0; f < 120; f++) X.simFrame(1 / 60, 30);
  const ion = ps.filter(p => p.dead || p.ne !== p.Z).length, maxKE = Math.max(...ps.map(p => 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy)));
  info(`placed past the wall: ${ps.length} atoms (carbon, iron, benzene) put down inside: ${inside}; ionized after 2 s: ${ion}; hottest ${X.fmtE(maxKE)}`);
  if (!inside || ion || maxKE > 1) bad(`atoms placed past the wall: inside ${inside}, ${ion} ionized, hottest ${X.fmtE(maxKE)}`);
}
// the spark at its new top setting (1 GeV): the energy given is the energy set, and every atom it flings flies below
// light speed (fast particles, relativistic); at an ordinary setting it is shared as before
{
  const X = load('all', { seed: 3 });
  const { W } = X;
  X.PRESETS.empty.build();
  const KEof = (p) => (p.rad ? p.KE : 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy));
  for (const [E, n] of [[1e9, 11], [1e6, 10], [100, 6]]) {
    X.clearWorld(); W.box.w = W.box.tw = 300; W.box.h = W.box.th = 300; W.wall = 'open'; W.T = 300;
    const ps = []; for (let i = 0; i < n; i++) { const p = X.addAtom('C', (i % 4) * 2.4 - 3.6, Math.floor(i / 4) * 2.4 - 2.4, { T: 0 }); p.vx = 0; p.vy = 0; ps.push(p); }
    X.forcesNoEvents(); // (the neighbour grid the spark searches)
    X.spark(0, 0, 9, E);
    const got = ps.reduce((s, p) => s + KEof(p), 0), vmax = Math.max(...ps.map(p => (p.rad ? p.sp : Math.hypot(p.vx, p.vy))));
    info(`spark of ${X.fmtE(E)} on ${n} carbon atoms: ${X.fmtE(got)} given, fastest ${(vmax / X.PHYS.C).toFixed(3)} c`);
    if (Math.abs(got / E - 1) > 0.01 || !(vmax < X.PHYS.C)) bad(`spark of ${X.fmtE(E)}: ${X.fmtE(got)} given, fastest ${(vmax / X.PHYS.C).toFixed(3)} c`);
  }
}
// light from the Light tool flies at c: it lands when light has covered the distance (11.7 attoseconds for 35 Å),
// time slowing to show it meanwhile (about a second of frames); other light still lands at once
{
  const X = load('all', { seed: 4 });
  const { W } = X;
  X.PRESETS.empty.build(); W.box.w = W.box.tw = 60; W.box.h = W.box.th = 40; W.baseSpf = W.simPerFrame;
  X.forcesNoEvents();
  const E = X.PHYS.HC / 500, esc0 = W.ledger.escaped, t0 = W.t;
  X.emitPhoton(-25, 0, E, 1, 0, { travel: true });
  const slow = X.slowFactor(1 / 60), len = W.flights.length ? W.flights[0].len : 0, lab = W.flights.length ? W.flights[0].lab : '';
  if (lab !== '500 nm' || !/^γ /.test(X.photonLabel(1.2e6)) || !/^X-ray /.test(X.photonLabel(8e3)) || X.photonLabel(X.PHYS.HC / 589, { k: X.NUC, el: X.ELEMENTS[11] }) !== 'Na 589 nm') bad(`photon labels: “${lab}”, “${X.photonLabel(1.2e6)}”, “${X.photonLabel(8e3)}”`);
  let f = 0; for (; f < 600 && W.flights.length; f++) X.simFrame(1 / 60, 30);
  const tFly = W.t - t0, want = len / X.PHYS.C, n0 = W.rays.length, esc1 = W.ledger.escaped;
  const lr = W.rays[W.rays.length - 1], trail = lr ? Math.hypot(lr.x1 - lr.x0, lr.y1 - lr.y0) : -1; // (landed: only its last streak fades there)
  if (!(trail > 0 && trail <= 4.01)) bad(`a photon that lands should leave only its short streak, not a line back to its source (${trail.toFixed(1)} Å)`);
  X.emitPhoton(-25, 5, E, 1, 0); const n1 = W.rays.length;
  { // light from an emission (not the Light tool) also goes at c: across within a normal frame, crawling when time is slowed
    const r = W.rays[W.rays.length - 1], m0 = X.rayFrac(r), spf = W.simPerFrame;
    X.simFrame(1 / 60, 30); const m1 = X.rayFrac(r);
    X.emitPhoton(-25, -5, E, 1, 0); const r2 = W.rays[W.rays.length - 1], tA = W.t; W.simPerFrame = 1e-5; X.simFrame(1 / 60, 30); const m2 = X.rayFrac(r2), want2 = (W.t - tA) * X.PHYS.C / r2.len; W.simPerFrame = spf; // (the share of the way light covers in the time that passed)
    if (!(m0 === 0 && m1 === 1 && m2 > 0 && m2 < 0.1 && Math.abs(m2 / want2 - 1) < 0.02)) bad(`emitted light should go at c: ${JSON.stringify({ m0, m1, m2, want2 })}`);
  }
  info(`a photon across ${len.toFixed(0)} Å: landed after ${(tFly * X.PHYS.TU_S * 1e18).toFixed(1)} as (light: ${(want * X.PHYS.TU_S * 1e18).toFixed(1)} as), shown over ${f} frames; time ×${slow.toExponential(1)} meanwhile`);
  if (!(len > 30) || Math.abs(tFly / want - 1) > 0.1 || f < 20 || f > 200 || !(slow < 1e-3) || Math.abs(esc1 - esc0 - E) > 1e-9 || n1 !== n0 + 1 || W.flights.length)
    bad(`light in flight: ${JSON.stringify({ len, tFly, want, f, slow, esc: esc1 - esc0, rays: n1 - n0, left: W.flights.length })}`);
}
// a single antineutron, placed: neutral, it drifts until it meets a nucleus and annihilates (energy kept); left alone
// it decays as a neutron's mirror image, to an antiproton (and a positron)
{
  const X = load(undefined, { seed: 12 });
  const { W } = X;
  X.clearWorld(); W.box.w = W.box.tw = 60; W.box.h = W.box.th = 40; W.T = 300; W.decayOn = false; W.wall = 'reflect';
  X.addMolecule('H2O', 0, 0, 0, 300);
  const nb = X.spawnSpec({ kind: 'nbar' }, -8, 0, 300)[0]; nb.vx = 0.02; nb.vy = 0;
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  const e0 = X.totalEnergy().total - W.ledger.nuc;
  let f = 0; while (!nb.dead && f < 3000) { X.simFrame(1 / 60, 40); f++; }
  const drift = (X.totalEnergy().total - W.ledger.nuc - e0) / Math.abs(e0);
  X.clearWorld(); W.box.w = W.box.tw = 60; W.box.h = W.box.th = 40; W.wall = 'periodic'; W.decayOn = true; W.warp = 1e14;
  const nb2 = X.spawnSpec({ kind: 'nbar' }, 0, 0, 300)[0]; X.forcesNoEvents(); W.fSpawn = W.spawned;
  let g = 0; while (nb2.Z === 0 && !nb2.dead && g < 2000) { X.simFrame(1 / 60, 40); g++; } // (β decay turns the antineutron itself into the antiproton)
  const pbar = W.parts.some(p => !p.dead && p.k === X.NUC && p.anti && p.Z === 1 && p.N === 0);
  info(`antineutron: Z ${nb.Z}, N ${nb.N}, anti ${nb.anti}; met water and annihilated after ${f} frames (energy drift ${(drift * 100).toFixed(3)}%); alone it decayed after ${g} frames, leaving ${pbar ? 'an antiproton' : 'no antiproton'}`);
  if (!(nb.Z === 0 && nb.N === 1 && nb.anti && nb.dead && Math.abs(drift) < 0.01 && g < 2000 && pbar)) bad('a placed antineutron should annihilate on water and decay to an antiproton');
}
// the Push/Pull tool hauls heavy atoms in as readily as light ones (damped about critically for each one's mass), its
// deeper settings reach across wide wells, and free electrons never feel more than 20 eV of it
{
  const X = load(undefined, { seed: 4 });
  const { W } = X;
  const pullIn = (Z, A, R, s, d0, max) => {
    X.clearWorld(); W.box.w = W.box.tw = 2 * R + 60; W.box.h = W.box.th = 2 * R + 60; W.T = 300; W.gamma = 0.05; W.decayOn = false; W.simPerFrame = 1.5;
    const p = Z ? X.addAtom(Z, d0, 0, { A }) : X.spawnSpec({ kind: 'e' }, d0, 0, 300)[0]; p.vx = 0; p.vy = 0;
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    W.tool = { type: 'pull', active: true, x: 0, y: 0, R, s };
    let f = 0, peak = 0;
    for (; f < max && Math.hypot(p.x, p.y) > 1.2; f++) { X.simFrame(1 / 60, 1000); peak = Math.max(peak, p.rad ? p.KE : 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy)); }
    W.tool = null;
    return { f, d: Math.hypot(p.x, p.y), peak };
  };
  const u = pullIn(92, 235, 10, 20, 8, 400), h = pullIn(1, 1, 10, 20, 8, 400), far = pullIn(92, 235, 40, 1000, 35, 400), e = pullIn(0, 0, 10, 1000, 8, 60);
  info(`pull, 20 eV over 10 Å: U-235 in after ${u.f} frames, H after ${h.f} (fastest ${X.fmtE(h.peak)}); 1 keV over 40 Å: U-235 from 35 Å in ${far.f} frames; a free electron in a 1 keV well peaks at ${X.fmtE(e.peak)}`);
  if (!(u.f < 120 && h.f < 20 && h.peak < 25 && far.f < 150 && e.peak < 25)) bad(`the pull tool: ${JSON.stringify({ u, h, far, e })}`);
}
// the electron-gun setup: 1 keV electrons light the zinc screen in zinc's own blue lines, where a magnet steers them;
// flipping the magnet's pole moves the spot to the other side
{
  const X = load('all', { seed: 22 });
  const { W } = X;
  X.PRESETS.crt.build(); X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned; W.baseSpf = W.simPerFrame;
  let ex = 0; const nm = new Set();
  const e0 = X.exciteByElectron; X.exciteByElectron = function (...a) { ex++; return e0.apply(this, a); };
  const p0 = X.emitPhoton; X.emitPhoton = function (x, y, E, ...r) { if (E > 1.6 && E < 3.3) nm.add(Math.round(X.PHYS.HC / E)); return p0.apply(this, [x, y, E, ...r]); };
  const spot = () => { const ys = []; for (const t of W.tracks) { const q = t.pts; for (let i = 0; i + 3 < q.length; i += 2) if (q[i] < 80 && q[i + 2] >= 80) ys.push(q[i + 1]); } ys.splice(0, Math.max(0, ys.length - 6)); return ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : NaN; };
  for (let f = 0; f < 300; f++) X.simFrame(1 / 60, 40);
  const y1 = spot(); W.magnets[0].B = -W.magnets[0].B; for (let f = 0; f < 200; f++) X.simFrame(1 / 60, 40); const y2 = spot();
  info(`electron gun: ${ex} excitations of the zinc screen, light at ${[...nm].sort().join(', ')} nm; the spot at y ${y1.toFixed(0)} Å, then ${y2.toFixed(0)} Å with the pole flipped`);
  if (!(ex >= 5 && [...nm].some(v => v >= 466 && v <= 483) && y1 > 3 && y2 < -3)) bad('the electron gun should light the zinc screen where the magnet steers it');
}
// ionization without the lag: free electrons around molecular ions in a dense plasma, where capture cannot pay, no
// longer retry on every one of their short steps (with a full force recount each time: 15,000 tries and 900 recounts
// in 20 frames); after a few ionizations they still recombine, and energy is kept throughout
{
  const X = load('all', { seed: 8 });
  const { W } = X;
  X.PRESETS.water.build(); X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned; W.baseSpf = W.simPerFrame;
  W.slowmo = false; W.gamma = 0; W.decayOn = false;
  for (let f = 0; f < 10; f++) X.simFrame(1 / 60, 10);
  const O = W.parts.filter(p => !p.dead && p.k === X.NUC && p.Z === 8);
  const tot = () => X.totalEnergy().total - W.ledger.nuc;
  for (const p of O.slice(0, 6)) X.userIonize(p);
  const e0 = tot(); let f = 0;
  for (; f < 400 && W.parts.some(p => !p.dead && p.k === X.ELEC); f++) X.simFrame(1 / 60, 1e9);
  const back = !W.parts.some(p => !p.dead && p.k === X.ELEC), keEnd = W.parts.reduce((s, p) => s + (p.dead ? 0 : X.keOf(p)), 0), drift = tot() - e0;
  for (const p of O.slice(6, 46)) X.userIonize(p);
  for (let k = 0; k < 5; k++) X.simFrame(1 / 60, 10);
  const C = { join: 0, cf: 0, steps: 0 };
  const wrap = (name, k) => { const g = X[name]; X[name] = function (...a) { C[k]++; return g.apply(this, a); }; };
  wrap('joinEnergy', 'join'); wrap('computeForces', 'cf');
  for (let k = 0; k < 20; k++) C.steps += X.simFrame(1 / 60, 10).steps;
  const nE = W.parts.filter(p => !p.dead && p.k === X.ELEC).length;
  info(`ionization: 6 molecules ionized → all electrons back after ${f} frames (energy drift ${drift.toFixed(2)} eV); then 40 more: ${C.join} capture trials and ${C.cf} force recounts in ${C.steps} steps with ${nE} free electrons`);
  if (!(back && Math.abs(drift) < 5 + 0.02 * keEnd && C.join < 40 * C.steps * 0.5 + 20 && C.cf < 4 * C.steps + 20)) bad(`ionization lag or recombination: ${JSON.stringify({ back, f, drift, C, nE })}`);
}
console.log(fails ? `${fails} physics failure(s)` : 'physics checks passed');
process.exitCode = fails ? 1 : 0;
