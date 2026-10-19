'use strict';
/* ============================================================================
   Atom Forge — the WebAssembly kernel (kernel/src/lib.rs) and the memory it works on
   The nucleus pair, bond and angle force kernels exist twice: in JavaScript (engine.js, PAIR KERNEL block) and in Rust
   compiled to WebAssembly (kernel/, built by GitHub Actions into src/wasm/kernel.wasm, embedded by build.js as
   KERNEL_WASM_B64). The two do the same arithmetic in the same order and agree to floating-point rounding
   (tests/t_wasm.js). The WebAssembly one is used when it can be: it needs the arrays it reads to live in its own
   memory, so when the module is available the particle store, the neighbour list, the bond and angle arrays, the
   force buffers and the candidate queues are all carved out of one shared WebAssembly.Memory by a bump allocator
   (wasmArray, through engine.js's shArray). Growing the memory keeps every existing view valid (it is shared), and
   the arrays that grow are reallocated at the top as before. The worker threads (threads.js) instantiate the same
   module on the same memory, each with a stack of its own.
   A page without shared memory (not cross-origin isolated: no worker threads either) gets the same kernels from a second
   build of the module on an ordinary memory (kernel-plain.wasm, KERNEL_PLAIN_WASM_B64). An ordinary memory cannot grow
   without detaching every view of it, so it is made its full size at the start (WK.PLAIN_PAGES); should the arena ever
   fill, the kernel is given up for the rest of the session (the JavaScript kernels take over, the views already made stay
   valid). Without any module (no WebAssembly, a build without the .wasm, or the memory refused) nothing changes: plain
   SharedArrayBuffer or ordinary typed arrays, and the JavaScript kernels.
   ========================================================================== */
/* Typed arrays the worker threads must see (the store, the neighbour list) are made on SharedArrayBuffers where the page
   can have workers at all; elsewhere (a page that is not cross-origin isolated) they are ordinary arrays. */
const SHARED_OK = typeof SharedArrayBuffer !== 'undefined' && typeof Worker !== 'undefined' && (typeof crossOriginIsolated === 'undefined' || crossOriginIsolated);
const WK = { on: false, use: true, ready: false, mem: null, module: null, inst: null, ex: null, top: 0, desc: null, ks: null, sumTab: null,
  note: '', bytes: null, grows: 0, allocs: 0, ARENA0: 4 << 20, STACK: 1 << 20, MAX_PAGES: 16384, calls: 0, plain: false, PLAIN_PAGES: 2048, useFast: true, ft: null, fks: null, fc: null, fcr: null, fastCalls: 0 }; // (plain: an ordinary memory of PLAIN_PAGES × 64 KB = 128 MB, never grown)
const WK_PAGE = 65536;
/* Base64 to bytes (no atob in every worker-less environment; this is small and runs once). */
function wasmBytes(b64) {
  const B = globalThis.Buffer; // (Node: no atob needed)
  if (B) return new Uint8Array(B.from(b64, 'base64'));
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
/* The memory: made before the store is allocated (engine.js), the module compiled after (asynchronously in a page). */
function wasmMemoryInit() {
  const sharedMem = typeof SharedArrayBuffer !== 'undefined' && (typeof crossOriginIsolated === 'undefined' || crossOriginIsolated); // (Node has it; a page needs isolation)
  if (typeof WebAssembly === 'undefined') { WK.note = 'no WebAssembly'; return; }
  const plainB64 = typeof KERNEL_PLAIN_WASM_B64 === 'string' ? KERNEL_PLAIN_WASM_B64 : '';
  const forcePlain = !!globalThis.WK_FORCE_PLAIN; // (tests: the plain path where shared memory is available)
  try {
    if (sharedMem && !forcePlain) {
      if (typeof KERNEL_WASM_B64 !== 'string' || !KERNEL_WASM_B64) { WK.note = 'no module'; return; }
      WK.bytes = wasmBytes(KERNEL_WASM_B64);
      WK.mem = new WebAssembly.Memory({ initial: 256, maximum: WK.MAX_PAGES, shared: true }); // 16 MB to start, grown as needed
    } else {
      if (!plainB64) { WK.note = sharedMem ? 'no plain module' : 'no shared memory, and no plain module'; return; }
      WK.bytes = wasmBytes(plainB64);
      WK.mem = new WebAssembly.Memory({ initial: WK.PLAIN_PAGES, maximum: WK.PLAIN_PAGES }); // its full size at once: it must never grow
      WK.plain = true;
    }
    WK.top = WK.ARENA0;
    WK.on = true;
  } catch (e) { WK.note = 'memory: ' + (e.message || e); WK.on = false; WK.mem = null; WK.plain = false; }
}
/* Room in the memory for n bytes, 8-aligned, growing it when needed (a quarter more than asked, so growth is rare). */
function wasmAlloc(bytes) {
  const off = WK.top, end = off + ((bytes + 7) & ~7);
  if (end > WK.mem.buffer.byteLength) {
    if (WK.plain) return -1; // (an ordinary memory cannot grow without detaching every view: the caller falls back)
    const need = Math.ceil((end - WK.mem.buffer.byteLength) * 1.25 / WK_PAGE) + 1;
    if (WK.mem.buffer.byteLength / WK_PAGE + need > WK.MAX_PAGES) throw new Error('Atom Forge: the WebAssembly memory is full');
    WK.mem.grow(need); WK.grows++;
  }
  WK.top = end; WK.allocs++;
  return off;
}
function wasmArray(T, n) { // (allocate first: a shared memory may grow, and the buffer object is refreshed by the growth)
  const off = wasmAlloc(n * T.BYTES_PER_ELEMENT);
  if (off < 0) { WK.on = false; WK.ready = false; WK.use = false; WK.note = 'the plain memory filled up: JavaScript kernels from here on'; return new T(n); } // (the views already made stay valid; the kernels are given up)
  return new T(WK.mem.buffer, off, n);
}
/* The compiled module: synchronously where that is allowed (Node, a worker), otherwise compiled in the background;
   until it is ready the JavaScript kernels run. */
function wasmLoadModule() {
  if (!WK.on) return;
  const pr = globalThis.process, isNode = !!(pr && pr.versions && pr.versions.node);
  try {
    if (isNode) { WK.module = new WebAssembly.Module(WK.bytes); wasmInstantiate(); }
    else WebAssembly.compile(WK.bytes).then((m) => { WK.module = m; wasmInstantiate(); }, (e) => { WK.note = 'compile: ' + (e.message || e); WK.on = false; });
  } catch (e) { WK.note = 'compile: ' + (e.message || e); WK.on = false; }
}
function wasmInstantiate() {
  try {
    WK.inst = new WebAssembly.Instance(WK.module, { env: { memory: WK.mem } });
    const ex = WK.ex = WK.inst.exports;
    if (typeof ex.af_forces !== 'function' || typeof ex.af_const !== 'function' || typeof ex.af_zero !== 'function' || typeof ex.af_sum !== 'function') throw new Error('exports missing');
    if (ex.__heap_base && ex.__heap_base.value > WK.ARENA0) throw new Error('the module\'s static data reaches ' + ex.__heap_base.value + ', above the arena');
    const want = [PHYS.KE, RC2, FCAP, CORE_RMIN, BARE_SMEAR, R_ANN, ANGLE_K, 40];
    for (let k = 0; k < want.length; k++) if (ex.af_const(k) !== want[k]) throw new Error('constant ' + k + ' differs: ' + ex.af_const(k) + ' vs ' + want[k]);
    WK.desc = wasmArray(Int32Array, 64); WK.ks = wasmArray(Float64Array, 8); WK.sumTab = wasmArray(Uint32Array, 64);
    WK.ready = true; WK.note = 'ready';
  } catch (e) { WK.note = 'instantiate: ' + (e.message || e); WK.ready = false; WK.inst = null; WK.ex = null; }
}
/* The descriptor: where every array the kernels read is right now (they are reallocated when they grow). Filled
   before each force pass; the workers read the same table. */
function wasmDesc() {
  const d = WK.desc;
  d[0] = S.x.byteOffset; d[1] = S.y.byteOffset; d[2] = S.vx.byteOffset; d[3] = S.vy.byteOffset; d[4] = S.m.byteOffset; d[5] = S.im.byteOffset;
  d[6] = S.q.byteOffset; d[7] = S.qp.byteOffset; d[8] = S.ljR.byteOffset; d[9] = S.ljS.byteOffset; d[10] = S.ionR.byteOffset; d[11] = S.elrc.byteOffset;
  d[12] = S.mR.byteOffset; d[13] = S.mD.byteOffset;
  d[14] = S.Z.byteOffset; d[15] = S.ne.byteOffset; d[16] = S.cap.byteOffset; d[17] = S.used.byteOffset; d[18] = S.lp.byteOffset;
  d[19] = S.ionic.byteOffset; d[20] = S.isMetal.byteOffset; d[21] = S.anti.byteOffset; d[22] = S.xferD.byteOffset; d[23] = S.xferA.byteOffset; d[24] = S.metal.byteOffset;
  d[25] = S.mol.byteOffset; d[26] = S.id.byteOffset;
  d[27] = VL.pi.byteOffset; d[28] = VL.pj.byteOffset; d[29] = VL.ex.byteOffset;
  d[30] = BD.a.byteOffset; d[31] = BD.b.byteOffset; d[32] = BD.r0.byteOffset; d[33] = BD.al.byteOffset; d[34] = BD.D.byteOffset; d[35] = BD.rb.byteOffset;
  d[36] = AC.c.byteOffset; d[37] = AC.nb.byteOffset; d[38] = AC.cnt.byteOffset; d[39] = AC.tg.byteOffset;
}
function wasmReady() { return WK.ready && WK.use; }
/* The free leptons' kernel (af_fast, from V36 on: an older module has none and the JavaScript runs): its table of
   offsets, candidate buffers and stiffness cell, made once; the lists it reads must be in the module's memory. */
function wasmFastReady() {
  if (!wasmReady() || !WK.useFast || typeof WK.ex.af_fast !== 'function') return false;
  if (!WK.ft) { WK.ft = wasmArray(Int32Array, 16); WK.fks = wasmArray(Float64Array, 1); if (!WK.on) return false; } // (a full memory gives the kernels up: the JavaScript runs)
  const need = 3 * (FL.na + FL.nl + 8);
  if (!WK.fc || WK.fc.length < need) { WK.fc = wasmArray(Int32Array, need * 2); WK.fcr = wasmArray(Float64Array, need); if (!WK.on) return false; }
  const mem = WK.mem.buffer;
  return FL.la.buffer === mem && FL.lb.buffer === mem && FL.li.buffer === mem && FL.lj.buffer === mem && _mdLI.buffer === mem && _chI.buffer === mem;
}
function wasmFast(na, nl, nmdl, nch, lrOn, wrap, bw, bh, hw, hh, evOn) {
  const t = WK.ft;
  t[0] = S.k.byteOffset; t[1] = S.dead.byteOffset; t[2] = S.fast.byteOffset; t[3] = S.rad.byteOffset; t[4] = S.sEN.byteOffset;
  t[5] = S.gx.byteOffset; t[6] = S.gy.byteOffset; t[7] = S.nearIon.byteOffset; t[8] = S.hit.byteOffset;
  t[9] = FL.la.byteOffset; t[10] = FL.lb.byteOffset; t[11] = FL.li.byteOffset; t[12] = FL.lj.byteOffset; t[13] = _mdLI.byteOffset; t[14] = _chI.byteOffset;
  wasmDesc();
  WK.fks[0] = _stiffL;
  const nc = WK.ex.af_fast(WK.desc.byteOffset, t.byteOffset, na, nl, nmdl, nch, lrOn ? 1 : 0, wrap ? 1 : 0, bw, bh, hw, hh, evOn ? 1 : 0, WK.fc.byteOffset, WK.fcr.byteOffset, WK.fks.byteOffset);
  _stiffL = WK.fks[0]; WK.fastCalls++;
  return nc;
}
/* One force pass over the given ranges on this thread (the descriptor must be current): forces into FXo/FYo,
   candidates into CQ, the stiffest contact into _kStiff. Returns the number of candidate entries. */
function wasmForces(q0, q1, b0, b1, c0, c1, FXo, FYo, CQ, wrap, bw, bh, hw, hh, step) {
  const nc = WK.ex.af_forces(WK.desc.byteOffset, q0, q1, b0, b1, c0, c1, FXo.byteOffset, FYo.byteOffset, CQ.byteOffset, wrap ? 1 : 0, bw, bh, hw, hh, step, WK.ks.byteOffset);
  _kStiff = WK.ks[0]; WK.calls++;
  return nc;
}
wasmMemoryInit();
if (typeof module !== 'undefined') module.exports = { WK, SHARED_OK, wasmArray, wasmAlloc };
