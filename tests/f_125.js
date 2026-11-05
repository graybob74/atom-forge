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
