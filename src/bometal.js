/* ------------------------------------------------------------------ bond orders for metals (Experimental, 1.25)
   Settings → Experimental → Metals → Many-body: a metal atom's bonding comes from how many neighbours it has, not from a
   pair potential. The second-moment tight-binding form (Finnis & Sinclair 1984; Cleri & Rosato 1993; the embedded-atom
   method's square-root case): each member atom i holds
     Eᵢ = Σⱼ A·e^(−p(r/r₀ − 1)) − √ρᵢ,   ρᵢ = Σⱼ ξ²·e^(−2q(r/r₀ − 1))
   (a repulsion between the ion cores, and the d/s band's energy, which grows as the square root of its width's second
   moment, the sum of the hoppings squared). One bond is worth more than its share of six or twelve, so a lone pair (a
   dimer) is short and strong, a surface atom holds more per neighbour than one inside, a vacancy costs less than a
   bond count says, and clusters, surfaces, melting and alloys come out of the one formula.
   Fitted per metal (mbParam) to its measured cohesive energy, nearest-neighbour distance, bulk modulus and vacancy
   formation energy on a close-packed lattice (12 neighbours), in closed form: the vacancy energy over the cohesive energy
   fixes q/p, the bulk modulus p·q, the cohesive energy ξ, equilibrium A. Neighbours count out to 1.15·r₀ and fade out
   by 1.35·r₀ (a quintic switch; before a close-packed lattice's second shell at 1.41·r₀), so a perfect lattice has
   exactly the fitted values. Unlike metals: r₀, p, q averaged, A and ξ geometric means.
   Members: neutral atoms the classic chemistry treats as metallic (setSize's isMetal: a metal, no stored bonds; not a
   quantum-bonds member). Their mD is 0 while this is on, so the kernels' metal pair keeps only its contact core
   (metalFI/metalV with no depth) and every other pair term (electron transfer, hot collisions) is as before. An ion is
   not a member: its electrons are not the metal's (kept in, a Cu⁺Cu⁻ pair held both the metal's bonding and the
   charges' pull, and at the short distances this model gives few-neighbour atoms, 2.2 Å, a lattice turned itself into
   ions and heated to 6,000 K); ion pairs keep the classic metallic pair, an ion and a member only the contact core.
   Energy books: totalEnergy adds mbPass(false); localPE and regionE add mbLocal(set), exact for any change to the set's
   atoms (their own embedding, their neighbours' embedding less what it is without the set, the pair repulsions touching
   the set); switching the setting books the difference at the same positions to the bath (mbSet). */
const MBO = { on: false, any: false, E: 0, bath: 0, n: 0, np: 0, par: new Map(), pp: new Map() };
const MB_ON = 1.15, MB_OFF = 1.35, MB_K = 0.02; // (the switch, in r₀; ε/ξ: the square root rounded off below ρ ≈ ε², so a lone atom's force stays smooth)
/* Measured values: [cohesive energy eV/atom, nearest-neighbour distance Å, bulk modulus GPa, vacancy formation energy eV
   (0: not measured; 0.33 of the cohesive energy, the measured metals' middle)]. Cohesive energies, distances and bulk moduli
   from Kittel (Introduction to Solid State Physics, 8th ed., tables 3.1, 1.3 and 3.3; actinides past Am from enthalpies of
   sublimation); vacancy energies from Ehrhart (Landolt–Börnstein III/25, 1991). Elements nothing has measured (Fr, Rf on)
   take their lighter homolog's values, their distance from the game's radius (mbData). */
const MB_DATA = {
  3: [1.63, 3.04, 11.6, 0.48], 4: [3.32, 2.23, 100.3, 1.0], 11: [1.113, 3.66, 6.8, 0.42], 12: [1.51, 3.20, 35.4, 0.79],
  13: [3.39, 2.86, 72.2, 0.67], 19: [0.934, 4.53, 3.2, 0.39], 20: [1.84, 3.95, 15.2, 0], 21: [3.90, 3.25, 43.5, 0],
  22: [4.85, 2.89, 105.1, 1.55], 23: [5.31, 2.62, 161.9, 2.1], 24: [4.10, 2.50, 190.1, 2.0], 25: [2.92, 2.24, 59.6, 0],
  26: [4.28, 2.48, 168.3, 1.6], 27: [4.39, 2.50, 191.4, 1.34], 28: [4.44, 2.49, 186.0, 1.79], 29: [3.49, 2.56, 137.0, 1.28],
  30: [1.35, 2.66, 59.8, 0.54], 31: [2.81, 2.44, 56.9, 0], 37: [0.852, 4.84, 3.1, 0.30], 38: [1.72, 4.30, 11.6, 0],
  39: [4.37, 3.55, 36.6, 0], 40: [6.25, 3.17, 83.3, 1.7], 41: [7.57, 2.86, 170.2, 2.65], 42: [6.82, 2.72, 272.5, 3.0],
  43: [6.85, 2.71, 297, 0], 44: [6.74, 2.65, 320.8, 0], 45: [5.75, 2.69, 270.4, 1.71], 46: [3.89, 2.75, 180.8, 1.5],
  47: [2.95, 2.89, 100.7, 1.11], 48: [1.16, 2.98, 46.7, 0.46], 49: [2.52, 3.25, 41.1, 0.55], 50: [3.14, 3.02, 58.2, 0.51],
  55: [0.804, 5.24, 2.0, 0.28], 56: [1.90, 4.35, 10.3, 0], 57: [4.47, 3.73, 24.3, 0], 58: [4.32, 3.65, 23.9, 0],
  59: [3.70, 3.63, 30.6, 0], 60: [3.40, 3.66, 32.7, 0], 61: [3.6, 3.62, 35, 0], 62: [2.14, 3.59, 29.4, 0],
  63: [1.86, 3.96, 14.7, 0], 64: [4.14, 3.58, 38.3, 0], 65: [4.05, 3.52, 39.9, 0], 66: [3.04, 3.51, 38.4, 0],
  67: [3.14, 3.49, 39.7, 0], 68: [3.29, 3.47, 41.1, 0], 69: [2.42, 3.54, 39.7, 0], 70: [1.60, 3.88, 13.3, 0],
  71: [4.43, 3.43, 41.1, 0], 72: [6.44, 3.13, 109, 0], 73: [8.10, 2.86, 200, 2.9], 74: [8.90, 2.74, 323.2, 3.67],
  75: [8.03, 2.74, 372, 0], 76: [8.17, 2.68, 418, 0], 77: [6.94, 2.71, 355, 1.97], 78: [5.84, 2.77, 278.3, 1.35],
  79: [3.81, 2.88, 173.2, 0.93], 80: [0.67, 3.01, 38.2, 0], 81: [1.88, 3.46, 35.9, 0], 82: [2.03, 3.50, 43.0, 0.58],
  83: [2.18, 3.07, 31.5, 0], 84: [1.50, 3.34, 26, 0], 88: [1.66, 4.46, 13, 0], 89: [4.25, 3.76, 25, 0],
  90: [6.20, 3.60, 54.3, 1.28], 91: [5.9, 3.21, 157, 0], 92: [5.55, 2.75, 98.7, 1.2], 93: [4.73, 2.62, 68, 0],
  94: [3.60, 3.10, 54, 0], 95: [2.73, 3.61, 30, 0], 96: [4.0, 3.50, 37, 0], 97: [3.2, 3.40, 35, 0], 98: [2.03, 3.39, 30, 0],
  99: [1.38, 3.7, 15, 0], 100: [1.35, 3.7, 15, 0], 101: [1.3, 3.7, 15, 0], 102: [1.3, 3.7, 15, 0], 103: [3.3, 3.4, 35, 0],
};
function mbData(Z) {
  let d = MB_DATA[Z];
  if (d) return d;
  const el = ELEMENTS[Z]; // (nothing measured: the homolog one period up, its distance scaled by the game's radii)
  for (let h = Z - 32; h > 0 && !d; h -= 32) d = MB_DATA[h];
  if (!d && (Z === 87 || Z === 119)) d = MB_DATA[55];
  if (!d && Z === 120) d = MB_DATA[88];
  if (!d) d = MB_DATA[29];
  const hZ = Object.keys(MB_DATA).find(k => MB_DATA[k] === d), he = ELEMENTS[+hZ];
  return [d[0], d[1] * (el && he ? el.rc / he.rc : 1), d[2], d[3]];
}
/* The fitted constants of one metal: { A, xi, p, q, r0, eps } (closed form, see above; ε = MB_K·ξ). */
function mbParam(Z) {
  let v = MBO.par.get(Z);
  if (v) return v;
  const [Ec, r0, Bg, Ev0] = mbData(Z), Ev = Ev0 || 0.33 * Ec, k2 = MB_K * MB_K;
  const S = Math.sqrt(12 + k2), S11 = Math.sqrt(11 + k2);
  // per unit ξ, with a = A/ξ = t/S at equilibrium (t = q/p): E₀ = 12t/S − (S − κ), Ev = 12(S − S11 − t/S)
  const ratio = (t) => 12 * (S - S11 - t / S) / (S - MB_K - 12 * t / S);
  let lo = 0.15, hi = 0.45; // (q/p kept to the range published fits have, 0.2–0.4: a ratio past it would make the band term barely decay)
  const target = Ev / Ec;
  if (ratio(lo) <= target) hi = lo; else if (ratio(hi) >= target) lo = hi;
  else for (let it = 0; it < 60; it++) { const m = 0.5 * (lo + hi); if (ratio(m) > target) lo = m; else hi = m; }
  const t = 0.5 * (lo + hi), xi = Ec / (S - MB_K - 12 * t / S), A = xi * t / S;
  // B = E_xx/(9Ω), Ω = r₀³/√2; E_xx/ξ = p²·[12t/S − t²(24/S − 144/S³)]
  const Om = r0 * r0 * r0 / Math.SQRT2, Bev = Bg / 160.2177, c = 12 * t / S - t * t * (24 / S - 144 / (S * S * S));
  const p = Math.sqrt(9 * Om * Bev / (xi * c)), q = t * p;
  v = { A, xi, p, q, r0, eps: MB_K * xi, Ec, Ev, B: Bg };
  MBO.par.set(Z, v);
  return v;
}
/* A pair's constants by element pair: [2A (both atoms' share of the repulsion), ξ², p/r₀, 2q/r₀, r₀, r_on, r_off] */
function mbPP(Za, Zb) {
  const key = Za < Zb ? Za * 128 + Zb : Zb * 128 + Za;
  let v = MBO.pp.get(key);
  if (!v) {
    const a = mbParam(Za), b = mbParam(Zb), r0 = 0.5 * (a.r0 + b.r0), p = 0.5 * (a.p + b.p), q = 0.5 * (a.q + b.q);
    v = new Float64Array([2 * Math.sqrt(a.A * b.A), a.xi * b.xi, p / r0, 2 * q / r0, r0, MB_ON * r0, MB_OFF * r0]);
    MBO.pp.set(key, v);
  }
  return v;
}
let MB_RMAX = 0; // (the farthest any pair reaches: for the searches around a set)
function mbRmax() { if (!MB_RMAX) for (const el of ELEMENTS) if (el && el.metal) MB_RMAX = Math.max(MB_RMAX, MB_OFF * mbParam(el.Z).r0); return MB_RMAX; }
/* the switch: 1 inside r_on, 0 past r_off, quintic between (value into _ms, slope into _msd) */
let _ms = 1, _msd = 0;
function mbSw(r, on, off) {
  if (r <= on) { _ms = 1; _msd = 0; return; }
  const w = off - on, t = (r - on) / w;
  _ms = 1 - t * t * t * (10 - t * (15 - 6 * t)); _msd = -30 * t * t * (1 - t) * (1 - t) / w;
}
/* Is slot i a member? (the kernels' metal pair has no depth for it: setSize) */
function mbIs(i) {
  return S.isMetal[i] === 1 && S.mD[i] === 0 && S.k[i] === NUC && S.ne[i] > 0 && S.dead[i] === 0 && S.fast[i] === 0 && S.rad[i] === 0 && !S.obj[i].bom;
}
/* the embedding energy and its slope: F(ρ) = −(√(ρ + ε²) − ε) */
const mbF = (rho, eps) => -(Math.sqrt(rho + eps * eps) - eps);
/* ---- the pass over every member: energy, and with forces true their forces (into S.fx …) and the step's stiffness */
const MBF = { m: new Int32Array(64), ty: new Int32Array(64), rho: new Float64Array(64), fd: new Float64Array(64), // (rho, fd: by cell order)
  cell: new Int32Array(64), ord: new Int32Array(64), start: new Int32Array(64), fill: new Int32Array(64),
  pa: new Int32Array(256), pb: new Int32Array(256), pux: new Float64Array(256), puy: new Float64Array(256), puz: new Float64Array(256),
  pvr: new Float64Array(256), pdr: new Float64Array(256), pk: new Float64Array(256), prr: new Float64Array(256),
  zt: new Int32Array(Z_MAX + 2), tz: [], pt: new Float64Array(64), eps: new Float64Array(8),
  sx: new Float64Array(64), sy: new Float64Array(64), sz: new Float64Array(64), ss: new Int32Array(64), st: new Int32Array(64), sa: new Int32Array(64), nb: new Int32Array(27) };
function mbGrowM(n) {
  if (MBF.m.length >= n) return;
  const N = n * 2 + 64;
  for (const k of ['m', 'ty', 'cell', 'ord']) MBF[k] = new Int32Array(N);
}
function mbGrowP(n) {
  if (MBF.pa.length >= n) return;
  const N = n * 2 + 256, g = (a, T) => { const b = new T(N); b.set(a); return b; };
  MBF.pa = g(MBF.pa, Int32Array); MBF.pb = g(MBF.pb, Int32Array);
  for (const k of ['pux', 'puy', 'puz', 'pvr', 'pdr', 'pk', 'prr']) MBF[k] = g(MBF[k], Float64Array);
}
/* the members' elements as types 0 … nt−1 and their pair table (stride 8: 2A, ξ², p/r₀, 2q/r₀, r₀, r_on, r_off, r_off²) */
function mbTypes(nm) {
  const m = MBF.m, ty = MBF.ty, zt = MBF.zt, tz = MBF.tz, ZZ = S.Z;
  for (const z of tz) zt[z] = 0;
  tz.length = 0;
  for (let a = 0; a < nm; a++) { const z = ZZ[m[a]]; if (!zt[z]) { tz.push(z); zt[z] = tz.length; } ty[a] = zt[z] - 1; }
  const nt = tz.length;
  if (MBF.pt.length < nt * nt * 8) MBF.pt = new Float64Array(nt * nt * 16);
  if (MBF.eps.length < nt) MBF.eps = new Float64Array(nt * 2);
  let cs = 0;
  for (let u = 0; u < nt; u++) {
    MBF.eps[u] = mbParam(tz[u]).eps; if (!u) MBO.r0max = 0; MBO.r0max = Math.max(MBO.r0max, mbParam(tz[u]).r0);
    for (let v = 0; v < nt; v++) { const P = mbPP(tz[u], tz[v]), o = (u * nt + v) * 8; for (let k = 0; k < 7; k++) MBF.pt[o + k] = P[k]; MBF.pt[o + 7] = P[6] * P[6]; if (P[6] > cs) cs = P[6]; }
  }
  return cs;
}
function mbPass(forces) {
  if (!MBO.on) { MBO.any = false; MBO.E = 0; return 0; }
  // the members: from the force pass's MD list, or from every particle (totalEnergy)
  let nm = 0;
  if (forces) { mbGrowM(_nmd); for (let q = 0; q < _nmd; q++) { const i = _mdI[q]; if (mbIs(i)) MBF.m[nm++] = i; } }
  else { mbGrowM(W.parts.length); for (const p of W.parts) if (!p.dead && mbIs(p.i)) MBF.m[nm++] = p.i; }
  MBO.n = nm; MBO.any = nm > 0;
  if (nm === 0) { MBO.E = 0; MBO.np = 0; return 0; }
  const m = MBF.m, ty = MBF.ty, X = S.x, Y = S.y, Zp = S.z, AN = S.anti, d3 = W.d3, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = W.box.d, hw = bw / 2, hh = bh / 2, hd = bd / 2;
  // cells at least the farthest reach wide (a counting sort of the members by cell)
  let cs = mbTypes(nm);
  const PT = MBF.pt, nt = MBF.tz.length, cut2 = cs * cs;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  if (wrap) { x0 = -hw; x1 = hw; y0 = -hh; y1 = hh; z0 = -hd; z1 = hd; }
  else for (let a = 0; a < nm; a++) { const i = m[a]; const x = X[i], y = Y[i], z = d3 ? Zp[i] : 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  let nx, ny, nz;
  for (;;) {
    nx = Math.max(1, Math.floor((x1 - x0) / cs) + (wrap ? 0 : 1)); ny = Math.max(1, Math.floor((y1 - y0) / cs) + (wrap ? 0 : 1)); nz = d3 ? Math.max(1, Math.floor((z1 - z0) / cs) + (wrap ? 0 : 1)) : 1;
    if (nx * ny * nz <= 4 * nm + 64) break;
    cs *= 1.5; // (a few members far apart: wider cells, the same pairs)
  }
  const cwx = wrap ? bw / nx : cs, cwy = wrap ? bh / ny : cs, cwz = wrap && d3 ? bd / nz : cs, nc = nx * ny * nz;
  if (MBF.start.length < nc + 1) MBF.start = new Int32Array(nc * 2 + 64);
  const cell = MBF.cell, ord = MBF.ord, start = MBF.start;
  start.fill(0, 0, nc + 1);
  for (let a = 0; a < nm; a++) {
    const i = m[a];
    let cx = Math.floor((X[i] - x0) / cwx), cy = Math.floor((Y[i] - y0) / cwy), cz = d3 ? Math.floor((Zp[i] - z0) / cwz) : 0;
    cx = cx < 0 ? 0 : cx >= nx ? nx - 1 : cx; cy = cy < 0 ? 0 : cy >= ny ? ny - 1 : cy; cz = cz < 0 ? 0 : cz >= nz ? nz - 1 : cz;
    const c = (cz * ny + cy) * nx + cx; cell[a] = c; start[c + 1]++;
  }
  for (let c = 0; c < nc; c++) start[c + 1] += start[c];
  if (MBF.fill.length < nc) MBF.fill = new Int32Array(nc * 2 + 64);
  const fill = MBF.fill; fill.set(start.subarray(0, nc));
  for (let a = 0; a < nm; a++) ord[fill[cell[a]]++] = a;
  // the members in cell order, positions and types side by side (the pair loop then reads memory in order)
  if (MBF.sx.length < nm) { for (const k of ['sx', 'sy', 'sz', 'rho', 'fd']) MBF[k] = new Float64Array(nm * 2 + 64); for (const k of ['ss', 'st', 'sa']) MBF[k] = new Int32Array(nm * 2 + 64); }
  const SX = MBF.sx, SY = MBF.sy, SZ = MBF.sz, SS = MBF.ss, STY = MBF.st, SA = MBF.sa;
  for (let s = 0; s < nm; s++) { const a = ord[s], i = m[a]; SX[s] = X[i]; SY[s] = Y[i]; SZ[s] = d3 ? Zp[i] : 0; SS[s] = i; STY[s] = ty[a] * nt; SA[s] = AN[i]; }
  // pairs: each cell against itself (the later member only) and its neighbouring cells of higher number, each once
  const rho = MBF.rho; rho.fill(0, 0, nm);
  let np = 0, Erep = 0;
  if (forces) mbGrowP(nm * (d3 ? 24 : 10) + 64);
  let PA = MBF.pa, PB = MBF.pb, UX = MBF.pux, UY = MBF.puy, UZ = MBF.puz, VR = MBF.pvr, DR = MBF.pdr, PK = MBF.pk, RR = MBF.prr, cap = PA.length;
  const nb = MBF.nb;
  for (let c = 0; c < nc; c++) {
    const s0 = start[c], s1 = start[c + 1];
    if (s0 === s1) continue;
    const cx = c % nx, cy = Math.floor(c / nx) % ny, cz = Math.floor(c / (nx * ny));
    let nn = 0;
    for (let dzc = d3 ? -1 : 0; dzc <= (d3 ? 1 : 0); dzc++) {
      let kz = cz + dzc; if (kz < 0 || kz >= nz) { if (!wrap) continue; kz = (kz + nz) % nz; }
      for (let dyc = -1; dyc <= 1; dyc++) {
        let ky = cy + dyc; if (ky < 0 || ky >= ny) { if (!wrap) continue; ky = (ky + ny) % ny; }
        for (let dxc = -1; dxc <= 1; dxc++) {
          let kx = cx + dxc; if (kx < 0 || kx >= nx) { if (!wrap) continue; kx = (kx + nx) % nx; }
          const k = (kz * ny + ky) * nx + kx;
          if (k < c) continue;
          let dup = false; for (let u = 0; u < nn; u++) if (nb[u] === k) { dup = true; break; } // (a box two cells wide: −1 and +1 are one cell)
          if (!dup) nb[nn++] = k;
        }
      }
    }
    for (let s = s0; s < s1; s++) {
      const xi = SX[s], yi = SY[s], zi = SZ[s], tro = STY[s], ai = SA[s];
      for (let u = 0; u < nn; u++) {
        const k = nb[u], e = start[k + 1];
        for (let t = k === c ? s + 1 : start[k]; t < e; t++) {
          let dx = SX[t] - xi, dy = SY[t] - yi, dz = SZ[t] - zi;
          if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (d3) { if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; } }
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 >= cut2) continue;
          const o = (tro + STY[t] / nt) * 8;
          if (r2 >= PT[o + 7] || r2 < 1e-12 || SA[t] !== ai) continue; // (matter and antimatter: the kernel's annihilation pair)
          const r = Math.sqrt(r2), r0 = PT[o + 4], on = PT[o + 5];
          let sw = 1, swd = 0;
          if (r > on) { const w = PT[o + 6] - on, q = (r - on) / w; sw = 1 - q * q * q * (10 - q * (15 - 6 * q)); swd = -30 * q * q * (1 - q) * (1 - q) / w; }
          const pr = PT[o + 2], qr = PT[o + 3], er = PT[o] * Math.exp(pr * (r0 - r)), ed = PT[o + 1] * Math.exp(qr * (r0 - r));
          Erep += er * sw; rho[s] += ed * sw; rho[t] += ed * sw;
          if (forces) {
            if (np >= cap) { mbGrowP(np + 1); PA = MBF.pa; PB = MBF.pb; UX = MBF.pux; UY = MBF.puy; UZ = MBF.puz; VR = MBF.pvr; DR = MBF.pdr; PK = MBF.pk; RR = MBF.prr; cap = PA.length; }
            const ir = 1 / r;
            PA[np] = s; PB[np] = t; UX[np] = dx * ir; UY[np] = dy * ir; UZ[np] = dz * ir;
            VR[np] = er * (swd - pr * sw); DR[np] = ed * (swd - qr * sw); // (the slopes of the repulsion and of the pair's density)
            PK[np] = er * pr * pr * sw; RR[np] = ed * qr * qr * sw; // (their curvatures, for the step's stiffness)
          }
          np++;
        }
      }
    }
  }
  let Eemb = 0;
  const fd = MBF.fd, EPS = MBF.eps;
  for (let s = 0; s < nm; s++) { const eps = EPS[STY[s] / nt], sq = Math.sqrt(rho[s] + eps * eps); Eemb -= sq - eps; fd[s] = -0.5 / sq; }
  MBO.np = np; MBO.E = Erep + Eemb;
  if (forces) {
    const FX = S.fx, FY = S.fy, FZ = S.fz, IM = S.im;
    let st = 0;
    for (let k = 0; k < np; k++) {
      const a = PA[k], b = PB[k], i = SS[a], j = SS[b], fsum = fd[a] + fd[b];
      const g = -(VR[k] + fsum * DR[k]); // (−dE/dr)
      const fx = g * UX[k], fy = g * UY[k];
      FX[j] += fx; FY[j] += fy; FX[i] -= fx; FY[i] -= fy;
      if (d3) { const fz = g * UZ[k]; FZ[j] += fz; FZ[i] -= fz; }
      const kk = PK[k] + fsum * RR[k]; // (the pair's own curvature: the repulsion's less the band's)
      if (kk > 0) { const w = kk * (IM[i] + IM[j]); if (w > st) st = w; }
    }
    if (st > _stiff) _stiff = st;
  }
  return MBO.E;
}
/* The many-body energy a change to the atoms in set can alter (for localPE and regionE): the members of set T keep their
   embedding F(ρ), the other members N within reach of them F(ρ) − F(ρ without T) (what T adds to theirs), and every
   repulsion touching T. The rest of the total does not depend on T's atoms, so a before/after difference is exact, even
   when an atom of T stops or starts being a member, or moves out of reach. */
function mbLocal(set) {
  if (!MBO.on) return 0;
  const T = [];
  for (const p of set) if (!p.dead && p.k === NUC && mbIs(p.i)) T.push(p);
  if (!T.length) return 0;
  const R = mbRmax(), d3 = W.d3, inT = new Set(T), near = new Map(); // (member → its density from T's atoms)
  const around = (p, cb) => { // (members within R of p, as nearby() and the atoms made since the grid was built)
    const seen = new Set();
    const v = (o, dx, dy, r2, dz) => { if (o === p || seen.has(o) || o.dead || o.k !== NUC || !mbIs(o.i) || o.anti !== p.anti) return; seen.add(o); cb(o, Math.sqrt(r2)); };
    nearby(p.x, p.y, R, v, p.z);
    for (const o of _late) { if (o.dead) continue; const [dx, dy, dz] = minImg(o.x - p.x, o.y - p.y, d3 ? o.z - p.z : 0), r2 = dx * dx + dy * dy + dz * dz; if (r2 <= R * R) v(o, dx, dy, r2, dz); }
  };
  let E = 0;
  for (const p of T) {
    let rho = 0;
    around(p, (o, r) => {
      const P = mbPP(p.Z, o.Z); if (r >= P[6]) return;
      const x = r / P[4] - 1; mbSw(r, P[5], P[6]);
      const ed = P[1] * Math.exp(-P[3] * P[4] * x) * _ms;
      rho += ed;
      if (!inT.has(o)) { E += P[0] * Math.exp(-P[2] * P[4] * x) * _ms; near.set(o, (near.get(o) || 0) + ed); }
      else if (p.id < o.id) E += P[0] * Math.exp(-P[2] * P[4] * x) * _ms;
    });
    E += mbF(rho, mbParam(p.Z).eps);
  }
  for (const [o, dT] of near) {
    let rho = 0;
    around(o, (u, r) => { const P = mbPP(o.Z, u.Z); if (r >= P[6]) return; mbSw(r, P[5], P[6]); rho += P[1] * Math.exp(-P[3] * P[4] * (r / P[4] - 1)) * _ms; });
    const eps = mbParam(o.Z).eps;
    E += mbF(rho, eps) - mbF(Math.max(0, rho - dT), eps);
  }
  return E;
}
/* A lower bound on the many-body energy an electron's move from d to acc costs (for evTransfer's quick estimate, which
   otherwise sends nearly every pair of neighbours in a metal to the exact trial): the members it makes ions lose their
   own embedding and gain back the repulsions they had; their neighbours' embedding only rises as they go (F falls with
   ρ). 0 when the move makes an atom a member (it would gain). */
function mbXferLB(d, acc) {
  const joins = (p, dq) => p.el && p.el.metal && !p.bonds.length && p.q + dq === 0;
  if (joins(d, 1) || joins(acc, -1)) return 0;
  const L = [d, acc].filter(p => p.k === NUC && !p.dead && mbIs(p.i));
  if (!L.length) return 0;
  let E = 0;
  for (const p of L) {
    const R = MB_OFF * Math.max(mbParam(p.Z).r0, MBO.r0max || 0); // (the members' widest reach at the last pass: an estimate needs no more)
    let rho = 0;
    nearby(p.x, p.y, R, (o, dx, dy, r2) => {
      if (o === p || o.dead || o.k !== NUC || o.anti !== p.anti || !mbIs(o.i)) return;
      const P = mbPP(p.Z, o.Z), r = Math.sqrt(r2); if (r >= P[6]) return;
      mbSw(r, P[5], P[6]);
      rho += P[1] * Math.exp(P[3] * (P[4] - r)) * _ms;
      if (!(L.length === 2 && o === (p === d ? acc : d) && p === acc)) E -= P[0] * Math.exp(P[2] * (P[4] - r)) * _ms; // (the pair of the two counted once)
    }, p.z);
    E -= mbF(rho, mbParam(p.Z).eps);
  }
  return E;
}
/* The setting (on or off): members' mD follows it (setSize), and the change of energy at the same positions goes to the
   bath, as for the bond orders. */
function mbSet(v) {
  const on = !!v;
  if (on === MBO.on) return;
  const mets = new Set(); for (const p of W.parts) if (!p.dead && p.k === NUC && p.el && p.el.metal && p.ne > 0) mets.add(p);
  const Eb = mets.size ? localPE(mets) : 0;
  MBO.on = on;
  for (const p of mets) setSize(p);
  W.dirty++; vlInvalidate();
  if (mets.size) { const Ea = localPE(mets); W.ledger.bath += Eb - Ea; MBO.bath += Eb - Ea; }
  MBO.any = on && [...mets].some(p => mbIs(p.i));
}
