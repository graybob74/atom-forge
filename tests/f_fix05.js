'use strict';
/* The check for 1.27 bug 5 (PERF-NOTES, "1.27: bug 5 (high-energy p̄p)"), run by t_features (one line) or alone:
   node tests/f_fix05.js [--node] [part …]. An antinucleon meeting a nucleon in flight always annihilated into mesons
   (nnbarEvent), whatever its energy. Now annihilation, production with both baryons surviving (nbarSurvive) or elastic
   scattering, by the measured cross sections against momentum (NBAR_X). The part fails on v145. No part needs the page.
   (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};

/* p̄ on p at rest, 300 meetings at each momentum, flat and 3-D: the share that annihilates against σ_ann/σ_tot (below the
   pion threshold σ_ann/(σ_ann + σ_el)), and at the Tevatron's √s the share elastic against σ_el/σ_tot; the books exact. */
PARTS.share = async (page, check, say) => {
  const r = {}; let ok = true, worst = 0;
  for (const d3 of [false, true]) for (const [pl, wantAnn, wantEl] of [[0.5, 78 / 138, null], [2, 33 / 90, null], [10, 6.5 / 56, null], [100, 0.9 / 43, null], [2.047e6, 0, 18 / 78]]) {
    const X = load('all', { seed: 9 }), W = X.W, N = 300; let ann = 0, el = 0;
    const KE = (Math.sqrt(pl * pl + 0.938272 ** 2) - 0.938272) * 1e9;
    for (let k = 0; k < N; k++) {
      X.PRESETS.empty.build(); if (d3) X.world3d(30); W.T = 0; W.gamma = 0; W.decayOn = false;
      const p = X.addAtom('H', 0, 0, { bare: true, T: 0 }); p.vx = p.vy = p.vz = 0;
      const a = X.addAtom('H', -0.05, 0, { bare: true, anti: true, T: 0 }); X.setMotion(a, KE, 1, 0, 0, 0, 0);
      X.forcesNoEvents(); const B = () => X.totalEnergy().total - W.ledger.nuc, E0 = B(), a0 = W.count.annih;
      const t = X.nnbarEvent(a, p, 0, 0); X.forcesNoEvents();
      worst = Math.max(worst, Math.abs(B() - E0) / KE);
      if (W.count.annih > a0) ann++; else if (t && /elastic/.test(t)) el++;
    }
    const sa = ann / N, se = el / N, tol = 3 * Math.sqrt(Math.max(wantAnn * (1 - wantAnn), 0.01) / N) + 0.01;
    r[(d3 ? '3d ' : '') + pl] = [+sa.toFixed(3), +se.toFixed(3)];
    if (Math.abs(sa - wantAnn) > tol || (wantEl !== null && Math.abs(se - wantEl) > 0.08)) ok = false;
  }
  check(ok && worst < 1e-9, `1.27 bug 5: p̄p annihilates by its share of the measured cross sections: ${r['0.5'][0]} at 0.5 GeV/c, ${r['2'][0]} at 2, ${r['10'][0]} at 10, ${r['100'][0]} at 100, ${r['2047000'][0]} at √s 1.96 TeV (elastic ${r['2047000'][1]}); 3-D alike; books exact`, 'fix05 share: ' + JSON.stringify({ r, worst }));
};

module.exports = async function ffix05(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (fix05 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `fix05 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 bug 5 (high-energy p̄p) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
