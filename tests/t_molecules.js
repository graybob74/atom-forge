'use strict';
/* Every library molecule, put down alone and cold, must hold together (same atoms, same bonds) and be named
   as the library names it; its net charge must be the library's. node tests/t_molecules.js [frames] */
const { load } = require('./load');
const F = +(process.argv[2] || 150);
const X = load(undefined, { seed: 4 });
const { W } = X;
let fails = 0, n = 0;
const bad = (m) => { fails++; if (fails <= 40) console.log('FAIL', m); };
const t0 = Date.now();
for (const key of Object.keys(X.MOLECULES)) {
  const M = X.MOLECULES[key];
  const ext = (k) => Math.max(...M.atoms.map(a => a[k])) - Math.min(...M.atoms.map(a => a[k])); // (a box with room for the big objects)
  X.clearWorld(); W.box.w = W.box.tw = Math.max(60, ext(1) + 24); W.box.h = W.box.th = Math.max(60, ext(2) + 24); W.T = 5; W.gamma = 1; W.wall = 'reflect'; W.decayOn = false;
  const atoms = X.addMolecule(key, 0, 0, M.cat === 'objects' ? 0 : 0.4, 5); // (objects go down as drawn)
  if (!atoms.length) { bad(`${key}: not placed`); continue; }
  n++;
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  const nb0 = W.bonds.length, q0 = atoms.reduce((s, a) => s + a.q, 0), qLib = M.atoms.reduce((s, a) => s + (a[3] || 0), 0);
  if (Math.abs(q0 - qLib) > 1e-9) bad(`${key} (${M.name}): charge ${q0}, library ${qLib}`);
  const ionic = X.molecule(atoms[0]).length !== atoms.length; // separate ions (NaCl, NaOH …): named as ions once placed
  const name0 = X.moleculeName(atoms);
  if (!ionic && name0 !== M.name) bad(`${key}: named ${name0}, library says ${M.name}`);
  for (let f = 0; f < F; f++) X.simFrame(1 / 60, 40);
  const alive = W.parts.filter(p => !p.dead);
  const freed = alive.filter(p => p.k !== X.NUC).length;
  if (alive.length !== atoms.length || W.bonds.length !== nb0 || freed) {
    bad(`${key} (${M.name}): ${atoms.length} atoms/${nb0} bonds became ${alive.length - freed} atoms/${W.bonds.length} bonds${freed ? ` and ${freed} free electrons` : ''}; ${W.log.slice(-3).map(l => l.text).join(' | ')}`);
    continue;
  }
  const name1 = ionic ? M.name : X.moleculeName(X.molecule(atoms[0]));
  if (name1 !== M.name) bad(`${key}: renamed ${name1} after ${F} frames (library ${M.name})`);
}
console.log(`${n} library molecules checked in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(fails ? `${fails} molecule failure(s)` : 'molecule checks passed');
process.exitCode = fails ? 1 : 0;
