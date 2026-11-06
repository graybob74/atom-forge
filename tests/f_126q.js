'use strict';
/* The 1.26 checks for GFN2-xTB in quantum bonds (Settings → Experimental → Bond orders → Quantum, Quantum method:
   GFN1-xTB normal, GFN2-xTB a choice; tools/xtb/gfn2.js, d4.js), run by t_features (its "1.26 (GFN2)" block) or alone:
   node tests/f_126q.js [part …] (parts: port, gfn1, game, chem, page). Each part fails on 1.25 (no GFN2). The physics
   parts run in the Node harness (deterministic); page in the t_features page. (check(ok, good, bad); say(...)) */
const path = require('path');
const { load } = require('./load');
const PARTS = {};

/* ---- 1. the port against tblite's own GFN2-xTB numbers (tools/xtb-ref/ref2.json, made on the runner: 91 geometries, 3-D,
   ions, radicals, S/P/Si/Cl/Br with d shells), and its forces against the energy's slope in x, y and z */
PARTS.port = async (page, check) => {
  const X = load('all', { seed: 1 }), G = [...require('../tools/xtb-ref/geoms.json'), ...require('../tools/xtb-ref/geoms2.json')];
  const R = require('../tools/xtb-ref/ref2.json');
  let dE = 0, dg = 0, dq = 0, n = 0;
  for (const g of G) {
    const r = R.find(x => x.name === g.name); if (!r || r.error) continue;
    const o = X.XTB.gfn2Energy(g.Z, g.xyz, g.charge || 0, g.uhf || 0, { grad: true, accuracy: 0.01 }); n++;
    dE = Math.max(dE, Math.abs(o.E - r.E));
    for (let i = 0; i < g.Z.length; i++) { dq = Math.max(dq, Math.abs(o.q[i] - r.q[i])); for (let c = 0; c < 3; c++) dg = Math.max(dg, Math.abs(o.g[i][c] - r.grad[i][c])); }
  }
  const g = G.find(x => x.name === 'H3O+(H2O)~3'), E = (x) => X.XTB.gfn2Energy(g.Z, x, 1, 0, { accuracy: 1e-6 }).E;
  const o = X.XTB.gfn2Energy(g.Z, g.xyz, 1, 0, { accuracy: 1e-6, grad: true }); let fd = 0;
  for (let i = 0; i < g.Z.length; i++) for (let c = 0; c < 3; c++) { const at = (s) => { const x = g.xyz.map(p => p.slice()); x[i][c] += s; return E(x); }; fd = Math.max(fd, Math.abs((at(1e-4) - at(-1e-4)) / 2e-4 - o.g[i][c])); }
  const out = { n, dE: +dE.toExponential(1), dg: +dg.toExponential(1), dq: +dq.toExponential(1), fd: +fd.toExponential(1) };
  check(n === 91 && dE < 1e-8 && dg < 1e-8 && dq < 1e-8 && fd < 2e-6,
    `1.26 GFN2: the port matches tblite's GFN2-xTB on ${n} geometries (energies to ${out.dE} eV, forces ${out.dg} eV/Å, charges ${out.dq} e); the forces are the energy's slopes in x, y, z to ${out.fd} eV/Å`, '1.26 GFN2 port: ' + JSON.stringify(out));
};

/* ---- 2. GFN1 (the normal method) unchanged: quantum bonds on a hydronium and three waters, 150 steps, flat and 3-D, to
   the last bit of every position and velocity (1.25's) */
PARTS.gfn1 = async (page, check) => {
  const runs = {};
  for (const d3 of [false, true]) {
    const X = load('all', { seed: 3 }), W = X.W;
    if (d3) { X.PRESETS.empty.build(); X.setBox(20, 20); X.world3d(20); }
    X.addMolecule('H3Op', 0, 0, 0, 300); for (let k = 0; k < 3; k++) { const a = 2 * Math.PI * k / 3; X.addMolecule('H2O', 2.8 * Math.cos(a), 2.8 * Math.sin(a), a + Math.PI / 2 + 0.3 * k, 300); }
    for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
    X.settleOverlaps(); X.boSet(2); X.forcesNoEvents(); runs.method = X.XQ.method;
    for (let i = 0; i < 150; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
    const f = new Float64Array(1), u = new Uint32Array(f.buffer); let h = 2166136261 >>> 0;
    for (const p of W.parts) { if (p.dead) continue; for (const v of [p.x, p.y, p.z || 0, p.vx, p.vy, p.vz || 0]) { f[0] = v; h = Math.imul(h ^ u[0], 16777619) >>> 0; h = Math.imul(h ^ u[1], 16777619) >>> 0; } }
    runs[d3 ? 'd3' : 'flat'] = h.toString(16);
  }
  check(runs.method === 1 && runs.flat === '301f4d45' && runs.d3 === 'a17a18e6',
    `1.26 GFN2: quantum bonds with GFN1-xTB (the normal method) give 1.25's runs bit for bit (flat ${runs.flat}, 3-D ${runs.d3})`, '1.26 GFN2 gfn1: ' + JSON.stringify(runs));
};

/* ---- 3. GFN2 in the game: forces the energy's slopes (flat, an ion outside; 3-D in x, y, z), the books in insulated runs,
   no unsettled calculations, and switching the method with quantum bonds on paid to the bath exactly */
PARTS.game = async (page, check) => {
  const out = {};
  { const X = load('all', { seed: 5 }), W = X.W;
    X.addMolecule('H3Op', 0, 0, 0, 0); X.addMolecule('H2O', 2.6, 0.3, 2.8, 0); X.addMolecule('H2O', -1.5, 2.5, 1, 0); X.addMolecule('NH3', 3, 3, 0.4, 0); X.addAtom('Na', -3, -2, { charge: 1, T: 0 });
    for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
    X.boQmMethod(2); X.boSet(2); X.forcesNoEvents(); W.T = 300; for (let i = 0; i < 30; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
    const all = W.parts.filter(p => !p.dead && p.k === X.NUC); out.members = W.parts.filter(p => p.bom && !p.dead).length;
    X.forcesNoEvents(); const F = all.map(p => [X.S.fx[p.i], X.S.fy[p.i]]); let worst = 0; const E = () => X.totalEnergy().pe;
    all.forEach((p, u) => { for (const c of [0, 1]) { const A = c ? 'y' : 'x', x0 = p[A]; p[A] = x0 + 1e-4; X.gridTouch(); const e1 = E(); p[A] = x0 - 1e-4; X.gridTouch(); const e2 = E(); p[A] = x0; X.gridTouch(); worst = Math.max(worst, Math.abs(-(e1 - e2) / 2e-4 - F[u][c])); } });
    out.dF2 = +worst.toExponential(1);
    // switching back and forth with members in: each change's energy to the bath, the books closed
    W.gamma = 0; const tot = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc, E0 = tot(), b0 = W.ledger.bath;
    X.boQmMethod(1); const m1 = X.XQ.method, n1 = W.parts.filter(p => p.bom && !p.dead).length; X.boQmMethod(2); X.forcesNoEvents();
    out.swap = [m1, n1, X.XQ.method, +Math.abs(tot() - E0).toExponential(0), +(W.ledger.bath - b0).toFixed(1)]; }
  { const X = load('all', { seed: 3 }), W = X.W; X.PRESETS.empty.build(); X.setBox(24, 24); X.world3d(24); W.gamma = 0.05;
    ['H2O', 'H2O', 'H2O', 'NH3', 'CH4'].forEach((m, k) => X.addMolecule(m, -6 + (k % 3) * 6, -3 + (k / 3 | 0) * 6, k, 300, k % 2 ? 2 : -2));
    X.forcesNoEvents(); X.boQmMethod(2); X.boSet(2); for (let i = 0; i < 30; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
    const all = W.parts.filter(p => !p.dead && p.k === X.NUC); out.members3 = W.parts.filter(p => p.bom && !p.dead).length;
    X.forcesNoEvents(); const F = all.map(p => [X.S.fx[p.i], X.S.fy[p.i], X.S.fz[p.i]]); const worst = [0, 0, 0]; const E = () => X.totalEnergy().pe;
    all.forEach((p, u) => { for (const c of [0, 1, 2]) { const A = 'xyz'[c], x0 = p[A]; p[A] = x0 + 1e-4; X.gridTouch(); const e1 = E(); p[A] = x0 - 1e-4; X.gridTouch(); const e2 = E(); p[A] = x0; X.gridTouch(); worst[c] = Math.max(worst[c], Math.abs(-(e1 - e2) / 2e-4 - F[u][c])); } });
    out.dF3 = worst.map(v => +v.toExponential(1));
    W.gamma = 0; const tot = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc, E0 = tot(), f0 = X.XQ.fails;
    for (let i = 0; i < 150; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
    out.drift3 = +(tot() - E0).toFixed(5); out.fails3 = X.XQ.fails - f0; }
  { const X = load('all', { seed: 3 }), W = X.W;
    X.addMolecule('H3Op', 0, 0, 0, 300); for (let k = 0; k < 5; k++) { const a = 2 * Math.PI * k / 5; X.addMolecule('H2O', 2.8 * Math.cos(a), 2.8 * Math.sin(a), a + Math.PI / 2 + 0.3 * k, 300); }
    for (const p of W.parts) if (p.k !== X.NUC) X.kill(p);
    X.settleOverlaps(); X.boQmMethod(2); X.boSet(2); X.forcesNoEvents(); W.T = 300;
    for (let i = 0; i < 50; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
    W.gamma = 0; const tot = () => X.totalEnergy().total + W.ledger.bath - W.ledger.nuc, E0 = tot(), f0 = X.XQ.fails, c0 = X.XQ.calls, i0 = X.XQ.it;
    for (let i = 0; i < 200; i++) { W.dt = X.chooseDt(); X.step(W.dt); }
    out.n2 = W.parts.filter(p => p.bom && !p.dead).length; out.drift2 = +(tot() - E0).toFixed(5); out.fails2 = X.XQ.fails - f0; out.it = +((X.XQ.it - i0) / (X.XQ.calls - c0)).toFixed(1); }
  check(out.members === 14 && out.dF2 < 1e-5 && out.swap[0] === 1 && out.swap[1] === 14 && out.swap[2] === 2 && out.swap[3] < 1e-6 && out.members3 === 18 && Math.max(...out.dF3) < 1e-5 && Math.abs(out.drift3) < 0.005 && !out.fails3 && out.n2 === 19 && Math.abs(out.drift2) < 0.005 && !out.fails2 && out.it < 8,
    `1.26 GFN2: in the game the forces are the energy's slopes (flat, a Na⁺ outside: ${out.dF2} eV/Å; 3-D x/y/z ${out.dF3.join('/')}), insulated runs keep their energy (19 atoms flat ${out.drift2} eV over 200 steps, ${out.it} iterations a step; 18 in 3-D ${out.drift3} eV over 150), none unsettled; switching method with 14 members in is paid to the bath (${out.swap[4]} eV) and the books close to ${out.swap[3]} eV`,
    '1.26 GFN2 game: ' + JSON.stringify(out));
};

/* ---- 4. what was measured against the references (1.26): single points that record the two methods' differences:
   GFN2 binds H₃ (H + H₂, measured barrier 0.42 eV; GFN1 0.15) and puts hexazine below three N₂ (GFN1 above, with its
   0.54 eV barrier); a proton between two waters 2.7 Å apart (g-xTB 0.10 eV) GFN1 0.08, GFN2 0.04; water's dimer both */
PARTS.chem = async (page, check) => {
  const X = load('all', { seed: 1 }), XTB = X.XTB;
  const e1 = (Z, x, c = 0, u = 0) => XTB.gfn1Energy(Z, x, c, u, { accuracy: 0.01 }).E + XTB.d3Disp(Z, x, {}).E, e2 = (Z, x, c = 0, u = 0) => XTB.gfn2Energy(Z, x, c, u, { accuracy: 0.01 }).E;
  const h3 = (f, d) => f([1, 1, 1], [[-d, 0, 0], [0, 0, 0], [d, 0, 0]], 0, 1), hh = (f, r) => f([1, 1], [[0, 0, 0], [r, 0, 0]]) + f([1], [[0, 0, 0]], 0, 1);
  const out = { h3: [+(h3(e1, 0.98) - hh(e1, 0.7651)).toFixed(3), +(h3(e2, 1.051) - hh(e2, 0.7769)).toFixed(3)] };
  const ring = (s) => [0, 1, 2, 3, 4, 5].map(k => [s * Math.cos(k * Math.PI / 3), s * Math.sin(k * Math.PI / 3), 0]), Z6 = [7, 7, 7, 7, 7, 7];
  out.n6 = [+(e1(Z6, ring(1.296)) - 3 * e1([7, 7], [[0, 0, 0], [1.0985, 0, 0]])).toFixed(2), +(e2(Z6, ring(1.295)) - 3 * e2([7, 7], [[0, 0, 0], [1.0982, 0, 0]])).toFixed(2)];
  const Z = [8, 1, 1, 1, 8, 1, 1], geo = (R, x) => [[0, 0, 0], [-0.4, 0.88, 0], [-0.4, -0.88, 0], [x, 0, 0], [R, 0, 0], [R + 0.4, 0.88, 0], [R + 0.4, -0.88, 0]];
  out.pt = [e1, e2].map(f => +(f(Z, geo(2.7, 1.35), 1) - Math.min(...[1.04, 1.06, 1.08, 1.10, 1.12].map(x => f(Z, geo(2.7, x), 1)))).toFixed(3));
  check(out.h3[0] > 0.1 && out.h3[1] < -0.3 && out.n6[0] > 1.5 && out.n6[1] < -0.5 && out.pt[0] > 0.07 && out.pt[1] < 0.05,
    `1.26 GFN2 against GFN1 (the measurements behind GFN1 staying normal): H + H₂'s saddle GFN1 +${out.h3[0]} eV (measured 0.42), GFN2 ${out.h3[1]} (H₃ bound); flat hexazine to 3 N₂ releases GFN1 ${out.n6[0]} eV, GFN2 ${out.n6[1]}; a proton between waters 2.7 Å apart ${out.pt[0]} and ${out.pt[1]} eV (g-xTB 0.10)`,
    '1.26 GFN2 chem: ' + JSON.stringify(out));
};

/* ---- 5. the page: Experimental → Quantum method (GFN1 normal at start, GFN2 a choice with its cost and the realistic tag
   on GFN1), the choice reaching the engine in the flat game and in 3-D, the Speed test's line, the side pane, Help */
PARTS.page = async (page, check) => {
  const r = await page.evaluate(async () => {
    const out = { def: SET_DEF.xq, set: SET.xq, m0: XQ.method, row: !!$('segXq'), btns: $('segXq') ? $('segXq').querySelectorAll('button').length : 0, exp: SET_EXP.includes('xq') };
    loadPreset('empty'); setRunning(false); addMolecule('H3Op', 0, 0, 0, 0); addMolecule('H2O', 2.6, 0.3, 2.8, 0);
    setSetting('bo', 2); syncCosts(); const b2 = () => $('segXq').querySelector('button[data-v="2"]'), b1 = $('segXq').querySelector('button[data-v="1"]');
    out.cost = (b2().querySelector('.oc') || {}).textContent; out.real = (b1.querySelector('.rl') || {}).textContent;
    setSetting('xq', 2); out.m2 = XQ.method; for (let f = 0; f < 5; f++) { W.dt = chooseDt(); step(W.dt); } out.n = W.parts.filter(p => p.bom && !p.dead).length; out.E = BO.E;
    out.sum = expSummary();
    openSettings('exp'); setPrevShow('segXq', null); out.pane = $('setPrevD').textContent; hideModal('setModal');
    out.help = /GFN2-xTB since 1\.26/.test(document.body.innerHTML);
    loadPreset('d3empty'); setRunning(false); out.d3 = W.d3; addMolecule('H3Op', 0, 0, 0, 0); addMolecule('H2O', 2.6, 0.3, 2.8, 0); for (let f = 0; f < 3; f++) { W.dt = chooseDt(); step(W.dt); } out.n3 = W.parts.filter(p => p.bom && !p.dead).length; out.m3 = XQ.method;
    setSetting('xq', 1); setSetting('bo', 0); out.back = [XQ.method, BO.on]; loadPreset('empty');
    return out;
  });
  check(r.def === 1 && r.set === 1 && r.m0 === 1 && r.row && r.btns === 2 && r.exp && /×0\.8/.test(r.cost) && /realistic/.test(r.real) && r.m2 === 2 && r.n === 7 && r.E < 0 && /GFN2-xTB/.test(r.sum) && /dipoles and quadrupoles/.test(r.pane) && r.help && r.d3 && r.n3 === 7 && r.m3 === 2 && r.back[0] === 1 && !r.back[1],
    `1.26 GFN2: Settings → Experimental → Quantum method (GFN1-xTB at start, realistic; GFN2-xTB tagged ${r.cost}); chosen, the hydronium and water run on GFN2 (${r.n} members), in 3-D too (${r.n3}); the Speed test's line and the side pane say so; Help mentions it`, '1.26 GFN2 page: ' + JSON.stringify(r));
};

module.exports = async function f126q(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    if (k === 'page' && !page) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.26 GFN2 ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  const only = process.argv.slice(2);
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  let browser = null, page = null, errors = [];
  if (!only.length || only.includes('page')) { const { openPage } = require('./browser'); ({ browser, page, errors } = await openPage({ settle: 800 })); }
  await module.exports(page, check, say, null, only);
  if (errors.length) { fails++; say('FAIL page errors:', errors.join(' | ').slice(0, 800)); }
  if (browser) await browser.close();
  console.log(fails ? `${fails} failure(s)` : '1.26 GFN2 checks passed');
  process.exitCode = fails ? 1 : 0;
})();
void path;
