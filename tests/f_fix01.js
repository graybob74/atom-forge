'use strict';
/* The check for 1.27 bug 1 (PERF-NOTES, "1.27: bug 1 (3-D van der Waals)"), run by t_features (one line) or alone:
   node tests/f_fix01.js [--node] [part …]. The flat game doubles the Coulomb pull between a free ion and a polar
   molecule's partial charges (K_IW 2: an ion has half its neighbours in a plane); it was on in 3-D too, where an ion has
   its real shell. Now factor 1 in 3-D (the owner chose the ion–water pull alone; the van der Waals wells, LJ_SCALE 2,
   stay doubled: UFF's own noble-gas wells are shallower than measured). "pull" and "shell" fail on v145; "forces" guards the
   kernels' agreement (it failed on this branch until the WebAssembly kernel was rebuilt). No part needs the page.
   (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const go = (X, n) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };

/* A Na⁺ 2.4 Å from a water's oxygen: its Coulomb energy with the O is the plain one in 3-D, doubled in the flat game
   (v145: doubled in both, ratio 1). And the forces agree with the energy in 3-D, with the WebAssembly kernel and the
   JavaScript one (v145's kernels doubled the force with the energy; a kernel left at 2 would show here). */
function naWater(opts, d3) {
  const X = load('all', Object.assign({ seed: 1 }, opts)), W = X.W;
  X.baseWorld(30, 30, 0, 0); if (d3) X.world3d(30);
  X.addMolecule('H2O', 0, 0, 0, 0, 0);
  const na = X.addAtom('Na', 2.4, 0.3, { charge: 1, z: d3 ? 0.4 : 0, T: 0 });
  for (const p of W.parts) { p.vx = p.vy = p.vz = 0; }
  return { X, W, na, o: W.parts.find(p => p.Z === 8) };
}
PARTS.pull = async (page, check, say) => {
  const e = {};
  for (const d3 of [false, true]) { const { X, na, o } = naWater({}, d3); const r2 = (na.x - o.x) ** 2 + (na.y - o.y) ** 2 + ((na.z || 0) - (o.z || 0)) ** 2; e[d3 ? 'd3' : 'flat'] = X.coulAA(na, o, r2) / (X.PHYS.KE * (na.q + na.qp) * (o.q + o.qp) * (1 / Math.sqrt(r2 + 0.09) - X.csh(na, o, 0.09))); }
  check(e.flat === 2 && e.d3 === 1, `1.27 bug 1: an ion's pull on water's partial charges is doubled in the flat game only (factor ${e.flat} flat, ${e.d3} in 3-D)`, 'fix01 pull: ' + JSON.stringify(e));
};
PARTS.forces = async (page, check, say) => {
  const r = {};
  for (const [name, opts] of [['wasm', {}], ['js', { wasm: false }]]) {
    const { X, W, na } = naWater(opts, true);
    X.forcesNoEvents(); const fx = X.S.fx[na.i], h = 1e-5, x0 = na.x;
    na.x = x0 + h; const Ep = X.totalEnergy().total; na.x = x0 - h; const Em = X.totalEnergy().total; na.x = x0;
    r[name] = { f: +fx.toFixed(5), dE: +(-(Ep - Em) / (2 * h)).toFixed(5), wasm: !!(X.WK && X.WK.on) };
  }
  const ok = (q) => Math.abs(q.f - q.dE) < 1e-3 * Math.max(1, Math.abs(q.dE));
  check(ok(r.wasm) && ok(r.js) && Math.abs(r.wasm.f - r.js.f) < 1e-6, `1.27 bug 1: in 3-D the force on a Na⁺ beside water is the energy's slope (WebAssembly ${r.wasm.f}, JavaScript ${r.js.f}, from the energy ${r.js.dE} eV/Å)`, 'fix01 forces: ' + JSON.stringify(r));
};

/* Salt in water (brine3d, 1,500 steps): the waters within 3.1 Å of a Na⁺. v145 7.0–7.2 (real 5.5–6, the flat
   game's doubling); now 5.5. */
PARTS.shell = async (page, check, say) => {
  const X = load('all', { seed: 4 }), W = X.W;
  X.PRESETS.brine3d.build(); X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned;
  go(X, 1000);
  const L = W.box.w, mi = (d) => d - L * Math.round(d / L);
  let n = 0, k = 0;
  for (let s = 0; s < 500; s++) {
    go(X, 1); if (s % 25) continue;
    const P = W.parts.filter(p => !p.dead), O = P.filter(p => p.Z === 8), Na = P.filter(p => p.Z === 11 && p.ionic);
    for (const a of Na) { k++; for (const o of O) if (Math.hypot(mi(a.x - o.x), mi(a.y - o.y), mi(a.z - o.z)) < 3.1) n++; }
  }
  const cn = n / k;
  check(cn > 4.8 && cn < 6.3, `1.27 bug 1: a Na⁺ in 3-D salt water has ${cn.toFixed(2)} waters within 3.1 Å (real 5.5–6; with the flat game's doubling about 7)`, 'fix01 shell: ' + cn.toFixed(2));
};

module.exports = async function ffix01(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (fix01 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `fix01 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  const args = process.argv.slice(2), noPage = args.includes('--node');
  let browser = null, page = null, errors = [];
  if (!noPage && Object.values(PARTS).some(f => f.page)) { const { openPage } = require('./browser'); ({ browser, page, errors } = await openPage({ settle: 800 })); }
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(page, check, say, null, args.filter(a => a !== '--node'));
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  if (browser) await browser.close();
  console.log(fails ? `${fails} failure(s)` : '1.27 bug 1 (3-D ion–water pull) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
