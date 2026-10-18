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
{"type":"molecule","name":"…","smiles":"…","note":"…"}
{"type":"peptide","name":"…","sequence":"…","note":"…"}
{"type":"lattice","name":"…","lattice":"ionic|metal|honeycomb|square","elements":["…"],"size":8,"note":"…"}
{"type":"object","key":"…","note":"…"}
{"type":"none","note":"…"}

Rules:
- molecule: one connected molecule as valid SMILES (no "."), at most ${AI_MAX} atoms counting hydrogens. Charges (at most ±2 per atom), isotopes such as [2H] or [13C], and any element in brackets are fine. Stereo marks are ignored: the world is flat. For a polymer, give a short chain of repeat units with sensible end groups. For a salt or another ionic solid, use an ionic lattice instead.
- peptide: a peptide or protein as one-letter amino-acid codes, 2 to 16 residues; for a bigger protein give a meaningful fragment and say which.
- lattice: ionic = a 1:1 salt, elements [cation, anion] such as ["Na","Cl"] or ["Mg","O"]; metal = a close-packed cluster of one metal or noble gas, such as ["Au"] or ["Ar"]; honeycomb = a sheet such as graphene ["C"], boron nitride ["B","N"] or an indium phosphide quantum dot ["In","P"]; square = diamond or silicon flattened to a square grid, ["C"], ["Si"] or ["Ge"]. size: atoms along one side, 4 to 14.
- object: one of these ready-made tiny objects, when it is what was asked for: ${objs}.
- none: when it is not made of a few hundred atoms at most (a car, a virus) or is not a substance; say why and suggest something related that can be built.
- name: a short common name, at most 40 characters. note: one or two plain sentences for a curious non-expert about what it is and anything simplified.`;
  if (problem) p += `\n\nYour previous answer was ${JSON.stringify(prev).slice(0, 2000)}\nIt could not be built: ${problem}. Reply again with a corrected JSON object.`;
  return p;
}
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
      aiAddLattice(L, name || `${(Array.isArray(r.elements) ? r.elements : []).join('')} ${String(r.lattice)} lattice`.trim(), note); return null;
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
  aiSay(lm ? `That is ${lm.name}, already ${lm.cat === 'custom' ? 'in My molecules' : 'in the library'}: Build & use picks it.`
    : `Claude: ${note || 'here it is.'} Check it, then Build & use.`);
}
function mbSig() { return JSON.stringify([MB.atoms.map(a => [a.id, a.el, a.q, a.A || 0]), MB.bonds.map(b => [b.a, b.b, b.o]), MB.fill, MB.hA]); }
function aiAddLattice(L, name, note) {
  const k = 'my' + Date.now().toString(36) + (MB.seq++).toString(36);
  myMolAdd({ k, n: name.slice(0, 40), r: 0, a: L.atoms, b: L.bonds, d: 'Designed by Claude.' + (note ? ' ' + note : '') });
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
}
const AI_HIDE = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];
function aiError(e) {
  const code = (e && e.code) || 'upstream_error';
  if (code === 'cancelled') { aiSay('Stopped.'); return; }
  if (AI_HIDE.includes(code)) {
    AI.sample = null; aiSync(); if (!$('molModal').hidden) renderMolList();
    aiSay(code === 'not_granted' ? 'Claude was not allowed to help on this page, so Ask Claude is hidden.' : 'Claude is not available here, so Ask Claude is hidden.', true);
    return;
  }
  aiSay({
    rate_limited: 'Claude has reached a usage limit for now. Try again later.',
    session_expired: 'Sign in to claude.ai again, then ask.',
    refused: 'Claude declined that request. Ask for something else.',
    empty_completion: 'Claude gave no answer. Try a simpler request.',
    invalid_json: 'Claude\'s answer could not be read. Try again.',
  }[code] || (['invalid_request', 'prompt_too_large', 'transform_error', 'queue_overflow'].includes(code)
    ? `Asking Claude went wrong (${code}).` : 'Claude could not be reached. Try again.'), true);
}
/* Ask: one request, and at most one follow-up when the recipe cannot be built (with what was wrong). */
async function aiAsk(raw) {
  if (AI.busy) { if (AI.ctl) AI.ctl.abort(); return; }
  const text = aiText(String(raw == null ? '' : raw), 200);
  if (!text) { aiSay('Type what to build first: a molecule, a protein, a crystal …', true); return; }
  const hit = aiLibraryHit(text);
  if (hit) { aiPick(hit, `${MOLECULES[hit].name} is already in the ${MOLECULES[hit].cat === 'custom' ? 'My molecules list' : 'library'}`); return; }
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
function aiInit() {
  const c = typeof window !== 'undefined' ? window.claude : null;
  if (!c || typeof c.use !== 'function') return;
  Promise.resolve().then(() => c.use('sample')).then((s) => {
    AI.sample = s || null; aiSync();
    if (AI.sample && !$('molModal').hidden) renderMolList();
  }, () => {});
}
