'use strict';
/* Tiny objects in 3-D for the 3-D lab's library (1.23.2, asked for by the owner: "3-D tiny objects"). Each is built in
   space (a crystal cut, a cluster, a droplet) or taken from the flat object and lifted into 3-D, settled with the
   engine's own 3-D forces (a quench: a strong heat bath cooling it to 1 K), checked to hold together at room
   temperature for 2 ps, and written to src/objects3.gen.js as OBJECT3_LIB (the flat library's format, with z: each
   atom's depth). Run from the repository root:  node tools/objgen3.js [key …] [--quick]
   Left out, with the reason in PERF-NOTES (1.23.2): the chips (transistor, inverter, memory cells: their wiring is
   flat-only, chips.js), the quantum dot (InP's zincblende needs four bonds an atom; the engine's In and P make three),
   the membrane (a 3-D bilayer patch would be thousands of atoms), and the folded biomolecules (DNA, the WW domain,
   chignolin, oxytocin: their 3-D folds need measured coordinates; a flat drawing relaxed in space is not the fold). */
const fs = require('fs'), path = require('path');
const { load } = require('../tests/load');
const X = load('all', { seed: 3 });
const { W } = X;
const args = process.argv.slice(2), quick = args.includes('--quick'), only = args.filter(a => !a.startsWith('--'));
const OUT = path.join(__dirname, '..', 'src', 'objects3.gen.js');

function world(L) { X.baseWorld(L, L, 1, 0.5); X.world3d(L); W.decayOn = false; W.wall = 'reflect'; }
function centred(ps) {
  let cx = 0, cy = 0, cz = 0; for (const p of ps) { cx += p.x; cy += p.y; cz += p.z; } cx /= ps.length; cy /= ps.length; cz /= ps.length;
  return ps.map(p => [p.x - cx, p.y - cy, p.z - cz]);
}
const run = (n) => { for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); } };
/* Settle: a quench in a strong bath from room temperature to 1 K (the shape the forces hold), then the atoms at rest. */
function quench(ps, steps) {
  W.T = 300; W.gamma = 0.5; run(quick ? 100 : steps / 2);
  W.T = 1; W.gamma = 1; run(quick ? 100 : steps / 2);
  for (const p of ps) { p.vx = 0; p.vy = 0; p.vz = 0; }
}
/* Room temperature for 2 ps in good thermal contact: same atoms and bonds, nothing drifted off. */
function hold(o) {
  world(o.L);
  const ps = o.atoms.map((a, i) => X.addAtom(a[0], o.xyz[i][0], o.xyz[i][1], { charge: a[3] || 0, T: 0, z: o.xyz[i][2] }));
  for (const [i, j, k] of o.bonds) X.addBond(ps[i], ps[j], k);
  X.forcesNoEvents(); W.fSpawn = W.spawned; W.T = 300; W.gamma = 0.05;
  const nb0 = W.bonds.length, t0 = W.t;
  while (W.t - t0 < (quick ? 20 : 200)) run(50);
  const alive = W.parts.filter(p => !p.dead), atoms = alive.filter(p => p.k === X.NUC);
  const reach0 = Math.max(...o.xyz.map(([x, y, z]) => Math.hypot(x, y, z))), c = centred(atoms), reach = Math.max(...c.map(([x, y, z]) => Math.hypot(x, y, z)));
  let ke = 0; for (const p of atoms) ke += 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
  const ok = atoms.length === o.atoms.length && alive.length === atoms.length && W.bonds.length === nb0 && reach < reach0 + 4;
  console.log(`  ${o.k} at 300 K for ${((W.t - t0) * 10.18 / 1000).toFixed(1)} ps: ${ok ? 'held' : 'CHANGED'} — ${atoms.length}/${o.atoms.length} atoms, ${W.bonds.length}/${nb0} bonds, ${(ke / (1.5 * atoms.length * X.PHYS.KB)).toFixed(0)} K, reach ${reach0.toFixed(1)} → ${reach.toFixed(1)} Å`);
  return ok;
}
/* From atoms put down in a world: the entry's atoms (as the flat library's), bonds and depths. */
function record(o, ps) {
  const ix = new Map(ps.map((p, i) => [p, i]));
  o.atoms = ps.map(p => { const r = [p.el.sym, 0, 0]; if (p.q) r.push(Math.round(p.q)); return r; });
  o.bonds = []; for (const bd of W.bonds) if (ix.has(bd.a) && ix.has(bd.b)) o.bonds.push([ix.get(bd.a), ix.get(bd.b), bd.order]);
  o.xyz = centred(ps);
}

const OBJ = [];
OBJ.push(() => { // a cube of table salt
  const o = { k: 'saltcrystal3', n: 'Salt crystal (3-D)', L: 40, d: 'Table salt in 3-D: a cube of 216 sodium and chloride ions, six on a side, 1.7 nm across, in the rock-salt pattern every grain of salt has: each ion has six of the other kind around it. Held together only by their charges. A grain from a shaker is about 300,000 times wider.' };
  world(o.L); const n = 6, a = 2.82, ps = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let l = 0; l < n; l++) { const na = (i + j + l) % 2 === 0; ps.push(X.addAtom(na ? 'Na' : 'Cl', (i - (n - 1) / 2) * a, (j - (n - 1) / 2) * a, { charge: na ? 1 : -1, T: 0, z: (l - (n - 1) / 2) * a })); }
  X.forcesNoEvents(); quench(ps, 1200); record(o, ps); return o;
});
OBJ.push(() => { // a gold cluster, an fcc cuboctahedron
  const o = { k: 'goldnano3', n: 'Gold nanoparticle (3-D)', L: 40, d: 'A gold nanoparticle in 3-D: 147 atoms packed as in a gold crystal (face-centred cubic) and cut into a cuboctahedron 1.6 nm across, one of the "magic" sizes gold clusters like to take. The red line on a pregnancy or COVID test is made of particles like this one, about ten times wider.' };
  world(o.L); const a = 4.08, pts = [];
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) for (let l = -4; l <= 4; l++) {
    if ((i + j + l) % 2 !== 0) continue; // (fcc: the points of the cubic lattice with an even coordinate sum, spacing a/2)
    const x = i * a / 2, y = j * a / 2, z = l * a / 2, s = Math.abs(i) + Math.abs(j) + Math.abs(l), m = Math.max(Math.abs(i), Math.abs(j), Math.abs(l));
    if (s <= 6 && m <= 3) pts.push([x, y, z]); // (a cuboctahedron of three shells round the centre, in half-steps: 1 + 12 + 42 + 92 = 147 sites)
  }
  const ps = pts.map(([x, y, z]) => X.addAtom('Au', x, y, { T: 0, z }));
  X.forcesNoEvents(); quench(ps, 1200); record(o, ps); return o;
});
OBJ.push(() => { // a water droplet in 3-D
  const o = { k: 'waterdrop3', n: 'Water droplet (3-D)', L: 40, d: 'A droplet of water in 3-D: 123 molecules in a ball 2 nm across, tumbling and swapping hydrogen bonds. A droplet of fog is about 10 µm across and holds some 2×10¹³ molecules; a raindrop, 10²⁰. Warm it and molecules evaporate off its surface.' };
  world(o.L); const d = 3.1, R = 9.6, ps = [];
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) for (let l = -4; l <= 4; l++) {
    const x = i * d, y = j * d, z = l * d; if (Math.hypot(x, y, z) > R) continue;
    for (const p of X.addMolecule('H2O', x, y, X.rnd() * 6, 0, z)) ps.push(p);
  }
  X.forcesNoEvents(); quench(ps, 2400); record(o, ps); return o;
});
/* the flat object lifted into space and relaxed there (place3), then quenched with every force */
const lifted = (k2, k3, n, d, L = 50) => () => {
  const o = { k: k3, n, L, d };
  world(o.L); const ps = X.addMolecule(k2, 0, 0, 0, 0, 0);
  X.forcesNoEvents(); quench(ps, 1600); record(o, ps); return o;
};
OBJ.push(lifted('graphene', 'graphene3', 'Graphene flake (3-D)', 'One sheet of graphite in 3-D: 216 carbon atoms in a flat honeycomb 2.6 nm across, edged with hydrogen. A sheet of graphene is flat in space too: one atom thick, its π bonds keep it flat (it ripples a little when warm). Pencil lead is stacks of these sheets, 0.34 nm apart.'));
OBJ.push(lifted('polyethylene', 'polyethylene3', 'Polyethylene (3-D)', 'One molecule of polyethylene in 3-D: a chain of 78 carbons, each with its two hydrogens above and below the zigzag of the chain, folded back and forth as the chains lie in the plastic\'s crystals. In 3-D each carbon is a tetrahedron, as in the real plastic.'));
OBJ.push(lifted('kevlar', 'kevlar3', 'Kevlar (3-D)', 'Two chains of Kevlar in 3-D: benzene rings linked by amide groups into stiff rods 4 nm long, held side by side by hydrogen bonds between their N–H and C=O groups. Weight for weight a Kevlar fibre is about five times stronger than steel.'));

const r2 = (v) => Math.round(v * 100) / 100;
function entry(o) {
  const a = o.atoms.map((at, i) => `['${at[0]}',${r2(o.xyz[i][0])},${r2(o.xyz[i][1])}${at[3] ? ',' + at[3] : ''}]`).join(',');
  const b = o.bonds.map(([i, j, k]) => `[${i},${j},${k}]`).join(',');
  return `{k:'${o.k}',n:${JSON.stringify(o.n)},c:'objects',d:${JSON.stringify(o.d)},\n a:[${a}],\n b:[${b}],\n z:[${o.xyz.map(p => r2(p[2])).join(',')}]}`;
}
const old = new Map();
if (fs.existsSync(OUT)) { const src = fs.readFileSync(OUT, 'utf8'); for (const m of src.matchAll(/^\{k:'([^']+)'[\s\S]*?\]\}(?=,?\n)/gm)) old.set(m[1], m[0]); }
const entries = []; let fails = 0;
for (const make of OBJ) {
  const t0 = Date.now(), o = make();
  if (only.length && !only.includes(o.k)) { if (old.has(o.k)) entries.push(old.get(o.k)); continue; }
  console.log(`${o.k}: ${o.n}: ${o.atoms.length} atoms, ${o.bonds.length} bonds, settled in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (!hold(o)) fails++;
  entries.push(entry(o));
}
const head = `'use strict';
/* Tiny objects in 3-D for the 3-D lab's library (1.23.2), generated by tools/objgen3.js: edit that and rerun, not this
   file. The flat library's format (k key, n name, c category, d note, a atoms [symbol, x, y, formal charge] in Å, b
   bonds [i, j, order]) with z, each atom's depth in Å. Each was settled with the engine's own 3-D forces and checked to
   hold together at room temperature. Shown only in the 3-D lab (molFits). */
const OBJECT3_LIB = [
`;
if (!args.includes('--dry')) fs.writeFileSync(OUT, head + entries.join(',\n') + '\n];\nif (typeof module !== \'undefined\') module.exports = { OBJECT3_LIB };\n');
console.log(fails ? `${fails} object(s) did not hold` : 'all held');
process.exitCode = fails ? 1 : 0;
