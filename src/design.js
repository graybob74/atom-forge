'use strict';
/* ================================================================== Claude's designs
   Ask for something in a few words and the viewer's own Claude answers with a recipe, never with coordinates: a
   SMILES string, an amino-acid sequence, a lattice, or one of the ready-made tiny objects. The page itself turns the
   recipe into atoms and bonds, checks every valence with the engine's own rules and lays the result out flat, so
   only chemistry the engine accepts reaches the chamber. Asking works on claude.ai only (the page's `sample`
   capability, with the viewer's consent, on the viewer's own usage); elsewhere the feature stays hidden. */

/* ---- SMILES: the organic subset (B C N O P S F Cl Br I; aromatic b c n o p s), bracket atoms such as [13CH3+:1]
   for anything else, branches, ring closures (1–9, %10–%99), bonds - = # : / \ and '.'. Chirality and cis/trans
   marks are read and dropped (the world is flat); aromatic rings become Kekulé structures. */
const SMI_VAL = { B: [3], C: [4], N: [3, 5], O: [2], P: [3, 5], S: [2, 4, 6], F: [1], Cl: [1], Br: [1], I: [1] };
const SMI_AROM = { b: 'B', c: 'C', n: 'N', o: 'O', p: 'P', s: 'S', se: 'Se', as: 'As', te: 'Te' };
function smilesParse(str) {
  const s = String(str == null ? '' : str).trim();
  if (!s) throw new Error('the SMILES is empty');
  if (s.length > 3000) throw new Error('the SMILES is too long');
  const atoms = [], bonds = [], open = new Map(), stack = [];
  let prev = -1, sym = null, i = 0;
  const fail = (m) => { throw new Error(`${m} (character ${i + 1})`); };
  const link = (a, b, s2) => {
    if (bonds.some(bd => (bd.a === a && bd.b === b) || (bd.a === b && bd.b === a))) fail('two bonds join the same two atoms');
    bonds.push({ a, b, s: s2 });
  };
  const atom = (a) => { atoms.push(a); const k = atoms.length - 1; if (prev >= 0) link(prev, k, sym); prev = k; sym = null; };
  while (i < s.length) {
    const c = s[i];
    if (c === '(') { if (prev < 0 || sym) fail('a branch opens before its atom'); stack.push(prev); i++; }
    else if (c === ')') { if (!stack.length || sym) fail('a ) has no matching ('); prev = stack.pop(); i++; }
    else if ('-=#:/\\$'.includes(c)) {
      if (prev < 0 || sym) fail('a bond symbol is out of place');
      if (c === '$') fail('quadruple bonds ($) cannot be built');
      sym = c; i++;
    } else if (c === '.') { if (sym || stack.length) fail('a . is out of place'); prev = -1; i++; }
    else if ((c >= '0' && c <= '9') || c === '%') {
      let n = c; i++;
      if (c === '%') { n = s.substr(i, 2); if (!/^\d\d$/.test(n)) fail('a % ring number needs two digits'); i += 2; }
      if (prev < 0) fail('a ring number comes before any atom');
      const r = open.get(n);
      if (r) {
        open.delete(n);
        if (r.at === prev) fail(`ring ${n} closes on the atom that opened it`);
        if (r.s && sym && r.s !== sym) fail(`the two ends of ring ${n} give different bonds`);
        link(r.at, prev, sym || r.s);
      } else open.set(n, { at: prev, s: sym });
      sym = null;
    } else if (c === '[') {
      const j = s.indexOf(']', i);
      if (j < 0) fail('a [ is never closed');
      const body = s.slice(i + 1, j);
      const m = /^(\d{1,3})?(se|as|te|[bcnops]|[A-Z][a-z]?)(@(?:@|TH\d|AL\d|SP\d|TB\d{1,2}|OH\d{1,2})?)?(H\d?)?([+-]\d{0,2}|[+-]{2,3})?(?::\d+)?$/.exec(body);
      if (!m) fail(`cannot read the atom [${body}]`);
      const arom = Object.prototype.hasOwnProperty.call(SMI_AROM, m[2]), el = arom ? SMI_AROM[m[2]] : m[2];
      if (!SYM2Z[el]) fail(`[${body}]: ${el} is not an element`);
      let q = 0;
      if (m[5]) {
        const sg = m[5][0] === '+' ? 1 : -1, rest = m[5].slice(1);
        if (/[+-]/.test(rest) && rest.split('').some(x => x !== m[5][0])) fail(`cannot read the charge of [${body}]`);
        q = sg * (rest === '' ? 1 : /^\d+$/.test(rest) ? +rest : rest.length + 1);
      }
      atom({ el, arom, q, A: m[1] ? +m[1] : 0, h: m[4] ? (m[4].length > 1 ? +m[4].slice(1) : 1) : 0, br: true });
      i = j + 1;
    } else {
      const two = s.substr(i, 2);
      if (two === 'Cl' || two === 'Br') { atom({ el: two, arom: false, q: 0, A: 0, h: 0, br: false }); i += 2; }
      else if ('BCNOPSFI'.includes(c)) { atom({ el: c, arom: false, q: 0, A: 0, h: 0, br: false }); i++; }
      else if ('bcnops'.includes(c)) { atom({ el: SMI_AROM[c], arom: true, q: 0, A: 0, h: 0, br: false }); i++; }
      else if (c === '*') fail('a wildcard atom (*) cannot be built');
      else fail(`unexpected “${c}”`);
    }
  }
  if (sym) throw new Error('the SMILES ends on a bond');
  if (stack.length) throw new Error('a ( is never closed');
  if (open.size) throw new Error(`ring ${[...open.keys()][0]} never closes`);
  if (!atoms.length) throw new Error('the SMILES has no atoms');
  return { atoms, bonds };
}
/* Bond orders, hydrogen counts and the Kekulé structure → { atoms: [{ el, q, A, h }], bonds: [[i, j, order]] }.
   Aromatic atoms that still have a free valence share out the rings' double bonds (a perfect matching); a pyrrole-type
   nitrogen written n where [nH] was meant is mended, as most chemistry software does. */
function smilesGraph(g) {
  const { atoms, bonds } = g, n = atoms.length, nb = atoms.map(() => []);
  bonds.forEach((bd, k) => { nb[bd.a].push(k); nb[bd.b].push(k); });
  const inRing = (k) => { // can one end of bond k reach the other without it?
    const { a, b } = bonds[k], seen = new Uint8Array(n), st = [a]; seen[a] = 1;
    while (st.length) {
      const u = st.pop();
      for (const e of nb[u]) {
        if (e === k) continue;
        const v = bonds[e].a === u ? bonds[e].b : bonds[e].a;
        if (v === b) return true;
        if (!seen[v]) { seen[v] = 1; st.push(v); }
      }
    }
    return false;
  };
  bonds.forEach((bd, k) => {
    const s = bd.s;
    bd.o = s === '=' ? 2 : s === '#' ? 3 : (s === ':' || (!s && atoms[bd.a].arom && atoms[bd.b].arom)) && inRing(k) ? 'ar' : 1;
  });
  const sum = new Array(n).fill(0), multi = new Array(n).fill(false);
  for (const bd of bonds) { const w = bd.o === 'ar' ? 1 : bd.o; sum[bd.a] += w; sum[bd.b] += w; if (bd.o !== 'ar' && bd.o > 1) multi[bd.a] = multi[bd.b] = true; }
  const pi = atoms.map((a, i) => {
    if (a.br) return a.arom && !multi[i] && sum[i] + a.h + 1 <= mbCap(a.el, a.q).cap;
    if (a.arom) {
      const v = mbCap(a.el, 0).cap, p = !multi[i] && sum[i] + 1 <= v; // c 4, n 3, o and s 2
      a.h = Math.max(0, v - sum[i] - (p ? 1 : 0));
      return p;
    }
    const v = SMI_VAL[a.el].find(x => x >= sum[i]);
    a.h = v === undefined ? 0 : v - sum[i];
    return false;
  });
  const kekule = () => {
    const adj = new Map();
    atoms.forEach((a, i) => { if (pi[i]) adj.set(i, []); });
    bonds.forEach((bd, k) => { if (bd.o === 'ar' && adj.has(bd.a) && adj.has(bd.b)) { adj.get(bd.a).push([bd.b, k]); adj.get(bd.b).push([bd.a, k]); } });
    const mate = new Map();
    let steps = 0;
    const rec = () => { // the atom with fewest choices first: forced moves, so it hardly ever backtracks
      let best = -1, bc = Infinity;
      for (const [u, l] of adj) {
        if (mate.has(u)) continue;
        let c = 0; for (const [v] of l) if (!mate.has(v)) c++;
        if (!c) return false;
        if (c < bc) { bc = c; best = u; }
      }
      if (best < 0) return true;
      if (++steps > 50000) return false;
      for (const [v, k] of adj.get(best)) {
        if (mate.has(v)) continue;
        mate.set(best, k); mate.set(v, k);
        if (rec()) return true;
        mate.delete(best); mate.delete(v);
      }
      return false;
    };
    return rec() ? new Set(mate.values()) : null;
  };
  let dbl = kekule();
  if (!dbl) {
    for (let i = 0; i < n && !dbl; i++) {
      const a = atoms[i];
      if (a.br || a.el !== 'N' || !pi[i] || sum[i] !== 2) continue;
      pi[i] = false; a.h = 1;
      dbl = kekule();
      if (!dbl) { pi[i] = true; a.h = 0; }
    }
  }
  if (!dbl) throw new Error('its aromatic rings have no Kekulé structure (an aromatic nitrogen that carries a hydrogen is written [nH])');
  bonds.forEach((bd, k) => { if (bd.o === 'ar') bd.o = dbl.has(k) ? 2 : 1; });
  return { atoms: atoms.map(a => ({ el: a.el, q: a.q, A: a.A, h: a.h })), bonds: bonds.map(bd => [bd.a, bd.b, bd.o]) };
}
/* What the builder can take: charges up to ±2, isotopes it knows, hydrogens within reason. Throws the problem. */
function designCheck(G) {
  for (const a of G.atoms) {
    const Z = SYM2Z[a.el];
    if (Math.abs(a.q) > 2) throw new Error(`a charge of ${a.q > 0 ? '+' : ''}${a.q} on ${a.el} is more than the builder takes (±2)`);
    if (a.A && (a.A < Z || a.A - Z > nbMaxN(Z))) throw new Error(`${a.A}${a.el} is not an isotope`);
    if (a.A === COMMON_A[Z]) a.A = 0;
    if (a.h > 8) throw new Error(`${a.h} hydrogens on one ${a.el}`);
  }
  return G;
}
function designFull(G) { // the hydrogens as atoms too: { atoms: [{ el, q, A }], bonds }
  const atoms = G.atoms.map(a => ({ el: a.el, q: a.q, A: a.A })), bonds = G.bonds.map(b => b.slice());
  G.atoms.forEach((a, i) => { for (let k = 0; k < a.h; k++) { atoms.push({ el: 'H', q: 0, A: 0 }); bonds.push([i, atoms.length - 1, 1]); } });
  return { atoms, bonds };
}
function designPieces(full) { return mbComps(full.atoms.length, mbGraphNb(full)).length; }
function designCount(G) { let n = G.atoms.length; for (const a of G.atoms) n += a.h; return n; }
/* A flat drawing: each connected piece laid out by the library generator's method (the tidiest of a few tries),
   the pieces side by side. [x, y] (Å) for every atom of full. */
function designLayout(full) {
  const n = full.atoms.length, comps = mbComps(n, mbGraphNb(full)), pos = new Array(n);
  let x0 = 0;
  for (const c of comps) {
    const idx = new Map(c.map((a, k) => [a, k]));
    const sub = { atoms: c.map(a => full.atoms[a]), bonds: full.bonds.filter(b => idx.has(b[0])).map(b => [idx.get(b[0]), idx.get(b[1]), b[2]]) };
    let best = null;
    for (let t = 0; t < 6 && !(best && !best.sc); t++) {
      let p;
      try { p = mbTidyH(sub, mbLayout(sub, mbRng(31 + 977 * t))); } catch (e) { p = null; }
      if (!p) continue;
      const sc = designScore(sub, p);
      if (!best || sc < best.sc) best = { p, sc };
    }
    if (!best) { // a cage that will not lie flat: a rough ring, for the settling to sort out (bonds will cross)
      const R = 0.6 * Math.max(1, c.length);
      best = { p: c.map((a, k) => [R * Math.cos(2 * Math.PI * k / c.length), R * Math.sin(2 * Math.PI * k / c.length)]) };
    }
    let lo = Infinity, hi = -Infinity, cy = 0;
    for (const [x, y] of best.p) { lo = Math.min(lo, x); hi = Math.max(hi, x); cy += y; }
    cy /= c.length;
    c.forEach((a, k) => { pos[a] = [best.p[k][0] - lo + x0, best.p[k][1] - cy]; });
    x0 += hi - lo + 3;
  }
  const mx = (x0 - 3) / 2;
  return pos.map(([x, y]) => [x - mx, y]);
}
function designScore(mol, p) { // crossing bonds and atoms almost on top of each other
  const B = mol.bonds, P = p.map(([x, y]) => ({ x, y }));
  let s = 0;
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
    const [a, b] = B[i], [c, d] = B[j];
    if (a === c || a === d || b === c || b === d) continue;
    if (mbSegX(P[a], P[b], P[c], P[d])) s += 10;
  }
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) if (Math.abs(P[i].x - P[j].x) < 0.7 && Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y) < 0.7) s++;
  return s;
}

/* ---- peptides: one-letter codes → SMILES (free amine at the N-terminus, acid at the C-terminus) */
const PEP_SIDE = { A: 'C', R: 'CCCNC(N)=N', N: 'CC(N)=O', D: 'CC(=O)O', C: 'CS', E: 'CCC(=O)O', Q: 'CCC(N)=O', H: 'Cc1c[nH]cn1',
  I: 'C(C)CC', L: 'CC(C)C', K: 'CCCCN', M: 'CCSC', F: 'Cc1ccccc1', S: 'CO', T: 'C(C)O', W: 'Cc1c[nH]c2ccccc12',
  Y: 'Cc1ccc(O)cc1', V: 'C(C)C' };
function peptideSmiles(seq) {
  const s = String(seq == null ? '' : seq).toUpperCase().replace(/[\s-]/g, '');
  if (!s) throw new Error('the sequence is empty');
  if (s.length > 20) throw new Error(`${s.length} residues is more than the builder takes (20)`);
  let out = '';
  for (const r of s) {
    if (r !== 'G' && r !== 'P' && !PEP_SIDE[r]) throw new Error(`“${r}” is not a one-letter amino-acid code`);
    out += r === 'G' ? 'NCC(=O)' : r === 'P' ? 'N1CCCC1C(=O)' : `NC(${PEP_SIDE[r]})C(=O)`;
  }
  return out + 'O';
}

/* ---- lattices: { lattice, elements, size, charges? } → { atoms: [[el, x, y, q?]], bonds, n } (centred) */
function latticeIon(sym) { // the usual charge of an element's ion: Na⁺, Mg²⁺, Cl⁻, O²⁻ …
  const Z = SYM2Z[sym], el = ELEMENTS[Z];
  if (el.cat === 'tm' || el.cat === 'ln' || el.cat === 'an') return Math.min(2, el.ox || 2);
  const v = valenceInfo(Z, Z).v;
  return v <= 3 ? v : v >= 5 && v < 8 ? v - 8 : 0;
}
function designLattice(r) {
  const kind = String(r.lattice || '').toLowerCase(), size = Math.round(+r.size || 8);
  const els = (Array.isArray(r.elements) ? r.elements : [r.elements]).map(x => String(x || '').trim()).filter(Boolean);
  for (const e of els) if (!SYM2Z[e]) throw new Error(`“${e}” is not an element symbol`);
  const atoms = [], bonds = [];
  const add = (el, x, y, q) => { atoms.push(q ? [el, x, y, q] : [el, x, y]); return atoms.length - 1; };
  if (kind === 'ionic') {
    if (els.length !== 2) throw new Error('an ionic lattice needs two elements, the cation and then the anion');
    let [qc, qa] = Array.isArray(r.charges) && r.charges.length === 2 ? r.charges.map(Math.round) : [latticeIon(els[0]), latticeIon(els[1])];
    if (!(qc > 0 && qa < 0)) throw new Error(`${els[0]} and ${els[1]} do not make a cation and an anion`);
    if (qc !== -qa) throw new Error(`${els[0]} (${qc > 0 ? '+' : ''}${qc}) and ${els[1]} (${qa}) do not pair one to one`);
    if (qc > 2) throw new Error(`charges of ±${qc} are more than the builder takes (±2)`);
    const n = clamp(size, 4, 14), a = ionicRadius(ELEMENTS[SYM2Z[els[0]]], qc) + ionicRadius(ELEMENTS[SYM2Z[els[1]]], qa);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const c = (i + j) % 2 === 0; add(c ? els[0] : els[1], i * a, j * a, c ? qc : qa); }
  } else if (kind === 'metal') {
    if (els.length !== 1) throw new Error('a metal cluster is one element');
    const el = ELEMENTS[SYM2Z[els[0]]];
    if (!el.metal && el.cat !== 'ng') throw new Error(`${el.name} is not a metal or a noble gas`);
    // spacing at the engine's own minimum: the metallic bond's (as the engine sizes it) or the van der Waals one
    const a = el.metal ? 2 * el.rc * ((el.cat === 'am' || el.cat === 'ae' || el.cat === 'pt') ? 1.12 : 1) : el.uffR;
    const k = clamp(Math.round(size / 2), 2, 7);
    for (let q = -k; q <= k; q++) for (let s2 = -k; s2 <= k; s2++) if (Math.abs(q + s2) <= k) add(el.sym, a * (q + s2 / 2), a * s2 * Math.sqrt(3) / 2);
  } else if (kind === 'honeycomb' || kind === 'square') {
    if (els.length < 1 || els.length > 2) throw new Error(`a ${kind} lattice is one or two elements`);
    const A = els[0], B = els[1] || els[0];
    for (const e of [A, B]) if (ELEMENTS[SYM2Z[e]].metal && ELEMENTS[SYM2Z[e]].cat !== 'pt') throw new Error(`${e} does not form a covalent ${kind} sheet here`);
    if (kind === 'square') {
      if (A !== B || mbCap(A, 0).cap !== 4) throw new Error('a square lattice is one element that makes four bonds (C, Si or Ge)');
      const n = clamp(size, 3, 12), L = mbBondLen(A, A, 1), id = [];
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) id.push(add(A, i * L, j * L));
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { if (i + 1 < n) bonds.push([id[j * n + i], id[j * n + i + 1], 1]); if (j + 1 < n) bonds.push([id[j * n + i], id[(j + 1) * n + i], 1]); }
    } else {
      const k = clamp(Math.round(size / 2), 2, 6), four = mbCap(A, 0).cap === 4 && mbCap(B, 0).cap === 4;
      const L = four ? (mbBondLen(A, B, 1) + mbBondLen(A, B, 2)) / 2 : mbBondLen(A, B, 1);
      const edges = new Set(), pts = [];
      const vertex = (x, y) => { // the same corner reached from a neighbouring ring is the same atom
        for (let i = 0; i < pts.length; i++) if (Math.abs(pts[i][0] - x) < 0.3 * L && Math.abs(pts[i][1] - y) < 0.3 * L) return i;
        pts.push([x, y]); return pts.length - 1;
      };
      for (let q = -(k - 1); q <= k - 1; q++) for (let s2 = -(k - 1); s2 <= k - 1; s2++) {
        if (Math.abs(q + s2) > k - 1) continue;
        const cx = Math.sqrt(3) * L * (q + s2 / 2), cy = 1.5 * L * s2, vs = [];
        for (let m = 0; m < 6; m++) {
          const t = Math.PI / 6 + m * Math.PI / 3;
          vs.push(vertex(cx + L * Math.cos(t), cy + L * Math.sin(t)));
        }
        for (let m = 0; m < 6; m++) { const u = vs[m], v = vs[(m + 1) % 6]; edges.add(Math.min(u, v) * 4096 + Math.max(u, v)); }
      }
      const E = [...edges].map(e => [Math.floor(e / 4096), e % 4096]), adj = pts.map(() => []);
      for (const [u, v] of E) { adj[u].push(v); adj[v].push(u); }
      const side = new Array(pts.length).fill(-1), st = [0]; side[0] = 0; // the two sublattices (the honeycomb is bipartite)
      while (st.length) { const u = st.pop(); for (const v of adj[u]) if (side[v] < 0) { side[v] = 1 - side[u]; st.push(v); } }
      pts.forEach(([x, y], i) => add(side[i] ? B : A, x, y));
      const mate = new Array(pts.length).fill(-1);
      if (four) { // a Kekulé structure: a perfect matching of the sheet's atoms becomes its double bonds
        const aug = (u, seen) => { for (const v of adj[u]) { if (seen.has(v)) continue; seen.add(v); if (mate[v] < 0 || aug(mate[v], seen)) { mate[u] = v; mate[v] = u; return true; } } return false; };
        for (let u = 0; u < pts.length; u++) if (side[u] === 0 && mate[u] < 0) aug(u, new Set());
      }
      for (const [u, v] of E) bonds.push([u, v, mate[u] === v ? 2 : 1]);
    }
    // hydrogen on every free valence, in the gaps between the bonds
    const nAt = atoms.length, used = new Array(nAt).fill(0), nbr = Array.from({ length: nAt }, () => []);
    for (const [u, v, o] of bonds) { used[u] += o; used[v] += o; nbr[u].push(v); nbr[v].push(u); }
    for (let i = 0; i < nAt; i++) {
      const [el, x, y] = atoms[i], free = mbCap(el, 0).cap - used[i];
      if (free <= 0) continue;
      const L = mbBondLen(el, 'H');
      const dirs = nbr[i].length ? mbSpread(nbr[i].map(j => Math.atan2(atoms[j][2] - y, atoms[j][1] - x)), free) : Array.from({ length: free }, (_, k) => 2 * Math.PI * k / free);
      for (const t of dirs) bonds.push([i, add('H', x + L * Math.cos(t), y + L * Math.sin(t)), 1]);
    }
  } else throw new Error(`“${r.lattice}” is not a lattice the page knows (ionic, metal, honeycomb or square)`);
  let cx = 0, cy = 0; for (const a of atoms) { cx += a[1]; cy += a[2]; } cx /= atoms.length; cy /= atoms.length;
  for (const a of atoms) { a[1] = +(a[1] - cx).toFixed(2); a[2] = +(a[2] - cy).toFixed(2); }
  return { atoms, bonds, n: atoms.length };
}

/* ---- the request: memoryless, so everything Claude needs is in it */
const AI_MAX = 250;
const AI = { sample: null, busy: false, ctl: null, failed: '' };
function aiPrompt(text, prev, problem) {
  const objs = Object.values(MOLECULES).filter(m => m.cat === 'objects').map(m => `${m.key} (${m.name})`).join(', ');
  let p = `You design structures for Atom Forge, a flat (2-D) atom and molecule sandbox. It builds what you describe from a recipe, checks every valence and lays it out flat itself, so give a recipe, never coordinates.

Request: ${JSON.stringify(text)}

Reply with one JSON object and nothing else, in one of these forms:
{"type":"molecule","name":"…","smiles":"…","cat":"…","note":"…"}
{"type":"peptide","name":"…","sequence":"…","cat":"bio","note":"…"}
{"type":"lattice","name":"…","lattice":"ionic|metal|honeycomb|square","elements":["…"],"size":8,"cat":"…","note":"…"}
{"type":"object","key":"…","note":"…"}
{"type":"none","note":"…"}

Rules:
- molecule: one connected molecule as valid SMILES (no "."), at most ${AI_MAX} atoms counting hydrogens. Charges (at most ±2 per atom), isotopes such as [2H] or [13C], and any element in brackets are fine. Stereo marks are ignored: the world is flat. For a polymer, give a short chain of repeat units with sensible end groups. For a salt or another ionic solid, use an ionic lattice instead.
- peptide: a peptide or protein as one-letter amino-acid codes, 2 to 16 residues; for a bigger protein give a meaningful fragment and say which.
- lattice: ionic = a 1:1 salt, elements [cation, anion] such as ["Na","Cl"] or ["Mg","O"]; metal = a close-packed cluster of one metal or noble gas, such as ["Au"] or ["Ar"]; honeycomb = a sheet such as graphene ["C"], boron nitride ["B","N"] or an indium phosphide quantum dot ["In","P"]; square = diamond or silicon flattened to a square grid, ["C"], ["Si"] or ["Ge"]. size: atoms along one side, 4 to 14.
- object: one of these ready-made tiny objects, when it is what was asked for: ${objs}.
- none: when it is not made of a few hundred atoms at most (a car, a virus) or is not a substance; say why and suggest something related that can be built.
- cat: the library category it belongs in, one of: ${molCatList()}.
- name: a short common name, at most 40 characters. note: one or two plain sentences for a curious non-expert about what it is and anything simplified.`;
  if (problem) p += `\n\nYour previous answer was ${JSON.stringify(prev).slice(0, 2000)}\nIt could not be built: ${problem}. Reply again with a corrected JSON object.`;
  return p;
}
/* The categories Claude may file a molecule under, as key (label). */
function molCatList() { return MOLECULE_CATS.filter(c => !MOL_CAT_OFF.has(c[0])).map(c => `${c[0]} (${c[1]})`).join(', '); }
function aiText(v, n) { return typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : ''; }
/* A request that names something the library already has needs no designing. */
function aiLibraryHit(text) {
  const t = text.toLowerCase().replace(/^(an?|the|some)\s+/, '').replace(/[.!?]+$/, '').trim(), tf = t.replace(/\s+/g, '');
  if (!t) return null;
  for (const k in MOLECULES) {
    const n = MOLECULES[k].name.toLowerCase(), bare = n.replace(/\s*\(.*\)\s*$/, ''), par = (/\(([^)]*)\)\s*$/.exec(n) || [])[1];
    if (k.toLowerCase() === tf || n === t || bare === t || par === t) return k;
  }
  if (/\d/.test(tf) || tf.length <= 3) for (const k in MOLECULES) if (molPlainFormula(k).toLowerCase() === tf) return k;
  return null;
}
/* Apply Claude's answer. Returns null when it is done (built, or Claude said it cannot be), else what went wrong. */
function aiApply(r) {
  try {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return 'the reply was not one JSON object';
    const t = String(r.type || '').toLowerCase(), note = aiText(r.note, 400), name = aiText(r.name, 40);
    if (t === 'none') { aiSay(note || 'Claude could not design that.', true); return null; }
    if (t === 'object') {
      const M = MOLECULES[r.key];
      if (!M || M.cat !== 'objects') return `there is no ready-made object called "${aiText(String(r.key), 40)}"`;
      aiPick(r.key, note); return null;
    }
    if (t === 'lattice') {
      const L = designLattice(r);
      aiAddLattice(L, name || `${(Array.isArray(r.elements) ? r.elements : []).join('')} ${String(r.lattice)} lattice`.trim(), note, r.cat); return null;
    }
    let smi;
    if (t === 'peptide') smi = peptideSmiles(r.sequence);
    else if (t === 'molecule') smi = typeof r.smiles === 'string' ? r.smiles.trim() : '';
    else return `"${aiText(String(r.type), 20)}" is not one of the types asked for`;
    let G;
    try { G = designCheck(smilesGraph(smilesParse(smi))); } catch (e) { return `the SMILES ${smi.slice(0, 300)} cannot be read: ${e.message}`; }
    const n = designCount(G);
    if (n > MB_MAX) return `it has ${n} atoms counting hydrogens; at most ${MB_MAX} fit`;
    const pieces = designPieces(designFull(G));
    if (pieces > 1) return `the SMILES is ${pieces} separate pieces; give one connected molecule`;
    mbLoadDesign(G, name, note);
    MB.aiCat = t === 'peptide' && !molCatOk(r.cat) ? 'bio' : String(r.cat || ''); // (filed there by Build & use while the design is unchanged)
    const bad = MB.info && MB.info.issues;
    return bad && bad.length ? bad.map(x => x.text).join('; ') : null;
  } catch (e) { return (e && e.message) || String(e); }
}
/* Claude's molecule on the builder's workspace, ready for Build & use. The builder fills free valences with ordinary
   hydrogen; where the recipe's hydrogens differ from that (a radical, an unusual valence) they all go in as atoms
   and filling is switched off. */
function mbLoadDesign(G, name, note) {
  const full = designFull(G), pos = designLayout(full), n0 = G.atoms.length, used = new Array(n0).fill(0);
  if ($('bldModal').hidden) openMolBuilder(); // (closed while Claude was thinking: the answer opens it again)
  for (const [a, b, o] of G.bonds) { used[a] += o; used[b] += o; }
  const fill = G.atoms.every((a, i) => a.h === Math.max(0, mbCap(a.el, a.q).cap - used[i])), keep = fill ? n0 : full.atoms.length;
  mbSnap();
  MB.atoms = []; MB.bonds = []; MB.sel = null;
  const ids = [];
  for (let i = 0; i < keep; i++) {
    const a = full.atoms[i], at = { id: MB.next++, el: a.el, x: pos[i][0], y: pos[i][1], q: a.q || 0 };
    if (a.A) at.A = a.A;
    MB.atoms.push(at); ids.push(at.id);
  }
  for (const [a, b, o] of full.bonds) if (a < keep && b < keep) MB.bonds.push({ a: ids[a], b: ids[b], o });
  MB.fill = fill; MB.hA = 1;
  const f = $('bldFill'), h = $('bldHA'), nm = $('bldName');
  if (f) f.checked = fill;
  if (h) h.value = '1';
  MB.msg = ''; MB.aiNote = note; MB.aiSig = mbSig();
  mbChanged(true);
  const lm = MB.info && !MB.info.issues.length ? MB.info.lm : null;
  if (nm) nm.value = lm ? '' : name;
  aiSay(lm ? `That is ${lm.name}, already in ${molWhere(lm)}: Build & use picks it.`
    : `Claude: ${note || 'here it is.'} Check it, then Build & use.`);
}
function mbSig() { return JSON.stringify([MB.atoms.map(a => [a.id, a.el, a.q, a.A || 0]), MB.bonds.map(b => [b.a, b.b, b.o]), MB.fill, MB.hA]); }
function aiAddLattice(L, name, note, cat) {
  const k = 'my' + Date.now().toString(36) + (MB.seq++).toString(36);
  myMolAdd({ k, n: name.slice(0, 40), r: 0, a: L.atoms, b: L.bonds, d: 'Designed by Claude.' + (note ? ' ' + note : ''), c: molCatOk(cat) ? cat : molCatGuess(L.atoms, L.bonds) });
  myMolsSave();
  aiPick(k, note);
}
function aiPick(key, note) {
  hideModal('bldModal'); hideModal('molModal');
  selectSpec({ kind: 'mol', mol: key });
  log('tool', `${MOLECULES[key].name} is ready to place (${MOLECULES[key].atoms.length} atoms)${note ? '. ' + note : ''}`);
}
function aiSay(text, bad) {
  const m = $('aiMsg'); if (!m) return;
  m.hidden = !text; m.textContent = text || ''; m.classList.toggle('bad', !!bad);
}
function aiSync() {
  const box = $('aiBox'), go = $('aiGo');
  if (box) { box.hidden = !AI.sample; box.parentNode.classList.toggle('ai', !!AI.sample); }
  if (go) { go.textContent = AI.busy ? 'Stop' : 'Ask Claude'; go.classList.toggle('go', !AI.busy); }
  const ab = $('bAskSetup'); if (ab) ab.hidden = !AI.sample;
}
const AI_HIDE = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];
function aiError(e) {
  const code = (e && e.code) || 'upstream_error';
  if (code === 'cancelled') { aiSay('Stopped.'); return; }
  if (AI_HIDE.includes(code) && !(AI.sample && AI.sample.api)) {
    AI.sample = null; aiSync(); if (!$('molModal').hidden) renderMolList();
    aiSay(code === 'not_granted' ? 'Claude was not allowed to help on this page, so Ask Claude is hidden.' : 'Claude is not available here, so Ask Claude is hidden.', true);
    return;
  }
  aiSay(aiErrorText(code), true);
}
function aiErrorText(code) {
  return {
    bad_key: 'The Claude API key was refused (Settings → Claude API key).',
    bad_model: `The model name was not recognised (Settings → Claude API key; ${AI_API.model} is the default).`,
    no_credit: 'The Claude API account behind this key has no credit left.',
    rate_limited: 'Claude has reached a usage limit for now. Try again later.',
    session_expired: 'Sign in to claude.ai again, then ask.',
    refused: 'Claude declined that request. Ask for something else.',
    empty_completion: 'Claude gave no answer. Try a simpler request.',
    invalid_json: 'Claude\'s answer could not be read. Try again.',
  }[code] || (['invalid_request', 'prompt_too_large', 'transform_error', 'queue_overflow'].includes(code)
    ? `Asking Claude went wrong (${code}).` : 'Claude could not be reached. Try again.');
}
/* Ask: one request, and at most one follow-up when the recipe cannot be built (with what was wrong). */
async function aiAsk(raw) {
  if (AI.busy) { if (AI.ctl) AI.ctl.abort(); return; }
  const text = aiText(String(raw == null ? '' : raw), 200);
  if (!text) { aiSay('Type what to build first: a molecule, a protein, a crystal …', true); return; }
  const hit = aiLibraryHit(text);
  if (hit) { aiPick(hit, `${MOLECULES[hit].name} is already in ${molWhere(MOLECULES[hit])}`); return; }
  if (!AI.sample) return;
  AI.busy = true; AI.ctl = new AbortController(); aiSync();
  aiSay('Claude is thinking … this can take up to a minute.');
  const opts = () => {
    const o = { modelTier: 'default', signal: AI.ctl.signal, onText: () => aiSay('Claude is writing the recipe …') };
    if (AI.failed === text) o.cache = false; // asked again after a failure: a fresh answer, not the stored one
    return o;
  };
  try {
    let r = await AI.sample.json(aiPrompt(text), opts());
    let problem = aiApply(r);
    if (problem) {
      aiSay('Claude\'s recipe had a problem; asking for a correction …');
      r = await AI.sample.json(aiPrompt(text, r, problem), opts());
      problem = aiApply(r);
    }
    AI.failed = problem ? text : '';
    if (problem) aiSay(`Claude's design could not be built: ${problem}. Fix it by hand or ask again.`, true);
  } catch (e) { AI.failed = text; aiError(e); }
  finally { AI.busy = false; AI.ctl = null; aiSync(); }
}
/* ================================================================== Identify molecules
   Every bonded molecule in the chamber is named: by the library (same atoms joined the same way) or the formula table
   first, and the kinds neither knows are put to the viewer's Claude as SMILES (claude.ai only, as Ask Claude). Each
   molecule is tagged with its name on the canvas for a while, the kinds are counted in the log, and a named kind the
   library does not have yet is added to the library, under its category, with its shape as it is now, so it can be placed again. */
const ID_TAG_S = 12, ID_TAGS_PER_KIND = 80, ID_ASK_MAX = 12;
/* A molecule as SMILES: heavy atoms in brackets with their hydrogens folded in ([CH3], [OH-], [13CH2]); a hydrogen that
   is an isotope, charged or bonded to another hydrogen stays an atom of its own. Ring closures are numbered. */
function smilesWrite(mol) {
  const inMol = new Set(mol);
  const folded = (a) => a.el.sym === 'H' && !isoA(a) && !a.q && a.bonds.length === 1 && other(a.bonds[0], a).el.sym !== 'H' && inMol.has(other(a.bonds[0], a));
  let heavy = mol.filter(a => !folded(a));
  if (!heavy.length) heavy = mol.slice();
  const idx = new Map(heavy.map((a, i) => [a, i])), n = heavy.length;
  const nb = heavy.map(a => a.bonds.map(bd => ({ j: idx.get(other(bd, a)), o: bd.order })).filter(x => x.j !== undefined));
  const hs = heavy.map(a => a.bonds.filter(bd => !idx.has(other(bd, a)) && inMol.has(other(bd, a))).length);
  const seen = new Uint8Array(n), parent = new Int32Array(n).fill(-1), closures = heavy.map(() => []), kids = heavy.map(() => []);
  let ringN = 0;
  const ringKey = (i, j) => (i < j ? i + '-' + j : j + '-' + i), rings = new Set();
  const dfs = (i) => {
    seen[i] = 1;
    for (const { j, o } of nb[i]) {
      if (!seen[j]) { parent[j] = i; kids[i].push({ j, o }); dfs(j); }
      else if (j !== parent[i] && !rings.has(ringKey(i, j))) { rings.add(ringKey(i, j)); ringN++; closures[i].push({ n: ringN, o, first: false }); closures[j].push({ n: ringN, o, first: true }); }
    }
  };
  const start = heavy.reduce((b, a, i) => (nb[i].length < nb[b].length ? i : b), 0);
  dfs(start);
  const bondSym = (o) => (o === 2 ? '=' : o === 3 ? '#' : '');
  const tok = (i) => {
    const a = heavy[i], A = isoA(a), q = Math.round(a.q || 0), h = hs[i];
    return '[' + (A ? A : '') + a.el.sym + (h ? 'H' + (h > 1 ? h : '') : '') + (q ? (q > 0 ? '+' : '-') + (Math.abs(q) > 1 ? Math.abs(q) : '') : '') + ']';
  };
  const write = (i) => {
    let s = tok(i);
    for (const c of closures[i]) s += (c.first ? bondSym(c.o) : '') + (c.n > 9 ? '%' + c.n : c.n);
    const k = kids[i];
    for (let q = 0; q < k.length; q++) { const part = bondSym(k[q].o) + write(k[q].j); s += q < k.length - 1 ? '(' + part + ')' : part; }
    return s;
  };
  if (seen.some(v => !v)) return null; // (not one connected molecule)
  return write(start);
}
/* The kinds of molecule in the chamber: one entry per distinct named structure (or formula when unnamed), with a count,
   one instance and the library match. */
function chamberKinds() {
  const seen = new Set(), kinds = new Map();
  for (const p of W.parts) {
    if (p.dead || p.k !== NUC || !p.bonds.length || seen.has(p)) continue;
    const mol = molecule(p); for (const a of mol) seen.add(a);
    if (mol.some(a => a.k !== NUC || a.dead || !a.el)) continue;
    const lib = libMatch(mol), name = moleculeName(mol), f = isoFormula(mol), smi = smilesWrite(mol), key = (name || '') + '|' + (smi || f);
    let k = kinds.get(key);
    if (!k) { k = { name, f, smi, mol, lib, n: 0, mols: [], byClaude: false }; kinds.set(key, k); }
    k.n++; if (k.mols.length < ID_TAGS_PER_KIND) k.mols.push(mol);
  }
  return [...kinds.values()].sort((a, b) => b.n - a.n);
}
function idTag(kind) { for (const mol of kind.mols) R.molTags.push({ p: mol[0], text: kind.name, until: W.rt + ID_TAG_S }); }
/* A kind the library does not have: saved to the library (under cat, Claude's, or one guessed from its atoms) with its shape as it is now (atom coordinates relative to the
   centre, bonds and orders, isotopes and charges); false when it cannot be (an antimolecule, a stray charge, too big). */
function idToLibrary(kind, note, cat) {
  const mol = kind.mol;
  if (kind.lib || !kind.name || mol.length < 2 || mol.length > MYMOL_MAX || mol.some(a => a.anti || Math.abs(Math.round(a.q || 0)) > 2)) return false;
  if (Object.values(MOLECULES).some(m => m.name.toLowerCase() === kind.name.toLowerCase())) return false; // (a name in use: the library's shape wins)
  let cx = 0, cy = 0; for (const a of mol) { cx += a.x; cy += a.y; } cx /= mol.length; cy /= mol.length;
  const ix = new Map(mol.map((a, i) => [a, i]));
  const atoms = mol.map(a => { const r = [a.el.sym, +(a.x - cx).toFixed(2), +(a.y - cy).toFixed(2)], q = Math.round(a.q || 0), A = isoA(a); if (q || A) r.push(q); if (A) r.push(A); return r; });
  const bonds = [];
  for (const a of mol) for (const bd of a.bonds) { if (bd.a !== a) continue; const j = ix.get(bd.b); if (j !== undefined) bonds.push([ix.get(a), j, bd.order]); }
  const free = mol.some(a => capacity(a) > a.used);
  const k = 'my' + Date.now().toString(36) + (MB.seq++).toString(36);
  const m = { k, n: kind.name.slice(0, 40), r: free ? 1 : 0, a: atoms, b: bonds, d: note, c: molCatOk(cat) ? cat : molCatGuess(atoms, bonds) };
  if (!myMolValid(m)) return false;
  myMolAdd(m); kind.lib = MOLECULES[k];
  return true;
}
const fmtN = (n) => n.toLocaleString('en-US');
function idSay(text, bad) { const n = $('idNote'); if (n) { n.textContent = text || ''; n.classList.toggle('bad', !!bad); n.hidden = !text; } if (text) log('tool', text); }
function idPrompt(kinds) {
  return `You identify molecules for Atom Forge, a flat (2-D) atom and molecule sandbox. Each molecule below is given as SMILES (hydrogens folded into the heavy atoms, formal charges and isotopes marked).

${kinds.map((k, i) => `${i}: ${k.smi}`).join('\n')}

Reply with one JSON object and nothing else: {"names":[{"i":0,"name":"…","cat":"…"},…]}
Rules:
- name: the accepted common name of that exact structure (Ethanol, Acetate ion, Hydroxyl radical, Benzene), at most 40 characters, capitalised like a sentence; a systematic name when there is no common one.
- When the structure is a nameless fragment, a strained ring or a radical with no accepted name, give null instead of inventing one; a charged species gets its ion name, a radical gets "radical" in its name.
- cat: the library category the molecule belongs in, one of: ${molCatList()}.
- One entry for every index.`;
}
async function identifyMolecules() {
  const kinds = chamberKinds();
  R.molTags = [];
  if (!kinds.length) { idSay('Identify: no molecules in the chamber (nothing bonded)', true); return; }
  const named = kinds.filter(k => k.name), unnamed = kinds.filter(k => !k.name && k.smi);
  let added = [];
  for (const k of named) { idTag(k); if (idToLibrary(k, 'Identified in the chamber.')) added.push(`${k.name} (${molCatName(MOLECULES[k.lib.key].cat)})`); }
  const total = kinds.reduce((s, k) => s + k.n, 0);
  const line = (k) => `${fmtN(k.n)} × ${k.name || k.f}`;
  const summary = `Identified ${fmtN(total)} molecule${total === 1 ? '' : 's'} of ${kinds.length} kind${kinds.length === 1 ? '' : 's'}${named.length ? ': ' + named.slice(0, 12).map(line).join(', ') + (named.length > 12 ? ', …' : '') : ''}${unnamed.length ? `${named.length ? ';' : ','} unnamed: ${unnamed.slice(0, 8).map(line).join(', ')}${unnamed.length > 8 ? ', …' : ''}` : ''}`;
  idSay(summary + (named.length ? ' — named on the canvas for a few seconds' : ''));
  if (added.length) idSay(`${summary}. Added to the library: ${added.join(', ')}`);
  if (!unnamed.length) return;
  if (!AI.sample) { idSay(`${summary}. Ask Claude is not available here (no Claude access on this page and no API key in Settings), so the unnamed kind${unnamed.length === 1 ? ' keeps its formula' : 's keep their formulas'}`); return; }
  const ask = unnamed.slice(0, ID_ASK_MAX);
  if (AI.busy) { idSay('Claude is busy with a design; try Identify again in a moment', true); return; }
  AI.busy = true; AI.ctl = new AbortController(); aiSync();
  idSay(`${summary}. Asking Claude to name ${ask.length} kind${ask.length === 1 ? '' : 's'} … (the first time, the page asks your leave to use Claude)`);
  try {
    const r = await AI.sample.json(idPrompt(ask), { modelTier: 'default', signal: AI.ctl.signal });
    const list = r && Array.isArray(r.names) ? r.names : [];
    added = []; const got = [];
    for (const e of list) {
      if (!e || !Number.isInteger(e.i) || e.i < 0 || e.i >= ask.length) continue;
      const name = aiText(e.name, 40); if (!name) continue;
      const k = ask[e.i]; if (k.name) continue;
      k.name = name; k.byClaude = true; got.push(`${fmtN(k.n)} × ${name} (${k.f})`);
      idTag(k); if (idToLibrary(k, 'Identified by Claude from its structure.', e.cat)) added.push(`${name} (${molCatName(MOLECULES[k.lib.key].cat)})`);
    }
    idSay(got.length ? `Claude named: ${got.join(', ')}${added.length ? ` — added to the library: ${added.join(', ')}` : ''}` : 'Claude could not put a name to them (fragments with no accepted name)', !got.length);
  } catch (e) {
    const code = (e && e.code) || 'upstream_error';
    idSay(code === 'cancelled' ? 'Stopped.' : code === 'not_granted' ? 'Claude was not allowed to help on this page, so the unnamed kinds keep their formulas.' : code === 'declined' ? 'You declined; the unnamed kinds keep their formulas.' : code === 'rate_limited' ? 'Claude has reached a usage limit for now; try again later.' : code === 'bad_key' ? 'The Claude API key was refused (Settings → Claude API key).' : code === 'invalid_json' || code === 'empty_completion' ? 'Claude\'s answer could not be read; try again.' : `Claude could not be reached (${code}); try again.`, true);
    if (AI_HIDE.includes(code) && !(AI.sample && AI.sample.api)) { AI.sample = null; aiSync(); }
  }
  finally { AI.busy = false; AI.ctl = null; aiSync(); }
}
/* ---- the Claude API with the viewer's own key (Settings → Claude API key), where the page has no Claude of its own:
   the desktop app, or a copy of the page served elsewhere. Same shape as the `sample` capability: json(prompt, opts).
   The key is kept in this browser's storage only and sent to api.anthropic.com alone; use is billed to that account. */
const AI_API = { url: 'https://api.anthropic.com/v1/messages', version: '2023-06-01', model: 'claude-sonnet-5-5', maxTokens: 1500 };
function apiSampler(key, model) {
  const call = async (prompt, opts) => {
    const body = { model: model || AI_API.model, max_tokens: AI_API.maxTokens, messages: [{ role: 'user', content: prompt }] };
    let res;
    try {
      res = await fetch(AI_API.url, { method: 'POST', signal: opts && opts.signal, headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': AI_API.version, 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body) });
    } catch (e) { throw { code: e && e.name === 'AbortError' ? 'cancelled' : 'upstream_error', message: String(e && e.message || e) }; }
    if (!res.ok) {
      let detail = ''; try { const j = await res.json(); detail = j && j.error && j.error.message || ''; } catch (e) { /* (no body) */ }
      const code = res.status === 401 || res.status === 403 ? 'bad_key' : res.status === 429 ? 'rate_limited' : res.status === 404 ? 'bad_model' : res.status === 400 && /credit|billing/i.test(detail) ? 'no_credit' : 'upstream_error';
      throw { code, message: detail || ('HTTP ' + res.status) };
    }
    const j = await res.json();
    const text = (j && Array.isArray(j.content) ? j.content : []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!text) throw { code: 'empty_completion', message: 'no text' };
    if (opts && opts.onText) opts.onText({ text, delta: text });
    return text;
  };
  // the same shape as claude.ai's sample: called for text, .json for data
  const f = async (prompt, opts) => ({ text: await call(prompt, opts), truncated: false });
  f.api = true;
  f.json = async (prompt, opts) => {
    const text = await call(prompt, opts);
    const m = /\{[\s\S]*\}/.exec(text.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, ''));
    try { return JSON.parse(m ? m[0] : text); } catch (e) { throw { code: 'invalid_json', message: text.slice(0, 200) }; }
  };
  return f;
}
/* Ask Claude for a setup: a description in, a recipe out (JSON: the box, bath, fields and a list of things to put in —
   library molecules by key, elements and ions, particles, lattices, ready-made objects, projectiles), built here and
   checked; one follow-up with what was wrong when it cannot be built. The setup becomes the "Claude's setup" entry of the
   setup list (Restart rebuilds it). */
const ASK = { busy: false, ctl: null, last: null };
const ASK_MAX = 2500, ASK_EX = ['Sodium and chlorine reacting into salt', 'A hydrogen–oxygen explosion', 'Alpha particles fired at gold atoms (Rutherford)', 'Water boiling', 'A neon sign', 'Methane burning in oxygen', 'Positrons meeting electrons', 'Ice melting'];
const ASK_PART = { e: { kind: 'e' }, electron: { kind: 'e' }, pos: { kind: 'pos' }, positron: { kind: 'pos' }, n: { kind: 'n' }, neutron: { kind: 'n' },
  p: { kind: 'atom', Z: 1, A: 1, bare: true }, proton: { kind: 'atom', Z: 1, A: 1, bare: true }, alpha: { kind: 'atom', Z: 2, A: 4, bare: true },
  deuteron: { kind: 'atom', Z: 1, A: 2, bare: true }, triton: { kind: 'atom', Z: 1, A: 3, bare: true } };
function askPrompt(text, prev, problem) {
  const mols = Object.values(MOLECULES).filter(m => m.cat !== 'objects').map(m => `${m.key}=${m.name}`).join('; ');
  const objs = Object.values(MOLECULES).filter(m => m.cat === 'objects').map(m => `${m.key}=${m.name}`).join('; ');
  let p = `You set up experiments in Atom Forge, a flat (2-D) atom, molecule and particle simulator. Distances are in ångströms (Å); an atom is about 1–2 Å across, a small molecule 3–5 Å. The simulator handles chemistry (bonds form and break, reactions, heat), ionization and light, nuclear reactions (fusion, fission, decay), antimatter and fields.

Experiment asked for: ${JSON.stringify(text)}

Reply with one JSON object and nothing else:
{"name":"short title","note":"one to three plain sentences: what will happen and what to watch for",
 "box":{"w":80,"h":60},"walls":"reflect|wrap|open","T":300,"bath":"insulated|gentle|normal|strong",
 "E":0,"Edir":0,"B":0,"glow":false,
 "items":[ … ]}

Each item is one of:
{"what":"molecule","key":"H2O","count":30,"region":"all"}  — key from the library below
{"what":"atom","el":"Na","count":10,"charge":0,"A":0,"region":"left"}  — any element symbol; charge for an ion; A for an isotope (0 = the usual one)
{"what":"particle","kind":"e|pos|n|p|alpha|deuteron|triton","count":5,"region":"all"}
{"what":"lattice","lattice":"ionic|metal|honeycomb|square","elements":["Na","Cl"],"size":6,"x":0,"y":0}  — a small crystal or sheet
{"what":"object","key":"saltcrystal","x":0,"y":0}  — a ready-made object below
{"what":"shoot","kind":"alpha","el":"","energy_eV":5000000,"from":"left|right|top|bottom","count":3}  — projectiles fired into the box (kind as for particle, or el for a bare nucleus of that element)

Rules: region is all, left, right, top, bottom or center. T is the starting and bath temperature in kelvin (1 to 1e9; molecules fall apart above a few thousand K, atoms ionize above ~10,000 K, fusion needs ~1e8 K in a dense plasma). E is an electric field in V/Å (0 to 50), Edir its direction in degrees; B a magnetic field in tesla out of the screen. glow makes reflecting walls give off black-body light at T. Keep it small enough to run smoothly: at most ${ASK_MAX} atoms and particles in all, and a box whose area leaves the molecules room (a gas: about 30–100 Å² per molecule; a liquid: about 10). Choose amounts that show the experiment within seconds.

Library molecules (key=name): ${mols}

Ready-made objects: ${objs}`;
  if (problem) p += `\n\nYour previous answer was ${JSON.stringify(prev).slice(0, 3000)}\nIt could not be built: ${problem}. Reply again with a corrected JSON object.`;
  return p;
}
/* Build a recipe into the world: null when done, or what was wrong (for Claude to fix). check: only check, build nothing. */
function askBuild(r, check) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'the reply was not one JSON object';
  const num = (v, lo, hi, d) => (Number.isFinite(+v) && v !== null && v !== '' ? clamp(+v, lo, hi) : d);
  const items = Array.isArray(r.items) ? r.items.slice(0, 40) : [];
  if (!items.length) return 'there are no items to put in the box';
  const w = num(r.box && r.box.w, 20, 2000, 80), h = num(r.box && r.box.h, 20, 2000, 60), T = num(r.T, 1, 1e9, 300);
  let total = 0; const probs = [];
  const specOf = (it) => {
    if (it.el) { const Z = SYM2Z[String(it.el).trim()]; return Z ? { kind: 'atom', Z, A: Math.round(num(it.A, 0, 300, 0)) || COMMON_A[Z], bare: true } : null; }
    return ASK_PART[String(it.kind || '').toLowerCase()] || null;
  };
  for (const it of items) {
    const what = String(it && it.what || '').toLowerCase(), n = Math.round(num(it.count, 1, ASK_MAX, 1));
    if (what === 'molecule') { const M = MOLECULES[it.key]; if (!M || M.cat === 'objects') probs.push(`"${aiText(String(it.key), 30)}" is not a library molecule key`); else total += n * M.atoms.length; }
    else if (what === 'atom') { if (!SYM2Z[String(it.el || '').trim()]) probs.push(`"${aiText(String(it.el), 10)}" is not an element symbol`); else total += n; }
    else if (what === 'particle') { if (!ASK_PART[String(it.kind || '').toLowerCase()]) probs.push(`"${aiText(String(it.kind), 12)}" is not a particle kind`); else total += n; }
    else if (what === 'object') { const M = MOLECULES[it.key]; if (!M || M.cat !== 'objects') probs.push(`"${aiText(String(it.key), 30)}" is not a ready-made object`); else total += M.atoms.length; }
    else if (what === 'lattice') { try { const L = designLattice(it); total += L.atoms.length; } catch (e) { probs.push(`the lattice cannot be made: ${e.message}`); } }
    else if (what === 'shoot') { if (!specOf(it)) probs.push('a projectile needs a particle kind or an element'); else total += Math.round(num(it.count, 1, 50, 1)); }
    else probs.push(`"${aiText(String(it && it.what), 12)}" is not an item type`);
  }
  if (total > ASK_MAX) probs.push(`that is ${total} atoms and particles; at most ${ASK_MAX}`);
  if (probs.length) return probs.slice(0, 5).join('; ');
  if (check) return null;
  // build
  baseWorld(w, h, T, { insulated: 0, gentle: 0.005, normal: 0.05, strong: 0.3 }[String(r.bath)] ?? 0.05);
  W.wall = ['reflect', 'wrap', 'open'].includes(r.walls) ? r.walls : 'reflect';
  const E = num(r.E, 0, 50, 0), ang = num(r.Edir, -360, 360, 0) * Math.PI / 180;
  W.Ex = E * Math.cos(ang); W.Ey = E * Math.sin(ang); UI.E = E; UI.Eang = Math.round(num(r.Edir, -360, 360, 0)); W.Bz = num(r.B, -1e5, 1e5, 0); W.glow = r.glow === true;
  const reg = (name) => { const R2 = { all: [0, 0, w, h], left: [-w / 4, 0, w / 2, h], right: [w / 4, 0, w / 2, h], top: [0, h / 4, w, h / 2], bottom: [0, -h / 4, w, h / 2], center: [0, 0, w / 2, h / 2] }; return R2[String(name || 'all').toLowerCase()] || R2.all; };
  const placed = [];
  const spot = (rg, rad) => { const [cx, cy, rw, rh] = rg; let best = null, bd = -1;
    for (let k = 0; k < 30; k++) { const x = cx + (rnd() - 0.5) * Math.max(0, rw - 2 * rad - 2), y = cy + (rnd() - 0.5) * Math.max(0, rh - 2 * rad - 2);
      let d = Infinity; for (const [px, py, pr] of placed) d = Math.min(d, Math.hypot(px - x, py - y) - pr - rad); if (d > 1.2) { best = [x, y]; break; } if (d > bd) { bd = d; best = [x, y]; } }
    placed.push([best[0], best[1], rad]); return best; };
  const molR = (M) => { let cx = 0, cy = 0; for (const a of M.atoms) { cx += a[1]; cy += a[2]; } cx /= M.atoms.length; cy /= M.atoms.length; let r2 = 0; for (const a of M.atoms) r2 = Math.max(r2, Math.hypot(a[1] - cx, a[2] - cy)); return r2 + 1; };
  const placeL = (L, x, y) => { let cx = 0, cy = 0; for (const a of L.atoms) { cx += a[1]; cy += a[2]; } cx /= L.atoms.length; cy /= L.atoms.length;
    const ps = L.atoms.map(([el, ax, ay, q]) => addAtom(el, x + ax - cx, y + ay - cy, { charge: q || 0 })); for (const [i, j, o] of L.bonds) addBond(ps[i], ps[j], o); };
  const shots = [];
  for (const it of items) {
    const what = String(it.what).toLowerCase(), n = Math.round(num(it.count, 1, ASK_MAX, 1)), rg = reg(it.region);
    if (what === 'molecule') { const M = MOLECULES[it.key], rad = molR(M); for (let i = 0; i < n; i++) { const [x, y] = spot(rg, rad); addMolecule(it.key, x, y, rnd() * 2 * Math.PI); } }
    else if (what === 'atom') { const el = String(it.el).trim(), q = Math.round(num(it.charge, -3, SYM2Z[el], 0)), A = Math.round(num(it.A, 0, 300, 0)); for (let i = 0; i < n; i++) { const [x, y] = spot(rg, 1.2); addAtom(el, x, y, { charge: q, A: A || 0 }); } }
    else if (what === 'particle') { const sp = ASK_PART[String(it.kind).toLowerCase()]; for (let i = 0; i < n; i++) { const [x, y] = spot(rg, 0.8); spawnSpec(sp, x, y); } }
    else if (what === 'object') { const M = MOLECULES[it.key]; addMolecule(it.key, clamp(num(it.x, -1e4, 1e4, 0), -w / 2 + molR(M), w / 2 - molR(M)), clamp(num(it.y, -1e4, 1e4, 0), -h / 2 + molR(M), h / 2 - molR(M)), 0); placed.push([num(it.x, -1e4, 1e4, 0), num(it.y, -1e4, 1e4, 0), molR(M)]); }
    else if (what === 'lattice') { const L = designLattice(it); const R3 = molR(L); placeL(L, clamp(num(it.x, -1e4, 1e4, 0), -w / 2 + R3, w / 2 - R3), clamp(num(it.y, -1e4, 1e4, 0), -h / 2 + R3, h / 2 - R3)); placed.push([num(it.x, -1e4, 1e4, 0), num(it.y, -1e4, 1e4, 0), R3]); }
    else if (what === 'shoot') shots.push(it);
  }
  settleOverlaps();
  for (const it of shots) { // fired in from a side, spread along it, towards the far side
    const sp = specOf(it), KE = num(it.energy_eV, 0.01, 1e12, 1e6), from = String(it.from || 'left').toLowerCase(), n = Math.round(num(it.count, 1, 50, 1));
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n - 0.5, m = 2;
      const [x, y, ux, uy] = from === 'right' ? [w / 2 - m, s * h * 0.6, -1, 0] : from === 'top' ? [s * w * 0.6, h / 2 - m, 0, -1] : from === 'bottom' ? [s * w * 0.6, -h / 2 + m, 0, 1] : [-w / 2 + m, s * h * 0.6, 1, 0];
      fireSpec(sp, x, y, ux, uy, KE, false);
    }
  }
  return null;
}
async function askRun() {
  if (ASK.busy) { if (ASK.ctl) ASK.ctl.abort(); return; }
  const text = aiText($('askText').value, 400), say = (t, bad) => { $('askMsg').textContent = t; $('askMsg').classList.toggle('bad', !!bad); };
  if (!text) { say('Describe the experiment first.', true); return; }
  if (!AI.sample) { say('Claude is not connected here.', true); return; }
  ASK.busy = true; ASK.ctl = new AbortController(); $('askGo').textContent = 'Stop'; say('Claude is designing the setup … this can take up to a minute.');
  const opts = () => ({ modelTier: 'default', signal: ASK.ctl.signal, cache: false, onText: () => say('Claude is writing the setup …') });
  try {
    let r = await AI.sample.json(askPrompt(text), opts()), bad = askBuild(r, true);
    if (bad) { say(`Fixing: ${bad} …`); const r2 = await AI.sample.json(askPrompt(text, r, bad), opts()); const bad2 = askBuild(r2, true); if (bad2) { say(`Claude's setup could not be built: ${bad2}. Try describing it differently.`, true); return; } r = r2; }
    ASK.last = r;
    PRESETS.ai = { group: 'Claude', name: '✦ ' + (aiText(r.name, 40) || 'Claude’s setup'), tool: 'place', spec: { kind: 'atom', Z: 1, A: 1, bare: true },
      hint: `<b>${esc(aiText(r.name, 60) || 'Claude’s setup')}.</b> ${esc(aiText(r.note, 400))} <i>(Set up by Claude from “${esc(text)}”; Restart builds it again.)</i>`,
      build() { const e = askBuild(ASK.last, false); if (e) baseWorld(80, 60, 300, 0.05); } };
    buildPresetSelect(); loadPreset('ai'); setRunning(true);
    hideModal('askModal'); say('');
  } catch (e) {
    const code = (e && e.code) || 'upstream_error';
    say(code === 'cancelled' ? 'Stopped.' : aiErrorText(code), code !== 'cancelled');
  } finally { ASK.busy = false; ASK.ctl = null; $('askGo').textContent = 'Set it up'; }
}
function askInit() {
  $('bAskSetup').onclick = () => { showModal('askModal'); $('askText').focus(); };
  $('askClose').onclick = () => hideModal('askModal');
  $('askGo').onclick = () => askRun();
  $('askText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askRun(); } e.stopPropagation(); });
  $('askEx').innerHTML = ASK_EX.map(t => `<button class="chip" type="button">${esc(t)}</button>`).join('');
  $('askEx').onclick = (e) => { const b = e.target.closest('button'); if (b) { $('askText').value = b.textContent; $('askText').focus(); } };
  aiSync();
}
function aiInit() {
  const c = typeof window !== 'undefined' ? window.claude : null;
  const key = typeof SET !== 'undefined' && SET.apiKey ? String(SET.apiKey).trim() : '';
  const own = () => { AI.sample = key ? apiSampler(key, SET.apiModel) : null; aiSync(); if (!$('molModal').hidden) renderMolList(); };
  if (!c || typeof c.use !== 'function') { own(); return; }
  Promise.resolve().then(() => c.use('sample')).then((s) => {
    if (s) { AI.sample = s; aiSync(); if (!$('molModal').hidden) renderMolList(); } else own();
  }, own);
}
