'use strict';
/* The checks for 1.27's feature 22, Rayleigh scattering (Settings → Experimental → Realistic particles → Rayleigh
   scattering; RP.ray; src/pold.js ryTry, ryScatter; PERF-NOTES "1.27: feature 22"), run by t_features (one line) or
   alone: node tests/f_127r.js [--node] [part …]   (parts: rate, angle, light, ultra, fp, settings). Every part but fp
   fails on v150 (none of it is there); fp shows setups unchanged with the switch off. (page: the t_features page;
   check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const box = (d3, seed = 4) => { const X = load('all', { seed }), W = X.W; if (d3) { X.PRESETS.d3empty.build(); X.world3d(40); } else X.PRESETS.empty.build(); W.gamma = 0; W.T = 0; X.RP.ray = true; return X; };
/* the mean chance over random polarizations, a photon along x */
const chance = (X, p, nm, n = 4000) => { const D = [0, 0, 0, 0, 0, 0]; let s = 0; for (let k = 0; k < n; k++) { const e = X.polRand(1, 0, 0); s += X.ryChance(p, X.PHYS.HC / nm, e[0], e[1], e[2], D); } return s / n; };

/* ---- 1. the rate: as λ⁻⁴ and as the square of the polarizability */
PARTS.rate = async (page, check, say) => {
  const r = {};
  for (const d3 of [true, false]) {
    const X = box(d3), W = X.W, n2 = X.addMolecule('N2', 0, 0, 0, 0, 0)[0], h2o = X.addMolecule('H2O', 5, 5, 0, 0, 0)[0], ar = X.addAtom('Ar', 10, 10, d3 ? { z: 0, T: 0 } : { T: 0 });
    const p = W.parts.find(q => q.Z === 18);
    r[d3 ? 'd3' : 'flat'] = { blueRed: +(chance(X, n2, 400) / chance(X, n2, 700)).toFixed(2), n2: +chance(X, n2, 450).toFixed(4), ar: +chance(X, p, 450).toFixed(4), waterOverN2: +(chance(X, h2o, 450) / chance(X, n2, 450)).toFixed(3) };
    void ar;
  }
  // isotropic molecules: the chance is exactly as the square of the polarizability (argon 1.64 against water 1.47)
  const X = box(true), h = X.addMolecule('H2O', 0, 0, 0, 0, 0)[0], a = (X.addAtom('Ar', 8, 0, { z: 0, T: 0 }), X.W.parts.find(q => q.Z === 18)), D = [0, 0, 0, 0, 0, 0];
  const exact = X.ryChance(a, 2.5, 0, 1, 0, D) / X.ryChance(h, 2.5, 0, 1, 0, D), want = (1.64 / 1.47) ** 2;
  say('  1.27 (22) rate: ' + JSON.stringify({ r, exact, want }));
  check(Math.abs(r.d3.blueRed - 9.38) < 0.4 && Math.abs(r.flat.blueRed - 9.38) < 0.4 && Math.abs(r.d3.n2 - 0.01) < 0.001 && Math.abs(exact - want) < 1e-9,
    `1.27 (22): Rayleigh scattering's rate goes as λ⁻⁴: blue (400 nm) ${r.d3.blueRed} times red (700 nm) in 3-D, ${r.flat.blueRed} flat (true 9.38); as the square of the polarizability: argon against water ${exact.toFixed(4)} (${want.toFixed(4)}); ${r.d3.n2} a nitrogen molecule passed at 450 nm`,
    '1.27 (22) rate: ' + JSON.stringify({ r, exact, want }));
};

/* ---- 2. the angles and the polarization: (1 + cos²θ) for unpolarized light, polarized at 90° (3-D), the flat game's
   plane, and CO₂'s depolarization */
PARTS.angle = async (page, check, say) => {
  const res = {};
  for (const d3 of [true, false]) {
    const X = box(d3), W = X.W; X.RP.pol = true;
    const w = X.addMolecule('H2O', 0, 0, 0, 0, 0)[0], D = [0, 0, 0, 0, 0, 0];
    let c2 = 0, wsum = 0, p90 = 0, n90 = 0;
    for (let k = 0; k < 30000; k++) {
      const e = X.polRand(1, 0, 0), P = X.ryChance(w, 2.5, e[0], e[1], e[2], D);
      X.ryScatter(w, 2.5, D[3], D[4], D[5], 9); const ray = W.rays[W.rays.length - 1];
      const ux = ray.x1 - ray.x0, uy = ray.y1 - ray.y0, uz = d3 ? ray.z1 - ray.z0 : 0, L = Math.hypot(ux, uy, uz), c = ux / L;
      c2 += P * c * c; wsum += P; // (weighted by its chance: what a photon stream does)
      if (Math.abs(c) < 0.1) { const ax = d3 ? [0, -uz / L, uy / L] : [0, 0, 1], an = Math.hypot(...ax), dp = (ray.pol[0] * ax[0] + ray.pol[1] * ax[1] + ray.pol[2] * ax[2]) / an; p90 += P * dp * dp; n90 += P; }
      if (W.rays.length > 300) W.rays.length = 0;
    }
    res[d3 ? 'd3' : 'flat'] = { cos2: +(c2 / wsum).toFixed(3), pol90: +(p90 / n90).toFixed(3) };
  }
  // CO₂ end-on and side-on in 3-D: light scattered at 90° keeps a little of the other polarization (depolarization)
  const X = box(true), co2 = X.addMolecule('CO2', 0, 0, 0, 0, 0), C = co2.find(p => p.Z === 6), O = co2.find(p => p.Z === 8), D = [0, 0, 0, 0, 0, 0];
  const ax = [O.x - C.x, O.y - C.y, O.z - C.z], L = Math.hypot(...ax), u = ax.map(v => v / L);
  X.ryChance(C, 2.5, u[0], u[1], u[2], D); const along = Math.hypot(D[3], D[4], D[5]);
  const t = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], q = [u[1] * t[2] - u[2] * t[1], u[2] * t[0] - u[0] * t[2], u[0] * t[1] - u[1] * t[0]], ql = Math.hypot(...q);
  X.ryChance(C, 2.5, q[0] / ql, q[1] / ql, q[2] / ql, D); const across = Math.hypot(D[3], D[4], D[5]);
  res.co2 = { along: +along.toFixed(2), across: +across.toFixed(2) };
  say('  1.27 (22) angles: ' + JSON.stringify(res));
  check(Math.abs(res.d3.cos2 - 0.4) < 0.01 && res.d3.pol90 > 0.98 && Math.abs(res.flat.cos2 - 0.583) < 0.015 && res.flat.pol90 > 0.98 && Math.abs(res.co2.along - 3.96) < 0.02 && Math.abs(res.co2.across - 1.96) < 0.02,
    `1.27 (22): unpolarized light on water goes out as 1 + cos²θ (⟨cos²θ⟩ ${res.d3.cos2}, the law's 0.400), at 90° ${(res.d3.pol90 * 100).toFixed(1)}% polarized; in the flat game's plane ⟨cos²θ⟩ ${res.flat.cos2} (0.583), ${(res.flat.pol90 * 100).toFixed(1)}% polarized at 90°; CO₂'s dipole ${res.co2.along} along its axis and ${res.co2.across} across (its tensor)`,
    '1.27 (22) angle: ' + JSON.stringify(res));
};

/* ---- 3. light shone through liquid water: blue scattered more than red, the energy all leaves, the books exact */
PARTS.light = async (page, check, say) => {
  const res = {};
  for (const key of ['water', 'water3d']) for (const nm of [400, 700]) {
    const X = load('all', { seed: 9 }), W = X.W; X.PRESETS[key].build(); X.settleOverlaps(); W.gamma = 0; W.sources.length = 0; X.forcesNoEvents(); X.RP.ray = true; X.RY.n = 0;
    const E = X.PHYS.HC / nm, books = () => X.totalEnergy().total - W.ledger.nuc - W.ledger.escaped, B0 = books(), esc0 = W.ledger.escaped, n = 600, hw = W.box.w / 2, hh = W.box.h / 2;
    for (let k = 0; k < n; k++) { const y = (X.rnd() - 0.5) * 1.6 * hh, z = W.d3 ? (X.rnd() - 0.5) * 1.6 * (W.box.d / 2) : 0; X.emitPhoton(-hw + 0.1, y, E, 1, 0, W.d3 ? { z, uz: 0 } : {}); if (W.rays.length > 300) W.rays.length = 0; }
    res[key + nm] = { scattered: X.RY.n, out: +((W.ledger.escaped - esc0) / (n * E)).toFixed(6), books: Math.abs(books() - B0) };
  }
  say('  1.27 (22) light: ' + JSON.stringify(res));
  check(res.water400.scattered > 4 * Math.max(1, res.water700.scattered) && res.water400.scattered >= 20 && res.water3d400.scattered >= 5 && Object.values(res).every(r => Math.abs(r.out - 1) < 1e-9 && r.books < 1e-9),
    `1.27 (22): 600 photons across liquid water: ${res.water400.scattered} blue (400 nm) and ${res.water700.scattered} red (700 nm) scattered in the flat game, ${res.water3d400.scattered} and ${res.water3d700.scattered} in the 3-D lab; every photon's energy leaves the box and the rest of the books do not move`,
    '1.27 (22) light: ' + JSON.stringify(res));
};

/* ---- 4. ultra-realistic: the true cross section (σ = (8π/3)k⁴α², 5×10⁻²⁷ cm² for N₂ at 532 nm) */
PARTS.ultra = async (page, check, say) => {
  const X = box(true), n2 = X.addMolecule('N2', 0, 0, 0, 0, 0)[0]; X.W.ultra = true;
  const P = chance(X, n2, 532), sigma = P * Math.PI * 0.36 * 1e-16; // (Å² → cm²)
  check(P > 1e-11 && P < 1e-9 && sigma > 3e-27 && sigma < 7e-27, `1.27 (22): with ultra-realistic mode, the true rate: ${P.toExponential(2)} a nitrogen molecule passed at 532 nm, a cross section of ${sigma.toExponential(2)} cm² (measured 5.1×10⁻²⁷)`, '1.27 (22) ultra: ' + JSON.stringify({ P, sigma }));
};

/* ---- 5. switch off: setups that make light as in v150, bit for bit (tools/fingerprint.js: seed 7, 300 steps) */
const FP = { prism: '4ffe98af books a9f2ee3a 0', flame: '35e1ec46 books 357b2f4f 48', neon: '8b728a7d books eca8b1e2 84', argon: '820e8897 books a9f2ee3a 80', water: 'cac1ac32 books a9f2ee3a 240' };
PARTS.fp = async (page, check, say) => {
  const out = require('child_process').execFileSync(process.execPath, [require('path').join(__dirname, '..', 'tools', 'fingerprint.js'), ...Object.keys(FP)], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const bad = [];
  for (const line of out.split('\n')) { const m = line.trim().split(/\s+/); if (m.length < 2 || !FP[m[0]]) continue; const got = m.slice(1).join(' '); if (got !== FP[m[0]]) bad.push(`${m[0]} ${got} (before ${FP[m[0]]})`); }
  check(!bad.length, `1.27 (22): switch off, setups with light as before (fingerprints of ${Object.keys(FP).join(', ')}; all 60 checked when it was built)`, '1.27 (22) fp: ' + JSON.stringify(bad));
};

/* ---- 6. Settings: the line in Realistic particles, after Photon polarization, off at start, its tag and pane */
PARTS.settings = async (page, check, say) => {
  const r = await page.evaluate(async () => {
    const o = { start: [SET.rpRay, RP.ray].join() };
    openSettings('exp'); await new Promise(res => setTimeout(res, 60));
    const ids = [...document.querySelectorAll('#setModal .rpl input')].map(e => e.id); o.after = ids.indexOf('setRpRay') === ids.indexOf('setRpPol') + 1;
    const line = $('setRpRay').closest('.rpl'); o.tag = !!line.querySelector('.cost-k'); o.h = Math.round(line.getBoundingClientRect().height);
    setPrevShow('setRpRay', null); o.pane = $('setPrevT').textContent; o.desc = !!SDESC.setRpRay && !!SDESC3.setRpRay;
    $('setRpRay').click(); o.on = [SET.rpRay, RP.ray].join(); o.saved = String(JSON.parse(store('settings')).rpRay); o.total = SET_EXP.includes('rpRay') && String(expSummary()).includes('Rayleigh');
    $('setRpRay').click(); o.off = [SET.rpRay, RP.ray].join();
    hideModal('setModal'); return o;
  });
  say('  1.27 (22) settings: ' + JSON.stringify(r));
  check(r.start === 'false,false' && r.after && r.tag && r.h < 34 && r.pane === 'Rayleigh scattering' && r.desc && r.on === 'true,true' && r.saved === 'true' && r.total && r.off === 'false,false',
    '1.27 (22): Settings → Experimental → Realistic particles → Rayleigh scattering: after Photon polarization, off at start, its cost tag, the side pane in both modes, saved, off again at each start, named in the Speed test\'s settings line',
    '1.27 (22) settings: ' + JSON.stringify(r));
};
PARTS.settings.page = true;

module.exports = async function f127r(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (1.27 (22) ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.27 (22) ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 feature 22 checks passed');
  process.exitCode = fails ? 1 : 0;
})();
