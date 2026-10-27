'use strict';
/* Re-settle library molecules on the engine's own forces, from their present drawing, and write their coordinates back
   into src/molecules.gen.js (the generator that made the file, tools/molgen.js, is not in this repository). For a change
   to the force field that moves some molecules' resting shape (0.95: aromatic rings). Run from the repository root:
     node tools/molrelax.js [key …]      (no keys: every molecule with an aromatic ring) */
const fs = require('fs'), path = require('path');
const { load } = require('../tests/load');
const X = load('all', { seed: 1 });
const { W } = X;
const FILE = path.join(__dirname, '..', 'src', 'molecules.gen.js');
let src = fs.readFileSync(FILE, 'utf8');
const keys = process.argv.slice(2);
const r2 = (v) => { const t = Math.round(v * 100) / 100; return Object.is(t, -0) ? 0 : t; };
let n = 0;
for (const key of Object.keys(X.MOLECULES)) {
  const M = X.MOLECULES[key];
  if (keys.length && !keys.includes(key)) continue;
  X.clearWorld(); W.box.w = W.box.tw = 400; W.box.h = W.box.th = 400; W.T = 0; W.gamma = 0; W.wall = 'reflect';
  const ps = X.addMolecule(key, 0, 0, 0, 0);
  if (!ps.length) continue;
  if (!keys.length && !W.bonds.some(b => b.arom)) continue;
  for (const p of ps) { p.vx = 0; p.vy = 0; }
  const nb = W.bonds.length;
  X.mbFire(ps, 6000);
  if (W.bonds.length !== nb || ps.some(p => p.dead)) { console.log(`  ${key}: bonds changed while settling, left as it was`); continue; }
  let cx = 0, cy = 0; for (const p of ps) { cx += p.x; cy += p.y; } cx /= ps.length; cy /= ps.length;
  const atoms = M.atoms.map((a, i) => { const t = a.slice(); t[1] = r2(ps[i].x - cx); t[2] = r2(ps[i].y - cy); return t; });
  const lit = '[' + atoms.map(t => '[' + t.map(v => typeof v === 'string' ? `'${v}'` : v).join(',') + ']').join(',') + ']';
  const at = src.indexOf(`{k:'${key}',`); if (at < 0) { console.log(`  ${key}: not found in the file`); continue; }
  const a0 = src.indexOf(' a:[', at), a1 = src.indexOf('],\n b:', a0);
  if (a0 < 0 || a1 < 0) { console.log(`  ${key}: atoms not found`); continue; }
  src = src.slice(0, a0) + ' a:' + lit + src.slice(a1 + 1);
  n++; console.log(`  ${key}: ${ps.length} atoms settled, aromatic bonds ${W.bonds.filter(b => b.arom).length}`);
}
fs.writeFileSync(FILE, src);
console.log(`${n} molecule(s) rewritten`);
