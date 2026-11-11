/* ---- Experimental: electrons as full waves (1.32 item 76) ----------------------------------------------------------
   Settings → Experimental → Realistic particles → Electrons as waves → "Full waves" (the flat game only). Up to FW.max
   free electrons and positrons each carry their own wave function ψ on a 128 × 128 grid, 0.2 Å a cell (25.6 Å across),
   centred on the packet and moved with it (shifted by whole cells, nothing lost). Each step ψ goes forward by the
   split-operator method (Strang: half the potential's phase, the kinetic phase in momentum space through a 2-D FFT,
   the other half), in the field of everything charged and of every atom near: an atom's potential is its nucleus
   screened by its own electrons (Thomas–Fermi length 0.885 a₀ Z^(−1/3)) plus its net charge, flat inside its core
   (FW.rc = 0.5 Å). The atoms feel the wave back (−∫|ψ|² ∇V), so momentum and energy go both ways. The waves do not feel
   each other (no entanglement, no Hartree field): the cost grows with their number, not exponentially.
   Encounters follow the wave: the part of |ψ|² inside an atom's (or an opposite free lepton's) core is the chance, per
   0.05 tu there, that the electron is found there (a measurement): it becomes a point electron just outside that core,
   heading in, with the wave's energy, and the engine's own events decide what it does (capture, scattering,
   annihilation). A wave that reaches a wall, spreads wider than its grid or picks up more momentum than the grid holds
   is measured the same way, at a place drawn from |ψ|², moving along the wave's current there. A point electron becomes
   a wave once it is clear of atoms (1.2 Å), moving with 0.15–300 eV, and its energy pays for the packet (σ 1.2, 2 or
   3 Å: 1.3, 0.48 or 0.21 eV of spread): a thermal electron (0.04 eV) stays a point.
   Energy: the wave's energy is ⟨T⟩ + ⟨V⟩ (normalized), measured on the grid (⟨T⟩ in momentum space) and counted in
   totalEnergy(); a point becomes a wave and a wave a point at exactly the energy measured (totalEnergy() with and
   without it), any remainder kept with the wave (w.dE, a few µeV from the grid). What an event changes in a wave's
   potential between steps (an ion caught an electron next to it) is kept with the wave too (w.dE) and handed on when it
   becomes a point. Saved worlds keep each wave as a point electron at its mean place and velocity. */
const FW = { ends: null, on: false, list: [], n: 0, N: 128, h: 0.2, max: 6, rc: 0.8, tauCap: 0.05, phase: 0.5, kick: 0.25, keMin: 0.15, subMax: 64, kin: new Map(), band: 6, kmax: 0.7, sig: '', T: null, kx: null, ky: null, fft: null, cool: new Map(), made: 0, meas: 0, ms: 0, why: {} };
const FW_HB = () => 6.582119569e-16 / PHYS.TU_S; // ħ in eV·tu (= u·Å²/tu)
function fwMkFFT(n) {
  const lg = Math.round(Math.log2(n)), rev = new Uint16Array(n), cs = new Float64Array(n / 2), sn = new Float64Array(n / 2);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < lg; b++) r |= ((i >> b) & 1) << (lg - 1 - b); rev[i] = r; }
  for (let i = 0; i < n / 2; i++) { cs[i] = Math.cos(2 * Math.PI * i / n); sn[i] = -Math.sin(2 * Math.PI * i / n); }
  const tr = new Float64Array(n), ti = new Float64Array(n);
  return function (re, im, off, str, inv) { // in place on the n values at off + k·str (inv: the other sign, unscaled)
    for (let i = 0; i < n; i++) { const a = off + rev[i] * str; tr[i] = re[a]; ti[i] = im[a]; }
    for (let s = 2; s <= n; s <<= 1) {
      const h = s >> 1, st = n / s;
      for (let i = 0; i < n; i += s) for (let k = 0; k < h; k++) {
        const c = cs[k * st], d = inv ? -sn[k * st] : sn[k * st], a = i + k, b = a + h;
        const xr = tr[b] * c - ti[b] * d, xi = tr[b] * d + ti[b] * c;
        tr[b] = tr[a] - xr; ti[b] = ti[a] - xi; tr[a] += xr; ti[a] += xi;
      }
    }
    for (let i = 0; i < n; i++) { const a = off + i * str; re[a] = tr[i]; im[a] = ti[i]; }
  };
}
function fwFFT2(re, im, inv) {
  const N = FW.N, f = FW.fft || (FW.fft = fwMkFFT(N));
  for (let r = 0; r < N; r++) f(re, im, r * N, 1, inv);
  for (let c = 0; c < N; c++) f(re, im, c, N, inv);
  if (inv) { const s = 1 / (N * N); for (let i = 0; i < N * N; i++) { re[i] *= s; im[i] *= s; } }
}
function fwKTables(m) {
  if (FW.T) return;
  const N = FW.N, h = FW.h, dk = 2 * Math.PI / (N * h), hb = FW_HB();
  FW.kx = new Float64Array(N * N); FW.ky = new Float64Array(N * N); FW.T = new Float64Array(N * N);
  for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
    const kx = (ix < N / 2 ? ix : ix - N) * dk, ky = (iy < N / 2 ? iy : iy - N) * dk, i = iy * N + ix;
    FW.kx[i] = kx; FW.ky[i] = ky; FW.T[i] = hb * hb * (kx * kx + ky * ky) / (2 * m);
  }
}
/* What is felt by the waves: everything in MD with a charge, and the atoms (their screened nuclei). */
function fwSources() {
  const out = [];
  for (const A of W.parts) {
    if (A.dead || A.rad || A.fast) continue;
    if (A.k === NUC) { if (A.Z > 0) out.push(A); }
    else if (A.q) out.push(A);
  }
  return out;
}
/* One source's potential for a positive test charge at distance r (eV), and its slope (eV/Å); flat inside the core. */
function fwPhi(A, r, d) {
  const rc = FW.rc, R = Math.sqrt(r * r + rc * rc), K = PHYS.KE; // (softened smoothly over the core: R ≥ rc)
  let qa = A.q, sc = 0, a = 1;
  if (A.k === NUC) { const Zc = A.anti ? -A.Z : A.Z; sc = Zc - qa; a = 0.8853 * 0.529177 / Math.cbrt(A.Z); }
  const e = sc ? Math.exp(-R / a) : 0, Q = qa + sc * e;
  if (d) d[0] = K * (-sc * e / (a * R) - Q / (R * R)) * r / R; // (dΦ/dr)
  return K * Q / R;
}
/* Where A is seen from the wave's grid: with wrapping walls, its image nearest the grid's middle. */
const _fwA = [0, 0];
function fwAt(w, A) {
  let ax = A.x, ay = A.y;
  if (W.wall === 'wrap') { const c = (FW.N - 1) / 2 * FW.h, bw = W.box.w, bh = W.box.h; ax += Math.round((w.x0 + c - ax) / bw) * bw; ay += Math.round((w.y0 + c - ay) / bh) * bh; }
  _fwA[0] = ax; _fwA[1] = ay; return _fwA;
}
function fwReach(A) { return A.k === NUC && A.q === 0 ? 4.5 : Infinity; } // (a neutral atom's screened field is under a µeV past 4.5 Å)
function fwBuildV(w, out, src) {
  const N = FW.N, h = FW.h, x0 = w.x0, y0 = w.y0, qw = w.q;
  out.fill(0);
  if (W.Ex || W.Ey) for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) out[iy * N + ix] = qw * fieldPhi(x0 + ix * h, y0 + iy * h, 0);
  for (const A of src) {
    const R = fwReach(A), [ax, ay] = fwAt(w, A);
    let ix0 = 0, ix1 = N - 1, iy0 = 0, iy1 = N - 1;
    if (R < Infinity) { ix0 = Math.max(0, Math.floor((ax - R - x0) / h)); ix1 = Math.min(N - 1, Math.ceil((ax + R - x0) / h)); iy0 = Math.max(0, Math.floor((ay - R - y0) / h)); iy1 = Math.min(N - 1, Math.ceil((ay + R - y0) / h)); if (ix0 > ix1 || iy0 > iy1) continue; }
    const R2 = R * R;
    for (let iy = iy0; iy <= iy1; iy++) {
      const dy = y0 + iy * h - ay, dy2 = dy * dy;
      for (let ix = ix0; ix <= ix1; ix++) { const dx = x0 + ix * h - ax, r2 = dx * dx + dy2; if (r2 > R2) continue; out[iy * N + ix] += qw * fwPhi(A, Math.sqrt(r2)); }
    }
  }
}
function fwNorm(w) { let s = 0; const re = w.re, im = w.im; for (let i = 0; i < re.length; i++) s += re[i] * re[i] + im[i] * im[i]; return s; }
/* The wave's energy (eV): ⟨T⟩ from momentum space, ⟨V⟩ with the potential it was last stepped in, normalized; and its
   mean momentum (for its velocity). Cached until the wave changes. */
const _fwR = { re: null, im: null };
const FW_Z = { zc: new Float64Array(128 * 128), zs: new Float64Array(128 * 128), rc: new Float64Array(128 * 128), rs: new Float64Array(128 * 128) };
function fwMeasure(w) {
  if (w.E !== null) return w.E;
  const N = FW.N, n2 = N * N;
  if (!_fwR.re) { _fwR.re = new Float64Array(n2); _fwR.im = new Float64Array(n2); }
  const re = _fwR.re, im = _fwR.im; re.set(w.re); im.set(w.im); fwFFT2(re, im, false);
  let sT = 0, sk = 0, px = 0, py = 0; const T = FW.T, KX = FW.kx, KY = FW.ky;
  for (let i = 0; i < n2; i++) { const a = re[i] * re[i] + im[i] * im[i]; sk += a; sT += a * T[i]; px += a * KX[i]; py += a * KY[i]; }
  let sV = 0, s = 0; const V = w.V;
  for (let i = 0; i < n2; i++) { const a = w.re[i] * w.re[i] + w.im[i] * w.im[i]; s += a; sV += a * V[i]; }
  const hb = FW_HB();
  w.vx = hb * px / sk / w.m; w.vy = hb * py / sk / w.m;
  w.E = sT / sk + sV / s;
  return w.E;
}
function fwEnergy() { let E = 0; for (const w of FW.list) E += fwMeasure(w) + w.dE; return E; }
/* Where it is: the mean of |ψ|², its spread, the weight near the grid's edge and outside the box. */
function fwShape(w) {
  const N = FW.N, h = FW.h, b = FW.band, re = w.re, im = w.im, wrap = W.wall === 'wrap', hw = wrap ? Infinity : W.box.w / 2, hh = wrap ? Infinity : W.box.h / 2;
  let s = 0, mx = 0, my = 0, mxx = 0, myy = 0, edge = 0, out = 0;
  for (let iy = 0; iy < N; iy++) {
    const y = w.y0 + iy * h, ey = iy < b || iy >= N - b, oy = y < -hh || y > hh;
    for (let ix = 0; ix < N; ix++) {
      const i = iy * N + ix, a = re[i] * re[i] + im[i] * im[i]; if (!a) continue;
      s += a; mx += a * ix; my += a * iy; mxx += a * ix * ix; myy += a * iy * iy;
      if (ey || ix < b || ix >= N - b) edge += a;
      const x = w.x0 + ix * h; if (oy || x < -hw || x > hw) out += a;
    }
  }
  mx /= s; my /= s;
  return { s, cx: mx, cy: my, x: w.x0 + mx * h, y: w.y0 + my * h, sd: h * Math.sqrt(Math.max(0, mxx / s - mx * mx + myy / s - my * my)), edge: edge / s, out: out / s };
}
/* Move the grid by whole cells (the wave stays where it is in the world). */
function fwShift(w, sx, sy) {
  if (!sx && !sy) return;
  const N = FW.N, re = w.re, im = w.im, V = w.V, r2 = new Float64Array(N * N), i2 = new Float64Array(N * N), v2 = new Float64Array(N * N).fill(NaN); // (NaN: a cell new to the grid, its potential filled in by the caller)
  for (let iy = 0; iy < N; iy++) { const jy = iy + sy; if (jy < 0 || jy >= N) continue; for (let ix = 0; ix < N; ix++) { const jx = ix + sx; if (jx < 0 || jx >= N) continue; const i = iy * N + ix, j = jy * N + jx; r2[i] = re[j]; i2[i] = im[j]; v2[i] = V[j]; } }
  w.re = r2; w.im = i2; w.V = v2; w.x0 += sx * FW.h; w.y0 += sy * FW.h; w.E = null;
}
/* Before a step: the grid moved (whole cells) so that the wave will be in its middle halfway through the step. What
   the cells left behind held (nothing, unless it had spread to the edge) stays with the wave's energy. */
function fwLead(w, dt) {
  const N = FW.N, h = FW.h, re = w.re, im = w.im;
  let s = 0, mx = 0, my = 0;
  for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) { const i = iy * N + ix, a = re[i] * re[i] + im[i] * im[i]; if (!a) continue; s += a; mx += a * ix; my += a * iy; }
  const sx = Math.round(mx / s + w.vx * dt / 2 / h - (N - 1) / 2), sy = Math.round(my / s + w.vy * dt / 2 / h - (N - 1) / 2);
  if (!sx && !sy) return;
  let lost = 0;
  for (let iy = 0; iy < N; iy++) { const jy = iy - sy, oy = jy < 0 || jy >= N; for (let ix = 0; ix < N; ix++) { const jx = ix - sx; if (oy || jx < 0 || jx >= N) { const i = iy * N + ix; lost += re[i] * re[i] + im[i] * im[i]; } } }
  if (lost / s < 1e-12) { fwShift(w, sx, sy); return; }
  const before = fwMeasure(w) + w.dE; fwShift(w, sx, sy); for (let i = 0; i < N * N; i++) if (Number.isNaN(w.V[i])) w.V[i] = 0;
  const E = fwMeasure(w); w.dE = before - E;
}
/* A point electron or positron becomes a wave: a Gaussian of spread σ (1.2 Å, or 2 Å if it is slow), moving as it did,
   its momentum chosen so that the wave's energy is the point's (measured with and without it). */
function fwFrom(p) {
  const N = FW.N, h = FW.h, L = N * h, hb = FW_HB();
  fwKTables(p.m);
  const E0 = totalEnergy().total; kill(p); const Ep = E0 - totalEnergy().total; // (its motion and every share it had)
  const w = { re: new Float64Array(N * N), im: new Float64Array(N * N), V: new Float64Array(N * N), x0: p.x - L / 2, y0: p.y - L / 2, q: p.q, pos: p.k === POS, m: p.m, dE: 0, E: null, id: p.id, src: p.srcRef || null, vx: 0, vy: 0, born: W.t, k0: 0 };
  const src = fwSources(); fwBuildV(w, w.V, src);
  const sp = Math.hypot(p.vx, p.vy), ux = sp > 0 ? p.vx / sp : 1, uy = sp > 0 ? p.vy / sp : 0;
  const make = (sig, k) => { for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) { const dx = w.x0 + ix * h - p.x, dy = w.y0 + iy * h - p.y, g = Math.exp(-(dx * dx + dy * dy) / (4 * sig * sig)), ph = k * (ux * dx + uy * dy), i = iy * N + ix; w.re[i] = g * Math.cos(ph); w.im[i] = g * Math.sin(ph); } w.E = null; };
  for (const sig of [1.2, 2, 3]) {
    make(sig, 0); const Z = fwMeasure(w), room = Ep - Z; // (no motion: its spread's kinetic energy and its place's potential)
    if (room < 0) continue;
    let k = Math.sqrt(2 * p.m * room) / hb;
    for (let it = 0; it < 3; it++) { make(sig, k); const T = fwMeasure(w) - Z; if (!(T > 1e-12)) break; k *= Math.sqrt(room / T); }
    make(sig, k); w.dE = Ep - fwMeasure(w); w.k0 = k;
    FW.list.push(w); FW.n = FW.list.length; FW.made++;
    return w;
  }
  // (too slow or too bound for even the widest packet: a point again, where it was and as fast: the same energy)
  const q = addLepton(p.k, p.x, p.y, p.vx, p.vy); if (p.srcRef) q.srcRef = p.srcRef;
  FW.cool.set(q.id, W.step + 400);
  return null;
}
/* A wave becomes a point (a measurement) at (x, y), moving along (ux, uy), with the wave's energy; tries the places in
   order and keeps the first where the energy allows it. Returns the point, or null (the wave goes on). */
function fwToPoint(w, tries, force) {
  const Ew = fwMeasure(w) + w.dE;
  if (force) { const sh = fwShape(w), hw = W.box.w / 2 - 0.1, hh = W.box.h / 2 - 0.1; tries = tries.concat([[clamp(sh.x, -hw, hw), clamp(sh.y, -hh, hh), w.vx || 1, w.vy || 0]]); }
  for (let t = 0; t < tries.length; t++) {
    let [x, y, ux, uy] = tries[t]; const last = force && t === tries.length - 1;
    if (W.wall === 'wrap') { const bw = W.box.w, bh = W.box.h; x -= Math.round(x / bw) * bw; y -= Math.round(y / bh) * bh; }
    if (!(Math.abs(x) < W.box.w / 2 - 0.05 && Math.abs(y) < W.box.h / 2 - 0.05)) continue;
    const i = FW.list.indexOf(w); if (i < 0) return null;
    FW.list.splice(i, 1); FW.n = FW.list.length;
    const E0 = totalEnergy().total;
    const p = addLepton(w.pos ? POS : ELEC, x, y, 0, 0);
    const K = Ew - (totalEnergy().total - E0);
    if (K >= 0 || last) {
      if (K < 0) { W.ledger.bath += K; WAVE.bath += K; } // (nowhere in the box could take it as it was: the difference from the heat bath, rare)
      const v = Math.sqrt(2 * Math.max(0, K) / p.m), u = Math.hypot(ux, uy) || 1; p.vx = v * ux / u; p.vy = v * uy / u; updateFast(p);
      if (w.src) p.srcRef = w.src;
      FW.cool.set(p.id, W.step + 200); FW.meas++;
      return p;
    }
    kill(p); FW.list.splice(i, 0, w); FW.n = FW.list.length; // (not there: the next place)
  }
  return null;
}
/* A place drawn from |ψ|² (inside the box), and the wave's current there. */
function fwSample(w) {
  const N = FW.N, h = FW.h, re = w.re, im = w.im, wrap = W.wall === 'wrap', hw = wrap ? Infinity : W.box.w / 2, hh = wrap ? Infinity : W.box.h / 2;
  let s = 0; for (let i = 0; i < N * N; i++) s += re[i] * re[i] + im[i] * im[i];
  const out = [];
  for (let t = 0; t < 4; t++) {
    let u = rnd() * s, i = 0; for (; i < N * N - 1; i++) { u -= re[i] * re[i] + im[i] * im[i]; if (u <= 0) break; }
    const ix = i % N, iy = (i / N) | 0, x = w.x0 + ix * h, y = w.y0 + iy * h;
    if (!(Math.abs(x) < hw && Math.abs(y) < hh)) continue;
    let jx = 0, jy = 0; // (the current, Im(ψ* ∇ψ), by central differences)
    if (ix > 0 && ix < N - 1 && iy > 0 && iy < N - 1) {
      const a = re[i], b = im[i];
      jx = a * (im[i + 1] - im[i - 1]) - b * (re[i + 1] - re[i - 1]); jy = a * (im[i + N] - im[i - N]) - b * (re[i + N] - re[i - N]);
    }
    if (!(Math.hypot(jx, jy) > 1e-30)) { fwMeasure(w); jx = w.vx; jy = w.vy; }
    out.push([x, y, jx, jy]);
  }
  return out;
}
/* At the start of a step: what changed in each wave's potential since it was last stepped (an event), kept with it. */
function fwPre() {
  if (!FW.n) return;
  const sig = [W.spawned, W.topo, W.dirty, W.deaths, W.Ex, W.Ey].join();
  if (sig === FW.sig) return;
  const src = fwSources(), V = new Float64Array(FW.N * FW.N);
  for (const w of FW.list) {
    fwBuildV(w, V, src);
    let s = 0, d = 0; const re = w.re, im = w.im, V0 = w.V;
    for (let i = 0; i < V.length; i++) { const a = re[i] * re[i] + im[i] * im[i]; s += a; d += a * (V[i] - V0[i]); }
    w.dE -= d / s; w.V.set(V); w.E = null;
  }
  FW.sig = sig;
}
/* One step dt for every wave (after the atoms have moved, before the forces at the new places): Strang splitting with
   the old potential's half phase, the kinetic phase, the new potential's half phase. */
function fwKin(dts) { // the kinetic phase over dts, cached by step
  let t = FW.kin.get(dts); if (t) return t;
  const n2 = FW.N * FW.N, hb = FW_HB(), c = new Float64Array(n2), s = new Float64Array(n2);
  for (let i = 0; i < n2; i++) { const ph = -FW.T[i] * dts / hb; c[i] = Math.cos(ph); s[i] = Math.sin(ph); }
  if (FW.kin.size > 64) FW.kin.clear();
  t = [c, s]; FW.kin.set(dts, t); return t;
}
function fwStep(dt) {
  if (!FW.n) return;
  const t0 = performance.now(), N = FW.N, n2 = N * N, hb = FW_HB(), src = fwSources(), Vn = new Float64Array(n2);
  const kmax2 = Math.pow(FW.kmax * Math.PI / FW.h, 2), KX = FW.kx, KY = FW.ky;
  const ends = [];
  for (const w of FW.list) {
    if (w.E === null) fwMeasure(w); // (its mean velocity, for where to put the grid)
    fwLead(w, dt);
    const re = w.re, im = w.im;
    const kick = (V, f) => { for (let i = 0; i < n2; i++) { const ph = f * V[i]; if (!ph) continue; const c = Math.cos(ph), s = Math.sin(ph), a = re[i], b = im[i]; re[i] = a * c - b * s; im[i] = a * s + b * c; } };
    fwBuildV(w, Vn, src);
    { const V0 = w.V; for (let i = 0; i < n2; i++) if (Number.isNaN(V0[i])) V0[i] = Vn[i]; } // (cells new to the grid)
    // as many steps as the potential's spread where the wave is needs (half a radian of phase across it a step)
    // (over the cells the wave covers or reaches this step: within 3 spreads of its middle, plus how far it moves)
    let sa = 0, mx = 0, my = 0, mq = 0;
    for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) { const i = iy * N + ix, a = re[i] * re[i] + im[i] * im[i]; if (!a) continue; sa += a; mx += a * ix; my += a * iy; mq += a * (ix * ix + iy * iy); }
    mx /= sa; my /= sa;
    const rs = 3 * Math.sqrt(Math.max(0, mq / sa - mx * mx - my * my)) + Math.hypot(w.vx, w.vy) * dt / FW.h + 4, rs2 = rs * rs;
    let lo = Infinity, hi = -Infinity, g = 0; const V0 = w.V;
    for (let iy = Math.max(1, Math.floor(my - rs)); iy <= Math.min(N - 2, Math.ceil(my + rs)); iy++) for (let ix = Math.max(1, Math.floor(mx - rs)); ix <= Math.min(N - 2, Math.ceil(mx + rs)); ix++) {
      if ((ix - mx) ** 2 + (iy - my) ** 2 > rs2) continue;
      const i = iy * N + ix, u = V0[i] < Vn[i] ? V0[i] : Vn[i], v = V0[i] < Vn[i] ? Vn[i] : V0[i]; if (u < lo) lo = u; if (v > hi) hi = v;
      const gx = Vn[i + 1] - Vn[i - 1], gy = Vn[i + N] - Vn[i - N], g2 = gx * gx + gy * gy; if (g2 > g) g = g2;
    }
    g = Math.sqrt(g) / (2 * FW.h); // (the steepest slope, eV/Å: a step's push on the wave kept under FW.kick ħ/Å)
    const ns = Math.max(1, Math.min(FW.subMax, Math.ceil(Math.max((hi > lo ? hi - lo : 0) / FW.phase, g / FW.kick) * dt / hb))), dts = dt / ns, [kc, ks] = fwKin(dts);
    w.ns = ns;
    let hiK = 0, sk = 0;
    kick(V0, -0.5 * dts / hb);
    // (between the short steps, the whole phase of the potential of that moment, V0 + (Vn − V0)·j/ns: kept as a factor z
    // per cell, turned by r each step, so a short step costs two FFTs and three products, no cosines)
    if (ns > 1) { const f0 = -dts / hb, f1 = f0 / ns; for (let i = 0; i < n2; i++) { const d = Vn[i] - V0[i], p0 = f0 * (V0[i] + d / ns), p1 = f1 * d; FW_Z.zc[i] = Math.cos(p0); FW_Z.zs[i] = Math.sin(p0); FW_Z.rc[i] = Math.cos(p1); FW_Z.rs[i] = Math.sin(p1); } }
    const zc = FW_Z.zc, zs = FW_Z.zs, rcv = FW_Z.rc, rsv = FW_Z.rs;
    for (let j = 1; j <= ns; j++) {
      fwFFT2(re, im, false);
      const last = j === ns;
      for (let i = 0; i < n2; i++) { const a = re[i], b = im[i], c = kc[i], s = ks[i]; if (last) { const m = a * a + b * b; sk += m; if (KX[i] * KX[i] + KY[i] * KY[i] > kmax2) hiK += m; } re[i] = a * c - b * s; im[i] = a * s + b * c; }
      fwFFT2(re, im, true);
      if (last) kick(Vn, -0.5 * dts / hb);
      else for (let i = 0; i < n2; i++) { const c = zc[i], s = zs[i], a = re[i], b = im[i]; re[i] = a * c - b * s; im[i] = a * s + b * c; const u = c * rcv[i] - s * rsv[i]; zs[i] = c * rsv[i] + s * rcv[i]; zc[i] = u; }
    }
    const hi_ = hiK;
    w.V.set(Vn); w.E = null;
    // where it is now: keep the grid on it, or measure it
    const sh = fwShape(w); w._s = sh.s;
    let why = '';
    if (hi_ / sk > 1e-3) why = 'fast';
    else if (sh.out > 1e-3) why = 'wall';
    else if (sh.edge > 1e-6) {
      const sx = Math.round(sh.cx - (N - 1) / 2), sy = Math.round(sh.cy - (N - 1) / 2);
      if (sh.sd > 0.3 * N * FW.h) { if (sh.edge > 1e-3) why = 'wide'; }
      else if (Math.abs(sx) >= 4 || Math.abs(sy) >= 4 || sh.edge > 1e-4) {
        const before = fwMeasure(w) + w.dE; fwShift(w, sx, sy); fwBuildV(w, w.V, src); w.E = null; w.dE = before - fwMeasure(w); // (what the few cells left behind held stays with the wave)
      }
    }
    if (!why) { // meeting a core: the chance it is found there this step
      let P = 0; const cand = [];
      for (const A of src) {
        if (A.k !== NUC && Math.sign(A.q) === Math.sign(w.q)) continue; // (a free lepton of the same charge is no target)
        const pc = fwCore(w, A); if (pc > 1e-9) { cand.push([A, pc]); P += pc; }
      }
      if (P > 1e-5 && rnd() < Math.min(1, P * dt / FW.tauCap)) { // (found in a core this step: which one, in proportion)
        const u = rnd() * P; let acc = 0, pick = cand[cand.length - 1][0]; for (const [A, pc] of cand) { acc += pc; if (u < acc) { pick = A; break; } }
        ends.push([w, 'core', pick]);
      }
    } else ends.push([w, why]);
    w.sx = sh.x; w.sy = sh.y; w.sd = sh.sd;
  }
  FW.ends = ends;
  FW.ms += performance.now() - t0;
}
/* After the step's events: the waves found somewhere this step become points there (born after the closing kick, as
   an event's particles are). */
function fwEnds() {
  const ends = FW.ends; FW.ends = null; if (!ends || !ends.length) return;
  for (const [w, why, A] of ends) {
    if (FW.list.indexOf(w) < 0) continue;
    FW.why[why] = (FW.why[why] || 0) + 1;
    if (why === 'core') { if (A.dead) continue; const [ax, ay] = fwAt(w, A), dx = w.sx - ax, dy = w.sy - ay, r = Math.hypot(dx, dy) || 1, tries = []; for (const f of [1.05, 1.5, 2, 3, 4]) tries.push([ax + dx / r * FW.rc * f, ay + dy / r * FW.rc * f, -dx, -dy]); fwToPoint(w, tries); }
    else fwToPoint(w, fwSample(w), true);
  }
}
function fwCore(w, A) { // the part of |ψ|² within A's core
  const N = FW.N, h = FW.h, rc = FW.rc, re = w.re, im = w.im, [ax, ay] = fwAt(w, A);
  const ix0 = Math.max(0, Math.floor((ax - rc - w.x0) / h)), ix1 = Math.min(N - 1, Math.ceil((ax + rc - w.x0) / h)), iy0 = Math.max(0, Math.floor((ay - rc - w.y0) / h)), iy1 = Math.min(N - 1, Math.ceil((ay + rc - w.y0) / h));
  if (ix0 > ix1 || iy0 > iy1) return 0;
  let a = 0, s = w._s || 0;
  for (let iy = iy0; iy <= iy1; iy++) { const dy = w.y0 + iy * h - ay; for (let ix = ix0; ix <= ix1; ix++) { const dx = w.x0 + ix * h - ax; if (dx * dx + dy * dy <= rc * rc) { const i = iy * N + ix; a += re[i] * re[i] + im[i] * im[i]; } } }
  if (!a) return 0;
  if (!s) { s = fwNorm(w); }
  return a / s;
}
/* The waves' pull on what they feel (added to the forces after the kernels): −∂⟨V⟩/∂(its place). */
const _fwD = [0];
function fwForces(FX, FY) {
  if (!FW.n) return;
  const src = fwSources(), N = FW.N, h = FW.h;
  for (const w of FW.list) {
    const re = w.re, im = w.im, s = fwNorm(w), qw = w.q;
    for (const A of src) {
      const R = fwReach(A), [ax, ay] = fwAt(w, A); let ix0 = 0, ix1 = N - 1, iy0 = 0, iy1 = N - 1;
      if (R < Infinity) { ix0 = Math.max(0, Math.floor((ax - R - w.x0) / h)); ix1 = Math.min(N - 1, Math.ceil((ax + R - w.x0) / h)); iy0 = Math.max(0, Math.floor((ay - R - w.y0) / h)); iy1 = Math.min(N - 1, Math.ceil((ay + R - w.y0) / h)); if (ix0 > ix1 || iy0 > iy1) continue; }
      const R2 = R * R; let fx = 0, fy = 0;
      for (let iy = iy0; iy <= iy1; iy++) {
        const dy = w.y0 + iy * h - ay, dy2 = dy * dy;
        for (let ix = ix0; ix <= ix1; ix++) {
          const i = iy * N + ix, a = re[i] * re[i] + im[i] * im[i]; if (a < 1e-30) continue;
          const dx = w.x0 + ix * h - ax, r2 = dx * dx + dy2; if (r2 > R2) continue;
          const r = Math.sqrt(r2); if (r < 1e-9) continue;
          fwPhi(A, r, _fwD); const g = a * qw * _fwD[0] / r; fx += g * dx; fy += g * dy;
        }
      }
      FX[A.i] += fx / s; FY[A.i] += fy / s;
    }
  }
}
/* Who becomes a wave (at the start of a step): free electrons and positrons in MD, clear of atoms, slower than 300 eV,
   up to FW.max; with the option off (or in 3-D, or wrapping walls) every wave becomes a point again. */
function fwSync() {
  const want = FW.on && !W.d3;
  if (!want) { while (FW.list.length) fwToPoint(FW.list[0], W.d3 ? [] : fwSample(FW.list[0]), true); return; }
  if (FW.list.length >= FW.max) return;
  let near = null;
  for (const p of W.parts) {
    if (FW.list.length >= FW.max) break;
    if (p.dead || (p.k !== ELEC && p.k !== POS) || p.fast || p.rad || p.wm || p.i === undefined) continue;
    if ((FW.cool.get(p.id) || 0) > W.step) continue;
    const ke = 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy); if (ke > 300 || ke < FW.keMin) continue; // (slower than this, not even the widest packet (σ 3 Å, 0.21 eV of spread) could be paid for, unless an ion pulls on it)
    if (W.wall !== 'wrap' && (Math.abs(p.x) > W.box.w / 2 - 2 || Math.abs(p.y) > W.box.h / 2 - 2)) continue;
    if (W.wall === 'wrap' && Math.min(W.box.w, W.box.h) < FW.N * FW.h + 4) continue; // (a box narrower than the grid would meet the wave's own image)
    near = near || W.parts.filter(A => !A.dead && A.k === NUC && A.Z > 0 && !A.rad && !A.fast);
    let clear = true; for (const A of near) { const [dx, dy] = minImg(A.x - p.x, A.y - p.y, 0); if (dx * dx + dy * dy < 1.44) { clear = false; break; } }
    if (!clear) continue;
    fwFrom(p);
  }
}
function fwSet(on) { FW.on = !!on; }
function fwClear() { FW.list.length = 0; FW.n = 0; FW.cool.clear(); FW.sig = ''; }
/* Drawing (render.js): |ψ|² as a glow in the lepton's colour, brighter where it is denser, over the grid's square. */
const _fwImg = { cv: null };
function fwDraw(ctx) {
  if (!FW.n) return;
  const N = FW.N;
  if (!_fwImg.cv) { _fwImg.cv = document.createElement('canvas'); _fwImg.cv.width = N; _fwImg.cv.height = N; _fwImg.ctx = _fwImg.cv.getContext('2d'); _fwImg.id = _fwImg.ctx.createImageData(N, N); }
  const id = _fwImg.id, d = id.data;
  for (const w of FW.list) {
    const re = w.re, im = w.im; let mx = 0;
    for (let i = 0; i < N * N; i++) { const a = re[i] * re[i] + im[i] * im[i]; if (a > mx) mx = a; }
    const col = w.pos ? [255, 120, 90] : [90, 170, 255], k = mx > 0 ? 1 / mx : 0;
    for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
      const i = iy * N + ix, j = ((N - 1 - iy) * N + ix) * 4, a = Math.sqrt((re[i] * re[i] + im[i] * im[i]) * k); // (rows flipped: y is up in the world)
      d[j] = col[0]; d[j + 1] = col[1]; d[j + 2] = col[2]; d[j + 3] = Math.min(255, Math.round(230 * a));
    }
    _fwImg.ctx.putImageData(id, 0, 0);
    const h = FW.h, x = w2sx(w.x0 - h / 2), y = w2sy(w.y0 + (N - 0.5) * h), s = N * h * R.s;
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(_fwImg.cv, x, y, s, s); ctx.restore();
  }
}
