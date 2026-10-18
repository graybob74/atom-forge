'use strict';
/* ============================================================================
   Atom Forge — simulation engine
   Classical molecular dynamics on a femtosecond clock, plus rule-based quantum
   events (electron capture/ionization, bonding, reactions, nuclear processes).
   ========================================================================== */

const NUC = 0, ELEC = 1, POS = 2;          // particle kinds (NUC covers nuclei, atoms, ions, neutrons)
const RC = 6, RC2 = RC * RC;               // short-range cutoff (Å)
// Electron–ion Coulomb softening (Å²): a core of about one Bohr radius, as in the Kelbg/Deutsch
// quantum-statistical potentials of plasma physics, keeps classical electrons from falling below the
// ground-state energy scale.
const SOFT_EN = 0.28;
/* Electron–ion core per ion: the classical well is made exactly as deep as the binding energy of the level a
   captured electron would fill (U⁺ 6.2 eV, Na⁺ 5.1 eV, He²⁺ 54 eV, H⁺ 13.6 eV). A classical electron can
   then never be more tightly bound than any real state of that ion: otherwise it sinks into the well, can
   neither recombine nor be integrated accurately, and slowly pumps energy into the gas. */
function softFor(p) {
  const q = Math.abs(p.q);
  if (q < 1 || p.ne + 1 > p.Z) return SOFT_EN;
  const ie = ionE(p.Z, p.ne + 1);
  if (!(ie > 0)) return SOFT_EN;
  return Math.min(9, Math.max(0.02, Math.pow(PHYS.KE * q / ie, 2)));
}
const V_FAST_ON = 25, V_FAST_OFF = 18;     // ballistic mode thresholds (Å/tu)
const ESC_E_NEUTRON = 1e3; // eV: faster neutrons leave through the walls
const NEUTRON_RAD = 2e7;   // eV: faster neutrons fly at their relativistic speed with their energy stored (radiation mode)
/* Radiation-mode thresholds (eV): well above the thermal energies of the bath, so plasmas stay thermal. */
function radThreshold(isLepton) { return Math.max(isLepton ? 1000 : 2000, 30 * PHYS.KB * W.T); }
const DT_MAX = 0.04, DT_MIN = 2e-5;        // tu (0.4 fs max)
const LJ_SCALE = 2.0;                      // 2-D cohesion correction for dispersion
const FCAP = 1e7;                          // eV/Å: a safety net only; the step size follows contact stiffness
let MAX_PARTS = 4000, MAX_FREE_E = 1500; // (the particle limit: Settings can raise it)
function setMaxParts(n) { MAX_PARTS = n; MAX_FREE_E = Math.round(0.375 * n); }
const R_NN = 0.35, R_FUS = 0.25;           // enlarged nuclear interaction radii (Å)
const R_BEAM = 0.9;                        // in a collider, beam particles that pass within their drawn size of each other interact
const ANGLE_K = 2.0;                       // eV/rad²
const PARTIAL_K = 0.30;                    // e per unit electronegativity difference
const FERRO = { 26:[1043, 2.22], 27:[1388, 1.72], 28:[627, 0.606], 64:[292, 7.63] };
const CATALYSTS = new Set([78, 46, 28, 45, 44, 77, 26]); // Pt Pd Ni Rh Ru Ir Fe

const EV = { BOND:1, REACT:2, BREAK:3, LEPTON:4, ANNIH:5, DATIVE:6, XFER:7, HOT:8, ANTI:9 };
const R_ANN = 0.3;                          // Å: an antinucleon this close to a bare nucleus annihilates
/* Antimatter: a nucleus with p.anti is made of antinucleons and binds positrons instead of electrons.
   Every rule mirrors ordinary matter; matter meeting antimatter annihilates. */
function opp(a, b) { return !!a.anti !== !!b.anti; }

function makeWorld() {
  return {
    parts: [], bonds: [], evq: [],
    t: 0, rt: 0, tNuc: 0, step: 0, dt: 0.02, simPerFrame: 1.5,
    box: { w: 120, h: 76, tw: 120, th: 76, uw: 0, uh: 0 },
    wall: 'reflect',
    T: 300, gamma: 0.05,
    warp: 1,                    // radioactive decay speed-up over real rates (1 = as in nature)
    Bz: 0, magnets: [], Ex: 0, Ey: 0,
    nextId: 1, topo: 1,
    rays: [], flights: [], chips: [], chipSeq: 0, mem: null, tracks: [], flashes: [], log: [], logSeq: 0,
    exo: [],                    // unstable particles in flight (muons, pions, kaons…: hep.js)
    events: [], evRecent: [], slow: null, slowmo: true, decayOn: true, made: null, // made: what nuclear events have made (noteMade)
    tool: null, grab: null, sources: [],
    zones: [], collider: null,  // accelerator parts (bending and focusing magnets, cavities) and the collider's set-up
    count: { fusion:0, fission:0, decay:0, capture:0, ionize:0, recomb:0, bonds:0, broken:0, react:0,
             photons:0, annih:0, xfer:0, ncap:0, nreact:0 },
    ledger: { chem: 0, nuc: 0, escaped: 0, bath: 0 },
    hist: { t: [], T: [], ion: [], rad: [] },
    vmax: 0, amax: 0, nE: 0, molSeq: 0, spawned: 0, fSpawn: -1, dirty: 0, evSeq: 0,
  };
}
const W = makeWorld();

/* ------------------------------------------------------------------ particles
   The data the integrator and the force loops read every step lives in struct-of-arrays typed arrays (the store S),
   indexed by a particle's slot p.i; everything else is an ordinary field of the particle object. The object is a
   handle: p.x, p.vx, p.dead … are accessors onto the store, so chemistry, the chips, the collider and the UI read and
   write particles as before, while the hot loops run over the arrays. Slots are reused once a dead particle is dropped
   from W.parts (freeSlot): the handle is then detached, keeping its last values as plain fields. */
const S = { size: 0, hi: 0, free: new Int32Array(64), nfree: 0, obj: [],
  x: null, y: null, vx: null, vy: null, fx: null, fy: null, gx: null, gy: null, ox: null, oy: null, m: null, im: null, q: null, qp: null,
  k: null, dead: null, fast: null, rad: null, fresh: null, ballistic: null, inMD: null, nearIon: null, Z: null, ne: null, mol: null, id: null,
  ljR: null, ljS: null, ionR: null, cap: null, used: null, ionic: null, isMetal: null, anti: null, xferD: null, xferA: null, sEN: null, elrc: null, hit: null,
  lp: null, metal: null, mR: null, mD: null };
const S_F64 = ['x', 'y', 'vx', 'vy', 'fx', 'fy', 'gx', 'gy', 'ox', 'oy', 'm', 'im', 'q', 'qp', 'ljR', 'ljS', 'ionR', 'sEN', 'elrc', 'mR', 'mD'];
const S_U8 = ['k', 'dead', 'fast', 'rad', 'fresh', 'ballistic', 'inMD', 'nearIon', 'ionic', 'isMetal', 'anti', 'xferD', 'xferA', 'metal'];
const S_I16 = ['Z', 'ne', 'cap', 'used', 'lp'], S_I32 = ['mol', 'id', 'hit'];
const S_ALL = S_F64.concat(S_U8, S_I16, S_I32);
const S_BOOL = new Set(['dead', 'fast', 'rad', 'fresh', 'ballistic', 'inMD', 'nearIon', 'ionic', 'isMetal', 'anti', 'xferD', 'xferA', 'metal']);
/* Typed arrays the worker threads must see (the store, the neighbour list, the force buffers): in the WebAssembly
   kernel's memory when there is one (wasm.js), else on SharedArrayBuffers where the page can have workers at all, else
   ordinary arrays (a page that is not cross-origin isolated). */
function shArray(T, n) { return WK.on ? wasmArray(T, n) : SHARED_OK ? new T(new SharedArrayBuffer(n * T.BYTES_PER_ELEMENT)) : new T(n); }
let _sharedGen = 0; // (bumped whenever a shared array is replaced: the workers must be rebound)
function storeGrow(cap) {
  const re = (name, T) => { const a = shArray(T, cap); if (S[name]) a.set(S[name]); S[name] = a; };
  for (const f of S_F64) re(f, Float64Array);
  for (const f of S_U8) re(f, Uint8Array);
  for (const f of S_I16) re(f, Int16Array);
  for (const f of S_I32) re(f, Int32Array);
  S.obj.length = cap;
  S.size = cap;
  _sharedGen++;
}
storeGrow(4096);
function allocSlot() {
  if (S.nfree > 0) return S.free[--S.nfree];
  if (S.hi >= S.size) storeGrow(S.size * 2);
  return S.hi++;
}
/* Drop a particle's slot (it must already be out of W.parts, or about to be): the handle keeps its last values. */
function freeSlot(p) {
  const i = p.i;
  if (i < 0) return;
  for (const f of S_ALL) {
    const v = S[f][i];
    Object.defineProperty(p, f, { value: f === 'dead' ? true : S_BOOL.has(f) ? v === 1 : v, writable: true, enumerable: true, configurable: true });
  }
  S.obj[i] = null; S.dead[i] = 1; S.k[i] = 0; S.id[i] = 0;
  p.i = -1;
  if (S.nfree >= S.free.length) { const f = new Int32Array(S.free.length * 2); f.set(S.free); S.free = f; }
  S.free[S.nfree++] = i;
  if (i === S.hi - 1) { // the top of the range: give it back so the live range stays short
    while (S.hi > 0 && S.obj[S.hi - 1] === null) { S.hi--; let j = 0; for (let q = 0; q < S.nfree; q++) if (S.free[q] !== S.hi) S.free[j++] = S.free[q]; S.nfree = j; }
  }
}
function dropParts(list) { for (const p of list) if (p.i >= 0) freeSlot(p); }
class Part {
  constructor(k) {
    const i = allocSlot();
    this.i = i; S.obj[i] = this;
    S.x[i] = 0; S.y[i] = 0; S.vx[i] = 0; S.vy[i] = 0; S.fx[i] = 0; S.fy[i] = 0; S.gx[i] = 0; S.gy[i] = 0; S.ox[i] = 0; S.oy[i] = 0;
    S.m[i] = 1; S.im[i] = 1; S.q[i] = 0; S.qp[i] = 0;
    S.k[i] = k; S.dead[i] = 0; S.fast[i] = 0; S.rad[i] = 0; S.fresh[i] = 1; S.ballistic[i] = 0; S.inMD[i] = 0; S.nearIon[i] = 0;
    S.Z[i] = 0; S.ne[i] = 0; S.mol[i] = 0; S.id[i] = W.nextId++;
    S.ljR[i] = 0; S.ljS[i] = 0; S.ionR[i] = 0; S.cap[i] = 0; S.used[i] = 0; S.ionic[i] = 0; S.isMetal[i] = 0; S.anti[i] = 0; S.xferD[i] = 0; S.xferA[i] = 0;
    S.sEN[i] = SOFT_EN; S.elrc[i] = 0; S.hit[i] = 0; S.lp[i] = 0; S.metal[i] = 0; S.mR[i] = 0; S.mD[i] = 0;
    this.N = 0; this.qpol = 0; this.qf = 0; this.bonds = []; this.excl = null; this.el = null; this.nuc = null;
    this.KE = 0; this.ux = 1; this.uy = 0; this.sp = 0; this.gam = 1;
    this.glow = 0; this.glowC = ''; this.born = W.rt;
    this.val = 0; this.nOut = 0; this.unp = 0;
    this.ljE = 0; this.polarH = false; this.rd = 0.3;
    this.trk = null; this.mark = 0; this.sel = false; this.tLocal = 0;
    this.omB = 0; this.Bl = 0; this.evId = 0; this.capT = 0; this.capN = 0;
    this.beam = undefined; this.trkKeep = undefined; this.injKick = undefined; this.kickIn = undefined; this.nucProd = undefined; this.caught = false;
  }
  get x() { return S.x[this.i]; } set x(v) { S.x[this.i] = v; }
  get y() { return S.y[this.i]; } set y(v) { S.y[this.i] = v; }
  get vx() { return S.vx[this.i]; } set vx(v) { S.vx[this.i] = v; }
  get vy() { return S.vy[this.i]; } set vy(v) { S.vy[this.i] = v; }
  get fx() { return S.fx[this.i]; } set fx(v) { S.fx[this.i] = v; }
  get fy() { return S.fy[this.i]; } set fy(v) { S.fy[this.i] = v; }
  get gx() { return S.gx[this.i]; } set gx(v) { S.gx[this.i] = v; }
  get gy() { return S.gy[this.i]; } set gy(v) { S.gy[this.i] = v; }
  get ox() { return S.ox[this.i]; } set ox(v) { S.ox[this.i] = v; }
  get oy() { return S.oy[this.i]; } set oy(v) { S.oy[this.i] = v; }
  get m() { return S.m[this.i]; } set m(v) { S.m[this.i] = v; }
  get im() { return S.im[this.i]; } set im(v) { S.im[this.i] = v; }
  get q() { return S.q[this.i]; } set q(v) { S.q[this.i] = v; }
  get qp() { return S.qp[this.i]; } set qp(v) { S.qp[this.i] = v; }
  get k() { return S.k[this.i]; } set k(v) { S.k[this.i] = v; }
  get dead() { return S.dead[this.i] === 1; } set dead(v) { S.dead[this.i] = v ? 1 : 0; _flagGen++; if (v) _nDead++; }
  get fast() { return S.fast[this.i] === 1; } set fast(v) { if (S.fast[this.i] !== (v ? 1 : 0)) { S.fast[this.i] = v ? 1 : 0; _flagGen++; } }
  get rad() { return S.rad[this.i] === 1; } set rad(v) { if (S.rad[this.i] !== (v ? 1 : 0)) { S.rad[this.i] = v ? 1 : 0; _flagGen++; } }
  get fresh() { return S.fresh[this.i] === 1; } set fresh(v) { S.fresh[this.i] = v ? 1 : 0; }
  get ballistic() { return S.ballistic[this.i] === 1; } set ballistic(v) { S.ballistic[this.i] = v ? 1 : 0; }
  get inMD() { return S.inMD[this.i] === 1; } set inMD(v) { S.inMD[this.i] = v ? 1 : 0; }
  get nearIon() { return S.nearIon[this.i] === 1; } set nearIon(v) { S.nearIon[this.i] = v ? 1 : 0; }
  get Z() { return S.Z[this.i]; } set Z(v) { S.Z[this.i] = v; }
  get ne() { return S.ne[this.i]; } set ne(v) { S.ne[this.i] = v; }
  get mol() { return S.mol[this.i]; } set mol(v) { S.mol[this.i] = v; }
  get id() { return S.id[this.i]; } set id(v) { S.id[this.i] = v; }
  get ljR() { return S.ljR[this.i]; } set ljR(v) { S.ljR[this.i] = v; }
  get ljS() { return S.ljS[this.i]; } set ljS(v) { S.ljS[this.i] = v; }
  get ionR() { return S.ionR[this.i]; } set ionR(v) { S.ionR[this.i] = v; }
  get cap() { return S.cap[this.i]; } set cap(v) { S.cap[this.i] = v; }
  get used() { return S.used[this.i]; } set used(v) { S.used[this.i] = v; }
  get ionic() { return S.ionic[this.i] === 1; } set ionic(v) { S.ionic[this.i] = v ? 1 : 0; }
  get isMetal() { return S.isMetal[this.i] === 1; } set isMetal(v) { S.isMetal[this.i] = v ? 1 : 0; }
  get anti() { return S.anti[this.i] === 1; } set anti(v) { S.anti[this.i] = v ? 1 : 0; }
  get xferD() { return S.xferD[this.i] === 1; } set xferD(v) { S.xferD[this.i] = v ? 1 : 0; }
  get xferA() { return S.xferA[this.i] === 1; } set xferA(v) { S.xferA[this.i] = v ? 1 : 0; }
  get sEN() { return S.sEN[this.i]; } set sEN(v) { S.sEN[this.i] = v; }
  get hit() { return S.hit[this.i]; } set hit(v) { S.hit[this.i] = v; }
  get lp() { return S.lp[this.i]; } set lp(v) { S.lp[this.i] = v; }
  get mR() { return S.mR[this.i]; } set mR(v) { S.mR[this.i] = v; }
  get mD() { return S.mD[this.i]; } set mD(v) { S.mD[this.i] = v; }
}
function newPart(k) { return new Part(k); }
let _flagGen = 0, _flagGenForces = -1, _nDead = 0; // (changes of dead/fast/rad since the force lists were made; deaths not yet dropped from W.parts)
/* The slots of W.parts, in its order (_PI[j] = W.parts[j].i), so the per-particle loops run over the store alone. Kept
   in step with the pushes and the compaction here; any other change to W.parts (another array put in its place) is
   caught by partsSync and the mirror rebuilt. */
let _PI = new Int32Array(4096), _piParts = null, _piN = -1;
function partsSync() { const ps = W.parts; return (ps === _piParts && ps.length === _piN) ? _PI : partsRebuild(); }
function partsRebuild() {
  const ps = W.parts, n = ps.length;
  if (_PI.length < n) _PI = new Int32Array(n * 2 + 64);
  for (let j = 0; j < n; j++) _PI[j] = ps[j].i;
  _piParts = ps; _piN = n;
  return _PI;
}
function pushPart(p) {
  const ps = W.parts;
  if (ps === _piParts && ps.length === _piN) { if (_piN >= _PI.length) { const a = new Int32Array(_PI.length * 2); a.set(_PI); _PI = a; } _PI[_piN++] = p.i; }
  ps.push(p);
  if (ps !== _piParts || ps.length !== _piN) partsRebuild();
}

function partCount() { return W.parts.length; }
function freeElectronCount() { return W.nE; }

function addNuc(Z, N, ne, x, y, vx = 0, vy = 0, anti = false) {
  const p = newPart(NUC);
  p.Z = Z; p.N = N; p.ne = Math.max(0, ne); p.x = x; p.y = y; p.ox = x; p.oy = y; p.vx = vx; p.vy = vy; p.anti = !!anti;
  refresh(p);
  pushPart(p); W.spawned++; _late.push(p);
  return p;
}
function addLepton(kind, x, y, vx = 0, vy = 0) {
  const p = newPart(kind);
  p.m = PHYS.ME_SIM; p.im = 1 / p.m; p.q = kind === ELEC ? -1 : 1; p.rd = 0.12;
  p.x = x; p.y = y; p.ox = x; p.oy = y; p.vx = vx; p.vy = vy;
  pushPart(p); W.spawned++; _late.push(p); _charged.push(p);
  if (kind === ELEC) W.nE++;
  updateFast(p);
  return p;
}

/* Recompute everything derived from Z, N, ne and bonding. */
function refresh(p) {
  if (p.k !== NUC) return;
  W.dirty++;
  const Z = p.Z, N = p.N;
  p.el = Z > 0 ? ELEMENTS[Math.min(Z, Z_MAX)] : null;
  S.elrc[p.i] = p.el ? p.el.rc : 0; S.metal[p.i] = p.el && p.el.metal ? 1 : 0; // (the covalent radius and whether it is a metal, for the pair kernel)
  if (Z === 0) p.m = N * PHYS.MN;
  else p.m = Math.max(0.5, Z * PHYS.MP + N * PHYS.MN + p.ne * PHYS.ME - bindingE(Z, N) / PHYS.AMU_MEV);
  p.im = 1 / p.m;
  p.q = (p.anti ? -1 : 1) * (Z - p.ne);
  p.sEN = Z > 0 ? softFor(p) : SOFT_EN;
  p.nuc = nuclideInfo(Z, N);
  if (p.ne > 0 && Z > 0) {
    const vi = valenceInfo(Z, p.ne);
    p.val = vi.v; p.nOut = vi.n; p.unp = vi.unpaired;
  } else { p.val = 0; p.nOut = 0; p.unp = 0; }
  p.cap = capacity(p);
  p.used = 0; for (const bd of p.bonds) p.used += bd.order;
  p.lp = (p.el && !p.el.dblock && p.ne > 0) ? Math.max(0, Math.floor((p.val - p.used) / 2)) : 0;
  setSize(p);
  if (Math.abs(p.q) >= 1 && !_charged.includes(p)) _charged.push(p);
  p.xferD = !p.anti && p.ne > 0 && p.el && (p.el.ie1 < 9.6 || p.q < 0 || p.el.metal);
  p.xferA = !p.anti && !!p.el && (p.q > 0 || (p.el.ea >= 0.7 && p.ne <= p.Z));
  if (p.bonds.length && !_deferDeloc) delocalize(molecule(p)); // a charge gained or lost inside a molecule spreads at once
}
let _deferDeloc = false; // (while a snapshot is put back: relink then spreads each molecule's charges once, not once per atom)

/* Formal charges inside a molecule are bookkeeping for valence, not where the charge really sits. Two rules
   place it more truthfully: equivalent end atoms on one centre share it (resonance: the two O of a carboxylate
   or nitro group, the four O of sulfate), and opposite charges on bonded atoms largely cancel (N≡N⁺–O⁻ is
   nearly non-polar, as real N₂O is). The result is added to the bond-polarity partial charges.
   Nor do such pairs cost what a free ion pair would: N⁺ in N₂O has not lost an electron to the vacuum. A bond
   joining opposite formal charges therefore carries back the ionization energy and electron affinity that its
   two atoms' electron counts book (Ef, about 13 eV for N⁺–O⁻), so the molecule weighs what its bonds say. Without
   this, any electron hop that undid the pair would release that energy as if from an ion pair. */
const DELOC_S = 0.75;
function delocalize(atoms) {
  let any = false;
  for (const p of atoms) if (p.q !== 0) { any = true; break; }
  if (!any || atoms.length < 2) { for (const p of atoms) { p.qf = 0; p.qp = p.qpol; for (const bd of p.bonds) bd.Ef = 0; } return; }
  // energy booked by each atom's formal charge, and its oppositely charged bonded neighbours
  const nOq = new Map(), Eq = new Map();
  for (const p of atoms) {
    let k = 0; for (const bd of p.bonds) if (p.q * other(bd, p).q < 0) k++;
    nOq.set(p, k);
    if (k) Eq.set(p, internalE(p) - neutralInternalE(p));
  }
  for (const p of atoms) for (const bd of p.bonds) {
    if (bd.a !== p) continue;
    const a = bd.a, b = bd.b;
    if (!(a.q * b.q < 0)) { bd.Ef = 0; continue; }
    const t = Math.min(Math.abs(a.q) / nOq.get(a), Math.abs(b.q) / nOq.get(b));
    bd.Ef = Math.max(0, t * (Eq.get(a) / Math.abs(a.q) + Eq.get(b) / Math.abs(b.q)));
  }
  const c = new Map();
  for (const p of atoms) c.set(p, p.q);
  for (const x of atoms) { // resonance among the terminal atoms of each centre, grouped by element
    const groups = new Map();
    for (const bd of x.bonds) {
      const t = other(bd, x);
      if (t.bonds.length !== 1 || !t.el) continue;
      const k = t.el.sym + (t.anti ? '~' : '');
      (groups.get(k) || groups.set(k, []).get(k)).push(t);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      let s = 0; for (const t of g) s += t.q;
      for (const t of g) c.set(t, s / g.length);
    }
  }
  const nOpp = new Map();
  for (const p of atoms) { let k = 0; for (const bd of p.bonds) if (c.get(p) * c.get(other(bd, p)) < 0) k++; nOpp.set(p, k); }
  const d = new Map();
  for (const p of atoms) for (const bd of p.bonds) { // each bond once, from its first atom
    if (bd.a !== p) continue;
    const a = bd.a, b = bd.b, ca = c.get(a), cb = c.get(b);
    if (!(ca * cb < 0)) continue;
    const t = DELOC_S * Math.min(Math.abs(ca) / nOpp.get(a), Math.abs(cb) / nOpp.get(b));
    d.set(a, (d.get(a) || 0) - Math.sign(ca) * t); d.set(b, (d.get(b) || 0) - Math.sign(cb) * t);
  }
  for (const p of atoms) { p.qf = c.get(p) + (d.get(p) || 0) - p.q; p.qp = p.qpol + p.qf; }
}

function capacity(p) {
  const el = p.el;
  if (!el || p.ne === 0) return 0;
  if (el.dblock) return Math.max(0, el.ox - Math.max(0, p.q));
  if (p.nOut === 1) return p.val === 1 ? 1 : 0;   // duet rule (H, He-like)
  const v = p.val;
  if (v >= 8) return 0;
  return v <= 4 ? v : 8 - v;
}
function hyperCap(p) { // expanded octet for period ≥ 3 with electronegative partners
  const el = p.el;
  if (!el || el.dblock || p.ne === 0 || p.q < 0) return p.cap;
  const per = periodOf(el.Z);
  if (per < 3 || p.val <= 4) return p.cap;
  if (el.cat === 'ng' && per < 4) return p.cap;
  return Math.min(p.val, 8);
}
function canTake(p, partner) {
  if (p.used + 1 <= p.cap) return true;
  return !!partner.el && partner.el.en >= 3.0 && p.used + 1 <= hyperCap(p);
}
function freeVal(p) { return p.cap - p.used; }

function setSize(p) {
  if (p.Z === 0) { p.rd = 0.2; p.ljR = 0; p.ljE = 0; p.ljS = 0; p.isMetal = false; return; }
  if (p.ne === 0) { p.rd = 0.16 + 0.05 * Math.cbrt(p.Z + p.N); p.ljR = 0; p.ljE = 0; p.ljS = 0; p.isMetal = false; p.ionic = false; return; }
  const el = p.el;
  p.ionic = p.bonds.length === 0 && Math.abs(p.q) >= 1;
  if (p.ionic) {
    p.ionR = ionicRadius(el, p.q);
    p.ljR = 2 * p.ionR; p.ljE = 0.02;
    p.rd = Math.max(0.28, 0.6 * p.ionR);
  } else {
    p.ljR = el.uffR; p.ljE = el.uffD * LJ_SCALE;
    p.rd = 0.3 + 0.28 * el.rc;
  }
  if (p.polarH) { p.ljR = 1.2; p.ljE = 0.002; }
  p.ljS = Math.sqrt(p.ljE);
  p.isMetal = el.metal && p.bonds.length === 0 && Math.abs(p.q) <= 1;
  if (el.metal) {
    p.mD = PHYS.KB * Math.max(el.tm, 150) / 0.45;
    p.mR = 2 * el.rc * ((el.cat === 'am' || el.cat === 'ae' || el.cat === 'pt') ? 1.12 : 1.0);
    if (p.isMetal && 2.1 * p.mR > RC) _farMetalSeen = true;
  }
}

function kill(p) {
  if (p.dead) return;
  p.dead = true;
  if (p.k === ELEC) W.nE--;
  for (const bd of p.bonds.slice()) removeBond(bd);
  if (W.grab && W.grab.p === p) W.grab = null;
}

/* ------------------------------------------------------------------ bonds */
function other(bd, p) { return bd.a === p ? bd.b : bd.a; }
function bondBetween(a, b) { for (const bd of a.bonds) if (bd.a === b || bd.b === b) return bd; return null; }
function setBondParams(bd) {
  const ea = bd.a.el, eb = bd.b.el;
  bd.D = bondEnergy(ea, eb, bd.order);
  bd.r0 = bondLength(ea, eb, bd.order);
  bd.al = morseA(ea, eb, bd.order);
  bd.rb = 2.97 / bd.al;
}
function addBond(a, b, order) {
  const bd = { a, b, order, D: 0, r0: 1, al: 2, rb: 1.5, Ef: 0 };
  setBondParams(bd);
  a.bonds.push(bd); b.bonds.push(bd); W.bonds.push(bd);
  W.topo++;
  relink([a, b]);
  return bd;
}
function removeBond(bd) {
  const i = W.bonds.indexOf(bd);
  if (i >= 0) W.bonds.splice(i, 1);
  bd.a.bonds.splice(bd.a.bonds.indexOf(bd), 1);
  bd.b.bonds.splice(bd.b.bonds.indexOf(bd), 1);
  W.topo++;
  relink([bd.a, bd.b]);
}
function setOrder(bd, o) {
  if (o <= 0) { removeBond(bd); return; }
  bd.order = o; setBondParams(bd); W.topo++; relink([bd.a, bd.b]);
}
/* Morse energy, continued linearly below r0 − 0.6 Å where the force is held constant (see computeForces). */
function morseV(bd, r) {
  const d = r - bd.r0;
  if (d >= -0.6) { const e = Math.exp(-bd.al * d); return bd.D * (1 - e) * (1 - e); }
  const e = Math.exp(0.6 * bd.al);
  return bd.D * (1 - e) * (1 - e) + 2 * bd.D * bd.al * (e - 1) * e * (-0.6 - d);
}

/* After any bonding change: update valence use, polar-H flags, partial charges and exclusions nearby. */
function relink(seeds) {
  const touched = new Set();
  for (const s of seeds) {
    if (s.dead) continue;
    touched.add(s);
    for (const bd of s.bonds) { const o = other(bd, s); touched.add(o); for (const b2 of o.bonds) touched.add(other(b2, o)); }
  }
  for (const p of touched) {
    p.used = 0; for (const bd of p.bonds) p.used += bd.order;
    p.polarH = false;
    if (p.Z === 1 && p.bonds.length === 1) { const o = other(p.bonds[0], p); if (o.el && o.el.en >= 2.8) p.polarH = true; }
  }
  for (const p of touched) {
    // partial charges from bond polarity (Pauling electronegativity)
    let qp = 0;
    const ep = p.el ? (p.el.en || 2.6) : 2.2;
    for (const bd of p.bonds) {
      const o = other(bd, p), eo = o.el ? (o.el.en || 2.6) : 2.2;
      qp += PARTIAL_K * (eo - ep) * (1 + 0.2 * (bd.order - 1));
    }
    p.qpol = p.anti ? -qp : qp; // positrons crowd toward the more electronegative anti-atom
    p.qp = p.qpol + p.qf;
    // 1-2 and 1-3 exclusions. A 1-3 pair is excluded only where the centre's bond-angle term keeps the two
    // apart; around transition metals and f-block atoms (no VSEPR term) ligands repel each other directly,
    // as in the points-on-a-sphere model, instead of being free to slide onto one another.
    if (p.bonds.length) {
      const ex = new Set();
      for (const bd of p.bonds) {
        const o = other(bd, p); ex.add(o.id);
        if (!angled(o)) continue;
        for (const b2 of o.bonds) { const o2 = other(b2, o); if (o2 !== p) ex.add(o2.id); }
      }
      p.excl = ex;
    } else p.excl = null;
    p.lp = (p.el && !p.el.dblock && p.ne > 0) ? Math.max(0, Math.floor((p.val - p.used) / 2)) : 0;
    setSize(p);
  }
  const done = new Set();
  for (const p of touched) {
    if (done.has(p)) continue;
    if (!p.bonds.length) { p.mol = 0; p.qf = 0; p.qp = p.qpol; done.add(p); continue; }
    const id = ++W.molSeq, m = molecule(p);
    for (const a of m) { a.mol = id; done.add(a); }
    delocalize(m);
  }
}

/* Snapshot / restore of a closed set of atoms (whole molecules): positions, velocities, electrons, bonds.
   Events apply all their consequences on trial, measure the exact energy change, and undo if impossible. */
function snapshot(set) {
  const bonds = [];
  for (const bd of W.bonds) if (set.has(bd.a) || set.has(bd.b)) bonds.push([bd.a, bd.b, bd.order]);
  return { set, parts: [...set].map(p => [p, p.x, p.y, p.vx, p.vy, p.ne]), bonds, broken: W.count.broken };
}
function restoreSnap(sn) {
  for (const bd of W.bonds.slice()) {
    if (!sn.set.has(bd.a) && !sn.set.has(bd.b)) continue;
    if (!sn.bonds.some(b => (b[0] === bd.a && b[1] === bd.b) || (b[0] === bd.b && b[1] === bd.a))) removeBond(bd);
  }
  _deferDeloc = true;
  try {
    for (const [p, x, y, vx, vy, ne] of sn.parts) { p.x = x; p.y = y; p.vx = vx; p.vy = vy; if (p.ne !== ne) { p.ne = ne; refresh(p); } }
    for (const [a, b, o] of sn.bonds) { const bd = bondBetween(a, b); if (!bd) addBond(a, b, o); else if (bd.order !== o) setOrder(bd, o); }
    for (const [p] of sn.parts) refresh(p);
  } finally { _deferDeloc = false; }
  relink([...sn.set]); // (which spreads the charges over each molecule)
  W.count.broken = sn.broken;
}
function closeSet(set) { for (const q of [...set]) for (const m of molecule(q)) set.add(m); return set; }

/* Reduce bonding if an atom's capacity dropped (after ionization, capture, transfer…). The energy to
   break the bonds (`budget`, already paid by the caller) is reconciled with the actual change in local
   potential energy; fragments are moved out of each other's repulsive core. */
function enforceValence(p, budget = 0) {
  const lim = () => {
    const hyper = p.bonds.some(bd => other(bd, p).el && other(bd, p).el.en >= 3.0);
    return hyper ? Math.max(p.cap, hyperCap(p)) : p.cap;
  };
  if (!p.bonds.length || p.used <= lim()) return;
  const set = setOf(molecule(p));
  const PE0 = G.n ? localPE(set) : 0;
  let guard = 0, lastPair = null;
  while (p.bonds.length && guard++ < 12 && p.used > lim()) {
    let w = p.bonds[0];
    for (const bd of p.bonds) if (bd.D < w.D) w = bd;
    lastPair = [p, other(w, p)];
    setOrder(w, w.order - 1);
    W.count.broken++;
  }
  if (lastPair && !bondBetween(lastPair[0], lastPair[1])) separate(lastPair[0], lastPair[1]);
  if (budget === null || !G.n) return;
  for (const q of [...set]) for (const m of molecule(q)) set.add(m);
  const left = budget - (localPE(set) - PE0);
  if (lastPair) kickPair(lastPair[0], lastPair[1], left);
}
/* Move b's molecule out of a's repulsive core along the a→b axis (no-op if already clear). */
function separate(a, b) {
  W.dirty++;
  const mb = molecule(b);
  if (mb.includes(a)) return;
  const [ex, ey] = minImg(b.x - a.x, b.y - a.y);
  const r = Math.hypot(ex, ey) || 1e-6, target = 0.85 * 0.5 * ((a.ljR || 2) + (b.ljR || 2));
  if (r >= target) return;
  const sh = target - r;
  for (const q of mb) { q.x += ex / r * sh; q.y += ey / r * sh; }
}
/* Energy needed to remove one electron, including bonds that must then break. */
function ionizationCost(p) { return ionE(p.Z, p.ne) + breakCostIfCharged(p, -1); }

function molecule(p) {
  const seen = new Set([p]), out = [p];
  for (let i = 0; i < out.length; i++) for (const bd of out[i].bonds) { const o = other(bd, out[i]); if (!seen.has(o)) { seen.add(o); out.push(o); } }
  return out;
}
function hill(atoms, plain) {
  const cnt = {}; let q = 0;
  for (const a of atoms) { const s = a.el ? (a.anti ? barSym(a.el.sym) : a.el.sym) : 'n'; cnt[s] = (cnt[s] || 0) + 1; q += a.q; }
  const keys = Object.keys(cnt);
  let order;
  if (cnt.C) order = ['C'].concat(cnt.H ? ['H'] : [], keys.filter(k => k !== 'C' && k !== 'H').sort());
  else order = keys.sort();
  let s = '';
  for (const k of order) s += k + (cnt[k] > 1 ? (plain ? cnt[k] : sub(cnt[k])) : '');
  if (q) { const t = (Math.abs(q) > 1 ? Math.abs(q) : '') + (q > 0 ? '+' : '-'); s += plain ? t : sup(t); }
  return s;
}
/* The formula with its isotopes written out, as chemists write them: D₂O, CH₃D, ¹³CH₄ (just hill() without any). */
function isoFormula(atoms, plain) {
  if (atoms.some(a => a.anti || !a.el) || !atoms.some(a => isoA(a))) return hill(atoms, plain);
  const cnt = new Map(); let q = 0;
  for (const a of atoms) { const k = a.el.sym + ' ' + isoA(a); cnt.set(k, (cnt.get(k) || 0) + 1); q += a.q || 0; }
  const els = [...new Set(atoms.map(a => a.el.sym))];
  const order = els.includes('C') ? ['C'].concat(els.includes('H') ? ['H'] : [], els.filter(e => e !== 'C' && e !== 'H').sort()) : els.sort();
  let s = '';
  for (const e of order) {
    for (const [k, n] of [...cnt].filter(([k]) => k.startsWith(e + ' ')).sort((x, y) => +x[0].split(' ')[1] - +y[0].split(' ')[1])) {
      const A = +k.split(' ')[1];
      s += (!A ? e : e === 'H' && A <= 3 ? (A === 2 ? 'D' : 'T') : (plain ? A : sup(A)) + e) + (n > 1 ? (plain ? n : sub(n)) : '');
    }
  }
  if (q) { const t = (Math.abs(q) > 1 ? Math.abs(q) : '') + (q > 0 ? '+' : '-'); s += plain ? t : sup(t); }
  return s;
}
/* Names go by structure, not just formula: ethanol and dimethyl ether are both C₂H₆O, butane and isobutane both
   C₄H₁₀. A molecule takes the name of the library entry with the same atoms joined the same way, compared by a
   Weisfeiler–Lehman hash of the bond graph (bond orders and charge placement left out, so a resonance form or a
   radical version of the same skeleton still matches). Formulas that no library molecule has fall back to the
   formula table (radicals and fragments). */
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }
function graphHash(labels, adj) {
  let col = labels.slice();
  const n = labels.length, iters = Math.min(n, 12);
  for (let it = 0; it < iters; it++) {
    const nc = new Array(n);
    for (let i = 0; i < n; i++) nc[i] = fnv(col[i] + '(' + adj[i].map(j => col[j]).sort().join(',') + ')');
    col = nc;
  }
  return fnv(col.slice().sort().join('.'));
}
let _libIdx = null;
function libIndex() {
  if (_libIdx) return _libIdx;
  _libIdx = new Map();
  for (const key in MOLECULES) {
    const m = MOLECULES[key];
    if (m.atoms.length < 2 || m.bonds.length < m.atoms.length - 1) continue; // ion pairs are never one molecule
    const f = hill(m.atoms.map(a => ({ el: ELEMENTS[SYM2Z[a[0]]], q: a[3] || 0 })), true);
    const adj = m.atoms.map(() => []);
    for (const [i, j] of m.bonds) { adj[i].push(j); adj[j].push(i); }
    const h = f + ':' + graphHash(m.atoms.map(a => (a[4] && a[4] !== COMMON_A[SYM2Z[a[0]]] ? a[0] + a[4] : a[0])), adj);
    if (!_libIdx.has(f)) _libIdx.set(f, []);
    _libIdx.get(f).push({ h, m });
  }
  return _libIdx;
}
/* Library entry with this molecule's structure (atoms: one bonded molecule), or null. Isotopes count (heavy water
   is not water) unless plain is set. */
function libMatch(atoms, plain) {
  if (!atoms.length || atoms.some(a => !a.el)) return null;
  const anti = atoms[0].anti;
  if (atoms.some(a => !!a.anti !== !!anti)) return null;
  const f = hill(atoms.map(a => ({ el: a.el, q: anti ? -a.q : a.q })), true);
  const cands = libIndex().get(f);
  if (!cands) return null;
  const ix = new Map(atoms.map((a, i) => [a, i]));
  const adj = atoms.map(a => a.bonds.map(bd => ix.get(other(bd, a))).filter(j => j !== undefined));
  const h = f + ':' + graphHash(atoms.map(a => { const A = plain ? 0 : isoA(a); return A ? a.el.sym + A : a.el.sym; }), adj);
  for (const c of cands) if (c.h === h) return c.m;
  return null;
}
/* Isotopes in a molecule: atoms other than the element's usual isotope (COMMON_A, what the chamber makes unless told
   otherwise; an atom gives its mass number as A, a particle as Z + N), written as IUPAC writes an isotopically
   substituted compound: nuclides in alphabetical order of symbol, then by mass number, as in (¹³C,²H₄)methane. */
function isoA(a) {
  const Z = a.el ? a.el.Z : 0, A = a.A !== undefined ? a.A : a.Z ? a.Z + a.N : 0;
  return Z && A && A !== COMMON_A[Z] ? A : 0;
}
function isoDesc(atoms) {
  const c = new Map();
  for (const a of atoms) { const A = isoA(a); if (A) { const k = a.el.sym + ' ' + A; c.set(k, (c.get(k) || 0) + 1); } }
  return [...c.entries()].map(([k, n]) => { const [s, A] = k.split(' '); return { s, A: +A, n }; })
    .sort((x, y) => (x.s < y.s ? -1 : x.s > y.s ? 1 : x.A - y.A)).map(o => sup(o.A) + o.s + (o.n > 1 ? sub(o.n) : '')).join(',');
}
const MOL_ISO_NAMES = { Water: { '²H₂': 'Heavy water', '²H': 'Semi-heavy water', '³H₂': 'Tritiated water' },
  Hydrogen: { '²H₂': 'Deuterium', '²H': 'Hydrogen deuteride', '³H₂': 'Tritium', '³H': 'Hydrogen tritide', '²H,³H': 'Deuterium tritide' } };
function isoName(n, d) {
  if (!d || !n) return n;
  return (MOL_ISO_NAMES[n] && MOL_ISO_NAMES[n][d]) || `(${d})` + (/^[A-Z][a-z]/.test(n) ? n[0].toLowerCase() + n.slice(1) : n);
}
function moleculeName(atoms) {
  if (!atoms.length) return null;
  const anti = atoms.every(a => a.anti);
  const m = libMatch(atoms), iso = !m && !anti ? isoDesc(atoms) : ''; // (one built with its isotopes keeps its own name)
  let n = m ? m.name : iso ? (libMatch(atoms, true) || {}).name || null : null;
  if (!n) {
    const f = hill(anti ? atoms.map(a => ({ el: a.el, q: -a.q })) : atoms, true);
    if (!libIndex().has(f)) n = MOLECULE_NAMES[f] || null; // an unlisted isomer of a library formula stays unnamed
  }
  if (!n || !anti) return isoName(n, iso);
  return n === 'Hydrogen' ? 'Antihydrogen' : 'Anti-' + (/^[A-Z][a-z]/.test(n) ? n[0].toLowerCase() + n.slice(1) : n);
}
function speciesLabel(p) {
  if (p.k === ELEC) return 'e⁻';
  if (p.k === POS) return 'e⁺';
  if (p.Z === 0) return 'n';
  if (p.bonds.length) return isoFormula(molecule(p));
  if (p.anti && p.ne === 0) return p.Z === 1 && p.N === 0 ? 'p̄' : nucSymA(p.Z, p.N, true) + sup((p.Z > 1 ? p.Z : '') + '-');
  if (p.ne === 0) {
    if (p.Z === 1 && p.N === 0) return 'p⁺';
    if (p.Z === 2 && p.N === 2) return 'α';
    return nucSym(p.Z, p.N) + sup((p.Z > 1 ? p.Z : '') + '+');
  }
  const qs = p.q ? sup((Math.abs(p.q) > 1 ? Math.abs(p.q) : '') + (p.q > 0 ? '+' : '-')) : '';
  return (p.anti ? barSym(p.el.sym) : p.el.sym) + qs;
}

/* ------------------------------------------------------------------ logging & visuals */
function log(cls, text) {
  const last = W.log[W.log.length - 1];
  if (last && last.text === text && W.rt - last.rt < 3) { last.n++; last.rt = W.rt; last.seq = ++W.logSeq; return; }
  W.log.push({ rt: W.rt, t: W.t, cls, text, n: 1, seq: ++W.logSeq });
  if (W.log.length > 250) W.log.splice(0, W.log.length - 250);
}
/* A flash marks an event for the eye (it is not light the simulation follows). Where events come thick and fast, as in
   a heavy-ion collision whose fragments go on knocking into one another, flashes would pile up into a glaring cloud,
   so one that would land on two others still young is left out. */
function flash(x, y, rgb, size, life) {
  let near = 0;
  for (let i = W.flashes.length - 1; i >= 0; i--) {
    const f = W.flashes[i], d = Math.max(3, 0.6 * Math.max(f.s, size));
    if (W.rt - f.t0 < 0.5 * f.life && Math.abs(f.x - x) < d && Math.abs(f.y - y) < d && ++near >= 2) return;
  }
  W.flashes.push({ x, y, c: rgb, s: size, life, t0: W.rt }); if (W.flashes.length > 300) W.flashes.shift();
}
/* Nuclear events, kept for the renderer: where and what happened, with ghosts of the particles that
   vanished or changed identity, so an event reads as more than a flash. An isolated event also starts
   slow motion (see slowFactor) so its products can be watched leaving. */
function ghostOf(p) {
  const lbl = p.k === ELEC ? 'e⁻' : p.k === POS ? 'e⁺' : p.Z === 0 ? (p.anti ? 'n̄' : 'n') :
    p.ne === 0 ? speciesLabel(p) : nucSymA(p.Z, p.N, p.anti);
  return { x: p.x, y: p.y, k: p.k, Z: p.Z, N: p.N, ne: p.ne, anti: !!p.anti, rd: p.k === NUC ? p.rd : 0.15, lbl };
}
function nucEvent(kind, x, y, text, ghosts, sub, nuc) {
  if (nuc && nuc.Z1 !== undefined && nuc.Z1 + nuc.N1 > 0) noteMade([{ Z: nuc.Z1, N: nuc.N1, anti: nuc.anti }], [], text);
  W.events.push({ kind, x, y, text, sub: sub || '', ghosts: ghosts || [], t0: W.rt, nuc: nuc || null });
  if (W.events.length > 30) W.events.splice(0, W.events.length - 30);
  const rec = W.evRecent;
  rec.push(W.rt);
  while (rec.length && rec[0] < W.rt - 6) rec.shift();
  // slow motion only for events that stand out; a busy reactor or plasma keeps running at speed
  if (W.slowmo && rec.length <= 3 && !(W.slow && W.slow.on)) W.slow = { t0: W.rt, on: true, fresh: true, f: W.slow ? W.slow.f : 1 };
  // what the event sent flying (new this frame, or fast) is marked, and for a few seconds so is anything new (what
  // its products knock loose): with slow motion for nuclear events off, slow motion on demand does not slow down
  // further to follow them
  for (const p of W.parts) if (!p.dead && !p.beam && (p.born === W.rt || p.rad || p.fast) && Math.abs(p.x - x) < 4 && Math.abs(p.y - y) < 4) p.nucProd = true;
  W.nucWin = { t0: W.nucWin && W.nucWin.t1 >= W.rt ? W.nucWin.t0 : W.rt, t1: W.rt + 3 };
}
/* What nuclear events have made, for the Data tab: W.made holds each nuclide (and each unstable particle) made by a
   collision, fusion, fission, capture or decay, with how many and the event that first made it. outs are products
   ({ Z, N, anti } for a nucleus, hep's items otherwise); ins the reactants' labels, so that a product that is just a
   reactant again (a nucleus knocked on) is not counted. γ rays, neutrinos and electrons are left out. */
function noteMade(outs, ins, how) {
  const M = W.made || (W.made = { nuc: new Map(), part: new Map() }), left = {};
  for (const l of ins) left[l] = (left[l] || 0) + 1;
  for (const it of outs) {
    if (!it || it.t === 'g' || it.t === 'v' || it.t === 'e') continue;
    const nuc = it.t !== 'x', lab = labelOf(it);
    if (left[lab] > 0) { left[lab]--; continue; }
    const key = nuc ? `${it.Z}_${it.N}${it.anti ? 'a' : ''}` : it.sp, map = nuc ? M.nuc : M.part;
    let r = map.get(key);
    if (!r) { r = nuc ? { Z: it.Z, N: it.N, anti: !!it.anti, lab, n: 0, how, t: W.t } : { sp: it.sp, lab, n: 0, how, t: W.t }; map.set(key, r); }
    r.n++;
  }
}
let _glowing = false; // (any particle still glowing: the fade loop runs only then)
function glow(p, rgb) { p.glow = 1; p.glowC = rgb; _glowing = true; }
/* Caption suffix for a radioactive decay when decays run faster than in nature. */
function boostTag() { return W.warp > 1.0001 ? ` · decay sped up ${fmtFactor(W.warp)}` : ''; }

/* ------------------------------------------------------------------ fields */
/* Accelerator parts (W.zones), each a region of the chamber with its own field:
   dipole  a bending magnet: uniform B (a rectangle), or an annulus { ring: true, cx, cy, r0, r1, R0, n } whose field
           falls off slightly outward, B·(R0/r)ⁿ: with 0 < n < 1 a particle knocked off the circle oscillates about it
           (weak focusing) instead of drifting away
   quad    a focusing magnet: B = G·(distance from its axis), which steers particles back onto the axis
   cavity  an accelerating cavity: E along its axis (V/Å). A real one oscillates, timed so the beam always meets
           it pushing forward; here its field is steady, which does the same for the beams it is set up for. Fast
           particles that already have its energy (Emax, eV) pass through untouched, as the beam's timing then
           falls where the field is zero. dir (±1, optional): it is timed for particles going that way along its
           axis; anything crossing it the other way meets it at a random phase, a push that averages out.
   Rectangles: { cx, cy, w (along the axis), h, ang (axis angle, rad) }. */
function zoneLocal(z, x, y) { // a point in the zone's own frame (along its axis, across it), or null if outside
  const dx = x - z.cx, dy = y - z.cy;
  if (z.ring) { // an annulus, or a sector of one (a bending magnet: amid ± ahalf), or the half above (1) or below (−1) its centre
    const r2 = dx * dx + dy * dy;
    if (r2 < z.r0 * z.r0 || r2 > z.r1 * z.r1 || (z.half && dy * z.half < 0)) return null;
    if (z.ahalf !== undefined) { let da = Math.atan2(dy, dx) - z.amid; da -= 2 * Math.PI * Math.round(da / (2 * Math.PI)); if (Math.abs(da) > z.ahalf) return null; }
    return _zl;
  }
  const c = z.c === undefined ? (z.c = Math.cos(z.ang || 0), z.s = Math.sin(z.ang || 0), z.c) : z.c, sn = z.s;
  const u = dx * c + dy * sn, v = -dx * sn + dy * c;
  if (Math.abs(u) > z.w / 2 || Math.abs(v) > z.h / 2) return null;
  _zl[0] = u; _zl[1] = v; return _zl;
}
const _zl = [0, 0];
function zonesB(x, y, p) {
  let B = 0;
  for (const z of W.zones) {
    if (z.kind === 'kicker') { if (p && p.injKick === z && zoneLocal(z, x, y)) B += z.B; continue; } // fires for the bunch coming in, not for the beam going round
    if (z.kind !== 'dipole' && z.kind !== 'quad') continue;
    if (z.beam && (!p || p.beam !== z.beam)) continue; // a ring of its own (its own beam pipe): only its beam goes through it
    const l = zoneLocal(z, x, y);
    if (!l) continue;
    if (z.kind === 'quad') B += z.G * l[1];
    else if (z.ring && z.n) B += z.B * Math.pow(z.R0 / Math.hypot(x - z.cx, y - z.cy), z.n);
    else B += z.B;
  }
  return B;
}
function hasBfield() {
  if (W.Bz !== 0 || W.magnets.length > 0) return true;
  const zs = W.zones;
  for (let i = 0; i < zs.length; i++) { const k = zs[i].kind; if (k === 'dipole' || k === 'quad' || k === 'kicker') return true; }
  return false;
}
function hasEfield() {
  if (W.Ex !== 0 || W.Ey !== 0) return true;
  const zs = W.zones;
  for (let i = 0; i < zs.length; i++) { const k = zs[i].kind; if (k === 'cavity' || k === 'sep') return true; }
  return false;
}
/* The electric field at (x, y), V/Å (a shared array). p (optional): the particle it acts on, for cavities timed
   for one direction and for fast particles that a cavity already has at its energy. */
const _E = [0, 0];
const _Esep = [0, 0]; // (the separators' share of it: they only deflect, see radE)
function Efield(x, y, p) {
  _E[0] = W.Ex; _E[1] = W.Ey; _Esep[0] = 0; _Esep[1] = 0;
  for (const z of W.zones) {
    if (z.kind === 'sep') { // electrostatic separator plates: a field across the beam pipe, pushing opposite charges opposite ways (an injection line comes in beside them)
      if (z.Es && !(p && p.injKick) && zoneLocal(z, x, y)) { const c = Math.cos(z.ang || 0), sn = Math.sin(z.ang || 0); _E[0] -= z.Es * sn; _E[1] += z.Es * c; _Esep[0] -= z.Es * sn; _Esep[1] += z.Es * c; }
      continue;
    }
    if (z.kind !== 'cavity' || !zoneLocal(z, x, y)) continue;
    if (z.beam && (!p || p.beam !== z.beam)) continue;
    const c = Math.cos(z.ang || 0), sn = Math.sin(z.ang || 0);
    let Ez = z.E;
    if (p) {
      const vx = p.rad ? p.ux : p.vx, vy = p.rad ? p.uy : p.vy;
      if (z.dir && (vx * c + vy * sn) * z.dir <= 0) continue; // crossing it the wrong way
      if (p.rad && (z.Emax || z.frac)) {
        const q = p.k === NUC ? (p.anti ? -1 : 1) * Math.max(1, p.Z - p.ne) : p.q;
        if (q * Ez * (c * p.ux + sn * p.uy) > 0) { // pushing it forward: the ring's RF, its voltage programmed with the beam
          let g = Math.abs(Ez);
          const aq = Math.abs(q) || 1; // (energy per pass is charge × field × length)
          if (z.frac) g = Math.min(g, z.frac * p.KE / (z.w * aq)); // a few per cent more energy each pass
          if (z.Emax) g = Math.min(g, 3 * Math.max(0, z.Emax - p.KE) / (z.w * aq)); // closing in on the set energy, never past it
          if (!(g > 0)) continue;
          Ez = Math.sign(Ez) * g;
        }
      }
    }
    _E[0] += Ez * c; _E[1] += Ez * sn;
  }
  return _E;
}
function Bfield(x, y, p) {
  let B = W.Bz;
  if (W.zones.length) B += zonesB(x, y, p);
  const ms = W.magnets;
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i], dx = x - m.x, dy = y - m.y, d2 = dx * dx + dy * dy, R = m.R;
    if (d2 < R * R) { B += m.B; continue; }
    const far = 2.4 * R; // R + 4 widths (0.35 R): beyond it the pole adds nothing
    if (d2 >= far * far) continue;
    const u = (Math.sqrt(d2) - R) / (0.35 * R);
    B += m.B * Math.exp(-u * u);
  }
  return B;
}
function Bgrad(x, y, out) { // returns B and fills out=[dB/dx, dB/dy]
  let B = W.Bz, gx = 0, gy = 0;
  for (const m of W.magnets) {
    const dx = x - m.x, dy = y - m.y, d = Math.hypot(dx, dy);
    if (d < m.R) { B += m.B; continue; }
    const s = 0.35 * m.R, u = (d - m.R) / s;
    if (u > 4) continue;
    const e = Math.exp(-u * u), Bm = m.B * e, dBdd = -2 * u / s * Bm;
    B += Bm; gx += dBdd * dx / d; gy += dBdd * dy / d;
  }
  out[0] = gx; out[1] = gy;
  return B;
}

/* ------------------------------------------------------------------ spatial grid */
const G = { cols: 0, rows: 0, cw: 1, ch: 1, hx: 1, hy: 1, head: new Int32Array(1), next: new Int32Array(1), _list: [], _listN: -1, _listGen: -1, n: 0, nb: null, fw: null,
  key: '', px: new Float64Array(16), py: new Float64Array(16), occ: new Int32Array(16), nocc: 0 };
/* Cell of a point: cells tile the box with a 1 Å margin for closed walls, and exactly for periodic ones, so that the
   cells at opposite edges are neighbours across the boundary (a margin there hid pairs within the cutoff). */
/* G.list: the particles the grid was built over, as objects, in grid order (made the first time it is asked for after a
   build: the force pass itself needs slots only). G.n is their number. */
Object.defineProperty(G, 'list', { get() {
  if (G._listGen === _gridGen && G._listN === G.n) return G._list;
  const L = G._list, n = G.n, OBJ = S.obj, idx = _mdI; L.length = n;
  for (let i = 0; i < n; i++) L[i] = OBJ[idx[i]];
  G._listGen = _gridGen; G._listN = n;
  return L;
} });
let _gridGen = 0;
function gridCell(x, y) {
  let cx = Math.floor((x + G.hx) / G.cw), cy = Math.floor((y + G.hy) / G.ch);
  if (W.wall === 'wrap') { cx = ((cx % G.cols) + G.cols) % G.cols; cy = ((cy % G.rows) + G.rows) % G.rows; }
  else { cx = cx < 0 ? 0 : cx >= G.cols ? G.cols - 1 : cx; cy = cy < 0 ? 0 : cy >= G.rows ? G.rows - 1 : cy; }
  return cy * G.cols + cx;
}
/* Cells are at least the cutoff wide; in a very large box they grow so there are never more than CELL_CAP of them
   (each still finds every pair within the cutoff among its neighbours), and their count changes only in steps of
   a few per cent, so a box being resized does not rebuild the grid at every step. */
const CELL_CAP = 100000;
const gridCount = (x) => { const f = Math.max(1, Math.floor(x)); return f <= 24 ? f : Math.floor(24 * Math.pow(1.04, Math.floor(Math.log(f / 24) / Math.log(1.04)))); };
function buildGrid(idx, n) {
  const pad = W.wall === 'wrap' ? 0 : 2, w = W.box.w + pad, h = W.box.h + pad, cs = Math.max(CELL_MIN, Math.sqrt(w * h / CELL_CAP));
  const cols = gridCount(w / cs), rows = gridCount(h / cs);
  const key = cols + 'x' + rows + W.wall;
  if (key !== G.key) {
    G.key = key; G.cols = cols; G.rows = rows; G.head = new Int32Array(cols * rows);
    const wrap = W.wall === 'wrap', nc = cols * rows;
    G.nb = new Array(nc); G.fw = new Array(nc);
    if (!wrap || (cols >= 3 && rows >= 3)) { // every neighbour cell distinct: the forward half of the 3 × 3 block holds each pair once
      for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
        const nb = [], fw = [];
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          let x = cx + ox, y = cy + oy;
          if (wrap) { x = (x + cols) % cols; y = (y + rows) % rows; } else if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          const n = y * cols + x;
          nb.push(n);
          if (oy > 0 || (oy === 0 && ox > 0)) fw.push(n);
        }
        G.nb[cy * cols + cx] = nb; G.fw[cy * cols + cx] = fw;
      }
    } else { // a periodic box only one or two cells across: neighbours repeat, so each pair is listed once explicitly
      const wrapc = (cx, cy) => ((cy + rows) % rows) * cols + (cx + cols) % cols, seen = new Set();
      for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
        const c = cy * cols + cx, st = new Set(), f = [];
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) st.add(wrapc(cx + ox, cy + oy));
        for (const n of st) {
          if (n === c) continue;
          const k = Math.min(c, n) * 1e6 + Math.max(c, n);
          if (seen.has(k)) continue;
          seen.add(k); f.push(n);
        }
        G.nb[c] = [...st]; G.fw[c] = f;
      }
    }
  }
  G.cw = w / cols; G.ch = h / rows; G.hx = w / 2; G.hy = h / 2;
  G.head.fill(-1);
  if (G.next.length < n) { G.next = new Int32Array(n * 2 + 16); G.px = new Float64Array(n * 2 + 16); G.py = new Float64Array(n * 2 + 16); G.occ = new Int32Array(n * 2 + 16); }
  G.n = n; G.nocc = 0; _gridGen++;
  const X = S.x, Y = S.y, px = G.px, py = G.py, head = G.head, next = G.next, occ = G.occ;
  for (let i = 0; i < n; i++) {
    const x = X[idx[i]], y = Y[idx[i]];
    px[i] = x; py[i] = y;
    const c = gridCell(x, y);
    if (head[c] === -1) occ[G.nocc++] = c; // (the occupied cells, so the force loop skips empty space)
    next[i] = head[c]; head[c] = i;
  }
}
/* ---- neighbour (Verlet) list of the MD particles ----
   Every pair within RC + SKIN at the time it was built, as slot pairs (pi[k], pj[k]); the force loop takes those within
   RC now. The list stays exact while no particle has moved more than SKIN/2 from where it was when the list was built
   (then two particles can have closed in by at most SKIN), and is rebuilt when one has, when the set of MD particles
   has changed (anything born, dead or switched between MD and flight) or when the box has changed. */
const SKIN = 1.0, RL = RC + SKIN, RL2 = RL * RL, HSKIN2 = 0.25 * SKIN * SKIN;
const SKIN_F = 2.0, RLF2 = (RC + SKIN_F) * (RC + SKIN_F), HSKINF2 = 0.25 * SKIN_F * SKIN_F;
const CELL_MIN = RC + Math.max(SKIN, SKIN_F); // (cells at least as wide as either list reaches: a 3 × 3 block of cells holds every partner)
const VL = { gen: -1, bx: new Float64Array(16), by: new Float64Array(16), np: 0, pi: shArray(Int32Array, 4096), pj: shArray(Int32Array, 4096),
  ex: shArray(Uint8Array, 4096), exTopo: -1, exDirty: -1, w: 0, h: 0, wall: '', valid: false, builds: 0, checks: 0 };
function vlValid() {
  VL.checks++;
  if (!VL.valid || VL.gen !== _mdGen || VL.w !== W.box.w || VL.h !== W.box.h || VL.wall !== W.wall) return false;
  const idx = _mdNI, n = _nmdN;
  const X = S.x, Y = S.y, bx = VL.bx, by = VL.by, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2;
  let worst = 0;
  if (wrap) {
    for (let i = 0; i < n; i++) {
      let dx = X[idx[i]] - bx[i], dy = Y[idx[i]] - by[i];
      if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh;
      const d2 = dx * dx + dy * dy; if (d2 > worst) worst = d2;
    }
  } else {
    for (let i = 0; i < n; i++) { const dx = X[idx[i]] - bx[i], dy = Y[idx[i]] - by[i], d2 = dx * dx + dy * dy; if (d2 > worst) worst = d2; }
  }
  return worst <= HSKIN2;
}
function vlBuild() { // from the grid just built over _md (G.px/py are their positions now); nucleus–nucleus pairs only
  VL.builds++;
  const idx = _mdI, n = _nmd, nN = _nmdN, nI = _mdNI, X = S.x, Y = S.y, K = S.k;
  if (VL.bx.length < nN) { VL.bx = new Float64Array(nN * 2 + 16); VL.by = new Float64Array(nN * 2 + 16); }
  for (let q = 0; q < nN; q++) { VL.bx[q] = X[nI[q]]; VL.by[q] = Y[nI[q]]; }
  VL.gen = _mdGen; VL.w = W.box.w; VL.h = W.box.h; VL.wall = W.wall;
  const px = G.px, py = G.py, head = G.head, next = G.next, fw = G.fw, occ = G.occ, nocc = G.nocc;
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2;
  let pi = VL.pi, pj = VL.pj, np = 0, cap = pi.length;
  for (let oc = 0; oc < nocc; oc++) {
    const c = occ[oc], f = fw[c];
    for (let i = head[c]; i !== -1; i = next[i]) {
      const si = idx[i];
      if (K[si] !== NUC) continue;
      const ax = px[i], ay = py[i];
      if (np + n > cap) { cap = cap * 2 + n; const a = shArray(Int32Array, cap); a.set(pi); pi = a; const b = shArray(Int32Array, cap); b.set(pj); pj = b; _sharedGen++; } // (room for this particle's pairs: at most n)
      for (let j = next[i]; j !== -1; j = next[j]) { // same cell
        const sj = idx[j];
        if (K[sj] !== NUC) continue;
        let dx = px[j] - ax, dy = py[j] - ay;
        if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
        if (dx * dx + dy * dy < RL2) { pi[np] = si; pj[np] = sj; np++; }
      }
      for (let q = 0; q < f.length; q++) { // forward neighbour cells
        for (let j = head[f[q]]; j !== -1; j = next[j]) {
          const sj = idx[j];
          if (K[sj] !== NUC) continue;
          let dx = px[j] - ax, dy = py[j] - ay;
          if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
          if (dx * dx + dy * dy < RL2) { pi[np] = si; pj[np] = sj; np++; }
        }
      }
    }
  }
  VL.pi = pi; VL.pj = pj; VL.np = np; VL.valid = true; VL.exTopo = -1;
}
/* Pairs the force loop can skip: two atoms of one molecule that exclude each other (bonded, or 1-3 across an angle
   term), for which atomAtom returns no force (ex = 1); atoms of one molecule that do interact are marked too (ex = 2),
   so the force loop need not look the exclusion up again. Marked once per change of bonding or species, as for the
   angle centres. */
function vlExclusions() {
  const np = VL.np, pi = VL.pi, pj = VL.pj, K = S.k, Z = S.Z, NE = S.ne, MOL = S.mol, ID = S.id, OBJ = S.obj;
  if (VL.ex.length < np) { VL.ex = shArray(Uint8Array, pi.length); _sharedGen++; }
  const ex = VL.ex;
  for (let q = 0; q < np; q++) {
    const i = pi[q], j = pj[q], mi = MOL[i];
    ex[q] = (mi !== 0 && mi === MOL[j] && K[i] === NUC && K[j] === NUC && Z[i] > 0 && Z[j] > 0 && NE[i] > 0 && NE[j] > 0) ? (OBJ[i].excl.has(ID[j]) ? 1 : 2) : 0; // (2: one molecule, not excluded)
  }
  VL.exTopo = W.topo; VL.exDirty = W.dirty;
}
function vlInvalidate() { VL.valid = false; }
/* The forces of all the nucleus pairs in the neighbour list, with their event candidates. One thread here; threads.js
   replaces this when workers are available. */
let _CQ = shArray(Int32Array, 4096);
function candidateRoom(np) { const need = 9 * np + 64; if (_CQ.length < need) _CQ = shArray(Int32Array, need); return _CQ; } // (at most three candidates a pair, one a bond)
let nucleusPairs = function (wrap, bw, bh, hw, hh) {
  bondArrays(); angleCentres();
  const CQ = candidateRoom(VL.np + BD.n), t0 = _profOn ? performance.now() : 0;
  _kStiff = 0;
  let nc;
  if (wasmReady()) { wasmDesc(); nc = wasmForces(0, VL.np, 0, BD.n, 0, AC.n, S.fx, S.fy, CQ, wrap, bw, bh, hw, hh, W.step); }
  else {
    nc = pairKernel(VL.pi, VL.pj, VL.ex, 0, VL.np, S.fx, S.fy, CQ, 0, wrap, bw, bh, hw, hh, W.step);
    nc = bondKernel(0, BD.n, S.fx, S.fy, CQ, nc, wrap, bw, bh, hw, hh);
    angleKernel(0, AC.n, S.fx, S.fy, wrap, bw, bh, hw, hh);
  }
  if (_kStiff > _stiff) _stiff = _kStiff; _kStiff = 0;
  if (_profOn) { _tKernels += performance.now() - t0; TH_LAST.used = 0; }
  evalCandidates(CQ, nc);
};
function cellOf(x, y) { return gridCell(x, y); }
/* Visit grid particles within R of (x, y). cb(p, dx, dy, r2); return false from cb to stop. */
function nearby(x, y, R, cb) {
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, R2 = R * R;
  const sx = Math.ceil(R / G.cw), sy = Math.ceil(R / G.ch);
  const ccx = Math.floor((x + G.hx) / G.cw), ccy = Math.floor((y + G.hy) / G.ch);
  let x0 = ccx - sx, x1 = ccx + sx, y0 = ccy - sy, y1 = ccy + sy;
  if (!wrap) { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(G.cols - 1, x1); y1 = Math.min(G.rows - 1, y1); }
  else { if (x1 - x0 + 1 >= G.cols) { x0 = 0; x1 = G.cols - 1; } if (y1 - y0 + 1 >= G.rows) { y0 = 0; y1 = G.rows - 1; } }
  const L = G.list;
  for (let cy = y0; cy <= y1; cy++) {
    const ry = wrap ? ((cy % G.rows) + G.rows) % G.rows : cy;
    for (let cx = x0; cx <= x1; cx++) {
      const rx = wrap ? ((cx % G.cols) + G.cols) % G.cols : cx;
      for (let i = G.head[ry * G.cols + rx]; i !== -1; i = G.next[i]) {
        const p = L[i];
        if (p.dead) continue;
        let dx = p.x - x, dy = p.y - y;
        if (wrap) { if (dx > bw / 2) dx -= bw; else if (dx < -bw / 2) dx += bw; if (dy > bh / 2) dy -= bh; else if (dy < -bh / 2) dy += bh; }
        const r2 = dx * dx + dy * dy;
        if (r2 <= R2 && cb(p, dx, dy, r2) === false) return;
      }
    }
  }
}

/* ------------------------------------------------------------------ pair interactions */
let _noEv = false;
function queue(type, a, b, c, r) { if (!_noEv) W.evq.push({ type, a, b, c, r }); }

/* Short-range core. Inside the contact point c, where the Lennard-Jones wall is continued linearly (its
   r⁻¹² growth is too stiff to integrate), the screened-nuclear repulsion takes over: the curvature of the
   Ziegler–Biersack–Littmark universal potential beyond its tangent at c, so energy and force join smoothly
   at c and climb steeply inside it (U–H: about 20 eV at 1 Å and 200 eV at 0.5 Å). This is what stops two
   atoms passing through one another however hard they are pushed. */
function zblA(Z1, Z2) { return 0.46850 / (Math.pow(Z1, 0.23) + Math.pow(Z2, 0.23)); }
function zblV(k, a, r) {
  const x = r / a;
  return k / r * (0.1818 * Math.exp(-3.2 * x) + 0.5099 * Math.exp(-0.9423 * x) + 0.2802 * Math.exp(-0.4029 * x) + 0.02817 * Math.exp(-0.2016 * x));
}
function zblD(k, a, r) { // dV/dr
  const x = r / a;
  const e1 = Math.exp(-3.2 * x), e2 = Math.exp(-0.9423 * x), e3 = Math.exp(-0.4029 * x), e4 = Math.exp(-0.2016 * x);
  const phi = 0.1818 * e1 + 0.5099 * e2 + 0.2802 * e3 + 0.02817 * e4;
  const dphi = -(0.58176 * e1 + 0.48048 * e2 + 0.11289 * e3 + 0.005679 * e4) / a;
  return k * (dphi / r - phi / (r * r));
}
const CORE_RMIN = 0.02; // Å: below this the core is continued linearly (only ever reached by numerical accident)
const K_COUL = PHYS.KE; // (the pair kernel's Coulomb constant as a plain name, for the worker)
/* Stiffest close contact this step, as curvature over reduced mass (1/tu²): chooseDt keeps ω·dt small there,
   so hard collisions are integrated as accurately as gentle ones. */
let _stiff = 0, _stiffL = 0, _lepEvOff = false;
function noteStiff(k, a, b) {
  const w = k * (a.im + b.im);
  if (a.k !== NUC || b.k !== NUC) { if (w > _stiffL) _stiffL = w; } else if (w > _stiff) _stiff = w;
}
function zblD2(k, a, r) { // d²V/dr²
  const x = r / a;
  const e1 = Math.exp(-3.2 * x), e2 = Math.exp(-0.9423 * x), e3 = Math.exp(-0.4029 * x), e4 = Math.exp(-0.2016 * x);
  const phi = 0.1818 * e1 + 0.5099 * e2 + 0.2802 * e3 + 0.02817 * e4;
  const d1 = -(0.58176 * e1 + 0.48048 * e2 + 0.11289 * e3 + 0.005679 * e4) / a;
  const d2 = (1.861632 * e1 + 0.452756 * e2 + 0.045483 * e3 + 0.001145 * e4) / (a * a);
  return k * (d2 / r - 2 * d1 / (r * r) + 2 * phi / (r * r * r));
}
function coreV(a, b, r, c) {
  if (r >= c) return 0;
  const k = PHYS.KE * a.Z * b.Z, al = zblA(a.Z, b.Z), rr = Math.max(r, CORE_RMIN);
  let V = zblV(k, al, rr) - zblV(k, al, c) - zblD(k, al, c) * (rr - c);
  if (r < CORE_RMIN) V += -(zblD(k, al, CORE_RMIN) - zblD(k, al, c)) * (CORE_RMIN - r);
  return V;
}
/* Lennard-Jones size and depth for a pair. Ions of opposite charge get a Born wall stiff enough to balance
   their Coulomb pull near contact (equilibrium ≈ 0.94 rm): free ions sized by their Shannon radii, charged
   atoms held in molecules by their van der Waals size. Without it a bonded cation and an anion could
   collapse onto each other. */
function ljPair(a, b) {
  if (a.ionic && b.ionic && a.q * b.q < 0) { const rm = a.ionR + b.ionR; return [rm, PHYS.KE * Math.abs(a.q * b.q) / (12 * rm)]; }
  const rm = 0.5 * (a.ljR + b.ljR);
  let eps = a.ljS * b.ljS;
  if (a.q * b.q < 0) eps = Math.max(eps, PHYS.KE * Math.abs(a.q * b.q) / (12 * rm));
  return [rm, eps];
}
/* Non-bonded atoms of the same molecule meet a softer wall than atoms of different molecules: half as deep and
   levelling off at 0.8 rm into a gentle constant push, with the contact core only below 0.45 rm. Force fields
   scale their 1-4 terms for the same reason, and on a flat page crowding is far worse than in 3-D (every pair
   of neighbouring sp³ centres is eclipsed): the full wall would push crowded groups apart harder than the bonds
   between them can hold, tearing branched molecules in two. Pairs whose partial charges attract (an –OH next
   to an oxygen further along the chain) keep the full wall, or the hydrogen bond would collapse. */
function softPair(a, b) { return a.mol !== 0 && a.mol === b.mol && (a.q + a.qp) * (b.q + b.qp) > -0.06; }
const LJ_VCUT = 2 * Math.pow(2.6, -6) - Math.pow(2.6, -12); // shift to zero at the 2.6·rm cutoff
function ljV(a, b, r) {
  let [rm, eps] = ljPair(a, b);
  if (eps <= 0 || r > 2.6 * rm) return 0;
  const sm = softPair(a, b);
  if (sm) eps *= 0.5;
  const c = (sm ? 0.8 : 0.62) * rm;
  if (r >= c) { const s6 = Math.pow(rm / r, 6); return eps * (s6 * s6 - 2 * s6 + LJ_VCUT); }
  const s6 = Math.pow(rm / c, 6), cc = sm ? 0.45 * rm : c;
  return eps * (s6 * s6 - 2 * s6 + LJ_VCUT) + 12 * eps * (s6 * s6 - s6) / c * (c - r) + coreV(a, b, r, cc);
}
function pairNonbondedV(a, b, r) { // LJ + Coulomb between two atoms (energy that disappears when they bond)
  const qa = a.q + a.qp, qb = b.q + b.qp;
  return ljV(a, b, r) + (qa && qb ? PHYS.KE * qa * qb * (1 / Math.sqrt(r * r + 0.09) - csh(a, b, 0.09)) : 0);
}
/* Coulomb energies inside the cutoff are shifted to zero at RC, except between net charges whose
   long-range part is summed exactly beyond it — so crossing the cutoff never creates energy. */
let _lrOn = false;
function isLR(p) { return p.k !== NUC || Math.abs(p.q) >= 1; }
/* Charge of a as felt by b. Free electrons and positrons see net charges only: partial charges stand for
   bond dipoles, whose weak pull on a free electron is outweighed close up by Pauli repulsion from the
   molecule's own electrons. (Kept, they would let an electron sit inside a water molecule's H atom.) */
function qx(a, b) { return a.k === NUC && b.k === NUC ? a.q + a.qp : a.q; }
function csh(a, b, s) { return (_lrOn && isLR(a) && isLR(b)) ? 0 : 1 / Math.sqrt(RC2 + s); }
/* A bare nucleus meeting an atom or ion. The ion's net charge lives in its electron cloud, so close in it acts
   like charge spread through a ball of radius BARE_SMEAR (exact Coulomb outside the ball). As a point charge it
   let a proton sink about 40 eV deep inside an anion, a state that does not exist: a real proton bonds to an
   anion or takes its electron first, and from that depth neither looked affordable, so it stayed stuck inside. */
const BARE_SMEAR = 2.0;
function smearV(r) { const a = BARE_SMEAR; return r >= a ? 1 / r : (3 * a * a - r * r) / (2 * a * a * a); }
function smearF(r) { const a = BARE_SMEAR; return r >= a ? 1 / (r * r) : r / (a * a * a); }
function cshPt(a, b) { return (_lrOn && isLR(a) && isLR(b)) ? 0 : 1 / RC; }
/* Non-bonded energy between a set of atoms and everything around it (atoms outside the set). */
function envEnergy(set) {
  let V = 0;
  for (const p of set) {
    if (p.k !== NUC || p.ne === 0) continue;
    nearby(p.x, p.y, RC, (o, dx, dy, r2) => {
      if (set.has(o) || o.k !== NUC || o.ne === 0 || o.fast || o.rad) return;
      if (p.mol !== 0 && p.mol === o.mol) return;
      V += pairNonbondedV(p, o, Math.sqrt(r2));
    });
  }
  return V;
}
/* Does p hold its bonds at VSEPR angles? (Transition metals and f-block atoms do not, here.) */
function angled(p) { const n = p.bonds.length; return n >= 2 && n <= 6 && !!p.el && !p.el.dblock; }
/* Bending energy of a VSEPR centre: ½K Σ(gap − target)². */
function angleEnergy(p) {
  const n = p.bonds.length;
  if (n < 2 || n > 6 || !p.el || p.el.dblock) return 0;
  const ang = [];
  for (const bd of p.bonds) { const o = other(bd, p); const [dx, dy] = minImg(o.x - p.x, o.y - p.y); ang.push(Math.atan2(dy, dx)); }
  ang.sort((x, y) => x - y);
  const gaps = []; for (let k = 0; k < n; k++) gaps.push(k === n - 1 ? ang[0] + 2 * Math.PI - ang[k] : ang[k + 1] - ang[k]);
  const tg = angleTargets(p, n).slice().sort((x, y) => x - y);
  const gs = gaps.slice().sort((x, y) => x - y);
  let E = 0; for (let k = 0; k < n; k++) E += 0.5 * ANGLE_K * (gs[k] - tg[k]) * (gs[k] - tg[k]);
  return E;
}
/* Potential energy that a chemical event can change: bonds, bends and non-bonded terms of the set
   with itself and its surroundings. Used to make bond-making and -breaking conserve energy. */
function localPE(set, skip) {
  let V = 0;
  const seenB = new Set(), centres = new Set();
  for (const p of set) {
    centres.add(p);
    for (const bd of p.bonds) {
      const o = other(bd, p); centres.add(o);
      if (!seenB.has(bd)) { seenB.add(bd); V += -bd.D - bd.Ef + morseV(bd, dist(bd.a, bd.b)); }
    }
  }
  for (const c of centres) V += angleEnergy(c);
  if (W.magnets.length) { const kT = PHYS.KB * Math.max(W.T, 1); for (const p of set) if (!p.dead) V += magU(p, kT); }
  farMetalPairs((a, b, dx, dy, r) => { V += metalV(a, b, r); }, set);
  if (W.wall === 'reflect') { // soft walls
    const hw = W.box.w / 2, hh = W.box.h / 2;
    for (const p of set) {
      if (p.fast || p.rad || p.k !== NUC) continue;
      const k = wallK(p);
      if (p.x > hw) V += 0.5 * k * (p.x - hw) ** 2; else if (p.x < -hw) V += 0.5 * k * (-hw - p.x) ** 2;
      if (p.y > hh) V += 0.5 * k * (p.y - hh) ** 2; else if (p.y < -hh) V += 0.5 * k * (-hh - p.y) ** 2;
    }
  }
  for (const p of set) {
    if (p.k !== NUC || p.Z === 0 || p.fast || p.rad || p.dead) continue;
    const qn = p.q;
    const visit = (o, dx, dy, r2) => {
      if (o === p || o === skip || o.fast || o.rad) return;
      if (o.k !== NUC) { if (qn) V += PHYS.KE * qn * o.q * (1 / Math.sqrt(r2 + p.sEN) - csh(p, o, p.sEN)); return; } // free leptons
      if (o.Z === 0) return;
      if (set.has(o) && o.id < p.id) return;
      if (p.mol !== 0 && p.mol === o.mol && p.excl && p.excl.has(o.id)) return;
      V += nucPairV(p, o, r2);
    };
    nearby(p.x, p.y, RC, visit);
    for (const o of _late) { // created since the grid was built
      if (o.dead || o.rad || o.fast) continue;
      const dx = o.x - p.x, dy = o.y - p.y, r2 = dx * dx + dy * dy;
      if (r2 < RC2) visit(o, dx, dy, r2);
    }
  }
  if (_lrOn) { // exact long-range Coulomb between net charges beyond the cutoff (as in computeForces)
    for (const p of set) {
      if (p.k !== NUC || p.dead || p.fast || p.rad || !isLR(p)) continue;
      for (const o of _charged) {
        if (o === p || o === skip || o.dead || o.fast || o.rad || !isLR(o) || (set.has(o) && o.id < p.id)) continue;
        const dx = o.x - p.x, dy = o.y - p.y, r2 = dx * dx + dy * dy;
        if (r2 >= RC2) V += PHYS.KE * qx(p, o) * qx(o, p) / Math.sqrt(r2);
      }
    }
  }
  return V;
}
/* Non-bonded potential between two nuclei/atoms, exactly as used by the forces (see pairForce). */
function nucPairV(p, o, r2) {
  if (opp(p, o)) {
    const qa = p.q + p.qp, qb = o.q + o.qp;
    if (!qa || !qb) return 0;
    const sf = p.ne > 0 && o.ne > 0 ? 0.09 : (p.ne === 0 && o.ne === 0) ? 0.0016 : 0.04;
    return PHYS.KE * qa * qb * (1 / Math.sqrt(r2 + sf) - csh(p, o, sf));
  }
  const r = Math.sqrt(r2);
  if (p.ne > 0 && o.ne > 0) return (p.isMetal && o.isMetal) ? metalV(p, o, r) + coulAA(p, o, r2) : pairNonbondedV(p, o, r);
  const qa = p.q + p.qp, qb = o.q + o.qp;
  let V = 0;
  if (qa && qb) {
    if (p.ne === 0 && o.ne === 0) V += PHYS.KE * qa * qb * (1 / Math.sqrt(r2 + 0.0016) - csh(p, o, 0.0016));
    else V += PHYS.KE * qa * qb * (smearV(r) - cshPt(p, o));
  }
  const w = p.ne === 0 ? o : p;
  if (w.ne > 0) { const rw = 0.55 * w.el.rc + 0.25; if (r < rw) V += 4 * (rw - r) * (rw - r) / rw + coreV(p, o, r, rw); }
  return V;
}
function coulAA(a, b, r2) { const qa = a.q + a.qp, qb = b.q + b.qp; return qa && qb ? PHYS.KE * qa * qb * (1 / Math.sqrt(r2 + 0.09) - csh(a, b, 0.09)) : 0; }
/* Electronic energy held by an atom's bound electrons (relative to the bare nucleus): minus the energy to strip
   them one by one, −Σ ionE (for extra electrons, the electron affinities, negative for the unbound ones). Changes
   in it are paid for or released by every event. */
function internalE(p) {
  if (p.k !== NUC || p.Z === 0 || p.ne === 0) return 0;
  let E = 0;
  for (let k = 1; k <= p.ne; k++) E -= ionE(p.Z, k);
  return E;
}
function neutralInternalE(p) { // the same atom with as many electrons as protons
  if (p.k !== NUC || p.Z === 0) return 0;
  let E = 0; for (let k = 1; k <= p.Z; k++) E -= ionE(p.Z, k);
  return E;
}
function metalV(a, b, r) {
  const rm = 0.5 * (a.mR + b.mR);
  if (r > 2.1 * rm) return 0;
  const D = Math.sqrt(a.mD * b.mD), al = 3.5 / rm, c = 0.6 * rm;
  if (r >= c) { const e = Math.exp(-al * (r - rm)); return D * (1 - e) * (1 - e) - D + D * METAL_VCUT; }
  const e = Math.exp(-al * (c - rm));
  return D * (1 - e) * (1 - e) - D + D * METAL_VCUT + 2 * D * al * (e - 1) * e * (c - r) + coreV(a, b, r, c);
}
const METAL_VCUT = 1 - (1 - Math.exp(-3.85)) ** 2; // shift to zero at the 2.1·rm cutoff
function setOf(...mols) { const s = new Set(); for (const m of mols) for (const p of m) s.add(p); return s; }

/* Bring two molecules (rigidly) to separation r0 between atoms a and b, removing their relative radial
   velocity. Momentum is conserved. Returns the kinetic energy removed minus the non-bonded energy gained
   against the surroundings, i.e. the energy to be released as heat. */
function snapTogether(a, b, r0) {
  W.dirty++;
  const ma = molecule(a), mb = molecule(b);
  if (ma.includes(b)) return 0;
  let Ma = 0, Mb = 0, pax = 0, pay = 0, pbx = 0, pby = 0;
  for (const p of ma) { Ma += p.m; pax += p.m * p.vx; pay += p.m * p.vy; }
  for (const p of mb) { Mb += p.m; pbx += p.m * p.vx; pby += p.m * p.vy; }
  const [dx, dy] = minImg(b.x - a.x, b.y - a.y);
  const r = Math.hypot(dx, dy) || 1e-6, ux = dx / r, uy = dy / r, M = Ma + Mb;
  const sh = r - r0;
  for (const p of ma) { p.x += ux * sh * Mb / M; p.y += uy * sh * Mb / M; }
  for (const p of mb) { p.x -= ux * sh * Ma / M; p.y -= uy * sh * Ma / M; }
  const vr = (pbx / Mb - pax / Ma) * ux + (pby / Mb - pay / Ma) * uy;
  const mu = Ma * Mb / M;
  for (const p of ma) { p.vx += ux * vr * Mb / M; p.vy += uy * vr * Mb / M; }
  for (const p of mb) { p.vx -= ux * vr * Ma / M; p.vy -= uy * vr * Ma / M; }
  return 0.5 * mu * vr * vr;
}
/* Metal pairs farther apart than the cutoff RC but within their metallic reach 2.1·r_m: cb(a, b, dx, dy, r) once
   per pair (dx, dy: b − a). set: only pairs with a member in it (for localPE). */
let MR_MAX = 0;
function isFarMetal(p) { return p.isMetal && p.k === NUC && p.ne > 0 && !p.dead && !p.fast && !p.rad && 2.1 * p.mR > RC; }
let _farMetalSeen = false; // (set by setSize when such an atom is made; cleared with the world)
function farMetalPairs(cb, set) {
  if (!G.n || !_farMetalSeen) return;
  if (!MR_MAX) for (const el of ELEMENTS) if (el && el.metal) MR_MAX = Math.max(MR_MAX, 2 * el.rc * 1.12);
  const src = set || G.list;
  for (const a of src) {
    if (!isFarMetal(a)) continue;
    nearby(a.x, a.y, 1.05 * (a.mR + MR_MAX), (b, dx, dy, r2) => {
      if (b === a || r2 < RC2 || !b.isMetal || b.k !== NUC || b.ne === 0 || b.fast || b.rad || b.dead) return;
      const rm = 0.5 * (a.mR + b.mR);
      if (r2 >= 4.41 * rm * rm) return;
      if (isFarMetal(b) && b.id < a.id && (!set || set.has(b))) return; // both reach this far: count the pair once
      if (opp(a, b) || (a.mol !== 0 && a.mol === b.mol && a.excl && a.excl.has(b.id))) return;
      cb(a, b, dx, dy, Math.sqrt(r2));
    });
  }
}
function metalF(a, b, r) { // by handle (farMetalPairs): metalFI of the pair kernel, its stiffness note taken over
  _kStiff = 0;
  const f = metalFI(a.i, b.i, r);
  if (_kStiff > _stiff) _stiff = _kStiff; _kStiff = 0;
  return f;
}
const _bpCache = new Map();
/* Cached single-bond parameters for an element pair: [r0, D, alpha, rForm]. */
function bondParams1(ea, eb) {
  const key = ea.Z < eb.Z ? ea.Z * 128 + eb.Z : eb.Z * 128 + ea.Z;
  let v = _bpCache.get(key);
  if (!v) {
    const r0 = bondLength(ea, eb, 1), D = bondEnergy(ea, eb, 1), al = morseA(ea, eb, 1);
    v = [r0, D, al, r0 + 0.8 * 2.97 / al];
    _bpCache.set(key, v);
  }
  return v;
}
function covalentOK(a, b) {
  if (!a.el || !b.el || a.ne === 0 || b.ne === 0 || opp(a, b)) return false;
  if (a.el.metal && b.el.metal) return false;
  if ((a.el.metal || b.el.metal) && Math.abs((a.el.en || 2.5) - (b.el.en || 2.5)) >= 1.7) return false;
  return true;
}

const _rxCache = new Map();
/* Radical X attacking a saturated atom A: best exchange channel (Semenov–Polanyi activation energy). */
function reaction(X, A) {
  const key = X.id * 131072 + A.id;
  const c = _rxCache.get(key);
  if (c && c.topo === W.topo && W.step - c.step < 40) return c.rx;
  let best = null;
  if (covalentOK(X, A) && A.cap + A.used > 0 && !bondBetween(X, A) && canTake(X, A)) {
    const DXA = bondEnergy(X.el, A.el, 1);
    for (const bd of A.bonds) {
      const B = other(bd, A);
      if (B === X) continue;
      const DAB = bd.D;
      // abstraction: X + A–B → X–A + B
      let dH = DAB - DXA;
      let Ea = dH < 0 ? Math.max(0.05, 0.5 + 0.25 * dH) : 0.5 + 0.75 * dH;
      if (!best || Ea < best.Ea) best = { type: 'abs', bd, dH, Ea };
      // addition to a multiple bond: X + A=B → X–A–B·
      if (bd.order >= 2) {
        dH = (DAB - bondEnergy(A.el, B.el, bd.order - 1)) - DXA;
        Ea = dH < 0 ? Math.max(0.05, 0.5 + 0.25 * dH) : 0.5 + 0.75 * dH;
        if (Ea < best.Ea) best = { type: 'add', bd, dH, Ea };
      }
    }
    if (best) {
      // nearby transition-metal catalyst lowers the barrier
      let cat = false;
      nearby(A.x, A.y, 4.5, (p) => { if (p.el && CATALYSTS.has(p.Z) && p.ne > 0 && p !== A && p !== X) { cat = true; return false; } });
      if (cat) best.Ea *= 0.4;
      best.cat = cat;
      const bp = bondParams1(X.el, A.el);
      best.r0 = bp[0]; best.rTest = bp[3]; best.topo = W.topo;
    }
  }
  _rxCache.set(key, { topo: W.topo, step: W.step, rx: best });
  if (_rxCache.size > 20000) _rxCache.clear();
  return best;
}

/* ======================================================================== PAIR KERNEL BEGIN
   The forces between two nuclei, atoms or ions (everything in pairForce's nucleus branch, with the stiffness note),
   reading the store S alone — no particle objects — so the same text runs inside a Web Worker on the shared store.
   Whatever needs the objects (the chemistry of an event) is not decided here: the kernel notes a *candidate*
   (kind, i, j) in a queue, and the main thread turns candidates into events (evalCandidates), in the order they
   were noted. Forces go to the output arrays FXo/FYo (the store's own fx/fy on one thread, a worker's buffer
   otherwise); the stiffest contact met is left in _kStiff. Everything the kernel uses is defined inside the
   markers or in the kernel prelude (KERNEL_GLOBALS). */
const CAND_BOND = 1, CAND_REACT = 2, CAND_XFER = 3, CAND_HOT = 4, CAND_ANTI = 5, CAND_DATIVE = 6, CAND_XFERB = 7, CAND_BREAK = 8; // (XFERB: bare nucleus and atom; BREAK: a bond, by its index)
let _kStiff = 0;
function kStiff(k, i, j) { const w = k * (S.im[i] + S.im[j]); if (w > _kStiff) _kStiff = w; }
function coreFI(i, j, r, c) { // repulsive force (positive outwards) of the screened-nuclear core inside the contact point c
  if (r >= c) return 0;
  const Zi = S.Z[i], Zj = S.Z[j], k = K_COUL * Zi * Zj, al = zblA(Zi, Zj), rr = r > CORE_RMIN ? r : CORE_RMIN;
  kStiff(zblD2(k, al, rr), i, j);
  return -(zblD(k, al, rr) - zblD(k, al, c));
}
function ljFI(i, j, r, qa, qb) { // Lennard-Jones with the Born wall, soft intramolecular wall and the core (ljPair, softPair, ljF)
  const qi = S.q[i], qj = S.q[j], qq = qi * qj;
  let rm, eps;
  if (S.ionic[i] === 1 && S.ionic[j] === 1 && qq < 0) { rm = S.ionR[i] + S.ionR[j]; eps = K_COUL * Math.abs(qq) / (12 * rm); }
  else {
    rm = 0.5 * (S.ljR[i] + S.ljR[j]);
    eps = S.ljS[i] * S.ljS[j];
    if (qq < 0) eps = Math.max(eps, K_COUL * Math.abs(qq) / (12 * rm));
  }
  if (eps <= 0 || r > 2.6 * rm) return 0;
  const mi = S.mol[i], sm = mi !== 0 && mi === S.mol[j] && qa * qb > -0.06; // (softPair)
  if (sm) eps *= 0.5;
  const c = (sm ? 0.8 : 0.62) * rm, rr = r < c ? c : r;
  const sr = rm / rr, s3 = sr * sr * sr, s6 = s3 * s3;
  if (r < 0.8 * rm && r >= c) kStiff(eps * (156 * s6 * s6 - 84 * s6) / (rr * rr), i, j);
  const cc = sm ? 0.45 * rm : c;
  return 12 * eps * (s6 * s6 - s6) / rr + (r < cc ? coreFI(i, j, r, cc) : 0);
}
function metalFI(i, j, r) {
  const rm = 0.5 * (S.mR[i] + S.mR[j]);
  if (r > 2.1 * rm) return 0;
  const D = Math.sqrt(S.mD[i] * S.mD[j]), al = 3.5 / rm;
  const c = 0.6 * rm, rr = r < c ? c : r;
  const e = Math.exp(-al * (rr - rm));
  if (r < 0.85 * rm && r >= c) kStiff(2 * D * al * al * e * (2 * e - 1), i, j);
  return -2 * D * al * (1 - e) * e + (r < c ? coreFI(i, j, r, c) : 0);
}
/* Matter–antimatter pair: Coulomb only, annihilation once the electron clouds or nuclei touch. */
function antiPairI(i, j, r, CQ, nc) {
  const qa = S.q[i] + S.qp[i], qb = S.q[j] + S.qp[j], ni = S.ne[i], nj = S.ne[j];
  const soft = ni > 0 && nj > 0 ? 0.09 : (ni === 0 && nj === 0) ? 0.0016 : 0.04;
  let f = 0;
  if (qa !== 0 && qb !== 0) {
    const s2 = r * r + soft; f = K_COUL * qa * qb * r / (s2 * Math.sqrt(s2));
    if (r < 3) kStiff(K_COUL * Math.abs(qa * qb) * (Math.abs(soft - 2 * r * r) + s2) / (s2 * s2 * Math.sqrt(s2)), i, j);
  }
  const touch = ni > 0 && nj > 0 ? 0.5 * (S.ljR[i] + S.ljR[j]) : ni > 0 ? 0.55 * S.elrc[i] + 0.25 : nj > 0 ? 0.55 * S.elrc[j] + 0.25 : R_ANN;
  if (r < touch) { CQ[nc] = CAND_ANTI; CQ[nc + 1] = i; CQ[nc + 2] = j; nc += 3; }
  _kN = nc;
  return f;
}
let _kN = 0; // (candidates written so far, passed back from the helpers)
/* All nucleus pairs q0 ≤ q < q1 of the neighbour list (pi, pj with exclusion marks ex): forces into FXo/FYo, candidates
   into CQ from entry nc0 on (3 ints each). Returns the number of entries in CQ. */
function pairKernel(pi, pj, ex, q0, q1, FXo, FYo, CQ, nc0, wrap, bw, bh, hw, hh, step) {
  const X = S.x, Y = S.y, Z = S.Z, NE = S.ne, Q = S.q, QP = S.qp, ANTI = S.anti, ISM = S.isMetal, CAP = S.cap, USED = S.used, XD = S.xferD, XA = S.xferA, ID = S.id;
  const LJR = S.ljR, VX = S.vx, VY = S.vy, M = S.m, ELRC = S.elrc, LP = S.lp, MET = S.metal;
  let nc = nc0;
  for (let q = q0; q < q1; q++) {
    const exq = ex[q];
    if (exq === 1) continue;
    const i = pi[q], j = pj[q];
    let dx = X[j] - X[i], dy = Y[j] - Y[i];
    if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
    const r2 = dx * dx + dy * dy;
    if (!(r2 < RC2 && r2 > 1e-10)) continue;
    const Zi = Z[i], Zj = Z[j];
    if (Zi === 0 || Zj === 0) continue; // neutrons fly straight
    const r = Math.sqrt(r2), ni = NE[i], nj = NE[j];
    let f = 0;
    if (ANTI[i] !== ANTI[j]) { _kN = nc; f = antiPairI(i, j, r, CQ, nc); nc = _kN; }
    else if (ni > 0 && nj > 0) { // two atoms or ions (atomAtom)
      const qi = Q[i], qj = Q[j], qa = qi + QP[i], qb = qj + QP[j];
      if (qa !== 0 && qb !== 0) { const s2 = r * r + 0.09; f += K_COUL * qa * qb * r / (s2 * Math.sqrt(s2)); }
      if (ISM[i] === 1 && ISM[j] === 1) f += metalFI(i, j, r);
      else {
        f += ljFI(i, j, r, qa, qb);
        const fa = CAP[i] - USED[i], fb = CAP[j] - USED[j];
        if (fa > 0 && fb > 0) { if (r < 3.6) { CQ[nc] = CAND_BOND; CQ[nc + 1] = i; CQ[nc + 2] = j; nc += 3; } } // two radicals: a bond may form
        else if ((fa > 0) !== (fb > 0) && r < 3.6) { CQ[nc] = CAND_REACT; CQ[nc + 1] = fa > 0 ? i : j; CQ[nc + 2] = fa > 0 ? j : i; nc += 3; } // a radical at a molecule: a reaction may run
      }
      // electron transfer (ionic bonding, charge exchange) — checked occasionally for candidate pairs
      if (((XD[i] === 1 && XA[j] === 1) || (XD[j] === 1 && XA[i] === 1)) && (qi <= 0 || qj <= 0) && r < 5.5 && ((step + ID[i] + ID[j]) % 8 === 0)) { CQ[nc] = CAND_XFER; CQ[nc + 1] = i; CQ[nc + 2] = j; nc += 3; }
      // energetic collisions can excite or ionize
      const contact = 0.42 * (LJR[i] + LJR[j]);
      if (r < contact) {
        const dvx = VX[j] - VX[i], dvy = VY[j] - VY[i], v2 = dvx * dvx + dvy * dvy;
        const mu = M[i] * M[j] / (M[i] + M[j]);
        if (0.5 * mu * v2 > 1.4) { CQ[nc] = CAND_HOT; CQ[nc + 1] = i; CQ[nc + 2] = j; nc += 3; }
      }
    } else { // a bare nucleus meeting an atom, ion or another bare nucleus (bareInteract)
      const bare = ni === 0 ? i : j, o = ni === 0 ? j : i;
      const qa = Q[i] + QP[i], qb = Q[j] + QP[j];
      if (qa !== 0 && qb !== 0) {
        if (ni === 0 && nj === 0) {
          const soft = 0.0016, s2 = r * r + soft; f += K_COUL * qa * qb * r / (s2 * Math.sqrt(s2));
          if (r < 3 && qa * qb < 0) kStiff(K_COUL * Math.abs(qa * qb) * (Math.abs(soft - 2 * r * r) + s2) / (s2 * s2 * Math.sqrt(s2)), i, j);
        } else {
          f += K_COUL * qa * qb * (r >= BARE_SMEAR ? 1 / (r * r) : r / (BARE_SMEAR * BARE_SMEAR * BARE_SMEAR)); // (smearF)
          if (r < 3 && qa * qb < 0) kStiff(K_COUL * Math.abs(qa * qb) * (r >= BARE_SMEAR ? 2 / (r * r * r) : 1 / (BARE_SMEAR * BARE_SMEAR * BARE_SMEAR)), i, j);
        }
      }
      if (NE[o] > 0) {
        const rc = ELRC[o], rw = 0.55 * rc + 0.25;
        if (r < rw) f += 8 * (rw - r) / rw + coreFI(i, j, r, rw);
        if (r < rc + 0.5) {
          if (Z[bare] === 1 && LP[o] > 0 && MET[o] === 0) { CQ[nc] = CAND_DATIVE; CQ[nc + 1] = bare; CQ[nc + 2] = o; nc += 3; }
          else if ((step + ID[i] + ID[j]) % 3 === 0) { CQ[nc] = CAND_XFERB; CQ[nc + 1] = o; CQ[nc + 2] = bare; nc += 3; }
        }
      }
    }
    if (f > FCAP) f = FCAP; else if (f < -FCAP) f = -FCAP;
    const fx = f * dx / r, fy = f * dy / r;
    FXo[j] += fx; FYo[j] += fy; FXo[i] -= fx; FYo[i] -= fy;
  }
  return nc;
}
/* The bonds b0 ≤ k < b1 (Morse): forces, and a break candidate where a bond is stretched past rb. */
function bondKernel(b0, b1, FXo, FYo, CQ, nc, wrap, bw, bh, hw, hh) {
  const X = S.x, Y = S.y, A = BD.a, B = BD.b, R0 = BD.r0, AL = BD.al, DD = BD.D, RB = BD.rb;
  for (let k = b0; k < b1; k++) {
    const i = A[k], j = B[k];
    let dx = X[j] - X[i], dy = Y[j] - Y[i];
    if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
    const r = Math.sqrt(dx * dx + dy * dy) || 1e-6;
    const d = r - R0[k], al = AL[k];
    const e = Math.exp(-al * (d < -0.6 ? -0.6 : d));
    let f = -2 * DD[k] * al * (1 - e) * e;
    if (f > FCAP) f = FCAP; else if (f < -FCAP) f = -FCAP;
    const fx = f * dx / r, fy = f * dy / r;
    FXo[j] += fx; FYo[j] += fy; FXo[i] -= fx; FYo[i] -= fy;
    if (d > RB[k]) { CQ[nc] = CAND_BREAK; CQ[nc + 1] = k; CQ[nc + 2] = 0; nc += 3; }
  }
  return nc;
}
/* The angle (VSEPR) terms of centres c0 ≤ c < c1 (AC: centre slot, neighbour slots, target angles). */
const _ang = new Float64Array(6), _rad = new Float64Array(6), _nbr = new Int32Array(6), _gap = new Float64Array(6), _tgt = new Float64Array(6), _ord = new Int32Array(6), _sn = new Float64Array(6), _cs = new Float64Array(6);
const _gi = new Int32Array(6), _ts = new Float64Array(6);
function angleKernel(c0, c1, FXo, FYo, wrap, bw, bh, hw, hh) {
  const X = S.x, Y = S.y, cs = AC.c, nbs = AC.nb, cnt = AC.cnt, tgs = AC.tg;
  for (let c = c0; c < c1; c++) {
    const pc = cs[c], n = cnt[c], px = X[pc], py = Y[pc], b0 = c * 6;
    for (let i = 0; i < n; i++) {
      const o = nbs[b0 + i];
      let dx = X[o] - px, dy = Y[o] - py;
      if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
      const rr = Math.sqrt(dx * dx + dy * dy); // (not Math.hypot: its overflow guard costs more than the whole centre)
      _nbr[i] = o; _rad[i] = rr < 0.3 ? 0.3 : rr; _ord[i] = i;
      if (rr > 0) { _sn[i] = dy / rr; _cs[i] = dx / rr; } else { _sn[i] = 0; _cs[i] = 1; } // (sin and cos of the bond's direction)
      if (n > 2) _ang[i] = Math.atan2(dy, dx);
    }
    if (n === 2) { // two bonds: one angle between them, the common case (water, CO₂, every –CH₂– …), with no sorting
      // the counter-clockwise angle from bond 0 to bond 1, in [0, 2π): the gap after bond 0; the other gap is the rest
      let g = Math.atan2(_cs[0] * _sn[1] - _sn[0] * _cs[1], _cs[0] * _cs[1] + _sn[0] * _sn[1]);
      if (g < 0) g += 2 * Math.PI;
      const t0 = tgs[b0], t1 = tgs[b0 + 1], g1 = 2 * Math.PI - g;
      const lo = t0 < t1 ? t0 : t1, hi = t0 < t1 ? t1 : t0;
      const tg0 = g <= g1 ? lo : hi, tg1 = g <= g1 ? hi : lo; // targets matched to gaps by rank
      const d = ANGLE_K * ((g1 - tg1) - (g - tg0)); // dE/dφ at bond 0; the opposite at bond 1
      const F0 = -d / _rad[0], F1 = d / _rad[1];
      const o0 = _nbr[0], o1 = _nbr[1];
      const fx0 = -_sn[0] * F0, fy0 = _cs[0] * F0, fx1 = -_sn[1] * F1, fy1 = _cs[1] * F1;
      FXo[o0] += fx0; FYo[o0] += fy0; FXo[o1] += fx1; FYo[o1] += fy1;
      FXo[pc] -= fx0 + fx1; FYo[pc] -= fy0 + fy1;
      continue;
    }
    // insertion sort by angle (n ≤ 6)
    for (let i = 1; i < n; i++) { const v = _ord[i]; let j = i - 1; while (j >= 0 && _ang[_ord[j]] > _ang[v]) { _ord[j + 1] = _ord[j]; j--; } _ord[j + 1] = v; }
    for (let k = 0; k < n; k++) {
      const i = _ord[k], j = _ord[(k + 1) % n];
      let g = _ang[j] - _ang[i]; if (k === n - 1) g += 2 * Math.PI;
      _gap[k] = g; _gi[k] = k;
    }
    for (let k = 0; k < n; k++) _ts[k] = tgs[b0 + k];
    // match targets to gaps by rank
    for (let i = 1; i < n; i++) { const v = _gi[i]; let j = i - 1; while (j >= 0 && _gap[_gi[j]] > _gap[v]) { _gi[j + 1] = _gi[j]; j--; } _gi[j + 1] = v; }
    for (let i = 1; i < n; i++) { const v = _ts[i]; let j = i - 1; while (j >= 0 && _ts[j] > v) { _ts[j + 1] = _ts[j]; j--; } _ts[j + 1] = v; }
    for (let k = 0; k < n; k++) _tgt[_gi[k]] = _ts[k];
    let cfx = 0, cfy = 0;
    for (let k = 0; k < n; k++) {
      const i = _ord[k];
      const prev = (k - 1 + n) % n;
      const dEdphi = ANGLE_K * ((_gap[prev] - _tgt[prev]) - (_gap[k] - _tgt[k]));
      const Ft = -dEdphi / _rad[i];
      const fx = -_sn[i] * Ft, fy = _cs[i] * Ft;
      const o = _nbr[i];
      FXo[o] += fx; FYo[o] += fy; cfx += fx; cfy += fy;
    }
    FXo[pc] -= cfx; FYo[pc] -= cfy;
  }
}
/* ======================================================================== PAIR KERNEL END */
/* The kernel's candidates become events here, with the chemistry that needs the particle objects, in the order the
   kernel noted them (so one thread or many give the same event queue). r is the pair's distance now. */
function evalCandidates(CQ, nc) {
  if (_noEv) return;
  const OBJ = S.obj, X = S.x, Y = S.y, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2;
  for (let c = 0; c < nc; c += 3) {
    const kind = CQ[c];
    const i = CQ[c + 1], j = CQ[c + 2];
    if (kind === CAND_BREAK) { const bd = W.bonds[i], ia = bd.a.i, ib = bd.b.i; let dx = X[ib] - X[ia], dy = Y[ib] - Y[ia];
      if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
      queue(EV.BREAK, bd, null, null, Math.sqrt(dx * dx + dy * dy) || 1e-6); continue; }
    const a = OBJ[i], b = OBJ[j];
    let dx = X[j] - X[i], dy = Y[j] - Y[i];
    if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
    const r = Math.sqrt(dx * dx + dy * dy);
    switch (kind) {
      case CAND_BOND: if (covalentOK(a, b) && r < bondParams1(a.el, b.el)[3]) queue(EV.BOND, a, b, null, r); break; // (a, b: the two radicals)
      case CAND_REACT: if (b.bonds.length) { const rx = reaction(a, b); if (rx && r < rx.rTest) queue(EV.REACT, a, b, rx, r); } break; // (a: the radical X, b: the molecule's atom A)
      case CAND_XFER: queue(EV.XFER, a, b, null, r); break;
      case CAND_HOT: queue(EV.HOT, a, b, null, r); break;
      case CAND_ANTI: queue(EV.ANTI, a, b, null, r); break;
      case CAND_DATIVE: queue(EV.DATIVE, a, b, null, r); break; // (a: the bare nucleus, b: the atom with a lone pair)
      case CAND_XFERB: queue(EV.XFER, a, b, null, r); break; // (a: the atom, b: the bare nucleus)
    }
  }
}
/* Does free lepton L annihilate with A's bound leptons (a positron at matter, an electron at antimatter)? */
function clash(L, A) { return (L.k === ELEC) === !!A.anti; }
function leptonNuc(li, ai, r) { // free lepton li at nucleus, atom or ion ai; returns the radial force (computeFast carries a copy of this: keep them the same)
  const Q = S.q, qa = Q[ai], ql = Q[li];
  let f = 0;
  if (qa !== 0) {
    const sE = S.sEN[ai], s2 = r * r + sE;
    f = PHYS.KE * ql * qa * r / (s2 * Math.sqrt(s2));
    // close passes through an ion's core: radial and tangential stiffness for the step-size control
    const w = PHYS.KE * Math.abs(ql * qa) * (Math.abs(sE - 2 * r * r) + s2) / (s2 * s2 * Math.sqrt(s2)) * (S.im[li] + S.im[ai]);
    if (w > _stiffL) _stiffL = w;
  }
  const rh = S.ne[ai] > 0 ? 0.35 + 0.5 * S.elrc[ai] : 0.55;
  const pull = ql * qa <= -1; // the lepton is attracted by a net opposite charge
  if (pull && r < 3.5) S.nearIon[li] = 1;
  const HIT = S.hit, aid = S.id[ai];
  if ((pull && !((S.k[li] === ELEC) === (S.anti[ai] === 1)) && r < 1.2 + 0.5 * Math.min(Math.abs(qa), 4)) || (r < rh && HIT[li] !== aid)) { if (!_lepEvOff) queue(EV.LEPTON, S.obj[li], S.obj[ai], null, r); } // (!clash)
  else if (HIT[li] === aid && r > 1.7 * rh) HIT[li] = 0;
  return f;
}

function pairForce(i, j, dx, dy, r2) { // a pair with a free lepton in it (nucleus pairs: pairKernel)
  const r = Math.sqrt(r2), K = S.k, ki = K[i], kj = K[j];
  let f;
  if (ki === NUC || kj === NUC) {
    const ai = ki === NUC ? i : j, li = ki === NUC ? j : i;
    if (S.Z[ai] === 0) return;
    f = leptonNuc(li, ai, r);
  } else {
    const s2 = r2 + 0.04, Q = S.q;
    f = PHYS.KE * Q[i] * Q[j] * r / (s2 * Math.sqrt(s2));
    { const w = PHYS.KE * (Math.abs(0.04 - 2 * r2) + s2) / (s2 * s2 * Math.sqrt(s2)) * (S.im[i] + S.im[j]); if (w > _stiffL) _stiffL = w; } // (noteStiff, at every distance: a cutoff would make the step jump)
    if (ki !== kj && r < 0.3 && !_lepEvOff) queue(EV.ANNIH, S.obj[i], S.obj[j], null, r);
  }
  if (f > FCAP) f = FCAP; else if (f < -FCAP) f = -FCAP;
  const fx = f * dx / r, fy = f * dy / r, FX = S.fx, FY = S.fy, GX = S.gx, GY = S.gy;
  FX[j] += fx; FY[j] += fy; FX[i] -= fx; FY[i] -= fy;
  GX[j] += fx; GY[j] += fy; GX[i] -= fx; GY[i] -= fy; // the electron (fast) part
}

/* ------------------------------------------------------------------ geometry helpers */
function minImg(dx, dy) {
  if (W.wall === 'wrap') {
    const bw = W.box.w, bh = W.box.h;
    if (dx > bw / 2) dx -= bw; else if (dx < -bw / 2) dx += bw;
    if (dy > bh / 2) dy -= bh; else if (dy < -bh / 2) dy += bh;
  }
  return [dx, dy];
}
function dist(a, b) { const [dx, dy] = minImg(b.x - a.x, b.y - a.y); return Math.hypot(dx, dy); }

/* ------------------------------------------------------------------ angle (VSEPR) forces */
const _atCache = new Map();
function angleTargets(p, n) {
  const lp = p.lp, per = p.el ? periodOf(p.el.Z) : 2;
  let allH = true; for (const bd of p.bonds) if (other(bd, p).Z !== 1) { allH = false; break; }
  const key = n * 1000 + lp * 100 + per * 10 + (allH ? 1 : 0);
  let t = _atCache.get(key);
  if (!t) { t = angleTargetsRaw(n, lp, per, allH); _atCache.set(key, t); }
  return t;
}
function angleTargetsRaw(n, lp, per, allH) {
  const steric = n + lp;
  const D = Math.PI / 180;
  if (n === 2) {
    let th;
    if (steric <= 2 || steric >= 5) th = Math.PI;
    else if (steric === 3) th = 119.5 * D;
    else th = (per >= 3 && allH) ? 92 * D : 104.5 * D;
    return [th, 2 * Math.PI - th];
  }
  if (n === 3 && steric === 4) {
    const th = (per >= 3 && allH) ? 93.5 * D : 107 * D;
    return [th, th, 2 * Math.PI - 2 * th];
  }
  const g = 2 * Math.PI / n; const t = []; for (let i = 0; i < n; i++) t.push(g); return t;
}
/* The angle centres (atoms with 2–6 bonds and a VSEPR term), their neighbours' slots and their target angles, gathered
   once per change of bonding (W.topo) or species (W.dirty: refresh), which is all that can change them. */
const AC = { n: 0, c: shArray(Int32Array, 64), nb: shArray(Int32Array, 64 * 6), cnt: shArray(Uint8Array, 64), tg: shArray(Float64Array, 64 * 6), topo: -1, dirty: -1, parts: null, len: -1 };
function angleCentres() {
  if (AC.topo === W.topo && AC.dirty === W.dirty && AC.parts === W.parts && AC.len === W.parts.length) return;
  AC.topo = W.topo; AC.dirty = W.dirty; AC.parts = W.parts; AC.len = W.parts.length;
  const parts = W.parts, N = parts.length;
  if (AC.c.length < N) { AC.c = shArray(Int32Array, N * 2 + 64); AC.nb = shArray(Int32Array, (N * 2 + 64) * 6); AC.cnt = shArray(Uint8Array, N * 2 + 64); AC.tg = shArray(Float64Array, (N * 2 + 64) * 6); _sharedGen++; }
  let m = 0;
  for (let j = 0; j < N; j++) {
    const p = parts[j], n = p.bonds.length;
    if (n < 2 || p.dead || n > 6 || !p.el || p.el.dblock) continue;
    AC.c[m] = p.i; AC.cnt[m] = n;
    for (let i = 0; i < n; i++) { const bd = p.bonds[i]; AC.nb[m * 6 + i] = (bd.a === p ? bd.b : bd.a).i; }
    const tg = angleTargets(p, n);
    for (let i = 0; i < n; i++) AC.tg[m * 6 + i] = tg[i];
    m++;
  }
  AC.n = m;
}
/* The bonds as arrays (slots and Morse parameters, in W.bonds order), for the bond kernel; refreshed when bonding changes. */
const BD = { n: 0, a: shArray(Int32Array, 256), b: shArray(Int32Array, 256), r0: shArray(Float64Array, 256), al: shArray(Float64Array, 256), D: shArray(Float64Array, 256), rb: shArray(Float64Array, 256), topo: -1, bonds: null };
function bondArrays() {
  const bonds = W.bonds, n = bonds.length;
  if (BD.topo === W.topo && BD.bonds === bonds && BD.n === n) return;
  if (BD.a.length < n) { const m = n * 2 + 256; BD.a = shArray(Int32Array, m); BD.b = shArray(Int32Array, m); BD.r0 = shArray(Float64Array, m); BD.al = shArray(Float64Array, m); BD.D = shArray(Float64Array, m); BD.rb = shArray(Float64Array, m); _sharedGen++; }
  for (let k = 0; k < n; k++) { const bd = bonds[k]; BD.a[k] = bd.a.i; BD.b[k] = bd.b.i; BD.r0[k] = bd.r0; BD.al[k] = bd.al; BD.D[k] = bd.D; BD.rb[k] = bd.rb; }
  BD.n = n; BD.topo = W.topo; BD.bonds = bonds;
}
function angleForces() { angleCentres(); angleKernel(0, AC.n, S.fx, S.fy, W.wall === 'wrap', W.box.w, W.box.h, W.box.w / 2, W.box.h / 2); }

/* ------------------------------------------------------------------ force computation */
const _bg = [0, 0];
let _fastNuc = [], _charged = [], _late = [], _mdL = [], _nNucMD = 0;
let _mdI = new Int32Array(4096), _nmd = 0, _mdLI = new Int32Array(256), _nmdL = 0, _chI = new Int32Array(256), _nch = 0, _mdNI = new Int32Array(4096), _nmdN = 0; // the slots of _md, _mdL, _charged and the MD nuclei
let _mdGen = 0, _mdPrev = new Int32Array(4096), _nmdPrev = -1, _nFastLep = 0; // _mdGen counts the changes of the MD set (_md as a set of slots)
function computeForces() {
  if (_profOn) { const t0 = performance.now(), k0 = _tKernels; computeForces1(); _tForces += performance.now() - t0; _nPasses++; if (TH_LAST.used) { _tKernels = k0 + TH_LAST.ms; _tWait += TH_LAST.wait; } return; }
  computeForces1();
}
const TH_LAST = { used: 0, ms: 0, wait: 0 }; // (what the last force pass's kernels cost: filled by nucleusPairs)
function computeForces1() {
  _fastNuc.length = 0; _charged.length = 0; _late.length = 0; _mdL.length = 0; _stiff = 0; _stiffL = 0; _nNucMD = 0;
  const fieldE = hasEfield();
  const parts = W.parts, n = parts.length, PI = partsSync();
  if (_mdI.length < n) _mdI = new Int32Array(n * 2 + 64);
  if (_mdLI.length < n) _mdLI = new Int32Array(n * 2 + 64);
  if (_chI.length < n) _chI = new Int32Array(n * 2 + 64);
  if (_mdNI.length < n) _mdNI = new Int32Array(n * 2 + 64);
  const FX = S.fx, FY = S.fy, GX = S.gx, GY = S.gy, DEAD = S.dead, K = S.k, Z = S.Z, RAD = S.rad, FAST = S.fast, Q = S.q, INMD = S.inMD, NEAR = S.nearIon, X = S.x, Y = S.y, OBJ = S.obj;
  const mdI = _mdI, mdLI = _mdLI, chI = _chI, mdNI = _mdNI;
  let nmd = 0, nmdL = 0, nch0 = 0, nmdN = 0, nFastLep = 0;
  for (let j = 0; j < n; j++) {
    const i = PI[j];
    if (DEAD[i] === 1) continue;
    FX[i] = 0; FY[i] = 0; GX[i] = 0; GY[i] = 0; NEAR[i] = 0; INMD[i] = 0;
    const k = K[i];
    if (k === NUC && Z[i] === 0) continue;       // neutrons fly straight
    if (RAD[i] === 1) continue;
    if (FAST[i] === 1) { // ballistic between collisions, but an applied electric field still pushes on them
      if (fieldE && Q[i]) { const E = Efield(X[i], Y[i], OBJ[i]); FX[i] = Q[i] * E[0]; FY[i] = Q[i] * E[1]; }
      if (k === NUC) _fastNuc.push(OBJ[i]); else nFastLep++;
      continue;
    }
    mdI[nmd++] = i; INMD[i] = 1;
    if (k !== NUC) { _mdL.push(OBJ[i]); mdLI[nmdL++] = i; } else { _nNucMD++; mdNI[nmdN++] = i; }
    if (k !== NUC || Math.abs(Q[i]) >= 1) { _charged.push(OBJ[i]); chI[nch0++] = i; }
  }
  _nmd = nmd; _nmdL = nmdL; _nch = nch0; _nmdN = nmdN; _flagGenForces = _flagGen; _nFastLep = nFastLep;
  { // has the MD set changed since the last time?
    let same = nmd === _nmdPrev;
    if (same) { const pv = _mdPrev; for (let q = 0; q < nmd; q++) if (pv[q] !== mdI[q]) { same = false; break; } }
    if (!same) { _mdGen++; if (_mdPrev.length < nmd) _mdPrev = new Int32Array(nmd * 2 + 64); _mdPrev.set(mdI.subarray(0, nmd)); _nmdPrev = nmd; }
  }
  buildGrid(mdI, nmd);
  if (!vlValid()) vlBuild();
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2;
  if (VL.exTopo !== W.topo || VL.exDirty !== W.dirty) vlExclusions();
  nucleusPairs(wrap, bw, bh, hw, hh); // the kernel, on one thread or many
  if (nmdL) { // pairs with a free lepton in them, from the inner steps' list
    if (!flValid()) flBuild();
    const la = FL.la, lb = FL.lb, na = FL.na, li = FL.li, lj = FL.lj, nl = FL.nl;
    for (let k = 0; k < na; k++) {
      const i = la[k], j = lb[k];
      let dx = X[j] - X[i], dy = Y[j] - Y[i];
      if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
      const r2 = dx * dx + dy * dy;
      if (r2 < RC2 && r2 > 1e-10) pairForce(i, j, dx, dy, r2);
    }
    for (let k = 0; k < nl; k++) {
      const i = li[k], j = lj[k];
      let dx = X[j] - X[i], dy = Y[j] - Y[i];
      if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
      const r2 = dx * dx + dy * dy;
      if (r2 < RC2 && r2 > 1e-10) pairForce(i, j, dx, dy, r2);
    }
  }
  // exact long-range Coulomb between net charges beyond the cutoff (when few enough)
  const nch = _charged.length;
  _lrOn = nch <= 220 && W.wall !== 'wrap';
  if (_lrOn) {
    for (let i = 0; i < nch; i++) {
      const a = _charged[i];
      for (let j = i + 1; j < nch; j++) {
        const b = _charged[j];
        const dx = b.x - a.x, dy = b.y - a.y, r2 = dx * dx + dy * dy;
        if (r2 < RC2) continue;
        const r = Math.sqrt(r2), f = PHYS.KE * qx(a, b) * qx(b, a) / r2;
        const fx = f * dx / r, fy = f * dy / r;
        b.fx += fx; b.fy += fy; a.fx -= fx; a.fy -= fy;
        if (a.k !== NUC || b.k !== NUC) { b.gx += fx; b.gy += fy; a.gx -= fx; a.gy -= fy; }
      }
    }
  }
  // metallic cohesion reaching past the cutoff (between large metal atoms: alkali and alkaline-earth metals,
  // lanthanides, actinides …): without it a lump of such a metal heats itself up wherever pairs cross the cutoff
  farMetalPairs((a, b, dx, dy, r) => {
    const f = metalF(a, b, r), fx = f * dx / r, fy = f * dy / r;
    b.fx += fx; b.fy += fy; a.fx -= fx; a.fy -= fy;
  });
  // (bonds and angles: with the nucleus pairs, above)
  // external fields
  const hasE = hasEfield(), hasB = hasBfield() && W.magnets.length > 0;
  if (hasE || hasB) {
    const kT = PHYS.KB * Math.max(W.T, 1), QP = S.qp, NE = S.ne;
    for (let q = 0; q < nmd; q++) {
      const i = mdI[q];
      if (K[i] !== NUC) continue; // free electrons: leptonExtras
      const qt = Q[i] + QP[i];
      if (hasE && qt !== 0) { const E = Efield(X[i], Y[i], OBJ[i]); FX[i] += qt * E[0]; FY[i] += qt * E[1]; }
      if (hasB && NE[i] > 0) magneticMatterForce(OBJ[i], kT);
    }
  }
  if (W.wall === 'reflect') { // soft harmonic walls: conserve energy and leave molecules intact
    const M = S.m;
    for (let q = 0; q < nmd; q++) {
      const i = mdI[q];
      if (K[i] !== NUC) continue; // electrons: in leptonExtras
      const k = 30 * Math.min(1, M[i]), x = X[i], y = Y[i]; // (wallK)
      if (x > hw) FX[i] -= k * (x - hw); else if (x < -hw) FX[i] += k * (-hw - x);
      if (y > hh) FY[i] -= k * (y - hh); else if (y < -hh) FY[i] += k * (-hh - y);
    }
  }
  toolForces();
  leptonExtras(true);
}
/* Soft-wall stiffness: one oscillation frequency for every heavy particle. (Free electrons bounce off the walls
   elastically on their own short steps: leptonWall.) */
function wallK(p) { return 30 * Math.min(1, p.m); }
/* Single-particle forces on free (MD) electrons and positrons: applied field, the Push/Pull and Grab tools. They
   belong to the fast part; total = true also adds them to the total force. */
const GRAB_M = 0.01;
const GRAB_V = 0.3; // Å/tu (about 3 km/s): the fastest the Grab tool draws an atom or molecule along
function leptonExtras(total) {
  const hasE = hasEfield();
  const t = W.tool, pull = t && t.active && t.type === 'pull', g = W.grab, gp = g && g.p && g.p.k !== NUC && !g.p.dead ? g.p.i : -1;
  const mdLI = _mdLI, nL = _nmdL, DEAD = S.dead, FAST = S.fast, RAD = S.rad, Q = S.q, X = S.x, Y = S.y, VX = S.vx, VY = S.vy, M = S.m, GX = S.gx, GY = S.gy, FX = S.fx, FY = S.fy, OBJ = S.obj;
  if (!hasE && !pull && gp < 0) return; // (nothing to add)
  for (let q = 0; q < nL; q++) {
    const i = mdLI[q];
    if (DEAD[i] === 1 || FAST[i] === 1 || RAD[i] === 1) continue;
    let fx = 0, fy = 0;
    if (hasE) { const E = Efield(X[i], Y[i], OBJ[i]); fx += Q[i] * E[0]; fy += Q[i] * E[1]; }
    if (pull) { // (free electrons feel at most 20 eV of it: a deeper well would make the tool an electron gun)
      const R = t.R, R2 = R * R, U0 = Math.min(20, Math.abs(t.s)), dx = t.x - X[i], dy = t.y - Y[i], d2 = dx * dx + dy * dy;
      if (d2 <= R2 && d2 >= 1e-8) { const d = Math.sqrt(d2), F = t.s > 0 ? 2 * U0 * d / R2 : -2 * U0 * (1 - d / R) / R; fx += F * dx / d; fy += F * dy / d; }
    }
    // Grab: a spring to the cursor, as stiff as for a 0.01 u particle so a field or a nearby ion cannot pull the
    // electron far off the cursor (on its real mass the spring would be 18 times weaker than its pull)
    if (gp === i) { const mg = Math.max(M[i], GRAB_M); fx += mg * (6 * (g.x - X[i]) - 2.5 * VX[i]); fy += mg * (6 * (g.y - Y[i]) - 2.5 * VY[i]); }
    GX[i] += fx; GY[i] += fy;
    if (total) { FX[i] += fx; FY[i] += fy; }
  }
}

function magneticMatterForce(p, kT) {
  const B = Bgrad(p.x, p.y, _bg);
  const gB = Math.hypot(_bg[0], _bg[1]);
  if (gB === 0) return;
  const s = B >= 0 ? 1 : -1, absB = Math.abs(B);
  let F = 0; // along +∇|B| (eV/Å)
  const fe = FERRO[p.Z];
  if (fe && p.tLocal < fe[0]) {
    F += fe[1] * PHYS.MU_B * Math.tanh(absB / 2);      // ferromagnet: saturated, aligned moment
  } else if (unpairedOf(p) > 0) {
    const n = unpairedOf(p);
    const mu = Math.sqrt(n * (n + 2)) * PHYS.MU_B; // spin-only effective moment
    const x = mu * absB / kT;
    const L = x < 1e-3 ? x / 3 : 1 / Math.tanh(x) - 1 / x;  // Langevin function (Curie law at small x)
    F += mu * L;
  }
  // Langevin diamagnetism of paired electrons: U = κ B²
  const kappa = 2.2e-10 * p.ne * Math.pow(0.5 * p.el.rc, 2);
  F -= 2 * kappa * absB;
  p.fx += F * s * _bg[0]; p.fy += F * s * _bg[1];
}

/* The potential energy whose gradient magneticMatterForce applies (eV): −2m·ln cosh(|B|/2) for a ferromagnet's
   saturated moment, the Langevin free energy −kT·ln(sinh x / x) for a paramagnet, +κB² for diamagnetism. Counted
   in the energy totals, so an iron filing pulled onto a pole gains no energy from nowhere. */
function magU(p, kT) {
  if (p.k !== NUC || p.ne <= 0 || !W.magnets.length || p.fast || p.rad) return 0;
  const absB = Math.abs(Bfield(p.x, p.y, p));
  if (absB === 0) return 0;
  let U = 0;
  const fe = FERRO[p.Z];
  if (fe && p.tLocal < fe[0]) {
    const y = absB / 2; // ln cosh y without overflow
    U -= 2 * fe[1] * PHYS.MU_B * (y + Math.log1p(Math.exp(-2 * y)) - Math.LN2);
  } else if (unpairedOf(p) > 0) {
    const n = unpairedOf(p), mu = Math.sqrt(n * (n + 2)) * PHYS.MU_B, x = mu * absB / kT;
    U -= kT * (x < 1e-3 ? x * x / 6 : x + Math.log1p(-Math.exp(-2 * x)) - Math.LN2 - Math.log(x)); // ln(sinh x / x)
  }
  U += 2.2e-10 * p.ne * Math.pow(0.5 * p.el.rc, 2) * absB * absB;
  return U;
}
/* Unpaired electrons of an atom as it is bonded: bonds pair electrons up, except in O₂ (a triplet). */
function unpairedOf(p) {
  if (!p.bonds.length || (p.el && p.el.dblock)) return p.unp;
  if (p.Z === 8 && p.bonds.length === 1 && p.bonds[0].order === 2 && other(p.bonds[0], p).Z === 8) return 1;
  return Math.max(0, p.cap - p.used);
}
function toolForces() {
  const t = W.tool;
  if (t && t.active && t.type === 'pull') {
    // A well (attract) or hill (repel) of depth |s| eV, the same for every particle, so nothing falling in
    // gains more than |s|. Attract is a harmonic trap, U = s·(d/R)²: no force at the centre, so atoms pack
    // at their natural spacing instead of being rammed together. Repel is U = |s|·(1 − d/R)².
    const R = t.R, R2 = R * R, U0 = Math.abs(t.s), mdI = _mdI, nmd = _nmd, K = S.k, X = S.x, Y = S.y, FX = S.fx, FY = S.fy;
    for (let q = 0; q < nmd; q++) {
      const i = mdI[q];
      if (K[i] !== NUC) continue; // free electrons: leptonExtras
      const dx = t.x - X[i], dy = t.y - Y[i], d2 = dx * dx + dy * dy;
      if (d2 > R2 || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const F = t.s > 0 ? 2 * U0 * d / R2 : -2 * U0 * (1 - d / R) / R;
      FX[i] += F * dx / d; FY[i] += F * dy / d;
    }
  }
  const g = W.grab;
  if (g && g.p && !g.p.dead && (g.p.k === NUC || g.p.fast)) { // a free MD electron: leptonExtras
    const p = g.p;
    const atoms = g.mol ? g.mol : [p];
    // a damped spring to the cursor, a = 2.5·(2.4·d − v), but never drawing it faster than GRAB_V: when the simulation
    // runs slowly the cursor gets far ahead, and an uncapped spring flung a big molecule at tens of km/s (its kinetic
    // energy read as millions of kelvin, and the tiny steps it forced froze the clock)
    let ux = 2.4 * (g.x - p.x), uy = 2.4 * (g.y - p.y);
    const u = Math.hypot(ux, uy); if (u > GRAB_V) { ux *= GRAB_V / u; uy *= GRAB_V / u; }
    for (const a of atoms) {
      if (a.dead) continue;
      a.fx += a.m * 2.5 * (ux - a.vx);
      a.fy += a.m * 2.5 * (uy - a.vy);
    }
  }
}

/* ------------------------------------------------------------------ momentum-conserving energy transfers */
/* Add (E>0) or remove (E<0) kinetic energy E via equal and opposite impulses on a and b (momentum conserved).
   Returns the energy actually transferred. */
function kickPair(a, b, E, ux, uy) {
  if (a === b || a.dead || b.dead || a.rad || b.rad || !E) return 0;
  const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
  if (ux === undefined) {
    if (E < 0) { const v = Math.hypot(dvx, dvy); if (v < 1e-9) return 0; ux = dvx / v; uy = dvy / v; }
    else { const th = rnd() * 2 * Math.PI; ux = Math.cos(th); uy = Math.sin(th); }
  }
  const al = 0.5 * (a.im + b.im), be = ux * dvx + uy * dvy;
  const disc = be * be + 4 * al * E;
  let J;
  if (disc < 0) { J = -be / (2 * al); E = -be * be / (4 * al); }
  else { const sq = Math.sqrt(disc); J = be >= 0 ? (-be + sq) / (2 * al) : (-be - sq) / (2 * al); }
  a.vx += J * ux * a.im; a.vy += J * uy * a.im;
  b.vx -= J * ux * b.im; b.vy -= J * uy * b.im;
  updateFast(a); updateFast(b);
  return E;
}
function nearestThird(a, b, R) {
  let best = null, bd = R * R;
  nearby(0.5 * (a.x + b.x), 0.5 * (a.y + b.y), R, (p, dx, dy, r2) => {
    if (p === a || p === b || p.dead || p.k !== NUC) return;
    if (r2 < bd) { bd = r2; best = p; }
  });
  return best;
}
/* Release heat locally: a nearby third body takes it (as in real recombination); without one the
   heat bath absorbs it, and in an insulated box the pair itself keeps it. */
function dumpHeat(E, a, b) {
  if (!(E > 0)) return;
  W.ledger.chem += E;
  const third = nearestThird(a, b, 6);
  if (third) { kickPair(rnd() < 0.5 ? a : b, third, E); return; }
  if (W.gamma > 0) { W.ledger.bath += E; return; }
  kickPair(a, b, E);
}

/* ------------------------------------------------------------------ photons
   Light crosses the whole chamber in a few hundredths of a femtosecond, far less than a frame shows, so photons are
   rays that land at once. Asked to travel (opts.travel: the Light tool's), a photon flies at c instead (W.flights):
   it lands when light has covered the distance, and time slows while it is in flight so that it can be seen going. */
/* A photon's label, drawn by it: the kind of light and its energy or wavelength, and the element that gave it off
   when that is known (an emission line). */
function photonLabel(E, src) {
  if (E >= 1e5) return 'γ ' + fmtE(E);
  if (E >= 124) return 'X-ray ' + fmtE(E);
  const nm = PHYS.HC / E, who = src && src.k === NUC && src.el ? (src.anti ? barSym(src.el.sym) : src.el.sym) + ' ' : '';
  return who + (nm < 380 ? 'UV ' : nm > 780 ? 'IR ' : '') + (nm >= 1000 ? `${(nm / 1000).toFixed(nm < 1e4 ? 1 : 0)} µm` : `${nm < 100 ? nm.toFixed(1) : Math.round(nm)} nm`);
}
function emitPhoton(x, y, E, ux, uy, opts) {
  if (!(E > 0)) return;
  if (ux === undefined) { const th = rnd() * 2 * Math.PI; ux = Math.cos(th); uy = Math.sin(th); }
  W.count.photons++;
  let x0 = x, y0 = y, depth = (opts && opts.depth) || 0;
  const hit = (opts && opts.noInteract) || depth > 3 ? null : rayInteract(x0, y0, ux, uy, E, opts && opts.src);
  let x1, y1;
  if (hit) { x1 = hit.x; y1 = hit.y; }
  else { const t = rayExit(x0, y0, ux, uy); x1 = x0 + ux * t; y1 = y0 + uy * t; }
  const lab = photonLabel(E, opts && opts.src);
  if (opts && opts.travel) { W.flights.push({ x0, y0, x1, y1, E, c: photonColor(E), t0: W.t, len: Math.hypot(x1 - x0, y1 - y0), hit, lab }); return; }
  if (!hit) W.ledger.escaped += E;
  W.rays.push({ x0, y0, x1, y1, E, c: photonColor(E), t0: W.rt, ts: W.t, len: Math.hypot(x1 - x0, y1 - y0), nu: false, lab }); // (ts, len: it goes at c on the simulation's clock, drawRays)
  if (W.rays.length > 400) W.rays.splice(0, W.rays.length - 400);
  if (hit && hit.after) hit.after();
}
/* Photons in flight that have come as far as they were going: what they were to hit happens now (unless it is gone,
   when the light flies on out), and their trace fades as any ray's does. */
function landFlights() {
  for (let i = W.flights.length - 1; i >= 0; i--) {
    const f = W.flights[i];
    if ((W.t - f.t0) * PHYS.C < f.len) continue;
    W.flights.splice(i, 1);
    // its streak (the last 4 Å, as drawn in flight) fades where it landed: no line drawn back to where it came from
    const L = f.len || 1, d0 = Math.max(0, L - 4);
    W.rays.push({ x0: f.x0 + (f.x1 - f.x0) * d0 / L, y0: f.y0 + (f.y1 - f.y0) * d0 / L, x1: f.x1, y1: f.y1, E: f.E, c: f.c, t0: W.rt, landed: true, nu: false });
    if (W.rays.length > 400) W.rays.splice(0, W.rays.length - 400);
    if (f.hit && f.hit.after && !(f.hit.p && f.hit.p.dead)) f.hit.after(); else W.ledger.escaped += f.E;
  }
}
/* How far along a ray its light has got: it goes at c on the simulation's clock (at normal speed, across the box
   within a frame; in slow motion, seen going). */
function rayFrac(r) { return r.landed || !(r.len > 0) ? 1 : clamp((W.t - r.ts) * PHYS.C / r.len, 0, 1); }
/* Light in flight: time slows until it crosses about 1.5% of the box a frame, so that it is seen going at c. */
function lightSlow() { return clamp(0.015 * Math.min(W.box.w, W.box.h) / (PHYS.C * (W.baseSpf || W.simPerFrame)), 1e-7, 1); }
function emitNeutrino(x, y, E, ux, uy) {
  if (ux === undefined) { const th = rnd() * 2 * Math.PI; ux = Math.cos(th); uy = Math.sin(th); }
  const t = rayExit(x, y, ux, uy);
  W.rays.push({ x0: x, y0: y, x1: x + ux * t, y1: y + uy * t, E, c: [120, 255, 170], t0: W.rt, ts: W.t, len: t, nu: true, lab: 'ν ' + fmtE(E) });
  W.ledger.escaped += E;
}
function rayExit(x, y, ux, uy) {
  const hw = W.box.w / 2, hh = W.box.h / 2;
  let t = 1e9;
  if (ux > 1e-9) t = Math.min(t, (hw - x) / ux); else if (ux < -1e-9) t = Math.min(t, (-hw - x) / ux);
  if (uy > 1e-9) t = Math.min(t, (hh - y) / uy); else if (uy < -1e-9) t = Math.min(t, (-hh - y) / uy);
  return Math.max(0, t);
}
const _rayHits = [];
function rayInteract(x, y, ux, uy, E, src) {
  const tmax = rayExit(x, y, ux, uy);
  _rayHits.length = 0;
  for (const p of W.parts) {
    if (p.dead || p.k !== NUC || p.Z === 0 || p === src) continue;
    const dx = p.x - x, dy = p.y - y, t = dx * ux + dy * uy;
    if (t < 0.05 || t > tmax) continue;
    const d = Math.abs(dx * uy - dy * ux);
    if (d < 0.6) _rayHits.push([t, p, d]);
  }
  if (!_rayHits.length) return null;
  _rayHits.sort((a, b) => a[0] - b[0]);
  for (const [t, p] of _rayHits) {
    const hx = x + ux * t, hy = y + uy * t;
    if (E >= 1e5) { // gamma: Compton scattering, pair production
      if (E > 1.022e6 && rnd() < 0.0015 * p.Z) {
        return { x: hx, y: hy, p, after: () => pairProduce(p, E) };
      }
      if (p.ne > 0 && rnd() < 0.012 * p.ne) {
        return { x: hx, y: hy, p, after: () => compton(p, E, ux, uy) };
      }
      continue;
    }
    if (p.ne > 0) {
      const ie = ionizationCost(p);
      if (E >= ie && rnd() < 0.6 * Math.min(1, Math.pow(ie / E, 1.5) * 2)) {
        return { x: hx, y: hy, p, after: () => photoIonize(p, E - ie, ie) };
      }
      if (p.bonds.length && E < ie) {
        let weak = null; for (const bd of p.bonds) if (!weak || bd.D < weak.D) weak = bd;
        if (weak && E >= weak.D && E >= 1.77 && rnd() < 0.35) return { x: hx, y: hy, p, after: () => photoDissociate(weak, E) };
      }
      const L = LINES[p.el.sym];
      if (L && p.q === 0) for (const [nm] of L.l) if (Math.abs(PHYS.HC / E - nm) < 1.5) {
        if (rnd() < 0.6) return { x: hx, y: hy, p, after: () => { glow(p, wavelengthRGB(nm)); W.count.photons++; emitPhoton(p.x, p.y, E, undefined, undefined, { depth: 9, src: p }); } };
      }
      if (E < 1.6 && p.bonds.length && rnd() < 0.3 && irActive(p)) {
        return { x: hx, y: hy, p, after: () => { const o = other(p.bonds[0], p); kickPair(p, o, E); W.ledger.chem += 0; } };
      }
    }
  }
  return null;
}
function irActive(p) { // molecule has a vibration that changes its dipole (not a homonuclear diatomic)
  const mol = molecule(p);
  if (mol.length === 2 && mol[0].Z === mol[1].Z) return false;
  return mol.some(a => a.bonds.some(bd => Math.abs((bd.a.el.en || 2.5) - (bd.b.el.en || 2.5)) > 0.3));
}
function photoIonize(p, KE, ie) {
  if (p.dead || p.ne === 0) return;
  if (!ejectElectron(p, Math.max(0.05, KE))) { dumpHeat(KE + ie, p, p); return; } // absorbed as heat instead
  W.count.ionize++;
  log('em', `Photoelectric effect: ${speciesLabel(p)} lost an electron (binding ${fmtE(ie)})`);
}
function photoDissociate(bd, E) {
  if (W.bonds.indexOf(bd) < 0) return;
  const a = bd.a, b = bd.b;
  const set = setOf(molecule(a)), sn = snapshot(set);
  const PE0 = localPE(set);
  removeBond(bd);
  separate(a, b);
  for (const m of molecule(b)) set.add(m);
  const left = E - (localPE(set) - PE0);
  // if the fragments can't get apart with this photon's energy, it is simply absorbed as heat
  if (kickPair(a, b, left) > left + 1e-6) { restoreSnap(sn); dumpHeat(E, a, b); return; }
  W.count.broken++;
  log('chem', `Photodissociation: light (${(PHYS.HC / E).toFixed(0)} nm) split ${a.el.sym}–${b.el.sym}`);
}
function compton(p, E, ux, uy) {
  if (p.dead || p.ne === 0) return;
  // sample scattering angle (Klein–Nishina approximated by an isotropic-forward mix)
  const k = E / 511e3, ct = 2 * rnd() - 1;
  const Ep = E / (1 + k * (1 - ct));
  const Te = E - Ep;
  const th = Math.acos(ct) * (rnd() < 0.5 ? 1 : -1);
  const nx = ux * Math.cos(th) - uy * Math.sin(th), ny = ux * Math.sin(th) + uy * Math.cos(th);
  // the recoil electron leaves with what the photon gave it, less the energy that bound it
  const KEe = Te - ionizationCost(p);
  if (KEe > 0.05 && ejectElectron(p, KEe, ux, uy)) W.count.ionize++; else dumpHeat(Te, p, p);
  emitPhoton(p.x, p.y, Ep, nx, ny, { depth: 2, src: p });
}
function pairProduce(p, E) {
  if (W.parts.length > MAX_PARTS) return;
  const T = (E - 2 * ME_C2) / 2; // (exactly what the pair's rest mass leaves)
  const th = rnd() * 2 * Math.PI, ux = Math.cos(th), uy = Math.sin(th);
  const e = addLepton(ELEC, p.x + 0.2 * ux, p.y + 0.2 * uy); setMotion(e, Math.max(1, T), ux, uy);
  const ps = addLepton(POS, p.x - 0.2 * ux, p.y - 0.2 * uy); setMotion(ps, Math.max(1, T), -ux, -uy);
  W.ledger.nuc -= 2 * ME_C2; // energy turned into the pair's rest mass
  log('nuc', `Pair production: γ (${fmtE(E)}) → e⁻ + e⁺ near ${speciesLabel(p)}`);
  nucEvent('pair', p.x, p.y, `Pair production: γ → e⁻ + e⁺`, [], `${fmtE(E)} γ ray`);
}

/* ------------------------------------------------------------------ particle creation helpers */
function radSpeed(p) {
  const mc2 = (p.k !== NUC ? PHYS.MEC2 : p.m * PHYS.AMU_MEV) * 1e6;
  const g = 1 + p.KE / mc2;
  p.gam = g; p.sp = PHYS.C * Math.sqrt(Math.max(0, 1 - 1 / (g * g)));
}
/* Give particle p kinetic energy KE (eV) along (ux, uy) relative to frame (bvx, bvy). */
function setMotion(p, KE, ux, uy, bvx = 0, bvy = 0) {
  const isLep = p.k !== NUC, neutron = p.k === NUC && p.Z === 0;
  const thr = neutron ? NEUTRON_RAD : radThreshold(isLep);
  if (KE > thr) {
    p.rad = true; p.fast = true; p.KE = KE; p.ux = ux; p.uy = uy; radSpeed(p);
    p.vx = p.sp * ux; p.vy = p.sp * uy;
    if (!p.trk) startTrack(p);
  } else {
    p.rad = false;
    // launched from a parent moving at (bvx, bvy), with exactly KE in the lab frame (what the energy budget paid)
    const vv = 2 * KE * p.im, ub = ux * bvx + uy * bvy, disc = ub * ub - (bvx * bvx + bvy * bvy) + vv;
    if ((bvx || bvy) && disc >= 0 && Math.sqrt(disc) > ub) { const w = Math.sqrt(disc) - ub; p.vx = bvx + w * ux; p.vy = bvy + w * uy; }
    else { const v = Math.sqrt(vv); p.vx = v * ux; p.vy = v * uy; }
    updateFast(p);
    if (neutron && 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy) > 1 && !p.trk) startTrack(p);
  }
}
function updateFast(p) {
  if (p.rad) return;
  if (p.k === NUC && p.Z === 0) { p.fast = true; return; }
  const v2 = p.vx * p.vx + p.vy * p.vy;
  if (p.k !== NUC) {
    // leptons switch by kinetic energy (20 eV on, 13 eV off), but never inside an ion's Coulomb well:
    // switching the Coulomb force off or on there would create or destroy energy. (A slower threshold would
    // leave 20–60 eV electrons stepping in tiny time steps through empty space, as in a fusion plasma.)
    const ke = 0.5 * p.m * v2;
    // in a strong magnetic field a lepton circles on the spot (a circle under 2–3 Å across): it cannot fly
    // anywhere, so it stays in the ordinary steps
    const circle = () => (W.Bz !== 0 || W.magnets.length ? 2 * Math.sqrt(v2) / Math.abs(p.q * Bfield(p.x, p.y, p) * PHYS.LOR * p.im) : Infinity);
    if (!p.fast) { if (ke > 20 && (!p.nearIon || ke > 1000) && circle() > 3) switchMode(p, true); }
    else if ((ke < 13 || circle() < 2) && !cationNear(p)) switchMode(p, false);
    return;
  }
  if (!p.fast && v2 > V_FAST_ON * V_FAST_ON) switchMode(p, true);
  else if (p.fast && v2 < V_FAST_OFF * V_FAST_OFF) switchMode(p, false);
}
/* Ballistic (fast) particles carry no potential energy, so switching modes trades the potential energy
   the particle has (or would have) at its position against its kinetic energy. */
function switchMode(p, toFast) {
  if (!G.n) { p.fast = toFast; return; }
  if (toFast && p.k === NUC && p.bonds.length) {
    // an atom knocked this fast (hundreds of eV) tears out of its molecule: its bonds break, paid from its motion
    // (a flying atom feels no bond, so one kept would gain energy from nowhere as it stretched)
    const set = setOf(molecule(p)), U0 = localPE(set);
    for (const bd of p.bonds.slice()) removeBond(bd);
    const owed = localPE(closeSet(set)) - U0, ke0 = 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy);
    const f = Math.sqrt(Math.max(0, ke0 - owed) / ke0);
    p.vx *= f; p.vy *= f;
    if (f * f * ke0 < 0.5 * p.m * V_FAST_ON * V_FAST_ON) { W.count.broken++; return; } // slowed below flight: stays
    W.count.broken++;
  }
  const one = new Set([p]);
  let U;
  if (toFast) U = p.k === NUC ? localPE(one) : p.q * phiE(p.x, p.y, p);
  else { p.fast = false; U = p.k === NUC ? localPE(one) : p.q * phiE(p.x, p.y, p); p.fast = true; }
  const ke = 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy), k2 = toFast ? ke + U : ke - U;
  if (!(k2 > 0.05 * ke)) return; // stay in the current mode
  const f = Math.sqrt(k2 / ke);
  p.vx *= f; p.vy *= f; p.fast = toFast;
  // back among the stepped particles before the neighbour grid is rebuilt: list it with the newcomers, so the
  // potential energy of anything else that changes mode before then counts it (or energy would vanish)
  if (!toFast && S.inMD[p.i] === 0 && !_late.includes(p)) _late.push(p); // (inMD: listed when the grid was built)
}
function cationNear(p) {
  if (!G.n) return false;
  let f = false;
  nearby(p.x, p.y, 3.5, (o) => { if (o.k === NUC && o.q * p.q <= -1) { f = true; return false; } });
  return f;
}
function startTrack(p) {
  const col = p.k === ELEC ? [90, 170, 255] : p.k === POS ? [255, 110, 200] : p.Z === 0 ? [170, 175, 185] :
    p.Z === 2 && p.N === 2 ? [255, 200, 90] : p.Z === 2 ? [235, 130, 255] : p.Z === 1 && p.N === 1 ? [120, 230, 160] :
    p.anti ? [190, 125, 255] : p.Z === 1 && p.N === 2 ? [110, 220, 235] : p.Z === 1 ? [255, 110, 100] : [255, 90, 60];
  const w = p.k !== NUC ? 1 : p.Z === 0 ? 1 : p.Z === 2 ? 2.2 : p.Z > 20 ? 3.2 : 1.6;
  p.trk = { pts: [p.x, p.y], c: col, w, t0: W.rt, upd: W.rt, dash: p.Z === 0 && p.k === NUC, beam: !!p.beam, p, seuI: 0, seuE0: 0, seuDep: 0 }; // (p, seu…: for the charge it frees crossing a chip, chips.js)
  keepTrack(p.trk);
}
/* Trails fade 1.6 s after their particle stops or leaves (drawTracks). Past TRACK_MAX the oldest beam particles'
   trails go first, so the spray from a big collision isn't wiped out by the next bunch coming round. */
const TRACK_MAX = 600;
function keepTrack(t) {
  W.tracks.push(t);
  if (W.tracks.length <= TRACK_MAX) return;
  let drop = W.tracks.length - Math.floor(TRACK_MAX * 0.9);
  for (let i = 0; i < W.tracks.length && drop > 0; i++) if (W.tracks[i].beam) { W.tracks.splice(i--, 1); drop--; }
  if (drop > 0) W.tracks.splice(0, drop);
}
function extendTrack(p) {
  const t = p.trk; if (!t) return;
  const n = t.pts.length;
  const lx = t.pts[n - 2], ly = t.pts[n - 1];
  if (Math.abs(lx - p.x) + Math.abs(ly - p.y) > 0.4) { t.pts.push(p.x, p.y); if (t.pts.length > 400) { t.pts.splice(0, 2); t.seuI = Math.max(0, t.seuI - 2); } }
  t.upd = W.rt;
}
/* Electrostatic potential (V) felt by an electron at (x, y) from nearby charges (soft-cored as in the forces). */
function phiE(x, y, skip, skip2) {
  let phi = 0;
  const visit = (o, dx, dy, r2) => {
    if (o === skip || o === skip2 || o.fast || o.rad) return;
    const q = o.q, sf = o.k === NUC ? o.sEN : 0.04;
    if (q) phi += PHYS.KE * q * (1 / Math.sqrt(r2 + sf) - (_lrOn && isLR(o) ? 0 : 1 / Math.sqrt(RC2 + sf)));
  };
  nearby(x, y, RC, visit);
  for (const o of _late) { if (o.dead) continue; const dx = o.x - x, dy = o.y - y, r2 = dx * dx + dy * dy; if (r2 < RC2) visit(o, dx, dy, r2); }
  if (_lrOn) for (const o of _charged) { // net charges beyond the cutoff
    if (o === skip || o === skip2 || o.dead || o.fast || o.rad || !isLR(o)) continue;
    const dx = o.x - x, dy = o.y - y, r2 = dx * dx + dy * dy;
    if (r2 >= RC2) phi += PHYS.KE * o.q / Math.sqrt(r2);
  }
  return phi;
}
function ejectElectron(p, KE, ux, uy, budget, tunnel) {
  if (p.ne <= 0) return null;
  // at the particle cap we skip the ionization entirely (never leave an ion without its electron)
  if (freeElectronCount() >= MAX_FREE_E || W.parts.length >= MAX_PARTS) { W.ledger.bath += KE; return null; }
  const bc = budget === undefined ? breakCostIfCharged(p, -1) : budget;
  const grid = G.n > 0, set = setOf(molecule(p)), sn = snapshot(set);
  if (ux === undefined) { const th = rnd() * 2 * Math.PI; ux = Math.cos(th); uy = Math.sin(th); }
  const U0 = grid ? localPE(set) : 0;
  p.ne--; refresh(p); enforceValence(p, null);
  // the ion's new charge and size against its surroundings, plus any bonds that had to break
  const dU = grid ? localPE(closeSet(set)) - U0 : 0;
  // The electron is born inside the ion's Coulomb well and near other charges. Its launch energy is
  // set so that the total energy is conserved: KE_launch = KE_far + budget + φ(electron) − ΔU.
  const qa = p.q, lq = p.anti ? 1 : -1; // the ion's charge now, and that of the lepton set free
  const Kfar = KE + bc - dU, off0 = (p.rd || 0.4) + 0.5;
  const closed = W.wall !== 'wrap' && W.wall !== 'open', hw = W.box.w / 2 - 0.2, hh = W.box.h / 2 - 0.2;
  let ex = 0, ey = 0;
  const launch = (o, dx, dy) => { // kinetic energy it must start with at distance o for the total to be conserved
    ex = p.x + dx * o; ey = p.y + dy * o;
    if (closed && (Math.abs(ex) > hw || Math.abs(ey) > hh)) return -Infinity; // beyond the chamber wall
    // a ballistic (radiation-mode) lepton carries no potential energy: then only the energy at infinity counts
    if (Kfar > radThreshold(true)) return Kfar;
    const phiSelf = qa ? PHYS.KE * qa * (1 / Math.sqrt(o * o + p.sEN) - (_lrOn && isLR(p) ? 0 : 1 / Math.sqrt(RC2 + p.sEN))) : 0;
    return Kfar - lq * (phiSelf + (grid ? phiE(ex, ey, p) : 0));
  };
  if (closed) { if (Math.abs(p.x + ux * off0) > hw) ux = -ux; if (Math.abs(p.y + uy * off0) > hh) uy = -uy; } // away from a wall
  let off = off0, KEl = launch(off, ux, uy);
  // An electron the ion cannot hold (a multiply charged anion's) is free at infinity but walled in by the ion's own
  // repulsion close by: it tunnels out, so it starts beyond the barrier, in a direction where its energy suffices.
  if (KEl < 0.02 && tunnel && Kfar > 0.05) {
    const th0 = Math.atan2(uy, ux);
    search: for (let j = 0; j < 8; j++) {
      const dx = Math.cos(th0 + j * Math.PI / 4), dy = Math.sin(th0 + j * Math.PI / 4);
      for (let o = off0 * 1.25; o < 9; o *= 1.25) {
        const K = launch(o, dx, dy);
        if (K >= 0.02) { KEl = K; off = o; ux = dx; uy = dy; break search; }
      }
    }
    if (KEl >= 0.02) launch(off, ux, uy);
  }
  if (!(KEl >= 0.02)) { restoreSnap(sn); return null; } // not enough energy to free it here
  const e = addLepton(p.anti ? POS : ELEC, ex, ey);
  setMotion(e, KEl, ux, uy, p.vx, p.vy);
  e.hit = p.id;
  return e;
}
/* Keep electron count physical: shed electrons beyond what the element can hold as an anion (an α-decay daughter
   keeps its parent's electrons, two too many; β⁺ decay leaves one). Such an electron is unbound: it leaves with
   the energy its departure releases, −ionE (minus any bonds its loss breaks). */
function shedElectron(p) {
  const avail = -ionizationCost(p);
  return avail > 0.02 ? ejectElectron(p, avail, undefined, undefined, undefined, true) : null;
}
/* Does p hold more electrons than any ion of its element can (here, alone or among counter-ions)? */
function holdsTooMany(p) {
  if (p.k !== NUC || p.Z === 0 || p.ne <= p.Z) return false;
  if (p.ne > p.Z + maxExtraElectrons(p.Z) || !(p.el.ea > 0)) return true;
  if (p.ne === p.Z + 1 || p.bonds.length) return false;
  let stab = 0;
  nearby(p.x, p.y, 5, (o) => { if (o !== p && o.k === NUC && o.q * p.q < 0) stab += Math.abs(o.q); });
  return stab === 0;
}
/* A decay daughter that kept too many electrons shakes them off at once, before anything it emitted is near:
   by themselves if they can (stabilize), else paid for out of the decay energy. Returns the energy paid (eV). */
function shakeOff(p) {
  stabilize(p);
  let paid = 0;
  for (let k = 0; k < 12 && holdsTooMany(p); k++) {
    let e = null;
    for (const fee of [20, 60, 200, 1200]) { // the last is fast enough to leave in a straight line from anywhere
      e = ejectElectron(p, Math.max(0, -ionizationCost(p)) + fee, undefined, undefined, undefined, true);
      if (e) { paid += fee; break; }
    }
    if (!e) break;
  }
  return paid;
}
function stabilize(p) {
  if (p.k !== NUC || p.Z === 0) return;
  let guard = 0;
  while (p.ne > p.Z + maxExtraElectrons(p.Z) && guard++ < 200) if (!shedElectron(p)) break;
  if (p.ne > p.Z + 1 && p.bonds.length === 0) {
    // isolated multiply-charged anions are unbound in vacuum unless counter-ions stabilise them
    let stab = 0;
    nearby(p.x, p.y, 5, (o) => { if (o !== p && o.k === NUC && o.q * p.q < 0) stab += Math.abs(o.q); });
    if (stab === 0) while (p.ne > p.Z + 1 && guard++ < 200) if (!shedElectron(p)) break;
  }
  if (p.ne === p.Z + 1 && !(p.el.ea > 0)) shedElectron(p); // no stable anion at all (N⁻, the noble gases …)
  // still more than any ion of its element can hold (it could not shed one: inside a strongly charged molecule, or
  // among ions that hold on to it): the extra electron moves to the atom of its molecule best able to take it, or
  // else is set free, the surroundings paying for its release
  for (let k = 0; k < 4 && p.ne > p.Z + maxExtraElectrons(p.Z); k++) if (!handOff(p) && !forceShed(p)) break;
}
function forceShed(p) {
  const avail = -ionizationCost(p);
  for (const fee of [0.1, 2, 20, 200]) {
    const KE = Math.max(avail, 0) + fee;
    if (ejectElectron(p, KE, undefined, undefined, undefined, true)) { W.ledger.bath -= KE - avail; return true; }
  }
  return false;
}
function handOff(p) {
  let to = null;
  for (const a of molecule(p)) {
    if (a === p || a.dead || a.k !== NUC || a.Z === 0 || !a.anti !== !p.anti) continue;
    const room = a.ne + 1 <= a.Z || (a.ne + 1 === a.Z + 1 ? a.el.ea >= 0.7 : a.ne + 1 <= a.Z + maxExtraElectrons(a.Z));
    if (room && (!to || a.q > to.q)) to = a;
  }
  if (!to) return false;
  const set = setOf(molecule(p)), E0 = localPE(set) + internalE(p) + internalE(to);
  p.ne--; to.ne++; refresh(p); refresh(to); enforceValence(p, null); enforceValence(to, null); closeSet(set);
  const heat = E0 - (localPE(set) + internalE(p) + internalE(to));
  if (heat >= 0) dumpHeat(heat, p, to); else { W.ledger.chem += heat; W.ledger.bath += heat; } // (an uphill move is paid by the surroundings)
  return true;
}

/* ------------------------------------------------------------------ event processing */
function processEvents() {
  const q = W.evq;
  for (let i = 0; i < q.length; i++) {
    const ev = q[i];
    switch (ev.type) {
      case EV.BOND: evBond(ev.a, ev.b, ev.r); break;
      case EV.REACT: evReact(ev.a, ev.b, ev.c, ev.r); break;
      case EV.BREAK: evBreak(ev.a, ev.r); break;
      case EV.LEPTON: evLepton(ev.a, ev.b, ev.r); break;
      case EV.ANNIH: evAnnihFree(ev.a, ev.b); break;
      case EV.DATIVE: evDative(ev.a, ev.b, ev.r); break;
      case EV.XFER: evTransfer(ev.a, ev.b, ev.r); break;
      case EV.HOT: evHot(ev.a, ev.b, ev.r); break;
      case EV.ANTI: evAnti(ev.a, ev.b, ev.r); break;
    }
  }
  q.length = 0;
}

function evBond(a, b, r) {
  if (a.dead || b.dead || bondBetween(a, b)) return;
  if (!(a.cap - a.used > 0 && b.cap - b.used > 0) || !covalentOK(a, b)) return;
  if (a.mol !== 0 && a.mol === b.mol && a.excl && a.excl.has(b.id)) return;
  const third = nearestThird(a, b, 6);
  if (!third && W.gamma === 0 && rnd() > 0.002) return; // nothing to carry the bond energy away
  const fa = speciesLabel(a), fb = speciesLabel(b);
  const set = setOf(molecule(a), molecule(b)), sn = snapshot(set);
  const PE0 = localPE(set);
  const bp = bondParams1(a.el, b.el);
  const Kr = snapTogether(a, b, bp[0]);
  const bd = addBond(a, b, 1);
  while (bd.order < 3 && a.cap - a.used > 0 && b.cap - b.used > 0) setOrder(bd, bd.order + 1);
  if (bd.r0 !== bp[0]) snapTogetherIntra(bd);
  const release = PE0 - localPE(set) + Kr;
  if (release > 0) dumpHeat(release, a, b);
  else if (kickPair(a, b, release) > release + 1e-6) { restoreSnap(sn); return; } // the collision can't pay: no bond here
  W.count.bonds++;
  const mol = molecule(a);
  const nm = moleculeName(mol);
  log('chem', `Bond formed: ${fa} + ${fb} → ${hill(mol)}${nm ? ' (' + nm + ')' : ''}, ${fmtE(bd.D)} released`);
}
/* After a bond-order change, gently set the bond to its new rest length (atoms move along the bond). */
function snapTogetherIntra(bd) {
  W.dirty++;
  const a = bd.a, b = bd.b;
  const [dx, dy] = minImg(b.x - a.x, b.y - a.y);
  const r = Math.hypot(dx, dy) || 1e-6, ux = dx / r, uy = dy / r, M = a.m + b.m, sh = r - bd.r0;
  if (Math.abs(sh) < 0.02 || a.bonds.length > 1 || b.bonds.length > 1) return;
  a.x += ux * sh * b.m / M; a.y += uy * sh * b.m / M; b.x -= ux * sh * a.m / M; b.y -= uy * sh * a.m / M;
}

/* Radical X collides with saturated atom A. Reacts if the collision energy along the line of centres
   exceeds the activation energy (Semenov–Polanyi); otherwise the repulsion simply bounces them apart. */
const _rxTried = new Map();
function evReact(X, A, rx, r) {
  if (X.dead || A.dead || rx.topo !== W.topo) return;
  if (!(X.cap - X.used > 0) || W.bonds.indexOf(rx.bd) < 0 || bondBetween(X, A)) return;
  const key = X.id * 131072 + A.id, last = _rxTried.get(key);
  if (last !== undefined && W.step - last < 30) return; // one test per encounter
  const [dx, dy] = minImg(A.x - X.x, A.y - X.y);
  const rr = Math.hypot(dx, dy) || 1e-6, nx = dx / rr, ny = dy / rr;
  const vn = (A.vx - X.vx) * nx + (A.vy - X.vy) * ny;
  if (vn >= 0) return; // separating
  _rxTried.set(key, W.step);
  if (_rxTried.size > 50000) _rxTried.clear();
  const mu = X.m * A.m / (X.m + A.m);
  // collision energy along the line of centres, including what was already spent climbing the repulsion
  const En = 0.5 * mu * vn * vn + Math.max(0, pairNonbondedV(X, A, rr));
  if (En < rx.Ea) return;
  const bd = rx.bd, B = other(bd, A);
  const before = hill(molecule(X)) + ' + ' + hill(molecule(A));
  const set = setOf(molecule(X), molecule(A));
  const saved = [...set].map(p => [p, p.x, p.y, p.vx, p.vy]);
  const oldOrder = bd.order;
  const PE0 = localPE(set);
  if (rx.type === 'abs') removeBond(bd); else setOrder(bd, bd.order - 1);
  const Kr = snapTogether(X, A, rx.r0);
  const nb = addBond(X, A, 1);
  if (rx.type === 'abs') {
    // the leaving fragment B is still at bonding distance from A: move it out of the repulsive core
    const mb = molecule(B);
    const [ex, ey] = minImg(B.x - A.x, B.y - A.y);
    const rb = Math.hypot(ex, ey) || 1e-6, target = 0.85 * 0.5 * (A.ljR + B.ljR);
    if (rb < target) { const sh = target - rb; for (const p of mb) { p.x += ex / rb * sh; p.y += ey / rb * sh; } }
  }
  const heat = PE0 - localPE(set) + Kr;
  if (heat < 0) {
    // not enough energy for these products after all: undo and let the atoms bounce
    const avail = 0.5 * X.m * A.m / (X.m + A.m) * ((A.vx - X.vx) ** 2 + (A.vy - X.vy) ** 2);
    if (-heat > 0.9 * avail) {
      removeBond(nb);
      if (rx.type === 'abs') addBond(A, B, oldOrder); else setOrder(bd, oldOrder);
      for (const [p, x, y, vx, vy] of saved) { p.x = x; p.y = y; p.vx = vx; p.vy = vy; }
      return;
    }
    kickPair(X, A, heat);
  } else {
    W.ledger.chem += heat;
    if (rx.type === 'abs') { if (!kickPair(B, A, heat)) dumpHeat(heat, X, A); }
    else dumpHeat(heat, X, A);
  }
  W.count.react++;
  const m1 = molecule(X), m2 = molecule(B);
  const after = m2.includes(X) ? hill(m1) : hill(m1) + ' + ' + hill(m2);
  log('chem', `Reaction: ${before} → ${after}  (ΔH ${rx.dH >= 0 ? '+' : ''}${(rx.dH * PHYS.KJMOL).toFixed(0)} kJ/mol${rx.cat ? ', catalysed' : ''})`);
}

function evBreak(bd, r) {
  if (W.bonds.indexOf(bd) < 0) return;
  const a = bd.a, b = bd.b;
  const dvx = b.vx - a.vx, dvy = b.vy - a.vy;
  const [dx, dy] = minImg(b.x - a.x, b.y - a.y);
  const rr = Math.hypot(dx, dy) || 1;
  const vn = (dvx * dx + dvy * dy) / rr;
  if (vn <= 0) return;
  const set = setOf(molecule(a));
  const PE0 = localPE(set);
  removeBond(bd);
  const cost = localPE(set) - PE0;
  const mu = a.m * b.m / (a.m + b.m);
  if (0.5 * mu * vn * vn < cost) { addBond(a, b, bd.order); return; } // not enough energy: stays bound
  kickPair(b, a, -cost, dx / rr, dy / rr);
  W.count.broken++;
  log('chem', `Bond broke: ${a.el.sym}–${b.el.sym} (needed ${fmtE(bd.D)})`);
}

/* Electron or positron meets a nucleus/atom. */
function evLepton(L, A, r) {
  if (L.dead || A.dead) return;
  const rh = A.ne > 0 ? 0.35 + 0.5 * A.el.rc : 0.55;
  const mu = L.m * A.m / (L.m + A.m);
  const dvx = L.vx - A.vx, dvy = L.vy - A.vy;
  const Erel = 0.5 * mu * (dvx * dvx + dvy * dvy);
  if (clash(L, A)) { // a positron at ordinary matter, or an electron at antimatter
    if (r > rh || L.hit === A.id) return;
    L.hit = A.id;
    if (A.ne > 0) annihilateBound(L, A); else elasticScatter(L, A, 0);
    return;
  }
  // recombination into an ion (positive for matter, negative for antimatter): bound leptons are captured,
  // free ones only sometimes (radiative)
  const sg = A.anti ? -1 : 1;
  if (sg * A.q >= 1) {
    const qt = sg * A.q;
    const Etot = Erel - PHYS.KE * qt / Math.sqrt(r * r + A.sEN);
    // two-body binding ignores the neighbours' fields (continuum lowering), so require a clearly bound orbit; a lepton
    // whose last try could not be paid for waits a while (undoJoin)
    const may = !(L.capT > W.t);
    if (Etot < -0.15 * ionE(A.Z, A.ne + 1)) { if (may && rnd() < 0.5) capture(L, A, Etot); return; }
    if (Etot < 0) { if (may && rnd() < 0.02) capture(L, A, Etot); return; } // loosely bound (Rydberg-like) orbit
    if (may && r < rh && L.hit !== A.id && rnd() < 0.04 / (1 + Etot / 0.5)) { capture(L, A, Etot); return; }
  }
  if (r >= rh || L.hit === A.id) return;
  L.hit = A.id;
  if (A.ne > 0 && A.q === 0 && A.el.ea > 0 && A.ne < A.Z + maxExtraElectrons(A.Z) && !(L.capT > W.t) && rnd() < 0.04) {
    if (attach(L, A, Erel)) return;
  }
  if (A.ne > 0) {
    // Only the electron's energy relative to the atom counts: near an ion it has extra kinetic energy
    // borrowed from the ion's own Coulomb well, which cannot be spent on ionizing or exciting it.
    const qa = A.q;
    const Eeff = Math.min(Erel, Erel + (qa ? PHYS.KE * L.q * qa / Math.sqrt(r * r + A.sEN) : 0));
    const ie = ionizationCost(A);
    if (Eeff > ie) {
      const x = Eeff / ie, P = Math.min(0.8, 1.6 * Math.log(x) / x);
      if (rnd() < P) { impactIonize(L, A, ie, Erel); return; }
    }
    const line = lineInfo(A);
    if (line && Eeff > line.thr && rnd() < 0.15) { exciteByElectron(L, A, line, Eeff); return; }
  }
  elasticScatter(L, A, Erel);
}
function lineInfo(A) {
  if (A.ne === 1 && A.Z <= 10) return { thr: 12.09 * A.Z * A.Z, hydrogenic: true };
  if (A.q !== 0) return null;
  return LINES[A.el.sym] || null;
}
/* Rydberg energy for a one-electron atom of this nucleus: the electron and nucleus circle their common centre,
   which shifts hydrogen's lines by 0.05% (Hα at 656.47 nm in vacuum, not 656.11). */
function rydbergOf(A) { return PHYS.RY / (1 + PHYS.ME / Math.max(1e-6, A.m - A.ne * PHYS.ME)); }
function pickLine(A, Eavail) {
  if (A.ne === 1) { // Balmer lines from n=3..6 cascades (plus Lyman-α in the ultraviolet)
    const RZ = rydbergOf(A) * A.Z * A.Z;
    const opts = [3, 4, 5, 6].filter(n => RZ * (1 - 1 / (n * n)) <= Eavail);
    if (!opts.length) return null;
    const n = opts[Math.floor(rnd() * opts.length)];
    return { nm: PHYS.HC / (RZ * (0.25 - 1 / (n * n))), extraUV: RZ * 0.75, thr: RZ * (1 - 1 / (n * n)) };
  }
  const L = LINES[A.el.sym]; if (!L) return null;
  let tot = 0; for (const l of L.l) tot += l[1];
  let u = rnd() * tot;
  for (const l of L.l) { u -= l[1]; if (u <= 0) return { nm: l[0], thr: L.thr }; }
  return { nm: L.l[0][0], thr: L.thr };
}
function emitLineFrom(A, ln) {
  const E = PHYS.HC / ln.nm;
  glow(A, wavelengthRGB(ln.nm));
  emitPhoton(A.x, A.y, E, undefined, undefined, { src: A, depth: 2 });
  if (ln.extraUV) emitPhoton(A.x, A.y, ln.extraUV, undefined, undefined, { src: A, depth: 2 });
}
function exciteByElectron(L, A, line, Eavail) {
  const ln = pickLine(A, Eavail);
  if (!ln) return;
  const mu = L.m * A.m / (L.m + A.m), Erel = 0.5 * mu * ((L.vx - A.vx) ** 2 + (L.vy - A.vy) ** 2);
  const f = Math.sqrt(Math.max(0, 1 - ln.thr / Erel));
  const Vx = (L.m * L.vx + A.m * A.vx) / (L.m + A.m), Vy = (L.m * L.vy + A.m * A.vy) / (L.m + A.m);
  const rvx = (L.vx - A.vx) * f, rvy = (L.vy - A.vy) * f;
  const th = (rnd() - 0.5) * 1.2, c = Math.cos(th), s = Math.sin(th);
  const nx = rvx * c - rvy * s, ny = rvx * s + rvy * c;
  L.vx = Vx + nx * A.m / (L.m + A.m); L.vy = Vy + ny * A.m / (L.m + A.m);
  A.vx = Vx - nx * L.m / (L.m + A.m); A.vy = Vy - ny * L.m / (L.m + A.m);
  updateFast(L);
  emitLineFrom(A, ln);
}
function elasticScatter(L, A, Erel) {
  const M = L.m + A.m;
  const Vx = (L.m * L.vx + A.m * A.vx) / M, Vy = (L.m * L.vy + A.m * A.vy) / M;
  const rvx = L.vx - A.vx, rvy = L.vy - A.vy;
  const th = rnd() * 2 * Math.PI, c = Math.cos(th), s = Math.sin(th);
  const nx = rvx * c - rvy * s, ny = rvx * s + rvy * c;
  L.vx = Vx + nx * A.m / M; L.vy = Vy + ny * A.m / M;
  A.vx = Vx - nx * L.m / M; A.vy = Vy - ny * L.m / M;
  updateFast(L);
}
/* Energy released when lepton L joins atom A (A.ne+1), from the exact potential and internal energies:
   kinetic energy of the pair (minus the merged atom's), their mutual and environmental potential energy,
   and the electronic energy. Leaves A unchanged. */
function joinEnergy(L, A) {
  const grid = G.n > 0, set = setOf(molecule(A)), sn = snapshot(set);
  const [dx, dy] = minImg(L.x - A.x, L.y - A.y), r2 = dx * dx + dy * dy;
  const qa0 = A.q, lpe = !(L.fast || L.rad); // (a lepton in flight carries no potential energy in the books)
  const V0 = (lpe ? PHYS.KE * L.q * qa0 * (1 / Math.sqrt(r2 + A.sEN) - csh(A, L, A.sEN)) : 0) + (grid ? localPE(set, L) + (lpe ? L.q * phiE(L.x, L.y, A, L) : 0) : 0);
  let K0 = keOf(L);
  for (const p of set) K0 += 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy);
  const I0 = internalE(A);
  const px = L.m * L.vx + A.m * A.vx, py = L.m * L.vy + A.m * A.vy;
  A.ne++; refresh(A); A.vx = px / A.m; A.vy = py / A.m;
  enforceValence(A, null); closeSet(set);
  const V1 = grid ? localPE(set, L) : 0, I1 = internalE(A);
  let K1 = 0; for (const p of set) K1 += 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy);
  return { E: (K0 + V0 + I0) - (K1 + V1 + I1), sn };
}
/* A capture or attachment that the energy cannot pay for is put back exactly as it was: the forces already worked
   out still hold (_undone tells the steps so: no needless recount of every force), and the lepton waits before it
   tries again, longer each time (in a dense plasma that never pays, it used to retry on every one of its short steps,
   with a full force recount each time). */
let _undone = 0;
function undoJoin(L, sn, t0, d0) {
  restoreSnap(sn);
  _undone += (W.topo - t0) + (W.dirty - d0);
  L.capT = W.t + Math.min(1, 0.05 * Math.pow(2, L.capN)); L.capN = Math.min(L.capN + 1, 5);
}
function capture(L, A, Etot) {
  const before = speciesLabel(A), t0 = W.topo, d0 = W.dirty;
  const tr = joinEnergy(L, A);
  let Eph = tr.E;
  if (Eph < 0) { // deficit: only if the neighbourhood can supply it
    const nb = nearestThird(A, L, 6), nv = nb ? [nb.vx, nb.vy] : null;
    const got = nb && Eph > -2 ? -kickPair(A, nb, Eph) : 0;
    if (got < -Eph - 1e-6) { if (nb) { nb.vx = nv[0]; nb.vy = nv[1]; } undoJoin(L, tr.sn, t0, d0); return; }
    Eph = 0;
  }
  kill(L);
  const ie = ionE(A.Z, A.ne);
  W.count.recomb++;
  if (A.ne === 1 && A.Z <= 10) {
    // hydrogen-like: recombination populates excited levels (∝ 1/n), which cascade down emitting
    // Rydberg lines — Lyman (UV), Balmer (visible: 656, 486, 434, 410 nm), Paschen (IR)
    const Z2 = A.Z * A.Z * rydbergOf(A) / PHYS.RY; // (the reduced mass's correction folded in)
    const w = [0, 0.35, 0.15, 0.14, 0.12, 0.09, 0.08, 0.07];
    let u = rnd(), n = 1;
    for (let k = 1; k < w.length; k++) { u -= w[k]; if (u <= 0) { n = k; break; } }
    while (n > 1 && PHYS.RY * Z2 * (1 - 1 / (n * n)) > Eph) n--; // can't cascade from above the energy available
    const cascade = PHYS.RY * Z2 * (1 - 1 / (n * n));
    const cont = Eph - cascade;
    if (cont > 0.05) emitPhoton(A.x, A.y, cont, undefined, undefined, { src: A, depth: 2 });
    else if (cont > 0) dumpHeat(cont, A, A);
    while (n > 1) {
      const lo = n === 2 ? 1 : (rnd() < 0.55 ? 2 : 1 + Math.floor(rnd() * (n - 1)));
      const Eline = PHYS.RY * Z2 * (1 / (lo * lo) - 1 / (n * n));
      const nm = PHYS.HC / Eline;
      if (nm > 380 && nm < 780) glow(A, wavelengthRGB(nm));
      emitPhoton(A.x, A.y, Eline, undefined, undefined, { src: A, depth: 2 });
      n = lo;
    }
  } else if (Eph > 0.05) {
    emitPhoton(A.x, A.y, Eph, undefined, undefined, { src: A, depth: 2 });
  } else if (Eph > 0) dumpHeat(Eph, A, A);
  const after = speciesLabel(A);
  if (A.ne === 1 && A.Z === 1) log('em', A.anti ? `Antihydrogen formed: p̄ + e⁺ → H̄ (${fmtE(ie)} binding, the same light as hydrogen)`
    : `Recombination: p⁺ + e⁻ → H atom (${fmtE(ie)} binding, light emitted)`);
  else log('em', `${A.anti ? 'Positron' : 'Electron'} captured: ${before} + ${A.anti ? 'e⁺' : 'e⁻'} → ${after}`);
}
function attach(L, A, Erel) {
  // forming an anion may break bonds (dissociative attachment); all of it is in the energy balance
  const t0 = W.topo, d0 = W.dirty, tr = joinEnergy(L, A), Eph = tr.E;
  if (!(Eph >= 0)) { undoJoin(L, tr.sn, t0, d0); return false; }
  kill(L);
  if (Eph > 0.05) emitPhoton(A.x, A.y, Eph, undefined, undefined, { src: A, depth: 2 });
  log('em', `${L.k === POS ? 'Positron' : 'Electron'} attachment: ${L.k === POS ? 'e⁺' : 'e⁻'} + ${A.anti ? barSym(A.el.sym) : A.el.sym} → ${speciesLabel(A)} (affinity ${fmtE(A.el.ea)})`);
  return true;
}
function impactIonize(L, A, ie, Erel) {
  if (freeElectronCount() >= MAX_FREE_E) return;
  const before = speciesLabel(A);
  const avail = Erel - ie, fk = 0.55 + 0.45 * rnd();
  const sv = [L.vx, L.vy, A.vx, A.vy];
  // remove ionization energy from the relative motion
  const f = Math.sqrt(Math.max(0, avail * fk) / Erel);
  const Vx = (L.m * L.vx + A.m * A.vx) / (L.m + A.m), Vy = (L.m * L.vy + A.m * A.vy) / (L.m + A.m);
  const rvx = (L.vx - A.vx) * f, rvy = (L.vy - A.vy) * f;
  L.vx = Vx + rvx * A.m / (L.m + A.m); L.vy = Vy + rvy * A.m / (L.m + A.m);
  A.vx = Vx - rvx * L.m / (L.m + A.m); A.vy = Vy - rvy * L.m / (L.m + A.m);
  if (!ejectElectron(A, avail * (1 - fk))) { L.vx = sv[0]; L.vy = sv[1]; A.vx = sv[2]; A.vy = sv[3]; return; }
  updateFast(L);
  W.count.ionize++;
  const lk = L.k === POS ? 'e⁺' : 'e⁻';
  log('em', `Impact ionization: ${lk} + ${before} → ${speciesLabel(A)} + 2${lk} (${fmtE(ie)})`);
}
/* ---- annihilation energetics ----
   Every annihilation is energy-exact: the γ rays (or pions) carry off precisely what the particles involved
   held — rest mass, motion, lepton binding, bonds and Coulomb terms with their surroundings — minus what is
   left behind (an ion, freed leptons, knocked-out nucleons). The rest mass destroyed goes to the ledger. */
const AMU_EV = PHYS.AMU_MEV * 1e6, ME_C2 = PHYS.ME * AMU_EV;
function restE(p) { return (p.k === NUC ? p.m : PHYS.ME) * AMU_EV; }
function keOf(p) { return p.rad ? p.KE : 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy); }
function inMD(p) { return !p.dead && !p.rad && !p.fast && !(p.k === NUC && p.Z === 0); }
/* Pair potential exactly as totalEnergy() counts it. */
function pairPE(a, b) {
  const [dx, dy] = minImg(b.x - a.x, b.y - a.y), r2 = dx * dx + dy * dy;
  let V = 0;
  if (r2 < RC2) {
    if (a.k === NUC && b.k === NUC) { if (!(a.mol !== 0 && a.mol === b.mol && a.excl && a.excl.has(b.id))) V += nucPairV(a, b, r2); }
    else if (a.k === NUC || b.k === NUC) {
      const A = a.k === NUC ? a : b, L = A === a ? b : a, qa = A.q;
      if (qa) V += PHYS.KE * L.q * qa * (1 / Math.sqrt(r2 + A.sEN) - csh(A, L, A.sEN));
    } else V += PHYS.KE * a.q * b.q * (1 / Math.sqrt(r2 + 0.04) - csh(a, b, 0.04));
  }
  if (_lrOn && (a.k !== NUC || Math.abs(a.q) >= 1) && (b.k !== NUC || Math.abs(b.q) >= 1)) {
    const r = Math.hypot(b.x - a.x, b.y - a.y);
    if (r >= RC) V += PHYS.KE * qx(a, b) * qx(b, a) / r;
  }
  return V;
}
function wallPE(p) {
  const hw = W.box.w / 2, hh = W.box.h / 2, k = 30 * Math.min(1, p.m);
  let V = 0;
  if (p.x > hw) V += 0.5 * k * (p.x - hw) ** 2; else if (p.x < -hw) V += 0.5 * k * (-hw - p.x) ** 2;
  if (p.y > hh) V += 0.5 * k * (p.y - hh) ** 2; else if (p.y < -hh) V += 0.5 * k * (-hh - p.y) ** 2;
  return V;
}
/* Everything the particles in T hold, including their interactions with all other particles. */
function regionE(T) {
  const md = [];
  for (const p of W.parts) if (inMD(p)) md.push(p);
  let E = 0;
  const seenB = new Set();
  for (const p of T) {
    if (p.dead) continue;
    E += restE(p) + keOf(p) + internalE(p);
    for (const bd of p.bonds) if (!seenB.has(bd)) { seenB.add(bd); E += -bd.D - bd.Ef + morseV(bd, dist(bd.a, bd.b)); }
    if (!inMD(p)) continue;
    for (const o of md) if (o !== p && !(T.has(o) && o.id < p.id)) E += pairPE(p, o);
    if (p.bonds.length >= 2) E += angleEnergy(p);
    if (W.wall === 'reflect') E += wallPE(p);
  }
  return E;
}
function restSum(T) { let m = 0; for (const p of T) if (!p.dead) m += restE(p); return m; }
function annihBegin(seeds) {
  const T = new Set();
  for (const s of seeds) for (const m of molecule(s)) T.add(m);
  return { T, E0: regionE(T), m0: restSum(T), n0: W.parts.length };
}
/* Close the books: returns the energy the radiation must carry. */
function annihEnd(S) {
  for (let i = S.n0; i < W.parts.length; i++) S.T.add(W.parts[i]);
  W.ledger.nuc += S.m0 - restSum(S.T);
  return Math.max(0, S.E0 - regionE(S.T));
}
/* Exact books for a nuclear event (a decay, fusion, fission, a neutron's reaction): nucBegin before anything
   changes. Once the products exist (with roughly the right energies), nucLeft says how much of Qrel, the energy
   released from mass, is still unspent (or overspent, if negative) after everything the event changed: the
   products' motion and potential energy, the electrons' binding, broken bonds, radiation already emitted. That
   remainder goes to the radiation or into the products' motion, so energy is conserved exactly. */
function nucBegin(seeds) {
  const T = new Set(), ev = ++W.evSeq;
  for (const s of seeds) if (s && !s.dead) { s.evId = ev; for (const m of molecule(s)) T.add(m); }
  const m0 = restSum(T);
  return { T, m0, E0: regionE(T) - m0, esc0: W.ledger.escaped, n0: W.parts.length, ev };
}
/* (what one event made, and what took part, share its id: they start where it happened, overlapping on this enlarged
   scale, and must not collide with each other there again) */
function nucGrow(S) { for (let i = S.n0; i < W.parts.length; i++) { S.T.add(W.parts[i]); W.parts[i].evId = S.ev; } S.n0 = W.parts.length; }
const sameEv = (a, b) => a.evId !== 0 && a.evId === b.evId;
function nucMassLoss(S) { nucGrow(S); return S.m0 - restSum(S.T); } // rest energy turned into other forms (eV)
function nucLeft(S, Qrel) { nucGrow(S); return S.E0 + Qrel - (regionE(S.T) - restSum(S.T)) - (W.ledger.escaped - S.esc0); }
/* Velocity whose ½mv² is the particle's kinetic energy (a radiation-mode particle moves at its relativistic speed). */
function vNR(q) { if (!q.rad) return [q.vx, q.vy]; const v = Math.sqrt(2 * q.KE * q.im); return [v * q.ux, v * q.uy]; }
/* Give the products' motion about their centre of mass dE more kinetic energy (less if negative), keeping their
   total momentum. */
function shareKE(ps, dE) {
  ps = ps.filter(q => q && !q.dead);
  if (!ps.length || !dE) return;
  const vs = ps.map(vNR);
  let M = 0, Px = 0, Py = 0;
  ps.forEach((q, i) => { M += q.m; Px += q.m * vs[i][0]; Py += q.m * vs[i][1]; });
  const Vx = Px / M, Vy = Py / M;
  let K = 0;
  ps.forEach((q, i) => { const dx = vs[i][0] - Vx, dy = vs[i][1] - Vy; K += 0.5 * q.m * (dx * dx + dy * dy); });
  if (!(K > 0)) return;
  const sc = Math.sqrt(Math.max(0, K + dE) / K);
  ps.forEach((q, i) => setVel(q, Vx + sc * (vs[i][0] - Vx), Vy + sc * (vs[i][1] - Vy)));
}
/* Settle a nuclear event's books by adjusting the products' relative motion (twice: a mode switch moves energy
   between potential and kinetic). Returns the remainder (eV), normally zero. */
function settleKE(S, Qrel, ps) {
  let left = nucLeft(S, Qrel);
  for (let k = 0; k < 3 && Math.abs(left) > 1e-9 * Math.max(1, Math.abs(Qrel)); k++) { shareKE(ps, left); left = nucLeft(S, Qrel); }
  return left;
}

function annihilateBound(Pp, A) {
  if (A.ne <= 0 || A.dead || Pp.dead) return;
  const x = Pp.x, y = Pp.y, who = speciesLabel(A);
  const S = annihBegin([Pp, A]);
  kill(Pp); A.ne--; refresh(A); enforceValence(A, null); relink([A]);
  twoGamma(x, y, annihEnd(S));
  W.count.annih++;
  nucEvent('annih', x, y, `${Pp.k === POS ? 'e⁺' : 'e⁻'} + ${who} → ${speciesLabel(A)} + 2γ`, [ghostOf(Pp)], '511 keV each');
  log('nuc', `Annihilation: ${Pp.k === POS ? 'e⁺ meets an electron' : 'e⁻ meets a positron'} of ${who} → 2γ (511 keV each)`);
}
/* Matter touches antimatter. Electron clouds meet first: a bound e⁻ and a bound e⁺ annihilate. Once a
   (anti)nucleus is bare and reaches the other nucleus, a nucleon and an antinucleon annihilate. */
function evAnti(a, b, r) {
  if (a.dead || b.dead || !opp(a, b)) return;
  const x = 0.5 * (a.x + b.x), y = 0.5 * (a.y + b.y);
  if (a.ne > 0 && b.ne > 0) {
    const la = speciesLabel(a), lb = speciesLabel(b);
    const S = annihBegin([a, b]);
    a.ne--; b.ne--; refresh(a); refresh(b); enforceValence(a, null); enforceValence(b, null); relink([a, b]);
    twoGamma(x, y, annihEnd(S)); W.count.annih++;
    nucEvent('annih', x, y, `${la} touches ${lb}: e⁻ + e⁺ → 2γ`, [], '511 keV each');
    log('nuc', `Annihilation: ${la} touches ${lb}; an electron and a positron → 2γ (511 keV each)`);
    return;
  }
  nuclearAnnihilation(a, b);
}
/* A nucleon and an antinucleon annihilate (≈1.88 GeV): a spray of mesons, about five pions (hep.js: charged ones
   fly out of the chamber, neutral ones decay at once into γ rays), now and then kaons. The antiprotonic atom's
   cascade shakes out a few electrons first, and a struck nucleus is left hot and boils off a few nucleons. */
function nuclearAnnihilation(a, b) {
  if (a.dead || b.dead) return;
  const anti = a.anti ? a : b, mat = anti === a ? b : a;
  const [avx, avy] = velOf(a), [bvx, bvy] = velOf(b);
  const vx = (a.m * avx + b.m * bvx) / (a.m + b.m), vy = (a.m * avy + b.m * bvy) / (a.m + b.m);
  const x = 0.5 * (a.x + b.x), y = 0.5 * (a.y + b.y);
  const before = `${speciesLabel(anti)} + ${speciesLabel(mat)}`;
  const parents = [anti, mat].map(ghostOf);
  const S = annihBegin([a, b]);
  const partners = [];
  for (const n of [a, b]) for (const bd of n.bonds) partners.push(other(bd, n));
  const takeP = (n) => n.Z > 0 && (n.N === 0 || rnd() < n.Z / (n.Z + n.N));
  const pA = takeP(anti), pM = takeP(mat);
  if (pA) anti.Z--; else anti.N--;
  if (pM) mat.Z--; else mat.N--;
  let evap = 0;
  const A1 = mat.Z + mat.N;
  if (A1 >= 2) evap = Math.min(A1 - 1, Math.floor(rnd() * 2 + 0.7 * Math.cbrt(A1 + 1)));
  for (let i = 0; i < evap; i++) {
    const isP = mat.Z > 0 && rnd() < mat.Z / (mat.Z + mat.N);
    if (isP) mat.Z--; else mat.N--;
    const th = rnd() * 2 * Math.PI;
    const q = addNuc(isP ? 1 : 0, isP ? 0 : 1, 0, x, y);
    setMotion(q, (2 + 18 * rnd()) * 1e6, Math.cos(th), Math.sin(th), vx, vy);
  }
  for (const n of [anti, mat]) {
    if (n.dead) continue;
    if (n.Z <= 0) { // nothing charged is left: free its leptons and any loose (anti)neutrons
      const ne = n.ne, lk = n.anti ? POS : ELEC, nn = Math.max(0, n.N), nx = n.x, ny = n.y, wasAnti = n.anti;
      kill(n);
      for (let i = 0; i < ne; i++) {
        const th = rnd() * 2 * Math.PI, l = addLepton(lk, nx + 0.6 * Math.cos(th), ny + 0.6 * Math.sin(th));
        setMotion(l, 2, Math.cos(th), Math.sin(th), vx, vy);
      }
      for (let i = 0; i < nn; i++) { const q = addNuc(0, 1, 0, nx, ny, 0, 0, wasAnti); const th = rnd() * 2 * Math.PI; setMotion(q, 2e6, Math.cos(th), Math.sin(th), vx, vy); }
    } else {
      refresh(n); enforceValence(n, null); relink([n]);
      // Auger electrons from the exotic atom's cascade, plus any the smaller nucleus can no longer hold
      const k = Math.max(0, n.ne - n.Z) + (n.ne > 0 ? 1 + Math.floor(rnd() * 2) : 0);
      for (let i = 0; i < k && n.ne > 0; i++) if (!ejectElectron(n, 20 + 80 * rnd(), undefined, undefined, 0)) break;
      stabilize(n);
    }
  }
  relink(partners.filter(p => !p.dead));
  const E = annihEnd(S);
  const ms = mesonBurst(x, y, E, vx, vy, (pM ? 1 : 0) - (pA ? 1 : 0));
  W.count.annih++;
  const left = [anti, mat].filter(n => !n.dead).map(n => speciesLabel(n)), what = ms.length ? summarize(ms) : 'γ rays';
  nucEvent('annih', x, y, `${before} → ${left.length ? left.join(' + ') + ' + ' : ''}${what}`, parents, fmtE(E));
  log('nuc', `Antimatter annihilation: ${before} → ${what} (${fmtE(E)})${evap ? `, ${evap} nucleon${evap > 1 ? 's' : ''} knocked out` : ''}`);
  tally(ms, [], `Annihilation: ${before} → ${what}`);
}
function evAnnihFree(a, b) {
  if (a.dead || b.dead) return;
  const x = 0.5 * (a.x + b.x), y = 0.5 * (a.y + b.y);
  const S = annihBegin([a, b]);
  const gh = [a, b].map(ghostOf);
  kill(a); kill(b);
  twoGamma(x, y, annihEnd(S));
  W.count.annih++;
  nucEvent('annih', x, y, 'e⁺ + e⁻ → 2γ', gh, '511 keV each');
  log('nuc', 'Annihilation: e⁺ + e⁻ → 2γ (511 keV each)');
}
/* Two back-to-back γ rays sharing E (two electron masses plus whatever kinetic and binding energy). */
function twoGamma(x, y, E = 2 * ME_C2) {
  const th = rnd() * 2 * Math.PI, ux = Math.cos(th), uy = Math.sin(th);
  emitPhoton(x, y, E / 2, ux, uy); emitPhoton(x, y, E / 2, -ux, -uy);
  flash(x, y, [255, 255, 255], 3, 0.4);
}

/* Bare proton meets a lone pair: dative bond (H⁺ + H₂O → H₃O⁺, H⁺ + NH₃ → NH₄⁺, H⁺ + Cl⁻ → HCl). */
function evDative(H, D, r) {
  if (H.dead || D.dead || opp(H, D) || H.ne !== 0 || H.Z !== 1 || D.ne === 0 || D.lp < 1) return;
  const capAfter = (() => {
    const vi = valenceInfo(D.Z, D.ne - 1); if (D.el.dblock) return 0;
    if (vi.n === 1) return vi.v === 1 ? 1 : 0;
    return vi.v >= 8 ? 0 : vi.v <= 4 ? vi.v : 8 - vi.v;
  })();
  if (capAfter < D.used + 1) return;
  const before = hill(molecule(D));
  const PA = PROTON_AFFINITY[D.el.sym + ':' + D.q] ?? 6.0;
  const set = setOf(molecule(D), [H]);
  const saved = [...set].map(p => [p, p.x, p.y, p.vx, p.vy]);
  const E0 = localPE(set) + internalE(D) + internalE(H);
  D.ne--; H.ne++; refresh(D); refresh(H);
  const Kr = snapTogether(H, D, bondParams1(H.el, D.el)[0]);
  const bd = addBond(D, H, 1);
  // energy released by the model's potentials (the tabulated proton affinity is shown for reference)
  const heat = E0 - (localPE(set) + internalE(D) + internalE(H)) + Kr;
  if (heat < 0) {
    const got = -kickPair(H, D, heat);
    if (got < -heat - 1e-6) { // not enough collision energy: undo
      removeBond(bd); D.ne++; H.ne--; refresh(D); refresh(H);
      for (const [p, x, y, vx, vy] of saved) { p.x = x; p.y = y; p.vx = vx; p.vy = vy; }
      return;
    }
  } else dumpHeat(heat, H, D);
  W.count.react++;
  const mol = molecule(D), nm = moleculeName(mol);
  log('chem', `Proton bonded: H⁺ + ${before} → ${hill(mol)}${nm ? ' (' + nm + ')' : ''}`);
}

/* Electron transfer between a donor and an acceptor when it lowers the total energy (Born–Haber). */
function localPhi(x, y, skipA, skipB) {
  let phi = 0;
  nearby(x, y, RC, (p, dx, dy, r2) => {
    if (p === skipA || p === skipB) return;
    const q = p.k === NUC ? p.q + p.qp : p.q;
    if (q !== 0) phi += PHYS.KE * q / Math.sqrt(r2 + 0.09);
  });
  return phi;
}
function breakCostIfCharged(p, dne) {
  // cost of bonds that would have to break if p gained (dne=+1) or lost (dne=-1) an electron
  if (!p.bonds.length || p.ne + dne < 0) return 0;
  if (p.ne + dne === 0) return p.bonds.reduce((s, bd) => s + bd.D, 0);
  const vi = valenceInfo(p.Z, p.ne + dne);
  let cap;
  if (p.el.dblock) cap = Math.max(0, p.el.ox - Math.max(0, p.Z - p.ne - dne));
  else if (vi.n === 1) cap = vi.v === 1 ? 1 : 0;
  else cap = vi.v >= 8 ? 0 : vi.v <= 4 ? vi.v : 8 - vi.v;
  const hyper = p.bonds.some(bd => other(bd, p).el && other(bd, p).el.en >= 3);
  if (hyper && !p.el.dblock && periodOf(p.Z) >= 3 && vi.v > 4) cap = Math.max(cap, Math.min(vi.v, 8));
  let need = p.used - cap, cost = 0;
  if (need <= 0) return 0;
  const sorted = p.bonds.slice().sort((x, y) => x.D - y.D);
  for (const bd of sorted) { if (need <= 0) break; cost += bd.D; need -= bd.order; }
  return cost;
}
/* Highest charge an atom reaches by handing electrons to neighbours: its usual top oxidation state.
   (Electron impact or heat can strip more; chemistry can't.) Non-metals only give up extra electrons. */
function maxCation(p) {
  const el = p.el;
  if (!el.metal) return 0;
  if (el.dblock) return el.ox || 2;
  return Math.max(1, valenceInfo(p.Z, p.Z).v);
}
function transferDE(d, a, r) { // donor d gives one electron to acceptor a
  if (d.ne <= 0 || bondBetween(d, a)) return Infinity;
  if (a.k !== NUC || d.k !== NUC) return Infinity;
  if (d.q + 1 > maxCation(d)) return Infinity;
  const ieD = ionE(d.Z, d.ne);
  let R;
  if (a.ne + 1 <= a.Z) R = ionE(a.Z, a.ne + 1);
  else if (a.ne + 1 === a.Z + 1) { if (!(a.el.ea >= 0.7)) return Infinity; R = a.el.ea; } // stable anions only
  else if (a.ne + 1 <= a.Z + maxExtraElectrons(a.Z)) R = ionE(a.Z, a.ne + 1);
  else return Infinity;
  const phiD = localPhi(d.x, d.y, d, a), phiA = localPhi(a.x, a.y, d, a);
  // the pair's own Coulomb energy before and after, in the form the forces use: a bare nucleus sees an atom's
  // charge spread through its cloud (smearV); between two atoms the old estimate stands
  const g = (bareD, bareA) => (bareD !== bareA ? smearV(r) : bareD ? 1 / Math.sqrt(r * r + 0.0016) : 1 / Math.max(r, 0.6));
  const dCoul = phiD - phiA + PHYS.KE * ((d.q + 1) * (a.q - 1) * g(d.ne === 1, false) - d.q * a.q * g(false, a.ne === 0));
  return ieD - R + dCoul + breakCostIfCharged(d, -1) + breakCostIfCharged(a, +1);
}
function evTransfer(a, b, r) {
  if (a.dead || b.dead || a.k !== NUC || b.k !== NUC) return;
  if (a.Z === 0 || b.Z === 0 || bondBetween(a, b)) return;
  if (a.mol && a.mol === b.mol) return; // (within one molecule the charges spread on their own: delocalize)
  const e1 = transferDE(a, b, r), e2 = transferDE(b, a, r);
  let d, acc, dE;
  if (e1 <= e2) { d = a; acc = b; dE = e1; } else { d = b; acc = a; dE = e2; }
  if (!isFinite(dE)) return;
  // Hops go both ways: downhill ones release energy, uphill ones are paid from the pair's collision
  // energy. Allowing only downhill hops would act as a ratchet that pumps heat into dense matter;
  // with both, hop rates obey detailed balance (uphill ∝ e^(−ΔE/kT), as in surface hopping).
  const mu = d.m * acc.m / (d.m + acc.m), dvx = d.vx - acc.vx, dvy = d.vy - acc.vy;
  const Ek = 0.5 * mu * (dvx * dvx + dvy * dvy);
  if (dE > Ek + 0.5 || rnd() > 0.3) return; // the cheap estimate says it can't be afforded
  const bd0 = speciesLabel(d), ba0 = speciesLabel(acc);
  // exact energy change with the model's own potentials (sizes, charges, electronic energies, any
  // bonds that must break), applied on trial and undone if the collision can't pay for it
  const set = setOf(molecule(d), molecule(acc)), sn = snapshot(set);
  const E0 = localPE(set) + internalE(d) + internalE(acc);
  const caught = acc.ne === 0; // a bare nucleus catching an electron becomes an atom, with a size of its own
  d.ne--; acc.ne++; refresh(d); refresh(acc);
  enforceValence(d, null); enforceValence(acc, null);
  if (caught && d.ne > 0) separate(d, acc); // the electron jumps before the nucleus is deep inside the donor's cloud
  closeSet(set);
  const heat = E0 - (localPE(set) + internalE(d) + internalE(acc));
  if (heat >= 0) dumpHeat(heat, d, acc);
  else {
    const got = -kickPair(d, acc, heat);
    if (got < -heat - 1e-6) { restoreSnap(sn); return; }
  }
  W.count.xfer++;
  if (d.Z === acc.Z && d.q === acc.q + 2) return; // resonant charge exchange (A + A⁺ → A⁺ + A): too frequent to list
  const ionic = d.q > 0 && acc.q < 0;
  log('chem', `${ionic ? 'Ionic bond' : 'Charge transfer'}: ${bd0} + ${ba0} → ${speciesLabel(d)} + ${speciesLabel(acc)} (${heat >= 0 ? fmtE(heat) + ' released' : fmtE(-heat) + ' absorbed'})`);
}

/* Energetic atom–atom collision: thermal excitation (flame colours) or collisional ionization. */
function evHot(a, b, r) {
  if (a.dead || b.dead) return;
  const mu = a.m * b.m / (a.m + b.m);
  const dvx = b.vx - a.vx, dvy = b.vy - a.vy;
  const Ecm = 0.5 * mu * (dvx * dvx + dvy * dvy);
  // collision energy that is really available: not the extra speed two ions gained falling together
  const E = Math.min(Ecm, Ecm + (a.ne > 0 && b.ne > 0 ? pairNonbondedV(a, b, r) : 0));
  // excitation
  for (const p of [a, b]) {
    const L = lineInfo(p);
    if (L && E > L.thr && rnd() < 0.03 * Math.exp(-L.thr / 2.5)) {
      const ln = pickLine(p, E);
      if (ln) { kickPair(a, b, -ln.thr); emitLineFrom(p, ln); return; }
    }
  }
  // ionization of the more weakly bound partner
  let t = null, ie = Infinity;
  for (const p of [a, b]) if (p.ne > 0) { const e = ionizationCost(p); if (e < ie) { ie = e; t = p; } }
  if (t && E > ie && rnd() < 0.3 * (1 - ie / E) && freeElectronCount() < MAX_FREE_E) {
    const KEe = 0.25 * (E - ie);
    const before = speciesLabel(t);
    const sa = [a.vx, a.vy, b.vx, b.vy];
    kickPair(a, b, -(ie + KEe));
    if (!ejectElectron(t, KEe)) { a.vx = sa[0]; a.vy = sa[1]; b.vx = sa[2]; b.vy = sa[3]; return; }
    W.count.ionize++;
    log('em', `Thermal ionization: ${before} → ${speciesLabel(t)} + e⁻ (${fmtE(ie)})`);
  }
}

/* ------------------------------------------------------------------ nuclear reactions */
function fusionKey(a, b) {
  const ka = a.Z + '_' + a.N, kb = b.Z + '_' + b.N;
  return (a.Z < b.Z || (a.Z === b.Z && a.N <= b.N)) ? ka + '+' + kb : kb + '+' + ka;
}
const LIGHT = [[0,1,'n'],[1,0,'p'],[2,2,'α'],[1,1,'d'],[1,2,'t'],[2,1,'³He']];
function fusionChannels(a, b) {
  const Zc = a.Z + b.Z, Nc = a.N + b.N;
  const before = [[a.Z, a.N], [b.Z, b.N]];
  const ch = [];
  const seen = new Set();
  for (const [lz, ln] of LIGHT) {
    const rz = Zc - lz, rn = Nc - ln;
    if (rz < 0 || rn < 0 || rz + rn === 0) continue;
    const key = [Math.min(rz * 1000 + rn, lz * 1000 + ln), Math.max(rz * 1000 + rn, lz * 1000 + ln)].join();
    if (seen.has(key)) continue; seen.add(key);
    const res = nuclideInfo(rz, rn);
    if (res.unbound && !(rz === 0 && rn === 1)) continue;
    if ((rz === a.Z && rn === a.N) || (rz === b.Z && rn === b.N)) continue; // elastic
    const Q = dB([[rz, rn], [lz, ln]], before);
    if (Q > 0) ch.push({ prods: [[rz, rn], [lz, ln]], Q, gamma: false });
  }
  // two-proton / two-neutron exits (e.g. ³He + ³He → ⁴He + 2p)
  for (const [lz, ln] of [[2, 0], [0, 2]]) {
    const rz = Zc - lz, rn = Nc - ln;
    if (rz < 1 || rn < 0) continue;
    const res = nuclideInfo(rz, rn); if (res.unbound) continue;
    const Q = dB([[rz, rn]], before);
    if (Q > 0) ch.push({ prods: [[rz, rn]].concat(lz ? [[1, 0], [1, 0]] : [[0, 1], [0, 1]]), Q, gamma: false });
  }
  return ch;
}
/* The chance that a close pass fuses: Gamow's tunnelling factor e^(−√(E_G/E)) over E, scaled by the reaction's
   relative S-factor (FUSION_S, D–T = 1). D–T follows its measured cross section above DT_KNEE, the energy the
   D + T collider's beams meet at: there its resonance (the peak at 64 keV) is over and σ falls fast, about 25 times
   from 150 keV to 4.8 MeV, which a constant S-factor misses. Below DT_KNEE the chance is as it always was. */
const DT_KNEE = 150; // keV, in their own frame
function gamowP(a, b, Ecm) { // Ecm in eV
  const EkeV = Ecm / 1000;
  if (EkeV <= 0.01) return 0;
  const mu = a.m * b.m / (a.m + b.m);
  const EG = 979.15 * mu * Math.pow(a.Z * b.Z, 2);
  const key = fusionKey(a, b);
  let S = FUSION_S[key];
  const ch = fusionChannels(a, b);
  if (S === undefined) S = ch.length ? 0.05 : 1e-4;
  if (key === '1_0+1_0') S *= W.warp; // its slow step is a weak (β⁺) decay, sped up with the other decays
  const gam = (E) => 5 * S * (100 / E) * Math.exp(-Math.sqrt(EG / E));
  const P = key === '1_1+1_2' && EkeV > DT_KNEE ? gam(DT_KNEE) * sigmaDT(EkeV) / sigmaDT(DT_KNEE) : gam(EkeV);
  return { P: Math.min(0.9, P), ch };
}
/* The measured D–T fusion cross section (mb) at E keV in their own frame: Bosch and Hale's fit (Nucl. Fusion 32,
   611, 1992), σ = S(E)/(E·e^(B_G/√E)) with S a Padé form, 0.5–550 keV and 550–4,700 keV; above that it is taken
   to fall as 1/E. */
function sigmaDT(E) {
  E = Math.max(0.5, E);
  if (E > 4700) return sigmaDT(4700) * 4700 / E;
  const S = E <= 550
    ? (6.927e4 + E * (7.454e8 + E * (2.050e6 + E * 5.2002e4))) / (1 + E * (63.8 + E * (-0.995 + E * (6.981e-5 + E * 1.728e-4))))
    : -1.4714e6 / (1 + E * (-8.4127e-3 + E * (4.7983e-6 + E * (-1.0748e-9 + E * 8.5184e-14))));
  return S / (E * Math.exp(34.3827 / Math.sqrt(E)));
}
function placeProduct(Z, N, ne, x, y) {
  return Z === 0 ? addNuc(0, N, 0, x, y) : addNuc(Z, N, ne, x, y);
}
/* Two-body (or three-body) breakup with total kinetic energy Eav in the CM frame moving at (Vx, Vy); Min, the
   reactants' mass, keeps the total momentum as the products' mass differs. */
function launchProducts(prods, Eav, Vx, Vy, x, y, neTotal, Min) {
  const ps = [];
  let neLeft = neTotal;
  const order = prods.map((p, i) => i).sort((i, j) => prods[j][0] - prods[i][0]);
  const ne = new Array(prods.length).fill(0);
  for (const i of order) { const take = Math.min(neLeft, prods[i][0]); ne[i] = take; neLeft -= take; }
  for (let i = 0; i < prods.length; i++) {
    const th = rnd() * 2 * Math.PI;
    ps.push(placeProduct(prods[i][0], prods[i][1], ne[i], x + 0.15 * Math.cos(th), y + 0.15 * Math.sin(th)));
  }
  if (Min) { const Mp = ps.reduce((m, q) => m + q.m, 0); Vx *= Min / Mp; Vy *= Min / Mp; }
  if (ps.length === 2) {
    const [p1, p2] = ps, mu = p1.m * p2.m / (p1.m + p2.m);
    const pr = Math.sqrt(2 * mu * Eav), th = rnd() * 2 * Math.PI, ux = Math.cos(th), uy = Math.sin(th);
    const v1 = pr / p1.m, v2 = pr / p2.m;
    setVel(p1, Vx + v1 * ux, Vy + v1 * uy); setVel(p2, Vx - v2 * ux, Vy - v2 * uy);
  } else {
    // three bodies: random momenta summing to zero, then scaled to Eav
    let px = [], py = [], sx = 0, sy = 0;
    for (let i = 0; i < ps.length; i++) { const th = rnd() * 2 * Math.PI; px[i] = Math.cos(th); py[i] = Math.sin(th); sx += px[i]; sy += py[i]; }
    for (let i = 0; i < ps.length; i++) { px[i] -= sx / ps.length; py[i] -= sy / ps.length; }
    let K = 0; for (let i = 0; i < ps.length; i++) K += 0.5 * (px[i] * px[i] + py[i] * py[i]) / ps[i].m;
    const s = Math.sqrt(Eav / Math.max(K, 1e-12));
    for (let i = 0; i < ps.length; i++) setVel(ps[i], Vx + s * px[i] / ps[i].m, Vy + s * py[i] / ps[i].m);
  }
  for (let i = 0; i < neLeft; i++) { const e = addLepton(ELEC, x, y); setMotion(e, 1, Math.cos(i), Math.sin(i), Vx, Vy); }
  return ps;
}
/* Set lab velocity; switches to radiation (ballistic) mode when energetic. */
function setVel(p, vx, vy) {
  const v = Math.hypot(vx, vy);
  const KE = 0.5 * p.m * v * v;
  const neutron = p.k === NUC && p.Z === 0;
  if (KE > (neutron ? NEUTRON_RAD : radThreshold(p.k !== NUC))) {
    p.rad = true; p.fast = true; p.KE = KE; p.ux = vx / v; p.uy = vy / v; radSpeed(p);
    p.vx = p.sp * p.ux; p.vy = p.sp * p.uy; if (!p.trk) startTrack(p);
  } else {
    p.rad = false; p.vx = vx; p.vy = vy; updateFast(p);
    if (neutron && KE > 1 && !p.trk) startTrack(p);
    else if (KE > 2000 && !p.trk) startTrack(p);
  }
}
function velOf(p) { return p.rad ? [p.sp * p.ux, p.sp * p.uy] : [p.vx, p.vy]; }

function tryFusion(a, b) {
  if (a.dead || b.dead) return false;
  if (opp(a, b)) { nuclearAnnihilation(a, b); return true; }
  if (a.anti || b.anti || a.Z < 1 || b.Z < 1 || a.Z + b.Z > Z_MAX) return false;
  const [avx, avy] = velOf(a), [bvx, bvy] = velOf(b);
  const mu = a.m * b.m / (a.m + b.m);
  const dvx = avx - bvx, dvy = avy - bvy;
  const Ecm = 0.5 * mu * (dvx * dvx + dvy * dvy);
  if (Ecm < 50) return false;
  const g = gamowP(a, b, Ecm);
  if (!(rnd() < g.P)) return false;
  const M = a.m + b.m, Vx = (a.m * avx + b.m * bvx) / M, Vy = (a.m * avy + b.m * bvy) / M;
  const x = 0.5 * (a.x + b.x), y = 0.5 * (a.y + b.y);
  const ne = a.ne + b.ne;
  const lbl = `${nucSym(a.Z, a.N)} + ${nucSym(b.Z, b.N)}`;
  const key = fusionKey(a, b);
  let prods, Q, gammaE = 0, weak = false;
  if (key === '1_0+1_0') { prods = [[1, 1]]; Q = 0.420; weak = true; }
  else if (g.ch.length) {
    const ws = g.ch.map(c => Math.sqrt(c.Q)); const tot = ws.reduce((s, w) => s + w, 0);
    let u = rnd() * tot, c = g.ch[0];
    for (let i = 0; i < ws.length; i++) { u -= ws[i]; if (u <= 0) { c = g.ch[i]; break; } }
    prods = c.prods; Q = c.Q;
  } else {
    const Zc = a.Z + b.Z, Nc = a.N + b.N;
    const comp = nuclideInfo(Zc, Nc);
    Q = dB([[Zc, Nc]], [[a.Z, a.N], [b.Z, b.N]]);
    if (Q * 1e6 + Ecm <= 0 || (comp.unbound && comp.t12 < 1e-19)) return false;
    prods = [[Zc, Nc]]; gammaE = Q * 1e6 + Ecm;
  }
  const gh = [ghostOf(a), ghostOf(b)];
  const S = nucBegin([a, b]);
  kill(a); kill(b);
  W.count.fusion++;
  let ps;
  if (prods.length === 1) {
    ps = [placeProduct(prods[0][0], prods[0][1], Math.min(ne, prods[0][0]), x, y)];
    const Mp = ps[0].m;
    setVel(ps[0], Vx * M / Mp, Vy * M / Mp); // (momentum kept)
    for (let i = ps[0].ne; i < ne; i++) { const e = addLepton(ELEC, x, y); setMotion(e, 1, Math.cos(i), Math.sin(i), Vx, Vy); }
    let pos = null;
    if (weak) { const th = rnd() * 2 * Math.PI; pos = addLepton(POS, x, y); setMotion(pos, (Q * 1e6 + Ecm) * 0.6, Math.cos(th), Math.sin(th), Vx, Vy); }
    const Qm = nucMassLoss(S);
    W.ledger.nuc += Qm;
    // the γ ray (or for p + p, the neutrino) carries what is left: the energy released plus the collision energy
    let left = nucLeft(S, Qm);
    if (left < 0 && pos) { setMotion(pos, Math.max(1, keOf(pos) + left), pos.rad ? pos.ux : 1, pos.rad ? pos.uy : 0, Vx, Vy); left = nucLeft(S, Qm); }
    if (weak) emitNeutrino(x, y, Math.max(0, left));
    else if (gammaE > 0) emitPhoton(x, y, Math.max(0, left));
  } else {
    ps = launchProducts(prods, Q * 1e6 + Ecm, Vx, Vy, x, y, ne, M);
    const Qm = nucMassLoss(S);
    W.ledger.nuc += Qm;
    settleKE(S, Qm, ps);
  }
  flash(x, y, [255, 240, 200], 5, 0.6);
  const out = prods.map(([z, n]) => nucSym(z, n)).join(' + ') + (weak ? ' + e⁺ + ν' : gammaE ? ' + γ' : '');
  log('nuc', `Fusion: ${lbl} → ${out}  (+${fmtE(Q * 1e6)})`);
  nucEvent('fusion', x, y, `Fusion: ${lbl} → ${out}`, gh, `${fmtE(Q * 1e6)} released`);
  noteMade(prods.map(([z, n]) => ({ Z: z, N: n, anti: !!a.anti })), [], `Fusion: ${lbl} → ${out}`);
  return true;
}

/* Neutron meets a nucleus: capture, fission, (n,p)/(n,α)/(n,t) or elastic scattering. */
function neutronHit(n, T, b, R) {
  if (n.dead || T.dead || T.Z < 1) return false;
  if (opp(T, n)) { nuclearAnnihilation(T, n); return true; }
  if (n.rad) return !!nuclearEncounter(n, T, R > 0 ? clamp((b || 0) / R, 0, 1) : rnd(), T.x, T.y); // fast: spallation, fission, … or diffraction
  const [tvx, tvy] = velOf(T);
  const dvx = n.vx - tvx, dvy = n.vy - tvy;
  const En = 0.5 * PHYS.MN * (dvx * dvx + dvy * dvy); // neutron energy relative to the target
  const key = T.Z + '_' + T.N;
  const X = NEUTRON_X[key];
  const f = clamp((Math.log10(Math.max(En, 1e-3)) - Math.log10(0.5)) / (5 - Math.log10(0.5)), 0, 1);
  const lerp = (arr) => arr ? arr[0] + (arr[1] - arr[0]) * f : 0;
  let pf = 0, pc = 0, pnp = 0, pna = 0, pnt = 0;
  if (X) {
    pf = X.fis ? (X.fisThr && En < X.fisThr ? 0 : lerp(X.fis)) : 0;
    pc = lerp(X.cap); pnp = lerp(X.np); pna = lerp(X.na); pnt = lerp(X.nt);
  } else {
    const prod = nuclideInfo(T.Z, T.N + 1);
    pc = prod.unbound ? 0 : 0.08 + (0.004 - 0.08) * f;
  }
  const u = rnd();
  const M = T.m + n.m, Vx = (T.m * tvx + n.m * n.vx) / M, Vy = (T.m * tvy + n.m * n.vy) / M;
  const x = T.x, y = T.y;
  if (u < pf) { fission(T, n, En); return true; }
  if (u < pf + pc) {
    const Sn = dB([[T.Z, T.N + 1]], [[T.Z, T.N]]);
    const lbl = nucSym(T.Z, T.N), gh = [ghostOf(n), ghostOf(T)];
    const S = nucBegin([n, T]);
    kill(n);
    T.N++; refresh(T);
    if (T.rad) { T.rad = false; T.fast = false; }
    T.vx = Vx * M / T.m; T.vy = Vy * M / T.m; // the pair's momentum
    // the γ ray carries the binding energy and the collision energy, less what the nucleus takes as it recoils
    const E0 = Math.max(0, Sn) * 1e6 + En, pr = (E0 - E0 * E0 / (2 * T.m * PHYS.AMU_MEV * 1e6)) / 1e6 * PHYS.MEV_C_TO_SIM, th = rnd() * 2 * Math.PI;
    T.vx -= pr / T.m * Math.cos(th); T.vy -= pr / T.m * Math.sin(th);
    if (0.5 * T.m * (pr / T.m) ** 2 > 20) for (const bd of T.bonds.slice()) removeBond(bd);
    updateFast(T);
    const Qm = nucMassLoss(S);
    const Eg = Math.max(0, nucLeft(S, Qm));
    emitPhoton(x, y, Eg, Math.cos(th), Math.sin(th), { src: T });
    W.count.ncap++; W.ledger.nuc += Qm;
    flash(x, y, [200, 220, 255], 3, 0.4);
    log('nuc', `Neutron capture: ${lbl} + n → ${nucSym(T.Z, T.N)} + γ (${fmtE(Eg)})`);
    nucEvent('capture', x, y, `Neutron capture: ${lbl} + n → ${nucSym(T.Z, T.N)} + γ`, gh, `${fmtE(Eg)} γ ray`);
    noteMade([{ Z: T.Z, N: T.N, anti: !!T.anti }], [], `Neutron capture: ${lbl} + n → ${nucSym(T.Z, T.N)} + γ`);
    return true;
  }
  const special = u < pf + pc + pnp ? [[T.Z - 1, T.N + 1], [1, 0]] : u < pf + pc + pnp + pna ? [[T.Z - 2, T.N - 1], [2, 2]] :
    u < pf + pc + pnp + pna + pnt ? [[T.Z - 1, T.N - 1], [1, 2]] : null;
  if (special) {
    const Q = dB(special, [[T.Z, T.N], [0, 1]]);
    if (Q * 1e6 + En <= 0) return false; // (below its threshold: nothing happens)
    const lbl = nucSym(T.Z, T.N), ne = T.ne, gh = [ghostOf(n), ghostOf(T)];
    const S = nucBegin([n, T]);
    kill(n); kill(T);
    W.count.ncap++;
    const ps = launchProducts(special, Math.max(0, Q * 1e6 + En), Vx, Vy, x, y, ne, M);
    const Qm = nucMassLoss(S);
    W.ledger.nuc += Qm;
    settleKE(S, Qm, ps);
    flash(x, y, [255, 230, 180], 4, 0.5);
    log('nuc', `Nuclear reaction: ${lbl} + n → ${special.map(([z, nn]) => nucSym(z, nn)).join(' + ')} (+${fmtE(Q * 1e6)})`);
    nucEvent('reaction', x, y, `${lbl} + n → ${special.map(([z, nn]) => nucSym(z, nn)).join(' + ')}`, gh, `${fmtE(Q * 1e6)} released`);
    noteMade(special.map(([z, nn]) => ({ Z: z, N: nn, anti: !!T.anti })), [], `${lbl} + n → ${special.map(([z, nn]) => nucSym(z, nn)).join(' + ')}`);
    return true;
  }
  // elastic scattering (isotropic in the centre-of-mass frame)
  const rvx = n.vx - tvx, rvy = n.vy - tvy, vr = Math.hypot(rvx, rvy);
  const th = rnd() * 2 * Math.PI, nx = vr * Math.cos(th), ny = vr * Math.sin(th);
  setVel(n, Vx + nx * T.m / M, Vy + ny * T.m / M);
  setVel(T, Vx - nx * n.m / M, Vy - ny * n.m / M);
  if (0.5 * PHYS.MN * (n.vx * n.vx + n.vy * n.vy) < 1 && n.trk) n.trk = null;
  return true;
}

function fission(T, n, En) {
  const Zc = T.Z, Nc = T.N + (n ? 1 : 0), Ac = Zc + Nc;
  const lbl = nucSym(T.Z, T.N) + (n ? ' + n' : '');
  const [tvx, tvy] = velOf(T);
  const x = T.x, y = T.y, ne = T.ne, gh = [ghostOf(T)];
  const S = nucBegin(n ? [T, n] : [T]);
  if (n) { gh.push(ghostOf(n)); kill(n); }
  kill(T);
  const u = rnd(); const nu = u < 0.08 ? 1 : u < 0.42 ? 2 : u < 0.82 ? 3 : 4;
  const scale = Ac / 236;
  let AL = Math.round(FISSION.light * scale + gauss() * FISSION.sigma);
  let AH = Ac - nu - AL;
  if (AL < 70) { AL = 70; AH = Ac - nu - AL; }
  const ZL = Math.round(Zc * AL / (Ac - nu)), ZH = Zc - ZL;
  const NL = AL - ZL, NH = AH - ZH;
  // energy released: the fragments' binding less the target's (the neutron brings in its own binding energy as the
  // compound nucleus's excitation), plus the neutron's motion
  const Q = bindingE(ZL, NL) + bindingE(ZH, NH) - bindingE(T.Z, T.N) + (En || 0) / 1e6;
  const TKE = Math.max(60, Q - nu * 2.0 - 7);
  W.count.fission++;
  const neL = Math.round(ne * ZL / Zc);
  const anti = T.anti;
  const fL = addNuc(ZL, NL, neL, x, y, 0, 0, anti), fH = addNuc(ZH, NH, ne - neL, x, y, 0, 0, anti);
  const mu = fL.m * fH.m / (fL.m + fH.m), pr = Math.sqrt(2 * mu * TKE * 1e6);
  const th = rnd() * 2 * Math.PI, ux = Math.cos(th), uy = Math.sin(th);
  fL.x += 0.3 * ux; fL.y += 0.3 * uy; fH.x -= 0.3 * ux; fH.y -= 0.3 * uy;
  setVel(fL, tvx + pr / fL.m * ux, tvy + pr / fL.m * uy);
  setVel(fH, tvx - pr / fH.m * ux, tvy - pr / fH.m * uy);
  const prods = [fL, fH];
  for (let i = 0; i < nu; i++) {
    if (W.parts.length >= MAX_PARTS) break;
    const nn = addNuc(0, 1, 0, x, y, 0, 0, anti);
    const E = -1.33e6 * Math.log(Math.max(1e-6, rnd() * rnd())) / 2 + 0.2e6;
    const a = rnd() * 2 * Math.PI;
    setMotion(nn, E, Math.cos(a), Math.sin(a), tvx, tvy);
    prods.push(nn);
  }
  // the books: the energy released is the mass lost; what the fragments and neutrons did not take leaves as
  // prompt γ rays (about 7 MeV in all, from the fragments' excitation)
  const Qm = nucMassLoss(S);
  W.ledger.nuc += Qm;
  let left = nucLeft(S, Qm);
  if (left < 1e6) left = settleKE(S, Qm - 1e6, prods) + 1e6; // keep at least 1 MeV for the γ rays
  for (let i = 0; i < 3; i++) emitPhoton(x, y, left / 3);
  flash(x, y, [255, 210, 150], 8, 0.8);
  log('nuc', `Fission: ${lbl} → ${nucSym(ZL, NL)} + ${nucSym(ZH, NH)} + ${nu}n  (+${fmtE(Q * 1e6)})`);
  nucEvent('fission', x, y, `${n ? 'Fission' : 'Spontaneous fission'}: ${lbl} → ${nucSym(ZL, NL)} + ${nucSym(ZH, NH)} + ${nu}n`, gh, `${fmtE(Q * 1e6)} released${n ? '' : boostTag()}`);
  noteMade([{ Z: ZL, N: NL, anti }, { Z: ZH, N: NH, anti }].concat(Array.from({ length: nu }, () => ({ Z: 0, N: 1, anti }))), [], `${n ? 'Fission' : 'Spontaneous fission'}: ${lbl} → ${nucSym(ZL, NL)} + ${nucSym(ZH, NH)} + ${nu}n`);
}

/* ------------------------------------------------------------------ radioactive decay */
function betaSpectrum(Q) { // kinetic energy of the electron (MeV), allowed shape without Coulomb correction
  const m = PHYS.MEC2;
  const pdf = (T) => { const E = T + m, p = Math.sqrt(T * T + 2 * T * m); return p * E * (Q - T) * (Q - T); };
  let mx = 0; for (let i = 1; i < 20; i++) mx = Math.max(mx, pdf(Q * i / 20));
  for (let k = 0; k < 200; k++) { const T = rnd() * Q; if (rnd() * mx <= pdf(T)) return T; }
  return Q / 3;
}
function decayStep(dtNuc) {
  if (dtNuc <= 0) return;
  const parts = W.parts;
  const n0 = parts.length;
  for (let i = 0; i < n0; i++) {
    const p = parts[i];
    if (p.dead || p.k !== NUC) continue;
    let inf = p.nuc;
    if (!inf || inf.stable) continue;
    let tl = dtNuc, guard = 0;
    while (inf && !inf.stable && guard++ < 40 && !p.dead) {
      const lam = LN2 / inf.t12;
      const P = 1 - Math.exp(-lam * tl);
      if (!(rnd() < P)) break;
      const used = -Math.log(1 - rnd() * P) / lam;
      tl = Math.max(0, tl - used);
      if (!doDecay(p)) break;
      inf = p.dead ? null : p.nuc;
    }
  }
}
function pickMode(inf) {
  if (inf.modes.length === 1) return inf.modes[0];
  let u = rnd();
  for (const m of inf.modes) { u -= m.br; if (u <= 0) return m; }
  return inf.modes[inf.modes.length - 1];
}
function doDecay(p) {
  const inf = p.nuc;
  let md = pickMode(inf);
  // antinuclei decay as the mirror image: n̄ → p̄ + e⁺ + ν, antiparticles emitted, positrons captured
  const sym = (z, n) => z > 0 ? nucSymA(z, n, p.anti) : nucSym(z, n);
  const lbl = sym(p.Z, p.N);
  const x = p.x, y = p.y;
  let mode = md.mode, Q = md.Q;
  if (mode === 'ec' && p.ne === 0) {
    // fully ionized atoms cannot capture an electron (e.g. bare ⁷Be is stable)
    if (Q > 1.022) { mode = 'b+'; Q -= 1.022; } else return false;
  }
  W.count.decay++;
  if (mode === 'sf') { fission(p, null, 0); flash(x, y, [255, 220, 160], 2.5, 0.35); return true; }
  // The books. The table's Q-values are for neutral atoms (atomic masses): the nucleus itself releases that plus
  // the change in its electrons' total binding between parent and daughter atom. Whatever the decay costs here
  // (the electrons it kept, now around a different nucleus; broken bonds; its new charge among its neighbours;
  // electrons shaken off) comes out of what the emitted particles take, so energy is conserved exactly. For a
  // neutral atom that leaves them almost exactly the tabulated Q, as measured.
  const dZ = { 'b-': 1, 'b+': -1, ec: -1, a: -2, p: -1, '2p': -2, n: 0, '2n': 0 }[mode];
  const Zem = mode === 'a' ? 2 : mode === 'p' || mode === '2p' ? 1 : 0, nem = mode[0] === '2' ? 2 : 1;
  const Qn = Math.max(0, Q) * 1e6 + electronBindingE(p.Z, p.Z) - electronBindingE(p.Z + dZ, p.Z + dZ) - nem * electronBindingE(Zem, Zem);
  W.ledger.nuc += Qn;
  const S = nucBegin([p]);
  const Zold = p.Z, Nold = p.N, gh = [ghostOf(p)];
  const th = rnd() * 2 * Math.PI, ux = Math.cos(th), uy = Math.sin(th);
  const [pvx, pvy] = velOf(p);
  const radK = p.rad && p.KE > 1e6 ? p.KE : 0, rux = p.ux, ruy = p.uy, m0 = p.m; // (a nucleus decaying in flight at a relativistic speed keeps it)
  const brk = () => { for (const bd of p.bonds.slice()) removeBond(bd); };
  const Qtxt = fmtE(Math.max(0, Q) * 1e6); // the decay's Q-value as tabulated (what a neutral atom's emissions share)
  switch (mode) {
    case 'b-': case 'b+': {
      const T = betaSpectrum(Q), Enu = Q - T;
      p.Z += mode === 'b-' ? 1 : -1; p.N += mode === 'b-' ? -1 : 1;
      if (p.Z === 0) { // proton → neutron can't happen here; guard
        p.Z = 1; p.N = 0;
      }
      brk(); refresh(p);
      if (p.rad) { p.rad = false; p.fast = false; } // (still recoiling from an earlier decay)
      if (mode === 'b+') shakeOff(p); // β⁺ leaves one electron too many
      const pe = Math.sqrt(T * T + 2 * T * PHYS.MEC2);
      const th2 = rnd() * 2 * Math.PI, nx = Math.cos(th2), ny = Math.sin(th2);
      const prx = -(pe * ux + Enu * nx) * PHYS.MEV_C_TO_SIM, pry = -(pe * uy + Enu * ny) * PHYS.MEV_C_TO_SIM;
      setVel(p, pvx + prx / p.m, pvy + pry / p.m);
      if (radK) setMotion(p, radK * p.m / m0, rux, ruy);
      const elec = (mode === 'b-') !== !!p.anti; // which charged lepton leaves
      let l = null;
      if (W.parts.length < MAX_PARTS) {
        l = addLepton(elec ? ELEC : POS, x + ux * 0.2, y + uy * 0.2);
        setMotion(l, Math.max(1, T * 1e6), ux, uy, pvx, pvy);
      }
      // the (anti)neutrino carries the rest; an electron drawn right at the end point gives back what it overdrew
      let left = nucLeft(S, Qn);
      if (left < 0 && l) { setMotion(l, Math.max(1, keOf(l) + left), ux, uy, pvx, pvy); left = nucLeft(S, Qn); }
      emitNeutrino(x, y, Math.max(0, left));
      const prod = elec ? 'e⁻ + ν̄' : 'e⁺ + ν', nm = elec ? 'β⁻' : 'β⁺';
      log('nuc', `${nm} decay: ${lbl} → ${sym(p.Z, p.N)} + ${prod} (${Qtxt})`);
      nucEvent(elec ? 'beta' : 'betap', x, y, `${nm} decay: ${lbl} → ${sym(p.Z, p.N)} + ${prod}`, gh, `${Qtxt} released${boostTag()}`,
        { mode, Z0: Zold, N0: Nold, Z1: p.Z, N1: p.N, anti: !!p.anti, th });
      break;
    }
    case 'ec': {
      p.Z--; p.N++; p.ne--; brk(); refresh(p);
      // the neutrino takes the energy less the binding of the captured inner electron, which the atom gives off
      // as it refills the hole (shown as one Kα X-ray)
      const left = Math.max(0, nucLeft(S, Qn)), kx = Math.min(left, 0.75 * PHYS.RY * Math.pow(Math.max(1, p.Z - 1), 2));
      emitNeutrino(x, y, left - kx);
      emitPhoton(x, y, kx, undefined, undefined, { src: p });
      log('nuc', `${p.anti ? 'Positron' : 'Electron'} capture: ${lbl} + ${p.anti ? 'e⁺' : 'e⁻'} → ${sym(p.Z, p.N)} + ν (${Qtxt})`);
      nucEvent('ec', x, y, `${p.anti ? 'Positron' : 'Electron'} capture: ${lbl} + ${p.anti ? 'e⁺' : 'e⁻'} → ${sym(p.Z, p.N)} + ν`, gh, `${Qtxt} released${boostTag()}`,
        { mode, Z0: Zold, N0: Nold, Z1: p.Z, N1: p.N, anti: !!p.anti, th });
      break;
    }
    case 'a': case 'p': case 'n': case '2p': case '2n': {
      const em = mode === 'a' ? [2, 2] : mode === 'p' ? [1, 0] : mode === 'n' ? [0, 1] : mode === '2p' ? [1, 0] : [0, 1];
      const cnt = (mode === '2p' || mode === '2n') ? 2 : 1;
      p.Z -= em[0] * cnt; p.N -= em[1] * cnt;
      if (p.Z + p.N <= 0) { kill(p); return false; }
      if (p.Z !== Zold) brk();
      refresh(p);
      if (p.rad) { p.rad = false; p.fast = false; } // (still recoiling from an earlier decay)
      shakeOff(p); // α decay leaves the daughter two electrons too many
      const Ad = p.Z + p.N, Ae = em[0] + em[1];
      const Eem = Math.max(1e-3, Q * 1e6) * Ad / (Ad + Ae * cnt);
      const prod = [];
      for (let k = 0; k < cnt; k++) {
        if (W.parts.length >= MAX_PARTS) break;
        const a = addNuc(em[0], em[1], 0, x + ux * 0.2, y + uy * 0.2, 0, 0, p.anti);
        const ang = th + (k ? 2.2 : 0);
        setMotion(a, Eem / cnt, Math.cos(ang), Math.sin(ang), pvx, pvy);
        prod.push(a);
      }
      const prR = Math.sqrt(2 * Ae * PHYS.MP * Eem);
      setVel(p, pvx - prR / p.m * ux, pvy - prR / p.m * uy);
      if (radK) setMotion(p, radK * p.m / m0, rux, ruy);
      settleKE(S, Qn, [p].concat(prod)); // the emitted particle and the recoiling daughter share what is left
      if (p.Z === 0 && p.N > 1) { /* neutron cluster: let the next sweep split it */ }
      const nm = mode === 'a' ? 'α decay' : mode === 'n' || mode === '2n' ? 'Neutron emission' : 'Proton emission';
      const em2 = (mode === 'a' ? 'α' : mode === 'p' ? 'p' : mode === 'n' ? 'n' : mode === '2p' ? '2p' : '2n') + (p.anti ? '\u0304' : '');
      log('nuc', `${nm}: ${lbl} → ${sym(p.Z, p.N)} + ${em2} (${Qtxt})`);
      nucEvent(mode === 'a' ? 'alpha' : 'decay', x, y, `${nm}: ${lbl} → ${sym(p.Z, p.N)} + ${em2}`, gh, `${Qtxt} released${boostTag()}`,
        { mode, Z0: Zold, N0: Nold, Z1: p.Z, N1: p.N, anti: !!p.anti, th });
      break;
    }
  }
  flash(x, y, [255, 220, 160], 2.5, 0.35);
  return true;
}

/* ------------------------------------------------------------------ ballistic motion */
const _hits = [];
/* Find targets near the segment a→b (start positions). Returns sorted [t, p, b] with t∈[0,1]. */
function segTargets(x0, y0, x1, y1, R, filter) {
  _hits.length = 0;
  const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
  if (!(L2 > 0)) return _hits;
  if (G.n <= 32) { // few particles in MD (a hot plasma): check them directly
    for (const p of G.list) {
      if (p.dead || !filter(p)) continue;
      const px = p.x - x0, py = p.y - y0, t = (px * dx + py * dy) / L2;
      if (t < 0 || t >= 1) continue;
      const ex = px - t * dx, ey = py - t * dy, b2 = ex * ex + ey * ey;
      if (b2 < R * R) _hits.push([t, p, Math.sqrt(b2)]);
    }
    if (_hits.length > 1) _hits.sort((a, b) => a[0] - b[0]);
    return _hits;
  }
  const minx = Math.min(x0, x1) - R, maxx = Math.max(x0, x1) + R, miny = Math.min(y0, y1) - R, maxy = Math.max(y0, y1) + R;
  const cx0 = clamp(Math.floor((minx + G.hx) / G.cw), 0, G.cols - 1), cx1 = clamp(Math.floor((maxx + G.hx) / G.cw), 0, G.cols - 1);
  const cy0 = clamp(Math.floor((miny + G.hy) / G.ch), 0, G.rows - 1), cy1 = clamp(Math.floor((maxy + G.hy) / G.ch), 0, G.rows - 1);
  const L = G.list;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    for (let i = G.head[cy * G.cols + cx]; i !== -1; i = G.next[i]) {
      const p = L[i];
      if (p.dead || !filter(p)) continue;
      const px = p.x - x0, py = p.y - y0;
      const t = (px * dx + py * dy) / L2;
      if (t < 0 || t >= 1) continue; // passed in the previous step, or not yet reached
      const ex = px - t * dx, ey = py - t * dy, b2 = ex * ex + ey * ey;
      if (b2 < R * R) _hits.push([t, p, Math.sqrt(b2)]);
    }
  }
  _hits.sort((a, b) => a[0] - b[0]);
  return _hits;
}
/* Antimatter reaching a wall meets the wall's ordinary matter: an electron for each positron, a nucleon for
   each antinucleon. The wall supplies an equal mass, so the radiation carries twice the rest energy plus
   the particle's motion and binding. */
function annihilateAtWall(p) {
  const hw = W.box.w / 2, hh = W.box.h / 2;
  const x = clamp(p.x, -hw, hw), y = clamp(p.y, -hh, hh);
  const lbl = speciesLabel(p), gh = [ghostOf(p)];
  const S = annihBegin([p]);
  const partners = p.bonds.map(bd => other(bd, p));
  const nLep = p.k === POS ? 1 : p.k === NUC ? p.ne : 0, nNuc = p.k === NUC ? p.Z + p.N : 0;
  kill(p); relink(partners.filter(q => !q.dead));
  const wallM = restE(p);
  W.ledger.nuc += wallM;
  const E = annihEnd(S) + wallM;
  W.count.annih++;
  if (nNuc > 0) {
    for (let i = 0; i < nLep; i++) twoGamma(x, y, 2 * ME_C2);
    const Ep = (E - nLep * 2 * ME_C2) / nNuc, nP = p.k === NUC ? p.Z : 0; // (each antinucleon meets a proton or a neutron of the wall)
    for (let i = 0; i < nNuc; i++) mesonBurst(x, y, Ep, 0, 0, (rnd() < 0.5 ? 1 : 0) - (i < nP ? 1 : 0));
    nucEvent('annih', x, y, `${lbl} hits the wall → mesons + γ`, gh, fmtE(E));
    log('nuc', `Annihilation at the wall: ${lbl} meets ordinary matter → mesons + γ rays (${fmtE(E)})`);
  } else {
    twoGamma(x, y, E);
    nucEvent('annih', x, y, 'e⁺ hits the wall → 2γ', gh, '511 keV each');
    log('nuc', 'Annihilation at the wall: e⁺ + e⁻ (wall) → 2γ (511 keV each)');
  }
}
function wallOrEscape(p, escape) {
  const hw = W.box.w / 2, hh = W.box.h / 2;
  if (p.x >= -hw && p.x <= hw && p.y >= -hh && p.y <= hh) return false;
  if ((p.k === POS || p.anti) && W.wall === 'reflect') { annihilateAtWall(p); return true; } // walls are ordinary matter
  if (escape && W.wall === 'reflect' && p.k === NUC && p.ne > 0 && p.Z >= 3) {
    // A recoiling atom (decay daughter, fission fragment, knock-on) is stopped by the wall within nanometres
    // and comes back off it at the wall's temperature; its kinetic energy goes into the wall. Light
    // radiation (α, protons, neutrons, electrons) passes on out of the box.
    const K0 = p.rad ? p.KE : 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy);
    p.x = clamp(p.x, -hw + 0.6, hw - 0.6); p.y = clamp(p.y, -hh + 0.6, hh - 0.6);
    p.rad = false; p.fast = false;
    const [vx, vy] = thermalV(p.m, W.T);
    p.vx = p.x >= hw - 0.61 ? -Math.abs(vx) : p.x <= -hw + 0.61 ? Math.abs(vx) : vx;
    p.vy = p.y >= hh - 0.61 ? -Math.abs(vy) : p.y <= -hh + 0.61 ? Math.abs(vy) : vy;
    const U = G.n ? localPE(new Set([p])) : 0;
    W.ledger.escaped += K0 - 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy) - U;
    W.spawned++; _late.push(p); // forces must be recomputed for it
    if (p.trk) { extendTrack(p); p.trk = null; }
    updateFast(p);
    return false;
  }
  if (escape || W.wall === 'open') {
    if (p.k === NUC && p.Z === 0) W.ledger.escaped += keOf(p);
    else if (p.rad) W.ledger.escaped += p.KE;
    kill(p); return true;
  }
  if (W.wall === 'wrap') {
    if (p.x < -hw) p.x += W.box.w; else if (p.x > hw) p.x -= W.box.w;
    if (p.y < -hh) p.y += W.box.h; else if (p.y > hh) p.y -= W.box.h;
    return false;
  }
  if (p.x < -hw) { p.x = -hw + (-hw - p.x) % W.box.w; p.vx = Math.abs(p.vx); p.ux = Math.abs(p.ux); }
  if (p.x > hw) { p.x = hw - (p.x - hw) % W.box.w; p.vx = -Math.abs(p.vx); p.ux = -Math.abs(p.ux); }
  if (p.y < -hh) { p.y = -hh + (-hh - p.y) % W.box.h; p.vy = Math.abs(p.vy); p.uy = Math.abs(p.uy); }
  if (p.y > hh) { p.y = hh - (p.y - hh) % W.box.h; p.vy = -Math.abs(p.vy); p.uy = -Math.abs(p.uy); }
  return false;
}

/* Elastic nuclear collision of a radiation-mode nucleus p with target t at impact parameter b (Å).
   Universal screening length a = 0.8854·a₀/(Z1^0.23 + Z2^0.23). Returns the energy given to the target. */
function nuclearCollision(p, t, b) {
  const mt = t.m, mp = p.m;
  const Ecm = p.KE * mt / (mp + mt);
  if (Ecm <= 0) return 0;
  const a = 0.4685 / (Math.pow(p.Z, 0.23) + Math.pow(Math.max(1, t.Z), 0.23));
  const d = PHYS.KE * p.Z * Math.max(1, t.Z) / Ecm * Math.exp(-b / a);
  const th = 2 * Math.atan(d / (2 * Math.max(b, 0.005)));
  const Tmax = 4 * mp * mt / ((mp + mt) * (mp + mt)) * p.KE;
  const T = Tmax * Math.pow(Math.sin(th / 2), 2);
  if (T < 0.5) return 0;
  // deflect the projectile (approximate lab angle) and launch the recoil
  const sgn = rnd() < 0.5 ? 1 : -1;
  const lab = Math.atan2(Math.sin(th), Math.cos(th) + mp / mt) * sgn;
  const c = Math.cos(lab), s = Math.sin(lab);
  const ux = p.ux * c - p.uy * s, uy = p.ux * s + p.uy * c; p.ux = ux; p.uy = uy;
  const rec = (Math.PI - th) / 2 * -sgn;
  const rx = p.ux * Math.cos(rec) - p.uy * Math.sin(rec), ry = p.ux * Math.sin(rec) + p.uy * Math.cos(rec);
  if (t.rad) { t.KE += T; radSpeed(t); }
  else {
    for (const bd of t.bonds.slice()) if (T > bd.D) removeBond(bd);
    const [tvx, tvy] = velOf(t);
    setVel(t, tvx + Math.sqrt(2 * T / mt) * rx, tvy + Math.sqrt(2 * T / mt) * ry);
  }
  return T;
}

/* Radiation-mode particles: straight/curved flight with continuous energy loss (Bethe-like stopping). */
/* The magnetic field turns the path over a time h at (x, y) (and electrons radiate as they turn). */
function radB(p, h, x, y, q, mrest) {
  const B = Bfield(x, y, p);
  if (B === 0 || q === 0) return;
  const om = q * B * PHYS.LOR / (p.gam * mrest);
  const a = -om * h, c = Math.cos(a), s = Math.sin(a);
  const ux = p.ux * c - p.uy * s, uy = p.ux * s + p.uy * c; p.ux = ux; p.uy = uy;
  if (p.k !== NUC) synchrotron(p, Math.abs(om), h);
}
/* The electric field over a time h at (x, y): its part across the path turns it, its part along changes the energy.
   Returns the distance travelled, on the mean of the speeds before and after, and the work done is qE over just
   that distance (so a cavity's gain is exactly its voltage). */
function radE(p, h, x, y, q, mrest) {
  const E = Efield(x, y, p), Et = E[1] * p.ux - E[0] * p.uy; // across the path (to its left)
  // along it, leaving out the separators: their plates' fringe fields give back on the way out what they take on the
  // way in, so they only deflect (a hard-edged field region would not)
  const El = (E[0] - _Esep[0]) * p.ux + (E[1] - _Esep[1]) * p.uy;
  const v0 = p.sp;
  if (Et && v0 > 0) { // the momentum turns by qE⊥h / p
    const a = q * Et * h / (p.gam * mrest * v0), c = Math.cos(a), s = Math.sin(a);
    const ux = p.ux * c - p.uy * s, uy = p.ux * s + p.uy * c; p.ux = ux; p.uy = uy;
  }
  if (!El) return v0 * h;
  const K0 = p.KE;
  p.KE = Math.max(1, K0 + q * El * v0 * h); radSpeed(p);
  const d = (v0 + p.sp) / 2 * h;
  p.KE = Math.max(1, K0 + q * El * d); radSpeed(p);
  return d;
}
/* Which of the accelerator's magnets and cavities a point is inside (for this particle), as a number. */
function zoneKey(x, y, p) {
  let k = 0;
  for (let i = 0; i < W.zones.length; i++) {
    const z = W.zones[i];
    if (z.beam && p.beam !== z.beam) continue;
    if (z.kind === 'kicker' && p.injKick !== z) continue;
    if (z.kind === 'sep' && p.injKick) continue;
    if (zoneLocal(z, x, y)) k = (k * 31 + i + 1) % 2147483647;
  }
  return k;
}
function moveRad(p, dt) {
  const q = p.k === NUC ? (p.anti ? -1 : 1) * (Math.max(p.Z - p.ne, 0) || p.Z) : p.q;
  const mrest = p.k === NUC ? p.m : PHYS.ME, hasE = q && hasEfield();
  const x0 = p.x, y0 = p.y;
  // Leapfrog steps: half the magnetic turn, the electric push and the move, the other half (second order, and a
  // uniform field keeps a circle a circle). In an accelerator the step is split exactly where the path crosses the
  // edge of a magnet or cavity: an edge landing anywhere within a step would be a small random kick, and kicks
  // like that grow a beam's oscillations turn after turn.
  let x1 = x0, y1 = y0, rem = dt;
  const zoned = q && W.zones.length > 0;
  for (let guard = 0; rem > 1e-12 && guard < 40; guard++) {
    let h = rem, xb = null, yb = null;
    if (zoned) {
      const L = p.sp * h, k0 = zoneKey(x1, y1, p);
      if (zoneKey(x1 + p.ux * L, y1 + p.uy * L, p) !== k0) { // an edge on the way: find it (along the line of the step)
        let lo = 0, hi = 1;
        for (let it = 0; it < 14; it++) { const m = (lo + hi) / 2; if (zoneKey(x1 + p.ux * L * m, y1 + p.uy * L * m, p) === k0) lo = m; else hi = m; }
        h = rem * Math.min(1, hi * (1 + 1e-6) + 1e-9); xb = x1 + p.ux * L * lo * 0.5; yb = y1 + p.uy * L * lo * 0.5; // (the field on this side of the edge)
      }
    }
    radB(p, h / 2, x1, y1, q, mrest);
    const dd = hasE ? radE(p, h, xb === null ? x1 + p.ux * p.sp * h / 2 : xb, yb === null ? y1 + p.uy * p.sp * h / 2 : yb, q, mrest) : p.sp * h;
    const xe = x1 + p.ux * dd, ye = y1 + p.uy * dd;
    radB(p, h / 2, xb === null ? xe : xb, yb === null ? ye : yb, q, mrest);
    x1 = xe; y1 = ye; rem -= h;
  }
  // energy deposition along the path
  const z = p.k === NUC ? p.Z : 1;
  const beta2 = (p.sp / PHYS.C) ** 2 || 1e-6;
  const zeff = p.k === NUC ? z * (1 - Math.exp(-125 * Math.sqrt(beta2) / Math.pow(z, 2 / 3))) : 1;
  const hits = segTargets(x0, y0, x1, y1, Math.max(1.0, nucDrawR(p) + 0.9), (t) => t.k === NUC && t.Z > 0 && t !== p);
  let stopped = false, stillNear = false;
  for (const [t, tg, b] of hits) {
    if (tg.dead || sameEv(p, tg)) continue;
    const again = p.hit === tg.id; // (just met it: one pass, one encounter)
    if (again && b < nucDrawR(tg) + nucDrawR(p) + 0.4) { stillNear = true; continue; }
    // A nucleus is hit where it is drawn: inside the reach, nuclei meet (reactions above the Coulomb barrier, tunnelling
    // below it); a lepton crossing a nucleus is turned by its full charge (Mott scattering), the pass mapped onto
    // nuclear distances as in a collider. (An antinucleus in flight almost never annihilates: σ ≈ 0.1 b at MeV
    // energies; it slows down first.)
    if (p.k === NUC && !opp(p, tg)) {
      const R = nucReach(p, tg);
      if (b < R) {
        const ux0 = p.ux, uy0 = p.uy;
        nuclearEncounter(p, tg, b / R, tg.x, tg.y);
        if (p.dead || (b < R_FUS && !tg.dead && tryFusion(p, tg))) { stopped = true; break; }
        if (tg.dead) continue;
        if (p.ux !== ux0 || p.uy !== uy0) { p.hit = tg.id; stillNear = true; x1 = x0 + (x1 - x0) * t; y1 = y0 + (y1 - y0) * t; break; } // (turned: on from here, next step)
      }
    } else if (p.k !== NUC && b < nucDrawR(tg) + 0.02 && nucDrawR(tg) > 0.04) {
      const cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
      nuclearScatter(p, tg, b, tg.x - cx, tg.y - cy, nucDrawR(tg) + 0.02, 1.2 * Math.cbrt(tg.Z + tg.N)); // (crossing the nucleus itself: inside its radius)
      p.hit = tg.id; stillNear = true;
      x1 = cx; y1 = cy; // (on from here in its new direction, next step)
      break;
    }
    if (p.k === NUC && b < 0.5) { // nuclear stopping: screened-Coulomb (ZBL-like) elastic collision
      const T = nuclearCollision(p, tg, b);
      if (T > 0) { p.KE -= T; if (p.KE <= 1) break; }
    }
    if (tg.ne <= 0) continue;
    const w = 1 / (1 + (b / 0.4) * (b / 0.4));
    let dE = Math.min(0.3 * p.KE, 0.0047 * zeff * zeff * tg.ne / beta2 * w);
    if (dE < 0.01) continue;
    p.KE -= dE;
    const ie = ionizationCost(tg);
    const nx = -p.uy * (rnd() < 0.5 ? 1 : -1), ny = p.ux * (nx === -p.uy ? 1 : -1);
    if (dE > ie && freeElectronCount() < MAX_FREE_E && W.parts.length < MAX_PARTS) {
      if (ejectElectron(tg, dE - ie, nx, ny)) W.count.ionize++; else dumpHeat(dE, tg, tg);
    } else {
      const dv = Math.sqrt(2 * dE * tg.im);
      tg.vx += nx * dv * 0.7; tg.vy += ny * dv * 0.7; updateFast(tg);
    }
    if (p.KE <= 0) break;
  }
  if (!stillNear && p.hit) p.hit = 0;
  if (!p.dead && !stopped && p.k === NUC && _fastNuc.length) stopped = radVsFast(p, x0, y0, x1, y1);
  if (p.dead || stopped) return;
  p.x = x1; p.y = y1;
  radSpeed(p);
  p.vx = p.sp * p.ux; p.vy = p.sp * p.uy;
  extendTrack(p);
  if (wallOrEscape(p, true)) return;
  if (p.caught && detectorStop(p)) return;
  // slowed down: hand back to normal dynamics
  const thr = radThreshold(p.k !== NUC) * 0.5;
  if (p.KE < thr) {
    p.rad = false;
    const v = Math.sqrt(2 * p.KE * p.im);
    p.vx = v * p.ux; p.vy = v * p.uy; p.fast = true; updateFast(p);
  }
}

/* A fast nucleus crosses a hot plasma's ballistic ions (they move too, so the closest approach of the two paths over
   the step): it may react or tunnel with them, or scatter off their charge. Returns true if it is gone. */
function radVsFast(p, x0, y0, x1, y1) {
  for (const tg of _fastNuc) {
    if (tg.dead || tg === p || tg.Z < 1 || opp(p, tg) || sameEv(p, tg)) continue;
    const rx = tg.ox - x0, ry = tg.oy - y0, dx = (x1 - x0) - (tg.x - tg.ox), dy = (y1 - y0) - (tg.y - tg.oy), L2 = dx * dx + dy * dy;
    if (Math.abs(rx) > Math.abs(dx) + 3 || Math.abs(ry) > Math.abs(dy) + 3) continue;
    const s = clamp(L2 > 0 ? (rx * dx + ry * dy) / L2 : 0, 0, 1), d = Math.hypot(rx - s * dx, ry - s * dy), R = nucReach(p, tg);
    if (d >= Math.max(R, 0.6) || p.hit === tg.id || s <= 0) continue; // (s = 0: they were closest before this step, and met then)
    if (d < R) {
      nuclearEncounter(p, tg, d / R, tg.x, tg.y);
      if (p.dead || (d < R_FUS && !tg.dead && tryFusion(p, tg))) return true;
      if (tg.dead) continue;
    }
    if (d < 0.6) coulombScatter(p, tg, Math.max(d, 0.01));
  }
  return false;
}
/* Synchrotron radiation: a charge bent on a circle radiates P = (2/3)·k q² c γ⁴β⁴ / R² (Larmor's formula with
   relativity), beamed forward along its path; at these tiny radii (nanometres) an electron of a few MeV loses
   keV every turn, so a small ring cannot hold electrons at high energy. Emitted as photons once a little has
   built up (protons radiate 10¹³ times less: left out). om: the turning rate (rad/tu). */
function synchrotron(p, om, dt) {
  const b = p.sp / PHYS.C, R = p.sp / om;
  if (!(R > 0) || b < 0.05) return;
  const P = (2 / 3) * PHYS.KE * PHYS.C * Math.pow(p.gam * b, 4) / (R * R); // eV/tu (q = ±1)
  p.srad = (p.srad || 0) + P * dt;
  if (p.srad < Math.max(5, 2e-3 * p.KE)) return;
  const E = Math.min(p.srad, 0.5 * p.KE);
  p.srad = 0; p.KE -= E; radSpeed(p);
  emitPhoton(p.x, p.y, E, p.ux, p.uy, { noInteract: E < 20 });
}
/* Beam meets beam: flying (radiation-mode) particles whose paths pass within reach during this step collide.
   Matter and antimatter annihilate (e⁺e⁻ → γγ, a proton and an antiproton into pions); nuclei can fuse
   (tunnelling, as everywhere here) or scatter off each other's charge. In a collider only particles of the two
   beams meet (never two of one bunch), only in the detector, and in a ring only once the beams are brought into
   collision at full energy. */
function beamCollisions(id0) {
  const fl = [];
  for (const p of W.parts) if (!p.dead && p.rad && p.id < id0) fl.push(p);
  if (fl.length < 2) return;
  const C = W.collider;
  // (with many fast products about, only pairs with a beam particle in them are looked at: the products fly apart)
  const crowded = fl.length > 300, firsts = crowded ? fl.filter(p => p.beam) : fl;
  for (let i = 0; i < firsts.length; i++) {
    const a = firsts[i];
    if (a.dead) continue;
    for (let j = crowded ? 0 : i + 1; j < fl.length; j++) {
      const b = fl[j];
      if (b.dead || a.dead || b === a || (crowded && b.beam && b.id < a.id) || sameEv(a, b) || a.caught || b.caught) continue;
      const beams = C && a.beam && b.beam;
      if (beams && a.beam === b.beam) continue; // one bunch flies together (and its own space charge is left out)
      const rx = b.ox - a.ox, ry = b.oy - a.oy;
      if (Math.abs(rx) > 60 || Math.abs(ry) > 60) continue;
      const dx = (b.x - b.ox) - (a.x - a.ox), dy = (b.y - b.oy) - (a.y - a.oy), L2 = dx * dx + dy * dy;
      let t = L2 > 0 ? -(rx * dx + ry * dy) / L2 : 0; t = clamp(t, 0, 1);
      const ex = rx + t * dx, ey = ry + t * dy, d = Math.hypot(ex, ey);
      const x = a.ox + (a.x - a.ox) * t + ex / 2, y = a.oy + (a.y - a.oy) * t + ey / 2;
      const live = beams && (C.kind !== 'ring' || C.colliding) && inDetector(C, x, y); // (beams meet only in a detector, as in a real machine)
      // beam–beam forces once the beams are brought together (while they are sped up a real machine keeps them far
      // enough apart that the pull is slight; here the separation is only a few ångström)
      if (live && d < R_BB && t > 0 && t < 1 && d > 0.05) beamBeam(C, a, b, ex, ey, d);
      const both = a.k === NUC && b.k === NUC, Rn = both ? nucReach(a, b) : 0;
      if (d > Math.max(beams ? R_BEAM : 0.6, Rn) || t <= 0) continue; // (t = 0: closest before this step, when they met)
      if (beams) { if (live) beamHit(C, a, b, d, x, y, ex, ey); continue; } // (while a ring speeds them up, its separated orbits keep the beams apart: a real machine holds them many beam widths apart, more than fits here)
      if (opp(a, b) || (a.k !== NUC && b.k !== NUC && a.k !== b.k)) {
        if (a.k !== NUC && b.k !== NUC) { if (d < R_NN) eeEvent(a, b, x, y); }
        else if (both && d < R_NN) { if (a.Z + a.N === 1 && b.Z + b.N === 1 && !a.ne && !b.ne && nnbarEvent(a, b, x, y)) continue; nuclearAnnihilation(a, b); }
        continue;
      }
      if (both) {
        if (d < Rn) { nuclearEncounter(a, b, d / Rn, x, y); if (a.dead) break; if (b.dead) continue; }
        if (d < R_FUS && tryFusion(a, b)) break;
        if (!a.dead && !b.dead && a.Z > 0 && b.Z > 0) coulombScatter(a, b, Math.max(d, 0.01));
      }
    }
  }
}
function inDetector(C, x, y) {
  if (!C.dets || !C.dets.length) return true;
  for (const d of C.dets) if (d.box ? x >= d.box[0] && x <= d.box[1] && y >= d.box[2] && y <= d.box[3] : Math.hypot(x - d.x, y - d.y) < d.r) return true;
  return false;
}
/* Beam–beam forces: as two bunches cross, each particle is pulled by the other bunch's charge (opposite charges:
   the bunches pinch each other) or pushed (the same). A charge passing at distance b gives a sideways kick
   Δp = 2k·q₁q₂(1 + β₁β₂) / (b·v_rel) (its electric field, and for head-on beams the magnetic one too). Each beam
   particle here stands for C.bbN real ones, a bunch population set for the beam–beam strength of a real collider
   (a kick of a few hundredths of a radian at the bunch's edge). Those real particles are spread smoothly over the
   bunch, not piled onto the few drawn ones: each drawn particle's charge is spread as a round Gaussian of width
   BB_SIG, so the 1/b of a point charge becomes (1 − e^(−b²/2σ²))/b, which is the field of a real bunch (Bassetti and
   Erskine): linear near its middle (the beam–beam tune shift), 1/b outside it. A point charge would give a
   particle passing close to one of the few drawn ones a kick big enough to throw it out of the ring, which real
   beams don't feel. The kick turns the path; the energy is kept. */
const R_BB = 6, BB_SIG = 1.0;
const bbG = (d) => (1 - Math.exp(-d * d / (2 * BB_SIG * BB_SIG))) / d; // the smoothed 1/b
function beamBeam(C, a, b, ex, ey, d) {
  const chg = (p) => (p.k === NUC ? (p.anti ? -1 : 1) * (Math.max(p.Z - p.ne, 0) || p.Z) : p.q);
  const qa = chg(a), qb = chg(b);
  if (!qa || !qb || !(C.bbN > 0)) return;
  const ba = a.sp / PHYS.C, bb = b.sp / PHYS.C, vrel = Math.hypot(a.sp * a.ux - b.sp * b.ux, a.sp * a.uy - b.sp * b.uy);
  if (!(vrel > 0)) return;
  const dp = 2 * PHYS.KE * qa * qb * (1 + ba * bb * Math.max(0, -(a.ux * b.ux + a.uy * b.uy))) * bbG(d) / vrel * C.bbN / Math.max(1, C.bunch); // (positive: repulsion)
  const kick = (p, sx, sy) => { // momentum dp along (sx, sy): turn the path by its sideways part over the momentum
    const pm = p.gam * (p.k === NUC ? p.m : PHYS.ME) * p.sp; if (!(pm > 0)) return;
    // (below full energy the pull is held at its full-energy strength, as the beam–beam tune shift of real hadron
    // beams is: their bunches are bigger at low energy, which spreads it out)
    const hold = C.pvF && C.pvF[p.beam] > 0 ? Math.min(1, pm * p.sp / C.pvF[p.beam]) : 1;
    const ang = dp * hold * (sx * -p.uy + sy * p.ux) / pm, c = Math.cos(ang), s = Math.sin(ang), ux = p.ux * c - p.uy * s, uy = p.ux * s + p.uy * c;
    p.ux = ux; p.uy = uy; p.vx = p.sp * ux; p.vy = p.sp * uy;
  };
  kick(a, -ex / d, -ey / d); kick(b, ex / d, ey / d); // (repulsion pushes a away from b and b away from a)
}
/* Two beam particles meet in the detector. Whatever they are, something happens when they come within reach:
   an electron and a positron annihilate (into photons, or new particles: hep.js), matter and antimatter annihilate
   into mesons, nuclei touching above their Coulomb barrier react (new particles, new nuclei), light nuclei tunnel
   and fuse, and otherwise they scatter off each other's charge. */
function beamHit(C, a, b, d, x, y, ex, ey) {
  const la = speciesLabel(a), lb = speciesLabel(b), hit = (txt) => { C.hits = (C.hits || 0) + 1; C.last = txt; };
  const lepA = a.k !== NUC, lepB = b.k !== NUC;
  if (lepA && lepB && a.k !== b.k) { eeEvent(a, b, x, y); return; } // (counts itself)
  if (!lepA && !lepB && opp(a, b)) {
    const t = a.Z + a.N === 1 && b.Z + b.N === 1 && !a.ne && !b.ne ? nnbarEvent(a, b, x, y) : null;
    if (!t) nuclearAnnihilation(a, b);
    hit(t || (W.log.length ? W.log[W.log.length - 1].text.replace(/^Antimatter annihilation: /, '') : `${la} + ${lb} annihilated`));
    return;
  }
  const R = lepA || lepB ? R_BEAM : Math.max(R_BEAM, nucReach(a, b));
  if (!lepA && !lepB) {
    const t = nuclearEncounter(a, b, d / R, x, y);
    if (t) { hit(t); return; }
    if (tryFusion(a, b)) { hit(`${la} + ${lb} fused: ${W.log.length ? W.log[W.log.length - 1].text.replace(/^Fusion: /, '') : ''}`); return; }
  }
  if (!a.dead && !b.dead) {
    const th = nuclearScatter(a, b, d, ex, ey, R);
    if (th !== null && th > 0.0175) {
      hit(`${la} + ${lb} scattered: ${(th * 180 / Math.PI).toFixed(0)}° in their own frame`);
      if (C.kind === 'ring') { a.caught = b.caught = true; a.beam = b.beam = null; } // (off the orbit for good: the detector stops them)
    }
  }
}
/* Beam particles scattered in a ring's detector have left the beam: thrown degrees off the orbit, in a real machine
   they go through the beam pipe into the detector, which stops them (and that is how it measures them). Here they fly
   on to the edge of the detector, where their energy is booked as deposited (as at an open wall) and they are gone,
   instead of flying out through the magnets and across the box (which is what happened before V24: same-charge
   beams, electron on electron say, lost their whole bunches that way as soon as they were brought together). */
function detectorStop(p) {
  const C = W.collider;
  if (!C || !C.dets || inDetector(C, p.x, p.y)) return false;
  W.ledger.escaped += p.KE; kill(p); return true;
}
/* Lorentz boost of (E, px, py) by velocity (bx, by) (units of c). */
function boost(E, px, py, bx, by) {
  const b2 = bx * bx + by * by;
  if (!(b2 > 1e-30)) return [E, px, py];
  const g = 1 / Math.sqrt(1 - b2), bp = bx * px + by * py, k = ((g - 1) * bp / b2 - g * E);
  return [g * (E - bp), px + k * bx, py + k * by];
}
/* A close pass (within the enlarged reach) scatters by Rutherford's law in the pair's own frame,
   tan(θ/2) = k·q₁q₂ / (b·p·v), repulsion turning them apart and attraction round each other. The distance of the
   pass, as a fraction u of the reach, is mapped onto real impact parameters as an area, b = R·√u, out to R = 15 times
   the distance of closest approach d₀ = 2k·q₁q₂ / (p·v) (or the nuclei's contact distance, 1.2 fm × (A₁^⅓ + A₂^⅓),
   if larger): a pass dead on turns them right round, one at the edge deflects them about 4°, as real Coulomb
   scattering spreads its angles (and as in nuclearEncounter, which decides first whether they touch). Exact
   relativistic kinematics: energy and momentum are kept. Returns the angle, or null if one has no charge. */
function nuclearScatter(a, b, d, ex, ey, reach = R_NN, rmap = 0) { // rmap (fm): map the pass onto impact parameters out to this instead
  const chg = (p) => (p.k === NUC ? (p.anti ? -1 : 1) * (Math.max(p.Z - p.ne, 0) || p.Z) : p.q);
  const qa = chg(a), qb = chg(b);
  if (!qa || !qb) return null;
  const Rc = Math.max(1, 1.2 * ((a.k === NUC ? Math.cbrt(a.Z + a.N) : 0) + (b.k === NUC ? Math.cbrt(b.Z + b.N) : 0))); // fm
  const ma = restE(a), mb = restE(b), Ea = ma + keOf(a), Eb = mb + keOf(b);
  const pa = Math.sqrt(Math.max(0, Ea * Ea - ma * ma)), pb = Math.sqrt(Math.max(0, Eb * Eb - mb * mb));
  const [ua, va] = a.rad ? [a.ux, a.uy] : [a.vx, a.vy].map(v => v / (Math.hypot(a.vx, a.vy) || 1));
  const [ub, vb] = b.rad ? [b.ux, b.uy] : [b.vx, b.vy].map(v => v / (Math.hypot(b.vx, b.vy) || 1));
  const E = Ea + Eb, bx = (pa * ua + pb * ub) / E, by = (pa * va + pb * vb) / E;
  const A = boost(Ea, pa * ua, pa * va, bx, by), Bst = boost(Eb, pb * ub, pb * vb, bx, by)[0];
  const ps = Math.hypot(A[1], A[2]);
  if (!(ps > 0)) return null;
  const vrel = ps / A[0] + ps / Bst; // their speeds add in their own frame (units of c)
  const K = 1.44e6 * Math.abs(qa * qb) / (ps * vrel), bfm = Math.max(0.02, Math.sqrt(Math.min(1, d / reach))) * (rmap || Math.max(Rc, HIT_COUL * K)); // (k = 1.44 MeV·fm; d₀ = 2K)
  const th0 = 2 * Math.atan(K / bfm);
  const side = Math.sign(A[1] * ey - A[2] * ex) || 1; // partner to the left (+) or right (−) of a's path
  const th = (qa * qb > 0 ? -1 : 1) * side * th0;
  const c = Math.cos(th), s = Math.sin(th), qx = A[1] * c - A[2] * s, qy = A[1] * s + A[2] * c;
  const A2 = boost(A[0], qx, qy, -bx, -by), B2 = boost(Bst, -qx, -qy, -bx, -by);
  const na = Math.hypot(A2[1], A2[2]) || 1, nb = Math.hypot(B2[1], B2[2]) || 1;
  setMotion(a, Math.max(1e-6, A2[0] - ma), A2[1] / na, A2[2] / na);
  setMotion(b, Math.max(1e-6, B2[0] - mb), B2[1] / nb, B2[2] / nb);
  return th0;
}
/* An electron and a positron in flight annihilate into two γ rays, back to back where their centre of mass is at
   rest, so in the lab they carry the pair's momentum too; all of their energy, mass included, goes into them. */
function annihilateInFlight(a, b, x, y) {
  const S = annihBegin([a, b]);
  const mc2 = ME_C2, Ea = a.KE + mc2, Eb = b.KE + mc2; // eV
  const pa = Math.sqrt(a.KE * a.KE + 2 * a.KE * mc2), pb = Math.sqrt(b.KE * b.KE + 2 * b.KE * mc2); // eV/c
  const E = Ea + Eb, Px = pa * a.ux + pb * b.ux, Py = pa * a.uy + pb * b.uy, P = Math.hypot(Px, Py);
  const M = Math.sqrt(Math.max(1, E * E - P * P)), bx = Px / E, by = Py / E, bb = P / E, g = E / M;
  const th = rnd() * 2 * Math.PI, nx = Math.cos(th), ny = Math.sin(th);
  const photons = [];
  for (const sg of [1, -1]) { // each photon M/2 in the centre-of-mass frame, then boosted to the lab
    const kx = sg * nx * M / 2, ky = sg * ny * M / 2, kb = bb > 0 ? (kx * bx + ky * by) / bb : 0;
    const El = g * (M / 2 + bb * kb), par = bb > 0 ? g * (kb + bb * M / 2) : 0;
    const qx = bb > 0 ? kx + (par - kb) * bx / bb : kx, qy = bb > 0 ? ky + (par - kb) * by / bb : ky, ql = Math.hypot(qx, qy) || 1;
    photons.push([El, qx / ql, qy / ql]);
  }
  kill(a); kill(b);
  const Er = annihEnd(S), sum = photons[0][0] + photons[1][0];
  for (const [El, ux, uy] of photons) emitPhoton(x, y, El * Er / sum, ux, uy);
  flash(x, y, [255, 255, 255], 3, 0.45);
  W.count.annih++;
  nucEvent('annih', x, y, 'e⁻ + e⁺ → γ + γ', [], `${fmtE(Er)} in two γ rays`);
  log('nuc', `Annihilation in flight: e⁻ + e⁺ → 2γ (${fmtE(Er)}: their mass and their ${fmtE(a.KE + b.KE)} of motion)`);
  if (W.collider) { W.collider.hits = (W.collider.hits || 0) + 1; W.collider.last = `e⁻e⁺ → γγ, ${fmtE(Er)}`; }
}
/* When a beam is used up (collided, or flown out of the beamline) the injectors send in the next bunches; a ring
   first dumps what is left of the other beam and goes back to its injection field. */
function colliderRefill() {
  const C = W.collider;
  if (!C || !C.auto || !W.sources.length || W.sources.some(s => !(s.count <= 0))) return;
  let na = 0, nb = 0;
  for (const p of W.parts) if (!p.dead && p.beam) { if (p.beam === 'b') nb++; else na++; }
  if (na && nb && !(C.colTurns > 40)) return; // (a ring dumps what is left after 40 turns of collisions)
  if (na + nb) { if (C.kind !== 'ring') return; for (const p of W.parts) if (!p.dead && p.beam) kill(p); }
  refillSources(C);
  resetRings(C);
}
function refillSources(C) { // each injector sends the next train: the set bunch, spread over the same length
  for (const s of W.sources) { s.count = C.bunch || 10; if (s.trainL) s.rate = s.vInj * Math.max(1, s.count - 1) / s.trainL; s.acc = 0.99 - s.rate * (s.delay || 0); } // (a linac's faster beam waits, to meet the other in the detector)
}
function resetRings(C) { // the magnets back at the injection field, the RF off until the new bunches are in
  C.colliding = false; C.colTurns = 0;
  for (const g of C.rings || []) { g.running = false; g.ramping = false; g.cnt = 0; g.sep = 1; g.Es = g.inj; g.N = C.bunch; for (const z of g.cavs) z.E = 0; }
}
/* A synchrotron. Each ring follows a synchronous particle: the ideal particle that meets every RF cavity at the
   synchronous phase φs, so the cavities' oscillating field gives it qV·sin φs each pass. The RF runs at h times its
   revolution frequency (h buckets round the ring), and the magnets follow its momentum, B = p/(qρ) (quadrupoles
   in proportion), as in a real machine, where the ramp of the magnets and the RF are programmed together. A real
   particle that arrives late sees a later phase: below transition (where a faster particle goes round sooner) φs
   sits on the rising side of the wave, so it gains more and catches up; above transition (where a faster particle
   swings out onto a longer orbit and takes longer) on the falling side. So the particles of a bunch swing to and fro
   about the synchronous one (synchrotron oscillations), and those outside the bucket drift off and are lost. At
   transition, γ = 1/√αc, the phase would jump from one side to the other (electrons are injected above it). The
   RF voltage is programmed with the energy (12% more each turn, and enough for what electrons radiate); at full energy φs goes
   to the wave's zero (0 or π) and the bucket only holds the bunch, except that electrons must be given back what
   they radiate each turn. The synchronous particle starts when the middle of the injected train leaves the kicker.
   The beams are brought together at full energy (C.sepMode 'auto'), as soon as they are in ('together'), or kept
   apart to go round without colliding ('apart'). */
function rampRing() {
  const C = W.collider;
  if (!C || C.kind !== 'ring' || !C.rings) return;
  for (const p of W.parts) { // each injection kicker fires once for the particles it brings in
    if (p.dead || !p.injKick) continue;
    if (zoneLocal(p.injKick, p.x, p.y)) p.kickIn = true;
    else if (p.kickIn) { for (const g of C.rings) if (g.kick === p.injKick) g.cnt++; p.injKick = null; }
  }
  const dt = W.dt || 0;
  let all = C.rings.length > 0;
  for (const g of C.rings) {
    if (!g.running && g.cnt >= Math.ceil(g.N / 2)) { g.running = true; g.ramping = true; g.Es = g.inj; g.ss = g.sExit; g.qV = 0; }
    const mc2 = g.m * AMU_EV, E = g.running ? g.Es : g.inj, gam = 1 + E / mc2, bet = Math.sqrt(1 - 1 / (gam * gam)), v = PHYS.C * bet;
    if (g.running) {
      const Ts = g.circ * (1 + g.sepL * g.sep) / v, eta = g.alphaC - 1 / (gam * gam); // (the beams kept apart run on orbits a little shorter or longer: measured)
      const U0 = g.lep ? 4 * Math.PI / 3 * PHYS.KE * gam ** 4 * bet ** 3 / g.rho : 0; // radiated per turn
      const want = g.ramping ? Math.min(0.12 * g.Es, g.gainCap, 3 * (g.Emax - g.Es)) : 0; // (gain per turn)
      if (g.ramping) g.qV = Math.max(g.qV, Math.max(Math.min(0.12 * g.Es, g.gainCap), 0.04 * g.Es) / (g.nCav * RF_S0), (want + U0) / (g.nCav * 0.95 * RF_SMAX)); // (per cavity: enough to hold a bunch even with nothing to gain, and to make up what electrons radiate)
      else { // at full energy the voltage comes down (slowly: adiabatically, so the bunch's energy spread shrinks with the bucket) to what holds the bunch
        const hold = Math.max(holdVoltage(g, E + mc2, bet, eta), U0 / (g.nCav * 0.5));
        if (g.qV > hold) g.qV = hold + (g.qV - hold) * Math.exp(-dt / (RF_HOLD_TURNS * Ts));
      }
      const sps = Math.max(0, Math.min(RF_SMAX, (want + U0) / (g.nCav * g.qV)));
      g.phiS = eta < 0 ? Math.asin(sps) : Math.PI - Math.asin(sps);
      g.eta = eta;
      const dE = (g.nCav * g.qV * sps - U0) * dt / Ts;
      g.Es += dE;
      if (g.ramping && (g.Es >= g.Emax * 0.999 || (sps >= RF_SMAX - 1e-9 && dE * Ts < 0.002 * g.Es * dt))) { g.ramping = false; g.Es = Math.min(g.Es, g.Emax); } // (or held back by radiation)
      g.ss = (g.ss + v * dt / (1 + g.sepL * g.sep)) % g.circ; // (the RF follows the beams round their actual orbit)
      for (const z of g.cavs) { z.E = g.qV / (z.w * g.qs) * Math.sin(g.phiS + 2 * Math.PI * g.h * (g.ss - z.rfS) / g.circ); z.Vamp = g.qV / g.aq; }
      if (C.colliding) g.sep = Math.max(0, g.sep - dt * v / (3 * g.circ)); // the separation wound down over about three turns
      else if (g.sep < 1) g.sep = Math.min(1, g.sep + dt * v / (3 * g.circ)); // (or back up, beams to be kept apart)
    } else for (const z of g.cavs) z.E = 0;
    const ps = pcOf(g.m, E) / PHYS.C / g.aq, f = 1 + g.sepB * g.sep; // momentum per unit charge
    for (const z of g.dip) z.B = g.sign * ps / (PHYS.LOR * z.R0) * f;
    for (const z of g.quads) z.G = g.sign * z.K * ps / PHYS.LOR;
    for (const z of g.seps) z.Es = z.sepSign * g.sepTheta * g.sep * ps * v / z.w; // a kick of sepTheta (opposite for the other charge)
    if (!(g.running && !g.ramping)) all = false;
  }
  // brought together: at full energy (auto), now (together), or never (apart)
  if (C.sepMode === 'apart') C.colliding = false;
  else if (C.sepMode === 'together') C.colliding = C.rings.some(g => g.running);
  else C.colliding = all;
  if (C.colliding) { const g = C.rings[0]; C.colTurns += dt * speedOfE(g) / g.circ; }
}
const pcOf = (m, KE) => Math.sqrt(KE * KE + 2 * KE * m * AMU_EV); // momentum × c, eV
/* The synchronous phase while ramping: about 49° from the zero crossing (sin = 0.75), at most 60°. It used to be 30°, which
   for the same gain per turn needs 1.5 times the voltage and 2.6 times the restoring slope at the bunch: a kick that big
   twice a turn made the energy oscillations chaotic, and particles drifting 10–15% off the design energy were lost from
   the ring at 0.98c and above, where the slip factor is largest. */
const RF_S0 = 0.75, RF_SMAX = Math.sin(Math.PI / 3);
/* The RF at full energy. While ramping, the voltage is set for 12% more energy a turn, so each pass of a cavity kicks a
   particle by up to a tenth of its energy (the ramp is fast because the turns are short); a bunch held at full energy
   with that voltage keeps swinging ±10% in energy, and particles at the swing's ends drift off the orbit the magnets hold
   (lost from the ring one by one at 0.98c — the D + T ring at 10 GeV showed it). So at full energy the voltage is brought
   down, over RF_HOLD_TURNS turns (many synchrotron periods: adiabatically, the bunch's energy spread shrinks as the fourth
   root of the voltage), to what gives a bucket RF_HOLD_BK of the energy high: the kicks are then a few per cent at most,
   and the bunch sits well inside the bucket. The bucket's half-height is β·√(2·qV·E / (π·h·|η|)) (E the total energy,
   qV the voltage per turn), so the voltage for a given height is (ΔE/β)²·π·h·|η| / (2·E). Near transition (η → 0) the
   voltage this gives vanishes; a floor keeps it at a small fraction of the energy. */
const RF_HOLD_BK = 0.08, RF_HOLD_TURNS = 25, RF_HOLD_MIN = 0.002;
function holdVoltage(g, Etot, bet, eta) { // per cavity
  const dE = RF_HOLD_BK * Etot, perTurn = Math.max((dE / bet) * (dE / bet) * Math.PI * g.h * Math.abs(eta) / (2 * Etot), RF_HOLD_MIN * Etot);
  return perTurn / g.nCav;
}
function speedOfE(g) { const gam = 1 + g.Es / (g.m * AMU_EV); return PHYS.C * Math.sqrt(1 - 1 / (gam * gam)); }

function moveNeutron(p, dt, c1, c2, kT) {
  const KE = keOf(p);
  if (!p.rad && KE < 1 && W.gamma > 0) { const sg = Math.sqrt(kT * p.im); p.vx = c1 * p.vx + c2 * sg * gauss(); p.vy = c1 * p.vy + c2 * sg * gauss(); }
  const x0 = p.x, y0 = p.y, x1 = x0 + p.vx * dt, y1 = y0 + p.vy * dt;
  const hits = segTargets(x0, y0, x1, y1, 1.0, (t) => t.k === NUC && t.Z > 0);
  for (const [, tg, b] of hits) {
    if (tg.dead || sameEv(p, tg)) continue;
    const R = nucReach(p, tg); // (a nucleus is hit where it is drawn)
    if (b < R && neutronHit(p, tg, b, R)) break;
  }
  // also fast nuclei (plasma)
  if (!p.dead) for (const tg of _fastNuc) {
    if (tg.dead || tg.Z < 1 || sameEv(p, tg)) continue;
    const rx = tg.x - x0, ry = tg.y - y0, dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? (rx * dx + ry * dy) / L2 : 0; t = clamp(t, 0, 1);
    const ex = rx - t * dx, ey = ry - t * dy, R = nucReach(p, tg);
    if (ex * ex + ey * ey < R * R) { if (neutronHit(p, tg, Math.hypot(ex, ey), R)) break; }
  }
  if (p.dead) return;
  p.x += p.vx * dt; p.y += p.vy * dt;
  const KE2 = keOf(p);
  if (p.trk) { extendTrack(p); if (KE2 < 1) p.trk = null; }
  wallOrEscape(p, KE2 > ESC_E_NEUTRON);
}

/* Fast (but not radiation-mode) particles: CCD encounters along the step, hard-sphere or Coulomb scattering. */
function fastEncounters(p) {
  const x0 = p.ox, y0 = p.oy, x1 = p.x, y1 = p.y;
  if (Math.abs(x1 - x0) > W.box.w / 2 || Math.abs(y1 - y0) > W.box.h / 2) return;
  if (p.k !== NUC) {
    const hits = segTargets(x0, y0, x1, y1, 1.0, (t) => t.k === NUC && t.Z > 0);
    for (const [t, A, b] of hits) {
      if (A.dead || p.dead || sameEv(p, A)) continue;
      const rh = A.ne > 0 ? 0.35 + 0.5 * A.el.rc : Math.max(0.55, nucDrawR(A) + 0.03);
      if (b > rh || p.hit === A.id) continue;
      evLepton(p, A, b);
      if (p.dead) return;
      break;
    }
    if (p.hit && !hits.some(h => h[1].id === p.hit)) p.hit = 0;
    return;
  }
  const hits = segTargets(x0, y0, x1, y1, 1.6, (t) => t.k === NUC && t.Z > 0 && t !== p);
  for (const [t, A, b] of hits) {
    if (A.dead || p.dead || sameEv(p, A)) continue;
    if (b < R_FUS && tryFusion(p, A)) return;
    if (opp(p, A) && b < (p.ne > 0 && A.ne > 0 ? 0.5 * (p.ljR + A.ljR) : 0.6)) { evAnti(p, A, b); return; }
    const contact = (p.ne > 0 && A.ne > 0) ? 0.35 * (p.ljR + A.ljR) : 0;
    if (contact > 0 && b < contact) { hardSphere(p, A, b, contact); return; }
    if (p.ne === 0 && b < 0.6) { coulombScatter(p, A, b); return; }
  }
}
/* Elastic binary collisions of a flying nucleus (exact in energy: velocities whose ½mv² is each one's kinetic
   energy, and setVel, which keeps a radiation-mode particle's stored energy and direction in step). */
function hardSphere(a, b, bimp, R) {
  const [avx, avy] = vNR(a), [bvx, bvy] = vNR(b);
  const M = a.m + b.m, Vx = (a.m * avx + b.m * bvx) / M, Vy = (a.m * avy + b.m * bvy) / M;
  const rvx = avx - bvx, rvy = avy - bvy;
  const th = 2 * Math.acos(clamp(bimp / R, 0, 1)) * (rnd() < 0.5 ? 1 : -1);
  const c = Math.cos(Math.PI - Math.abs(th)), s = Math.sin(Math.PI - Math.abs(th)) * Math.sign(th);
  const nx = rvx * c - rvy * s, ny = rvx * s + rvy * c;
  setVel(a, Vx + nx * b.m / M, Vy + ny * b.m / M);
  setVel(b, Vx - nx * a.m / M, Vy - ny * a.m / M);
}
function coulombScatter(a, b, bimp) {
  const [avx, avy] = vNR(a), [bvx, bvy] = vNR(b);
  const mu = a.m * b.m / (a.m + b.m);
  const rvx = avx - bvx, rvy = avy - bvy;
  const Ecm = 0.5 * mu * (rvx * rvx + rvy * rvy);
  if (Ecm <= 0) return;
  const qb = b.ne > 0 ? Math.max(1, b.Z - b.ne + 1) : b.Z;
  const d = PHYS.KE * Math.max(1, a.Z) * qb / Ecm;
  const th = 2 * Math.atan(d / (2 * Math.max(bimp, 0.01))) * (rnd() < 0.5 ? 1 : -1);
  const M = a.m + b.m, Vx = (a.m * avx + b.m * bvx) / M, Vy = (a.m * avy + b.m * bvy) / M;
  const c = Math.cos(th), s = Math.sin(th);
  const nx = rvx * c - rvy * s, ny = rvx * s + rvy * c;
  setVel(a, Vx + nx * b.m / M, Vy + ny * b.m / M);
  setVel(b, Vx - nx * a.m / M, Vy - ny * a.m / M);
}
/* Fast nucleus pairs (hot plasma): continuous collision detection for fusion and Coulomb scattering. */
let _ffOrd = new Int32Array(0), _ffKey = new Float64Array(0);
function fastFastNuclear() {
  const n = _fastNuc.length;
  if (n < 2) return;
  // in order of x, so each nucleus is checked only against those within 12 Å to its right (a hot world has thousands
  // of fast nuclei: all pairs would be millions)
  if (_ffOrd.length < n) { _ffOrd = new Int32Array(n * 2); _ffKey = new Float64Array(n * 2); }
  const ord = _ffOrd, key = _ffKey;
  for (let i = 0; i < n; i++) { ord[i] = i; key[i] = _fastNuc[i].ox; }
  const sub = ord.subarray(0, n); sub.sort((p, q) => key[p] - key[q] || p - q);
  for (let ii = 0; ii < n; ii++) {
    const a = _fastNuc[ord[ii]];
    if (a.dead || a.Z < 1) continue;
    for (let jj = ii + 1; jj < n; jj++) {
      if (key[ord[jj]] - a.ox > 12) break;
      const b = _fastNuc[ord[jj]];
      if (b.dead || b.Z < 1 || sameEv(a, b)) continue;
      if (a.beam && b.beam && W.collider) continue; // (a collider's beams meet in beamCollisions; a bunch's own particles ignore each other)
      const rx = b.ox - a.ox, ry = b.oy - a.oy;
      if (Math.abs(rx) > 12 || Math.abs(ry) > 12) continue;
      const dx = (b.x - b.ox) - (a.x - a.ox), dy = (b.y - b.oy) - (a.y - a.oy), L2 = dx * dx + dy * dy;
      let t = L2 > 0 ? -(rx * dx + ry * dy) / L2 : 0; t = clamp(t, 0, 1);
      const ex = rx + t * dx, ey = ry + t * dy, b2 = ex * ex + ey * ey;
      if (b2 < R_FUS * R_FUS) { if (tryFusion(a, b)) break; }
      if (b2 < 0.36 && !a.dead && !b.dead) coulombScatter(a, b, Math.sqrt(b2));
    }
  }
}

/* ------------------------------------------------------------------ integration */
function chooseDt() {
  let vmax = 0, amax = 0, vfn = 0, vrad = 0;
  const zoned = W.zones.length > 0;
  const PI = partsSync(), n = W.parts.length, DEAD = S.dead, RAD = S.rad, K = S.k, Z = S.Z, FAST = S.fast, VX = S.vx, VY = S.vy, FX = S.fx, FY = S.fy, IM = S.im, OBJ = S.obj;
  for (let j = 0; j < n; j++) {
    const i = PI[j];
    if (DEAD[i] === 1) continue;
    if (RAD[i] === 1) { if (zoned) { const sp = OBJ[i].sp; if (sp > vrad) vrad = sp; } continue; }
    const k = K[i];
    if (k === NUC && Z[i] === 0) continue;
    const v2 = VX[i] * VX[i] + VY[i] * VY[i];
    if (FAST[i] === 1) { if (k === NUC && v2 > vfn) vfn = v2; continue; }
    if (k !== NUC) continue; // free electrons and positrons keep their own, shorter steps (innerDt)
    if (v2 > vmax) vmax = v2;
    const a2 = (FX[i] * FX[i] + FY[i] * FY[i]) * IM[i] * IM[i];
    if (a2 > amax) amax = a2;
  }
  vmax = Math.sqrt(vmax); amax = Math.sqrt(amax); vfn = Math.sqrt(vfn);
  W.vmax = vmax; W.amax = amax;
  let dt = DT_MAX;
  if (vmax > 0) dt = Math.min(dt, 0.08 / vmax);
  if (amax > 0) dt = Math.min(dt, Math.sqrt(0.04 / amax));
  if (vfn > 0) dt = Math.min(dt, 3.5 / vfn);
  if (vrad > 0) dt = Math.min(dt, 1.5 / vrad); // beams in an accelerator: short steps through its magnets and cavities
  if (zoned) for (const s of W.sources) if (s.count > 0 && s.rate > 0) dt = Math.min(dt, 0.9 / s.rate); // (an injector sends in one particle a step)
  if (_stiff > 0) dt = Math.min(dt, 0.15 / Math.sqrt(_stiff));
  if (_mdL.length) dt = Math.min(dt, KMAX * innerDt());
  return Math.max(DT_MIN, dt);
}

/* ---- free electrons on their own clock
   Free electrons and positrons have their real mass, so at one temperature they move about 43 times faster than
   hydrogen atoms (faster still than heavier ones) and need far shorter steps. Forces are split (multiple time steps, reversible RESPA): the part that
   involves a free lepton (gx, gy) is recomputed on short inner steps, while the rest (bonds, atom–atom forces)
   stays on the atoms' step. With no free electrons this is exactly the plain velocity Verlet step. */
const KMAX = 400; // inner steps per atom step at most (the atom step shrinks before more are needed)
const LEP_STEP = 0.2; // Å: farthest a free electron moves in one inner step (collisions with atoms are checked on each)
function innerDt() {
  let dt = DT_MAX;
  const hasB = hasBfield();
  const mdLI = _mdLI, nL = _nmdL, DEAD = S.dead, FAST = S.fast, RAD = S.rad, Q = S.q, IM = S.im, VX = S.vx, VY = S.vy, GX = S.gx, GY = S.gy, X = S.x, Y = S.y, OBJ = S.obj;
  for (let q = 0; q < nL; q++) {
    const i = mdLI[q];
    if (DEAD[i] === 1 || FAST[i] === 1 || RAD[i] === 1) continue;
    const p = OBJ[i], im = IM[i];
    p.Bl = hasB && Q[i] !== 0 ? Bfield(X[i], Y[i], p) : 0; // (used by this inner step's arcs)
    const om = p.omB = Math.abs(Q[i] * p.Bl * PHYS.LOR * im);
    const v = Math.sqrt(VX[i] * VX[i] + VY[i] * VY[i]), a = Math.sqrt(GX[i] * GX[i] + GY[i] * GY[i]) * im;
    if (om > 0) {
      // in a field: at most ~115° of a turn (an exact arc; a whole turn between two kicks would resonate), and at
      // most LEP_STEP from where it was, which a circle smaller than that never is
      dt = Math.min(dt, 2 / om);
      const d = 2 * v / om; // the circle's diameter
      if (d > LEP_STEP) dt = Math.min(dt, 2 / om * Math.asin(LEP_STEP / d));
    } else if (v > 0) dt = Math.min(dt, LEP_STEP / v);
    if (a > 0) dt = Math.min(dt, Math.sqrt(0.04 / a)); // at most 0.02 Å off its course from its acceleration
  }
  if (_stiffL > 0) dt = Math.min(dt, 0.15 / Math.sqrt(_stiffL));
  const g = W.grab; // grabbed electron: its spring and damping
  if (g && g.p && g.p.k !== NUC && !g.p.dead && !g.p.fast) dt = Math.min(dt, 0.2 * g.p.m / Math.max(g.p.m, GRAB_M));
  return Math.max(DT_MIN, dt);
}
/* A pair with at least one free lepton, fast part only (the same physics as pairForce). dx, dy: j − i. */
function fastPair(i, j, dx, dy, r2) {
  const r = Math.sqrt(r2), K = S.k, ki = K[i], kj = K[j];
  let f;
  if (ki === NUC || kj === NUC) {
    const ai = ki === NUC ? i : j, li = ki === NUC ? j : i;
    if (S.Z[ai] === 0) return;
    f = leptonNuc(li, ai, r);
  } else {
    const s2 = r2 + 0.04, Q = S.q;
    f = PHYS.KE * Q[i] * Q[j] * r / (s2 * Math.sqrt(s2));
    { const w = PHYS.KE * (Math.abs(0.04 - 2 * r2) + s2) / (s2 * s2 * Math.sqrt(s2)) * (S.im[i] + S.im[j]); if (w > _stiffL) _stiffL = w; } // (at every distance: a cutoff would make the step jump)
    if (ki !== kj && r < 0.3 && !_lepEvOff) queue(EV.ANNIH, S.obj[i], S.obj[j], null, r);
  }
  if (f > FCAP) f = FCAP; else if (f < -FCAP) f = -FCAP;
  const fx = f * dx / r, fy = f * dy / r, GX = S.gx, GY = S.gy;
  GX[j] += fx; GY[j] += fy; GX[i] -= fx; GY[i] -= fy;
}
const isLepMD = (i) => S.dead[i] === 0 && S.fast[i] === 0 && S.rad[i] === 0;
/* ---- the inner steps' neighbour list ----
   For every free lepton in MD: the atoms and ions within RC + SKIN_F of it (la → lb), and the other free leptons within
   that (ll pairs, each once). Built from the cells (the nuclei sorted once per making of _md, the leptons each time),
   and kept while _md is the same and nothing has moved more than SKIN_F/2 since: a lepton moves at most LEP_STEP (0.2 Å)
   in an inner step, so the list usually serves several of them. */
const FL = { gen: -1, n: 0, w: 0, h: 0, wall: '', bx: new Float64Array(16), by: new Float64Array(16), na: 0, la: new Int32Array(1024), lb: new Int32Array(1024), nl: 0, li: new Int32Array(256), lj: new Int32Array(256),
  builds: 0, checks: 0 };
function flValid() {
  FL.checks++;
  if (FL.gen !== _mdGen || FL.n !== _nmd || FL.w !== W.box.w || FL.h !== W.box.h || FL.wall !== W.wall) return false;
  const X = S.x, Y = S.y, bx = FL.bx, by = FL.by, idx = _mdI, n = _nmd, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2;
  let worst = 0;
  if (wrap) {
    for (let i = 0; i < n; i++) {
      let dx = X[idx[i]] - bx[i], dy = Y[idx[i]] - by[i];
      if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh;
      const d2 = dx * dx + dy * dy; if (d2 > worst) worst = d2;
    }
  } else {
    for (let i = 0; i < n; i++) { const dx = X[idx[i]] - bx[i], dy = Y[idx[i]] - by[i], d2 = dx * dx + dy * dy; if (d2 > worst) worst = d2; }
  }
  return worst <= HSKINF2;
}
function flBuild() {
  FL.builds++;
  const n = _nmd, idx = _mdI, X = S.x, Y = S.y, K = S.k, Z = S.Z;
  if (FL.bx.length < n) { FL.bx = new Float64Array(n * 2 + 16); FL.by = new Float64Array(n * 2 + 16); }
  for (let i = 0; i < n; i++) { FL.bx[i] = X[idx[i]]; FL.by[i] = Y[idx[i]]; }
  FL.gen = _mdGen; FL.n = n; FL.w = W.box.w; FL.h = W.box.h; FL.wall = W.wall;
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2;
  // the grid (built over _md at the last computeForces) finds the atoms: they may have moved since, by at most dG, so
  // the cells scanned reach RC + SKIN_F + dG from each lepton
  const px = G.px, py = G.py, head = G.head, next = G.next, cols = G.cols, rows = G.rows;
  let dG2 = 0;
  for (let i = 0; i < n; i++) {
    const si = idx[i];
    if (K[si] !== NUC) continue;
    let dx = X[si] - px[i], dy = Y[si] - py[i];
    if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
    const d2 = dx * dx + dy * dy; if (d2 > dG2) dG2 = d2;
  }
  const reach = RC + SKIN_F + Math.sqrt(dG2), sx = Math.ceil(reach / G.cw), sy = Math.ceil(reach / G.ch);
  const nL = _nmdL, mdLI = _mdLI;
  let la = FL.la, lb = FL.lb, na = 0, li = FL.li, lj = FL.lj, nl = 0;
  for (let q = 0; q < nL; q++) {
    const L = mdLI[q];
    if (!isLepMD(L)) continue;
    const lx = X[L], ly = Y[L];
    const ccx = Math.floor((lx + G.hx) / G.cw), ccy = Math.floor((ly + G.hy) / G.ch);
    let x0 = ccx - sx, x1 = ccx + sx, y0 = ccy - sy, y1 = ccy + sy;
    if (!wrap) { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(cols - 1, x1); y1 = Math.min(rows - 1, y1); }
    else { if (x1 - x0 + 1 >= cols) { x0 = 0; x1 = cols - 1; } if (y1 - y0 + 1 >= rows) { y0 = 0; y1 = rows - 1; } }
    for (let cy = y0; cy <= y1; cy++) {
      const ry = wrap ? ((cy % rows) + rows) % rows : cy;
      for (let cx = x0; cx <= x1; cx++) {
        const rx = wrap ? ((cx % cols) + cols) % cols : cx;
        for (let k = head[ry * cols + rx]; k !== -1; k = next[k]) {
          const A = idx[k];
          if (K[A] !== NUC || Z[A] === 0 || S.dead[A] === 1 || S.fast[A] === 1 || S.rad[A] === 1) continue;
          let dx = X[A] - lx, dy = Y[A] - ly;
          if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
          if (dx * dx + dy * dy < RLF2) {
            if (na >= la.length) { const a = new Int32Array(la.length * 2); a.set(la); la = a; const b = new Int32Array(lb.length * 2); b.set(lb); lb = b; }
            la[na] = L; lb[na] = A; na++;
          }
        }
      }
    }
    for (let q2 = q + 1; q2 < nL; q2++) { // the other free leptons (every pair once; few enough to look at all of them)
      const M = mdLI[q2];
      if (!isLepMD(M)) continue;
      let dx = X[M] - lx, dy = Y[M] - ly;
      if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
      if (dx * dx + dy * dy < RLF2) {
        if (nl >= li.length) { const a = new Int32Array(li.length * 2); a.set(li); li = a; const b = new Int32Array(lj.length * 2); b.set(lj); lj = b; }
        li[nl] = L; lj[nl] = M; nl++;
      }
    }
  }
  FL.la = la; FL.lb = lb; FL.na = na; FL.li = li; FL.lj = lj; FL.nl = nl;
}
/* The fast part alone, for the inner steps: free leptons with atoms and ions, with each other, with distant charges,
   and their own single-particle forces. */
function computeFast() {
  _stiffL = 0;
  const GX = S.gx, GY = S.gy, mdI = _mdI, nmd = _nmd;
  for (let q = 0; q < nmd; q++) { const i = mdI[q]; GX[i] = 0; GY[i] = 0; }
  if (!_mdL.length) return;
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2;
  if (!flValid()) flBuild();
  const X = S.x, Y = S.y, NEAR = S.nearIon, DEAD = S.dead, FAST = S.fast, RAD = S.rad;
  for (let q = 0; q < _nmdL; q++) NEAR[_mdLI[q]] = 0;
  const la = FL.la, lb = FL.lb, na = FL.na;
  { // lepton–atom pairs: the physics of leptonNuc, written out here because this is the innermost loop of all (a function
    // call per pair cost a quarter of it). Any change to leptonNuc must be made here too.
    const Q = S.q, SEN = S.sEN, IM = S.im, NE = S.ne, ELRC = S.elrc, HIT = S.hit, ID = S.id, K = S.k, ANTI = S.anti, OBJ = S.obj, Z = S.Z, KE = PHYS.KE;
    let stiff = _stiffL;
    for (let k = 0; k < na; k++) {
      const L = la[k], A = lb[k];
      if (DEAD[L] === 1 || FAST[L] === 1 || RAD[L] === 1 || DEAD[A] === 1 || FAST[A] === 1 || RAD[A] === 1) continue;
      let dx = X[A] - X[L], dy = Y[A] - Y[L];
      if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
      const r2 = dx * dx + dy * dy;
      if (!(r2 < RC2 && r2 > 1e-10) || Z[A] === 0) continue;
      const r = Math.sqrt(r2), qa = Q[A], ql = Q[L];
      let f = 0;
      if (qa !== 0) {
        const sE = SEN[A], s2 = r * r + sE, sq = Math.sqrt(s2);
        f = KE * ql * qa * r / (s2 * sq);
        // close passes through an ion's core: radial and tangential stiffness for the step-size control
        const w = KE * Math.abs(ql * qa) * (Math.abs(sE - 2 * r * r) + s2) / (s2 * s2 * sq) * (IM[L] + IM[A]);
        if (w > stiff) stiff = w;
      }
      const rh = NE[A] > 0 ? 0.35 + 0.5 * ELRC[A] : 0.55;
      const pull = ql * qa <= -1; // the lepton is attracted by a net opposite charge
      if (pull && r < 3.5) NEAR[L] = 1;
      const aid = ID[A];
      if ((pull && !((K[L] === ELEC) === (ANTI[A] === 1)) && r < 1.2 + 0.5 * Math.min(Math.abs(qa), 4)) || (r < rh && HIT[L] !== aid)) { if (!_lepEvOff) queue(EV.LEPTON, OBJ[L], OBJ[A], null, r); } // (!clash)
      else if (HIT[L] === aid && r > 1.7 * rh) HIT[L] = 0;
      if (f > FCAP) f = FCAP; else if (f < -FCAP) f = -FCAP;
      const fx = f * dx / r, fy = f * dy / r;
      GX[A] += fx; GY[A] += fy; GX[L] -= fx; GY[L] -= fy;
    }
    _stiffL = stiff;
  }
  const li = FL.li, lj = FL.lj, nl = FL.nl;
  for (let k = 0; k < nl; k++) {
    const L = li[k], M = lj[k];
    if (DEAD[L] === 1 || FAST[L] === 1 || RAD[L] === 1 || DEAD[M] === 1 || FAST[M] === 1 || RAD[M] === 1) continue;
    let dx = X[M] - X[L], dy = Y[M] - Y[L];
    if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
    const r2 = dx * dx + dy * dy;
    if (r2 < RC2 && r2 > 1e-10) fastPair(L, M, dx, dy, r2);
  }
  if (_lrOn) { // exact Coulomb with net charges beyond the cutoff, as in computeForces
    const K = S.k, ID = S.id, Q = S.q, chI = _chI, nch = _nch;
    for (let q = 0; q < _nmdL; q++) {
      const L = _mdLI[q];
      if (DEAD[L] === 1 || FAST[L] === 1 || RAD[L] === 1) continue;
      const qL = Q[L], idL = ID[L], lx = X[L], ly = Y[L];
      for (let c = 0; c < nch; c++) {
        const C = chI[c];
        if (C === L || DEAD[C] === 1 || FAST[C] === 1 || RAD[C] === 1 || (K[C] !== NUC && ID[C] < idL)) continue;
        const dx = X[C] - lx, dy = Y[C] - ly, r2 = dx * dx + dy * dy;
        if (r2 < RC2) continue;
        // qx(L, C) = qL (a lepton's charge); qx(C, L) = C's net charge (partial charges are not felt by free leptons)
        const r = Math.sqrt(r2), f = PHYS.KE * qL * Q[C] / r2, fx = f * dx / r, fy = f * dy / r;
        GX[C] += fx; GY[C] += fy; GX[L] -= fx; GY[L] -= fy;
      }
    }
  }
  leptonExtras(false);
}
/* Outer half-kick: the slow part on everything in MD (atoms turn in a magnetic field here, electrons on their own
   steps); ballistic nuclei kick, turn and fly as before; ballistic electrons fly in moveFastLeptons. */
function outerA(dt) {
  const hasB = hasBfield(), h = 0.5 * dt;
  const PI = partsSync(), n = W.parts.length;
  const DEAD = S.dead, RAD = S.rad, K = S.k, Z = S.Z, FAST = S.fast, VX = S.vx, VY = S.vy, FX = S.fx, FY = S.fy, GX = S.gx, GY = S.gy, IM = S.im, Q = S.q;
  const X = S.x, Y = S.y, OX = S.ox, OY = S.oy, FRESH = S.fresh, BALL = S.ballistic, OBJ = S.obj;
  for (let j = 0; j < n; j++) {
    const i = PI[j];
    if (DEAD[i] === 1 || RAD[i] === 1) continue;
    const k = K[i];
    if (k === NUC && Z[i] === 0) continue;
    OX[i] = X[i]; OY[i] = Y[i]; FRESH[i] = 0;
    const fast = FAST[i] === 1;
    BALL[i] = fast && k !== NUC ? 1 : 0;
    if (fast) {
      if (k !== NUC) continue;
      let vx = VX[i] + h * FX[i] * IM[i], vy = VY[i] + h * FY[i] * IM[i];
      if (hasB && Q[i] !== 0) { rotateB(OBJ[i], vx, vy, h); vx = _rb[0]; vy = _rb[1]; }
      VX[i] = vx; VY[i] = vy;
      X[i] += vx * dt; Y[i] += vy * dt;
      continue;
    }
    let vx = VX[i] + h * (FX[i] - GX[i]) * IM[i], vy = VY[i] + h * (FY[i] - GY[i]) * IM[i];
    if (hasB && Q[i] !== 0 && k === NUC) { rotateB(OBJ[i], vx, vy, h); vx = _rb[0]; vy = _rb[1]; }
    VX[i] = vx; VY[i] = vy;
  }
}
/* outerA and the single drift of innerSteps done together, elementwise over the slots, when there is no magnetic field
   and no free electron in MD (then the inner step is one plain drift). threads.js shares this out; here: not taken. */
let integrateA = function (dt) { return false; }; // eslint-disable-line no-unused-vars
let threadsPrewake = function () {}; // (threads.js)
function integrateAPlain(dt) { return !hasBfield() && _nmdL === 0 && _mdL.length === 0; }
/* Inner steps: fast half-kick, drift (everything in MD moves), fast forces, lepton events, fast half-kick. */
function innerSteps(Dt) {
  const hasB = hasBfield(), wrap = W.wall === 'wrap';
  const bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2;
  let rem = Dt, dti = rem, left = 0;
  while (rem > 1e-12) {
    // Equal inner steps through the atom step, shortened at once if things get stiffer: a step that wobbled with
    // each electron's gyration (its speed and distance to its neighbours do) would pump its circling up.
    if (_mdL.length) {
      const L = innerDt();
      if (left <= 0 || L < 0.8 * dti) { const n = Math.max(1, Math.ceil(rem / L - 1e-9)); dti = rem / n; left = n; }
    } else { dti = rem; left = 1; }
    left--;
    const h = 0.5 * dti;
    if (!_mdL.length) { // no free lepton among the stepped particles: the fast part is zero and this is the plain drift
      const mdI = _mdI, nmd = _nmd, DEAD = S.dead, RAD = S.rad, FAST = S.fast, VX = S.vx, VY = S.vy, X = S.x, Y = S.y, FRESH = S.fresh;
      for (let q = 0; q < nmd; q++) {
        const i = mdI[q];
        if (DEAD[i] === 1 || FAST[i] === 1 || RAD[i] === 1) continue;
        FRESH[i] = 0; X[i] += VX[i] * dti; Y[i] += VY[i] * dti;
      }
      rem -= dti;
      continue;
    }
    {
      const mdI = _mdI, nmd = _nmd, DEAD = S.dead, RAD = S.rad, K = S.k, FAST = S.fast, VX = S.vx, VY = S.vy, GX = S.gx, GY = S.gy, IM = S.im;
      const X = S.x, Y = S.y, OX = S.ox, OY = S.oy, FRESH = S.fresh, OBJ = S.obj;
      for (let q = 0; q < nmd; q++) {
        const i = mdI[q];
        if (DEAD[i] === 1 || FAST[i] === 1 || RAD[i] === 1) continue;
        FRESH[i] = 0;
        const im = IM[i];
        VX[i] += h * GX[i] * im; VY[i] += h * GY[i] * im;
        if (K[i] !== NUC) {
          const p = OBJ[i];
          // a free lepton in a magnetic field moves on an exact arc between the kicks: its guiding centre then drifts
          // across the field exactly (only the kicks move it), however many turns it makes in a field of any strength
          if (p.Bl !== 0 && hasB) gyrate(p, p.Bl, dti);
          else { X[i] += VX[i] * dti; Y[i] += VY[i] * dti; }
          if (wrap) {
            if (X[i] < -hw) { X[i] += bw; OX[i] += bw; } else if (X[i] > hw) { X[i] -= bw; OX[i] -= bw; }
            if (Y[i] < -hh) { Y[i] += bh; OY[i] += bh; } else if (Y[i] > hh) { Y[i] -= bh; OY[i] -= bh; }
          } else if (X[i] < -hw || X[i] > hw || Y[i] < -hh || Y[i] > hh) leptonWall(p);
        } else { X[i] += VX[i] * dti; Y[i] += VY[i] * dti; }
      }
    }
    if (_mdL.length) {
      computeFast();
      const st0 = W.spawned + W.topo + W.dirty - _undone; // (changes put back exactly, as by undoJoin, need no recount)
      processEvents();
      if (W.spawned + W.topo + W.dirty - _undone !== st0) { _noEv = true; computeForces(); _noEv = false; }
    }
    {
      const mdI = _mdI, nmd = _nmd, DEAD = S.dead, RAD = S.rad, FAST = S.fast, VX = S.vx, VY = S.vy, GX = S.gx, GY = S.gy, IM = S.im, FRESH = S.fresh;
      for (let q = 0; q < nmd; q++) {
        const i = mdI[q];
        if (DEAD[i] === 1 || FAST[i] === 1 || RAD[i] === 1 || FRESH[i] === 1) continue; // fresh: born in this step's events, already current
        VX[i] += h * GX[i] * IM[i]; VY[i] += h * GY[i] * IM[i];
      }
    }
    rem -= dti;
  }
}
/* A free electron reaching the box edge bounces off a closed wall elastically (off the piston, when the box is
   resized), and is lost through an open one. A positron meets the wall's own electrons. */
function leptonWall(p) {
  if (W.wall === 'open') { kill(p); return; }
  if (p.k === POS) { annihilateAtWall(p); return; }
  const hw = W.box.w / 2, hh = W.box.h / 2, uw = W.box.uw, uh = W.box.uh;
  if (p.x < -hw) { p.x = -hw + Math.min(W.box.w, -hw - p.x); p.vx = -2 * uw - p.vx; if (p.vx < 0) p.vx = -p.vx; }
  else if (p.x > hw) { p.x = hw - Math.min(W.box.w, p.x - hw); p.vx = 2 * uw - p.vx; if (p.vx > 0) p.vx = -p.vx; }
  if (p.y < -hh) { p.y = -hh + Math.min(W.box.h, -hh - p.y); p.vy = -2 * uh - p.vy; if (p.vy < 0) p.vy = -p.vy; }
  else if (p.y > hh) { p.y = hh - Math.min(W.box.h, p.y - hh); p.vy = 2 * uh - p.vy; if (p.vy > 0) p.vy = -p.vy; }
}
/* Ballistic electrons and positrons (20 eV – 1 keV) fly in straight segments and look for collisions along every
   one. A segment ends just past the next wall (reflected or wrapped there), and is at most 45% of the box across
   or a quarter turn in a magnetic field. An applied electric field is exact on a segment (uniform acceleration). */
function moveFastLeptons(Dt, id0) {
  const hasB = hasBfield(), hasE = hasEfield();
  const hw = W.box.w / 2, hh = W.box.h / 2, Lmax = 0.45 * Math.min(W.box.w, W.box.h), look = _nNucMD > 0;
  const DEAD = S.dead, RAD = S.rad, K = S.k, FAST = S.fast, BALL = S.ballistic, ID = S.id, OBJ = S.obj;
  for (let j = 0; j < W.parts.length; j++) { // (the count read each time: particles can be born within)
    const si = partsSync()[j];
    if (DEAD[si] === 1 || RAD[si] === 1 || K[si] === NUC || FAST[si] === 0 || BALL[si] === 0 || ID[si] >= id0) continue;
    const p = OBJ[si];
    let rem = Dt, guard = 0;
    while (rem > 1e-12) {
      const vx0 = p.vx, vy0 = p.vy, v = Math.sqrt(vx0 * vx0 + vy0 * vy0);
      let h = rem;
      if (v > 0 && guard++ < 400) {
        h = Math.min(h, Lmax / v);
        const tx = vx0 > 0 ? (hw - p.x) / vx0 : vx0 < 0 ? (-hw - p.x) / vx0 : Infinity;
        const ty = vy0 > 0 ? (hh - p.y) / vy0 : vy0 < 0 ? (-hh - p.y) / vy0 : Infinity;
        const tw = Math.min(tx, ty) + 1e-6 / v;
        if (tw > 0 && tw < h) h = tw;
      }
      const B = hasB && p.q ? Bfield(p.x, p.y, p) : 0;
      if (B !== 0 && v > 0) h = Math.min(h, 0.25 / Math.abs(p.q * B * PHYS.LOR * p.im)); // a quarter turn at most
      p.ox = p.x; p.oy = p.y;
      const ke = 0.5 * h * p.q * p.im;
      if (hasE) { const E = Efield(p.x, p.y, p); p.vx += ke * E[0]; p.vy += ke * E[1]; }
      if (B !== 0) gyrate(p, B, h); else { p.x += p.vx * h; p.y += p.vy * h; }
      if (hasE) { const E = Efield(p.x, p.y, p); p.vx += ke * E[0]; p.vy += ke * E[1]; }
      rem -= h;
      walls(p); if (p.dead || p.rad) break;
      updateFast(p); if (!p.fast) break; // slowed into MD: it carries on there next step
      if (look) { fastEncounters(p); if (p.dead || p.rad || !p.fast) break; }
      if (p.trk) extendTrack(p);
    }
    if (p.trk && !p.dead && !p.rad && !p.trkKeep && 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy) < 200) p.trk = null;
  }
}

/* Exact motion in a uniform magnetic field over time h: the velocity turns by Ωh (Ω = qB/m) and the particle
   moves along the arc, so a free electron circles exactly however strong the field: at 10⁶ T it goes round
   in 0.04 fs, on a circle a hundredth of an ångström across, and needs no shorter steps for it. */
function gyrate(p, B, h) {
  const om = p.q * B * PHYS.LOR * p.im, ph = om * h, vx = p.vx, vy = p.vy;
  const c = Math.cos(ph), sn = Math.sin(ph);
  let a, b; // sin(ph)/om and (1 − cos ph)/om, without cancellation for small ph
  if (Math.abs(ph) < 1e-5) { a = h; b = 0.5 * ph * h; } else { a = sn / om; b = 2 * Math.sin(0.5 * ph) ** 2 / om; }
  p.x += vx * a + vy * b; p.y += vy * a - vx * b;
  p.vx = vx * c + vy * sn; p.vy = vy * c - vx * sn;
}
/* Velocity Verlet (kick–drift–kick) with Boris rotations for the magnetic field, split symmetrically:
   A = ½kick, ½rotation, drift;  [new forces];  B = ½rotation, ½kick, then the Langevin heat bath.
   Each step is time-symmetric even when the step size changes, so energy does not drift. */
const _rb = [0, 0];
function rotateB(p, vx, vy, frac) { // the turned velocity in _rb
  const B = Bfield(p.x, p.y, p);
  if (B === 0) { _rb[0] = vx; _rb[1] = vy; return _rb; }
  const tt = p.q * B * PHYS.LOR * p.im * 0.5 * frac, s = 2 * tt / (1 + tt * tt);
  const vpx = vx + vy * tt, vpy = vy - vx * tt;
  _rb[0] = vx + vpy * s; _rb[1] = vy - vpx * s;
  return _rb;
}
function outerB(dt) {
  const gam = W.gamma, kT = PHYS.KB * W.T, h = 0.5 * dt;
  const c1 = Math.exp(-gam * dt), c2 = Math.sqrt(Math.max(0, 1 - c1 * c1));
  const hasB = hasBfield();
  const t = W.tool, heat = t && t.active && (t.type === 'heat' || t.type === 'pull');
  let hc1 = 1, hc2 = 0, hkT = 0, hR2 = 0, pullK = 0;
  if (heat) { // heat tool: local bath at its temperature; push/pull: atoms it moves are calmed to the bath temperature
    hc1 = Math.exp(-0.6 * dt); hc2 = Math.sqrt(1 - hc1 * hc1); hkT = PHYS.KB * (t.type === 'heat' ? t.T : W.T); hR2 = t.R * t.R;
    if (t.type === 'pull') pullK = 2 * Math.abs(t.s) / hR2; // (the trap's spring constant, eV/Å²)
  }
  const PI = partsSync(), n = W.parts.length;
  const DEAD = S.dead, RAD = S.rad, K = S.k, Z = S.Z, FAST = S.fast, VX = S.vx, VY = S.vy, FX = S.fx, FY = S.fy, GX = S.gx, GY = S.gy, IM = S.im, Q = S.q;
  const X = S.x, Y = S.y, FRESH = S.fresh, OBJ = S.obj;
  for (let j = 0; j < n; j++) {
    const i = PI[j];
    if (DEAD[i] === 1 || RAD[i] === 1) continue;
    const k = K[i];
    if (k === NUC && Z[i] === 0) continue;
    if (FRESH[i] === 1) { FRESH[i] = 0; continue; } // born during this step's events: velocity is already current
    const fast = FAST[i] === 1;
    if (fast && k !== NUC) continue; // ballistic electrons: moveFastLeptons
    let vx = VX[i], vy = VY[i];
    const im = IM[i];
    if (hasB && Q[i] !== 0 && (k === NUC || fast)) { rotateB(OBJ[i], vx, vy, h); vx = _rb[0]; vy = _rb[1]; }
    if (fast) { vx += h * FX[i] * im; vy += h * FY[i] * im; }
    else { vx += h * (FX[i] - GX[i]) * im; vy += h * (FY[i] - GY[i]) * im; }
    // heat bath (Langevin) on atoms, ions and nuclei: the reservoir is the surrounding matter. Free electrons
    // and beams are not coupled to it directly (they thermalize by collisions, as in a real gas discharge);
    // the bath's friction would otherwise also bind electrons artificially.
    const inTool = heat && k === NUC && (X[i] - t.x) * (X[i] - t.x) + (Y[i] - t.y) * (Y[i] - t.y) < hR2;
    if (gam > 0 && k === NUC && !(inTool && pullK)) { const sg = Math.sqrt(kT * im); vx = c1 * vx + c2 * sg * gauss(); vy = c1 * vy + c2 * sg * gauss(); }
    if (inTool) {
      let k1 = hc1, k2 = hc2;
      if (pullK) { // push/pull (its bath in place of the chamber's): damped about critically for the atom's own mass, 2√(k/m), so a uranium atom comes in as readily as a light one and nothing overshoots far; never less than before (0.6/tu up to 12 u)
        const g = Math.min(10, Math.max(0.6 * Math.min(1, 12 * im), 2 * Math.sqrt(pullK * im)));
        k1 = Math.exp(-g * dt); k2 = Math.sqrt(1 - k1 * k1);
      }
      const sg = Math.sqrt(hkT * im); vx = k1 * vx + k2 * sg * gauss(); vy = k1 * vy + k2 * sg * gauss();
    }
    VX[i] = vx; VY[i] = vy;
  }
}

/* Resizing the box. Growing, the walls jump out at once (a free expansion: nothing pushes on them). Shrinking, they
   sweep at once through the empty space down to the outermost particles, then move in like a piston (squeezing an
   insulated gas heats it), so the box can be any size without waiting for the walls. */
function moveWalls(dt) {
  const b = W.box, step = 0.6 * dt * 2;
  let ex = 0, ey = 0;
  for (const p of W.parts) { if (p.dead || p.rad) continue; const ax = Math.abs(p.x), ay = Math.abs(p.y); if (ax > ex) ex = ax; if (ay > ey) ey = ay; }
  const to = (cur, tgt, e) => (tgt >= cur ? tgt : Math.max(tgt, Math.min(cur - step, 2 * (e + 2))));
  const w1 = to(b.w, b.tw, ex), h1 = to(b.h, b.th, ey);
  b.uw = w1 < b.w ? -step / (2 * dt) : 0; b.uh = h1 < b.h ? -step / (2 * dt) : 0; // (the walls' own speed where they touch anything)
  b.w = w1; b.h = h1;
}
function walls(p) {
  if (p.dead || p.rad || (p.k === NUC && p.Z === 0)) return;
  const hw = W.box.w / 2, hh = W.box.h / 2;
  if (W.wall === 'wrap') {
    if (p.x < -hw) { p.x += W.box.w; p.ox += W.box.w; } else if (p.x > hw) { p.x -= W.box.w; p.ox -= W.box.w; }
    if (p.y < -hh) { p.y += W.box.h; p.oy += W.box.h; } else if (p.y > hh) { p.y -= W.box.h; p.oy -= W.box.h; }
    return;
  }
  if ((p.k === POS || p.anti) && W.wall === 'reflect' && (p.x < -hw || p.x > hw || p.y < -hh || p.y > hh)) { annihilateAtWall(p); return; }
  if (W.wall === 'open') { if (p.x < -hw || p.x > hw || p.y < -hh || p.y > hh) kill(p); return; }
  const uw = W.box.uw, uh = W.box.uh;
  if (!p.fast) { // soft walls handle slow particles; only rescue deep escapees, handing back their potential energy
    const m = 1.5;
    if (!(p.x < -hw - m || p.x > hw + m || p.y < -hh - m || p.y > hh + m)) return;
    const one = p.k === NUC && G.n ? new Set([p]) : null, k = wallK(p);
    const U0 = one ? localPE(one) : 0;
    let dW = 0; // the wall's own energy (used when the full potential energy is not at hand)
    if (p.x < -hw - m) { const d = -hw - p.x; p.x = -hw; dW += 0.5 * k * d * d; p.vx = Math.abs(p.vx); }
    else if (p.x > hw + m) { const d = p.x - hw; p.x = hw; dW += 0.5 * k * d * d; p.vx = -Math.abs(p.vx); }
    if (p.y < -hh - m) { const d = -hh - p.y; p.y = -hh; dW += 0.5 * k * d * d; p.vy = Math.abs(p.vy); }
    else if (p.y > hh + m) { const d = p.y - hh; p.y = hh; dW += 0.5 * k * d * d; p.vy = -Math.abs(p.vy); }
    const dE = one ? U0 - localPE(one) : dW, ke = 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy), k1 = Math.max(0, ke + dE);
    if (ke > 0) { const f = Math.sqrt(k1 / ke); p.vx *= f; p.vy *= f; }
    return;
  }
  if (p.x < -hw) { p.x = -hw + Math.min(W.box.w, -hw - p.x); p.vx = -2 * uw - p.vx; if (p.vx < 0) p.vx = -p.vx; }
  else if (p.x > hw) { p.x = hw - Math.min(W.box.w, p.x - hw); p.vx = 2 * uw - p.vx; if (p.vx > 0) p.vx = -p.vx; }
  if (p.y < -hh) { p.y = -hh + Math.min(W.box.h, -hh - p.y); p.vy = -2 * uh - p.vy; if (p.vy < 0) p.vy = -p.vy; }
  else if (p.y > hh) { p.y = hh - Math.min(W.box.h, p.y - hh); p.vy = 2 * uh - p.vy; if (p.vy > 0) p.vy = -p.vy; }
}

/* Periodic housekeeping: π-bond formation between adjacent radicals, field ionization, electron shedding. */
function housekeeping() {
  for (const bd of W.bonds.slice()) {
    const a = bd.a, b = bd.b;
    if (bd.order < 3 && a.cap - a.used > 0 && b.cap - b.used > 0 && covalentOK(a, b)) {
      // released: the change in bond energy at the atoms' present spacing (the rest becomes the new, shorter
      // bond's vibration as the atoms close in)
      const set = setOf(molecule(a)), sn = snapshot(set), PE0 = localPE(set);
      setOrder(bd, bd.order + 1);
      const rel = PE0 - localPE(set);
      if (rel >= 0) dumpHeat(rel, a, b);
      else if (kickPair(a, b, rel) > rel + 1e-6) restoreSnap(sn);
    }
  }
  const E = Math.hypot(W.Ex, W.Ey);
  if (E > 0.3) {
    for (const p of W.parts) {
      if (p.dead || p.k !== NUC || p.ne === 0) continue;
      const ie = ionE(p.Z, p.ne), Ec = ie * ie / (4 * PHYS.KE * Math.max(1, p.q + 1));
      if (E > Ec && rnd() < 0.2) {
        W.count.ionize++;
        ejectElectron(p, 0.5, -W.Ex / E, -W.Ey / E);
        log('em', `Field ionization: ${p.el.sym} stripped by ${E.toFixed(2)} V/Å (needs ${Ec.toFixed(2)} V/Å)`);
      }
    }
  }
  for (const p of W.parts) if (!p.dead && p.k === NUC && p.ne > p.Z) stabilize(p);
}

/* Local temperature estimate per atom (for incandescence and Curie behaviour). */
function localTemps() {
  const PI = partsSync(), n = W.parts.length, DEAD = S.dead, K = S.k, M = S.m, VX = S.vx, VY = S.vy, OBJ = S.obj;
  for (let j = 0; j < n; j++) {
    const i = PI[j];
    if (DEAD[i] === 1 || K[i] !== NUC) continue;
    const ke = 0.5 * M[i] * (VX[i] * VX[i] + VY[i] * VY[i]);
    const Tk = ke / PHYS.KB, p = OBJ[i];
    p.tLocal = p.tLocal ? 0.9 * p.tLocal + 0.1 * Tk : Tk;
  }
}

function forcesNoEvents() { _noEv = true; computeForces(); _noEv = false; }
/* All forces at the end of a step; free-electron events were already handled on the inner steps. */
function outerForces() { _lepEvOff = true; computeForces(); _lepEvOff = false; }
/* Did any particle change mode (MD, ballistic, radiation) since the force lists were made? */
function listsStale() { return _flagGen !== _flagGenForces; } // (a dead, fast or rad flag changed since the lists were made)
/* Where a step's time goes, summed while PROF.on (the Settings benchmark reads it): the force passes (and inside them the
   kernels' share and the wait for the worker threads), the heat bath, the integrator loops, and the rest. */
const PROF = { on: false, steps: 0, forces: 0, kernels: 0, wait: 0, bath: 0, integ: 0, total: 0, passes: 0 };
function profReset() { PROF.steps = 0; PROF.forces = 0; PROF.kernels = 0; PROF.wait = 0; PROF.bath = 0; PROF.integ = 0; PROF.total = 0; PROF.passes = 0; }
function step(dt) {
  if (PROF.on) return stepProfiled(dt);
  return stepPlain(dt);
}
function stepProfiled(dt) {
  const t0 = performance.now(), f0 = _tForces, k0 = _tKernels, w0 = _tWait, b0 = _tBath, i0 = _tInteg, p0 = _nPasses;
  _profOn = true;
  const r = stepPlain(dt);
  _profOn = false;
  PROF.steps++; PROF.total += performance.now() - t0; PROF.forces += _tForces - f0; PROF.kernels += _tKernels - k0; PROF.wait += _tWait - w0; PROF.bath += _tBath - b0; PROF.integ += _tInteg - i0; PROF.passes += _nPasses - p0;
  return r;
}
let _profOn = false, _tForces = 0, _tKernels = 0, _tWait = 0, _tBath = 0, _tInteg = 0, _nPasses = 0;
function stepPlain(dt) {
  W.step++;
  threadsPrewake();
  const id0 = W.nextId; // particles born during this step start flying in the next one
  if (W.box.tw !== W.box.w || W.box.th !== W.box.h) moveWalls(dt); else { W.box.uw = 0; W.box.uh = 0; }
  // particles added from outside, or switched between MD and ballistic flight at the end of the last step
  if (W.fSpawn !== W.spawned || listsStale()) { _noEv = true; computeForces(); _noEv = false; }
  let tp = _profOn ? performance.now() : 0;
  if (!integrateA(dt)) { // (the threads take the plain case: no magnetic field, no free electrons)
    outerA(dt);
    innerSteps(dt); // everything in MD drifts here; free electrons take their own short steps
  }
  if (_profOn) { const t = performance.now(); _tInteg += t - tp; }
  outerForces();
  const st0 = W.spawned + W.topo + W.dirty - _undone;
  processEvents();
  // events that moved atoms, changed bonds or species, or created particles: forces must be current
  if (W.spawned + W.topo + W.dirty - _undone !== st0) { _noEv = true; computeForces(); _noEv = false; }
  W.fSpawn = W.spawned;
  if (_profOn) tp = performance.now();
  outerB(dt);
  if (_profOn) _tBath += performance.now() - tp;
  if (_nFastLep > 0 || _flagGen !== _flagGenForces) moveFastLeptons(dt, id0); // (none were ballistic when the lists were made, and no flag has changed since)
  const kT = PHYS.KB * W.T, c1 = Math.exp(-W.gamma * dt), c2 = Math.sqrt(Math.max(0, 1 - c1 * c1));
  let nRad = 0;
  {
    const PI = partsSync(), n = W.parts.length, DEAD = S.dead, ID = S.id, K = S.k, Z = S.Z, RAD = S.rad, OBJ = S.obj, X = S.x, Y = S.y, OX = S.ox, OY = S.oy;
    for (let j = 0; j < n; j++) {
      const i = PI[j];
      if (DEAD[i] === 1 || ID[i] >= id0) continue;
      if (K[i] === NUC && Z[i] === 0) moveNeutron(OBJ[i], dt, c1, c2, kT);
      else if (RAD[i] === 1) { OX[i] = X[i]; OY[i] = Y[i]; moveRad(OBJ[i], dt); nRad++; }
    }
  }
  moveExos(dt);
  if (nRad >= 2) beamCollisions(id0);
  if (W.collider) { rampRing(); if (W.step % 16 === 0) colliderRefill(); }
  {
    const PI = partsSync(), DEAD = S.dead, K = S.k, Z = S.Z, RAD = S.rad, FAST = S.fast, BALL = S.ballistic, OBJ = S.obj, X = S.x, Y = S.y, VX = S.vx, VY = S.vy, M = S.m;
    const hw = W.box.w / 2, hh = W.box.h / 2, wrap = W.wall === 'wrap';
    for (let j = 0; j < W.parts.length; j++) { // (particles can be born within: the count is read each time)
      const i = PI[j];
      if (DEAD[i] === 1 || RAD[i] === 1) continue;
      const k = K[i];
      if (k === NUC && Z[i] === 0) continue;
      if (FAST[i] === 1) { if (BALL[i] === 1 && k !== NUC) continue; } // flew and collided in moveFastLeptons
      else if (k === NUC && !wrap) { // an atom inside the box, going at an atom's pace: walls and updateFast would do nothing
        const x = X[i], y = Y[i];
        if (x > -hw && x < hw && y > -hh && y < hh && VX[i] * VX[i] + VY[i] * VY[i] <= V_FAST_ON * V_FAST_ON) {
          const p = OBJ[i];
          if (p.trk) { extendTrack(p); if (!p.trkKeep && 0.5 * M[i] * (VX[i] * VX[i] + VY[i] * VY[i]) < 200) p.trk = null; }
          continue;
        }
      }
      const p = OBJ[i];
      walls(p);
      updateFast(p);
      if (p.fast && !p.dead) fastEncounters(p);
      if (p.trk && !p.rad) {
        extendTrack(p);
        if (!p.trkKeep && 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy) < 200) p.trk = null;
      }
    }
  }
  fastFastNuclear();
  for (const src of W.sources) {
    if (src.count !== undefined && src.count <= 0) continue; // a bunch, all injected
    src.acc += src.rate * dt;
    while (src.acc >= 1 && !(src.count <= 0)) {
      src.acc -= 1;
      if (src.count !== undefined) src.count--;
      // a little spread in where and which way (a real beam's emittance)
      const j = src.jitter || 0, ox = j ? (rnd() - 0.5) * j * -src.uy : 0, oy = j ? (rnd() - 0.5) * j * src.ux : 0, da = j ? (rnd() - 0.5) * 0.004 * j : 0;
      const ux = src.ux * Math.cos(da) - src.uy * Math.sin(da), uy = src.ux * Math.sin(da) + src.uy * Math.cos(da);
      const p = fireSpec(src.spec, src.x + ox, src.y + oy, ux, uy, src.KE, !!src.beam);
      if (p && src.count !== undefined && src.rate > 0) { // (a bunch's particles evenly spaced, each placed as far as it has come since it left, on the beam line even where the last one is close)
        const sp = p.rad ? p.sp : Math.hypot(p.vx, p.vy), t = Math.min(src.acc / src.rate, 1.5 / Math.max(sp, 1e-9));
        p.x = src.x + ox + ux * sp * t; p.y = src.y + oy + uy * sp * t; p.ox = p.x; p.oy = p.y;
      }
      if (p) {
        p.beam = src.beam || true;
        if (src.kick) { p.injKick = src.kick; p.kickIn = false; } // (the kicker fires for it as it comes by)
        if (src.track && !p.trk) { startTrack(p); p.trkKeep = true; }
      }
    }
  }
  if (W.step % 25 === 0) housekeeping();
  if (W.step % 10 === 0) localTemps();
  W.t += dt;
  if (W.flights.length) landFlights();
  // drop dead particles
  if (_nDead > 0 && (W.step % 4 === 0 || W.parts.length > 3000)) {
    _nDead = 0;
    let j = 0; const ps = W.parts, PI = partsSync(), DEAD = S.dead, n = ps.length;
    for (let i = 0; i < n; i++) { const si = PI[i]; if (DEAD[si] === 0) { if (j !== i) { PI[j] = si; ps[j] = ps[i]; } j++; } else freeSlot(ps[i]); }
    if (j !== n) { ps.length = j; _piN = j; }
  }
  return dt;
}

/* Slow motion after a nuclear event. Its products (α particles, fragments, neutrons, β electrons) cross the
   box in a few femtoseconds, i.e. within one frame. Time eases down until the fastest of them moves about 2%
   of the box per frame, then eases back once they have left or slowed, at most ~3 s of real time later.
   Everything slows together; nothing is faked. */
function slowFactor(realDt) {
  const h = W.slowHold ? holdFactor(realDt) : 1;
  return Math.min(h, W.flights.length ? lightSlow() : 1, eventSlow(realDt));
}
/* Slow motion on demand: time eases down until the fastest particles move about 2% of the box per frame (at the
   setup's normal speed; the speed buttons still scale it), and always to an eighth of normal at least. With slow
   motion for nuclear events off, what nuclear events send flying (and what it knocks loose) is left out. */
function holdFactor(realDt) {
  let v = 0;
  const win = !W.slowmo && W.nucWin ? W.nucWin : null;
  for (const p of W.parts) {
    if (p.dead) continue;
    const sp = p.rad ? p.sp : Math.hypot(p.vx, p.vy);
    if (p.nucProd && !p.rad && 0.5 * p.m * sp * sp < 10) p.nucProd = false; // (once it has slowed down it counts again)
    if (win && (p.nucProd || (!p.beam && p.born >= win.t0 && p.born <= win.t1))) continue;
    if (sp > v) v = sp;
  }
  for (const s of W.sources) { // what an injector is about to send in counts already
    if (s.count <= 0 || !(s.KE > 0)) continue;
    const k = s.spec.kind, m = k === 'gamma' ? 0 : k === 'e' || k === 'pos' ? PHYS.ME : (s.spec.A || 1), g = m ? 1 + s.KE / (m * AMU_EV) : Infinity;
    v = Math.max(v, PHYS.C * Math.sqrt(1 - 1 / (g * g)));
  }
  const want = clamp(v > 0 ? (W.holdFrac || 0.02) * Math.min(W.box.w, W.box.h) / (v * (W.baseSpf || W.simPerFrame)) : 1, 1e-6, 1 / 8);
  const H = W.hold || (W.hold = { f: want });
  const lf = Math.log(H.f), lw = Math.log(want);
  H.f = lw < lf ? want : Math.exp(lf + (lw - lf) * Math.min(1, realDt * 3));
  return H.f;
}
function eventSlow(realDt) {
  const S = W.slow;
  if (!S) return 1;
  const age = W.rt - S.t0;
  let want = 1;
  if (S.on && W.slowmo && age < 3) {
    let v = 0;
    for (const p of W.parts) {
      if (p.dead || p.born < S.t0 - 1e-9 || (p.k !== NUC && !p.rad)) continue; // stray slow electrons don't hold time up
      v = Math.max(v, p.rad ? p.sp : Math.hypot(p.vx, p.vy));
    }
    want = v > 0 ? clamp(0.02 * Math.min(W.box.w, W.box.h) / (v * (W.baseSpf || W.simPerFrame)), 1 / 5000, 1) : 1; // (at the setup's normal speed: the speed controls still scale it)
    if (want > 0.99 && age > 0.25) S.on = false;
  } else S.on = false;
  // drop at once (the products must not get away in the first frame), recover gently (in logarithmic time)
  const lf = Math.log(S.f || 1), lw = Math.log(want);
  S.f = lw < lf ? want : Math.exp(lf + (lw - lf) * Math.min(1, realDt * 3));
  if (!S.on && S.f > 0.97) { W.slow = null; return 1; }
  return S.f;
}
/* Advance one rendered frame: physics steps within a time budget, then radioactive decay over the same stretch of
   time. There is one clock, as in nature: at real rates (W.warp = 1) only nuclei that live less than about a
   picosecond decay while you watch the femtosecond motion. W.warp makes every decay that many times faster,
   which keeps their order and relative timing true. */
function simFrame(realDt, budgetMs) {
  const t0 = performance.now();
  let simAdv = 0, steps = 0, cut = false;
  const slow = slowFactor(realDt);
  const target = W.simPerFrame * slow;
  while (simAdv < target - 1e-9) {
    // particles added from outside (tools, setups): the step size must see their forces and contacts first
    if (W.fSpawn !== W.spawned) { forcesNoEvents(); W.fSpawn = W.spawned; }
    W.dt = Math.min(chooseDt(), Math.max(DT_MIN, target - simAdv)); // slow motion: never overshoot the frame
    simAdv += step(W.dt); steps++;
    if (W.slow && W.slow.fresh) { W.slow.fresh = false; break; } // an event just started slow motion: stop here
    if (performance.now() - t0 > budgetMs) { cut = true; break; }
  }
  W.rt += realDt;
  // chips keep the pace the simulation is set to, in real time, even when a crowded box makes the atoms (and the frames)
  // fall behind it: their time is warped anyway (a flash pulse takes 10 µs)
  if (W.chips.length) chipsTick((cut ? target * clamp(realDt * 60, 1, 6) : simAdv) * PHYS.TU_S, realDt);
  const dtNuc = W.decayOn ? simAdv * PHYS.TU_S * W.warp : 0;
  W.tNuc += dtNuc;
  decayStep(dtNuc);
  if (_glowing) { _glowing = false; for (const p of W.parts) if (p.glow > 0) { p.glow = Math.max(0, p.glow - realDt * 2.5); if (p.glow > 0) _glowing = true; } }
  return { steps, simAdv, target, slow };
}

/* ------------------------------------------------------------------ measurements */
function measure() {
  // Temperature of the heavy particles (ions, atoms); electrons are reported separately. A few
  // ballistic particles (recoils, fragments) are not yet thermal and are left out, unless most of the
  // sample is ballistic, as in a fusion plasma.
  let ke = 0, n = 0, keF = 0, nF = 0, keE = 0, nE = 0, ions = 0, atoms = 0;
  const g = W.grab, held = g && g.p && !g.p.dead ? new Set(g.mol || [g.p]) : null; // (what the Grab tool is dragging moves by hand, not by heat)
  for (const p of W.parts) {
    if (p.dead || p.rad || p.beam || (p.fast && p.k !== NUC) || (held && held.has(p))) continue;
    if (p.k === NUC && p.Z === 0) continue;
    const k = 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy);
    if (p.k === NUC) { if (p.fast) { keF += k; nF++; } else { ke += k; n++; } atoms++; if (p.q > 0) ions++; }
    else { keE += k; nE++; }
  }
  if (nF > n) { ke += keF; n += nF; }
  const T = n ? ke / (n * PHYS.KB) : nE ? keE / (nE * PHYS.KB) : 0;
  return { T, Te: nE ? keE / (nE * PHYS.KB) : 0, n: n + nE, ionFrac: atoms ? ions / atoms : 0, freeE: W.nE, atoms };
}

/* ------------------------------------------------------------------ world construction helpers */
function clearWorld() {
  dropParts(W.parts); W.parts.length = 0; _piParts = null; _farMetalSeen = false; _nDead = 0; _flagGen++; W.bonds.length = 0; W.evq.length = 0; W.rays.length = 0; W.flights.length = 0; W.chips.length = 0; W.mem = null; W.tracks.length = 0; W.exo.length = 0;
  W.flashes.length = 0; W.log.length = 0; W.magnets.length = 0; W.sources.length = 0; W.zones.length = 0; W.collider = null; W.holdFrac = 0; W.nE = 0; W.t = 0; W.tNuc = 0; W.step = 0;
  W.events.length = 0; W.evRecent.length = 0; W.slow = null; W.nucWin = null; W.made = null;
  W.grab = null; W.topo++;
  for (const k in W.count) W.count[k] = 0;
  for (const k in W.ledger) W.ledger[k] = 0;
  W.hist = { t: [], T: [], ion: [], rad: [] };
  _rxCache.clear();
}
function thermalV(m, T) { const s = Math.sqrt(PHYS.KB * T / m); return [s * gauss(), s * gauss()]; }
function addAtom(sym, x, y, opts = {}) {
  const Z = typeof sym === 'number' ? sym : SYM2Z[sym];
  const A = opts.A || COMMON_A[Z];
  const N = Math.max(0, A - Z);
  const ne = opts.bare ? 0 : opts.anti ? Z + (opts.charge || 0) : Z - (opts.charge || 0);
  const p = addNuc(Z, N, ne, x, y, 0, 0, !!opts.anti);
  const [vx, vy] = thermalV(p.m, opts.T !== undefined ? opts.T : W.T);
  p.vx = vx; p.vy = vy;
  updateFast(p);
  return p;
}
/* Tiny objects, and anything else as big (Claude's lattices, large built molecules), go down one at a time, as drawn. */
function molWhole(M) { return !!M && (M.cat === 'objects' || M.atoms.length > 90); }
function addMolecule(key, x, y, rot = 0, T) {
  const M = MOLECULES[key];
  if (!M) return [];
  const c = Math.cos(rot), s = Math.sin(rot);
  let cx = 0, cy = 0; for (const a of M.atoms) { cx += a[1]; cy += a[2]; } cx /= M.atoms.length; cy /= M.atoms.length;
  const atoms = M.atoms.map(([sym, ax, ay, q, A]) => { // (A: the mass number of an isotope other than the usual one)
    const dx = ax - cx, dy = ay - cy;
    const p = addAtom(sym, x + dx * c - dy * s, y + dx * s + dy * c, { charge: q || 0, A: A || 0, T: 0 });
    return p;
  });
  for (const [i, j, o] of M.bonds) addBond(atoms[i], atoms[j], o);
  // whole-molecule thermal motion
  let mt = 0; for (const a of atoms) mt += a.m;
  const [vx, vy] = thermalV(mt, T !== undefined ? T : W.T);
  for (const a of atoms) { a.vx = vx; a.vy = vy; }
  if (CHIP_LAYOUT[key]) chipAdd(key, atoms); // (a transistor, gate or memory cell is wired up: chips.js)
  return atoms;
}
function spark(x, y, R, E) {
  const ps = [];
  nearby(x, y, R, (p) => { if (p.k === NUC && !p.dead) ps.push(p); });
  if (ps.length < 2) { flash(x, y, [255, 220, 120], R, 0.4); return; }
  const each = E / ps.length;
  if (each > 0.5 * radThreshold(false)) { // fast: the atoms pair off at random, each pair taking its share (an odd one out leaves its share to the last pair)
    for (let k = ps.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [ps[k], ps[j]] = [ps[j], ps[k]]; }
    const np = Math.floor(ps.length / 2);
    for (let k = 0; k < np; k++) sparkApart(ps[2 * k], ps[2 * k + 1], (k === np - 1 && ps.length % 2 ? 3 : 2) * each);
  } else for (let k = 0; k < ps.length; k++) {
    const a = ps[k], b = ps[(k + 1 + Math.floor(rnd() * (ps.length - 1))) % ps.length];
    kickPair(a, b, each);
  }
  flash(x, y, [255, 220, 120], R, 0.5);
  log('tool', `Spark: ${fmtE(E)} dumped into ${ps.length} atoms`);
}

/* A spark too strong for the ordinary dynamics (keV and up an atom): the pair flies apart as fast particles with equal
   and opposite momenta (relativistic, so nothing passes light speed), sharing E between them. */
function sparkApart(a, b, E) {
  if (a === b || a.dead || b.dead || a.rad || b.rad) return;
  const ma = a.m * AMU_EV, mb = b.m * AMU_EV, pOf = (K, m) => Math.sqrt(K * K + 2 * K * m);
  let lo = 0, hi = E;
  for (let i = 0; i < 60; i++) { const mid = 0.5 * (lo + hi); if (pOf(mid, ma) < pOf(E - mid, mb)) lo = mid; else hi = mid; }
  const th = rnd() * 2 * Math.PI, ux = Math.cos(th), uy = Math.sin(th);
  setMotion(a, lo, ux, uy); setMotion(b, E - lo, -ux, -uy);
}

/* ------------------------------------------------------------------ spawning (used by tools and presets) */
/* spec: { kind: 'e' | 'pos' | 'n' | 'nuc' | 'atom' | 'mol' | 'gamma', Z, A, charge, bare, mol } */
function spawnSpec(spec, x, y, T) {
  if (W.parts.length >= MAX_PARTS) return [];
  const temp = T === undefined ? W.T : T;
  switch (spec.kind) {
    case 'e': case 'pos': {
      const [vx, vy] = thermalV(PHYS.ME_SIM, temp);
      return [addLepton(spec.kind === 'e' ? ELEC : POS, x, y, vx, vy)];
    }
    case 'n': {
      const p = addNuc(0, 1, 0, x, y); const [vx, vy] = thermalV(p.m, temp); p.vx = vx; p.vy = vy;
      return [p];
    }
    case 'nuc': {
      const p = addNuc(spec.Z, spec.A - spec.Z, 0, x, y); const [vx, vy] = thermalV(p.m, temp); p.vx = vx; p.vy = vy; updateFast(p);
      return [p];
    }
    case 'atom': return [addAtom(spec.Z, x, y, { A: spec.A, charge: spec.charge || 0, bare: !!spec.bare, anti: !!spec.anti, T: temp })];
    case 'pbar': case 'nbar': { // an antiproton, or an antineutron (no charge: it annihilates on meeting a nucleus, or decays to p̄ e⁺ ν)
      const p = spec.kind === 'pbar' ? addNuc(1, 0, 0, x, y, 0, 0, true) : addNuc(0, 1, 0, x, y, 0, 0, true);
      const [vx, vy] = thermalV(p.m, temp); p.vx = vx; p.vy = vy; updateFast(p);
      return [p];
    }
    case 'mol': return addMolecule(spec.mol, x, y, molWhole(MOLECULES[spec.mol]) ? 0 : rnd() * Math.PI * 2, temp); // (tiny objects go down as drawn)
  }
  return [];
}
/* ---- placement guard ----
   Atoms put down by hand or by a setup must not land inside one another: two overlapping electron clouds
   hold tens to hundreds of eV, which would go off like a small bomb. New particles are slid to the nearest
   clear spot instead (or not placed at all when there is no room). */
function keepR(p) {
  if (p.k !== NUC) return 0;
  if (p.Z === 0) return 0.2;
  if (p.ne === 0) return 0.3;
  return 0.35 * (p.ljR || 2.5);
}
/* A grid of the atoms for crowdedAt in a full box (rebuilt whenever anything has moved or been added): placing then
   costs a look at the neighbourhood, not at every particle. */
let _crowd = null;
function crowdGrid() {
  const key = W.step + ':' + W.parts.length + ':' + W.spawned + ':' + W.dirty + ':' + W.box.w;
  if (_crowd && _crowd.key === key) return _crowd;
  const cs = 2.5, cells = new Map();
  for (const o of W.parts) {
    if (o.dead || o.k !== NUC || o.Z === 0) continue;
    const k = Math.floor(o.x / cs) * 65536 + Math.floor(o.y / cs), c = cells.get(k);
    if (c) c.push(o); else cells.set(k, [o]);
  }
  return (_crowd = { key, cs, cells });
}
function crowdedAt(group, dx, dy, skip) {
  if (W.parts.length > 1200 && W.wall !== 'wrap') { // (periodic walls: the plain check, which wraps distances)
    const { cs, cells } = crowdGrid();
    for (const a of group) {
      if (a.dead || a.k !== NUC || a.Z === 0) continue;
      const ax = a.x + dx, ay = a.y + dy, ra = keepR(a), cx = Math.floor(ax / cs), cy = Math.floor(ay / cs), n = Math.ceil((ra + 2) / cs);
      for (let i = cx - n; i <= cx + n; i++) for (let j = cy - n; j <= cy + n; j++) {
        const c = cells.get(i * 65536 + j); if (!c) continue;
        for (const o of c) {
          if (o.dead || skip.has(o)) continue;
          const ex = o.x - ax, ey = o.y - ay, lim = ra + keepR(o);
          if (ex * ex + ey * ey < lim * lim) return true;
        }
      }
    }
    return false;
  }
  for (const a of group) {
    if (a.dead || a.k !== NUC || a.Z === 0) continue;
    const ax = a.x + dx, ay = a.y + dy, ra = keepR(a);
    for (const o of W.parts) {
      if (o.dead || o.k !== NUC || o.Z === 0 || skip.has(o)) continue;
      const [ex, ey] = minImg(o.x - ax, o.y - ay), lim = ra + keepR(o);
      if (ex * ex + ey * ey < lim * lim) return true;
    }
  }
  return false;
}
/* Slide a freshly made group of particles to the nearest spot clear of everything else (golden-angle spiral
   out to maxR Å). Returns false, leaving it in place, if there is no room. */
function placeClear(group, maxR = 8) {
  const skip = new Set(group);
  if (!crowdedAt(group, 0, 0, skip)) return true;
  const hw = W.box.w / 2 - 0.4, hh = W.box.h / 2 - 0.4, wrap = W.wall === 'wrap';
  for (let k = 1; k < 600; k++) {
    const rr = 0.3 * Math.sqrt(k), th = k * 2.39996;
    if (rr > maxR) break;
    const dx = rr * Math.cos(th), dy = rr * Math.sin(th);
    if (!wrap && !group.every(a => Math.abs(a.x + dx) < hw && Math.abs(a.y + dy) < hh)) continue;
    if (!crowdedAt(group, dx, dy, skip)) {
      for (const a of group) { a.x += dx; a.y += dy; }
      W.dirty++;
      return true;
    }
  }
  return false;
}
/* A group put down past a wall is moved in, its whole extent where it fits: left in the wall it would be driven back
   out with the wall's stored energy (½k·d², about a keV from 10 Å deep), enough to strip an atom bare. Periodic walls
   wrap it round instead. */
function keepInside(group) {
  if (!group.length) return;
  const bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2;
  if (W.wall === 'wrap') {
    for (const a of group) { a.x = ((a.x + hw) % bw + bw) % bw - hw; a.y = ((a.y + hh) % bh + bh) % bh - hh; a.ox = a.x; a.oy = a.y; }
    return;
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const a of group) { x0 = Math.min(x0, a.x); x1 = Math.max(x1, a.x); y0 = Math.min(y0, a.y); y1 = Math.max(y1, a.y); }
  const m = W.wall === 'open' ? 2 : 0.5, shift = (lo, hi, h) => (hi - lo > 2 * (h - m) ? -(lo + hi) / 2 : lo < -h + m ? -h + m - lo : hi > h - m ? h - m - hi : 0);
  const dx = shift(x0, x1, hw), dy = shift(y0, y1, hh);
  if (dx || dy) { for (const a of group) { a.x += dx; a.y += dy; a.ox += dx; a.oy += dy; } W.dirty++; }
}
/* Spawn inside the walls and keep clear; particles with no room are removed again. (free: a collider's injector,
   left where it is.) */
function spawnClear(spec, x, y, T, free) {
  const ps = spawnSpec(spec, x, y, T);
  if (!free) keepInside(ps);
  if (ps.length && !placeClear(ps)) { for (const p of ps) kill(p); return []; }
  return ps;
}
/* After a setup is built: separate anything that was put down overlapping. */
function settleOverlaps() {
  const done = new Set();
  for (let pass = 0; pass < 3; pass++) {
    let moved = 0;
    done.clear();
    for (const p of W.parts) {
      if (p.dead || p.k !== NUC || p.Z === 0 || done.has(p)) continue;
      const g = molecule(p);
      for (const a of g) done.add(a);
      if (crowdedAt(g, 0, 0, new Set(g))) { placeClear(g, 12); moved++; }
    }
    if (!moved) break;
  }
}
/* Launch a projectile with kinetic energy KE (eV) along (ux, uy). */
function fireSpec(spec, x, y, ux, uy, KE, free) {
  if (spec.kind === 'gamma') { emitPhoton(x, y, KE, ux, uy); return null; }
  const ps = spawnClear(spec, x, y, 0, free);
  if (!ps.length) return null;
  if (ps.length === 1) { setMotion(ps[0], KE, ux, uy); if (!ps[0].trk && KE > 50) startTrack(ps[0]); return ps[0]; }
  let mt = 0; for (const a of ps) mt += a.m;
  const v = Math.sqrt(2 * KE / mt);
  for (const a of ps) { a.vx = v * ux; a.vy = v * uy; updateFast(a); }
  return ps[0];
}
function eraseAt(x, y, R) {
  let n = 0;
  const R2 = R * R;
  for (const p of W.parts) {
    if (p.dead) continue;
    const dx = p.x - x, dy = p.y - y;
    if (dx * dx + dy * dy < R2) { kill(p); n++; }
  }
  return n;
}

/* ------------------------------------------------------------------ direct manipulation from the inspector */
/* These are external work done by the user (like a laser or an electron gun), so they don't conserve energy. */
function userIonize(p) {
  if (!p || p.dead || p.k !== NUC || p.ne <= 0) return false;
  const before = speciesLabel(p);
  p.ne--; refresh(p); enforceValence(p, null); relink([p]);
  const th = rnd() * 2 * Math.PI, ux = Math.cos(th), uy = Math.sin(th), off = (p.rd || 0.4) + 1.2;
  const e = addLepton(p.anti ? POS : ELEC, p.x + ux * off, p.y + uy * off);
  setMotion(e, 1, ux, uy, p.vx, p.vy); e.hit = p.id;
  log('tool', `${p.anti ? 'Positron' : 'Electron'} removed: ${before} → ${speciesLabel(p)} + ${p.anti ? 'e⁺' : 'e⁻'}`);
  return true;
}
function userAddElectron(p) {
  if (!p || p.dead || p.k !== NUC || p.Z === 0 || p.ne >= p.Z + maxExtraElectrons(p.Z)) return false;
  const before = speciesLabel(p);
  p.ne++; refresh(p); enforceValence(p, null); relink([p]);
  log('tool', `${p.anti ? 'Positron' : 'Electron'} added: ${before} + ${p.anti ? 'e⁺' : 'e⁻'} → ${speciesLabel(p)}`);
  return true;
}

/* ------------------------------------------------------------------ diagnostics */
/* Total energy using exactly the same potentials as the forces (for testing energy conservation). */
function totalEnergy() {
  let ke = 0, pe = 0, internal = 0;
  const md = [];
  const kTm = PHYS.KB * Math.max(W.T, 1), mags = W.magnets.length > 0;
  for (const p of W.parts) {
    if (p.dead) continue;
    ke += p.rad ? p.KE : 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy);
    internal += internalE(p);
    if (!(p.k === NUC && p.Z === 0) && !p.rad && !p.fast) { md.push(p); if (mags) pe += magU(p, kTm); }
  }
  for (const o of W.exo) if (!o.dead) ke += o.KE; // unstable particles in flight (their rest mass is in the nuclear ledger)
  for (let i = 0; i < md.length; i++) for (let j = i + 1; j < md.length; j++) {
    const a = md[i], b = md[j];
    const [dx, dy] = minImg(b.x - a.x, b.y - a.y), r2 = dx * dx + dy * dy, r = Math.sqrt(r2);
    if (a.k === NUC && b.k === NUC) {
      if (r >= RC) { // only metallic cohesion reaches farther
        if (a.isMetal && b.isMetal && a.ne > 0 && b.ne > 0 && !opp(a, b) && r < 1.05 * (a.mR + b.mR) && !(a.mol !== 0 && a.mol === b.mol && a.excl && a.excl.has(b.id))) pe += metalV(a, b, r);
        continue;
      }
      if (a.mol !== 0 && a.mol === b.mol && a.excl && a.excl.has(b.id)) continue;
      pe += nucPairV(a, b, r2);
    } else if (a.k === NUC || b.k === NUC) {
      if (r >= RC) continue;
      const A = a.k === NUC ? a : b, L = A === a ? b : a;
      const qa = A.q;
      if (qa) pe += PHYS.KE * L.q * qa * (1 / Math.sqrt(r2 + A.sEN) - csh(A, L, A.sEN));
    } else {
      if (r >= RC) continue;
      pe += PHYS.KE * a.q * b.q * (1 / Math.sqrt(r2 + 0.04) - csh(a, b, 0.04));
    }
  }
  // long-range part (as in computeForces)
  const ch = md.filter(p => p.k !== NUC || Math.abs(p.q) >= 1);
  if (_lrOn) {
    for (let i = 0; i < ch.length; i++) for (let j = i + 1; j < ch.length; j++) {
      const a = ch[i], b = ch[j], r = Math.hypot(b.x - a.x, b.y - a.y);
      if (r < RC) continue;
      pe += PHYS.KE * qx(a, b) * qx(b, a) / r;
    }
  }
  for (const bd of W.bonds) pe += -bd.D - bd.Ef + morseV(bd, dist(bd.a, bd.b));
  for (const p of md) if (p.bonds.length >= 2) pe += angleEnergy(p);
  if (W.wall === 'reflect') {
    const hw = W.box.w / 2, hh = W.box.h / 2;
    for (const p of md) {
      if (p.k !== NUC) continue; // free electrons: hard walls
      const k = wallK(p);
      if (p.x > hw) pe += 0.5 * k * (p.x - hw) ** 2; else if (p.x < -hw) pe += 0.5 * k * (-hw - p.x) ** 2;
      if (p.y > hh) pe += 0.5 * k * (p.y - hh) ** 2; else if (p.y < -hh) pe += 0.5 * k * (-hh - p.y) ** 2;
    }
  }
  return { ke, pe, internal, esc: W.ledger.escaped, total: ke + pe + internal + W.ledger.escaped };
}
wasmLoadModule(); // (the kernel module, now that its constants exist to be checked)
