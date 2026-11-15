'use strict';
/* Tiny objects in 3-D for the 3-D lab's library (1.23.2, asked for by the owner: "3-D tiny objects"). Each is built in
   space (a crystal cut, a cluster, a droplet) or taken from the flat object and lifted into 3-D, settled with the
   engine's own 3-D forces (a quench: a strong heat bath cooling it to 1 K), checked to hold together at room
   temperature for 2 ps, and written to src/objects3.gen.js as OBJECT3_LIB (the flat library's format, with z: each
   atom's depth). Run from the repository root:  node tools/objgen3.js [key …] [--quick]
   Left out, with the reason in PERF-NOTES (1.23.2): the chips (transistor, inverter, memory cells: their wiring is
   flat-only, chips.js), Kevlar and cellulose (rods 3.3–4.8 nm long: longer than the 3-D lab's cubes, which keep their
   size until box sizes come to 3-D), the quantum dot (InP's zincblende needs four bonds an atom; the engine's In and P make three),
   the membrane (a 3-D bilayer patch would be thousands of atoms), and the folded biomolecules (the WW domain,
   chignolin, oxytocin: their 3-D folds need measured coordinates; a flat drawing relaxed in space is not the fold).
   DNA (1.33.2) is the exception: its double helix is regular, B-DNA's rise and twist (dna3 below). */
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
/* Turned so its longest extent lies along x, the next along y and its thinnest along z (the principal axes of its
   spread, by Jacobi rotations): it then fits the 3-D lab's cubes (22–36 Å, fixed until box sizes come to 3-D) as
   well as it can, and a flat sheet faces the starting view. */
function aligned(xyz) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const v of xyz) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += v[i] * v[j];
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], A = C.map(r => r.slice());
  for (let sweep = 0; sweep < 30; sweep++) for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) {
    if (Math.abs(A[p][q]) < 1e-12) continue;
    const th = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]), c = Math.cos(th), s = Math.sin(th);
    for (let k = 0; k < 3; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
    for (let k = 0; k < 3; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
    for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
  }
  const ord = [0, 1, 2].sort((a, b) => A[b][b] - A[a][a]); // (largest spread first)
  const ax = ord.map(i => [V[0][i], V[1][i], V[2][i]]);
  const cr = [ax[0][1] * ax[1][2] - ax[0][2] * ax[1][1], ax[0][2] * ax[1][0] - ax[0][0] * ax[1][2], ax[0][0] * ax[1][1] - ax[0][1] * ax[1][0]];
  ax[2] = cr; // (right-handed: a turn, not a mirror image, so chiral molecules keep their hand)
  return xyz.map(v => ax.map(a => a[0] * v[0] + a[1] * v[1] + a[2] * v[2]));
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
  o.xyz = aligned(centred(ps));
  const ext = [0, 1, 2].map(i => Math.max(...o.xyz.map(v => v[i])) - Math.min(...o.xyz.map(v => v[i])));
  console.log(`    extent ${ext.map(e => e.toFixed(1)).join(' × ')} Å`);
}

/* How helical a DNA build is: each base pair's line between its two C1' atoms (paired by order along the axis), seen
   down the axis (the long axis of the C1' atoms' spread), the turn from one to the next and the mean rise. */
function dnaTwist(xyz, c1i) {
  const P = c1i.map(i => xyz[i]), ax = aligned(P.map(p => p.slice()))[0] && (() => { // (the axis: the C1' atoms' long direction)
    let m = [0, 0, 0]; for (const p of P) for (let q = 0; q < 3; q++) m[q] += p[q] / P.length;
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const p of P) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += (p[i] - m[i]) * (p[j] - m[j]);
    let v = [1, 0.3, 0.2]; for (let it = 0; it < 100; it++) { const w = [0, 1, 2].map(i => C[i][0] * v[0] + C[i][1] * v[1] + C[i][2] * v[2]); const l = Math.hypot(...w); v = w.map(x => x / l); } return v; })();
  const along = (p) => p[0] * ax[0] + p[1] * ax[1] + p[2] * ax[2];
  const ord = P.map((p, i) => [along(p), i]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  const pairs = []; for (let i = 0; i + 1 < ord.length; i += 2) pairs.push([P[ord[i]], P[ord[i + 1]]]);
  const perp = (d) => { const t = d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2]; return [d[0] - t * ax[0], d[1] - t * ax[1], d[2] - t * ax[2]]; };
  const twist = [], rises = [];
  for (let k = 0; k + 1 < pairs.length; k++) {
    const a = perp(pairs[k][1].map((v, q) => v - pairs[k][0][q])), b = perp(pairs[k + 1][1].map((v, q) => v - pairs[k + 1][0][q]));
    const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
    let ang = Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI; if (ang > 90) ang = 180 - ang; // (the two C1' of a pair may come in either order)
    twist.push(ang);
    rises.push(Math.abs((along(pairs[k + 1][0]) + along(pairs[k + 1][1])) / 2 - (along(pairs[k][0]) + along(pairs[k][1])) / 2));
  }
  return { twist, rise: rises.reduce((u, v) => u + v, 0) / rises.length };
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
OBJ.push(() => { // a graphene flake, five rings to a side (the flat game's six would not fit a 30 Å cube)
  const o = { k: 'graphene3', n: 'Graphene flake (3-D)', L: 50, d: 'One sheet of graphite in 3-D: 150 carbon atoms in a flat honeycomb 2.1 nm across, edged with hydrogen. Graphene is flat in space too, one atom thick: its π bonds hold it flat, and it ripples a little when warm. Pencil lead is stacks of these sheets, 0.34 nm apart; a single sheet is the strongest material ever measured.' };
  world(o.L); const s = 1.42, k = 5, key = (x, y) => Math.round(x * 100) + ',' + Math.round(y * 100), at = new Map(), C = [], edges = new Set();
  for (let q = -(k - 1); q <= k - 1; q++) for (let r = -(k - 1); r <= k - 1; r++) {
    if (Math.abs(q + r) > k - 1) continue;
    const cx = Math.sqrt(3) * s * (q + r / 2), cy = 1.5 * s * r, vs = [];
    for (let m = 0; m < 6; m++) { const t = Math.PI / 6 + m * Math.PI / 3, x = cx + s * Math.cos(t), y = cy + s * Math.sin(t), kk = key(x, y); if (!at.has(kk)) { at.set(kk, C.length); C.push([x, y]); } vs.push(at.get(kk)); }
    for (let m = 0; m < 6; m++) { const u = vs[m], v = vs[(m + 1) % 6]; edges.add(Math.min(u, v) + '-' + Math.max(u, v)); }
  }
  const E = [...edges].map(e => e.split('-').map(Number)), nC = C.length, adj = Array.from({ length: nC }, () => []);
  for (const [u, v] of E) { adj[u].push(v); adj[v].push(u); }
  const side = new Array(nC).fill(-1); side[0] = 0; const st = [0]; while (st.length) { const u = st.pop(); for (const v of adj[u]) if (side[v] < 0) { side[v] = 1 - side[u]; st.push(v); } }
  const mate = new Array(nC).fill(-1), aug = (u, seen) => { for (const v of adj[u]) { if (seen.has(v)) continue; seen.add(v); if (mate[v] < 0 || aug(mate[v], seen)) { mate[u] = v; mate[v] = u; return true; } } return false; };
  for (let u = 0; u < nC; u++) if (side[u] === 0 && mate[u] < 0) aug(u, new Set());
  if (mate.some(m => m < 0)) throw new Error('graphene3: no Kekulé structure');
  const ps = C.map(([x, y]) => X.addAtom('C', x, y, { T: 0, z: 0 }));
  for (const [u, v] of E) X.addBond(ps[u], ps[v], mate[u] === v ? 2 : 1);
  const hl = X.bondLength(X.ELEMENTS[6], X.ELEMENTS[1], 1);
  for (let i = 0; i < nC; i++) if (adj[i].length === 2) { // (an edge carbon: a hydrogen outward, between its two bonds)
    const [a, b] = adj[i], ux = 2 * C[i][0] - C[a][0] - C[b][0], uy = 2 * C[i][1] - C[a][1] - C[b][1], L = Math.hypot(ux, uy);
    const h = X.addAtom('H', C[i][0] + hl * ux / L, C[i][1] + hl * uy / L, { T: 0, z: 0 }); X.addBond(ps[i], h, 1); ps.push(h);
  }
  for (const p of ps) p.z += 0.02 * (X.rnd() - 0.5); // (a hair off the plane: it may ripple, and stays flat if it would)
  X.forcesNoEvents(); quench(ps, 1600); record(o, ps); return o;
});
/* DNA as a double helix (1.33.2, the owner: "I asked Claude to generate a double helix of DNA … I want it as a helix in
   3-D"). The flat object's eight base pairs, each with its two sugars and the phosphates nearest it, taken as a slab and
   stacked as B-DNA stacks them: each slab square to the helix's axis, 3.38 Å above the last and turned 36° further
   round (ten base pairs a turn, right-handed), the ladder's across-direction pointing out from the axis, its along-
   direction round it; then settled with the engine's own 3-D forces (the phosphate links between slabs, stretched by
   the stacking, pull to their length there). B-DNA's measured rise and twist, not a fold found by the force field. */
OBJ.push(() => {
  const o = { k: 'dna3', n: 'DNA double helix (3-D)', L: 60, d: 'The same eight rungs of DNA as the flat game\'s (GATTACAG along one strand), wound into the double helix: the base pairs stacked 0.34 nm apart and each turned 36° from the last, ten to a full turn, with the two sugar-phosphate backbones spiralling round the outside. That is the B form, the shape Watson and Crick found in 1953 from Rosalind Franklin\'s X-ray pictures. Eight rungs make most of one turn; the DNA in one of your cells has three billion of them.' };
  world(o.L);
  const M = X.MOLECULES.dna, A = M.atoms;
  // the ladder's long axis (x') and across (y'), from the spread of its atoms
  let cx = 0, cy = 0; for (const a of A) { cx += a[1]; cy += a[2]; } cx /= A.length; cy /= A.length;
  let sxx = 0, syy = 0, sxy = 0; for (const a of A) { const x = a[1] - cx, y = a[2] - cy; sxx += x * x; syy += y * y; sxy += x * y; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), c = Math.cos(th), s = Math.sin(th);
  const L2 = A.map(a => { const x = a[1] - cx, y = a[2] - cy; return [x * c + y * s, -x * s + y * c]; });
  // the rungs: each base pair's two C1' atoms (the sugar carbon bonded to the base: neighbours N, O, C and H), paired along x'
  const nb = A.map(() => []); for (const [i, j] of M.bonds) { nb[i].push(A[j][0]); nb[j].push(A[i][0]); }
  const c1 = A.map((a, i) => i).filter(i => A[i][0] === 'C' && ['N', 'O', 'C', 'H'].every(e => nb[i].includes(e))).map(i => L2[i][0]).sort((a, b) => a - b);
  const rc = []; for (let i = 0; i + 1 < c1.length; i += 2) rc.push((c1[i] + c1[i + 1]) / 2);
  if (rc.length !== 8) throw new Error(`dna3: ${rc.length} rungs found, not 8`);
  const RISE = 3.38, TW = 36 * Math.PI / 180;
  // the bases: what stays joined when each C1'–N (glycosidic) bond is cut and the backbones are left out; each a rigid
  // slab with its pair, turned with its rung; everything else (sugars, phosphates, their caps) wound on continuously
  const c1i = A.map((a, i) => i).filter(i => A[i][0] === 'C' && ['N', 'O', 'C', 'H'].every(e => nb[i].includes(e)));
  const adj = A.map(() => []); for (const [i, j] of M.bonds) { adj[i].push(j); adj[j].push(i); }
  const isBase = new Array(A.length).fill(false), baseK = new Array(A.length).fill(-1);
  for (const c of c1i) for (const n0 of adj[c]) {
    if (A[n0][0] !== 'N') continue;
    const comp = [n0], seen = new Set([c, n0]);
    for (let q = 0; q < comp.length; q++) for (const v of adj[comp[q]]) if (!seen.has(v)) { seen.add(v); comp.push(v); }
    if (comp.length > 40) continue; // (not a base: the walk got into the backbone)
    let mx = 0; for (const i of comp) mx += L2[i][0]; mx /= comp.length;
    let k = 0; for (let j = 1; j < 8; j++) if (Math.abs(mx - rc[j]) < Math.abs(mx - rc[k])) k = j;
    for (const i of comp) { isBase[i] = true; baseK[i] = k; }
  }
  const kOf = [];
  const ps = A.map((a, i) => {
    const [x, y] = L2[i]; let k = 0; for (let j = 1; j < rc.length; j++) if (Math.abs(x - rc[j]) < Math.abs(x - rc[k])) k = j; if (isBase[i]) k = baseK[i]; kOf[i] = k;
    const dx = x - rc[k], t = k * TW, ux = [Math.cos(t), Math.sin(t)], vx = [-Math.sin(t), Math.cos(t)];
    const pr = [(k - 3.5) * RISE, y * ux[0] + dx * vx[0], y * ux[1] + dx * vx[1]]; // (the base pair's slab, rigid)
    // (the backbones, out from 4–7 Å: wound on continuously, the rung number interpolated along x', so the links
    // between slabs have no seam; a rigid slab turned its lower strand's tangential offsets the wrong way round)
    let kc; if (x <= rc[0]) kc = (x - rc[0]) / (rc[1] - rc[0]); else if (x >= rc[7]) kc = 7 + (x - rc[7]) / (rc[7] - rc[6]); else { let j = 0; while (x > rc[j + 1]) j++; kc = j + (x - rc[j]) / (rc[j + 1] - rc[j]); }
    const tc = kc * TW, pc = [(kc - 3.5) * RISE, y * Math.cos(tc), y * Math.sin(tc)];
    const w = isBase[i] ? 0 : 1;
    const p = pr.map((v, q) => v + (pc[q] - v) * w);
    return X.addAtom(a[0], p[0], p[1], { charge: a[3] || 0, T: 0, z: p[2] });
  });
  for (const [i, j, k] of M.bonds) X.addBond(ps[i], ps[j], k);
  const diag = (tag) => { if (!process.env.DNA_DIAG) return; let worst = 0, close = 9, wb = null; for (const bd of W.bonds) { const f = Math.hypot(bd.a.x - bd.b.x, bd.a.y - bd.b.y, bd.a.z - bd.b.z) / bd.r0; if (f > worst) { worst = f; wb = bd; } } if (wb) console.log('    worst', wb.a.el.sym, ps.indexOf(wb.a), wb.b.el.sym, ps.indexOf(wb.b), 'r0', wb.r0.toFixed(2), 'order', wb.order);
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) { const a = ps[i], b = ps[j]; if (a.bonds.some(bd => bd.a === b || bd.b === b)) continue; close = Math.min(close, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)); }
    console.log(`    ${tag}: worst bond ${worst.toFixed(2)}× its length, closest unbonded pair ${close.toFixed(2)} Å`); };
  diag('stacked');
  if (process.env.DNA_DIAG) { console.log('    rungs at', rc.map(v => v.toFixed(1)).join(' ')); for (const [i, j] of M.bonds) if (Math.abs(kOf[i] - kOf[j]) > 1) console.log('    far bond', A[i][0], i, kOf[i], L2[i].map(v => v.toFixed(1)).join(','), '—', A[j][0], j, kOf[j], L2[j].map(v => v.toFixed(1)).join(',')); }
  X.relax3(ps, 1500); // (the links between slabs to their length first, by bonded terms alone)
  diag('relaxed');
  X.forcesNoEvents(); quench(ps, 2400); diag('quenched'); record(o, ps);
  const tw = dnaTwist(o.xyz, c1i, rc.length);
  console.log(`    helix: ${tw.twist.map(v => v.toFixed(0)).join('/')}° a step (B-DNA 36°), rise ${tw.rise.toFixed(2)} Å (3.38)`);
  return o;
});
OBJ.push(lifted('polyethylene', 'polyethylene3', 'Polyethylene (3-D)', 'One molecule of polyethylene in 3-D: a chain of 78 carbons, each with its two hydrogens above and below the zigzag of the chain, folded back and forth as the chains lie in the plastic\'s crystals. In 3-D each carbon is a tetrahedron, as in the real plastic.'));

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
