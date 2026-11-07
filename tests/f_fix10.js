'use strict';
/* The check for 1.27 bug 10 (PERF-NOTES, "1.27: bug 10 (neutron on a muonic atom)"), run by t_features (one line) or
   alone: node tests/f_fix10.js [--node] [part …]. An event that remade a muonic atom's nucleus took the muon away with
   the old atom (muBoundTick: "atom gone"). Now muCarry leaves it bound to the new nucleus with the most charge, its
   binding the new one's and the change in the books. Both parts fail on v145. No part needs the page.
   (check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};

/* One muonic ¹²C hit dead on by a 14 MeV neutron, 40 times, flat and 3-D, with Exotic atoms off and on: every reaction
   (⁹Be + α, 3α + n, inelastic) leaves the muon bound to its heaviest product, with that nucleus's 1s binding; books exact. */
PARTS.carbon = async (page, check, say) => {
  const r = {}; let ok = true, worst = 0;
  for (const d3 of [false, true]) for (const ex of [false, true]) {
    const X = load('all', { seed: 11 }), W = X.W; let n0 = 0, kept = 0, bind = 0;
    for (let k = 0; k < 40; k++) {
      X.PRESETS.empty.build(); if (d3) X.world3d(30); W.T = 0; W.gamma = 0; W.decayOn = false;
      const t = X.addAtom('C', 0, 0, { T: 0 }); t.vx = t.vy = t.vz = 0;
      const Eb = ex ? X.xaLevel('mu-', 6, 6, 1) : X.MU_EB(6) * X.MEV;
      t.muB = ex ? { m: X.MU_M * X.MEV - Eb, Eb, sp: 'mu-', n: 1, zx: 1, n0: 14 } : { m: X.MU_M * X.MEV - Eb, Eb }; t.m = X.atomMass(t); t.im = 1 / t.m; if (ex) X.refresh(t); W.muBound = [t];
      const n = X.addNuc(0, 1, 0, -0.3, (X.rnd() - 0.5) * 0.02, 0, 0, false, 0); X.setMotion(n, 14e6, 1, 0, 0, 0, 0);
      X.forcesNoEvents(); W.fSpawn = W.spawned;
      const B = () => X.totalEnergy().total - W.ledger.nuc, E0 = B();
      if (!X.nuclearEncounter(n, t, 0.01, 0, 0, 0)) continue;
      X.forcesNoEvents(); worst = Math.max(worst, Math.abs(B() - E0)); n0++;
      const h = W.parts.find(p => !p.dead && p.muB);
      if (h && W.muBound.includes(h)) { kept++; const want = ex ? X.xaLevel('mu-', h.Z, h.N, 1) : X.MU_EB(h.Z) * X.MEV; if (Math.abs(h.muB.Eb - want) < 1e-6) bind++; }
    }
    r[`${d3 ? '3d' : 'flat'}${ex ? ' exotic' : ''}`] = [kept, n0, bind];
    if (!(n0 > 30 && kept === n0 && bind === n0)) ok = false;
  }
  check(ok && worst < 1e-4, `1.27 bug 10: a 14 MeV neutron remaking a muonic ¹²C leaves the muon bound to the new nucleus (${JSON.stringify(r)}), books to ${worst.toExponential(0)} eV`, 'fix10 carbon: ' + JSON.stringify({ r, worst }));
};

/* 64 muonic lead atoms, decay sped up 10⁶×: the neutrons from their captures hit the others; none ends early (v145: 39). */
PARTS.lead = async (page, check, say) => {
  const X = load('all', { seed: 3 }), W = X.W; X.PRESETS.empty.build(); W.T = 300; W.gamma = 0; W.decayOn = true; W.warp = 1e6;
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { const p = X.addAtom('Pb', -14 + 4 * i, -14 + 4 * j); const Eb = X.MU_EB(p.Z) * X.MEV; p.muB = { m: X.MU_M * X.MEV - Eb, Eb }; p.m = X.atomMass(p); p.im = 1 / p.m; (W.muBound || (W.muBound = [])).push(p); }
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  let early = 0; const f = X.muBoundTick; X.muBoundTick = function (dt) { for (const p of W.muBound) if (p.muB && (p.dead || p.Z < 2)) early++; return f.apply(this, arguments); };
  for (let s = 0; s < 3000; s++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
  check(early === 0, `1.27 bug 10: 64 muonic lead atoms among their own capture neutrons: none loses its muon to a nuclear reaction (${early})`, 'fix10 lead: ' + early + ' ended early');
};

module.exports = async function ffix10(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (f.page && !page) { say(`  (fix10 ${k}: needs the page, skipped)`); continue; }
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `fix10 ${k}: ${e.message.split('\n')[0]}`); }
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
  console.log(fails ? `${fails} failure(s)` : '1.27 bug 10 (neutron on a muonic atom) checks passed');
  process.exitCode = fails ? 1 : 0;
})();
