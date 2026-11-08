'use strict';
/* The checks for 1.29.0's items (the owner, 2026-11-08: "Do all of those items"), run by t_features (one line) or
   alone: node tests/f_129.js [part …]. Item 55 (video recording removed) is checked in t_features itself.
   57 antimatter in 3-D: antiatoms placed, annihilation in depth with exact books, protonium in the 3-D box, a fast p̄
   meeting atoms in 3-D. Each part fails on 1.28.3. (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;
const go = (X, n, dt) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = dt ? Math.min(dt, X.chooseDt()) : X.chooseDt(); X.step(W.dt); } };
const finite = (W) => W.parts.every(p => p.dead || Number.isFinite(p.x + p.y + p.z + p.vx + p.vy + p.vz)) && W.exo.every(o => o.dead || Number.isFinite(o.x + o.y + (o.z || 0)));

/* 57a. Matter touching antimatter in 3-D, each event alone (evAnti until one of the pair is gone; a protonium's own
   annihilation after it): the books exact, the products in depth (some move in z), nothing NaN. 1.28.3: the mesons'
   boost had no z (NaN), nucleons and leptons were sent flat, and protonium was flat-only. */
PARTS.events = async (page, check) => {
  const out = {};
  for (const [name, el, exo] of [['pbar', 'C', true], ['pbar', 'C', false], ['pbar', 'H', true], ['Hbar', 'H', false], ['Cbar', 'C', false]]) {
    const X = load('all', { seed: 4 }), W = X.W; X.RP.exo = exo; X.PRESETS.d3empty.build(); W.T = 0; W.gamma = 0; W.decayOn = false;
    const h = X.addAtom(el, 0, 0, { z: 0 }); h.vx = h.vy = h.vz = 0;
    const pb = name === 'Hbar' ? X.addNuc(1, 0, 1, -0.6, 0, 0, 0, true, 0.1) : name === 'Cbar' ? X.addNuc(6, 6, 6, -1.2, 0, 0, 0, true, 0.1) : X.addNuc(1, 0, 0, -0.3, 0, 0, 0, true, 0.1);
    pb.vx = 0.05; pb.vz = 0.01; X.forcesNoEvents();
    const E0 = books(X); let k = 0;
    try {
      while (!pb.dead && !h.dead && k++ < 12) X.evAnti(pb, h, 0.3);
      const pn = W.exo.find(o => o.sp === 'Pn' && !o.dead), wasPn = !!pn; if (pn) X.pnAnnih(pn);
      X.forcesNoEvents();
      const vz = W.parts.filter(p => !p.dead).some(p => Math.abs(p.vz) > 1e-3) || W.exo.some(o => Math.abs(o.uz || 0) > 1e-3);
      out[name + el + (exo ? 'x' : '')] = { books: +(books(X) - E0).toExponential(1), ok: finite(W), annih: W.count.annih, vz, pn: wasPn };
    } catch (e) { out[name + el] = { err: e.message.split('\n')[0] }; }
  }
  const all = Object.values(out);
  check(all.every(r => !r.err && r.ok && Math.abs(r.books) < 1e-4 && r.annih >= 1) && out.pbarHx.pn && out.pbarCx.vz,
    `1.29 (57) antimatter in 3-D: p̄ on carbon (with and without the cascade), H̄ on H, anti-carbon on carbon and protonium each annihilate in depth, books within ${Math.max(...all.map(r => Math.abs(r.books || 0))).toExponential(0)} eV`,
    '1.29 antimatter events in 3-D: ' + JSON.stringify(out));
};

/* 57b. Protonium in the 3-D box: caught from a slow p̄ beside hydrogen, kept inside the walls (it left the box in
   1.28.3's 3-D loop), annihilating after its 1 ps with X-rays and pions; the books over the whole run. */
PARTS.pn = async (page, check) => {
  const X = load('all', { seed: 4 }), W = X.W; X.RP.exo = true; X.PRESETS.d3empty.build(); W.T = 0; W.gamma = 0; W.decayOn = false; W.wall = 'reflect';
  const h = X.addAtom('H', 0, 0, { z: 0 }); h.vx = h.vy = h.vz = 0;
  const pb = X.addNuc(1, 0, 0, -2, 0, 0, 0, true, 0.2); pb.vx = 0.5; pb.vy = 0; pb.vz = 0;
  X.forcesNoEvents(); W.fSpawn = W.spawned; const E0 = books(X), l0 = W.log.length;
  for (let s = 0; s < 3000 && !pb.dead; s++) go(X, 1, 0.005);
  const o = W.exo.find(q => q.sp === 'Pn'), t0 = W.t;
  for (let k = 0; k < 6000 && o && !o.dead; k++) go(X, 1, 0.05);
  const t = W.log.slice(l0).map(l => l.text).join(' ');
  const r = { made: !!o, fate: o && o.fate, held: o ? +((W.t - t0) * X.PHYS.TU_S * 1e12).toFixed(2) : 0, xray: /X-rays 1\.73 keV/.test(t), books: +(books(X) - E0).toExponential(1), ok: finite(W) };
  check(r.made && /annihilated/.test(r.fate || '') && r.held > 0.9 && r.held < 1.1 && r.xray && Math.abs(r.books) < 1e-3 && r.ok,
    `1.29 (57) protonium in 3-D: caught, kept in the box, annihilates after ${r.held} ps (its 1.73 keV line), books ${r.books} eV`, '1.29 protonium in 3-D: ' + JSON.stringify(r));
};

/* 57c. A p̄ fired into 3-D water at 3 keV meets the atoms on its path and annihilates (fastEncounters3 skipped every
   matter–antimatter pair: it flew on through the water for good); antimatter can be put in the 3-D lab. */
PARTS.fast = async (page, check) => {
  const X = load('all', { seed: 3 }), W = X.W; X.PRESETS.water3d.build(); W.gamma = 0; X.RP.exo = true;
  go(X, 5); const hw = W.box.w / 2;
  const p = X.addNuc(1, 0, 0, -hw + 1, 0, 0, 0, true, 0); X.setMotion(p, 3000, 1, 0.02, 0, 0, 0.01); X.forcesNoEvents(); W.fSpawn = W.spawned;
  const a0 = W.count.annih; let s = 0; for (; s < 400 && !p.dead; s++) go(X, 1);
  const place = ['SPEC_HBAR', 'SPEC_PBAR', 'SPEC_NBAR'].map(k => X.spec3dOK(X[k]));
  const r = { dead: p.dead, steps: s, annih: W.count.annih - a0, place, ok: finite(W) };
  check(r.dead && r.annih >= 1 && place.every(Boolean) && r.ok, `1.29 (57) a 3 keV p̄ fired into 3-D water annihilates on the atoms it meets (step ${s}); H̄, p̄ and n̄ can be put in the 3-D lab`, '1.29 fast p̄ in 3-D: ' + JSON.stringify(r));
};

/* 59. The hydrated electron (Realistic particles → Hydrated electrons): a slow free electron among waters becomes
   e⁻(aq), the books exact; it diffuses at the measured rate; beside a cation it is handed back and captured; light in
   its band is absorbed, the books exact; flat and 3-D. 1.28.3 has none of it. */
PARTS.eaq = async (page, check) => {
  const out = {};
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 2 }), W = X.W; X.PRESETS[d3 ? 'water3d' : 'water'].build(); W.gamma = 0; X.RP.aq = true;
    const B = () => X.totalEnergy().total - W.ledger.nuc;
    go(X, 2);
    X.addLepton(X.ELEC, 0.7, 0.4, 0, 0, 0.2, 0); X.forcesNoEvents(); W.fSpawn = W.spawned;
    let b = B(); X.eaqForm(); X.forcesNoEvents(); const form = B() - b, o = W.exo.find(q => q.sp === 'eaq' && !q.dead);
    const r = { form: +form.toExponential(1), made: !!o };
    if (o) {
      const Ow = W.parts.find(p => !p.dead && p.Z === 8 && Math.hypot(p.x - o.x, p.y - o.y, d3 ? p.z - o.z : 0) > 4);
      Ow.ne -= 1; X.refresh(Ow); X.forcesNoEvents(); W.fSpawn = W.spawned; o.x = Ow.x + 2; o.y = Ow.y; if (d3) o.z = Ow.z;
      b = B(); X.eaqTick(0.001); X.forcesNoEvents(); r.back = +(B() - b).toExponential(1); r.freed = o.dead;
      go(X, 30); r.cap = W.log.some(l => /Electron captured: H₂O⁺ \+ e⁻/.test(l.text));
      X.addLepton(X.ELEC, -3, -3, 0, 0, 0, 0); X.forcesNoEvents(); W.fSpawn = W.spawned; X.eaqForm(); const o2 = W.exo.find(q => q.sp === 'eaq' && !q.dead);
      r.abs = null; for (let k = 0; o2 && k < 60 && r.abs === null; k++) { X.forcesNoEvents(); b = B(); const h = d3 ? X.rayInteract3(o2.x - 0.3, o2.y, o2.z, 1, 0, 0, 1.72, null) : X.rayInteract(o2.x - 0.3, o2.y, 1, 0, 1.72, null); if (h && h.p === null) { h.after(); X.forcesNoEvents(); r.abs = +(B() - b - 1.72).toExponential(1); } }
    }
    // diffusion: 100 of them in the water, eaqTick alone for 2 ps
    for (const q of W.exo) q.dead = true; W.count.eaq = 1; X.RP.aq = false;
    const L = []; for (let k = 0; k < 100; k++) L.push(d3 ? X.addExo('eaq', -5 + k * 0.1, 0, 0, 1, 0, undefined, 0, 0) : X.addExo('eaq', -5 + k * 0.1, 0, 0, 1, 0));
    const p0 = L.map(q => [q.x, q.y, q.z || 0]), T = 200; for (let k = 0; k < T; k++) X.eaqTick(1);
    let msd = 0; L.forEach((q, i) => { msd += (q.x - p0[i][0]) ** 2 + (q.y - p0[i][1]) ** 2 + ((q.z || 0) - p0[i][2]) ** 2; });
    r.D = +(msd / L.length / (2 * (d3 ? 3 : 2) * T) / X.EAQ.D).toFixed(2); // (measured over the set value)
    out[d3 ? 'd3' : 'flat'] = r;
  }
  const ok = (r) => r.made && Math.abs(r.form) < 1e-6 && Math.abs(r.back) < 1e-6 && r.freed && r.cap && r.abs !== null && Math.abs(r.abs) < 1e-6 && r.D > 0.75 && r.D < 1.25;
  check(ok(out.flat) && ok(out.d3), `1.29 (59) hydrated electrons, flat and 3-D: formed, handed back beside H₂O⁺ and captured, a 720 nm photon absorbed, each with exact books; diffusion ${out.flat.D}× and ${out.d3.D}× the measured 4.9×10⁻⁵ cm²/s`, '1.29 hydrated electrons: ' + JSON.stringify(out));
};

/* 61. The d*(2380) in neutron–proton collisions: a bump at √s 2350–2410 MeV (about 6% of the inelastic events near its
   peak), none 5 widths away; the books exact. 1.28.3 never made one. */
PARTS.dstar = async (page, check) => {
  const out = {};
  for (const d3 of [false, true]) for (const far of [false, true]) {
    const X = load('all', { seed: 7 }), W = X.W; X.PRESETS[d3 ? 'd3empty' : 'empty'].build(); W.gamma = 0;
    const B = () => X.totalEnergy().total - W.ledger.nuc, mN = X.nucMeV(0, 1), mP = X.nucMeV(1, 0);
    let n = 0, made = 0, worst = 0;
    for (let k = 0; k < 300; k++) {
      for (const p of W.parts) X.kill(p); W.parts = []; W.exo = []; X.forcesNoEvents();
      const p = X.addNuc(1, 0, 0, 0, 0, 0, 0, false, 0), nn = X.addNuc(0, 1, 0, -0.01, 0, 0, 0, false, 0), rs = (far ? 2800 : 2380) + (k % 7 - 3) * 10;
      X.setMotion(nn, (rs * rs - mN * mN - mP * mP - 2 * mN * mP) / (2 * mP) * 1e6, 1, 0, 0, 0, 0); X.forcesNoEvents();
      const P = X.add4(X.p4of(nn, true), X.p4of(p, true)), M = X.mass4(P), b = B(), c0 = W.count.dstar || 0;
      if (X.nnInelastic(nn, p, 0, 0, P, M)) { n++; X.forcesNoEvents(); worst = Math.max(worst, Math.abs(B() - b)); }
      if ((W.count.dstar || 0) > c0) made++;
    }
    out[(d3 ? '3d' : 'flat') + (far ? 'Far' : '')] = { n, made, worst: +worst.toExponential(1) };
  }
  const ok = out.flat.made >= 9 && out.flat.made <= 30 && out['3d'].made >= 9 && out['3d'].made <= 30 && !out.flatFar.made && !out['3dFar'].made && Object.values(out).every(r => r.worst < 1e-4);
  check(ok, `1.29 (61) the d*(2380) made in np collisions near √s 2380 MeV (${out.flat.made} and ${out['3d'].made} of 300, flat and 3-D), none at 2800 MeV; books within ${Math.max(...Object.values(out).map(r => r.worst)).toExponential(0)} eV`, '1.29 d* in np: ' + JSON.stringify(out));
};

module.exports = async function f129(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.29 ${k}: ${e.message.split('\n')[0]}`); }
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
