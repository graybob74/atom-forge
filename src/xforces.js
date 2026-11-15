/* ---- Experimental forces (1.34: the owner's items 89–91, 93–95; "Can you add all of these (if it's not already in the
   game)", after asking which forces are not fully simulated) -------------------------------------------------------
   XF holds what is on; each part is its own switch in Settings → Experimental → Forces, all off as normal.
   - Gravity (91): Newton's attraction between every pair of masses, U = −G·m₁m₂/r with the real G (1.149·10⁻³⁵
     eV·Å/u²: 10⁻³⁶ of the Coulomb force between two protons), and, as a choice, the Earth's pull down the screen
     (9.807 m/s²). Real values move nothing you could see; a strength ×10ⁿ (marked as boosted) makes it show.
   - Radiation from accelerating charges (90): a charge accelerated by the forces on it or turned by a magnetic field
     radiates (Larmor's P = ⅔·kq²a²/c³; Liénard's γ⁴ when it is fast and turned), the energy taken from its motion
     (radiation reaction, along its velocity) and given off as photons along its way at the characteristic energy
     (ħω·(3/2)γ³, ω its turning rate), at least 1 eV each; what is radiated and not yet given off is counted.
   - Magnetic fields of moving charges (89a, the flat game): every charged particle that moves makes a field
     (Biot–Savart, B = (μ₀/4π)·q v×r̂/r², out of the plane), felt by every other moving charge through the same Boris
     turn as an applied field, so it does no work: two parallel beams pull together, opposite ones push apart.
   - Atomic magnetic moments (89b): each atom with unpaired electrons carries a moment (iron 2.22 μB, cobalt 1.72,
     nickel 0.61, gadolinium 7.63, others one μB per unpaired electron) as a classical spin that precesses in the field it
     feels (an applied field, magnets, and its neighbours' dipole fields within 10 Å), damped toward it by the heat
     bath with thermal noise (Gilbert α 0.1; the energy that goes either way booked to the bath); the atoms feel the
     forces of the moments on each other and of the applied field's gradient on them. It replaces the fitted pull
     on magnetic matter (magU) for the atoms that carry a spin.
   - Exchange (89c, with 89b): neighbouring iron, cobalt, nickel and gadolinium moments line up, U = −J(r)·ŝᵢ·ŝⱼ, J
     from each metal's Curie temperature by the classical Heisenberg model's (kT_c = 2.05 J for iron's lattice, 3.18 J for
     cobalt's, nickel's and gadolinium's close-packed ones: J = 0.044, 0.038, 0.017, 0.008 eV), whole out to 1.05 times
     the nearest-neighbour distance and tapering to nothing at 1.25 times it.
   Energies are counted in totalEnergy() (xfEnergy) and every force is that energy's gradient. */
const XF = { nucl: false, grav: 0, gk: 0, rad: false, bi: false, spin: false, exch: false, nu: 0, lrq: false, disp: false, any: false, pend: new Set(), nBi: 0, biWas: false, emitted: 0, ePh: 0 };
const XF_G = 1.1487e-35, XF_KBS = 0.0157366, XF_KD = 5.3694e-5, XF_AL = 0.1, XF_RD = 10;
function xfSync() { XF.any = XF.grav > 0 || XF.spin || XF.lrq || XF.disp; }
function xfMD(p) { return !p.dead && !p.rad && !p.fast && !(p.k === NUC && p.Z === 0) && p.i !== undefined && p.i >= 0; }
/* ---- gravity */
function xfG() { return XF_G * Math.pow(10, XF.gk); }
function xfGEarth() { return 9.80665e10 * PHYS.TU_S * PHYS.TU_S * Math.pow(10, XF.gk); } // (Å/tu²)
/* Pairs over flat arrays (the nearest image with wrapping walls): fn(i, j, dx, dy, dz, r2) for every pair i < j. */
function xfPairs(ps, fn, R2) {
  const n = ps.length, X = new Float64Array(n), Y = new Float64Array(n), Zs = new Float64Array(n), d3 = W.d3, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = W.box.d || 0;
  for (let i = 0; i < n; i++) { X[i] = ps[i].x; Y[i] = ps[i].y; Zs[i] = d3 ? ps[i].z : 0; }
  for (let i = 0; i < n; i++) { const xi = X[i], yi = Y[i], zi = Zs[i];
    for (let j = i + 1; j < n; j++) {
      let dx = X[j] - xi, dy = Y[j] - yi, dz = Zs[j] - zi;
      if (wrap) { if (dx > bw / 2) dx -= bw; else if (dx < -bw / 2) dx += bw; if (dy > bh / 2) dy -= bh; else if (dy < -bh / 2) dy += bh; if (d3) { if (dz > bd / 2) dz -= bd; else if (dz < -bd / 2) dz += bd; } }
      const r2 = dx * dx + dy * dy + dz * dz; if (r2 < R2) fn(i, j, dx, dy, dz, r2);
    } }
}
function xfGrav(FX, FY, FZ, eOnly) {
  const ps = W.parts.filter(xfMD), n = ps.length, G = xfG(), Rc = n > 3000 ? 40 : Infinity, iRc = Rc < Infinity ? 1 / Rc : 0, M = ps.map(p => p.m), I = ps.map(p => p.i), d3 = W.d3;
  let U = 0;
  xfPairs(ps, (i, j, dx, dy, dz, r2) => {
    if (r2 < 1e-6) return;
    const r = Math.sqrt(r2), gm = G * M[i] * M[j]; U -= gm * (1 / r - iRc);
    if (eOnly) return;
    const f = gm / (r2 * r), a = I[i], b = I[j]; FX[a] += f * dx; FY[a] += f * dy; FX[b] -= f * dx; FY[b] -= f * dy; if (FZ && d3) { FZ[a] += f * dz; FZ[b] -= f * dz; }
  }, Rc * Rc);
  if (XF.grav === 2 && W.wall !== 'wrap') { const g = xfGEarth(), y0 = -W.box.h / 2; for (const p of ps) { U += p.m * g * (p.y - y0); if (!eOnly) FY[p.i] -= p.m * g; } }
  return U;
}
/* ---- atomic moments and exchange */
const XF_EXJ = { 26: 0.0438, 27: 0.0376, 28: 0.017, 64: 0.0079 }, XF_DNN = { 26: 2.48, 27: 2.5, 28: 2.49, 64: 3.57 };
function xfMu(p) { const fe = FERRO[p.Z]; if (fe) return fe[1]; const n = unpairedOf(p); return n > 0 ? n : 0; }
function xfSpins() { // the atoms carrying a moment, a spin given to any new one (a random direction, seeded)
  const out = [];
  for (const p of W.parts) {
    if (!xfMD(p) || p.k !== NUC || !(p.ne > 0)) { if (p._sp) p._sp = null; continue; }
    const mu = xfMu(p); if (!(mu > 0)) { p._sp = null; continue; }
    if (!p._sp) { const u = rndDir(); let x = u[0], y = u[1], z = u[2]; if (!W.d3) { z = 2 * rnd() - 1; const s = Math.sqrt(1 - z * z); x *= s; y *= s; } p._sp = [x, y, z]; }
    p._mu = mu; out.push(p);
  }
  return out;
}
function xfJ(a, b, r) { // exchange (eV) between two moments at r, and its slope: whole to 1.05 nearest-neighbour distances, none past 1.25
  const Ja = XF_EXJ[a.Z], Jb = XF_EXJ[b.Z]; if (!Ja || !Jb) return [0, 0];
  const J0 = Math.sqrt(Ja * Jb), d = 0.5 * (XF_DNN[a.Z] + XF_DNN[b.Z]), r1 = 1.05 * d, r2 = 1.25 * d;
  if (r <= r1) return [J0, 0]; if (r >= r2) return [0, 0];
  const t = (r - r1) / (r2 - r1), c = Math.cos(0.5 * Math.PI * t); return [J0 * c * c, -J0 * Math.PI * c * Math.sin(0.5 * Math.PI * t) / (r2 - r1)];
}
const XF_AX = { x: 0, y: 1, z: 2 };
function xfBext(x, y, z, p) { const B = W.d3 ? Bfield3(x, y, z) : Bfield(x, y, p); const o = [0, 0, 0]; o[W.d3 ? XF_AX[W.Bax3] || 2 : 2] = B; return o; }
/* The spins' pairs within 10 Å: U = ŝa·A·ŝb, A = K·w(r)/r³·(1 − 3r̂r̂) − J(r)·1 (dipole–dipole tapered to nothing over
   its last 2 Å, and exchange). With forces (FX): every pair's pull on the two atoms, −∂U/∂(place). */
function xfSpinPairs(sp, FX, FY, FZ) {
  const pairs = []; let U = 0; const n = sp.length;
  for (let i = 0; i < n; i++) {
    const a = sp[i], sa = a._sp;
    for (let j = i + 1; j < n; j++) {
      const b = sp[j], [dx, dy, dz] = minImg(b.x - a.x, b.y - a.y, (b.z || 0) - (a.z || 0)), r2 = dx * dx + dy * dy + dz * dz;
      if (r2 >= XF_RD * XF_RD || r2 < 0.25) continue;
      const r = Math.sqrt(r2), u = [dx / r, dy / r, dz / r], sb = b._sp, r3 = r2 * r;
      const K = XF_KD * a._mu * b._mu, x = r - (XF_RD - 2), w = x <= 0 ? 1 : 0.5 * (1 + Math.cos(Math.PI * x / 2)), dw = x <= 0 ? 0 : -0.25 * Math.PI * Math.sin(Math.PI * x / 2);
      const [J, dJ] = XF.exch ? xfJ(a, b, r) : [0, 0], c = K * w / r3;
      pairs.push({ a, b, c, u, J });
      const ss = sa[0] * sb[0] + sa[1] * sb[1] + sa[2] * sb[2], ar = sa[0] * u[0] + sa[1] * u[1] + sa[2] * u[2], br = sb[0] * u[0] + sb[1] * u[1] + sb[2] * u[2], g = ss - 3 * ar * br;
      U += c * g - J * ss;
      if (!FX) continue;
      const dUdr = K * g * (dw / r3 - 3 * w / (r3 * r)) - dJ * ss; // (along r̂, at fixed r̂)
      const gx = -3 * (ar * sb[0] + br * sa[0]), gy = -3 * (ar * sb[1] + br * sa[1]), gz = -3 * (ar * sb[2] + br * sa[2]), gr = gx * u[0] + gy * u[1] + gz * u[2], k = c / r;
      const fx = dUdr * u[0] + k * (gx - gr * u[0]), fy = dUdr * u[1] + k * (gy - gr * u[1]), fz = dUdr * u[2] + k * (gz - gr * u[2]); // ∂U/∂(b's place) = −∂U/∂(a's)
      FX[a.i] += fx; FY[a.i] += fy; FX[b.i] -= fx; FY[b.i] -= fy; if (FZ && W.d3) { FZ[a.i] += fz; FZ[b.i] -= fz; }
    }
  }
  return { pairs, U };
}
function xfSpinPass(FX, FY, FZ) { // the spins' energy (and, with FX, their forces)
  const sp = xfSpins(), MB = PHYS.MU_B; let U = 0;
  for (const p of sp) {
    const z = p.z || 0, B = xfBext(p.x, p.y, z, p), m = p._mu * MB, s = p._sp, d0 = s[0] * B[0] + s[1] * B[1] + s[2] * B[2]; U -= m * d0;
    if (FX && d0 !== 0 && (W.magnets.length || W.zones.length)) { // (a field that changes from place to place pulls the moment: F = ∇(m·B))
      const e = 0.02, dot = (q) => s[0] * q[0] + s[1] * q[1] + s[2] * q[2];
      FX[p.i] += m * (dot(xfBext(p.x + e, p.y, z, p)) - dot(xfBext(p.x - e, p.y, z, p))) / (2 * e);
      FY[p.i] += m * (dot(xfBext(p.x, p.y + e, z, p)) - dot(xfBext(p.x, p.y - e, z, p))) / (2 * e);
      if (FZ && W.d3) FZ[p.i] += m * (dot(xfBext(p.x, p.y, z + e, p)) - dot(xfBext(p.x, p.y, z - e, p))) / (2 * e);
    }
  }
  return U + xfSpinPairs(sp, FX, FY, FZ).U;
}
/* A step for the spins, atoms held where they are: each spin turned in turn about the field it feels now (precession:
   ŝ·h is kept, and since no spin's field depends on itself the energy is kept exactly), in substeps of at most 0.2 rad;
   with the heat bath on, then drawn toward its field with thermal noise (Gilbert damping α and Brown's field, which
   together hold a Boltzmann spread at the bath's temperature), that energy booked to the bath. */
function xfSpinStep(dt) {
  const sp = xfSpins(); if (!sp.length) return;
  const HB = 6.582119569e-16 / PHYS.TU_S, MB = PHYS.MU_B, { pairs } = xfSpinPairs(sp, null);
  const nb = new Map(); for (const p of sp) nb.set(p, []);
  for (const q of pairs) { nb.get(q.a).push(q); nb.get(q.b).push(q); }
  for (const p of sp) { const B = xfBext(p.x, p.y, p.z || 0, p), m = p._mu * MB; p._hx = [m * B[0], m * B[1], m * B[2]]; }
  const field = (p, h) => { h[0] = p._hx[0]; h[1] = p._hx[1]; h[2] = p._hx[2];
    for (const q of nb.get(p)) { const o = q.a === p ? q.b._sp : q.a._sp, u = q.u, ou = o[0] * u[0] + o[1] * u[1] + o[2] * u[2];
      for (let k = 0; k < 3; k++) h[k] -= q.c * (o[k] - 3 * u[k] * ou) - q.J * o[k]; } return h; };
  const h = [0, 0, 0]; let omx = 0;
  for (const p of sp) { field(p, h); omx = Math.max(omx, Math.hypot(h[0], h[1], h[2]) / (0.5 * p._mu * HB)); }
  const ns = Math.min(64, Math.max(1, Math.ceil(omx * dt / 0.2))), ds = dt / ns;
  const U0 = W.gamma > 0 ? xfSpinPass(null) : 0;
  for (let it = 0; it < ns; it++) for (const p of sp) {
    field(p, h); const hm = Math.hypot(h[0], h[1], h[2]); if (!(hm > 0)) continue;
    const s = p._sp, hx = h[0] / hm, hy = h[1] / hm, hz = h[2] / hm, th = -hm / (0.5 * p._mu * HB) * ds, c = Math.cos(th), sn = Math.sin(th), d = s[0] * hx + s[1] * hy + s[2] * hz;
    const x = s[0] * c + (hy * s[2] - hz * s[1]) * sn + hx * d * (1 - c), y = s[1] * c + (hz * s[0] - hx * s[2]) * sn + hy * d * (1 - c), z = s[2] * c + (hx * s[1] - hy * s[0]) * sn + hz * d * (1 - c);
    const l = Math.hypot(x, y, z) || 1; s[0] = x / l; s[1] = y / l; s[2] = z / l;
  }
  if (W.gamma > 0) {
    for (const p of sp) {
      field(p, h); const hm = Math.hypot(h[0], h[1], h[2]), Sh = 0.5 * p._mu * HB, s = p._sp;
      let x = s[0], y = s[1], z = s[2];
      if (hm > 0) { const k = Math.min(0.5, XF_AL * hm / Sh * dt), hx = h[0] / hm, hy = h[1] / hm, hz = h[2] / hm, dd = x * hx + y * hy + z * hz; x += k * (hx - dd * x); y += k * (hy - dd * y); z += k * (hz - dd * z); }
      const sig = Math.min(0.5, Math.sqrt(2 * XF_AL * PHYS.KB * Math.max(W.T, 0) * dt / Sh));
      x += sig * gauss(); y += sig * gauss(); z += sig * gauss();
      const l = Math.hypot(x, y, z) || 1; s[0] = x / l; s[1] = y / l; s[2] = z / l;
    }
    W.ledger.bath += U0 - xfSpinPass(null);
  }
}
/* ---- magnetic fields of moving charges (the flat game): each charged particle's field from every other (p._Bi, T) */
function xfInduced() {
  const qs = [];
  for (const p of W.parts) { if (p.dead) continue; const q = p.k === NUC ? p.q : p.q; if (!q || (p.k === NUC && p.Z === 0)) { if (p._Bi) p._Bi = 0; continue; } qs.push(p); }
  const n = qs.length, Rc = n > 3000 ? 40 : Infinity;
  const vs = qs.map(p => { const v = Math.hypot(p.vx, p.vy), t = p.fast || p.rad ? speedNow(p) : v; return v > 0 ? [p.vx * t / v, p.vy * t / v] : [0, 0]; }); // (fast: at its true speed)
  for (const p of qs) p._Bi = 0;
  for (let i = 0; i < n; i++) {
    const a = qs[i];
    for (let j = i + 1; j < n; j++) {
      const b = qs[j], [dx, dy] = minImg(a.x - b.x, a.y - b.y, 0), r2 = dx * dx + dy * dy; // (r from b to a)
      if (r2 < 0.01 || r2 >= Rc * Rc) continue;
      const ir3 = 1 / (r2 * Math.sqrt(r2));
      a._Bi += XF_KBS * b.q * (vs[j][0] * dy - vs[j][1] * dx) * ir3; // (b's field at a: q v × r, z part)
      b._Bi += XF_KBS * a.q * (vs[i][0] * -dy - vs[i][1] * -dx) * ir3;
    }
  }
  XF.nBi = n;
}
/* ---- radiation from accelerating charges, after a step's events */
function xfRadiate(dt) {
  if (!XF.rad) { for (const p of XF.pend) xfEmit(p, true); return; }
  const K = PHYS.KE, C = PHYS.C, HB = 6.582119569e-16 / PHYS.TU_S;
  for (const p of W.parts) {
    if (p.dead || !p.q || (p.k === NUC && p.Z === 0)) continue;
    const KE = keOf(p); if (!(KE > 1e-9)) continue;
    const vt = speedNow(p), mc2 = p.m * AMU_EV, g = 1 + KE / mc2, B = Bfield(p.x, p.y, p);
    let a2, om;
    if (p.fast || p.rad) { const a = Math.abs(p.q) * PHYS.LOR * vt * Math.abs(B) / (g * p.m); a2 = g * g * g * g * a * a; om = vt > 0 ? a / vt : 0; } // (turned at its true speed: Liénard)
    else {
      let ax = S.fx[p.i] * p.im, ay = S.fy[p.i] * p.im, az = W.d3 ? S.fz[p.i] * p.im : 0;
      if (B) { ax += p.q * PHYS.LOR * p.vy * B * p.im; ay -= p.q * PHYS.LOR * p.vx * B * p.im; }
      a2 = ax * ax + ay * ay + az * az; om = vt > 0 ? Math.sqrt(a2) / vt : 0;
    }
    let dE = (2 / 3) * K * p.q * p.q * a2 / (C * C * C) * dt;
    if (!(dE > 0)) continue;
    dE = Math.min(dE, 0.5 * KE);
    if (p.rad) { p.KE -= dE; radSpeed(p); }
    else { const f = Math.sqrt(1 - dE / KE); p.vx *= f; p.vy *= f; if (W.d3) p.vz *= f; if (p.fast) updateFast(p); }
    p._radE = (p._radE || 0) + dE; p._radPh = HB * om * 1.5 * g * g * g; XF.pend.add(p);
    if (p._radE >= Math.max(1, p._radPh)) xfEmit(p);
  }
  for (const p of XF.pend) if (p.dead) xfEmit(p, true);
}
function xfEmit(p, all) { // what p has radiated, given off as one photon along its way
  const E = p._radE || 0; XF.pend.delete(p); p._radE = 0; if (!(E > 0)) return;
  const v = Math.hypot(p.vx, p.vy, W.d3 ? p.vz : 0) || 1, ux = p.vx / v || 1, uy = p.vy / v || 0, uz = W.d3 ? p.vz / v : 0;
  if (W.d3 && typeof emitPhoton3 === 'function') emitPhoton3(p.x, p.y, E, ux, uy, { z: p.z, uz }); else emitPhoton(p.x, p.y, E, ux, uy);
  XF.emitted++; XF.ePh += E; void all;
}
/* ---- the passes the engine calls */
function xfForces(FX, FY, FZ) {
  if (XF.grav > 0) xfGrav(FX, FY, FZ, false);
  if (XF.spin) xfSpinPass(FX, FY, FZ);
  if (XF.lrq) xfLrq(FX, FY, FZ);
  if (XF.disp) xfDisp(FX, FY, FZ, false);
}
function xfEnergy() {
  let U = 0;
  if (XF.grav > 0) U += xfGrav(null, null, null, true);
  if (XF.spin) U += xfSpinPass(null);
  if (XF.lrq) U += xfLrq(null);
  if (XF.disp) U += xfDisp(null, null, null, true);
  for (const p of XF.pend) U += p._radE || 0;
  return U;
}
function xfPre() { // at a step's start
  if (XF.bi && !W.d3) { xfInduced(); XF.biWas = true; }
  else if (XF.biWas) { for (const p of W.parts) p._Bi = 0; XF.biWas = false; XF.nBi = 0; }
}
function xfSet(c) { // the switches (Settings → Experimental → More forces); a change in what totalEnergy counts is booked, as lrFlip books the long-range switch
  const same = Object.keys(c).every(k => XF[k] === c[k]); if (same) return;
  if (c.rad === false) for (const p of XF.pend) xfEmit(p, true); // (what is radiated and not yet given off leaves now)
  const has = W.parts && W.parts.length > 0 && typeof totalEnergy === 'function', e0 = has ? totalEnergy().pe : 0;
  Object.assign(XF, c); xfSync();
  if (!XF.spin) for (const p of W.parts) if (p._sp) p._sp = null;
  if (has) { const e1 = totalEnergy().pe; W.ledger.escaped -= e1 - e0; }
  if (has && typeof forcesNoEvents === 'function') forcesNoEvents();
}
function xfClear() { XF.pend.clear(); XF.nBi = 0; XF.biWas = false; XF.emitted = 0; XF.ePh = 0; XF.nuHits = 0; }
/* ---- full-range partial charges (94): the force field's Coulomb between partial charges is shifted to nothing at the
   cutoff RC (c·qa·qb·(1/√(r²+0.09) − 1/√(RC²+0.09))); added here, c·qa·qb/max(r, RC) for every pair makes it whole at every
   distance (inside RC a constant, so no force; beyond it the exact 1/r), continuous at RC. Pairs of net charges the
   long-range sum already takes (_lrOn) are left to it. With wrapping walls, the nearest image of each pair. */
function xfQ(p) { return p.k === NUC && p.Z > 0 && !p.dead && !p.fast && !p.rad && p.i >= 0 ? p.q + p.qp : 0; }
function xfLrPair(a, b, FX, FY, FZ) {
  if (_lrOn && isLR(a) && isLR(b)) return 0;
  const qq = xfQ(a) * xfQ(b); if (!qq) return 0;
  const [dx, dy, dz] = minImg(b.x - a.x, b.y - a.y, (b.z || 0) - (a.z || 0)), r2 = dx * dx + dy * dy + (W.d3 ? dz * dz : 0), c = iwK(a, b) * PHYS.KE * qq;
  if (r2 <= RC2) return c / RC;
  const r = Math.sqrt(r2);
  if (FX) { const f = c / (r2 * r); FX[a.i] -= f * dx; FY[a.i] -= f * dy; FX[b.i] += f * dx; FY[b.i] += f * dy; if (FZ && W.d3) { FZ[a.i] -= f * dz; FZ[b.i] += f * dz; } }
  return c / r;
}
function xfLrq(FX, FY, FZ) {
  const ps = W.parts.filter(p => xfQ(p) !== 0), Q = ps.map(xfQ), q0 = ps.map(p => p.q), ion = ps.map(p => p.ionic), lr = ps.map(p => _lrOn && isLR(p)), I = ps.map(p => p.i), KIW = W.d3 ? 1 : K_IW, KE = PHYS.KE, d3 = W.d3;
  let U = 0;
  xfPairs(ps, (i, j, dx, dy, dz, r2) => {
    if (lr[i] && lr[j]) return;
    const c = (ion[i] !== ion[j] && (ion[i] ? q0[j] === 0 : q0[i] === 0) ? KIW : 1) * KE * Q[i] * Q[j];
    if (r2 <= RC2) { U += c / RC; return; }
    const r = Math.sqrt(r2); U += c / r;
    if (!FX) return;
    const f = c / (r2 * r), a = I[i], b = I[j]; FX[a] -= f * dx; FY[a] -= f * dy; FX[b] += f * dx; FY[b] += f * dy; if (FZ && d3) { FZ[a] -= f * dz; FZ[b] += f * dz; }
  }, Infinity);
  return U;
}
/* ---- many-body dispersion (95): the Axilrod–Teller–Muto three-body term of D3 added to the force field's pair term,
   E = Σ C9·(3 cos α cos β cos γ + 1)/(r_ab r_bc r_ca)³ · f, C9 = √(C6ab C6bc C6ca) from D3's C6 of the free atoms
   (XTB.d3Disp), f D3's zero damping on the BJ radii (GFN1's a1 0.63, a2 5 Bohr), every triple whose three sides are
   within 5 Å, tapered to nothing from 4 Å. Repulsive for a close triangle, attractive for atoms in a line. */
const XF_AT = { a: [] }, XF_TR = 5, XF_T0 = 4, XF_BOHR = 0.529177210903, XF_EH = 27.211386245988;
function xfC6(za, zb) { // C6 (Hartree·Bohr⁶) and the BJ radius (Bohr) of a pair of free atoms
  const key = za < zb ? za * 128 + zb : zb * 128 + za; let v = XF_AT.a[key];
  if (v) return v;
  v = [0, 0];
  if (typeof XTB !== 'undefined' && za >= 1 && zb >= 1 && za <= 86 && zb <= 86) {
    const R = 25, xyz = [[0, 0, 0], [R, 0, 0]], r = R / XF_BOHR;
    const e6 = XTB.d3Disp([za, zb], xyz, { s6: 1, s8: 0, a1: 0, a2: 0, grad: false }).E / XF_EH, e8 = XTB.d3Disp([za, zb], xyz, { s6: 0, s8: 1, a1: 0, a2: 0, grad: false }).E / XF_EH;
    const c6 = -e6 * Math.pow(r, 6), rr = e8 / e6 * r * r; v = [c6, 0.63 * Math.sqrt(Math.max(rr, 0)) + 5.0];
  }
  XF_AT.a[key] = v; return v;
}
let _xfS = 1, _xfD = 0;
function xfSw(r) { if (r <= XF_T0) { _xfS = 1; _xfD = 0; return; } if (r >= XF_TR) { _xfS = 0; _xfD = 0; return; } const t = (r - XF_T0) / (XF_TR - XF_T0); _xfS = 1 - t * t * (3 - 2 * t); _xfD = -6 * t * (1 - t) / (XF_TR - XF_T0); }
const _xfG = [0, 0, 0], XF_C9U = XF_EH * Math.pow(XF_BOHR, 9), XF_B3 = XF_BOHR * XF_BOHR * XF_BOHR;
/* A triple's energy (eV) from the three pairs' C6 (au) and BJ radii (Bohr) and its three sides a = ab, b = bc, c = ca (Å);
   with grad, ∂E/∂(a, b, c) into _xfG. */
function xfAtmE(c6ab, c6bc, c6ca, r0ab, r0bc, r0ca, a, b, c, grad) {
  const c9 = Math.sqrt(Math.abs(c6ab * c6bc * c6ca)) * XF_C9U, r0 = r0ab * r0bc * r0ca * XF_B3;
  const a2 = a * a, b2 = b * b, c2 = c * c, X = a2 + b2 - c2, Y = a2 - b2 + c2, Zq = -a2 + b2 + c2, N = X * Y * Zq, P = a * b * c, P3 = P * P * P, P5 = P3 * P * P;
  const ang = 0.375 * N / P5 + 1 / P3, q = 6 * Math.pow(r0 / P, 16 / 3), fd = 1 / (1 + q);
  xfSw(a); const sa = _xfS, da = _xfD; xfSw(b); const sb = _xfS, db = _xfD; xfSw(c); const sc = _xfS, dc = _xfD;
  const Sw = sa * sb * sc, E = c9 * ang * fd * Sw;
  if (grad) {
    const dAdP = -5 * 0.375 * N / (P5 * P) - 3 / (P3 * P), dFdP = (16 / 3) * q / P * fd * fd, base = c9 * Sw, dEdP = base * (dAdP * fd + ang * dFdP), k1 = base * fd * 0.375 / P5, k2 = c9 * ang * fd;
    _xfG[0] = k1 * 2 * a * (Y * Zq + X * Zq - X * Y) + dEdP * P / a + k2 * da * sb * sc;
    _xfG[1] = k1 * 2 * b * (Y * Zq - X * Zq + X * Y) + dEdP * P / b + k2 * sa * db * sc;
    _xfG[2] = k1 * 2 * c * (-Y * Zq + X * Zq + X * Y) + dEdP * P / c + k2 * sa * sb * dc;
  }
  return E;
}
function xfDispAts() { return W.parts.filter(p => p.k === NUC && p.Z > 0 && p.Z <= 86 && p.ne > 0 && xfMD(p)); }
function xfNbrs(ps, want) { // neighbours within XF_TR: [atom, r, ux, uy, uz, C6, R0]; for every atom in want, all of them; with no want, each atom's later ones in ps
  const nb = new Map(), R2 = XF_TR * XF_TR;
  if (!want) {
    for (const a of ps) nb.set(a, []);
    xfPairs(ps, (i, j, dx, dy, dz, r2) => { if (r2 < 1e-8) return; const a = ps[i], b = ps[j], r = Math.sqrt(r2), c = xfC6(a.Z, b.Z); nb.get(a).push([b, r, dx / r, dy / r, dz / r, c[0], c[1], j]); }, R2);
    return nb;
  }
  const d3 = W.d3;
  for (const a of want) { const la = []; nb.set(a, la);
    for (let j = 0; j < ps.length; j++) { const b = ps[j]; if (b === a) continue; const m = minImg(b.x - a.x, b.y - a.y, d3 ? b.z - a.z : 0), dx = m[0], dy = m[1], dz = d3 ? m[2] : 0, r2 = dx * dx + dy * dy + dz * dz;
      if (r2 >= R2 || r2 < 1e-8) continue; const r = Math.sqrt(r2), c = xfC6(a.Z, b.Z); la.push([b, r, dx / r, dy / r, dz / r, c[0], c[1], j]); } }
  return nb;
}
function xfDisp(FX, FY, FZ, eOnly, set, skip) {
  let ps = xfDispAts(); if (skip) ps = ps.filter(p => p !== skip);
  const want = set ? ps.filter(p => set.has(p)) : null, nb = xfNbrs(ps, want), grad = !!FX && !eOnly, d3 = W.d3;
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = W.box.d || 0, hw = bw / 2, hh = bh / 2, hd = bd / 2;
  const PX = new Float64Array(ps.length), PY = new Float64Array(ps.length), PZ = new Float64Array(ps.length); ps.forEach((p, i) => { PX[i] = p.x; PY[i] = p.y; PZ[i] = d3 ? p.z : 0; });
  let U = 0;
  for (const a of (want || ps)) {
    const L = nb.get(a);
    for (let j = 0; j < L.length; j++) { const eb = L[j], b = eb[0];
      for (let k = j + 1; k < L.length; k++) {
        const ec = L[k], c = ec[0];
        if (want && ((set.has(b) && b.id < a.id) || (set.has(c) && c.id < a.id))) continue; // (a triple once: by its set member with the lowest id; with no set, the lists hold only later atoms)
        const jb = eb[7], jc = ec[7]; let dx = PX[jc] - PX[jb], dy = PY[jc] - PY[jb], dz = PZ[jc] - PZ[jb];
        if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (d3) { if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; } }
        const r2 = dx * dx + dy * dy + dz * dz; if (r2 >= XF_TR * XF_TR || r2 < 1e-8) continue;
        const rbc = Math.sqrt(r2);
        const cb = xfC6(b.Z, c.Z), E = xfAtmE(eb[5], cb[0], ec[5], eb[6], cb[1], ec[6], eb[1], rbc, ec[1], grad); U += E;
        if (!grad || E === 0) continue;
        const g0 = _xfG[0], g1 = _xfG[1], g2 = _xfG[2], ux = dx / rbc, uy = dy / rbc, uz = dz / rbc;
        // (each side's dE/dr pulls its two ends together when positive: a→b along eb, b→c, a→c along ec)
        FX[a.i] += g0 * eb[2] + g2 * ec[2]; FY[a.i] += g0 * eb[3] + g2 * ec[3];
        FX[b.i] += -g0 * eb[2] + g1 * ux; FY[b.i] += -g0 * eb[3] + g1 * uy;
        FX[c.i] += -g1 * ux - g2 * ec[2]; FY[c.i] += -g1 * uy - g2 * ec[3];
        if (FZ && d3) { FZ[a.i] += g0 * eb[4] + g2 * ec[4]; FZ[b.i] += -g0 * eb[4] + g1 * uz; FZ[c.i] += -g1 * uz - g2 * ec[4]; }
      }
    }
  }
  return U;
}
/* ---- neutrinos meeting electrons (93): a neutrino scatters off an electron (the weak force: Z exchange, and W for νₑ),
   σ per electron 9.5, 4.0, 1.6, 1.3 ×10⁻⁴⁵ cm² × E/MeV for νₑ, ν̄ₑ, ν_μ/ν_τ, ν̄_μ/ν̄_τ; the electron takes T (up to
   2E²/(m_ec² + 2E); evenly spread for ν, weighted (1 − T/E)² for ν̄) and leaves its atom forward, as Compton's does;
   the neutrino goes on with the rest. Met along its line as light is (atoms within 0.6 Å, 0.012 a pass per 0.2112 b),
   with the cross section times the boost (1 = real: nothing will ever be seen). Absorption by nuclei (inverse β decay)
   is not built. */
const XF_NUS = { e: [9.5, 4.0], mu: [1.6, 1.3], tau: [1.6, 1.3] };
function xfNuMeet(x, y, z, ux, uy, uz, E, anti, fl) {
  if (!XF.nu || !(E > 0)) return 0;
  const sg = (XF_NUS[fl] || XF_NUS.e)[anti ? 1 : 0] * 1e-21 * (E / 1e6) * Math.pow(10, XF.nu === 1 ? 0 : XF.nu); // (barns per electron; 1: real)
  const tm = W.d3 ? rayExit3(x, y, z, ux, uy, uz) : rayExit(x, y, ux, uy), hits = [];
  for (const p of W.parts) {
    if (p.dead || p.k !== NUC || p.Z === 0 || !(p.ne > 0) || p.fast || p.rad) continue;
    const dx = p.x - x, dy = p.y - y, dz = W.d3 ? (p.z || 0) - z : 0, t = dx * ux + dy * uy + dz * uz;
    if (t < 0.05 || t > tm) continue;
    const ex = dx - t * ux, ey = dy - t * uy, ez = dz - t * uz;
    if (ex * ex + ey * ey + ez * ez < 0.36) hits.push([t, p]);
  }
  hits.sort((a, b) => a[0] - b[0]);
  for (const [, p] of hits) {
    if (rnd() >= Math.min(1, 0.012 * p.ne * sg / 0.2112)) continue;
    const me = 510998.95, Tm = 2 * E * E / (me + 2 * E), u = rnd();
    const Td = anti ? E * (1 - Math.cbrt(1 - u * (1 - Math.pow(1 - Tm / E, 3)))) : Tm * u;
    const ie = ionizationCost(p), cth = Math.min(1, (1 + me / E) * Math.sqrt(Td / (Td + 2 * me))), sth = Math.sqrt(1 - cth * cth);
    // the electron's direction: cth from the line, at a random turn about it
    let vx, vy, vz;
    if (W.d3) { const ph = 2 * Math.PI * rnd(); const ax = Math.abs(ux) < 0.9 ? [1, 0, 0] : [0, 1, 0]; let px = uy * ax[2] - uz * ax[1], py = uz * ax[0] - ux * ax[2], pz = ux * ax[1] - uy * ax[0]; const pl = Math.hypot(px, py, pz); px /= pl; py /= pl; pz /= pl; const qx = uy * pz - uz * py, qy = uz * px - ux * pz, qz = ux * py - uy * px;
      vx = cth * ux + sth * (Math.cos(ph) * px + Math.sin(ph) * qx); vy = cth * uy + sth * (Math.cos(ph) * py + Math.sin(ph) * qy); vz = cth * uz + sth * (Math.cos(ph) * pz + Math.sin(ph) * qz); }
    else { const sgn = rnd() < 0.5 ? 1 : -1; vx = cth * ux - sgn * sth * uy; vy = cth * uy + sgn * sth * ux; vz = 0; }
    if (!(Td > ie) || !ejectElectron(p, Td - ie, vx, vy, undefined, false, vz)) dumpHeat(Td, p, p);
    else { W.count.ionize++; }
    XF.nuHits = (XF.nuHits || 0) + 1;
    log('nuc', `A neutrino (${nuLab(anti, fl)}, ${fmtE(E)}) struck an electron of ${speciesLabel(p)}: ${fmtE(Td)} given to it`);
    return Td;
  }
  return 0;
}
/* ---- an event's measure (localPE): these energies between the set and everything (each pair, triple once) */
function xfLocal(set, skip) {
  let U = 0;
  const others = (f) => W.parts.filter(p => p !== skip && f(p));
  if (XF.grav > 0) {
    const ps = others(xfMD), G = xfG(), Rc = ps.length > 3000 ? 40 : Infinity, iRc = Rc < Infinity ? 1 / Rc : 0;
    for (const a of set) { if (!xfMD(a)) continue;
      for (const b of ps) { if (b === a || (set.has(b) && b.id < a.id)) continue; const [dx, dy, dz] = minImg(b.x - a.x, b.y - a.y, (b.z || 0) - (a.z || 0)), r2 = dx * dx + dy * dy + dz * dz; if (r2 >= Rc * Rc || r2 < 1e-6) continue; U -= G * a.m * b.m * (1 / Math.sqrt(r2) - iRc); }
      if (XF.grav === 2 && W.wall !== 'wrap') U += a.m * xfGEarth() * (a.y + W.box.h / 2); }
  }
  if (XF.spin) {
    const sp = xfSpins().filter(p => p !== skip), MB = PHYS.MU_B, mine = sp.filter(p => set.has(p));
    for (const p of mine) { const B = xfBext(p.x, p.y, p.z || 0, p), s = p._sp; U -= p._mu * MB * (s[0] * B[0] + s[1] * B[1] + s[2] * B[2]); }
    const all = xfSpinPairs(sp, null).pairs;
    for (const q of all) if (set.has(q.a) || set.has(q.b)) { const sa = q.a._sp, sb = q.b._sp, u = q.u, ss = sa[0] * sb[0] + sa[1] * sb[1] + sa[2] * sb[2]; U += q.c * (ss - 3 * (sa[0] * u[0] + sa[1] * u[1] + sa[2] * u[2]) * (sb[0] * u[0] + sb[1] * u[1] + sb[2] * u[2])) - q.J * ss; }
  }
  if (XF.lrq) {
    const ps = others(p => xfQ(p) !== 0);
    for (const a of set) { if (!xfQ(a)) continue; for (const b of ps) { if (b === a || (set.has(b) && b.id < a.id)) continue; U += xfLrPair(a, b, null); } }
  }
  if (XF.disp) U += xfDisp(null, null, null, true, set, skip);
  return U;
}
/* ---- nucleons inside nuclei (92): a collision between light nuclei (together at most 32 nucleons, both at most 16, above
   their Coulomb barrier and below 150 MeV a nucleon, the reactions Fermi's breakup otherwise decides) worked out nucleon by
   nucleon. Each nucleus is its protons and neutrons as classical particles held by the Pandharipande "medium"
   potential (Vicentini, Jacucci and Pandharipande 1985, as classical molecular dynamics of nuclei uses it: n–p
   3088.118·e^(−1.7468r)/r − 2666.647·e^(−1.6r)/r MeV, n–n and p–p 373.118·e^(−1.5468r)/r, r in fm, shifted to nothing at
   5.4 fm; protons also 1.44/r), each kind in its lowest arrangement (found once, by cooling from three random starts:
   ⁴He bound by 33 MeV, nature 28.3). The two meet at the pass's impact parameter and relative speed (less the Coulomb
   energy where they start, their surfaces 2 fm apart) and are followed in steps of 0.25 fm/c until they have come
   apart (at most 300 fm/c). The pieces they come apart into (nucleons within 3 fm of each other are one piece) are the
   products; how they share the energy (as motion apart and as heat inside each) is the motion's, scaled to what the
   measured masses leave; a hot or unbound piece then breaks up or cools as before (compoundDecay). When everything stays
   one piece, the tables decide as before. Off (the tables) as normal; D + T keeps its measured fusion cross section. */
const XN = { gs: new Map(), last: null, n: 0 };
const XN_RC = 5.4, XN_M = 938.92;
function xnV(pi, pj, r) { // MeV, and −dV/dr / r (for the force along the separation)
  let V, F;
  if (pi !== pj) { const er = Math.exp(-1.7468 * r), ea = Math.exp(-1.6 * r); V = 3088.118 * (er / r - 0.0000148706) - 2666.647 * (ea / r - 0.0000325516); F = 3088.118 * er * (1.7468 * r + 1) / (r * r) - 2666.647 * ea * (1.6 * r + 1) / (r * r); }
  else { const e0 = Math.exp(-1.5468 * r); V = 373.118 * (e0 / r - 0.0000429836); F = 373.118 * e0 * (1.5468 * r + 1) / (r * r); }
  if (pi && pj) { V += 1.44 / r; F += 1.44 / (r * r); }
  return [r < XN_RC ? V : 1.44 * (pi && pj) / r, r < XN_RC ? F / r : (pi && pj ? 1.44 / (r * r * r) : 0)];
}
function xnForces(N, X, F) { // N: [isProton], X: [x, y, z] flat; F out; returns the potential energy
  F.fill(0); let U = 0;
  for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
    const dx = X[3 * j] - X[3 * i], dy = X[3 * j + 1] - X[3 * i + 1], dz = X[3 * j + 2] - X[3 * i + 2], r = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    if (r >= XN_RC && !(N[i] && N[j])) continue;
    const [V, f] = xnV(N[i], N[j], Math.max(r, 0.2)); U += V;
    F[3 * i] -= f * dx; F[3 * i + 1] -= f * dy; F[3 * i + 2] -= f * dz; F[3 * j] += f * dx; F[3 * j + 1] += f * dy; F[3 * j + 2] += f * dz;
  }
  return U;
}
function xnGround(Z, N) { // the lowest arrangement of Z protons and N neutrons, centred: { P: [isProton], X, U (MeV), R (fm) }
  const key = Z * 64 + N; let g = XN.gs.get(key); if (g) return g;
  let s = (key * 2654435761) >>> 0; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); // (its own fixed draws: the seeded game is not touched)
  const A = Z + N, P = [], best = { U: Infinity };
  for (let i = 0; i < A; i++) P.push(i < Z ? 1 : 0);
  for (let t = 0; t < 3; t++) {
    const X = new Float64Array(3 * A), V = new Float64Array(3 * A), F = new Float64Array(3 * A), R0 = 1.1 * Math.cbrt(A) + 0.6;
    for (let i = 0; i < A; i++) { let x, y, z; do { x = 2 * r() - 1; y = 2 * r() - 1; z = 2 * r() - 1; } while (x * x + y * y + z * z > 1); X[3 * i] = R0 * x; X[3 * i + 1] = R0 * y; X[3 * i + 2] = R0 * z; }
    let U = xnForces(P, X, F); const dt = 0.4;
    for (let k = 0; k < 3000; k++) {
      for (let i = 0; i < 3 * A; i++) { V[i] = 0.92 * (V[i] + dt * F[i] / XN_M); X[i] += dt * V[i]; }
      U = xnForces(P, X, F);
    }
    if (U < best.U) { best.U = U; best.X = X.slice(); }
  }
  const X = best.X; let cx = 0, cy = 0, cz = 0; for (let i = 0; i < A; i++) { cx += X[3 * i] / A; cy += X[3 * i + 1] / A; cz += X[3 * i + 2] / A; }
  let R = 0; for (let i = 0; i < A; i++) { X[3 * i] -= cx; X[3 * i + 1] -= cy; X[3 * i + 2] -= cz; R = Math.max(R, Math.hypot(X[3 * i], X[3 * i + 1], X[3 * i + 2])); }
  g = { P, X, U: A > 1 ? best.U : 0, R }; XN.gs.set(key, g); return g;
}
function xnRot(X) { // the arrangement turned at random (seeded draws)
  const q = [gauss(), gauss(), gauss(), gauss()], l = Math.hypot(...q); const [w, x, y, z] = q.map(v => v / l);
  const M = [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
  const o = new Float64Array(X.length);
  for (let i = 0; i < X.length; i += 3) for (let k = 0; k < 3; k++) o[i + k] = M[3 * k] * X[i] + M[3 * k + 1] * X[i + 1] + M[3 * k + 2] * X[i + 2];
  return o;
}
function xnPieces(A, X) { // nucleons within 3 fm of each other, joined: a piece number for each
  const lab = new Int32Array(A).fill(-1); let n = 0;
  for (let i = 0; i < A; i++) { if (lab[i] >= 0) continue; const st = [i]; lab[i] = n;
    while (st.length) { const k = st.pop(); for (let j = 0; j < A; j++) if (lab[j] < 0) { const dx = X[3 * j] - X[3 * k], dy = X[3 * j + 1] - X[3 * k + 1], dz = X[3 * j + 2] - X[3 * k + 2]; if (dx * dx + dy * dy + dz * dz < 9) { lab[j] = n; st.push(j); } } }
    n++; }
  return { lab, n };
}
/* The collision in the pair's own frame (P their total four-momentum, M its mass, b3 the impact parameter, fm); the
   products into items and moms as fermiInto puts them. False: one piece, or pieces the masses cannot make. */
function xnCollide(a, b, Pa, P, M, b3, anti, items, moms) {
  const Z1 = a.Z, N1 = a.N, Z2 = b.Z, N2 = b.N, A1 = Z1 + N1, A2 = Z2 + N2, A = A1 + A2;
  const ga = xnGround(Z1, N1), gb = xnGround(Z2, N2), m1 = A1 * XN_M, m2 = A2 * XN_M;
  const bx = P[1] / P[0], by = P[2] / P[0], bz = (P[3] || 0) / P[0], d3 = W.d3, As = toRest(Pa, bx, by, bz), dn = pmag(As) || 1;
  const ex = d3 ? [As[1] / dn, As[2] / dn, As[3] / dn] : [As[1] / dn, As[2] / dn, 0]; // the axis a comes in along (x'), one across it (y'), and (3-D) the third
  let ey; if (d3) { const t = Math.abs(ex[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], c = [ex[1] * t[2] - ex[2] * t[1], ex[2] * t[0] - ex[0] * t[2], ex[0] * t[1] - ex[1] * t[0]], l = Math.hypot(...c), ph = 2 * Math.PI * rnd(), c2 = [ex[1] * c[2] - ex[2] * c[1], ex[2] * c[0] - ex[0] * c[2], ex[0] * c[1] - ex[1] * c[0]]; ey = c.map((v, k) => (Math.cos(ph) * v + Math.sin(ph) * c2[k] / 1) / l); } else ey = [-ex[1], ex[0], 0];
  const ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
  const Ecm = M - nucMeV(Z1, N1) - nucMeV(Z2, N2), D = ga.R + gb.R + 2 + 1.2;
  const Xa = xnRot(ga.X), Xb = xnRot(gb.X), X = new Float64Array(3 * A), V = new Float64Array(3 * A), F = new Float64Array(3 * A), PR = ga.P.concat(gb.P);
  const xa = -D * m2 / (m1 + m2), xb = D * m1 / (m1 + m2), ya = (d3 || rnd() < 0.5 ? 1 : -1) * b3 * m2 / (m1 + m2), yb = -ya * m1 / m2;
  for (let i = 0; i < A1; i++) { X[3 * i] = Xa[3 * i] + xa; X[3 * i + 1] = Xa[3 * i + 1] + ya; X[3 * i + 2] = Xa[3 * i + 2]; }
  for (let i = 0; i < A2; i++) { const k = 3 * (A1 + i); X[k] = Xb[3 * i] + xb; X[k + 1] = Xb[3 * i + 1] + yb; X[k + 2] = Xb[3 * i + 2]; }
  const U = xnForces(PR, X, F); const Erel = Ecm - (U - ga.U - gb.U);
  if (!(Erel > 0.05)) return false;
  const mu = m1 * m2 / (m1 + m2), pr = Math.sqrt(2 * mu * Erel);
  for (let i = 0; i < A; i++) V[3 * i] = i < A1 ? pr / m1 : -pr / m2;
  const dt = 0.25, frames = [], vr = pr / mu, tCross = 2 * D / vr;
  let stable = 0, last = -1, steps = 0;
  for (let k = 0; k < 1200; k++) {
    for (let i = 0; i < 3 * A; i++) { V[i] += 0.5 * dt * F[i] / XN_M; X[i] += dt * V[i]; }
    xnForces(PR, X, F);
    for (let i = 0; i < 3 * A; i++) V[i] += 0.5 * dt * F[i] / XN_M;
    steps++;
    if (k % 6 === 0) frames.push(Float32Array.from(X));
    if (k * dt > tCross && k % 8 === 0) { // apart: the pieces the same for 40 fm/c, none nearer another than the nuclear force reaches
      const pc = xnPieces(A, X); let near = false;
      for (let i = 0; i < A && !near; i++) for (let j = i + 1; j < A; j++) if (pc.lab[i] !== pc.lab[j]) { const dx = X[3 * j] - X[3 * i], dy = X[3 * j + 1] - X[3 * i + 1], dz = X[3 * j + 2] - X[3 * i + 2]; if (dx * dx + dy * dy + dz * dz < XN_RC * XN_RC) { near = true; break; } }
      stable = pc.n === last && !near ? stable + 1 : 0; last = pc.n;
      if (stable >= 20) break;
    }
  }
  const pc = xnPieces(A, X), lab = pc.lab;
  XN.last = { frames, P: PR, A1, n: pc.n, lab: Array.from(lab), t: steps * dt, x: a.x, y: a.y, z: a.z || 0, at: performance.now() };
  if (pc.n < 2) return false;
  // the pieces: their nucleons, motion as a whole (p, MeV/c) and heat inside (MeV, above that kind's lowest arrangement)
  const pcs = [];
  for (let n = 0; n < pc.n; n++) {
    const idx = []; for (let i = 0; i < A; i++) if (lab[i] === n) idx.push(i);
    let Z = 0, px = 0, py = 0, pz = 0; for (const i of idx) { Z += PR[i]; px += XN_M * V[3 * i]; py += XN_M * V[3 * i + 1]; pz += XN_M * V[3 * i + 2]; }
    const m = idx.length * XN_M, vx = px / m, vy = py / m, vz = pz / m; let Ein = 0;
    for (const i of idx) Ein += 0.5 * XN_M * ((V[3 * i] - vx) ** 2 + (V[3 * i + 1] - vy) ** 2 + (V[3 * i + 2] - vz) ** 2);
    if (idx.length > 1) { const sub = new Float64Array(3 * idx.length), sp = idx.map(i => PR[i]); idx.forEach((i, k) => { sub[3 * k] = X[3 * i]; sub[3 * k + 1] = X[3 * i + 1]; sub[3 * k + 2] = X[3 * i + 2]; }); Ein += xnForces(sp, sub, new Float64Array(sub.length)) - xnGround(Z, idx.length - Z).U; }
    // the motion along the frame's own axes: x' along a's way in, y' across, z' (3-D only; the flat game keeps the plane)
    const pv = [px, py, d3 ? pz : 0], lab3 = [0, 1, 2].map(k => pv[0] * ex[k] + pv[1] * ey[k] + pv[2] * ez[k]);
    pcs.push({ Z, Nn: idx.length - Z, p: d3 ? lab3 : [lab3[0], lab3[1]], T: (pv[0] ** 2 + pv[1] ** 2 + pv[2] ** 2) / (2 * m), X: Math.max(0, Ein) });
  }
  // nn…, pp…: no bound state; they leave as nucleons, the piece's motion shared, its heat with it
  const out = [];
  for (const q of pcs) {
    if ((q.Z === 0 || q.Nn === 0) && q.Z + q.Nn > 1) { const k = q.Z + q.Nn; for (let i = 0; i < k; i++) out.push({ Z: q.Z ? 1 : 0, Nn: q.Z ? 0 : 1, p: q.p.map(v => v / k), T: q.T / k, X: q.X / k }); }
    else out.push(q);
  }
  // the measured masses: what is left over them shared as the motion had it between moving apart and heat inside
  const ms = out.map(q => nucMeV(q.Z, q.Nn)), Eav = M - ms.reduce((s, v) => s + v, 0), cl = out.reduce((s, q) => s + q.T + q.X, 0);
  if (!(Eav > 0) || !(cl > 0)) return false;
  const k = Eav / cl, mx = out.map((q, i) => ms[i] + k * q.X), pp = out.map(q => Math.hypot(...q.p));
  const tot = (s) => out.reduce((S, q, i) => S + Math.sqrt(mx[i] * mx[i] + s * s * pp[i] * pp[i]), 0);
  if (!(tot(0) < M)) return false;
  let lo = 0, hi = 1; while (tot(hi) < M) hi *= 2;
  for (let it = 0; it < 80; it++) { const s = 0.5 * (lo + hi); if (tot(s) < M) lo = s; else hi = s; }
  const s = 0.5 * (lo + hi);
  out.forEach((q, i) => { const p = q.p.map(v => v * s), E = Math.sqrt(mx[i] * mx[i] + s * s * pp[i] * pp[i]); compoundDecay(q.Z, q.Nn, mx[i], toLab([E, ...p], bx, by, bz), anti, items, moms, 0); });
  // a piece compoundDecay keeps (cold, or nothing to cool by) goes as itself
  XN.n++; XN.last.pieces = out.map(q => nucSymA ? nucSymA(q.Z, q.Nn, anti) : q.Z + '/' + q.Nn);
  return true;
}
/* The inset: the nucleons of the last such collision, played over about 4 s in a corner (protons red, neutrons grey). */
function xnDraw(ctx) {
  const L = XN.last; if (!L || !L.frames.length || !XF.nucl) return;
  const age = (performance.now() - L.at) / 1000; if (age > 6) return;
  const f = L.frames[Math.min(L.frames.length - 1, Math.floor(age / 4 * L.frames.length))], A = L.P.length;
  const S = 150, x0 = R.w - S - 14, y0 = R.h - S - 46, sc = S / 30;
  ctx.save(); ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0); ctx.globalAlpha = Math.min(1, (6 - age) / 1);
  ctx.fillStyle = 'rgba(8,12,20,0.82)'; ctx.strokeStyle = 'rgba(160,190,230,0.5)'; ctx.lineWidth = 1; ctx.fillRect(x0, y0, S, S); ctx.strokeRect(x0 + 0.5, y0 + 0.5, S - 1, S - 1);
  let cx = 0, cy = 0; for (let i = 0; i < A; i++) { cx += f[3 * i] / A; cy += f[3 * i + 1] / A; }
  ctx.beginPath(); ctx.rect(x0, y0, S, S); ctx.clip();
  for (let i = 0; i < A; i++) { const x = x0 + S / 2 + (f[3 * i] - cx) * sc, y = y0 + S / 2 - (f[3 * i + 1] - cy) * sc; ctx.fillStyle = L.P[i] ? '#ff6b5e' : '#b8c2cf'; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 2 * Math.PI); ctx.fill(); }
  ctx.fillStyle = '#dce6f2'; ctx.font = '11px system-ui, sans-serif'; ctx.fillText('Nucleons (30 fm across)', x0 + 6, y0 + 14);
  if (age > 4 && L.pieces) ctx.fillText(L.pieces.join(' + ').slice(0, 26), x0 + 6, y0 + S - 8);
  ctx.restore();
}
/* Each atom's moment drawn as an arrow through it (the flat game: its part in the plane; a dot when it points out of the
   screen, a ring when into it), gold. */
function xfDrawSpins(ctx) {
  const L = 0.75 * R.s;
  ctx.save(); ctx.lineWidth = Math.max(1, Math.min(2.5, R.s / 25)); ctx.strokeStyle = 'rgba(255,205,90,0.95)'; ctx.fillStyle = 'rgba(255,205,90,0.95)';
  for (const p of W.parts) {
    if (!p._sp || p.dead) continue;
    const x = w2sx(p.x), y = w2sy(p.y), s = p._sp, ax = s[0] * L, ay = -s[1] * L;
    if (x < -L || y < -L || x > R.w + L || y > R.h + L) continue;
    if (Math.hypot(ax, ay) < 0.25 * L) { ctx.beginPath(); ctx.arc(x, y, 0.12 * L + 1, 0, 2 * Math.PI); if (s[2] > 0) ctx.fill(); else ctx.stroke(); continue; }
    ctx.beginPath(); ctx.moveTo(x - ax, y - ay); ctx.lineTo(x + ax, y + ay); ctx.stroke();
    const h = 0.3 * L, l = Math.hypot(ax, ay), ux = ax / l, uy = ay / l;
    ctx.beginPath(); ctx.moveTo(x + ax, y + ay); ctx.lineTo(x + ax - h * ux - 0.6 * h * uy, y + ay - h * uy + 0.6 * h * ux); ctx.lineTo(x + ax - h * ux + 0.6 * h * uy, y + ay - h * uy - 0.6 * h * ux); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
