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
  minPairs: 1500, used: 0, lastMs: 0, state: 'off', note: '' };
const TH_IDLE = 0, TH_PAIRS = 1, TH_DONE = 2, TH_REBIND = 3, TH_SUM = 4, TH_SUMMED = 5, TH_INTEG = 6, TH_INTEGD = 7;
// control layout: [0, n) worker states; then 8 per worker: pair range (2), candidate count, ack, bond range (2), angle range (2); prm: per worker stiffness, then the box
function thCtrl(w, k) { return TH.n + 8 * w + k; }
/* outerA + the plain drift for slots s0 ≤ s < s1 (the same arithmetic as engine.js's outerA and innerSteps, elementwise). */
function integrateSlots(s0, s1, dt) {
  const h = 0.5 * dt, DEAD = S.dead, RAD = S.rad, K = S.k, Z = S.Z, FAST = S.fast, VX = S.vx, VY = S.vy, FX = S.fx, FY = S.fy, GX = S.gx, GY = S.gy, IM = S.im;
  const X = S.x, Y = S.y, OX = S.ox, OY = S.oy, FRESH = S.fresh, BALL = S.ballistic;
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
  }
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
let pi, pj, ex, FXo, FYo, CQ, ctrl, prm, me, nW, bufs;
const TH_IDLE = 0, TH_PAIRS = 1, TH_DONE = 2, TH_REBIND = 3, TH_SUM = 4, TH_SUMMED = 5, TH_INTEG = 6, TH_INTEGD = 7;
function ctrlAt(w, k) { return nW + 8 * w + k; }
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'bind') {
    S = {}; for (const k in m.S) S[k] = new self[m.S[k].t](m.S[k].b);
    pi = new Int32Array(m.pi); pj = new Int32Array(m.pj); ex = new Uint8Array(m.ex);
    AC = {}; for (const k in m.AC) AC[k] = new self[m.AC[k].t](m.AC[k].b);
    BD = {}; for (const k in m.BD) BD[k] = new self[m.BD[k].t](m.BD[k].b);
    bufs = m.bufs.map(b => [new Float64Array(b[0]), new Float64Array(b[1])]);
    me = m.me; nW = m.nW; FXo = bufs[me][0]; FYo = bufs[me][1];
    CQ = new Int32Array(m.cq); ctrl = new Int32Array(m.ctrl); prm = new Float64Array(m.prm);
    Atomics.store(ctrl, me, TH_IDLE); // (a rebind request left on our word is served by this message)
    Atomics.store(ctrl, ctrlAt(me, 3), m.gen); // bound: the acknowledgement
  }
  const SPIN_MS = 1.0; // a worker looks for the next order this long before it sleeps: a step's passes come well within it
  const waitFor = (notValue) => { const t0 = performance.now(); while (Atomics.load(ctrl, me) === notValue) { if (performance.now() - t0 > SPIN_MS) { Atomics.wait(ctrl, me, notValue); break; } } };
  for (;;) {
    waitFor(TH_IDLE);
    const st = Atomics.load(ctrl, me);
    if (st === TH_REBIND) { Atomics.store(ctrl, me, TH_IDLE); return; } // new buffers coming by message: back to the event loop
    if (st === TH_PAIRS) {
      const q0 = ctrl[ctrlAt(me, 0)], q1 = ctrl[ctrlAt(me, 1)], b0 = ctrl[ctrlAt(me, 4)], b1 = ctrl[ctrlAt(me, 5)], c0 = ctrl[ctrlAt(me, 6)], c1 = ctrl[ctrlAt(me, 7)];
      const wrap = prm[nW] === 1, bw = prm[nW + 1], bh = prm[nW + 2], hw = prm[nW + 3], hh = prm[nW + 4], step = prm[nW + 5];
      FXo.fill(0); FYo.fill(0); _kStiff = 0;
      let nc = pairKernel(pi, pj, ex, q0, q1, FXo, FYo, CQ, 0, wrap, bw, bh, hw, hh, step);
      nc = bondKernel(b0, b1, FXo, FYo, CQ, nc, wrap, bw, bh, hw, hh);
      angleKernel(c0, c1, FXo, FYo, wrap, bw, bh, hw, hh);
      ctrl[ctrlAt(me, 2)] = nc; prm[me] = _kStiff;
      Atomics.store(ctrl, me, TH_DONE); Atomics.notify(ctrl, me);
    } else if (st === TH_SUM) { // sum every buffer onto the store's forces for this worker's slots, in buffer order
      const s0 = ctrl[ctrlAt(me, 0)], s1 = ctrl[ctrlAt(me, 1)], FX = S.fx, FY = S.fy, nb = bufs.length;
      for (let s = s0; s < s1; s++) {
        let fx = FX[s], fy = FY[s];
        for (let b = 0; b < nb; b++) { fx += bufs[b][0][s]; fy += bufs[b][1][s]; }
        FX[s] = fx; FY[s] = fy;
      }
      Atomics.store(ctrl, me, TH_SUMMED); Atomics.notify(ctrl, me);
    } else if (st === TH_INTEG) {
      integrateSlots(ctrl[ctrlAt(me, 0)], ctrl[ctrlAt(me, 1)], prm[nW + 6]);
      Atomics.store(ctrl, me, TH_INTEGD); Atomics.notify(ctrl, me);
    } else if (st === TH_DONE || st === TH_SUMMED || st === TH_INTEGD) { waitFor(st); } // (the main thread has not reset us yet)
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
  TH.workers = []; TH.n = want; TH.boundGen = -1; TH.ready = 0; TH.fx = []; TH.fy = []; TH.cq = [];
  TH.state = want ? 'starting' : (threadsAvailable() ? 'off' : 'unavailable');
  if (!want) return;
  const url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
  TH.ctrl = new Int32Array(new SharedArrayBuffer(4 * (want + 8 * want + 8)));
  TH.prm = new Float64Array(new SharedArrayBuffer(8 * (want + 8)));
  for (let w = 0; w < want; w++) {
    const wk = new Worker(url);
    wk.onerror = (e) => { TH.note = 'worker error: ' + (e.message || e); console.warn('Atom Forge threads:', TH.note); threadsSet(0); };
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
    for (let w = 0; w < n; w++) { TH.fx.push(new Float64Array(new SharedArrayBuffer(8 * size))); TH.fy.push(new Float64Array(new SharedArrayBuffer(8 * size))); }
  }
  const need = 9 * Math.ceil((np + Math.max(BD.a.length, 16)) / (n + 1)) + 64;
  if (TH.cq.length !== n || TH.cq[0].length < need) { TH.cq = []; for (let w = 0; w < n; w++) TH.cq.push(new Int32Array(new SharedArrayBuffer(4 * need))); }
  const Sdesc = {}, ACd = {}, BDd = {};
  for (const k of S_ALL) Sdesc[k] = { t: S[k].constructor.name, b: S[k].buffer };
  for (const k of ['c', 'nb', 'cnt', 'tg']) ACd[k] = { t: AC[k].constructor.name, b: AC[k].buffer };
  for (const k of ['a', 'b', 'r0', 'al', 'D', 'rb']) BDd[k] = { t: BD[k].constructor.name, b: BD[k].buffer };
  const bufs = TH.fx.map((a, w) => [a.buffer, TH.fy[w].buffer]);
  for (let w = 0; w < n; w++) {
    // a worker waiting on its word is woken to come back for the message; one not yet running just gets the message
    if (Atomics.load(TH.ctrl, w) === TH_IDLE) { Atomics.store(TH.ctrl, w, TH_REBIND); Atomics.notify(TH.ctrl, w); }
    TH.workers[w].postMessage({ type: 'bind', S: Sdesc, AC: ACd, BD: BDd, pi: VL.pi.buffer, pj: VL.pj.buffer, ex: VL.ex.buffer, bufs, cq: TH.cq[w].buffer, ctrl: TH.ctrl.buffer, prm: TH.prm.buffer, me: w, nW: n, gen });
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
  prm[n] = wrap ? 1 : 0; prm[n + 1] = bw; prm[n + 2] = bh; prm[n + 3] = hw; prm[n + 4] = hh; prm[n + 5] = W.step;
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
  let nc0 = pairKernel(VL.pi, VL.pj, VL.ex, Math.min(np, n * per), np, S.fx, S.fy, CQ, 0, wrap, bw, bh, hw, hh, W.step);
  nc0 = bondKernel(Math.min(nb, n * bper), nb, S.fx, S.fy, CQ, nc0, wrap, bw, bh, hw, hh);
  angleKernel(Math.min(na, n * aper), na, S.fx, S.fy, wrap, bw, bh, hw, hh);
  let stiff = _kStiff; _kStiff = 0;
  const t1 = performance.now();
  for (let w = 0; w < n; w++) { while (Atomics.load(ctrl, w) !== TH_DONE) { /* spin */ } }
  const t2 = performance.now();
  // reduction: every slot's forces summed over the buffers in order, the slots shared out over all threads
  const hi = S.hi, sper = Math.ceil(hi / (n + 1));
  for (let w = 0; w < n; w++) {
    ctrl[thCtrl(w, 0)] = Math.min(hi, w * sper); ctrl[thCtrl(w, 1)] = Math.min(hi, (w + 1) * sper);
    Atomics.store(ctrl, w, TH_SUM); Atomics.notify(ctrl, w);
  }
  { const FX = S.fx, FY = S.fy, fxs = TH.fx, fys = TH.fy;
    for (let s = Math.min(hi, n * sper); s < hi; s++) { let fx = FX[s], fy = FY[s]; for (let b = 0; b < n; b++) { fx += fxs[b][s]; fy += fys[b][s]; } FX[s] = fx; FY[s] = fy; } }
  for (let w = 0; w < n; w++) { while (Atomics.load(ctrl, w) !== TH_SUMMED) { /* spin */ } Atomics.store(ctrl, w, TH_IDLE); if (prm[w] > stiff) stiff = prm[w]; }
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
  integrateSlots(Math.min(hi, n * per), hi, dt);
  for (let w = 0; w < n; w++) { while (Atomics.load(ctrl, w) !== TH_INTEGD) { /* spin */ } Atomics.store(ctrl, w, TH_IDLE); }
  return true;
};
if (typeof module !== 'undefined') module.exports = { TH, threadsSet, threadsAvailable, threadsDefault };
