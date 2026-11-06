'use strict';
/* The 1.25 checks, run by t_features (its "1.25" block) or alone: node tests/f_125.js [part …]
   (parts: hexazine, settings, bo6, bo3d). (page: the t_features page; check(ok, good, bad); say(...)) */
const { load } = require('./load');
const PARTS = {};
const TABS = ['perf', 'gfx', 'disp', 'ctl', 'gen', 'd3', 'ai', 'exp'];

/* ---- 1. hexazine with quantum bonds (an investigation; nothing in the physics changed): GFN1-xTB's own barrier on the
   in-plane N₆ → 3 N₂ path (D₃h, single points at the scan's relaxed geometries), and the ring breaking in the game's
   quantum bonds once hot. A record of what was found: it passes on 1.24 too. */
PARTS.hexazine = async (page, check, say) => {
  const X = load('all', { seed: 1 }), Z6 = [7, 7, 7, 7, 7, 7];
  const ring = (s, l) => { // a hexagon of alternating sides s, l, all angles 120° (D₃h)
    let lo = 0.01, hi = 59.99; for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (Math.sin(m * Math.PI / 180) / Math.sin((60 - m) * Math.PI / 180) < s / l) lo = m; else hi = m; }
    const h = (lo + hi) / 2, R = s / (2 * Math.sin(h * Math.PI / 180)), out = [];
    for (let i = 0; i < 3; i++) for (const sg of [-1, 1]) { const t = (120 * i + sg * h) * Math.PI / 180; out.push([R * Math.cos(t), R * Math.sin(t), 0]); }
    return out;
  };
  const E = (g) => X.XTB.gfn1Energy(Z6, g, 0, 0, {}).E + X.XTB.d3Disp(Z6, g, {}).E;
  const e6 = E(ring(1.296, 1.296)), ets = E(ring(1.170, 1.60)), e3 = E(ring(1.0985, 4.0));
  const barrier = +(ets - e6).toFixed(3), release = +(e6 - e3).toFixed(3);
  // the game: six N atoms in the ring, quantum bonds, insulated from 3,000 K: three N₂ within 0.1 ps
  const G = load('all', { seed: 1 }), W = G.W; G.PRESETS.empty.build(); G.setBox(30, 30);
  for (let i = 0; i < 6; i++) { const t = i * Math.PI / 3; G.addAtom('N', 1.296 * Math.cos(t), 1.296 * Math.sin(t), { T: 3000 }); }
  W.gamma = 0; G.forcesNoEvents(); G.boSet(2); G.forcesNoEvents(); W.fSpawn = W.spawned;
  let broke = -1; for (let i = 0; i < 400 && broke < 0; i++) { W.dt = G.chooseDt(); G.step(W.dt); const pq = G.XQ.pq; if (pq.filter(q => q.n > 1.5).length === 3 && pq.filter(q => q.n > 0.5).length === 3) broke = W.t * G.PHYS.TU_S * 1e12; }
  check(barrier > 0.45 && barrier < 0.6 && release > 1.5 && release < 1.9 && broke > 0 && broke < 0.1,
    `1.25: hexazine with quantum bonds: GFN1-xTB itself gives the flat ring a barrier of ${barrier} eV on the way to 3 N₂ (D₃h, long N···N 1.60 Å) and releases only ${release} eV (real: about 9–10 eV), so it holds at room temperature; from 3,000 K it falls apart into three N₂ in ${broke.toFixed(3)} ps`,
    '1.25 hexazine: ' + JSON.stringify({ barrier, release, broke }));
};

/* ---- 2. Settings: a setting's description in the side pane only (the owner: "it repeats the description in the settings
   menu, but it's supposed to be in the sidebar only"); live readouts stay under their rows; on a narrow screen (the pane a
   short strip on top) the descriptions stay in the list, which no longer runs off the right edge */
PARTS.settings = async (page, check, say, openPage) => {
  const look = (pg) => pg.evaluate(async (TABS) => {
    const out = { tabs: {} };
    for (const t of TABS) {
      openSettings(t); await new Promise(r => setTimeout(r, 60));
      const b = document.querySelector('#setModal .sbox'), vis = (n) => !!n.offsetParent && n.textContent.trim() !== '';
      const notes = [...document.querySelectorAll('#setModal .spane:not([hidden]) > p.note')];
      out.tabs[t] = { desc: notes.filter(n => vis(n) && !n.hasAttribute('aria-live') && !['expReset', 'set3dNote', 'set3dKeys'].includes(n.id)).length, over: b.scrollWidth - b.clientWidth };
    }
    openSettings('exp'); setPrevShow('segBo', '1'); await new Promise(r => setTimeout(r, 60));
    const pn = $('setPrevD').querySelector('.sprev-notes');
    out.paneNotes = pn ? [...pn.querySelectorAll('p.note')].length : 0; out.paneShown = !!(pn && pn.offsetParent);
    openSettings('perf'); setPrevShow('segThreads', null); await new Promise(r => setTimeout(r, 60));
    out.live = ['setPrioV', 'setThreads'].map(id => !!$(id).offsetParent && $(id).textContent.trim() !== '');
    out.liveInPane = /Threads|thread/.test($('setPrevD').querySelector('.sprev-notes') ? $('setPrevD').querySelector('.sprev-notes').textContent : '');
    $('setModal').hidden = true; return out;
  }, TABS);
  const wide = await look(page);
  const { browser, page: narrowPage } = await openPage({ viewport: { width: 390, height: 844 }, settle: 600 });
  const narrow = await look(narrowPage); await browser.close();
  say('  settings: ' + JSON.stringify({ wide, narrow }));
  const sum = (o, k) => TABS.reduce((s, t) => s + o.tabs[t][k], 0), worst = (o) => Math.max(...TABS.map(t => o.tabs[t].over));
  check(sum(wide, 'desc') === 0 && wide.paneNotes >= 2 && wide.paneShown && wide.live.every(Boolean) && !wide.liveInPane && sum(narrow, 'desc') >= 10 && !narrow.paneShown && worst(narrow) <= 1,
    `1.25: Settings at 1360 px: no description under any setting in the 8 tabs, the side pane shows them (bond orders: ${wide.paneNotes} notes), live readouts (priority, threads) stay under their rows; at 390 px (the pane a short strip) the ${sum(narrow, 'desc')} descriptions stay in the list and none runs off its right edge (worst ${worst(narrow)} px)`,
    '1.25 settings: ' + JSON.stringify({ wide, narrow }));
};

/* ---- 3. continuous bond orders for Ge, As, Se, Sn, Sb, Te: their molecules take part (tin in its molecules only, metallic
   tin keeps its metal bonding); relaxed, they match the stored bonds; an angle's two ends far apart (SbCl₃'s Cl–Sb–Cl at
   140–160°, 4.4–4.6 Å) keep their 1-3 exclusion (it ended at 4.4 Å: a 0.08 eV step); forces the energy's slope */
const mol = (X, c, l, n, o, x0, y0, z0 = 0) => { // a centre and n ligands with stored bonds, in the plane (a little out of it in 3-D)
  const C = X.addAtom(c, x0, y0, { T: 0, z: z0 }), L = X.bondLength(C.el, X.ELEMENTS[X.SYM2Z[l]], o);
  for (let i = 0; i < n; i++) { const t = 2 * Math.PI * i / n + 0.1, ph = X.W.d3 ? (i % 2 ? 0.5 : -0.5) : 0; X.addBond(C, X.addAtom(l, x0 + L * Math.cos(t) * Math.cos(ph), y0 + L * Math.sin(t) * Math.cos(ph), { T: 0, z: z0 + L * Math.sin(ph) }), o); }
  return C;
};
const relaxed = (X, its) => { const W = X.W, S = X.S; for (let it = 0; it < its; it++) { X.forcesNoEvents(); let fm = 0; for (const p of W.parts) fm = Math.max(fm, Math.hypot(S.fx[p.i], S.fy[p.i], W.d3 ? S.fz[p.i] : 0)); if (fm < 1e-4) break; const st = Math.min(0.004, 0.01 / fm); for (const p of W.parts) { p.x += S.fx[p.i] * st; p.y += S.fy[p.i] * st; if (W.d3) p.z += S.fz[p.i] * st; } X.gridTouch(); } return -X.totalEnergy().pe; };
const slopeErr = (X, h = 1e-5) => { // the largest |F + ∂E/∂x| over the members, x, y (and z in 3-D)
  const W = X.W, S = X.S; let worst = 0;
  for (const p of W.parts) for (const ax of W.d3 ? ['x', 'y', 'z'] : ['x', 'y']) {
    X.forcesNoEvents(); const f = { x: S.fx, y: S.fy, z: S.fz }[ax][p.i], v0 = p[ax];
    p[ax] = v0 + h; X.gridTouch(); const ep = X.totalEnergy().pe; p[ax] = v0 - h; X.gridTouch(); const em = X.totalEnergy().pe; p[ax] = v0; X.gridTouch();
    worst = Math.max(worst, Math.abs(f + (ep - em) / (2 * h)));
  }
  return worst;
};
PARTS.bo6 = async (page, check, say) => {
  const SET = [['Ge', 'H', 4, 1], ['As', 'H', 3, 1], ['Se', 'H', 2, 1], ['Sn', 'Cl', 4, 1], ['Sb', 'Cl', 3, 1], ['Te', 'H', 2, 1]];
  const one = (X) => { X.PRESETS.empty.build(); X.setBox(60, 40); };
  // they take part
  const X0 = load('all', { seed: 1 }); one(X0); SET.forEach(([c, l, n, o], k) => mol(X0, c, l, n, o, -20 + 8 * k, 0)); X0.forcesNoEvents(); X0.boSet(1);
  const mem = X0.W.parts.filter(p => p.bom).length, all = X0.W.parts.length;
  // statics against the stored bonds (eV a bond)
  const stat = {};
  for (const [c, l, n, o] of [['Ge', 'H', 4, 1], ['Sb', 'Cl', 3, 1], ['Te', 'H', 2, 1]]) {
    const e = [0, 1].map(bo => { const X = load('all', { seed: 1 }); one(X); mol(X, c, l, n, o, 0, 0); X.forcesNoEvents(); if (bo) X.boSet(1); return relaxed(X, 3000) / n; });
    stat[c + l + n] = +(e[1] - e[0]).toFixed(3);
  }
  // tin metal stays out, SnCl₄ joins
  const XT = load('all', { seed: 2 }); one(XT); for (let i = 0; i < 9; i++) XT.addAtom('Sn', -12 + (i % 3) * 3.1, -3 + Math.floor(i / 3) * 3.1, { T: 300 }); mol(XT, 'Sn', 'Cl', 4, 1, 10, 0); XT.forcesNoEvents(); XT.boSet(1);
  const tin = { metal: XT.W.parts.slice(0, 9).filter(p => p.bom).length, metalBonding: XT.W.parts.slice(0, 9).filter(p => p.isMetal).length, mol: XT.W.parts.slice(9).filter(p => p.bom).length, molMetal: XT.W.parts[9].isMetal };
  // SbCl₃: one Cl swept round from 140° to 160° from another: the energy has no step (JavaScript and WebAssembly passes)
  const sweep = (useWasm) => {
    const X = load('all', { seed: 1 }); one(X); mol(X, 'Sb', 'Cl', 3, 1, 0, 0); X.forcesNoEvents(); X.BF.useWasm = useWasm; X.boSet(1);
    const [sb, c0, c1, c2] = X.W.parts; let last = null, worst = 0;
    c0.x = sb.x + 2.33; c0.y = sb.y; c2.x = sb.x + 2.33 * Math.cos(4.4); c2.y = sb.y + 2.33 * Math.sin(4.4);
    for (let d = 140; d <= 160; d += 0.25) { c1.x = sb.x + 2.33 * Math.cos(d * Math.PI / 180); c1.y = sb.y + 2.33 * Math.sin(d * Math.PI / 180); X.gridTouch(); X.forcesNoEvents(); const e = X.BO.E; if (last !== null) worst = Math.max(worst, Math.abs(e - last)); last = e; }
    c1.y += 0.01; X.gridTouch();
    return { step: +worst.toFixed(4), slope: +slopeErr(X).toExponential(1), wasm: useWasm && X.bfWasmOK() };
  };
  const js = sweep(false), wa = sweep(true);
  say('  bond orders Ge–Te: ' + JSON.stringify({ mem, all, stat, tin, js, wa }));
  const okStat = Object.values(stat).every(v => Math.abs(v) < 0.05);
  check(mem === all && okStat && tin.metal === 0 && tin.metalBonding === 9 && tin.mol === 5 && !tin.molMetal && js.step < 0.01 && wa.step < 0.01 && js.slope < 1e-5 && wa.slope < 1e-5,
    `1.25: continuous bond orders for Ge, As, Se, Sn, Sb, Te: GeH₄, AsH₃, H₂Se, SnCl₄, SbCl₃, H₂Te all take part (${mem} of ${all} atoms); relaxed, their energies match the stored bonds' (${Object.entries(stat).map(([k, v]) => k + ' ' + v).join(', ')} eV a bond); tin metal keeps its metal bonding (9 atoms out), SnCl₄ joins; SbCl₃ bent from 140° to 160° has no step (largest change between 0.25° steps ${js.step} / ${wa.step} eV, JavaScript / WebAssembly; the old 4.4 Å end of the 1-3 exclusion gave 0.08); forces the energy's slope to ${js.slope} / ${wa.slope} eV/Å`,
    '1.25 bond orders Ge–Te: ' + JSON.stringify({ mem, all, stat, tin, js, wa }));
};

/* ---- 4. continuous bond orders in 3-D: the members join in a 3-D world, their forces are the energy's slope in x, y and
   z, the stored bonds' 3-D shapes come out (water's angle, PCl₅'s bipyramid), ethylene resists twisting as with stored
   bonds, an insulated box keeps its energy; in the page the choice is open in 3-D and the orders are drawn */
PARTS.bo3d = async (page, check, say) => {
  const world = (X) => { X.PRESETS.empty.build(); X.setBox(30, 30); X.world3d(30); };
  // slopes: benzene, H₃O⁺ and SbCl₃ in space, jiggled
  const XS = load('all', { seed: 4 }); world(XS); XS.addMolecule('benzene', -6, 0, 0.7, 0, 1); XS.addMolecule('H3Op', 5, 3, 0.2, 0, -2); mol(XS, 'Sb', 'Cl', 3, 1, 5, -5, 2);
  XS.forcesNoEvents(); XS.boSet(1);
  { let s = 7; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; }; for (const p of XS.W.parts) { p.x += 0.08 * r(); p.y += 0.08 * r(); p.z += 0.08 * r(); } XS.gridTouch(); }
  const slope = { members: XS.W.parts.filter(p => p.bom).length, all: XS.W.parts.length, err: +slopeErr(XS, 2e-6).toExponential(1), fz: XS.W.parts.some(p => Math.abs(XS.S.fz[p.i]) > 0.01) };
  // shapes: water and PCl₅ relaxed with bond orders
  const shape = (key) => { const X = load('all', { seed: 4 }); world(X); X.addMolecule(key, 0, 0, 0.3, 0, 0); X.forcesNoEvents(); X.boSet(1); relaxed(X, 4000);
    const P = X.W.parts, c = P.find(p => p.Z !== 1 && p.Z !== 17) || P[0], nb = P.filter(p => p !== c), a = [];
    for (let i = 0; i < nb.length; i++) for (let j = i + 1; j < nb.length; j++) { const u = [nb[i].x - c.x, nb[i].y - c.y, nb[i].z - c.z], v = [nb[j].x - c.x, nb[j].y - c.y, nb[j].z - c.z]; a.push(+(Math.acos((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / Math.hypot(...u) / Math.hypot(...v)) * 180 / Math.PI).toFixed(1)); }
    return a.sort((x, y) => x - y); };
  const water = shape('H2O'), pcl5 = shape('PCl5');
  // ethylene turned 90° about its C=C: the energy it costs, stored bonds and bond orders
  const twist = (bo) => {
    const X = load('all', { seed: 4 }), W = X.W; world(X); X.addMolecule('C2H4', 0, 0, 0, 0, 0); X.forcesNoEvents(); if (bo) X.boSet(1);
    const C = W.parts.filter(p => p.Z === 6), c0 = C[0], c1 = C[1], e0 = X.totalEnergy().pe, ax = [c1.x - c0.x, c1.y - c0.y, c1.z - c0.z], L = Math.hypot(...ax); ax.forEach((v, i) => { ax[i] = v / L; });
    for (const h of W.parts.filter(p => p.Z === 1 && Math.hypot(p.x - c1.x, p.y - c1.y, p.z - c1.z) < 1.3)) { const v = [h.x - c1.x, h.y - c1.y, h.z - c1.z], d = v[0] * ax[0] + v[1] * ax[1] + v[2] * ax[2], cr = [ax[1] * v[2] - ax[2] * v[1], ax[2] * v[0] - ax[0] * v[2], ax[0] * v[1] - ax[1] * v[0]]; h.x = c1.x + cr[0] + ax[0] * d; h.y = c1.y + cr[1] + ax[1] * d; h.z = c1.z + cr[2] + ax[2] * d; }
    X.gridTouch(); return +(X.totalEnergy().pe - e0).toFixed(3);
  };
  const tw = [twist(0), twist(1)];
  // books: the molecules in space, insulated, 600 steps
  const XB = load('all', { seed: 7 }), W = XB.W; XB.PRESETS.mol3d.build(); XB.forcesNoEvents(); XB.boSet(1);
  const go = (n) => { for (let i = 0; i < n; i++) { if (W.fSpawn !== W.spawned) { XB.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = XB.chooseDt(); XB.step(W.dt); } };
  go(100); W.gamma = 0; const e0 = XB.totalEnergy().total + W.ledger.bath; go(600);
  const books = { members: W.parts.filter(p => p.bom && !p.dead).length, all: W.parts.filter(p => !p.dead).length, d: +(XB.totalEnergy().total + W.ledger.bath - e0).toFixed(4) };
  // the page: the choice open in 3-D, the orders drawn
  const ui = await page.evaluate(async () => {
    loadPreset('mol3d'); const open = ![...$('segBo').querySelectorAll('button')].some(b => b.disabled);
    SET.bo = 1; boSet(1); setRunning(true); await new Promise(r => setTimeout(r, 1200)); setRunning(false);
    const r = { open, members: W.parts.filter(p => p.bom).length, drawn: boDrawBonds().length, stored: W.bonds.length };
    SET.bo = 0; boSet(0); return r;
  });
  say('  bond orders in 3-D: ' + JSON.stringify({ slope, water, pcl5, tw, books, ui }));
  const near = (a, v, d) => Math.abs(a - v) <= d;
  check(slope.members === slope.all && slope.err < 1e-5 && slope.fz && near(water[0], 104.5, 1.5) && pcl5.filter(a => near(a, 90, 1.5)).length === 6 && pcl5.filter(a => near(a, 120, 1.5)).length === 3 && near(pcl5[9], 180, 1.5) && tw[1] > 2.3 && Math.abs(tw[1] - tw[0]) < 0.1 * tw[0] && books.members === books.all && Math.abs(books.d) < 0.02 && ui.open && ui.members > 50 && ui.drawn > 30 && ui.stored === 0,
    `1.25: continuous bond orders in 3-D: benzene, H₃O⁺ and SbCl₃ in space join (${slope.members} atoms) and their forces are the energy's slope in x, y and z to ${slope.err} eV/Å; relaxed, water bends to ${water[0]}° and PCl₅ is a trigonal bipyramid (${pcl5.join('/')}°); ethylene turned 90° costs ${tw[1]} eV (stored bonds ${tw[0]}); the molecules in space, insulated, 600 steps: books ${books.d} eV; in the page the choice is open in 3-D and ${ui.drawn} orders are drawn`,
    '1.25 bond orders in 3-D: ' + JSON.stringify({ slope, water, pcl5, tw, books, ui }));
};

/* ---- 5. single bonds' twist in 3-D (stored bonds and bond orders): ethane's, methanol's and butane's barriers near the
   measured ones (relaxed, the dihedral's four atoms held), hydrogen peroxide twisted, forces the energy's slope,
   polyethylene still whole at room temperature */
PARTS.tors1 = async (page, check, say) => {
  const scan = (key, pat, bo, degs) => { // energies (eV) at the given dihedrals, relative to the lowest
    const X = load('all', { seed: 4 }), W = X.W, S = X.S; X.PRESETS.empty.build(); X.setBox(30, 30); X.world3d(30); X.addMolecule(key, 0, 0, 0.3, 0, 0); X.forcesNoEvents(); if (bo) X.boSet(1);
    const P = W.parts.filter(p => !p.dead), sym = pat.split('-'), nb = (p) => P.filter(q => q !== p && Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) < 1.25 * (p.el.rc + q.el.rc));
    let quad = null;
    for (const A of P) if (!quad && A.el.sym === sym[1]) for (const B of nb(A)) if (!quad && B.el.sym === sym[2]) for (const x of nb(A)) if (!quad && x !== B && x.el.sym === sym[0]) for (const y of nb(B)) if (!quad && y !== A && y !== x && y.el.sym === sym[3]) quad = [x, A, B, y];
    const [Xa, A, B, Y] = quad, side = new Set([B]); { const st = [B]; while (st.length) { const u = st.pop(); for (const v of nb(u)) if (v !== A && !side.has(v)) { side.add(v); st.push(v); } } }
    const fixed = new Set();
    const relax = (its) => { for (let it = 0; it < its; it++) { X.forcesNoEvents(); let fm = 0; for (const p of P) if (!fixed.has(p)) fm = Math.max(fm, Math.hypot(S.fx[p.i], S.fy[p.i], S.fz[p.i])); if (fm < 3e-4) break; const st = Math.min(0.002, 0.01 / fm); for (const p of P) if (!fixed.has(p)) { p.x += S.fx[p.i] * st; p.y += S.fy[p.i] * st; p.z += S.fz[p.i] * st; } X.gridTouch(); } };
    const dih = () => { const b1 = [A.x - Xa.x, A.y - Xa.y, A.z - Xa.z], b2 = [B.x - A.x, B.y - A.y, B.z - A.z], b3 = [Y.x - B.x, Y.y - B.y, Y.z - B.z], cr = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2], n1 = cr(b1, b2), n2 = cr(b2, b3), m = cr(n1, b2); return Math.atan2(dot(m, n2) / Math.hypot(...b2), dot(n1, n2)) * 180 / Math.PI; };
    const turn = (deg) => { const ax = [B.x - A.x, B.y - A.y, B.z - A.z], L = Math.hypot(...ax); ax.forEach((v, i) => { ax[i] = v / L; }); const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
      for (const p of side) { if (p === B) continue; const v = [p.x - B.x, p.y - B.y, p.z - B.z], d = v[0] * ax[0] + v[1] * ax[1] + v[2] * ax[2], cr = [ax[1] * v[2] - ax[2] * v[1], ax[2] * v[0] - ax[0] * v[2], ax[0] * v[1] - ax[1] * v[0]]; p.x = B.x + v[0] * c + cr[0] * s + ax[0] * d * (1 - c); p.y = B.y + v[1] * c + cr[1] * s + ax[1] * d * (1 - c); p.z = B.z + v[2] * c + cr[2] * s + ax[2] * d * (1 - c); } X.gridTouch(); };
    relax(6000); quad.forEach(p => fixed.add(p));
    const out = degs.map(d => { const cur = dih(); let delta = cur - d; turn(delta); if (Math.abs(dih() - d) > 1 && Math.abs(Math.abs(dih() - d) - 360) > 1) turn(-2 * delta); relax(3000); return X.totalEnergy().pe; });
    const lo = Math.min(...out); return out.map(e => +(e - lo).toFixed(3));
  };
  const r = {};
  for (const bo of [0, 1]) {
    const t = bo ? 'orders' : 'stored';
    r[t] = { ethane: scan('C2H6', 'H-C-C-H', bo, [60, 0])[1], methanol: scan('CH3OH', 'H-C-O-H', bo, [60, 0])[1], butane: scan('butane', 'C-C-C-C', bo, [180, 65, 120, 0]), h2o2: scan('H2O2', 'H-O-O-H', bo, [180, 112, 0]) };
  }
  // slopes, stored and bond orders: butane + ethanol + H₂O₂ + acetaldehyde in space, jiggled
  const sl = [0, 1].map(bo => { const X = load('all', { seed: 4 }); X.PRESETS.empty.build(); X.setBox(30, 30); X.world3d(30); X.addMolecule('butane', -6, 0, 0.7, 0, 1); X.addMolecule('ethanol', 5, 3, 0.2, 0, -2); X.addMolecule('H2O2', 5, -5, 1.1, 0, 3); X.addMolecule('acetaldehyde', -5, -6, 2, 0, -3); X.forcesNoEvents(); if (bo) X.boSet(1);
    let s = 7; const rr = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; }; for (const p of X.W.parts) { p.x += 0.1 * rr(); p.y += 0.1 * rr(); p.z += 0.1 * rr(); } X.gridTouch(); return +slopeErr(X, 2e-6).toExponential(1); });
  // polyethylene (3-D) at 300 K, 600 steps: every bond kept
  const XP = load('all', { seed: 3 }), W = XP.W; XP.baseWorld(40, 40, 300, 0.05); XP.world3d(40); XP.addMolecule('polyethylene3', 0, 0, 0, 300, 0); XP.forcesNoEvents(); W.fSpawn = W.spawned;
  const nb0 = W.bonds.length; for (let i = 0; i < 600; i++) { if (W.fSpawn !== W.spawned) { XP.forcesNoEvents(); W.fSpawn = W.spawned; } W.dt = XP.chooseDt(); XP.step(W.dt); }
  const pe = { bonds: [nb0, W.bonds.length], dihedrals: XP.AC3.ns };
  say('  single bonds\' twist in 3-D: ' + JSON.stringify({ r, sl, pe }));
  const near = (a, v, d) => Math.abs(a - v) <= d, ok = (q) => near(q.ethane, 0.126, 0.015) && near(q.methanol, 0.046, 0.008) && near(q.butane[1] - q.butane[0], 0.029, 0.012) && near(q.butane[2] - q.butane[0], 0.147, 0.02) && near(q.butane[3] - q.butane[0], 0.22, 0.03) && q.h2o2[1] < q.h2o2[0] && near(q.h2o2[0] - q.h2o2[1], 0.048, 0.01) && near(q.h2o2[2] - q.h2o2[1], 0.305, 0.03);
  check(ok(r.stored) && ok(r.orders) && sl[0] < 1e-6 && sl[1] < 1e-5 && pe.bonds[0] === pe.bonds[1] && pe.dihedrals > 600,
    `1.25: single bonds' twist in 3-D (measured: ethane 0.126 eV, methanol 0.046, butane gauche 0.029, anti→gauche 0.147, syn ~0.22, H₂O₂ trans 0.048 and cis 0.305 above its 112° minimum): stored bonds ethane ${r.stored.ethane}, methanol ${r.stored.methanol}, butane ${r.stored.butane.slice(1).map(v => +(v - r.stored.butane[0]).toFixed(3)).join(' / ')}, H₂O₂ ${+(r.stored.h2o2[0] - r.stored.h2o2[1]).toFixed(3)} / ${+(r.stored.h2o2[2] - r.stored.h2o2[1]).toFixed(3)}; bond orders ${r.orders.ethane}, ${r.orders.methanol}, ${r.orders.butane.slice(1).map(v => +(v - r.orders.butane[0]).toFixed(3)).join(' / ')}, ${+(r.orders.h2o2[0] - r.orders.h2o2[1]).toFixed(3)} / ${+(r.orders.h2o2[2] - r.orders.h2o2[1]).toFixed(3)}; forces the slope to ${sl[0]} / ${sl[1]} eV/Å; polyethylene keeps its ${pe.bonds[1]} bonds at 300 K`,
    '1.25 single bonds\' twist: ' + JSON.stringify({ r, sl, pe }));
};

module.exports = async function f125(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.25 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  const { openPage } = require('./browser');
  const { browser, page, errors } = await openPage({ settle: 800 });
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(page, check, say, openPage, process.argv.slice(2));
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  await browser.close();
  console.log(fails ? `${fails} failure(s)` : '1.25 checks passed');
  process.exitCode = fails ? 1 : 0;
})();
