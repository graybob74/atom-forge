/* ------------------------------------------------------------------ continuous bond orders (Experimental, 1.13)
   With Settings → Experimental → Continuous bond orders on, neutral molecules of non-metals (H, B, C, N, O, F, Si, P,
   S, Cl, Br, I) keep no stored bonds: every pair's bond order is worked out at every step from where the atoms are, and
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
const BO_EPS = 0.03, BO_PLOW = 1.15, BO_WIN = 0.05, BO_TA = 0.15, BO_TB = 0.35, BO_SW = 0.5; // (smoothing; Dof's power below a single bond; the taper; the non-bonded switch's width)
const boSp = (x) => x <= -BO_EPS ? 0 : x >= BO_EPS ? x : (x + BO_EPS) * (x + BO_EPS) / (4 * BO_EPS);
const boSpD = (x) => x <= -BO_EPS ? 0 : x >= BO_EPS ? 1 : (x + BO_EPS) / (2 * BO_EPS);
const boH = (d) => d < BO_EPS ? 0.5 * d * (1 - d / BO_EPS) * (1 - d / BO_EPS) : 0;
const boFade = (c) => { const t = c <= 0 ? 0 : c >= 2 * BO_EPS ? 1 : c / (2 * BO_EPS); return t * t * (3 - 2 * t); }; // (a partner asking for nothing counts for nothing)
const boFadeD = (c) => { if (c <= 0 || c >= 2 * BO_EPS) return 0; const t = c / (2 * BO_EPS); return 6 * t * (1 - t) / (2 * BO_EPS); };
const boHD = (d) => d < BO_EPS ? 0.5 * (1 - d / BO_EPS) * (1 - d / BO_EPS) - d * (1 - d / BO_EPS) / BO_EPS : 0;
/* Depth and stiffness of a bond of order N: the game's tables at whole orders, straight lines between (a power below a
   single bond), the corners at 1, 2 and 3 rounded over ±0.05 by blending the two pieces either side (their values meet
   at the corner): a corner put a jump in the force of every bond crossing it. [value, slope] */
const BO_KH = 0.05;
const BO_TG = new Map(); // (the VSEPR targets, sorted, by partners, lone pairs, period, all-hydrogen)
let BO_C = new Float64Array(16), BO_F = new Float64Array(16); // (scratch for the level's solve)
function boKnot(N, f, g) { // pieces f (left) and g (right) of a corner at round(N), blended over ±BO_KH
  const K = Math.round(N), t = (N - K + BO_KH) / (2 * BO_KH);
  if (t <= 0) return f(N); if (t >= 1) return g(N);
  const w = t * t * (3 - 2 * t), dw = 6 * t * (1 - t) / (2 * BO_KH), a = f(N), b = g(N);
  return [a[0] + w * (b[0] - a[0]), a[1] + w * (b[1] - a[1]) + dw * (b[0] - a[0])];
}
function boDepth(P, N) {
  const D = P.D, p0 = (n) => n <= 0 ? [0, 0] : [D[0] * Math.pow(n, BO_PLOW), D[0] * BO_PLOW * Math.pow(n, BO_PLOW - 1)];
  const p1 = (n) => [D[0] + (D[1] - D[0]) * (n - 1), D[1] - D[0]], p2 = (n) => [D[1] + (D[2] - D[1]) * (n - 2), D[2] - D[1]], p3 = () => [D[2], 0];
  if (N < 1 - BO_KH) return p0(N); if (N < 1 + BO_KH) return boKnot(N, p0, p1);
  if (N < 2 - BO_KH) return p1(N); if (N < 2 + BO_KH) return boKnot(N, p1, p2);
  if (N < 3 - BO_KH) return p2(N); if (N < 3 + BO_KH) return boKnot(N, p2, p3);
  return p3(N);
}
function boStiff(P, N) {
  const A = P.al, p0 = () => [A[0], 0], p1 = (n) => [A[0] + (A[1] - A[0]) * (n - 1), A[1] - A[0]], p2 = (n) => [A[1] + (A[2] - A[1]) * (n - 2), A[2] - A[1]], p3 = () => [A[2], 0];
  if (N < 1 - BO_KH) return p0(N); if (N < 1 + BO_KH) return boKnot(N, p0, p1);
  if (N < 2 - BO_KH) return p1(N); if (N < 2 + BO_KH) return boKnot(N, p1, p2);
  if (N < 3 - BO_KH) return p2(N); if (N < 3 + BO_KH) return boKnot(N, p2, p3);
  return p3(N);
}
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
  return p.k === NUC && !p.dead && !p.fast && !p.rad && !p.anti && p.Z > 0 && BO.Ztab.has(p.Z) && p.ne === p.Z && p.q === 0 && !p.exo && !p.mu;
}
/* The pairs of member atoms within the force reach: from the neighbour list in a force pass, from the grid otherwise. */
function boCollect(useVL) {
  const L = BO.pairs; let n = 0;
  const X = S.x, Y = S.y, OBJ = S.obj, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2;
  const put = (a, b, dx, dy, r2) => {
    if (r2 >= RC2 || r2 < 1e-12) return;
    let q = L[n]; if (!q) q = L[n] = {};
    q.a = a; q.b = b; q.r = Math.sqrt(r2); q.ux = dx / q.r; q.uy = dy / q.r; q.P = boPP(a.el, b.el); n++;
  };
  if (useVL) {
    const pi = VL.pi, pj = VL.pj;
    for (let k = 0; k < VL.np; k++) {
      const a = OBJ[pi[k]], b = OBJ[pj[k]];
      if (!a || !b || !a.bom || !b.bom || a.dead || b.dead) continue;
      let dx = X[pj[k]] - X[pi[k]], dy = Y[pj[k]] - Y[pi[k]];
      if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
      put(a, b, dx, dy, dx * dx + dy * dy);
    }
  } else {
    for (const a of W.parts) {
      if (!a.bom || a.dead) continue;
      nearby(a.x, a.y, RC, (b, dx, dy, r2) => { if (b.bom && b !== a && b.id > a.id) put(a, b, dx, dy, r2); });
    }
  }
  BO.np = n;
  return n;
}
/* The energy of the member atoms (bond terms, angles, the switched non-bonded pairs), and with forces on, their forces
   into S.fx, S.fy. */
function boPass(forces) {
  const n = boCollect(forces), L = BO.pairs;
  const by = new Map(); // atom → its bond-term pairs
  let E = 0;
  // non-bonded (switched), raw orders, the taper
  for (let k = 0; k < n; k++) {
    const q = L[k], P = q.P, a = q.a, b = q.b;
    q.gr = 0; q.gn = 0; q.gca = 0; q.gcb = 0; q.n = 0; q.ne = 0; q.eL = 0; q.eM = 0;
    // the Lennard-Jones pair of the kernel (ljV, two atoms of no molecule), switched on from the bond's reach
    if (P.eps === undefined) { const lj = ljPair(a, b); P.rm = lj[0]; P.eps = lj[1]; P.rOn = Math.max(P.reach, 0.62 * lj[0] + 0.05); P.rCut = 2.6 * lj[0]; } // (members are neutral: the pair's Lennard-Jones constants are its elements')
    const rm = P.rm, eps = P.eps, rOn = P.rOn;
    if (eps > 0 && q.r > rOn && q.r < P.rCut) {
      const s2 = rm * rm / (q.r * q.r), s6 = s2 * s2 * s2, V = eps * (s6 * s6 - 2 * s6 + LJ_VCUT), dV = eps * (-12 * s6 * s6 + 12 * s6) / q.r;
      const t = (q.r - rOn) / BO_SW, sw = t >= 1 ? 1 : t * t * (3 - 2 * t), dsw = t >= 1 ? 0 : 6 * t * (1 - t) / BO_SW;
      E += sw * V; q.eL = sw * V; q.gr += sw * dV + dsw * V;
    }
    if (q.r >= P.reach) continue;
    // raw order and its slope
    const d = q.r - P.r[0]; let n0, dn0;
    if (d > 0) { n0 = Math.exp(-P.beta * d * d); dn0 = -2 * P.beta * d * n0; } else { const w2 = BO_WIN * BO_WIN, h = d * d / (d * d + w2), hd = 2 * d * w2 / ((d * d + w2) * (d * d + w2)); n0 = Math.exp(-d * h / P.c); dn0 = -n0 * (h + d * hd) / P.c; } // (Pauling's rule inward, eased in over 0.05 Å: no corner at the single-bond length)
    if (d > 0.9) { const u = Math.PI * (d - 0.9) / 0.4, f = 0.5 * (1 + Math.cos(u)), fd = -0.5 * Math.sin(u) * Math.PI / 0.4; dn0 = dn0 * f + n0 * fd; n0 *= f; }
    if (n0 >= 3.5) { n0 = 3.5; dn0 = 0; }
    let ne, dne;
    if (n0 >= BO_TB) { ne = n0; dne = 1; } else if (n0 <= BO_TA) { ne = 0; dne = 0; } else { const w = BO_TB - BO_TA, t = (n0 - BO_TA) / w, s = t * t * (3 - 2 * t); ne = n0 * s; dne = s + n0 * 6 * t * (1 - t) / w; }
    q.ne = ne; q.dne = dne * dn0;
    // the soft core
    const z2 = P.sig * P.sig / (q.r * q.r), z6 = z2 * z2 * z2, s12 = z6 * z6; E += 0.05 * s12; q.gr += -0.6 * s12 / q.r;
    let la = by.get(a); if (!la) by.set(a, la = []); la.push(q);
    let lb = by.get(b); if (!lb) by.set(b, lb = []); lb.push(q);
  }
  // caps, levels, orders
  const cap = (p) => { let v = p._boV; if (v === undefined) { p._boV = v = capacity(p); p._boVH = hyperCap(p); } return v; };
  for (const [p, list] of by) {
    cap(p);
    for (const q of list) { // atom p's view of each partner o: capped by what o can give
      const o = q.a === p ? q.b : q.a; cap(o);
      const C = Math.min(p.el.en >= 3.0 ? o._boVH : o._boV, 3), dd = Math.abs(q.ne - C), h = boH(dd), g = boHD(dd);
      const c = q.ne <= C ? q.ne + h : C + h, dc = q.ne <= C ? 1 - g : g;
      if (q.a === p) { q.ca = c; q.dca = dc; } else { q.cb = c; q.dcb = dc; }
    }
    // an expanded octet (period 3 and on) toward electronegative partners, blended in as they come to ask: H = 1 − Π(1 − fade)
    let keep = 1; const dV = p._boVH - p._boV;
    if (dV) for (const q of list) { const o = q.a === p ? q.b : q.a; if (o.el.en >= 3.0) keep *= 1 - boFade(q.a === p ? q.ca : q.cb); }
    const V = p._boV + dV * (1 - keep); p._boKeep = keep;
    // the level: Σ sp(cₖ − L)·fade(cₖ) = V falls as L rises; Newton's steps from the last pass's level, kept inside a
    // bracket (halving it when a step would leave it), to 1e-13
    const m = list.length, cs = BO_C.length < m ? (BO_C = new Float64Array(2 * m)) : BO_C, fs = BO_F.length < m ? (BO_F = new Float64Array(2 * m)) : BO_F;
    let lo = -V - 1, hi = 4;
    for (let k = 0; k < m; k++) { const q = list[k], c = q.a === p ? q.ca : q.cb; cs[k] = c; fs[k] = boFade(c); if (c + 1 > hi) hi = c + 1; }
    let L = p._boLs !== undefined && p._boLs > lo && p._boLs < hi ? p._boLs : 0.5 * (lo + hi);
    for (let it = 0; it < 100; it++) {
      let G = -V, U = 0; for (let k = 0; k < m; k++) { const x = cs[k] - L; G += boSp(x) * fs[k]; U += boSpD(x) * fs[k]; }
      if (Math.abs(G) < 1e-13) break;
      if (G > 0) lo = L; else hi = L;
      let Ln = U > 0 ? L + G / U : NaN;
      if (!(Ln > lo && Ln < hi)) Ln = 0.5 * (lo + hi);
      if (hi - lo < 1e-15) break;
      L = Ln;
    }
    p._boLs = L; p._boL = boSp(L); p._boGL = 0;
  }
  for (const [, list] of by) for (const q of list) {
    if (q.done === BO.changes + 0.5) continue; // (each pair once)
    q.done = BO.changes + 0.5;
    const xa = q.ca - q.a._boL, xb = q.cb - q.b._boL, fa = boFade(q.ca), fb = boFade(q.cb), A = boSp(xa) * fa, B = boSp(xb) * fb, dd = Math.abs(A - B), h = boH(dd), g = boHD(dd);
    q.n = Math.max(0, (A <= B ? A : B) + h);
    const nA = A <= B ? 1 - g : g, nB = A <= B ? g : 1 - g; // (∂n/∂A, ∂n/∂B; A = sp(c − L)·fade(c))
    q.sA = nA * boSpD(xa) * fa; q.tA = nA * boSp(xa) * boFadeD(q.ca); q.sB = nB * boSpD(xb) * fb; q.tB = nB * boSp(xb) * boFadeD(q.cb);
    // the pair's Morse curve of its order
    const N = q.n, P = q.P;
    if (N > 1e-6) {
      const [D, dD] = boDepth(P, N);
      const N2 = N * N + 0.0025, r0 = P.r[0] - 0.5 * P.c * Math.log(N2), dr0 = -P.c * N / N2; // (Pauling's length, its logarithm rounded off below 0.05: a kink there put a jump in the force)
      const [al, dal] = boStiff(P, N);
      const x = q.r - r0, ex = Math.exp(-al * x), e = 1 - ex, d = q.r - P.r[0];
      let fc = 1, dfc = 0; if (d > 0.9) { const u = Math.PI * (d - 0.9) / 0.4; fc = 0.5 * (1 + Math.cos(u)); dfc = -0.5 * Math.sin(u) * Math.PI / 0.4; }
      const M = D * (e * e - 1), dMdr = D * 2 * e * ex * al;
      E += fc * M; q.eM = fc * M; q.gr += fc * dMdr + dfc * M;
      if (forces) { const w = 8 * D * al * al * fc * (S.im[q.a.i] + S.im[q.b.i]); if (w > _stiff) _stiff = w; } // (the bond's stiffness sets the longest step, as a stored bond's does: four times its curvature at rest, for the sharper turns of the orders themselves; at the plain curvature a hot gallery drifted 1–3 eV in 60 fs, at this 0.05)
      q.gn += fc * ((e * e - 1) * dD - dMdr * dr0 + D * 2 * e * ex * x * dal);
    }
  }
  BO.changes++;
  // angles: the game's VSEPR terms on the centre's partners. A partner of order 0.7 or more always counts; one between
  // 0.4 and 0.7 counts with weight w = smoothstep((n − 0.4)/0.3): the energy is the expectation over which of those are
  // in (each subset weighted by Π w · Π (1 − w)), smooth however many are on the way in or out at once. Lone pairs
  // are blended between whole numbers (boAngles).
  for (const [c, list] of by) {
    if (c.el.dblock) continue;
    const strong = [], zone = [], zw = [], zd = [];
    for (const q of list) {
      if (q.n >= 0.7) strong.push(q);
      else if (q.n > 0.4) { const x = (q.n - 0.4) / 0.3; zone.push(q); zw.push(x * x * (3 - 2 * x)); zd.push(6 * x * (1 - x) / 0.3); }
    }
    if (strong.length + zone.length < 2) continue;
    if (zone.length > 6) { const o = zone.map((q, k) => k).sort((u, v) => zone[v].n - zone[u].n).slice(0, 6); const z2 = o.map(k => zone[k]), w2 = o.map(k => zw[k]), d2 = o.map(k => zd[k]); zone.length = 0; zone.push(...z2); zw.length = 0; zw.push(...w2); zd.length = 0; zd.push(...d2); } // (at most 64 subsets: a crowd past that keeps its 6 strongest)
    const z = zone.length;
    for (let m = 0; m < 1 << z; m++) {
      let wt = 1; const L = strong.slice();
      for (let k = 0; k < z; k++) if (m & (1 << k)) { wt *= zw[k]; L.push(zone[k]); } else wt *= 1 - zw[k];
      if (wt <= 0 || L.length < 2) continue;
      const [e, dS] = boAngles(c, L, wt, forces);
      E += wt * e;
      if (dS) for (const q of L) q.gn += wt * dS;
      for (let k = 0; k < z; k++) { // the weights' slopes: ∂wt/∂wₖ = wt/wₖ or −wt/(1 − wₖ), worked out without dividing
        let o = 1; for (let j = 0; j < z; j++) if (j !== k) o *= m & (1 << j) ? zw[j] : 1 - zw[j];
        zone[k].gn += (m & (1 << k) ? o : -o) * zd[k] * e;
      }
    }
  }
  E += boCoulomb(forces, n, L); // (1.16: partial charges from the orders)
  BO.E = E;
  if (!forces) { for (const [p] of by) { p._boV = undefined; } return E; }
  // back through the orders to the distances
  for (let k = 0; k < n; k++) {
    const q = L[k]; if (!(q.n > 0)) continue;
    if (q.qc) q.gn += (q.a._boPhi - q.b._boPhi) * q.qc * q.qdh; // (the charges' slopes: ∂E/∂qₐ = φₐ, ∂qₐ/∂n = −∂q_b/∂n)
    if (!q.gn) continue;
    q.gca += q.gn * (q.sA + q.tA); q.a._boGL -= q.gn * q.sA; q.gcb += q.gn * (q.sB + q.tB); q.b._boGL -= q.gn * q.sB;
  }
  for (const [p, list] of by) {
    if (p._boGL) {
      // Σ sp(cₖ − L*)·fade(cₖ) = V: dL*/dcₖ = (sp′(cₖ − L*)·fade(cₖ) + sp(cₖ − L*)·fade′(cₖ)) / Σ sp′(cₖ − L*)·fade(cₖ)
      const gs = p._boGL * boSpD(p._boLs); let U = 0;
      for (const q of list) { const c = q.a === p ? q.ca : q.cb; U += boSpD(c - p._boLs) * boFade(c); }
      if (U > 0) for (const q of list) { const c = q.a === p ? q.ca : q.cb, w = (boSpD(c - p._boLs) * boFade(c) + boSp(c - p._boLs) * boFadeD(c)) * gs / U; if (q.a === p) q.gca += w; else q.gcb += w; }
      const dV = p._boVH - p._boV; // (and through the valence: dL*/dV = −1/U, dV/dcₖ = ΔV·fade′(cₖ)·Π_{j≠k}(1 − fadeⱼ))
      if (U > 0 && dV) for (const q of list) {
        const o = q.a === p ? q.b : q.a; if (o.el.en < 3.0) continue;
        const c = q.a === p ? q.ca : q.cb, f = boFade(c); if (f >= 1) continue;
        const w = -gs / U * dV * boFadeD(c) * p._boKeep / (1 - f); if (q.a === p) q.gca += w; else q.gcb += w;
      }
    }
    p._boV = undefined;
  }
  const FX = S.fx, FY = S.fy;
  for (let k = 0; k < n; k++) {
    const q = L[k];
    if (q.r < q.P.reach) q.gr += (q.gca * q.dca + q.gcb * q.dcb) * q.dne;
    if (!q.gr) continue;
    const fx = q.gr * q.ux, fy = q.gr * q.uy, i = q.a.i, j = q.b.i;
    FX[j] -= fx; FY[j] -= fy; FX[i] += fx; FY[i] += fy;
  }
  return E;
}
/* Partial charges that follow the orders (1.16). Each pair gives its atoms K·Δχ·h(n) (K = 0.30 e per unit of Pauling
   electronegativity, as a stored bond does), h(n) = 1 + 0.2(n − 1) at and above a single bond, the order itself below it
   (fading out as the bond breaks), the corner at 1 rounded over ±0.05. The members' charges meet everything charged as a
   stored molecule's do: non-members through the kernel (S.qp), each other here, the same soft Coulomb, with bonded (1-2)
   and angle (1-3) pairs left out smoothly: weight (1 − b(nᵢⱼ))·Πₖ(1 − b(nᵢₖ)·b(nₖⱼ)), b rising from 0 at order 0.3 to
   1 at 0.7. The charges depend on the positions, so the forces carry their slopes too: φᵢ·∂qᵢ/∂n for every order, φ the
   potential at the atom from every charge it meets (the kernel's pairs and these), into the orders' own back-pass. */
const boQh = (N) => N < 1 - BO_KH ? [N, 1] : N > 1 + BO_KH ? [1 + 0.2 * (N - 1), 0.2] : boKnot(N, (x) => [x, 1], (x) => [1 + 0.2 * (x - 1), 0.2]);
const boB = (n) => { if (n <= 0.3) return 0; if (n >= 0.7) return 1; const t = (n - 0.3) / 0.4; return t * t * (3 - 2 * t); };
const boBD = (n) => { if (n <= 0.3 || n >= 0.7) return 0; const t = (n - 0.3) / 0.4; return 6 * t * (1 - t) / 0.4; };
function boCoulomb(forces, n, L) {
  const QP = S.qp, mem = [];
  for (const p of W.parts) if (p.bom && !p.dead) { p._boQ = 0; p._boPhi = 0; mem.push(p); }
  for (let k = 0; k < n; k++) {
    const q = L[k]; q.qc = 0;
    if (!(q.n > 0)) continue;
    const ea = q.a.el.en || 2.6, eb = q.b.el.en || 2.6; if (ea === eb) continue;
    const hh = boQh(q.n); q.qc = PARTIAL_K * (eb - ea); q.qh = hh[0]; q.qdh = hh[1];
    q.a._boQ += q.qc * hh[0]; q.b._boQ -= q.qc * hh[0];
  }
  for (const p of mem) { QP[p.i] = p._boQ; p.qpol = p._boQ; p.qf = 0; p.qi = 0; }
  // bonded and angle neighbours, for the exclusions
  const adj = new Map();
  for (let k = 0; k < n; k++) { const q = L[k]; if (!(q.n > 0.3)) continue; let m = adj.get(q.a); if (!m) adj.set(q.a, m = new Map()); m.set(q.b, q); m = adj.get(q.b); if (!m) adj.set(q.b, m = new Map()); m.set(q.a, q); }
  let E = 0;
  for (let k = 0; k < n; k++) {
    const q = L[k], a = q.a, b = q.b, qa = a._boQ, qb = b._boQ;
    if (!qa && !qb) continue;
    const b0 = boB(q.n); if (b0 >= 1) continue;
    let prod = 1, terms = null;
    const ma = adj.get(a), mb = adj.get(b);
    if (ma && mb && q.r < 4.4) for (const [c, q1] of ma) { const q2 = mb.get(c); if (!q2) continue; const w = boB(q1.n) * boB(q2.n); if (w <= 0) continue; prod *= 1 - w; (terms || (terms = [])).push(q1, q2, w); } // (q.r < 4.4: a 1-3 pair with both orders above 0.3 is never farther apart)
    const s = (1 - b0) * prod; if (!(s > 0)) continue;
    const K = PHYS.KE * iwK(a, b), r2 = q.r * q.r, sq = Math.sqrt(r2 + 0.09), c = K * (1 / sq - csh(a, b, 0.09));
    E += s * c * qa * qb;
    if (!forces) continue;
    q.gr += -s * K * q.r / (sq * sq * sq) * qa * qb;
    a._boPhi += s * c * qb; b._boPhi += s * c * qa;
    const Es = c * qa * qb; // ∂E/∂s
    if (!Es) continue;
    if (b0 > 0) q.gn -= Es * boBD(q.n) * prod;
    if (terms) for (let t = 0; t < terms.length; t += 3) {
      const q1 = terms[t], q2 = terms[t + 1], w = terms[t + 2], dsw = -(1 - b0) * prod / (1 - w);
      q1.gn += Es * dsw * boBD(q1.n) * boB(q2.n); q2.gn += Es * dsw * boB(q1.n) * boBD(q2.n);
    }
  }
  let others = false; for (const p of W.parts) if (!p.bom && !p.dead && p.k === NUC && p.Z > 0) { others = true; break; }
  if (forces && others) { // the potential at each member from the non-members it meets (the kernel's pairs: same coefficients, qeqC)
    const pi = VL.pi, pj = VL.pj, ex = VL.ex, OBJ = S.obj, X = S.x, Y = S.y, Q = S.q, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2;
    for (let k = 0; k < VL.np; k++) {
      if (ex[k]) continue;
      const i = pi[k], j = pj[k], a = OBJ[i], b = OBJ[j];
      if (!a || !b || a.bom === b.bom || a.k !== NUC || b.k !== NUC || !a.Z || !b.Z || a.dead || b.dead || a.fast || b.fast || a.rad || b.rad) continue;
      let dx = X[j] - X[i], dy = Y[j] - Y[i];
      if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
      const r2 = dx * dx + dy * dy; if (r2 >= RC2) continue;
      const m = a.bom ? a : b, o = m === a ? b : a, qo = Q[o.i] + QP[o.i]; if (!qo) continue;
      m._boPhi += qeqC(m, o, r2) * qo;
    }
  }
  return E;
}
/* One centre's angle energy with partner list nb (weight wgt for its forces); returns [E, dE/d(each partner's order)] */
function boAngles(c, nb, wgt, forces) {
  const n = nb.length; if (n < 2 || n > 6) return [0, 0];
  let sum = 0; for (const q of nb) sum += q.n;
  const lpr0 = (c.val - sum) / 2, lpr = Math.max(0, lpr0), l0 = Math.floor(lpr), f = lpr - l0, dfds = lpr0 > 0 ? -0.5 : 0;
  const per = periodOf(c.el.Z); let allH = true;
  const angs = [];
  for (const q of nb) { const o = q.a === c ? q.b : q.a, sg = q.a === c ? 1 : -1; if (o.Z !== 1) allH = false; angs.push({ o, a: Math.atan2(sg * q.uy, sg * q.ux), dx: sg * q.ux * q.r, dy: sg * q.uy * q.r, g: 0 }); }
  angs.sort((u, v) => u.a - v.a);
  const gaps = []; for (let k = 0; k < n; k++) gaps.push({ v: k === n - 1 ? angs[0].a + 2 * Math.PI - angs[k].a : angs[k + 1].a - angs[k].a, hi: k === n - 1 ? 0 : k + 1, lo: k });
  gaps.sort((u, v) => u.v - v.v);
  const e = (lp, w) => {
    const key = ((n * 8 + lp) * 8 + per) * 2 + (allH ? 1 : 0); let tg = BO_TG.get(key); if (!tg) BO_TG.set(key, tg = angleTargetsRaw(n, lp, per, allH).slice().sort((u, v) => u - v)); let t = 0;
    for (let k = 0; k < n; k++) { const dv = gaps[k].v - tg[k]; t += 0.5 * ANGLE_K * dv * dv; if (w) { const gk = w * ANGLE_K * dv; angs[gaps[k].hi].g += gk; angs[gaps[k].lo].g -= gk; } }
    return t;
  };
  let E, dEds;
  if (f > 1e-9) { const e0 = e(l0, forces ? wgt * (1 - f) : 0), e1 = e(l0 + 1, forces ? wgt * f : 0); E = (1 - f) * e0 + f * e1; dEds = (e1 - e0) * dfds; }
  else { E = e(l0, forces ? wgt : 0); dEds = 0; }
  if (forces) {
    const FX = S.fx, FY = S.fy, i = c.i;
    for (const s of angs) {
      if (!s.g) continue;
      const r2 = s.dx * s.dx + s.dy * s.dy, gx = s.g * -s.dy / r2, gy = s.g * s.dx / r2, j = s.o.i;
      FX[j] -= gx; FY[j] -= gy; FX[i] += gx; FY[i] += gy;
    }
  }
  return [E, dEds];
}
/* Who a member is bonded to, for naming and grouping (molecule(), the Data tab, Inspect, selection): its partners of
   order 0.5 or more in the last pass (1.14: molecules were shown as loose atoms, asked for by the user) */
function boNbrs(p) {
  if (!p.bom || !BO.any) return [];
  if (BO.adjAt !== BO.changes) { // (made again once a pass)
    BO.adjAt = BO.changes; const m = BO.adj = new Map();
    for (let k = 0; k < BO.np; k++) { const q = BO.pairs[k]; if (q.n >= 0.5 && q.a.bom && q.b.bom && !q.a.dead && !q.b.dead) { let l = m.get(q.a); if (!l) m.set(q.a, l = []); l.push(q.b); l = m.get(q.b); if (!l) m.set(q.b, l = []); l.push(q.a); } }
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
    const q = BO.pairs[k], n = q.n;
    if (!(n > 0.15) || q.a.dead || q.b.dead || !q.a.bom || !q.b.bom) continue;
    const ar = n >= 1.25 && n < 1.75;
    out.push({ a: q.a, b: q.b, order: n >= 2.6 ? 3 : n >= 1.75 ? 2 : 1, arom: ar, fo: ar ? n : 0, r0: q.r - (1 - Math.min(n, 1)), rb: 1 });
  }
  return out;
}
/* The bond orders of the last pass, for drawing: [a, b, order] */
function boBonds() { const out = []; for (let k = 0; k < BO.np; k++) { const q = BO.pairs[k]; if (q.n > 0.15 && !q.a.dead && !q.b.dead && q.a.bom && q.b.bom) out.push([q.a, q.b, q.n]); } return out; }
/* At the start of a step (and when the setting changes): who is a member now, by whole clusters; joiners let go of
   their stored bonds, leavers get stored bonds from their last orders; the energy before and after, at the same
   positions, the difference to the bath. Returns whether anything changed (the forces are then worked out again). */
function boSync() {
  if (!BO.on && !BO.any) return false;
  // (nothing that decides membership has changed: species, charges, stored bonds, particles made or lost, flags; and a
  // full look every 64 steps anyway)
  const sig = W.topo + ',' + W.dirty + ',' + W.spawned + ',' + W.deaths + ',' + _flagGen + ',' + BO.on;
  if (sig === BO.sig && (W.step & 63)) return false;
  const parts = W.parts;
  // clusters: stored bonds, and for members the last orders above 0.3
  const adj = new Map(), link = (a, b) => { let l = adj.get(a); if (!l) adj.set(a, l = []); l.push(b); };
  for (let k = 0; k < BO.np; k++) { const q = BO.pairs[k]; if (q.n > 0.3 && q.a.bom && q.b.bom && !q.a.dead && !q.b.dead) { link(q.a, q.b); link(q.b, q.a); } }
  const want = new Map(), seen = new Set();
  for (const p of parts) {
    if (p.dead || p.k !== NUC || seen.has(p)) continue;
    const cl = [p]; seen.add(p);
    for (let k = 0; k < cl.length; k++) {
      const a = cl[k];
      for (const bd of a.bonds) { const o = other(bd, a); if (!seen.has(o)) { seen.add(o); cl.push(o); } }
      const l = adj.get(a); if (l) for (const o of l) if (!seen.has(o) && !o.dead) { seen.add(o); cl.push(o); }
    }
    const ok = BO.on && cl.every(boOK);
    for (const a of cl) want.set(a, ok);
  }
  const C = [];
  for (const p of parts) if (!p.dead && p.k === NUC && !!p.bom !== !!want.get(p)) C.push(p);
  for (const p of parts) if (p.dead && p.bom) p.bom = false;
  if (!C.length) { BO.any = BO.on && parts.some(p => p.bom); BO.sig = sig; return false; }
  const set = new Set(C);
  for (const p of C) for (const bd of p.bonds) set.add(other(bd, p));
  const Eb = boPass(false) + localPE(set); // (the orders' pass first: it sets the members' partial charges, 1.16)
  // leavers: stored bonds from the last orders, the strongest first, as far as both atoms have valence left
  const leave = new Set(C.filter(p => p.bom));
  if (leave.size) {
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
  const Ea = boPass(false) + localPE(set);
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
  const FX = S.fx, FY = S.fy;
  for (let it = 0; it < 60; it++) {
    forcesNoEvents();
    let fm = 0; for (const p of join) { const f = Math.hypot(FX[p.i], FY[p.i]); if (f > fm) fm = f; }
    if (fm < 0.05) break;
    const st = Math.min(0.002, 0.02 / fm);
    for (const p of join) { p.x += FX[p.i] * st; p.y += FY[p.i] * st; }
    gridTouch();
  }
}
/* Whole bonds from the last orders (above 0.5), the strongest first, as far as both atoms have valence left: [a, b, order]
   (for members leaving, and for saving a world) */
function boWhole(only) {
  const qs = []; for (let k = 0; k < BO.np; k++) { const q = BO.pairs[k]; if (q.n > 0.5 && q.a.bom && q.b.bom && !q.a.dead && !q.b.dead && (!only || (only.has(q.a) && only.has(q.b)))) qs.push(q); }
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
function boSet(on) {
  on = !!on; if (on === BO.on) return;
  BO.on = on;
  if (W.parts.length) { boSync(); if (on) BO.any = true; }
}
