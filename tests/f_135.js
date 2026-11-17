'use strict';
/* 1.35.0 (the owner, 2026-11-15: "do 2d and 3d in one pass now and code it in wasm", planned item 97): the
   Bose–Einstein condensate lab. Its ground states against the Thomas–Fermi law, its real-time steps keeping the energy,
   T_c, a printed vortex, a spun-up lattice, two halves interfering, ⁷Li collapsing past its critical number and not
   below it, the condensate melting above T_c, and the window in the page. Run by t_features or alone:
   node tests/f_135.js [part …] */
const path = require('path');
const { load } = require(path.join(__dirname, 'load.js'));
const PARTS = {};
function lab(o, seed = 1) {
  const X = load('all', { seed }), B = X.BEC;
  Object.assign(B, { d3: false, sp: 'rb87', N: 20000, f: 50, tf: 0.05, shape: 'round', speed: 'fast' }, o);
  if (!X.becOk() || !X.becReset()) throw new Error('the module has no condensate kernel');
  while (B.ground > 0) X.becAdvance();
  return X;
}
function run(X, tu, cap = 1e9) { const B = X.BEC, t1 = B.t + tu; let k = 0; while (B.t < t1 && k++ < cap) { B.frame++; X.becAdvance(); } }
PARTS.ground = async (page, check) => {
  for (const d3 of [false, true]) {
    const X = lab({ d3, tf: 0 }), o = X.becObs(), tf = X.becMuTF(X.BEC.g.P, 1);
    check(Math.abs(o.mu / tf - 1) < 0.1 && Math.abs(o.norm - 1) < 1e-3, `1.35 condensate lab, ${d3 ? '3-D' : 'flat'} ⁸⁷Rb (20,000 atoms, 50 Hz): the ground state's μ ${o.mu.toFixed(2)} ħω, the Thomas–Fermi law's ${tf.toFixed(2)} (the gradient energy adds a little)`,
      `1.35 ${d3 ? '3-D' : 'flat'} ground state μ ${o.mu.toFixed(3)} against Thomas–Fermi ${tf.toFixed(3)}, norm ${o.norm}`);
  }
  // T_c of the ideal gas in the trap: kT_c = ħω̄ (N/ζ(3))^⅓ (3-D), ħω̄ (6N/π²)^½ (flat)
  const X = load('all', { seed: 1 }); Object.assign(X.BEC, { d3: true, sp: 'rb87', N: 20000, f: 100, shape: 'round' });
  const P = X.becPhys(), want = 1.054571817e-34 * 2 * Math.PI * 100 * Math.cbrt(20000 / 1.2020569) / 1.380649e-23;
  check(Math.abs(P.Tc / want - 1) < 1e-4 && Math.abs(P.Tc * 1e9 - 122) < 2, `1.35 T_c of 20,000 ⁸⁷Rb atoms in a 100 Hz trap: ${(P.Tc * 1e9).toFixed(1)} nK`, `1.35 T_c ${P.Tc * 1e9} nK, want ${want * 1e9}`);
};
/* Real time with nothing to drain it: the energy and the atom number kept (the step under the split-step limit, the
   spectrum's top half filtered: without the filter this cloud's energy grew 20-fold within 10 trap periods). */
PARTS.realtime = async (page, check) => {
  const X = lab({ tf: 0 }), B = X.BEC, g = B.g, p = g.b.P, o0 = X.becObs();
  for (let k = 0; k < 30; k++) { X.becParams(B.dt, 10, false, B.beta0); p[6] = 0; p[18] = 0; p[25] = 0; p[26] = 0; B.kKey = ''; X.WK.ex.af_bec_kin(g.b.T.byteOffset, p.byteOffset); X.WK.ex.af_bec_step(g.b.T.byteOffset, p.byteOffset); B.t += 10 * B.dt; }
  const o1 = X.becObs();
  check(Math.abs(o1.E / o0.E - 1) < 2e-3 && Math.abs(o1.norm / o0.norm - 1) < 1e-3, `1.35 the flat condensate in real time over ${(300 * B.dt).toFixed(1)}/ω (300 steps): energy ${o0.E.toFixed(3)} → ${o1.E.toFixed(3)} ħω per atom, atoms kept to ${Math.abs(o1.norm / o0.norm - 1).toExponential(1)}`,
    `1.35 real time: E ${o0.E} → ${o1.E}, norm ${o0.norm} → ${o1.norm}`);
};
PARTS.vortex = async (page, check) => {
  const X = lab({}); X.becImprint(); run(X, 1); const v = X.becVortices(), o = X.becObs(), L = o.Lz / o.norm;
  check(v.cnt === 1 && Math.abs(L - 1) < 0.05, `1.35 a printed vortex: one phase winding, L_z ${L.toFixed(3)} ħ per atom after 1/ω`, `1.35 vortex: ${JSON.stringify(v)}, L_z ${L}`);
};
PARTS.spin = async (page, check) => {
  const X = lab({}); X.becSpin(); while (X.BEC.ground > 0) X.becAdvance(); const v = X.becVortices(), o = X.becObs();
  check(v.cnt >= 10 && v.net === v.cnt && o.Lz / o.norm > 8, `1.35 spun up at 0.7 ω: a lattice of ${v.cnt} vortices, all turning one way, L_z ${(o.Lz / o.norm).toFixed(1)} ħ per atom`, `1.35 spin: ${JSON.stringify(v)}, L_z ${o.Lz / o.norm}`);
};
/* Split by a sheet of light, then released: the two halves overlap and interfere (Andrews et al. 1997). */
PARTS.fringes = async (page, check) => {
  const X = lab({}), B = X.BEC; B.split = true; run(X, 10); const bar = B.bar / B.mu0; X.becRelease(); run(X, 1.5);
  const g = B.g, n = g.n, { re, im } = g.b, row = []; for (let i = 0; i < n; i++) { const q = i + n * (n / 2); row.push(re[q] ** 2 + im[q] ** 2); }
  const mx = Math.max(...row); let peaks = 0; for (let i = 1; i < n - 1; i++) if (row[i] > row[i - 1] && row[i] >= row[i + 1] && row[i] > 0.1 * mx) peaks++;
  check(bar > 0.8 && peaks >= 4 && B.lost < 0.01 * B.N, `1.35 split (the sheet ${bar.toFixed(2)} μ high) and released: ${peaks} fringes across the overlap after ${(1.5 / B.g.P.w * 1e3).toFixed(1)} ms of flight, the grid doubled ${B.regrids}×, ${(100 * B.lost / B.N).toFixed(2)}% of the atoms out of the picture`,
    `1.35 fringes: sheet ${bar}, ${peaks} peaks, lost ${B.lost}, regrids ${B.regrids}`);
};
/* ⁷Li attracts: past its critical number (0.574 a_ho/|a|) the cloud collapses and three-body loss throws atoms out;
   below it, it holds. */
PARTS.collapse = async (page, check) => {
  const X = lab({ sp: 'li7', d3: true, N: 10000, f: 100 }), B = X.BEC, Ncr = B.g.P.Ncr; let k = 0;
  for (; k < 400 && !B.collapse; k++) { B.frame++; X.becAdvance(); } run(X, 0.3);
  const Y = lab({ sp: 'li7', d3: true, N: 1000, f: 100 }); run(Y, 1.5);
  check(B.collapse && B.lost > 0.1 * B.N && !Y.BEC.collapse && Y.BEC.lost < 5, `1.35 ⁷Li: 10,000 atoms (critical ${Math.round(Ncr)}) collapse after ${(B.t / B.g.P.w * 1e3).toFixed(2)} ms and lose ${Math.round(100 * B.lost / B.N)}%; 1,000 hold`,
    `1.35 collapse: big ${B.collapse} lost ${B.lost}; small collapse ${Y.BEC.collapse} lost ${Y.BEC.lost}`);
};
PARTS.melt = async (page, check) => {
  const X = lab({}); X.BEC.tf = 1.2; run(X, 6); const n = X.becObs().norm;
  const Y = lab({ d3: true, f: 100 }); Y.BEC.tf = 0.5; run(Y, 3); const m = Y.becObs().norm;
  check(n < 1e-2 && Math.abs(m - 0.875) < 0.03, `1.35 heated to 1.2 T_c the condensate melts (${(100 * n).toFixed(2)}% left); at 0.5 T_c in 3-D it holds ${(100 * m).toFixed(1)}% (the ideal gas: 87.5%)`,
    `1.35 melt: ${n} above T_c, ${m} at 0.5 T_c`);
};
/* 1.35.1: the game opened in a second window while the first still runs: the first's heartbeat, seconds old, is not
   reported as a crash (the owner's "stopped unexpectedly" on opening 1.35.0); a window that really stopped still is. */
PARTS.twoWindows = async (page, check) => {
  const { chromium } = require('playwright'), { pageFile } = require('./browser');
  const browser = await chromium.launch(require('./deps').launchOpts({ headless: true })), ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const p1 = await ctx.newPage(); await p1.goto('file://' + pageFile()); await p1.waitForTimeout(4000);
  const beat = await p1.evaluate(() => localStorage.getItem('atomforge.beat'));
  const p2 = await ctx.newPage(); await p2.goto('file://' + pageFile()); await p2.waitForTimeout(7000);
  const alive = await p2.evaluate(() => CRASH.open); await p2.close();
  const b = JSON.parse(beat); await p1.close(); b.win = 'ghost'; b.at = Date.now();
  const p3 = await ctx.newPage(); await p3.addInitScript((t) => { localStorage.setItem('atomforge.beat', t); localStorage.removeItem('atomforge.bye'); }, JSON.stringify(b));
  await p3.goto('file://' + pageFile()); await p3.waitForTimeout(7000);
  const dead = await p3.evaluate(() => CRASH.open && /unexpectedly/.test($('crashTitle').textContent));
  await browser.close();
  check(!alive && dead, '1.35.1 a second window of the game, the first still running: no crash report; a window that stopped with its heartbeat seconds old: reported after 5 s', `1.35.1 two windows: alive reported ${alive}, dead reported ${dead}`);
};
PARTS.page = async (page, check) => {
  let own = null; if (!page) { const { openPage } = require('./browser'); own = await openPage({ viewport: { width: 1360, height: 900 }, settle: 800 }); page = own.page; }
  await page.evaluate(() => $('bBec').click());
  for (let i = 0; i < 60; i++) { await page.waitForTimeout(400); if (await page.evaluate(() => BEC.ground <= 0)) break; }
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => { const c = $('becCv'), x = c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data; return { open: !$('becModal').hidden, px: [...x], stats: $('becInfo').querySelectorAll('dd').length, run: UI.running }; });
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  const shut = await page.evaluate(() => ({ hidden: $('becModal').hidden, open: BEC.open, run: UI.running }));
  check(r.open && r.px[0] + r.px[1] + r.px[2] > 200 && r.stats >= 10 && !r.run && shut.hidden && !shut.open && shut.run, `1.35 the lab's window opens from the Lab tab with the cloud drawn and ${r.stats} readouts, pauses the chamber, and Esc closes it (the chamber running again)`,
    `1.35 page: ${JSON.stringify(r)} ${JSON.stringify(shut)}`);
  if (own) { if (own.errors.length) check(false, '', '1.35 page errors: ' + own.errors.join(' | ')); await own.browser.close(); }
};
module.exports = async function f135(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check); } catch (e) { check(false, '', `1.35 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
if (require.main === module) (async () => {
  let fails = 0; const check = (ok, good, bad) => { if (ok) console.log('  ' + good); else { fails++; console.log('FAIL ' + bad); } };
  await module.exports(null, check, null, null, process.argv.slice(2));
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})();
