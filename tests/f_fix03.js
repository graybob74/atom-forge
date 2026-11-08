'use strict';
/* The check for 1.27 bug 3 (PERF-NOTES, "1.27: bug 3 (close passes between nuclei)"), run by t_features (one line) or
   alone: node tests/f_fix03.js [--node] [part …]. Below the reaction threshold two nuclei passing close were turned by
   Rutherford's law at an impact parameter held to at least 0.005–0.01 Å (500–1,000 fm), so no pass turned them by more
   than a few degrees: a 1 MeV α dead on an α at rest handed it 133 eV (3-D 33 eV), not the whole 1 MeV. Now the pass is
   taken down to nuclear distances (bReal: 3-D its own distance, flat mapped onto an area) and the turn is exact in their
   own frame. Both parts fail on v145. No part needs the page. (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const go = (X, n) => { const W = X.W; for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };

/* A 1 MeV α dead on an α at rest (and a 5 MeV α on a gold nucleus): the target takes the whole energy (gold: the 390.6 keV
   most a 180° turn can give it, 4m₁m₂/(m₁ + m₂)² of 5 MeV), flat and 3-D, the books exact. */
PARTS.headon = async (page, check, say) => {
  const r = {}; let ok = true;
  for (const d3 of [false, true]) for (const [sym, KE, want] of [['He', 1e6, 1e6], ['Au', 5e6, 390.6e3]]) {
    const X = load('all', { seed: 1 }), W = X.W; X.PRESETS.empty.build(); if (d3) X.world3d(30); W.T = 0; W.gamma = 0; W.decayOn = false;
    const t = X.addAtom(sym, 0, 0, { bare: true, T: 0 }); t.vx = t.vy = t.vz = 0;
    const a = X.addAtom('He', -10, 0, { bare: true, T: 0 }); X.setMotion(a, KE, 1, 0, 0, 0, 0);
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    const B = () => X.totalEnergy().total - W.ledger.nuc, E0 = B();
    go(X, 60);
    const got = X.keOf(t), books = B() - E0;
    r[(d3 ? '3d ' : '') + sym] = { got: Math.round(got), books: +books.toFixed(4) };
    if (!(Math.abs(got - want) < 0.002 * want && Math.abs(books) < 0.01)) ok = false;
  }
  check(ok, `1.27 bug 3: a 1 MeV α dead on an α hands it ${r.He.got} eV (3-D ${r['3d He'].got}), a 5 MeV α on gold ${r.Au.got} eV (3-D ${r['3d Au'].got}), books exact`, 'fix03 headon: ' + JSON.stringify(r));
};

/* 5 MeV α on gold, passes drawn as the game draws them (flat: uniform in distance within 0.5 Å, moveRad's
   nuclearCollision; 3-D: uniform over the area within 0.6 Å, coulombScatter3), importance-sampled to those that turn
   it by 5° or more: the lab angles against Rutherford's law (flat with nuclearCollision's screening) and the share
   turned past 90° a pass against Rutherford's (b₉₀/R)². */
PARTS.rutherford = async (page, check, say) => {
  const out = {}, N = 40000;
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 5 }), W = X.W; X.PRESETS.empty.build(); if (d3) X.world3d(30); W.T = 0; W.gamma = 0;
    const KE = 5e6, mA = 4.0026, mT = 196.97, Ecm = KE * mT / (mA + mT), d = X.PHYS.KE * 2 * 79 / Ecm, R = d3 ? 0.6 : 0.5;
    // inner cut: passes that would turn by ≥ 5° (b_real ≤ bc), sampled within; their share of all passes is w
    const bc = d / 2 / Math.tan(2.5 * Math.PI / 180), w = d3 ? (bc / R) ** 2 : (bc / R) ** 2; // (flat: b_real = R√(b/R) ≤ bc ⟺ b ≤ bc²/R; 3-D: area)
    const bins = [5, 10, 20, 30, 45, 60, 90, 120, 150, 180], h = new Array(bins.length - 1).fill(0); let past90 = 0, books = 0;
    for (let k = 0; k < N; k++) {
      X.clearWorld(); if (d3) X.world3d(30);
      const t = X.addAtom('Au', 0, 0, { bare: true, T: 0 }); t.vx = t.vy = t.vz = 0;
      const a = X.addAtom('He', -1, 0, { bare: true, T: 0 }); X.setMotion(a, KE, 1, 0, 0, 0, 0);
      const K0 = X.keOf(a) + X.keOf(t);
      let ux, uy, uz = 0;
      if (!d3) { const b = X.rnd() * bc * bc / R; X.nuclearCollision(a, t, b); ux = a.rad ? a.ux : a.vx; uy = a.rad ? a.uy : a.vy; }
      else { const r = bc * Math.sqrt(X.rnd()), ph = X.rnd() * 2 * Math.PI, cy = r * Math.cos(ph), cz = r * Math.sin(ph); X.coulombScatter3(a, t, r, 0, -cy, -cz); ux = a.vx; uy = a.vy; uz = a.vz; }
      books = Math.max(books, Math.abs(X.keOf(a) + X.keOf(t) - K0));
      const th = Math.acos(Math.max(-1, Math.min(1, ux / Math.hypot(ux, uy, uz)))) * 180 / Math.PI;
      if (th > 90) past90++;
      for (let i = 0; i < h.length; i++) if (th >= bins[i] && th < bins[i + 1]) h[i]++;
    }
    // expected: share of passes (within bc) beyond lab angle θ: cot²(θc/2)/cot²(2.5°), θc from θ_lab (m1/m2)
    const r = mA / mT, thc = (tl) => { const t = tl * Math.PI / 180; return t + Math.asin(Math.min(1, r * Math.sin(t))); };
    const sa = 0.4685 / (Math.pow(2, 0.23) + Math.pow(79, 0.23)); // (flat: nuclearCollision's screening, exp(−b/a))
    const bOf = (tc) => { if (d3) return d / 2 / Math.tan(tc / 2); let lo = 0, hi = 1; for (let it = 0; it < 80; it++) { const m = (lo + hi) / 2; if (2 * Math.atan(d * Math.exp(-m / sa) / (2 * m)) > tc) lo = m; else hi = m; } return lo; };
    const beyond = (tl) => tl >= 180 ? 0 : (bOf(thc(tl)) / bc) ** 2;
    let chi = 0, nb = 0; const rows = [];
    for (let i = 0; i < h.length; i++) { const e = N * (beyond(bins[i]) - beyond(bins[i + 1])); rows.push(`${bins[i]}–${bins[i + 1]}°: ${h[i]} (${e.toFixed(1)})`); if (e > 0) { chi += (h[i] - e) ** 2 / e; nb++; } }
    const per = past90 / N * w, perR = beyond(90) * w;
    out[d3 ? 'd3' : 'flat'] = { chi: +chi.toFixed(1), nb, past90, per, perR, books }; void (`${N} passes inside ${(bc * 1e4).toFixed(2)}e-4 Å (share ${w.toExponential(2)} of all passes within ${R} Å); χ² ${chi.toFixed(1)} for ${nb} bins; past 90°: ${past90} → ${per.toExponential(2)} a pass (Rutherford ${perR.toExponential(2)}); energy kept to ${books.toExponential(1)} eV`);
  }

  const f = out.flat, t = out.d3;
  check(f.chi < 25 && t.chi < 25 && Math.abs(f.per / f.perR - 1) < 0.3 && Math.abs(t.per / t.perR - 1) < 0.3 && f.books < 1e-3 && t.books < 1e-3,
    `1.27 bug 3: 5 MeV α on gold turn by Rutherford's law (χ² ${f.chi} flat, ${t.chi} 3-D, ${f.nb} bins); past 90° ${f.per.toExponential(2)} a pass flat (Rutherford ${f.perR.toExponential(2)}), ${t.per.toExponential(2)} 3-D (${t.perR.toExponential(2)}); energy kept`,
    'fix03 rutherford: ' + JSON.stringify(out));
};

module.exports = async function ffix03(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (fix03 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `fix03 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 bug 3 (close passes between nuclei) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
