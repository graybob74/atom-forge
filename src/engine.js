'use strict';
/* ============================================================================
   Atom Forge — simulation engine
   Classical molecular dynamics on a femtosecond clock, plus rule-based quantum
   events (electron capture/ionization, bonding, reactions, nuclear processes).
   ========================================================================== */

const NUC = 0, ELEC = 1, POS = 2;          // particle kinds (NUC covers nuclei, atoms, ions, neutrons)
let RC = 6, RC2 = RC * RC;                 // short-range cutoff (Å); Settings → Experimental → Longer force reach sets 9 or 12 (setCutoff)
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
  if (q < 1 || p.ne + 1 > zChem(p)) return SOFT_EN;
  const ie = ionE(zChem(p), p.ne + 1);
  if (!(ie > 0)) return SOFT_EN;
  return Math.min(9, Math.max(0.02, Math.pow(PHYS.KE * q / ie, 2)));
}
const V_FAST_ON = 25, V_FAST_OFF = 18;     // ballistic mode thresholds (Å/tu)
/* (1.26 bug fix) A nucleus flying in 3-D (no radiation flight there) keeps ½m|v|² of its stored velocity as its kinetic
   energy, as the books count it, but moves at the relativistic speed for that energy: the stored v of a 1 PeV α is 730c,
   447 Å a shortest step, so it left the box in one step without meeting what lay on its path. This is the factor from the
   stored speed to the true one (it does not depend on the mass); under 1% of c the two differ by less than 10⁻⁴ and the
   stored speed is used as before. */
const FLY_REL2 = 9.3e4; // (Å/tu)²: 1% of c, squared
function flyScale3(v2) { if (!(v2 > FLY_REL2)) return 1; const g = 1 + 0.5 * v2 / (PHYS.AMU_MEV * 1e6); return PHYS.C * Math.sqrt(1 - 1 / (g * g)) / Math.sqrt(v2); }
const ESC_E_NEUTRON = 1e3; // eV: faster neutrons leave through the walls
const NEUTRON_RAD = 2e7;   // eV: faster neutrons fly at their relativistic speed with their energy stored (radiation mode)
/* Radiation-mode thresholds (eV): well above the thermal energies of the bath, so plasmas stay thermal. The bath's
   temperature here is the one the matter has had time to follow (_Tb): it rises at once with the setting, and falls only as
   fast as the bath can cool the matter (kinetic energy relaxes at 2γ), so a plasma whose bath is turned down cools where
   it is instead of being declared radiation all at once and flying into walls that stop radiation. */
let _Tb = 0;
function radThreshold(isLepton) { return Math.max(isLepton ? 1000 : 2000, 30 * PHYS.KB * Math.max(W.T, _Tb)); }
function bathFollow(dt) { _Tb = W.T >= _Tb ? W.T : W.T + (_Tb - W.T) * Math.exp(-2 * W.gamma * dt); }
let DT_MAX = 0.04; const DT_MIN = 2e-5;     // tu (0.4 fs max; Settings → Experimental can make it 0.2 or 0.1 fs)
const LJ_SCALE = 2.0;                      // 2-D cohesion correction for dispersion
const FCAP = 1e7;                          // eV/Å: a safety net only; the step size follows contact stiffness
let MAX_PARTS = 4000, MAX_FREE_E = 1500; // (the particle limit: Settings can raise it)
function setMaxParts(n) { MAX_PARTS = n; MAX_FREE_E = Math.round(0.375 * n); }
const R_NN = 0.35, R_FUS = 0.25;           // enlarged nuclear interaction radii (Å)
const R_BEAM = 0.9;                        // in a collider, beam particles that pass within their drawn size of each other interact
const R_LEP_U = 2.82e-5;                   // ultra-realistic mode: two leptons meet inside the classical electron radius, 2.82 fm
/* How close two beam particles must pass to interact. Ultra-realistic: at their true sizes, and out to where their
   charges turn them by more than a degree (60 times the head-on distance K), which nuclearScatter maps one to one. */
function rBeam(a, b) {
  if (!W.ultra) return a.k !== NUC || b.k !== NUC ? R_BEAM : Math.max(R_BEAM, nucReach(a, b));
  const qq = Math.abs((a.q || 0) * (b.q || 0)) || (a.k === NUC ? a.Z : 1) * (b.k === NUC ? b.Z : 1), K = 0.72 * qq / Math.max(1e-3, relKE(a, b) * 1e-6); // fm
  return Math.max(a.k !== NUC || b.k !== NUC ? R_LEP_U : nucReach(a, b), Math.min(60 * K * FM, 0.9));
}
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
    box: { w: 120, h: 76, tw: 120, th: 76, uw: 0, uh: 0, d: 0 }, // (d: the depth in z, Å, of a 3-D world)
    d3: false,                  // a 3-D world (world3d): positions, forces and motion in z too
    at: 0, wall: 'reflect', nWall: 'reflect', // (at: the pictures' clock, simFrame) nWall: what the closed walls do to neutrons (Lab → Container)
    T: 300, gamma: 0.05,
    warp: 1,                    // decay speed over real rates (1 = as in nature; below 1 slowed, down to 1e-6)
    minShow: 0,                 // hold the shortest-lived particles until seen (0 off, 1 a little, 2 more; hep.js exoHeld)
    Bz: 0, magnets: [], Ex: 0, Ey: 0,
    nextId: 1, topo: 1, deaths: 0, bathSeed: 0x5eed1234, // bathSeed: the heat bath's noise is hashed from it, the step and the slot (threads.js's bathNoise)
    objs: [], objSeq: 0,          // placed objects: mirrors, lenses, walls … (props.js)
    rays: [], flights: [], chips: [], chipSeq: 0, chipT: 0, lasers: [], mem: null, memOrder: null, tracks: [], flashes: [], log: [], logSeq: 0,
    exo: [],                    // unstable particles in flight (muons, pions, kaons…: hep.js)
    events: [], evRecent: [], slow: null, slowmo: true, decayOn: true, made: null, // made: what nuclear events have made (noteMade)
    tool: null, grab: null, sources: [],
    zones: [], collider: null,  // accelerator parts (bending and focusing magnets, cavities) and the collider's set-up
    count: { fusion:0, fission:0, decay:0, capture:0, ionize:0, recomb:0, bonds:0, broken:0, react:0,
             photons:0, annih:0, xfer:0, ncap:0, nreact:0, wallStop:0 },
    ledger: { chem: 0, nuc: 0, escaped: 0, bath: 0, qWall: 0, qObj: 0, qOut: 0 }, // q…: charge taken in by the walls, by placed pieces and detectors, and carried out of an open box (1.02)
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
  lp: null, metal: null, mR: null, mD: null, tLocal: null, vlx: null, vly: null, vlin: null, z: null, vz: null, fz: null, gz: null, oz: null, vlz: null };
const S_F64 = ['x', 'y', 'vx', 'vy', 'fx', 'fy', 'gx', 'gy', 'ox', 'oy', 'm', 'im', 'q', 'qp', 'ljR', 'ljS', 'ionR', 'sEN', 'elrc', 'mR', 'mD', 'tLocal', 'vlx', 'vly', 'z', 'vz', 'fz', 'gz', 'oz', 'vlz']; // (z …: the third direction, zero in a flat world)
const S_U8 = ['k', 'dead', 'fast', 'rad', 'fresh', 'ballistic', 'inMD', 'nearIon', 'ionic', 'isMetal', 'anti', 'xferD', 'xferA', 'metal', 'vlin'];
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
    S.sEN[i] = SOFT_EN; S.elrc[i] = 0; S.hit[i] = 0; S.lp[i] = 0; S.metal[i] = 0; S.mR[i] = 0; S.mD[i] = 0; S.tLocal[i] = 0; S.vlx[i] = 0; S.vly[i] = 0; S.vlin[i] = 0;
    S.z[i] = 0; S.vz[i] = 0; S.fz[i] = 0; S.gz[i] = 0; S.oz[i] = 0; S.vlz[i] = 0;
    this.N = 0; this.qpol = 0; this.qf = 0; this.qi = 0; this.bom = false; this.bonds = []; this.excl = null; this.el = null; this.nuc = null;
    this.KE = 0; this.ux = 1; this.uy = 0; this.sp = 0; this.gam = 1;
    this.glow = 0; this.glowC = ''; this.born = W.rt;
    this.val = 0; this.nOut = 0; this.unp = 0;
    this.ljE = 0; this.polarH = false; this.rd = 0.3;
    this.trk = null; this.mark = 0; this.sel = false;
    this.omB = 0; this.Bl = 0; this.evId = 0; this.capT = 0; this.capN = 0;
    this.beam = undefined; this.trkKeep = undefined; this.injKick = undefined; this.kickIn = undefined; this.nucProd = undefined; this.caught = false;
  }
  get x() { return S.x[this.i]; } set x(v) { S.x[this.i] = v; }
  get tLocal() { return S.tLocal[this.i]; } set tLocal(v) { S.tLocal[this.i] = v; }
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
  get k() { return S.k[this.i]; } set k(v) { if (S.k[this.i] !== v) { S.k[this.i] = v; _zGen++; } }
  get dead() { return S.dead[this.i] === 1; } set dead(v) { S.dead[this.i] = v ? 1 : 0; _flagGen++; if (v) _nDead++; }
  get fast() { return S.fast[this.i] === 1; } set fast(v) { if (S.fast[this.i] !== (v ? 1 : 0)) { S.fast[this.i] = v ? 1 : 0; _flagGen++; } }
  get rad() { return S.rad[this.i] === 1; } set rad(v) { if (S.rad[this.i] !== (v ? 1 : 0)) { S.rad[this.i] = v ? 1 : 0; _flagGen++; } }
  get fresh() { return S.fresh[this.i] === 1; } set fresh(v) { S.fresh[this.i] = v ? 1 : 0; }
  get ballistic() { return S.ballistic[this.i] === 1; } set ballistic(v) { S.ballistic[this.i] = v ? 1 : 0; }
  get inMD() { return S.inMD[this.i] === 1; } set inMD(v) { S.inMD[this.i] = v ? 1 : 0; }
  get nearIon() { return S.nearIon[this.i] === 1; } set nearIon(v) { S.nearIon[this.i] = v ? 1 : 0; }
  get Z() { return S.Z[this.i]; } set Z(v) { if (S.Z[this.i] !== v) { S.Z[this.i] = v; _zGen++; } }
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
  get z() { return S.z[this.i]; } set z(v) { S.z[this.i] = v; }
  get vz() { return S.vz[this.i]; } set vz(v) { S.vz[this.i] = v; }
  get fz() { return S.fz[this.i]; } set fz(v) { S.fz[this.i] = v; }
  get gz() { return S.gz[this.i]; } set gz(v) { S.gz[this.i] = v; }
  get oz() { return S.oz[this.i]; } set oz(v) { S.oz[this.i] = v; }
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

function addNuc(Z, N, ne, x, y, vx = 0, vy = 0, anti = false, z = 0) {
  const p = newPart(NUC);
  p.Z = Z; p.N = N; p.ne = Math.max(0, ne); p.x = x; p.y = y; p.ox = x; p.oy = y; p.vx = vx; p.vy = vy; p.anti = !!anti;
  if (z) { p.z = z; p.oz = z; }
  refresh(p);
  pushPart(p); W.spawned++; _late.push(p);
  return p;
}
function addLepton(kind, x, y, vx = 0, vy = 0, z = 0, vz = 0) {
  const p = newPart(kind);
  p.m = PHYS.ME_SIM; p.im = 1 / p.m; p.q = kind === ELEC ? -1 : 1; p.rd = 0.12;
  p.x = x; p.y = y; p.ox = x; p.oy = y; p.vx = vx; p.vy = vy;
  if (z || vz) { p.z = z; p.oz = z; p.vz = vz; }
  pushPart(p); W.spawned++; _late.push(p); _charged.push(p);
  if (kind === ELEC) W.nE++;
  updateFast(p);
  return p;
}

/* Recompute everything derived from Z, N, ne and bonding. */
/* An atom's mass (u): a neutron's, muonium's (1.12: its nucleus a μ⁺, a hydrogen atom 1/9 the mass, hep.js addMuonium),
   or the nucleus's and its electrons', with the muon of a muonic atom (bound: its mass less the binding; 1.26, it was
   left out, 0.9% of carbon's, 2.8% of helium's; restE leaves it out, as its rest mass is booked apart, hep.js muStop). */
function atomMass(p) {
  const Z = p.Z, N = p.N;
  if (Z === 0) return N * PHYS.MN;
  if (p.mu) return MU_M / PHYS.AMU_MEV + p.ne * PHYS.ME;
  return Math.max(0.5, Z * PHYS.MP + N * PHYS.MN + p.ne * PHYS.ME - bindingE(Z, N) / PHYS.AMU_MEV) + (p.muB ? p.muB.m / (PHYS.AMU_MEV * 1e6) : 0);
}
/* (1.27, the realistic-particle switch's exotic atoms) The charge an atom's electrons see: its nuclear charge, less one for
   a muon bound inside them (p.muB.zx), so muonic carbon is to the outside an atom of charge 5 and takes boron's table
   entries (valence, bonds, size, electronegativity, ionization energies). Without zx it is Z: every atom as before. */
const zChem = (p) => (p.muB && p.muB.zx ? p.Z - p.muB.zx : p.Z);
const elSym = (p) => (p.muB && p.muB.zx ? 'μ' + ELEMENTS[p.Z].sym : p.el.sym); // (its symbol: the nucleus's, marked, though p.el is the element its electrons see)
function refresh(p) {
  if (p.k !== NUC) return;
  W.dirty++;
  const Z = zChem(p), N = p.N; // (the nucleus's own Z for its nuclide below: p.Z)
  p.el = Z > 0 ? ELEMENTS[Math.min(Z, Z_MAX)] : null;
  S.elrc[p.i] = p.el ? p.el.rc : 0; S.metal[p.i] = p.el && p.el.metal ? 1 : 0; // (the covalent radius and whether it is a metal, for the pair kernel)
  p.m = atomMass(p);
  p.im = 1 / p.m;
  p.q = (p.anti ? -1 : 1) * (Z - p.ne);
  p.sEN = Z > 0 ? softFor(p) : SOFT_EN;
  p.nuc = nuclideInfo(p.Z, N);
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
  p.xferA = !p.anti && !!p.el && (p.q > 0 || (p.el.ea >= 0.7 && p.ne <= Z));
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
  if (!any || atoms.length < 2) { for (const p of atoms) { p.qf = 0; p.qi = 0; p.qp = p.qpol; for (const bd of p.bonds) bd.Ef = 0; } return; }
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
  for (const p of atoms) { p.qf = c.get(p) + (d.get(p) || 0) - p.q; p.qi = 0; p.qp = p.qpol + p.qf; }
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
  p.isMetal = el.metal && p.bonds.length === 0 && Math.abs(p.q) <= 1 && !(p.bom && !BO.qm); // (a member of continuous bond orders holds no stored bonds but is bonded: tin in SnCl₄ meets other atoms as with stored bonds, not as a metal, 1.25)
  if (el.metal) {
    p.mD = MBO.on && p.isMetal && p.q === 0 ? 0 : PHYS.KB * Math.max(el.tm, 150) / 0.45; // (no depth for a many-body member, a neutral metal atom: its cohesion is bometal.js's, 1.25)
    p.mR = 2 * el.rc * ((el.cat === 'am' || el.cat === 'ae' || el.cat === 'pt') ? 1.12 : 1.0);
    if (p.isMetal && 2.1 * p.mR > RC) _farMetalSeen = true;
  }
}

function kill(p) {
  if (p.dead) return;
  if (p.wm) p.wDeadE = p.wBooked ? 0 : waveIonShare(p); // (electrons as waves: its share with the ions and packets, for waveSync to give off)
  p.dead = true; W.deaths++;
  if (p.k === NUC && p.Z === 0 && !p.anti) kEnd(p);
  if (p.k === ELEC) W.nE--;
  for (const bd of p.bonds.slice()) removeBond(bd);
  if (W.grab && W.grab.p === p) W.grab = null;
}

/* ------------------------------------------------------------------ bonds */
function other(bd, p) { return bd.a === p ? bd.b : bd.a; }
function bondBetween(a, b) { for (const bd of a.bonds) if (bd.a === b || bd.b === b) return bd; return null; }
function setBondParams(bd) {
  const ea = bd.a.el, eb = bd.b.el;
  if (bd.arom) { // a resonating bond (resonate): between its single and double forms, at its Pauling order 1 + f
    const f = clamp((bd.fo || 1.5) - 1, 0, 1);
    bd.D = bondEnergy(ea, eb, 1) * (1 - f) + bondEnergy(ea, eb, 2) * f + (bd.reShare || 0);
    bd.r0 = bondLength(ea, eb, 1) * (1 - f) + bondLength(ea, eb, 2) * f - 0.16 * f * (1 - f); // (shorter than the straight mean, as measured: 1.40 Å for benzene's C–C, 1.34 Å for pyridine's C–N)
    bd.al = morseA(ea, eb, 1) * (1 - f) + morseA(ea, eb, 2) * f;
  } else {
    bd.D = bondEnergy(ea, eb, bd.order);
    bd.r0 = bondLength(ea, eb, bd.order);
    bd.al = morseA(ea, eb, bd.order);
  }
  bd.rb = 2.97 / bd.al;
}
/* Aromatic rings (0.95). Bond orders here are whole numbers, so a benzene ring is held as one of its Kekulé forms
   (alternating single and double bonds). A six-membered ring of carbon and nitrogen in which every atom has one double
   bond, within the ring or a ring fused to it, is marked aromatic: each of its bonds then takes the mean of the single and double bond's energy and spring, 1.40 Å
   long for C–C (as measured; 1.34 Å for C–N in pyridine), and the ring is 150 kJ/mol (1.55 eV, benzene's resonance
   energy) more stable than its Kekulé form: so it stays a regular hexagon and resists addition across its double bonds,
   which would break the ring's aromaticity. The orders themselves stay as they are (each atom's valence counts them). */
const AROM_STAB = 150 / PHYS.KJMOL;
/* Resonance (1.05): fractional bond orders, worked out instead of looked for. The atoms of a molecule that each hold one
   double bond to another such atom (C, N, O, S) form its π system; the double bonds as they stand are one way of
   pairing them up (a Kekulé structure). Every other pairing along the bonds between them is another, with the same
   bonds counted on every atom. Each bond's order is the mean over all of them, Pauling's bond order: benzene's two
   structures give 1.5 everywhere, naphthalene's three give 1⅔ and 1⅓, butadiene's one leaves it as it is. The
   system is more stable than any one structure by its resonance energy, 150 kJ/mol × ln K / ln 2 for K structures
   (benzene's 150 kJ/mol; naphthalene 238, measured about 255), shared among the bonds that resonate. This replaces the
   0.95 rule for six-membered rings, which stays for π systems too big to count (aromatize). The whole-number orders
   (bd.order) stay those of the structure as it stands: every atom's valence counts them as before. */
const RES_MAX_ATOMS = 40, RES_MAX_K = 4000, RES_BIG_MAX = 1000;
let RES_BIG = false; // (Settings → Experimental: resonance in large ring systems, by a determinant)
/* A large π system's Pauling bond orders without counting its Kekulé structures one by one (Experimental, 1.07): when it
   is bipartite (no odd rings) and its rings are hexagons, as in graphene and the benzenoid hydrocarbons, the number of
   structures K is |det B|, B the matrix of its bonds between the two colours of atoms, and the share of them that hold a
   bond i–j as a double bond is B_ij·(B⁻¹)_ji (Kasteleyn; for benzenoids, Dewar and Longuet-Higgins). A ring of 4 or 8
   (which upsets the signs) shows as a share outside 0…1, and the system is left to the six-ring rule. Returns
   { f: Map(bond → share), logK } or null. */
function resonanceBig(comp, edges, idx) {
  const n = comp.length, col = new Int8Array(n).fill(-1); col[0] = 0; const q = [0];
  while (q.length) { const i = q.pop(); for (const bd of edges[i]) { const j = idx.get(other(bd, comp[i])); if (col[j] < 0) { col[j] = 1 - col[i]; q.push(j); } else if (col[j] === col[i]) return null; } }
  const bl = [], wh = [], pos = new Int32Array(n);
  for (let i = 0; i < n; i++) { if (col[i] < 0) return null; pos[i] = col[i] ? wh.length : bl.length; (col[i] ? wh : bl).push(i); }
  const m = bl.length; if (m !== wh.length || !m) return null;
  const M = new Float64Array(m * m); // B, then its LU factors
  for (let a = 0; a < m; a++) for (const bd of edges[bl[a]]) M[a * m + pos[idx.get(other(bd, comp[bl[a]]))]] = 1;
  const piv = new Int32Array(m); let logK = 0;
  for (let k = 0; k < m; k++) {
    let p = k, big = Math.abs(M[k * m + k]); for (let r = k + 1; r < m; r++) { const v = Math.abs(M[r * m + k]); if (v > big) { big = v; p = r; } }
    if (big < 1e-9) return null; // (no Kekulé structure at all)
    piv[k] = p; if (p !== k) for (let c = 0; c < m; c++) { const t = M[k * m + c]; M[k * m + c] = M[p * m + c]; M[p * m + c] = t; }
    const d = M[k * m + k]; logK += Math.log(Math.abs(d));
    for (let r = k + 1; r < m; r++) { const f = M[r * m + k] / d; if (f === 0) continue; M[r * m + k] = f; for (let c = k + 1; c < m; c++) M[r * m + c] -= f * M[k * m + c]; }
  }
  // (B⁻¹)_ji for each bond: solve B x = e_i for each black row i's columns needed, via Bᵀ y = e_i ... column j of B⁻¹ is
  // B⁻¹ e_j: solve for every white j (m solves, m² each)
  const out = new Map(), x = new Float64Array(m);
  const inv = new Float64Array(m * m); // inv[j*m + a] = (B⁻¹)_{j,a}: the solution of B x = e_a is column a
  for (let a = 0; a < m; a++) {
    x.fill(0); x[a] = 1;
    for (let k = 0; k < m; k++) { const p = piv[k]; if (p !== k) { const t = x[k]; x[k] = x[p]; x[p] = t; } } // (row swaps, in order)
    for (let r = 0; r < m; r++) { let s = x[r]; for (let c = 0; c < r; c++) s -= M[r * m + c] * x[c]; x[r] = s; }
    for (let r = m - 1; r >= 0; r--) { let s = x[r]; for (let c = r + 1; c < m; c++) s -= M[r * m + c] * x[c]; x[r] = s / M[r * m + r]; }
    for (let j = 0; j < m; j++) inv[j * m + a] = x[j];
  }
  for (let a = 0; a < m; a++) for (const bd of edges[bl[a]]) {
    const j = pos[idx.get(other(bd, comp[bl[a]]))], f = inv[j * m + a]; // B_aj = 1
    if (f < -1e-6 || f > 1 + 1e-6) return null;
    out.set(bd, clamp(f, 0, 1));
  }
  return { f: out, logK };
}
function resonance(atoms) {
  const okEl = (p) => p.el && !p.anti && (p.Z === 6 || p.Z === 7 || p.Z === 8 || p.Z === 16);
  const dblTo = (p) => { let n = 0, to = null; for (const bd of p.bonds) if (bd.order === 2) { n++; to = other(bd, p); } else if (bd.order > 2) return null; return n === 1 ? to : null; };
  const pi = new Set();
  for (const p of atoms) { if (!okEl(p)) continue; const o = dblTo(p); if (o && okEl(o) && dblTo(o) === p) pi.add(p); }
  const fo = new Map(), share = new Map(), sys = new Map(); let big = false;
  const seen = new Set();
  for (const s of pi) {
    if (seen.has(s)) continue;
    const comp = [], stack = [s]; seen.add(s);
    while (stack.length) { const p = stack.pop(); comp.push(p); for (const bd of p.bonds) { const o = other(bd, p); if (pi.has(o) && !seen.has(o) && bd.order <= 2) { seen.add(o); stack.push(o); } } }
    if (comp.length < 4) continue; // (one double bond: nothing to move)
    if (comp.length > RES_MAX_ATOMS && !(RES_BIG && comp.length <= RES_BIG_MAX)) { big = true; continue; }
    // every perfect matching of the component along its bonds: each bond's count
    comp.sort((u, v) => u.id - v.id);
    const idx = new Map(comp.map((p, i) => [p, i])), edges = comp.map(p => p.bonds.filter(bd => bd.order <= 2 && idx.has(other(bd, p))));
    if (comp.length > RES_MAX_ATOMS) { // (Experimental: a large ring system, by its determinant)
      const R2 = resonanceBig(comp, edges, idx);
      if (!R2) { big = true; continue; }
      const res = [];
      for (const [bd, f] of R2.f) if (f > 1e-9 && f < 1 - 1e-9) res.push([bd, f]);
      if (!res.length || R2.logK < 0.5) continue;
      const RE = AROM_STAB * R2.logK / Math.LN2; let wsum = 0; for (const [, f] of res) wsum += f * (1 - f);
      for (const [bd, f] of res) { fo.set(bd, 1 + f); share.set(bd, RE * f * (1 - f) / wsum); sys.set(bd, RE); }
      continue;
    }
    const used = new Uint8Array(comp.length), cnt = new Map(), cur = []; let K = 0, over = false;
    const walk = () => {
      if (over) return;
      let i = 0; while (i < comp.length && used[i]) i++;
      if (i === comp.length) { K++; for (const bd of cur) cnt.set(bd, (cnt.get(bd) || 0) + 1); if (K > RES_MAX_K) over = true; return; }
      used[i] = 1;
      for (const bd of edges[i]) { const j = idx.get(other(bd, comp[i])); if (used[j]) continue; used[j] = 1; cur.push(bd); walk(); cur.pop(); used[j] = 0; }
      used[i] = 0;
    };
    walk();
    if (over) { big = true; continue; }
    if (K < 2) continue;
    const res = [];
    for (const p of comp) for (const bd of edges[idx.get(p)]) if (bd.a === p) { const f = (cnt.get(bd) || 0) / K; if (f > 1e-9 && f < 1 - 1e-9) res.push([bd, f]); }
    const RE = AROM_STAB * Math.log(K) / Math.LN2; let wsum = 0; for (const [, f] of res) wsum += f * (1 - f);
    for (const [bd, f] of res) { fo.set(bd, 1 + f); share.set(bd, RE * f * (1 - f) / wsum); sys.set(bd, RE); }
  }
  for (const a of atoms) for (const bd of a.bonds) {
    if (bd.a !== a) continue;
    const f = fo.get(bd), ar = f !== undefined;
    if (!!bd.arom !== ar || (ar && (bd.fo !== f || bd.reShare !== share.get(bd)))) {
      bd.arom = ar; bd.fo = ar ? f : 0; bd.reShare = ar ? share.get(bd) : 0; bd.reSys = ar ? sys.get(bd) : 0; setBondParams(bd);
    }
  }
  if (big) aromatize(atoms, true); // (π systems too big to count: the six-membered rings, as before)
}
function aromatize(atoms, keep) {
  const ok = (p) => p.el && (p.Z === 6 || p.Z === 7) && !p.anti;
  // six-membered rings of C and N (any bond orders), each found once
  const rings = [], seen = new Set();
  for (const a of atoms) {
    if (!ok(a) || a.bonds.length < 2) continue;
    const path = [a];
    const walk = (p) => {
      if (path.length === 6) {
        if (!bondBetween(p, a)) return;
        const key = path.map(q => q.id).sort((u, v) => u - v).join(',');
        if (!seen.has(key)) { seen.add(key); rings.push(path.slice()); }
        return;
      }
      for (const bd of p.bonds) { const o = other(bd, p); if (ok(o) && o.id > a.id && !path.includes(o)) { path.push(o); walk(o); path.pop(); } }
    };
    walk(a); // (a: the ring's lowest id, so each ring is walked from one atom only)
  }
  // aromatic: every atom of the ring has exactly one double bond, to a C or N of an aromatic ring (this one, or one
  // fused to it: naphthalene's second ring holds only two of its five double bonds in a Kekulé form)
  const dbl = (p) => { let n = 0, to = null; for (const bd of p.bonds) if (bd.order === 2) { n++; to = other(bd, p); } else if (bd.order > 2) n += 9; return n === 1 && ok(to) ? to : null; };
  let aro = rings.filter(r => r.every(dbl));
  for (let changed = true; changed;) { // (a ring whose atoms' double bonds lead out of every aromatic ring is not one)
    changed = false;
    const inRing = new Set(); for (const r of aro) for (const p of r) inRing.add(p);
    const keep = aro.filter(r => r.every(p => inRing.has(dbl(p))));
    if (keep.length !== aro.length) { aro = keep; changed = true; }
  }
  const ring = new Set();
  for (const r of aro) for (let k = 0; k < 6; k++) ring.add(bondBetween(r[k], r[(k + 1) % 6]));
  for (const a of atoms) for (const bd of a.bonds) {
    if (bd.a !== a) continue;
    const ar = ring.has(bd);
    if (keep && !ar) continue; // (from resonance(): leave what it worked out)
    if (!!bd.arom !== ar || (ar && bd.fo !== 1.5)) { bd.arom = ar; bd.fo = ar ? 1.5 : 0; bd.reShare = ar ? AROM_STAB / 6 : 0; bd.reSys = ar ? AROM_STAB : 0; setBondParams(bd); }
  }
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
      qp += PARTIAL_K * (eo - ep) * (1 + 0.2 * ((bd.arom ? bd.fo || 1.5 : bd.order) - 1));
    }
    p.qpol = p.anti ? -qp : qp; // positrons crowd toward the more electronegative anti-atom
    p.qi = 0; p.qp = p.qpol + p.qf; // (a bond changed: the induced charge starts again from the molecule's own, qeqUpdate)
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
    if (!p.bonds.length) { p.mol = 0; p.qf = 0; p.qi = 0; p.qp = p.qpol; done.add(p); continue; }
    const id = ++W.molSeq, m = molecule(p);
    for (const a of m) { a.mol = id; done.add(a); }
    resonance(m);
    delocalize(m);
  }
}

/* Snapshot / restore of a closed set of atoms (whole molecules): positions, velocities, electrons, bonds.
   Events apply all their consequences on trial, measure the exact energy change, and undo if impossible. */
function snapshot(set) {
  const bonds = [];
  for (const bd of W.bonds) if (set.has(bd.a) || set.has(bd.b)) bonds.push([bd.a, bd.b, bd.order]);
  return { set, parts: [...set].map(p => [p, p.x, p.y, p.vx, p.vy, p.ne, p.qi, p.z, p.vz]), bonds, broken: W.count.broken };
}
function restoreSnap(sn) {
  for (const bd of W.bonds.slice()) {
    if (!sn.set.has(bd.a) && !sn.set.has(bd.b)) continue;
    if (!sn.bonds.some(b => (b[0] === bd.a && b[1] === bd.b) || (b[0] === bd.b && b[1] === bd.a))) removeBond(bd);
  }
  _deferDeloc = true;
  try {
    for (const [p, x, y, vx, vy, ne, , z, vz] of sn.parts) { p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.z = z; p.vz = vz; if (p.ne !== ne) { p.ne = ne; refresh(p); } }
    for (const [a, b, o] of sn.bonds) { const bd = bondBetween(a, b); if (!bd) addBond(a, b, o); else if (bd.order !== o) setOrder(bd, o); }
    for (const [p] of sn.parts) refresh(p);
  } finally { _deferDeloc = false; }
  relink([...sn.set]); // (which spreads the charges over each molecule)
  for (const [p, , , , , , qi] of sn.parts) if (qi) { p.qi = qi; p.qp = p.qpol + p.qf + qi; } // (1.12: the induced charges as they were: relink starts them again)
  W.count.broken = sn.broken;
}
/* The potential energy a change to atom p makes (change(): an ionization, a capture …), over the set (p's molecule).
   localPE(S) sums every term with an atom of S in it, so the difference before and after over S is exact when every atom
   the change touched is in S. In a big molecule (a chip is a thousand bonded atoms) S is p and what lies within two bonds
   of it — a charge spreads by resonance only that far — instead of the whole molecule, which made each of the dozens of
   ionizations along an ion's track through a chip cost a whole-chip sum twice (a stall of a second or more). The whole
   molecule is checked afterwards by a cheap fingerprint; when anything beyond S moved or changed (a broken bond pushing
   fragments apart), the change is undone from the snapshot and done again over the whole molecule. */
let LOCAL_MOL = 150; // (a let: the tests compare against the whole-molecule sum by raising it)
function localDelta(p, set, sn, change) {
  if (set.size <= LOCAL_MOL) { const U0 = localPE(set); change(); return localPE(closeSet(set)) - U0; }
  const S = new Set([p]);
  for (const bd of p.bonds) { const a = other(bd, p); S.add(a); for (const b2 of a.bonds) S.add(other(b2, a)); }
  const print = (q) => { let ar = 0; for (const bd of q.bonds) if (bd.arom) ar++; return q.x * 1.000003 + q.y * 1.7 + q.q * 3.1 + q.qp * 5.3 + q.rd * 7.9 + q.ne * 11 + q.bonds.length * 13 + ar * 17; }; // (ar: a ring that stops being aromatic changes bonds beyond the neighbourhood)
  const before = new Map(); for (const q of set) if (!S.has(q)) before.set(q, print(q));
  const U0 = localPE(S);
  change();
  let local = true;
  for (const [q, v] of before) if (q.dead || print(q) !== v) { local = false; break; }
  if (local) return localPE(S) - U0;
  _localMiss++;
  restoreSnap(sn); // (beyond the neighbourhood: undo, and do it again over the whole molecule)
  const U1 = localPE(set); change(); return localPE(closeSet(set)) - U1;
}
let _localMiss = 0;
/* The set grown to whole molecules: each molecule is walked once (an atom already reached is skipped), so a set inside a
   chip of a thousand bonded atoms costs one walk, not a thousand — an ion track through a chip ejects hundreds of electrons,
   each calling this, and the step stalled for seconds. */
function closeSet(set) {
  const done = new Set();
  for (const q of [...set]) { if (done.has(q)) continue; for (const m of molecule(q)) { set.add(m); done.add(m); } }
  return set;
}

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
  const PE0 = _nmd ? localPE(set) : 0;
  let guard = 0, lastPair = null;
  while (p.bonds.length && guard++ < 12 && p.used > lim()) {
    let w = p.bonds[0];
    for (const bd of p.bonds) if (bd.D < w.D) w = bd;
    lastPair = [p, other(w, p)];
    setOrder(w, w.order - 1);
    W.count.broken++;
  }
  if (lastPair && !bondBetween(lastPair[0], lastPair[1])) separate(lastPair[0], lastPair[1]);
  if (budget === null || !_nmd) return;
  for (const q of [...set]) for (const m of molecule(q)) set.add(m);
  const left = budget - (localPE(set) - PE0);
  if (lastPair) kickPair(lastPair[0], lastPair[1], left);
}
/* Move b's molecule out of a's repulsive core along the a→b axis (no-op if already clear). */
function separate(a, b) {
  W.dirty++;
  const mb = molecule(b);
  if (mb.includes(a)) return;
  const [ex, ey, ez] = minImg(b.x - a.x, b.y - a.y, b.z - a.z);
  const r = hyp3(ex, ey, ez) || 1e-6, target = 0.85 * 0.5 * ((a.ljR || 2) + (b.ljR || 2));
  if (r >= target) return;
  const sh = target - r;
  for (const q of mb) { q.x += ex / r * sh; q.y += ey / r * sh; if (ez) q.z += ez / r * sh; }
}
/* Energy needed to remove one electron, including bonds that must then break. */
function ionizationCost(p) { return ionE(zChem(p), p.ne) + breakCostIfCharged(p, -1); }

function molecule(p) {
  const seen = new Set([p]), out = [p];
  for (let i = 0; i < out.length; i++) {
    for (const bd of out[i].bonds) { const o = other(bd, out[i]); if (!seen.has(o)) { seen.add(o); out.push(o); } }
    if (out[i].bom) for (const o of boNbrs(out[i])) if (!seen.has(o)) { seen.add(o); out.push(o); } // (continuous bond orders: their bonds, 1.14)
  }
  return out;
}
/* bonded to anything (a stored bond, or with continuous bond orders an order of 0.5 or more) */
function linked(p) { return p.bonds.length > 0 || (p.bom && boNbrs(p).length > 0); }
function hill(atoms, plain) {
  const cnt = {}; let q = 0;
  for (const a of atoms) { const s = a.mu ? 'Mu' : a.el ? (a.anti ? barSym(a.el.sym) : elSym(a)) : 'n'; cnt[s] = (cnt[s] || 0) + 1; q += a.q; }
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
  if (atoms.some(a => a.anti || !a.el || a.mu) || !atoms.some(a => isoA(a))) return hill(atoms, plain);
  const cnt = new Map(); let q = 0;
  for (const a of atoms) { const k = elSym(a) + ' ' + isoA(a); cnt.set(k, (cnt.get(k) || 0) + 1); q += a.q || 0; }
  const els = [...new Set(atoms.map(a => elSym(a)))];
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
  const adj = atoms.map(a => a.bonds.map(bd => ix.get(other(bd, a))).concat(a.bom ? boNbrs(a).map(o => ix.get(o)) : []).filter(j => j !== undefined));
  const h = f + ':' + graphHash(atoms.map(a => { const A = plain ? 0 : isoA(a); return A ? elSym(a) + A : elSym(a); }), adj);
  let alt = null;
  for (const c of cands) if (c.h === h) { if (molFits(c.m, W.d3)) return c.m; alt = alt || c.m; } // (the open mode's library first: the 3-D builds are named in 3-D, 1.23.2)
  return alt;
}
/* Isotopes in a molecule: atoms other than the element's usual isotope (COMMON_A, what the chamber makes unless told
   otherwise; an atom gives its mass number as A, a particle as Z + N), written as IUPAC writes an isotopically
   substituted compound: nuclides in alphabetical order of symbol, then by mass number, as in (¹³C,²H₄)methane. */
function isoA(a) {
  const Z = a.muB && a.muB.zx ? a.Z : a.el ? a.el.Z : 0, A = a.A !== undefined ? a.A : a.Z ? a.Z + a.N : 0; // (an exotic atom: its own nucleus's usual mass number, 1.27)
  return Z && A && A !== COMMON_A[Z] ? A : 0;
}
function isoDesc(atoms) {
  const c = new Map();
  for (const a of atoms) { const A = isoA(a); if (A) { const k = elSym(a) + ' ' + A; c.set(k, (c.get(k) || 0) + 1); } }
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
  if (!atoms.length || atoms.some(a => a.mu)) return null; // (with muonium in it: the formula, MuCl, not hydrogen chloride's name, 1.12)
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
/* Ionic compounds (0.66). Ions held together by their charges are no molecule (no bond joins them), so they get their
   name here: the ions in contact (opposite charges closer than 1.3 × the sum of their radii, as the Ionic view draws
   them and whole-molecule grab takes them), each unit an ion (an atom, or a charged molecule like OH⁻), written as
   chemists write the compound: cations first, counts reduced to the formula unit (Na₁₄Cl₁₄ → NaCl), polyatomic ions in
   brackets when more than one, a d-block cation's charge in Roman numerals. */
function ionicCluster(p) {
  if (p.dead || p.k !== NUC || p.ne <= 0) return null;
  const rOf = (q) => (q.ionic && q.ionR > 0 ? q.ionR : q.rd), seen = new Set(), out = [];
  const add = (q) => { for (const m of molecule(q)) if (!seen.has(m)) { seen.add(m); out.push(m); } };
  add(p);
  if (!out.some(a => Math.abs(a.q) >= 1)) return null;
  const ions = W.parts.filter(q => !q.dead && q.k === NUC && q.ne > 0 && Math.abs(q.q) >= 1);
  const n0 = out.length;
  for (let i = 0; i < out.length && out.length < 4000; i++) {
    const a = out[i]; if (a.dead || a.k !== NUC || a.ne <= 0 || Math.abs(a.q) < 1) continue;
    for (const b of ions) {
      if (seen.has(b) || a.q * b.q >= 0) continue;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z; if (Math.abs(dx) > 8 || Math.abs(dy) > 8 || Math.abs(dz) > 8) continue;
      if (hyp3(dx, dy, dz) < 1.3 * (rOf(a) + rOf(b))) add(b);
    }
  }
  return out.length > n0 ? out : null;
}
const POLY_IONS = { HO: ['OH', 'hydroxide'], H4N: ['NH₄', 'ammonium'], H3O: ['H₃O', 'hydronium'], NO3: ['NO₃', 'nitrate'], NO2: ['NO₂', 'nitrite'],
  O4S: ['SO₄', 'sulfate'], O3S: ['SO₃', 'sulfite'], CO3: ['CO₃', 'carbonate'], CHO3: ['HCO₃', 'bicarbonate'], O4P: ['PO₄', 'phosphate'],
  ClO4: ['ClO₄', 'perchlorate'], ClO3: ['ClO₃', 'chlorate'], ClO: ['ClO', 'hypochlorite'], CN: ['CN', 'cyanide'], C2H3O2: ['CH₃COO', 'acetate'],
  MnO4: ['MnO₄', 'permanganate'], CrO4: ['CrO₄', 'chromate'], HO4S: ['HSO₄', 'hydrogen sulfate'], O2: ['O₂', 'peroxide'] };
const IDE = { 1: 'hydride', 7: 'nitride', 8: 'oxide', 9: 'fluoride', 15: 'phosphide', 16: 'sulfide', 17: 'chloride', 34: 'selenide', 35: 'bromide', 52: 'telluride', 53: 'iodide' };
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
function ionicName(atoms) {
  const seen = new Set(), units = new Map();
  for (const a of atoms) {
    if (seen.has(a)) continue;
    const m = molecule(a); for (const x of m) seen.add(x);
    let q = 0; for (const x of m) q += x.anti ? -x.q : x.q;
    const key = m.length === 1 ? (a.anti ? barSym(a.el.sym) : elSym(a)) : hill(m, true).replace(/\d*[+-]$/, '');
    const u = units.get(key + '|' + q) || { key, q, n: 0, one: m.length === 1, el: a.el, anti: a.anti };
    u.n++; units.set(key + '|' + q, u);
  }
  const us = [...units.values()];
  if (us.length < 2 || !us.some(u => u.q > 0) || !us.some(u => u.q < 0)) return null;
  const gcd = (x, y) => (y ? gcd(y, x % y) : x);
  let g = 0; for (const u of us) g = gcd(g, u.n);
  us.sort((x, y) => (y.q > 0) - (x.q > 0) || Math.abs(y.q) - Math.abs(x.q) || (x.key < y.key ? -1 : 1));
  let f = '', net = 0;
  for (const u of us) {
    const k = u.n / g, poly = !u.one, show = poly ? (POLY_IONS[u.key] ? POLY_IONS[u.key][0] : u.key.replace(/\d+/g, d => sub(d))) : u.key;
    f += (poly && k > 1 ? '(' + show + ')' : show) + (k > 1 ? sub(k) : '');
    net += u.q * k;
  }
  if (net) f += sup((Math.abs(net) > 1 ? Math.abs(net) : '') + (net > 0 ? '+' : '-'));
  let name = null;
  const cat = us.filter(u => u.q > 0), an = us.filter(u => u.q < 0);
  if (!net && cat.length === 1 && an.length === 1 && !cat[0].anti && !an[0].anti) {
    const c = cat[0], a = an[0];
    const cn = c.one ? c.el.name.toLowerCase() + (c.el.dblock && ROMAN[c.q] ? `(${ROMAN[c.q]})` : '') : POLY_IONS[c.key] && POLY_IONS[c.key][1];
    const anm = a.one ? IDE[a.el.Z] : POLY_IONS[a.key] && POLY_IONS[a.key][1];
    if (cn && anm) name = cn + ' ' + anm;
  }
  return { formula: f, name, units: g, n: atoms.length };
}
/* "NaCl (sodium chloride), 14 formula units": what the hover box, Inspect and the Data tab call an ionic cluster. */
function ionicText(atoms, long) {
  const c = ionicName(atoms); if (!c) return null;
  return c.formula + (c.name ? ` (${c.name})` : '') + (long && c.units > 1 ? `, ${c.units} formula units` : '');
}
function speciesLabel(p) {
  if (p.k === ELEC) return 'e⁻';
  if (p.k === POS) return 'e⁺';
  if (p.Z === 0) return 'n';
  if (linked(p)) return isoFormula(molecule(p));
  if (p.mu) return p.ne === 0 ? 'μ⁺' : 'Mu' + (p.q ? sup((Math.abs(p.q) > 1 ? Math.abs(p.q) : '') + (p.q > 0 ? '+' : '-')) : ''); // (1.12: muonium, Mu⁻ muonide; bare, a μ⁺)
  if (p.anti && p.ne === 0) return p.Z === 1 && p.N === 0 ? 'p̄' : nucSymA(p.Z, p.N, true) + sup((p.Z > 1 ? p.Z : '') + '-');
  if (p.ne === 0) {
    if (p.Z === 1 && p.N === 0) return 'p⁺';
    if (p.Z === 2 && p.N === 2) return 'α';
    return nucSym(p.Z, p.N) + sup((p.Z > 1 ? p.Z : '') + '+');
  }
  const qs = p.q ? sup((Math.abs(p.q) > 1 ? Math.abs(p.q) : '') + (p.q > 0 ? '+' : '-')) : '';
  return (p.anti ? barSym(p.el.sym) : elSym(p)) + qs;
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
function flash(x, y, rgb, size, life, z = 0) { // (z: where in depth, 3-D)
  let near = 0;
  for (let i = W.flashes.length - 1; i >= 0; i--) {
    const f = W.flashes[i], d = Math.max(3, 0.6 * Math.max(f.s, size));
    if (W.rt - f.t0 < 0.5 * f.life && Math.abs(f.x - x) < d && Math.abs(f.y - y) < d && ++near >= 2) return;
  }
  W.flashes.push({ x, y, z, c: rgb, s: size, life, t0: W.rt }); if (W.flashes.length > 300) W.flashes.shift();
}
/* Nuclear events, kept for the renderer: where and what happened, with ghosts of the particles that
   vanished or changed identity, so an event reads as more than a flash. An isolated event also starts
   slow motion (see slowFactor) so its products can be watched leaving. */
function ghostOf(p) {
  const lbl = p.k === ELEC ? 'e⁻' : p.k === POS ? 'e⁺' : p.Z === 0 ? (p.anti ? 'n̄' : 'n') :
    p.ne === 0 ? speciesLabel(p) : nucSymA(p.Z, p.N, p.anti);
  return { x: p.x, y: p.y, k: p.k, Z: p.Z, N: p.N, ne: p.ne, anti: !!p.anti, rd: p.k === NUC ? p.rd : 0.15, lbl };
}
function nucEvent(kind, x, y, text, ghosts, sub, nuc, z = 0) { // (z: where in depth, 3-D, 1.25)
  if (nuc && nuc.Z0 !== undefined && nuc.Z1 !== undefined) chainEdge(nuc.Z0, nuc.N0, nuc.Z1, nuc.N1, nuc.mode, nuc.anti); // (a decay: a step on the chart of nuclides)
  if (nuc && nuc.Z1 !== undefined && nuc.Z1 + nuc.N1 > 0) noteMade([{ Z: nuc.Z1, N: nuc.N1, anti: nuc.anti }], [], text);
  W.events.push({ kind, x, y, z, text, sub: sub || '', ghosts: ghosts || [], t0: W.rt, nuc: nuc || null });
  if (W.events.length > 30) W.events.splice(0, W.events.length - 30);
  const rec = W.evRecent;
  rec.push(W.rt);
  while (rec.length && rec[0] < W.rt - 6) rec.shift();
  // slow motion only for events that stand out; a busy reactor or plasma keeps running at speed
  if (W.slowmo && rec.length <= 3) {
    if (W.slow && W.slow.on) { W.slow.fresh = true; W.slow.t0 = W.rt; } // (another event while slowed: the frame ends here too, and its products count from now)
    else W.slow = { t0: W.rt, on: true, fresh: true, f: W.slow ? W.slow.f : 1 };
  }
  // what the event sent flying (new this frame, or fast) is marked, and for a few seconds so is anything new (what
  // its products knock loose): with slow motion for nuclear events off, slow motion on demand does not slow down
  // further to follow them
  for (const p of W.parts) if (!p.dead && !p.beam && (p.born === W.rt || p.rad || p.fast || keOf(p) > 10) && Math.abs(p.x - x) < 4 && Math.abs(p.y - y) < 4 && (!W.d3 || Math.abs(p.z - z) < 4)) p.nucProd = true; // (3-D: near it in depth too, 1.26 sweep) (keOf: a struck nucleus that stays itself, as the proton of π⁰p → p + π⁰, sent off below the fast threshold, 0.93)
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
function boostTag() { return (W.warp > 1.0001 ? ` · decay sped up ${fmtFactor(W.warp)}` : W.warp < 0.9999 ? ` · decay slowed ${fmtFactor(1 / W.warp)}` : '') + (W.minShow ? ' · short-lived held to be seen' : ''); }
/* The decay speed in words: 'real', 'sped up ×1,000' or 'slowed ×1,000'. */
function warpWords() { return W.warp > 1.0001 ? `sped up ${fmtFactor(W.warp)}` : W.warp < 0.9999 ? `slowed ${fmtFactor(1 / W.warp)}` : 'real'; }

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
  if (W.Ex !== 0 || W.Ey !== 0 || (W.objs.length && hasPlates()) || (W.d3 && W.Ez)) return true; // (3-D: along z too, 1.24)
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
        const q = p.k === NUC ? (p.anti ? -1 : 1) * Math.max(1, zChem(p) - p.ne) : p.q;
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
  if (W.objs.length) platesField(x, y, _E); // (placed charged plates: props.js)
  return _E;
}
function Bfield(x, y, p) {
  if (W.d3) return Bfield3(x, y, p ? p.z : 0); // (3-D: along the chosen axis, magnets as balls, 1.24)
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
/* 3-D fields (1.24; the owner: "magnets and fields in 3-D"). Every magnetic field in a 3-D world points along one axis,
   W.Bax3 ('x', 'y' or 'z'; the Lab's B direction): the uniform field W.Bz and every magnet's (a magnet is a ball of
   radius R, its field B inside and falling off outside as the flat game's disc does, by the distance in 3-D). With all
   of it along one fixed axis, the field at a point is one number times that axis, so the flat game's exact turning
   (rotateB, a Boris rotation, and gyrate, an exact arc) works unchanged on the two velocity components across the axis
   (B3P: x→(y, z), y→(z, x), z→(x, y), each pair turned as (vx, vy) is about z), the one along it untouched. The
   electric field has a z part too (W.Ez: the Lab's ±z buttons). */
const B3P = { x: ['y', 'z', 'vy', 'vz'], y: ['z', 'x', 'vz', 'vx'], z: ['x', 'y', 'vx', 'vy'] };
function Bfield3(x, y, z) {
  let B = W.Bz;
  const ms = W.magnets;
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i], dx = x - m.x, dy = y - m.y, dz = z - (m.z || 0), d2 = dx * dx + dy * dy + dz * dz, R = m.R;
    if (d2 < R * R) { B += m.B; continue; }
    const far = 2.4 * R;
    if (d2 >= far * far) continue;
    const u = (Math.sqrt(d2) - R) / (0.35 * R);
    B += m.B * Math.exp(-u * u);
  }
  return B;
}
function Bgrad3(x, y, z, out) { // B (along the axis) and out = its gradient [d/dx, d/dy, d/dz]
  let B = W.Bz, gx = 0, gy = 0, gz = 0;
  for (const m of W.magnets) {
    const dx = x - m.x, dy = y - m.y, dz = z - (m.z || 0), d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < m.R) { B += m.B; continue; }
    const s = 0.35 * m.R, u = (d - m.R) / s;
    if (u > 4) continue;
    const e = Math.exp(-u * u), Bm = m.B * e, dBdd = -2 * u / s * Bm;
    B += Bm; gx += dBdd * dx / d; gy += dBdd * dy / d; gz += dBdd * dz / d;
  }
  out[0] = gx; out[1] = gy; out[2] = gz;
  return B;
}
/* The turn of a charged particle's velocity by half a magnetic kick (frac of the step), in place: rotateB's Boris
   rotation on the pair across the axis. */
function rotateB3(p, frac) {
  const B = Bfield3(p.x, p.y, p.z); if (B === 0) return;
  const P = B3P[W.Bax3] || B3P.z, a = P[2], b = P[3], va = p[a], vb = p[b];
  const tt = p.q * B * PHYS.LOR * p.im * 0.5 * frac, s = 2 * tt / (1 + tt * tt);
  const vpa = va + vb * tt, vpb = vb - va * tt;
  p[a] = va + vpb * s; p[b] = vb - vpa * s;
}
/* gyrate in 3-D: the exact arc across the axis, a straight drift along it. */
function gyrate3(p, B, h) {
  const P = B3P[W.Bax3] || B3P.z, xa = P[0], xb = P[1], a = P[2], b = P[3], ax = W.Bax3 === 'x' ? 'x' : W.Bax3 === 'y' ? 'y' : 'z';
  const om = p.q * B * PHYS.LOR * p.im, ph = om * h, va = p[a], vb = p[b];
  const c = Math.cos(ph), sn = Math.sin(ph);
  let u, w; if (Math.abs(ph) < 1e-5) { u = h; w = 0.5 * ph * h; } else { u = sn / om; w = 2 * Math.sin(0.5 * ph) ** 2 / om; }
  p[xa] += va * u + vb * w; p[xb] += vb * u - va * w;
  p[a] = va * c + vb * sn; p[b] = vb * c - va * sn;
  p[ax] += p['v' + ax] * h;
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
const G = { cols: 0, rows: 0, cw: 1, ch: 1, hx: 1, hy: 1, wrap: false, bits: 0, shift: 32, mask: 0, keys: new Int32Array(1), head: new Int32Array(1), next: new Int32Array(1),
  _list: [], _listN: -1, _listGen: -1, n: 0, px: new Float64Array(16), py: new Float64Array(16), occ: new Int32Array(16), nocc: 0, slots: 1, RL2: 0, fwd: null, builds: 0,
  lay: 1, cd: 1, hz: 1, pz: shArray(Float64Array, 16) }; // (3-D: lay layers of cells along z, cd deep; a cell's key is (cz·rows + cy)·cols + cx)
/* Cell of a point: cells tile the box with a 1 Å margin for closed walls, and exactly for periodic ones, so that the
   cells at opposite edges are neighbours across the boundary (a margin there hid pairs within the cutoff). */
/* G.list: the particles the grid was built over, as objects, in grid order (made the first time it is asked for after a
   build: the force pass itself needs slots only). G.n is their number. */
Object.defineProperty(G, 'list', { get() {
  gridEnsure();
  if (G._listGen === _gridGen && G._listN === G.n) return G._list;
  const L = G._list, n = G.n, OBJ = S.obj, idx = _mdI; L.length = n;
  for (let i = 0; i < n; i++) L[i] = OBJ[idx[i]];
  G._listGen = _gridGen; G._listN = n;
  return L;
} });
let _gridGen = 0;
/* The grid is built when something asks for it (the neighbour-list rebuild, a search for what is near a point or
   along a line, the lepton list), not at every step: a step whose list is still valid and that has no event to look
   into needs no grid at all, and that is most steps. It is stale once particles have moved or the MD set may have
   changed (gridTouch, from the step and from anything that edits the world). */
let _gridStale = true, _gridMark = -1;
function gridTouch() { _gridStale = true; }
function gridEnsure() {
  const mark = W.spawned + W.dirty + W.topo + W.deaths + _flagGen;
  if (!_gridStale && mark === _gridMark && G.n === _nmd) return;
  buildGrid(_mdI, _nmd); _gridStale = false; _gridMark = mark; G.builds++;
}
/* The grid is a hash table of the occupied cells, not an array over the box: cells are the cutoff wide whatever the
   box's size (a 2 µm box has millions of them; a world of 20,000 atoms occupies a few thousand), so a dense drop of
   liquid in a huge box costs no more to search than the same drop in a small one. (Cells wide enough to keep an array
   small made every cell of such a drop hold hundreds of atoms, and building the neighbour list took 40× longer.)
   A cell's key is cy * cols + cx; gridFind gives its slot in the table or -1; G.head[slot] starts its particle chain,
   G.keys[slot] its key, and G.occ lists the occupied slots. The table has at least twice as many slots as particles,
   so a probe always ends. */
function gridCell(x, y) {
  let cx = Math.floor((x + G.hx) / G.cw), cy = Math.floor((y + G.hy) / G.ch);
  if (G.wrap) { cx = ((cx % G.cols) + G.cols) % G.cols; cy = ((cy % G.rows) + G.rows) % G.rows; }
  else { cx = cx < 0 ? 0 : cx >= G.cols ? G.cols - 1 : cx; cy = cy < 0 ? 0 : cy >= G.rows ? G.rows - 1 : cy; }
  return cy * G.cols + cx;
}
function gridFind(key) {
  const keys = G.keys, mask = G.mask;
  let s = Math.imul(key, 0x9E3779B1) >>> G.shift;
  for (;;) { const k = keys[s]; if (k === key) return s; if (k === -1) return -1; s = (s + 1) & mask; }
}
/* The first particle of the cell at column cx, row cy (already wrapped or clamped into range), or -1 when it is empty. */
function gridHead(cx, cy) { const s = gridFind(cy * G.cols + cx); return s === -1 ? -1 : G.head[s]; }
const CELL_KEYS = 1 << 28; // (cells grow only when a box would have more cells than keys fit in; no box the sliders allow does)
function buildGrid(idx, n) {
  if (W.d3) { buildGrid3(idx, n); return; }
  G.lay = 1;
  const wrap = W.wall === 'wrap', pad = wrap ? 0 : 2, w = W.box.w + pad, h = W.box.h + pad, cs = Math.max(CELL_MIN, Math.sqrt(w * h / CELL_KEYS));
  const cols = Math.max(1, Math.floor(w / cs)), rows = Math.max(1, Math.floor(h / cs));
  G.cols = cols; G.rows = rows; G.cw = w / cols; G.ch = h / rows; G.hx = w / 2; G.hy = h / 2; G.wrap = wrap;
  let bits = 4; while ((1 << bits) < 2 * n + 16) bits++;
  if (G.bits !== bits) { G.bits = bits; G.slots = 1 << bits; G.keys = shArray(Int32Array, G.slots); G.head = shArray(Int32Array, G.slots); G.shift = 32 - bits; G.mask = G.slots - 1; _sharedGen++; } // (shared: the workers build the neighbour list from the grid)
  G.keys.fill(-1);
  if (G.next.length < n) { G.next = shArray(Int32Array, n * 2 + 16); G.px = shArray(Float64Array, n * 2 + 16); G.py = shArray(Float64Array, n * 2 + 16); G.occ = shArray(Int32Array, n * 2 + 16); _sharedGen++; }
  G.n = n; G.nocc = 0; _gridGen++;
  const X = S.x, Y = S.y, px = G.px, py = G.py, head = G.head, next = G.next, occ = G.occ, keys = G.keys, mask = G.mask, shift = G.shift, DEAD = S.dead, OBJ = S.obj;
  let nocc = 0;
  for (let i = 0; i < n; i++) {
    const si = idx[i];
    if (DEAD[si] === 1 || !OBJ[si]) { px[i] = 0; py[i] = 0; next[i] = -1; continue; } // (built on demand, the MD list may be a pass old: a particle since dead, or its slot freed, goes in no cell)
    const x = X[si], y = Y[si];
    px[i] = x; py[i] = y;
    const key = gridCell(x, y);
    let s = Math.imul(key, 0x9E3779B1) >>> shift;
    for (;;) { const k = keys[s]; if (k === key) break; if (k === -1) { keys[s] = key; head[s] = -1; occ[nocc++] = s; break; } s = (s + 1) & mask; }
    next[i] = head[s]; head[s] = i;
  }
  G.nocc = nocc;
}
/* 3-D: the cells are boxes, in layers along z (layers × rows × columns); everything else as in buildGrid. */
function gridCell3(x, y, z) {
  let cx = Math.floor((x + G.hx) / G.cw), cy = Math.floor((y + G.hy) / G.ch), cz = Math.floor((z + G.hz) / G.cd);
  const cols = G.cols, rows = G.rows, lay = G.lay;
  if (G.wrap) { cx = ((cx % cols) + cols) % cols; cy = ((cy % rows) + rows) % rows; cz = ((cz % lay) + lay) % lay; }
  else { cx = cx < 0 ? 0 : cx >= cols ? cols - 1 : cx; cy = cy < 0 ? 0 : cy >= rows ? rows - 1 : cy; cz = cz < 0 ? 0 : cz >= lay ? lay - 1 : cz; }
  return (cz * rows + cy) * cols + cx;
}
function buildGrid3(idx, n) {
  const wrap = W.wall === 'wrap', pad = wrap ? 0 : 2, w = W.box.w + pad, h = W.box.h + pad, d = W.box.d + pad, cs = Math.max(CELL_MIN, Math.cbrt(w * h * d / CELL_KEYS));
  const cols = Math.max(1, Math.floor(w / cs)), rows = Math.max(1, Math.floor(h / cs)), lay = Math.max(1, Math.floor(d / cs));
  G.cols = cols; G.rows = rows; G.lay = lay; G.cw = w / cols; G.ch = h / rows; G.cd = d / lay; G.hx = w / 2; G.hy = h / 2; G.hz = d / 2; G.wrap = wrap;
  let bits = 4; while ((1 << bits) < 2 * n + 16) bits++;
  if (G.bits !== bits) { G.bits = bits; G.slots = 1 << bits; G.keys = shArray(Int32Array, G.slots); G.head = shArray(Int32Array, G.slots); G.shift = 32 - bits; G.mask = G.slots - 1; _sharedGen++; }
  G.keys.fill(-1);
  if (G.next.length < n) { G.next = shArray(Int32Array, n * 2 + 16); G.px = shArray(Float64Array, n * 2 + 16); G.py = shArray(Float64Array, n * 2 + 16); G.occ = shArray(Int32Array, n * 2 + 16); _sharedGen++; }
  if (G.pz.length < G.next.length) { G.pz = shArray(Float64Array, G.next.length); _sharedGen++; } // (shared: the workers build the 3-D list from the grid)
  G.n = n; G.nocc = 0; _gridGen++;
  const X = S.x, Y = S.y, Zp = S.z, px = G.px, py = G.py, pz = G.pz, head = G.head, next = G.next, occ = G.occ, keys = G.keys, mask = G.mask, shift = G.shift, DEAD = S.dead, OBJ = S.obj;
  let nocc = 0;
  for (let i = 0; i < n; i++) {
    const si = idx[i];
    if (DEAD[si] === 1 || !OBJ[si]) { px[i] = 0; py[i] = 0; pz[i] = 0; next[i] = -1; continue; }
    const x = X[si], y = Y[si], z = Zp[si];
    px[i] = x; py[i] = y; pz[i] = z;
    const key = gridCell3(x, y, z);
    let s = Math.imul(key, 0x9E3779B1) >>> shift;
    for (;;) { const k = keys[s]; if (k === key) break; if (k === -1) { keys[s] = key; head[s] = -1; occ[nocc++] = s; break; } s = (s + 1) & mask; }
    next[i] = head[s]; head[s] = i;
  }
  G.nocc = nocc;
}
/* The occupied cells among the neighbours of cell (cx, cy) whose key is greater than its own, as slots, into out (returns
   their number): each pair of neighbouring cells is then visited once, from the lower key, whether the box is periodic
   (where a neighbour across the boundary may have the lower key) or only a cell or two across (where neighbours repeat). */
function gridForward(cx, cy, key, out) {
  const cols = G.cols, rows = G.rows, wrap = G.wrap; let m = 0;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    let x = cx + ox, y = cy + oy;
    if (wrap) { x = (x + cols) % cols; y = (y + rows) % rows; } else if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
    const k = y * cols + x;
    if (k <= key) continue;
    const s = gridFind(k);
    if (s === -1) continue;
    let dup = false; for (let q = 0; q < m; q++) if (out[q] === s) { dup = true; break; } // (a tiny periodic box: the same cell from two sides)
    if (!dup) out[m++] = s;
  }
  return m;
}
/* Walk the particles of the cells covering a rectangle of cell coordinates (unwrapped; wrapped into the box here):
   cb(i) with the grid index. When the rectangle holds more cells than are occupied, the occupied cells are walked
   instead (every particle is then offered: callers test distances themselves). */
function gridWalk(x0, y0, x1, y1, cb, z0, z1) { // (3-D: layers z0 … z1 too; left out, all of them)
  if (G.lay > 1) { gridWalk3(x0, y0, x1, y1, z0 === undefined ? 0 : z0, z1 === undefined ? G.lay - 1 : z1, cb); return; }
  const cols = G.cols, rows = G.rows, wrap = G.wrap, head = G.head, next = G.next;
  if (!wrap) { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(cols - 1, x1); y1 = Math.min(rows - 1, y1); }
  else { if (x1 - x0 + 1 >= cols) { x0 = 0; x1 = cols - 1; } if (y1 - y0 + 1 >= rows) { y0 = 0; y1 = rows - 1; } }
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > G.nocc) {
    const occ = G.occ, nocc = G.nocc;
    for (let q = 0; q < nocc; q++) for (let i = head[occ[q]]; i !== -1; i = next[i]) if (cb(i) === false) return;
    return;
  }
  for (let cy = y0; cy <= y1; cy++) {
    const ry = wrap ? ((cy % rows) + rows) % rows : cy;
    for (let cx = x0; cx <= x1; cx++) {
      const rx = wrap ? ((cx % cols) + cols) % cols : cx;
      for (let i = gridHead(rx, ry); i !== -1; i = next[i]) if (cb(i) === false) return;
    }
  }
}
function gridWalk3(x0, y0, x1, y1, z0, z1, cb) {
  const cols = G.cols, rows = G.rows, lay = G.lay, wrap = G.wrap, head = G.head, next = G.next;
  if (!wrap) { x0 = Math.max(0, x0); y0 = Math.max(0, y0); z0 = Math.max(0, z0); x1 = Math.min(cols - 1, x1); y1 = Math.min(rows - 1, y1); z1 = Math.min(lay - 1, z1); }
  else { if (x1 - x0 + 1 >= cols) { x0 = 0; x1 = cols - 1; } if (y1 - y0 + 1 >= rows) { y0 = 0; y1 = rows - 1; } if (z1 - z0 + 1 >= lay) { z0 = 0; z1 = lay - 1; } }
  if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > G.nocc) {
    const occ = G.occ, nocc = G.nocc;
    for (let q = 0; q < nocc; q++) for (let i = head[occ[q]]; i !== -1; i = next[i]) if (cb(i) === false) return;
    return;
  }
  for (let cz = z0; cz <= z1; cz++) {
    const rz = wrap ? ((cz % lay) + lay) % lay : cz;
    for (let cy = y0; cy <= y1; cy++) {
      const ry = wrap ? ((cy % rows) + rows) % rows : cy;
      for (let cx = x0; cx <= x1; cx++) {
        const rx = wrap ? ((cx % cols) + cols) % cols : cx;
        const s = gridFind((rz * rows + ry) * cols + rx);
        if (s !== -1) for (let i = head[s]; i !== -1; i = next[i]) if (cb(i) === false) return;
      }
    }
  }
}
/* ---- neighbour (Verlet) list of the MD particles ----
   Every pair within RC + SKIN at the time it was built, as slot pairs (pi[k], pj[k]); the force loop takes those within
   RC now. The list stays exact while no particle has moved more than SKIN/2 from where it was when the list was built
   (then two particles can have closed in by at most SKIN), and is rebuilt when one has, when the set of MD particles
   has changed (anything born, dead or switched between MD and flight) or when the box has changed. */
const SKIN = 1.0, HSKIN2 = 0.25 * SKIN * SKIN, SKIN_F = 2.0, HSKINF2 = 0.25 * SKIN_F * SKIN_F;
let RL = RC + SKIN, RL2 = RL * RL, RLF2 = (RC + SKIN_F) * (RC + SKIN_F);
let CELL_MIN = RC + Math.max(SKIN, SKIN_F); // (cells at least as wide as either list reaches: a 3 × 3 block of cells holds every partner)
/* The cutoff (1.10, Settings → Experimental → Longer force reach): 6 Å, or 9 or 12. Everything that reaches RC follows
   it; the WebAssembly kernel has 6 Å built in, so a longer reach runs the JavaScript kernels, and the workers are
   started again (their source carries RC2). The potential energy changes with the reach: set it between steps. */
function setCutoff(rc) {
  rc = rc === 9 || rc === 12 ? rc : 6;
  if (typeof WK !== 'undefined') WK.use = rc === 6; // (wasmReady() also needs WK.ready: a kernel that failed stays off)
  if (rc === RC) return false;
  RC = rc; RC2 = rc * rc; RL = RC + SKIN; RL2 = RL * RL; RLF2 = (RC + SKIN_F) * (RC + SKIN_F); CELL_MIN = RC + Math.max(SKIN, SKIN_F);
  _mdGen++; VL.valid = false; FL.gen = -1; // (the neighbour lists are rebuilt at the new reach)
  if (typeof TH !== 'undefined' && TH.n) { const n = TH.n; threadsSet(0); threadsSet(n); }
  return true;
}
const VL = { gen: -1, bx: new Float64Array(16), by: new Float64Array(16), inI: new Int32Array(16), nIn: 0, np: 0, pi: shArray(Int32Array, 4096), pj: shArray(Int32Array, 4096),
  ex: shArray(Uint8Array, 4096), exTopo: -1, exDirty: -1, w: 0, h: 0, wall: '', valid: false, builds: 0, checks: 0, bz: new Float64Array(16), d: 0, useWasm: true }; // (useWasm: the module builds the list when it can, 1.26; tests turn it off)
function vlValid(pre) { // pre ≥ 0: the threaded integrator's largest squared move of the list's atoms, just now (no wrapping)
  if (W.d3) return vlValid3();
  VL.checks++;
  if (!VL.valid || VL.gen !== _mdGen || VL.w !== W.box.w || VL.h !== W.box.h || VL.wall !== W.wall) return false;
  if (pre >= 0 && W.wall !== 'wrap') return pre <= HSKIN2;
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
/* (bug fix 17 after 1.25) Quantum nuclei in 3-D with every bead's full force pass: a 3-D ring reaches 0.5 Å from its
   centre (the flat game's far less), past half the list's skin, so each bead's pass found the list out of date and
   rebuilt the grid and the list (six times a step of eight passes in liquid water: three quarters of the step). While
   that mode runs in 3-D the list reaches PI_SKIN3 farther (and the cells with it) and stays valid for moves up to half
   its wider skin: every bead's pass uses the same list. The forces are the same (a pair is worked out where it is, the
   list only says which to look at). */
const PI_SKIN3 = 1.4;
let _vlE = 0, _hskin3 = HSKIN2;
function vlReachSet(E) {
  if (E === _vlE) return;
  _vlE = E; RL = RC + SKIN + E; RL2 = RL * RL; CELL_MIN = RC + Math.max(SKIN + E, SKIN_F); _hskin3 = 0.25 * (SKIN + E) * (SKIN + E);
  _mdGen++; VL.valid = false; gridTouch(); _gridStale = true;
}
function vlValid3() { // (3-D: the moves in z count, and the box's depth)
  VL.checks++;
  if (!VL.valid || VL.gen !== _mdGen || VL.w !== W.box.w || VL.h !== W.box.h || VL.d !== W.box.d || VL.wall !== W.wall) return false;
  const idx = _mdNI, n = _nmdN;
  const X = S.x, Y = S.y, Zp = S.z, bx = VL.bx, by = VL.by, bz = VL.bz, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = W.box.d, hw = bw / 2, hh = bh / 2, hd = bd / 2;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const s = idx[i];
    let dx = X[s] - bx[i], dy = Y[s] - by[i], dz = Zp[s] - bz[i];
    if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; }
    const d2 = dx * dx + dy * dy + dz * dz; if (d2 > worst) worst = d2;
  }
  return worst <= _hskin3;
}
/* 3-D: vlPairs over the box cells (the 26 around each, those with a greater key). The pairs of the grid's particles
   p0 ≤ k < p1, counted in the order the cells and their particles are walked (a box of a few cells, as the 3-D setups
   have, cannot be shared out by cells), appended at pi[base …] up to base + cap; returns how many, or -1 when they would
   not fit. As vlPairs, it runs on one thread (0, ∞) and, over ranges of particles, on the workers (threads.js
   vlBuildAll3), the stretches joined in order giving the one-thread list pair for pair. */
function vlPairs3(p0, p1, pi, pj, base, cap, g, idx, K, wrap, bw, bh, bd, hw, hh, hd) {
  const keys = g.keys, head = g.head, next = g.next, px = g.px, py = g.py, pz = g.pz, occ = g.occ, cols = g.cols, rows = g.rows, lay = g.lay, gwrap = g.wrap, mask = g.mask, shift = g.shift;
  const RL2 = g.RL2, f = g.fwd3 || (g.fwd3 = new Int32Array(27)), end = base + cap;
  let np = base, ord = 0;
  for (let oc = 0; oc < g.nocc && ord < p1; oc++) {
    const c = occ[oc];
    let nf = -1; // (the cell's forward neighbours, found when its first particle in range comes)
    for (let i = head[c]; i !== -1; i = next[i], ord++) {
      if (ord < p0) continue;
      if (ord >= p1) break;
      if (nf < 0) {
        const key = keys[c], cx = key % cols, cy = ((key / cols) | 0) % rows, cz = (key / (cols * rows)) | 0;
        nf = 0;
        for (let oz = -1; oz <= 1; oz++) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          let x = cx + ox, y = cy + oy, z = cz + oz;
          if (gwrap) { x = (x + cols) % cols; y = (y + rows) % rows; z = (z + lay) % lay; } else if (x < 0 || y < 0 || z < 0 || x >= cols || y >= rows || z >= lay) continue;
          const k = (z * rows + y) * cols + x;
          if (k <= key) continue;
          let s = Math.imul(k, 0x9E3779B1) >>> shift; // (gridFind, inlined: the workers have no G)
          for (;;) { const kk = keys[s]; if (kk === k) break; if (kk === -1) { s = -1; break; } s = (s + 1) & mask; }
          if (s === -1) continue;
          let dup = false; for (let q = 0; q < nf; q++) if (f[q] === s) { dup = true; break; }
          if (!dup) f[nf++] = s;
        }
      }
      const si = idx[i];
      if (K[si] !== 0) continue; // (NUC = 0)
      const ax = px[i], ay = py[i], az = pz[i];
      for (let q = -1; q < nf; q++) { // (q = −1: the same cell, from the next particle on)
        for (let j = q < 0 ? next[i] : head[f[q]]; j !== -1; j = next[j]) {
          const sj = idx[j];
          if (K[sj] !== 0) continue;
          let dx = px[j] - ax, dy = py[j] - ay, dz = pz[j] - az;
          if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; }
          if (dx * dx + dy * dy + dz * dz < RL2) { if (np >= end) return -1; pi[np] = si; pj[np] = sj; np++; }
        }
      }
    }
  }
  return np - base;
}
/* The pairs within RC + SKIN among the occupied cells o0 ≤ oc < o1 of the grid g (its arrays and shape), appended at
   pi[base …] up to base + cap: returns how many, or -1 when they would not fit. Each pair of neighbouring cells is
   visited once, from the lower key (gridForward's rule, inlined with the hash lookup). The same function builds the
   list on one thread and, over ranges of cells, on the workers (threads.js), which write their own stretch of the array:
   the stretches follow the cells' order, so joined they are the list one thread would have built, pair for pair. */
function vlPairs(o0, o1, pi, pj, base, cap, g, idx, K, wrap, bw, bh, hw, hh) {
  const keys = g.keys, head = g.head, next = g.next, px = g.px, py = g.py, occ = g.occ, cols = g.cols, rows = g.rows, mask = g.mask, shift = g.shift, gwrap = g.wrap;
  const RL2 = g.RL2, f = g.fwd || (g.fwd = new Int32Array(8)), end = base + cap;
  let np = base;
  for (let oc = o0; oc < o1; oc++) {
    const c = occ[oc], key = keys[c], cx = key % cols, cy = (key / cols) | 0;
    let nf = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      let x = cx + ox, y = cy + oy;
      if (gwrap) { x = (x + cols) % cols; y = (y + rows) % rows; } else if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const k = y * cols + x;
      if (k <= key) continue;
      let s = Math.imul(k, 0x9E3779B1) >>> shift;
      for (;;) { const kk = keys[s]; if (kk === k) break; if (kk === -1) { s = -1; break; } s = (s + 1) & mask; }
      if (s === -1) continue;
      let dup = false; for (let q = 0; q < nf; q++) if (f[q] === s) { dup = true; break; } // (a tiny periodic box: the same cell from two sides)
      if (!dup) f[nf++] = s;
    }
    for (let i = head[c]; i !== -1; i = next[i]) {
      const si = idx[i];
      if (K[si] !== 0) continue; // (NUC = 0)
      const ax = px[i], ay = py[i];
      for (let j = next[i]; j !== -1; j = next[j]) { // same cell
        const sj = idx[j];
        if (K[sj] !== 0) continue;
        let dx = px[j] - ax, dy = py[j] - ay;
        if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
        if (dx * dx + dy * dy < RL2) { if (np >= end) return -1; pi[np] = si; pj[np] = sj; np++; }
      }
      for (let q = 0; q < nf; q++) { // neighbour cells with a greater key
        for (let j = head[f[q]]; j !== -1; j = next[j]) {
          const sj = idx[j];
          if (K[sj] !== 0) continue;
          let dx = px[j] - ax, dy = py[j] - ay;
          if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
          if (dx * dx + dy * dy < RL2) { if (np >= end) return -1; pi[np] = si; pj[np] = sj; np++; }
        }
      }
    }
  }
  return np - base;
}
/* The same two walks in the WebAssembly module (af_vl, af_vl3, kernel/src/vl.rs, 1.26): the same pairs in the same order
   (whole numbers and comparisons; the distances the same subtractions), several times faster; the 3-D list's walk was a
   fifth of a step in 3-D water and most of quantum nuclei's every-bead passes, which make a list for each bead. ok: the
   module is there and every array is in its memory (on a worker: bound on it); else the JavaScript above. */
function vlPairsW(ok, ex, o0, o1, pi, pj, base, cap, g, idx, K, wrap, bw, bh, hw, hh) {
  if (!ok) return vlPairs(o0, o1, pi, pj, base, cap, g, idx, K, wrap, bw, bh, hw, hh);
  return ex.af_vl(g.keys.byteOffset, g.head.byteOffset, g.next.byteOffset, g.px.byteOffset, g.py.byteOffset, g.px.byteOffset, g.occ.byteOffset, idx.byteOffset, K.byteOffset, pi.byteOffset, pj.byteOffset,
    g.cols, g.rows, 1, g.wrap ? 1 : 0, g.mask, g.shift, g.nocc, g.RL2, wrap ? 1 : 0, bw, bh, 0, hw, hh, 0, o0, o1, base, cap);
}
function vlPairs3W(ok, ex, p0, p1, pi, pj, base, cap, g, idx, K, wrap, bw, bh, bd, hw, hh, hd) {
  if (!ok) return vlPairs3(p0, p1, pi, pj, base, cap, g, idx, K, wrap, bw, bh, bd, hw, hh, hd);
  return ex.af_vl3(g.keys.byteOffset, g.head.byteOffset, g.next.byteOffset, g.px.byteOffset, g.py.byteOffset, g.pz.byteOffset, g.occ.byteOffset, idx.byteOffset, K.byteOffset, pi.byteOffset, pj.byteOffset,
    g.cols, g.rows, g.lay, g.wrap ? 1 : 0, g.mask, g.shift, g.nocc, g.RL2, wrap ? 1 : 0, bw, bh, bd, hw, hh, hd, p0, p1, base, cap);
}
/* May the main thread build the list in the module? (the arrays it reads and writes in its memory) */
function vlWasmOk() {
  if (!wasmReady() || typeof WK.ex.af_vl3 !== 'function' || !VL.useWasm) return false;
  const ok = wasmIn(G.keys, G.head, G.next, G.px, G.py, G.occ, _mdI, S.k, VL.pi, VL.pj) && (!W.d3 || wasmIn(G.pz));
  if (ok) WK.vlCalls++;
  return ok;
}
let vlBuildAll = function () { return -1; }; // eslint-disable-line no-unused-vars
let vlBuildAll3 = function () { return -1; }; // eslint-disable-line no-unused-vars
function vlRoom(cap) { VL.pi = shArray(Int32Array, cap); VL.pj = shArray(Int32Array, cap); _sharedGen++; } // (room for the pairs: the workers are rebound to the new arrays)
function vlBuild() { // from the grid just built over _md (G.px/py are their positions now); nucleus–nucleus pairs only
  VL.builds++;
  const nN = _nmdN, nI = _mdNI, X = S.x, Y = S.y;
  if (VL.bx.length < nN) { VL.bx = new Float64Array(nN * 2 + 16); VL.by = new Float64Array(nN * 2 + 16); }
  for (let q = 0; q < nN; q++) { VL.bx[q] = X[nI[q]]; VL.by[q] = Y[nI[q]]; }
  // the same, by slot, for the threaded integrator's check (vlin marks the slots in this list; the last list's are unmarked first)
  { const VX0 = S.vlx, VY0 = S.vly, IN = S.vlin, P = VL.inI;
    for (let q = 0; q < VL.nIn; q++) IN[P[q]] = 0;
    if (P.length < nN) VL.inI = new Int32Array(nN * 2 + 16);
    for (let q = 0; q < nN; q++) { const i = nI[q]; VX0[i] = X[i]; VY0[i] = Y[i]; IN[i] = 1; VL.inI[q] = i; }
    VL.nIn = nN; }
  VL.gen = _mdGen; VL.w = W.box.w; VL.h = W.box.h; VL.wall = W.wall;
  { const t = _profOn ? performance.now() : 0; gridEnsure(); if (_profOn) _tGrid += performance.now() - t; }
  G.RL2 = RL2;
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2;
  if (W.d3) { // (3-D: the depth and the z of each atom as the list saw it; one thread)
    VL.d = W.box.d; if (VL.bz.length < nN) VL.bz = new Float64Array(nN * 2 + 16);
    const Zp = S.z; for (let q = 0; q < nN; q++) VL.bz[q] = Zp[nI[q]];
    let n3 = vlBuildAll3(); // (the threads, when the pool is up: -1 when they did not)
    while (n3 < 0) { n3 = vlPairs3W(vlWasmOk(), WK.ex, 0, Infinity, VL.pi, VL.pj, 0, VL.pi.length, G, _mdI, S.k, wrap, bw, bh, W.box.d, hw, hh, W.box.d / 2); if (n3 < 0) vlRoom(VL.pi.length * 2 + _nmd); } // (in the module when it can, 1.26)
    VL.np = n3; VL.valid = true; VL.exTopo = -1;
    return;
  }
  let np = vlBuildAll(); // (the threads, when the pool is up: -1 when they did not)
  while (np < 0) {
    np = vlPairsW(vlWasmOk(), WK.ex, 0, G.nocc, VL.pi, VL.pj, 0, VL.pi.length, G, _mdI, S.k, wrap, bw, bh, hw, hh); // (in the module when it can, 1.26)
    if (np < 0) vlRoom(VL.pi.length * 2 + _nmd);
  }
  VL.np = np; VL.valid = true; VL.exTopo = -1;
}
/* Pairs the force loop can skip: two atoms of one molecule that exclude each other (bonded, or 1-3 across an angle
   term), for which atomAtom returns no force (ex = 1); atoms of one molecule that do interact are marked too (ex = 2),
   so the force loop need not look the exclusion up again. Marked once per change of bonding or species, as for the
   angle centres. */
/* The exclusions as arrays the threads can read: for each slot, the ids its atom excludes (EXW at most; a slot with more
   — a lattice atom with many neighbours — sends the marking back to the one-thread Set path). Made again only when
   bonding or species changed (W.topo, W.dirty), not at every rebuild of the list. */
const EXW = 24;
let _exl = shArray(Int32Array, 16 * EXW), _exlN = shArray(Uint8Array, 16), _exlTopo = -1, _exlDirty = -1, _exlOk = true;
function exclLists() {
  const hi = S.hi;
  if (_exlN.length < hi) { const cap = hi * 2 + 64; _exlN = shArray(Uint8Array, cap); _exl = shArray(Int32Array, cap * EXW); _sharedGen++; }
  const OBJ = S.obj, K = S.k, MOL = S.mol, DEAD = S.dead, exl = _exl, exn = _exlN;
  let ok = true;
  for (let i = 0; i < hi; i++) {
    const e = DEAD[i] === 1 || K[i] !== NUC || MOL[i] === 0 ? null : OBJ[i].excl;
    if (!e || !e.size) { exn[i] = 0; continue; }
    if (e.size > EXW) { ok = false; exn[i] = 0; continue; }
    let n = 0; for (const id of e) exl[i * EXW + n++] = id;
    exn[i] = n;
  }
  _exlOk = ok; _exlTopo = W.topo; _exlDirty = W.dirty;
}
/* ex for the pairs q0 ≤ q < q1 from the arrays (the same marks as the Set path). Runs on any thread (threads.js). */
function exRange(q0, q1, ex, pi, pj, K, Z, NE, MOL, ID, exl, exn, exw) {
  for (let q = q0; q < q1; q++) {
    const i = pi[q], j = pj[q], mi = MOL[i];
    let v = 0;
    if (mi !== 0 && mi === MOL[j] && K[i] === 0 && K[j] === 0 && Z[i] > 0 && Z[j] > 0 && NE[i] > 0 && NE[j] > 0) { // (NUC = 0)
      v = 2;
      const idj = ID[j], n = exn[i], b = i * exw;
      for (let k = 0; k < n; k++) if (exl[b + k] === idj) { v = 1; break; }
    }
    ex[q] = v;
  }
}
let exAll = function () { return false; }; // eslint-disable-line no-unused-vars
function vlExclusions() {
  const np = VL.np, pi = VL.pi, pj = VL.pj, K = S.k, Z = S.Z, NE = S.ne, MOL = S.mol, ID = S.id, OBJ = S.obj;
  if (VL.ex.length < np) { VL.ex = shArray(Uint8Array, pi.length); _sharedGen++; }
  const ex = VL.ex;
  if (_exlTopo !== W.topo || _exlDirty !== W.dirty) exclLists();
  if (_exlOk) { if (!exAll()) exRange(0, np, ex, pi, pj, K, Z, NE, MOL, ID, _exl, _exlN, EXW); }
  else for (let q = 0; q < np; q++) {
    const i = pi[q], j = pj[q], mi = MOL[i];
    ex[q] = (mi !== 0 && mi === MOL[j] && K[i] === NUC && K[j] === NUC && Z[i] > 0 && Z[j] > 0 && NE[i] > 0 && NE[j] > 0) ? (OBJ[i].excl.has(ID[j]) ? 1 : 2) : 0; // (2: one molecule, not excluded)
  }
  if (BO.any) for (let q = 0; q < np; q++) { const a = OBJ[pi[q]], b = OBJ[pj[q]]; if (a && b && a.bom && b.bom) ex[q] = 1; } // (continuous bond orders: their pairs are bo.js's)
  if (MBO.on) mbExMark(np, pi, pj, ex); // (many-body metals: a member and an O or H partner are bometal.js's, 1.26)
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
function nearby(x, y, R, cb, z) { // (3-D: around (x, y, z); cb(p, dx, dy, r2, dz), r2 with dz² in it)
  if (W.d3) { nearby3(x, y, z || 0, R, cb); return; }
  gridEnsure();
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, R2 = R * R;
  const sx = Math.ceil(R / G.cw), sy = Math.ceil(R / G.ch);
  const ccx = Math.floor((x + G.hx) / G.cw), ccy = Math.floor((y + G.hy) / G.ch);
  const L = G.list;
  gridWalk(ccx - sx, ccy - sy, ccx + sx, ccy + sy, (i) => {
    const p = L[i];
    if (p.dead) return;
    let dx = p.x - x, dy = p.y - y;
    if (wrap) { if (dx > bw / 2) dx -= bw; else if (dx < -bw / 2) dx += bw; if (dy > bh / 2) dy -= bh; else if (dy < -bh / 2) dy += bh; }
    const r2 = dx * dx + dy * dy;
    if (r2 <= R2 && cb(p, dx, dy, r2) === false) return false;
  });
}

function nearby3(x, y, z, R, cb) {
  gridEnsure();
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = W.box.d, R2 = R * R;
  const sx = Math.ceil(R / G.cw), sy = Math.ceil(R / G.ch), sz = Math.ceil(R / G.cd);
  const ccx = Math.floor((x + G.hx) / G.cw), ccy = Math.floor((y + G.hy) / G.ch), ccz = Math.floor((z + G.hz) / G.cd);
  const L = G.list;
  gridWalk3(ccx - sx, ccy - sy, ccx + sx, ccy + sy, ccz - sz, ccz + sz, (i) => {
    const p = L[i];
    if (p.dead) return;
    let dx = p.x - x, dy = p.y - y, dz = p.z - z;
    if (wrap) { if (dx > bw / 2) dx -= bw; else if (dx < -bw / 2) dx += bw; if (dy > bh / 2) dy -= bh; else if (dy < -bh / 2) dy += bh; if (dz > bd / 2) dz -= bd; else if (dz < -bd / 2) dz += bd; }
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 <= R2 && cb(p, dx, dy, r2, dz) === false) return false;
  });
}

/* ------------------------------------------------------------------ pair interactions */
let _noEv = false;
let _qmHold = false; // (inside the inner steps: the quantum bonds' pass is held, 1.23.1; innerSteps)
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
/* Solvation in two dimensions. A free ion (S.ionic: charged, no bonds) and an atom of a molecule with a partial charge
   (water's O and H, any polar molecule) attract by Coulomb's law between the ion's charge and the partial charge, as
   every pair does; here that pull is doubled. In a flat world an ion has about half the solvent molecules around it
   that it has in space (3–4 waters against 6), and the solvent screens charges far less, so with the plain force
   a Na⁺ and a Cl⁻ in water never parted and salt never dissolved (measured: a 36-ion crystal kept every ion for
   100 ps, an ion pair stayed touching). Doubled, the energy an ion gets from its shell is about what it gets in real
   water, a lone pair parts and stays parted by a layer of water, and a crystal loses its corner and edge ions within
   tens of picoseconds and goes on dissolving. Energy is conserved as before (the potential is doubled with the force). */
const K_IW = 2;
const iwK = (a, b) => (a.ionic !== b.ionic && (a.ionic ? b.q === 0 : a.q === 0) ? K_IW : 1);
/* Stiffest close contact this step, as curvature over reduced mass (1/tu²): chooseDt keeps ω·dt small there,
   so hard collisions are integrated as accurately as gentle ones. */
let _stiff = 0, _stiffL = 0, _passL = 0, _lepEvOff = false;
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
  return ljV(a, b, r) + (qa && qb ? iwK(a, b) * PHYS.KE * qa * qb * (1 / Math.sqrt(r * r + 0.09) - csh(a, b, 0.09)) : 0);
}
/* Coulomb energies inside the cutoff are shifted to zero at RC, except between net charges whose
   long-range part is summed exactly beyond it — so crossing the cutoff never creates energy. */
let _lrOn = false;
/* (bug fix 4 after 1.25) The long-range sum is on while there are at most 220 net charges: crossing that count changes
   the energy's definition (the sum beyond the cutoff, and the shift inside it, 1.09) by up to keV in a dense plasma,
   with nothing physical happening: a fast neutron's cascade among 3-D waters made 221 charges and the books jumped by
   ±2,400–2,800 eV at each crossing. The change is booked (ledger.escaped), measured with the positions and charges of
   the moment, so the books stay continuous; the forces switch as before. */
function lrFlip(on) {
  if (W.parts.length < 2 || typeof totalEnergy !== 'function') { _lrOn = on; return; }
  const a = totalEnergy().pe; _lrOn = on; const b = totalEnergy().pe;
  W.ledger.escaped -= b - a;
}
function isLR(p) { return p.k !== NUC || Math.abs(p.q) >= 1; }
/* Charge of a as felt by b. Free electrons and positrons see net charges only: partial charges stand for
   bond dipoles, whose weak pull on a free electron is outweighed close up by Pauli repulsion from the
   molecule's own electrons. (Kept, they would let an electron sit inside a water molecule's H atom.) */
function qx(a, b) { return a.k === NUC && b.k === NUC ? a.q + a.qp : a.q; }
/* (1.09: between net charges summed beyond the cutoff, the soft-cored energy inside is shifted to meet the exact 1/r
   outside at RC, as every other pair's meets zero there. It was left unshifted: a step of KE·qq·(1/RC − 1/√(RC² + s)),
   0.037 eV for an electron and an O⁺, at each crossing, which the motion never felt but the energy books (events) did:
   ionized water drifted 120–150 eV/ps, falling with a longer cutoff. The forces are unchanged.) */
function csh(a, b, s) { return 1 / Math.sqrt(RC2 + s) - ((_lrOn && isLR(a) && isLR(b)) ? 1 / RC : 0); }
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
    }, p.z);
  }
  return V;
}
/* Does p hold its bonds at VSEPR angles? (Transition metals and f-block atoms do not, here.) */
function angled(p) { const n = p.bonds.length; return n >= 2 && n <= 6 && !!p.el && !p.el.dblock; }
/* Bending energy of a VSEPR centre: ½K Σ(gap − target)². */
function angleEnergy(p) {
  if (W.d3) return angleEnergy3(p);
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
/* The bending energy of the centres (the set's atoms and their bonded neighbours). In 3-D a dihedral X–A=B–Y is owned
   by A or B (the lower id), which can be two bonds from an atom X of the set: the centres reach one bond further. */
function centresAngleE(centres) {
  if (W.d3) for (const c of [...centres]) for (const bd of c.bonds) centres.add(other(bd, c));
  let V = 0; for (const c of centres) V += angleEnergy(c);
  return V;
}
function localFastE(set) { // (localPE's bonds and bends alone)
  let V = 0; const seenB = new Set(), centres = new Set();
  for (const p of set) { centres.add(p); for (const bd of p.bonds) { const o = other(bd, p); centres.add(o); if (!seenB.has(bd)) { seenB.add(bd); V += -bd.D - bd.Ef + morseV(bd, dist(bd.a, bd.b)); } } }
  V += centresAngleE(centres);
  return V;
}
/* Potential energy that a chemical event can change: bonds, bends and non-bonded terms of the set
   with itself and its surroundings. Used to make bond-making and -breaking conserve energy. */
function localPE(set, skip) {
  if (PI.on && PI.n && !PI.inPE && piContract()) { // (contracted rings: the whole at the centres, the bonds and bends over the beads, as the forces have it, 1.21)
    let V; PI.inPE = true; try { V = localPE(set, skip) - localFastE(set); for (let k = 0; k < PI.P; k++) { piShift(k, 1); V += localFastE(set) / PI.P; piShift(k, -1); } } finally { PI.inPE = false; } return V;
  }
  if (PI.on && PI.n && !PI.inPE) { let V = 0; PI.inPE = true; try { for (let k = 0; k < PI.P; k++) { piShift(k, 1); V += localPE(set, skip); piShift(k, -1); } } finally { PI.inPE = false; } return V / PI.P; } // (quantum nuclei: over every bead's copy)
  let V = 0;
  const seenB = new Set(), centres = new Set();
  for (const p of set) {
    centres.add(p);
    for (const bd of p.bonds) {
      const o = other(bd, p); centres.add(o);
      if (!seenB.has(bd)) { seenB.add(bd); V += -bd.D - bd.Ef + morseV(bd, dist(bd.a, bd.b)); }
    }
  }
  V += centresAngleE(centres);
  if (W.magnets.length) { const kT = PHYS.KB * Math.max(W.T, 1); for (const p of set) if (!p.dead) V += magU(p, kT); }
  if (W.Ex || W.Ey || (W.d3 && W.Ez)) for (const p of set) if (!p.dead) V += fieldU(p); // (the applied field, bug fix 6 after 1.25)
  for (const p of set) if (p.qi) V += qeqSelf(p); // (the polarization energy of induced charges, 1.12)
  farMetalPairs((a, b, dx, dy, r) => { V += metalV(a, b, r); }, set);
  if (W.wall === 'reflect' || W.objs.length) { // soft walls (and placed objects')
    for (const p of set) {
      if (p.fast || p.rad || p.k !== NUC) continue;
      if (W.wall === 'reflect') V += wallPE(p);
      V += objPE(p);
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
      if (p.bom && o.bom) return; // (continuous bond orders: bo.js's)
      if (MBO.on && mbEx(p, o)) return; // (many-body metals and their O and H partners: bometal.js's, 1.26)
      V += nucPairV(p, o, r2);
    };
    nearby(p.x, p.y, RC, visit, p.z);
    for (const o of _late) { // created since the grid was built
      if (o.dead || o.rad || o.fast) continue;
      const dx = o.x - p.x, dy = o.y - p.y, dz = o.z - p.z, r2 = dx * dx + dy * dy + dz * dz;
      if (r2 < RC2) visit(o, dx, dy, r2);
    }
  }
  if (WAVE.n) V += waveLocal(set, skip); // (electrons as waves: the packets' share with these ions, 1.15)
  if (MBO.on) V += mbLocal(set); // (metals' many-body energy, 1.25)
  if (SITES.any) V += sitesLocal(set, skip); // (off-atom charge sites, 1.26)
  if (_lrOn) { // exact long-range Coulomb between net charges beyond the cutoff (as in computeForces)
    for (const p of set) {
      if (p.k !== NUC || p.dead || p.fast || p.rad || !isLR(p)) continue;
      for (const o of _charged) {
        if (o === p || o === skip || o.dead || o.fast || o.rad || !isLR(o) || (set.has(o) && o.id < p.id)) continue;
        const dx = o.x - p.x, dy = o.y - p.y, dz = o.z - p.z, r2 = dx * dx + dy * dy + dz * dz;
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
function coulAA(a, b, r2) { const qa = a.q + a.qp, qb = b.q + b.qp; return qa && qb ? iwK(a, b) * PHYS.KE * qa * qb * (1 / Math.sqrt(r2 + 0.09) - csh(a, b, 0.09)) : 0; }
/* Electronic energy held by an atom's bound electrons (relative to the bare nucleus): minus the energy to strip
   them one by one, −Σ ionE (for extra electrons, the electron affinities, negative for the unbound ones). Changes
   in it are paid for or released by every event. */
function internalE(p) {
  if (p.k !== NUC || p.Z === 0 || p.ne === 0) return 0;
  let E = 0;
  for (let k = 1; k <= p.ne; k++) E -= ionE(zChem(p), k);
  return E;
}
function neutralInternalE(p) { // the same atom with as many electrons as protons
  if (p.k !== NUC || p.Z === 0) return 0;
  let E = 0; const zc = zChem(p); for (let k = 1; k <= zc; k++) E -= ionE(zc, k);
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
  let Ma = 0, Mb = 0, pax = 0, pay = 0, pbx = 0, pby = 0, paz = 0, pbz = 0;
  for (const p of ma) { Ma += p.m; pax += p.m * p.vx; pay += p.m * p.vy; paz += p.m * p.vz; }
  for (const p of mb) { Mb += p.m; pbx += p.m * p.vx; pby += p.m * p.vy; pbz += p.m * p.vz; }
  const [dx, dy, dz] = minImg(b.x - a.x, b.y - a.y, b.z - a.z);
  const r = hyp3(dx, dy, dz) || 1e-6, ux = dx / r, uy = dy / r, uz = dz / r, M = Ma + Mb;
  const sh = r - r0;
  for (const p of ma) { p.x += ux * sh * Mb / M; p.y += uy * sh * Mb / M; if (uz) p.z += uz * sh * Mb / M; }
  for (const p of mb) { p.x -= ux * sh * Ma / M; p.y -= uy * sh * Ma / M; if (uz) p.z -= uz * sh * Ma / M; }
  const vr = (pbx / Mb - pax / Ma) * ux + (pby / Mb - pay / Ma) * uy + (uz ? (pbz / Mb - paz / Ma) * uz : 0);
  const mu = Ma * Mb / M;
  for (const p of ma) { p.vx += ux * vr * Mb / M; p.vy += uy * vr * Mb / M; if (uz) p.vz += uz * vr * Mb / M; }
  for (const p of mb) { p.vx -= ux * vr * Ma / M; p.vy -= uy * vr * Ma / M; if (uz) p.vz -= uz * vr * Ma / M; }
  return 0.5 * mu * vr * vr;
}
/* Metal pairs farther apart than the cutoff RC but within their metallic reach 2.1·r_m: cb(a, b, dx, dy, r) once
   per pair (dx, dy: b − a). set: only pairs with a member in it (for localPE). */
let MR_MAX = 0;
function isFarMetal(p) { return p.isMetal && p.k === NUC && p.ne > 0 && !p.dead && !p.fast && !p.rad && 2.1 * p.mR > RC; }
let _farMetalSeen = false; // (set by setSize when such an atom is made; cleared with the world)
function farMetalPairs(cb, set) {
  if (!_farMetalSeen) return;
  gridEnsure();
  if (!G.n) return;
  if (!MR_MAX) for (const el of ELEMENTS) if (el && el.metal) MR_MAX = Math.max(MR_MAX, 2 * el.rc * 1.12);
  const src = set || G.list;
  for (const a of src) {
    if (!isFarMetal(a)) continue;
    nearby(a.x, a.y, 1.05 * (a.mR + MR_MAX), (b, dx, dy, r2, dz) => {
      if (b === a || r2 < RC2 || !b.isMetal || b.k !== NUC || b.ne === 0 || b.fast || b.rad || b.dead) return;
      const rm = 0.5 * (a.mR + b.mR);
      if (r2 >= 4.41 * rm * rm) return;
      if (isFarMetal(b) && b.id < a.id && (!set || set.has(b))) return; // both reach this far: count the pair once
      if (opp(a, b) || (a.mol !== 0 && a.mol === b.mol && a.excl && a.excl.has(b.id))) return;
      cb(a, b, dx, dy, Math.sqrt(r2), dz || 0);
    }, a.z);
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
  if (MBO.on && (MB_X[a.Z] || MB_X[b.Z]) && (mbIs(a.i) || mbIs(b.i))) return false; // (a many-body metal's bonds to O and H are bometal.js's, 1.26)
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
        dH = (DAB - bondEnergy(A.el, B.el, bd.order - 1)) - DXA + (bd.arom ? (bd.reSys || AROM_STAB) - (bd.reShare || 0) : 0); // (resonating: the rest of the system's resonance energy is lost too)
        Ea = dH < 0 ? Math.max(0.05, 0.5 + 0.25 * dH) : 0.5 + 0.75 * dH;
        if (Ea < best.Ea) best = { type: 'add', bd, dH, Ea };
      }
    }
    if (best) {
      // nearby transition-metal catalyst lowers the barrier
      let cat = false;
      nearby(A.x, A.y, 4.5, (p) => { if (p.el && CATALYSTS.has(p.Z) && p.ne > 0 && p !== A && p !== X) { cat = true; return false; } }, A.z);
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
  const LJR = S.ljR, VX = S.vx, VY = S.vy, M = S.m, ELRC = S.elrc, LP = S.lp, MET = S.metal, IONIC = S.ionic;
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
      if (qa !== 0 && qb !== 0) { const s2 = r * r + 0.09; f += (IONIC[i] !== IONIC[j] && (IONIC[i] === 1 ? qj === 0 : qi === 0) ? K_IW : 1) * K_COUL * qa * qb * r / (s2 * Math.sqrt(s2)); } // (K_IW: an ion and a polar molecule)
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
/* ---- The 3-D kernels (stage 4: inside the markers, so that the worker threads run them too; kernel/src/d3.rs has
   them in Rust, af_forces3). The same physics as the pair, bond and angle kernels with distances and forces in three
   directions. pairKernel3 is pairKernel line for line with z added; keep the two the same. The bond angles in 3-D are
   described with vsepr3 (outside the markers, with the per-centre targets AC3 that the kernels read). */
function pairKernel3(pi, pj, ex, q0, q1, FXo, FYo, FZo, CQ, nc0, wrap, bw, bh, bd, hw, hh, hd, step) {
  const X = S.x, Y = S.y, Zp = S.z, VZ = S.vz, Z = S.Z, NE = S.ne, Q = S.q, QP = S.qp, ANTI = S.anti, ISM = S.isMetal, CAP = S.cap, USED = S.used, XD = S.xferD, XA = S.xferA, ID = S.id;
  const LJR = S.ljR, VX = S.vx, VY = S.vy, M = S.m, ELRC = S.elrc, LP = S.lp, MET = S.metal, IONIC = S.ionic;
  let nc = nc0;
  for (let q = q0; q < q1; q++) {
    const exq = ex[q];
    if (exq === 1) continue;
    const i = pi[q], j = pj[q];
    let dx = X[j] - X[i], dy = Y[j] - Y[i], dz = Zp[j] - Zp[i];
    if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; }
    const r2 = dx * dx + dy * dy + dz * dz;
    if (!(r2 < RC2 && r2 > 1e-10)) continue;
    const Zi = Z[i], Zj = Z[j];
    if (Zi === 0 || Zj === 0) continue; // neutrons fly straight
    const r = Math.sqrt(r2), ni = NE[i], nj = NE[j];
    let f = 0;
    if (ANTI[i] !== ANTI[j]) { _kN = nc; f = antiPairI(i, j, r, CQ, nc); nc = _kN; }
    else if (ni > 0 && nj > 0) { // two atoms or ions (atomAtom)
      const qi = Q[i], qj = Q[j], qa = qi + QP[i], qb = qj + QP[j];
      if (qa !== 0 && qb !== 0) { const s2 = r * r + 0.09; f += (IONIC[i] !== IONIC[j] && (IONIC[i] === 1 ? qj === 0 : qi === 0) ? K_IW : 1) * K_COUL * qa * qb * r / (s2 * Math.sqrt(s2)); } // (K_IW: an ion and a polar molecule)
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
        const dvx = VX[j] - VX[i], dvy = VY[j] - VY[i], dvz = VZ[j] - VZ[i], v2 = dvx * dvx + dvy * dvy + dvz * dvz;
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
    const fx = f * dx / r, fy = f * dy / r, fz = f * dz / r;
    FXo[j] += fx; FYo[j] += fy; FZo[j] += fz; FXo[i] -= fx; FYo[i] -= fy; FZo[i] -= fz;
  }
  return nc;
}
/* The bonds (Morse) in 3-D: bondKernel with z. */
function bondKernel3(b0, b1, FXo, FYo, FZo, CQ, nc, wrap, bw, bh, bd, hw, hh, hd) {
  const X = S.x, Y = S.y, Zp = S.z, A = BD.a, B = BD.b, R0 = BD.r0, AL = BD.al, DD = BD.D, RB = BD.rb;
  for (let k = b0; k < b1; k++) {
    const i = A[k], j = B[k];
    let dx = X[j] - X[i], dy = Y[j] - Y[i], dz = Zp[j] - Zp[i];
    if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; }
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    const d = r - R0[k], al = AL[k];
    const e = Math.exp(-al * (d < -0.6 ? -0.6 : d));
    let f = -2 * DD[k] * al * (1 - e) * e;
    if (f > FCAP) f = FCAP; else if (f < -FCAP) f = -FCAP;
    const fx = f * dx / r, fy = f * dy / r, fz = f * dz / r;
    FXo[j] += fx; FYo[j] += fy; FZo[j] += fz; FXo[i] -= fx; FYo[i] -= fy; FZo[i] -= fz;
    if (d > RB[k]) { CQ[nc] = CAND_BREAK; CQ[nc + 1] = k; CQ[nc + 2] = 0; nc += 3; }
  }
  return nc;
}

const K_OOP = 2.0, K_TOR = 1.2;
const K3_DIV = [1, 1, 1, 2, 1.5, 2, 2];
const _a3x = new Float64Array(6), _a3y = new Float64Array(6), _a3z = new Float64Array(6), _a3r = new Float64Array(6), _a3n = new Int32Array(6);
/* The box the 3-D angle terms take minimum images in (KB3: set by the kernel's caller; angle3Centre and triple3 outside
   the markers set it from W), and the vector from slot i to slot j in it, into _kv3. */
const KB3 = { wrap: false, bw: 0, bh: 0, bd: 0 };
const _kv3 = [0, 0, 0];
function kvec3(i, j) {
  let dx = S.x[j] - S.x[i], dy = S.y[j] - S.y[i], dz = S.z[j] - S.z[i];
  if (KB3.wrap) { const bw = KB3.bw, bh = KB3.bh, bd = KB3.bd;
    if (dx > bw / 2) dx -= bw; else if (dx < -bw / 2) dx += bw; if (dy > bh / 2) dy -= bh; else if (dy < -bh / 2) dy += bh; if (dz > bd / 2) dz -= bd; else if (dz < -bd / 2) dz += bd; }
  _kv3[0] = dx; _kv3[1] = dy; _kv3[2] = dz; return _kv3;
}
/* The angle terms of one centre (slot pc, neighbour slots nb[0 … n−1]): returns their energy, and adds their forces to
   FX/FY/FZ when given. The same function gives the kernel its forces and angleEnergy its energy. */
function angle3CentreK(pc, nb, n, mode, t0, flat, FX, FY, FZ) {
  const ux = _a3x, uy = _a3y, uz = _a3z, rr = _a3r, K = ANGLE_K / K3_DIV[n];
  for (let k = 0; k < n; k++) {
    const v = kvec3(pc, nb[k]), r = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1e-9;
    ux[k] = v[0] / r; uy[k] = v[1] / r; uz[k] = v[2] / r; rr[k] = r;
  }
  // every pair's cos θ and θ (atan2 of the cross product's length: exact at every angle)
  const PC = _apc, PT = _apt, PE = _ape, TG = _atg;
  let np = 0;
  for (let k = 0; k < n; k++) for (let l = k + 1; l < n; l++) {
    const c = ux[k] * ux[l] + uy[k] * uy[l] + uz[k] * uz[l];
    const cx = uy[k] * uz[l] - uz[k] * uy[l], cy = uz[k] * ux[l] - ux[k] * uz[l], cz = ux[k] * uy[l] - uy[k] * ux[l];
    PC[np] = c; PT[np] = Math.atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), c); np++;
  }
  // each pair's target (TG: 0 → t0, 1 → 90°, 2 → 120°, 3 → 180°)
  if (mode === 0) TG.fill(0, 0, np);
  else if (mode === 2) { for (let q = 0; q < np; q++) TG[q] = pairAngE(K, PT[q], PC[q], Math.PI) <= pairAngE(K, PT[q], PC[q], A90) ? 3 : 1; } // (each pair the nearer of 90° and 180°)
  else { // 3: two bonds axial, the rest equatorial (of a trigonal bipyramid); 4: the bonds in two trans pairs (square planar). The assignment of lowest energy, so the energy is continuous where two cross
    for (let q = 0; q < np; q++) { PE[3 * q] = pairAngE(K, PT[q], PC[q], A90); PE[3 * q + 1] = pairAngE(K, PT[q], PC[q], A120); PE[3 * q + 2] = pairAngE(K, PT[q], PC[q], Math.PI); }
    let best = Infinity, bk = 0, bl = 0;
    if (mode === 3) {
      for (let a = 0; a < n; a++) for (let b2 = a + 1; b2 < n; b2++) {
        let e = 0, q = 0;
        for (let k = 0; k < n; k++) for (let l = k + 1; l < n; l++, q++) { const ax = (k === a || k === b2 ? 1 : 0) + (l === a || l === b2 ? 1 : 0); e += PE[3 * q + (ax === 2 ? 2 : ax === 1 ? 0 : 1)]; }
        if (e < best) { best = e; bk = a; bl = b2; }
      }
      let q = 0;
      for (let k = 0; k < n; k++) for (let l = k + 1; l < n; l++, q++) { const ax = (k === bk || k === bl ? 1 : 0) + (l === bk || l === bl ? 1 : 0); TG[q] = ax === 2 ? 3 : ax === 1 ? 1 : 2; }
    } else { // (n = 4) partner of bond 0: 1, 2 or 3; the other two the second trans pair
      for (let m = 1; m < 4; m++) {
        let e = 0, q = 0;
        for (let k = 0; k < 4; k++) for (let l = k + 1; l < 4; l++, q++) e += PE[3 * q + (transPair(k, l, m) ? 2 : 0)];
        if (e < best) { best = e; bk = m; }
      }
      let q = 0;
      for (let k = 0; k < 4; k++) for (let l = k + 1; l < 4; l++, q++) TG[q] = transPair(k, l, bk) ? 3 : 1;
    }
  }
  let E = 0, cfx = 0, cfy = 0, cfz = 0, q = 0;
  for (let k = 0; k < n; k++) for (let l = k + 1; l < n; l++, q++) {
    const c = PC[q], tg = TG[q];
    E += pairAngE(K, PT[q], c, tg === 0 ? t0 : tg === 1 ? A90 : tg === 2 ? A120 : Math.PI);
    const g = _pg; // (the force on bond k is g/r_k·(u_l − c·u_k), on bond l likewise)
    if (FX && g !== 0) {
      const ak = g / rr[k], al = g / rr[l];
      const fkx = ak * (ux[l] - c * ux[k]), fky = ak * (uy[l] - c * uy[k]), fkz = ak * (uz[l] - c * uz[k]);
      const flx = al * (ux[k] - c * ux[l]), fly = al * (uy[k] - c * uy[l]), flz = al * (uz[k] - c * uz[l]);
      const ok = nb[k], ol = nb[l];
      FX[ok] += fkx; FY[ok] += fky; FZ[ok] += fkz; FX[ol] += flx; FY[ol] += fly; FZ[ol] += flz;
      cfx += fkx + flx; cfy += fky + fly; cfz += fkz + flz;
    }
  }
  if (FX) { FX[pc] -= cfx; FY[pc] -= cfy; FZ[pc] -= cfz; }
  if (flat && n === 3) E += triple3K(pc, nb[0], pc, nb[1], pc, nb[2], K_OOP, FX, FY, FZ);
  return E;
}
const A90 = Math.PI / 2, A120 = 2 * Math.PI / 3;
const _apc = new Float64Array(15), _apt = new Float64Array(15), _ape = new Float64Array(45), _atg = new Uint8Array(15);
function transPair(k, l, m) { return (k === 0 && l === m) || (k !== 0 && l !== m && k !== m); } // (bonds 0 and m trans, the other two trans)
/* One pair's term at angle θ (cos θ = c) for the target t: about a bent target the cosine form (K/sin²t)·(cos θ − cos t)²,
   as stiff as K(θ − t)² at its minimum and free of that form's false minima (four bonds all bent to one side, an
   umbrella, is a local minimum of ΣK(θ − θ₀)², 1.33 K above the tetrahedron, which a flat CH₄ relaxed into; of the
   cosine form it is a saddle); about 180° the angle form K(θ − π)², which the cosine form would make quartic, with
   its slope over sin θ finite at 180°. Returns the energy; _pg: the factor g for the forces. */
let _pg = 0;
function pairAngE(K, th, c, t) {
  if (t > 3.14159) { const d = th - Math.PI, s = Math.sin(th); _pg = s > 1e-9 ? 2 * K * d / s : -2 * K; return K * d * d; } // (d/sin θ → −1 at 180°)
  const st = Math.sin(t), Kc = K / (st * st), dc = c - Math.cos(t);
  _pg = -2 * Kc * dc; return Kc * dc * dc;
}
/* E = Kt·(û₁·û₂×û₃)² for the three vectors b_k = x[k1] − x[k0] (minimum image): returns E, adds the forces when FX is
   given. An improper has all three from the centre; a dihedral X–A–B–Y is the chain X→A, A→B, B→Y. */
const _tb = new Float64Array(9), _tl = new Float64Array(3);
function triple3K(i0, i1, j0, j1, k0, k1, Kt, FX, FY, FZ) {
  const b = _tb, L = _tl, ends = [i0, i1, j0, j1, k0, k1];
  for (let m = 0; m < 3; m++) {
    const v = kvec3(ends[2 * m], ends[2 * m + 1]), l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1e-9;
    b[3 * m] = v[0] / l; b[3 * m + 1] = v[1] / l; b[3 * m + 2] = v[2] / l; L[m] = l;
  }
  const g1x = b[4] * b[8] - b[5] * b[7], g1y = b[5] * b[6] - b[3] * b[8], g1z = b[3] * b[7] - b[4] * b[6]; // u₂×u₃
  const T = b[0] * g1x + b[1] * g1y + b[2] * g1z;
  if (FX) {
    const g2x = b[7] * b[2] - b[8] * b[1], g2y = b[8] * b[0] - b[6] * b[2], g2z = b[6] * b[1] - b[7] * b[0]; // u₃×u₁
    const g3x = b[1] * b[5] - b[2] * b[4], g3y = b[2] * b[3] - b[0] * b[5], g3z = b[0] * b[4] - b[1] * b[3]; // u₁×u₂
    const gx = [g1x, g2x, g3x], gy = [g1y, g2y, g3y], gz = [g1z, g2z, g3z], w = 2 * Kt * T;
    for (let m = 0; m < 3; m++) { // dE/db_m = 2KtT·(g_m − T·u_m)/|b_m|: minus it on the far end, plus it on the near end
      const a = w / L[m], Gx = a * (gx[m] - T * b[3 * m]), Gy = a * (gy[m] - T * b[3 * m + 1]), Gz = a * (gz[m] - T * b[3 * m + 2]);
      const n0 = ends[2 * m], n1 = ends[2 * m + 1];
      FX[n1] -= Gx; FY[n1] -= Gy; FZ[n1] -= Gz; FX[n0] += Gx; FY[n0] += Gy; FZ[n0] += Gz;
    }
  }
  return Kt * T * T;
}
const _nb3 = new Int32Array(6);
/* The angle terms of centres c0 ≤ c < c1 (AC, with AC3's targets) and the dihedrals t0 ≤ t < t1 (AC3.tq), in 3-D. */
function angleKernel3(c0, c1, t0, t1, FX, FY, FZ, wrap, bw, bh, bd) {
  KB3.wrap = wrap; KB3.bw = bw; KB3.bh = bh; KB3.bd = bd;
  const cs = AC.c, nbs = AC.nb, cnt = AC.cnt, MODE = AC3.mode, T0 = AC3.t0, FLAT = AC3.flat;
  for (let c = c0; c < c1; c++) {
    const n = cnt[c], b0 = c * 6;
    for (let k = 0; k < n; k++) _nb3[k] = nbs[b0 + k];
    angle3CentreK(cs[c], _nb3, n, MODE[c], T0[c], FLAT[c], FX, FY, FZ);
  }
  const tq = AC3.tq;
  for (let t = t0; t < t1; t++) { const X = tq[4 * t], A = tq[4 * t + 1], B = tq[4 * t + 2], Y = tq[4 * t + 3]; triple3K(X, A, A, B, B, Y, K_TOR, FX, FY, FZ); }
}
/* ======================================================================== PAIR KERNEL END */
/* ======================================================================== 3-D (outside the kernels)
   Bond-angle targets in 3-D, the per-centre arrays the 3-D kernels read, and the 3-D force pass (one thread here;
   threads.js replaces nucleusPairs3 when workers are available). */
/* ---- Bond angles in 3-D (VSEPR). The flat game's term (bonds sorted round a circle, the gaps between them held at
   their targets) has no meaning in space. Here every pair of bonds at a centre has its own angle θ, held at its VSEPR
   value θ₀, with the centre's bonds and lone pairs as the electron domains:
     2 domains 180°; 3 domains 120°; 4 domains 109.47°, lone pairs closing the bonds up (NH₃ 107°, H₂O 104.5°, and the
     heavier hydrides' 92–94°, as in the flat game);
     5 domains (a trigonal bipyramid, lone pairs equatorial: ClF₃ T-shaped, SF₄ see-saw, PCl₅): two bonds axial (180°
     between them), the rest equatorial (120°), 90° between the two kinds; which bonds are axial is the assignment of
     lowest energy, so the energy stays continuous when it changes;
     6 domains: XeF₄ two trans pairs (square planar); BrF₅, SF₆ each pair the nearer of 90° and 180°.
   Each pair's term: about a bent target the cosine form (K₃/sin²θ₀)·(cos θ − cos θ₀)², as stiff as K₃(θ − θ₀)² at its
   minimum; the plain angle form has false minima (four bonds bent to one side, an umbrella, is a local minimum of
   ΣK(θ − θ₀)², 1.33 K above the tetrahedron, and a flat CH₄ relaxed into it), the cosine form has none (tried from 300
   random starts). About 180° the angle form K₃(θ − π)², with θ from atan2(|u×v|, u·v) and its slope over sin θ finite
   there, so a linear CO₂ bends harmonically (the cosine form would make it quartic). K₃ is set per centre so that
   turning one bond against the others is as stiff as in the flat game (ANGLE_K·δ²): K₃ = ANGLE_K for two bonds,
   ANGLE_K/2 for three (both its neighbours' angles change), ANGLE_K/1.5 for four.
   Two terms the flat world never needed:
     trigonal planar centres (three bonds, no lone pair: BF₃, a carbonyl or alkene carbon) are held flat by
     E = K_OOP·(u₁·u₂×u₃)², the triple product of the bond directions (their pairs' 120° alone hold them flat only to
     fourth order);
     double and aromatic bonds between two such centres do not twist: E = K_TOR·(û₁·û₂×û₃)² over each dihedral
     X–A=B–Y, which is K_TOR·sin²θ₁·sin²θ₂·sin²φ, smooth at every geometry (zero cis or trans), 2.7 eV over ethylene's
     four dihedrals at 90° (its measured barrier, ~65 kcal/mol). */
const D2R = Math.PI / 180;
/* [mode, θ₀, flat]: mode 0 one target θ₀ for every pair; 2 each pair the nearer of 90° and 180°; 3 two bonds axial and
   the rest equatorial (180° between the axial pair, 90° axial–equatorial, 120° equatorial); 4 two trans pairs (180°, the
   rest 90°). In 3 and 4 the roles are the bonds' assignment of lowest energy. flat: the out-of-plane term. */
function vsepr3(n, lp, per, allH) {
  const steric = n + lp;
  if (n === 2) {
    let th;
    if (steric <= 2 || steric >= 5) th = Math.PI;
    else if (steric === 3) th = 119.5 * D2R;
    else th = (per >= 3 && allH) ? 92 * D2R : 104.5 * D2R;
    return [0, th, 0];
  }
  if (steric <= 4) {
    if (n === 3) return steric === 3 ? [0, A120, 1] : [0, (per >= 3 && allH) ? 93.5 * D2R : 107 * D2R, 0];
    return [0, Math.acos(-1 / 3), 0]; // (n = 4)
  }
  if (steric === 5) return [3, 0, 0]; // (ClF₃ T-shaped, SF₄ see-saw, PCl₅: lone pairs equatorial)
  if (steric === 6 && n === 4) return [4, 0, 0]; // (XeF₄: lone pairs trans, square planar)
  return [2, 0, 0]; // (BrF₅, SF₆)
}
const _at3Cache = new Map();
function angleTargets3(p, n) {
  const lp = p.lp, per = p.el ? periodOf(p.el.Z) : 2;
  let allH = true; for (const bd of p.bonds) if (other(bd, p).Z !== 1) { allH = false; break; }
  const key = n * 1000 + lp * 100 + per * 10 + (allH ? 1 : 0);
  let t = _at3Cache.get(key);
  if (!t) { t = vsepr3(n, lp, per, allH); _at3Cache.set(key, t); }
  return t;
}
/* A trigonal (sp²-like) centre: two or three bonds and one domain short of four (a double bond's ends, aromatic atoms). */
function trig3(p) { const n = p.bonds.length; return n >= 2 && n + p.lp === 3 && !!p.el && !p.el.dblock; }
function torsional3(bd) { return (bd.order === 2 || !!bd.arom) && trig3(bd.a) && trig3(bd.b); }
/* The vector from slot i to slot j (minimum image), into _v3. */
const _v3 = [0, 0, 0];
function vec3(i, j) {
  let dx = S.x[j] - S.x[i], dy = S.y[j] - S.y[i], dz = S.z[j] - S.z[i];
  if (W.wall === 'wrap') { const bw = W.box.w, bh = W.box.h, bd = W.box.d;
    if (dx > bw / 2) dx -= bw; else if (dx < -bw / 2) dx += bw; if (dy > bh / 2) dy -= bh; else if (dy < -bh / 2) dy += bh; if (dz > bd / 2) dz -= bd; else if (dz < -bd / 2) dz += bd; }
  _v3[0] = dx; _v3[1] = dy; _v3[2] = dz; return _v3;
}
/* The angle terms of one centre and the triple-product terms, for callers outside the kernels (energies, relax3): the
   kernels' own functions in the box of W. */
function kb3FromW() { KB3.wrap = W.wall === 'wrap'; KB3.bw = W.box.w; KB3.bh = W.box.h; KB3.bd = W.box.d; }
function angle3Centre(pc, nb, n, mode, t0, flat, FX, FY, FZ) { kb3FromW(); return angle3CentreK(pc, nb, n, mode, t0, flat, FX, FY, FZ); }
function triple3(i0, i1, j0, j1, k0, k1, Kt, FX, FY, FZ) { kb3FromW(); return triple3K(i0, i1, j0, j1, k0, k1, Kt, FX, FY, FZ); }
/* The dihedrals X–A=B–Y of a double or aromatic bond between two trigonal centres: cb(X, A, B, Y). */
function torsionsOf3(bd, cb) {
  if (!torsional3(bd)) return;
  const A = bd.a, B = bd.b;
  for (const ba of A.bonds) { if (ba === bd) continue; const X = other(ba, A);
    for (const bb of B.bonds) { if (bb === bd) continue; const Y = other(bb, B); if (X !== Y) cb(X, A, B, Y); } }
}
/* Bending energy of a centre in 3-D, exactly as angleKernel3 has it: its pairs of bonds, its flatness, and the dihedrals
   of its double bonds that it owns (the bond's atom with the lower id). */
function angleEnergy3(p) {
  const n = p.bonds.length;
  if (n < 2 || n > 6 || !p.el || p.el.dblock) return 0;
  const nb = _a3n; for (let k = 0; k < n; k++) nb[k] = other(p.bonds[k], p).i;
  const t = angleTargets3(p, n);
  let E = angle3Centre(p.i, nb, n, t[0], t[1], t[2], null, null, null);
  for (const bd of p.bonds) if (p.id < other(bd, p).id) torsionsOf3(bd, (X, A, B, Y) => { E += triple3(X.i, A.i, A.i, B.i, B.i, Y.i, K_TOR, null, null, null); });
  for (const bd of p.bonds) if (p.id < other(bd, p).id) tors1Of3(bd, (X, A, B, Y, k) => { E += tors1K(X.i, A.i, B.i, Y.i, k[0], k[1], k[2], k[3], null, null, null); }); // (the single bonds' twist, 1.25; KB3 set by triple3 or below)
  return E;
}
/* ---- Single bonds' twist (3-D, 1.25; the owner: single bonds should have their real twist barrier). Before, only double
   and aromatic bonds resisted twisting, and ethane's methyls turned against nothing but their hydrogens' contact (0.025 eV
   against a measured 0.126). Each dihedral X–A–B–Y about a single bond has
     E = F·(k₀ + k₁ cos φ + k₂ cos 2φ + k₃ cos 3φ),  F = sin³θ₁·sin³θ₂ / sin⁶(109.47°)
   (φ the dihedral, 0 when X and Y eclipse; θ₁, θ₂ the bond angles X–A–B and A–B–Y). Written through u = b̂₁×b̂₂ and
   v = b̂₂×b̂₃ (|u|·|v|·cos φ = u·v), F·cos nφ is a polynomial in u·v and |u|²|v|², smooth at every geometry and
   vanishing where an end goes straight (as the double bonds' term does); F is 1 at tetrahedral angles. The k's, per
   dihedral, by the central bond and its ends (TOR1), fitted in this game to the measured barriers on top of what its
   1-4 contacts already give (PERF-NOTES 1.25): sp³–sp³ C–C (by how many of X, Y are heavy atoms), C–O, C–N, O–O
   (hydrogen peroxide's twofold shape); sp³–sp² C–C=C and C–C=O, counted only on the dihedrals to the double bond's
   partner (the other partner's would cancel them), the double bond eclipsed at the minimum (propene, acetaldehyde).
   Not given one: other central pairs (Si, S, P …), bonds between two sp² ends (butadiene's middle), aromatic ends. */
const TOR1 = { // [k0, k1, k2, k3] eV
  CC0: [0.00583, 0, 0, 0.00583], CC1: [0.0058, 0, 0, 0.0058], CC2: [0.0056, -0.068, -0.0447, -0.0134],
  CO: [0.0070, 0, 0, 0.0070], CN: [0.00717, 0, 0, 0.00717], OO: [0, 0.0015, 0.0585, 0.0028],
  'CC=C': [0.0240, 0, 0, -0.0240], 'CC=O': [0.0118, 0, 0, -0.0118],
};
const TOR1_F0 = Math.pow(8 / 9, 3); // (sin⁶ of the tetrahedral angle)
/* the end's double bond other than the central one (an sp² end), or null; aromatic or triple: 'x' (no term) */
function tor1End(p, bd) {
  let d = null;
  for (const b of p.bonds) { if (b === bd) continue; if (b.arom || b.order >= 3) return 'x'; if (b.order === 2) { if (d) return 'x'; d = b; } }
  return d;
}
function tor1Key(X, A, B, Y, dA, dB) {
  const a = A.el.sym, b = B.el.sym, pair = a < b ? a + b : b + a;
  if (dA === 'x' || dB === 'x' || (dA && dB)) return null;
  if (dA || dB) { // (sp³–sp²: only the dihedral to the double bond's partner)
    if (pair !== 'CC') return null;
    const [d, e, f] = dB ? [dB, B, Y] : [dA, A, X]; if ((d.a === e ? d.b : d.a) !== f) return null;
    const z = f.el.sym; return z === 'C' ? 'CC=C' : z === 'O' ? 'CC=O' : null;
  }
  if (pair === 'CC') return 'CC' + ((X.Z > 1 ? 1 : 0) + (Y.Z > 1 ? 1 : 0));
  return pair === 'CO' ? 'CO' : pair === 'CN' ? 'CN' : pair === 'OO' ? 'OO' : null;
}
/* The single-bond dihedrals of bond bd: cb(X, A, B, Y, k) with k the TOR1 entry. */
function tors1Of3(bd, cb) {
  if (bd.order !== 1 || bd.arom) return;
  const A = bd.a, B = bd.b; if (!A.el || !B.el || A.el.dblock || B.el.dblock || A.bonds.length < 2 || B.bonds.length < 2) return;
  const dA = tor1End(A, bd), dB = tor1End(B, bd);
  for (const ba of A.bonds) { if (ba === bd) continue; const X = other(ba, A);
    for (const bb of B.bonds) { if (bb === bd) continue; const Y = other(bb, B); if (X === Y) continue; const key = tor1Key(X, A, B, Y, dA, dB), k = key && TOR1[key]; if (k) cb(X, A, B, Y, k); } }
}
/* One dihedral's term (slots x, a, b, y): returns E, adds the forces when FX is given (vectors by kvec3: set KB3 first). */
const _t1 = new Float64Array(9), _t1l = new Float64Array(3);
function tors1K(x, a, b, y, k0, k1, k2, k3, FX, FY, FZ) {
  const e = _t1, L = _t1l, ends = [x, a, a, b, b, y];
  for (let m = 0; m < 3; m++) { const v = kvec3(ends[2 * m], ends[2 * m + 1]), l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1e-9; e[3 * m] = v[0] / l; e[3 * m + 1] = v[1] / l; e[3 * m + 2] = v[2] / l; L[m] = l; }
  const ux = e[1] * e[5] - e[2] * e[4], uy = e[2] * e[3] - e[0] * e[5], uz = e[0] * e[4] - e[1] * e[3]; // u = b̂₁×b̂₂
  const vx = e[4] * e[8] - e[5] * e[7], vy = e[5] * e[6] - e[3] * e[8], vz = e[3] * e[7] - e[4] * e[6]; // v = b̂₂×b̂₃
  const uu = ux * ux + uy * uy + uz * uz, vv = vx * vx + vy * vy + vz * vz, P = uu * vv, R = Math.sqrt(P), C = ux * vx + uy * vy + uz * vz;
  const E = (k0 * P * R + k1 * C * P + k2 * (2 * C * C - P) * R + k3 * (4 * C * C * C - 3 * C * P)) / TOR1_F0;
  if (!FX) return E;
  const dC = (k1 * P + 4 * k2 * C * R + k3 * (12 * C * C - 3 * P)) / TOR1_F0;
  const dP = R > 1e-12 ? (1.5 * k0 * R + k1 * C + k2 * (-R + (2 * C * C - P) / (2 * R)) - 3 * k3 * C) / TOR1_F0 : 0;
  const gux = dC * vx + dP * 2 * ux * vv, guy = dC * vy + dP * 2 * uy * vv, guz = dC * vz + dP * 2 * uz * vv; // ∂E/∂u
  const gvx = dC * ux + dP * 2 * vx * uu, gvy = dC * uy + dP * 2 * vy * uu, gvz = dC * uz + dP * 2 * vz * uu; // ∂E/∂v
  // ∂E/∂b̂₁ = b̂₂×gu; ∂E/∂b̂₂ = gu×b̂₁ + b̂₃×gv; ∂E/∂b̂₃ = gv×b̂₂
  const G = [e[4] * guz - e[5] * guy, e[5] * gux - e[3] * guz, e[3] * guy - e[4] * gux,
    guy * e[2] - guz * e[1] + e[7] * gvz - e[8] * gvy, guz * e[0] - gux * e[2] + e[8] * gvx - e[6] * gvz, gux * e[1] - guy * e[0] + e[6] * gvy - e[7] * gvx,
    gvy * e[5] - gvz * e[4], gvz * e[3] - gvx * e[5], gvx * e[4] - gvy * e[3]];
  for (let m = 0; m < 3; m++) { // (to the raw bond vectors: the part across each, over its length; −∂E/∂b on the far end, + on the near end)
    const gx = G[3 * m], gy = G[3 * m + 1], gz = G[3 * m + 2], d = gx * e[3 * m] + gy * e[3 * m + 1] + gz * e[3 * m + 2], il = 1 / L[m];
    const Gx = (gx - d * e[3 * m]) * il, Gy = (gy - d * e[3 * m + 1]) * il, Gz = (gz - d * e[3 * m + 2]) * il, n0 = ends[2 * m], n1 = ends[2 * m + 1];
    FX[n1] -= Gx; FY[n1] -= Gy; FZ[n1] -= Gz; FX[n0] += Gx; FY[n0] += Gy; FZ[n0] += Gz;
  }
  return E;
}
/* The single-bond dihedrals' forces (AC3.sq, made with the dihedral list): after the kernels, on the main thread. */
function tors1Forces3(FX, FY, FZ) {
  kb3FromW(); const sq = AC3.sq, sk = AC3.sk;
  if (wasm3Ready() && typeof WK.ex.af_tors1 === 'function' && AC3.useWasm && wasmIn(sq, sk, FX, FY, FZ, S.x, S.y, S.z)) { // (the module's tors1, the same arithmetic: equal to the bit, 3–4 times faster, 1.26)
    wasmDesc(); wasmDesc3(); WK.t1Calls++;
    WK.ex.af_tors1(WK.desc.byteOffset, sq.byteOffset, sk.byteOffset, 0, AC3.ns, FX.byteOffset, FY.byteOffset, FZ.byteOffset, KB3.wrap ? 1 : 0, KB3.bw, KB3.bh, KB3.bd, TOR1_F0);
    return;
  }
  for (let t = 0; t < AC3.ns; t++) tors1K(sq[4 * t], sq[4 * t + 1], sq[4 * t + 2], sq[4 * t + 3], sk[4 * t], sk[4 * t + 1], sk[4 * t + 2], sk[4 * t + 3], FX, FY, FZ);
}
/* The centres' 3-D targets (per AC centre) and the dihedral list, made again when bonding or species change. */
const AC3 = { useWasm: true, mode: shArray(Uint8Array, 64), t0: shArray(Float64Array, 64), flat: shArray(Uint8Array, 64), topo: -1, dirty: -1, parts: null, len: -1, nt: 0, tq: shArray(Int32Array, 256), ns: 0, sq: shArray(Int32Array, 256), sk: shArray(Float64Array, 256) }; // (sq, sk: the single bonds' dihedrals and their k's, 1.25: main thread only; in the module's memory since 1.26, af_tors1) // (shared: the WebAssembly kernel and the workers read them)
function angleCentres3() {
  angleCentres();
  if (AC3.topo === W.topo && AC3.dirty === W.dirty && AC3.parts === W.parts && AC3.len === W.parts.length) return;
  AC3.topo = W.topo; AC3.dirty = W.dirty; AC3.parts = W.parts; AC3.len = W.parts.length;
  if (AC3.mode.length < AC.n) { const m = AC.n * 2 + 64; AC3.mode = shArray(Uint8Array, m); AC3.t0 = shArray(Float64Array, m); AC3.flat = shArray(Uint8Array, m); _sharedGen++; }
  for (let c = 0; c < AC.n; c++) { const t = angleTargets3(S.obj[AC.c[c]], AC.cnt[c]); AC3.mode[c] = t[0]; AC3.t0[c] = t[1]; AC3.flat[c] = t[2]; }
  let nt = 0;
  for (const bd of W.bonds) {
    if (bd.a.dead || bd.b.dead) continue;
    torsionsOf3(bd, (X, A, B, Y) => {
      if (4 * nt + 4 > AC3.tq.length) { const q = shArray(Int32Array, AC3.tq.length * 2); q.set(AC3.tq); AC3.tq = q; _sharedGen++; }
      AC3.tq[4 * nt] = X.i; AC3.tq[4 * nt + 1] = A.i; AC3.tq[4 * nt + 2] = B.i; AC3.tq[4 * nt + 3] = Y.i; nt++;
    });
  }
  AC3.nt = nt;
  let ns = 0;
  for (const bd of W.bonds) {
    if (bd.a.dead || bd.b.dead) continue;
    tors1Of3(bd, (X, A, B, Y, k) => {
      if (4 * ns + 4 > AC3.sq.length) { const q = shArray(Int32Array, AC3.sq.length * 2); q.set(AC3.sq); AC3.sq = q; const r = shArray(Float64Array, AC3.sk.length * 2); r.set(AC3.sk); AC3.sk = r; }
      AC3.sq[4 * ns] = X.i; AC3.sq[4 * ns + 1] = A.i; AC3.sq[4 * ns + 2] = B.i; AC3.sq[4 * ns + 3] = Y.i; for (let m = 0; m < 4; m++) AC3.sk[4 * ns + m] = k[m]; ns++;
    });
  }
  AC3.ns = ns;
}
/* The nucleus pairs, bonds and angles of a 3-D world (computeForces1's nucleusPairs): the WebAssembly kernel (af_forces3)
   when the module has it, else the JavaScript; one thread here, threads.js replaces this when workers are available. */
let nucleusPairs3 = function (wrap, bw, bh, hw, hh) {
  bondArrays(); angleCentres3();
  const CQ = candidateRoom(VL.np + BD.n), bd = W.box.d, hd = bd / 2, t0 = _profOn ? performance.now() : 0;
  _kStiff = 0;
  let nc;
  if (wasm3Ready()) { wasmDesc(); wasmDesc3(); nc = wasmForces3(0, VL.np, 0, BD.n, 0, AC.n, 0, AC3.nt, S.fx, S.fy, S.fz, CQ, wrap, bw, bh, bd, hw, hh, hd, W.step); }
  else {
    nc = pairKernel3(VL.pi, VL.pj, VL.ex, 0, VL.np, S.fx, S.fy, S.fz, CQ, 0, wrap, bw, bh, bd, hw, hh, hd, W.step);
    nc = bondKernel3(0, BD.n, S.fx, S.fy, S.fz, CQ, nc, wrap, bw, bh, bd, hw, hh, hd);
    angleKernel3(0, AC.n, 0, AC3.nt, S.fx, S.fy, S.fz, wrap, bw, bh, bd);
  }
  if (_kStiff > _stiff) _stiff = _kStiff; _kStiff = 0;
  if (_profOn) { _tKernels += performance.now() - t0; TH_LAST.used = 0; }
  evalCandidates(CQ, nc);
};
/* ======================================================================== 3-D KERNELS END */
/* The kernel's candidates become events here, with the chemistry that needs the particle objects, in the order the
   kernel noted them (so one thread or many give the same event queue). r is the pair's distance now. */
function evalCandidates(CQ, nc) {
  if (_noEv) return;
  const OBJ = S.obj, X = S.x, Y = S.y, Zp = S.z, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2, bd3 = W.box.d, hd = bd3 / 2;
  for (let c = 0; c < nc; c += 3) {
    const kind = CQ[c];
    const i = CQ[c + 1], j = CQ[c + 2];
    if (kind === CAND_BREAK) { const bd = W.bonds[i], ia = bd.a.i, ib = bd.b.i; let dx = X[ib] - X[ia], dy = Y[ib] - Y[ia], dz = Zp[ib] - Zp[ia];
      if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (dz > hd) dz -= bd3; else if (dz < -hd) dz += bd3; }
      queue(EV.BREAK, bd, null, null, Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6); continue; } // (dz: 0 in a flat world)
    const a = OBJ[i], b = OBJ[j];
    let dx = X[j] - X[i], dy = Y[j] - Y[i], dz = Zp[j] - Zp[i];
    if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (dz > hd) dz -= bd3; else if (dz < -hd) dz += bd3; }
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
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

/* 3-D: pairForce with z (fx, fy, fz into the total and the fast part). */
function pairForce3(i, j, dx, dy, dz, r2) {
  const r = Math.sqrt(r2), K = S.k, ki = K[i], kj = K[j];
  let f;
  if (ki === NUC || kj === NUC) {
    const ai = ki === NUC ? i : j, li = ki === NUC ? j : i;
    if (S.Z[ai] === 0) return;
    f = leptonNuc(li, ai, r);
  } else {
    const s2 = r2 + 0.04, Q = S.q;
    f = PHYS.KE * Q[i] * Q[j] * r / (s2 * Math.sqrt(s2));
    { const w = PHYS.KE * (Math.abs(0.04 - 2 * r2) + s2) / (s2 * s2 * Math.sqrt(s2)) * (S.im[i] + S.im[j]); if (w > _stiffL) _stiffL = w; }
    if (ki !== kj && r < 0.3 && !_lepEvOff) queue(EV.ANNIH, S.obj[i], S.obj[j], null, r);
  }
  if (f > FCAP) f = FCAP; else if (f < -FCAP) f = -FCAP;
  const fx = f * dx / r, fy = f * dy / r, fz = f * dz / r, FX = S.fx, FY = S.fy, FZ = S.fz, GX = S.gx, GY = S.gy, GZ = S.gz;
  FX[j] += fx; FY[j] += fy; FZ[j] += fz; FX[i] -= fx; FY[i] -= fy; FZ[i] -= fz;
  GX[j] += fx; GY[j] += fy; GZ[j] += fz; GX[i] -= fx; GY[i] -= fy; GZ[i] -= fz;
}
/* 3-D: the pairs with a free lepton in them (computeForces1), from the lepton list. */
function leptonPairs3() {
  if (!flValid()) flBuild();
  const X = S.x, Y = S.y, Zp = S.z, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = W.box.d, hw = bw / 2, hh = bh / 2, hd = bd / 2;
  for (let pass = 0; pass < 2; pass++) {
    const a = pass ? FL.li : FL.la, b = pass ? FL.lj : FL.lb, n = pass ? FL.nl : FL.na;
    for (let k = 0; k < n; k++) {
      const i = a[k], j = b[k];
      let dx = X[j] - X[i], dy = Y[j] - Y[i], dz = Zp[j] - Zp[i];
      if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; }
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 < RC2 && r2 > 1e-10) pairForce3(i, j, dx, dy, dz, r2);
    }
  }
}
/* 3-D: the exact long-range Coulomb between net charges beyond the cutoff (computeForces1). */
function longRange3() {
  const ch = _charged, nch = ch.length;
  for (let i = 0; i < nch; i++) {
    const a = ch[i];
    for (let j = i + 1; j < nch; j++) {
      const b = ch[j];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, r2 = dx * dx + dy * dy + dz * dz;
      if (r2 < RC2) continue;
      const r = Math.sqrt(r2), f = PHYS.KE * qx(a, b) * qx(b, a) / r2;
      const fx = f * dx / r, fy = f * dy / r, fz = f * dz / r;
      b.fx += fx; b.fy += fy; b.fz += fz; a.fx -= fx; a.fy -= fy; a.fz -= fz;
      if (a.k !== NUC || b.k !== NUC) { b.gx += fx; b.gy += fy; b.gz += fz; a.gx -= fx; a.gy -= fy; a.gz -= fz; }
    }
  }
}

/* ------------------------------------------------------------------ geometry helpers */
function minImg(dx, dy, dz = 0) { // (callers that take two values keep working; dz is 0 in a flat world)
  if (W.wall === 'wrap') {
    const bw = W.box.w, bh = W.box.h;
    if (dx > bw / 2) dx -= bw; else if (dx < -bw / 2) dx += bw;
    if (dy > bh / 2) dy -= bh; else if (dy < -bh / 2) dy += bh;
    if (W.d3) { const bd = W.box.d; if (dz > bd / 2) dz -= bd; else if (dz < -bd / 2) dz += bd; }
  }
  return [dx, dy, dz];
}
/* A length from its components: Math.hypot in a flat world, as always (its rounding differs from √(x²+y²+0) in the last
   digit), the plain root in 3-D (as the 3-D kernels take it). */
function hyp3(dx, dy, dz) { return W.d3 ? Math.sqrt(dx * dx + dy * dy + dz * dz) : Math.hypot(dx, dy); }
function dist(a, b) { const [dx, dy, dz] = minImg(b.x - a.x, b.y - a.y, b.z - a.z); return hyp3(dx, dy, dz); }
/* A random direction: in the plane from one draw (exactly as every caller drew it before 3-D), on the sphere from two in
   3-D. The array is shared: read it at once. */
const _ud = [0, 0, 0];
function rndDir() {
  if (!W.d3) { const th = rnd() * 2 * Math.PI; _ud[0] = Math.cos(th); _ud[1] = Math.sin(th); _ud[2] = 0; return _ud; }
  const c = 2 * rnd() - 1, ph = rnd() * 2 * Math.PI, s = Math.sqrt(Math.max(0, 1 - c * c));
  _ud[0] = s * Math.cos(ph); _ud[1] = s * Math.sin(ph); _ud[2] = c; return _ud;
}
/* (3-D) The vector (vx, vy, vz) turned by the angle th about an axis at right angles to it, at a random azimuth (one
   draw): into _ud. */
function turn3(vx, vy, vz, th) {
  const v = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (!(v > 0)) { _ud[0] = vx; _ud[1] = vy; _ud[2] = vz; return _ud; }
  const ux = vx / v, uy = vy / v, uz = vz / v;
  let ax = 0, ay = 0, az = 0; if (Math.abs(ux) < 0.9) ax = 1; else ay = 1; // a helper axis not along u
  let e1x = uy * az - uz * ay, e1y = uz * ax - ux * az, e1z = ux * ay - uy * ax; const l1 = Math.hypot(e1x, e1y, e1z); e1x /= l1; e1y /= l1; e1z /= l1;
  const e2x = uy * e1z - uz * e1y, e2y = uz * e1x - ux * e1z, e2z = ux * e1y - uy * e1x;
  const ph = rnd() * 2 * Math.PI, c = Math.cos(th), s = Math.sin(th), cp = Math.cos(ph), sp = Math.sin(ph);
  _ud[0] = v * (c * ux + s * (cp * e1x + sp * e2x)); _ud[1] = v * (c * uy + s * (cp * e1y + sp * e2y)); _ud[2] = v * (c * uz + s * (cp * e1z + sp * e2z));
  return _ud;
}

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
let _fastNuc = [], _radNuc = [], _charged = [], _late = [], _mdL = [], _nNucMD = 0;
let _mdI = shArray(Int32Array, 4096), _nmd = 0, _mdLI = shArray(Int32Array, 256), _nmdL = 0, _chI = shArray(Int32Array, 256), _nch = 0, _mdNI = new Int32Array(4096), _nmdN = 0; // the slots of _md, _mdL, _charged and the MD nuclei
let _mdGen = 0, _mdPrev = new Int32Array(4096), _nmdPrev = -1, _nFastLep = 0; // _mdGen counts the changes of the MD set (_md as a set of slots)
function computeForces() {
  if (PI.on && PI.n) return piForces();
  if (_vlE) vlReachSet(0); // (quantum nuclei off: the list's usual reach again)
  if (_profOn) { const t0 = performance.now(), k0 = _tKernels; computeForces1(); _tForces += performance.now() - t0; _nPasses++; if (TH_LAST.used) { _tKernels = k0 + TH_LAST.ms; _tWait += TH_LAST.wait; } return; }
  computeForces1();
}
const TH_LAST = { used: 0, ms: 0, wait: 0 }; // (what the last force pass's kernels cost: filled by nucleusPairs)
let _clsOk = true, _clsN = -1, _clsKey = -1, _clsFlag = -1, _clsParts = null, _clsHits = 0; // (the force pass's lists kept from the last pass: _clsOk false forces them to be made every time, for tests)
function computeForces1() {
  const pre = _intTok && _intUse; _intTok = false; // (right after the threaded integrator: see _intTok)
  _late.length = 0; _stiff = 0; _stiffL = 0;
  let tp = _profOn ? performance.now() : 0;
  const fieldE = hasEfield();
  const parts = W.parts, n = parts.length, PI = partsSync();
  if (_mdI.length < n) { _mdI = shArray(Int32Array, n * 2 + 64); _sharedGen++; } // (the workers read it to build the neighbour list)
  if (_mdLI.length < n) _mdLI = shArray(Int32Array, n * 2 + 64); // (in the module's memory: the electron kernel reads them)
  if (_chI.length < n) _chI = shArray(Int32Array, n * 2 + 64);
  if (_mdNI.length < n) _mdNI = new Int32Array(n * 2 + 64);
  const FX = S.fx, FY = S.fy, GX = S.gx, GY = S.gy, DEAD = S.dead, K = S.k, Z = S.Z, RAD = S.rad, FAST = S.fast, Q = S.q, INMD = S.inMD, NEAR = S.nearIon, X = S.x, Y = S.y, OBJ = S.obj;
  const mdI = _mdI, mdLI = _mdLI, chI = _chI, mdNI = _mdNI;
  // The lists below (MD set, leptons, charged, fast nuclei) depend only on which particles exist, their kinds, charges
  // and dead/fast/rad flags: when none of that has changed since the last pass (and no field pushes the fast ones) they
  // are kept, and only the forces are cleared, with one fill per array instead of six writes per particle.
  const ckey = W.spawned * 1e9 + W.deaths * 1e5 + W.dirty + 0.5 * W.topo, same = _clsOk && !fieldE && _clsN === n && _clsKey === ckey && _clsFlag === _flagGen && _clsParts === parts;
  if (same) {
    const hi = S.hi; if (!pre || _intHi !== hi) { FX.fill(0, 0, hi); FY.fill(0, 0, hi); GX.fill(0, 0, hi); GY.fill(0, 0, hi); NEAR.fill(0, 0, hi); } // (the threaded integrator cleared them as it used them)
    if (W.d3) { S.fz.fill(0, 0, hi); S.gz.fill(0, 0, hi); }
    _late.length = 0; _flagGenForces = _flagGen; _clsHits++;
  } else {
  _fastNuc.length = 0; _radNuc.length = 0; _charged.length = 0; _mdL.length = 0; _nNucMD = 0;
  let nmd = 0, nmdL = 0, nch0 = 0, nmdN = 0, nFastLep = 0;
  for (let j = 0; j < n; j++) {
    const i = PI[j];
    if (DEAD[i] === 1) continue;
    FX[i] = 0; FY[i] = 0; GX[i] = 0; GY[i] = 0; NEAR[i] = 0; INMD[i] = 0;
    const k = K[i];
    if (k === NUC && Z[i] === 0) continue;       // neutrons fly straight
    if (RAD[i] === 1) { if (k === NUC) _radNuc.push(OBJ[i]); continue; } // (_radNuc: nuclei in radiation flight, for segTargets3)
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
  if (W.d3) { S.fz.fill(0, 0, S.hi); S.gz.fill(0, 0, S.hi); } // (3-D: the z forces, cleared as the loop above clears x and y)
  { // has the MD set changed since the last time?
    let same = nmd === _nmdPrev;
    if (same) { const pv = _mdPrev; for (let q = 0; q < nmd; q++) if (pv[q] !== mdI[q]) { same = false; break; } }
    if (!same) { _mdGen++; if (_mdPrev.length < nmd) _mdPrev = new Int32Array(nmd * 2 + 64); _mdPrev.set(mdI.subarray(0, nmd)); _nmdPrev = nmd; }
  }
  _clsN = n; _clsKey = ckey; _clsFlag = _flagGen; _clsParts = parts;
  }
  const nmd = _nmd, nmdL = _nmdL;
  gridTouch(); // (the MD set is this pass's; the grid is built when something asks for it)
  if (_profOn) { const t = performance.now(); _tClass += t - tp; tp = t; }
  const okv = vlValid(pre ? _intWorst : -1);
  if (_profOn) { const t = performance.now(); PROF.valid += t - tp; }
  if (!okv) vlBuild();
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2;
  if (VL.exTopo !== W.topo || VL.exDirty !== W.dirty) vlExclusions();
  if (_profOn) { const t = performance.now(); _tLists += t - tp; tp = t; }
  if (BO.any && !(_qmHold && BO.qm)) boPass(true); // (continuous bond orders, 1.13: bo.js; before the kernel, which needs the members' partial charges, 1.16)
  const d3 = W.d3;
  if (d3) { nucleusPairs3(wrap, bw, bh, hw, hh); if (AC3.ns) tors1Forces3(S.fx, S.fy, S.fz); } // (3-D: the kernels; then the single bonds' twist, 1.25)
  else nucleusPairs(wrap, bw, bh, hw, hh); // the kernel, on one thread or many
  if (SITES.any) sitesForces(S.fx, S.fy, S.fz); // (Experimental: off-atom charge sites, 1.26: sites.js)
  if (_profOn) tp = performance.now();
  if (nmdL && d3) leptonPairs3(); // (3-D)
  else if (nmdL) { // pairs with a free lepton in them, from the inner steps' list
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
  const nch = _charged.length, lrNow = nch <= 220 && W.wall !== 'wrap';
  if (lrNow !== _lrOn && W.lrKnown) lrFlip(lrNow); else { _lrOn = lrNow; W.lrKnown = true; } // (a new world's first pass sets it: nothing to book)
  if (_lrOn && d3) longRange3();
  else if (_lrOn) {
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
  farMetalPairs((a, b, dx, dy, r, dz) => {
    const f = metalF(a, b, r), fx = f * dx / r, fy = f * dy / r;
    b.fx += fx; b.fy += fy; a.fx -= fx; a.fy -= fy;
    if (dz) { const fz = f * dz / r; b.fz += fz; a.fz -= fz; }
  });
  if (MBO.on) mbPass(true); // (Experimental: bond orders for metals, 1.25: bometal.js)
  // (bonds and angles: with the nucleus pairs, above)
  // external fields
  const hasE = hasEfield(), hasB = hasBfield() && W.magnets.length > 0;
  if (hasE || hasB) {
    const kT = PHYS.KB * Math.max(W.T, 1), QP = S.qp, NE = S.ne;
    for (let q = 0; q < nmd; q++) {
      const i = mdI[q];
      if (K[i] !== NUC) continue; // free electrons: leptonExtras
      const qt = Q[i] + QP[i];
      if (hasE && qt !== 0) { const E = Efield(X[i], Y[i], OBJ[i]); FX[i] += qt * E[0]; FY[i] += qt * E[1]; if (d3) S.fz[i] += qt * W.Ez; } // (3-D: its z part, 1.24)
      if (hasB && NE[i] > 0) magneticMatterForce(OBJ[i], kT);
    }
  }
  if (W.wall === 'reflect') { // soft harmonic walls: conserve energy and leave molecules intact
    _wallFs = 0; if (d3) softWalls3(mdI, nmd, hw, hh, W.box.d / 2); else softWalls(mdI, nmd, hw, hh);
    const PB = W.pB || (W.pB = { s: 0, t: 0, blocks: [] }), dt = W.dt || 0.01; // (the push on the walls, in blocks of 0.5 ps: the pressure readout)
    PB.s += _wallFs * dt; PB.t += dt;
    if (PB.t >= 50) { PB.blocks.push(PB.s / PB.t); if (PB.blocks.length > 2000) PB.blocks.shift(); PB.s = 0; PB.t = 0; }
  }
  if (W.objs.length) objForces(mdI, nmd); // (placed objects: soft walls on the atoms' edges, props.js)
  toolForces();
  leptonExtras(true);
  if (WAVE.n) waveForces(true); // (Experimental: electrons as waves, 1.15)
  if (_profOn) _tAfter += performance.now() - tp;
}
/* The soft walls' push on the atoms in MD past them (electrons: in leptonExtras). Its own small function: inside the
   force pass's long body the loop ran several times slower. */
let _wallFs = 0; // (the walls' total push this force evaluation, eV/Å)
function softWalls(mdI, nmd, hw0, hh0) {
  const K = S.k, M = S.m, X = S.x, Y = S.y, FX = S.fx, FY = S.fy, OBJ = S.obj, R0 = 0.1 * Math.min(W.box.w, W.box.h);
  let fs = 0;
  for (let q = 0; q < nmd; q++) {
    const i = mdI[q], x = X[i], y = Y[i];
    if (x <= hw0 - R0 && x >= R0 - hw0 && y <= hh0 - R0 && y >= R0 - hh0) continue; // (well inside: no push)
    if (K[i] !== NUC) continue;
    const k = 30 * Math.min(1, M[i]), r = wallIn(OBJ[i]), hw = hw0 - r, hh = hh0 - r; // (wallK, wallIn)
    if (x <= hw && x >= -hw && y <= hh && y >= -hh) continue;
    if (x > hw) { FX[i] -= k * (x - hw); fs += k * (x - hw); } else if (x < -hw) { FX[i] += k * (-hw - x); fs += k * (-hw - x); }
    if (y > hh) { FY[i] -= k * (y - hh); fs += k * (y - hh); } else if (y < -hh) { FY[i] += k * (-hh - y); fs += k * (-hh - y); }
  }
  _wallFs = fs;
}
/* 3-D: the same walls, and two more at z = ±d/2. */
function softWalls3(mdI, nmd, hw0, hh0, hd0) {
  const K = S.k, M = S.m, X = S.x, Y = S.y, Zp = S.z, FX = S.fx, FY = S.fy, FZ = S.fz, OBJ = S.obj, R0 = 0.1 * Math.min(W.box.w, W.box.h, W.box.d);
  let fs = 0;
  for (let q = 0; q < nmd; q++) {
    const i = mdI[q], x = X[i], y = Y[i], z = Zp[i];
    if (x <= hw0 - R0 && x >= R0 - hw0 && y <= hh0 - R0 && y >= R0 - hh0 && z <= hd0 - R0 && z >= R0 - hd0) continue;
    if (K[i] !== NUC) continue;
    const k = 30 * Math.min(1, M[i]), r = wallIn(OBJ[i]), hw = hw0 - r, hh = hh0 - r, hd = hd0 - r;
    if (x > hw) { FX[i] -= k * (x - hw); fs += k * (x - hw); } else if (x < -hw) { FX[i] += k * (-hw - x); fs += k * (-hw - x); }
    if (y > hh) { FY[i] -= k * (y - hh); fs += k * (y - hh); } else if (y < -hh) { FY[i] += k * (-hh - y); fs += k * (-hh - y); }
    if (z > hd) { FZ[i] -= k * (z - hd); fs += k * (z - hd); } else if (z < -hd) { FZ[i] += k * (-hd - z); fs += k * (-hd - z); }
  }
  _wallFs = fs;
}
/* Soft-wall stiffness: one oscillation frequency for every heavy particle. (Free electrons bounce off the walls
   elastically on their own short steps: leptonWall.) */
function wallK(p) { return 30 * Math.min(1, p.m); }
/* The soft walls act on an atom's edge, not its centre (0.64): its drawn radius in from the wall line, so a crowd
   pressed against a wall stays inside it. (At most a tenth of the box, for a box shrunk round big atoms.) */
function wallIn(p) { return Math.min(p.rd || 0, 0.1 * (W.d3 ? Math.min(W.box.w, W.box.h, W.box.d) : Math.min(W.box.w, W.box.h))); }
/* Single-particle forces on free (MD) electrons and positrons: applied field, the Push/Pull and Grab tools. They
   belong to the fast part; total = true also adds them to the total force. */
const GRAB_M = 0.01;
const GRAB_V = 0.3; // Å/tu (about 3 km/s): the fastest the Grab tool draws an atom or molecule along
/* Strong and Very strong add a plain spring to the cursor on top: k eV/Å² up to F eV/Å, whatever the mass (the speed
   spring alone pulls a hydrogen atom with under 1 eV/Å, too little to tear a bond, which takes about 4–5 eV/Å for
   C–H or O–H and 13 for N≡N). For a whole molecule it is shared by mass, so it moves the molecule without tearing it. */
const GRAB_F = { gentle: null, strong: [6, 8], max: [20, 30] };
const GRAB_VMAX = { gentle: GRAB_V, strong: 3, max: 10 }; // Å/tu: 3, 30 and 100 km/s (ballistic mode starts at 25 Å/tu)
function leptonExtras(total) {
  const hasE = hasEfield();
  const t = W.tool, pull = t && t.active && t.type === 'pull', g = W.grab, gp = g && g.p && g.p.k !== NUC && !g.p.dead ? g.p.i : -1;
  const mdLI = _mdLI, nL = _nmdL, DEAD = S.dead, FAST = S.fast, RAD = S.rad, Q = S.q, X = S.x, Y = S.y, VX = S.vx, VY = S.vy, M = S.m, GX = S.gx, GY = S.gy, FX = S.fx, FY = S.fy, OBJ = S.obj;
  if (!hasE && !pull && gp < 0) return; // (nothing to add)
  if (W.d3) { leptonExtras3(total, t, pull, g, gp, hasE); return; }
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

/* (3-D) The same for free electrons in a 3-D world: Push/Pull's ball and the Grab spring, with z (no fields in 3-D yet). */
function leptonExtras3(total, t, pull, g, gp, hasE) {
  const mdLI = _mdLI, nL = _nmdL, DEAD = S.dead, FAST = S.fast, RAD = S.rad, X = S.x, Y = S.y, Zp = S.z, VX = S.vx, VY = S.vy, VZ = S.vz, M = S.m, GX = S.gx, GY = S.gy, GZ = S.gz, FX = S.fx, FY = S.fy, FZ = S.fz;
  for (let q = 0; q < nL; q++) {
    const i = mdLI[q];
    if (DEAD[i] === 1 || FAST[i] === 1 || RAD[i] === 1) continue;
    let fx = 0, fy = 0, fz = 0;
    if (hasE) { const E = Efield(X[i], Y[i], S.obj[i]), q = S.q[i]; fx += q * E[0]; fy += q * E[1]; fz += q * W.Ez; } // (an applied field, 1.24)
    if (pull) {
      const R = t.R, R2 = R * R, U0 = Math.min(20, Math.abs(t.s)), dx = t.x - X[i], dy = t.y - Y[i], dz = (t.z || 0) - Zp[i], d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= R2 && d2 >= 1e-8) { const d = Math.sqrt(d2), F = t.s > 0 ? 2 * U0 * d / R2 : -2 * U0 * (1 - d / R) / R; fx += F * dx / d; fy += F * dy / d; fz += F * dz / d; }
    }
    if (gp === i) { const mg = Math.max(M[i], GRAB_M), gz = g.z === undefined ? Zp[i] : g.z; fx += mg * (6 * (g.x - X[i]) - 2.5 * VX[i]); fy += mg * (6 * (g.y - Y[i]) - 2.5 * VY[i]); fz += mg * (6 * (gz - Zp[i]) - 2.5 * VZ[i]); }
    GX[i] += fx; GY[i] += fy; GZ[i] += fz;
    if (total) { FX[i] += fx; FY[i] += fy; FZ[i] += fz; }
  }
}

/* ---- Experimental: electrons as waves (1.15). Su and Goddard's electron force field (eFF, PRL 99, 185003, 2007): each
   free electron and positron in MD is a spherical Gaussian wave packet with a centre, a size s and a spin, and its size
   moves as a coordinate of its own (mass ¾ mₑ). Its kinetic energy 3ħ²/(2mₑ)·(1/s²) grows as it is squeezed; two
   packets meet as smeared charges, erf(r/σ)/r with σ² = (sᵢ² + sⱼ²)/2, and two of the same kind repel as their waves
   overlap (the Pauli principle: strongly with the same spin, weakly with opposite spins). It is worked out as a
   correction on top of the point electrons' own soft Coulomb, so with ions and atoms the free electrons meet as before
   (their captures, scattering and ionization as calibrated); only how they meet each other changes. A free packet
   spreads; here it spreads to W_SMAX at most (a stiff spring beyond, as eFF's users bound it), and its energy is counted
   from there (a packet resting at that size carries none). Who is a packet is settled at the start of each step and
   after events (waveSync): a joiner takes the size at which joining costs nothing, a leaver hands its packet energy to
   its own motion (or, gone, to the heat bath), so the books stay exact. */
const WAVE = { on: false, mem: [], n: 0, sp: -1, bath: 0 };
const W_CT = 11.4299, W_SMAX = 2.0, W_KC = 20, W_MS = 0.75 * PHYS.ME, W_IMS = 1 / W_MS; // eV·Å², Å, eV/Å², u
const HA_EV = HARTREE_EV, TWO_SQPI = 2 / Math.sqrt(Math.PI);
function waveSelf(s) { return W_CT * (1 / (s * s) - 1 / (W_SMAX * W_SMAX)) + (s > W_SMAX ? 0.5 * W_KC * (s - W_SMAX) * (s - W_SMAX) : 0); }
function waveSelfD(s) { return -2 * W_CT / (s * s * s) + (s > W_SMAX ? W_KC * (s - W_SMAX) : 0); }
/* erf(r/σ)/r and its derivatives in r and σ. g(x) = erf(x)/x comes from a table every 0.01 (values and slopes worked out
   once, by the series below x = 2.5 and the continued fraction above), joined by cubic Hermite pieces: smooth, the slope
   the exact derivative of the value (so forces and energy agree to rounding), within about 1e-10 of the true function. */
const ERF_H = 0.01, ERF_N = 601, _eg = new Float64Array(ERF_N + 1), _egp = new Float64Array(ERF_N + 1);
(function erfTable() {
  for (let k = 0; k <= ERF_N; k++) {
    const x = k * ERF_H;
    let erf;
    if (x < 2.5) { const x2 = x * x; let t = 1, g = 1; for (let n = 1; n < 80; n++) { t *= -x2 / n; const d = t / (2 * n + 1); g += d; if (Math.abs(d) < 1e-18) break; } erf = TWO_SQPI * g * x; }
    else { let f = x; for (let m = 60; m >= 1; m--) f = x + (m / 2) / f; erf = 1 - Math.exp(-x * x) / (Math.sqrt(Math.PI) * f); }
    _eg[k] = x > 0 ? erf / x : TWO_SQPI;
    _egp[k] = x > 0 ? (TWO_SQPI * Math.exp(-x * x) * x - erf) / (x * x) : 0;
  }
})();
const _ef = [0, 0, 0];
function erfOverR(r, sg) {
  const x = r / sg;
  if (x >= 6) { _ef[0] = 1 / r; _ef[1] = -1 / (r * r); _ef[2] = 0; return _ef; }
  const u = x / ERF_H, k = Math.floor(u), t = u - k, t2 = t * t, t3 = t2 * t;
  const g0 = _eg[k], g1 = _eg[k + 1], m0 = _egp[k] * ERF_H, m1 = _egp[k + 1] * ERF_H;
  const g = (2 * t3 - 3 * t2 + 1) * g0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * g1 + (t3 - t2) * m1;
  const gp = ((6 * t2 - 6 * t) * g0 + (3 * t2 - 4 * t + 1) * m0 + (-6 * t2 + 6 * t) * g1 + (3 * t2 - 2 * t) * m1) / ERF_H;
  _ef[0] = g / sg; _ef[1] = gp / (sg * sg); _ef[2] = -(g + gp * x) / (sg * sg);
  return _ef;
}
/* eFF's Pauli energy (eV) of two packets of the same kind at r (Å), sizes si, sj (Å), and its derivatives: _pw =
   [E, ∂E/∂r, ∂E/∂si, ∂E/∂sj]. Same spin: [S²/(1−S²) + (1−ρ)S²/(1+S²)]·ΔT, opposite: −ρS²/(1+S²)·ΔT, ρ = −0.2, with
   r̄ = 1.125r, s̄ = 0.9s (in bohr and hartree). */
const _pw = [0, 0, 0, 0];
function wavePauli(r, si, sj, same) {
  const R = 1.125 * r / BOHR_A, a = 0.9 * si / BOHR_A, b = 0.9 * sj / BOHR_A, a2 = a * a, b2 = b * b, sum = a2 + b2, u = R * R;
  if (u > 20 * sum) { _pw[0] = _pw[1] = _pw[2] = _pw[3] = 0; return _pw; } // (S² < e⁻⁴⁰: nothing)
  const lS2 = 3 * Math.log(2 * a * b / sum) - 2 * u / sum, S2 = Math.exp(lS2);
  if (S2 < 1e-16) { _pw[0] = _pw[1] = _pw[2] = _pw[3] = 0; return _pw; }
  const sum2 = sum * sum, dT = 1.5 * (1 / a2 + 1 / b2) - 2 * (3 * sum - 2 * u) / sum2;
  let g, gp;
  // (1 − S² to full precision: two equal same-spin packets nearly on top of each other have S² → 1 and ΔT → 0, and
  // their product stays finite, about 1/s̄² hartree; a cap on S² there made a false well)
  if (same) { const d1 = Math.max(-Math.expm1(lS2), 1e-15), d2 = 1 + S2; g = S2 / d1 + 1.2 * S2 / d2; gp = 1 / (d1 * d1) + 1.2 / (d2 * d2); }
  else { const d2 = 1 + S2; g = 0.2 * S2 / d2; gp = 0.2 / (d2 * d2); }
  const lu = -1 / sum, la = 1.5 * (1 / a - 2 * a / sum) + 2 * a * u / sum2, lb = 1.5 * (1 / b - 2 * b / sum) + 2 * b * u / sum2; // ∂ ln S
  const Tu = 4 / sum2, w = 8 * (3 * sum - 2 * u) / (sum2 * sum), Ta = -3 / (a2 * a) - 12 * a / sum2 + a * w, Tb = -3 / (b2 * b) - 12 * b / sum2 + b * w;
  const k = gp * 2 * S2 * dT;
  _pw[0] = g * dT * HA_EV;
  _pw[1] = (k * lu + g * Tu) * 2 * R * (1.125 / BOHR_A) * HA_EV;
  _pw[2] = (k * la + g * Ta) * (0.9 / BOHR_A) * HA_EV;
  _pw[3] = (k * lb + g * Tb) * (0.9 / BOHR_A) * HA_EV;
  return _pw;
}
/* A pair of packets: the energy (eV) eFF adds to the point electrons' own soft Coulomb, tapered to nothing at the cutoff;
   _wd = [∂E/∂r, ∂E/∂si, ∂E/∂sj]. */
const _wd = [0, 0, 0];
function wavePair(pi, pj, r) {
  const si = pi.ws, sj = pj.ws, sg = Math.sqrt(0.5 * (si * si + sj * sj)), kq = PHYS.KE * pi.q * pj.q, s2 = r * r + 0.04, sq = Math.sqrt(s2);
  erfOverR(r, sg);
  let E = kq * (_ef[0] - 1 / sq), dr = kq * (_ef[1] + r / (s2 * sq));
  const dsg = kq * _ef[2] / (2 * sg);
  let di = dsg * si, dj = dsg * sj;
  if (pi.k === pj.k) { wavePauli(r, si, sj, pi.spin === pj.spin); E += _pw[0]; dr += _pw[1]; di += _pw[2]; dj += _pw[3]; }
  const r1 = RC - 1.5;
  if (r > r1) { const x = (r - r1) / 1.5, sw = 1 - x * x * (3 - 2 * x), dsw = -6 * x * (1 - x) / 1.5; dr = dr * sw + E * dsw; di *= sw; dj *= sw; E *= sw; }
  _wd[0] = dr; _wd[1] = di; _wd[2] = dj;
  return E;
}
/* A packet and an ion (net charge, Z > 0): eFF's smeared attraction, erf(r/σ)/r with σ² = s²/2 + 1.273·sE (the ion's own
   soft core folded in, so a tight packet meets it as a point electron does), as a correction to the point electron's
   soft Coulomb; _wi = [∂E/∂r, ∂E/∂s]. */
const _wi = [0, 0];
function wavePairIon(p, A, r) {
  const s = p.ws, sE = A.sEN, sg = Math.sqrt(0.5 * s * s + 1.273 * sE), kq = PHYS.KE * p.q * A.q, s2 = r * r + sE, sq = Math.sqrt(s2);
  erfOverR(r, sg);
  let E = kq * (_ef[0] - 1 / sq), dr = kq * (_ef[1] + r / (s2 * sq)), ds = kq * _ef[2] * s / (2 * sg);
  const r1 = RC - 1.5;
  if (r > r1) { const x = (r - r1) / 1.5, sw = 1 - x * x * (3 - 2 * x), dsw = -6 * x * (1 - x) / 1.5; dr = dr * sw + E * dsw; ds *= sw; E *= sw; }
  _wi[0] = dr; _wi[1] = ds;
  return E;
}
const waveIon = (A) => A.k === NUC && A.Z > 0 && A.q !== 0 && !A.dead && !A.fast && !A.rad;
/* The packets' forces (added to the fast forces, and with total to the whole ones) and their size forces wg. */
function waveForces(total) {
  if (!WAVE.n) return;
  if (W.d3) { waveForces3(total); return; } // (3-D, 1.24)
  const OBJ = S.obj, GX = S.gx, GY = S.gy, FX = S.fx, FY = S.fy, X = S.x, Y = S.y, DEAD = S.dead, FAST = S.fast, RAD = S.rad, IM = S.im, Q = S.q, Z = S.Z;
  let stiff = _stiffL;
  for (const p of WAVE.mem) { if (!p.wm) continue; const s = p.ws; p.wg = -waveSelfD(s); const w = 8 * (6 * W_CT / (s * s * s * s) + (s > W_SMAX ? W_KC : 0)) * W_IMS; if (w > stiff) stiff = w; } // (the size's own stiffness, with room for the pairs': measured, 8 keeps two packets 1.2 Å apart to 0.01 eV over 24 fs)
  if (!flValid()) { lazyCatch(); flBuild(); if (_gxOn) gxAddFL(); }
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2;
  const li = FL.li, lj = FL.lj, nl = FL.nl;
  for (let k = 0; k < nl; k++) {
    const L = li[k], M = lj[k];
    if (DEAD[L] === 1 || FAST[L] === 1 || RAD[L] === 1 || DEAD[M] === 1 || FAST[M] === 1 || RAD[M] === 1) continue;
    const a = OBJ[L], b = OBJ[M];
    if (!a.wm || !b.wm) continue;
    let dx = X[M] - X[L], dy = Y[M] - Y[L];
    if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
    const r2 = dx * dx + dy * dy;
    if (!(r2 < RC2 && r2 > 1e-14)) continue;
    const r = Math.sqrt(r2);
    wavePair(a, b, r);
    const fx = -_wd[0] * dx / r, fy = -_wd[0] * dy / r; // (on b; −that on a)
    GX[M] += fx; GY[M] += fy; GX[L] -= fx; GY[L] -= fy;
    if (total) { FX[M] += fx; FY[M] += fy; FX[L] -= fx; FY[L] -= fy; }
    a.wg -= _wd[1]; b.wg -= _wd[2];
    const w = Math.abs(_wd[0]) / Math.max(r, 0.25 * Math.min(a.ws, b.ws)) * (IM[L] + IM[M]); if (w > stiff) stiff = w; // (step control: how fast the pair's pull changes)
  }
  const la = FL.la, lb = FL.lb, na = FL.na;
  for (let k = 0; k < na; k++) {
    const L = la[k], A = lb[k];
    if (Q[A] === 0 || Z[A] === 0 || DEAD[L] === 1 || FAST[L] === 1 || RAD[L] === 1 || DEAD[A] === 1 || FAST[A] === 1 || RAD[A] === 1) continue;
    const a = OBJ[L];
    if (!a.wm) continue;
    let dx = X[A] - X[L], dy = Y[A] - Y[L];
    if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
    const r2 = dx * dx + dy * dy;
    if (!(r2 < RC2 && r2 > 1e-14)) continue;
    const r = Math.sqrt(r2);
    wavePairIon(a, OBJ[A], r);
    const fx = -_wi[0] * dx / r, fy = -_wi[0] * dy / r; // (on the ion; −that on the packet)
    GX[A] += fx; GY[A] += fy; GX[L] -= fx; GY[L] -= fy;
    if (total) { FX[A] += fx; FY[A] += fy; FX[L] -= fx; FY[L] -= fy; }
    a.wg -= _wi[1];
  }
  _stiffL = stiff;
}
/* 3-D (1.24): waveForces with the depth: the same pairs (the lepton list), distances and forces in three directions. eFF
   is a three-dimensional model to begin with (spherical packets, 3ħ²/2mₑs²): only the geometry changes. */
function waveForces3(total) {
  const OBJ = S.obj, GX = S.gx, GY = S.gy, GZ = S.gz, FX = S.fx, FY = S.fy, FZ = S.fz, X = S.x, Y = S.y, Zp = S.z, DEAD = S.dead, FAST = S.fast, RAD = S.rad, IM = S.im, Q = S.q, Z = S.Z;
  let stiff = _stiffL;
  for (const p of WAVE.mem) { if (!p.wm) continue; const s = p.ws; p.wg = -waveSelfD(s); const w = 8 * (6 * W_CT / (s * s * s * s) + (s > W_SMAX ? W_KC : 0)) * W_IMS; if (w > stiff) stiff = w; }
  if (!flValid()) { lazyCatch(); flBuild(); }
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = W.box.d, hw = bw / 2, hh = bh / 2, hd = bd / 2;
  const mi = (k, a, b) => { let dx = X[b] - X[a], dy = Y[b] - Y[a], dz = Zp[b] - Zp[a]; if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; } _w3[0] = dx; _w3[1] = dy; _w3[2] = dz; };
  const li = FL.li, lj = FL.lj, nl = FL.nl;
  for (let k = 0; k < nl; k++) {
    const L = li[k], M = lj[k];
    if (DEAD[L] === 1 || FAST[L] === 1 || RAD[L] === 1 || DEAD[M] === 1 || FAST[M] === 1 || RAD[M] === 1) continue;
    const a = OBJ[L], b = OBJ[M];
    if (!a.wm || !b.wm) continue;
    mi(k, L, M); const dx = _w3[0], dy = _w3[1], dz = _w3[2], r2 = dx * dx + dy * dy + dz * dz;
    if (!(r2 < RC2 && r2 > 1e-14)) continue;
    const r = Math.sqrt(r2);
    wavePair(a, b, r);
    const fx = -_wd[0] * dx / r, fy = -_wd[0] * dy / r, fz = -_wd[0] * dz / r;
    GX[M] += fx; GY[M] += fy; GZ[M] += fz; GX[L] -= fx; GY[L] -= fy; GZ[L] -= fz;
    if (total) { FX[M] += fx; FY[M] += fy; FZ[M] += fz; FX[L] -= fx; FY[L] -= fy; FZ[L] -= fz; }
    a.wg -= _wd[1]; b.wg -= _wd[2];
    const w = Math.abs(_wd[0]) / Math.max(r, 0.25 * Math.min(a.ws, b.ws)) * (IM[L] + IM[M]); if (w > stiff) stiff = w;
  }
  const la = FL.la, lb = FL.lb, na = FL.na;
  for (let k = 0; k < na; k++) {
    const L = la[k], A = lb[k];
    if (Q[A] === 0 || Z[A] === 0 || DEAD[L] === 1 || FAST[L] === 1 || RAD[L] === 1 || DEAD[A] === 1 || FAST[A] === 1 || RAD[A] === 1) continue;
    const a = OBJ[L];
    if (!a.wm) continue;
    mi(k, L, A); const dx = _w3[0], dy = _w3[1], dz = _w3[2], r2 = dx * dx + dy * dy + dz * dz;
    if (!(r2 < RC2 && r2 > 1e-14)) continue;
    const r = Math.sqrt(r2);
    wavePairIon(a, OBJ[A], r);
    const fx = -_wi[0] * dx / r, fy = -_wi[0] * dy / r, fz = -_wi[0] * dz / r;
    GX[A] += fx; GY[A] += fy; GZ[A] += fz; GX[L] -= fx; GY[L] -= fy; GZ[L] -= fz;
    if (total) { FX[A] += fx; FY[A] += fy; FZ[A] += fz; FX[L] -= fx; FY[L] -= fy; FZ[L] -= fz; }
    a.wg -= _wi[1];
  }
  _stiffL = stiff;
}
const _w3 = [0, 0, 0];
/* The packets' energy (eV): each one's own (its size's kinetic energy and motion), every pair's, and with the ions. A
   packet gone (dead) keeps its own and its pairs' until waveSync books them; its share with the ions went with the event
   that ended it (localPE counts it: waveLocal). */
function waveEnergy() {
  let E = 0;
  const m = WAVE.mem, ions = [];
  for (const A of W.parts) if (waveIon(A)) ions.push(A);
  for (let i = 0; i < m.length; i++) {
    const a = m[i]; if (!a.wm) continue;
    E += waveSelf(a.ws) + 0.5 * W_MS * a.wv * a.wv;
    if (a.dead) { E += a.wDeadE || 0; continue; } // (gone: its share with the others as it was then, unless an event counted it, until waveSync gives it off)
    for (let j = i + 1; j < m.length; j++) { const b = m[j]; if (!b.wm || b.dead) continue; const [dx, dy, dz] = minImg(b.x - a.x, b.y - a.y, b.z - a.z), r = hyp3(dx, dy, dz); if (r < RC && r > 1e-7) E += wavePair(a, b, r); }
    for (const A of ions) { const [dx, dy, dz] = minImg(A.x - a.x, A.y - a.y, A.z - a.z), r = hyp3(dx, dy, dz); if (r < RC && r > 1e-7) E += wavePairIon(a, A, r); }
  }
  return E;
}
/* For localPE (an event's energy before and after): the packets' share with the ions of the set. */
function waveLocal(set, skip) {
  let V = 0;
  for (const A of set) {
    if (!waveIon(A)) continue;
    for (const a of WAVE.mem) { if (!a.wm || a.dead || a === skip) continue; const [dx, dy, dz] = minImg(A.x - a.x, A.y - a.y, A.z - a.z), r = hyp3(dx, dy, dz); if (r < RC && r > 1e-7) V += wavePairIon(a, A, r); }
  }
  return V;
}
function waveIonShare(p) { // a packet's share with every ion and every other live packet (eV)
  let E = 0;
  for (const b of WAVE.mem) { if (!b.wm || b.dead || b === p) continue; const [dx, dy, dz] = minImg(b.x - p.x, b.y - p.y, b.z - p.z), r = hyp3(dx, dy, dz); if (r < RC && r > 1e-7) E += wavePair(p, b, r); }
  for (const A of W.parts) { if (!waveIon(A)) continue; const [dx, dy, dz] = minImg(A.x - p.x, A.y - p.y, A.z - p.z), r = hyp3(dx, dy, dz); if (r < RC && r > 1e-7) E += wavePairIon(p, A, r); }
  return E;
}
function waveShare(p, s, ions) { // what a packet of size s adds with the current members (its motion left out), and with the ions
  const ws = p.ws; p.ws = s;
  let E = waveSelf(s);
  for (const b of WAVE.mem) { if (!b.wm || b.dead || b === p) continue; const [dx, dy, dz] = minImg(b.x - p.x, b.y - p.y, b.z - p.z), r = hyp3(dx, dy, dz); if (r < RC && r > 1e-7) E += wavePair(p, b, r); }
  if (ions) for (const A of ions) { const [dx, dy, dz] = minImg(A.x - p.x, A.y - p.y, A.z - p.z), r = hyp3(dx, dy, dz); if (r < RC && r > 1e-7) E += wavePairIon(p, A, r); }
  p.ws = ws;
  return E;
}
function waveGive(p, E) { // energy E (eV) into p's motion (gone: as light, where it was); what it cannot take goes to the heat bath
  if (p.dead && E > 1e-9) { const a = (p.id % 360) * Math.PI / 180; if (W.d3) emitPhoton(p.x, p.y, E, Math.cos(a), Math.sin(a), { z: p.z }); else emitPhoton(p.x, p.y, E, Math.cos(a), Math.sin(a)); return; }
  if (!p.dead && E !== 0) {
    if (p.rad) { if (p.KE + E > 1) { p.KE += E; radSpeed(p); p.vx = p.sp * p.ux; p.vy = p.sp * p.uy; return; } }
    else {
      const K0 = W.d3 ? 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) : 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy), K1 = K0 + E; // (3-D: the depth too, 1.24)
      if (K1 >= 0) {
        if (K0 > 1e-12) { const f = Math.sqrt(K1 / K0); p.vx *= f; p.vy *= f; if (W.d3) p.vz *= f; }
        else { const v = Math.sqrt(2 * K1 / p.m), a = (p.id % 360) * Math.PI / 180; p.vx = v * Math.cos(a); p.vy = v * Math.sin(a); if (W.d3) p.vz = 0; }
        if (typeof updateFast === 'function') updateFast(p);
        return;
      }
    }
  }
  W.ledger.bath += E; WAVE.bath += E;
}
/* Who is a packet: every free electron and positron in MD while the option is on. A joiner takes the size at which
   joining costs nothing (or, near an ion, where a packet is less bound than a point, the largest size, the cost paid from
   its own motion; one whose motion can't pay stays a point for now and tries again later). A leaver's packet energy goes
   into its motion; a packet that ended (caught, annihilated) gives its own and its pairs' energy off as light. full:
   look through every particle for joiners (at the start of a step); otherwise only when particles were made. Returns
   whether anything changed. */
function waveSync(full) {
  if (!WAVE.on && !WAVE.n) return false;
  let ch = false, ions = null;
  const ionList = () => ions || (ions = W.parts.filter(waveIon));
  for (const p of WAVE.mem) {
    if (!p.wm || (WAVE.on && !p.dead && !p.fast && !p.rad)) continue;
    const E = p.dead ? waveSelf(p.ws) + 0.5 * W_MS * p.wv * p.wv + (p.wDeadE || 0) : waveShare(p, p.ws, ionList()) + 0.5 * W_MS * p.wv * p.wv;
    p.wm = false; ch = true;
    waveGive(p, E);
  }
  if (ch) WAVE.mem = WAVE.mem.filter(p => p.wm);
  if (WAVE.on && (full || WAVE.sp !== W.spawned)) {
    WAVE.sp = W.spawned;
    for (const p of W.parts) {
      if (p.wm || p.dead || p.k === NUC || p.fast || p.rad) continue;
      const io = ionList();
      let s0 = W_SMAX, J = waveShare(p, W_SMAX, io);
      if (J < 0) { let lo = 0.05, hi = W_SMAX; for (let it = 0; it < 50; it++) { const m = 0.5 * (lo + hi); if (waveShare(p, m, io) > 0) lo = m; else hi = m; } s0 = hi; J = waveShare(p, s0, io); }
      if (J > (W.d3 ? 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) : 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy))) continue; // (its motion can't pay for it yet)
      p.spin = p.id & 1 ? 1 : -1; p.wv = 0; p.wg = 0;
      p.ws = s0; p.wm = true; WAVE.mem.push(p); ch = true;
      if (J !== 0) waveGive(p, -J);
    }
  }
  WAVE.n = WAVE.mem.length;
  return ch;
}
function waveSet(on) { WAVE.on = !!on; if (W.parts) { waveSync(true); W.fSpawn = -1; } }

const _bg3 = [0, 0, 0];
function magneticMatterForce(p, kT) {
  if (W.d3) { magneticMatterForce3(p, kT); return; }
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

/* 3-D (1.24): the same pull, by the gradient of |B| in three directions (magU, whose slope it is, reads Bfield3). */
function magneticMatterForce3(p, kT) {
  const B = Bgrad3(p.x, p.y, p.z, _bg3);
  if (_bg3[0] === 0 && _bg3[1] === 0 && _bg3[2] === 0) return;
  const s = B >= 0 ? 1 : -1, absB = Math.abs(B);
  let F = 0;
  const fe = FERRO[p.Z];
  if (fe && p.tLocal < fe[0]) F += fe[1] * PHYS.MU_B * Math.tanh(absB / 2);
  else if (unpairedOf(p) > 0) { const n = unpairedOf(p), mu = Math.sqrt(n * (n + 2)) * PHYS.MU_B, x = mu * absB / kT; F += mu * (x < 1e-3 ? x / 3 : 1 / Math.tanh(x) - 1 / x); }
  F -= 2 * 2.2e-10 * p.ne * Math.pow(0.5 * p.el.rc, 2) * absB;
  p.fx += F * s * _bg3[0]; p.fy += F * s * _bg3[1]; p.fz += F * s * _bg3[2];
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
    const d3 = W.d3, Zp = S.z, FZ = S.fz, tz = t.z || 0; // (3-D: a ball round the point (x, y, z))
    for (let q = 0; q < nmd; q++) {
      const i = mdI[q];
      if (K[i] !== NUC) continue; // free electrons: leptonExtras
      const dx = t.x - X[i], dy = t.y - Y[i], dz = d3 ? tz - Zp[i] : 0, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > R2 || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const F = t.s > 0 ? 2 * U0 * d / R2 : -2 * U0 * (1 - d / R) / R;
      FX[i] += F * dx / d; FY[i] += F * dy / d; if (d3) FZ[i] += F * dz / d;
    }
  }
  const g = W.grab;
  if (g && g.p && !g.p.dead && (g.p.k === NUC || g.p.fast)) { // a free MD electron: leptonExtras
    const p = g.p;
    const atoms = g.mol ? g.mol : [p];
    // a damped spring to the cursor, a = 2.5·(2.4·d − v), but never drawing it faster than GRAB_V: when the simulation
    // runs slowly the cursor gets far ahead, and an uncapped spring flung a big molecule at tens of km/s (its kinetic
    // energy read as millions of kelvin, and the tiny steps it forced froze the clock)
    if (W.d3) { grabForces3(g, p, atoms); return; }
    let ux = 2.4 * (g.x - p.x), uy = 2.4 * (g.y - p.y);
    const vc = g.vcap || GRAB_V, u = Math.hypot(ux, uy); if (u > vc) { ux *= vc / u; uy *= vc / u; } // (vcap: set each frame by the Grab tool's strength, to keep up with the mouse)
    for (const a of atoms) {
      if (a.dead) continue;
      a.fx += a.m * 2.5 * (ux - a.vx);
      a.fy += a.m * 2.5 * (uy - a.vy);
    }
    const kf = GRAB_F[g.s];
    if (kf) {
      const dx = g.x - p.x, dy = g.y - p.y, d = Math.hypot(dx, dy), F = Math.min(kf[1], kf[0] * d);
      if (d > 1e-9) {
        let mt = 0; for (const a of atoms) if (!a.dead) mt += a.m;
        for (const a of atoms) { if (a.dead) continue; const f = F * a.m / mt; a.fx += f * dx / d; a.fy += f * dy / d; }
      }
    }
  }
}

/* (3-D) The Grab tool's pull, as above, toward the point (g.x, g.y, g.z): the damped speed spring and, for Strong and
   Very strong, the plain spring shared by mass. */
function grabForces3(g, p, atoms) {
  const gz = g.z === undefined ? p.z : g.z;
  let ux = 2.4 * (g.x - p.x), uy = 2.4 * (g.y - p.y), uz = 2.4 * (gz - p.z);
  const vc = g.vcap || GRAB_V, u = Math.sqrt(ux * ux + uy * uy + uz * uz); if (u > vc) { ux *= vc / u; uy *= vc / u; uz *= vc / u; }
  for (const a of atoms) {
    if (a.dead) continue;
    a.fx += a.m * 2.5 * (ux - a.vx); a.fy += a.m * 2.5 * (uy - a.vy); a.fz += a.m * 2.5 * (uz - a.vz);
  }
  const kf = GRAB_F[g.s];
  if (kf) {
    const dx = g.x - p.x, dy = g.y - p.y, dz = gz - p.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz), F = Math.min(kf[1], kf[0] * d);
    if (d > 1e-9) {
      let mt = 0; for (const a of atoms) if (!a.dead) mt += a.m;
      for (const a of atoms) { if (a.dead) continue; const f = F * a.m / mt; a.fx += f * dx / d; a.fy += f * dy / d; a.fz += f * dz / d; }
    }
  }
}
/* (3-D) Whether a point is inside the Heat tool's reach: the cone from the eye through the pointer that the brush's
   circle is the cross-section of (cone: [eye x, y, z, unit direction x, y, z, radius over distance]), so it acts on what
   is seen under the brush, all the way through; without a cone, a ball round (t.x, t.y, t.z). */
function inTool3(t, x, y, z) {
  const c = t.cone;
  if (!c) { const dx = x - t.x, dy = y - t.y, dz = z - (t.z || 0); return dx * dx + dy * dy + dz * dz < t.R * t.R; }
  const dx = x - c[0], dy = y - c[1], dz = z - c[2], s = dx * c[3] + dy * c[4] + dz * c[5];
  if (!(s > 0)) return false;
  const r = c[6] * s;
  return dx * dx + dy * dy + dz * dz - s * s < r * r;
}

/* ------------------------------------------------------------------ momentum-conserving energy transfers */
/* Add (E>0) or remove (E<0) kinetic energy E via equal and opposite impulses on a and b (momentum conserved).
   Returns the energy actually transferred. */
function kickPair(a, b, E, ux, uy, uz = 0) {
  if (a === b || a.dead || b.dead || a.rad || b.rad || !E) return 0;
  const dvx = a.vx - b.vx, dvy = a.vy - b.vy, dvz = a.vz - b.vz;
  if (ux === undefined) {
    if (E < 0) { const v = hyp3(dvx, dvy, dvz); if (v < 1e-9) return 0; ux = dvx / v; uy = dvy / v; uz = dvz / v; }
    else { const u = rndDir(); ux = u[0]; uy = u[1]; uz = u[2]; }
  }
  const al = 0.5 * (a.im + b.im), be = ux * dvx + uy * dvy + uz * dvz;
  const disc = be * be + 4 * al * E;
  let J;
  if (disc < 0) { J = -be / (2 * al); E = -be * be / (4 * al); }
  else { const sq = Math.sqrt(disc); J = be >= 0 ? (-be + sq) / (2 * al) : (-be - sq) / (2 * al); }
  a.vx += J * ux * a.im; a.vy += J * uy * a.im;
  b.vx -= J * ux * b.im; b.vy -= J * uy * b.im;
  if (uz) { a.vz += J * uz * a.im; b.vz -= J * uz * b.im; }
  updateFast(a); updateFast(b);
  return E;
}
function nearestThird(a, b, R) {
  let best = null, bd = R * R;
  nearby(0.5 * (a.x + b.x), 0.5 * (a.y + b.y), R, (p, dx, dy, r2) => {
    if (p === a || p === b || p.dead || p.k !== NUC) return;
    if (r2 < bd) { bd = r2; best = p; }
  }, 0.5 * (a.z + b.z));
  return best;
}
/* Release heat locally: a nearby third body takes it (as in real recombination); without one the
   heat bath absorbs it, and in an insulated box the pair itself keeps it. */
function dumpHeat(E, a, b) {
  if (!(E > 0)) return;
  W.ledger.chem += E;
  const third = nearestThird(a, b, 6);
  if (third) { if (kickPair(rnd() < 0.5 ? a : b, third, E)) return; }
  else if (W.gamma > 0) { W.ledger.bath += E; return; }
  else if (kickPair(a, b, E)) return;
  // (no pair could take it: one atom alone (dumpHeat(E, tg, tg): a stopped particle's last keV, an ionization that
  // could not free its electron) or one in flight; kickPair took nothing and E left the books (a 3-D hypernucleus
  // stopping beside a lone nucleus −0.03 eV each, 1.26): the bath takes it, or in an insulated box the atom itself)
  if (W.gamma > 0) { W.ledger.bath += E; return; }
  const p = [a, b, third].find(q => q && !q.dead && !q.rad) || [a, b, third].find(q => q && !q.dead);
  if (!p) { W.ledger.escaped += E; return; }
  if (p.rad) { p.KE += E; radSpeed(p); p.vx = p.sp * p.ux; p.vy = p.sp * p.uy; return; }
  const u = rndDir(), vn = p.vx * u[0] + p.vy * u[1] + p.vz * u[2], s = -vn + Math.sqrt(vn * vn + 2 * E * p.im);
  p.vx += u[0] * s; p.vy += u[1] * s; if (W.d3) p.vz += u[2] * s; updateFast(p);
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
/* The spectroscope (Data tab): every photon made, as its wavelength (nm), when (W.rt) and from which element (Z, or 0),
   in a ring of the last 8,192. */
const SPEC_N = 8192;
function specRecord(E, src, z) {
  const S2 = W.spec || (W.spec = { nm: new Float64Array(SPEC_N), t: new Float64Array(SPEC_N), z: new Int16Array(SPEC_N), n: 0, total: 0 });
  const k = S2.total % SPEC_N;
  S2.nm[k] = PHYS.HC / E; S2.t[k] = W.rt; S2.z[k] = z !== undefined ? z : src && src.k === NUC && src.Z > 0 ? src.Z : 0;
  S2.total++; S2.n = Math.min(SPEC_N, S2.n + 1);
}
/* Glowing walls (Lab → Heat bath, off by default): reflecting walls at the bath temperature give off black-body light
   into the box. Real thermal light from a few nm of wall is far too faint to see at the atoms' pace, so the rate is a
   show rate, GLOW.N0 photons a second (for a 400 Å rim) at the Sun's 5,800 K, going as T⁴ (Stefan–Boltzmann), at most
   GLOW.MAX; each photon's energy is drawn from Planck's law and leaves the wall in a random direction weighted to the
   inward normal (Lambert). What an atom absorbs, the bath pays for (ledger.bath); light crossing the box back into the
   walls is the walls' own. The spectroscope marks it as the walls' (z = -1). */
const GLOW = { N0: 150, MAX: 600 };
const PLANCK_K = (() => { const c = []; let s = 0; for (let k = 1; k <= 60; k++) { s += 1 / (k * k * k); c.push(s); } return c.map(v => v / s); })();
function planckX() { // x = E/kT, photon numbers ∝ x²/(eˣ − 1) = Σₖ x² e^(−kx): pick k ∝ 1/k³, then x ~ Gamma(3)/k
  const u = rnd(); let k = 0; while (k < PLANCK_K.length - 1 && PLANCK_K[k] < u) k++;
  return -Math.log(Math.max(1e-300, rnd() * rnd() * rnd())) / (k + 1);
}
function glowTick(realDt) {
  if (!W.glow || W.wall !== 'reflect' || !(realDt > 0)) return;
  const T = Math.max(1, W.T), hw = W.box.w / 2, hh = W.box.h / 2, per = 4 * (hw + hh);
  W.glowAcc = (W.glowAcc || 0) + Math.min(GLOW.MAX, GLOW.N0 * Math.pow(T / 5800, 4) * per / 400) * realDt;
  let n = Math.floor(W.glowAcc); W.glowAcc -= n; n = Math.min(n, 20);
  const kT = PHYS.KB * T;
  if (W.d3) { // (3-D, 1.24: from a point on any of the six faces, by area, into the box with Lambert's cosine law)
    const hd = W.box.d / 2, A = [hh * hd, hh * hd, hw * hd, hw * hd, hw * hh, hw * hh], tot = A.reduce((a, b) => a + b, 0), H = [hw, hh, hd];
    for (let i = 0; i < n; i++) {
      let s = rnd() * tot, f = 0; while (f < 5 && s >= A[f]) { s -= A[f]; f++; }
      const ax = f >> 1, sg = f & 1 ? 1 : -1, P = [0, 0, 0], N = [0, 0, 0], u = (ax + 1) % 3, v = (ax + 2) % 3;
      P[ax] = sg * H[ax]; P[u] = (2 * rnd() - 1) * H[u]; P[v] = (2 * rnd() - 1) * H[v]; N[ax] = -sg;
      const st = Math.sqrt(rnd()), ct = Math.sqrt(1 - st * st), ph = rnd() * 2 * Math.PI, D = [0, 0, 0];
      D[ax] = N[ax] * ct; D[u] = st * Math.cos(ph); D[v] = st * Math.sin(ph);
      glowPhoton3(P[0] + N[0] * 0.01, P[1] + N[1] * 0.01, P[2] + N[2] * 0.01, kT * planckX(), D[0], D[1], D[2]);
    }
    return;
  }
  for (let i = 0; i < n; i++) {
    let s = rnd() * per, x, y, nx, ny;
    if (s < 2 * hw) { x = -hw + s; y = -hh; nx = 0; ny = 1; } else if ((s -= 2 * hw) < 2 * hh) { x = hw; y = -hh + s; nx = -1; ny = 0; }
    else if ((s -= 2 * hh) < 2 * hw) { x = hw - s; y = hh; nx = 0; ny = -1; } else { s -= 2 * hw; x = -hw; y = hh - s; nx = 1; ny = 0; }
    const th = Math.asin(2 * rnd() - 1), c = Math.cos(th), sn = Math.sin(th), ux = nx * c - ny * sn, uy = ny * c + nx * sn;
    glowPhoton(x + nx * 0.01, y + ny * 0.01, kT * planckX(), ux, uy);
  }
}
function glowPhoton3(x, y, z, E, ux, uy, uz) { // (3-D wall light, 1.24: as glowPhoton, along a line in depth)
  specRecord(E, null, -1);
  const hit = rayInteract3(x, y, z, ux, uy, uz, E, null);
  let x1, y1, z1;
  if (hit) { x1 = hit.x; y1 = hit.y; z1 = hit.z; } else { const t = rayExit3(x, y, z, ux, uy, uz); x1 = x + ux * t; y1 = y + uy * t; z1 = z + uz * t; }
  if (hit) W.ledger.bath -= E; // (an atom took it: the bath paid)
  W.rays.push({ x0: x, y0: y, z0: z, x1, y1, z1, E, c: photonColor(E), t0: W.rt, ts: W.t, len: Math.hypot(x1 - x, y1 - y, z1 - z), nu: false });
  if (W.rays.length > 400) W.rays.splice(0, W.rays.length - 400);
  if (hit && hit.after) hit.after();
}
function glowPhoton(x, y, E, ux, uy, bounce) {
  if (!bounce) specRecord(E, null, -1);
  let hit = rayInteract(x, y, ux, uy, E, null);
  let x1, y1;
  if (hit) { x1 = hit.x; y1 = hit.y; } else { const t = rayExit(x, y, ux, uy); x1 = x + ux * t; y1 = y + uy * t; }
  if (W.objs.length) { const oh = opticFind(x, y, ux, uy, Math.hypot(x1 - x, y1 - y), E); if (oh) { hit = opticHit(oh, x, y, ux, uy, E, { glow: true, bounce: bounce || 0 }); x1 = hit.x; y1 = hit.y; } } // (placed objects first: props.js)
  if (hit && !hit.obj) W.ledger.bath -= E; // (an atom took it: the bath paid)
  W.rays.push({ x0: x, y0: y, x1, y1, E, c: photonColor(E), t0: W.rt, ts: W.t, len: Math.hypot(x1 - x, y1 - y), nu: false }); // (no label: thermal light is many photons, a label each would bury the view)
  if (W.rays.length > 400) W.rays.splice(0, W.rays.length - 400);
  if (hit && hit.after) hit.after();
}
function emitPhoton(x, y, E, ux, uy, opts) {
  if (!(E > 0)) return;
  if (W.d3) { emitPhoton3(x, y, E, ux, uy, opts); return; } // (3-D: its own path, 1.24)
  const cont = opts && opts.cont; // (the same photon going on from a mirror, lens or prism: props.js)
  if (!cont) specRecord(E, opts && opts.src);
  if (ux === undefined) { const th = rnd() * 2 * Math.PI; ux = Math.cos(th); uy = Math.sin(th); }
  if (!cont) W.count.photons++;
  const dly = (opts && opts.delay) || 0; // (light in flight from a mirror, lens or prism: it sets off once the light has come that far, so the hit it is heading for is reckoned from then, 0.91)
  if (opts && opts.travel && dly) opts = Object.assign({}, opts, { delay: 0 });
  let x0 = x, y0 = y, depth = (opts && opts.depth) || 0;
  let hit = (opts && opts.noInteract) || depth > 3 ? null : rayInteract(x0, y0, ux, uy, E, opts && opts.src);
  let x1, y1;
  if (hit) { x1 = hit.x; y1 = hit.y; }
  else { const t = rayExit(x0, y0, ux, uy); x1 = x0 + ux * t; y1 = y0 + uy * t; }
  if (W.objs.length) { const oh = opticFind(x0, y0, ux, uy, Math.hypot(x1 - x0, y1 - y0), E); if (oh) { hit = opticHit(oh, x0, y0, ux, uy, E, opts); x1 = hit.x; y1 = hit.y; } } // (a placed piece first on its way)
  const lab = photonLabel(E, opts && opts.src);
  if (opts && opts.travel) { W.flights.push({ x0, y0, x1, y1, E, c: photonColor(E), t0: W.t + dly, len: Math.hypot(x1 - x0, y1 - y0), hit, lab }); return; }
  if (!hit) W.ledger.escaped += E;
  W.rays.push({ x0, y0, x1, y1, E, c: photonColor(E), t0: W.rt, ts: W.t + ((opts && opts.delay) || 0), len: Math.hypot(x1 - x0, y1 - y0), nu: false, lab, hitP: hit && hit.p ? speciesLabel(hit.p) : '' }); // (ts, len: it goes at c on the simulation's clock, drawRays; hitP: for the Inspect tab)
  if (W.rays.length > 400) W.rays.splice(0, W.rays.length - 400);
  if (hit && hit.after) hit.after();
}
/* Light in 3-D (1.24, the owner: "the Light tool in 3-D"; before, light left a 3-D box unabsorbed and was not drawn).
   A photon's line has a depth: it starts at opts.z (else its source atom's depth, else 0) and goes along (ux, uy, uz)
   (opts.uz; with no direction given, at random on the sphere); what it meets is found along that line in 3-D
   (rayInteract3: the atoms within 0.6 Å of the line, the flat strip's half-width, nearest first, by the flat game's
   rules and odds for each atom met), and it leaves through the box's six faces (rayExit3). Rays and photons in flight
   carry z0, z1 for drawing (view3d.js). Placed objects stay out of 3-D. */
function emitPhoton3(x, y, E, ux, uy, opts) {
  const cont = opts && opts.cont, src = opts && opts.src;
  if (!cont) specRecord(E, src);
  const z = opts && opts.z !== undefined ? opts.z : src ? src.z || 0 : 0;
  let uz;
  if (ux === undefined) { const u = rndDir(); ux = u[0]; uy = u[1]; uz = u[2]; }
  else { uz = opts && opts.uz !== undefined ? opts.uz : 0; const L = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1; ux /= L; uy /= L; uz /= L; }
  if (!cont) W.count.photons++;
  const dly = (opts && opts.delay) || 0;
  if (opts && opts.travel && dly) opts = Object.assign({}, opts, { delay: 0 });
  const depth = (opts && opts.depth) || 0;
  const hit = (opts && opts.noInteract) || depth > 3 ? null : rayInteract3(x, y, z, ux, uy, uz, E, src);
  let x1, y1, z1;
  if (hit) { x1 = hit.x; y1 = hit.y; z1 = hit.z; }
  else { const t = rayExit3(x, y, z, ux, uy, uz); x1 = x + ux * t; y1 = y + uy * t; z1 = z + uz * t; }
  const lab = photonLabel(E, src), len = Math.hypot(x1 - x, y1 - y, z1 - z);
  if (opts && opts.travel) { W.flights.push({ x0: x, y0: y, z0: z, x1, y1, z1, E, c: photonColor(E), t0: W.t + dly, len, hit, lab }); return; }
  if (!hit) W.ledger.escaped += E;
  W.rays.push({ x0: x, y0: y, z0: z, x1, y1, z1, E, c: photonColor(E), t0: W.rt, ts: W.t + dly, len, nu: false, lab, hitP: hit && hit.p ? speciesLabel(hit.p) : '' });
  if (W.rays.length > 400) W.rays.splice(0, W.rays.length - 400);
  if (hit && hit.after) hit.after();
}
function rayExit3(x, y, z, ux, uy, uz) {
  const hw = W.box.w / 2, hh = W.box.h / 2, hd = W.box.d / 2;
  let t = 1e9;
  if (ux > 1e-9) t = Math.min(t, (hw - x) / ux); else if (ux < -1e-9) t = Math.min(t, (-hw - x) / ux);
  if (uy > 1e-9) t = Math.min(t, (hh - y) / uy); else if (uy < -1e-9) t = Math.min(t, (-hh - y) / uy);
  if (uz > 1e-9) t = Math.min(t, (hd - z) / uz); else if (uz < -1e-9) t = Math.min(t, (-hd - z) / uz);
  return Math.max(0, t);
}
/* rayInteract along a line in 3-D: the same events with the same odds for each atom the line passes within 0.6 Å of,
   their consequences in 3-D (Compton scattering turned about a random axis; the pair leaving back to back in a random
   direction; ions, fluorescence and dissociation as in the flat world, which already work in 3-D). Nuclear reactions
   are flat-only (1.24, item 5): a photon that would knock a neutron out makes a pair there instead. */
function rayInteract3(x, y, z, ux, uy, uz, E, src) {
  const tmax = rayExit3(x, y, z, ux, uy, uz);
  _rayHits.length = 0;
  for (const p of W.parts) {
    if (p.dead || p.k !== NUC || p.Z === 0 || p === src) continue;
    const dx = p.x - x, dy = p.y - y, dz = p.z - z, t = dx * ux + dy * uy + dz * uz;
    if (t < 0.05 || t > tmax) continue;
    const ex = dx - t * ux, ey = dy - t * uy, ez = dz - t * uz, d = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (d < 0.6) _rayHits.push([t, p, d]);
  }
  if (!_rayHits.length) return null;
  _rayHits.sort((a, b) => a[0] - b[0]);
  for (const [t, p] of _rayHits) {
    const hx = x + ux * t, hy = y + uy * t, hz = z + uz * t;
    if (E >= 1e5) {
      if (E > 6e6 && !p.anti && rnd() < 0.0015 * p.Z * Math.min(1, gdrSigma(p.Z, p.N, E / 1e6) / (5.2 * p.Z * p.Z))) return { x: hx, y: hy, z: hz, p, after: () => { if (!photoNuclear(p, E, ux, uy, uz)) pairProduce3(p, E); } }; // (the giant dipole resonance in 3-D, 1.25)
      if (E > 1.022e6 && rnd() < 0.0015 * p.Z) return { x: hx, y: hy, z: hz, p, after: () => pairProduce3(p, E) };
      if (p.ne > 0 && rnd() < 0.012 * p.ne) return { x: hx, y: hy, z: hz, p, after: () => compton3(p, E, ux, uy, uz) };
      continue;
    }
    if (p.ne > 0) {
      const ie = ionizationCost(p);
      if (E >= ie && rnd() < 0.6 * Math.min(1, Math.pow(ie / E, 1.5) * 2)) return { x: hx, y: hy, z: hz, p, after: () => photoIonize(p, E - ie, ie) };
      if (p.bonds.length && E < ie) {
        let weak = null; for (const bd of p.bonds) if (!weak || bd.D < weak.D) weak = bd;
        if (weak && E >= weak.D && E >= 1.77 && rnd() < 0.35) return { x: hx, y: hy, z: hz, p, after: () => photoDissociate(weak, E) };
      }
      const L = LINES[p.el.sym];
      if (L && p.q === 0) for (const [nm] of L.l) if (Math.abs(PHYS.HC / E - nm) < 1.5) {
        if (rnd() < 0.6) return { x: hx, y: hy, z: hz, p, after: () => { glow(p, wavelengthRGB(nm)); W.count.photons++; emitPhoton(p.x, p.y, E, undefined, undefined, { depth: 9, src: p }); } };
      }
      if (E < 1.6 && p.bonds.length && rnd() < 0.3 && irActive(p)) return { x: hx, y: hy, z: hz, p, after: () => { const o = other(p.bonds[0], p); kickPair(p, o, E); } };
    }
  }
  return null;
}
function compton3(p, E, ux, uy, uz) {
  if (p.dead || p.ne === 0) return;
  const k = E / 511e3, ct = 2 * rnd() - 1, Ep = E / (1 + k * (1 - ct)), Te = E - Ep;
  const u = turn3(ux, uy, uz, Math.acos(ct)), nx = u[0], ny = u[1], nz = u[2];
  const KEe = Te - ionizationCost(p);
  if (KEe > 0.05 && ejectElectron(p, KEe, ux, uy, undefined, undefined, uz)) W.count.ionize++; else dumpHeat(Te, p, p);
  emitPhoton(p.x, p.y, Ep, nx, ny, { depth: 2, src: p, uz: nz });
}
function pairProduce3(p, E) {
  if (W.parts.length > MAX_PARTS) return;
  const T = (E - 2 * ME_C2) / 2, u = rndDir(), ux = u[0], uy = u[1], uz = u[2];
  const S = nucBegin([]); // (1.25: the books. A 3-D electron and positron are stepped with their potential energy (beside the nucleus and each other, 0.4 Å apart: tens to thousands of eV), which the flat game's pair, in radiation flight, does not have; their motion now pays it exactly)
  const e = addLepton(ELEC, p.x + 0.2 * ux, p.y + 0.2 * uy, 0, 0, p.z + 0.2 * uz); setMotion(e, Math.max(1, T), ux, uy, 0, 0, uz);
  const ps = addLepton(POS, p.x - 0.2 * ux, p.y - 0.2 * uy, 0, 0, p.z - 0.2 * uz); setMotion(ps, Math.max(1, T), -ux, -uy, 0, 0, -uz);
  W.ledger.nuc -= 2 * ME_C2;
  settleKE(S, E - 2 * ME_C2, [e, ps]);
  log('nuc', `Pair production: γ (${fmtE(E)}) → e⁻ + e⁺ near ${speciesLabel(p)}`);
  nucEvent('pair', p.x, p.y, `Pair production: γ → e⁻ + e⁺`, [], `${fmtE(E)} γ ray`, undefined, p.z); // (its caption at its depth: it was at z = 0, 1.26 sweep)
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
    if (f.z0 !== undefined) { const r = W.rays[W.rays.length - 1]; r.z0 = f.z0 + (f.z1 - f.z0) * d0 / L; r.z1 = f.z1; } // (3-D, 1.24)
    if (W.rays.length > 400) W.rays.splice(0, W.rays.length - 400);
    if (f.hit && f.hit.after && !(f.hit.p && f.hit.p.dead)) f.hit.after(); else W.ledger.escaped += f.E;
  }
}
/* How far along a ray its light has got: it goes at c on the simulation's clock (at normal speed, across the box
   within a frame; in slow motion, seen going). */
function rayFrac(r) { return r.landed || !(r.len > 0) ? 1 : clamp((W.t - r.ts) * PHYS.C / r.len, 0, 1); }
/* Light in flight: time slows until it crosses about 1.5% of the box a frame, so that it is seen going at c. */
function lightSlow() { return clamp(0.015 * Math.min(W.box.w, W.box.h) / (PHYS.C * (W.baseSpf || W.simPerFrame)), 1e-7, 1); } // (against the setup's normal speed: light crosses the box in about 70 frames at 1×, and the speed buttons and slow motion then scale that as they scale everything else)
/* ν and ν̄ of each flavour: νₑ, ν̄ₑ, νμ, ν̄μ, ντ, ν̄τ */
function nuLab(anti, fl) { return (anti ? 'ν̄' : 'ν') + ({ e: 'ₑ', mu: 'μ', tau: 'τ' })[fl || 'e']; }
function emitNeutrino(x, y, E, ux, uy, anti = false, how = 'a particle decay or reaction', fl = 'e', z = 0, uz = 0) { // (z, uz: 3-D, 1.24)
  const sym = nuLab(anti, fl);
  if (W.d3) { // (3-D: from its depth, in any direction; it passes through everything)
    if (ux === undefined) { const u = rndDir(); ux = u[0]; uy = u[1]; uz = u[2]; } else { const L = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1; ux /= L; uy /= L; uz /= L; }
    const t = rayExit3(x, y, z, ux, uy, uz);
    W.rays.push({ x0: x, y0: y, z0: z, x1: x + ux * t, y1: y + uy * t, z1: z + uz * t, E, c: [120, 255, 170], t0: W.rt, ts: W.t, len: t, nu: true, anti, fl, how, lab: sym + ' ' + fmtE(E) });
  } else {
  if (ux === undefined) { const th = rnd() * 2 * Math.PI; ux = Math.cos(th); uy = Math.sin(th); }
  const t = rayExit(x, y, ux, uy);
  W.rays.push({ x0: x, y0: y, x1: x + ux * t, y1: y + uy * t, E, c: [120, 255, 170], t0: W.rt, ts: W.t, len: t, nu: true, anti, fl, how, lab: sym + ' ' + fmtE(E) });
  }
  W.ledger.escaped += E;
  // the Data tab's "Made here": neutrinos and antineutrinos counted, with the energy they carried off
  const M = W.made || (W.made = { nuc: new Map(), part: new Map() });
  const nu = M.nu || (M.nu = new Map()), key = (anti ? 'nubar' : 'nu') + (fl || 'e');
  let r = nu.get(key); if (!r) { r = { anti, fl, lab: sym, n: 0, E: 0, how, t: W.t }; nu.set(key, r); }
  r.n++; r.E += E;
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
  if (W.d3) return null; // (3-D, stage 1a: light is not absorbed yet, its search is along a flat line: it leaves the box)
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
    if (E >= 1e5) { // gamma: Compton scattering, pair production, and (above ~8 MeV) the nucleus itself
      if (E > 6e6 && !p.anti && rnd() < 0.0015 * p.Z * Math.min(1, gdrSigma(p.Z, p.N, E / 1e6) / (5.2 * p.Z * p.Z))) { // (in proportion to pair production, σ ≈ 5.2 Z² mb at these energies)
        return { x: hx, y: hy, p, after: () => { if (!photoNuclear(p, E, ux, uy)) pairProduce(p, E); } };
      }
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
  log('chem', `Photodissociation: light (${(PHYS.HC / E).toFixed(0)} nm) split ${a.mu ? 'Mu' : a.el.sym}–${b.mu ? 'Mu' : b.el.sym}`);
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
  if (p.xb) { exoSpeed(p); return; } // (an unstable particle in a collider's beam: hep.js, 1.15)
  const mc2 = (p.k !== NUC ? PHYS.MEC2 : p.m * PHYS.AMU_MEV) * 1e6;
  const g = 1 + p.KE / mc2;
  p.gam = g; p.sp = PHYS.C * Math.sqrt(Math.max(0, 1 - 1 / (g * g)));
}
/* Give particle p kinetic energy KE (eV) along (ux, uy) relative to frame (bvx, bvy). */
function setMotion(p, KE, ux, uy, bvx = 0, bvy = 0, uz = 0, bvz = 0) { // (uz, bvz: 3-D)
  const isLep = p.k !== NUC, neutron = p.k === NUC && p.Z === 0;
  const thr = neutron ? NEUTRON_RAD : radThreshold(isLep);
  if (W.d3) { // (3-D: the same, with z, at any energy (1.23.2): the radiation flight is flat, so a fast particle stays in the stepped set, moving in depth, and walls3 stops it at a closed box's wall by its speed, as the flat walls stop radiation flight; before, one past the threshold flew flat, z held, meeting nuclei at any depth)
    p.rad = false;
    const vv = 2 * KE * p.im, ub = ux * bvx + uy * bvy + uz * bvz, disc = ub * ub - (bvx * bvx + bvy * bvy + bvz * bvz) + vv;
    if ((bvx || bvy || bvz) && disc >= 0 && Math.sqrt(disc) > ub) { const w = Math.sqrt(disc) - ub; p.vx = bvx + w * ux; p.vy = bvy + w * uy; p.vz = bvz + w * uz; }
    else { const v = Math.sqrt(vv); p.vx = v * ux; p.vy = v * uy; p.vz = v * uz; }
    updateFast(p);
    return;
  }
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
  if (W.d3) { // (3-D: electrons stay in the stepped set, the step size following them (1.23); atoms fly ballistically past V_FAST_ON as in the flat game, their collisions found along their paths in depth, fastEncounters3 (1.25))
    if (p.k !== NUC) { // (bug fix 14 after 1.25: past LEP3_ON a lepton flies, at its true speed, moveFastLeptons3; below it, stepped as before)
      const ke = 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
      if (!p.fast && ke > LEP3_ON) switchMode(p, true);
      else if (p.fast && ke < LEP3_OFF) switchMode(p, false);
      return;
    }
    const v2 = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz;
    if (!p.fast && v2 > V_FAST_ON * V_FAST_ON) switchMode(p, true);
    else if (p.fast && v2 < V_FAST_OFF * V_FAST_OFF) switchMode(p, false);
    return;
  }
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
  if (!_nmd) { p.fast = toFast; return; }
  if (toFast && p.k === NUC && p.bonds.length) {
    // an atom knocked this fast (hundreds of eV) tears out of its molecule: its bonds break, paid from its motion
    // (a flying atom feels no bond, so one kept would gain energy from nowhere as it stretched)
    const set = setOf(molecule(p)), U0 = localPE(set);
    for (const bd of p.bonds.slice()) removeBond(bd);
    const owed = localPE(closeSet(set)) - U0, ke0 = 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
    const f = Math.sqrt(Math.max(0, ke0 - owed) / ke0);
    p.vx *= f; p.vy *= f; p.vz *= f;
    if (f * f * ke0 < 0.5 * p.m * V_FAST_ON * V_FAST_ON) { W.count.broken++; return; } // slowed below flight: stays
    W.count.broken++;
  }
  const one = new Set([p]);
  let U;
  if (toFast) U = p.k === NUC ? localPE(one) - fieldU(p) : p.q * phiE(p.x, p.y, p, undefined, p.z); // (the applied field pushes it in flight too: its energy there does not change with the mode)
  else { p.fast = false; U = p.k === NUC ? localPE(one) - fieldU(p) : p.q * phiE(p.x, p.y, p, undefined, p.z); p.fast = true; }
  const ke = 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz), k2 = toFast ? ke + U : ke - U;
  if (!(k2 > 0.05 * ke)) return; // stay in the current mode
  const f = Math.sqrt(k2 / ke);
  p.vx *= f; p.vy *= f; p.vz *= f; p.fast = toFast;
  // back among the stepped particles before the neighbour grid is rebuilt: list it with the newcomers, so the
  // potential energy of anything else that changes mode before then counts it (or energy would vanish)
  if (!toFast && S.inMD[p.i] === 0 && !_late.includes(p)) _late.push(p); // (inMD: listed when the grid was built)
}
function cationNear(p) {
  if (!_nmd) return false;
  let f = false;
  nearby(p.x, p.y, 3.5, (o) => { if (o.k === NUC && o.q * p.q <= -1) { f = true; return false; } }, p.z);
  return f;
}
function startTrack(p) {
  const col = p.k === ELEC ? [90, 170, 255] : p.k === POS ? [255, 110, 200] : p.Z === 0 ? [170, 175, 185] :
    p.Z === 2 && p.N === 2 ? [255, 200, 90] : p.Z === 2 ? [235, 130, 255] : p.Z === 1 && p.N === 1 ? [120, 230, 160] :
    p.anti ? [190, 125, 255] : p.Z === 1 && p.N === 2 ? [110, 220, 235] : p.Z === 1 ? [255, 110, 100] : [255, 90, 60];
  const w = p.k !== NUC ? 1 : p.Z === 0 ? 1 : p.Z === 2 ? 2.2 : p.Z > 20 ? 3.2 : 1.6;
  _trkN++;
  p.trk = { pts: [p.x, p.y], ts: [W.rt], tt: [W.t], c: col, w, t0: W.rt, upd: W.rt, dash: p.Z === 0 && p.k === NUC, beam: !!p.beam, p, seuI: 0, seuE0: 0, seuDep: 0 };
  if (W.d3) p.trk.pz = [p.z]; // (3-D: each point's depth) // (p, seu…: for the charge it frees crossing a chip, chips.js)
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
/* Drop a track's k oldest points (with their times; a chip's place along it moves back with them). */
function trkDrop(t, k) {
  if (k <= 0) return;
  t.pts.splice(0, 2 * k); if (t.ts) { t.ts.splice(0, k); t.tt.splice(0, k); } if (t.pz) t.pz.splice(0, k);
  if (t.seuI !== undefined) t.seuI = Math.max(0, t.seuI - 2 * k);
}
/* A track at its 400 points is thinned, not cut: every other point of its older half goes, so it keeps the time it
   spans (Settings → Particle trails) at a little less detail where it is oldest. */
function trkThin(t) {
  const n = t.pts.length >> 1, half = n >> 1, P = [], TS = [], TT = [], PZ = t.pz ? [] : null;
  let seu = t.seuI !== undefined ? t.seuI >> 1 : -1, seuN = 0;
  for (let i = 0; i < n; i++) {
    if (i < half && (i & 1)) continue;
    if (i < seu) seuN++;
    P.push(t.pts[2 * i], t.pts[2 * i + 1]); if (t.ts) { TS.push(t.ts[i]); TT.push(t.tt[i]); } if (PZ) PZ.push(t.pz[i]);
  }
  t.pts = P; if (t.ts) { t.ts = TS; t.tt = TT; } if (PZ) t.pz = PZ;
  if (seu >= 0) t.seuI = 2 * seuN;
}
function extendTrack(p) {
  const t = p.trk; if (!t) return;
  const n = t.pts.length;
  const lx = t.pts[n - 2], ly = t.pts[n - 1];
  if (t.pz ? Math.abs(lx - p.x) + Math.abs(ly - p.y) + Math.abs(t.pz[t.pz.length - 1] - p.z) > 0.4 : Math.abs(lx - p.x) + Math.abs(ly - p.y) > 0.4) { t.pts.push(p.x, p.y); if (t.ts) { t.ts.push(W.rt); t.tt.push(W.t); } if (t.pz) t.pz.push(p.z); if (t.pts.length > 800) trkThin(t); }
  t.upd = W.rt;
}
/* Electrostatic potential (V) felt by an electron at (x, y) from nearby charges (soft-cored as in the forces). */
/* The applied uniform field's potential at (x, y, z) (V: φ = −E·r) and a particle's energy in it (q·φ, with an atom's
   partial charge, as the force has it). totalEnergy leaves it out (the field does work on the books, which tests
   count as total + Σ q·φ); an event that changes a charge or moves one must count it, or it misses −q E·Δr (bug fix 6
   after 1.25): localPE and regionE include it for their atoms, ejectElectron and joinEnergy for the lepton. */
function fieldPhi(x, y, z) { return -(W.Ex * x + W.Ey * y + (W.d3 ? (W.Ez || 0) * (z || 0) : 0)); }
function fieldU(p) {
  if (!W.Ex && !W.Ey && !(W.d3 && W.Ez)) return 0;
  const q = p.k === NUC ? p.q + (p.qp || 0) : p.q;
  return q ? q * fieldPhi(p.x, p.y, p.z) : 0;
}
function phiE(x, y, skip, skip2, z = 0) { // (3-D: at (x, y, z))
  let phi = 0;
  const visit = (o, dx, dy, r2) => {
    if (o === skip || o === skip2 || o.fast || o.rad) return;
    const q = o.q, sf = o.k === NUC ? o.sEN : 0.04;
    if (q) phi += PHYS.KE * q * (1 / Math.sqrt(r2 + sf) - (1 / Math.sqrt(RC2 + sf) - (_lrOn && isLR(o) ? 1 / RC : 0)));
  };
  nearby(x, y, RC, visit, z);
  for (const o of _late) { if (o.dead) continue; const dx = o.x - x, dy = o.y - y, dz = o.z - z, r2 = dx * dx + dy * dy + dz * dz; if (r2 < RC2) visit(o, dx, dy, r2); }
  if (_lrOn) for (const o of _charged) { // net charges beyond the cutoff
    if (o === skip || o === skip2 || o.dead || o.fast || o.rad || !isLR(o)) continue;
    const dx = o.x - x, dy = o.y - y, dz = o.z - z, r2 = dx * dx + dy * dy + dz * dz;
    if (r2 >= RC2) phi += PHYS.KE * o.q / Math.sqrt(r2);
  }
  return phi;
}
function ejectElectron(p, KE, ux, uy, budget, tunnel, uz = 0) {
  if (p.ne <= 0) return null;
  // at the particle cap we skip the ionization entirely (never leave an ion without its electron)
  if (freeElectronCount() >= MAX_FREE_E || W.parts.length >= MAX_PARTS) { W.ledger.bath += KE; return null; }
  const bc = budget === undefined ? breakCostIfCharged(p, -1) : budget;
  const grid = _nmd > 0, set = setOf(molecule(p)), sn = snapshot(set);
  if (ux === undefined) { const u = rndDir(); ux = u[0]; uy = u[1]; uz = u[2]; }
  const d3 = W.d3, hd = W.box.d / 2 - 0.2;
  // the change of potential energy: the ion's new charge and size against its surroundings, plus any bonds that had to
  // break (localDelta: over the ion's neighbourhood in a big molecule, exactly)
  const fastIon = d3 && p.fast, kIon0 = fastIon ? keOf(p) : 0; // (3-D, 1.25: an atom in flight carries no potential energy, so neither its new charge nor the electron's pull toward it is in the books; and the electron's share of its motion, ½mₑv², leaves with the electron)
  const dU = grid && !fastIon ? localDelta(p, set, sn, () => { p.ne--; refresh(p); enforceValence(p, null); }) : (p.ne--, refresh(p), enforceValence(p, null), 0);
  // The electron is born inside the ion's Coulomb well and near other charges. Its launch energy is
  // set so that the total energy is conserved: KE_launch = KE_far + budget + φ(electron) − ΔU.
  const qa = p.q, lq = p.anti ? 1 : -1; // the ion's charge now, and that of the lepton set free
  const Kfar = KE + bc - dU, off0 = (p.rd || 0.4) + 0.5;
  const closed = W.wall !== 'wrap' && W.wall !== 'open', hw = W.box.w / 2 - 0.2, hh = W.box.h / 2 - 0.2;
  let ex = 0, ey = 0, ez = 0;
  const launch = (o, dx, dy, dz = 0) => { // kinetic energy it must start with at distance o for the total to be conserved
    ex = p.x + dx * o; ey = p.y + dy * o; if (d3) ez = p.z + dz * o;
    if (closed && (Math.abs(ex) > hw || Math.abs(ey) > hh || (d3 && Math.abs(ez) > hd))) return -Infinity; // beyond the chamber wall
    // a ballistic (radiation-mode) lepton carries no potential energy: then only the energy at infinity counts
    if (Kfar > radThreshold(true) && !d3) return Kfar; // (3-D: no radiation flight, a fast electron is stepped with its potential energy like any other, 1.24: a Compton electron lost the ion's 10–16 eV pull)
    const phiSelf = qa && !fastIon ? PHYS.KE * qa * (1 / Math.sqrt(o * o + p.sEN) - (1 / Math.sqrt(RC2 + p.sEN) - (_lrOn && isLR(p) ? 1 / RC : 0))) : 0;
    return Kfar - lq * (phiSelf + (grid ? phiE(ex, ey, p, undefined, ez) : 0) + fieldPhi(ex, ey, ez)); // (the applied field too: bug fix 6 after 1.25)
  };
  if (closed) { if (Math.abs(p.x + ux * off0) > hw) ux = -ux; if (Math.abs(p.y + uy * off0) > hh) uy = -uy; if (d3 && Math.abs(p.z + uz * off0) > hd) uz = -uz; } // away from a wall
  let off = off0, KEl = launch(off, ux, uy, uz);
  // An electron the ion cannot hold (a multiply charged anion's) is free at infinity but walled in by the ion's own
  // repulsion close by: it tunnels out, so it starts beyond the barrier, in a direction where its energy suffices.
  if (KEl < 0.02 && tunnel && Kfar > 0.05 && d3) { // (3-D: along the axes and the cube's diagonals)
    search3: for (let j = 0; j < 27; j++) {
      if (j === 13) continue; // (the centre of the 3 × 3 × 3)
      let dx = (j % 3) - 1, dy = ((j / 3 | 0) % 3) - 1, dz = (j / 9 | 0) - 1;
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz); dx /= l; dy /= l; dz /= l;
      for (let o = off0 * 1.25; o < 9; o *= 1.25) { const K = launch(o, dx, dy, dz); if (K >= 0.02) { KEl = K; off = o; ux = dx; uy = dy; uz = dz; break search3; } }
    }
    if (KEl >= 0.02) launch(off, ux, uy, uz);
  } else if (KEl < 0.02 && tunnel && Kfar > 0.05) {
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
  const e = addLepton(p.anti ? POS : ELEC, ex, ey, 0, 0, ez);
  if (d3) setMotion(e, KEl + (fastIon ? kIon0 - keOf(p) : 0), ux, uy, p.vx, p.vy, uz, p.vz); else setMotion(e, KEl, ux, uy, p.vx, p.vy);
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
  if (p.k !== NUC || p.Z === 0 || p.ne <= zChem(p)) return false;
  if (p.ne > zChem(p) + maxExtraElectrons(zChem(p)) || !(p.el.ea > 0)) return true;
  if (p.ne === p.Z + 1 || p.bonds.length) return false;
  let stab = 0;
  nearby(p.x, p.y, 5, (o) => { if (o !== p && o.k === NUC && o.q * p.q < 0) stab += Math.abs(o.q); }, p.z);
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
  while (p.ne > zChem(p) + maxExtraElectrons(zChem(p)) && guard++ < 200) if (!shedElectron(p)) break;
  if (p.ne > zChem(p) + 1 && p.bonds.length === 0) {
    // isolated multiply-charged anions are unbound in vacuum unless counter-ions stabilise them
    let stab = 0;
    nearby(p.x, p.y, 5, (o) => { if (o !== p && o.k === NUC && o.q * p.q < 0) stab += Math.abs(o.q); }, p.z);
    if (stab === 0) while (p.ne > zChem(p) + 1 && guard++ < 200) if (!shedElectron(p)) break;
  }
  if (p.ne === p.Z + 1 && !(p.el.ea > 0)) shedElectron(p); // no stable anion at all (N⁻, the noble gases …)
  // still more than any ion of its element can hold (it could not shed one: inside a strongly charged molecule, or
  // among ions that hold on to it): the extra electron moves to the atom of its molecule best able to take it, or
  // else is set free, the surroundings paying for its release
  for (let k = 0; k < 4 && p.ne > zChem(p) + maxExtraElectrons(zChem(p)); k++) if (!handOff(p) && !forceShed(p)) break;
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
    const za = zChem(a), room = a.ne + 1 <= za || (a.ne + 1 === za + 1 ? a.el.ea >= 0.7 : a.ne + 1 <= za + maxExtraElectrons(za));
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
function lzNeed() { if (_lzOn) lazyCatch(); } // (the far atoms where they are now, for code that may look at any atom)
function processEvents() {
  const q = W.evq;
  for (let i = 0; i < q.length; i++) {
    const ev = q[i];
    if (_lzOn && ev.type !== EV.LEPTON) lazyCatch(); // (a lepton meeting an atom touches the two of them unless it goes further: evLepton says when)
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
  if ((W.step & 7) === 0 && W.bonds.length) backflow();
  if (MBO.on && MBO.n && W.bonds.length) mbEvents(); // (many-body metals: molecules of O and H splitting on the metal, 1.26)
}
/* 1.15 (asked for by the user: Ni⁺–C⁻, made by an electron hop and then a bond, never became the neutral Ni=C). Two
   bonded atoms with opposite whole charges: the electron may flow back through the bond, the valence it frees going
   into the bond (one order more, as both atoms allow). Tried on the molecule as any event is, the energy measured
   exactly before and after (localPE over the molecule, the two atoms' electrons); kept when it goes down, the
   difference released as heat; undone otherwise. A few such bonds every eighth step. */
function backflow() {
  let tries = 0;
  for (const bd of W.bonds.slice()) {
    const a = bd.a, b = bd.b;
    if (a.dead || b.dead || !(a.q * b.q < 0) || a.bom || b.bom || a.k !== NUC || b.k !== NUC || a.fast || b.fast || a.rad || b.rad) continue;
    if (W.bonds.indexOf(bd) < 0) continue;
    if (++tries > 8) break;
    const pos = a.q > 0 ? a : b, neg = pos === a ? b : a;
    if (pos.ne === 0 || neg.ne <= 0 || pos.Z === 0 || neg.Z === 0) continue;
    const set = new Set(molecule(pos)), sn = snapshot(set);
    const lab0 = speciesLabel(pos), E0 = localPE(set) + internalE(pos) + internalE(neg);
    pos.ne++; neg.ne--; refresh(pos); refresh(neg);
    if (bd.order < 3 && pos.cap - pos.used >= 1 && neg.cap - neg.used >= 1) setOrder(bd, bd.order + 1);
    enforceValence(pos, null); enforceValence(neg, null);
    closeSet(set);
    const heat = E0 - (localPE(set) + internalE(pos) + internalE(neg));
    if (!(heat > 0.01)) { restoreSnap(sn); continue; }
    dumpHeat(heat, pos, neg);
    log('chem', `Charge flowed back through a bond: ${lab0} → ${speciesLabel(pos)} (${fmtE(heat)} released)`);
  }
}

/* Nothing bonds or reacts in flight or in a hard collision: past ten times the strongest bond's energy (the two
   molecules' motion relative to each other, as snapTogether takes their meeting) atoms only bounce. A keV fragment
   from an annihilation that bonded or reacted turned that motion into energy from nowhere (0.65). */
const HARD_MEET = 100; // eV
function hardMeet(a, b) {
  if (a.fast || b.fast || a.rad || b.rad) return true;
  const ma = molecule(a), mb = molecule(b);
  if (ma.includes(b)) return false;
  let Ma = 0, Mb = 0, ax = 0, ay = 0, bx = 0, by = 0, az = 0, bz = 0;
  for (const p of ma) { Ma += p.m; ax += p.m * p.vx; ay += p.m * p.vy; az += p.m * p.vz; }
  for (const p of mb) { Mb += p.m; bx += p.m * p.vx; by += p.m * p.vy; bz += p.m * p.vz; }
  const dvx = bx / Mb - ax / Ma, dvy = by / Mb - ay / Ma, dvz = bz / Mb - az / Ma;
  return 0.5 * Ma * Mb / (Ma + Mb) * (dvx * dvx + dvy * dvy + dvz * dvz) > HARD_MEET;
}
function evBond(a, b, r) {
  if (a.dead || b.dead || bondBetween(a, b) || a.bom || b.bom) return; // (continuous bond orders: no stored bond to a member)
  if (!(a.cap - a.used > 0 && b.cap - b.used > 0) || !covalentOK(a, b)) return;
  if (a.mol !== 0 && a.mol === b.mol && a.excl && a.excl.has(b.id)) return;
  if (hardMeet(a, b)) return;
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
  const [dx, dy, dz] = minImg(b.x - a.x, b.y - a.y, b.z - a.z);
  const r = hyp3(dx, dy, dz) || 1e-6, ux = dx / r, uy = dy / r, uz = dz / r, M = a.m + b.m, sh = r - bd.r0;
  if (Math.abs(sh) < 0.02 || a.bonds.length > 1 || b.bonds.length > 1) return;
  a.x += ux * sh * b.m / M; a.y += uy * sh * b.m / M; b.x -= ux * sh * a.m / M; b.y -= uy * sh * a.m / M;
  if (uz) { a.z += uz * sh * b.m / M; b.z -= uz * sh * a.m / M; }
}

/* Radical X collides with saturated atom A. Reacts if the collision energy along the line of centres
   exceeds the activation energy (Semenov–Polanyi); otherwise the repulsion simply bounces them apart. */
const _rxTried = new Map();
function evReact(X, A, rx, r) {
  if (X.dead || A.dead || rx.topo !== W.topo || X.bom || A.bom) return;
  if (!(X.cap - X.used > 0) || W.bonds.indexOf(rx.bd) < 0 || bondBetween(X, A)) return;
  const key = X.id * 131072 + A.id, last = _rxTried.get(key);
  if (last !== undefined && W.step - last < 30) return; // one test per encounter
  if (hardMeet(X, A)) return;
  const [dx, dy, dz] = minImg(A.x - X.x, A.y - X.y, A.z - X.z);
  const rr = hyp3(dx, dy, dz) || 1e-6, nx = dx / rr, ny = dy / rr, nz = dz / rr;
  const vn = (A.vx - X.vx) * nx + (A.vy - X.vy) * ny + (A.vz - X.vz) * nz;
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
  const saved = [...set].map(p => [p, p.x, p.y, p.vx, p.vy, p.z, p.vz]);
  const oldOrder = bd.order;
  const PE0 = localPE(set);
  if (rx.type === 'abs') removeBond(bd); else setOrder(bd, bd.order - 1);
  const Kr = snapTogether(X, A, rx.r0);
  const nb = addBond(X, A, 1);
  if (rx.type === 'abs') {
    // the leaving fragment B is still at bonding distance from A: move it out of the repulsive core
    const mb = molecule(B);
    const [ex, ey, ez] = minImg(B.x - A.x, B.y - A.y, B.z - A.z);
    const rb = hyp3(ex, ey, ez) || 1e-6, target = 0.85 * 0.5 * (A.ljR + B.ljR);
    if (rb < target) { const sh = target - rb; for (const p of mb) { p.x += ex / rb * sh; p.y += ey / rb * sh; if (ez) p.z += ez / rb * sh; } }
  }
  const heat = PE0 - localPE(set) + Kr;
  if (heat < 0) {
    // not enough energy for these products after all: undo and let the atoms bounce
    const avail = 0.5 * X.m * A.m / (X.m + A.m) * ((A.vx - X.vx) ** 2 + (A.vy - X.vy) ** 2 + (A.vz - X.vz) ** 2);
    if (-heat > 0.9 * avail) {
      removeBond(nb);
      if (rx.type === 'abs') addBond(A, B, oldOrder); else setOrder(bd, oldOrder);
      for (const [p, x, y, vx, vy, z, vz] of saved) { p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.z = z; p.vz = vz; }
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

/* Remove bond bd (of a molecule, set) and return the change in potential energy. In a big molecule (a chip) only what
   lies within two bonds of its atoms can change — removing a bond moves nothing, and charges spread by resonance only so
   far — so the difference is taken over that neighbourhood (localDelta's method): the rest of the molecule is checked by a
   fingerprint afterwards and, should anything there have changed, the bond is put back and the whole molecule summed. */
let _bcBond = null;
function breakCost(bd, set) {
  const a = bd.a, b = bd.b;
  let cost;
  if (set.size > LOCAL_MOL) { // a big molecule (a chip): only what lies within two bonds of a and b can change (localDelta's method)
    const Sn = new Set([a, b]);
    for (const c of [a, b]) for (const b1 of c.bonds) { const o = other(b1, c); Sn.add(o); for (const b2 of o.bonds) Sn.add(other(b2, o)); }
    // (1.09: the rest must stay one molecule, whatever number it is given: removing a bond renumbers the molecule, so the
    // number itself in the fingerprint missed on every bond of a ring too, and each try in a melted chip summed it whole)
    const print = (q) => q.x * 1.000003 + q.y * 1.7 + q.q * 3.1 + q.qp * 5.3 + q.rd * 7.9 + q.ne * 11 + q.bonds.length * 13;
    const before = new Map(); for (const q of set) if (!Sn.has(q)) before.set(q, print(q));
    const U0 = localPE(Sn);
    removeBond(bd);
    let local = true, mol = null;
    for (const [q, v] of before) { if (mol === null) mol = q.mol; if (q.dead || print(q) !== v || q.mol !== mol) { local = false; break; } }
    if (local) cost = localPE(Sn) - U0;
    else { _localMiss++; bd = addBond(a, b, bd.order); const PE0 = localPE(set); removeBond(bd); cost = localPE(set) - PE0; } // (beyond the neighbourhood: put back, and over the whole molecule)
  } else {
    const PE0 = localPE(set);
    removeBond(bd);
    cost = localPE(set) - PE0;
  }
  _bcBond = bd;
  return cost;
}
function evBreak(bd, r) {
  if (W.bonds.indexOf(bd) < 0) return;
  const a = bd.a, b = bd.b;
  const dvx = b.vx - a.vx, dvy = b.vy - a.vy, dvz = b.vz - a.vz;
  const [dx, dy, dz] = minImg(b.x - a.x, b.y - a.y, b.z - a.z);
  const rr = hyp3(dx, dy, dz) || 1;
  const vn = (dvx * dx + dvy * dy + dvz * dz) / rr;
  // stretched past where it can hold (its Morse pull long since gone: only the angle terms still tie the atom on), with a
  // heat bath to draw on: it breaks, and the bath pays what the pair's own motion cannot (the bath trades energy anyway)
  const over = W.gamma > 0 && rr > Math.min(2.5 * bd.r0, RC);
  if (vn <= 0 && !over) return;
  const set = setOf(molecule(a));
  const cost = breakCost(bd, set); bd = _bcBond; // (the bond removed: what it cost in potential energy)
  const mu = a.m * b.m / (a.m + b.m), have = vn > 0 ? 0.5 * mu * vn * vn : 0;
  if (have < cost) {
    if (!over) { addBond(a, b, bd.order); return; } // not enough energy: stays bound
    if (have > 0) kickPair(b, a, -have, dx / rr, dy / rr, dz / rr);
    W.ledger.bath -= cost - have; // (drawn from the bath)
  } else kickPair(b, a, -cost, dx / rr, dy / rr, dz / rr);
  W.count.broken++;
  log('chem', `Bond broke: ${a.mu ? 'Mu' : a.el.sym}–${b.mu ? 'Mu' : b.el.sym} (needed ${fmtE(bd.D)})${have < cost ? `, overstretched to ${rr.toFixed(1)} Å: the heat bath gave ${fmtE(cost - have)}` : ''}`);
}

/* Electron or positron meets a nucleus/atom. */
function evLepton(L, A, r) {
  if (L.dead || A.dead) return;
  const rh = A.ne > 0 ? 0.35 + 0.5 * A.el.rc : 0.55;
  const mu = L.m * A.m / (L.m + A.m);
  const dvx = L.vx - A.vx, dvy = L.vy - A.vy, dvz = L.vz - A.vz;
  const Erel = 0.5 * mu * (dvx * dvx + dvy * dvy + dvz * dvz);
  if (clash(L, A)) { // a positron at ordinary matter, or an electron at antimatter
    if (r > rh || L.hit === A.id) return;
    L.hit = A.id;
    if (A.ne > 0) { lzNeed(); annihilateBound(L, A); } else elasticScatter(L, A, 0);
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
    if (Etot < -0.15 * ionE(zChem(A), A.ne + 1)) { if (may && rnd() < 0.5) (lzNeed(), capture(L, A, Etot)); return; }
    if (Etot < 0) { if (may && rnd() < 0.02) (lzNeed(), capture(L, A, Etot)); return; } // loosely bound (Rydberg-like) orbit
    if (may && r < rh && L.hit !== A.id && rnd() < 0.04 / (1 + Etot / 0.5)) { (lzNeed(), capture(L, A, Etot)); return; }
  }
  if (r >= rh || L.hit === A.id) return;
  L.hit = A.id;
  if (A.ne > 0 && A.q === 0 && A.el.ea > 0 && A.ne < zChem(A) + maxExtraElectrons(zChem(A)) && !(L.capT > W.t) && rnd() < 0.04) {
    lzNeed(); if (attach(L, A, Erel)) return;
  }
  if (A.ne > 0) {
    // Only the electron's energy relative to the atom counts: near an ion it has extra kinetic energy
    // borrowed from the ion's own Coulomb well, which cannot be spent on ionizing or exciting it.
    const qa = A.q;
    const Eeff = Math.min(Erel, Erel + (qa ? PHYS.KE * L.q * qa / Math.sqrt(r * r + A.sEN) : 0));
    const ie = ionizationCost(A);
    if (Eeff > ie) {
      const x = Eeff / ie, P = Math.min(0.8, 1.6 * Math.log(x) / x);
      if (rnd() < P) { lzNeed(); impactIonize(L, A, ie, Erel); return; }
    }
    const line = lineInfo(A);
    if (line && Eeff > line.thr && rnd() < 0.15) { lzNeed(); exciteByElectron(L, A, line, Eeff); return; }
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
  // the line seen, and the rest of the cascade down to the ground state as one more photon. A line's upper level is
  // at least as high as its photon: a line above L.thr (the element's lowest, as potassium's 404 nm over its 1.61 eV)
  // costs its own energy, and is only made when the collision has that much (0.67: it was paid L.thr, light from nowhere)
  const cost = (nm) => Math.max(L.thr, PHYS.HC / nm), ok = L.l.filter(l => !(Eavail < cost(l[0])));
  if (!ok.length) return null;
  let tot = 0; for (const l of ok) tot += l[1];
  let u = rnd() * tot;
  for (const l of ok) { u -= l[1]; if (u <= 0) return { nm: l[0], thr: cost(l[0]), extraUV: cost(l[0]) - PHYS.HC / l[0] }; }
  const l0 = ok[ok.length - 1][0];
  return { nm: l0, thr: cost(l0), extraUV: cost(l0) - PHYS.HC / l0 };
}
function emitLineFrom(A, ln) {
  const E = PHYS.HC / ln.nm;
  glow(A, wavelengthRGB(ln.nm));
  emitPhoton(A.x, A.y, E, undefined, undefined, { src: A, depth: 2 });
  if (ln.extraUV > 1e-9) emitPhoton(A.x, A.y, ln.extraUV, undefined, undefined, { src: A, depth: 2 });
}
function exciteByElectron(L, A, line, Eavail) {
  const ln = pickLine(A, Eavail);
  if (!ln) return;
  const mu = L.m * A.m / (L.m + A.m), Erel = 0.5 * mu * ((L.vx - A.vx) ** 2 + (L.vy - A.vy) ** 2 + (L.vz - A.vz) ** 2);
  const f = Math.sqrt(Math.max(0, 1 - ln.thr / Erel));
  const Vx = (L.m * L.vx + A.m * A.vx) / (L.m + A.m), Vy = (L.m * L.vy + A.m * A.vy) / (L.m + A.m), Vz = (L.m * L.vz + A.m * A.vz) / (L.m + A.m);
  const rvx = (L.vx - A.vx) * f, rvy = (L.vy - A.vy) * f, rvz = (L.vz - A.vz) * f;
  const th = (rnd() - 0.5) * 1.2, c = Math.cos(th), s = Math.sin(th);
  let nx = rvx * c - rvy * s, ny = rvx * s + rvy * c, nz = 0;
  if (W.d3) { const u = turn3(rvx, rvy, rvz, th); nx = u[0]; ny = u[1]; nz = u[2]; } // (3-D: turned by th about a random axis across it)
  L.vx = Vx + nx * A.m / (L.m + A.m); L.vy = Vy + ny * A.m / (L.m + A.m);
  A.vx = Vx - nx * L.m / (L.m + A.m); A.vy = Vy - ny * L.m / (L.m + A.m);
  if (W.d3) { L.vz = Vz + nz * A.m / (L.m + A.m); A.vz = Vz - nz * L.m / (L.m + A.m); }
  updateFast(L);
  emitLineFrom(A, ln);
}
function elasticScatter(L, A, Erel) {
  const M = L.m + A.m;
  const Vx = (L.m * L.vx + A.m * A.vx) / M, Vy = (L.m * L.vy + A.m * A.vy) / M;
  const rvx = L.vx - A.vx, rvy = L.vy - A.vy;
  if (W.d3) { // (3-D: isotropic, the relative speed kept)
    const Vz = (L.m * L.vz + A.m * A.vz) / M, rvz = L.vz - A.vz, v = Math.sqrt(rvx * rvx + rvy * rvy + rvz * rvz), u = rndDir();
    L.vx = Vx + v * u[0] * A.m / M; L.vy = Vy + v * u[1] * A.m / M; L.vz = Vz + v * u[2] * A.m / M;
    A.vx = Vx - v * u[0] * L.m / M; A.vy = Vy - v * u[1] * L.m / M; A.vz = Vz - v * u[2] * L.m / M;
    updateFast(L); return;
  }
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
  const grid = _nmd > 0, set = setOf(molecule(A)), sn = snapshot(set);
  const [dx, dy, dz] = minImg(L.x - A.x, L.y - A.y, L.z - A.z), r2 = dx * dx + dy * dy + dz * dz;
  const qa0 = A.q, lpe = !(L.fast || L.rad); // (a lepton in flight carries no potential energy in the books)
  const V0 = (lpe ? PHYS.KE * L.q * qa0 * (1 / Math.sqrt(r2 + A.sEN) - csh(A, L, A.sEN)) : 0) + (grid ? localPE(set, L) + (lpe ? L.q * phiE(L.x, L.y, A, L, L.z) : 0) : 0) + fieldU(L) + (grid ? 0 : fieldU(A)); // (the lepton's energy in the applied field goes with it: bug fix 6 after 1.25)
  const Vw = L.wm && !L.dead ? waveIonShare(L) : 0; // (electrons as waves: the packet's share with every ion and packet, which goes with it)
  let K0 = keOf(L);
  for (const p of set) K0 += 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
  const I0 = internalE(A);
  const px = L.m * L.vx + A.m * A.vx, py = L.m * L.vy + A.m * A.vy, pz = L.m * L.vz + A.m * A.vz;
  A.ne++; refresh(A); A.vx = px / A.m; A.vy = py / A.m; if (W.d3) A.vz = pz / A.m;
  enforceValence(A, null); closeSet(set);
  const V1 = grid ? localPE(set, L) : fieldU(A), I1 = internalE(A);
  let K1 = 0; for (const p of set) K1 += 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
  return { E: (K0 + V0 + Vw + I0) - (K1 + V1 + I1), sn };
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
    // A lepton held in the ion's well is bound as deeply as by the free atom's ion (softFor). In a molecule the capture
    // may have to change bonds (a π bond to the charged atom must go: C=F⁺ + e⁻ → C–F·), which the free atom's
    // binding does not pay for, so that a lepton at the bottom of the well could never be captured and stayed in it
    // for ever. Then the neighbourhood's motion pays what the bonds cost, up to 12 eV, or else, with a heat bath, the
    // bath does (booked as the bath's, as forceShed does); an insulated box stays exact (0.92, 0.93).
    const deep = Etot < 0 && Eph > -12;
    const nb = nearestThird(A, L, 6), nv = nb ? [nb.vx, nb.vy, nb.vz] : null, av = [A.vx, A.vy, A.vz];
    const got = nb && (Eph > -2 || deep) ? -kickPair(A, nb, Eph) : 0;
    if (got < -Eph - 1e-6) {
      if (nb) { nb.vx = nv[0]; nb.vy = nv[1]; nb.vz = nv[2]; A.vx = av[0]; A.vy = av[1]; A.vz = av[2]; }
      if (!(deep && W.gamma > 0)) { undoJoin(L, tr.sn, t0, d0); return; }
      W.ledger.bath += Eph;
    }
    Eph = 0;
  }
  L.wBooked = true; kill(L); // (wBooked: joinEnergy counted the packet's share with the ions)
  const ie = ionE(zChem(A), A.ne);
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
    : A.mu ? `Recombination: μ⁺ + e⁻ → muonium (${fmtE(ie)} binding, light emitted)` : `Recombination: p⁺ + e⁻ → H atom (${fmtE(ie)} binding, light emitted)`); // (muonium's nucleus is a μ⁺, 1.26)
  else log('em', `${A.anti ? 'Positron' : 'Electron'} captured: ${before} + ${A.anti ? 'e⁺' : 'e⁻'} → ${after}`);
}
function attach(L, A, Erel) {
  // forming an anion may break bonds (dissociative attachment); all of it is in the energy balance
  const t0 = W.topo, d0 = W.dirty, tr = joinEnergy(L, A), Eph = tr.E;
  if (!(Eph >= 0)) { undoJoin(L, tr.sn, t0, d0); return false; }
  L.wBooked = true; kill(L); // (wBooked: joinEnergy counted the packet's share with the ions)
  if (Eph > 0.05) emitPhoton(A.x, A.y, Eph, undefined, undefined, { src: A, depth: 2 });
  log('em', `${L.k === POS ? 'Positron' : 'Electron'} attachment: ${L.k === POS ? 'e⁺' : 'e⁻'} + ${A.anti ? barSym(A.el.sym) : A.el.sym} → ${speciesLabel(A)} (affinity ${fmtE(A.el.ea)})`);
  return true;
}
function impactIonize(L, A, ie, Erel) {
  if (freeElectronCount() >= MAX_FREE_E) return;
  const before = speciesLabel(A);
  const avail = Erel - ie, fk = 0.55 + 0.45 * rnd();
  const sv = [L.vx, L.vy, A.vx, A.vy, L.vz, A.vz];
  // remove ionization energy from the relative motion
  const f = Math.sqrt(Math.max(0, avail * fk) / Erel);
  const Vx = (L.m * L.vx + A.m * A.vx) / (L.m + A.m), Vy = (L.m * L.vy + A.m * A.vy) / (L.m + A.m), Vz = (L.m * L.vz + A.m * A.vz) / (L.m + A.m);
  const rvx = (L.vx - A.vx) * f, rvy = (L.vy - A.vy) * f, rvz = (L.vz - A.vz) * f;
  L.vx = Vx + rvx * A.m / (L.m + A.m); L.vy = Vy + rvy * A.m / (L.m + A.m);
  A.vx = Vx - rvx * L.m / (L.m + A.m); A.vy = Vy - rvy * L.m / (L.m + A.m);
  if (W.d3) { L.vz = Vz + rvz * A.m / (L.m + A.m); A.vz = Vz - rvz * L.m / (L.m + A.m); }
  if (!ejectElectron(A, avail * (1 - fk))) { L.vx = sv[0]; L.vy = sv[1]; A.vx = sv[2]; A.vy = sv[3]; L.vz = sv[4]; A.vz = sv[5]; return; }
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
function restE(p) { return bMu(p) * AMU_EV; }
/* A flying particle's speed (Å/tu) and rest mass (u): radiation-mode particles, and unstable ones in a collider's beam
   (W.exo, mass in MeV; 1.15). */
const bSpd = (p) => (p.xb ? p.v : p.sp);
const bMu = (p) => (p.xb ? p.m / PHYS.AMU_MEV : p.k === NUC ? (p.muB ? p.m - p.muB.m / AMU_EV : p.m) : PHYS.ME); // (a muonic atom's bound muon is in its mass (atomMass) but not in its rest energy here: that is booked apart, 1.26)
function keOf(p) { return p.rad ? p.KE : 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz); }
function inMD(p) { return !p.dead && !p.rad && !p.fast && !(p.k === NUC && p.Z === 0); }
/* Pair potential exactly as totalEnergy() counts it. */
function pairPE(a, b) {
  const [dx, dy, dz] = minImg(b.x - a.x, b.y - a.y, b.z - a.z), r2 = dx * dx + dy * dy + dz * dz;
  let V = 0;
  if (r2 < RC2) {
    if (a.k === NUC && b.k === NUC) { if (!(a.mol !== 0 && a.mol === b.mol && a.excl && a.excl.has(b.id)) && !(a.bom && b.bom) && !(MBO.on && mbEx(a, b))) V += nucPairV(a, b, r2); if (SITES.any) V += sitesPairE(a, b); } // (mbEx: many-body metals' partners; off-atom charge sites, 1.26)
    else if (a.k === NUC || b.k === NUC) {
      const A = a.k === NUC ? a : b, L = A === a ? b : a, qa = A.q;
      if (qa) V += PHYS.KE * L.q * qa * (1 / Math.sqrt(r2 + A.sEN) - csh(A, L, A.sEN));
    } else V += PHYS.KE * a.q * b.q * (1 / Math.sqrt(r2 + 0.04) - csh(a, b, 0.04));
  }
  if (_lrOn && (a.k !== NUC || Math.abs(a.q) >= 1) && (b.k !== NUC || Math.abs(b.q) >= 1)) {
    const r = hyp3(b.x - a.x, b.y - a.y, b.z - a.z);
    if (r >= RC) V += PHYS.KE * qx(a, b) * qx(b, a) / r;
  }
  return V;
}
function wallPE(p) {
  const r = wallIn(p), hw = W.box.w / 2 - r, hh = W.box.h / 2 - r, k = 30 * Math.min(1, p.m);
  let V = 0;
  if (p.x > hw) V += 0.5 * k * (p.x - hw) ** 2; else if (p.x < -hw) V += 0.5 * k * (-hw - p.x) ** 2;
  if (p.y > hh) V += 0.5 * k * (p.y - hh) ** 2; else if (p.y < -hh) V += 0.5 * k * (-hh - p.y) ** 2;
  if (W.d3) { const hd = W.box.d / 2 - r; if (p.z > hd) V += 0.5 * k * (p.z - hd) ** 2; else if (p.z < -hd) V += 0.5 * k * (-hd - p.z) ** 2; }
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
    E += restE(p) + keOf(p) + internalE(p) + fieldU(p); // (fieldU: the applied field, bug fix 6 after 1.25)
    for (const bd of p.bonds) if (!seenB.has(bd)) { seenB.add(bd); E += -bd.D - bd.Ef + morseV(bd, dist(bd.a, bd.b)); }
    if (!inMD(p)) continue;
    for (const o of md) if (o !== p && !(T.has(o) && o.id < p.id)) E += pairPE(p, o);
    if (p.bonds.length >= 2) E += angleEnergy(p);
    if (W.wall === 'reflect') E += wallPE(p);
    E += objPE(p);
  }
  if (MBO.on) E += mbLocal(T); // (metals' many-body energy, 1.25)
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
  const T = new Set(), ev = ++W.evSeq; _evTag = ev; // (hep.js: what this event makes is tagged with it, for the pair masses)
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
  if (W.d3) { shareKE3(ps, dE); return; } // (3-D: the depth too, 1.25)
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
/* (3-D, 1.25) shareKE with the depth: every velocity about the centre of mass scaled (no radiation flight in 3-D). */
function shareKE3(ps, dE) {
  let M = 0, Px = 0, Py = 0, Pz = 0;
  for (const q of ps) { M += q.m; Px += q.m * q.vx; Py += q.m * q.vy; Pz += q.m * q.vz; }
  const Vx = Px / M, Vy = Py / M, Vz = Pz / M;
  let K = 0;
  for (const q of ps) { const dx = q.vx - Vx, dy = q.vy - Vy, dz = q.vz - Vz; K += 0.5 * q.m * (dx * dx + dy * dy + dz * dz); }
  if (!(K > 0)) return;
  const sc = Math.sqrt(Math.max(0, K + dE) / K);
  for (const q of ps) { q.vx = Vx + sc * (q.vx - Vx); q.vy = Vy + sc * (q.vy - Vy); q.vz = Vz + sc * (q.vz - Vz); updateFast(q); }
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
  const x = Pp.x, y = Pp.y, z = Pp.z, who = speciesLabel(A);
  const S = annihBegin([Pp, A]);
  kill(Pp); A.ne--; refresh(A); enforceValence(A, null); relink([A]);
  twoGamma(x, y, annihEnd(S), z); // (z: 3-D, 1.24)
  W.count.annih++;
  nucEvent('annih', x, y, `${Pp.k === POS ? 'e⁺' : 'e⁻'} + ${who} → ${speciesLabel(A)} + 2γ`, [ghostOf(Pp)], '511 keV each', undefined, z || 0); // (z: its caption at its depth, 1.26 sweep)
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
    twoGamma(x, y, annihEnd(S), 0.5 * (a.z + b.z)); W.count.annih++; // (z: 3-D, 1.24)
    nucEvent('annih', x, y, `${la} touches ${lb}: e⁻ + e⁺ → 2γ`, [], '511 keV each', undefined, 0.5 * ((a.z || 0) + (b.z || 0))); // (at its depth, 1.26 sweep)
    log('nuc', `Annihilation: ${la} touches ${lb}; an electron and a positron → 2γ (511 keV each)`);
    return;
  }
  nuclearAnnihilation(a, b);
}
/* A nucleon and an antinucleon annihilate (≈1.88 GeV): a spray of mesons, about five pions (hep.js: charged ones
   fly out of the chamber, neutral ones decay at once into γ rays), now and then kaons. The antiprotonic atom's
   cascade shakes out a few electrons first, and a struck nucleus is left hot and boils off a few nucleons. */
function nuclearAnnihilation(a, b) {
  if (a.dead || b.dead || a.mu || b.mu) return; // (an antinucleon meets no nucleon in muonium, 1.12)
  const anti = a.anti ? a : b, mat = anti === a ? b : a;
  const [avx, avy] = velOf(a), [bvx, bvy] = velOf(b);
  const vx = (a.m * avx + b.m * bvx) / (a.m + b.m), vy = (a.m * avy + b.m * bvy) / (a.m + b.m);
  const x = 0.5 * (a.x + b.x), y = 0.5 * (a.y + b.y);
  const before = `${speciesLabel(anti)} + ${speciesLabel(mat)}`;
  const parents = [anti, mat].map(ghostOf);
  const S = annihBegin([a, b]);
  // (the realistic-particle switch, 1.27: a slow bare antiproton is caught into an orbit of the atom first, n₀ ≈ 30–43, and
  // cascades down, its Auger electrons and X-ray lines given off, to the orbit where it annihilates (hep.js XA_NABS:
  // protonium from 2p); the lines' energy comes out of the annihilation's)
  let xa = null; const Zm = mat.Z, Nm = mat.N;
  if (RP.exo && anti.Z === 1 && anti.N === 0 && anti.ne === 0 && Zm >= 1 && !mat.muB) {
    const mr = anti.m * mat.m / (anti.m + mat.m), dvx = avx - bvx, dvy = avy - bvy;
    if (0.5 * mr * (dvx * dvx + dvy * dvy) < MU_STOP) { const es = []; xa = xaCascade(mat, 'pbar', Zm, Nm, xaN0('pbar', Zm, Nm), XA_NABS.pbar(Zm), 0, es); xa.n0 = xaN0('pbar', Zm, Nm); xa.n1 = XA_NABS.pbar(Zm); }
  }
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
      const k = Math.max(0, n.ne - n.Z) + (n.ne > 0 && !xa ? 1 + Math.floor(rnd() * 2) : 0); // (with the cascade worked out, 1.27: only those the smaller nucleus can't hold)
      for (let i = 0; i < k && n.ne > 0; i++) if (!ejectElectron(n, 20 + 80 * rnd(), undefined, undefined, 0)) break;
      stabilize(n);
    }
  }
  relink(partners.filter(p => !p.dead));
  let E = annihEnd(S);
  if (xa) { for (const l of xa.lines) { if (!(l.E > 0) || !(l.E < E)) continue; E -= l.E; const u = rdir(); emitPhoton(x, y, l.E, u[0], u[1]); } } // (its X-ray lines, exact; the mesons take the rest, 1.27)
  const ms = mesonBurst(x, y, E, vx, vy, (pM ? 1 : 0) - (pA ? 1 : 0));
  W.count.annih++;
  const left = [anti, mat].filter(n => !n.dead).map(n => speciesLabel(n)), what = ms.length ? summarize(ms) : 'γ rays';
  if (xa) { const pp = Zm === 1 && Nm === 0; W.count.xatom = (W.count.xatom || 0) + 1; log('nuc', `${pp ? 'Protonium (p̄p)' : `Antiprotonic ${ELEMENTS[Zm].name.toLowerCase()}`}: p̄ caught into orbit n = ${xa.n0}, cascade to n = ${xa.n1}: X-rays ${xaLines(xa.lines) || 'none'}${xa.aug ? `, ${xa.aug} Auger electron${xa.aug > 1 ? 's' : ''}` : ''}; then it annihilates`); }
  nucEvent('annih', x, y, `${xa && Zm === 1 && Nm === 0 ? 'Protonium: ' : ''}${before} → ${left.length ? left.join(' + ') + ' + ' : ''}${what}`, parents, xa ? `${fmtE(E)}; first the cascade n = ${xa.n0} → ${xa.n1}, X-rays ${xaLines(xa.lines, 2) || 'none'}` : fmtE(E));
  log('nuc', `Antimatter annihilation: ${before} → ${what} (${fmtE(E)})${evap ? `, ${evap} nucleon${evap > 1 ? 's' : ''} knocked out` : ''}`);
  tally(ms, [], `Annihilation: ${before} → ${what}`);
}
function evAnnihFree(a, b) {
  if (a.dead || b.dead) return;
  const x = 0.5 * (a.x + b.x), y = 0.5 * (a.y + b.y);
  const S = annihBegin([a, b]);
  const gh = [a, b].map(ghostOf);
  kill(a); kill(b);
  twoGamma(x, y, annihEnd(S), 0.5 * (a.z + b.z));
  W.count.annih++;
  nucEvent('annih', x, y, 'e⁺ + e⁻ → 2γ', gh, '511 keV each', undefined, 0.5 * ((a.z || 0) + (b.z || 0))); // (at its depth, 1.26 sweep)
  log('nuc', 'Annihilation: e⁺ + e⁻ → 2γ (511 keV each)');
}
/* Two back-to-back γ rays sharing E (two electron masses plus whatever kinetic and binding energy). */
function twoGamma(x, y, E = 2 * ME_C2, z = 0) {
  if (W.d3) { const u = rndDir(), ux = u[0], uy = u[1], uz = u[2]; emitPhoton(x, y, E / 2, ux, uy, { z, uz }); emitPhoton(x, y, E / 2, -ux, -uy, { z, uz: -uz }); flash(x, y, [255, 255, 255], 3, 0.4, z); return; } // (3-D: back to back in any direction, at its depth, 1.24)
  const th = rnd() * 2 * Math.PI, ux = Math.cos(th), uy = Math.sin(th);
  emitPhoton(x, y, E / 2, ux, uy); emitPhoton(x, y, E / 2, -ux, -uy);
  flash(x, y, [255, 255, 255], 3, 0.4);
}

/* Bare proton meets a lone pair: dative bond (H⁺ + H₂O → H₃O⁺, H⁺ + NH₃ → NH₄⁺, H⁺ + Cl⁻ → HCl). */
function evDative(H, D, r) {
  if (H.dead || D.dead || H.bom || D.bom || opp(H, D) || H.ne !== 0 || H.Z !== 1 || D.ne === 0 || D.lp < 1 || hardMeet(H, D)) return;
  const capAfter = (() => {
    const vi = valenceInfo(D.Z, D.ne - 1); if (D.el.dblock) return 0;
    if (vi.n === 1) return vi.v === 1 ? 1 : 0;
    return vi.v >= 8 ? 0 : vi.v <= 4 ? vi.v : 8 - vi.v;
  })();
  if (capAfter < D.used + 1) return;
  const before = hill(molecule(D));
  const PA = PROTON_AFFINITY[D.el.sym + ':' + D.q] ?? 6.0;
  const set = setOf(molecule(D), [H]);
  const saved = [...set].map(p => [p, p.x, p.y, p.vx, p.vy, p.z, p.vz]);
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
      for (const [p, x, y, vx, vy, z, vz] of saved) { p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.z = z; p.vz = vz; }
      return;
    }
  } else dumpHeat(heat, H, D);
  W.count.react++;
  const mol = molecule(D), nm = moleculeName(mol);
  log('chem', `${H.mu ? 'Muon bonded: Mu⁺' : 'Proton bonded: H⁺'} + ${before} → ${hill(mol)}${nm ? ' (' + nm + ')' : ''}`); // (a bare μ⁺ (muonium's nucleus) is not a proton, 1.26)
}

/* Electron transfer between a donor and an acceptor when it lowers the total energy (Born–Haber). */
/* (bug fix 2 after 1.25) How many particles carry a charge (net or partial), counted once per change of the world: in
   a neutral metal none does, and localPhi's walk over every atom within 6 Å (hundreds in a dense 3-D metal, four walks
   for each pair of atoms tried for an electron transfer) adds nothing. */
const _chg = { key: '', n: 0 };
function chargedCount() {
  const key = W.step + ':' + W.dirty + ':' + W.topo + ':' + W.spawned + ':' + W.deaths + ':' + W.parts.length;
  if (_chg.key !== key) { let n = 0; for (const p of W.parts) if (!p.dead && (p.k === NUC ? p.q + p.qp : p.q) !== 0) n++; _chg.key = key; _chg.n = n; }
  return _chg.n;
}
function localPhi(x, y, skipA, skipB, z = 0) {
  const chg = (p) => (p && !p.dead && (p.k === NUC ? p.q + p.qp : p.q) !== 0 ? 1 : 0);
  if (chargedCount() - chg(skipA) - chg(skipB) <= 0) return 0; // (nothing charged but the pair itself: the walk would add nothing)
  let phi = 0;
  nearby(x, y, RC, (p, dx, dy, r2) => {
    if (p === skipA || p === skipB) return;
    const q = p.k === NUC ? p.q + p.qp : p.q;
    if (q !== 0) phi += PHYS.KE * q / Math.sqrt(r2 + 0.09);
  }, z);
  return phi;
}
function breakCostIfCharged(p, dne) {
  // cost of bonds that would have to break if p gained (dne=+1) or lost (dne=-1) an electron
  if (!p.bonds.length || p.ne + dne < 0) return 0;
  if (p.ne + dne === 0) return p.bonds.reduce((s, bd) => s + bd.D, 0);
  const vi = valenceInfo(p.Z, p.ne + dne);
  let cap;
  if (p.el.dblock) cap = Math.max(0, p.el.ox - Math.max(0, zChem(p) - p.ne - dne));
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
/* (1.26) No ion pair made inside a metal: two metal atoms within their metallic reach, one of them with another metal
   atom in its first shell (1.3·r_m; a close-packed crystal's second shell is at 1.41·r_m, the flat sheet's at 1.73),
   share the conduction electrons, which screen a Cu⁺Cu⁻ pair (an atom touching a metal is part of it). Without it a
   flat Cu or Ni lump turned nearly every atom into an ion (in 3-D Cu, Ag, Au and Ni). Charges already there still
   move or cancel, a metal still gives electrons to O, Cl…, and lone metal atoms (a vapour) trade them as before. */
function ionPairInMetal(d, a, r) {
  return d.el.metal && a.el.metal && d.q >= 0 && a.q <= 0 && r < 1.05 * (d.mR + a.mR) && (inMetal(d, a) || inMetal(a, d)); // (el.metal: a surface atom bonded to an O is still a metal atom)
}
function inMetal(p, but) {
  if (!MR_MAX) for (const el of ELEMENTS) if (el && el.metal) MR_MAX = Math.max(MR_MAX, 2 * el.rc * 1.12);
  let hit = false;
  nearby(p.x, p.y, 0.65 * (p.mR + MR_MAX), (q, dx, dy, r2) => {
    if (q === p || q === but || !q.isMetal || q.k !== NUC || q.ne === 0 || q.fast || q.rad) return;
    const c = 0.65 * (p.mR + q.mR);
    if (r2 < c * c) { hit = true; return false; }
  }, p.z);
  return hit;
}
function transferDE(d, a, r) { // donor d gives one electron to acceptor a
  if (d.ne <= 0 || bondBetween(d, a)) return Infinity;
  if (a.k !== NUC || d.k !== NUC) return Infinity;
  if (d.q + 1 > maxCation(d)) return Infinity;
  const ieD = ionE(zChem(d), d.ne);
  let R;
  if (a.ne + 1 <= zChem(a)) R = ionE(zChem(a), a.ne + 1);
  else if (a.ne + 1 === a.Z + 1) { if (!(a.el.ea >= 0.7)) return Infinity; R = a.el.ea; } // stable anions only
  else if (a.ne + 1 <= zChem(a) + maxExtraElectrons(zChem(a))) R = ionE(zChem(a), a.ne + 1);
  else return Infinity;
  const phiD = localPhi(d.x, d.y, d, a, d.z), phiA = localPhi(a.x, a.y, d, a, a.z);
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
  const mu = d.m * acc.m / (d.m + acc.m), dvx = d.vx - acc.vx, dvy = d.vy - acc.vy, dvz = d.vz - acc.vz;
  const Ek = 0.5 * mu * (dvx * dvx + dvy * dvy + dvz * dvz);
  if (MBO.on && dE <= Ek + 0.5) dE += mbXferLB(d, acc); // (many-body metals, 1.25: an atom made an ion leaves the metal; at least its own share of it is lost)
  if (dE > Ek + 0.5 || rnd() > 0.3) return; // the cheap estimate says it can't be afforded
  if (ionPairInMetal(d, acc, r)) { // (1.26: not inside a metal; the other way round, when it is open, lowers or keeps the charges)
    let e = d === a ? e2 : e1;
    if (MBO.on && e <= Ek + 0.5) e += mbXferLB(acc, d);
    if ((d.q === 0 && acc.q === 0) || !(e <= Ek + 0.5)) return;
    const t = d; d = acc; acc = t; dE = e;
  }
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
  const dvx = b.vx - a.vx, dvy = b.vy - a.vy, dvz = b.vz - a.vz;
  const Ecm = 0.5 * mu * (dvx * dvx + dvy * dvy + dvz * dvz);
  // collision energy that is really available: not the extra speed two ions gained falling together
  const E = Math.min(Ecm, Ecm + (a.ne > 0 && b.ne > 0 ? pairNonbondedV(a, b, r) : 0));
  // excitation
  for (const p of [a, b]) {
    const L = lineInfo(p);
    if (L && E > L.thr && rnd() < 0.03 * Math.exp(-L.thr / 2.5)) {
      const ln = pickLine(p, E);
      if (ln) { // (paid from their motion along the line of centres: when that cannot give all of it, no light, 0.67)
        const sv = [a.vx, a.vy, b.vx, b.vy, a.vz, b.vz];
        if (Math.abs(kickPair(a, b, -ln.thr) + ln.thr) > 1e-6) { a.vx = sv[0]; a.vy = sv[1]; b.vx = sv[2]; b.vy = sv[3]; a.vz = sv[4]; b.vz = sv[5]; updateFast(a); updateFast(b); return; }
        emitLineFrom(p, ln); return;
      }
    }
  }
  // ionization of the more weakly bound partner
  let t = null, ie = Infinity;
  for (const p of [a, b]) if (p.ne > 0) { const e = ionizationCost(p); if (e < ie) { ie = e; t = p; } }
  if (t && E > ie && rnd() < 0.3 * (1 - ie / E) && freeElectronCount() < MAX_FREE_E) {
    const KEe = 0.25 * (E - ie);
    const before = speciesLabel(t);
    const sa = [a.vx, a.vy, b.vx, b.vy, a.vz, b.vz];
    if (Math.abs(kickPair(a, b, -(ie + KEe)) + ie + KEe) > 1e-6 || !ejectElectron(t, KEe)) { a.vx = sa[0]; a.vy = sa[1]; b.vx = sa[2]; b.vy = sa[3]; a.vz = sa[4]; b.vz = sa[5]; updateFast(a); updateFast(b); return; } // (all of it, or none)
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
  // the true cross section (barns), for the ultra-realistic mode: D–T measured, the rest σ = S/E·e^(−√(E_G/E)) with
  // S scaled from D–T's 25 MeV·b (FUSION_S is relative to it)
  const sig = key === '1_1+1_2' ? sigmaDT(EkeV) / 1000 : S * 25000 / EkeV * Math.exp(-Math.sqrt(EG / EkeV));
  return { P: Math.min(0.9, P), ch, sig };
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
function launchProducts(prods, Eav, Vx, Vy, x, y, neTotal, Min, z, Vz) {
  if (W.d3) return launchProducts3(prods, Eav, Vx, Vy, Vz || 0, x, y, z || 0, neTotal, Min); // (3-D, 1.25)
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
/* (3-D, 1.25) launchProducts in depth: placed round (x, y, z) on the sphere, two bodies back to back in a random
   direction, three with random momenta on the sphere summing to zero. */
function launchProducts3(prods, Eav, Vx, Vy, Vz, x, y, z, neTotal, Min) {
  const ps = [];
  let neLeft = neTotal;
  const order = prods.map((p, i) => i).sort((i, j) => prods[j][0] - prods[i][0]);
  const ne = new Array(prods.length).fill(0);
  for (const i of order) { const take = Math.min(neLeft, prods[i][0]); ne[i] = take; neLeft -= take; }
  for (let i = 0; i < prods.length; i++) { const d = rndDir(), [Z, N] = prods[i]; ps.push(addNuc(Z, N, Z === 0 ? 0 : ne[i], x + 0.15 * d[0], y + 0.15 * d[1], 0, 0, false, z + 0.15 * d[2])); }
  if (Min) { const Mp = ps.reduce((m, q) => m + q.m, 0); Vx *= Min / Mp; Vy *= Min / Mp; Vz *= Min / Mp; }
  const set = (q, vx, vy, vz) => { q.vx = vx; q.vy = vy; q.vz = vz; updateFast(q); };
  if (ps.length === 2) {
    const [p1, p2] = ps, mu = p1.m * p2.m / (p1.m + p2.m), pr = Math.sqrt(2 * mu * Eav), d = rndDir(), ux = d[0], uy = d[1], uz = d[2];
    const v1 = pr / p1.m, v2 = pr / p2.m;
    set(p1, Vx + v1 * ux, Vy + v1 * uy, Vz + v1 * uz); set(p2, Vx - v2 * ux, Vy - v2 * uy, Vz - v2 * uz);
  } else {
    const px = [], py = [], pz = []; let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < ps.length; i++) { const d = rndDir(); px[i] = d[0]; py[i] = d[1]; pz[i] = d[2]; sx += px[i]; sy += py[i]; sz += pz[i]; }
    for (let i = 0; i < ps.length; i++) { px[i] -= sx / ps.length; py[i] -= sy / ps.length; pz[i] -= sz / ps.length; }
    let K = 0; for (let i = 0; i < ps.length; i++) K += 0.5 * (px[i] * px[i] + py[i] * py[i] + pz[i] * pz[i]) / ps[i].m;
    const s = Math.sqrt(Eav / Math.max(K, 1e-12));
    for (let i = 0; i < ps.length; i++) set(ps[i], Vx + s * px[i] / ps[i].m, Vy + s * py[i] / ps[i].m, Vz + s * pz[i] / ps[i].m);
  }
  for (let i = 0; i < neLeft; i++) { const [dx, dy, dz] = rndDir(), e = addLepton(ELEC, x, y, 0, 0, z); setMotion(e, 1, dx, dy, Vx, Vy, dz, Vz); }
  return ps;
}
/* Set lab velocity; switches to radiation (ballistic) mode when energetic. */
function setVel(p, vx, vy) {
  const v = Math.hypot(vx, vy);
  const KE = 0.5 * p.m * v * v;
  const neutron = p.k === NUC && p.Z === 0;
  if (KE > (neutron ? NEUTRON_RAD : radThreshold(p.k !== NUC))) {
    // (a stepped atom sent into flight leaves the stepped set: its bonds break and its potential energy with what stays
    // is paid from its motion, as switchMode does for flight below this; kept, a bond to an atom in flight stretched
    // with no force on it: a neutron's elastic hit sent a Pb bonded to C off at 83 keV, the books +108 eV, 1.26)
    const md = _nmd > 0 && p.k === NUC && p.Z > 0 && inMD(p), set = md ? closeSet(setOf([p])) : null, U0 = md ? localPE(set) : 0;
    p.rad = true; p.fast = true; p.KE = KE; p.ux = vx / v; p.uy = vy / v; radSpeed(p);
    if (md) { for (const bd of p.bonds.slice()) removeBond(bd); p.KE = Math.max(1e-6, KE - (localPE(closeSet(set)) - U0)); radSpeed(p); }
    p.vx = p.sp * p.ux; p.vy = p.sp * p.uy; if (!p.trk) startTrack(p);
  } else {
    p.rad = false; p.vx = vx; p.vy = vy; updateFast(p);
    if (neutron && KE > 1 && !p.trk) startTrack(p);
    else if (KE > 2000 && !p.trk) startTrack(p);
  }
}
function velOf(p) { return p.rad ? [p.sp * p.ux, p.sp * p.uy] : [p.vx, p.vy]; }

/* bd: how close the pass came (Å). In the ultra-realistic mode a pass fuses when it comes inside the true cross
   section, √(σ/π) (about 10⁻⁵–10⁻⁴ Å), and not otherwise; normally a pass inside R_FUS fuses with the chance gamowP. */
const fusGate = () => W.ultra ? 2e-3 : R_FUS;
function tryFusion(a, b, bd) {
  if (a.dead || b.dead) return false;
  if (W.d3) return tryFusion3(a, b, bd); // (3-D, 1.25)
  if (opp(a, b)) { nuclearAnnihilation(a, b); return true; }
  if (a.anti || b.anti || a.Z < 1 || b.Z < 1 || a.Z + b.Z > Z_MAX || a.mu || b.mu) return false; // (a muon is no nucleon: nothing to fuse, 1.12)
  const [avx, avy] = velOf(a), [bvx, bvy] = velOf(b);
  const mu = a.m * b.m / (a.m + b.m);
  const dvx = avx - bvx, dvy = avy - bvy;
  const Ecm = 0.5 * mu * (dvx * dvx + dvy * dvy);
  if (Ecm < 50) return false;
  const g = gamowP(a, b, Ecm);
  if (W.ultra ? !(bd < 1e-4 * Math.sqrt(g.sig / Math.PI)) : !(rnd() < g.P)) return false; // (1 b = 10⁻⁸ Å²)
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
    if (weak) emitNeutrino(x, y, Math.max(0, left), undefined, undefined, false, `fusion, ${lbl}`);
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
/* (3-D, 1.25) tryFusion in depth: the pair's energy from their velocities in three directions, the products at the
   midpoint's depth (launchProducts3; a single product with the pair's momentum, its γ ray or e⁺ on the sphere).
   Antimatter is not in 3-D. */
function tryFusion3(a, b, bd) {
  if (a.anti || b.anti || a.Z < 1 || b.Z < 1 || a.Z + b.Z > Z_MAX || a.mu || b.mu) return false;
  const mu = a.m * b.m / (a.m + b.m), dvx = a.vx - b.vx, dvy = a.vy - b.vy, dvz = a.vz - b.vz;
  const Ecm = 0.5 * mu * (dvx * dvx + dvy * dvy + dvz * dvz);
  if (Ecm < 50) return false;
  const g = gamowP(a, b, Ecm);
  if (W.ultra ? !(bd < 1e-4 * Math.sqrt(g.sig / Math.PI)) : !(rnd() < g.P)) return false;
  const M = a.m + b.m, Vx = (a.m * a.vx + b.m * b.vx) / M, Vy = (a.m * a.vy + b.m * b.vy) / M, Vz = (a.m * a.vz + b.m * b.vz) / M;
  const x = 0.5 * (a.x + b.x), y = 0.5 * (a.y + b.y), z = 0.5 * (a.z + b.z), ne = a.ne + b.ne;
  const lbl = `${nucSym(a.Z, a.N)} + ${nucSym(b.Z, b.N)}`, key = fusionKey(a, b);
  let prods, Q, gammaE = 0, weak = false;
  if (key === '1_0+1_0') { prods = [[1, 1]]; Q = 0.420; weak = true; }
  else if (g.ch.length) {
    const ws = g.ch.map(c => Math.sqrt(c.Q)); const tot = ws.reduce((s, w) => s + w, 0);
    let u = rnd() * tot, c = g.ch[0];
    for (let i = 0; i < ws.length; i++) { u -= ws[i]; if (u <= 0) { c = g.ch[i]; break; } }
    prods = c.prods; Q = c.Q;
  } else {
    const Zc = a.Z + b.Z, Nc = a.N + b.N, comp = nuclideInfo(Zc, Nc);
    Q = dB([[Zc, Nc]], [[a.Z, a.N], [b.Z, b.N]]);
    if (Q * 1e6 + Ecm <= 0 || (comp.unbound && comp.t12 < 1e-19)) return false;
    prods = [[Zc, Nc]]; gammaE = Q * 1e6 + Ecm;
  }
  const gh = [ghostOf(a), ghostOf(b)];
  const S = nucBegin([a, b]);
  kill(a); kill(b);
  W.count.fusion++;
  if (prods.length === 1) {
    const Z1 = prods[0][0], N1 = prods[0][1], q = addNuc(Z1, N1, Z1 === 0 ? 0 : Math.min(ne, Z1), x, y, 0, 0, false, z);
    q.vx = Vx * M / q.m; q.vy = Vy * M / q.m; q.vz = Vz * M / q.m; updateFast(q); // (momentum kept)
    for (let i = q.ne; i < ne; i++) { const [dx, dy, dz] = rndDir(), e = addLepton(ELEC, x, y, 0, 0, z); setMotion(e, 1, dx, dy, Vx, Vy, dz, Vz); }
    let pos = null, d = null;
    if (weak) { const r = rndDir(); d = [r[0], r[1], r[2]]; pos = addLepton(POS, x, y, 0, 0, z); setMotion(pos, (Q * 1e6 + Ecm) * 0.6, d[0], d[1], Vx, Vy, d[2], Vz); }
    const Qm = nucMassLoss(S);
    W.ledger.nuc += Qm;
    let left = nucLeft(S, Qm);
    if (left < 0 && pos) { setMotion(pos, Math.max(1, keOf(pos) + left), d[0], d[1], Vx, Vy, d[2], Vz); left = nucLeft(S, Qm); }
    if (weak) emitNeutrino(x, y, Math.max(0, left), undefined, undefined, false, `fusion, ${lbl}`, 'e', z);
    else if (gammaE > 0) emitPhoton(x, y, Math.max(0, left), undefined, undefined, { z });
  } else {
    const ps = launchProducts3(prods, Q * 1e6 + Ecm, Vx, Vy, Vz, x, y, z, ne, M);
    const Qm = nucMassLoss(S);
    W.ledger.nuc += Qm;
    settleKE(S, Qm, ps);
  }
  flash(x, y, [255, 240, 200], 5, 0.6, z);
  const out = prods.map(([zz, n]) => nucSym(zz, n)).join(' + ') + (weak ? ' + e⁺ + ν' : gammaE ? ' + γ' : '');
  log('nuc', `Fusion: ${lbl} → ${out}  (+${fmtE(Q * 1e6)})`);
  nucEvent('fusion', x, y, `Fusion: ${lbl} → ${out}`, gh, `${fmtE(Q * 1e6)} released`, undefined, z);
  noteMade(prods.map(([zz, n]) => ({ Z: zz, N: n, anti: false })), [], `Fusion: ${lbl} → ${out}`);
  return true;
}

/* Neutron meets a nucleus: capture, fission, (n,p)/(n,α)/(n,t) or elastic scattering. */
function neutronHit(n, T, b, R) {
  if (n.dead || T.dead || T.mu || (T.Z < 1 && !(T.N === 1 && T.k === NUC))) return false; // (a nucleus, or another free neutron: n–n is elastic below ~20 MeV, the dineutron being unbound)
  if (opp(T, n)) { nuclearAnnihilation(T, n); return true; }
  if (W.d3) return neutronHit3(n, T, b, R); // (3-D, 1.25)
  if (n.rad || T.rad) { // fast (either of them): relativistic kinematics. Spallation, fission, … or diffraction; two nucleons below ~20 MeV scatter isotropically (s-wave)
    if (nuclearEncounter(n, T, R > 0 ? clamp((b || 0) / R, 0, 1) : rnd(), T.x, T.y)) return true;
    if (!n.dead && !T.dead && T.Z + T.N === 1 && mass4(add4(p4of(n, true), p4of(T, true))) - nucMeV(n.Z, n.N) - nucMeV(T.Z, T.N) < 20) { elasticTurn(n, T, (2 * rnd() - 1) * Math.PI); return true; } // (below ~20 MeV, where the tables have no nucleon–nucleon elastic)
    return false;
  }
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
    n.kEnd = 'cap'; kill(n);
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
    chainEdge(T.Z, T.N - 1, T.Z, T.N, 'ncap', T.anti);
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
    n.kEnd = 'cap'; kill(n); kill(T);
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
  if (keOf(T) > 10) T.nucProd = true; // (sent flying by a nuclear collision: slow motion for nuclear events, when off, does not follow it)
  if (0.5 * PHYS.MN * (n.vx * n.vx + n.vy * n.vy) < 1 && n.trk) n.trk = null;
  return true;
}

/* (3-D, 1.25) neutronHit in depth. Nothing flies in radiation mode in 3-D, so a pass with more than NEUTRON_RAD (20 MeV)
   between them takes the fast branch's relativistic reactions (nuclearEncounter, hep.js, with four-momenta in three
   directions); below it the flat game's table of captures, (n,p), (n,α), (n,t), fission and elastic scattering, with
   the recoil, the γ ray and the products in three directions. */
function neutronHit3(n, T, b, R) {
  const dvx = n.vx - T.vx, dvy = n.vy - T.vy, dvz = n.vz - T.vz;
  const En = 0.5 * PHYS.MN * (dvx * dvx + dvy * dvy + dvz * dvz);
  if (En > NEUTRON_RAD) {
    if (nuclearEncounter(n, T, R > 0 ? clamp((b || 0) / R, 0, 1) : rnd(), T.x, T.y, T.z)) return true;
    if (!n.dead && !T.dead && T.Z + T.N === 1 && mass4(add4(p4of(n, true), p4of(T, true))) - nucMeV(n.Z, n.N) - nucMeV(T.Z, T.N) < 20) { elasticTurn(n, T, (2 * rnd() - 1) * Math.PI); return true; }
    return false;
  }
  const X = NEUTRON_X[T.Z + '_' + T.N];
  const f = clamp((Math.log10(Math.max(En, 1e-3)) - Math.log10(0.5)) / (5 - Math.log10(0.5)), 0, 1);
  const lerp = (arr) => arr ? arr[0] + (arr[1] - arr[0]) * f : 0;
  let pf = 0, pc, pnp = 0, pna = 0, pnt = 0;
  if (X) { pf = X.fis ? (X.fisThr && En < X.fisThr ? 0 : lerp(X.fis)) : 0; pc = lerp(X.cap); pnp = lerp(X.np); pna = lerp(X.na); pnt = lerp(X.nt); }
  else { const prod = nuclideInfo(T.Z, T.N + 1); pc = prod.unbound ? 0 : 0.08 + (0.004 - 0.08) * f; }
  const u = rnd();
  const M = T.m + n.m, Vx = (T.m * T.vx + n.m * n.vx) / M, Vy = (T.m * T.vy + n.m * n.vy) / M, Vz = (T.m * T.vz + n.m * n.vz) / M;
  const x = T.x, y = T.y, z = T.z;
  if (u < pf) { fission(T, n, En); return true; }
  if (u < pf + pc) {
    const Sn = dB([[T.Z, T.N + 1]], [[T.Z, T.N]]);
    const lbl = nucSym(T.Z, T.N), gh = [ghostOf(n), ghostOf(T)];
    const S = nucBegin([n, T]);
    n.kEnd = 'cap'; kill(n);
    T.N++; refresh(T);
    T.vx = Vx * M / T.m; T.vy = Vy * M / T.m; T.vz = Vz * M / T.m;
    const E0 = Math.max(0, Sn) * 1e6 + En, pr = (E0 - E0 * E0 / (2 * T.m * PHYS.AMU_MEV * 1e6)) / 1e6 * PHYS.MEV_C_TO_SIM, g = rndDir(), gx = g[0], gy = g[1], gz = g[2];
    T.vx -= pr / T.m * gx; T.vy -= pr / T.m * gy; T.vz -= pr / T.m * gz;
    if (0.5 * T.m * (pr / T.m) ** 2 > 20) for (const bd of T.bonds.slice()) removeBond(bd);
    updateFast(T);
    const Qm = nucMassLoss(S);
    const Eg = Math.max(0, nucLeft(S, Qm));
    emitPhoton(x, y, Eg, gx, gy, { src: T, z, uz: gz });
    W.count.ncap++; W.ledger.nuc += Qm;
    flash(x, y, [200, 220, 255], 3, 0.4, z);
    log('nuc', `Neutron capture: ${lbl} + n → ${nucSym(T.Z, T.N)} + γ (${fmtE(Eg)})`);
    nucEvent('capture', x, y, `Neutron capture: ${lbl} + n → ${nucSym(T.Z, T.N)} + γ`, gh, `${fmtE(Eg)} γ ray`, undefined, z);
    chainEdge(T.Z, T.N - 1, T.Z, T.N, 'ncap', T.anti);
    noteMade([{ Z: T.Z, N: T.N, anti: !!T.anti }], [], `Neutron capture: ${lbl} + n → ${nucSym(T.Z, T.N)} + γ`);
    return true;
  }
  const special = u < pf + pc + pnp ? [[T.Z - 1, T.N + 1], [1, 0]] : u < pf + pc + pnp + pna ? [[T.Z - 2, T.N - 1], [2, 2]] :
    u < pf + pc + pnp + pna + pnt ? [[T.Z - 1, T.N - 1], [1, 2]] : null;
  if (special) {
    const Q = dB(special, [[T.Z, T.N], [0, 1]]);
    if (Q * 1e6 + En <= 0) return false;
    const lbl = nucSym(T.Z, T.N), ne = T.ne, gh = [ghostOf(n), ghostOf(T)];
    const S = nucBegin([n, T]);
    n.kEnd = 'cap'; kill(n); kill(T);
    W.count.ncap++;
    const ps = launchProducts(special, Math.max(0, Q * 1e6 + En), Vx, Vy, x, y, ne, M, z, Vz);
    const Qm = nucMassLoss(S);
    W.ledger.nuc += Qm;
    settleKE(S, Qm, ps);
    flash(x, y, [255, 230, 180], 4, 0.5, z);
    log('nuc', `Nuclear reaction: ${lbl} + n → ${special.map(([zz, nn]) => nucSym(zz, nn)).join(' + ')} (+${fmtE(Q * 1e6)})`);
    nucEvent('reaction', x, y, `${lbl} + n → ${special.map(([zz, nn]) => nucSym(zz, nn)).join(' + ')}`, gh, `${fmtE(Q * 1e6)} released`, undefined, z);
    noteMade(special.map(([zz, nn]) => ({ Z: zz, N: nn, anti: !!T.anti })), [], `${lbl} + n → ${special.map(([zz, nn]) => nucSym(zz, nn)).join(' + ')}`);
    return true;
  }
  // elastic scattering, isotropic in the centre-of-mass frame (on the sphere)
  const vr = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz), d = rndDir(), nx = vr * d[0], ny = vr * d[1], nz = vr * d[2];
  n.vx = Vx + nx * T.m / M; n.vy = Vy + ny * T.m / M; n.vz = Vz + nz * T.m / M; updateFast(n);
  T.vx = Vx - nx * n.m / M; T.vy = Vy - ny * n.m / M; T.vz = Vz - nz * n.m / M; updateFast(T);
  if (keOf(T) > 10) T.nucProd = true;
  if (keOf(n) < 1 && n.trk) n.trk = null;
  return true;
}
/* The chain-reaction readout (Data tab): each free neutron's end — absorbed in a fission (giving ν new ones), captured
   without one, escaped through open walls, or anything else (decay, other reactions) — and its generation. k, the
   neutrons born per neutron ended over the last KC_N ends, is the effective multiplication factor. Bookkeeping only. */
const KC_N = 300;
/* Chain-reaction maps (1.11, Data tab; bookkeeping only, no randomness): W.chain.fis holds every fission (the first
   CH_MAX) with the fission its neutron came from (par, −1 for a neutron placed, fired or from outside; src 'sf' for a
   spontaneous one), its depth in that family tree, and how its neutrons ended (end: fission, capture, escape, other);
   W.chain.edges holds every step on the chart of nuclides seen here (decays, neutron captures, fissions to their
   fragments), with how often. */
const CH_MAX = 20000, CH_EDGES = 4000;
function chainOf() { return W.chain || (W.chain = { fis: [], nfis: 0, edges: new Map(), ver: 0 }); }
function chainEdge(Z0, N0, Z1, N1, mode, anti) {
  if (anti || Z0 + N0 <= 1 || Z1 + N1 <= 1) return;
  const C = chainOf(), k = Z0 + ',' + N0 + '>' + Z1 + ',' + N1;
  let e = C.edges.get(k);
  if (!e) { if (C.edges.size >= CH_EDGES) return; e = { Z0, N0, Z1, N1, mode, n: 0 }; C.edges.set(k, e); }
  e.n++; C.ver++;
}
function kEnd(p) {
  const K = W.kc || (W.kc = { v: new Float32Array(KC_N), c: new Uint8Array(KC_N), n: 0, gen: 0, born: 0, ends: 0 });
  const hw = W.box.w / 2, hh = W.box.h / 2;
  const cause = p.kEnd || (W.wall === 'open' && (Math.abs(p.x) > hw - 1 || Math.abs(p.y) > hh - 1) ? 'esc' : 'other');
  const i = K.n % KC_N; K.v[i] = p.kNu || 0; K.c[i] = { fis: 0, cap: 1, esc: 2, other: 3 }[cause] ?? 3; K.n++; K.ends++;
  const f = p.kFis !== undefined && W.chain ? W.chain.fis[p.kFis] : null; if (f) { f.end[K.c[i]]++; W.chain.ver++; } // (the map: how this fission's neutrons ended)
}
function fission(T, n, En) {
  const Zc = T.Z, Nc = T.N + (n ? 1 : 0), Ac = Zc + Nc;
  const lbl = nucSym(T.Z, T.N) + (n ? ' + n' : '');
  const [tvx, tvy] = velOf(T), d3 = W.d3, tvz = d3 ? T.vz : 0; // (3-D: the depth, 1.25)
  const x = T.x, y = T.y, z = d3 ? T.z : 0, ne = T.ne, gh = [ghostOf(T)];
  const S = nucBegin(n ? [T, n] : [T]);
  const u = rnd(); const nu = u < 0.08 ? 1 : u < 0.42 ? 2 : u < 0.82 ? 3 : 4;
  const T0 = { Z: T.Z, N: T.N }, par = n && n.kFis !== undefined && W.chain && W.chain.fis[n.kFis] ? n.kFis : -1; // (for the chain-reaction map)
  if (n) { gh.push(ghostOf(n)); n.kEnd = 'fis'; n.kNu = Math.min(nu, MAX_PARTS - W.parts.length + 2); kill(n); } // (kNu: the neutrons this fission will give, as far as the particle limit lets it)
  kill(T);
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
  const fL = addNuc(ZL, NL, neL, x, y, 0, 0, anti, z), fH = addNuc(ZH, NH, ne - neL, x, y, 0, 0, anti, z);
  const mu = fL.m * fH.m / (fL.m + fH.m), pr = Math.sqrt(2 * mu * TKE * 1e6);
  if (d3) { // (3-D: apart along a direction on the sphere, 1.25)
    const d = rndDir(), ux = d[0], uy = d[1], uz = d[2];
    fL.x += 0.3 * ux; fL.y += 0.3 * uy; fL.z += 0.3 * uz; fH.x -= 0.3 * ux; fH.y -= 0.3 * uy; fH.z -= 0.3 * uz;
    fL.vx = tvx + pr / fL.m * ux; fL.vy = tvy + pr / fL.m * uy; fL.vz = tvz + pr / fL.m * uz; updateFast(fL);
    fH.vx = tvx - pr / fH.m * ux; fH.vy = tvy - pr / fH.m * uy; fH.vz = tvz - pr / fH.m * uz; updateFast(fH);
  } else {
  const th = rnd() * 2 * Math.PI, ux = Math.cos(th), uy = Math.sin(th);
  fL.x += 0.3 * ux; fL.y += 0.3 * uy; fH.x -= 0.3 * ux; fH.y -= 0.3 * uy;
  setVel(fL, tvx + pr / fL.m * ux, tvy + pr / fL.m * uy);
  setVel(fH, tvx - pr / fH.m * ux, tvy - pr / fH.m * uy);
  }
  const prods = [fL, fH];
  let fid = -1;
  if (!anti) { // (the chain-reaction map: this fission, the one its neutron came from, and the steps to its fragments)
    const C = chainOf(); C.nfis++; C.ver++;
    if (C.fis.length < CH_MAX) { fid = fL.kFis = fH.kFis = C.fis.length; C.fis.push({ par, d: par >= 0 ? C.fis[par].d + 1 : 0, src: n ? 'n' : 'sf', t: W.t, Z: T0.Z, N: T0.N, ZL, NL, ZH, NH, nu: 0, kids: 0, end: [0, 0, 0, 0] }); if (par >= 0) C.fis[par].kids++; }
    chainEdge(T0.Z, T0.N + (n ? 1 : 0), ZL, NL, 'fis'); chainEdge(T0.Z, T0.N + (n ? 1 : 0), ZH, NH, 'fis');
  }
  for (let i = 0; i < nu; i++) {
    if (W.parts.length >= MAX_PARTS) break;
    const nn = addNuc(0, 1, 0, x, y, 0, 0, anti, z);
    if (fid >= 0) W.chain.fis[fid].nu++;
    nn.kGen = n ? (n.kGen || 0) + 1 : 0; if (W.kc) { W.kc.gen = Math.max(W.kc.gen, nn.kGen); W.kc.born++; }
    if (fid >= 0) nn.kFis = fid;
    const E = -1.33e6 * Math.log(Math.max(1e-6, rnd() * rnd())) / 2 + 0.2e6;
    if (d3) { const d = rndDir(); setMotion(nn, E, d[0], d[1], tvx, tvy, d[2], tvz); } else { // (3-D: on the sphere, 1.25)
    const a = rnd() * 2 * Math.PI;
    setMotion(nn, E, Math.cos(a), Math.sin(a), tvx, tvy);
    }
    prods.push(nn);
  }
  // the books: the energy released is the mass lost; what the fragments and neutrons did not take leaves as
  // prompt γ rays (about 7 MeV in all, from the fragments' excitation)
  const Qm = nucMassLoss(S);
  W.ledger.nuc += Qm;
  let left = nucLeft(S, Qm);
  if (left < 1e6) left = settleKE(S, Qm - 1e6, prods) + 1e6; // keep at least 1 MeV for the γ rays
  for (let i = 0; i < 3; i++) { if (d3) emitPhoton(x, y, left / 3, undefined, undefined, { z }); else emitPhoton(x, y, left / 3); } // (3-D: from its depth, 1.25)
  flash(x, y, [255, 210, 150], 8, 0.8, z);
  log('nuc', `Fission: ${lbl} → ${nucSym(ZL, NL)} + ${nucSym(ZH, NH)} + ${nu}n  (+${fmtE(Q * 1e6)})`);
  nucEvent('fission', x, y, `${n ? 'Fission' : 'Spontaneous fission'}: ${lbl} → ${nucSym(ZL, NL)} + ${nucSym(ZH, NH)} + ${nu}n`, gh, `${fmtE(Q * 1e6)} released${n ? '' : boostTag()}`, undefined, z);
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
  if (W.d3) return doDecay3(p); // (3-D, 1.25)
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
      emitNeutrino(x, y, Math.max(0, left), undefined, undefined, elec, `${elec ? 'β⁻' : 'β⁺'} decay of ${lbl}`);
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
      emitNeutrino(x, y, left - kx, undefined, undefined, !!p.anti, `${p.anti ? 'positron' : 'electron'} capture by ${lbl}`);
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
        if (p.kFis !== undefined && em[0] === 0) a.kFis = p.kFis; // (a delayed neutron: the chain-reaction map counts it to the fission that made its fragment)
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
/* (3-D, 1.25) doDecay in depth: the emitted particle, the neutrino and the recoil along directions on the sphere, from
   the nucleus's depth (before, a decay in a 3-D world put its α, electron or neutron down at z = 0 and turned the
   daughter in the plane). The neutrino leaves along the direction its momentum gave the recoil (the flat game draws it
   afresh). Books as doDecay's. */
function doDecay3(p) {
  const inf = p.nuc;
  let md = pickMode(inf);
  const sym = (z, n) => z > 0 ? nucSymA(z, n, p.anti) : nucSym(z, n);
  const lbl = sym(p.Z, p.N);
  const x = p.x, y = p.y, z = p.z;
  let mode = md.mode, Q = md.Q;
  if (mode === 'ec' && p.ne === 0) { if (Q > 1.022) { mode = 'b+'; Q -= 1.022; } else return false; }
  W.count.decay++;
  if (mode === 'sf') { fission(p, null, 0); flash(x, y, [255, 220, 160], 2.5, 0.35, z); return true; }
  const dZ = { 'b-': 1, 'b+': -1, ec: -1, a: -2, p: -1, '2p': -2, n: 0, '2n': 0 }[mode];
  const Zem = mode === 'a' ? 2 : mode === 'p' || mode === '2p' ? 1 : 0, nem = mode[0] === '2' ? 2 : 1;
  const Qn = Math.max(0, Q) * 1e6 + electronBindingE(p.Z, p.Z) - electronBindingE(p.Z + dZ, p.Z + dZ) - nem * electronBindingE(Zem, Zem);
  W.ledger.nuc += Qn;
  const S = nucBegin([p]);
  const Zold = p.Z, Nold = p.N, gh = [ghostOf(p)];
  const u0 = rndDir(), ux = u0[0], uy = u0[1], uz = u0[2], th = Math.atan2(uy, ux); // (rndDir's array is shared: copied at once)
  const pvx = p.vx, pvy = p.vy, pvz = p.vz;
  const brk = () => { for (const bd of p.bonds.slice()) removeBond(bd); };
  const kick = (q, vx, vy, vz) => { q.vx = vx; q.vy = vy; q.vz = vz; updateFast(q); if (0.5 * q.m * (vx * vx + vy * vy + vz * vz) > 2000 && !q.trk) startTrack(q); };
  const Qtxt = fmtE(Math.max(0, Q) * 1e6);
  switch (mode) {
    case 'b-': case 'b+': {
      const T = betaSpectrum(Q), Enu = Q - T;
      p.Z += mode === 'b-' ? 1 : -1; p.N += mode === 'b-' ? -1 : 1;
      if (p.Z === 0) { p.Z = 1; p.N = 0; }
      brk(); refresh(p);
      if (mode === 'b+') shakeOff(p);
      const pe = Math.sqrt(T * T + 2 * T * PHYS.MEC2), n0 = rndDir(), nx = n0[0], ny = n0[1], nz = n0[2];
      const k = PHYS.MEV_C_TO_SIM, prx = -(pe * ux + Enu * nx) * k, pry = -(pe * uy + Enu * ny) * k, prz = -(pe * uz + Enu * nz) * k;
      kick(p, pvx + prx / p.m, pvy + pry / p.m, pvz + prz / p.m);
      const elec = (mode === 'b-') !== !!p.anti;
      let l = null;
      if (W.parts.length < MAX_PARTS) { l = addLepton(elec ? ELEC : POS, x + ux * 0.2, y + uy * 0.2, 0, 0, z + uz * 0.2); setMotion(l, Math.max(1, T * 1e6), ux, uy, pvx, pvy, uz, pvz); }
      let left = nucLeft(S, Qn);
      if (left < 0 && l) { setMotion(l, Math.max(1, keOf(l) + left), ux, uy, pvx, pvy, uz, pvz); left = nucLeft(S, Qn); }
      emitNeutrino(x, y, Math.max(0, left), nx, ny, elec, `${elec ? 'β⁻' : 'β⁺'} decay of ${lbl}`, 'e', z, nz);
      const prod = elec ? 'e⁻ + ν̄' : 'e⁺ + ν', nm = elec ? 'β⁻' : 'β⁺';
      log('nuc', `${nm} decay: ${lbl} → ${sym(p.Z, p.N)} + ${prod} (${Qtxt})`);
      nucEvent(elec ? 'beta' : 'betap', x, y, `${nm} decay: ${lbl} → ${sym(p.Z, p.N)} + ${prod}`, gh, `${Qtxt} released${boostTag()}`, { mode, Z0: Zold, N0: Nold, Z1: p.Z, N1: p.N, anti: !!p.anti, th }, z);
      break;
    }
    case 'ec': {
      p.Z--; p.N++; p.ne--; brk(); refresh(p);
      const left = Math.max(0, nucLeft(S, Qn)), kx = Math.min(left, 0.75 * PHYS.RY * Math.pow(Math.max(1, p.Z - 1), 2));
      emitNeutrino(x, y, left - kx, undefined, undefined, !!p.anti, `${p.anti ? 'positron' : 'electron'} capture by ${lbl}`, 'e', z);
      emitPhoton(x, y, kx, undefined, undefined, { src: p, z });
      log('nuc', `${p.anti ? 'Positron' : 'Electron'} capture: ${lbl} + ${p.anti ? 'e⁺' : 'e⁻'} → ${sym(p.Z, p.N)} + ν (${Qtxt})`);
      nucEvent('ec', x, y, `${p.anti ? 'Positron' : 'Electron'} capture: ${lbl} + ${p.anti ? 'e⁺' : 'e⁻'} → ${sym(p.Z, p.N)} + ν`, gh, `${Qtxt} released${boostTag()}`, { mode, Z0: Zold, N0: Nold, Z1: p.Z, N1: p.N, anti: !!p.anti, th }, z);
      break;
    }
    case 'a': case 'p': case 'n': case '2p': case '2n': {
      const em = mode === 'a' ? [2, 2] : mode === 'p' ? [1, 0] : mode === 'n' ? [0, 1] : mode === '2p' ? [1, 0] : [0, 1];
      const cnt = (mode === '2p' || mode === '2n') ? 2 : 1;
      p.Z -= em[0] * cnt; p.N -= em[1] * cnt;
      if (p.Z + p.N <= 0) { kill(p); return false; }
      if (p.Z !== Zold) brk();
      refresh(p);
      shakeOff(p);
      const Ad = p.Z + p.N, Ae = em[0] + em[1];
      const Eem = Math.max(1e-3, Q * 1e6) * Ad / (Ad + Ae * cnt);
      const prod = [];
      for (let k = 0; k < cnt; k++) {
        if (W.parts.length >= MAX_PARTS) break;
        const a = addNuc(em[0], em[1], 0, x + ux * 0.2, y + uy * 0.2, 0, 0, p.anti, z + uz * 0.2);
        if (p.kFis !== undefined && em[0] === 0) a.kFis = p.kFis;
        const d = k ? turn3(ux, uy, uz, 2.2) : [ux, uy, uz], dx = d[0], dy = d[1], dz = d[2];
        setMotion(a, Eem / cnt, dx, dy, pvx, pvy, dz, pvz);
        prod.push(a);
      }
      const prR = Math.sqrt(2 * Ae * PHYS.MP * Eem);
      kick(p, pvx - prR / p.m * ux, pvy - prR / p.m * uy, pvz - prR / p.m * uz);
      settleKE(S, Qn, [p].concat(prod));
      const nm = mode === 'a' ? 'α decay' : mode === 'n' || mode === '2n' ? 'Neutron emission' : 'Proton emission';
      const em2 = (mode === 'a' ? 'α' : mode === 'p' ? 'p' : mode === 'n' ? 'n' : mode === '2p' ? '2p' : '2n') + (p.anti ? '\u0304' : '');
      log('nuc', `${nm}: ${lbl} → ${sym(p.Z, p.N)} + ${em2} (${Qtxt})`);
      nucEvent(mode === 'a' ? 'alpha' : 'decay', x, y, `${nm}: ${lbl} → ${sym(p.Z, p.N)} + ${em2}`, gh, `${Qtxt} released${boostTag()}`, { mode, Z0: Zold, N0: Nold, Z1: p.Z, N1: p.N, anti: !!p.anti, th }, z);
      break;
    }
  }
  flash(x, y, [255, 220, 160], 2.5, 0.35, z);
  return true;
}

/* ------------------------------------------------------------------ ballistic motion */
const _hits = [];
/* Find targets near the segment a→b (start positions). Returns sorted [t, p, b] with t∈[0,1]. */
function segTargets(x0, y0, x1, y1, R, filter) {
  _hits.length = 0;
  const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
  if (!(L2 > 0)) return _hits;
  gridEnsure();
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
  const cx0 = Math.floor((minx + G.hx) / G.cw), cx1 = Math.floor((maxx + G.hx) / G.cw), cy0 = Math.floor((miny + G.hy) / G.ch), cy1 = Math.floor((maxy + G.hy) / G.ch);
  const L = G.list;
  gridWalk(cx0, cy0, cx1, cy1, (i) => {
    const p = L[i];
    if (p.dead || !filter(p)) return;
    const px = p.x - x0, py = p.y - y0;
    const t = (px * dx + py * dy) / L2;
    if (t < 0 || t >= 1) return; // passed in the previous step, or not yet reached
    const ex = px - t * dx, ey = py - t * dy, b2 = ex * ex + ey * ey;
    if (b2 < R * R) _hits.push([t, p, Math.sqrt(b2)]);
  });
  _hits.sort((a, b) => a[0] - b[0]);
  return _hits;
}
/* What a particle at (x, y) moving at (vx, vy) comes within R of in the next dt, the targets' own motion included
   (closest approach of the two paths, relative to each other): so a nucleus that drifts into a neutron at rest is met
   as surely as a neutron that flies into the nucleus. Targets are the MD particles (the grid); returns [t, p, b]. */
function relTargets(x, y, vx, vy, dt, R, filter, defer) {
  _hits.length = 0;
  gridEnsure();
  const ex = vx * dt, ey = vy * dt, pad = R + 0.3; // (0.3: an MD particle moves far less than that in a step)
  const test = (p) => {
    if (p.dead || !filter(p)) return;
    const [tvx, tvy] = velOf(p), rx = p.x - x, ry = p.y - y, dx = (tvx - vx) * dt, dy = (tvy - vy) * dt, L2 = dx * dx + dy * dy;
    const t0 = L2 > 0 ? -(rx * dx + ry * dy) / L2 : 0;
    if (defer && t0 > 1) return; // (defer, a neutron in flight: still closing in, it meets the nucleus in the step where they are closest, at the true miss distance; met at a short step's end, a 1 PeV pass in slow motion met the outskirts first, diffracted and passed through. A slow neutron is left as it was: it meets a nucleus on every step within reach, which its capture odds are reckoned with, 0.93)
    const t = clamp(t0, 0, 1), bx = rx + t * dx, by = ry + t * dy, b2 = bx * bx + by * by;
    if (b2 < R * R) _hits.push([t, p, Math.sqrt(b2)]);
  };
  if (G.n <= 32) { for (const p of G.list) test(p); }
  else {
    const minx = Math.min(x, x + ex) - pad, maxx = Math.max(x, x + ex) + pad, miny = Math.min(y, y + ey) - pad, maxy = Math.max(y, y + ey) + pad;
    const L = G.list;
    gridWalk(Math.floor((minx + G.hx) / G.cw), Math.floor((miny + G.hy) / G.ch), Math.floor((maxx + G.hx) / G.cw), Math.floor((maxy + G.hy) / G.ch), (i) => test(L[i]));
  }
  if (_hits.length > 1) _hits.sort((a, b) => a[0] - b[0]);
  return _hits;
}
/* (3-D, 1.25) relTargets with the depth: the closest approach of the two paths in three directions. */
function relTargets3(x, y, z, vx, vy, vz, dt, R, filter, defer) {
  _hits.length = 0;
  gridEnsure();
  const ex = vx * dt, ey = vy * dt, ez = vz * dt, pad = R + 0.3;
  const test = (p) => {
    if (p.dead || !filter(p)) return;
    const rx = p.x - x, ry = p.y - y, rz = p.z - z, dx = (p.vx - vx) * dt, dy = (p.vy - vy) * dt, dz = (p.vz - vz) * dt, L2 = dx * dx + dy * dy + dz * dz;
    const t0 = L2 > 0 ? -(rx * dx + ry * dy + rz * dz) / L2 : 0;
    if (defer && t0 > 1) return;
    const t = clamp(t0, 0, 1), bx = rx + t * dx, by = ry + t * dy, bz = rz + t * dz, b2 = bx * bx + by * by + bz * bz;
    if (b2 < R * R) _hits.push([t, p, Math.sqrt(b2)]);
  };
  if (G.n <= 32) { for (const p of G.list) test(p); }
  else {
    const L = G.list, cx = (v) => Math.floor((v + G.hx) / G.cw), cy = (v) => Math.floor((v + G.hy) / G.ch), cz = (v) => Math.floor((v + G.hz) / G.cd);
    gridWalk3(cx(Math.min(x, x + ex) - pad), cy(Math.min(y, y + ey) - pad), cx(Math.max(x, x + ex) + pad), cy(Math.max(y, y + ey) + pad), cz(Math.min(z, z + ez) - pad), cz(Math.max(z, z + ez) + pad), (i) => test(L[i]));
  }
  if (_hits.length > 1) _hits.sort((a, b) => a[0] - b[0]);
  return _hits;
}
/* Free neutrons among themselves and with fast nuclei (neither is in the grid): every pair with a neutron in it that
   comes within reach in this step, by the closest approach of the two paths, so two neutrons, or a fast proton and a
   neutron at rest, meet whichever of them moves. Each pair meets once per pass (p.nHit: the last one met, while they
   are still within reach). Found by a sweep over the paths' x-extents, so a crowd of neutrons costs n log n. */
const _nnL = [];
let _nnLo = new Float64Array(256), _nnHi = new Float64Array(256), _nnVx = new Float64Array(256), _nnVy = new Float64Array(256), _nnO = [];
let _nnPrev = 1, _nnSp = -1; // (free neutrons moved last step, and the spawn count then: none, and nothing new since, means nothing to look for)
function nnMeet(i, j, dt) { // the closest approach of the two paths this step; if within reach, they meet (once per pass)
  const a = _nnL[i], b = _nnL[j];
  if (a.dead || b.dead) return;
  if (W.d3) { nnMeet3(a, b, dt); return; } // (3-D, 1.25)
  const rx = b.x - a.x, ry = b.y - a.y, dx = (_nnVx[j] - _nnVx[i]) * dt, dy = (_nnVy[j] - _nnVy[i]) * dt;
  if (Math.abs(ry) > 1 + Math.abs(dy)) return; // (nowhere near this step: no reach is an ångström)
  const R = nucReach(a, b), L2 = dx * dx + dy * dy, t0 = L2 > 0 ? -(rx * dx + ry * dy) / L2 : 0, t = clamp(t0, 0, 1), bb = Math.hypot(rx + t * dx, ry + t * dy);
  if (t0 > 1 || bb >= R || sameEv(a, b)) return; // (t0 > 1: still closing in, they meet in a later step at the true miss distance, 0.92)
  if ((a.nHit === b.id || b.nHit === a.id) && Math.hypot(rx, ry) < R) return; // (just met: one pass, one encounter)
  a.nHit = b.id; b.nHit = a.id;
  if (a.Z === 0) neutronHit(a, b, bb, R); else neutronHit(b, a, bb, R);
}
function nnMeet3(a, b, dt) {
  const fs = (p) => flyScale3(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz), sa = fs(a), sb = fs(b); // (a nucleus in flight at its true speed, as it moves, 1.26 bug fix; a neutron too, as moveNeutron now moves it, 1.26)
  const rx = b.x - a.x, ry = b.y - a.y, rz = b.z - a.z, dx = (b.vx * sb - a.vx * sa) * dt, dy = (b.vy * sb - a.vy * sa) * dt, dz = (b.vz * sb - a.vz * sa) * dt;
  if (Math.abs(ry) > 1 + Math.abs(dy) || Math.abs(rz) > 1 + Math.abs(dz)) return;
  const R = nucReach(a, b), L2 = dx * dx + dy * dy + dz * dz, t0 = L2 > 0 ? -(rx * dx + ry * dy + rz * dz) / L2 : 0, t = clamp(t0, 0, 1), ex = rx + t * dx, ey = ry + t * dy, ez = rz + t * dz, bb = Math.sqrt(ex * ex + ey * ey + ez * ez);
  if (t0 > 1 || bb >= R || sameEv(a, b)) return;
  if ((a.nHit === b.id || b.nHit === a.id) && Math.sqrt(rx * rx + ry * ry + rz * rz) < R) return;
  a.nHit = b.id; b.nHit = a.id;
  if (a.Z === 0) neutronHit(a, b, bb, R); else neutronHit(b, a, bb, R);
}
function neutronPairs(dt, id0) {
  if (_nnPrev === 0 && _nnSp === W.spawned) return;
  _nnSp = W.spawned; _nnL.length = 0; let nN = 0;
  for (const p of W.parts) {
    if (p.dead || p.k !== NUC || p.id >= id0) continue;
    if (p.Z === 0 && p.N > 0) { _nnL.push(p); nN++; } else if (p.Z > 0 && (p.rad || p.fast)) _nnL.push(p);
  }
  _nnPrev = nN;
  const n = _nnL.length;
  if (!nN || n < 2) return;
  if (_nnLo.length < n) { const m = 2 * n; _nnLo = new Float64Array(m); _nnHi = new Float64Array(m); _nnVx = new Float64Array(m); _nnVy = new Float64Array(m); }
  for (let i = 0; i < n; i++) {
    const p = _nnL[i], vx = p.rad ? p.sp * p.ux : p.vx, vy = p.rad ? p.sp * p.uy : p.vy, x1 = p.x + vx * dt;
    _nnVx[i] = vx; _nnVy[i] = vy; _nnLo[i] = Math.min(p.x, x1) - 0.5; _nnHi[i] = Math.max(p.x, x1) + 0.5; // (half an ångström each side: more than any reach)
  }
  // a sweep along x: each path's extent against those starting before it ends; only pairs with a neutron in them
  _nnO.length = n; for (let i = 0; i < n; i++) _nnO[i] = i;
  _nnO.sort((a, b) => _nnLo[a] - _nnLo[b]);
  for (let ii = 0; ii < n; ii++) {
    const i = _nnO[ii], hi = _nnHi[i], ni = _nnL[i].Z === 0;
    for (let jj = ii + 1; jj < n; jj++) {
      const j = _nnO[jj];
      if (_nnLo[j] > hi) break;
      if (ni || _nnL[j].Z === 0) nnMeet(i, j, dt);
    }
  }
}
/* Antimatter reaching a wall meets the wall's ordinary matter: an electron for each positron, a nucleon for
   each antinucleon. The wall supplies an equal mass, so the radiation carries twice the rest energy plus
   the particle's motion and binding. */
/* Charge that leaves the box's particles for the walls (qWall), placed pieces and detectors (qObj), or out through an
   open edge (qOut): kept so the box and what took charge from it add up (Data → Charge, 1.02). */
function boxCharge() { // the net charge of everything in the box, in e (unstable particles in flight included)
  let q = 0; for (const p of W.parts) if (!p.dead) q += p.q;
  for (const o of W.exo) if (!o.dead) q += XP[o.sp].q;
  return q;
}
function chargeTo(q, where) { if (q) W.ledger[where || (W.wall === 'open' ? 'qOut' : 'qWall')] += q; }
function annihilateAtWall(p, where) {
  const hw = W.box.w / 2, hh = W.box.h / 2;
  chargeTo(p.q, where || 'qWall'); // (what the mesons of an antinucleus carry back into the box is taken off below)
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
  const z = W.d3 ? clamp(p.z, -W.box.d / 2, W.box.d / 2) : 0; // (3-D: where on the wall, 1.24)
  if (nNuc > 0) {
    for (let i = 0; i < nLep; i++) twoGamma(x, y, 2 * ME_C2, z);
    const Ep = (E - nLep * 2 * ME_C2) / nNuc, nP = p.k === NUC ? p.Z : 0; // (each antinucleon meets a proton or a neutron of the wall)
    for (let i = 0; i < nNuc; i++) { const Q = (rnd() < 0.5 ? 1 : 0) - (i < nP ? 1 : 0); chargeTo(-Q, where || 'qWall'); mesonBurst(x, y, Ep, 0, 0, Q); }
    nucEvent('annih', x, y, `${lbl} hits the wall → mesons + γ`, gh, fmtE(E), undefined, z);
    log('nuc', `Annihilation at the wall: ${lbl} meets ordinary matter → mesons + γ rays (${fmtE(E)})`);
  } else {
    twoGamma(x, y, E, z);
    nucEvent('annih', x, y, 'e⁺ hits the wall → 2γ', gh, '511 keV each', undefined, z); // (where on the wall in 3-D: it was put at z = 0, 1.26 sweep)
    log('nuc', 'Annihilation at the wall: e⁺ + e⁻ (wall) → 2γ (511 keV each)');
  }
}
/* Where the straight path (x0, y0) → (x1, y1) from inside the box first meets its edge. */
function wallCross(x0, y0, x1, y1, hw, hh) {
  let t = 1;
  const dx = x1 - x0, dy = y1 - y0;
  if (x1 > hw && dx > 0) t = Math.min(t, (hw - x0) / dx); else if (x1 < -hw && dx < 0) t = Math.min(t, (-hw - x0) / dx);
  if (y1 > hh && dy > 0) t = Math.min(t, (hh - y0) / dy); else if (y1 < -hh && dy < 0) t = Math.min(t, (-hh - y0) / dy);
  t = clamp(t, 0, 1);
  _wc[0] = x0 + dx * t; _wc[1] = y0 + dy * t;
  return _wc;
}
const _wc = new Float64Array(2);
/* A closed box's walls are matter: what reaches them in radiation flight (charged particles past their radiation
   threshold, neutrons past a few keV) is stopped in them and leaves the simulation, its energy counted as escaped;
   only slower particles come back off them. (A wall that bounced a 1 GeV proton or a 14 MeV neutron straight back
   would keep every fast product of every event in the box for ever.) */
function wallStops(p) { return p.rad && !(p.k === NUC && p.Z === 0); }
/* Neutrons feel no charge, so what a wall does to them depends on what it is made of (Lab → Container): a reflector
   (graphite, beryllium) scatters them back in, as these walls always did; an absorber (boron, cadmium) captures them
   by the 1/v law: the slower a neutron, the longer it lingers by each nucleus, so a thermal one (0.025 eV) is caught
   almost always and a fast one (1 MeV) almost never, scattering back in instead (0.92); a thin wall of anything barely
   touches them, and they fly out. And one that is no material: neutrons faster than N_FAST leave, slower ones bounce
   back (to clear a box of stray fast neutrons and keep the slowed ones, 0.92). */
const N_FAST = 1e5, N_THERM = 0.0253; // eV: fast as fission and spallation neutrons are born; thermal at 20 °C
function neutronLeaves(p) {
  if (!(p.k === NUC && p.Z === 0 && W.wall === 'reflect')) return false;
  const nw = W.nWall;
  if (nw === 'pass') return true;
  if (nw === 'fast') return keOf(p) > N_FAST;
  if (nw === 'absorb') return rnd() < 1 - Math.exp(-5 * Math.sqrt(N_THERM / Math.max(1e-9, keOf(p)))); // (thermal 99.3%, 1 eV 55%, 1 keV 2.5%, 1 MeV 0.08% a hit)
  return false;
}
function wallOrEscape(p, escape, x0, y0) {
  const hw = W.box.w / 2, hh = W.box.h / 2, d3 = W.d3, hd = d3 ? W.box.d / 2 : 0; // (3-D: the z faces too, 1.23.2)
  if (p.x >= -hw && p.x <= hw && p.y >= -hh && p.y <= hh && (!d3 || (p.z >= -hd && p.z <= hd))) return false;
  if (x0 !== undefined && W.wall !== 'wrap') { // the track ends (or turns) where the path meets the wall, not past it
    const c = wallCross(x0, y0, p.x, p.y, hw, hh);
    if (p.trk) { const pts = p.trk.pts; if (pts.length >= 2) { pts[pts.length - 2] = c[0]; pts[pts.length - 1] = c[1]; } }
  }
  if ((p.k === POS || p.anti) && W.wall === 'reflect') { annihilateAtWall(p); return true; } // walls are ordinary matter
  if (escape && W.wall === 'reflect' && p.k === NUC && p.ne > 0 && p.Z >= 3) {
    // A recoiling atom (decay daughter, fission fragment, knock-on) is stopped by the wall within nanometres
    // and comes back off it at the wall's temperature; its kinetic energy goes into the wall. Everything else
    // (α, protons, neutrons, fast electrons, bare nuclei) is reflected by the walls below: a closed box keeps its
    // particles in — only light (photons, neutrinos) and the mesons of annihilations (W.exo) leave it.
    const K0 = p.rad ? p.KE : 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + (d3 ? p.vz * p.vz : 0));
    p.x = clamp(p.x, -hw + 0.6, hw - 0.6); p.y = clamp(p.y, -hh + 0.6, hh - 0.6); if (d3) p.z = clamp(p.z, -hd + 0.6, hd - 0.6);
    // (1.09: and clear of what is already there. Two fragments stopped at the same stretch of wall were set down 0.1 Å
    // apart; the capped contact force then threw them out at 64 MeV each, energy from nowhere in an insulated chain reaction)
    _crowd = null; placeClear([p], 8, p.bonds.map(bd => other(bd, p))); _crowd = null;
    p.rad = false; p.fast = false;
    const [vx, vy] = thermalV(p.m, W.T);
    p.vx = p.x >= hw - 0.61 ? -Math.abs(vx) : p.x <= -hw + 0.61 ? Math.abs(vx) : vx;
    p.vy = p.y >= hh - 0.61 ? -Math.abs(vy) : p.y <= -hh + 0.61 ? Math.abs(vy) : vy;
    if (d3) { const vz = thermalV(p.m, W.T)[2]; p.vz = p.z >= hd - 0.61 ? -Math.abs(vz) : p.z <= -hd + 0.61 ? Math.abs(vz) : vz; }
    const U = _nmd ? localPE(new Set([p])) : 0;
    W.ledger.escaped += K0 - 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + (d3 ? p.vz * p.vz : 0)) - U;
    W.spawned++; _late.push(p); // forces must be recomputed for it
    if (p.trk) { extendTrack(p); p.trk = null; }
    updateFast(p);
    return false;
  }
  if (W.wall === 'open' || (W.wall === 'reflect' && wallStops(p)) || neutronLeaves(p)) {
    if (W.wall === 'reflect') { if (!(p.k === NUC && p.Z === 0 && (W.nWall === 'pass' || W.nWall === 'fast'))) W.count.wallStop++; if (x0 !== undefined) { p.x = _wc[0]; p.y = _wc[1]; } }
    if (p.k === NUC && p.Z === 0) W.ledger.escaped += keOf(p);
    else W.ledger.escaped += keOf(p) + internalE(p); // (bug fix after 1.25: a fast one not in radiation flight, an electron or an atom, left unbooked; in flight it has no potential energy in the books)
    chargeTo(p.q); kill(p); return true;
  }
  if (W.wall === 'wrap') {
    if (p.x < -hw) p.x += W.box.w; else if (p.x > hw) p.x -= W.box.w;
    if (p.y < -hh) p.y += W.box.h; else if (p.y > hh) p.y -= W.box.h;
    if (d3) { if (p.z < -hd) p.z += W.box.d; else if (p.z > hd) p.z -= W.box.d; }
    return false;
  }
  if (p.x < -hw) { p.x = -hw + (-hw - p.x) % W.box.w; p.vx = Math.abs(p.vx); p.ux = Math.abs(p.ux); }
  if (p.x > hw) { p.x = hw - (p.x - hw) % W.box.w; p.vx = -Math.abs(p.vx); p.ux = -Math.abs(p.ux); }
  if (p.y < -hh) { p.y = -hh + (-hh - p.y) % W.box.h; p.vy = Math.abs(p.vy); p.uy = Math.abs(p.uy); }
  if (p.y > hh) { p.y = hh - (p.y - hh) % W.box.h; p.vy = -Math.abs(p.vy); p.uy = -Math.abs(p.uy); }
  if (d3) { if (p.z < -hd) { p.z = -hd + (-hd - p.z) % W.box.d; p.vz = Math.abs(p.vz); } else if (p.z > hd) { p.z = hd - (p.z - hd) % W.box.d; p.vz = -Math.abs(p.vz); } } // (3-D, 1.23.2)
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
  else { // (the target gains exactly T, bonds it breaks paid from it: the push √(2T/m) on an atom already moving gave it more or less than T (its cross term), and the broken bonds were free; a 1 MeV α through a few molecules +56–76 eV, 1.26)
    const brk = t.bonds.filter(bd => T > bd.D);
    let Tk = T;
    if (brk.length) { const set = closeSet(setOf([t])), sn = snapshot(set), U0 = localPE(set); for (const bd of brk) removeBond(bd); Tk = T - (localPE(closeSet(set)) - U0); if (Tk < 0) { restoreSnap(sn); Tk = T; } } // (they break only if T pays what breaking them costs, measured)
    const [tvx, tvy] = velOf(t), vr = tvx * rx + tvy * ry, a = Tk > 0 ? -vr + Math.sqrt(vr * vr + 2 * Tk / mt) : 0;
    setVel(t, tvx + a * rx, tvy + a * ry);
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
  const v0 = bSpd(p);
  if (Et && v0 > 0) { // the momentum turns by qE⊥h / p
    const a = q * Et * h / (p.gam * mrest * v0), c = Math.cos(a), s = Math.sin(a);
    const ux = p.ux * c - p.uy * s, uy = p.ux * s + p.uy * c; p.ux = ux; p.uy = uy;
  }
  if (!El) return v0 * h;
  const K0 = p.KE;
  p.KE = Math.max(1, K0 + q * El * v0 * h); radSpeed(p);
  const d = (v0 + bSpd(p)) / 2 * h;
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
/* Bremsstrahlung: a fast electron or positron swerving past a nucleus gives off a photon. Radiated against collision
   losses as about T·Z / 800 MeV (T its kinetic energy; Bethe–Heitler, and the X-ray yield of a tube's anode); each
   photon drawn from the 1/k spectrum from 1% of T up to T, in the electron's direction within about 1/γ. Its energy
   comes out of the electron's, exactly. */
function brems(p, tg, dE, x, y) {
  const T = p.KE, kmin = Math.max(50, 0.01 * T), mk = (T - kmin) / Math.log(T / kmin);
  if (!(T > kmin * 1.01) || rnd() >= dE * (T / 1e6) * tg.Z / 800 / mk) return;
  const k = kmin * Math.pow(T / kmin, rnd());
  const g = 1 + T / ME_C2, th = gauss() / g, c = Math.cos(th), s = Math.sin(th);
  p.KE -= k;
  emitPhoton(x, y, k, p.ux * c - p.uy * s, p.ux * s + p.uy * c, { src: tg });
  W.count.photons++;
}
/* The path over dt through the accelerator's fields (and any field): leaves the end point in _rp, p where it was. */
const _rp = [0, 0];
function radPath(p, dt, q, mrest) {
  const hasE = q && hasEfield();
  // Leapfrog steps: half the magnetic turn, the electric push and the move, the other half (second order, and a
  // uniform field keeps a circle a circle). In an accelerator the step is split exactly where the path crosses the
  // edge of a magnet or cavity: an edge landing anywhere within a step would be a small random kick, and kicks
  // like that grow a beam's oscillations turn after turn.
  let x1 = p.x, y1 = p.y, rem = dt;
  const zoned = q && W.zones.length > 0;
  for (let guard = 0; rem > 1e-12 && guard < 40; guard++) {
    let h = rem, xb = null, yb = null;
    if (zoned) {
      const L = bSpd(p) * h, k0 = zoneKey(x1, y1, p);
      if (zoneKey(x1 + p.ux * L, y1 + p.uy * L, p) !== k0) { // an edge on the way: find it (along the line of the step)
        let lo = 0, hi = 1;
        for (let it = 0; it < 14; it++) { const m = (lo + hi) / 2; if (zoneKey(x1 + p.ux * L * m, y1 + p.uy * L * m, p) === k0) lo = m; else hi = m; }
        h = rem * Math.min(1, hi * (1 + 1e-6) + 1e-9); xb = x1 + p.ux * L * lo * 0.5; yb = y1 + p.uy * L * lo * 0.5; // (the field on this side of the edge)
      }
    }
    radB(p, h / 2, x1, y1, q, mrest);
    const dd = hasE ? radE(p, h, xb === null ? x1 + p.ux * bSpd(p) * h / 2 : xb, yb === null ? y1 + p.uy * bSpd(p) * h / 2 : yb, q, mrest) : bSpd(p) * h;
    const xe = x1 + p.ux * dd, ye = y1 + p.uy * dd;
    radB(p, h / 2, xb === null ? xe : xb, yb === null ? ye : yb, q, mrest);
    x1 = xe; y1 = ye; rem -= h;
  }
  _rp[0] = x1; _rp[1] = y1;
}
function moveRad(p, dt) {
  const q = p.k === NUC ? (p.anti ? -1 : 1) * (Math.max(zChem(p) - p.ne, 0) || zChem(p)) : p.q;
  const mrest = p.k === NUC ? p.m : PHYS.ME;
  const x0 = p.x, y0 = p.y;
  radPath(p, dt, q, mrest);
  let x1 = _rp[0], y1 = _rp[1];
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
        if (p.dead || (b < fusGate() && !tg.dead && tryFusion(p, tg, b))) { stopped = true; break; }
        if (tg.dead) continue;
        if (p.ux !== ux0 || p.uy !== uy0) { p.hit = tg.id; stillNear = true; x1 = x0 + (x1 - x0) * t; y1 = y0 + (y1 - y0) * t; break; } // (turned: on from here, next step)
      }
    } else if (p.k !== NUC && (W.ultra ? b < trueRfm(tg) * FM : b < nucDrawR(tg) + 0.02 && nucDrawR(tg) > 0.04)) {
      const cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
      nuclearScatter(p, tg, b, tg.x - cx, tg.y - cy, nucDrawR(tg) + 0.02, 1.2 * Math.cbrt(tg.Z + tg.N)); // (crossing the nucleus itself: inside its radius)
      p.hit = tg.id; stillNear = true;
      x1 = cx; y1 = cy; // (on from here in its new direction, next step)
      break;
    }
    if (p.k === NUC && b < 0.5) { // nuclear stopping: screened-Coulomb (ZBL-like) elastic collision
      const T = nuclearCollision(p, tg, b);
      if (T > 0 && W.nucWin && (p.nucProd || p.born >= W.nucWin.t0)) for (const m of molecule(tg)) m.nucProd = true; // (knocked on by what a nuclear event sent flying: a bare nucleus too, which the ionizing below passes over, 0.93)
      if (T > 0) { p.KE -= T; if (p.KE <= 1) break; }
    }
    if (tg.ne <= 0) continue;
    const w = 1 / (1 + (b / 0.4) * (b / 0.4));
    let dE = Math.min(0.3 * p.KE, 0.0047 * zeff * zeff * tg.ne / beta2 * w);
    if (dE < 0.01) continue;
    p.KE -= dE;
    if (p.k !== NUC && p.KE > 2e3) brems(p, tg, dE, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    if (W.nucWin && (p.nucProd || p.born >= W.nucWin.t0)) for (const m of molecule(tg)) m.nucProd = true; // (knocked loose by what a nuclear event sent flying: a molecule it ionizes may blow apart)
    const ie = ionizationCost(tg);
    const nx = -p.uy * (rnd() < 0.5 ? 1 : -1), ny = p.ux * (nx === -p.uy ? 1 : -1);
    if (dE > ie && freeElectronCount() < MAX_FREE_E && W.parts.length < MAX_PARTS) {
      if (ejectElectron(tg, dE - ie, nx, ny)) W.count.ionize++; else dumpHeat(dE, tg, tg);
    } else {
      const vn = tg.vx * nx + tg.vy * ny, a = -vn + Math.sqrt(vn * vn + 2 * dE * tg.im); // (a push square to the path giving it exactly dE, as fastStop3 in 3-D: 0.7·√(2dE/m) gave about half, the rest lost from the books (a 20 MeV electron's H recoil through a water molecule −6.5 eV), 1.26)
      tg.vx += nx * a; tg.vy += ny * a; updateFast(tg);
    }
    if (p.KE <= 0) break;
  }
  if (!stillNear && p.hit) p.hit = 0;
  if (!p.dead && !stopped && p.k === NUC && _fastNuc.length) stopped = radVsFast(p, x0, y0, x1, y1);
  if (p.dead || stopped) return;
  p.x = x1; p.y = y1;
  radSpeed(p);
  p.vx = p.sp * p.ux; p.vy = p.sp * p.uy;
  if (W.objs.length && objPath(p, x0, y0)) return; // (placed objects: props.js)
  extendTrack(p);
  if (wallOrEscape(p, true, x0, y0)) return;
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
    const s0 = L2 > 0 ? (rx * dx + ry * dy) / L2 : 0, s = clamp(s0, 0, 1), d = Math.hypot(rx - s * dx, ry - s * dy), R = nucReach(p, tg);
    if (s0 > 1 || d >= Math.max(R, 0.6) || p.hit === tg.id || s <= 0) continue; // (s0 > 1: still closing in, met in a later step, 0.92) // (s = 0: they were closest before this step, and met then)
    if (d < R) {
      nuclearEncounter(p, tg, d / R, tg.x, tg.y);
      if (p.dead || (d < fusGate() && !tg.dead && tryFusion(p, tg, d))) return true;
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
  const b = bSpd(p) / PHYS.C, R = bSpd(p) / om;
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
  for (const o of W.exo) if (!o.dead && o.xb && o.beam && o.id < id0) fl.push(o); // (unstable particles in a beam, 1.15)
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
      if ((a.xb || b.xb) && !beams) continue; // (an unstable particle meets only the other beam here)
      if (beams && a.beam === b.beam) continue; // one bunch flies together (and its own space charge is left out)
      const rx = b.ox - a.ox, ry = b.oy - a.oy;
      if (Math.abs(rx) > 60 || Math.abs(ry) > 60) continue;
      const dx = (b.x - b.ox) - (a.x - a.ox), dy = (b.y - b.oy) - (a.y - a.oy), L2 = dx * dx + dy * dy;
      let t = L2 > 0 ? -(rx * dx + ry * dy) / L2 : 0; const closing = t > 1; t = clamp(t, 0, 1); // (closing: still closing in, they meet in a later step at the true miss distance, 0.92)
      const ex = rx + t * dx, ey = ry + t * dy, d = Math.hypot(ex, ey);
      const x = a.ox + (a.x - a.ox) * t + ex / 2, y = a.oy + (a.y - a.oy) * t + ey / 2;
      const live = beams && (C.kind !== 'ring' || C.colliding) && inDetector(C, x, y); // (beams meet only in a detector, as in a real machine)
      // beam–beam forces once the beams are brought together (while they are sped up a real machine keeps them far
      // enough apart that the pull is slight; here the separation is only a few ångström)
      if (live && d < R_BB && t > 0 && t < 1 && d > 0.05) beamBeam(C, a, b, ex, ey, d);
      const both = a.k === NUC && b.k === NUC, Rn = both ? nucReach(a, b) : 0;
      if (closing || d > Math.max(beams ? rBeam(a, b) : 0.6, Rn) || t <= 0) continue; // (t = 0: closest before this step, when they met)
      if (beams) { if (live) beamHit(C, a, b, d, x, y, ex, ey); continue; } // (while a ring speeds them up, its separated orbits keep the beams apart: a real machine holds them many beam widths apart, more than fits here)
      if (opp(a, b) || (a.k !== NUC && b.k !== NUC && a.k !== b.k)) {
        if (a.k !== NUC && b.k !== NUC) { if (d < (W.ultra ? R_LEP_U : R_NN)) eeEvent(a, b, x, y); }
        else if (both && d < (W.ultra ? Rn : R_NN)) { if (a.Z + a.N === 1 && b.Z + b.N === 1 && !a.ne && !b.ne && nnbarEvent(a, b, x, y)) continue; nuclearAnnihilation(a, b); }
        continue;
      }
      if (both) {
        if (d < Rn) { nuclearEncounter(a, b, d / Rn, x, y); if (a.dead) break; if (b.dead) continue; }
        if (d < fusGate() && tryFusion(a, b, d)) break;
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
  const chg = (p) => (p.k === NUC ? (p.anti ? -1 : 1) * (Math.max(zChem(p) - p.ne, 0) || zChem(p)) : p.q);
  const qa = chg(a), qb = chg(b);
  if (!qa || !qb || !(C.bbN > 0)) return;
  const va = bSpd(a), vb = bSpd(b), ba = va / PHYS.C, bb = vb / PHYS.C, vrel = Math.hypot(va * a.ux - vb * b.ux, va * a.uy - vb * b.uy);
  if (!(vrel > 0)) return;
  const dp = 2 * PHYS.KE * qa * qb * (1 + ba * bb * Math.max(0, -(a.ux * b.ux + a.uy * b.uy))) * bbG(d) / vrel * C.bbN / Math.max(1, C.bunch); // (positive: repulsion)
  const kick = (p, sx, sy) => { // momentum dp along (sx, sy): turn the path by its sideways part over the momentum
    const v = bSpd(p), pm = p.gam * bMu(p) * v; if (!(pm > 0)) return;
    // (below full energy the pull is held at its full-energy strength, as the beam–beam tune shift of real hadron
    // beams is: their bunches are bigger at low energy, which spreads it out)
    const hold = C.pvF && C.pvF[p.beam] > 0 ? Math.min(1, pm * v / C.pvF[p.beam]) : 1;
    const ang = dp * hold * (sx * -p.uy + sy * p.ux) / pm, c = Math.cos(ang), s = Math.sin(ang), ux = p.ux * c - p.uy * s, uy = p.ux * s + p.uy * c;
    p.ux = ux; p.uy = uy; if (!p.xb) { p.vx = v * ux; p.vy = v * uy; }
  };
  kick(a, -ex / d, -ey / d); kick(b, ex / d, ey / d); // (repulsion pushes a away from b and b away from a)
}
/* Two beam particles meet in the detector. Whatever they are, something happens when they come within reach:
   an electron and a positron annihilate (into photons, or new particles: hep.js), matter and antimatter annihilate
   into mesons, nuclei touching above their Coulomb barrier react (new particles, new nuclei), light nuclei tunnel
   and fuse, and otherwise they scatter off each other's charge. */
function beamHit(C, a, b, d, x, y, ex, ey) {
  if (a.xb || b.xb) { xbHit(C, a, b, d, x, y, ex, ey); return; } // (unstable particles in a beam: hep.js, 1.15)
  const la = speciesLabel(a), lb = speciesLabel(b), hit = (txt) => { C.hits = (C.hits || 0) + 1; C.last = txt; };
  const lepA = a.k !== NUC, lepB = b.k !== NUC;
  if (lepA && lepB && a.k !== b.k) { eeEvent(a, b, x, y); return; } // (counts itself)
  if (!lepA && !lepB && opp(a, b)) {
    const t = a.Z + a.N === 1 && b.Z + b.N === 1 && !a.ne && !b.ne ? nnbarEvent(a, b, x, y) : null;
    if (!t) nuclearAnnihilation(a, b);
    hit(t || (W.log.length ? W.log[W.log.length - 1].text.replace(/^Antimatter annihilation: /, '') : `${la} + ${lb} annihilated`));
    return;
  }
  const R = rBeam(a, b);
  if (!lepA && !lepB) {
    const t = nuclearEncounter(a, b, d / R, x, y);
    if (t) { hit(t); return; }
    if (tryFusion(a, b, d)) { hit(`${la} + ${lb} fused: ${W.log.length ? W.log[W.log.length - 1].text.replace(/^Fusion: /, '') : ''}`); return; }
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
  W.ledger.escaped += p.KE; chargeTo(p.q, 'qObj'); kill(p); return true;
}
/* Lorentz boost of (E, px, py) by velocity (bx, by) (units of c). */
function boost(E, px, py, bx, by, g0) { // (g0: the frame's Lorentz factor when known exactly, taken past γ = 100; from 1 − β² it keeps only ~10⁻⁶ of itself at γ ≈ 10⁵ (below 100 as before, bit for bit), 1.26)
  const b2 = bx * bx + by * by;
  if (!(b2 > 1e-30)) return [E, px, py];
  const g = g0 && b2 > 0.9999 ? g0 : 1 / Math.sqrt(1 - b2), bp = bx * px + by * py, k = ((g - 1) * bp / b2 - g * E);
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
  const chg = (p) => (p.k === NUC ? (p.anti ? -1 : 1) * (Math.max(zChem(p) - p.ne, 0) || zChem(p)) : p.q);
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
  const K = 1.44e6 * Math.abs(qa * qb) / (ps * vrel), bfm = W.ultra ? Math.max(0.02, d / FM) : Math.max(0.02, Math.sqrt(Math.min(1, d / reach))) * (rmap || Math.max(Rc, HIT_COUL * K)); // (k = 1.44 MeV·fm; d₀ = 2K) (ultra: the pass's own distance)
  const th0 = 2 * Math.atan(K / bfm);
  const side = Math.sign(A[1] * ey - A[2] * ex) || 1; // partner to the left (+) or right (−) of a's path
  const th = (qa * qb > 0 ? -1 : 1) * side * th0;
  const c = Math.cos(th), s = Math.sin(th), qx = A[1] * c - A[2] * s, qy = A[1] * s + A[2] * c;
  const A2 = boost(A[0], qx, qy, -bx, -by), B2 = boost(Bst, -qx, -qy, -bx, -by);
  const na = Math.hypot(A2[1], A2[2]) || 1, nb = Math.hypot(B2[1], B2[2]) || 1;
  // (a stepped particle this turn sends into flight leaves the stepped set: its bonds break and its potential energy
  // with what stays is paid from its motion, as switchMode does; it was left out of the books: a 2–20 MeV electron
  // through the H of a water molecule +4.8 eV, a muon decay's positron off a bare μ⁺ in a muonium cluster −17.6 eV, 1.26)
  const md = [a, b].filter(p => !p.xb && inMD(p)), set = md.length ? closeSet(setOf(md)) : null, U0 = set ? localPE(set) : 0;
  setMotionB(a, Math.max(1e-6, A2[0] - ma), A2[1] / na, A2[2] / na);
  setMotionB(b, Math.max(1e-6, B2[0] - mb), B2[1] / nb, B2[2] / nb);
  if (set) {
    const fl = md.filter(p => p.rad);
    if (fl.length) {
      for (const p of fl) for (const bd of p.bonds.slice()) removeBond(bd);
      const owed = localPE(closeSet(set)) - U0, p = fl[0];
      p.KE = Math.max(1e-6, p.KE - owed); radSpeed(p); p.vx = p.sp * p.ux; p.vy = p.sp * p.uy;
    }
  }
  return th0;
}
function setMotionB(p, KE, ux, uy) { if (!p.xb) { setMotion(p, KE, ux, uy); return; } p.KE = KE; p.ux = ux; p.uy = uy; exoSpeed(p); } // (an unstable particle in a beam: W.exo, 1.15)
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
  for (const o of W.exo) if (!o.dead && o.xb && o.beam) { if (o.beam === 'b') nb++; else na++; }
  if (na && nb && !(C.colTurns > 40)) return; // (a ring dumps what is left after 40 turns of collisions)
  if (na + nb) { if (C.kind !== 'ring') return; dumpBeams(); }
  refillSources(C);
  resetRings(C);
}
function dumpBeams() { // what is left of the beams goes to the beam dump
  for (const p of W.parts) if (!p.dead && p.beam) kill(p);
  for (const o of W.exo) if (!o.dead && o.xb && o.beam) { o.fate = 'sent to the beam dump'; exoLeaves(o, 'qObj'); }
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
  const kicked = (p) => { // each injection kicker fires once for the particles it brings in
    if (p.dead || !p.injKick) return;
    if (zoneLocal(p.injKick, p.x, p.y)) p.kickIn = true;
    else if (p.kickIn) { for (const g of C.rings) if (g.kick === p.injKick) g.cnt++; p.injKick = null; }
  };
  for (const p of W.parts) kicked(p);
  for (const o of W.exo) if (o.xb) kicked(o);
  const dt = W.dt || 0;
  let all = C.rings.length > 0;
  for (const g of C.rings) {
    if (!g.running && g.cnt >= Math.ceil(g.N / 2)) { g.running = true; g.ramping = true; g.Es = g.inj; g.ss = g.sExit; g.qV = 0; }
    const mc2 = g.m * AMU_EV, E = g.running ? g.Es : g.inj, gam = 1 + E / mc2, bet = Math.sqrt(1 - 1 / (gam * gam)), v = PHYS.C * bet;
    if (g.running) {
      const Ts = g.circ * (1 + g.sepL * g.sep) / v, eta = g.alphaC - 1 / (gam * gam); // (the beams kept apart run on orbits a little shorter or longer: measured)
      const U0 = g.lep || g.srad ? 4 * Math.PI / 3 * PHYS.KE * gam ** 4 * bet ** 3 / g.rho : 0; // radiated per turn
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
  const x0 = p.x, y0 = p.y;
  // nuclei in the MD set, by the two paths' closest approach (a slow nucleus drifting into a neutron at rest meets it
  // too); fast nuclei and other neutrons: neutronPairs, before this pass
  const s3 = W.d3 ? flyScale3(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) : 1; // (3-D: at its true speed, as a nucleus in flight (the books keep ½m|v|²; under 1% of c the stored speed, bit for bit): a 1 PeV neutron moved at 1,460c, 1.26)
  const hits = W.d3 ? relTargets3(x0, y0, p.z, p.vx * s3, p.vy * s3, p.vz * s3, dt, 1.0, (t) => t.k === NUC && t.Z > 0, KE > 1e3) : relTargets(x0, y0, p.vx, p.vy, dt, 1.0, (t) => t.k === NUC && t.Z > 0, p.rad || KE > 1e3); // (3-D: the closest approach in three directions, 1.25)
  for (const [, tg, b0] of hits) {
    if (tg.dead || sameEv(p, tg)) continue;
    const R = nucReach(p, tg); // (a nucleus is hit where it is drawn)
    const b = b0;
    if (b < R && neutronHit(p, tg, b, R)) break;
  }
  if (p.dead) return;
  if (W.d3) { const sc = flyScale3(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) * dt; p.x += p.vx * sc; p.y += p.vy * sc; p.z += p.vz * sc; } // (3-D: in depth too, 1.23.2: it kept its z; at its true speed, 1.26)
  else { p.x += p.vx * dt; p.y += p.vy * dt; }
  if (W.objs.length && objPath(p, x0, y0)) return; // (placed objects: props.js)
  const KE2 = keOf(p);
  if (p.trk) extendTrack(p);
  wallOrEscape(p, KE2 > ESC_E_NEUTRON, x0, y0);
  if (p.trk && !p.dead && KE2 < 1) p.trk = null;
}

/* Fast (but not radiation-mode) particles: CCD encounters along the step, hard-sphere or Coulomb scattering. */
function fastEncounters(p) {
  if (W.d3) { fastEncounters3(p); return; } // (3-D, 1.25)
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
    if (b < fusGate() && tryFusion(p, A, b)) return;
    if (opp(p, A) && b < (p.ne > 0 && A.ne > 0 ? 0.5 * (p.ljR + A.ljR) : 0.6)) { evAnti(p, A, b); return; }
    const contact = (p.ne > 0 && A.ne > 0) ? 0.35 * (p.ljR + A.ljR) : 0;
    if (contact > 0 && b < contact) { hardSphere(p, A, b, contact); return; }
    if (p.ne === 0 && b < 0.6) { coulombScatter(p, A, b); return; }
  }
}
/* (3-D, 1.25) A ballistic nucleus's path this step (from where it was to where it is, in depth) against the atoms it
   passes: hard spheres between atoms with electrons, Rutherford scattering for a bare one, as fastEncounters; the
   turn is in the plane of its path and the target, toward or away from it. As in the flat game: within the fusion
   gate it may fuse (tryFusion3); past radThreshold (2 keV), as a nucleus in radiation flight, it meets nuclei within
   reach (nuclearEncounter: reactions above the Coulomb barrier, at the target's depth) and loses energy to the
   electrons of the atoms it passes (fastStop3, moveRad's stopping). (1.25) */
function fastEncounters3(p) {
  const x0 = p.ox, y0 = p.oy, z0 = p.oz, x1 = p.x, y1 = p.y, z1 = p.z;
  if (p.k !== NUC || Math.abs(x1 - x0) > W.box.w / 2 || Math.abs(y1 - y0) > W.box.h / 2 || Math.abs(z1 - z0) > W.box.d / 2) return;
  const hot = p.Z > 0 && 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) > radThreshold(false);
  const hits = segTargets3(x0, y0, z0, x1, y1, z1, Math.max(1.6, nucDrawR(p) + 0.9), (t) => t.k === NUC && t.Z > 0 && t !== p).slice();
  if (hot) fastStop3(p, hits);
  for (const [t, A, b] of hits) {
    if (A.dead || p.dead || sameEv(p, A) || opp(p, A)) continue;
    if (p.Z > 0 && b < fusGate() && tryFusion3(p, A, b)) return;
    if (hot) { const R = nucReach(p, A); if (b < R && p.hit !== A.id) { p.hit = A.id; if (nuclearEncounter(p, A, b / R, A.x, A.y, A.z) || p.dead) return; } }
    const contact = (p.ne > 0 && A.ne > 0) ? 0.35 * (p.ljR + A.ljR) : 0;
    const cx = x0 + t * (x1 - x0) - A.x, cy = y0 + t * (y1 - y0) - A.y, cz = z0 + t * (z1 - z0) - A.z; // (from the target to the path's closest point)
    if (contact > 0 && b < contact) { hardSphere3(p, A, b, contact, cx, cy, cz); return; }
    if (p.ne === 0 && b < 0.6) { coulombScatter3(p, A, b, cx, cy, cz); return; }
  }
  if (p.hit && !hits.some(h => h[1].id === p.hit)) p.hit = 0; // (past it: a later pass may meet it again)
}
/* (3-D, 1.25) A charged nucleus past 2 keV loses energy to the electrons of the atoms it passes, as in the flat game's
   radiation flight (moveRad: about z_eff²·n_e/β² for each, closest passes most; electrons set free square to the path at
   a random azimuth): taken from its motion, given to the atom exactly. */
function fastStop3(p, hits) {
  let v = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz); if (!(v > 0)) return;
  let K = 0.5 * p.m * v * v; const K0 = K, ux = p.vx / v, uy = p.vy / v, uz = p.vz / v;
  const beta2 = Math.max(1e-8, (v / PHYS.C) ** 2), zeff = p.Z * (1 - Math.exp(-125 * Math.sqrt(beta2) / Math.pow(p.Z, 2 / 3)));
  for (const [, tg, b] of hits) {
    if (tg.dead || tg.ne <= 0 || tg.fast || sameEv(p, tg)) continue; // (another atom in flight: not ionized here; its electrons' energy is measured against the stepped world, 1.25)
    const w = 1 / (1 + (b / 0.4) * (b / 0.4)), dE = Math.min(0.3 * K, 0.0047 * zeff * zeff * tg.ne / beta2 * w);
    if (dE < 0.01) continue;
    K -= dE;
    if (W.nucWin && (p.nucProd || p.born >= W.nucWin.t0)) for (const m of molecule(tg)) m.nucProd = true;
    const ie = ionizationCost(tg), n = turn3(ux, uy, uz, Math.PI / 2);
    if (dE > ie && freeElectronCount() < MAX_FREE_E && W.parts.length < MAX_PARTS) { if (ejectElectron(tg, dE - ie, n[0], n[1], undefined, undefined, n[2])) W.count.ionize++; else dumpHeat(dE, tg, tg); }
    else { const vn = tg.vx * n[0] + tg.vy * n[1] + tg.vz * n[2], a = -vn + Math.sqrt(vn * vn + 2 * dE * tg.im); tg.vx += n[0] * a; tg.vy += n[1] * a; tg.vz += n[2] * a; updateFast(tg); } // (a push square to the path giving it exactly dE, whatever its own motion: the flat game's 0.7·√(2dE/m) is not exact, and on an atom itself in flight its cross term is keV)
    if (K <= 1) break;
  }
  if (K < K0) { const f = Math.sqrt(Math.max(0.5, K) / K0); p.vx *= f; p.vy *= f; p.vz *= f; }
}
/* (3-D) The pair's relative velocity u turned: kept in the plane of u and the offset (cx, cy, cz) from the target to the
   path, by the angle th away from the target (th < 0: toward it); the centre of mass's motion kept. */
function turnPair3(a, b, th, cx, cy, cz) {
  const M = a.m + b.m, Vx = (a.m * a.vx + b.m * b.vx) / M, Vy = (a.m * a.vy + b.m * b.vy) / M, Vz = (a.m * a.vz + b.m * b.vz) / M;
  const ux = a.vx - b.vx, uy = a.vy - b.vy, uz = a.vz - b.vz, w = Math.sqrt(ux * ux + uy * uy + uz * uz);
  if (!(w > 0)) return;
  const hx = ux / w, hy = uy / w, hz = uz / w, pr = cx * hx + cy * hy + cz * hz;
  let ex = cx - pr * hx, ey = cy - pr * hy, ez = cz - pr * hz; let el = Math.sqrt(ex * ex + ey * ey + ez * ez);
  if (!(el > 1e-12)) { const r = turn3(hx, hy, hz, Math.PI / 2); ex = r[0]; ey = r[1]; ez = r[2]; el = 1; }
  ex /= el; ey /= el; ez /= el;
  const c = Math.cos(th), s_ = Math.sin(th), nx = w * (c * hx + s_ * ex), ny = w * (c * hy + s_ * ey), nz = w * (c * hz + s_ * ez);
  a.vx = Vx + nx * b.m / M; a.vy = Vy + ny * b.m / M; a.vz = Vz + nz * b.m / M;
  b.vx = Vx - nx * a.m / M; b.vy = Vy - ny * a.m / M; b.vz = Vz - nz * a.m / M;
  updateFast(a); updateFast(b);
}
function hardSphere3(a, b, bimp, R, cx, cy, cz) { turnPair3(a, b, Math.PI - 2 * Math.asin(clamp(bimp / R, 0, 1)), cx, cy, cz); } // (a hard sphere turns the relative velocity by π − 2·asin(b/R), away from the target)
function coulombScatter3(a, b, bimp, cx, cy, cz) {
  if (W.nucWin) { const prod = (p) => p.nucProd || p.born >= W.nucWin.t0; if (prod(a) && !prod(b)) b.nucProd = true; else if (prod(b) && !prod(a)) a.nucProd = true; }
  const mu = a.m * b.m / (a.m + b.m), ux = a.vx - b.vx, uy = a.vy - b.vy, uz = a.vz - b.vz, Ecm = 0.5 * mu * (ux * ux + uy * uy + uz * uz);
  if (Ecm <= 0) return;
  const qb = b.ne > 0 ? Math.max(1, b.Z - b.ne + 1) : b.Z, d = PHYS.KE * Math.max(1, a.Z) * qb / Ecm;
  turnPair3(a, b, 2 * Math.atan(d / (2 * Math.max(bimp, 0.01))), cx, cy, cz); // (like charges: away from it)
}
/* Elastic binary collisions of a flying nucleus (exact in energy: velocities whose ½mv² is each one's kinetic
   energy, and setVel, which keeps a radiation-mode particle's stored energy and direction in step). */
function hardSphere(a, b, bimp, R) {
  const [avx, avy] = vNR(a), [bvx, bvy] = vNR(b);
  const M = a.m + b.m, Vx = (a.m * avx + b.m * bvx) / M, Vy = (a.m * avy + b.m * bvy) / M;
  const rvx = avx - bvx, rvy = avy - bvy;
  const th = 2 * Math.acos(clamp(bimp / R, 0, 1)) * (rnd() < 0.5 ? 1 : -1);
  const c = Math.cos(th), s = Math.sin(th); // (bug fix after 1.25: the relative velocity turns by 2·acos(b/R) = π − 2·asin(b/R), back for a head-on hit and not at all for a grazing one; it turned by π − 2·acos(b/R), the other way round)
  const nx = rvx * c - rvy * s, ny = rvx * s + rvy * c;
  setVel(a, Vx + nx * b.m / M, Vy + ny * b.m / M);
  setVel(b, Vx - nx * a.m / M, Vy - ny * a.m / M);
}
function coulombScatter(a, b, bimp) {
  if (W.nucWin) { const prod = (p) => p.nucProd || p.born >= W.nucWin.t0; if (prod(a) && !prod(b)) b.nucProd = true; else if (prod(b) && !prod(a)) a.nucProd = true; } // (knocked on by what a nuclear event sent flying: slow motion for nuclear events, when off, leaves it out too, 0.93)
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
  if (W.d3) { fastFastNuclear3(); return; } // (3-D, 1.25)
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
      let t = L2 > 0 ? -(rx * dx + ry * dy) / L2 : 0; const closing = t > 1; t = clamp(t, 0, 1); // (closing: still closing in, they meet in a later step at the true miss distance, 0.92)
      if (closing) continue;
      const ex = rx + t * dx, ey = ry + t * dy, b2 = ex * ex + ey * ey;
      if (b2 < fusGate() ** 2) { if (tryFusion(a, b, Math.sqrt(b2))) break; }
      if (b2 < 0.36 && !a.dead && !b.dead) coulombScatter(a, b, Math.sqrt(b2));
    }
  }
}

/* (3-D, 1.25) Fast nucleus pairs in depth: the closest approach of the two paths; fusion within the gate, Rutherford
   scattering. */
function fastFastNuclear3() {
  const n = _fastNuc.length;
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
      const rx = b.ox - a.ox, ry = b.oy - a.oy, rz = b.oz - a.oz;
      if (Math.abs(rx) > 12 || Math.abs(ry) > 12 || Math.abs(rz) > 12) continue;
      const dx = (b.x - b.ox) - (a.x - a.ox), dy = (b.y - b.oy) - (a.y - a.oy), dz = (b.z - b.oz) - (a.z - a.oz), L2 = dx * dx + dy * dy + dz * dz;
      const t0 = L2 > 0 ? -(rx * dx + ry * dy + rz * dz) / L2 : 0;
      if (t0 > 1) continue;
      const t = clamp(t0, 0, 1), ex = rx + t * dx, ey = ry + t * dy, ez = rz + t * dz, b2 = ex * ex + ey * ey + ez * ez;
      if (b2 < fusGate() ** 2) { if (tryFusion3(a, b, Math.sqrt(b2))) break; }
      if (b2 < 0.36 && !a.dead && !b.dead) coulombScatter3(a, b, Math.sqrt(b2), -ex, -ey, -ez); // (from b to a's path)
    }
  }
}
/* ------------------------------------------------------------------ integration */
let dtAll = function (out) { return false; }; // eslint-disable-line no-unused-vars
const _dtOut = new Float64Array(3);
function chooseDt() {
  let vmax = 0, amax = 0, vfn = 0, vrad = 0;
  const zoned = W.zones.length > 0;
  const PI = partsSync(), n = W.parts.length, DEAD = S.dead, RAD = S.rad, K = S.k, Z = S.Z, FAST = S.fast, VX = S.vx, VY = S.vy, FX = S.fx, FY = S.fy, IM = S.im, OBJ = S.obj;
  if (!zoned && !W.d3 && dtAll(_dtOut)) { vmax = _dtOut[0]; amax = _dtOut[1]; vfn = _dtOut[2]; } // (the maxima on all threads: the same numbers)
  else if (W.d3) { // (3-D: speeds and accelerations in three directions)
    const VZ = S.vz, FZ = S.fz;
    for (let j = 0; j < n; j++) {
      const i = PI[j];
      if (DEAD[i] === 1) continue;
      if (RAD[i] === 1) { if (zoned) { const sp = OBJ[i].sp; if (sp > vrad) vrad = sp; } continue; }
      const k = K[i];
      if (k === NUC && Z[i] === 0) continue;
      const v2 = VX[i] * VX[i] + VY[i] * VY[i] + VZ[i] * VZ[i];
      if (FAST[i] === 1) { if (k === NUC) { const s = flyScale3(v2), w2 = v2 * s * s; if (w2 > vfn) vfn = w2; } continue; } // (its true speed, 1.26 bug fix)
      if (k !== NUC) continue;
      if (v2 > vmax) vmax = v2;
      const a2 = (FX[i] * FX[i] + FY[i] * FY[i] + FZ[i] * FZ[i]) * IM[i] * IM[i];
      if (a2 > amax) amax = a2;
    }
  } else for (let j = 0; j < n; j++) {
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
  for (const o of W.exo) if (!o.dead && o.v > 0) dt = Math.min(dt, (o.xb && zoned ? 1.5 : 0.04 * Math.min(W.box.w, W.box.h)) / o.v); // (in a beam: as beams in an accelerator, 1.15) unstable particles in flight at near c: steps short enough that they cross the box in dozens of steps, not one
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
  if (W.d3) return innerDt3();
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
function innerDt3() { // (3-D: speeds and accelerations in three directions; a magnetic field as innerDt, 1.24)
  let dt = DT_MAX;
  const hasB = hasBfield(), Q = S.q, X = S.x, Y = S.y, Zp = S.z, OBJ = S.obj;
  const mdLI = _mdLI, nL = _nmdL, DEAD = S.dead, FAST = S.fast, RAD = S.rad, IM = S.im, VX = S.vx, VY = S.vy, VZ = S.vz, GX = S.gx, GY = S.gy, GZ = S.gz;
  for (let q = 0; q < nL; q++) {
    const i = mdLI[q];
    if (DEAD[i] === 1 || FAST[i] === 1 || RAD[i] === 1) continue;
    const im = IM[i], v = Math.sqrt(VX[i] * VX[i] + VY[i] * VY[i] + VZ[i] * VZ[i]), a = Math.sqrt(GX[i] * GX[i] + GY[i] * GY[i] + GZ[i] * GZ[i]) * im;
    const p = OBJ[i]; p.Bl = hasB && Q[i] !== 0 ? Bfield3(X[i], Y[i], Zp[i]) : 0; // (used by this inner step's arcs)
    const om = p.omB = Math.abs(Q[i] * p.Bl * PHYS.LOR * im);
    if (om > 0) { dt = Math.min(dt, 2 / om); const d = 2 * v / om; if (d > LEP_STEP) dt = Math.min(dt, 2 / om * Math.asin(LEP_STEP / d)); if (v > 0) dt = Math.min(dt, 4 * LEP_STEP / v); } // (as innerDt; along the axis it drifts straight, at most 4 steps' length)
    else if (v > 0) dt = Math.min(dt, LEP_STEP / v);
    if (a > 0) dt = Math.min(dt, Math.sqrt(0.04 / a));
  }
  if (_stiffL > 0) dt = Math.min(dt, 0.15 / Math.sqrt(_stiffL));
  // (bug fix 7 after 1.25: two free leptons sweeping past each other at hundreds of Å/tu cross their soft core, 0.2 Å, in
  // less than an inner step's LEP_STEP; the step must resolve the pass (3% of the core's crossing time: 10% left 29 eV, 3% 2 eV, 1% 0.3 eV), or each
  // close pass gains or loses eV: eight electrons put down in a 1 Å cluster drifted by 30–120 eV in 3-D)
  if (_passL > 0) dt = Math.min(dt, 0.03 / Math.sqrt(_passL));
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
const FL = { gen: -1, n: 0, w: 0, h: 0, wall: '', bx: new Float64Array(16), by: new Float64Array(16), na: 0, la: shArray(Int32Array, 1024), lb: shArray(Int32Array, 1024), nl: 0, li: shArray(Int32Array, 256), lj: shArray(Int32Array, 256),
  builds: 0, checks: 0, q: new Int32Array(16) };
function flValid() {
  if (W.d3) return flValid3();
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
  if (W.d3) { flBuild3(); return; }
  FL.builds++;
  const n = _nmd, idx = _mdI, X = S.x, Y = S.y, K = S.k, Z = S.Z;
  if (FL.bx.length < n) { FL.bx = new Float64Array(n * 2 + 16); FL.by = new Float64Array(n * 2 + 16); }
  for (let i = 0; i < n; i++) { FL.bx[i] = X[idx[i]]; FL.by[i] = Y[idx[i]]; }
  if (FL.q.length < S.size) FL.q = new Int32Array(S.size);
  for (let i = 0; i < n; i++) FL.q[idx[i]] = i; // (slot → its place in the MD order: the inner steps' check by slot)
  FL.gen = _mdGen; FL.n = n; FL.w = W.box.w; FL.h = W.box.h; FL.wall = W.wall;
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2;
  // the grid (over _md, at these positions or at the last computeForces's) finds the atoms: they may have moved since
  // it was built, by at most dG, so the cells scanned reach RC + SKIN_F + dG from each lepton
  gridEnsure();
  const px = G.px, py = G.py, next = G.next, cols = G.cols, rows = G.rows;
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
        for (let k = gridHead(rx, ry); k !== -1; k = next[k]) {
          const A = idx[k];
          if (K[A] !== NUC || Z[A] === 0 || S.dead[A] === 1 || S.fast[A] === 1 || S.rad[A] === 1) continue;
          let dx = X[A] - lx, dy = Y[A] - ly;
          if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; }
          if (dx * dx + dy * dy < RLF2) {
            if (na >= la.length) { const a = shArray(Int32Array, la.length * 2); a.set(la); la = a; const b = shArray(Int32Array, lb.length * 2); b.set(lb); lb = b; }
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
        if (nl >= li.length) { const a = shArray(Int32Array, li.length * 2); a.set(li); li = a; const b = shArray(Int32Array, lj.length * 2); b.set(lj); lj = b; }
        li[nl] = L; lj[nl] = M; nl++;
      }
    }
  }
  FL.la = la; FL.lb = lb; FL.na = na; FL.li = li; FL.lj = lj; FL.nl = nl;
}
/* 3-D: the lepton list's check and making (FL.bz: where each MD particle was in z; the cells walked in all three). */
function flValid3() {
  FL.checks++;
  if (FL.gen !== _mdGen || FL.n !== _nmd || FL.w !== W.box.w || FL.h !== W.box.h || FL.d !== W.box.d || FL.wall !== W.wall) return false;
  const X = S.x, Y = S.y, Zp = S.z, bx = FL.bx, by = FL.by, bz = FL.bz, idx = _mdI, n = _nmd, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = W.box.d, hw = bw / 2, hh = bh / 2, hd = bd / 2;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const s = idx[i];
    let dx = X[s] - bx[i], dy = Y[s] - by[i], dz = Zp[s] - bz[i];
    if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; }
    const d2 = dx * dx + dy * dy + dz * dz; if (d2 > worst) worst = d2;
  }
  return worst <= HSKINF2;
}
function flBuild3() {
  FL.builds++;
  const n = _nmd, idx = _mdI, X = S.x, Y = S.y, Zp = S.z, K = S.k, Z = S.Z;
  if (FL.bx.length < n) { FL.bx = new Float64Array(n * 2 + 16); FL.by = new Float64Array(n * 2 + 16); }
  if (!FL.bz || FL.bz.length < FL.bx.length) FL.bz = new Float64Array(FL.bx.length);
  for (let i = 0; i < n; i++) { FL.bx[i] = X[idx[i]]; FL.by[i] = Y[idx[i]]; FL.bz[i] = Zp[idx[i]]; }
  if (FL.q.length < S.size) FL.q = new Int32Array(S.size);
  for (let i = 0; i < n; i++) FL.q[idx[i]] = i;
  FL.gen = _mdGen; FL.n = n; FL.w = W.box.w; FL.h = W.box.h; FL.d = W.box.d; FL.wall = W.wall;
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = W.box.d, hw = bw / 2, hh = bh / 2, hd = bd / 2;
  gridEnsure();
  const px = G.px, py = G.py, pz = G.pz;
  let dG2 = 0;
  for (let i = 0; i < n; i++) {
    const si = idx[i];
    if (K[si] !== NUC) continue;
    let dx = X[si] - px[i], dy = Y[si] - py[i], dz = Zp[si] - pz[i];
    if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; }
    const d2 = dx * dx + dy * dy + dz * dz; if (d2 > dG2) dG2 = d2;
  }
  const reach = RC + SKIN_F + Math.sqrt(dG2), sx = Math.ceil(reach / G.cw), sy = Math.ceil(reach / G.ch), sz = Math.ceil(reach / G.cd);
  const nL = _nmdL, mdLI = _mdLI;
  let la = FL.la, lb = FL.lb, na = 0, li = FL.li, lj = FL.lj, nl = 0;
  for (let q = 0; q < nL; q++) {
    const L = mdLI[q];
    if (!isLepMD(L)) continue;
    const lx = X[L], ly = Y[L], lz = Zp[L];
    const ccx = Math.floor((lx + G.hx) / G.cw), ccy = Math.floor((ly + G.hy) / G.ch), ccz = Math.floor((lz + G.hz) / G.cd);
    gridWalk3(ccx - sx, ccy - sy, ccx + sx, ccy + sy, ccz - sz, ccz + sz, (k) => {
      const A = idx[k];
      if (K[A] !== NUC || Z[A] === 0 || S.dead[A] === 1 || S.fast[A] === 1 || S.rad[A] === 1) return;
      let dx = X[A] - lx, dy = Y[A] - ly, dz = Zp[A] - lz;
      if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; }
      if (dx * dx + dy * dy + dz * dz < RLF2) {
        if (na >= la.length) { const a = shArray(Int32Array, la.length * 2); a.set(la); la = a; const b = shArray(Int32Array, lb.length * 2); b.set(lb); lb = b; }
        la[na] = L; lb[na] = A; na++;
      }
    });
    for (let q2 = q + 1; q2 < nL; q2++) {
      const M = mdLI[q2];
      if (!isLepMD(M)) continue;
      let dx = X[M] - lx, dy = Y[M] - ly, dz = Zp[M] - lz;
      if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; }
      if (dx * dx + dy * dy + dz * dz < RLF2) {
        if (nl >= li.length) { const a = shArray(Int32Array, li.length * 2); a.set(li); li = a; const b = shArray(Int32Array, lj.length * 2); b.set(lj); lj = b; }
        li[nl] = L; lj[nl] = M; nl++;
      }
    }
  }
  FL.la = la; FL.lb = lb; FL.na = na; FL.li = li; FL.lj = lj; FL.nl = nl;
}
/* 3-D: the fast part for the inner steps (computeFast in JavaScript, with z). */
function computeFast3() {
  _stiffL = 0; _passL = 0;
  const GX = S.gx, GY = S.gy, GZ = S.gz, mdI = _mdI, nmd = _nmd;
  for (let q = 0; q < nmd; q++) { const i = mdI[q]; GX[i] = 0; GY[i] = 0; GZ[i] = 0; }
  if (!_mdL.length) return;
  if (!flValid3()) flBuild3();
  const X = S.x, Y = S.y, Zp = S.z, NEAR = S.nearIon, DEAD = S.dead, FAST = S.fast, RAD = S.rad;
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = W.box.d, hw = bw / 2, hh = bh / 2, hd = bd / 2;
  for (let q = 0; q < _nmdL; q++) NEAR[_mdLI[q]] = 0;
  for (let pass = 0; pass < 2; pass++) { // lepton–atom pairs, then lepton–lepton pairs (leptonNuc and the Coulomb of fastPair)
    const a = pass ? FL.li : FL.la, b = pass ? FL.lj : FL.lb, n = pass ? FL.nl : FL.na;
    for (let k = 0; k < n; k++) {
      const L = a[k], A = b[k];
      if (DEAD[L] === 1 || FAST[L] === 1 || RAD[L] === 1 || DEAD[A] === 1 || FAST[A] === 1 || RAD[A] === 1) continue;
      let dx = X[A] - X[L], dy = Y[A] - Y[L], dz = Zp[A] - Zp[L];
      if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (dz > hd) dz -= bd; else if (dz < -hd) dz += bd; }
      const r2 = dx * dx + dy * dy + dz * dz;
      if (!(r2 < RC2 && r2 > 1e-10)) continue;
      const r = Math.sqrt(r2);
      let f;
      if (pass === 0) { if (S.Z[A] === 0) continue; f = leptonNuc(L, A, r); }
      else {
        const s2 = r2 + 0.04, Q = S.q;
        f = PHYS.KE * Q[L] * Q[A] * r / (s2 * Math.sqrt(s2));
        { const w = PHYS.KE * (Math.abs(0.04 - 2 * r2) + s2) / (s2 * s2 * Math.sqrt(s2)) * (S.im[L] + S.im[A]); if (w > _stiffL) _stiffL = w; }
        { const ux = S.vx[A] - S.vx[L], uy = S.vy[A] - S.vy[L], uz = S.vz[A] - S.vz[L], w = (ux * ux + uy * uy + uz * uz) / s2; if (w > _passL) _passL = w; } // (how fast the pair sweeps past its own core: bug fix 7 after 1.25)
        if (S.k[L] !== S.k[A] && r < 0.3 && !_lepEvOff) queue(EV.ANNIH, S.obj[L], S.obj[A], null, r);
      }
      if (f > FCAP) f = FCAP; else if (f < -FCAP) f = -FCAP;
      const fx = f * dx / r, fy = f * dy / r, fz = f * dz / r;
      GX[A] += fx; GY[A] += fy; GZ[A] += fz; GX[L] -= fx; GY[L] -= fy; GZ[L] -= fz;
    }
  }
  if (_lrOn) {
    const K = S.k, ID = S.id, Q = S.q, chI = _chI, nch = _nch;
    for (let q = 0; q < _nmdL; q++) {
      const L = _mdLI[q];
      if (DEAD[L] === 1 || FAST[L] === 1 || RAD[L] === 1) continue;
      const qL = Q[L], idL = ID[L], lx = X[L], ly = Y[L], lz = Zp[L];
      for (let c = 0; c < nch; c++) {
        const C = chI[c];
        if (C === L || DEAD[C] === 1 || FAST[C] === 1 || RAD[C] === 1 || (K[C] !== NUC && ID[C] < idL)) continue;
        const dx = X[C] - lx, dy = Y[C] - ly, dz = Zp[C] - lz, r2 = dx * dx + dy * dy + dz * dz;
        if (r2 < RC2) continue;
        const r = Math.sqrt(r2), f = PHYS.KE * qL * Q[C] / r2, fx = f * dx / r, fy = f * dy / r, fz = f * dz / r;
        GX[C] += fx; GY[C] += fy; GZ[C] += fz; GX[L] -= fx; GY[L] -= fy; GZ[L] -= fz;
      }
    }
  }
  leptonExtras(false);
  if (WAVE.n) waveForces(false); // (electrons as waves in 3-D, 1.24)
}
/* The fast part alone, for the inner steps: free leptons with atoms and ions, with each other, with distant charges,
   and their own single-particle forces. */
function computeFast() {
  if (W.d3) { computeFast3(); return; }
  _stiffL = 0;
  const GX = S.gx, GY = S.gy, mdI = _mdI, nmd = _nmd;
  if (_gxOn) for (let k = 0, L = _gxL; k < _gxN; k++) { const i = L[k]; GX[i] = 0; GY[i] = 0; } // (the rest are zero: see _gxL)
  else for (let q = 0; q < nmd; q++) { const i = mdI[q]; GX[i] = 0; GY[i] = 0; }
  if (!_mdL.length) return;
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2;
  if (_flPre < 0 && _lzOn) lazyCatch(); // (the full check needs every atom where it is)
  const okFL = _flPre >= 0 ? (FL.checks++, _flPre <= HSKINF2) : flValid(); _flPre = -1; // (the inner step's move loop measured it)
  if (!okFL) { lazyCatch(); flBuild(); if (_gxOn) { gxAddFL(); if (_lzOn) lazyCatch(); } }
  const X = S.x, Y = S.y, NEAR = S.nearIon, DEAD = S.dead, FAST = S.fast, RAD = S.rad;
  for (let q = 0; q < _nmdL; q++) NEAR[_mdLI[q]] = 0;
  const la = FL.la, lb = FL.lb, na = FL.na;
  if (wasmFastReady()) { // the WebAssembly kernel: the three loops below, the same arithmetic in the same order
    const nc = wasmFast(na, FL.nl, _nmdL, _nch, _lrOn, wrap, bw, bh, hw, hh, !_lepEvOff);
    const C = WK.fc, CR = WK.fcr, OBJ = S.obj;
    for (let c = 0; c < nc; c++) queue(C[3 * c] === 1 ? EV.LEPTON : EV.ANNIH, OBJ[C[3 * c + 1]], OBJ[C[3 * c + 2]], null, CR[c]);
    leptonExtras(false);
    if (WAVE.n) waveForces(false);
    return;
  }
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
  if (WAVE.n) waveForces(false);
}
/* Outer half-kick: the slow part on everything in MD (atoms turn in a magnetic field here, electrons on their own
   steps); ballistic nuclei kick, turn and fly as before; ballistic electrons fly in moveFastLeptons. */
function outerA(dt) {
  if (W.d3) { outerA3(dt); return; }
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
/* 3-D: outerA with z (no magnetic field: its turning is 2-D only for now). */
function outerA3(dt) {
  const h = 0.5 * dt, PI = partsSync(), n = W.parts.length, hasB = hasBfield(), Q = S.q, OBJ = S.obj; // (a magnetic field: half a turn after the half kick, as outerA, 1.24)
  const DEAD = S.dead, RAD = S.rad, K = S.k, Z = S.Z, FAST = S.fast, VX = S.vx, VY = S.vy, VZ = S.vz, FX = S.fx, FY = S.fy, FZ = S.fz, GX = S.gx, GY = S.gy, GZ = S.gz, IM = S.im;
  const X = S.x, Y = S.y, Zp = S.z, OX = S.ox, OY = S.oy, OZ = S.oz, FRESH = S.fresh, BALL = S.ballistic;
  for (let j = 0; j < n; j++) {
    const i = PI[j];
    if (DEAD[i] === 1 || RAD[i] === 1) continue;
    const k = K[i];
    if (k === NUC && Z[i] === 0) continue;
    OX[i] = X[i]; OY[i] = Y[i]; OZ[i] = Zp[i]; FRESH[i] = 0;
    const fast = FAST[i] === 1, im = IM[i];
    BALL[i] = fast && k !== NUC ? 1 : 0;
    if (fast) {
      if (k !== NUC) continue;
      VX[i] += h * FX[i] * im; VY[i] += h * FY[i] * im; VZ[i] += h * FZ[i] * im;
      if (hasB && Q[i] !== 0) rotateB3(OBJ[i], h);
      const sc = flyScale3(VX[i] * VX[i] + VY[i] * VY[i] + VZ[i] * VZ[i]) * dt; // (at its true speed, not past c, 1.26 bug fix)
      X[i] += VX[i] * sc; Y[i] += VY[i] * sc; Zp[i] += VZ[i] * sc;
      continue;
    }
    VX[i] += h * (FX[i] - GX[i]) * im; VY[i] += h * (FY[i] - GY[i]) * im; VZ[i] += h * (FZ[i] - GZ[i]) * im;
    if (hasB && Q[i] !== 0 && k === NUC) rotateB3(OBJ[i], h);
  }
}
/* outerA and the single drift of innerSteps done together, elementwise over the slots, when there is no magnetic field
   and no free electron in MD (then the inner step is one plain drift). threads.js shares this out; here: not taken. */
let integrateA = function (dt) { return false; }; // eslint-disable-line no-unused-vars
/* Set by the threaded integrator for the force pass that follows at once (outerForces), and taken by it: the forces were
   cleared for slots below _intHi as they were used, and _intWorst is the list's largest squared move, from the new positions. */
let _intTok = false, _intHi = 0, _intWorst = -1, _intUse = true; // (_intUse false: not used, for tests)
let threadsPrewake = function () {}; // (threads.js)
function integrateAPlain(dt) { return !hasBfield() && _nmdL === 0 && _mdL.length === 0; }
/* The slots whose fast force (gx, gy) can be non-zero during the inner steps: the free leptons, the atoms in the
   lepton pair list and the charged particles (the long-range pull). Every other slot's is zero, so the inner steps'
   kicks and computeFast's clearing need visit only these — the same arithmetic, without the thousands of zeros. The list
   only grows within a step (a rebuilt pair list adds its atoms; a force pass starts it afresh). */
let _gxL = new Int32Array(256), _gxN = 0, _gxS = new Int32Array(4096), _gxGen = 1, _gxOn = false, _flPre = -1, _gxUse = true;
function gxAdd(i) { if (_gxS[i] !== _gxGen) { _gxS[i] = _gxGen; if (_gxN >= _gxL.length) { const a = new Int32Array(_gxL.length * 2); a.set(_gxL); _gxL = a; } _gxL[_gxN++] = i; } }
function gxReset() {
  lazyCatch();
  _gxGen++; _gxN = 0;
  if (_gxS.length < S.size) _gxS = new Int32Array(S.size);
  for (let q = 0; q < _nmdL; q++) gxAdd(_mdLI[q]);
  for (let q = 0; q < _nch; q++) gxAdd(_chI[q]);
  gxAddFL();
  if (_lzOn) { const mdI = _mdI, ID = S.id; for (let q = 0; q < _nmd; q++) if (ID[mdI[q]] >= _lzId0) gxAdd(mdI[q]); lazyCatch(); } // (made this step: stepped one by one, as before; and the bounds afresh)
}
/* Atoms beyond every free lepton's reach (not in _gxL) feel no fast force: through the inner steps they only drift at a
   constant velocity, so they are moved once, by the time gone (_lzLag), when anything needs them where they are — a pair
   list check or rebuild, an event, a force pass, the end of the step — instead of on every inner step. (The same motion;
   only the rounding of x + v·t against a sum of small steps differs.) _lzD and _lzV bound how far they can have gone from
   where the pair list saw them, so the list's check needs them only when that bound is past the skin. */
let _lzOn = false, _lzLag = 0, _lzD = 0, _lzV = 0, _lzId0 = 0, _lzUse = true;
function lazyCatch() {
  if (!_lzOn) return;
  const mdI = _mdI, nmd = _nmd, DEAD = S.dead, RAD = S.rad, FAST = S.fast, VX = S.vx, VY = S.vy, X = S.x, Y = S.y, FRESH = S.fresh, G = _gxS, gen = _gxGen, lag = _lzLag, ID = S.id, id0 = _lzId0;
  const flOk = FL.gen === _mdGen && FL.n === nmd, BX = FL.bx, BY = FL.by;
  let d2m = 0, v2m = 0;
  for (let q = 0; q < nmd; q++) {
    const i = mdI[q];
    if (G[i] === gen || DEAD[i] === 1 || FAST[i] === 1 || RAD[i] === 1 || ID[i] >= id0) continue; // (made this step: on the list, stepped one by one)
    FRESH[i] = 0;
    if (lag > 0) { X[i] += VX[i] * lag; Y[i] += VY[i] * lag; }
    const v2 = VX[i] * VX[i] + VY[i] * VY[i]; if (v2 > v2m) v2m = v2;
    if (flOk) { const dx = X[i] - BX[q], dy = Y[i] - BY[q], d2 = dx * dx + dy * dy; if (d2 > d2m) d2m = d2; }
  }
  _lzLag = 0; _lzD = flOk ? Math.sqrt(d2m) : Infinity; _lzV = Math.sqrt(v2m);
}
function gxAddFL() { const lb = FL.lb, la = FL.la; for (let k = 0; k < FL.na; k++) { gxAdd(lb[k]); gxAdd(la[k]); } const li = FL.li, lj = FL.lj; for (let k = 0; k < FL.nl; k++) { gxAdd(li[k]); gxAdd(lj[k]); } }
/* Inner steps: fast half-kick, drift (everything in MD moves), fast forces, lepton events, fast half-kick. */
function innerSteps(Dt) {
  if (W.d3) { innerSteps3(Dt); return; }
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
    const h = 0.5 * dti, wv = WAVE.n > 0;
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
    const useL = _gxUse;
    if (useL && !_gxOn) { _gxOn = true; _lzOn = false; gxReset(); if (_lzUse) { _lzOn = true; _lzLag = 0; _lzId0 = W.nextId; lazyCatch(); } }
    {
      const mdI = _mdI, nmd = _nmd, DEAD = S.dead, RAD = S.rad, K = S.k, FAST = S.fast, VX = S.vx, VY = S.vy, GX = S.gx, GY = S.gy, IM = S.im;
      const X = S.x, Y = S.y, OX = S.ox, OY = S.oy, FRESH = S.fresh, OBJ = S.obj;
      if (useL) for (let k = 0, L = _gxL; k < _gxN; k++) { // the fast half-kick: only where the fast force can be non-zero
        const i = L[k];
        if (DEAD[i] === 1 || FAST[i] === 1 || RAD[i] === 1) continue;
        const im = IM[i]; VX[i] += h * GX[i] * im; VY[i] += h * GY[i] * im;
        if (wv && K[i] !== NUC) { const p = OBJ[i]; if (p.wm) p.wv += h * p.wg * W_IMS; } // (a packet's size)
      }
      // the lepton pair list's check, from the positions this loop leaves (flValid's loop, folded in)
      const flOk = useL && !wrap && FL.gen === _mdGen && FL.n === nmd && FL.w === W.box.w && FL.h === W.box.h && FL.wall === W.wall, BX = FL.bx, BY = FL.by;
      let worst = 0;
      const lz = _lzOn, gL = _gxL, nI = lz ? _gxN : nmd, FQ = FL.q, nob = W.objs.length;
      for (let k = 0; k < nI; k++) {
        const i = lz ? gL[k] : mdI[k], q = lz ? FQ[i] : k;
        if (lz && (q < 0 || q >= nmd || mdI[q] !== i)) { if (DEAD[i] === 1 || FAST[i] === 1 || RAD[i] === 1) continue; } // (a list slot outside the MD set's order: no list position to check)
        else if (DEAD[i] === 1 || FAST[i] === 1 || RAD[i] === 1) { if (flOk) { const dx = X[i] - BX[q], dy = Y[i] - BY[q], d2 = dx * dx + dy * dy; if (d2 > worst) worst = d2; } continue; }
        FRESH[i] = 0;
        if (!useL) { const im = IM[i]; VX[i] += h * GX[i] * im; VY[i] += h * GY[i] * im; if (wv && K[i] !== NUC && OBJ[i].wm) OBJ[i].wv += h * OBJ[i].wg * W_IMS; }
        if (K[i] !== NUC) {
          const p = OBJ[i];
          if (wv && p.wm) { p.ws += p.wv * dti; if (p.ws < 1e-3) p.ws = 1e-3; } // (a packet's size drifts too)
          // a free lepton in a magnetic field moves on an exact arc between the kicks: its guiding centre then drifts
          // across the field exactly (only the kicks move it), however many turns it makes in a field of any strength
          const lx0 = X[i], ly0 = Y[i];
          if (p.Bl !== 0 && hasB) gyrate(p, p.Bl, dti);
          else { X[i] += VX[i] * dti; Y[i] += VY[i] * dti; }
          if (nob) objLepton(p, lx0, ly0); // (placed objects: it bounces off them)
          if (wrap) {
            if (X[i] < -hw) { X[i] += bw; OX[i] += bw; } else if (X[i] > hw) { X[i] -= bw; OX[i] -= bw; }
            if (Y[i] < -hh) { Y[i] += bh; OY[i] += bh; } else if (Y[i] > hh) { Y[i] -= bh; OY[i] -= bh; }
          } else if (X[i] < -hw || X[i] > hw || Y[i] < -hh || Y[i] > hh) leptonWall(p);
        } else { X[i] += VX[i] * dti; Y[i] += VY[i] * dti; }
        if (flOk && (!lz || (q >= 0 && q < nmd && mdI[q] === i))) { const dx = X[i] - BX[q], dy = Y[i] - BY[q], d2 = dx * dx + dy * dy; if (d2 > worst) worst = d2; }
      }
      if (lz) { _lzLag += dti; const bnd = _lzD + _lzV * _lzLag; if (bnd * bnd > HSKINF2) { _flPre = -1; } else _flPre = flOk ? worst : -1; } // (the drifting atoms within their bound: the moved ones decide)
      else _flPre = flOk ? worst : -1;
    }
    if (_mdL.length) computeFast();
    _flPre = -1;
    {
      const DEAD = S.dead, RAD = S.rad, FAST = S.fast, VX = S.vx, VY = S.vy, GX = S.gx, GY = S.gy, IM = S.im, FRESH = S.fresh, K = S.k, OBJ = S.obj;
      const L = useL ? _gxL : _mdI, n = useL ? _gxN : _nmd;
      for (let k = 0; k < n; k++) {
        const i = L[k];
        if (DEAD[i] === 1 || FAST[i] === 1 || RAD[i] === 1 || FRESH[i] === 1) continue; // fresh: born since the last drift, already current
        VX[i] += h * GX[i] * IM[i]; VY[i] += h * GY[i] * IM[i];
        if (wv && K[i] !== NUC) { const p = OBJ[i]; if (p.wm) p.wv += h * p.wg * W_IMS; }
      }
    }
    // the events found by the force pass (a lepton at an atom, a positron at an electron) come after the closing kick,
    // when velocities and positions belong to the same moment: a scatter or capture handled half a kick early, on a
    // velocity still missing h·a, threw that half kick's work away (free electrons among ions lost energy on every pass)
    if (_mdL.length) {
      const st0 = W.spawned + W.topo + W.dirty - _undone; // (changes put back exactly, as by undoJoin, need no recount)
      processEvents(); // (events that may look at other atoms bring the far ones up to date first: lzNeed)
      const wch = (WAVE.on || WAVE.n) && waveSync(false); // (electrons as waves: packets gone or made by the events)
      // (quantum bonds held, 1.23.1: this pass is for the fast forces; the atoms' own are worked out again at the step's end,
      // outerForces, before any kick uses them, so a GFN1 calculation here was thrown away, one for each event: 24–44 s
      // frames with electrons about; the members keep their last charges meanwhile)
      if (wch || W.spawned + W.topo + W.dirty - _undone !== st0) { _noEv = true; _qmHold = true; try { computeForces(); } finally { _qmHold = false; } _noEv = false; if (_gxOn) gxReset(); } // (the force pass set the fast forces afresh, for the next opening kick)
    }
    rem -= dti;
  }
  lazyCatch(); _lzOn = false;
  _gxOn = false;
}
/* 3-D: the inner steps with z, plainly: every MD particle kicked and drifted on each inner step (none of the flat
   world's shortcuts: the list of slots with a fast force, the far atoms' lazy drift), no magnetic field or waves. */
function innerSteps3(Dt) {
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = W.box.d, hw = bw / 2, hh = bh / 2, hd = bd / 2;
  let rem = Dt, dti = rem, left = 0;
  while (rem > 1e-12) {
    if (_mdL.length) {
      const L = innerDt3();
      if (left <= 0 || L < 0.8 * dti) { const n = Math.max(1, Math.ceil(rem / L - 1e-9)); dti = rem / n; left = n; }
    } else { dti = rem; left = 1; }
    left--;
    const h = 0.5 * dti, lep = _mdL.length > 0, hasB = lep && hasBfield(), wv = lep && WAVE.n > 0;
    const mdI = _mdI, nmd = _nmd, DEAD = S.dead, RAD = S.rad, K = S.k, FAST = S.fast, VX = S.vx, VY = S.vy, VZ = S.vz, GX = S.gx, GY = S.gy, GZ = S.gz, IM = S.im;
    const X = S.x, Y = S.y, Zp = S.z, OX = S.ox, OY = S.oy, OZ = S.oz, FRESH = S.fresh, OBJ = S.obj;
    for (let q = 0; q < nmd; q++) {
      const i = mdI[q];
      if (DEAD[i] === 1 || FAST[i] === 1 || RAD[i] === 1) continue;
      FRESH[i] = 0;
      if (lep) { const im = IM[i]; VX[i] += h * GX[i] * im; VY[i] += h * GY[i] * im; VZ[i] += h * GZ[i] * im; }
      if (wv && K[i] !== NUC) { const p = OBJ[i]; if (p.wm) { p.wv += h * p.wg * W_IMS; p.ws += p.wv * dti; if (p.ws < 1e-3) p.ws = 1e-3; } } // (a packet's size: its half kick and drift, as innerSteps, 1.24)
      if (hasB && K[i] !== NUC && OBJ[i].Bl !== 0) gyrate3(OBJ[i], OBJ[i].Bl, dti); // (a free lepton in a magnetic field: the exact arc, as innerSteps, 1.24)
      else { X[i] += VX[i] * dti; Y[i] += VY[i] * dti; Zp[i] += VZ[i] * dti; }
      if (K[i] !== NUC) {
        if (wrap) {
          if (X[i] < -hw) { X[i] += bw; OX[i] += bw; } else if (X[i] > hw) { X[i] -= bw; OX[i] -= bw; }
          if (Y[i] < -hh) { Y[i] += bh; OY[i] += bh; } else if (Y[i] > hh) { Y[i] -= bh; OY[i] -= bh; }
          if (Zp[i] < -hd) { Zp[i] += bd; OZ[i] += bd; } else if (Zp[i] > hd) { Zp[i] -= bd; OZ[i] -= bd; }
        } else if (X[i] < -hw || X[i] > hw || Y[i] < -hh || Y[i] > hh || Zp[i] < -hd || Zp[i] > hd) leptonWall(OBJ[i]);
      }
    }
    if (!lep) { rem -= dti; continue; }
    computeFast3();
    for (let q = 0; q < nmd; q++) {
      const i = mdI[q];
      if (DEAD[i] === 1 || FAST[i] === 1 || RAD[i] === 1 || FRESH[i] === 1) continue;
      const im = IM[i]; VX[i] += h * GX[i] * im; VY[i] += h * GY[i] * im; VZ[i] += h * GZ[i] * im;
      if (wv && K[i] !== NUC) { const p = OBJ[i]; if (p.wm) p.wv += h * p.wg * W_IMS; }
    }
    const st0 = W.spawned + W.topo + W.dirty - _undone;
    processEvents();
    const wch = (WAVE.on || WAVE.n) && waveSync(false); // (electrons as waves: packets gone or made by the events, as innerSteps, 1.24)
    if (wch || W.spawned + W.topo + W.dirty - _undone !== st0) { _noEv = true; _qmHold = true; try { computeForces(); } finally { _qmHold = false; } _noEv = false; }
    rem -= dti;
  }
}
/* A free electron reaching the box edge bounces off a closed wall elastically (off the piston, when the box is
   resized), and is lost through an open one. A positron meets the wall's own electrons. */
function leptonWall(p) {
  if (W.d3 && W.wall === 'open') { wallStop3(p, 'qOut'); return; } // (3-D: its energy counted as escaped, 1.23.2)
  if (W.wall === 'open') { wallOut2(p); return; } // (its energy counted as escaped: bug fix after 1.25)
  if (p.k === POS) { annihilateAtWall(p); return; }
  if (W.d3 && 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) > radThreshold(true)) { wallStop3(p); return; } // (3-D: a fast electron is stopped in a closed wall, as radiation flight is in the flat box, 1.23.2)
  const hw = W.box.w / 2, hh = W.box.h / 2, uw = W.box.uw, uh = W.box.uh;
  if (p.x < -hw) { p.x = -hw + Math.min(W.box.w, -hw - p.x); p.vx = -2 * uw - p.vx; if (p.vx < 0) p.vx = -p.vx; }
  else if (p.x > hw) { p.x = hw - Math.min(W.box.w, p.x - hw); p.vx = 2 * uw - p.vx; if (p.vx > 0) p.vx = -p.vx; }
  if (p.y < -hh) { p.y = -hh + Math.min(W.box.h, -hh - p.y); p.vy = -2 * uh - p.vy; if (p.vy < 0) p.vy = -p.vy; }
  else if (p.y > hh) { p.y = hh - Math.min(W.box.h, p.y - hh); p.vy = 2 * uh - p.vy; if (p.vy > 0) p.vy = -p.vy; }
  if (W.d3) { const hd = W.box.d / 2, ud = W.box.ud || 0; if (p.z < -hd) { p.z = -hd + Math.min(W.box.d, -hd - p.z); p.vz = -2 * ud - p.vz; if (p.vz < 0) p.vz = -p.vz; } else if (p.z > hd) { p.z = hd - Math.min(W.box.d, p.z - hd); p.vz = 2 * ud - p.vz; if (p.vz > 0) p.vz = -p.vz; } } // (the piston's speed in depth too, 1.24)
}
/* Ballistic electrons and positrons (20 eV – 1 keV) fly in straight segments and look for collisions along every
   one. A segment ends just past the next wall (reflected or wrapped there), and is at most 45% of the box across
   or a quarter turn in a magnetic field. An applied electric field is exact on a segment (uniform acceleration). */
function moveFastLeptons(Dt, id0) {
  if (W.d3) { moveFastLeptons3(Dt, id0); return; }
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
      if (W.objs.length && objPath(p, p.ox, p.oy)) break; // (placed objects: props.js)
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
let bathAll = function (dt, c1, c2, kT, hw, hh, vf2) { return -1; }; // eslint-disable-line no-unused-vars
let _wallNeed = -1; // (from the bath pass: how many particles the walls pass must look at; −1 not counted)
function outerBPlain() { const t = W.tool; return !hasBfield() && !(t && t.active && (t.type === 'heat' || t.type === 'pull')); }
function outerB(dt) {
  if (W.d3) { outerB3(dt); return; }
  const gam = W.gamma, kT = PHYS.KB * W.T, h = 0.5 * dt;
  const c1 = Math.exp(-gam * dt), c2 = Math.sqrt(Math.max(0, 1 - c1 * c1));
  const plain = outerBPlain(), cnt = plain && W.wall !== 'wrap' && !W.box.uw && !W.box.uh;
  const bhw = cnt ? W.box.w / 2 : -1, bhh = W.box.h / 2, vf2 = V_FAST_ON * V_FAST_ON;
  _wallNeed = -1;
  if (plain) { const nd = bathAll(dt, c1, c2, kT, bhw, bhh, vf2); if (nd >= 0) { if (cnt) _wallNeed = nd; return; } } // (the threads take the plain case: no magnetic field, no heat tool)
  let need = 0;
  const hasB = hasBfield();
  const t = W.tool, heat = t && t.active && (t.type === 'heat' || t.type === 'pull');
  let hc1 = 1, hc2 = 0, hkT = 0, hR2 = 0, pullK = 0;
  if (heat) { // heat tool: local bath at its temperature; push/pull: atoms it moves are calmed to the bath temperature
    hc1 = Math.exp(-0.6 * dt); hc2 = Math.sqrt(1 - hc1 * hc1); hkT = PHYS.KB * (t.type === 'heat' ? t.T : W.T); hR2 = t.R * t.R;
    if (t.type === 'pull') pullK = 2 * Math.abs(t.s) / hR2; // (the trap's spring constant, eV/Å²)
  }
  const PI = partsSync(), n = W.parts.length, seed = W.bathSeed, step = W.step, nz = _bathNz;
  const DEAD = S.dead, RAD = S.rad, K = S.k, Z = S.Z, FAST = S.fast, VX = S.vx, VY = S.vy, FX = S.fx, FY = S.fy, GX = S.gx, GY = S.gy, IM = S.im, Q = S.q;
  const X = S.x, Y = S.y, FRESH = S.fresh, OBJ = S.obj;
  for (let j = 0; j < n; j++) {
    const i = PI[j];
    if (DEAD[i] === 1 || RAD[i] === 1) continue;
    const k = K[i];
    if (k === NUC && Z[i] === 0) continue;
    if (cnt && (k !== NUC || FAST[i] === 1)) need++;
    if (FRESH[i] === 1) { FRESH[i] = 0; if (cnt && k === NUC) { const x = X[i], y = Y[i]; if (!(x > -bhw && x < bhw && y > -bhh && y < bhh && VX[i] * VX[i] + VY[i] * VY[i] <= vf2)) need++; } continue; } // born during this step's events: velocity is already current
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
    if (gam > 0 && k === NUC && !(inTool && pullK)) { const sg = Math.sqrt(kT * im); bathNoise(seed, step, i, nz); vx = c1 * vx + c2 * sg * nz[0]; vy = c1 * vy + c2 * sg * nz[1]; }
    if (inTool) {
      let k1 = hc1, k2 = hc2;
      if (pullK) { // push/pull (its bath in place of the chamber's): damped about critically for the atom's own mass, 2√(k/m), so a uranium atom comes in as readily as a light one and nothing overshoots far; never less than before (0.6/tu up to 12 u)
        const g = Math.min(10, Math.max(0.6 * Math.min(1, 12 * im), 2 * Math.sqrt(pullK * im)));
        k1 = Math.exp(-g * dt); k2 = Math.sqrt(1 - k1 * k1);
      }
      const sg = Math.sqrt(hkT * im); vx = k1 * vx + k2 * sg * gauss(); vy = k1 * vy + k2 * sg * gauss();
    }
    VX[i] = vx; VY[i] = vy;
    if (cnt && !fast) { const x = X[i], y = Y[i]; if (!(x > -bhw && x < bhw && y > -bhh && y < bhh && vx * vx + vy * vy <= vf2)) need++; }
  }
  if (cnt) _wallNeed = need;
}

/* 3-D: outerB with z: the closing half kick and the Langevin bath in all three directions. The bath's noise is hashed as
   in the flat world (bathNoise: x and y), z from the same hash on a second seed. No magnetic field, no heat tool. */
const _bathNz3 = new Float64Array(2);
function outerB3(dt) {
  const gam = W.gamma, kT = PHYS.KB * W.T, h = 0.5 * dt;
  const c1 = Math.exp(-gam * dt), c2 = Math.sqrt(Math.max(0, 1 - c1 * c1));
  _wallNeed = -1;
  const PI = partsSync(), n = W.parts.length, seed = W.bathSeed, seedZ = (seed ^ 0x6A09E667) >>> 0, step = W.step, nz = _bathNz, nz3 = _bathNz3;
  const DEAD = S.dead, RAD = S.rad, K = S.k, Z = S.Z, FAST = S.fast, VX = S.vx, VY = S.vy, VZ = S.vz, FX = S.fx, FY = S.fy, FZ = S.fz, GX = S.gx, GY = S.gy, GZ = S.gz, IM = S.im, FRESH = S.fresh;
  // the Heat tool (a local bath at its temperature, in its cone) and Push/Pull (the atoms in its ball calmed to the
  // chamber's temperature, about critically for their mass), as in the flat world
  const t = W.tool, heat = !!(t && t.active && (t.type === 'heat' || t.type === 'pull')), Xp = S.x, Yp = S.y, Zp = S.z;
  let hc1 = 1, hc2 = 0, hkT = 0, pullK = 0;
  if (heat) { hc1 = Math.exp(-0.6 * dt); hc2 = Math.sqrt(1 - hc1 * hc1); hkT = PHYS.KB * (t.type === 'heat' ? t.T : W.T); if (t.type === 'pull') pullK = 2 * Math.abs(t.s) / (t.R * t.R); }
  const reach = pullK ? { x: t.x, y: t.y, z: t.z, R: t.R } : t; // (Push/Pull: its ball, whatever the cone)
  const hasB = hasBfield();
  for (let j = 0; j < n; j++) {
    const i = PI[j];
    if (DEAD[i] === 1 || RAD[i] === 1) continue;
    const k = K[i];
    if (k === NUC && Z[i] === 0) continue;
    if (FRESH[i] === 1) { FRESH[i] = 0; continue; }
    const fast = FAST[i] === 1;
    if (fast && k !== NUC) continue;
    const im = IM[i];
    if (hasB && S.q[i] !== 0 && k === NUC) rotateB3(S.obj[i], h); // (a magnetic field: half a turn before the half kick, as outerB, 1.24)
    let vx = VX[i], vy = VY[i], vz = VZ[i];
    if (fast) { vx += h * FX[i] * im; vy += h * FY[i] * im; vz += h * FZ[i] * im; }
    else { vx += h * (FX[i] - GX[i]) * im; vy += h * (FY[i] - GY[i]) * im; vz += h * (FZ[i] - GZ[i]) * im; }
    const inTool = heat && k === NUC && inTool3(reach, Xp[i], Yp[i], Zp[i]);
    if (gam > 0 && k === NUC && !(inTool && pullK)) {
      const sg = Math.sqrt(kT * im); bathNoise(seed, step, i, nz); bathNoise(seedZ, step, i, nz3);
      vx = c1 * vx + c2 * sg * nz[0]; vy = c1 * vy + c2 * sg * nz[1]; vz = c1 * vz + c2 * sg * nz3[0];
    }
    if (inTool) {
      let k1 = hc1, k2 = hc2;
      if (pullK) { const g = Math.min(10, Math.max(0.6 * Math.min(1, 12 * im), 2 * Math.sqrt(pullK * im))); k1 = Math.exp(-g * dt); k2 = Math.sqrt(1 - k1 * k1); }
      const sg = Math.sqrt(hkT * im); vx = k1 * vx + k2 * sg * gauss(); vy = k1 * vy + k2 * sg * gauss(); vz = k1 * vz + k2 * sg * gauss();
    }
    VX[i] = vx; VY[i] = vy; VZ[i] = vz;
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
/* 3-D (1.24, the Lab's box-size slider in 3-D): moveWalls with the depth. The slider scales width, height and depth
   together (td, the depth wanted); growing is a free expansion, shrinking a piston on all six faces at the flat game's
   wall speed (0.6 Å/tu), after the walls sweep through the empty space to the outermost particles. The walls' speed
   (uw, uh, ud) is what a particle bouncing off a hard wall meets (walls3, leptonWall), so a squeezed gas heats as in 2-D. */
function moveWalls3(dt) {
  const b = W.box, step = 0.6 * dt * 2;
  let ex = 0, ey = 0, ez = 0;
  for (const p of W.parts) { if (p.dead || p.rad) continue; const ax = Math.abs(p.x), ay = Math.abs(p.y), az = Math.abs(p.z); if (ax > ex) ex = ax; if (ay > ey) ey = ay; if (az > ez) ez = az; }
  const to = (cur, tgt, e) => (tgt >= cur ? tgt : Math.max(tgt, Math.min(cur - step, 2 * (e + 2))));
  const td = b.td > 0 ? b.td : b.d, w1 = to(b.w, b.tw, ex), h1 = to(b.h, b.th, ey), d1 = to(b.d, td, ez);
  b.uw = w1 < b.w ? -step / (2 * dt) : 0; b.uh = h1 < b.h ? -step / (2 * dt) : 0; b.ud = d1 < b.d ? -step / (2 * dt) : 0;
  b.w = w1; b.h = h1; b.d = d1;
}
let _wallMoved = false; // (walls: a particle rescued from deep in a wall since the last force pass)
function walls(p) {
  if (p.dead || p.rad || (p.k === NUC && p.Z === 0)) return;
  const hw0 = W.box.w / 2, hh0 = W.box.h / 2, hw = hw0, hh = hh0;
  if (W.wall === 'wrap') {
    if (p.x < -hw) { p.x += W.box.w; p.ox += W.box.w; } else if (p.x > hw) { p.x -= W.box.w; p.ox -= W.box.w; }
    if (p.y < -hh) { p.y += W.box.h; p.oy += W.box.h; } else if (p.y > hh) { p.y -= W.box.h; p.oy -= W.box.h; }
    if (W.d3) { const bd = W.box.d, hd = bd / 2; if (p.z < -hd) { p.z += bd; p.oz += bd; } else if (p.z > hd) { p.z -= bd; p.oz -= bd; } }
    return;
  }
  if (W.d3) { walls3(p); return; }
  if ((p.k === POS || p.anti) && W.wall === 'reflect' && (p.x < -hw || p.x > hw || p.y < -hh || p.y > hh)) { annihilateAtWall(p); return; }
  if (W.wall === 'open') { if (p.x < -hw || p.x > hw || p.y < -hh || p.y > hh) wallOut2(p); return; }
  const uw = W.box.uw, uh = W.box.uh;
  if (!p.fast) { // soft walls handle slow particles; only rescue deep escapees, handing back their potential energy
    const m = 1.5, rin = p.k === NUC ? wallIn(p) : 0, hw = hw0 - rin, hh = hh0 - rin; // (the wall where its edge meets it)
    if (!(p.x < -hw - m || p.x > hw + m || p.y < -hh - m || p.y > hh + m)) return;
    const one = p.k === NUC && _nmd ? new Set([p]) : null, k = wallK(p);
    const U0 = one ? localPE(one) : 0;
    let dW = 0; // the wall's own energy (used when the full potential energy is not at hand)
    if (p.x < -hw - m) { const d = -hw - p.x; p.x = -hw; dW += 0.5 * k * d * d; p.vx = Math.abs(p.vx); }
    else if (p.x > hw + m) { const d = p.x - hw; p.x = hw; dW += 0.5 * k * d * d; p.vx = -Math.abs(p.vx); }
    if (p.y < -hh - m) { const d = -hh - p.y; p.y = -hh; dW += 0.5 * k * d * d; p.vy = Math.abs(p.vy); }
    else if (p.y > hh + m) { const d = p.y - hh; p.y = hh; dW += 0.5 * k * d * d; p.vy = -Math.abs(p.vy); }
    if (one) { _crowd = null; placeClear([p], 8, p.bonds.map(bd => other(bd, p))); _crowd = null; } // (1.09: not on top of an atom already at the wall: the overlap's energy, more than its motion could pay, was made from nothing)
    const dE = one ? U0 - localPE(one) : dW, ke = 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy), k1 = Math.max(0, ke + dE);
    if (ke > 0) { const f = Math.sqrt(k1 / ke); p.vx *= f; p.vy *= f; }
    _wallMoved = true; // (moved after the step's force pass: the next step starts from forces at its new place, not the wall's
    // push from deep inside it, which would throw it back with tens of eV of energy from nowhere)
    return;
  }
  if (p.x < -hw) { p.x = -hw + Math.min(W.box.w, -hw - p.x); p.vx = -2 * uw - p.vx; if (p.vx < 0) p.vx = -p.vx; }
  else if (p.x > hw) { p.x = hw - Math.min(W.box.w, p.x - hw); p.vx = 2 * uw - p.vx; if (p.vx > 0) p.vx = -p.vx; }
  if (p.y < -hh) { p.y = -hh + Math.min(W.box.h, -hh - p.y); p.vy = -2 * uh - p.vy; if (p.vy < 0) p.vy = -p.vy; }
  else if (p.y > hh) { p.y = hh - Math.min(W.box.h, p.y - hh); p.vy = 2 * uh - p.vy; if (p.vy > 0) p.vy = -p.vy; }
}

/* 3-D: walls() for closed and open boxes, with the z faces (no moving walls: the box is resized in x and y only). */
function walls3(p) {
  const hw0 = W.box.w / 2, hh0 = W.box.h / 2, hd0 = W.box.d / 2;
  const out = (hw, hh, hd) => p.x < -hw || p.x > hw || p.y < -hh || p.y > hh || p.z < -hd || p.z > hd;
  if ((p.k === POS || p.anti) && W.wall === 'reflect' && out(hw0, hh0, hd0)) { annihilateAtWall(p); return; }
  if (W.wall === 'open') { if (out(hw0, hh0, hd0)) wallStop3(p, 'qOut'); return; } // (its energy counted as escaped, 1.23.2)
  if (W.wall === 'reflect' && out(hw0, hh0, hd0) && 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) > radThreshold(p.k !== NUC)) { wallStop3(p); return; } // (fast: stopped in the wall, 1.23.2)
  if (!p.fast) { // soft walls handle slow particles; only rescue deep escapees, handing back their potential energy
    const m = 1.5, rin = p.k === NUC ? wallIn(p) : 0, hw = hw0 - rin, hh = hh0 - rin, hd = hd0 - rin;
    if (!out(hw + m, hh + m, hd + m)) return;
    const one = p.k === NUC && _nmd ? new Set([p]) : null, k = wallK(p);
    const U0 = one ? localPE(one) : 0;
    let dW = 0;
    if (p.x < -hw - m) { const d = -hw - p.x; p.x = -hw; dW += 0.5 * k * d * d; p.vx = Math.abs(p.vx); } else if (p.x > hw + m) { const d = p.x - hw; p.x = hw; dW += 0.5 * k * d * d; p.vx = -Math.abs(p.vx); }
    if (p.y < -hh - m) { const d = -hh - p.y; p.y = -hh; dW += 0.5 * k * d * d; p.vy = Math.abs(p.vy); } else if (p.y > hh + m) { const d = p.y - hh; p.y = hh; dW += 0.5 * k * d * d; p.vy = -Math.abs(p.vy); }
    if (p.z < -hd - m) { const d = -hd - p.z; p.z = -hd; dW += 0.5 * k * d * d; p.vz = Math.abs(p.vz); } else if (p.z > hd + m) { const d = p.z - hd; p.z = hd; dW += 0.5 * k * d * d; p.vz = -Math.abs(p.vz); }
    if (one) { _crowd = null; placeClear([p], 8, p.bonds.map(bd => other(bd, p))); _crowd = null; }
    const dE = one ? U0 - localPE(one) : dW, ke = 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz), k1 = Math.max(0, ke + dE);
    if (ke > 0) { const f = Math.sqrt(k1 / ke); p.vx *= f; p.vy *= f; p.vz *= f; }
    _wallMoved = true;
    return;
  }
  const uw = W.box.uw || 0, uh = W.box.uh || 0, ud = W.box.ud || 0; // (a wall moving in as a piston: the bounce off it, 1.24)
  if (p.x < -hw0) { p.x = -hw0 + Math.min(W.box.w, -hw0 - p.x); p.vx = Math.abs(-2 * uw - p.vx); } else if (p.x > hw0) { p.x = hw0 - Math.min(W.box.w, p.x - hw0); p.vx = -Math.abs(2 * uw - p.vx); }
  if (p.y < -hh0) { p.y = -hh0 + Math.min(W.box.h, -hh0 - p.y); p.vy = Math.abs(-2 * uh - p.vy); } else if (p.y > hh0) { p.y = hh0 - Math.min(W.box.h, p.y - hh0); p.vy = -Math.abs(2 * uh - p.vy); }
  if (p.z < -hd0) { p.z = -hd0 + Math.min(W.box.d, -hd0 - p.z); p.vz = Math.abs(-2 * ud - p.vz); } else if (p.z > hd0) { p.z = hd0 - Math.min(W.box.d, p.z - hd0); p.vz = -Math.abs(2 * ud - p.vz); }
}
/* 3-D: what a closed box's wall stops, and what leaves through an open one (asked for by the owner, 1.23.2: "make sure
   that fast particles still leave the box in 3d"). The 3-D world has no radiation flight (its collision search is
   flat), so a fast particle stays in the stepped set; walls3 decides by speed what the flat walls decide by radiation
   flight (wallOrEscape): past radThreshold for its kind (2 keV for nuclei, 1 keV for electrons, more in a hot box), a
   charged particle reaching a closed wall is stopped in it and leaves the simulation (W.count.wallStop, its charge to
   the wall); a recoiling atom (Z ≥ 3 with electrons) is stopped and set back just inside at the wall's temperature.
   The energy books stay exact: the escaped energy is what the world loses, measured (its motion, its internal energy,
   and the potential energy of its whole molecule before and after, localPE; a free electron's from the field it sits
   in, as switchMode measures it). Before, walls3 bounced everything back but antimatter: a 1 MeV proton stayed in the
   box for ever, in steps a thousandth as long. */
function wallStop3(p, where) {
  const ke = 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz), nuc = p.k === NUC;
  const set = nuc ? setOf(molecule(p)) : null, U0 = nuc ? localPE(set) : p.fast ? 0 : p.q * phiE(p.x, p.y, p, undefined, p.z); // (a lepton in flight carries no potential energy in the books: bug fix 14 after 1.25)
  if (!where && nuc && p.ne > 0 && p.Z >= 3 && p.fast) { // (1.25: one in flight, as atoms fly in 3-D now: back into the stepped set at the wall's temperature, the books measured over its molecule as totalEnergy counts it, flight or not: regionE)
    const T = new Set(set), E0 = regionE(T), hw = W.box.w / 2 - 0.6, hh = W.box.h / 2 - 0.6, hd = W.box.d / 2 - 0.6;
    p.fast = false; if (S.inMD[p.i] === 0 && !_late.includes(p)) _late.push(p);
    p.x = clamp(p.x, -hw, hw); p.y = clamp(p.y, -hh, hh); p.z = clamp(p.z, -hd, hd);
    _crowd = null; placeClear([p], 8, p.bonds.map(bd => other(bd, p))); _crowd = null;
    const v = thermalV(p.m, W.T), into = (c, h, u) => (c >= h - 0.01 ? -Math.abs(u) : c <= -h + 0.01 ? Math.abs(u) : u);
    p.vx = into(p.x, hw, v[0]); p.vy = into(p.y, hh, v[1]); p.vz = into(p.z, hd, v[2]);
    W.ledger.escaped += E0 - regionE(T);
    _wallMoved = true;
    return;
  }
  if (!where && nuc && p.ne > 0 && p.Z >= 3) { // a recoiling atom: stopped within nanometres, back off the wall at its temperature
    const hw = W.box.w / 2 - 0.6, hh = W.box.h / 2 - 0.6, hd = W.box.d / 2 - 0.6;
    p.x = clamp(p.x, -hw, hw); p.y = clamp(p.y, -hh, hh); p.z = clamp(p.z, -hd, hd);
    _crowd = null; placeClear([p], 8, p.bonds.map(bd => other(bd, p))); _crowd = null;
    const v = thermalV(p.m, W.T), into = (c, h, u) => (c >= h - 0.01 ? -Math.abs(u) : c <= -h + 0.01 ? Math.abs(u) : u);
    p.vx = into(p.x, hw, v[0]); p.vy = into(p.y, hh, v[1]); p.vz = into(p.z, hd, v[2]);
    W.ledger.escaped += ke + U0 - 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz) - localPE(set);
    _wallMoved = true;
    return;
  }
  const I0 = internalE(p), partners = p.bonds.map(bd => other(bd, p));
  if (!where) W.count.wallStop++;
  chargeTo(p.q, where);
  kill(p); if (partners.length) relink(partners.filter(q => !q.dead));
  let U1 = 0; if (nuc) { const rest = new Set(); for (const q of set) if (!q.dead) rest.add(q); U1 = rest.size ? localPE(rest) : 0; }
  W.ledger.escaped += ke + I0 + U0 - U1;
}
/* A particle leaving through an open wall in the flat game: its energy (motion, potential energy with what stays,
   electrons' binding) goes to ledger.escaped, as wallStop3 books it in 3-D (bug fix after 1.25: it was removed
   unbooked, a water molecule taking about 2 keV of the books with it). */
function wallOut2(p) {
  const nuc = p.k === NUC, ke = 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy), set = nuc ? setOf(molecule(p)) : null;
  const U0 = nuc ? localPE(set) : p.fast ? 0 : p.q * phiE(p.x, p.y, p), I0 = internalE(p), partners = p.bonds.map(bd => other(bd, p));
  chargeTo(p.q, 'qOut');
  kill(p); if (partners.length) relink(partners.filter(q => !q.dead));
  let U1 = 0; if (nuc) { const rest = new Set(); for (const q of set) if (!q.dead) rest.add(q); U1 = rest.size ? localPE(rest) : 0; }
  W.ledger.escaped += ke + I0 + U0 - U1;
  _wallMoved = true; // (the forces it put on what stays are gone: the next step starts from forces without it)
}
/* (bug fix 14 after 1.25) Fast electrons and positrons in 3-D. They were all stepped, with ½mv² for their energy and v
   for their speed, so an MeV one moved at several times c (a 10 MeV electron 6c), in inner steps held at DT_MIN that
   carried it 4 Å past every nucleus, and the books slipped (−367 eV over 150 γ rays of 20 MeV into lead). Past LEP3_ON
   (25 keV, where ½mv² puts it at 0.3c) a lepton now leaves the stepped set (switchMode pays its potential energy, as for
   atoms in flight) and flies straight at its relativistic speed, its kinetic energy still ½m|v|² of the stored v (so the
   books are as before); a magnetic field turns it at qB/γm; along its path it loses energy to the atoms' electrons as in
   the flat game's radiation flight (≈ n_e/β² for each, closest passes most; the electrons set free square to its path,
   exact: what it loses, they get). Below LEP3_OFF (20 keV) it is stepped again. Walls: leptonWall (a closed wall stops
   it, its energy escaped). */
const LEP3_ON = 25e3, LEP3_OFF = 20e3;
function moveFastLeptons3(Dt, id0) {
  const hasB = hasBfield(), DEAD = S.dead, RAD = S.rad, K = S.k, FAST = S.fast, ID = S.id, OBJ = S.obj;
  const hw = W.box.w / 2, hh = W.box.h / 2, hd = W.box.d / 2, Lmax = 0.45 * Math.min(W.box.w, W.box.h, W.box.d);
  for (let j = 0; j < W.parts.length; j++) {
    const si = partsSync()[j];
    if (DEAD[si] === 1 || RAD[si] === 1 || K[si] === NUC || FAST[si] === 0 || ID[si] >= id0) continue;
    const p = OBJ[si];
    let rem = Dt;
    for (let seg = 0; seg < 200 && rem > 1e-15 && !p.dead && p.fast; seg++) { // (segments of at most 45% of the box: walls and wrapping met one at a time)
      let v = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz); if (!(v > 0)) break;
      const K0 = 0.5 * p.m * v * v, g = 1 + K0 / (PHYS.MEC2 * 1e6), vr = PHYS.C * Math.sqrt(Math.max(0, 1 - 1 / (g * g))), sc = vr / v;
      const h = Math.min(rem, Lmax / vr); rem -= h;
      const x0 = p.x, y0 = p.y, z0 = p.z, B = hasB ? Bfield3(p.x, p.y, p.z) : 0;
      if (B) { gyrate3(p, B, h / g); p.x = x0 + (p.x - x0) * sc * g; p.y = y0 + (p.y - y0) * sc * g; p.z = z0 + (p.z - z0) * sc * g; } // (the arc of angle qB·t/γm, its length vr·t)
      else { p.x += p.vx * sc * h; p.y += p.vy * sc * h; p.z += p.vz * sc * h; }
      p.ox = x0; p.oy = y0; p.oz = z0;
      // energy given to the electrons of the atoms it passes
      v = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
      const ux = p.vx / v, uy = p.vy / v, uz = p.vz / v, beta2 = Math.max(1e-8, (vr / PHYS.C) ** 2);
      let Ke = K0;
      for (const [, tg, b] of segTargets3(x0, y0, z0, p.x, p.y, p.z, 1.0, (t) => t.k === NUC && t.Z > 0 && t.ne > 0 && !t.fast).slice()) {
        if (tg.dead || tg.ne <= 0) continue;
        const w = 1 / (1 + (b / 0.4) * (b / 0.4)), dE = Math.min(0.3 * Ke, 0.0047 * tg.ne / beta2 * w);
        if (dE < 0.01) continue;
        Ke -= dE;
        const ie = ionizationCost(tg), n = turn3(ux, uy, uz, Math.PI / 2);
        if (dE > ie && freeElectronCount() < MAX_FREE_E && W.parts.length < MAX_PARTS) { if (ejectElectron(tg, dE - ie, n[0], n[1], undefined, undefined, n[2])) W.count.ionize++; else dumpHeat(dE, tg, tg); }
        else { const vn = tg.vx * n[0] + tg.vy * n[1] + tg.vz * n[2], a = -vn + Math.sqrt(vn * vn + 2 * dE * tg.im); tg.vx += n[0] * a; tg.vy += n[1] * a; tg.vz += n[2] * a; updateFast(tg); }
        if (Ke <= 1) break;
      }
      if (Ke < K0) { const f = Math.sqrt(Math.max(0, Ke) / K0); p.vx *= f; p.vy *= f; p.vz *= f; }
      if (p.trk) extendTrack(p); else if (Ke > 2e3) startTrack(p);
      if (p.x < -hw || p.x > hw || p.y < -hh || p.y > hh || p.z < -hd || p.z > hd) { if (W.wall === 'wrap') walls(p); else leptonWall(p); }
      if (!p.dead) updateFast(p);
    }
  }
}
/* Periodic housekeeping: π-bond formation between adjacent radicals, field ionization, electron shedding. */
/* Counters that let the step skip whole-store loops with nothing to do, exactly:
   _trkN — at least as many particles carry a track as this (startTrack counts up; housekeeping recounts);
   _nr — neutrons and light counted in the last walls pass, valid while no particle was made (W.nextId), no flag changed
   (_flagGen) and no charge number changed (_zGen) since that pass began. */
let _skipOk = true, _skipHits = 0; // (the step's skipped passes: _skipOk false makes it run them always, for tests)
let _trkN = 0, _zGen = 0, _nrN = 1, _nrId = -1, _nrFlag = -1, _nrZ = -1;
function trkRecount() { let n = 0; for (const p of W.parts) if (p.trk) n++; _trkN = n; }
function housekeeping() {
  if (_trkN > 0) trkRecount(); // (none made since the last count: still none)
  if (bondsCanRise()) for (const bd of W.bonds.slice()) {
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
  coTriple();
  const E = Math.hypot(W.Ex, W.Ey);
  if (E > 0.3) {
    for (const p of W.parts) {
      if (p.dead || p.k !== NUC || p.ne === 0) continue;
      const ie = ionE(zChem(p), p.ne), Ec = ie * ie / (4 * PHYS.KE * Math.max(1, p.q + 1));
      if (E > Ec && rnd() < 0.2) {
        W.count.ionize++;
        ejectElectron(p, 0.5, -W.Ex / E, -W.Ey / E);
        log('em', `Field ionization: ${p.el.sym} stripped by ${E.toFixed(2)} V/Å (needs ${Ec.toFixed(2)} V/Å)`);
      }
    }
  }
  { const ps = W.parts, DEAD = S.dead, K = S.k, NE = S.ne, Z = S.Z;
    for (let j = 0; j < ps.length; j++) { const i = ps[j].i; if (DEAD[i] === 0 && K[i] === NUC && NE[i] > Z[i]) stabilize(ps[j]); } } // (as for…of: particles added meanwhile are visited too)
}
/* Whether any bond could rise in order now (both atoms with room, the pair fit for it): read only, so when none can,
   housekeeping's bond loop — which changes nothing until it finds one — is skipped. */
/* Carbon monoxide made in a fire comes out of the bonding rules as C=O, with two free valences on its carbon, as a
   radical. One of oxygen's lone pairs then makes a third bond, C⁻≡O⁺ (the real molecule: closed, and with almost no
   dipole once its formal charges are shared back), when that releases energy, as it does by about 2.8 eV (0.95). */
function coTriple() {
  for (const bd of W.bonds) {
    if (bd.order !== 2) continue;
    const C = bd.a.Z === 6 ? bd.a : bd.b, O = other(bd, C);
    if (C.Z !== 6 || O.Z !== 8 || C.bonds.length !== 1 || O.bonds.length !== 1 || C.q !== 0 || O.q !== 0 || C.anti || O.anti || C.fast || O.fast) continue;
    const set = setOf(molecule(C)), sn = snapshot(set), E0 = localPE(set) + internalE(C) + internalE(O);
    C.ne++; O.ne--; refresh(C); refresh(O); setOrder(bd, 3);
    if (bd.order !== 3 || C.q !== -1 || O.q !== 1) { restoreSnap(sn); continue; }
    const rel = E0 - (localPE(set) + internalE(C) + internalE(O));
    if (rel >= 0) dumpHeat(rel, C, O);
    else if (kickPair(C, O, rel) > rel + 1e-6) { restoreSnap(sn); continue; }
    W.count.react++;
    log('chem', `Carbon monoxide closes up: C=O → C≡O, its third bond made by one of oxygen’s lone pairs (${fmtE(Math.max(0, rel))} released)`);
  }
}
function bondsCanRise() {
  const CAP = S.cap, USED = S.used;
  for (const bd of W.bonds) {
    if (bd.order >= 3) continue;
    const a = bd.a, b = bd.b, ia = a.i, ib = b.i;
    if (CAP[ia] - USED[ia] > 0 && CAP[ib] - USED[ib] > 0 && covalentOK(a, b)) return true;
  }
  return false;
}

/* ---- Quantum nuclei (1.12, Settings → Experimental; path-integral molecular dynamics). Every atom is a ring of P
   beads (copies) joined by springs m·ω_P², ω_P = P·kT/ħ at the bath's temperature; each bead feels the force field at
   its own copy of the world, so the ring spreads as the quantum particle does: zero-point motion, tunnelling. The atom
   the game moves, draws and does chemistry with is the ring's centre (centroid), driven by the force averaged over the
   beads; the beads' offsets from it (PI.ox/oy, with velocities PI.vx/vy) move in the ring's normal modes: the springs
   exactly, the force field's pull on each mode, and a Langevin thermostat on each (PILE-L) at P·T, as ring-polymer
   sampling needs. The force field is worked out once per bead (piForces): P passes a step.
   Energy: the potential is the beads' average (piEnergy), plus the rings' internal energy (kinetic and springs, /P);
   what the rings' thermostat gives or takes is booked to the bath. Free electrons, bare nuclei and fast particles stay
   classical points. */
const PI_OMEGA = 1.5; // tu⁻¹: the frequency every ring's internal modes are given (their masses scaled to it; sampling is the same)
const PI = { rpc: true, fGen: 0, fresh: [], on: false, P: 0, n: 0, cap: 0, ox: null, oy: null, vx: null, vy: null, fx: null, fy: null, oz: null, vz: null, fz: null, id: null, list: new Int32Array(0), C: null, om: null, T: 300, bath: 0 }; // (oz, vz, fz: the beads' depth in 3-D, 1.24)
function piSet(P) {
  P = P === 8 || P === 16 || P === 32 ? P : 0; // (in 3-D too since 1.24: the beads carry z)
  if (P === PI.P) return;
  if (PI.on && PI.n && W.parts.length) { const e1 = piEnergy().total, e0 = totalEnergy0().total; W.ledger.bath += e1 - e0; PI.bath += e1 - e0; } // (the rings let go: their energy to the bath)
  PI.ox = PI.oy = PI.vx = PI.vy = PI.fx = PI.fy = PI.oz = PI.vz = PI.fz = PI.id = null; PIM.valid = false; PIM.vStale = false; PIM.qx = null;
  PI.P = P; PI.on = P > 0; PI.cap = 0; PI.n = 0;
  if (!P) return;
  const C = [], om = []; // the free ring's normal modes (orthonormal) and their frequencies over ω_P
  for (let j = 0; j < P; j++) {
    om.push(2 * Math.sin(j * Math.PI / P)); const row = new Float64Array(P);
    for (let k = 0; k < P; k++) row[k] = j === 0 ? Math.sqrt(1 / P) : j < P / 2 ? Math.sqrt(2 / P) * Math.cos(2 * Math.PI * j * k / P) : j === P / 2 ? Math.sqrt(1 / P) * (k % 2 ? -1 : 1) : Math.sqrt(2 / P) * Math.sin(2 * Math.PI * j * k / P);
    C.push(row);
  }
  PI.C = C; PI.om = om;
}
/* Which slots are rings this step (atoms and ions in MD), with their offsets kept by slot (zeroed for a new particle). */
function piList() {
  const P = PI.P;
  if (PI.cap >= S.size && PIM.valid) { // (nothing changed since the last list: the modes stay as they are)
    let same = true, n = 0; const L = PI.list;
    for (const p of W.parts) { if (p.dead || p.k !== NUC || p.Z === 0 || p.ne === 0 || p.fast || p.rad) continue; if (n >= PI.n || L[n] !== p.i || PI.id[p.i] !== p.id) { same = false; break; } n++; }
    if (same && n === PI.n) return;
  }
  piSyncV(); PIM.valid = false;
  if (PI.cap < S.size) {
    const cap = S.size, grow = (a) => { const b = new Float64Array(P * cap); if (a) for (let k = 0; k < P; k++) b.set(a.subarray(k * PI.cap, (k + 1) * PI.cap), k * cap); return b; };
    PI.ox = grow(PI.ox && PI.cap ? PI.ox : null); PI.oy = grow(PI.oy && PI.cap ? PI.oy : null); PI.vx = grow(PI.vx && PI.cap ? PI.vx : null); PI.vy = grow(PI.vy && PI.cap ? PI.vy : null);
    PI.fx = new Float64Array(P * cap); PI.fy = new Float64Array(P * cap);
    if (W.d3) { PI.oz = grow(PI.oz && PI.cap ? PI.oz : null); PI.vz = grow(PI.vz && PI.cap ? PI.vz : null); PI.fz = new Float64Array(P * cap); } // (3-D: the depth, 1.24)
    const id = new Int32Array(cap).fill(-1); if (PI.id && PI.cap) id.set(PI.id.subarray(0, PI.cap)); PI.id = id; PI.cap = cap;
  }
  // a ring that is gone (its atom dead, gone fast or bare, or its slot reused) takes its internal energy with it: to the bath
  if (PI.n) { const gone = new Set(); for (let a = 0; a < PI.n; a++) { const i = PI.list[a], p = S.obj[i]; if (!p || p.dead || p.id !== PI.id[i] || p.k !== NUC || p.Z === 0 || p.ne === 0 || p.fast || p.rad) gone.add(i); }
    if (gone.size) { const E = piRingE(gone); W.ledger.bath += E; PI.bath += E; for (const i of gone) { PI.id[i] = -1; for (let k = 0; k < P; k++) { PI.ox[k * PI.cap + i] = 0; PI.oy[k * PI.cap + i] = 0; PI.vx[k * PI.cap + i] = 0; PI.vy[k * PI.cap + i] = 0; if (PI.oz) { PI.oz[k * PI.cap + i] = 0; PI.vz[k * PI.cap + i] = 0; } } } } }
  const L = PI.list.length >= W.parts.length ? PI.list : (PI.list = new Int32Array(W.parts.length * 2 + 16)), cap = PI.cap;
  let n = 0;
  for (const p of W.parts) {
    if (p.dead || p.k !== NUC || p.Z === 0 || p.ne === 0 || p.fast || p.rad) continue;
    const i = p.i;
    if (PI.id[i] !== p.id) { PI.id[i] = p.id; for (let k = 0; k < P; k++) { PI.ox[k * cap + i] = 0; PI.oy[k * cap + i] = 0; PI.vx[k * cap + i] = 0; PI.vy[k * cap + i] = 0; if (PI.oz) { PI.oz[k * cap + i] = 0; PI.vz[k * cap + i] = 0; } } PI.fresh.push(i); }
    L[n++] = i;
  }
  PI.n = n;
}
function piShift(k, sign) { // move every ring's atom to its bead k (sign 1), or back exactly where it was (−1)
  const X = S.x, Y = S.y, L = PI.list, n = PI.n, base = k * PI.cap;
  if (sign > 0) {
    if (!PI.sx || PI.sx.length < n) { PI.sx = new Float64Array(n * 2 + 16); PI.sy = new Float64Array(n * 2 + 16); PI.sz = new Float64Array(n * 2 + 16); }
    for (let a = 0; a < n; a++) { const i = L[a]; PI.sx[a] = X[i]; PI.sy[a] = Y[i]; X[i] += PI.ox[base + i]; Y[i] += PI.oy[base + i]; }
    if (PI.oz) { const Zp = S.z; for (let a = 0; a < n; a++) { const i = L[a]; PI.sz[a] = Zp[i]; Zp[i] += PI.oz[base + i]; } } // (3-D, 1.24)
  } else { for (let a = 0; a < n; a++) { const i = L[a]; X[i] = PI.sx[a]; Y[i] = PI.sy[a]; } if (PI.oz) { const Zp = S.z; for (let a = 0; a < n; a++) Zp[L[a]] = PI.sz[a]; } }
}
/* Ring-polymer contraction (1.21, after Markland & Manolopoulos 2008): the force field split into the bonds' and angles'
   terms (stiff, short, where the quantum spread matters: worked out on every bead) and everything else (the pairs between
   atoms and molecules, fields, walls: smooth over a ring's 0.1 Å, worked out once, at the rings' centres). One full pass
   and P cheap ones a step instead of P full ones. Not with continuous bond orders or electrons as waves (their terms are
   not split this way: every bead gets the whole force field there). */
function piContract() { return PI.rpc && !BO.any && !WAVE.n; }
function piFast() { // the bonds' and angles' forces alone, into S.fx/S.fy (cleared first), at the positions now
  const hi = S.hi; S.fx.fill(0, 0, hi); S.fy.fill(0, 0, hi);
  if (W.d3) { // (3-D: the bonds, the 3-D angles, out-of-plane and torsion terms, 1.24)
    S.fz.fill(0, 0, hi); bondArrays(); angleCentres3();
    const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, bd = W.box.d, hw = bw / 2, hh = bh / 2, hd = bd / 2, CQ = candidateRoom(VL.np + BD.n);
    _kStiff = 0;
    if (wasm3Ready()) { wasmDesc(); wasmDesc3(); wasmForces3(0, 0, 0, BD.n, 0, AC.n, 0, AC3.nt, S.fx, S.fy, S.fz, CQ, wrap, bw, bh, bd, hw, hh, hd, W.step); }
    else { bondKernel3(0, BD.n, S.fx, S.fy, S.fz, CQ, 0, wrap, bw, bh, bd, hw, hh, hd); angleKernel3(0, AC.n, 0, AC3.nt, S.fx, S.fy, S.fz, wrap, bw, bh, bd); }
    if (AC3.ns) tors1Forces3(S.fx, S.fy, S.fz); // (the single bonds' twist, 1.25)
    if (_kStiff > _stiff) _stiff = _kStiff; _kStiff = 0;
    return;
  }
  bondArrays(); angleCentres();
  const wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2, CQ = candidateRoom(VL.np + BD.n);
  _kStiff = 0;
  if (wasmReady()) { wasmDesc(); wasmForces(0, 0, 0, BD.n, 0, AC.n, S.fx, S.fy, CQ, wrap, bw, bh, hw, hh, W.step); }
  else { bondKernel(0, BD.n, S.fx, S.fy, CQ, 0, wrap, bw, bh, hw, hh); angleKernel(0, AC.n, S.fx, S.fy, wrap, bw, bh, hw, hh); }
  if (_kStiff > _stiff) _stiff = _kStiff; _kStiff = 0;
}
function piFastE() { // their energy (as totalEnergy0 counts it)
  let e = 0;
  for (const bd of W.bonds) e += -bd.D - bd.Ef + morseV(bd, dist(bd.a, bd.b));
  for (const p of W.parts) if (!p.dead && !p.rad && !p.fast && !(p.k === NUC && p.Z === 0) && p.bonds.length >= 2) e += angleEnergy(p);
  return e;
}
const PIC = { cx: new Float64Array(0), cy: new Float64Array(0), gx: new Float64Array(0), gy: new Float64Array(0), fx: new Float64Array(0), fy: new Float64Array(0), mx: new Float64Array(0), my: new Float64Array(0), cz: new Float64Array(0), gz: new Float64Array(0), fz: new Float64Array(0), mz: new Float64Array(0) }; // (…z: 3-D, 1.24)
function piForcesC() {
  const P = PI.P, cap = PI.cap, L = PI.list, n = PI.n, FX = S.fx, FY = S.fy, GX = S.gx, GY = S.gy, hi = S.hi;
  if (PIC.cx.length < hi) for (const k of Object.keys(PIC)) PIC[k] = new Float64Array(2 * hi + 64);
  const C = PIC;
  if (_profOn) { const t0 = performance.now(); computeForces1(); _tForces += performance.now() - t0; _nPasses++; } else computeForces1(); // (the whole force field at the centres; its events too)
  const st = _stiff;
  for (let i = 0; i < hi; i++) { C.cx[i] = FX[i]; C.cy[i] = FY[i]; C.gx[i] = GX[i]; C.gy[i] = GY[i]; C.mx[i] = 0; C.my[i] = 0; }
  const d3 = !!PI.oz, FZ = S.fz, GZ = S.gz; // (3-D: the depth too, 1.24)
  if (d3) for (let i = 0; i < hi; i++) { C.cz[i] = FZ[i]; C.gz[i] = GZ[i]; C.mz[i] = 0; }
  piFast(); for (let i = 0; i < hi; i++) { C.fx[i] = FX[i]; C.fy[i] = FY[i]; } // (the split part at the centres, taken out below)
  if (d3) for (let i = 0; i < hi; i++) C.fz[i] = FZ[i];
  for (let k = 0; k < P; k++) {
    piShift(k, 1); piFast(); piShift(k, -1);
    for (let a = 0; a < n; a++) { const i = L[a], o = k * cap + i; PI.fx[o] = C.cx[i] - C.fx[i] + FX[i]; PI.fy[o] = C.cy[i] - C.fy[i] + FY[i]; C.mx[i] += FX[i]; C.my[i] += FY[i]; }
    if (d3) for (let a = 0; a < n; a++) { const i = L[a], o = k * cap + i; PI.fz[o] = C.cz[i] - C.fz[i] + FZ[i]; C.mz[i] += FZ[i]; }
  }
  for (let i = 0; i < hi; i++) { FX[i] = C.cx[i]; FY[i] = C.cy[i]; GX[i] = C.gx[i]; GY[i] = C.gy[i]; }
  for (let a = 0; a < n; a++) { const i = L[a]; FX[i] = C.cx[i] - C.fx[i] + C.mx[i] / P; FY[i] = C.cy[i] - C.fy[i] + C.my[i] / P; }
  if (d3) { for (let i = 0; i < hi; i++) { FZ[i] = C.cz[i]; GZ[i] = C.gz[i]; } for (let a = 0; a < n; a++) { const i = L[a]; FZ[i] = C.cz[i] - C.fz[i] + C.mz[i] / P; } }
  if (st > _stiff) _stiff = st;
  PI.fGen++;
}
function piForces() {
  if (piContract()) { vlReachSet(0); return piForcesC(); }
  vlReachSet(PI.oz ? PI_SKIN3 : 0); // (3-D: a list every bead's pass can use, bug fix 17 after 1.25)
  const P = PI.P, cap = PI.cap, L = PI.list, n = PI.n, FX = S.fx, FY = S.fy, GX = S.gx, GY = S.gy, hi = S.hi;
  const ax = new Float64Array(hi), ay = new Float64Array(hi), gx = new Float64Array(hi), gy = new Float64Array(hi), ev = _noEv;
  const d3 = !!PI.oz, FZ = S.fz, GZ = S.gz, az = d3 ? new Float64Array(hi) : null, gz = d3 ? new Float64Array(hi) : null; // (3-D, 1.24)
  for (let k = 0; k < P; k++) {
    piShift(k, 1);
    if (k > 0) _noEv = true; // (events from the first bead's pass only: they act on the centroids)
    if (_profOn) { const t0 = performance.now(); computeForces1(); _tForces += performance.now() - t0; _nPasses++; } else computeForces1();
    _noEv = ev;
    piShift(k, -1);
    for (let i = 0; i < hi; i++) { ax[i] += FX[i]; ay[i] += FY[i]; gx[i] += GX[i]; gy[i] += GY[i]; }
    for (let a = 0; a < n; a++) { const i = L[a]; PI.fx[k * cap + i] = FX[i]; PI.fy[k * cap + i] = FY[i]; }
    if (d3) { for (let i = 0; i < hi; i++) { az[i] += FZ[i]; gz[i] += GZ[i]; } for (let a = 0; a < n; a++) { const i = L[a]; PI.fz[k * cap + i] = FZ[i]; } }
  }
  for (let i = 0; i < hi; i++) { FX[i] = ax[i] / P; FY[i] = ay[i] / P; GX[i] = gx[i] / P; GY[i] = gy[i] / P; }
  if (d3) for (let i = 0; i < hi; i++) { FZ[i] = az[i] / P; GZ[i] = gz[i] / P; }
  PI.fGen++;
}
/* The rings' internal modes: a half step of thermostat and force, then (piOpen) the free springs over the step; after
   the force pass (piClose) the other half kick and thermostat. */
function piModes(fn) { // fn(i, m, qx, qy, vx, vy, qz, vz) on each ring's internal normal-mode coordinates (arrays over j ≥ 1), written back (qz, vz: 3-D, else null)
  piSyncV(); PIM.valid = false;
  const P = PI.P, cap = PI.cap, C = PI.C, L = PI.list, M = S.m, d3 = !!PI.oz;
  const qx = new Float64Array(P), qy = new Float64Array(P), wx = new Float64Array(P), wy = new Float64Array(P), qz = d3 ? new Float64Array(P) : null, wz = d3 ? new Float64Array(P) : null;
  for (let a = 0; a < PI.n; a++) {
    const i = L[a];
    for (let j = 1; j < P; j++) { let sx = 0, sy = 0, ux = 0, uy = 0; const c = C[j]; for (let k = 0; k < P; k++) { const o = k * cap + i; sx += c[k] * PI.ox[o]; sy += c[k] * PI.oy[o]; ux += c[k] * PI.vx[o]; uy += c[k] * PI.vy[o]; } qx[j] = sx; qy[j] = sy; wx[j] = ux; wy[j] = uy; }
    if (d3) for (let j = 1; j < P; j++) { let sz = 0, uz = 0; const c = C[j]; for (let k = 0; k < P; k++) { const o = k * cap + i; sz += c[k] * PI.oz[o]; uz += c[k] * PI.vz[o]; } qz[j] = sz; wz[j] = uz; }
    fn(i, M[i], qx, qy, wx, wy, qz, wz);
    for (let k = 0; k < P; k++) { let sx = 0, sy = 0, ux = 0, uy = 0; for (let j = 1; j < P; j++) { const c = C[j][k]; sx += c * qx[j]; sy += c * qy[j]; ux += c * wx[j]; uy += c * wy[j]; } const o = k * cap + i; PI.ox[o] = sx; PI.oy[o] = sy; PI.vx[o] = ux; PI.vy[o] = uy; }
    if (d3) for (let k = 0; k < P; k++) { let sz = 0, uz = 0; for (let j = 1; j < P; j++) { const c = C[j][k]; sz += c * qz[j]; uz += c * wz[j]; } const o = k * cap + i; PI.oz[o] = sz; PI.vz[o] = uz; }
  }
}
function piWP() { return PI.P * PHYS.KB * Math.max(PI.T, 1) / (6.582119569e-16 / PHYS.TU_S); }
function piMass(m, j, wP) { const w = PI.om[j] * wP; return w > PI_OMEGA ? m * (w / PI_OMEGA) * (w / PI_OMEGA) : m; } // (a mode faster than PI_OMEGA is made heavier, to oscillate at it; none lighter than the atom)
function piFreq(j, wP) { return Math.min(PI.om[j] * wP, PI_OMEGA); }
/* The modes over all rings at once (1.21: flat loops, mode-major, in place of a closure per atom; 3–4 times faster at 16
   beads): bead-space arrays (stride cap, slots L) to mode arrays (j·n + a, j ≥ 1) and back. */
/* The rings' state is kept in mode space between steps (PIM: positions and velocities by mode, valid while nothing else
   has touched the bead arrays); per step one transform of the forces in and one of the positions out (for the force
   pass and the drawing). The bead velocities are written back only when something reads them (piSyncV). */
const PIM = { valid: false, vStale: false, qx: null, qy: null, vx: null, vy: null, fx: null, fy: null, qz: null, vz: null, fz: null, fGen: -1 }; // (…z: 3-D, 1.24)
function piModeRoom() { const need = PI.P * PI.n, d3 = !!PI.oz; if (!PIM.qx || PIM.qx.length < need || (d3 && (!PIM.qz || PIM.qz.length < PIM.qx.length))) { const m = 2 * need + 64; for (const k of ['qx', 'qy', 'vx', 'vy', 'fx', 'fy'].concat(d3 ? ['qz', 'vz', 'fz'] : [])) PIM[k] = new Float64Array(m); PIM.valid = false; PIM.fGen = -1; } }
function piSyncV() { if (PIM.vStale && PIM.valid) { piFrom(PIM.vx, PIM.vy, PI.vx, PI.vy); if (PI.oz) piFrom(PIM.vz, null, PI.vz, null); } PIM.vStale = false; }
function piEnsure() {
  piModeRoom(); const d3 = !!PI.oz;
  if (!PIM.valid) { piTo(PI.ox, PI.oy, PIM.qx, PIM.qy); piTo(PI.vx, PI.vy, PIM.vx, PIM.vy); if (d3) { piTo(PI.oz, null, PIM.qz, null); piTo(PI.vz, null, PIM.vz, null); } PIM.valid = true; PIM.vStale = false; PIM.fGen = -1; }
  if (PIM.fGen !== PI.fGen) { piTo(PI.fx, PI.fy, PIM.fx, PIM.fy); if (d3) piTo(PI.fz, null, PIM.fz, null); PIM.fGen = PI.fGen; }
}
function piTo(sx, sy, dx, dy) { // (sy, dy null: one component, the depth, 1.24)
  const P = PI.P, cap = PI.cap, C = PI.C, L = PI.list, n = PI.n;
  if (!sy) { dx.fill(0, 0, P * n); for (let j = 1; j < P; j++) { const cj = C[j], b = j * n; for (let k = 0; k < P; k++) { const c = cj[k], o = k * cap; for (let a = 0; a < n; a++) dx[b + a] += c * sx[L[a] + o]; } } return; }
  dx.fill(0, 0, P * n); dy.fill(0, 0, P * n);
  for (let j = 1; j < P; j++) { const cj = C[j], b = j * n; for (let k = 0; k < P; k++) { const c = cj[k], o = k * cap; for (let a = 0; a < n; a++) { const i = L[a] + o; dx[b + a] += c * sx[i]; dy[b + a] += c * sy[i]; } } }
}
function piFrom(sx, sy, dx, dy) {
  const P = PI.P, cap = PI.cap, C = PI.C, L = PI.list, n = PI.n;
  if (!sy) { for (let k = 0; k < P; k++) { const o = k * cap; for (let a = 0; a < n; a++) dx[L[a] + o] = 0; for (let j = 1; j < P; j++) { const c = C[j][k], b = j * n; for (let a = 0; a < n; a++) dx[L[a] + o] += c * sx[b + a]; } } return; }
  for (let k = 0; k < P; k++) { const o = k * cap; for (let a = 0; a < n; a++) { dx[L[a] + o] = 0; dy[L[a] + o] = 0; } for (let j = 1; j < P; j++) { const c = C[j][k], b = j * n; for (let a = 0; a < n; a++) { const i = L[a] + o; dx[i] += c * sx[b + a]; dy[i] += c * sy[b + a]; } } }
}
function piKickTherm(h) { // half a step: the force field on each internal mode, and the thermostat
  const P = PI.P, n = PI.n, L = PI.list, M = S.m, wP = piWP(), kTP = P * PHYS.KB * Math.max(PI.T, 1), therm = W.gamma > 0;
  piEnsure(); const WX = PIM.vx, WY = PIM.vy, FX = PIM.fx, FY = PIM.fy, d3 = !!PI.oz, WZ = PIM.vz, FZ = PIM.fz; // (3-D, 1.24)
  let dK = 0;
  for (let j = 1; j < P; j++) {
    const w = PI.om[j] * wP, sc = w > PI_OMEGA ? (w / PI_OMEGA) * (w / PI_OMEGA) : 1, b = j * n; // (piMass's scale)
    const c1 = therm ? Math.exp(-h * 2 * piFreq(j, wP)) : 1, c2 = Math.sqrt(1 - c1 * c1);
    for (let a = 0; a < n; a++) {
      const mj = M[L[a]] * sc, u = b + a;
      let vx = WX[u] + h * FX[u] / mj, vy = WY[u] + h * FY[u] / mj;
      if (therm) { // (insulated: the rings' dynamics keep their energy)
        const sd = Math.sqrt(kTP / mj), k0 = vx * vx + vy * vy;
        vx = c1 * vx + c2 * sd * gauss(); vy = c1 * vy + c2 * sd * gauss();
        dK += 0.5 * mj * (vx * vx + vy * vy - k0);
      }
      WX[u] = vx; WY[u] = vy;
      if (d3) { let vz = WZ[u] + h * FZ[u] / mj; if (therm) { const sd = Math.sqrt(kTP / mj), k0 = vz * vz; vz = c1 * vz + c2 * sd * gauss(); dK += 0.5 * mj * (vz * vz - k0); } WZ[u] = vz; }
    }
  }
  PIM.vStale = true;
  PI.bath -= dK / P; W.ledger.bath -= dK / P; // (the rings' thermostat: what it gives is taken from the bath, as the heat bath's own exchanges are)
}
/* New rings (an atom just made, or the option just turned on) start spread as a free ring at the bath's temperature
   (each internal mode drawn from its own equilibrium); the energy that takes comes from the bath. */
function piSpread(slots) {
  const set = new Set(slots), e0 = piEnergy().total, P = PI.P, wP = piWP(), kTP = P * PHYS.KB * Math.max(PI.T, 1);
  piModes((i, m, qx, qy, wx, wy, qz, wz) => {
    if (!set.has(i)) return;
    for (let j = 1; j < P; j++) { const w = PI.om[j] * wP, sq = Math.sqrt(kTP / m) / w, sv = Math.sqrt(kTP / piMass(m, j, wP)); qx[j] = sq * gauss(); qy[j] = sq * gauss(); wx[j] = sv * gauss(); wy[j] = sv * gauss(); if (qz) { qz[j] = sq * gauss(); wz[j] = sv * gauss(); } }
  });
  const dE = piEnergy().total - e0; PI.bath -= dE; W.ledger.bath -= dE;
}
function piOpen(dt) {
  PI.fresh.length = 0; piList(); if (!PI.n) return;
  PI.T = W.T;
  if (PI.fresh.length) piSpread(PI.fresh.slice());
  piKickTherm(dt / 2);
  const wP = piWP(), P = PI.P, n = PI.n;
  piEnsure(); const QX = PIM.qx, QY = PIM.qy, VX = PIM.vx, VY = PIM.vy, d3 = !!PI.oz, QZ = PIM.qz, VZ = PIM.vz;
  for (let j = 1; j < P; j++) { // (each mode a free oscillator over the step)
    const w = piFreq(j, wP), c = Math.cos(w * dt), sn = Math.sin(w * dt), b = j * n;
    for (let a = 0; a < n; a++) { const u = b + a; let q = QX[u], v = VX[u]; QX[u] = q * c + v * sn / w; VX[u] = -q * w * sn + v * c; q = QY[u]; v = VY[u]; QY[u] = q * c + v * sn / w; VY[u] = -q * w * sn + v * c; }
    if (d3) for (let a = 0; a < n; a++) { const u = b + a, q = QZ[u], v = VZ[u]; QZ[u] = q * c + v * sn / w; VZ[u] = -q * w * sn + v * c; }
  }
  piFrom(QX, QY, PI.ox, PI.oy); if (d3) piFrom(QZ, null, PI.oz, null); PIM.vStale = true; // (the beads' positions for the force pass and the drawing)
}
function piClose(dt) { if (PI.n) piKickTherm(dt / 2); }
/* The rings' internal energy (kinetic in the modes' masses, and the springs), /P; of the slots in only, if given. */
function piRingE(only) {
  const P = PI.P, wP = piWP(); let E = 0;
  piModes((i, m, qx, qy, wx, wy, qz, wz) => { if (only && !only.has(i)) return; for (let j = 1; j < P; j++) { const w = PI.om[j] * wP; E += 0.5 * piMass(m, j, wP) * (wx[j] * wx[j] + wy[j] * wy[j]) + 0.5 * m * w * w * (qx[j] * qx[j] + qy[j] * qy[j]); if (qz) E += 0.5 * piMass(m, j, wP) * wz[j] * wz[j] + 0.5 * m * w * w * qz[j] * qz[j]; } }); // (qz, wz: 3-D)
  return E / P;
}
/* The energy with rings: the potential averaged over the beads, and the rings' internal kinetic and spring energy /P. */
function piEnergy() {
  piList();
  const P = PI.P; let pe = 0, base = null;
  if (piContract()) { // (contracted: the whole at the centres, the split part averaged over the beads in place of the centres')
    base = totalEnergy0(); let fm = 0;
    for (let k = 0; k < P; k++) { piShift(k, 1); fm += piFastE() / P; piShift(k, -1); }
    pe = base.pe - piFastE() + fm;
  } else for (let k = 0; k < P; k++) { piShift(k, 1); const e = totalEnergy0(); piShift(k, -1); pe += e.pe / P; if (!k) base = e; }
  const ring = piRingE(null);
  const internal = base.internal + ring;
  return { ke: base.ke, pe, internal, ring, esc: base.esc, total: base.ke + pe + internal + base.esc };
}
/* ---- Charges that respond to their surroundings (1.12, Settings → Experimental; a fluctuating-charge model of
   polarization, after electronegativity equalization / QEq). Each molecule's partial charges are its own (qpol + qf,
   from its bonds) plus an induced part qi that sums to zero over the molecule, so no charge moves between molecules.
   The induced charges cost a polarization energy ½·κ·Jᵢ·qiᵢ² each (Jᵢ the atom's hardness, its ionization energy
   less its electron affinity; κ fitted so that a water molecule's polarizability in the plane is the measured
   1.45 Å³), which is part of the potential energy (qeqSelf: in totalEnergy and localPE), and they lower the force
   field's own energy U as they follow the electric potential φᵢ = ∂U/∂qᵢ at each atom (worked out from the force
   field's pair energies, so every term the charges enter is included, and an applied field). Minimising
   ½κJq² + φ·q molecule by molecule with Σq = 0 gives qiᵢ = (λ − φᵢ)/(κJᵢ). The polarization energy depends on the
   charges only, so the forces are the force field's own for the charges of the moment.
   Every QEQ.every steps, between steps: φ, then the charges; the exact change of the potential energy (U and the
   polarization energy) at the atoms' positions is measured, the motion of the molecules that changed pays for it
   (velocities scaled about their centre of mass; the update is skipped if that cannot pay), and the forces are
   worked out again for the new charges. */
const QEQ = { every: 0, kappa: 0.54, maxMol: 64, maxQ: 0.6, n: 0, skipped: 0, dU: 0 };
/* Off again: every molecule back to its bonds' own charges, the change of the potential energy paid as an update's is. */
function qeqClear() {
  const atoms = W.parts.filter(p => !p.dead && p.qi);
  if (!atoms.length) return;
  const set = new Set(atoms), U0 = localPE(set);
  for (const p of atoms) { p.qi = 0; p.qp = p.qpol + p.qf; }
  const dU = localPE(set) - U0;
  let M0 = 0, Px = 0, Py = 0, Pz = 0; for (const p of atoms) { M0 += p.m; Px += p.m * p.vx; Py += p.m * p.vy; if (W.d3) Pz += p.m * p.vz; }
  const Vx = Px / M0, Vy = Py / M0, Vz = Pz / M0; let Kr = 0; for (const p of atoms) Kr += W.d3 ? 0.5 * p.m * ((p.vx - Vx) ** 2 + (p.vy - Vy) ** 2 + (p.vz - Vz) ** 2) : 0.5 * p.m * ((p.vx - Vx) ** 2 + (p.vy - Vy) ** 2); // (3-D: the depth too, 1.24)
  if (Kr > dU) { const f = Math.sqrt((Kr - dU) / Kr); for (const p of atoms) { p.vx = Vx + f * (p.vx - Vx); p.vy = Vy + f * (p.vy - Vy); if (W.d3) p.vz = Vz + f * (p.vz - Vz); } } else W.ledger.bath -= dU; // (a box too cold to pay: the books note it)
  _noEv = true; computeForces(); _noEv = false;
}
function qeqHard(p) { const e = p.el; return Math.max(3, (e && e.ie1 ? e.ie1 : 10) - (e && e.ea ? e.ea : 0)); }
function qeqSelf(p) { return p.qi ? 0.5 * QEQ.kappa * qeqHard(p) * p.qi * p.qi : 0; }
/* How the force field's energy of a pair depends on the two charges: every term the partial charges enter is
   c·qa·qb (nucPairV: soft Coulomb shifted to zero at the cutoff, weighted by iwK; a bare nucleus's smeared charge; the
   exact 1/r between net charges beyond the cutoff), so c is the pair's energy per product of charges. */
function qeqC(p, o, r2) {
  const K = PHYS.KE;
  if (opp(p, o)) { const sf = p.ne > 0 && o.ne > 0 ? 0.09 : (p.ne === 0 && o.ne === 0) ? 0.0016 : 0.04; return K * (1 / Math.sqrt(r2 + sf) - csh(p, o, sf)); }
  if (p.ne > 0 && o.ne > 0) return iwK(p, o) * K * (1 / Math.sqrt(r2 + 0.09) - csh(p, o, 0.09));
  if (p.ne === 0 && o.ne === 0) return K * (1 / Math.sqrt(r2 + 0.0016) - csh(p, o, 0.0016));
  return K * (smearV(Math.sqrt(r2)) - cshPt(p, o));
}
const QB = { mark: shArray(Uint8Array, 16), phi: new Float64Array(0), pa: shArray(Int32Array, 1024), pb: shArray(Int32Array, 1024), pc: shArray(Float64Array, 1024), q0: shArray(Float64Array, 1024), useWasm: true, t: null, p: null, calls: 0 }; // (in the module's memory: af_qeq finds the list's pairs, 1.26)
/* qeqUpdate's pairs from the neighbour list in the module (af_qeq, kernel/src/qeq.rs, 1.26): the same tests, the same
   coefficients (qeqC: square roots and divisions, equal to the bit) in the same order, into QB.pa … QB.q0. The number of
   pairs, or -1 when it cannot (no module; an array not in its memory; an atom with more exclusions than the lists hold),
   and the JavaScript loop runs. The exclusions are the atoms' own (excl), from exclLists' arrays. */
function qeqPairsWasm() {
  if (!wasmReady() || typeof WK.ex.af_qeq !== 'function') return -1;
  if (_exlTopo !== W.topo || _exlDirty !== W.dirty) exclLists();
  if (!_exlOk) return -1;
  const need = VL.np + 16;
  if (QB.pa.length < need) { QB.pa = shArray(Int32Array, need * 2); QB.pb = shArray(Int32Array, need * 2); QB.pc = shArray(Float64Array, need * 2); QB.q0 = shArray(Float64Array, need * 2); }
  if (!QB.t) { QB.t = wasmArray(Int32Array, 24); QB.p = wasmArray(Float64Array, 16); }
  if (!WK.on) return -1;
  const A = [VL.pi, VL.pj, QB.mark, S.k, S.Z, S.dead, S.fast, S.rad, S.mol, S.id, S.x, S.y, S.z, S.q, S.qp, S.ne, S.anti, S.ionic, _exl, _exlN, QB.pa, QB.pb, QB.pc, QB.q0];
  if (!wasmIn(...A)) return -1;
  const T = QB.t, P = QB.p; for (let k = 0; k < 24; k++) T[k] = A[k].byteOffset;
  P[0] = VL.np; P[1] = W.wall === 'wrap' ? 1 : 0; P[2] = W.box.w; P[3] = W.box.h; P[4] = W.box.d; P[5] = W.d3 ? 1 : 0; P[6] = _lrOn ? 1 : 0; P[7] = RC; P[8] = RC2; P[9] = PHYS.KE; P[10] = K_IW; P[11] = BARE_SMEAR; P[12] = EXW; P[13] = QB.pa.length;
  WK.ex.af_qeq(T.byteOffset, P.byteOffset);
  if (P[14] > QB.pa.length) return -1; // (cannot happen: at most one a pair of the list)
  QB.calls++;
  return P[14];
}
function qeqUpdate() {
  const mols = new Map(); // molecule id → its atoms (every atom bonded, an ordinary atom in MD)
  for (const p of W.parts) {
    if (p.dead || p.k !== NUC || p.Z === 0 || p.ne === 0 || p.fast || p.rad || !p.bonds.length || p.anti) continue;
    let m = mols.get(p.mol); if (!m) mols.set(p.mol, m = []); m.push(p);
  }
  const list = []; for (const m of mols.values()) if (m.length >= 2 && m.length <= QEQ.maxMol) list.push(m);
  if (!list.length) return;
  if (QB.mark.length < S.size) { QB.mark = shArray(Uint8Array, S.size * 2); QB.phi = new Float64Array(S.size * 2); }
  const mark = QB.mark, phi = QB.phi, Ex = W.Ex || 0, Ey = W.Ey || 0, X = S.x, Y = S.y, Q = S.q, QP = S.qp, OBJ = S.obj, d3 = W.d3, Zp = S.z, Ez = d3 ? W.Ez || 0 : 0; // (3-D: in depth too, 1.24)
  let nIn = 0;
  for (const m of list) for (const p of m) { const i = p.i; mark[i] = 1; phi[i] = d3 ? -(Ex * X[i] + Ey * Y[i] + Ez * Zp[i]) : -(Ex * X[i] + Ey * Y[i]); nIn++; }
  // every pair with an atom of the set whose energy depends on its charges, once, with its coefficient (the pair's
  // energy is c·qa·qb): from the neighbour list (every pair within the cutoff is on it), and between net charges
  // beyond the cutoff
  let np = 0;
  const push = (a, b, c) => {
    if (np >= QB.pa.length) { const g = (T, o) => { const n = shArray(T, o.length * 2); n.set(o); return n; }; QB.pa = g(Int32Array, QB.pa); QB.pb = g(Int32Array, QB.pb); QB.pc = g(Float64Array, QB.pc); QB.q0 = g(Float64Array, QB.q0); }
    QB.pa[np] = a; QB.pb[np] = b; QB.pc[np] = c; QB.q0[np] = (Q[a] + QP[a]) * (Q[b] + QP[b]); np++;
  };
  const pi = VL.pi, pj = VL.pj, K = S.k, Zs = S.Z, DEAD = S.dead, FAST = S.fast, RAD = S.rad, MOL = S.mol, wrap = W.wall === 'wrap', bw = W.box.w, bh = W.box.h, hw = bw / 2, hh = bh / 2;
  if (QB.useWasm && (np = qeqPairsWasm()) >= 0) { /* (the list's pairs in the module: the same pairs, coefficients and order, 1.26) */ } else
  for (let k = (np = 0), n = VL.np; k < n; k++) {
    const i = pi[k], j = pj[k]; if (!mark[i] && !mark[j]) continue;
    if (K[i] !== NUC || K[j] !== NUC || Zs[i] === 0 || Zs[j] === 0 || DEAD[i] || DEAD[j] || FAST[i] || FAST[j] || RAD[i] || RAD[j]) continue;
    let dx = X[j] - X[i], dy = Y[j] - Y[i], dz = d3 ? Zp[j] - Zp[i] : 0;
    if (wrap) { if (dx > hw) dx -= bw; else if (dx < -hw) dx += bw; if (dy > hh) dy -= bh; else if (dy < -hh) dy += bh; if (d3) { const bd = W.box.d; if (dz > bd / 2) dz -= bd; else if (dz < -bd / 2) dz += bd; } }
    const r2 = d3 ? dx * dx + dy * dy + dz * dz : dx * dx + dy * dy; if (r2 >= RC2) continue;
    const a = OBJ[i], b = OBJ[j];
    if (MOL[i] !== 0 && MOL[i] === MOL[j] && a.excl && a.excl.has(b.id)) continue;
    const c = qeqC(a, b, r2); if (c) push(i, j, c);
  }
  if (_lrOn) for (const m of list) for (const p of m) if (isLR(p)) for (const o of _charged) {
    if (o === p || o.dead || o.fast || o.rad || !isLR(o) || (mark[o.i] && o.id < p.id)) continue;
    const dx = o.x - p.x, dy = o.y - p.y, dz = d3 ? o.z - p.z : 0, r2 = d3 ? dx * dx + dy * dy + dz * dz : dx * dx + dy * dy;
    if (r2 >= RC2) push(p.i, o.i, PHYS.KE / Math.sqrt(r2));
  }
  const PA = QB.pa, PB = QB.pb, PC = QB.pc, Q0 = QB.q0;
  let S0 = 0; for (const m of list) for (const p of m) S0 += qeqSelf(p);
  // φ = ∂U/∂q at each atom, from the charges as they are, plus the applied field's −E·r; then each molecule's charges
  for (let k = 0; k < np; k++) { const a = PA[k], b = PB[k], c = PC[k]; if (mark[a]) phi[a] += c * (Q[b] + QP[b]); if (mark[b]) phi[b] += c * (Q[a] + QP[a]); }
  const sE0 = SITES.any ? sitesQeq(mark, phi) : 0; // (off-atom charge sites, 1.26: their share of φ, and of the energy before)
  const old = new Float64Array(nIn); let o = 0;
  for (const m of list) {
    let sw = 0, sp = 0; for (const p of m) { old[o++] = p.qp; const w = 1 / (QEQ.kappa * qeqHard(p)); sw += w; sp += w * phi[p.i]; }
    const lam = sp / sw;
    let rest = 0; for (const p of m) { const qi = clamp((lam - phi[p.i]) / (QEQ.kappa * qeqHard(p)), -QEQ.maxQ, QEQ.maxQ); p.qi = qi; rest += qi; }
    for (const p of m) { if (rest) p.qi -= rest / m.length; QP[p.i] = p.qpol + p.qf + p.qi; } // (the clamp can leave a remainder)
  }
  for (const m of list) for (const p of m) mark[p.i] = 0;
  // the exact change of the potential energy: the pairs' Coulomb parts and the polarization energy
  let dU = -S0; for (const m of list) for (const p of m) dU += qeqSelf(p);
  for (let k = 0; k < np; k++) { const a = PA[k], b = PB[k]; dU += PC[k] * ((Q[a] + QP[a]) * (Q[b] + QP[b]) - Q0[k]); }
  if (SITES.any) dU += sitesQeqE() - sE0;
  // the molecules' own motion pays for it, about their centre of mass
  const VX = S.vx, VY = S.vy, VZ = S.vz, M = S.m;
  let M0 = 0, Px = 0, Py = 0, Pz = 0; for (const m of list) for (const p of m) { const i = p.i; M0 += M[i]; Px += M[i] * VX[i]; Py += M[i] * VY[i]; if (d3) Pz += M[i] * VZ[i]; }
  const Vx = Px / M0, Vy = Py / M0, Vz = Pz / M0; let Kr = 0; for (const m of list) for (const p of m) { const i = p.i; Kr += d3 ? 0.5 * M[i] * ((VX[i] - Vx) ** 2 + (VY[i] - Vy) ** 2 + (VZ[i] - Vz) ** 2) : 0.5 * M[i] * ((VX[i] - Vx) ** 2 + (VY[i] - Vy) ** 2); }
  if (!(Kr > 0) || dU > 0.5 * Kr) { o = 0; for (const m of list) for (const p of m) { QP[p.i] = old[o++]; p.qi = p.qp - p.qpol - p.qf; } QEQ.skipped++; return; }
  const f = Math.sqrt((Kr - dU) / Kr);
  for (const m of list) for (const p of m) { const i = p.i; VX[i] = Vx + f * (VX[i] - Vx); VY[i] = Vy + f * (VY[i] - Vy); if (d3) VZ[i] = Vz + f * (VZ[i] - Vz); }
  QEQ.n++; QEQ.dU += dU;
  _noEv = true; computeForces(); _noEv = false; // (the forces for the new charges)
}
/* Local temperature estimate per atom (for incandescence and Curie behaviour). */
function localTemps() {
  const PI = partsSync(), n = W.parts.length, DEAD = S.dead, K = S.k, M = S.m, VX = S.vx, VY = S.vy, VZ = S.vz, TL = S.tLocal, KB = W.d3 ? 1.5 * PHYS.KB : PHYS.KB; // (3-D: three directions' ½kT)
  const mags = W.magnets.length > 0, kT = KB * Math.max(W.T, 1);
  for (let j = 0; j < n; j++) {
    const i = PI[j];
    if (DEAD[i] === 1 || K[i] !== NUC) continue;
    const ke = 0.5 * M[i] * (VX[i] * VX[i] + VY[i] * VY[i] + VZ[i] * VZ[i]);
    const Tk = ke / KB, t = TL[i], t1 = t ? 0.9 * t + 0.1 * Tk : Tk;
    // (1.09: an atom crossing its Curie point beside a magnet changes its magnetic energy (ferromagnet ↔ paramagnet, up
    // to 0.65 eV at a 5,000 T pole); that change is paid by its own motion, or it waits. Unpaid, the insulated magnet
    // setup drifted 38–52 eV in 3,000 frames, every jump one such crossing)
    const fe = mags ? FERRO[S.Z[i]] : null;
    if (fe && (t < fe[0]) !== (t1 < fe[0]) && S.ne[i] > 0 && S.fast[i] === 0 && S.rad[i] === 0) {
      const p = S.obj[i], U0 = magU(p, kT); TL[i] = t1; const dU = magU(p, kT) - U0;
      if (dU > ke) { TL[i] = t; continue; }
      if (ke > 0) { const f = Math.sqrt((ke - dU) / ke); VX[i] *= f; VY[i] *= f; VZ[i] *= f; }
      continue;
    }
    TL[i] = t1;
  }
}

function forcesNoEvents() { _noEv = true; computeForces(); _noEv = false; }
/* All forces at the end of a step; free-electron events were already handled on the inner steps. */
function outerForces() { _lepEvOff = true; computeForces(); _lepEvOff = false; }
/* Did any particle change mode (MD, ballistic, radiation) since the force lists were made? */
function listsStale() { return _flagGen !== _flagGenForces; } // (a dead, fast or rad flag changed since the lists were made)
/* Where a step's time goes, summed while PROF.on (the Settings benchmark reads it): the force passes (and inside them the
   kernels' share and the wait for the worker threads), the heat bath, the integrator loops, and the rest. */
const PROF = { on: false, steps: 0, forces: 0, kernels: 0, wait: 0, bath: 0, integ: 0, total: 0, passes: 0, rp: new Float64Array(8), dt: 0, valid: 0 };
function profReset() { if (typeof thPhReset === 'function') thPhReset(); PROF.steps = 0; PROF.forces = 0; PROF.kernels = 0; PROF.wait = 0; PROF.bath = 0; PROF.integ = 0; PROF.total = 0; PROF.passes = 0; PROF.cls = 0; PROF.grid = 0; PROF.lists = 0; PROF.after = 0; PROF.rp = new Float64Array(8); PROF.dt = 0; PROF.valid = 0; }
function step(dt) {
  if (PROF.on) return stepProfiled(dt);
  return stepPlain(dt);
}
function stepProfiled(dt) {
  const t0 = performance.now(), f0 = _tForces, k0 = _tKernels, w0 = _tWait, b0 = _tBath, i0 = _tInteg, p0 = _nPasses, c0 = _tClass, g0 = _tGrid, l0 = _tLists, a0 = _tAfter;
  _profOn = true;
  const r = stepPlain(dt);
  _profOn = false;
  PROF.steps++; PROF.total += performance.now() - t0; PROF.forces += _tForces - f0; PROF.kernels += _tKernels - k0; PROF.wait += _tWait - w0; PROF.bath += _tBath - b0; PROF.integ += _tInteg - i0; PROF.passes += _nPasses - p0; PROF.cls += _tClass - c0; PROF.grid += _tGrid - g0; PROF.lists += _tLists - l0; PROF.after += _tAfter - a0;
  return r;
}
let _profOn = false, _tForces = 0, _tKernels = 0, _tWait = 0, _tBath = 0, _tInteg = 0, _nPasses = 0, _tClass = 0, _tGrid = 0, _tLists = 0, _tAfter = 0; // (class: the MD bookkeeping; grid; lists: validity, rebuilds, exclusions; after: everything in computeForces past the kernels)
// (the parts of a step outside forces, bath and integration, for the benchmark: start, outer forces, events, neutrons and light, walls and fast particles, exotics and sources, housekeeping, dropping the dead)
const RP_NAMES = ['start', 'outer', 'events', 'neutrons', 'walls', 'exotics', 'housekeeping', 'drop'];
let _rpT = 0;
function rpMark(k) { if (!_profOn) return; const t = performance.now(); PROF.rp[k] += t - _rpT; _rpT = t; }
function rpSkip() { if (_profOn) _rpT = performance.now(); }
/* A beam source fires from where it is drawn (0.67): a source set on or past the wall is moved just inside it, and is drawn
   as wide as its spread (render.js). */
function srcPos(src) { const hw = W.box.w / 2 - 0.5, hh = W.box.h / 2 - 0.5; return [clamp(src.x, -hw, hw), clamp(src.y, -hh, hh)]; }
/* In slow motion a source fires on the simulation's clock, so at 1/512 speed one that fires every second would wait eight
   minutes: while the simulation is slowed, it never waits longer, to the eye, than at its normal pace (and at least a
   quarter of a second), with at most 20 of its particles in flight at once. */
function srcSlowFire(src) {
  const base = W.baseSpf || W.simPerFrame;
  if (src.rtLast === undefined) { src.rtLast = W.rt; return; }
  if (!(W.simPerFrame < 0.9 * base) || !(src.rate > 0)) return;
  const gap = Math.max(0.25, 1 / (src.rate * base * 60));
  if (W.rt - src.rtLast < gap) return;
  let live = 0; for (const p of W.parts) if (p.srcRef === src && !p.dead) live++;
  if (live < 20) src.acc = 1;
}
function stepPlain(dt) {
  if (_profOn) _rpT = performance.now();
  W.step++; gridTouch(); // (positions move this step)
  bathFollow(dt);
  threadsPrewake();
  const id0 = W.nextId; // particles born during this step start flying in the next one
  if (W.d3) { const b = W.box; if (b.tw !== b.w || b.th !== b.h || (b.td > 0 && b.td !== b.d)) moveWalls3(dt); else { b.uw = 0; b.uh = 0; b.ud = 0; } } // (3-D: the depth too, 1.24)
  else if (W.box.tw !== W.box.w || W.box.th !== W.box.h) moveWalls(dt); else { W.box.uw = 0; W.box.uh = 0; }
  // particles added from outside, or switched between MD and ballistic flight at the end of the last step
  rpMark(0);
  const boCh = (BO.on || BO.any) && boSync(); // (continuous bond orders: who takes part, 1.13)
  const wvCh = (WAVE.on || WAVE.n) && waveSync(true); // (electrons as waves: who is a packet, 1.15)
  if (boCh || wvCh || W.fSpawn !== W.spawned || listsStale() || _wallMoved) { _noEv = true; computeForces(); _noEv = false; }
  _wallMoved = false;
  rpSkip();
  let tp = _profOn ? performance.now() : 0;
  if (PI.on) piOpen(dt); // (quantum nuclei: the rings' own motion, before the force pass at the new positions)
  if (W.d3 || !integrateA(dt)) { // (the threads take the plain case: no magnetic field, no free electrons; not in 3-D)
    outerA(dt);
    innerSteps(dt); // everything in MD drifts here; free electrons take their own short steps
  }
  if (_profOn) { const t = performance.now(); _tInteg += t - tp; _rpT = t; }
  const tf1 = _tForces;
  if (BO.any) boDqA(dt); // (continuous bond orders: the electron counts' opening half kick and drift, 1.20)
  outerForces();
  if (PI.on) piClose(dt);
  if (_profOn) PROF.rp[1] -= _tForces - tf1; // (the force pass itself is counted under forces)
  rpMark(1);
  if (_profOn) tp = performance.now();
  outerB(dt);
  if (BO.any) boDqB(dt);
  if (_profOn) { _tBath += performance.now() - tp; _rpT = performance.now(); }
  // the events the force pass found come after the closing kick (0.65), when every velocity belongs to the same moment
  // as the positions: a reaction or bond judged and paid half a kick early created or lost that half kick's work
  const st0 = W.spawned + W.topo + W.dirty - _undone;
  processEvents();
  rpMark(2);
  // events that moved atoms, changed bonds or species, or created particles: forces must be current (for the next opening kick)
  if (W.spawned + W.topo + W.dirty - _undone !== st0) { _noEv = true; computeForces(); _noEv = false; }
  W.fSpawn = W.spawned;
  if (_nFastLep > 0 || _flagGen !== _flagGenForces) { moveFastLeptons(dt, id0); _wallNeed = -1; } // (none were ballistic when the lists were made, and no flag has changed since)
  const kT = PHYS.KB * W.T, c1 = Math.exp(-W.gamma * dt), c2 = Math.sqrt(Math.max(0, 1 - c1 * c1));
  let nRad = 0;
  if (!_skipOk || _nrN > 0 || _nrId !== W.nextId || _nrFlag !== _flagGen || _nrZ !== _zGen) { // (no neutron and no light: nothing to move here)
    neutronPairs(dt, id0);
    const PI = partsSync(), n = W.parts.length, DEAD = S.dead, ID = S.id, K = S.k, Z = S.Z, RAD = S.rad, OBJ = S.obj, X = S.x, Y = S.y, OX = S.ox, OY = S.oy;
    for (let j = 0; j < n; j++) {
      const i = PI[j];
      if (DEAD[i] === 1 || ID[i] >= id0) continue;
      if (K[i] === NUC && Z[i] === 0) moveNeutron(OBJ[i], dt, c1, c2, kT);
      else if (RAD[i] === 1) { OX[i] = X[i]; OY[i] = Y[i]; moveRad(OBJ[i], dt); nRad++; }
    }
  }
  rpMark(3);
  const nXb = moveExos(dt, id0) || 0;
  if (nRad + nXb >= 2) beamCollisions(id0);
  if (W.collider) { rampRing(); if (W.step % 16 === 0) colliderRefill(); }
  // the walls pass, unless the bath pass found every particle an atom inside the box at an atom's pace (or a neutron or light,
  // none of which there are) and nothing has moved, been made or changed since: it would do nothing
  if (!_skipOk || !(_wallNeed === 0 && _trkN === 0 && _nrN === 0 && _nrId === W.nextId && _nrFlag === _flagGen && _nrZ === _zGen && !W.exo.length && !W.collider)) {
    const PI = partsSync(), DEAD = S.dead, K = S.k, Z = S.Z, RAD = S.rad, FAST = S.fast, BALL = S.ballistic, OBJ = S.obj, X = S.x, Y = S.y, VX = S.vx, VY = S.vy, M = S.m;
    const hw = W.box.w / 2, hh = W.box.h / 2, wrap = W.wall === 'wrap', d3 = W.d3, hd = W.box.d / 2, Zp = S.z;
    const id1 = W.nextId, fg1 = _flagGen, zg1 = _zGen; let nr = 0;
    for (let j = 0; j < W.parts.length; j++) { // (particles can be born within: the count is read each time)
      const i = PI[j];
      if (DEAD[i] === 1) continue;
      if (RAD[i] === 1) { nr++; continue; }
      const k = K[i];
      if (k === NUC && Z[i] === 0) { nr++; continue; }
      if (FAST[i] === 1) { if (BALL[i] === 1 && k !== NUC) continue; } // flew and collided in moveFastLeptons
      else if (k === NUC && !wrap) { // an atom inside the box, going at an atom's pace: walls and updateFast would do nothing
        const x = X[i], y = Y[i];
        if (x > -hw && x < hw && y > -hh && y < hh && (d3 ? VX[i] * VX[i] + VY[i] * VY[i] + S.vz[i] * S.vz[i] : VX[i] * VX[i] + VY[i] * VY[i]) <= V_FAST_ON * V_FAST_ON && (!d3 || (Zp[i] > -hd && Zp[i] < hd))) { // (3-D: the depth's speed too, 1.25)
          if (_trkN === 0 && _skipOk) continue; // (no particle has a track)
          const p = OBJ[i];
          if (p.trk) { extendTrack(p); if (!p.trkKeep && 0.5 * M[i] * (VX[i] * VX[i] + VY[i] * VY[i]) < 200) p.trk = null; }
          continue;
        }
      }
      const p = OBJ[i];
      if (FAST[i] === 1 && W.objs.length && objPath(p, p.ox, p.oy)) continue; // (placed objects: props.js)
      let met = false;
      if (d3 && !wrap && FAST[i] === 1 && k === NUC && (X[i] < -hw || X[i] > hw || Y[i] < -hh || Y[i] > hh || Zp[i] < -hd || Zp[i] > hd)) { met = true; fastEncounters(p); if (p.dead) continue; } // (3-D: leaving the box this step, it meets what lay on its way out before the wall takes it, as the flat radiation flight does, 1.26 bug fix)
      walls(p);
      updateFast(p);
      if (p.fast && !p.dead && !met) fastEncounters(p);
      if (p.trk && !p.rad) {
        extendTrack(p);
        if (!p.trkKeep && 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy) < 200) p.trk = null;
      }
    }
    _nrN = nr; _nrId = id1; _nrFlag = fg1; _nrZ = zg1;
  }
  rpMark(4);
  fastFastNuclear();
  for (const src of W.sources) {
    if (src.count !== undefined && src.count <= 0) continue; // a bunch, all injected
    src.acc += src.rate * dt;
    if (src.count === undefined && !src.beam && src.acc < 1) srcSlowFire(src);
    while (src.acc >= 1 && !(src.count <= 0)) {
      src.acc -= 1; src.rtLast = W.rt;
      if (src.count !== undefined) src.count--;
      // a little spread in where and which way (a real beam's emittance)
      const j = src.jitter || 0, ox = j ? (rnd() - 0.5) * j * -src.uy : 0, oy = j ? (rnd() - 0.5) * j * src.ux : 0, da = j ? (rnd() - 0.5) * 0.004 * j : 0;
      const ux = src.ux * Math.cos(da) - src.uy * Math.sin(da), uy = src.ux * Math.sin(da) + src.uy * Math.cos(da);
      const [sx, sy] = srcPos(src), p = fireSpec(src.spec, sx + ox, sy + oy, ux, uy, src.KE, !!src.beam);
      if (p) p.srcRef = src;
      if (p && src.beam && src.spec.kind === 'exo') xbMark(p); // (an unstable particle as a beam: hep.js, 1.15)
      if (p && src.count !== undefined && src.rate > 0) { // (a bunch's particles evenly spaced, each placed as far as it has come since it left, on the beam line even where the last one is close)
        const sp = p.rad ? bSpd(p) : Math.hypot(p.vx, p.vy), t = Math.min(src.acc / src.rate, 1.5 / Math.max(sp, 1e-9));
        p.x = sx + ox + ux * sp * t; p.y = sy + oy + uy * sp * t; p.ox = p.x; p.oy = p.y;
      }
      if (p) {
        p.beam = src.beam || true;
        if (src.kick) { p.injKick = src.kick; p.kickIn = false; } // (the kicker fires for it as it comes by)
        if (src.track && !p.trk) { startTrack(p); p.trkKeep = true; }
        if (p.xb) { p.trk.pts = [p.x, p.y]; p.trk.ts = [W.rt]; p.trk.tt = [W.t]; p.trk.beam = true; }
      }
    }
  }
  rpMark(5);
  if (W.step % 25 === 0) housekeeping();
  if (W.step % 10 === 0) localTemps();
  if (QEQ.every && W.step % QEQ.every === 0) qeqUpdate(); // (Experimental: charges that respond to their surroundings; in 3-D too since 1.24)
  { const y = dt - (W.tc || 0), t = W.t + y; W.tc = (t - W.t) - y; W.t = t; } // (compensated: a yoctosecond a frame is far below the last digit of a clock past 1,000 tu, 1.03)
  if (W.flights.length) landFlights();
  rpMark(6);
  // drop dead particles
  if (_nDead > 0 && (W.step % 4 === 0 || W.parts.length > 3000)) {
    _nDead = 0;
    let j = 0; const ps = W.parts, PI = partsSync(), DEAD = S.dead, n = ps.length;
    for (let i = 0; i < n; i++) { const si = PI[i]; if (DEAD[si] === 0) { if (j !== i) { PI[j] = si; ps[j] = ps[i]; } j++; } else freeSlot(ps[i]); }
    if (j !== n) { ps.length = j; _piN = j; }
  }
  rpMark(7);
  return dt;
}

/* Slow motion after a nuclear event. Its products (α particles, fragments, neutrons, β electrons) cross the
   box in a few femtoseconds, i.e. within one frame. Time eases down until the fastest of them moves about 2%
   of the box per frame, then eases back once they have left or slowed, at most ~3 s of real time later.
   Everything slows together; nothing is faked. */
function slowFactor() {
  if (!W.flights.length) return 1;
  return clamp(lightSlow(), 1e-9, 1); // (light in flight: its pace at 1×; the speed set, slow motion's included, scales it through simPerFrame, as it scales everything)
}
/* 1.14 (asked for by the user): slow motion is a speed. The hourglass (W.slowHold) and the automatic slow-down for nuclear
   events (W.slow) no longer hold time back behind the speed shown: each frame they set the speed itself, to the
   menu's speed nearest what they want (never above the speed chosen), so the readout always shows a speed from the menu. W.userSpf keeps the
   speed chosen by hand, which comes back when they let go; choosing a speed by hand (the menu, − and +) ends both.
   W.slowSet is the speed slow motion set (0 when none). The hourglass wants the fastest particle to cross about 2% of
   the box a frame at the setup's own speed (and never more than an eighth of it); the automatic kind the same, scaled by
   the speed chosen. Set slower than 1/512× by hand, neither acts (deepSlow). */
function speedLadderW() { // the menu's speeds, fastest first (ui.js speedLadder shows these): 16× … 1/512× in halvings, then decades of simulated time a second down to 1 ys
  const base = W.baseSpf || W.simPerFrame, L = [];
  for (let k = 4; k >= -9; k--) L.push(base * Math.pow(2, k));
  const r0 = base * Math.pow(2, -9) * PHYS.TU_S * 60;
  for (let e = Math.floor(Math.log10(r0 * 0.999)); e >= -24; e--) L.push(Math.pow(10, e) / (PHYS.TU_S * 60));
  return L;
}
function ladderNear(spf) { const L = speedLadderW(); let best = L[0], bd = Infinity; for (const v of L) { const d = Math.abs(Math.log(v / spf)); if (d < bd) { bd = d; best = v; } } return best; } // (the menu's speed nearest in ratio: within √2 down to 1/512×, within √10 among the decades below)
function slowSpeed(realDt) {
  if (W.slowSet && Math.abs(W.simPerFrame / W.slowSet - 1) > 1e-9) { W.slowSet = 0; W.slowHold = false; W.slow = null; W.hold = null; } // (a speed chosen meanwhile: it stays)
  if (!W.slowSet) W.userSpf = W.simPerFrame;
  const user = W.userSpf, base = W.baseSpf || user;
  let spf = user;
  if (user >= base / 512 * 0.99) {
    if (W.slowHold) spf = Math.min(user, base * holdFactor(realDt));
    const ev = eventSlow(realDt); if (ev < 1) spf = Math.min(spf, user * ev);
  } else { W.slowHold = false; W.slow = null; }
  const set = W.slowHold || spf < user * 0.999 ? Math.min(user, ladderNear(spf)) : user;
  W.slowSet = W.slowHold || set !== user ? set : 0;
  if (W.simPerFrame !== set) W.simPerFrame = set;
}
/* Slow motion on demand: time eases down until the fastest particles move about 2% of the box per frame (at the
   setup's normal speed; the speed buttons still scale it), and always to an eighth of normal at least. With slow
   motion for nuclear events off, what nuclear events send flying (and what it knocks loose) is left out. */
function speedNow(p) { // Å/tu, as it moves (3-D: with its depth, and a nucleus in flight at its true speed, 1.26 bug fix: slow motion looked at the speed in the plane, so a particle fired along the view, or a 1 PeV α at its stored 730c, was not slowed for)
  if (p.rad) return p.sp;
  if (!W.d3) return Math.hypot(p.vx, p.vy);
  const v2 = p.vx * p.vx + p.vy * p.vy + p.vz * p.vz, v = Math.sqrt(v2);
  if (!p.fast) return v;
  if (p.k === NUC) return v * flyScale3(v2);
  const g = 1 + 0.5 * p.m * v2 / (PHYS.MEC2 * 1e6); return Math.min(v, PHYS.C * Math.sqrt(Math.max(0, 1 - 1 / (g * g)))); // (a lepton in flight, as moveFastLeptons3 moves it)
}
function holdFactor(realDt) {
  let v = 0;
  const win = !W.slowmo && W.nucWin ? W.nucWin : null;
  for (const p of W.parts) {
    if (p.dead) continue;
    const sp = speedNow(p);
    if (p.nucProd && !p.rad && 0.5 * p.m * sp * sp < 10) p.nucProd = false; // (once it has slowed down it counts again)
    if (win && (p.nucProd || (!p.beam && p.born >= win.t0 && p.born <= win.t1))) continue;
    if (sp > v) v = sp;
  }
  if (!win) for (const o of W.exo) if (!o.dead) v = Math.max(v, o.v); // (unstable particles in flight count like anything else fast)
  for (const s of W.sources) { // what an injector is about to send in counts already
    if (s.count <= 0 || !(s.KE > 0)) continue;
    const k = s.spec.kind, m = k === 'gamma' ? 0 : k === 'e' || k === 'pos' ? PHYS.ME : k === 'exo' ? XP[s.spec.sp].m / PHYS.AMU_MEV : (s.spec.A || 1), g = m ? 1 + s.KE / (m * AMU_EV) : Infinity;
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
  const base = W.baseSpf || W.simPerFrame, slower = clamp(base / (W.userSpf || W.simPerFrame), 1, 64); // (slowed down further with the speed buttons: it lasts that much longer too, up to 64 times, 0.91)
  if (S.on && W.slowmo && age < 3 * slower) {
    let v = 0;
    for (const p of W.parts) {
      if (p.dead || p.born < S.t0 - 1e-9 || (p.k !== NUC && !p.rad)) continue; // stray slow electrons don't hold time up
      v = Math.max(v, speedNow(p)); // (3-D: with its depth and true speed, 1.26 bug fix)
    }
    for (const o of W.exo) if (!o.dead && o.born >= S.t0 - 1e-9) v = Math.max(v, o.v); // pions, kaons, muons in flight: near c, so a frame moves them 2% of the box too
    want = v > 0 ? clamp(0.02 * Math.min(W.box.w, W.box.h) / (v * base), 1 / 50000, 1) : 1; // (against the setup's normal speed, as the slow-motion button: the products cross about 2% of the box a frame at 1×, and the speed buttons scale that, 0.91; it was against the speed as set, which cancelled them out)
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
/* The simulation keeps to real time: W.simPerFrame is its time per sixtieth of a second, and a frame advances it by as
   many sixtieths as really passed (a 120 Hz screen shows the same motion in twice the frames; a slow frame catches up,
   by at most three sixtieths, so a stall is not followed by a burst). */
const FRAME_REF = 1 / 60;
/* Set slower than 1/512× of the setup's speed: the extreme slow motion (the speed buttons go on in decades of simulated
   time per second, down to 1 ys a second; ui.js stepSpeed). There each frame takes exactly the time set, automatic
   slow motion stays out, and resonances live their mean lives on the clock (hep.js moveExos). */
function deepSlow() { const s = W.slowSet ? W.userSpf : W.simPerFrame; return s < (W.baseSpf || W.simPerFrame) / 512 * 0.99; } // (the speed chosen: slow motion's own speeds can go lower, 1.14)
function simFrame(realDt, budgetMs) {
  const t0 = performance.now();
  let simAdv = 0, steps = 0, cut = false;
  slowSpeed(realDt); // (slow motion sets the speed: 1.14)
  let slow = slowFactor(realDt); const fr = clamp(realDt / FRAME_REF, 0.01, 3);
  if (deepSlow()) slow = 1; // (set slower than 1/512×: the pace is exactly what is set, a yoctosecond a second at the slowest; automatic slow motion stays out of it) // (the frame's share of a sixtieth: any frame rate up to 6,000 fps advances the same simulated time per second)
  let target = W.simPerFrame * slow * fr; const floor = deepSlow() && W.simPerFrame < DT_MIN ? 1e-18 : W.flights.length || slow < 0.999 || W.slowSet ? 1e-9 : DT_MIN; // (ultra-realistic, set below one shortest step: a step a frame, however short, down to a yoctosecond a second) // (with light in flight, or in slow motion, a frame may be shorter than the shortest normal step: slowed down that far, what is followed is still seen to slow; at a step a frame this costs nothing, 0.91)
  // set below one shortest step a frame (1/512× of a fine setup): the frames' time is saved up and run once it makes a
  // whole step, so the motion is as slow as asked and not one step a frame, whatever the fps. (Slow motion keeps its
  // floor of a step a frame: it follows fast particles, which must move every frame to be followed.)
  if (target < floor && slow >= 0.999 && !W.slowSet) { W._carry = (W._carry || 0) + target; if (W._carry < floor) target = 0; else { target = W._carry; W._carry = 0; } } else W._carry = 0;
  while (simAdv < target - Math.min(1e-9, 1e-3 * target)) {
    // particles added from outside (tools, setups): the step size must see their forces and contacts first
    if (W.fSpawn !== W.spawned) { forcesNoEvents(); W.fSpawn = W.spawned; }
    W.dt = Math.min(chooseDt(), Math.max(floor, target - simAdv)); // slow motion: never overshoot the frame
    simAdv += step(W.dt); steps++;
    if (W.slow && W.slow.fresh) { W.slow.fresh = false; break; } // an event just started slow motion: stop here
    if (performance.now() - t0 > budgetMs) { cut = true; break; }
  }
  W.rt += realDt;
  W.at = (W.at || 0) + realDt * clamp(simAdv / Math.max(1e-30, (W.baseSpf || W.simPerFrame) * fr), 0, 4); // (the pictures' clock: electrons circling in the particle view, quarks, chip carriers; it runs with the simulation, so slow motion slows them and a pause stops them, 0.96)
  { const ad = Math.min(realDt, 1 / 30); for (const g of W.strings || []) g.age = (g.age || 0) + ad; for (const g of W.qgp || []) g.age = (g.age || 0) + ad; } // (the pictures of strings breaking and of a plasma keep their own clock: a slow frame, as when thousands of hadrons appear at once, cannot skip them, 0.91)
  // chips keep the pace the simulation is set to, in real time, even when a crowded box makes the atoms (and the frames)
  // fall behind it: their time is warped anyway (a flash pulse takes 10 µs)
  if (W.chips.length) chipsTick((cut ? W.simPerFrame * slow * clamp(realDt * 60, 0.1, 6) : simAdv) * PHYS.TU_S, realDt); // (in proportion to the frame's length: at 144 or 240 fps a frame is a fraction of a sixtieth)
  if (W.glow && simAdv > 0) glowTick(realDt);
  const dtNuc = W.decayOn ? simAdv * PHYS.TU_S * W.warp : 0;
  W.tNuc += dtNuc;
  decayStep(dtNuc);
  if (_glowing) { _glowing = false; for (const p of W.parts) if (p.glow > 0) { p.glow = Math.max(0, p.glow - realDt * 2.5); if (p.glow > 0) _glowing = true; } }
  return { steps, simAdv, target, slow, fr };
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
    const k = 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
    if (p.k === NUC) { if (p.fast) { keF += k; nF++; } else { ke += k; n++; } atoms++; if (p.q > 0) ions++; }
    else { keE += k; nE++; }
  }
  if (nF > n) { ke += keF; n += nF; }
  const dof = W.d3 ? 1.5 : 1; // (½kT per direction: two in the flat world, three in 3-D)
  const T = n ? ke / (dof * n * PHYS.KB) : nE ? keE / (dof * nE * PHYS.KB) : 0;
  return { T, Te: nE ? keE / (dof * nE * PHYS.KB) : 0, n: n + nE, ionFrac: atoms ? ions / atoms : 0, freeE: W.nE, atoms };
}

/* ------------------------------------------------------------------ world construction helpers */
/* continuous bond orders (bo.js), asked of by the engine's force and energy passes */
const BO = { on: false, qm: false, any: false, pairs: [], np: 0, E: 0, cache: new Map(), Ztab: new Set([1, 5, 6, 7, 8, 9, 14, 15, 16, 17, 35, 53, 32, 33, 34, 50, 51, 52]), /* (Ge, As, Se, Sn, Sb, Te since 1.25) */ bath: 0, changes: 0 };
function clearWorld() {
  BO.np = 0; BO.any = false; BO.E = 0;
  dropParts(W.parts); W.parts.length = 0; _piParts = null; _farMetalSeen = false; _nDead = 0; _flagGen++; W.bonds.length = 0; W.evq.length = 0; W.rays.length = 0; W.flights.length = 0; W.chips.length = 0; W.mem = null; W.memOrder = null; W.tracks.length = 0; W.exo.length = 0; W.bathSeed = (Math.imul(W.bathSeed, 0x9E3779B1) + 0x7F4A7C15) >>> 0; // (a new world, a new noise stream; nothing drawn from rnd, so the worlds the tests seed are unchanged)
  W.flashes.length = 0; W.log.length = 0; W.magnets.length = 0; W.objs.length = 0; W.sources.length = 0; W.lasers.length = 0; W.zones.length = 0; W.collider = null; W.holdFrac = 0; W.nE = 0; W.t = 0; W.tNuc = 0; W.step = 0;
  W.events.length = 0; W.evRecent.length = 0; W.slow = null; W.slowSet = 0; WAVE.mem = []; WAVE.n = 0; W.nucWin = null; W.made = null; W.chain = null;
  W.grab = null; W.topo++;
  for (const k in W.count) W.count[k] = 0;
  for (const k in W.ledger) W.ledger[k] = 0;
  _Tb = 0; // (a new world: the bath it has followed is its own)
  W.d3 = false; W.box.d = 0; W.box.td = 0; W.box.ud = 0; W.Ez = 0; W.Bax3 = 'z'; // (a new world is flat; world3d makes it 3-D; Ez, Bax3: 3-D fields, 1.24)
  if (PI.cap) { PI.ox = PI.oy = PI.vx = PI.vy = PI.fx = PI.fy = PI.oz = PI.vz = PI.fz = PI.id = null; PI.cap = 0; PI.n = 0; PIM.valid = false; PIM.vStale = false; PIM.qx = null; PIM.qz = null; } // (quantum nuclei: a new world's rings are made afresh, flat or with depth, 1.24)
  W.hist = { t: [], T: [], ion: [], rad: [] }; W.spec = null; W.glow = false; W.glowAcc = 0; W.kc = null; W.ramp = null; W.cloud = false; W.pB = null; W.strings = []; W.qgp = []; W.muBound = []; W.lrKnown = false; W.muAtoms = []; W.at = W.at || 0;
  _rxCache.clear();
}
/* Make the (empty) world 3-D, depth d Å (by default as deep as it is high): positions from −d/2 to +d/2 in z, walls on
   the z faces too (periodic walls wrap z). Stage 1a: the engine only (Node; nothing draws it). The modes that are flat
   only were switched off here once; since 1.24 (quantum bonds, nuclei, waves, induced charges) and 1.25 (continuous
   bond orders) they all work in 3-D. */
function world3d(d) {
  W.d3 = true; W.box.d = W.box.td = d > 0 ? d : W.box.h; W.box.ud = 0; // (td: the depth the box-size slider wants, 1.24)
  VL.valid = false; FL.gen = -1; _mdGen++; _clsN = -1; gridTouch(); W.dirty++; W.fSpawn = -1;
}
function thermalV(m, T) { const s = Math.sqrt(PHYS.KB * T / m); return W.d3 ? [s * gauss(), s * gauss(), s * gauss()] : [s * gauss(), s * gauss()]; } // (3-D: a third draw, only there)
function addAtom(sym, x, y, opts = {}) {
  const Z = typeof sym === 'number' ? sym : SYM2Z[sym];
  const A = opts.A || COMMON_A[Z];
  const N = Math.max(0, A - Z);
  const ne = opts.bare ? 0 : opts.anti ? Z + (opts.charge || 0) : Z - (opts.charge || 0);
  const p = addNuc(Z, N, ne, x, y, 0, 0, !!opts.anti, opts.z || 0);
  const [vx, vy, vz] = thermalV(p.m, opts.T !== undefined ? opts.T : W.T);
  p.vx = vx; p.vy = vy; if (W.d3) p.vz = vz;
  updateFast(p);
  return p;
}
/* Tiny objects, and anything else as big (Claude's lattices, large built molecules), go down one at a time, as drawn. */
function molWhole(M) { return !!M && (M.cat === 'objects' || M.atoms.length > 90); }
/* Which library a molecule belongs to (1.23.2, asked for by the owner: "separate molecule libraries for 2-D and 3-D").
   The rule, from the library itself: every ordinary molecule (at most 36 atoms, all of them) is a flat drawing that the
   3-D lab lifts out of its plane and relaxes into its shape in space (place3), so it is in both; the tiny objects and
   anything over 90 atoms (molWhole) are flat builds, 2-D only; the 3-D tiny objects (stored with z) are 3-D only; a
   molecule of your own made for one mode (Ask Claude's 2-D / 3-D choice) is in that one only, and those kept before
   1.23.2, plain molecules, in both. */
function molFits(M, d3) {
  if (!M) return false;
  if (M.z) return !!d3;
  if (molWhole(M)) return !d3;
  if (M.mode === '2d') return !d3;
  if (M.mode === '3d') return !!d3;
  return true;
}
function addMolecule(key, x, y, rot = 0, T, z = 0) {
  const M = MOLECULES[key];
  if (!M) return [];
  const c = Math.cos(rot), s = Math.sin(rot);
  let cx = 0, cy = 0; for (const a of M.atoms) { cx += a[1]; cy += a[2]; } cx /= M.atoms.length; cy /= M.atoms.length;
  const in3 = !!(M.z && W.d3); let cz = 0; if (in3) { for (const v of M.z) cz += v; cz /= M.z.length; } // (a 3-D build, 1.23.2: its own depths)
  const atoms = M.atoms.map(([sym, ax, ay, q, A], i) => { // (A: the mass number of an isotope other than the usual one)
    const dx = ax - cx, dy = ay - cy;
    const p = addAtom(sym, x + dx * c - dy * s, y + dx * s + dy * c, { charge: q || 0, A: A || 0, T: 0, z: in3 ? z + M.z[i] - cz : z });
    return p;
  });
  for (const [i, j, o] of M.bonds) addBond(atoms[i], atoms[j], o);
  if (in3) { for (const p of atoms) { p.ox = p.x; p.oy = p.y; p.oz = p.z; } W.dirty++; } // (already relaxed in 3-D: put down as built)
  else if (W.d3) place3(atoms, x, y, z); // (3-D: tipped at random, jiggled out of its plane, and relaxed into its shape in space)
  // whole-molecule thermal motion
  let mt = 0; for (const a of atoms) mt += a.m;
  const [vx, vy, vz] = thermalV(mt, T !== undefined ? T : W.T);
  for (const a of atoms) { a.vx = vx; a.vy = vy; if (W.d3) a.vz = vz; }
  if (CHIP_LAYOUT[key]) chipAdd(key, atoms); // (a transistor, gate or memory cell is wired up: chips.js)
  return atoms;
}
/* ---- 3-D placement. The library's molecules are flat drawings. In a 3-D world a molecule is put down in its drawn
   shape, turned to a random orientation in space, every atom moved off the drawing's plane by up to ±0.15 Å (seeded),
   and relaxed by steepest descent on its own bonds and angles (relax3) into its shape in space (a cross-shaped CH₄
   into a tetrahedron), so that it starts near its minimum instead of springing apart from the drawing. */
function place3(atoms, x, y, z) {
  if (!atoms.length) return;
  // a random rotation (uniform: a random unit quaternion)
  const u1 = rnd(), u2 = rnd() * 2 * Math.PI, u3 = rnd() * 2 * Math.PI, a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  const qw = a * Math.sin(u2), qx = a * Math.cos(u2), qy = b * Math.sin(u3), qz = b * Math.cos(u3);
  const R = [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw),
    2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw),
    2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)];
  for (const p of atoms) {
    const dx = p.x - x, dy = p.y - y, dz = (p.z - z) + 0.3 * (rnd() - 0.5);
    p.x = x + R[0] * dx + R[1] * dy + R[2] * dz; p.y = y + R[3] * dx + R[4] * dy + R[5] * dz; p.z = z + R[6] * dx + R[7] * dy + R[8] * dz;
  }
  relax3(atoms, 400);
  for (const p of atoms) { p.ox = p.x; p.oy = p.y; p.oz = p.z; }
  W.dirty++;
}
/* Steepest descent of a group's own bond, angle and dihedral energy (nothing else is near it, or it is not in MD yet):
   each pass moves every atom along its force, by at most 0.05 Å, the step halved when the energy rises. */
let _rlx = null;
function relax3(atoms, passes) {
  const n = S.size;
  if (!_rlx || _rlx.fx.length < n) _rlx = { fx: new Float64Array(n), fy: new Float64Array(n), fz: new Float64Array(n) };
  const set = new Set(atoms), bonds = new Set(); for (const p of atoms) for (const bd of p.bonds) bonds.add(bd);
  const FX = _rlx.fx, FY = _rlx.fy, FZ = _rlx.fz;
  const energy = () => { let E = 0; for (const bd of bonds) E += morseV(bd, dist(bd.a, bd.b)); for (const p of atoms) E += angleEnergy3(p); return E; };
  const forces = () => {
    for (const p of atoms) { FX[p.i] = 0; FY[p.i] = 0; FZ[p.i] = 0; }
    for (const bd of bonds) {
      const v = vec3(bd.a.i, bd.b.i), r = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1e-6, d = r - bd.r0, e = Math.exp(-bd.al * Math.max(d, -0.6)), f = -2 * bd.D * bd.al * (1 - e) * e;
      const fx = f * v[0] / r, fy = f * v[1] / r, fz = f * v[2] / r, i = bd.a.i, j = bd.b.i;
      FX[j] += fx; FY[j] += fy; FZ[j] += fz; FX[i] -= fx; FY[i] -= fy; FZ[i] -= fz;
    }
    for (const p of atoms) {
      const nb = p.bonds.length; if (nb < 2 || nb > 6 || !p.el || p.el.dblock) continue;
      for (let k = 0; k < nb; k++) _nb3[k] = other(p.bonds[k], p).i;
      const t = angleTargets3(p, nb); angle3Centre(p.i, _nb3, nb, t[0], t[1], t[2], FX, FY, FZ);
      for (const bd of p.bonds) if (p.id < other(bd, p).id) torsionsOf3(bd, (X, A, B, Y) => { triple3(X.i, A.i, A.i, B.i, B.i, Y.i, K_TOR, FX, FY, FZ); });
      for (const bd of p.bonds) if (p.id < other(bd, p).id) tors1Of3(bd, (X, A, B, Y, k) => { kb3FromW(); tors1K(X.i, A.i, B.i, Y.i, k[0], k[1], k[2], k[3], FX, FY, FZ); }); // (1.25)
    }
  };
  let E = energy(), h = 0.02;
  for (let k = 0; k < passes && h > 1e-5; k++) {
    forces();
    let fm = 0; for (const p of atoms) { const i = p.i, f2 = FX[i] * FX[i] + FY[i] * FY[i] + FZ[i] * FZ[i]; if (f2 > fm) fm = f2; }
    fm = Math.sqrt(fm); if (fm < 1e-4) break;
    const sc = Math.min(h, 0.05 / fm), old = atoms.map(p => [p.x, p.y, p.z]);
    for (const p of atoms) { const i = p.i; if (set.has(p)) { p.x += sc * FX[i]; p.y += sc * FY[i]; p.z += sc * FZ[i]; } }
    const E1 = energy();
    if (E1 > E) { atoms.forEach((p, j) => { p.x = old[j][0]; p.y = old[j][1]; p.z = old[j][2]; }); h *= 0.5; } else { E = E1; h = Math.min(0.05, h * 1.2); }
  }
}
function spark(x, y, R, E, z = 0) { // (z: in a 3-D world)
  const ps = [];
  nearby(x, y, R, (p) => { if (p.k === NUC && !p.dead) ps.push(p); }, z);
  if (ps.length < 2) { flash(x, y, [255, 220, 120], R, 0.4, z); return; }
  const each = E / ps.length;
  if (each > 0.5 * radThreshold(false) && !W.d3) { // (3-D: flight in radiation mode is flat for now, so the pairs share it as below) // fast: the atoms pair off at random, each pair taking its share (an odd one out leaves its share to the last pair)
    for (let k = ps.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [ps[k], ps[j]] = [ps[j], ps[k]]; }
    const np = Math.floor(ps.length / 2);
    for (let k = 0; k < np; k++) sparkApart(ps[2 * k], ps[2 * k + 1], (k === np - 1 && ps.length % 2 ? 3 : 2) * each);
  } else for (let k = 0; k < ps.length; k++) {
    const a = ps[k], b = ps[(k + 1 + Math.floor(rnd() * (ps.length - 1))) % ps.length];
    kickPair(a, b, each);
  }
  flash(x, y, [255, 220, 120], R, 0.5, z);
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
function spawnSpec(spec, x, y, T, z = 0) { // (z: in a 3-D world)
  if (W.parts.length >= MAX_PARTS) return [];
  const temp = T === undefined ? W.T : T;
  switch (spec.kind) {
    case 'e': case 'pos': {
      const [vx, vy, vz] = thermalV(PHYS.ME_SIM, temp);
      return [addLepton(spec.kind === 'e' ? ELEC : POS, x, y, vx, vy, z, W.d3 ? vz : 0)];
    }
    case 'n': {
      const p = addNuc(0, 1, 0, x, y, 0, 0, false, z); const [vx, vy, vz] = thermalV(p.m, temp); p.vx = vx; p.vy = vy; if (W.d3) p.vz = vz;
      return [p];
    }
    case 'nuc': {
      const p = addNuc(spec.Z, spec.A - spec.Z, 0, x, y, 0, 0, false, z); const [vx, vy, vz] = thermalV(p.m, temp); p.vx = vx; p.vy = vy; if (W.d3) p.vz = vz; updateFast(p);
      return [p];
    }
    case 'atom': return [addAtom(spec.Z, x, y, { A: spec.A, charge: spec.charge || 0, bare: !!spec.bare, anti: !!spec.anti, T: temp, z })];
    case 'pbar': case 'nbar': { // an antiproton, or an antineutron (no charge: it annihilates on meeting a nucleus, or decays to p̄ e⁺ ν)
      const p = spec.kind === 'pbar' ? addNuc(1, 0, 0, x, y, 0, 0, true, z) : addNuc(0, 1, 0, x, y, 0, 0, true, z);
      const [vx, vy, vz] = thermalV(p.m, temp); p.vx = vx; p.vy = vy; if (W.d3) p.vz = vz; updateFast(p);
      return [p];
    }
    case 'mol': return addMolecule(spec.mol, x, y, molWhole(MOLECULES[spec.mol]) ? 0 : rnd() * Math.PI * 2, temp, z); // (tiny objects go down as drawn)
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
function crowdedAt(group, dx, dy, skip, dz = 0) { // (dz: a move in depth, 3-D)
  if (W.parts.length > 1200 && W.wall !== 'wrap') { // (periodic walls: the plain check, which wraps distances)
    const { cs, cells } = crowdGrid();
    for (const a of group) {
      if (a.dead || a.k !== NUC || a.Z === 0) continue;
      const ax = a.x + dx, ay = a.y + dy, ra = keepR(a), cx = Math.floor(ax / cs), cy = Math.floor(ay / cs), n = Math.ceil((ra + 2) / cs);
      for (let i = cx - n; i <= cx + n; i++) for (let j = cy - n; j <= cy + n; j++) {
        const c = cells.get(i * 65536 + j); if (!c) continue;
        for (const o of c) {
          if (o.dead || skip.has(o)) continue;
          const ex = o.x - ax, ey = o.y - ay, ez = o.z - a.z - dz, lim = ra + keepR(o);
          if (ex * ex + ey * ey + ez * ez < lim * lim) return true;
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
      const [ex, ey, ez] = minImg(o.x - ax, o.y - ay, o.z - a.z - dz), lim = ra + keepR(o);
      if (ex * ex + ey * ey + ez * ez < lim * lim) return true;
    }
  }
  return false;
}
/* Slide a freshly made group of particles to the nearest spot clear of everything else (golden-angle spiral
   out to maxR Å). Returns false, leaving it in place, if there is no room. */
function placeClear(group, maxR = 8, also = []) { // (also: particles it may sit on, e.g. its bond partners)
  const skip = new Set(group.concat(also));
  if (!crowdedAt(group, 0, 0, skip)) return true;
  if (W.d3) return placeClear3(group, maxR, skip);
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
/* (3-D) The same search through a ball: points spread evenly through it (a golden spiral over the sphere of directions,
   radii growing as the cube root, so the ball fills evenly), nearest first. */
function placeClear3(group, maxR, skip) {
  const hw = W.box.w / 2 - 0.4, hh = W.box.h / 2 - 0.4, hd = W.box.d / 2 - 0.4, wrap = W.wall === 'wrap', K = 1500;
  for (let k = 1; k <= K; k++) {
    const rr = maxR * Math.cbrt(k / K), ph = k * 2.39996, c = 1 - 2 * ((k * 0.6180339887) % 1), sn = Math.sqrt(Math.max(0, 1 - c * c));
    const dx = rr * sn * Math.cos(ph), dy = rr * sn * Math.sin(ph), dz = rr * c;
    if (!wrap && !group.every(a => Math.abs(a.x + dx) < hw && Math.abs(a.y + dy) < hh && Math.abs(a.z + dz) < hd)) continue;
    if (!crowdedAt(group, dx, dy, skip, dz)) {
      for (const a of group) { a.x += dx; a.y += dy; a.z += dz; a.ox = a.x; a.oy = a.y; a.oz = a.z; }
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
    if (W.d3) { const bd = W.box.d, hd = bd / 2; for (const a of group) { a.z = ((a.z + hd) % bd + bd) % bd - hd; a.oz = a.z; } }
    return;
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const a of group) { x0 = Math.min(x0, a.x); x1 = Math.max(x1, a.x); y0 = Math.min(y0, a.y); y1 = Math.max(y1, a.y); }
  const m = W.wall === 'open' ? 2 : 0.5, shift = (lo, hi, h) => (hi - lo > 2 * (h - m) ? -(lo + hi) / 2 : lo < -h + m ? -h + m - lo : hi > h - m ? h - m - hi : 0);
  const dx = shift(x0, x1, hw), dy = shift(y0, y1, hh);
  if (dx || dy) { for (const a of group) { a.x += dx; a.y += dy; a.ox += dx; a.oy += dy; } W.dirty++; }
  if (W.d3) { let z0 = Infinity, z1 = -Infinity; for (const a of group) { z0 = Math.min(z0, a.z); z1 = Math.max(z1, a.z); } const dz = shift(z0, z1, W.box.d / 2); if (dz) { for (const a of group) { a.z += dz; a.oz += dz; } W.dirty++; } }
}
/* Spawn inside the walls and keep clear; particles with no room are removed again. (free: a collider's injector,
   left where it is.) */
function spawnClear(spec, x, y, T, free, z = 0) {
  const ps = spawnSpec(spec, x, y, T, z);
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
function fireSpec(spec, x, y, ux, uy, KE, free, z = 0, uz = 0) { // (z, uz: 3-D)
  if (spec.kind === 'gamma') { if (W.d3) emitPhoton(x, y, KE, ux, uy, { z, uz }); else emitPhoton(x, y, KE, ux, uy); return null; } // (3-D: along its direction in depth, 1.24)
  if (spec.kind === 'nu') { emitNeutrino(x, y, KE, ux, uy, !!spec.anti, 'fired by hand', spec.fl || 'e', z, uz); return null; }
  if (spec.kind === 'exo' && spec.sp === 'Mu') return addMuonium(x, y, Math.max(1, KE), ux, uy, 1, z, uz); // (1.12: an atom, in MD; 3-D: in depth, 1.25)
  if (spec.kind === 'exo') return W.exo.length < MAX_EXO ? addExo(spec.sp, x, y, Math.max(1, KE), ux, uy, resPlaceMass(spec.sp), z, uz) : null; // (a muon, pion …: from outside, as any fired particle; 3-D: in depth, 1.24)
  const ps = spawnClear(spec, x, y, 0, free, z);
  if (!ps.length) return null;
  if (ps.length === 1) { setMotion(ps[0], KE, ux, uy, 0, 0, uz); if (!ps[0].trk && KE > 50) startTrack(ps[0]); return ps[0]; }
  let mt = 0; for (const a of ps) mt += a.m;
  const v = Math.sqrt(2 * KE / mt);
  for (const a of ps) { a.vx = v * ux; a.vy = v * uy; if (W.d3) a.vz = v * uz; updateFast(a); }
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
  for (const o of W.exo) { // (unstable particles and muonic hydrogen too: they live in W.exo, so the brush passed over them, 1.26 bug fix; as an erased atom, what it carried leaves with it)
    if (o.dead || o.xb) continue;
    const dx = o.x - x, dy = o.y - y;
    if (dx * dx + dy * dy < R2) { o.dead = true; o.fate = 'erased'; n++; }
  }
  return n;
}

/* ------------------------------------------------------------------ direct manipulation from the inspector */
/* These are external work done by the user (like a laser or an electron gun), so they don't conserve energy. */
function userIonize(p) {
  if (!p || p.dead || p.k !== NUC || p.ne <= 0) return false;
  const before = speciesLabel(p);
  p.ne--; refresh(p); enforceValence(p, null); relink([p]);
  const [ux, uy, uz] = rndDir(), off = (p.rd || 0.4) + 1.2;
  const e = addLepton(p.anti ? POS : ELEC, p.x + ux * off, p.y + uy * off, 0, 0, p.z + uz * off);
  setMotion(e, 1, ux, uy, p.vx, p.vy, uz, p.vz); e.hit = p.id;
  log('tool', `${p.anti ? 'Positron' : 'Electron'} removed: ${before} → ${speciesLabel(p)} + ${p.anti ? 'e⁺' : 'e⁻'}`);
  return true;
}
function userAddElectron(p) {
  if (!p || p.dead || p.k !== NUC || p.Z === 0 || p.ne >= zChem(p) + maxExtraElectrons(zChem(p))) return false;
  const before = speciesLabel(p);
  p.ne++; refresh(p); enforceValence(p, null); relink([p]);
  log('tool', `${p.anti ? 'Positron' : 'Electron'} added: ${before} + ${p.anti ? 'e⁺' : 'e⁻'} → ${speciesLabel(p)}`);
  return true;
}

/* ------------------------------------------------------------------ diagnostics */
/* Total energy using exactly the same potentials as the forces (for testing energy conservation). */
function totalEnergy() {
  if (PI.on && PI.n) return piEnergy();
  return totalEnergy0();
}
function totalEnergy0() {
  let ke = 0, pe = 0, internal = 0;
  const md = [];
  const kTm = PHYS.KB * Math.max(W.T, 1), mags = W.magnets.length > 0;
  for (const p of W.parts) {
    if (p.dead) continue;
    ke += p.rad ? p.KE : 0.5 * p.m * (p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
    internal += internalE(p);
    if (!(p.k === NUC && p.Z === 0) && !p.rad && !p.fast) { md.push(p); if (mags) pe += magU(p, kTm); if (p.qi) pe += qeqSelf(p); }
  }
  for (const o of W.exo) if (!o.dead) ke += o.KE; // unstable particles in flight (their rest mass is in the nuclear ledger)
  if (BO.any) ke += boDqKE(); // (continuous bond orders: the electron counts' motion, 1.20)
  const boE = BO.any ? boPass(false) : 0; // (continuous bond orders: first, as it sets the members' partial charges from where they are, 1.16)
  if (WAVE.n) pe += waveEnergy(); // (Experimental: electrons as waves)
  for (let i = 0; i < md.length; i++) for (let j = i + 1; j < md.length; j++) {
    const a = md[i], b = md[j];
    const [dx, dy, dz] = minImg(b.x - a.x, b.y - a.y, b.z - a.z), r2 = dx * dx + dy * dy + dz * dz, r = Math.sqrt(r2);
    if (a.k === NUC && b.k === NUC) {
      if (a.bom && b.bom) continue; // (continuous bond orders: below)
      if (MBO.on && mbEx(a, b)) continue; // (many-body metals and their O and H partners: below, 1.26)
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
      const a = ch[i], b = ch[j], r = hyp3(b.x - a.x, b.y - a.y, b.z - a.z);
      if (r < RC) continue;
      pe += PHYS.KE * qx(a, b) * qx(b, a) / r;
    }
  }
  for (const bd of W.bonds) pe += -bd.D - bd.Ef + morseV(bd, dist(bd.a, bd.b));
  for (const p of md) if (p.bonds.length >= 2) pe += angleEnergy(p);
  pe += boE;
  if (MBO.on) pe += mbPass(false); // (metals' many-body energy, 1.25)
  if (SITES.any) pe += sitesTotal(); // (off-atom charge sites, 1.26)
  if (W.wall === 'reflect' || W.objs.length) {
    for (const p of md) {
      if (p.k !== NUC) continue; // free electrons: hard walls
      if (W.wall === 'reflect') pe += wallPE(p);
      pe += objPE(p);
    }
  }
  return { ke, pe, internal, esc: W.ledger.escaped, total: ke + pe + internal + W.ledger.escaped };
}
wasmLoadModule(); // (the kernel module, now that its constants exist to be checked)
