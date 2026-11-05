/* ------------------------------------------------------------------ continuous bond orders (Experimental, 1.13)
   With Settings → Experimental → Continuous bond orders on, neutral molecules of non-metals (H, B, C, N, O, F, Si, P,
   S, Cl, Br, I; Ge, As, Se, Sn, Sb, Te since 1.25, tin in its molecules only) keep no stored bonds: every pair's bond order is worked out at every step from where the atoms are, and
   the energy is a smooth function of the positions (model E, tools/bo-proto2.js; the derivation and its checks in
   PERF-NOTES, 1.12 and 1.13). So bonds stretch, weaken and break, and new ones grow, continuously, and reactions find
   their own barriers (H + H₂: 0.41 eV, measured 0.42) instead of the classic chemistry's events.
     raw order   n⁰ from the distance: Pauling's exp((r₁ − r)/c) inside the single-bond length, exp(−α₁²(r − r₁)²)
                 beyond it, tapered to nothing at r₁ + 1.3 Å; weak ones (below 0.35) fade out by 0.15
     valence     each atom shares out its valence: a level L with Σ ramp(cₖ − L) = V over its partners (cₖ: n⁰ capped by
                 what that partner can give at all), so the weakest go first; the pair keeps the smaller of its two
                 atoms' answers (smooth minima, rounded ramps: the energy has continuous forces)
     energy      a Morse curve of the order (depth from the game's tables between whole orders, Pauling's length,
                 the nearest whole order's stiffness), a soft core, and the game's VSEPR angle terms, blended in by
                 order; forces by the chain rule backwards (tools/bo-fast.js checks them against numerical ones)
   Between member atoms the usual non-bonded pair (the kernel's) is left out (VL.ex = 1) and replaced here by the same
   Lennard-Jones, switched on smoothly from r₁ + 1.3 to r₁ + 1.8 Å, where the bond terms have let go. Member atoms carry
   partial charges from their orders since 1.16 (boCoulomb), so hydrogen bonds form between them.
   Membership is by whole clusters (stored bonds for the rest, these orders above 0.3 for members): a cluster joins
   when all its atoms qualify (its stored bonds are let go) and leaves when one stops qualifying (an ion forms, a
   nucleus changes): it gets stored bonds again, whole orders shared out from its last orders. Each change is paid
   for exactly: the energy before and after at the same positions, the difference to the bath (as for quantum
   nuclei's rings). */
// (BO itself is made in engine.js, which runs first and asks it)
/* A hydrogen's order to N, O or F starts at a raw order of 0.04 (rising to whole at 0.12), not 0.15 (0.35) (1.20): a
   proton passing between two waters bonds to the second one as it leaves the first, not only once it is 1.45 Å from it
   (the gap left a 1.2 eV barrier in a hop between waters 2.65 Å apart; 0.35 eV now). */
const BO_TAH = 0.04, BO_TBH = 0.12;
const BO_EPS = 0.03, BO_PLOW = 1.15, BO_WIN = 0.05, BO_TA = 0.15, BO_TB = 0.35, BO_SW = 0.5; // (smoothing; Dof's power below a single bond; the taper; the non-bonded switch's width)
const boSp = (x) => x <= -BO_EPS ? 0 : x >= BO_EPS ? x : (x + BO_EPS) * (x + BO_EPS) / (4 * BO_EPS);
const boSpD = (x) => x <= -BO_EPS ? 0 : x >= BO_EPS ? 1 : (x + BO_EPS) / (2 * BO_EPS);
const boH = (d) => d < BO_EPS ? 0.5 * d * (1 - d / BO_EPS) * (1 - d / BO_EPS) : 0;
const boFade = (c) => { const t = c <= 0 ? 0 : c >= 2 * BO_EPS ? 1 : c / (2 * BO_EPS); return t * t * (3 - 2 * t); }; // (a partner asking for nothing counts for nothing)
const boFadeD = (c) => { if (c <= 0 || c >= 2 * BO_EPS) return 0; const t = c / (2 * BO_EPS); return 6 * t * (1 - t) / (2 * BO_EPS); };
const boHD = (d) => d < BO_EPS ? 0.5 * (1 - d / BO_EPS) * (1 - d / BO_EPS) - d * (1 - d / BO_EPS) / BO_EPS : 0;
const BO_KH = 0.05;
const BO_TG = new Map(); // (the VSEPR targets, sorted, by partners, lone pairs, period, all-hydrogen)
/* the pair's constants, by element pair */
function boPP(ea, eb) {
  const key = ea.Z < eb.Z ? ea.Z * 128 + eb.Z : eb.Z * 128 + ea.Z; let v = BO.cache.get(key);
  if (!v) {
    const r = [1, 2, 3].map(o => bondLength(ea, eb, o)), D = [1, 2, 3].map(o => bondEnergy(ea, eb, o)), al = [1, 2, 3].map(o => morseA(ea, eb, o));
    const t = BONDS[bondKey(ea, eb)], two = !!(t && t.l && t.l[1]);
    const c = two ? Math.min(0.45, Math.max(0.2, (r[0] - r[1]) / Math.LN2)) : Math.sqrt(BO_PLOW / 2) / al[0];
    v = { r, D, al, c, sig: 0.62 * r[0], beta: al[0] * al[0], reach: r[0] + 1.3 };
    BO.cache.set(key, v);
  }
  return v;
}
/* Can this atom take part? (whole clusters decide: boSync) */
function boOK(p) {
  return p.k === NUC && !p.dead && !p.fast && !p.rad && !p.anti && p.Z > 0 && (BO.qm ? p.Z <= 86 : BO.Ztab.has(p.Z)) && p.ne > 0 && Math.abs(p.q) <= 1 && !p.exo && !p.mu; // (singly charged ions too, since 1.16: H₃O⁺, OH⁻, NH₄⁺)
}
const boMetal = (p) => !!(p.el && p.el.metal); // (tin, of the bond orders' elements, 1.25)
/* Crowded flat molecules (1.16). Two atoms bonded to one centre much more strongly than to each other don't bond to each
   other, as a stored molecule's 1-3 pairs don't: in a flat world SF₆'s six fluorines sit 60° apart, as far from each other
   as from the sulfur, near an F–F bond's length, and each F split its one valence three ways (S–F 0.5, F–F 0.2–0.34; PCl₅'s
   chlorines 0.4 to each other). A pair i–j's raw order is multiplied by Πₖ(1 − b(n⁰ᵢₖ)·b(n⁰ₖⱼ)·σ), over the centres k it
   shares, σ rising from 0 to 1 as the weaker bond to the centre beats the i–j bond by 0.4 to 0.8 eV (single bonds'
   energies): S–F against F–F 1.8 eV (out), P–Cl against Cl–Cl 0.9, a ring of equals (cyclopropane, epoxides) 0–0.1 (kept);
   diborane's B–B goes, as in the real molecule (its bridging hydrogens hold it). Raw orders only, so no circle. */
/* Partial charges that follow the orders (1.16). Each pair gives its atoms K·Δχ·h(n) (K = 0.30 e per unit of Pauling
   electronegativity, as a stored bond does), h(n) = 1 + 0.2(n − 1) at and above a single bond, the order itself below it
   (fading out as the bond breaks), the corner at 1 rounded over ±0.05. The members' charges meet everything charged as a
   stored molecule's do: non-members through the kernel (S.qp), each other here, the same soft Coulomb, with bonded (1-2)
   and angle (1-3) pairs left out smoothly: weight (1 − b(nᵢⱼ))·Πₖ(1 − b(nᵢₖ)·b(nₖⱼ)), b rising from 0 at order 0.3 to
   1 at 0.7. The charges depend on the positions, so the forces carry their slopes too: φᵢ·∂qᵢ/∂n for every order, φ the
   potential at the atom from every charge it meets (the kernel's pairs and these), into the orders' own back-pass. */
const boB = (n) => { if (n <= 0.3) return 0; if (n >= 0.7) return 1; const t = (n - 0.3) / 0.4; return t * t * (3 - 2 * t); };
const boBD = (n) => { if (n <= 0.3 || n >= 0.7) return 0; const t = (n - 0.3) / 0.4; return 6 * t * (1 - t) / 0.4; };
/* ---- the orders' pass on flat arrays (1.17; the 1.13–1.17 pass on objects it replaced is gone since 1.19), written over typed arrays (pairs and members
   by index, the pair constants in a table) so that it runs without allocating and can move to WebAssembly as it is. */
const BF = { useWasm: true, np: 0, nm: 0, pcapN: 0, mcapN: 0, ns: 0, scap: 0, PT: new Float64Array(16 * 64), nt: 0, mem: [], inc: new Int32Array(256), r13: 4.4, puz: new Float64Array(0) }; // (r13: how far apart an angle's (1-3) two ends can be, bfType)
const BF_PS = 16; // (the pair-type table's stride: r1 c β σ reach D1 D2 D3 α1 α2 α3 rm ε rOn rCut)
function bfType(a, b) {
  const P = boPP(a.el, b.el);
  if (P.t === undefined) {
    if (P.eps === undefined) { const lj = ljPair(a, b); P.rm = lj[0]; P.eps = lj[1]; P.rOn = Math.max(P.reach, 0.62 * lj[0] + 0.05); P.rCut = 2.6 * lj[0]; }
    if ((BF.nt + 1) * BF_PS > BF.PT.length) { const t = bfArr(Float64Array, BF.PT.length * 2); t.set(BF.PT); BF.PT = t; }
    const o = BF.nt * BF_PS, T = BF.PT;
    T[o] = P.r[0]; T[o + 1] = P.c; T[o + 2] = P.beta; T[o + 3] = P.sig; T[o + 4] = P.reach; T[o + 5] = P.D[0]; T[o + 6] = P.D[1]; T[o + 7] = P.D[2];
    T[o + 8] = P.al[0]; T[o + 9] = P.al[1]; T[o + 10] = P.al[2]; T[o + 11] = P.rm; T[o + 12] = P.eps; T[o + 13] = P.rOn; T[o + 14] = P.rCut;
    P.t = BF.nt++;
    if (2 * P.reach > BF.r13) BF.r13 = 2 * P.reach; // (a 1-3 pair is looked for out to two bonds' reach: it was 4.4 Å, and SbCl₃'s Cl–Sb–Cl, 2.33 Å bonds at 143°, crossed it and lost its exclusion in one step, 0.089 eV, 1.25)
  }
  return P.t;
}
const BF_PF = ['r', 'ux', 'uy', 'gr', 'gn', 'gca', 'gcb', 'n', 'ne', 'ne0', 'dne', 'dne0', 'ca', 'cb', 'dca', 'dcb', 'sA', 'tA', 'sB', 'tB', 'qc', 'qdh', 'K', 'csh', 'fa', 'fb'];
const BF_PI = ['a', 'b', 't', 'ss', 'sn'];
const BF_MF = ['en', 'cap', 'capH', 'val', 'ls', 'lv', 'gl', 'keep', 'q', 'phi', 'qn', 'im', 'ljR', 'ljS', 'pol', 'gw', 'sn', 'gf', 'dcap', 'dcapH', 'dval', 'deI', 'gq', 'Gc', 'Gh', 'Gv', 'Gd'];
const BF_MI = ['slot', 'per', 'db', 'Z', 'f0', 'fc', 'fl', 'cl'];
const bfArr = (T, n) => WK.on ? wasmArray(T, n) : new T(n); // (in the module's memory when there is one: the Rust pass reads them, 1.18)
function bfGrow(np, nm) {
  if (np > BF.pcapN) { const c = Math.max(np * 2, 256); for (const k of BF_PF) BF['p' + k] = bfArr(Float64Array, c); for (const k of BF_PI) BF['p' + k] = bfArr(Int32Array, c); BF.pcapN = c; }
  if (nm > BF.mcapN) { const c = Math.max(nm * 2, 64); for (const k of BF_MF) BF['m' + k] = bfArr(Float64Array, c); for (const k of BF_MI) BF['m' + k] = bfArr(Int32Array, c); BF.inc = bfArr(Int32Array, 2 * Math.max(np * 2, 256) + 2 * c); BF.mcapN = c; }
  if (BF.inc.length < 2 * np) BF.inc = bfArr(Int32Array, 4 * np);
}
/* members by index, and the pairs within the cutoff: from the neighbour list in a force pass, from the grid otherwise */
let BF_SM = new Int32Array(256), BF_TZ = new Int32Array(128 * 128).fill(-1); // (slot → member index + 1; element pair → pair type)
/* Moving charge (1.20). A member's electrons are a continuous count ν = ne + δ: δ moves within its molecule (bfDq), so
   the +1 of H₃O⁺ can pass to a neighbouring water with the proton. Its internal energy, capacity, expanded capacity and
   valence follow ν: each the game's own value at whole counts (internalE, capacity, hyperCap, valenceInfo), straight lines
   between (the internal energy's slopes are the measured ionization energies and electron affinity), each corner rounded
   over ±BO_QW so that the value at a whole count is exact (Q below: the slope dips and overshoots within the corner). */
const BO_QW = 0.05;
const BO_NU = new Map(); // (Z → { E, cap, capH, val } at whole counts 0 … Z + 2)
function bfNuTab(Z) {
  let T = BO_NU.get(Z); if (T) return T;
  const el = ELEMENTS[Math.min(Z, Z_MAX)], n = Z + 3; T = { E: new Float64Array(n), cap: new Float64Array(n), capH: new Float64Array(n), val: new Float64Array(n), at: [] };
  let E = 0;
  for (let ne = 0; ne < n; ne++) {
    if (ne > 0) { const ie = ionE(Z, ne); E -= isFinite(ie) ? ie : 0; }
    T.E[ne] = E;
    if (ne === 0) continue;
    const vi = valenceInfo(Z, ne), f = { el, Z, ne, q: Z - ne, val: vi.v, nOut: vi.n, cap: 0 };
    f.cap = capacity(f); T.cap[ne] = f.cap; T.capH[ne] = hyperCap(f); T.val[ne] = vi.v;
  }
  BO_NU.set(Z, T); return T;
}
let _qv = 0, _qd = 0, _qdd = 0; // (bfNu's value, slope and curvature)
function bfNu(tab, nu) {
  const top = tab.length - 2; let K = Math.floor(nu); if (K < 0) K = 0; else if (K > top) K = top;
  const x = nu - K, sK = tab[K + 1] - tab[K];
  _qv = tab[K] + sK * x; _qd = sK; _qdd = 0;
  if (x < BO_QW && K > 0) { // (the corner at K, from its right: the right line plus ΔS·ε·(Q(t) − t))
    const dS = sK - (tab[K] - tab[K - 1]), t = x / BO_QW;
    if (dS) { _qv += dS * BO_QW * (t / 2 + 0.75 * t * t - 0.25 * t * t * t * t - t); _qd += dS * (0.5 + 1.5 * t - t * t * t - 1); _qdd = dS / BO_QW * (1.5 - 3 * t * t); }
  } else if (x > 1 - BO_QW && K + 1 <= top) { // (the corner at K + 1, from its left: the left line plus ΔS·ε·Q(t))
    const dS = (tab[K + 2] - tab[K + 1]) - sK, t = (x - 1) / BO_QW;
    if (dS) { _qv += dS * BO_QW * (t / 2 + 0.75 * t * t - 0.25 * t * t * t * t); _qd += dS * (0.5 + 1.5 * t - t * t * t); _qdd = dS / BO_QW * (1.5 - 3 * t * t); }
  }
}
function bfMembers() {
  const mem = BF.mem;
  for (const p of mem) if (p.i < BF_SM.length) BF_SM[p.i] = 0; // (the last pass's members off the map)
  mem.length = 0;
  if (BF_SM.length < S.size) BF_SM = bfArr(Int32Array, S.size * 2);
  for (const p of W.parts) if (p.bom && !p.dead) { p._bm = mem.length; BF_SM[p.i] = mem.length + 1; mem.push(p); }
  const nm = mem.length; bfGrow(Math.max(BF.pcapN, 64), Math.max(nm, 1));
  let eI = 0, kq = 0;
  for (let m = 0; m < nm; m++) {
    const p = mem[m]; BF.mslot[m] = p.i; BF.men[m] = p.el.en || 2.6; BF.mval[m] = p.val; BF.mper[m] = periodOf(p.el.Z); BF.mdb[m] = p.el.dblock ? 1 : 0; BF.mZ[m] = p.Z;
    BF.mls[m] = p._boLs === undefined ? NaN : p._boLs; BF.mqn[m] = p.q; BF.mim[m] = S.im[p.i];
    BF.mfl[m] = _lrOn && isLR(p) ? 1 : 0;
    { // (the electron count's share: capacity, expanded capacity, valence and internal energy follow ν = ne + δ)
      const T = bfNuTab(p.Z), d = p._dq || 0;
      if (d === 0) { // (a whole count, as most are: the values and slopes there, made once)
        let w = T.at[p.ne]; if (!w) { w = T.at[p.ne] = new Float64Array(8); const nu = p.ne; bfNu(T.cap, nu); w[0] = _qv; w[1] = _qd; bfNu(T.capH, nu); w[2] = _qv; w[3] = _qd; bfNu(T.val, nu); w[4] = _qv; w[5] = _qd; bfNu(T.E, nu); w[6] = _qd; w[7] = _qdd; }
        BF.mcap[m] = w[0]; BF.mdcap[m] = w[1]; BF.mcapH[m] = w[2]; BF.mdcapH[m] = w[3]; BF.mval[m] = w[4]; BF.mdval[m] = w[5]; BF.mdeI[m] = w[6]; if (w[7] > kq && p.Z > 1) kq = w[7];
        BF.mqn[m] = p.q;
      } else {
        const nu = p.ne + d;
        bfNu(T.cap, nu); BF.mcap[m] = _qv; BF.mdcap[m] = _qd;
        bfNu(T.capH, nu); BF.mcapH[m] = _qv; BF.mdcapH[m] = _qd;
        bfNu(T.val, nu); BF.mval[m] = _qv; BF.mdval[m] = _qd;
        bfNu(T.E, nu); eI += _qv - T.E[p.ne]; BF.mdeI[m] = _qd; if (_qdd > kq) kq = _qdd;
        BF.mqn[m] = p.q - d;
      }
    }
    BF.mcl[m] = p._bcl === undefined ? -1 - m : p._bcl; // (its molecule: the atoms joined by orders above 0.3, bfClusters)
    BF.mljR[m] = p.el.uffR; BF.mljS[m] = Math.sqrt(p.el.uffD * LJ_SCALE); // (the atom's own size: a hydrogen's shrinks with its bonds to N, O, F, bfCoulomb)
  }
  BF.nm = nm; BF.eI = eI; BF.kq = kq;
  return nm;
}
function bfCollect(useVL) { bfMembers(); return bfPairsJS(useVL); }
function bfPairsJS(useVL) {
  const mem = BF.mem, ION = S.ionic;
  let n = 0;
  const X = S.x, Y = S.y, OBJ = S.obj, Zs = S.Z, Q = S.q, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2, c0 = 1 / Math.sqrt(RC2 + 0.09), KE = PHYS.KE, SM = BF_SM, TZ = BF_TZ;
  const d3 = W.d3, Zp = S.z, bd = W.box.d, hd = bd / 2; // (3-D: the pairs in depth, their z directions in BF.puz, 1.25)
  if (d3 && BF.puz.length < BF.pcapN) BF.puz = new Float64Array(BF.pcapN);
  const put = (i, j, ma, mb, dx, dy, r2, dz) => {
    if (n >= BF.pcapN) { const keep = {}; for (const k of BF_PF.concat(BF_PI)) keep[k] = BF['p' + k]; BF.pcapN = 0; bfGrow(n + 1, 0); for (const k of BF_PF.concat(BF_PI)) BF['p' + k].set(keep[k].subarray(0, n)); if (d3) { const z = new Float64Array(BF.pcapN); z.set(BF.puz.subarray(0, n)); BF.puz = z; } }
    const r = Math.sqrt(r2), za = Zs[i], zb = Zs[j], key = za < zb ? za * 128 + zb : zb * 128 + za;
    if (d3) BF.puz[n] = dz / r;
    let t = TZ[key]; if (t < 0) t = TZ[key] = bfType(OBJ[i], OBJ[j]);
    BF.pa[n] = ma; BF.pb[n] = mb; BF.pr[n] = r; BF.pux[n] = dx / r; BF.puy[n] = dy / r; BF.pt[n] = t;
    BF.pK[n] = KE; BF.pcsh[n] = Q[i] === 0 || Q[j] === 0 ? c0 : csh(OBJ[i], OBJ[j], 0.09);
    n++;
  };
  if (useVL) {
    const pi = VL.pi, pj = VL.pj;
    for (let k = 0, np = VL.np; k < np; k++) {
      const i = pi[k], j = pj[k], ma = SM[i] - 1, mb = SM[j] - 1;
      if (ma < 0 || mb < 0) continue;
      let dx = X[j] - X[i], dy = Y[j] - Y[i], dz = d3 ? Zp[j] - Zp[i] : 0;
      if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (d3) { if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; } }
      const r2 = d3 ? dx * dx + dy * dy + dz * dz : dx * dx + dy * dy;
      if (r2 < RC2 && r2 >= 1e-12) put(i, j, ma, mb, dx, dy, r2, dz);
    }
  } else for (const a of mem) nearby(a.x, a.y, RC, (b, dx, dy, r2, dz) => { if (b.bom && !b.dead && b !== a && b.id > a.id && r2 < RC2 && r2 >= 1e-12) put(a.i, b.i, a._bm, b._bm, dx, dy, r2, dz); }, d3 ? a.z : undefined);
  BF.np = n;
  return n;
}
let _bfv = 0, _bfs = 0; // (a curve's value and slope: bfCurve, bfQh)
function bfPiece(dep, k, x, V0, V1, V2) {
  if (k === 0) { if (dep) { if (x <= 0) { _bfv = 0; _bfs = 0; } else { _bfv = V0 * Math.pow(x, BO_PLOW); _bfs = V0 * BO_PLOW * Math.pow(x, BO_PLOW - 1); } } else { _bfv = V0; _bfs = 0; } }
  else if (k === 1) { _bfv = V0 + (V1 - V0) * (x - 1); _bfs = V1 - V0; }
  else if (k === 2) { _bfv = V1 + (V2 - V1) * (x - 2); _bfs = V2 - V1; }
  else { _bfv = V2; _bfs = 0; }
}
function bfCurve(dep, N, V0, V1, V2) { // boDepth (dep) or boStiff, the corners at 1, 2, 3 rounded as boKnot does
  const H = BO_KH;
  let k = N < 1 - H ? 0 : N < 1 + H ? -1 : N < 2 - H ? 1 : N < 2 + H ? -2 : N < 3 - H ? 2 : N < 3 + H ? -3 : 3;
  if (k >= 0) { bfPiece(dep, k, N, V0, V1, V2); return; }
  const K = -k, t = (N - K + H) / (2 * H);
  if (t <= 0) { bfPiece(dep, K - 1, N, V0, V1, V2); return; }
  if (t >= 1) { bfPiece(dep, K, N, V0, V1, V2); return; }
  bfPiece(dep, K - 1, N, V0, V1, V2); const a = _bfv, as = _bfs; bfPiece(dep, K, N, V0, V1, V2); const b = _bfv, bs = _bfs;
  const w = t * t * (3 - 2 * t), dw = 6 * t * (1 - t) / (2 * H);
  _bfv = a + w * (b - a); _bfs = as + w * (bs - as) + dw * (b - a);
}
function bfQh(N) { // boQh
  const H = BO_KH;
  if (N < 1 - H) { _bfv = N; _bfs = 1; return; } if (N > 1 + H) { _bfv = 1 + 0.2 * (N - 1); _bfs = 0.2; return; }
  const t = (N - 1 + H) / (2 * H);
  if (t <= 0) { _bfv = N; _bfs = 1; return; } if (t >= 1) { _bfv = 1 + 0.2 * (N - 1); _bfs = 0.2; return; }
  const a = N, b = 1 + 0.2 * (N - 1), w = t * t * (3 - 2 * t), dw = 6 * t * (1 - t) / (2 * H);
  _bfv = a + w * (b - a); _bfs = 1 + w * (0.2 - 1) + dw * (b - a);
}
let BF_SUP1 = new Int32Array(256), BF_SUP2 = new Int32Array(256), BF_SUPS = new Float64Array(256), BF_MK = new Int32Array(64), BF_ST = new Int32Array(64), BF_STAMP = 0;
function bfSupPush(q1, q2, sg) { if (BF.ns >= BF_SUP1.length) { const g = (a, T) => { const b = new T(a.length * 2); b.set(a); return b; }; BF_SUP1 = g(BF_SUP1, Int32Array); BF_SUP2 = g(BF_SUP2, Int32Array); BF_SUPS = g(BF_SUPS, Float64Array); } BF_SUP1[BF.ns] = q1; BF_SUP2[BF.ns] = q2; BF_SUPS[BF.ns] = sg; BF.ns++; }
/* the shared partners of a pair's two members, through their incident pairs passing test(k): calls f(k1, k2) for each */
function bfCommon(a, b, inc, f0, fc, test, f) {
  if (BF_MK.length < BF.nm) { BF_MK = new Int32Array(BF.nm * 2); BF_ST = new Int32Array(BF.nm * 2); BF_STAMP = 0; }
  const st = ++BF_STAMP, pa = BF.pa, pb = BF.pb;
  for (let u = f0[b], e = u + fc[b]; u < e; u++) { const k = inc[u]; if (!test(k)) continue; const c = pa[k] === b ? pb[k] : pa[k]; BF_MK[c] = k; BF_ST[c] = st; }
  for (let u = f0[a], e = u + fc[a]; u < e; u++) { const k = inc[u]; if (!test(k)) continue; const c = pa[k] === a ? pb[k] : pa[k]; if (BF_ST[c] === st) f(k, BF_MK[c]); }
}
let BF_CS = new Float64Array(16), BF_FS = new Float64Array(16);
function boPass(forces) {
  if (BO.qm) return qmPass(forces); // (quantum bonds, 1.22: GFN1-xTB below)
  const E = BF.useWasm && !W.d3 && bfWasmOK() ? bfPassWasm(forces) : boPassJS(forces); // (3-D: the JavaScript pass, 1.25)
  if (forces && BF.kq > 0 && BO.dqOn) { const w = BF.kq / BO_DQM; if (w > _stiff) _stiff = w; } // (the electron counts' stiffest corner, for the step)
  return E;
}
function boPassJS(forces) {
  const n = bfCollect(forces), nm = BF.nm, PT = BF.PT;
  const pa = BF.pa, pb = BF.pb, pt = BF.pt, pr = BF.pr, gr = BF.pgr, gn = BF.pgn, gca = BF.pgca, gcb = BF.pgcb, pn = BF.pn, ne_ = BF.pne, ne0_ = BF.pne0, dne_ = BF.pdne, dne0_ = BF.pdne0;
  const ca_ = BF.pca, cb_ = BF.pcb, dca_ = BF.pdca, dcb_ = BF.pdcb, sA_ = BF.psA, tA_ = BF.ptA, sB_ = BF.psB, tB_ = BF.ptB, qc_ = BF.pqc, qdh_ = BF.pqdh, pss = BF.pss, psn = BF.psn;
  const f0 = BF.mf0, fc = BF.mfc, men = BF.men, mcap = BF.mcap, mcapH = BF.mcapH;
  for (let m = 0; m < nm; m++) fc[m] = 0;
  let E = 0; BF.ns = 0;
  // non-bonded (switched), raw orders, the taper, the soft core
  for (let k = 0; k < n; k++) {
    const t = pt[k] * BF_PS, r = pr[k];
    gr[k] = 0; gn[k] = 0; gca[k] = 0; gcb[k] = 0; pn[k] = 0; ne_[k] = 0; ne0_[k] = 0; dne_[k] = 0; dne0_[k] = 0; psn[k] = 0; qc_[k] = 0;
    if (r >= PT[t + 4]) continue;
    const r1 = PT[t], c = PT[t + 1], beta = PT[t + 2], d = r - r1; let n0, dn0;
    if (d > 0) { n0 = Math.exp(-beta * d * d); dn0 = -2 * beta * d * n0; } else { const w2 = BO_WIN * BO_WIN, h = d * d / (d * d + w2), hd = 2 * d * w2 / ((d * d + w2) * (d * d + w2)); n0 = Math.exp(-d * h / c); dn0 = -n0 * (h + d * hd) / c; }
    if (d > 0.9) { const u = Math.PI * (d - 0.9) / 0.4, f = 0.5 * (1 + Math.cos(u)), fd = -0.5 * Math.sin(u) * Math.PI / 0.4; dn0 = dn0 * f + n0 * fd; n0 *= f; }
    if (n0 >= 3.5) { n0 = 3.5; dn0 = 0; }
    let ne, dne;
    const zA = BF.mZ[pa[k]], zB = BF.mZ[pb[k]], hb = (zA === 1 && zB >= 7 && zB <= 9) || (zB === 1 && zA >= 7 && zA <= 9), TA = hb ? BO_TAH : BO_TA, TB = hb ? BO_TBH : BO_TB; // (a hydrogen to N, O, F: its order starts lower, 1.20)
    if (n0 >= TB) { ne = n0; dne = 1; } else if (n0 <= TA) { ne = 0; dne = 0; } else { const w = TB - TA, u = (n0 - TA) / w, s = u * u * (3 - 2 * u); ne = n0 * s; dne = s + n0 * 6 * u * (1 - u) / w; }
    ne_[k] = ne; dne_[k] = dne * dn0; ne0_[k] = ne; dne0_[k] = dne_[k];
    const sg = PT[t + 3], z2 = sg * sg / (r * r), z6 = z2 * z2 * z2, s12 = z6 * z6; E += 0.05 * s12; gr[k] += -0.6 * s12 / r;
    fc[pa[k]]++; fc[pb[k]]++;
  }
  // each member's bond-term pairs, in order
  let acc = 0; for (let m = 0; m < nm; m++) { f0[m] = acc; acc += fc[m]; fc[m] = 0; }
  if (BF.inc.length < acc) BF.inc = new Int32Array(acc * 2);
  const inc = BF.inc;
  for (let k = 0; k < n; k++) { if (pr[k] >= PT[pt[k] * BF_PS + 4]) continue; const a = pa[k], b = pb[k]; inc[f0[a] + fc[a]++] = k; inc[f0[b] + fc[b]++] = k; }
  const bt = (k) => pr[k] < PT[pt[k] * BF_PS + 4];
  // crowded flat molecules (boCrowd)
  for (let k = 0; k < n; k++) {
    if (!bt(k) || !(ne0_[k] > 0)) continue;
    let P = 1; const s0 = BF.ns;
    bfCommon(pa[k], pb[k], inc, f0, fc, (j) => ne0_[j] > 0.3, (k1, k2) => {
      const dd = Math.min(PT[pt[k1] * BF_PS + 5], PT[pt[k2] * BF_PS + 5]) - PT[pt[k] * BF_PS + 5]; if (dd <= 0.4) return;
      const u = Math.min(1, (dd - 0.4) / 0.4), sg = u * u * (3 - 2 * u), w = boB(ne0_[k1]) * boB(ne0_[k2]) * sg; if (w <= 0) return;
      P *= 1 - w; bfSupPush(k1, k2, sg);
    });
    if (BF.ns > s0) { pss[k] = s0; psn[k] = BF.ns - s0; ne_[k] = ne0_[k] * P; dne_[k] = dne0_[k] * P; }
  }
  // caps, levels
  const mls = BF.mls, mlv = BF.mlv, mgl = BF.mgl, mkeep = BF.mkeep;
  for (let m = 0; m < nm; m++) {
    const cnt = fc[m]; mgl[m] = 0; if (!cnt) continue;
    const hi0 = f0[m], en3 = men[m] >= 3.0;
    for (let u = hi0; u < hi0 + cnt; u++) {
      const k = inc[u], o = pa[k] === m ? pb[k] : pa[k], C = Math.min(en3 ? mcapH[o] : mcap[o], 3), ne = ne_[k], dd = Math.abs(ne - C), h = boH(dd), g = boHD(dd);
      const c = ne <= C ? ne + h : C + h, dc = ne <= C ? 1 - g : g;
      if (pa[k] === m) { ca_[k] = c; dca_[k] = dc; } else { cb_[k] = c; dcb_[k] = dc; }
    }
    let keep = 1; const dV = mcapH[m] - mcap[m];
    if (dV) for (let u = hi0; u < hi0 + cnt; u++) { const k = inc[u], o = pa[k] === m ? pb[k] : pa[k]; if (men[o] >= 3.0) keep *= 1 - boFade(pa[k] === m ? ca_[k] : cb_[k]); }
    const V = mcap[m] + dV * (1 - keep); mkeep[m] = keep;
    if (BF_CS.length < cnt) { BF_CS = new Float64Array(2 * cnt); BF_FS = new Float64Array(2 * cnt); }
    const cs = BF_CS, fs = BF_FS;
    let lo = -V - 1, hi = 4;
    for (let u = 0; u < cnt; u++) { const k = inc[hi0 + u], c = pa[k] === m ? ca_[k] : cb_[k]; cs[u] = c; fs[u] = boFade(c); if (c + 1 > hi) hi = c + 1; }
    let L = mls[m] > lo && mls[m] < hi ? mls[m] : 0.5 * (lo + hi);
    for (let it = 0; it < 100; it++) {
      let G = -V, U = 0; for (let u = 0; u < cnt; u++) { const x = cs[u] - L; G += boSp(x) * fs[u]; U += boSpD(x) * fs[u]; }
      if (Math.abs(G) < 1e-13) break;
      if (G > 0) lo = L; else hi = L;
      let Ln = U > 0 ? L + G / U : NaN;
      if (!(Ln > lo && Ln < hi)) Ln = 0.5 * (lo + hi);
      if (hi - lo < 1e-15) break;
      L = Ln;
    }
    mls[m] = L; mlv[m] = boSp(L);
  }
  // orders and the Morse terms
  const IM = BF.mim;
  for (let k = 0; k < n; k++) {
    if (!bt(k)) continue;
    const a = pa[k], b = pb[k], xa = ca_[k] - mlv[a], xb = cb_[k] - mlv[b], fa = boFade(ca_[k]), fb = boFade(cb_[k]), A = boSp(xa) * fa, B = boSp(xb) * fb, dd = Math.abs(A - B), h = boH(dd), g = boHD(dd);
    const N = pn[k] = Math.max(0, (A <= B ? A : B) + h);
    const nA = A <= B ? 1 - g : g, nB = A <= B ? g : 1 - g;
    sA_[k] = nA * boSpD(xa) * fa; tA_[k] = nA * boSp(xa) * boFadeD(ca_[k]); sB_[k] = nB * boSpD(xb) * fb; tB_[k] = nB * boSp(xb) * boFadeD(cb_[k]);
    if (N > 1e-6) {
      const t = pt[k] * BF_PS, r = pr[k], r1 = PT[t], c = PT[t + 1];
      bfCurve(true, N, PT[t + 5], PT[t + 6], PT[t + 7]); const D = _bfv, dD = _bfs;
      const N2 = N * N + 0.0025, r0 = r1 - 0.5 * c * Math.log(N2), dr0 = -c * N / N2;
      bfCurve(false, N, PT[t + 8], PT[t + 9], PT[t + 10]); const al = _bfv, dal = _bfs;
      const x = r - r0, ex = Math.exp(-al * x), e = 1 - ex, d = r - r1;
      let fcut = 1, dfc = 0; if (d > 0.9) { const u = Math.PI * (d - 0.9) / 0.4; fcut = 0.5 * (1 + Math.cos(u)); dfc = -0.5 * Math.sin(u) * Math.PI / 0.4; }
      const M = D * (e * e - 1), dMdr = D * 2 * e * ex * al;
      E += fcut * M; gr[k] += fcut * dMdr + dfc * M;
      if (forces) { const w = 4 * D * al * al * fcut * (IM[a] + IM[b]); if (w > _stiff) _stiff = w; } // (twice the bond's curvature at rest: boPassObj's note)
      gn[k] += fcut * ((e * e - 1) * dD - dMdr * dr0 + D * 2 * e * ex * x * dal);
    }
  }
  BO.changes++;
  E += bfAnglesAll(forces);
  if (W.d3) E += bfTorsions3(forces, n); // (3-D: double and aromatic bonds don't twist, 1.25)
  E += bfCoulomb(forces, n);
  E += bfShare(forces, n);
  E += BF.eI; // (the members' internal energies off their whole electron counts, moving charge)
  BO.E = E; BO.np = n; BO.flat = true;
  for (let m = 0; m < nm; m++) if (fc[m]) BF.mem[m]._boLs = mls[m];
  if (!forces) return E;
  const Gc = BF.mGc, Gh = BF.mGh; for (let m = 0; m < nm; m++) { Gc[m] = BF.mgf[m]; Gh[m] = 0; } // (∂E/∂capacity: the free valences' share first)
  // back through the orders to the distances
  const phi = BF.mphi;
  for (let k = 0; k < n; k++) {
    if (!(pn[k] > 0)) continue;
    if (qc_[k]) gn[k] += (phi[pa[k]] - phi[pb[k]]) * qc_[k] * qdh_[k];
    const G = gn[k]; if (!G) continue;
    gca[k] += G * (sA_[k] + tA_[k]); mgl[pa[k]] -= G * sA_[k]; gcb[k] += G * (sB_[k] + tB_[k]); mgl[pb[k]] -= G * sB_[k];
  }
  for (let m = 0; m < nm; m++) {
    const cnt = fc[m]; if (!cnt || !mgl[m]) continue;
    const hi0 = f0[m], Ls = mls[m], gs = mgl[m] * boSpD(Ls); let U = 0;
    for (let u = hi0; u < hi0 + cnt; u++) { const k = inc[u], c = pa[k] === m ? ca_[k] : cb_[k]; U += boSpD(c - Ls) * boFade(c); }
    if (U > 0) for (let u = hi0; u < hi0 + cnt; u++) { const k = inc[u], c = pa[k] === m ? ca_[k] : cb_[k], w = (boSpD(c - Ls) * boFade(c) + boSp(c - Ls) * boFadeD(c)) * gs / U; if (pa[k] === m) gca[k] += w; else gcb[k] += w; }
    if (U > 0) { const dEV = -gs / U; Gc[m] += mkeep[m] * dEV; Gh[m] += (1 - mkeep[m]) * dEV; } // (the level's share of the capacities)
    const dV = mcapH[m] - mcap[m];
    if (U > 0 && dV) for (let u = hi0; u < hi0 + cnt; u++) {
      const k = inc[u], o = pa[k] === m ? pb[k] : pa[k]; if (men[o] < 3.0) continue;
      const c = pa[k] === m ? ca_[k] : cb_[k], f = boFade(c); if (f >= 1) continue;
      const w = -gs / U * dV * boFadeD(c) * mkeep[m] / (1 - f); if (pa[k] === m) gca[k] += w; else gcb[k] += w;
    }
  }
  for (let k = 0; k < n; k++) {
    if (!bt(k)) continue;
    const G = gca[k] * dca_[k] + gcb[k] * dcb_[k];
    { const a = pa[k], b = pb[k]; // (each end's cap on its partner: dc/dC = 1 − dc/dn below 3)
      if (men[a] >= 3.0) { if (mcapH[b] < 3) Gh[b] += gca[k] * (1 - dca_[k]); } else if (mcap[b] < 3) Gc[b] += gca[k] * (1 - dca_[k]);
      if (men[b] >= 3.0) { if (mcapH[a] < 3) Gh[a] += gcb[k] * (1 - dcb_[k]); } else if (mcap[a] < 3) Gc[a] += gcb[k] * (1 - dcb_[k]); }
    gr[k] += G * dne_[k];
    const s0 = pss[k], ns = psn[k];
    if (ns && G) for (let t = 0; t < ns; t++) {
      const k1 = BF_SUP1[s0 + t], k2 = BF_SUP2[s0 + t], sg = BF_SUPS[s0 + t], b1 = boB(ne0_[k1]), b2 = boB(ne0_[k2]), w = b1 * b2 * sg;
      let o = 1; for (let u = 0; u < ns; u++) if (u !== t) o *= 1 - boB(ne0_[BF_SUP1[s0 + u]]) * boB(ne0_[BF_SUP2[s0 + u]]) * BF_SUPS[s0 + u];
      const dEw = -G * ne0_[k] * o;
      if (w >= 0) { gr[k1] += dEw * boBD(ne0_[k1]) * b2 * sg * dne0_[k1]; gr[k2] += dEw * b1 * boBD(ne0_[k2]) * sg * dne0_[k2]; }
    }
  }
  bfDqGrad();
  const FX = S.fx, FY = S.fy, slot = BF.mslot, ux = BF.pux, uy = BF.puy;
  for (let k = 0; k < n; k++) {
    const g = gr[k]; if (!g) continue;
    const fx = g * ux[k], fy = g * uy[k], i = slot[pa[k]], j = slot[pb[k]];
    FX[j] -= fx; FY[j] -= fy; FX[i] += fx; FY[i] += fy;
  }
  if (W.d3) { const FZ = S.fz, uz = BF.puz; for (let k = 0; k < n; k++) { const g = gr[k]; if (!g) continue; const fz = g * uz[k]; FZ[slot[pb[k]]] -= fz; FZ[slot[pa[k]]] += fz; } } // (3-D: the depth, 1.25)
  return E;
}
/* ∂E/∂ν for every member (the force on its electron count), from the pass's own slopes: internal energy, capacities,
   valence, and −φ (its charge is Z − ν) */
function bfDqGrad() {
  const nm = BF.nm, mem = BF.mem, gq = BF.mgq, phi = BF.mphi;
  for (let m = 0; m < nm; m++) { gq[m] = BF.mGd[m] + BF.mdeI[m] + BF.mdcap[m] * BF.mGc[m] + BF.mdcapH[m] * BF.mGh[m] + BF.mdval[m] * BF.mGv[m] - phi[m]; mem[m]._dqg = gq[m]; }
}
/* angles (boPassObj's: strong partners always, those on the way in or out by the expectation over subsets) */
const BFA = { a: new Float64Array(8), dx: new Float64Array(8), dy: new Float64Array(8), g: new Float64Array(8), o: new Int32Array(8), ord: new Int32Array(8), gv: new Float64Array(8), ghi: new Int32Array(8), glo: new Int32Array(8), gord: new Int32Array(8), list: new Int32Array(16), strong: new Int32Array(64), zone: new Int32Array(64), zw: new Float64Array(64), zd: new Float64Array(64) };
let _adS = 0;
function bfAngle(c, list, nl, wgt, forces) {
  _adS = 0;
  if (nl < 2 || nl > 6) return 0;
  const pa = BF.pa, pb = BF.pb, pn = BF.pn, ux = BF.pux, uy = BF.puy, pr = BF.pr, A = BFA;
  let sum = 0; for (let u = 0; u < nl; u++) sum += pn[list[u]];
  const lpr0 = (BF.mval[c] - sum) / 2, lpr = Math.max(0, lpr0), l0 = Math.floor(lpr), f = lpr - l0, dfds = lpr0 > 0 ? -0.5 : 0;
  const per = BF.mper[c]; let allH = true;
  for (let u = 0; u < nl; u++) {
    const k = list[u], o = pa[k] === c ? pb[k] : pa[k], sg = pa[k] === c ? 1 : -1;
    if (BF.mZ[o] !== 1) allH = false;
    A.o[u] = o; A.a[u] = Math.atan2(sg * uy[k], sg * ux[k]); A.dx[u] = sg * ux[k] * pr[k]; A.dy[u] = sg * uy[k] * pr[k]; A.g[u] = 0; A.ord[u] = u;
  }
  for (let i = 1; i < nl; i++) { const v = A.ord[i]; let j = i - 1; while (j >= 0 && A.a[A.ord[j]] > A.a[v]) { A.ord[j + 1] = A.ord[j]; j--; } A.ord[j + 1] = v; } // (by angle)
  for (let k = 0; k < nl; k++) { const lo = A.ord[k], hi = A.ord[k === nl - 1 ? 0 : k + 1]; A.gv[k] = k === nl - 1 ? A.a[A.ord[0]] + 2 * Math.PI - A.a[lo] : A.a[hi] - A.a[lo]; A.ghi[k] = hi; A.glo[k] = lo; A.gord[k] = k; }
  for (let i = 1; i < nl; i++) { const v = A.gord[i]; let j = i - 1; while (j >= 0 && A.gv[A.gord[j]] > A.gv[v]) { A.gord[j + 1] = A.gord[j]; j--; } A.gord[j + 1] = v; } // (gaps, smallest first)
  const e = (lp, w) => {
    const key = ((nl * 8 + lp) * 8 + per) * 2 + (allH ? 1 : 0); let tg = BO_TG.get(key); if (!tg) BO_TG.set(key, tg = angleTargetsRaw(nl, lp, per, allH).slice().sort((u, v) => u - v)); let t = 0;
    for (let k = 0; k < nl; k++) { const gi = A.gord[k], dv = A.gv[gi] - tg[k]; t += 0.5 * ANGLE_K * dv * dv; if (w) { const gk = w * ANGLE_K * dv; A.g[A.ghi[gi]] += gk; A.g[A.glo[gi]] -= gk; } }
    return t;
  };
  let E;
  if (f > 1e-9) { const e0 = e(l0, forces ? wgt * (1 - f) : 0), e1 = e(l0 + 1, forces ? wgt * f : 0); E = (1 - f) * e0 + f * e1; _adS = (e1 - e0) * dfds; }
  else E = e(l0, forces ? wgt : 0);
  if (forces) {
    const FX = S.fx, FY = S.fy, i = BF.mslot[c];
    for (let u = 0; u < nl; u++) {
      const g = A.g[u]; if (!g) continue;
      const dx = A.dx[u], dy = A.dy[u], r2 = dx * dx + dy * dy, gx = g * -dy / r2, gy = g * dx / r2, j = BF.mslot[A.o[u]];
      FX[j] -= gx; FY[j] -= gy; FX[i] += gx; FY[i] += gy;
    }
  }
  return E;
}
/* ---- 3-D (1.25). The flat angle term (bonds sorted round a circle, the gaps held at their targets) has no meaning in
   space: a centre's term here is the stored bonds' own 3-D one (engine.js angle3CentreK: every pair of bonds held at its
   VSEPR angle, vsepr3's targets for these partners and lone pairs, the trigonal-planar centre's out-of-plane term), with
   the flat term's weights and its lone pairs' fraction. Its forces go to scratch arrays first, to be added with the
   subset's weight. */
const BF3 = { fx: new Float64Array(0), fy: new Float64Array(0), fz: new Float64Array(0), nb: new Int32Array(6), tg: new Map() };
function bfAngle3(c, list, nl, wgt, forces) {
  _adS = 0;
  if (nl < 2 || nl > 6) return 0;
  const pa = BF.pa, pb = BF.pb, pn = BF.pn, slot = BF.mslot, nb = BF3.nb;
  let sum = 0; for (let u = 0; u < nl; u++) sum += pn[list[u]];
  const lpr0 = (BF.mval[c] - sum) / 2, lpr = Math.max(0, lpr0), l0 = Math.floor(lpr), f = lpr - l0, dfds = lpr0 > 0 ? -0.5 : 0;
  const per = BF.mper[c], pc = slot[c]; let allH = true;
  for (let u = 0; u < nl; u++) { const k = list[u], o = pa[k] === c ? pb[k] : pa[k]; if (BF.mZ[o] !== 1) allH = false; nb[u] = slot[o]; }
  if (forces && BF3.fx.length < S.size) { BF3.fx = new Float64Array(S.size); BF3.fy = new Float64Array(S.size); BF3.fz = new Float64Array(S.size); }
  kb3FromW();
  const e = (lp, w) => {
    const key = ((nl * 8 + lp) * 8 + per) * 2 + (allH ? 1 : 0); let t = BF3.tg.get(key); if (!t) BF3.tg.set(key, t = vsepr3(nl, lp, per, allH));
    if (!w) return angle3CentreK(pc, nb, nl, t[0], t[1], t[2], null, null, null);
    const FX = BF3.fx, FY = BF3.fy, FZ = BF3.fz, E = angle3CentreK(pc, nb, nl, t[0], t[1], t[2], FX, FY, FZ), SX = S.fx, SY = S.fy, SZ = S.fz;
    SX[pc] += w * FX[pc]; SY[pc] += w * FY[pc]; SZ[pc] += w * FZ[pc]; FX[pc] = 0; FY[pc] = 0; FZ[pc] = 0;
    for (let u = 0; u < nl; u++) { const j = nb[u]; SX[j] += w * FX[j]; SY[j] += w * FY[j]; SZ[j] += w * FZ[j]; FX[j] = 0; FY[j] = 0; FZ[j] = 0; }
    return E;
  };
  if (f > 1e-9) { const e0 = e(l0, forces ? wgt * (1 - f) : 0), e1 = e(l0 + 1, forces ? wgt * f : 0); _adS = (e1 - e0) * dfds; return (1 - f) * e0 + f * e1; }
  return e(l0, forces ? wgt : 0);
}
/* Double and aromatic bonds don't twist (3-D, 1.25): the stored bonds' torsion (engine.js, K_TOR·(û₁·û₂×û₃)² over each
   dihedral X–A=B–Y, 2.7 eV over ethylene's four at 90°), weighted by how double the A–B bond is, τ(n) rising from 0 at an
   order of 1.1 to 1 at 1.5 (benzene's 1.5 in full, as a stored aromatic bond), and by how bonded X–A and B–Y are (b(n),
   0 at 0.3 to 1 at 0.7). A linear end (a triple bond, an allene's middle) gives no twist by itself (the triple product of
   two parallel bonds is zero). Its slopes go to the orders (gn) and, through triple3K, to the positions. */
const BO_TOR0 = 1.1, BO_TORW = 0.4;
function bfTorsions3(forces, n) {
  const pa = BF.pa, pb = BF.pb, pn = BF.pn, gn = BF.pgn, f0 = BF.mf0, fc = BF.mfc, inc = BF.inc, slot = BF.mslot;
  const FX = forces ? S.fx : null, FY = forces ? S.fy : null, FZ = forces ? S.fz : null;
  let E = 0; kb3FromW();
  for (let k = 0; k < n; k++) {
    const N = pn[k]; if (!(N > BO_TOR0)) continue;
    const x = Math.min(1, (N - BO_TOR0) / BO_TORW), tau = x * x * (3 - 2 * x), dtau = x < 1 ? 6 * x * (1 - x) / BO_TORW : 0;
    const A = pa[k], B = pb[k];
    for (let u = f0[A], ue = u + fc[A]; u < ue; u++) {
      const k1 = inc[u]; if (k1 === k) continue; const n1 = pn[k1]; if (!(n1 > 0.3)) continue;
      const X = pa[k1] === A ? pb[k1] : pa[k1], b1 = boB(n1);
      for (let v = f0[B], ve = v + fc[B]; v < ve; v++) {
        const k2 = inc[v]; if (k2 === k) continue; const n2 = pn[k2]; if (!(n2 > 0.3)) continue;
        const Y = pa[k2] === B ? pb[k2] : pa[k2]; if (Y === X) continue;
        const b2 = boB(n2), w = tau * b1 * b2; if (!(w > 0) && !(dtau > 0 && b1 * b2 > 0)) continue;
        const T2 = triple3K(slot[X], slot[A], slot[A], slot[B], slot[B], slot[Y], K_TOR, null, null, null) / K_TOR; // (the twist's (û₁·û₂×û₃)²)
        if (forces && w > 0) triple3K(slot[X], slot[A], slot[A], slot[B], slot[B], slot[Y], w * K_TOR, FX, FY, FZ);
        const e = K_TOR * T2; E += w * e;
        gn[k] += dtau * b1 * b2 * e; gn[k1] += tau * boBD(n1) * b2 * e; gn[k2] += tau * b1 * boBD(n2) * e;
      }
    }
  }
  return E;
}
function bfAnglesAll(forces) {
  const nm = BF.nm, f0 = BF.mf0, fc = BF.mfc, inc = BF.inc, pn = BF.pn, gn = BF.pgn, A = BFA;
  let E = 0; const Gv = BF.mGv; Gv.fill(0, 0, nm);
  for (let c = 0; c < nm; c++) {
    const cnt = fc[c]; if (!cnt || BF.mdb[c]) continue;
    if (A.strong.length < cnt) { A.strong = new Int32Array(2 * cnt); A.zone = new Int32Array(2 * cnt); A.zw = new Float64Array(2 * cnt); A.zd = new Float64Array(2 * cnt); }
    let ns = 0, z = 0;
    for (let u = f0[c]; u < f0[c] + cnt; u++) {
      const k = inc[u], N = pn[k];
      if (N >= 0.7) A.strong[ns++] = k;
      else if (N > 0.4) { const x = (N - 0.4) / 0.3; A.zone[z] = k; A.zw[z] = x * x * (3 - 2 * x); A.zd[z] = 6 * x * (1 - x) / 0.3; z++; }
    }
    if (ns + z < 2) continue;
    if (z > 6) { // (at most 64 subsets: a crowd past that keeps its 6 strongest, as boPassObj)
      const o = []; for (let u = 0; u < z; u++) o.push(u); o.sort((u, v) => pn[A.zone[v]] - pn[A.zone[u]]);
      const zk = o.slice(0, 6).map(u => [A.zone[u], A.zw[u], A.zd[u]]); z = 6; zk.forEach(([k, w, d], u) => { A.zone[u] = k; A.zw[u] = w; A.zd[u] = d; });
    }
    if (A.list.length < ns + z) A.list = new Int32Array(2 * (ns + z));
    for (let mask = 0; mask < 1 << z; mask++) {
      let wt = 1, nl = 0;
      for (let u = 0; u < ns; u++) A.list[nl++] = A.strong[u];
      for (let u = 0; u < z; u++) if (mask & (1 << u)) { wt *= A.zw[u]; A.list[nl++] = A.zone[u]; } else wt *= 1 - A.zw[u];
      if (wt <= 0 || nl < 2) continue;
      const e = (W.d3 ? bfAngle3 : bfAngle)(c, A.list, nl, wt, forces), dS = _adS;
      E += wt * e;
      if (dS) { for (let u = 0; u < nl; u++) gn[A.list[u]] += wt * dS; Gv[c] -= wt * dS; } // (the lone pairs' share: ∂E/∂valence = −∂E/∂Σorders)
      for (let u = 0; u < z; u++) {
        let o = 1; for (let j = 0; j < z; j++) if (j !== u) o *= mask & (1 << j) ? A.zw[j] : 1 - A.zw[j];
        gn[A.zone[u]] += (mask & (1 << u) ? o : -o) * A.zd[u] * e;
      }
    }
  }
  return E;
}
/* the partial charges (boCoulomb's) */
let BF_T1 = new Int32Array(16), BF_T2 = new Int32Array(16), BF_TW = new Float64Array(16);
const BO_LJ0 = 0.02, BO_LJW = 0.3, BO_RHP = 1.2, BO_SHP = Math.sqrt(0.002); // (the non-bonded pairs: off once a pair holds an order of 0.32; a polar hydrogen's size, as setSize's)
/* Lennard-Jones with the kernel's inner wall: inside cf·rm it goes on straight, its force held (ljFI). Into _ljV, _ljF = dV/dr,
   _ljM = dV/drm (eps scales V). */
let _ljV = 0, _ljF = 0, _ljM = 0;
function bfLJ(r, rm, eps, cf) {
  const c = cf * rm, rr = r < c ? c : r, s2 = rm * rm / (rr * rr), s6 = s2 * s2 * s2, F0 = 12 * (s6 * s6 - s6) / rr;
  _ljV = eps * (s6 * s6 - 2 * s6 + LJ_VCUT + (r < c ? F0 * (c - r) : 0)); _ljF = -eps * F0;
  _ljM = r >= c ? 12 * eps * (s6 * s6 - s6) / rm : eps * F0 * r / rm;
}
/* The exclusions of bonded (1-2) and angle (1-3) pairs from the members' Coulomb and Lennard-Jones (1.20): rising from an
   order of 0.1 to 0.9, so that a pair passing a proton between partners changes them gradually (it was 0.3 to 0.7, and
   the hydrogen passing between two waters lost 1 eV of Coulomb in 0.1 Å). */
const BO_X0 = 0.1, BO_X1 = 0.9;
const boX = (n) => { if (n <= BO_X0) return 0; if (n >= BO_X1) return 1; const t = (n - BO_X0) / (BO_X1 - BO_X0); return t * t * (3 - 2 * t); };
const boXD = (n) => { if (n <= BO_X0 || n >= BO_X1) return 0; const t = (n - BO_X0) / (BO_X1 - BO_X0); return 6 * t * (1 - t) / (BO_X1 - BO_X0); };
const BO_FV = 0.3; // (a pair whose atoms both have this much valence free can bond: no wall between them)
const boHf = (f) => { const t = f / BO_FV; return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); };
const boHfD = (f) => { const t = f / BO_FV; return t <= 0 || t >= 1 ? 0 : 6 * t * (1 - t) / BO_FV; };
const boG = (n) => { const t = (n - BO_LJ0) / BO_LJW; return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); };
const boGD = (n) => { const t = (n - BO_LJ0) / BO_LJW; return t <= 0 || t >= 1 ? 0 : 6 * t * (1 - t) / BO_LJW; };
function bfCoulomb(forces, n) {
  const nm = BF.nm, QP = S.qp, mq = BF.mq, phi = BF.mphi, mqn = BF.mqn, men = BF.men, pa = BF.pa, pb = BF.pb, pn = BF.pn, pr = BF.pr, qc_ = BF.pqc, qdh_ = BF.pqdh, gr = BF.pgr, gn = BF.pgn, K_ = BF.pK, csh_ = BF.pcsh;
  for (let m = 0; m < nm; m++) { mq[m] = 0; phi[m] = 0; }
  for (let k = 0; k < n; k++) {
    if (!(pn[k] > 0)) continue;
    const ea = men[pa[k]], eb = men[pb[k]]; if (ea === eb) continue;
    bfQh(pn[k]); const qc = qc_[k] = PARTIAL_K * (eb - ea); qdh_[k] = _bfs;
    mq[pa[k]] += qc * _bfv; mq[pb[k]] -= qc * _bfv;
  }
  for (let m = 0; m < nm; m++) { const p = BF.mem[m], q = mq[m] - (p._dq || 0); QP[p.i] = q; p.qpol = q; p.qf = 0; p.qi = 0; } // (a moving count's share too: the kernel meets the member's whole charge)
  const f0 = BF.mf0, fc = BF.mfc, inc = BF.inc, mZ = BF.mZ, pol = BF.mpol, gw = BF.mgw, LR = BF.mljR, LS = BF.mljS;
  // a hydrogen bonded to N, O or F is small (setSize's polar hydrogen): its size follows its orders to them
  const SN = BF.msn, GF = BF.mgf, MC = BF.mcap, fa_ = BF.pfa, fb_ = BF.pfb;
  for (let m = 0; m < nm; m++) { let x = 0; for (let u = f0[m], e = u + fc[m]; u < e; u++) x += pn[inc[u]]; SN[m] = x; GF[m] = 0; }
  for (let m = 0; m < nm; m++) {
    gw[m] = 0; pol[m] = 0; if (mZ[m] !== 1) continue;
    let x = 0; for (let u = f0[m], e = u + fc[m]; u < e; u++) { const k = inc[u], o = pa[k] === m ? pb[k] : pa[k], z = mZ[o]; if (z >= 7 && z <= 9) x += pn[k]; }
    pol[m] = x >= 1 ? 1 : x <= 0 ? 0 : x * x * (3 - 2 * x);
  }
  let E = 0;
  for (let k = 0; k < n; k++) {
    const a = pa[k], b = pb[k], qa = mqn[a] + mq[a], qb = mqn[b] + mq[b], nk = pn[k];
    const b0 = boX(nk), g0 = boG(nk); fa_[k] = 0; fb_[k] = 0; if (b0 >= 1) continue;
    const r = pr[k], ha = mZ[a] === 1, hb = mZ[b] === 1;
    const Ra = ha ? LR[a] + (BO_RHP - LR[a]) * pol[a] : LR[a], Rb = hb ? LR[b] + (BO_RHP - LR[b]) * pol[b] : LR[b];
    const Sa = ha ? LS[a] + (BO_SHP - LS[a]) * pol[a] : LS[a], Sb = hb ? LS[b] + (BO_SHP - LS[b]) * pol[b] : LS[b];
    const rm = 0.5 * (Ra + Rb), eps = Sa * Sb, lj = g0 < 1 && eps > 0 && r < 2.6 * rm, ch = qa !== 0 || qb !== 0;
    if (!lj && !ch) continue;
    let prod = 1, nt = 0;
    if (r < BF.r13) bfCommon(a, b, inc, f0, fc, (j) => pn[j] > BO_X0, (k1, k2) => {
      const w = boX(pn[k1]) * boX(pn[k2]); if (w <= 0) return;
      prod *= 1 - w; if (nt >= BF_T1.length) { const g = (x, T) => { const y = new T(x.length * 2); y.set(x); return y; }; BF_T1 = g(BF_T1, Int32Array); BF_T2 = g(BF_T2, Int32Array); BF_TW = g(BF_TW, Float64Array); } BF_T1[nt] = k1; BF_T2[nt] = k2; BF_TW[nt] = w; nt++;
    });
    if (!(prod > 0)) continue;
    let Es = 0, V = 0; // (the pair's Coulomb and Lennard-Jones energies before their weights)
    if (ch) {
      const s = (1 - b0) * prod, K = K_[k], sq = Math.sqrt(r * r + 0.09), c = K * (1 / sq - csh_[k]);
      Es = c * qa * qb; E += s * Es;
      if (forces) { gr[k] += -s * K * r / (sq * sq * sq) * qa * qb; phi[a] += s * c * qb; phi[b] += s * c * qa; }
    }
    let wfk = 0;
    if (lj) { // (Lennard-Jones as the kernel's: in full between molecules, its soft intramolecular form (half the depth, the wall
      //   from 0.8·rm) within one; none between two atoms that both have valence free, which can bond as they meet: radicals
      //   recombine without a wall)
      const inR = r < BF.PT[BF.pt[k] * BF_PS + 4] ? nk : 0, xa = MC[a] - (SN[a] - inR), xb = MC[b] - (SN[b] - inR), ha_ = boHf(xa), hb_ = boHf(xb);
      wfk = 1 - ha_ * hb_;
      const wl = (1 - g0) * prod * wfk, same = BF.mcl[a] === BF.mcl[b];
      bfLJ(r, rm, same ? 0.5 * eps : eps, same ? 0.8 : 0.62); V = _ljV; E += wl * V;
      if (forces) {
        gr[k] += wl * _ljF;
        if (!same && r < 0.8 * rm && r >= 0.62 * rm) { const s6 = Math.pow(rm / r, 6), kw = wl * eps * (156 * s6 * s6 - 84 * s6) / (r * r) * (BF.mim[a] + BF.mim[b]); if (kw > _stiff) _stiff = kw; } // (the wall's curvature, for the step: as the kernel's kStiff)
        const dVrm = _ljM, dVe = V / eps;
        if (ha) gw[a] += wl * (0.5 * dVrm * (BO_RHP - LR[a]) + dVe * Sb * (BO_SHP - LS[a]));
        if (hb) gw[b] += wl * (0.5 * dVrm * (BO_RHP - LR[b]) + dVe * Sa * (BO_SHP - LS[b]));
        const Vw = (1 - g0) * prod * V; fa_[k] = -Vw * boHfD(xa) * hb_; fb_[k] = -Vw * ha_ * boHfD(xb); GF[a] += fa_[k]; GF[b] += fb_[k]; // (dE/d(free valence))
      }
    }
    if (!forces) continue;
    const C1 = Es * (1 - b0) + V * (1 - g0) * wfk; // (the 1-3 weight's slope, both terms)
    gn[k] -= (Es * boXD(nk) + V * boGD(nk) * wfk) * prod;
    if (C1) for (let t = 0; t < nt; t++) {
      const k1 = BF_T1[t], k2 = BF_T2[t], w = BF_TW[t], dsw = -C1 * prod / (1 - w);
      gn[k1] += dsw * boXD(pn[k1]) * boX(pn[k2]); gn[k2] += dsw * boX(pn[k1]) * boXD(pn[k2]);
    }
  }
  if (forces) for (let k = 0; k < n; k++) { // (free valence: every order of an atom but the pair's own)
    if (!(pr[k] < BF.PT[BF.pt[k] * BF_PS + 4])) continue;
    gn[k] -= (GF[pa[k]] - fa_[k]) + (GF[pb[k]] - fb_[k]);
  }
  if (forces) for (let m = 0; m < nm; m++) { // (the hydrogens' sizes back to their orders)
    if (!gw[m]) continue;
    let x = 0; for (let u = f0[m], e = u + fc[m]; u < e; u++) { const k = inc[u], o = pa[k] === m ? pb[k] : pa[k], z = mZ[o]; if (z >= 7 && z <= 9) x += pn[k]; }
    if (x <= 0 || x >= 1) continue;
    const d = gw[m] * 6 * x * (1 - x);
    for (let u = f0[m], e = u + fc[m]; u < e; u++) { const k = inc[u], o = pa[k] === m ? pb[k] : pa[k], z = mZ[o]; if (z >= 7 && z <= 9) gn[k] += d; }
  }
  if (forces) bfPhiOthers();
  return E;
}
/* the potential at each member from the non-members it meets (the kernel's pairs: same coefficients, qeqC) and, for
   an ion member, from the net charges beyond the cutoff */
/* A proton shared between two atoms that can each hold the charge (1.20): the two ways of drawing it (the charge on one
   side, or on the other) mix, as a valence-bond picture's two structures do, lowering the energy by −2V·√(e_a·e_b), e
   the charge each side holds (a smooth max of its whole-count charge, each sign apart), V = BO_SHV·4·n_a·n_b from the
   hydrogen's two orders. Classical charges alone keep the charge on one side (the other side's partial charges hold it
   there); this term is what lets it spread across a Zundel-like O–H–O and follow the proton. Only N, O and F. */
const BO_SHV = 1.7, BO_SHE = 0.05; // (eV at an even split; the square root's rounding)
function bfShare(forces, n) {
  const nm = BF.nm, mZ = BF.mZ, f0 = BF.mf0, fc = BF.mfc, inc = BF.inc, pa = BF.pa, pb = BF.pb, pn = BF.pn, mqn = BF.mqn, Gd = BF.mGd, gn = BF.pgn;
  Gd.fill(0, 0, nm);
  let E = 0;
  for (let h = 0; h < nm; h++) {
    if (mZ[h] !== 1 || fc[h] < 2) continue;
    const u0 = f0[h], u1 = u0 + fc[h];
    for (let u = u0; u < u1; u++) {
      const k1 = inc[u], a = pa[k1] === h ? pb[k1] : pa[k1], n1 = pn[k1]; if (!(n1 > 0) || mZ[a] < 7 || mZ[a] > 9) continue;
      for (let v = u + 1; v < u1; v++) {
        const k2 = inc[v], b = pa[k2] === h ? pb[k2] : pa[k2], n2 = pn[k2]; if (!(n2 > 0) || mZ[b] < 7 || mZ[b] > 9) continue;
        const m1 = n1 < 1 ? n1 : 1, m2 = n2 < 1 ? n2 : 1, V = BO_SHV * 4 * m1 * m2; // (orders past 1 count as 1)
        let T = 0, dTa = 0, dTb = 0;
        for (const sg of [1, -1]) {
          const xa = sg * mqn[a], xb = sg * mqn[b], ea = boSp(xa), eb = boSp(xb), pr = ea * eb; if (!(pr > 0)) continue;
          const r = Math.sqrt(pr + BO_SHE * BO_SHE); T += r - BO_SHE;
          if (forces) { dTa += eb / (2 * r) * boSpD(xa) * sg; dTb += ea / (2 * r) * boSpD(xb) * sg; } // (∂/∂q; ν = Z − q: ∂/∂ν = −∂/∂q)
        }
        if (!T) continue;
        E -= 2 * V * T;
        if (!forces) continue;
        Gd[a] += 2 * V * dTa; Gd[b] += 2 * V * dTb; // (−∂(−2VT)/∂q = 2V·∂T/∂q, as ∂/∂ν)
        if (n1 < 1) gn[k1] -= 2 * BO_SHV * 4 * m2 * T; if (n2 < 1) gn[k2] -= 2 * BO_SHV * 4 * m1 * T;
      }
    }
  }
  return E;
}
function bfPhiOthers() {
  const phi = BF.mphi, QP = S.qp;
  let others = false; for (const p of W.parts) if (!p.bom && !p.dead && p.k === NUC && p.Z > 0) { others = true; break; }
  if (others) {
    const pi = VL.pi, pj = VL.pj, ex = VL.ex, OBJ = S.obj, X = S.x, Y = S.y, Q = S.q, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2, d3 = W.d3, Zp = S.z, bd = W.box.d, hd = bd / 2; // (3-D: in depth too, 1.25)
    for (let k = 0; k < VL.np; k++) {
      if (ex[k]) continue;
      const i = pi[k], j = pj[k], a = OBJ[i], b = OBJ[j];
      if (!a || !b || a.bom === b.bom || a.k !== NUC || b.k !== NUC || !a.Z || !b.Z || a.dead || b.dead || a.fast || b.fast || a.rad || b.rad) continue;
      let dx = X[j] - X[i], dy = Y[j] - Y[i], dz = d3 ? Zp[j] - Zp[i] : 0;
      if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (d3) { if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; } }
      const r2 = d3 ? dx * dx + dy * dy + dz * dz : dx * dx + dy * dy; if (r2 >= RC2) continue;
      const m = a.bom ? a : b, o = m === a ? b : a, qo = Q[o.i] + QP[o.i]; if (!qo) continue;
      phi[m._bm] += qeqC(m, o, r2) * qo;
    }
  }
  if (_lrOn) for (const m of BF.mem) { // (an ion member's partial charge meets the net charges beyond the cutoff too)
    if (!isLR(m)) continue;
    for (const o of _charged) { if (o === m || o.dead || !isLR(o)) continue; const dx = o.x - m.x, dy = o.y - m.y, dz = W.d3 ? o.z - m.z : 0, r2 = W.d3 ? dx * dx + dy * dy + dz * dz : dx * dx + dy * dy; if (r2 >= RC2) phi[m._bm] += PHYS.KE * qx(o, m) / Math.sqrt(r2); }
  }
}
/* The same pass in WebAssembly (1.18; kernel/src/bo.rs): the JavaScript gathers the members (their capacities, flags)
   and the pair types, the module finds the pairs from the neighbour list (a force pass; the grid's pairs otherwise are
   found here) and does the rest; between its two halves the non-members' potential is added here (bfPhiOthers). The
   arrays live in the module's memory (bfArr); a descriptor gives their offsets (B_* in bo.rs), a block the scalars. */
const BFW = { desc: null, par: null, tgt: null, zs: new Int32Array(128), zrep: [], cap: 0 };
const BF_DESC = ['pr', 'pux', 'puy', 'pgr', 'pgn', 'pgca', 'pgcb', 'pn', 'pne', 'pne0', 'pdne', 'pdne0', 'pca', 'pcb', 'pdca', 'pdcb', 'psA', 'ptA', 'psB', 'ptB', 'pqc', 'pqdh', 'pK', 'pcsh',
  'pa', 'pb', 'pt', 'pss', 'psn', 'men', 'mcap', 'mcapH', 'mval', 'mls', 'mlv', 'mgl', 'mkeep', 'mq', 'mphi', 'mqn', 'mim', 'mslot', 'mper', 'mdb', 'mZ', 'mf0', 'mfc', 'mfl', 'inc'];
function bfWasmOK() { return wasmReady() && typeof WK.ex.af_bo_pass1 === 'function' && bfWasmInit(); }
function bfWasmInit() { // (the descriptor, the scalars and the angle targets, once; the tables moved into the module's memory)
  if (!WK.on) return false;
  if (!BFW.desc) {
    BFW.desc = wasmArray(Int32Array, 112); BFW.par = wasmArray(Float64Array, 16);
    const T = BFW.tgt = wasmArray(Float64Array, 1024 * 6); // (the angle targets for every key bfAngle can ask: ((nl·8 + lp)·8 + period)·2 + allH)
    if (!WK.on) return false;
    for (let nl = 2; nl <= 6; nl++) for (let lp = 0; lp < 8; lp++) for (let per = 0; per < 8; per++) for (let h = 0; h < 2; h++) {
      const key = ((nl * 8 + lp) * 8 + per) * 2 + h, tg = angleTargetsRaw(nl, lp, per, !!h).slice().sort((u, v) => u - v);
      for (let k = 0; k < nl; k++) T[key * 6 + k] = tg[k];
    }
    if (BF.PT.buffer !== WK.mem.buffer) { const t = wasmArray(Float64Array, BF.PT.length); t.set(BF.PT); BF.PT = t; }
    if (BF_TZ.buffer !== WK.mem.buffer) { const t = wasmArray(Int32Array, BF_TZ.length); t.set(BF_TZ); BF_TZ = t; }
    if (!WK.on) return false;
  }
  return true;
}
/* room in the scratch arrays for nm members (Rust allocates nothing) */
function bfScratch(nm) {
  const buf = WK.mem.buffer;
  if (BFW.cap >= nm + 16 && BF_MK.buffer === buf && BF_ST.buffer === buf && BF_CS.buffer === buf && BF_FS.buffer === buf && BFA.list.buffer === buf && BFA.strong.buffer === buf && BF_T1.buffer === buf) return;
  const c = 2 * nm + 32; BFW.cap = c;
  BF_MK = wasmArray(Int32Array, c); BF_ST = wasmArray(Int32Array, c); BF_CS = wasmArray(Float64Array, c); BF_FS = wasmArray(Float64Array, c);
  BFA.strong = wasmArray(Int32Array, c); BFA.zone = wasmArray(Int32Array, c); BFA.zw = wasmArray(Float64Array, c); BFA.zd = wasmArray(Float64Array, c); BFA.list = wasmArray(Int32Array, c);
  BF_T1 = wasmArray(Int32Array, c); BF_T2 = wasmArray(Int32Array, c); BF_TW = wasmArray(Float64Array, c);
}
function bfSupRoom(n) {
  if (BF_SUP1.length >= n && BF_SUP1.buffer === WK.mem.buffer) return;
  const c = Math.max(256, 2 * n); BF_SUP1 = wasmArray(Int32Array, c); BF_SUP2 = wasmArray(Int32Array, c); BF_SUPS = wasmArray(Float64Array, c);
}
/* the descriptor; false when an array is not in the module's memory (a full plain memory gave the module up) */
function bfDescFill() {
  const d = BFW.desc, buf = WK.mem.buffer;
  const put = (k, a) => { d[k] = a.byteOffset; return a.buffer === buf; };
  let ok = true;
  for (let k = 0; k < BF_DESC.length; k++) ok = put(k, BF[BF_DESC[k]]) && ok;
  ok = put(49, BF.PT) && put(50, BFW.tgt) && put(51, BF_SM) && put(52, BF_TZ) && put(53, BF_SUP1) && put(54, BF_SUP2) && put(55, BF_SUPS) && put(56, BF_MK) && put(57, BF_ST) && ok;
  ok = put(58, BF_CS) && put(59, BF_FS) && put(60, BFA.strong) && put(61, BFA.zone) && put(62, BFA.zw) && put(63, BFA.zd) && put(64, BFA.list) && put(65, BF_T1) && put(66, BF_T2) && put(67, BF_TW) && ok;
  ok = put(68, S.x) && put(69, S.y) && put(70, S.Z) && put(71, S.q) && put(72, S.ionic) && put(73, S.fx) && put(74, S.fy) && put(75, VL.pi) && put(76, VL.pj) && ok;
  ok = put(77, BF.pfa) && put(78, BF.pfb) && put(79, BF.mljR) && put(80, BF.mljS) && put(81, BF.mpol) && put(82, BF.mgw) && put(83, BF.msn) && put(84, BF.mgf) && put(85, BF.mcl) && ok; // (1.19)
  ok = put(86, BF.mdcap) && put(87, BF.mdcapH) && put(88, BF.mdval) && put(89, BF.mdeI) && put(90, BF.mgq) && put(91, BF.mGc) && put(92, BF.mGh) && put(93, BF.mGv) && put(94, BF.mGd) && ok; // (1.20)
  return ok;
}
/* every pair of the members' elements has its type (the module reads BF_TZ) */
function bfTypesAll() {
  const zs = BFW.zs, rep = BFW.zrep, mem = BF.mem; let nz = 0;
  for (const p of mem) { const z = p.Z; let k = 0; while (k < nz && zs[k] !== z) k++; if (k === nz) { zs[nz] = z; rep[nz] = p; nz++; } }
  for (let u = 0; u < nz; u++) for (let v = u; v < nz; v++) {
    const za = zs[u], zb = zs[v], key = za < zb ? za * 128 + zb : zb * 128 + za;
    if (BF_TZ[key] < 0) BF_TZ[key] = bfType(rep[u], rep[v]);
  }
  for (let k = 0; k < nz; k++) rep[k] = null;
}
function bfPassWasm(forces) {
  const ex = WK.ex, P = BFW.par, nm = bfMembers();
  if (!nm) return boPassJS(forces); // (nothing to do; the member arrays may not exist yet)
  bfScratch(nm); bfSupRoom(0);
  let n;
  if (forces) {
    bfTypesAll();
    const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h;
    P[3] = wrap ? 1 : 0; P[4] = bw; P[5] = bh; P[6] = bw / 2; P[7] = bh / 2; P[13] = VL.np; P[11] = BF.pcapN;
    if (!bfDescFill()) return boPassJS(forces);
    n = ex.af_bo_collect(BFW.desc.byteOffset, P.byteOffset);
    if (n > BF.pcapN) { BF.pcapN = 0; bfGrow(n, 0); bfDescFill(); P[11] = BF.pcapN; n = ex.af_bo_collect(BFW.desc.byteOffset, P.byteOffset); }
  } else n = bfPairsJS(false);
  BF.np = n;
  bfGrow(n, nm); bfSupRoom(4 * n);
  if (!bfDescFill()) return boPassJS(forces);
  P[0] = n; P[1] = nm; P[2] = forces ? 1 : 0; P[8] = _stiff; P[12] = BF_SUP1.length; P[15] = BF.r13;
  let E = ex.af_bo_pass1(BFW.desc.byteOffset, P.byteOffset);
  if (P[10] === 1) { bfSupRoom(P[14]); bfDescFill(); P[12] = BF_SUP1.length; P[8] = _stiff; E = ex.af_bo_pass1(BFW.desc.byteOffset, P.byteOffset); }
  _stiff = P[8]; BFW.calls = (BFW.calls || 0) + 1;
  BO.changes++;
  const QP = S.qp, mq = BF.mq, mem = BF.mem, fc = BF.mfc, mls = BF.mls;
  for (let m = 0; m < nm; m++) { const p = mem[m], q = mq[m] - (p._dq || 0); QP[p.i] = q; p.qpol = q; p.qf = 0; p.qi = 0; if (fc[m]) p._boLs = mls[m]; }
  E += BF.eI;
  BO.E = E; BO.np = n; BO.flat = true;
  if (!forces) return E;
  bfPhiOthers();
  ex.af_bo_pass2(BFW.desc.byteOffset, P.byteOffset);
  { const nm2 = BF.nm, mem2 = BF.mem, gq = BF.mgq; for (let m = 0; m < nm2; m++) mem2[m]._dqg = gq[m]; }
  return E;
}
/* the last pass's pair k as { a, b, n, r } (for the readers below) */
const boPairQ = (k) => BO.qm ? XQ.pq[k] : ({ a: BF.mem[BF.pa[k]], b: BF.mem[BF.pb[k]], n: BF.pn[k], r: BF.pr[k] });
/* Who a member is bonded to, for naming and grouping (molecule(), the Data tab, Inspect, selection): its partners of
   order 0.5 or more in the last pass (1.14: molecules were shown as loose atoms, asked for by the user) */
function boNbrs(p) {
  if (!p.bom || !BO.any) return [];
  if (BO.adjAt !== BO.changes) { // (made again once a pass)
    BO.adjAt = BO.changes; const m = BO.adj = new Map();
    for (let k = 0; k < BO.np; k++) { const q = boPairQ(k); if (q.n >= 0.5 && q.a.bom && q.b.bom && !q.a.dead && !q.b.dead) { let l = m.get(q.a); if (!l) m.set(q.a, l = []); l.push(q.b); l = m.get(q.b); if (!l) m.set(q.b, l = []); l.push(q.a); } }
  }
  return BO.adj.get(p) || [];
}
/* A member molecule as stand-in atoms with whole stored-style bonds (boWhole), for what reads bonds and their orders:
   the SMILES writer of Identify molecules (1.14) */
function boProxy(mol) {
  const map = new Map(mol.map(a => [a, { k: a.k, dead: false, el: a.el, q: a.q, Z: a.Z, N: a.N, A: a.A, anti: a.anti, mu: a.mu, x: a.x, y: a.y, bonds: [] }]));
  for (const [a, b, o] of boWhole(new Set(mol))) { const pa = map.get(a), pb = map.get(b), bd = { a: pa, b: pb, order: o }; pa.bonds.push(bd); pb.bonds.push(bd); }
  return mol.map(a => map.get(a));
}
/* Member bonds as the renderer's bond records: a whole order, or a resonating 1.5 (between 1.25 and 1.75), fainter as the
   order falls below 1 (drawn as a bond stretched by 1 − n of its fading length) */
function boDrawBonds() {
  const out = [];
  for (let k = 0; k < BO.np; k++) {
    const q = boPairQ(k), n = q.n;
    if (!(n > 0.15) || q.a.dead || q.b.dead || !q.a.bom || !q.b.bom) continue;
    const ar = n >= 1.25 && n < 1.75;
    out.push({ a: q.a, b: q.b, order: n >= 2.6 ? 3 : n >= 1.75 ? 2 : 1, arom: ar, fo: ar ? n : 0, r0: q.r - (1 - Math.min(n, 1)), rb: 1 });
  }
  return out;
}
/* The bond orders of the last pass, for drawing: [a, b, order] */
function boBonds() { const out = []; for (let k = 0; k < BO.np; k++) { const q = boPairQ(k); if (q.n > 0.15 && !q.a.dead && !q.b.dead && q.a.bom && q.b.bom) out.push([q.a, q.b, q.n]); } return out; }
/* At the start of a step (and when the setting changes): who is a member now, by whole clusters; joiners let go of
   their stored bonds, leavers get stored bonds from their last orders; the energy before and after, at the same
   positions, the difference to the bath. Returns whether anything changed (the forces are then worked out again). */
/* The members' molecules (the atoms joined by orders above 0.3 in the last pass), for the soft intramolecular wall. Looked at
   every 8th step; when they change (a bond made or broken), the energy at the same positions before and after goes to the
   bath, as a stored bond's event does. Returns whether anything changed. */
let BF_UF = new Int32Array(64), BF_UQ = new Int32Array(64);
function bfClusters() {
  if (!BO.any || BO.flat !== true || !BF.nm || (W.step & 7)) return false; // (every 8th step: a molecule made or split a few steps late keeps its old wall till then)
  const nm = BF.nm, mem = BF.mem, pa = BF.pa, pb = BF.pb, pn = BF.pn;
  if (BF_UF.length < nm) { BF_UF = new Int32Array(2 * nm); BF_UQ = new Int32Array(2 * nm); }
  const mk = (U, th) => {
    const find = (x) => { while (U[x] !== x) { U[x] = U[U[x]]; x = U[x]; } return x; };
    for (let m = 0; m < nm; m++) U[m] = m;
    for (let k = 0; k < BF.np; k++) if (pn[k] > th) { const x = find(pa[k]), y = find(pb[k]); if (x !== y) { if (mem[x].id < mem[y].id) U[y] = x; else U[x] = y; } }
    for (let m = 0; m < nm; m++) U[m] = find(m);
  };
  mk(BF_UF, 0.3); mk(BF_UQ, BO_QCL); // (molecules for the wall; the wider groups the electrons move within)
  const U = BF_UF, UQ = BF_UQ;
  let ch = false, qch = false, real = false;
  for (let m = 0; m < nm; m++) {
    const p = mem[m]; if (p.dead || !p.bom) return false; // (a member left since: boSync's own pass sorts it)
    if (p._bcl !== mem[U[m]].id) ch = true;
    if (p._qcl !== mem[UQ[m]].id) qch = true;
    if (Math.abs(p._dq || 0) > 0.5) real = true;
  }
  if (!ch && !qch && !real) return false;
  // the books: everything these changes touch, at the same positions, before and after
  const set = real ? mem.filter(p => Math.abs(p._dq || 0) > 0.5) : null;
  const meas = () => { let e = boPass(false) + boDqKE(); if (set) { e += localPE(new Set(set)); for (const p of set) e += internalE(p); } return e; };
  const Eb = meas();
  for (let m = 0; m < nm; m++) mem[m]._bcl = mem[U[m]].id;
  if (qch) { // (new groups: each one's electrons whole again, its share of the motion taken out)
    const tot = new Map();
    for (let m = 0; m < nm; m++) { const id = mem[UQ[m]].id, p = mem[m]; p._qcl = id; if (p.Z <= 1) continue; let t = tot.get(id); if (!t) tot.set(id, t = { s: 0, v: 0, n: 0, big: p }); t.s += p._dq || 0; t.v += p._dqv || 0; t.n++; if (Math.abs(p._dq || 0) > Math.abs(t.big._dq || 0)) t.big = p; }
    for (const t of tot.values()) { const r = Math.round(t.s) - t.s; if (Math.abs(r) > 1e-12) t.big._dq = (t.big._dq || 0) + r; }
    for (let m = 0; m < nm; m++) { const p = mem[m]; if (p.Z <= 1) continue; const t = tot.get(p._qcl); if (t.n > 1 && t.v) p._dqv = (p._dqv || 0) - t.v / t.n; else if (t.n === 1) p._dqv = 0; }
    BO.dqOn = false; for (const t of tot.values()) if (t.n > 1) { BO.dqOn = true; break; } // (no group with two heavy atoms: nothing can move)
  }
  if (set) for (const p of set) { const k = Math.round(p._dq); p._dq -= k; p.ne += k; refresh(p); } // (a count past half-way becomes the atom's own: H₃O⁺'s charge on the oxygen that now holds three hydrogens)
  const Ea = meas();
  W.ledger.bath += Eb - Ea; BO.bath += Eb - Ea; BO.clChanges = (BO.clChanges || 0) + 1; if (set) BO.dqReal = (BO.dqReal || 0) + set.length;
  if (set) { W.dirty++; vlInvalidate(); }
  return true;
}
/* The electrons' motion (moving charge, 1.20): each member's count ν = ne + δ has a velocity and a mass BO_DQM, pushed by
   −∂E/∂ν (bfDqGrad) less its group's mean (so a group's electrons are conserved), and damped at BO_DQG: the charge
   settles where the energy is lowest within ~10 fs, the work of its damping going to the heat bath. Velocity Verlet with
   the atoms: a half kick and the drift before the force pass (boDqA), the other half kick after (boDqB). */
const BO_DQM = 6, BO_DQG = 2, BO_QCL = 0.02; // (eV·tu²/e²; 1/tu; the order that joins two atoms' electrons)
function bfDqForces() { // (−∂E/∂ν less the group mean, onto p._dqf)
  const mem = BF.mem, tot = new Map();
  const ok = (p) => !p.dead && p.bom && p._qcl !== undefined && p.Z > 1; // (hydrogens keep their one electron: the charge moves between the heavier atoms)
  for (const p of mem) { if (!ok(p)) continue; let t = tot.get(p._qcl); if (!t) tot.set(p._qcl, t = { g: 0, n: 0 }); t.g += p._dqg || 0; t.n++; }
  for (const p of mem) { if (!ok(p)) { p._dqf = 0; continue; } const t = tot.get(p._qcl); p._dqf = t.n > 1 ? -((p._dqg || 0) - t.g / t.n) : 0; }
}
function boDqA(dt) {
  if (!BO.any || BO.flat !== true || !BO.dqOn) return;
  bfDqForces(); const h = 0.5 * dt / BO_DQM;
  for (const p of BF.mem) { if (!p._dqf && !p._dqv) continue; p._dqv = (p._dqv || 0) + h * p._dqf; p._dq = (p._dq || 0) + p._dqv * dt; }
}
function boDqB(dt) {
  if (!BO.any || BO.flat !== true || !BO.dqOn) return;
  bfDqForces(); const h = 0.5 * dt / BO_DQM, c = Math.exp(-BO_DQG * dt); let lost = 0;
  for (const p of BF.mem) { if (!p._dqf && !p._dqv) continue; const v = (p._dqv || 0) + h * p._dqf, v2 = v * c; lost += 0.5 * BO_DQM * (v * v - v2 * v2); p._dqv = v2; }
  if (lost) { W.ledger.bath += lost; BO.bath += lost; }
}
function boDqKE() { if (BO.qm) return 0; let e = 0; for (const p of BF.mem) if (p._dqv && !p.dead && p.bom) e += 0.5 * BO_DQM * p._dqv * p._dqv; return e; }
function boSync() {
  if (!BO.on && !BO.any) return false;
  const clCh = bfClusters();
  // (nothing that decides membership has changed: species, charges, stored bonds, particles made or lost, flags; and a
  // full look every 64 steps anyway)
  const sig = W.topo + ',' + W.dirty + ',' + W.spawned + ',' + W.deaths + ',' + _flagGen + ',' + BO.on;
  if (sig === BO.sig && (W.step & 63)) return clCh;
  const parts = W.parts;
  // clusters: stored bonds, and for members the last orders above 0.3
  const adj = new Map(), link = (a, b) => { let l = adj.get(a); if (!l) adj.set(a, l = []); l.push(b); };
  for (let k = 0; k < BO.np; k++) { const q = boPairQ(k); if (q.n > 0.3 && q.a.bom && q.b.bom && !q.a.dead && !q.b.dead) { link(q.a, q.b); link(q.b, q.a); } }
  const want = new Map(), seen = new Set();
  for (const p of parts) {
    if (p.dead || p.k !== NUC || seen.has(p)) continue;
    const cl = [p]; seen.add(p);
    for (let k = 0; k < cl.length; k++) {
      const a = cl[k];
      for (const bd of a.bonds) { const o = other(bd, a); if (!seen.has(o)) { seen.add(o); cl.push(o); } }
      const l = adj.get(a); if (l) for (const o of l) if (!seen.has(o) && !o.dead) { seen.add(o); cl.push(o); }
    }
    const ok = BO.on && cl.every(boOK) && (cl.length > 1 || cl[0].q === 0) && (BO.qm || !cl.every(boMetal)); // (a lone ion, Cl⁻ in brine, stays with the kernel's ion–water terms; and metal alone, tin, with its metallic cohesion: only its molecules (SnCl₄, SnH₄) take part, 1.25)
    for (const a of cl) want.set(a, ok);
  }
  if (BO.qm) { // (quantum bonds: one calculation for every member together, so only a small system takes part: all or none)
    let nw = 0, nao = 0; for (const [a, v] of want) if (v) { nw++; nao += XTB.nAO(a.Z); }
    // (and only while one calculation stays affordable, 1.23.1: its cost grows with the cube of the orbitals, and with quantum
    // nuclei every bead has its own; 40 heavy atoms, 360 orbitals, took 18 s a step and froze the page)
    XQ.over = nw > XQ.max || nao > XQ.maxAO || nao * nao * nao * (PI.on ? PI.P : 1) > XQ.maxCost ? nw : 0;
    if (XQ.over) for (const a of want.keys()) want.set(a, false);
  }
  const C = [];
  for (const p of parts) if (!p.dead && p.k === NUC && !!p.bom !== !!want.get(p)) C.push(p);
  for (const p of parts) if (p.dead && p.bom) p.bom = false;
  if (!C.length) { BO.any = BO.on && parts.some(p => p.bom); BO.sig = sig; return clCh; }
  const set = new Set(C);
  for (const p of C) for (const bd of p.bonds) set.add(other(bd, p));
  const leave = new Set(C.filter(p => p.bom));
  const intE = () => { let e = 0; if (BO.qm) for (const p of leave) e += internalE(p); return e; }; // (quantum bonds: the ions' charges are placed again, xqCharges)
  const Eb = boPass(false) + localPE(set) + intE(); // (the orders' pass first: it sets the members' partial charges, 1.16)
  // leavers: stored bonds from the last orders, the strongest first, as far as both atoms have valence left
  if (leave.size) {
    if (BO.qm) xqCharges(leave);
    const whole = boWhole(leave);
    for (const p of leave) p.bom = false;
    for (const [a, b, o] of whole) if (!bondBetween(a, b)) addBond(a, b, o);
    relink([...leave]);
  }
  // joiners: their stored bonds let go
  const join = C.filter(p => !leave.has(p));
  for (const p of join) p.bom = true;
  for (const p of join) for (const bd of p.bonds.slice()) removeBond(bd);
  W.dirty++; W.topo++; vlInvalidate();
  if (join.length) { BO.any = true; boRelax(join); }
  const Ea = boPass(false) + localPE(set) + intE();
  W.ledger.bath += Eb - Ea; BO.bath += Eb - Ea;
  BO.any = BO.on && parts.some(p => p.bom && !p.dead);
  BO.sig = W.topo + ',' + W.dirty + ',' + W.spawned + ',' + W.deaths + ',' + _flagGen + ',' + BO.on;
  return true;
}
/* Joiners come with the stored bonds' shapes, a little off this chemistry's own (0.04 eV a bond, more in angles): left
   as they are, the difference turns to heat, and a gallery of molecules jumped from 300 to 1,000 K. They are eased into
   their shapes here first (steepest descent, at most 0.02 Å a move, 60 moves), inside the change whose energy goes to
   the bath; their velocities are kept. */
function boRelax(join) {
  const FX = S.fx, FY = S.fy, n = boRelaxPasses(), f0 = XQ.fails;
  for (let it = 0; it < n; it++) {
    forcesNoEvents();
    if (BO.qm && XQ.fails > f0) break; // (the electrons did not settle: their forces lead nowhere, 1.23.1)
    const FZ = S.fz, d3 = W.d3; // (3-D: in depth too, 1.24)
    let fm = 0; for (const p of join) { const f = d3 ? Math.hypot(FX[p.i], FY[p.i], FZ[p.i]) : Math.hypot(FX[p.i], FY[p.i]); if (f > fm) fm = f; }
    if (fm < 0.05) break;
    const st = Math.min(0.002, 0.02 / fm);
    for (const p of join) { p.x += FX[p.i] * st; p.y += FY[p.i] * st; if (d3) p.z += FZ[p.i] * st; }
    gridTouch();
  }
}
/* How many moves the joiners get: 60, fewer where each move (a force pass over everything, every bead) is dear (1.23.1:
   spawning into 500 atoms with bond orders and beads made 4–9 s frames, into quantum bonds 12 s hangs, each time
   anything joined). Counted from the world, not timed, so runs stay the same from a seed. */
function boRelaxPasses() {
  const P = PI.on ? PI.P : 1;
  if (BO.qm) { let nao = 0; for (const p of W.parts) if (p.bom && !p.dead) nao += XTB.nAO(p.Z); return Math.max(2, Math.min(60, Math.floor(2 * 160 * 160 * 160 / (P * Math.max(1, nao * nao * nao))))); }
  let n = 0; for (const p of W.parts) if (!p.dead) n++;
  return Math.max(6, Math.min(60, Math.floor(36000 / (P * Math.max(1, n))))); // (60 up to 600 particles: those worlds join as before)
}
/* Whole bonds from the last orders (above 0.5), the strongest first, as far as both atoms have valence left: [a, b, order]
   (for members leaving, and for saving a world) */
function boWhole(only) {
  const qs = []; for (let k = 0; k < BO.np; k++) { const q = boPairQ(k); if (q.n > 0.5 && q.a.bom && q.b.bom && !q.a.dead && !q.b.dead && (!only || (only.has(q.a) && only.has(q.b)))) qs.push(q); }
  qs.sort((u, v) => v.n - u.n);
  const used = new Map(), freeV = (p) => capacity(p) - (used.get(p) || 0), out = [];
  for (const q of qs) {
    const o = Math.min(3, Math.max(1, Math.round(q.n)), freeV(q.a), freeV(q.b));
    if (o < 1) continue;
    out.push([q.a, q.b, o]); used.set(q.a, (used.get(q.a) || 0) + o); used.set(q.b, (used.get(q.b) || 0) + o);
  }
  return out;
}
/* The setting: on or off. Turning it off gives every member stored bonds again (boSync). */
function boSet(v) {
  const on = !!v, qm = v === 2;
  if (on === BO.on && qm === BO.qm) return;
  if (BO.on && qm !== BO.qm && W.parts.length) { BO.on = false; boSync(); } // (the other model: every member leaves first, then joins again)
  BO.on = on; BO.qm = qm; XQ.qsh = null; XQ.qsh1 = null; XQ.sig = ''; XQ.pq.length = 0;
  for (const p of W.parts) { p._dq = 0; p._dqv = 0; }
  if (W.parts.length) { boSync(); if (on) BO.any = true; }
}

/* ------------------------------------------------------------------ quantum bonds (Experimental, 1.22)
   Settings → Experimental → Bond orders → Quantum: the members' energy and forces come from GFN1-xTB (Grimme, Bannwarth
   and Shushkov 2017), a tight-binding quantum chemistry (a minimal basis of Slater-type orbitals, an extended Hückel
   Hamiltonian, self-consistent charges to third order), with the D3(BJ) dispersion it was made with (src/xtb.js; it
   matches tblite to 1e-11 eV and its forces to 5e-11 eV/Å on 70 test geometries, tools/xtb/check.js). The electrons
   are worked out for every member at once, each step starting from the last step's charges: bonds, charges and
   barriers come from the electrons, so a proton between two waters finds its own way across. The atoms lie in the
   plane (z = 0), their orbitals in three dimensions.
   Membership is the bond orders' (boSync: whole clusters, the energy at the same positions before and after to the
   bath), but only for a small system: when more than XQ.max atoms would take part, none does. Non-members meet the
   members through the kernel's pairs with the members' Mulliken charges; their potential at each member goes into the
   self-consistent charges (outside potential), so the forces are the energy's exact slopes. The energy counted is
   the binding energy: GFN1's less each member's free atom. Bond orders (Mayer's, from the density) are drawn and
   decide the molecules. */
const XQ = { max: 40, maxAO: 160, maxCost: 160 * 160 * 160, maxIt: 40, acc: 0.01, extra: true, qsh: null, qsh1: null, sig: '', pq: [], eAtom: new Map(), over: 0, calls: 0, it: 0, ms: 0, fails: 0 };
function qmAtomE(Z) {
  let e = XQ.eAtom.get(Z);
  if (e === undefined) { e = XTB.gfn1Energy([Z], [[0, 0, 0]], 0, 0, { accuracy: XQ.acc }).E; XQ.eAtom.set(Z, e); }
  return e;
}
/* the potential (eV per unit charge) at each member from the non-members: the kernel's pair coefficients (qeqC), as bfPhiOthers */
function qmPhi(mem, phi) {
  const QP = S.qp, Q = S.q;
  for (const o of W.parts) {
    if (o.bom || o.dead || o.k !== NUC || !o.Z || o.fast || o.rad) continue;
    const qo = Q[o.i] + QP[o.i]; if (!qo) continue;
    const lr = _lrOn && isLR(o);
    for (let m = 0; m < mem.length; m++) {
      const p = mem[m], [dx, dy, dz] = minImg(o.x - p.x, o.y - p.y, o.z - p.z), r2 = W.d3 ? dx * dx + dy * dy + dz * dz : dx * dx + dy * dy; // (3-D: in depth too, 1.24)
      if (r2 < RC2) phi[m] += qeqC(p, o, r2) * qo;
      else if (lr && isLR(p)) phi[m] += PHYS.KE * qx(o, p) / Math.sqrt(r2);
    }
  }
}
function qmPass(forces) {
  const mem = [];
  for (const p of W.parts) if (p.bom && !p.dead) mem.push(p);
  const n = mem.length, QP = S.qp;
  XQ.pq.length = 0; BO.np = 0; BO.flat = 'qm'; BO.changes++;
  if (!n) { BO.E = 0; return 0; }
  // positions: the plane, each member by the nearest image of the first (a wrapping box); in 3-D, in space (1.24)
  const Z = new Array(n), xyz = new Array(n), x0 = mem[0].x, y0 = mem[0].y, z0 = mem[0].z, d3 = W.d3;
  let charge = 0, sig = '';
  for (let m = 0; m < n; m++) { const p = mem[m], [dx, dy, dz] = minImg(p.x - x0, p.y - y0, p.z - z0); Z[m] = p.Z; xyz[m] = [x0 + dx, y0 + dy, d3 ? z0 + dz : 0]; charge += p.q; sig += p.id + ':' + p.Z + ','; }
  charge = Math.round(charge);
  const phi = new Float64Array(n); qmPhi(mem, phi);
  const vext = new Float64Array(n); let anyV = false;
  for (let m = 0; m < n; m++) { vext[m] = phi[m] / XTB.AUTOEV; if (phi[m]) anyV = true; }
  const t0 = performance.now();
  let r;
  try { r = XTB.gfn1Energy(Z, xyz, charge, 0, { grad: forces, vext: anyV ? vext : null, qsh0: XQ.sig === sig ? xqGuess() : null, bonds: true, accuracy: XQ.acc, maxIter: PI.on ? Math.max(8, Math.floor(XQ.maxIt / Math.sqrt(PI.P))) : XQ.maxIt }); } // (with beads, each a calculation, fewer: 14 at 8 beads; settled ones take 2–5, 1.23.1)
  catch (e) { r = null; }
  if (!r || !r.converged) { XQ.fails++; if (!r) { BO.E = 0; return 0; } }
  const d = XTB.d3Disp(Z, xyz, { grad: forces });
  if (forces) { XQ.qsh1 = XQ.sig === sig ? XQ.qsh : null; XQ.qsh = r.qsh; XQ.sig = sig; XQ.calls++; XQ.it += r.iterations; XQ.ms += performance.now() - t0; } // (a measurement leaves the next step's start alone: runs stay the same however often the energy is read)
  let E = r.E - r.Eext + d.E; // (the outside potential's energy is the kernel's pairs')
  for (let m = 0; m < n; m++) E -= qmAtomE(Z[m]);
  for (let m = 0; m < n; m++) { const p = mem[m], q = r.q[m]; QP[p.i] = q - p.q; p.qpol = q - p.q; p.qf = 0; p.qi = 0; }
  // bond orders (Mayer's): drawn, and the molecules
  const B = r.bonds;
  for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) {
    const nb = B[a * n + b]; if (!(nb > 0.1)) continue;
    const dx = xyz[a][0] - xyz[b][0], dy = xyz[a][1] - xyz[b][1], dz = xyz[a][2] - xyz[b][2];
    XQ.pq.push({ a: mem[a], b: mem[b], n: nb, r: d3 ? Math.sqrt(dx * dx + dy * dy + dz * dz) : Math.hypot(dx, dy) });
  }
  BO.np = XQ.pq.length; BO.E = E;
  if (forces) {
    const FX = S.fx, FY = S.fy, gq = r.g, gd = d.g;
    for (let m = 0; m < n; m++) { const i = mem[m].i; FX[i] -= gq[m][0] + gd[m][0]; FY[i] -= gq[m][1] + gd[m][1]; }
    if (d3) { const FZ = S.fz; for (let m = 0; m < n; m++) FZ[mem[m].i] -= gq[m][2] + gd[m][2]; } // (3-D: the slope in depth, 1.24)
    for (const q of XQ.pq) { if (q.n < 0.2) continue; const w = XQ_K * Math.min(q.n, 3) * (q.a.im + q.b.im); if (w > _stiff) _stiff = w; } // (a bond's stiffness, for the step: about 50 eV/Å² an order, O–H 49, C=O 75, C≡C 100)
  }
  return E;
}
const XQ_K = 50;

/* Leaving quantum bonds, the atoms get whole charges where the electrons put them (a proton that hopped took the +1
   along: the charge is the oxygen's that now holds three hydrogens). Molecules from the last bond orders (heavy atoms
   by orders above 0.5, each hydrogen with its strongest partner above 0.2); each takes its rounded Mulliken charge
   (the members' total kept), placed on the atom with the most bonds over its valence (a cation) or the fewest (an anion). */
function xqCharges(leave) {
  const mem = [...leave].filter(p => !p.dead), ix = new Map(mem.map((p, k) => [p, k])), n = mem.length, U = new Int32Array(n).map((_, k) => k);
  const find = (x) => { while (U[x] !== x) { U[x] = U[U[x]]; x = U[x]; } return x; };
  const best = new Array(n).fill(null), bsum = new Float64Array(n);
  for (const q of XQ.pq) {
    const a = ix.get(q.a), b = ix.get(q.b); if (a === undefined || b === undefined) continue;
    if (q.n > 0.5) { bsum[a] += Math.round(q.n); bsum[b] += Math.round(q.n); }
    if (q.a.Z > 1 && q.b.Z > 1) { if (q.n > 0.5) U[find(a)] = find(b); continue; }
    for (const [h, o] of [[a, b], [b, a]]) if (mem[h].Z === 1 && q.n > 0.2 && (!best[h] || q.n > best[h].n)) best[h] = { o, n: q.n };
  }
  for (let h = 0; h < n; h++) if (best[h]) { const x = find(h), y = find(best[h].o); if (x !== y) U[x] = y; }
  const fr = new Map(); for (let k = 0; k < n; k++) { const r = find(k); let f = fr.get(r); if (!f) fr.set(r, f = { at: [], qm: 0, lab: 0 }); f.at.push(k); f.qm += mem[k].q + S.qp[mem[k].i]; f.lab += mem[k].q; }
  const F = [...fr.values()]; let lab = 0, sum = 0;
  for (const f of F) { f.Q = Math.round(f.qm); lab += f.lab; sum += f.Q; }
  while (sum !== lab) { const up = sum < lab; let pick = null, res = -Infinity; for (const f of F) { const r = up ? f.qm - f.Q : f.Q - f.qm; if (r > res) { res = r; pick = f; } } pick.Q += up ? 1 : -1; sum += up ? 1 : -1; }
  for (const f of F) {
    if (f.at.reduce((t, k) => t + mem[k].q, 0) === f.Q && f.at.every(k => mem[k].q === 0 || bsum[k] - capacity(mem[k]) === 0)) continue; // (already right)
    for (const k of f.at) { const p = mem[k]; if (p.q) { p.ne += p.q; refresh(p); } }
    for (let u = 0; u < Math.abs(f.Q); u++) {
      const sg = Math.sign(f.Q); let pick = null, sc = -Infinity;
      for (const k of f.at) { const p = mem[k]; if (p.ne - sg < 0 || p.ne - sg > p.Z + 1) continue; const v = sg * (bsum[k] - capacity(p)) + 0.5 * sg * (p.q + S.qp[p.i]) + (p.Z > 1 ? 0.25 : 0); if (v > sc) { sc = v; pick = p; } }
      if (pick) { pick.ne -= sg; refresh(pick); }
    }
  }
  W.dirty++;
}
/* the next step's starting charges: on from the last two steps' (a straight line), or the last step's */
function xqGuess() {
  const q = XQ.qsh, q1 = XQ.qsh1;
  if (!XQ.extra || !q1 || q1.length !== q.length) return q;
  const g = new Array(q.length); for (let k = 0; k < q.length; k++) g[k] = 2 * q[k] - q1[k];
  return g;
}
