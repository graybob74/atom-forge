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
  return p.k === NUC && !p.dead && !p.fast && !p.rad && !p.anti && p.Z > 0 && BO.Ztab.has(p.Z) && p.ne > 0 && Math.abs(p.q) <= 1 && !p.exo && !p.mu; // (singly charged ions too, since 1.16: H₃O⁺, OH⁻, NH₄⁺)
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
function boPassObj(forces) { // (the 1.13–1.16 pass on objects, kept for checking boPass against: tests)
  const n = boCollect(forces), L = BO.pairs; BO.flat = false;
  const by = new Map(); // atom → its bond-term pairs
  let E = 0;
  // non-bonded (switched), raw orders, the taper
  for (let k = 0; k < n; k++) {
    const q = L[k], P = q.P, a = q.a, b = q.b;
    q.gr = 0; q.gn = 0; q.gca = 0; q.gcb = 0; q.n = 0; q.ne = 0; q.ne0 = 0; q.sup = null; q.eL = 0; q.eM = 0;
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
    q.ne = ne; q.dne = dne * dn0; q.ne0 = ne; q.dne0 = q.dne; q.sup = null;
    // the soft core
    const z2 = P.sig * P.sig / (q.r * q.r), z6 = z2 * z2 * z2, s12 = z6 * z6; E += 0.05 * s12; q.gr += -0.6 * s12 / q.r;
    let la = by.get(a); if (!la) by.set(a, la = []); la.push(q);
    let lb = by.get(b); if (!lb) by.set(b, lb = []); lb.push(q);
  }
  boCrowd(n, L);
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
      if (forces) { const w = 4 * D * al * al * fc * (S.im[q.a.i] + S.im[q.b.i]); if (w > _stiff) _stiff = w; } // (the bond's stiffness sets the longest step, as a stored bond's does: twice its curvature at rest, for the sharper turns of the orders themselves; at the plain curvature a hot gallery drifted 1–3 eV in 60 fs (1.13), 25 eV in 300 fs (1.16); at twice, 0.03–0.05 eV in 200–230 fs (gallery 1,000 K, water 600 K, combustion 2,500 K); at four times (1.13–1.15) 0.01–0.10, with steps 1.41 times shorter)
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
    if (!(q.r < q.P.reach)) continue;
    const G = q.gca * q.dca + q.gcb * q.dcb; // (∂E/∂ne)
    q.gr += G * q.dne;
    if (q.sup && G) for (let t = 0; t < q.sup.length; t += 3) { // (through the crowding factors: boCrowd)
      const q1 = q.sup[t], q2 = q.sup[t + 1], sg = q.sup[t + 2], b1 = boB(q1.ne0), b2 = boB(q2.ne0), w = b1 * b2 * sg;
      let o = 1; for (let u = 0; u < q.sup.length; u += 3) if (u !== t) o *= 1 - boB(q.sup[u].ne0) * boB(q.sup[u + 1].ne0) * q.sup[u + 2];
      const dEw = -G * q.ne0 * o; // (∂E/∂w: ne = ne0·Π(1 − w))
      if (w >= 0) { q1.gr += dEw * boBD(q1.ne0) * b2 * sg * q1.dne0; q2.gr += dEw * b1 * boBD(q2.ne0) * sg * q2.dne0; }
    }
  }
  for (let k = 0; k < n; k++) {
    const q = L[k];
    if (!q.gr) continue;
    const fx = q.gr * q.ux, fy = q.gr * q.uy, i = q.a.i, j = q.b.i;
    FX[j] -= fx; FY[j] -= fy; FX[i] += fx; FY[i] += fy;
  }
  return E;
}
/* Crowded flat molecules (1.16). Two atoms bonded to one centre much more strongly than to each other don't bond to each
   other, as a stored molecule's 1-3 pairs don't: in a flat world SF₆'s six fluorines sit 60° apart, as far from each other
   as from the sulfur, near an F–F bond's length, and each F split its one valence three ways (S–F 0.5, F–F 0.2–0.34; PCl₅'s
   chlorines 0.4 to each other). A pair i–j's raw order is multiplied by Πₖ(1 − b(n⁰ᵢₖ)·b(n⁰ₖⱼ)·σ), over the centres k it
   shares, σ rising from 0 to 1 as the weaker bond to the centre beats the i–j bond by 0.4 to 0.8 eV (single bonds'
   energies): S–F against F–F 1.8 eV (out), P–Cl against Cl–Cl 0.9, a ring of equals (cyclopropane, epoxides) 0–0.1 (kept);
   diborane's B–B goes, as in the real molecule (its bridging hydrogens hold it). Raw orders only, so no circle. */
function boCrowd(n, L) {
  const adj = new Map();
  for (let k = 0; k < n; k++) { const q = L[k]; if (!(q.r < q.P.reach) || !(q.ne0 > 0.3)) continue; let m = adj.get(q.a); if (!m) adj.set(q.a, m = new Map()); m.set(q.b, q); m = adj.get(q.b); if (!m) adj.set(q.b, m = new Map()); m.set(q.a, q); }
  for (let k = 0; k < n; k++) {
    const q = L[k]; if (!(q.r < q.P.reach) || !(q.ne0 > 0)) continue;
    const ma = adj.get(q.a), mb = adj.get(q.b); if (!ma || !mb) continue;
    let P = 1, sup = null;
    for (const [c, q1] of ma) {
      const q2 = mb.get(c); if (!q2) continue;
      const d = Math.min(q1.P.D[0], q2.P.D[0]) - q.P.D[0]; if (d <= 0.4) continue;
      const t = Math.min(1, (d - 0.4) / 0.4), sg = t * t * (3 - 2 * t), w = boB(q1.ne0) * boB(q2.ne0) * sg; if (w <= 0) continue;
      P *= 1 - w; (sup || (sup = [])).push(q1, q2, sg);
    }
    if (sup) { q.sup = sup; q.ne = q.ne0 * P; q.dne = q.dne0 * P; }
  }
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
  const c0 = 1 / Math.sqrt(RC2 + 0.09);
  for (let k = 0; k < n; k++) {
    const q = L[k], a = q.a, b = q.b, qa = a.q + a._boQ, qb = b.q + b._boQ; // (net charges too: ions are members since 1.16)
    if (!qa && !qb) continue;
    const b0 = boB(q.n); if (b0 >= 1) continue;
    let prod = 1, terms = null;
    const ma = q.r < 4.4 ? adj.get(a) : null, mb = ma ? adj.get(b) : null;
    if (ma && mb) for (const [c, q1] of ma) { const q2 = mb.get(c); if (!q2) continue; const w = boB(q1.n) * boB(q2.n); if (w <= 0) continue; prod *= 1 - w; (terms || (terms = [])).push(q1, q2, w); } // (q.r < 4.4: a 1-3 pair with both orders above 0.3 is never farther apart)
    const s = (1 - b0) * prod; if (!(s > 0)) continue;
    const K = a.ionic === b.ionic ? PHYS.KE : PHYS.KE * iwK(a, b), r2 = q.r * q.r, sq = Math.sqrt(r2 + 0.09), c = K * (1 / sq - (a.q === 0 || b.q === 0 ? c0 : csh(a, b, 0.09))); // (iwK and csh, the common case written out)
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
  if (forces && _lrOn) for (const m of mem) { // (an ion member's partial charge meets the net charges beyond the cutoff too: computeForces' long-range pairs)
    if (!isLR(m)) continue;
    for (const o of _charged) { if (o === m || o.dead || !isLR(o)) continue; const dx = o.x - m.x, dy = o.y - m.y, r2 = dx * dx + dy * dy; if (r2 >= RC2) m._boPhi += PHYS.KE * qx(o, m) / Math.sqrt(r2); }
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
/* ---- the orders' pass on flat arrays (1.17): the same physics as boPassObj, written over typed arrays (pairs and members
   by index, the pair constants in a table) so that it runs without allocating and can move to WebAssembly as it is. */
const BF = { useWasm: true, np: 0, nm: 0, pcapN: 0, mcapN: 0, ns: 0, scap: 0, PT: new Float64Array(16 * 64), nt: 0, mem: [], inc: new Int32Array(256) };
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
  }
  return P.t;
}
const BF_PF = ['r', 'ux', 'uy', 'gr', 'gn', 'gca', 'gcb', 'n', 'ne', 'ne0', 'dne', 'dne0', 'ca', 'cb', 'dca', 'dcb', 'sA', 'tA', 'sB', 'tB', 'qc', 'qdh', 'K', 'csh'];
const BF_PI = ['a', 'b', 't', 'ss', 'sn'];
const BF_MF = ['en', 'cap', 'capH', 'val', 'ls', 'lv', 'gl', 'keep', 'q', 'phi', 'qn', 'im'];
const BF_MI = ['slot', 'per', 'db', 'Z', 'f0', 'fc', 'fl'];
const bfArr = (T, n) => WK.on ? wasmArray(T, n) : new T(n); // (in the module's memory when there is one: the Rust pass reads them, 1.18)
function bfGrow(np, nm) {
  if (np > BF.pcapN) { const c = Math.max(np * 2, 256); for (const k of BF_PF) BF['p' + k] = bfArr(Float64Array, c); for (const k of BF_PI) BF['p' + k] = bfArr(Int32Array, c); BF.pcapN = c; }
  if (nm > BF.mcapN) { const c = Math.max(nm * 2, 64); for (const k of BF_MF) BF['m' + k] = bfArr(Float64Array, c); for (const k of BF_MI) BF['m' + k] = bfArr(Int32Array, c); BF.inc = bfArr(Int32Array, 2 * Math.max(np * 2, 256) + 2 * c); BF.mcapN = c; }
  if (BF.inc.length < 2 * np) BF.inc = bfArr(Int32Array, 4 * np);
}
/* members by index, and the pairs within the cutoff: from the neighbour list in a force pass, from the grid otherwise */
let BF_SM = new Int32Array(256), BF_TZ = new Int32Array(128 * 128).fill(-1); // (slot → member index + 1; element pair → pair type)
function bfMembers() {
  const mem = BF.mem;
  for (const p of mem) if (p.i < BF_SM.length) BF_SM[p.i] = 0; // (the last pass's members off the map)
  mem.length = 0;
  if (BF_SM.length < S.size) BF_SM = bfArr(Int32Array, S.size * 2);
  for (const p of W.parts) if (p.bom && !p.dead) { p._bm = mem.length; BF_SM[p.i] = mem.length + 1; mem.push(p); }
  const nm = mem.length; bfGrow(Math.max(BF.pcapN, 64), nm);
  for (let m = 0; m < nm; m++) {
    const p = mem[m]; BF.mslot[m] = p.i; BF.men[m] = p.el.en || 2.6; BF.mval[m] = p.val; BF.mper[m] = periodOf(p.el.Z); BF.mdb[m] = p.el.dblock ? 1 : 0; BF.mZ[m] = p.Z;
    BF.mls[m] = p._boLs === undefined ? NaN : p._boLs; BF.mqn[m] = p.q; BF.mim[m] = S.im[p.i];
    BF.mcap[m] = capacity(p); BF.mcapH[m] = hyperCap(p); BF.mfl[m] = _lrOn && isLR(p) ? 1 : 0;
  }
  BF.nm = nm;
  return nm;
}
function bfCollect(useVL) { bfMembers(); return bfPairsJS(useVL); }
function bfPairsJS(useVL) {
  const mem = BF.mem, ION = S.ionic;
  let n = 0;
  const X = S.x, Y = S.y, OBJ = S.obj, Zs = S.Z, Q = S.q, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2, c0 = 1 / Math.sqrt(RC2 + 0.09), KE = PHYS.KE, SM = BF_SM, TZ = BF_TZ;
  const put = (i, j, ma, mb, dx, dy, r2) => {
    if (n >= BF.pcapN) { const keep = {}; for (const k of BF_PF.concat(BF_PI)) keep[k] = BF['p' + k]; BF.pcapN = 0; bfGrow(n + 1, 0); for (const k of BF_PF.concat(BF_PI)) BF['p' + k].set(keep[k].subarray(0, n)); }
    const r = Math.sqrt(r2), za = Zs[i], zb = Zs[j], key = za < zb ? za * 128 + zb : zb * 128 + za;
    let t = TZ[key]; if (t < 0) t = TZ[key] = bfType(OBJ[i], OBJ[j]);
    BF.pa[n] = ma; BF.pb[n] = mb; BF.pr[n] = r; BF.pux[n] = dx / r; BF.puy[n] = dy / r; BF.pt[n] = t;
    BF.pK[n] = ION[i] === ION[j] ? KE : KE * iwK(OBJ[i], OBJ[j]); BF.pcsh[n] = Q[i] === 0 || Q[j] === 0 ? c0 : csh(OBJ[i], OBJ[j], 0.09);
    n++;
  };
  if (useVL) {
    const pi = VL.pi, pj = VL.pj;
    for (let k = 0, np = VL.np; k < np; k++) {
      const i = pi[k], j = pj[k], ma = SM[i] - 1, mb = SM[j] - 1;
      if (ma < 0 || mb < 0) continue;
      let dx = X[j] - X[i], dy = Y[j] - Y[i];
      if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
      const r2 = dx * dx + dy * dy;
      if (r2 < RC2 && r2 >= 1e-12) put(i, j, ma, mb, dx, dy, r2);
    }
  } else for (const a of mem) nearby(a.x, a.y, RC, (b, dx, dy, r2) => { if (b.bom && !b.dead && b !== a && b.id > a.id && r2 < RC2 && r2 >= 1e-12) put(a.i, b.i, a._bm, b._bm, dx, dy, r2); });
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
function boPass(forces) { return BF.useWasm && bfWasmOK() ? bfPassWasm(forces) : boPassJS(forces); }
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
    const rm = PT[t + 11], eps = PT[t + 12], rOn = PT[t + 13];
    if (eps > 0 && r > rOn && r < PT[t + 14]) {
      const s2 = rm * rm / (r * r), s6 = s2 * s2 * s2, V = eps * (s6 * s6 - 2 * s6 + LJ_VCUT), dV = eps * (-12 * s6 * s6 + 12 * s6) / r;
      const u = (r - rOn) / BO_SW, sw = u >= 1 ? 1 : u * u * (3 - 2 * u), dsw = u >= 1 ? 0 : 6 * u * (1 - u) / BO_SW;
      E += sw * V; gr[k] += sw * dV + dsw * V;
    }
    if (r >= PT[t + 4]) continue;
    const r1 = PT[t], c = PT[t + 1], beta = PT[t + 2], d = r - r1; let n0, dn0;
    if (d > 0) { n0 = Math.exp(-beta * d * d); dn0 = -2 * beta * d * n0; } else { const w2 = BO_WIN * BO_WIN, h = d * d / (d * d + w2), hd = 2 * d * w2 / ((d * d + w2) * (d * d + w2)); n0 = Math.exp(-d * h / c); dn0 = -n0 * (h + d * hd) / c; }
    if (d > 0.9) { const u = Math.PI * (d - 0.9) / 0.4, f = 0.5 * (1 + Math.cos(u)), fd = -0.5 * Math.sin(u) * Math.PI / 0.4; dn0 = dn0 * f + n0 * fd; n0 *= f; }
    if (n0 >= 3.5) { n0 = 3.5; dn0 = 0; }
    let ne, dne;
    if (n0 >= BO_TB) { ne = n0; dne = 1; } else if (n0 <= BO_TA) { ne = 0; dne = 0; } else { const w = BO_TB - BO_TA, u = (n0 - BO_TA) / w, s = u * u * (3 - 2 * u); ne = n0 * s; dne = s + n0 * 6 * u * (1 - u) / w; }
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
  E += bfCoulomb(forces, n);
  BO.E = E; BO.np = n; BO.flat = true;
  for (let m = 0; m < nm; m++) if (fc[m]) BF.mem[m]._boLs = mls[m];
  if (!forces) return E;
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
    gr[k] += G * dne_[k];
    const s0 = pss[k], ns = psn[k];
    if (ns && G) for (let t = 0; t < ns; t++) {
      const k1 = BF_SUP1[s0 + t], k2 = BF_SUP2[s0 + t], sg = BF_SUPS[s0 + t], b1 = boB(ne0_[k1]), b2 = boB(ne0_[k2]), w = b1 * b2 * sg;
      let o = 1; for (let u = 0; u < ns; u++) if (u !== t) o *= 1 - boB(ne0_[BF_SUP1[s0 + u]]) * boB(ne0_[BF_SUP2[s0 + u]]) * BF_SUPS[s0 + u];
      const dEw = -G * ne0_[k] * o;
      if (w >= 0) { gr[k1] += dEw * boBD(ne0_[k1]) * b2 * sg * dne0_[k1]; gr[k2] += dEw * b1 * boBD(ne0_[k2]) * sg * dne0_[k2]; }
    }
  }
  const FX = S.fx, FY = S.fy, slot = BF.mslot, ux = BF.pux, uy = BF.puy;
  for (let k = 0; k < n; k++) {
    const g = gr[k]; if (!g) continue;
    const fx = g * ux[k], fy = g * uy[k], i = slot[pa[k]], j = slot[pb[k]];
    FX[j] -= fx; FY[j] -= fy; FX[i] += fx; FY[i] += fy;
  }
  return E;
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
function bfAnglesAll(forces) {
  const nm = BF.nm, f0 = BF.mf0, fc = BF.mfc, inc = BF.inc, pn = BF.pn, gn = BF.pgn, A = BFA;
  let E = 0;
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
      const e = bfAngle(c, A.list, nl, wt, forces), dS = _adS;
      E += wt * e;
      if (dS) for (let u = 0; u < nl; u++) gn[A.list[u]] += wt * dS;
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
function bfCoulomb(forces, n) {
  const nm = BF.nm, QP = S.qp, mq = BF.mq, phi = BF.mphi, mqn = BF.mqn, men = BF.men, pa = BF.pa, pb = BF.pb, pn = BF.pn, pr = BF.pr, qc_ = BF.pqc, qdh_ = BF.pqdh, gr = BF.pgr, gn = BF.pgn, K_ = BF.pK, csh_ = BF.pcsh;
  for (let m = 0; m < nm; m++) { mq[m] = 0; phi[m] = 0; }
  for (let k = 0; k < n; k++) {
    if (!(pn[k] > 0)) continue;
    const ea = men[pa[k]], eb = men[pb[k]]; if (ea === eb) continue;
    bfQh(pn[k]); const qc = qc_[k] = PARTIAL_K * (eb - ea); qdh_[k] = _bfs;
    mq[pa[k]] += qc * _bfv; mq[pb[k]] -= qc * _bfv;
  }
  for (let m = 0; m < nm; m++) { const p = BF.mem[m]; QP[p.i] = mq[m]; p.qpol = mq[m]; p.qf = 0; p.qi = 0; }
  const f0 = BF.mf0, fc = BF.mfc, inc = BF.inc;
  let E = 0;
  for (let k = 0; k < n; k++) {
    const a = pa[k], b = pb[k], qa = mqn[a] + mq[a], qb = mqn[b] + mq[b];
    if (!qa && !qb) continue;
    const b0 = boB(pn[k]); if (b0 >= 1) continue;
    let prod = 1, nt = 0;
    if (pr[k] < 4.4) bfCommon(a, b, inc, f0, fc, (j) => pn[j] > 0.3, (k1, k2) => {
      const w = boB(pn[k1]) * boB(pn[k2]); if (w <= 0) return;
      prod *= 1 - w; if (nt >= BF_T1.length) { const g = (x, T) => { const y = new T(x.length * 2); y.set(x); return y; }; BF_T1 = g(BF_T1, Int32Array); BF_T2 = g(BF_T2, Int32Array); BF_TW = g(BF_TW, Float64Array); } BF_T1[nt] = k1; BF_T2[nt] = k2; BF_TW[nt] = w; nt++;
    });
    const s = (1 - b0) * prod; if (!(s > 0)) continue;
    const K = K_[k], r = pr[k], sq = Math.sqrt(r * r + 0.09), c = K * (1 / sq - csh_[k]);
    E += s * c * qa * qb;
    if (!forces) continue;
    gr[k] += -s * K * r / (sq * sq * sq) * qa * qb;
    phi[a] += s * c * qb; phi[b] += s * c * qa;
    const Es = c * qa * qb;
    if (!Es) continue;
    if (b0 > 0) gn[k] -= Es * boBD(pn[k]) * prod;
    for (let t = 0; t < nt; t++) {
      const k1 = BF_T1[t], k2 = BF_T2[t], w = BF_TW[t], dsw = -(1 - b0) * prod / (1 - w);
      gn[k1] += Es * dsw * boBD(pn[k1]) * boB(pn[k2]); gn[k2] += Es * dsw * boB(pn[k1]) * boBD(pn[k2]);
    }
  }
  if (forces) bfPhiOthers();
  return E;
}
/* the potential at each member from the non-members it meets (the kernel's pairs: same coefficients, qeqC) and, for
   an ion member, from the net charges beyond the cutoff */
function bfPhiOthers() {
  const phi = BF.mphi, QP = S.qp;
  let others = false; for (const p of W.parts) if (!p.bom && !p.dead && p.k === NUC && p.Z > 0) { others = true; break; }
  if (others) {
    const pi = VL.pi, pj = VL.pj, ex = VL.ex, OBJ = S.obj, X = S.x, Y = S.y, Q = S.q, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2;
    for (let k = 0; k < VL.np; k++) {
      if (ex[k]) continue;
      const i = pi[k], j = pj[k], a = OBJ[i], b = OBJ[j];
      if (!a || !b || a.bom === b.bom || a.k !== NUC || b.k !== NUC || !a.Z || !b.Z || a.dead || b.dead || a.fast || b.fast || a.rad || b.rad) continue;
      let dx = X[j] - X[i], dy = Y[j] - Y[i];
      if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
      const r2 = dx * dx + dy * dy; if (r2 >= RC2) continue;
      const m = a.bom ? a : b, o = m === a ? b : a, qo = Q[o.i] + QP[o.i]; if (!qo) continue;
      phi[m._bm] += qeqC(m, o, r2) * qo;
    }
  }
  if (_lrOn) for (const m of BF.mem) { // (an ion member's partial charge meets the net charges beyond the cutoff too)
    if (!isLR(m)) continue;
    for (const o of _charged) { if (o === m || o.dead || !isLR(o)) continue; const dx = o.x - m.x, dy = o.y - m.y, r2 = dx * dx + dy * dy; if (r2 >= RC2) phi[m._bm] += PHYS.KE * qx(o, m) / Math.sqrt(r2); }
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
    BFW.desc = wasmArray(Int32Array, 80); BFW.par = wasmArray(Float64Array, 16);
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
  P[0] = n; P[1] = nm; P[2] = forces ? 1 : 0; P[8] = _stiff; P[12] = BF_SUP1.length;
  let E = ex.af_bo_pass1(BFW.desc.byteOffset, P.byteOffset);
  if (P[10] === 1) { bfSupRoom(P[14]); bfDescFill(); P[12] = BF_SUP1.length; P[8] = _stiff; E = ex.af_bo_pass1(BFW.desc.byteOffset, P.byteOffset); }
  _stiff = P[8]; BFW.calls = (BFW.calls || 0) + 1;
  BO.changes++;
  const QP = S.qp, mq = BF.mq, mem = BF.mem, fc = BF.mfc, mls = BF.mls;
  for (let m = 0; m < nm; m++) { const p = mem[m]; QP[p.i] = mq[m]; p.qpol = mq[m]; p.qf = 0; p.qi = 0; if (fc[m]) p._boLs = mls[m]; }
  BO.E = E; BO.np = n; BO.flat = true;
  if (!forces) return E;
  bfPhiOthers();
  ex.af_bo_pass2(BFW.desc.byteOffset, P.byteOffset);
  return E;
}
/* the last pass's pair k as { a, b, n, r } (for the readers below) */
const boPairQ = (k) => BO.flat === false ? BO.pairs[k] : { a: BF.mem[BF.pa[k]], b: BF.mem[BF.pb[k]], n: BF.pn[k], r: BF.pr[k] };
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
function boSync() {
  if (!BO.on && !BO.any) return false;
  // (nothing that decides membership has changed: species, charges, stored bonds, particles made or lost, flags; and a
  // full look every 64 steps anyway)
  const sig = W.topo + ',' + W.dirty + ',' + W.spawned + ',' + W.deaths + ',' + _flagGen + ',' + BO.on;
  if (sig === BO.sig && (W.step & 63)) return false;
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
    const ok = BO.on && cl.every(boOK) && (cl.length > 1 || cl[0].q === 0); // (a lone ion, Cl⁻ in brine, stays with the kernel's ion–water terms)
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
function boSet(on) {
  on = !!on; if (on === BO.on) return;
  BO.on = on;
  if (W.parts.length) { boSync(); if (on) BO.any = true; }
}
