'use strict';
// GFN2 refit, second attempt (1.26): GFN2-xTB's form with spin polarization, H/C/N/O. Electrostatics (multipoles, AES
// kernels), D4 and every parameter named in --freeze stay GFN2's; the rest are fitted to W4-11, BH76, WATER27 (the first
// fit's held-out split), the must-haves (HCN -> HNC, O3 -> O2 + O, H + H2), g-xTB's hexazine path and shared proton, the
// forces at W4-11's geometries and optimized bond lengths and angles; plus invariance clusters (inv.json: water clusters
// up to 20 molecules, ions in water, hetero dimers; not WATER27, not S22) held at plain GFN2's binding energies. S22 is
// held out entirely (non-covalent check). --sens: the Jacobian at the start by group, no fit.
// node refit2.js out.json [--freeze hub:*,g3:*] [--iters N] [--from f.json] [--eval] [--sens] [--wsig s] [--invsig s] ...
const fs = require('fs'), path = require('path');
const X = require('./xm.js');
const args = process.argv.slice(2), OUT = args[0], base = 2, spin = true;
const flag = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const ITERS = +flag('--iters', 12), EVAL = args.includes('--eval'), SENS = args.includes('--sens'), STEP = +flag('--step', 1), FDH = +flag('--fdh', 1e-3);
const HERE = __dirname, GM = (process.env.AF_REF || HERE + '/.ref') + '/GMTKN55';
const D = JSON.parse(fs.readFileSync(path.join(HERE, 'fitdata.json'), 'utf8')), GX = JSON.parse(fs.readFileSync(path.join(HERE, 'gxref.json'), 'utf8'));
const INV = fs.existsSync(path.join(HERE, 'inv.json')) ? JSON.parse(fs.readFileSync(path.join(HERE, 'inv.json'), 'utf8')) : { species: {}, rx: [] };
const IPEA = fs.existsSync(path.join(HERE, 'ipea.json')) ? JSON.parse(fs.readFileSync(path.join(HERE, 'ipea.json'), 'utf8')) : { species: {}, rx: [] };
const ELS = [1, 6, 7, 8], PAIRS = ['1-1', '1-6', '1-7', '1-8', '6-6', '6-7', '6-8', '7-7', '7-8', '8-8'];
const nShOf = z => X.G2.nShell(z);
const SC = { dlev: 1.0, kcn: 0.3, shp: 2.0, hub: 0.1, g3: 0.5, ra: 0.1, rz: 0.1, pair: 0.05, wspin: 0.3 };

// ---- the parameter vector: [name, element or pair, index, scale]; --freeze "hub:*,dlev:8,pair:1-8"
const FREEZE = (flag('--freeze', '') || '').split(',').filter(Boolean).map(s => s.split(':'));
const frozen = (n, z, k) => FREEZE.some(([a, b, c]) => a === n && (b === '*' || b === undefined || String(z) === b) && (c === undefined || String(k) === c));
const ALLP = [];
for (const z of ELS) {
  for (let k = 0; k < nShOf(z); k++) ALLP.push(['dlev', z, k, SC.dlev]);
  for (let k = 0; k < nShOf(z); k++) ALLP.push(['kcn', z, k, SC.kcn]);
  for (let k = 0; k < nShOf(z); k++) ALLP.push(['shp', z, k, SC.shp]);
  for (const n of ['hub', 'g3', 'ra', 'rz']) ALLP.push([n, z, 0, SC[n]]);
}
for (const pr of PAIRS) ALLP.push(['pair', pr, 0, SC.pair]);
ALLP.push(['wspin', 0, 0, SC.wspin]);
const P = ALLP.filter(([n, z, k]) => !frozen(n, z, k));
let parId = 7000 + base * 100000;
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
// ---- targets (as fit.js, the same held-out split)
const tsOf = r => r.sp[r.sp.length - 1][0];
const MUST_W4 = ['n2', 'o2', 'o3', 'h2o', 'hcn', 'hnc', 'h2', 'oh'], MUST_BH = ['hcnts', 'RKT06'];
const GEO_SIG = +flag('--geosig', 0.04), LAMREG = +flag('--reg', 1), WSIG = +flag('--wsig', 0.02), INVSIG = +flag('--invsig', 0.02), PTSIG = +flag('--ptsig', 0.03);
const W4SIG = +flag('--w4sig', 0.15), BHSIG = +flag('--bhsig', 0.05), N6SIG = +flag('--n6sig', 0.15), HHSIG = +flag('--hhsig', 0.05);
const tsList = [...new Set(D.rx.filter(r => r.set === 'BH76').map(tsOf))];
const T = []; let iw = 0, iwa = 0;
for (const r of D.rx) {
  const idx = r.set === 'W4-11' ? iw++ : r.set === 'WATER27' ? iwa++ : 0;
  const must = r.set === 'W4-11' ? MUST_W4.includes(r.sp[0][0].split('/')[1]) : r.set === 'BH76' ? MUST_BH.includes(tsOf(r).split('/')[1]) : r.name === 'H2O2 H2O';
  const held = !must && (r.set === 'BH76' ? tsList.indexOf(tsOf(r)) % 3 === 2 : r.set === 'W4-11' ? idx % 4 === 3 : (idx % 3 === 2 || /H2O20/.test(r.name)));
  const isHH = r.set === 'BH76' && tsOf(r) === 'BH76/RKT06';
  T.push({ kind: 'rx', set: r.set, name: r.name, sp: r.sp, ref: r.ref, sigma: r.set === 'W4-11' ? W4SIG : r.set === 'BH76' ? (isHH ? HHSIG : BHSIG) : Math.max(0.01, WSIG * Math.abs(r.ref)), held });
}
{ const k = n => 'W4-11/' + n; T.push({ kind: 'rx', set: 'must', name: 'HCN -> HNC', sp: [[k('hcn'), -1], [k('hnc'), 1]], ref: (313.418 - 298.203) / 23.060547830619, sigma: 0.05, held: false });
  T.push({ kind: 'rx', set: 'must', name: 'O3 -> O2 + O', sp: [[k('o3'), -1], [k('o2'), 1], [k('o'), 1]], ref: (147.428 - 120.824) / 23.060547830619, sigma: 0.05, held: false }); }
const SPX = {};
const addSp = (key, s) => { SPX[key] = s; return key; };
const n6k = GX.n6.map((p, i) => addSp('gx/n6_' + i, { Z: p.Z, xyz: p.xyz, charge: 0, uhf: 0 })), n2k = addSp('gx/n2', { Z: GX.n2.Z, xyz: GX.n2.xyz, charge: 0, uhf: 0 });
GX.n6.forEach((p, i) => { if (i) T.push({ kind: 'rx', set: 'gx-n6', name: 'n6 path L=' + p.L, sp: [[n6k[0], -1], [n6k[i], 1]], ref: p.E - GX.n6[0].E, sigma: N6SIG, held: false }); });
T.push({ kind: 'rx', set: 'gx-n6', name: 'n6 release', sp: [[n6k[0], 1], [n2k, -3]], ref: GX.n6[0].E - 3 * GX.n2.E, sigma: 2 * N6SIG, held: false });
for (const R of [2.7, 2.8]) { const pts = GX.pt.filter(p => p.R === R), lo = pts.reduce((a, b) => a.E < b.E ? a : b); const lk = addSp('gx/pt' + R + '_' + lo.x, { Z: lo.Z, xyz: lo.xyz, charge: 1, uhf: 0 });
  for (const p of pts) if (p !== lo) { const k = addSp('gx/pt' + R + '_' + p.x, { Z: p.Z, xyz: p.xyz, charge: 1, uhf: 0 }); T.push({ kind: 'rx', set: 'gx-pt', name: 'proton R=' + R + ' x=' + p.x, sp: [[lk, -1], [k, 1]], ref: p.E - lo.E, sigma: PTSIG, held: R === 2.8 }); } }
// invariance: plain GFN2's binding of clusters made for this (not WATER27, not S22)
for (const r of INV.rx) T.push({ kind: 'rx', set: 'inv', name: r.name, sp: r.sp, ref: r.ref, sigma: Math.max(0.005, INVSIG * Math.abs(r.ref)), held: false });
const IPSIG = +flag('--ipsig', 0.3);
for (const r of IPEA.rx) T.push({ kind: 'rx', set: 'ipea', name: r.name, sp: r.sp, ref: r.ref, sigma: IPSIG, held: false });
// H3's symmetric stretch: no point past the saddle (0.93 Å) below it (GFN2 has a minimum at 1.05 Å): a hinge
const HD = [0.93, 1.0, 1.08, 1.16, 1.25, 1.35], hk = HD.map(d => addSp('hh/' + d, { Z: [1, 1, 1], xyz: [[-d, 0, 0], [0, 0, 0], [d, 0, 0]], charge: 0, uhf: 1 }));
for (let i = 1; i < HD.length; i++) T.push({ kind: 'hinge', set: 'h3', name: 'H3 d=' + HD[i], sp: [[hk[i], 1], [hk[0], -1]], ref: 0.4 * (HD[i] - 0.93), sigma: +flag('--h3sig', 0.02), held: false });
// S22 (all held out): dimer less its monomers, S22B references
const S22SP = {};
if (fs.existsSync(GM + '/S22/.res')) {
  const SYM = { h: 1, c: 6, n: 7, o: 8 };
  const rd = (n) => { const k = 'S22/' + n; if (S22SP[k]) return k; const L = fs.readFileSync(GM + '/S22/' + n + '/struc.xyz', 'utf8').trim().split('\n').slice(2).filter(l => l.trim()); S22SP[k] = { Z: L.map(l => SYM[l.trim().split(/\s+/)[0].toLowerCase()]), xyz: L.map(l => l.trim().split(/\s+/).slice(1, 4).map(Number)), charge: 0, uhf: 0 }; return k; };
  for (const l of fs.readFileSync(GM + '/S22/.res', 'utf8').split('\n')) {
    const m = l.match(/^\$tmer\s+(\d+)\{([^}]*)\}\/\$f\s+x\s+([-\d\s]+?)\s+\$w\s+([\d.]+)\s+\S+\s+\S+\s+(.*)$/); if (!m) continue;
    const names = m[2].split(',').map(s => m[1] + s), coef = m[3].trim().split(/\s+/).map(Number);
    T.push({ kind: 'rx', set: 'S22', name: m[5].trim(), sp: names.map((n, i) => [rd(n), coef[i]]), ref: +m[4] / 23.060547830619, sigma: 0.02, held: true });
  }
}
// geometry: forces at W4-11's reference geometries of the training molecules
const W4mol = new Set(); D.rx.forEach((r) => { if (r.set === 'W4-11') W4mol.add(r.sp[0][0]); });
const geoKeys = [...W4mol].filter(k => D.species[k].Z.length > 1);
const geoHeld = new Set(T.filter(t => t.set === 'W4-11' && t.held).map(t => t.sp[0][0]));
const SP = { ...D.species, ...SPX, ...INV.species, ...IPEA.species, ...S22SP };
const GEOM = { h2: [[0, 1, 0.741]], n2: [[0, 1, 1.098]], o2: [[0, 1, 1.208]], co: [[0, 1, 1.128]], h2o: [[0, 1, 0.958], [1, 0, 2, 104.5]], nh3: [[0, 1, 1.012]], ch4: [[0, 1, 1.087]],
  c2h2: [[1, 2, 1.203], [0, 1, 1.063]], c2h4: [[0, 1, 1.339], [1, 2, 1.087]], c2h6: [[0, 1, 1.536]], hcn: [[1, 2, 1.153], [0, 1, 1.065]], co2: [[0, 1, 1.160]], h2co: [[0, 1, 1.205]],
  o3: [[0, 1, 1.272], [1, 0, 2, 116.8]], oh: [[0, 1, 0.970]], n2h4: [[0, 1, 1.446]], 'WATER27/H2O2': [[0, 3, 2.912, 'oo']] };
const GEO_HELD = new Set(['c2h6', 'n2h4', 'nh3']), GEO_R = +flag('--geor', 0.003), GEO_A = +flag('--geoa', 0.5), GEO_OO = +flag('--geooo', 0.02);
const optCache = new Map(), GTOL = +flag('--gtol', 1e-6);
function geometries(par, ws, held, startFrom) {
  const v = { base, spin: spin ? ws : false, par }, out = [];
  for (const [nm, list] of Object.entries(GEOM)) {
    if (GEO_HELD.has(nm) !== held) continue;
    const s = SP[nm.includes('/') ? nm : 'W4-11/' + nm], x0 = (startFrom || optCache).get(nm) || s.xyz;
    let o; try { o = X.opt(x => X.E(v, s.Z, x, s.charge || 0, s.uhf, true, { accuracy: 1e-4 }), x0, { maxSteps: 300, gtol: GTOL }); } catch (e) { o = null; } // (tight: a 1e-3 parameter step moves the gradient by less than 5e-5, and the Jacobian then saw no change of angle or length)
    if (!startFrom && o) optCache.set(nm, o.xyz);
    for (const t of list) {
      if (!o) { out.push([nm, t, NaN]); continue; }
      out.push([nm, t, t.length === 3 || t[3] === 'oo' ? X.dist(o.xyz[t[0]], o.xyz[t[1]]) : X.angle(o.xyz[t[0]], o.xyz[t[1]], o.xyz[t[2]])]);
    }
  }
  return out;
}
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
// residuals with their group and sigma (for the sensitivity table)
function residuals(x, keys, held, startFrom, meta) {
  const { par, ws } = toPar(x), { E, G } = energies(par, ws, keys, true, startFrom);
  const r = [], push = (v, g, s) => { r.push(v); if (meta) meta.push([g, s]); };
  for (const t of T) { if (t.held !== held) continue; let v = 0; for (const [k, c] of t.sp) v += c * E[k]; if (t.kind === 'hinge') { push(Number.isFinite(v) ? Math.min(0, v - t.ref) / t.sigma : 1e3, 'h3', t.sigma); continue; } const g = t.set === 'BH76' && t.sigma === HHSIG && /RKT06/.test(t.sp[t.sp.length - 1][0]) ? 'HH' : t.set === 'BH76' && /hcnts/.test(t.sp[t.sp.length - 1][0]) ? 'HCN' : t.set; push(Number.isFinite(v) ? (v - t.ref) / t.sigma : 1e3, g, t.sigma); }
  for (const k of geoKeys) { if (geoHeld.has(k) !== held) continue; const g = G[k]; if (!g) continue; for (const gi of g) for (const c of gi) push(c / 4 / GEO_SIG, 'force', 4 * GEO_SIG); }
  for (const [nm, t, v] of geometries(par, ws, held, startFrom ? optStart : null)) { const s = t[3] === 'oo' ? GEO_OO : t.length === 3 ? GEO_R : GEO_A; push(Number.isFinite(v) ? (v - (t[3] === 'oo' ? t[2] : t[t.length - 1])) / s : 1e3, t[3] === 'oo' ? 'w2OO' : t.length === 3 ? 'bond' : 'angle', s); }
  if (!held) for (let i = 0; i < x.length; i++) push(LAMREG * x[i], 'reg', 1);
  return r;
}
function report(x, tag) {
  const { par, ws } = toPar(x), { E, G } = energies(par, ws, allKeys, true, null);
  const by = {}, sig = {}, o = {};
  for (const t of T) { let v = 0; for (const [k, c] of t.sp) v += c * E[k]; if (t.kind === 'hinge') { o.h3 = Math.min(o.h3 === undefined ? Infinity : o.h3, +v.toFixed(3)); continue; } const key = t.set + (t.held ? ' held-out' : ' fit'); (by[key] = by[key] || []).push(Math.abs(v - t.ref)); (sig[key] = sig[key] || []).push(v - t.ref); }
  const geo = { fit: [], held: [] }; for (const k of geoKeys) { const g = G[k]; if (!g) continue; for (const gi of g) for (const c of gi) geo[geoHeld.has(k) ? 'held' : 'fit'].push(Math.abs(c)); }
  for (const [k, a] of Object.entries(by)) o[k] = { n: a.length, MAD: +(a.reduce((p, q) => p + q, 0) / a.length).toFixed(3), MSD: +(sig[k].reduce((p, q) => p + q, 0) / a.length).toFixed(3), max: +Math.max(...a).toFixed(2) };
  const hh = T.find(t => /RKT06/.test(t.sp[t.sp.length - 1][0]) && t.sp.length === 3), hc = T.find(t => /hcnts/.test(t.sp[t.sp.length - 1][0]) && /hcn /.test(t.name));
  for (const [nm, t] of [['H+H2 TS', hh], ['HCN TS', hc]]) { let v = 0; for (const [k, c] of t.sp) v += c * E[k]; o[nm] = +v.toFixed(3); }
  o.forceFit = +(geo.fit.reduce((p, q) => p + q, 0) / geo.fit.length).toFixed(3); o.forceHeld = +(geo.held.reduce((p, q) => p + q, 0) / geo.held.length).toFixed(3);
  for (const held of [false, true]) { const g = geometries(par, ws, held, null), b = g.filter(([, t]) => t.length === 3), a = g.filter(([, t]) => t.length === 4);
    o['bonds' + (held ? 'Held' : 'Fit')] = +(b.reduce((p, [, t, v]) => p + Math.abs(v - t[2]), 0) / b.length).toFixed(4); if (a.length) o['angles' + (held ? 'Held' : 'Fit')] = a.map(([nm, , v]) => nm + ' ' + v.toFixed(2)).join(', '); }
  o.ws = +ws.toFixed(4);
  console.log(tag, JSON.stringify(o));
  return o;
}
function solve(A, b) { const n = b.length, M = A.map((r, i) => [...r, b[i]]); for (let i = 0; i < n; i++) { let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k; [M[i], M[p]] = [M[p], M[i]]; for (let k = i + 1; k < n; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; } } const x = new Array(n); for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; } return x; }
const ss = r => r.reduce((a, b) => a + b * b, 0);
let x = new Array(P.length).fill(0);
if (flag('--from')) { const f = JSON.parse(fs.readFileSync(flag('--from'), 'utf8')); const byName = new Map(f.P.map((p, i) => [p.slice(0, 3).join(':'), f.x[i]])); x = P.map(p => byName.get(p.slice(0, 3).join(':')) || 0); }
const t0 = Date.now();
const save = (extra = {}) => fs.writeFileSync(OUT, JSON.stringify({ base, spin, x, P, freeze: FREEZE.map(a => a.join(':')), par: toPar(x).par, ws: toPar(x).ws, args, ...extra }));
if (SENS) { // d(value)/d(parameter) per unit of its scale, RMS over each group (eV, Å, °)
  const meta = [], r0 = residuals(x, trainKeys, false, null, meta), base0 = new Map(guess); optStart = new Map(optCache);
  const groups = [...new Set(meta.map(m => m[0]))].filter(g => g !== 'reg');
  const S = {};
  for (let j = 0; j < P.length; j++) {
    const xp = x.slice(); xp[j] += FDH; const rp = residuals(xp, trainKeys, false, base0);
    const row = {}; for (const g of groups) { let s = 0, n = 0; for (let i = 0; i < r0.length; i++) if (meta[i][0] === g) { const d = (rp[i] - r0[i]) / FDH * meta[i][1]; s += d * d; n++; } row[g] = Math.sqrt(s / n); }
    S[P[j].slice(0, 3).join(':')] = row;
    console.log(P[j].slice(0, 3).join(':').padEnd(12), groups.map(g => g + ' ' + row[g].toExponential(1)).join('  '));
  }
  fs.writeFileSync(OUT, JSON.stringify({ groups, S, meta: meta.map(m => m[0]), r0 }));
  process.exit(0);
}
const before = report(x, 'start');
if (!EVAL) {
  let r = residuals(x, trainKeys, false), cost = ss(r), mu = +flag('--mu', 1e-2);
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
    save();
    if (!improved) break;
  }
}
const after = report(x, 'end');
save({ before, after });
