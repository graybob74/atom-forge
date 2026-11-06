'use strict';
// Atom Forge xTB (1.26): re-fit GFN1's or GFN2's parameters for H, C, N, O (levels, CN shifts, distance polynomials,
// hardness, third order, repulsion, the H0 pair scaling of each element pair, the spin constants' scale) to GMTKN55
// (W4-11 atomization, BH76 barriers, WATER27 clusters; H/C/N/O species only), g-xTB points (hexazine's D3h path and its
// release to 3 N2, a proton between waters) and the forces at W4-11's reference geometries (for bond lengths), by
// Levenberg-Marquardt with a forward-difference Jacobian. Held-out reactions (by molecule / by transition state / by
// cluster) never enter the fit; their errors are reported apart.
// node fit.js <base 1|2> <out.json> [--spin] [--iters 12] [--from par.json] [--eval]
const fs = require('fs'), path = require('path');
const X = require('./xm.js');
const args = process.argv.slice(2), base = +args[0], OUT = args[1], spin = args.includes('--spin');
const flag = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const ITERS = +flag('--iters', 12), EVAL = args.includes('--eval'), STEP = +flag('--step', 1), FDH = +flag('--fdh', 1e-3);
const D = JSON.parse(fs.readFileSync(path.join(__dirname, 'fitdata.json'), 'utf8')), GX = JSON.parse(fs.readFileSync(path.join(__dirname, 'gxref.json'), 'utf8'));
const ELS = [1, 6, 7, 8], PAIRS = ['1-1', '1-6', '1-7', '1-8', '6-6', '6-7', '6-8', '7-7', '7-8', '8-8'];
const nShOf = z => (base === 1 ? X.G1 : X.G2).nShell(z);

// ---- the parameter vector: [name, element or pair, index, scale]
const P = [];
for (const z of ELS) {
  for (let k = 0; k < nShOf(z); k++) P.push(['dlev', z, k, 1.0]);
  for (let k = 0; k < nShOf(z); k++) P.push(['kcn', z, k, 0.3]);
  for (let k = 0; k < nShOf(z); k++) P.push(['shp', z, k, 2.0]);
  for (const n of ['hub', 'g3', 'ra', 'rz']) P.push([n, z, 0, n === 'g3' ? 0.5 : 0.1]);
}
for (const pr of PAIRS) P.push(['pair', pr, 0, 0.05]);
if (spin) P.push(['wspin', 0, 0, 0.3]);
let parId = 1000 + base * 100000;
function toPar(x) {
  const par = { id: ++parId, el: {}, pair: {} };
  let ws = 1;
  P.forEach(([n, z, k, sc], i) => {
    const v = x[i] * sc;
    if (n === 'pair') par.pair[z] = v;
    else if (n === 'wspin') ws = 1 + v;
    else { const e = par.el[z] = par.el[z] || {}; if (['dlev', 'kcn', 'shp'].includes(n)) { (e[n] = e[n] || [])[k] = v; } else e[n] = v; }
  });
  return { par, ws };
}
// ---- the targets
const isHeld = (set, key, i) => set === 'W4-11' ? i % 4 === 3 : set === 'BH76' ? key % 3 === 2 : set === 'WATER27' ? (i % 3 === 2 || /H2O20/.test(D.rx[i].name)) : false;
const tsOf = r => r.sp[r.sp.length - 1][0];
// (the owner's must-haves always in the fit: N2, O2, ozone, water, HCN and HNC and their saddle, H + H2, the water dimer)
const MUST_W4 = ['n2', 'o2', 'o3', 'h2o', 'hcn', 'hnc', 'h2', 'oh'], MUST_BH = ['hcnts', 'RKT06'];
const GEO_SIG = +flag('--geosig', 0.15), LAMREG = +flag('--reg', 0.3), WSIG = +flag('--wsig', 0.05);
const tsList = [...new Set(D.rx.filter(r => r.set === 'BH76').map(tsOf))];
const T = []; let iw = 0, iwa = 0;
for (const r of D.rx) {
  const idx = r.set === 'W4-11' ? iw++ : r.set === 'WATER27' ? iwa++ : 0;
  const must = r.set === 'W4-11' ? MUST_W4.includes(r.sp[0][0].split('/')[1]) : r.set === 'BH76' ? MUST_BH.includes(tsOf(r).split('/')[1]) : r.name === 'H2O2 H2O';
  const held = !must && (r.set === 'BH76' ? tsList.indexOf(tsOf(r)) % 3 === 2 : r.set === 'W4-11' ? idx % 4 === 3 : (idx % 3 === 2 || /H2O20/.test(r.name)));
  T.push({ kind: 'rx', set: r.set, name: r.name, sp: r.sp, ref: r.ref, sigma: r.set === 'W4-11' ? 0.15 : r.set === 'BH76' ? 0.05 : Math.max(0.02, WSIG * Math.abs(r.ref)), held });
}
// the must-haves as reactions of their own (W4-11's references): HCN -> HNC, O3 -> O2 + O
{ const k = n => 'W4-11/' + n; T.push({ kind: 'rx', set: 'must', name: 'HCN -> HNC', sp: [[k('hcn'), -1], [k('hnc'), 1]], ref: (313.418 - 298.203) / 23.060547830619, sigma: 0.05, held: false });
  T.push({ kind: 'rx', set: 'must', name: 'O3 -> O2 + O', sp: [[k('o3'), -1], [k('o2'), 1], [k('o'), 1]], ref: (147.428 - 120.824) / 23.060547830619, sigma: 0.05, held: false }); }
// g-xTB: hexazine's path relative to its ring, the release; the proton profiles relative to the best point
const SPX = {}; // extra species
const addSp = (key, s) => { SPX[key] = s; return key; };
const n6k = GX.n6.map((p, i) => addSp('gx/n6_' + i, { Z: p.Z, xyz: p.xyz, charge: 0, uhf: 0 })), n2k = addSp('gx/n2', { Z: GX.n2.Z, xyz: GX.n2.xyz, charge: 0, uhf: 0 });
GX.n6.forEach((p, i) => { if (i) T.push({ kind: 'rx', set: 'gx-n6', name: 'n6 path L=' + p.L, sp: [[n6k[0], -1], [n6k[i], 1]], ref: p.E - GX.n6[0].E, sigma: 0.15, held: false }); });
T.push({ kind: 'rx', set: 'gx-n6', name: 'n6 release', sp: [[n6k[0], 1], [n2k, -3]], ref: GX.n6[0].E - 3 * GX.n2.E, sigma: 0.3, held: false });
for (const R of [2.7, 2.8]) { const pts = GX.pt.filter(p => p.R === R), lo = pts.reduce((a, b) => a.E < b.E ? a : b); const lk = addSp('gx/pt' + R + '_' + lo.x, { Z: lo.Z, xyz: lo.xyz, charge: 1, uhf: 0 });
  for (const p of pts) if (p !== lo) { const k = addSp('gx/pt' + R + '_' + p.x, { Z: p.Z, xyz: p.xyz, charge: 1, uhf: 0 }); T.push({ kind: 'rx', set: 'gx-pt', name: 'proton R=' + R + ' x=' + p.x, sp: [[lk, -1], [k, 1]], ref: p.E - lo.E, sigma: 0.03, held: R === 2.8 }); } }
// geometry: the forces at W4-11's reference geometries of the training molecules (bond-length errors ~ force / 40 eV/Å²)
const W4mol = new Set(); D.rx.forEach((r, i) => { if (r.set === 'W4-11') W4mol.add(r.sp[0][0]); });
const geoKeys = [...W4mol].filter(k => D.species[k].Z.length > 1);
const geoHeld = new Set(T.filter(t => t.set === 'W4-11' && t.held).map(t => t.sp[0][0]));
const SP = { ...D.species, ...SPX };
// bond lengths and angles of molecules optimized with the parameters being fitted (measured re, as cmp.js); three held out
const GEOM = { h2: [[0, 1, 0.741]], n2: [[0, 1, 1.098]], o2: [[0, 1, 1.208]], co: [[0, 1, 1.128]], h2o: [[0, 1, 0.958], [1, 0, 2, 104.5]], nh3: [[0, 1, 1.012]], ch4: [[0, 1, 1.087]],
  c2h2: [[1, 2, 1.203], [0, 1, 1.063]], c2h4: [[0, 1, 1.339], [1, 2, 1.087]], c2h6: [[0, 1, 1.536]], hcn: [[1, 2, 1.153], [0, 1, 1.065]], co2: [[0, 1, 1.160]], h2co: [[0, 1, 1.205]],
  o3: [[0, 1, 1.272], [1, 0, 2, 116.8]], oh: [[0, 1, 0.970]], n2h4: [[0, 1, 1.446]], 'WATER27/H2O2': [[0, 3, 2.912, 'oo']] };
const GEO_HELD = new Set(['c2h6', 'n2h4', 'nh3']), GEO_R = +flag('--geor', 0.005), GEO_A = +flag('--geoa', 1.0);
const optCache = new Map();
function geometries(par, ws, held, startFrom) {
  const v = { base, spin: spin ? ws : false, par }, out = [];
  for (const [nm, list] of Object.entries(GEOM)) {
    if (GEO_HELD.has(nm) !== held) continue;
    const s = SP[nm.includes('/') ? nm : 'W4-11/' + nm], x0 = (startFrom || optCache).get(nm) || s.xyz;
    let o; try { o = X.opt(x => X.E(v, s.Z, x, s.charge || 0, s.uhf, true), x0, { maxSteps: 150, gtol: 5e-5 }); } catch (e) { o = null; }
    if (!startFrom && o) optCache.set(nm, o.xyz);
    for (const t of list) {
      if (!o) { out.push([nm, t, NaN]); continue; }
      out.push([nm, t, t.length === 3 || t[3] === 'oo' ? X.dist(o.xyz[t[0]], o.xyz[t[1]]) : X.angle(o.xyz[t[0]], o.xyz[t[1]], o.xyz[t[2]])]);
    }
  }
  return out;
}
// ---- evaluation, with each species' last state as the next start
const guess = new Map(); let optStart = null;
function energies(par, ws, keys, withGrad, startFrom) {
  const v = { base, spin: spin ? ws : false, par };
  const E = {}, G = {};
  for (const k of keys) {
    const s = SP[k], gk = (startFrom || guess).get(k);
    let r;
    try { r = X.E(v, s.Z, s.xyz, s.charge, s.uhf, withGrad && geoKeys.includes(k), gk ? { qsh0: gk } : {}); if (!r.converged) r = X.E(v, s.Z, s.xyz, s.charge, s.uhf, withGrad && geoKeys.includes(k)); }
    catch (e) { r = { E: NaN }; }
    E[k] = r.E; if (r.g) G[k] = r.g;
    if (!startFrom && r.converged && (r.guess || r.qsh)) guess.set(k, r.guess || r.qsh);
  }
  return { E, G };
}
const keysOf = (pred) => { const s = new Set(); for (const t of T) if (pred(t)) for (const [k] of t.sp) s.add(k); return [...s]; };
const trainKeys = [...new Set([...keysOf(t => !t.held), ...geoKeys.filter(k => !geoHeld.has(k))])];
const allKeys = [...new Set([...keysOf(() => true), ...geoKeys])];
function residuals(x, keys, held, startFrom) {
  const { par, ws } = toPar(x), { E, G } = energies(par, ws, keys, true, startFrom);
  const r = [];
  for (const t of T) { if (t.held !== held) continue; let v = 0; for (const [k, c] of t.sp) v += c * E[k]; r.push(((v - t.ref) / t.sigma) || 1e3); }
  for (const k of geoKeys) { if (geoHeld.has(k) !== held) continue; const g = G[k]; if (!g) continue; for (const gi of g) for (const c of gi) r.push(c / 4 / GEO_SIG); } // (|F|/40 Å as an error, GEO_SIG/10 Å ~ one sigma)
  for (const [, t, v] of geometries(par, ws, held, startFrom ? optStart : null)) r.push(((v - (t[3] === 'oo' ? t[2] : t[t.length - 1])) / (t[3] === 'oo' ? 0.02 : t.length === 3 ? GEO_R : GEO_A)) || 1e3);
  if (!held) for (let i = 0; i < x.length; i++) r.push(LAMREG * x[i]);
  return r;
}
function report(x, tag) {
  const { par, ws } = toPar(x), { E, G } = energies(par, ws, allKeys, true, null);
  const by = {};
  for (const t of T) { let v = 0; for (const [k, c] of t.sp) v += c * E[k]; const key = t.set + (t.held ? ' held-out' : ' fit'); (by[key] = by[key] || []).push(Math.abs(v - t.ref)); }
  const geo = { fit: [], held: [] }; for (const k of geoKeys) { const g = G[k]; if (!g) continue; for (const gi of g) for (const c of gi) geo[geoHeld.has(k) ? 'held' : 'fit'].push(Math.abs(c)); }
  const o = {}; for (const [k, a] of Object.entries(by)) o[k] = { n: a.length, MAD: +(a.reduce((p, q) => p + q, 0) / a.length).toFixed(3), max: +Math.max(...a).toFixed(2) };
  o.forceFit = +(geo.fit.reduce((p, q) => p + q, 0) / geo.fit.length).toFixed(3); o.forceHeld = +(geo.held.reduce((p, q) => p + q, 0) / geo.held.length).toFixed(3);
  for (const held of [false, true]) { const g = geometries(par, ws, held, null), b = g.filter(([, t]) => t.length === 3), a = g.filter(([, t]) => t.length === 4);
    o['bonds' + (held ? 'Held' : 'Fit')] = +(b.reduce((p, [, t, v]) => p + Math.abs(v - t[2]), 0) / b.length).toFixed(4); if (a.length) o['angles' + (held ? 'Held' : 'Fit')] = a.map(([nm, , v]) => nm + ' ' + v.toFixed(1)).join(', '); }
  console.log(tag, JSON.stringify(o));
  return o;
}
// ---- Levenberg-Marquardt
function solve(A, b) { const n = b.length, M = A.map((r, i) => [...r, b[i]]); for (let i = 0; i < n; i++) { let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k; [M[i], M[p]] = [M[p], M[i]]; for (let k = i + 1; k < n; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; } } const x = new Array(n); for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; } return x; }
const ss = r => r.reduce((a, b) => a + b * b, 0);
let x = new Array(P.length).fill(0);
if (flag('--from')) { const f = JSON.parse(fs.readFileSync(flag('--from'), 'utf8')); if (f.x && f.x.length === x.length) x = f.x; }
const t0 = Date.now();
const before = report(x, 'start');
if (!EVAL) {
  let r = residuals(x, trainKeys, false), cost = ss(r), mu = 1e-2;
  console.log('cost', cost.toFixed(1), 'residuals', r.length, 'parameters', x.length, 'species', trainKeys.length, ((Date.now() - t0) / 1000).toFixed(0) + ' s');
  for (let it = 0; it < ITERS; it++) {
    const base0 = new Map(guess), J = []; optStart = new Map(optCache);
    for (let j = 0; j < x.length; j++) { const h = FDH, xp = x.slice(); xp[j] += h; const rp = residuals(xp, trainKeys, false, base0); J.push(rp.map((v, i) => (v - r[i]) / h)); }
    const n = x.length, JTJ = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => { let s = 0; for (let i = 0; i < r.length; i++) s += J[a][i] * J[b][i]; return s; })), JTr = J.map(c => c.reduce((s, v, i) => s + v * r[i], 0));
    let improved = false;
    for (let t = 0; t < 6 && !improved; t++) {
      const A = JTJ.map((row, a) => row.map((v, b) => v + (a === b ? mu * (JTJ[a][a] + 1e-6) : 0))), dx = solve(A, JTr.map(v => -v));
      const mx = Math.max(...dx.map(Math.abs)), sc = mx > STEP ? STEP / mx : 1, xn = x.map((v, i) => v + sc * dx[i]);
      const rn = residuals(xn, trainKeys, false, base0), cn = ss(rn);
      if (cn < cost) { x = xn; r = residuals(x, trainKeys, false); cost = ss(r); mu = Math.max(mu / 3, 1e-5); improved = true; }
      else mu *= 4;
    }
    console.log('iter', it, 'cost', cost.toFixed(1), 'mu', mu.toExponential(1), ((Date.now() - t0) / 1000).toFixed(0) + ' s');
    fs.writeFileSync(OUT, JSON.stringify({ base, spin, x, P, par: toPar(x).par, ws: toPar(x).ws }));
    if (!improved) break;
  }
}
const after = report(x, 'end');
fs.writeFileSync(OUT, JSON.stringify({ base, spin, x, P, par: toPar(x).par, ws: toPar(x).ws, before, after }));
