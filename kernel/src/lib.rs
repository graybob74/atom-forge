//! Atom Forge — the nucleus pair, Morse bond and VSEPR angle force kernels, as in engine.js between the
//! PAIR KERNEL markers, over the particle store S laid out in (shared) WebAssembly memory.
//!
//! The JavaScript side owns the memory: every array the kernels read or write is a typed array on the one
//! WebAssembly.Memory, and a *descriptor* (an i32 table, see `D_*`) gives each array's byte offset. The functions
//! here take that descriptor and ranges, write forces into the given output arrays and event *candidates*
//! (kind, i, j — three i32s each) into a queue, exactly as the JS kernels do, in the same order, with the same
//! arithmetic (so the two agree to floating-point rounding: the only differences are in exp/pow/atan2, where V8's
//! and this crate's libm may differ in the last bit).
//!
//! No statics, no allocation: several instances of this module run at once on one shared memory (the worker
//! threads), each with its own stack (set by the JS side through the exported `__stack_pointer`).
#![allow(clippy::too_many_arguments, clippy::missing_safety_doc)]

pub const RC2: f64 = 36.0; // RC = 6 Å
pub const FCAP: f64 = 1e7;
pub const CORE_RMIN: f64 = 0.02;
pub const BARE_SMEAR: f64 = 2.0;
pub const R_ANN: f64 = 0.3;
pub const ANGLE_K: f64 = 2.0;
pub const K_COUL: f64 = 14.3996454784; // PHYS.KE

pub const CAND_BOND: i32 = 1;
pub const CAND_REACT: i32 = 2;
pub const CAND_XFER: i32 = 3;
pub const CAND_HOT: i32 = 4;
pub const CAND_ANTI: i32 = 5;
pub const CAND_DATIVE: i32 = 6;
pub const CAND_XFERB: i32 = 7;
pub const CAND_BREAK: i32 = 8;

// descriptor entries: byte offsets of the arrays (the JS side fills them before every pass)
pub const D_X: usize = 0;
pub const D_Y: usize = 1;
pub const D_VX: usize = 2;
pub const D_VY: usize = 3;
pub const D_M: usize = 4;
pub const D_IM: usize = 5;
pub const D_Q: usize = 6;
pub const D_QP: usize = 7;
pub const D_LJR: usize = 8;
pub const D_LJS: usize = 9;
pub const D_IONR: usize = 10;
pub const D_ELRC: usize = 11;
pub const D_MR: usize = 12;
pub const D_MD: usize = 13;
pub const D_Z: usize = 14;
pub const D_NE: usize = 15;
pub const D_CAP: usize = 16;
pub const D_USED: usize = 17;
pub const D_LP: usize = 18;
pub const D_IONIC: usize = 19;
pub const D_ISMETAL: usize = 20;
pub const D_ANTI: usize = 21;
pub const D_XFERD: usize = 22;
pub const D_XFERA: usize = 23;
pub const D_METAL: usize = 24;
pub const D_MOL: usize = 25;
pub const D_ID: usize = 26;
pub const D_PI: usize = 27;
pub const D_PJ: usize = 28;
pub const D_EX: usize = 29;
pub const D_BA: usize = 30;
pub const D_BB: usize = 31;
pub const D_BR0: usize = 32;
pub const D_BAL: usize = 33;
pub const D_BD: usize = 34;
pub const D_BRB: usize = 35;
pub const D_ACC: usize = 36;
pub const D_ACNB: usize = 37;
pub const D_ACCNT: usize = 38;
pub const D_ACTG: usize = 39;
pub const D_LEN: usize = 40;

/// Raw pointers onto the store, from the descriptor; `base` is 0 in WebAssembly (offsets are addresses) and
/// the buffer's address in the native check harness.
#[derive(Clone, Copy)]
pub struct St {
    pub x: *const f64, pub y: *const f64, pub vx: *const f64, pub vy: *const f64, pub m: *const f64, pub im: *const f64,
    pub q: *const f64, pub qp: *const f64, pub ljr: *const f64, pub ljs: *const f64, pub ionr: *const f64, pub elrc: *const f64,
    pub mr: *const f64, pub md: *const f64,
    pub z: *const i16, pub ne: *const i16, pub cap: *const i16, pub used: *const i16, pub lp: *const i16,
    pub ionic: *const u8, pub ismetal: *const u8, pub anti: *const u8, pub xferd: *const u8, pub xfera: *const u8, pub metal: *const u8,
    pub mol: *const i32, pub id: *const i32,
    pub pi: *const i32, pub pj: *const i32, pub ex: *const u8,
    pub ba: *const i32, pub bb: *const i32, pub br0: *const f64, pub bal: *const f64, pub bd: *const f64, pub brb: *const f64,
    pub acc: *const i32, pub acnb: *const i32, pub accnt: *const u8, pub actg: *const f64,
}

#[inline(always)]
unsafe fn at<T>(base: usize, desc: *const i32, k: usize) -> *const T { (base + *desc.add(k) as u32 as usize) as *const T }

pub unsafe fn store(base: usize, desc: *const i32) -> St {
    St {
        x: at(base, desc, D_X), y: at(base, desc, D_Y), vx: at(base, desc, D_VX), vy: at(base, desc, D_VY), m: at(base, desc, D_M), im: at(base, desc, D_IM),
        q: at(base, desc, D_Q), qp: at(base, desc, D_QP), ljr: at(base, desc, D_LJR), ljs: at(base, desc, D_LJS), ionr: at(base, desc, D_IONR), elrc: at(base, desc, D_ELRC),
        mr: at(base, desc, D_MR), md: at(base, desc, D_MD),
        z: at(base, desc, D_Z), ne: at(base, desc, D_NE), cap: at(base, desc, D_CAP), used: at(base, desc, D_USED), lp: at(base, desc, D_LP),
        ionic: at(base, desc, D_IONIC), ismetal: at(base, desc, D_ISMETAL), anti: at(base, desc, D_ANTI), xferd: at(base, desc, D_XFERD), xfera: at(base, desc, D_XFERA), metal: at(base, desc, D_METAL),
        mol: at(base, desc, D_MOL), id: at(base, desc, D_ID),
        pi: at(base, desc, D_PI), pj: at(base, desc, D_PJ), ex: at(base, desc, D_EX),
        ba: at(base, desc, D_BA), bb: at(base, desc, D_BB), br0: at(base, desc, D_BR0), bal: at(base, desc, D_BAL), bd: at(base, desc, D_BD), brb: at(base, desc, D_BRB),
        acc: at(base, desc, D_ACC), acnb: at(base, desc, D_ACNB), accnt: at(base, desc, D_ACCNT), actg: at(base, desc, D_ACTG),
    }
}

#[inline(always)]
unsafe fn rd<T: Copy>(p: *const T, i: usize) -> T { *p.add(i) }
#[inline(always)]
unsafe fn add(p: *mut f64, i: usize, v: f64) { *p.add(i) += v; }

/// Per-call state the JS kernel keeps in module variables (_kStiff, the candidate count).
pub struct Ctx { pub kstiff: f64 }

#[inline(always)]
fn kstiff(c: &mut Ctx, s: &St, k: f64, i: usize, j: usize) {
    let w = unsafe { k * (rd(s.im, i) + rd(s.im, j)) };
    if w > c.kstiff { c.kstiff = w; }
}

// ---- ZBL screened core (engine.js zblA / zblD / zblD2) ----
#[inline(always)]
fn zbl_a(z1: f64, z2: f64) -> f64 { 0.46850 / (z1.powf(0.23) + z2.powf(0.23)) }
#[inline(always)]
fn zbl_d(k: f64, a: f64, r: f64) -> f64 {
    let x = r / a;
    let e1 = (-3.2 * x).exp(); let e2 = (-0.9423 * x).exp(); let e3 = (-0.4029 * x).exp(); let e4 = (-0.2016 * x).exp();
    let phi = 0.1818 * e1 + 0.5099 * e2 + 0.2802 * e3 + 0.02817 * e4;
    let dphi = -(0.58176 * e1 + 0.48048 * e2 + 0.11289 * e3 + 0.005679 * e4) / a;
    k * (dphi / r - phi / (r * r))
}
#[inline(always)]
fn zbl_d2(k: f64, a: f64, r: f64) -> f64 {
    let x = r / a;
    let e1 = (-3.2 * x).exp(); let e2 = (-0.9423 * x).exp(); let e3 = (-0.4029 * x).exp(); let e4 = (-0.2016 * x).exp();
    let phi = 0.1818 * e1 + 0.5099 * e2 + 0.2802 * e3 + 0.02817 * e4;
    let d1 = -(0.58176 * e1 + 0.48048 * e2 + 0.11289 * e3 + 0.005679 * e4) / a;
    let d2 = (1.861632 * e1 + 0.452756 * e2 + 0.045483 * e3 + 0.001145 * e4) / (a * a);
    k * (d2 / r - 2.0 * d1 / (r * r) + 2.0 * phi / (r * r * r))
}

/// repulsive force (positive outwards) of the screened-nuclear core inside the contact point c (coreFI)
#[inline(always)]
unsafe fn core_fi(c: &mut Ctx, s: &St, i: usize, j: usize, r: f64, cc: f64) -> f64 {
    if r >= cc { return 0.0; }
    let zi = rd(s.z, i) as f64; let zj = rd(s.z, j) as f64;
    let k = K_COUL * zi * zj; let al = zbl_a(zi, zj); let rr = if r > CORE_RMIN { r } else { CORE_RMIN };
    kstiff(c, s, zbl_d2(k, al, rr), i, j);
    -(zbl_d(k, al, rr) - zbl_d(k, al, cc))
}

/// Lennard-Jones with the Born wall, soft intramolecular wall and the core (ljFI)
#[inline(always)]
unsafe fn lj_fi(c: &mut Ctx, s: &St, i: usize, j: usize, r: f64, qa: f64, qb: f64) -> f64 {
    let qi = rd(s.q, i); let qj = rd(s.q, j); let qq = qi * qj;
    let rm; let mut eps;
    if rd(s.ionic, i) == 1 && rd(s.ionic, j) == 1 && qq < 0.0 { rm = rd(s.ionr, i) + rd(s.ionr, j); eps = K_COUL * qq.abs() / (12.0 * rm); }
    else {
        rm = 0.5 * (rd(s.ljr, i) + rd(s.ljr, j));
        eps = rd(s.ljs, i) * rd(s.ljs, j);
        if qq < 0.0 { eps = fmax(eps, K_COUL * qq.abs() / (12.0 * rm)); }
    }
    if eps <= 0.0 || r > 2.6 * rm { return 0.0; }
    let mi = rd(s.mol, i);
    let sm = mi != 0 && mi == rd(s.mol, j) && qa * qb > -0.06; // (softPair)
    if sm { eps *= 0.5; }
    let cc = (if sm { 0.8 } else { 0.62 }) * rm; let rr = if r < cc { cc } else { r };
    let sr = rm / rr; let s3 = sr * sr * sr; let s6 = s3 * s3;
    if r < 0.8 * rm && r >= cc { kstiff(c, s, eps * (156.0 * s6 * s6 - 84.0 * s6) / (rr * rr), i, j); }
    let ccc = if sm { 0.45 * rm } else { cc };
    12.0 * eps * (s6 * s6 - s6) / rr + (if r < ccc { core_fi(c, s, i, j, r, ccc) } else { 0.0 })
}

#[inline(always)]
unsafe fn metal_fi(c: &mut Ctx, s: &St, i: usize, j: usize, r: f64) -> f64 {
    let rm = 0.5 * (rd(s.mr, i) + rd(s.mr, j));
    if r > 2.1 * rm { return 0.0; }
    let d = (rd(s.md, i) * rd(s.md, j)).sqrt(); let al = 3.5 / rm;
    let cc = 0.6 * rm; let rr = if r < cc { cc } else { r };
    let e = (-al * (rr - rm)).exp();
    if r < 0.85 * rm && r >= cc { kstiff(c, s, 2.0 * d * al * al * e * (2.0 * e - 1.0), i, j); }
    -2.0 * d * al * (1.0 - e) * e + (if r < cc { core_fi(c, s, i, j, r, cc) } else { 0.0 })
}

/// Matter–antimatter pair: Coulomb only, annihilation once the electron clouds or nuclei touch (antiPairI).
#[inline(always)]
unsafe fn anti_pair_i(c: &mut Ctx, s: &St, i: usize, j: usize, r: f64, cq: *mut i32, nc: &mut usize) -> f64 {
    let qa = rd(s.q, i) + rd(s.qp, i); let qb = rd(s.q, j) + rd(s.qp, j); let ni = rd(s.ne, i); let nj = rd(s.ne, j);
    let soft = if ni > 0 && nj > 0 { 0.09 } else if ni == 0 && nj == 0 { 0.0016 } else { 0.04 };
    let mut f = 0.0;
    if qa != 0.0 && qb != 0.0 {
        let s2 = r * r + soft; f = K_COUL * qa * qb * r / (s2 * s2.sqrt());
        if r < 3.0 { kstiff(c, s, K_COUL * (qa * qb).abs() * ((soft - 2.0 * r * r).abs() + s2) / (s2 * s2 * s2.sqrt()), i, j); }
    }
    let touch = if ni > 0 && nj > 0 { 0.5 * (rd(s.ljr, i) + rd(s.ljr, j)) } else if ni > 0 { 0.55 * rd(s.elrc, i) + 0.25 } else if nj > 0 { 0.55 * rd(s.elrc, j) + 0.25 } else { R_ANN };
    if r < touch { cand(cq, nc, CAND_ANTI, i as i32, j as i32); }
    f
}

#[inline(always)]
unsafe fn cand(cq: *mut i32, nc: &mut usize, kind: i32, a: i32, b: i32) {
    *cq.add(*nc) = kind; *cq.add(*nc + 1) = a; *cq.add(*nc + 2) = b; *nc += 3;
}

/// JS Math.max for two non-NaN numbers.
#[inline(always)]
fn fmax(a: f64, b: f64) -> f64 { if a > b { a } else { b } }

#[inline(always)]
fn minimum_image(dx: &mut f64, dy: &mut f64, wrap: bool, bw: f64, bh: f64, hw: f64, hh: f64) {
    if wrap {
        if *dx > hw { *dx -= bw; } else if *dx < -hw { *dx += bw; }
        if *dy > hh { *dy -= bh; } else if *dy < -hh { *dy += bh; }
    }
}

/// All nucleus pairs q0 ≤ q < q1 of the neighbour list: forces into fxo/fyo, candidates into cq from entry nc0 on.
/// Returns the number of entries in cq.
pub unsafe fn pair_kernel(c: &mut Ctx, s: &St, q0: usize, q1: usize, fxo: *mut f64, fyo: *mut f64, cq: *mut i32, nc0: usize,
    wrap: bool, bw: f64, bh: f64, hw: f64, hh: f64, step: i64) -> usize {
    let mut nc = nc0;
    for q in q0..q1 {
        let exq = rd(s.ex, q);
        if exq == 1 { continue; }
        let i = rd(s.pi, q) as usize; let j = rd(s.pj, q) as usize;
        let mut dx = rd(s.x, j) - rd(s.x, i); let mut dy = rd(s.y, j) - rd(s.y, i);
        minimum_image(&mut dx, &mut dy, wrap, bw, bh, hw, hh);
        let r2 = dx * dx + dy * dy;
        if !(r2 < RC2 && r2 > 1e-10) { continue; }
        let zi = rd(s.z, i); let zj = rd(s.z, j);
        if zi == 0 || zj == 0 { continue; } // neutrons fly straight
        let r = r2.sqrt(); let ni = rd(s.ne, i); let nj = rd(s.ne, j);
        let mut f = 0.0;
        if rd(s.anti, i) != rd(s.anti, j) { f = anti_pair_i(c, s, i, j, r, cq, &mut nc); }
        else if ni > 0 && nj > 0 { // two atoms or ions (atomAtom)
            let qi = rd(s.q, i); let qj = rd(s.q, j); let qa = qi + rd(s.qp, i); let qb = qj + rd(s.qp, j);
            if qa != 0.0 && qb != 0.0 { let s2 = r * r + 0.09; f += K_COUL * qa * qb * r / (s2 * s2.sqrt()); }
            if rd(s.ismetal, i) == 1 && rd(s.ismetal, j) == 1 { f += metal_fi(c, s, i, j, r); }
            else {
                f += lj_fi(c, s, i, j, r, qa, qb);
                let fa = rd(s.cap, i) as i32 - rd(s.used, i) as i32; let fb = rd(s.cap, j) as i32 - rd(s.used, j) as i32;
                if fa > 0 && fb > 0 { if r < 3.6 { cand(cq, &mut nc, CAND_BOND, i as i32, j as i32); } } // two radicals: a bond may form
                else if (fa > 0) != (fb > 0) && r < 3.6 { // a radical at a molecule: a reaction may run
                    let (a, b) = if fa > 0 { (i, j) } else { (j, i) };
                    cand(cq, &mut nc, CAND_REACT, a as i32, b as i32);
                }
            }
            // electron transfer (ionic bonding, charge exchange) — checked occasionally for candidate pairs
            if ((rd(s.xferd, i) == 1 && rd(s.xfera, j) == 1) || (rd(s.xferd, j) == 1 && rd(s.xfera, i) == 1)) && (qi <= 0.0 || qj <= 0.0) && r < 5.5
                && (step + rd(s.id, i) as i64 + rd(s.id, j) as i64) % 8 == 0 { cand(cq, &mut nc, CAND_XFER, i as i32, j as i32); }
            // energetic collisions can excite or ionize
            let contact = 0.42 * (rd(s.ljr, i) + rd(s.ljr, j));
            if r < contact {
                let dvx = rd(s.vx, j) - rd(s.vx, i); let dvy = rd(s.vy, j) - rd(s.vy, i); let v2 = dvx * dvx + dvy * dvy;
                let mi = rd(s.m, i); let mj = rd(s.m, j);
                let mu = mi * mj / (mi + mj);
                if 0.5 * mu * v2 > 1.4 { cand(cq, &mut nc, CAND_HOT, i as i32, j as i32); }
            }
        } else { // a bare nucleus meeting an atom, ion or another bare nucleus (bareInteract)
            let (bare, o) = if ni == 0 { (i, j) } else { (j, i) };
            let qa = rd(s.q, i) + rd(s.qp, i); let qb = rd(s.q, j) + rd(s.qp, j);
            if qa != 0.0 && qb != 0.0 {
                if ni == 0 && nj == 0 {
                    let soft = 0.0016; let s2 = r * r + soft; f += K_COUL * qa * qb * r / (s2 * s2.sqrt());
                    if r < 3.0 && qa * qb < 0.0 { kstiff(c, s, K_COUL * (qa * qb).abs() * ((soft - 2.0 * r * r).abs() + s2) / (s2 * s2 * s2.sqrt()), i, j); }
                } else {
                    f += K_COUL * qa * qb * (if r >= BARE_SMEAR { 1.0 / (r * r) } else { r / (BARE_SMEAR * BARE_SMEAR * BARE_SMEAR) }); // (smearF)
                    if r < 3.0 && qa * qb < 0.0 { kstiff(c, s, K_COUL * (qa * qb).abs() * (if r >= BARE_SMEAR { 2.0 / (r * r * r) } else { 1.0 / (BARE_SMEAR * BARE_SMEAR * BARE_SMEAR) }), i, j); }
                }
            }
            if rd(s.ne, o) > 0 {
                let rc = rd(s.elrc, o); let rw = 0.55 * rc + 0.25;
                if r < rw { f += 8.0 * (rw - r) / rw + core_fi(c, s, i, j, r, rw); }
                if r < rc + 0.5 {
                    if rd(s.z, bare) == 1 && rd(s.lp, o) > 0 && rd(s.metal, o) == 0 { cand(cq, &mut nc, CAND_DATIVE, bare as i32, o as i32); }
                    else if (step + rd(s.id, i) as i64 + rd(s.id, j) as i64) % 3 == 0 { cand(cq, &mut nc, CAND_XFERB, o as i32, bare as i32); }
                }
            }
        }
        if f > FCAP { f = FCAP; } else if f < -FCAP { f = -FCAP; }
        let fx = f * dx / r; let fy = f * dy / r;
        add(fxo, j, fx); add(fyo, j, fy); add(fxo, i, -fx); add(fyo, i, -fy);
    }
    nc
}

/// The bonds b0 ≤ k < b1 (Morse): forces, and a break candidate where a bond is stretched past rb.
pub unsafe fn bond_kernel(s: &St, b0: usize, b1: usize, fxo: *mut f64, fyo: *mut f64, cq: *mut i32, nc0: usize,
    wrap: bool, bw: f64, bh: f64, hw: f64, hh: f64) -> usize {
    let mut nc = nc0;
    for k in b0..b1 {
        let i = rd(s.ba, k) as usize; let j = rd(s.bb, k) as usize;
        let mut dx = rd(s.x, j) - rd(s.x, i); let mut dy = rd(s.y, j) - rd(s.y, i);
        minimum_image(&mut dx, &mut dy, wrap, bw, bh, hw, hh);
        let mut r = (dx * dx + dy * dy).sqrt(); if r == 0.0 { r = 1e-6; } // (JS: || 1e-6)
        let d = r - rd(s.br0, k); let al = rd(s.bal, k);
        let e = (-al * (if d < -0.6 { -0.6 } else { d })).exp();
        let mut f = -2.0 * rd(s.bd, k) * al * (1.0 - e) * e;
        if f > FCAP { f = FCAP; } else if f < -FCAP { f = -FCAP; }
        let fx = f * dx / r; let fy = f * dy / r;
        add(fxo, j, fx); add(fyo, j, fy); add(fxo, i, -fx); add(fyo, i, -fy);
        if d > rd(s.brb, k) { cand(cq, &mut nc, CAND_BREAK, k as i32, 0); }
    }
    nc
}

/// The angle (VSEPR) terms of centres c0 ≤ c < c1 (AC: centre slot, neighbour slots, target angles).
pub unsafe fn angle_kernel(s: &St, c0: usize, c1: usize, fxo: *mut f64, fyo: *mut f64, wrap: bool, bw: f64, bh: f64, hw: f64, hh: f64) {
    let two_pi = 2.0 * core::f64::consts::PI;
    let mut ang = [0.0f64; 6]; let mut rad = [0.0f64; 6]; let mut nbr = [0usize; 6]; let mut gap = [0.0f64; 6]; let mut tgt = [0.0f64; 6];
    let mut ord = [0usize; 6]; let mut sn = [0.0f64; 6]; let mut cs = [0.0f64; 6]; let mut gi = [0usize; 6]; let mut ts = [0.0f64; 6];
    for c in c0..c1 {
        let pc = rd(s.acc, c) as usize; let n = rd(s.accnt, c) as usize; let px = rd(s.x, pc); let py = rd(s.y, pc); let b0 = c * 6;
        for i in 0..n {
            let o = rd(s.acnb, b0 + i) as usize;
            let mut dx = rd(s.x, o) - px; let mut dy = rd(s.y, o) - py;
            minimum_image(&mut dx, &mut dy, wrap, bw, bh, hw, hh);
            let rr = dx.hypot(dy);
            nbr[i] = o; rad[i] = if rr < 0.3 { 0.3 } else { rr }; ord[i] = i;
            if rr > 0.0 { sn[i] = dy / rr; cs[i] = dx / rr; } else { sn[i] = 0.0; cs[i] = 1.0; }
            if n > 2 { ang[i] = dy.atan2(dx); }
        }
        if n == 2 { // two bonds: one angle between them, the common case, with no sorting
            let mut g = (cs[0] * sn[1] - sn[0] * cs[1]).atan2(cs[0] * cs[1] + sn[0] * sn[1]);
            if g < 0.0 { g += two_pi; }
            let t0 = rd(s.actg, b0); let t1 = rd(s.actg, b0 + 1); let g1 = two_pi - g;
            let (lo, hi) = if t0 < t1 { (t0, t1) } else { (t1, t0) };
            let (tg0, tg1) = if g <= g1 { (lo, hi) } else { (hi, lo) }; // targets matched to gaps by rank
            let d = ANGLE_K * ((g1 - tg1) - (g - tg0)); // dE/dφ at bond 0; the opposite at bond 1
            let f0 = -d / rad[0]; let f1 = d / rad[1];
            let o0 = nbr[0]; let o1 = nbr[1];
            let fx0 = -sn[0] * f0; let fy0 = cs[0] * f0; let fx1 = -sn[1] * f1; let fy1 = cs[1] * f1;
            add(fxo, o0, fx0); add(fyo, o0, fy0); add(fxo, o1, fx1); add(fyo, o1, fy1);
            add(fxo, pc, -(fx0 + fx1)); add(fyo, pc, -(fy0 + fy1));
            continue;
        }
        // insertion sort by angle (n ≤ 6)
        for i in 1..n { let v = ord[i]; let mut j = i as isize - 1; while j >= 0 && ang[ord[j as usize]] > ang[v] { ord[j as usize + 1] = ord[j as usize]; j -= 1; } ord[(j + 1) as usize] = v; }
        for k in 0..n {
            let i = ord[k]; let j = ord[(k + 1) % n];
            let mut g = ang[j] - ang[i]; if k == n - 1 { g += two_pi; }
            gap[k] = g; gi[k] = k;
        }
        for k in 0..n { ts[k] = rd(s.actg, b0 + k); }
        // match targets to gaps by rank
        for i in 1..n { let v = gi[i]; let mut j = i as isize - 1; while j >= 0 && gap[gi[j as usize]] > gap[v] { gi[j as usize + 1] = gi[j as usize]; j -= 1; } gi[(j + 1) as usize] = v; }
        for i in 1..n { let v = ts[i]; let mut j = i as isize - 1; while j >= 0 && ts[j as usize] > v { ts[j as usize + 1] = ts[j as usize]; j -= 1; } ts[(j + 1) as usize] = v; }
        for k in 0..n { tgt[gi[k]] = ts[k]; }
        let mut cfx = 0.0; let mut cfy = 0.0;
        for k in 0..n {
            let i = ord[k];
            let prev = (k + n - 1) % n;
            let dedphi = ANGLE_K * ((gap[prev] - tgt[prev]) - (gap[k] - tgt[k]));
            let ft = -dedphi / rad[i];
            let fx = -sn[i] * ft; let fy = cs[i] * ft;
            let o = nbr[i];
            add(fxo, o, fx); add(fyo, o, fy); cfx += fx; cfy += fy;
        }
        add(fxo, pc, -cfx); add(fyo, pc, -cfy);
    }
}

/// One force pass over the given ranges: the pair kernel, then the bonds, then the angle centres (as the JS thread
/// does). Forces go to fxo/fyo, candidates to cq (from 0), the stiffest contact to *kstiff_out. Returns the number of
/// candidate entries. `base` is 0 in WebAssembly.
pub unsafe fn forces(base: usize, desc: *const i32, q0: usize, q1: usize, b0: usize, b1: usize, c0: usize, c1: usize,
    fxo: *mut f64, fyo: *mut f64, cq: *mut i32, wrap: bool, bw: f64, bh: f64, hw: f64, hh: f64, step: i64, kstiff_out: *mut f64) -> usize {
    let s = store(base, desc);
    let mut c = Ctx { kstiff: 0.0 };
    let mut nc = pair_kernel(&mut c, &s, q0, q1, fxo, fyo, cq, 0, wrap, bw, bh, hw, hh, step);
    nc = bond_kernel(&s, b0, b1, fxo, fyo, cq, nc, wrap, bw, bh, hw, hh);
    angle_kernel(&s, c0, c1, fxo, fyo, wrap, bw, bh, hw, hh);
    *kstiff_out = c.kstiff;
    nc
}

// ---- WebAssembly exports (offsets are addresses in the one linear memory) ----
#[no_mangle]
pub unsafe extern "C" fn af_forces(desc: u32, q0: u32, q1: u32, b0: u32, b1: u32, c0: u32, c1: u32, fxo: u32, fyo: u32, cq: u32,
    wrap: u32, bw: f64, bh: f64, hw: f64, hh: f64, step: f64, kstiff_out: u32) -> u32 {
    forces(0, desc as usize as *const i32, q0 as usize, q1 as usize, b0 as usize, b1 as usize, c0 as usize, c1 as usize,
        fxo as usize as *mut f64, fyo as usize as *mut f64, cq as usize as *mut i32, wrap != 0, bw, bh, hw, hh, step as i64, kstiff_out as usize as *mut f64) as u32
}
/// The constants the JS side checks against its own at start-up (a mismatch disables the module).
#[no_mangle]
pub extern "C" fn af_const(k: u32) -> f64 {
    match k { 0 => K_COUL, 1 => RC2, 2 => FCAP, 3 => CORE_RMIN, 4 => BARE_SMEAR, 5 => R_ANN, 6 => ANGLE_K, 7 => D_LEN as f64, _ => 25.0 }
}
/// Fill a f64 range with zeros (a worker clearing its force buffer).
#[no_mangle]
pub unsafe extern "C" fn af_zero(p: u32, n: u32) { core::ptr::write_bytes(p as usize as *mut f64, 0, n as usize); }
/// Sum the force buffers onto the store for slots s0 ≤ s < s1: fx/fy are the store's arrays, bufs is a table of
/// 2·nb offsets (buffer 0 fx, buffer 0 fy, buffer 1 fx, …), summed in order (the deterministic reduction).
#[no_mangle]
pub unsafe extern "C" fn af_sum(fx: u32, fy: u32, bufs: u32, nb: u32, s0: u32, s1: u32) {
    let fx = fx as usize as *mut f64; let fy = fy as usize as *mut f64; let tab = bufs as usize as *const u32; let nb = nb as usize;
    for s in s0 as usize..s1 as usize {
        let mut ax = *fx.add(s); let mut ay = *fy.add(s);
        for b in 0..nb { ax += *((*tab.add(2 * b)) as usize as *const f64).add(s); ay += *((*tab.add(2 * b + 1)) as usize as *const f64).add(s); }
        *fx.add(s) = ax; *fy.add(s) = ay;
    }
}
