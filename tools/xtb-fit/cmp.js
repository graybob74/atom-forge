'use strict';
// The 1.26 comparison table for one method variant: node cmp.js <name> (gfn1, gfn2, gfn1s, gfn2s, or a fit's par file
// with --par file.json --base 1|2 [--spin]); writes cmp-<name>.json. Same quantities as the GFN2 comparison (126q):
// bond lengths of 21 molecules (24 bonds, measured), angles, atomization of 23 molecules (W4-11), H + H2 (BH76),
// HCN -> HNC, the water dimer (WATER27), O3 -> O2 + O, a proton between waters, hexazine (flat D3h path).
const fs = require('fs'), path = require('path');
const X = require('./xm.js');
const GM = (process.env.AF_REF || __dirname + '/.ref') + '/GMTKN55';
const args = process.argv.slice(2), name = args[0];
const flag = k => { const i = args.indexOf(k); return i < 0 ? null : args[i + 1]; };
const V = { gfn1: { base: 1 }, gfn2: { base: 2 }, gfn1s: { base: 1, spin: true }, gfn2s: { base: 2, spin: true } }[name] ||
  (() => { const f = JSON.parse(fs.readFileSync(flag('--par'), 'utf8')); return { base: f.base, spin: f.spin ? f.ws : false, par: f.par }; })();
const only = flag('--only');
const KCAL = 23.060547830619, SYM = { h: 1, c: 6, n: 7, o: 8, f: 9, s: 16, cl: 17 };
const readXYZ = f => { const L = fs.readFileSync(f, 'utf8').trim().split('\n').slice(2); return { Z: L.map(l => SYM[l.trim().split(/\s+/)[0].toLowerCase()]), xyz: L.map(l => l.trim().split(/\s+/).slice(1, 4).map(Number)) }; };
const W4 = {}; for (const l of fs.readFileSync(GM + '/W4-11/.res', 'utf8').split('\n')) { const m = l.match(/\{(\w[\w-]*),[^}]*\}.*\$w\s+([\d.]+)/); if (m) W4[m[1]] = +m[2]; }
const MOLS = { h2: 0, n2: 0, o2: 2, co: 0, hf: 0, f2: 0, cl2: 0, hcl: 0, h2o: 0, nh3: 0, ch4: 0, c2h2: 0, c2h4: 0, c2h6: 0, hcn: 0, hnc: 0, co2: 0, h2co: 0, o3: 0, n2h4: 0, h2s: 0, oh: 1, n2o: 0 };
const EXP = { h2: [[0, 1, 0.741]], n2: [[0, 1, 1.098]], o2: [[0, 1, 1.208]], co: [[0, 1, 1.128]], hf: [[0, 1, 0.917]], f2: [[0, 1, 1.412]], cl2: [[0, 1, 1.988]], hcl: [[0, 1, 1.275]],
  h2o: [[0, 1, 0.958]], nh3: [[0, 1, 1.012]], ch4: [[0, 1, 1.087]], c2h2: [[1, 2, 1.203], [0, 1, 1.063]], c2h4: [[0, 1, 1.339], [1, 2, 1.087]], c2h6: [[0, 1, 1.536]],
  hcn: [[1, 2, 1.153], [0, 1, 1.065]], co2: [[0, 1, 1.160]], h2co: [[0, 1, 1.205]], o3: [[0, 1, 1.272]], h2s: [[0, 1, 1.336]], oh: [[0, 1, 0.970]], n2h4: [[0, 1, 1.446]] };
const ANG = { h2o: [1, 0, 2, 104.5], o3: [1, 0, 2, 116.8], h2s: [1, 0, 2, 92.1] };
const uhfOf = (nm, Z) => V.spin ? MOLS[nm] || 0 : 0;
const Emol = (Z, xyz, uhf, grad) => X.E(V, Z, xyz, 0, uhf, grad);
const out = { name, mol: {}, geo: {}, ang: {} };
const want = k => !only || only.split(',').includes(k);
const opt = {};
if (want('mol')) {
  let sumA = 0, nA = 0; const bonds = [];
  for (const nm of Object.keys(MOLS)) {
    const g = readXYZ(path.join(GM, 'W4-11', nm, 'struc.xyz')), uhf = uhfOf(nm, g.Z);
    const o = X.opt(x => Emol(g.Z, x, uhf, true), g.xyz); opt[nm] = { Z: g.Z, xyz: o.xyz, E: o.E };
    const Ea = g.Z.reduce((t, z) => t + X.Eatom(V, z), 0), De = Ea - o.E, ref = W4[nm] / KCAL;
    out.mol[nm] = { De: +De.toFixed(3), ref: +ref.toFixed(3) }; sumA += Math.abs(De - ref); nA++;
    for (const [i, j, r] of EXP[nm] || []) { const v = X.dist(o.xyz[i], o.xyz[j]); bonds.push(Math.abs(v - r)); out.geo[nm + i + '-' + j] = +v.toFixed(4); }
    if (ANG[nm]) out.ang[nm] = +X.angle(o.xyz[ANG[nm][0]], o.xyz[ANG[nm][1]], o.xyz[ANG[nm][2]]).toFixed(1);
  }
  out.atomMAD = +(sumA / nA).toFixed(3); out.bondMAD = +(bonds.reduce((a, b) => a + b, 0) / bonds.length).toFixed(4); out.nBonds = bonds.length;
  fs.writeFileSync(path.join(__dirname, 'opt-' + name + '.json'), JSON.stringify(opt));
}
const optOf = (nm) => { if (opt[nm]) return opt[nm]; const f = path.join(__dirname, 'opt-' + name + '.json'); const o = JSON.parse(fs.readFileSync(f, 'utf8')); Object.assign(opt, o); return opt[nm]; };
// H + H2 -> H2 + H: the linear symmetric saddle (BH76 9.7 kcal/mol); spin on: the lowest state there (a doublet)
if (want('hh2')) {
  const h2 = optOf('h2').E, h = X.Eatom(V, 1, 1);
  let best = { E: Infinity };
  const at = d => { const Z = [1, 1, 1], x = [[-d, 0, 0], [0, 0, 0], [d, 0, 0]]; return V.spin ? X.E(V, Z, x, 0, 1).E : X.E(V, Z, x, 0, 1).E; };
  for (let d = 0.75; d <= 1.25; d += 0.01) { const e = at(d); if (e < best.E) best = { E: e, d }; }
  for (let d = best.d - 0.01; d <= best.d + 0.01; d += 0.001) { const e = at(d); if (e < best.E) best = { E: e, d }; }
  out.hh2 = { barrier: +(best.E - h2 - h).toFixed(3), d: +best.d.toFixed(3), ref: +(9.7 / KCAL).toFixed(3) };
}
// HCN -> HNC: energy and barrier (relaxed scan of the H-C-N angle, restrained)
if (want('hcn')) {
  const Z = [1, 6, 7], hcn = optOf('hcn'), hnc = optOf('hnc');
  const Ehnc = hnc.E, Ehcn = hcn.E;
  let x = hcn.xyz.map(p => p.slice()); x[0] = [x[1][0] - 1.06, x[1][1] + 0.05, x[1][2]]; let top = { E: -Infinity };
  const scan = [];
  for (let th = 170; th >= 40; th -= 5) {
    const o = X.opt(xx => Emol(Z, xx, 0, true), x, { rs: [{ type: 'angle', i: 0, j: 1, k: 2, deg: th, kf: 200 }], maxSteps: 120 });
    x = o.xyz; scan.push([th, o.E]); if (o.E > top.E) top = { E: o.E, th, xyz: o.xyz };
  }
  // refine around the top
  for (let th = top.th + 4; th >= top.th - 4; th -= 1) { const o = X.opt(xx => Emol(Z, xx, 0, true), top.xyz, { rs: [{ type: 'angle', i: 0, j: 1, k: 2, deg: th, kf: 200 }], maxSteps: 120 }); if (o.E > top.E) top = { E: o.E, th, xyz: o.xyz }; }
  out.hcn = { dE: +(Ehnc - Ehcn).toFixed(3), barrier: +(top.E - Ehcn).toFixed(3), angleTS: top.th, ref: { dE: 0.66, barrier: 2.086 } };
}
// the water dimer (WATER27: 5.01 kcal/mol)
if (want('w2')) {
  const g = readXYZ(GM + '/WATER27/H2O2/struc.xyz'), o = X.opt(x => Emol(g.Z, x, 0, true), g.xyz), Em = optOf('h2o').E;
  const Os = o.xyz.filter((_, i) => g.Z[i] === 8);
  out.w2 = { De: +(2 * Em - o.E).toFixed(3), OO: +X.dist(Os[0], Os[1]).toFixed(3), ref: +(5.01 / KCAL).toFixed(3) };
}
// O3 -> O2 + O (W4-11: 26.6 kcal/mol): spin on with O2 triplet and O's Hund spin; spin off as the game takes them (uhf 0)
if (want('o3')) {
  const o3 = optOf('o3'), o2 = optOf('o2');
  out.o3 = { dE: +(o2.E + X.Eatom(V, 8) - o3.E).toFixed(3), r: +X.dist(o3.xyz[0], o3.xyz[1]).toFixed(4), ref: +((147.428 - 120.824) / KCAL).toFixed(3) };
}
// a proton between two waters O-O 2.7 and 2.8 Å (planar, fixed): the middle against the best off-centre point
if (want('pt')) {
  const Z = [8, 1, 1, 1, 8, 1, 1], geo = (R, x) => [[0, 0, 0], [-0.4, 0.88, 0], [-0.4, -0.88, 0], [x, 0, 0], [R, 0, 0], [R + 0.4, 0.88, 0], [R + 0.4, -0.88, 0]];
  const f = (R) => { const mid = X.E(V, Z, geo(R, R / 2), 1, 0).E; let lo = Infinity; for (let x = 0.98; x <= 1.2; x += 0.01) lo = Math.min(lo, X.E(V, Z, geo(R, x), 1, 0).E); return +(mid - lo).toFixed(3); };
  out.pt = { 2.7: f(2.7), 2.8: f(2.8) };
}
// hexazine: the flat D6h ring, then the D3h path (long sides L, the short ones relaxed): barrier and release to 3 N2
if (want('n6')) {
  const ring = (s, l) => { let lo = 0.01, hi = 59.99; for (let k = 0; k < 80; k++) { const mm = (lo + hi) / 2; if (Math.sin(mm * Math.PI / 180) / Math.sin((60 - mm) * Math.PI / 180) < s / l) lo = mm; else hi = mm; }
    const h = (lo + hi) / 2, R = s / (2 * Math.sin(h * Math.PI / 180)), o = []; for (let i = 0; i < 3; i++) for (const sg of [-1, 1]) { const t = (120 * i + sg * h) * Math.PI / 180; o.push([R * Math.cos(t), R * Math.sin(t), 0]); } return o; };
  const Z6 = [7, 7, 7, 7, 7, 7], En = g => (V.spin ? X.Elow(V, Z6, g) : X.E(V, Z6, g)).E;
  const golden = (f, a, b, tol = 3e-4) => { const gr = (Math.sqrt(5) - 1) / 2; let c = b - gr * (b - a), d = a + gr * (b - a), fc = f(c), fd = f(d); while (b - a > tol) { if (fc < fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = f(d); } } const x = (a + b) / 2; return { x, f: f(x) }; };
  const flat = golden(s => En(ring(s, s)), 1.2, 1.4);
  const N2 = optOf('n2').E;
  let top = flat.f, path = [];
  for (let L = flat.x + 0.05; L <= 2.6; L += 0.05) { const b = golden(s => En(ring(s, L)), 1.05, Math.min(L, 1.4), 1e-3); path.push([+L.toFixed(2), +(b.f - flat.f).toFixed(3)]); if (b.f > top) top = b.f; }
  out.n6 = { NN: +flat.x.toFixed(3), barrier: +(top - flat.f).toFixed(3), release: +(flat.f - 3 * N2).toFixed(3), path };
}
fs.writeFileSync(path.join(__dirname, 'cmp-' + name + '.json'), JSON.stringify(out));
console.log(JSON.stringify({ ...out, mol: undefined, geo: undefined, n6: out.n6 ? { ...out.n6, path: undefined } : undefined }));
