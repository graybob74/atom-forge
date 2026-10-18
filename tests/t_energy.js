'use strict';
/* Energy bookkeeping: every preset run with the heat bath, the applied fields and radioactive decay switched off
   must keep its total energy (kinetic + potential + the electrons' binding + what light and particles carried off,
   less what nuclear reactions and annihilations released from mass) up to integration error. Reports the drift per preset; fails when it is far beyond its usual size
   (a fixed allowance, plus 2% of the kinetic energy present at the end: integration error grows with the heat,
   as in the soup, which a neutron capture's keV recoil can turn into a 300 000 K plasma).
   node tests/t_energy.js [root] [frames] */
const path = require('path');
const root = process.argv[2] && !/^\d+$/.test(process.argv[2]) ? process.argv[2] : path.join(__dirname, '..');
const F = +(process.argv.find(a => /^\d+$/.test(a)) || 300);
const { load } = require(path.join(root, 'tests', 'load.js'));
const LIMIT = { default: 3, neon: 8, fusion: 10, annihilation: 30, pet: 10, chain: 40, useries: 30, combustion: 6, flame: 6, soup: 20, antihydrogen: 6 }; // eV per run, generous (soup: a neutron capture's keV recoil boils it)
const SKIP = { massspec: 'its ion sources keep adding energy', ring: 'its injectors and cavities add energy', linac: 'its injectors and cavities add energy',
  isolde: 'its proton beam keeps adding energy', sns: 'its proton beam keeps adding energy', dafne: 'its injectors and cavities add energy',
  seu: 'its cosmic-ray sources keep adding energy', crt: 'its electron gun keeps adding energy' };
let fails = 0;
const X0 = load('all', { seed: 1 });
const keys = Object.keys(X0.PRESETS);
const rows = [];
for (const k of keys) {
  if (SKIP[k]) { rows.push(`${k.padEnd(13)} skipped: ${SKIP[k]}`); continue; }
  const X = load('all', { seed: 7 });
  const { W } = X;
  X.PRESETS[k].build(); X.settleOverlaps();
  W.slowmo = false; W.gamma = 0; W.Ex = 0; W.Ey = 0; W.decayOn = false;
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  const tot = () => X.totalEnergy().total - W.ledger.nuc;
  const E0 = tot(), t0 = Date.now(), ts = W.t;
  let worst = 0;
  for (let f = 0; f < F; f++) { X.simFrame(1 / 60, 1e9); if (f % 30 === 29) worst = Math.max(worst, Math.abs(tot() - E0)); }
  const keEnd = W.parts.reduce((s, p) => s + (p.dead ? 0 : X.keOf(p)), 0);
  const d = tot() - E0, lim = (LIMIT[k] || LIMIT.default) + 0.02 * keEnd;
  const bad = !(Math.abs(d) <= lim) || !(worst <= 2 * lim);
  if (bad) fails++;
  rows.push(`${bad ? 'FAIL ' : ''}${k.padEnd(13)} nuclear ${(W.ledger.nuc / 1e6).toFixed(2).padStart(8)} MeV, drift ${d.toFixed(3).padStart(8)} eV (worst ${worst.toFixed(2)}) over ${((W.t - ts) * 10.18).toFixed(0)} fs, ${W.parts.filter(p => !p.dead).length} particles, ${Date.now() - t0} ms`);
}
console.log(rows.join('\n'));
console.log(fails ? `${fails} energy failure(s)` : 'energy test passed');
process.exitCode = fails ? 1 : 0;
