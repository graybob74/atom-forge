'use strict';
/* Quantum nuclei, step 1 (1.12 planning): path-integral molecular dynamics outside the game, with the game's own
   forces. Each atom becomes P beads joined in a ring by springs of stiffness m·ω_P² (ω_P = P·kT/ħ); every bead feels
   1/P of the force field at its ring's own copy of the world. At thermal equilibrium the beads spread as the quantum
   particle would: zero-point motion, and tunnelling through barriers. Integrated in the ring's normal modes (the
   free springs exactly), with a Langevin thermostat on each mode (PILE-L, Ceriotti et al. 2010) at the bath
   temperature. node tools/pimd-proto.js [h2|water|cost] [P]  */
const { load } = require('../tests/load.js');
const X = load('all', { seed: 5 }); const { W, PHYS } = X;
const HBAR = 6.582119569e-16 / PHYS.TU_S; // eV·tu
function setup(kind) {
  X.baseWorld(30, 30, 300, 0); W.wall = 'wrap';
  if (kind === 'h2') X.addMolecule('H2', 0, 0, 0, 300);
  else if (kind === 'd2') { const m = X.addMolecule('H2', 0, 0, 0, 300); for (const p of W.parts) if (!p.dead) { p.N = 1; X.refresh(p); } }
  else X.addMolecule('H2O', 0, 0, 0, 300);
  X.forcesNoEvents();
  return W.parts.filter(p => !p.dead && p.k === X.NUC);
}
/* Run PIMD: P beads, T kelvin, n steps of dt tu; returns the bond-length samples of the first pair of atoms. */
function run(kind, P, T, n, dt) {
  const A = setup(kind), na = A.length, kT = PHYS.KB * T, wP = P * kT / HBAR;
  const m = A.map(p => p.m);
  // bead positions and velocities [bead][atom]
  const qx = [], qy = [], vx = [], vy = [];
  for (let k = 0; k < P; k++) { qx.push(A.map(p => p.x)); qy.push(A.map(p => p.y)); vx.push(new Float64Array(na)); vy.push(new Float64Array(na)); }
  let seed = 11; const gauss = () => { let u = 0, v = 0; while (!u) u = (seed = (seed * 16807) % 2147483647) / 2147483647; v = (seed = (seed * 16807) % 2147483647) / 2147483647; return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  for (let k = 0; k < P; k++) for (let i = 0; i < na; i++) { const s = Math.sqrt(kT * P / m[i]); vx[k][i] = s * gauss(); vy[k][i] = s * gauss(); }
  // normal modes of the free ring: C[k][j] (orthonormal), frequencies ω_j = 2 ω_P sin(jπ/P)
  const C = [], om = [];
  for (let j = 0; j < P; j++) { om.push(2 * wP * Math.sin(j * Math.PI / P)); const row = []; for (let k = 0; k < P; k++) row.push(j === 0 ? Math.sqrt(1 / P) : j < P / 2 ? Math.sqrt(2 / P) * Math.cos(2 * Math.PI * j * k / P) : j === P / 2 ? Math.sqrt(1 / P) * (k % 2 ? -1 : 1) : Math.sqrt(2 / P) * Math.sin(2 * Math.PI * j * k / P)); C.push(row); }
  const fx = [], fy = [];
  const forces = () => { // the force field at every bead's copy of the world (the beads' own forces are the ring's physical ones /P … here each copy gets its full force, and the ring's springs carry the P-fold mass weighting)
    for (let k = 0; k < P; k++) {
      for (let i = 0; i < na; i++) { A[i].x = qx[k][i]; A[i].y = qy[k][i]; }
      X.forcesNoEvents(); fx[k] = A.map(p => p.fx); fy[k] = A.map(p => p.fy);
    }
  };
  // PILE-L friction for each mode: γ_j = 2ω_j (critical), the centroid's 1/τ0
  const gam = om.map((w, j) => j === 0 ? 1 / 10 : 2 * w);
  const thermo = (h) => {
    for (const [q, v] of [[qx, vx], [qy, vy]]) for (let i = 0; i < na; i++) {
      const s = Math.sqrt(kT * P / m[i]);
      const nm = C.map(row => row.reduce((t, c, k) => t + c * v[k][i], 0));
      for (let j = 0; j < P; j++) { const c1 = Math.exp(-h * gam[j]), c2 = Math.sqrt(1 - c1 * c1); nm[j] = c1 * nm[j] + c2 * s * gauss(); }
      for (let k = 0; k < P; k++) { let t = 0; for (let j = 0; j < P; j++) t += C[j][k] * nm[j]; v[k][i] = t; }
      void q;
    }
  };
  const freeRing = (h) => { // the springs exactly, mode by mode
    for (const [q, v] of [[qx, vx], [qy, vy]]) for (let i = 0; i < na; i++) {
      const pq = C.map(row => row.reduce((t, c, k) => t + c * q[k][i], 0)), pv = C.map(row => row.reduce((t, c, k) => t + c * v[k][i], 0));
      for (let j = 0; j < P; j++) {
        if (j === 0) { pq[0] += h * pv[0]; continue; }
        const w = om[j], c = Math.cos(w * h), sn = Math.sin(w * h), a = pq[j], b = pv[j];
        pq[j] = a * c + b * sn / w; pv[j] = -a * w * sn + b * c;
      }
      for (let k = 0; k < P; k++) { let a = 0, b = 0; for (let j = 0; j < P; j++) { a += C[j][k] * pq[j]; b += C[j][k] * pv[j]; } q[k][i] = a; v[k][i] = b; }
    }
  };
  forces();
  const rs = [], t0 = performance.now();
  for (let s = 0; s < n; s++) {
    thermo(dt / 2);
    for (let k = 0; k < P; k++) for (let i = 0; i < na; i++) { vx[k][i] += 0.5 * dt * fx[k][i] / m[i]; vy[k][i] += 0.5 * dt * fy[k][i] / m[i]; }
    freeRing(dt);
    forces();
    for (let k = 0; k < P; k++) for (let i = 0; i < na; i++) { vx[k][i] += 0.5 * dt * fx[k][i] / m[i]; vy[k][i] += 0.5 * dt * fy[k][i] / m[i]; }
    thermo(dt / 2);
    if (s > n / 5) for (let k = 0; k < P; k++) rs.push(Math.hypot(qx[k][1] - qx[k][0], qy[k][1] - qy[k][0]));
  }
  const ms = (performance.now() - t0) / n;
  const mean = rs.reduce((t, r) => t + r, 0) / rs.length, sd = Math.sqrt(rs.reduce((t, r) => t + (r - mean) ** 2, 0) / rs.length);
  return { mean, sd, ms };
}
const what = process.argv[2] || 'h2', P = +(process.argv[3] || 16);
if (what === 'h2' || what === 'd2') {
  // the game's H–H bond: Morse D, α, r₀; its harmonic quantum ground state is a Gaussian of width √(ħ/(2μω))
  const H = X.ELEMENTS[1], D = X.bondEnergy(H, H, 1), al = X.morseA(H, H, 1), r0 = X.bondLength(H, H, 1), mH = what === 'd2' ? 2.014 : 1.008, mu = mH / 2;
  const w = al * Math.sqrt(2 * D / mu), sdQ = Math.sqrt(HBAR / (2 * mu * w)), sdC = Math.sqrt(PHYS.KB * 300 / (mu * w * w));
  console.log(`${what === 'd2' ? 'D₂' : 'H₂'}: the game's bond ${r0.toFixed(3)} Å, ħω ${(HBAR * w).toFixed(3)} eV (measured H₂ 0.516, D₂ 0.371); width expected: quantum ground state ${sdQ.toFixed(4)} Å, classical at 300 K ${sdC.toFixed(4)} Å`);
  for (const p of [1, P]) { const r = run(what, p, 300, 3000, p === 1 ? 0.02 : 0.01); console.log(`  ${p} bead${p > 1 ? 's' : ''}: mean ${r.mean.toFixed(4)} Å, width ${r.sd.toFixed(4)} Å; ${r.ms.toFixed(2)} ms a step`); }
} else if (what === 'water') {
  for (const p of [1, P]) { const r = run('water', p, 300, 2000, p === 1 ? 0.02 : 0.01); console.log(`water O–H, ${p} bead${p > 1 ? 's' : ''}: mean ${r.mean.toFixed(4)} Å, width ${r.sd.toFixed(4)} Å (measured O–H zero-point width about 0.07 Å); ${r.ms.toFixed(2)} ms a step`); }
}
