'use strict';
/* Nuclear events keep the energy books exactly (total energy less what was released from mass): forced decays of
   neutral atoms and bare nuclei by every mode, fission, fusion, neutron capture. Also: an α from a neutral ²³⁸U
   atom gets the measured 4.198 MeV, β⁻ and β⁺ particles stay below their end points, electron capture gives
   off its Kα X-ray, and the electrons' total binding energies agree with the reference fit. Node only. */
const { load } = require('./load');
let fails = 0;
const bad = (m) => { fails++; console.log('FAIL', m); };
function world(seed) {
  const X = load(undefined, { seed });
  const { W } = X;
  X.clearWorld(); W.gamma = 0; W.T = 300; W.decayOn = false; W.box.w = W.box.tw = 400; W.box.h = W.box.th = 400; W.wall = 'open';
  return X;
}
const tot = (X) => X.totalEnergy().total - X.W.ledger.nuc;
// 1. forced decays
const cases = [[92, 146, 'a'], [84, 126, 'a'], [88, 138, 'a'], [6, 8, 'b-'], [27, 33, 'b-'], [55, 82, 'b-'], [1, 2, 'b-'], [9, 9, 'b+'], [11, 11, 'b+'],
  [4, 3, 'ec'], [19, 21, 'ec'], [26, 29, 'ec'], [98, 154, 'sf'], [94, 145, 'a'], [43, 55, 'b-'], [53, 78, 'b-']];
let n = 0;
for (const bare of [false, true]) for (const [Z, N, mode] of cases) {
  const X = world(3 + n++);
  const { W } = X;
  const p = X.addNuc(Z, N, bare ? 0 : Z, 0, 0);
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  const m = p.nuc.modes.find(q => q.mode === mode);
  if (!m) { bad(`${X.nucSym(Z, N)} has no ${mode} mode`); continue; }
  p.nuc = Object.assign({}, p.nuc, { modes: [Object.assign({}, m, { br: 1 })] });
  const E0 = tot(X), esc0 = W.ledger.escaped;
  const ok = X.doDecay(p);
  if (!ok) { if (!(bare && mode === 'ec' && m.Q < 1.022)) bad(`${X.nucSym(Z, N)} ${mode} did not decay`); continue; }
  const d = tot(X) - E0;
  if (Math.abs(d) > 1e-3 * Math.max(1, m.Q)) bad(`${bare ? 'bare' : 'atom'} ${X.nucSym(Z, N)} ${mode}: energy off by ${d.toFixed(4)} eV`);
  if (!bare && Z === 92 && mode === 'a') {
    const al = W.parts.find(q => !q.dead && q.k === X.NUC && q.Z === 2 && q.N === 2);
    const Ea = al ? X.keOf(al) / 1e6 : 0;
    if (Math.abs(Ea - 4.198) > 0.004) bad(`²³⁸U α energy ${Ea.toFixed(4)} MeV (measured 4.198)`);
  }
  if (mode === 'b-' || mode === 'b+') {
    const l = W.parts.find(q => !q.dead && q.k !== X.NUC && q.id > p.id);
    const T = l ? X.keOf(l) / 1e6 : 0;
    if (!(T > 0) || T > m.Q * 1.0001 + 2e-5) bad(`${X.nucSym(Z, N)} ${mode}: β energy ${T} MeV, end point ${m.Q}`);
  }
  if (mode === 'ec' && !bare) {
    const kx = 0.75 * 13.6057 * Math.pow(Z - 2, 2), rays = W.rays.filter(r => !r.nu), nus = W.rays.filter(r => r.nu);
    if (!rays.some(r => Math.abs(r.E - kx) < 1)) bad(`${X.nucSym(Z, N)} EC: no Kα X-ray of ${kx.toFixed(0)} eV`);
    const Eout = W.ledger.escaped - esc0;
    if (!(nus.length === 1 && Math.abs(Eout - m.Q * 1e6) < 0.01 * m.Q * 1e6)) bad(`${X.nucSym(Z, N)} EC: neutrino + X-ray ${Eout} eV vs Q ${m.Q * 1e6}`);
  }
}
console.log(`${n} forced decays checked`);
// 2. fusion, fission, neutron capture in collisions
{
  let checked = 0;
  for (let s = 0; s < 30 && checked < 12; s++) {
    const X = world(100 + s);
    const { W } = X;
    const d = X.addNuc(1, 1, 0, -0.01, 0), t = X.addNuc(1, 2, 0, 0.01, 0);
    X.setVel(d, 130, 6); X.setVel(t, -90, -4); // about 30 keV between them
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    const E0 = tot(X);
    let fused = false;
    for (let k = 0; k < 400 && !fused; k++) fused = X.tryFusion(d, t); // (about 3% a try at 30 keV)
    if (!fused) continue;
    checked++;
    const dE = tot(X) - E0;
    if (Math.abs(dE) > 0.05) bad(`D + T fusion: energy off by ${dE.toFixed(4)} eV`);
  }
  if (!checked) bad('no D + T fusion happened');
  for (const [Z, N] of [[92, 143], [94, 145]]) {
    const X = world(7);
    const { W } = X;
    const T = X.addNuc(Z, N, Z, 0, 0), nn = X.addNuc(0, 1, 0, 0.5, 0);
    X.setVel(nn, -0.5, 0);
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    const E0 = tot(X);
    X.fission(T, nn, 0.5 * nn.m * 0.25);
    const dE = tot(X) - E0;
    if (Math.abs(dE) > 0.05) bad(`${X.nucSym(Z, N)} + n fission: energy off by ${dE.toFixed(3)} eV`);
  }
  for (const [Z, N] of [[1, 0], [48, 65], [92, 146]]) {
    const X = world(9);
    const { W } = X;
    const T = X.addNuc(Z, N, Z, 0, 0), nn = X.addNuc(0, 1, 0, 0.3, 0);
    X.setVel(nn, -0.2, 0.05);
    X.forcesNoEvents(); W.fSpawn = W.spawned;
    const E0 = tot(X), cap0 = W.count.ncap;
    for (let k = 0; k < 40 && W.count.ncap === cap0 && !nn.dead; k++) X.neutronHit(nn, T);
    if (W.count.ncap === cap0) continue;
    const dE = tot(X) - E0;
    if (Math.abs(dE) > 0.01) bad(`${X.nucSym(Z, N)} + n capture: energy off by ${dE.toFixed(4)} eV`);
  }
  console.log(`${checked} fusions, 2 fissions, neutron captures checked`);
}
// 3. electron binding energies: neutral totals as the reference fit, successive energies increasing with charge
{
  const X = world(1);
  for (const Z of [2, 10, 18, 36, 54, 79, 92]) {
    let s = 0;
    for (let k = 1; k <= Z; k++) { s += X.ionE(Z, k); if (k > 1 && !(X.ionE(Z, k) < X.ionE(Z, k - 1))) bad(`Z=${Z}: ionization energies not increasing with charge at k=${k}`); }
    const ref = Z === 2 ? 79.005 : X.totalBindingE(Z); // (helium: its two measured ionization energies)
    if (Math.abs(s / ref - 1) > 0.03) bad(`Z=${Z}: electrons bound by ${s.toFixed(0)} eV in all (reference ${ref.toFixed(0)})`);
  }
  const u1 = X.ionE(92, 1);
  if (Math.abs(u1 - 132280) > 600) bad(`hydrogen-like uranium binds its electron by ${u1.toFixed(0)} eV (measured 131 800)`);
}
console.log(fails ? `${fails} nuclear failure(s)` : 'nuclear checks passed');
process.exitCode = fails ? 1 : 0;
