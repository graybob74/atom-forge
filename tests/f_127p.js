'use strict';
/* The checks for 1.27's feature 21, polarizability by direction (Settings → Experimental → Polarizability, with Induced
   charges on; src/pold.js; PERF-NOTES "1.27: feature 21"), run by t_features (one line) or alone:
     node tests/f_127p.js [--node] [part …]
   (parts: tensor, field, slope, local, books, events, clear, water, fp, settings). Every part but fp fails on v145 (none
   of it is there); fp shows setups unchanged with the switch off, bit for bit. settings needs the page (skipped with
   --node). (page: the t_features page; check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const books = (X) => X.totalEnergy().total - X.W.ledger.nuc;
const box = (d3, seed = 1) => { const X = load('all', { seed }), W = X.W; if (d3) { X.PRESETS.d3empty.build(); X.world3d(40); } else X.PRESETS.empty.build(); W.gamma = 0; W.T = 0; return X; };
const stir = (at) => { for (const p of at) { p.vx = 0.02 * Math.sin(3 * p.id); p.vy = -0.01 * Math.cos(5 * p.id); p.vz = 0.005 * Math.sin(p.id); } }; // (internal motion to pay an update from)
function eig(T, d3) {
  if (!d3) { const a = T[0], b = T[1], d = T[3], m = (a + d) / 2, r = Math.sqrt(((a - d) / 2) ** 2 + b * b); return [m + r, m - r]; }
  const M = [[T[0], T[1], T[2]], [T[1], T[3], T[4]], [T[2], T[4], T[5]]];
  for (let s = 0; s < 50; s++) for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
    if (Math.abs(M[p][q]) < 1e-14) continue; const th = 0.5 * Math.atan2(2 * M[p][q], M[q][q] - M[p][p]), c = Math.cos(th), sn = Math.sin(th);
    for (let k = 0; k < 3; k++) { const a = M[k][p], b = M[k][q]; M[k][p] = c * a - sn * b; M[k][q] = sn * a + c * b; }
    for (let k = 0; k < 3; k++) { const a = M[p][k], b = M[q][k]; M[p][k] = c * a - sn * b; M[q][k] = sn * a + c * b; }
  }
  return [M[0][0], M[1][1], M[2][2]].sort((a, b) => b - a);
}
const run = (X, n) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };
const setup = (key, every, seed = 12) => { const X = load('all', { seed }), W = X.W; X.PRESETS[key].build(); X.settleOverlaps(); W.gamma = 0; W.sources.length = 0; X.forcesNoEvents(); W.fSpawn = W.spawned; X.QEQ.every = every; X.pdOn(1); return X; };

/* ---- 1. the molecules' tensors in the 3-D lab against the measured ones (Å³; the principal values) */
PARTS.tensor = async (page, check, say) => {
  const REF = { N2: [2.20, 1.51, 1.51], CO2: [3.96, 1.96, 1.96], benzene: [12.18, 12.18, 6.62], H2O: [1.47, 1.47, 1.47], CH4: [2.60, 2.60, 2.60], O2: [2.30, 1.22, 1.22], C2H6: null };
  const got = {}, bad = [];
  for (const [m, ref] of Object.entries(REF)) {
    const X = box(true), at = X.addMolecule(m, 0, 0, 0, 0, 0), e = eig(X.pdMolAlpha(at), true).map(v => +v.toFixed(2)); got[m] = e;
    if (ref && e.some((v, k) => Math.abs(v - ref[k]) > 0.02 * ref[k] + 0.01)) bad.push(m);
  }
  const mean = (e) => +((e[0] + e[1] + e[2]) / 3).toFixed(2);
  const X = box(false), bz = X.addMolecule('benzene', 0, 0, 0, 0, 0), flat = eig(X.pdMolAlpha(bz), false).map(v => +v.toFixed(2));
  say('  1.27 (21) tensors: ' + JSON.stringify({ got, flatBenzene: flat }));
  check(!bad.length && Math.abs(mean(got.C2H6) - 4.47) < 0.05 && Math.abs(flat[0] - 12.18) < 0.05 && Math.abs(flat[1] - 12.18) < 0.05,
    `1.27 (21): polarizability by direction: N₂ ${got.N2[0]} / ${got.N2[1]} Å³ along / across (measured 2.20 / 1.51), CO₂ ${got.CO2[0]} / ${got.CO2[1]} (3.96 / 1.96), benzene ${got.benzene[0]} in its plane and ${got.benzene[2]} out of it (12.2 / 6.6; charge flow 166.9 / 0), water ${got.H2O.join(' / ')}, methane ${got.CH4[0]}, ethane's mean ${mean(got.C2H6)} (4.47); the flat game's benzene ${flat.join(' / ')} in the plane`,
    '1.27 (21) tensor: ' + JSON.stringify({ bad, got, flat }));
};

/* ---- 2. an applied field along each axis: the molecule's induced dipole is the tensor's response, both modes */
PARTS.field = async (page, check, say) => {
  const res = {}; let worst = 0;
  for (const [m, d3] of [['benzene', 1], ['CO2', 1], ['N2', 1], ['benzene', 0], ['CO2', 0]]) {
    const X = box(!!d3), W = X.W, at = X.addMolecule(m, 0, 0, 0, 0, 0); stir(at);
    X.QEQ.every = 1; X.pdOn(1);
    const T = X.pdMolAlpha(at), E = 0.02, row = [];
    for (const [ex, ey, ez] of d3 ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : [[1, 0, 0], [0, 1, 0]]) {
      W.Ex = E * ex; W.Ey = E * ey; W.Ez = E * ez; X.pdUpdate();
      let mx = 0, my = 0, mz = 0; for (const p of at) if (X.pdAct(p)) { mx += p.dmx; my += p.dmy; mz += p.dmz; }
      const got = (mx * ex + my * ey + mz * ez) / (E / X.PHYS.KE), want = ex ? T[0] : ey ? T[3] : T[5];
      worst = Math.max(worst, Math.abs(got - want) / want); row.push(+got.toFixed(3));
    }
    res[m + (d3 ? '3' : '2')] = row;
  }
  say('  1.27 (21) field: ' + JSON.stringify(res));
  check(worst < 0.01, `1.27 (21): an applied field of 0.02 V/Å along each axis gives each molecule the dipole its tensor says, to ${(worst * 100).toFixed(2)}% (the solve stops at 10⁻⁵ e·Å) (benzene, CO₂, N₂ in 3-D; benzene, CO₂ flat)`, '1.27 (21) field: ' + JSON.stringify({ worst, res }));
};

/* ---- 3. forces against the energy's slope (x, y, z), with dipoles, charges, an ion and an applied field */
PARTS.slope = async (page, check, say) => {
  const res = {};
  for (const d3 of [true, false]) {
    const X = load('all', { seed: 3 }), W = X.W;
    if (d3) X.PRESETS.d3empty.build(); else X.PRESETS.empty.build(); W.gamma = 0; W.T = 0;
    for (const [k, x, y, z] of [['H2O', -2, 0, 0], ['H2O', 1, 0.5, 0.3], ['NH3', 0, 3, 1], ['CH3Cl', 3, -2, -1], ['benzene', -3, -3.5, 3], ['CO2', 4, 3, 3], ['N2', 0, -4, -3]]) X.addMolecule(k, x * 1.3, y * 1.3, 0.7 * x, 0, (z || 0) * 1.3);
    X.addAtom('Na', 6.5, -6.5, d3 ? { T: 0, z: 1 } : { T: 0 }); const na = W.parts[W.parts.length - 1]; if (na.q !== 1) { na.q = 1; na.ionic = true; }
    stir(W.parts); W.Ex = 0.05; W.Ey = -0.03; if (d3) W.Ez = 0.02;
    X.QEQ.every = 1; X.pdOn(1); X.forcesNoEvents(); X.pdUpdate();
    const n = X.S.size, FX = new Float64Array(n), FY = new Float64Array(n), FZ = new Float64Array(n); X.pdForces(FX, FY, FZ);
    const pos = () => X.pdTotal() - W.parts.filter(X.pdAct).reduce((s, q) => s + q.dmc + X.pdFieldU(q), 0); // (the pairs' part: the atoms' own terms do not move with the positions)
    let worst = 0, fmax = 0; const hh = 1e-5;
    for (const p of W.parts) for (const c of d3 ? ['x', 'y', 'z'] : ['x', 'y']) {
      const v = p[c]; p[c] = v + hh; X.gridTouch(); const ep = pos(); p[c] = v - hh; X.gridTouch(); const em = pos(); p[c] = v; X.gridTouch();
      const f = (c === 'x' ? FX : c === 'y' ? FY : FZ)[p.i]; worst = Math.max(worst, Math.abs(-(ep - em) / (2 * hh) - f)); fmax = Math.max(fmax, Math.abs(f));
    }
    res[d3 ? 'd3' : 'd2'] = { dipoles: X.PD.n, worst: +worst.toExponential(1), fmax: +fmax.toFixed(3) };
  }
  check(res.d3.worst < 1e-8 && res.d2.worst < 1e-8 && res.d3.dipoles >= 30 && res.d3.fmax > 0.005,
    `1.27 (21): the dipoles' forces are the energy's slopes in x, y and z to ${res.d3.worst} eV/Å (3-D: ${res.d3.dipoles} atoms with dipoles, forces up to ${res.d3.fmax} eV/Å, a Na⁺ and a field among them) and ${res.d2.worst} in the flat game`,
    '1.27 (21) slope: ' + JSON.stringify(res));
};

/* ---- 4. the events' energy (localPE over everything) and the books' (totalEnergy) agree on the dipoles' share */
PARTS.local = async (page, check, say) => {
  const res = {};
  for (const key of ['brine', 'water3d']) {
    const X = setup(key, 1); run(X, 20);
    const all = new Set(X.W.parts.filter(p => !p.dead)), a = X.pdLocal(all, null), b = X.pdTotal();
    const sub = new Set([...all].filter(p => p.Z === 8).slice(0, 30)), c = X.pdLocal(sub, null);
    res[key] = { local: +a.toFixed(6), total: +b.toFixed(6), d: Math.abs(a - b), part: +c.toFixed(4) };
  }
  check(res.brine.d < 1e-9 && res['water3d'].d < 1e-9 && res.brine.total < -1 && res['water3d'].total < -1,
    `1.27 (21): the dipoles' energy as events measure it (localPE) and as the books do (totalEnergy) agree to ${Math.max(res.brine.d, res['water3d'].d).toExponential(1)} eV (brine ${res.brine.total} eV, 3-D water ${res['water3d'].total} eV)`,
    '1.27 (21) local: ' + JSON.stringify(res));
};

/* ---- 5. the books, insulated: water and brine every step, every 10th step, 3-D water */
PARTS.books = async (page, check, say) => {
  const res = {};
  for (const [key, every, n] of [['water', 1, 300], ['brine', 1, 300], ['brine', 10, 300], ['water3d', 10, 100], ['brine3d', 1, 60]]) {
    const X = setup(key, every), E0 = books(X); run(X, n);
    let mm = 0; for (const p of X.W.parts) if (X.pdAct(p)) mm = Math.max(mm, Math.hypot(p.dmx, p.dmy, p.dmz));
    res[key + '/' + every] = { dE: +(books(X) - E0).toFixed(3), upd: X.PD.upd, skipped: X.PD.skipped, maxMu: +mm.toFixed(3) };
  }
  say('  1.27 (21) books: ' + JSON.stringify(res));
  const v = Object.values(res);
  check(v.every(r => Math.abs(r.dE) < 0.5 && r.skipped <= 2 && r.maxMu < 0.6) && res['water/1'].upd === 300 && res['brine/10'].upd === 30,
    `1.27 (21): insulated, the books keep: water ${res['water/1'].dE} eV over 300 steps (every step), brine ${res['brine/1'].dE} (every step) and ${res['brine/10'].dE} (every 10th), 3-D water ${res['water3d/10'].dE}, 3-D brine ${res['brine3d/1'].dE}; no dipole past ${Math.max(...v.map(r => r.maxMu))} e·Å (beside the ions)`,
    '1.27 (21) books: ' + JSON.stringify(res));
};

/* ---- 6. bonds made and broken with dipoles on (3-D hydrogen flame): the books keep */
PARTS.events = async (page, check, say) => {
  const X = load('all', { seed: 7 }), W = X.W; X.PRESETS.hydrogen3d.build(); X.settleOverlaps(); W.gamma = 0; W.sources.length = 0; X.forcesNoEvents(); W.fSpawn = W.spawned; X.QEQ.every = 1; X.pdOn(1);
  const E0 = books(X), c0 = { ...W.count }; run(X, 300);
  const ev = (W.count.bonds - c0.bonds) + (W.count.react - c0.react), dE = +(books(X) - E0).toFixed(3);
  check(ev >= 3 && Math.abs(dE) < 0.3 && X.PD.upd > 100, `1.27 (21): ${ev} bond events and reactions in the 3-D hydrogen flame with dipoles on, the books ${dE} eV off over 300 insulated steps`, '1.27 (21) events: ' + JSON.stringify({ ev, dE, upd: X.PD.upd }));
};

/* ---- 7. off again: no dipole left, the energy kept (paid from the motion), the induced charges back */
PARTS.clear = async (page, check, say) => {
  const X = setup('water', 1); run(X, 30);
  const n0 = X.PD.n, E0 = books(X); X.pdOn(0); const left = X.W.parts.filter(X.pdAct).length, dE = books(X) - E0;
  run(X, 5); const qi = X.W.parts.filter(p => !p.dead && p.qi).length;
  check(n0 > 200 && left === 0 && X.PD.n === 0 && Math.abs(dE) < 1e-6 && qi > 100,
    `1.27 (21): switched off with ${n0} dipoles in water: none left, the energy kept to ${dE.toExponential(1)} eV, and the induced charges flow again (${qi} atoms)`, '1.27 (21) clear: ' + JSON.stringify({ n0, left, dE, qi }));
};

/* ---- 8. liquid water's molecular dipole (Debye): charges alone, induced charges, dipoles; both modes */
PARTS.water = async (page, check, say) => {
  const D = (key, mode, n) => {
    const X = load('all', { seed: 12 }), W = X.W; X.PRESETS[key].build(); X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned; W.sources.length = 0;
    if (mode) X.QEQ.every = 1; if (mode === 2) X.pdOn(1);
    let acc = 0, cnt = 0;
    for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt);
      if (i >= n / 2 && i % 10 === 0) { const mols = new Map(); for (const p of W.parts) if (!p.dead && p.mol && p.bonds.length) { let m = mols.get(p.mol); if (!m) mols.set(p.mol, m = []); m.push(p); }
        for (const m of mols.values()) { if (m.length !== 3) continue; const O = m.find(p => p.Z === 8); let dx = 0, dy = 0, dz = 0;
          for (const p of m) { const [rx, ry, rz] = X.minImg(p.x - O.x, p.y - O.y, p.z - O.z), q = p.q + p.qp; dx += q * rx; dy += q * ry; dz += q * (W.d3 ? rz : 0); if (X.pdAct(p)) { dx += p.dmx; dy += p.dmy; dz += p.dmz; } }
          acc += Math.hypot(dx, dy, dz) * 4.803; cnt++; } } }
    return +(acc / cnt).toFixed(2);
  };
  const r = { flat: [D('water', 0, 300), D('water', 1, 300), D('water', 2, 300)], d3: [D('water3d', 0, 100), D('water3d', 1, 100), D('water3d', 2, 100)] };
  say('  1.27 (21) water dipole (D; charges, induced charges, dipoles): ' + JSON.stringify(r));
  check(r.flat[2] > r.flat[1] && r.flat[2] > 2.45 && r.flat[2] < 2.75 && r.d3[2] > 2.55 && r.d3[2] < 2.85,
    `1.27 (21): liquid water's molecular dipole ${r.d3[2]} D in the 3-D lab with dipoles (charges alone ${r.d3[0]}, induced charges ${r.d3[1]}; measured about 2.6–3.0), ${r.flat[2]} D flat (${r.flat[0]}, ${r.flat[1]})`,
    '1.27 (21) water: ' + JSON.stringify(r));
};

/* ---- 9. switch off: setups as in v145, bit for bit (tools/fingerprint.js: seed 7, 300 steps) */
const FP_V145 = { water: 'cac1ac32 books a9f2ee3a 240', brine: '3a1d6f2f books a9f2ee3a 726', combustion: '92c3628e books a9f2ee3a 140', hydrogen3d: 'c24871d1 books d04d63e8 200', water3d: '7a2e7f5c books a9f2ee3a 1029' };
PARTS.fp = async (page, check, say) => {
  const out = require('child_process').execFileSync(process.execPath, [require('path').join(__dirname, '..', 'tools', 'fingerprint.js'), ...Object.keys(FP_V145)], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const bad = [];
  for (const line of out.split('\n')) { const m = line.trim().split(/\s+/); if (m.length < 2 || !FP_V145[m[0]]) continue; const got = m.slice(1).join(' '); if (got !== FP_V145[m[0]]) bad.push(`${m[0]} ${got} (v145 ${FP_V145[m[0]]})`); }
  check(!bad.length && out.split('\n').filter(l => l.trim()).length >= Object.keys(FP_V145).length, `1.27 (21): switch off, the setups as in v145 (fingerprints of ${Object.keys(FP_V145).join(', ')}; every one of the 60 was checked when it was built)`, '1.27 (21) fp: ' + JSON.stringify(bad));
};

/* ---- 10. Settings: the row, off at start, described in both modes, on only with induced charges, in the total */
PARTS.settings = async (page, check, say) => {
  const r = await page.evaluate(async () => {
    const out = { start: [SET.pold, PD.on] };
    openSettings('exp'); await new Promise(res => setTimeout(res, 60));
    const vis = () => !!$('segPold') && !!$('segPold').offsetParent; out.row = [vis()]; out.desc = !!SDESC.segPold && !!SDESC3.segPold; // (a sub-option of Induced charges since 1.28: shown only with them on)
    $('segPold').querySelector('[data-v="1"]').click(); out.alone = [SET.pold, PD.on]; // (induced charges off: nothing yet)
    $('segQeq').querySelector('[data-v="10"]').click(); out.with = [SET.pold, PD.on, QEQ.every]; out.row.push(vis()); out.total = $('expTotal').textContent.includes('polarizability by direction');
    $('segPold').querySelector('[data-v="0"]').click(); out.off = [SET.pold, PD.on];
    $('segQeq').querySelector('[data-v="0"]').click();
    hideModal('setModal'); return out;
  });
  say('  1.27 (21) settings: ' + JSON.stringify(r));
  check(r.start.join() === '0,0' && r.row.join() === 'false,true' && r.desc && r.alone.join() === '1,0' && r.with.join() === '1,1,10' && r.total && r.off.join() === '0,0',
    '1.27 (21): Settings → Experimental → Polarizability: off at start, shown under Induced charges only while they are on (1.28), described in both modes, on only with Induced charges on, in the Experimental total, off again',
    '1.27 (21) settings: ' + JSON.stringify(r));
};
PARTS.settings.page = true;

module.exports = async function f127p(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (1.27 (21) ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.27 (21) ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  const args = process.argv.slice(2), noPage = args.includes('--node'), parts = args.filter(a => a !== '--node');
  const needPage = !noPage && (!parts.length || parts.includes('settings'));
  let browser = null, page = null, errors = [];
  if (needPage) { const { openPage } = require('./browser'); ({ browser, page, errors } = await openPage({ settle: 800 })); }
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(page, check, say, null, parts);
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  if (browser) await browser.close();
  console.log(fails ? `${fails} failure(s)` : '1.27 feature 21 checks passed');
  process.exitCode = fails ? 1 : 0;
})();
