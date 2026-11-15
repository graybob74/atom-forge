'use strict';
/* The checks for 1.34.0 (the owner, 2026-11-15, "build it and release when done"): planned items 89–96, Experimental →
   More forces. Run by t_features (one line) or alone: node tests/f_134.js [part …]. Each part fails on 1.33.3 (the
   switches are not there). (check(ok, good, bad); say(...)) */
const path = require('path');
const PARTS = {};
const { load } = require(path.join(__dirname, 'load.js'));
const tot = (X) => X.totalEnergy().total + X.W.ledger.bath;
function world(seed, build) { const X = load('all', { seed }), W = X.W; X.PRESETS.empty.build(); W.gamma = 0; W.Ex = 0; W.Ey = 0; W.decayOn = false; build(X); X.forcesNoEvents(); W.fSpawn = W.spawned; return X; }
function run(X, n, dt) { const E0 = tot(X); let worst = 0; for (let s = 0; s < n; s++) { X.step(dt); worst = Math.max(worst, Math.abs(tot(X) - E0)); } return { d: tot(X) - E0, worst }; }
function fd(X) { // the forces against the energy's slope, for the first atoms
  const W = X.W, S = X.S, ps = W.parts.filter(p => !p.dead && p.k === X.NUC), F = { fx: new Float64Array(S.fx.length), fy: new Float64Array(S.fx.length), fz: new Float64Array(S.fx.length) };
  X.xfForces(F.fx, F.fy, F.fz); let worst = 0, big = 0;
  for (const p of ps.slice(0, 6)) for (const ax of W.d3 ? ['x', 'y', 'z'] : ['x', 'y']) {
    const h = 1e-4, x0 = p[ax]; p[ax] = x0 + h; const Ep = X.xfEnergy(); p[ax] = x0 - h; const Em = X.xfEnergy(); p[ax] = x0;
    const num = -(Ep - Em) / (2 * h), an = F['f' + ax][p.i]; worst = Math.max(worst, Math.abs(num - an)); big = Math.max(big, Math.abs(an));
  }
  return { worst, big };
}

/* 91: gravity: forces the slope of its energy, books kept (boosted ×10³³ so that it moves things), the Earth's pull. */
PARTS.gravity = async (page, check) => {
  const X = world(1, X => { X.addAtom('Ar', -3, 0); X.addAtom('Ar', 3, 0.5); X.addAtom('Ar', 0, 4); });
  X.xfSet({ grav: 1, gk: 33 }); const U = X.xfEnergy(), f = fd(X), r = run(X, 300, 0.05);
  const Y = world(1, X => { X.addAtom('Ar', 0, 0); }); Y.xfSet({ grav: 2, gk: 16 }); const y0 = Y.W.parts[0].y; const r2 = run(Y, 200, 0.05), fell = y0 - Y.W.parts[0].y;
  check(U < 0 && f.worst < 1e-6 * Math.max(1, f.big) && r.worst < 0.02 && r2.worst < 0.02 && fell > 1, `1.34 (91) gravity: three argon atoms ×10³³ pull together (U ${U.toFixed(2)} eV), the forces its slope (${f.worst.toExponential(1)}), the books kept to ${r.worst.toFixed(4)} eV over 300 steps; the Earth's pull ×10¹⁶ drops an atom ${fell.toFixed(1)} Å, books to ${r2.worst.toFixed(4)}`, '1.34 gravity: ' + JSON.stringify({ U, f, r, r2, fell }));
};
/* 90: radiation from accelerating charges: a 3 MeV electron circling in 20,000 T radiates photons, the energy books kept. */
PARTS.radiation = async (page, check) => {
  const X = world(5, X => { X.W.wall = 'wrap'; const e = X.addLepton(X.ELEC, 0, 0, 1, 0); e.vx = Math.sqrt(2 * 3e6 / X.PHYS.ME_SIM); X.updateFast(e); });
  X.W.Bz = 2e4; X.xfSet({ rad: true });
  const e = X.W.parts.find(p => p.k === X.ELEC), k0 = X.keOf(e), r = run(X, 400, 0.01), lost = k0 - X.keOf(e);
  check(lost > 300 && X.XF.emitted >= 3 && Math.abs(r.worst) < 1e-3, `1.34 (90) a 3 MeV electron in 20,000 T radiates ${lost.toFixed(0)} eV in 4 tu as ${X.XF.emitted} photons (${(X.XF.ePh / X.XF.emitted).toFixed(0)} eV each) and what is still to go; the books kept to ${r.worst.toExponential(1)} eV`, '1.34 radiation: ' + JSON.stringify({ lost, n: X.XF.emitted, r }));
};
/* 89a: the magnetic fields of moving charges: two rows of fast electrons feel each other's fields; nothing changes the books. */
PARTS.fields = async (page, check) => {
  const X = world(6, X => { X.W.wall = 'wrap'; for (const y of [-2, 2]) for (let i = 0; i < 5; i++) X.addLepton(X.ELEC, -30 + 3 * i, y, 20000, 0); });
  X.xfSet({ bi: true }); const r = run(X, 50, 0.0005), B = X.W.parts.filter(p => !p.dead && p._Bi).map(p => Math.abs(p._Bi));
  check(X.XF.nBi === 10 && B.length === 10 && Math.min(...B) > 1 && r.worst < 1e-6, `1.34 (89a) ten fast electrons each feel the others' magnetic fields (${Math.min(...B).toFixed(0)}–${Math.max(...B).toFixed(0)} T), the books unchanged (${r.worst.toExponential(1)} eV)`, '1.34 fields: ' + JSON.stringify({ n: X.XF.nBi, B, r }));
};
/* 89b, c: atomic moments and exchange: forces the slope of the energy (with a magnet's gradient), the books kept without
   the bath, and with it a cluster of iron lines up. */
PARTS.spins = async (page, check) => {
  const X = world(2, X => { for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) X.addAtom('Fe', -4 + 2.75 * i + 0.3 * j, -3 + 2.8 * j); X.W.magnets.push({ x: 8, y: 0, R: 3, B: 500 }); });
  X.xfSet({ spin: true, exch: true }); for (const p of X.W.parts) if (p._sp) p._sp = [0.6, 0.3, Math.sqrt(0.55)];
  const f = fd(X), r = run(X, 300, 0.02);
  const Y = world(2, X => { for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) X.addAtom('Fe', -4 + 2.5 * i + 0.3 * j, -3 + 2.4 * j); });
  Y.xfSet({ spin: true, exch: true }); const m = () => { const s = [0, 0, 0]; let n = 0; for (const p of Y.W.parts) if (p._sp) { n++; for (let k = 0; k < 3; k++) s[k] += p._sp[k]; } return Math.hypot(...s) / n; };
  const m0 = m(); Y.W.gamma = 1; Y.W.T = 50; run(Y, 1200, 0.02); const m1 = m();
  check(f.worst < 1e-6 * Math.max(1, f.big) && f.big > 1e-3 && r.worst < 1e-3 && m0 < 0.6 && m1 > 0.75, `1.34 (89b, c) atomic moments: the forces their energy's slope (${f.worst.toExponential(1)} of ${f.big.toFixed(3)} eV/Å), the books kept to ${r.worst.toExponential(1)} eV beside a 500 T magnet; with the bath at 50 K, twelve iron atoms' moments line up (${m0.toFixed(2)} → ${m1.toFixed(2)} of full)`, '1.34 spins: ' + JSON.stringify({ f, r, m0, m1 }));
};
/* 93: neutrinos meeting electrons: boosted, a 5 MeV νₑ through water knocks electrons out; what it gave is what did not escape. */
PARTS.neutrinos = async (page, check) => {
  const X = load('all', { seed: 7 }); X.PRESETS.water.build(); X.W.decayOn = false; X.xfSet({ nu: 20 }); X.forcesNoEvents();
  const e0 = X.W.parts.filter(p => p.k === X.ELEC && !p.dead).length, E0 = tot(X), esc0 = X.W.ledger.escaped;
  for (let i = 0; i < 20; i++) X.emitNeutrino(-20, (i - 10) * 0.7, 5e6, 1, 0, false, 'test', 'e');
  const dE = tot(X) - E0, got = 20 * 5e6 - (X.W.ledger.escaped - esc0), freed = X.W.parts.filter(p => p.k === X.ELEC && !p.dead).length - e0;
  const Y = load('all', { seed: 7 }); Y.PRESETS.water.build(); Y.xfSet({ nu: 1 }); for (let i = 0; i < 20; i++) Y.emitNeutrino(-20, (i - 10) * 0.7, 5e6, 1, 0, false, 'test', 'e');
  check(X.XF.nuHits >= 10 && freed >= 5 && got > 1e5 && Math.abs(dE - 1e8) < 1 && !Y.XF.nuHits, `1.34 (93) neutrinos ×10²⁰: 20 of 5 MeV through water strike ${X.XF.nuHits} electrons (${freed} knocked free, ${(got / 1e6).toFixed(2)} MeV left in the box, the rest escaped, the books exact); at the real rate none`, '1.34 neutrinos: ' + JSON.stringify({ hits: X.XF.nuHits, freed, got, dE, real: Y.XF.nuHits }));
};
/* 94, 95: full-range partial charges and three-body dispersion in liquid water: forces the slope, books kept. */
PARTS.charges = async (page, check) => {
  for (const [k, c, lab] of [['lrq', { lrq: true }, '(94) full-range partial charges'], ['disp', { disp: true }, '(95) three-body dispersion']]) {
    const X = load('all', { seed: 3 }); X.PRESETS.water.build(); X.W.gamma = 0; X.W.decayOn = false; X.forcesNoEvents(); X.W.fSpawn = X.W.spawned;
    const base = run(X, 60, 0.02); X.xfSet(c); const U = X.xfEnergy(), f = fd(X), r = run(X, 60, 0.02);
    check(U !== 0 && f.big > 0 && f.worst < 1e-6 * Math.max(1, f.big) && r.worst < base.worst * 3 + 0.002, `1.34 ${lab} in liquid water: ${U.toFixed(4)} eV, the forces its slope (${f.worst.toExponential(1)}), the books kept to ${r.worst.toFixed(4)} eV over 60 steps (${base.worst.toFixed(4)} without)`, `1.34 ${k}: ` + JSON.stringify({ U, f, r, base }));
  }
};
/* 92: nucleons inside nuclei: α on ¹²C at 30 MeV a nucleon worked out nucleon by nucleon: pieces made, the products'
   four-momenta summing to the pair's exactly; the inset kept. */
PARTS.nucleons = async (page, check) => {
  const X = load('all', { seed: 9 }), W = X.W; X.PRESETS.empty.build(); W.decayOn = false; X.xfSet({ nucl: true });
  const g = X.xnGround(2, 2); let made = 0, worst = 0, pieces = new Set(), caps = [];
  for (let k = 0; k < 6; k++) {
    const a = X.addAtom('He', -1, 0, { A: 4, charge: 2 }), b = X.addAtom('C', 1, 0, { A: 12, charge: 6 }); X.setMotion(a, 30 * 4e6, 1, 0);
    const Pa = X.p4of(a, true), Pb = X.p4of(b, true), P = X.add4(Pa, Pb), M = X.mass4(P), items = [], moms = [];
    if (X.xnCollide(a, b, Pa, P, M, 0.5 + 0.6 * k, false, items, moms)) {
      made++; const S = moms.reduce((s, m) => s.map((v, i) => v + m[i]), [0, 0, 0]); worst = Math.max(worst, ...S.map((v, i) => Math.abs(v - P[i])));
      X.XN.last.pieces.forEach(p => pieces.add(p)); caps.push(items.map(it => it.Z + '/' + it.N).join(' '));
    }
    W.parts.forEach(p => { p.dead = true; }); X.PRESETS.empty.build();
  }
  const a = X.addAtom('He', -1, 0, { A: 4, charge: 2 }), b = X.addAtom('C', 1, 0, { A: 12, charge: 6 }); X.setMotion(a, 30 * 4e6, 1, 0);
  const cap = X.nuclearEncounter(a, b, 0.3, 0, 0);
  check(-g.U > 25 && made >= 3 && worst < 1e-6 && pieces.size >= 2 && X.XN.last.frames.length > 20 && /nucleon by nucleon/.test(X.XN.last && cap ? 'nucleon by nucleon' : ''), `1.34 (92) nucleons inside nuclei: ⁴He held by ${(-g.U).toFixed(1)} MeV; α + ¹²C at 30 MeV a nucleon, ${made} of 6 passes worked out nucleon by nucleon into ${[...pieces].join(', ')}, the products' four-momenta the pair's to ${worst.toExponential(1)} MeV; the inset holds ${X.XN.last.frames.length} frames ("${cap}")`, '1.34 nucleons: ' + JSON.stringify({ U: g.U, made, worst, pieces: [...pieces], caps, cap }));
};
/* 1.34.1 (the owner: a 1 PeV neutron on helium, silicon behind it ionized before anything from the collision got there):
   in slow motion a photon's hit waits for its light to arrive; the books kept. */
PARTS.lightArrives = async (page, check) => {
  const X = load('all', { seed: 1 }), W = X.W;
  X.PRESETS.empty.build(); X.baseWorld(160, 80, 300, 0); W.decayOn = true; W.gamma = 0;
  const he = X.addAtom('He', 0, 0); he.vx = he.vy = 0;
  const si = []; for (let i = 0; i < 8; i++) for (let j = 0; j < 10; j++) { const s = X.addAtom('Si', 10 + 5.2 * i, -23.4 + 5.2 * j); s.vx = s.vy = 0; si.push(s); }
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  X.fireSpec({ kind: 'n' }, -2, 0, 1, 0, 1e15, false);
  const tot = () => X.totalEnergy().total - W.ledger.nuc + W.ledger.bath;
  let first = null, early = 0, E0 = null, worst = 0;
  for (let s = 0; s < 300; s++) {
    X.step(2e-5); if (s === 2) E0 = tot(); if (E0 !== null) worst = Math.max(worst, Math.abs(tot() - E0));
    const front = -2 + W.t * X.PHYS.C;
    for (const p of si) if (!p.dead && p.q !== 0 && !p._seen) { p._seen = true; if (first === null) first = { x: p.x, front, s }; if (p.x > front + 1) early++; }
  }
  check(first && early === 0 && worst < 5, `1.34.1 a 1 PeV neutron on helium in slow motion: the silicon behind it is first ionized at x ${first && first.x.toFixed(1)} Å when the light has reached ${first && first.front.toFixed(1)} Å (1.34.0: at the collision's own step, light at 0.4 Å); none ahead of the light; the books kept to ${worst.toFixed(2)} eV of 1 PeV`, '1.34.1 light arrives: ' + JSON.stringify({ first, early, worst }));
};
/* 1.34.1 (the owner: "a label for" the dashed streaks): a γ ray whose head has run off the screen is labelled where its line
   leaves it. */
PARTS.rayLabels = async (page, check) => {
  const X = load('all', { seed: 1 }); X.R.w = 800; X.R.h = 500;
  const off = X.rayLabelAt({ sx: 400, sy: 250, hx: -300, hy: 250 }), on = X.rayLabelAt({ sx: 400, sy: 250, hx: 300, hy: 200 }), gone = X.rayLabelAt({ sx: -50, sy: -50, hx: -400, hy: -10 });
  check(off && Math.abs(off[0] - 6) < 0.5 && Math.abs(off[1] - 250) < 0.5 && on && on[0] === 300 && gone === null, `1.34.1 a ray running off the screen is labelled at its edge (${off && off.map(v => v.toFixed(0)).join(', ')}), one on it at its head, one wholly off it not at all`, '1.34.1 labels: ' + JSON.stringify({ off, on, gone }));
};
/* 1.34.1 (the owner: "high energy collisions create this spam-annihilation of opposite pions, is that correct?"): with
   Unstable particles meet each other on, one collision's pions no longer meet each other (827 meetings after a 1 PeV
   neutron on helium in 1.34.0); two pions fired at each other still annihilate. */
PARTS.oneCascade = async (page, check) => {
  const X = load('all', { seed: 2 }), W = X.W;
  X.PRESETS.empty.build(); X.baseWorld(400, 200, 300, 0); W.decayOn = true; W.gamma = 0; X.RP.exm = true;
  X.addAtom('He', 0, 0); X.forcesNoEvents(); W.fSpawn = W.spawned;
  X.fireSpec({ kind: 'n' }, -4, 0, 1, 0, 1e15, false);
  let made = 0; for (let s = 0; s < 3000; s++) { X.step(2e-5); made = Math.max(made, W.exo.filter(o => !o.dead).length); }
  const n1 = X.EXM.n;
  const Y = load('all', { seed: 3 }); Y.PRESETS.empty.build(); Y.baseWorld(60, 40, 300, 0); Y.W.decayOn = false; Y.RP.exm = true;
  Y.fireSpec({ kind: 'exo', sp: 'pi+' }, -6, 0, 1, 0, 1e8, false); Y.fireSpec({ kind: 'exo', sp: 'pi-' }, 6, 0, -1, 0, 1e8, false);
  for (let s = 0; s < 400 && !Y.EXM.n; s++) Y.step(1e-4);
  check(made > 10 && n1 === 0 && Y.EXM.n === 1, `1.34.1 a 1 PeV neutron on helium makes ${made} unstable particles at once and none of them meets another from the same collision (827 meetings in 1.34.0); a π⁺ and a π⁻ fired at each other still meet (${Y.EXM.n})`, '1.34.1 one cascade: ' + JSON.stringify({ made, n1, fired: Y.EXM.n }));
};
/* The page: the More forces rows, each switch reaching the engine, a run of liquid water with all of them on without an
   error, the inset drawn, and Reset to normal turning them off. */
PARTS.page = async (page, check) => {
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ settle: 800 }); page = own.page; }
  const errs = []; const onErr = (e) => errs.push(e.message); page.on('pageerror', onErr);
  const r = await page.evaluate(async () => { try {
    const raf = () => new Promise(res => requestAnimationFrame(res)), out = {};
    loadPreset('water'); await raf();
    out.rows = ['segXgrav', 'segXgk', 'setXrad', 'setXbi', 'segXspin', 'segXnu', 'setXlrq', 'setXdisp', 'setXnucl'].every(id => !!$(id));
    setSetting('xgrav', 1); setSetting('xgk', 24); setSetting('xrad', true); setSetting('xbi', true); setSetting('xspin', 2); setSetting('xnu', 18); setSetting('xlrq', true); setSetting('xdisp', true); setSetting('xnucl', true);
    out.on = XF.grav === 1 && XF.gk === 24 && XF.rad && XF.bi && XF.spin && XF.exch && XF.nu === 18 && XF.lrq && XF.disp && XF.nucl;
    for (let i = 0; i < 30; i++) await raf();
    out.err = window.__afErr || null; out.t = W.t;
    const a = addAtom('He', -1, 0, { A: 4, charge: 2 }), b = addAtom('C', 1, 0, { A: 12, charge: 6 }); setMotion(a, 30 * 4e6, 1, 0); nuclearEncounter(a, b, 0.3, 0, 0);
    await raf(); await raf(); out.inset = !!(XN.last && XN.last.frames.length);
    openSettings && openSettings(); const q = $('setSearch'); if (q) { q.value = 'gravity'; q.dispatchEvent(new Event('input')); await raf(); out.found = [...document.querySelectorAll('#setModal .srow, #setModal label')].some(el => el.offsetParent && /Gravity/.test(el.textContent)); }
    $('setExpReset').click(); await raf();
    out.off = !XF.grav && !XF.rad && !XF.bi && !XF.spin && !XF.nu && !XF.lrq && !XF.disp && !XF.nucl;
    $('setClose').click();
    return out;
  } catch (e) { return { err: e.message }; } });
  page.off('pageerror', onErr); r.pageErrors = errs;
  check(!r.err && !errs.length && r.rows && r.on && r.inset && r.off && r.found !== false, `1.34 Settings → Experimental → More forces: nine switches reach the engine, liquid water runs with all on, the nucleon inset is drawn, the search finds them, Reset to normal turns them off`, '1.34 page: ' + JSON.stringify(r));
  if (own) await own.browser.close();
};

module.exports = async function f134(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.34 ${k}: ${e.message.split('\n')[0]}`); }
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
