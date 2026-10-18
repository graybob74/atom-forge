'use strict';
/* Tiny objects for the molecule library (its "Tiny objects" category): each is built atom by atom here, settled with
   the engine's own forces (the molecule builder's relaxation), checked to hold together at room temperature, and
   written to src/objects.gen.js. Run from the repository root:  node tools/objgen.js [key …] [--quick]
   (with keys, only those are rebuilt; the others are kept from the existing file). */
const fs = require('fs'), path = require('path');
const { load } = require('../tests/load');
const X = load('all', { seed: 1 });
const { W } = X;
const args = process.argv.slice(2), quick = args.includes('--quick'), only = args.filter(a => !a.startsWith('--'));
const OUT = path.join(__dirname, '..', 'src', 'objects.gen.js');

const EL = (s) => X.ELEMENTS[X.SYM2Z[s]];
const BL = (a, b, o = 1) => X.bondLength(EL(a), EL(b), o);
const _cap = new Map();
function capOf(el, q) { // bonds the engine lets this atom make
  const k = el + q;
  if (!_cap.has(k)) { X.clearWorld(); const p = X.addAtom(el, 0, 0, { charge: q, T: 0 }); _cap.set(k, p.cap); X.kill(p); }
  return _cap.get(k);
}
class Obj {
  constructor(k, n, d) { this.k = k; this.n = n; this.d = d; this.atoms = []; this.bonds = []; }
  add(el, x, y, q = 0) { this.atoms.push({ el, x, y, q }); return this.atoms.length - 1; }
  bond(i, j, o = 1) { if (i === undefined || j === undefined || i === j) throw new Error('bad bond'); this.bonds.push([i, j, o]); }
  used(i) { let n = 0; for (const [a, b, o] of this.bonds) if (a === i || b === i) n += o; return n; }
  nb(i) { const out = []; for (const [a, b] of this.bonds) { if (a === i) out.push(b); else if (b === i) out.push(a); } return out; }
  free(i) { const a = this.atoms[i]; return capOf(a.el, a.q) - this.used(i); }
  /* hydrogens on every free valence, pointing away from the atom's neighbours (dirs: candidate directions) */
  capH(i, dirs) {
    const a = this.atoms[i];
    let n = this.free(i);
    if (n <= 0) return;
    const L = BL(a.el, 'H');
    let cand = dirs ? dirs.slice() : null;
    if (!cand) { // share the hydrogens out among the gaps between the existing bonds, the widest first
      const angs = this.nb(i).map(j => Math.atan2(this.atoms[j].y - a.y, this.atoms[j].x - a.x)).sort((p, q) => p - q);
      cand = [];
      if (!angs.length) for (let k = 0; k < n; k++) cand.push(2 * Math.PI * k / n);
      else {
        const gaps = angs.map((t, k) => ({ t, w: (k + 1 < angs.length ? angs[k + 1] : angs[0] + 2 * Math.PI) - t, c: 0 }));
        for (let k = 0; k < n; k++) gaps.reduce((b, g) => (g.w / (g.c + 1) > b.w / (b.c + 1) ? g : b)).c++;
        for (const g of gaps) for (let j = 1; j <= g.c; j++) cand.push(g.t + g.w * j / (g.c + 1));
      }
    }
    for (const t of cand.slice(0, n)) this.bond(i, this.add('H', a.x + L * Math.cos(t), a.y + L * Math.sin(t)));
  }
}

/* ---- settle, check, write ---- */
function settle(o) {
  const mol = { atoms: o.atoms.map(a => ({ el: a.el, x: a.x, y: a.y, q: a.q })), bonds: o.bonds };
  const t0 = Date.now(), { best, err } = o.fireOnly ? fireOnly(mol, o.fireIters) : X.mbRelax(mol, 1, false);
  if (err || !best) throw new Error(`${o.k}: relaxation failed: ${err}`);
  let cx = 0, cy = 0; for (const [x, y] of best.raw) { cx += x; cy += y; } cx /= best.raw.length; cy /= best.raw.length;
  o.xy = best.raw.map(([x, y]) => [x - cx, y - cy]);
  o.issues = best.gi; o.radical = best.free;
  if (best.gi.includes('stretch')) for (const [i, j, k] of o.bonds) { // (which bonds, to fix the drawing)
    const d = Math.hypot(best.raw[i][0] - best.raw[j][0], best.raw[i][1] - best.raw[j][1]), r0 = BL(o.atoms[i].el, o.atoms[j].el, k);
    if (Math.abs(d - r0) > 0.15 * r0) console.log(`    stretched: ${o.atoms[i].el}${i}–${o.atoms[j].el}${j} ${d.toFixed(2)} Å (${r0.toFixed(2)}), drawn at (${o.atoms[i].x.toFixed(1)}, ${o.atoms[i].y.toFixed(1)}), (${o.atoms[j].x.toFixed(1)}, ${o.atoms[j].y.toFixed(1)})`);
  }
  console.log(`  ${o.k}: ${o.atoms.length} atoms, ${o.bonds.length} bonds, settled in ${((Date.now() - t0) / 1000).toFixed(1)} s; issues: ${best.gi.length ? [...new Set(best.gi)].join(',') + ' ×' + best.gi.length : 'none'}; free valences ${best.free}`);
}
/* Settle on the engine's own forces alone, from the drawing as it is (the builder's relaxation first untangles with
   springs and a shove apart, which also unfolds a folded chain) */
function fireOnly(mol, iters = 6000) {
  X.clearWorld(); W.box.w = W.box.tw = 400; W.box.h = W.box.th = 400; W.T = 0; W.gamma = 0; W.wall = 'reflect';
  const ps = mol.atoms.map(a => X.addAtom(a.el, a.x, a.y, { charge: a.q || 0, T: 0 }));
  for (const [i, j, k] of mol.bonds) X.addBond(ps[i], ps[j], k);
  for (const p of ps) { p.vx = 0; p.vy = 0; }
  X.mbFire(ps, iters);
  return { best: { gi: X.mbGeomIssues(ps, mol), raw: ps.map(p => [p.x, p.y]), free: ps.filter(p => p.el && !p.el.dblock && p.cap - p.used > 0).length } };
}
/* Put it down at room temperature (in good thermal contact) and watch: same atoms, same bonds, still in one piece. */
function hold(o, T = 300, frames = quick ? 20 : 300) {
  X.clearWorld(); W.box.w = W.box.tw = 400; W.box.h = W.box.th = 400; W.T = T; W.gamma = 0.05; W.wall = 'reflect'; W.decayOn = false;
  W.simPerFrame = 0.5;
  const ps = o.atoms.map((a, i) => X.addAtom(a.el, o.xy[i][0], o.xy[i][1], { charge: a.q, T: 0 }));
  for (const [i, j, ord] of o.bonds) X.addBond(ps[i], ps[j], ord);
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  const nb0 = W.bonds.length, t0 = Date.now(), s0 = W.step;
  let Tk = 0;
  for (let f = 0; f < frames; f++) X.simFrame(1 / 60, 1e9);
  console.log(`    ${W.step - s0} steps for ${frames} frames (last dt ${W.dt.toPrecision(2)} tu)`);
  const alive = W.parts.filter(p => !p.dead), atoms = alive.filter(p => p.k === X.NUC), freed = alive.length - atoms.length;
  let ke = 0; for (const p of atoms) ke += 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy); Tk = ke / (atoms.length * X.PHYS.KB);
  // still one piece: every atom within reach of the rest (no fragment drifted off)
  const spread = Math.max(...atoms.map(p => Math.hypot(p.x, p.y)));
  const ok = atoms.length === o.atoms.length && !freed && W.bonds.length === nb0;
  console.log(`  ${o.k} at ${T} K for ${(frames * W.simPerFrame * 10.18 / 1000).toFixed(1)} ps (${((Date.now() - t0) / 1000).toFixed(0)} s): ${ok ? 'held' : 'CHANGED'} — ${atoms.length}/${o.atoms.length} atoms, ${W.bonds.length}/${nb0} bonds, ${freed} freed, ${Tk.toFixed(0)} K, reach ${spread.toFixed(1)} Å${ok ? '' : '; ' + W.log.slice(-4).map(l => l.text).join(' | ')}`);
  return ok;
}
const svgDir = args.includes('--svg') ? path.join(__dirname, '..', 'tests', '.tmp', 'objsvg') : null;
function svg(o, xy, name) { // a drawing to look at (atoms numbered), for working on a layout
  fs.mkdirSync(svgDir, { recursive: true });
  const xs = xy.map(p => p[0]), ys = xy.map(p => p[1]), x0 = Math.min(...xs) - 2, y1 = Math.max(...ys) + 2, k = 28;
  const W_ = (Math.max(...xs) + 2 - x0) * k, H_ = (y1 - Math.min(...ys) + 2) * k, X_ = (x) => (x - x0) * k, Y_ = (y) => (y1 - y) * k;
  const col = { C: '#888', H: '#eee', O: '#e33', N: '#36f', S: '#ee3', Si: '#c96', P: '#f80', B: '#fbb', In: '#a6c', Au: '#fc3', Na: '#a6f', Cl: '#3c3' };
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W_.toFixed(0)}" height="${H_.toFixed(0)}" style="background:#111">`;
  for (const [i, j, b] of o.bonds) out += `<line x1="${X_(xy[i][0])}" y1="${Y_(xy[i][1])}" x2="${X_(xy[j][0])}" y2="${Y_(xy[j][1])}" stroke="#aaa" stroke-width="${b * 2}"/>`;
  xy.forEach(([x, y], i) => { out += `<circle cx="${X_(x)}" cy="${Y_(y)}" r="${o.atoms[i].el === 'H' ? 5 : 9}" fill="${col[o.atoms[i].el] || '#0ff'}"/>`; if (o.atoms[i].el !== 'H') out += `<text x="${X_(x) + 8}" y="${Y_(y) - 8}" fill="#fff" font-size="10">${i}</text>`; });
  fs.writeFileSync(path.join(svgDir, name + '.svg'), out + '</svg>');
}
const r2 = (v) => Math.round(v * 100) / 100;
function entry(o) {
  const a = o.atoms.map((at, i) => `['${at.el}',${r2(o.xy[i][0])},${r2(o.xy[i][1])}${at.q ? ',' + at.q : ''}]`).join(',');
  const b = o.bonds.map(([i, j, k]) => `[${i},${j},${k}]`).join(',');
  return `{k:'${o.k}',n:${JSON.stringify(o.n)},c:'objects',d:${JSON.stringify(o.d)},${o.radical ? 'r:1,' : ''}\n a:[${a}],\n b:[${b}]}`;
}

/* ================================================================== the objects */
const OBJ = [];

/* ---- silicon lattices (diamond flattened: each atom bonded to four, at right angles, as the engine draws sp3) ---- */
function siBlock(o, cols, rows, x0, y0, a, dop = {}) {
  const g = {};
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const d = dop[c + ',' + r] || ['Si', 0];
    g[c + ',' + r] = o.add(d[0], x0 + c * a, y0 + r * a, d[1]);
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (c + 1 < cols) o.bond(g[c + ',' + r], g[(c + 1) + ',' + r]);
    if (r + 1 < rows) o.bond(g[c + ',' + r], g[c + ',' + (r + 1)]);
  }
  return g;
}
/* hydrogens on a block's free valences, along the missing lattice directions */
function capBlock(o, g, cols, rows) {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = g[c + ',' + r], dirs = [];
    if (c === 0) dirs.push(Math.PI);
    if (c === cols - 1) dirs.push(0);
    if (r === 0) dirs.push(-Math.PI / 2);
    if (r === rows - 1) dirs.push(Math.PI / 2);
    if (o.free(i) > 0) o.capH(i, dirs.filter(t => { // only directions not already bonded
      const a = o.atoms[i];
      return !o.nb(i).some(j => { const b = o.atoms[j]; return Math.abs(Math.atan2(b.y - a.y, b.x - a.x) - t) < 0.6 || Math.abs(Math.abs(Math.atan2(b.y - a.y, b.x - a.x) - t) - 2 * Math.PI) < 0.6; });
    }));
  }
}
/* gate oxide: a row of bridging oxygens joining the top of block A (columns c0…c1 of A) to the bottom row of block B */
function oxide(o, gA, rowA, gB, cols, cA0) {
  for (let c = 0; c < cols; c++) {
    const i = gA[(cA0 + c) + ',' + rowA], j = gB[c + ',0'], a = o.atoms[i], b = o.atoms[j];
    const ox = o.add('O', (a.x + b.x) / 2 + 0.55, (a.y + b.y) / 2);
    o.bond(i, ox); o.bond(ox, j);
  }
}

OBJ.push(() => { // a planar MOSFET, as in chips until ~2011, along its channel
  const o = new Obj('transistor', 'Transistor (one switch of a chip)',
    'One transistor, cut along its channel, 5 nm long: p-type silicon (boron atoms, B⁻), n-type source and drain at the ends (phosphorus, P⁺), a gate oxide one oxygen layer thick and a silicon gate on top. A voltage on the gate draws electrons into the silicon just under it and lets current flow from source to drain. The transistors in a phone chip are only a few times bigger than this, and it holds about 20 billion of them. (Real doping is far sparser, about one atom in a thousand; the dopants are shown ionized, as they are in a working transistor.)');
  const a = BL('Si', 'Si'), cols = 22, rows = 7;
  const dop = { '1,5': ['P', 1], '4,4': ['P', 1], '17,4': ['P', 1], '20,5': ['P', 1], '7,1': ['B', -1], '11,2': ['B', -1], '14,1': ['B', -1], '10,0': ['B', -1] };
  const body = siBlock(o, cols, rows, 0, 0, a, dop);
  const gc = 8, gr = 3, g0 = 7, yGate = (rows - 1) * a + 2.9;
  const gate = siBlock(o, gc, gr, g0 * a, yGate, a);
  oxide(o, body, rows - 1, gate, gc, g0);
  capBlock(o, body, cols, rows); capBlock(o, gate, gc, gr);
  return o;
});

OBJ.push(() => { // a flash memory cell: a floating gate between two oxides stores the bit as trapped electrons
  const o = new Obj('flashcell', 'Flash memory cell (one bit of a USB stick)',
    'A flash memory cell, 5 nm long: a transistor with a second, floating gate sealed between two oxide layers. Pushed through the thin bottom oxide, electrons stay trapped on the floating gate for years, switching the transistor\'s behaviour: that is one stored bit, kept with the power off. A phone\'s storage holds about a trillion of these cells, stacked in hundreds of layers.');
  const a = BL('Si', 'Si'), cols = 22, rows = 6;
  const dop = { '1,4': ['P', 1], '4,3': ['P', 1], '17,3': ['P', 1], '20,4': ['P', 1], '7,1': ['B', -1], '14,1': ['B', -1], '10,0': ['B', -1], '12,2': ['B', -1] };
  const body = siBlock(o, cols, rows, 0, 0, a, dop);
  const gc = 8, g0 = 7, yF = (rows - 1) * a + 2.9;
  const fg = siBlock(o, gc, 3, g0 * a, yF, a);
  const cg = siBlock(o, gc, 3, g0 * a, yF + 2 * a + 2.9, a);
  oxide(o, body, rows - 1, fg, gc, g0);
  oxide(o, fg, 2, cg, gc, 0);
  capBlock(o, body, cols, rows); capBlock(o, fg, gc, 3); capBlock(o, cg, gc, 3);
  return o;
});

/* A row of transistors, each in its own block of silicon (a p-type well for an n-channel transistor, n-type for
   p-channel), the wells parted by oxide (shallow trench isolation: a seam of bridging oxygens here) */
function transistorRow(o, kinds, cols = 14, rows = 7) {
  const a = BL('Si', 'Si'), gap = 2 * BL('Si', 'O') * 0.92, gc = 6, g0 = 4, yGate = (rows - 1) * a + 2.9, blocks = [];
  kinds.forEach((t, i) => {
    const x0 = i * ((cols - 1) * a + gap), n = t === 'n';
    const body = n ? ['B', -1] : ['P', 1], sd = n ? ['P', 1] : ['B', -1];
    // (no donor within 5.5 Å of an acceptor: the engine would move an electron between them, as a real p–n junction
    // does only over far larger distances)
    const dop = { '5,1': body, '8,1': body, '7,3': body, '2,5': sd, '3,4': sd, [`${cols - 4},4`]: sd, [`${cols - 3},5`]: sd };
    const g = siBlock(o, cols, rows, x0, 0, a, dop), gate = siBlock(o, gc, 3, x0 + g0 * a, yGate, a);
    oxide(o, g, rows - 1, gate, gc, g0);
    blocks.push({ g, gate });
  });
  for (let i = 0; i + 1 < blocks.length; i++) for (let r = 0; r < rows; r++) { // the isolation seam
    const u = blocks[i].g[(cols - 1) + ',' + r], v = blocks[i + 1].g['0,' + r], A = o.atoms[u], B = o.atoms[v];
    const ox = o.add('O', (A.x + B.x) / 2, (A.y + B.y) / 2 + (r % 2 ? 0.45 : -0.45));
    o.bond(u, ox); o.bond(ox, v);
  }
  for (const { g, gate } of blocks) { capBlock(o, g, cols, rows); capBlock(o, gate, gc, 3); }
}

OBJ.push(() => { // a CMOS inverter: the simplest logic gate
  const o = new Obj('inverter', 'Logic gate: CMOS inverter (NOT)',
    'The simplest logic gate, a NOT gate: an n-channel and a p-channel transistor side by side, 7 nm across, each in its own well of doped silicon and parted by a seam of oxide. A high voltage on the two gates (tied together) switches the n-type one on and the p-type one off, pulling the output low; a low voltage does the reverse. Every processor is billions of gates like this, and the pairing of n and p is why chips use power only when they switch (CMOS).');
  transistorRow(o, ['n', 'p']);
  return o;
});

OBJ.push(() => { // a six-transistor SRAM cell: one bit of a processor's cache
  const o = new Obj('sramcell', 'SRAM cell (one bit of a processor\'s cache)',
    'One bit of the fast memory inside a processor (its cache): six transistors in a row, 20 nm long, each in its own doped well, with oxide between them. Four make two inverters wired in a loop that holds a 0 or a 1 as long as the power is on; the two at the ends connect it to the wires that read and write it. A processor\'s cache holds tens of millions of these cells.');
  transistorRow(o, ['n', 'n', 'p', 'p', 'n', 'n']);
  o.fireOnly = true; // (a lattice from the start: the engine's forces alone settle it, and quickly)
  return o;
});

OBJ.push(() => { // table salt
  const o = new Obj('saltcrystal', 'Salt crystal',
    'Table salt, 196 sodium and chloride ions in a 4 nm square, held together only by their charges. A grain of salt from a shaker is about 80,000 times wider and holds some 10¹⁸ ions in the same checkerboard pattern.');
  const n = 14, a = 2.82;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const na = (r + c) % 2 === 0; o.add(na ? 'Na' : 'Cl', c * a, r * a, na ? 1 : -1); }
  return o;
});

OBJ.push(() => { // gold nanoparticle
  const o = new Obj('goldnano', 'Gold nanoparticle',
    'A 4 nm speck of gold, 169 atoms. The red line on a pregnancy or COVID test is made of gold particles like this one, only about ten times wider (some two million atoms each): at that size gold looks deep red, not gold.');
  const a = 2.88, k = 7;
  for (let q = -k; q <= k; q++) for (let r = -k; r <= k; r++) { if (Math.abs(q + r) > k) continue; o.add('Au', a * (q + r / 2), a * r * Math.sqrt(3) / 2); }
  return o;
});

OBJ.push(() => { // graphene, the layers of pencil lead
  const o = new Obj('graphene', 'Graphene flake (pencil lead)',
    'One sheet of graphite, the "lead" in a pencil: 216 carbon atoms in a honeycomb 2.6 nm across, edged with hydrogen. Pencil lead is stacks of these sheets, 0.34 nm apart, that slide off onto the paper as you write; a single sheet on its own is graphene, the strongest material ever measured.');
  const s = 1.42, k = 6, key = (x, y) => Math.round(x * 100) + ',' + Math.round(y * 100), at = new Map();
  const ringC = [];
  for (let q = -(k - 1); q <= k - 1; q++) for (let r = -(k - 1); r <= k - 1; r++) { if (Math.abs(q + r) > k - 1) continue; ringC.push([Math.sqrt(3) * s * (q + r / 2), 1.5 * s * r]); }
  const edges = new Set();
  for (const [cx, cy] of ringC) {
    const vs = [];
    for (let m = 0; m < 6; m++) { const t = Math.PI / 6 + m * Math.PI / 3, x = cx + s * Math.cos(t), y = cy + s * Math.sin(t), kk = key(x, y); if (!at.has(kk)) at.set(kk, o.add('C', x, y)); vs.push(at.get(kk)); }
    for (let m = 0; m < 6; m++) { const u = vs[m], v = vs[(m + 1) % 6]; edges.add(Math.min(u, v) + '-' + Math.max(u, v)); }
  }
  const E = [...edges].map(e => e.split('-').map(Number)), nC = o.atoms.length;
  // Kekulé structure: a perfect matching of the carbons (the honeycomb is bipartite) becomes the double bonds
  const adj = Array.from({ length: nC }, () => []); for (const [u, v] of E) { adj[u].push(v); adj[v].push(u); }
  const side = new Array(nC).fill(-1); side[0] = 0; const st = [0];
  while (st.length) { const u = st.pop(); for (const v of adj[u]) if (side[v] < 0) { side[v] = 1 - side[u]; st.push(v); } }
  const mate = new Array(nC).fill(-1);
  const aug = (u, seen) => { for (const v of adj[u]) { if (seen.has(v)) continue; seen.add(v); if (mate[v] < 0 || aug(mate[v], seen)) { mate[u] = v; mate[v] = u; return true; } } return false; };
  for (let u = 0; u < nC; u++) if (side[u] === 0 && mate[u] < 0) aug(u, new Set());
  if (mate.some(m => m < 0)) throw new Error('graphene: no Kekulé structure');
  for (const [u, v] of E) o.bond(u, v, mate[u] === v ? 2 : 1);
  for (let i = 0; i < nC; i++) o.capH(i);
  return o;
});

/* a hexagonal honeycomb flake (k rings to a side): its atoms, the ring bonds, and which sublattice each atom is on */
function honeycomb(o, k, s, elOf) {
  const key = (x, y) => Math.round(x * 100) + ',' + Math.round(y * 100), at = new Map(), edges = new Set(), sub = [];
  for (let q = -(k - 1); q <= k - 1; q++) for (let r = -(k - 1); r <= k - 1; r++) {
    if (Math.abs(q + r) > k - 1) continue;
    const cx = Math.sqrt(3) * s * (q + r / 2), cy = 1.5 * s * r, vs = [];
    for (let m = 0; m < 6; m++) {
      const t = Math.PI / 6 + m * Math.PI / 3, x = cx + s * Math.cos(t), y = cy + s * Math.sin(t), kk = key(x, y);
      if (!at.has(kk)) { const sl = m % 2; at.set(kk, o.add(elOf(sl), x, y)); sub.push(sl); }
      vs.push(at.get(kk));
    }
    for (let m = 0; m < 6; m++) { const u = vs[m], v = vs[(m + 1) % 6]; edges.add(Math.min(u, v) + '-' + Math.max(u, v)); }
  }
  return { E: [...edges].map(e => e.split('-').map(Number)), sub };
}

OBJ.push(() => { // an indium phosphide quantum dot, flattened to one honeycomb layer
  const o = new Obj('quantumdot', 'Quantum dot (QLED TV)',
    'An indium phosphide nanocrystal 3 nm across: 96 indium and phosphorus atoms with hydrogen on its edges, flattened here to a single honeycomb layer. QLED televisions put a film of dots like this in front of a blue backlight, and each dot glows a pure colour set by its size (about 3 nm for green, 5 nm for red), because the electrons inside are squeezed into a box only a few atoms wide.');
  const n0 = o.atoms.length, { E } = honeycomb(o, 4, BL('In', 'P'), (sl) => sl ? 'P' : 'In');
  for (const [u, v] of E) o.bond(u, v);
  for (let i = n0; i < o.atoms.length; i++) if (o.atoms[i].el !== 'H') o.capH(i);
  return o;
});

OBJ.push(() => { // polyethylene, folded as in the crystals of a plastic bag
  const o = new Obj('polyethylene', 'Polyethylene (plastic bag)',
    'One molecule of polyethylene, the plastic of shopping bags and milk jugs: a chain of 78 carbons, each carrying two hydrogens, folded back and forth as the chains lie in the plastic\'s crystals. Real chains are thousands of carbons long and run about ten times farther between folds, so one molecule of a bag is a strand a few micrometres long, packed into a crystal 10–20 nm thick.');
  const cc = BL('C', 'C'), legs = 5, L = 14, chain = [];
  let x = 0, y = 0, dir = 1;
  for (let leg = 0; leg < legs; leg++) {
    for (let k = 0; k < L; k++) { if (k) x += dir * cc; chain.push(o.add('C', x, y)); }
    if (leg + 1 < legs) { for (let k = 0; k < 2; k++) { y += cc; chain.push(o.add('C', x, y)); } y += cc; dir = -dir; } // (the next leg starts at the turn's top)
  }
  for (let k = 1; k < chain.length; k++) o.bond(chain[k - 1], chain[k]);
  for (const i of chain) o.capH(i);
  return o;
});

/* ---- peptides: the backbone laid along a path, side chains out to alternate sides (a flattened β-strand: the side
   chain sits opposite its own carbonyl oxygen, so they alternate), hydrogens on every free valence ---- */
const SC = { // side chains, heavy atoms only: [name, element, u (along the chain), v (outward), parent (-1: Cα), bond order ('a': aromatic)]
  G: [], A: [['CB', 'C', 0, 1.54, -1, 1]],
  S: [['CB', 'C', 0, 1.54, -1, 1], ['OG', 'O', 0, 2.97, 0, 1]],
  T: [['CB', 'C', 0, 1.54, -1, 1], ['OG1', 'O', 0, 2.97, 0, 1], ['CG2', 'C', 1.54, 1.54, 0, 1]],
  V: [['CB', 'C', 0, 1.54, -1, 1], ['CG1', 'C', 0, 3.08, 0, 1], ['CG2', 'C', 1.54, 1.54, 0, 1]],
  L: [['CB', 'C', 0, 1.54, -1, 1], ['CG', 'C', 0, 3.08, 0, 1], ['CD1', 'C', 0, 4.62, 1, 1], ['CD2', 'C', 1.54, 3.08, 1, 1]],
  I: [['CB', 'C', 0, 1.54, -1, 1], ['CG1', 'C', 0, 3.08, 0, 1], ['CG2', 'C', 1.54, 1.54, 0, 1], ['CD1', 'C', 0, 4.62, 1, 1]],
  D: [['CB', 'C', 0, 1.54, -1, 1], ['CG', 'C', 0, 3.08, 0, 1], ['OD1', 'O', -1.07, 3.70, 1, 2], ['OD2', 'O', 1.18, 3.76, 1, 1]],
  E: [['CB', 'C', 0, 1.54, -1, 1], ['CG', 'C', 0, 3.08, 0, 1], ['CD', 'C', 0, 4.62, 1, 1], ['OE1', 'O', -1.07, 5.24, 2, 2], ['OE2', 'O', 1.18, 5.30, 2, 1]],
  N: [['CB', 'C', 0, 1.54, -1, 1], ['CG', 'C', 0, 3.08, 0, 1], ['OD1', 'O', -1.07, 3.70, 1, 2], ['ND2', 'N', 1.27, 3.82, 1, 1]],
  Q: [['CB', 'C', 0, 1.54, -1, 1], ['CG', 'C', 0, 3.08, 0, 1], ['CD', 'C', 0, 4.62, 1, 1], ['OE1', 'O', -1.07, 5.24, 2, 2], ['NE2', 'N', 1.27, 5.36, 2, 1]],
  K: [['CB', 'C', 0, 1.54, -1, 1], ['CG', 'C', 0, 3.08, 0, 1], ['CD', 'C', 0, 4.62, 1, 1], ['CE', 'C', 0, 6.16, 2, 1], ['NZ', 'N', 0, 7.63, 3, 1]],
  R: [['CB', 'C', 0, 1.54, -1, 1], ['CG', 'C', 0, 3.08, 0, 1], ['CD', 'C', 0, 4.62, 1, 1], ['NE', 'N', 0, 6.09, 2, 1], ['CZ', 'C', 0, 7.42, 3, 1], ['NH1', 'N', -1.12, 8.07, 4, 2], ['NH2', 'N', 1.17, 8.10, 4, 1]],
  C: [['CB', 'C', 0, 1.54, -1, 1], ['SG', 'S', 0, 3.36, 0, 1]],
  H: [['CB', 'C', 0, 1.54, -1, 1], ['CG', 'C', 0, 3.04, 0, 1], ['ND1', 'N', 1.108, 3.845, 1, 1], ['CE1', 'C', 0.685, 5.148, 2, 1], // histidine,
    ['NE2', 'N', -0.685, 5.148, 3, 2], ['CD2', 'C', -1.108, 3.845, 4, 1, 1]], // its imidazole with the H on ND1
  M: [['CB', 'C', 0, 1.54, -1, 1], ['CG', 'C', 0, 3.08, 0, 1], ['SD', 'S', 0, 4.90, 1, 1], ['CE', 'C', 0, 6.72, 2, 1]],
  F: [['CB', 'C', 0, 1.54, -1, 1], ['CG', 'C', 0, 3.05, 0, 1], ['CD1', 'C', 1.212, 3.75, 1, 'a'], ['CE1', 'C', 1.212, 5.15, 2, 'a'], ['CZ', 'C', 0, 5.85, 3, 'a'], ['CE2', 'C', -1.212, 5.15, 4, 'a'], ['CD2', 'C', -1.212, 3.75, 5, 'a', 1]],
  Y: [['CB', 'C', 0, 1.54, -1, 1], ['CG', 'C', 0, 3.05, 0, 1], ['CD1', 'C', 1.212, 3.75, 1, 'a'], ['CE1', 'C', 1.212, 5.15, 2, 'a'], ['CZ', 'C', 0, 5.85, 3, 'a'], ['CE2', 'C', -1.212, 5.15, 4, 'a'], ['CD2', 'C', -1.212, 3.75, 5, 'a', 1], ['OH', 'O', 0, 7.21, 4, 1]],
};
(() => { // tryptophan's indole: a pentagon on CG, a hexagon fused on its far left edge
  const s = 1.40, R5 = s / (2 * Math.sin(Math.PI / 5)), c5 = [0, 3.05 + R5], P = (t) => [c5[0] + R5 * Math.cos(t), c5[1] + R5 * Math.sin(t)];
  const d = (k) => -Math.PI / 2 + k * 2 * Math.PI / 5;
  const CD1 = P(d(1)), NE1 = P(d(2)), CE2 = P(d(3)), CD2 = P(d(4));
  const mx = (CE2[0] + CD2[0]) / 2, my = (CE2[1] + CD2[1]) / 2, ex = CE2[0] - CD2[0], ey = CE2[1] - CD2[1], el = Math.hypot(ex, ey);
  let nx = ey / el, ny = -ex / el; if ((mx - c5[0]) * nx + (my - c5[1]) * ny < 0) { nx = -nx; ny = -ny; }
  const ap = s * Math.cos(Math.PI / 6), c6 = [mx + nx * ap, my + ny * ap], a0 = Math.atan2(CE2[1] - c6[1], CE2[0] - c6[0]);
  const a1 = Math.atan2(CD2[1] - c6[1], CD2[0] - c6[0]), sense = ((a1 - a0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI > 0 ? -1 : 1;
  const H = (k) => [c6[0] + s * Math.cos(a0 + sense * k * Math.PI / 3), c6[1] + s * Math.sin(a0 + sense * k * Math.PI / 3)];
  const CZ2 = H(1), CH2 = H(2), CZ3 = H(3), CE3 = H(4);
  SC.W = [['CB', 'C', 0, 1.54, -1, 1], ['CG', 'C', 0, 3.05, 0, 1], ['CD1', 'C', ...CD1, 1, 'a'], ['NE1', 'N', ...NE1, 2, 1], ['CE2', 'C', ...CE2, 3, 1],
    ['CD2', 'C', ...CD2, 4, 'a', 1], ['CZ2', 'C', ...CZ2, 4, 'a'], ['CH2', 'C', ...CH2, 6, 'a'], ['CZ3', 'C', ...CZ3, 7, 'a'], ['CE3', 'C', ...CE3, 8, 'a', 5]];
})();
/* Kekulé double bonds for the aromatic ring bonds among atoms ids (a perfect matching of their carbons) */
function kekule(o, aro) {
  const cs = [...new Set(aro.flat())].filter(i => o.atoms[i].el === 'C'), adj = new Map(cs.map(i => [i, []]));
  for (const [u, v] of aro) if (adj.has(u) && adj.has(v)) { adj.get(u).push(v); adj.get(v).push(u); }
  const mate = new Map();
  const aug = (u, seen) => { for (const v of adj.get(u)) { if (seen.has(v)) continue; seen.add(v); if (!mate.has(v) || aug(mate.get(v), seen)) { mate.set(u, v); mate.set(v, u); return true; } } return false; };
  for (const u of cs) if (!mate.has(u)) aug(u, new Set([u]));
  for (const [u, v] of aro) o.bond(u, v, mate.get(u) === v ? 2 : 1);
}
/* the peptide seq laid on frames [{ P: Cα position, ti: direction in from N, to: direction out to C }] (framesPath,
   framesMoves); opts.sides[i] (+1/−1) sets the side residue i's side chain takes (else they alternate, proline keeping
   its neighbour's); at a corner (ti ⟂ to) the side chain carries straight on and the carbonyl turns away from it;
   opts.links: disulfide bridges [res, atom, res, atom] */
const left = (t) => [-t[1], t[0]];
function framesPath(path, n, spacing = 3.8) { const out = []; for (let i = 0; i < n; i++) { const { p, t } = path(i * spacing); out.push({ P: p, ti: t, to: t }); } return out; }
function framesMoves(moves, spacing = 3.8) { // moves between residues: E, W, N or S
  const D = { E: [1, 0], W: [-1, 0], N: [0, 1], S: [0, -1] }, out = [{ P: [0, 0] }];
  for (const m of moves) { const d = D[m], q = out[out.length - 1]; q.to = d; out.push({ P: [q.P[0] + spacing * d[0], q.P[1] + spacing * d[1]], ti: d }); }
  out[0].ti = out[0].to; out[out.length - 1].to = out[out.length - 1].ti;
  return out;
}
function peptide(o, seq, frames, opts = {}) {
  const res = [];
  let p = opts.p0 || 1;
  for (let i = 0; i < seq.length; i++) {
    const f = frames[i], corner = Math.abs(f.ti[0] * f.to[0] + f.ti[1] * f.to[1]) < 0.5;
    if (corner) { if (seq[i] === 'P') throw new Error('proline at a corner'); const nOut = left(f.to); p = (f.ti[0] * nOut[0] + f.ti[1] * nOut[1]) > 0 ? -1 : 1; }
    else if (opts.sides && opts.sides[i]) p = -opts.sides[i]; // (a set side: +1 along the left normal)
    else if (i && seq[i] !== 'P') p = -p;
    const Nm = left(f.ti);
    res.push({ aa: seq[i], P: f.P, ti: f.ti, to: f.to, p, d: corner ? f.ti : [-p * Nm[0], -p * Nm[1]] });
  }
  const aro = [];
  res.forEach((r, i) => {
    const prev = res[i - 1], ni = left(r.ti), no = left(r.to);
    r.CA = o.add('C', ...r.P);
    const nOff = i ? -0.55 * prev.p : 0, nLen = i ? 1.30 : 1.47;
    r.N = o.add('N', r.P[0] - nLen * r.ti[0] + nOff * ni[0], r.P[1] - nLen * r.ti[1] + nOff * ni[1]);
    r.C = o.add('C', r.P[0] + 1.35 * r.to[0] + 0.55 * r.p * no[0], r.P[1] + 1.35 * r.to[1] + 0.55 * r.p * no[1]);
    o.bond(r.N, r.CA); o.bond(r.CA, r.C);
    if (prev) o.bond(prev.C, r.N);
    const last = i === seq.length - 1, cP = o.atoms[r.C];
    r.O = o.add('O', cP.x + 1.23 * r.p * no[0], cP.y + 1.23 * r.p * no[1]); o.bond(r.C, r.O, 2);
    if (last) { // the C-terminus: an acid, or an amide (opts.amide)
      const e = o.add(opts.amide ? 'N' : 'O', cP.x + 1.36 * r.to[0], cP.y + 1.36 * r.to[1]); o.bond(r.C, e);
    }
    const at = (u, v) => [r.P[0] + u * r.ti[0] + v * r.d[0], r.P[1] + u * r.ti[1] + v * r.d[1]];
    const at2 = (u, v) => { // (u along the chain, v along the side chain's direction)
      const t = Math.abs(r.d[0] * r.ti[0] + r.d[1] * r.ti[1]) > 0.5 ? [-r.d[1], r.d[0]] : r.ti; // at a corner: across the side chain
      return [r.P[0] + u * t[0] + v * r.d[0], r.P[1] + u * t[1] + v * r.d[1]];
    };
    if (r.aa === 'P') { // the ring closes on its own backbone nitrogen, on the side chain's side
      const n = o.atoms[r.N], a = o.atoms[r.CA], ex = (a.x - n.x), ey = (a.y - n.y), el = Math.hypot(ex, ey), u = [ex / el, ey / el];
      const rot = (v, t) => [v[0] * Math.cos(t) - v[1] * Math.sin(t), v[0] * Math.sin(t) + v[1] * Math.cos(t)];
      const side = Math.sign(r.d[0] * -u[1] + r.d[1] * u[0]) || 1, L = 1.52;
      const b = rot(u, side * 2 * Math.PI / 5), CB = [a.x + L * b[0], a.y + L * b[1]], g = rot(u, side * 4 * Math.PI / 5), CG = [CB[0] + L * g[0], CB[1] + L * g[1]];
      const dd = rot(u, side * 6 * Math.PI / 5), CD = [CG[0] + L * dd[0], CG[1] + L * dd[1]];
      const ib = o.add('C', ...CB), ig = o.add('C', ...CG), id = o.add('C', ...CD);
      o.bond(r.CA, ib); o.bond(ib, ig); o.bond(ig, id); o.bond(id, r.N);
      r.sc = [ib, ig, id];
    } else {
      r.sc = [];
      for (const [, el, u, v, par, ord, ring] of SC[r.aa]) {
        const k = o.add(el, ...at2(u, v)); r.sc.push(k);
        const pa = par < 0 ? r.CA : r.sc[par];
        if (ord === 'a') aro.push([pa, k]); else o.bond(pa, k, ord);
        if (ring !== undefined) aro.push([k, r.sc[ring]]);
      }
    }
    void at;
  });
  kekule(o, aro);
  if (opts.links) for (const [i, ni, j, nj] of opts.links) o.bond(res[i].sc[ni], res[j].sc[nj]); // disulfide bridges
  for (let i = 0; i < o.atoms.length; i++) if (o.atoms[i].el !== 'H') o.capH(i);
  return res;
}
const hairpin = (Lx, Y) => (s) => { // strand along +x at +Y, a half-turn round the right, back along −x at −Y
  if (s <= Lx) return { p: [s, Y], t: [1, 0] };
  const arc = Math.PI * Y;
  if (s <= Lx + arc) { const th = Math.PI / 2 - (s - Lx) / Y; return { p: [Lx + Y * Math.cos(th), Y * Math.sin(th)], t: [Math.sin(th), -Math.cos(th)] }; }
  return { p: [Lx - (s - Lx - arc), -Y], t: [-1, 0] };
};

OBJ.push(() => { // chignolin: the smallest protein known to fold on its own
  const o = new Obj('chignolin', 'Protein: chignolin',
    'Chignolin, the smallest protein known to fold into a fixed shape on its own: ten amino acids (GYDPETGTWG), 140 atoms, folded into a hairpin 2–3 nm long. Flattened onto the plane, its side chains take turns pointing to either side of the chain. Most proteins in your body, the enzymes in laundry detergent among them, are chains of hundreds of amino acids folded up into blobs 3–10 nm across.');
  peptide(o, 'GYDPETGTWG', framesMoves('EEEESSSWW'));
  return o;
});

OBJ.push(() => { // oxytocin: a ring of six amino acids closed by a disulfide bridge, with a three-amino-acid tail
  const o = new Obj('oxytocin', 'Hormone: oxytocin',
    'Oxytocin, the hormone of childbirth, breastfeeding and bonding: nine amino acids (CYIQNCPLG), 135 atoms, about 1.5 nm across. The first and sixth (both cysteine) are tied together by a sulfur–sulfur bridge, closing six of them into a ring; the last three hang off it as a tail. It is made in the brain and released into the blood a few billionths of a gram at a time.');
  const R = 5.6, n = 6, ring = (s) => { const th = Math.PI - s / R; return { p: [R * Math.cos(th), R * Math.sin(th)], t: [Math.sin(th), -Math.cos(th)] }; };
  const path = (s) => { const ring6 = (n - 1) * 3.8; if (s <= ring6) return ring(s); const e = ring(ring6), x = s - ring6; return { p: [e.p[0] + x * e.t[0], e.p[1] + x * e.t[1]], t: e.t }; };
  peptide(o, 'CYIQNCPLG', framesPath(path, 9), { amide: true, sides: [-1, 1, 1, 1, 1, -1], links: [[0, 1, 5, 1]] });
  return o;
});

/* ---- DNA: a double helix flattened into a ladder. The bases are the library's own (adenine, thymine, guanine,
   cytosine, each settled with the engine's forces), turned so their pairing edges face across and joined at N9 or N1
   to a deoxyribose; the sugars and phosphates make the two backbones, running opposite ways. ---- */
const BASES = { // library key, the N that bonds to the sugar, the H it loses, the pairing atoms (outer, central)
  A: ['adenine', 6, 13, [0, 2]], T: ['thymine', 3, 13, [8, 6]], G: ['guanine', 4, 13, [9, 10]], C: ['cytosine', 5, 10, [0, 2]],
};
const PAIR = { A: 'T', T: 'A', G: 'C', C: 'G' };
function placedBase(b, down) { // the base's atoms turned so the pairing edge faces down (or up), its sugar N at the origin
  const [key, nA, hA, edge] = BASES[b], M = X.MOLECULES[key], n0 = M.atoms[nA];
  const keep = M.atoms.map((a, i) => i).filter(i => i !== hA);
  const e0 = M.atoms[edge[1]], ang = Math.atan2(e0[2] - n0[2], e0[1] - n0[1]), want = down ? -Math.PI / 2 : Math.PI / 2, r = want - ang;
  const pts = keep.map(i => { const a = M.atoms[i], dx = a[1] - n0[1], dy = a[2] - n0[2]; return { el: a[0], x: dx * Math.cos(r) - dy * Math.sin(r), y: dx * Math.sin(r) + dy * Math.cos(r), i }; });
  const idx = new Map(keep.map((i, k) => [i, k])), bonds = M.bonds.filter(([i, j]) => i !== hA && j !== hA).map(([i, j, o]) => [idx.get(i), idx.get(j), o]);
  return { pts, bonds, n: idx.get(nA), outer: idx.get(edge[0]), centre: idx.get(edge[1]) };
}
function dnaDuplex(o, seq) {
  const S = 8.0, gap = 2.9, top = [], bot = [];
  for (let i = 0; i < seq.length; i++) {
    const t = placedBase(seq[i], true), b = placedBase(PAIR[seq[i]], false);
    // the outer pairing atoms on the same side for both (else the bottom base is turned over)
    const sx = Math.sign(t.pts[t.outer].x - t.pts[t.centre].x), bx = Math.sign(b.pts[b.outer].x - b.pts[b.centre].x);
    if (sx !== bx) for (const q of b.pts) q.x = -q.x;
    const x0 = i * S, tc = t.pts[t.centre], bc = b.pts[b.centre];
    const ty = gap / 2 - tc.y, by = -gap / 2 - bc.y; // central pairing atoms 2.9 Å apart, one above the other
    top.push({ base: t, dx: x0 - tc.x, dy: ty }); bot.push({ base: b, dx: x0 - bc.x, dy: by });
  }
  const strand = (list, sg) => { // sg +1: the upper strand, 5'→3' to the right; −1: the lower, 5'→3' to the left
    const out = [];
    for (const q of list) {
      const ids = q.base.pts.map(a => o.add(a.el, a.x + q.dx, a.y + q.dy));
      for (const [i, j, k] of q.base.bonds) o.bond(ids[i], ids[j], k);
      const N = o.atoms[ids[q.base.n]], P = (u, v) => [N.x + sg * u, N.y + sg * v]; // (the lower strand is the upper one turned half round)
      const R5 = 1.29, c = [0, 1.47 + R5], at = (deg) => [c[0] + R5 * Math.cos(deg * Math.PI / 180), c[1] + R5 * Math.sin(deg * Math.PI / 180)];
      const C1 = o.add('C', ...P(0, 1.47)), C2 = o.add('C', ...P(...at(-18))), C3 = o.add('C', ...P(...at(54))), C4 = o.add('C', ...P(...at(126))), O4 = o.add('O', ...P(...at(198)));
      o.bond(ids[q.base.n], C1); o.bond(C1, C2); o.bond(C2, C3); o.bond(C3, C4); o.bond(C4, O4); o.bond(O4, C1);
      const c4 = at(126), c3 = at(54);
      const C5 = o.add('C', ...P(c4[0] - 1.1, c4[1] + 1.05)), O5 = o.add('O', ...P(c4[0] - 2.2, c4[1] + 1.9));
      const O3 = o.add('O', ...P(c3[0] + 1.25, c3[1] + 0.7));
      o.bond(C4, C5); o.bond(C5, O5); o.bond(C3, O3);
      out.push({ O5, O3, O5xy: P(c4[0] - 2.2, c4[1] + 1.9) });
    }
    return out;
  };
  const link = (nts, sg) => { // a phosphate between each nucleotide's O3' and the next one's O5' (5'→3')
    for (let k = 0; k + 1 < nts.length; k++) {
      const a = nts[k], b = nts[k + 1], A = o.atoms[a.O3], B = o.atoms[b.O5];
      const px = (A.x + B.x) / 2, py = (A.y + B.y) / 2 + sg * 0.9;
      const Pp = o.add('P', px, py), O1 = o.add('O', px, py + sg * 1.48), O2 = o.add('O', px + sg * 0.9, py + sg * 1.2);
      o.bond(a.O3, Pp); o.bond(Pp, b.O5); o.bond(Pp, O1, 2); o.bond(Pp, O2);
    }
  };
  const up = strand(top, 1), lo = strand(bot, -1);
  link(up, 1); link(lo.slice().reverse(), -1); // (the lower strand runs right to left)
  for (let i = 0; i < o.atoms.length; i++) if (o.atoms[i].el !== 'H') o.capH(i);
}
OBJ.push(() => { // DNA
  const o = new Obj('dna', 'DNA (a short stretch of a gene)',
    'Eight rungs of the DNA ladder, 6 nm long: two sugar-phosphate backbones running opposite ways, joined by base pairs held only by hydrogen bonds (A with T by two, G with C by three). It reads GATTACAG along the top strand. Flattened here, the real double helix turns once every ten rungs; the DNA in one of your cells is about three billion rungs long, two metres of it folded into a nucleus a few micrometres across. (The phosphates are shown with their hydrogen on; in water they lose it and carry a negative charge.)');
  dnaDuplex(o, 'GATTACAG');
  return o;
});

OBJ.push(() => { // a small protein domain: a three-stranded β-sheet
  const o = new Obj('wwdomain', 'Protein: WW domain (from Pin1)',
    'The WW domain of the human enzyme Pin1: 34 amino acids (KLPPGWEKRMSRSSGRVYYFNHITNASQWERPSG), 550 atoms, folded into three strands lying side by side, a sheet about 4 nm long. Domains like this are the Lego bricks of proteins: Pin1 uses this one to grab its targets, and it is named after the two tryptophans (W) it holds in place. Flattened onto the plane, the strands are drawn farther apart than in the real sheet, so that their side chains have room between them.');
  // strand 1 (and the tail before it) along +x, a turn down, strand 2 back along −x, a turn down, strand 3 along +x
  peptide(o, 'KLPPGWEKRMSRSSGRVYYFNHITNASQWERPSG', framesMoves('EEEEEEEEEE' + 'E' + 'SSS' + 'W' + 'WWWWW' + 'W' + 'SSS' + 'E' + 'EEEEEEEE'));
  return o;
});

/* ---- a patch of cell membrane: phospholipids in two layers, heads out, tails in ---- */
function lipid(o, x0, y0, up) { // phosphatidic acid: a glycerol, two 12-carbon fatty-acid tails (esters) and a phosphate head
  const sg = up ? 1 : -1, cc = BL('C', 'C'), Y = (y) => y0 + sg * y;
  const P = o.add('P', x0 + 1.5, Y(6.2)), Op1 = o.add('O', x0 + 1.5, Y(7.68)), Op2 = o.add('O', x0 + 2.95, Y(6.2)), Op3 = o.add('O', x0 + 0.05, Y(6.4));
  o.bond(P, Op1, 2); o.bond(P, Op2); o.bond(P, Op3);
  const Og = o.add('O', x0 + 1.5, Y(4.7)); o.bond(P, Og);
  const G3 = o.add('C', x0 + 1.5, Y(3.27)), G2 = o.add('C', x0 + 1.5, Y(1.75)), G1 = o.add('C', x0 + 3.0, Y(1.75));
  o.bond(Og, G3); o.bond(G3, G2); o.bond(G2, G1);
  const tail = (xa, from, oy) => { // ester O, carbonyl C(=O), then the chain straight down
    const Oe = o.add('O', xa, Y(oy)); o.bond(from, Oe);
    const Cc = o.add('C', xa, Y(oy - 1.36)); o.bond(Oe, Cc);
    const Oc = o.add('O', xa + 1.2, Y(oy - 1.36)); o.bond(Cc, Oc, 2);
    let prev = Cc;
    for (let k = 1; k < 12; k++) { const c = o.add('C', xa, Y(oy - 1.36 - k * cc)); o.bond(prev, c); prev = c; }
  };
  tail(x0, G2, 0.3); tail(x0 + 3.0, G1, 0.3);
}
OBJ.push(() => { // two leaflets, tails meeting in the middle
  const o = new Obj('membrane', 'Cell membrane (lipid bilayer)',
    'A patch of the skin around every cell: two layers of phospholipids, 16 molecules and about 1,400 atoms, with their phosphate heads facing out and their fatty-acid tails tucked in, 5 nm thick. The heads like water and the tails avoid it, so in water the molecules gather into this double layer on their own; nothing ties them together but the attraction between their tails. A real cell membrane is the same two layers, studded with proteins, wrapped round the whole cell.');
  const n = 8, dx = 6.6, mid = 0.0, depth = 1.36 + 11 * BL('C', 'C') + 0.3; // (from the ester oxygen to the tail's end)
  for (let i = 0; i < n; i++) lipid(o, i * dx, mid + depth + 1.1, true);   // upper layer: heads up, tails ending just above the middle
  for (let i = 0; i < n; i++) lipid(o, i * dx + dx / 2, mid - depth - 1.1, false); // lower layer, offset half a step
  for (let i = 0; i < o.atoms.length; i++) if (o.atoms[i].el !== 'H') o.capH(i);
  o.fireOnly = true;
  return o;
});

OBJ.push(() => { // a nanodroplet of water
  const o = new Obj('waterdrop', 'Water droplet (fog)',
    'A droplet of water 3 nm across: 91 molecules, tumbling and swapping hydrogen bonds. A droplet of fog is about 10 µm across and holds some 2×10¹³ molecules; a raindrop, 10²⁰. Warm it and molecules evaporate off its surface.');
  const d = 2.85, k = 5, oh = BL('O', 'H'), half = 104.5 / 2 * Math.PI / 180;
  let n = 0;
  for (let q = -k; q <= k; q++) for (let r = -k; r <= k; r++) {
    if (Math.abs(q + r) > k) continue;
    const x = d * (q + r / 2), y = d * r * Math.sqrt(3) / 2, th = (n++ * 2.39996) % (2 * Math.PI);
    const O = o.add('O', x, y);
    for (const s of [-1, 1]) o.bond(O, o.add('H', x + oh * Math.cos(th + s * half), y + oh * Math.sin(th + s * half)));
  }
  o.fireOnly = true; // (settled by the engine's forces alone: the hydrogen bonds draw it into a liquid drop)
  return o;
});

OBJ.push(() => { // Kevlar: two flat chains side by side, held by hydrogen bonds
  const o = new Obj('kevlar', 'Kevlar (bulletproof vest)',
    'Two chains of Kevlar, the fibre of bulletproof vests and racing-bike tyres: benzene rings linked by amide groups into flat, stiff rods 4 nm long, held side by side by hydrogen bonds between their N–H and C=O groups. A Kevlar fibre is millions of such chains lined up along it; weight for weight it is about five times stronger than steel.');
  const repeats = 3, cc = 1.40;
  const chain = (y0, flip, x0) => { // H₂N–[C₆H₄–NH–CO–C₆H₄–CO–NH]…–OH along +x
    const sg = flip ? -1 : 1, toks = ['N2'];
    for (let r = 0; r < repeats; r++) toks.push('ring', 'NH', 'CO', 'ring', 'CO', r + 1 < repeats ? 'NH' : 'OH');
    let x = x0, prev = null, amide = 0;
    for (const t of toks) {
      if (t === 'ring') {
        const v = [[0, 0], [0.7, 1.21], [2.1, 1.21], [2.8, 0], [2.1, -1.21], [0.7, -1.21]].map(([u, w]) => o.add('C', x + u, y0 + sg * w));
        for (let m = 0; m < 6; m++) o.bond(v[m], v[(m + 1) % 6], m % 2 ? 1 : 2);
        if (prev !== null) o.bond(prev, v[0]);
        prev = v[3]; x += 2.8 + 1.42;
      } else {
        const el = t === 'CO' ? 'C' : t === 'OH' ? 'O' : 'N', a = o.add(el, x, y0);
        if (prev !== null) o.bond(prev, a);
        if (t === 'CO') { const side = (amide++ % 2 ? -1 : 1) * sg; o.bond(a, o.add('O', x, y0 + side * 1.23), 2); }
        prev = a; x += 1.40;
      }
    }
  };
  chain(0, false, 0);
  chain(-5.2, true, 6.4);
  // each amide N–H points away from its own C=O (trans), toward the neighbouring chain's C=O
  for (let i = 0; i < o.atoms.length; i++) {
    if (o.atoms[i].el !== 'N' || o.nb(i).length !== 2) continue;
    const c = o.nb(i).find(j => o.atoms[j].el === 'C' && o.nb(j).some(k => o.atoms[k].el === 'O' && o.bonds.some(([a, b, ord]) => ord === 2 && ((a === j && b === k) || (a === k && b === j)))));
    if (c === undefined) continue;
    const oo = o.nb(c).find(k => o.atoms[k].el === 'O'), side = Math.sign(o.atoms[oo].y - o.atoms[c].y), n = o.atoms[i];
    o.bond(i, o.add('H', n.x, n.y - side * BL('N', 'H')));
  }
  for (let i = 0; i < o.atoms.length; i++) if (o.atoms[i].el !== 'H') o.capH(i);
  o.fireOnly = true; // (engine forces alone, so the chains settle into their hydrogen bonds)
  return o;
});

OBJ.push(() => { // cellulose: glucose rings joined end to end
  const o = new Obj('cellulose', 'Cellulose (paper and cotton)',
    'A chain of cellulose, the stuff of paper, cotton and wood: glucose rings joined end to end, each flipped relative to the last. Here there are six; real chains have thousands, lying straight and flat side by side and hydrogen-bonded into fibres, which is what makes cotton thread and paper strong.');
  const units = 6, cc = BL('C', 'C'), co = BL('C', 'O');
  let prevC4 = null;
  for (let u = 0; u < units; u++) {
    const fl = u % 2 ? -1 : 1, x0 = u * 5.5, R = 1.45, ring = [];
    // ring: C1, C2, C3, C4, C5, O5 (a hexagon, C1 on the right, C4 on the left)
    const names = ['C', 'C', 'C', 'C', 'C', 'O'], ang = [0, -60, -120, 180, 120, 60].map(a => a * Math.PI / 180);
    for (let m = 0; m < 6; m++) ring.push(o.add(names[m], x0 + R * Math.cos(ang[m]), fl * R * Math.sin(ang[m])));
    for (let m = 0; m < 6; m++) o.bond(ring[m], ring[(m + 1) % 6]);
    const [C1, C2, C3, C4, C5] = ring, P = (i) => o.atoms[i];
    const sub = (c, el, dx, dy) => { const k = o.add(el, P(c).x + dx, P(c).y + dy); o.bond(c, k); return k; };
    sub(C2, 'O', 0.4, -fl * co);              // O2–H
    sub(C3, 'O', -0.4, -fl * co);             // O3–H
    const C6 = sub(C5, 'C', -0.3, fl * cc); sub(C6, 'O', -co, 0.3 * fl); // C6H2–O6H
    if (prevC4 === null) sub(C4, 'O', -co, 0);  // the chain's first end: O4–H
    else o.bond(prevC4, C4);
    if (u + 1 < units) { const Ob = sub(C1, 'O', co * 0.85, 0); prevC4 = Ob; } // the glycosidic oxygen, bonded to the next ring's C4
    else sub(C1, 'O', co, 0);                  // the other end: O1–H
  }
  for (let i = 0; i < o.atoms.length; i++) if (o.atoms[i].el !== 'H') o.capH(i);
  return o;
});

/* ================================================================== run */
const old = new Map();
if (fs.existsSync(OUT)) { const src = fs.readFileSync(OUT, 'utf8'); for (const m of src.matchAll(/^\{k:'([^']+)'[\s\S]*?\]\}(?=,?\n)/gm)) old.set(m[1], m[0]); }
const entries = [];
let fails = 0;
for (const make of OBJ) {
  const o = make();
  if (only.length && !only.includes(o.k)) { if (old.has(o.k)) entries.push(old.get(o.k)); continue; }
  console.log(`${o.k}: ${o.n}`);
  if (svgDir) svg(o, o.atoms.map(a => [a.x, a.y]), o.k + '-drawn');
  settle(o);
  if (svgDir) svg(o, o.xy, o.k + '-settled');
  const ok = hold(o);
  if (!ok || o.issues.length) fails++;
  entries.push(entry(o));
}
const ORDER = ['transistor', 'inverter', 'sramcell', 'flashcell', 'dna', 'wwdomain', 'membrane', 'chignolin', 'oxytocin', 'graphene', 'polyethylene', 'kevlar', 'cellulose', 'quantumdot', 'goldnano', 'saltcrystal', 'waterdrop'];
const rank = (e) => { const k = /^\{k:'([^']+)'/.exec(e)[1], i = ORDER.indexOf(k); return i < 0 ? 99 : i; };
entries.sort((a, b) => rank(a) - rank(b));
const head = `'use strict';
/* Tiny objects for the molecule library, generated by tools/objgen.js: edit that and rerun, not this file.
   Same format as MOLECULE_LIB (src/molecules.gen.js): k key, n name, c category, d note, a atoms [symbol, x, y,
   formal charge] in Å, b bonds [i, j, order]. Each was settled with the engine's own forces and checked to hold
   together at room temperature. */
MOLECULE_CATS.unshift(['objects', 'Tiny objects']);
const OBJECT_LIB = [
`;
if (!args.includes('--dry')) fs.writeFileSync(OUT, head + entries.join(',\n') + '\n];\n');
console.log(`wrote ${entries.length} objects to ${path.relative(process.cwd(), OUT)}${fails ? ` — ${fails} with problems` : ''}`);
