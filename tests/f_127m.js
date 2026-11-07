'use strict';
/* The checks for 1.27's feature 20, the band's shape for the close-packed metals (Settings → Experimental → Metals →
   Many-body; src/bometal.js MB4_C, mb4Pass, mb4Local; tools/mb4fit.js; PERF-NOTES "1.27: feature 20"), run by t_features
   (one line) or alone: node tests/f_127m.js [part …]   (parts: fit, liquid, forces, flat, md). Each fails on v154 (none of
   it is there: there bcc lies below fcc for Cu, Al, Ni, Ti). The Node harness only (deterministic). (check(ok, good, bad);
   say(...)) */
const { load } = require('./load');
const fs = require('fs'), path = require('path');
const PARTS = {};
let _X = null;
const harness = () => { if (!_X) { _X = load('all', { seed: 3 }); _X.mbSet(1); } return _X; };
const has = (X) => { try { return typeof X.MB4_C === 'object' && X.MB4_C[29] > 0; } catch (e) { return false; } };
/* a periodic 3-D crystal: bct (c/a 1: bcc), fcc or ideal hcp, volume V an atom; its energy per atom */
function crystal(X, sym, kind, V, n, ca = 1) {
  let C, B;
  if (kind === 'fcc') { const a = Math.cbrt(4 * V); C = [a, a, a]; B = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]]; }
  else if (kind === 'hcp') { const a = Math.cbrt(V * Math.SQRT2), c = a * Math.sqrt(8 / 3); C = [a, a * Math.sqrt(3), c]; B = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 1 / 6, 0.5], [0, 2 / 3, 0.5]]; }
  else { const a = Math.cbrt(2 * V / ca); C = [a, a, a * ca]; B = [[0, 0, 0], [0.5, 0.5, 0.5]]; }
  const N = kind === 'hcp' ? [n, Math.max(3, n >> 1), Math.max(3, n >> 1)] : [n, n, n], L = C.map((l, k) => l * N[k]);
  X.baseWorld(L[0], L[1], 1, 0); X.W.gamma = 0; X.world3d(L[2]); X.W.wall = 'wrap';
  for (let i = 0; i < N[0]; i++) for (let j = 0; j < N[1]; j++) for (let l = 0; l < N[2]; l++) for (const b of B) X.addAtom(sym, (i + b[0] + 0.25) * C[0] - L[0] / 2, (j + b[1] + 0.25) * C[1] - L[1] / 2, { z: (l + b[2] + 0.25) * C[2] - L[2] / 2 });
  X.gridTouch(); X.vlInvalidate();
  return X.totalEnergy().pe / X.W.parts.filter(p => !p.dead).length;
}
const relaxed = (f) => { let best = Infinity; for (let s = 0.94; s <= 1.0601; s += 0.01) best = Math.min(best, f(s)); return best; };

/* ---- 1. the fit: the close-packed crystal exactly as in 1.25 (Ec at r₀, no force on scaling), bcc and the Bain path above it */
PARTS.fit = async (page, check, say) => {
  const X = harness(), out = {};
  if (!has(X)) { check(false, '', '1.27 (20) fit: no band-shape term (MB4_C) in this build'); return; }
  const ref = { Cu: ['fcc', 0.04], Al: ['fcc', 0.09], Ni: ['fcc', 0.08], Ti: ['hcp', 0.10] };
  let ok = true;
  for (const [sym, [kind, dE]] of Object.entries(ref)) {
    const P = X.mbParam(X.SYM2Z[sym]), V = P.r0 ** 3 / Math.SQRT2;
    const nn = kind === 'hcp' ? 6 : 4, e0 = crystal(X, sym, kind, V, nn), ep = crystal(X, sym, kind, V * 1.003, nn), em = crystal(X, sym, kind, V * 0.997, nn);
    const bcc = relaxed((s) => crystal(X, sym, 'bct', V * s, 6, 1)), bain = Math.min(...[1.1, 1.2, 1.3].map(ca => relaxed((s) => crystal(X, sym, 'bct', V * s, 6, ca))));
    out[sym] = { Ec: +(-e0).toFixed(4), slope: +((ep - em) / 0.006).toExponential(1), bcc: +(bcc - e0).toFixed(3), bain: +(bain - e0).toFixed(3), want: dE };
    ok = ok && Math.abs(e0 + P.Ec) < 1e-4 && Math.abs(ep - em) < 2e-6 && bcc - e0 > 0.9 * dE && bcc - e0 < 1.1 * dE + 0.002 && bain - e0 > 0;
  }
  check(ok, `1.27 (20): the close-packed metals' crystals keep 1.25's values (Cu Ec ${out.Cu.Ec}, Al ${out.Al.Ec}, Ni ${out.Ni.Ec}, Ti hcp ${out.Ti.Ec} eV, no force on scaling) and bcc lies above them as measured (relaxed: Cu +${out.Cu.bcc}, Al +${out.Al.bcc}, Ni +${out.Ni.bcc}, Ti +${out.Ti.bcc} eV an atom; about 0.04, 0.09, 0.08, 0.10; 1.25: −0.053, −0.039, −0.081, −0.092), the Bain path between them above too (lowest +${Math.min(out.Cu.bain, out.Al.bain, out.Ni.bain, out.Ti.bain)})`,
    '1.27 (20) fit: ' + JSON.stringify(out));
};

/* ---- 2. the liquid: 1.25's copper liquid (tools/mbliquid.json) rises by a few meV an atom, not by the latent heat (1.26's angles: +50) */
PARTS.liquid = async (page, check) => {
  const X = harness();
  if (!has(X)) { check(false, '', '1.27 (20) liquid: no band-shape term'); return; }
  const L = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools', 'mbliquid.json'), 'utf8')), out = {};
  for (const sym of ['Cu', 'Al']) {
    const Z = X.SYM2Z[sym], r0 = X.mbParam(Z).r0, C = X.MB4_C[Z], e = [0, 0];
    for (const [k, c] of [[0, 0], [1, C]]) {
      X.MB4_C[Z] = c;
      for (const sn of L.snaps) { const Lb = L.L * r0; X.baseWorld(Lb, Lb, 1, 0); X.W.gamma = 0; X.world3d(Lb); X.W.wall = 'wrap'; for (const p of sn) X.addAtom(sym, p[0] * r0, p[1] * r0, { z: p[2] * r0 }); X.gridTouch(); X.vlInvalidate(); e[k] += X.totalEnergy().pe / sn.length / L.snaps.length; }
    }
    X.MB4_C[Z] = C;
    out[sym] = +((e[1] - e[0]) * 1000).toFixed(1);
  }
  check(out.Cu > 0 && out.Cu < 8 && out.Al < 10, `1.27 (20): the liquid nearly where 1.25 had it (copper's liquid +${out.Cu} meV an atom, aluminium's +${out.Al}; latent heats 135 and 110), so the metals melt where they did`,
    '1.27 (20) liquid: ' + JSON.stringify(out));
};

/* ---- 3. forces are the energy's slopes and localPE stays exact (3-D Cu ball with Ni and an O atom, jittered; module and JavaScript paths agree) */
PARTS.forces = async (page, check) => {
  const X = load('all', { seed: 5 }); X.mbSet(1);
  if (!has(X)) { check(false, '', '1.27 (20) forces: no band-shape term'); return; }
  const r0 = 2.56, R = 7, c = r0 * Math.SQRT2, B = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]], n = Math.ceil(R / c) + 1;
  X.baseWorld(R * 6, R * 6, 300, 0); X.W.gamma = 0; X.world3d(R * 6);
  let m = 0;
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) for (const b of B) { const x = (i + b[0]) * c, y = (j + b[1]) * c, z = (k + b[2]) * c; if (x * x + y * y + z * z <= R * R) X.addAtom(m++ % 11 === 3 ? 'Ni' : 'Cu', x + 0.9 * (X.rnd() - 0.5), y + 0.9 * (X.rnd() - 0.5), { z: z + 0.9 * (X.rnd() - 0.5) }); }
  X.addAtom('O', R + 1.2, 0.3, { z: 0.2 });
  const P = X.W.parts.filter(p => !p.dead); for (const p of P) { p.vx = p.vy = p.vz = 0; }
  X.computeForces(); const e4 = X.MBO.e4;
  const F0 = P.map(p => [p.fx, p.fy, p.fz]);
  X.MBO.useWasm = false; X.gridTouch(); X.computeForces(); let dj = 0; P.forEach((p, i) => { dj = Math.max(dj, Math.abs(p.fx - F0[i][0]), Math.abs(p.fy - F0[i][1]), Math.abs(p.fz - F0[i][2])); }); X.MBO.useWasm = undefined; X.gridTouch(); X.computeForces();
  let worst = 0;
  for (let q = 0; q < P.length; q += 8) for (const [cc, k] of [['x', 0], ['y', 1], ['z', 2]]) {
    const p = P[q], h = 1e-5, x0 = p[cc];
    p[cc] = x0 + h; X.gridTouch(); const ep = X.totalEnergy().pe; p[cc] = x0 - h; X.gridTouch(); const em = X.totalEnergy().pe; p[cc] = x0; X.gridTouch();
    worst = Math.max(worst, Math.abs(-(ep - em) / (2 * h) - F0[q][k]));
  }
  let lw = 0;
  for (let t = 0; t < 10; t++) {
    const set = new Set([P[(t * 37) % P.length]]); if (t & 1) set.add(P[(t * 53 + 5) % P.length]);
    X.gridTouch(); const T0 = X.totalEnergy().pe, L0 = X.localPE(set);
    for (const q of set) { q.x += 0.3 * (X.rnd() - 0.5); q.y += 0.3 * (X.rnd() - 0.5); q.z += 0.3 * (X.rnd() - 0.5); }
    X.gridTouch(); const T1 = X.totalEnergy().pe, L1 = X.localPE(set); lw = Math.max(lw, Math.abs((T1 - T0) - (L1 - L0)));
  }
  check(e4 > 0.05 && worst < 5e-7 && lw < 1e-9 && dj < 1e-10, `1.27 (20): the band shape's forces are the energy's slopes (worst ${worst.toExponential(1)} eV/Å; a jittered Cu ball with Ni and an O atom, its term ${e4.toFixed(3)} eV), the event books stay exact (${lw.toExponential(1)} eV), the module and JavaScript paths agree (${dj.toExponential(1)})`,
    '1.27 (20) forces: ' + JSON.stringify({ e4, worst, lw, dj }));
};

/* ---- 4. the flat world: six neighbours, the term never acts (a flat Cu patch at 900 K: E₄ 0 at every step) */
PARTS.flat = async (page, check) => {
  const X = load('all', { seed: 4 }); X.mbSet(1);
  if (!has(X)) { check(false, '', '1.27 (20) flat: no band-shape term'); return; }
  const a = 2.45, R = 14; X.baseWorld(R * 6, R * 6, 900, 0.05);
  const n = Math.ceil(R / a) + 1; for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) { const x = (i + 0.5 * (j & 1)) * a, y = j * a * Math.sqrt(3) / 2; if (x * x + y * y <= R * R) X.addAtom('Cu', x, y); }
  for (const p of X.W.parts) { const v = X.thermalV(p.m, 900); p.vx = v[0]; p.vy = v[1]; }
  X.computeForces(); let mx = 0;
  for (let s = 0; s < 400; s++) { X.W.dt = X.chooseDt(); X.step(X.W.dt); mx = Math.max(mx, X.MBO.e4 || 0); }
  check(mx === 0, `1.27 (20): flat metals are untouched (a flat Cu patch of ${X.W.parts.length} atoms at 900 K, 400 steps: the term ${mx} at every step)`, '1.27 (20) flat: ' + mx);
};

/* ---- 5. in motion: a copper ball of 201 atoms started fcc at 600 K stays close-packed over 2 ps (1.25: a quarter of its
   inner atoms go body-centred); counted after a quench to its inherent structure */
PARTS.md = async (page, check) => {
  const X = load('all', { seed: 7 });
  if (!has(X)) { check(false, '', '1.27 (20) md: no band-shape term'); return; }
  const out = {};
  for (const on of [false, true]) {
    const C0 = { ...X.MB4_C }; if (!on) for (const z in X.MB4_C) X.MB4_C[z] = 0;
    X.mbSet(1); const r0 = X.mbParam(29).r0, R = 3.2 * r0, a = r0 * Math.SQRT2;
    X.baseWorld(80, 80, 600, 0.05); X.world3d(80);
    const n = 6; for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) for (const b of [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]]) { const x = (i + b[0]) * a, y = (j + b[1]) * a, z = (k + b[2]) * a; if (x * x + y * y + z * z <= R * R) X.addAtom('Cu', x, y, { z }); }
    const P = X.W.parts.filter(p => !p.dead); for (const p of P) { const v = X.thermalV(p.m, 600); p.vx = v[0]; p.vy = v[1]; p.vz = v[2] || 0; }
    X.computeForces(); const t0 = X.W.t; while ((X.W.t - t0) * X.PHYS.TU_S * 1e12 < 2) { X.W.dt = X.chooseDt(); X.step(X.W.dt); }
    X.W.T = 1; X.W.gamma = 2; for (let k = 0; k < 600; k++) { X.W.dt = X.chooseDt(); X.step(X.W.dt); }
    const cx = P.reduce((s, p) => s + p.x, 0) / P.length, cy = P.reduce((s, p) => s + p.y, 0) / P.length, cz = P.reduce((s, p) => s + p.z, 0) / P.length;
    let inner = 0, n14 = 0, n12 = 0;
    for (const p of P) { if (Math.hypot(p.x - cx, p.y - cy, p.z - cz) > R - 3) continue; inner++; let c = 0; for (const o of P) if (o !== p && Math.hypot(o.x - p.x, o.y - p.y, o.z - p.z) < 1.25 * r0) c++; if (c === 14) n14++; else if (c === 12) n12++; }
    out[on ? 'on' : 'off'] = { inner, bcc: n14, closePacked: n12 };
    X.mbSet(0); Object.assign(X.MB4_C, C0);
  }
  check(out.on.bcc * 3 < out.off.bcc && out.on.closePacked > 1.5 * out.off.closePacked && out.on.closePacked >= 0.4 * out.on.inner,
    `1.27 (20): a copper ball started fcc at 600 K stays close-packed (after 2 ps, quenched: inner atoms with 12 neighbours ${out.on.closePacked} of ${out.on.inner}, with bcc's 14 ${out.on.bcc}; without the term ${out.off.closePacked} and ${out.off.bcc})`,
    '1.27 (20) md: ' + JSON.stringify(out));
};

module.exports = async function f127m(page, check, say, openPage, only) {
  for (const [k, f] of Object.entries(PARTS)) {
    if (only && only.length && !only.includes(k)) continue;
    try { await f(page, check, say, openPage); } catch (e) { check(false, '', `1.27 (20) ${k}: ${e.message.split('\n')[0]}`); }
  }
};
module.exports.PARTS = PARTS;
if (require.main === module) (async () => {
  const parts = process.argv.slice(2).filter(a => a !== '--node');
  let fails = 0; const say = (...a) => console.log(...a);
  const check = (ok, good, bad) => { if (ok) say('  ' + good); else { fails++; say('FAIL ' + bad); } };
  await module.exports(null, check, say, null, parts);
  console.log(fails ? `${fails} failure(s)` : '1.27 feature 20 checks passed');
  process.exitCode = fails ? 1 : 0;
})();
