'use strict';
/* 1.38 (item 102, the owner, 2026-11-22: "add everything that can realistically be more realistic"). hits: hadrons above
   1 GeV strike several nucleons on their way through a nucleus. scatter: multiple scattering in the flat game at the
   measured (Highland) width. pt: jets' transverse momenta as measured, rising with the energy. Run by t_features or
   alone: node tests/f_138.js [part …] */
const path = require('path');
const { load } = require(path.join(__dirname, 'load.js'));
const PARTS = {};
const BK = (X, W) => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc;
PARTS.hits = async (page, check) => {
  const X = load('all', { seed: 3 }), W = X.W; X.PRESETS.empty.build();
  const out = {}; let bk = 0;
  for (const sp of ['pi+', 'K+', 'Sig+', 'Lamb']) {
    const nus = [];
    for (let i = 0; i < 25; i++) { W.exo.length = 0; W.parts.length = 0; const tg = X.addAtom('Pm', 0, 0, { A: 145 }); tg.ne = 0; const o = X.addExo(sp, -1, 0, 1e10, 1, 0);
      const b0 = BK(X, W); X.hadronHit(o, tg, 0.1); bk = Math.max(bk, Math.abs(BK(X, W) - b0));
      const m = /struck (\d+) nucleons/.exec((W.log[W.log.length - 1] || {}).text || ''); nus.push(m ? +m[1] : 1); }
    out[sp] = nus.reduce((a, b) => a + b, 0) / nus.length;
  }
  W.exo.length = 0; W.parts.length = 0; const tg = X.addAtom('Pm', 0, 0, { A: 145 }); tg.ne = 0; const o = X.addExo('pi-', -1, 0, 1e8, 1, 0); X.hadronHit(o, tg, 0.1);
  const slow = !/struck \d+ nucleons/.test((W.log[W.log.length - 1] || {}).text || '');
  check(out['pi+'] > 3 && out['K+'] > 2.5 && out['Sig+'] > 4 && out['Lamb'] > 5 && slow && bk < 1e-3, `1.38 10 GeV hadrons through the middle of ¹⁴⁵Pm strike several nucleons: π⁺ ${out['pi+'].toFixed(1)}, K⁺ ${out['K+'].toFixed(1)}, Σ⁺ ${out['Sig+'].toFixed(1)}, Λ̄ ${out['Lamb'].toFixed(1)} (100 MeV: one, its channels as before); books within ${X.fmtE(bk)}`, `1.38 hits: ${JSON.stringify(out)} slow ${slow} books ${bk}`);
};
PARTS.scatter = async (page, check) => {
  const X = load('all', { seed: 5 }), W = X.W; X.PRESETS.empty.build(); W.decayOn = false; W.gamma = 0;
  const a = 2.5, Lx = 40, H = 16;
  for (let x = -Lx / 2; x <= Lx / 2; x += a) for (let y = -H / 2; y <= H / 2; y += a) { const p = X.addAtom('Pb', x, y); p.vx = p.vy = 0; p.fixed = true; }
  const ang = [];
  for (let k = 0; k < 80; k++) { const o = X.addExo('mu-', -Lx / 2 - 5, (X.rnd() - 0.5) * 4, 1e8, 1, 0); for (let s = 0; s < 400 && !o.dead && o.x < Lx / 2 + 2; s++) X.step(2e-4); if (!o.dead || o.x > Lx / 2) ang.push(Math.atan2(o.uy, o.ux)); o.dead = true; }
  const rms = Math.sqrt(ang.reduce((t, v) => t + v * v, 0) / ang.length);
  // Highland for this block: lead at the block's density (one atom a 2.5 Å cube, against real lead's 0.033 Å⁻³), x = 40 Å
  const t = Lx / (5.6e7 * 0.033 * a * a * a), pv = 1e8 * (1e8 + 2 * 105.7e6) / (1e8 + 105.7e6) / 1e6, hl = 13.6 / pv * Math.sqrt(t) * (1 + 0.038 * Math.log(t));
  check(rms > 0.5 * hl && rms < 2 * hl, `1.38 a 100 MeV μ⁻ through 40 Å of flat lead spreads ${rms.toExponential(1)} rad, Highland’s ${hl.toExponential(1)} (1.37: 5.5×10⁻⁴, 11× too wide)`, `1.38 scatter: rms ${rms}, Highland ${hl}, n ${ang.length}`);
};
PARTS.pt = async (page, check) => {
  const X = load('all', { seed: 1 }), m = (M) => { let s = 0; for (let i = 0; i < 20000; i++) s += X.jetPt(M); return s / 20000 / 1000; };
  const a = m(2e4), b = m(9e5), c = m(7e6);
  check(Math.abs(a - 0.36) < 0.03 && Math.abs(b - 0.46) < 0.03 && Math.abs(c - 0.55) < 0.03, `1.38 jets' mean transverse momentum rises with the energy as measured: ${a.toFixed(2)} GeV/c at 20 GeV, ${b.toFixed(2)} at 0.9 TeV, ${c.toFixed(2)} at 7 TeV`, `1.38 pt: ${a} ${b} ${c}`);
};
module.exports = async function f138(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check); } catch (e) { check(false, '', `1.38 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
if (require.main === module) (async () => {
  let fails = 0; const check = (ok, good, bad) => { if (ok) console.log('  ' + good); else { fails++; console.log('FAIL ' + bad); } };
  await module.exports(null, check, null, null, process.argv.slice(2));
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})();
