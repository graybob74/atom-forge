'use strict';
/* The 1.25 checks for bond orders for metals (Settings → Experimental → Metals → Many-body; src/bometal.js), run by
   t_features (its "1.25 (metals)" block) or alone: node tests/f_125m.js [part …] (parts: fit, forces, books, ions, page).
   Each part fails on 1.24.0 (no model). The physics parts run in the Node harness (deterministic); page in the t_features
   page. (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
let _X = null;
const harness = () => _X || (_X = load('all', { seed: 3 }));
/* a flat triangular patch (2-D) or an fcc ball (3-D) of sym at nearest-neighbour distance a, radius R, at rest */
function patch(X, sym, a, R, d3, jit = 0) { // (sym: a symbol, or a function of the atom's number)
  let nk = 0; const el = () => typeof sym === 'function' ? sym(nk++) : sym;
  X.baseWorld(R * 6, R * 6, 300, 0); X.W.gamma = 0;
  if (d3) X.world3d(R * 6);
  if (!d3) { const n = Math.ceil(R / a) + 1; for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) { const x = (i + 0.5 * (j & 1)) * a, y = j * a * Math.sqrt(3) / 2; if (x * x + y * y <= R * R) X.addAtom(el(), x + jit * (X.rnd() - 0.5), y + jit * (X.rnd() - 0.5)); } }
  else { const c = a * Math.SQRT2, B = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]], n = Math.ceil(R / c) + 1; for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) for (const b of B) { const x = (i + b[0]) * c, y = (j + b[1]) * c, z = (k + b[2]) * c; if (x * x + y * y + z * z <= R * R) X.addAtom(el(), x + jit * (X.rnd() - 0.5), y + jit * (X.rnd() - 0.5), { z: z + jit * (X.rnd() - 0.5) }); } }
  const P = X.W.parts.filter(p => !p.dead); for (const p of P) { p.vx = p.vy = p.vz = 0; }
  X.computeForces(); return P;
}
/* a periodic fcc crystal (n³ cells) at nearest-neighbour distance a, one atom left out when skip ≥ 0: its energy */
function fcc(X, sym, a, n, skip = -1) {
  const c = a * Math.SQRT2; X.baseWorld(n * c, n * c, 1, 0); X.W.gamma = 0; X.world3d(n * c); X.W.wall = 'wrap';
  const B = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]]; let k = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let l = 0; l < n; l++) for (const b of B) { if (k++ !== skip) X.addAtom(sym, (i + b[0] + 0.25) * c - n * c / 2, (j + b[1] + 0.25) * c - n * c / 2, { z: (l + b[2] + 0.25) * c - n * c / 2 }); }
  X.computeForces(); return X.totalEnergy().pe;
}
/* ---- 1. the fit: a perfect 3-D crystal has the measured values; the 2-D sheet and a dimer follow from the same formula */
PARTS.fit = async (page, check) => {
  const X = harness(); X.mbSet(1);
  const out = {};
  for (const [sym, Ec, r0, B, Ev] of [['Cu', 3.49, 2.56, 137.0, 1.28], ['Al', 3.39, 2.86, 72.2, 0.67], ['Au', 3.81, 2.88, 173.2, 0.93], ['Pt', 5.84, 2.77, 278.3, 1.35]]) { // (W and Na here until 1.26: bcc metals since, with angles of their own, fitted on bcc: f_126m bcc)
    const n = 3, N = 4 * n * n * n, E = (a) => fcc(X, sym, a, n) / N, e0 = E(r0), h = 0.002 * r0, h1 = 1e-5 * r0;
    const Bm = (E(r0 + h) - 2 * e0 + E(r0 - h)) / (h * h) * r0 * r0 / (9 * r0 ** 3 / Math.SQRT2) * 160.2177, slope = (E(r0 + h1) - E(r0 - h1)) / (2 * h1);
    const ev = fcc(X, sym, r0, n, 5) - (N - 1) * e0; // (unrelaxed)
    out[sym] = { Ec: +(-e0).toFixed(4), slope: +slope.toExponential(1), B: +Bm.toFixed(1), Ev: +ev.toFixed(3) };
    out[sym].ok = Math.abs(-e0 - Ec) < 0.002 && Math.abs(slope) < 1e-6 && Math.abs(Bm / B - 1) < 0.01 && Math.abs(ev - Ev) < 0.01;
  }
  // the many-body signature: a lone pair (dimer) holds more per bond than a bond in the crystal; a pair model gives the same
  const p = X.mbParam(29); let best = 0;
  X.baseWorld(30, 30, 1, 0); X.W.gamma = 0; X.world3d(30); const a = X.addAtom('Cu', 0, 0, { z: 0 }), b = X.addAtom('Cu', 2.2, 0, { z: 0 });
  for (let r = 1.9; r < 2.6; r += 0.005) { b.x = r; X.gridTouch(); X.computeForces(); best = Math.min(best, X.totalEnergy().pe); }
  out.dimer = +(-best).toFixed(3); out.bondCrystal = +(3.49 / 6).toFixed(3);
  X.mbSet(0);
  check(['Cu', 'Al', 'Au', 'Pt'].every(s => out[s].ok) && out.dimer > 2 * out.bondCrystal && p.p > 9 && p.p < 12 && p.q > 2 && p.q < 3,
    `1.25 metals: a perfect fcc crystal has each metal's measured values (Cu Ec ${out.Cu.Ec} eV, B ${out.Cu.B} GPa, vacancy ${out.Cu.Ev} eV; Al ${out.Al.Ec}/${out.Al.B}/${out.Al.Ev}; Au ${out.Au.Ec}/${out.Au.B}/${out.Au.Ev}; Pt ${out.Pt.Ec}/${out.Pt.B}/${out.Pt.Ev}), no force at the measured spacing; Cu's p ${p.p.toFixed(2)}, q ${p.q.toFixed(2)} (Cleri and Rosato's published fit: 10.96, 2.28); a Cu dimer holds ${out.dimer} eV, against ${out.bondCrystal} a bond in the crystal`,
    '1.25 metals fit: ' + JSON.stringify(out) + ' p ' + p.p + ' q ' + p.q);
};
/* ---- 2. forces are the energy's slopes (2-D patch, 3-D ball, an alloy), and an insulated hot patch keeps its energy */
PARTS.forces = async (page, check) => {
  const X = harness(); X.mbSet(1);
  const out = {};
  for (const [name, d3, syms] of [['2-D Cu', false, ['Cu']], ['3-D Cu', true, ['Cu']], ['2-D Cu–Ag–Au', false, ['Cu', 'Ag', 'Au']]]) {
    const P = patch(X, (k) => syms[k % syms.length], 2.45, 9, d3, 0.3);
    let worst = 0;
    for (const q of P.slice(0, 10)) for (const c of d3 ? ['x', 'y', 'z'] : ['x', 'y']) {
      const h = 1e-5, x0 = q[c]; q[c] = x0 + h; X.gridTouch(); const ep = X.totalEnergy().pe; q[c] = x0 - h; X.gridTouch(); const em = X.totalEnergy().pe; q[c] = x0; X.gridTouch();
      worst = Math.max(worst, Math.abs(-(ep - em) / (2 * h) - q['f' + c]));
    }
    X.computeForces(); out[name] = +worst.toExponential(1);
  }
  // insulated: a 2-D Cu patch at 1,500 K, 3,000 steps at the game's longest step
  const P = patch(X, 'Cu', 2.45, 9, false, 0);
  for (const q of P) { const v = X.thermalV(q.m, 1500); q.vx = v[0]; q.vy = v[1]; }
  X.computeForces(); const E0 = X.totalEnergy().total;
  for (let s = 0; s < 3000; s++) X.step(0.04);
  out.drift = +(X.totalEnergy().total - E0).toFixed(5); out.n = P.length; out.ions = P.filter(q => q.q).length;
  X.mbSet(0);
  check(Object.values(out).slice(0, 3).every(w => w < 1e-6) && Math.abs(out.drift) < 0.01 && out.ions === 0,
    `1.25 metals: forces are the energy's slopes (worst ${out['2-D Cu']} eV/Å flat, ${out['3-D Cu']} in 3-D, ${out['2-D Cu–Ag–Au']} in a Cu–Ag–Au alloy); ${out.n} Cu atoms at 1,500 K insulated, 3,000 steps of 0.4 fs: ${out.drift} eV, no ions made`,
    '1.25 metals forces: ' + JSON.stringify(out));
};
/* ---- 3. energy books: localPE's many-body part is exact for any change to its set (a move, an atom made an ion, one
   killed), and switching the model books the change at the same positions to the bath */
PARTS.books = async (page, check) => {
  const X = harness(); X.mbSet(1);
  const P = patch(X, 'Cu', 2.45, 9, false, 0.2), out = {};
  const tot = () => { X.gridTouch(); const e = X.totalEnergy(); return e.pe + e.internal; };
  const p = P[7], s = new Set([p]);
  let l0 = X.localPE(s), e0 = tot(); p.x += 0.6; p.y -= 0.3; X.gridTouch(); out.move = Math.abs((X.localPE(s) - l0) - (tot() - e0));
  l0 = X.localPE(s) + X.internalE(p); e0 = tot(); p.ne--; X.refresh(p); X.gridTouch(); out.ion = Math.abs((X.localPE(s) + X.internalE(p) - l0) - (tot() - e0)); out.ionMember = X.mbIs(p.i);
  const o = P[20], so = new Set([o]); l0 = X.mbLocal(so); e0 = X.mbPass(false); X.kill(o); X.gridTouch(); out.kill = Math.abs((X.mbLocal(so) - l0) - (X.mbPass(false) - e0)); // (regionE's many-body part, for an atom removed: against the whole; regionE's rest energy, 6e10 eV, is beyond a double's last digits)
  // switching: total + bath unchanged, and the metal's mD back to the pair model's
  X.computeForces(); const b0 = X.W.ledger.bath, t0 = X.totalEnergy().total; X.mbSet(0); X.computeForces();
  out.sw = Math.abs(X.totalEnergy().total + X.W.ledger.bath - b0 - t0); out.mD = P[3].mD > 0; out.bath = +(X.W.ledger.bath - b0).toFixed(3);
  X.mbSet(1); X.computeForces(); out.sw2 = Math.abs(X.totalEnergy().total + X.W.ledger.bath - b0 - t0); out.mD0 = P[3].mD === 0;
  X.mbSet(0);
  check(out.move < 1e-9 && out.ion < 1e-9 && out.kill < 1e-9 && !out.ionMember && out.sw < 1e-6 && out.sw2 < 1e-6 && out.mD && out.mD0,
    `1.25 metals: the event books' many-body part is exact (an atom moved ${out.move.toExponential(0)}, made an ion ${out.ion.toExponential(0)}, removed ${out.kill.toExponential(0)} eV off the total's change; the ion leaves the metal); switching the model off and on books ${out.bath} eV to the bath, total plus bath kept to ${Math.max(out.sw, out.sw2).toExponential(0)} eV`,
    '1.25 metals books: ' + JSON.stringify(out));
};
/* ---- 4. ions are not members: a Cu⁺Cu⁻ pair would hold both the metal's bonding and the charges' pull (a first build
   turned a hot flat patch into ions and heated it to 6,000 K); Na + Cl₂ still makes salt */
PARTS.ions = async (page, check) => {
  const X = harness(); X.mbSet(1);
  const P = patch(X, 'Cu', X.mbParam(29).r0, 12, false, 0); X.W.T = 900; X.W.gamma = 0.05;
  for (const q of P) { const v = X.thermalV(q.m, 900); q.vx = v[0]; q.vy = v[1]; }
  X.computeForces(); for (let s = 0; s < 2500; s++) X.step(0.04);
  let ke = 0; for (const q of P) ke += 0.5 * q.m * (q.vx ** 2 + q.vy ** 2);
  const out = { ions: P.filter(q => q.q).length, T: Math.round(ke / P.length / X.PHYS.KB) };
  X.mbSet(0);
  check(out.ions === 0 && out.T < 1300,
    `1.25 metals: a flat Cu patch at 900 K keeps neutral (${out.ions} ions, ${out.T} K after 1 ps): an ion is not a member of the metal`, '1.25 metals ions: ' + JSON.stringify(out));
};
/* ---- 5. the page: the setting in Experimental with its cost and realistic tags, off at start, on in the flat game and
   in 3-D (Fe atoms lose their pair depth), the Help line */
PARTS.page = async (page, check) => {
  const r = await page.evaluate(() => {
    const out = { def: SET_DEF.metal, set: SET.metal, row: !!$('segMetal'), btns: $('segMetal') ? $('segMetal').querySelectorAll('button').length : 0 };
    syncCosts(); const b1 = $('segMetal') && $('segMetal').querySelector('button[data-v="1"]');
    out.cost = b1 ? (b1.querySelector('.oc') || {}).textContent : ''; out.real = b1 ? (b1.querySelector('.rl') || {}).textContent : '';
    out.help = /Many-body/.test(document.body.innerHTML.match(/<li><b>Metallic bonding<\/b>[^]*?<\/li>/)[0]);
    loadPreset('magnet'); setRunning(false); const fe = () => W.parts.find(p => p.Z === 26 && !p.dead);
    out.mD0 = fe() ? fe().mD : -1;
    setSetting('metal', 1); out.mD1 = fe() ? fe().mD : -1; for (let f = 0; f < 10; f++) { W.dt = chooseDt(); step(W.dt); } out.n = MBO.n;
    out.sum = expSummary();
    loadPreset('mol3d'); out.d3 = W.d3; addAtom('Cu', 0, 0, { z: 0 }); addAtom('Cu', 2.3, 0, { z: 0 }); computeForces(); out.n3 = MBO.n;
    setSetting('metal', 0); loadPreset('empty');
    return out;
  });
  check(r.def === 0 && r.set === 0 && r.row && r.btns === 2 && /×/.test(r.cost) && /realistic/.test(r.real) && r.help && r.mD0 > 0 && r.mD1 === 0 && r.n > 0 && /many-body metals/.test(r.sum) && r.d3 && r.n3 === 2,
    `1.25 metals: Settings → Experimental → Metals (off at start; Many-body tagged ${r.cost}, realistic); on, the magnet setup's Fe atoms are many-body members (${r.n}), in 3-D too; the Speed test's line says so; Help explains it`, '1.25 metals page: ' + JSON.stringify(r));
};

module.exports = async function f125m(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (k === 'page' && !page) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.25 metals ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.25 metals checks passed');
  process.exitCode = fails ? 1 : 0;
})();
