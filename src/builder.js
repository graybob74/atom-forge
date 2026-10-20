'use strict';
/* ============================================================================
   Atom Forge — drag-and-drop builders
   Molecule builder: drag atoms, charges and rings onto a workspace, drop one atom onto another to bond them.
   Isotope builder: drag protons, neutrons and electrons into an atom, or back out of it.
   Both use only what the page already has (the engine's bonding rules and forces, the nuclide data behind the
   periodic table). Nothing here runs until a builder is opened.
   ========================================================================== */

/* ------------------------------------------------------------------ shared: one pointer gesture at a time */
const GST = { noClick: 0 };
/* Follows one press from pointerdown to release on el (which captures the pointer). A press that never moves
   more than a few pixels is a tap: the element's own click handler deals with it, so a mouse, a finger and the
   keyboard all go through the same path. */
function trackPointer(el, e, h) {
  const id = e.pointerId, x0 = e.clientX, y0 = e.clientY;
  let moved = false;
  try { if (el.setPointerCapture && id !== undefined) el.setPointerCapture(id); } catch (err) { /* capture is optional */ }
  const done = () => { el.onpointermove = null; el.onpointerup = null; el.onpointercancel = null; };
  el.onpointermove = (ev) => {
    if (ev.pointerId !== id) return;
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6) moved = true;
    if (moved) h.move(ev);
  };
  el.onpointerup = (ev) => {
    if (ev.pointerId !== id) return;
    done();
    if (moved) GST.noClick = performance.now() + 450; // the click that may follow a drag is not a tap
    h.up(ev, moved);
  };
  el.onpointercancel = (ev) => { if (ev.pointerId !== id) return; done(); h.cancel(); };
}
function clickOk() { return performance.now() >= GST.noClick; }
function ghostShow(html, x, y) { const g = $('dragGhost'); g.innerHTML = html; g.className = 'ghost'; g.hidden = false; ghostMove(x, y); }
function ghostMove(x, y) { const g = $('dragGhost'); g.style.left = x + 'px'; g.style.top = y + 'px'; }
function ghostMark(state) { const g = $('dragGhost'); g.classList.toggle('away', state === 'away'); g.classList.toggle('del', state === 'del'); }
function ghostHide() { const g = $('dragGhost'); g.hidden = true; g.innerHTML = ''; }
function localXY(cv, e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function fitCanvas(cv, host, S) { // backing store matched to the box on screen; true when it changed
  const r = host.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(60, Math.round(r.width)), h = Math.max(60, Math.round(r.height));
  if (w === S.w && h === S.h && dpr === S.dpr && S.ready) return false;
  S.w = w; S.h = h; S.dpr = dpr; S.ready = true;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  return true;
}
function shadeBall(ctx, x, y, r, hex, alpha) { // a lit sphere, as the chamber draws particles
  const [cr, cg, cb] = hexc(hex);
  if (r >= 2.5) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, `rgb(${Math.min(255, cr + 80)},${Math.min(255, cg + 80)},${Math.min(255, cb + 80)})`);
    g.addColorStop(0.5, `rgb(${cr},${cg},${cb})`);
    g.addColorStop(1, `rgb(${Math.round(cr * 0.5)},${Math.round(cg * 0.5)},${Math.round(cb * 0.5)})`);
    ctx.fillStyle = g;
  } else ctx.fillStyle = hex;
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}
function ballCSS(hex) { // the same lit sphere for an HTML element (drag ghosts, bins)
  const [r, g, b] = hexc(hex), lo = (v) => Math.round(v * 0.5), hi = (v) => Math.min(255, v + 80);
  return `background:radial-gradient(circle at 35% 30%, rgb(${hi(r)},${hi(g)},${hi(b)}), rgb(${r},${g},${b}) 50%, rgb(${lo(r)},${lo(g)},${lo(b)}))`;
}
const CH_FONT = '"Hanken Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif';

/* ================================================================== molecule builder */
const MB_ELEMENTS = ['C', 'H', 'O', 'N', 'S', 'P', 'F', 'Cl', 'Br', 'I', 'B', 'Si'];
const MB_RINGS = [[3, false, 'Three-membered ring'], [4, false, 'Four-membered ring'], [5, false, 'Five-membered ring'],
  [6, false, 'Six-membered ring'], [6, true, 'Benzene ring']];
const MB_MAX = 300; // atoms, hydrogens included
const MYMOL_MAX = 2000; // a saved molecule (Claude's lattices are bigger than anything drawn by hand)
const mbTries = (n, most) => (n > 180 ? 2 : n > 90 ? 3 : most); // fewer fresh layouts for big molecules: each one costs more
const MB_KEEP = ['parts', 'bonds', 'evq', 'box', 'wall', 'Ex', 'Ey', 'Bz', 'magnets', 'tool', 'grab', 'T', 'gamma', 'spawned'];
/* The drawing: atoms { id, el, x, y (Å, y up), q }, bonds { a, b (atom ids), o (order) }. */
const MB = { atoms: [], bonds: [], next: 1, sel: null, undo: [], fill: true, cx: 0, cy: 0, s: 40, w: 600, h: 400, dpr: 1,
  ready: false, palOK: false, drag: null, hover: null, info: null, msg: '', msgBad: false, seq: 0, extra: [], more: false,
  hA: 1, isoKey: '' }; // hA: mass number of the hydrogens that fill in (¹H, ²H or ³H)
const MB_EXTRA_MAX = 8; // other elements used lately, kept in the row
const _mbCap = new Map();
/* The engine's own bonding capacity for an element at a given charge, and its expanded-octet limit. */
function mbCap(sym, q) {
  const k = sym + '|' + q;
  let c = _mbCap.get(k);
  if (!c) {
    const Z = SYM2Z[sym], ne = Z - q;
    if (ne <= 0) c = { cap: 0, hyper: 0 };
    else {
      const vi = valenceInfo(Z, ne), p = { el: ELEMENTS[Z], Z, ne, q, val: vi.v, nOut: vi.n };
      p.cap = capacity(p);
      c = { cap: p.cap, hyper: Math.max(p.cap, hyperCap(p)) };
    }
    _mbCap.set(k, c);
  }
  return c;
}
function mbAtom(id) { for (const a of MB.atoms) if (a.id === id) return a; return null; }
function mbBondOf(a, b) { for (const bd of MB.bonds) if ((bd.a === a && bd.b === b) || (bd.a === b && bd.b === a)) return bd; return null; }
function mbNbrs(id) { const out = []; for (const bd of MB.bonds) { if (bd.a === id) out.push(mbAtom(bd.b)); else if (bd.b === id) out.push(mbAtom(bd.a)); } return out; }
function mbUsed(id) { let u = 0; for (const bd of MB.bonds) if (bd.a === id || bd.b === id) u += bd.o; return u; }
function mbLimit(a) { // as the engine: more than the octet only next to a strongly electronegative partner
  const c = mbCap(a.el, a.q);
  return mbNbrs(a.id).some(o => (ELEMENTS[SYM2Z[o.el]].en || 0) >= 3.0) ? c.hyper : c.cap;
}
function mbImplicitH(a) { return MB.fill ? Math.max(0, mbCap(a.el, a.q).cap - mbUsed(a.id)) : 0; }
function mbFree(a) { return MB.fill ? 0 : Math.max(0, mbCap(a.el, a.q).cap - mbUsed(a.id)); }
const mbIsoA = (a) => (a.A && a.A !== COMMON_A[SYM2Z[a.el]] ? a.A : 0); // an isotope other than the usual one
function mbLabel(a) { return (mbIsoA(a) ? sup(a.A) : '') + a.el + (a.q ? sup((Math.abs(a.q) > 1 ? Math.abs(a.q) : '') + (a.q > 0 ? '+' : '-')) : ''); }
function mbNorm(t) { t %= 2 * Math.PI; return t < 0 ? t + 2 * Math.PI : t; }
/* k new directions spread through the gaps between existing ones: each goes to the gap with the most room per
   direction, and a gap's directions share it evenly (one neighbour + 3 → a cross, + 2 → 120° apart). */
function mbSpread(angs, k) {
  const a = angs.map(mbNorm).sort((u, v) => u - v);
  const gaps = a.map((t, s) => ({ t, g: (s === a.length - 1 ? a[0] + 2 * Math.PI : a[s + 1]) - t, c: 0 }));
  for (let i = 0; i < k; i++) {
    let best = null;
    for (const G of gaps) {
      const r = G.g / (G.c + 1), rb = best ? best.g / (best.c + 1) : -1;
      if (r > rb + 1e-9 || (Math.abs(r - rb) <= 1e-9 && G.g > best.g)) best = G;
    }
    best.c++;
  }
  const out = [];
  for (const G of gaps) for (let i = 1; i <= G.c; i++) out.push(G.t + G.g * i / (G.c + 1));
  return out;
}
const MB_LONE = { 1: [0], 2: [Math.PI * 7 / 6, -Math.PI / 6], 3: [Math.PI / 2, Math.PI * 7 / 6, -Math.PI / 6],
  4: [Math.PI / 4, Math.PI * 3 / 4, Math.PI * 5 / 4, Math.PI * 7 / 4] };
function mbHDirs(a, k) { // where the hydrogens that fill an atom's free valence go
  const nb = mbNbrs(a.id);
  if (!nb.length) { if (MB_LONE[k]) return MB_LONE[k]; const o = []; for (let i = 0; i < k; i++) o.push(Math.PI / 2 + i * 2 * Math.PI / k); return o; }
  return mbSpread(nb.map(o => Math.atan2(o.y - a.y, o.x - a.x)), k);
}
/* Direction for a new substituent on T: a chain carries on in a zig-zag, anything else takes the widest gap. */
function mbAttachDir(T) {
  const nb = mbNbrs(T.id);
  if (!nb.length) return Math.PI / 6;
  if (nb.length === 1) {
    const P = nb[0], back = Math.atan2(P.y - T.y, P.x - T.x), c1 = back + 2 * Math.PI / 3, c2 = back - 2 * Math.PI / 3;
    const Q = mbNbrs(P.id).find(o => o.id !== T.id);
    if (!Q) return Math.sin(c1) >= Math.sin(c2) ? c1 : c2;
    const side = (px, py) => Math.sign((T.x - P.x) * (py - P.y) - (T.y - P.y) * (px - P.x));
    const sQ = side(Q.x, Q.y);
    return side(T.x + Math.cos(c1), T.y + Math.sin(c1)) !== sQ ? c1 : c2; // the far side from Q: anti, as in a zig-zag
  }
  return mbSpread(nb.map(o => Math.atan2(o.y - T.y, o.x - T.x)), 1)[0];
}
function mbBondLen(s1, s2, o) { return bondLength(ELEMENTS[SYM2Z[s1]], ELEMENTS[SYM2Z[s2]], o || 1); }

/* ---- edits (each one takes an undo snapshot first) */
function mbSnap() { MB.undo.push(JSON.stringify({ a: MB.atoms, b: MB.bonds, n: MB.next })); if (MB.undo.length > 80) MB.undo.shift(); }
function mbUndo() {
  const s = MB.undo.pop(); if (!s) return;
  const o = JSON.parse(s); MB.atoms = o.a; MB.bonds = o.b; MB.next = o.n; MB.msg = '';
  mbChanged();
}
function mbSay(text, bad) { MB.msg = text; MB.msgBad = !!bad; mbRenderInfo(); }
function mbNewAtom(sym, x, y) { const a = { id: MB.next++, el: sym, x, y, q: 0 }; MB.atoms.push(a); return a; }
function mbFreeSpot() { // somewhere clear for an atom that has nowhere particular to go
  if (!MB.atoms.length) return [MB.cx, MB.cy];
  let x1 = -Infinity, y = 0; for (const a of MB.atoms) { x1 = Math.max(x1, a.x); y += a.y; }
  return [x1 + 2.2, y / MB.atoms.length];
}
function mbAttach(sym, tid) {
  const T = mbAtom(tid); if (!T) return null;
  const t = mbAttachDir(T), L = mbBondLen(T.el, sym);
  const a = mbNewAtom(sym, T.x + L * Math.cos(t), T.y + L * Math.sin(t));
  MB.bonds.push({ a: T.id, b: a.id, o: 1 });
  return a;
}
/* A ring of carbons, standing alone or hung off atom T by a single bond. Benzene gets alternating double bonds. */
function mbAddRing(n, arom, x, y, tid) {
  const L = arom ? 1.4 : 1.5, R = L / (2 * Math.sin(Math.PI / n)), T = tid ? mbAtom(tid) : null;
  let cx = x, cy = y, th0 = Math.PI / 2;
  if (T) {
    const t = mbAttachDir(T), L1 = mbBondLen(T.el, 'C');
    cx = T.x + (L1 + R) * Math.cos(t); cy = T.y + (L1 + R) * Math.sin(t); th0 = t + Math.PI;
  }
  const ids = [];
  for (let k = 0; k < n; k++) { const t = th0 + 2 * Math.PI * k / n; ids.push(mbNewAtom('C', cx + R * Math.cos(t), cy + R * Math.sin(t)).id); }
  for (let k = 0; k < n; k++) MB.bonds.push({ a: ids[k], b: ids[(k + 1) % n], o: arom && k % 2 === 0 ? 2 : 1 });
  if (T) MB.bonds.push({ a: T.id, b: ids[0], o: 1 });
  return ids;
}
/* Bond a to b, or make an existing bond one order higher. False when it is already triple. */
function mbJoin(aid, bid) {
  const bd = mbBondOf(aid, bid);
  if (bd) { if (bd.o >= 3) return false; bd.o++; return true; }
  MB.bonds.push({ a: aid, b: bid, o: 1 });
  return true;
}
function mbDelete(id) {
  MB.atoms = MB.atoms.filter(a => a.id !== id);
  MB.bonds = MB.bonds.filter(bd => bd.a !== id && bd.b !== id);
  if (MB.sel === id) MB.sel = null;
}
function mbCharge(id, d) {
  const a = mbAtom(id); if (!a) return false;
  const q = a.q + d, Z = SYM2Z[a.el];
  if (Math.abs(q) > 2 || Z - q < 1) { mbSay(`${ELEMENTS[Z].name} cannot take ${d > 0 ? 'more positive' : 'more negative'} charge here.`, true); return false; }
  mbSnap(); a.q = q; MB.msg = '';
  return true;
}
function mbClear() { if (!MB.atoms.length) return; mbSnap(); MB.atoms = []; MB.bonds = []; MB.sel = null; MB.msg = ''; mbChanged(true); }

/* ---- what the drawing is: formula, problems, and its name if the library knows it */
function mbAssemble() { // drawn atoms first (same order), then the hydrogens that fill free valences
  const idx = new Map(MB.atoms.map((a, i) => [a.id, i]));
  const atoms = MB.atoms.map(a => ({ el: a.el, q: a.q, A: mbIsoA(a), x: a.x, y: a.y })), hA = MB.hA > 1 ? MB.hA : 0;
  const bonds = MB.bonds.map(bd => [idx.get(bd.a), idx.get(bd.b), bd.o]);
  MB.atoms.forEach((a, i) => {
    const k = mbImplicitH(a); if (!k) return;
    const L = mbBondLen(a.el, 'H');
    for (const t of mbHDirs(a, k)) { atoms.push({ el: 'H', q: 0, A: hA, x: a.x + L * Math.cos(t), y: a.y + L * Math.sin(t) }); bonds.push([i, atoms.length - 1, 1]); }
  });
  return { atoms, bonds, nDrawn: MB.atoms.length };
}
function mbPieces() {
  const seen = new Set(); let n = 0;
  for (const a of MB.atoms) {
    if (seen.has(a.id)) continue;
    n++; const st = [a.id]; seen.add(a.id);
    while (st.length) { const id = st.pop(); for (const o of mbNbrs(id)) if (!seen.has(o.id)) { seen.add(o.id); st.push(o.id); } }
  }
  return n;
}
function mbAnalyze() {
  const r = { issues: [], formula: '', iso: '', name: null, lm: null, n: 0, pieces: 0, free: 0, mol: null };
  if (!MB.atoms.length) return r;
  const mol = mbAssemble(); r.mol = mol; r.n = mol.atoms.length;
  const fake = mol.atoms.map(a => ({ el: ELEMENTS[SYM2Z[a.el]], q: a.q || 0, A: a.A || 0, anti: false, bonds: [] }));
  for (const [i, j, o] of mol.bonds) { const bd = { a: fake[i], b: fake[j], order: o }; fake[i].bonds.push(bd); fake[j].bonds.push(bd); }
  r.formula = isoFormula(fake); r.iso = isoDesc(fake);
  for (const a of MB.atoms) {
    const u = mbUsed(a.id), lim = mbLimit(a);
    if (u > lim) r.issues.push({ id: a.id, text: `${mbLabel(a)} has ${u} bond${u > 1 ? 's' : ''}; it takes ${lim ? 'at most ' + lim : 'none'}` });
  }
  r.pieces = mbPieces();
  if (r.pieces > 1) r.issues.push({ text: `${r.pieces} separate pieces: drop an atom of one onto an atom of another to join them` });
  if (r.n > MB_MAX) r.issues.push({ text: `${r.n} atoms with the hydrogens; the builder takes up to ${MB_MAX}` });
  for (const a of MB.atoms) r.free += mbFree(a);
  if (!r.issues.length) { r.lm = libMatch(fake); r.name = r.lm ? r.lm.name : moleculeName(fake); }
  return r;
}

/* ---- settling the shape: the library generator's steps, run on the engine in a private world
   (the chamber's particles and settings are set aside and put back untouched). */
function mbRng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function mbPreRelax(mol, ps, pos, iters) { // stiff springs, the engine's bond angles and a soft shove apart: untangles without tearing
  const n = ps.length, TAU = 2 * Math.PI;
  const nb = Array.from({ length: n }, () => []);
  for (const [a, b] of mol.bonds) { nb[a].push(b); nb[b].push(a); }
  const r0 = mol.bonds.map(([a, b]) => { const bd = ps[a].bonds.find(x => x.a === ps[b] || x.b === ps[b]); return bd ? bd.r0 : 1.4; });
  const excl = ps.map(() => new Set());
  ps.forEach((p, i) => { for (const j of nb[i]) { excl[i].add(j); if (angled(ps[j])) for (const k of nb[j]) if (k !== i) excl[i].add(k); } });
  const tg = ps.map((p, i) => (angled(p) ? angleTargets(p, nb[i].length).slice().sort((a, b) => a - b) : null));
  const sz = ps.map((p) => (p.Z === 1 ? 1.1 : 1.5));
  const x = pos.map(p => p[0]), y = pos.map(p => p[1]);
  for (let i = 0; i < n; i++) { x[i] += (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.02; y[i] += (Math.sin(i * 78.233) * 43758.5453 % 1) * 0.02; }
  const fx = new Float64Array(n), fy = new Float64Array(n);
  for (let it = 0; it < iters; it++) {
    fx.fill(0); fy.fill(0);
    mol.bonds.forEach(([a, b], k) => {
      const dx = x[b] - x[a], dy = y[b] - y[a], r = Math.hypot(dx, dy) || 1e-6, f = 30 * (r - r0[k]);
      fx[a] += f * dx / r; fy[a] += f * dy / r; fx[b] -= f * dx / r; fy[b] -= f * dy / r;
    });
    for (let i = 0; i < n; i++) {
      const t = tg[i]; if (!t) continue;
      const m = nb[i].length, ang = [], rad = [];
      for (const j of nb[i]) { const dx = x[j] - x[i], dy = y[j] - y[i]; ang.push(Math.atan2(dy, dx)); rad.push(Math.max(0.3, Math.hypot(dx, dy))); }
      const ord = ang.map((_, k) => k).sort((p, q) => ang[p] - ang[q]);
      const gap = ord.map((k, s) => { let g = ang[ord[(s + 1) % m]] - ang[k]; if (s === m - 1) g += TAU; return g; });
      const tgt = new Array(m); gap.map((_, s) => s).sort((p, q) => gap[p] - gap[q]).forEach((s, rank) => { tgt[s] = t[rank]; });
      for (let s = 0; s < m; s++) {
        const k = ord[s], prev = (s - 1 + m) % m, j = nb[i][k];
        const Ft = -3 * ((gap[prev] - tgt[prev]) - (gap[s] - tgt[s])) / rad[k];
        const ffx = -Math.sin(ang[k]) * Ft, ffy = Math.cos(ang[k]) * Ft;
        fx[j] += ffx; fy[j] += ffy; fx[i] -= ffx; fy[i] -= ffy;
      }
    }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (excl[i].has(j)) continue;
      const s = sz[i] + sz[j], dx = x[j] - x[i], dy = y[j] - y[i], r2 = dx * dx + dy * dy;
      if (r2 >= s * s) continue;
      const r = Math.sqrt(r2) || 1e-6, f = 2 * (s - r);
      fx[i] -= f * dx / r; fy[i] -= f * dy / r; fx[j] += f * dx / r; fy[j] += f * dy / r;
    }
    const step = it < iters / 2 ? 0.01 : 0.004;
    for (let i = 0; i < n; i++) {
      let dx = step * fx[i], dy = step * fy[i]; const d = Math.hypot(dx, dy);
      if (d > 0.05) { dx *= 0.05 / d; dy *= 0.05 / d; }
      x[i] += dx; y[i] += dy;
    }
  }
  ps.forEach((p, i) => { p.x = x[i]; p.y = y[i]; });
}
function mbFire(ps, maxIter) { // FIRE minimiser on the engine's own forces
  let dt = 0.004, alpha = 0.1, npos = 0;
  for (const p of ps) { p.vx = 0; p.vy = 0; }
  for (let it = 0; it < maxIter; it++) {
    forcesNoEvents();
    let P = 0, vn = 0, fn = 0, fmax = 0;
    for (const p of ps) { P += p.fx * p.vx + p.fy * p.vy; const f2 = p.fx * p.fx + p.fy * p.fy; if (f2 > fmax) fmax = f2; vn += p.vx * p.vx + p.vy * p.vy; fn += f2; }
    if (Math.sqrt(fmax) < 1e-3) return it;
    vn = Math.sqrt(vn); fn = Math.sqrt(fn) || 1;
    if (P > 0) {
      for (const p of ps) { p.vx = (1 - alpha) * p.vx + alpha * vn * p.fx / fn; p.vy = (1 - alpha) * p.vy + alpha * vn * p.fy / fn; }
      if (++npos > 5) { dt = Math.min(dt * 1.1, 0.03); alpha *= 0.99; }
    } else { for (const p of ps) { p.vx = 0; p.vy = 0; } dt *= 0.5; alpha = 0.1; npos = 0; }
    for (const p of ps) {
      p.vx += dt * p.fx * p.im; p.vy += dt * p.fy * p.im;
      let dx = dt * p.vx, dy = dt * p.vy; const d = Math.hypot(dx, dy);
      if (d > 0.05) { dx *= 0.05 / d; dy *= 0.05 / d; }
      p.x += dx; p.y += dy;
    }
  }
  return maxIter;
}
function mbSegX(a, b, c, d) { const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; }
function mbGeomIssues(ps, mol) { // crossing bonds, atoms on top of each other, bonds that did not reach their length
  const out = [], B = mol.bonds;
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
    const [a, b] = B[i], [c, d] = B[j];
    if (a === c || a === d || b === c || b === d) continue;
    if (mbSegX(ps[a], ps[b], ps[c], ps[d])) out.push('cross');
  }
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const p = ps[i], o = ps[j];
    if (p.excl && p.excl.has(o.id)) continue;
    if (Math.hypot(p.x - o.x, p.y - o.y) < 0.12 * ((p.ljR || 2) + (o.ljR || 2))) out.push('overlap'); // on top of each other, not merely crowded
  }
  for (const [a, b] of B) {
    const bd = ps[a].bonds.find(x => x.a === ps[b] || x.b === ps[b]);
    if (bd && Math.abs(Math.hypot(ps[a].x - ps[b].x, ps[a].y - ps[b].y) - bd.r0) > 0.15 * bd.r0) out.push('stretch');
  }
  return out;
}
function mbStrain() { let D = 0; for (const bd of W.bonds) D += bd.D + (bd.Ef || 0); return totalEnergy().pe + D; }
function mbOrient(ps) { // centred on the centroid, long axis horizontal
  let cx = 0, cy = 0; for (const p of ps) { cx += p.x; cy += p.y; } cx /= ps.length; cy /= ps.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of ps) { const x = p.x - cx, y = p.y - cy; sxx += x * x; syy += y * y; sxy += x * y; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), c = Math.cos(-th), s = Math.sin(-th);
  return ps.map(p => { const x = p.x - cx, y = p.y - cy; return [x * c - y * s, x * s + y * c]; });
}
/* ---- a fresh 2-D layout from the bond graph alone (the library generator's): used when the hand drawing
   will not settle cleanly, e.g. a hydrogen boxed into a crowded corner it cannot get out of in a flat world */
function mbGraphNb(mol) { const nb = mol.atoms.map(() => []); for (const [a, b, o] of mol.bonds) { nb[a].push({ j: b, o }); nb[b].push({ j: a, o }); } return nb; }
function mbComps(n, nb) {
  const comp = new Array(n).fill(-1), list = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0) continue;
    const c = [s]; comp[s] = list.length;
    for (let k = 0; k < c.length; k++) for (const { j } of nb[c[k]]) if (comp[j] < 0) { comp[j] = list.length; c.push(j); }
    list.push(c);
  }
  return list;
}
function mbRings(n, nb, heavy) { // smallest set of smallest rings
  const edges = [], eid = new Map(), ek = (a, b) => Math.min(a, b) * 4096 + Math.max(a, b);
  for (let i = 0; i < n; i++) if (heavy[i]) for (const { j } of nb[i]) if (heavy[j] && i < j) { eid.set(ek(i, j), edges.length); edges.push([i, j]); }
  const cyc = [], seen = new Set();
  for (const [u, v] of edges) {
    const prev = new Map([[u, -1]]), q = [u];
    for (let h = 0; h < q.length; h++) {
      const x = q[h]; if (x === v) break;
      for (const { j } of nb[x]) { if (!heavy[j] || prev.has(j) || (x === u && j === v)) continue; prev.set(j, x); q.push(j); }
    }
    if (!prev.has(v)) continue;
    const p = []; for (let x = v; x !== -1; x = prev.get(x)) p.push(x);
    const key = p.slice().sort((a, b) => a - b).join(',');
    if (!seen.has(key)) { seen.add(key); cyc.push(p); }
  }
  cyc.sort((a, b) => a.length - b.length);
  const nHeavy = heavy.filter(Boolean).length;
  const compH = mbComps(n, nb.map((l, i) => heavy[i] ? l.filter(e => heavy[e.j]) : [])).filter(c => heavy[c[0]]).length;
  const nu = edges.length - nHeavy + compH, piv = new Map(), rings = [], NW = Math.max(1, Math.ceil(edges.length / 32));
  for (const c of cyc) { // keep a cycle only if its edge set is independent of those kept (elimination over GF(2))
    const v = new Uint32Array(NW);
    for (let k = 0; k < c.length; k++) { const e = eid.get(ek(c[k], c[(k + 1) % c.length])); v[e >>> 5] ^= 1 << (e & 31); }
    for (;;) {
      let top = -1;
      for (let w = NW - 1; w >= 0 && top < 0; w--) if (v[w]) top = w * 32 + 31 - Math.clz32(v[w]);
      if (top < 0) break;
      const p = piv.get(top);
      if (p) { for (let w = 0; w < NW; w++) v[w] ^= p[w]; } else { piv.set(top, v); rings.push(c); break; }
    }
    if (rings.length === nu) break;
  }
  if (rings.length !== nu) throw new Error('ring perception failed');
  return rings;
}
function mbLayout(mol, R) { // one connected molecule
  const TAU = 2 * Math.PI, n = mol.atoms.length, nb = mbGraphNb(mol);
  const bl = (a, b, o) => mbBondLen(mol.atoms[a].el, mol.atoms[b].el, o);
  const isTH = (i) => mol.atoms[i].el === 'H' && nb[i].length === 1 && mol.atoms[nb[i][0].j].el !== 'H';
  const heavy = mol.atoms.map((_, i) => !isTH(i));
  const rings = mbRings(n, nb, heavy);
  const sysOf = new Array(n).fill(-1), systems = [];
  for (const r of rings) { // ring systems: rings sharing atoms
    const hit = new Set(); for (const a of r) if (sysOf[a] >= 0) hit.add(sysOf[a]);
    let id;
    if (!hit.size) { id = systems.length; systems.push({ rings: [], atoms: new Set() }); }
    else {
      const ids = [...hit]; id = ids[0];
      for (const o of ids.slice(1)) { for (const rr of systems[o].rings) systems[id].rings.push(rr); for (const a of systems[o].atoms) { systems[id].atoms.add(a); sysOf[a] = id; } systems[o] = { rings: [], atoms: new Set() }; }
    }
    systems[id].rings.push(r); for (const a of r) { systems[id].atoms.add(a); sysOf[a] = id; }
  }
  const pos = new Array(n).fill(null);
  const ringEdgeLen = (sys) => { let s = 0, c = 0; for (const r of sys.rings) for (let k = 0; k < r.length; k++) { const a = r[k], b = r[(k + 1) % r.length]; s += bl(a, b, nb[a].find(e => e.j === b).o); c++; } return s / c; };
  const polygon = (r, L, iu, c, sense) => {
    const m = r.length, Rr = L / (2 * Math.sin(Math.PI / m)), u = r[iu], ph = Math.atan2(pos[u][1] - c[1], pos[u][0] - c[0]);
    for (let k = 1; k < m; k++) { const a = r[(iu + k) % m]; if (pos[a]) continue; const th = ph + sense * k * TAU / m; pos[a] = [c[0] + Rr * Math.cos(th), c[1] + Rr * Math.sin(th)]; }
  };
  function layoutSystem(sys, anchor) {
    const L = ringEdgeLen(sys), done = new Set();
    const first = anchor ? sys.rings.filter(r => r.includes(anchor.atom)).sort((a, b) => a.length - b.length)[0]
      : sys.rings.slice().sort((a, b) => { const sh = (r) => sys.rings.filter(o => o !== r && o.some(x => r.includes(x))).length; return sh(b) - sh(a) || b.length - a.length; })[0];
    const m0 = first.length, R0 = L / (2 * Math.sin(Math.PI / m0)), sense0 = R() < 0.5 ? 1 : -1;
    if (anchor) { const iu = first.indexOf(anchor.atom), p = pos[anchor.atom]; polygon(first, L, iu, [p[0] + R0 * Math.cos(anchor.dir), p[1] + R0 * Math.sin(anchor.dir)], sense0); }
    else { const ph0 = R() * TAU; pos[first[0]] = [R0 * Math.cos(ph0), R0 * Math.sin(ph0)]; polygon(first, L, 0, [0, 0], sense0); }
    done.add(first);
    let guard = 0;
    while (done.size < sys.rings.length && guard++ < 100) {
      let best = null;
      for (const r of sys.rings) {
        if (done.has(r)) continue;
        for (let k = 0; k < r.length; k++) if (pos[r[k]] && pos[r[(k + 1) % r.length]]) { best = { r, k, type: 'fused' }; break; }
        if (best) break;
        const k = r.findIndex(a => pos[a]); if (k >= 0) best = { r, k, type: 'spiro' };
      }
      if (!best) throw new Error('ring system layout stuck');
      const { r, k } = best, m = r.length, Rr = L / (2 * Math.sin(Math.PI / m));
      const sp = [...sys.atoms].filter(a => pos[a]);
      const cx = sp.reduce((s, a) => s + pos[a][0], 0) / sp.length, cy = sp.reduce((s, a) => s + pos[a][1], 0) / sp.length;
      if (best.type === 'fused') {
        const u = r[k], v = r[(k + 1) % m], mx = (pos[u][0] + pos[v][0]) / 2, my = (pos[u][1] + pos[v][1]) / 2;
        const ex = pos[v][0] - pos[u][0], ey = pos[v][1] - pos[u][1], el = Math.hypot(ex, ey) || 1, h = Math.sqrt(Math.max(0, Rr * Rr - (el / 2) ** 2));
        let nx = -ey / el, ny = ex / el, side = 0;
        for (const a of sp) if (a !== u && a !== v) side += (pos[a][0] - mx) * nx + (pos[a][1] - my) * ny;
        if (side > 0) { nx = -nx; ny = -ny; }
        const c = [mx + nx * h, my + ny * h], phu = Math.atan2(pos[u][1] - c[1], pos[u][0] - c[0]), phv = Math.atan2(pos[v][1] - c[1], pos[v][0] - c[0]);
        polygon(r, L, k, c, mbNorm(phv - phu) < Math.PI ? 1 : -1);
      } else {
        const u = r[k]; let dx = pos[u][0] - cx, dy = pos[u][1] - cy; const dl = Math.hypot(dx, dy) || 1;
        polygon(r, L, k, [pos[u][0] + Rr * dx / dl, pos[u][1] + Rr * dy / dl], R() < 0.5 ? 1 : -1);
      }
      done.add(r);
    }
    return [...sys.atoms];
  }
  const branchSize = (b, parent) => { const seen = new Set([parent, b]), st = [b]; while (st.length) { const x = st.pop(); for (const { j } of nb[x]) if (!seen.has(j)) { seen.add(j); st.push(j); } } return seen.size - 1; };
  const clearance = (x, y, skip) => { let m = 99; for (let i = 0; i < n; i++) { if (i === skip || !pos[i]) continue; const d = Math.hypot(pos[i][0] - x, pos[i][1] - y); if (d < m) m = d; } return m; };
  const q = [];
  const sysIds = [...new Set(sysOf.filter(s => s >= 0))];
  if (sysIds.length) { const big = sysIds.sort((a, b) => systems[b].atoms.size - systems[a].atoms.size)[0]; for (const a of layoutSystem(systems[big], null)) q.push(a); }
  else { // tree centre: smallest eccentricity among heavy atoms, ties to more neighbours
    let best = 0, be = 1e9;
    for (let s = 0; s < n; s++) {
      if (!heavy[s] && n > 1) continue;
      const dist = new Map([[s, 0]]), qq = [s];
      for (let h = 0; h < qq.length; h++) for (const { j } of nb[qq[h]]) if (!dist.has(j) && heavy[j]) { dist.set(j, dist.get(qq[h]) + 1); qq.push(j); }
      const ecc = Math.max(...dist.values()) * 10 - nb[s].length;
      if (ecc < be) { be = ecc; best = s; }
    }
    pos[best] = [0, 0]; q.push(best);
  }
  for (let h = 0; h < q.length; h++) {
    const A = q[h], pn = nb[A].filter(e => pos[e.j]), un = nb[A].filter(e => !pos[e.j]);
    if (!un.length) continue;
    const deg = nb[A].length, angs = pn.map(e => Math.atan2(pos[e.j][1] - pos[A][1], pos[e.j][0] - pos[A][0]));
    const slots = [];
    if (!pn.length) { const r0 = R() * TAU; for (let k = 0; k < deg; k++) slots.push(r0 + k * TAU / deg); }
    else if (pn.length === 1) { for (let k = 1; k < deg; k++) slots.push(angs[0] + k * TAU / deg); }
    else {
      const s = angs.map(mbNorm).sort((a, b) => a - b);
      let gi = 0, gw = 0;
      for (let k = 0; k < s.length; k++) { const w = k === s.length - 1 ? s[0] + TAU - s[k] : s[k + 1] - s[k]; if (w > gw) { gw = w; gi = k; } }
      for (let k = 1; k <= un.length; k++) slots.push(s[gi] + gw * k / (un.length + 1));
    }
    // which neighbour takes which slot: big branches go where there is room
    const items = un.map(e => ({ j: e.j, o: e.o, w: heavy[e.j] ? branchSize(e.j, A) : 0.3 }));
    const perms = [];
    const permute = (used, acc) => {
      if (acc.length === items.length) { perms.push(acc.slice()); return; }
      for (let k = 0; k < slots.length; k++) if (!used[k]) { used[k] = true; acc.push(k); permute(used, acc); acc.pop(); used[k] = false; }
    };
    if (slots.length <= 6) permute([], []); else perms.push(items.map((_, k) => k));
    const scored = perms.map(pm => {
      let sc = 0;
      pm.forEach((sk, ii) => {
        const it = items[ii], reach = bl(A, it.j, it.o) + (it.w > 1 ? 1.4 : 0.6);
        sc += Math.min(4, clearance(pos[A][0] + reach * Math.cos(slots[sk]), pos[A][1] + reach * Math.sin(slots[sk]), A)) * (1 + it.w);
      });
      return { pm, sc };
    }).sort((a, b) => b.sc - a.sc);
    let pick = scored[0];
    if (scored.length > 1 && R() < 0.35) { const top = scored.slice(0, Math.min(4, scored.length)); pick = top[Math.floor(R() * top.length)]; }
    pick.pm.forEach((sk, ii) => {
      const it = items[ii], th = slots[sk], L = bl(A, it.j, it.o);
      pos[it.j] = [pos[A][0] + L * Math.cos(th), pos[A][1] + L * Math.sin(th)];
      if (sysOf[it.j] >= 0 && systems[sysOf[it.j]].atoms.size) {
        const sys = systems[sysOf[it.j]];
        if (![...sys.atoms].some(a => a !== it.j && pos[a])) { for (const a of layoutSystem(sys, { atom: it.j, dir: th })) q.push(a); return; }
      }
      q.push(it.j);
    });
  }
  if (pos.some(p => !p)) throw new Error('layout left atoms unplaced');
  return pos;
}
/* Each end hydrogen of a layout turns about its atom to wherever it has the most room, crossing no bond: a fused,
   crowded ring system otherwise leaves some on top of other atoms, boxed in where a flat world cannot free them. */
function mbTidyH(mol, pos) {
  const n = mol.atoms.length, nb = mol.atoms.map(() => []), P = pos.map(([x, y]) => ({ x, y }));
  for (const [a, b] of mol.bonds) { nb[a].push(b); nb[b].push(a); }
  const C = 3, grid = new Map(), cell = (q) => Math.floor(q.x / C) * 65536 + Math.floor(q.y / C); // atoms by 3 Å cell
  const put = (i) => { const k = cell(P[i]); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(i); return k; };
  const at = P.map((_, i) => put(i));
  for (let pass = 0; pass < 3; pass++) {
    for (let h = 0; h < n; h++) {
      if (mol.atoms[h].el !== 'H' || nb[h].length !== 1) continue;
      const c = nb[h][0], L = Math.hypot(P[h].x - P[c].x, P[h].y - P[c].y) || 1;
      const gx = Math.floor(P[c].x / C), gy = Math.floor(P[c].y / C), near = [];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const l = grid.get((gx + dx) * 65536 + gy + dy); if (l) for (const j of l) if (j !== h && j !== c) near.push(j); }
      let best = null;
      for (let k = 0; k < 36; k++) {
        const t = k * Math.PI / 18, q = { x: P[c].x + L * Math.cos(t), y: P[c].y + L * Math.sin(t) };
        let m = 9, cr = 0;
        for (const j of near) {
          const d = Math.hypot(P[j].x - q.x, P[j].y - q.y); if (d < m) m = d;
          for (const o of nb[j]) if (o > j || near.indexOf(o) < 0) { if (o !== h && o !== c && mbSegX(P[c], q, P[j], P[o])) cr++; }
        }
        const sc = m - 3 * cr;
        if (!best || sc > best.sc + 1e-9) best = { sc, q };
      }
      P[h] = best.q;
      const k2 = cell(P[h]);
      if (k2 !== at[h]) { const l = grid.get(at[h]); l.splice(l.indexOf(h), 1); at[h] = put(h); }
    }
  }
  return P.map(q => [q.x, q.y]);
}
/* Settle mol on the engine: first from the drawing as it is, then (one connected molecule only) from fresh
   layouts, keeping the cleanest, lowest-energy result. */
function mbRelax(mol, tries, connected) {
  const keep = {};
  for (const k of MB_KEEP) keep[k] = W[k];
  W.box = { w: 300, h: 300, tw: 300, th: 300, uw: 0, uh: 0 }; W.wall = 'reflect'; W.Ex = 0; W.Ey = 0; W.Bz = 0;
  W.magnets = []; W.tool = null; W.grab = null; W.T = 0; W.gamma = 0; W.evq = [];
  let best = null, err = null;
  try {
    for (let v = 0; v < tries; v++) {
      W.parts = []; W.bonds = []; // (a private world; its particles' slots are given back below)
      let pos = null;
      if (v && connected) { try { pos = mbTidyH(mol, mbLayout(mol, mbRng(1000 + v * 7919))); } catch (e) { pos = null; } }
      if (!pos) { const R = mbRng(7 + v * 7919), j = v ? 0.5 : 0; pos = mol.atoms.map(a => [a.x + (R() - 0.5) * j, a.y + (R() - 0.5) * j]); }
      const ps = mol.atoms.map((a, i) => addAtom(a.el, pos[i][0], pos[i][1], { charge: a.q || 0, A: a.A || 0, T: 0 }));
      for (const [a, b, o] of mol.bonds) addBond(ps[a], ps[b], o);
      for (const p of ps) { p.vx = 0; p.vy = 0; }
      mbPreRelax(mol, ps, pos, 2000);
      mbFire(ps, 3000);
      const gi = mbGeomIssues(ps, mol), E = mbStrain();
      if (!best || gi.length < best.gi.length || (gi.length === best.gi.length && E < best.E)) {
        best = { gi, E, xy: mbOrient(ps), raw: ps.map(p => [p.x, p.y]), lm: connected ? libMatch(ps) : null,
          free: ps.filter(p => p.el && !p.el.dblock && p.cap - p.used > 0).length };
      }
      dropParts(ps);
      if (!gi.length) break;
    }
  } catch (e) { err = (e && e.message) || String(e); }
  finally { dropParts(W.parts); for (const k in keep) W[k] = keep[k]; forcesNoEvents(); }
  return { best, err };
}
/* Tidy: settle the drawing into the shape the engine gives it, keeping it where it was on the workspace. */
function mbTidy() {
  if (!MB.atoms.length) return;
  const info = MB.info = mbAnalyze(), over = info.issues.find(i => i.id);
  if (over) { mbSay(over.text + '. Fix that first.', true); mbDraw(); return; }
  if (info.n > MB_MAX) { mbSay(info.issues[info.issues.length - 1].text, true); return; }
  const one = info.pieces === 1, { best, err } = mbRelax(info.mol, one ? mbTries(info.n, 5) : 1, one);
  if (err || !best) { mbSay('Could not settle it: ' + (err || 'no shape found'), true); return; }
  mbSnap();
  let ox = 0, oy = 0, nx = 0, ny = 0;
  MB.atoms.forEach((a, i) => { ox += a.x; oy += a.y; nx += best.raw[i][0]; ny += best.raw[i][1]; });
  const n = MB.atoms.length;
  MB.atoms.forEach((a, i) => { a.x = best.raw[i][0] - nx / n + ox / n; a.y = best.raw[i][1] - ny / n + oy / n; });
  MB.msg = best.gi.length ? 'Some bonds still cross: drag atoms apart so that none do.' : '';
  MB.msgBad = !!best.gi.length;
  mbChanged(true);
}

/* ---- My molecules: built ones join the picker, and are kept in this browser. Ones Claude designed or identified go into
   the library category they belong to (m.c); the rest into My molecules. Either way they are the user's (mine): kept,
   exported, removable. */
/* Where a molecule is, for messages: My molecules, or the library category it is in. */
function molWhere(m) { return m.cat === 'custom' ? 'My molecules' : `the library (${molCatName(m.cat)})`; }
const MOL_CAT_OFF = new Set(['custom', 'objects']); // (not categories a saved molecule can be filed under)
function molCatOk(c) { return typeof c === 'string' && !MOL_CAT_OFF.has(c) && MOLECULE_CATS.some(x => x[0] === c); }
/* A category from the atoms alone, for a named molecule with none given: charges → ions & salts; metals → metal
   compounds; no carbon (or one carbon and no hydrogen: CO₂, CS₂) → elements & diatomics when one element, else small
   inorganic; carbon and hydrogen only → hydrocarbons; with N, S, P or a halogen → that group; with O → alcohols…acids. */
function molCatGuess(atoms, bonds) {
  const syms = atoms.map(a => a[0]), set = new Set(syms), has = (s) => set.has(s);
  if (atoms.some(a => a[3])) return 'ions';
  if (syms.some(s => ELEMENTS[SYM2Z[s]] && ELEMENTS[SYM2Z[s]].metal)) return 'metal';
  if (atoms.length <= 2) return 'diatomic';
  const BASE = { S: 2, Se: 2, P: 3, As: 3, Cl: 1, Br: 1, I: 1, He: 0, Ne: 0, Ar: 0, Kr: 0, Xe: 0, Rn: 0 }, sum = new Array(atoms.length).fill(0);
  for (const b of bonds || []) { sum[b[0]] += b[2]; sum[b[1]] += b[2]; }
  if (syms.some((s, i) => s in BASE && (BASE[s] === 0 || sum[i] > BASE[s]))) return 'hyper'; // (a noble gas, or more bonds than the usual valence: an expanded octet)
  const nC = syms.filter(s => s === 'C').length;
  if (!nC || (nC === 1 && !has('H'))) return set.size === 1 ? 'diatomic' : 'inorganic';
  if ([...set].every(s => s === 'C' || s === 'H')) return 'hydrocarbon';
  if (['N', 'S', 'P', 'F', 'Cl', 'Br', 'I'].some(has)) return 'nitrogen';
  return has('O') ? 'oxygen' : 'inorganic';
}
function myMolAdd(m) {
  const cat = molCatOk(m.c) ? m.c : 'custom';
  if (cat === 'custom' && !MOLECULE_CATS.some(c => c[0] === 'custom')) MOLECULE_CATS.unshift(['custom', 'My molecules']);
  MOLECULES[m.k] = { key: m.k, name: m.n, cat, mine: true, radical: !!m.r, atoms: m.a, bonds: m.b, desc: m.d || '',
    note: (m.d || 'Built in the molecule builder.') + (m.r ? ' It has a free valence (a radical), so it will react.' : '') };
  _molThumb.delete(m.k); _molPlain.delete(m.k); _molR.delete(m.k);
  _libIdx = null; // names in the chamber now know it too
}
function myMolRemove(k) {
  if (!MOLECULES[k] || !MOLECULES[k].mine) return;
  const gone = { kind: 'mol', mol: k };
  delete MOLECULES[k];
  _molThumb.delete(k); _molPlain.delete(k); _molR.delete(k); _libIdx = null;
  if (!Object.values(MOLECULES).some(m => m.cat === 'custom')) { const i = MOLECULE_CATS.findIndex(c => c[0] === 'custom'); if (i >= 0) MOLECULE_CATS.splice(i, 1); }
  if (MOL_UI.cat === 'custom' && !MOLECULE_CATS.some(c => c[0] === 'custom')) MOL_UI.cat = '';
  let pal = false;
  if (sameSpec(UI.spec, gone)) { UI.spec = null; pal = true; }
  if (sameSpec(UI.customSpec, gone)) { UI.customSpec = null; pal = true; }
  if (pal) { buildPalette(); buildToolOpts(); }
  myMolsSave();
}
function myMolsSave() {
  store('mymols', JSON.stringify(myMolsList()));
}
/* The user's molecules as kept and exported: c is the category when not My molecules. */
function myMolsList() {
  return Object.values(MOLECULES).filter(m => m.mine).map(m => { const o = { k: m.key, n: m.name, r: m.radical ? 1 : 0, a: m.atoms, b: m.bonds }; if (m.desc) o.d = m.desc; if (m.cat !== 'custom') o.c = m.cat; return o; });
}
function myMolValid(m) {
  if (!m || typeof m.k !== 'string' || !/^my[0-9a-z]+$/.test(m.k) || typeof m.n !== 'string' || !Array.isArray(m.a) || !Array.isArray(m.b)) return false;
  if (m.c !== undefined && typeof m.c !== 'string') return false;
  if (!m.a.length || m.a.length > MYMOL_MAX || MOLECULES[m.k] || (m.d !== undefined && typeof m.d !== 'string')) return false;
  for (const a of m.a) {
    if (!Array.isArray(a) || !SYM2Z[a[0]] || !Number.isFinite(a[1]) || !Number.isFinite(a[2])) return false;
    if (a[3] !== undefined && !(Number.isInteger(a[3]) && Math.abs(a[3]) <= 2)) return false;
    if (a[4] !== undefined && !(Number.isInteger(a[4]) && a[4] >= SYM2Z[a[0]] && a[4] - SYM2Z[a[0]] <= nbMaxN(SYM2Z[a[0]]))) return false;
  }
  for (const b of m.b) {
    if (!Array.isArray(b) || !Number.isInteger(b[0]) || !Number.isInteger(b[1]) || b[0] === b[1]) return false;
    if (b[0] < 0 || b[1] < 0 || b[0] >= m.a.length || b[1] >= m.a.length || ![1, 2, 3].includes(b[2])) return false;
  }
  return true;
}
function myMolsLoad() {
  let list = null;
  try { list = JSON.parse(store('mymols') || 'null'); } catch (e) { list = null; }
  if (!Array.isArray(list)) return;
  let moved = 0;
  for (const m of list) {
    if (!myMolValid(m)) continue;
    let c = m.c;
    if (c === undefined && /^(Designed by Claude|Identified)/.test(m.d || '')) { c = molCatGuess(m.a, m.b); moved++; } // (saved before V40 into My molecules: Claude's go to their category)
    myMolAdd({ k: m.k, n: m.n.slice(0, 40), r: m.r, a: m.a, b: m.b, d: (m.d || '').slice(0, 500), c });
  }
  if (moved) myMolsSave();
}

/* ---- Build & place */
function mbBuild() {
  if (!MB.atoms.length) { mbSay('Drag some atoms onto the workspace first.', true); return; }
  const info = MB.info = mbAnalyze();
  if (info.issues.length) { mbSay('Not yet: fix the problem above first.', true); mbDraw(); return; }
  const name = String($('bldName').value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
  if (info.lm && (!name || name === info.lm.name)) { // already known: use that one, shape and all
    hideModal('bldModal'); selectSpec({ kind: 'mol', mol: info.lm.key });
    log('tool', `Builder: that is ${info.lm.name}, already in ${molWhere(info.lm)}`);
    return;
  }
  if (info.n > 90) { // a big one takes a few seconds to settle: say so first
    mbSay(`Settling ${info.n} atoms into shape …`); $('bldGo').disabled = true;
    setTimeout(() => mbBuildRun(info, name), 40);
    return;
  }
  mbBuildRun(info, name);
}
function mbBuildRun(info, name) {
  const { best, err } = mbRelax(info.mol, mbTries(info.n, 6), true);
  if (err || !best) { mbSay('Could not settle it: ' + (err || 'no shape found'), true); return; }
  if (best.gi.length) {
    mbSay(best.gi.every(g => g === 'stretch') ? 'Some bonds stay stretched however it is laid out: it is too strained to lie flat in a 2-D world (crowded, fused rings do this). Try dragging atoms into a different arrangement and Tidy.'
      : 'It will not lie flat without bonds crossing or atoms overlapping. Drag atoms apart so no bonds cross (Tidy helps), then try again.', true);
    return;
  }
  const k = 'my' + Date.now().toString(36) + (MB.seq++).toString(36);
  const atoms = info.mol.atoms.map((a, i) => { const r = [a.el, +best.xy[i][0].toFixed(2), +best.xy[i][1].toFixed(2)]; if (a.q || a.A) r.push(a.q || 0); if (a.A) r.push(a.A); return r; });
  const byClaude = MB.aiSig && MB.aiSig === mbSig(); // still as Claude designed it: keep its note
  myMolAdd({ k, n: name || info.name || info.formula, r: best.free ? 1 : 0, a: atoms, b: info.mol.bonds.map(b => b.slice()),
    d: byClaude ? 'Designed by Claude.' + (MB.aiNote ? ' ' + MB.aiNote : '') : '', c: byClaude ? (molCatOk(MB.aiCat) ? MB.aiCat : molCatGuess(atoms, info.mol.bonds)) : undefined }); // (Claude's design: filed under its category)
  myMolsSave();
  hideModal('bldModal'); selectSpec({ kind: 'mol', mol: k });
  log('tool', `Builder: ${MOLECULES[k].name} (${specLabel({ kind: 'mol', mol: k })}) is ready to place${best.free ? '; it has a free valence, so it will react' : ''}`);
}

/* ---- view: Å on the workspace, y up */
function mbS0() { return clamp(Math.min(MB.w, MB.h) / 8.5, 28, 46); }
function mbScr(x, y) { return [MB.w / 2 + (x - MB.cx) * MB.s, MB.h / 2 - (y - MB.cy) * MB.s]; }
function mbWorld(sx, sy) { return [MB.cx + (sx - MB.w / 2) / MB.s, MB.cy - (sy - MB.h / 2) / MB.s]; }
function mbRad(a) { return a.el === 'H' ? clamp(MB.s * 0.27, Math.min(9, MB.s * 0.35), 13) : clamp(MB.s * 0.38, Math.min(12, MB.s * 0.5), 18); } // (smaller when zoomed out on a big molecule)
function mbInside(x, y) { return x >= 0 && y >= 0 && x <= MB.w && y <= MB.h; }
function mbBin() { return [MB.w - 30, MB.h - 30, 21]; }
function mbOverBin(x, y) { const [bx, by, br] = mbBin(); return Math.hypot(x - bx, y - by) <= br + 6; }
function mbHitAtom(x, y, skip) {
  let best = null, bd = Infinity;
  for (const a of MB.atoms) {
    if (a.id === skip) continue;
    const [sx, sy] = mbScr(a.x, a.y), d = Math.hypot(sx - x, sy - y);
    if (d <= mbRad(a) + 7 && d < bd) { bd = d; best = a; }
  }
  return best;
}
function mbHitBond(x, y) {
  let best = null, bd = 8;
  for (const b of MB.bonds) {
    const A = mbAtom(b.a), B = mbAtom(b.b); if (!A || !B) continue;
    const [ax, ay] = mbScr(A.x, A.y), [bx, by] = mbScr(B.x, B.y), dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const t = ((x - ax) * dx + (y - ay) * dy) / L2;
    if (t < 0 || t > 1) continue;
    const d = Math.hypot(ax + t * dx - x, ay + t * dy - y), L = Math.sqrt(L2);
    if (t * L < mbRad(A) || (1 - t) * L < mbRad(B)) continue; // on an atom, not the bond
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
function mbFit(force) {
  const S0 = mbS0();
  if (!MB.atoms.length) { if (force) { MB.cx = 0; MB.cy = 0; MB.s = S0; } return; }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const a of MB.atoms) {
    const m = mbImplicitH(a) ? 1.2 : 0.5;
    x0 = Math.min(x0, a.x - m); x1 = Math.max(x1, a.x + m); y0 = Math.min(y0, a.y - m); y1 = Math.max(y1, a.y + m);
  }
  const pad = 24;
  const inView = (x, y) => { const [sx, sy] = mbScr(x, y); return sx >= pad && sx <= MB.w - pad && sy >= pad && sy <= MB.h - pad; };
  if (!force && inView(x0, y0) && inView(x1, y1)) return;
  MB.s = clamp(Math.min(S0, (MB.w - 2 * pad) / Math.max(1e-6, x1 - x0), (MB.h - 2 * pad - 30) / Math.max(1e-6, y1 - y0)), 5, S0);
  MB.cx = (x0 + x1) / 2; MB.cy = (y0 + y1) / 2;
}
function mbChanged(fit) {
  MB.info = mbAnalyze();
  if (MB.sel && !mbAtom(MB.sel)) MB.sel = null;
  mbFit(!!fit);
  mbRenderInfo(); mbDraw();
}
function mbRenderInfo() {
  const r = MB.info || mbAnalyze();
  let html;
  if (!MB.atoms.length) html = 'Drag an atom onto the workspace to start.';
  else {
    html = `<b>${esc(r.formula)}</b> · ${r.n} atom${r.n === 1 ? '' : 's'}`;
    if (r.issues.length) html += ` · <span class="bad">${esc(r.issues[0].text)}</span>${r.issues.length > 1 ? ` <span class="bad">(and ${r.issues.length - 1} more)</span>` : ''}`;
    else if (r.lm) html += ` · <span class="good">${esc(r.lm.name)}, in ${molWhere(r.lm)}</span>`;
    else html += ` · ${r.name ? esc(r.name) : 'a new molecule'}`;
    if (r.free) html += ` · ${r.free} free valence${r.free > 1 ? 's' : ''}: a radical, so it will react`;
  }
  if (MB.msg) html += `<br><span class="${MB.msgBad ? 'bad' : 'good'}">${esc(MB.msg)}</span>`;
  $('bldInfo').innerHTML = html;
  $('bldGo').disabled = !MB.atoms.length;
  $('bldUndo').disabled = !MB.undo.length;
  $('bldTidy').disabled = MB.atoms.length < 2;
  $('bldClear').disabled = !MB.atoms.length;
  mbIsoPick();
}
/* The isotope of the selected atom: a list of the element's isotopes (stable ones and those with known decays). */
function mbIsoPick() {
  const a = MB.sel ? mbAtom(MB.sel) : null, wrap = $('bldAWrap');
  if (!wrap) return;
  wrap.hidden = !a;
  if (!a) { MB.isoKey = ''; return; }
  const Z = SYM2Z[a.el], A = a.A || COMMON_A[Z], key = a.id + ':' + a.el + ':' + A;
  if (key === MB.isoKey) return;
  MB.isoKey = key;
  $('bldALab').textContent = ELEMENTS[Z].name;
  $('bldA').innerHTML = isoOptions(Z, A).map(m => `<option value="${m}"${m === A ? ' selected' : ''}>${sup(m)}${a.el} · ${m === COMMON_A[Z] ? 'usual' : isoLife(Z, m)[1]}</option>`).join('');
}
function mbSetIso(A) {
  const a = MB.sel ? mbAtom(MB.sel) : null; if (!a || !Number.isInteger(A)) return;
  const Z = SYM2Z[a.el], nA = A === COMMON_A[Z] ? 0 : A;
  if ((a.A || 0) === nA) return;
  mbSnap(); if (nA) a.A = nA; else delete a.A;
  MB.msg = ''; mbChanged();
}
function mbInk(hex) { const [r, g, b] = hexc(hex); return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0c151e' : '#ffffff'; }
function mbDraw() {
  const cv = $('bldCv');
  if (!MB.ready || $('bldModal').hidden) return;
  const ctx = cv.getContext('2d'); if (!ctx) return;
  const W2 = MB.w, H2 = MB.h, s = MB.s, d = MB.drag;
  ctx.setTransform(MB.dpr, 0, 0, MB.dpr, 0, 0);
  ctx.fillStyle = '#05090e'; ctx.fillRect(0, 0, W2, H2);
  // ångström grid: faint dots, one per Å
  if (s >= 14) {
    ctx.fillStyle = 'rgba(150,182,214,0.13)';
    const [ax, ay] = mbWorld(0, 0), [bx, by] = mbWorld(W2, H2);
    for (let gx = Math.ceil(ax); gx <= bx; gx++) for (let gy = Math.ceil(by); gy <= ay; gy++) { const [px, py] = mbScr(gx, gy); ctx.fillRect(px - 1, py - 1, 2, 2); }
  }
  // scale bar
  ctx.strokeStyle = 'rgba(147,166,184,0.8)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(14, H2 - 18); ctx.lineTo(14 + s, H2 - 18); ctx.moveTo(14, H2 - 22); ctx.lineTo(14, H2 - 14); ctx.moveTo(14 + s, H2 - 22); ctx.lineTo(14 + s, H2 - 14); ctx.stroke();
  ctx.fillStyle = 'rgba(147,166,184,0.9)'; ctx.font = `600 11px ${CH_FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('1 Å', 18 + s, H2 - 14);
  const bad = new Set(((MB.info && MB.info.issues) || []).filter(i => i.id).map(i => i.id));
  // hydrogens that will fill free valences, drawn faintly
  if (MB.fill) for (const a of MB.atoms) {
    const k = mbImplicitH(a); if (!k) continue;
    const [x, y] = mbScr(a.x, a.y), L = mbBondLen(a.el, 'H') * s, rh = clamp(s * 0.22, Math.min(7, s * 0.3), 11);
    for (const t of mbHDirs(a, k)) {
      const hx = x + L * Math.cos(t), hy = y - L * Math.sin(t);
      ctx.strokeStyle = 'rgba(138,157,177,0.45)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hx, hy); ctx.stroke();
      shadeBall(ctx, hx, hy, rh, '#FFFFFF', 0.4);
      if (MB.hA > 1) { ctx.fillStyle = 'rgba(255,211,110,0.75)'; ctx.font = `750 9px ${CH_FONT}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(String(MB.hA), hx - rh * 0.55, hy - rh * 0.75); }
    }
  }
  // bonds
  for (const b of MB.bonds) {
    const A = mbAtom(b.a), B = mbAtom(b.b); if (!A || !B) continue;
    const [ax, ay] = mbScr(A.x, A.y), [bx, by] = mbScr(B.x, B.y);
    const L = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / L, ny = (bx - ax) / L, off = clamp(s * 0.1, Math.min(3, s * 0.15), 5);
    const doomed = d && d.kind === 'bond' && d.bond === b && d.moved && (d.out || d.bin);
    ctx.strokeStyle = doomed ? 'rgba(229,72,77,0.9)' : d && d.kind === 'bond' && d.bond === b ? '#c5d3e0' : '#8a9db1';
    ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    for (let t = 0; t < b.o; t++) {
      const o = (t - (b.o - 1) / 2) * off * 2;
      ctx.beginPath(); ctx.moveTo(ax + nx * o, ay + ny * o); ctx.lineTo(bx + nx * o, by + ny * o); ctx.stroke();
    }
  }
  // atoms
  for (const a of MB.atoms) {
    const [x, y] = mbScr(a.x, a.y), r = mbRad(a), col = ELEMENTS[SYM2Z[a.el]].color;
    const dragging = d && d.kind === 'atom' && d.id === a.id && d.moved, doomed = dragging && (d.out || d.bin);
    shadeBall(ctx, x, y, r, col, doomed ? 0.35 : 1);
    ctx.fillStyle = mbInk(col); ctx.globalAlpha = doomed ? 0.4 : 1;
    ctx.font = `750 ${Math.round(r * (a.el.length > 1 ? 0.85 : 1.0))}px ${CH_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (r >= 7) ctx.fillText(a.el, x, y + 0.5);
    ctx.globalAlpha = 1;
    const ring = (rr, c, w, dash) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); };
    if (bad.has(a.id)) ring(r + 3.5, '#ff8a4c', 2, [4, 3]);
    if (MB.sel === a.id) ring(r + 4, '#6f9cff', 2.5);
    if (MB.hover === a.id || (d && d.over === a.id)) ring(r + 6, '#ffd36e', 3);
    if (doomed) ring(r + 3, 'rgba(229,72,77,0.9)', 2);
    const fv = mbFree(a);
    if (fv) { ctx.fillStyle = '#ffd36e'; for (const t of mbHDirs(a, fv)) { ctx.beginPath(); ctx.arc(x + (r + 6) * Math.cos(t), y - (r + 6) * Math.sin(t), 2.6, 0, Math.PI * 2); ctx.fill(); } }
    if (mbIsoA(a)) { // the mass number, top left, as in ¹³C
      ctx.fillStyle = '#ffd36e'; ctx.font = `800 10px ${CH_FONT}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(String(a.A), x - r * 0.62, y - r * 0.92);
    }
    if (a.q) {
      const t = (Math.abs(a.q) > 1 ? Math.abs(a.q) : '') + (a.q > 0 ? '+' : '−'), bx = x + r * 0.78, by = y - r * 0.78;
      ctx.fillStyle = a.q > 0 ? 'rgba(255,90,78,0.95)' : 'rgba(77,141,255,0.95)';
      ctx.beginPath(); ctx.arc(bx, by, 7.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `800 10px ${CH_FONT}`; ctx.fillText(t, bx, by + 0.5);
    }
  }
  // the bin: drop atoms or bonds on it, or tap it to remove the selected atom (it turns red while one is selected)
  const [bx, by, br] = mbBin(), hot = d && (d.kind === 'atom' || d.kind === 'bond') && d.moved && d.bin;
  const armed = !d && MB.sel ? mbAtom(MB.sel) : null, press = d && d.kind === 'bin';
  ctx.fillStyle = hot || press ? 'rgba(229,72,77,0.28)' : armed ? 'rgba(229,72,77,0.14)' : 'rgba(150,182,214,0.08)';
  ctx.strokeStyle = hot || armed || press ? '#ff6b5e' : 'rgba(150,182,214,0.35)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (armed) {
    ctx.fillStyle = '#ff8a7f'; ctx.font = `650 10.5px ${CH_FONT}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(`Tap to remove ${armed.el}`, bx - br - 7, by);
  }
  ctx.strokeStyle = hot || armed || press ? '#ff6b5e' : 'rgba(197,211,224,0.75)'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(bx - 7, by - 5); ctx.lineTo(bx + 7, by - 5); ctx.moveTo(bx - 2.5, by - 8); ctx.lineTo(bx + 2.5, by - 8);
  ctx.moveTo(bx - 5.5, by - 5); ctx.lineTo(bx - 4.5, by + 8); ctx.lineTo(bx + 4.5, by + 8); ctx.lineTo(bx + 5.5, by - 5); ctx.stroke();
  if (!MB.atoms.length) {
    ctx.fillStyle = 'rgba(197,211,224,0.85)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `650 15px ${CH_FONT}`; ctx.fillText('Drag an atom here from the row above', W2 / 2, H2 / 2 - 12);
    ctx.font = `500 12.5px ${CH_FONT}`; ctx.fillStyle = 'rgba(147,166,184,0.9)';
    ctx.fillText('Drop atoms onto atoms to bond them · tap a bond to make it double or triple', W2 / 2, H2 / 2 + 12);
  }
}

/* ---- gestures */
function mbChipSpec(c) {
  if (c.dataset.more) return null;
  if (c.dataset.el) return { t: 'el', el: c.dataset.el };
  if (c.dataset.q) return { t: 'q', d: +c.dataset.q };
  if (c.dataset.ring) return { t: 'ring', n: +c.dataset.ring, arom: c.dataset.arom === '1' };
  return null;
}
/* A chip dropped on the workspace (lx, ly in workspace pixels). */
/* An element taken from the full table joins the row (most recent first). */
function mbRemember(el) {
  if (MB_ELEMENTS.includes(el)) return;
  const i = MB.extra.indexOf(el);
  if (i === 0) return;
  if (i > 0) MB.extra.splice(i, 1);
  MB.extra.unshift(el);
  if (MB.extra.length > MB_EXTRA_MAX) MB.extra.length = MB_EXTRA_MAX;
  MB.more = false;
  $('bldPal').innerHTML = mbPaletteHTML();
}
function mbDropChip(sp, lx, ly) {
  const T = mbHitAtom(lx, ly), [wx, wy] = mbWorld(lx, ly);
  if (sp.t === 'el') setTimeout(() => mbRemember(sp.el), 0);
  if (sp.t === 'el') { mbSnap(); MB.sel = (T ? mbAttach(sp.el, T.id) : mbNewAtom(sp.el, wx, wy)).id; MB.msg = ''; }
  else if (sp.t === 'q') { if (!T) { mbSay('A charge goes on an atom: drop it onto one.', true); return; } mbCharge(T.id, sp.d); }
  else if (sp.t === 'ring') { mbSnap(); const ids = mbAddRing(sp.n, sp.arom, wx, wy, T ? T.id : null); MB.sel = ids[Math.floor(sp.n / 2)]; MB.msg = ''; }
  mbChanged();
}
/* A chip tapped (or pressed with the keyboard): it goes onto the selected atom, or somewhere clear. */
function mbTapChip(sp) {
  const T = MB.sel ? mbAtom(MB.sel) : null;
  if (sp.t === 'el') setTimeout(() => mbRemember(sp.el), 0);
  if (sp.t === 'el') { mbSnap(); if (T) MB.sel = mbAttach(sp.el, T.id).id; else { const [x, y] = mbFreeSpot(); MB.sel = mbNewAtom(sp.el, x, y).id; } MB.msg = ''; }
  else if (sp.t === 'q') { if (!T) { mbSay('Tap an atom to select it first, or drag the charge onto it.', true); return; } mbCharge(T.id, sp.d); }
  else if (sp.t === 'ring') { mbSnap(); const [x, y] = mbFreeSpot(); const ids = mbAddRing(sp.n, sp.arom, x, y, T ? T.id : null); MB.sel = ids[Math.floor(sp.n / 2)]; MB.msg = ''; }
  mbChanged();
}
function mbPalDown(e) {
  const c = e.target && e.target.closest ? e.target.closest('.bchip') : null; if (!c) return;
  const sp = mbChipSpec(c); if (!sp) return;
  const cv = $('bldCv');
  let shown = false;
  trackPointer(c, e, {
    move(ev) {
      if (!shown) { // a table cell drags as the round chip
        const html = c.classList.contains('bcell') ? `<span class="bdot" style="${c.firstElementChild.getAttribute('style')}">${c.dataset.el}</span>` : c.innerHTML;
        ghostShow(html, ev.clientX, ev.clientY); shown = true;
      }
      ghostMove(ev.clientX, ev.clientY);
      const [lx, ly] = localXY(cv, ev), inside = mbInside(lx, ly) && !mbOverBin(lx, ly);
      const T = inside ? mbHitAtom(lx, ly) : null, hv = T ? T.id : null;
      ghostMark(inside ? '' : 'away');
      if (hv !== MB.hover) { MB.hover = hv; mbDraw(); }
    },
    up(ev, moved) {
      ghostHide(); MB.hover = null;
      if (!moved) return; // a tap: the click handler adds it
      const [lx, ly] = localXY(cv, ev);
      if (!mbInside(lx, ly) || mbOverBin(lx, ly)) { mbDraw(); return; }
      mbDropChip(sp, lx, ly);
    },
    cancel() { ghostHide(); MB.hover = null; mbDraw(); },
  });
}
function mbPalClick(e) {
  const c = e.target && e.target.closest ? e.target.closest('.bchip') : null; if (!c || !clickOk()) return;
  if (c.dataset.more) { mbShowMore(!MB.more); return; }
  const sp = mbChipSpec(c); if (sp) mbTapChip(sp);
}
function mbShowMore(on) {
  MB.more = on;
  const t = $('bldMore'), b = $('bldPal').querySelector('[data-more]');
  if (t) t.hidden = !on;
  if (b) b.setAttribute('aria-expanded', String(on));
}
/* On the workspace: drag an atom to move it, onto another atom to bond them (again for a double bond), onto
   the bin or off the workspace to remove it; drag a bond off to remove it; tap a bond to cycle its order;
   drag empty space to pan. */
function mbDown(e) {
  if (e.pointerType === 'mouse' && e.button) return;
  const cv = $('bldCv'), [x, y] = localXY(cv, e);
  const A = mbHitAtom(x, y), B = A ? null : mbHitBond(x, y), onBin = !A && !B && mbOverBin(x, y);
  if (e.preventDefault) e.preventDefault();
  try { cv.focus({ preventScroll: true }); } catch (err) { /* focus is a nicety */ }
  const d = MB.drag = { kind: A ? 'atom' : B ? 'bond' : onBin ? 'bin' : 'pan', id: A ? A.id : null, bond: B, ox: A ? A.x : 0, oy: A ? A.y : 0,
    px: x, py: y, over: null, out: false, bin: false, moved: false, snapped: false };
  if (onBin) mbDraw(); // shows it pressed
  trackPointer(cv, e, {
    move(ev) {
      const [lx, ly] = localXY(cv, ev);
      d.moved = true; d.out = !mbInside(lx, ly); d.bin = !d.out && mbOverBin(lx, ly);
      if (d.kind === 'bin') d.kind = 'pan'; // pressed on the bin and dragged: just moving the view
      if (d.kind === 'atom') {
        const a = mbAtom(d.id); if (!a) return;
        if (!d.snapped) { mbSnap(); d.snapped = true; }
        const T = d.out || d.bin ? null : mbHitAtom(lx, ly, a.id); d.over = T ? T.id : null;
        if (!d.out) { const [wx, wy] = mbWorld(clamp(lx, 0, MB.w), clamp(ly, 0, MB.h)); a.x = wx; a.y = wy; }
      } else if (d.kind === 'pan') {
        MB.cx -= (lx - d.px) / MB.s; MB.cy += (ly - d.py) / MB.s; d.px = lx; d.py = ly;
      }
      mbDraw();
    },
    up(ev, moved) {
      MB.drag = null;
      if (!moved) { // a tap
        if (d.kind === 'atom') MB.sel = MB.sel === d.id ? null : d.id;
        else if (d.kind === 'bond') { mbSnap(); d.bond.o = d.bond.o >= 3 ? 1 : d.bond.o + 1; MB.msg = ''; }
        else if (d.kind === 'bin') { mbBinTap(); return; }
        else MB.sel = null;
        mbChanged(); return;
      }
      if (d.kind === 'atom') {
        const a = mbAtom(d.id);
        if (a && (d.out || d.bin)) { mbDelete(a.id); MB.msg = ''; }
        else if (a && d.over) {
          const T = mbAtom(d.over), lone = !mbNbrs(a.id).length;
          if (lone) { const t = mbAttachDir(T), L = mbBondLen(T.el, a.el); a.x = T.x + L * Math.cos(t); a.y = T.y + L * Math.sin(t); }
          else { a.x = d.ox; a.y = d.oy; }
          if (!mbJoin(a.id, T.id)) mbSay('That bond is already triple: tap it to go back to single.', true); else MB.msg = '';
        }
      } else if (d.kind === 'bond' && (d.out || d.bin)) { mbSnap(); MB.bonds = MB.bonds.filter(b => b !== d.bond); MB.msg = ''; }
      mbChanged();
    },
    cancel() {
      const a = d.kind === 'atom' ? mbAtom(d.id) : null;
      if (a) { a.x = d.ox; a.y = d.oy; if (d.snapped) MB.undo.pop(); }
      MB.drag = null; mbDraw();
    },
  });
}
/* The bin tapped: removes the selected atom (Undo brings it back); with nothing selected, says how it works. */
function mbBinTap() {
  const a = MB.sel ? mbAtom(MB.sel) : null;
  if (a) { mbSnap(); mbDelete(a.id); MB.msg = ''; mbChanged(); return; }
  mbSay(MB.atoms.length ? 'To remove an atom, tap it and then the bin, or drag it onto the bin. Clear empties the workspace.' : 'Nothing to remove yet.', false);
  mbDraw();
}
function mbKey(e) {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT') return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && MB.sel) { e.preventDefault(); mbSnap(); mbDelete(MB.sel); mbChanged(); }
  else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); mbUndo(); }
}
function mbRingSVG(n, arom) {
  const pts = [];
  for (let k = 0; k < n; k++) { const t = -Math.PI / 2 + 2 * Math.PI * k / n; pts.push(`${(12 + 9 * Math.cos(t)).toFixed(1)},${(12 + 9 * Math.sin(t)).toFixed(1)}`); }
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><polygon points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>` +
    (arom ? '<circle cx="12" cy="12" r="4.4" fill="none" stroke="currentColor" stroke-width="1.5"/>' : '') + '</svg>';
}
function mbPaletteHTML() {
  const chip = (attrs, label, inner) => `<button type="button" class="bchip" ${attrs} title="${esc(label)}" aria-label="${esc(label)}">${inner}</button>`;
  const elChip = (sym) => {
    const E = ELEMENTS[SYM2Z[sym]];
    return chip(`data-el="${sym}"`, `${E.name}: drag onto the workspace, or onto an atom to bond it there`, `<span class="bdot" style="background:${E.color};color:${mbInk(E.color)}">${sym}</span>`);
  };
  const els = MB_ELEMENTS.map(elChip).join('') + MB.extra.map(elChip).join('') +
    `<button type="button" class="bchip more" data-more="1" aria-expanded="${MB.more}" aria-controls="bldMore" title="Every element: pick one to drag in">⋯</button>`;
  // the whole periodic table, its cells dragged or tapped like the chips (an element that forms no bonds as a
  // neutral atom can still be placed, or charged)
  let cells = '';
  for (let Z = 1; Z <= Z_TABLE; Z++) {
    const E = ELEMENTS[Z]; if (!E) continue;
    const [r, c] = ptablePos(Z); // rows 0–6, then the f-block in rows 8–9 below a thin gap (row 7)
    const cap = mbCap(E.sym, 0), none = cap.cap === 0 && cap.hyper === 0;
    cells += `<button type="button" class="bchip bcell${none ? ' inert' : ''}" data-el="${E.sym}" style="grid-row:${r + 1};grid-column:${c + 1}" title="${esc(E.name)}${none ? ' (forms no bonds as a neutral atom)' : cap.hyper > cap.cap ? ` (${cap.cap} bonds, up to ${cap.hyper} to F or O)` : ` (${cap.cap} bond${cap.cap === 1 ? '' : 's'})`}" aria-label="${esc(E.name)}"><span style="background:${E.color};color:${mbInk(E.color)}">${E.sym}</span></button>`;
  }
  const table = `<div class="bmore" id="bldMore" role="group" aria-label="Every element"${MB.more ? '' : ' hidden'}><div class="bmgrid">${cells}</div></div>`;
  const qs = chip('data-q="1"', 'Positive charge: drag onto an atom', '<span class="bdot q pos">+</span>') +
    chip('data-q="-1"', 'Negative charge: drag onto an atom', '<span class="bdot q neg">−</span>');
  const rings = MB_RINGS.map(([n, arom, name]) => chip(`data-ring="${n}" data-arom="${arom ? 1 : 0}"`, `${name}: drag onto the workspace, or onto an atom`, `<span class="bdot ring">${mbRingSVG(n, arom)}</span>`)).join('');
  return `<div class="bgrp" role="group" aria-label="Atoms">${els}</div><div class="bgrp" role="group" aria-label="Charges">${qs}</div><div class="bgrp" role="group" aria-label="Rings">${rings}</div>${table}`;
}
function mbResize(force) {
  if (fitCanvas($('bldCv'), $('bldStage'), MB) || force) { mbFit(!!force); mbDraw(); }
}
function openMolBuilder() {
  hideModal('molModal');
  if (!MB.palOK) { $('bldPal').innerHTML = mbPaletteHTML(); MB.palOK = true; }
  $('bldFill').checked = MB.fill; $('bldHA').value = String(MB.hA);
  MB.msg = '';
  if (!AI.busy) aiSay('');
  aiSync();
  showModal('bldModal');
  mbResize(true);
  mbChanged(true);
}

/* ================================================================== isotope builder */
const NB = { Z: 6, N: 6, ne: 6, anti: false, w: 360, h: 360, dpr: 1, ready: false, binsFor: null, pick: null, hot: false, msg: '', msgBad: false };
const NB_KINDS = [['p', 'Protons', 'proton', P_COL], ['n', 'Neutrons', 'neutron', N_COL], ['e', 'Electrons', 'electron', E_COL]];
const NB_KINDS_ANTI = [['p', 'Antiprotons', 'antiproton', PBAR_COL], ['n', 'Antineutrons', 'antineutron', NBAR_COL], ['e', 'Positrons', 'positron', POS_COL]];
function nbKinds() { return NB.anti ? NB_KINDS_ANTI : NB_KINDS; }
function nbWord(k) { return nbKinds().find(x => x[0] === k)[2]; }
function nbMaxN(Z) { return Math.max(4, 2 * Z + 10); }
function nbMaxE(Z) { return Z ? Z + maxExtraElectrons(Z) : 0; } // positrons on antimatter: the mirror image
function nbCharge() { const { Z, ne } = NB; return !Z ? 0 : !ne ? (NB.anti ? -Z : Z) : NB.anti ? ne - Z : Z - ne; }
function nbSpec() {
  const { Z, N, ne } = NB;
  if (Z >= 1) { const s = { kind: 'atom', Z, A: Z + N, charge: ne ? nbCharge() : 0, bare: ne === 0 }; if (NB.anti) s.anti = true; return s; }
  if (N === 1 && ne === 0) return NB.anti ? { kind: 'nbar' } : { kind: 'n' };
  return null;
}
function nbName(Z, N) {
  if (!NB.anti) return nucName(Z, N);
  if (!Z) return N === 1 ? 'Antineutron' : N + '-antineutron cluster';
  return Z === 1 ? 'Antihydrogen-' + (Z + N) : 'Anti-' + nucName(Z, N).toLowerCase();
}
/* Where everything sits: nucleons packed as in the chamber's Particle view, electrons in their shells. */
function nbGeom() {
  const { Z, N, ne } = NB, A = Z + N, cx = NB.w / 2, cy = NB.h / 2, Rout = Math.max(40, Math.min(NB.w, NB.h) / 2 - 8);
  const bMax = clamp(Rout / 15, 3.5, 10), b = A ? Math.min(bMax, 0.4 * Rout / rnUnit(A)) : bMax;
  const rn = A ? b * rnUnit(A) : 0, cs = b / Math.sqrt(0.82), br = b * 1.12;
  // which places hold protons: a fixed shuffle of the places, so adding one particle barely changes the picture
  const order = [];
  for (let k = 0; k < A; k++) { const hh = Math.sin((k + 1) * 12.9898) * 43758.5453; order.push([hh - Math.floor(hh), k]); }
  order.sort((u, v) => u[0] - v[0]);
  const prot = new Uint8Array(A);
  for (let j = 0; j < Math.min(Z, A); j++) prot[order[j][1]] = 1;
  const nuc = [];
  for (let k = 0; k < A; k++) { const rr = A === 1 ? 0 : cs * Math.sqrt(k + 0.5), th = k * 2.39996; nuc.push([cx + rr * Math.cos(th), cy + rr * Math.sin(th), prot[k] === 1]); }
  const er = clamp(Rout / 32, 3, 6.5);
  const nF = Z ? shellCounts(Z, Math.max(Z, ne)).length : 0;
  const rIn = Math.min(rn + Math.max(16, 3 * er), Rout - 16), rOut = Rout - er - 4;
  const shells = [];
  for (let i = 0; i < nF; i++) shells.push(nF === 1 ? (rIn + rOut) / 2 : rIn + (rOut - rIn) * i / (nF - 1));
  const els = [];
  if (Z && ne) shellCounts(Z, ne).forEach((n, i) => {
    const R0 = shells[Math.min(i, shells.length - 1)];
    for (let k = 0; k < n; k++) { const t = -Math.PI / 2 + 2 * Math.PI * k / n + i * 0.55; els.push([cx + R0 * Math.cos(t), cy + R0 * Math.sin(t)]); }
  });
  return { cx, cy, Rout, br, rn, nuc, er, shells, els };
}
function nbHit(x, y) {
  const G = nbGeom();
  let best = null, bd = Infinity;
  G.els.forEach(([ex, ey], i) => { const d = Math.hypot(ex - x, ey - y); if (d < G.er + 9 && d < bd) { bd = d; best = { t: 'e', i }; } });
  if (best) return best;
  if (Math.hypot(x - G.cx, y - G.cy) <= G.rn + 6) G.nuc.forEach(([nx, ny, isP], i) => { const d = Math.hypot(nx - x, ny - y); if (d < bd) { bd = d; best = { t: isP ? 'p' : 'n', i }; } });
  return best;
}
function nbDraw() {
  const cv = $('nucCv');
  if (!NB.ready || $('nucModal').hidden) return;
  const ctx = cv.getContext('2d'); if (!ctx) return;
  const G = nbGeom(), pk = NB.pick;
  ctx.setTransform(NB.dpr, 0, 0, NB.dpr, 0, 0);
  ctx.fillStyle = '#05090e'; ctx.fillRect(0, 0, NB.w, NB.h);
  // the atom's reach: drop particles anywhere inside it
  ctx.fillStyle = NB.hot ? 'rgba(111,156,255,0.12)' : 'rgba(150,182,214,0.04)';
  ctx.strokeStyle = NB.hot ? 'rgba(111,156,255,0.75)' : 'rgba(150,182,214,0.22)'; ctx.lineWidth = NB.hot ? 2 : 1;
  ctx.setLineDash([5, 6]); ctx.beginPath(); ctx.arc(G.cx, G.cy, G.Rout, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(160,200,240,0.28)'; ctx.lineWidth = 1;
  for (const R0 of G.shells) { ctx.beginPath(); ctx.arc(G.cx, G.cy, R0, 0, Math.PI * 2); ctx.stroke(); }
  const K = nbKinds();
  G.els.forEach(([x, y], i) => { if (!(pk && pk.t === 'e' && pk.i === i)) shadeBall(ctx, x, y, G.er, K[2][3]); });
  for (let k = G.nuc.length - 1; k >= 0; k--) { // rim first, so the middle sits on top
    if (pk && pk.t !== 'e' && pk.i === k) continue;
    const [x, y, isP] = G.nuc[k];
    shadeBall(ctx, x, y, G.br, isP ? K[0][3] : K[1][3]);
  }
  if (!NB.Z && !NB.N) {
    ctx.fillStyle = 'rgba(197,211,224,0.85)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `650 14px ${CH_FONT}`;
    ctx.fillText(`Drag ${NB.anti ? 'an antiproton' : 'a proton'} in here`, G.cx, G.cy);
  }
}
function nbSay(text, bad) { NB.msg = text; NB.msgBad = !!bad; }
function nbAdd(k) {
  const { Z, N, ne } = NB;
  const wp = nbWord('p'), wn = nbWord('n'), we = nbWord('e');
  if (k === 'p') { if (Z >= 118) { nbSay(`118 ${wp}s is the most of any known element (${NB.anti ? 'anti-oganesson' : 'oganesson'}).`, true); } else { NB.Z++; nbSay(''); } }
  else if (k === 'n') { if (N >= nbMaxN(Z)) nbSay(`That many ${wn}s would not even hold together for an instant.`, true); else { NB.N++; nbSay(''); } }
  else if (k === 'e') {
    if (!Z) nbSay(`${we[0].toUpperCase() + we.slice(1)}s need ${wp}s to hold them: add ${NB.anti ? 'an antiproton' : 'a proton'} first.`, true);
    else if (ne >= nbMaxE(Z)) { const x = nbMaxE(Z) - Z, nm = NB.anti ? antiName(Z) : ELEMENTS[Z].name; nbSay(`${nm} holds ${x ? 'at most ' + x + ' extra ' + we + (x > 1 ? 's' : '') : 'no extra ' + we + 's'}: another would just fly off.`, true); }
    else { NB.ne++; nbSay(''); }
  }
  nbChanged();
}
function nbRemove(k) {
  const wp = nbWord('p'), wn = nbWord('n'), we = nbWord('e');
  if (k === 'p') {
    if (!NB.Z) nbSay(`There are no ${wp}s left to take out.`, true);
    else {
      NB.Z--; nbSay('');
      const lim = nbMaxE(NB.Z);
      if (NB.ne > lim) { const lost = NB.ne - lim; NB.ne = lim; nbSay(`${lost} ${we}${lost > 1 ? 's' : ''} flew off: ${NB.Z ? 'the smaller nucleus cannot hold them' : 'nothing is left to hold them'}.`); }
    }
  } else if (k === 'n') { if (!NB.N) nbSay(`There are no ${wn}s left to take out.`, true); else { NB.N--; nbSay(''); } }
  else if (k === 'e') { if (!NB.ne) nbSay(`There are no ${we}s left: this is a bare ${NB.anti ? 'antinucleus' : 'nucleus'}.`, true); else { NB.ne--; nbSay(''); } }
  nbChanged();
}
function nbInfoHTML() {
  const { Z, N, ne } = NB, A = Z + N;
  if (!A) return NB.anti ? '<p class="note">Nothing yet. One antiproton on its own is an antihydrogen nucleus; add a positron and it is an antihydrogen atom, the mirror image of hydrogen.</p>'
    : '<p class="note">Nothing yet. One proton on its own is a hydrogen nucleus; add an electron and it is a hydrogen atom.</p>';
  const nuc = nuclideInfo(Z, N), q = nbCharge(), K = nbKinds(), anti = NB.anti;
  const modes = nuc.modes.map(m => modeLabel(m.mode) + (m.br < 0.999 ? ` ${(m.br * 100).toPrecision(2)}%` : '')).join(', ');
  const [cls, short] = isoLife(Z, A);
  const life = nuc.stable ? 'Stable' : nuc.unbound ? 'Unbound: it falls apart at once' : 'Radioactive, ' + short + (nuc.estimated ? ' (estimated)' : '');
  const name = nbName(Z, N), sym = Z ? ELEMENTS[Z].sym : 'n';
  const what = !Z ? (N === 1 ? (anti ? 'a free antineutron' : 'a free neutron') : (anti ? 'antineutrons' : 'neutrons') + ' only: not an element')
    : !ne ? (anti ? 'bare antinucleus' : 'bare nucleus') : !q ? (anti ? 'neutral anti-atom' : 'neutral atom') : q > 0 ? 'positive ion' : 'negative ion';
  const qs = q ? (Math.abs(q) > 1 ? Math.abs(q) : '') + (q > 0 ? '+' : '−') : '';
  const stat = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  return `<div class="nsym${anti ? ' anti' : ''}" aria-hidden="true"><span class="naz"><span>${A}</span><span>${Z}</span></span><span class="nel">${symHTML(sym, anti)}</span>${qs ? `<span class="nq">${qs}</span>` : ''}</div>
    <div class="nname"><b>${esc(name)}</b> <span>${what}</span></div>
    <div class="nlife"><i class="life ${cls}" aria-hidden="true"></i><span>${esc(life)}${modes && !nuc.stable ? ' · ' + esc(modes) : ''}</span></div>
    <dl class="nstats">${stat(K[0][1], Z)}${stat(K[1][1], N)}${stat(K[2][1], ne)}${stat('Mass number', A)}${stat('Charge', q ? (q > 0 ? '+' : '−') + Math.abs(q) : '0')}</dl>
    ${Z && ne ? `<div class="nconf"><span>${K[2][1]}</span> ${esc(configString(Z, ne))}</div>` : ''}
    ${anti ? '<p class="note">Antimatter: the mirror image of the same isotope, with every charge reversed. It annihilates on touching ordinary matter.</p>' : ''}`;
}
function nbChanged() {
  for (const [k] of NB_KINDS) { const c = $('nbc_' + k); if (c) c.textContent = String(k === 'p' ? NB.Z : k === 'n' ? NB.N : NB.ne); }
  $('nucTitle').textContent = NB.anti ? 'Isotope builder: antimatter' : 'Isotope builder';
  $('nucInfo').innerHTML = nbInfoHTML();
  const m = $('nucMsg'); m.textContent = NB.msg; m.className = 'note' + (NB.msgBad ? ' bad' : '');
  const sp = nbSpec(), u = $('nucUse');
  u.disabled = !sp; u.textContent = sp ? 'Use ' + specLabel(sp) : NB.Z ? 'Use' : NB.anti ? 'Add an antiproton first' : 'Add a proton first';
  const sv = $('nucSave'), atom = !!sp && sp.kind === 'atom', f = atom ? saveBtnFace(sp) : null; // (a lone neutron is in the palette already)
  sv.hidden = !atom;
  if (atom) { sv.textContent = f.text; sv.title = f.title; sv.setAttribute('aria-pressed', String(f.on)); }
  nbDraw();
}
function nbBinsHTML() {
  const pile = (col) => { const at = [[7, 19], [17, 19], [27, 19], [12, 11], [22, 11], [17, 3]]; return at.map(([x, y]) => `<i style="left:${x - 5}px;top:${y - 2}px;${ballCSS(col)}"></i>`).join(''); };
  return nbKinds().map(([k, label, one, col]) => `<div class="nbinw"><button type="button" class="nbin" data-k="${k}" aria-label="${label}: drag one into the atom, or press to add one" title="Drag a ${one} into the atom, or press to add one">` +
    `<span class="pile" aria-hidden="true">${pile(col)}</span><span class="nbl">${label}</span><b class="nbc" id="nbc_${k}">0</b></button>` +
    `<button type="button" class="nbx" data-x="${k}" aria-label="Take a ${one} out" title="Take a ${one} out">−</button></div>`).join('');
}
function nbBallHTML(k) { const r = nbKinds().find(x => x[0] === k); return `<span class="gball${k === 'e' ? ' e' : ''}" style="${ballCSS(r[3])}"></span>`; }
function nbInAtom(cv, ev, G) { const [lx, ly] = localXY(cv, ev); return Math.hypot(lx - G.cx, ly - G.cy) <= G.Rout && lx >= 0 && ly >= 0 && lx <= NB.w && ly <= NB.h; }
function nbBinDown(e) {
  const b = e.target && e.target.closest ? e.target.closest('.nbin') : null; if (!b) return;
  const k = b.dataset.k, cv = $('nucCv');
  let shown = false;
  trackPointer(b, e, {
    move(ev) {
      if (!shown) { ghostShow(nbBallHTML(k), ev.clientX, ev.clientY); shown = true; }
      ghostMove(ev.clientX, ev.clientY);
      const inside = nbInAtom(cv, ev, nbGeom());
      ghostMark(inside ? '' : 'away');
      if (inside !== NB.hot) { NB.hot = inside; nbDraw(); }
    },
    up(ev, moved) {
      ghostHide(); NB.hot = false;
      if (!moved) return; // a tap: the click handler adds one
      if (nbInAtom(cv, ev, nbGeom())) nbAdd(k); else nbDraw();
    },
    cancel() { ghostHide(); NB.hot = false; nbDraw(); },
  });
}
function nbBinClick(e) {
  const x = e.target && e.target.closest ? e.target.closest('.nbx') : null;
  if (x) { nbRemove(x.dataset.x); return; }
  const b = e.target && e.target.closest ? e.target.closest('.nbin') : null;
  if (b && clickOk()) nbAdd(b.dataset.k);
}
/* Pull a particle out: a nucleon dragged away from the nucleus, or an electron dragged out of the atom. */
function nbDown(e) {
  if (e.pointerType === 'mouse' && e.button) return;
  const cv = $('nucCv'), [x, y] = localXY(cv, e), hit = nbHit(x, y);
  if (!hit) return;
  if (e.preventDefault) e.preventDefault();
  const away = (ev) => { const G = nbGeom(), [lx, ly] = localXY(cv, ev), d = Math.hypot(lx - G.cx, ly - G.cy); return hit.t === 'e' ? d > G.Rout : d > G.rn + 10; };
  trackPointer(cv, e, {
    move(ev) {
      if (!NB.pick) { NB.pick = hit; ghostShow(nbBallHTML(hit.t), ev.clientX, ev.clientY); nbDraw(); }
      ghostMove(ev.clientX, ev.clientY);
      ghostMark(away(ev) ? 'away' : '');
    },
    up(ev, moved) {
      ghostHide(); NB.pick = null;
      if (moved && away(ev)) nbRemove(hit.t); else nbDraw();
    },
    cancel() { ghostHide(); NB.pick = null; nbDraw(); },
  });
}
function nbUse() {
  const sp = nbSpec(); if (!sp) return;
  hideModal('nucModal'); selectSpec(sp);
  log('tool', `Isotope builder: ${specLabel(sp)} (${sp.kind === 'n' ? 'a free neutron' : sp.kind === 'nbar' ? 'a free antineutron' : nbName(sp.Z, sp.A - sp.Z)}) is ready to place`);
}
function nbResize() { if (fitCanvas($('nucCv'), $('nucStage'), NB)) nbDraw(); }
function openNucBuilder(seed) {
  if (seed) {
    NB.Z = clamp(Math.round(seed.Z) || 0, 0, 118);
    NB.N = clamp(Math.round(seed.N) || 0, 0, nbMaxN(NB.Z));
    NB.ne = clamp(Math.round(seed.ne) || 0, 0, nbMaxE(NB.Z));
    NB.anti = !!seed.anti;
  }
  if (NB.binsFor !== NB.anti) { $('nucBins').innerHTML = nbBinsHTML(); NB.binsFor = NB.anti; }
  NB.msg = ''; NB.pick = null; NB.hot = false;
  showModal('nucModal');
  nbResize();
  nbChanged();
}

/* ------------------------------------------------------------------ wiring (called once from init) */
function builderInit() {
  $('bldClose').onclick = () => hideModal('bldModal');
  $('bldPal').onpointerdown = mbPalDown;
  $('bldPal').onclick = mbPalClick;
  $('bldCv').onpointerdown = mbDown;
  $('bldUndo').onclick = () => mbUndo();
  $('bldClear').onclick = () => mbClear();
  $('bldTidy').onclick = () => mbTidy();
  $('bldGo').onclick = () => mbBuild();
  $('bldFill').onchange = (e) => { MB.fill = !!e.target.checked; MB.msg = ''; mbChanged(); };
  $('bldHA').onchange = (e) => { MB.hA = [1, 2, 3].includes(+e.target.value) ? +e.target.value : 1; MB.msg = ''; mbChanged(); };
  $('bldA').onchange = (e) => mbSetIso(+e.target.value);
  $('bldName').addEventListener('keydown', (e) => { if (e.key === 'Enter') mbBuild(); });
  $('aiGo').onclick = () => aiAsk($('aiAsk').value);
  $('aiAsk').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !AI.busy) aiAsk($('aiAsk').value); });
  $('bldModal').addEventListener('keydown', mbKey);
  $('nucClose').onclick = () => hideModal('nucModal');
  $('nucBins').onpointerdown = nbBinDown;
  $('nucBins').onclick = nbBinClick;
  $('nucCv').onpointerdown = nbDown;
  $('nucUse').onclick = () => nbUse();
  $('nucSave').onclick = () => {
    const sp = nbSpec(); if (!sp || sp.kind !== 'atom') return;
    nbSay(myIsoToggle(sp) ? `Saved: ${specLabel(sp)} stays in the Place tool’s bar under the chamber, in this browser.` : `${specLabel(sp)} is off your saved isotopes.`);
    nbChanged();
  };
  new ResizeObserver(() => { if (!$('bldModal').hidden) mbResize(); }).observe($('bldStage'));
  new ResizeObserver(() => { if (!$('nucModal').hidden) nbResize(); }).observe($('nucStage'));
}
