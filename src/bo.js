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
   no partial charges (a limit of this first version: no hydrogen bonds between them).
   Membership is by whole clusters (stored bonds for the rest, these orders above 0.3 for members): a cluster joins
   when all its atoms qualify (its stored bonds are let go) and leaves when one stops qualifying (an ion forms, a
   nucleus changes): it gets stored bonds again, whole orders shared out from its last orders. Each change is paid
   for exactly: the energy before and after at the same positions, the difference to the bath (as for quantum
   nuclei's rings). */
// (BO itself is made in engine.js, which runs first and asks it)
const BO_EPS = 0.03, BO_PLOW = 1.1, BO_TA = 0.15, BO_TB = 0.35, BO_SW = 0.5; // (smoothing; Dof's power below a single bond; the taper; the non-bonded switch's width)
const boSp = (x) => x <= -BO_EPS ? 0 : x >= BO_EPS ? x : (x + BO_EPS) * (x + BO_EPS) / (4 * BO_EPS);
const boSpD = (x) => x <= -BO_EPS ? 0 : x >= BO_EPS ? 1 : (x + BO_EPS) / (2 * BO_EPS);
const boH = (d) => d < BO_EPS ? 0.5 * d * (1 - d / BO_EPS) * (1 - d / BO_EPS) : 0;
const boHD = (d) => d < BO_EPS ? 0.5 * (1 - d / BO_EPS) * (1 - d / BO_EPS) - d * (1 - d / BO_EPS) / BO_EPS : 0;
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
    const [rm, eps] = ljPair(a, b), rOn = Math.max(P.reach, 0.62 * rm + 0.05);
    if (eps > 0 && q.r > rOn && q.r < 2.6 * rm) {
      const s6 = Math.pow(rm / q.r, 6), V = eps * (s6 * s6 - 2 * s6 + LJ_VCUT), dV = eps * (-12 * s6 * s6 + 12 * s6) / q.r;
      const t = (q.r - rOn) / BO_SW, sw = t >= 1 ? 1 : t * t * (3 - 2 * t), dsw = t >= 1 ? 0 : 6 * t * (1 - t) / BO_SW;
      E += sw * V; q.eL = sw * V; q.gr += sw * dV + dsw * V;
    }
    if (q.r >= P.reach) continue;
    // raw order and its slope
    const d = q.r - P.r[0]; let n0, dn0;
    if (d > 0) { n0 = Math.exp(-P.beta * d * d); dn0 = -2 * P.beta * d * n0; } else { n0 = Math.exp(-d / P.c); dn0 = -n0 / P.c; }
    if (d > 0.9) { const u = Math.PI * (d - 0.9) / 0.4, f = 0.5 * (1 + Math.cos(u)), fd = -0.5 * Math.sin(u) * Math.PI / 0.4; dn0 = dn0 * f + n0 * fd; n0 *= f; }
    if (n0 >= 3.5) { n0 = 3.5; dn0 = 0; }
    let ne, dne;
    if (n0 >= BO_TB) { ne = n0; dne = 1; } else if (n0 <= BO_TA) { ne = 0; dne = 0; } else { const w = BO_TB - BO_TA, t = (n0 - BO_TA) / w, s = t * t * (3 - 2 * t); ne = n0 * s; dne = s + n0 * 6 * t * (1 - t) / w; }
    q.ne = ne; q.dne = dne * dn0;
    // the soft core
    const s12 = Math.pow(P.sig / q.r, 12); E += 0.05 * s12; q.gr += -0.6 * s12 / q.r;
    let la = by.get(a); if (!la) by.set(a, la = []); la.push(q);
    let lb = by.get(b); if (!lb) by.set(b, lb = []); lb.push(q);
  }
  // caps, levels, orders
  const cap = (p) => { let v = p._boV; if (v === undefined) { p._boV = v = capacity(p); p._boVH = hyperCap(p); } return v; };
  for (const [p, list] of by) {
    let hyp = false;
    for (const q of list) { const o = q.a === p ? q.b : q.a; if (o.el.en >= 3.0) hyp = true; }
    cap(p);
    const V = hyp ? p._boVH : p._boV;
    for (const q of list) { // atom p's view of each partner o: capped by what o can give
      const o = q.a === p ? q.b : q.a; cap(o);
      const C = Math.min(p.el.en >= 3.0 ? o._boVH : o._boV, 3), dd = Math.abs(q.ne - C), h = boH(dd), g = boHD(dd);
      const c = q.ne <= C ? q.ne + h : C + h, dc = q.ne <= C ? 1 - g : g;
      if (q.a === p) { q.ca = c; q.dca = dc; } else { q.cb = c; q.dcb = dc; }
    }
    let lo = -V - 1, hi = 4; for (const q of list) hi = Math.max(hi, (q.a === p ? q.ca : q.cb) + 1);
    for (let it = 0; it < 50; it++) { const mid = 0.5 * (lo + hi); let t = 0; for (const q of list) t += boSp((q.a === p ? q.ca : q.cb) - mid); if (t > V) lo = mid; else hi = mid; }
    p._boLs = 0.5 * (lo + hi); p._boL = boSp(p._boLs); p._boGL = 0;
  }
  for (const [, list] of by) for (const q of list) {
    if (q.done === BO.changes + 0.5) continue; // (each pair once)
    q.done = BO.changes + 0.5;
    const xa = q.ca - q.a._boL, xb = q.cb - q.b._boL, A = boSp(xa), B = boSp(xb), dd = Math.abs(A - B), h = boH(dd), g = boHD(dd);
    q.n = Math.max(0, (A <= B ? A : B) + h); q.dA = (A <= B ? 1 - g : g) * boSpD(xa); q.dB = (A <= B ? g : 1 - g) * boSpD(xb);
    // the pair's Morse curve of its order
    const N = q.n, P = q.P;
    if (N > 1e-6) {
      let D, dD; if (N < 1) { D = P.D[0] * Math.pow(N, BO_PLOW); dD = P.D[0] * BO_PLOW * Math.pow(N, BO_PLOW - 1); } else { const i = Math.min(1, Math.floor(N - 1)), f = N - 1 - i; if (f >= 1) { D = P.D[i + 1]; dD = 0; } else { D = P.D[i] + (P.D[i + 1] - P.D[i]) * f; dD = P.D[i + 1] - P.D[i]; } }
      const r0 = N > 0.05 ? P.r[0] - P.c * Math.log(N) : P.r[0] - P.c * Math.log(0.05), dr0 = N > 0.05 ? -P.c / N : 0;
      let al, dal; if (N <= 1) { al = P.al[0]; dal = 0; } else if (N >= 3) { al = P.al[2]; dal = 0; } else { const f = Math.floor(N), s = P.al[Math.ceil(N) - 1] - P.al[f - 1]; al = P.al[f - 1] + s * (N - f); dal = f === Math.ceil(N) ? 0 : s; }
      const x = q.r - r0, ex = Math.exp(-al * x), e = 1 - ex, d = q.r - P.r[0];
      let fc = 1, dfc = 0; if (d > 0.9) { const u = Math.PI * (d - 0.9) / 0.4; fc = 0.5 * (1 + Math.cos(u)); dfc = -0.5 * Math.sin(u) * Math.PI / 0.4; }
      const M = D * (e * e - 1), dMdr = D * 2 * e * ex * al;
      E += fc * M; q.eM = fc * M; q.gr += fc * dMdr + dfc * M;
      if (forces) { const w = 2 * D * al * al * fc * (S.im[q.a.i] + S.im[q.b.i]); if (w > _stiff) _stiff = w; } // (the bond's stiffness sets the longest step, as a stored bond's does)
      q.gn += fc * ((e * e - 1) * dD - dMdr * dr0 + D * 2 * e * ex * x * dal);
    }
  }
  BO.changes++;
  // angles: the game's VSEPR terms on partners with n > 0.4, the weakest blended in from 0.4 to 0.7, lone pairs
  // blended between whole numbers
  for (const [c, list] of by) {
    if (c.el.dblock) continue;
    const nb = []; for (const q of list) if (q.n > 0.4) nb.push(q);
    if (nb.length < 2) continue;
    let wk = 0; for (let k = 1; k < nb.length; k++) if (nb[k].n < nb[wk].n) wk = k;
    const x = (nb[wk].n - 0.4) / 0.3, sw = x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x), dsw = x <= 0 || x >= 1 ? 0 : 6 * x * (1 - x) / 0.3;
    const rest = nb.filter((_, k) => k !== wk);
    const [eA, dA] = boAngles(c, nb, sw, forces), [eB, dB] = sw < 1 ? boAngles(c, rest, 1 - sw, forces) : [0, 0];
    E += sw * eA + (1 - sw) * eB;
    for (const q of nb) q.gn += sw * dA;
    for (const q of rest) q.gn += (1 - sw) * dB;
    nb[wk].gn += (eA - eB) * dsw;
  }
  BO.E = E;
  if (!forces) { for (const [p] of by) { p._boV = undefined; } return E; }
  // back through the orders to the distances
  for (let k = 0; k < n; k++) {
    const q = L[k]; if (!(q.n > 0) || !q.gn) continue;
    const ga = q.gn * q.dA, gb = q.gn * q.dB;
    q.gca += ga; q.a._boGL -= ga; q.gcb += gb; q.b._boGL -= gb;
  }
  for (const [p, list] of by) {
    if (p._boGL) {
      const gs = p._boGL * boSpD(p._boLs); let Wt = 0;
      for (const q of list) Wt += boSpD((q.a === p ? q.ca : q.cb) - p._boLs);
      if (Wt > 0) for (const q of list) { const w = boSpD((q.a === p ? q.ca : q.cb) - p._boLs) * gs / Wt; if (q.a === p) q.gca += w; else q.gcb += w; }
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
    const tg = angleTargetsRaw(n, lp, per, allH).slice().sort((u, v) => u - v); let t = 0;
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
/* The bond orders of the last pass, for drawing: [a, b, order] */
function boBonds() { const out = []; for (let k = 0; k < BO.np; k++) { const q = BO.pairs[k]; if (q.n > 0.15 && !q.a.dead && !q.b.dead && q.a.bom && q.b.bom) out.push([q.a, q.b, q.n]); } return out; }
/* At the start of a step (and when the setting changes): who is a member now, by whole clusters; joiners let go of
   their stored bonds, leavers get stored bonds from their last orders; the energy before and after, at the same
   positions, the difference to the bath. Returns whether anything changed (the forces are then worked out again). */
function boSync() {
  if (!BO.on && !BO.any) return false;
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
  if (!C.length) { BO.any = BO.on && parts.some(p => p.bom); return false; }
  const set = new Set(C);
  for (const p of C) for (const bd of p.bonds) set.add(other(bd, p));
  const Eb = localPE(set) + boPass(false);
  // leavers: stored bonds from the last orders, the strongest first, as far as both atoms have valence left
  const leave = new Set(C.filter(p => p.bom));
  if (leave.size) {
    const qs = []; for (let k = 0; k < BO.np; k++) { const q = BO.pairs[k]; if (q.n > 0.5 && leave.has(q.a) && leave.has(q.b)) qs.push(q); }
    qs.sort((u, v) => v.n - u.n);
    for (const p of leave) p.bom = false;
    const used = new Map(), freeV = (p) => capacity(p) - (used.get(p) || 0);
    for (const q of qs) {
      if (q.a.dead || q.b.dead || bondBetween(q.a, q.b)) continue;
      const o = Math.min(3, Math.max(1, Math.round(q.n)), freeV(q.a), freeV(q.b));
      if (o < 1) continue;
      addBond(q.a, q.b, o); used.set(q.a, (used.get(q.a) || 0) + o); used.set(q.b, (used.get(q.b) || 0) + o);
    }
    relink([...leave]);
  }
  // joiners: their stored bonds let go
  const join = C.filter(p => !leave.has(p));
  for (const p of join) p.bom = true;
  for (const p of join) for (const bd of p.bonds.slice()) removeBond(bd);
  W.dirty++; W.topo++; vlInvalidate();
  const Ea = localPE(set) + boPass(false);
  W.ledger.bath += Eb - Ea; BO.bath += Eb - Ea;
  BO.any = BO.on && parts.some(p => p.bom && !p.dead);
  return true;
}
/* The setting: on or off. Turning it off gives every member stored bonds again (boSync). */
function boSet(on) {
  on = !!on; if (on === BO.on) return;
  BO.on = on;
  if (W.parts.length) { boSync(); if (on) BO.any = true; }
}
