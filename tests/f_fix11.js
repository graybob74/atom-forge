'use strict';
/* The check for 1.27 bug 11 (PERF-NOTES, "1.27: bug 11 (giant dipole resonance)"), run by t_features (one line) or alone:
   node tests/f_fix11.js [--node] [part …]. With Charged particles in matter on, γ rays chose pairs and Compton by their
   measured cross sections but the giant dipole resonance kept its old scale, 16 times too rare beside them in lead. Now
   gdrP puts it on the same footing. The part fails on v145. No part needs the page. (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};

/* γ rays of 13.5 MeV crossing one lead nucleus, switch on: what rayInteract chooses, counted over 20,000 passes, the giant
   dipole resonance's share against pairs and Compton as their cross sections give it (gdrSigma 376 mb : pair 15.6 b :
   Compton 3.35 b: 0.0195; v145 0.0012); switch off: the old odds, 0.0015·Z·σ_GDR/(5.2 Z² mb) a pass. */
PARTS.share = async (page, check, say) => {
  const r = {};
  for (const on of [true, false]) {
    const X = load('all', { seed: 5 }), W = X.W; X.RP.cpm = on; X.PRESETS.empty.build(); W.T = 0; W.gamma = 0;
    const t = X.addAtom('Pb', 0, 0, { T: 0 }); let g = 0, pr = 0, c = 0;
    const f1 = X.photoNuclear, f2 = X.cpmPair, f2b = X.pairProduce, f3 = X.compton;
    X.photoNuclear = () => { g++; return true; }; X.cpmPair = () => { pr++; }; X.pairProduce = () => { pr++; }; X.compton = () => { c++; };
    for (let k = 0; k < 20000; k++) { const h = X.rayInteract(-3, 0.1, 1, 0, 13.5e6, null, null); if (h && h.after) h.after(); }
    X.photoNuclear = f1; X.cpmPair = f2; X.pairProduce = f2b; X.compton = f3;
    r[on ? 'on' : 'off'] = { g, pr, c, share: +(g / (g + pr + c)).toFixed(4), want: on ? +(X.gdrP(t, 13.5e6) / (X.gdrP(t, 13.5e6) + 0.012 * (X.cpmPairSig(82, 82, 13.5e6)[0] + X.cpmPairSig(82, 82, 13.5e6)[1]) / X.CPM_KN1 + 0.012 * 82 * X.cpmKN(13.5e6) / X.CPM_KN1)).toFixed(4) : null };
  }
  check(Math.abs(r.on.share - 0.0195) < 0.005 && r.on.g > 150 && r.off.share < 0.004, `1.27 bug 11: at 13.5 MeV in lead the giant dipole resonance takes ${r.on.share} of what γ rays do with Charged particles in matter on (its cross section's share 0.0195; off ${r.off.share}, the old scale)`, 'fix11 share: ' + JSON.stringify(r));
};

module.exports = async function ffix11(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (fix11 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `fix11 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 bug 11 (giant dipole resonance) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
