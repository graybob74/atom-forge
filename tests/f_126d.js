'use strict';
/* The 1.26 checks for directional forces (Settings → Experimental → Directional forces; src/sites.js), run by
   t_features (its "1.26 (directional)" line) or alone: node tests/f_126d.js [part …]
   (parts: slope, water, sigma, stack, books, settings). (page: the t_features page; check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const NOEV = (src) => src.replace('function queue(type, a, b, c, r) { if (!_noEv)', 'function queue(type, a, b, c, r) { if (!_noEv && !globalThis.AF_NOEV)'); // (no chemistry while a complex relaxes)
const v3 = (a, b) => [b.x - a.x, b.y - a.y, b.z - a.z], nrm = (u) => Math.hypot(u[0], u[1], u[2]), dot = (u, w) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
const ang = (u, w) => Math.acos(Math.max(-1, Math.min(1, dot(u, w) / nrm(u) / nrm(w)))) * 180 / Math.PI;
function box3(seed) { const X = load('all', { seed, patch: NOEV }), W = X.W; X.PRESETS.d3empty.build(); W.box.w = W.box.tw = W.box.h = W.box.th = 40; X.world3d(40); W.gamma = 0; W.T = 0; return X; }
function quench(X, n) { // damped MD to the nearest minimum (velocities zeroed when they run against the forces)
  const W = X.W; globalThis.AF_NOEV = true; X.forcesNoEvents();
  for (let k = 0; k < n; k++) { X.step(0.02); let P = 0; for (const p of W.parts) P += p.fx * p.vx + p.fy * p.vy + p.fz * p.vz; if (P < 0) for (const p of W.parts) { p.vx = 0; p.vy = 0; p.vz = 0; } }
  for (const p of W.parts) { p.vx = 0; p.vy = 0; p.vz = 0; }
  globalThis.AF_NOEV = false; return X.totalEnergy().pe;
}
function bind(X, b, n, geo) { const W = X.W, Ed = quench(X, n), g = geo ? geo() : null; for (const p of b) p.y += 14; X.gridTouch(); W.dirty++; const E = quench(X, 1500) - Ed; return geo ? [E, g] : E; } // (binding energy: the complex (its shape by geo), then B moved 14 Å away, inside the 40 Å box)
function waterDimer(kinds, A = 'H2O', B = 'H2O') {
  const X = box3(5); for (const k of kinds) X.sitesSet(k, 1);
  const a = X.addMolecule(A, 0, 0, 0, 0, 0), b = X.addMolecule(B, 2.9, 0.5, 6.3, 0, 0.4);
  const hv = (m) => m.find(p => p.Z > 1);
  const [E, g] = bind(X, b, 3000, () => {
  let best = null; for (const [D, Ac] of [[a, b], [b, a]]) for (const h of D.filter(p => p.Z === 1)) { const r = nrm(v3(h, hv(Ac))); if (!best || r < best.r) best = { r, h, D, Ac }; }
  const OD = hv(best.D), OA = hv(best.Ac), bis = [0, 0, 0]; for (const h of best.Ac.filter(p => p.Z === 1)) { const u = v3(OA, h), l = nrm(u); for (let k = 0; k < 3; k++) bis[k] += u[k] / l; }
  return { R: +nrm(v3(OD, OA)).toFixed(3), lin: +ang(v3(best.h, OD), v3(best.h, OA)).toFixed(1), tilt: +(180 - ang(bis, v3(OA, OD))).toFixed(1) };
  });
  return { E: +E.toFixed(3), ...g };
}

/* ---- 1. forces against the energy's slope (x, y and z) for the sites' term alone, every kind of site together */
PARTS.slope = async (page, check, say) => {
  const res = {};
  for (const d3 of [true, false]) {
    const X = load('all', { seed: 3 }), W = X.W;
    if (d3) X.PRESETS.d3empty.build(); else X.PRESETS.empty.build();
    W.gamma = 0;
    const mols = d3 ? [['H2O', -2, 0, 0], ['H2O', 1, 0.5, 0.3], ['NH3', 0, 3, 1], ['CH3Cl', 3, -2, -1], ['benzene', -3, -3, 3], ['benzene', -3, -3.5, 6.8], ['CH3OH', 4, 3, 3], ['Br2', 0, -4, -3], ['methylamine', 4, -4, 2]]
      : [['H2O', -2, 0], ['H2O', 1, 0.5], ['CH3Cl', 3, -2], ['Br2', 0, -5], ['CH3Cl', 6, -2]];
    for (const [k, x, y, z] of mols) X.addMolecule(k, x * 1.3, y * 1.3, 0.7 * x, 0, (z || 0) * 1.3);
    for (const p of W.parts) { p.vx = p.vy = p.vz = 0; }
    X.sitesSet(1); X.forcesNoEvents();
    const n = X.S.size, FX = new Float64Array(n), FY = new Float64Array(n), FZ = new Float64Array(n);
    X.sitesForces(FX, FY, FZ);
    let worst = 0, fmax = 0; const h = 1e-5;
    for (const p of W.parts) for (const c of d3 ? ['x', 'y', 'z'] : ['x', 'y']) {
      const v = p[c]; p[c] = v + h; X.gridTouch(); const ep = X.sitesTotal(); p[c] = v - h; X.gridTouch(); const em = X.sitesTotal(); p[c] = v; X.gridTouch();
      const f = (c === 'x' ? FX : c === 'y' ? FY : FZ)[p.i]; worst = Math.max(worst, Math.abs(-(ep - em) / (2 * h) - f)); fmax = Math.max(fmax, Math.abs(f));
    }
    res[d3 ? 'd3' : 'd2'] = { sites: X.SITES.n, rings: X.SITES.rings, worst: +worst.toExponential(1), fmax: +fmax.toFixed(2) };
  }
  check(res.d3.worst < 1e-6 && res.d2.worst < 1e-6 && res.d3.sites >= 19 && res.d3.rings >= 24 && res.d3.fmax > 0.1,
    `1.26: directional forces' sites: their forces are the energy's slopes in x, y and z to ${res.d3.worst} eV/Å (3-D: ${res.d3.sites} site atoms, ${res.d3.rings} ring atoms, forces up to ${res.d3.fmax} eV/Å) and ${res.d2.worst} in the flat game (σ-holes)`,
    '1.26 slope: ' + JSON.stringify(res));
};

/* ---- 2. lone pairs: the water dimer's acceptor turns its lone pair to the donor (measured tilt ~57°); ammonia's dimer */
PARTS.water = async (page, check, say) => {
  const off = waterDimer([]), on = waterDimer(['lp']), nh3 = waterDimer(['lp'], 'NH3', 'NH3'), nh3off = waterDimer([], 'NH3', 'NH3');
  say('  1.26 lone pairs: ' + JSON.stringify({ off, on, nh3, nh3off }));
  check(off.tilt < 25 && on.tilt > 35 && on.tilt < 60 && on.lin > 165 && on.R > 2.7 && on.R < 2.85 && on.E > 0.3 && on.E < 0.5 && nh3.E > 0.1 && nh3.E < 0.17 && nh3off.E < 0.09,
    `1.26: lone pairs: the water dimer's acceptor tilts ${on.tilt}° (point charges ${off.tilt}°; measured ~57°, TIP5P 51°), O–O ${on.R} Å (${off.R}; measured 2.91), O–H···O ${on.lin}°, ${on.E} eV (${off.E}; measured 0.217, TIP5P 0.294: a liquid-tuned pair potential binds the pair harder); ammonia's dimer ${nh3.E} eV (${nh3off.E}; CCSD(T) ~0.137)`,
    '1.26 water: ' + JSON.stringify({ off, on, nh3, nh3off }));
};

/* ---- 3. σ-holes: CH₃Br···NH₃ binds straight along the C–Br axis */
PARTS.sigma = async (page, check, say) => {
  const run = (on) => {
    const X = box3(5); if (on) X.sitesSet('sh', 1);
    const C = X.addAtom('C', 0, 0, { z: 0, T: 0 }), Br = X.addAtom('Br', 1.94, 0, { z: 0, T: 0 }); X.addBond(C, Br, 1);
    for (let k = 0; k < 3; k++) { const t = 2 * Math.PI * k / 3, h = X.addAtom('H', -0.364, 1.028 * Math.cos(t), { z: 1.028 * Math.sin(t), T: 0 }); X.addBond(C, h, 1); }
    X.relax3([C, Br, ...C.bonds.map(b => b.b === C ? b.a : b.b)], 400);
    const b = X.addMolecule('NH3', 5.3, 0.3, 0.4, 0, -0.2), N = b.find(p => p.Z === 7);
    const [E, g] = bind(X, b, 4000, () => ({ BrN: +nrm(v3(Br, N)).toFixed(2), CBrN: +ang(v3(Br, C), v3(Br, N)).toFixed(1) }));
    return { E: +E.toFixed(3), ...g };
  };
  const off = run(false), on = run(true);
  say('  1.26 σ-holes: ' + JSON.stringify({ off, on }));
  check(on.CBrN > 175 && on.BrN < 3.4 && on.E > 0.06 && on.E < 0.11 && off.BrN > 3.8,
    `1.26: σ-holes: CH₃Br···NH₃ binds on the bromine's tip, C–Br···N ${on.CBrN}°, Br···N ${on.BrN} Å, ${on.E} eV (without: the ammonia ${off.BrN} Å off, ${off.E} eV; reference about 0.07–0.09 eV at ~3.1–3.2 Å, from memory)`,
    '1.26 sigma: ' + JSON.stringify({ off, on }));
};

/* ---- 4. π-stacking: the benzene dimer's three shapes (rigid monomers) against CCSD(T) (kcal/mol: sandwich ~−1.7 to
   −1.8 at 3.9 Å, T-shaped ~−2.6 to −2.8 at ~5.0, parallel-displaced ~−2.6 to −2.8) */
PARTS.stack = async (page, check, say) => {
  const run = (on) => {
    const X = box3(5), W = X.W; if (on) X.sitesSet('pi', 1);
    const A = X.addMolecule('benzene', 0, 0, 0, 0, 0), B = X.addMolecule('benzene', 12, 0, 0, 0, 0); quench(X, 1200);
    const frame = (M) => {
      const C = M.filter(p => p.Z === 6); let c = [0, 0, 0]; for (const p of M) { c[0] += p.x / M.length; c[1] += p.y / M.length; c[2] += p.z / M.length; }
      const r = (p) => [p.x - c[0], p.y - c[1], p.z - c[2]], c0 = r(C[0]), c1 = r(C[1]);
      let n = [c0[1] * c1[2] - c0[2] * c1[1], c0[2] * c1[0] - c0[0] * c1[2], c0[0] * c1[1] - c0[1] * c1[0]]; const nl = nrm(n); n = n.map(x => x / nl);
      const ex = c0.map(x => x / nrm(c0)), ey = [n[1] * ex[2] - n[2] * ex[1], n[2] * ex[0] - n[0] * ex[2], n[0] * ex[1] - n[1] * ex[0]];
      return M.map(p => { const u = r(p); return [dot(u, ex), dot(u, ey), dot(u, n)]; });
    };
    const fa = frame(A), fb = frame(B), put = (M, f, T) => M.forEach((p, k) => { const [x, y, z] = T(f[k]); p.x = x; p.y = y; p.z = z; });
    const pe = () => { X.gridTouch(); W.dirty++; return X.totalEnergy().pe; };
    put(A, fa, (u) => u); put(B, fb, (u) => [u[0] + 15, u[1], u[2]]); const E0 = pe();
    const best = (T, list) => { let b = null; for (const R of list) { put(B, fb, (u) => T(u, R)); const E = (pe() - E0) * 23.061; if (!b || E < b.E) b = { R, E: +E.toFixed(2) }; } return b; };
    const rs = (a, b, h) => { const o = []; for (let r = a; r <= b + 1e-9; r += h) o.push(+r.toFixed(2)); return o; };
    const S = best((u, R) => [u[0], u[1], u[2] + R], rs(3.3, 4.5, 0.1)), T = best((u, R) => [u[2], u[1], -u[0] + R], rs(4.4, 5.8, 0.1));
    let PD = null; for (const R1 of rs(3.3, 3.9, 0.1)) { const b = best((u, R) => [u[0] + R, u[1], u[2] + R1], rs(1.0, 3.0, 0.2)); if (!PD || b.E < PD.E) PD = { R1, R2: b.R, E: b.E }; }
    return { S, T, PD };
  };
  const off = run(false), on = run(true);
  say('  1.26 π-stacking: ' + JSON.stringify({ off, on }));
  check(off.S.E < -6 && on.S.E > -2.4 && on.S.E < -1.5 && on.T.E > -3.2 && on.T.E < -2.4 && on.PD.E > -3.2 && on.PD.E < -2.4 && on.PD.E < on.S.E - 0.4 && on.T.E < on.S.E - 0.4,
    `1.26: π-stacking: the benzene dimer (kcal/mol) sandwich ${on.S.E} at ${on.S.R} Å, T-shaped ${on.T.E} at ${on.T.R}, parallel-displaced ${on.PD.E} at ${on.PD.R1} / ${on.PD.R2} Å (CCSD(T) ~−1.7 to −1.8 at 3.9, −2.6 to −2.8 at ~5.0, −2.6 to −2.8 at ~3.5–3.6 / 1.6–1.8); without: ${off.S.E}, ${off.T.E}, ${off.PD.E} (the doubled general dispersion)`,
    '1.26 stack: ' + JSON.stringify({ off, on }));
};

/* ---- 5. the books: an insulated 3-D box with every kind of site, and the switch booked to the heat bath */
PARTS.books = async (page, check, say) => {
  const run = (on) => {
    const X = load('all', { seed: 4 }), W = X.W; X.PRESETS.d3empty.build();
    const keys = ['H2O', 'H2O', 'NH3', 'CH3OH', 'CH3Cl', 'benzene', 'benzene', 'methylamine', 'H2O', 'Br2', 'H2O', 'phenol'];
    keys.forEach((k, n) => X.addMolecule(k, -8 + (n % 3) * 7, -8 + (Math.floor(n / 3) % 3) * 7, X.rnd() * 6, 300, n < 9 ? -4 : 4));
    for (let i = 0; i < 300; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
    const b0 = W.ledger.bath, e0 = X.totalEnergy().total; if (on) X.sitesSet(1); const e1 = X.totalEnergy().total, booked = W.ledger.bath - b0;
    W.gamma = 0; X.forcesNoEvents(); const E0 = X.totalEnergy().total, t0 = W.t;
    for (let i = 0; i < 1500; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
    return { sw: +(e1 - e0 + booked).toFixed(9), booked: +booked.toFixed(4), drift: +(X.totalEnergy().total - E0).toFixed(4), ps: +((W.t - t0) * X.PHYS.TU_S * 1e12).toFixed(3), sites: X.SITES.n, rings: X.SITES.rings };
  };
  const off = run(false), on = run(true);
  say('  1.26 books: ' + JSON.stringify({ off, on }));
  check(Math.abs(on.sw) < 1e-9 && Math.abs(on.booked) > 1e-4 && Math.abs(on.drift - off.drift) < 0.015 && on.sites > 10,
    `1.26: directional forces keep the books: switched on with 12 molecules in the 3-D box, ${on.booked} eV to the heat bath (the books' change ${on.sw}); insulated over ${on.ps} ps ${on.drift} eV with every kind of site (${on.sites} site atoms, ${on.rings} ring atoms), ${off.drift} without (the cutoff's own small jumps, the same at half the step)`,
    '1.26 books: ' + JSON.stringify({ off, on }));
};

/* ---- 6. Settings: the three rows, normal at start, 3-D only for lone pairs and π-stacking, switching the model */
PARTS.settings = async (page, check, say) => {
  const r = await page.evaluate(async () => {
    const out = { start: [SET.lps, SET.sigh, SET.pis, SITES.any], d3: !!W.d3 };
    openSettings('exp'); await new Promise(res => setTimeout(res, 60));
    out.rows = ['segLps', 'segSigh', 'segPis'].map(id => !!$(id) && !!$(id).offsetParent);
    out.only = ['segLps', 'segSigh', 'segPis'].map(id => setRowOnly($(id).closest('.srow')));
    out.desc = ['segLps', 'segSigh', 'segPis'].map(id => !!SDESC[id] && !!SDESC3[id]);
    $('segSigh').querySelector('[data-v="1"]').click(); out.on = [SET.sigh, SITES.sh, SITES.any]; out.total = $('expTotal').textContent.includes('σ-holes');
    $('segSigh').querySelector('[data-v="0"]').click(); out.off = [SET.sigh, SITES.sh, SITES.any];
    hideModal('setModal'); return out;
  });
  say('  1.26 settings: ' + JSON.stringify(r));
  check(r.start.join() === '0,0,0,false' && r.rows.join() === [r.d3, true, r.d3].join() && r.only.join() === '3d,,3d' && r.desc.every(Boolean) && r.on.join() === '1,1,true' && r.total && r.off.join() === '0,0,false',
    '1.26: Settings → Experimental → Directional forces: lone pairs, σ-holes and π-stacking, off at start, lone pairs and π-stacking marked 3-D only (shown in the 3-D lab only, 1.27.1), each described in both modes; σ-holes switch the model on and off and join the Experimental total',
    '1.26 settings: ' + JSON.stringify(r));
};

module.exports = async function f126d(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.26 (directional) ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  const parts = process.argv.slice(2), needPage = !parts.length || parts.includes('settings');
  let browser = null, page = null, errors = [], openPage = null;
  if (needPage) { ({ openPage } = require('./browser')); ({ browser, page, errors } = await openPage({ settle: 800 })); }
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(page, check, say, openPage, parts);
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  if (browser) await browser.close();
  console.log(fails ? `${fails} failure(s)` : '1.26 (directional) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
