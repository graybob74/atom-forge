//! Continuous bond orders (bo.js, Experimental): the orders' pass of 1.17 (boPass on flat arrays) in Rust.
//! The JavaScript keeps what needs its objects (the members, their capacities, the pair types' constants, the
//! potential from non-members and from beyond the cutoff); this does the rest, in the same order with the same
//! arithmetic, on arrays the JavaScript made in the module's memory (their byte offsets in a descriptor, `B_*`, and
//! the scalars in a f64 block, `P_*`). Three calls:
//!   af_bo_collect — the member pairs from the neighbour list (bfCollect's force-pass branch)
//!   af_bo_pass1   — everything boPass does up to the energy: raw orders, crowding, levels, orders, Morse terms,
//!                   angles, partial charges and the members' own Coulomb pairs (with forces: the angle forces too)
//!   af_bo_pass2   — after the JavaScript has added the non-members' potential: back through the orders to the forces
//! No statics, no allocation (scratch arrays come from the JavaScript, sized to the members).
use crate::fastmath;

pub const B_PR: usize = 0;
pub const B_PUX: usize = 1;
pub const B_PUY: usize = 2;
pub const B_PGR: usize = 3;
pub const B_PGN: usize = 4;
pub const B_PGCA: usize = 5;
pub const B_PGCB: usize = 6;
pub const B_PN: usize = 7;
pub const B_PNE: usize = 8;
pub const B_PNE0: usize = 9;
pub const B_PDNE: usize = 10;
pub const B_PDNE0: usize = 11;
pub const B_PCA: usize = 12;
pub const B_PCB: usize = 13;
pub const B_PDCA: usize = 14;
pub const B_PDCB: usize = 15;
pub const B_PSA: usize = 16;
pub const B_PTA: usize = 17;
pub const B_PSB: usize = 18;
pub const B_PTB: usize = 19;
pub const B_PQC: usize = 20;
pub const B_PQDH: usize = 21;
pub const B_PK: usize = 22;
pub const B_PCSH: usize = 23;
pub const B_PA: usize = 24;
pub const B_PB: usize = 25;
pub const B_PT: usize = 26;
pub const B_PSS: usize = 27;
pub const B_PSN: usize = 28;
pub const B_MEN: usize = 29;
pub const B_MCAP: usize = 30;
pub const B_MCAPH: usize = 31;
pub const B_MVAL: usize = 32;
pub const B_MLS: usize = 33;
pub const B_MLV: usize = 34;
pub const B_MGL: usize = 35;
pub const B_MKEEP: usize = 36;
pub const B_MQ: usize = 37;
pub const B_MPHI: usize = 38;
pub const B_MQN: usize = 39;
pub const B_MIM: usize = 40;
pub const B_MSLOT: usize = 41;
pub const B_MPER: usize = 42;
pub const B_MDB: usize = 43;
pub const B_MZ: usize = 44;
pub const B_MF0: usize = 45;
pub const B_MFC: usize = 46;
pub const B_MFL: usize = 47; // (the member counts its charge long-range: _lrOn && isLR)
pub const B_INC: usize = 48;
pub const B_TAB: usize = 49; // (the pair types' table, stride 16)
pub const B_TGT: usize = 50; // (the angle targets: 6 per key, key = ((nl·8 + lp)·8 + period)·2 + allH)
pub const B_SM: usize = 51; // (slot → member + 1)
pub const B_TZ: usize = 52; // (element pair → type)
pub const B_SUP1: usize = 53;
pub const B_SUP2: usize = 54;
pub const B_SUPS: usize = 55;
pub const B_MK: usize = 56;
pub const B_ST: usize = 57;
pub const B_CS: usize = 58;
pub const B_FS: usize = 59;
pub const B_STRONG: usize = 60;
pub const B_ZONE: usize = 61;
pub const B_ZW: usize = 62;
pub const B_ZD: usize = 63;
pub const B_LIST: usize = 64;
pub const B_T1: usize = 65;
pub const B_T2: usize = 66;
pub const B_TW: usize = 67;
pub const B_X: usize = 68;
pub const B_Y: usize = 69;
pub const B_Z: usize = 70; // (i16)
pub const B_Q: usize = 71;
pub const B_IONIC: usize = 72; // (u8)
pub const B_FX: usize = 73;
pub const B_FY: usize = 74;
pub const B_VPI: usize = 75;
pub const B_VPJ: usize = 76;
pub const B_PFA: usize = 77; // (1.19: dE/d(free valence) of each pair's two atoms)
pub const B_PFB: usize = 78;
pub const B_MLJR: usize = 79; // (the member's Lennard-Jones size and √depth, its element's)
pub const B_MLJS: usize = 80;
pub const B_MPOL: usize = 81; // (a hydrogen's polarity: its orders to N, O, F)
pub const B_MGW: usize = 82;
pub const B_MSN: usize = 83; // (the sum of its orders)
pub const B_MGF: usize = 84;
pub const B_MCL: usize = 85; // (its molecule, i32)
pub const B_MDCAP: usize = 86; // (1.20, moving charge: the slopes of capacity, expanded capacity, valence, internal energy in ν)
pub const B_MDCAPH: usize = 87;
pub const B_MDVAL: usize = 88;
pub const B_MDEI: usize = 89;
pub const B_MGQ: usize = 90; // (out: ∂E/∂ν)
pub const B_MGC: usize = 91;
pub const B_MGH: usize = 92;
pub const B_MGV: usize = 93;
pub const B_MGD: usize = 94;
pub const B_PZ: usize = 95; // (1.26, 3-D: S.z, the pairs' z directions BF.puz, S.fz, the 3-D angle targets, the single bonds' k's)
pub const B_PUZ: usize = 96;
pub const B_FZ: usize = 97;
pub const B_TGT3: usize = 98; // (vsepr3's [mode, θ₀, flat] for every key the 3-D angle term can ask, 3 per key)
pub const B_T1K: usize = 99; // (the single bonds' k's, 4 each: TOR1B's CC0 CC1 CC2, TOR1's CO CN OO, CC=C, CC=O)
pub const B_LEN: usize = 100;

// the scalars (a f64 block)
pub const P_N: usize = 0; // pairs (out of collect, in to the passes)
pub const P_NM: usize = 1;
pub const P_FORCES: usize = 2;
pub const P_WRAP: usize = 3;
pub const P_BW: usize = 4;
pub const P_BH: usize = 5;
pub const P_HW: usize = 6;
pub const P_HH: usize = 7;
pub const P_STIFF: usize = 8; // (in and out: the stiffest bond, 4·D·α²·Σ1/m)
pub const P_E: usize = 9;
pub const P_STATUS: usize = 10; // (0 fine; 1 the crowding list wants room for P_NS entries)
pub const P_PCAP: usize = 11;
pub const P_SUPCAP: usize = 12;
pub const P_VLNP: usize = 13;
pub const P_NS: usize = 14;
pub const P_R13: usize = 15; // (how far apart an angle's two ends can be: the 1-3 exclusions are looked for inside it; was 4.4 Å fixed, 1.25)
pub const P_D3: usize = 16; // (1.26: a 3-D world; its depth and half depth; sin⁶(109.47°) as the JavaScript has it)
pub const P_BD: usize = 17;
pub const P_HD: usize = 18;
pub const P_F0: usize = 19;
pub const P_LEN: usize = 24;

pub const BO_EPS: f64 = 0.03;
pub const BO_PLOW: f64 = 1.15;
pub const BO_WIN: f64 = 0.05;
pub const BO_TA: f64 = 0.15;
pub const BO_TB: f64 = 0.35;
pub const BO_SW: f64 = 0.5;
pub const BO_KH: f64 = 0.05;
pub const PARTIAL_K: f64 = 0.30;
const PS: usize = 16;

#[derive(Clone, Copy)]
pub struct Bo {
    pr: *mut f64, pux: *mut f64, puy: *mut f64, gr: *mut f64, gn: *mut f64, gca: *mut f64, gcb: *mut f64, pn: *mut f64, ne: *mut f64, ne0: *mut f64,
    dne: *mut f64, dne0: *mut f64, ca: *mut f64, cb: *mut f64, dca: *mut f64, dcb: *mut f64, sa: *mut f64, ta: *mut f64, sb: *mut f64, tb: *mut f64,
    qc: *mut f64, qdh: *mut f64, pk: *mut f64, pcsh: *mut f64,
    pa: *mut i32, pb: *mut i32, pt: *mut i32, pss: *mut i32, psn: *mut i32,
    men: *mut f64, mcap: *mut f64, mcaph: *mut f64, mval: *mut f64, mls: *mut f64, mlv: *mut f64, mgl: *mut f64, mkeep: *mut f64, mq: *mut f64, mphi: *mut f64, mqn: *mut f64, mim: *mut f64,
    mslot: *mut i32, mper: *mut i32, mdb: *mut i32, mz: *mut i32, f0: *mut i32, fc: *mut i32, mfl: *mut i32,
    inc: *mut i32, tab: *mut f64, tgt: *mut f64, sm: *mut i32, tz: *mut i32, sup1: *mut i32, sup2: *mut i32, sups: *mut f64, mk: *mut i32, st: *mut i32,
    cs: *mut f64, fs: *mut f64, strong: *mut i32, zone: *mut i32, zw: *mut f64, zd: *mut f64, list: *mut i32, t1: *mut i32, t2: *mut i32, tw: *mut f64,
    x: *mut f64, y: *mut f64, z: *mut i16, q: *mut f64, ionic: *mut u8, fx: *mut f64, fy: *mut f64, vpi: *mut i32, vpj: *mut i32,
    pfa: *mut f64, pfb: *mut f64, mljr: *mut f64, mljs: *mut f64, mpol: *mut f64, mgw: *mut f64, msn: *mut f64, mgf: *mut f64, mcl: *mut i32,
    mdcap: *mut f64, mdcaph: *mut f64, mdval: *mut f64, mdei: *mut f64, mgq: *mut f64, mgc: *mut f64, mgh: *mut f64, mgv: *mut f64, mgd: *mut f64,
    pz: *mut f64, puz: *mut f64, fz: *mut f64, tgt3: *mut f64, t1k: *mut f64,
}
#[inline(always)]
unsafe fn ptr<T>(base: usize, d: *const i32, k: usize) -> *mut T { (base + *d.add(k) as u32 as usize) as *mut T }
pub unsafe fn bo_desc(base: usize, d: *const i32) -> Bo {
    Bo {
        pr: ptr(base, d, B_PR), pux: ptr(base, d, B_PUX), puy: ptr(base, d, B_PUY), gr: ptr(base, d, B_PGR), gn: ptr(base, d, B_PGN), gca: ptr(base, d, B_PGCA), gcb: ptr(base, d, B_PGCB),
        pn: ptr(base, d, B_PN), ne: ptr(base, d, B_PNE), ne0: ptr(base, d, B_PNE0), dne: ptr(base, d, B_PDNE), dne0: ptr(base, d, B_PDNE0), ca: ptr(base, d, B_PCA), cb: ptr(base, d, B_PCB),
        dca: ptr(base, d, B_PDCA), dcb: ptr(base, d, B_PDCB), sa: ptr(base, d, B_PSA), ta: ptr(base, d, B_PTA), sb: ptr(base, d, B_PSB), tb: ptr(base, d, B_PTB), qc: ptr(base, d, B_PQC),
        qdh: ptr(base, d, B_PQDH), pk: ptr(base, d, B_PK), pcsh: ptr(base, d, B_PCSH),
        pa: ptr(base, d, B_PA), pb: ptr(base, d, B_PB), pt: ptr(base, d, B_PT), pss: ptr(base, d, B_PSS), psn: ptr(base, d, B_PSN),
        men: ptr(base, d, B_MEN), mcap: ptr(base, d, B_MCAP), mcaph: ptr(base, d, B_MCAPH), mval: ptr(base, d, B_MVAL), mls: ptr(base, d, B_MLS), mlv: ptr(base, d, B_MLV),
        mgl: ptr(base, d, B_MGL), mkeep: ptr(base, d, B_MKEEP), mq: ptr(base, d, B_MQ), mphi: ptr(base, d, B_MPHI), mqn: ptr(base, d, B_MQN), mim: ptr(base, d, B_MIM),
        mslot: ptr(base, d, B_MSLOT), mper: ptr(base, d, B_MPER), mdb: ptr(base, d, B_MDB), mz: ptr(base, d, B_MZ), f0: ptr(base, d, B_MF0), fc: ptr(base, d, B_MFC), mfl: ptr(base, d, B_MFL),
        inc: ptr(base, d, B_INC), tab: ptr(base, d, B_TAB), tgt: ptr(base, d, B_TGT), sm: ptr(base, d, B_SM), tz: ptr(base, d, B_TZ),
        sup1: ptr(base, d, B_SUP1), sup2: ptr(base, d, B_SUP2), sups: ptr(base, d, B_SUPS), mk: ptr(base, d, B_MK), st: ptr(base, d, B_ST),
        cs: ptr(base, d, B_CS), fs: ptr(base, d, B_FS), strong: ptr(base, d, B_STRONG), zone: ptr(base, d, B_ZONE), zw: ptr(base, d, B_ZW), zd: ptr(base, d, B_ZD), list: ptr(base, d, B_LIST),
        t1: ptr(base, d, B_T1), t2: ptr(base, d, B_T2), tw: ptr(base, d, B_TW),
        x: ptr(base, d, B_X), y: ptr(base, d, B_Y), z: ptr(base, d, B_Z), q: ptr(base, d, B_Q), ionic: ptr(base, d, B_IONIC), fx: ptr(base, d, B_FX), fy: ptr(base, d, B_FY),
        vpi: ptr(base, d, B_VPI), vpj: ptr(base, d, B_VPJ),
        pfa: ptr(base, d, B_PFA), pfb: ptr(base, d, B_PFB), mljr: ptr(base, d, B_MLJR), mljs: ptr(base, d, B_MLJS), mpol: ptr(base, d, B_MPOL), mgw: ptr(base, d, B_MGW),
        msn: ptr(base, d, B_MSN), mgf: ptr(base, d, B_MGF), mcl: ptr(base, d, B_MCL),
        mdcap: ptr(base, d, B_MDCAP), mdcaph: ptr(base, d, B_MDCAPH), mdval: ptr(base, d, B_MDVAL), mdei: ptr(base, d, B_MDEI), mgq: ptr(base, d, B_MGQ),
        mgc: ptr(base, d, B_MGC), mgh: ptr(base, d, B_MGH), mgv: ptr(base, d, B_MGV), mgd: ptr(base, d, B_MGD),
        pz: ptr(base, d, B_PZ), puz: ptr(base, d, B_PUZ), fz: ptr(base, d, B_FZ), tgt3: ptr(base, d, B_TGT3), t1k: ptr(base, d, B_T1K),
    }
}
#[inline(always)]
unsafe fn g<T: Copy>(p: *mut T, i: usize) -> T { *p.add(i) }
#[inline(always)]
unsafe fn s<T>(p: *mut T, i: usize, v: T) { *p.add(i) = v; }
#[inline(always)]
unsafe fn ad(p: *mut f64, i: usize, v: f64) { *p.add(i) += v; }

// ---- the smooth pieces (bo.js boSp … boBD) ----
#[inline(always)]
fn sp(x: f64) -> f64 { if x <= -BO_EPS { 0.0 } else if x >= BO_EPS { x } else { (x + BO_EPS) * (x + BO_EPS) / (4.0 * BO_EPS) } }
#[inline(always)]
fn sp_d(x: f64) -> f64 { if x <= -BO_EPS { 0.0 } else if x >= BO_EPS { 1.0 } else { (x + BO_EPS) / (2.0 * BO_EPS) } }
#[inline(always)]
fn hh(d: f64) -> f64 { if d < BO_EPS { 0.5 * d * (1.0 - d / BO_EPS) * (1.0 - d / BO_EPS) } else { 0.0 } }
#[inline(always)]
fn hh_d(d: f64) -> f64 { if d < BO_EPS { 0.5 * (1.0 - d / BO_EPS) * (1.0 - d / BO_EPS) - d * (1.0 - d / BO_EPS) / BO_EPS } else { 0.0 } }
#[inline(always)]
fn fade(c: f64) -> f64 { let t = if c <= 0.0 { 0.0 } else if c >= 2.0 * BO_EPS { 1.0 } else { c / (2.0 * BO_EPS) }; t * t * (3.0 - 2.0 * t) }
#[inline(always)]
fn fade_d(c: f64) -> f64 { if c <= 0.0 || c >= 2.0 * BO_EPS { return 0.0; } let t = c / (2.0 * BO_EPS); 6.0 * t * (1.0 - t) / (2.0 * BO_EPS) }
#[inline(always)]
fn bb(n: f64) -> f64 { if n <= 0.3 { return 0.0; } if n >= 0.7 { return 1.0; } let t = (n - 0.3) / 0.4; t * t * (3.0 - 2.0 * t) }
#[inline(always)]
fn bb_d(n: f64) -> f64 { if n <= 0.3 || n >= 0.7 { return 0.0; } let t = (n - 0.3) / 0.4; 6.0 * t * (1.0 - t) / 0.4 }
pub const BO_TAH: f64 = 0.04; // (1.20: a hydrogen's order to N, O, F starts lower)
pub const BO_TBH: f64 = 0.12;
pub const BO_X0: f64 = 0.1; // (1.20: the 1-2 and 1-3 exclusions from 0.1 to 0.9)
pub const BO_X1: f64 = 0.9;
pub const BO_SHV: f64 = 1.7; // (1.20: the shared proton's mixing, eV at an even split)
pub const BO_SHE: f64 = 0.05;
#[inline(always)]
fn bx(n: f64) -> f64 { if n <= BO_X0 { return 0.0; } if n >= BO_X1 { return 1.0; } let t = (n - BO_X0) / (BO_X1 - BO_X0); t * t * (3.0 - 2.0 * t) }
#[inline(always)]
fn bx_d(n: f64) -> f64 { if n <= BO_X0 || n >= BO_X1 { return 0.0; } let t = (n - BO_X0) / (BO_X1 - BO_X0); 6.0 * t * (1.0 - t) / (BO_X1 - BO_X0) }
pub const BO_LJ0: f64 = 0.02;
pub const BO_LJW: f64 = 0.3;
pub const BO_RHP: f64 = 1.2;
pub const BO_FV: f64 = 0.3;
#[inline(always)]
fn hf(f: f64) -> f64 { let t = f / BO_FV; if t <= 0.0 { 0.0 } else if t >= 1.0 { 1.0 } else { t * t * (3.0 - 2.0 * t) } }
#[inline(always)]
fn hf_d(f: f64) -> f64 { let t = f / BO_FV; if t <= 0.0 || t >= 1.0 { 0.0 } else { 6.0 * t * (1.0 - t) / BO_FV } }
#[inline(always)]
fn gg(n: f64) -> f64 { let t = (n - BO_LJ0) / BO_LJW; if t <= 0.0 { 0.0 } else if t >= 1.0 { 1.0 } else { t * t * (3.0 - 2.0 * t) } }
#[inline(always)]
fn gg_d(n: f64) -> f64 { let t = (n - BO_LJ0) / BO_LJW; if t <= 0.0 || t >= 1.0 { 0.0 } else { 6.0 * t * (1.0 - t) / BO_LJW } }
/// Lennard-Jones with the kernel's inner wall (straight inside cf·rm, its force held): (V, dV/dr, dV/drm)
#[inline(always)]
fn lj(r: f64, rm: f64, eps: f64, cf: f64, vcut: f64) -> (f64, f64, f64) {
    let c = cf * rm; let rr = if r < c { c } else { r }; let s2 = rm * rm / (rr * rr); let s6 = s2 * s2 * s2; let f0 = 12.0 * (s6 * s6 - s6) / rr;
    let v = eps * (s6 * s6 - 2.0 * s6 + vcut + if r < c { f0 * (c - r) } else { 0.0 });
    let m = if r >= c { 12.0 * eps * (s6 * s6 - s6) / rm } else { eps * f0 * r / rm };
    (v, -eps * f0, m)
}
#[inline(always)]
fn piece(dep: bool, k: i32, x: f64, v0: f64, v1: f64, v2: f64) -> (f64, f64) {
    match k {
        0 => if dep { if x <= 0.0 { (0.0, 0.0) } else { (v0 * x.powf(BO_PLOW), v0 * BO_PLOW * x.powf(BO_PLOW - 1.0)) } } else { (v0, 0.0) },
        1 => (v0 + (v1 - v0) * (x - 1.0), v1 - v0),
        2 => (v1 + (v2 - v1) * (x - 2.0), v2 - v1),
        _ => (v2, 0.0),
    }
}
fn curve(dep: bool, n: f64, v0: f64, v1: f64, v2: f64) -> (f64, f64) {
    let h = BO_KH;
    let k: i32 = if n < 1.0 - h { 0 } else if n < 1.0 + h { -1 } else if n < 2.0 - h { 1 } else if n < 2.0 + h { -2 } else if n < 3.0 - h { 2 } else if n < 3.0 + h { -3 } else { 3 };
    if k >= 0 { return piece(dep, k, n, v0, v1, v2); }
    let kk = -k; let t = (n - kk as f64 + h) / (2.0 * h);
    if t <= 0.0 { return piece(dep, kk - 1, n, v0, v1, v2); }
    if t >= 1.0 { return piece(dep, kk, n, v0, v1, v2); }
    let (a, as_) = piece(dep, kk - 1, n, v0, v1, v2); let (b, bs) = piece(dep, kk, n, v0, v1, v2);
    let w = t * t * (3.0 - 2.0 * t); let dw = 6.0 * t * (1.0 - t) / (2.0 * h);
    (a + w * (b - a), as_ + w * (bs - as_) + dw * (b - a))
}
fn qh(n: f64) -> (f64, f64) {
    let h = BO_KH;
    if n < 1.0 - h { return (n, 1.0); }
    if n > 1.0 + h { return (1.0 + 0.2 * (n - 1.0), 0.2); }
    let t = (n - 1.0 + h) / (2.0 * h);
    if t <= 0.0 { return (n, 1.0); }
    if t >= 1.0 { return (1.0 + 0.2 * (n - 1.0), 0.2); }
    let a = n; let b = 1.0 + 0.2 * (n - 1.0); let w = t * t * (3.0 - 2.0 * t); let dw = 6.0 * t * (1.0 - t) / (2.0 * h);
    (a + w * (b - a), 1.0 + w * (0.2 - 1.0) + dw * (b - a))
}

/// bfCollect's force-pass branch: the member pairs within the cutoff from the neighbour list. Returns the number of
/// pairs; past P_PCAP it only counts (the JavaScript makes room and asks again).
pub unsafe fn collect(b: &Bo, p: *mut f64) -> usize {
    let vlnp = g(p, P_VLNP) as usize; let pcap = g(p, P_PCAP) as usize;
    let wrap = g(p, P_WRAP) != 0.0; let bw = g(p, P_BW); let bh = g(p, P_BH); let hw = g(p, P_HW); let hh_ = g(p, P_HH);
    let d3 = g(p, P_D3) != 0.0; let bd = g(p, P_BD); let hd = g(p, P_HD); // (3-D, 1.26: the depth too, its direction in BF.puz)
    let c0 = 1.0 / (crate::RC2 + 0.09).sqrt(); let ke = crate::K_COUL;
    let mut n = 0usize;
    for k in 0..vlnp {
        let i = g(b.vpi, k) as usize; let j = g(b.vpj, k) as usize;
        let ma = g(b.sm, i) - 1; let mb = g(b.sm, j) - 1;
        if ma < 0 || mb < 0 { continue; }
        let mut dx = g(b.x, j) - g(b.x, i); let mut dy = g(b.y, j) - g(b.y, i); let mut dz = if d3 { g(b.pz, j) - g(b.pz, i) } else { 0.0 };
        if wrap { if dx > hw { dx -= bw; } else if dx < -hw { dx += bw; } if dy > hh_ { dy -= bh; } else if dy < -hh_ { dy += bh; } if d3 { if dz > hd { dz -= bd; } else if dz < -hd { dz += bd; } } }
        let r2 = if d3 { dx * dx + dy * dy + dz * dz } else { dx * dx + dy * dy };
        if !(r2 < crate::RC2 && r2 >= 1e-12) { continue; }
        if n < pcap {
            let r = r2.sqrt(); let za = g(b.z, i) as i32; let zb = g(b.z, j) as i32;
            if d3 { s(b.puz, n, dz / r); }
            let key = if za < zb { za * 128 + zb } else { zb * 128 + za };
            s(b.pa, n, ma); s(b.pb, n, mb); s(b.pr, n, r); s(b.pux, n, dx / r); s(b.puy, n, dy / r); s(b.pt, n, g(b.tz, key as usize));
            let ia = g(b.ionic, i); let ib = g(b.ionic, j); let qa = g(b.q, i); let qb = g(b.q, j);
            // iwK: an ion and a neutral partner of the other kind, K_IW
            let _ = (ia, ib); s(b.pk, n, ke); // (members meet each other without the ion–water doubling, 1.20)
            let cs = if qa == 0.0 || qb == 0.0 { c0 } else { c0 - if g(b.mfl, ma as usize) != 0 && g(b.mfl, mb as usize) != 0 { 1.0 / crate::RC2.sqrt() } else { 0.0 } };
            s(b.pcsh, n, cs);
        }
        n += 1;
    }
    s(p, P_N, n as f64);
    n
}

/// the shared partners of members a and c through incident pairs passing test: f(k1, k2) for each
#[inline(always)]
unsafe fn common<T: Fn(usize) -> bool, F: FnMut(usize, usize)>(b: &Bo, stamp: &mut i32, a: usize, c: usize, test: T, mut f: F) {
    *stamp += 1; let st = *stamp;
    let u0 = g(b.f0, c) as usize; let u1 = u0 + g(b.fc, c) as usize;
    for u in u0..u1 { let k = g(b.inc, u) as usize; if !test(k) { continue; } let o = if g(b.pa, k) as usize == c { g(b.pb, k) } else { g(b.pa, k) } as usize; s(b.mk, o, k as i32); s(b.st, o, st); }
    let u0 = g(b.f0, a) as usize; let u1 = u0 + g(b.fc, a) as usize;
    for u in u0..u1 { let k = g(b.inc, u) as usize; if !test(k) { continue; } let o = if g(b.pa, k) as usize == a { g(b.pb, k) } else { g(b.pa, k) } as usize; if g(b.st, o) == st { f(k, g(b.mk, o) as usize); } }
}

#[inline(always)]
unsafe fn bt(b: &Bo, k: usize) -> bool { g(b.pr, k) < g(b.tab, g(b.pt, k) as usize * PS + 4) }

/// boPass up to the energy (see the module's note). Returns the energy; P_STATUS 1 when the crowding list is full.
pub unsafe fn pass1(b: &Bo, p: *mut f64) -> f64 {
    let n = g(p, P_N) as usize; let nm = g(p, P_NM) as usize; let forces = g(p, P_FORCES) != 0.0; let tab = b.tab;
    s(p, P_STATUS, 0.0);
    for m in 0..nm { s(b.fc, m, 0); s(b.st, m, 0); }
    let mut e = 0.0f64;
    // non-bonded (switched), raw orders, the taper, the soft core
    for k in 0..n {
        let t = g(b.pt, k) as usize * PS; let r = g(b.pr, k);
        s(b.gr, k, 0.0); s(b.gn, k, 0.0); s(b.gca, k, 0.0); s(b.gcb, k, 0.0); s(b.pn, k, 0.0); s(b.ne, k, 0.0); s(b.ne0, k, 0.0); s(b.dne, k, 0.0); s(b.dne0, k, 0.0); s(b.psn, k, 0); s(b.qc, k, 0.0);
        if r >= g(tab, t + 4) { continue; }
        let r1 = g(tab, t); let c = g(tab, t + 1); let beta = g(tab, t + 2); let d = r - r1;
        let (mut n0, mut dn0);
        if d > 0.0 { n0 = (-beta * d * d).exp(); dn0 = -2.0 * beta * d * n0; }
        else { let w2 = BO_WIN * BO_WIN; let h = d * d / (d * d + w2); let hd = 2.0 * d * w2 / ((d * d + w2) * (d * d + w2)); n0 = (-d * h / c).exp(); dn0 = -n0 * (h + d * hd) / c; }
        if d > 0.9 { let u = core::f64::consts::PI * (d - 0.9) / 0.4; let f = 0.5 * (1.0 + u.cos()); let fd = -0.5 * u.sin() * core::f64::consts::PI / 0.4; dn0 = dn0 * f + n0 * fd; n0 *= f; }
        if n0 >= 3.5 { n0 = 3.5; dn0 = 0.0; }
        let (ne, dne);
        let za = g(b.mz, g(b.pa, k) as usize); let zb = g(b.mz, g(b.pb, k) as usize);
        let hbd = (za == 1 && (7..=9).contains(&zb)) || (zb == 1 && (7..=9).contains(&za));
        let (ta, tb) = if hbd { (BO_TAH, BO_TBH) } else { (BO_TA, BO_TB) };
        if n0 >= tb { ne = n0; dne = 1.0; } else if n0 <= ta { ne = 0.0; dne = 0.0; }
        else { let w = tb - ta; let u = (n0 - ta) / w; let ss = u * u * (3.0 - 2.0 * u); ne = n0 * ss; dne = ss + n0 * 6.0 * u * (1.0 - u) / w; }
        s(b.ne, k, ne); s(b.dne, k, dne * dn0); s(b.ne0, k, ne); s(b.dne0, k, dne * dn0);
        let sg = g(tab, t + 3); let z2 = sg * sg / (r * r); let z6 = z2 * z2 * z2; let s12 = z6 * z6; e += 0.05 * s12; ad(b.gr, k, -0.6 * s12 / r);
        let a = g(b.pa, k) as usize; let c2 = g(b.pb, k) as usize; s(b.fc, a, g(b.fc, a) + 1); s(b.fc, c2, g(b.fc, c2) + 1);
    }
    // each member's bond-term pairs, in order
    let mut acc = 0i32; for m in 0..nm { s(b.f0, m, acc); acc += g(b.fc, m); s(b.fc, m, 0); }
    for k in 0..n { if !bt(b, k) { continue; } let a = g(b.pa, k) as usize; let c = g(b.pb, k) as usize; s(b.inc, (g(b.f0, a) + g(b.fc, a)) as usize, k as i32); s(b.fc, a, g(b.fc, a) + 1); s(b.inc, (g(b.f0, c) + g(b.fc, c)) as usize, k as i32); s(b.fc, c, g(b.fc, c) + 1); }
    // crowded flat molecules
    let supcap = g(p, P_SUPCAP) as usize; let mut ns = 0usize; let mut stamp = 0i32;
    for k in 0..n {
        if !bt(b, k) || !(g(b.ne0, k) > 0.0) { continue; }
        let mut pp = 1.0f64; let s0 = ns;
        let dk = g(tab, g(b.pt, k) as usize * PS + 5);
        common(b, &mut stamp, g(b.pa, k) as usize, g(b.pb, k) as usize, |j| g(b.ne0, j) > 0.3, |k1, k2| {
            let dd = g(tab, g(b.pt, k1) as usize * PS + 5).min(g(tab, g(b.pt, k2) as usize * PS + 5)) - dk; if dd <= 0.4 { return; }
            let u = ((dd - 0.4) / 0.4).min(1.0); let sg = u * u * (3.0 - 2.0 * u); let w = bb(g(b.ne0, k1)) * bb(g(b.ne0, k2)) * sg; if w <= 0.0 { return; }
            pp *= 1.0 - w;
            if ns < supcap { s(b.sup1, ns, k1 as i32); s(b.sup2, ns, k2 as i32); s(b.sups, ns, sg); }
            ns += 1;
        });
        if ns > s0 { s(b.pss, k, s0 as i32); s(b.psn, k, (ns - s0) as i32); s(b.ne, k, g(b.ne0, k) * pp); s(b.dne, k, g(b.dne0, k) * pp); }
    }
    s(p, P_NS, ns as f64);
    if ns > supcap { s(p, P_STATUS, 1.0); return 0.0; }
    // caps, levels
    for m in 0..nm {
        let cnt = g(b.fc, m) as usize; s(b.mgl, m, 0.0); if cnt == 0 { continue; }
        let hi0 = g(b.f0, m) as usize; let en3 = g(b.men, m) >= 3.0;
        for u in hi0..hi0 + cnt {
            let k = g(b.inc, u) as usize; let am = g(b.pa, k) as usize == m; let o = if am { g(b.pb, k) } else { g(b.pa, k) } as usize;
            let cc = (if en3 { g(b.mcaph, o) } else { g(b.mcap, o) }).min(3.0); let ne = g(b.ne, k); let dd = (ne - cc).abs(); let h = hh(dd); let gg = hh_d(dd);
            let c = if ne <= cc { ne + h } else { cc + h }; let dc = if ne <= cc { 1.0 - gg } else { gg };
            if am { s(b.ca, k, c); s(b.dca, k, dc); } else { s(b.cb, k, c); s(b.dcb, k, dc); }
        }
        let mut keep = 1.0f64; let dv = g(b.mcaph, m) - g(b.mcap, m);
        if dv != 0.0 { for u in hi0..hi0 + cnt { let k = g(b.inc, u) as usize; let am = g(b.pa, k) as usize == m; let o = if am { g(b.pb, k) } else { g(b.pa, k) } as usize; if g(b.men, o) >= 3.0 { keep *= 1.0 - fade(if am { g(b.ca, k) } else { g(b.cb, k) }); } } }
        let v = g(b.mcap, m) + dv * (1.0 - keep); s(b.mkeep, m, keep);
        let mut lo = -v - 1.0; let mut hi = 4.0f64;
        for u in 0..cnt { let k = g(b.inc, hi0 + u) as usize; let c = if g(b.pa, k) as usize == m { g(b.ca, k) } else { g(b.cb, k) }; s(b.cs, u, c); s(b.fs, u, fade(c)); if c + 1.0 > hi { hi = c + 1.0; } }
        let ls = g(b.mls, m);
        let mut l = if ls > lo && ls < hi { ls } else { 0.5 * (lo + hi) };
        for _ in 0..100 {
            let mut gg = -v; let mut uu = 0.0f64; for u in 0..cnt { let x = g(b.cs, u) - l; gg += sp(x) * g(b.fs, u); uu += sp_d(x) * g(b.fs, u); }
            if gg.abs() < 1e-13 { break; }
            if gg > 0.0 { lo = l; } else { hi = l; }
            let mut ln = if uu > 0.0 { l + gg / uu } else { f64::NAN };
            if !(ln > lo && ln < hi) { ln = 0.5 * (lo + hi); }
            if hi - lo < 1e-15 { break; }
            l = ln;
        }
        s(b.mls, m, l); s(b.mlv, m, sp(l));
    }
    // orders and the Morse terms
    let mut stiff = g(p, P_STIFF);
    for k in 0..n {
        if !bt(b, k) { continue; }
        let a = g(b.pa, k) as usize; let c2 = g(b.pb, k) as usize; let cak = g(b.ca, k); let cbk = g(b.cb, k);
        let xa = cak - g(b.mlv, a); let xb = cbk - g(b.mlv, c2); let fa = fade(cak); let fb = fade(cbk); let aa = sp(xa) * fa; let bv = sp(xb) * fb;
        let dd = (aa - bv).abs(); let h = hh(dd); let gg = hh_d(dd);
        let nn = ((if aa <= bv { aa } else { bv }) + h).max(0.0); s(b.pn, k, nn);
        let na = if aa <= bv { 1.0 - gg } else { gg }; let nb = if aa <= bv { gg } else { 1.0 - gg };
        s(b.sa, k, na * sp_d(xa) * fa); s(b.ta, k, na * sp(xa) * fade_d(cak)); s(b.sb, k, nb * sp_d(xb) * fb); s(b.tb, k, nb * sp(xb) * fade_d(cbk));
        if nn > 1e-6 {
            let t = g(b.pt, k) as usize * PS; let r = g(b.pr, k); let r1 = g(tab, t); let c = g(tab, t + 1);
            let (dpt, d_d) = curve(true, nn, g(tab, t + 5), g(tab, t + 6), g(tab, t + 7));
            let n2 = nn * nn + 0.0025; let r0 = r1 - 0.5 * c * n2.ln(); let dr0 = -c * nn / n2;
            let (al, dal) = curve(false, nn, g(tab, t + 8), g(tab, t + 9), g(tab, t + 10));
            let x = r - r0; let ex = (-al * x).exp(); let e1 = 1.0 - ex; let d = r - r1;
            let (mut fcut, mut dfc) = (1.0f64, 0.0f64);
            if d > 0.9 { let u = core::f64::consts::PI * (d - 0.9) / 0.4; fcut = 0.5 * (1.0 + u.cos()); dfc = -0.5 * u.sin() * core::f64::consts::PI / 0.4; }
            let mm = dpt * (e1 * e1 - 1.0); let dmdr = dpt * 2.0 * e1 * ex * al;
            e += fcut * mm; ad(b.gr, k, fcut * dmdr + dfc * mm);
            if forces { let w = 4.0 * dpt * al * al * fcut * (g(b.mim, a) + g(b.mim, c2)); if w > stiff { stiff = w; } }
            ad(b.gn, k, fcut * ((e1 * e1 - 1.0) * d_d - dmdr * dr0 + dpt * 2.0 * e1 * ex * x * dal));
        }
    }
    let d3 = g(p, P_D3) != 0.0;
    let bx = crate::d3::Box3 { wrap: g(p, P_WRAP) != 0.0, bw: g(p, P_BW), bh: g(p, P_BH), bd: g(p, P_BD), hw: g(p, P_HW), hh: g(p, P_HH), hd: g(p, P_HD) };
    e += angles_all(b, forces, nm, d3, &bx);
    if d3 { e += torsions3(b, forces, n, &bx, g(p, P_F0)); } // (3-D: double, aromatic and single bonds don't twist freely, 1.25; here 1.26)
    let r13 = { let v = g(p, P_R13); if v > 0.0 { v } else { 4.4 } }; // (0 from a page before 1.25: the old fixed reach)
    e += coulomb(b, &mut stamp, forces, n, nm, &mut stiff, r13);
    e += share(b, forces, nm);
    s(p, P_STIFF, stiff);
    s(p, P_E, e);
    e
}

/// one centre's angle energy over the partners in b.list[0..nl] (bfAngle); returns (E, dE/d(Σ orders))
unsafe fn angle(b: &Bo, c: usize, nl: usize, wgt: f64, forces: bool) -> (f64, f64) {
    if !(2..=6).contains(&nl) { return (0.0, 0.0); }
    let mut sum = 0.0; for u in 0..nl { sum += g(b.pn, g(b.list, u) as usize); }
    let lpr0 = (g(b.mval, c) - sum) / 2.0; let lpr = lpr0.max(0.0); let l0 = lpr.floor(); let f = lpr - l0; let dfds = if lpr0 > 0.0 { -0.5 } else { 0.0 };
    let per = g(b.mper, c); let mut all_h = true;
    let mut aa = [0.0f64; 8]; let mut dxs = [0.0f64; 8]; let mut dys = [0.0f64; 8]; let mut gs = [0.0f64; 8]; let mut os = [0usize; 8]; let mut ord = [0usize; 8];
    let mut gv = [0.0f64; 8]; let mut ghi = [0usize; 8]; let mut glo = [0usize; 8]; let mut gord = [0usize; 8];
    for u in 0..nl {
        let k = g(b.list, u) as usize; let am = g(b.pa, k) as usize == c; let o = if am { g(b.pb, k) } else { g(b.pa, k) } as usize; let sg = if am { 1.0 } else { -1.0 };
        if g(b.mz, o) != 1 { all_h = false; }
        let ux = g(b.pux, k); let uy = g(b.puy, k); let r = g(b.pr, k);
        os[u] = o; aa[u] = fastmath::atan2(sg * uy, sg * ux); dxs[u] = sg * ux * r; dys[u] = sg * uy * r; gs[u] = 0.0; ord[u] = u;
    }
    for i in 1..nl { let v = ord[i]; let mut j = i as isize - 1; while j >= 0 && aa[ord[j as usize]] > aa[v] { ord[j as usize + 1] = ord[j as usize]; j -= 1; } ord[(j + 1) as usize] = v; }
    for k in 0..nl {
        let lo = ord[k]; let hi = ord[if k == nl - 1 { 0 } else { k + 1 }];
        gv[k] = if k == nl - 1 { aa[ord[0]] + 2.0 * core::f64::consts::PI - aa[lo] } else { aa[hi] - aa[lo] }; ghi[k] = hi; glo[k] = lo; gord[k] = k;
    }
    for i in 1..nl { let v = gord[i]; let mut j = i as isize - 1; while j >= 0 && gv[gord[j as usize]] > gv[v] { gord[j as usize + 1] = gord[j as usize]; j -= 1; } gord[(j + 1) as usize] = v; }
    let ev = |lp: f64, w: f64, gs: &mut [f64; 8]| -> f64 {
        let lpi = lp as i32;
        let key = (((nl as i32 * 8 + lpi) * 8 + per) * 2 + if all_h { 1 } else { 0 }) as usize;
        let mut t = 0.0;
        for k in 0..nl {
            let gi = gord[k]; let dv = gv[gi] - g(b.tgt, key * 6 + k); t += 0.5 * crate::ANGLE_K * dv * dv;
            if w != 0.0 { let gk = w * crate::ANGLE_K * dv; gs[ghi[gi]] += gk; gs[glo[gi]] -= gk; }
        }
        t
    };
    let mut ds = 0.0;
    let e = if f > 1e-9 {
        let e0 = ev(l0, if forces { wgt * (1.0 - f) } else { 0.0 }, &mut gs); let e1 = ev(l0 + 1.0, if forces { wgt * f } else { 0.0 }, &mut gs);
        ds = (e1 - e0) * dfds; (1.0 - f) * e0 + f * e1
    } else { ev(l0, if forces { wgt } else { 0.0 }, &mut gs) };
    if forces {
        let i = g(b.mslot, c) as usize;
        for u in 0..nl {
            let gg = gs[u]; if gg == 0.0 { continue; }
            let dx = dxs[u]; let dy = dys[u]; let r2 = dx * dx + dy * dy; let gx = gg * -dy / r2; let gy = gg * dx / r2; let j = g(b.mslot, os[u]) as usize;
            ad(b.fx, j, -gx); ad(b.fy, j, -gy); ad(b.fx, i, gx); ad(b.fy, i, gy);
        }
    }
    (e, ds)
}
unsafe fn angles_all(b: &Bo, forces: bool, nm: usize, d3: bool, bx: &crate::d3::Box3) -> f64 {
    let mut e = 0.0;
    for m in 0..nm { s(b.mgv, m, 0.0); }
    for c in 0..nm {
        let cnt = g(b.fc, c) as usize; if cnt == 0 || g(b.mdb, c) != 0 { continue; }
        let mut ns = 0usize; let mut z = 0usize; let f0 = g(b.f0, c) as usize;
        for u in f0..f0 + cnt {
            let k = g(b.inc, u) as usize; let nn = g(b.pn, k);
            if nn >= 0.7 { s(b.strong, ns, k as i32); ns += 1; }
            else if nn > 0.4 { let x = (nn - 0.4) / 0.3; s(b.zone, z, k as i32); s(b.zw, z, x * x * (3.0 - 2.0 * x)); s(b.zd, z, 6.0 * x * (1.0 - x) / 0.3); z += 1; }
        }
        if ns + z < 2 { continue; }
        if z > 6 { // (at most 64 subsets: a crowd past that keeps its 6 strongest; a stable sort, as Array.sort)
            // order the zone by order, strongest first, in the list's room (free until the subsets below)
            for u in 0..z { s(b.list, u, u as i32); }
            for i in 1..z { let v = g(b.list, i); let pv = g(b.pn, g(b.zone, v as usize) as usize); let mut j = i as isize - 1; while j >= 0 && g(b.pn, g(b.zone, g(b.list, j as usize) as usize) as usize) < pv { s(b.list, (j + 1) as usize, g(b.list, j as usize)); j -= 1; } s(b.list, (j + 1) as usize, v); }
            let mut zk = [0i32; 6]; let mut zw = [0.0f64; 6]; let mut zd = [0.0f64; 6];
            for u in 0..6 { let o = g(b.list, u) as usize; zk[u] = g(b.zone, o); zw[u] = g(b.zw, o); zd[u] = g(b.zd, o); }
            for u in 0..6 { s(b.zone, u, zk[u]); s(b.zw, u, zw[u]); s(b.zd, u, zd[u]); }
            z = 6;
        }
        for mask in 0usize..(1usize << z) {
            let mut wt = 1.0f64; let mut nl = 0usize;
            for u in 0..ns { s(b.list, nl, g(b.strong, u)); nl += 1; }
            for u in 0..z { if mask & (1 << u) != 0 { wt *= g(b.zw, u); s(b.list, nl, g(b.zone, u)); nl += 1; } else { wt *= 1.0 - g(b.zw, u); } }
            if wt <= 0.0 || nl < 2 { continue; }
            let (ea, ds) = if d3 { angle3(b, bx, c, nl, wt, forces) } else { angle(b, c, nl, wt, forces) };
            e += wt * ea;
            if ds != 0.0 { for u in 0..nl { ad(b.gn, g(b.list, u) as usize, wt * ds); } ad(b.mgv, c, -(wt * ds)); }
            for u in 0..z {
                let mut o = 1.0f64; for j in 0..z { if j != u { o *= if mask & (1 << j) != 0 { g(b.zw, j) } else { 1.0 - g(b.zw, j) }; } }
                ad(b.gn, g(b.zone, u) as usize, (if mask & (1 << u) != 0 { o } else { -o }) * g(b.zd, u) * ea);
            }
        }
    }
    e
}
/// the partial charges, the members' own Coulomb pairs and their Lennard-Jones pairs (bfCoulomb up to the non-members' potential)
unsafe fn coulomb(b: &Bo, stamp: &mut i32, forces: bool, n: usize, nm: usize, stiff: &mut f64, r13: f64) -> f64 {
    let vcut = 2.0 * 2.6f64.powf(-6.0) - 2.6f64.powf(-12.0); let shp = 0.002f64.sqrt();
    for m in 0..nm { s(b.mq, m, 0.0); s(b.mphi, m, 0.0); }
    for k in 0..n {
        if !(g(b.pn, k) > 0.0) { continue; }
        let a = g(b.pa, k) as usize; let c = g(b.pb, k) as usize; let ea = g(b.men, a); let eb = g(b.men, c); if ea == eb { continue; }
        let (v, sl) = qh(g(b.pn, k)); let qc = PARTIAL_K * (eb - ea); s(b.qc, k, qc); s(b.qdh, k, sl);
        ad(b.mq, a, qc * v); ad(b.mq, c, -(qc * v));
    }
    let nof = |z: i32| (7..=9).contains(&z);
    for m in 0..nm {
        let mut x = 0.0; let u0 = g(b.f0, m) as usize; let u1 = u0 + g(b.fc, m) as usize; for u in u0..u1 { x += g(b.pn, g(b.inc, u) as usize); }
        s(b.msn, m, x); s(b.mgf, m, 0.0);
    }
    for m in 0..nm {
        s(b.mgw, m, 0.0); s(b.mpol, m, 0.0); if g(b.mz, m) != 1 { continue; }
        let mut x = 0.0; let u0 = g(b.f0, m) as usize; let u1 = u0 + g(b.fc, m) as usize;
        for u in u0..u1 { let k = g(b.inc, u) as usize; let o = if g(b.pa, k) as usize == m { g(b.pb, k) } else { g(b.pa, k) } as usize; if nof(g(b.mz, o)) { x += g(b.pn, k); } }
        s(b.mpol, m, if x >= 1.0 { 1.0 } else if x <= 0.0 { 0.0 } else { x * x * (3.0 - 2.0 * x) });
    }
    let mut e = 0.0;
    for k in 0..n {
        let a = g(b.pa, k) as usize; let c = g(b.pb, k) as usize; let qa = g(b.mqn, a) + g(b.mq, a); let qb = g(b.mqn, c) + g(b.mq, c); let nk = g(b.pn, k);
        let b0 = bx(nk); let g0 = gg(nk); s(b.pfa, k, 0.0); s(b.pfb, k, 0.0); if b0 >= 1.0 { continue; }
        let r = g(b.pr, k); let ha = g(b.mz, a) == 1; let hb = g(b.mz, c) == 1;
        let lra = g(b.mljr, a); let lrb = g(b.mljr, c); let lsa = g(b.mljs, a); let lsb = g(b.mljs, c);
        let ra = if ha { lra + (BO_RHP - lra) * g(b.mpol, a) } else { lra }; let rb = if hb { lrb + (BO_RHP - lrb) * g(b.mpol, c) } else { lrb };
        let sa = if ha { lsa + (shp - lsa) * g(b.mpol, a) } else { lsa }; let sb = if hb { lsb + (shp - lsb) * g(b.mpol, c) } else { lsb };
        let rm = 0.5 * (ra + rb); let eps = sa * sb; let ljon = g0 < 1.0 && eps > 0.0 && r < 2.6 * rm; let ch = qa != 0.0 || qb != 0.0;
        if !ljon && !ch { continue; }
        let mut prod = 1.0f64; let mut nt = 0usize;
        if r < r13 {
            common(b, stamp, a, c, |j| g(b.pn, j) > BO_X0, |k1, k2| {
                let w = bx(g(b.pn, k1)) * bx(g(b.pn, k2)); if w <= 0.0 { return; }
                prod *= 1.0 - w; s(b.t1, nt, k1 as i32); s(b.t2, nt, k2 as i32); s(b.tw, nt, w); nt += 1;
            });
        }
        if !(prod > 0.0) { continue; }
        let mut es = 0.0f64; let mut vv = 0.0f64;
        if ch {
            let sw = (1.0 - b0) * prod; let kk = g(b.pk, k); let sq = (r * r + 0.09).sqrt(); let cc = kk * (1.0 / sq - g(b.pcsh, k));
            es = cc * qa * qb; e += sw * es;
            if forces { ad(b.gr, k, -sw * kk * r / (sq * sq * sq) * qa * qb); ad(b.mphi, a, sw * cc * qb); ad(b.mphi, c, sw * cc * qa); }
        }
        let mut wfk = 0.0f64;
        if ljon {
            let inr = if r < g(b.tab, g(b.pt, k) as usize * PS + 4) { nk } else { 0.0 };
            let xa = g(b.mcap, a) - (g(b.msn, a) - inr); let xb = g(b.mcap, c) - (g(b.msn, c) - inr); let ha_ = hf(xa); let hb_ = hf(xb);
            wfk = 1.0 - ha_ * hb_;
            let wl = (1.0 - g0) * prod * wfk; let same = g(b.mcl, a) == g(b.mcl, c);
            let (v, fv, mv) = lj(r, rm, if same { 0.5 * eps } else { eps }, if same { 0.8 } else { 0.62 }, vcut);
            vv = v; e += wl * vv;
            if forces {
                ad(b.gr, k, wl * fv);
                if !same && r < 0.8 * rm && r >= 0.62 * rm { let s6 = (rm / r).powi(6); let kw = wl * eps * (156.0 * s6 * s6 - 84.0 * s6) / (r * r) * (g(b.mim, a) + g(b.mim, c)); if kw > *stiff { *stiff = kw; } }
                let dve = vv / eps;
                if ha { ad(b.mgw, a, wl * (0.5 * mv * (BO_RHP - lra) + dve * sb * (shp - lsa))); }
                if hb { ad(b.mgw, c, wl * (0.5 * mv * (BO_RHP - lrb) + dve * sa * (shp - lsb))); }
                let vw = (1.0 - g0) * prod * vv; let fa = -vw * hf_d(xa) * hb_; let fb = -vw * ha_ * hf_d(xb);
                s(b.pfa, k, fa); s(b.pfb, k, fb); ad(b.mgf, a, fa); ad(b.mgf, c, fb);
            }
        }
        if !forces { continue; }
        let c1 = es * (1.0 - b0) + vv * (1.0 - g0) * wfk;
        ad(b.gn, k, -((es * bx_d(nk) + vv * gg_d(nk) * wfk) * prod));
        if c1 != 0.0 {
            for t in 0..nt {
                let k1 = g(b.t1, t) as usize; let k2 = g(b.t2, t) as usize; let w = g(b.tw, t); let dsw = -c1 * prod / (1.0 - w);
                ad(b.gn, k1, dsw * bx_d(g(b.pn, k1)) * bx(g(b.pn, k2))); ad(b.gn, k2, dsw * bx(g(b.pn, k1)) * bx_d(g(b.pn, k2)));
            }
        }
    }
    if forces {
        for k in 0..n { // (free valence: every order of an atom but the pair's own)
            if !(g(b.pr, k) < g(b.tab, g(b.pt, k) as usize * PS + 4)) { continue; }
            let a = g(b.pa, k) as usize; let c = g(b.pb, k) as usize;
            ad(b.gn, k, -((g(b.mgf, a) - g(b.pfa, k)) + (g(b.mgf, c) - g(b.pfb, k))));
        }
        for m in 0..nm { // (the hydrogens' sizes back to their orders)
            if g(b.mgw, m) == 0.0 { continue; }
            let u0 = g(b.f0, m) as usize; let u1 = u0 + g(b.fc, m) as usize;
            let mut x = 0.0; for u in u0..u1 { let k = g(b.inc, u) as usize; let o = if g(b.pa, k) as usize == m { g(b.pb, k) } else { g(b.pa, k) } as usize; if nof(g(b.mz, o)) { x += g(b.pn, k); } }
            if x <= 0.0 || x >= 1.0 { continue; }
            let d = g(b.mgw, m) * 6.0 * x * (1.0 - x);
            for u in u0..u1 { let k = g(b.inc, u) as usize; let o = if g(b.pa, k) as usize == m { g(b.pb, k) } else { g(b.pa, k) } as usize; if nof(g(b.mz, o)) { ad(b.gn, k, d); } }
        }
    }
    e
}
/// the shared proton's mixing (bfShare)
unsafe fn share(b: &Bo, forces: bool, nm: usize) -> f64 {
    for m in 0..nm { s(b.mgd, m, 0.0); }
    let nof = |z: i32| (7..=9).contains(&z);
    let mut e = 0.0;
    for h in 0..nm {
        if g(b.mz, h) != 1 || g(b.fc, h) < 2 { continue; }
        let u0 = g(b.f0, h) as usize; let u1 = u0 + g(b.fc, h) as usize;
        for u in u0..u1 {
            let k1 = g(b.inc, u) as usize; let a = if g(b.pa, k1) as usize == h { g(b.pb, k1) } else { g(b.pa, k1) } as usize; let n1 = g(b.pn, k1);
            if !(n1 > 0.0) || !nof(g(b.mz, a)) { continue; }
            for v in u + 1..u1 {
                let k2 = g(b.inc, v) as usize; let c = if g(b.pa, k2) as usize == h { g(b.pb, k2) } else { g(b.pa, k2) } as usize; let n2 = g(b.pn, k2);
                if !(n2 > 0.0) || !nof(g(b.mz, c)) { continue; }
                let m1 = if n1 < 1.0 { n1 } else { 1.0 }; let m2 = if n2 < 1.0 { n2 } else { 1.0 }; let vv = BO_SHV * 4.0 * m1 * m2;
                let mut t = 0.0f64; let mut dta = 0.0f64; let mut dtb = 0.0f64;
                for sg in [1.0f64, -1.0] {
                    let xa = sg * g(b.mqn, a); let xb = sg * g(b.mqn, c); let ea = sp(xa); let eb = sp(xb); let pr = ea * eb; if !(pr > 0.0) { continue; }
                    let r = (pr + BO_SHE * BO_SHE).sqrt(); t += r - BO_SHE;
                    if forces { dta += eb / (2.0 * r) * sp_d(xa) * sg; dtb += ea / (2.0 * r) * sp_d(xb) * sg; }
                }
                if t == 0.0 { continue; }
                e -= 2.0 * vv * t;
                if !forces { continue; }
                ad(b.mgd, a, 2.0 * vv * dta); ad(b.mgd, c, 2.0 * vv * dtb);
                if n1 < 1.0 { ad(b.gn, k1, -(2.0 * BO_SHV * 4.0 * m2 * t)); }
                if n2 < 1.0 { ad(b.gn, k2, -(2.0 * BO_SHV * 4.0 * m1 * t)); }
            }
        }
    }
    e
}
/// back through the orders to the distances, and the forces (boPass after the energy; the potential mphi complete)
pub unsafe fn pass2(b: &Bo, p: *mut f64) {
    let n = g(p, P_N) as usize; let nm = g(p, P_NM) as usize;
    for m in 0..nm { s(b.mgc, m, g(b.mgf, m)); s(b.mgh, m, 0.0); }
    for k in 0..n {
        if !(g(b.pn, k) > 0.0) { continue; }
        let a = g(b.pa, k) as usize; let c = g(b.pb, k) as usize;
        if g(b.qc, k) != 0.0 { ad(b.gn, k, (g(b.mphi, a) - g(b.mphi, c)) * g(b.qc, k) * g(b.qdh, k)); }
        let gg = g(b.gn, k); if gg == 0.0 { continue; }
        ad(b.gca, k, gg * (g(b.sa, k) + g(b.ta, k))); ad(b.mgl, a, -(gg * g(b.sa, k))); ad(b.gcb, k, gg * (g(b.sb, k) + g(b.tb, k))); ad(b.mgl, c, -(gg * g(b.sb, k)));
    }
    for m in 0..nm {
        let cnt = g(b.fc, m) as usize; if cnt == 0 || g(b.mgl, m) == 0.0 { continue; }
        let hi0 = g(b.f0, m) as usize; let ls = g(b.mls, m); let gs = g(b.mgl, m) * sp_d(ls); let mut uu = 0.0f64;
        for u in hi0..hi0 + cnt { let k = g(b.inc, u) as usize; let c = if g(b.pa, k) as usize == m { g(b.ca, k) } else { g(b.cb, k) }; uu += sp_d(c - ls) * fade(c); }
        if uu > 0.0 { for u in hi0..hi0 + cnt { let k = g(b.inc, u) as usize; let am = g(b.pa, k) as usize == m; let c = if am { g(b.ca, k) } else { g(b.cb, k) }; let w = (sp_d(c - ls) * fade(c) + sp(c - ls) * fade_d(c)) * gs / uu; if am { ad(b.gca, k, w); } else { ad(b.gcb, k, w); } } }
        if uu > 0.0 { let dev = -gs / uu; ad(b.mgc, m, g(b.mkeep, m) * dev); ad(b.mgh, m, (1.0 - g(b.mkeep, m)) * dev); }
        let dv = g(b.mcaph, m) - g(b.mcap, m);
        if uu > 0.0 && dv != 0.0 {
            for u in hi0..hi0 + cnt {
                let k = g(b.inc, u) as usize; let am = g(b.pa, k) as usize == m; let o = if am { g(b.pb, k) } else { g(b.pa, k) } as usize; if g(b.men, o) < 3.0 { continue; }
                let c = if am { g(b.ca, k) } else { g(b.cb, k) }; let f = fade(c); if f >= 1.0 { continue; }
                let w = -gs / uu * dv * fade_d(c) * g(b.mkeep, m) / (1.0 - f); if am { ad(b.gca, k, w); } else { ad(b.gcb, k, w); }
            }
        }
    }
    for k in 0..n {
        if !bt(b, k) { continue; }
        let gg = g(b.gca, k) * g(b.dca, k) + g(b.gcb, k) * g(b.dcb, k);
        {
            let a = g(b.pa, k) as usize; let c = g(b.pb, k) as usize;
            if g(b.men, a) >= 3.0 { if g(b.mcaph, c) < 3.0 { ad(b.mgh, c, g(b.gca, k) * (1.0 - g(b.dca, k))); } } else if g(b.mcap, c) < 3.0 { ad(b.mgc, c, g(b.gca, k) * (1.0 - g(b.dca, k))); }
            if g(b.men, c) >= 3.0 { if g(b.mcaph, a) < 3.0 { ad(b.mgh, a, g(b.gcb, k) * (1.0 - g(b.dcb, k))); } } else if g(b.mcap, a) < 3.0 { ad(b.mgc, a, g(b.gcb, k) * (1.0 - g(b.dcb, k))); }
        }
        ad(b.gr, k, gg * g(b.dne, k));
        let s0 = g(b.pss, k) as usize; let ns = g(b.psn, k) as usize;
        if ns != 0 && gg != 0.0 {
            for t in 0..ns {
                let k1 = g(b.sup1, s0 + t) as usize; let k2 = g(b.sup2, s0 + t) as usize; let sg = g(b.sups, s0 + t); let b1 = bb(g(b.ne0, k1)); let b2 = bb(g(b.ne0, k2)); let w = b1 * b2 * sg;
                let mut o = 1.0f64; for u in 0..ns { if u != t { o *= 1.0 - bb(g(b.ne0, g(b.sup1, s0 + u) as usize)) * bb(g(b.ne0, g(b.sup2, s0 + u) as usize)) * g(b.sups, s0 + u); } }
                let dew = -gg * g(b.ne0, k) * o;
                if w >= 0.0 { ad(b.gr, k1, dew * bb_d(g(b.ne0, k1)) * b2 * sg * g(b.dne0, k1)); ad(b.gr, k2, dew * b1 * bb_d(g(b.ne0, k2)) * sg * g(b.dne0, k2)); }
            }
        }
    }
    for m in 0..nm { // (∂E/∂ν: bfDqGrad)
        s(b.mgq, m, g(b.mgd, m) + g(b.mdei, m) + g(b.mdcap, m) * g(b.mgc, m) + g(b.mdcaph, m) * g(b.mgh, m) + g(b.mdval, m) * g(b.mgv, m) - g(b.mphi, m));
    }
    let d3 = g(p, P_D3) != 0.0;
    for k in 0..n {
        let gg = g(b.gr, k); if gg == 0.0 { continue; }
        let fx = gg * g(b.pux, k); let fy = gg * g(b.puy, k); let i = g(b.mslot, g(b.pa, k) as usize) as usize; let j = g(b.mslot, g(b.pb, k) as usize) as usize;
        ad(b.fx, j, -fx); ad(b.fy, j, -fy); ad(b.fx, i, fx); ad(b.fy, i, fy);
        if d3 { let fz = gg * g(b.puz, k); ad(b.fz, j, -fz); ad(b.fz, i, fz); } // (3-D: the depth, 1.26)
    }
}

// ---- 3-D (bo.js bfAngle3, bfTorsions3, bfTors1; 1.26) ----
/// engine.js angle3CentreK for one centre (slot pc, neighbour slots nb[0..n]) with its energy; the forces, when lf is
/// given, into lf (index 0 the centre, 1 + u neighbour u; three components each), as the JavaScript's scratch arrays.
unsafe fn centre3(b: &Bo, bx: &crate::d3::Box3, pc: usize, nb: &[usize; 6], n: usize, mode: i32, t0: f64, flat: bool, mut lf: Option<&mut [f64; 21]>) -> f64 {
    use crate::d3::{pair_ang, trans_pair, vec3p, Tg, K3_DIV, K_OOP, PI};
    let a90 = Tg::new(PI / 2.0); let a120 = Tg::new(2.0 * PI / 3.0); let a180 = Tg::new(PI); let tz = Tg::new(t0);
    let k = crate::ANGLE_K / K3_DIV[n];
    let mut ux = [0.0f64; 6]; let mut uy = [0.0f64; 6]; let mut uz = [0.0f64; 6]; let mut rr = [0.0f64; 6];
    for kk in 0..n {
        let (vx, vy, vz) = vec3p(b.x, b.y, b.pz, bx, pc, nb[kk]);
        let mut r = (vx * vx + vy * vy + vz * vz).sqrt(); if r == 0.0 || r.is_nan() { r = 1e-9; }
        ux[kk] = vx / r; uy[kk] = vy / r; uz[kk] = vz / r; rr[kk] = r;
    }
    let mut pcs = [0.0f64; 15]; let mut pt = [0.0f64; 15]; let mut pe = [0.0f64; 45]; let mut tg = [0u8; 15];
    let mut np = 0usize;
    for kk in 0..n { for l in kk + 1..n {
        let cc = ux[kk] * ux[l] + uy[kk] * uy[l] + uz[kk] * uz[l];
        let cx = uy[kk] * uz[l] - uz[kk] * uy[l]; let cy = uz[kk] * ux[l] - ux[kk] * uz[l]; let cz = ux[kk] * uy[l] - uy[kk] * ux[l];
        pcs[np] = cc; pt[np] = fastmath::atan2((cx * cx + cy * cy + cz * cz).sqrt(), cc); np += 1;
    } }
    if mode == 0 { for q in 0..np { tg[q] = 0; } }
    else if mode == 2 { for q in 0..np { tg[q] = if pair_ang(k, pt[q], pcs[q], &a180).0 <= pair_ang(k, pt[q], pcs[q], &a90).0 { 3 } else { 1 }; } }
    else {
        for q in 0..np { pe[3 * q] = pair_ang(k, pt[q], pcs[q], &a90).0; pe[3 * q + 1] = pair_ang(k, pt[q], pcs[q], &a120).0; pe[3 * q + 2] = pair_ang(k, pt[q], pcs[q], &a180).0; }
        let mut best = f64::INFINITY; let mut bk = 0usize; let mut bl = 0usize;
        if mode == 3 {
            for a in 0..n { for b2 in a + 1..n {
                let mut e = 0.0; let mut q = 0usize;
                for kk in 0..n { for l in kk + 1..n {
                    let ax = (if kk == a || kk == b2 { 1 } else { 0 }) + (if l == a || l == b2 { 1 } else { 0 });
                    e += pe[3 * q + (if ax == 2 { 2 } else if ax == 1 { 0 } else { 1 })]; q += 1;
                } }
                if e < best { best = e; bk = a; bl = b2; }
            } }
            let mut q = 0usize;
            for kk in 0..n { for l in kk + 1..n {
                let ax = (if kk == bk || kk == bl { 1 } else { 0 }) + (if l == bk || l == bl { 1 } else { 0 });
                tg[q] = if ax == 2 { 3 } else if ax == 1 { 1 } else { 2 }; q += 1;
            } }
        } else {
            for m in 1..4 {
                let mut e = 0.0; let mut q = 0usize;
                for kk in 0..4 { for l in kk + 1..4 { e += pe[3 * q + (if trans_pair(kk, l, m) { 2 } else { 0 })]; q += 1; } }
                if e < best { best = e; bk = m; }
            }
            let mut q = 0usize;
            for kk in 0..4 { for l in kk + 1..4 { tg[q] = if trans_pair(kk, l, bk) { 3 } else { 1 }; q += 1; } }
        }
    }
    let mut e = 0.0f64; let mut cfx = 0.0; let mut cfy = 0.0; let mut cfz = 0.0; let mut q = 0usize;
    for kk in 0..n { for l in kk + 1..n {
        let cc = pcs[q]; let t = tg[q];
        let (ev, gv) = pair_ang(k, pt[q], cc, if t == 0 { &tz } else if t == 1 { &a90 } else if t == 2 { &a120 } else { &a180 });
        e += ev;
        if let Some(f) = lf.as_deref_mut() { if gv != 0.0 {
            let ak = gv / rr[kk]; let al = gv / rr[l];
            let fkx = ak * (ux[l] - cc * ux[kk]); let fky = ak * (uy[l] - cc * uy[kk]); let fkz = ak * (uz[l] - cc * uz[kk]);
            let flx = al * (ux[kk] - cc * ux[l]); let fly = al * (uy[kk] - cc * uy[l]); let flz = al * (uz[kk] - cc * uz[l]);
            let ok = 3 * (kk + 1); let ol = 3 * (l + 1);
            f[ok] += fkx; f[ok + 1] += fky; f[ok + 2] += fkz; f[ol] += flx; f[ol + 1] += fly; f[ol + 2] += flz;
            cfx += fkx + flx; cfy += fky + fly; cfz += fkz + flz;
        } }
        q += 1;
    } }
    if let Some(f) = lf.as_deref_mut() { f[0] -= cfx; f[1] -= cfy; f[2] -= cfz; }
    if flat && n == 3 {
        let (t, gm) = trip(b, bx, [pc, nb[0], pc, nb[1], pc, nb[2]], K_OOP, lf.is_some());
        if let Some(f) = lf.as_deref_mut() { for m in 0..3 { let n1 = 3 * (m + 1); f[n1] -= gm[3 * m]; f[n1 + 1] -= gm[3 * m + 1]; f[n1 + 2] -= gm[3 * m + 2]; f[0] += gm[3 * m]; f[1] += gm[3 * m + 1]; f[2] += gm[3 * m + 2]; } }
        e += K_OOP * t * t;
    }
    e
}
/// engine.js triple3K's product T = û₁·û₂×û₃ over b_m = x[e[2m+1]] − x[e[2m]], and (want) its forces' parts G_m: the
/// caller takes G_m from the far end and adds it to the near one, m = 0, 1, 2 in turn. The energy is Kt·T·T.
unsafe fn trip(b: &Bo, bx: &crate::d3::Box3, ends: [usize; 6], kt: f64, want: bool) -> (f64, [f64; 9]) {
    let mut u = [0.0f64; 9]; let mut l3 = [0.0f64; 3];
    for m in 0..3 {
        let (vx, vy, vz) = crate::d3::vec3p(b.x, b.y, b.pz, bx, ends[2 * m], ends[2 * m + 1]);
        let mut l = (vx * vx + vy * vy + vz * vz).sqrt(); if l == 0.0 || l.is_nan() { l = 1e-9; }
        u[3 * m] = vx / l; u[3 * m + 1] = vy / l; u[3 * m + 2] = vz / l; l3[m] = l;
    }
    let g1x = u[4] * u[8] - u[5] * u[7]; let g1y = u[5] * u[6] - u[3] * u[8]; let g1z = u[3] * u[7] - u[4] * u[6];
    let t = u[0] * g1x + u[1] * g1y + u[2] * g1z;
    let mut gm = [0.0f64; 9];
    if want {
        let g2x = u[7] * u[2] - u[8] * u[1]; let g2y = u[8] * u[0] - u[6] * u[2]; let g2z = u[6] * u[1] - u[7] * u[0];
        let g3x = u[1] * u[5] - u[2] * u[4]; let g3y = u[2] * u[3] - u[0] * u[5]; let g3z = u[0] * u[4] - u[1] * u[3];
        let gx = [g1x, g2x, g3x]; let gy = [g1y, g2y, g3y]; let gz = [g1z, g2z, g3z]; let w = 2.0 * kt * t;
        for m in 0..3 {
            let a = w / l3[m];
            gm[3 * m] = a * (gx[m] - t * u[3 * m]); gm[3 * m + 1] = a * (gy[m] - t * u[3 * m + 1]); gm[3 * m + 2] = a * (gz[m] - t * u[3 * m + 2]);
        }
    }
    (t, gm)
}
/// bo.js bfAngle3: one centre's 3-D angle term over the partners in b.list[0..nl], weighted (its forces scaled by the
/// subset's weight); returns (E, dE/d(Σ orders)).
unsafe fn angle3(b: &Bo, bx: &crate::d3::Box3, c: usize, nl: usize, wgt: f64, forces: bool) -> (f64, f64) {
    if !(2..=6).contains(&nl) { return (0.0, 0.0); }
    let mut sum = 0.0; for u in 0..nl { sum += g(b.pn, g(b.list, u) as usize); }
    let lpr0 = (g(b.mval, c) - sum) / 2.0; let lpr = lpr0.max(0.0); let l0 = lpr.floor(); let f = lpr - l0; let dfds = if lpr0 > 0.0 { -0.5 } else { 0.0 };
    let per = g(b.mper, c); let pc = g(b.mslot, c) as usize; let mut all_h = true; let mut nb = [0usize; 6];
    for u in 0..nl { let k = g(b.list, u) as usize; let o = if g(b.pa, k) as usize == c { g(b.pb, k) } else { g(b.pa, k) } as usize; if g(b.mz, o) != 1 { all_h = false; } nb[u] = g(b.mslot, o) as usize; }
    let ev = |lp: f64, w: f64| -> f64 {
        let key = (((nl as i32 * 8 + lp as i32) * 8 + per) * 2 + if all_h { 1 } else { 0 }) as usize;
        let mode = g(b.tgt3, 3 * key) as i32; let t0 = g(b.tgt3, 3 * key + 1); let flat = g(b.tgt3, 3 * key + 2) != 0.0;
        if w == 0.0 || w.is_nan() { return centre3(b, bx, pc, &nb, nl, mode, t0, flat, None); } // (JS: !w)
        let mut lf = [0.0f64; 21];
        let e = centre3(b, bx, pc, &nb, nl, mode, t0, flat, Some(&mut lf));
        ad(b.fx, pc, w * lf[0]); ad(b.fy, pc, w * lf[1]); ad(b.fz, pc, w * lf[2]);
        for u in 0..nl { let j = nb[u]; let o = 3 * (u + 1); ad(b.fx, j, w * lf[o]); ad(b.fy, j, w * lf[o + 1]); ad(b.fz, j, w * lf[o + 2]); }
        e
    };
    if f > 1e-9 {
        let e0 = ev(l0, if forces { wgt * (1.0 - f) } else { 0.0 }); let e1 = ev(l0 + 1.0, if forces { wgt * f } else { 0.0 });
        return ((1.0 - f) * e0 + f * e1, (e1 - e0) * dfds);
    }
    (ev(l0, if forces { wgt } else { 0.0 }), 0.0)
}
const BO_TOR0: f64 = 1.1;
const BO_TORW: f64 = 0.4;
#[inline(always)]
fn tau(n: f64) -> f64 { let x = (n - BO_TOR0) / BO_TORW; if x <= 0.0 { 0.0 } else if x >= 1.0 { 1.0 } else { x * x * (3.0 - 2.0 * x) } }
#[inline(always)]
fn tau_d(n: f64) -> f64 { let x = (n - BO_TOR0) / BO_TORW; if x <= 0.0 || x >= 1.0 { 0.0 } else { 6.0 * x * (1.0 - x) / BO_TORW } }
/// bo.js bfTorsions3 (double and aromatic bonds) and bfTors1 (single bonds): E as the JavaScript adds them (the double
/// bonds' sum plus the single bonds' sum), their slopes into gn, their forces into fx, fy, fz.
unsafe fn torsions3(b: &Bo, forces: bool, n: usize, bx: &crate::d3::Box3, f0t: f64) -> f64 {
    use crate::d3::K_TOR;
    let mut e = 0.0f64;
    for k in 0..n {
        let nn = g(b.pn, k); if !(nn > BO_TOR0) { continue; }
        let x = ((nn - BO_TOR0) / BO_TORW).min(1.0); let ta = x * x * (3.0 - 2.0 * x); let dta = if x < 1.0 { 6.0 * x * (1.0 - x) / BO_TORW } else { 0.0 };
        let aa = g(b.pa, k) as usize; let bb_ = g(b.pb, k) as usize;
        let (ua0, ua1) = (g(b.f0, aa) as usize, (g(b.f0, aa) + g(b.fc, aa)) as usize); let (vb0, vb1) = (g(b.f0, bb_) as usize, (g(b.f0, bb_) + g(b.fc, bb_)) as usize);
        for u in ua0..ua1 {
            let k1 = g(b.inc, u) as usize; if k1 == k { continue; } let n1 = g(b.pn, k1); if !(n1 > 0.3) { continue; }
            let xx = if g(b.pa, k1) as usize == aa { g(b.pb, k1) } else { g(b.pa, k1) } as usize; let b1 = bb(n1);
            for v in vb0..vb1 {
                let k2 = g(b.inc, v) as usize; if k2 == k { continue; } let n2 = g(b.pn, k2); if !(n2 > 0.3) { continue; }
                let yy = if g(b.pa, k2) as usize == bb_ { g(b.pb, k2) } else { g(b.pa, k2) } as usize; if yy == xx { continue; }
                let b2 = bb(n2); let w = ta * b1 * b2; if !(w > 0.0) && !(dta > 0.0 && b1 * b2 > 0.0) { continue; }
                let (sx, sa, sb, sy) = (g(b.mslot, xx) as usize, g(b.mslot, aa) as usize, g(b.mslot, bb_) as usize, g(b.mslot, yy) as usize);
                let (t, _) = trip(b, bx, [sx, sa, sa, sb, sb, sy], K_TOR, false);
                let t2 = K_TOR * t * t / K_TOR; // (the JavaScript's triple3K(…, K_TOR, null) / K_TOR)
                if forces && w > 0.0 {
                    let (_, gm) = trip(b, bx, [sx, sa, sa, sb, sb, sy], w * K_TOR, true); let ends = [sx, sa, sa, sb, sb, sy];
                    for m in 0..3 { let n0 = ends[2 * m]; let n1i = ends[2 * m + 1]; ad(b.fx, n1i, -gm[3 * m]); ad(b.fy, n1i, -gm[3 * m + 1]); ad(b.fz, n1i, -gm[3 * m + 2]); ad(b.fx, n0, gm[3 * m]); ad(b.fy, n0, gm[3 * m + 1]); ad(b.fz, n0, gm[3 * m + 2]); }
                }
                let ee = K_TOR * t2; e += w * ee;
                ad(b.gn, k, dta * b1 * b2 * ee); ad(b.gn, k1, ta * bb_d(n1) * b2 * ee); ad(b.gn, k2, ta * b1 * bb_d(n2) * ee);
            }
        }
    }
    e + tors1_bo(b, forces, n, bx, f0t)
}
/// bo.js bfTors1: the single bonds' twist weighted as the orders say.
unsafe fn tors1_bo(b: &Bo, forces: bool, n: usize, bx: &crate::d3::Box3, f0t: f64) -> f64 {
    let mut e = 0.0f64;
    let side = |m: usize, k: usize| -> f64 { let mut sv = 0.0; let u0 = g(b.f0, m) as usize; let u1 = u0 + g(b.fc, m) as usize; for u in u0..u1 { let j = g(b.inc, u) as usize; if j != k { sv += tau(g(b.pn, j)); } } sv };
    let kt = |q: usize| -> [f64; 4] { [g(b.t1k, 4 * q), g(b.t1k, 4 * q + 1), g(b.t1k, 4 * q + 2), g(b.t1k, 4 * q + 3)] };
    let key = |zx: i32, za: i32, zb: i32, zy: i32| -> i32 { // (bfT1Key: TOR1B's CC0 CC1 CC2 = 0 1 2, TOR1's CO CN OO = 3 4 5, none −1)
        let lo = za.min(zb); let hi = za.max(zb);
        if lo == 6 && hi == 6 { return (if zx > 1 { 1 } else { 0 }) + (if zy > 1 { 1 } else { 0 }); }
        if lo == 6 && hi == 8 { 3 } else if lo == 6 && hi == 7 { 4 } else if lo == 8 && hi == 8 { 5 } else { -1 }
    };
    let (fxp, fyp, fzp) = if forces { (b.fx, b.fy, b.fz) } else { (core::ptr::null_mut(), core::ptr::null_mut(), core::ptr::null_mut()) };
    for k in 0..n {
        let nn = g(b.pn, k); if !(nn > 0.3) || !(nn < BO_TOR0 + BO_TORW) { continue; }
        let aa = g(b.pa, k) as usize; let bb_ = g(b.pb, k) as usize; if g(b.mdb, aa) != 0 || g(b.mdb, bb_) != 0 || g(b.fc, aa) < 2 || g(b.fc, bb_) < 2 { continue; }
        let sig = bb(nn) * (1.0 - tau(nn)); let dsig = bb_d(nn) * (1.0 - tau(nn)) - bb(nn) * tau_d(nn); if !(sig > 0.0) && dsig == 0.0 { continue; }
        let sa_ = side(aa, k); let sb_ = side(bb_, k); let da = sa_.min(1.0); let db = sb_.min(1.0); let cc = g(b.mz, aa) == 6 && g(b.mz, bb_) == 6;
        let (mut gs, mut gda, mut gdb) = (0.0f64, 0.0f64, 0.0f64);
        let (ua0, ua1) = (g(b.f0, aa) as usize, (g(b.f0, aa) + g(b.fc, aa)) as usize); let (vb0, vb1) = (g(b.f0, bb_) as usize, (g(b.f0, bb_) + g(b.fc, bb_)) as usize);
        for u in ua0..ua1 {
            let k1 = g(b.inc, u) as usize; if k1 == k { continue; } let n1 = g(b.pn, k1); if !(n1 > 0.3) { continue; }
            let xx = if g(b.pa, k1) as usize == aa { g(b.pb, k1) } else { g(b.pa, k1) } as usize;
            let bxv = bb(n1); let dbx = bb_d(n1); let tx = tau(n1); let dtx = tau_d(n1); let zx = g(b.mz, xx);
            for v in vb0..vb1 {
                let k2 = g(b.inc, v) as usize; if k2 == k { continue; } let n2 = g(b.pn, k2); if !(n2 > 0.3) { continue; }
                let yy = if g(b.pa, k2) as usize == bb_ { g(b.pb, k2) } else { g(b.pa, k2) } as usize; if yy == xx { continue; }
                let byv = bb(n2); let dby = bb_d(n2); let ty = tau(n2); let dty = tau_d(n2); let zy = g(b.mz, yy);
                let mut terms: [(usize, f64, f64, f64, f64, f64); 3] = [(0, 0.0, 0.0, 0.0, 0.0, 0.0); 3]; let mut nt = 0usize;
                let q = key(zx, g(b.mz, aa), g(b.mz, bb_), zy);
                if q >= 0 { terms[nt] = (q as usize, (1.0 - da) * (1.0 - db) * bxv * byv, -(1.0 - db) * bxv * byv, -(1.0 - da) * bxv * byv, (1.0 - da) * (1.0 - db) * dbx * byv, (1.0 - da) * (1.0 - db) * bxv * dby); nt += 1; }
                if cc && (zy == 6 || zy == 8) && ty > 0.0 { terms[nt] = (if zy == 6 { 6 } else { 7 }, (1.0 - da) * ty * bxv, -ty * bxv, 0.0, (1.0 - da) * ty * dbx, (1.0 - da) * dty * bxv); nt += 1; }
                if cc && (zx == 6 || zx == 8) && tx > 0.0 { terms[nt] = (if zx == 6 { 6 } else { 7 }, (1.0 - db) * tx * byv, 0.0, -tx * byv, (1.0 - db) * dtx * byv, (1.0 - db) * tx * dby); nt += 1; }
                for &(qk, w, wa, wb, w1, w2) in terms.iter().take(nt) {
                    if !(w > 0.0) && w1 == 0.0 && w2 == 0.0 && wa == 0.0 && wb == 0.0 { continue; }
                    let kk = kt(qk);
                    let (sx, sa, sb, sy) = (g(b.mslot, xx) as usize, g(b.mslot, aa) as usize, g(b.mslot, bb_) as usize, g(b.mslot, yy) as usize);
                    let ee = crate::d3::tors1(b.x, b.y, b.pz, bx, sx, sa, sb, sy, kk, f0t, core::ptr::null_mut(), core::ptr::null_mut(), core::ptr::null_mut());
                    if forces && sig * w > 0.0 { let c = sig * w; crate::d3::tors1(b.x, b.y, b.pz, bx, sx, sa, sb, sy, [c * kk[0], c * kk[1], c * kk[2], c * kk[3]], f0t, fxp, fyp, fzp); }
                    e += sig * w * ee; gs += w * ee; gda += sig * wa * ee; gdb += sig * wb * ee;
                    ad(b.gn, k1, sig * w1 * ee); ad(b.gn, k2, sig * w2 * ee);
                }
            }
        }
        ad(b.gn, k, dsig * gs);
        if gda != 0.0 && sa_ < 1.0 { for u in ua0..ua1 { let j = g(b.inc, u) as usize; if j != k { ad(b.gn, j, gda * tau_d(g(b.pn, j))); } } }
        if gdb != 0.0 && sb_ < 1.0 { for v in vb0..vb1 { let j = g(b.inc, v) as usize; if j != k { ad(b.gn, j, gdb * tau_d(g(b.pn, j))); } } }
    }
    e
}

// ---- WebAssembly exports ----
#[no_mangle]
pub unsafe extern "C" fn af_bo_collect(desc: u32, par: u32) -> u32 { let b = bo_desc(0, desc as usize as *const i32); collect(&b, par as usize as *mut f64) as u32 }
#[no_mangle]
pub unsafe extern "C" fn af_bo_pass1(desc: u32, par: u32) -> f64 { let b = bo_desc(0, desc as usize as *const i32); pass1(&b, par as usize as *mut f64) }
#[no_mangle]
pub unsafe extern "C" fn af_bo_pass2(desc: u32, par: u32) { let b = bo_desc(0, desc as usize as *const i32); pass2(&b, par as usize as *mut f64) }
