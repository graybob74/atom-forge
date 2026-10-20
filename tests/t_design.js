'use strict';
/* Claude's designs, without Claude: the recipes Claude may answer with (SMILES, amino-acid sequences, lattices) must
   become the right atoms and bonds, laid out and settled by the builder; bad recipes must be refused with a reason.
   (The page test stubs the `sample` capability itself.) Node only. */
const { load } = require('./load');
const X = load('all', { seed: 5 });
const { W } = X;
let fails = 0;
const bad = (m) => { fails++; console.log('FAIL', m); };
const t0 = Date.now();
const hill = (G) => {
  const c = {};
  for (const a of G.atoms) { c[a.el] = (c[a.el] || 0) + 1; if (a.h) c.H = (c.H || 0) + a.h; }
  const ks = Object.keys(c).sort((a, b) => (a === 'C' ? -1 : b === 'C' ? 1 : a === 'H' ? -1 : b === 'H' ? 1 : a < b ? -1 : 1));
  return ks.map(k => k + (c[k] > 1 ? c[k] : '')).join('');
};
const graph = (s) => X.designCheck(X.smilesGraph(X.smilesParse(s)));

// 1. SMILES → formula: aromatic rings (also azulene, which is not bipartite), [nH] and the n-for-[nH] slip, charges,
//    isotopes, hypervalent S and P, ring numbers with %, stereo marks dropped
const T = [['Cn1cnc2c1c(=O)n(C)c(=O)n2C', 'C8H10N4O2'], ['CC(=O)Oc1ccccc1C(=O)O', 'C9H8O4'], ['c1ccccc1', 'C6H6'], ['c1ccncc1', 'C5H5N'],
  ['c1cc[nH]c1', 'C4H5N'], ['c1ccnc1', 'C4H5N'], ['c1ccoc1', 'C4H4O'], ['c1ccsc1', 'C4H4S'], ['c1c[nH]cn1', 'C3H4N2'], ['c1ccc2[nH]ccc2c1', 'C8H7N'],
  ['c1ccc2ccccc2c1', 'C10H8'], ['c1ccc2cccc2cc1', 'C10H8'], ['[NH4+]', 'H4N'], ['CC(=O)[O-]', 'C2H3O2'], ['C[N+](=O)[O-]', 'CH3NO2'],
  ['[2H]O[2H]', 'H2O'], ['[13CH4]', 'CH4'], ['CS(C)=O', 'C2H6OS'], ['OS(=O)(=O)O', 'H2O4S'], ['OP(=O)(O)O', 'H3O4P'], ['C1CC1', 'C3H6'],
  ['C%10CC%10', 'C3H6'], ['N[C@@H](C)C(=O)O', 'C3H7NO2'], ['F/C=C/F', 'C2H2F2'], ['O=c1[nH]cccc1', 'C5H5NO'], ['c1ccc(cc1)-c1ccccc1', 'C12H10'],
  ['c1ccccc1c1ccccc1', 'C12H10'], ['C[n+]1ccccc1', 'C6H8N'], ['[cH-]1cccc1', 'C5H5'], ['[Na+]', 'Na'], ['ClC(Cl)(Cl)Cl', 'CCl4'], ['C#N', 'CHN'],
  ['[C-]#[O+]', 'CO'], ['c1ccc2c(c1)ccc1ccccc12', 'C14H10'], ['Oc1ccc(cc1)C(c1ccc(O)cc1)(C)C', 'C15H16O2']];
for (const [s, f] of T) {
  try { const h = hill(graph(s)); if (h !== f) bad(`SMILES ${s}: ${h}, expected ${f}`); } catch (e) { bad(`SMILES ${s}: ${e.message}`); }
}
const iso = graph('[2H]O[2H]'), b6 = graph('c1ccccc1');
if (!iso.atoms.every(a => a.el !== 'H' || a.A === 2)) bad('[2H] lost its mass number');
if (b6.bonds.filter(b => b[2] === 2).length !== 3) bad('benzene did not get three double bonds');
if (graph('[18OH2]').atoms[0].A !== 18 || graph('[16OH2]').atoms[0].A !== 0) bad('isotope labels: ¹⁸O kept, the usual ¹⁶O dropped');
for (const s of ['C1CC', 'C(C', 'Xx', 'c1cccc1', 'C)C', 'C==C', '[Fe', 'C11', 'C*C', '', '[Qq]', 'C$C', '[O-3]', '[3C]', 'C.(C)']) {
  let ok = false;
  try { graph(s); } catch (e) { ok = typeof e.message === 'string' && e.message.length > 5; }
  if (!ok) bad(`SMILES ${JSON.stringify(s)} should be refused with a reason`);
}
// 2. peptides: one-letter codes become a chain (Gly, Pro and the ring side chains included); Met-enkephalin
for (const [q, f] of [['GA', 'C5H10N2O3'], ['P', 'C5H9NO2'], ['W', 'C11H12N2O2'], ['H', 'C6H9N3O2'], ['R', 'C6H14N4O2'], ['YGGFM', 'C27H35N5O7S'], ['ACDEFGHIKLMNPQRSTVWY', 'C107H159N29O30S2']]) {
  try { const h = hill(graph(X.peptideSmiles(q))); if (h !== f) bad(`peptide ${q}: ${h}, expected ${f}`); } catch (e) { bad(`peptide ${q}: ${e.message}`); }
}
for (const q of ['', 'GXB', 'A'.repeat(21)]) { let ok = false; try { X.peptideSmiles(q); } catch (e) { ok = true; } if (!ok) bad(`peptide ${JSON.stringify(q)} should be refused`); }

// 3. built through the builder's own layout and settling, a recipe for a library molecule IS that molecule
const lib = [['O', 'H2O'], ['CCO', 'ethanol'], ['c1ccccc1', 'benzene'], ['Cn1cnc2c1c(=O)n(C)c(=O)n2C', 'caffeine'], ['CC(=O)Oc1ccccc1C(=O)O', 'aspirin'],
  ['NCC(=O)O', 'glycine'], ['Nc1ncnc2[nH]cnc12', 'adenine'], ['CN1CCCC1c1cccnc1', 'nicotine'], ['CC(=O)Nc1ccc(O)cc1', 'paracetamol'],
  ['NCCc1ccc(O)c(O)c1', 'dopamine'], ['NC(N)=O', 'urea'], ['NCCc1c[nH]c2ccc(O)cc12', 'serotonin'], ['c1cc2ccc3ccc4ccc5ccc6ccc1c1c2c3c4c5c61', 'coronene']];
let nLib = 0;
for (const [s, k] of lib) {
  if (!X.MOLECULES[k]) { bad(`no library molecule ${k}`); continue; }
  const full = X.designFull(graph(s)), pos = X.designLayout(full);
  const mol = { atoms: full.atoms.map((a, i) => ({ el: a.el, q: a.q, A: a.A, x: pos[i][0], y: pos[i][1] })), bonds: full.bonds };
  const { best, err } = X.mbRelax(mol, X.mbTries(full.atoms.length, 6), true);
  if (err || !best || best.gi.length || !best.lm || best.lm.key !== k) bad(`${s}: ${err || ''} issues ${best && best.gi.join(',')} matched ${best && best.lm ? best.lm.key : 'nothing'} (expected ${k})`);
  else nLib++;
}
// a 16-residue peptide (226 atoms) lays out and settles flat
{
  const full = X.designFull(graph(X.peptideSmiles('HAEGTFTSDVSSYLEG'))), pos = X.designLayout(full);
  const mol = { atoms: full.atoms.map((a, i) => ({ el: a.el, q: a.q, A: a.A, x: pos[i][0], y: pos[i][1] })), bonds: full.bonds };
  const t1 = Date.now(), { best, err } = X.mbRelax(mol, X.mbTries(full.atoms.length, 6), true);
  if (err || !best || best.gi.length) bad(`a 16-residue peptide did not settle flat: ${err || best.gi.join(',')}`);
  else console.log(`  16-residue peptide: ${full.atoms.length} atoms settled in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
}

// 4. lattices: every valence filled, no atom over its limit, neutral; storable; placed whole and holding at 300 K
const LAT = [[{ lattice: 'ionic', elements: ['Na', 'Cl'], size: 8 }, 64], [{ lattice: 'ionic', elements: ['Mg', 'O'], size: 6 }, 36],
  [{ lattice: 'metal', elements: ['Au'], size: 8 }, 61], [{ lattice: 'metal', elements: ['Ar'], size: 6 }, 37], [{ lattice: 'honeycomb', elements: ['C'], size: 8 }, 120],
  [{ lattice: 'honeycomb', elements: ['B', 'N'], size: 6 }, 72], [{ lattice: 'honeycomb', elements: ['In', 'P'], size: 8 }, 120],
  [{ lattice: 'square', elements: ['Si'], size: 6 }, 60], [{ lattice: 'honeycomb', elements: ['C'], size: 14 }, 252]];
for (const [r, nWant] of LAT) {
  const tag = `${r.lattice} ${r.elements.join('')}`;
  let L;
  try { L = X.designLattice(r); } catch (e) { bad(`${tag}: ${e.message}`); continue; }
  const used = L.atoms.map(() => 0); for (const [a, b, o] of L.bonds) { used[a] += o; used[b] += o; }
  let free = 0, over = 0, q = 0, close = 0;
  L.atoms.forEach((a, i) => { q += a[3] || 0; if (L.bonds.length) { const c = X.mbCap(a[0], a[3] || 0).cap; if (used[i] < c) free++; if (used[i] > c) over++; } });
  for (let i = 0; i < L.atoms.length; i++) for (let j = i + 1; j < L.atoms.length; j++) if (Math.hypot(L.atoms[i][1] - L.atoms[j][1], L.atoms[i][2] - L.atoms[j][2]) < 0.8) close++;
  if (L.n !== nWant || free || over || q || close || !X.myMolValid({ k: 'mytest', n: 'x', a: L.atoms, b: L.bonds })) {
    bad(`${tag}: ${L.n} atoms (want ${nWant}), ${free} with free valences, ${over} over, net charge ${q}, ${close} on top of each other`); continue;
  }
  const k = 'myt' + tag.replace(/\W/g, '').toLowerCase();
  X.myMolAdd({ k, n: tag, r: 0, a: L.atoms, b: L.bonds, d: 'Designed by Claude. A test.' });
  const M = X.MOLECULES[k];
  if (M.note !== 'Designed by Claude. A test.' || X.molWhole(M) !== (L.n > 90)) bad(`${tag}: note or whole-placement wrong`);
  const ext = (c) => Math.max(...M.atoms.map(a => a[c])) - Math.min(...M.atoms.map(a => a[c]));
  X.clearWorld(); W.box.w = W.box.tw = Math.max(60, ext(1) + 30); W.box.h = W.box.th = Math.max(60, ext(2) + 30); W.T = r.elements[0] === 'Ar' ? 40 : 300; W.gamma = 1; W.wall = 'reflect'; W.decayOn = false;
  const ps = X.spawnSpec({ kind: 'mol', mol: k }, 0, 0);
  if (ps.length !== L.n) { bad(`${tag}: placed ${ps.length} of ${L.n} atoms`); continue; }
  if (X.molWhole(M) && Math.abs(ps[0].x - ps[ps.length - 1].x - (M.atoms[0][1] - M.atoms[M.atoms.length - 1][1])) > 1e-6) bad(`${tag}: a big one should go down as drawn, not turned`);
  X.forcesNoEvents(); W.fSpawn = W.spawned;
  const nb0 = W.bonds.length;
  for (let f = 0; f < 60; f++) X.simFrame(1 / 60, 40);
  const alive = W.parts.filter(p => !p.dead), freed = alive.filter(p => p.k !== X.NUC).length;
  let cx = 0, cy = 0; for (const p of alive) { cx += p.x; cy += p.y; } cx /= alive.length; cy /= alive.length;
  const strays = alive.filter(p => p.k === X.NUC && Math.hypot(p.x - cx, p.y - cy) > Math.max(ext(1), ext(2)) * 0.75 + 6).length;
  if (alive.length !== L.n || W.bonds.length !== nb0 || freed || strays > L.n * 0.05) bad(`${tag} at 300 K: ${alive.length}/${L.n} atoms, ${W.bonds.length}/${nb0} bonds, ${freed} freed, ${strays} wandered off`);
}
for (const r of [{ lattice: 'ionic', elements: ['Na', 'Na'] }, { lattice: 'ionic', elements: ['Ca', 'F'] }, { lattice: 'metal', elements: ['C'] }, { lattice: 'square', elements: ['N'] },
  { lattice: 'honeycomb', elements: ['Fe'] }, { lattice: 'cubic', elements: ['Na', 'Cl'] }, { lattice: 'metal', elements: ['Zz'] }]) {
  let ok = false; try { X.designLattice(r); } catch (e) { ok = true; }
  if (!ok) bad(`lattice ${JSON.stringify(r)} should be refused`);
}

// 5. the request: names the library already has need no asking; the prompt carries the request and the objects
const hits = [['water', 'H2O'], ['Caffeine', 'caffeine'], ['pencil lead', 'graphene'], ['a salt crystal', 'saltcrystal'], ['CO2', 'CO2'], ['nylon', null], ['a car', null]];
for (const [t, k] of hits) { const h = X.aiLibraryHit(t); if (h !== k) bad(`library shortcut for “${t}”: ${h}, expected ${k}`); }
const P = X.aiPrompt('a strand of "DNA"'), P2 = X.aiPrompt('x', { type: 'molecule', smiles: 'c1cccc1' }, 'no Kekulé structure');
if (!P.includes('Request: "a strand of \\"DNA\\""') || !P.includes('wwdomain') || !P.includes('"type":"lattice"') || P.includes('previous answer')) bad('the prompt is missing its request, objects or forms');
if (!P2.includes('previous answer') || !P2.includes('c1cccc1') || !P2.includes('no Kekulé structure')) bad('the correction prompt does not carry the problem');

// 7. Identify molecules: the SMILES written for a chamber molecule reads back to the same structure (every library
//    molecule), a formula-table name that the library lacks is added to the library as placed, under the category its atoms give (OH: elements & diatomics), and the kinds are counted
{
  X.PRESETS.empty.build();
  let rt = 0, n = 0;
  for (const key in X.MOLECULES) {
    const m = X.MOLECULES[key]; if (m.cat === 'objects' || m.atoms.length > 60 || m.bonds.length < m.atoms.length - 1) continue;
    const made = X.addMolecule(key, 0, 0, 0, 300); if (!made.length) continue; n++;
    const smi = X.smilesWrite(X.molecule(made[0]));
    let ok = false;
    const counts = (f) => { const c = {}; for (const m of f.matchAll(/([A-Z][a-z]?)(\d*)/g)) c[m[1]] = (c[m[1]] || 0) + (+m[2] || 1); return JSON.stringify(Object.keys(c).sort().map(k => k + c[k])); };
    try { const G = X.smilesGraph(X.smilesParse(smi)); ok = counts(hill(G)) === counts(X.hill(made).replace(/[⁺⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+$/, '').replace(/[₀-₉]/g, (d) => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(d)))); } catch (e) { ok = false; }
    if (!ok) { if (rt++ < 3) bad(`${key}: the SMILES ${smi} does not read back to ${X.hill(made, true)}`); }
    for (const p of made) X.kill(p);
  }
  if (!rt) console.log(`  ${n} library molecules written as SMILES read back to their formulas`);
  const o = X.addNuc(8, 8, 8, 0, 0, 0, 0), h = X.addNuc(1, 0, 1, 1, 0, 0, 0); X.addBond(o, h, 1); X.addMolecule('H2O', 20, 0, 0, 300); X.addMolecule('H2O', 30, 0, 0, 300); W.dirty++;
  const kinds = X.chamberKinds();
  if (kinds.length !== 2 || kinds[0].name !== 'Water' || kinds[0].n !== 2 || kinds[1].name !== 'Hydroxyl radical' || kinds[1].smi !== '[OH]') bad('the chamber\'s kinds are not counted and named: ' + JSON.stringify(kinds.map(k => [k.name, k.n, k.smi])));
  const n0 = Object.values(X.MOLECULES).filter(m => m.mine).length;
  X.identifyMolecules();
  const custom = Object.values(X.MOLECULES).filter(m => m.mine);
  if (custom.length !== n0 + 1 || custom[custom.length - 1].name !== 'Hydroxyl radical' || !custom[custom.length - 1].radical || custom[custom.length - 1].atoms.length !== 2 || custom[custom.length - 1].cat !== 'diatomic') bad('the hydroxyl radical was not added to My molecules: ' + JSON.stringify(custom.map(m => m.name)));
  if (X.R.molTags.length !== 3) bad(`${X.R.molTags.length} name tags, not 3`);
  if (!W.log.some(l => /Identified 3 molecules of 2 kinds: 2 × Water, 1 × Hydroxyl radical/.test(l.text))) bad('the log does not report the kinds: ' + W.log.map(l => l.text).join(' | '));
  for (const p of W.parts) X.kill(p);
}

console.log(`  ${T.length} SMILES, 7 peptides, ${nLib}/${lib.length} library molecules rebuilt from recipes, ${LAT.length} lattices (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
console.log(fails ? `${fails} design failure(s)` : 'design checks passed');
process.exitCode = fails ? 1 : 0;
