'use strict';
// Vertical ionization energies of donors and electron affinities of acceptors (at W4-11's geometries), plain GFN2 with
// spins: the refit keeps them, so charge does not slosh between O2 and its neighbours more than with GFN2 (1.26).
// node mkipea.js -> ipea.json { species, rx } (as inv.json)
const fs = require('fs'), X = require('./xm.js'), D = require('./fitdata.json');
const V = { base: 2, spin: true };
const out = { species: {}, rx: [] };
const UHF = { o2: 2, no2: 1, oh: 1 };
for (const [nm, dq] of [['h2o', 1], ['ch4', 1], ['nh3', 1], ['methanol', 1], ['c2h4', 1], ['h2co', 1], ['o2', -1], ['o3', -1], ['no2', -1], ['oh', -1], ['h2o', -1]]) {
  const s = D.species['W4-11/' + nm], u0 = UHF[nm] || 0, u1 = u0 ? u0 - 1 : 1;
  const k0 = 'W4-11/' + nm, k1 = 'ion/' + nm + (dq > 0 ? '+' : '-');
  out.species[k1] = { Z: s.Z, xyz: s.xyz, charge: dq, uhf: u1 };
  const e0 = X.E(V, s.Z, s.xyz, 0, u0).E, e1 = X.E(V, s.Z, s.xyz, dq, u1).E;
  out.rx.push({ name: nm + (dq > 0 ? ' IP' : ' EA'), sp: [[k0, -1], [k1, 1]], ref: e1 - e0, ipea: true });
  console.log(nm, dq > 0 ? 'IP' : 'EA(-)', (e1 - e0).toFixed(3));
}
fs.writeFileSync(require('path').join(__dirname, 'ipea.json'), JSON.stringify(out));
