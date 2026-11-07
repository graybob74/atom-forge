'use strict';
/* The check for 1.27 bug 7 (PERF-NOTES, "1.27: bug 7 (X-ray Compton)"), run by t_features (one line) or alone:
   node tests/f_fix07.js [--node] [part …]. Photons below 100 keV never Compton-scattered (rayInteract: the outer
   electrons' photoelectric rule of thumb only). Now 10–100 keV X-rays meet atoms by their incoherent and photoelectric
   cross sections (xraySig), on the γ rays' scale. Both parts fail on v145. No part needs the page.
   (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const run = (mat, E, N, seed = 7) => {
  const X = load('all', { seed }), W = X.W; let c = 0, pe = 0, kin = 0;
  const fc = X.compton, fp = X.photoIonize, fe = X.emitPhoton;
  X.compton = function (p, E1, ux, uy) { c++; let got = null; X.emitPhoton = function (x, y, Ep, nx, ny) { got = [Ep, nx * ux + ny * uy]; return fe.apply(this, arguments); }; const r = fc.apply(this, arguments); X.emitPhoton = fe; if (got) kin = Math.max(kin, Math.abs(got[0] - E1 / (1 + E1 / 510998.95 * (1 - got[1]))) / E1); return r; };
  X.photoIonize = function () { pe++; return fp.apply(this, arguments); };
  for (let k = 0; k < N; k++) {
    if (mat === 'water') X.PRESETS.water.build(); else { X.PRESETS.empty.build(); for (let x = -12; x <= 12; x += 3.5) for (let y = -9; y <= 9; y += 3.5) X.addAtom('Pb', x, y); }
    W.T = 0; W.gamma = 0; W.decayOn = false; for (const p of W.parts) { p.vx = p.vy = 0; } X.forcesNoEvents(); W.fSpawn = W.spawned;
    fe(-W.box.w / 2 + 0.5, (X.rnd() - 0.5) * W.box.h * 0.8, E, 1, 0);
  }
  return { c, pe, share: c / Math.max(1, c + pe), kin };
};

/* X-rays fired across flat water (300 each): the share of what the atoms do to them that is Compton scattering, against
   XCOM's incoherent/(incoherent + photoelectric) for water (0.24 at 20 keV, 0.54 at 30, 0.91 at 60, 0.98 at 100;
   counted over every interaction, the scattered photons' too); the scattered photon's energy E/(1 + k(1 − cos θ)). */
PARTS.water = async (page, check, say) => {
  const r = {}; let ok = true, kin = 0;
  for (const [E, want] of [[20e3, 0.24], [30e3, 0.54], [60e3, 0.91]]) { const q = run('water', E, 300); r[E / 1e3] = +q.share.toFixed(3); kin = Math.max(kin, q.kin); if (!(Math.abs(q.share - want) < 0.08 && q.c + q.pe > 100)) ok = false; }
  check(ok && kin < 1e-9, `1.27 bug 7: X-rays in water Compton-scatter by XCOM's share: ${r[20]} at 20 keV (0.24), ${r[30]} at 30 (0.54), ${r[60]} at 60 (0.91); the scattered energy exact to ${kin.toExponential(0)}`, 'fix07 water: ' + JSON.stringify({ r, kin }));
};

/* In lead the photoelectric effect wins below 100 keV (60 keV: XCOM's incoherent is 1% of it). */
PARTS.lead = async (page, check, say) => {
  const q = run('lead', 60e3, 200);
  check(q.pe > 50 && q.share < 0.05, `1.27 bug 7: 60 keV X-rays in lead are absorbed (photoelectric ${q.pe}, Compton ${q.c})`, 'fix07 lead: ' + JSON.stringify(q));
};

module.exports = async function ffix07(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (fix07 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `fix07 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 bug 7 (X-ray Compton) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
