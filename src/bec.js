/* The Bose–Einstein condensate lab (1.35.0, planned item 97; the owner: "do 2d and 3d in one pass now and code it in wasm").
   A window of its own, apart from the chamber: a cloud of bosons (⁸⁷Rb, ²³Na or ⁷Li) in a magnetic/optical trap, its
   condensate the Gross–Pitaevskii wave function ψ on a grid (flat: 256² in a pancake trap, ω_z/2π = 4 kHz; 3-D: 64³),
   stepped in the WebAssembly kernel (kernel/src/bec.rs: split-operator Fourier steps, imaginary time for the ground
   state, damping γ for the thermal cloud's friction, three-body loss, absorbing edges, a frame turning about z for a
   vortex lattice, a light sheet that splits it, a laser spoon the mouse drags). Trap units: length a_ho = √(ħ/mω), time 1/ω, energy ħω (ω the
   trap's x frequency). The thermal cloud is the ideal Bose gas in the same trap (T_c, N₀/N = 1 − (T/T_c)³ in 3-D,
   1 − (T/T_c)² in 2-D, its column density g₂ (3-D) or g₁ (2-D) of the fugacity times e^{−V/kT}, ballistic flight after
   release), drawn beside ψ and not interacting with it. What is drawn is what the experiments photograph: the column
   density (an absorption picture), or ψ's phase. */
const BEC_HBAR = 1.054571817e-34, BEC_KB = 1.380649e-23, BEC_AMU = 1.66053906660e-27;
const BEC_SP = { // mass (u), s-wave scattering length (m), three-body loss K₃ (m⁶/s)
  rb87: { name: 'rubidium-87', sym: '⁸⁷Rb', m: 86.909, a: 5.24e-9, K3: 5.8e-42 }, // (Burt et al. 1997: 5.8×10⁻³⁰ cm⁶/s in the condensate)
  na23: { name: 'sodium-23', sym: '²³Na', m: 22.990, a: 2.85e-9, K3: 1.1e-42 }, // (Stamper-Kurn et al. 1998: 1.1×10⁻³⁰ cm⁶/s)
  li7: { name: 'lithium-7', sym: '⁷Li', m: 7.016, a: -1.45e-9, K3: 1e-40 }, // (a = −27 a₀; K₃ only an estimate, 10⁻²⁸ cm⁶/s)
};
const BEC_FZ = 4000; // the flat lab's tight axis, Hz (a light sheet: the cloud is 2-D while μ < ħω_z)
const BEC = {
  open: false, rotOm: 0.7, rotIm: 0, gammaMin: 0.0005, sp: 'rb87', N: 20000, d3: false, f: 50, shape: 'round', tf: 0.05, view: 'dens', look: 'above', speed: 'normal', paused: false,
  split: false, released: false, spoon: null, eps: 0, bar: 0,
  t: 0, tRel: 0, regrids: 0, ground: 0, ph: null, g: null, bufs: {}, T: null, P: null, kKey: '', stepMs: 5, frame: 0, raf: 0, wasRunning: false,
  evap: null, seedRnd: 12345, img: null, cimg: null, hw: 0, info: null, vort: 0, lost: 0, msg: '', collapse: false,
};
function becOk() { return !!(typeof WK !== 'undefined' && WK.ex && typeof WK.ex.af_bec_step === 'function' && WK.mem); }
function becRnd() { BEC.seedRnd = (BEC.seedRnd * 1103515245 + 12345) >>> 0; return BEC.seedRnd / 4294967296; } // (the lab's own: the chamber's seeded rnd() stays untouched)
/* The polylogarithms g_n(u) for 0 ≤ u ≤ 1 (the ideal Bose gas). */
function becG1(u) { return -Math.log(Math.max(1e-12, 1 - Math.min(u, 0.995))); }
function becG2(u) {
  if (u <= 0) return 0;
  if (u > 0.5) { const v = 1 - u; return Math.PI * Math.PI / 6 - (v > 0 ? Math.log(u) * Math.log(v) : 0) - becG2(v); }
  let s = 0, p = u; for (let k = 1; k < 60 && p > 1e-17; k++, p *= u) s += p / (k * k); return s;
}
function becG3(u) { let s = 0, p = u; for (let k = 1; k < 4000 && p > 1e-15; k++, p *= u) s += p / (k * k * k); return s; }
/* The setup's physics: everything that follows from the gas, the atom number and the trap. */
function becPhys() {
  const s = BEC_SP[BEC.sp], m = s.m * BEC_AMU, w = 2 * Math.PI * BEC.f, aho = Math.sqrt(BEC_HBAR / (m * w));
  const ly = BEC.shape === 'long' ? 2 : 1, lz = BEC.d3 ? (BEC.shape === 'flat' ? 3 : 1) : BEC_FZ / BEC.f, N = BEC.N, ar = s.a / aho;
  const wbar = BEC.d3 ? w * Math.cbrt(ly * lz) : w * Math.sqrt(ly);
  const kTc = BEC.d3 ? BEC_HBAR * wbar * Math.cbrt(N / 1.20206) : BEC_HBAR * wbar * Math.sqrt(6 * N / (Math.PI * Math.PI)); // (ideal gas in the trap)
  const beta = BEC.d3 ? 4 * Math.PI * N * ar : Math.sqrt(8 * Math.PI * lz) * N * ar; // for ψ normalized to N₀/N
  const k3 = BEC.d3 ? s.K3 * N * N / (2 * w * Math.pow(aho, 6)) : s.K3 * N * N * lz / (2 * w * Math.pow(aho, 6) * Math.sqrt(3) * Math.PI);
  const Ncr = s.a < 0 ? (BEC.d3 ? 0.574 * Math.sqrt(BEC_HBAR / (m * wbar)) / -s.a : 5.85 / (Math.sqrt(8 * Math.PI * lz) * -ar)) : Infinity;
  return { s, m, w, aho, ly, lz, N, ar, wbar, kTc, Tc: kTc / BEC_KB, beta, k3, Ncr, um: aho * 1e6 };
}
function becFrac(tf) { return tf >= 1 ? 0 : 1 - Math.pow(Math.max(0, tf), BEC.d3 ? 3 : 2); }
function becMuTF(P, frac) { // Thomas–Fermi μ (ħω) for N₀ = frac·N, at least the oscillator's zero point
  const b = P.beta * frac, zp = BEC.d3 ? 0.5 * (1 + P.ly + P.lz) : 0.5 * (1 + P.ly);
  if (b <= 0) return zp;
  return Math.max(zp, BEC.d3 ? 0.5 * Math.pow(15 * b * P.ly * P.lz / (4 * Math.PI), 0.4) : Math.sqrt(b * P.ly / Math.PI));
}
/* The grid and its arrays in the module's memory (made once for each size; kept). */
function becGrid() {
  const P = becPhys(), mu = becMuTF(P, 1), R = Math.sqrt(2 * mu), n = BEC.d3 ? 64 : 256, nz = BEC.d3 ? 64 : 1;
  const L = Math.max(BEC.d3 ? 10 : 12, 2.8 * R);
  const key = n + 'x' + nz; let b = BEC.bufs[key];
  if (!b) {
    const N3 = n * n * nz, F = Float64Array;
    b = { re: wasmArray(F, N3), im: wasmArray(F, N3), kr: wasmArray(F, N3), ki: wasmArray(F, N3), sr: wasmArray(F, N3), si: wasmArray(F, N3),
      lr: wasmArray(F, n), li: wasmArray(F, n), twr: wasmArray(F, n / 2), twi: wasmArray(F, n / 2), out: wasmArray(F, Math.max(9, n * Math.max(n, nz))), T: wasmArray(Int32Array, 11), P: wasmArray(F, 32) };
    if (!wasmIn(b.re, b.im, b.kr, b.ki, b.sr, b.si, b.lr, b.li, b.twr, b.twi, b.out, b.T, b.P)) return null;
    for (let k = 0; k < n / 2; k++) { b.twr[k] = Math.cos(2 * Math.PI * k / n); b.twi[k] = -Math.sin(2 * Math.PI * k / n); }
    BEC.bufs[key] = b;
  }
  const T = b.T; ['re', 'im', 'kr', 'ki', 'lr', 'li', 'twr', 'twi', 'out', 'sr', 'si'].forEach((k, i) => { T[i] = b[k].byteOffset; });
  BEC.g = { n, nz, L, dx: L / n, dz: BEC.d3 ? L / nz : 1, b, P, mu };
  return BEC.g;
}
/* The step: small next to 1/μ, and under the split-step method's own limit with a nonlinearity (Weideman & Herbst
   1986: the step must not turn the grid's fastest wave by π, k_max²dt/2 < π, k_max = π/dx; the spectrum above half of k_max filtered out in the kernel, which makes 1.2 dx² stable; kept at 0.8 dx²). */
function becDt(g) { return Math.min(BEC.d3 ? 0.02 : 0.01, 0.25 / Math.max(1, g.mu), (BEC.released ? 0.3 : 0.8) * g.dx * g.dx); } // (free flight: 0.3 dx², its filter being at 0.9 of k_max)
function becParams(dt, steps, imag, beta) {
  const g = BEC.g, P = g.P, p = g.b.P;
  p.fill(0);
  p[0] = g.n; p[1] = g.n; p[2] = g.nz; p[3] = g.dx; p[4] = g.dx; p[5] = g.dz;
  p[6] = imag ? 0 : BEC.gamma; p[7] = imag ? 1 : 0; p[8] = 0.5; p[9] = 0.5 * P.ly * P.ly; p[10] = BEC.d3 ? 0.5 * P.lz * P.lz : 0;
  p[11] = BEC.released ? 0 : 1; p[12] = beta; p[13] = 0; p[14] = 0; p[15] = BEC.t;
  p[16] = imag ? 0 : BEC.bar; p[17] = 0.5; p[18] = imag ? 0 : 4; p[19] = dt; p[20] = steps; p[21] = imag ? 1 : 0; p[22] = g.n;
  p[25] = imag ? 0 : BEC.k3now; p[26] = imag ? 0 : BEC.mu0;
  p[31] = imag ? BEC.rotIm : 0;
  if (BEC.spoon && !imag) { p[27] = BEC.spoon.a; p[28] = BEC.spoon.x; p[29] = BEC.spoon.y; p[30] = Math.max(0.4, 3 * g.dx); } else p[30] = 1;
}
function becKin(dt, imag) {
  const g = BEC.g, key = [g.n, g.nz, g.dx, dt, imag ? 0 : BEC.gamma, imag].join();
  if (BEC.kKey === key) return;
  BEC.kKey = key;
  if (!BEC.released || imag) { becParams(dt, 1, imag, 0); WK.ex.af_bec_kin(g.b.T.byteOffset, g.b.P.byteOffset); return; }
  // in free flight the kernel's filter (the spectrum's top half) would eat the expansion's own velocities: the factors made
  // here with only the top tenth cut (the interaction is weak and falling by then; the step is cut to match, becDt)
  const { kr, ki } = g.b, n = g.n, nz = g.nz, inv = 1 / (n * n * nz), kof = (i, m, d) => 2 * Math.PI * (i < m / 2 ? i : i - m) / (m * d);
  for (let k = 0; k < nz; k++) { const kz = nz > 1 ? kof(k, nz, g.dz) : 0, sz = nz > 1 ? Math.pow(kz * g.dz / Math.PI, 2) : 0;
    for (let j = 0; j < n; j++) { const ky = kof(j, n, g.dx), sy = Math.pow(ky * g.dx / Math.PI, 2) + sz;
      for (let i = 0; i < n; i++) { const kx = kof(i, n, g.dx), q = i + n * (j + n * k);
        if (Math.pow(kx * g.dx / Math.PI, 2) + sy > 0.81) { kr[q] = 0; ki[q] = 0; continue; }
        const a = 0.5 * (kx * kx + ky * ky + kz * kz) * dt; kr[q] = Math.cos(a) * inv; ki[q] = -Math.sin(a) * inv; } } }
}
/* A fresh cloud: the Thomas–Fermi (or oscillator) shape as the first guess, then the ground state in imaginary time,
   a few steps a frame (BEC.ground of them left). */
function becReset() {
  if (!becOk()) return false;
  const g = becGrid(); if (!g) return false;
  const P = g.P, frac = becFrac(BEC.tf), { re, im } = g.b, n = g.n, nz = g.nz, h = n / 2, hz = nz / 2;
  BEC.t = 0; BEC.tRel = 0; BEC.released = false; BEC.regrids = 0; BEC.rotIm = 0; BEC.split = false; BEC.bar = 0; BEC.spoon = null;
  BEC.lost = 0; BEC.collapse = false; BEC.evap = null; BEC.vort = 0; BEC.msg = '';
  BEC.beta0 = P.beta; BEC.k3now = P.k3; BEC.lzNow = P.lz;
  const att = P.beta < 0, over = att && frac * P.N > 0.8 * P.Ncr, mu = becMuTF(P, frac);
  for (let k = 0; k < nz; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i - h) * g.dx, y = (j - h) * g.dx, z = BEC.d3 ? (k - hz) * g.dz : 0, q = i + n * (j + n * k);
    const V = 0.5 * (x * x + P.ly * P.ly * y * y + (BEC.d3 ? P.lz * P.lz * z * z : 0));
    re[q] = att || P.beta * frac < 5 ? Math.exp(-V) : Math.sqrt(Math.max(0, mu - V) + 0.02 * Math.exp(-V)); im[q] = 0;
  }
  BEC.frac = frac; BEC.fracNow = frac; BEC.gamma = becGamma();
  BEC.groundBeta = over ? 0 : P.beta * Math.max(frac, 1e-3); // (over the collapse limit no ground state exists: the trap's own, interactions switched on after)
  // the ground state: coarse imaginary-time steps, then fine ones (the coarse steps' own splitting error, dt·μ, would
  // leave it breathing once real time starts)
  const dtc = BEC.d3 ? 0.03 : 0.02, dtf = Math.min(dtc, 0.1 / Math.max(1, g.mu));
  BEC.gStages = [[dtc, Math.ceil((BEC.d3 ? 1.8 : 3) / dtc)], [dtf, Math.ceil(0.5 / dtf)]];
  BEC.ground = BEC.gStages[0][1] + BEC.gStages[1][1]; BEC.dtIm = dtc;
  if (over) BEC.msg = `More atoms than ${P.s.sym} can hold together (about ${fmtNum(P.Ncr)} at most, its attraction): watch it collapse.`;
  becKin(BEC.dtIm, true);
  return true;
}
function becGamma() { return BEC.released ? 0 : BEC.gammaMin + 0.02 * Math.min(1, BEC.tf); } // (the thermal cloud's friction: phenomenological, grows with T)
/* After the ground state: ψ scaled to N₀/N (the norm carries the atom number), μ for the damping. */
function becGroundDone() {
  BEC.rotIm = 0;
  const g = BEC.g, { re, im } = g.b, s = Math.sqrt(Math.max(1e-6, BEC.frac)), n3 = g.n * g.n * g.nz;
  for (let i = 0; i < n3; i++) { re[i] *= s; im[i] *= s; }
  const o = becObs(); BEC.mu0 = o.mu; BEC.dt = becDt(g); BEC.kKey = '';
}
function becObs() {
  const g = BEC.g, b = g.b; becParams(0, 0, false, BEC.beta0);
  b.T[9] = b.sr.byteOffset; WK.ex.af_bec_obs(b.T.byteOffset, b.P.byteOffset);
  const o = b.out, nrm = o[0] || 1e-30;
  return { norm: o[0], Vt: o[1], I: o[2], K: o[3], x2: o[4], y2: o[5], z2: o[6], peak: o[7], Lz: o[8], mu: (o[3] + o[1] + 2 * o[2]) / nrm, E: (o[3] + o[1] + o[2]) / nrm };
}
function becNorm() { const g = BEC.g, { re, im } = g.b, n3 = g.n * g.n * g.nz; let s = 0; for (let i = 0; i < n3; i++) s += re[i] * re[i] + im[i] * im[i]; return s * g.dx * g.dx * (BEC.d3 ? g.dz : 1); }
function becScale(f) { const g = BEC.g, { re, im } = g.b, n3 = g.n * g.n * g.nz; for (let i = 0; i < n3; i++) { re[i] *= f; im[i] *= f; } }
/* One frame's steps, inside a time budget. */
function becAdvance() {
  const g = BEC.g; if (!g) return;
  if (BEC.ground > 0) {
    const st = BEC.gStages[0][1] > 0 ? BEC.gStages[0] : BEC.gStages[1]; BEC.dtIm = st[0];
    const k = Math.min(st[1], BEC.d3 ? 3 : 12); st[1] -= k; becParams(BEC.dtIm, k, true, BEC.groundBeta); becKin(BEC.dtIm, true);
    WK.ex.af_bec_step(g.b.T.byteOffset, g.b.P.byteOffset); BEC.ground -= k; if (BEC.ground <= 0) becGroundDone(); return;
  }
  if (BEC.paused) return;
  const budget = { slow: 4, normal: 12, fast: 28 }[BEC.speed] || 12, steps = Math.max(1, Math.min(200, Math.floor(budget / Math.max(0.05, BEC.stepMs))));
  const P = g.P, tr = BEC.t - BEC.tRel;
  // the knobs that move with time: the light sheet's ramp, the evaporation's temperature, a flat cloud's z after release
  BEC.bar += ((BEC.split ? 1.3 * Math.max(1, BEC.mu0) : 0) - BEC.bar) * Math.min(1, steps * BEC.dt / 8);
  if (Math.abs(BEC.bar) < 1e-4) BEC.bar = 0;
  if (BEC.evap) { const e = BEC.evap, u = Math.min(1, (BEC.t - e.t0) / e.dur); BEC.tf = e.from + (e.to - e.from) * u; if (u >= 1) BEC.evap = null; becSyncT(); }
  let beta = BEC.beta0, k3 = P.k3;
  if (BEC.released && !BEC.d3) { const s = 1 + P.lz * P.lz * tr * tr; beta /= Math.sqrt(s); k3 /= s; } // (the pancake's z width grows: its 2-D interaction falls)
  BEC.k3now = k3; BEC.gamma = becGamma();
  becParams(BEC.dt, steps, false, beta); becKin(BEC.dt, false);
  const t0 = performance.now(), n0 = BEC.lastNorm == null ? becNorm() : BEC.lastNorm;
  let nrm = WK.ex.af_bec_step(g.b.T.byteOffset, g.b.P.byteOffset);
  BEC.stepMs = 0.8 * BEC.stepMs + 0.2 * (performance.now() - t0) / steps; BEC.t += steps * BEC.dt;
  // the condensate follows the thermal model's N₀ (its growth or melting, ~1/ω), while the cloud touches the thermal gas
  const want = becFrac(BEC.tf);
  if (!BEC.released && (BEC.gamma > 0.0035 || Math.abs(want - nrm) > 2e-3) && !BEC.collapse) {
    if (nrm < 1e-5 && want > 1e-3) { becSeed(); nrm = becNorm(); }
    if (nrm > 1e-9) { const target = nrm + (want - nrm) * Math.min(1, steps * BEC.dt); becScale(Math.sqrt(Math.max(0, target) / nrm)); nrm = Math.max(0, target); }
  } else if (nrm < n0) BEC.lost += (n0 - nrm) * P.N;
  BEC.lastNorm = nrm;
  // the damping drains H − μ: μ kept current as the condensate grows or melts (else it would feed or starve it)
  if (!BEC.released && !(BEC.frame & 7) && P.beta > 0) { const o = becObs(); if (o.norm > 1e-6) BEC.mu0 = o.mu; }
  // collapse (attraction): the peak racing up; three-body loss then throws atoms out
  if (P.beta < 0 && !BEC.collapse) { const o = becObs(); if (o.peak * Math.abs(BEC.beta0) > 40 * Math.max(1, BEC.mu0 > 0 ? BEC.mu0 : 1)) { BEC.collapse = true; BEC.msg = 'Collapse: the attraction pulls the cloud into a spike; three-body collisions throw atoms out (a “Bosenova”).'; } }
  if (BEC.released) becRegrid();
}
/* A condensate seeded from (almost) nothing as the gas is cooled through T_c: small, with a random phase (patches that
   then join; a fast quench can trap vortices where they meet, the Kibble–Zurek mechanism). */
function becSeed() {
  const g = BEC.g, P = g.P, { re, im } = g.b, n = g.n, nz = g.nz, h = n / 2, hz = nz / 2, mu = becMuTF(P, Math.max(0.05, becFrac(BEC.tf)));
  const waves = []; for (let w = 0; w < 14; w++) { const a = becRnd() * 2 * Math.PI, k = (0.5 + 1.5 * becRnd()) / Math.max(0.3, 1 / Math.sqrt(2 * mu)) * 0.35; waves.push([k * Math.cos(a), k * Math.sin(a), becRnd() * 2 * Math.PI, BEC.d3 ? (becRnd() - 0.5) * k : 0]); }
  for (let k = 0; k < nz; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i - h) * g.dx, y = (j - h) * g.dx, z = BEC.d3 ? (k - hz) * g.dz : 0, q = i + n * (j + n * k);
    const V = 0.5 * (x * x + P.ly * P.ly * y * y + (BEC.d3 ? P.lz * P.lz * z * z : 0));
    let ph = 0; for (const [kx, ky, p0, kz] of waves) ph += Math.sin(kx * x + ky * y + kz * z + p0);
    const a = Math.sqrt(Math.max(0, mu - V)) * 1e-2; re[q] = a * Math.cos(1.6 * ph); im[q] = a * Math.sin(1.6 * ph);
  }
  BEC.lastNorm = null;
}
/* Time of flight: when the falling cloud nears the grid's edge the grid is doubled (every other point kept: its
   velocities still fit), up to three times. */
function becRegrid() {
  const g = BEC.g, { re, im } = g.b, n = g.n, nz = g.nz, h = n / 2, d = BEC.d3;
  if (BEC.frame & 3) return;
  let edge = 0, tot = 0, pk = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const q = i + n * (j + n * k), r = re[q] * re[q] + im[q] * im[q]; tot += r; if (r > pk) pk = r;
    const f = Math.max(Math.abs(i - h), Math.abs(j - h), d ? Math.abs(k - nz / 2) * n / nz : 0) / h; if (f > 0.62) edge += r;
  }
  if (tot <= 0 || edge / tot < 2e-3) return;
  if (BEC.regrids >= 3) { BEC.paused = true; BEC.msg = 'The cloud has spread to the edge of the grid (eight times its first size): paused here.'; becButtons(); return; }
  // the phase step between kept neighbours must stay well under π, else the picture would alias
  let big = 0, seen = 0;
  for (let j = 0; j < n; j += 4) for (let i = 0; i + 2 < n; i += 2) { const q = i + n * (j + n * (nz >> 1)), q2 = q + 2;
    if (re[q] * re[q] + im[q] * im[q] < 0.05 * pk) continue; seen++;
    if (Math.abs(Math.atan2(re[q] * im[q2] - im[q] * re[q2], re[q] * re[q2] + im[q] * im[q2])) > 2.2) big++; } // (a vortex core's few steep pairs aside)
  if (seen && big > 0.01 * seen) { BEC.regrids = 3; BEC.paused = true; BEC.msg = 'The cloud has reached the edge of what the grid can hold (it moves too fast to follow on a coarser one): paused here.'; becButtons(); return; }
  const N3 = n * n * nz, tr = g.b.sr, ti = g.b.si; tr.set(re.subarray(0, N3)); ti.set(im.subarray(0, N3)); re.fill(0, 0, N3); im.fill(0, 0, N3);
  const q0 = n / 4, z0 = nz > 1 ? nz / 4 : 0;
  for (let k = 0; k < nz; k++) { const ks = nz > 1 ? 2 * (k - z0) : 0; if (ks < 0 || ks >= nz) continue;
    for (let j = 0; j < n; j++) { const js = 2 * (j - q0); if (js < 0 || js >= n) continue;
      for (let i = 0; i < n; i++) { const is = 2 * (i - q0); if (is < 0 || is >= n) continue;
        const a = is + n * (js + n * ks), q = i + n * (j + n * k); re[q] = tr[a]; im[q] = ti[a]; } } }
  // (no rescaling: ψ is the same function, sampled on cells 4 (8) times the size, so its norm is kept)
  g.L *= 2; g.dx *= 2; if (nz > 1) g.dz *= 2; BEC.regrids++; BEC.kKey = ''; BEC.dt = becDt(g); BEC.lastNorm = null;
}
/* Temperature: the slider's T/T_c and the readout. */
function becSyncT() { const r = $('becT'); if (r && document.activeElement !== r) r.value = String(Math.round(BEC.tf * 100)); becTLabel(); }
function becTLabel() { const el = $('becTv'); if (!el || !BEC.g) return; const P = BEC.g.P; el.textContent = `${fmtPrec(BEC.tf * P.Tc * 1e9, 3)} nK · ${Math.round(BEC.tf * 100)}% of Tc`; }
/* Drawing: the absorption picture (or the phase) over ±hw (a_ho), the thermal cloud added. */
const BEC_MAP = [[0, 0, 0, 0], [0.18, 30, 20, 90], [0.4, 30, 110, 200], [0.62, 60, 200, 210], [0.82, 250, 230, 120], [1, 255, 255, 255]];
function becCol(v) { v = Math.max(0, Math.min(1, v)); let i = 1; while (i < BEC_MAP.length - 1 && v > BEC_MAP[i][0]) i++; const a = BEC_MAP[i - 1], b = BEC_MAP[i], u = (v - a[0]) / (b[0] - a[0] || 1); return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u]; }
function becHue(ph, v) { // the phase as a hue, brightness the density
  const h = ((ph / (2 * Math.PI)) % 1 + 1) % 1 * 6, c = v, x = c * (1 - Math.abs(h % 2 - 1)), k = Math.floor(h);
  const [r, gg, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][k % 6]; return [r * 255, gg * 255, b * 255];
}
function becThermal(P, side) { // the thermal cloud: N_th, its widths (a_ho) and the fugacity
  const kT = BEC.tf * P.kTc, hw = BEC_HBAR * P.w, tr = BEC.released ? BEC.t - BEC.tRel : 0;
  if (kT <= 0) return null;
  const Nth = BEC.tf >= 1 ? P.N : P.N * (1 - becFrac(BEC.tf));
  if (Nth < 1) return null;
  let z = 1;
  if (BEC.tf > 1) { const x = kT / (BEC_HBAR * P.wbar), want = P.N / Math.pow(x, BEC.d3 ? 3 : 2); let lo = 0, hi = 1; for (let it = 0; it < 50; it++) { const m = 0.5 * (lo + hi); ((BEC.d3 ? becG3(m) : becG2(m)) < want ? lo = m : hi = m); } z = 0.5 * (lo + hi); }
  const s0 = Math.sqrt(kT / hw), l2 = side ? P.lz : P.ly;
  const sx = s0 * Math.sqrt(1 + tr * tr), sy = s0 / l2 * Math.sqrt(1 + l2 * l2 * tr * tr);
  const norm = 2 * Math.PI * sx * sy * (BEC.d3 ? becG3(z) : becG2(z));
  return { Nth, z, sx, sy, norm };
}
function becDraw() {
  const cv = $('becCv'); if (!cv || !BEC.g) return;
  const g = BEC.g, P = g.P, dpr = Math.min(2, devicePixelRatio || 1), W = Math.round(cv.clientWidth * dpr), H = Math.round(cv.clientHeight * dpr);
  if (!W || !H) return;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext('2d'), RW = W >= H ? 256 : Math.max(64, Math.round(256 * W / H)), RH = H >= W ? 256 : Math.max(64, Math.round(256 * H / W));
  if (!BEC.img || BEC.img.width !== RW || BEC.img.height !== RH) { BEC.cimg = document.createElement('canvas'); BEC.cimg.width = RW; BEC.cimg.height = RH; BEC.img = BEC.cimg.getContext('2d').createImageData(RW, RH); }
  const side = BEC.d3 && BEC.look === 'side', th = becThermal(P, side), n = g.n, nz = g.nz, h = n / 2, phase = BEC.view === 'phase';
  // the window: the grid, or the thermal cloud if it is bigger (smoothly)
  const want = Math.max(g.L / 2, th ? 2.6 * Math.max(th.sx, th.sy) : 0);
  BEC.hw = BEC.hw ? BEC.hw + (want - BEC.hw) * 0.15 : want; const hw = BEC.hw, hwx = hw * RW / Math.min(RW, RH), hwy = hw * RH / Math.min(RW, RH); // (hw: the shorter side's half-width)
  // the condensate's column (or slice) on the grid
  const { re, im, out } = g.b; let col, cw, chh, cdx = g.dx, cdy = side ? g.dz : g.dx;
  if (phase || !BEC.d3) { // a slice: ψ itself (the flat grid, or the 3-D grid's middle plane)
    cw = n; chh = side ? nz : n; col = null;
  } else {
    const p = g.b.P; becParams(0, 0, false, 0); p[23] = side ? 1 : 2; p[24] = side ? g.dx : g.dz; WK.ex.af_bec_column(g.b.T.byteOffset, p.byteOffset);
    col = out; cw = n; chh = side ? nz : n;
  }
  const at = (i, j) => { // the grid index of picture cell (i, j): x along i; the second axis is y (above) or z (side)
    if (!BEC.d3) return i + n * j; if (side) return i + n * ((n >> 1) + n * j); return i + n * (j + n * (nz >> 1)); };
  const dens = (i, j) => { if (col) return col[i + cw * j]; const q = at(i, j); return re[q] * re[q] + im[q] * im[q]; };
  const toUm2 = P.N / (P.um * P.um); // ψ's |ψ|² (per a_ho²) → atoms per µm² (the flat cloud; the 3-D column likewise)
  // peak for the colour scale (smoothed)
  let pk = 0; for (let j = 0; j < chh; j += 2) for (let i = 0; i < cw; i += 2) { const v = dens(i, j); if (v > pk) pk = v; }
  const pkc = phase ? pk : pk * toUm2, thPk = th && !phase ? th.Nth * (BEC.d3 ? becG2(th.z) : becG1(th.z)) / th.norm / (P.um * P.um) : 0;
  const top = Math.max(pkc + (phase ? 0 : thPk), 1e-12); BEC.scale = BEC.scale ? BEC.scale + (top - BEC.scale) * 0.2 : top;
  const d = BEC.img.data, sc = BEC.scale;
  for (let py = 0; py < RH; py++) { const yy = hwy - (py + 0.5) / RH * 2 * hwy, fj = yy / cdy + (side ? nz / 2 : h) - 0.5;
    for (let px = 0; px < RW; px++) { const xx = (px + 0.5) / RW * 2 * hwx - hwx, fi = xx / cdx + h - 0.5, o = 4 * (px + RW * py);
      let c = 0, ph = 0; const i0 = Math.floor(fi), j0 = Math.floor(fj);
      if (i0 >= 0 && j0 >= 0 && i0 + 1 < cw && j0 + 1 < chh) {
        const u = fi - i0, v = fj - j0;
        c = (dens(i0, j0) * (1 - u) + dens(i0 + 1, j0) * u) * (1 - v) + (dens(i0, j0 + 1) * (1 - u) + dens(i0 + 1, j0 + 1) * u) * v;
        if (phase) { const q = at(Math.round(fi), Math.round(fj)); ph = Math.atan2(im[q], re[q]); }
      }
      if (phase) { const [r, gg, b] = becHue(ph, Math.sqrt(Math.min(1, c / (sc || 1)))); d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255; continue; }
      let a = c * toUm2;
      if (th) { const s = 0.5 * (xx * xx / (th.sx * th.sx) + yy * yy / (th.sy * th.sy)); if (s < 40) a += th.Nth * (BEC.d3 ? becG2(th.z * Math.exp(-s)) : becG1(th.z * Math.exp(-s))) / th.norm / (P.um * P.um); }
      const [r, gg, b] = becCol(Math.sqrt(a / sc)); d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
    } }
  BEC.cimg.getContext('2d').putImageData(BEC.img, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(BEC.cimg, 0, 0, W, H);
  const S = Math.min(W, H), ox = (W - S) / 2, oy = (H - S) / 2; // (the ±hw square, centred)
  // the spoon, the sheet, the scale bar, the caption
  const toPx = (x) => ox + (x + hw) / (2 * hw) * S, toPy = (y) => oy + (hw - y) / (2 * hw) * S;
  ctx.lineWidth = 1.5 * dpr;
  if (BEC.bar > 0.01 && !side) { ctx.strokeStyle = 'rgba(120,170,255,' + Math.min(0.7, BEC.bar / (1.3 * Math.max(1, BEC.mu0))) + ')'; ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.beginPath(); ctx.moveTo(toPx(0), 0); ctx.lineTo(toPx(0), H); ctx.stroke(); ctx.setLineDash([]); }
  if (BEC.spoon && !side) { ctx.strokeStyle = 'rgba(120,170,255,0.85)'; ctx.beginPath(); ctx.arc(toPx(BEC.spoon.x), toPy(BEC.spoon.y), Math.max(4 * dpr, 2 * Math.max(0.4, 3 * g.dx) / (2 * hw) * S), 0, 7); ctx.stroke(); }
  const um = 2 * hw * P.um, nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((v) => v >= um / 6) || 1000, bl = nice / um * S;
  ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = `${12 * dpr}px system-ui, sans-serif`; ctx.textBaseline = 'alphabetic';
  ctx.fillRect(12 * dpr, H - 14 * dpr, bl, 3 * dpr); ctx.fillText(nice + ' µm', 12 * dpr, H - 20 * dpr);
  const tms = BEC.t / P.w * 1e3, cap = BEC.ground > 0 ? (BEC.rotIm ? 'settling while turning at 0.7 ω (imaginary time)…' : 'cooling into the ground state…') : (phase ? (BEC.d3 ? 'phase in the middle plane' : 'phase of ψ') : (side ? 'absorption picture from the side' : 'absorption picture from above'))
    + ` · ${fmtPrec(tms, 3)} ms` + (BEC.released ? ` · ${fmtPrec((BEC.t - BEC.tRel) / P.w * 1e3, 3)} ms of flight` : '');
  ctx.fillText(cap, 12 * dpr, 20 * dpr);
  if (!phase) { const t = `peak ${fmtNum(BEC.scale, 3)} atoms/µm²`; ctx.fillText(t, W - 12 * dpr - ctx.measureText(t).width, 20 * dpr); }
}
/* Vortices: the phase winding round each little square where there is condensate (the flat grid, or the 3-D middle plane). */
function becVortices() {
  const g = BEC.g, { re, im } = g.b, n = g.n, k0 = BEC.d3 ? (g.nz >> 1) : 0; let pk = 0, cnt = 0, net = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const q = i + n * (j + n * k0), r = re[q] * re[q] + im[q] * im[q]; if (r > pk) pk = r; }
  const ph = (q) => Math.atan2(im[q], re[q]), wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  for (let j = 1; j < n - 2; j++) for (let i = 1; i < n - 2; i++) {
    const q = i + n * (j + n * k0), r = Math.max(re[q + 1] * re[q + 1] + im[q + 1] * im[q + 1], re[q + n] * re[q + n] + im[q + n] * im[q + n]);
    if (r < 0.04 * pk) continue;
    const a = ph(q), b = ph(q + 1), c = ph(q + 1 + n), d = ph(q + n), w = Math.round((wrap(b - a) + wrap(c - b) + wrap(d - c) + wrap(a - d)) / (2 * Math.PI));
    if (w) { cnt++; net += w; }
  }
  return { cnt, net };
}
function becInfo() {
  const el = $('becInfo'); if (!el || !BEC.g) return;
  const g = BEC.g, P = g.P;
  if (BEC.ground > 0) { el.innerHTML = `<p class="note">${BEC.rotIm ? 'Finding its lowest state while it turns' : 'Finding the cloud\'s lowest state'} (imaginary time)…</p>`; return; }
  const o = becObs(), N0 = o.norm * P.N, kT = BEC.tf * P.kTc;
  const v = becVortices(); BEC.vort = v.cnt;
  const beta = BEC.beta0, xi = o.peak > 0 && beta > 0 ? P.um / Math.sqrt(2 * beta * o.peak) : NaN;
  const pk3 = BEC.d3 ? o.peak * P.N / Math.pow(P.aho * 100, 3) : o.peak * P.N / (P.aho * P.aho * 1e4) / (Math.sqrt(Math.PI) * P.aho * 100 / Math.sqrt(P.lz));
  const muK = o.mu * BEC_HBAR * P.w / BEC_KB * 1e9, rms = Math.sqrt(Math.max(0, o.x2 / Math.max(1e-30, o.norm))) * P.um;
  const st = (k, val, t) => `<div${t ? ` title="${t}"` : ''}><dt>${k}</dt><dd>${val}</dd></div>`, nt = (x) => `<span class="nt">${x}</span>`;
  el.innerHTML = `<div class="nname"><b>${P.s.sym} — ${P.s.name}</b><span>${BEC.d3 ? '3-D trap' : 'flat trap (4 kHz across it)'}</span></div>
  <dl class="nstats">${st('Atoms', fmtNum(P.N - BEC.lost), BEC.released ? 'Still in the picture' : 'Thermal cloud and condensate together')}${st('Condensed', N0 >= 1 ? `${fmtNum(N0, 3)} (${Math.round(100 * N0 / P.N)}%)` : 'none', 'In the condensate (ψ); the rest is the thermal cloud')}
  ${st('Temperature', `${fmtPrec(kT / BEC_KB * 1e9, 3)} nK`)}${st(nt('T<sub>c</sub>'), `${fmtPrec(P.Tc * 1e9, 3)} nK`, 'Where the ideal gas in this trap condenses')}
  ${st('Chem. potential', N0 >= 1 && !BEC.released ? `${fmtPrec(muK, 3)} nK` : '—', 'Chemical potential: the energy an atom needs to join the condensate (k_B × this)')}
  ${st('Healing length', isFinite(xi) ? `${fmtPrec(xi, 2)} µm` : '—', 'ξ: the size of a vortex core')}
  ${st('Peak density', N0 >= 1 ? `${fmtSci(pk3, 2)} cm⁻³` : '—')}${st('Size (rms x)', N0 >= 1 ? `${fmtPrec(rms, 3)} µm` : '—')}
  ${st('Vortices', String(v.cnt), 'Phase windings counted' + (BEC.d3 ? ' in the middle plane' : ''))}${st(nt('L<sub>z</sub>') + ' per atom', N0 >= 1 ? `${Math.abs(o.Lz / Math.max(1e-30, o.norm)) < 1e-4 ? '0' : fmtPrec(o.Lz / Math.max(1e-30, o.norm), 3)} ħ` : '—', 'Angular momentum of the condensate, per atom')}
  ${st('Trap', `${BEC.f} Hz${P.ly > 1 ? ' × ' + P.ly * BEC.f + ' Hz' : ''}${BEC.d3 && P.lz !== 1 ? ' × ' + P.lz * BEC.f + ' Hz' : ''}`)}${st('Energy', N0 >= 1 ? `${fmtPrec(o.E * BEC_HBAR * P.w / BEC_KB * 1e9, 3)} nK` : '—', 'Gross–Pitaevskii energy per condensed atom (k_B × this)')}</dl>`
  + (!BEC.d3 && o.mu > 0.5 * P.lz ? `<p class="note">μ is not small next to the tight axis's ħω<sub>z</sub>: a real cloud this full would no longer be flat.</p>` : '')
  + (BEC.d3 && isFinite(xi) && xi / P.um < 1.2 * g.dx && !BEC.released ? `<p class="note">The grid (${fmtPrec(g.dx * P.um, 2)} µm) is coarser than the healing length here: vortex cores are only roughly drawn.</p>` : '');
  $('becMsg').textContent = BEC.msg || '';
}
function becFrame() {
  if (!BEC.open) return;
  BEC.frame++;
  try { becAdvance(); becDraw(); if (BEC.frame % 8 === 1) becInfo(); } catch (e) { BEC.paused = true; $('becMsg').textContent = 'The lab stopped: ' + (e && e.message); }
  BEC.raf = requestAnimationFrame(becFrame);
}
/* The window. */
function openBec() {
  if (!$('becModal').dataset.wired) becWire();
  BEC.wasRunning = !!UI.running; if (UI.running) setRunning(false);
  showModal('becModal'); BEC.open = true;
  if (!becOk()) { $('becMsg').textContent = 'The condensate lab needs the WebAssembly kernel, which has not loaded here.'; return; }
  if (!BEC.g) { BEC.d3 = !!W.d3; becButtons(); becReset(); }
  becSyncT(); cancelAnimationFrame(BEC.raf); BEC.raf = requestAnimationFrame(becFrame);
}
function becClose() { BEC.open = false; cancelAnimationFrame(BEC.raf); hideModal('becModal'); if (BEC.wasRunning) setRunning(true); }
function becButtons() {
  setSegValue('becSp', BEC.sp); setSegValue('becDim', BEC.d3 ? '3' : '2'); setSegValue('becShape', BEC.shape); setSegValue('becView', BEC.view);
  setSegValue('becLook', BEC.look); setSegValue('becSpeed', BEC.speed);
  $('becLook').hidden = !BEC.d3; for (const b of $('becShape').querySelectorAll('[data-v="flat"]')) b.hidden = !BEC.d3;
  for (const [id, on] of [['becSpin', BEC.rotIm > 0], ['becSplit', BEC.split], ['becRel', BEC.released], ['becPause', BEC.paused]]) $(id).setAttribute('aria-pressed', String(!!on));
  $('becRel').textContent = BEC.released ? 'Trap off' : 'Release'; $('becPause').textContent = BEC.paused ? 'Paused' : 'Pause';
  $('becN').value = String(BEC.N); $('becF').value = String(BEC.f);
}
function becWire() {
  $('becModal').dataset.wired = '1';
  $('becClose').onclick = becClose;
  const seg = (id, f) => { $(id).onclick = (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; f(b.dataset.v); becButtons(); }; };
  const redo = () => { BEC.hw = 0; BEC.scale = 0; becReset(); becSyncT(); };
  seg('becSp', (v) => { BEC.sp = v; redo(); });
  seg('becDim', (v) => { BEC.d3 = v === '3'; if (!BEC.d3 && BEC.shape === 'flat') BEC.shape = 'round'; redo(); });
  seg('becShape', (v) => { BEC.shape = v; redo(); });
  seg('becView', (v) => { BEC.view = v; BEC.scale = 0; });
  seg('becLook', (v) => { BEC.look = v; BEC.scale = 0; BEC.hw = 0; });
  seg('becSpeed', (v) => { BEC.speed = v; });
  $('becN').onchange = (e) => { BEC.N = +e.target.value; redo(); };
  $('becF').onchange = (e) => { BEC.f = +e.target.value; redo(); };
  $('becT').oninput = (e) => { BEC.evap = null; BEC.tf = +e.target.value / 100; becTLabel(); };
  $('becEvap').onclick = () => { if (BEC.released) return; if (BEC.tf < 0.5) { BEC.tf = 1.3; becSyncT(); } BEC.evap = { t0: BEC.t, from: BEC.tf, to: 0.05, dur: 120 }; BEC.msg = 'Evaporating: the hottest atoms are let out, the rest cool through T_c.'; };
  $('becQuench').onclick = () => { if (BEC.released) return; BEC.tf = 1.3; BEC.lastNorm = null; becScale(0); BEC.evap = { t0: BEC.t, from: 1.3, to: 0.05, dur: 6 }; BEC.msg = 'Quench: cooled through T_c fast; patches of condensate with their own phases meet, and some vortices stay (Kibble–Zurek).'; };
  $('becSpin').onclick = () => { becSpin(); becButtons(); };
  $('becSplit').onclick = () => { BEC.split = !BEC.split; BEC.msg = BEC.split ? 'A sheet of blue-detuned light rises through the middle and cuts the condensate in two. Release it to see them interfere.' : ''; becButtons(); };
  $('becRel').onclick = () => { becRelease(); becButtons(); };
  $('becVortex').onclick = () => { becImprint(); };
  $('becReset').onclick = () => { redo(); becButtons(); };
  $('becPause').onclick = () => { BEC.paused = !BEC.paused; becButtons(); };
  // the laser spoon: press and drag in the picture
  const cv = $('becCv'), pos = (e) => { const r = cv.getBoundingClientRect(), S = Math.min(r.width, r.height), ox = (r.width - S) / 2, oy = (r.height - S) / 2;
    return { x: ((e.clientX - r.left - ox) / S * 2 - 1) * BEC.hw, y: (1 - (e.clientY - r.top - oy) / S * 2) * BEC.hw }; }; // (the ±hw square, centred: as becDraw)
  cv.onpointerdown = (e) => { if (!BEC.g || BEC.ground > 0 || (BEC.d3 && BEC.look === 'side')) return; cv.setPointerCapture(e.pointerId); const p = pos(e); BEC.spoon = { x: p.x, y: p.y, a: 3 * Math.max(2, BEC.mu0 || 2) }; BEC.msg = 'A laser spoon: drag it through the condensate. Slowly the fluid flows round it without friction; fast, it sheds vortices.'; };
  cv.onpointermove = (e) => { if (!BEC.spoon) return; const p = pos(e); BEC.spoon.x = p.x; BEC.spoon.y = p.y; };
  cv.onpointerup = cv.onpointercancel = () => { BEC.spoon = null; };
  becButtons();
}
/* A little noise in ψ (1% in amplitude and phase, cell by cell): a real cloud is never perfectly symmetric, and a
   perfectly symmetric one on the grid could not break its symmetry to let vortices in. */
function becNoise(a = 0.01) {
  const g = BEC.g; if (!g) return; const { re, im } = g.b, n3 = g.n * g.n * g.nz;
  for (let i = 0; i < n3; i++) { const f = 1 + a * (becRnd() - 0.5) * 2, ph = a * (becRnd() - 0.5) * 2, u = re[i], v = im[i], c = Math.cos(ph) * f, s = Math.sin(ph) * f; re[i] = u * c - v * s; im[i] = u * s + v * c; }
}
/* Spin: the cloud brought to its lowest state in a frame turning at Ω = 0.7 ω (imaginary time with −ΩL_z, the kernel's
   alternating-direction kinetic step), from a scrambled phase so that vortices can form anywhere. That is where stirring
   leads in a real lab over about a second (Madison et al. 2000; the lab-frame stirring itself takes hundreds of trap
   periods to let the first vortices in); once settled, the cloud runs on in the lab frame and the lattice turns. */
function becSpin() {
  const g = BEC.g; if (!g || BEC.ground > 0 || BEC.released || BEC.frac < 1e-3) return;
  const P = g.P, { re, im } = g.b, n = g.n, nz = g.nz, h = n / 2, hz = nz / 2, nrm = becNorm(), sc = 1 / Math.sqrt(Math.max(1e-30, nrm));
  const waves = []; for (let w = 0; w < 16; w++) { const a = becRnd() * 2 * Math.PI, k = 0.3 + 1.2 * becRnd(); waves.push([k * Math.cos(a), k * Math.sin(a), becRnd() * 2 * Math.PI]); }
  for (let k = 0; k < nz; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i - h) * g.dx, y = (j - h) * g.dx, q = i + n * (j + n * k); let ph = 0; for (const [kx, ky, p0] of waves) ph += Math.sin(kx * x + ky * y + p0);
    const a = Math.hypot(re[q], im[q]) * sc; re[q] = a * Math.cos(1.5 * ph); im[q] = a * Math.sin(1.5 * ph);
  }
  void P; void hz;
  BEC.frac = Math.max(1e-3, becFrac(BEC.tf)); BEC.groundBeta = BEC.beta0 * BEC.frac; BEC.rotIm = BEC.rotOm;
  BEC.gStages = BEC.d3 ? [[0.03, 200], [0.03, 0]] : [[0.02, 450], [0.02, 0]]; BEC.ground = BEC.gStages[0][1]; BEC.kKey = ''; BEC.lastNorm = null;
  BEC.msg = 'Spinning: the cloud settles while turning at 0.7 ω. Vortices form, each with one quantum of circulation, and arrange in a triangular lattice. Then it runs on and the lattice turns with it.';
}
/* Time of flight: every potential off. */
function becRelease() { if (BEC.released || !BEC.g || BEC.ground > 0) return; BEC.released = true; BEC.split = false; BEC.bar = 0; BEC.spoon = null; BEC.tRel = BEC.t; BEC.evap = null; BEC.gamma = 0; BEC.mu0 = 0; BEC.kKey = ''; BEC.dt = becDt(BEC.g); BEC.msg = 'Trap off: the cloud falls and spreads (time of flight). The condensate spreads fastest along its narrow direction; the thermal cloud spreads round.'; }
/* A vortex printed into the condensate: a phase that winds once round the middle (phase imprinting), its core opened
   over the healing length. */
function becImprint() {
  const g = BEC.g; if (!g || BEC.ground > 0) return;
  const P = g.P, { re, im } = g.b, n = g.n, nz = g.nz, h = n / 2, o = becObs(), xi = o.peak > 0 && BEC.beta0 > 0 ? 1 / Math.sqrt(2 * BEC.beta0 * o.peak) : 0.5;
  const x0 = (becRnd() - 0.5) * 0.3, y0 = (becRnd() - 0.5) * 0.3;
  for (let k = 0; k < nz; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i - h) * g.dx - x0, y = (j - h) * g.dx - y0, r = Math.hypot(x, y), q = i + n * (j + n * k);
    const a = r > 0 ? Math.tanh(r / xi) : 0, c = r > 0 ? x / r : 1, s = r > 0 ? y / r : 0, u = re[q], v = im[q];
    re[q] = a * (u * c - v * s); im[q] = a * (u * s + v * c);
  }
  BEC.lastNorm = null; BEC.msg = 'A vortex printed in: the phase winds once round it, and the fluid circulates with a quantized ħ/m.';
  void P;
}
