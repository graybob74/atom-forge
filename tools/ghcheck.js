'use strict';
/* graphHash (engine.js, 1.28 item 41: integer colours) against the string version it replaced: both must split every
   formula's library entries into the same structures, and name every molecule the setups make the same.
     node tools/ghcheck.js [steps]     (default 300 steps of each setup) */
const { load } = require('../tests/load.js');
const STEPS = +(process.argv[2] || 300);
function fnvS(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }
function ghOld(labels, adj) { // (the version before 1.28, word for word)
  let col = labels.slice();
  const n = labels.length, iters = Math.min(n, 12);
  for (let it = 0; it < iters; it++) {
    const nc = new Array(n);
    for (let i = 0; i < n; i++) nc[i] = fnvS(col[i] + '(' + adj[i].map(j => col[j]).sort().join(',') + ')');
    col = nc;
  }
  return fnvS(col.slice().sort().join('.'));
}
let bad = 0, pairs = 0, mols = 0;
const X0 = load('all', { seed: 7 });
// 1. the library: within each formula, two entries equal by one hash are equal by the other
{
  const by = new Map();
  for (const key in X0.MOLECULES) {
    const m = X0.MOLECULES[key];
    if (m.atoms.length < 2 || m.bonds.length < m.atoms.length - 1) continue;
    const f = X0.hill(m.atoms.map(a => ({ el: X0.ELEMENTS[X0.SYM2Z[a[0]]], q: a[3] || 0 })), true);
    const adj = m.atoms.map(() => []); for (const [i, j] of m.bonds) { adj[i].push(j); adj[j].push(i); }
    const lab = m.atoms.map(a => (a[4] && a[4] !== X0.COMMON_A[X0.SYM2Z[a[0]]] ? a[0] + a[4] : a[0]));
    if (!by.has(f)) by.set(f, []);
    by.get(f).push({ key, o: ghOld(lab, adj), n: X0.graphHash(lab, adj) });
  }
  for (const [f, L] of by) for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    pairs++;
    if ((L[i].o === L[j].o) !== (L[i].n === L[j].n)) { bad++; console.log('library DIFFERENT', f, L[i].key, L[j].key); }
  }
  console.log(`library: ${by.size} formulas, ${pairs} pairs of entries with one formula compared`);
}
// 2. the molecules the setups make: the same library entry (or none) by either hash
const names = new Map(), o2n = new Map(), n2o = new Map();
for (const k of Object.keys(X0.PRESETS)) {
  const X = load('all', { seed: 7 }), W = X.W;
  try {
    X.PRESETS[k].build(); if (X.ultraHold) X.ultraHold(); X.settleOverlaps(); X.forcesNoEvents(); W.fSpawn = W.spawned;
    for (let i = 0; i < STEPS; i++) { if (W.fSpawn !== W.spawned) { X.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = X.chooseDt(); X.step(W.dt); }
  } catch (e) { continue; }
  const seen = new Set(), idx = X.libIndex(), oldIdx = new Map();
  for (const [f, L] of idx) oldIdx.set(f, L.map(c => {
    const m = c.m, adj = m.atoms.map(() => []); for (const [i, j] of m.bonds) { adj[i].push(j); adj[j].push(i); }
    return { m, h: f + ':' + ghOld(m.atoms.map(a => (a[4] && a[4] !== X.COMMON_A[X.SYM2Z[a[0]]] ? a[0] + a[4] : a[0])), adj) };
  }));
  for (const p of W.parts) {
    if (p.dead || seen.has(p) || !p.el || !p.bonds || !p.bonds.length) continue;
    const atoms = X.molecule(p); for (const a of atoms) seen.add(a);
    if (atoms.length > 400) continue;
    const got = X.libMatch(atoms);
    // the old way, by hand (libMatch with ghOld)
    let want = null;
    if (!atoms.some(a => !a.el) && !atoms.some(a => !!a.anti !== !!atoms[0].anti)) {
      const f = X.hill(atoms.map(a => ({ el: a.el, q: atoms[0].anti ? -a.q : a.q })), true), cands = oldIdx.get(f);
      if (cands) {
        const ix = new Map(atoms.map((a, i) => [a, i]));
        const adj = atoms.map(a => a.bonds.map(bd => ix.get(X.other(bd, a))).concat(a.bom ? X.boNbrs(a).map(o => ix.get(o)) : []).filter(j => j !== undefined));
        const h = f + ':' + ghOld(atoms.map(a => { const A = X.isoA(a); return A ? X.elSym(a) + A : X.elSym(a); }), adj);
        let alt = null; for (const c of cands) if (c.h === h) { if (X.molFits(c.m, W.d3)) { want = c.m; break; } alt = alt || c.m; }
        if (!want) want = alt;
      }
    }
    { // (and every molecule's structure, library or not: one hash's classes are the other's)
      const ix = new Map(atoms.map((a, i) => [a, i])), f = X.hill(atoms, true);
      const adj = atoms.map(a => a.bonds.map(bd => ix.get(X.other(bd, a))).filter(j => j !== undefined)), lab = atoms.map(a => X.elSym(a) || '?');
      const o = f + ':' + ghOld(lab, adj), nn = f + ':' + X.graphHash(lab, adj);
      if (!o2n.has(o)) o2n.set(o, nn); else if (o2n.get(o) !== nn) { bad++; console.log('class split', o); }
      if (!n2o.has(nn)) n2o.set(nn, o); else if (n2o.get(nn) !== o) { bad++; console.log('classes joined', nn); }
    }
    mols++;
    if (got !== want) { bad++; console.log(`${k}: DIFFERENT for ${X.hill(atoms)}: ${got && got.name} vs ${want && want.name}`); }
    else if (got) names.set(got.name, (names.get(got.name) || 0) + 1);
  }
}
console.log(`setups: ${mols} molecules compared (${o2n.size} structures), ${names.size} library names among them (${[...names.keys()].slice(0, 12).join(', ')}…)`);
// 3. random graphs (trees and rings of 3–24 atoms of C, N, O, H, small enough that many repeat): the same classes
{
  let x = 12345; const r = (n) => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return (x >>> 8) % n; };
  const o2n = new Map(), n2o = new Map(), EL = ['C', 'C', 'N', 'O', 'H'];
  for (let t = 0; t < 30000; t++) {
    const n = 3 + r(8 + (t % 3) * 7), lab = [], adj = [];
    for (let i = 0; i < n; i++) { lab.push(EL[r(5)]); adj.push([]); if (i) { const j = r(i); adj[i].push(j); adj[j].push(i); } }
    if (r(3) === 0 && n > 3) { const a = r(n), b = r(n); if (a !== b && !adj[a].includes(b)) { adj[a].push(b); adj[b].push(a); } }
    const f = lab.slice().sort().join(''), o = f + ':' + ghOld(lab, adj), nn = f + ':' + X0.graphHash(lab, adj);
    if (!o2n.has(o)) o2n.set(o, nn); else if (o2n.get(o) !== nn) { bad++; if (bad < 5) console.log('random: class split', o); }
    if (!n2o.has(nn)) n2o.set(nn, o); else if (n2o.get(nn) !== o) { bad++; if (bad < 5) console.log('random: classes joined', nn); }
  }
  console.log(`random graphs: 30,000 made, ${o2n.size} structures by the old hash, ${n2o.size} by the new`);
}
console.log(bad ? `${bad} DIFFERENT` : 'the same partition and the same names');
process.exitCode = bad ? 1 : 0;
