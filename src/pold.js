'use strict';
/* ---- Experimental: polarizability by direction (1.27; Settings → Experimental, with Induced charges on). The induced
   charges (1.12) are charge flow: charge moves along bonds, so a molecule polarizes only along its bonds (N₂, CO₂ and
   benzene not at all across them, benzene 14 times too much along its ring). With this on, a molecule's atoms carry
   induced point dipoles instead: μ = α·E, each atom's α a tensor, half the sum of its bonds' tensors
   α∥ ûû + α⊥(1 − ûû) (bond polarizabilities, fitted to measured molecules: PD_BOND), so the molecule's polarizability is
   the sum over its bonds, along and across each (Silberstein, Denbigh; additivity, no coupling inside a molecule).
   E is the field at the atom from the charges and the dipoles of other molecules within the force reach, and the
   applied field. The charge flow is off meanwhile (the two would count the same response twice).
   - Energy: U = Σ ½K μᵀα⁻¹μ (a constant per atom between updates: p.dmc) − μ·E_applied + between atoms of different
     molecules the charge–dipole and dipole–dipole terms of the soft Coulomb F(r²) = 1/√(r² + 0.09) (the kernel's own
     softening), smoothly cut over the last ångström of the reach (a step in r², so the field and the forces go to zero
     at the cutoff). Charge–dipole pairs take the kernel's ion–molecule weight (iwK), as the induced charges' do.
   - Between steps on the induced charges' schedule (pdUpdate from qeqUpdate): the tensors from the bonds now, the
     dipoles solved to self-consistency (μ = α(E_charges + E_applied + E_dipoles), iterated), the exact change of the
     energy paid by the molecules' own motion about their centre of mass (or the update is skipped), the forces again.
     Between updates the dipoles are fixed (lab frame), so the forces are the energy's own slopes and the books exact.
   - In the flat game, dipoles and tensors in the plane. Molecules of 2–64 atoms (as the induced charges); ionic atoms in
     them take their ion's polarizability (isotropic), metal atoms none; lone atoms and ions none.
   Off: PD.n is 0, nothing here runs, the game bit for bit as before. */
const PD_S = 0.09; // (the soft Coulomb's softening, Å², as the kernel's)
/* Bond polarizabilities [α∥, α⊥] (Å³) by 'Zlow-Zhigh:order' ('a' aromatic), fitted (tools/polfit.js) to the measured
   (static, electronic) polarizabilities of the molecules in PD_REF with the game's own geometries. */
const PD_BOND = { '1-1:1': [0.983, 0.693], '7-7:3': [2.200, 1.510], '8-8:2': [2.300, 1.220], '6-8:3': [2.303, 1.773], '6-8:2': [1.982, 0.982], '1-8:1': [0.735, 0.735], '1-6:1': [0.789, 0.580], '6-6:1': [0.855, 0.427], '6-6:2': [2.475, 1.237], '6-6:3': [3.045, 1.522], '6-6:a': [2.169, 0.523], '6-17:1': [3.870, 1.935], '1-17:1': [3.945, 1.972], '1-9:1': [1.200, 0.600], '1-7:1': [1.100, 0.550], '6-8:1': [0.907, 0.454] };
/* Atomic polarizabilities (Å³; CRC) for bonds not in PD_BOND: the bond gets PD_F·(α_A/n_A + α_B/n_B) as its mean
   (n: the atom's bond count; PD_F fitted with the table), split 1.5 : 0.75 along and across. Ions: their own. */
const PD_ATOM = { 1: 0.667, 5: 3.03, 6: 1.76, 7: 1.10, 8: 0.802, 9: 0.557, 14: 5.38, 15: 3.63, 16: 2.90, 17: 2.18, 33: 4.31, 34: 3.77, 35: 3.05, 53: 5.35 };
const PD_ION = { '3,1': 0.03, '11,1': 0.18, '19,1': 0.84, '37,1': 1.4, '55,1': 2.4, '12,2': 0.09, '20,2': 0.47, '9,-1': 0.9, '17,-1': 3.0, '35,-1': 4.2, '53,-1': 6.3, '8,-2': 2.0, '16,-2': 5.5 }; // ('Z,charge': Å³, in crystals; others 0)
let PD_F = 0.7; // (fitted to the table's single bonds: 0.59 C–H … 0.98 C–Cl)
const PD_TOL = 1e-5, PD_MAXIT = 60, PD_MAXMU = 2.5; // (convergence of the dipoles, e·Å; the largest dipole an update may give)
function pdOn(on) { // (the switch: on, the charge flow is cleared; off, the dipoles are)
  const was = PD.on; PD.on = on ? 1 : 0;
  if (was === PD.on) return;
  if (PD.on) { if (typeof qeqClear === 'function' && W.parts) qeqClear(); } else pdClear();
}
function pdAct(p) { return p.dm === PD.gen && !p.dead && p.k === NUC && p.Z > 0 && !p.fast && !p.rad; }
function pdFieldU(p) { return -(p.dmx * (W.Ex || 0) + p.dmy * (W.Ey || 0) + (W.d3 ? p.dmz * (W.Ez || 0) : 0)); } // (the applied field's energy, live: the field may change between updates)
function pdPart(o) { return o.k === NUC && o.Z > 0 && !o.dead && !o.fast && !o.rad; }
function pdLive() { if (PD.parts !== W.parts) { PD.n = 0; PD.at = []; PD.gen++; return false; } return true; }
/* The soft Coulomb's derivatives in u = r² (into out: g, g′, g″, g‴ of g = 1/√(u + s)), and the fade over the last
   ångström of the reach (pdSw: _pdw = [S, (dS/dr)/r], a smooth step on r as the charge sites', 1.26): each pair's energy
   is faded, not the potential, so a field is never larger than the unfaded one. */
const _pdf = [0, 0, 0, 0], _pdw = [1, 0];
let PD_TH = 1.0; function PD_TH_SET(v) { PD_TH = v; } // (tests)
 // (a pair's softening s = PD_S + PD_TH·(ᾱa·ᾱb)^⅓ Å², for its charge–dipole and dipole–dipole terms alike: a damping as Thole's (whose linear a = 1.66 squared, 2.7, gave liquid water 2.49 D; 1.0 gives 2.66 D in the 3-D lab, measured 2.6–3.0), so two dipoles close together cannot feed each other without limit (the polarization catastrophe) and a bare charge's field cannot pull an atom into it)
function pdSdd(a, b) { return PD_S + PD_TH * Math.cbrt(a * b); }
/* The polarizability a partner's damping uses: its dipole's, or (no dipole) its ion's or atom's own. */
function pdDampA(p) { return pdAct(p) ? p.dma : pdStaticA(p); }
function pdRad(u, s = PD_S, out = _pdf) {
  const t = u + s, g = 1 / Math.sqrt(t), it = 1 / t, g1 = -0.5 * g * it, g2 = -1.5 * g1 * it, g3 = -2.5 * g2 * it;
  out[0] = g; out[1] = g1; out[2] = g2; out[3] = g3;
}
function pdSw(u) {
  const r1 = RC - 1;
  if (u <= r1 * r1) { _pdw[0] = 1; _pdw[1] = 0; return; }
  const r = Math.sqrt(u);
  const x = r - r1; _pdw[0] = 1 - x * x * x * (10 - 15 * x + 6 * x * x); _pdw[1] = -30 * x * x * (1 - x) * (1 - x) / r;
}
function pdBondKey(a, b, bd) { const lo = Math.min(a.Z, b.Z), hi = Math.max(a.Z, b.Z); return lo + '-' + hi + ':' + (bd.arom ? 'a' : bd.order); }
function pdBondAlpha(a, b, bd) { // [α∥, α⊥] of a bond
  const t = PD_BOND[pdBondKey(a, b, bd)]; if (t) return t;
  const aa = PD_ATOM[a.Z], ab = PD_ATOM[b.Z]; if (aa === undefined || ab === undefined) return null;
  const m = PD_F * (aa / Math.max(1, a.bonds.length) + ab / Math.max(1, b.bonds.length)); return [1.5 * m, 0.75 * m];
}
/* An atom's tensor (xx, xy, xz, yy, yz, zz) into out, from its bonds now; false if it has none. */
function pdAlpha(p, out) {
  out.fill(0);
  if (p.ionic) { const a = PD_ION[p.Z + ',' + p.q] || 0; if (!a) return false; out[0] = out[3] = a; if (W.d3) out[5] = a; return true; }
  if (p.isMetal) return false;
  let any = false;
  for (const bd of p.bonds) {
    const o = other(bd, p); if (o.isMetal && !o.ionic) continue;
    const t = o.ionic ? null : pdBondAlpha(p, o, bd); if (!t) continue;
    const [dx, dy, dz] = minImg(o.x - p.x, o.y - p.y, o.z - p.z), z = W.d3 ? dz : 0, r = Math.sqrt(dx * dx + dy * dy + z * z) || 1e-9, ux = dx / r, uy = dy / r, uz = z / r;
    const pe = 0.5 * t[1], d = 0.5 * (t[0] - t[1]);
    out[0] += pe + d * ux * ux; out[1] += d * ux * uy; out[2] += d * ux * uz; out[3] += pe + d * uy * uy; out[4] += d * uy * uz; out[5] += pe + d * uz * uz;
    any = true;
  }
  if (!W.d3) { out[2] = out[4] = out[5] = 0; }
  return any;
}
/* ½ μᵀα⁻¹μ (in the plane in the flat game); NaN if α cannot be inverted. */
function pdSelf(A, mx, my, mz) {
  if (!W.d3) { const det = A[0] * A[3] - A[1] * A[1]; if (!(det > 1e-12)) return NaN; return 0.5 * (A[3] * mx * mx - 2 * A[1] * mx * my + A[0] * my * my) / det; }
  const a = A[0], b = A[1], c = A[2], d = A[3], e = A[4], f = A[5];
  const c00 = d * f - e * e, c01 = c * e - b * f, c02 = b * e - c * d, c11 = a * f - c * c, c12 = b * c - a * e, c22 = a * d - b * b, det = a * c00 + b * c01 + c * c02;
  if (!(det > 1e-12)) return NaN;
  return 0.5 * (c00 * mx * mx + c11 * my * my + c22 * mz * mz + 2 * (c01 * mx * my + c02 * mx * mz + c12 * my * mz)) / det;
}
/* One pair's energy (eV), d = r(b) − r(a): a's charge and dipole against b's. */
function pdPairCore(a, b, dx, dy, dz, w) {
  const u = dx * dx + dy * dy + dz * dz; if (u >= RC2) return 0;
  pdRad(u, pdSdd(pdDampA(a), pdDampA(b))); pdSw(u);
  const qa = a.q + a.qp, qb = b.q + b.qp, ia = pdAct(a), ib = pdAct(b);
  const ax = ia ? a.dmx : 0, ay = ia ? a.dmy : 0, az = ia ? a.dmz : 0, bx = ib ? b.dmx : 0, by = ib ? b.dmy : 0, bz = ib ? b.dmz : 0;
  const A = ax * dx + ay * dy + az * dz, B = bx * dx + by * dy + bz * dz, C = ax * bx + ay * by + az * bz;
  let U = 2 * _pdf[1] * w * (qa * B - qb * A);
  if (ia && ib) U -= 2 * _pdf[1] * C + 4 * _pdf[2] * A * B;
  return PHYS.KE * _pdw[0] * U;
}
function pdPairOK(a, b) { return a !== b && pdPart(a) && pdPart(b) && !(a.mol !== 0 && a.mol === b.mol) && (pdAct(a) || pdAct(b)); }
function pdPairE(a, b) {
  if (!PD.n || !pdLive() || !pdPairOK(a, b)) return 0;
  const [dx, dy, dz] = minImg(b.x - a.x, b.y - a.y, b.z - a.z);
  return pdPairCore(a, b, dx, dy, W.d3 ? dz : 0, iwK(a, b));
}
function pdLocal(set, skip) {
  if (!pdLive()) return 0;
  let V = 0;
  for (const p of set) {
    if (pdAct(p)) V += p.dmc + pdFieldU(p);
    if (!pdPart(p)) continue;
    const visit = (o) => { if (o === p || o === skip || (set.has(o) && o.id < p.id)) return; V += pdPairE(p, o); };
    nearby(p.x, p.y, RC, visit, p.z);
    for (const o of _late) if (!o.dead) { const [dx, dy, dz] = minImg(o.x - p.x, o.y - p.y, o.z - p.z); if (dx * dx + dy * dy + (W.d3 ? dz * dz : 0) < RC2) visit(o); }
  }
  return V;
}
function pdTotal() {
  if (!pdLive()) return 0;
  let V = 0;
  const md = W.parts.filter(pdPart);
  for (const p of md) if (pdAct(p)) V += p.dmc + pdFieldU(p);
  for (let i = 0; i < md.length; i++) { const a = md[i]; for (let j = i + 1; j < md.length; j++) { const b = md[j]; if (pdAct(a) || pdAct(b)) V += pdPairE(a, b); } }
  return V;
}
/* The force pass: every pair of the neighbour list between different molecules with a dipole in it. */
const PDF = { idx: new Int32Array(0), cr: new Float64Array(0) };
function pdForces(FX, FY, FZ) {
  if (!pdLive()) return;
  if (PDF.idx.length < S.size) { PDF.idx = new Int32Array(S.size * 2).fill(-1); PDF.cr = new Float64Array(S.size * 2); }
  const idx = PDF.idx, act = [], CR = PDF.cr;
  for (const p of W.parts) if (pdPart(p)) CR[p.i] = Math.cbrt(pdAct(p) ? p.dma : pdStaticA(p)); // (the damping's cube roots)
  for (const p of PD.at) if (pdAct(p)) { idx[p.i] = act.length; act.push(p); }
  if (!act.length) return;
  const pi = VL.pi, pj = VL.pj, np = VL.np, X = S.x, Y = S.y, Zp = S.z, K = S.k, Zs = S.Z, DEAD = S.dead, FAST = S.fast, RAD = S.rad, MOL = S.mol, Q = S.q, QP = S.qp, IONIC = S.ionic;
  const d3 = W.d3, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = W.box.d, hw = bw / 2, hh = bh / 2, hd = bd / 2, KE = PHYS.KE;
  for (let q = 0; q < np; q++) {
    const i = pi[q], j = pj[q], ki = idx[i], kj = idx[j];
    if (ki < 0 && kj < 0) continue;
    if (K[i] !== NUC || K[j] !== NUC || Zs[i] === 0 || Zs[j] === 0 || DEAD[i] || DEAD[j] || FAST[i] || FAST[j] || RAD[i] || RAD[j]) continue;
    if (MOL[i] !== 0 && MOL[i] === MOL[j]) continue;
    let dx = X[j] - X[i], dy = Y[j] - Y[i], dz = d3 ? Zp[j] - Zp[i] : 0;
    if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (d3) { if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; } }
    const u = dx * dx + dy * dy + dz * dz; if (u >= RC2) continue;
    const a = ki >= 0 ? act[ki] : null, b = kj >= 0 ? act[kj] : null;
    pdRad(u, PD_S + PD_TH * CR[i] * CR[j]); pdSw(u);
    const g1 = _pdf[1], g2 = _pdf[2], g3 = _pdf[3], sw = _pdw[0], dsw = _pdw[1];
    const qa = Q[i] + QP[i], qb = Q[j] + QP[j], w = (IONIC[i] !== IONIC[j] && (IONIC[i] === 1 ? Q[j] === 0 : Q[i] === 0)) ? K_IW : 1;
    const ax = a ? a.dmx : 0, ay = a ? a.dmy : 0, az = a ? a.dmz : 0, bx = b ? b.dmx : 0, by = b ? b.dmy : 0, bz = b ? b.dmz : 0;
    const A = ax * dx + ay * dy + az * dz, B = bx * dx + by * dy + bz * dz, C = ax * bx + ay * by + az * bz;
    // U/K = S·P, P = 2g′w(qa·B − qb·A) − (2g′C + 4g″AB) (g: the pair's damped soft Coulomb); ∂U/∂d = K(S·∂P/∂d + P·S′·d/r): on b −, on a +
    let P = 2 * g1 * w * (qa * B - qb * A), s1 = 4 * g2 * w * (qa * B - qb * A), c2 = 0; const c1 = 2 * g1 * w;
    if (a && b) { P -= 2 * g1 * C + 4 * g2 * A * B; s1 -= 4 * g2 * C + 8 * g3 * A * B; c2 = 4 * g2; }
    s1 = sw * s1 + P * dsw;
    const Gx = s1 * dx + sw * (c1 * (qa * bx - qb * ax) - c2 * (B * ax + A * bx)), Gy = s1 * dy + sw * (c1 * (qa * by - qb * ay) - c2 * (B * ay + A * by)), Gz = s1 * dz + sw * (c1 * (qa * bz - qb * az) - c2 * (B * az + A * bz));
    FX[i] += KE * Gx; FY[i] += KE * Gy; FX[j] -= KE * Gx; FY[j] -= KE * Gy;
    if (d3) { FZ[i] += KE * Gz; FZ[j] -= KE * Gz; }
  }
  for (const p of act) idx[p.i] = -1;
}
/* Off: every dipole gone, the change of the energy paid as an update's is (or booked to the bath). */
function pdClear() {
  if (!W.parts || !pdLive() || !PD.n) { PD.n = 0; PD.at = []; return; }
  const atoms = PD.at.filter(pdAct); if (!atoms.length) { PD.n = 0; PD.at = []; return; }
  const U0 = pdTotal(); PD.gen++; PD.n = 0; PD.at = []; for (const p of atoms) { p.dmx = p.dmy = p.dmz = p.dmc = 0; }
  pdPay(atoms, -U0, true);
  _noEv = true; computeForces(); _noEv = false;
}
/* The change dU paid by the atoms' motion about their centre of mass; false if it cannot (or, with toBath, booked). */
function pdPay(atoms, dU, toBath) {
  let M0 = 0, Px = 0, Py = 0, Pz = 0; for (const p of atoms) { M0 += p.m; Px += p.m * p.vx; Py += p.m * p.vy; if (W.d3) Pz += p.m * p.vz; }
  const Vx = Px / M0, Vy = Py / M0, Vz = Pz / M0; let Kr = 0;
  for (const p of atoms) Kr += 0.5 * p.m * ((p.vx - Vx) ** 2 + (p.vy - Vy) ** 2 + (W.d3 ? (p.vz - Vz) ** 2 : 0));
  if (!(Kr > 0) || dU > 0.5 * Kr) { if (toBath) W.ledger.bath -= dU; return false; }
  const f = Math.sqrt((Kr - dU) / Kr);
  for (const p of atoms) { p.vx = Vx + f * (p.vx - Vx); p.vy = Vy + f * (p.vy - Vy); if (W.d3) p.vz = Vz + f * (p.vz - Vz); }
  return true;
}
/* The update between steps (from qeqUpdate, on its schedule). Per-atom values in arrays by store index: the dipoles
   before (o) and after (n), the cube roots of the damping's polarizabilities before and after; the pairs from the
   neighbour list (every pair within the reach is on it). */
const PDU = { A: new Float64Array(0), E: new Float64Array(0), M: new Float64Array(0), Et: new Float64Array(0), cap: 0, sl: new Int32Array(0), om: new Uint8Array(0), xo: null, yo: null, zo: null, ro: null, rn: null, pa: new Int32Array(0), pb: new Int32Array(0), pg: new Float64Array(0) };
function pdStaticA(p) { return p.ionic ? PD_ION[p.Z + ',' + p.q] || 0.1 : PD_ATOM[p.Z] || 1; }
/* A pair's energy / K with dipoles (ax…, bx…) and its kernel g′, g″ (faded): 2g′w(qa·B − qb·A) − (2g′C + 4g″AB). */
function pdPU(qa, qb, w, dx, dy, dz, ax, ay, az, bx, by, bz, g1, g2) {
  const A = ax * dx + ay * dy + az * dz, B = bx * dx + by * dy + bz * dz, C = ax * bx + ay * by + az * bz;
  return 2 * g1 * w * (qa * B - qb * A) - 2 * g1 * C - 4 * g2 * A * B;
}
function pdUpdate() {
  pdLive();
  const mols = new Map();
  for (const p of W.parts) {
    if (p.dead || p.k !== NUC || p.Z === 0 || p.ne === 0 || p.fast || p.rad || !p.bonds.length || p.anti) continue;
    let m = mols.get(p.mol); if (!m) mols.set(p.mol, m = []); m.push(p);
  }
  const set = [], A6 = new Float64Array(6);
  let n = 0; for (const m of mols.values()) if (m.length >= 2 && m.length <= QEQ.maxMol) n += m.length;
  if (PDU.A.length < 6 * n) { PDU.A = new Float64Array(12 * n + 12); PDU.E = new Float64Array(6 * n + 6); PDU.M = new Float64Array(6 * n + 6); PDU.Et = new Float64Array(6 * n + 6); }
  if (PDU.cap < S.size) { const c = S.size * 2; PDU.cap = c; PDU.sl = new Int32Array(c).fill(-1); PDU.om = new Uint8Array(c); PDU.xo = new Float64Array(c); PDU.yo = new Float64Array(c); PDU.zo = new Float64Array(c); PDU.ro = new Float64Array(c); PDU.rn = new Float64Array(c); }
  const AL = PDU.A, E = PDU.E, M = PDU.M, Et = PDU.Et, SL = PDU.sl, OM = PDU.om, XO = PDU.xo, YO = PDU.yo, ZO = PDU.zo, RO = PDU.ro, RN = PDU.rn;
  for (const m of mols.values()) if (m.length >= 2 && m.length <= QEQ.maxMol) for (const p of m) {
    if (!pdAlpha(p, A6)) continue;
    AL.set(A6, 6 * set.length); set.push(p);
  }
  const old = PD.at.filter(pdAct);
  if (!set.length && !old.length) return;
  const ns = set.length, ma = new Float64Array(ns);
  for (let k = 0; k < ns; k++) { const a = 6 * k; ma[k] = W.d3 ? (AL[a] + AL[a + 3] + AL[a + 5]) / 3 : (AL[a] + AL[a + 3]) / 2; } // (mean polarizabilities: the damping's)
  // per atom: the damping's cube roots before and after, the old dipoles, the new slots
  const live = [];
  for (const p of W.parts) if (pdPart(p)) { const i = p.i, act = pdAct(p); live.push(p); RO[i] = RN[i] = Math.cbrt(act ? p.dma : pdStaticA(p)); OM[i] = act ? 1 : 0; XO[i] = act ? p.dmx : 0; YO[i] = act ? p.dmy : 0; ZO[i] = act ? p.dmz : 0; }
  for (const p of old) RN[p.i] = Math.cbrt(pdStaticA(p)); // (no dipole after, unless in the new set)
  for (let k = 0; k < ns; k++) { const i = set[k].i; SL[i] = k; RN[i] = Math.cbrt(ma[k]); }
  const K = PHYS.KE, d3 = W.d3, Ex = (W.Ex || 0) / K, Ey = (W.Ey || 0) / K, Ez = d3 ? (W.Ez || 0) / K : 0;
  // the pairs: within the reach, different molecules, an atom of the new set or an old dipole in it
  const pi = VL.pi, pj = VL.pj, nl = VL.np, X = S.x, Y = S.y, Zp = S.z, KK = S.k, Zs = S.Z, DEAD = S.dead, FAST = S.fast, RAD = S.rad, MOL = S.mol, Q = S.q, QP = S.qp, IONIC = S.ionic;
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = W.box.d, hw = bw / 2, hh = bh / 2, hd = bd / 2;
  if (PDU.pa.length < nl) { PDU.pa = new Int32Array(nl * 2 + 16); PDU.pb = new Int32Array(nl * 2 + 16); PDU.pg = new Float64Array(8 * (nl * 2 + 16)); }
  const PA = PDU.pa, PB = PDU.pb, PG = PDU.pg; // (PG per pair: dx, dy, dz, fade, w, g′ and g″ with the new damping, faded)
  let np = 0, U0 = 0;
  for (let q = 0; q < nl; q++) {
    const i = pi[q], j = pj[q];
    if (SL[i] < 0 && SL[j] < 0 && !OM[i] && !OM[j]) continue;
    if (KK[i] !== NUC || KK[j] !== NUC || Zs[i] === 0 || Zs[j] === 0 || DEAD[i] || DEAD[j] || FAST[i] || FAST[j] || RAD[i] || RAD[j]) continue;
    if (MOL[i] !== 0 && MOL[i] === MOL[j]) continue;
    let dx = X[j] - X[i], dy = Y[j] - Y[i], dz = d3 ? Zp[j] - Zp[i] : 0;
    if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (d3) { if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; } }
    const u = dx * dx + dy * dy + dz * dz; if (u >= RC2) continue;
    pdSw(u); const sw = _pdw[0], w = (IONIC[i] !== IONIC[j] && (IONIC[i] === 1 ? Q[j] === 0 : Q[i] === 0)) ? K_IW : 1;
    if (OM[i] || OM[j]) { pdRad(u, PD_S + PD_TH * RO[i] * RO[j]); U0 += sw * pdPU(Q[i] + QP[i], Q[j] + QP[j], w, dx, dy, dz, XO[i], YO[i], ZO[i], XO[j], YO[j], ZO[j], _pdf[1], _pdf[2]); }
    pdRad(u, PD_S + PD_TH * RN[i] * RN[j]);
    const g = 8 * np; PA[np] = i; PB[np] = j; PG[g] = dx; PG[g + 1] = dy; PG[g + 2] = dz; PG[g + 3] = sw; PG[g + 4] = w; PG[g + 5] = sw * _pdf[1]; PG[g + 6] = sw * _pdf[2]; np++;
  }
  U0 *= K; for (const p of old) U0 += p.dmc + pdFieldU(p);
  // the field of the charges and the applied field, at each atom of the set (e/Å²)
  for (let k = 0; k < ns; k++) { E[3 * k] = Ex; E[3 * k + 1] = Ey; E[3 * k + 2] = Ez; }
  for (let k = 0; k < np; k++) {
    const i = PA[k], j = PB[k], g = 8 * k, sa = SL[i], sb = SL[j], F1 = PG[g + 5], w = PG[g + 4], dx = PG[g], dy = PG[g + 1], dz = PG[g + 2];
    if (sa >= 0) { const c = 2 * F1 * w * (Q[j] + QP[j]); E[3 * sa] += c * dx; E[3 * sa + 1] += c * dy; E[3 * sa + 2] += c * dz; }
    if (sb >= 0) { const c = -2 * F1 * w * (Q[i] + QP[i]); E[3 * sb] += c * dx; E[3 * sb + 1] += c * dy; E[3 * sb + 2] += c * dz; }
  }
  // the dipoles: μ = α(E + E_dipoles), iterated from the old ones
  for (let k = 0; k < ns; k++) { const i = set[k].i; M[3 * k] = XO[i]; M[3 * k + 1] = YO[i]; M[3 * k + 2] = ZO[i]; }
  let it = 0, err = Infinity;
  for (; it < PD_MAXIT && err > PD_TOL; it++) {
    for (let k = 0; k < 3 * ns; k++) Et[k] = E[k];
    for (let k = 0; k < np; k++) {
      const sa = SL[PA[k]], sb = SL[PB[k]]; if (sa < 0 || sb < 0) continue;
      const g = 8 * k, dx = PG[g], dy = PG[g + 1], dz = PG[g + 2], F1 = PG[g + 5], F2 = PG[g + 6];
      const Bd = M[3 * sb] * dx + M[3 * sb + 1] * dy + M[3 * sb + 2] * dz, Ad = M[3 * sa] * dx + M[3 * sa + 1] * dy + M[3 * sa + 2] * dz;
      Et[3 * sa] += 2 * F1 * M[3 * sb] + 4 * F2 * Bd * dx; Et[3 * sa + 1] += 2 * F1 * M[3 * sb + 1] + 4 * F2 * Bd * dy; Et[3 * sa + 2] += 2 * F1 * M[3 * sb + 2] + 4 * F2 * Bd * dz;
      Et[3 * sb] += 2 * F1 * M[3 * sa] + 4 * F2 * Ad * dx; Et[3 * sb + 1] += 2 * F1 * M[3 * sa + 1] + 4 * F2 * Ad * dy; Et[3 * sb + 2] += 2 * F1 * M[3 * sa + 2] + 4 * F2 * Ad * dz;
    }
    err = 0;
    for (let k = 0; k < ns; k++) {
      const a = 6 * k, x = Et[3 * k], y = Et[3 * k + 1], z = d3 ? Et[3 * k + 2] : 0;
      const mx = AL[a] * x + AL[a + 1] * y + AL[a + 2] * z, my = AL[a + 1] * x + AL[a + 3] * y + AL[a + 4] * z, mz = d3 ? AL[a + 2] * x + AL[a + 4] * y + AL[a + 5] * z : 0;
      const nx = 0.3 * M[3 * k] + 0.7 * mx, ny = 0.3 * M[3 * k + 1] + 0.7 * my, nz = 0.3 * M[3 * k + 2] + 0.7 * mz; // (mixed: steady where dipoles crowd)
      const e = Math.max(Math.abs(nx - M[3 * k]), Math.abs(ny - M[3 * k + 1]), Math.abs(nz - M[3 * k + 2])); if (e > err) err = e;
      M[3 * k] = nx; M[3 * k + 1] = ny; M[3 * k + 2] = nz;
    }
  }
  PD.iters += it;
  const clean = () => { for (let k = 0; k < ns; k++) SL[set[k].i] = -1; };
  let big = false; for (let k = 0; k < 3 * ns; k++) if (!(Math.abs(M[k]) < PD_MAXMU)) big = true;
  if (err > 100 * PD_TOL || big) { clean(); PD.skipped++; return; } // (not settled, or a runaway: the dipoles stay as they were)
  // the energy after: the pairs with the new dipoles and damping, the atoms' own terms
  let U1 = 0;
  for (let k = 0; k < np; k++) {
    const i = PA[k], j = PB[k], g = 8 * k, sa = SL[i], sb = SL[j];
    U1 += pdPU(Q[i] + QP[i], Q[j] + QP[j], PG[g + 4], PG[g], PG[g + 1], PG[g + 2], sa >= 0 ? M[3 * sa] : 0, sa >= 0 ? M[3 * sa + 1] : 0, sa >= 0 ? M[3 * sa + 2] : 0, sb >= 0 ? M[3 * sb] : 0, sb >= 0 ? M[3 * sb + 1] : 0, sb >= 0 ? M[3 * sb + 2] : 0, PG[g + 5], PG[g + 6]);
  }
  U1 *= K;
  const self = new Float64Array(ns);
  for (let k = 0; k < ns; k++) { const mx = M[3 * k], my = M[3 * k + 1], mz = M[3 * k + 2], sv = pdSelf(AL.subarray(6 * k, 6 * k + 6), mx, my, mz); self[k] = isFinite(sv) ? K * sv : 0; U1 += self[k] - (mx * (W.Ex || 0) + my * (W.Ey || 0) + (d3 ? mz * (W.Ez || 0) : 0)); }
  const dU = U1 - U0, payers = [];
  for (const m of mols.values()) if (m.length >= 2 && m.length <= QEQ.maxMol) for (const p of m) if (SL[p.i] >= 0 || OM[p.i]) { for (const o of m) payers.push(o); break; }
  for (const p of old) if (!(p.mol !== 0 && mols.has(p.mol))) payers.push(p);
  if (!payers.length || !pdPay(payers, dU, false)) { clean(); PD.skipped++; return; } // (cannot pay: as it was)
  const gen = PD.gen;
  for (const p of old) { p.dm = 0; p.dmx = p.dmy = p.dmz = p.dmc = 0; }
  for (let k = 0; k < ns; k++) { const p = set[k]; p.dm = gen; p.dmx = M[3 * k]; p.dmy = M[3 * k + 1]; p.dmz = M[3 * k + 2]; p.dma = ma[k]; p.dmc = self[k]; }
  clean();
  PD.at = set; PD.n = ns; PD.parts = W.parts; PD.upd++; PD.dU += dU;
  _noEv = true; computeForces(); _noEv = false;
}
/* A molecule's polarizability tensor as the game has it (tests, tools/polfit.js): the sum of its atoms' (xx, xy, xz, yy, yz, zz). */
function pdMolAlpha(atoms) { const T = new Float64Array(6), A6 = new Float64Array(6); for (const p of atoms) if (pdAlpha(p, A6)) for (let k = 0; k < 6; k++) T[k] += A6[k]; return T; }

/* ---- Realistic particles: Rayleigh scattering (1.27, feature 22; Settings → Experimental → Realistic particles,
   RP.ray). Light that cannot ionize (infrared, visible, near ultraviolet) is scattered elastically by molecules and
   atoms: the field ε drives the molecule's induced dipole d = α·ε (α its polarizability tensor: the bonds' tensors of
   polarizability by direction, PD_BOND, summed over the molecule; a lone atom or ion its own, RY_ATOM / PD_ION; in the
   flat game the molecule's in-plane tensor, and across the plane the mean of the two in it), which radiates as a dipole:
   - the rate goes as k⁴|d|², so blue light (400 nm) scatters (700/400)⁴ = 9.4 times as often as red (the blue sky);
   - the new direction n̂ with weight |d|² − (d·n̂)² (unpolarized light on an isotropic molecule: (1 + cos²θ), none at
     90° in the plane of the polarization), and its polarization along d's part across n̂ (light scattered at 90° from
     an isotropic molecule is fully polarized; an anisotropic one, CO₂, N₂, depolarizes it a little);
   - the photon keeps its energy (the molecule's recoil, about 10⁻¹¹ eV, is left out), so the books are untouched.
   In a nanometre box the true rate is tiny: σ = (8π/3)k⁴|d|² is 5×10⁻²⁷ cm² for N₂ at 532 nm (a photon crosses
   about 80 km of air before it scatters once). As the box's other light–matter rates, it is shown made visible:
   RY.P0 per molecule passed for N₂ at 450 nm, the ratios between colours and molecules the true ones (capped at RY.cap);
   ultra-realistic mode keeps the true rate (σ over the 0.6 Å strip's area: about 10⁻¹⁰ a molecule passed). Each
   molecule is tried once a photon, after its absorption; a scattered photon counts one level of the photon's chain
   (rayInteract's depth: past 3 it does not interact again). */
const RY = { P0: 0.01, Eref: 2.7552, aref: 1.74, cap: 0.5, n: 0, tried: 0 }; // (Eref: hc/450 nm, eV; aref: N₂'s mean polarizability, Å³)
const RY_ATOM = { 1: 0.667, 2: 0.205, 10: 0.396, 18: 1.64, 36: 2.48, 54: 4.04, 86: 5.3, 6: 1.76, 7: 1.10, 8: 0.802, 9: 0.557, 17: 2.18, 35: 3.05, 53: 5.35 }; // (lone atoms, Å³; CRC, from memory)
const RY_HBARC = 1973.27; // (ħc, eV·Å)
const _ryT = new Float64Array(6), _ryA = new Float64Array(6);
/* The molecule's (or the lone atom's) tensor, as the 3-D one (xx, xy, xz, yy, yz, zz), into _ryT; false if none. */
function ryTensor(p) {
  _ryT.fill(0);
  if (p.bonds.length) {
    const atoms = molecule(p);
    if (atoms.length <= 200) { for (const a of atoms) if (pdAlpha(a, _ryA)) for (let k = 0; k < 6; k++) _ryT[k] += _ryA[k]; }
    else { let s = 0; for (const a of atoms) s += (PD_ATOM[a.Z] || 0) * PD_F; _ryT[0] = _ryT[3] = _ryT[5] = s; } // (a large lump: its atoms' share, isotropic)
    if (!W.d3) _ryT[5] = (_ryT[0] + _ryT[3]) / 2;
  } else {
    const a = p.ionic || p.q ? PD_ION[p.Z + ',' + p.q] || 0 : RY_ATOM[p.Z] || PD_ATOM[p.Z] || 0;
    _ryT[0] = _ryT[3] = _ryT[5] = a;
  }
  return _ryT[0] + _ryT[3] + _ryT[5] > 0;
}
/* The chance that a photon of energy E, polarized ε, passing p's molecule scatters there; with the dipole d into out[3..5]. */
function ryChance(p, E, ex, ey, ez, out) {
  if (!ryTensor(p)) return 0;
  const T = _ryT, dx = T[0] * ex + T[1] * ey + T[2] * ez, dy = T[1] * ex + T[3] * ey + T[4] * ez, dz = T[2] * ex + T[4] * ey + T[5] * ez;
  out[3] = dx; out[4] = dy; out[5] = dz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (W.ultra) { const k = E / RY_HBARC; return Math.min(1, (8 * Math.PI / 3) * k * k * k * k * d2 / (Math.PI * 0.36)); } // (the true cross section over the strip's area)
  const f = W.d3 ? d2 / (RY.aref * RY.aref) : (d2 - 0.5 * (dx * dx + dy * dy)) / (0.75 * RY.aref * RY.aref); // (the mean of |d⊥|² over the directions it can go, against N₂'s for unpolarized light: in the flat game round the plane)
  const r = E / RY.Eref;
  return Math.min(RY.cap, RY.P0 * r * r * r * r * f);
}
const _ryD = [0, 0, 0, 0, 0, 0];
/* rayInteract's question for p: a hit object (the photon's line ends at h, the scattered photon goes on from p) or null.
   seen: the molecules already tried for this photon. */
function ryTry(p, E, ux, uy, uz, pol, depth, seen, h) {
  const key = p.mol || -p.id - 1; if (seen.has(key)) return null; seen.add(key);
  let ex, ey, ez;
  if (pol) { ex = pol[0]; ey = pol[1]; ez = pol[2] || 0; } else { const e = polRand(ux, uy, uz); ex = e[0]; ey = e[1]; ez = e[2]; }
  RY.tried++;
  const P = ryChance(p, E, ex, ey, ez, _ryD);
  if (!(P > 0) || !(rnd() < P)) return null;
  const dx = _ryD[3], dy = _ryD[4], dz = _ryD[5];
  h.p = p; h.after = () => ryScatter(p, E, dx, dy, dz, depth);
  return h;
}
/* The scattered photon: a direction drawn with weight |d|² − (d·n̂)² (in the plane, round the circle, in the flat game),
   its polarization d's part across it. */
function ryScatter(p, E, dx, dy, dz, depth) {
  if (p.dead) return;
  const d2 = dx * dx + dy * dy + dz * dz;
  let nx = 1, ny = 0, nz = 0;
  for (let k = 0; k < 64; k++) {
    if (W.d3) { const u = rndDir(); nx = u[0]; ny = u[1]; nz = u[2]; } else { const a = rnd() * 2 * Math.PI; nx = Math.cos(a); ny = Math.sin(a); nz = 0; }
    const dn = dx * nx + dy * ny + dz * nz;
    if (rnd() * d2 <= d2 - dn * dn) break;
  }
  RY.n++;
  const dn = dx * nx + dy * ny + dz * nz; let px = dx - dn * nx, py = dy - dn * ny, pz = dz - dn * nz; const L = Math.hypot(px, py, pz) || 1; px /= L; py /= L; pz /= L;
  emitPhoton(p.x, p.y, E, nx, ny, { depth: depth + 1, src: p, cont: true, uz: nz, pol: RP.pol ? [px, py, pz] : undefined });
}

/* ---- Realistic particles: photons as waves, X-ray diffraction (1.27, feature 19; RP.pwave; the flat game). An X-ray
   (1–100 keV) passing an atom may be scattered coherently by the atoms about it: every electron there scatters the same
   wave, and the waves add with their phases, so the photon leaves in a direction n̂ drawn from
     |F(q)|² = |Σⱼ fⱼ(q) e^(i q·rⱼ)|² · (1 − (ε·n̂)²),  q = k(n̂ − û),  k = 2π/λ
   over the atoms about the one it passed (weighted e^(−r²/2σ²), σ = WVB.sig, out to WVB.R: a beam's coherent patch; fⱼ(0) = the atom's electrons, falling as e^(−0.05 q²) with q; the
   last factor the dipole's, ε the photon's polarization, or a random one). A crystal sends it into Bragg's directions
   (2d sin θ = mλ for its rows: spots on a screen), a liquid into rings, a gas nearly anywhere. The straight-on peak
   (q < 3/σ: the wave passing through, not a scattering) is left out. Elastic (the crystal's recoil left out): the books
   are untouched. As the box's other light rates, made visible: WVB.P0·(electrons/10)² an atom passed for random phases
   (a gas), times what the phases add (waveBraggTry). Drawn on a grid of 1,024 directions round the circle, then anywhere
   within its cell. */
const WVB = { P0: 0.002, GMAX: 25, R: 20, sig: 8, maxN: 400, M: 1024, n: 0, tries: 0 }; // (the coherent region: a Gaussian weight of width sig about the atom passed, out to R; a sharp edge would scatter as a particle's edge does. P0: the rate per atom passed of scattering with random phases (a gas); GMAX: the most the phases can add to it)
/* Tried at P0·GMAX·(electrons/10)² an atom passed (rayInteract): the coherent sum's whole strength over the directions
   against the same atoms with random phases, g = Σ|F|² / Σ(Σf²) (1 for a gas, up to tens on a Bragg reflection, under 1
   for a crystal turned off every reflection), is kept with odds g/GMAX, so the rate follows the structure factor as the
   direction does; [nx, ny, ε'] or null (the photon goes on). */
function waveBraggTry(p, E, ux, uy, pol) {
  if (p.dead) return null;
  WVB.tries++;
  const lam = 10 * PHYS.HC / E, k = 2 * Math.PI / lam, R = WVB.R, sg = WVB.sig, qmin = 3 / sg;
  const near = [];
  nearby(p.x, p.y, R, (o) => { if (o.k === NUC && !o.dead && !o.fast && !o.rad && o.ne > 0) { const [dx, dy] = minImg(o.x - p.x, o.y - p.y); const r2 = dx * dx + dy * dy; if (r2 < R * R) near.push([r2, dx, dy, o.ne * Math.exp(-r2 / (2 * sg * sg))]); } });
  if (!near.some(e => e[0] === 0)) near.push([0, 0, 0, p.ne]);
  near.sort((a, b) => a[0] - b[0]); if (near.length > WVB.maxN) near.length = WVB.maxN;
  let f2 = 0; for (const e of near) f2 += e[3] * e[3];
  const ep = pol && RP.pol ? pol : polRand(ux, uy, 0), M = WVB.M, I = new Float64Array(M);
  let tot = 0, inc = 0;
  for (let m = 0; m < M; m++) {
    const ph = (m + 0.5) * 2 * Math.PI / M, nx = Math.cos(ph), ny = Math.sin(ph), qx = k * (nx - ux), qy = k * (ny - uy), q2 = qx * qx + qy * qy;
    if (q2 < qmin * qmin) continue;
    let re = 0, im = 0; for (const [, dx, dy, f] of near) { const a = qx * dx + qy * dy; re += f * Math.cos(a); im += f * Math.sin(a); }
    const en = ep[0] * nx + ep[1] * ny, w = Math.exp(-0.1 * q2) * (1 - en * en);
    tot += I[m] = (re * re + im * im) * w; inc += f2 * w;
  }
  if (!(tot > 0) || !(inc > 0) || !(rnd() * WVB.GMAX < tot / inc)) return null;
  let u = rnd() * tot, m = 0; for (; m < M - 1 && u > I[m]; m++) u -= I[m];
  const ph = (m + rnd()) * 2 * Math.PI / M, nx = Math.cos(ph), ny = Math.sin(ph);
  return [nx, ny, RP.pol ? polAcross(ep, nx, ny, 0) || undefined : undefined];
}
function waveBraggEmit(p, E, r, depth) {
  if (p.dead) return;
  WVB.n++;
  emitPhoton(p.x, p.y, E, r[0], r[1], { depth: depth + 1, src: p, cont: true, pol: r[2] });
}
