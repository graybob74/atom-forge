'use strict';
/* The check for 1.27 bug 12 (PERF-NOTES, "1.27: bug 12 (muon lifetimes)"), run by t_features (one line) or alone:
   node tests/f_fix12.js [--node] [part …]. A negative muon's mean life in an atom was measured for 20 elements and the
   Goulard–Primakoff form between them, 10–20% off there (argon 643 ns against 553, uranium 85 against 77). Now 23 more
   measured elements (Suzuki, Measday & Roalsvig 1987, as Zinner, Langanke & Vogel 2006 tabulate them). The part fails on
   v145. No part needs the page. (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};

/* The mean life (capture and decay) of a muon in argon, chromium, tellurium, dysprosium, thorium and uranium against the
   measured values; the 20 earlier ones as they were. */
PARTS.tau = async (page, check, say) => {
  const X = load('all', { seed: 1 }), tau = (Z) => { const [lc, ld] = X.muRates(Z, Math.round(X.ELEMENTS[Z].mass) - Z); return 1e9 / (lc + ld); };
  const want = { 18: 553.4, 24: 255.0, 52: 103.1, 66: 78.7, 90: 77.3, 92: 77.3, 13: 864.0, 82: 75.4 }, r = {};
  let ok = true; for (const [Z, t] of Object.entries(want)) { r[X.ELEMENTS[Z].sym] = +tau(+Z).toFixed(1); if (Math.abs(tau(+Z) / t - 1) > 0.002) ok = false; }
  check(ok, `1.27 bug 12: muon mean lives measured: Ar ${r.Ar} ns (was 643), Cr ${r.Cr}, Te ${r.Te}, Dy ${r.Dy}, Th ${r.Th}, U ${r.U}; Al ${r.Al} and Pb ${r.Pb} as before`, 'fix12 tau: ' + JSON.stringify(r));
};

module.exports = async function ffix12(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (fix12 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `fix12 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 bug 12 (muon lifetimes) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
