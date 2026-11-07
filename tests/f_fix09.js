'use strict';
/* The check for 1.27 bug 9 (PERF-NOTES, "1.27: bug 9 (decay table)"), run by t_features (one line) or alone:
   node tests/f_fix09.js [--node] [part …]. Nuclides not in the decay table get their decay from an estimate (the mass
   formula's Q-values, allowed rates), which gave 43 odd–odd nuclides both β⁻ and electron capture. Now they are listed
   from ENSDF (IAEA LiveChart), with 271 more the game makes often. Both parts fail on v145. No part needs the page.
   (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};

/* Some of the 43: listed, with ENSDF's modes (⁹⁴Nb β⁻ only, ¹²⁴I EC 77.3% + β⁺ 22.7%, ²¹⁴At α in 558 ns, ⁷⁴As three ways),
   and the estimate now gives both β⁻ and EC to two nuclides only (²⁵²Bk, ²⁵⁸Es: no evaluated decay). */
PARTS.listed = async (page, check, say) => {
  const X = load('all', { seed: 1 }), info = (z, n) => X.nuclideInfo(z, n), m = (i) => Object.fromEntries(i.modes.map(q => [q.mode, +q.br.toFixed(4)]));
  const nb = info(41, 53), io = info(53, 71), at = info(85, 129), as = info(33, 41);
  let both = 0;
  for (let z = 1; z <= 100; z++) for (let n = Math.max(0, z - 10); n <= 2 * z + 20; n++) { let i; try { i = X.nuclideInfo(z, n); } catch (e) { continue; } if (!i || i.stable || !i.estimated) continue; const s = new Set(i.modes.map(q => q.mode)); if (s.has('b-') && (s.has('ec') || s.has('b+'))) both++; }
  const r = { nb: [nb.estimated, m(nb)], io: [io.estimated, m(io)], at: [at.estimated, at.t12, m(at)], as: [as.estimated, m(as)], both };
  check(!nb.estimated && r.nb[1]['b-'] === 1 && !io.estimated && Math.abs(r.io[1].ec - 0.773) < 1e-3 && Math.abs(r.io[1]['b+'] - 0.227) < 1e-3 && !at.estimated && Math.abs(at.t12 - 5.58e-7) < 1e-9 && r.at[2].a === 1
    && !as.estimated && Object.keys(r.as[1]).length === 3 && both <= 2,
    `1.27 bug 9: ⁹⁴Nb β⁻ only, ¹²⁴I EC ${r.io[1].ec} and β⁺ ${r.io[1]['b+']}, ²¹⁴At α in ${(at.t12 * 1e9).toFixed(0)} ns, ⁷⁴As three ways, from ENSDF; the estimate gives both β⁻ and EC to ${both} nuclides`, 'fix09 listed: ' + JSON.stringify(r));
};

/* What neutrons make: every (n,γ) product of a stable isotope, and ²³⁵U's fission products above 0.1% yield, are listed
   (v145: 99 activation products and 133 fission products on the estimate). */
PARTS.made = async (page, check, say) => {
  const X = load('all', { seed: 1 }), est = (z, n) => { const i = X.nuclideInfo(z, n); return i && !i.stable && i.estimated; };
  const act = [[11, 13], [25, 31], [27, 33], [29, 35], [47, 61], [49, 67], [79, 119], [26, 33], [53, 75], [77, 117], [55, 79], [63, 91]]; // (²⁴Na, ⁵⁶Mn, ⁶⁰Co, ⁶⁴Cu, ¹⁰⁸Ag, ¹¹⁶In, ¹⁹⁸Au, ⁵⁹Fe, ¹²⁸I, ¹⁹⁴Ir, ¹³⁴Cs, ¹⁵⁴Eu)
  const fis = [[52, 82], [54, 84], [40, 60], [38, 56], [36, 54], [56, 88], [55, 86], [53, 84]]; // (¹³⁴Te, ¹³⁸Xe, ¹⁰⁰Zr, ⁹⁴Sr, ⁹⁰Kr, ¹⁴⁴Ba, ¹⁴¹Cs, ¹³⁷I)
  const left = [...act, ...fis].filter(([z, n]) => est(z, n)).map(([z, n]) => `${z + n}${X.ELEMENTS[z].sym}`);
  check(left.length === 0, `1.27 bug 9: what neutrons make here is listed (activation: ²⁴Na … ¹⁵⁴Eu; fission: ¹³⁴Te, ¹³⁸Xe, ¹⁰⁰Zr …)`, 'fix09 made: still estimated ' + left.join(' '));
};

module.exports = async function ffix09(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (fix09 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `fix09 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 bug 9 (decay table) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
