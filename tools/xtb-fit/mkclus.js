'use strict';
// Invariance clusters for the second GFN2 refit (1.26): water clusters and hetero dimers NOT from WATER27/S22, built from
// seeded random packings and optimized with plain GFN2; their GFN2 binding energies are what the refit must keep.
// node mkclus.js -> inv.json { species: {key: {Z, xyz, charge}}, rx: [{name, sp: [[key, coef]], ref}] }
const fs = require('fs');
const X = require('./xm.js');
const D = require('./fitdata.json');
let seed = 12345; const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; // (mulberry32)
const V = { base: 2 };
const W = D.species['W4-11/h2o'];
const opt = (Z, xyz, charge) => X.opt(x => X.E(V, Z, x, charge, 0, true), xyz, { maxSteps: 400, gtol: 3e-3 });
const mono = {};
function monoOf(name, charge = 0) {
  if (mono[name]) return mono[name];
  const s = name === 'h3o+' ? { Z: [8, 1, 1, 1], xyz: [[0, 0, 0.1], [0.95, 0, -0.2], [-0.47, 0.82, -0.2], [-0.47, -0.82, -0.2]] } : name === 'oh-' ? { Z: [8, 1], xyz: [[0, 0, 0], [0.97, 0, 0]] } : name === 'formamide' ? { Z: [6, 8, 7, 1, 1, 1], xyz: [[0, 0.418, 0], [1.206, 0.531, 0], [-0.693, -0.749, 0], [-0.588, 1.355, 0], [-0.2, -1.63, 0], [-1.7, -0.75, 0]] } : D.species['W4-11/' + name];
  const o = opt(s.Z, s.xyz, charge); return (mono[name] = { Z: s.Z, xyz: o.xyz, E: o.E, charge });
}
function rot(xyz) {
  const a = rnd() * 2 * Math.PI, b = Math.acos(2 * rnd() - 1), c = rnd() * 2 * Math.PI;
  const R = (v) => { let [x, y, z] = v; [x, y] = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]; [y, z] = [y * Math.cos(b) - z * Math.sin(b), y * Math.sin(b) + z * Math.cos(b)]; [x, y] = [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)]; return [x, y, z]; };
  const c0 = [0, 1, 2].map(k => xyz[0][k]); return xyz.map(p => R(p.map((v, k) => v - c0[k])));
}
function pack(list) { // list of monomer names; random positions in a sphere at ~30 A^3 per molecule, centres >= 2.7 A apart
  const n = list.length, Rs = Math.cbrt(3 * 30 * n / (4 * Math.PI)), cen = [];
  while (cen.length < n) { const p = [0, 1, 2].map(() => (2 * rnd() - 1) * Rs); if (Math.hypot(...p) > Rs) continue; if (cen.some(q => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 2.75)) continue; cen.push(p); }
  const Z = [], xyz = []; let charge = 0;
  list.forEach((nm, i) => { const m = monoOf(nm, nm === 'h3o+' ? 1 : nm === 'oh-' ? -1 : 0); charge += m.charge; for (const [k, p] of rot(m.xyz).entries()) { Z.push(m.Z[k]); xyz.push(p.map((v, c) => v + cen[i][c])); } });
  return { Z, xyz, charge };
}
const out = { species: {}, rx: [] };
const ONLY = process.argv[2] ? process.argv[2].split(',') : null;
const jobs = [
  ['w10', Array(10).fill('h2o')], ['w16', Array(16).fill('h2o')], ['w20', Array(20).fill('h2o')], ['w20b', Array(20).fill('h2o')],
  ['h3o+w8', ['h3o+', ...Array(8).fill('h2o')]], ['oh-w8', ['oh-', ...Array(8).fill('h2o')]],
  ['nh3-w', ['nh3', 'h2o']], ['h2co-w', ['h2co', 'h2o']], ['ch4-w', ['ch4', 'h2o']], ['hcn-w', ['hcn', 'h2o']], ['meoh-w', ['methanol', 'h2o']],
  ['formic-w2', ['formic', 'h2o', 'h2o']], ['nh3-w4', ['nh3', 'h2o', 'h2o', 'h2o', 'h2o']], ['meoh3', ['methanol', 'methanol', 'methanol']],
  // (added in a second run, node mkclus.js c2h6-c2h6,propene2,c2h2-ch4,acet-c2h4,nccn-c2h6,ketene-nh3: dispersion-bound pairs)
  // (and a third: N-H...O=C and imine/amine hydrogen bonds, after the refit lost amide pairs: node mkclus.js fmd-w,fmd-h2co,fmd-acet,ch2nh-w,ch3nh2-w,hnco-w,fmd-nh3)
  ['fmd-w', ['formamide', 'h2o']], ['fmd-h2co', ['formamide', 'h2co']], ['fmd-acet', ['formamide', 'acetaldehyde']], ['ch2nh-w', ['ch2nh', 'h2o']], ['ch3nh2-w', ['ch3nh2', 'h2o']], ['hnco-w', ['hnco', 'h2o']], ['fmd-nh3', ['formamide', 'nh3']],
  ['c2h6-c2h6', ['c2h6', 'c2h6']], ['propene2', ['propene', 'propene']], ['c2h2-ch4', ['c2h2', 'ch4']], ['acet-c2h4', ['acetaldehyde', 'c2h4']], ['nccn-c2h6', ['nccn', 'c2h6']], ['ketene-nh3', ['ketene', 'nh3']],
];
const prev = ONLY && fs.existsSync(require('path').join(__dirname, 'inv.json')) ? JSON.parse(fs.readFileSync(require('path').join(__dirname, 'inv.json'), 'utf8')) : null; if (prev) { Object.assign(out.species, prev.species); out.rx.push(...prev.rx); }
for (const [name, list] of jobs) {
  if (ONLY && !ONLY.includes(name)) continue;
  const t0 = Date.now();
  let best = null;
  for (let tr = 0; tr < (list.length <= 3 ? 4 : 1); tr++) { // (small ones: a few random starts, keep the lowest)
    const p = pack(list), o = opt(p.Z, p.xyz, p.charge);
    if (!best || o.E < best.E) best = { ...p, xyz: o.xyz, E: o.E, gmax: o.gmax };
  }
  const key = 'inv/' + name; out.species[key] = { Z: best.Z, xyz: best.xyz, charge: best.charge, uhf: 0 };
  const sp = [[key, -1]]; const cnt = {}; for (const nm of list) cnt[nm] = (cnt[nm] || 0) + 1;
  let Em = 0; for (const [nm, c] of Object.entries(cnt)) { const m = monoOf(nm); const mk = 'inv/m-' + nm; out.species[mk] = { Z: m.Z, xyz: m.xyz, charge: m.charge, uhf: 0 }; sp.push([mk, c]); Em += c * m.E; }
  out.rx.push({ name, sp, ref: Em - best.E });
  fs.writeFileSync(require('path').join(__dirname, 'inv.part.json'), JSON.stringify(out));
  console.log(name, best.Z.length, 'atoms, binding', (Em - best.E).toFixed(3), 'eV, gmax', best.gmax.toExponential(1), ((Date.now() - t0) / 1000).toFixed(0) + ' s');
}
out.rx = out.rx.filter(r => r.name !== 'nccn-c2h6'); delete out.species['inv/nccn-c2h6']; // (it reacted from its random start: 1.1 eV "bound")
fs.writeFileSync(require('path').join(__dirname, 'inv.json'), JSON.stringify(out));
