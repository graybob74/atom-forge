'use strict';
/* The check for 1.27 bug 17 (data written from memory, checked against the sources; PERF-NOTES "1.27: bug 17"), run by
   t_features (one line) or alone: node tests/f_fix17.js [--node] [part …]. Fails on v145, passes after. No part needs
   the page. (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};

/* The values found wrong: ¹⁰³Rh's moment (−0.8840 μN, ten times IAEA's −0.08840), ²²Na's β⁺/EC shares and Q (ENSDF
   89.96/10.04%, 2.8433 MeV; it had 90.3/9.7%, 2.842), ¹⁹⁸Au's Q (1.3735 MeV, AME2020; it had 1.3724), the Z's mass and
   width (PDG 2024 91.1880, 2.4955 GeV; it had 91.1876, 2.4952), Λ's branchings (PDG 2024 64.1/35.9%; it had 63.9/35.8);
   neutron scattering as free atoms from NIST's bound values (¹⁶O 3.75 b, ³⁵Cl 20.6, ²³⁸U 8.80; it had the bound 4.23, 21.8,
   9.3); σ(cc̄) at 27.4 GeV 18 µb (NA27; it had 15) and σ(bb̄) at 200 GeV 3.75 µb (PHENIX; it had 1.3); muon transfer μp → C 8.9×10¹⁰ s⁻¹ (FAMU 2025; it had 6.4×10¹⁰ scaled from O); lead's
   nuclear-field pair cross section at 100 MeV 0.0900 cm²/g with partial screening (XCOM 0.0899; it had 0.107). */
PARTS.data = async (page, check, say) => {
  const X = load('all', { seed: 1 });
  const na = X.nuclideInfo(11, 11), au = X.nuclideInfo(79, 119);
  const br = (inf, m) => inf.modes.find(q => q.mode === m);
  const r = {
    rh103: X.NUC_SPIN['45_58'][1], naB: br(na, 'b+').br, naEC: br(na, 'ec').br, naQ: br(na, 'ec').Q, auQ: br(au, 'b-').Q,
    o16: X.NXS['8_8'].s, cl35: X.NXS['17_18'].s, u238: X.NXS['92_146'].s, cc27: X.HF_SIG.cc[1][1], trC: X.xaTrRate(6), psO2: X.PS_SIGC, ca: X.XA_KA[4][2], fe: X.XA_KA[5][2], bs: X.HF_FRAG.b[2][0], pb100: +(X.cpmPairSig(82, 82, 1e8)[0] * 6.02214076e23 * 1e-16 / 207.2).toFixed(4), bb200: X.HF_SIG.bb[2][1],
    MZ: X.EW.MZ, GZ: X.EW.GZ, Zm: X.XP.Z0.m, Zw: X.XP.Z0.w, lam: X.XP.Lam.dec.map(d => d[0]),
  };
  const near = (a, b, e) => Math.abs(a - b) <= e;
  check(near(r.rh103, -0.0884, 1e-4) && near(r.naB, 0.8996, 1e-4) && near(r.naEC, 0.1004, 1e-4) && near(r.naQ, 2.8433, 1e-4)
    && near(r.auQ, 1.3735, 1e-4) && r.MZ === 91.188 && r.GZ === 2.4955 && r.Zm === 91188 && r.Zw === 2495.5
    && r.lam[0] === 0.641 && r.lam[1] === 0.359 && r.o16 === 3.75 && r.cl35 === 20.6 && r.u238 === 8.8 && r.cc27 === 18 && r.trC === 8.9e10 && r.psO2 === 1.16e-19 && r.ca === 783.66 && r.fe === 1255.8 && r.bs === 0.1 && Math.abs(r.pb100 - 0.0899) < 0.0009 && r.bb200 === 3.75,
  `1.27 bug 17: ¹⁰³Rh μ ${r.rh103} μN, ²²Na β⁺ ${r.naB} EC ${r.naEC} Q ${r.naQ} MeV, ¹⁹⁸Au Q ${r.auQ} MeV, Z ${r.MZ} GeV Γ ${r.GZ}, Λ → pπ⁻ ${r.lam[0]} nπ⁰ ${r.lam[1]}; free-atom neutron scattering ¹⁶O ${r.o16} b, ³⁵Cl ${r.cl35}, ²³⁸U ${r.u238}; σ(cc̄) 27.4 GeV ${r.cc27} µb, σ(bb̄) 200 GeV ${r.bb200} µb; μp → C ${r.trC} s⁻¹; o-Ps–O₂ conversion ${r.psO2} cm²; muonic Ca/Fe 2p→1s ${r.ca}/${r.fe} keV; f(b → B⁰s) ${r.bs}; lead's pair cross section at 100 MeV ${r.pb100} cm²/g (XCOM 0.0899)`,
  'fix17 data: ' + JSON.stringify(r));
};

module.exports = async function ffix17(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (fix17 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `fix17 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 bug 17 (data written from memory) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
