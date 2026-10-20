'use strict';
/* ============================================================================
   Atom Forge — worker threads for the nucleus pair forces
   The pair kernel (engine.js, between the PAIR KERNEL markers) runs on the shared store from several Web Workers:
   each takes a range of the neighbour list, writes forces into its own buffer and notes event candidates in its own
   queue; the main thread takes a range too, then the buffers are summed slot by slot in a fixed order (deterministic
   for a given thread count) and the candidates are turned into events in list order, exactly as on one thread.
   Workers wait on a shared control word (Atomics.wait) and the main thread spins on it, so a force computation stays a
   synchronous call. Needs SharedArrayBuffer, i.e. a cross-origin isolated page (the desktop app; a plain page falls back
   to one thread). The kernel's text is embedded by build.js as PAIR_KERNEL_SRC.
   ========================================================================== */
const TH = { n: 0, want: 0, workers: [], ctrl: null, prm: null, fx: [], fy: [], cq: [], boundGen: -1, ready: 0, gen: 0, acks: null,
  minPairs: 1500, used: 0, lastMs: 0, state: 'off', note: '', wks: null, stacks: [], wasmOn: [] };
const TH_IDLE = 0, TH_PAIRS = 1, TH_DONE = 2, TH_REBIND = 3, TH_SUM = 4, TH_SUMMED = 5, TH_INTEG = 6, TH_INTEGD = 7, TH_BATH = 8, TH_BATHD = 9, TH_VL = 10, TH_VLD = 11, TH_EX = 12, TH_EXD = 13, TH_DT = 14, TH_DTD = 15;
// control layout: [0, n) worker states; then 10 per worker: pair range (2), candidate count, ack (the generation bound), bond range (2), angle range (2), the generation wanted, spare; prm: per worker stiffness, then the box
function thCtrl(w, k) { return TH.n + 10 * w + k; }
/* The heat bath's noise: two normals from (seed, step, slot), the same on any thread and in any order, so a bath stirred
   on sixteen threads is the very simulation one thread gives, step for step. The slot's hash (murmur3's finaliser) picks
   two entries of a fixed table of 65,536 normals (made once, the same everywhere, centred and scaled to unit variance
   exactly): a tenth of the cost of Box–Muller per atom (whose log, sqrt, cos and sin made the bath the step's biggest
   serial cost), with the right mean, variance and tails and no correlation between x and y or from step to step. */
const BATH_TB = 16;
function bathTableMake() {
  const T = new Float64Array(1 << 16); let a = 0x2545F491;
  const u = () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return ((a >>> 0) + 0.5) / 4294967296; };
  for (let i = 0; i < T.length; i += 2) { const r = Math.sqrt(-2 * Math.log(u())), th = 2 * Math.PI * u(); T[i] = r * Math.cos(th); T[i + 1] = r * Math.sin(th); }
  let m = 0, v = 0; for (let i = 0; i < T.length; i++) m += T[i]; m /= T.length;
  for (let i = 0; i < T.length; i++) { T[i] -= m; v += T[i] * T[i]; }
  v = Math.sqrt(v / T.length); for (let i = 0; i < T.length; i++) T[i] /= v;
  return T;
}
const _bathNz = new Float64Array(2), _bathT = bathTableMake();
function bathNoise(seed, step, slot, out) {
  let h = Math.imul(seed ^ Math.imul(step | 0, 0x9E3779B1), 0x85EBCA77) ^ Math.imul(slot + 1, 0xC2B2AE35);
  h ^= h >>> 16; h = Math.imul(h, 0x85EBCA6B); h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35); h ^= h >>> 16;
  out[0] = _bathT[h & 0xFFFF]; out[1] = _bathT[h >>> 16];
}
/* A worker's force buffer is non-zero only on the slots its share of the pairs, bonds and angles touches: two intervals,
   the pairs' and the bonds' and angles', each lo ≤ s < hi (lo ≥ hi: none). bufSpans finds them for the ranges given and
   writes them at prm[o … o+3] (merged into the first when they meet); bufZero clears what a buffer had; bufSum adds
   every buffer onto the store's forces for slots s0 ≤ s < s1 in buffer order, only within its intervals. Outside them
   a buffer holds zeros, so the sums are those of adding every buffer everywhere, value for value. */
function bufSpans(q0, q1, b0, b1, c0, c1, pi, pj, out, o) {
  let lo = 2147483647, hi = -1;
  for (let q = q0; q < q1; q++) { const i = pi[q], j = pj[q]; if (i < lo) lo = i; if (i > hi) hi = i; if (j < lo) lo = j; if (j > hi) hi = j; }
  let lo2 = 2147483647, hi2 = -1;
  const A = BD.a, B = BD.b;
  for (let k = b0; k < b1; k++) { const i = A[k], j = B[k]; if (i < lo2) lo2 = i; if (i > hi2) hi2 = i; if (j < lo2) lo2 = j; if (j > hi2) hi2 = j; }
  const cs = AC.c, nbs = AC.nb, cnt = AC.cnt;
  for (let c = c0; c < c1; c++) { const pc = cs[c]; if (pc < lo2) lo2 = pc; if (pc > hi2) hi2 = pc; for (let t = 0, n = cnt[c], b = 6 * c; t < n; t++) { const v = nbs[b + t]; if (v < lo2) lo2 = v; if (v > hi2) hi2 = v; } }
  if (hi < 0) { lo = 0; hi = -1; }
  if (hi2 < 0) { lo2 = 0; hi2 = -1; }
  if (hi >= 0 && hi2 >= 0 && lo2 <= hi + 1 && lo <= hi2 + 1) { lo = Math.min(lo, lo2); hi = Math.max(hi, hi2); lo2 = 0; hi2 = -1; } // (they meet: one)
  else if (hi < 0) { lo = lo2; hi = hi2; lo2 = 0; hi2 = -1; }
  out[o] = lo; out[o + 1] = hi + 1; out[o + 2] = lo2; out[o + 3] = hi2 + 1;
}
function bufZero(FX, FY, sp) { for (let k = 0; k < 4; k += 2) if (sp[k + 1] > sp[k]) { FX.fill(0, sp[k], sp[k + 1]); FY.fill(0, sp[k], sp[k + 1]); } }
function bufSum(s0, s1, FX, FY, bufs, prm, base) {
  for (let b = 0; b < bufs.length; b++) {
    const BX = bufs[b][0], BY = bufs[b][1], o = base + 4 * b;
    for (let k = 0; k < 4; k += 2) {
      const a = prm[o + k] > s0 ? prm[o + k] : s0, e = prm[o + k + 1] < s1 ? prm[o + k + 1] : s1;
      for (let s = a; s < e; s++) { FX[s] += BX[s]; FY[s] += BY[s]; }
    }
  }
}
/* outerB for slots s0 ≤ s < s1 in the plain case (no magnetic field, no heat tool): the velocity half-kick and the
   Langevin bath on nuclei, the same arithmetic as engine.js's outerB, elementwise. */
/* …and counts the particles the step's walls pass must look at (anything but an atom inside the box at an atom's pace,
   a neutron or light); hw < 0: not counted. */
function bathSlots(s0, s1, h, c1, c2, kT, gam, seed, step, hw, hh, vf2) {
  const X = S.x, Y = S.y; let need = 0;
  const DEAD = S.dead, RAD = S.rad, K = S.k, Z = S.Z, FAST = S.fast, VX = S.vx, VY = S.vy, FX = S.fx, FY = S.fy, GX = S.gx, GY = S.gy, IM = S.im, FRESH = S.fresh, nz = _bathNz;
  for (let i = s0; i < s1; i++) {
    if (DEAD[i] === 1 || RAD[i] === 1) continue;
    const k = K[i];
    if (k === 0 && Z[i] === 0) continue; // (NUC = 0: neutrons fly straight)
    if (hw >= 0 && (k !== 0 || FAST[i] === 1)) need++;
    if (FRESH[i] === 1) { FRESH[i] = 0; if (hw >= 0 && k === 0) { const x = X[i], y = Y[i]; if (!(x > -hw && x < hw && y > -hh && y < hh && VX[i] * VX[i] + VY[i] * VY[i] <= vf2)) need++; } continue; }
    const fast = FAST[i] === 1;
    if (fast && k !== 0) continue;
    let vx = VX[i], vy = VY[i];
    const im = IM[i];
    if (fast) { vx += h * FX[i] * im; vy += h * FY[i] * im; }
    else { vx += h * (FX[i] - GX[i]) * im; vy += h * (FY[i] - GY[i]) * im; }
    if (gam > 0 && k === 0) { const sg = Math.sqrt(kT * im); bathNoise(seed, step, i, nz); vx = c1 * vx + c2 * sg * nz[0]; vy = c1 * vy + c2 * sg * nz[1]; }
    VX[i] = vx; VY[i] = vy;
    if (hw >= 0 && !fast) { const x = X[i], y = Y[i]; if (!(x > -hw && x < hw && y > -hh && y < hh && vx * vx + vy * vy <= vf2)) need++; }
  }
  return need;
}
/* chooseDt's maxima over slots s0 ≤ s < s1, into out[o … o+2]: the squared speed and acceleration of the atoms in MD,
   the squared speed of fast nuclei. A maximum is the same however the slots are shared out, so the threads give the
   one-thread step size exactly. */
function dtSlots(s0, s1, out, o) {
  const DEAD = S.dead, RAD = S.rad, K = S.k, Z = S.Z, FAST = S.fast, VX = S.vx, VY = S.vy, FX = S.fx, FY = S.fy, IM = S.im;
  let vmax = 0, amax = 0, vfn = 0;
  for (let i = s0; i < s1; i++) {
    if (DEAD[i] === 1 || RAD[i] === 1) continue;
    const k = K[i];
    if (k === 0 && Z[i] === 0) continue; // (NUC = 0)
    const v2 = VX[i] * VX[i] + VY[i] * VY[i];
    if (FAST[i] === 1) { if (k === 0 && v2 > vfn) vfn = v2; continue; }
    if (k !== 0) continue;
    if (v2 > vmax) vmax = v2;
    const a2 = (FX[i] * FX[i] + FY[i] * FY[i]) * IM[i] * IM[i];
    if (a2 > amax) amax = a2;
  }
  out[o] = vmax; out[o + 1] = amax; out[o + 2] = vfn;
}
/* outerA + the plain drift for slots s0 ≤ s < s1 (the same arithmetic as engine.js's outerA and innerSteps, elementwise). */
/* …and, its forces used, clears them for the coming force pass (which then need not), and returns the largest squared
   move of the neighbour list's atoms (vlin) from where the list saw them, for its check. */
function integrateSlots(s0, s1, dt) {
  const h = 0.5 * dt, DEAD = S.dead, RAD = S.rad, K = S.k, Z = S.Z, FAST = S.fast, VX = S.vx, VY = S.vy, FX = S.fx, FY = S.fy, GX = S.gx, GY = S.gy, IM = S.im;
  const X = S.x, Y = S.y, OX = S.ox, OY = S.oy, FRESH = S.fresh, BALL = S.ballistic, IN = S.vlin, LX = S.vlx, LY = S.vly;
  let worst = 0;
  for (let i = s0; i < s1; i++) {
    if (DEAD[i] === 1 || RAD[i] === 1) continue;
    const k = K[i];
    if (k === 0 && Z[i] === 0) continue; // (NUC = 0: neutrons fly straight)
    OX[i] = X[i]; OY[i] = Y[i]; FRESH[i] = 0;
    if (FAST[i] === 1) {
      BALL[i] = k !== 0 ? 1 : 0;
      if (k !== 0) continue;
      const vx = VX[i] + h * FX[i] * IM[i], vy = VY[i] + h * FY[i] * IM[i];
      VX[i] = vx; VY[i] = vy; X[i] += vx * dt; Y[i] += vy * dt;
      continue;
    }
    BALL[i] = 0;
    const vx = VX[i] + h * (FX[i] - GX[i]) * IM[i], vy = VY[i] + h * (FY[i] - GY[i]) * IM[i];
    VX[i] = vx; VY[i] = vy;
    X[i] += vx * dt; Y[i] += vy * dt; // (the drift: innerSteps' one inner step)
    if (IN[i] === 1) { const dx = X[i] - LX[i], dy = Y[i] - LY[i], d2 = dx * dx + dy * dy; if (d2 > worst) worst = d2; }
  }
  FX.fill(0, s0, s1); FY.fill(0, s0, s1); GX.fill(0, s0, s1); GY.fill(0, s0, s1); S.nearIon.fill(0, s0, s1);
  return worst;
}

function threadsAvailable() { return SHARED_OK && typeof PAIR_KERNEL_SRC === 'string' && typeof Worker !== 'undefined' && typeof Blob !== 'undefined'; }
function threadsDefault() { const c = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2; return Math.max(0, Math.min(15, c - 1)); }
/* The worker's script: the kernel's constants and helpers as they are here, then the kernel text, then the loop. */
function workerSource() {
  return `'use strict';
const RC2 = ${RC2}, FCAP = ${FCAP}, CORE_RMIN = ${CORE_RMIN}, BARE_SMEAR = ${BARE_SMEAR}, R_ANN = ${R_ANN}, K_COUL = ${PHYS.KE}, ANGLE_K = ${ANGLE_K};
${zblA.toString()}
${zblD.toString()}
${zblD2.toString()}
let S = null, AC = null, BD = null;
${PAIR_KERNEL_SRC}
${integrateSlots.toString()}
${bathTableMake.toString()}
const _bathNz = new Float64Array(2), _bathT = bathTableMake();
${bathNoise.toString()}
${bathSlots.toString()}
${dtSlots.toString()}
${bufSpans.toString()}
${bufZero.toString()}
${bufSum.toString()}
${vlPairs.toString()}
${exRange.toString()}
let GV = null, mdI = null, exl = null, exn = null;
let SPAN0 = 0; const spPrev = new Float64Array(4);
let pi, pj, ex, FXo, FYo, CQ, ctrl, prm, me, nW, bufs, mem = null, wasm = null, wex = null, descOff = 0, ksOff = 0, ksArr = null, sumTabOff = 0;
const TH_IDLE = 0, TH_PAIRS = 1, TH_DONE = 2, TH_REBIND = 3, TH_SUM = 4, TH_SUMMED = 5, TH_INTEG = 6, TH_INTEGD = 7, TH_BATH = 8, TH_BATHD = 9, TH_VL = 10, TH_VLD = 11, TH_EX = 12, TH_EXD = 13, TH_DT = 14, TH_DTD = 15;
function ctrlAt(w, k) { return nW + 10 * w + k; }
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'bind') {
    // arrays as {t, b, off, len}: views on the WebAssembly memory (refreshed: it may have grown) or on their own buffers
    mem = m.mem || null;
    const view = (d) => new self[d.t](mem ? mem.buffer : d.b, d.off, d.len);
    S = {}; for (const k in m.S) S[k] = view(m.S[k]);
    pi = view(m.pi); pj = view(m.pj); ex = view(m.ex);
    AC = {}; for (const k in m.AC) AC[k] = view(m.AC[k]);
    BD = {}; for (const k in m.BD) BD[k] = view(m.BD[k]);
    bufs = m.bufs.map(b => [view(b[0]), view(b[1])]);
    GV = { fwd: null }; for (const k in m.G) GV[k] = view(m.G[k]); mdI = view(m.mdI); exl = view(m.exl); exn = view(m.exn);
    me = m.me; nW = m.nW; FXo = bufs[me][0]; FYo = bufs[me][1]; SPAN0 = 4 * nW + 32;
    spPrev[0] = 0; spPrev[1] = FXo.length; spPrev[2] = 0; spPrev[3] = 0; // (a buffer just bound: cleared whole at its first pass)
    CQ = view(m.cq); ctrl = new Int32Array(m.ctrl); prm = new Float64Array(m.prm);
    if (m.wasm && !wasm) { // the kernel module on the shared memory, with a stack of this worker's own
      try {
        wasm = new WebAssembly.Instance(m.wasm.module, { env: { memory: mem } });
        wasm.exports.__stack_pointer.value = m.wasm.stackTop;
        wex = wasm.exports;
      } catch (err) { wasm = null; wex = null; console.warn('Atom Forge worker: WebAssembly kernel unavailable, using JavaScript:', err.message || err); }
    }
    if (m.wasm) { descOff = m.wasm.desc; ksOff = m.wasm.ks; sumTabOff = m.wasm.sumTab; ksArr = new Float64Array(mem.buffer, ksOff, 16); }
    postMessage({ type: 'kernel', wasm: !!wex, me });
    Atomics.store(ctrl, me, TH_IDLE); // (a rebind request left on our word is served by this message)
    Atomics.store(ctrl, ctrlAt(me, 3), m.gen); // bound: the acknowledgement
    if (Atomics.load(ctrl, ctrlAt(me, 8)) !== m.gen) return; // a newer binding is already in the queue (its request on our word was just overwritten): back to the event loop for it
  }
  const SPIN_MS = 2.5; // a worker looks for the next order this long before it sleeps: a step's passes, and the next step's first, come within it (a sleeping worker costs tens of microseconds to wake, several times a step)
  const waitFor = (notValue) => { const t0 = performance.now(); while (Atomics.load(ctrl, me) === notValue) { if (performance.now() - t0 > SPIN_MS) { Atomics.wait(ctrl, me, notValue); break; } } };
  for (;;) {
    waitFor(TH_IDLE);
    const st = Atomics.load(ctrl, me);
    if (st === TH_REBIND) { Atomics.store(ctrl, me, TH_IDLE); return; } // new buffers coming by message: back to the event loop
    if (st === TH_PAIRS) {
      const q0 = ctrl[ctrlAt(me, 0)], q1 = ctrl[ctrlAt(me, 1)], b0 = ctrl[ctrlAt(me, 4)], b1 = ctrl[ctrlAt(me, 5)], c0 = ctrl[ctrlAt(me, 6)], c1 = ctrl[ctrlAt(me, 7)];
      const wrap = prm[nW] === 1, bw = prm[nW + 1], bh = prm[nW + 2], hw = prm[nW + 3], hh = prm[nW + 4], step = prm[nW + 5];
      let nc;
      bufZero(FXo, FYo, spPrev); // (what the last pass left in this buffer: then it is all zeros)
      bufSpans(q0, q1, b0, b1, c0, c1, pi, pj, prm, SPAN0 + 4 * me);
      for (let k = 0; k < 4; k++) spPrev[k] = prm[SPAN0 + 4 * me + k];
      if (wex && prm[nW + 7] === 1) { // the WebAssembly kernels (the main thread filled the descriptor before this order)
        nc = wex.af_forces(descOff, q0, q1, b0, b1, c0, c1, FXo.byteOffset, FYo.byteOffset, CQ.byteOffset, wrap ? 1 : 0, bw, bh, hw, hh, step, ksOff + 8 * me);
        prm[me] = ksArr[me];
      } else {
        _kStiff = 0;
        nc = pairKernel(pi, pj, ex, q0, q1, FXo, FYo, CQ, 0, wrap, bw, bh, hw, hh, step);
        nc = bondKernel(b0, b1, FXo, FYo, CQ, nc, wrap, bw, bh, hw, hh);
        angleKernel(c0, c1, FXo, FYo, wrap, bw, bh, hw, hh);
        prm[me] = _kStiff;
      }
      ctrl[ctrlAt(me, 2)] = nc;
      Atomics.store(ctrl, me, TH_DONE); Atomics.notify(ctrl, me);
    } else if (st === TH_SUM) { // sum every buffer onto the store's forces for this worker's slots, in buffer order
      bufSum(ctrl[ctrlAt(me, 0)], ctrl[ctrlAt(me, 1)], S.fx, S.fy, bufs, prm, SPAN0);
      Atomics.store(ctrl, me, TH_SUMMED); Atomics.notify(ctrl, me);
    } else if (st === TH_INTEG) {
      prm[nW + 32 + 3 * me] = integrateSlots(ctrl[ctrlAt(me, 0)], ctrl[ctrlAt(me, 1)], prm[nW + 6]);
      Atomics.store(ctrl, me, TH_INTEGD); Atomics.notify(ctrl, me);
    } else if (st === TH_VL) { // this worker's stretch of the neighbour list, from its range of the grid's occupied cells
      GV.cols = prm[nW + 14]; GV.rows = prm[nW + 15]; GV.wrap = prm[nW + 16] === 1; GV.mask = prm[nW + 17]; GV.shift = prm[nW + 18]; GV.RL2 = prm[nW + 19];
      const base = ctrl[ctrlAt(me, 4)], cap = ctrl[ctrlAt(me, 5)];
      ctrl[ctrlAt(me, 2)] = vlPairs(ctrl[ctrlAt(me, 0)], ctrl[ctrlAt(me, 1)], pi, pj, base, cap, GV, mdI, S.k, prm[nW] === 1, prm[nW + 1], prm[nW + 2], prm[nW + 3], prm[nW + 4]);
      Atomics.store(ctrl, me, TH_VLD); Atomics.notify(ctrl, me);
    } else if (st === TH_EX) { // the exclusion marks of this worker's range of pairs
      exRange(ctrl[ctrlAt(me, 0)], ctrl[ctrlAt(me, 1)], ex, pi, pj, S.k, S.Z, S.ne, S.mol, S.id, exl, exn, prm[nW + 20]);
      Atomics.store(ctrl, me, TH_EXD); Atomics.notify(ctrl, me);
    } else if (st === TH_DT) {
      dtSlots(ctrl[ctrlAt(me, 0)], ctrl[ctrlAt(me, 1)], prm, nW + 32 + 3 * me);
      Atomics.store(ctrl, me, TH_DTD); Atomics.notify(ctrl, me);
    } else if (st === TH_BATH) {
      prm[nW + 32 + 3 * me] = bathSlots(ctrl[ctrlAt(me, 0)], ctrl[ctrlAt(me, 1)], 0.5 * prm[nW + 6], prm[nW + 8], prm[nW + 9], prm[nW + 10], prm[nW + 11], prm[nW + 12], prm[nW + 13], prm[nW + 21], prm[nW + 22], prm[nW + 23]);
      Atomics.store(ctrl, me, TH_BATHD); Atomics.notify(ctrl, me);
    } else if (st === TH_DONE || st === TH_SUMMED || st === TH_INTEGD || st === TH_BATHD || st === TH_VLD || st === TH_EXD || st === TH_DTD) { waitFor(st); } // (the main thread has not reset us yet)
  }
};
`;
}
/* Start (or resize) the pool. want = 0 turns it off. The workers bind asynchronously; until they all acknowledge, the
   forces run on one thread. */
function threadsSet(want) {
  want = Math.max(0, Math.min(15, Math.floor(want || 0)));
  if (!threadsAvailable()) want = 0;
  TH.want = want;
  if (want === TH.n && TH.workers.length === want) return;
  for (const w of TH.workers) w.terminate();
  TH.workers = []; TH.n = want; TH.boundGen = -1; TH.ready = 0; TH.fx = []; TH.fy = []; TH.cq = []; TH.wasmOn = [];
  TH.state = want ? 'starting' : (threadsAvailable() ? 'off' : 'unavailable');
  if (!want) return;
  const url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
  TH.ctrl = new Int32Array(new SharedArrayBuffer(4 * (want + 10 * want + 8)));
  TH.prm = new Float64Array(new SharedArrayBuffer(8 * (8 * want + 32))); // (… then from nW + 32, three per worker: chooseDt's maxima; from 4·nW + 32, four per worker: its force buffer's intervals, bufSpans)
  for (let w = 0; w < want; w++) {
    const wk = new Worker(url);
    wk.onerror = (e) => { TH.note = 'worker error: ' + (e.message || e); console.warn('Atom Forge threads:', TH.note); threadsSet(0); };
    wk.onmessage = (e) => { if (e.data && e.data.type === 'kernel') TH.wasmOn[e.data.me] = e.data.wasm; };
    TH.workers.push(wk);
  }
}
/* Give the workers the current buffers (store, list, force buffers, queues). Asynchronous: each acknowledges in ctrl. */
function threadsBind() {
  const n = TH.n, gen = ++TH.gen;
  TH.boundGen = _sharedGen;
  const size = S.size, np = Math.max(VL.pi.length, 16);
  if (TH.fx.length !== n || (TH.fx[0] && TH.fx[0].length !== size)) {
    TH.fx = []; TH.fy = [];
    for (let w = 0; w < n; w++) { TH.fx.push(shArray(Float64Array, size)); TH.fy.push(shArray(Float64Array, size)); }
    if (WK.on) for (let w = 0; w < n; w++) { WK.sumTab[2 * w] = TH.fx[w].byteOffset; WK.sumTab[2 * w + 1] = TH.fy[w].byteOffset; } // (af_sum's table)
  }
  const need = 9 * Math.ceil((np + Math.max(BD.a.length, 16)) / (n + 1)) + 64;
  if (TH.cq.length !== n || TH.cq[0].length < need) { TH.cq = []; for (let w = 0; w < n; w++) TH.cq.push(shArray(Int32Array, need)); }
  const d = (a) => ({ t: a.constructor.name, b: WK.on ? null : a.buffer, off: a.byteOffset, len: a.length });
  const Sdesc = {}, ACd = {}, BDd = {};
  for (const k of S_ALL) Sdesc[k] = d(S[k]);
  for (const k of ['c', 'nb', 'cnt', 'tg']) ACd[k] = d(AC[k]);
  for (const k of ['a', 'b', 'r0', 'al', 'D', 'rb']) BDd[k] = d(BD[k]);
  const bufs = TH.fx.map((a, w) => [d(a), d(TH.fy[w])]);
  const Gd = {}; for (const k of ['keys', 'head', 'next', 'px', 'py', 'occ']) Gd[k] = d(G[k]);
  // the kernel module for the workers: each gets a stack of its own in the shared memory (allocated once)
  let wasm = null;
  if (WK.on && WK.ready) {
    if (!TH.wks) TH.wks = wasmArray(Float64Array, 16);
    while (TH.stacks.length < n) TH.stacks.push(wasmAlloc(WK.STACK) + WK.STACK); // (the stack grows downwards from its top)
    wasm = { module: WK.module, desc: WK.desc.byteOffset, ks: TH.wks.byteOffset, sumTab: WK.sumTab.byteOffset };
  }
  for (let w = 0; w < n; w++) {
    // a worker waiting on its word is woken to come back for the message; one not yet running just gets the message
    Atomics.store(TH.ctrl, thCtrl(w, 8), gen); // (what it should be bound to: one still in its binding handler sees it there)
    if (Atomics.load(TH.ctrl, w) === TH_IDLE) { Atomics.store(TH.ctrl, w, TH_REBIND); Atomics.notify(TH.ctrl, w); }
    TH.workers[w].postMessage({ type: 'bind', S: Sdesc, AC: ACd, BD: BDd, pi: d(VL.pi), pj: d(VL.pj), ex: d(VL.ex), bufs, cq: d(TH.cq[w]), ctrl: TH.ctrl.buffer, prm: TH.prm.buffer, me: w, nW: n, gen, G: Gd, mdI: d(_mdI), exl: d(_exl), exn: d(_exlN),
      mem: WK.on ? WK.mem : null, wasm: wasm ? Object.assign({ stackTop: TH.stacks[w] }, wasm) : null });
  }
}
function threadsReady() {
  if (!TH.n) return false;
  if (TH.boundGen !== _sharedGen || TH.gen === 0) threadsBind();
  for (let w = 0; w < TH.n; w++) if (Atomics.load(TH.ctrl, thCtrl(w, 3)) !== TH.gen) { TH.state = 'starting'; return false; }
  TH.state = 'on';
  return true;
}
/* The nucleus pair forces on all threads: replaces engine.js's one-thread nucleusPairs when the pool is up. */
const nucleusPairs1 = nucleusPairs;
nucleusPairs = function (wrap, bw, bh, hw, hh) {
  const np = VL.np;
  if (!TH.n || np < TH.minPairs * (TH.n + 1)) { TH.used = 0; nucleusPairs1(wrap, bw, bh, hw, hh); return; }
  bondArrays(); angleCentres(); // (before the readiness check: they may grow the shared arrays)
  if (!threadsReady()) { TH.used = 0; nucleusPairs1(wrap, bw, bh, hw, hh); return; }
  const t0 = performance.now(), n = TH.n, ctrl = TH.ctrl, prm = TH.prm, nb = BD.n, na = AC.n;
  const wk = wasmReady();
  if (wk) wasmDesc(); // (the workers read the descriptor too: before they are sent off)
  prm[n] = wrap ? 1 : 0; prm[n + 1] = bw; prm[n + 2] = bh; prm[n + 3] = hw; prm[n + 4] = hh; prm[n + 5] = W.step; prm[n + 7] = wk ? 1 : 0; prm[n + 24] = S.hi;
  // pairs, bonds and angle centres shared out: the workers' ranges first, a half share for the main thread last (it also
  // dispatches, and must not be the one the others wait for)
  const per = Math.ceil(np / (n + 0.5)), bper = Math.ceil(nb / (n + 0.5)), aper = Math.ceil(na / (n + 0.5));
  for (let w = 0; w < n; w++) {
    ctrl[thCtrl(w, 0)] = Math.min(np, w * per); ctrl[thCtrl(w, 1)] = Math.min(np, (w + 1) * per);
    ctrl[thCtrl(w, 4)] = Math.min(nb, w * bper); ctrl[thCtrl(w, 5)] = Math.min(nb, (w + 1) * bper);
    ctrl[thCtrl(w, 6)] = Math.min(na, w * aper); ctrl[thCtrl(w, 7)] = Math.min(na, (w + 1) * aper);
    Atomics.store(ctrl, w, TH_PAIRS); Atomics.notify(ctrl, w);
  }
  const CQ = candidateRoom(per + bper);
  _kStiff = 0;
  let nc0;
  if (wk) nc0 = wasmForces(Math.min(np, n * per), np, Math.min(nb, n * bper), nb, Math.min(na, n * aper), na, S.fx, S.fy, CQ, wrap, bw, bh, hw, hh, W.step);
  else {
    nc0 = pairKernel(VL.pi, VL.pj, VL.ex, Math.min(np, n * per), np, S.fx, S.fy, CQ, 0, wrap, bw, bh, hw, hh, W.step);
    nc0 = bondKernel(Math.min(nb, n * bper), nb, S.fx, S.fy, CQ, nc0, wrap, bw, bh, hw, hh);
    angleKernel(Math.min(na, n * aper), na, S.fx, S.fy, wrap, bw, bh, hw, hh);
  }
  let stiff = _kStiff; _kStiff = 0;
  const t1 = performance.now();
  for (let w = 0; w < n; w++) { while (Atomics.load(ctrl, w) !== TH_DONE) { /* spin */ } }
  const t2 = performance.now();
  thPh('pairs', t0, t1, t2);
  // reduction: every slot's forces summed over the buffers in order, the slots shared out over all threads
  const hi = S.hi, sper = Math.ceil(hi / (n + 1));
  for (let w = 0; w < n; w++) {
    ctrl[thCtrl(w, 0)] = Math.min(hi, w * sper); ctrl[thCtrl(w, 1)] = Math.min(hi, (w + 1) * sper);
    Atomics.store(ctrl, w, TH_SUM); Atomics.notify(ctrl, w);
  }
  if (!TH.bufs || TH.bufs.length !== n || TH.bufs[0][0] !== TH.fx[0]) TH.bufs = TH.fx.map((a, w) => [a, TH.fy[w]]);
  bufSum(Math.min(hi, n * sper), hi, S.fx, S.fy, TH.bufs, prm, 4 * n + 32);
  const t3 = performance.now();
  for (let w = 0; w < n; w++) { while (Atomics.load(ctrl, w) !== TH_SUMMED) { /* spin */ } Atomics.store(ctrl, w, TH_IDLE); if (prm[w] > stiff) stiff = prm[w]; }
  thPh('sum', t2, t3, performance.now());
  if (stiff > _stiff) _stiff = stiff;
  // the candidates, in list order: the workers' ranges came first
  for (let w = 0; w < n; w++) evalCandidates(TH.cq[w], ctrl[thCtrl(w, 2)]);
  evalCandidates(CQ, nc0);
  TH.used = n + 1; TH.lastMs = performance.now() - t0; TH.tKernel = t1 - t0; TH.tWait = t2 - t1; TH.tRest = TH.lastMs - (t2 - t0); // (the main thread's share, the wait for the workers, the reduction and events)
  TH_LAST.used = n + 1; TH_LAST.ms = TH.lastMs; TH_LAST.wait = TH.tWait;
};
/* A nudge at the start of a step: a worker asleep on its word wakes and spins, so the step's passes find it awake. */
threadsPrewake = function () {
  if (!TH.n || TH.used < 2) return;
  const ctrl = TH.ctrl;
  for (let w = 0; w < TH.n; w++) if (Atomics.load(ctrl, w) === TH_IDLE) Atomics.notify(ctrl, w);
};
/* outerA + drift on all threads in the plain case (threads.js's integrateSlots); false when the engine must do it itself. */
integrateA = function (dt) {
  if (!TH.n || !integrateAPlain(dt) || S.hi < 2000 || !threadsReady()) return false;
  const n = TH.n, ctrl = TH.ctrl, hi = S.hi, per = Math.ceil(hi / (n + 0.5));
  TH.prm[n + 6] = dt;
  for (let w = 0; w < n; w++) {
    ctrl[thCtrl(w, 0)] = Math.min(hi, w * per); ctrl[thCtrl(w, 1)] = Math.min(hi, (w + 1) * per);
    Atomics.store(ctrl, w, TH_INTEG); Atomics.notify(ctrl, w);
  }
  const t0 = _profOn ? performance.now() : 0;
  let worst = integrateSlots(Math.min(hi, n * per), hi, dt);
  const t1 = _profOn ? performance.now() : 0;
  for (let w = 0; w < n; w++) { while (Atomics.load(ctrl, w) !== TH_INTEGD) { /* spin */ } Atomics.store(ctrl, w, TH_IDLE); const v = TH.prm[n + 32 + 3 * w]; if (v > worst) worst = v; }
  thPh('integ', t0, t1, _profOn ? performance.now() : 0);
  _intTok = true; _intHi = hi; _intWorst = worst; // (for the force pass that follows: outerForces)
  return true;
};
/* The neighbour list on all threads: the occupied cells shared out, each thread writing its own stretch of the pair
   arrays, the stretches then closed up in order (so the list is the one-thread list, pair for pair). Returns the number
   of pairs, or -1 when the pool is not up, or a stretch ran out of room (the arrays are grown; the engine builds it). */
vlBuildAll = function () {
  const nocc = G.nocc;
  if (!TH.n || nocc < 64 * (TH.n + 1)) { TH.vlNote = 'few cells'; return -1; }
  if (!threadsReady()) { TH.vlNote = 'not ready'; return -1; }
  const n = TH.n, ctrl = TH.ctrl, prm = TH.prm, cap = VL.pi.length, per = Math.floor(cap / (n + 1)), oper = Math.ceil(nocc / (n + 1));
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2;
  prm[n] = wrap ? 1 : 0; prm[n + 1] = bw; prm[n + 2] = bh; prm[n + 3] = hw; prm[n + 4] = hh;
  prm[n + 14] = G.cols; prm[n + 15] = G.rows; prm[n + 16] = G.wrap ? 1 : 0; prm[n + 17] = G.mask; prm[n + 18] = G.shift; prm[n + 19] = RL2;
  for (let w = 0; w < n; w++) {
    ctrl[thCtrl(w, 0)] = Math.min(nocc, w * oper); ctrl[thCtrl(w, 1)] = Math.min(nocc, (w + 1) * oper); ctrl[thCtrl(w, 4)] = w * per; ctrl[thCtrl(w, 5)] = per;
    Atomics.store(ctrl, w, TH_VL); Atomics.notify(ctrl, w);
  }
  const t0 = performance.now();
  const mine = vlPairs(Math.min(nocc, n * oper), nocc, VL.pi, VL.pj, n * per, cap - n * per, G, _mdI, S.k, wrap, bw, bh, hw, hh);
  let short = mine < 0, np = 0;
  for (let w = 0; w < n; w++) { while (Atomics.load(ctrl, w) !== TH_VLD) { /* spin */ } Atomics.store(ctrl, w, TH_IDLE); if (ctrl[thCtrl(w, 2)] < 0) short = true; }
  if (short) { TH.vlNote = 'short'; vlRoom(cap * 2 + _nmd); return -1; }
  TH.vlNote = 'ok';
  const pi = VL.pi, pj = VL.pj;
  for (let w = 0; w < n; w++) { // close the stretches up, in order
    const cnt = ctrl[thCtrl(w, 2)], src = w * per;
    if (src !== np) { pi.copyWithin(np, src, src + cnt); pj.copyWithin(np, src, src + cnt); }
    np += cnt;
  }
  if (n * per !== np) { pi.copyWithin(np, n * per, n * per + mine); pj.copyWithin(np, n * per, n * per + mine); }
  np += mine;
  TH.vlMs = performance.now() - t0; TH.vlBuilds = (TH.vlBuilds || 0) + 1;
  return np;
};
/* The exclusion marks on all threads (exRange over ranges of the list); false when the engine must do it itself. */
exAll = function () {
  const np = VL.np;
  if (!TH.n || np < 4096 * (TH.n + 1) || !threadsReady()) return false;
  const n = TH.n, ctrl = TH.ctrl, prm = TH.prm, per = Math.ceil(np / (n + 0.5));
  prm[n + 20] = EXW;
  for (let w = 0; w < n; w++) {
    ctrl[thCtrl(w, 0)] = Math.min(np, w * per); ctrl[thCtrl(w, 1)] = Math.min(np, (w + 1) * per);
    Atomics.store(ctrl, w, TH_EX); Atomics.notify(ctrl, w);
  }
  exRange(Math.min(np, n * per), np, VL.ex, VL.pi, VL.pj, S.k, S.Z, S.ne, S.mol, S.id, _exl, _exlN, EXW);
  for (let w = 0; w < n; w++) { while (Atomics.load(ctrl, w) !== TH_EXD) { /* spin */ } Atomics.store(ctrl, w, TH_IDLE); }
  return true;
};
/* Where the threaded phases' time goes (the benchmark shows it): per phase, the main thread's own share and its wait for
   the workers, in ms, summed while the profile is on. */
const TH_PH = { integ: [0, 0, 0], bath: [0, 0, 0], dt: [0, 0, 0], pairs: [0, 0, 0], sum: [0, 0, 0], vl: [0, 0, 0], ex: [0, 0, 0] }; // [own, wait, calls]
function thPh(name, t0, t1, t2) { if (!PROF.on) return; const a = TH_PH[name]; a[0] += t1 - t0; a[1] += t2 - t1; a[2]++; }
function thPhReset() { for (const k in TH_PH) TH_PH[k].fill(0); }
/* chooseDt's maxima on all threads; false when the engine must do it itself. */
dtAll = function (out) {
  if (!TH.n || S.hi < 2000 || !threadsReady()) return false;
  const n = TH.n, ctrl = TH.ctrl, prm = TH.prm, hi = S.hi, per = Math.ceil(hi / (n + 0.5)), t0 = PROF.on ? performance.now() : 0;
  for (let w = 0; w < n; w++) {
    ctrl[thCtrl(w, 0)] = Math.min(hi, w * per); ctrl[thCtrl(w, 1)] = Math.min(hi, (w + 1) * per);
    Atomics.store(ctrl, w, TH_DT); Atomics.notify(ctrl, w);
  }
  dtSlots(Math.min(hi, n * per), hi, out, 0);
  const t1 = PROF.on ? performance.now() : 0;
  for (let w = 0; w < n; w++) {
    while (Atomics.load(ctrl, w) !== TH_DTD) { /* spin */ }
    Atomics.store(ctrl, w, TH_IDLE);
    const o = n + 32 + 3 * w; if (prm[o] > out[0]) out[0] = prm[o]; if (prm[o + 1] > out[1]) out[1] = prm[o + 1]; if (prm[o + 2] > out[2]) out[2] = prm[o + 2];
  }
  thPh('dt', t0, t1, PROF.on ? performance.now() : 0);
  return true;
};
/* outerB on all threads in the plain case (bathSlots); false when the engine must do it itself. */
bathAll = function (dt, c1, c2, kT, hw, hh, vf2) {
  if (!TH.n || S.hi < 2000 || !threadsReady()) return -1;
  const n = TH.n, ctrl = TH.ctrl, prm = TH.prm, hi = S.hi, per = Math.ceil(hi / (n + 0.5));
  prm[n + 6] = dt; prm[n + 8] = c1; prm[n + 9] = c2; prm[n + 10] = kT; prm[n + 11] = W.gamma; prm[n + 12] = W.bathSeed; prm[n + 13] = W.step; prm[n + 21] = hw; prm[n + 22] = hh; prm[n + 23] = vf2;
  for (let w = 0; w < n; w++) {
    ctrl[thCtrl(w, 0)] = Math.min(hi, w * per); ctrl[thCtrl(w, 1)] = Math.min(hi, (w + 1) * per);
    Atomics.store(ctrl, w, TH_BATH); Atomics.notify(ctrl, w);
  }
  const t0 = _profOn ? performance.now() : 0;
  let need = bathSlots(Math.min(hi, n * per), hi, 0.5 * dt, c1, c2, kT, W.gamma, W.bathSeed, W.step, hw, hh, vf2);
  const t1 = _profOn ? performance.now() : 0;
  for (let w = 0; w < n; w++) { while (Atomics.load(ctrl, w) !== TH_BATHD) { /* spin */ } Atomics.store(ctrl, w, TH_IDLE); need += prm[n + 32 + 3 * w]; }
  thPh('bath', t0, t1, _profOn ? performance.now() : 0);
  return hw >= 0 ? need : 0;
};
if (typeof module !== 'undefined') module.exports = { TH, threadsSet, threadsAvailable, threadsDefault };
